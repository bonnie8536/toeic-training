/* start.html 的畫面行為(js/onboard.js):用假 DOM、假 history 把五個檔(common、onboard-core、onboard-data、onboard-ui、onboard)
   真的載進沙盒,點按鈕、按方向鍵、送出表單,看換到哪一步、畫了什麼、存了什麼。不開瀏覽器、不連網。
   共用元件(js/ui.js)換成假的:UI.confirm 畫成 .modal-mask(標題、取消、確定),UI.result、UI.sheet 照參數畫最少的節點,參數另外記下來比對
   (起始焦點這類真的 js/ui.js 行為在 tools/test_ui.js)。
   用法:node tools/test_onboard_screens.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const J = JSON.stringify;
const MIN = 60e3, DAY = 864e5;
const NOW = Date.parse('2026-11-19T12:00:00+08:00');
const NOW_ISO = new Date(NOW).toISOString();
const UID = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72';
const CPID = 'c' + UID.replace(/-/g, '');
const PRE = 'tr_u' + CPID + '_';
const G_KEY = 'tr_onboard_guest';
const NONCE = 'abcdefghij0123456789';
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(J(a)), JSON.parse(J(b)), m);
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };

/* ---------- 假 DOM ---------- */
function parseSimple(s) {
  const tag = (/^[a-z0-9]+/i.exec(s) || [''])[0].toUpperCase();
  const cls = (s.match(/\.[\w-]+/g) || []).map((x) => x.slice(1));
  const attr = /\[([\w-]+)\]/.exec(s);
  return { tag, cls, attr: attr ? attr[1] : null, other: /\[[\w-]+[*^$]?=/.test(s) };
}
function matches(n, simple) {
  if (n.nodeType !== 1) return false;
  const p = parseSimple(simple);
  if (p.other) return false;
  if (p.tag && n.tagName !== p.tag) return false;
  const have = n.className.split(' ');
  if (p.cls.some((c) => have.indexOf(c) < 0)) return false;
  if (p.attr && !(p.attr in n.attrs)) return false;
  return true;
}
function makeDom(win) {
  const doc = { on: {} };
  class N {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.nodeType = tag === '#text' ? 3 : 1; this.children = []; this.parentNode = null;
      this.attrs = {}; this.className = ''; this._t = ''; this.on = {}; this.hidden = false; this.disabled = false; this._v = undefined;
    }
    get classList() {
      const cls = () => this.className.split(' ').filter(Boolean);
      return { contains: (c) => cls().indexOf(c) > -1, add: (c) => { if (cls().indexOf(c) < 0) this.className = cls().concat([c]).join(' '); },
        remove: (c) => { this.className = cls().filter((x) => x !== c).join(' '); },
        toggle: (c, on) => { const want = on === undefined ? cls().indexOf(c) < 0 : !!on; if (want) this.classList.add(c); else this.classList.remove(c); } };
    }
    get value() {
      if (this.tagName === 'SELECT') { if (this._v !== undefined) return this._v; const o = this.children.find((c) => c.tagName === 'OPTION'); return o ? o.attrs.value : ''; }
      return this._v === undefined ? '' : this._v;
    }
    set value(v) {
      v = String(v);
      if (this.tagName === 'SELECT') this._v = this.children.some((c) => c.tagName === 'OPTION' && c.attrs.value === v) ? v : '';
      else this._v = v;
    }
    append(...ns) { ns.forEach((n) => { if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.children.push(n); if (n.tagName === 'SCRIPT' && this.tagName === 'HEAD') win.__loadScript(n); }); }
    prepend(...ns) { ns.reverse().forEach((n) => { if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.children.unshift(n); }); }
    scrollIntoView() {}
    _rm(c) { const i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); c.parentNode = null; }
    remove() { if (this.parentNode) this.parentNode._rm(this); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
    removeEventListener(t, f) { this.on[t] = (this.on[t] || []).filter((x) => x !== f); }
    focus() { doc.activeElement = this; }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    closest(sel) { let n = this; while (n) { if (matches(n, sel)) return n; n = n.parentNode; } return null; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.documentElement; }
    get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._t = String(v); }
    set innerHTML(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._t = ''; }
    all() { const out = []; const w = (n) => { n.children.forEach((c) => { out.push(c); w(c); }); }; w(this); return out; }
    querySelectorAll(sel) {
      return this.all().filter((n) => sel.split(',').some((part) => {
        const chain = part.trim().split(/\s+/);
        if (!matches(n, chain[chain.length - 1])) return false;
        if (chain.length === 1) return true;
        let a = n.parentNode;
        while (a && a !== this.parentNode) { if (matches(a, chain[0])) return true; a = a.parentNode; }
        return false;
      }));
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    click() {
      if (this.disabled) return;
      fire(this, 'click');
      if (this.tagName === 'BUTTON' && this.attrs.type === 'submit') { const f = this.closest('form'); if (f) fire(f, 'submit'); }
    }
  }
  function fire(node, type, extra) {
    const ev = Object.assign({ type, target: node, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }, extra || {});
    for (let n = node; n; n = n.parentNode) (n.on[type] || []).slice().forEach((f) => f(Object.assign(ev, { currentTarget: n })));
    return ev;
  }
  const html = new N('html');
  const head = new N('head'); const body = new N('body'); html.append(head, body);
  /* 同 start.html:main 裡面一個 #ob-root(共用元件沒載到的那一塊放在 main 最前面,不在 #ob-root 裡) */
  const main = new N('main'); body.append(main);
  const root = new N('div'); root.attrs.id = 'ob-root'; main.append(root);
  Object.assign(doc, {
    documentElement: html, head, body, activeElement: null, title: '',
    createElement: (t) => new N(t),
    createTextNode: (t) => { const n = new N('#text'); n._t = String(t); return n; },
    addEventListener: (t, f) => { (doc.on[t] = doc.on[t] || []).push(f); },
    removeEventListener: (t, f) => { doc.on[t] = (doc.on[t] || []).filter((x) => x !== f); },
    getElementById: (id) => html.all().find((n) => n.attrs.id === id) || null,
    querySelector: (s) => html.querySelector(s), querySelectorAll: (s) => html.querySelectorAll(s),
  });
  return { doc, root, body, fire };
}

