/* 預估分數的資料層(js/estimate-store.js)與三個帳號鍵的同步、搬家(js/sync-merge-estimate.js、js/cloud.js、js/move-rules.js、js/move-merge.js):
   舊資料補回只補還沒有的 key、重跑不重複寫;兩台交錯記作答,經過真的 js/cloud.js 上傳後雲端是聯集;重做不計;訪客不寫、不讀雲端;
   本機學生檔案只寫本機;壞資料不丟錯、更新版的格式不蓋掉;est_v1 快照什麼時候寫;檢測紀錄的開始、每題、每科結束、整次結束、續做、排除清單;
   合併函式的交換律、結合律、冪等;每一頁的載入順序;公開用語與檔案大小。
   用法:node tools/test_estimate_store.js(不開瀏覽器、不連網) */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const K = require('./estimate_kit');
const H = require('./sync_harness');

const { NOW, DAY, HOUR, CPID, LPID, J, eq, plain } = K;
const ctx = K.load();
const S = ctx.ESTIMATE_STORE, E = ctx.ESTIMATE, P = ctx.ITEM_PARAMS;
const keysOf = (re, n) => Object.keys(P.b).filter((k) => re.test(k)).sort().slice(0, n);
const P5 = keysOf(/^p5-/, 40), L2 = keysOf(/^l2-/, 30), L3 = keysOf(/^l3-/, 12);
const TODAY = E.dayNum(NOW);
const faOf = (rows) => ({ v: 1, i: rows });
const T = {};

/* ---------- 舊資料補回 ---------- */
T['補回:從學習記錄補第一次作答(只補還沒有的 key,已經有的不蓋),重跑不再寫 fa_v1'] = async () => {
  const hist = [
    { m: 'p5', id: P5[0], c: 1, ok: true, t: NOW - 3 * DAY },
    { m: 'p5', id: P5[0], c: 2, ok: false, t: NOW - 2 * DAY },
    { m: 'p5', id: P5[1], c: 0, ok: false, t: NOW - 2 * DAY },
    { m: 'l2', id: L2[0], c: 0, ok: true, t: NOW - DAY, pl: 2, sp: 1 },
  ];
  const store = K.fakeStore({ hist, fa_v1: faOf({ [P5[1]]: [100, 1, 'p'] }) });
  const v = await S.load(K.depsOf(ctx, { store }));
  const fa = store.raw('fa_v1');
  eq(fa.i[P5[0]], [TODAY - 3, 1, 'h'], '最早那一筆、來源 h');
  eq(fa.i[P5[1]], [100, 1, 'p'], '已經有的不蓋');
  eq(fa.i[L2[0]], [TODAY - 1, 1, 'r'], '重播過的聽力是 r');
  assert.equal(v.stats.h + v.stats.r, 2);
  const n = store.sets.filter((k) => k === 'fa_v1').length;
  await S.load(K.depsOf(ctx, { store }));
  assert.equal(store.sets.filter((k) => k === 'fa_v1').length, n, '第二次不再寫');
  return 'ok';
};
T['補回:舊 28 題卷要有題目才補(頁面沒載 data/diagnostic.js 時先不補、不丟錯);課程前測寫來源 k、沒作答的不寫'] = async () => {
  const legacy = { p5: [{ id: 'd5-01', answer: 1 }, { id: 'd5-02', answer: 0 }], p6: { id: 'd6', questions: [] }, p7: { id: 'd7', questions: [] } };
  const diag = { done: true, answers: { 0: 1, 1: 2 }, startedAt: new Date(NOW - 5 * DAY).toISOString(), finishedAt: new Date(NOW - 5 * DAY).toISOString() };
  const tests = { t1: { pre: { form: 'interim_half', at: Math.floor((NOW - 4 * DAY) / 1000), items: [[L2[1], 0, 2, true], [L2[2], 0, -1, false], [L3[0].split(':')[0], 2, 1, false]] } } };
  const a = K.fakeStore({ diag, tests_v1: tests });
  await S.load(K.depsOf(ctx, { store: a, legacy: null }));
  const fa1 = a.raw('fa_v1');
  assert.ok(!fa1.i['d5-01'], '沒有題目不補');
  eq(fa1.i[L2[1]], [TODAY - 4, 1, 'k']);
  assert.ok(!fa1.i[L2[2]], '沒作答的不寫');
  eq(fa1.i[L3[0].split(':')[0] + ':1'], [TODAY - 4, 0, 'k'], '題組小題 1 起算轉成 0 起算');
  await S.load(K.depsOf(ctx, { store: a, legacy }));
  const fa2 = a.raw('fa_v1');
  eq([fa2.i['d5-01'], fa2.i['d5-02']], [[TODAY - 5, 1, 'g'], [TODAY - 5, 0, 'g']]);
  return 'ok';
};

