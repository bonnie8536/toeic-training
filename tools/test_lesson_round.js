/* 上課頁(js/lesson.js)的題庫回合與幾處容易靜默寫錯的地方:第一次作答(作答紀錄、學習記錄、英語耳、文法單元)、時間單位、
   交卷回合排錯題、小檢核的檢核回合只寫進度、開頁補判、帳號資料夾不能寫時不寫任何鍵、第 1 堂總覽的剩餘分鐘、每堂進度鍵的最壞大小。
   假頁面環境用 tools/test_lesson_flow.js 的(假的共用元件與練習引擎、真的 pack-core、lesson-rules、學習包、題庫)。
   不開瀏覽器、不連網。用法:node tools/test_lesson_round.js */
'use strict';
const vm = require('vm');
const assert = require('assert');
const K = require('./lesson_kit.js');
const F = require('./test_lesson_flow.js');
const { eq, NOW, DAY, EE, TE } = K;
const { page, partial, stateOf, mark, allSlots, doneThrough, started, lesson3, settle } = F;
const real = (files) => (ctx) => files.forEach((f) => vm.runInContext(K.read(f), ctx, { filename: f }));
const metaRow = (e, id) => e.ctx.BANK_META.items.filter((r) => r.id === id)[0];
/* 區塊 idx 凍結的題全部作答(題組每個小題一列) */
function answerAll(e, s, idx, ok, t) {
  const C = e.ctx.LESSON_CORE;
  return s.pk[idx].ids.reduce((a, id) => C.itemKeys(C.partOfId(id), metaRow(e, id), id)
    .reduce((b, k) => e.P.answer(b, { b: idx, id, sub: k.sub, c: ok ? 0 : 1, ok: !!ok, f: true, t }), a), s);
}

const T = {};