/* ---------- 假的共用元件(js/ui.js) ---------- */
function fakeUI(e, doc) {
  e.confirms = []; e.sheets = []; e.results = []; e.mounts = 0; e.destroyed = 0;
  const node = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n._t = String(text); return n; };
  const button = (cls, text, onClick) => { const b = node('button', cls, text); b.setAttribute('type', 'button'); b.addEventListener('click', onClick); return b; };
  return {
    mount: () => { e.mounts++; },
    /* 確定回 true;取消、Esc、點遮罩回 false(mask.esc() 模擬 Esc) */
    confirm: (o) => new Promise((resolve) => {
      e.confirms.push(o);
      const mask = node('div', 'modal-mask ui-mask');
      const done = (v) => { mask.remove(); resolve(v); };
      mask.esc = () => done(false);
      const body = node('p', 'ui-dialog-body', o.body && o.body.nodeType ? null : o.body || '');
      if (o.body && o.body.nodeType) body.append(o.body);   // 內文可以是節點(js/ui.js 照樣接上)
      mask.append(node('h2', 'ui-dialog-h', o.title), body,
        button('btn-text ui-dialog-cancel', o.cancel || '取消', () => done(false)),
        button('btn primary ui-dialog-ok' + (o.danger ? ' is-danger' : ''), o.ok || '確定', () => done(true)));
      doc.body.append(mask);
    }),
    sheet: (o) => {
      const el = node('div', 'modal ui-sheet');
      const api = { el, opt: o, open: true, close: () => { api.open = false; el.remove(); } };
      el.append(node('h2', 'ui-sheet-h', o.title), button('btn-text ui-sheet-close', '關閉', () => api.close()));
      (o.nodes || []).forEach((n) => el.append(n));
      doc.body.append(el);
      e.sheets.push(api);
      return api;
    },
    result: (o) => {
      e.results.push(o);
      const card = node('section', 'result-card');
      const heading = node('h2', 'result-score', o.big);
      const stats = node('dl', 'result-stats');
      (o.stats || []).forEach((x) => { const d = node('div', 'result-stat'); d.append(node('dt', null, x[0]), node('dd', null, x[1])); stats.append(d); });
      card.append(heading, stats);
      if (o.primary) { const a = node('a', 'btn primary result-go', o.primary.label); a.setAttribute('href', o.primary.href); card.append(a); }
      (o.links || []).filter(Boolean).forEach((l) => card.append(button('btn-text result-link', l.label, (ev) => l.onClick(ev))));
      if (o.note) card.append(node('p', 'result-note', o.note));
      return { el: card, heading, reward: node('div'), destroy: () => { e.destroyed++; } };
    },
  };
}

/* ---------- 沙盒 ---------- */
/* opt:url(開頁網址)、signed(已登入)、init(localStorage)、session(sessionStorage)、folderReady、teacherQuery('fail')、
   join(假 CLASSES.api.join 的結果)、diagFail(data/diagnostic.js 載不到)、estFail(題目難度與估分的檔載不到)、paid(window.PAID_UI)、noUi(共用元件沒載到)、
   waitCloud(已登入、雲端元件一直沒載完) */
async function open(opt) {
  opt = opt || {};
  const ls = opt.ls || new Map(Object.entries(opt.init || {}));
  ls.delete('tr_current_profile');
  if (opt.signed) ls.set('tr_current_profile', J(CPID));
  const ss = opt.ss || new Map(Object.entries(opt.session || {}));
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } }
  FakeDate.now = () => NOW;
  const win = { on: {} };
  const dom = makeDom(win);
  const e = { ls, ss, dom, replaced: [], hrefs: [], reloads: 0, asked: 0, cards: [], joins: [], pushed: [] };
  const entries = [{ state: null, url: opt.url || 'start.html' }];
  let idx = 0;
  const cur = () => entries[idx].url;
  const history = {
    get state() { return entries[idx].state; },
    pushState: (s, t, u) => { entries.splice(idx + 1); entries.push({ state: s, url: u }); idx++; },
    replaceState: (s, t, u) => { entries[idx] = { state: s, url: u }; },
    back: () => { if (idx === 0) return; idx--; setImmediate(() => (win.on.popstate || []).forEach((f) => f({ state: entries[idx].state }))); },
  };
  const location = {
    get search() { const i = cur().indexOf('?'); return i < 0 ? '' : cur().slice(i); },
    get href() { return 'https://example.test/' + cur(); },
    set href(u) { e.hrefs.push(u); },
    replace: (u) => { e.replaced.push(u); },
    reload: () => { e.reloads++; },
  };
  const user = opt.signed ? { id: UID, created_at: new Date(NOW - 30 * DAY).toISOString() } : null;
  const teacherRows = opt.teacherQuery === 'fail' ? { data: null, error: { message: 'x' } } : { data: [], error: null };
  const ctx = Object.assign(win, {
    console: { warn() {}, log() {}, error() {} }, JSON, Date: FakeDate, Object, Array, Set, Map, WeakSet, Math, String, Number, Promise,
    URLSearchParams, URL, Uint32Array, crypto: require('crypto').webcrypto, setTimeout, clearTimeout, setImmediate,
    document: dom.doc, history, location, navigator: { onLine: true }, scrollTo() {},
    addEventListener: (t, f) => { (win.on[t] = win.on[t] || []).push(f); },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: (k) => { ls.delete(k); },
      get length() { return ls.size; }, key: (i) => [...ls.keys()][i] || null },
    sessionStorage: { getItem: (k) => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => { ss.set(k, String(v)); }, removeItem: (k) => { ss.delete(k); } },
    MutationObserver: class { observe() {} }, PAID_UI: opt.paid === true,
  });
  ctx.window = ctx;
  /* 頁面要用時才載的檔:照網址載真的檔(data/diagnostic.js 不記在 loads) */
  ctx.__loadScript = (s) => setImmediate(() => {
    const diagFile = s.src === 'data/diagnostic.js';
    if ((diagFile && opt.diagFail) || (opt.estFail && /estimate|item-params/.test(s.src))) { s.onerror(); return; }
    if (!diagFile) e.loads.push(s.src);
    vm.runInContext(read(s.src), ctx, { filename: s.src });
    s.onload();
  });
  if (opt.waitCloud) ctx.__PROFILE_ID = CPID;   // 已登入、雲端元件還沒載完(CLOUD.ready 一直沒好)
  ctx.CLOUD = { enabled: true, user, isTeacher: false, reloading: false, authReturning: false, ready: opt.waitCloud ? new Promise(() => {}) : Promise.resolve(user),
    push: (k) => e.pushed.push(k), folderReady: () => opt.folderReady !== false,
    client: { from: () => ({ select: () => ({ eq: () => Promise.resolve(teacherRows) }) }) } };
  ctx.PROFILE = {
    showLogin: () => { e.logins = (e.logins || 0) + 1; },
    askToAct: () => { e.asked++; },
    accountGone: () => {},
    buildAuthCard: (o) => {
      e.cards.push(o);
      const d = dom.doc;
      const f = d.createElement('form'); f.className = 'auth-card';
      const g = d.createElement('button'); g.className = 'btn-google'; g.setAttribute('type', 'button'); g._t = '使用 Google 帳號繼續';
      f.append(g);
      return f;
    },
  };
  const formatError = (c) => (!c ? '請輸入邀請碼。' : /[^A-Z0-9]/.test(c) ? '邀請碼只有英文字母和數字。' : c.length !== 8 ? '邀請碼是 8 碼，現在是 ' + c.length + ' 碼。' : '');
  const normalize = (s) => String(s == null ? '' : s).replace(/[\s-]/g, '').toUpperCase();
  ctx.CLASSES = {
    pending: { take: () => { const v = ls.get('tr_pending_join'); ls.delete('tr_pending_join'); return v ? JSON.parse(v).code : null; },
      save: (c) => ls.set('tr_pending_join', J({ code: c, at: NOW })) },
    api: { normalize, check: (raw) => formatError(normalize(raw)),
      join: (c) => { e.joins.push(c); return Promise.resolve(opt.join || { ok: true, name: '週三班' }); },
      list: () => { e.lists = (e.lists || 0) + 1; return opt.membership || Promise.resolve({ ok: true, classes: [] }); } },
  };
  const ui = fakeUI(e, dom.doc);
  ctx.UI = opt.noUi ? undefined : ui;   // noUi:js/ui.js 沒載到(請求被擋)
  /* lesson:試行班的開關與名單(課程的檔照 start.html 的順序載,其他課程檔在背後依序載進來;學習包從 data/packs 讀) */
  e.loads = [];
  if (opt.lesson) {
    Object.assign(ctx, { PACKS_UI: 'pilot', PACKS_PILOT_CLASSES: ['class-a'], TextEncoder, RegExp, Error, TypeError, Boolean,
      fetch: (u) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(read(u))) }) });
  }
  vm.createContext(ctx);
  /* 同 start.html:估分的兩個核心檔每一頁都載(js/estimate-store.js、data/item-params.js 要用時才載) */
  (opt.lesson ? ['js/common.js', 'js/sync-merge.js', 'js/sync-merge-lesson.js', 'js/lesson-home.js'] : ['js/common.js'])
    .concat(['js/estimate-core.js', 'js/estimate-data.js', 'js/estimate-ui.js', 'js/onboard-core.js', 'js/onboard-data.js', 'js/onboard-ui.js', 'js/onboard.js']).forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  (dom.doc.on.DOMContentLoaded || []).forEach((f) => f({}));
  await settle();
  return Object.assign(e, {
    ctx, root: dom.root,
    step: () => new URLSearchParams(location.search).get('step') || 'start',
    h1: () => { const n = dom.root.querySelector('h1') || dom.root.querySelector('.result-score'); return n ? n.textContent : null; },
    find: (t) => dom.doc.documentElement.all().find((n) => (n.tagName === 'BUTTON' || n.tagName === 'A') && n.textContent === t) || null,
    press: async (t) => { const n = e.find(t); assert.ok(n, '找不到按鈕「' + t + '」'); n.click(); await settle(); },
    guest: () => (ls.has(G_KEY) ? JSON.parse(ls.get(G_KEY)) : null),
    acct: (k) => (ls.has(PRE + k) ? JSON.parse(ls.get(PRE + k)) : null),
    dialogTitle: () => { const m = dom.doc.querySelector('.modal-mask'); return m ? m.querySelector('h2').textContent : null; },
    mask: () => dom.doc.querySelector('.modal-mask'),
    fire: dom.fire,
  });
}
const guestKey = (over) => J(Object.assign({ v: 1, createdAt: NOW - 10 * MIN, expiresAt: NOW - 10 * MIN + 7 * DAY, step: 'level', targetScore: 600,
  examMonth: '2027-03', scoreDraft: null, pendingAction: null, authStartedAt: null, authNonce: null }, over || {}));
