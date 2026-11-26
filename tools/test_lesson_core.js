/* 課程頁的純計算(js/lesson-core.js):試行班判定、上課用的級別、首頁卡與課程總覽、教師後台的目前堂號、段落總覽、
   區塊排成步驟與回合(真的學習包第 1–4 堂、四種聽讀組合)、可作答的題與完成規則、作答紀錄鍵、第一次作答與補回、
   小檢核的判過與判定、補記對照、前測的限時與接著做、單字選項、介面字串表、課程新檔的公開用語。
   不開瀏覽器、不連網。用法:node tools/test_lesson_core.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const K = require('./lesson_kit.js');

const E = K.env();
const C = E.C, P = E.P;
const { eq, EE, TT, TE, ET, NOW, DAY } = K;
const today = P.dayOf(NOW);
const lessonOf = (lv) => (no) => P.compose(K.PACKS, lv, no);
const seg = (lesson, slot) => lesson.segments.filter((s) => s.slot === slot)[0];
const T = {};

/* ---------- 試行班 ---------- */
T['pilotState:判斷表 11 列由上往下、符合就停;名單空、全站開放、離開班級但有 plan、快取的班級不在名單'] = () => {
  const ids = ['class-a', 'class-b'];
  const base = { ui: 'pilot', pilotIds: ids, signedIn: true, teacher: false, plan: null, cached: null };
  const s = (o) => plainState(C.pilotState(Object.assign({}, base, o)));
  eq(s({ ui: 'off' }), ['off', null], '1 開關關著');
  eq(s({ ui: undefined }), ['off', null], '1 沒有設定');
  eq(s({ signedIn: false, ui: 'on' }), ['guest', null], '2 沒登入');
  eq(s({ teacher: true, ui: 'on' }), ['teacher', null], '3 老師(全站開放也不給)');
  eq(s({ ui: 'on', pilotIds: [] }), ['pilot', null], '4 全站開放');
  eq(s({ plan: { classId: 'class-b' } }), ['pilot', 'class-b'], '5 有 plan、班級在名單(不用查)');
  eq(s({ pilotIds: [] }), ['no', null], '6 名單空');
  eq(s({ pilotIds: [], plan: { classId: 'class-a' } }), ['no', null], '6 名單空時 plan 也不算');
  eq(s({ cached: { s: 'pilot', c: 'class-a' } }), ['pilot', 'class-a'], '7 快取 pilot');
  eq(s({ cached: { s: 'no', c: null } }), ['no', null], '7 快取 no');
  eq(s({ cached: { s: 'pilot', c: 'class-z' } }), ['checking', null], '7 快取的班級不在名單了:當沒有快取');
  eq(s({}), ['checking', null], '8 還在查');
  eq(s({ membership: { ok: true, classes: [{ id: 'class-x' }, { id: 'class-b' }] } }), ['pilot', 'class-b'], '9 有一班在名單');
  eq(s({ membership: { ok: true, classes: [{ id: 'class-x' }] } }), ['no', null], '10 都不在');
  eq(s({ membership: { ok: false } }), ['unknown', null], '11 查不到');
  eq(s({ membership: 'oops' }), ['unknown', null], '11 格式不對');
  eq(s({ plan: { classId: 'class-a' }, membership: { ok: true, classes: [] } }), ['pilot', 'class-a'], '離開班級但已經有 plan:照樣上');
  eq(C.PILOT_ORDER, ['off', 'guest', 'teacher', 'pilot', 'no', 'checking', 'unknown']);
  return '19 種';
};
const plainState = (r) => [r.state, r.classId];

T['courseLevels:四級 × 兩科,進階、高分(含閱讀)一律上門檻包;認不得回 null'] = () => {
  const L = ['entry', 'threshold', 'advanced', 'high'], want = { entry: 'entry', threshold: 'threshold', advanced: 'threshold', high: 'threshold' };
  L.forEach((l) => L.forEach((r) => eq(C.courseLevels({ listening: l, reading: r, source: 'score' }), { listening: want[l], reading: want[r] }, l + '/' + r)));
  eq(C.courseLevels({ listening: 'entry', reading: 'advanced' }), { listening: 'entry', reading: 'threshold' }, '閱讀進階');
  [null, undefined, {}, { listening: 'entry' }, { listening: 'x', reading: 'entry' }, []].forEach((x) => assert.equal(C.courseLevels(x), null, K.J(x)));
  return '16 組';
};

T['lessonTitle:一律用閱讀級那一包的堂名'] = () => {
  assert.equal(C.lessonTitle(lessonOf(TE)(1)), '前測');
  assert.equal(C.lessonTitle(lessonOf(ET)(1)), '期初前測');
  assert.equal(C.lessonTitle(lessonOf(EE)(3)), '照片描述與名詞形容詞位置');
  assert.equal(C.lessonTitle(lessonOf(TT)(3)), '照片描述與詞性位置');
  assert.equal(C.lessonTitle(null), '');
};

