/* 課程的入口(js/lesson-home.js、js/lessons.js):首頁今天的課卡、程度結果頁的主按鈕(decorateResult)、課程總覽。
   真的 index.html 首頁格(.home-grid)放進很小的假 DOM;真的 js/common.js、起始程度三檔、lesson-home.js 載進沙盒,
   動態插入的 script 照 src 從 repo 讀進同一個沙盒(js/classes.js 換成假的班級名單,記查了幾次)。學習包用假的 fetch 從 data/packs 讀。
   「跟沒載 lesson-home.js 時一樣」:同一份資料開兩次頁(一次不載),比首頁格的節點。不開瀏覽器、不連網。
   用法:node tools/test_lesson_home.js */
'use strict';
const vm = require('vm');
const assert = require('assert');
const K = require('./lesson_kit.js');

const { J, eq, NOW, DAY, UID, CPID } = K;
const PRE = 'tr_u' + CPID + '_';
const CLS = 'class-a';
const T = {};

/* ---------- 假 DOM ---------- */
function parseSel(s) {
  const m = /^([a-z0-9]*)(#[\w-]+)?((?:\.[\w-]+)*)(\[[\w-]+\])?$/i.exec(s.trim());
  return m ? { tag: m[1].toUpperCase(), id: m[2] ? m[2].slice(1) : null, cls: m[3] ? m[3].split('.').filter(Boolean) : [], attr: m[4] ? m[4].slice(1, -1) : null } : null;
}
function hit(n, p) {
  if (!p || n.nodeType !== 1) return false;
  if (p.tag && n.tagName !== p.tag) return false;
  if (p.id && n.attrs.id !== p.id) return false;
  const have = n.className.split(' ');
  if (p.cls.some((c) => have.indexOf(c) < 0)) return false;
  return !p.attr || p.attr in n.attrs;
}
function makeDom(onScript) {
  const doc = { on: {}, activeElement: null, readyState: 'loading' };
  class N {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.nodeType = tag === '#text' ? 3 : 1; this.children = []; this.parentNode = null;
      this.attrs = {}; this.className = ''; this._t = ''; this.on = {}; this._hidden = false; this.log = null;
    }
    get hidden() { return this._hidden; }
    set hidden(v) { this._hidden = !!v; if (this.log) this.log.push(this._hidden ? 'hide' : 'show'); }
    get id() { return this.attrs.id || ''; }
    set id(v) { this.attrs.id = String(v); }
    get classList() {
      const cls = () => this.className.split(' ').filter(Boolean);
      return { contains: (c) => cls().indexOf(c) > -1, add: (c) => { if (cls().indexOf(c) < 0) this.className = cls().concat([c]).join(' '); },
        remove: (c) => { this.className = cls().filter((x) => x !== c).join(' '); },
        toggle: (c, on) => { const want = on === undefined ? cls().indexOf(c) < 0 : !!on; if (want) this.classList.add(c); else this.classList.remove(c); } };
    }
    _take(n) { const x = typeof n === 'string' ? doc.createTextNode(n) : n; if (x.parentNode) x.parentNode._rm(x); x.parentNode = this; return x; }
    append(...ns) { ns.forEach((n) => { const x = this._take(n); this.children.push(x); if (x.tagName === 'SCRIPT') onScript(x); }); }
    prepend(...ns) { ns.slice().reverse().forEach((n) => { const x = this._take(n); this.children.unshift(x); }); }
    after(n) { const p = this.parentNode; const x = p._take(n); p.children.splice(p.children.indexOf(this) + 1, 0, x); }
    replaceWith(n) { const p = this.parentNode; const i = p.children.indexOf(this); p._rm(this); const x = p._take(n); p.children.splice(i, 0, x); }
    replaceChildren(...ns) { this.children.slice().forEach((c) => this._rm(c)); this._t = ''; this.append(...ns); }
    _rm(c) { const i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); c.parentNode = null; }
    remove() { if (this.parentNode) this.parentNode._rm(this); }
    get nextElementSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
    setAttribute(k, v) { if (k === 'class') this.className = String(v); else this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
    click() { (this.on.click || []).forEach((f) => f({ type: 'click', currentTarget: this, target: this, preventDefault() {} })); }
    focus() { doc.activeElement = this; }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.documentElement; }
    get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children.slice().forEach((c) => this._rm(c)); this._t = String(v); }
    set innerHTML(v) { this.children.slice().forEach((c) => this._rm(c)); this._t = ''; }
    all() { const out = []; const w = (n) => n.children.forEach((c) => { out.push(c); w(c); }); w(this); return out; }
    querySelectorAll(sel) {
      return this.all().filter((n) => sel.split(',').some((part) => {
        const chain = part.trim().split(/\s+/).map(parseSel);
        if (!hit(n, chain[chain.length - 1])) return false;
        if (chain.length === 1) return true;
        for (let a = n.parentNode; a; a = a.parentNode) if (hit(a, chain[0])) return true;
        return false;
      }));
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  const html = new N('html'), head = new N('head'), body = new N('body');
  html.append(head, body);
  Object.assign(doc, {
    documentElement: html, head, body,
    createElement: (t) => new N(t), createElementNS: (ns, t) => new N(t),
    createTextNode: (t) => { const n = new N('#text'); n._t = String(t); return n; },
    addEventListener: (t, f) => { (doc.on[t] = doc.on[t] || []).push(f); },
    getElementById: (id) => html.all().find((n) => n.attrs.id === id) || null,
    querySelector: (s) => html.querySelector(s), querySelectorAll: (s) => html.querySelectorAll(s),
  });
  return { doc, N, html, head, body };
}
/* 很小的 HTML 剖析(只給 index.html 的首頁格用:沒有空元素、屬性都用雙引號) */
function parseHtml(dom, src) {
  const top = dom.doc.createElement('#frag');
  const stack = [top];
  const re = /<!--[\s\S]*?-->|<\/([a-z0-9]+)>|<([a-z0-9]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*>|([^<]+)/gi;
  let m;
  while ((m = re.exec(src))) {
    const cur = stack[stack.length - 1];
    if (m[1]) { stack.pop(); continue; }
    if (m[2]) {
      const n = dom.doc.createElement(m[2]);
      (m[3].match(/[\w:-]+(?:="[^"]*")?/g) || []).forEach((a) => {
        const k = a.split('=')[0], v = a.indexOf('=') > -1 ? a.slice(k.length + 2, -1) : '';
        if (k === 'hidden') n.hidden = true; else n.setAttribute(k, v);
      });
      cur.append(n);
      stack.push(n);
    } else if (m[4] && m[4].trim()) cur.append(dom.doc.createTextNode(m[4]));
  }
  return top.children;
}
const GRID_SRC = (() => { const s = K.read('index.html'); return s.slice(s.indexOf('<div class="home-grid">'), s.indexOf('<section class="home-dir"')); })();
/* 節點樹 → 字串(比「跟沒載時一樣」用) */
function ser(n) {
  if (n.nodeType === 3) return n._t;
  return '<' + n.tagName + ' ' + J(n.attrs) + ' .' + n.className + (n.hidden ? ' hidden' : '') + '>' + n._t + n.children.map(ser).join('') + '</>';
}

/* ---------- 假的共用元件(js/ui.js) ---------- */
function fakeUI(doc, e) {
  const node = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const action = (a, cls) => {
    const n = node(a.href ? 'a' : 'button', cls, a.label);
    if (a.href) n.setAttribute('href', a.href);
    if (a.onClick) n.addEventListener('click', a.onClick);
    return n;
  };
  return {
    sheet: (o) => { const el = node('div', 'ui-sheet'); (o.nodes || []).forEach((n) => el.append(n)); doc.body.append(el); const api = { opt: o, el, open: true, close: () => { api.open = false; el.remove(); } }; e.sheets.push(api); return api; },
    mount: (r) => { e.mounts.push(r); return Promise.resolve(true); },
    empty: (o) => {
      const box = node('div', 'ui-empty');
      box.append(node('canvas', 'ui-empty-art'), node('p', 'ui-empty-text', o.text));
      e.empties.push(o);
      if (o.action) box.append(action(o.action, 'btn ui-empty-go' + (o.action.primary ? ' primary' : '')));
      const links = (o.links || []).filter((l) => l && l.label);
      if (links.length) { const l = node('div', 'ui-empty-links'); links.forEach((x) => l.append(action(x, 'btn-text ui-empty-link'))); box.append(l); }
      return box;
    },
  };
}

/* ---------- 開一頁 ----------
   opt:page('index' | 'lessons')、home(false:不載 lesson-home.js)、ui、ids、signed(false:訪客)、teacher(CLOUD.ready 之後才知道)、
   waitCloud(CLOUD.ready 先不好,e.release() 才好)、membership(班級名單;'hang' 一直不回)、ls、ss(同一個分頁再開一次頁就傳同一份)、
   cloud(雲端的列;cloud.ok false 讀不到)、fetchFail、fetchHang、timers('fake')、seed(本機的鍵) */
const SEED_DONE = () => ({ onboard: { v: 1, status: 'done', step: 'result', updatedAt: new Date(NOW * 1000 - DAY * 1000).toISOString() } });
const LV_EE = { listening: 'entry', reading: 'entry', source: { listening: 'score', reading: 'score' }, setAt: '2026-11-01T00:00:00.000Z', history: [] };
const PLAN = { v: 1, source: 'self', classId: CLS, term: 1, packs: {}, packVersions: {}, startDate: '2026-11-20', lessonsPerWeek: null, mainDay: 4, extDay: null, postponedWeeks: 0, previous: null,
  weeklyAskedAt: '2026-11-21T00:00:00.000Z', updatedAt: 1 };
async function open(opt) {
  const o = Object.assign({ page: 'index', ui: 'pilot', ids: [CLS] }, opt || {});
  const ls = o.ls || new Map();
  const ss = o.ss || new Map();
  if (o.signed !== false) ls.set('tr_current_profile', J(CPID)); else ls.delete('tr_current_profile');
  Object.keys(o.seed || {}).forEach((k) => ls.set(PRE + k, J(o.seed[k])));
  const e = { ls, ss, loads: [], calls: 0, fetches: [], mounts: [], empties: [], errors: [], win: {}, replaced: [], sheets: [] };
  const clock = K.clockOf(o.now || NOW);
  const timers = o.timers === 'fake' ? (() => { const list = []; let n = 0; return {
    set: (fn, ms) => { list.push({ id: ++n, at: clock.t + (ms || 0), fn }); return n; },
    clear: (id) => { const i = list.findIndex((x) => x.id === id); if (i > -1) list.splice(i, 1); },
    tick: (ms) => { clock.t += ms; list.filter((x) => x.at <= clock.t).forEach((x) => { list.splice(list.indexOf(x), 1); x.fn(); }); } }; })() : null;
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.t); } }
  FakeDate.now = () => clock.t;
  let ctx = null;
  const dom = makeDom((s) => {
    const src = s.src || s.attrs.src;
    e.loads.push(src);
    if (src === o.hangScript) return;   // 這一支一直載不完(慢網路)
    setImmediate(() => {
      if (src === 'js/classes.js') ctx.CLASSES = classes();
      else vm.runInContext(K.read(src), ctx, { filename: src });
      s.onload();
    });
  });
  const classes = () => ({ api: { list: () => {
    e.calls++;
    if (o.membership === 'hang') return new Promise(() => {});
    return Promise.resolve(o.membership || { ok: true, classes: [] });
  } } });
  const cloud = o.cloud || K.cloudOf();
  const user = o.signed === false ? null : { id: UID, created_at: new Date(NOW * 1000 - 30 * DAY * 1000).toISOString() };
  let release;
  const gate = o.waitCloud ? new Promise((r) => { release = r; }) : Promise.resolve();
  e.release = () => release();
  ctx = {
    console: { log() {}, info() {}, warn() {}, error: (...a) => e.errors.push(a.map(String).join(' ')) },
    JSON, Date: FakeDate, Object, Array, Set, Map, WeakMap, WeakSet, Math, String, Number, Boolean, Promise, RegExp, Error, TypeError,
    URLSearchParams, TextEncoder, Uint32Array, crypto: require('crypto').webcrypto, setImmediate,
    setTimeout: timers ? timers.set : setTimeout, clearTimeout: timers ? timers.clear : clearTimeout,
    document: dom.doc, navigator: { onLine: true }, history: { replaceState() {}, pushState() {} },
    location: { search: '', pathname: '/' + o.page + '.html', href: 'https://example.test/' + o.page + '.html', replace: (u) => e.replaced.push(u), reload() {} },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k),
      get length() { return ls.size; }, key: (i) => [...ls.keys()][i] || null },
    sessionStorage: { getItem: (k) => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, String(v)), removeItem: (k) => ss.delete(k) },
    addEventListener: (t, f) => { (e.win[t] = e.win[t] || []).push(f); },
    fetch: (url) => {
      e.fetches.push(url);
      if (o.fetchHang) return new Promise(() => {});
      if (o.fetchFail && o.fetchFail(url)) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
      const body = K.read(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(body)) });
    },
    PACKS_UI: o.ui, PACKS_PILOT_CLASSES: o.ids,
  };
  ctx.window = ctx;
  ctx.UI = fakeUI(dom.doc, e);
  ctx.CLOUD = { enabled: true, user, isTeacher: false, reloading: false, push() {}, folderReady: () => true,
    ready: gate.then(() => { if (o.teacher) ctx.CLOUD.isTeacher = true; return user; }),
    readKey: async (k) => {
      await ctx.CLOUD.ready;
      cloud.reads.push(k);
      if (!cloud.ok || !user) return { ok: false };
      return cloud.rows.has(k) ? { ok: true, found: true, v: JSON.parse(cloud.rows.get(k)) } : { ok: true, found: false, v: null };
    } };
  vm.createContext(ctx);
  const main = dom.doc.createElement('main');
  dom.body.append(main);
  e.dom = dom; e.ctx = ctx; e.cloud = cloud; e.timers = timers;
  const run = (f) => vm.runInContext(K.read(f), ctx, { filename: f });
  if (o.page === 'index') {
    main.className = 'container home';
    parseHtml(dom, GRID_SRC).slice().forEach((n) => main.append(n));
    e.grid = main.querySelector('.home-grid');
    e.ob = dom.doc.getElementById('onboard-home');
    e.ob.log = [];
    ['js/common.js', 'js/sync-merge.js', 'js/sync-merge-lesson.js', 'js/onboard-core.js', 'js/onboard-data.js', 'js/onboard-ui.js'].forEach(run);
    if (o.home !== false) run('js/lesson-home.js');
  } else {
    main.className = 'container-narrow';
    const ph = dom.doc.createElement('div'); ph.className = 'page-head';
    const h1 = dom.doc.createElement('h1'); h1.textContent = '課程'; ph.append(h1);
    e.root = dom.doc.createElement('div'); e.root.setAttribute('id', 'lsn-root');
    main.append(ph, e.root);
    ['js/common.js', 'js/sync-merge.js', 'js/sync-merge-lesson.js', 'js/move-rules.js', 'js/move-merge.js', 'js/lesson-rules.js', 'js/pack-util.js', 'js/pack-core.js', 'js/onboard-core.js', 'js/lesson-plan.js', 'js/lesson-week.js'].forEach(run);
    ctx.CLASSES = classes();
    ['js/lesson-core.js', 'js/lesson-data.js', 'js/lesson-home.js', 'js/lessons.js'].forEach(run);
  }
  dom.doc.readyState = 'interactive';
  (dom.doc.on.DOMContentLoaded || []).forEach((f) => f({}));
  await settle();
  return e;
}
const settle = async (n) => { for (let i = 0; i < (n || 40); i++) await new Promise((r) => setImmediate(r)); };
const card = (e) => e.dom.doc.querySelector('.lsn-home');
const textOf = (n, sel) => { const x = n && n.querySelector(sel); return x ? x.textContent : null; };
const LOAD_BASE = ['js/lesson-core.js', 'js/lesson-data.js'];
const LOAD_REST = ['js/lesson-rules.js', 'js/pack-util.js', 'js/pack-core.js', 'js/lesson-plan.js', 'js/lesson-week.js'];   // 首頁與程度結果頁已經載了 onboard-core.js

