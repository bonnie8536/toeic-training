/* 小檢核的預留題(js/pack-core.js 的 reserveFor 與選題的補題順序):每一次小檢核各算一份、互不重疊;練習避開之後兩次的預留題,
   題不夠時先用遠的那一份、最後才用近的那一份;考點回顧另有順序;弱點補練只避開不補;小檢核本身先避開之後兩次的預留題。
   做過聽力短測的學生(onboard.listen.ids)那 8 題當前測題。有進度的堂照那份進度自己的級別判斷能不能上。
   node + vm(tools/lesson_kit.js):真的學習包、題目索引、js/pack-core.js、js/lesson-data.js;不開瀏覽器、不連網。
   用法:node tools/test_pack_reserve.js */
'use strict';
const assert = require('assert');
const K = require('./lesson_kit.js');
const { eq, plain, PACKS, NOW, EE, TT, TE, ET } = K;

const E = K.env();
const P = E.P, B = E.B, U = E.ctx.PACK_UTIL;
const POOL = K.POOL.ids;
const META = new Map(E.ctx.BANK_META.items.map((r) => [r.id, r]));
const COMBOS = [EE, TT, TE, ET];
const ACC = 'c7c1d2e3f4a5b4c6d8e9f0a1b2c3d4e5f';
const ACCOUNTS = [ACC, 'c5a0c1e2d3b4a4c5d8e6f7a8b9c0d1e2f', 'c0f1e2d3c4b5a49698877665544332211'];
/* 改之前的 reserveFor(第 2 堂 → 第 4 堂那一份):[題數, 題 id 用逗號接起來的 hash32];鍵是「聽讀級別的開頭字母|帳號」 */
const BEFORE = {
  'ee|c7c1d2e3f4a5b4c6d8e9f0a1b2c3d4e5f': [20, 3603023490], 'ee|c5a0c1e2d3b4a4c5d8e6f7a8b9c0d1e2f': [20, 111918193], 'ee|c0f1e2d3c4b5a49698877665544332211': [20, 3009219850],
  'tt|c7c1d2e3f4a5b4c6d8e9f0a1b2c3d4e5f': [25, 3589912264], 'tt|c5a0c1e2d3b4a4c5d8e6f7a8b9c0d1e2f': [25, 1392165023], 'tt|c0f1e2d3c4b5a49698877665544332211': [25, 2114563014],
  'te|c7c1d2e3f4a5b4c6d8e9f0a1b2c3d4e5f': [20, 2365785647], 'te|c5a0c1e2d3b4a4c5d8e6f7a8b9c0d1e2f': [20, 246229127], 'te|c0f1e2d3c4b5a49698877665544332211': [20, 2863151630],
  'et|c7c1d2e3f4a5b4c6d8e9f0a1b2c3d4e5f': [25, 1822214015], 'et|c5a0c1e2d3b4a4c5d8e6f7a8b9c0d1e2f': [25, 4233500961], 'et|c0f1e2d3c4b5a49698877665544332211': [25, 2124996082],
};
const tag = (lv) => lv.listening[0] + lv.reading[0];
const print = (ids) => [ids.length, U.hash32(ids.join(','))];

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const words = (week) => Array.from({ length: 25 }, (_, i) => String((week - 1) * 25 + i + 1));
function ctxOf(extra) {
  return Object.assign({ bank: B, records: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} }, seen: [], ear: E.ctx.TOEIC.ear, earRecords: {}, weekWords: words, random: rng(7), now: NOW }, extra || {});
}
const reserveOf = (lv, no, account) => P.reserveFor(PACKS, lv, no, { account: account === undefined ? ACC : account, pool: POOL, bank: B });
const cpBlocks = (l) => l.segments.filter((s) => s.slot === 'checkpoint')[0].blocks.filter((b) => !b.fill);
const bankBlocks = (l) => [].concat(...l.segments.map((s) => (s.blocks || []).map((b) => Object.assign({ slot: s.slot }, b)))).filter((b) => /^p[1-7]$/.test(b.module));
const ofPart = (ids, part) => ids.filter((id) => META.get(id) && META.get(id).part === part);
const allOfPart = (part) => E.ctx.BANK_META.items.filter((r) => r.part === part).map((r) => r.id);
/* 除了 keep 以外,這個 Part 的題全部凍結在用不到的區塊 79(選題一律避開凍結過的題) */
const squeeze = (l, part, keep) => P.freeze(P.newState(l, NOW), 79, allOfPart(part).filter((id) => keep.indexOf(id) < 0), NOW);

