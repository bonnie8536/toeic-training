/* 產生 data/item-params.js(題目難度參數、換算曲線、參考卷),並檢查它跟題庫對得上。
   用法:
     node tools/build-item-params.js --ratings <難度評分結果.json> [--out <輸出檔>]   產生並檢查
     node tools/build-item-params.js [--file <參數檔>]                                只檢查現有的參數檔(預設 data/item-params.js)
   難度怎麼來(單位 logit):
     P1–P5 題庫題、舊 28 題:三級標籤(基礎 −1、中級 0、進階 +1)+ 該 Part 的加減值
     P6、P7 題庫題:Part 加減值 + (評分級數 − P5 級數平均) × (P5 標籤標準差 ÷ P5 級數標準差);沒有評分的題用 Part 加減值,輸出時列出
   參考卷 ref:該 Part 題庫全部小題難度的 20 個分位數(位置 (k + 0.5) / 20,相鄰兩題直線內插);跟曲線版本 cv 綁在一起,
     輸出檔已經有同一個 cv 的 ref 就沿用,題庫增減、難度改了都不動;換 cv 才重算。
   題目 key 一律用 js/estimate-core.js 的 keyOf 產生。同樣的輸入,輸出逐位元組相同。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'data/item-params.js');
const IP = 'ip1';
const CV = 'c1';
const PART = Object.freeze({ 1: -0.3, 2: 0, 3: 0.3, 4: 0.3, 5: 0, 6: 0.2, '7s': 0.5, '7m': 0.8 });
const PART_KEYS = Object.freeze(['1', '2', '3', '4', '5', '6', '7s', '7m']);
const LABEL = Object.freeze({ 基礎: -1, 中級: 0, 進階: 1 });
/* 聽力:站上模擬考的換算表;閱讀:站上表與公開來源換算的中間值。兩條都是分段直線內插 */
const CURVE = Object.freeze({
  L: [[0, 5], [0.15, 55], [0.25, 85], [0.3, 110], [0.35, 140], [0.4, 170], [0.45, 200], [0.5, 230], [0.55, 260],
    [0.6, 290], [0.65, 320], [0.7, 350], [0.75, 380], [0.8, 410], [0.86, 440], [0.92, 470], [0.97, 495]],
  R: [[0, 5], [0.15, 30], [0.2, 38], [0.25, 69], [0.3, 105], [0.35, 134], [0.4, 163], [0.45, 191], [0.5, 220], [0.55, 247],
    [0.6, 273], [0.65, 300], [0.7, 331], [0.75, 362], [0.8, 393], [0.86, 426], [0.9, 448], [0.92, 460], [0.97, 490], [1, 495]],
});
const REF_N = 20;
const B_MAX = 3;
const SCALE_TOL = 0.0015;
const DATA_FILES = ['data/listening.js', 'data/part5.js', 'data/part6.js', 'data/part7.js', 'data/diagnostic.js', 'data/bank-meta.js'];

const round3 = (x) => { const v = Math.round(x * 1000) / 1000; return v === 0 ? 0 : v; };
const fin = (x) => typeof x === 'number' && isFinite(x);
function fail(msg) { throw new Error(msg); }

/* ---------- 讀檔 ---------- */
function loadContext() {
  const ctx = { console: { log() {}, warn() {}, error() {}, info() {} } };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['js/estimate-core.js'].concat(DATA_FILES).forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}
function retiredIds() {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/retired.json'), 'utf8'));
  return (j.retired || []).map((r) => r.id);
}
function loadParamsFile(file) {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  return JSON.parse(JSON.stringify(ctx.ITEM_PARAMS || null));
}

