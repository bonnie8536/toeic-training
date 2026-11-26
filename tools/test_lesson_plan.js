/* 課表設定與第 4 堂後的程度調整(js/lesson-plan.js,純計算):課程週、每週堂數(第一次選當週生效、之後下週生效)、
   每週 1 堂時哪些堂是課後練習與解鎖、本週一列的數字、獨立小檢核的條件、校正的答對率與升降、這一期做過沒有。
   node + vm(tools/lesson_kit.js 載真的學習包與 js/pack-core.js)。不開瀏覽器、不連網。用法:node tools/test_lesson_plan.js */
'use strict';
const assert = require('assert');
const K = require('./lesson_kit.js');
const { eq, plain, PACKS, NOW, DAY, EE, TT } = K;

const E = K.env({ files: ['js/onboard-core.js', 'js/lesson-plan.js'] });
const L = E.ctx.LESSON_PLAN, P = E.P;
const START = '2026-11-02';
const PLAN = { v: 1, source: 'self', classId: 'k1', startDate: START, lessonsPerWeek: null, term: 1, updatedAt: 1000 };
const planOf = (extra) => Object.assign({}, PLAN, extra || {});
const sec = (day, h) => Math.floor(new Date(day + 'T' + String(h || 10).padStart(2, '0') + ':00:00').getTime() / 1000);
const frozen = (x) => JSON.stringify(x);
/* 一堂的進度:done 是 true(全部段交卷)、段的陣列,或 'fixed'(固定段交卷) */
function stateOf(lv, no, at, done) {
  const l = P.compose(PACKS, lv, no);
  let s = P.newState(l, at);
  const slots = done === true ? l.segments.map((x) => x.slot) : done === 'fixed' ? l.segments.filter((x) => x.fixed).map((x) => x.slot) : done || [];
  slots.forEach((slot) => { const seg = l.segments.filter((x) => x.slot === slot)[0]; s = P.setSegment(s, l, slot, seg.fixed ? 'done' : 'skip', at + 600); });
  return plain(s);
}
const open24 = () => { const p = JSON.parse(JSON.stringify(PACKS)); p.entry.liveThrough = 24; p.threshold.liveThrough = 24; return p; };

const T = {};

T['L1 課程週從開始日算 7 天一週;每週堂數取最後一筆 w ≤ 本週的,沒有是 2'] = () => {
  eq(['2026-11-02', '2026-11-08', '2026-11-09', '2026-12-28', '2027-01-25'].map((d) => L.courseWeek(planOf(), d)), [1, 1, 2, 9, 13]);
  eq([L.courseWeek(null, START), L.courseWeek(planOf({ startDate: 'x' }), START)], [null, null]);
  const p = planOf({ perWeek: [{ w: 1, n: 2 }, { w: 3, n: 1 }] });
  eq([1, 2, 3, 12].map((w) => L.perWeekOf(p, w)), [2, 2, 1, 1]);
  eq([L.perWeekOf(planOf(), 5), L.perWeekOf(planOf({ perWeek: 'x' }), 5)], [2, 2]);
};

