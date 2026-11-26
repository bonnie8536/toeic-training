/* 每週堂數與課程的小區塊(js/lesson-week.js):每週上幾堂(畫面、焦點、選了寫什麼)、每週堂數面板(預選、下週起生效、套用寫 plan)、
   「我的」頁那一列、本週一列、獨立小檢核那一列與結果卡、程度調整那一塊與 ⓘ 說明面板。
   真的 js/common.js 的 store、js/lesson-core.js、js/lesson-plan.js 載進沙盒,畫面用很小的假 DOM,UI.sheet、UI.result 換成記參數的假元件。
   不開瀏覽器、不連網。用法:node tools/test_lesson_week.js */
'use strict';
const vm = require('vm');
const assert = require('assert');
const K = require('./lesson_kit.js');

const J = JSON.stringify;
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(J(a)), JSON.parse(J(b)), m);
const NOW = Date.parse('2026-11-04T10:00:00+08:00');
const CPID = 'c' + '00000000-0000-4000-8000-000000000077'.replace(/-/g, '');
const PRE = 'tr_u' + CPID + '_';
const T = {};

/* ---------- 假 DOM:選擇器只認「標籤、.類別、[屬性]」與用空白隔開的祖先 ---------- */
function makeDom() {
  const doc = { activeElement: null };
  const one = (n, s) => {
    const m = /^([a-z0-9]*)((?:\.[\w-]+)*)(?:\[([\w-]+)(?:="([^"]*)")?\])?(:checked)?$/i.exec(s);
    if (!m || n.nodeType !== 1) return false;
    if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
    const cls = n.className.split(' ');
    if (m[2] && m[2].split('.').filter(Boolean).some((c) => cls.indexOf(c) < 0)) return false;
    if (m[3] && (!(m[3] in n.attrs) || (m[4] !== undefined && n.attrs[m[3]] !== m[4]))) return false;
    return !m[5] || !!n.checked;
  };
  const hit = (n, sel, top) => sel.split(',').some((part) => {
    const chain = part.trim().split(/\s+/);
    if (!one(n, chain[chain.length - 1])) return false;
    let a = n.parentNode, i = chain.length - 2;
    while (i >= 0 && a && a !== top) { if (one(a, chain[i])) i--; a = a.parentNode; }
    return i < 0;
  });
  class N {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = tag === '#text' ? 3 : 1; this.children = []; this.parentNode = null; this.attrs = {}; this.className = ''; this._t = ''; this.on = {}; this.checked = false; }
    append(...ns) { ns.forEach((x) => { const c = typeof x === 'string' ? doc.createTextNode(x) : x; if (c.parentNode) c.parentNode._rm(c); c.parentNode = this; this.children.push(c); }); }
    replaceChildren(...ns) { this.children.slice().forEach((c) => this._rm(c)); this._t = ''; this.append(...ns); }
    _rm(c) { const i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); c.parentNode = null; }
    remove() { if (this.parentNode) this.parentNode._rm(this); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
    focus() { doc.activeElement = this; }
    click() { (this.on.click || []).forEach((f) => f({ currentTarget: this, target: this, preventDefault() {} })); }
    get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children = []; this._t = String(v); }
    all() { const out = []; const w = (n) => n.children.forEach((c) => { out.push(c); w(c); }); w(this); return out; }
    querySelectorAll(s) { return this.all().filter((n) => hit(n, s, this)); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  }
  doc.createElement = (t) => new N(t);
  doc.createTextNode = (t) => { const n = new N('#text'); n._t = String(t); return n; };
  doc.body = new N('body');
  return doc;
}