/* ---------- 首頁卡、課程總覽、教師後台 ---------- */
function unlockOf(states) { return P.unlockState({ packs: K.PACKS, levels: EE, states, today }); }
const started = (lesson, at, done) => {
  let s = P.newState(lesson, at);
  if (done) lesson.segments.forEach((g) => { s = P.setSegment(s, lesson, g.slot, 'done', at + 60); });
  return s;
};
T['homeModel:可開始(第 1 堂約 50 分鐘)、進行中(段數)、明天開放、尚未開放、24 堂都上完;明天開放與尚未開放沒有按鈕,總覽頂端才放每日練習'] = () => {
  const lo = lessonOf(EE);
  const m0 = C.homeModel({ unlock: unlockOf({}), states: {}, lessonOf: lo });
  eq([m0.no, m0.kind, m0.kicker, m0.title, m0.tags, m0.href, m0.label, m0.pose, m0.daily, m0.done], [1, 'start', '第 1 堂', '前測', ['約 50 分鐘'], 'lesson.html?no=1', '開始第 1 堂', 'read', false, 0]);
  let s1 = started(lo(1), NOW - 3600);
  s1 = P.setSegment(s1, lo(1), 'test_listening', 'done', NOW - 3000);
  const m1 = C.homeModel({ unlock: unlockOf({ 1: s1 }), states: { 1: s1 }, lessonOf: lo });
  eq([m1.kind, m1.tags, m1.label, m1.segs], ['doing', ['約 50 分鐘', '1 / 2 段'], '繼續第 1 堂', [1, 2]]);
  const st = { 1: started(lo(1), NOW - 7200, true), 2: started(lo(2), NOW - 3600, true) };
  const m2 = C.homeModel({ unlock: unlockOf(st), states: st, lessonOf: lo });
  eq([m2.no, m2.kind, m2.title, m2.tags, m2.href, m2.label, m2.pose, m2.daily, m2.done], [3, 'limit', '照片描述與名詞形容詞位置', ['明天開放'], null, null, 'happy', true, 2]);
  const m2b = C.homeModel({ unlock: unlockOf(st), states: st, lessonOf: lo, onLessons: true });
  eq([m2b.href, m2b.label], ['daily.html', '每日練習'], '課程總覽頂端');
  const all = {};
  [1, 2, 3, 4].forEach((n) => { all[n] = started(lo(n), NOW - n * 3 * DAY, true); });
  const m3 = C.homeModel({ unlock: unlockOf(all), states: all, lessonOf: lo });
  eq([m3.no, m3.kind, m3.kicker, m3.title, m3.tags, m3.href, m3.label, m3.pose, m3.done], [5, 'off', null, '第 5 堂尚未開放', [], null, null, 'sleep', 4]);
  eq(C.homeModel({ unlock: unlockOf(all), states: all, lessonOf: lo, onLessons: true }).label, '每日練習');
  const m4 = C.homeModel({ unlock: { lessons: Array.from({ length: 24 }, (_, i) => ({ no: i + 1, status: 'done' })), next: null }, states: {}, lessonOf: lo });
  eq([m4.kind, m4.title, m4.done, m4.href], ['off', '課程', 24, null]);
  return '6 種';
};

T['rowStatus:完成(連結)、可上(有進度寫段數,沒有寫未開始)、不能上一律「未開放」不連結'] = () => {
  const l = lessonOf(EE)(3);
  let s = started(l, NOW - 600);
  s = P.setSegment(s, l, 'vocab', 'done', NOW - 300);
  eq(C.rowStatus('done', s, l), { text: '完成', link: true, mark: 'done' });
  eq(C.rowStatus('open', null, l), { text: '未開始', link: true, mark: 'todo' });
  eq(C.rowStatus('open', s, l), { text: '1 / 6 段', link: true, mark: 'doing' });
  ['locked', 'daily_limit', 'not_live'].forEach((x) => eq(C.rowStatus(x, s, l), { text: '未開放', link: false, mark: null }, x));
};

T['currentNo:沒有 plan、第 3 堂做一半、1–4 堂完成、24 堂完成、第 2 期;鍵名跟 PACK_CORE.lessonKey 一致'] = () => {
  for (let n = 1; n <= 24; n++) [1, 2, 99].forEach((t) => assert.equal(C.lessonKey(t, n), P.lessonKey(t, n)));
  assert.throws(() => C.lessonKey(1, 25), TypeError);
  const done = { doneAt: NOW };
  assert.equal(C.currentNo({}), null);
  assert.equal(C.currentNo({ les_t1_01: done }), null, '沒有 plan');
  eq(C.currentNo({ plan: { term: 1 } }), { no: 1 });
  eq(C.currentNo({ plan: { term: 1 }, les_t1_01: done, les_t1_02: done, les_t1_03: { doneAt: null } }), { no: 3 });
  const four = { plan: {}, les_t1_01: done, les_t1_02: done, les_t1_03: done, les_t1_04: done };
  eq(C.currentNo(four), { no: 5 });
  const all = { plan: { term: 1 } };
  for (let n = 1; n <= 24; n++) all[P.lessonKey(1, n)] = done;
  assert.equal(C.currentNo(all), 'done');
  eq(C.currentNo(Object.assign({}, all, { plan: { term: 2 }, les_t2_01: done })), { no: 2 }, '第 2 期看 les_t2_');
};

/* ---------- 段落總覽與步驟 ---------- */
T['steps:段名、分鐘、目前那一段;個人段試排 0 畫略過、主按鈕跳過它;前測剩幾分鐘'] = () => {
  const l = lessonOf(EE)(3);
  let s = started(l, NOW - 600);
  eq(C.steps(l, null).map((x) => x.st), ['current', 'todo', 'todo', 'todo', 'todo', 'todo'], '還沒開始');
  ['vocab', 'listening', 'reading'].forEach((g) => { s = P.setSegment(s, l, g, 'done', NOW - 60); });
  const a = C.steps(l, s, { review: 0, weak: 3 });
  eq(a.map((x) => [x.slot, x.name, x.minutes, x.fixed, x.st]), [['vocab', '單字', 5, true, 'done'], ['listening', '聽力', 17, true, 'done'], ['reading', '閱讀', 17, true, 'done'],
    ['review', '回顧', 8, false, 'skip'], ['weak', '弱點補練', 11, false, 'current'], ['wrapup', '本堂結果', 2, true, 'todo']]);
  eq(C.steps(l, s, { review: 2, weak: 0 }).map((x) => x.st).slice(3), ['current', 'skip', 'todo']);
  const s2 = P.setSegment(s, l, 'review', 'doing', NOW);
  assert.equal(C.steps(l, s2, { review: 0 })[3].st, 'current', '已經開始的回顧不畫略過');
  const t = lessonOf(EE)(1);
  eq(C.steps(t, started(t, NOW), { left: { test_listening: 12 } }).map((x) => [x.name, x.left]), [['聽力測驗', 12], ['閱讀測驗', null]]);
};