/* ---------- 題庫小題 ---------- */
function dataSets(T) {
  const L = T.listening;
  return { 1: L.p1, 2: L.p2, 3: L.p3, 4: L.p4, 5: T.part5, 6: T.part6, 7: T.part7 };
}
/* 題庫索引的每一筆對上題目檔:id 一樣、題組小題數一樣;回傳 [{ part, pk(Part 加減值的鍵), id, label, keys: [{ key, qi }] }] */
function bankUnits(ctx) {
  const E = ctx.ESTIMATE, sets = dataSets(ctx.TOEIC), byId = {};
  Object.keys(sets).forEach((p) => sets[p].forEach((x) => { byId[x.id] = { part: p, x }; }));
  const seen = new Set();
  const units = ctx.BANK_META.items.map((m) => {
    const d = byId[m.id];
    if (!d || d.part !== String(m.part)) fail('題庫索引有題目檔沒有的題:' + m.id);
    if (seen.has(m.id)) fail('題庫索引重複:' + m.id);
    seen.add(m.id);
    const p = d.part, qs = E.isGroupPart(p) ? d.x.questions : [d.x];
    if (E.isGroupPart(p) && qs.length !== m.size) fail('題組小題數對不上:' + m.id);
    if (p === '7' && m.format !== d.x.format) fail('P7 篇數格式對不上:' + m.id);
    const pk = p === '7' ? (m.format === 'single' ? '7s' : '7m') : p;
    return { part: p, pk, id: m.id, label: m.difficulty, keys: qs.map((q, qi) => ({ key: E.keyOf(p, m.id, q, qi), qi })) };
  });
  const extra = Object.keys(byId).filter((id) => !seen.has(id));
  if (extra.length) fail('題目檔有題庫索引沒有的題:' + extra.join(', '));
  return units;
}
/* 舊 28 題:P5 單題 20 題,P6、P7 各一組 4 小題;標籤在每一小題 */
function legacyUnits(ctx) {
  const E = ctx.ESTIMATE, D = ctx.TOEIC.diagnostic;
  const one = (p, pk, id, q, qi) => ({ part: p, pk, id, label: q.difficulty, keys: [{ key: E.keyOf(p, id, q, qi), qi }] });
  const p7pk = (D.p7.passages || []).length > 1 ? '7m' : '7s';
  return D.p5.map((q) => one('5', '5', q.id, q, 0))
    .concat(D.p6.questions.map((q, qi) => one('6', '6', D.p6.id, q, qi)))
    .concat(D.p7.questions.map((q, qi) => one('7', p7pk, D.p7.id, q, qi)));
}

/* ---------- 評分結果與尺度 ---------- */
function loadRatings(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const s = j && j.meta && j.meta.scale;
  if (!s || s.method !== 'mean-sigma') fail('評分結果要有 mean-sigma 的尺度');
  ['m_AI', 'sd_AI', 'sd_label'].forEach((k) => { if (!fin(s[k]) || (k !== 'm_AI' && s[k] <= 0)) fail('尺度缺 ' + k); });
  if (!j.items || typeof j.items !== 'object') fail('評分結果缺 items');
  return { scale: { m: s.m_AI, sdAI: s.sd_AI, sdLabel: s.sd_label }, items: j.items };
}
const ratingOf = (R, id, qi) => {
  const r = R.items[id + '|' + qi];
  return r && fin(r.level) && r.level >= 1 && r.level <= 8 ? r.level : null;
};
const sdPop = (xs) => { const m = xs.reduce((a, x) => a + x, 0) / xs.length; return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / xs.length); };
/* 用題庫 P5 重算一次平均與標準差,跟評分結果寫的尺度差超過 0.0015 就停 */
function checkScale(R, units) {
  const p5 = units.filter((u) => u.part === '5');
  const lv = p5.map((u) => ratingOf(R, u.id, 0));
  if (lv.some((x) => x === null)) fail('題庫 P5 有題沒有評分,不能定尺度');
  const lab = p5.map((u) => LABEL[u.label]);
  const got = { m: lv.reduce((a, x) => a + x, 0) / lv.length, sdAI: sdPop(lv), sdLabel: sdPop(lab) };
  Object.keys(got).forEach((k) => {
    if (Math.abs(got[k] - R.scale[k]) > SCALE_TOL) fail('尺度 ' + k + ' 重算是 ' + got[k].toFixed(4) + ',評分結果寫 ' + R.scale[k]);
  });
  return got;
}

