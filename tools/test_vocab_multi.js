/* 單字遊戲「練哪些字」可以勾好幾個(文章單字、片語、我的題庫一起練)。真的 js/common.js、js/sync-merge.js、js/vocab.js 在很小的假 DOM 裡跑,
   搬家的部分用真的 js/move-*.js(tools/fixtures/move_kit.js)。
   用法:node tools/test_vocab_multi.js
   - vgame_src 讀寫:勾 1 個時存的跟以前一字不差 { mode, level };勾 2 個以上多一個 modes(清單順序),mode 是第一個勾的、自己就夠玩(3 個字以上)的題庫;沒有就是勾的文章單字或片語;都沒有才是第一個題庫。
     舊格式照舊讀;壞資料、被刪的題庫不丟錯;讀的時候不回寫;一個都沒勾不存,四個「開始」不能按。
   - 取字:好幾個來源合起來,同一個英文只留一個(自己題庫寫的中文優先),級別只篩文章單字;單一來源的字跟以前一樣。
   - 成績、通關、出過的字:單一來源的鍵跟以前一樣;好幾個用排序後的組合鍵(bank:b1+word、phrase+word:8…);vgame_done 的組合鍵最多留 10 個,
     最近玩的記在 vgame_done['+recent'] 陣列(雲端 jsonb 存不住鍵的順序)。
   - 清單:框的名稱從框裡的字來(開頭是只給報讀軟體的「練哪些字」),勾 2 個以上後面寫勾了幾個;開著按 Esc 收起來;全選是「我的題庫」那組的第一列;題庫那一列的字數跟題庫卡片同一套;按「只練這個」焦點移到框上。
   - 題庫卡片的「只練這個」:只勾這一個,存的跟以前「用這個題庫」一樣。沒登入:勾了照樣換,只記在這一頁。
   - 舊版頁面(76b7850 的 js/vocab.js)讀到新格式不壞,只看 mode;改了選單寫回舊格式,新版讀到就是單選。
   - 搬家:remapRelated 換 vgame_src.modes 與組合鍵裡的題庫 id(重新排序,跟 vocab.js 算的一樣);76b7850 的 move-merge.js 搬新格式不壞。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const OLD = '76b7850';
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const gitShow = f => execFileSync('git', ['-C', REPO, 'show', OLD + ':' + f], { encoding: 'utf8', maxBuffer: 1 << 26 });
const SRC = { common: read('js/common.js'), sm: read('js/sync-merge.js'), vocab: read('js/vocab.js'), oldVocab: gitShow('js/vocab.js') };
const J = x => JSON.stringify(x);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + String(detail).slice(0, 600) : ''));
}
function test(name, fn) {
  try { const r = fn(); check(name, r === true || (r && r.ok), r && r.detail); } catch (e) { check(name, false, '丟錯 ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e)); }
}

/* ---------- 很小的假 DOM(跟 tools/test_vocab_banks.js 同一套,多了 details 的 open) ---------- */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.style = {}; this.listeners = {};
    this.className = ''; this.parentNode = null; this._text = ''; this._value = ''; this.checked = false; this.selected = false; this.disabled = false; this.indeterminate = false;
    const self = this;
    this.classList = {
      add: c => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); s.add(c); self.className = [...s].join(' '); },
      remove: c => { self.className = self.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
      contains: c => self.className.split(/\s+/).indexOf(c) >= 0,
      toggle: (c, on) => { if (on === undefined ? !self.classList.contains(c) : on) self.classList.add(c); else self.classList.remove(c); },
    };
  }
  get nodeType() { return 1; }
  get open() { return 'open' in this.attrs; }
  set open(v) { if (v) this.attrs.open = ''; else delete this.attrs.open; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this._value = String(v); if (k === 'class') this.className = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...cs) { cs.forEach(c => { if (c === null || c === undefined) return; if (typeof c === 'string') c = new Text(c); c.parentNode = this; this.children.push(c); }); }
  appendChild(c) { this.append(c); return c; }
  prepend(c) { c.parentNode = this; this.children.unshift(c); }
  after(c) { const p = this.parentNode; if (!p) return; const i = p.children.indexOf(this); c.parentNode = p; p.children.splice(i + 1, 0, c); }
  remove() { const p = this.parentNode; if (p) p.children = p.children.filter(x => x !== this); }
  get nextElementSibling() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return p.children.slice(i + 1).find(x => x instanceof El) || null; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  removeEventListener() {}
  fire(ev, extra) { const e = Object.assign({ type: ev, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} }, extra || {}); (this.listeners[ev] || []).forEach(f => f(e)); }
  click() { this.fire('click'); }
  focus(o) { El.focused = this; El.focusOpts = o || null; } blur() {} scrollIntoView() {}
  closest(sel) { let e = this; while (e && e instanceof El) { if (e.matches(sel)) return e; e = e.parentNode; } return null; }
  set innerHTML(v) { this.children = []; this._html = String(v); }
  get innerHTML() { return this._html || ''; }
  set textContent(v) { this.children = [new Text(String(v))]; }
  get textContent() { return this.children.map(c => c.textContent).join(''); }
  get options() { return this.all().filter(c => c.tagName === 'OPTION'); }
  get value() {
    if (this.tagName === 'SELECT') { const o = this.options; const s = o.find(x => x.selected) || o[0]; return s ? s._value : ''; }
    return this._value;
  }
  set value(v) {
    if (this.tagName === 'SELECT') { this.options.forEach(o => { o.selected = o._value === String(v); }); return; }
    this._value = String(v);
  }
  get dataset() { return {}; }
  all() { const out = []; const walk = n => n.children.forEach(c => { if (c instanceof El) { out.push(c); walk(c); } }); walk(this); return out; }
  matches(sel) {
    let m;
    if ((m = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel))) return this.attrs[m[1]] === m[2];
    if ((m = /^#([\w-]+)$/.exec(sel))) return this.attrs.id === m[1];
    if ((m = /^\.([\w-]+)$/.exec(sel))) return this.classList.contains(m[1]);
    return this.tagName === sel.toUpperCase();
  }
  querySelector(sel) { return this.all().find(e => e.matches(sel)) || null; }
  querySelectorAll(sel) { return this.all().filter(e => e.matches(sel)); }
}
class Text { constructor(t) { this.text = t; this.parentNode = null; } get nodeType() { return 3; } get textContent() { return this.text; } }
const textOf = el => (el ? el.textContent : '');
const buttons = (root, label) => root.all().filter(e => e.tagName === 'BUTTON' && textOf(e) === label);
const isDisabled = el => el.disabled === true || el.hasAttribute('disabled');

function makeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); },
    key: i => Array.from(m.keys())[i] || null, get length() { return m.size; }, dump: () => Object.fromEntries(m) };
}

/* ---------- 測試資料:文章單字 11 個(初級 8、高級 3)、片語 10 條、題庫 ---------- */
const ARTICLES = [
  { id: 'a1', level: '初級', vocab: [['schedule', '行程表'], ['refund', '退款'], ['invoice', '發票'], ['budget', '預算'], ['deadline', '截止日期'], ['client', '客戶'], ['meeting', '會議'], ['contract', '合約']].map(([word, zh]) => ({ word, zh })) },
  { id: 'a2', level: '高級', vocab: [['merger', '合併'], ['revenue', '營收'], ['audit', '稽核']].map(([word, zh]) => ({ word, zh })) },
];
const PHRASES = [['put off', '延後'], ['take over', '接管'], ['look into', '調查'], ['set up', '設立'], ['carry out', '執行'], ['turn down', '拒絕'], ['bring up', '提出'], ['call off', '取消'], ['fill out', '填寫'], ['run out of', '用完']]
  .map(([phrase, zh], i) => ({ id: 'ph' + i, phrase, zh, type: '動詞片語', group: phrase.split(' ')[0], example: 'ex', exampleZh: '例', quiz: { q: 'q', options: ['a', 'b', 'c', 'd'], answer: 0, explanation: '' } }));