/* 一份預留題對上第 at 堂的檢核區塊:題數、不重複、在清單內、Part 與類別合乎那個區塊 */
function fitsBlocks(lv, at, a) {
  const l = P.compose(PACKS, lv, at);
  assert.equal(a.length, cpBlocks(l).reduce((s, x) => s + x.count, 0), '第 ' + at + ' 堂檢核區塊的題數');
  assert.equal(new Set(a).size, a.length, '不重複');
  let k = 0;
  cpBlocks(l).forEach((blk) => {
    const lw = blk.select.legacyWhere || {};
    a.slice(k, k + blk.count).forEach((id) => {
      const m = META.get(id);
      assert.ok(POOL.indexOf(id) > -1, id + ' 不在清單');
      assert.equal(m.part, blk.module.slice(1), id);
      if (lw.category) assert.ok(lw.category.indexOf(m.category) > -1, id + ' 類別');
      if (lw.difficulty) assert.ok(lw.difficulty.indexOf(m.difficulty) > -1, id + ' 難度');
    });
    k += blk.count;
  });
}
const disjoint = (a, b) => a.filter((id) => b.indexOf(id) > -1);

const T = {};

T['R1 第 1–3 堂避開第 4、8 堂兩份,第 4–7 堂避開第 8、12 堂兩份;同一份不管從哪一堂算都一樣'] = async () => {
  for (const lv of COMBOS) {
    const r1 = await reserveOf(lv, 1), r3 = await reserveOf(lv, 3), r4 = await reserveOf(lv, 4), r5 = await reserveOf(lv, 5), r7 = await reserveOf(lv, 7);
    eq([r1, r3, r4, r5].map((r) => r.ids), [r1, r3, r4, r5].map((r) => r.near.concat(r.far)), 'ids 是兩份接起來');
    eq([r3.near, r3.far], [r1.near, r1.far], '第 1、3 堂一樣');
    eq([r5.near, r7.near, r4.near], [r1.far, r1.far, r1.far], '第 8 堂那一份:第 1 堂算的(遠)跟第 4、5、7 堂算的(近)一樣');
    eq([r5.far, r7.far], [r4.far, r4.far]);
    assert.ok(r1.near.length && r1.far.length && r4.far.length, tag(lv) + ' 三份都不是空的');
  }
  return '四種級別組合';
};

T['R2 第 4、8、12 堂三份兩兩不重疊、都合乎各自區塊的條件;第 4 堂那一份跟改之前逐題相同'] = async () => {
  let n = 0;
  for (const lv of COMBOS) {
    for (const acc of ACCOUNTS) {
      const a = await reserveOf(lv, 2, acc), b = await reserveOf(lv, 6, acc);
      const r4 = a.near, r8 = a.far, r12 = b.far;
      eq([disjoint(r4, r8), disjoint(r4, r12), disjoint(r8, r12)], [[], [], []], tag(lv) + ' ' + acc);
      fitsBlocks(lv, 4, r4); fitsBlocks(lv, 8, r8); fitsBlocks(lv, 12, r12);
      eq(print(r4), BEFORE[tag(lv) + '|' + acc], tag(lv) + ' ' + acc + ' 第 4 堂那一份');
      n++;
    }
  }
  return n + ' 個帳號與級別';
};

T['R3 第 20–23 堂只有第 24 堂那一份(遠的是空的);第 24 堂兩份都空;訪客、沒有清單沒有預留'] = async () => {
  for (const no of [20, 21, 22, 23]) {
    const r = await reserveOf(TT, no);
    assert.ok(r.near.length > 0 && r.far.length === 0 && r.ids.length === r.near.length, '第 ' + no + ' 堂');
  }
  const empty = { ids: [], near: [], far: [] };
  eq([await reserveOf(TT, 24), await reserveOf(TT, 2, null), await reserveOf(TT, 2, ''), await P.reserveFor(PACKS, TT, 2, { account: ACC, bank: B })], [empty, empty, empty, empty]);
  eq([await P.reserved({ reserve: ['x'] }), await P.reserved({ reserve: () => Promise.resolve({ ids: ['a', 'b'], near: ['a'], far: ['b'] }) }), await P.reserved({})], [['x'], ['a', 'b'], []]);
  return 'ok';
};