const pendingGuest = (act, over) => guestKey(Object.assign({ pendingAction: act, authStartedAt: NOW - 2 * MIN, authNonce: NONCE,
  scoreDraft: act === 'score' ? { listening: '325', reading: '270', total: '', examYm: '2026-05', fromTotal: false } : null }, over || {}));
const doneOnboard = (over) => J(Object.assign({ v: 1, status: 'done', step: 'result', path: 'self', targetScore: 600, examMonth: '2027-03',
  levelSource: 'legacy', previous: null, startedAt: NOW_ISO, doneAt: NOW_ISO, updatedAt: NOW_ISO }, over || {}));
const LV = J({ listening: 'advanced', reading: 'threshold', source: { listening: 'legacy_plus1', reading: 'legacy' }, setAt: NOW_ISO,
  history: [{ at: NOW_ISO, listening: 'advanced', reading: 'threshold', reason: 'legacy' }] });

const T = {};

T['P1 訪客在 S3 按「不確定，幫我測」「我是初學，從入門開始」:先到登入卡並記 pendingAction;「返回」清掉、回 S3,答案還在'] = async () => {
  for (const [label, act] of [['不確定，幫我測', 'test'], ['我是初學，從入門開始', 'entry']]) {
    const e = await open({ url: 'start.html?step=level', init: { [G_KEY]: guestKey() } });
    eq([e.step(), e.h1()], ['level', '你的英文程度']);
    await e.press(label);
    eq([e.step(), e.h1(), e.guest().pendingAction, e.cards.length], ['signup', '建立帳號', act, 1]);
    assert.equal(e.cards[0].backTo, 'start.html?step=resume');
    assert.equal(e.ss.get('ob_auth_nonce'), e.guest().authNonce, '隨機碼兩邊一樣');
    await e.press('返回');
    eq([e.step(), e.h1(), e.guest().pendingAction, e.guest().authNonce], ['level', '你的英文程度', null, null]);
    eq([e.guest().targetScore, e.guest().examMonth], [600, '2027-03']);
    assert.ok(!e.ss.has('ob_auth_nonce'));
    eq([...e.ls.keys()].filter((k) => /^tr_u/.test(k)), [], '訪客不寫帳號的鍵');
  }
};

T['P2 訪客在 S3a 分開填按 Enter(表單送出):到登入卡,草稿存在訪客暫存;「返回」回 S3a,欄位值還在'] = async () => {
  const e = await open({ url: 'start.html?step=level', init: { [G_KEY]: guestKey() } });
  await e.press('我有多益成績');
  eq([e.step(), e.h1()], ['score', '輸入多益成績']);
  const form = e.root.querySelector('form');
  const submit = e.find('送出');
  assert.ok(submit && submit.attrs.type === 'submit' && form.contains(submit), '「送出」在表單裡、type=submit');
  const byId = (id) => e.ctx.document.getElementById(id);
  byId('ob-l').value = '325'; byId('ob-r').value = '270'; byId('ob-ym').value = '2026-05';
  e.fire(form, 'submit');
  await settle();
  eq([e.step(), e.guest().pendingAction, e.guest().scoreDraft.listening, e.guest().scoreDraft.reading, e.guest().scoreDraft.examYm], ['signup', 'score', '325', '270', '2026-05']);
  await e.press('返回');
  eq([e.step(), byId('ob-l').value, byId('ob-r').value, byId('ob-ym').value, e.guest().pendingAction], ['score', '325', '270', '2026-05', null]);
};

T['P3 S3a 填錯不送出:錯誤訊息貼在欄位、焦點移到第一個錯的欄位,考試年月錯時也有 aria-describedby'] = async () => {
  const e = await open({ url: 'start.html?step=score', init: { [G_KEY]: guestKey({ step: 'score' }) } });
  const byId = (id) => e.ctx.document.getElementById(id);
  byId('ob-l').value = '4'; byId('ob-r').value = '270';
  await e.press('送出');
  eq([e.step(), e.guest().pendingAction], ['score', null]);
  assert.equal(e.ctx.document.activeElement, byId('ob-l'));
  eq([byId('ob-l').attrs['aria-invalid'], byId('ob-l').attrs['aria-describedby']], ['true', 'ob-l-note']);
  eq([byId('ob-ym').attrs['aria-invalid'], byId('ob-ym').attrs['aria-describedby'], byId('ob-ym-note').textContent], ['true', 'ob-ym-note', '請選擇考試年月']);
};