/* ---------- 難度 ---------- */
function labelB(u) {
  if (!(u.label in LABEL)) fail('認不得的難度標籤:' + u.id + ' ' + u.label);
  return round3(LABEL[u.label] + PART[u.pk]);
}
/* 回傳 { b: { key: 難度 }(題庫照題庫索引的順序,舊 28 題在後), unrated: [沒有評分、用 Part 加減值的 key] } */
function buildB(bank, legacy, R) {
  const b = {}, unrated = [];
  const slope = R.scale.sdLabel / R.scale.sdAI;
  bank.forEach((u) => u.keys.forEach(({ key, qi }) => {
    if (u.part !== '6' && u.part !== '7') { b[key] = labelB(u); return; }
    const lv = ratingOf(R, u.id, qi);
    if (lv === null) unrated.push(key);
    b[key] = round3(PART[u.pk] + (lv === null ? 0 : (lv - R.scale.m) * slope));
  }));
  legacy.forEach((u) => { b[u.keys[0].key] = labelB(u); });
  return { b, unrated };
}
/* 分位數:位置 (k + 0.5) / 20 × n − 0.5(0 起算),相鄰兩題直線內插 */
function quantiles(xs, n) {
  const s = xs.slice().sort((a, b) => a - b), N = s.length;
  if (!N) fail('算分位數沒有資料');
  return Array.from({ length: n }, (_, k) => {
    const h = Math.min(Math.max((k + 0.5) / n * N - 0.5, 0), N - 1), lo = Math.floor(h), hi = Math.min(lo + 1, N - 1);
    return round3(s[lo] + (s[hi] - s[lo]) * (h - lo));
  });
}
function buildRef(bank, b) {
  const by = {};
  PART_KEYS.forEach((pk) => { by[pk] = []; });
  bank.forEach((u) => u.keys.forEach(({ key }) => by[u.pk].push(b[key])));
  const ref = {};
  PART_KEYS.forEach((pk) => { ref[pk] = quantiles(by[pk], REF_N); });
  return ref;
}
function reusableRef(file) {
  if (!fs.existsSync(file)) return null;
  const old = loadParamsFile(file);
  return old && old.cv === CV && old.ref ? old.ref : null;
}
function build(ratingsFile, outFile) {
  const ctx = loadContext();
  const bank = bankUnits(ctx), legacy = legacyUnits(ctx), R = loadRatings(ratingsFile);
  const scale = checkScale(R, bank);
  const { b, unrated } = buildB(bank, legacy, R);
  const kept = reusableRef(outFile);
  const ref = kept || buildRef(bank, b);
  const params = { ip: IP, cv: CV, curve: { L: CURVE.L, R: CURVE.R }, ref, part: Object.assign({}, PART), b };
  return { params, unrated, scale, refKept: !!kept, ctx, bank, legacy };
}

/* ---------- 輸出(逐位元組固定) ---------- */
const num = (x) => String(x);
const pts = (a) => '[' + a.map((p) => '[' + num(p[0]) + ', ' + num(p[1]) + ']').join(', ') + ']';
function serialize(P) {
  const ks = Object.keys(P.b), lines = [];
  for (let i = 0; i < ks.length; i += 8) lines.push('    ' + ks.slice(i, i + 8).map((k) => JSON.stringify(k) + ': ' + num(P.b[k])).join(', '));
  return [
    '/* 題目難度參數。由 tools/build-item-params.js 產生,不要手改。',
    '   ip:難度版本;cv:換算曲線與參考卷版本;curve:參考卷預期答對率對應的分數點(分段直線內插);',
    '   ref:每個 Part 的參考卷難度(20 個);part:各 Part 的難度加減值;b:每一小題的難度(題目 key 對 logit)。 */',
    'window.ITEM_PARAMS = {',
    '  "ip": ' + JSON.stringify(P.ip) + ',',
    '  "cv": ' + JSON.stringify(P.cv) + ',',
    '  "curve": {',
    '    "L": ' + pts(P.curve.L) + ',',
    '    "R": ' + pts(P.curve.R),
    '  },',
    '  "ref": {',
    PART_KEYS.map((pk) => '    ' + JSON.stringify(pk) + ': [' + P.ref[pk].map(num).join(', ') + ']').join(',\n'),
    '  },',
    '  "part": { ' + PART_KEYS.map((pk) => JSON.stringify(pk) + ': ' + num(P.part[pk])).join(', ') + ' },',
    '  "b": {',
    lines.join(',\n'),
    '  }',
    '};',
    '',
  ].join('\n');
}