T['L2 選每週堂數:第一次選當週生效、之後改下週生效(同一週換掉);第 12 週之後不能改;寫問過的時間與 updatedAt;不改傳進來的 plan'] = () => {
  const p0 = planOf({ perWeek: [], weeklyAskedAt: null }), keep = frozen(p0);
  const a = L.withWeekly(p0, 1, '2026-11-10', 5000);
  eq([a.perWeek, a.lessonsPerWeek, typeof a.weeklyAskedAt, a.updatedAt], [[{ w: 2, n: 1 }], 1, 'string', 5000]);
  const b = L.withWeekly(a, 2, '2026-11-11', 4000);
  eq([b.perWeek, b.lessonsPerWeek, b.weeklyAskedAt, b.updatedAt], [[{ w: 2, n: 1 }, { w: 3, n: 2 }], 2, a.weeklyAskedAt, 5001]);
  const c = L.withWeekly(b, 1, '2026-11-12', 9000);
  eq(c.perWeek, [{ w: 2, n: 1 }, { w: 3, n: 1 }], '同一週換掉');
  const old = L.withWeekly(planOf(), 2, START, 7000);
  eq([old.perWeek, old.lessonsPerWeek], [[{ w: 1, n: 2 }], 2], '舊 plan 沒有欄位也能選');
  const late = planOf({ perWeek: [{ w: 1, n: 2 }] });
  eq(L.withWeekly(Object.assign({}, late, { weeklyAskedAt: 'x' }), 1, '2027-01-18', 9000), Object.assign({}, late, { weeklyAskedAt: 'x' }), '第 12 週之後不能改');
  const l13 = L.withWeekly(planOf({ perWeek: [], weeklyAskedAt: null }), 1, '2027-01-25', 9000);
  eq([L.courseWeek(l13, '2027-01-25'), l13.perWeek, typeof l13.weeklyAskedAt, l13.updatedAt], [13, [], 'string', 9000], '第 13 週選了:堂數不改,記成問過');
  assert.throws(() => L.withWeekly(p0, 3, START, 1), TypeError);
  eq(frozen(p0), keep);
};

T['L3 每週 1 堂:那幾週的偶數堂是課後練習;必上的堂數'] = () => {
  const all1 = L.optionalOf(planOf({ perWeek: [{ w: 1, n: 1 }] })), mix = L.optionalOf(planOf({ perWeek: [{ w: 1, n: 2 }, { w: 3, n: 1 }] }));
  eq([1, 2, 3, 4, 24].map(all1), [false, true, false, true, true]);
  eq([2, 4, 5, 6, 8].map(mix), [false, false, false, true, true]);
  eq([L.requiredCount(planOf()), L.requiredCount(planOf({ perWeek: [{ w: 1, n: 1 }] })), L.requiredCount(planOf({ perWeek: [{ w: 1, n: 2 }, { w: 3, n: 1 }] })), L.requiredCount(null)], [24, 12, 14, 24]);
  eq([L.optionalOf(null)(2), L.optionalOf(planOf())(2)], [false, false]);
};

T['L4 解鎖(optional):課後練習不擋下一堂、照前一個必上的堂開;next 是第一個沒上完的必上堂;一天最多 2 堂照算課後練習;沒給 optional 跟以前一樣'] = () => {
  const today = P.dayOf(NOW), day1 = NOW - 3 * DAY;
  const states = { 1: stateOf(EE, 1, day1, true) };
  const opt = L.optionalOf(planOf({ perWeek: [{ w: 1, n: 1 }] }));
  const u = P.unlockState({ packs: PACKS, levels: EE, states, today, optional: opt });
  eq(u.lessons.slice(0, 5).map((x) => [x.status, !!x.optional]), [['done', false], ['open', true], ['open', false], ['locked', true], ['not_live', false]]);
  eq(u.next, 3);
  const plainU = P.unlockState({ packs: PACKS, levels: EE, states, today });
  eq([plainU.lessons.slice(0, 3).map((x) => x.status), plainU.next, plainU.lessons.every((x) => !('optional' in x))], [['done', 'open', 'locked'], 2, true]);
  const s3 = stateOf(EE, 3, NOW, 'fixed'), s2 = stateOf(EE, 2, NOW, []);
  const v = P.unlockState({ packs: PACKS, levels: EE, states: { 1: states[1], 2: s2, 3: s3 }, today, optional: opt });
  eq(v.lessons.slice(1, 4).map((x) => x.status), ['open', 'open', 'daily_limit'], '今天開了第 2(課後練習)、3 堂:第 4 堂明天');
};

