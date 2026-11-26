/* 課程頁的讀寫(js/lesson-data.js):假的 store、雲端、CLOUD、CLASSES、sessionStorage、fetch(tools/lesson_kit.js),
   真的學習包、題目索引、js/pack-core.js、js/lesson-rules.js。
   按「開始」才建立進度、建立與凍結同一次寫、另一台先開的進度保留、plan 只寫一次、作答只寫本機、段交卷先合併雲端、
   pts 同一批補記不重複、小檢核先判再記且只判一次、tests_v1 只寫一次、排隊順序、syncPractice、選題 ctx、試行班快取、課程檔只有這一支寫儲存。
   不開瀏覽器、不連網。用法:node tools/test_lesson_data.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const K = require('./lesson_kit.js');

const { eq, EE, TE, NOW, DAY, CPID, UID } = K;
const T = {};
const setsOf = (e, k) => e.store.sets.filter((x) => x === k).length;
async function ready(o) {
  const e = K.env(Object.assign({ pilot: ['class-a'] }, o || {}));
  await e.D.packs();
  return e;
}
/* 選題(還沒寫):一般堂 pickFixed;第 1 堂組卷 */
async function pick(e, no, lv, now) {
  const l = e.lesson(lv || EE, no), c = e.D.ctx(l, now || NOW), base = e.P.newState(l, now || NOW);
  if (l.kind !== 'test') return { l, picked: (await e.P.pickFixed(l, base, c)).state, c };
  const form = await e.D.testForm(c);
  return { l, picked: [0, 1].reduce((s, i) => e.P.freeze(s, i, form[i], now || NOW), base), c, form };
}
const day = (e, sec) => e.P.dayOf(sec);

/* ---------- 開始 ---------- */
T['只有按「開始」才有進度:開堂(open)不寫;開始時建立進度與凍結選題同一次寫'] = async () => {
  const e = await ready();
  const o = await e.D.open(3);
  eq([o.state, o.cloudRead, e.store.sets], [null, true, []]);
  const { l, picked } = await pick(e, 3);
  assert.equal(e.store.sets.length, 0, '選題不寫');
  const s = await e.D.start(3, l, NOW, 'class-a', picked);
  eq([s.startedAt, setsOf(e, 'les_t1_03'), Object.keys(s.pk).length], [NOW, 1, 12]);
  eq(e.store.peek('les_t1_03'), s);
  eq(e.D.states(), { 3: s });
  assert.equal(e.store.peek('plan'), undefined, '第 3 堂不寫 plan');
};

T['開始中途丟錯本機沒有進度:沒有選題結果時不寫;小檢核那一堂沒有清單時選題就丟錯、什麼都沒寫'] = async () => {
  const e = await ready();
  const l = e.lesson(EE, 3);
  await assert.rejects(() => e.D.start(3, l, NOW, 'class-a', null), TypeError);
  assert.equal(e.store.peek('les_t1_03'), undefined);
  const lite = K.env({ pilot: ['class-a'] });
  await lite.D.packs({ lite: true });
  const l4 = lite.lesson(EE, 4), c = lite.D.ctx(l4, NOW);
  eq([c.checkpointPool, c.weekWords], [undefined, undefined], '只讀了學習包:沒有清單與字表');
  await assert.rejects(() => lite.P.pickFixed(l4, lite.P.newState(l4, NOW), c));
  const c2 = Object.assign(e.D.ctx(l4, NOW), { checkpointPool: undefined });
  await assert.rejects(() => e.P.pickFixed(l4, e.P.newState(l4, NOW), c2), /checkpointPool/);
  eq([lite.store.sets, e.store.sets], [[], []]);
};

T['另一台已經建了進度:保留它的開始時間與已凍結的格,只補沒有的格'] = async () => {
  const cloud = K.cloudOf();
  const e = await ready({ cloud });
  const { l, picked } = await pick(e, 3);
  const other = e.P.freeze(e.P.newState(l, NOW - 500), 4, ['l1-13', 'l1-14'], NOW - 490);
  cloud.put('les_t1_03', other);
  const s = await e.D.start(3, l, NOW, 'class-a', picked);
  eq([s.startedAt, s.pk[4].ids, s.pk[4].at], [NOW - 500, ['l1-13', 'l1-14'], 10]);
  eq(s.pk[6].ids, picked.pk[6].ids);
  assert.equal(s.pk[6].at, 500, '補的格照這台的時間');
  assert.equal(Object.keys(s.pk).length, 12);
};

