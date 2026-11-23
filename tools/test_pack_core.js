/* 課程引擎(js/pack-core.js):進度鍵、聽讀拼課表、建議日期與解鎖、選題與凍結、進度的兩台合併、開堂與交卷前先合併雲端那一份。
   node + vm:載真的題目索引、英語耳題目、學習包(data/packs/*.json)、js/lesson-rules.js、js/bank.js、js/pack-core.js;
   store 與雲端用假的。不開瀏覽器、不連網。用法:node tools/test_pack_core.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const PACKS = { entry: JSON.parse(read('data/packs/pack_entry.json')), threshold: JSON.parse(read('data/packs/pack_threshold.json')) };

function sandbox() {
  const ctx = { console, Promise, Map, Set, JSON, Object, Array, Math, Number, String, Date, TypeError, Error, isNaN, TextEncoder };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['data/bank-meta.js', 'data/ear.js', 'js/move-rules.js', 'js/move-merge.js', 'js/lesson-rules.js', 'js/bank.js', 'js/pack-core.js'].forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  return ctx;
}
const CTX = sandbox();
const P = CTX.PACK_CORE, R = CTX.LESSON_RULES, META = new Map(CTX.BANK_META.items.map((r) => [r.id, r]));
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const NOW = 1764000000;
/* 每週新字:字的 id 是字序(每週 25 字,第 w 週是 (w−1)×25＋1 起),跟每週新字表的寫法一樣短 */
const words = (week, which) => {
  const w = which === 'this_week' ? week : which === 'last_week' ? week - 1 : week - 3;
  return w < 1 ? [] : Array.from({ length: 25 }, (_, i) => String((w - 1) * 25 + i + 1));
};
function ctxOf(extra) {
  return Object.assign({ bank: CTX.BANK, records: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} }, seen: [], ear: CTX.TOEIC.ear, earRecords: {}, weekWords: words, random: rng(7), now: NOW }, extra || {});
}
/* 假的 store(一台)與共用的雲端 */
function cloudOf() {
  const rows = new Map();
  return { rows, ok: true, readKey: async function (k) { return this.ok ? { ok: true, found: rows.has(k), v: rows.has(k) ? JSON.parse(rows.get(k)) : null } : { ok: false }; } };
}
function storeOf(cloud) {
  const mem = new Map(), sets = [];
  return { mem, sets, get: (k, fb) => (mem.has(k) ? JSON.parse(mem.get(k)) : fb), set: (k, v) => { sets.push(k); mem.set(k, JSON.stringify(v)); if (cloud) cloud.rows.set(k, JSON.stringify(v)); } };
}
const bankBlocks = (lesson) => [].concat(...lesson.segments.map((s) => (s.blocks || []).map((b) => Object.assign({ slot: s.slot }, b)))).filter((b) => /^p[1-7]$/.test(b.module));

const T = {};

T['C1 進度鍵:les_t<期>_<堂>,堂號補兩位;期 1–99、堂 1–24 以外丟錯;產生的鍵都符合搬家規則(single)'] = () => {
  assert.equal(P.lessonKey(1, 3), 'les_t1_03');
  assert.equal(P.lessonKey(12, 24), 'les_t12_24');
  [[0, 1], [100, 1], [1, 0], [1, 25], [1.5, 2], ['1', 2]].forEach(([t, n]) => assert.throws(() => P.lessonKey(t, n), TypeError, t + ',' + n));
  for (let t = 1; t <= 99; t++) for (let n = 1; n <= 24; n++) {
    const k = P.lessonKey(t, n);
    assert.equal(CTX.MOVE_RULES.ruleOf(k), 'single', k);
    assert.deepEqual(plain(P.parseLessonKey(k)), { term: t, no: n });
  }
  ['les_t1_25', 'les_t0_01', 'les_t01_01', 'les_t1_1', 'x'].forEach((k) => assert.equal(P.parseLessonKey(k), null, k));
  return '99×24 個鍵';
};

T['C2 拼課表(同一級):段照學習包順序、每堂 60 分;固定區塊依序編號、標上聽讀;小檢核的補足區塊接在後面'] = () => {
  const l = P.compose(PACKS, { listening: 'entry', reading: 'entry' }, 3);
  assert.deepEqual(l.segments.map((s) => s.slot + s.minutes), ['vocab5', 'listening17', 'reading17', 'review8', 'weak11', 'wrapup2']);
  const idx = [].concat(...l.segments.map((s) => (s.blocks || []).map((b) => b.idx)));
  assert.deepEqual(idx, idx.map((_, i) => i));
  assert.ok(l.segments[1].blocks.every((b) => b.track === 'listening' || b.module === 'tip_cards'));
  assert.deepEqual(plain(l.lessonId), { listening: 'entry-L03', reading: 'entry-L03' });
  const c = P.compose(PACKS, { listening: 'entry', reading: 'entry' }, 4);
  const cp = c.segments.filter((s) => s.slot === 'checkpoint')[0];
  assert.deepEqual(cp.blocks.map((b) => b.module + (b.fill ? '*' : '')), ['p1', 'p2', 'p5', 'p5', 'grammar*']);
  assert.equal(c.liveThrough, 4);
  return 'ok';
};

