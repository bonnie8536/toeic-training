/* 預估分數跟課程的銜接:第 1 堂前測的第一次作答寫進 fa_v1(來源 k)、前測紀錄 tests_v1 補回成同樣的列、
   程度檢測要避開的課程預留題(LESSON_DATA.placementReserve)、做過新檢測照樣做前測。
   vm 沙盒(tools/lesson_kit.js、tools/test_lesson_test.js 的假 DOM 與假共用元件),加載 js/estimate-core.js、js/estimate-data.js、
   data/item-params.js、js/estimate-store.js。不開瀏覽器、不連網。用法:node tools/test_estimate_course.js */
'use strict';
const assert = require('assert');
const K = require('./lesson_kit.js');
const LT = require('./test_lesson_test.js');

const { eq, EE, NOW } = K;
const EST_FILES = ['js/estimate-core.js', 'js/estimate-data.js', 'data/item-params.js', 'js/estimate-store.js'];
const plain = (x) => JSON.parse(JSON.stringify(x));

function env(opt) { return LT.domEnv(Object.assign({ files: EST_FILES }, opt || {})); }
/* 前測兩段都作答到交卷;choose(第幾小題, 選項數) 回選項 */
async function sitBoth(e, pc, choose) {
  const run = e.LT.run(pc);
  await LT.settle();
  await LT.answerAll(e, choose);
  e.host.querySelector('.lsn-go').click();
  await LT.settle();
  await LT.answerAll(e, choose);
  assert.equal(await run, 'done');
  await e.D.flush();
}
/* 進度裡的前測作答 → { 作答紀錄的鍵: 對錯 1/0 }(沒作答的不放) */
async function answeredKeys(e, pc) {
  const meta = new Map((await e.B.meta()).map((r) => [r.id, r]));
  const out = {};
  (pc.state().a || []).forEach((x) => {
    if (x[3] < 0) return;
    const k = e.C.itemKeys(e.C.partOfId(x[1]), meta.get(x[1]), x[1]).filter((y) => y.sub === (x[2] || 0))[0];
    out[k.key] = (x[4] & 1) === 1 ? 1 : 0;
  });
  return out;
}
const faOf = (e) => (e.store.peek('fa_v1') || { i: {} }).i;

const T = {};

T['前測每送出一畫面就把有作答的小題記進 fa_v1:來源 k、對錯照作答、日數是今天;題數跟作答一樣'] = async () => {
  const e = env();
  const pc = await LT.startTest(e);
  await sitBoth(e, pc, (i, n) => i % n);
  const want = await answeredKeys(e, pc), fa = faOf(e), day = e.ctx.ESTIMATE.dayNum(NOW * 1000);
  assert.ok(Object.keys(want).length >= 70, '前測有作答 ' + Object.keys(want).length + ' 題');
  eq(Object.keys(fa).sort(), Object.keys(want).sort());
  Object.keys(want).forEach((k) => eq(fa[k], [day, want[k], 'k'], k));
};

T['沒作答的小題不寫;fa_v1 原本有的題不覆蓋(來源不換成 k)、別的題留著'] = async () => {
  const e = env();
  const pc = await LT.startTest(e);
  const ids = pc.state().pk[1].ids, p5 = ids.filter((id) => /^p5-/.test(id));
  e.store.set('drill_p5', { [p5[0]]: { c: 0, ok: true, t: NOW * 1000 - 864e5 } });
  e.store.set('fa_v1', { v: 1, i: { [p5[1]]: [100, 0, 'p'], 'l2-99': [50, 1, 'l'] } });
  const run = e.LT.run(pc);
  await LT.settle();
  await LT.answerAll(e, () => 0);
  e.host.querySelector('.lsn-go').click();
  await LT.settle();
  e.UI.answers.push(true);
  LT.nextBtn(e).click();             // 閱讀第一畫面(P5 第一題)不作答,確認後下一題
  await LT.settle();
  await LT.answerAll(e, () => 0);
  assert.equal(await run, 'done');
  const fa = faOf(e);
  assert.ok(!(p5[0] in fa), '空白的第一題不寫');
  eq([fa[p5[1]], fa['l2-99']], [[100, 0, 'p'], [50, 1, 'l']]);
  assert.ok(p5.slice(2).every((id) => fa[id] && fa[id][2] === 'k'), '其他 P5 都寫成 k');
};

T['作答前練習紀錄已經有的題(不是第一次作答):不寫 k'] = async () => {
  const e = env();
  const pc = await LT.startTest(e);
  const p5 = pc.state().pk[1].ids.filter((id) => /^p5-/.test(id));
  e.store.set('drill_p5', { [p5[2]]: { c: 1, ok: false, t: NOW * 1000 - 864e5 } });
  await sitBoth(e, pc, () => 0);
  const fa = faOf(e);
  assert.ok(!(p5[2] in fa), '做過的題沒有寫成 k:' + JSON.stringify(fa[p5[2]]));
  assert.ok(fa[p5[3]] && fa[p5[3]][2] === 'k');
};

T['頁面沒載估分的資料層:前測照常做完,不寫 fa_v1、不丟錯'] = async () => {
  const e = LT.domEnv();
  const pc = await LT.startTest(e);
  await sitBoth(e, pc, () => 1);
  eq([e.store.peek('fa_v1'), typeof e.D.firstAttempts], [undefined, 'function']);
  eq(e.D.firstAttempts([{ key: 'p5-x', c: 0, ok: true, f: true }], 'k'), 0);
};

