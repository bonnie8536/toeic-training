/* 註冊時選身分(前端計畫四與三.6):js/profile.js 的註冊卡、js/paywall.js 的登入後自動開老師試用、js/cloud.js 的登出清意向。
   用假的 DOM 與假的 Supabase 跑,不連網路。重點:
   - PAID_UI 沒開:註冊卡一個節點都不多,不存、不清、不讀意向。
   - 意向只是提示:四個條件全部成立才自動開,一個註冊最多開一次;其他情況一律不開。
   用法:node tools/test_signup_role.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const COMMON = read('js/common.js');
const H_SRC = (COMMON.match(/function h\(tag[\s\S]*?\n}\r?\n/) || [''])[0];
const PROFILE_SRC = read('js/profile.js');
const CLOUD_SRC = read('js/cloud.js');
const PAYWALL_SRC = read('js/paywall.js');
const PLANS_SRC = read('js/plans-config.js');
const NB = / /g;
const norm = s => String(s).replace(NB, ' ');
const MIN = 60e3;

/* ---------- 最小 DOM(跟 test_admin_classes 同一套,多了簡單的 querySelector) ---------- */
function fakeDom() {
  class Node {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.nodeType = tag === '#text' ? 3 : 1; this.children = []; this.parentNode = null; this.attrs = {}; this.className = ''; this._text = ''; this.on = {}; this.dataset = {}; this.style = {}; this._hidden = false; this.disabled = false; this.value = ''; this.checked = false; }
    get hidden() { return this._hidden; }
    set hidden(v) { this._hidden = !!v; if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
    get type() { return this.attrs.type || ''; }
    get name() { return this.attrs.name || ''; }
    set type(v) { this.attrs.type = String(v); }
    append(...ns) { ns.forEach(n => { if (n === null || n === undefined) return; if (!(n instanceof Node)) { const t = new Node('#text'); t._text = String(n); n = t; } if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.children.push(n); }); }
    prepend(n) { if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.children.unshift(n); }
    after(n) { const p = this.parentNode; if (!p) return; if (n.parentNode) n.parentNode._rm(n); const i = p.children.indexOf(this); n.parentNode = p; p.children.splice(i + 1, 0, n); }
    insertBefore(n, ref) { if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); }
    _rm(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; }
    remove() { if (this.parentNode) this.parentNode._rm(this); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.tagName === 'ROOT'; }
    setAttribute(k, v) { if (k === 'hidden') { this.hidden = true; return; } this.attrs[k] = String(v); if (k === 'value') this.value = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { if (k === 'hidden') { this.hidden = false; return; } delete this.attrs[k]; }
    addEventListener(t, fn) { (this.on[t] = this.on[t] || []).push(fn); }
    removeEventListener(t, fn) { this.on[t] = (this.on[t] || []).filter(f => f !== fn); }
    async fire(t, ev) { const e = Object.assign({ preventDefault() {}, stopPropagation() {}, currentTarget: this, target: this }, ev); for (const f of (this.on[t] || []).slice()) await f(e); }
    click() { return this.fire('click'); }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = String(v); }
    set innerHTML(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = ''; this._html = String(v); }
    get innerHTML() { return this._html || ''; }
    get classList() { const el = this; return { add(c) { el.classList.toggle(c, true); }, remove(c) { el.classList.toggle(c, false); }, toggle(c, on) { const s = new Set(el.className.split(' ').filter(Boolean)); if (on === undefined) on = !s.has(c); if (on) s.add(c); else s.delete(c); el.className = [...s].join(' '); }, contains(c) { return el.className.split(' ').includes(c); } }; }
    focus() { Node.focused = this; } blur() {}
    get offsetParent() { return this.isConnected ? {} : null; }
    find(pred) { const out = []; const walk = n => { if (pred(n)) out.push(n); n.children.forEach(walk); }; walk(this); return out; }
    byClass(c) { return this.find(n => n.className.split(' ').includes(c)); }
    byTag(t) { return this.find(n => n.tagName === t.toUpperCase()); }
    byText(t) { return this.find(n => n.nodeType === 1 && (n.tagName === 'BUTTON' || n.tagName === 'A') && norm(n.textContent) === t); }
    /* 有沒有被 hidden 的祖先(含自己)藏起來 */
    get shown() { let n = this; while (n) { if (n._hidden) return false; n = n.parentNode; } return true; }
    matches(sel) { return sel.split(',').some(s => matchOne(this, s.trim())); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) { return this.find(n => n !== this && n.nodeType === 1 && n.matches(sel)); }
  }
  /* 'input'、'.a'、'.a input'、'input[name=x]:checked'、'button,input,a[href]' 這幾種 */
  function simple(n, part) {
    const m = /^([a-z]*)((?:\.[\w-]+)*)(?:\[([\w-]+)(?:=([\w-]+))?\])?(:checked)?$/i.exec(part);
    if (!m) return false;
    if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && !m[2].split('.').filter(Boolean).every(c => n.className.split(' ').includes(c))) return false;
    if (m[3] && !(m[3] in n.attrs) && !(m[3] === 'name' && n.attrs.name)) return false;
    if (m[4] && n.attrs[m[3]] !== m[4]) return false;
    if (m[5] && !n.checked) return false;
    return true;
  }
  function matchOne(n, sel) {
    const parts = sel.split(/\s+/);
    if (!simple(n, parts[parts.length - 1])) return false;
    let i = parts.length - 2, p = n.parentNode;
    while (i >= 0 && p) { if (p.nodeType === 1 && simple(p, parts[i])) i--; p = p.parentNode; }
    return i < 0;
  }
  const root = new Node('ROOT');
  const html = new Node('html'); root.append(html);
  const body = new Node('body'); html.append(body);
  const document = {
    createElement: t => new Node(t), createTextNode: t => { const n = new Node('#text'); n._text = String(t); return n; },
    querySelector: s => root.querySelector(s), querySelectorAll: s => root.querySelectorAll(s),
    listeners: [],
    addEventListener(t, fn) { document.listeners.push({ t, fn }); },
    removeEventListener(t, fn) { document.listeners = document.listeners.filter(l => !(l.t === t && l.fn === fn)); },
    body, documentElement: html, head: new Node('head'), visibilityState: 'visible',
    get activeElement() { return Node.focused || body; },
  };
  document.fire = async (t, ev) => { for (const l of document.listeners.filter(x => x.t === t)) await l.fn(Object.assign({ preventDefault() {}, stopPropagation() {} }, ev)); };
  return { root, body, document, Node };
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };

/* 節點樹 → 字串(比對「一個節點都不多」用) */
function ser(n) {
  if (n.nodeType === 3) return JSON.stringify(n._text);
  const at = Object.keys(n.attrs).sort().filter(k => k !== 'id' && k !== 'for').map(k => k + '=' + n.attrs[k]).join(' ');
  return '<' + n.tagName.toLowerCase() + (n.className ? ' .' + n.className : '') + (at ? ' ' + at : '') + (n._html ? ' html' : '') + '>'
    + (n._text ? JSON.stringify(n._text) : '') + n.children.map(ser).join('') + '</>';
}

function makeStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); },
    key: i => { const a = Array.from(m.keys()); return i < a.length ? a[i] : null; }, get length() { return m.size; }, _m: m };
}

/* ======================================================================= */
/* 一、註冊卡(profile.js):假的 CLOUD 只記呼叫順序                         */
/* ======================================================================= */
function loadCard(o) {
  o = o || {};
  const dom = fakeDom();
  const log = [];
  const ctx = { console: { warn() {}, log() {}, error() {} }, document: dom.document, setTimeout, clearTimeout, Promise,
    location: { origin: 'https://x', pathname: '/signup.html', href: 'https://x/signup.html', search: '', reload() {} }, alert() {}, confirm: () => true, prompt: () => null };
  ctx.window = ctx;
  if (o.plans !== false) { vm.createContext(ctx); vm.runInContext(PLANS_SRC, ctx); }
  else vm.createContext(ctx);
  if (o.plans && typeof o.plans === 'object') ctx.PLANS = o.plans;
  if ('paid' in o) ctx.PAID_UI = o.paid; else if (o.plans === false) delete ctx.PAID_UI;
  const w = o.world || null;   // 給了 world:清意向就真的清它的 localStorage 與 sessionStorage(整合情境用)
  ctx.CLOUD = {
    enabled: true, user: null, authError: '', sessionExpired: false, ready: Promise.resolve(null),
    nameOf: () => '',
    saveSignupIntent: (x) => { log.push(['save', JSON.parse(JSON.stringify(x))]); return Object.assign({}, x, { at: 1700000000000 }); },
    clearSignupIntent: () => { log.push(['clear']); if (w) { w.local.removeItem('tr_signup_intent'); w.session.removeItem('tr_signup_intent'); } },
    takeSignupIntent: () => { log.push(['take']); return null; },
    signUp: async function (e, p, n, it) { log.push(arguments.length > 3 ? ['signUp', e, JSON.parse(JSON.stringify(it))] : ['signUp', e]); if (o.signUpFail) throw new Error('這個 Email 已經註冊過'); return { needsConfirm: true }; },
    signInWithGoogle: async (b) => { log.push(['google', b]); if (o.googleFail) throw new Error('Google 登入目前不能用，請改用 Email 註冊。'); },
    login: async (e) => { log.push(['login', e]); },
    resetPassword: async () => { log.push(['reset']); },
    resendConfirm: async () => {},
  };
  vm.runInContext(H_SRC, ctx);
  vm.runInContext(PROFILE_SRC, ctx);
  const card = ctx.PROFILE.buildAuthCard({ mode: o.mode || 'signup', autofocus: false, backTo: 'index.html' });
  dom.body.append(card);
  return { ctx, card, log, dom };
}
const intentCalls = log => log.filter(x => x[0] === 'save' || x[0] === 'clear' || x[0] === 'take');
const roleBox = card => card.byClass('auth-role')[0] || null;
const radio = (card, name, value) => card.byTag('input').find(i => i.attrs.type === 'radio' && i.attrs.value === value && (!name || (i.attrs.name || '').indexOf(name) === 0));
async function pick(card, value, name) { const r = radio(card, name || 'auth-role', value); r.checked = true; await r.fire('change'); return r; }
const fieldInput = (card, label) => {
  const l = card.byTag('label').find(x => norm(x.textContent) === label);
  return l ? l.parentNode.byClass('auth-input')[0] : null;
};
async function fillAndSubmit(card, v) {
  fieldInput(card, '暱稱').value = v.name; fieldInput(card, 'Email').value = v.email; fieldInput(card, '密碼').value = v.pw;
  await card.byTag('form')[0].fire('submit'); await settle();
}

