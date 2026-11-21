/* 淘汰題(題庫檢查 2026-11-19):題目從 data/raw 的批次檔移走、記在 data/retired.json 之後,
   學生已經作答過那些題,網站各頁照樣畫得出來、不丟錯;答案就地改(answer 索引)也一樣。
   A. tools/merge_data.py:在暫存資料夾複製 data/raw,每個 Part 淘汰一題(或一組)、一題 Part 5 改答案,合併要過;
      淘汰的 id 還在題庫、替代題不在題庫、批次檔名不對、聽力 id 重複、新題重複用舊 id,合併要擋下來。
      需要 Python 3:先看環境變數 PYTHON,再試 python3、python、py;都沒有就跳過 A(印出原因、結尾列出略過幾項),B 改在記憶體裡把那幾題拿掉照跑。
   B. 用合併出來的題庫(淘汰後)和含有淘汰題紀錄的作答資料(刷題、聽力、模擬考錯題、學習記錄),
      在 node vm + 最小 DOM 裡跑學習記錄、錯題本(刷題頁)、每日複習、能力分析、教師後台、模擬考、題庫刷題、聽力刷題;
      每日練習不讀多益題庫(只檢查程式沒有讀)。
   不連網、不開瀏覽器;不改 repo 的檔案(暫存資料夾在系統 temp,跑完刪掉)。
   用法:node tools/test_retired.js(可設 PYTHON=python 執行檔路徑) */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const J = (x) => JSON.stringify(x);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + detail : '')); };

/* ---------- 準備:暫存的 data/raw,每個 Part 淘汰一筆 ---------- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-test-'));
const RAW = path.join(TMP, 'raw'), OUT = path.join(TMP, 'out'), RET = path.join(TMP, 'retired.json');
fs.mkdirSync(RAW); fs.mkdirSync(OUT);
fs.readdirSync(path.join(REPO, 'data', 'raw')).forEach((f) => fs.copyFileSync(path.join(REPO, 'data', 'raw', f), path.join(RAW, f)));

const PARTS = { '5': /^part5_b\d+\.json$/, '6': /^part6_b\d+\.json$/, '7': /^part7_b\d+\.json$/, '1': /^listening_p1(_b\d+)?\.json$/,
  '2': /^listening_p2_b\d+\.json$/, '3': /^listening_p3_b\d+\.json$/, '4': /^listening_p4_b\d+\.json$/ };
const filesOf = (p) => fs.readdirSync(RAW).filter((f) => PARTS[p].test(f)).sort();
/* 每個 Part 淘汰第 PICK 筆(照合併的順序:檔名排序、檔內順序) */
const PICK = { '5': 5, '6': 2, '7': 3, '1': 0, '2': 3, '3': 1, '4': 2 };
const retired = {};   // part → 被淘汰的那一筆(整筆內容)
Object.keys(PICK).forEach((p) => {
  let k = PICK[p];
  for (const f of filesOf(p)) {
    const arr = readJson(path.join(RAW, f));
    if (k < arr.length) {
      retired[p] = arr[k];
      fs.writeFileSync(path.join(RAW, f), J(arr.filter((_, i) => i !== k)));
      return;
    }
    k -= arr.length;
  }
});
/* Part 5 另外一題就地改答案(answer 換成原本的下一個選項) */
const p5file = filesOf('5')[0];
const p5arr = readJson(path.join(RAW, p5file));
const changed = Object.assign({}, p5arr[0], { answer: (p5arr[0].answer + 1) % 4 });
fs.writeFileSync(path.join(RAW, p5file), J([changed].concat(p5arr.slice(1))));
/* Part 5 的替代題:新批次 b99,新 id */
const newP5 = Object.assign({}, retired['5'], { id: 'p5-b99-01' });
fs.writeFileSync(path.join(RAW, 'part5_b99.json'), J([newP5]));
const retiredList = Object.keys(retired).map((p) => ({ id: retired[p].id, part: p, date: '2026-11-20', reason: '測試用。',
  replacedBy: p === '5' ? 'p5-b99-01' : null }));
fs.writeFileSync(RET, J({ retired: retiredList }));