/* ---------- 第一次作答 ---------- */
T['記作答:第一次才寫,重做(第二次)不計、不改原本那筆;看過的記 null;格式不對的不寫'] = () => {
  const store = K.fakeStore();
  const d = K.depsOf(ctx, { store });
  assert.equal(S.recordFirst(P5[0], 0, 'p', d), true);
  assert.equal(S.recordFirst(P5[0], 1, 'p', Object.assign({}, d, { now: NOW + DAY })), false, '重做不寫');
  assert.equal(S.recordFirst(P5[1], null, 'c', d), true);
  assert.equal(S.recordFirst('', 1, 'p', d), false);
  assert.equal(S.recordFirst(P5[2], 1, 'z', d), false, '認不得的來源');
  eq(store.raw('fa_v1').i, { [P5[0]]: [TODAY, 0, 'p'], [P5[1]]: [TODAY, null, 'c'] });
  assert.equal(S.seen(P5[0], d), true);
  assert.equal(S.seen(P5[3], d), false);
  assert.equal(S.recordMany([{ key: P5[3], ok: 1, src: 'l' }, { key: P5[0], ok: 1, src: 'p' }, { key: P5[4], ok: true, src: 'p', day: 3 }], d), 2);
  eq(store.raw('fa_v1').i[P5[4]], [3, 1, 'p']);
  return 'ok';
};
T['訪客:只算不寫、不讀雲端;本機學生檔案:只寫本機、不讀雲端;頁面不能存時不寫'] = async () => {
  const hist = [{ m: 'p5', id: P5[0], c: 1, ok: true, t: NOW - DAY }];
  const g = K.fakeStore({ hist }), gc = K.fakeCloud({ fa_v1: faOf({ [P5[9]]: [1, 1, 'p'] }) });
  const gv = await S.load(K.depsOf(ctx, { store: g, cloud: gc, profile: null }));
  assert.equal(S.mode(K.depsOf(ctx, { profile: null })), 'guest');
  assert.equal(S.recordFirst(P5[1], 1, 'p', K.depsOf(ctx, { store: g, profile: null })), false);
  const st = await S.startRun({ sec: 'L' }, K.depsOf(ctx, { store: g, cloud: gc, profile: null }));
  eq([g.sets, gc.reads, gv.ok, gv.fa.i[P5[0]] ? 1 : 0, st.run], [[], [], true, 1, null], '訪客');
  const l = K.fakeStore({ hist }), lc = K.fakeCloud();
  await S.load(K.depsOf(ctx, { store: l, cloud: lc, profile: LPID }));
  await S.startRun({ sec: 'R' }, K.depsOf(ctx, { store: l, cloud: lc, profile: LPID }));
  eq([lc.reads, l.sets.indexOf('fa_v1') > -1, l.sets.indexOf('placement_v1') > -1], [[], true, true], '本機學生');
  const b = K.fakeStore({ hist });
  await S.load(K.depsOf(ctx, { store: b, canWrite: () => false }));
  assert.equal(S.recordFirst(P5[1], 1, 'p', K.depsOf(ctx, { store: b, canWrite: () => false })), false);
  eq(b.sets, [], '不能存');
  return 'ok';
};