const sig = (r) => r.kind + (r.kind === 'bank' ? '(' + r.engine[0] + r.feedback[0] + r.parts.join('') + (r.cp ? 'cp' : '') + ')' : '');
const lessonSig = (l) => l.segments.map((g) => g.slot + ':' + C.rounds(g, null).map(sig).join(',')).join(' | ');
const ROUNDS = {
  1: { all: 'test_listening:test | test_reading:test' },
  2: {
    EE: 'test_review:result | vocab:cards,words | listening:ear,bank(Li1),bank(Ls1) | reading:grammar | review: | weak: | wrapup:',
    TT: 'test_review:result | vocab:cards,words | listening:bank(Li1),bank(Ls2),ear | reading:grammar | review: | weak: | wrapup:',
  },
  3: {
    EE: 'vocab:cards,words | listening:tip,bank(Li12),bank(Ls21) | reading:tip,grammar,bank(Di5),bank(Ds5) | review: | weak: | wrapup:',
    TT: 'vocab:cards,words | listening:tip,bank(Li12),bank(Ls21) | reading:tip,grammar,bank(Ds5) | review: | weak: | wrapup:',
  },
  4: {
    EE: 'vocab:words | checkpoint:bank(Ls12cp),bank(Ds5cp),grammar | listening:ear,ear,bank(Ls2) | reading:grammar | review: | weak: | wrapup:',
    TT: 'vocab:words | checkpoint:bank(Ls12cp),bank(Ds5cp),grammar | listening:ear,bank(Ls2) | reading:grammar | review: | weak: | wrapup:',
  },
};
/* 聽讀不同級:聽力段跟聽力級、單字與閱讀段跟閱讀級(第 2 堂沒有閱讀題庫回合,兩包一樣) */
const mixed = (no, l, r) => {
  if (no === 1) return ROUNDS[1].all;
  const pick = (lv) => ROUNDS[no][lv].split(' | ');
  const L = pick(l), R = pick(r);
  return L.map((x) => (/^(vocab|reading):/.test(x) ? R.filter((y) => y.split(':')[0] === x.split(':')[0])[0] : x)).join(' | ');
};
T['rounds:入門、門檻、聽門檻讀入門、聽入門讀門檻的實際學習包第 1–4 堂逐堂比對步驟;第 2、3 堂有字卡這一步;引擎參數'] = () => {
  const combos = [['EE', EE, 'EE', 'EE'], ['TT', TT, 'TT', 'TT'], ['TE', TE, 'TT', 'EE'], ['ET', ET, 'EE', 'TT']];
  combos.forEach(([name, lv, l, r]) => {
    for (let no = 1; no <= 4; no++) assert.equal(lessonSig(lessonOf(lv)(no)), mixed(no, l, r), name + ' 第 ' + no + ' 堂');
    [2, 3].forEach((no) => assert.ok(/vocab:cards,words/.test(lessonSig(lessonOf(lv)(no))), name + ' 第 ' + no + ' 堂沒有字卡'));
  });
  const l3 = lessonOf(EE)(3), rs = C.rounds(seg(l3, 'listening'), null);
  eq(rs.map((r) => [r.engine, r.feedback, r.plays, r.blocks.map((b) => b.idx)]), [[null, null, null, [3]], ['LISTEN', 'instant', 2, [4, 5]], ['LISTEN', 'submit', 1, [6, 7]]]);
  eq(C.rounds(seg(l3, 'reading'), null).map((r) => r.plays), [null, null, null, null]);
  eq(C.syncKeys(rs[2]), ['listen_p2', 'listen_p1', 'hist']);
  eq(C.syncKeys(C.rounds(seg(l3, 'reading'), null)[3]), ['drill_p5', 'hist']);
  eq(C.syncKeys(rs[0]), []);
  eq(['3', '4', '6', '7'].map((p) => C.syncKeys({ kind: 'bank', parts: [p] })), [['listen_p3', 'hist'], ['listen_p4', 'hist'], ['drill_p6', 'hist'], ['drill_p7', 'hist']], 'P3、P4 是聽力,P6、P7 是刷題');
  eq(C.TEXT.block.parts(rs[2].parts), 'Part 2、Part 1', '區塊結果的小字照出現順序');
  return '4 組 × 4 堂';
};

T['rounds:個人段照凍結拆區塊:錯題重做照聽讀兩回合、只算原本答錯的小題;考點回顧、弱點補練的模組;測驗檢討前面是前測結果'] = () => {
  const l = lessonOf(EE)(3);
  const s = Object.assign(started(l, NOW), { pk: {
    80: { at: 0, ids: ['l1-03', 'p7-b1-1', 'p7-b1-1', 'l2-01'], m: ['p1', 'p7', 'p7', 'p2'], sub: [null, 1, 3, null], r: 'review' },
    81: { at: 0, ids: ['l2-03'], r: 'point_review:P2.wh' }, 82: { at: 0, ids: ['p5-b1-01'], r: 'point_review:P5.cat:詞性變化' },
    85: { at: 0, ids: ['ga-01'], m: 'grammar', k: 'P5.cat:詞性變化', r: 'base_module' }, 86: { at: 0, ids: ['p5-b1-02'], m: 'p5', k: 'P5.cat:詞性變化' },
    90: { at: 0, ids: ['tip-P2-wh'], m: 'tip', p: '2' }, 91: { at: 0, ids: ['l2-01'], m: 'p2', p: '2' },
  } });
  const rv = C.rounds(seg(l, 'review'), s);
  eq(rv.map(sig), ['bank(Li12)', 'bank(Di7)', 'bank(Li2)', 'bank(Di5)'], '個人段一律即時對答');
  eq(rv[0].blocks[0].list, ['l1-03', 'l2-01']);
  eq(C.syncKeys(rv[0]), ['listen_p1', 'listen_p2', 'hist']);
  const redo = rv[1].blocks[0];
  const got = { a: [[80, 'p7-b1-1', 1, 0, 1, 0], [80, 'p7-b1-1', 2, 0, 1, 0]] };
  assert.equal(C.blockDone(redo, redo.list, got, () => 4), false, '原本答錯的是第 1、3 小題');
  assert.equal(C.blockDone(redo, redo.list, { a: got.a.concat([[80, 'p7-b1-1', 3, 0, 1, 0]]) }, () => 4), true);
  eq(C.rounds(seg(l, 'weak'), s).map(sig), ['grammar', 'bank(Di5)']);
  const l2 = lessonOf(EE)(2);
  eq(C.rounds(seg(l2, 'test_review'), s).map(sig), ['result', 'tip', 'bank(Li2)']);
  eq(C.rounds(seg(l, 'wrapup'), s), []);
};