T['P4 單選卡片:方向鍵只移焦點與 tabindex,aria-checked 不變、不前進;點了才選定'] = async () => {
  const e = await open({ url: 'start.html?step=target', init: { [G_KEY]: guestKey({ step: 'target', targetScore: null }) } });
  const box = e.root.querySelector('.ob-choices');
  const items = box.querySelectorAll('.ob-choice');
  assert.equal(items.length, 5);
  items[0].focus();
  e.fire(box, 'keydown', { key: 'ArrowDown' });
  assert.equal(e.ctx.document.activeElement, items[1]);
  eq(items.map((x) => x.attrs['aria-checked']), ['false', 'false', 'false', 'false', 'false']);
  eq(items.map((x) => x.attrs.tabindex), ['-1', '0', '-1', '-1', '-1']);
  e.fire(box, 'keydown', { key: 'ArrowUp' }); e.fire(box, 'keydown', { key: 'ArrowUp' });
  assert.equal(e.ctx.document.activeElement, items[4], '往上繞到最後一個');
  eq([e.step(), e.guest().targetScore], ['target', null]);
  items[1].click(); await settle();
  eq([e.step(), e.guest().targetScore], ['exam', 600]);
  assert.equal(e.root.querySelector('.ob-progress').attrs['aria-label'], '第 2 題，共 3 題');
};

/* 結算卡標題旁 ⓘ 的資訊欄:起始程度怎麼來的(沒有 ⓘ 回 null) */
const levelInfo = (e) => {
  const b = e.root.querySelector('.result-score').querySelector('.est-info');
  if (!b) return null;
  b.click();
  const sh = e.sheets[e.sheets.length - 1];
  return [b.attrs['aria-label'], sh.opt.title].concat((sh.opt.nodes || []).map((n) => n.textContent));
};
T['P5 接回 test、entry、score:寫進帳號、刪訪客暫存、到 S4 或 S8;S8 標題旁 ⓘ 依來源寫一句(卡片上不掛小字)、次按鈕「做檢測」'] = async () => {
  const t = await open({ url: 'start.html?step=resume', signed: true, init: { [G_KEY]: pendingGuest('test') }, session: { ob_auth_nonce: NONCE } });
  eq([t.step(), t.h1(), t.guest(), t.acct('onboard').step, t.acct('onboard').targetScore], ['test', '程度檢測', null, 'test', 600]);
  assert.ok(t.find('開始檢測') && t.find('先跳過，從入門開始'));

  const n = await open({ url: 'start.html?step=resume', signed: true, init: { [G_KEY]: pendingGuest('entry') }, session: { ob_auth_nonce: NONCE } });
  eq([n.step(), n.h1(), n.acct('levels').listening, n.acct('levels').reading, n.acct('onboard').status], ['result', '你的起始程度', 'entry', 'entry', 'done']);
  assert.equal(n.find('開始練習').attrs.href, 'grammar.html');
  assert.ok(n.find('改程度') && n.find('做檢測') && !n.find('重新檢測'));
  assert.ok(!/依你填的|依閱讀/.test(n.root.textContent));
  eq(levelInfo(n), null, '從入門開始:沒有來源要說明,不畫 ⓘ');

  const s = await open({ url: 'start.html?step=resume', signed: true, init: { [G_KEY]: pendingGuest('score') }, session: { ob_auth_nonce: NONCE } });
  eq([s.step(), s.acct('self_score').listening, s.acct('self_score').reading, s.acct('levels').listening, s.acct('levels').reading],
    ['result', 325, 270, 'advanced', 'threshold']);
  assert.ok(!/依你填的/.test(s.root.textContent), '卡片上不掛小字');
  eq(levelInfo(s), ['起始程度說明', '起始程度', '這個程度是依你填的多益成績定的。']);
  assert.equal(s.find('開始練習').attrs.href, 'practice.html?part=5');
};

/* X1 內文的兩行 */
const x1Lines = (e) => e.mask().querySelector('.ui-dialog-body').querySelectorAll('.ob-line').map((n) => n.textContent);
T['P6 接回 X1:帳號已有設定出確認視窗(UI.confirm),兩行列出帳號的設定與剛才的答案;起始焦點在「保留設定」(取消那顆、不是紅色),按了不改任何鍵、回首頁'] = async () => {
  const init = { [G_KEY]: pendingGuest('entry'), [PRE + 'onboard']: doneOnboard(), [PRE + 'levels']: LV };
  const e = await open({ url: 'start.html?step=resume', signed: true, init: Object.assign({}, init), session: { ob_auth_nonce: NONCE } });
  assert.equal(e.dialogTitle(), '這個帳號已有學習設定');
  const c = e.confirms[0];
  eq([c.ok, c.cancel, c.danger, c.focusCancel], ['改用剛才的答案', '保留設定', undefined, true]);
  eq(x1Lines(e), ['帳號的設定：聽力 進階／閱讀 門檻', '剛才的答案：目標 600 分／從入門開始']);
  await e.press('保留設定');
  eq([e.replaced, e.ls.get(PRE + 'levels'), e.ls.get(PRE + 'onboard'), e.guest()], [['index.html'], LV, doneOnboard(), null]);
  /* 剛才的答案照訪客暫存:目標還不確定、選幫我測 */
  const t = await open({ url: 'start.html?step=resume', signed: true, session: { ob_auth_nonce: NONCE },
    init: { [G_KEY]: pendingGuest('test', { targetScore: null }), [PRE + 'onboard']: doneOnboard(), [PRE + 'levels']: LV } });
  eq(x1Lines(t)[1], '剛才的答案：目標 還不確定／幫我測');
};
T['P6b X1:Esc、點遮罩等於「保留設定」;「改用剛才的答案」照寫,舊值存進 previous'] = async () => {
  const init = { [G_KEY]: pendingGuest('entry'), [PRE + 'onboard']: doneOnboard(), [PRE + 'levels']: LV };
  const k = await open({ url: 'start.html?step=resume', signed: true, init: Object.assign({}, init), session: { ob_auth_nonce: NONCE } });
  k.mask().esc(); await settle();
  eq([k.replaced, k.ls.get(PRE + 'levels'), k.guest()], [['index.html'], LV, null]);
  const e = await open({ url: 'start.html?step=resume', signed: true, init, session: { ob_auth_nonce: NONCE } });
  await e.press('改用剛才的答案');
  eq([e.step(), e.acct('levels').reading, e.acct('onboard').status, e.acct('onboard').previous.onboard.status], ['result', 'entry', 'done', 'done']);
};
T['P6c 共用元件沒載到:接回到 X1、帶入確認、S8 都不丟錯,出「共用元件沒載到」與重新整理;訪客暫存與帳號都不動'] = async () => {
  const init = () => ({ [G_KEY]: pendingGuest('entry'), [PRE + 'onboard']: doneOnboard(), [PRE + 'levels']: LV });
  const x = await open({ url: 'start.html?step=resume', signed: true, init: init(), session: { ob_auth_nonce: NONCE }, noUi: true });
  eq([!!x.ctx.document.querySelector('.ui-missing'), !!x.find('重新整理'), x.root.textContent, x.ls.get(G_KEY), x.ls.get(PRE + 'levels'), x.replaced],
    [true, true, '', init()[G_KEY], LV, []]);
  const imp = await open({ url: 'start.html?step=resume', signed: true, init: { [G_KEY]: pendingGuest('score') }, noUi: true });
  eq([!!imp.find('重新整理'), imp.root.textContent, imp.guest().pendingAction, imp.acct('onboard')], [true, '', 'score', null]);
  const r = await open({ url: 'start.html?step=result', signed: true, init: { [PRE + 'onboard']: doneOnboard(), [PRE + 'levels']: LV }, noUi: true });
  eq([!!r.find('重新整理'), r.results.length, r.acct('levels')], [true, 0, JSON.parse(LV)]);
};
T['P7 共用電腦:隨機碼不在這個分頁 → 先問要不要帶入;「不用」刪訪客暫存、不寫帳號、回首頁'] = async () => {
  const e = await open({ url: 'start.html?step=resume', signed: true, init: { [G_KEY]: pendingGuest('score') } });
  assert.equal(e.dialogTitle(), '要帶入這台裝置上填的答案嗎？');
  assert.ok(/600 分/.test(e.ctx.document.querySelector('.modal-mask').textContent));
  assert.ok(!/325|270/.test(e.ctx.document.querySelector('.modal-mask').textContent), '成績不列、不帶');
  await e.press('不用');
  eq([e.replaced, e.guest(), e.acct('onboard'), e.acct('self_score'), e.acct('levels')], [['index.html'], null, null, null, null]);

  const y = await open({ url: 'start.html?step=resume', signed: true, init: { [G_KEY]: pendingGuest('score') } });
  await y.press('帶入');
  eq([y.step(), y.acct('onboard').targetScore, y.acct('self_score'), y.acct('levels')], ['score', 600, null, null], '帶入只帶目標與月份,成績在 S3a 重填');
};