/* ---------- A. merge_data.py ---------- */
function findPython() {
  const cands = [process.env.PYTHON, 'python3', 'python', 'py'].filter(Boolean);
  for (const c of cands) {
    const r = spawnSync(c, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && String(r.stdout).trim() === '3') return c;
  }
  return null;
}
const PY_TRIED = [process.env.PYTHON, 'python3', 'python', 'py'].filter(Boolean);
const SKIPPED = [];
const PY = findPython();
function merge(env) {
  const r = spawnSync(PY, [path.join(REPO, 'tools', 'merge_data.py')], { encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', MERGE_RAW_DIR: RAW, MERGE_OUT_DIR: OUT, MERGE_RETIRED: RET }, env || {}) });
  return { code: r.status, out: String(r.stdout) + String(r.stderr) };
}
/* 改一下暫存資料、合併、再改回來 */
function mergeWith(edit) {
  const undo = edit();
  try { return merge(); } finally { undo(); }
}
const writeTmp = (f, data) => { const p = path.join(RAW, f); const old = fs.existsSync(p) ? fs.readFileSync(p) : null; fs.writeFileSync(p, J(data));
  return () => { if (old === null) fs.unlinkSync(p); else fs.writeFileSync(p, old); }; };

let usedMerged = false;
if (!PY) {
  SKIPPED.push('A1-A8 merge_data.py 的淘汰檢查(8 項)');
  console.log('SKIP A1-A8(8 項):找不到可用的 Python 3(試過 ' + PY_TRIED.join('、') + '),設 PYTHON=python 執行檔路徑可以跑;B 改在記憶體裡拿掉淘汰題照跑');
} else {
  const ok = merge();
  const total = /多益題庫合計 (\d+) 題/.exec(ok.out);
  check('A1 每個 Part 淘汰一筆、Part 5 一題改答案、加一題替代題:合併通過,寫出 data/*.js,摘要寫已淘汰 7 筆', ok.code === 0 && /已淘汰 7 筆/.test(ok.out)
    && fs.existsSync(path.join(OUT, 'part5.js')) && fs.existsSync(path.join(OUT, 'listening.js')), 'exit ' + ok.code + (total ? ',合計 ' + total[1] + ' 題' : ''));
  usedMerged = ok.code === 0;

  const r2 = mergeWith(() => writeTmp('part5_b98.json', [Object.assign({}, retired['5'])]));
  check('A2 已淘汰的 id 又出現在題庫(沒移乾淨、或新題重複用舊 id):擋下', r2.code === 1 && r2.out.includes('已淘汰的 id 還在題庫'), 'exit ' + r2.code);

  const r3 = mergeWith(() => { const old = fs.readFileSync(RET); fs.writeFileSync(RET, J({ retired: retiredList.map((r) => (r.part === '6' ? Object.assign({}, r, { replacedBy: 'p6-b77-1' }) : r)) }));
    return () => fs.writeFileSync(RET, old); });
  check('A3 替代題不在題庫:擋下', r3.code === 1 && r3.out.includes('不在 Part 6 題庫'), 'exit ' + r3.code);

  const r4 = mergeWith(() => writeTmp('part5_b3_retired.json', []));
  check('A4 淘汰的題另存在 data/raw(part5_b3_retired.json):檔名不對,擋下(不然會被當成題庫載入)', r4.code === 1 && r4.out.includes('檔名不是批次格式'), 'exit ' + r4.code);

  const l2 = filesOf('2')[0];
  const r5 = mergeWith(() => { const arr = readJson(path.join(RAW, l2)); return writeTmp(l2, arr.concat([arr[0]])); });
  check('A5 聽力 id 重複:擋下(以前只查 Part 5/6/7)', r5.code === 1 && r5.out.includes('Part 2: id 重複'), 'exit ' + r5.code);

  const r6 = mergeWith(() => { const old = fs.readFileSync(RET); fs.writeFileSync(RET, J({ retired: retiredList.concat([Object.assign({}, retiredList[0], { id: 'p5-b1-01:0' })]) }));
    return () => fs.writeFileSync(RET, old); });
  check('A6 淘汰名單寫成小題的鍵(題組 id:小題):擋下(只能整題、整組淘汰)', r6.code === 1 && r6.out.includes('id 不是 Part'), 'exit ' + r6.code);

  const r7 = mergeWith(() => writeTmp(filesOf('5')[1], []));
  check('A7 一個批次檔的題全淘汰(剩空陣列):照樣通過,只警告可以刪掉;沒有固定每批題數、檔名清單、連號檢查', r7.code === 0 && r7.out.includes('空的批次檔'), 'exit ' + r7.code);

  /* 首頁說明文字寫「題庫超過 N 題」:題庫剩不到 N+1 題就擋下(這裡用暫存的首頁,寫 2000 題) */
  const idx = path.join(TMP, 'index.html');
  fs.writeFileSync(idx, '<meta name="description" content="聽力、閱讀 Part 1–7 題庫超過 2000 題，每題附解析">');
  const r8 = merge({ MERGE_INDEX: idx });
  fs.writeFileSync(idx, '<meta name="description" content="聽力、閱讀 Part 1–7 題庫超過 900 題，每題附解析">');
  const r9 = merge({ MERGE_INDEX: idx });
  check('A8 首頁寫「題庫超過 N 題」而題庫不到:擋下;題庫超過就通過', r8.code === 1 && r8.out.includes('題庫超過 2000 題') && r9.code === 0, 'exit ' + r8.code + '/' + r9.code);
}

/* ---------- B. 頁面 ---------- */
/* 題庫:有合併結果就用(真的淘汰過),不然把 repo 的 data/*.js 在記憶體裡拿掉那幾筆、改那一題答案 */
function bankSources() {
  const src = {};
  ['part5', 'part6', 'part7', 'listening'].forEach((f) => { src['data/' + f + '.js'] = usedMerged ? fs.readFileSync(path.join(OUT, f + '.js'), 'utf8') : read('data/' + f + '.js'); });
  ['articles', 'diagnostic', 'writing', 'phrases', 'grammar', 'phonics', 'verbs'].forEach((f) => { src['data/' + f + '.js'] = read('data/' + f + '.js'); });
  return src;
}
const SRC = bankSources();
const RET_IDS = new Set(retiredList.map((r) => r.id));
/* 作答紀錄用的題庫(有些頁不載聽力題庫,紀錄照樣要有聽力的) */
function fullBank() { const c = {}; c.window = c; vm.createContext(c); ["part5", "part6", "part7", "listening"].forEach((n) => vm.runInContext(SRC["data/" + n + ".js"], c)); trimBank(c.TOEIC); return c.TOEIC; }
function trimBank(T) {
  if (usedMerged || !T) return;
  /* 頁面只載部分題庫時(例如沒載 data/listening.js),只處理有載到的 */
  const drop = (a) => (Array.isArray(a) ? a.filter((x) => !RET_IDS.has(x.id)) : a);
  if (Array.isArray(T.part5)) T.part5 = drop(T.part5).map((q) => (q.id === changed.id ? changed : q));
  T.part6 = drop(T.part6); T.part7 = drop(T.part7);
  const L = T.listening;
  if (L) ['p1', 'p2', 'p3', 'p4'].forEach((k) => { L[k] = drop(L[k]); });
}

/* 作答紀錄:每個 Part 一筆淘汰題的錯題、幾筆還在的題;Part 5 改了答案那題「選的剛好是新答案、當時判錯」 */
const NOW = Date.UTC(2026, 10, 19, 4, 0, 0);
function records(T) {
  const L = T.listening, wrongC = (q) => (q.answer + 1) % q.options.length;
  const r = (c, ok, dt) => ({ c, ok, t: NOW - dt });
  const d5 = { [retired['5'].id]: r(wrongC(retired['5']), false, 900), [changed.id]: r(changed.answer, false, 800) };
  T.part5.slice(1, 13).forEach((q, i) => { d5[q.id] = r(i % 3 ? q.answer : wrongC(q), !!(i % 3), 700 - i); });
  const s6 = retired['6'], s7 = retired['7'], s3 = retired['3'], s4 = retired['4'];
  const d6 = { [s6.id + ':' + s6.questions[0].num]: r(wrongC(s6.questions[0]), false, 600), [T.part6[0].id + ':' + T.part6[0].questions[1].num]: r(wrongC(T.part6[0].questions[1]), false, 590) };
  const d7 = { [s7.id + ':0']: r(wrongC(s7.questions[0]), false, 580), [T.part7[0].id + ':1']: r(wrongC(T.part7[0].questions[1]), false, 570) };
  const l1 = { [retired['1'].id]: r(wrongC(retired['1']), false, 560), [L.p1[0].id]: r(wrongC(L.p1[0]), false, 555) };
  const l2 = { [retired['2'].id]: r(wrongC(retired['2']), false, 550), [L.p2[0].id]: r(wrongC(L.p2[0]), false, 545) };
  const l3 = { [s3.id + ':2']: r(wrongC(s3.questions[2]), false, 540), [L.p3[0].id + ':0']: r(wrongC(L.p3[0].questions[0]), false, 535) };
  const l4 = { [s4.id + ':1']: r(wrongC(s4.questions[1]), false, 530), [L.p4[0].id + ':2']: r(wrongC(L.p4[0].questions[2]), false, 525) };
  const mock = { [retired['5'].id]: r(1, false, 100), [s6.id + ':' + s6.questions[1].num]: r(0, false, 100), [s7.id + ':1']: r(0, false, 100),
    [retired['1'].id]: r(0, false, 100), [retired['2'].id]: r(0, false, 100), [s3.id + ':0']: r(0, false, 100), [s4.id + ':0']: r(0, false, 100) };
  const hist = [];
  const add = (m, map) => Object.keys(map).forEach((id) => hist.push({ m, id, c: map[id].c, ok: map[id].ok, t: map[id].t }));
  add('p5', d5); add('p6', d6); add('p7', d7); add('l1', l1); add('l2', l2); add('l3', l3); add('l4', l4);
  hist.sort((a, b) => a.t - b.t);
  return { drill_p5: d5, drill_p6: d6, drill_p7: d7, listen_p1: l1, listen_p2: l2, listen_p3: l3, listen_p4: l4, mock_wrong: mock, hist };
}

/* 最小 DOM */
function fakeDom() {
  class Node {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.nodeType = tag === '#text' ? 3 : 1; this.children = []; this.parentNode = null; this.attrs = {};
      this.className = ''; this._text = ''; this.on = {}; this.dataset = {}; this.style = {}; this.hidden = false; this.disabled = false; this.value = ''; this.checked = false; this.id = ''; }
    get childNodes() { return this.children; }
    get firstChild() { return this.children[0] || null; }
    append(...ns) { ns.forEach((n) => { if (n === null || n === undefined) return; if (!(n instanceof Node)) { const t = new Node('#text'); t._text = String(n); n = t; } if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.children.push(n); }); }
    appendChild(n) { this.append(n); return n; }
    prepend(n) { if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.children.unshift(n); }
    before(n) { const p = this.parentNode; if (!p) return; if (n.parentNode) n.parentNode._rm(n); n.parentNode = p; p.children.splice(p.children.indexOf(this), 0, n); }
    after(n) { const p = this.parentNode; if (!p) return; if (n.parentNode) n.parentNode._rm(n); n.parentNode = p; p.children.splice(p.children.indexOf(this) + 1, 0, n); }
    insertBefore(n, ref) { if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
    replaceWith(n) { const p = this.parentNode; if (!p) return; if (n.parentNode) n.parentNode._rm(n); p.children[p.children.indexOf(this)] = n; n.parentNode = p; this.parentNode = null; }
    replaceChildren(...ns) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = ''; this.append(...ns); }
    _rm(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; }
    remove() { if (this.parentNode) this.parentNode._rm(this); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    closest() { return null; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.tagName === 'ROOT'; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'hidden') this.hidden = true; }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; if (k === 'hidden') this.hidden = false; }
    toggleAttribute(k, on) { if (on === undefined) on = !(k in this.attrs); if (on) this.setAttribute(k, ''); else this.removeAttribute(k); return on; }
    addEventListener(t, fn) { (this.on[t] = this.on[t] || []).push(fn); }
    removeEventListener(t, fn) { this.on[t] = (this.on[t] || []).filter((f) => f !== fn); }
    dispatchEvent() { return true; }
    async fire(t, ev) { const e = Object.assign({ preventDefault() {}, stopPropagation() {}, currentTarget: this, target: this, key: '' }, ev); for (const f of (this.on[t] || [])) await f(e); }
    click() { return this.fire('click'); }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = String(v); }
    get innerText() { return this.textContent; }
    set innerHTML(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = ''; this._html = String(v); }
    get innerHTML() { return this._html || ''; }
    get classList() { const el = this; return { add(...cs) { cs.forEach((c) => el.classList.toggle(c, true)); }, remove(...cs) { cs.forEach((c) => el.classList.toggle(c, false)); },
      toggle(c, on) { const s = new Set(el.className.split(' ').filter(Boolean)); if (on === undefined) on = !s.has(c); if (on) s.add(c); else s.delete(c); el.className = [...s].join(' '); return on; },
      contains(c) { return el.className.split(' ').includes(c); } }; }
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 20, bottom: 20, right: 100 }; }
    scrollIntoView() {} focus() {} blur() {} select() {} play() { return Promise.resolve(); } pause() {} load() {}
    find(pred) { const out = []; const walk = (n) => { if (pred(n)) out.push(n); n.children.forEach(walk); }; walk(this); return out; }
    byText(t) { return this.find((n) => n.nodeType === 1 && (n.tagName === 'BUTTON' || n.tagName === 'A') && n.textContent === t); }
    querySelector(s) { const m = /^#([\w-]+)$/.exec(s); return m ? this.find((n) => n.id === m[1])[0] || null : null; }
    querySelectorAll() { return []; }
  }
  const root = new Node('ROOT');
  const html = new Node('html'); const body = new Node('body'); root.append(html); html.append(body);
  const document = { createElement: (t) => new Node(t), createElementNS: (ns, t) => new Node(t), createTextNode: (t) => { const n = new Node('#text'); n._text = String(t); return n; },
    createDocumentFragment: () => new Node('#fragment'), body, documentElement: html, title: '', visibilityState: 'visible', hidden: false,
    querySelector: (s) => body.querySelector(s), querySelectorAll: () => [], getElementById: (id) => body.querySelector('#' + id),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, activeElement: null };
  return { Node, body, document };
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* 開一頁:rootId 是頁面的根節點 id;scripts 是 data/、js/ 底下要載的檔(照 HTML 的順序,不載雲端、小雞、付費牆) */
async function openPage(o) {
  const dom = fakeDom();
  const root = new dom.Node('main'); root.setAttribute('id', o.rootId); dom.body.append(root);
  const ls = new Map(), PID = 'p1test';
  ls.set('tr_current_profile', J(PID));
  const errors = [];
  const ctx = { console: { log() {}, warn() {}, error: (...a) => errors.push('console.error ' + a.join(' ')) }, document: dom.document, URL, URLSearchParams, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval() {}, Promise, Date, Math, JSON, Intl, Blob: function () {}, confirm: () => true, alert() {}, scrollTo() {}, requestAnimationFrame: (f) => setTimeout(f, 0),
    matchMedia: (q) => ({ matches: /reduced-motion/.test(q), addEventListener() {}, removeEventListener() {} }), CustomEvent: function (t, d) { this.type = t; this.detail = d && d.detail; },
    Audio: function () { this.play = () => Promise.resolve(); this.pause = () => {}; this.addEventListener = () => {}; this.removeEventListener = () => {}; },
    history: { replaceState() {}, pushState() {}, back() {} }, navigator: { userAgent: 'node' },
    location: { search: o.search || '', hash: o.hash || '', pathname: '/' + o.page, href: 'https://x/' + o.page + (o.search || ''), origin: 'https://x', reload() {} },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k), key: (i) => [...ls.keys()][i] || null, get length() { return ls.size; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  if (o.extra) Object.assign(ctx, o.extra(ctx));
  vm.createContext(ctx);
  const onRej = (e) => errors.push('promise ' + (e && e.stack || e));
  process.on('unhandledRejection', onRej);
  try {
    o.scripts.forEach((f) => {
      if (f.startsWith('data/')) { vm.runInContext(SRC[f], ctx, { filename: f }); if (f === 'data/listening.js') trimBank(ctx.TOEIC); return; }
      if (f === 'js/common.js') {
        vm.runInContext(read(f), ctx, { filename: f });
        trimBank(ctx.TOEIC);
        const rec = records(fullBank());
        Object.keys(rec).forEach((k) => ls.set('tr_u' + PID + '_' + k, J(rec[k])));
        if (o.store) Object.keys(o.store).forEach((k) => ls.set('tr_u' + PID + '_' + k, J(o.store[k])));
        return;
      }
      vm.runInContext(read(f), ctx, { filename: f });
    });
    await settle();
    if (o.act) await o.act(ctx, root);
    await settle();
  } catch (e) { errors.push(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)); }
  process.removeListener('unhandledRejection', onRej);
  return { root, text: root.textContent, errors, ctx, ls, PID };
}
const DATA = (...names) => names.map((n) => 'data/' + n + '.js');