/* ---------- 雲端合併 ---------- */
T['開頁讀雲端:雲端多的作答併進本機,本機的不少;讀不到雲端照本機的算、照樣寫本機'] = async () => {
  const store = K.fakeStore({ fa_v1: faOf({ [P5[0]]: [300, 1, 'p'], [P5[1]]: [305, 0, 'p'] }) });
  const cloud = K.fakeCloud({ fa_v1: faOf({ [P5[1]]: [301, 1, 'p'], [P5[2]]: [302, 0, 'l'] }), placement_v1: { v: 1, runs: [{ at: '2026-11-01T00:00:00.000Z', end: null, sec: 'L', tm: {}, items: [], res: {} }] } });
  const v = await S.load(K.depsOf(ctx, { store, cloud }));
  eq(store.raw('fa_v1').i, { [P5[0]]: [300, 1, 'p'], [P5[1]]: [301, 1, 'p'], [P5[2]]: [302, 0, 'l'] });
  assert.equal(store.raw('placement_v1').runs.length, 1);
  assert.equal(v.cloudRead, true);
  eq(cloud.reads.slice().sort(), ['est_v1', 'fa_v1', 'placement_v1']);
  const off = K.fakeStore({ hist: [{ m: 'p5', id: P5[5], c: 1, ok: true, t: NOW - DAY }] });
  const v2 = await S.load(K.depsOf(ctx, { store: off, cloud: K.fakeCloud({}, { fail: true }) }));
  assert.equal(v2.cloudRead, false);
  assert.ok(off.raw('fa_v1').i[P5[5]]);
  return 'ok';
};
T['兩台交錯記作答:經過真的 js/cloud.js 上傳,雲端是兩台的聯集;同一題兩台都做,留早的那次'] = async () => {
  const w = H.makeWorld(7);
  const A = H.makeDevice(w, 'A'), B = H.makeDevice(w, 'B');
  for (const d of [A, B]) { d.local.setItem('tr_current_profile', J(H.PID)); await H.signIn(d); }
  const storeOf = (dev) => ({ get: (k, d) => { const v = H.localOf(dev, k); return v === null ? d : v; }, set: (k, v) => H.storeSet(dev, k, v) });
  const rec = async (dev, key, ok, dayOff) => {
    S.recordFirst(key, ok, 'p', K.depsOf(ctx, { store: storeOf(dev), cloud: dev.pg.ctx.CLOUD, profile: H.PID, now: NOW + dayOff * DAY }));
    await dev.pg.runTimers();
  };
  await rec(A, P5[0], 1, 0);
  await rec(B, P5[1], 0, 0);
  await rec(A, P5[2], 1, 1);
  await rec(B, P5[2], 0, 2);   // B 沒看到 A 的那一筆(本機沒有),之後才做;合併留 A 的(日數早)
  await rec(B, P5[3], 1, 2);
  const cloud = H.cloudOf(w, 'fa_v1');
  eq(Object.keys(cloud.i).sort(), [P5[0], P5[1], P5[2], P5[3]].sort());
  eq(cloud.i[P5[2]], [TODAY + 1, 1, 'p']);
  await H.newSession(A);
  eq(Object.keys(H.localOf(A, 'fa_v1').i).sort(), Object.keys(cloud.i).sort(), '重新開頁灌回來');
  return Object.keys(cloud.i).length + ' 題';
};
T['更新版的格式(v 不是 1)與壞資料:不丟錯、不蓋掉;算不出來時 ok 是 false'] = async () => {
  const v2 = { v: 2, x: 'later' };
  const a = K.fakeStore({ fa_v1: v2, placement_v1: { v: 2 }, est_v1: 'oops', self_score: { listening: 'abc', reading: 333, examYm: 'x' }, hist: 'bad', drill_p5: 5, diag: [] });
  const v = await S.load(K.depsOf(ctx, { store: a, cloud: K.fakeCloud({ fa_v1: faOf({ [P5[0]]: [1, 1, 'p'] }) }) }));
  eq([a.raw('fa_v1'), a.raw('placement_v1')], [v2, { v: 2 }], '更新版的不寫');
  assert.equal(S.recordFirst(P5[1], 1, 'p', K.depsOf(ctx, { store: a })), false);
  assert.equal(v.ok, true);
  const badFa = { v: 1, i: { [P5[0]]: 'x', [P5[1]]: [1, 1, 'p'], '': [1, 1, 'p'] } };
  const bad = K.fakeStore({ fa_v1: badFa, placement_v1: { runs: 'x' } });
  const vb = await S.load(K.depsOf(ctx, { store: bad }));
  assert.equal(vb.ok, true);
  eq(vb.fa.i, { [P5[1]]: [1, 1, 'p'] }, '壞筆不算');
  eq(bad.raw('fa_v1'), badFa, '沒有新的作答時不只為了丟壞筆就改寫');
  const none = S.peek(K.depsOf(ctx, { params: null, store: K.fakeStore() }));
  eq([none.ok, none.L, none.total], [false, null, null]);
  const broken = S.peek(K.depsOf(ctx, { params: { ip: 'x', curve: {}, ref: {}, b: {} } }));
  assert.equal(broken.ok, false);
  return 'ok';
};