/* ---------- 進度 ---------- */
const KE = K.env();
/* no 那一堂的進度:startedAt 是 at(秒);done 是 true(整堂上完)或做完的段 */
function lessonState(no, at, done, lv) {
  const l = KE.lesson(lv || K.EE, no);
  let s = KE.P.newState(l, at);
  const slots = done === true ? l.segments.map((x) => x.slot) : done || [];
  slots.forEach((slot) => { const seg = l.segments.filter((x) => x.slot === slot)[0]; s = KE.P.setSegment(s, l, slot, seg.fixed ? 'done' : 'skip', at + 600); });
  return K.plain(s);
}
const titleOf = (no) => KE.C.lessonTitle(KE.lesson(K.EE, no));
/* 試行班、入門／入門、設定做完;第 1、2 堂兩天前上完 */
const pilotSeed = (more) => Object.assign(SEED_DONE(), { levels: LV_EE, plan: PLAN,
  les_t1_01: lessonState(1, NOW - 3 * DAY, true), les_t1_02: lessonState(2, NOW - 2 * DAY, true) }, more || {});

/* ---------- 不是試行班的人:畫面不變、不多載、不查 ---------- */
async function sameAsBase(opt, name) {
  const a = await open(opt);
  const b = await open(Object.assign({}, opt, { home: false }));
  assert.equal(ser(a.grid), ser(b.grid), name + ':首頁格跟沒載 lesson-home.js 時不一樣');
  return a;
}
T['開關關、名單空、老師、訪客:首頁 DOM 跟沒載 lesson-home.js 時完全一樣、沒有動態載入任何檔、沒有查班級名單'] = async () => {
  const cases = [
    ['開關關', { ui: 'off', seed: pilotSeed() }],
    ['名單空', { ids: [], seed: pilotSeed() }],
    ['老師', { teacher: true, seed: Object.assign(SEED_DONE(), { levels: LV_EE }), membership: { ok: true, classes: [{ id: CLS }] } }],
    ['訪客', { signed: false, membership: { ok: true, classes: [{ id: CLS }] } }],
  ];
  for (const [name, opt] of cases) {
    const a = await sameAsBase(opt, name);
    eq([a.loads, a.calls, card(a), a.grid.className], [[], 0, null, 'home-grid'], name);
  }
};
T['沒加入試行班(no)、查不到(unknown):DOM 一樣;只載 lesson-core、lesson-data、classes 三支、只查一次;同一工作階段第二次開頁不載 classes.js、不查'] = async () => {
  const seed = Object.assign(SEED_DONE(), { levels: LV_EE });
  const ss = new Map();
  const no = await sameAsBase({ seed, ss, membership: { ok: true, classes: [{ id: 'class-b' }] } }, 'no');
  eq([no.loads, no.calls, card(no)], [LOAD_BASE.concat(['js/classes.js']), 1, null]);
  eq(JSON.parse(ss.get('lsn_pilot')).s, 'no');
  const again = await sameAsBase({ seed, ss, membership: { ok: true, classes: [{ id: 'class-b' }] } }, 'no 第二次');
  eq([again.loads, again.calls], [LOAD_BASE, 0]);
  const unk = await sameAsBase({ seed, membership: { ok: false, message: 'x', classes: [] } }, 'unknown');
  eq([unk.loads, unk.calls, card(unk)], [LOAD_BASE.concat(['js/classes.js']), 1, null]);
};