const W = (en, zh, on) => ({ en, zh, on: on !== false });
const B1 = () => ({ id: 'b1', name: '第3課', words: [W('schedule', '時間表'), W('apple', '蘋果'), W('pear', '梨')] });
const B2 = () => ({ id: 'b2', name: '文章：遠距工作', words: [W('kiwi', '奇異果'), W('grape', '葡萄'), W('lemon', '檸檬'), W('melon', '甜瓜', false), W('a'.repeat(31), '太長')] });
const BA = () => ({ id: 'bA', name: '一個字', words: [W('cherry', '櫻桃')] });
const BB = () => ({ id: 'bB', name: '兩個字', words: [W('peach', '桃子'), W('mango', '芒果')] });
const BC = () => ({ id: 'bC', name: '另一個字', words: [W('banana', '香蕉')] });
const B5 = () => ({ id: 'b5', name: '重複的字', words: [W('apple', '蘋果'), W('Apple', '紅蘋果'), W('plum', '李子')] });
const CID = 'c3f2b8c1e7d4a4b9e9c215a6e8f0d1b72';

/* 開一頁 vocab.html。o:{ banks, src(vgame_src), ls(其他鍵), guest(沒登入:PROFILE.blocksWrite 回 true), old(用 76b7850 的 vocab.js), local(共用的 localStorage) } */
function openVocab(o) {
  o = o || {};
  const local = o.local || makeStorage();
  const root = new El('div'); root.setAttribute('id', 'vocab-root');
  const body = new El('body'); body.append(root);
  const winListeners = {};
  const timers = [], rafs = [];
  const scrolls = [], alerts = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: local, sessionStorage: makeStorage(),
    location: { hash: '', search: '', pathname: '/vocab.html', href: 'https://x/vocab.html' },
    history: { replaceState() {} },
    confirm: () => true, alert: m => alerts.push(m),
    scrollTo: a => scrolls.push(a), requestAnimationFrame: f => { rafs.push(f); return rafs.length; }, cancelAnimationFrame() {},
    setTimeout: f => { timers.push(f); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    performance: { now: () => 0 }, URLSearchParams,
    document: {
      title: '', body, documentElement: new El('html'),
      createElement: t => new El(t), createTextNode: t => new Text(t),
      querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s), getElementById: id => body.querySelector('#' + id),
      addEventListener() {},
    },
    TOEIC: { articles: ARTICLES, phrases: PHRASES },
  };
  ctx.window = ctx;
  ctx.addEventListener = (ev, fn) => { (winListeners[ev] = winListeners[ev] || []).push(fn); };
  ctx.removeEventListener = () => {};
  ctx.CLOUD = { enabled: true, push() {}, syncKey: () => new Promise(() => {}) };
  if (o.guest) ctx.PROFILE = { blocksWrite: () => true };
  local.setItem('tr_current_profile', J(CID));
  vm.createContext(ctx);
  vm.runInContext(SRC.common + '\n;globalThis.__store = store; globalThis.__storageKey = storageKey;', ctx);
  const key = k => ctx.__storageKey(k);
  if (o.banks) local.setItem(key('vgame_banks'), J(o.banks));
  if (o.src !== undefined) local.setItem(key('vgame_src'), typeof o.src === 'string' ? o.src : J(o.src));
  Object.entries(o.ls || {}).forEach(([k, v]) => local.setItem(key(k), J(v)));
  vm.runInContext(SRC.sm, ctx);
  vm.runInContext(o.old ? SRC.oldVocab : SRC.vocab, ctx, { filename: o.old ? 'old-vocab.js' : 'vocab.js' });
  timers.length = 0;
  const pg = {
    ctx, root, local, key, scrolls, alerts,
    raw: k => local.getItem(key(k)),
    get: k => JSON.parse(local.getItem(key(k)) || 'null'),
    set: (k, v) => local.setItem(key(k), J(v)),
    fire: (ev, e) => (winListeners[ev] || []).forEach(f => f(e)),
    flush() { for (let i = 0; i < 2000 && timers.length; i++) timers.shift()(); },
    frame(t) { rafs.splice(0).forEach(f => f(t)); },
    VS: ctx.VOCAB_SRC,
    pick: () => root.querySelector('.vg-pick'),
    box: m => root.all().find(e => e.tagName === 'INPUT' && e.attrs.type === 'checkbox' && e._value === m && e.closest('.vg-pick')) || null,
    checked: () => root.all().filter(e => e.tagName === 'INPUT' && e.attrs.type === 'checkbox' && e._value && e.closest('.vg-pick') && e.checked).map(e => e._value),
    allBox: () => { const l = root.querySelector('.vg-pick-all'); return l ? l.all().find(e => e.tagName === 'INPUT') : null; },
    levelSel: () => { const d = root.querySelector('.vg-pick'); return d ? d.all().find(e => e.tagName === 'SELECT') : null; },
    summary: () => textOf(root.querySelector('.vg-pick-sum')),
    sumEl: () => root.querySelector('.vg-pick-sum'),
    rowCount: m => textOf(pg.box(m).closest('.vg-pick-row').querySelector('.vg-pick-n')),
    note: () => textOf(root.querySelector('.vg-pick-note')),
    starts: () => { const g = root.querySelector('.vg-games'); return g ? g.all().filter(e => e.tagName === 'BUTTON' && textOf(e) === '開始') : []; },
    cards: () => { const g = root.querySelector('.vg-games'); return g ? g.children.filter(c => c instanceof El).map(textOf) : []; },
  };
  pg.toggle = m => { const cb = pg.box(m); cb.checked = !cb.checked; cb.fire('change'); };
  return pg;
}

/* ---------- 玩一局(假 DOM 裡用 requestAnimationFrame、setTimeout 的佇列推進) ---------- */
function dictOf(pg, modes, level) {
  const d = {};
  pg.VS.pool(modes, level || '全部').pool.forEach(p => { d[p.answer] = p.zh; d[p.zh] = p.answer; });
  return d;
}
/* 掉落消除:每一格把畫面上的字打掉,直到通關。回畫面上出現過的字 */
function playFall(pg, dict) {
  const input = pg.root.all().find(e => e.tagName === 'INPUT' && e.classList.contains('game-input'));
  const shown = [];
  let t = 1000;
  for (let i = 0; i < 300 && !pg.root.querySelector('.round-clear'); i++) {
    pg.frame(t); t += 4000;
    pg.root.all().filter(e => e.classList.contains('fall-block') && !e.classList.contains('boom')).forEach(b => {
      const face = textOf(b.children[0]);
      shown.push(face);
      input.value = dict[face];
      input.fire('keydown', { key: 'Enter', keyCode: 13, isComposing: false });
    });
    pg.flush();
  }
  return shown;
}
/* 翻牌配對:先兩兩翻開記下每張的字,再照答案配完 */
function playPairs(pg, dict) {
  const cards = pg.root.querySelector('.mem-grid').children.filter(c => c instanceof El);
  const faces = [];
  for (let i = 0; i + 1 < cards.length; i += 2) { cards[i].click(); cards[i + 1].click(); faces[i] = textOf(cards[i]); faces[i + 1] = textOf(cards[i + 1]); pg.flush(); }
  const done = c => c.classList.contains('matched');
  for (let a = 0; a < cards.length; a++) {
    if (done(cards[a])) continue;
    const b = cards.findIndex((c, j) => j !== a && !done(c) && faces[j] === dict[faces[a]]);
    if (b < 0) continue;
    cards[a].click(); cards[b].click(); pg.flush();
  }
  return faces;
}
/* 記憶吐司:回烤的字,全部答對 */
function playToast(pg, dict) {
  const words = pg.root.all().filter(e => e.classList.contains('toast-card')).map(c => textOf(c.children[0]));
  buttons(pg.root, '直接開考')[0].click();
  for (let i = 0; i < 6; i++) {
    const stem = textOf(pg.root.querySelector('.toast-stem'));
    const opt = pg.root.all().find(e => e.classList.contains('opt') && textOf(e.children[1]) === dict[stem]);
    if (!opt) break;
    opt.click();
    const next = buttons(pg.root, '下一題 →')[0] || buttons(pg.root, '看成績')[0];
    if (!next) break;
    next.click();
  }
  return words;
}