/* ---------- 第一次作答與時間單位 ---------- */
T['第一次作答:30 天前的作答紀錄不算這一段答過、照樣出題;回合開始前做過的(作答紀錄,或錯題本訂正後只剩學習記錄)補回與交卷都不是第一次;作答列的時間是秒'] = async () => {
  let A, B, C;
  const p = await page({ seed: async (e) => {
    await lesson3(['vocab'])(e);
    const pk = e.store.peek('les_t1_03').pk, old = (NOW - 30 * DAY) * 1000;
    [A, B] = pk[4].ids; C = pk[5].ids[0];
    e.store.set('listen_p1', { [A]: { c: 0, ok: true, t: old } });
    e.store.set('listen_p2', { [C]: { c: 0, ok: true, t: old } });
    e.store.set('hist', [{ m: 'l1', id: A, c: 0, ok: true, t: old }, { m: 'l1', id: B, c: 1, ok: false, t: old + 1000 }]);
  } });
  await p.click('.lsn-go');
  await p.click('.lsn-go');
  const a = p.last('LISTEN');
  eq([a.units.map((u) => u.item.id).slice(0, 3), p.les(3).a.filter((x) => x[0] === 4 || x[0] === 5).length], [[A, B, C], 0], '30 天前的紀錄不算這一段答過');
  partial(p, a, 1);
  await p.click(p.dom.querySelector('.quiz-close'));
  eq(p.les(3).a.filter((x) => x[0] === 4).map((x) => [x[1], x[4] & 2]), [[A, 0]], '中途離開補回:回合開始前做過,不是第一次');
  await p.click('.lsn-go');
  await p.finish(p.last('LISTEN'));
  const rows = p.les(3).a.filter((x) => x[0] === 4 || x[0] === 5), f = (id) => rows.filter((x) => x[1] === id).map((x) => x[4] & 2);
  eq([f(B), f(C), rows.filter((x) => [A, B, C].indexOf(x[1]) < 0).every((x) => (x[4] & 2) === 2), rows.every((x) => x[5] >= 0 && x[5] < 86400)],
    [[0], [0], true, true], '交卷:學習記錄有、作答紀錄有的都不是第一次;dt 是秒');
  eq((((p.e.store.peek('pts') || {})['P1.photo'] || {}).hits || []).filter((h) => h.b === 'les_t1_03:4'), [], 'P1 兩題都不是第一次:不記考點');
};
T['第一次作答:英語耳開始前做過的題、文法單元開始前做過的單元都不是第一次'] = async () => {
  let first;
  const q = await page({ search: '?no=2', seed: async (e) => {
    await doneThrough(e, EE, 1); await started(e, EE, 2, ['test_review', 'vocab']);
    first = e.store.peek('les_t1_02').pk[2].ids[0];
    e.store.set('ear_d', { [first]: { ok: 1, t: (NOW - DAY) * 1000 } });
  } });
  await q.click('.lsn-go');
  const ear = q.last('EAR'), ids = ear.opts.items;
  ear.f.leave();
  ear.opts.onDone({ score: ids.length, total: ids.length, items: ids.map((id) => ({ m: 'ear_d', id, sub: null, key: id, c: 'typed', ok: true })) });
  await settle();
  eq(q.les(2).a.filter((x) => x[0] === 2).map((x) => (x[4] & 2) === 2), ids.map((id) => id !== first));
  const p = await page({ seed: async (e) => { await lesson3(['vocab', 'listening'])(e); e.store.set('grammar_done', { 'gf-01': { ok: 1, t: 1, at: null } }); } });
  await p.click('.lsn-go');
  await p.click('.lsn-go');
  const g = p.last('GRAMMAR'), unit = p.ctx.TOEIC.grammar.filter((u) => u.id === 'gf-01')[0];
  g.opts.onDone({ score: unit.quiz.length, total: unit.quiz.length, items: unit.quiz.map((x, qi) => ({ m: 'g', id: 'gf-01', sub: qi + 1, key: 'gf-01:' + qi, c: x.answer, ok: true })) });
  await settle();
  const rows = p.les(3).a.filter((x) => x[0] === 9);
  eq([rows.length > 0, rows.every((x) => (x[4] & 2) === 0)], [true, true]);
};
/* ---------- 交卷回合與小檢核 ---------- */
T['交卷回合:進度裡已經有的錯題(重出的回合又答錯)不再排回顧,其他答錯的排'] = async () => {
  let X;
  const p = await page({ seed: async (e) => {
    const done = (s) => answerAll(e, answerAll(e, s, 4, true, NOW - 3000), 5, true, NOW - 3000);   // 即時回合(區塊 4、5)做完
    await lesson3(['vocab'], (s) => { X = s.pk[7].ids[0]; return e.P.answer(done(s), { b: 7, id: X, sub: 0, c: 1, ok: false, f: true, t: NOW - 3000 }); })(e);
  } });
  await p.click('.lsn-go');
  eq([p.text('.lsn-card-h'), p.calls.length], ['Part 2、Part 1', 0], '技巧卡與即時回合都做過,直接到過場');
  await p.click('.lsn-go');
  const b = p.last('LISTEN');
  eq(b.units.some((u) => u.item.id === X), true, '沒答完:整回合重出');
  await p.finish(b, () => false);
  const q = p.e.store.peek('rvq');
  eq([q.some((x) => x.id === X), q.filter((x) => x.m === 'p2' || x.m === 'p1').length > 0], [false, true]);
};
T['小檢核的檢核回合(真的 js/lesson-personal.js):交卷時只寫進度、不記考點不排回顧;兩個回合都交卷後才判,考點那一批有判定、答錯的排回顧'] = async () => {
  const p = await page({ search: '?no=4', before: real(['js/lesson-items.js', 'js/lesson-personal.js']), seed: async (e) => { await doneThrough(e, EE, 3, NOW - 2 * DAY); await started(e, EE, 4, ['vocab']); } });
  await p.click('.lsn-go');
  eq([p.text('.lsn-h2'), !!p.$('.lsn-intro .lsn-go')], ['小檢核', true]);
  await p.click('.lsn-intro .lsn-go');
  await p.finish(p.last('LISTEN'), (i) => i % 2 === 0);
  const mine = () => Object.values(p.e.store.peek('pts') || {}).reduce((a, x) => a.concat((x.hits || []).filter((h) => /^les_t1_04/.test(h.b || ''))), []);
  eq([mine(), p.e.store.peek('rvq'), p.text('.lsn-h2')], [[], undefined, '閱讀'], '第一個檢核回合交卷:只寫進度');
  await p.click('.lsn-intro .lsn-go');
  await p.finish(p.last('DRILL'), (i) => i % 2 === 0);
  await settle();
  await p.e.D.flush();
  const hits = mine();
  eq([hits.length > 0, hits.every((h) => h.b === 'les_t1_04:cp' && /^[mhw]$/.test(h.v)), (p.e.store.peek('rvq') || []).some((x) => !x.k)], [true, true, true], '兩個回合都交卷:一批小檢核、每個考點有判定、答錯的排回顧');
};

