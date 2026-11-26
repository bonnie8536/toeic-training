/* 程度檢測頁(placement.html、js/placement.js、js/placement-views.js)的測試:vm 沙盒、很小的假 DOM、真的題庫與題目難度(tools/placement_kit.js)。
   不開瀏覽器、不連網。用法:node tools/test_placement.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const K = require('./placement_kit');
const EK = require('./estimate_kit');

const { env, flush, txt, all, nextBtn, curUnit, doSlot, doSection, clickText, playThrough, pickAll, HOUR } = K;
const T = {};
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
async function start(e, label) { clickText(e.box, label || '開始'); await flush(); }
async function fullRun(e, mode) {
  await start(e);
  const L = await doSection(e, mode);
  clickText(e.box, '開始閱讀');
  await flush();
  const R = await doSection(e, mode);
  await flush(40);
  return { L, R };
}
const lastRun = (e) => { const p = e.get('placement_v1'); return p.runs[p.runs.length - 1]; };

T['開始頁:三個標籤、作答方式一行只講一件事(四行)、一顆實色「開始」帶 data-gate、文字按鈕「沒有耳機，先做閱讀」'] = () => {
  const e = env();
  assert.deepStrictEqual(all(e.box, '.mock-tag').map(txt), ['聽力 12 題', '閱讀 12 題', '約 15–20 分鐘']);
  assert.deepStrictEqual(all(e.box, '.pl-rule').map(txt), ['戴上耳機。', '每段音檔只播一次。', '選好答案後按「下一題」。', '不能回上一題。']);
  assert.deepStrictEqual(all(e.box, '.pl-rule').filter((n) => /，/.test(txt(n))).length, 0, '不用逗號串兩件事');
  const prim = all(e.box, '.btn.primary');
  assert.strictEqual(prim.length, 1);
  assert.strictEqual(txt(prim[0]), '開始');
  assert.ok(prim[0].hasAttribute('data-gate'), '開始要有 data-gate');
  assert.deepStrictEqual(all(e.box, '.pl-more button').map(txt), ['沒有耳機，先做閱讀']);
  const o = env({ search: '?from=onboard' });
  assert.deepStrictEqual(all(o.box, '.pl-more button').map(txt), ['沒有耳機，先做閱讀', '先跳過，從入門開始']);
  const r = env({ search: '?sec=R' });
  assert.deepStrictEqual(all(r.box, '.mock-tag').map(txt), ['閱讀 12 題']);
  assert.deepStrictEqual(all(r.box, '.pl-rule').map(txt), ['選好答案後按「下一題」。', '不能回上一題。']);
};

T['腳本每一格:聽力 P1 P1 P2×4 P3 組 P4 組、閱讀 P5×4 P6 組 P7 單篇組;進度「聽力 · 7–9／12」;兩科中間;24 題都存、每題有秒數'] = async () => {
  const e = env();
  const { L, R } = await fullRun(e, 'right');
  assert.deepStrictEqual(L.map((x) => x.part), ['1', '1', '2', '2', '2', '2', '3', '4']);
  assert.deepStrictEqual(L.map((x) => x.count), ['聽力 · 1／12', '聽力 · 2／12', '聽力 · 3／12', '聽力 · 4／12', '聽力 · 5／12', '聽力 · 6／12', '聽力 · 7–9／12', '聽力 · 10–12／12']);
  assert.deepStrictEqual(R.map((x) => x.part), ['5', '5', '5', '5', '6', '7']);
  assert.deepStrictEqual(R.map((x) => x.count), ['閱讀 · 1／12', '閱讀 · 2／12', '閱讀 · 3／12', '閱讀 · 4／12', '閱讀 · 5–8／12', '閱讀 · 9–12／12']);
  assert.deepStrictEqual(R.map((x) => x.keys.length), [1, 1, 1, 1, 4, 4]);
  const p7 = e.ctx.TOEIC.part7.filter((s) => s.id === R[5].id)[0];
  assert.strictEqual(p7.format, 'single', 'P7 只出單篇');
  const run = lastRun(e);
  assert.strictEqual(run.items.length, 24);
  assert.ok(run.items.every((it) => it.length === 5 && Number.isInteger(it[2]) && it[3] === 1 && Number.isInteger(it[4])), JSON.stringify(run.items[0]));
  assert.ok(typeof run.end === 'string' && run.tm.L[1] && run.tm.R[1] && Array.isArray(run.res.L) && Array.isArray(run.res.R));
  const fa = e.get('fa_v1');
  assert.ok(run.items.every((it) => fa.i[it[1]] && fa.i[it[1]][2] === 't' && fa.i[it[1]][1] === 1));
};

T['兩科中間:聽力完成→接著做閱讀;先做閱讀的對稱一頁;「之後再做」直接看結果'] = async () => {
  const e = env();
  await start(e);
  await doSection(e, 'right');
  assert.strictEqual(txt(e.box.querySelector('.pl-h2')), '聽力完成');
  assert.ok(/接著做閱讀 12 題。/.test(txt(e.box)));
  assert.strictEqual(all(e.box, '.btn.primary').map(txt).join(), '開始閱讀');
  const r = env();
  await start(r, '沒有耳機，先做閱讀');
  assert.strictEqual(curUnit(r).part, '5');
  await doSection(r, 'right');
  assert.strictEqual(txt(r.box.querySelector('.pl-h2')), '閱讀完成');
  assert.deepStrictEqual(all(r.box, '.pl-rule').map(txt), ['接著做聽力 12 題。', '戴上耳機。'], '一行一件事');
  assert.strictEqual(all(r.box, '.btn.primary').map(txt).join(), '開始聽力');
  clickText(r.box, '之後再做');
  await flush(40);
  assert.ok(r.box.querySelector('.result-card'), '之後再做:結果頁');
  assert.deepStrictEqual(all(r.box, '.est-need').map(txt), ['聽力 還差 12 題']);
  assert.ok(typeof lastRun(r).end === 'string');
};

T['合併時先做完那一科的結束時間不被雲端那份沒做完的蓋掉:做完全部,結果頁兩科都有數字'] = async () => {
  const e = env();
  await start(e);
  await doSection(e, 'right');
  const k = e.keyOf('placement_v1');
  const pl = JSON.parse(e.ls.get(k));
  const stale = JSON.parse(JSON.stringify(pl));
  stale.runs[0].tm.L = [stale.runs[0].tm.L[0], null];
  stale.runs[0].items = stale.runs[0].items.slice(0, 3);
  stale.runs[0].res = {};
  e.ls.set(k, JSON.stringify(e.E.mergePlacementRuns(stale, pl)));
  assert.ok(lastRun(e).tm.L[1], '聽力的結束時間留著');
  clickText(e.box, '開始閱讀');
  await flush();
  await doSection(e, 'right');
  await flush(40);
  assert.ok(lastRun(e).tm.L[1] && lastRun(e).tm.R[1]);
  /* 兩科都算進去:資訊欄的「根據 24 題」(數字旁不再掛小字) */
  e.box.querySelector('.result-kicker .est-info').click();
  assert.ok(/^目前根據 24 題，/.test(e.UI.sheets.slice(-1)[0].paras.slice(-1)[0]));
};