/* has:找得到才回(題庫回小題數) */
const META = new Map(E.ctx.BANK_META.items.map((r) => [r.id, r]));
const hasOf = (gone) => (kind, id) => {
  if ((gone || []).indexOf(id) > -1) return false;
  if (kind === 'bank') { const r = META.get(id); return r ? r.size || 1 : false; }
  return true;
};
const frozen = (lesson, pk) => Object.assign(started(lesson, NOW - 600), { pk });
const rowsOf = (list) => list.map(([b, id, sub, ok]) => [b, id, sub || 0, 0, ok ? 3 : 2, 10]);
T['answerable、blockDone:淘汰一題、全部淘汰(0 題直接完成、不呼叫引擎)、字卡 ids 空的照樣要出;題組照小題數;文法有一筆就算'] = () => {
  const l = lessonOf(EE)(3), lb = seg(l, 'listening').blocks, vb = seg(l, 'vocab').blocks;
  const s = frozen(l, { 4: { at: 0, ids: ['l1-03', 'l1-05'] }, 0: { at: 0, ids: [] } });
  const warn = E.logs.warn.length;
  eq(C.answerable(lb[1], ['l1-03', 'l1-05'], hasOf(['l1-05'])), ['l1-03']);
  assert.equal(E.logs.warn.length, warn + 1, '找不到的 id console.warn');
  const s1 = Object.assign({}, s, { a: rowsOf([[4, 'l1-03', 0, true]]) });
  assert.equal(C.blockDone(lb[1], ['l1-03'], s1), true, '淘汰一題:剩下的答完就完成');
  assert.equal(C.blockDone(lb[1], ['l1-03', 'l1-05'], s1), false);
  assert.equal(C.blockDone(lb[1], C.answerable(lb[1], ['l1-03', 'l1-05'], hasOf(['l1-03', 'l1-05'])), s), true, '全部淘汰:0 題直接完成');
  eq(C.answerable(vb[0], C.idsOf(vb[0], s), hasOf()), [], '字卡沒有凍結的字');
  assert.equal(C.blockDone(vb[0], [], s), false, '字卡照樣要出');
  const g = { idx: 9, module: 'grammar' };
  assert.equal(C.blockDone(g, ['gf-01'], s), false);
  assert.equal(C.blockDone(g, ['gf-01'], Object.assign({}, s, { a: rowsOf([[9, 'gf-01', 2, false]]) })), true);
  const p3 = { idx: 30, module: 'p3' };
  const part = Object.assign({}, s, { a: rowsOf([[30, 'l3-11', 1, true], [30, 'l3-11', 2, true]]) });
  assert.equal(C.blockDone(p3, ['l3-11'], part, hasOf()), false, '三題只答兩題');
  assert.equal(C.blockDone(p3, ['l3-11'], Object.assign({}, part, { a: part.a.concat(rowsOf([[30, 'l3-11', 3, false]])) }), hasOf()), true);
  eq(C.idsOf(seg(l, 'listening').blocks[0], s), ['tip-P1-photo'], '技巧卡的 id 從區塊來');
};

T['nextStep:第一個沒完成的步驟;技巧卡與字卡在同一段後面已有作答時跳過,沒有就再出;技巧卡找不到也跳過'] = () => {
  const l = lessonOf(EE)(3), ls = seg(l, 'listening'), vs = seg(l, 'vocab');
  const pk = { 4: { at: 0, ids: ['l1-03', 'l1-05'] }, 5: { at: 0, ids: ['l2-01', 'l2-03'] }, 6: { at: 0, ids: ['l2-07'] }, 7: { at: 0, ids: ['l1-06'] }, 1: { at: 0, ids: ['1', '2'] }, 2: { at: 0, ids: ['21'] } };
  const at = (a) => { const r = C.nextStep(ls, Object.assign(frozen(l, pk), { a: rowsOf(a) }), hasOf()); return r ? [r.index, r.kind] : null; };
  eq(at([]), [0, 'tip'], '沒有作答:技巧卡再出一次');
  eq(at([[4, 'l1-03', 0, true]]), [1, 'bank'], '後面有作答:跳過技巧卡,即時回合還沒答完');
  eq(at([[4, 'l1-03', 0, true], [4, 'l1-05', 0, true], [5, 'l2-01', 0, true], [5, 'l2-03', 0, false]]), [2, 'bank'], '交卷回合');
  eq(at([[4, 'l1-03'], [4, 'l1-05'], [5, 'l2-01'], [5, 'l2-03'], [6, 'l2-07'], [7, 'l1-06']]), null, '都完成');
  const noTip = C.nextStep(ls, frozen(l, pk), hasOf(['tip-P1-photo']));
  eq([noTip.index, noTip.kind], [1, 'bank'], '技巧卡找不到就跳過');
  const v = (a) => { const r = C.nextStep(vs, Object.assign(frozen(l, pk), { a: rowsOf(a) }), hasOf()); return r ? [r.index, r.kind] : null; };
  eq(v([]), [0, 'cards'], '字卡再出一次');
  eq(v([[1, '1', 0, true]]), [1, 'words'], '小考已經開始:不再出字卡');
  eq(v([[1, '1'], [1, '2'], [2, '21']]), null);
  const l1 = lessonOf(EE)(1), t = C.nextStep(seg(l1, 'test_listening'), frozen(l1, {}), hasOf());
  assert.equal(t, null, '前測還沒組卷時沒有題');
};