T['L5 本週一列:要上幾堂、完成幾堂(只算必上的)、練習天數(堂的作答與交卷、練習紀錄、模擬考;只算本週 7 天)、目標天數(第 1、7、12 週少 1 天)'] = () => {
  const p = planOf({ perWeek: [{ w: 1, n: 2 }, { w: 2, n: 1 }] });
  const s1 = stateOf(EE, 1, sec('2026-11-02'), true), s2 = stateOf(EE, 2, sec('2026-11-05'), true);
  const s3 = Object.assign(stateOf(EE, 3, sec('2026-11-09'), true), { a: [[0, '1', 0, -1, 3, 86400 * 2]] });
  const hist = [{ m: 'p5', id: 'x', t: sec('2026-11-10', 9) * 1000 }, { m: 'p5', id: 'y', t: sec('2026-11-20') * 1000 }];
  const mockHistory = [{ d: new Date(sec('2026-11-15', 20) * 1000).toISOString() }];
  const w1 = L.weekGoal({ plan: p, states: { 1: s1, 2: s2 }, hist: [], mockHistory: [], today: '2026-11-05' });
  eq(w1, { w: 1, done: 2, want: 2, days: 2, wantDays: 2 });
  const w2 = L.weekGoal({ plan: p, states: { 1: s1, 2: s2, 3: s3 }, hist, mockHistory, today: '2026-11-12' });
  eq(w2, { w: 2, done: 1, want: 1, days: 4, wantDays: 2 }, '第 3 堂(必上)那天、作答在第 11 日、練習紀錄第 10 日、模擬考第 15 日;第 4 堂是課後練習');
  eq([L.weekGoal({ plan: planOf(), states: {}, hist: [], mockHistory: [], today: '2026-11-16' }).wantDays, L.weekGoal({ plan: planOf(), states: {}, hist: [], mockHistory: [], today: '2026-12-14' }).wantDays,
    L.weekGoal({ plan: planOf(), states: {}, hist: [], mockHistory: [], today: '2027-01-18' }).wantDays], [3, 2, 2]);
  eq([L.weekGoal({ plan: null, states: {}, today: START }), L.weekGoal({ plan: planOf(), states: {}, today: '2027-01-25' })], [null, null]);
};

T['L6 獨立小檢核:每週 1 堂的第 4 堂、第 3 堂固定段交完、小檢核還沒做、到了第 5 堂建議日期(或第 5 堂開始了)、今天開得了;第 12 堂看第 15 堂;第 24 堂不出'] = () => {
  const p = planOf({ perWeek: [{ w: 1, n: 1 }] }), st = {};
  [1, 3].forEach((no) => { st[no] = stateOf(EE, no, sec(no === 1 ? START : '2026-11-09'), true); });
  const run = (states, today, packs, plan) => {
    const pk = packs || PACKS;
    const unlock = P.unlockState({ packs: pk, levels: EE, states, today, optional: L.optionalOf(plan || p) });
    return L.soloCheckpoint({ plan: plan || p, states, unlock, today, packs: pk, levels: EE });
  };
  eq([run(st, '2026-11-15'), run(st, '2026-11-16'), run(st, '2026-11-17')], [null, { no: 4, minutes: 18 }, { no: 4, minutes: 18 }]);
  eq(run(st, '2026-11-16', null, planOf()), null, '每週 2 堂不出');
  const cpDone = Object.assign({}, st, { 4: stateOf(EE, 4, sec('2026-11-16'), ['checkpoint']) });
  eq(run(cpDone, '2026-11-17'), null, '小檢核做過了');
  const started5 = Object.assign({}, st, { 5: stateOf(EE, 5, sec('2026-11-14'), []) });
  eq(run(started5, '2026-11-14', open24()), { no: 4, minutes: 18 }, '第 5 堂開始了就出');
  const busy = Object.assign({}, st, { 5: stateOf(EE, 5, sec('2026-11-16', 8), []), 6: stateOf(EE, 6, sec('2026-11-16', 9), []) });
  eq(run(busy, '2026-11-16', open24()), null, '今天開了 2 堂');
  const all = {};
  for (let no = 1; no <= 11; no++) all[no] = stateOf(EE, no, sec(START), true);
  const at12 = (today) => run(all, today, open24());
  eq([at12('2026-12-20'), at12('2026-12-21')], [null, { no: 12, minutes: 18 }], '第 12 堂看第 15 堂的建議日期(第 13 堂的建議日期還不出)');
};

