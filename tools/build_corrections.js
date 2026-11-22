/* 產生 data/corrections.json:公開的「題目更正紀錄」頁(corrections.html)讀的資料。
   來源:
   - tools/corrections/source.json  答案更正與題目文字修正,每列 { d, id, a, k, p, r }
   - data/retired.json              淘汰換新(直接當來源,不重抄一份)
   只放題號、區域、問題一句、處理一句、影響一句,不放題目原文、選項、詳解。
   新增更正:改 source.json 或 data/retired.json,再跑這支。
   用法:
     node tools/build_corrections.js          重新產生 data/corrections.json
     node tools/build_corrections.js --check  只檢查,跟現有檔不一樣或來源不合格就 exit 1(check_release.js 會跑) */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const OUT = 'data/corrections.json';
const AREAS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', '文法', '文章', '片語', '英語耳'];
const KINDS = ['answer', 'text', 'retired'];
const MAX_LEN = 60;
/* 影響欄:能力統計、模擬考目前都沒有自動排除或重算的程式,照實寫 */
const IMPACT = {
  answer: '以前的作答紀錄與模擬考分數不重算，能力統計尚未自動排除。',
  retired: '這題已不再出現。以前的作答紀錄與模擬考分數不重算，能力統計尚未自動排除。',
  text: '以前的作答紀錄不重算。',
};
/* 題目文字修正(source.json 的 text 組)公開頁只列學生看得懂、影響作答的那幾類:
   猜題線索(最長選項、不看文章也猜得中)、換成範例網域與刊物名、改美式拼法、調整選項長度,屬輕微項,不上公開頁。
   source.json 的原因與處理句是內部用語,公開頁用下面的類別與處理句。 */
const REAL_ERROR = /有兩個答案|說得通|也成立|兩種讀法|重疊|同一件事|矛盾|對不上|互相衝突|不自然|文法錯誤|算不出|沒有依據|推不出|含糊|不夠明確|沒有交代|沒提到|沒有寫到|有文章支持|沒說計算範圍/;
function textCategory(p) {
  if (!REAL_ERROR.test(p)) return null;
  if (/兩個答案|說得通|也成立|兩種讀法|重疊|同一件事/.test(p)) return '不只一個答案';
  if (/矛盾|對不上|互相衝突/.test(p)) return '題目內容有誤';
  if (/不自然|文法錯誤/.test(p)) return '英文用字有誤';
  return '題意不清楚';
}
function textAction(r) {
  const what = /題幹|題目/.test(r) && !/選項/.test(r) ? '修正題幹' : /文章|標題|日期|空格後/.test(r) && !/選項/.test(r) ? '修正文章' : '修正選項';
  return what + (/詳解/.test(r) ? '與詳解' : '');
}
const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8').replace(/^﻿/, ''));

/* 題庫裡所有 id(替代題存在檢查用) */
function bankIds(root) {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  fs.readdirSync(path.join(root, 'data')).filter((f) => /\.js$/.test(f)).forEach((f) => {
    try { vm.runInContext(fs.readFileSync(path.join(root, 'data', f), 'utf8'), ctx, { filename: f }); } catch (e) { /* 單一檔讀不進來不影響其他 */ }
  });
  const ids = new Set();
  const seen = new Set();
  (function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > 6 || seen.has(o)) return;
    seen.add(o);
    if (typeof o.id === 'string') ids.add(o.id);
    (Array.isArray(o) ? o : Object.keys(o).map((k) => o[k])).forEach((v) => walk(v, depth + 1));
  })(ctx, 0);
  return ids;
}

function lintText(s) {
  const bad = [];
  if (/[,;:?!]/.test(s) && /[一-鿿]/.test(s)) bad.push('半形標點');
  if (/[—–―]/.test(s)) bad.push('破折號');
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)) bad.push('emoji');
  if (s.length > MAX_LEN) bad.push('超過 ' + MAX_LEN + ' 字');
  return bad;
}

function build(root) {
  const errors = [];
  const src = readJson(root, 'tools/corrections/source.json').rows;
  const ret = readJson(root, 'data/retired.json').retired;
  const rows = [];
  let minor = 0;
  src.forEach((r, i) => {
    const tag = '來源第 ' + (i + 1) + ' 列(' + r.id + ')';
    if (Object.keys(r).sort().join() !== 'a,d,id,k,p,r') errors.push(tag + ' 欄位不對');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.d)) errors.push(tag + ' 日期格式不對');
    if (AREAS.indexOf(r.a) < 0) errors.push(tag + ' 區域不對:' + r.a);
    if (r.k !== 'answer' && r.k !== 'text') errors.push(tag + ' 種類不對:' + r.k);
    if (r.k === 'answer' && !/^答案改為 [A-D]$/.test(r.r)) errors.push(tag + ' 答案更正的處理句格式不對');
    if (r.k === 'text') {
      const cat = textCategory(r.p);
      if (cat) rows.push({ d: r.d, id: r.id, a: r.a, k: 'text', p: cat, r: textAction(r.r), i: IMPACT.text });
      else minor++;
    } else rows.push({ d: r.d, id: r.id, a: r.a, k: r.k, p: r.p, r: r.r, i: IMPACT.answer });
  });
  const ids = bankIds(root);
  ret.forEach((x) => {
    const tag = '淘汰 ' + x.id;
    const a = 'P' + x.part;
    if (AREAS.indexOf(a) < 0) errors.push(tag + ' part 不對');
    if (x.replacedBy && !ids.has(x.replacedBy)) errors.push(tag + ' 的替代題 ' + x.replacedBy + ' 不在題庫');
    const row = { d: x.date, id: x.id, a, k: 'retired', p: x.reason, r: x.replacedBy ? '淘汰，換新題 ' + x.replacedBy : '淘汰，替代題之後補', i: IMPACT.retired };
    if (x.replacedBy) row.n = x.replacedBy;
    rows.push(row);
  });
  const seen = new Set();
  rows.forEach((r) => {
    const key = r.id + '|' + r.k + '|' + r.d + '|' + r.p + '|' + r.r;
    if (seen.has(key)) errors.push('重複:' + key);
    seen.add(key);
    ['p', 'r', 'i'].forEach((f) => lintText(r[f]).forEach((b) => errors.push(r.id + ' 的 ' + f + ':' + b)));
  });
  const updated = rows.reduce((m, r) => (r.d > m ? r.d : m), '0000-00-00');
  return { errors, minor, data: { updated, rows } };
}

const render = (data) => '{\n "updated": ' + JSON.stringify(data.updated) + ',\n "rows": [\n' +
  data.rows.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n ]\n}\n';

if (require.main === module) {
  const check = process.argv.includes('--check');
  const res = build(REPO);
  if (res.errors.length) { res.errors.slice(0, 30).forEach((e) => console.log('錯誤:' + e)); process.exit(1); }
  const next = render(res.data);
  const file = path.join(REPO, OUT);
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
  if (check) {
    if (cur !== next) { console.log(OUT + ' 跟來源對不上。執行 node tools/build_corrections.js'); process.exit(1); }
    console.log(OUT + ' 是最新的(' + res.data.rows.length + ' 列)');
  } else if (cur === next) console.log(OUT + ' 不用改(' + res.data.rows.length + ' 列)');
  else { fs.writeFileSync(file, next); console.log(OUT + ' 已更新:' + res.data.rows.length + ' 列'); }
}

module.exports = { IMPACT, textCategory, build, render, bankIds, lintText, AREAS };