/* ---------- 預估快照 ---------- */
T['est_v1 快照:開頁算完寫 { ip, cv, at, L, R };數字沒變、同一天不再寫;隔天或數字變了才寫;peek 什麼都不寫'] = async () => {
  const fa = {};
  P5.slice(0, 16).forEach((k, i) => { fa[k] = [TODAY - 1, i % 3 ? 1 : 0, 'p']; });
  keysOf(/^p7-/, 8).forEach((k, i) => { fa[k] = [TODAY - 1, i % 2, 'p']; });
  const store = K.fakeStore({ fa_v1: faOf(fa) });
  const v = await S.load(K.depsOf(ctx, { store }));
  const snap = store.raw('est_v1');
  eq(Object.keys(snap).sort(), ['L', 'R', 'at', 'cv', 'ip']);
  eq([snap.ip, snap.cv, snap.at, snap.L], [P.ip, P.cv, new Date(NOW).toISOString(), null]);
  eq(snap.R, [v.R.est, v.R.lo, v.R.hi, 24]);
  const n = store.sets.length;
  await S.load(K.depsOf(ctx, { store, now: NOW + HOUR }));
  assert.equal(store.sets.length, n, '同一天、數字一樣不寫');
  await S.load(K.depsOf(ctx, { store, now: NOW + DAY }));
  assert.equal(store.sets.filter((k) => k === 'est_v1').length, 2, '隔天再寫');
  S.recordFirst(P5[30], 0, 'p', K.depsOf(ctx, { store, now: NOW + DAY }));
  const before = store.sets.length;
  S.peek(K.depsOf(ctx, { store, now: NOW + DAY }));
  assert.equal(store.sets.length, before, 'peek 不寫');
  return J(snap.R);
};

