/* 課程頁的個人段與本堂結果(js/lesson-personal.js):真的 js/lesson-rules.js、js/pack-core.js、學習包、題目索引與題庫,
   假的 store、雲端、計時器(tools/lesson_kit.js),小假 DOM 與假共用元件(tools/test_lesson_test.js 的 domEnv)。
   跑回合的 runRound 與技巧卡畫面 views.tip 是這裡的假的(上課頁的那兩個由 js/lesson.js 給):假回合照題寫進度、回 { result, rows }。
   回顧:已凍結不重新規劃、沒有到期記略過且秒數轉給弱點補練、secondsOf／keyOf 同步回傳、題組只算原本答錯的小題、reviewDone;
   弱點補練:doneUnits 是 Set、nextFocus 是考點鍵陣列、第 24 堂不拼第 25 堂、第 2 堂走 fallback a、第 4 堂用到小檢核的結果;
   前測檢討:前測原題不出、第一步是前測結果;小檢核:題目都在清單內且不含前測題、判定與記錄用同一個陣列、先判再記、判定存在 pts、
   判定前關頁再開會補判且只判一次、過關的考點排考點回顧;本堂結果:答對數不含小檢核、一出現就記完成、補記考點用原本的來源與批次、
   重看不寫任何鍵、錯題不含小檢核、小檢核解析沒有題數、小檢核清單沒有數字、點心只在第一次。
   不開瀏覽器、不連網。用法:node tools/test_lesson_personal.js */
'use strict';
const assert = require('assert');
const K = require('./lesson_kit.js');
const H = require('./test_lesson_test.js');

const { eq, EE, TT, NOW, DAY, POOL } = K;
const { settle, text } = H;
const T = {};
const today = (e) => e.P.dayOf(e.clock.sec());
const plainSet = (s) => Object.prototype.toString.call(s) === '[object Set]';

/* 換掉 LESSON_RULES 幾個函式記下呼叫(凍結的物件換成複本;課程檔在函式裡才讀 LESSON_RULES) */
function spyRules(e, names) {
  const R = e.ctx.LESSON_RULES, calls = [];
  const copy = Object.assign({}, R);
  names.forEach((n) => { copy[n] = (...a) => { const out = R[n](...a); calls.push({ n, a, out }); return out; }; });
  e.ctx.LESSON_RULES = copy;
  return calls;
}
async function env(o) {
  const e = H.domEnv(o);
  await e.D.packs();
  e.meta = new Map((await e.B.meta()).map((r) => [r.id, r]));
  return e;
}
/* 開始第 no 堂(固定段選題、建立進度);回上課頁的 ctx,附假的 runRound 與 views */
async function open(e, no, lv, opt) {
  const l = e.lesson(lv || EE, no);
  const picked = (await e.P.pickFixed(l, e.P.newState(l, e.clock.sec()), e.D.ctx(l, e.clock.sec()))).state;
  await e.D.start(no, l, e.clock.sec(), 'class-a', picked);
  return page(e, no, lv, opt);
}
function page(e, no, lv, opt) {
  const o = opt || {};
  const pc = H.pageCtx(e, no, lv);
  pc.rounds = [];
  pc.tips = [];
  pc.runRound = (blocks, ro) => {
    pc.rounds.push({ blocks, opt: ro });
    if (o.exitAt && o.exitAt(pc.rounds.length, ro)) return Promise.resolve('exit');
    const rows = rowsFor(e, pc, blocks, o.ok || (() => true));
    if (rows.length) pc.setState(e.D.record(no, pc.lesson, rows));
    /* closeAt:交卷寫好進度後分頁就關了(回合一直沒有回來) */
    if (o.closeAt && o.closeAt(pc.rounds.length, ro)) return new Promise(() => {});
    return Promise.resolve({ result: { score: rows.filter((r) => r.ok).length, total: rows.length }, rows });
  };
  pc.views = { tip: (card, on) => { pc.tips.push(card.id); const n = e.dom.createElement('section'); const h = e.dom.createElement('h2'); h.append(card.title); n.append(h); pc.nextTip = on.next; pc.backTip = on.back; return n; } };
  return pc;
}
/* 假回合:這幾個區塊還沒答的題照引擎的方式寫(題組整組出;錯題重做 80 不是第一次作答);ok(b, id, sub) 決定對錯 */
function rowsFor(e, pc, blocks, ok) {
  const st = pc.state(), have = new Set((st.a || []).map((x) => x[0] + '|' + x[1] + '|' + (x[2] || 0))), rows = [], t = e.clock.sec();
  blocks.forEach((b) => {
    const ids = e.C.idsOf(b, st).filter((id, i, a) => a.indexOf(id) === i);
    ids.forEach((id) => {
      const row = e.meta.get(id);
      const subs = row ? e.C.itemKeys(e.C.partOfId(id), row, id).map((k) => k.sub) : [b.module === 'grammar' ? 1 : 0];
      subs.forEach((sub) => {
        if (have.has(b.idx + '|' + id + '|' + sub)) return;
        const good = !!ok(b.idx, id, sub);
        rows.push({ b: b.idx, id, sub, c: good ? 0 : 1, ok: good, f: b.idx !== 80, t });
      });
    });
  });
  return rows;
}
const segSt = (pc, slot) => pc.state().seg[slot].st;
const sets = (e, k) => e.store.sets.filter((x) => x === k).length;