/* ---------- 試行班 ---------- */
T['試行有 plan:開頁當下就畫卡(不等 CLOUD.ready)、起始程度卡一次都沒出現、不載 classes.js 也不查;動態載入依序(lesson-rules 在 pack-core 前)'] = async () => {
  const e = await open({ seed: pilotSeed(), waitCloud: true });
  const c = card(e);
  assert.ok(c, '沒有卡');
  eq([e.grid.children[0] === c, e.ob.hidden, e.ob.children.length, e.ob.log.indexOf('show'), e.calls], [true, true, 0, -1, 0]);
  eq(e.loads, LOAD_BASE.concat(LOAD_REST));
  eq([textOf(c, 'h2'), textOf(c, '.lsn-home-go')], [titleOf(3), '開始第 3 堂']);
  e.release(); await settle();
  eq([card(e) && textOf(card(e), '.lsn-home-go'), e.ob.log.indexOf('show'), e.calls], ['開始第 3 堂', -1, 0]);
};
T['試行沒 plan:先畫起始程度卡,查完是試行班才換成今天的課卡(焦點不動);同一工作階段第二次開頁不查、直接畫卡'] = async () => {
  const ss = new Map();
  const seed = Object.assign(SEED_DONE(), { levels: LV_EE });
  const e = await open({ seed, ss, membership: { ok: true, classes: [{ id: 'class-z' }, { id: CLS }] } });
  const c = card(e);
  assert.ok(c, '沒有卡');
  eq([e.ob.log.indexOf('show') > -1, e.ob.hidden, e.ob.children.length, e.calls, e.dom.doc.activeElement], [true, true, 0, 1, null]);
  eq(e.loads, LOAD_BASE.concat(['js/classes.js'], LOAD_REST));
  eq([textOf(c, '.lsn-kicker'), textOf(c, '.lsn-home-go'), c.querySelector('.lsn-home-go').getAttribute('href')], ['第 1 堂', '開始第 1 堂', 'lesson.html?no=1']);
  eq(JSON.parse(ss.get('lsn_pilot')), { p: CPID, s: 'pilot', c: CLS });
  const again = await open({ seed, ss, membership: { ok: true, classes: [{ id: CLS }] } });
  eq([!!card(again), again.calls, again.loads], [true, 0, LOAD_BASE.concat(LOAD_REST)]);
};
T['首頁狀態:B_result(剛交卷、級別還沒算)照畫起始程度卡、不畫課卡;略過設定(none)但有 levels 畫課卡;沒有 levels 不畫'] = async () => {
  const ip = { v: 1, status: 'in_progress', step: 'test', testFrom: new Date(NOW * 1000 - 3600e3).toISOString() };
  const diag = { answers: {}, done: true, startedAt: new Date(NOW * 1000 - 1800e3).toISOString(), finishedAt: new Date(NOW * 1000 - 60e3).toISOString() };
  const br = await open({ seed: pilotSeed({ onboard: ip, diag }) });
  eq([card(br), br.ob.hidden, textOf(br.ob, 'h2'), textOf(br.ob, 'a')], [null, false, '繼續設定起始程度', '看起始程度']);
  const dm = await open({ seed: pilotSeed({ onboard: { v: 1, status: 'dismissed', step: null, updatedAt: '2026-11-01T00:00:00.000Z' } }) });
  eq([!!card(dm), dm.ob.hidden], [true, true]);
  const nolv = await open({ seed: Object.assign(pilotSeed(), { levels: null }) });
  eq(card(nolv), null);
};