const cases = {};

cases['PAID_UI 沒開:註冊卡沒有身分選擇,結構跟沒有 plans-config 的頁面一模一樣,也不碰意向'] = async () => {
  const off = loadCard({ paid: false });
  const none = loadCard({ plans: false });
  const offL = loadCard({ paid: false, mode: 'login' });
  const noneL = loadCard({ plans: false, mode: 'login' });
  const sameLogin = ser(offL.card) === ser(noneL.card);
  /* 互動也一樣:空白送出(錯誤訊息)、Google、切到登入、登入 */
  await off.card.byTag('form')[0].fire('submit'); await none.card.byTag('form')[0].fire('submit'); await settle();
  const sameErr = ser(off.card) === ser(none.card);
  await off.card.byClass('btn-google')[0].click(); await settle();
  await fillAndSubmit(off.card, { name: '小安', email: 'a@x.com', pw: '12345678' });
  await offL.card.byClass('btn-google')[0].click(); await settle();
  const sw = offL.card.byText('註冊')[0]; await sw.click(); await settle();
  const back = offL.card.byText('登入')[0]; await back.click(); await settle();
  fieldInput(offL.card, 'Email').value = 'a@x.com'; fieldInput(offL.card, '密碼').value = 'x'; await offL.card.byTag('form')[0].fire('submit'); await settle();
  const r = {
    sameSignup: ser(loadCard({ paid: false }).card) === ser(loadCard({ plans: false }).card),
    sameLogin,
    sameErr,
    noRole: !roleBox(off.card) && !/我是老師|我是學生/.test(off.card.textContent),
    saves: off.log.concat(offL.log).filter(x => x[0] === 'save' || x[0] === 'take').length,
    flow: off.log.filter(x => x[0] !== 'clear').map(x => x[0]).join(',') + ' / ' + offL.log.filter(x => x[0] !== 'clear').map(x => x[0]).join(','),
    signUpArgs: (off.log.find(x => x[0] === 'signUp') || []).length,
  };
  return { ok: r.sameSignup && r.sameLogin && r.sameErr && r.noRole && r.saves === 0 && r.flow === 'google,signUp / google,login' && r.signUpArgs === 2, detail: JSON.stringify(r) };
};

cases['PAID_UI 打開:註冊分頁最上面兩張選項卡,預設學生;學生沒有說明行;老師的設定先藏著'] = async () => {
  const { card } = loadCard({ paid: true });
  const box = roleBox(card);
  if (!box) return { ok: false, detail: '沒有 .auth-role' };
  const kids = card.children.map(c => c.className.split(' ')[0] || c.tagName);
  const cards = box.byClass('auth-role-card');
  const stu = radio(card, 'auth-role', 'student'), tea = radio(card, 'auth-role', 'teacher');
  const panel = box.byClass('auth-teacher')[0];
  const legend = box.byTag('legend')[0];
  const r = {
    order: kids.join(','),
    labels: cards.map(c => norm(c.textContent)).join('|'),
    radios: [stu && stu.attrs.type, tea && tea.attrs.type, stu && stu.attrs.name === tea.attrs.name].join(','),
    def: stu.checked === true && tea.checked === false,
    panelHidden: panel && panel.shown === false,
    legend: legend && norm(legend.textContent),
    fieldset: box.tagName,
  };
  const ok = /^(auth-h,)?auth-role,btn-google,auth-or,auth-form/.test(r.order) && r.labels === '我是學生|我是老師' && r.radios === 'radio,radio,true'
    && r.def && r.panelHidden && r.legend === '身分' && r.fieldset === 'FIELDSET';
  return { ok, detail: JSON.stringify(r) };
};

cases['選老師:名額三選一只有數字(從 PLANS 來)、選填的班級名稱、方案說明連到價格頁,沒有解釋句'] = async () => {
  const { card } = loadCard({ paid: true });
  await pick(card, 'teacher');
  const panel = card.byClass('auth-teacher')[0];
  const seats = panel.byClass('auth-seat').map(l => norm(l.textContent).trim());
  const seatRadios = panel.byTag('input').filter(i => i.attrs.type === 'radio');
  const link = panel.byTag('a')[0];
  const nameIn = fieldInput(card, '班級名稱');
  const texts = panel.find(n => n.nodeType === 3 && n._text.trim()).map(n => norm(n._text).trim());
  const r = {
    shown: panel.shown, seats,
    def: seatRadios.map(i => i.checked).join(','),
    values: seatRadios.map(i => i.attrs.value).join(','),
    link: link && [norm(link.textContent), link.attrs.href, link.attrs.target].join(' '),
    name: !!nameIn && nameIn.attrs.maxlength,
    texts,
  };
  const allowed = new Set(['名額', '10 人', '30 人', '60 人', '每月 390 元', '每月 890 元', '每月 1,490 元', '班級名稱', '空白就用「我的班級」', '方案說明']);
  const ok = r.shown === true && seats.join('|') === '10 人 每月 390 元|30 人 每月 890 元|60 人 每月 1,490 元'
    && r.def === 'true,false,false' && r.values === '10,30,60' && r.link === '方案說明 pricing.html _blank' && r.name === '30'
    && texts.every(t => allowed.has(t));
  return { ok, detail: JSON.stringify(r) };
};

cases['名額的價錢照 window.PLANS 畫(改價只改 plans-config)'] = async () => {
  const { card } = loadCard({ paid: true, plans: { student: { month: 199, year: 1990 }, teacher: { 10: 400, 30: 900, 60: 1500 }, teacherYearMonths: 10 } });
  await pick(card, 'teacher');
  const seats = card.byClass('auth-seat').map(l => norm(l.textContent).trim());
  return { ok: seats.join('|') === '10 人 每月 400 元|30 人 每月 900 元|60 人 每月 1,500 元', detail: seats.join('|') };
};

cases['Email 註冊選老師:驗證過了、呼叫 signUp 之前存意向 {名額, 班名, Email};signUp 照舊只傳三個參數(不帶意向)'] = async () => {
  const { card, log } = loadCard({ paid: true });
  await pick(card, 'teacher');
  await pick(card, '30', 'auth-seats');
  fieldInput(card, '班級名稱').value = ' 週六班 ';
  await fillAndSubmit(card, { name: '王老師', email: 'T@x.com', pw: '12345678' });
  const seq = log.filter(x => x[0] !== 'clear').map(x => x[0]).join(',');
  const save = log.find(x => x[0] === 'save');
  const su = log.find(x => x[0] === 'signUp');
  return { ok: seq === 'save,signUp' && save[1].seats === 30 && save[1].name === '週六班' && save[1].email === 'T@x.com' && su.length === 2,
    detail: seq + ' ' + JSON.stringify(save && save[1]) + ' signUp 紀錄 ' + JSON.stringify(su) };
};

cases['Email 註冊選學生:signUp 之前清掉這台留著的意向,不存,signUp 不帶意向'] = async () => {
  const { card, log } = loadCard({ paid: true });
  await fillAndSubmit(card, { name: '小安', email: 'a@x.com', pw: '12345678' });
  const seq = log.map(x => x[0]).join(',');
  return { ok: seq === 'clear,signUp' && log[1].length === 2, detail: seq + ' 參數 ' + log[1].length };
};

cases['欄位有錯(選老師):不存意向、不呼叫 signUp'] = async () => {
  const { card, log } = loadCard({ paid: true });
  await pick(card, 'teacher');
  const before = log.length;
  await fillAndSubmit(card, { name: '', email: 'bad', pw: '1' });
  const after = log.slice(before).map(x => x[0]);
  const bad = card.byClass('is-bad').length;
  return { ok: after.length === 0 && bad === 3, detail: JSON.stringify(after) + ' 錯誤欄 ' + bad };
};