/* ======================= 1. 讀取與相容 ======================= */
test('舊格式 { mode: phrase, level: 中級 }:只勾片語,級別是中級,框裡寫片語', () => {
  const pg = openVocab({ banks: [B1(), B2()], src: { mode: 'phrase', level: '中級' } });
  return { ok: J(pg.checked()) === J(['phrase']) && pg.levelSel().value === '中級' && /片語/.test(pg.summary()) && !/文章單字/.test(pg.summary()), detail: J(pg.checked()) + ' ' + pg.summary() };
});
test('新格式 { mode: word, modes: [word, bank:b1] }:兩個都勾,框裡寫兩個名稱和合起來的字數', () => {
  const pg = openVocab({ banks: [B1(), B2()], src: { mode: 'word', level: '全部', modes: ['word', 'bank:b1'] } });
  return { ok: J(pg.checked()) === J(['word', 'bank:b1']) && /文章單字、第3課/.test(pg.summary()) && /共 13 個字/.test(pg.summary()), detail: J(pg.checked()) + ' ' + pg.summary() };
});
test('modes 裡沒有 mode(只改了 mode 沒改 modes,例如舊版搬家):相信 mode,只勾它', () => {
  const pg = openVocab({ banks: [B1(), B2()], src: { mode: 'bank:b2', level: '全部', modes: ['bank:b1', 'word'] } });
  return { ok: J(pg.checked()) === J(['bank:b2']), detail: J(pg.checked()) };
});
test('壞資料不丟錯,退回能用的值', () => {
  const cases = [
    ['null', 'null', ['word'], '全部'], ['字串', J('phrase'), ['word'], '全部'], ['壞 JSON', '{oops', ['word'], '全部'], ['mode 不是字串', J({ mode: 5 }), ['word'], '全部'],
    ['modes 不是陣列', J({ mode: 'phrase', modes: 'word' }), ['phrase'], '全部'],
    ['modes 有不認得的、重複的、被刪的題庫', J({ mode: 'phrase', modes: ['phrase', 'zzz', 'phrase', 'bank:nope', 'bank:b1'] }), ['phrase', 'bank:b1'], '全部'],
    ['級別亂寫', J({ mode: 'word', level: '超難' }), ['word'], '全部'], ['陣列', J(['word']), ['word'], '全部'],
  ];
  const bad = [];
  cases.forEach(([name, raw, want, lv]) => {
    try {
      const pg = openVocab({ banks: [B1()], src: raw });
      if (J(pg.checked()) !== J(want) || pg.levelSel().value !== lv) bad.push(name + ':' + J(pg.checked()) + '/' + pg.levelSel().value);
      if (pg.raw('vgame_src') !== raw) bad.push(name + ':開頁就改了存的值');
    } catch (e) { bad.push(name + ' 丟錯 ' + e.message); }
  });
  return { ok: !bad.length, detail: bad.join(' | ') };
});
test('勾的題庫被刪了:清單沒有它、鍵不算它;開頁之後存的 vgame_src 一個位元組都沒變(讀的時候不回寫)', () => {
  const raw = J({ mode: 'bank:gone', level: '全部', modes: ['bank:gone', 'bank:b1', 'bank:b2'] });
  const pg = openVocab({ banks: [B1(), B2()], src: raw, ls: { vgame_best: { 'bank:b1+bank:b2': 33, 'bank:b1+bank:b2+bank:gone': 99 } } });
  const ok = J(pg.checked()) === J(['bank:b1', 'bank:b2']) && !pg.box('bank:gone') && pg.raw('vgame_src') === raw && /最佳 中翻英 33/.test(pg.cards()[0]);
  return { ok, detail: J(pg.checked()) + ' ' + pg.cards()[0] };
});
test('勾的題庫全被刪了:退回文章單字', () => {
  const pg = openVocab({ banks: [B1()], src: { mode: 'bank:x1', level: '全部', modes: ['bank:x1', 'bank:x2'] } });
  return { ok: J(pg.checked()) === J(['word']), detail: J(pg.checked()) };
});
test('雲端合併進來一個題庫,它在存的 modes 裡:重畫後是勾著的;清單開著的話重畫後還開著;存的值沒變', () => {
  const raw = J({ mode: 'word', level: '全部', modes: ['word', 'bank:b2'] });
  const pg = openVocab({ banks: [B1()], src: raw });
  const before = J(pg.checked());
  pg.pick().open = true; pg.pick().fire('toggle');
  pg.set('vgame_banks', [B1(), B2()]);
  pg.fire('cloud:merged', { detail: { key: 'vgame_banks' } });
  const ok = before === J(['word']) && J(pg.checked()) === J(['word', 'bank:b2']) && pg.pick().open && pg.raw('vgame_src') === raw;
  return { ok, detail: before + ' → ' + J(pg.checked()) + ' open=' + pg.pick().open };
});

/* ======================= 2. 寫入 ======================= */
test('勾成 1 個:存的字串跟以前一模一樣(沒有 modes)', () => {
  const pg = openVocab({ banks: [B1()] });
  pg.toggle('phrase'); pg.toggle('word');
  return { ok: pg.raw('vgame_src') === '{"mode":"phrase","level":"全部"}' && J(pg.checked()) === J(['phrase']), detail: pg.raw('vgame_src') };
});
test('勾 2 個以上:modes 照清單順序(先勾 b2 再勾 b1 也一樣),mode 是清單裡第一個勾的(夠玩的)題庫;沒勾題庫時 mode 是清單第一個', () => {
  const pg = openVocab({ banks: [B1(), B2()] });
  pg.toggle('word'); pg.toggle('bank:b2'); pg.toggle('bank:b1'); pg.toggle('phrase');
  const v = pg.get('vgame_src');
  pg.toggle('bank:b1'); pg.toggle('bank:b2'); pg.toggle('word');
  const noBank = pg.get('vgame_src');
  const ok = J(v) === J({ mode: 'bank:b1', level: '全部', modes: ['phrase', 'bank:b1', 'bank:b2'] }) && J(noBank) === J({ mode: 'word', level: '全部', modes: ['word', 'phrase'] });
  return { ok, detail: pg.raw('vgame_src') + ' ' + J(v) };
});
test('全部取消:不存、寫「至少勾一個。」、四個「開始」都不能按、卡片寫「先在上面勾要練的字」;再勾一個就恢復', () => {
  const pg = openVocab({ banks: [B1()], src: { mode: 'word', level: '全部', modes: ['word', 'phrase'] } });
  pg.toggle('word');
  const raw = pg.raw('vgame_src');   // 剩片語(存了);再取消片語 = 0 個,不存
  pg.toggle('phrase');
  const zero = { saved: pg.raw('vgame_src') === raw, note: pg.note(), sum: pg.summary(), off: pg.starts().map(isDisabled), why: pg.cards().every(c => /先在上面勾要練的字/.test(c)) };
  pg.toggle('phrase');
  const back = { off: pg.starts().map(isDisabled), saved: pg.raw('vgame_src') };
  const ok = zero.saved && /至少勾一個。/.test(zero.note) && /還沒勾/.test(zero.sum) && zero.off.length === 4 && zero.off.every(Boolean) && zero.why
    && back.off.every(x => !x) && back.saved === '{"mode":"phrase","level":"全部"}';
  return { ok, detail: J({ zero, back }) };
});
test('全部取消後雲端合併重畫:還是一個都沒勾(這一頁的選擇不被存的值蓋回去)', () => {
  const pg = openVocab({ banks: [B1()] });
  pg.toggle('word');
  pg.set('vgame_banks', [B1(), B2()]);
  pg.fire('cloud:merged', { detail: { key: 'vgame_banks' } });
  return { ok: J(pg.checked()) === '[]' && pg.starts().every(isDisabled), detail: J(pg.checked()) };
});
test('改級別:順便勾起文章單字並存起來;已勾的片語不動', () => {
  const pg = openVocab({ banks: [B1()], src: { mode: 'phrase', level: '全部' } });
  const sel = pg.levelSel();
  sel.value = '高級'; sel.fire('change');
  const v = pg.get('vgame_src');
  return { ok: J(v) === J({ mode: 'word', level: '高級', modes: ['word', 'phrase'] }) && J(pg.checked()) === J(['word', 'phrase']) && /文章單字（高級）/.test(pg.summary()), detail: pg.raw('vgame_src') + ' ' + pg.summary() };
});
test('全選:勾起全部題庫(內建兩列不動)、全取消;勾一部分是半勾;只有 1 個題庫沒有全選', () => {
  const pg = openVocab({ banks: [B1(), B2(), BA()] });
  const all = pg.allBox();
  all.checked = true; all.fire('change');
  const a = J(pg.checked());
  all.checked = false; all.fire('change');
  const b = J(pg.checked());
  pg.toggle('bank:b2');
  const half = { checked: pg.allBox().checked, ind: pg.allBox().indeterminate };
  pg.toggle('bank:b1'); pg.toggle('bank:bA');
  const full = { checked: pg.allBox().checked, ind: pg.allBox().indeterminate };
  const one = openVocab({ banks: [B1()] });
  const ok = a === J(['word', 'bank:b1', 'bank:b2', 'bank:bA']) && b === J(['word']) && half.ind && !half.checked && full.checked && !full.ind && one.allBox() === null && !!one.box('bank:b1');
  return { ok, detail: J({ a, b, half, full, one: !!one.allBox() }) };
});
test('每一列寫字數:文章單字照級別、片語、題庫只算勾選的字(英文超過 30 字不算)', () => {
  const pg = openVocab({ banks: [B1(), B2()] });
  const n = m => textOf(pg.box(m).closest('.vg-pick-row').querySelector('.vg-pick-n'));
  const before = n('word');
  const sel = pg.levelSel(); sel.value = '高級'; sel.fire('change');
  const ok = before === '11 個字' && n('word') === '3 個字' && n('phrase') === '10 個字' && n('bank:b1') === '3 個字' && n('bank:b2') === '練 3 個';
  return { ok, detail: [before, n('word'), n('phrase'), n('bank:b1'), n('bank:b2')].join(' / ') };
});
test('題庫有字取消勾選:清單那一列寫「練 N 個」,跟下面題庫卡片「M 個字 · 練 N 個」是同一個數字;全部都練的寫「N 個字」', () => {
  const B8 = { id: 'b8', name: '老師版', words: ['ant', 'bee', 'cat', 'dog', 'eel', 'fox', 'gnu', 'hen'].map((en, i) => W(en, '字' + i, i < 5)) };
  const pg = openVocab({ banks: [B8, B1()] });
  const stats = pg.root.all().filter(e => e.classList.contains('p-stats')).map(textOf);
  const ok = pg.rowCount('bank:b8') === '練 5 個' && stats.indexOf('8 個字 · 練 5 個') > -1 && pg.rowCount('bank:b1') === '3 個字' && stats.indexOf('3 個字 · 練 3 個') > -1;
  return { ok, detail: J({ b8: pg.rowCount('bank:b8'), b1: pg.rowCount('bank:b1'), stats }) };
});