T['選題跟著作答:全對的人後面的題比全錯的人難(真的題目難度)'] = async () => {
  const b = (e, keys) => keys.reduce((a, k) => a + e.ctx.ITEM_PARAMS.b[k], 0) / keys.length;
  const right = env(), wrong = env();
  await start(right, '沒有耳機，先做閱讀'); await start(wrong, '沒有耳機，先做閱讀');
  const a = await doSection(right, 'right'), c = await doSection(wrong, 'wrong');
  assert.strictEqual(a[0].id, c[0].id, '第一格兩人一樣(同一個種子、同一個起點)');
  const hi = b(right, a.slice(2).reduce((x, s) => x.concat(s.keys), [])), lo = b(wrong, c.slice(2).reduce((x, s) => x.concat(s.keys), []));
  assert.ok(hi > lo + 0.5, '全對 ' + hi.toFixed(2) + ' 全錯 ' + lo.toFixed(2));
  return '後面幾格平均難度 全對 ' + hi.toFixed(2) + '、全錯 ' + lo.toFixed(2);
};

T['沒選不能按下一題;題組全部選完才可按;最後一格寫「完成」;不顯示對錯'] = async () => {
  const e = env();
  await start(e, '沒有耳機，先做閱讀');
  assert.strictEqual(nextBtn(e).disabled, true);
  const n0 = e.get('placement_v1').runs[0].items.length;
  nextBtn(e).click();
  assert.strictEqual(e.get('placement_v1').runs[0].items.length, n0, '沒選按了不送出');
  for (let i = 0; i < 4; i++) { doSlot(e, 'right'); await flush(); }
  assert.strictEqual(curUnit(e).part, '6');
  const groups = all(e.box, '.opts');
  groups.slice(0, 3).forEach((g) => g.children[0].click());
  assert.strictEqual(nextBtn(e).disabled, true, '題組選了 3 題');
  groups[3].children[0].click();
  assert.strictEqual(nextBtn(e).disabled, false);
  assert.strictEqual(txt(nextBtn(e)), '下一題');
  assert.ok(!/答對|答錯/.test(txt(e.box)) && !all(e.box, '.opt.correct').length && !all(e.box, '.opt.wrong').length);
  nextBtn(e).click(); await flush();
  assert.strictEqual(txt(nextBtn(e)), '完成');
  assert.ok(nextBtn(e).hasAttribute('data-gate'));
};

