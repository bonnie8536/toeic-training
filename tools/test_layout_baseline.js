/* 版面基準局部存檔的測試（tools/baseline_merge.js，給 check_layout.js 的 --pages 搭 --save 用）。
   用法：node tools/test_layout_baseline.js
   不開 Chrome、不寫任何檔案，真的 tools/layout_baseline.json 只讀。
   重點是只量幾頁再存基準時，其他頁在檔案裡的原文一個位元組都不能變（2026-10-07 整檔被蓋掉過）。 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { mergeBaseline } = require('./baseline_merge');

const RAW = fs.readFileSync(path.join(__dirname, 'layout_baseline.json'), 'utf8');
const BASE = JSON.parse(RAW);
const PRICING = ['375 pricing.html', '1280 pricing.html'];

/* 每個 key 在原文裡的一段：從 key 的引號到下一個 key 之前（最後一個到收尾的 }）。
   key 的順序用 JSON.parse 拿、位置用 indexOf 找，刻意不用 baseline_merge.js 的掃描器，才算獨立驗證。
   前提是 key 字串不會出現在值裡，這裡的資料都成立。 */
function segments(text) {
  const keys = Object.keys(JSON.parse(text));
  let from = 0;
  const starts = keys.map((k) => (from = text.indexOf(JSON.stringify(k), from)));
  const out = {};
  keys.forEach((k, i) => { out[k] = text.slice(starts[i], i + 1 < keys.length ? starts[i + 1] : text.lastIndexOf('}')); });
  return out;
}
const bump = (v) => Object.assign({}, v, { bodyH: v.bodyH + 7, main: v.main.map((n, i) => (i === 3 ? n + 7 : n)) });
const page = (n) => ({ cls: '', main: [0, n, 375, 100 + n], bodyH: 200 + n });

const T = {};

T['真的基準檔：只換 pricing 兩項，其他各項原文逐位元組相同，順序不變'] = () => {
  const upd = {};
  PRICING.forEach((k) => { upd[k] = bump(BASE[k]); });
  const r = mergeBaseline(RAW, upd);
  const a = segments(RAW), b = segments(r.text);
  assert.deepStrictEqual(Object.keys(b), Object.keys(a));
  const others = Object.keys(a).filter((k) => !PRICING.includes(k));
  assert.strictEqual(others.length, Object.keys(BASE).length - PRICING.length);
  assert.ok(others.length >= 42);
  others.forEach((k) => assert.strictEqual(b[k], a[k], k + ' 的原文變了'));
  PRICING.forEach((k) => assert.deepStrictEqual(JSON.parse(r.text)[k], upd[k]));
  assert.deepStrictEqual(r.changed, PRICING);
  assert.deepStrictEqual(r.added, []);
  assert.strictEqual(r.text.includes('\r\n'), RAW.includes('\r\n'));
  /* 第一個 key 之前、最後一個 } 之後的原文也要一樣 */
  assert.strictEqual(r.text.slice(0, r.text.indexOf('"')), RAW.slice(0, RAW.indexOf('"')));
  assert.strictEqual(r.text.slice(r.text.lastIndexOf('}')), RAW.slice(RAW.lastIndexOf('}')));
};

T['沒有傳任何量測：原文不變'] = () => {
  const r = mergeBaseline(RAW, {});
  assert.strictEqual(r.text, RAW);
  assert.deepStrictEqual([r.changed, r.added], [[], []]);
};

T['整檔擠成一行：換值與新增都不加換行'] = () => {
  const raw = '{"375 a.html":{"main":[1]},"375 b.html":{"main":[2]}}';
  const out = mergeBaseline(raw, { '375 b.html': { main: [20] }, '375 c.html': { main: [3] } }).text;
  assert.strictEqual(out, '{"375 a.html":{"main":[1]},"375 b.html":{"main":[20]},"375 c.html":{"main":[3]}}');
};

T['真的基準檔：量到的值跟基準一樣時，整個檔案逐位元組不變'] = () => {
  const upd = {};
  PRICING.forEach((k) => { upd[k] = BASE[k]; });
  const r = mergeBaseline(RAW, upd);
  assert.strictEqual(r.text, RAW);
  assert.deepStrictEqual(r.changed, []);
};