test('框(summary)的名稱從框裡的字來:開頭是只給報讀軟體的「練哪些字」,接著勾了哪些、幾個、共幾個字;沒有 aria-labelledby(以前 Chrome 把框裡的字又放進描述,唸兩次);旁邊看得到的「練哪些字」不另外唸', () => {
  const pg = openVocab({ banks: [B1(), B2()], src: { mode: 'bank:b1', level: '全部', modes: ['word', 'bank:b1'] } });
  const sum = pg.sumEl();
  const first = sum.children.find(c => c instanceof El);
  const label = pg.root.querySelector('.vg-source').children.find(c => c instanceof El && c.tagName === 'SPAN');
  const a = textOf(sum);
  pg.toggle('word'); pg.toggle('bank:b1');
  const b = textOf(sum);
  const ok = a === '練哪些字 文章單字、第3課 · 2 個 · 共 13 個字' && b === '練哪些字 還沒勾' && !sum.hasAttribute('aria-labelledby')
    && !!first && first.classList.contains('vg-pick-legend') && textOf(first) === '練哪些字 '
    && !!label && textOf(label) === '練哪些字' && label.getAttribute('aria-hidden') === 'true';
  return { ok, detail: J({ a, b, labelledby: sum.getAttribute('aria-labelledby'), first: first && first.className, hidden: label && label.getAttribute('aria-hidden') }) };
});
test('框裡勾了 2 個以上:後面那段(不會被省略號切掉)寫勾了幾個、共幾個字,前面那段列出全部名稱;勾 1 個跟以前一樣只寫共幾個字', () => {
  const pg = openVocab({ banks: [B1(), B2(), BA()], src: { mode: 'bank:b1', level: '全部', modes: ['bank:b1', 'bank:b2', 'bank:bA'] } });
  const now = () => ({ t: textOf(pg.root.querySelector('.vg-pick-sum-text')), n: textOf(pg.root.querySelector('.vg-pick-sum-n')) });
  const three = now();
  pg.toggle('word'); pg.toggle('phrase');
  const five = now();
  pg.toggle('word'); pg.toggle('phrase'); pg.toggle('bank:b2'); pg.toggle('bank:bA');
  const one = now();
  const ok = three.t === '第3課、文章：遠距工作、一個字' && three.n === ' · 3 個 · 共 7 個字'
    && five.t === '文章單字、片語、第3課、文章：遠距工作、一個字' && five.n === ' · 5 個 · 共 27 個字'
    && one.t === '第3課' && one.n === ' · 共 3 個字';
  return { ok, detail: J({ three, five, one }) };
});
test('清單開著按 Esc:收起來、焦點回到框上、不再往外傳;收著時按 Esc、開著按別的鍵都不管', () => {
  El.focused = null;
  const pg = openVocab({ banks: [B1()] });
  const d = pg.pick();
  let prevented = 0;
  const press = (k, target) => d.fire('keydown', { key: k, target: target || d, preventDefault() { prevented++; } });
  d.open = true;
  press('Enter', pg.box('phrase'));
  const enter = { open: d.open, prevented };
  press('Escape', pg.box('phrase'));
  const esc = { open: d.open, focus: El.focused === pg.sumEl(), prevented };
  El.focused = null;
  press('Escape');
  const closed = { open: d.open, focus: El.focused, prevented };
  const ok = enter.open && enter.prevented === 0 && !esc.open && esc.focus && esc.prevented === 1 && !closed.open && closed.focus === null && closed.prevented === 1;
  return { ok, detail: J({ enter, esc, closed: { open: closed.open, focused: !!closed.focus, prevented: closed.prevented } }) };
});
test('全選:放在「我的題庫」那組的第一列(跟題庫的勾選框同一欄),小標題在它上面,不在標題列最右邊', () => {
  const pg = openVocab({ banks: [B1(), B2(), BA()] });
  const grp = pg.root.querySelector('.vg-pick-banks');
  const kids = grp.children.filter(c => c instanceof El);
  const allRow = pg.allBox().closest('.vg-pick-row');
  const ok = !!allRow && kids[0].classList.contains('vg-pick-group') && !kids[0].querySelector('INPUT') && kids[1] === allRow
    && kids[2] === pg.box('bank:b1').closest('.vg-pick-row') && textOf(allRow) === '全選' && !allRow.querySelector('.vg-pick-name');
  return { ok, detail: J(kids.map(k => k.className + ':' + textOf(k))) };
});