T['P8 接回失敗:資料夾還不能用出「重新整理」;查不到是不是老師出「重試」,重試回接回'] = async () => {
  const b = await open({ url: 'start.html?step=resume', signed: true, folderReady: false, init: { [G_KEY]: pendingGuest('test') }, session: { ob_auth_nonce: NONCE } });
  eq([b.h1(), !!b.find('重新整理'), b.guest().pendingAction], ['還沒載入你的練習紀錄', true, 'test']);
  await b.press('重新整理');
  assert.equal(b.reloads, 1);

  const f = await open({ url: 'start.html?step=resume', signed: true, teacherQuery: 'fail', init: { [G_KEY]: pendingGuest('test') }, session: { ob_auth_nonce: NONCE } });
  eq([f.h1(), f.acct('onboard'), f.guest().pendingAction], ['載入失敗', null, 'test']);
  await f.press('重試');
  eq([f.step(), f.h1()], ['resume', '載入失敗']);
};

T['P8b 等雲端、算級別時:一行小字「載入中…」,不畫頁面大標'] = async () => {
  const w = await open({ url: 'start.html?step=resume', signed: true, waitCloud: true });
  const p = w.root.querySelector('p');
  eq([w.h1(), w.root.textContent, p && p.className, p && p.getAttribute('role')], [null, '載入中…', 'result-note ob-loading', 'status']);
};

T['P9 接回班級:有暫存碼且是這個分頁發起的 → 自動加入、到 S4 並顯示已加入;加入失敗留在 C1 顯示原因'] = async () => {
  const init = { [G_KEY]: pendingGuest('join'), tr_pending_join: J({ code: 'ABCD2345', at: NOW - MIN }) };
  const e = await open({ url: 'start.html?step=resume', signed: true, init: Object.assign({}, init), session: { ob_auth_nonce: NONCE } });
  eq([e.joins, e.step(), e.acct('onboard').path, e.guest(), e.ls.has('tr_pending_join')], [['ABCD2345'], 'test', 'class', null, false]);
  assert.ok(/已加入「週三班」。/.test(e.root.textContent));

  const f = await open({ url: 'start.html?step=resume', signed: true, init: Object.assign({}, init), session: { ob_auth_nonce: NONCE },
    join: { ok: false, message: '找不到這個邀請碼。' } });
  eq([f.step(), f.ctx.document.getElementById('ob-join').value, f.ctx.document.getElementById('ob-join-note').textContent, f.acct('onboard')],
    ['join', 'ABCD2345', '找不到這個邀請碼。', null]);
};

T['P10 沒有可接的訪客暫存:直接回首頁,不寫'] = async () => {
  const e = await open({ url: 'start.html?step=resume', signed: true });
  eq([e.replaced, e.acct('onboard')], [['index.html'], null]);
};

T['P11 重新檢測還沒做完就回 S8:回 S4、不記完成;做完後用預估對回級別、記完成,標題旁 ⓘ 寫「依你的程度檢測和之後的練習結果定的」、文字按鈕「重新檢測」;舊報告不刪'] = async () => {
  const oldDiag = J({ answers: {}, done: true, startedAt: '2026-11-01T01:00:00.000Z', finishedAt: '2026-11-01T01:20:00.000Z' });
  const ls = new Map(Object.entries({ [PRE + 'onboard']: doneOnboard(), [PRE + 'levels']: LV, [PRE + 'diag']: oldDiag }));
  const a = await open({ url: 'start.html?step=test', signed: true, ls });
  await a.press('做聽力檢測');   // 只有舊檢測:閱讀已有作答,只做聽力
  eq([a.confirms.length, a.hrefs, a.ls.get(PRE + 'diag'), a.acct('onboard').status, a.acct('onboard').step],
    [0, ['placement.html?start=1&from=onboard&sec=L'], oldDiag, 'in_progress', 'test']);

  /* 到檢測頁後按返回回到 S8 網址:還沒做完 */
  const b = await open({ url: 'start.html?step=result', signed: true, ls });
  eq([b.step(), b.acct('onboard').status, b.acct('onboard').step], ['test', 'in_progress', 'test']);

  /* 做完聽力(晚於 testFrom):聽力用預估的級別,閱讀不動 */
  estDone(ls, 'L', 1);
  const c = await open({ url: 'start.html?step=result', signed: true, ls });
  const lv = c.acct('levels');
  eq([c.step(), c.h1(), lv.listening, lv.reading, lv.source.listening, lv.source.reading, lv.history[lv.history.length - 1].reason, c.acct('onboard').status],
    ['result', '你的起始程度', bandOf(c, 'L'), 'threshold', 'est', 'legacy', 'est', 'done']);
  eq(levelInfo(c).slice(2), ['這個程度是依你的程度檢測和之後的練習結果定的。']);
  assert.ok(c.find('重新檢測') && !c.find('做檢測'));
  eq([c.ls.get(PRE + 'diag'), c.loads], [oldDiag, ['data/item-params.js', 'js/estimate-store.js']], 'js/estimate-ui.js 跟頁面一起載(同 start.html)');
};
T['P12 S8 算級別時題目載不到:「重試」回 S8 重算,不是重跑接回'] = async () => {
  const ls = new Map(Object.entries({
    [PRE + 'onboard']: doneOnboard({ status: 'in_progress', step: 'test', testFrom: NOW_ISO, levelSource: null }),
    [PRE + 'diag']: J({ answers: {}, done: true, startedAt: new Date(NOW + MIN).toISOString(), finishedAt: new Date(NOW + 20 * MIN).toISOString() }) }));
  const e = await open({ url: 'start.html?step=result', signed: true, ls, diagFail: true });
  eq([e.h1(), e.acct('levels'), e.replaced], ['載入失敗', null, []]);
  await e.press('重試');
  eq([e.step(), e.h1(), e.replaced], ['result', '載入失敗', []]);
};