T['聽力:按了才播;播完變灰寫「已播放」;出錯出現「重新播放」一次;再錯換同 Part 的題、這題不記'] = async () => {
  const e = env();
  await start(e);
  const u1 = curUnit(e);
  assert.strictEqual(e.audios.filter((a) => a.plays).length, 0, '沒按不播');
  const btn = () => e.box.querySelector('.pl-play');
  btn().click();
  const a1 = e.audios[e.audios.length - 1];
  assert.ok(/audio\/l1-/.test(a1.src));
  a1.emit('error');
  assert.strictEqual(txt(btn()), '▶重新播放');
  assert.strictEqual(btn().disabled, false);
  btn().click();
  const a2 = e.audios[e.audios.length - 1];
  assert.notStrictEqual(a2, a1, '重播換新的 Audio');
  a2.emit('ended');
  assert.strictEqual(btn().disabled, true);
  assert.strictEqual(txt(e.box.querySelector('.pl-played')), '已播放');
  assert.strictEqual(curUnit(e), u1);
  pickAll(e, 'right'); nextBtn(e).click(); await flush();
  /* 第二格:錯兩次(一次播到一半就停)換題 */
  const u2 = curUnit(e);
  btn().click();
  e.audios[e.audios.length - 1].pause();
  btn().click();
  const a4 = e.audios[e.audios.length - 1];
  a4.currentTime = 3; a4.ended = true;
  (a4.listeners.ended || []).forEach((f) => f());
  const u3 = curUnit(e);
  assert.notStrictEqual(u3.id, u2.id, '換題');
  assert.strictEqual(u3.part, '1');
  assert.ok(/1／12|2／12/.test(txt(e.UI.focus.cur.bar)), txt(e.UI.focus.cur.bar));
  assert.strictEqual(txt(e.UI.focus.cur.bar.querySelector('.quiz-count')), '聽力 · 2／12', '同一格');
  const fa = e.get('fa_v1'), run = lastRun(e);
  assert.ok(!fa.i[u2.keys[0]] && !run.items.some((it) => it[1] === u2.keys[0]), '換掉的題不記');
  /* 卡住不前進:10 秒算出錯 */
  btn().click();
  const a5 = e.audios[e.audios.length - 1];
  for (let i = 0; i < 12; i++) e.tick(1000);
  assert.strictEqual(txt(btn()), '▶重新播放', '卡住 10 秒出現重新播放');
  assert.strictEqual(a5.paused, true);
};

T['聽力題組:先播音,播完三題一起出;播音時進度已是「7–9／12」'] = async () => {
  const e = env();
  await start(e);
  for (let i = 0; i < 6; i++) { doSlot(e, 'right'); await flush(); }
  assert.strictEqual(curUnit(e).part, '3');
  assert.strictEqual(txt(e.UI.focus.cur.bar.querySelector('.quiz-count')), '聽力 · 7–9／12');
  assert.strictEqual(all(e.box, '.opts').length, 0, '播完才出題');
  assert.strictEqual(nextBtn(e).disabled, true);
  playThrough(e);
  assert.strictEqual(all(e.box, '.opts').length, 3);
};