/* ======================= 3. 取字與門檻 ======================= */
test('合併去重:題庫 schedule 時間表 + 文章單字 schedule 行程表 → 只有一個 schedule,中文是「時間表」', () => {
  const pg = openVocab({ banks: [B1(), B2()] });
  const p = pg.VS.pool(['bank:b1', 'word'], '全部').pool;
  const sch = p.filter(x => x.answer === 'schedule');
  return { ok: p.length === 13 && sch.length === 1 && sch[0].zh === '時間表' && !p.some(x => x.zh === '行程表'), detail: p.length + ' ' + J(sch) };
});
test('合併時題庫照「我的題庫」的順序優先,同一個題庫裡重複的英文也只留一個', () => {
  const pg = openVocab({ banks: [B1(), B5()] });
  const p = pg.VS.pool(['bank:b5', 'bank:b1'], '全部').pool;
  return { ok: J(p.map(x => x.answer + ':' + x.zh)) === J(['schedule:時間表', 'apple:蘋果', 'pear:梨', 'plum:李子']), detail: J(p) };
});
test('級別只篩文章單字:文章單字(高級)+片語 = 3 + 10', () => {
  const pg = openVocab({ banks: [B1()] });
  const p = pg.VS.pool(['word', 'phrase'], '高級').pool;
  return { ok: p.length === 13 && p.filter(x => / /.test(x.answer)).length === 10, detail: p.length };
});
test('題庫只取勾選的字、英文超過 30 字不算', () => {
  const pg = openVocab({ banks: [B1(), B2()] });
  const p = pg.VS.pool(['bank:b2', 'phrase'], '全部').pool;
  return { ok: p.length === 13 && !p.some(x => x.answer === 'melon' || x.answer.length > 30), detail: J(p.map(x => x.answer)) };
});
test('單一來源的字跟以前一樣:文章單字照文章順序、片語照順序、題庫照 bankPool(不去重複)', () => {
  const pg = openVocab({ banks: [B1(), B5()] });
  const w = pg.VS.pool(['word'], '初級').pool.map(x => x.answer);
  const ph = pg.VS.pool(['phrase'], '全部').pool.map(x => x.answer);
  const b5 = pg.VS.pool(['bank:b5'], '全部').pool.map(x => x.answer + ':' + x.zh);
  const ok = J(w) === J(ARTICLES[0].vocab.map(v => v.word)) && J(ph) === J(PHRASES.map(p => p.phrase)) && J(b5) === J(['apple:蘋果', 'apple:紅蘋果', 'plum:李子'])
    && pg.VS.pool(['word'], '全部').name === '單字' && pg.VS.pool(['word'], '高級').name === '單字 · 高級' && pg.VS.pool(['phrase'], '全部').name === '片語' && pg.VS.pool(['bank:b5'], '全部').name === '題庫：重複的字';
  return { ok, detail: J({ w, ph, b5 }) };
});
test('門檻:掉落消除有內建字庫要 8 個、全是題庫要 3 個,翻牌 3、吐司 4、選擇題 4;不夠的「開始」不能按,卡片寫要幾個', () => {
  const run = (banks, src) => { const pg = openVocab({ banks, src }); return { off: pg.starts().map(isDisabled), cards: pg.cards(), note: pg.note() }; };
  const out = [];
  /* 文章單字(高級)3 + 題庫 3 = 6:掉落不能按(要 8),其他都能 */
  let r = run([B1()], { mode: 'word', level: '高級', modes: ['word', 'bank:b1'] });
  out.push(['內建+題庫 6', J(r.off) === J([true, false, false, false]) && /字不夠，要 8 個以上（現在 6 個）/.test(r.cards[0])]);
  /* 題庫 1 + 題庫 2 = 3:掉落、翻牌剛好能按,吐司、選擇題不能 */
  r = run([BA(), BB()], { mode: 'bank:bA', level: '全部', modes: ['bank:bA', 'bank:bB'] });
  out.push(['兩個題庫 3', J(r.off) === J([false, false, true, true]) && /字不夠，要 4 個以上（現在 3 個）/.test(r.cards[2]) && /字不夠，要 4 個以上（現在 3 個）/.test(r.cards[3]) && /共 3 個字/.test(r.note)]);
  /* 題庫 1 + 題庫 1 = 2:全部不能,清單下面說明 */
  r = run([BA(), BC()], { mode: 'bank:bA', level: '全部', modes: ['bank:bA', 'bank:bC'] });
  out.push(['兩個題庫 2', r.off.every(Boolean) && /勾的這些加起來只有 2 個字，至少要 3 個才能玩。/.test(r.note) && /要 3 個以上（現在 2 個）/.test(r.cards[1])]);
  /* 題庫 3 + 題庫 1 = 4:四個都能 */
  r = run([B1(), BA()], { mode: 'bank:b1', level: '全部', modes: ['bank:b1', 'bank:bA'] });
  out.push(['兩個題庫 4', r.off.every(x => !x)]);
  /* 單一內建:文章單字(高級)3 → 掉落 8、吐司 4、選擇題 4 不能,翻牌能 */
  r = run([B1()], { mode: 'word', level: '高級' });
  out.push(['單一文章單字 3', J(r.off) === J([true, false, true, true])]);
  /* 單一題庫 3:掉落、翻牌能,吐司、選擇題不能(以前按了跳「這個字池只有 3 個字」) */
  r = run([B1()], { mode: 'bank:b1', level: '全部' });
  out.push(['單一題庫 3', J(r.off) === J([false, false, true, true])]);
  /* 內建 8 剛好 */
  r = run([B1()], { mode: 'word', level: '初級' });
  out.push(['文章單字(初級)8', r.off.every(x => !x)]);
  return { ok: out.every(x => x[1]), detail: out.map(x => x[0] + (x[1] ? ' ok' : ' 壞')).join(' / ') };
});