/* ---------- 回顧 ---------- */
T['回顧:沒有到期項目記略過、不出畫面、不呼叫引擎;沒用完的秒數轉給弱點補練'] = async () => {
  const e = await env();
  const calls = spyRules(e, ['planWeak']);
  const pc = await open(e, 3);
  eq([await e.LP.review(pc), segSt(pc, 'review'), pc.rounds.length], ['done', 'skip', 0]);
  assert.equal(await e.LP.weak(pc), 'done');
  eq(calls[0].a[0].seconds, (11 + 8) * 60);
};

T['回顧:規劃時 secondsOf、keyOf 同步回傳(題目索引先建表);錯題重做的題組只算原本答錯的小題;reviewDone;已凍結的不重新規劃'] = async () => {
  const e = await env();
  const calls = spyRules(e, ['pickReview']);
  const d = today(e), y = e.R.addDays(d, -1);
  e.store.set('rvq', [{ m: 'p3', id: 'l3-11', sub: 2, due: d, step: 1, d0: y }, { m: 'p5', id: 'p5-b1-01', sub: null, due: d, step: 1, d0: y }]);
  const pc = await open(e, 3, EE, { ok: (b, id, sub) => b !== 80 || (id === 'l3-11' ? sub === 2 : false) });
  assert.equal(await e.LP.review(pc), 'done');
  const opt = calls[0].a[1];
  eq([typeof opt.secondsOf({ m: 'p3', id: 'l3-11', sub: 2 }), typeof opt.keyOf({ m: 'p5', id: 'p5-b1-01' }), opt.keyOf({ m: 'p5', id: 'p5-b1-01' })], ['number', 'string', 'P5.cat:詞性變化']);
  const pk = pc.state().pk[80];
  eq([pk.ids, pk.sub, pk.m, segSt(pc, 'review')], [['l3-11', 'p5-b1-01'], [2, null], ['p3', 'p5'], 'done']);
  eq(pc.rounds.map((r) => r.blocks.map((b) => b.module + ':' + b.track)), [['redo:listening'], ['redo:reading']]);
  eq(pc.state().a.filter((x) => x[0] === 80).map((x) => x[1] + ':' + x[2] + ':' + (x[4] & 2)), ['l3-11:1:0', 'l3-11:2:0', 'l3-11:3:0', 'p5-b1-01:0:0'], '整組出、都不是第一次作答');
  await e.D.flush();
  const q = e.store.peek('rvq');
  const of = (id, sub) => q.filter((x) => x.id === id && x.sub === sub)[0];
  eq([of('l3-11', 2).step, of('l3-11', 2).due, of('p5-b1-01', null).step, of('p5-b1-01', null).due], [7, e.R.addDays(y, 7), 1, e.R.addDays(d, 1)]);
  eq([of('l3-11', 1), of('l3-11', 3)], [undefined, undefined], '原本沒答錯的小題不排');
  const n = sets(e, 'rvq');
  const again = page(e, 3);
  again.setState(pc.state());
  await e.D.segment(3, again.lesson, 'review', 'doing', NOW);
  eq([calls.length, sets(e, 'rvq')], [1, n], '已經凍結:不再規劃');
};