/* ---------- 檢測紀錄 ---------- */
T['檢測:開始先讀雲端合併、不刪以前的紀錄;每格寫 items 與 fa_v1(來源 t、同一題不重複);一科結束存這次結果;整次結束寫 end'] = async () => {
  const old = { at: '2026-11-20T00:00:00.000Z', end: '2026-11-20T00:20:00.000Z', ip: 'ip1', cv: 'c1', sec: 'R', tm: { R: ['2026-11-20T00:00:00.000Z', '2026-11-20T00:20:00.000Z'] }, items: [['R', P5[20], 1, 1, 30]], res: { R: [300, 230, 370] } };
  const store = K.fakeStore({ fa_v1: faOf({ [P5[20]]: [TODAY - 5, 1, 't'] }) });
  const cloud = K.fakeCloud({ placement_v1: { v: 1, runs: [old] }, fa_v1: faOf({ [L2[5]]: [TODAY - 9, 0, 'l'] }) });
  const d = (over) => K.depsOf(ctx, Object.assign({ store, cloud }, over));
  const st = await S.startRun({ sec: 'L' }, d());
  const at = st.run.at;
  assert.ok(st.fa.i[L2[5]] && st.fa.i[P5[20]], '選題用的是合併後的作答');
  eq(cloud.reads.slice().sort(), ['fa_v1', 'placement_v1']);
  S.beginSection(at, 'L', d({ now: NOW + 1000 }));
  S.answer(at, [{ s: 'L', key: L2[0], choice: 1, ok: 1, secs: 12.4 }], d({ now: NOW + 20e3 }));
  S.answer(at, [{ s: 'L', key: L2[0], choice: 2, ok: 0, secs: 9 }, { s: 'L', key: L3[0], choice: 0, ok: 0, secs: 40 }, { s: 'X', key: 'bad', ok: 1 }], d({ now: NOW + 80e3 }));
  const ex = S.excludeFor(at, d());
  eq(ex.used, [L2[0], L3[0], L3[0].split(':')[0]].sort());
  const r1 = S.endSection(at, 'L', d({ now: NOW + 600e3 }));
  eq(r1.items, [['L', L2[0], 1, 1, 12], ['L', L3[0], 0, 0, 40]]);
  eq(r1.tm.L, [new Date(NOW + 1000).toISOString(), new Date(NOW + 600e3).toISOString()]);
  assert.ok(Array.isArray(r1.res.L) && r1.res.L.length === 3);
  eq(store.raw('fa_v1').i[L2[0]], [TODAY, 1, 't']);
  assert.equal(S.activeRun(d({ now: NOW + 700e3 })).at, at);
  const v = await S.finishRun(at, d({ now: NOW + 800e3 }));
  const pl = store.raw('placement_v1');
  eq(pl.runs.map((r) => [r.at, !!r.end]), [[old.at, true], [at, true]], '以前那次還在');
  eq(S.sectionsDone(pl), { L: true, R: true });
  assert.equal(S.activeRun(d({ now: NOW + 900e3 })), null);
  assert.equal(v.L.show, true, '做完聽力那一科就顯示');
  return J(r1.res.L);
};
T['檢測續做:24 小時內(看最後一次動作)是 active,超過是 stale(不改 end、作答留在 fa_v1)'] = async () => {
  const store = K.fakeStore();
  const d = (t) => K.depsOf(ctx, { store, now: t });
  const st = await S.startRun({ sec: 'LR', at: new Date(NOW).toISOString() }, d(NOW));
  S.beginSection(st.run.at, 'R', d(NOW + 10 * HOUR));
  assert.equal(S.activeRun(d(NOW + 30 * HOUR)).at, st.run.at, '最後動作在 20 小時前');
  assert.equal(S.runStatus(S.activeRun(d(NOW + 30 * HOUR)), NOW + 35 * HOUR), 'stale');
  assert.equal(S.activeRun(d(NOW + 35 * HOUR)), null);
  assert.equal(store.raw('placement_v1').runs[0].end, null);
  assert.throws(() => S.beginSection(st.run.at, 'X', d(NOW)));
  await assert.rejects(S.startRun({ sec: 'Q' }, d(NOW)));
  assert.equal(S.answer('沒有這次', [{ s: 'L', key: L2[0], ok: 1 }], d(NOW)), null);
  assert.ok(!store.raw('fa_v1'), '找不到這次就不記');
  return 'ok';
};