/* ---------- 卡的六種狀態 ---------- */
const solid = (e) => e.grid.querySelectorAll('.primary').filter((n) => !(e.grid.classList.contains('lesson-go') && n.classList.contains('daily-go')));
function cardView(e) {
  const c = card(e);
  const go = c.querySelector('.lsn-home-go'), all = c.querySelector('.lsn-home-all'), art = c.querySelector('canvas');
  return {
    kicker: textOf(c, '.lsn-kicker'), h2: textOf(c, 'h2'), tags: c.querySelectorAll('.mock-tag').map((x) => x.textContent),
    pose: art ? art.getAttribute('data-mascot') : null, go: go ? [go.className, go.textContent, go.getAttribute('href')] : null,
    buttons: c.querySelectorAll('a,button').filter((x) => x !== all && !(x.parentNode && x.parentNode.className === 'lsn-week')).length, all: all ? [all.textContent, all.getAttribute('href'), all.getAttribute('aria-label')] : null,
    grid: e.grid.className, solid: solid(e).length,
  };
}
T['卡的狀態:可開始、進行中(實色鈕、每日練習卡的「開始」藏起來、全頁實色鈕 1 顆);右上「{d} / 24 堂」連到課程總覽'] = async () => {
  const st = await open({ seed: pilotSeed() });
  eq(cardView(st), { kicker: '第 3 堂', h2: titleOf(3), tags: ['約 60 分鐘'], pose: 'read', go: ['btn primary lsn-home-go', '開始第 3 堂', 'lesson.html?no=3'],
    buttons: 1, all: ['2 / 24 堂', 'lessons.html', '課程 2 / 24 堂'], grid: 'home-grid has-lesson lesson-go', solid: 1 });
  assert.equal(st.mounts.indexOf(card(st)) > -1, true, '鵜鶘要 UI.mount');
  eq([card(st).getAttribute('aria-labelledby'), card(st).querySelector('h2').getAttribute('id'), card(st).querySelector('canvas').getAttribute('data-size'), card(st).className],
    ['lsn-home-h', 'lsn-home-h', '72', 'daily-card lsn-home']);
  const doing = await open({ seed: pilotSeed({ les_t1_03: lessonState(3, NOW - DAY, ['vocab']) }) });
  const d = cardView(doing);
  eq([d.kicker, d.tags, d.pose, d.go, d.solid], ['第 3 堂', ['約 60 分鐘', '1 / 6 段'], 'read', ['btn primary lsn-home-go', '繼續第 3 堂', 'lesson.html?no=3'], 1]);
  const css = K.read('css/style.css');
  assert.ok(/\.home \.home-grid\.lesson-go \.daily-go \{ display: none; \}/.test(css), '藏每日練習卡「開始」的樣式');
  const first = await open({ seed: Object.assign(SEED_DONE(), { levels: LV_EE, plan: PLAN }) });
  eq([cardView(first).tags, cardView(first).go[1], cardView(first).all[0]], [['約 50 分鐘'], '開始第 1 堂', '0 / 24 堂']);
};
T['卡的狀態:明天開放、尚未開放沒有按鈕,每日練習卡的「開始」照常(全頁實色鈕是它那 1 顆)'] = async () => {
  const lim = await open({ seed: pilotSeed({ les_t1_01: lessonState(1, NOW - 3600, true), les_t1_02: lessonState(2, NOW - 1800, true) }) });
  eq(cardView(lim), { kicker: '第 3 堂', h2: titleOf(3), tags: ['明天開放'], pose: 'happy', go: null, buttons: 0, all: ['2 / 24 堂', 'lessons.html', '課程 2 / 24 堂'],
    grid: 'home-grid has-lesson', solid: 1 });
  const four = { les_t1_03: lessonState(3, NOW - 2 * DAY, true), les_t1_04: lessonState(4, NOW - DAY, true) };
  const off = await open({ seed: pilotSeed(four) });
  eq(cardView(off), { kicker: null, h2: '第 5 堂尚未開放', tags: [], pose: 'sleep', go: null, buttons: 0, all: ['4 / 24 堂', 'lessons.html', '課程 4 / 24 堂'],
    grid: 'home-grid has-lesson', solid: 1 });
  assert.ok(off.grid.querySelector('.daily-go'), '每日練習卡的開始還在');
};
T['卡的狀態:載入中(一行 status、沒有鵜鶘、沒有按鈕);讀不到學習包(描邊「重試」、鵜鶘 sleep),按重試讀到了就換成正常的卡、焦點到標題'] = async () => {
  const w = await open({ seed: pilotSeed(), fetchHang: true });
  const v = cardView(w);
  eq([v.h2, v.pose, v.buttons, v.go, textOf(card(w), '[role]'), card(w).querySelector('[role]').getAttribute('role'), v.grid], ['課程', null, 0, null, '載入中…', 'status', 'home-grid has-lesson']);
  let fail = true;
  const f = await open({ seed: pilotSeed(), fetchFail: () => fail });
  const fv = cardView(f);
  eq([fv.h2, fv.pose, textOf(card(f), '.lsn-home-note'), textOf(card(f), 'button'), card(f).querySelector('button').className, fv.solid], ['課程', 'sleep', '載入失敗', '重試', 'btn lsn-home-retry', 1]);
  assert.ok(f.errors.length > 0, '讀不到要 console.error');
  fail = false;
  card(f).querySelector('button').click(); await settle();
  eq([textOf(card(f), '.lsn-home-go'), f.dom.doc.activeElement === card(f).querySelector('h2')], ['開始第 3 堂', true]);
};
T['右上「{d} / 24 堂」:手指操作時上下內距補到點得到 44 高、負外距抵掉(版面不變,同 .lsn-back)'] = () => {
  const css = K.read('css/style.css');
  assert.ok(css.indexOf('@media (pointer: coarse) { .lsn-home-all { padding-top: 10px; padding-bottom: 10px; margin-top: -10px; margin-bottom: -10px; } }') > -1, '手指操作的點擊範圍');
};
T['有 plan:lesson-core.js 載完就畫「載入中」,不等 lesson-data.js 等其他檔'] = async () => {
  const e = await open({ seed: pilotSeed(), hangScript: 'js/lesson-data.js' });
  const c = card(e);
  eq([!!c, c && textOf(c, '[role]'), e.loads, e.grid.className], [true, '載入中…', LOAD_BASE, 'home-grid has-lesson']);
};
T['雲端灌資料後重畫:本機第 3 堂做一半、雲端那份已上完 → CLOUD.ready 之後換成第 4 堂,合併結果寫回本機'] = async () => {
  const cloud = K.cloudOf();
  cloud.put('les_t1_03', lessonState(3, NOW - DAY, true));
  const e = await open({ seed: pilotSeed({ les_t1_03: lessonState(3, NOW - DAY, ['vocab']) }), cloud, waitCloud: true });
  eq(textOf(card(e), '.lsn-home-go'), '繼續第 3 堂');
  e.release(); await settle();
  eq([textOf(card(e), '.lsn-home-go'), textOf(card(e), '.lsn-home-all'), !!JSON.parse(e.ls.get(PRE + 'les_t1_03')).doneAt], ['開始第 4 堂', '3 / 24 堂', true]);
};