T['回顧:考點回顧 3 題答對 2 題以上算通過(往後排),不到就移出'] = async () => {
  const e = await env();
  const d = today(e);
  e.store.set('rvq', [{ k: 'P1.photo', due: d, step: 7, d0: e.R.addDays(d, -7) }, { k: 'P5.cat:詞性變化', due: d, step: 7, d0: e.R.addDays(d, -7) }]);
  let n = 0;
  const pc = await open(e, 3, EE, { ok: (b) => (b === 81 ? true : b === 82 ? (n++ === 0) : true) });
  assert.equal(await e.LP.review(pc), 'done');
  const pk = pc.state().pk;
  eq([pk[81].r, pk[82].r, pk[81].ids.length, pk[82].ids.length], ['point_review:P1.photo', 'point_review:P5.cat:詞性變化', 3, 3]);
  await e.D.flush();
  const q = e.store.peek('rvq');
  eq([q.filter((x) => x.k === 'P1.photo')[0].step, !!q.filter((x) => x.k === 'P5.cat:詞性變化')[0].x], [21, true]);
};

/* ---------- 弱點補練 ---------- */
T['弱點補練:doneUnits 是 Set、nextFocus 是下一堂的考點鍵陣列;第 2 堂沒有考點資料走 fallback a(前測答對率最低的 Part)'] = async () => {
  const e = await env();
  const calls = spyRules(e, ['planWeak']);
  e.store.set('grammar_done', { 'ga-01': 1 });
  const parts = { P1: { n: 3, ok: 3 }, P2: { n: 12, ok: 2 }, P3: { n: 12, ok: 9 }, P4: { n: 9, ok: 7 }, P5: { n: 15, ok: 12 }, P6: { n: 8, ok: 6 }, P7: { n: 16, ok: 12 } };
  e.store.set('tests_v1', { t1: { pre: { form: 'interim_half', at: NOW - DAY, parts, items: [] } } });
  const pc = await open(e, 2);
  assert.equal(await e.LP.weak(pc), 'done');
  const o = calls[0].a[0], next = e.lesson(EE, 3).focus;
  eq([plainSet(o.doneUnits), Array.from(o.doneUnits), o.fallback.nextFocus, o.fallback.testParts], [true, ['ga-01'], next.listening.concat(next.reading), parts]);
  eq([calls[0].out[0].reason, calls[0].out[0].part, pc.state().pk[85].m], ['fallback:a', '2', 'p2']);
  eq([segSt(pc, 'weak'), pc.rounds.length > 0, pc.rounds.every((r) => r.opt.slot === 'weak')], ['done', true, true]);
};

