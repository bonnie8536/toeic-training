/* 引導流程的聽力短測 8 題:照固定規則從小檢核清單選,印出 id。結果寫死在 js/onboard-core.js 的 LISTEN_SHORT(tools/test_onboard_listen.js 比對兩者相同)。
   規則:Part 1 基礎 1、中級 1;Part 2 WH 問句基礎 2、是非問句(不是 Can you／Could you 開頭)中級 2、陳述句回應或附加／否定問句進階 2。
   候選:在 data/packs/checkpoint_pool.json、不在 data/retired.json、audio/<id>.mp3 存在;每一格照 hash32('listen-short|' + id) 由小到大取。
   用法:node tools/pick_listen_short.js(印出 JSON 陣列);也可以 require 拿 pick()。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const SLOTS = [
  { part: '1', difficulty: ['基礎'], n: 1 },
  { part: '1', difficulty: ['中級'], n: 1 },
  { part: '2', category: ['WH問句'], difficulty: ['基礎'], n: 2 },
  { part: '2', category: ['Yes/No問句'], canYou: false, difficulty: ['中級'], n: 2 },
  { part: '2', category: ['陳述句回應', '附加/否定問句'], difficulty: ['進階'], n: 2 },
];

function load() {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('data/bank-meta.js'), ctx);
  vm.runInContext(read('js/pack-util.js'), ctx);
  const pool = new Set(JSON.parse(read('data/packs/checkpoint_pool.json')).ids);
  const retired = new Set(JSON.parse(read('data/retired.json')).retired.map((x) => x.id));
  return { meta: ctx.BANK_META.items, hash32: ctx.PACK_UTIL.hash32, pool, retired };
}
function fits(row, s) {
  if (String(row.part) !== s.part || s.difficulty.indexOf(row.difficulty) < 0) return false;
  if (s.category && s.category.indexOf(row.category) < 0) return false;
  return typeof s.canYou !== 'boolean' || row.canYou === s.canYou;
}
function pick() {
  const L = load();
  const ok = (row) => L.pool.has(row.id) && !L.retired.has(row.id) && fs.existsSync(path.join(REPO, 'audio', row.id + '.mp3'));
  const out = [];
  SLOTS.forEach((s) => {
    const got = L.meta.filter((r) => fits(r, s) && ok(r)).map((r) => r.id)
      .sort((a, b) => L.hash32('listen-short|' + a) - L.hash32('listen-short|' + b) || (a < b ? -1 : 1)).slice(0, s.n);
    if (got.length < s.n) throw new Error('候選不夠:' + JSON.stringify(s));
    got.forEach((id) => out.push(id));
  });
  return out;
}

module.exports = { pick, SLOTS };
if (require.main === module) console.log(JSON.stringify(pick()));