T['plan:只在第 1 堂、還沒有 plan 時寫一次,欄位照格式;第 1 堂同一次把聽力測驗設成作答中;前測組卷配額'] = async () => {
  const e = await ready();
  const { l, picked, form } = await pick(e, 1, TE);
  eq([form[0].length, form[1].length], [22, 21], '聽力 3+12+4+3 題(組)、閱讀 15+2+4');
  const parts = (ids) => ids.map((id) => e.C.partOfId(id));
  eq(parts(form[0]), parts(form[0]).slice().sort(), 'Part 1→4 的順序');
  eq(parts(form[1]), parts(form[1]).slice().sort(), 'Part 5→7 的順序');
  const s = await e.D.start(1, l, NOW, 'class-a', picked);
  eq([s.seg.test_listening.st, s.seg.test_listening.t0, s.seg.test_reading.st, setsOf(e, 'les_t1_01')], ['doing', NOW, 'todo', 1]);
  const plan = e.store.peek('plan');
  eq(plan, {
    v: 1, source: 'self', classId: 'class-a', packs: { listening: 'pack-threshold-v1', reading: 'pack-entry-v1' }, packVersions: { listening: '1.0.0', reading: '1.0.0' },
    startDate: day(e, NOW), lessonsPerWeek: null, mainDay: new Date(NOW * 1000).getDay(), extDay: null, term: 1, postponedWeeks: 0, previous: null, updatedAt: NOW * 1000,
  });
  await e.D.start(1, l, NOW + 60, 'class-b', picked);
  const p2 = await pick(e, 2, TE);
  await e.D.start(2, p2.l, NOW + 120, 'class-a', p2.picked);
  eq([setsOf(e, 'plan'), e.store.peek('plan').classId], [1, 'class-a'], 'plan 不重寫');
  eq(e.D.plan(), plan);
};

/* ---------- 作答、段 ---------- */
async function started(o, no) {
  const e = await ready(o);
  const { l, picked } = await pick(e, no || 3);
  const s = await e.D.start(no || 3, l, NOW, 'class-a', picked);
  return { e, l, s };
}
T['record:每題只寫本機、不讀雲端;還沒開始的堂丟錯;小檢核回合交卷不寫 pts、rvq'] = async () => {
  const { e, l, s } = await started();
  const reads = e.cloud.reads.length;
  const id = s.pk[1].ids[0];
  const s1 = e.D.record(3, l, [{ b: 1, id, c: 2, ok: true, f: true, t: NOW + 10 }]);
  const s2 = e.D.record(3, l, [{ b: 1, id: s.pk[1].ids[1], c: 0, ok: false, f: true, t: NOW + 20 }]);
  eq([s1.a.length, s2.a.length, e.cloud.reads.length, setsOf(e, 'les_t1_03')], [1, 2, reads, 3]);
  eq(s2.a[0], [1, id, 0, 2, 3, 10]);
  assert.throws(() => e.D.record(5, l, []), /還沒開始/);
  const { e: e4, l: l4, s: s4 } = await started({}, 4);
  const cp = l4.segments.filter((g) => g.slot === 'checkpoint')[0].blocks[0];
  e4.D.record(4, l4, s4.pk[cp.idx].ids.map((x, i) => ({ b: cp.idx, id: x, c: 0, ok: i % 2 === 0, f: true, t: NOW + i })));
  await e4.D.flush();
  eq([e4.store.peek('pts'), e4.store.peek('rvq')], [undefined, undefined]);
};

T['segment:先讀雲端合併,回合併後的進度(別台的作答也在);還沒開始的堂丟錯、不寫'] = async () => {
  const cloud = K.cloudOf();
  const { e, l, s } = await started({ cloud });
  const other = e.P.answer(s, { b: 1, id: s.pk[1].ids[0], c: 1, ok: true, f: true, t: NOW + 30 });
  cloud.put('les_t1_03', other);
  const r = await e.D.segment(3, l, 'vocab', 'done', NOW + 100);
  eq([r.seg.vocab.st, r.seg.vocab.t1, r.a.length], ['done', NOW + 100, 1]);
  eq(e.store.peek('les_t1_03'), r);
  assert.ok(cloud.reads.indexOf('les_t1_03') > -1);
  const before = e.store.sets.length;
  await assert.rejects(() => e.D.segment(7, l, 'vocab', 'done', NOW), /還沒開始/);
  assert.equal(e.store.sets.length, before);
  await assert.rejects(() => e.D.segment(3, l, 'vocab', 'skip', NOW), TypeError, '固定段不能略過');
};

/* ---------- pts、rvq、tests_v1 ---------- */
const photo = (n, ok, extra) => Array.from({ length: n }, (_, i) => Object.assign({ key: 'P1.photo', ok: i < ok, first: true, m: 'p1', id: 'l1-0' + (i + 3) }, extra || {}));
T['hits:同一批補記不重複(留題數多的)、日期用區塊那天;變成過關的考點接著排考點回顧'] = async () => {
  const e = await ready();
  const d0 = '2026-11-20';
  await e.D.hits(photo(3, 3), { today: d0, src: 'p', b: 'les_t1_03:4' });
  await e.D.hits(photo(5, 5), { today: d0, src: 'p', b: 'les_t1_03:4' });
  await e.D.hits(photo(2, 2), { today: d0, src: 'p', b: 'les_t1_03:4' });
  const h = e.store.peek('pts')['P1.photo'].hits;
  eq(h.map((x) => [x.d, x.n, x.ok, x.src, x.b]), [[d0, 5, 5, 'p', 'les_t1_03:4']]);
  assert.equal(e.store.peek('rvq'), undefined, '一次達標還沒過關');
  const today = day(e, NOW);
  const up = await e.D.hits(photo(5, 5), { today, src: 'p', b: 'les_t1_03:7' });
  eq(up, ['P1.photo']);
  eq(e.store.peek('rvq').map((x) => [x.k, x.due, x.step]), [['P1.photo', e.R.addDays(today, 7), 7]]);
  await e.D.hits(photo(5, 5), { today, src: 'p', b: 'les_t1_03:8' });
  assert.equal(e.store.peek('rvq').length, 1, '已經過關的不再排');
};