T['弱點補練:第 24 堂不拼第 25 堂(nextFocus 是空陣列);已經凍結的照凍結的出'] = async () => {
  const e = await env();
  const calls = spyRules(e, ['planWeak']);
  const P = e.ctx.PACK_CORE, asked = [];
  e.ctx.PACK_CORE = Object.assign({}, P, { compose: (packs, lv, no) => { asked.push(no); return P.compose(packs, lv, no); } });
  const l = e.lesson(EE, 24);
  await e.D.start(24, l, NOW, 'class-a', e.P.newState(l, NOW));
  const pc = page(e, 24);
  assert.equal(await e.LP.weak(pc), 'done');
  eq([calls[0].a[0].fallback.nextFocus, asked.indexOf(25)], [[], -1]);
  const frozen = pc.state().pk[85];
  await e.D.segment(24, pc.lesson, 'weak', 'doing', NOW);
  pc.setState(e.store.peek('les_t1_24'));
  assert.equal(await e.LP.weak(pc), 'done');
  eq([calls.length, pc.state().pk[85]], [1, frozen]);
};

/* ---------- 前測檢討 ---------- */
async function lessonOneDone(e) {
  const l1 = e.lesson(EE, 1);
  const s0 = await e.ctx.LESSON_TEST.picked(H.pageCtx(e, 1));
  await e.D.start(1, l1, NOW - DAY, 'class-a', s0);
  let s = e.store.peek('les_t1_01');
  s = e.P.setSegment(e.P.setSegment(s, l1, 'test_listening', 'done', NOW - DAY), l1, 'test_reading', 'done', NOW - DAY);
  s.pk[0].ids.filter((id) => /^l1-/.test(id)).forEach((id) => { s = e.P.answer(s, { b: 0, id, c: 3, ok: false, f: true, t: NOW - DAY }); });
  e.store.set('les_t1_01', s);
  return s;
}
T['前測檢討:第一步是前測結果(Part 清單、暫用試卷那一行、下一步);前測原題不出;tests_v1 沒寫到就補寫'] = async () => {
  const e = await env();
  const s1 = await lessonOneDone(e);
  const pc = await open(e, 2);
  const run = e.LP.testReview(pc);
  await settle(60);
  eq([text(e.host.querySelector('h2')), text(e.host.querySelector('.mock-tag')), e.host.querySelectorAll('.lsn-row').length, text(e.host.querySelector('.lsn-go'))], ['前測結果', '暫用試卷', 7, '下一步']);
  assert.ok(/Part 1 照片描述0%/.test(text(e.host)), text(e.host));
  e.host.querySelector('.lsn-go').click();
  await settle(60);
  eq(pc.tips, ['tip-P1-photo']);
  pc.nextTip();
  await settle(60);
  pc.nextTip && pc.tips.length === 2 ? pc.nextTip() : null;
  await settle(60);
  assert.equal(await run, 'done');
  const testIds = new Set([].concat(s1.pk[0].ids, s1.pk[1].ids));
  const picked = Object.keys(pc.state().pk).map(Number).filter((i) => i >= 90).reduce((a, i) => a.concat(pc.state().pk[i].ids), []);
  eq([picked.filter((id) => testIds.has(id)), pc.state().pk[90].m, pc.state().pk[91].p, segSt(pc, 'test_review')], [[], 'tip', '1', 'done']);
  await e.D.flush();
  eq(e.store.peek('tests_v1').t1.pre.at, s1.doneAt, '補寫前測紀錄');
};

T['前測檢討:沒有前測資料時略過前測結果那一步;「← 回第 2 堂」離開'] = async () => {
  const e = await env();
  const pc = await open(e, 2);
  const run = e.LP.testReview(pc);
  await settle(60);
  eq([pc.tips, !!e.host.querySelector('.lsn-pre-step')], [['tip-P2-wh'], false]);
  pc.backTip();
  eq([await run, segSt(pc, 'test_review')], ['exit', 'doing']);
};