/* ---------- 作答紀錄 ---------- */
T['itemKeys:P1、P2、P5 單題;P6 小題是空格號、紀錄鍵用空格號;P3、P4、P7 小題 1 起算、紀錄鍵 0 起算;可以只給小題數'] = () => {
  eq(C.itemKeys('1', { id: 'l1-03' }), [{ sub: 0, key: 'l1-03', qi: 0 }]);
  eq(C.itemKeys('p5', { id: 'p5-b1-01' }), [{ sub: 0, key: 'p5-b1-01', qi: 0 }]);
  eq(C.itemKeys('2', null, 'l2-01'), [{ sub: 0, key: 'l2-01', qi: 0 }]);
  eq(C.itemKeys('6', { id: 'p6-b1-1', questions: [{ num: 1 }, { num: 2 }, { num: 3 }, { num: 4 }] }).map((x) => [x.sub, x.key, x.qi]), [[1, 'p6-b1-1:1', 0], [2, 'p6-b1-1:2', 1], [3, 'p6-b1-1:3', 2], [4, 'p6-b1-1:4', 3]]);
  eq(C.itemKeys('6', META.get('p6-b1-1')).map((x) => x.key), ['p6-b1-1:1', 'p6-b1-1:2', 'p6-b1-1:3', 'p6-b1-1:4']);
  ['3', '4', '7'].forEach((p) => {
    const id = { 3: 'l3-11', 4: 'l4-11', 7: 'p7-b1-1' }[p];
    eq(C.itemKeys(p, META.get(id)).map((x) => [x.sub, x.key]), Array.from({ length: META.get(id).size }, (_, i) => [i + 1, id + ':' + i]), 'P' + p);
  });
  eq(C.itemKeys('3', 2, 'l3-12').map((x) => x.key), ['l3-12:0', 'l3-12:1']);
};

T['firstOf、reconcile:作答紀錄是毫秒、段開始是秒;30 天前的紀錄不算這段答過;t0 之後的補回;學習記錄比 t0 早就不是第一次;學習記錄只留 60 天,更早的當第一次;錯題重做一律不是第一次'] = () => {
  const t0 = NOW - 600, since = t0 * 1000, ms = (s) => s * 1000;
  const records = {
    1: { 'l1-03': { c: 1, ok: true, t: ms(NOW - 300) }, 'l1-05': { c: 0, ok: false, t: ms(NOW - 30 * DAY) }, 'l1-06': { c: 2, ok: false, t: ms(NOW - 200) } },
    3: { 'l3-11:0': { c: 2, ok: true, t: ms(NOW - 100) }, 'l3-11:1': { c: 1, ok: false, t: ms(NOW - 90) } },
  };
  const hist = [{ m: 'l1', id: 'l1-03', c: 1, ok: false, t: ms(t0 - DAY) }, { m: 'l3', id: 'l3-11:0', t: ms(NOW - 100) }];
  const rows = C.reconcile({ blocks: [{ idx: 4, ids: ['l1-03', 'l1-05', 'l1-06'] }, { idx: 30, ids: ['l3-11'] }], items: (id) => META.get(id), records, sinceMs: since, hist });
  eq(rows.map((r) => [r.b, r.id, r.sub, r.c, r.ok, r.f, r.t]), [
    [4, 'l1-03', 0, 1, true, false, NOW - 300],
    [4, 'l1-06', 0, 2, false, true, NOW - 200],
    [30, 'l3-11', 1, 2, true, true, NOW - 100],
    [30, 'l3-11', 2, 1, false, true, NOW - 90],
  ]);
  const redo = C.reconcile({ blocks: [{ idx: 80, list: ['l1-06'] }], items: (id) => META.get(id), records, sinceMs: since, hist: [] });
  eq(redo.map((r) => r.f), [false]);
  assert.equal(C.firstOf({ key: 'l1-03', snapshot: new Set(['l1-03']) }), false, '快照有:不是第一次');
  assert.equal(C.firstOf({ key: 'l1-07', snapshot: new Set(['l1-03']) }), true);
  assert.equal(C.firstOf({ key: 'l1-05', m: 'l1', rec: records[1]['l1-05'], hist: [], sinceMs: since }), false, '紀錄比段開始早');
  assert.equal(C.firstOf({ key: 'l1-06', m: 'l1', rec: records[1]['l1-06'], hist: [], sinceMs: since }), true, '61 天前做過、學習記錄已經沒有:當第一次');
};

T['firstOf、reconcile 看模擬考作答過的題(mock_seen):交卷時間比段開始早就不是第一次;比段開始晚或沒有照舊'] = () => {
  const t0 = NOW - 600, since = t0 * 1000, ms = (s) => s * 1000;
  const records = { 1: { 'l1-03': { c: 1, ok: true, t: ms(NOW - 300) }, 'l1-06': { c: 2, ok: false, t: ms(NOW - 200) } } };
  const mock = { 'l1-03': ms(t0 - DAY), 'l1-06': ms(NOW - 100) };
  eq([C.firstOf({ key: 'l1-03', m: 'l1', rec: records[1]['l1-03'], hist: [], sinceMs: since, mock }), C.firstOf({ key: 'l1-06', m: 'l1', rec: records[1]['l1-06'], hist: [], sinceMs: since, mock }),
    C.firstOf({ key: 'l1-03', m: 'l1', rec: records[1]['l1-03'], hist: [], sinceMs: since })], [false, true, true]);
  assert.equal(C.firstOf({ key: 'l1-03', snapshot: new Set(), mock }), true, '有快照照快照');
  const rows = C.reconcile({ blocks: [{ idx: 4, ids: ['l1-03', 'l1-06'] }], items: (id) => META.get(id), records, sinceMs: since, hist: [], mock });
  eq(rows.map((r) => [r.id, r.f]), [['l1-03', false], ['l1-06', true]]);
};

