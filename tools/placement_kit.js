/* 程度檢測頁(js/placement.js)的測試共用:vm 沙盒裡載入真的題庫、題目難度、js/common.js、估分的檔與檢測頁,
   配很小的假 DOM(tools/engine_kit.js)、假的 UI(專心模式、結算卡、確認視窗)、假的 Audio、假時鐘、手動推進的計時器、假的 CLOUD。
   不開瀏覽器、不連網。tools/test_placement.js 用。
   env(opt):opt = { ls(共用的 localStorage Map,兩次開頁用同一個)、now(毫秒)、search(網址的 ?…)、pid(學生檔案 id,null 是訪客)、
                    online(false 是離線)、cloud(雲端每一列)、confirm(確認視窗回什麼,預設 true)、onboard(多載 onboard-core) } */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { fakeDom } = require('./engine_kit');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const J = JSON.stringify;
const NOW = Date.parse('2026-11-25T10:00:00+08:00');
const HOUR = 3600e3;
const PID = 'c3f2b8c1e7d4a4b9e9c215a6e8f0d1b72';
const DATA = ['data/listening.js', 'data/part5.js', 'data/part6.js', 'data/part7.js', 'data/item-params.js'];
const CODE = ['js/estimate-core.js', 'js/estimate-data.js', 'js/estimate-store.js', 'js/estimate-ui.js', 'js/placement-views.js', 'js/placement.js'];
const flush = async (n) => { for (let i = 0; i < (n || 20); i++) await new Promise((r) => setImmediate(r)); };

function fakeUI(doc, o) {
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const action = (a, cls) => {
    const b = el(a.href ? 'a' : 'button', cls, a.label);
    if (a.href) b.setAttribute('href', a.href);
    Object.keys(a.attrs || {}).forEach((k) => b.setAttribute(k, String(a.attrs[k])));
    if (typeof a.onClick === 'function') b.addEventListener('click', (e) => a.onClick(e));
    return b;
  };
  const UI = {
    confirms: [], alerts: [], foot: [], focusCount: 0, said: [],
    mount() {}, doodle: () => Promise.resolve(false),
    confirm(x) { UI.confirms.push(x); return Promise.resolve(o.confirm === undefined ? true : o.confirm); },
    alert(x) { UI.alerts.push(x); return Promise.resolve(true); },
    empty(x) { const b = el('div', 'ui-empty'); b.append(el('p', 'ui-empty-text', x.text)); if (x.action) b.append(action(x.action, 'btn ui-empty-go')); b.destroy = () => {}; return b; },
    detail(title, nodes, opt) { const d = el('details', 'result-detail'); d.append(el('summary', 'result-detail-sum', title)); const body = el('div', 'result-detail-body'); nodes.forEach((n) => body.append(n)); d.append(body); d.wrong = opt && opt.wrong; return d; },
    result(x) {
      const card = el('section', 'result-card');
      if (x.kicker) card.append(el('p', 'result-kicker', x.kicker));
      card.append(el('h2', 'result-score', String(x.big)));
      if (x.stats) x.stats.forEach((s) => card.append(el('p', 'result-stat', s[0] + ' ' + s[1])));
      const reward = el('div', 'result-reward');
      card.append(reward);
      const acts = el('div', 'result-actions');
      if (x.primary) acts.append(action(x.primary, 'btn primary result-go'));
      (x.links || []).filter((l) => l && l.label).forEach((l) => acts.append(action(l, 'btn-text result-link')));
      card.append(acts);
      if (x.note) card.append(el('p', 'result-note', x.note));
      UI.lastResult = x;
      return { el: card, reward, destroy() {} };
    },
    focus: {
      enter(opt) {
        UI.focusCount++;
        const bar = el('div', 'quiz-bar');
        const close = el('button', 'quiz-close');
        const count = el('span', 'quiz-count');
        bar.append(close, count);
        const api = {
          bar, close, opt, active: true, total: 0, cur: 0,
          progress(n) { api.cur = n; count.textContent = n + ' / ' + api.total; },
          setTotal(n) { api.total = n; },
          foot(nodes) { UI.foot = [].concat(nodes || []).filter(Boolean); },
          keep(fn) { fn(); }, say(t) { UI.said.push(t); }, focusMain() {}, dirty() {}, action() {},
          leave() { api.active = false; UI.focus.cur = null; },
        };
        UI.focus.cur = api;
        return api;
      },
      cur: null,
    },
  };
  return UI;
}