T['開頁補判:小檢核兩個回合都交卷、還沒判就關頁,重開上課頁時補判一次(考點那一批有判定)'] = async () => {
  const p = await page({ search: '?no=4', before: real(['js/lesson-items.js', 'js/lesson-personal.js']), seed: async (e) => {
    await doneThrough(e, EE, 3, NOW - 2 * DAY);
    await started(e, EE, 4, ['vocab'], (s, lesson) => lesson.segments.filter((x) => x.slot === 'checkpoint')[0].blocks.filter((b) => !b.fill)
      .reduce((a, b) => answerAll(e, a, b.idx, b.idx % 2 === 0, NOW - 600), s));
  } });
  await p.e.D.flush();
  const hits = Object.values(p.e.store.peek('pts') || {}).reduce((a, x) => a.concat((x.hits || []).filter((h) => h.b === 'les_t1_04:cp')), []);
  eq([hits.length > 0, hits.every((h) => /^[mhw]$/.test(h.v)), !!p.$('.lsn-steps')], [true, true, true]);
};

/* ---------- 帳號資料夾不能寫 ---------- */
T['帳號資料夾不能寫:總覽的「開始」、過場的「開始」被擋下時不寫任何鍵、不呼叫引擎'] = async () => {
  let blocked = true;
  const hold = (ctx) => { ctx.holdForAccount = () => blocked; };
  const a = await page({ seed: lesson3(), before: hold });
  const n = a.e.store.sets.length;
  await a.click('.lsn-go');
  eq([a.e.store.sets.length, a.les(3), a.calls.length, !!a.$('.lsn-steps')], [n, undefined, 0, true], '按開始');
  blocked = false;
  const b = await page({ before: hold, seed: async (e) => { await lesson3(['vocab'], (s) => answerAll(e, answerAll(e, s, 4, true, NOW - 3000), 5, true, NOW - 3000))(e); } });
  await b.click('.lsn-go');
  eq([b.text('.lsn-card-h'), b.calls.length], ['Part 2、Part 1', 0], '到過場');
  blocked = true;
  const m = b.e.store.sets.length, rows = b.les(3).a.length;
  await b.click('.lsn-go');
  eq([b.e.store.sets.length, b.calls.length, b.les(3).a.length], [m, 0, rows], '按過場的開始');
};

/* ---------- 第 1 堂總覽的剩餘分鐘 ---------- */
T['第 1 堂總覽:聽力作答中,「剩幾分鐘」用最後一題的作答時間(進度開始時間加上 dt)算'] = async () => {
  const p = await page({ search: '?no=1', seed: async (e) => {
    const x = await stateOf(e, EE, 1, NOW - 600);
    let s = e.P.setSegment(x.s, x.lesson, 'test_listening', 'doing', NOW - 600);
    s = e.P.answer(s, { b: 0, id: s.pk[0].ids[0], sub: 0, c: 1, ok: true, f: true, t: NOW - 300 });
    e.store.set('les_t1_01', s);
  } });
  const C = p.ctx.LESSON_CORE, n = p.les(1).pk[0].ids.reduce((a, id) => a + (/^l[12]-/.test(id) ? 1 : metaRow(p.e, id).size), 0);
  eq(p.$$('.lsn-step-min')[0].textContent, '剩 ' + Math.ceil((C.testLimit('test_listening', n) - 300) / 60) + ' 分鐘');
};