/* ---------- 小檢核與補記 ---------- */
T['judged、verdictsOf:找批次 <進度鍵>:cp;判定存在那一批的 v;rerecord 對照表'] = () => {
  const b = 'les_t1_04:cp';
  const pts = {
    'P1.photo': { s: 'met', hits: [{ d: today, n: 5, ok: 5, src: 'c', b, v: 'm' }] },
    'P2.wh': { s: 'weak', hits: [{ d: today, n: 4, ok: 1, src: 'p', b: 'les_t1_03:6' }, { d: today, n: 5, ok: 1, src: 'c', b, v: 'w' }] },
    'P5.cat:詞性變化': { s: 'learning', hits: [{ d: today, n: 5, ok: 3, src: 'c', b, v: 'h' }] },
  };
  assert.equal(C.judged(pts, b), true);
  assert.equal(C.judged(pts, 'les_t1_08:cp'), false);
  assert.equal(C.judged(null, b), false);
  eq(C.verdictsOf(pts, b), [{ key: 'P1.photo', verdict: 'met' }, { key: 'P2.wh', verdict: 'weak' }, { key: 'P5.cat:詞性變化', verdict: 'hold' }]);
  const k = 'les_t1_04';
  eq([C.rerecord(0, 'checkpoint', k), C.rerecord(81, 'review', k), C.rerecord(84, 'review', k), C.rerecord(85, 'weak', k), C.rerecord(89, 'weak', k),
    C.rerecord(90, 'test_review', k), C.rerecord(6, 'listening', k), C.rerecord(80, 'review', k), C.rerecord(0, 'test_listening', k), C.rerecord(1, 'test_reading', k)],
  [{ src: 'c', b: k + ':cp' }, { src: 'r', b: k + ':81' }, { src: 'r', b: k + ':84' }, { src: 'w', b: k + ':85' }, { src: 'w', b: k + ':89' },
    { src: 'p', b: k + ':90' }, { src: 'p', b: k + ':6' }, null, null, null]);
};

T['小檢核清單的考點名稱:第 4 堂兩包用到的鍵都在名稱表;表上沒有的鍵顯示 Part 名稱,不顯示程式鍵;判定的字與圖示'] = () => {
  [EE, TT].forEach((lv) => {
    const cp = lessonOf(lv)(4).checkpoint;
    cp.listening.concat(cp.reading).forEach((key) => assert.ok(C.POINT_NAME[E.R.legacyKey(key)], key));
  });
  eq(['P1.photo', 'P2.wh', 'P5.noun_slot', 'P5.adj_slot', 'P5.adv_slot', 'P7.set', 'P5.cat:未分類', 'P6.type:句子插入'].map(C.pointName),
    ['照片描述', 'WH 問句', '詞性', '詞性', '詞性', 'Part 7 閱讀理解', 'Part 5 單句填空', 'Part 6 段落填空']);
  Object.keys(C.POINT_NAME).forEach((k) => assert.equal(E.R.legacyKey(k), k, '名稱表用舊欄位寫法:' + k));
  eq([C.VERDICT.met.text, C.VERDICT.hold.text, C.VERDICT.weak.text, C.VERDICT.code.m, C.VERDICT.code.h, C.VERDICT.code.w], ['達標', '持平', '弱點', 'met', 'hold', 'weak']);
  eq(Object.keys(C.PART_NAME).map((p) => C.PART_NAME[p]), ['Part 1 照片描述', 'Part 2 應答', 'Part 3 簡短對話', 'Part 4 簡短獨白', 'Part 5 單句填空', 'Part 6 段落填空', 'Part 7 閱讀理解']);
};

T['考點名稱補齊:Part 5 每個舊分類都有名稱;兩包第 1–8 堂小檢核的考點(照舊欄位寫法去重)名稱都不是 Part 名稱、彼此不重複'] = () => {
  const cats = [].concat(...Object.keys(E.R.P5_QTYPE).map((k) => E.R.P5_QTYPE[k]));
  const missing = cats.filter((c) => !C.POINT_NAME['P5.cat:' + c]);
  eq([cats.length, missing], [13, []]);
  const parts = Object.keys(C.PART_NAME).map((p) => C.PART_NAME[p]);
  [EE, TT].forEach((lv) => {
    const keys = new Set();
    for (let no = 1; no <= 8; no++) {
      const cp = lessonOf(lv)(no).checkpoint;
      if (cp) cp.listening.concat(cp.reading).forEach((k) => keys.add(E.R.legacyKey(k)));
    }
    const names = [...keys].map(C.pointName);
    eq([names.filter((n) => !n || parts.indexOf(n) > -1), names.length === new Set(names).size], [[], true], lv.listening + ' ' + names.join('、'));
  });
  eq(['P5.tense', 'P5.agreement', 'P5.pron_case'].map(C.pointName), ['時態與語態', '主詞動詞一致', '代名詞']);
};

/* ---------- 前測 ---------- */
T['前測:配額 36 題聽力;限時照每題速度(36 題 1014 秒、39 題 1732 秒、43 題 1909 秒);接著做:沒作答、剩 3 分、用完、超過 24 小時、這個分頁記的時間比最後作答晚'] = () => {
  eq(C.TEST_QUOTA.test_listening.parts.reduce((a, x) => a + x[1], 0), 22);
  eq([C.TEST_QUOTA.test_listening.idx, C.TEST_QUOTA.test_reading.idx], [0, 1]);
  const qs = C.TEST_QUOTA.test_listening.parts.reduce((a, [p, n]) => a + n * (p === '3' || p === '4' ? 3 : 1), 0);
  assert.equal(qs, 36, '聽力 36 題(題組一組 3 題)');
  eq([C.testLimit('test_listening', 36), C.testLimit('test_reading', 39), C.testLimit('test_reading', 43)], [1014, 1732, 1909]);
  assert.equal(Math.round(C.testLimit('test_listening', 36) / 60), 17);
  assert.throws(() => C.testLimit('listening', 3), TypeError);
  const t0 = NOW - 1000;
  eq(C.testResume({ limit: 1014, t0, lastAt: null, now: NOW }), { remaining: 1014, expired: false }, '沒作答:離開的時間不算');
  eq(C.testResume({ limit: 1014, t0, lastAt: t0 + 834, now: NOW + 5000 }), { remaining: 180, expired: false }, '剩 3 分');
  eq(C.testResume({ limit: 1014, t0, lastAt: t0 + 1100, now: NOW }), { remaining: 0, expired: false }, '用完');
  eq(C.testResume({ limit: 1014, t0, lastAt: t0 + 100, now: t0 + 100 + DAY + 1 }), { remaining: 0, expired: true }, '超過 24 小時');
  eq(C.testResume({ limit: 1014, t0, lastAt: t0 + 100, now: t0 + 100 + DAY }), { remaining: 914, expired: false }, '剛好 24 小時還能接著做');
  eq(C.testResume({ limit: 1014, t0, lastAt: Math.max(t0 + 300, t0 + 500), now: NOW }), { remaining: 514, expired: false }, '分頁記的時間比最後作答晚');
};

