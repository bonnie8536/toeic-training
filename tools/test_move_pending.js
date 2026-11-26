/* 搬家暫存區(tr_move_pending_<帳號 id>)同一個帳號又搬來一包:js/move-merge.js plan 的第 3 步與 joinPending。
   js/cloud.js 合併表上的鍵兩包用 SYNC_MERGE 合併,不整份換掉;合併函式不在或合併不了時留時間晚的那包,另一包存進 tr_move_backup_<時間>_<帳號 id>。
   哪個鍵用哪個合併函式要跟 js/cloud.js 的 SYNC_FN、合併表的鍵名規則一樣(這裡從 cloud.js 原始碼讀出來對)。
   另外檢查搬家確認畫面用的中文標籤:每個有規則的鍵都有,不會直接顯示鍵名。
   共用的假 localStorage 與載入在 tools/fixtures/move_kit.js。用法:node tools/test_move_pending.js */
'use strict';
const assert = require('assert');

const K = require('./fixtures/move_kit.js');
const { read, NOW, UID, CPID, makeStorage, load, R, M, J, DEV_B, moveInto } = K;

const HOUR = 3600e3;
const iso = (t) => new Date(t).toISOString();
const k = (s) => 'tr_u' + CPID + '_' + s;
const LEDGER = 'tr_unsynced_' + UID;
const PEND = 'tr_move_pending_' + UID;
const BK = 'tr_move_backup_' + NOW + '_' + UID;

/* 同一個帳號搬兩包:第一包帳本時間 NOW-9000(寄出那台 A),第二包 NOW-5000(另一台 B)。回暫存區裡這個鍵的 [值, 時間] 與整個 localStorage */
async function twice(key, first, second, mm) {
  const ls = makeStorage(0, {});
  await moveInto(ls, { [LEDGER]: J({ [key]: NOW - 9000 }), [k(key)]: J(first) }, {}, undefined, mm);
  await moveInto(ls, { [LEDGER]: J({ [key]: NOW - 5000 }), [k(key)]: J(second) }, {}, { device: DEV_B }, mm);
  const items = JSON.parse(ls.getItem(PEND)).items;
  const e = items.find((x) => x[0] === key);
  return { v: JSON.parse(e[1]), t: e[2], ls, bk: ls.getItem(BK) };
}

const lessonState = (rows, extra) => Object.assign({ v: 1, lessonId: { listening: 'entry-L03', reading: 'entry-L03' }, packVersion: { listening: '1.2.0', reading: '1.2.0' },
  levels: { listening: 'entry', reading: 'entry' }, startedAt: Math.floor((NOW - 10 * HOUR) / 1000), doneAt: null,
  seg: { vocab: { st: 'todo', t0: null, t1: null } }, pk: {}, a: rows }, extra || {});
const hit = (b) => ({ s: 'learning', hits: [{ d: '2026-11-05', n: 1, ok: 1, src: 'p', b }], pauseUntil: null });
const lvl = (t, l) => ({ listening: l, reading: l, source: { listening: 'score', reading: 'score' }, setAt: iso(t), history: [{ at: iso(t), listening: l, reading: l, reason: 'manual' }] });

const T = {};