/* ---------- 每堂進度鍵的最壞大小 ---------- */
/* 個人段最多放得下的:回顧 6–8 分鐘,錯題重做 P6 一小題 60 秒,最多 8 組(引擎整組出、整組作答);
   弱點補練 11–14 分鐘,P2 一題 35 秒,最多 24 題(兩個考點各 12 題);第 2 堂前測檢討 P2 7 題、P5 7 題加兩張技巧卡;
   固定段全部作答(文法單元照小試身手的題數);作答時間 7 位數 */
T['每堂進度鍵最壞情況:第 2–4 堂固定段與個人段都放到最多、全部作答,作答時間 7 位數 ≤ 5,120 位元組、不用刪作答'] = async () => {
  const e = K.env({ bank: true });
  await e.D.packs();
  const rows = await e.B.meta();
  const big = (part, n) => rows.filter((r) => r.part === part).slice().sort((a, b) => (b.size || 1) - (a.size || 1)).slice(0, n).map((r) => r.id);
  const C = e.ctx.LESSON_CORE, T0 = NOW, T1 = NOW + 1234567, out = [];
  const grammarSubs = (id) => (e.ctx.TOEIC.grammar.filter((u) => u.id === id)[0] || { quiz: [] }).quiz.map((q, i) => i + 1);
  /* 一題寫幾列:題庫照真的題目(P6 的小題號是題號),文法單元照小試身手的題數,技巧卡不寫,其他(單字、英語耳)一列 */
  const subsOf = async (id) => {
    if (metaRow(e, id)) return C.itemKeys(C.partOfId(id), (await e.B.get([id]))[0], id).map((k) => k.sub);
    return /^tip-/.test(id) ? [] : /^g[a-z]-\d/.test(id) ? grammarSubs(id) : [0];
  };
  for (const lv of [EE, K.TT, TE, K.ET]) {
    for (let no = 2; no <= 4; no++) {
      const lesson = e.lesson(lv, no);
      let s = (await e.P.pickFixed(lesson, e.P.newState(lesson, T0), e.D.ctx(lesson, T0))).state;
      const seg = (slot) => lesson.segments.filter((x) => x.slot === slot)[0];
      const redo = big('6', Math.min(seg('review').maxUnits || 12, Math.floor(seg('review').minutes * 60 / 60)));
      const half = Math.floor(seg('weak').minutes * 60 / 2 / 35);
      s = e.P.freeze(s, 80, redo, T1, { r: 'review', sub: redo.map(() => 1), m: redo.map(() => 'p6') });
      [85, 86].forEach((idx, i) => { s = e.P.freeze(s, idx, big('2', 2 * half).slice(i * half, (i + 1) * half), T1, { r: 'point', m: 'p2', k: 'P2.wh' }); });
      if (no === 2) {
        s = e.P.freeze(s, 90, ['tip-P2-response'], T1, { r: 'test_review', m: 'tip', p: '2' });
        s = e.P.freeze(s, 91, big('2', 31).slice(24), T1, { r: 'test_review', m: 'p2', p: '2' });
        s = e.P.freeze(s, 92, ['tip-P5-pos'], T1, { r: 'test_review', m: 'tip', p: '5' });
        s = e.P.freeze(s, 93, big('5', 7), T1, { r: 'test_review', m: 'p5', p: '5' });
      }
      for (const i of Object.keys(s.pk).map(Number)) {
        for (const id of s.pk[i].ids) {
          for (const sub of await subsOf(id)) s = e.P.answer(s, { b: i, id, sub, c: 1, ok: false, f: true, t: T1 });
        }
      }
      s = mark(e, lesson, s, allSlots(lesson), 'done', T1 + 60);
      const fit = e.P.fitLesson(s, lesson);
      out.push([e.P.sizeOf(s), fit.trimmed, fit.over]);
    }
  }
  const max = Math.max(...out.map((x) => x[0]));
  eq([max <= 5120, out.every((x) => x[1] === 0 && x[2] === false)], [true, true], JSON.stringify(out));
  return '最大 ' + max + ' 位元組';
};

/* 有一支在等永遠不會回來的 Promise 時,node 會在印出通過數之前就結束:算失敗 */
process.on('beforeExit', () => { console.log('FAIL 有一支測試一直沒有結束'); process.exit(1); });
K.run(T);