/* ---------- 第 4 堂後的程度調整 ---------- */
/* 作答列:[區塊, 題 id, 小題, 選的, r, dt];r = 答對 1 ＋ 第一次 2 */
const row = (b, id, ok, first, sub) => [b, id, sub || 0, 0, (ok ? 1 : 0) + (first === false ? 0 : 2), 10];
function rowsOf(n, ok, part, b) {
  return Array.from({ length: n }, (_, i) => row(b === undefined ? 3 : b, (part <= 4 ? 'l' : 'p') + part + '-x' + i, i < ok));
}
const st = (a) => ({ v: 1, startedAt: NOW, doneAt: null, seg: {}, pk: {}, a });

T['L7 校正的答對率:只算第 2–4 堂固定段(含小檢核)與前測檢討、題庫題、第一次作答;聽力 Part 1–4、閱讀 Part 5–7,每個小題一題'] = () => {
  const s2 = st([row(3, 'l1-01', true), row(91, 'p5-a', true), row(80, 'l1-02', true), row(85, 'p5-b', false), row(87, 'l2-01', true), row(4, 'l2-02', true, false), row(5, '17', true), row(6, 'ga-1', true), row(97, 'l3-01', false, true, 2)]);
  const s3 = st([row(10, 'p6-a', false, true, 131), row(10, 'p6-a', true, true, 132), row(79, 'p7-c', true)]);
  const s1 = st([row(0, 'l1-09', true), row(1, 'p5-z', true)]);
  const r = L.calibrationRates({ 1: s1, 2: s2, 3: s3 });
  eq(r, { listening: { n: 2, ok: 1 }, reading: { n: 4, ok: 3 } });
  eq(L.calibrationRates({}), { listening: { n: 0, ok: 0 }, reading: { n: 0, ok: 0 } });
};

T['L8 升降:一科 ≥20 題才判,>80% 升、<45% 降,邊界不動;入門不降、高分不升;沒變也記一筆;來源只換有變的科;不改傳進來的物件'] = () => {
  const NOW_ISO = '2026-11-20T02:00:00.000Z';
  const prev = { listening: 'threshold', reading: 'threshold', source: { listening: 'score', reading: 'legacy' }, setAt: '2026-11-01T00:00:00.000Z', history: [{ at: '2026-11-01T00:00:00.000Z', listening: 'threshold', reading: 'threshold', reason: 'score' }] };
  const keep = frozen(prev);
  const rate = (n, ok) => ({ n, ok });
  const go = (l, r, p) => L.calibrateLevels(p || prev, { listening: l, reading: r }, NOW_ISO, E.ctx.ONBOARD_CORE.newLevels);
  const a = go(rate(20, 17), rate(20, 8));
  eq([a.levels.listening, a.levels.reading, a.levels.source, a.changed, a.levels.history.slice(-1)[0]],
    ['advanced', 'entry', { listening: 'calibrate', reading: 'calibrate' }, { listening: ['threshold', 'advanced'], reading: ['threshold', 'entry'] },
      { at: NOW_ISO, listening: 'advanced', reading: 'entry', reason: 'calibrate' }]);
  const b = go(rate(20, 16), rate(20, 9));
  eq([b.levels.listening, b.levels.reading, b.changed, b.levels.source, b.levels.history.length], ['threshold', 'threshold', { listening: null, reading: null }, prev.source, 2], '80%、45% 不動;沒變也記一筆');
  const c = go(rate(19, 19), rate(19, 0));
  eq([c.levels.listening, c.levels.reading], ['threshold', 'threshold'], '19 題不判');
  const edge = go(rate(30, 30), rate(30, 0), Object.assign({}, prev, { listening: 'high', reading: 'entry' }));
  eq([edge.levels.listening, edge.levels.reading, edge.changed], ['high', 'entry', { listening: null, reading: null }], '高分不升、入門不降');
  const d = go(rate(20, 17), rate(5, 0));
  eq(d.levels.source, { listening: 'calibrate', reading: 'legacy' });
  eq(frozen(prev), keep);
};