T['離開:先問「離開檢測？」;續做從下一格接著做(同一題目順序),播到一半的聽力題換新題'] = async () => {
  const ls = new Map();
  const e = env({ ls, confirm: false });
  await start(e);
  const done = [];
  for (let i = 0; i < 3; i++) { done.push(doSlot(e, 'right')); await flush(); }
  const at4 = curUnit(e);
  e.UI.focus.cur.bar.fire('click', { target: e.UI.focus.cur.close });
  await flush();
  assert.deepStrictEqual(plain(e.UI.confirms[0]), { title: '離開檢測？', body: '下次從這一題接著做。', ok: '離開', cancel: '繼續作答' });
  assert.ok(e.UI.focus.cur && e.UI.focus.cur.active, '取消就留在作答');
  /* 沒播就離開:回來出同一題 */
  const b = env({ ls, now: K.NOW + HOUR });
  assert.strictEqual(curUnit(b).id, at4.id);
  assert.strictEqual(txt(b.UI.focus.cur.bar.querySelector('.quiz-count')), '聽力 · 4／12');
  /* 播到一半離開:回來換同 Part 的新題 */
  b.box.querySelector('.pl-play').click();
  const c = env({ ls, now: K.NOW + 2 * HOUR });
  assert.notStrictEqual(curUnit(c).id, at4.id);
  assert.strictEqual(curUnit(c).part, at4.part);
  assert.strictEqual(txt(c.UI.focus.cur.bar.querySelector('.quiz-count')), '聽力 · 4／12');
  for (let i = 0; i < 5; i++) { doSlot(c, 'right'); await flush(); }
  assert.strictEqual(txt(c.box.querySelector('.pl-h2')), '聽力完成');
  const run = lastRun(c);
  assert.strictEqual(run.items.length, 12);
  assert.ok(!run.items.some((it) => it[1] === at4.keys[0]), '播到一半的那題不記');
};

T['24 小時:超過就不續做,畫開始頁;作答留在第一次作答紀錄,下次不再出'] = async () => {
  const ls = new Map();
  const e = env({ ls });
  await start(e);
  const first = [];
  for (let i = 0; i < 3; i++) { first.push(doSlot(e, 'right')); await flush(); }
  const late = env({ ls, now: K.NOW + 25 * HOUR });
  assert.ok(late.box.querySelector('.pl-intro'), '開始頁');
  assert.strictEqual(late.S.activeRun({ now: K.NOW + 25 * HOUR }), null);
  const fa = late.get('fa_v1');
  first.forEach((x) => assert.ok(fa.i[x.keys[0]], x.id + ' 留著'));
  await start(late);
  const again = await doSection(late, 'right');
  first.forEach((x) => assert.ok(!again.some((y) => y.id === x.id), x.id + ' 又出了'));
  assert.strictEqual(lastRun(late).end, null);
  assert.strictEqual(late.get('placement_v1').runs[0].end, null, '舊的那次不寫結束');
};

T['只做一科(?sec=R):只出閱讀,結果頁只有閱讀數字、聽力寫還差 12 題、沒有總分'] = async () => {
  const e = env({ search: '?sec=R' });
  await start(e);
  const R = await doSection(e, 'right');
  await flush(40);
  assert.strictEqual(R.length, 6);
  assert.strictEqual(lastRun(e).sec, 'R');
  assert.ok(!lastRun(e).tm.L);
  assert.deepStrictEqual(all(e.box, '.est-need').map(txt), ['聽力 還差 12 題'], txt(e.box).slice(0, 200));
  assert.strictEqual(e.UI.lastResult.kicker, '預估分數');
};

T['重測:再出 24 題都沒做過的題;開始頁跟第一次一樣(不再多掛一行半句的說明);舊的那次留著'] = async () => {
  const ls = new Map();
  const e = env({ ls });
  const one = await fullRun(e, 'right');
  const b = env({ ls, now: K.NOW + 2 * HOUR });
  assert.deepStrictEqual(all(b.box, '.pl-rule').map(txt), ['戴上耳機。', '每段音檔只播一次。', '選好答案後按「下一題」。', '不能回上一題。']);
  const two = await fullRun(b, 'wrong');
  const ids1 = one.L.concat(one.R).map((x) => x.id), ids2 = two.L.concat(two.R).map((x) => x.id);
  assert.strictEqual(ids2.length, 14);
  ids2.forEach((id) => assert.ok(ids1.indexOf(id) < 0, id + ' 重出'));
  assert.strictEqual(b.get('placement_v1').runs.length, 2);
};

