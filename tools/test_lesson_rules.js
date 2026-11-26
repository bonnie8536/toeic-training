/* 課程判定規則(js/lesson-rules.js):考點鍵、考點狀態、題組型週累計、小檢核判定、回顧排程、弱點補練、測驗檢討。
   node + vm,不開瀏覽器。用法:node tools/test_lesson_rules.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
function load() {
  const ctx = { console, Map, Set, JSON, Object, Array, Math, Number, String, Date, TypeError, Error, isNaN };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('data/bank-meta.js'), ctx);
  vm.runInContext(read('js/sync-merge.js'), ctx, { filename: 'js/sync-merge.js' });
  vm.runInContext(read('js/sync-merge-lesson.js'), ctx, { filename: 'js/sync-merge-lesson.js' });
  vm.runInContext(read('js/lesson-rules.js'), ctx, { filename: 'js/lesson-rules.js' });
  return ctx;
}
const CTX = load();
const R = CTX.LESSON_RULES;
const plain = (x) => JSON.parse(JSON.stringify(x));
const live = (q) => q.filter((e) => !e.x);
const D = '2026-11-24';   // 週二
/* 一批作答:n 題、ok 題對 */
const batch = (key, n, ok) => Array.from({ length: n }, (_, i) => ({ key, ok: i < ok, first: true }));
function hit(pts, key, d, n, ok, src, b) {
  return R.addHits(pts, batch(key, n, ok), { today: d, src: src || 'p', b: b || key + d + (src || 'p') + n + ok });
}

const T = {};