/* ---------- 合併表上的鍵:兩包合併 ---------- */
T['les_t(一堂一鍵):暫存區再搬一次,兩包的作答聯集,不整份換掉、不進備份'] = async () => {
  const r = await twice('les_t1_03', lessonState([[4, 'l2-01', 0, 1, 3, 10]]), lessonState([[4, 'l2-02', 0, 1, 3, 20]]));
  assert.deepEqual(r.v.a.map((x) => x[1]).sort(), ['l2-01', 'l2-02']);
  assert.equal(r.t, NOW - 5000);
  assert.equal(r.bk, null);
  return 'ok';
};
T['pts(考點狀態):暫存區再搬一次,兩包的考點聯集'] = async () => {
  const r = await twice('pts', { 'P5.cat:a': hit('x1') }, { 'P5.cat:b': hit('x2') });
  assert.deepEqual(Object.keys(r.v).sort(), ['P5.cat:a', 'P5.cat:b']);
  assert.equal(r.bk, null);
  return 'ok';
};
T['rvq(回顧佇列):暫存區再搬一次,兩包的項目聯集'] = async () => {
  const q = (id) => ({ m: 'p5', id, sub: null, due: '2026-11-06', step: 1, d0: '2026-11-05' });
  const r = await twice('rvq', [q('p5-a')], [q('p5-b')]);
  assert.deepEqual(r.v.map((e) => e.id).sort(), ['p5-a', 'p5-b']);
  assert.equal(r.bk, null);
  return 'ok';
};
T['tests_v1(測驗結果):暫存區再搬一次,兩包的測驗聯集'] = async () => {
  const r = await twice('tests_v1', { t1: { pre: { form: 'half', at: 500 } } }, { t1: { mid: { form: 'half', at: 900 } } });
  assert.deepEqual(Object.keys(r.v.t1).sort(), ['mid', 'pre']);
  assert.equal(r.bk, null);
  return 'ok';
};
T['fa_v1(預估分數用作答):暫存區再搬一次,兩包的作答聯集,同一題留早的那次;est_v1 留 at 新的那包'] = async () => {
  const r = await twice('fa_v1', { v: 1, i: { 'p5-a': [10, 1, 'p'], 'p5-b': [12, 0, 'p'] } }, { v: 1, i: { 'p5-a': [8, 0, 'l'], 'p5-c': [9, 1, 'p'] } });
  assert.deepEqual(r.v, { v: 1, i: { 'p5-a': [8, 0, 'l'], 'p5-b': [12, 0, 'p'], 'p5-c': [9, 1, 'p'] } });
  assert.equal(r.bk, null);
  const p = await twice('placement_v1', { v: 1, runs: [{ at: 'a1', end: null, items: [['L', 'k1', 0, 1, 3]] }] }, { v: 1, runs: [{ at: 'a1', end: 'e1', items: [['L', 'k2', 1, 0, 4]] }] });
  assert.deepEqual([p.v.runs.length, p.v.runs[0].end, p.v.runs[0].items.map((x) => x[1])], [1, 'e1', ['k1', 'k2']]);
  const e = await twice('est_v1', { ip: 'ip1', cv: 'c1', at: '2026-11-05', L: [300, 250, 350, 20], R: null }, { ip: 'ip1', cv: 'c1', at: '2026-11-01', L: null, R: null });
  assert.equal(e.v.at, '2026-11-05', '帳本時間晚的那包比較舊,照快照的 at 留新的');
  assert.equal(e.bk, null);
  return 'ok';
};
T['levels:暫存區再搬一次,留 setAt 新的那包(不是帳本時間晚的),history 兩包聯集'] = async () => {
  const r = await twice('levels', lvl(NOW - 2 * HOUR, 'high'), lvl(NOW - 3 * HOUR, 'entry'));
  assert.equal(r.v.listening, 'high');
  assert.equal(r.v.history.length, 2);
  assert.equal(r.t, NOW - 5000);
  assert.equal(r.bk, null);
  return 'ok';
};
T['onboard:暫存區再搬一次,留 updatedAt 新的那包'] = async () => {
  const ob = (t, status) => ({ v: 1, status, step: status === 'done' ? 'result' : 'test', updatedAt: iso(t) });
  const r = await twice('onboard', ob(NOW - 2 * HOUR, 'done'), ob(NOW - 3 * HOUR, 'in_progress'));
  assert.equal(r.v.status, 'done');
  assert.equal(r.bk, null);
  return 'ok';
};
T['self_score:暫存區再搬一次,留 enteredAt 新的那包'] = async () => {
  const ss = (t, l) => ({ listening: l, reading: 200, total: l + 200, examYm: '2026-09', fromTotal: false, enteredAt: iso(t) });
  const r = await twice('self_score', ss(NOW - 2 * HOUR, 400), ss(NOW - 3 * HOUR, 300));
  assert.equal(r.v.listening, 400);
  assert.equal(r.bk, null);
  return 'ok';
};