/* ---------- 檢查 ---------- */
function checkCurveShape(E, sec, c, bad) {
  try { E.checkCurve(c); } catch (e) { bad.push('曲線 ' + sec + ':' + e.message); return; }
  for (let i = 1; i < c.length; i++) if (!(c[i][1] > c[i - 1][1])) bad.push('曲線 ' + sec + ' 分數沒有一直變大');
  if (c[0][0] !== 0 || c[0][1] !== 5) bad.push('曲線 ' + sec + ' 要從 [0, 5] 開始');
  if (c[c.length - 1][1] !== 495 || E.scoreOf(c, 1) !== 495) bad.push('曲線 ' + sec + ' 要在 495 結束');
}
function checkKeys(E, P, bank, legacy, retired, bad) {
  const want = new Set();
  bank.concat(legacy).forEach((u) => u.keys.forEach(({ key }) => want.add(key)));
  const have = Object.keys(P.b);
  const missing = [...want].filter((k) => !(k in P.b)), extra = have.filter((k) => !want.has(k));
  if (missing.length) bad.push('題庫小題沒有難度 ' + missing.length + ' 題:' + missing.slice(0, 10).join(', '));
  if (extra.length) bad.push('多出不在題庫的 key ' + extra.length + ' 個:' + extra.slice(0, 10).join(', '));
  const outR = have.filter((k) => !fin(P.b[k]) || Math.abs(P.b[k]) > B_MAX);
  if (outR.length) bad.push('難度不在 −3 到 +3:' + outR.slice(0, 10).join(', '));
  const lk = legacy.map((u) => u.keys[0].key).filter((k) => k in P.b);
  if (lk.length !== 28) bad.push('舊 28 題只有 ' + lk.length + ' 題有難度');
  const wrongPart = have.filter((k) => want.has(k) && !E.partOfKey(k));
  if (wrongPart.length) bad.push('認不得 Part 的 key:' + wrongPart.join(', '));
  const dead = have.filter((k) => retired.some((id) => k === id || k.indexOf(id + ':') === 0));
  if (dead.length) bad.push('淘汰的題還在:' + dead.join(', '));
}
function checkRef(P, bad) {
  const ks = Object.keys(P.ref || {}).sort(), want = PART_KEYS.slice().sort();
  if (JSON.stringify(ks) !== JSON.stringify(want)) bad.push('參考卷的 Part 要是 ' + PART_KEYS.join('、'));
  PART_KEYS.forEach((pk) => {
    const r = (P.ref || {})[pk];
    if (!Array.isArray(r) || r.length !== REF_N || !r.every(fin)) bad.push('參考卷 Part ' + pk + ' 要是 20 個數');
    else if (r.some((x, i) => i && x < r[i - 1]) || r.some((x) => Math.abs(x) > B_MAX)) bad.push('參考卷 Part ' + pk + ' 要由小到大、在 −3 到 +3');
  });
}
/* 回傳檢查不過的項目(空陣列就是全過) */
function check(P, ctx, bank, legacy) {
  const E = ctx.ESTIMATE, bad = [];
  if (!P || typeof P !== 'object') return ['沒有 ITEM_PARAMS'];
  if (typeof P.ip !== 'string' || !P.ip || typeof P.cv !== 'string' || !P.cv) bad.push('ip、cv 要是字串');
  try { E.checkParams(P); } catch (e) { bad.push(e.message); }
  if (!P.curve || !P.b) return bad;
  ['L', 'R'].forEach((sec) => checkCurveShape(E, sec, P.curve[sec], bad));
  checkRef(P, bad);
  if (JSON.stringify(P.part) !== JSON.stringify(Object.assign({}, PART))) bad.push('Part 加減值跟工具裡的不一樣');
  checkKeys(E, P, bank, legacy, retiredIds(), bad);
  return bad;
}