T['結果頁:預估總分或預估分數(小標旁 ⓘ)、一顆實色主按鈕「開始練習」、看作答;根據 N 題與本站估計在資訊欄;從新用戶設定來的主按鈕是「下一步」'] = async () => {
  const e = env();
  await fullRun(e, (u, qi) => (qi + u.id.length) % 2 ? K.answerOf(u, qi) : (K.answerOf(u, qi) + 1) % 3);
  const card = e.box.querySelector('.result-card');
  assert.strictEqual(all(e.box, '.btn.primary').length, 1, '整頁一顆實色主按鈕');
  assert.strictEqual(txt(card.querySelector('.result-go')), '開始練習');
  assert.ok(!card.querySelector('.result-note') && !/本站估計|不是正式成績|根據 \\d+ 題/.test(txt(card)), '數字旁沒有聲明小字');
  const info = card.querySelector('.result-kicker .est-info');
  assert.strictEqual(info && info.getAttribute('aria-label'), '預估分數說明');
  info.click();
  const sh = e.UI.sheets.slice(-1)[0];
  assert.strictEqual(sh.title, '預估分數');
  assert.ok(/不是多益的正式成績。$/.test(sh.paras[0]) && /^目前根據 24 題，/.test(sh.paras[3]), JSON.stringify(sh.paras));
  assert.ok(['預估總分', '預估分數'].indexOf(e.UI.lastResult.kicker) > -1);
  assert.ok(/建議程度：聽力 .+／閱讀 /.test(txt(card)));
  assert.ok(!/答對 \d+ 題/.test(txt(card)), '不顯示答對幾題');
  const det = e.box.querySelector('.pl-review');
  assert.ok(det && !det.open);
  clickText(card, '看作答');
  assert.strictEqual(det.open, true);
  assert.ok(all(det, '.opt.correct').length >= 24 && all(det, '.explain').length === 24);
  const o = env({ search: '?from=onboard' });
  await fullRun(o, 'right');
  const go = o.box.querySelector('.result-go');
  assert.strictEqual(txt(go), '下一步');
  assert.strictEqual(go.getAttribute('href'), 'start.html?step=result');
  const last = env({ ls: o.ls, search: '?view=last' });
  await flush(40);
  assert.ok(last.box.querySelector('.result-card') && last.box.querySelector('.pl-review'), '?view=last 看最近一次');
};

T['只寫 fa_v1、placement_v1、est_v1(與級別):不寫 hist、drill_p*、listen_p*、diag;既有的作答紀錄與舊檢測不動'] = async () => {
  const ls = new Map();
  const pre = { hist: [{ m: 'p5', id: 'p5-b1-01', c: 1, ok: true, t: K.NOW - 864e5 }], drill_p5: { 'p5-b1-01': { c: 1, ok: true, t: K.NOW - 864e5 } }, diag: { answers: { 0: 1 }, done: false, startedAt: '2026-11-01T00:00:00.000Z' } };
  Object.keys(pre).forEach((k) => ls.set('tr_u' + K.PID + '_' + k, JSON.stringify(pre[k])));
  const e = env({ ls });
  await fullRun(e, 'right');
  Object.keys(pre).forEach((k) => assert.deepStrictEqual(e.get(k), pre[k], k + ' 被改了'));
  const keys = [...ls.keys()].filter((k) => k.indexOf('tr_u' + K.PID + '_') === 0).map((k) => k.slice(('tr_u' + K.PID + '_').length)).sort();
  assert.deepStrictEqual(keys, ['diag', 'drill_p5', 'est_v1', 'fa_v1', 'hist', 'placement_v1']);
  assert.ok(e.get('fa_v1').i['p5-b1-01'], '從學習記錄補回的那題也在');
};

T['級別:沒設定過照預估寫(來源 est);有課程進度且已設定過不寫,給「改成這個級別」,確認後才寫'] = async () => {
  const e = env({ onboard: true });
  await fullRun(e, 'right');
  const lv = e.get('levels');
  assert.ok(lv && lv.source.listening === 'est' && lv.history[lv.history.length - 1].reason === 'est', JSON.stringify(lv));
  const ls = new Map();
  const cur = { listening: 'entry', reading: 'entry', source: { listening: 'manual', reading: 'manual' }, setAt: '2026-11-01T00:00:00.000Z', history: [] };
  ls.set('tr_u' + K.PID + '_levels', JSON.stringify(cur));
  ls.set('tr_u' + K.PID + '_plan', JSON.stringify({ v: 1, startDate: '2026-11-01' }));
  const c = env({ ls, onboard: true });
  await fullRun(c, 'right');
  assert.deepStrictEqual(c.get('levels'), cur, '有課程進度不自動改');
  clickText(c.box.querySelector('.result-card'), '改成這個級別');
  await flush(20);
  assert.strictEqual(c.UI.confirms[0].title, '改級別會換學習包。');
  assert.notStrictEqual(c.get('levels').listening, 'entry');
  const ob = env({ onboard: true, search: '?from=onboard' });
  await fullRun(ob, 'right');
  assert.strictEqual(ob.get('levels'), undefined, '從新用戶設定來的:級別留給設定流程的結果頁寫');
  const go = ob.box.querySelector('.result-go');
  assert.deepStrictEqual([txt(go), go.getAttribute('href')], ['下一步', 'start.html?step=result']);
  const rf = env({ onboard: true, search: '?start=1&from=onboard&first=R' });
  await flush(40);
  assert.strictEqual(curUnit(rf).part, '5', '從新用戶設定按「沒有耳機，先做閱讀」:直接從閱讀開始');
};