T['小檢核:判定與記錄用同一個陣列、先判再記(v 存在 pts 那一批);答錯的排回顧、會過關的排考點回顧;已經判過不再判、不再排'] = async () => {
  const e = await ready();
  const today = day(e, NOW), b = 'les_t1_04:cp';
  e.store.set('pts', { 'P1.photo': { s: 'met', hits: [{ d: e.R.addDays(today, -3), n: 5, ok: 5, src: 'p', b: 'les_t1_03:6' }], pauseUntil: null } });
  const wh = Array.from({ length: 5 }, (_, i) => ({ key: 'P2.wh', ok: i === 0, first: true, m: 'p2', id: 'l2-0' + (i + 1) }));
  const r = await e.D.checkpoint(4, photo(5, 5).concat(wh), today);
  eq([r.fresh, r.verdicts.map((v) => [v.key, v.verdict, v.passes])], [true, [['P1.photo', 'met', true], ['P2.wh', 'weak', false]]]);
  const pts = e.store.peek('pts');
  eq([pts['P1.photo'].hits.filter((h) => h.b === b)[0].v, pts['P2.wh'].hits.filter((h) => h.b === b)[0].v, pts['P1.photo'].s], ['m', 'w', 'passed']);
  const q = e.store.peek('rvq');
  eq(q.filter((x) => x.k).map((x) => x.k), ['P1.photo']);
  eq(q.filter((x) => !x.k).map((x) => [x.m, x.id, x.due]).sort(), [['p2', 'l2-02', e.R.addDays(today, 1)], ['p2', 'l2-03', e.R.addDays(today, 1)], ['p2', 'l2-04', e.R.addDays(today, 1)], ['p2', 'l2-05', e.R.addDays(today, 1)]]);
  const rvqSets = setsOf(e, 'rvq');
  const again = await e.D.checkpoint(4, photo(5, 0).concat(wh), today);
  eq([again.fresh, again.verdicts], [false, [{ key: 'P1.photo', verdict: 'met' }, { key: 'P2.wh', verdict: 'weak' }]]);
  eq([e.store.peek('pts')['P1.photo'].hits.filter((h) => h.b === b).length, setsOf(e, 'rvq')], [1, rvqSets]);
};

T['tests_v1:第 1 堂兩段都交卷才有前測紀錄(沒作答的算錯);同一期只寫一次;本機沒有時可以補寫'] = async () => {
  const { e, l, s } = await started({}, 1);
  assert.equal(await e.D.pretest(s), null, '還沒交卷');
  const first = s.pk[0].ids[0];
  e.D.record(1, l, [{ b: 0, id: first, c: 1, ok: true, f: true, t: NOW + 5 }]);
  await e.D.segment(1, l, 'test_listening', 'done', NOW + 1000);
  const done = await e.D.segment(1, l, 'test_reading', 'done', NOW + 3000);
  assert.equal(done.doneAt, NOW + 3000);
  const pre = await e.D.pretest(done);
  eq([pre.form, pre.at, pre.items[0]], ['interim_half', NOW + 3000, [first, 0, 1, true]]);
  assert.ok(pre.items.slice(1).every((x) => x[2] === -1 && x[3] === false), '沒作答:c -1、算錯');
  const total = Object.keys(pre.parts).reduce((a, k) => a + pre.parts[k].n, 0);
  eq([pre.items.length, total, pre.parts.P1.ok], [total, pre.items.length, 1]);
  await e.D.tests(pre, day(e, NOW));
  await e.D.tests(Object.assign({}, pre, { at: NOW + 9999, parts: {} }), day(e, NOW));
  eq(e.store.peek('tests_v1').t1.pre, pre, '只寫第一次');
  eq(setsOf(e, 'tests_v1'), 2);
  const e2 = K.env({ pilot: ['class-a'] });
  e2.store.set('les_t1_01', done);
  await e2.D.tests(await e2.D.pretest(e2.store.peek('les_t1_01')), day(e2, NOW));
  eq(e2.store.peek('tests_v1').t1.pre, pre, '補寫');
};