/* ---------- 摘要 ---------- */
function partSummary(bank, legacy, b) {
  const by = {};
  bank.concat(legacy.map((u) => Object.assign({}, u, { pk: 'old' }))).forEach((u) => u.keys.forEach(({ key }) => {
    (by[u.pk] = by[u.pk] || []).push(b[key]);
  }));
  return PART_KEYS.concat(['old']).filter((pk) => by[pk]).map((pk) => {
    const s = by[pk].slice().sort((x, y) => x - y), n = s.length, mean = s.reduce((a, x) => a + x, 0) / n;
    const q = (p) => s[Math.min(n - 1, Math.floor(p * (n - 1)))];
    return { part: pk, n, min: s[0], q1: q(0.25), median: q(0.5), q3: q(0.75), max: s[n - 1], mean: round3(mean), distinct: new Set(s).size };
  });
}
function printSummary(rows, out) {
  out('Part    小題  最小    Q1     中位    Q3     最大   平均   不同值');
  rows.forEach((r) => out([r.part.padEnd(6), String(r.n).padStart(5), ...[r.min, r.q1, r.median, r.q3, r.max, r.mean].map((x) => x.toFixed(3).padStart(6)), String(r.distinct).padStart(6)].join(' ')));
}

/* ---------- 指令 ---------- */
function argOf(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail(name + ' 後面要接路徑');
  return path.resolve(argv[i + 1]);
}
function runBuild(ratings, outFile, out) {
  const r = build(ratings, outFile);
  const bad = check(r.params, r.ctx, r.bank, r.legacy);
  out('尺度(用題庫 P5 重算):級數平均 ' + r.scale.m.toFixed(4) + ',級數標準差 ' + r.scale.sdAI.toFixed(4) + ',標籤標準差 ' + r.scale.sdLabel.toFixed(4));
  out('參考卷:' + (r.refKept ? '沿用輸出檔裡同一個 cv 的 ref' : '用這次的難度重算'));
  out('沒有評分、用 Part 加減值的 P6、P7 小題:' + (r.unrated.length ? r.unrated.length + ' 題 ' + r.unrated.join(', ') : '0 題'));
  printSummary(partSummary(r.bank, r.legacy, r.params.b), out);
  if (bad.length) { bad.forEach((m) => out('不過:' + m)); return 1; }
  fs.writeFileSync(outFile, serialize(r.params), 'utf8');
  out('檢查全過,已寫入 ' + path.relative(ROOT, outFile).replace(/\\/g, '/') + '(' + Object.keys(r.params.b).length + ' 小題)');
  return 0;
}
function runCheck(file, out) {
  if (!fs.existsSync(file)) { out('找不到 ' + file); return 1; }
  const ctx = loadContext(), bank = bankUnits(ctx), legacy = legacyUnits(ctx), P = loadParamsFile(file);
  const bad = check(P, ctx, bank, legacy);
  if (bad.length) { bad.forEach((m) => out('不過:' + m)); return 1; }
  printSummary(partSummary(bank, legacy, P.b), out);
  out('檢查全過:' + Object.keys(P.b).length + ' 小題,ip ' + P.ip + ',cv ' + P.cv);
  return 0;
}
function main(argv, out) {
  const ratings = argOf(argv, '--ratings');
  if (ratings) return runBuild(ratings, argOf(argv, '--out') || DEFAULT_OUT, out);
  return runCheck(argOf(argv, '--file') || DEFAULT_OUT, out);
}

module.exports = { IP, CV, PART, PART_KEYS, LABEL, CURVE, REF_N, loadContext, loadParamsFile, bankUnits, legacyUnits, quantiles, check, serialize, partSummary };

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2), (s) => process.stdout.write(s + '\n')); }
  catch (e) { process.stderr.write('錯誤:' + e.message + '\n'); process.exitCode = 1; }
}
