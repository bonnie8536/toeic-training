/* 學習記錄頁(js/history.js)的假環境:真題庫 + 假 DOM + 假 store,tools/test_report.js 與 tools/test_corrections.js 共用。
   record 是 hist 的紀錄 [{ m, id, c, ok, t }];fetchImpl 是假的 fetch(沒給就不給 fetch)。
   回傳 { root, rows(), open(i), ctx }:open(i) 展開第 i 列(從 0 數),回那列的 body。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const K = require('./owner_test_kit.js');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const H_SRC = (read('js/common.js').match(/function h\(tag[\s\S]*?\n}\r?\n/) || [''])[0];

async function historyEnv(records, opts) {
  const o = opts || {};
  const dom = K.fakeDom();
  Object.defineProperty(dom.Node.prototype, 'childNodes', { get() { return this.children; }, configurable: true });
  dom.Node.prototype.querySelectorAll = function () { return this.find((n) => ['BUTTON', 'INPUT', 'TEXTAREA'].includes(n.tagName) || (n.tagName === 'A' && n.attrs.href)); };
  const mem = new Map([['hist', JSON.stringify(records)]]);
  const root = new dom.Node('div');
  dom.body.append(root);
  const ctx = { console: { warn() {}, log() {}, error() {} }, document: dom.document, window: {}, setTimeout, clearTimeout, Promise,
    navigator: { onLine: true }, location: { pathname: '/history.html', search: '' }, Audio: function () { this.play = () => Promise.resolve(); this.pause = () => {}; } };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['data/part5.js', 'data/part6.js', 'data/part7.js', 'data/listening.js', 'data/grammar.js', 'data/articles.js', 'data/phrases.js', 'data/phonics.js', 'data/verbs.js']
    .forEach((f) => { try { vm.runInContext(read(f), ctx, { filename: f }); } catch (e) { /* 缺一個檔就缺那個模組 */ } });
  vm.runInContext(H_SRC, ctx);
  ctx.LETTERS = ['A', 'B', 'C', 'D'];
  ctx.$ = (sel) => (sel === '#history-root' ? root : null);
  ctx.store = { get: (k, fb) => (mem.has(k) ? JSON.parse(mem.get(k)) : fb), set: (k, v) => mem.set(k, JSON.stringify(v)) };
  if (o.fetch) ctx.fetch = o.fetch;
  if (o.report) vm.runInContext(read('js/report.js'), ctx);
  if (o.report) {
    ctx.canKeepProgress = () => true;
    ctx.CLOUD = { enabled: false };
  }
  vm.runInContext(read('js/history.js'), ctx, { filename: 'js/history.js' });
  await K.settle();
  const rows = () => root.byClass('hist-row');
  const open = async (i) => {
    const r = rows()[i];
    const body = r.byClass('hist-row-body')[0];
    if (body.style.display === 'none') { await r.byClass('hist-row-head')[0].fire('click'); await K.settle(); }
    return body;
  };
  return { root, rows, open, ctx, dom };
}

module.exports = { historyEnv };