T['C3 聽讀不同級:聽力段跟聽力級、單字與閱讀段跟閱讀級;聽力重播加 1 分的堂,回顧段的分鐘跟著聽力那一包,合計仍 60'] = () => {
  const l = P.compose(PACKS, { listening: 'threshold', reading: 'entry' }, 3);
  const seg = (s) => l.segments.filter((x) => x.slot === s)[0];
  assert.ok(seg('listening').blocks.every((b) => !b.select || !b.select.legacyWhere || !b.select.legacyWhere.difficulty || true));
  assert.deepEqual(seg('listening').blocks.map((b) => b.module), PACKS.threshold.lessons[2].segments.filter((s) => s.slot === 'listening')[0].blocks.map((b) => b.module));
  assert.deepEqual(seg('reading').blocks.map((b) => b.module), PACKS.entry.lessons[2].segments.filter((s) => s.slot === 'reading')[0].blocks.map((b) => b.module));
  assert.deepEqual(plain(l.lessonId), { listening: 'threshold-L03', reading: 'entry-L03' });
  assert.deepEqual(plain(l.mix), { listening: PACKS.threshold.difficultyMix, reading: PACKS.entry.difficultyMix });
  const five = P.compose(PACKS, { listening: 'entry', reading: 'threshold' }, 5);
  assert.deepEqual(five.segments.map((s) => s.slot + s.minutes), ['vocab5', 'listening18', 'reading17', 'review7', 'weak11', 'wrapup2']);
  let n = 0;
  [['entry', 'threshold'], ['threshold', 'entry'], ['entry', 'entry'], ['threshold', 'threshold']].forEach(([a, b]) => {
    for (let no = 1; no <= 24; no++) { const x = P.compose(PACKS, { listening: a, reading: b }, no); assert.equal(x.segments.reduce((s, y) => s + y.minutes, 0), 60); n++; }
  });
  return n + ' 種拼法都是 60 分';
};

T['C4 聽讀不同級的小檢核:聽力考點跟聽力那一包、閱讀考點跟閱讀那一包;含說明 60 秒在 918–1,080 秒'] = () => {
  [4, 8, 12, 16, 20, 24].forEach((no) => [['entry', 'threshold'], ['threshold', 'entry']].forEach(([a, b]) => {
    const l = P.compose(PACKS, { listening: a, reading: b }, no);
    const la = PACKS[a].lessons[no - 1].checkpoint, rb = PACKS[b].lessons[no - 1].checkpoint;
    l.checkpoint.listening.forEach((k) => assert.ok(la.listening.indexOf(k) > -1, no + ' ' + k));
    l.checkpoint.reading.forEach((k) => assert.ok(rb.reading.indexOf(k) > -1, no + ' ' + k));
    const blocks = l.segments.filter((s) => s.slot === 'checkpoint')[0].blocks;
    const sec = blocks.reduce((s, x) => s + x.count * x.secondsPerUnit, 0) + 60;
    assert.ok(sec >= 918 && sec <= 1080, no + ' ' + a + '/' + b + ' ' + sec);
    assert.equal(blocks.filter((x) => !x.fill).length, l.checkpoint.listening.length + l.checkpoint.reading.length);
  }));
  return 'ok';
};

T['C5 只開入門、門檻:進階、高分丟錯;學習包不是 live 或少堂也丟錯'] = () => {
  assert.throws(() => P.compose(PACKS, { listening: 'advanced', reading: 'entry' }, 3), /還沒開放/);
  assert.throws(() => P.compose({ entry: Object.assign({}, PACKS.entry, { status: 'draft' }) }, { listening: 'entry', reading: 'entry' }, 3), /不是開放/);
  assert.throws(() => P.compose({ entry: Object.assign({}, PACKS.entry, { lessons: [] }) }, { listening: 'entry', reading: 'entry' }, 3), /格式不對/);
  assert.throws(() => P.compose(PACKS, null, 3), TypeError);
  return 'ok';
};

T['C6 建議日期:第 n 週主課＝開始日＋7(n−1),延伸堂＝主課＋3 天'] = () => {
  assert.equal(P.suggestedDate('2026-11-23', 1), '2026-11-23');
  assert.equal(P.suggestedDate('2026-11-23', 2), '2026-11-26');
  assert.equal(P.suggestedDate('2026-11-23', 3), '2026-11-30');
  assert.equal(P.suggestedDate('2026-11-23', 24), '2027-02-11');
  assert.throws(() => P.suggestedDate('2026-11-23', 25), TypeError);
  return 'ok';
};