async function main() {
  const ids = retiredList.map((r) => r.id);
  const noRetiredKey = (keys) => !keys.some((k) => RET_IDS.has(String(k).split(':')[0]));

  /* B1 學習記錄 */
  {
    const p = await openPage({ page: 'history.html', rootId: 'history-root', scripts: DATA('part5', 'part6', 'part7', 'listening', 'phrases', 'grammar', 'phonics', 'verbs', 'articles').concat(['js/common.js', 'js/history.js']) });
    const gone = (p.text.match(/這題已從題庫移除/g) || []).length;
    check('B1 學習記錄:淘汰題的紀錄照列、寫「這題已從題庫移除」(7 個 Part 各一筆)、不能展開;其他照常、不丟錯', !p.errors.length && gone === 7 && p.text.includes('學習記錄'), '移除 ' + gone + ' 筆 ' + p.errors.join(' / '));
  }
  /* B2 錯題本資料(js/wrongbook.js):每個 Part 的錯題、分組、一回、題組數、模擬考交卷收錯題 */
  {
    const p = await openPage({ page: 'practice.html', rootId: 'practice-root', scripts: DATA('part5', 'part6', 'part7', 'listening').concat(['js/common.js', 'js/sync-merge.js', 'js/wrongbook.js']) });
    const WB = p.ctx.WRONGBOOK, bad = [];
    WB.PARTS.forEach((pt) => {
      const it = WB.items(pt), gr = WB.groups(pt), rd = WB.round(pt);
      if (!noRetiredKey(it.map((x) => x.key))) bad.push(pt + ' items 有淘汰題');
      if (!it.length) bad.push(pt + ' 還在的錯題不見了');
      if (gr.reduce((n, g) => n + g.items.length, 0) !== it.length) bad.push(pt + ' 分組題數不對');
      if (rd.total !== it.length) bad.push(pt + ' 一回的總數不對');
      it.forEach((x) => { WB.stem(x); WB.optText(x.q, x.c); });
      WB.setCount(pt);
    });
    const add = WB.fromAnswers(ids.map((id) => [id, 0]).concat(ids.map((id) => [id + ':0', 0])), NOW);
    if (Object.keys(add).length) bad.push('模擬考交卷收了淘汰題 ' + J(Object.keys(add)));
    check('B2 錯題本資料:7 個 Part 的錯題、分組、一回、題組數都不含淘汰題、不丟錯;模擬考作答(含分頁暫存補存)帶淘汰題的 key 會被丟掉', !p.errors.length && !bad.length, bad.join(' / ') + p.errors.join(' / '));
  }
  /* B3 題庫刷題:首頁、錯題本清單、錯題複習(Part 5/6/7 與聽力 1–4)、聽力刷題、深連結 */
  /* 題庫刷題用 window.UI(js/ui.js 的專心模式、結算卡、空狀態):這裡的小 DOM 撐不起真的 ui.js,換成一個只把文字放進頁面的替身 */
  const UI_STUB = (ctx) => {
    const mk = (cls, ...kids) => { const n = ctx.document.createElement('div'); n.className = cls; n.append(...kids); return n; };
    return { UI: {
      focus: { enter: () => ({ bar: mk('quiz-bar'), progress() {}, setTotal() {}, dirty() {}, foot() {}, action() {}, feedback() { return null; }, leave() {} }) },
      result: (o) => { const el = mk('result-card', String(o.kicker || ''), ' ', String(o.score !== undefined ? o.score : o.big)); return { el, reward: mk('result-reward'), heading: el, destroy() {} }; },
      detail: (title, nodes) => mk('result-detail', title, ...nodes),
      empty: (o) => mk('ui-empty', o.text),
      confirm: () => Promise.resolve(true), doodle: () => Promise.resolve(false),
    } };
  };
  const PRACTICE = DATA('part5', 'part6', 'part7', 'listening').concat(['js/common.js', 'js/sync-merge.js', 'js/wrongbook.js', 'js/wrongbook-ui.js', 'js/listening.js', 'js/practice.js']);
  const modes = [['', '首頁']].concat(['5', '6', '7', '1', '2', '3', '4'].map((pt) => ['?mode=wrong&part=' + pt, '錯題本 Part ' + pt]),
    ['5', '6', '7', '1', '2', '3', '4'].map((pt) => ['?mode=review&part=' + pt, '錯題複習 Part ' + pt]), [['?part=5', 'Part 5 深連結'], ['?part=7', 'Part 7 深連結']]);
  for (const [search, label] of modes) {
    const p = await openPage({ page: 'practice.html', rootId: 'practice-root', search, scripts: PRACTICE, extra: UI_STUB });
    const leaked = ids.filter((id) => p.text.includes(id));
    check('B3 題庫刷題 ' + label + ':畫得出來、不丟錯、畫面沒有淘汰題的 id', !p.errors.length && p.text.length > 20 && !leaked.length, p.errors.join(' / ') + leaked.join(','));
  }
  /* B4 錯題本(js/review.js 用 js/ui.js 的專心模式與結算卡;這個最小 DOM 放不下 ui.js,換成替身) */
  {
    const node = (ctx, cls) => { const n = ctx.document.createElement('div'); n.className = cls; return n; };
    const p = await openPage({ page: 'review.html', rootId: 'review-root', scripts: DATA('part5', 'part6', 'part7', 'listening', 'phrases', 'grammar', 'phonics').concat(['js/common.js', 'js/sync-merge.js', 'js/wrongbook.js', 'js/review.js']),
      extra: (ctx) => ({ UI: { doodle() {}, empty: (o) => { const n = node(ctx, 'ui-empty'); n.textContent = o.text; return n; },
        focus: { enter: () => ({ progress() {}, foot() {}, feedback() {}, leave() {} }) },
        result: () => ({ el: node(ctx, 'result-card'), reward: node(ctx, 'result-reward'), heading: node(ctx, 'result-score'), destroy() {} }) } }),
      act: async (ctx, root) => { const b = root.find((n) => n.tagName === 'BUTTON' && /開始/.test(n.textContent))[0]; if (b) await b.click(); } });
    check('B4 錯題本:待複習題數不算淘汰題,開始複習畫得出來、不丟錯', !p.errors.length && p.text.includes('錯題本'), p.errors.join(' / '));
  }
  /* B5 能力分析 */
  {
    const p = await openPage({ page: 'analysis.html', rootId: 'analysis-root', scripts: DATA('part5', 'part6', 'part7', 'diagnostic', 'articles', 'writing').concat(['js/common.js', 'js/sync-merge.js', 'js/wrongbook.js', 'js/wrongbook-ui.js', 'js/analysis.js']) });
    const m = /刷題(\d+)\/(\d+)/.exec(p.text.replace(/\s/g, ''));
    check('B5 能力分析:只算題庫裡還在的題(淘汰題的紀錄不算進作答數與正確率),學習量的已作答不超過題庫題數、不丟錯', !p.errors.length && p.text.includes('能力分析') && m && Number(m[1]) <= Number(m[2]),
      (m ? m[0] : '找不到學習量') + ' ' + p.errors.join(' / '));
  }
  /* B6 教師後台:學生的錯題清單 */
  {
    const S = 'stud-0001';
    const rows = (T) => { const rec = records(T); return Object.keys(rec).map((k) => ({ user_id: S, k, v: rec[k], updated_at: '2026-11-19T00:00:00Z' }))
      .concat([{ user_id: S, k: '_meta', v: { name: '測試學生' }, updated_at: '2026-11-19T00:00:00Z' }]); };
    for (const withWb of [true, false]) {
      const p = await openPage({ page: 'admin.html', rootId: 'admin-root', scripts: DATA('part5', 'part6', 'part7', 'articles', 'diagnostic').concat(['js/common.js', 'js/sync-merge.js'], withWb ? ['js/wrongbook.js'] : [], ['js/admin.js']),
        extra: (ctx) => ({ CLOUD: { enabled: true, user: { id: 'teacher-1', email: 't@example.test' }, ready: Promise.resolve(), isTeacher: true,
          client: { from: () => ({ select: () => Promise.resolve({ data: rows(fullBank()), error: null }) }) } } }) });
      const t = p.text;
      const bad = /#0|題組0/.test(t) || ids.some((id) => t.includes(id));
      check('B6 教師後台' + (withWb ? '' : '(沒載到 js/wrongbook.js)') + ':學生錯題清單畫得出來、不丟錯、不出現淘汰題的 id 或 #0、題組0',
        !p.errors.length && t.includes('測試學生') && t.includes('錯題') && !bad, p.errors.join(' / ') + (bad ? ' 有 #0/題組0/淘汰 id' : ''));
    }
  }
  /* B7 模擬考:標準半回開考、交卷、看結果;題目從淘汰後的題庫抽 */
  {
    const p = await openPage({ page: 'mock.html', rootId: 'mock-root', scripts: DATA('part5', 'part6', 'part7', 'listening').concat(['js/common.js', 'js/ui.js', 'js/sync-merge.js', 'js/wrongbook.js', 'js/mock.js']),
      act: async (ctx, root) => {
        const starts = root.find((n) => n.tagName === 'BUTTON' && n.textContent === '開始');
        await starts[starts.length - 1].click(); await settle();
        /* 專心模式:「交卷」在作答列(不在 root 底下),沒答完會開 UI.confirm,按它的確定(表單送出)才交卷 */
        const body = ctx.document.body;
        const sub = body.find((n) => n.tagName === 'BUTTON' && /交卷/.test(n.textContent))[0];
        if (sub) {
          await sub.click(); await settle();
          const dlg = body.find((n) => n.tagName === 'FORM')[0];
          if (dlg) { await dlg.fire('submit'); await wait(80); await settle(); }
        }
      } });
    const hist = JSON.parse(p.ls.get('tr_u' + p.PID + '_mock_history') || '[]');
    const mw = JSON.parse(p.ls.get('tr_u' + p.PID + '_mock_wrong') || '{}');
    check('B7 模擬考:開考、交卷、看結果不丟錯;成績存進 mock_history;mock_wrong 原有的淘汰題紀錄留著不動(資料不刪),新收的錯題都是題庫裡的題',
      !p.errors.length && hist.length === 1 && hist[0].lTotal === 36 && ids.every((id) => !p.text.includes(id)), p.errors.join(' / ') + ' 歷史 ' + hist.length + ' 筆,聽力 ' + (hist[0] || {}).lTotal + ' 題,mock_wrong ' + Object.keys(mw).length + ' 筆');
  }
  /* B8 每日練習:不讀多益題庫 */
  {
    const src = read('js/daily.js') + read('js/daily-ui.js');
    check('B8 每日練習(js/daily.js、js/daily-ui.js)不讀 TOEIC.part5/6/7、TOEIC.listening:淘汰題影響不到', !/TOEIC\.(part[567]|listening)|\.part[567]\b|\.listening\b/.test(src));
  }
  /* B9 答案就地改:那一題現在的正解剛好是學生當時選的(當時判錯) */
  {
    const p = await openPage({ page: 'practice.html', rootId: 'practice-root', search: '?mode=wrong&part=5', scripts: PRACTICE, extra: UI_STUB });
    const WB = p.ctx.WRONGBOOK;
    const x = WB.items('5').find((y) => y.key === changed.id);
    check('B9 答案就地改:頁面不丟錯;舊紀錄的對錯照當時判的(這題還在錯題本,選的跟現在的正解一樣),重做答對就移出',
      !p.errors.length && x && x.c === changed.answer, x ? '還在錯題本,選 ' + x.c + ' 正解 ' + x.q.answer : '不在錯題本');
  }
}

main().catch((e) => { check('沒有預期外的錯誤', false, e && e.stack); }).finally(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 暫存檔刪不掉不影響結果 */ }
  const pass = results.filter((r) => r.ok).length;
  console.log(pass + ' / ' + results.length + ' 通過' + (SKIPPED.length ? ';略過 ' + SKIPPED.join('、') + '(找不到 Python 3)' : ''));
  process.exitCode = pass === results.length ? 0 : 1;
});