/* ======================= 4. 鍵與紀錄 ======================= */
test('組合鍵:排序穩定、單一來源跟以前一樣、題庫 id 有特殊字元也拆得開', () => {
  const pg = openVocab({ banks: [B1(), B2()] });
  const k = pg.VS.key;
  const ok = k(['bank:b2', 'bank:b1']) === 'bank:b1+bank:b2' && k(['bank:b1', 'bank:b2']) === 'bank:b1+bank:b2' && k(['word', 'phrase']) === 'phrase+word'
    && k(['word', 'bank:b1']) === 'bank:b1+word' && k(['word']) === 'word' && k(['bank:b1']) === 'bank:b1' && k(['phrase', 'phrase']) === 'phrase'
    && k(['bank:x+y:z', 'word']) === 'bank:x%2By%3Az+word' && k(['bank:art_art-1a', 'bank:b1']) === 'bank:art_art-1a+bank:b1';
  return { ok, detail: [k(['bank:b2', 'bank:b1']), k(['word', 'phrase']), k(['bank:x+y:z', 'word'])].join(' ') };
});
test('掉落消除(題庫+文章單字)中翻英、英翻中通關:最佳、通關、出過的字寫在組合鍵;字來自兩個來源;首頁卡片顯示組合的紀錄', () => {
  const pg = openVocab({ banks: [B1(), B2()], src: { mode: 'word', level: '全部', modes: ['word', 'bank:b1'] }, ls: { vgame_best: { word: 3, 'bank:b1': 4 } } });
  const dict = dictOf(pg, ['word', 'bank:b1']);
  pg.starts()[0].click();
  const title = textOf(pg.root.querySelector('h1'));
  const shown = playFall(pg, dict);
  const clearText = textOf(pg.root.querySelector('.clear-count'));
  buttons(pg.root, '回單字訓練')[0].click();
  const dirSel = pg.root.querySelector('.vg-games').all().find(e => e.tagName === 'SELECT' && e.options.some(o => o._value === 'e2z') && e.options[0]._value === 'z2e');
  dirSel.value = 'e2z';
  pg.starts()[0].click();
  const shown2 = playFall(pg, dict);
  buttons(pg.root, '回單字訓練')[0].click();
  const best = pg.get('vgame_best'), clr = pg.get('vgame_clear'), done = pg.get('vgame_done');
  const ok = /文章單字、第3課 · 中翻英/.test(title) && shown.length === 13 && shown.indexOf('時間表') > -1 && shown.indexOf('行程表') < 0 && shown.indexOf('退款') > -1
    && shown2.indexOf('schedule') > -1 && shown2.indexOf('apple') > -1
    && best['bank:b1+word'] > 0 && best['bank:b1+word:e2z'] > 0 && best.word === 3 && best['bank:b1'] === 4
    && clr['bank:b1+word'].n === 1 && clr['bank:b1+word:e2z'].n === 1 && done['bank:b1+word'].length === 13 && done['bank:b1+word:e2z'].length === 13
    && /這個組合已通關 1 次/.test(clearText)
    && new RegExp('最佳 中翻英 ' + best['bank:b1+word'] + ' · 英翻中 ' + best['bank:b1+word:e2z']).test(pg.cards()[0]) && /通關 2 次/.test(pg.cards()[0]);
  return { ok, detail: J({ title, n: shown.length, best, clr: Object.keys(clr), clearText, card: pg.cards()[0] }) };
});
test('翻牌配對(片語+文章單字):紀錄寫在 phrase+word:8;首頁顯示它,不會抓到 phrase:8', () => {
  const pg = openVocab({ banks: [B1()], src: { mode: 'word', level: '全部', modes: ['word', 'phrase'] }, ls: { vgame_pairs_best: { 'phrase:8': { moves: 99, secs: 99 } } } });
  pg.starts()[1].click();
  playPairs(pg, dictOf(pg, ['word', 'phrase']));
  const report = textOf(pg.root.querySelector('.report-head'));
  buttons(pg.root, '回單字訓練')[0].click();
  const pb = pg.get('vgame_pairs_best');
  const mine = pb['phrase+word:8'];
  const ok = /完成/.test(report) && !!mine && J(pb['phrase:8']) === J({ moves: 99, secs: 99 }) && new RegExp('最佳 ' + mine.moves + ' 步').test(pg.cards()[1]) && !/99 步/.test(pg.cards()[1]);
  return { ok, detail: J({ report, pb, card: pg.cards()[1] }) };
});
test('記憶吐司(兩個題庫):烤的字來自兩個題庫,紀錄寫在 bank:b1+bank:b2', () => {
  const pg = openVocab({ banks: [B1(), B2()], src: { mode: 'bank:b1', level: '全部', modes: ['bank:b1', 'bank:b2'] } });
  pg.starts()[2].click();
  const words = playToast(pg, dictOf(pg, ['bank:b1', 'bank:b2']));
  const tb = pg.get('vgame_toast_best');
  const want = ['schedule', 'apple', 'pear', 'kiwi', 'grape', 'lemon'];
  const ok = words.length === 6 && want.every(w => words.indexOf(w) > -1) && tb && tb['bank:b1+bank:b2'] === 6;
  return { ok, detail: J({ words, tb }) };
});
test('單一來源:四個玩法寫的鍵跟以前一樣(bank:b1、word:8、phrase),原本的單一來源紀錄照常顯示', () => {
  const pg = openVocab({ banks: [B1(), B2()], src: { mode: 'bank:b1', level: '全部' }, ls: { vgame_best: { phrase: 12 } } });
  pg.starts()[0].click();
  playFall(pg, dictOf(pg, ['bank:b1']));
  buttons(pg.root, '回單字訓練')[0].click();
  pg.toggle('word'); pg.toggle('bank:b1');
  pg.starts()[1].click();
  playPairs(pg, dictOf(pg, ['word']));
  buttons(pg.root, '回單字訓練')[0].click();
  pg.toggle('phrase'); pg.toggle('word');
  const card = pg.cards()[0];
  pg.starts()[2].click();
  playToast(pg, dictOf(pg, ['phrase']));
  const best = pg.get('vgame_best'), clr = pg.get('vgame_clear'), done = pg.get('vgame_done'), pb = pg.get('vgame_pairs_best'), tb = pg.get('vgame_toast_best');
  const ok = J(Object.keys(best).sort()) === J(['bank:b1', 'phrase']) && J(Object.keys(clr)) === J(['bank:b1']) && J(Object.keys(done)) === J(['bank:b1'])
    && J(Object.keys(pb)) === J(['word:8']) && J(Object.keys(tb)) === J(['phrase']) && /最佳 中翻英 12/.test(card) && pg.raw('vgame_src') === '{"mode":"phrase","level":"全部"}';
  return { ok, detail: J({ best, clr: Object.keys(clr), pb: Object.keys(pb), tb, card }) };
});
test('vgame_done 組合鍵最多留 10 個(沒記在 +recent 的當成最久沒玩,照原本的順序先刪);單一來源的鍵內容與順序不變', () => {
  const done = { word: ['refund'], 'bank:b1': ['apple'] };
  for (let i = 0; i < 11; i++) done['bank:z' + i + '+word'] = ['x' + i];
  done.phrase = ['put off'];
  const pg = openVocab({ banks: [B1(), B2()], src: { mode: 'bank:b1', level: '全部', modes: ['bank:b1', 'bank:b2'] }, ls: { vgame_done: done } });
  pg.starts()[0].click();
  playFall(pg, dictOf(pg, ['bank:b1', 'bank:b2']));
  const d = pg.get('vgame_done');
  const combos = Object.keys(d).filter(k => k.indexOf('+') > 0);
  const singles = Object.keys(d).filter(k => k.indexOf('+') < 0);
  const ok = combos.length === 10 && combos.indexOf('bank:b1+bank:b2') > -1 && combos.indexOf('bank:z2+word') > -1 && !d['bank:z0+word'] && !d['bank:z1+word']
    && J(d['+recent']) === J(['bank:b1+bank:b2'])
    && J(singles) === J(['word', 'bank:b1', 'phrase']) && J(d.word) === J(['refund']) && J(d['bank:b1']) === J(['apple']);
  return { ok, detail: J({ combos, singles, recent: d['+recent'] }) };
});
/* 雲端 progress.v 是 jsonb:物件的鍵存不住順序,灌回來時照長度、再照位元組排(短的在前)。陣列的順序存得住 */
const jsonbOrder = o => Object.fromEntries(Object.keys(o).sort((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b))).map(k => [k, o[k]]));
test('換一台、重新登入(雲端灌回來鍵的順序變了)之後:最近玩的組合不會先被刪,刪的是最久沒玩的', () => {
  const done = { word: ['refund'] };
  for (let i = 0; i < 9; i++) done['bank:z' + i + '+word'] = ['x' + i];
  const pg = openVocab({ banks: [B1(), B2()], src: { mode: 'word', level: '全部', modes: ['word', 'phrase'] }, ls: { vgame_done: done } });
  pg.starts()[0].click();
  playFall(pg, dictOf(pg, ['word', 'phrase']));   // 文章單字+片語:最近玩的
  buttons(pg.root, '回單字訓練')[0].click();
  const mid = pg.get('vgame_done');
  pg.set('vgame_done', jsonbOrder(mid));   // 另一台登入:雲端灌回來,phrase+word(11 個字)排到所有組合鍵前面
  const order = Object.keys(pg.get('vgame_done'));
  pg.toggle('word'); pg.toggle('phrase'); pg.toggle('bank:b1'); pg.toggle('bank:b2');
  pg.starts()[0].click();
  playFall(pg, dictOf(pg, ['bank:b1', 'bank:b2']));
  const d = pg.get('vgame_done');
  const combos = Object.keys(d).filter(k => k.indexOf('+') > 0);
  const ok = J(mid['+recent']) === J(['phrase+word']) && order.indexOf('phrase+word') < order.indexOf('bank:z0+word')
    && combos.length === 10 && !!d['phrase+word'] && d['phrase+word'].length === 20 && !!d['bank:b1+bank:b2'] && !d['bank:z0+word'] && !!d['bank:z1+word']
    && J(d['+recent']) === J(['phrase+word', 'bank:b1+bank:b2']) && J(d.word) === J(['refund']);
  return { ok, detail: J({ order, combos, recent: d['+recent'] }) };
});
test('+recent 不會被當成組合鍵:搬家(新版、76b7850 的 move-merge)換題庫 id 時原樣留著;壞掉的 +recent(不是陣列、有不存在的鍵)不丟錯', () => {
  const ov = { 'bank:b1+word': ['a'], '+recent': ['bank:b1+word'], 'bank:b1': ['b'] };
  const r = require('./fixtures/move_kit.js').M.remapRelated('vgame_done', ov, { b1: 'N1' });   // 搬家那一段的 M 在下面才定義
  const ro = oldMove().remapRelated('vgame_done', ov, { b1: 'N1' });
  const bad = [];
  [5, 'x', { a: 1 }, ['nope+word', 7, 'bank:b1+bank:b2']].forEach(rec => {
    try {
      const pg = openVocab({ banks: [B1(), B2()], src: { mode: 'bank:b1', level: '全部', modes: ['bank:b1', 'bank:b2'] }, ls: { vgame_done: { '+recent': rec } } });
      pg.starts()[0].click();
      playFall(pg, dictOf(pg, ['bank:b1', 'bank:b2']));
      const d = pg.get('vgame_done');
      if (J(d['+recent']) !== J(['bank:b1+bank:b2']) || !d['bank:b1+bank:b2']) bad.push(J(rec) + ' → ' + J(d));
    } catch (e) { bad.push(J(rec) + ' 丟錯 ' + e.message); }
  });
  const ok = J(r['+recent']) === J(['bank:b1+word']) && J(r['bank:N1+word']) === J(['a']) && J(ro['+recent']) === J(['bank:b1+word']) && !bad.length
    && Object.keys(r).filter(k => k.charAt(0) === '+').length === 1 && Object.keys(ro).filter(k => k.charAt(0) === '+').length === 1;
  return { ok, detail: J({ r, ro, bad }) };
});
test('再挑戰時別的分頁刪了其中一個題庫:照剩下的玩;剩的不夠就回首頁', () => {
  const pg = openVocab({ banks: [B1(), B2()], src: { mode: 'bank:b1', level: '全部', modes: ['bank:b1', 'bank:b2'] } });
  pg.starts()[0].click();
  playFall(pg, dictOf(pg, ['bank:b1', 'bank:b2']));
  pg.set('vgame_banks', [B1()]);
  buttons(pg.root, '再挑戰一關')[0].click();
  const title = textOf(pg.root.querySelector('h1'));
  const shown = playFall(pg, dictOf(pg, ['bank:b1']));
  const singleOk = /題庫：第3課/.test(title) && shown.length === 3 && pg.get('vgame_clear')['bank:b1'].n === 1;
  /* 吐司:一個字的題庫 + 第3課 = 4,刪掉第3課再烤一盤 → 剩 1 個字,跳說明回首頁 */
  const p2 = openVocab({ banks: [BA(), B1()], src: { mode: 'bank:bA', level: '全部', modes: ['bank:bA', 'bank:b1'] } });
  p2.starts()[2].click();
  playToast(p2, dictOf(p2, ['bank:bA', 'bank:b1']));
  p2.set('vgame_banks', [BA()]);
  buttons(p2.root, '再烤一盤')[0].click();
  const home = !!p2.root.querySelector('[data-vview="home"]');
  return { ok: singleOk && home && p2.alerts.length === 1, detail: J({ title, n: shown.length, home, alerts: p2.alerts }) };
});