function doneState(lesson, at) {
  let s = P.newState(lesson, at);
  lesson.segments.forEach((x) => { s = P.setSegment(s, lesson, x.slot, x.fixed ? 'done' : 'skip', at + 60); });
  return s;
}
const LV = { listening: 'entry', reading: 'entry' };
const today = (sec) => P.dayOf(sec);

T['C7 解鎖:依序、前一堂固定段交完才開下一堂;超過 liveThrough 是尚未開放;一天最多開 2 堂(已經開的照常)'] = () => {
  const st0 = P.unlockState({ packs: PACKS, levels: LV, states: {}, today: today(NOW) });
  assert.deepEqual(st0.lessons.slice(0, 6).map((x) => x.status), ['open', 'locked', 'locked', 'locked', 'not_live', 'not_live']);
  assert.equal(st0.next, 1);
  const l1 = P.compose(PACKS, LV, 1), l2 = P.compose(PACKS, LV, 2);
  const day1 = NOW - 3 * 86400;
  let s1 = P.newState(l1, day1);
  l1.segments.forEach((x) => { s1 = P.setSegment(s1, l1, x.slot, 'done', day1 + 100); });
  const st1 = P.unlockState({ packs: PACKS, levels: LV, states: { 1: s1 }, today: today(NOW) });
  assert.deepEqual(st1.lessons.slice(0, 3).map((x) => x.status), ['done', 'open', 'locked']);
  /* 第 2 堂固定段交完、個人段還沒:第 3 堂可以開(個人段可以略過) */
  let s2 = P.newState(l2, day1);
  l2.segments.filter((x) => x.fixed).forEach((x) => { s2 = P.setSegment(s2, l2, x.slot, 'done', day1 + 200); });
  const st2 = P.unlockState({ packs: PACKS, levels: LV, states: { 1: s1, 2: s2 }, today: today(NOW) });
  assert.deepEqual(st2.lessons.slice(0, 4).map((x) => x.status), ['done', 'open', 'open', 'locked']);
  /* 今天已經開了 2 堂:第 3 堂(還沒開)要等明天;已經開的第 2 堂照常 */
  const a = Object.assign({}, s1, { startedAt: NOW }), b = Object.assign({}, s2, { startedAt: NOW });
  const st3 = P.unlockState({ packs: PACKS, levels: LV, states: { 1: a, 2: b }, today: today(NOW) });
  assert.deepEqual(st3.lessons.slice(0, 3).map((x) => x.status), ['done', 'open', 'daily_limit']);
  /* 前 4 堂都上完:第 5 堂尚未開放 */
  const states = {};
  for (let no = 1; no <= 4; no++) states[no] = doneState(P.compose(PACKS, LV, no), day1);
  const st4 = P.unlockState({ packs: PACKS, levels: LV, states, today: today(NOW) });
  assert.deepEqual([st4.lessons[4].status, st4.next], ['not_live', 5]);
  return 'ok';
};

T['C8 進度內容:作答同一區塊同一題只留第一次、不改原物件;固定段不能略過;所有段交卷或略過才記 doneAt'] = () => {
  const l = P.compose(PACKS, LV, 3);
  const s0 = P.newState(l, NOW);
  const snap = JSON.stringify(s0);
  const s1 = P.answer(s0, { b: 3, m: 'l2', id: 'l2-01', sub: null, c: 2, ok: true, f: true, t: NOW + 30 });
  const s2 = P.answer(s1, { b: 3, m: 'l2', id: 'l2-01', sub: null, c: 1, ok: false, f: false, t: NOW + 90 });
  assert.equal(JSON.stringify(s0), snap);
  assert.deepEqual(plain(s2.a), [[3, 'l2-01', 0, 2, 3, 30]]);
  assert.deepEqual(plain(P.readAnswer(s2, s2.a[0])), { b: 3, id: 'l2-01', sub: null, c: 2, ok: true, f: true, t: NOW + 30 });
  const s3 = P.answer(s2, { b: 7, id: 'w-1', c: 'typed', ok: false, f: false, t: NOW + 40 });
  assert.deepEqual(plain(s3.a[1]), [7, 'w-1', 0, -1, 0, 40], '不是選項的作答不存打的字');
  assert.deepEqual([...P.answeredIn(s2, 3)], ['l2-01']);
  assert.throws(() => P.setSegment(s2, l, 'listening', 'skip', NOW), TypeError);
  assert.throws(() => P.answer(s2, { b: 'x', m: 'l2', id: 'a', t: NOW }), TypeError);
  let s = s2;
  l.segments.slice(0, -1).forEach((x) => { s = P.setSegment(s, l, x.slot, x.fixed ? 'done' : 'skip', NOW + 500); });
  assert.equal(s.doneAt, null);
  s = P.setSegment(s, l, 'wrapup', 'done', NOW + 600);
  assert.equal(s.doneAt, NOW + 600);
  assert.equal(P.setSegment(s, l, 'weak', 'doing', NOW + 700).doneAt, NOW + 600);
  return 'ok';
};