cases['Email 註冊失敗(例如已經註冊過):意向清掉'] = async () => {
  const { card, log } = loadCard({ paid: true, signUpFail: true });
  await pick(card, 'teacher');
  await fillAndSubmit(card, { name: '王老師', email: 't@x.com', pw: '12345678' });
  const seq = log.map(x => x[0]).join(',');
  return { ok: /save,signUp,clear$/.test(seq) && /已經註冊過/.test(card.byClass('auth-msg')[0].textContent), detail: seq };
};

cases['Google 註冊選老師:轉跳之前存意向(沒有 Email,cloud.js 會放 sessionStorage);選學生就清掉'] = async () => {
  const t = loadCard({ paid: true });
  await pick(t.card, 'teacher'); await pick(t.card, '60', 'auth-seats');
  fieldInput(t.card, '班級名稱').value = '晚間班';
  await t.card.byClass('btn-google')[0].click(); await settle();
  const tSeq = t.log.filter(x => x[0] !== 'clear').map(x => x[0]).join(',');
  const save = t.log.find(x => x[0] === 'save');
  const s = loadCard({ paid: true });
  await s.card.byClass('btn-google')[0].click(); await settle();
  const sSeq = s.log.map(x => x[0]).join(',');
  return { ok: tSeq === 'save,google' && save[1].seats === 60 && save[1].name === '晚間班' && !('email' in save[1]) && sSeq === 'clear,google',
    detail: tSeq + ' ' + JSON.stringify(save && save[1]) + ' / 學生 ' + sSeq };
};

cases['Google 失敗(provider 沒開):意向清掉,錯誤照舊顯示'] = async () => {
  const { card, log } = loadCard({ paid: true, googleFail: true });
  await pick(card, 'teacher');
  await card.byClass('btn-google')[0].click(); await settle();
  const seq = log.map(x => x[0]).join(',');
  return { ok: /save,google,clear$/.test(seq) && /Google 登入目前不能用/.test(card.byClass('auth-msg')[0].textContent), detail: seq };
};

cases['從老師改回學生:當下就清掉意向,老師的設定藏起來'] = async () => {
  const { card, log } = loadCard({ paid: true });
  await pick(card, 'teacher');
  const n = log.length;
  await pick(card, 'student');
  return { ok: log.slice(n).map(x => x[0]).join(',') === 'clear' && card.byClass('auth-teacher')[0].shown === false, detail: JSON.stringify(log.slice(n)) };
};

cases['登入分頁:沒有身分選擇;切到登入分頁、按登入、按 Google 登入都清意向,不存'] = async () => {
  const { card, log } = loadCard({ paid: true });
  await pick(card, 'teacher');
  const n = log.length;
  await card.byText('登入')[0].click(); await settle();
  const afterSwitch = log.slice(n).map(x => x[0]).join(',');
  const noRole = !roleBox(card) && !/我是老師/.test(card.textContent);
  const m = log.length;
  fieldInput(card, 'Email').value = 'a@x.com'; fieldInput(card, '密碼').value = 'pw';
  await card.byTag('form')[0].fire('submit'); await settle();
  await card.byClass('btn-google')[0].click(); await settle();
  const later = log.slice(m).map(x => x[0]).join(',');
  const opened = loadCard({ paid: true, mode: 'login' });
  return { ok: afterSwitch === 'clear' && noRole && later === 'clear,login,clear,google' && !roleBox(opened.card) && intentCalls(opened.log).length === 0,
    detail: afterSwitch + ' / ' + later + ' / 直接開登入 ' + intentCalls(opened.log).length };
};

cases['選項卡用原生 radio(鍵盤方向鍵可以換)、label 包住、同一組 name;名額也是'] = async () => {
  const { card } = loadCard({ paid: true });
  await pick(card, 'teacher');
  const roles = card.byClass('auth-role-card').map(l => l.byTag('input')[0]);
  const seats = card.byClass('auth-seat').map(l => l.byTag('input')[0]);
  const same = a => a.every(i => i && i.attrs.type === 'radio' && i.attrs.name === a[0].attrs.name);
  const fs2 = card.byClass('auth-seats')[0];
  return { ok: same(roles) && same(seats) && roles[0].attrs.name !== seats[0].attrs.name && fs2 && fs2.tagName === 'FIELDSET' && norm(fs2.byTag('legend')[0].textContent) === '名額',
    detail: roles.map(i => i.attrs.name).join(',') + ' / ' + seats.map(i => i.attrs.name).join(',') };
};

/* ======================================================================= */
/* 二、登入後自動開老師試用(真的 cloud.js + paywall.js,假的 Supabase)       */
/* ======================================================================= */
const UID = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72';
const SB_KEY = 'sb-x-auth-token';
const ACCESS = (o) => ({ active: true, source: 'trial', is_owner: false, is_teacher: false, role: 'student', teacher_trial_available: true,
  server_now: new Date().toISOString(), until: new Date(Date.now() + 7 * 864e5).toISOString(), classes: [], ...o });

