/* 小檢核的預留題(js/pack-core.js 的 reserveFor 與選題的補題順序):每一次小檢核各算一份、互不重疊;練習避開之後兩次的預留題,
   題不夠時先用遠的那一份、最後才用近的那一份;考點回顧另有順序;弱點補練只避開不補;小檢核本身先避開之後兩次的預留題。
   有進度的堂照那份進度自己的級別判斷能不能上。
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
/* 帳號的資料夾名稱是 c 加帳號 id 去掉連字號(雲端帳號) */
const UIDS = ['7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f', '5a0c1e2d-3b4a-4c5d-8e6f-7a8b9c0d1e2f', '0f1e2d3c-4b5a-4969-8877-665544332211'];
const ACCOUNTS = UIDS.map((u) => 'c' + u.replace(/-/g, ''));
const ACC = ACCOUNTS[0];
/* 改之前的 reserveFor(第 2 堂 → 第 4 堂那一份):[題數, 題 id 用逗號接起來的 hash32];鍵是「聽讀級別的開頭字母|第幾個帳號」 */
const BEFORE = {
  'ee|0': [20, 3603023490], 'ee|1': [20, 111918193], 'ee|2': [20, 3009219850],
  'tt|0': [25, 3589912264], 'tt|1': [25, 1392165023], 'tt|2': [25, 2114563014],
  'te|0': [20, 2365785647], 'te|1': [20, 246229127], 'te|2': [20, 2863151630],
  'et|0': [25, 1822214015], 'et|1': [25, 4233500961], 'et|2': [25, 2124996082],
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
      eq(print(r4), BEFORE[tag(lv) + '|' + ACCOUNTS.indexOf(acc)], tag(lv) + ' 第 ' + (ACCOUNTS.indexOf(acc) + 1) + ' 個帳號第 4 堂那一份');
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

/* 補題順序用自己組的兩份(近、遠各 4 題照片描述):實際的第 4、8 堂兩份照片描述不一定都有(第 8 堂小檢核沒有照片描述) */
function holdP1(from) {
  const ids = from.filter((id) => /^l1-/.test(id));
  const near = ids.slice(0, 4), far = ids.slice(4, 8);
  return { ids: near.concat(far), near, far };
}

T['R4 固定段題不夠時先用遠的那一份,遠的用完才用近的'] = async () => {
  const l = P.compose(PACKS, TT, 3), hold = holdP1(allOfPart('1'));
  const p1 = bankBlocks(l).filter((b) => b.module === 'p1'), want = p1.reduce((a, b) => a + b.count, 0);
  const used = (r) => p1.reduce((a, b) => a.concat(r.state.pk[b.idx].ids), []);
  const a = used(await P.pickFixed(l, squeeze(l, '1', hold.ids), ctxOf({ reserve: hold })));
  assert.ok(want > 4 && want < 8, '照片描述要 ' + want + ' 題');
  eq([a.length, disjoint(a, hold.far).length, disjoint(a, hold.near).length], [want, 4, want - 4], '先把遠的 4 題用完,才用近的');
  const b = used(await P.pickFixed(l, squeeze(l, '1', hold.near), ctxOf({ reserve: hold })));
  assert.ok(b.length === 4 && b.every((id) => hold.near.indexOf(id) > -1), '只剩近的時用近的');
  return '照片描述要 ' + want + ' 題';
};

T['R5 考點回顧:沒做過的非預留題 → 遠的預留題 → 14 天內做過的 → 近的預留題'] = async () => {
  const l = P.compose(PACKS, TT, 3), all = allOfPart('1'), hold = holdP1(all);
  const free = all.filter((id) => hold.ids.indexOf(id) < 0);
  const seenIds = free.slice(0, 5), fresh = free.slice(5, 10);
  const units = [{ k: 'P1.photo', due: '2026-11-24', step: 7 }];
  const run = async (keep) => (await P.pickReview(l, squeeze(l, '1', keep), units, ctxOf({ reserve: hold, seen: seenIds }))).state.pk[81].ids;
  const a = await run(hold.ids.concat(seenIds, fresh));
  assert.ok(a.length === 3 && a.every((id) => fresh.indexOf(id) > -1), '有沒做過的新題就用:' + a);
  const b = await run(hold.ids.concat(seenIds));
  assert.ok(b.length === 3 && b.every((id) => hold.far.indexOf(id) > -1), '沒有新題先用遠的預留題:' + b);
  const c = await run(hold.near.concat(seenIds));
  assert.ok(c.length === 3 && c.every((id) => seenIds.indexOf(id) > -1), '再來是 14 天內做過的:' + c);
  const d = await run(hold.near);
  assert.ok(d.length === 3 && d.every((id) => hold.near.indexOf(id) > -1), '最後才用近的:' + d);
  const r = await P.pickReview(l, squeeze(l, '1', hold.far.slice(0, 1).concat(seenIds.slice(0, 1), hold.near)), units, ctxOf({ reserve: hold, seen: seenIds }));
  eq(r.state.pk[81].ids.map((id) => (hold.far.indexOf(id) > -1 ? 'far' : hold.near.indexOf(id) > -1 ? 'near' : 'seen')).sort(), ['far', 'near', 'seen'], '三種各剩一題時三種都用');
  return 'ok';
};

T['R6 弱點補練只避開、不補:只剩預留題時選 0 題,need 記下來'] = async () => {
  const l = P.compose(PACKS, TT, 3), hold = await reserveOf(TT, 3);
  const plans = [{ key: 'P1.photo', part: '1', track: 'listening', seconds: 300, reason: 'weak:P1.photo', base: null }];
  const w = await P.pickWeak(l, squeeze(l, '1', hold.ids), plans, ctxOf({ reserve: hold }));
  eq([w.blocks.map((b) => b.ids.length), w.need], [[0], [{ idx: 85, module: 'p1', want: E.R.weakCount(plans[0]), got: 0, relaxed: false }]]);
  return 'ok';
};

T['R7 小檢核的檢核區塊:清單內非預留題夠時不選預留題;不夠時才選(先遠後近),選到的都在清單內、沒做過'] = async () => {
  const l = P.compose(PACKS, TT, 4), real = await reserveOf(TT, 4);
  const a = await P.pickFixed(l, P.newState(l, NOW), ctxOf({ checkpointPool: POOL, reserve: real }));
  cpBlocks(l).forEach((blk) => {
    const ids = a.state.pk[blk.idx].ids;
    assert.ok(ids.length === blk.count && ids.every((id) => real.ids.indexOf(id) < 0 && POOL.indexOf(id) > -1), blk.blockId + ' 不選預留題');
  });
  const p1 = cpBlocks(l).filter((x) => x.module === 'p1')[0], hold = holdP1(POOL);
  const done = {};
  POOL.filter((id) => /^l1-/.test(id) && hold.ids.indexOf(id) < 0).slice(2).forEach((id) => { done[id] = { ok: true, t: 1 }; });
  hold.far.slice(0, 1).forEach((id) => { done[id] = { ok: true, t: 1 }; });
  const d = await P.pickFixed(l, P.newState(l, NOW), ctxOf({ checkpointPool: POOL, reserve: hold, records: { 1: done, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} } }));
  const ids = d.state.pk[p1.idx].ids, kind = (id) => (hold.far.indexOf(id) > -1 ? 'far' : hold.near.indexOf(id) > -1 ? 'near' : 'free');
  assert.ok(ids.every((id) => POOL.indexOf(id) > -1 && !done[id]), '都在清單內、沒做過');
  eq([ids.length, ids.filter((id) => kind(id) === 'free').length, ids.filter((id) => kind(id) === 'far').length, ids.filter((id) => kind(id) === 'near').length], [p1.count, 2, 3, p1.count - 5], '先非預留、再遠、最後近');
  return '照片描述 ' + p1.count + ' 題';
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

T['R10 解鎖照進度裡的級別:第 5 堂有進度(門檻)而目前級別是入門時,第 5 堂照它的進度判可以上、第 6 堂尚未開放;沒有進度的堂照目前級別'] = async () => {
  const packs = JSON.parse(JSON.stringify(PACKS));
  packs.threshold.liveThrough = 8;
  const day = NOW - 10 * K.DAY, today = P.dayOf(NOW), states = {};
  for (let no = 1; no <= 4; no++) {
    const l = P.compose(packs, EE, no);
    let s = P.newState(l, day);
    l.segments.forEach((x) => { s = P.setSegment(s, l, x.slot, x.fixed ? 'done' : 'skip', day + 600); });
    states[no] = s;
  }
  const l5 = P.compose(packs, TT, 5);
  states[5] = P.setSegment(P.newState(l5, day + 3 * K.DAY), l5, 'vocab', 'done', day + 3 * K.DAY + 60);
  const u = P.unlockState({ packs, levels: EE, states, today });
  eq(u.lessons.slice(3, 7).map((x) => x.status), ['done', 'open', 'not_live', 'not_live']);
  eq(u.next, 5);
  const v = P.unlockState({ packs, levels: TT, states: Object.assign({}, states, { 5: undefined }), today });
  eq(v.lessons.slice(4, 6).map((x) => x.status), ['open', 'locked'], '沒有進度照目前級別(門檻開到第 8 堂)');
  return 'ok';
};

K.run(T);