T['CRLF 加 tab 縮排：換掉的值照原檔格式寫，沒有混進單獨的 LF'] = () => {
  const obj = { '375 a.html': page(1), '375 b.html': page(2), '1280 a.html': page(3) };
  const raw = JSON.stringify(obj, null, '\t').replace(/\n/g, '\r\n') + '\r\n';
  const upd = { '375 b.html': page(20) };
  const out = mergeBaseline(raw, upd).text;
  assert.strictEqual(out, JSON.stringify(Object.assign({}, obj, upd), null, '\t').replace(/\n/g, '\r\n') + '\r\n');
  assert.ok(!/[^\r]\n/.test(out));
};

T['陣列排成一行的格式（例如被 Prettier 排過）：沒量到的 key 原文不變'] = () => {
  const raw = '{\n  "375 a.html": { "cls": "", "main": [0, 340, 375, 1592] },\n'
    + '  "375 b.html": { "cls": "x", "main": [1, 2, 3, 4] },\n'
    + '  "375 c.html": { "cls": "", "main": [5, 6, 7, 8] }\n}\n';
  const upd = { '375 b.html': { cls: 'x', main: [1, 2, 3, 40] } };
  const out = mergeBaseline(raw, upd).text;
  const a = segments(raw), b = segments(out);
  ['375 a.html', '375 c.html'].forEach((k) => assert.strictEqual(b[k], a[k], k));
  assert.deepStrictEqual(JSON.parse(out), Object.assign(JSON.parse(raw), upd));
};

T['基準裡沒有的頁：接在最後面，沿用原檔的分隔與縮排'] = () => {
  const obj = { '375 a.html': page(1), '375 b.html': page(2) };
  const raw = JSON.stringify(obj, null, 1) + '\n';
  const upd = { '375 new.html': page(9), '375 a.html': page(10) };
  const r = mergeBaseline(raw, upd);
  assert.strictEqual(r.text, JSON.stringify(Object.assign({}, obj, upd), null, 1) + '\n');
  assert.deepStrictEqual(r.changed, ['375 a.html']);
  assert.deepStrictEqual(r.added, ['375 new.html']);
};

T['基準只有一項時也能接新的頁'] = () => {
  const obj = { '375 a.html': page(1) };
  const raw = JSON.stringify(obj, null, 1) + '\n';
  const upd = { '1280 a.html': page(2) };
  assert.strictEqual(mergeBaseline(raw, upd).text, JSON.stringify(Object.assign({}, obj, upd), null, 1) + '\n');
};

T['空的基準 {}：照 --save 的格式寫'] = () => {
  const upd = { '375 a.html': page(1) };
  assert.strictEqual(mergeBaseline('{}\n', upd).text, JSON.stringify(upd, null, 1) + '\n');
};

T['值的字串裡有逗號、括號、跳脫引號：不會切錯位置'] = () => {
  const obj = { '375 a.html': { cls: 'x,"}]{[\\', main: [1] }, '375 b.html': { cls: '', main: [2] }, '375 c.html': { cls: '}', main: [3] } };
  const raw = JSON.stringify(obj, null, 1) + '\n';
  const upd = { '375 b.html': { cls: '', main: [20] } };
  const out = mergeBaseline(raw, upd).text;
  const a = segments(raw), b = segments(out);
  ['375 a.html', '375 c.html'].forEach((k) => assert.strictEqual(b[k], a[k], k));
  assert.deepStrictEqual(JSON.parse(out), Object.assign({}, obj, upd));
};

T['壞掉的基準檔或最外層不是物件：丟錯，不回傳半成品'] = () => {
  assert.throws(() => mergeBaseline('{"375 a.html": {', { '375 a.html': page(1) }));
  assert.throws(() => mergeBaseline('[1, 2]\n', { '375 a.html': page(1) }));
};

/* ---------- 執行 ---------- */
let pass = 0;
const names = Object.keys(T);
for (const name of names) {
  let err = null;
  try { T[name](); pass++; } catch (e) { err = e; }
  console.log((err ? 'FAIL ' : 'PASS ') + name + (err ? '  →  ' + String(err.message).split('\n')[0] : ''));
}
console.log(pass + ' / ' + names.length + ' 通過');
process.exit(pass === names.length ? 0 : 1);