T['訪客:按開始不建立檢測;沒網路時聽力不開始(兩科都做的留在開始頁,要自己按「先做閱讀」)'] = async () => {
  const g = env({ pid: null });
  await start(g);
  assert.ok(g.box.querySelector('.pl-intro'));
  assert.strictEqual(g.ls.has('tr_placement_v1'), false);
  const off = env({ online: false });
  await start(off);
  assert.strictEqual(curUnit(off), null, '兩科都做:不自己換成閱讀');
  assert.strictEqual(txt(off.box.querySelector('.pl-note')), '連上網路才能做聽力。');
  const l = env({ online: false, search: '?sec=L' });
  await start(l);
  assert.strictEqual(txt(l.box.querySelector('.pl-note')), '連上網路才能做聽力。');
  assert.strictEqual(curUnit(l), null);
};

/* ---------- 選題的細節、沒有結果、離線、只有舊卷、焦點、聽力先播 ---------- */
/* 換掉 ESTIMATE 的 pickUnit,記下每一格選題時用的能力值 */
function spyPick(e) {
  const orig = e.ctx.ESTIMATE, calls = [];
  e.ctx.ESTIMATE = Object.assign({}, orig, { pickUnit: (o) => { calls.push({ theta: o.theta, ids: o.units.map((u) => u.id) }); return orig.pickUnit(o); } });
  return calls;
}
T['選題:每一科第一格用「目前能力 − 0.5」,第二格起用目前能力(含這次已答的題)'] = async () => {
  const e = env();
  const calls = spyPick(e);
  await start(e, '沒有耳機，先做閱讀');
  const E = e.E, P = e.ctx.ITEM_PARAMS, day = E.dayNum(K.NOW);
  const th0 = E.estimate(P, 'R', { fa: { v: 1, i: {} }, today: day }).theta;
  assert.ok(Math.abs(calls[0].theta - (th0 - 0.5)) < 1e-9, '第一格 ' + calls[0].theta + ',目前能力 ' + th0);
  doSlot(e, 'right'); await flush();
  const th1 = E.estimate(P, 'R', { fa: e.get('fa_v1'), today: day }).theta;
  assert.ok(Math.abs(calls[calls.length - 1].theta - th1) < 1e-9, '第二格不減 0.5');
  return '第一格 ' + calls[0].theta.toFixed(2) + ',目前能力 ' + th0.toFixed(2);
};
T['選題:第一次作答紀錄寫不進去(更新版的格式,唯讀)時,這次出過的題照樣不再出'] = async () => {
  const ls = new Map([['tr_u' + K.PID + '_fa_v1', JSON.stringify({ v: 2, i: {} })]]);
  const e = env({ ls });
  const calls = spyPick(e);
  await start(e, '沒有耳機，先做閱讀');
  const R = await doSection(e, 'right');
  const ids = R.map((x) => x.id);
  assert.strictEqual(new Set(ids).size, ids.length, '重出 ' + ids.join(','));
  calls.forEach((c, i) => ids.slice(0, i).forEach((id) => assert.ok(c.ids.indexOf(id) < 0, '第 ' + (i + 1) + ' 格的候選還有 ' + id)));
  assert.deepStrictEqual(e.get('fa_v1'), { v: 2, i: {} }, '更新版的格式不蓋掉');
  return ids.length + ' 格';
};
T['新用戶設定以外做檢測:沒有設定、按過「不用了」的人,onboard 不新建、不復活;進行中的照舊記來源'] = async () => {
  const ob = (o) => { const ls = new Map(); if (o) ls.set('tr_u' + K.PID + '_onboard', JSON.stringify(o)); return ls; };
  const none = env({ onboard: true, ls: ob(null) });
  await fullRun(none, 'right');
  assert.ok(none.get('levels'), '級別照寫');
  assert.strictEqual(none.get('onboard'), undefined, '沒有設定的不新建');
  const gone = { v: 1, status: 'dismissed', step: null, path: null, updatedAt: '2026-11-01T00:00:00.000Z' };
  const d = env({ onboard: true, ls: ob(gone) });
  await fullRun(d, 'right');
  assert.deepStrictEqual(d.get('onboard'), gone, '不用了的不復活');
  assert.strictEqual(d.ctx.ONBOARD_DATA.applyManual('entry', 'high'), 'ok');
  assert.deepStrictEqual(d.get('onboard'), gone, '改級別也不復活');
  const live = { v: 1, status: 'done', step: 'result', path: 'self', levelSource: 'score', updatedAt: '2026-11-01T00:00:00.000Z' };
  const l = env({ onboard: true, ls: ob(live) });
  assert.strictEqual(l.ctx.ONBOARD_DATA.applyEst({ listening: 'advanced', reading: 'advanced', source: { listening: 'est', reading: 'est' } }), 'ok');
  assert.deepStrictEqual([l.get('onboard').status, l.get('onboard').levelSource], ['done', 'est']);
};
T['看最近一次結果(?view=last):沒有做完的檢測是「還沒有檢測結果」;只挑做完的那次;訪客沒有「改級別」'] = async () => {
  const g = env({ pid: null, search: '?view=last' });
  await flush(40);
  assert.strictEqual(txt(g.box.querySelector('.ui-empty-text')), '還沒有檢測結果');
  assert.ok(!g.box.querySelector('.result-card'));
  const ls = new Map();
  const e = env({ ls });
  await fullRun(e, 'right');
  const done = lastRun(e).at;
  const half = env({ ls, now: K.NOW + HOUR, search: '?sec=R' });
  await start(half);
  doSlot(half, 'wrong'); await flush();
  const last = env({ ls, now: K.NOW + 2 * HOUR, search: '?view=last' });
  await flush(40);
  assert.ok(last.box.querySelector('.result-card'), '有做完的那次');
  assert.strictEqual(all(last.box, '.pl-review .explain').length, 24, '看作答是做完的那次(' + done + ')');
  const empty = env({ search: '?view=last' });
  await flush(40);
  assert.strictEqual(txt(empty.box.querySelector('.ui-empty-text')), '還沒有檢測結果', '空帳號');
};
T['離線按開始:留在開始頁寫「連上網路才能做聽力。」,不自己換成閱讀;按「沒有耳機，先做閱讀」才從閱讀開始'] = async () => {
  const off = env({ online: false });
  await start(off);
  assert.ok(off.box.querySelector('.pl-intro'));
  assert.strictEqual(txt(off.box.querySelector('.pl-note')), '連上網路才能做聽力。');
  assert.strictEqual(curUnit(off), null);
  await start(off, '沒有耳機，先做閱讀');
  assert.strictEqual(curUnit(off).part, '5');
};
T['只有舊卷結果的人(網址沒帶科):開始頁預設只做聽力 12 題,作答方式跟第一次一樣(不再多掛一行半句的說明)'] = async () => {
  const ls = new Map([['tr_u' + K.PID + '_diag', JSON.stringify({ done: true, answers: { 0: 1 }, startedAt: '2026-10-01T00:00:00.000Z', finishedAt: '2026-10-01T00:20:00.000Z' })]]);
  const e = env({ onboard: true, ls });
  const tags = all(e.box, '.mock-tag').map(txt);
  assert.deepStrictEqual(tags, ['聽力 12 題']);
  assert.deepStrictEqual(all(e.box, '.pl-rule').map(txt), ['戴上耳機。', '每段音檔只播一次。', '選好答案後按「下一題」。', '不能回上一題。']);
  await start(e);
  assert.strictEqual(curUnit(e).part, '1');
  assert.strictEqual(lastRun(e).sec, 'L');
  const both = env({ onboard: true, ls: new Map([...ls].filter(([k]) => /_diag$/.test(k))), search: '?sec=R' });
  assert.deepStrictEqual(all(both.box, '.mock-tag').map(txt), ['閱讀 12 題'], '網址帶了科就照網址');
};
T['焦點:做完最後一題,焦點移到結果卡的標題;按「看作答」焦點移到展開的那一塊'] = async () => {
  const e = env();
  await fullRun(e, 'right');
  const head = e.box.querySelector('.result-card .result-score');
  assert.strictEqual(e.dom.activeElement, head, '焦點在 ' + (e.dom.activeElement && e.dom.activeElement.className));
  assert.strictEqual(head.getAttribute('tabindex'), '-1');
  clickText(e.box.querySelector('.result-card'), '看作答');
  assert.strictEqual(e.dom.activeElement, e.box.querySelector('.pl-review summary'));
};
T['聽力 Part 1、2:還沒按播放就選了答案,「下一題」不能按;開始播放後才能按'] = async () => {
  const e = env();
  await start(e);
  assert.strictEqual(curUnit(e).part, '1');
  pickAll(e, 'right');
  assert.strictEqual(nextBtn(e).disabled, true, '沒播不能送出');
  const n0 = lastRun(e).items.length;
  nextBtn(e).click(); await flush();
  assert.strictEqual(lastRun(e).items.length, n0);
  e.box.querySelector('.pl-play').click();
  assert.strictEqual(nextBtn(e).disabled, false, '開始播就能送出');
  e.audios[e.audios.length - 1].emit('ended');
  assert.strictEqual(nextBtn(e).disabled, false);
};