function env(opt) {
  const o = opt || {};
  const ls = o.ls || new Map();
  const dom = fakeDom();
  const clock = { t: o.now || NOW };
  const timers = [];
  const audios = [];
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.t); } }
  FakeDate.now = () => clock.t;
  class FakeAudio {
    constructor(src) { this.src = src || ''; this.preload = ''; this.paused = true; this.ended = false; this.currentTime = 0; this.duration = 20; this.listeners = {}; this.plays = 0; audios.push(this); }
    play() { this.paused = false; this.plays++; return o.playReject ? Promise.reject(new Error('NotAllowed')) : Promise.resolve(); }
    pause() { this.paused = true; (this.listeners.pause || []).forEach((f) => f()); }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    emit(t) { if (t === 'ended') { this.currentTime = this.duration; this.ended = true; } (this.listeners[t] || []).slice().forEach((f) => f()); }
  }
  const pid = o.pid === undefined ? PID : o.pid;
  if (pid) ls.set('tr_current_profile', J(pid));
  else ls.delete('tr_current_profile');
  const cloudRows = Object.assign({}, o.cloud || {});
  const loc = { search: o.search || '', pathname: '/placement.html', hash: '', href: 'placement.html', reload() {} };
  const ctx = {
    console: { log() {}, warn() {}, error: (...a) => { (ctx.__errors = ctx.__errors || []).push(a.join(' ')); }, info() {} },
    document: dom, Date: FakeDate, Math, Audio: FakeAudio, URLSearchParams, Promise, Object, Array, JSON, Map, Set, Number, String, Error, TypeError, RegExp, Boolean, isFinite, isNaN,
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: (k) => { ls.delete(k); }, get length() { return ls.size; }, key: (i) => [...ls.keys()][i] || null },
    location: loc, history: { replaceState: (a, b, u) => { loc.replaced = u; } }, navigator: { onLine: o.online !== false },
    scrollTo() {}, addEventListener() {}, removeEventListener() {},
    setTimeout: (f, ms) => { const t = { f, at: clock.t + (ms || 0), done: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.done = true; },
  };
  ctx.window = ctx;
  ctx.CLOUD = { enabled: true, ready: Promise.resolve(null), user: null, pushed: [], push(k) { ctx.CLOUD.pushed.push(k); }, readKey: async (k) => (Object.prototype.hasOwnProperty.call(cloudRows, k) ? { ok: true, found: true, v: JSON.parse(J(cloudRows[k])) } : { ok: true, found: false, v: null }) };
  vm.createContext(ctx);
  const main = dom.createElement('main');
  const box = dom.createElement('div');
  box.setAttribute('id', 'pl-root');
  main.append(box);
  dom.body.append(main);
  ctx.UI = fakeUI(dom, o);
  DATA.forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  vm.runInContext(read('js/common.js') + '\n;globalThis.__store = store;', ctx, { filename: 'js/common.js' });
  if (o.onboard) vm.runInContext(read('js/onboard-core.js'), ctx, { filename: 'js/onboard-core.js' });
  CODE.forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  const tick = (ms) => {
    clock.t += ms;
    timers.filter((t) => !t.done && t.at <= clock.t).forEach((t) => { t.done = true; t.f(); });
  };
  const keyOf = (k) => 'tr_u' + pid + '_' + k;
  const get = (k) => (ls.has(keyOf(k)) ? JSON.parse(ls.get(keyOf(k))) : undefined);
  return { ctx, dom, box, ls, clock, audios, UI: ctx.UI, P: ctx.PLACEMENT, E: ctx.ESTIMATE, S: ctx.ESTIMATE_STORE, tick, get, keyOf, loc };
}

/* ---------- 在畫面上作答 ---------- */
const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
function all(root, sel) { return root.querySelectorAll(sel); }
function nextBtn(e) { return e.UI.foot.filter((b) => /pl-next/.test(b.className))[0] || null; }
function curUnit(e) { const c = e.P.state().cur; return c ? c.unit : null; }
function answerOf(u, qi) { return /^[125]$/.test(u.part) ? u.item.answer : u.item.questions[qi].answer; }
/* 一格的每一小題按一個選項:mode 'right' 選正解、'wrong' 選錯的、函式 (u, qi) → 選項 */
function pickAll(e, mode) {
  const u = curUnit(e);
  const groups = all(e.box, '.opts').concat(all(e.box, '.letter-row'));
  u.keys.forEach((k, qi) => {
    const a = answerOf(u, qi);
    const n = groups[qi].children.length;
    const c = typeof mode === 'function' ? mode(u, qi) : mode === 'wrong' ? (a + 1) % n : a;
    groups[qi].children[c].click();
  });
}
/* 聽力:按播放、播完 */
function playThrough(e) {
  const b = e.box.querySelector('.pl-play');
  if (!b || b.disabled) return false;
  b.click();
  e.audios[e.audios.length - 1].emit('ended');
  return true;
}
/* 答完目前這一格(聽力先播完):回 { part, id, count } */
function doSlot(e, mode) {
  const u = curUnit(e);
  const bar = e.UI.focus.cur ? e.UI.focus.cur.bar.querySelector('.quiz-count') : null;
  const count = txt(bar);
  if (Number(u.part) <= 4) playThrough(e);
  pickAll(e, mode);
  nextBtn(e).click();
  return { part: u.part, id: u.id, keys: u.keys, count };
}
async function doSection(e, mode) {
  const out = [];
  for (let i = 0; i < 20 && e.P.state().cur; i++) { out.push(doSlot(e, mode)); await flush(); }
  return out;
}
function clickText(root, text) {
  const b = all(root, 'button').concat(all(root, 'a')).filter((x) => txt(x) === text)[0];
  if (!b) throw new Error('找不到按鈕「' + text + '」');
  b.click();
  return b;
}

module.exports = { REPO, read, J, NOW, HOUR, PID, flush, env, txt, all, nextBtn, curUnit, answerOf, pickAll, playThrough, doSlot, doSection, clickText };
