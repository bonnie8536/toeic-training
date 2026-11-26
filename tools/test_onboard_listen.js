/* 引導流程的聽力短測(js/onboard-core.js 的 LISTEN_SHORT、listenLevel、levelsFromLegacy、resultRoute;js/onboard-data.js 的 startListen、saveListen、finishListen)。
   題目清單跟 tools/pick_listen_short.js 的輸出相同、每一格照規則;切點與上限;兩台合併(js/sync-merge.js 的 onboard);full 與 legacy 兩條路寫的 onboard。
   不開瀏覽器、不連網。用法:node tools/test_onboard_listen.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const K = require('./onboard_kit.js');
const PICK = require('./pick_listen_short.js');

const { C, eq, NOW, NOW_ISO, MIN, CPID, J, read, dataEnv, signedIn } = K;
const PRE = 'tr_u' + CPID + '_';
const T = {};

/* 題目索引與題庫:沙盒載入 data/bank-meta.js、data/listening.js */
function bank() {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('data/bank-meta.js'), ctx);
  vm.runInContext(read('data/listening.js'), ctx);
  const meta = new Map(ctx.BANK_META.items.map((r) => [r.id, r]));
  const L = ctx.TOEIC.listening;
  const items = new Map([].concat(L.p1, L.p2).map((x) => [x.id, x]));
  return { meta, answerOf: (id) => (items.has(id) ? items.get(id).answer : null) };
}
const B = bank();
const LS = () => Array.from(C.LISTEN_SHORT || []);
/* 一份做完的短測:答對前 k 題(其他選正解的下一個),fail 是音檔失敗的題號 */
function listenOf(k, over) {
  const ids = LS();
  const a = ids.map((id, i) => (i < k ? B.answerOf(id) : (B.answerOf(id) + 1) % (id.charAt(1) === '1' ? 4 : 3)));
  return Object.assign({ v: 1, mode: 'full', ids, a, fail: [], self: null, at: NOW_ISO, doneAt: NOW_ISO }, over || {});
}