/* ---------- 沙盒 ---------- */
function env(opt) {
  const o = opt || {};
  const ls = new Map([['tr_current_profile', J(CPID)]].concat(Object.entries(o.init || {})));
  const doc = makeDom();
  const e = { ls, doc, sheets: [], results: [], held: 0 };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } }
  FakeDate.now = () => NOW;
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, JSON, Date: FakeDate, Object, Array, Set, Map, Math, String, Number, Promise, RegExp, Error, TypeError,
    document: doc, scrollTo() {}, PACKS_UI: o.ui === undefined ? 'pilot' : o.ui,
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k), get length() { return ls.size; }, key: (i) => [...ls.keys()][i] || null },
    addEventListener() {},
  };
  ctx.window = ctx;
  ctx.UI = {
    sheet: (s) => { const el = doc.createElement('div'); (s.nodes || []).forEach((n) => el.append(n)); doc.body.append(el); const api = { opt: s, el, open: true, close: () => { api.open = false; el.remove(); } }; e.sheets.push(api); return api; },
    result: (r) => { e.results.push(r); const el = doc.createElement('section'); el.className = 'result-card'; const h = doc.createElement('h2'); h._t = String(r.big); el.append(h); return { el, heading: h, reward: doc.createElement('div') }; },
  };
  vm.createContext(ctx);
  ['js/common.js', 'js/pack-util.js', 'js/lesson-rules.js', 'js/pack-core.js', 'js/lesson-plan.js', 'js/lesson-core.js', 'js/lesson-week.js'].forEach((f) => vm.runInContext(K.read(f), ctx, { filename: f }));
  ctx.holdForAccount = () => { e.held++; return !!o.hold; };
  e.W = ctx.LESSON_WEEK;
  e.ctx = ctx;
  e.plan = () => (ls.has(PRE + 'plan') ? JSON.parse(ls.get(PRE + 'plan')) : null);
  e.D = { calls: [], setWeekly(n) { e.D.calls.push(['set', n]); }, askWeekly() { e.D.calls.push(['ask']); } };
  ctx.LESSON_DATA = e.D;
  return e;
}
const PLAN = { v: 1, classId: 'x', startDate: '2026-11-01', lessonsPerWeek: null, term: 1, updatedAt: NOW - 1000 };
const settle = () => new Promise((r) => setImmediate(r));