/* ---------- 小檢核 ---------- */
async function lessonFour(e, ok, opt) {
  const pc = await open(e, 4, TT, Object.assign({ ok }, opt));
  return pc;
}
async function walkCheckpoint(e, pc) {
  const run = e.LP.checkpoint(pc);
  for (let i = 0; i < 3; i++) {
    await settle(60);
    const go = e.host.querySelector('.lsn-go');
    if (go) go.click();
  }
  return run;
}
T['小檢核:題目都在清單內且不含前測題;說明頁題數、約幾分鐘、結果在本堂最後顯示;換科有「閱讀」說明頁;檢核回合不排考點、不出解析'] = async () => {
  const e = await env();
  const poolP1 = POOL.ids.filter((id) => /^l1-/.test(id));
  e.store.set('tests_v1', { t1: { pre: { form: 'interim_half', at: NOW - DAY, parts: {}, items: poolP1.slice(0, 12).map((id) => [id, 0, 0, true]) } } });
  const pc = await lessonFour(e, () => true);
  const cp = pc.lesson.segments.filter((s) => s.slot === 'checkpoint')[0].blocks.filter((b) => !b.fill);
  const ids = cp.reduce((a, b) => a.concat(pc.state().pk[b.idx].ids), []);
  const want = cp.reduce((a, b) => a + b.count, 0), reading = cp.filter((b) => b.module === 'p5').reduce((a, b) => a + b.count, 0);
  eq([ids.filter((id) => POOL.ids.indexOf(id) < 0), ids.filter((id) => poolP1.slice(0, 12).indexOf(id) > -1), ids.length, want], [[], [], want, 25]);
  const run = e.LP.checkpoint(pc);
  await settle(60);
  eq([text(e.host.querySelector('h2')), e.host.querySelectorAll('.mock-tag').map(text), text(e.host.querySelector('.lsn-rule'))], ['小檢核', [want + ' 題', '約 8 分鐘'], '結果在本堂最後顯示']);
  e.host.querySelector('.lsn-go').click();
  await settle(60);
  eq([text(e.host.querySelector('h2')), e.host.querySelectorAll('.mock-tag').map(text), e.host.querySelector('.lsn-rule')], ['閱讀', [reading + ' 題'], null]);
  e.host.querySelector('.lsn-go').click();
  assert.equal(await run, 'done');
  eq(pc.rounds.map((r) => [r.blocks.map((b) => b.module).join(','), r.opt.cp === true, r.opt.result === false, r.opt.bridge === false]),
    [['p1,p2', true, true, true], ['p5,p5,p5', true, true, true], ['grammar', false, false, false]]);
  eq(segSt(pc, 'checkpoint'), 'done');
};

T['小檢核:清單內的照片描述都做過、那一區塊凍結 0 題時,說明頁寫這次沒有照片描述的題,本堂結果那一列寫「沒有出題」(不判定、不整列消失)'] = async () => {
  const e = await env();
  const poolP1 = POOL.ids.filter((id) => /^l1-/.test(id));
  e.store.set('listen_p1', poolP1.reduce((o, id) => Object.assign(o, { [id]: { c: 0, ok: true, t: (NOW - 5 * DAY) * 1000 } }), {}));
  const pc = await lessonFour(e, () => true);
  const cp = pc.lesson.segments.filter((s) => s.slot === 'checkpoint')[0].blocks.filter((b) => !b.fill);
  const p1 = cp.filter((b) => b.module === 'p1')[0];
  eq([pc.state().pk[p1.idx].ids, cp.filter((b) => b !== p1).every((b) => pc.state().pk[b.idx].ids.length > 0)], [[], true]);
  const run = e.LP.checkpoint(pc);
  await settle(60);
  const want = cp.filter((b) => b !== p1).reduce((a, b) => a + b.count, 0);
  eq([e.host.querySelectorAll('.mock-tag').map(text)[0], e.host.querySelectorAll('.lsn-rule').map(text)], [want + ' 題', ['結果在本堂最後顯示', '這次沒有照片描述的題']]);
  e.host.querySelector('.lsn-go').click();
  await settle(60);
  eq(e.host.querySelectorAll('.lsn-rule').length, 0, '換科的「閱讀」說明頁不放這一行');
  e.host.querySelector('.lsn-go').click();
  assert.equal(await run, 'done');
  const later = pc.lesson.segments.filter((s) => ['vocab', 'listening', 'reading', 'review', 'weak'].indexOf(s.slot) > -1);
  for (const s of later) pc.setState(await e.D.segment(4, pc.lesson, s.slot, 'done', NOW));
  await e.D.flush();
  assert.equal(await e.LP.wrapup(pc), 'done');
  const rows = e.host.querySelectorAll('.lsn-row');
  eq([rows.map(text), rows[0].querySelector('.lsn-v-tag').className, rows[0].querySelector('.lsn-v-icon'), !!rows[1].querySelector('.lsn-v-icon')],
    [['照片描述沒有出題', 'WH 問句達標', '詞性達標'], 'lsn-v-tag is-none', null, true]);
  const pts = e.store.peek('pts');
  eq([(pts['P1.photo'] && pts['P1.photo'].hits || []).some((h) => h.b === 'les_t1_04:cp'), pts['P2.wh'].hits.some((h) => h.b === 'les_t1_04:cp')], [false, true]);
};