T['L1 日期:跨月跨年加減天數、週一、天數差;格式不對丟錯'] = () => {
  assert.equal(R.addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(R.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(R.weekOf('2026-11-24'), '2026-11-23');
  assert.equal(R.weekOf('2026-11-29'), '2026-11-23');   // 週日屬於同一週
  assert.equal(R.weekOf('2026-11-30'), '2026-11-30');
  assert.equal(R.daysBetween('2026-11-24', '2026-12-15'), 21);
  assert.throws(() => R.addDays('2026/11/24', 1), TypeError);
  assert.throws(() => R.weekOf('2026-13-01'), TypeError);
  return 'ok';
};

T['L2 考點鍵換成舊欄位寫法(補標前):P5 依舊分類、P2 依問句種類、P3／P4／P7 整組、P6 依小題題型'] = () => {
  const want = {
    'P1.photo': 'P1.photo', 'P2.wh': 'P2.wh', 'P2.yn': 'P2.yn', 'P2.request': 'P2.request', 'P2.tag': 'P2.neg', 'P2.neg': 'P2.neg',
    'P2.statement': 'P2.statement', 'P3.gist': 'P3.set', 'P4.detail': 'P4.set', 'P7.not': 'P7.set', 'P7.set': 'P7.set',
    'P5.noun_slot': 'P5.cat:詞性變化', 'P5.adv_slot': 'P5.cat:詞性變化', 'P5.tense': 'P5.cat:動詞時態與語態', 'P5.pron_case': 'P5.cat:代名詞',
    'P5.vocab_verb': 'P5.cat:字彙辨析', 'P5.cat:介系詞': 'P5.cat:介系詞', 'P5.sub_conj': 'P5.cat:連接詞vs介系詞',
    'P6.grammar': 'P6.type:文法', 'P6.transition': 'P6.type:文法', 'P6.vocab': 'P6.type:字彙', 'P6.insertion': 'P6.type:句子插入', 'P6.type:文法': 'P6.type:文法',
  };
  Object.keys(want).forEach((k) => assert.equal(R.legacyKey(k), want[k], k));
  ['P1.gist', 'P2.unknown', 'P5.nothing', 'X1.a', '', null].forEach((k) => assert.equal(R.legacyKey(k), null, String(k)));
  assert.deepEqual(plain(R.bankWhere('P2.yn')), { part: '2', where: { category: ['Yes/No問句'], canYou: false } });
  assert.deepEqual(plain(R.bankWhere('P2.request')), { part: '2', where: { category: ['Yes/No問句'], canYou: true } });
  assert.deepEqual(plain(R.bankWhere('P5.adj_slot')), { part: '5', where: { category: ['詞性變化'] } });
  assert.deepEqual(plain(R.bankWhere('P6.insertion')), { part: '6', where: { type: ['句子插入'] } });
  assert.deepEqual(plain(R.bankWhere('P3.gist')), { part: '3', where: {} });
  return Object.keys(want).length + ' 個鍵';
};

T['L3 題目索引每一筆都換得出考點鍵:Can you 開頭的是非問句算請求,P6 每小題照題型,題組照小題數'] = () => {
  const items = CTX.BANK_META.items;
  const bad = items.filter((r) => { const k = R.keysOfRow(r); return !k.length || k.some((x) => R.legacyKey(x) !== x); });
  assert.deepEqual(bad.map((r) => r.id), []);
  const req = items.filter((r) => R.keysOfRow(r)[0] === 'P2.request').map((r) => r.id);
  assert.deepEqual(req, ['l2-12', 'l2-38', 'l2-49', 'l2-66', 'l2-92']);
  const p6 = items.filter((r) => r.part === '6')[0];
  assert.deepEqual(plain(R.keysOfRow(p6)), p6.types.map((t) => 'P6.type:' + t));
  const p7 = items.filter((r) => r.part === '7')[0];
  assert.equal(R.keysOfRow(p7).length, p7.size);
  return items.length + ' 筆';
};

T['L4 學習包裡用到的考點鍵(主考點、主考點格、每堂主考點、小檢核)都換得出舊欄位寫法與選題條件'] = () => {
  const keys = new Set();
  fs.readdirSync(path.join(REPO, 'data/packs')).filter((f) => /^pack_(?!schema)/.test(f)).forEach((f) => {
    const p = JSON.parse(read('data/packs/' + f));
    p.mainPoints.listening.concat(p.mainPoints.reading).forEach((k) => keys.add(k));
    p.pointCells.forEach((c) => c.keys.forEach((k) => keys.add(k)));
    p.lessons.forEach((l) => {
      l.focus.listening.concat(l.focus.reading).forEach((k) => keys.add(k));
      if (l.checkpoint) l.checkpoint.listening.concat(l.checkpoint.reading).forEach((k) => keys.add(k));
    });
  });
  const bad = [...keys].filter((k) => !R.legacyKey(k) || !R.bankWhere(k));
  assert.deepEqual(bad, []);
  return keys.size + ' 個鍵';
};

T['L5 考點狀態:沒練→學習中→達標一次(met)→兩個不同日期達標且最近一天 ≥60% 才過關;過關後最近一天 <60% 退回'] = () => {
  let p = {};
  assert.equal(R.statusOf('P2.wh', p['P2.wh'], D), 'new');
  p = hit(p, 'P2.wh', '2026-11-20', 3, 3);
  assert.equal(p['P2.wh'].s, 'learning');
  p = hit(p, 'P2.wh', '2026-11-21', 5, 4);
  assert.equal(p['P2.wh'].s, 'met');
  p = hit(p, 'P2.wh', '2026-11-24', 5, 5);
  assert.equal(p['P2.wh'].s, 'passed');
  p = hit(p, 'P2.wh', '2026-11-26', 5, 2);
  assert.equal(p['P2.wh'].s, 'met', '最近一天 40%,不再算過關');
  return 'ok';
};

T['L6 題組型週累計:同一週不同天加起來 ≥5 題 ≥80% 算達標;單題型要同一天;題組型過關要兩個不同週'] = () => {
  let p = hit({}, 'P3.set', '2026-11-23', 3, 3);
  p = hit(p, 'P3.set', '2026-11-25', 3, 3);
  assert.equal(p['P3.set'].s, 'met');
  p = hit(p, 'P3.set', '2026-11-27', 6, 6);
  assert.equal(p['P3.set'].s, 'met', '同一週再達標還是同一次');
  p = hit(p, 'P3.set', '2026-12-01', 6, 5);
  assert.equal(p['P3.set'].s, 'passed');
  let q = hit({}, 'P2.yn', '2026-11-23', 3, 3);
  q = hit(q, 'P2.yn', '2026-11-25', 3, 3);
  assert.equal(q['P2.yn'].s, 'learning');
  return 'ok';
};

T['L7 弱點:近 60 天首次作答 ≥5 題且 <60%;或最近一次小檢核判為弱點(整體答對率還好也算)'] = () => {
  let p = hit({}, 'P5.cat:代名詞', '2026-11-20', 6, 3);
  assert.equal(p['P5.cat:代名詞'].s, 'weak');
  let q = hit({}, 'P2.wh', '2026-11-20', 10, 10);
  q = hit(q, 'P2.wh', '2026-11-24', 5, 2, 'c');
  assert.equal(q['P2.wh'].s, 'weak');
  q = hit(q, 'P2.wh', '2026-11-25', 5, 3, 'c');
  assert.equal(q['P2.wh'].s, 'met', '最近一次小檢核 60% 就不是弱點');
  return 'ok';
};

T['L8 卡關:弱點補練 3 次(每次 ≥5 題)都 <60% → 卡關,暫停 7 天;暫停過後回到弱點,要再 3 次才又卡關'] = () => {
  let p = {};
  ['2026-11-10', '2026-11-12', '2026-11-14'].forEach((d, i) => { p = hit(p, 'P5.cat:關係詞', d, 5, 2, 'w', 'w' + i); });
  assert.equal(p['P5.cat:關係詞'].s, 'stuck');
  assert.equal(p['P5.cat:關係詞'].pauseUntil, '2026-11-21');
  assert.equal(R.statusOf('P5.cat:關係詞', p['P5.cat:關係詞'], '2026-11-20'), 'stuck');
  assert.equal(R.statusOf('P5.cat:關係詞', p['P5.cat:關係詞'], '2026-11-21'), 'weak');
  p = hit(p, 'P5.cat:關係詞', '2026-11-22', 5, 1, 'w', 'w3');
  assert.equal(p['P5.cat:關係詞'].s, 'weak');
  assert.equal(p['P5.cat:關係詞'].pauseUntil, '2026-11-21');
  return 'ok';
};

T['L9 記作答:只算第一次作答;同一批重送留題數多的;不改傳進來的物件;60 天前的批次刪掉、60 天內不照批數刪;60 天前的不算'] = () => {
  const before = hit({}, 'P2.wh', '2026-11-20', 3, 3, 'p', 'b1');
  const snap = JSON.stringify(before);
  const after = R.addHits(before, [{ key: 'P2.wh', ok: true, first: false }, { key: 'P2.wh', ok: false, first: true }], { today: '2026-11-21', src: 'p', b: 'b2' });
  assert.equal(JSON.stringify(before), snap);
  assert.deepEqual(plain(after['P2.wh'].hits.map((h) => [h.b, h.n, h.ok])), [['b1', 3, 3], ['b2', 1, 0]]);
  const again = R.addHits(after, batch('P2.wh', 5, 5), { today: '2026-11-21', src: 'p', b: 'b2' });
  assert.deepEqual(plain(again['P2.wh'].hits.map((h) => [h.b, h.n])), [['b1', 3], ['b2', 5]]);
  const less = R.addHits(again, batch('P2.wh', 2, 2), { today: '2026-11-21', src: 'p', b: 'b2' });
  assert.equal(less['P2.wh'].hits.filter((h) => h.b === 'b2')[0].n, 5);
  /* 60 天內 45 批(最早那天 5 題全對、之後每天 1 題):最早那天的達標還在 */
  let many = hit({}, 'P1.photo', '2026-10-01', 5, 5, 'p', 'm0');
  for (let i = 1; i < 45; i++) many = hit(many, 'P1.photo', R.addDays('2026-10-01', i), 1, 1, 'p', 'm' + i);
  assert.equal(many['P1.photo'].hits.length, 45);
  many = hit(many, 'P1.photo', '2026-11-20', 5, 5, 'p', 'last');
  assert.equal(many['P1.photo'].s, 'passed', '10-01 與 11-20 兩天達標');
  const later = hit(many, 'P1.photo', '2026-12-05', 1, 1, 'p', 'later');
  assert.ok(later['P1.photo'].hits.every((h) => h.d >= '2026-10-06'), '60 天前的批次刪掉');
  assert.equal(R.statusOf('P1.photo', hit({}, 'P1.photo', '2026-09-01', 5, 5)['P1.photo'], D), 'new');
  assert.throws(() => R.addHits({}, [], { today: D, src: 'x', b: 'b' }), TypeError);
  assert.throws(() => R.addHits({}, [], { today: D, src: 'p' }), TypeError);
  return 'ok';
};

T['L10 兩台的考點狀態合併:批次聯集、同一批留題數多的、暫停取晚的,合併後重算(兩台各達標一天 → 過關)'] = () => {
  const a = hit({}, 'P2.wh', '2026-11-20', 5, 5, 'p', 'A1');
  const b = hit(hit({}, 'P2.wh', '2026-11-22', 5, 5, 'p', 'B1'), 'P2.wh', '2026-11-20', 3, 3, 'p', 'A1');
  const m = R.mergePts(a, b, D);
  assert.equal(m['P2.wh'].s, 'passed');
  assert.deepEqual(plain(m['P2.wh'].hits.map((h) => [h.b, h.n]).sort()), [['A1', 5], ['B1', 5]]);
  const x = { 'P5.cat:代名詞': { s: 'stuck', hits: [], pauseUntil: '2026-11-25' } }, y = { 'P5.cat:代名詞': { s: 'stuck', hits: [], pauseUntil: '2026-11-28' } };
  assert.equal(R.mergePts(x, y, D)['P5.cat:代名詞'].pauseUntil, '2026-11-28');
  assert.deepEqual(plain(R.mergePts(null, a, D)), plain(R.mergePts(a, undefined, D)));
  return 'ok';
};

T['L11 小檢核判定:5 題對 4–5 達標、3 持平、0–2 弱點;不到 5 題只判持平或弱點;題組型不足 5 題併前 7 天;另一天已達標的這次達標就過關'] = () => {
  const run = (key, n, ok, pts, d) => plain(R.judgeCheckpoint(batch(key, n, ok), pts || {}, d || D))[0];
  assert.equal(run('P2.wh', 5, 5).verdict, 'met');
  assert.equal(run('P2.wh', 5, 4).verdict, 'met');
  assert.equal(run('P2.wh', 5, 3).verdict, 'hold');
  assert.equal(run('P2.wh', 5, 2).verdict, 'weak');
  assert.equal(run('P2.wh', 5, 0).verdict, 'weak');
  assert.equal(run('P5.noun_slot', 4, 4).verdict, 'hold');
  assert.equal(run('P5.noun_slot', 4, 4).key, 'P5.cat:詞性變化');
  assert.equal(run('P3.set', 6, 5).verdict, 'met');
  const prior = hit({}, 'P6.type:文法', '2026-11-20', 2, 2);
  const g = run('P6.type:文法', 4, 4, prior);
  assert.deepEqual([g.n, g.ok, g.verdict], [6, 6, 'met']);
  const old = hit({}, 'P6.type:文法', '2026-11-10', 2, 2);
  assert.equal(run('P6.type:文法', 4, 4, old).verdict, 'hold', '超過 7 天的不併');
  const was = hit({}, 'P2.wh', '2026-11-20', 5, 5);
  assert.equal(run('P2.wh', 5, 5, was).passes, true);
  assert.equal(run('P2.wh', 5, 5, hit({}, 'P2.wh', D, 5, 5)).passes, false, '同一天不算兩個日期');
  return 'ok';
};

T['L12 還沒過關的考點:一般是「不是過關」,第 24 堂只取「達標一次、還沒過關」'] = () => {
  let p = hit({}, 'P2.wh', '2026-11-20', 5, 5);
  p = hit(p, 'P2.wh', '2026-11-21', 5, 5);
  p = hit(p, 'P2.yn', '2026-11-21', 5, 5);
  const keys = ['P2.wh', 'P2.yn', 'P5.tense'];
  assert.deepEqual(plain(R.unpassedKeys(p, keys)), ['P2.yn', 'P5.cat:動詞時態與語態']);
  assert.deepEqual(plain(R.unpassedKeys(p, keys, true)), ['P2.yn']);
  return 'ok';
};

T['L13 錯題重做 D+1、D+7、D+21(從答錯那天算),三次都對移出;任一次錯從 D+1 重排;考點過關排 D+7、D+21 的回顧'] = () => {
  const ref = { m: 'l2', id: 'l2-05', sub: null };
  let q = R.scheduleWrong([], ref, '2026-11-01');
  assert.deepEqual(plain(q), [{ m: 'l2', id: 'l2-05', sub: null, due: '2026-11-02', step: 1, d0: '2026-11-01' }]);
  q = R.reviewDone(q, ref, true, '2026-11-02');
  assert.deepEqual([q[0].step, q[0].due], [7, '2026-11-08']);
  q = R.reviewDone(q, ref, true, '2026-11-08');
  assert.deepEqual([q[0].step, q[0].due], [21, '2026-11-22']);
  assert.deepEqual(plain(live(R.reviewDone(q, ref, true, '2026-11-22'))), []);
  const wrong = R.reviewDone(q, ref, false, '2026-11-22');
  assert.deepEqual([wrong[0].step, wrong[0].due, wrong[0].d0], [1, '2026-11-23', '2026-11-22']);
  let k = R.schedulePassed([], 'P2.tag', '2026-11-01');
  assert.deepEqual(plain(k), [{ k: 'P2.neg', due: '2026-11-08', step: 7, d0: '2026-11-01' }]);
  assert.equal(R.schedulePassed(k, 'P2.neg', '2026-11-05').length, 1);
  k = R.reviewDone(k, { k: 'P2.neg' }, true, '2026-11-08');
  assert.deepEqual([k[0].step, k[0].due], [21, '2026-11-22']);
  assert.deepEqual(plain(live(R.reviewDone(k, { k: 'P2.neg' }, false, '2026-11-22'))), [], '考點回顧 ≤1/3 就不再排(考點狀態會退回)');
  const p3 = R.scheduleWrong([], { m: 'l3', id: 'l3-02', sub: 2 }, D);
  assert.equal(R.scheduleWrong(p3, { m: 'l3', id: 'l3-02', sub: 1 }, D).length, 2, '題組不同小題分開排');
  return 'ok';
};

T['L14 開回顧段:到期的才出,錯題重做在前、到期日舊的先、同日答對率低的先;單位與秒數都有上限;逾期 >14 天的錯題只留最近 30 題,其餘改成考點回顧'] = () => {
  const q = [
    { k: 'P2.wh', due: '2026-11-20', step: 7, d0: '2026-11-13' },
    { m: 'p5', id: 'p5-b', sub: null, due: '2026-11-23', step: 1, d0: '2026-11-22' },
    { m: 'p5', id: 'p5-a', sub: null, due: '2026-11-23', step: 1, d0: '2026-11-22' },
    { m: 'l1', id: 'l1-x', sub: null, due: '2026-11-21', step: 7, d0: '2026-11-14' },
    { m: 'p5', id: 'p5-c', sub: null, due: '2026-11-30', step: 1, d0: '2026-11-29' },
  ];
  const acc = { 'p5-a': 0.3, 'p5-b': 0.9 };
  const r = R.pickReview(q, { today: D, seconds: 480, maxUnits: 12, secondsOf: () => 40, keyOf: (e) => e.id, accuracy: (k) => (acc[k] === undefined ? 1 : acc[k]) });
  assert.deepEqual(r.units.map((e) => e.id || e.k), ['l1-x', 'p5-a', 'p5-b', 'P2.wh']);
  assert.equal(R.pickReview(q, { today: D, seconds: 480, maxUnits: 2, secondsOf: () => 40 }).units.length, 2);
  assert.equal(R.pickReview(q, { today: D, seconds: 100, maxUnits: 12, secondsOf: () => 40 }).units.length, 2);
  const old = Array.from({ length: 35 }, (_, i) => ({ m: 'p5', id: 'p5-o' + i, sub: null, due: R.addDays('2026-10-01', i % 5), step: 1, d0: R.addDays('2026-09-01', i) }));
  const t = R.pickReview(old, { today: D, seconds: 0, maxUnits: 0, secondsOf: () => 40, keyOf: () => 'P5.tense' });
  assert.equal(t.rvq.filter((e) => !e.k).length, 30);
  assert.deepEqual(t.rvq.filter((e) => e.k).map((e) => e.k), ['P5.cat:動詞時態與語態']);
  assert.ok(t.rvq.filter((e) => !e.k).every((e) => e.d0 >= '2026-09-06'), '留下的是最近答錯的 30 題');
  return 'ok';
};

T['L15 兩台的回顧佇列合併:同一項取新的(d0 晚、一樣時 step 大),總數最多 300(留最近答錯的)'] = () => {
  const a = [{ m: 'p5', id: 'p5-a', sub: null, due: '2026-11-30', step: 7, d0: '2026-11-23' }];
  const b = [{ m: 'p5', id: 'p5-a', sub: null, due: '2026-11-25', step: 1, d0: '2026-11-24' }, { k: 'P2.wh', due: '2026-11-26', step: 7, d0: '2026-11-19' }];
  const m = R.mergeRvq(a, b);
  assert.equal(m.length, 2);
  assert.equal(m.filter((e) => e.id === 'p5-a')[0].due, '2026-11-25');
  const big = Array.from({ length: 320 }, (_, i) => ({ m: 'p5', id: 'x' + i, sub: null, due: D, step: 1, d0: R.addDays('2026-01-01', i) }));
  const c = R.mergeRvq(big, null);
  assert.equal(c.length, R.RVQ_MAX);
  assert.ok(c.every((e) => e.d0 >= R.addDays('2026-01-01', 20)));
  return 'ok';
};

function weakPts() {
  let p = hit({}, 'P5.cat:關係詞', '2026-11-20', 10, 3);
  p = hit(p, 'P2.wh', '2026-11-20', 10, 5);
  p = hit(p, 'P5.cat:介系詞', '2026-11-20', 10, 1);
  p = hit(p, 'P1.photo', '2026-11-20', 10, 9);
  return p;
}

T['L16 弱點補練:只取弱點考點、先備是弱點或沒練就改補先備;依 (0.6−答對率)×權重 排、取前 2 個、各半時間'] = () => {
  /* P2.wh (0.6−0.5)×11=1.1、介系詞 (0.6−0.1)×2=1.0、關係詞 (0.6−0.3)×2=0.6(先備代名詞沒練過,換成代名詞);照片 90% 不是弱點 */
  const plans = plain(R.planWeak({ pts: weakPts(), levels: { listening: 'advanced', reading: 'advanced' }, seconds: 660, today: D }));
  assert.deepEqual(plans.map((x) => [x.key, x.reason, x.seconds]), [['P2.wh', 'weak:P2.wh', 330], ['P5.cat:介系詞', 'weak:P5.cat:介系詞', 330]]);
  const three = plain(R.planWeak({ pts: hit({}, 'P5.cat:關係詞', D, 10, 3), levels: { listening: 'threshold', reading: 'threshold' }, seconds: 660, today: D }));
  assert.deepEqual(three.map((x) => [x.key, x.reason]), [['P5.cat:代名詞', 'prereq:P5.cat:代名詞']]);
  const one = plain(R.planWeak({ pts: hit({}, 'P5.cat:介系詞', D, 5, 1), levels: { listening: 'entry', reading: 'advanced' }, seconds: 600, today: D }));
  assert.deepEqual(one.map((x) => [x.key, x.seconds, x.base]), [['P5.cat:介系詞', 600, null]], '閱讀級進階不改派文法單元');
  assert.throws(() => R.planWeak({ pts: {}, levels: { listening: 'x', reading: 'entry' }, seconds: 60, today: D }), TypeError);
  return 'ok';
};

T['L17 弱點補練:聽讀差一級時弱科的考點排前面、分到 2/3;入門閱讀 P5 文法類 <40% 先派文法單元、入門聽力 P1／P2 <40% 先派聽寫 5 句'] = () => {
  const p = weakPts();
  const mixed = plain(R.planWeak({ pts: p, levels: { listening: 'threshold', reading: 'entry' }, seconds: 840, today: D, doneUnits: new Set(['gg-01']) }));
  assert.equal(mixed[0].track, 'reading');
  assert.deepEqual(mixed.map((x) => x.seconds), [560, 280]);
  const prep = mixed.filter((x) => x.key === 'P5.cat:介系詞')[0];
  assert.deepEqual(prep.base, { module: 'grammar', ids: ['gg-02'], seconds: 480 }, '做過的單元跳過');
  const lis = plain(R.planWeak({ pts: hit({}, 'P2.yn', D, 5, 1), levels: { listening: 'entry', reading: 'entry' }, seconds: 660, today: D }));
  assert.deepEqual(lis[0].base, { module: 'ear_dictation', count: 5, seconds: 300 });
  assert.equal(R.weakCount(lis[0]), Math.floor((660 - 300) / 35));
  assert.equal(R.weakCount({ part: '3', seconds: 100, base: null }), 1, '題組至少 1 組');
  return 'ok';
};

T['L18 弱點補練沒有候選:a 最近一次測驗答對率最低的 Part、b 下週主考點、c 閱讀 P5 混合'] = () => {
  const base = { pts: {}, levels: { listening: 'entry', reading: 'entry' }, seconds: 840, today: D };
  const a = R.planWeak(Object.assign({}, base, { fallback: { testParts: { P1: { n: 3, ok: 3 }, P2: { n: 12, ok: 4 }, P5: { n: 15, ok: 9 } } } }))[0];
  assert.deepEqual([a.reason, a.part, a.track, a.seconds], ['fallback:a', '2', 'listening', 840]);
  const b = R.planWeak(Object.assign({}, base, { fallback: { nextFocus: ['P5.tense'] } }))[0];
  assert.deepEqual([b.reason, b.key], ['fallback:b', 'P5.cat:動詞時態與語態']);
  const c = R.planWeak(base)[0];
  assert.deepEqual([c.reason, c.part], ['fallback:c', '5']);
  return 'ok';
};

T['L19 測驗檢討:聽讀各取答對率最低的 Part,各 1 張技巧卡＋1 個新題區塊;12 種組合都落在 800–890 秒'] = () => {
  const parts = { P1: { n: 3, ok: 3 }, P2: { n: 13, ok: 6 }, P3: { n: 18, ok: 12 }, P4: { n: 15, ok: 9 }, P5: { n: 15, ok: 12 }, P6: { n: 8, ok: 3 }, P7: { n: 27, ok: 15 } };
  const plan = plain(R.planTestReview(parts));
  assert.deepEqual(plan.map((x) => x.kind + (x.part ? x.part : '') + (x.count ? 'x' + x.count : '')), ['result', 'tip2', 'items2x7', 'tip6', 'items6x1', 'items5x1']);
  assert.equal(plan[1].id, 'tip-P2-wh');
  const totals = [];
  ['1', '2', '3', '4'].forEach((l) => ['5', '6', '7'].forEach((r) => {
    const p = { ['P' + l]: { n: 10, ok: 0 }, ['P' + r]: { n: 10, ok: 0 } };
    const s = R.planTestReview(p).reduce((a, x) => a + x.seconds, 0);
    totals.push(s);
    assert.ok(s >= 800 && s <= 890, 'P' + l + '＋P' + r + ' 是 ' + s + ' 秒');
  }));
  return '秒數 ' + Math.min(...totals) + '–' + Math.max(...totals);
};

T['L20 小檢核那一批自己判:第 4 堂小檢核 5/5 之後同一天聽力段 3/7,狀態仍是達標;第 8 堂再 5/5 就過關,判定的 passes 跟狀態一致'] = () => {
  const K = 'P2.wh', d3 = '2026-11-23', d4 = '2026-11-26', d8 = '2026-12-10';
  let p = hit({}, K, d3, 16, 10, 'p', 'L3');
  const j4 = plain(R.judgeCheckpoint(batch(K, 5, 5), p, d4))[0];
  assert.deepEqual([j4.verdict, j4.passes], ['met', false]);
  p = R.addHits(p, batch(K, 5, 5), { today: d4, src: 'c', b: 'L4cp' });
  assert.equal(p[K].s, 'met');
  p = hit(p, K, d4, 7, 3, 'p', 'L4lis');
  assert.equal(p[K].s, 'met', '同一天其他練習不跟小檢核合算');
  const j8 = plain(R.judgeCheckpoint(batch(K, 5, 5), p, d8))[0];
  assert.deepEqual([j8.verdict, j8.passes], ['met', true]);
  p = R.addHits(p, batch(K, 5, 5), { today: d8, src: 'c', b: 'L8cp' });
  assert.equal(p[K].s, 'passed');
  /* 反過來:小檢核不到 5 題只判持平或弱點,同一天其他練習不會讓它變成達標 */
  let q = R.addHits({}, batch('P5.cat:介系詞', 4, 4), { today: D, src: 'c', b: 'cp' });
  q = hit(q, 'P5.cat:介系詞', D, 2, 2, 'p', 'x');
  assert.equal(q['P5.cat:介系詞'].s, 'learning');
  assert.equal(q['P5.cat:介系詞'].hits[0].v, 'h');
  return 'ok';
};

T['L21 題組型小檢核:不到 5 題併往前 7 天(含今天稍早)的作答,判達標就是那一週的一次達標;週五開始上課跨兩週也一樣'] = () => {
  const K = 'P6.type:文法';
  let p = hit({}, K, '2026-11-27', 2, 2, 'p', 'fri');        // 週五主課
  p = hit(p, K, '2026-11-30', 1, 1, 'p', 'mon-early');         // 下週一,同一天稍早
  const j = plain(R.judgeCheckpoint(batch(K, 3, 3), p, '2026-11-30'))[0];
  assert.deepEqual([j.n, j.ok, j.verdict], [6, 6, 'met']);
  p = R.addHits(p, batch(K, 3, 3), { today: '2026-11-30', src: 'c', b: 'cp' });
  assert.equal(p[K].s, 'met', '小檢核的 7 天合併結果記成 11-30 那一週的達標');
  p = hit(p, K, '2026-12-08', 6, 6, 'p', 'next');
  assert.equal(p[K].s, 'passed', '另一週再達標一次就過關');
  return 'ok';
};

T['L22 考點回顧答對不到 2/3:之前的達標不算,狀態退回學習中;之後要再兩次達標才過關;回顧 2/3 以上不影響'] = () => {
  const K = 'P2.wh';
  let p = hit(hit({}, K, '2026-11-01', 5, 5, 'p', 'a'), K, '2026-11-03', 5, 5, 'p', 'b');
  assert.equal(p[K].s, 'passed');
  const okReview = R.addHits(p, batch(K, 3, 2), { today: '2026-11-10', src: 'r', b: 'r1' });
  assert.equal(okReview[K].s, 'passed');
  p = R.addHits(p, batch(K, 3, 1), { today: '2026-11-10', src: 'r', b: 'r1' });
  assert.equal(p[K].s, 'learning');
  p = hit(p, K, '2026-11-12', 5, 5, 'p', 'c');
  assert.equal(p[K].s, 'met');
  p = hit(p, K, '2026-11-14', 5, 5, 'p', 'd');
  assert.equal(p[K].s, 'passed');
  assert.throws(() => R.addHits({}, [], { today: D, src: 'x', b: 'b' }), TypeError);
  return 'ok';
};

T['L23 回顧佇列:舊分頁還在第 1 步不會蓋掉第 7 步;做完移出的留刪除紀錄,舊佇列合併不會帶回來;14 天後刪除紀錄清掉;再答錯照樣重排'] = () => {
  const ref = { m: 'p5', id: 'p5-9', sub: null };
  const stale = R.scheduleWrong([], ref, '2026-11-01');
  let q = R.reviewDone(stale, ref, true, '2026-11-02');
  assert.deepEqual([R.mergeRvq(stale, q)[0].step, R.mergeRvq(q, stale)[0].step], [7, 7]);
  q = R.reviewDone(R.reviewDone(q, ref, true, '2026-11-08'), ref, true, '2026-11-22');
  assert.deepEqual(plain(live(q)), []);
  assert.deepEqual(plain(live(R.mergeRvq(stale, q))), [], '做完移出的不會被舊佇列帶回來');
  const step21 = R.reviewDone(R.reviewDone(stale, ref, true, '2026-11-02'), ref, true, '2026-11-08');
  assert.deepEqual(plain(live(R.mergeRvq(q, step21))), [], '最後一步之前的舊佇列也一樣');
  assert.equal(q.filter((e) => e.x).length, 1);
  assert.equal(R.scheduleWrong(q, { m: 'p5', id: 'p5-1' }, '2026-12-07').filter((e) => e.x).length, 0, '14 天後刪除紀錄清掉');
  const again = R.scheduleWrong(q, ref, '2026-11-25');
  assert.deepEqual(plain(live(R.mergeRvq(again, q))).map((e) => [e.id, e.step, e.d0]), [['p5-9', 1, '2026-11-25']], '刪除之後又答錯:新的那筆贏');
  const kq = R.reviewDone(R.schedulePassed([], 'P2.wh', '2026-11-01'), { k: 'P2.wh' }, false, '2026-11-08');
  assert.equal(live(R.schedulePassed(kq, 'P2.wh', '2026-11-20')).length, 1, '回顧沒過、之後又過關:重新排');
  return 'ok';
};

T['L24 改派基礎模組的時間:文法單元 480 秒的考點先分足,另一個拿剩下的;兩個都改派放不下就只出第一個;合計等於段的秒數'] = () => {
  const p = hit(hit({}, 'P5.cat:介系詞', D, 10, 1), 'P2.wh', D, 10, 5);
  const one = plain(R.planWeak({ pts: p, levels: { listening: 'threshold', reading: 'threshold' }, seconds: 660, today: D }));
  assert.deepEqual(one.map((x) => [x.key, x.seconds, !!x.base]), [['P2.wh', 180, false], ['P5.cat:介系詞', 480, true]]);
  assert.equal(one.reduce((a, x) => a + x.seconds - (x.base ? x.base.seconds : 0), 0) + 480, 660);
  const two = hit(hit({}, 'P5.cat:介系詞', D, 10, 1), 'P5.cat:代名詞', D, 10, 1);
  const both = plain(R.planWeak({ pts: two, levels: { listening: 'entry', reading: 'entry' }, seconds: 660, today: D }));
  assert.equal(both.length, 1);
  assert.deepEqual([both[0].seconds, both[0].base.seconds], [660, 480]);
  const short = plain(R.planWeak({ pts: hit({}, 'P5.cat:介系詞', D, 10, 1), levels: { listening: 'entry', reading: 'entry' }, seconds: 300, today: D }));
  assert.equal(short[0].base, null, '整段放不下文法單元就不改派');
  return 'ok';
};

T['L25 個人段的難度:入門只出基礎、中級(P3、P4 只出基礎),門檻以上三種;不高於最近答錯那題;P6、P7 沒有難度'] = () => {
  assert.deepEqual(plain(R.personalDiff('entry', '2', null)), { allow: ['基礎', '中級'], up: null });
  assert.deepEqual(plain(R.personalDiff('entry', '3', '進階')), { allow: ['基礎'], up: null });
  assert.deepEqual(plain(R.personalDiff('entry', '5', '基礎')), { allow: ['基礎'], up: '中級' });
  assert.deepEqual(plain(R.personalDiff('threshold', '1', '中級')), { allow: ['基礎', '中級'], up: '進階' });
  assert.deepEqual(plain(R.personalDiff('high', '5', null)), { allow: ['基礎', '中級', '進階'], up: null });
  assert.equal(R.personalDiff('entry', '7', null), null);
  assert.throws(() => R.personalDiff('x', '5', null), TypeError);
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