T['補回:只有 tests_v1(別台做的前測)時,ESTIMATE_STORE 補回的列跟前測當場寫的一樣(key、對錯、來源 k、日數)'] = async () => {
  const e = env();
  const pc = await LT.startTest(e);
  await sitBoth(e, pc, (i, n) => (i * 3) % n);
  const live = faOf(e), tests = e.store.peek('tests_v1');
  assert.ok(tests && tests.t1 && tests.t1.pre && tests.t1.pre.items.length > 0, '有 tests_v1');
  const other = env();
  other.store.set('tests_v1', tests);
  const view = other.ctx.ESTIMATE_STORE.refresh({ now: NOW * 1000 });
  eq(faOf(other), live);
  eq([view.ok, view.stats.k], [true, Object.keys(live).length]);
};

T['ESTIMATE_STORE.recordMany 失敗(丟錯)時,前測照樣寫進度,不丟錯'] = async () => {
  const e = env();
  e.ctx.ESTIMATE_STORE = { recordMany: () => { throw new Error('壞了'); } };
  const pc = await LT.startTest(e);
  await sitBoth(e, pc, () => 0);
  assert.ok((pc.state().a || []).length > 70);
  assert.ok(e.logs.warn.some((w) => /第一次作答紀錄/.test(String(w[0]))));
};

/* ---------- 預留題 ---------- */
T['預留題:沒有上課進度回 [];訪客回 [];不寫任何鍵'] = async () => {
  const e = env();
  e.store.set('levels', { listening: 'entry', reading: 'entry' });
  const before = e.store.sets.length;
  eq(await e.D.placementReserve(), []);
  const g = env({ user: null });
  g.store.set('levels', { listening: 'entry', reading: 'entry' });
  eq(await g.D.placementReserve(), []);
  eq(e.store.sets.length, before);
};

T['預留題:上到第 2 堂(還沒上完)= 第 1 堂之後兩次小檢核的那一份(PACK_CORE.reserveFor 回的 ids);第 2 堂上完一樣;跟 PACK_CORE.reserveFor、課程選題的預留題相同'] = async () => {
  const e = env();
  e.store.set('levels', { listening: 'entry', reading: 'entry' });
  const l1 = e.lesson(EE, 1), l2 = e.lesson(EE, 2);
  e.store.set('les_t1_01', Object.assign(e.P.newState(l1, NOW), { doneAt: NOW }));
  e.store.set('les_t1_02', e.P.newState(l2, NOW));
  const got = await e.D.placementReserve();
  const want = (await e.P.reserveFor(K.PACKS, EE, 1, { account: K.CPID, pool: K.POOL.ids, bank: e.B })).ids;
  assert.ok(got.length > 0, '有預留題');
  eq(got, want);
  await e.D.packs();
  eq(got, (await e.D.ctx(l2, NOW).reserve()).ids, '跟第 2 堂課程選題避開的一樣');
  e.store.set('les_t1_02', Object.assign(e.P.newState(l2, NOW), { doneAt: NOW }));
  eq(await e.D.placementReserve(), (await e.P.reserveFor(K.PACKS, EE, 2, { account: K.CPID, pool: K.POOL.ids, bank: e.B })).ids);
};

T['預留題:給 ESTIMATE.available 用時,預留的題組不會被選到;開關關著(reserveOn false)照常可選'] = async () => {
  const e = env();
  e.store.set('levels', { listening: 'entry', reading: 'entry' });
  e.store.set('les_t1_01', e.P.newState(e.lesson(EE, 1), NOW));
  const reserve = await e.D.placementReserve(), E = e.ctx.ESTIMATE, params = e.ctx.ITEM_PARAMS;
  const p5 = reserve.filter((id) => /^p5-/.test(id) && Number.isFinite(params.b[id]));
  assert.ok(p5.length > 0, '有 P5 預留題');
  const units = p5.map((id) => ({ id, part: '5', keys: [id] }));
  eq(E.available({ units, part: '5', params, fa: null, used: [], reserve, reserveOn: true }).length, 0);
  eq(E.available({ units, part: '5', params, fa: null, used: [], reserve, reserveOn: false }).length, units.length);
};

/* ---------- 做過新檢測的人 ---------- */
T['做過程度檢測(placement_v1 有做完的一次、fa_v1 有 t):第 1 堂照樣是前測,組卷與作答照舊,前測題記成 k'] = async () => {
  const e = env();
  const at = new Date(NOW * 1000 - 3600e3).toISOString();
  e.store.set('placement_v1', { v: 1, runs: [{ at, end: at, ip: 'ip1', cv: 'c1', sec: 'LR', tm: { L: [at, at], R: [at, at] }, items: [], res: {} }] });
  e.store.set('fa_v1', { v: 1, i: { 'p5-zz-01': [320, 1, 't'] } });
  const l1 = e.lesson(EE, 1);
  eq([l1.kind, l1.segments.map((s) => s.slot).slice(0, 2)], ['test', ['test_listening', 'test_reading']]);
  const pc = await LT.startTest(e);
  eq([pc.state().pk[0].ids.length, pc.state().pk[1].ids.length], [22, 21]);
  await sitBoth(e, pc, () => 0);
  const fa = faOf(e);
  eq(fa['p5-zz-01'], [320, 1, 't']);
  assert.ok(Object.values(fa).filter((x) => x[2] === 'k').length > 70);
  eq(plain(e.store.peek('placement_v1')).runs.length, 1, '檢測紀錄不動');
};

/* ---------- 執行 ---------- */
(async () => {
  let pass = 0, fail = 0;
  for (const name of Object.keys(T)) {
    try {
      await T[name]();
      pass++;
      console.log('PASS ' + name);
    } catch (e) {
      fail++;
      console.log('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n  ') : e));
    }
  }
  console.log('\n' + pass + ' 通過,' + fail + ' 失敗');
  process.exit(fail ? 1 : 0);
})();
