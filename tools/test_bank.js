/* 題庫取題介面(js/bank.js)與題目索引(data/bank-meta.js)。
   node + vm:載真的題庫檔、索引與 js/bank.js;作答紀錄用假的 store。不開瀏覽器、不連網。
   另外用 tools/merge_data.py 產生一份到暫存資料夾,確認 repo 裡的索引是最新的、其他輸出檔一個位元組都沒變。
   用法:node tools/test_bank.js */
'use strict';
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const J = JSON.stringify;
const plain = (x) => JSON.parse(J(x));
/* Python 3:先看環境變數 PYTHON,再試 python3、python、py;都沒有就略過 B6(印出原因,不算失敗) */
function findPython() {
  for (const c of [process.env.PYTHON, 'python3', 'python', 'py'].filter(Boolean)) {
    const r = spawnSync(c, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && String(r.stdout).trim() === '3') return c;
  }
  return null;
}
const PY = findPython();
const DATA = ['data/part5.js', 'data/part6.js', 'data/part7.js', 'data/listening.js'];

/* 一個沙盒:題庫檔(預設四個都載)、索引、js/bank.js;store 是假的 */
function sandbox(opt) {
  opt = opt || {};
  const mem = new Map(Object.entries(opt.records || {}).map(([k, v]) => [k, J(v)]));
  const ctx = { console, Promise, Map, Set, JSON, Object, Array, Math, Number, String, TypeError, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  (opt.data || DATA).forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  if (opt.meta !== false) vm.runInContext(read('data/bank-meta.js'), ctx, { filename: 'data/bank-meta.js' });
  vm.runInContext('const store = { get: (k, fb) => (__mem.has(k) ? JSON.parse(__mem.get(k)) : fb) };', Object.assign(ctx, { __mem: mem }));
  vm.runInContext(read('js/bank.js'), ctx, { filename: 'js/bank.js' });
  return ctx;
}
const BASE = sandbox();
const B = BASE.BANK;
const T = BASE.TOEIC, L = T.listening;
const ITEMS = BASE.BANK_META.items;
const LISTS = { '1': L.p1, '2': L.p2, '3': L.p3, '4': L.p4, '5': T.part5, '6': T.part6, '7': T.part7 };

/* 跟 tools/merge_data.py 同一套算法,用 JS 再算一次 */
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const flat = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(flat).join(' ')
  : v && typeof v === 'object' ? Object.entries(v).filter(([k]) => ['t', 'header', 'time'].indexOf(k) < 0).map(([, x]) => flat(x)).join(' ') : '');
function expected(part, x) {
  const base = { id: x.id, part };
  if (part === '1') return Object.assign(base, { difficulty: x.difficulty });
  if (part === '2') return Object.assign(base, { difficulty: x.difficulty, category: x.category, canYou: /^(can|could) you\b/i.test(x.question.trim()) });
  if (part === '3') return Object.assign(base, { difficulty: x.difficulty, size: x.questions.length });
  if (part === '4') return Object.assign(base, { difficulty: x.difficulty, type: x.type, size: x.questions.length });
  if (part === '5') return Object.assign(base, { difficulty: x.difficulty, category: x.category });
  if (part === '6') return Object.assign(base, { types: x.questions.map((q) => q.type), size: x.questions.length });
  return Object.assign(base, { format: x.format, size: x.questions.length, words: x.passages.reduce((a, p) => a + words(p.content || flat(p.blocks || [])), 0) });
}

/* 固定種子的亂數 */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rejects = (p) => p.then(() => 'resolved', (e) => (e && e.name) || 'error');

const T_ = {};