T['小檢核判定:兩個回合都交卷後判一次;判定與記錄用同一個陣列、先判再記、判定存在 pts 那一批的 v;答錯排回顧、過關的考點排考點回顧'] = async () => {
  const e = await env();
  const calls = spyRules(e, ['judgeCheckpoint', 'addHits']);
  const d = today(e), past = e.R.addDays(d, -10);
  e.store.set('pts', { 'P1.photo': { s: 'met', hits: [{ d: past, n: 5, ok: 5, src: 'p', b: 'old:1' }], pauseUntil: null } });
  const pc = await lessonFour(e, (b, id) => !/^p5-/.test(id) || id.charCodeAt(id.length - 1) % 2 === 0);
  assert.equal(await walkCheckpoint(e, pc), 'done');
  await e.D.flush();
  const j = calls.filter((c) => c.n === 'judgeCheckpoint'), cpHits = calls.filter((c) => c.n === 'addHits' && c.a[2].src === 'c');
  eq([j.length, cpHits.length, j[0].a[0] === cpHits[0].a[1], calls.indexOf(j[0]) < calls.indexOf(cpHits[0]), cpHits[0].a[2].b], [1, 1, true, true, 'les_t1_04:cp']);
  eq([j[0].a[0].length, j[0].a[0].every((a) => a.first === true)], [25, true]);
  const pts = e.store.peek('pts');
  const v = (k) => pts[k].hits.filter((h) => h.b === 'les_t1_04:cp')[0].v;
  eq([v('P1.photo'), v('P2.wh')], ['m', 'm']);
  const q = e.store.peek('rvq');
  eq([q.filter((x) => x.k === 'P1.photo').length, q.filter((x) => x.m === 'p5').length > 0, q.every((x) => x.m !== 'p1')], [1, true, true]);
};

T['判定前關頁:兩個回合都交卷、還沒判就離開,開頁補判一次;再補判、再進小檢核都不再判'] = async () => {
  const e = await env();
  const calls = spyRules(e, ['judgeCheckpoint']);
  const pc = await lessonFour(e, () => false, { closeAt: (n) => n === 2 });
  walkCheckpoint(e, pc);
  await settle(200);
  await e.D.flush();
  eq(pc.rounds.length, 2);
  eq([calls.length, e.C.judged(e.store.peek('pts') || {}, 'les_t1_04:cp')], [0, false]);
  const back = page(e, 4, TT);
  await e.LP.judge(back);
  await e.LP.judge(back);
  await e.D.flush();
  eq([calls.length, e.C.judged(e.store.peek('pts'), 'les_t1_04:cp')], [1, true]);
  const again = page(e, 4, TT);
  assert.equal(await walkCheckpoint(e, again), 'done');
  eq([calls.length, again.rounds.length, segSt(again, 'checkpoint')], [1, 1, 'done']);
};