/* 一科作答很久:最後一次送出離開始已經過了很久,24 小時要從最後一次送出起算(開始時間加上這一科作答秒數) */
T['檢測續做:一科做了很久,24 小時從最後一次送出起算(開始時間加作答秒數),不是從這一科開始的時間'] = async () => {
  const store = K.fakeStore();
  const d = (t) => K.depsOf(ctx, { store, now: t });
  const st = await S.startRun({ sec: 'L', at: new Date(NOW).toISOString() }, d(NOW));
  S.beginSection(st.run.at, 'L', d(NOW));
  S.answer(st.run.at, [{ s: 'L', key: L2[0], choice: 0, ok: 1, secs: 5 * 3600 }], d(NOW + 5 * HOUR));
  S.answer(st.run.at, [{ s: 'L', key: L2[1], choice: 1, ok: 0, secs: 4 * 3600 }], d(NOW + 9 * HOUR));
  assert.equal(S.runStatus(store.raw('placement_v1').runs[0], NOW + 30 * HOUR), 'active', '最後送出在 21 小時前');
  assert.equal(S.runStatus(store.raw('placement_v1').runs[0], NOW + 34 * HOUR), 'stale');
  return 'ok';
};
T['補回(頁面那一層):課程前測有、作答紀錄有(學習記錄已經清掉)記看過;模擬考答錯的題記看過'] = async () => {
  const store = K.fakeStore({
    hist: [{ m: 'g', id: 'g-1', c: 0, ok: true, t: NOW - 20 * DAY }],
    drill_p5: { [P5[0]]: { c: 1, ok: true, t: NOW - 100 * DAY } },
    mock_wrong: { [P5[1]]: { c: 2, ok: false, t: NOW - 5 * DAY } },
    tests_v1: { t1: { pre: { at: Math.floor((NOW - 2 * DAY) / 1000), items: [[P5[0], 0, 1, true], [P5[2], 0, 2, false]] } } },
  });
  const v = S.refresh(K.depsOf(ctx, { store, now: NOW }));
  const fa = store.raw('fa_v1').i;
  eq([fa[P5[0]], fa[P5[1]], fa[P5[2]]], [[E.dayNum(NOW - 100 * DAY), null, 'o'], [E.dayNum(NOW - 5 * DAY), null, 'o'], [E.dayNum(NOW - 2 * DAY), 0, 'k']]);
  return J(v.stats);
};

/* ---------- 起點、建議改級 ---------- */
T['自填成績:24 個月內、5 的倍數才當起點;建議改級只在另一級機率 ≥0.8、跟目前級別不同時'] = () => {
  eq(S.selfOf({ listening: 300, reading: 255, examYm: '2026-05', fromTotal: false }, NOW), { L: { score: 300, months: 6, fromTotal: false }, R: { score: 255, months: 6, fromTotal: false } });
  eq(S.selfOf({ listening: 303, reading: 250, examYm: '2026-05', fromTotal: true }, NOW), { R: { score: 250, months: 6, fromTotal: true } });
  eq(S.selfOf({ listening: 300, reading: 250, examYm: 'older' }, NOW), {});
  eq(S.selfOf({ listening: 300, reading: 250, examYm: '2024-10' }, NOW), {});
  eq(S.selfOf(null, NOW), {});
  const view = { ok: true, L: { show: true, pb: [0, 0.05, 0.9, 0.05] }, R: { show: true, pb: [0.5, 0.5, 0, 0] } };
  eq(S.suggestions(view, { listening: 'threshold', reading: 'entry' }), [{ sec: 'L', level: 'advanced' }]);
  eq(S.suggestions(view, { listening: 'advanced', reading: 'entry' }), []);
  eq(S.suggestions(view, null), [], '沒有級別不建議');
  eq(S.suggestions({ ok: false }, { listening: 'entry' }), []);
  /* 第 4 堂後調整過的級別(history 最後一筆 calibrate、來源 calibrate):照兩科目前的級別算,不看 history 與來源 */
  const cal = { listening: 'threshold', reading: 'entry', source: { listening: 'est', reading: 'calibrate' }, setAt: '2026-11-20T00:00:00.000Z',
    history: [{ at: '2026-11-01T00:00:00.000Z', listening: 'threshold', reading: 'threshold', reason: 'est' }, { at: '2026-11-20T00:00:00.000Z', listening: 'threshold', reading: 'entry', reason: 'calibrate' }] };
  eq(S.suggestions(view, cal), [{ sec: 'L', level: 'advanced' }]);
  return 'ok';
};