/* ---------- 合併不了:留時間晚的那包,另一包進備份 ---------- */
T['頁面沒載 js/sync-merge-lesson.js(舊快取):課程進度留時間晚的那包,另一包存進 tr_move_backup_<時間>_<帳號 id>,不會默默不見'] = async () => {
  const G2 = load({ without: ['js/sync-merge-lesson.js'] });
  assert.equal(typeof G2.SYNC_MERGE.pts, 'undefined');
  const first = { 'P5.cat:a': hit('x1') }, second = { 'P5.cat:b': hit('x2') };
  const r = await twice('pts', first, second, G2.MOVE_MERGE);
  assert.deepEqual(Object.keys(r.v), ['P5.cat:b']);
  const bk = JSON.parse(r.bk);
  assert.equal(bk.uid, UID);
  assert.deepEqual(bk.keys, [['pts', J(first)]]);
  return 'ok';
};
T['合併不了(認不得的版本 v:2):留時間晚的那包,另一包進備份;已經有同一個備份鍵時接在後面、同一份不重複'] = async () => {
  const ok1 = lessonState([[4, 'l2-01', 0, 1, 3, 10]]), v2 = lessonState([[4, 'l2-02', 0, 1, 3, 20]], { v: 2 });
  const r = await twice('les_t1_03', ok1, v2);
  assert.equal(r.v.v, 2);
  assert.deepEqual(JSON.parse(r.bk).keys, [['les_t1_03', J(ok1)]]);
  /* 同一個時間又搬來第三包(v:2 的那份比較舊):暫存區留著,第三包進同一個備份鍵 */
  const third = lessonState([[4, 'l2-03', 0, 1, 3, 30]]);
  await moveInto(r.ls, { [LEDGER]: J({ les_t1_03: NOW - 7000 }), [k('les_t1_03')]: J(third) }, {}, { device: 'c3c3c3c3c3c3c3c3' });
  const bk = JSON.parse(r.ls.getItem(BK));
  assert.deepEqual(bk.keys.map((e) => e[1]), [J(ok1), J(third)]);
  assert.equal(JSON.parse(JSON.parse(r.ls.getItem(PEND)).items[0][1]).v, 2);
  return 'ok';
};
T['備份鍵放不下(skip):暫存區這次也不動,列在沒搬的項目裡'] = async () => {
  const G2 = load({ without: ['js/sync-merge-lesson.js'] });
  const ls = makeStorage(0, {});
  await moveInto(ls, { [LEDGER]: J({ pts: NOW - 9000 }), [k('pts')]: J({ 'P5.cat:a': hit('x1') }) }, {}, undefined, G2.MOVE_MERGE);
  const before = ls.getItem(PEND);
  const { plan } = await moveInto(ls, { [LEDGER]: J({ pts: NOW - 5000 }), [k('pts')]: J({ 'P5.cat:b': hit('x2') }) }, { skip: [BK] }, { device: DEV_B }, G2.MOVE_MERGE);
  assert.equal(ls.getItem(PEND), before);
  assert.equal(ls.getItem(BK), null);
  assert.deepEqual(plan.skipped.map((s) => s.key), [BK]);
  return 'ok';
};
T['不在合併表上的鍵(練習紀錄)照舊留時間晚的那包,不寫備份'] = async () => {
  const r = await twice('hist', [{ m: 'p5', id: 'a', c: 1, ok: true, t: NOW - 9000 }], [{ m: 'p5', id: 'b', c: 1, ok: true, t: NOW - 5000 }]);
  assert.deepEqual(r.v.map((x) => x.id), ['b']);
  assert.equal(r.bk, null);
  return 'ok';
};

/* ---------- 跟 js/cloud.js 對照 ---------- */
T['合併函式對照表跟 js/cloud.js 一樣:SYNC_FN 相同、課程一堂一鍵的鍵名規則相同、合併表上不用對時的鍵都有'] = () => {
  const src = read('js/cloud.js');
  const fnSrc = /const SYNC_FN = \{([^}]*)\};/.exec(src);
  assert.ok(fnSrc, '讀不到 cloud.js 的 SYNC_FN');
  const cloudFn = {};
  fnSrc[1].replace(/(\w+): '(\w+)'/g, (m, key, fn) => { cloudFn[key] = fn; return m; });
  assert.deepEqual(Object.assign({}, M.SYNC_FN), cloudFn);
  const fam = /const MERGED_FAMILIES = \[\{ re: \/(.+?)\/, spec: \{ merge: SMF\('(\w+)'\)/.exec(src);
  assert.ok(fam, '讀不到 cloud.js 的 MERGED_FAMILIES');
  assert.equal(M.SYNC_FAMILY.length, 1);
  assert.equal(M.SYNC_FAMILY[0][0].source, fam[1]);
  assert.equal(M.SYNC_FAMILY[0][1], fam[2]);
  const merged = /const MERGED = \{([\s\S]*?)\n  \};/.exec(src);
  assert.ok(merged, '讀不到 cloud.js 的 MERGED');
  const keys = [];
  merged[1].replace(/\n\s+(\w+): \{([^\n]*)/g, (m, key, rest) => { if (!/clock: true/.test(rest)) keys.push(key); return m; });
  assert.ok(keys.length >= 10, '只讀到 ' + keys.length + ' 個鍵');
  keys.forEach((key) => assert.ok(M.syncFnOf(key), key + ' 沒有合併函式'));
  assert.equal(M.syncFnOf('les_t1_03'), 'lesson');
  assert.equal(M.syncFnOf('les_t1_25'), null);   // cloud.js 合併表不收的堂號:照單一值
  return keys.join(',');
};

/* ---------- 中文標籤 ---------- */
T['確認畫面的中文標籤:有規則的固定鍵、全站鍵與課程進度都有,不會直接顯示鍵名'] = () => {
  const missing = Object.keys(R.EXACT).filter((s) => M.labelOf(s) === s);
  assert.deepEqual(missing, []);
  assert.equal(M.labelOf('onboard'), '起始程度設定');
  assert.equal(M.labelOf('self_score'), '自填成績');
  assert.equal(M.labelOf('levels'), '起始程度');
  assert.equal(M.labelOf('les_t1_03'), '第 1 期第 3 堂課程進度');
  return Object.keys(R.EXACT).length + ' 個鍵';
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let detail = '', ok = true;
    try { detail = await T[name](); } catch (e) {
      ok = false;
      detail = e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e);
      if (e && e.actual !== undefined) detail = '實際 ' + JSON.stringify(e.actual) + ' 預期 ' + JSON.stringify(e.expected) + ' ' + detail;
    }
    if (ok) pass++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + String(detail).slice(0, 400) : ''));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