T['排隊:pts、rvq 照呼叫順序寫,flush 等全部寫完;一個寫入失敗只記錯誤、後面照常;沒給日期用今天'] = async () => {
  const e = await ready();
  const today = day(e, NOW);
  const order = [];
  const set = e.store.set;
  e.store.set = (k, v) => { order.push(k); set(k, v); };
  e.ctx.store = e.store;
  const a = e.D.hits(photo(2, 1), { today, src: 'p', b: 'les_t1_03:4' });
  const bad = e.D.hits(photo(1, 1), { today, src: 'x', b: 'les_t1_03:5' });
  const w = e.D.wrong([{ m: 'p1', id: 'l1-03', sub: null }]);
  const r = e.D.reviewed([{ entry: { m: 'p1', id: 'l1-03', sub: null }, ok: true }], today);
  const p = e.D.passed(['P2.wh'], today);
  await e.D.flush();
  eq(order, ['pts', 'rvq', 'rvq', 'rvq']);
  eq([await a, await bad], [[], null]);
  assert.equal(e.logs.error.length, 1, '失敗的那一筆記錯誤');
  await Promise.all([w, r, p]);
  eq(e.store.peek('rvq').map((x) => (x.k ? x.k : x.m + x.id + x.step + x.due)), ['p1l1-037' + e.R.addDays(today, 7), 'P2.wh'], '沒給日期用今天');
};

/* ---------- 引擎前合併、選題 ---------- */
T['sync:題庫回合的作答紀錄與學習記錄先跟雲端合併;英語耳不在保護的鍵裡;snapshot 看作答前的紀錄'] = async () => {
  const cloud = K.cloudOf();
  const e = await ready({ cloud });
  e.store.set('listen_p1', { 'l1-05': { c: 1, ok: true, t: NOW * 1000 - 5000 } });
  cloud.put('listen_p1', { 'l1-03': { c: 0, ok: false, t: NOW * 1000 - 9000 } });
  const r = await e.D.sync(e.C.syncKeys({ kind: 'bank', parts: ['1'] }));
  eq([r.listen_p1, r.hist, Object.keys(e.store.peek('listen_p1')).sort()], ['merged', 'same', ['l1-03', 'l1-05']]);
  await assert.rejects(() => e.D.sync(['ear_d']), TypeError);
  e.store.set('drill_p6', { 'p6-b1-1:2': { c: 1, ok: true, t: 1 } });
  eq([...e.D.snapshot('1', ['l1-03', 'l1-07'])], ['l1-03']);
  eq([...e.D.snapshot('p6', ['p6-b1-1:1', 'p6-b1-1:2'])], ['p6-b1-1:2']);
};

T['模擬考作答過的題(mock_seen):選題的作答紀錄先放模擬考、再用練習紀錄蓋(都有取新的);mock_wrong 比它新的算答錯;即時回合補回只看練習紀錄;快照看得到;不改 store 讀出的值'] = async () => {
  const e = await ready(), ms = (s) => s * 1000;
  const seen = { 'l1-03': ms(NOW - 900), 'l1-05': ms(NOW - 900), 'l3-11:1': ms(NOW - 800), 'p5-b1-01': ms(NOW - 700), 'p6-b1-1:131': ms(NOW - 700), 'zz-1': ms(NOW - 1) };
  e.store.set('mock_seen', seen);
  e.store.set('mock_wrong', { 'l1-05': { c: 2, ok: false, t: ms(NOW - 900) }, 'p5-b1-01': { c: 1, ok: false, t: ms(NOW - 9000) } });
  e.store.set('listen_p1', { 'l1-03': { c: 1, ok: false, t: ms(NOW - 100) }, 'l1-07': { c: 0, ok: true, t: ms(NOW - 50) } });
  e.store.set('drill_p5', { 'p5-b1-01': { c: 1, ok: true, t: ms(NOW - 9999) } });
  const before = JSON.stringify([e.store.peek('mock_seen'), e.store.peek('listen_p1'), e.store.peek('drill_p5')]);
  const r = e.D.ctx(e.lesson(EE, 3), NOW).records;
  eq([r[1]['l1-03'], r[1]['l1-05'], r[1]['l1-07'], r[3]['l3-11:1'], r[5]['p5-b1-01'], r[6]['p6-b1-1:131']],
    [{ c: 1, ok: false, t: ms(NOW - 100) }, { ok: false, t: ms(NOW - 900) }, { c: 0, ok: true, t: ms(NOW - 50) }, { ok: true, t: ms(NOW - 800) }, { ok: true, t: ms(NOW - 700) }, { ok: true, t: ms(NOW - 700) }]);
  assert.ok(Object.keys(r).every((p) => !('zz-1' in r[p])), '認不得的題不放');
  const round = e.D.roundRecords();
  eq([Object.keys(round[1]).sort(), Object.keys(round[3]), Object.keys(round[5])], [['l1-03', 'l1-07'], [], ['p5-b1-01']], '即時回合補回只看練習紀錄');
  eq([[...e.D.snapshot('1', ['l1-05', 'l1-08'])], [...e.D.snapshot('p3', ['l3-11:0', 'l3-11:1'])]], [['l1-05'], ['l3-11:1']]);
  eq(e.D.mockSeen(), seen);
  eq(JSON.stringify([e.store.peek('mock_seen'), e.store.peek('listen_p1'), e.store.peek('drill_p5')]), before);
  assert.ok(e.D.ctx(e.lesson(EE, 3), NOW).seen.indexOf('l3-11') > -1, '14 天內做過');
};
T['模擬考做過的清單題,小檢核不選'] = async () => {
  const e = await ready();
  const l = e.lesson(EE, 4), p1 = l.segments.filter((s) => s.slot === 'checkpoint')[0].blocks.filter((b) => b.module === 'p1')[0];
  const pool = K.POOL.ids.filter((id) => /^l1-/.test(id));
  const seen = {};
  pool.slice(0, pool.length - p1.count).forEach((id) => { seen[id] = NOW * 1000 - 5000; });
  e.store.set('mock_seen', seen);
  const r = await e.P.pickFixed(l, e.P.newState(l, NOW), e.D.ctx(l, NOW));
  eq(r.state.pk[p1.idx].ids.slice().sort(), pool.slice(pool.length - p1.count).sort());
};