T['R4 固定段題不夠時先用遠的那一份,遠的用完才用近的'] = async () => {
  const l = P.compose(PACKS, TT, 3), hold = await reserveOf(TT, 3);
  const p1 = bankBlocks(l).filter((b) => b.module === 'p1'), want = p1.reduce((a, b) => a + b.count, 0);
  const farP1 = ofPart(hold.far, '1'), nearP1 = ofPart(hold.near, '1');
  const used = (r) => p1.reduce((a, b) => a.concat(r.state.pk[b.idx].ids), []);
  const a = used(await P.pickFixed(l, squeeze(l, '1', hold.ids), ctxOf({ reserve: hold })));
  assert.ok(a.length === Math.min(want, farP1.length + nearP1.length), '選到 ' + a.length);
  eq([disjoint(a, farP1).length, disjoint(a, nearP1).length], [Math.min(want, farP1.length), Math.max(0, Math.min(want, farP1.length + nearP1.length) - farP1.length)], '先遠後近');
  const b = used(await P.pickFixed(l, squeeze(l, '1', nearP1), ctxOf({ reserve: hold })));
  assert.ok(b.length === Math.min(want, nearP1.length) && b.every((id) => nearP1.indexOf(id) > -1), '只剩近的時用近的');
  return '照片描述要 ' + want + ' 題、遠 ' + farP1.length + '、近 ' + nearP1.length;
};

T['R5 考點回顧:沒做過的非預留題 → 遠的預留題 → 14 天內做過的 → 近的預留題'] = async () => {
  const l = P.compose(PACKS, TT, 3), hold = await reserveOf(TT, 3);
  const farP1 = ofPart(hold.far, '1'), nearP1 = ofPart(hold.near, '1');
  const free = allOfPart('1').filter((id) => hold.ids.indexOf(id) < 0);
  const seenIds = free.slice(0, 5), fresh = free.slice(5, 10);
  const units = [{ k: 'P1.photo', due: '2026-11-24', step: 7 }];
  const run = async (keep) => (await P.pickReview(l, squeeze(l, '1', keep), units, ctxOf({ reserve: hold, seen: seenIds }))).state.pk[81].ids;
  const a = await run(hold.ids.concat(seenIds, fresh));
  assert.ok(a.length === 3 && a.every((id) => fresh.indexOf(id) > -1), '有沒做過的新題就用:' + a);
  assert.ok(farP1.length >= 3, '遠的那一份照片描述夠 3 題');
  const b = await run(hold.ids.concat(seenIds));
  assert.ok(b.length === 3 && b.every((id) => farP1.indexOf(id) > -1), '沒有新題先用遠的預留題:' + b);
  const c = await run(nearP1.concat(seenIds));
  assert.ok(c.length === 3 && c.every((id) => seenIds.indexOf(id) > -1), '再來是 14 天內做過的:' + c);
  const d = await run(nearP1);
  assert.ok(d.length === Math.min(3, nearP1.length) && d.every((id) => nearP1.indexOf(id) > -1), '最後才用近的:' + d);
  return 'ok';
};

T['R6 弱點補練只避開、不補:只剩預留題時選 0 題,need 記下來'] = async () => {
  const l = P.compose(PACKS, TT, 3), hold = await reserveOf(TT, 3);
  const plans = [{ key: 'P1.photo', part: '1', track: 'listening', seconds: 300, reason: 'weak:P1.photo', base: null }];
  const w = await P.pickWeak(l, squeeze(l, '1', hold.ids), plans, ctxOf({ reserve: hold }));
  eq([w.blocks.map((b) => b.ids.length), w.need], [[0], [{ idx: 85, module: 'p1', want: E.R.weakCount(plans[0]), got: 0, relaxed: false }]]);
  return 'ok';
};