function world(o) {
  return Object.assign({ local: makeStorage(), session: makeStorage(), rpc: [], reloads: 0, paid: true, signUps: [], held: [], hash: '',
    user: { id: UID, email: 'new@x.com', created_at: new Date(Date.now() - MIN).toISOString(), user_metadata: {} },
    access: ACCESS(), trial: { data: { class_id: 'c1', code: 'K7QM2XPA', name: '週六班', until: new Date(Date.now() + 7 * 864e5).toISOString(), seats: 30 }, error: null },
    hydrated: true }, o || {});
}
function client(w) {
  return {
    auth: {
      /* supabase-js 拿到 session 就存進 localStorage(從 Google 回來的那一頁,是在這時才換成新帳號) */
      getSession: async () => {
        /* w.otherTab:這一頁開頁之後、getSession 之前,別的分頁寫了 localStorage 的 key(預設是登入資料,user 是別的分頁登入的帳號);
           瀏覽器在這一頁送 storage 事件(只有別的分頁寫的才會送) */
        if (w.otherTab) {
          const o = w.otherTab; delete w.otherTab;
          const key = o.key || SB_KEY;
          if (o.user) { w.user = o.user; w.local.setItem(key, JSON.stringify({ user: o.user })); } else w.local.setItem(key, '1');
          (w.winOn || []).filter(l => l.t === 'storage').forEach(l => l.fn({ key, storageArea: w.local }));
        }
        if (w.user) w.local.setItem(SB_KEY, JSON.stringify({ user: w.user }));
        return { data: { session: w.user ? { user: w.user } : null } };
      },
      signOut: async () => ({ error: null }),
      signUp: async (args) => { w.signUps.push(JSON.parse(JSON.stringify(args))); return { data: { user: w.signUpUser !== undefined ? w.signUpUser : { id: 'n', identities: [{}] }, session: null }, error: null }; },
    },
    rpc(fn, args) {
      w.rpc.push([fn, args]);
      if (fn === 'my_access') return Promise.resolve(w.access === 'error' ? { data: null, error: { message: 'x' } } : { data: JSON.parse(JSON.stringify(w.access)), error: null });
      if (fn === 'start_teacher_trial') {
        if (w.afterTrial) w.access = w.afterTrial;
        if (w.trialSeq && w.trialSeq.length) return Promise.resolve(w.trialSeq.shift());
        return Promise.resolve(w.trial);
      }
      return Promise.resolve({ data: null, error: null });
    },
    from() { const b = { select() { return b; }, eq() { return b; }, upsert() { return b; }, then(ok, bad) { return Promise.resolve({ data: [], error: null }).then(ok, bad); } }; return b; },
  };
}
const isGoogleReturn = w => (/[#&]access_token=/.test(w.hash || '') && !/[#&]type=/.test(w.hash || '')) || /[?&]code=/.test(w.search || '');
/* 開一頁:載入順序跟上線一樣 plans-config → cloud.js → paywall.js,然後送 DOMContentLoaded。
   noPaywall:模擬只載 plans-config、沒載 paywall.js 的頁面(修正前的 analysis、diagnostic、drill、history、learn) */
async function openPage(w, page, noPaywall) {
  const dom = fakeDom();
  if (w.user && w.hydrated) w.session.setItem('tr_cloud_hydrated_' + w.user.id, '1');
  /* 開頁前 localStorage 裡的登入資料:一般的頁面是 w.user;網址是 Google 導回來的那一頁,supabase-js 還沒處理網址,
     留著的是之前的登入(w.sbBefore,沒給就是沒登入過),getSession 之後才換成 w.user */
  if (isGoogleReturn(w)) {
    if (w.sbBefore) w.local.setItem(SB_KEY, JSON.stringify({ user: w.sbBefore })); else w.local.removeItem(SB_KEY);
  } else if (w.user) w.local.setItem(SB_KEY, JSON.stringify({ user: w.user }));
  /* 10 秒以上的計時器(自動開試用的等待上限)先扣著,測試用 fireHeld 手動觸發 */
  const st = (fn, ms) => { if (ms >= 10000) { const t = { fn, dead: false }; w.held.push(t); return t; } return setTimeout(fn, ms); };
  const ct = id => { if (id && typeof id === 'object' && 'dead' in id) { id.dead = true; return; } clearTimeout(id); };
  const ctx = { console: { warn() {}, log() {}, error() {} }, document: dom.document, setTimeout: st, clearTimeout: ct, Promise, URLSearchParams,
    localStorage: w.local, sessionStorage: w.session, history: { replaceState() {} }, navigator: { onLine: true, clipboard: { writeText: async () => {} } },
    location: { hash: w.hash || '', search: w.search || '', pathname: '/' + (page || 'index.html'), origin: 'https://x', href: 'https://x/' + (page || 'index.html'), reload() { w.reloads++; } },
    confirm: () => true, alert() {}, MutationObserver: undefined };
  /* window 的事件只記下來(storage 事件由 w.otherTab 觸發) */
  const winOn = []; w.winOn = winOn;
  ctx.addEventListener = (t, fn) => { winOn.push({ t, fn }); };
  ctx.removeEventListener = (t, fn) => { const i = winOn.findIndex(l => l.t === t && l.fn === fn); if (i >= 0) winOn.splice(i, 1); };
  ctx.window = ctx;
  ctx.CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'k' };
  ctx.supabase = { createClient: () => client(w) };
  vm.createContext(ctx);
  vm.runInContext(H_SRC, ctx);
  vm.runInContext(PLANS_SRC, ctx);
  if (w.paid !== false) ctx.PAID_UI = w.paid;
  try { ctx.__PROFILE_ID = JSON.parse(w.local.getItem('tr_current_profile')) || null; } catch (e) { ctx.__PROFILE_ID = null; }
  vm.runInContext(CLOUD_SRC, ctx);
  if (!noPaywall) vm.runInContext(PAYWALL_SRC, ctx);
  await dom.document.fire('DOMContentLoaded');
  await settle();
  await ctx.CLOUD.accessReady; await settle();
  return { ctx, dom, C: ctx.CLOUD };
}
const trialCalls = w => w.rpc.filter(c => c[0] === 'start_teacher_trial');
const fireHeld = async w => { w.held.splice(0).forEach(t => { if (!t.dead) t.fn(); }); await settle(); await settle(); };
/* Google 同意頁導回來的網址(implicit flow):# 後面帶 access_token,沒有 type= */
const GOOGLE_HASH = '#access_token=eyJ.x.y&expires_at=1&expires_in=3600&provider_token=ya29&refresh_token=r1&token_type=bearer';
/* 這個分頁從 Google 回來的那一次載入:supabase-js 從網址拿到 Google 帳號的 session(w.user),灌資料、重載;
   cloud.js 在 getSession 之後把意向綁上這個帳號 id。之後的 openPage(w) 是重載後那一頁。
   世界設定成「還沒灌過」(hydrated:false)的,回來這一頁寫的灌資料旗標擦掉,讓後面的 openPage 照它原本的設定走 */
async function backFromGoogle(w, hash, page) {
  await openPage(Object.assign({}, w, { hash: hash || GOOGLE_HASH, hydrated: false }), page || 'index.html');
  if (w.user && !w.hydrated) w.session.removeItem('tr_cloud_hydrated_' + w.user.id);
}
const dialog = p => p.dom.body.byClass('modal-trial')[0] || null;
/* Email 註冊成功時 signUp 回來的帳號 id 綁上這台的意向(cloud.js bindEmailIntent 做的事) */
const stampUid = (w, id) => w.local.setItem('tr_signup_intent', JSON.stringify(Object.assign(JSON.parse(w.local.getItem('tr_signup_intent')), { uid: id })));
const intentLeft = w => w.local.getItem('tr_signup_intent') || w.session.getItem('tr_signup_intent');
/* 註冊那一頁存的意向(用真的 cloud.js 存,Google 那條才進得了這個分頁的 sessionStorage) */
async function saveIntent(w, o, at, stay) {
  const p = await openPage(Object.assign({}, w, { user: null, paid: w.paid, hash: '' }), 'signup.html');
  p.C.saveSignupIntent(o, at);
  if (!o.email && !stay) await backFromGoogle(w);   // Google 那條:接著就是轉跳 Google、回到這個分頁
}

cases['Google 那條全部成立:重載後那一頁自動開一次,顯示邀請碼與前往教師後台;意向讀過就清掉'] = async () => {
  const w = world();
  await saveIntent(w, { seats: 30, name: '週六班' }, Date.now() - 2 * MIN);
  const p = await openPage(w);
  const d = dialog(p);
  const calls = trialCalls(w);
  const code = d && d.byClass('trial-code')[0];
  const go = d && d.byClass('trial-go')[0];
  const r = { calls: calls.length, args: calls[0] && calls[0][1], code: code && code.textContent, go: go && go.attrs.href, h: d && norm(d.byTag('h2')[0].textContent), left: intentLeft(w) };
  return { ok: r.calls === 1 && r.args.p_seats === 30 && r.args.p_class_name === '週六班' && r.code === 'K7QM2XPA' && r.go === 'admin.html'
    && r.h === '老師試用已開始' && r.left === null, detail: JSON.stringify(r) };
};

cases['同一個註冊最多開一次:之後再重載、再開別頁都不再呼叫'] = async () => {
  const w = world();
  await saveIntent(w, { seats: 10, name: '' }, Date.now() - 2 * MIN);
  await openPage(w); await openPage(w); await openPage(w, 'me.html');
  return { ok: trialCalls(w).length === 1, detail: '呼叫 ' + trialCalls(w).length + ' 次' };
};

cases['剛登入、這一頁要灌資料重載:這一頁不讀意向也不開,留給重載後那一頁(合計一次)'] = async () => {
  const w = world({ hydrated: false });
  await saveIntent(w, { seats: 10, name: '' }, Date.now() - 2 * MIN);
  const p1 = await openPage(w);
  const first = { calls: trialCalls(w).length, left: !!intentLeft(w), reloads: w.reloads, dialog: !!dialog(p1) };
  await openPage(w);   // 重載後那一頁(灌資料時已經寫了 hydrated 旗標)
  return { ok: first.calls === 0 && first.left && first.reloads === 1 && !first.dialog && trialCalls(w).length === 1,
    detail: JSON.stringify(first) + ' 之後 ' + trialCalls(w).length };
};

cases['Email 那條:綁上這個帳號 id 才開;Email 不同(沒綁 id)不開,而且意向清掉'] = async () => {
  const w1 = world();
  await saveIntent(w1, { seats: 30, name: 'A 班', email: 'NEW@x.com' }, Date.now() - 5 * MIN);
  stampUid(w1, UID);
  await openPage(w1);
  const w2 = world();
  await saveIntent(w2, { seats: 30, name: 'A 班', email: 'other@x.com' }, Date.now() - 5 * MIN);
  const p2 = await openPage(w2);
  return { ok: trialCalls(w1).length === 1 && trialCalls(w2).length === 0 && intentLeft(w2) === null && !dialog(p2),
    detail: trialCalls(w1).length + ' / ' + trialCalls(w2).length };
};

cases['既有帳號(帳號比意向早 2 分鐘以上建立)、超過 30 分鐘、資料庫說不能試用、讀不到使用權:都不開'] = async () => {
  const runs = [
    world({ user: { id: UID, email: 'new@x.com', created_at: '2026-01-01T00:00:00Z' } }),
    world(),
    world({ access: ACCESS({ teacher_trial_available: false }) }),
    world({ access: 'error' }),
  ];
  const ats = [Date.now() - 2 * MIN, Date.now() - 31 * MIN, Date.now() - 2 * MIN, Date.now() - 2 * MIN];
  const out = [];
  for (let i = 0; i < runs.length; i++) {
    await saveIntent(runs[i], { seats: 10, name: '' }, ats[i]);
    const p = await openPage(runs[i]);
    out.push(trialCalls(runs[i]).length + (dialog(p) ? 'D' : '') + (intentLeft(runs[i]) ? 'L' : ''));
  }
  return { ok: out.every(x => x === '0'), detail: out.join(',') };
};

cases['Google 那條只認這個分頁 sessionStorage 存的:別人塞進 localStorage 沒有 Email 的意向不開'] = async () => {
  const w = world();
  w.local.setItem('tr_signup_intent', JSON.stringify({ seats: 10, name: '', at: Date.now() - MIN }));
  const p = await openPage(w);
  return { ok: trialCalls(w).length === 0 && !dialog(p) && intentLeft(w) === null, detail: String(trialCalls(w).length) };
};

cases['還沒登入(在等驗證信):意向不讀、不清'] = async () => {
  const w = world({ user: null });
  await saveIntent(w, { seats: 10, name: '', email: 'new@x.com' }, Date.now() - MIN);
  await openPage(w, 'signup.html');
  return { ok: trialCalls(w).length === 0 && !!intentLeft(w), detail: String(intentLeft(w)) };
};

cases['PAID_UI 沒開:有意向也不讀、不開、不畫任何東西'] = async () => {
  const w = world({ paid: false });
  await saveIntent(Object.assign({}, w, { paid: true }), { seats: 10, name: '' }, Date.now() - MIN, true);
  w.session.setItem('tr_signup_intent', JSON.stringify({ seats: 10, name: '', at: Date.now() - MIN }));
  const p = await openPage(w);
  return { ok: w.rpc.length === 0 && !!intentLeft(w) && p.dom.body.children.length === 0, detail: 'rpc ' + w.rpc.length + ' / 節點 ' + p.dom.body.children.length };
};

cases['開通失敗:資料庫的訊息原樣顯示,沒有邀請碼與前往教師後台'] = async () => {
  const w = world({ trial: { data: null, error: { message: '老師試用每個帳號只能開始一次' } } });
  await saveIntent(w, { seats: 10, name: '' }, Date.now() - MIN);
  const p = await openPage(w);
  const d = dialog(p);
  const msg = d && d.byClass('auth-msg').find(n => n.className.includes('bad'));
  return { ok: !!d && msg && msg.textContent === '老師試用每個帳號只能開始一次。' && d.byClass('trial-go').length === 0 && d.byClass('trial-code').length === 0
    && trialCalls(w).length === 1, detail: d ? norm(d.textContent) : '沒有視窗' };
};

cases['回應在半路遺失但試用其實開了:重新查使用權看得出來就當成功(沒有邀請碼就請聯絡站長)'] = async () => {
  const w = world({ trial: { data: null, error: { message: 'TypeError: Failed to fetch' } },
    afterTrial: ACCESS({ teacher_source: 'trial', is_teacher: true, role: 'teacher', teacher_trial_available: false, teacher_until: new Date(Date.now() + 7 * 864e5).toISOString() }) });
  await saveIntent(w, { seats: 10, name: '' }, Date.now() - MIN);
  const p = await openPage(w);
  const d = dialog(p);
  return { ok: !!d && norm(d.byTag('h2')[0].textContent) === '老師試用已開始' && /沒有收到班級邀請碼/.test(d.textContent), detail: d ? norm(d.textContent) : '沒有視窗' };
};

cases['登出:清掉意向(localStorage 與 sessionStorage 都清)'] = async () => {
  const w = world();
  const p = await openPage(w, 'me.html');
  p.C.saveSignupIntent({ seats: 10, name: '', email: 'x@x.com' });
  w.session.setItem('tr_signup_intent', JSON.stringify({ seats: 10, name: '', at: Date.now() }));
  await p.C.logout();
  return { ok: intentLeft(w) === null && w.reloads >= 1, detail: String(intentLeft(w)) };
};

cases['手動的開始老師試用視窗照舊:成功畫面同一套(班名、邀請碼、複製、前往教師後台、關閉)'] = async () => {
  const w = world({ user: { id: UID, email: 'old@x.com', created_at: '2026-01-01T00:00:00Z' } });
  const p = await openPage(w, 'me.html');
  p.ctx.PAYWALL.trialDialog(null, () => {});
  const d = dialog(p);
  const head = d && norm(d.byTag('h2')[0].textContent);
  await d.byTag('form')[0].fire('submit'); await settle();
  const after = dialog(p);
  const parts = after && ['trial-class', 'trial-code', 'trial-copy', 'trial-go', 'trial-cancel', 'modal-close'].map(c => after.byClass(c).length).join('');
  return { ok: head === '用這個帳號開始老師試用？' && parts === '111111' && after.byClass('trial-code')[0].textContent === 'K7QM2XPA',
    detail: head + ' / ' + parts };
};

/* ======================================================================= */
/* 三、審查後補的情境                                                       */
/* ======================================================================= */
cases['沒載入 plans-config 的頁面(PAID_UI 未定義):切到登入、Google 登入、密碼登入、Google 註冊、Email 註冊都先清意向'] = async () => {
  const seq = [];
  const a = loadCard({ plans: false, mode: 'login' });
  await a.card.byText('註冊')[0].click(); await settle();
  await a.card.byText('登入')[0].click(); await settle();
  seq.push(a.log.map(x => x[0]).join(','));
  const b = loadCard({ plans: false, mode: 'login' });
  await b.card.byClass('btn-google')[0].click(); await settle();
  seq.push(b.log.map(x => x[0]).join(','));
  const c = loadCard({ plans: false, mode: 'login' });
  fieldInput(c.card, 'Email').value = 'a@x.com'; fieldInput(c.card, '密碼').value = 'x';
  await c.card.byTag('form')[0].fire('submit'); await settle();
  seq.push(c.log.map(x => x[0]).join(','));
  const d = loadCard({ plans: false });
  await d.card.byClass('btn-google')[0].click(); await settle();
  seq.push(d.log.map(x => x[0]).join(','));
  const e = loadCard({ plans: false });
  await fillAndSubmit(e.card, { name: '小安', email: 'b@x.com', pw: '12345678' });
  seq.push(e.log.map(x => x[0]).join(','));
  const want = ['clear', 'clear,google', 'clear,login', 'clear,google', 'clear,signUp'];
  return { ok: seq.join(' / ') === want.join(' / '), detail: seq.join(' / ') };
};

cases['A 選老師按 Google 又退回來,B 在同一個分頁的 diagnostic(沒有 plans-config)用登入分頁的 Google 開新帳號:下一個付費頁不開試用'] = async () => {
  const w = world({ user: null });
  await saveIntent(w, { seats: 60, name: '老師的班' }, Date.now() - MIN, true);   // 按了 Google,在 Google 頁按上一頁:沒有回來的網址
  const leftA = !!w.session.getItem('tr_signup_intent');
  const page = loadCard({ plans: false, mode: 'login', world: w });               // diagnostic.html 的強制登入視窗
  await page.card.byClass('btn-google')[0].click(); await settle();
  const leftB = intentLeft(w);
  w.user = { id: UID, email: 'kid2@gmail.com', created_at: new Date(Date.now() - 0.2 * MIN).toISOString(), user_metadata: {} };
  w.hydrated = false;
  await openPage(Object.assign(w, { hash: GOOGLE_HASH }), 'diagnostic.html');   // B 從 Google 回來,灌資料、重載
  w.hash = '';
  await openPage(w, 'reading.html');
  return { ok: leftA && leftB === null && trialCalls(w).length === 0, detail: 'A 留下 ' + leftA + ' / B 按下去後 ' + leftB + ' / 試用呼叫 ' + trialCalls(w).length };
};

cases['Google 意向只認這個分頁自己從 Google 回來的那一次:別的分頁登入的新帳號(退回、取消都一樣)不開,意向清掉'] = async () => {
  const out = [];
  for (const how of ['back', 'cancel']) {
    const w = world();
    await saveIntent(w, { seats: 30, name: 'A班' }, Date.now() - 2 * MIN, true);
    if (how === 'cancel') await backFromGoogle(w, '#error=access_denied&error_description=The+user+denied');
    /* 分頁 B 用學生註冊 stu2,在分頁 C 點驗證信;分頁 A 再開頁:supabase-js 從 localStorage 讀到 stu2 的登入 */
    w.user = { id: UID, email: 'stu2@gmail.com', created_at: new Date(Date.now() - MIN).toISOString(), user_metadata: {} };
    w.hydrated = false;
    const p1 = await openPage(w, 'me.html');
    const p2 = await openPage(w, 'me.html');
    out.push(how + ' 呼叫 ' + trialCalls(w).length + ' 視窗 ' + (!!dialog(p1) || !!dialog(p2)) + ' 留下 ' + intentLeft(w));
  }
  return { ok: out.every(x => /呼叫 0 視窗 false 留下 null$/.test(x)), detail: out.join(' / ') };
};

cases['Google 回來是錯誤(使用者取消):意向當場清掉'] = async () => {
  const w = world({ user: null });
  await saveIntent(w, { seats: 30, name: 'A班' }, Date.now() - MIN, true);
  await backFromGoogle(w, '#error=access_denied&error_code=403&error_description=The+user+denied');
  return { ok: intentLeft(w) === null, detail: String(intentLeft(w)) };
};

cases['這個分頁打開的是 Email 驗證連結(# 帶 type=signup):不算從 Google 回來,Google 那條不開'] = async () => {
  const w = world();
  await saveIntent(w, { seats: 30, name: 'A班' }, Date.now() - MIN, true);
  w.hydrated = false;
  await openPage(Object.assign(w, { hash: '#access_token=eyJ&expires_in=3600&refresh_token=r&token_type=bearer&type=signup' }));
  w.hash = '';
  await openPage(w);
  return { ok: trialCalls(w).length === 0, detail: '呼叫 ' + trialCalls(w).length };
};

cases['從 Google 回來的那一頁要灌資料重載:回來時記下,重載後那一頁照常開一次'] = async () => {
  const w = world({ hydrated: false });
  await saveIntent(w, { seats: 30, name: 'A班' }, Date.now() - 2 * MIN, true);
  await openPage(Object.assign(w, { hash: GOOGLE_HASH }));
  const first = trialCalls(w).length;
  w.hash = '';
  await openPage(w); await openPage(w);
  return { ok: first === 0 && w.reloads === 1 && trialCalls(w).length === 1, detail: first + ' → ' + trialCalls(w).length + ' 重載 ' + w.reloads };
};

cases['裝置時鐘跟伺服器差很多:用 server_now 校正,既有帳號不會被當成新的,新帳號也不會錯過'] = async () => {
  const C = (await openPage(world({ user: null }), 'signup.html')).C;
  const T = Date.parse('2026-10-11T10:00:00Z');
  const run = (offsetMin, ageMin) => {
    const S = T + offsetMin * MIN;   // 伺服器時間 = 裝置時間 + 差
    const user = { id: UID, email: 'was@gmail.com', created_at: new Date(S - ageMin * MIN).toISOString() };
    return C.trialIntentOk({ seats: 10, name: '', email: 'was@gmail.com', uid: UID, at: T - MIN }, user, { teacher_trial_available: true, server_now: new Date(S).toISOString() }, T);
  };
  const r = {
    behind60_old40: run(60, 40), behind10_old5: run(10, 5),
    ahead3_new: run(-3, 0.5), ahead5_new: run(-5, 0.5), ahead1_new: run(-1, 0.5),
    same_new: run(0, 0.5), same_old40: run(0, 40),
  };
  const ok = !r.behind60_old40 && !r.behind10_old5 && r.ahead3_new && r.ahead5_new && r.ahead1_new && r.same_new && !r.same_old40;
  return { ok, detail: JSON.stringify(r) };
};

cases['自動開的視窗:開通中把焦點放在標題,Tab 不會跑到後面的頁面'] = async () => {
  const w = world({ trial: new Promise(() => {}) });
  await saveIntent(w, { seats: 10, name: '' }, Date.now() - MIN);
  const p = await openPage(w);
  const d = dialog(p);
  const head = d && d.byTag('h2')[0];
  let prevented = false;
  await p.dom.document.fire('keydown', { key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
  return { ok: !!d && p.dom.document.activeElement === head && head.attrs.tabindex === '-1' && prevented,
    detail: (d ? norm(d.textContent) : '沒有視窗') + ' 焦點 ' + (p.dom.document.activeElement && p.dom.document.activeElement.tagName) + ' 擋 Tab ' + prevented };
};

cases['自動開試用 15 秒沒有回應:不再卡住,可以關,告訴她到「我的」頁看;晚到的回應不再改畫面'] = async () => {
  let late;
  const w = world({ trial: new Promise(r => { late = r; }) });
  await saveIntent(w, { seats: 10, name: '' }, Date.now() - MIN);
  const p = await openPage(w);
  const d = dialog(p);
  if (!d) return { ok: false, detail: '沒有視窗' };
  const busyClose = d.byClass('modal-close')[0].disabled;
  await fireHeld(w);
  const text = norm(d.textContent);
  const closeOk = d.byClass('modal-close')[0].disabled === false;
  const retry = d.byText('再試一次').length;
  late({ data: { code: 'LATE0000' }, error: null }); await settle();
  const after = norm(d.textContent);
  await p.dom.document.fire('keydown', { key: 'Escape' }); await settle();
  return { ok: busyClose === true && closeOk && /我的/.test(text) && !/開通中/.test(text) && retry === 1 && after === text && !dialog(p),
    detail: text + ' | 關閉鈕 ' + closeOk + ' | 晚到後 ' + (after === text ? '沒變' : after) + ' | Esc 後 ' + (dialog(p) ? '還在' : '關了') };
};

cases['自動開失敗:有「再試一次」,再按一次成功就顯示邀請碼'] = async () => {
  const w = world({ trialSeq: [{ data: null, error: { message: 'TypeError: Failed to fetch' } }] });
  await saveIntent(w, { seats: 30, name: '週六班' }, Date.now() - MIN);
  const p = await openPage(w);
  const d = dialog(p);
  if (!d) return { ok: false, detail: '沒有視窗' };
  const first = norm(d.textContent);
  const btn = d.byText('再試一次')[0];
  if (!btn) return { ok: false, detail: '沒有再試一次:' + first };
  await btn.click(); await settle(); await settle();
  const calls = trialCalls(w);
  const code = d.byClass('trial-code')[0];
  return { ok: /連不上雲端伺服器/.test(first) && calls.length === 2 && calls[1][1].p_seats === 30 && calls[1][1].p_class_name === '週六班' && !!code && code.textContent === 'K7QM2XPA',
    detail: first + ' → 呼叫 ' + calls.length + ' 次 ' + (code ? code.textContent : norm(d.textContent)) };
};

cases['過期或時間在未來的意向:任何一頁載入(沒登入也是)就清掉;30 分鐘內的留著'] = async () => {
  const w1 = world({ user: null });
  w1.local.setItem('tr_signup_intent', JSON.stringify({ seats: 10, name: '', at: Date.now() - 5 * 60 * MIN, email: 'someone@school.edu' }));
  w1.session.setItem('tr_signup_intent', JSON.stringify({ seats: 10, name: '', at: Date.now() - 40 * MIN }));
  await openPage(w1, 'index.html');
  const w2 = world({ user: null });
  w2.local.setItem('tr_signup_intent', JSON.stringify({ seats: 10, name: '', at: Date.now() + 10 * MIN, email: 'a@x.com' }));
  await openPage(w2, 'reading.html');
  const w3 = world({ user: null });
  w3.local.setItem('tr_signup_intent', JSON.stringify({ seats: 10, name: '', at: Date.now() - 5 * MIN, email: 'a@x.com' }));
  await openPage(w3, 'index.html');
  const r = [intentLeft(w1), intentLeft(w2), !!intentLeft(w3)];
  return { ok: r[0] === null && r[1] === null && r[2] === true, detail: JSON.stringify(r) };
};

/* ======================================================================= */
/* 四、意向綁帳號(站長選保守做法:不寫 user_metadata、綁帳號 id)             */
/* ======================================================================= */
const OTHER = '9a8b7c6d-1111-4222-8333-444455556666';
const EXPECT_SIGNUP = data => JSON.stringify(data) === '{"name":"小安"}';

cases['signUp 送出去的跟 HEAD 一模一樣:不論有沒有意向、多傳第四個參數,都不帶 intent'] = async () => {
  const w = world({ user: null });
  const p = await openPage(w, 'signup.html');
  p.C.saveSignupIntent({ seats: 30, name: '週六班', email: 'a@x.com' }, Date.now() - MIN);
  await p.C.signUp('a@x.com', '12345678', '小安');
  await p.C.signUp('a@x.com', '12345678', '小安', { seats: 30, name: '週六班', at: 1700000000000, email: 'a@x.com' });
  const shapes = w.signUps.map(a => Object.keys(a).sort().join(',') + '|' + Object.keys(a.options).sort().join(','));
  const ok = w.signUps.length === 2 && w.signUps.every(a => EXPECT_SIGNUP(a.options.data) && a.email === 'a@x.com' && a.password === '12345678'
    && a.options.emailRedirectTo === 'https://x/index.html') && shapes.every(s => s === 'email,options,password|data,emailRedirectTo');
  return { ok, detail: JSON.stringify(w.signUps.map(a => a.options.data)) + ' ' + shapes.join(' ; ') };
};

cases['帳號資料裡的 user_metadata.intent 一律不讀:新帳號、這台沒有意向,換幾頁都不自動開'] = async () => {
  const meta = { seats: 30, name: '週六班', at: Date.now() - 4 * MIN };
  const w = world({ user: { id: UID, email: 'wang@x.com', created_at: new Date(Date.now() - 3 * MIN).toISOString(), user_metadata: { name: '王老師', intent: meta } } });
  const p = await openPage(w); await openPage(w); await openPage(w, 'me.html');
  const took = p.C.takeSignupIntent();
  return { ok: trialCalls(w).length === 0 && took === null, detail: '呼叫 ' + trialCalls(w).length + ' / take ' + JSON.stringify(took) };
};

cases['tr_signup_intent_used 不再寫;這台留著的舊鍵開頁就清掉(有沒有登入都一樣)'] = async () => {
  const w1 = world({ user: null });
  w1.local.setItem('tr_signup_intent_used', UID);
  await openPage(w1, 'index.html');
  const w2 = world();
  w2.local.setItem('tr_signup_intent_used', OTHER);
  await openPage(w2, 'reading.html');
  /* 自動開成功一次的整個流程裡也不寫 */
  const w3 = world();
  await saveIntent(w3, { seats: 10, name: '', email: 'new@x.com' }, Date.now() - 2 * MIN);
  stampUid(w3, UID);
  await openPage(w3); await openPage(w3);
  const r = [w1.local.getItem('tr_signup_intent_used'), w2.local.getItem('tr_signup_intent_used'), w3.local.getItem('tr_signup_intent_used'), trialCalls(w3).length];
  return { ok: r[0] === null && r[1] === null && r[2] === null && r[3] === 1, detail: JSON.stringify(r) };
};

cases['Google 回來那一頁:getSession 拿到帳號就把意向綁上帳號 id;沒有 session(或雲端初始化失敗)就丟掉'] = async () => {
  const w = world({ hydrated: false });
  await saveIntent(w, { seats: 30, name: 'A班' }, Date.now() - MIN, true);
  await backFromGoogle(w);
  let stamped = null;
  try { stamped = JSON.parse(w.session.getItem('tr_signup_intent')); } catch (e) { stamped = null; }
  const w2 = world({ user: null });
  await saveIntent(w2, { seats: 30, name: 'A班' }, Date.now() - MIN, true);
  await backFromGoogle(w2);
  const w3 = world({ hydrated: false });
  await saveIntent(w3, { seats: 30, name: 'A班' }, Date.now() - MIN, true);
  const sb = { createClient() { throw new Error('boom'); } };
  await (async () => {   // 雲端元件壞掉:getSession 根本沒跑
    const dom = fakeDom();
    const ctx = { console: { warn() {}, log() {}, error() {} }, document: dom.document, setTimeout, clearTimeout, Promise, URLSearchParams,
      localStorage: w3.local, sessionStorage: w3.session, history: { replaceState() {} }, navigator: { onLine: true },
      location: { hash: GOOGLE_HASH, search: '', pathname: '/index.html', origin: 'https://x', href: 'https://x/index.html', reload() {} }, addEventListener() {}, supabase: sb };
    ctx.window = ctx; ctx.CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'k' };
    vm.createContext(ctx); vm.runInContext(PLANS_SRC, ctx); ctx.PAID_UI = true;
    vm.runInContext(CLOUD_SRC, ctx); await ctx.CLOUD.ready; await settle();
  })();
  const r = { uid: stamped && stamped.uid, noSession: w2.session.getItem('tr_signup_intent'), broken: w3.session.getItem('tr_signup_intent') };
  return { ok: r.uid === UID && r.noSession === null && r.broken === null, detail: JSON.stringify(r) };
};

cases['Google 意向綁的是別的帳號 id:不開,而且清掉'] = async () => {
  const w = world();
  await saveIntent(w, { seats: 30, name: 'A班' }, Date.now() - 2 * MIN, true);
  await backFromGoogle(Object.assign(w, { user: Object.assign({}, w.user, { id: OTHER }) }));   // 綁上 OTHER
  w.user = Object.assign({}, w.user, { id: UID });                                                 // 這個分頁接著讀到的是另一個新帳號
  const p = await openPage(w);
  return { ok: trialCalls(w).length === 0 && intentLeft(w) === null && !dialog(p), detail: '呼叫 ' + trialCalls(w).length + ' 留下 ' + intentLeft(w) };
};

cases['sessionStorage 裡沒綁帳號 id 的 Google 意向(舊格式 returned:true 也一樣):不開,清掉'] = async () => {
  const out = [];
  for (const v of [{ seats: 10, name: '', at: Date.now() - MIN }, { seats: 10, name: '', at: Date.now() - MIN, returned: true }]) {
    const w = world();
    w.session.setItem('tr_signup_intent', JSON.stringify(v));
    const p = await openPage(w);
    out.push(trialCalls(w).length + (dialog(p) ? 'D' : '') + (intentLeft(w) ? 'L' : ''));
  }
  return { ok: out.every(x => x === '0'), detail: out.join(',') };
};

cases['Email 註冊成功:把 signUp 回來的帳號 id 綁上這台的意向;登入的是這個 id 才開'] = async () => {
  const w = world({ user: null, signUpUser: { id: UID, identities: [{}] } });
  const p = await openPage(w, 'signup.html');
  p.C.saveSignupIntent({ seats: 30, name: '週六班', email: 'New@x.com' }, Date.now() - 2 * MIN);
  await p.C.signUp('new@x.com', '12345678', '王老師');
  let saved = null;
  try { saved = JSON.parse(w.local.getItem('tr_signup_intent')); } catch (e) { saved = null; }
  w.user = { id: UID, email: 'new@x.com', created_at: new Date(Date.now() - MIN).toISOString(), user_metadata: {} };
  await openPage(w);
  return { ok: !!saved && saved.uid === UID && saved.email === 'new@x.com' && trialCalls(w).length === 1 && intentLeft(w) === null,
    detail: JSON.stringify(saved) + ' 呼叫 ' + trialCalls(w).length };
};

cases['Email 意向綁了帳號 id:同一個 Email 刪掉重建成學生(新 id),新帳號不開,意向清掉'] = async () => {
  const w = world({ user: null, signUpUser: { id: OTHER, identities: [{}] } });
  const p = await openPage(w, 'signup.html');
  p.C.saveSignupIntent({ seats: 30, name: '週六班', email: 'new@x.com' }, Date.now() - 3 * MIN);
  await p.C.signUp('new@x.com', '12345678', '王老師');               // 第一個帳號 OTHER(之後刪掉了)
  w.user = { id: UID, email: 'new@x.com', created_at: new Date(Date.now() - MIN).toISOString(), user_metadata: {} };   // 同 Email 重建的學生帳號
  const p2 = await openPage(w);
  return { ok: trialCalls(w).length === 0 && intentLeft(w) === null && !dialog(p2), detail: '呼叫 ' + trialCalls(w).length + ' 留下 ' + intentLeft(w) };
};

cases['Email 意向沒綁到 id(signUp 沒回 id):不退回比 Email,Email 一樣、不同都不開,清掉'] = async () => {
  const w1 = world({ user: null, signUpUser: null });
  const p1 = await openPage(w1, 'signup.html');
  p1.C.saveSignupIntent({ seats: 10, name: '', email: 'new@x.com' }, Date.now() - 2 * MIN);
  await p1.C.signUp('new@x.com', '12345678', '王老師');
  const noUid = !('uid' in (JSON.parse(w1.local.getItem('tr_signup_intent')) || { uid: 1 }));
  w1.user = world().user;
  await openPage(w1);
  const w2 = world();
  w2.local.setItem('tr_signup_intent', JSON.stringify({ seats: 10, name: '', at: Date.now() - 2 * MIN, email: 'someone@else.com' }));
  const p2 = await openPage(w2);
  const took = p2.C.takeSignupIntent();
  return { ok: noUid && trialCalls(w1).length === 0 && intentLeft(w1) === null && trialCalls(w2).length === 0 && intentLeft(w2) === null && took === null,
    detail: 'noUid ' + noUid + ' / 同 Email ' + trialCalls(w1).length + ' / 別的 Email ' + trialCalls(w2).length };
};

cases['takeSignupIntent 直接讀:Email 意向的 Email 跟登入的帳號不同,或綁的 id 不同,回 null 並清掉'] = async () => {
  const w = world();
  const p = await openPage(w, 'me.html');
  const C = p.C;
  w.local.setItem('tr_signup_intent', JSON.stringify({ seats: 10, name: '', at: Date.now() - MIN, email: 'other@x.com' }));
  const a = C.takeSignupIntent(); const la = intentLeft(w);
  w.local.setItem('tr_signup_intent', JSON.stringify({ seats: 10, name: '', at: Date.now() - MIN, email: 'new@x.com', uid: OTHER }));
  const b = C.takeSignupIntent(); const lb = intentLeft(w);
  w.local.setItem('tr_signup_intent', JSON.stringify({ seats: 10, name: '', at: Date.now() - MIN, email: 'new@x.com', uid: UID }));
  const c = C.takeSignupIntent();
  return { ok: a === null && la === null && b === null && lb === null && !!c && c.seats === 10, detail: JSON.stringify([a, b, c]) };
};

cases['A 在沒有 paywall 的頁面(drill)用 Google 註冊成老師回來,意向留著;同一個分頁之後換成另一個新帳號 B,付費頁不開給 B'] = async () => {
  const w = world({ hydrated: false, user: Object.assign({}, world().user, { id: OTHER, email: 'a@gmail.com' }) });
  await saveIntent(w, { seats: 30, name: 'A班' }, Date.now() - 2 * MIN, true);
  await openPage(Object.assign({}, w, { hash: GOOGLE_HASH }), 'drill.html', true);   // A 從 Google 回到 drill(沒載 paywall.js)
  await openPage(w, 'drill.html', true);                                              // 重載後那一頁,也沒有 paywall.js
  const leftA = !!intentLeft(w);
  /* 別的分頁換成 B 登入(新帳號、可以試用);這個分頁接著開付費頁,supabase-js 讀到的是 B */
  w.user = { id: UID, email: 'b@gmail.com', created_at: new Date(Date.now() - 0.5 * MIN).toISOString(), user_metadata: {} };
  w.local.setItem('tr_current_profile', JSON.stringify('c' + UID.replace(/-/g, '')));
  w.hydrated = true;
  const p = await openPage(w, 'reading.html');
  return { ok: leftA && trialCalls(w).length === 0 && !dialog(p) && intentLeft(w) === null, detail: 'A 留著 ' + leftA + ' / B 呼叫 ' + trialCalls(w).length + ' / 留下 ' + intentLeft(w) };
};

/* 頁面上的 <script src> 清單 */
const scriptsOf = f => Array.from(read(f).matchAll(/<script[^>]*\ssrc="([^"]+)"/g)).map(m => m[1]);
const FIVE = ['analysis.html', 'diagnostic.html', 'drill.html', 'history.html', 'learn.html'];

cases['載入 plans-config 與 cloud.js 的每一頁都載入 paywall.js(在 cloud.js、profile.js 之後);這五頁也是'] = async () => {
  const pages = fs.readdirSync(REPO).filter(f => /\.html$/.test(f));
  const bad = [];
  pages.forEach(f => {
    const s = scriptsOf(f);
    if (s.indexOf('js/plans-config.js') < 0 || s.indexOf('js/cloud.js') < 0) return;
    const pw = s.indexOf('js/paywall.js');
    if (pw < 0 || pw < s.indexOf('js/cloud.js') || (s.indexOf('js/profile.js') >= 0 && pw < s.indexOf('js/profile.js'))) bad.push(f);
  });
  const five = FIVE.map(f => scriptsOf(f).indexOf('js/paywall.js') >= 0);
  return { ok: bad.length === 0 && five.every(Boolean), detail: '缺 ' + JSON.stringify(bad) + ' 五頁 ' + five.join(',') };
};

cases['五頁(不收費的頁面):登入完成那一頁把意向用掉,不蓋付費牆、沒有試用提示條;使用權過期也不擋;PAID_UI 沒開一個節點都不多'] = async () => {
  const out = [];
  for (const f of FIVE) {
    const w = world();
    await saveIntent(w, { seats: 10, name: '' }, Date.now() - 2 * MIN, true);
    await backFromGoogle(w, GOOGLE_HASH, f);
    const p = await openPage(w, f);
    const used = trialCalls(w).length === 1 && intentLeft(w) === null;
    const noMask = p.dom.body.byClass('pw-mask').length === 0;
    /* 過期的帳號:不收費的頁面不擋 */
    const ex = world({ access: ACCESS({ active: false, source: 'none', until: null, trial_until: '2026-01-01T00:00:00Z', teacher_trial_available: false }) });
    const pe = await openPage(ex, f);
    const exOk = pe.dom.body.byClass('pw-mask').length === 0 && pe.dom.body.byClass('trial-note').length === 0 && pe.dom.body.children.length === 0;
    /* PAID_UI 沒開:有意向也不讀、不畫 */
    const off = world({ paid: false });
    off.session.setItem('tr_signup_intent', JSON.stringify({ seats: 10, name: '', at: Date.now() - MIN, uid: UID }));
    const po = await openPage(off, f);
    const offOk = off.rpc.length === 0 && po.dom.body.children.length === 0 && !!intentLeft(off);
    out.push(f + ':' + [used, noMask, exOk, offOk].map(x => (x ? 1 : 0)).join(''));
  }
  return { ok: out.every(x => /:1111$/.test(x)), detail: out.join(' ') };
};

cases['強制登入視窗選了老師:Shift+Tab 從身分選項往回繞到視窗最後一個,不會跑出視窗'] = async () => {
  const { ctx, dom } = loadCard({ paid: true, mode: 'login' });
  dom.body.setAttribute('data-require-profile', '');
  ctx.PROFILE.showLogin('signup');
  const box = dom.body.byClass('modal-auth')[0];
  const tea = await pick(box, 'teacher');
  tea.focus();
  let prevented = false;
  await box.fire('keydown', { key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } });
  const f = box.querySelectorAll('button,input,a[href]').filter(x => !x.disabled);
  return { ok: prevented && dom.document.activeElement === f[f.length - 1], detail: '擋下 ' + prevented + ' 焦點 ' + norm(dom.document.activeElement.textContent || dom.document.activeElement.tagName) };
};

cases['選老師時暱稱下面「老師會看到這個名字」藏起來,改回學生再出現'] = async () => {
  const { card } = loadCard({ paid: true });
  const hint = () => card.byClass('auth-hint').find(n => norm(n.textContent) === '老師會看到這個名字');
  const a = hint().shown;
  await pick(card, 'teacher');
  const b = hint().shown;
  await pick(card, 'student');
  const c = hint().shown;
  return { ok: a === true && b === false && c === true, detail: [a, b, c].join(',') };
};

/* ======================================================================= */
/* 五、打開 PAID_UI 前補的兩個洞(路線圖 3.1)                               */
/* ======================================================================= */
cases['特製的 ?code= 網址:session 是開頁前這台就登入著的帳號,不算從 Google 回來,意向丟掉、不開'] = async () => {
  /* 分頁 A 選老師按 Google 又退回來(意向留在 sessionStorage);別的分頁登入了新帳號 B(可以試用);分頁 A 被導到 ?code=forged */
  const w = world({ hydrated: false });
  await saveIntent(w, { seats: 30, name: 'A班' }, Date.now() - 2 * MIN, true);
  await openPage(Object.assign(w, { search: '?code=forged', sbBefore: w.user }));
  const stamped = w.session.getItem('tr_signup_intent');
  w.search = ''; delete w.sbBefore;
  const p = await openPage(w); await openPage(w, 'me.html');
  return { ok: stamped === null && trialCalls(w).length === 0 && intentLeft(w) === null && !dialog(p),
    detail: '回來那頁留下 ' + stamped + ' / 呼叫 ' + trialCalls(w).length + ' / 留下 ' + intentLeft(w) };
};

cases['真的從 Google 回來、開頁前這台登入的是別的帳號(或沒登入):照常綁上新帳號 id,重載後開一次'] = async () => {
  const out = [];
  for (const before of [null, { id: OTHER, email: 'old@x.com', created_at: '2026-01-01T00:00:00Z' }]) {
    const w = world({ hydrated: false });
    await saveIntent(w, { seats: 30, name: 'A班' }, Date.now() - 2 * MIN, true);
    await openPage(Object.assign(w, { search: '?code=real', sbBefore: before }));
    let uid = null;
    try { uid = (JSON.parse(w.session.getItem('tr_signup_intent')) || {}).uid; } catch (e) { uid = null; }
    w.search = ''; delete w.sbBefore;
    await openPage(w); await openPage(w);
    out.push((before ? 'other' : 'none') + ':' + (uid === UID ? 'uid' : String(uid)) + ':' + trialCalls(w).length);
  }
  return { ok: out.join(',') === 'none:uid:1,other:uid:1', detail: out.join(',') };
};

cases['Email 意向沒綁到帳號 id(signUp 沒回 id):Email 一樣也不自動開,意向清掉,改用手動的開始老師試用'] = async () => {
  const w = world({ user: null, signUpUser: null });
  const p0 = await openPage(w, 'signup.html');
  p0.C.saveSignupIntent({ seats: 10, name: '', email: 'new@x.com' }, Date.now() - 20 * MIN);
  await p0.C.signUp('new@x.com', '12345678', '王老師');
  /* 意向存了 20 分鐘後,同一個 Email 的帳號(可能是刪掉重建的)登入 */
  w.user = { id: UID, email: 'new@x.com', created_at: new Date(Date.now() - MIN).toISOString(), user_metadata: {} };
  const p = await openPage(w);
  const direct = p.C.trialIntentOk({ seats: 10, name: '', email: 'new@x.com', at: Date.now() - 2 * MIN }, w.user, ACCESS());
  return { ok: trialCalls(w).length === 0 && intentLeft(w) === null && !dialog(p) && direct === false,
    detail: '呼叫 ' + trialCalls(w).length + ' / 留下 ' + intentLeft(w) + ' / trialIntentOk ' + direct };
};

cases['特製的 ?code= 網址、開頁前沒人登入,getSession 之前別的分頁登入了新帳號 B:不綁 B、意向丟掉、不開'] = async () => {
  /* 開頁時 localStorage 還沒有 B(記下的開頁前帳號是空的),SDK 載入到 getSession 這段時間別的分頁登入 B(可以試用) */
  const w = world({ hydrated: false });
  const B = w.user;
  await saveIntent(w, { seats: 30, name: 'A班' }, Date.now() - 2 * MIN, true);
  w.user = null;
  await openPage(Object.assign(w, { search: '?code=forged', otherTab: { user: B } }));
  const stamped = w.session.getItem('tr_signup_intent');
  w.search = '';
  const p = await openPage(w); await openPage(w, 'me.html');
  return { ok: w.user === B && stamped === null && trialCalls(w).length === 0 && intentLeft(w) === null && !dialog(p),
    detail: '回來那頁留下 ' + stamped + ' / 呼叫 ' + trialCalls(w).length + ' / 留下 ' + intentLeft(w) };
};

cases['真的從 Google 回來,別的分頁同時只改了別的 key(練習紀錄):照常綁上新帳號 id,重載後開一次'] = async () => {
  const w = world({ hydrated: false });
  await saveIntent(w, { seats: 30, name: 'A班' }, Date.now() - 2 * MIN, true);
  await openPage(Object.assign(w, { search: '?code=real', otherTab: { key: 'tr_progress' } }));
  let uid = null;
  try { uid = (JSON.parse(w.session.getItem('tr_signup_intent')) || {}).uid; } catch (e) { uid = null; }
  w.search = '';
  await openPage(w); await openPage(w);
  return { ok: uid === UID && trialCalls(w).length === 1, detail: 'uid ' + uid + ' / 呼叫 ' + trialCalls(w).length };
};

(async () => {
  let pass = 0;
  for (const [name, fn] of Object.entries(cases)) {
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + r.detail);
  }
  console.log(pass + ' / ' + Object.keys(cases).length + ' 通過');
  process.exit(pass === Object.keys(cases).length ? 0 : 1);
})();