/* ---------- ready、decorateResult ---------- */
T['ready():查名單逾時 8 秒算 unknown、不記快取'] = async () => {
  const e = await open({ seed: Object.assign(SEED_DONE(), { levels: LV_EE }), membership: 'hang', timers: 'fake' });
  let got = null;
  e.ctx.LESSON_HOME.ready().then((p) => { got = p; });
  await settle();
  eq([got, e.calls], [null, 1]);
  e.timers.tick(7999); await settle();
  assert.equal(got, null);
  e.timers.tick(1); await settle();
  eq([K.plain(got), e.ss.has('lsn_pilot'), card(e)], [{ state: 'unknown', classId: null }, false, null]);
};
/* 結果卡:主按鈕 a.btn.primary.result-go(照 S8 的「開始練習」) */
function resultCard(e) {
  const d = e.dom.doc, sec = d.createElement('section'), a = d.createElement('a');
  sec.className = 'result-card ob-result'; a.className = 'btn primary result-go'; a.textContent = '開始練習'; a.setAttribute('href', 'grammar.html');
  sec.append(a); d.body.append(sec);
  return { sec, go: () => [a.textContent, a.getAttribute('href')] };
}
T['decorateResult:試行沒 plan → 開始第 1 堂;有 plan 照首頁卡(可開始、進行中才換;明天開放不換);不是試行班不換;卡片已換掉時不動'] = async () => {
  const lv = Object.assign(SEED_DONE(), { levels: LV_EE });
  const a = await open({ seed: lv, home: true, ui: 'pilot', membership: { ok: true, classes: [{ id: CLS }] }, page: 'index' });
  const ra = resultCard(a); a.ctx.LESSON_HOME.decorateResult(ra.sec); await settle();
  eq(ra.go(), ['開始第 1 堂', 'lesson.html?no=1']);
  const b = await open({ seed: pilotSeed({ les_t1_03: lessonState(3, NOW - DAY, ['vocab']) }) });
  const rb = resultCard(b); b.ctx.LESSON_HOME.decorateResult(rb.sec); await settle();
  eq(rb.go(), ['繼續第 3 堂', 'lesson.html?no=3']);
  const c = await open({ seed: pilotSeed() });
  const rc = resultCard(c); c.ctx.LESSON_HOME.decorateResult(rc.sec); await settle();
  eq(rc.go(), ['開始第 3 堂', 'lesson.html?no=3']);
  const lim = await open({ seed: pilotSeed({ les_t1_01: lessonState(1, NOW - 3600, true), les_t1_02: lessonState(2, NOW - 1800, true) }) });
  const rl = resultCard(lim); lim.ctx.LESSON_HOME.decorateResult(rl.sec); await settle();
  eq(rl.go(), ['開始練習', 'grammar.html']);
  const no = await open({ seed: lv, membership: { ok: true, classes: [{ id: 'class-b' }] } });
  const rn = resultCard(no); no.ctx.LESSON_HOME.decorateResult(rn.sec); await settle();
  eq(rn.go(), ['開始練習', 'grammar.html']);
  const empty = await open({ seed: lv, ids: [] });
  const re = resultCard(empty); empty.ctx.LESSON_HOME.decorateResult(re.sec); await settle();
  eq([re.go(), empty.loads, empty.calls], [['開始練習', 'grammar.html'], [], 0]);
  const gone = await open({ seed: lv, membership: { ok: true, classes: [{ id: CLS }] } });
  const rg = resultCard(gone); gone.ctx.LESSON_HOME.decorateResult(rg.sec); rg.sec.remove(); await settle();
  eq(rg.go(), ['開始練習', 'grammar.html']);
};