T['L1 LISTEN_SHORT 8 題:跟 tools/pick_listen_short.js 一樣;每一格的 Part、難度、類別、canYou 照規則;都在清單、沒淘汰、有音檔'] = () => {
  const ids = LS();
  eq(ids, PICK.pick());
  assert.ok(Object.isFrozen(C.LISTEN_SHORT), '凍結');
  const rows = ids.map((id) => B.meta.get(id));
  eq(rows.map((r) => [r.part, r.difficulty]), [['1', '基礎'], ['1', '中級'], ['2', '基礎'], ['2', '基礎'], ['2', '中級'], ['2', '中級'], ['2', '進階'], ['2', '進階']]);
  eq(rows.slice(2, 4).map((r) => r.category), ['WH問句', 'WH問句']);
  assert.ok(rows.slice(4, 6).every((r) => r.category === 'Yes/No問句' && r.canYou === false), '是非問句');
  assert.ok(rows.slice(6).every((r) => ['陳述句回應', '附加/否定問句'].indexOf(r.category) > -1), '陳述句回應或附加/否定');
  const pool = new Set(JSON.parse(read('data/packs/checkpoint_pool.json')).ids);
  const retired = new Set(JSON.parse(read('data/retired.json')).retired.map((x) => x.id));
  ids.forEach((id) => assert.ok(pool.has(id) && !retired.has(id) && fs.existsSync(path.join(K.REPO, 'audio', id + '.mp3')), id));
};
T['L2 listenLevel 切點:0–3 入門、4–5 門檻、6–7 進階、8 高分;沒選的、音檔失敗 1 題算錯'] = () => {
  const lv = (k, over) => C.listenLevel(listenOf(k, over), B.answerOf);
  eq([0, 3, 4, 5, 6, 7, 8].map((k) => lv(k)), ['entry', 'entry', 'threshold', 'threshold', 'advanced', 'advanced', 'high']);
  const blank = listenOf(8);
  blank.a = blank.a.slice(); blank.a[7] = -1;
  assert.equal(C.listenLevel(blank, B.answerOf), 'advanced', '沒選算錯');
  assert.equal(lv(8, { fail: [0] }), 'advanced', '音檔失敗 1 題算錯');
};
T['L3 音檔失敗 2 題以上用自評;上限閱讀級＋1(閱讀入門時聽力最多門檻),自評也一樣'] = () => {
  assert.equal(C.listenLevel(listenOf(8, { fail: [0, 1], self: 'advanced' }), B.answerOf), 'advanced');
  assert.equal(C.listenLevel(listenOf(8, { fail: [0, 1], self: null }), B.answerOf), null, '還沒自評');
  assert.equal(C.listenLevel(listenOf(8), B.answerOf, 'entry'), 'threshold');
  assert.equal(C.listenLevel(listenOf(8, { fail: [2, 3], self: 'high' }), B.answerOf, 'entry'), 'threshold');
  assert.equal(C.listenLevel(listenOf(2), B.answerOf, 'high'), 'entry');
};
T['L4 listenComplete:8 格都有(失敗的題可以沒選);失敗 2 題以上要有自評'] = () => {
  const l = listenOf(8, { doneAt: null });
  assert.equal(C.listenComplete(l), true);
  const miss = Object.assign({}, l, { a: l.a.slice(0, 7).concat([null]) });
  assert.equal(C.listenComplete(miss), false);
  assert.equal(C.listenComplete(Object.assign({}, miss, { fail: [7] })), true, '失敗的題沒選也算答完');
  assert.equal(C.listenComplete(Object.assign({}, l, { fail: [1, 2] })), false);
  assert.equal(C.listenComplete(Object.assign({}, l, { fail: [1, 2], self: 'entry' })), true);
};
T['L5 levelsFromLegacy 三種來源:沒有短測照舊閱讀級＋1;短測;自評。history 理由照舊 legacy(由呼叫的一方寫)'] = () => {
  const items = Array.from({ length: 28 }, (x, i) => ({ answer: 0, difficulty: i < 10 ? '基礎' : '中級' }));
  const diag = (n) => ({ done: true, answers: Object.fromEntries(Array.from({ length: 28 }, (x, i) => [i, i < n ? 0 : 1])) });
  eq(C.levelsFromLegacy(diag(13), items), { listening: 'advanced', reading: 'threshold', source: { listening: 'legacy_plus1', reading: 'legacy' } });
  eq(C.levelsFromLegacy(diag(13), items, listenOf(8), B.answerOf), { listening: 'advanced', reading: 'threshold', source: { listening: 'short', reading: 'legacy' } });
  eq(C.levelsFromLegacy(diag(13), items, listenOf(4), B.answerOf).listening, 'threshold');
  eq(C.levelsFromLegacy(diag(13), items, listenOf(8, { fail: [0, 1], self: 'entry' }), B.answerOf),
    { listening: 'entry', reading: 'threshold', source: { listening: 'self', reading: 'legacy' } });
  eq(C.levelsFromLegacy(diag(13), items, listenOf(8, { doneAt: null }), B.answerOf).source.listening, 'legacy_plus1', '沒做完的不算');
};
T['L6 listenFor:full 的只給它之後交的那一份 28 題用(doneAt ≤ testFrom);legacy 做完就算'] = () => {
  const l = listenOf(8, { doneAt: '2026-11-19T04:00:00.000Z' });
  assert.ok(C.listenFor({ listen: l, testFrom: '2026-11-19T04:01:00.000Z' }));
  assert.equal(C.listenFor({ listen: l, testFrom: '2026-11-19T03:59:00.000Z' }), null);
  assert.equal(C.listenFor({ listen: l, testFrom: null }), null);
  assert.ok(C.listenFor({ listen: Object.assign({}, l, { mode: 'legacy' }) }));
  assert.equal(C.listenFor({ listen: Object.assign({}, l, { doneAt: null }), testFrom: NOW_ISO }), null);
  assert.equal(C.listenFor(null), null);
};
T['L7 resultRoute 與 continueHref:停在短測回 listen;做完短測的中場也回 listen'] = () => {
  assert.equal(C.resultRoute({ status: 'in_progress', step: 'listen', listen: listenOf(3, { doneAt: null }) }, null, null), 'listen');
  assert.equal(C.resultRoute({ status: 'in_progress', step: 'listen', listen: listenOf(3) }, null, null), 'listen');
  const lv = { listening: 'threshold', reading: 'threshold' };
  assert.equal(C.resultRoute({ status: 'in_progress', step: 'listen', listen: listenOf(3, { doneAt: null }) }, lv, null), 'listen');
  assert.equal(C.continueHref({ step: 'listen' }), 'start.html?step=listen');
};
T['L8 onboard.listen 兩台合併:整份 onboard 留 updatedAt 新的'] = () => {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/sync-merge.js'), ctx);
  const a = { v: 1, status: 'in_progress', step: 'listen', listen: listenOf(2, { doneAt: null }), updatedAt: '2026-11-19T04:00:00.000Z' };
  const b = { v: 1, status: 'in_progress', step: 'listen', listen: listenOf(5, { doneAt: null }), updatedAt: '2026-11-19T04:00:01.000Z' };
  const m = ctx.SYNC_MERGE.onboard(a, b, NOW);
  eq(m.v.listen.a, b.listen.a);
  eq(ctx.SYNC_MERGE.onboard(b, a, NOW).v.listen.a, b.listen.a);
};
T['L9 資料層 full:開始寫 onboard.listen(mode full、8 題、空作答)與 step listen;每題存;第 8 題存完寫 doneAt;不寫練習紀錄'] = () => {
  const e = dataEnv(signedIn({ init: { [PRE + 'onboard']: J({ v: 1, status: 'in_progress', step: 'test', updatedAt: NOW_ISO }) } }));
  assert.equal(e.D.startListen('full'), 'ok');
  const ob = () => JSON.parse(e.ls.get(PRE + 'onboard'));
  eq([ob().step, ob().status, ob().listen.mode, ob().listen.ids, ob().listen.a, ob().listen.fail, ob().listen.self, ob().listen.doneAt],
    ['listen', 'in_progress', 'full', LS(), Array(8).fill(null), [], null, null]);
  for (let i = 0; i < 8; i++) { e.clock.t += MIN; assert.equal(e.D.saveListen(i, i === 3 ? -1 : 0, i === 5), 'ok'); }
  eq([ob().listen.a, ob().listen.fail], [[0, 0, 0, -1, 0, 0, 0, 0], [5]]);
  assert.equal(e.D.finishListen(), 'ok');
  assert.ok(ob().listen.doneAt);
  assert.ok(![...e.ls.keys()].some((k) => /(listen_p|drill_p|_hist$)/.test(k)), '不寫練習紀錄');
};
T['L10 資料層:失敗 2 題以上要自評才寫 doneAt;legacy 寫 mode legacy;用短測算的級別存進 levels(理由 legacy,聽力來源 short)'] = () => {
  const e = dataEnv(signedIn());
  e.D.startListen('legacy');
  for (let i = 0; i < 8; i++) e.D.saveListen(i, 0, i < 2);
  assert.equal(e.D.finishListen(), 'ok');
  const ob = () => JSON.parse(e.ls.get(PRE + 'onboard'));
  eq([ob().listen.mode, ob().listen.doneAt], ['legacy', null]);
  assert.equal(e.D.finishListen('advanced'), 'ok');
  eq([ob().listen.self, !!ob().listen.doneAt], ['advanced', true]);
  assert.equal(e.D.setLegacyLevels({ listening: 'advanced', reading: 'threshold', source: { listening: 'self', reading: 'legacy' } }), 'ok');
  const lv = JSON.parse(e.ls.get(PRE + 'levels'));
  eq([lv.source.listening, lv.history[lv.history.length - 1].reason, ob().step, !!ob().listen.doneAt], ['self', 'legacy', 'result', true]);
};

/* ---------- 跑 ---------- */
let pass = 0;
const names = Object.keys(T);
for (const name of names) {
  let detail = '';
  try { T[name](); pass++; } catch (err) { detail = (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : String(err)); }
  console.log((detail ? 'FAIL ' : 'PASS ') + name + (detail ? '  →  ' + detail.slice(0, 500) : ''));
}
console.log(pass + ' / ' + names.length + ' 通過');
process.exit(pass === names.length ? 0 : 1);