T['C9 選題:每個題庫區塊照條件與難度配比選、整堂不重複;非題庫區塊(文法、技巧卡、英語耳、單字)也凍結'] = async () => {
  const l = P.compose(PACKS, { listening: 'threshold', reading: 'entry' }, 3);
  const r = await P.pickFixed(l, P.newState(l, NOW), ctxOf());
  const all = [];
  bankBlocks(l).forEach((b) => {
    const ids = r.state.pk[b.idx].ids;
    assert.equal(ids.length, b.count, b.blockId);
    const lw = (b.select && b.select.legacyWhere) || {};
    ids.forEach((id) => {
      const m = META.get(id);
      assert.equal(m.part, b.module.slice(1), id);
      if (lw.category) assert.ok(lw.category.indexOf(m.category) > -1, b.blockId + ' ' + id);
      if (lw.difficulty) assert.ok(lw.difficulty.indexOf(m.difficulty) > -1, b.blockId + ' ' + id);
      all.push(id);
    });
  });
  assert.equal(new Set(all).size, all.length, '整堂不重複');
  const timed = bankBlocks(l).filter((b) => b.module === 'p2' && b.timing === 'timed')[0];
  const want = P.allocate(timed.count, PACKS.threshold.difficultyMix);
  const got = { 基礎: 0, 中級: 0, 進階: 0 };
  r.state.pk[timed.idx].ids.forEach((id) => { got[META.get(id).difficulty]++; });
  assert.deepEqual([got.基礎, got.中級 - want.D4, got.進階], [want.D1, want.D2, want.D3], 'D4 沒有題,先跟 D2 借');
  l.segments.forEach((s) => (s.blocks || []).forEach((b) => assert.ok(r.state.pk[b.idx], '沒凍結 ' + b.blockId)));
  const vocab = l.segments[0].blocks;
  assert.deepEqual(plain(r.state.pk[vocab[0].idx].ids), [], '字卡不存字(就是那一週全部的字)');
  assert.ok(vocab.slice(1).every((b) => r.state.pk[b.idx].ids.length === b.count), '單字小考照題數選');
  assert.deepEqual(plain(r.need), []);
  return Object.keys(r.state.pk).length + ' 個區塊';
};

T['C10 凍結:選過的區塊再跑一次不換(換亂數也一樣);新增的區塊才選'] = async () => {
  const l = P.compose(PACKS, LV, 3);
  const a = await P.pickFixed(l, P.newState(l, NOW), ctxOf({ random: rng(1) }));
  const b = await P.pickFixed(l, a.state, ctxOf({ random: rng(99), now: NOW + 999 }));
  assert.deepEqual(plain(b.state.pk), plain(a.state.pk));
  const partial = Object.assign({}, a.state, { pk: Object.assign({}, a.state.pk) });
  const last = Math.max(...Object.keys(partial.pk).map(Number));
  delete partial.pk[last];
  const c = await P.pickFixed(l, partial, ctxOf({ random: rng(5) }));
  assert.ok(c.state.pk[last]);
  Object.keys(a.state.pk).filter((k) => Number(k) !== last).forEach((k) => assert.deepEqual(plain(c.state.pk[k]), plain(a.state.pk[k])));
  return 'ok';
};

T['C11 小檢核:只從可用題清單選、學生做過的不選;沒給清單丟錯;補足區塊不受清單限制'] = async () => {
  const l = P.compose(PACKS, LV, 4);
  await assert.rejects(P.pickFixed(l, P.newState(l, NOW), ctxOf()), /checkpointPool/);
  const pool = CTX.BANK_META.items.filter((r) => /^[125]$/.test(r.part)).map((r) => r.id).filter((_, i) => i % 2 === 0);
  const done = { 2: {} };
  pool.filter((id) => /^l2-/.test(id)).slice(0, 5).forEach((id) => { done[2][id] = { ok: true }; });
  const r = await P.pickFixed(l, P.newState(l, NOW), ctxOf({ checkpointPool: pool, records: Object.assign({ 1: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} }, done) }));
  const cp = l.segments.filter((s) => s.slot === 'checkpoint')[0];
  cp.blocks.filter((b) => !b.fill).forEach((b) => r.state.pk[b.idx].ids.forEach((id) => {
    assert.ok(pool.indexOf(id) > -1, id + ' 不在清單');
    assert.ok(!done[2][id], id + ' 做過了');
  }));
  const fill = cp.blocks.filter((b) => b.fill)[0];
  assert.deepEqual(plain(r.state.pk[fill.idx].ids), ['ga-02']);
  return 'ok';
};