T['ctx:records 是七個 Part 的作答紀錄;seen 是 14 天內做過的題(題組取組 id)加前測的題;小檢核清單扣掉前測的題;字表跟閱讀級'] = async () => {
  const e = await ready();
  const ms = NOW * 1000;
  e.store.set('listen_p1', { 'l1-03': { c: 0, ok: true, t: ms - 3 * K.DAY_MS }, 'l1-04': { c: 0, ok: true, t: ms - 20 * K.DAY_MS } });
  e.store.set('drill_p7', { 'p7-b1-1:2': { c: 0, ok: true, t: ms - K.DAY_MS } });
  const pool = K.POOL.ids, p5 = pool.filter((id) => /^p5-/.test(id)).slice(0, 2);
  e.store.set('tests_v1', { t1: { pre: { form: 'interim_half', at: NOW, parts: {}, items: [[p5[0], 0, 1, true], [p5[1], 0, 2, false]] } } });
  const c = e.D.ctx(e.lesson(TE, 3), NOW);
  eq([Object.keys(c.records).length, c.records[1]['l1-03'].ok, c.now], [7, true, NOW]);
  eq(c.seen.slice().sort(), [p5[0], p5[1], 'l1-03', 'p7-b1-1'].sort());
  eq([c.checkpointPool.length, c.checkpointPool.indexOf(p5[0]), c.checkpointPool.indexOf(p5[1])], [pool.length - 2, -1, -1]);
  eq(c.weekWords(2, 'this_week').slice(0, 1), ['21'], '閱讀入門的字表');
  eq(e.D.ctx(e.lesson(K.ET, 3), NOW).weekWords(2, 'this_week').slice(0, 1), ['25'], '閱讀門檻的字表');
  eq(K.env().D.ctx(e.lesson(EE, 3), NOW).weekWords, undefined, '沒讀字表');
};

T['ctx:還沒寫前測紀錄時(tests_v1 沒有),seen 與小檢核清單照樣扣掉第 1 堂凍結的前測題'] = async () => {
  const e = await ready();
  const pool = K.POOL.ids, l1 = pool.filter((id) => /^l1-/.test(id)).slice(0, 2), p5 = pool.filter((id) => /^p5-/.test(id)).slice(0, 2);
  const lesson1 = e.lesson(EE, 1);
  e.store.set('les_t1_01', e.P.freeze(e.P.freeze(e.P.newState(lesson1, NOW - DAY), 0, l1, NOW - DAY), 1, p5, NOW - DAY));
  const c = e.D.ctx(e.lesson(EE, 4), NOW);
  eq([e.store.peek('tests_v1'), l1.concat(p5).filter((id) => c.seen.indexOf(id) < 0), l1.concat(p5).filter((id) => c.checkpointPool.indexOf(id) > -1), c.checkpointPool.length],
    [undefined, [], [], pool.length - 4]);
};

T['個人段整段取先凍結的:另一台已經凍結回顧的 80,這一台帶 80–82 的選題寫進去,只留另一台的 80、沒有 81、82'] = async () => {
  const cloud = K.cloudOf();
  const e = await ready({ cloud });
  const { l, picked } = await pick(e, 3);
  await e.D.start(3, l, NOW - 600, 'class-a', picked);
  const other = e.P.freeze(e.store.peek('les_t1_03'), 80, ['l1-13'], NOW - 300, { r: 'review', sub: [null], m: ['p1'] });
  cloud.put('les_t1_03', other);
  const mine = [80, 81, 82].reduce((s, i) => e.P.freeze(s, i, ['p5-' + i], NOW, { r: i === 80 ? 'review' : 'point_review:P5.cat:詞性變化' }), e.store.peek('les_t1_03'));
  const s = await e.D.freeze(3, l, mine, [80, 85]);
  eq([s.pk[80].ids, !!s.pk[81], !!s.pk[82], e.store.peek('les_t1_03').pk[80].ids], [['l1-13'], false, false, ['l1-13']]);
};