T['L8b 上課時的級別(taken)跟目前不一樣(上到一半改過):升降從上課時的級別算一級,目前已經在那個方向就不動;一樣時照 L8'] = () => {
  const NOW_ISO = '2026-11-20T02:00:00.000Z';
  const cur = { listening: 'threshold', reading: 'threshold', source: { listening: 'est', reading: 'est' }, setAt: '2026-11-10T00:00:00.000Z', history: [{ at: '2026-11-10T00:00:00.000Z', listening: 'threshold', reading: 'threshold', reason: 'est' }] };
  const keep = frozen(cur);
  const rate = (n, ok) => ({ n, ok });
  const go = (l, r, taken, p) => L.calibrateLevels(p || cur, { listening: l, reading: r }, NOW_ISO, E.ctx.ONBOARD_CORE.newLevels, taken);
  const up = go(rate(20, 18), rate(20, 18), { listening: 'entry', reading: 'entry' });
  eq([up.levels.listening, up.levels.reading, up.changed, up.levels.source], ['threshold', 'threshold', { listening: null, reading: null }, cur.source], '入門課答得好:升到門檻,目前已經是門檻,不跳到進階');
  const down = go(rate(20, 5), rate(20, 5), { listening: 'advanced', reading: 'advanced' });
  eq([down.levels.listening, down.levels.reading, down.changed], ['threshold', 'threshold', { listening: null, reading: null }], '進階課答不好:降到門檻,目前已經是門檻');
  const stay = go(rate(20, 12), rate(20, 12), { listening: 'entry', reading: 'entry' });
  eq([stay.levels.listening, stay.levels.reading, stay.changed], ['threshold', 'threshold', { listening: null, reading: null }], '答對率在中間:不把目前的改回上課時的級別');
  const back = go(rate(20, 5), rate(20, 18), { listening: 'advanced', reading: 'threshold' }, Object.assign({}, cur, { listening: 'high', reading: 'entry' }));
  eq([back.levels.listening, back.levels.reading, back.changed], ['threshold', 'advanced', { listening: ['high', 'threshold'], reading: ['entry', 'advanced'] }], '目前在相反方向:改成從上課時的級別算一級');
  const low = go(rate(20, 5), rate(20, 5), { listening: 'entry', reading: 'entry' });
  eq([low.levels.listening, low.levels.reading], ['threshold', 'threshold'], '入門課答不好:入門不降,也不把目前的門檻改回入門');
  const same = go(rate(20, 18), rate(20, 8), { listening: 'threshold', reading: 'threshold' });
  eq([same.levels.listening, same.levels.reading], ['advanced', 'entry'], '一樣時照 L8');
  eq(frozen(cur), keep);
};

T['L9 這一期做過沒有(levels.history 有 calibrate、時間在開始日當地 00:00 以後);畫面用的變動(比那一筆跟前一筆)'] = () => {
  const at = (d) => new Date(d + 'T00:00:00').toISOString();
  const h = [{ at: at('2026-10-01'), listening: 'entry', reading: 'entry', reason: 'calibrate' }, { at: at('2026-11-01'), listening: 'entry', reading: 'threshold', reason: 'score' },
    { at: at('2026-11-02'), listening: 'threshold', reading: 'threshold', reason: 'calibrate' }];
  const lv = { listening: 'threshold', reading: 'threshold', history: h };
  eq([L.calibrated(lv, START), L.calibrated(lv, '2026-11-03'), L.calibrated({ history: h.slice(0, 2) }, START), L.calibrated(null, START)], [true, false, false, false]);
  eq(L.calibration(lv, START), { changed: { listening: ['entry', 'threshold'], reading: null } });
  eq([L.calibration(lv, '2026-11-03'), L.calibration({ history: [h[2]] }, START)], [null, { changed: { listening: null, reading: null } }]);
};