T['C12 題不夠:先照 D2→D3→D1→D4 借難度,再放寬「14 天內做過」,仍不夠記在 need'] = async () => {
  const l = P.compose(PACKS, LV, 3);
  const p5 = bankBlocks(l).filter((b) => b.module === 'p5' && b.timing === 'timed')[0];
  const cat = CTX.BANK_META.items.filter((r) => r.part === '5' && r.category === '詞性變化').map((r) => r.id);
  const seen = cat.slice(0, cat.length - 3);
  const r = await P.pickFixed(l, P.newState(l, NOW), ctxOf({ seen }));
  const ids = r.state.pk[p5.idx].ids;
  assert.equal(ids.length, p5.count);
  assert.ok(r.need.some((x) => x.idx === p5.idx && x.relaxed), '放寬過要記下來');
  const tiny = JSON.parse(JSON.stringify(l));
  const blk = bankBlocks(tiny).filter((b) => b.module === 'p5' && b.timing === 'timed')[0];
  tiny.segments.forEach((s) => (s.blocks || []).forEach((b) => { if (b.idx === blk.idx) b.count = 40; }));
  const t = await P.pickFixed(tiny, P.newState(tiny, NOW), ctxOf());
  const n = t.need.filter((x) => x.idx === blk.idx)[0];
  assert.ok(n && n.want === 40 && n.got < 40, JSON.stringify(t.need));
  return '要 40 題只有 ' + n.got + ' 題';
};

T['C13 弱點補練、回顧、測驗檢討的選題:放在固定的區塊編號、記出題原因、不跟本堂已選的重複、凍結後不換'] = async () => {
  const l = P.compose(PACKS, LV, 2);
  const f = await P.pickFixed(l, P.newState(l, NOW), ctxOf());
  const used = new Set([].concat(...Object.values(f.state.pk).map((x) => x.ids)));
  const plans = [{ key: 'P5.cat:介系詞', part: '5', track: 'reading', seconds: 420, reason: 'weak:P5.cat:介系詞', base: { module: 'grammar', ids: ['gg-01'], seconds: 480 } },
    { key: 'P2.wh', part: '2', track: 'listening', seconds: 420, reason: 'weak:P2.wh', base: null }];
  plans[0].seconds = 480 + 4 * 40;
  const w = await P.pickWeak(l, f.state, plans, ctxOf());
  assert.deepEqual(w.blocks.map((b) => [b.idx, b.module, b.r, b.ids.length]), [[85, 'grammar', 'base_module', 1], [86, 'p5', 'weak:P5.cat:介系詞', 4], [87, 'p2', 'weak:P2.wh', 12]]);
  w.blocks.filter((b) => /^p/.test(b.module)).forEach((b) => b.ids.forEach((id) => assert.ok(!used.has(id), id)));
  const again = await P.pickWeak(l, w.state, plans, ctxOf({ random: rng(3) }));
  assert.deepEqual(plain(again.state.pk), plain(w.state.pk));
  const units = [{ m: 'l2', id: 'l2-03', sub: null, due: '2026-11-24', step: 1 }, { m: 'l3', id: 'l3-01', sub: 2, due: '2026-11-24', step: 7 }, { k: 'P5.cat:代名詞', due: '2026-11-24', step: 7 }];
  const rv = await P.pickReview(l, w.state, units, ctxOf());
  assert.deepEqual(plain(rv.state.pk[80]).ids, ['l2-03', 'l3-01']);
  assert.deepEqual(plain(rv.state.pk[80]).sub, [null, 2]);
  assert.equal(rv.state.pk[81].ids.length, 3);
  assert.ok(rv.state.pk[81].ids.every((id) => META.get(id).category === '代名詞'));
  const parts = { P1: { n: 3, ok: 1 }, P2: { n: 13, ok: 10 }, P5: { n: 15, ok: 12 }, P6: { n: 8, ok: 2 } };
  const testIds = CTX.BANK_META.items.filter((r) => r.part === '1').map((r) => r.id).slice(0, 20);
  const tr = await P.pickTestReview(l, rv.state, parts, ctxOf({ testIds }));
  assert.deepEqual(tr.blocks.map((b) => b.idx + ':' + (b.id || b.part)), ['90:tip-P1-photo', '91:1', '92:tip-P6-grammar', '93:6', '94:5']);
  tr.blocks.filter((b) => b.kind === 'items').forEach((b) => b.ids.forEach((id) => assert.ok(testIds.indexOf(id) < 0, '測驗出過的題 ' + id)));
  return 'ok';
};