T['第 4 堂的弱點補練用到小檢核的結果(判成弱點的考點)'] = async () => {
  const e = await env();
  const pc = await lessonFour(e, (b, id) => !/^p5-/.test(id));
  await walkCheckpoint(e, pc);
  assert.equal(await e.LP.weak(pc), 'done');
  const k = pc.state().pk[85].k || pc.state().pk[86].k;
  assert.ok(/^P5\.cat:/.test(k) || /^prereq:/.test(pc.state().pk[85].r), JSON.stringify(pc.state().pk[85]));
};

/* ---------- 本堂結果 ---------- */
async function lessonFourDone(e) {
  const pc = await lessonFour(e, (b, id, sub) => (b < 2 ? true : /^p5-/.test(id) ? false : (id.length + sub) % 3 !== 0));
  await walkCheckpoint(e, pc);
  const later = pc.lesson.segments.filter((s) => ['listening', 'reading'].indexOf(s.slot) > -1);
  for (const s of later) { await pc.runRound(s.blocks, { slot: s.slot }); pc.setState(await e.D.segment(4, pc.lesson, s.slot, 'done', NOW)); }
  pc.setState(await e.D.segment(4, pc.lesson, 'vocab', 'done', NOW));
  await e.LP.review(pc);
  await e.LP.weak(pc);
  await e.D.flush();
  return pc;
}
T['本堂結果:答對數不含小檢核、一出現就記完成、小檢核清單(名稱與判定字,沒有數字)、錯題不含小檢核、小檢核解析沒有題數、點心只在第一次'] = async () => {
  const e = await env();
  const pc = await lessonFourDone(e);
  const cpIdx = new Set(pc.lesson.segments.filter((s) => s.slot === 'checkpoint')[0].blocks.filter((b) => !b.fill).map((b) => b.idx));
  const rows = pc.state().a.filter((x) => !cpIdx.has(x[0]));
  assert.equal(await e.LP.wrapup(pc), 'done');
  const r = e.UI.results.pop();
  eq([r.opt.kicker, r.opt.score, r.opt.total, r.opt.primary.label, r.opt.primary.href, r.opt.stats], ['第 4 堂', rows.filter((x) => x[4] & 1).length, rows.length, '繼續', 'lessons.html', undefined]);
  eq([segSt(pc, 'wrapup'), !!pc.state().doneAt], ['done', true]);
  const vs = e.host.querySelectorAll('.lsn-row').map(text);
  eq([e.host.querySelector('.me-sec-h') && text(e.host.querySelector('.me-sec-h')), vs], ['小檢核', ['照片描述達標', 'WH 問句達標', '詞性弱點']]);
  assert.equal(/\d|%/.test(text(e.host.querySelector('.lsn-verdicts'))), false);
  const details = e.log.filter((x) => x[0] === 'detail');
  const wrongCp = pc.state().a.filter((x) => cpIdx.has(x[0]) && !(x[4] & 1)).length;
  const wrongOther = rows.filter((x) => !(x[4] & 1) && e.meta.has(x[1])).length;
  eq(details.map((x) => [x[1], x[2]]), [['錯題 ' + wrongOther + ' 題', { wrong: 0 }], ['小檢核解析', { wrong: 0 }]]);
  assert.ok(wrongCp > 0 && wrongOther > 0, wrongCp + '/' + wrongOther);
  eq(e.log.filter((x) => x[0] === 'pet').map((x) => [x[1], x[2] === r.reward]), [['les_t1_04', true]]);
  const n = e.store.sets.length;
  const again = page(e, 4, TT);
  assert.equal(await e.LP.wrapup(again), 'done');
  await e.D.flush();
  eq([e.store.sets.length, e.log.filter((x) => x[0] === 'pet').length], [n, 1], '重看:不寫任何鍵、不給點心');
};