T['P13 S8 結算卡:標題、兩科級別在統計列、不給分數;班級學生不出「你的選擇」;不寫還沒做的課程(沒有「考前可上到第 n 週」)'] = async () => {
  const cls = await open({ url: 'start.html?step=result', signed: true,
    init: { [PRE + 'onboard']: doneOnboard({ path: 'class', targetScore: null, examMonth: null }), [PRE + 'levels']: LV } });
  assert.ok(!/你的選擇|修改/.test(cls.root.textContent));
  const soon = await open({ url: 'start.html?step=result', signed: true,
    init: { [PRE + 'onboard']: doneOnboard({ examMonth: '2027-01' }), [PRE + 'levels']: LV } });
  const r = soon.results[0];
  eq([r.big, r.pose, r.score, r.total, r.stats, r.primary.label, r.links.map((l) => l.label)],
    ['你的起始程度', 'happy', undefined, undefined, [['聽力', '進階'], ['閱讀', '門檻']], '開始練習', ['改程度', '重新檢測']]);
  assert.ok(/你的選擇/.test(soon.root.textContent));
  assert.ok(/目標　600 分/.test(soon.root.textContent) && /考試　2027 年 1 月/.test(soon.root.textContent));
  assert.ok(!/考前可上到|週|課表|學習包/.test(soon.root.textContent), soon.root.textContent);
  /* 換畫面時結算卡收掉(停掉角色) */
  await soon.press('目標　600 分修改');
  eq([soon.step(), soon.destroyed], ['target', 1]);
};
T['P13b S8 試行班:結算卡照原本先畫「開始練習」(不等名單),判定是試行班才換主按鈕;沒有 plan「開始第 1 堂」;有 plan 照首頁卡;不是試行班不換'] = async () => {
  const init = { [PRE + 'onboard']: doneOnboard(), [PRE + 'levels']: LV };
  const go = (e) => { const a = e.root.querySelector('.result-go'); return [a.textContent, a.attrs.href]; };
  const yes = () => Promise.resolve({ ok: true, classes: [{ id: 'class-a' }] });
  const a = await open({ url: 'start.html?step=result', signed: true, init, lesson: true, membership: yes() });
  await settle();
  eq([a.results[0].primary.label, go(a), a.lists], ['開始練習', ['開始第 1 堂', 'lesson.html?no=1'], 1]);
  const yday = Math.floor(NOW / 1000) - 86400, lv = { listening: 'threshold', reading: 'threshold' };
  const half = { v: 1, lessonId: {}, packVersion: {}, levels: lv, startedAt: yday, doneAt: null,
    seg: { test_listening: { st: 'done', t0: yday, t1: yday + 900 }, test_reading: { st: 'todo', t0: null, t1: null } }, pk: {}, a: [] };
  const b = await open({ url: 'start.html?step=result', signed: true, lesson: true,
    init: Object.assign({ [PRE + 'plan']: J({ v: 1, classId: 'class-a', term: 1 }), [PRE + 'les_t1_01']: J(half) }, init) });
  await settle();
  eq([b.results[0].primary.label, go(b), b.lists || 0], ['開始練習', ['繼續第 1 堂', 'lesson.html?no=1'], 0]);
  const n = await open({ url: 'start.html?step=result', signed: true, init, lesson: true, membership: Promise.resolve({ ok: true, classes: [{ id: 'class-b' }] }) });
  await settle();
  eq([go(n), n.lists, n.loads], [['開始練習', 'practice.html?part=5'], 1, ['js/lesson-core.js', 'js/lesson-data.js']]);
};
T['P13c S8 試行班:判定還沒回來就換到別的畫面,舊的結算卡不動、新畫面也不被改'] = async () => {
  let answer;
  const e = await open({ url: 'start.html?step=result', signed: true, lesson: true, membership: new Promise((r) => { answer = r; }),
    init: { [PRE + 'onboard']: doneOnboard(), [PRE + 'levels']: LV } });
  const old = e.root.querySelector('.result-go');
  await e.press('目標　600 分修改');
  answer({ ok: true, classes: [{ id: 'class-a' }] }); await settle();
  eq([e.step(), old.textContent, old.attrs.href, e.lists, e.root.querySelector('.result-go')], ['target', '開始練習', 'practice.html?part=5', 1, null]);
};
T['P14 已登入開 S0:完成的人轉首頁、設定中的人接著中斷的那一步'] = async () => {
  const d = await open({ url: 'start.html', signed: true, init: { [PRE + 'onboard']: doneOnboard(), [PRE + 'levels']: LV } });
  eq(d.replaced, ['index.html']);
  const b = await open({ url: 'start.html', signed: true, init: { [PRE + 'onboard']: doneOnboard({ status: 'in_progress', step: 'exam', levelSource: null, doneAt: null }) } });
  eq(b.replaced, ['start.html?step=exam']);
};

T['P15 C1 訪客:碼合格才存暫存碼與待辦;改成不合格就清掉,離開欄位說原因'] = async () => {
  const e = await open({ url: 'start.html?step=join' });
  const input = e.ctx.document.getElementById('ob-join');
  const note = e.ctx.document.getElementById('ob-join-note');
  assert.ok(/程度檢測結果/.test(e.root.textContent));
  input.value = 'abcd2345'; e.fire(input, 'input');
  eq([JSON.parse(e.ls.get('tr_pending_join')).code, e.guest().pendingAction, e.ss.get('ob_auth_nonce') === e.guest().authNonce], ['ABCD2345', 'join', true]);
  input.value = 'ABC'; e.fire(input, 'input');
  eq([e.ls.has('tr_pending_join'), e.guest().pendingAction, note.textContent], [false, null, '']);
  e.fire(input, 'blur');
  eq([note.textContent, input.attrs['aria-invalid']], ['邀請碼是 8 碼，現在是 3 碼。', 'true']);
};

T['P16 離開登入卡沒送出(pagehide):這個分頁的隨機碼清掉;按了 Google 才離開的留著'] = async () => {
  const a = await open({ url: 'start.html?step=signup', init: { [G_KEY]: pendingGuest('test') } });
  assert.equal(a.step(), 'signup');
  assert.ok(a.ss.get('ob_auth_nonce'));
  (a.ctx.on.pagehide || []).forEach((f) => f({}));
  assert.ok(!a.ss.has('ob_auth_nonce'));
  eq(a.guest().pendingAction, 'test', '訪客暫存留著(換人登入時會先問)');

  const g = await open({ url: 'start.html?step=signup', init: { [G_KEY]: pendingGuest('test') } });
  g.ctx.document.querySelector('.btn-google').click();
  (g.ctx.on.pagehide || []).forEach((f) => f({}));
  assert.equal(g.ss.get('ob_auth_nonce'), g.guest().authNonce);
};