T['decorateResult:不等班級名單,結果頁的主按鈕當下就照原樣(名單一直沒回來、不是試行班都一樣)'] = async () => {
  const lv = Object.assign(SEED_DONE(), { levels: LV_EE });
  for (const membership of ['hang', { ok: true, classes: [{ id: 'class-b' }] }]) {
    const e = await open({ seed: lv, membership, timers: 'fake' });
    const r = resultCard(e);
    e.ctx.LESSON_HOME.decorateResult(r.sec);
    const now = r.go();
    await settle();
    eq([now, r.go()], [['開始練習', 'grammar.html'], ['開始練習', 'grammar.html']], JSON.stringify(membership));
  }
};

/* ---------- 課程總覽 ---------- */
const rows = (e) => e.root.querySelectorAll('.lsn-list li').map((li) => {
  const r = li.children[0];
  return { tag: r.tagName, href: r.getAttribute('href'), text: r.textContent, cur: r.getAttribute('aria-current'), mark: r.querySelector('.lsn-mark').className, tab: r.getAttribute('tabindex') };
});
T['課程總覽:2 / 24 堂、頂端卡沒有右上連結;完成可點(綠勾)、目前那一堂 aria-current="step" 寫段數、不能上的列是純文字「未開放」;可讀名稱是「第 n 堂 堂名 狀態」'] = async () => {
  const e = await open({ page: 'lessons', seed: pilotSeed({ les_t1_03: lessonState(3, NOW - DAY, ['vocab']) }) });
  eq([textOf(e.root, '.lsn-tags'), !!card(e), card(e).querySelector('.lsn-home-all'), textOf(card(e), '.lsn-home-go')], ['2 / 24 堂', true, null, '繼續第 3 堂']);
  const list = e.root.querySelector('ol');
  eq([list.className, list.getAttribute('aria-label'), list.children.length], ['me-list lsn-list', '24 堂', 24]);
  const r = rows(e);
  eq(r[0], { tag: 'A', href: 'lesson.html?no=1', text: '第 1 堂 ' + titleOf(1) + ' 完成', cur: null, mark: 'lsn-mark is-done', tab: null });
  assert.ok(e.root.querySelector('.lsn-mark.is-done').children.length === 1, '完成有勾');
  eq(r[2], { tag: 'A', href: 'lesson.html?no=3', text: '第 3 堂 ' + titleOf(3) + ' 1 / 6 段', cur: 'step', mark: 'lsn-mark is-doing', tab: null });
  eq(r[3], { tag: 'DIV', href: null, text: '第 4 堂 ' + titleOf(4) + ' 未開放', cur: null, mark: 'lsn-mark', tab: null });
  eq(r.slice(4).map((x) => [x.tag, x.text.slice(-3)]), r.slice(4).map(() => ['DIV', '未開放']));
  eq([r.filter((x) => x.cur).length, e.root.querySelectorAll('.primary').length], [1, 1]);
};
T['課程總覽:沒開始的那一堂寫「未開始」(空心點);明天開放時頂端卡放實色「每日練習」(全頁實色鈕 1 顆),那一列不連結'] = async () => {
  const s = await open({ page: 'lessons', seed: pilotSeed() });
  eq([rows(s)[2].text.slice(-3), rows(s)[2].mark, rows(s)[2].cur], ['未開始', 'lsn-mark is-todo', 'step']);
  const lim = await open({ page: 'lessons', seed: pilotSeed({ les_t1_01: lessonState(1, NOW - 3600, true), les_t1_02: lessonState(2, NOW - 1800, true) }) });
  const go = card(lim).querySelector('.lsn-home-go');
  eq([go.textContent, go.getAttribute('href'), go.className, lim.root.querySelectorAll('.primary').length], ['每日練習', 'daily.html', 'btn primary lsn-home-go', 1]);
  eq([rows(lim)[2].tag, rows(lim)[2].cur, rows(lim)[2].text.slice(-3)], ['DIV', 'step', '未開放']);
};
T['課程總覽的空狀態:沒加入試行班與老師「課程尚未開放」＋實色「每日練習」;查不到「讀不到班級資料」＋「重試」＋連結;沒有 levels;讀不到學習包'] = async () => {
  const lv = Object.assign(SEED_DONE(), { levels: LV_EE });
  const view = (e) => [textOf(e.root, '.ui-empty-text'), e.root.querySelectorAll('.ui-empty-go').map((x) => [x.textContent, x.className, x.getAttribute('href')]),
    e.root.querySelectorAll('.ui-empty-link').map((x) => x.textContent), e.empties[e.empties.length - 1].pose];
  const offE = ['課程尚未開放', [['每日練習', 'btn ui-empty-go primary', 'daily.html']], [], 'sleep'];
  eq(view(await open({ page: 'lessons', seed: lv, membership: { ok: true, classes: [{ id: 'class-b' }] } })), offE);
  eq(view(await open({ page: 'lessons', seed: lv, teacher: true })), offE);
  eq(view(await open({ page: 'lessons', seed: lv, ui: 'off' })), offE);
  const u = await open({ page: 'lessons', seed: lv, membership: { ok: false, classes: [] } });
  eq(view(u), ['讀不到班級資料', [['重試', 'btn ui-empty-go', null]], ['每日練習'], 'sleep']);
  assert.equal(u.root.querySelector('.ui-empty-text').getAttribute('tabindex'), '-1');
  eq(view(await open({ page: 'lessons', seed: { plan: PLAN, onboard: SEED_DONE().onboard } })), ['還沒設定起始程度', [['設定程度', 'btn ui-empty-go', 'start.html']], [], 'sleep']);
  let fail = true;
  const f = await open({ page: 'lessons', seed: pilotSeed(), fetchFail: () => fail });
  eq(view(f), ['載入失敗', [['重試', 'btn ui-empty-go', null]], ['每日練習'], 'sleep']);
  fail = false;
  f.root.querySelector('.ui-empty-go').click(); await settle();
  eq([f.root.querySelectorAll('li').length, f.dom.doc.activeElement && f.dom.doc.activeElement.tagName], [24, 'H1']);
};