T['fillFixed:一般堂補還沒凍結的、沒變不寫;前測缺一格只補那一格(c.assemble)、兩格都有不寫'] = async () => {
  const e = await ready();
  const l = e.lesson(EE, 3);
  const half = e.P.freeze(e.P.newState(l, NOW), 0, [], NOW);
  e.store.set('les_t1_03', half);
  const c = e.D.ctx(l, NOW + 30);
  const s = await e.D.fillFixed(3, l, half, c);
  eq([Object.keys(s.pk).length, s.pk[0].at, s.pk[4].at], [12, 0, 30]);
  const n = e.store.sets.length;
  eq(await e.D.fillFixed(3, l, s, c), s);
  assert.equal(e.store.sets.length, n, '沒變不寫');
  const l1 = e.lesson(EE, 1);
  const only0 = e.P.freeze(e.P.newState(l1, NOW), 0, ['l1-03'], NOW);
  e.store.set('les_t1_01', only0);
  const c1 = Object.assign(e.D.ctx(l1, NOW + 5), { assemble: async () => ({ 0: ['l1-04'], 1: ['p5-b1-01'] }) });
  const t = await e.D.fillFixed(1, l1, only0, c1);
  eq([t.pk[0].ids, t.pk[1].ids, t.pk[1].at], [['l1-03'], ['p5-b1-01'], 5]);
  const m = e.store.sets.length;
  await e.D.fillFixed(1, l1, t, c1);
  eq([e.store.sets.length, await e.D.fillFixed(1, l1, null, c1)], [m, null]);
};

T['trial:試排個人段不寫任何鍵;沒有到期回顧是 0、有就算題數;已做完或已凍結的段是 null'] = async () => {
  const { e, l, s } = await started();
  const today = day(e, NOW);
  const n = e.store.sets.length;
  const t0 = await e.D.trial(3, l, s);
  assert.equal(t0.review, 0);
  assert.ok(t0.weak > 0, '弱點補練退回前測或下週考點:' + t0.weak);
  e.store.set('rvq', [{ m: 'p1', id: 'l1-03', sub: null, due: today, step: 1, d0: e.R.addDays(today, -1) }]);
  const t1 = await e.D.trial(3, l, s);
  eq([t1.review, e.store.sets.length], [1, n + 1]);
  const skipped = e.P.freeze(e.P.setSegment(s, l, 'review', 'skip', NOW), 85, ['p5-b1-01'], NOW, { m: 'p5', k: null });
  eq(await e.D.trial(3, l, skipped), { review: null, weak: null });
  const opt = e.D.weakOpt(3, l, s, await e.D.inputs(NOW), 0);
  eq([opt.seconds, opt.doneUnits.constructor.name, opt.fallback.nextFocus], [(11 + 8) * 60, 'Set', ['P1.photo', 'P2.wh', 'P5.noun_slot', 'P5.adj_slot']]);
  eq(e.D.weakOpt(24, e.lesson(EE, 24), s, await e.D.inputs(NOW), 0).fallback.nextFocus, [], '第 24 堂不拼第 25 堂');
};

/* ---------- 試行班 ---------- */
const member = (ids) => ({ ok: true, classes: ids.map((id) => ({ id, joinedAt: '2026-11-01', name: '班' })) });
T['pilot:查一次班級名單、結果記在這個分頁;同一個工作階段再開頁不查;換帳號重查;查不到(unknown)不記'] = async () => {
  const session = new Map();
  const a = K.env({ pilot: ['class-a'], membership: member(['class-x', 'class-a']), session });
  eq(K.plain(await a.D.pilot()), { state: 'pilot', classId: 'class-a' });
  eq([a.classCalls.length, JSON.parse(session.get('lsn_pilot'))], [1, { p: CPID, s: 'pilot', c: 'class-a' }]);
  const b = K.env({ pilot: ['class-a'], membership: member([]), session });
  eq([K.plain(b.D.pilotNow()), K.plain(await b.D.pilot()), b.classCalls.length], [{ state: 'pilot', classId: 'class-a' }, { state: 'pilot', classId: 'class-a' }, 0]);
  const other = '11111111-2222-4333-8444-555555555555';
  const c = K.env({ pilot: ['class-a'], membership: member([]), session, user: other, pid: 'c' + other.replace(/-/g, '') });
  eq([(await c.D.pilot()).state, c.classCalls.length], ['no', 1]);
  const ss2 = new Map();
  const d = K.env({ pilot: ['class-a'], membership: { ok: false, message: 'x' }, session: ss2 });
  eq([(await d.D.pilot()).state, ss2.has('lsn_pilot')], ['unknown', false]);
  const d2 = K.env({ pilot: ['class-a'], membership: 'throw', session: ss2 });
  eq([(await d2.D.pilot()).state, d2.classCalls.length], ['unknown', 1]);
  const both = K.env({ pilot: ['class-a'], membership: member(['class-a']) });
  await Promise.all([both.D.pilot(), both.D.pilot()]);
  assert.equal(both.classCalls.length, 1, '同時叫只查一次');
};