/* ======================= 5. 只練這個、題庫卡片 ======================= */
test('題庫卡片的「只練這個」:只勾這一個,存的跟以前「用這個題庫」一樣,捲回上面、焦點移到框上(不另外捲);不到 3 個字不能按;卡片寫「練 N 個」', () => {
  El.focused = null; El.focusOpts = null;
  const pg = openVocab({ banks: [B1(), BB(), B2()], src: { mode: 'word', level: '中級', modes: ['word', 'bank:b1'] } });
  const btns = buttons(pg.root, '只練這個');
  const off = btns.map(isDisabled);
  btns[2].click();
  const bankCard = pg.root.all().filter(e => e.classList.contains('p-stats')).map(textOf).find(t => /^5 個字/.test(t));
  const small = pg.root.all().filter(e => e.classList.contains('p-stats')).map(textOf).find(t => /^2 個字/.test(t));
  const ok = J(off) === J([false, true, false]) && pg.raw('vgame_src') === '{"mode":"bank:b2","level":"中級"}' && J(pg.checked()) === J(['bank:b2'])
    && pg.scrolls.length === 1 && bankCard === '5 個字 · 練 3 個' && small === '2 個字 · 練 2 個（要 3 個以上才能單獨練）' && /文章：遠距工作/.test(pg.summary())
    && El.focused === pg.sumEl() && !!El.focusOpts && El.focusOpts.preventScroll === true;
  return { ok, detail: J({ off, src: pg.raw('vgame_src'), checked: pg.checked(), bankCard, small, focus: El.focused === pg.sumEl(), opts: El.focusOpts }) };
});

/* ======================= 6. 沒登入(先看再登入) ======================= */
test('沒登入:勾、取消、全選、改級別、只練這個都照樣換、卡片照新的選擇重畫,localStorage 一個字都沒寫;「開始」照舊有 data-gate', () => {
  const local = makeStorage();
  const pg = openVocab({ banks: [B1(), B2()], ls: { vgame_best: { phrase: 12, 'phrase+word': 21 } }, guest: true, local });
  const before = J(local.dump());
  pg.toggle('phrase');
  const a = pg.cards()[0];
  pg.toggle('word');
  const b = pg.cards()[0];
  const all = pg.allBox(); all.checked = true; all.fire('change');
  const sel = pg.levelSel(); sel.value = '初級'; sel.fire('change');
  const c = J(pg.checked());
  buttons(pg.root, '只練這個')[0].click();
  const d = J(pg.checked());
  const gated = pg.starts().every(x => x.hasAttribute('data-gate'));
  const ok = /最佳 中翻英 21/.test(a) && /最佳 中翻英 12/.test(b) && c === J(['word', 'phrase', 'bank:b1', 'bank:b2']) && d === J(['bank:b1']) && gated && J(local.dump()) === before;
  return { ok, detail: J({ a, b, c, d, gated, wrote: J(local.dump()) !== before }) };
});

/* ======================= 7. 舊版頁面(76b7850)讀新格式 ======================= */
test('舊版頁面讀新格式:不丟錯,下拉選單停在 mode,卡片只顯示 mode 自己的紀錄;舊版改選單寫回舊格式,新版讀到是單選', () => {
  const local = makeStorage();
  const ls = {
    vgame_best: { 'bank:b1+word': 50, word: 7 }, vgame_toast_best: { 'bank:b1+word': 5, word: 2 },
    vgame_pairs_best: { 'bank:b1+word:8': { moves: 11, secs: 22 }, 'phrase+word:8': { moves: 12, secs: 23 }, 'word:8': { moves: 33, secs: 44 } },
    vgame_clear: { 'bank:b1+word': { n: 9, secs: 1 }, word: { n: 1, secs: 30 } },
  };
  const pg = openVocab({ banks: [B1(), B2()], src: { mode: 'word', level: '中級', modes: ['word', 'bank:b1'] }, ls, old: true, local });
  const srcSel = pg.root.querySelector('.vg-source').all().filter(e => e.tagName === 'SELECT')[0];
  const shown = { mode: srcSel.value, cards: pg.cards() };
  srcSel.value = 'phrase'; srcSel.fire('change');
  const wrote = pg.raw('vgame_src');
  const nw = openVocab({ local });
  const ok = shown.mode === 'word' && /最佳 中翻英 7/.test(shown.cards[0]) && /通關 1 次/.test(shown.cards[0]) && /最佳 33 步/.test(shown.cards[1]) && /最佳 2 \/ 6/.test(shown.cards[2])
    && wrote === '{"mode":"phrase","level":"中級"}' && J(nw.checked()) === J(['phrase']);
  return { ok, detail: J({ shown, wrote, nw: nw.checked() }) };
});

test('勾文章單字(或片語)+不夠單獨玩的題庫(1 個字、空的):mode 是文章單字(片語),舊版頁面選單停在它、掉落消除和翻牌照常開始;有夠玩的題庫就是第一個夠玩的;全是不夠的題庫才是第一個題庫', () => {
  const BE = () => ({ id: 'bE', name: '新的空題庫', words: [] });
  const banks = () => [BE(), BA(), B1()];
  const pg = openVocab({ banks: banks() });
  pg.toggle('bank:bA');
  const one = pg.get('vgame_src');
  pg.toggle('bank:bA'); pg.toggle('bank:bE');
  const empty = pg.get('vgame_src');
  pg.toggle('bank:bA'); pg.toggle('bank:b1');
  const withOk = pg.get('vgame_src');
  pg.toggle('bank:b1'); pg.toggle('bank:bE'); pg.toggle('word'); pg.toggle('phrase');
  const phrase = pg.get('vgame_src');
  const sm = openVocab({ banks: [BA(), BB()] });
  sm.toggle('bank:bA'); sm.toggle('bank:bB'); sm.toggle('word');
  const small = sm.get('vgame_src');
  const smallStarts = sm.starts().map(isDisabled);
  /* 舊版頁面(76b7850)讀 one:選單停在文章單字;按掉落消除真的開始(離開首頁)、按翻牌真的開始(沒跳「字不夠」) */
  const oldFall = openVocab({ banks: banks(), src: one, old: true });
  const oldSel = oldFall.root.querySelector('.vg-source').all().filter(e => e.tagName === 'SELECT')[0].value;
  oldFall.starts()[0].click();
  const fallStarted = !oldFall.root.querySelector('[data-vview="home"]');
  const oldPairs = openVocab({ banks: banks(), src: empty, old: true });
  oldPairs.starts()[1].click();
  const pairsStarted = !!oldPairs.root.querySelector('.mem-grid') && !oldPairs.alerts.length;
  const ok = J(one) === J({ mode: 'word', level: '全部', modes: ['word', 'bank:bA'] })
    && J(empty) === J({ mode: 'word', level: '全部', modes: ['word', 'bank:bE'] })
    && J(withOk) === J({ mode: 'bank:b1', level: '全部', modes: ['word', 'bank:bE', 'bank:bA', 'bank:b1'] })
    && J(phrase) === J({ mode: 'phrase', level: '全部', modes: ['phrase', 'bank:bA'] })
    && J(small) === J({ mode: 'bank:bA', level: '全部', modes: ['bank:bA', 'bank:bB'] }) && J(smallStarts) === J([false, false, true, true])
    && oldSel === 'word' && fallStarted && pairsStarted;
  return { ok, detail: J({ one, empty, withOk, phrase, small, smallStarts, oldSel, fallStarted, pairsStarted, alerts: oldPairs.alerts }) };
});

