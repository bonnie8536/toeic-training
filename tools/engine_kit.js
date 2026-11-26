/* 練習引擎(js/practice.js、listening.js、grammar.js、ear.js)在 node vm 裡跑的假環境,tools/test_engine_entry.js 用。
   小假 DOM、假的共用元件(UI;每次呼叫記進 log,畫面上的字照真的放進元素)、假的 localStorage、固定的時鐘與亂數、假的 Audio、
   排著不自己跑的計時器(flush 才跑);載真的 js/common.js、js/lesson-entry.js 與題庫資料。不開瀏覽器、不連網。
   engine 可以換成別的原始碼(例如 git 上改之前的版本),拿來比「沒給新參數時畫面與紀錄跟以前一樣」。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
const J = JSON.stringify;
const NOW = Date.parse('2026-11-24T10:00:00+08:00');

/* 改之前的版本:跟 main 分岔的那一點(沒有 main 就用 origin/main)。拿不到就丟錯,不默默略過 */
function baseRef() {
  for (const b of ['main', 'origin/main']) {
    const r = spawnSync('git', ['-C', REPO, 'merge-base', 'HEAD', b], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  throw new Error('找不到 main 的分岔點(git merge-base HEAD main)');
}
function baseSrc(file) {
  const r = spawnSync('git', ['-C', REPO, 'show', baseRef() + ':' + file], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error('git show ' + file + ' 失敗:' + r.stderr);
  return r.stdout.replace(/\r\n/g, '\n');
}

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ---------- 小假 DOM ---------- */
function fakeDom() {
  class Text { constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; } get textContent() { return this.data; } }
  class El {
    constructor(tag, kind) {
      this.nodeType = kind || 1; this.tagName = String(tag).toUpperCase(); this.childNodes = []; this.parentNode = null;
      this.attrs = {}; this.listeners = {}; this.style = { setProperty() {}, removeProperty() {} }; this.dataset = {};
      this.value = ''; this.disabled = false; this.readOnly = false; this.hidden = false; this._cls = new Set();
    }
    get className() { return [...this._cls].join(' '); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() {
      const s = this._cls;
      return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c),
        toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; if (on) s.add(c); else s.delete(c); return on; } };
    }
    get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
    get childElementCount() { return this.children.length; }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    get isConnected() { let e = this; while (e.parentNode) e = e.parentNode; return !!e._mounted; }
    get nextElementSibling() { const p = this.parentNode; if (!p) return null; const s = p.children; return s[s.indexOf(this) + 1] || null; }
    get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
    set textContent(v) { this.replaceChildren(); if (String(v)) this.append(String(v)); }
    set innerHTML(v) { this.replaceChildren(); this._html = String(v); }
    get innerHTML() { return this._html || ''; }
    setAttribute(k, v) {
      if (k === 'class') this.className = v;
      else if (k === 'disabled') this.disabled = true;
      else if (k === 'hidden') this.hidden = true;
      else if (k === 'readonly') this.readOnly = true;
      else this.attrs[k] = String(v);
    }
    getAttribute(k) { return k === 'class' ? this.className : k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return this.getAttribute(k) !== null; }
    removeAttribute(k) { if (k === 'disabled') this.disabled = false; else if (k === 'hidden') this.hidden = false; else delete this.attrs[k]; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
    fire(t, e) { const ev = Object.assign({ type: t, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} }, e); (this.listeners[t] || []).slice().forEach((f) => f(ev)); }
    click() { if (!this.disabled) this.fire('click'); }
    focus() { this._doc.activeElement = this; }
    blur() {}
    select() {}
    scrollIntoView() {}
    getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0 }; }
    _adopt(c) {
      if (c === null || c === undefined || typeof c !== 'object') c = new Text(String(c));
      if (c.parentNode) c.parentNode._drop(c);
      c.parentNode = this;
      return c;
    }
    _drop(c) { const i = this.childNodes.indexOf(c); if (i > -1) this.childNodes.splice(i, 1); c.parentNode = null; }
    _flat(cs) { return [].concat(...cs.map((c) => (c && c.nodeType === 11 ? c.childNodes.splice(0) : [c]))); }
    append(...cs) { this._flat(cs).forEach((c) => this.childNodes.push(this._adopt(c))); }
    prepend(...cs) { this._flat(cs).reverse().forEach((c) => this.childNodes.unshift(this._adopt(c))); }
    replaceChildren(...cs) { this.childNodes.slice().forEach((c) => this._drop(c)); this.append(...cs); }
    replaceWith(n) { const p = this.parentNode; if (!p) return; const i = p.childNodes.indexOf(this); p._drop(this); p.childNodes.splice(i, 0, p._adopt(n)); }
    remove() { if (this.parentNode) this.parentNode._drop(this); }
    after(n) { const p = this.parentNode; if (!p) return; const node = p._adopt(n); p.childNodes.splice(p.childNodes.indexOf(this) + 1, 0, node); }
    before(n) { const p = this.parentNode; if (!p) return; const node = p._adopt(n); p.childNodes.splice(p.childNodes.indexOf(this), 0, node); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    matches(sel) { return match(this, sel); }
    closest(sel) { let e = this; while (e && e.nodeType === 1) { if (match(e, sel)) return e; e = e.parentNode; } return null; }
    querySelectorAll(sel) {
      const out = [];
      sel.split(',').map((s) => s.trim()).forEach((one) => {
        const parts = one.split(/\s+/);
        const walk = (el) => el.children.forEach((c) => {
          if (match(c, parts[parts.length - 1])) {
            let ok = true, cur = c.parentNode;
            for (let k = parts.length - 2; k >= 0 && ok; k--) {
              while (cur && cur !== this && !match(cur, parts[k])) cur = cur.parentNode;
              if (!cur || cur === this) ok = false; else cur = cur.parentNode;
            }
            if (ok && out.indexOf(c) < 0) out.push(c);
          }
          walk(c);
        });
        walk(this);
      });
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  /* 選擇器只認 tag、.class、#id、[屬性] 這幾種 */
  function match(el, p) {
    const m = /^([a-z0-9]*)((?:[.#][\w-]+|\[[\w-]+\])*)$/i.exec(p);
    if (!m) return false;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    return (m[2].match(/[.#][\w-]+|\[[\w-]+\]/g) || []).every((x) => (x[0] === '.' ? el._cls.has(x.slice(1)) : x[0] === '#' ? el.attrs.id === x.slice(1) : el.hasAttribute(x.slice(1, -1))));
  }
  const dom = {
    title: '', activeElement: null, visibilityState: 'visible', listeners: {},
    createElement: (t) => { const e = new El(t); e._doc = dom; return e; },
    createTextNode: (t) => new Text(t),
    createDocumentFragment: () => { const e = new El('#fragment', 11); e._doc = dom; return e; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    removeEventListener() {},
  };
  const html = dom.createElement('html'); html._mounted = true;
  dom.documentElement = html;
  dom.head = dom.createElement('head'); dom.body = dom.createElement('body');
  html.append(dom.head, dom.body);
  dom.querySelector = (s) => html.querySelector(s);
  dom.querySelectorAll = (s) => html.querySelectorAll(s);
  dom.getElementById = (id) => html.querySelector('#' + id);
  return dom;
}

/* DOM 序列化:標籤、class、屬性、文字、disabled、hidden、readonly、value */
function ser(el) {
  if (!el) return '';
  if (el.nodeType === 3) return J(el.data);
  const attrs = Object.keys(el.attrs).sort().map((k) => k + '=' + J(el.attrs[k])).join(' ');
  return '<' + el.tagName + (el.className ? ' .' + el.className : '') + (attrs ? ' ' + attrs : '') + (el.disabled ? ' disabled' : '') + (el.hidden ? ' hidden' : '')
    + (el.readOnly ? ' readonly' : '') + (el.value ? ' value=' + J(el.value) : '') + '>' + el.childNodes.map(ser).join('') + '</' + el.tagName + '>';
}
/* log 用:函式寫成 ƒ、元素寫成序列化 */
function show(x) {
  return J(x, (k, v) => (typeof v === 'function' ? 'ƒ' : v && typeof v === 'object' && v.nodeType ? ser(v) : v === undefined ? '∅' : v));
}

/* ---------- 假的共用元件(js/ui.js 用到的那幾個) ---------- */
function fakeUI(doc, log) {
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null && text !== '') e.textContent = text; return e; };
  const action = (a, cls) => {
    const b = el(a.href ? 'a' : 'button', cls, a.label);
    if (a.href) b.setAttribute('href', a.href);
    Object.keys(a.attrs || {}).forEach((k) => b.setAttribute(k, String(a.attrs[k])));
    if (typeof a.onClick === 'function') b.addEventListener('click', (e) => a.onClick(e));
    return b;
  };
  const foot = el('div', 'quiz-foot');
  const UI = {
    foot, focusOpt: null,
    doodle: () => { log.push('doodle'); return Promise.resolve(false); },
    empty(o) { log.push('empty ' + show(o)); const box = el('div', 'ui-empty'); box.append(el('p', 'ui-empty-text', o.text)); if (o.action && o.action.label) box.append(action(o.action, 'btn ui-empty-go')); return box; },
    confirm(o) { log.push('confirm ' + show(o)); return { then(f) { f(true); return this; } }; },
    focus: {
      enter(opt) {
        log.push('focus.enter ' + show(opt));
        UI.focusOpt = opt;
        foot.replaceChildren();
        return {
          progress: (n) => log.push('progress ' + n), setTotal: (n) => log.push('setTotal ' + n), dirty: (v) => log.push('dirty ' + v),
          foot(nodes) { log.push('foot ' + show([].concat(nodes || []).filter(Boolean))); foot.replaceChildren(...[].concat(nodes || []).filter(Boolean)); },
          action: (a) => log.push('action ' + show(a)),
          feedback(f) {
            log.push('feedback ' + show(f));
            const b = el('button', 'btn primary quiz-next', f.next || '下一題');
            if (typeof f.onNext === 'function') b.addEventListener('click', (e) => f.onNext(e));
            foot.replaceChildren(b);
            return b;
          },
          keep: (redraw) => redraw(), focusMain: () => log.push('focusMain'), say: (t) => log.push('say ' + t), slot() {},
          leave: () => { log.push('leave'); foot.replaceChildren(); },
        };
      },
    },
    result(o) {
      log.push('result ' + show(o));
      const card = el('section', 'result-card');
      if (o.kicker) card.append(el('p', 'result-kicker', o.kicker));
      const heading = el('h2', 'result-score', typeof o.score === 'number' ? o.score + ' / ' + o.total : String(o.big));
      card.append(heading);
      const reward = el('div', 'result-reward');
      const acts = el('div', 'result-actions');
      if (o.primary) acts.append(action(o.primary, 'btn primary result-go'));
      (o.links || []).filter((x) => x && x.label).forEach((x) => acts.append(action(x, 'btn-text result-link')));
      card.append(reward, acts);
      return { el: card, reward, heading, destroy() {} };
    },
    detail(title, nodes, opt) {
      log.push('detail ' + title + ' ' + show(opt));
      const d = el('details', 'result-detail');
      d.append(el('summary', null, title));
      [].concat(nodes || []).filter(Boolean).forEach((n) => d.append(n));
      return d;
    },
  };
  return UI;
}

/* ---------- 沙盒 ----------
   opt.data:題庫資料檔;opt.engines:[{ file, src }](src 沒給就讀現在的檔);opt.rootId:頁面上的容器 id(null 表示課程頁,沒有容器);
   opt.search:網址的 ?…;opt.ls:一開始的 localStorage;opt.seed:亂數種子;opt.entry:false 不載 js/lesson-entry.js */
function engineEnv(opt) {
  const log = [];
  const ls = new Map(Object.entries(opt.ls || {}));
  const dom = fakeDom();
  const timers = [];
  const audios = [];
  const clock = { t: NOW };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.t); } }
  FakeDate.now = () => clock.t;
  const M = Object.create(Math); M.random = rng(opt.seed || 1);
  class FakeAudio {
    constructor(src) { this.src = src; this.paused = true; this.currentTime = 0; this.duration = 2; this.playbackRate = 1; this.listeners = {}; audios.push(this); }
    play() { this.paused = false; log.push('audio.play ' + this.src); return Promise.resolve(); }
    pause() { this.paused = true; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  }
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, document: dom, Date: FakeDate, Math: M, Audio: FakeAudio, URLSearchParams, Promise, Object, Array, JSON, Map, Set, Number, String, Error, TypeError,
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: (k) => { ls.delete(k); }, get length() { return ls.size; }, key: (i) => [...ls.keys()][i] || null },
    location: { search: opt.search || '', pathname: '/x.html', hash: '', href: 'page', reload() { log.push('reload'); } },
    history: { length: 2, back: () => log.push('history.back'), replaceState() {} },
    scrollTo() {}, scrollY: 0, innerHeight: 800,
    addEventListener: (t) => log.push('window.on ' + t), removeEventListener: (t) => log.push('window.off ' + t),
    setTimeout: (f, ms) => { const t = { f, ms, done: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.done = true; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const main = dom.createElement('main');
  dom.body.append(main);
  const root = opt.rootId ? dom.createElement('div') : null;
  if (root) { root.setAttribute('id', opt.rootId); main.append(root); }
  ctx.UI = fakeUI(dom, log);
  (opt.data || []).forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  vm.runInContext(read('js/common.js') + '\n;globalThis.__store = store;', ctx, { filename: 'js/common.js' });
  if (opt.entry !== false && fs.existsSync(path.join(REPO, 'js/lesson-entry.js'))) vm.runInContext(read('js/lesson-entry.js'), ctx, { filename: 'js/lesson-entry.js' });
  if (opt.before) opt.before(ctx);
  (opt.engines || []).forEach((e) => vm.runInContext(e.src !== undefined ? e.src : read(e.file), ctx, { filename: e.file }));
  /* 課程頁的容器:畫面上另外一塊 */
  const host = dom.createElement('div');
  host.setAttribute('id', 'lesson-host');
  main.append(host);
  const flush = () => { for (let i = 0; i < 50; i++) { const t = timers.find((x) => !x.done && x.ms < 10000); if (!t) return; t.done = true; t.f(); } };
  const stored = () => Object.fromEntries([...ls.entries()].sort().map(([k, v]) => [k, JSON.parse(v)]));
  return { ctx, dom, root, host, log, ls, stored, flush, audios, clock, foot: () => ctx.UI.foot.children };
}

module.exports = { REPO, read, J, NOW, rng, baseRef, baseSrc, fakeDom, ser, show, engineEnv };