/* ---------- 合併函式(js/sync-merge-estimate.js) ---------- */
T['SYNC_MERGE 的 firstAttempts、placementRuns、estSnap:交換律、結合律、冪等;一份是 null 用另一份;更新版的唯讀;單獨載入不做事'] = () => {
  const M = ctx.SYNC_MERGE, c = M.canon;
  const fas = [faOf({ a: [3, 1, 'p'], b: [5, 0, 'p'] }), faOf({ a: [2, 0, 'l'], c: [9, null, 'o'] }), faOf({ b: [5, 1, 't'], d: [1, 1, 'h'] })];
  const runs = [{ v: 1, runs: [{ at: 'x1', end: null, items: [['L', 'k1', 0, 1, 2]] }] }, { v: 1, runs: [{ at: 'x1', end: 'e', items: [['L', 'k2', 0, 0, 2]] }] }, { v: 1, runs: [{ at: 'x2', end: null, items: [] }] }];
  const ests = [{ at: '2026-11-01', L: [1] }, { at: '2026-11-03', L: [2] }, { at: '2026-11-02', L: [3] }];
  [['firstAttempts', fas], ['placementRuns', runs], ['estSnap', ests]].forEach(([fn, [x, y, z]]) => {
    const m = (a, b) => M[fn](a, b).v;
    assert.equal(c(m(x, y)), c(m(y, x)), fn + ' 交換');
    assert.equal(c(m(m(x, y), z)), c(m(x, m(y, z))), fn + ' 結合');
    assert.equal(c(m(m(x, y), y)), c(m(x, y)), fn + ' 冪等');
    const r = M[fn](x, null);
    eq([r.ok, r.sameAsLocal, r.sameAsCloud], [true, true, false], fn + ' 一份是 null');
    eq(M[fn](null, null), { ok: true, v: null, sameAsLocal: true, sameAsCloud: true });
    eq(M[fn]('壞', 7), { ok: false });
    eq(M[fn]('壞', x).v, plain(x), fn + ' 壞的那份當成沒有');
  });
  eq(M.firstAttempts(fas[0], fas[1]).v.i.a, [2, 0, 'l'], '留早的');
  eq(M.firstAttempts(fas[0], { v: 2, i: {} }), { ok: false });
  eq(M.placementRuns({ v: 2, runs: [] }, runs[0]), { ok: false });
  const vm = require('vm');
  const alone = { console };
  alone.window = alone;
  vm.createContext(alone);
  vm.runInContext(K.read('js/sync-merge-estimate.js'), alone);
  vm.runInContext(K.read('js/sync-merge.js'), alone);
  vm.runInContext(K.read('js/sync-merge-estimate.js'), alone);
  assert.ok(!alone.SYNC_MERGE.firstAttempts, '沒有 ESTIMATE 不加');
  assert.ok(Object.isFrozen(ctx.SYNC_MERGE) && typeof ctx.SYNC_MERGE.banks === 'function', '原本的還在、凍結');
  return 'ok';
};