/* ---------- 字串與檔案 ---------- */
const FILES = ['placement.html', 'js/placement.js', 'js/placement-views.js', 'css/placement.css', 'tools/placement_kit.js', 'tools/test_placement.js', 'tools/e2e_placement.js'];
T['字串:不承諾分數、全形標點、公開 repo 不寫內部用語與外部路徑;每個檔 800 行內、沒有 console.log'] = () => {
  const BAN = /準確|進步|保證|分數區間|換算|官方|考到|會拿到/;
  const V = env().ctx.PLACEMENT_VIEWS.STR;
  const strs = [];
  (function walk(x) { if (typeof x === 'string') strs.push(x); else if (typeof x === 'function') strs.push(x('L', 1, 3, 12)); else if (x && typeof x === 'object') Object.keys(x).forEach((k) => walk(x[k])); })(V);
  strs.forEach((s) => {
    assert.ok(!BAN.test(s), s);
    assert.ok(!/[一-鿿][,;:?!]|[,;:?!][一-鿿]/.test(s), '半形標點:' + s);
  });
  FILES.forEach((f) => {
    const full = fs.readFileSync(path.join(K.REPO, f), 'utf8');
    const src = f === 'placement.html' ? full.split('<footer>')[0] : full;   // 頁尾是全站共用的那一份(價格頁、客服信箱)
    assert.ok(full.split('\n').length <= 800, f + ' 超過 800 行');
    if (/^js\//.test(f)) assert.ok(!/console\.log\(/.test(src), f + ' 有 console.log');   // 網站的程式;測試工具照慣例用 console.log 印結果
    const hit = src.match(EK.INTERNAL);
    assert.strictEqual(hit, null, f + ' 有內部用語或外部路徑:' + hit);
  });
  ['js/placement.js', 'js/placement-views.js'].forEach((f) => {
    const src = fs.readFileSync(path.join(K.REPO, f), 'utf8');
    const lits = (src.match(/'[^'\n]*'/g) || []).filter((s) => /[一-鿿]/.test(s));
    lits.forEach((s) => assert.ok(!BAN.test(s), f + ':' + s));
    assert.ok(!/store\.set\('(hist|drill_p|listen_p|diag)/.test(src) && !/logAttempt\(/.test(src), f + ' 不寫練習紀錄');
  });
};
T['頁面:免費頁、載入順序(估分核心只載一次、資料層在 cloud.js 後)、標題'] = () => {
  const html = fs.readFileSync(path.join(K.REPO, 'placement.html'), 'utf8');
  const s = Array.from(html.matchAll(/<script[^>]*src="([^"]+)"/g)).map((m) => m[1]);
  assert.strictEqual(s.filter((x) => x === 'js/estimate-core.js').length, 1);
  assert.ok(s.indexOf('js/sync-merge-estimate.js') === s.indexOf('js/sync-merge-lesson.js') + 3);
  assert.ok(s.indexOf('js/estimate-store.js') > s.indexOf('js/cloud.js') && s.indexOf('data/item-params.js') < s.indexOf('js/estimate-store.js'));
  assert.ok(s.indexOf('js/placement.js') === s.length - 2 || s.indexOf('js/placement.js') === s.length - 1);
  assert.ok(!/bank(-meta)?\.js/.test(html), '不載題庫索引(只有上課頁載)');
  assert.ok(/<link rel="stylesheet" href="css\/estimate.css">/.test(html) && /<link rel="stylesheet" href="css\/placement.css">/.test(html));
  assert.match(html, /<title>程度檢測 - 衝衝英文<\/title>/);
  assert.match(html, /<body data-require-profile="on-action">/);
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const n of names) {
    try { const d = await T[n](); pass++; console.log('PASS ' + n + (d ? '  →  ' + d : '')); } catch (e) { console.log('FAIL ' + n + '  →  ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' ') : e)); }
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
