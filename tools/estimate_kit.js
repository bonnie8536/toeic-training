/* 預估分數測試共用:在 node 的 vm 沙盒裡載入估分的檔(js/estimate-core.js、js/estimate-data.js、data/item-params.js、
   js/sync-merge.js 與 js/sync-merge-estimate.js、js/estimate-store.js、js/estimate-ui.js),配假的 store、假的 CLOUD、固定時鐘、很小的假 DOM。
   tools/test_estimate_store.js、tools/test_estimate_ui.js 用。不開瀏覽器、不連網。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { fakeDom } = require('./engine_kit');
const fakeUI = require('./fake_ui');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const J = JSON.stringify;
const DAY = 864e5, HOUR = 3600e3;
const NOW = Date.parse('2026-11-25T12:00:00+08:00');
const UID = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72';
const CPID = 'c' + UID.replace(/-/g, '');
const LPID = 'pabcd12';

/* 物件在 vm 裡建的,原型不同:先轉成本地物件再比 */
const plain = (x) => (x === undefined ? undefined : JSON.parse(J(x)));
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);

const BASE = ['js/estimate-core.js', 'js/estimate-data.js', 'data/item-params.js', 'js/sync-merge.js', 'js/sync-merge-estimate.js'];
/* opt.files:另外要載的檔(預設 estimate-store 與 estimate-ui);opt.dom:要不要假 DOM 與假的 UI(預設要) */
function load(opt) {
  const o = opt || {};
  const ctx = { console: { log() {}, warn() {}, error() {}, info() {} } };
  ctx.window = ctx;
  if (o.dom !== false) {
    ctx.document = fakeDom();
    ctx.UI = fakeUI(ctx.document);
    ctx.UI.confirms = [];
    ctx.UI.confirmAnswer = true;
    ctx.UI.confirm = (x) => { ctx.UI.confirms.push(x); return Promise.resolve(ctx.UI.confirmAnswer); };
  }
  vm.createContext(ctx);
  BASE.concat(o.files || ['js/estimate-store.js', 'js/estimate-ui.js']).forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  return ctx;
}

/* 假的 store(js/common.js 的 get/set):sets 記每一次寫入的鍵 */
function fakeStore(init) {
  const m = new Map(Object.entries(init || {}).map(([k, v]) => [k, J(v)]));
  const sets = [];
  return {
    sets, map: m,
    get(k, d) { return m.has(k) ? JSON.parse(m.get(k)) : d; },
    set(k, v) { sets.push(k); m.set(k, J(v)); },
    raw(k) { return m.has(k) ? JSON.parse(m.get(k)) : undefined; },
  };
}
/* 假的 CLOUD.readKey:rows 是雲端每一列(鍵 → 值);opt.fail 讀不到;reads 記讀了哪些鍵 */
function fakeCloud(rows, opt) {
  const o = opt || {};
  const data = Object.assign({}, rows || {});
  const reads = [];
  return {
    reads, data,
    async readKey(k) {
      reads.push(k);
      if (o.fail) return { ok: false };
      return Object.prototype.hasOwnProperty.call(data, k) ? { ok: true, found: true, v: plain(data[k]), updated_at: null } : { ok: true, found: false, v: null, updated_at: null };
    },
  };
}
/* 一組 deps:預設雲端帳號、現在是 NOW、可以寫 */
function depsOf(ctx, over) {
  return Object.assign({ store: fakeStore(), cloud: fakeCloud(), params: ctx.ITEM_PARAMS, legacy: null, now: NOW, profile: CPID, canWrite: () => true }, over || {});
}
/* 檔案列表:估分相關的新檔(公開用語掃描、行數檢查用) */
const EST_FILES = ['js/estimate-core.js', 'js/estimate-data.js', 'js/estimate-store.js', 'js/estimate-ui.js', 'js/sync-merge-estimate.js', 'css/estimate.css',
  'data/item-params.js', 'tools/build-item-params.js', 'tools/estimate_kit.js', 'tools/test_estimate.js', 'tools/test_item_params.js',
  'tools/test_estimate_store.js', 'tools/test_estimate_ui.js'];
/* 公開 repo 不寫的字(寫成 \u 跳脫,這支檔自己也不出現):人名以外的內部用語、repo 外的路徑 */
const INTERNAL = /\u7ad9\u9577|\u7db2\u7ad9\u4e3b\u4eba|\u898f\u683c|\u6846\u67b6|\u5be9\u67e5|\u6311\u932f|\u65b9\u6848|\u6a21\u64ec\u5831\u544a|\u5de5\u4f5c\u5305|\u4ee3\u7406|\u8a55\u5206\u8005|AI ?\u8a55|\x47PT|\b[A-Z]\x3a[\\/]|@[a-z0-9.]+\.(com|tw)/g;

module.exports = { REPO, read, J, DAY, HOUR, NOW, UID, CPID, LPID, plain, eq, load, fakeStore, fakeCloud, depsOf, EST_FILES, INTERNAL };