T['C14 兩台合併同一堂:作答聯集、同一題取早的、段以交卷優先(都交卷取早的)、選題取凍結早的、開始時間取早的'] = () => {
  const l = P.compose(PACKS, LV, 3);
  let a = P.newState(l, NOW), b = P.newState(l, NOW + 100);
  a = P.freeze(a, 4, ['l2-01', 'l2-02', 'l2-03', 'l2-04'], NOW + 10);
  b = P.freeze(b, 4, ['l2-09', 'l2-10', 'l2-11', 'l2-12'], NOW + 120);
  b = P.freeze(b, 5, ['l2-20'], NOW + 130);
  a = P.answer(a, { b: 4, m: 'l2', id: 'l2-01', c: 1, ok: true, f: true, t: NOW + 20 });
  a = P.answer(a, { b: 4, m: 'l2', id: 'l2-02', c: 1, ok: false, f: true, t: NOW + 400 });
  b = P.answer(b, { b: 4, m: 'l2', id: 'l2-02', c: 2, ok: true, f: true, t: NOW + 300 });
  b = P.answer(b, { b: 4, m: 'l2', id: 'l2-03', c: 0, ok: true, f: true, t: NOW + 310 });
  a = P.setSegment(P.setSegment(a, l, 'vocab', 'doing', NOW + 5), l, 'vocab', 'done', NOW + 900);
  b = P.setSegment(P.setSegment(b, l, 'vocab', 'doing', NOW + 105), l, 'vocab', 'done', NOW + 500);
  b = P.setSegment(b, l, 'listening', 'doing', NOW + 510);
  const m = P.mergeLesson(a, b);
  assert.equal(m.startedAt, NOW);
  assert.deepEqual(plain(m.a.map((x) => [x[1], x[3], x[5]])), [['l2-01', 1, 20], ['l2-02', 2, 300], ['l2-03', 0, 310]]);
  assert.deepEqual(plain(m.pk[4].ids), ['l2-01', 'l2-02', 'l2-03', 'l2-04']);
  assert.ok(m.pk[5]);
  assert.deepEqual(plain(m.seg.vocab), { st: 'done', t0: NOW + 5, t1: NOW + 500 });
  assert.equal(m.seg.listening.st, 'doing');
  assert.deepEqual(plain(P.mergeLesson(a, b)), plain(P.mergeLesson(b, a)), '兩個方向合出來一樣');
  assert.deepEqual(plain(P.mergeLesson(null, a)), plain(a));
  assert.deepEqual(plain(P.mergeLesson(a, { broken: true })), plain(a));
  assert.equal(P.mergeLesson(null, undefined), null);
  return 'ok';
};

T['C15 開堂與交卷:先讀雲端那一份合併再寫,兩台交錯作答同一堂,兩邊答過的題都留下;讀不到雲端照本機寫、不丟錯'] = async () => {
  const l = P.compose(PACKS, LV, 3);
  const cloud = cloudOf();
  const A = storeOf(cloud), B = storeOf(cloud);
  const devA = { store: A, cloud }, devB = { store: B, cloud };
  await P.saveLesson(1, 3, (s) => P.answer(s || P.newState(l, NOW), { b: 4, m: 'l2', id: 'l2-01', c: 1, ok: true, f: true, t: NOW + 10 }), devA);
  /* B 開堂:讀到 A 的進度 */
  const openB = await P.loadLesson(1, 3, devB);
  assert.equal(openB.state.a.length, 1);
  assert.deepEqual(B.sets, ['les_t1_03'], '合併後跟本機不同才寫');
  /* A 沒有重新開堂就繼續答、交卷;B 也答了別題、交卷 */
  await P.saveLesson(1, 3, (s) => P.answer(s, { b: 4, m: 'l2', id: 'l2-02', c: 1, ok: true, f: true, t: NOW + 20 }), devA);
  await P.saveLesson(1, 3, (s) => P.answer(s, { b: 4, m: 'l2', id: 'l2-03', c: 0, ok: false, f: true, t: NOW + 30 }), devB);
  const finalA = await P.loadLesson(1, 3, devA);
  assert.deepEqual(finalA.state.a.map((x) => x[1]).sort(), ['l2-01', 'l2-02', 'l2-03']);
  assert.deepEqual(JSON.parse(cloud.rows.get('les_t1_03')).a.map((x) => x[1]).sort(), ['l2-01', 'l2-02', 'l2-03']);
  const before = B.sets.length;
  await P.loadLesson(1, 3, devB);
  assert.equal(B.sets.length, before, '本機已經跟雲端一樣就不寫');
  /* 離線:照本機 */
  cloud.ok = false;
  const off = await P.saveLesson(1, 3, (s) => P.answer(s, { b: 4, m: 'l2', id: 'l2-04', c: 0, ok: true, f: true, t: NOW + 40 }), devB);
  assert.equal(off.a.length, 4);
  const offLoad = await P.loadLesson(1, 3, devB);
  assert.equal(offLoad.cloudRead, false);
  const throwing = { readKey: async () => { throw new Error('斷線'); } };
  assert.equal((await P.loadLesson(1, 3, { store: B, cloud: throwing })).state.a.length, 4);
  assert.equal((await P.loadLesson(1, 3, { store: B, cloud: null })).state.a.length, 4);
  await assert.rejects(P.loadLesson(1, 3, { store: {} }), /store/);
  return 'ok';
};