/* ================= 索引檔 ================= */
T_['B1 data/bank-meta.js:window.BANK_META = {v:1, items};Part 1 到 7 依序、各 Part 照題庫原順序,一題(組)一筆、不多不少'] = () => {
  const want = Object.keys(LISTS).reduce((a, p) => a.concat(LISTS[p].map((x) => p + ' ' + x.id)), []);
  const got = ITEMS.map((r) => r.part + ' ' + r.id);
  return { ok: BASE.BANK_META.v === 1 && J(got) === J(want) && new Set(ITEMS.map((r) => r.id)).size === ITEMS.length, detail: got.length + ' / ' + want.length };
};
T_['B2 每筆的欄位跟題庫算出來的一樣(難度、分類、P4 類型、P6 各小題題型、組大小、P7 格式與字數、P2 Can you 開頭),沒有別的欄位'] = () => {
  const bad = [];
  ITEMS.forEach((r, i) => {
    const x = LISTS[r.part] && LISTS[r.part].find((y) => y.id === r.id);
    if (!x) { bad.push(r.id + ' 不在題庫'); return; }
    if (J(r) !== J(expected(r.part, x))) bad.push(i + ' ' + J(r) + ' ≠ ' + J(expected(r.part, x)));
  });
  return { ok: !bad.length, detail: bad.slice(0, 3).join(' | ') || ITEMS.length + ' 筆' };
};
T_['B3 索引不放題文:題目、選項、詳解、翻譯、對話稿、文章的句子都不在檔裡;字串欄位只有 id、part、難度、分類、類型、格式'] = () => {
  const text = read('data/bank-meta.js');
  const leak = [];
  const walk = (v, k) => {
    if (typeof v === 'string') { if (v.length >= 12 && ['id', 'type', 'category', 'passageType', 'format', 'difficulty', 'label', 's', 't', 'who', 'time'].indexOf(k) < 0 && text.indexOf(J(v).slice(1, -1)) > -1) leak.push(k + ':' + v.slice(0, 30)); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, k)); return; }
    if (v && typeof v === 'object') Object.keys(v).forEach((kk) => walk(v[kk], kk));
  };
  Object.values(LISTS).forEach((list) => list.forEach((x) => walk(x, '')));
  const keys = new Set(ITEMS.flatMap((r) => Object.keys(r)));
  const allowed = ['id', 'part', 'difficulty', 'category', 'type', 'types', 'size', 'format', 'words', 'canYou'];
  const extra = [...keys].filter((k) => allowed.indexOf(k) < 0);
  const long = ITEMS.filter((r) => ['difficulty', 'category', 'type', 'format'].some((k) => typeof r[k] === 'string' && r[k].length > 12));
  return { ok: !leak.length && !extra.length && !long.length, detail: J({ leak: leak.slice(0, 3), extra, long: long.length }) };
};
T_['B4 Can you、Could you 開頭的 P2 剛好是 l2-12、l2-38、l2-49、l2-66、l2-92(都是 Yes/No 問句)'] = () => {
  const can = ITEMS.filter((r) => r.canYou);
  const ok = J(can.map((r) => r.id)) === J(['l2-12', 'l2-38', 'l2-49', 'l2-66', 'l2-92']) && can.every((r) => r.category === 'Yes/No問句')
    && ITEMS.filter((r) => r.part === '2').every((r) => typeof r.canYou === 'boolean');
  return { ok, detail: can.map((r) => r.id).join(',') };
};
T_['B5 P6 每組的空格號是 1 到小題數照順序(作答紀錄「組id:空格號」由索引推得出來)'] = () => {
  const bad = T.part6.filter((s) => J(s.questions.map((q) => q.num)) !== J(s.questions.map((q, i) => i + 1)));
  return { ok: !bad.length, detail: bad.map((s) => s.id).join(',') || T.part6.length + ' 組' };
};
T_['B6 tools/merge_data.py 產生的索引跟 repo 裡的一樣;原本的 13 個輸出檔一個位元組都沒變'] = () => {
  if (!PY) return { skip: true, detail: '找不到 Python 3(試過環境變數 PYTHON、python3、python、py),設 PYTHON=python 執行檔路徑可以跑' };
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-meta-'));
  try {
    const r = spawnSync(PY, [path.join(REPO, 'tools', 'merge_data.py')], { cwd: REPO, encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', MERGE_OUT_DIR: out }) });
    if (r.status !== 0) return { ok: false, detail: 'merge_data.py exit ' + r.status + ' ' + String(r.stderr || r.stdout).slice(-300) };
    const files = fs.readdirSync(out).sort();
    const want = ['articles.js', 'bank-meta.js', 'diagnostic.js', 'ear.js', 'grammar.js', 'listening.js', 'part5.js', 'part6.js', 'part7.js', 'phonics.js', 'phrases.js', 'tenses.js', 'verbs.js', 'writing.js'];
    const lf = (s) => s.replace(/\r\n/g, '\n');
    const diff = files.filter((f) => lf(fs.readFileSync(path.join(out, f), 'utf8')) !== lf(read('data/' + f)));
    return { ok: J(files) === J(want) && !diff.length, detail: J({ files: files.length, diff }) };
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
};

/* ================= meta ================= */
T_['B7 BANK.meta():全部索引、凍結;meta(\'7\') 只回 Part 7;meta(\'8\') 失敗;沒載入索引時失敗'] = async () => {
  const all = await B.meta();
  const p7 = await B.meta('7');
  const p7n = await B.meta(7);
  let mutated = true;
  try { all[0].id = 'x'; } catch (e) { /* 嚴格模式才丟 */ }
  mutated = all[0].id === 'x';
  const bad8 = await rejects(B.meta('8'));
  const noMeta = await rejects(sandbox({ meta: false }).BANK.meta());
  const ok = all.length === ITEMS.length && Object.isFrozen(all) && Object.isFrozen(all[0]) && !mutated
    && p7.length === T.part7.length && p7.every((r) => r.part === '7') && p7n.length === p7.length && bad8 === 'TypeError' && noMeta === 'Error'
    && Object.isFrozen(p7.find((r) => r.part === '7')) && (await B.meta('6'))[0].types && Object.isFrozen((await B.meta('6'))[0].types);
  return { ok, detail: J({ all: all.length, p7: p7.length, bad8, noMeta }) };
};

/* ================= get ================= */
T_['B8 BANK.get(ids):跟 ids 同順序同長度,內容跟題庫逐字相同(單題、整組都是);沒有的 id 是 null'] = async () => {
  const ids = [T.part6[1].id, 'l2-12', 'nope', 'p5-' + 'x', T.part5[3].id, L.p3[0].id, L.p4[2].id, T.part7[5].id, L.p1[0].id, 'p7-b1-1:2'];
  const got = await B.get(ids);
  const want = ids.map((id) => [].concat(...Object.values(LISTS)).find((x) => x.id === id) || null);
  return { ok: got.length === ids.length && J(got) === J(want) && got[2] === null && got[3] === null && got[9] === null && got.filter(Boolean).length === 7, detail: got.map((x) => (x ? x.id : null)).join(',') };
};
T_['B9 BANK.get 回的是複本:改了不影響題庫,下次拿到的還是原樣'] = async () => {
  const id = T.part6[0].id;
  const [a] = await B.get([id]);
  a.questions[0].answer = 99; a.passage = 'x';
  const [b] = await B.get([id]);
  return { ok: b.questions[0].answer === T.part6[0].questions[0].answer && b.passage === T.part6[0].passage && T.part6[0].passage !== 'x', detail: '' };
};
T_['B10 BANK.get 的錯誤:不是陣列、有空字串或非字串失敗;那個 Part 的題庫檔沒載入時失敗(不當成沒有這題)'] = async () => {
  const r = [await rejects(B.get('p5-b1-001')), await rejects(B.get([''])), await rejects(B.get([5])), await rejects(B.get(null))];
  const onlyReading = sandbox({ data: ['data/part5.js'] });
  const noListen = await rejects(onlyReading.BANK.get([L.p2[0].id]));
  const okP5 = await onlyReading.BANK.get([T.part5[0].id, 'zz']);
  return { ok: r.every((x) => x === 'TypeError') && noListen === 'Error' && okP5[0].id === T.part5[0].id && okP5[1] === null, detail: J({ r, noListen }) };
};

/* ================= pick ================= */
const ids = (rows) => rows.map((r) => r.id);
T_['B11 pick 的條件:難度、分類、P4 類型、P6 小題題型(有一題符合)、P7 格式與字數上限、P2 不要 Can you 開頭;n 是上限'] = async () => {
  const bad = [];
  const all = (part, where) => B.pick({ part, n: 999, where, order: 'listed' });
  const p5 = await all('5', { difficulty: ['基礎'], category: ['代名詞'] });
  if (J(p5) !== J(ids(ITEMS.filter((r) => r.part === '5' && r.difficulty === '基礎' && r.category === '代名詞'))) || !p5.length) bad.push('P5 ' + p5.length);
  const yn = await all('2', { category: ['Yes/No問句'], canYou: false });
  if (yn.length !== ITEMS.filter((r) => r.category === 'Yes/No問句').length - 5 || yn.some((id) => ['l2-12', 'l2-38', 'l2-49', 'l2-66', 'l2-92'].indexOf(id) > -1)) bad.push('P2 ' + yn.length);
  const p4 = await all('4', { type: [L.p4[0].type] });
  if (J(p4) !== J(L.p4.filter((s) => s.type === L.p4[0].type).map((s) => s.id))) bad.push('P4 ' + J(p4));
  const ins = await all('6', { type: ['句子插入'] });
  if (J(ins) !== J(T.part6.filter((s) => s.questions.some((q) => q.type === '句子插入')).map((s) => s.id))) bad.push('P6 ' + ins.length);
  const p7 = await all('7', { format: ['single'], maxWords: 225 });
  if (J(p7) !== J(ids(ITEMS.filter((r) => r.part === '7' && r.format === 'single' && r.words <= 225))) || !p7.length) bad.push('P7 ' + p7.length);
  const noDiff = await all('7', { difficulty: ['中級'] });
  if (noDiff.length) bad.push('P7 沒有難度卻被選到');
  const three = await B.pick({ part: '5', n: 3, where: { category: ['介系詞'] } });
  if (three.length !== 3) bad.push('n=3 拿到 ' + three.length);
  const zero = await B.pick({ part: '1', n: 0 });
  if (zero.length) bad.push('n=0');
  return { ok: !bad.length, detail: bad.join(' | ') };
};
T_['B12 pick 的 within、exclude:只從清單裡選、不選排除的'] = async () => {
  const pool = ITEMS.filter((r) => r.part === '5').slice(10, 30).map((r) => r.id);
  const got = await B.pick({ part: '5', n: 99, within: pool, exclude: pool.slice(0, 5), order: 'listed' });
  const none = await B.pick({ part: '5', n: 99, within: ['l2-01', 'nope'] });
  return { ok: J(got) === J(pool.slice(5)) && none.length === 0, detail: got.length + ' ' + none.length };
};
T_['B13 pick 預設順序跟練習頁一樣:沒做過 → 答錯過 → 答對過;題組看各小題(P6 空格號、P3/P7 第幾題),只做一半的組算沒做過'] = async () => {
  const s6 = T.part6.slice(0, 4).map((s) => s.id), s3 = L.p3.slice(0, 3).map((s) => s.id);
  const rec6 = {};
  [1, 2, 3, 4].forEach((n) => { rec6[s6[0] + ':' + n] = { ok: true }; rec6[s6[1] + ':' + n] = { ok: n !== 2 }; });
  rec6[s6[2] + ':1'] = { ok: false };   // 只做一題:算沒做過
  const p6 = await B.pick({ part: '6', n: 99, within: s6, records: rec6, random: rng(1) });
  const rec3 = {};
  [0, 1, 2].forEach((i) => { rec3[s3[0] + ':' + i] = { ok: false }; rec3[s3[1] + ':' + i] = { ok: true }; });
  const p3 = await B.pick({ part: '3', n: 99, within: s3, records: rec3, random: rng(2) });
  const p5ids = ITEMS.filter((r) => r.part === '5').slice(0, 30).map((r) => r.id);
  const rec5 = {};
  p5ids.slice(0, 10).forEach((id) => { rec5[id] = { ok: false }; });
  p5ids.slice(10, 20).forEach((id) => { rec5[id] = { ok: true }; });
  const p5 = await B.pick({ part: '5', n: 30, within: p5ids, records: rec5, random: rng(3) });
  const cls = (id) => (!rec5[id] ? 0 : rec5[id].ok ? 2 : 1);
  const sorted = p5.every((id, i) => i === 0 || cls(p5[i - 1]) <= cls(id));
  const ok = J(p6.slice(0, 2).sort()) === J([s6[2], s6[3]].sort()) && p6[2] === s6[1] && p6[3] === s6[0]
    && p3[0] === s3[2] && p3[1] === s3[0] && p3[2] === s3[1] && sorted && p5.length === 30;
  return { ok, detail: J({ p6, p3 }) };
};
T_['B14 pick 沒給 records 時讀這個帳號的作答紀錄(drill_p5);同一個種子結果一樣,換種子組內順序會變'] = async () => {
  const p5ids = ITEMS.filter((r) => r.part === '5').map((r) => r.id);
  const records = { drill_p5: Object.fromEntries(p5ids.slice(2).map((id) => [id, { ok: true }])) };
  const box = sandbox({ records });
  const got = await box.BANK.pick({ part: '5', n: 2, random: rng(4) });
  const a = await B.pick({ part: '5', n: 20, random: rng(9), records: {} });
  const b = await B.pick({ part: '5', n: 20, random: rng(9), records: {} });
  const c = await B.pick({ part: '5', n: 20, random: rng(10), records: {} });
  return { ok: J(got.slice().sort()) === J(p5ids.slice(0, 2).sort()) && J(a) === J(b) && J(a) !== J(c), detail: J(got) };
};
T_['B15 pick 的錯誤:沒給條件、Part 不對、n 不是 0 以上整數、where 欄位打錯或值的型別不對、order 不認得、records 不是物件'] = async () => {
  const cases = [undefined, { part: '8', n: 1 }, { part: '5' }, { part: '5', n: -1 }, { part: '5', n: 1.5 }, { part: '5', n: 1, where: { level: ['D1'] } },
    { part: '5', n: 1, where: { difficulty: '基礎' } }, { part: '7', n: 1, where: { maxWords: '225' } }, { part: '2', n: 1, where: { canYou: 'no' } },
    { part: '5', n: 1, order: 'easy' }, { part: '5', n: 1, within: 'p5' }, { part: '5', n: 1, records: 'x' }];
  const r = [];
  for (const c of cases) r.push(await rejects(B.pick(c)));
  return { ok: r.every((x) => x === 'TypeError'), detail: r.join(',') };
};
T_['B16 js/bank.js 不寫儲存、不碰畫面;沒有頁面載入它(這一版只給課程頁用),既有頁面不變'] = () => {
  const src = read('js/bank.js');
  const pages = fs.readdirSync(REPO).filter((f) => /\.html$/.test(f)).filter((f) => /bank(-meta)?\.js/.test(read(f)));
  const ok = !/store\.(set|remove)|localStorage|document\.|setItem/.test(src) && !pages.length;
  return { ok, detail: pages.join(',') };
};

(async () => {
  let pass = 0, skip = 0;
  const names = Object.keys(T_);
  for (const name of names) {
    let r;
    try { r = await T_[name](); } catch (e) { r = { ok: false, detail: '丟錯:' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e) }; }
    if (r.skip) skip++; else if (r.ok) pass++;
    console.log((r.skip ? 'SKIP ' : r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + String(r.detail).slice(0, 600));
  }
  console.log(pass + ' / ' + (names.length - skip) + ' 通過' + (skip ? '(略過 ' + skip + ' 項)' : ''));
  process.exit(pass + skip === names.length ? 0 : 1);
})();