T['partsOf:凍結的前測題展開成小題算 n、照作答算 ok;淘汰的題不算'] = () => {
  const l = lessonOf(EE)(1);
  const s = Object.assign(started(l, NOW - 900), {
    pk: { 0: { at: 0, ids: ['l1-03', 'l1-99', 'l3-11', 'l2-01'] }, 1: { at: 0, ids: ['p5-b1-01', 'p6-b1-1'] } },
    a: rowsOf([[0, 'l1-03', 0, true], [0, 'l1-99', 0, true], [0, 'l3-11', 1, true], [0, 'l3-11', 3, false], [1, 'p6-b1-1', 2, true], [1, 'p5-b1-01', 0, false]]),
  });
  const parts = C.partsOf(s, (id) => (META.get(id) || {}).size, hasOf());
  eq(parts, { P1: { n: 1, ok: 1 }, P2: { n: 1, ok: 0 }, P3: { n: 3, ok: 1 }, P4: { n: 0, ok: 0 }, P5: { n: 1, ok: 0 }, P6: { n: 4, ok: 1 }, P7: { n: 0, ok: 0 } });
};

/* ---------- 單字 ---------- */
T['vocabOptions:四個選項、正解在內、錯的選項不跟正解共用中文字、同一個種子同一組;weekWordsFrom:第 1 週沒有上週'] = () => {
  const pool = [['arrive', '抵達'], ['deposit', '押金'], ['mortgage', '抵押'], ['machine', '機器'], ['order', '訂購'], ['revenue', '營收'], ['staff', '員工'], ['invoice', '發票'], ['lobby', '大廳']]
    .map(([answer, zh]) => ({ answer, zh }));
  const r = C.vocabOptions({ base: 'arrive', zh: '抵達' }, pool, 'les_t1_03|7');
  assert.equal(r.options.length, 4);
  assert.equal(r.options[r.answer], '抵達');
  r.options.filter((x) => x !== '抵達').forEach((x) => assert.ok(!/[抵達]/.test(x), '共用漢字:' + x));
  eq(C.vocabOptions({ answer: 'arrive', zh: '抵達' }, pool, 'les_t1_03|7'), r, '同一個種子');
  const ww = C.weekWordsFrom(K.WORDS.entry);
  eq(ww(1, 'this_week'), Array.from({ length: 20 }, (_, i) => String(i + 1)));
  eq(ww(1, 'last_week'), []);
  eq(ww(2, 'last_week'), ww(1, 'this_week'));
  eq(ww(4, 'three_weeks_ago'), ww(1, 'this_week'));
  eq([ww(2, 'nope'), ww(99, 'this_week')], [[], []]);
  eq(ww(2, 'this_week').slice(0, 2), ['21', '22']);
};

/* ---------- 介面字串 ---------- */
function texts(obj, at) {
  return Object.keys(obj).reduce((a, k) => {
    const v = obj[k], p = (at ? at + '.' : '') + k;
    if (typeof v === 'string') return a.concat([[p, v]]);
    if (typeof v === 'function') return a.concat([[p, v.length === 1 && /parts/i.test(k) ? v(['2', '1']) : /Ask$/.test(k) ? v('回顧') : v(12, 34)]]);
    return v && typeof v === 'object' ? a.concat(texts(v, p)) : a;
  }, []);
}
const BUTTONS = ['home.start', 'home.resume', 'home.daily', 'home.retry', 's8.first', 's8.start', 's8.resume', 'empty.setLevels', 'empty.retry', 'empty.reload', 'empty.home', 'empty.back',
  'empty.goTo', 'empty.daily', 'lesson.start', 'lesson.resume', 'lesson.skipSeg', 'lesson.skipOk', 'lesson.cancel', 'tip.next', 'words.start', 'words.next', 'words.done', 'bridge.start',
  'block.next', 'grammar.next', 'test.start', 'test.next', 'test.submit', 'test.keepGoing', 'test.play', 'pretest.next', 'testReview.next', 'checkpoint.start', 'wrapup.next'];