T['pilot:開關關、訪客、老師、名單空、有 plan 的試行生都不查名單;正要重載不查;sessionStorage 不能用照樣判'] = async () => {
  const cases = [[{ ui: 'off', pilot: ['class-a'] }, 'off'], [{ user: null, pilot: ['class-a'] }, 'guest'], [{ teacher: true, pilot: ['class-a'] }, 'teacher'], [{ pilot: [] }, 'no']];
  for (const [o, want] of cases) {
    const e = K.env(o);
    eq([(await e.D.pilot()).state, e.classCalls.length, e.D.pilotNow().state], [want, 0, want], want);
  }
  const p = K.env({ pilot: ['class-a'] });
  p.store.set('plan', { v: 1, classId: 'class-a', term: 1 });
  eq([K.plain(await p.D.pilot()), p.classCalls.length], [{ state: 'pilot', classId: 'class-a' }, 0]);
  const r = K.env({ pilot: ['class-a'], reloading: true });
  eq([(await r.D.pilot()).state, r.classCalls.length], ['checking', 0]);
  const f = K.env({ pilot: ['class-a'], membership: member(['class-a']), sessionFail: true });
  eq([(await f.D.pilot()).state, (await f.D.pilot()).state, f.classCalls.length], ['pilot', 'pilot', 2]);
};

T['pilot:班級名單 8 秒沒回當查不到(unknown)'] = async () => {
  const e = K.env({ pilot: ['class-a'], membership: 'hang', timers: 'fake' });
  let out = null;
  e.D.pilot().then((r) => { out = r; });
  await K.flush();
  e.tick(7999);
  await K.flush();
  assert.equal(out, null, '還沒到 8 秒');
  e.tick(1);
  await K.flush();
  eq([out && out.state, e.ss.map.has('lsn_pilot')], ['unknown', false]);
};

/* ---------- 其他讀取 ---------- */
T['packs:首頁、總覽只讀兩包學習包;上課頁再讀字表與清單;同一頁只讀一次;讀不到記 console.error、下次重讀'] = async () => {
  const e = K.env();
  const lite = await e.D.packs({ lite: true });
  eq([e.fetches, lite.words, lite.pool, lite.packs.entry.packId], [['data/packs/pack_entry.json', 'data/packs/pack_threshold.json'], null, null, 'pack-entry-v1']);
  const full = await e.D.packs();
  eq([e.fetches.length, full.words.entry.level, full.pool.ids.length], [5, 'entry', K.POOL.ids.length]);
  await e.D.packs();
  assert.equal(e.fetches.length, 5, '不重讀');
  const bad = K.env({ fetchFail: new Set(['data/packs/pack_threshold.json']) });
  await assert.rejects(() => bad.D.packs({ lite: true }));
  eq(bad.logs.error[0], ['data/packs/pack_threshold.json', 404]);
  bad.ctx.fetch = (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(K.read(u))) });
  eq((await bad.D.packs({ lite: true })).packs.threshold.packId, 'pack-threshold-v1', '重試');
};

T['levels、states:上課用的級別(進階、高分換門檻);24 堂只放有進度的;第 2 期讀 les_t2_'] = () => {
  const e = K.env();
  assert.equal(e.D.levels(), null);
  e.store.set('levels', { listening: 'high', reading: 'advanced', source: 'score', setAt: '2026-11-20T00:00:00Z' });
  eq(e.D.levels(), { listening: 'threshold', reading: 'threshold' });
  e.store.set('les_t1_02', { v: 1, startedAt: NOW });
  e.store.set('les_t2_05', { v: 1, startedAt: NOW });
  eq(Object.keys(e.D.states()), ['2']);
  e.store.set('plan', { v: 1, term: 2 });
  eq(Object.keys(e.D.states()), ['5']);
};

T['clock:記這個分頁的最後畫面時間;進度鍵或段不同就不用;sessionStorage 不能用時回 null'] = () => {
  const e = K.env();
  const c = e.D.clock('les_t1_01', 'test_listening');
  assert.equal(c.last(), null);
  c.touch();
  e.clock.add(15);
  eq([c.last(), e.D.clock('les_t1_01', 'test_reading').last(), e.D.clock('les_t2_01', 'test_listening').last()], [NOW, null, null]);
  const f = K.env({ sessionFail: true }).D.clock('les_t1_01', 'test_listening');
  f.touch();
  assert.equal(f.last(), null);
};

T['clock:同一個分頁換帳號(公用電腦先後登入兩個帳號)時,不用前一個帳號記的最後畫面時間'] = () => {
  const session = new Map();
  const a = K.env({ session });
  a.D.clock('les_t1_01', 'test_listening').touch();
  assert.equal(JSON.parse(session.get('lsn_clock')).p, CPID, '記的時候帶帳號');
  const other = '11111111-2222-4333-8444-555555555555';
  const b = K.env({ session, user: other, pid: 'c' + other.replace(/-/g, '') });
  const cb = b.D.clock('les_t1_01', 'test_listening');
  assert.equal(cb.last(), null, '另一個帳號不用');
  cb.touch();
  eq([cb.last(), a.D.clock('les_t1_01', 'test_listening').last()], [NOW, null], '換回來也不用別人的');
  session.set('lsn_clock', JSON.stringify({ k: 'les_t1_01', s: 'test_listening', at: NOW }));
  assert.equal(a.D.clock('les_t1_01', 'test_listening').last(), null, '沒有帳號的舊格式不用');
};