/* ---------- 搬家規則 ---------- */
T['搬家:三個鍵有規則(不是 pool 也不是 single)、中文標籤;訪客與本機學生搬家時兩邊都有就合併;暫存區對照表跟 js/cloud.js 一樣'] = () => {
  const m = K.load({ dom: false, files: ['js/move-rules.js', 'js/move-merge.js'] });
  const R = m.MOVE_RULES, MM = m.MOVE_MERGE;
  eq(['fa_v1', 'placement_v1', 'est_v1'].map(R.ruleOf), ['firstAttempts', 'placementRuns', 'estSnap']);
  eq(['fa_v1', 'placement_v1', 'est_v1'].map(MM.labelOf), ['預估分數用作答', '程度檢測紀錄', '預估分數']);
  eq(R.classify('tr_upabcd12_fa_v1', new Set(['pabcd12'])), { kind: 'profile', rule: 'firstAttempts', pid: 'pabcd12', sub: 'fa_v1' });
  const r1 = MM.mergeOne('firstAttempts', 'fa_v1', faOf({ a: [5, 1, 'p'] }), faOf({ a: [3, 0, 'p'], b: [4, 1, 'p'] }), { now: NOW });
  eq([r1.kind, r1.v], ['merged', faOf({ a: [3, 0, 'p'], b: [4, 1, 'p'] })], '同一題留舊網址早的那次');
  const r2 = MM.mergeOne('estSnap', 'est_v1', { at: '2026-11-05', L: null }, { at: '2026-11-01', L: null }, { now: NOW });
  assert.equal(r2.kind, 'same', '新網址的比較新');
  const r3 = MM.mergeOne('firstAttempts', 'fa_v1', faOf({}), { v: 2 }, { now: NOW });
  assert.equal(r3.kind, 'conflict', '更新版的格式:列為衝突、留新網址的');
  eq(['fa_v1', 'placement_v1', 'est_v1'].map(MM.syncFnOf), ['firstAttempts', 'placementRuns', 'estSnap']);
  return 'ok';
};

/* ---------- 頁面與檔案 ---------- */
T['每一頁:載 js/sync-merge-lesson.js 的頁面緊接著載 estimate-core、estimate-data、sync-merge-estimate(都在 cloud.js 前面);搬家寄出頁不載'] = () => {
  const want = ['js/sync-merge-lesson.js', 'js/estimate-core.js', 'js/estimate-data.js', 'js/sync-merge-estimate.js'];
  const bad = [];
  let n = 0;
  fs.readdirSync(K.REPO).filter((f) => /\.html$/.test(f)).forEach((f) => {
    const srcs = [];
    K.read(f).replace(/<script[^>]*\ssrc="([^"]+)"/g, (m, s) => { srcs.push(s); return m; });
    const li = srcs.indexOf(want[0]), ci = srcs.indexOf('js/cloud.js');
    if (f === 'move-out.html') { if (want.slice(1).some((s) => srcs.indexOf(s) > -1)) bad.push(f); return; }
    if (li < 0) { if (want.slice(1).some((s) => srcs.indexOf(s) > -1)) bad.push(f + '(沒有課程的合併檔卻載了估分的檔)'); return; }
    n++;
    const ok = want.every((s, i) => srcs.indexOf(s) === li + i && srcs.lastIndexOf(s) === li + i) && (ci < 0 || ci > li + 3);
    if (!ok) bad.push(f);
  });
  eq(bad, []);
  assert.ok(n >= 25, '只有 ' + n + ' 頁');
  return n + ' 頁';
};
T['估分相關的新檔:每個不超過 800 行、沒有 console.log、不寫內部用語與 repo 外的路徑(含這支測試自己)'] = () => {
  const bad = [];
  K.EST_FILES.forEach((f) => {
    const src = K.read(f);
    if (src.split('\n').length > 800) bad.push(f + ' 超過 800 行');
    if (/^js\//.test(f) && /console\.log/.test(src)) bad.push(f + ' console.log');
    const m = src.match(K.INTERNAL);
    if (m) bad.push(f + ' ' + m.join(','));
  });
  eq(bad, []);
  return K.EST_FILES.length + ' 個檔';
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let detail = '', ok = true;
    try { detail = await T[name](); } catch (e) { ok = false; detail = (e && e.message ? e.message : String(e)).slice(0, 600); }
    if (ok) pass++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + detail : ''));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