const FIXED = ['home.start', 'home.resume', 's8.first', 's8.start', 's8.resume', 'empty.goTo', 'test.play'];
const VERBS = ['開始', '繼續', '重試', '設定', '重新', '回', '前往', '略過', '取消', '下一', '完成', '交卷', '每日'];
const NOTES = ['test.oncePlay', 'test.noBack', 'bridge.note', 'checkpoint.note', 'lesson.skipBody', 'test.blankBody', 'pretest.note', 'testReview.note'];
const EMPTY_TITLES = ['empty.off', 'empty.unknown', 'empty.noLevels', 'empty.failed', 'empty.itemsFailed', 'empty.badData', 'empty.notFound', 'empty.locked', 'empty.limit', 'empty.notLive', 'home.notLive'];
const BANNED = /\u4fdd\u8b49|\u4e00\u5b9a|\u63d0\u5206|\u885d\u5230|\u9032\u6b65|\u547d\u4e2d|\u5b98\u65b9\u984c|\u771f\u984c|\u8003\u53e4\u984c|\u9810\u4f30|\u5206\u6578/;
T['TEXT:全部字串全形標點、沒有驚嘆號破折號括號補充與句號、12 字以內不用逗號;按鈕 2–5 字動詞開頭;說明 18 字內;空狀態標題 10 字內;不承諾分數;前測改字'] = () => {
  const all = texts(C.TEXT);
  const by = new Map(all);
  const len = (s) => s.replace(/\s/g, '').length;
  const bad = [];
  all.forEach(([p, s]) => {
    if (/[\u4e00-\u9fff][,;:?!()]|[,;:?!()][\u4e00-\u9fff]/.test(s)) bad.push(p + ' 半形標點 ' + s);
    if (/[！!～~（）()]|──/.test(s) || (/—/.test(s) && s !== '—')) bad.push(p + ' 驚嘆號、破折號或括號 ' + s);
    if (/。/.test(s)) bad.push(p + ' 句號 ' + s);
    if ((s.match(/，/g) || []).length > 1 || (len(s) <= 12 && /，/.test(s))) bad.push(p + ' 逗號 ' + s);
    if (BANNED.test(s)) bad.push(p + ' 承諾分數 ' + s);
    if (/\u904e\u6e21\u671f\u5377/.test(s)) bad.push(p + ' 舊字 ' + s);
  });
  BUTTONS.forEach((p) => {
    const s = by.get(p);
    assert.ok(typeof s === 'string', '沒有 ' + p);
    if (FIXED.indexOf(p) < 0 && (len(s) < 2 || len(s) > 5)) bad.push(p + ' 按鈕字數 ' + s);
    if (!VERBS.some((v) => s.indexOf(v) === 0) && p !== 'test.play') bad.push(p + ' 按鈕不是動詞開頭 ' + s);
  });
  NOTES.forEach((p) => { if (len(by.get(p)) > 18 || /，/.test(by.get(p))) bad.push(p + ' 說明太長 ' + by.get(p)); });
  EMPTY_TITLES.forEach((p) => { if (len(by.get(p)) > 10) bad.push(p + ' 空狀態標題太長 ' + by.get(p)); });
  eq(bad, []);
  eq([C.TEXT.pretest.tag, C.TEXT.pretest.note, C.TEXT.testReview.tag, C.TEXT.testReview.note], ['暫用試卷', '不能跟之後的測驗直接比較', '暫用試卷', '不能跟之後的測驗直接比較']);
  eq([C.TEXT.home.segs(3, 6), C.TEXT.home.done(2), C.TEXT.home.doneLabel(2), C.TEXT.lesson.itemsMin(36, 17), C.TEXT.page.lesson(3)], ['3 / 6 段', '2 / 24 堂', '課程 2 / 24 堂', '36 題 · 17 分鐘', '第 3 堂 - 衝衝英文']);
  eq([C.TEXT.home.start(3), C.TEXT.empty.locked(2), C.TEXT.lesson.skipAsk('回顧'), C.TEXT.lesson.backTo(3)], ['開始第 3 堂', '先完成第 2 堂', '略過回顧？', '← 回第 3 堂']);
  assert.ok(Object.isFrozen(C.TEXT) && Object.isFrozen(C.TEXT.home), 'TEXT 不能被改');
  return all.length + ' 個字串';
};

/* ---------- 檔案 ---------- */
/* 課程頁動工前就有的檔(引擎、規則與它們的測試)不算新檔 */
const OLDER = ['js/lesson-rules.js', 'js/lesson-entry.js', 'tools/test_lesson_rules.js', 'tools/test_lesson_sync.js'];
const COURSE_FILES = () => {
  const ls = (d, re) => (K.exists(d) ? fs.readdirSync(path.join(K.REPO, d)).filter((f) => re.test(f)).map((f) => (d === '.' ? f : d + '/' + f)) : []);
  return ['js/packs-config.js', 'js/pack-util.js'].concat(ls('js', /^lessons?(-[\w-]+)?\.js$/), ls('.', /^lessons?\.html$/), ls('css', /^lesson[\w-]*\.css$/),
    ['tools/lesson_kit.js', 'tools/lesson_e2e_kit.js', 'tools/test_pack_reserve.js'], ls('tools', /^test_lesson_[\w]+\.js$/), ls('tools/fixtures', /^lesson_/)).filter((f) => K.exists(f) && OLDER.indexOf(f) < 0);
};
/* 字寫成 \u 跳脫,這支測試自己也不出現那些字 */
const INTERNAL = /\u7ad9\u9577|\u6846\u67b6|\u898f\u683c|\u5be9\u67e5|\u7d93\u71df\u8005|\u5de5\u4f5c\u5305|\u4ee3\u7406|\u4ef2\u88c1|\u76f2\u7b54|\u5168\u5be9|\u5b9a\u7a3f\u8868|\u53bb ?AI ?\u611f|\x47PT|\bM[12]\b|\b[A-EW][1-5](?![\dA-Za-z])|\u3014|\u3015|\b[A-Z]:[\\/]/g;
T['公開用語:課程新檔(含註解)不出現內部用語、文件代號與 repo 外的路徑'] = () => {
  const files = COURSE_FILES();
  ['js/packs-config.js', 'js/lesson-core.js', 'js/lesson-data.js', 'lessons.html', 'lesson.html', 'tools/lesson_kit.js', 'tools/test_lesson_core.js', 'tools/test_lesson_data.js']
    .forEach((f) => assert.ok(files.indexOf(f) > -1, '沒掃到 ' + f));
  const bad = [];
  files.forEach((f) => { const m = K.read(f).match(INTERNAL); if (m) bad.push(f + ' ' + m.join(',')); });
  eq(bad, []);
  return files.length + ' 個檔';
};

T['js/lesson-core.js 不碰畫面與儲存、載入時不依賴其他檔;js/lesson-data.js 也能單獨載入;開關是 pilot、名單只放班級 id'] = () => {
  const src = K.read('js/lesson-core.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  eq((src.match(/\bdocument\b|localStorage|sessionStorage|\bstore\b|\bfetch\b|indexedDB|\bCLOUD\b|\bwindow\b/g) || []), []);
  assert.ok(K.bare('js/lesson-core.js').LESSON_CORE.TEXT, 'lesson-core.js 單獨載入');
  assert.ok(K.bare('js/lesson-data.js').LESSON_DATA.pilot, 'lesson-data.js 單獨載入');
  const cfg = K.bare('js/packs-config.js');
  eq(cfg.PACKS_UI, 'pilot');
  assert.ok(Array.isArray(cfg.PACKS_PILOT_CLASSES) && cfg.PACKS_PILOT_CLASSES.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)), '名單只放班級 id');
  const lines = (f) => K.read(f).split('\n').length;
  ['js/lesson-core.js', 'js/lesson-data.js', 'tools/lesson_kit.js', 'tools/test_lesson_core.js', 'tools/test_lesson_data.js'].forEach((f) => assert.ok(lines(f) <= 800, f + ' 超過 800 行'));
};

K.run(T);