/* ---------- 原始碼 ---------- */
T['課程檔裡只有 js/lesson-data.js 寫 store、讀寫 sessionStorage;它的 store 鍵都是字面字串或 lessonKey(term, no)'] = () => {
  const list = fs.readdirSync(path.join(K.REPO, 'js')).filter((f) => /^(lessons?(-[\w-]+)?|packs-config)\.js$/.test(f)).map((f) => 'js/' + f)
    .concat(['lessons.html', 'lesson.html'].filter(K.exists));
  const writers = list.filter((f) => /\bstore\.(set|remove)\(|sessionStorage|localStorage/.test(K.read(f)));
  eq(writers, ['js/lesson-data.js']);
  const src = K.read('js/lesson-data.js');
  assert.equal(/localStorage/.test(src), false);
  const args = Array.from(src.matchAll(/store\.(get|set|remove)\(\s*(\w+\([^)]*\)|[^,)]+)/g)).map((m) => m[2].trim());
  const odd = args.filter((a) => !/^'[a-z0-9_]+'$/.test(a) && a !== 'lessonKey(term, no)');
  eq(odd, []);
  return args.length + ' 處';
};

T['帳號:資料夾不是雲端帳號、也沒有 CLOUD.user 時是訪客;還沒換資料夾時用 CLOUD.user'] = async () => {
  const e = K.env({ pid: 'pabc123', pilot: ['class-a'], membership: member(['class-a']) });
  eq([(await e.D.pilot()).state, JSON.parse(e.ss.map.get('lsn_pilot')).p], ['pilot', 'u' + UID]);
  eq(K.env({ user: null, pilot: ['class-a'] }).D.pilotNow().state, 'guest');
};

/* ---------- 小檢核的預留題 ---------- */
T['ctx 的預留題:有帳號才有,跟 PACK_CORE.reserveFor 算的一樣(雲端帳號的資料夾、還沒換資料夾時的 CLOUD.user 算出同一份);訪客沒有;不寫任何鍵'] = async () => {
  const e = await ready(), l = e.lesson(EE, 2);
  const n = e.store.sets.length;
  const c = e.D.ctx(l, NOW), got = await c.reserve();
  const want = await e.P.reserveFor(K.PACKS, EE, 2, { account: CPID, pool: K.POOL.ids, bank: e.B });
  const four = e.lesson(EE, 4).segments.filter((s) => s.slot === 'checkpoint')[0].blocks.filter((b) => !b.fill);
  eq([got, got.near.length, e.store.sets.length], [want, four.reduce((a, b) => a + b.count, 0), n]);
  eq(await e.D.ctx(e.lesson(EE, 3), NOW).reserve(), got, '第 2、3 堂都是第 4、8 堂那兩份');
  const u = await ready({ pid: 'pabc123' });
  eq(await u.D.ctx(u.lesson(EE, 2), NOW).reserve(), got, '還沒換資料夾(CLOUD.user)');
  const g = await ready({ user: null });
  eq(g.D.ctx(g.lesson(EE, 2), NOW).reserve, undefined, '訪客不預留');
  eq(await g.P.reserved(g.D.ctx(g.lesson(EE, 2), NOW)), []);
};
T['前測組卷先避開預留題(之後兩次小檢核那兩份);那個 Part 只剩預留題時才用它補滿配額'] = async () => {
  const e = await ready(), l = e.lesson(EE, 1), c = e.D.ctx(l, NOW);
  const hold = await c.reserve(), form = await e.D.testForm(c);
  const all = form[0].concat(form[1]);
  eq([all.filter((id) => hold.ids.indexOf(id) > -1), all.length], [[], (await pick(e, 1)).form[0].length + form[1].length]);
  const p1 = e.ctx.BANK_META.items.filter((r) => r.part === '1').map((r) => r.id);
  const tight = Object.assign({}, c, { reserve: p1.slice(1) });
  const f2 = await e.D.testForm(tight);
  const got = f2[0].filter((id) => /^l1-/.test(id));
  eq([got.length, got.indexOf(p1[0]) > -1, got.filter((id) => id !== p1[0]).every((id) => p1.indexOf(id) > 0)], [3, true, true], '配額照樣 3 題,先用沒預留的那一題');
  /* 補滿配額時不會再選到已經選的題:沒預留的那一題是唯一沒做過的(沒做過的排最前面),補的兩題也不能是它 */
  const done = {};
  p1.slice(1).forEach((id) => { done[id] = { c: 0, ok: true, t: (NOW - 86400) * 1000 }; });
  const f3 = await e.D.testForm(Object.assign({}, tight, { records: Object.assign({}, c.records, { 1: done }) }));
  const g3 = f3[0].filter((id) => /^l1-/.test(id));
  eq([g3.length, new Set(g3).size, g3[0]], [3, 3, p1[0]], '補滿配額時不重複');
  [form, f2, f3].forEach((f, i) => { const ids = f[0].concat(f[1]); eq(new Set(ids).size, ids.length, '第 ' + (i + 1) + ' 份前測沒有重複的題'); });
};

K.run(T);