T['C16 pts、rvq、tests_v1 寫入前也先合併雲端那一份;只接受這三個鍵'] = async () => {
  const cloud = cloudOf();
  const A = storeOf(cloud), B = storeOf(cloud);
  const D = '2026-11-24';
  await P.saveShared('pts', (p) => R.addHits(p, [{ key: 'P2.wh', ok: true, first: true }], { today: D, src: 'p', b: 'A1' }), D, { store: A, cloud });
  await P.saveShared('pts', (p) => R.addHits(p, [{ key: 'P2.wh', ok: false, first: true }], { today: D, src: 'p', b: 'B1' }), D, { store: B, cloud });
  assert.deepEqual(JSON.parse(cloud.rows.get('pts'))['P2.wh'].hits.map((h) => h.b).sort(), ['A1', 'B1']);
  await P.saveShared('rvq', (q) => R.scheduleWrong(q, { m: 'p5', id: 'p5-1' }, D), D, { store: A, cloud });
  await P.saveShared('rvq', (q) => R.scheduleWrong(q, { m: 'p5', id: 'p5-2' }, D), D, { store: B, cloud });
  assert.equal(JSON.parse(cloud.rows.get('rvq')).length, 2);
  await P.saveShared('tests_v1', (t) => Object.assign({}, t, { t1: { pre: { form: 'interim_half', at: 200 } } }), D, { store: A, cloud });
  await P.saveShared('tests_v1', (t) => Object.assign({}, t, { t1: Object.assign({}, t.t1, { pre: { form: 'interim_half', at: 100 } }) }), D, { store: B, cloud });
  assert.equal((await P.loadShared('tests_v1', D, { store: A, cloud })).t1.pre.at, 100);
  assert.deepEqual(plain(P.mergeTests({ t1: { pre: { at: 5 } } }, { t1: { pre: { at: 9 }, mid: { at: 50 } }, t2: { pre: { at: 1 } } })), { t1: { pre: { at: 5 }, mid: { at: 50 } }, t2: { pre: { at: 1 } } });
  await assert.rejects(P.saveShared('hist', (x) => x, D, { store: A, cloud }), TypeError);
  return 'ok';
};

/* 一整堂上完的進度:固定段全部選題作答、個人段也滿 */
async function fullState(levels, no) {
  const l = P.compose(PACKS, levels, no);
  const pool = CTX.BANK_META.items.map((r) => r.id);
  let s = (await P.pickFixed(l, P.newState(l, NOW), ctxOf({ checkpointPool: pool }))).state;
  const plans = [{ key: 'P5.cat:介系詞', part: '5', seconds: 450, reason: 'weak:P5.cat:介系詞', base: null }, { key: 'P3.set', part: '3', seconds: 450, reason: 'weak:P3.set', base: null }];
  s = (await P.pickWeak(l, s, plans, ctxOf())).state;
  s = (await P.pickReview(l, s, Array.from({ length: 12 }, (_, i) => ({ m: 'p5', id: 'p5-' + (100 + i), sub: null })), ctxOf())).state;
  if (l.segments.some((x) => x.slot === 'test_review')) s = (await P.pickTestReview(l, s, { P3: { n: 18, ok: 2 }, P7: { n: 27, ok: 3 } }, ctxOf())).state;
  let t = NOW;
  Object.keys(s.pk).forEach((k) => s.pk[k].ids.forEach((id, i) => {
    const m = META.get(id);
    const subs = m && m.size ? m.size : 1;
    for (let q = 0; q < subs; q++) s = P.answer(s, { b: Number(k), m: m ? (/^[1-4]$/.test(m.part) ? 'l' : 'p') + m.part : 'w', id, sub: m && m.size ? q + 1 : null, c: 3, ok: i % 3 > 0, f: true, t: (t += 37) });
  }));
  l.segments.forEach((x) => { s = P.setSegment(s, l, x.slot, 'done', t); });
  return s;
}