/* ======================= 8. 搬家 ======================= */
const K = require('./fixtures/move_kit.js');
const M = K.M;
function oldMove() {
  const c = { console }; c.window = c; vm.createContext(c);
  vm.runInContext(gitShow('js/move-rules.js'), c); vm.runInContext(gitShow('js/move-merge.js'), c);
  return c.MOVE_MERGE;
}
test('搬家 remapRelated(vgame_src):mode 與 modes 裡的舊 id 都換新、順序不變、別的題庫不動;沒換到回原本那個物件;舊格式照舊', () => {
  const v = { mode: 'bank:b1', level: '全部', modes: ['bank:b1', 'word', 'bank:b2'] };
  const r = M.remapRelated('vgame_src', v, { b1: 'N1' });
  const same = M.remapRelated('vgame_src', v, { b9: 'N9' });
  const modesOnly = M.remapRelated('vgame_src', { mode: 'word', level: '全部', modes: ['word', 'bank:b2'] }, { b2: 'N2' });
  const oldFmt = M.remapRelated('vgame_src', { mode: 'bank:b1', level: '全部' }, { b1: 'N1' });
  const ok = J(r) === J({ mode: 'bank:N1', level: '全部', modes: ['bank:N1', 'word', 'bank:b2'] }) && same === v && J(v.modes) === J(['bank:b1', 'word', 'bank:b2'])
    && J(modesOnly) === J({ mode: 'word', level: '全部', modes: ['word', 'bank:N2'] }) && J(oldFmt) === J({ mode: 'bank:N1', level: '全部' });
  return { ok, detail: J({ r, same: same === v, modesOnly, oldFmt }) };
});
test('搬家 remapRelated(成績鍵):組合鍵換 id 後重新排序、後綴保留、舊鍵留著、新鍵已經有就不蓋;不相干的組合鍵不動', () => {
  const ov = {
    'bank:b1+word': 5, 'bank:b1+word:e2z': 4, 'bank:b1+bank:b5': 3, 'bank:b1+bank:b5:e2z': 2, 'bank:b1+phrase:8': { moves: 9, secs: 9 },
    'bank:b5+word': 7, 'phrase+word': 8, word: 1, 'bank:b1': 6, 'bank:b1:e2z': 6, 'bank:zz+word': 'keep',
  };
  const r = M.remapRelated('vgame_best', ov, { b1: 'zz' });
  const want = Object.assign({}, ov, { 'bank:zz': 6, 'bank:zz:e2z': 6, 'bank:b5+bank:zz': 3, 'bank:b5+bank:zz:e2z': 2, 'bank:zz+phrase:8': { moves: 9, secs: 9 }, 'bank:zz+word:e2z': 4 });
  const sorted = o => J(Object.keys(o).sort().map(k => [k, o[k]]));
  return { ok: sorted(r) === sorted(want) && r['bank:zz+word'] === 'keep', detail: sorted(r) };
});
test('搬家算的組合鍵跟 vocab.js 算的一樣(包含 id 裡有 + 和 : 的情況)', () => {
  const pg = openVocab({ banks: [B1()] });
  const k = pg.VS.key;
  const cases = [
    [['bank:b1', 'bank:b2'], { b1: 'zz' }, ['bank:zz', 'bank:b2']],
    [['bank:b1', 'word'], { b1: 'b0m1' }, ['bank:b0m1', 'word']],
    [['bank:b1', 'phrase', 'word'], { b1: 'x+y:z' }, ['bank:x+y:z', 'phrase', 'word']],
    [['bank:x+y:z', 'word'], { 'x+y:z': 'n1' }, ['bank:n1', 'word']],
  ];
  const bad = [];
  cases.forEach(([from, remap, to]) => {
    const r = M.remapRelated('vgame_toast_best', { [k(from)]: 4 }, remap);
    if (r[k(to)] !== 4) bad.push(k(from) + ' → 要 ' + k(to) + ',實際 ' + J(Object.keys(r)));
    const r2 = M.remapRelated('vgame_pairs_best', { [k(from) + ':8']: 1 }, remap);
    if (r2[k(to) + ':8'] !== 1) bad.push(k(from) + ':8 → ' + J(Object.keys(r2)));
  });
  return { ok: !bad.length, detail: bad.join(' | ') };
});
test('76b7850 的 move-merge.js 搬新版存的「文章單字+題庫」:新網址同 id 的另一個題庫不會被勾到,退回只勾學生自己的題庫(改了 id 的那個)', () => {
  /* 新版頁面勾文章單字+第3課 → 存的值;舊網址的 b1 跟新網址的 b1 內容不同,搬家改成 N1、名稱加「（舊網址）」 */
  const pg = openVocab({ banks: [B1()] });
  pg.toggle('bank:b1');
  const v = pg.get('vgame_src');
  const theirs = { id: 'b1', name: '新網址的第3課', words: [W('desk', '桌子'), W('chair', '椅子'), W('lamp', '檯燈')] };
  const mine = Object.assign(B1(), { id: 'N1', name: '第3課（舊網址）' });
  const r = oldMove().remapRelated('vgame_src', v, { b1: 'N1' });
  const after = openVocab({ banks: [theirs, mine], src: r });
  const rNew = M.remapRelated('vgame_src', v, { b1: 'N1' });
  const afterNew = openVocab({ banks: [theirs, mine], src: rNew });
  /* 舊版頁面(76b7850 的 vocab.js)讀這個值:下拉選單停在第3課 */
  const oldPg = openVocab({ banks: [B1(), B2()], src: v, old: true, ls: { vgame_best: { 'bank:b1': 4, word: 9 } } });
  const oldSel = oldPg.root.querySelector('.vg-source').all().filter(e => e.tagName === 'SELECT')[0];
  const ok = J(v) === J({ mode: 'bank:b1', level: '全部', modes: ['word', 'bank:b1'] })
    && J(after.checked()) === J(['bank:N1']) && /第3課（舊網址）/.test(after.summary())
    && J(afterNew.checked()) === J(['word', 'bank:N1'])
    && oldSel.value === 'bank:b1' && /最佳 中翻英 4/.test(oldPg.cards()[0]);
  return { ok, detail: J({ v, r, after: after.checked(), sum: after.summary(), afterNew: afterNew.checked(), old: oldSel.value }) };
});
test('76b7850 的 move-merge.js(快取裡的舊版)搬新格式:不丟錯,vgame_src 只換 mode;新版讀到退回單選', () => {
  const OM = oldMove();
  const v = { mode: 'bank:b1', level: '全部', modes: ['bank:b1', 'bank:b2'] };
  const r = OM.remapRelated('vgame_src', v, { b1: 'N1' });
  const best = OM.remapRelated('vgame_best', { 'bank:b1+bank:b2': 3, 'bank:b1': 2 }, { b1: 'N1' });
  const pg = openVocab({ banks: [Object.assign(B1(), { id: 'N1' }), B2()], src: r });
  const ok = r.mode === 'bank:N1' && J(r.modes) === J(['bank:b1', 'bank:b2']) && best['bank:N1'] === 2 && best['bank:b1+bank:b2'] === 3 && J(pg.checked()) === J(['bank:N1']);
  return { ok, detail: J({ r, best, checked: pg.checked() }) };
});

console.log(pass + ' / ' + (pass + fail) + ' 通過');
process.exit(fail ? 1 : 0);