T['L9c 程度檢測定的級別(est)之後調整:調整前後比 est 那一筆;之後又改了級別(est 或 manual,跟調整後不一樣)仍算本期做過,但不再顯示調整'] = () => {
  /* 原本斷言改回 est 之後變動照舊顯示,已經過時:課程總覽會寫「入門 → 門檻」,「我的」頁卻是入門,兩頁互相矛盾。
     現在只在目前的級別跟本期調整那一筆一樣時才顯示 */
  const at = (d) => new Date(d).toISOString();
  const e1 = { at: at('2026-10-30T09:00:00'), listening: 'threshold', reading: 'entry', reason: 'est' };
  const c1 = { at: at('2026-11-24T10:00:00'), listening: 'advanced', reading: 'entry', reason: 'calibrate' };
  const e2 = { at: at('2026-11-25T10:00:00'), listening: 'threshold', reading: 'entry', reason: 'est' };
  const m2 = Object.assign({}, e2, { reason: 'manual' }), same = Object.assign({}, e2, { listening: 'advanced' });
  const want = { changed: { listening: ['threshold', 'advanced'], reading: null } }, none = { changed: { listening: null, reading: null } };
  eq([L.calibrated({ history: [e1, c1] }, START), L.calibration({ history: [e1, c1] }, START)], [true, want]);
  eq([L.calibrated({ history: [e1, c1, e2] }, START), L.calibration({ history: [e1, c1, e2] }, START)], [true, none], '改回 est');
  eq([L.calibrated({ history: [e1, c1, m2] }, START), L.calibration({ history: [e1, c1, m2] }, START)], [true, none], '手動改');
  eq(L.calibration({ history: [e1, c1, same] }, START), want, '之後那一筆跟調整後一樣:照樣顯示');
  eq(L.calibration({ listening: 'threshold', reading: 'entry', history: [e1, c1] }, START), none, '目前的級別(最上層)跟調整後不一樣');
};

T['L9b 兩台(或兩個分頁)各記一筆本期的 calibrate、合併成兩筆:變動照第一筆跟它之前那一筆比'] = () => {
  const at = (d) => new Date(d).toISOString();
  const legacy = { at: at('2026-11-01T00:00:00'), listening: 'entry', reading: 'entry', reason: 'legacy' };
  const c1 = { at: at('2026-11-24T10:00:00'), listening: 'threshold', reading: 'threshold', reason: 'calibrate' };
  const c2 = Object.assign({}, c1, { at: at('2026-11-24T10:00:05') });
  eq(L.calibration({ history: [legacy, c1, c2] }, START), { changed: { listening: ['entry', 'threshold'], reading: ['entry', 'threshold'] } });
  const old = { at: at('2026-10-01T00:00:00'), listening: 'entry', reading: 'entry', reason: 'calibrate' };
  eq(L.calibration({ history: [old, c1, c2] }, START), { changed: { listening: ['entry', 'threshold'], reading: ['entry', 'threshold'] } }, '上一期的那一筆可以當比較的對象');
};

T['L10 js/lesson-plan.js 載入時不依賴其他檔、不讀寫儲存、不碰畫面'] = () => {
  const src = K.read('js/lesson-plan.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  eq(src.match(/\bdocument\b|localStorage|sessionStorage|\bstore\b|\bfetch\b|\bCLOUD\b/g) || [], []);
  assert.ok(K.bare('js/lesson-plan.js').LESSON_PLAN.withWeekly, '單獨載入');
  assert.ok(K.read('js/lesson-plan.js').split('\n').length <= 800);
};

K.run(T);