/* ---------- 每週堂數、本週一列、獨立小檢核、程度調整 ---------- */
const weekOf = (e) => { const p = card(e).querySelector('.lsn-week'); return p ? [p.textContent, !!p.querySelector('button')] : null; };
T['本週一列:主按鈕下面一行不可點;還沒選堂數時接「設定堂數」,打開面板(沒有下週起生效),選每週 1 堂套用後重畫、按鈕不見、{d} / {t} 跟著變'] = async () => {
  const e = await open({ seed: pilotSeed() });
  eq(weekOf(e), ['本週　完成 2 / 2 堂　練習 2 / 2 天設定堂數', true]);
  const c = card(e), kids = c.children;
  eq([kids.indexOf(c.querySelector('.lsn-week')) > kids.indexOf(c.querySelector('.lsn-home-go')), c.querySelector('.lsn-week').querySelectorAll('a').length], [true, 0]);
  c.querySelector('.lsn-week-set').click(); await settle();
  const s = e.sheets[0];
  eq([s.opt.title, s.opt.note], ['每週堂數', null]);
  const one = s.el.querySelectorAll('input')[1];
  one.checked = true; (one.on.change || []).forEach((f) => f({}));
  s.el.querySelector('.ob-apply').click(); await settle();
  eq([weekOf(e), textOf(card(e), '.lsn-home-all'), JSON.parse(e.ls.get(PRE + 'plan')).perWeek], [['本週　完成 1 / 1 堂　練習 2 / 1 天', false], '1 / 12 堂', [{ w: 1, n: 1 }]]);
};
T['獨立小檢核那一列:每週 1 堂、第 4 堂沒上、到第 5 堂建議日期,卡片最上面一列連到 cp=1;主按鈕照舊是下一個必上堂;總覽的課後練習'] = async () => {
  const plan = Object.assign({}, PLAN, { startDate: '2026-11-08', perWeek: [{ w: 1, n: 1 }] });
  const seed = pilotSeed({ levels: Object.assign({}, LV_EE, { listening: 'threshold', reading: 'threshold' }), plan,
    les_t1_01: lessonState(1, NOW - 16 * DAY, true, K.TT), les_t1_02: null, les_t1_03: lessonState(3, NOW - 9 * DAY, true, K.TT) });
  const e = await open({ seed });
  const c = card(e), solo = c.querySelector('.lsn-solo');
  eq([c.children.indexOf(solo) > -1 && c.children.indexOf(solo) <= 1, textOf(solo, 'a'), solo.querySelector('a').getAttribute('href'), textOf(c, '.lsn-home-go')],
    [true, '第 4 堂小檢核18 分鐘', 'lesson.html?no=4&cp=1', '開始第 5 堂']);
  const l = await open({ page: 'lessons', seed });
  eq([rows(l)[1].text.slice(-4), rows(l)[1].mark, rows(l)[3].text.slice(-4), textOf(l.root, '.lsn-tags')], ['課後練習', 'lsn-mark is-todo', '課後練習', '2 / 12 堂']);
};
T['每週上幾堂:第 1 堂上完、還沒問過(上線前的 plan 沒有這個欄位)開課程總覽先出這一頁;選了寫 plan、接著畫總覽;首頁不出'] = async () => {
  const old = Object.assign({}, PLAN);
  delete old.weeklyAskedAt;
  const e = await open({ page: 'lessons', seed: pilotSeed({ plan: old }) });
  eq([textOf(e.root, 'h2'), e.root.querySelectorAll('.ob-choice').length, !!e.root.querySelector('.lsn-list'), e.dom.doc.activeElement && e.dom.doc.activeElement.tagName], ['每週上幾堂', 2, false, 'H2']);
  e.root.querySelectorAll('.ob-choice')[1].click(); await settle();
  const p = JSON.parse(e.ls.get(PRE + 'plan'));
  eq([p.perWeek, !!p.weeklyAskedAt, e.root.querySelectorAll('.lsn-list li').length], [[{ w: 1, n: 1 }], true, 24]);
  const later = await open({ page: 'lessons', seed: pilotSeed({ plan: old }) });
  later.root.querySelector('.lsn-weekly-later .btn-text').click(); await settle();
  const lp = JSON.parse(later.ls.get(PRE + 'plan'));
  eq([lp.perWeek, !!lp.weeklyAskedAt, later.root.querySelectorAll('.lsn-list li').length], [undefined, true, 24]);
  const home = await open({ seed: pilotSeed({ plan: old }) });
  eq([!!home.grid.querySelector('.ob-choice'), !!card(home)], [false, true], '首頁不出');
};
T['程度調整:本期調整過而且有變、第 5 堂還沒開始,課程總覽的卡下面、清單上面出一塊(有變的科一列、ⓘ);首頁不出'] = async () => {
  const lv = Object.assign({}, LV_EE, { listening: 'threshold', source: { listening: 'calibrate', reading: 'score' }, history: [
    { at: '2026-11-01T00:00:00.000Z', listening: 'entry', reading: 'entry', reason: 'score' }, { at: '2026-11-23T00:00:00.000Z', listening: 'threshold', reading: 'entry', reason: 'calibrate' }] });
  const e = await open({ page: 'lessons', seed: pilotSeed({ levels: lv }) });
  const kids = e.root.children, s = e.root.querySelector('.lsn-calib');
  eq([kids.indexOf(s) > kids.indexOf(card(e)), kids.indexOf(s) < kids.indexOf(e.root.querySelector('.lsn-list')), textOf(s, 'h2'), s.querySelectorAll('li').map((x) => x.textContent), !!s.querySelector('.lsn-info')],
    [true, true, '程度調整', ['聽力入門 → 門檻'], true]);
  eq(!!(await open({ seed: pilotSeed({ levels: lv }) })).grid.querySelector('.lsn-calib'), false, '首頁不出');
  const five = await open({ page: 'lessons', seed: pilotSeed({ levels: lv, les_t1_05: lessonState(5, NOW - 600, ['vocab']) }) });
  eq(!!five.root.querySelector('.lsn-calib'), false, '第 5 堂開始了不出');
};