T['R7 小檢核的檢核區塊:清單內非預留題夠時不選預留題;不夠時才選,選到的都在清單內、沒做過'] = async () => {
  const l = P.compose(PACKS, TT, 4), hold = await reserveOf(TT, 4);
  const base = { checkpointPool: POOL, reserve: hold };
  const a = await P.pickFixed(l, P.newState(l, NOW), ctxOf(base));
  cpBlocks(l).forEach((blk) => {
    const ids = a.state.pk[blk.idx].ids;
    assert.ok(ids.length === blk.count && ids.every((id) => hold.ids.indexOf(id) < 0 && POOL.indexOf(id) > -1), blk.blockId + ' 不選預留題');
  });
  const p1 = cpBlocks(l).filter((x) => x.module === 'p1')[0];
  const done = {};
  POOL.filter((id) => /^l1-/.test(id) && hold.ids.indexOf(id) < 0).forEach((id) => { done[id] = { ok: true, t: 1 }; });
  ofPart(hold.ids, '1').slice(0, 2).forEach((id) => { done[id] = { ok: true, t: 1 }; });
  const d = await P.pickFixed(l, P.newState(l, NOW), ctxOf(Object.assign({}, base, { records: { 1: done, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} } })));
  const ids = d.state.pk[p1.idx].ids, left = POOL.filter((id) => /^l1-/.test(id) && !done[id]);
  assert.ok(ids.length === Math.min(p1.count, left.length) && ids.every((id) => hold.ids.indexOf(id) > -1 && POOL.indexOf(id) > -1 && !done[id]), '不夠才用預留題:' + ids);
  const farFirst = ofPart(hold.far, '1').filter((id) => !done[id]);
  assert.ok(disjoint(ids, farFirst).length === Math.min(ids.length, farFirst.length), '先用遠的那一份');
  return '照片描述清單剩 ' + left.length + ' 題沒做過';
};

T['R8 不改傳進來的 ctx 與進度'] = async () => {
  const l = P.compose(PACKS, TT, 4), hold = await reserveOf(TT, 4);
  const c = ctxOf({ checkpointPool: POOL, reserve: hold, seen: allOfPart('1').slice(0, 30) }), s = P.newState(l, NOW);
  const before = JSON.stringify([c.seen, c.checkpointPool, c.records, hold, s]);
  await P.pickFixed(l, s, c);
  await P.pickReview(l, s, [{ k: 'P1.photo', due: '2026-11-24', step: 7 }], c);
  await P.pickWeak(l, s, [{ key: 'P1.photo', part: '1', track: 'listening', seconds: 300, reason: 'weak:P1.photo', base: null }], c);
  const rc = { account: ACC, pool: POOL.slice(), bank: B }, rb = JSON.stringify(rc.pool);
  await P.reserveFor(PACKS, TT, 3, rc);
  eq([JSON.stringify([c.seen, c.checkpointPool, c.records, hold, s]), JSON.stringify(rc.pool)], [before, rb]);
  return 'ok';
};

T['R9 做過聽力短測的帳號:那 8 題算前測題(小檢核清單扣掉、預留題不挑);沒做過的帳號預留題跟改之前一樣'] = async () => {
  for (const lv of [EE, TT]) {
    const plainEnv = K.env({ bank: true, user: '5a0c1e2d-3b4a-4c5d-8e6f-7a8b9c0d1e2f', pid: ACCOUNTS[1] });
    await plainEnv.D.packs();
    const l3 = plainEnv.lesson(lv, 3), c0 = plainEnv.D.ctx(l3, NOW);
    const r0 = await plainEnv.P.reserved(c0);
    eq(print(r0.slice(0, BEFORE[tag(lv) + '|' + ACCOUNTS[1]][0])), BEFORE[tag(lv) + '|' + ACCOUNTS[1]], '沒做過短測:第 4 堂那一份不變');
    const short = r0.filter((id) => /^l[12]-/.test(id)).slice(0, 8);
    assert.equal(short.length, 8);
    const e = K.env({ bank: true, user: '5a0c1e2d-3b4a-4c5d-8e6f-7a8b9c0d1e2f', pid: ACCOUNTS[1] });
    e.store.set('onboard', { v: 1, step: 'done', listen: { v: 1, mode: 'full', ids: short } });
    await e.D.packs();
    const c = e.D.ctx(e.lesson(lv, 3), NOW), r = await e.P.reserved(c);
    eq([short.filter((id) => e.D.testIds().indexOf(id) < 0), short.filter((id) => c.checkpointPool.indexOf(id) > -1), disjoint(r, short)], [[], [], []], tag(lv));
    assert.ok(short.every((id) => c.seen.indexOf(id) > -1), '算進做過的題');
    const bad = K.env({ bank: true, user: '5a0c1e2d-3b4a-4c5d-8e6f-7a8b9c0d1e2f', pid: ACCOUNTS[1] });
    bad.store.set('onboard', { v: 1, listen: { ids: short.slice(0, 7) } });
    await bad.D.packs();
    eq(print((await bad.P.reserved(bad.D.ctx(bad.lesson(lv, 3), NOW))).slice(0, r0.length)), print(r0), '不是 8 題不算');
  }
  return 'ok';
};

K.run(T);