T['本堂結果第一次進來補記考點:照原本的來源與批次(固定段 p、考點回顧 r、弱點補練 w、小檢核 c),同一批不重複;錯題重做與前測不記'] = async () => {
  const e = await env();
  const d = today(e);
  e.store.set('rvq', [{ k: 'P1.photo', due: d, step: 7, d0: e.R.addDays(d, -7) }, { m: 'p2', id: 'l2-01', sub: null, due: d, step: 1, d0: e.R.addDays(d, -1) }]);
  const pc = await lessonFourDone(e);
  await e.D.flush();
  const before = e.store.peek('pts');
  e.store.set('pts', {});
  e.cloud.rows.delete('pts');
  await e.LP.wrapup(pc);
  await e.D.flush();
  const pts = e.store.peek('pts');
  const batches = {};
  Object.keys(pts).forEach((k) => pts[k].hits.forEach((h) => { batches[h.b] = batches[h.b] || new Set(); batches[h.b].add(h.src + '@' + h.d); }));
  const src = (b) => Array.from(batches[b] || []).map((x) => x.split('@')[0]);
  const fixedBank = pc.lesson.segments.filter((s) => s.fixed && s.slot !== 'checkpoint').reduce((a, s) => a.concat((s.blocks || []).filter((b) => /^p\d$/.test(b.module)).map((b) => b.idx)), []);
  fixedBank.forEach((i) => eq(src('les_t1_04:' + i), ['p'], 'les_t1_04:' + i));
  const weakB = Object.keys(batches).filter((b) => /^les_t1_04:8[5-9]$/.test(b));
  eq([src('les_t1_04:cp'), src('les_t1_04:81'), weakB.length > 0, [].concat(...weakB.map(src)).every((s) => s === 'w'), batches['les_t1_04:80']], [['c'], ['r'], true, true, undefined]);
  Object.keys(batches).forEach((b) => Array.from(batches[b]).forEach((x) => assert.equal(x.split('@')[1], d)));
  const cpV = (p) => Object.keys(p).map((k) => (p[k].hits.filter((h) => h.b === 'les_t1_04:cp')[0] || {}).v).filter(Boolean).sort();
  eq(cpV(pts), cpV(before), '小檢核的判定不變');
  const again = e.store.peek('pts');
  await e.LP.wrapup(page(e, 4, TT));
  await e.D.flush();
  eq(e.store.peek('pts'), again, '重看不再補記');
};

T['本堂結果:錯題的逐題解析附回報題目;沒有錯題時不出錯題那一塊'] = async () => {
  const e = await env();
  const pc = await open(e, 3, EE, { ok: () => true });
  for (const s of pc.lesson.segments.filter((x) => x.fixed && x.slot !== 'wrapup')) { await pc.runRound(s.blocks, { slot: s.slot }); pc.setState(await e.D.segment(3, pc.lesson, s.slot, 'done', NOW)); }
  await e.LP.review(pc);
  await e.LP.weak(pc);
  assert.equal(await e.LP.wrapup(pc), 'done');
  eq([e.log.filter((x) => x[0] === 'detail').length, e.UI.results.pop().opt.score > 0, !!e.host.querySelector('.lsn-verdicts')], [0, true, false]);
  const e2 = await env();
  const p2 = await open(e2, 3, EE, { ok: (b, id) => !/^p5-/.test(id) });
  for (const s of p2.lesson.segments.filter((x) => x.fixed && x.slot !== 'wrapup')) { await p2.runRound(s.blocks, { slot: s.slot }); p2.setState(await e2.D.segment(3, p2.lesson, s.slot, 'done', NOW)); }
  await e2.LP.wrapup(p2);
  const d = e2.log.filter((x) => x[0] === 'detail')[0];
  assert.ok(/^錯題 \d+ 題$/.test(d[1]), d[1]);
  assert.ok(e2.log.some((x) => x[0] === 'report' && x[1].m === 'p5'));
};

process.on('beforeExit', () => { console.log('FAIL 有一支測試一直沒有結束'); process.exit(1); });
K.run(T);