T['K1 needWeekly:沒有欄位或 null 都算還沒問過;第 1 堂沒上完不問;問過不再問'] = () => {
  const e = env(), done = { 1: { doneAt: 1 } };
  eq([e.W.needWeekly(PLAN, done), e.W.needWeekly(Object.assign({}, PLAN, { weeklyAskedAt: null, perWeek: [] }), done), e.W.needWeekly(PLAN, {}),
    e.W.needWeekly(Object.assign({}, PLAN, { weeklyAskedAt: '2026-11-02T00:00:00.000Z' }), done), e.W.needWeekly(null, done)], [true, true, false, false, false]);
};
T['K2 每週上幾堂:標題拿到焦點;兩張單選卡片(不預選)各兩行;選了寫每週堂數、「之後再選」只記問過;按下前先 holdForAccount'] = async () => {
  const e = env(), host = e.doc.createElement('div');
  const p = e.W.weeklyScreen(host);
  const h = host.querySelector('h2');
  eq([h.textContent, e.doc.activeElement === h, h.getAttribute('tabindex')], ['每週上幾堂', true, '-1']);
  const cards = host.querySelectorAll('.ob-choice');
  eq(cards.map((c) => [c.getAttribute('role'), c.getAttribute('aria-checked'), c.textContent]), [['radio', 'false', '每週 2 堂12 週上完 24 堂'], ['radio', 'false', '每週 1 堂12 週上 12 堂主課']]);
  eq([host.querySelector('[role="radiogroup"]').getAttribute('aria-labelledby'), host.querySelectorAll('.btn.primary').length, host.querySelector('.btn-text').textContent], [h.getAttribute('id'), 0, '之後再選']);
  cards[1].click();
  eq([await p, e.D.calls, e.held], ['set', [['set', 1]], 1]);
  const e2 = env(), host2 = e2.doc.createElement('div'), p2 = e2.W.weeklyScreen(host2);
  host2.querySelector('.btn-text').click();
  eq([await p2, e2.D.calls], ['later', [['ask']]]);
};
T['K3 每週堂數面板:預選目前的值;還沒選過沒有「下週起生效」、選過有;套用寫 plan(第一次當週生效、之後下週生效)、關面板、叫 onApplied'] = () => {
  const e = env({ init: { [PRE + 'plan']: J(PLAN) } });
  let got = null;
  const s = e.W.weeklySheet({ onApplied: (p) => { got = p; } });
  eq([s.opt.title, s.opt.note, s.el.querySelectorAll('.auth-role-card').map((n) => n.textContent), s.el.querySelector('input:checked').getAttribute('value')], ['每週堂數', null, ['每週 2 堂', '每週 1 堂'], '2']);
  const one = s.el.querySelectorAll('input')[1];
  one.checked = true; (one.on.change || []).forEach((f) => f({}));
  s.el.querySelector('.btn.primary').click();
  eq([e.plan().perWeek, e.plan().lessonsPerWeek, !!e.plan().weeklyAskedAt, s.open, got && got.perWeek], [[{ w: 1, n: 1 }], 1, true, false, [{ w: 1, n: 1 }]]);
  const s2 = e.W.weeklySheet({});
  eq([s2.opt.note, s2.el.querySelector('input:checked').getAttribute('value')], ['下週起生效', '1']);
  const two = s2.el.querySelectorAll('input')[0];
  two.checked = true; (two.on.change || []).forEach((f) => f({}));
  s2.el.querySelector('.btn.primary').click();
  eq(e.plan().perWeek, [{ w: 1, n: 1 }, { w: 2, n: 2 }]);
};
T['K4 「我的」頁那一列:有 plan、開關 pilot 或 on 才出;右側最新一筆的值(沒選過寫每週 2 堂);點了開面板'] = () => {
  const e = env({ init: { [PRE + 'plan']: J(Object.assign({}, PLAN, { perWeek: [{ w: 1, n: 1 }] })) } });
  const li = e.W.settingsRow(() => {});
  eq([li.tagName, li.querySelector('.me-row').textContent], ['LI', '每週堂數每週 1 堂']);
  li.querySelector('.me-row').click();
  eq(e.sheets.length, 1);
  eq(env({ init: { [PRE + 'plan']: J(PLAN) } }).W.settingsRow().querySelector('.me-row-val').textContent, '每週 2 堂');
  eq([env().W.settingsRow(), env({ ui: 'off', init: { [PRE + 'plan']: J(PLAN) } }).W.settingsRow()], [null, null]);
};
T['K5 本週一列:字、不可點;還沒選每週堂數時後面接「設定堂數」;沒有 goal 不出'] = () => {
  const e = env();
  const p = e.W.weekRow({ done: 1, want: 2, days: 2, wantDays: 3 }, {});
  eq([p.tagName, p.className, p.textContent, p.querySelectorAll('button').length, p.querySelectorAll('a').length], ['P', 'lsn-week', '本週　完成 1 / 2 堂　練習 2 / 3 天', 0, 0]);
  let set = 0;
  const q = e.W.weekRow({ done: 2, want: 2, days: 2, wantDays: 2 }, { unset: true, onSet: () => { set++; } });
  q.querySelector('button').click();
  eq([q.querySelector('button').className, q.querySelector('button').textContent, set], ['btn-text lsn-week-set', '設定堂數', 1]);
  eq(e.W.weekRow(null), null);
};
T['K6 獨立小檢核那一列:清單列連到 cp=1,左堂號右分鐘'] = () => {
  const ul = env().W.soloRow({ no: 4, minutes: 18 });
  eq([ul.className, ul.querySelector('a').getAttribute('href'), ul.querySelector('a').textContent, ul.querySelector('.me-row-val').textContent], ['me-list lsn-solo', 'lesson.html?no=4&cp=1', '第 4 堂小檢核18 分鐘', '18 分鐘']);
  eq(env().W.soloRow(null), null);
};
T['K7 程度調整:有變的科一列(不可點)、ⓘ 開說明面板五行;都沒變不出'] = () => {
  const e = env();
  const s = e.W.calibNotice({ listening: ['entry', 'threshold'], reading: null });
  eq([s.querySelector('h2').textContent, s.querySelectorAll('li').map((n) => n.textContent), s.querySelectorAll('a').length], ['程度調整', ['聽力入門 → 門檻'], 0]);
  const i = s.querySelector('.lsn-info');
  eq([i.textContent, i.getAttribute('aria-label'), i.className], ['ⓘ', '程度調整說明', 'btn-text lsn-info']);
  i.click();
  eq([e.sheets[0].opt.title, e.sheets[0].el.querySelectorAll('p').length], ['程度調整', 5]);
  eq([e.W.calibNotice({ listening: null, reading: null }), e.W.calibNotice(null)], [null, null]);
};

/* ---------- 跑 ---------- */
(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let detail = '';
    try { await T[name](); pass++; } catch (err) { detail = (err && err.actual !== undefined ? "實際 " + J(err.actual) + " 預期 " + J(err.expected) + " " : "") + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : String(err)); }
    console.log((detail ? 'FAIL ' : 'PASS ') + name + (detail ? '  →  ' + detail.slice(0, 500) : ''));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