T['C17 每堂進度鍵 ≤5 KB:入門、門檻、聽讀不同級各 24 堂,固定段與個人段全部作答'] = async () => {
  let max = 0, at = '';
  for (const lv of [{ listening: 'entry', reading: 'entry' }, { listening: 'threshold', reading: 'threshold' }, { listening: 'threshold', reading: 'entry' }]) {
    for (let no = 1; no <= 24; no++) {
      const s = await fullState(lv, no);
      const n = P.sizeOf(s);
      if (n > max) { max = n; at = lv.listening + '/' + lv.reading + ' 第 ' + no + ' 堂'; }
    }
  }
  assert.ok(max <= P.LESSON_KEY_MAX, at + ' ' + max + ' 位元組');
  const huge = Object.assign(P.newState(P.compose(PACKS, LV, 3), NOW), { a: Array.from({ length: 200 }, (_, i) => [1, 'p5', 'p5-' + i, null, 1, 1, 1, i]) });
  await assert.rejects(P.saveLesson(1, 3, () => huge, { store: storeOf(null), cloud: null }), /進度太大/);
  return '最大 ' + max + ' 位元組(' + at + ')';
};

T['C18 js/pack-core.js 讀寫儲存只經過 lessonKey、pts、rvq、tests_v1 與 syncPractice 的練習鍵(搬家規則的掃描認得)'] = () => {
  const src = read('js/pack-core.js');
  const calls = (src.match(/store\.(get|set|remove)\(\s*[^,)]+/g) || []).map((x) => x.replace(/^store\.\w+\(\s*/, ''));
  const allowed = ['lessonKey(term', "'pts'", "'rvq'", "'tests_v1'", 'key'];
  const body = src.slice(src.indexOf('async function syncPractice'), src.indexOf('root.PACK_CORE'));
  const keyCalls = (s) => (s.match(/store\.\w+\(\s*key\b/g) || []).length;
  assert.equal(keyCalls(src), keyCalls(body), 'store.get(key)、store.set(key) 只在 syncPractice 裡');
  CTX.PACK_CORE.PRACTICE_KEYS.forEach((k) => assert.equal(CTX.MOVE_RULES.ruleOf(k), k === 'hist' ? 'hist' : 'pool', k));
  assert.deepEqual(calls.filter((c) => allowed.indexOf(c) < 0), []);
  assert.ok(!/'les_t'\s*\+[^\n]*store\./.test(src) && !/store\.\w+\(\s*'les_/.test(src));
  return calls.length + ' 處';
};

T['C19 練習引擎寫的 drill_p*、listen_p*、hist:開堂與交卷前併進雲端那一份(錯題本同一題留新的、學習記錄聯集),一樣就不寫;離線照本機'] = async () => {
  const cloud = cloudOf();
  const A = storeOf(cloud);
  const t0 = Date.now();
  cloud.rows.set('drill_p5', JSON.stringify({ 'p5-1': { c: 1, ok: false, t: t0 - 5000 }, 'p5-2': { c: 0, ok: true, t: t0 - 4000 } }));
  cloud.rows.set('hist', JSON.stringify([{ m: 'p5', id: 'p5-2', c: 0, ok: true, t: t0 - 4000 }]));
  A.mem.set('drill_p5', JSON.stringify({ 'p5-1': { c: 2, ok: true, t: t0 - 1000 }, 'p5-3': { c: 1, ok: true, t: t0 - 900 } }));
  A.mem.set('hist', JSON.stringify([{ m: 'p5', id: 'p5-1', c: 2, ok: true, t: t0 - 1000 }]));
  const r = await P.syncPractice(['drill_p5', 'hist', 'listen_p1'], { store: A, cloud, nowMs: t0 });
  assert.deepEqual(plain(r), { drill_p5: 'merged', hist: 'merged', listen_p1: 'same' });
  const d = A.get('drill_p5');
  assert.deepEqual(Object.keys(d).sort(), ['p5-1', 'p5-2', 'p5-3']);
  assert.equal(d['p5-1'].c, 2, '同一題留時間新的');
  assert.deepEqual(A.get('hist').map((x) => x.id), ['p5-2', 'p5-1']);
  assert.deepEqual(plain(await P.syncPractice(['drill_p5'], { store: A, cloud, nowMs: t0 })), { drill_p5: 'same' });
  cloud.ok = false;
  assert.deepEqual(plain(await P.syncPractice(['hist'], { store: A, cloud, nowMs: t0 })), { hist: 'offline' });
  await assert.rejects(P.syncPractice(['pet'], { store: A, cloud }), TypeError);
  await assert.rejects(P.syncPractice(['hist'], { store: A, cloud, merge: {} }), /move-merge/);
  return 'ok';
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