T['P17 訪客直接開 test、result 網址:有待辦去登入卡,沒有回 S3'] = async () => {
  const a = await open({ url: 'start.html?step=result', init: { [G_KEY]: guestKey() } });
  assert.equal(a.step(), 'level');
  const b = await open({ url: 'start.html?step=test', init: { [G_KEY]: pendingGuest('entry') } });
  assert.equal(b.step(), 'signup');
};

T['P18 S4 舊檢測沒做完(7 天前或 7 天內開始的):新檢測用自己的鍵,不接舊作答、不問、不刪,直接到檢測頁'] = async () => {
  for (const ago of [8 * DAY, 3 * DAY]) {
    const old = J({ answers: { 0: 1, 1: 2 }, done: false, startedAt: new Date(NOW - ago).toISOString() });
    const a = await open({ url: 'start.html?step=test', signed: true, init: { [PRE + 'diag']: old, [PRE + 'onboard']: doneOnboard({ status: 'in_progress', step: 'test', doneAt: null }) } });
    await a.press('開始檢測');
    eq([a.confirms.length, a.ls.get(PRE + 'diag'), a.hrefs, a.acct('onboard').step, a.acct('onboard').testFrom],
      [0, old, ['placement.html?start=1&from=onboard'], 'test', NOW_ISO], String(ago / DAY));
  }
};

/* 每一個畫面:實色主按鈕最多一顆(登入卡自己的不算),其他動作是文字按鈕 */
const STEP_CASES = [
  ['start', {}], ['target', {}], ['exam', {}], ['level', {}], ['score', {}], ['join', {}],
  ['signup', { init: { [G_KEY]: pendingGuest('test') } }],
  ['test', { signed: true }], ['join', { signed: true }],
  ['result', { signed: true, init: { [PRE + 'onboard']: doneOnboard(), [PRE + 'levels']: LV } }],
];
const primaries = (e) => e.root.all().filter((n) => (n.tagName === 'BUTTON' || n.tagName === 'A') && n.className.split(' ').indexOf('primary') > -1 && !n.closest('form.auth-card'));
const buttonsOf = (e) => e.root.all().filter((n) => (n.tagName === 'BUTTON' || n.tagName === 'A') && !n.closest('form.auth-card') && n.className !== 'ob-back')
  .map((n) => n.className.split(' ')[0] + ':' + n.textContent);
T['P19 每個畫面只有一顆實色主按鈕,其他是文字按鈕;S0 有鵜鶘(data-mascot),畫完交給 UI.mount 掛上'] = async () => {
  const out = [];
  for (const [step, o] of STEP_CASES) {
    const e = await open(Object.assign({ url: 'start.html' + (step === 'start' ? '' : '?step=' + step) }, o));
    out.push([step + (o.signed ? '(登入)' : ''), primaries(e).length]);
    if (step === 'start') {
      const cv = e.root.querySelector('canvas');
      eq([cv && cv.getAttribute('data-mascot'), cv && cv.getAttribute('aria-hidden'), e.mounts > 0], ['gaze', 'true', true]);
      eq(buttonsOf(e), ['btn:開始', 'btn-text:我有班級代碼', 'btn-text:登入']);
      /* 標題短(手機上跟鵜鶘並排也是一行);副標的「（約 15–20 分鐘）」不斷開 */
      eq([e.h1(), e.root.querySelector('.ob-nowrap').textContent], ['找出你的起始程度', '（約 15–20 分鐘）']);
    }
    if (step === 'exam') eq(buttonsOf(e), ['btn:下一步', 'btn-text:還沒報名']);
    if (step === 'score') eq(buttonsOf(e), ['btn-text:只記得總分', 'btn:送出', 'btn-text:改成幫我測']);
    if (step === 'signup') eq(buttonsOf(e), ['btn-text:返回']);
    if (step === 'test') {
      eq(buttonsOf(e), ['btn:開始檢測', 'btn-text:沒有耳機，先做閱讀', 'btn-text:先跳過，從入門開始']);
      /* 同檢測頁的開始頁:標題左邊圖示、卡片裡三個小標籤、作答方式一行一件事(四行)、主按鈕在卡片裡;沒有單項的列點 */
      const art = e.root.querySelector('.page-head canvas');
      const card = e.root.querySelector('.diag-intro');
      eq([art && art.getAttribute('data-doodle'), card && card.querySelectorAll('.mock-tag').map((n) => n.textContent),
        card && !!card.querySelector('.btn.primary'), card && card.querySelectorAll('.ob-intro-note').map((n) => n.textContent), !!e.root.querySelector('ul')],
      ['diagnostic', ['聽力 12 題', '閱讀 12 題', '約 15–20 分鐘'], true, ['戴上耳機。', '每段音檔只播一次。', '選好答案後按「下一題」。', '不能回上一題。'], false]);
    }
    /* C1 訪客:標題、代碼欄、小字、註冊卡都在同一個置中的欄(.auth-page)裡 */
    if (step === 'join' && !o.signed) {
      const col = e.root.querySelector('.auth-page');
      eq([e.root.children.length, !!(col && col.querySelector('h1') && col.contains(e.ctx.document.getElementById('ob-join')) && col.querySelector('form.auth-card'))], [1, true]);
    }
  }
  eq(out, STEP_CASES.map(([step, o]) => [step + (o.signed ? '(登入)' : ''), step === 'signup' || (step === 'join' && !o.signed) || step === 'level' || step === 'target' ? 0 : 1]));
};
T['P20 PAID_UI 開或關:start.html 每一步畫的東西一樣'] = async () => {
  const snap = async (paid) => {
    const all = [];
    for (const [step, o] of STEP_CASES) {
      const e = await open(Object.assign({ url: 'start.html' + (step === 'start' ? '' : '?step=' + step), paid }, o));
      all.push([e.step(), e.h1(), buttonsOf(e), e.root.textContent]);
    }
    return all;
  };
  const off = await snap(false), on = await snap(true);
  eq(on, off);
  assert.equal(off.length, STEP_CASES.length);
};
T['P21 S8b 改程度:「改程度」打開面板(UI.sheet),原本的級別已選好;套用寫進 levels(來源 manual)、面板收掉、結果重畫'] = async () => {
  const e = await open({ url: 'start.html?step=result', signed: true, init: { [PRE + 'onboard']: doneOnboard(), [PRE + 'levels']: LV } });
  await e.press('改程度');
  const sh = e.sheets[0];
  assert.ok(sh && sh.opt.title === '改程度', '開了面板');
  const radios = sh.el.all().filter((n) => n.tagName === 'INPUT');
  eq(radios.length, 8);
  const pick = radios.find((n) => /^ob-listening/.test(n.attrs.name) && n.attrs.value === 'entry');
  pick.checked = true; e.fire(pick, 'change');
  assert.ok(/與檢測結果差 2 級/.test(sh.el.textContent));
  sh.el.all().find((n) => n.tagName === 'BUTTON' && n.textContent === '套用').click();
  await new Promise((r) => setTimeout(r, 5)); await settle();   // 重畫排在 setTimeout 0
  const lv = e.acct('levels');
  eq([lv.listening, lv.reading, lv.source.listening, lv.source.reading, lv.history[lv.history.length - 1].reason, sh.open, e.acct('onboard').levelSource],
    ['entry', 'threshold', 'manual', 'legacy', 'manual', false, 'manual']);
  eq(e.results[e.results.length - 1].stats, [['聽力', '入門'], ['閱讀', '門檻']]);
};