/* ---------- 檔案 ---------- */
T['檔案:index.html 只多 packs-config.js(plans-config 後)與 lesson-home.js(onboard-ui 後)兩個 script、沒有課程的畫面元素;兩支新檔不到 800 行'] = () => {
  const s = K.read('index.html');
  const src = Array.from(s.matchAll(/<script src="([^"]+)"/g)).map((m) => m[1]);
  eq([src[src.indexOf('js/plans-config.js') + 1], src[src.indexOf('js/onboard-ui.js') + 1]], ['js/packs-config.js', 'js/lesson-home.js']);
  assert.equal(/lsn-|lesson-(?!home\.js)/.test(s.replace(/<script src="js\/lesson-home\.js"><\/script>/, '')), false, '首頁不寫課程的節點');
  const st = Array.from(K.read('start.html').matchAll(/<script src="([^"]+)"/g)).map((m) => m[1]);
  assert.ok(st.indexOf('js/packs-config.js') === st.indexOf('js/plans-config.js') + 1 && st.indexOf('js/lesson-home.js') < st.indexOf('js/onboard-core.js'));
  ['js/lesson-home.js', 'js/lessons.js', 'tools/test_lesson_home.js'].forEach((f) => assert.ok(K.read(f).split('\n').length <= 800, f));
};

K.run(T);