/* ---------- 新檢測(placement_v1)做完回 S8 ---------- */
/* 寫一次做完的新檢測進 ls:secs 是做完的科('L'、'R'、'LR'),ok 是每題對錯(1 全對、0 全錯);題目取難度表上每個 Part 的前幾題。
   fa_v1 照檢測頁的寫法記來源 t;end 晚於 testFrom(NOW) */
const ESTIMATE_CTX = (() => { const c = { window: {} }; c.window = c; vm.createContext(c); ['js/estimate-core.js', 'js/estimate-data.js', 'data/item-params.js'].forEach((f) => vm.runInContext(read(f), c)); return c; })();
const SCRIPT = { L: [['l1', 2], ['l2', 4], ['l3', 3], ['l4', 3]], R: [['p5', 4], ['p6', 4], ['p7', 4]] };
function estDone(ls, secs, ok, end) {
  const E = ESTIMATE_CTX.ESTIMATE, keys = Object.keys(ESTIMATE_CTX.ITEM_PARAMS.b);
  const at = new Date(NOW + MIN).toISOString(), fin = end === undefined ? new Date(NOW + 30 * MIN).toISOString() : end;
  const fa = { v: 1, i: {} }, items = [], tm = {};
  secs.split('').forEach((sec) => {
    tm[sec] = [at, fin || new Date(NOW + 10 * MIN).toISOString()];
    SCRIPT[sec].forEach(([part, n]) => keys.filter((k) => k.indexOf(part + '-') === 0).slice(0, n).forEach((k) => {
      fa.i[k] = [E.dayNum(NOW), ok, 't']; items.push([sec, k, 0, ok, 20]);
    }));
  });
  ls.set(PRE + 'fa_v1', J(fa));
  ls.set(PRE + 'placement_v1', J({ v: 1, runs: [{ at, end: fin, ip: 'ip1', cv: 'c1', sec: secs, tm, items, res: {} }] }));
}
/* 頁面上算出來的預估級別(同一個沙盒、同一份資料,只讀) */
const bandOf = (e, sec) => { const v = e.ctx.ESTIMATE_STORE.peek(); return v.ok && v[sec].show ? v[sec].band : null; };
const testing = (over) => doneOnboard(Object.assign({ status: 'in_progress', step: 'test', testFrom: NOW_ISO, levelSource: null, doneAt: null }, over || {}));

T['P22 新用戶做完兩科:兩科都用預估的級別(來源 est)、記完成;結算卡沒有小字,標題旁 ⓘ 寫程度怎麼定的,主按鈕照級別'] = async () => {
  const ls = new Map(Object.entries({ [PRE + 'onboard']: testing() }));
  estDone(ls, 'LR', 1);
  const e = await open({ url: 'start.html?step=result', signed: true, ls });
  const lv = e.acct('levels');
  eq([e.h1(), lv.listening, lv.reading, lv.source, lv.history.map((h) => h.reason), e.acct('onboard').levelSource, e.acct('onboard').status],
    ['你的起始程度', bandOf(e, 'L'), bandOf(e, 'R'), { listening: 'est', reading: 'est' }, ['est'], 'est', 'done']);
  assert.ok(lv.listening && lv.reading, '兩科都有級別');
  eq([e.results[0].note, levelInfo(e)], [undefined, ['起始程度說明', '起始程度', '這個程度是依你的程度檢測和之後的練習結果定的。']]);
  eq(e.results[0].links.map((l) => l.label), ['改程度', '重新檢測']);
  /* 全錯的人:兩科入門,主按鈕到文法 */
  const low = new Map(Object.entries({ [PRE + 'onboard']: testing() }));
  estDone(low, 'LR', 0);
  const w = await open({ url: 'start.html?step=result', signed: true, ls: low });
  eq([w.acct('levels').listening, w.acct('levels').reading, w.find('開始練習').attrs.href], ['entry', 'entry', 'grammar.html']);
};
T['P22b 只做一科(沒有級別):做的那科用預估,沒做的那科沒有數字就從入門;做一半回 S4'] = async () => {
  const one = new Map(Object.entries({ [PRE + 'onboard']: testing() }));
  estDone(one, 'R', 1);
  const e = await open({ url: 'start.html?step=result', signed: true, ls: one });
  eq([e.acct('levels').reading, e.acct('levels').listening, e.acct('levels').source], [bandOf(e, 'R'), 'entry', { listening: 'entry', reading: 'est' }]);
  const half = new Map(Object.entries({ [PRE + 'onboard']: testing() }));
  estDone(half, 'L', 1, null);
  const h = await open({ url: 'start.html?step=result', signed: true, ls: half });
  eq([h.step(), h.acct('levels'), h.acct('onboard').status], ['test', null, 'in_progress']);
};
T['P22c 有課程進度的人重新檢測:級別不自動改,結算卡下面出建議;按「改成這個程度」先確認(會換學習包)才改'] = async () => {
  const ls = new Map(Object.entries({ [PRE + 'onboard']: testing({ doneAt: NOW_ISO }), [PRE + 'levels']: LV, [PRE + 'plan']: J({ v: 1, classId: 'x' }) }));
  estDone(ls, 'LR', 0);
  const e = await open({ url: 'start.html?step=result', signed: true, ls });
  eq([e.acct('levels').listening, e.acct('levels').reading, e.acct('onboard').status], ['advanced', 'threshold', 'done']);
  const line = e.root.querySelector('.ob-suggest');
  eq(line && line.textContent, '建議程度：聽力 入門／閱讀 入門　改成這個程度');
  await e.press('改成這個程度');
  eq([e.dialogTitle(), e.acct('levels').listening], ['改程度會換學習包，要改嗎？', 'advanced'], '確認前不改');
  e.mask().querySelector('.ui-dialog-ok').click(); await settle();   // 確認視窗的「改程度」(結算卡也有一顆同名的文字按鈕)
  const lv = e.acct('levels');
  eq([lv.listening, lv.reading, lv.history[lv.history.length - 1].reason, !!e.root.querySelector('.ob-suggest')], ['entry', 'entry', 'est', false]);
  /* 估分的檔載不到:用這一次存的結果;也沒有就「載入失敗」,級別不動 */
  const f = new Map(Object.entries({ [PRE + 'onboard']: testing() }));
  estDone(f, 'LR', 1);
  const x = await open({ url: 'start.html?step=result', signed: true, ls: f, estFail: true });
  eq([x.h1(), x.acct('levels'), x.acct('onboard').step], ['載入失敗', null, 'test']);
};

/* ---------- 跑 ---------- */
(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let detail = '', ok = true;
    try { await T[name](); } catch (err) {
      ok = false;
      detail = err && err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : String(err);
      if (err && err.actual !== undefined) detail = '實際 ' + J(err.actual) + ' 預期 ' + J(err.expected) + ' ' + detail;
    }
    if (ok) pass++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + String(detail).slice(0, 500) : ''));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
