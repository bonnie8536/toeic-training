/* 新用戶設定接上程度檢測(placement_v1)與預估分數的測試案例:純函式(js/onboard-core.js)與資料層(js/onboard-data.js)。
   tools/test_onboard.js 載入這個檔,把案例加進它的清單一起跑(名稱 N 開頭;N8 跟著台北時間的那一組另外用兩個時區再跑)。 */
'use strict';
const assert = require('assert');
const { MIN, HOUR, DAY, NOW, NOW_ISO, CPID, C, J, deepFreeze, plain, eq, dataEnv, signedIn } = require('./onboard_kit');

const PRE = 'tr_u' + CPID + '_';
const TF = '2026-11-19T01:00:00.000Z';   // 按「開始檢測」的時間
const iso = (ms) => new Date(ms).toISOString();
const AT = Date.parse(TF) + MIN;
/* 一次檢測:sec 是做完的科('L'、'R'、'LR'、''),end 是整次結束的時間(null 是還沒做完) */
function runOf(over) {
  const o = Object.assign({ at: iso(AT), end: iso(AT + 20 * MIN), done: 'LR', res: null }, over || {});
  const tm = {};
  ['L', 'R'].forEach((s, i) => { tm[s] = [iso(AT + i * 10 * MIN), o.done.indexOf(s) > -1 ? iso(AT + (i + 1) * 10 * MIN) : null]; });
  return { at: o.at, end: o.end, ip: 'ip1', cv: 'c1', sec: 'LR', tm, items: [], res: o.res || {} };
}
const plOf = (...runs) => ({ v: 1, runs });
const obTest = (over) => Object.assign({ status: 'in_progress', step: 'test', testFrom: TF, doneAt: null }, over || {});
const diagAt = (ms) => ({ done: true, answers: {}, finishedAt: iso(ms) });
const view = (L, R) => ({ ok: true, L: L ? { show: true, band: L } : { show: false }, R: R ? { show: true, band: R } : { show: false } });
const LV = { listening: 'advanced', reading: 'threshold', source: { listening: 'score', reading: 'score' } };

module.exports = (T) => {
  T['N1 latestRun、lastDoneRun、runSections:取 at 最晚的一次、end 最晚的做完的一次;形狀不對當沒有'] = () => {
    const a = runOf({ at: iso(AT), end: iso(AT + 30 * MIN) });
    const b = runOf({ at: iso(AT + HOUR), end: null, done: 'L' });
    const pl = plOf(a, b, { at: 'x' }, null, 3);
    eq([C.latestRun(pl).at, C.lastDoneRun(pl).at], [b.at, a.at]);
    eq(C.runSections(b), { L: true, R: false });
    eq(C.runSections(runOf({ done: '' })), { L: false, R: false });
    [null, {}, { runs: 'x' }, { runs: [] }, []].forEach((p) => eq([C.latestRun(p), C.lastDoneRun(p)], [null, null], J(p)));
    eq([C.runSections(null), C.runSections({ tm: { L: ['x', 'y'] } })], [{ L: false, R: false }, { L: false, R: false }]);
  };
  T['N2 resultRoute 與 diagRowState:只有新檢測 → est;只有舊檢測 → legacy;兩者都有取晚做完的那個'] = () => {
    const ob = obTest();
    const newer = plOf(runOf());
    eq([C.resultRoute(ob, null, null, newer), C.diagRowState(ob, null, newer)], ['est', 'result'], '新來源');
    eq([C.resultRoute(ob, null, diagAt(AT), null), C.diagRowState(ob, diagAt(AT), null)], ['legacy', 'result'], '舊來源');
    eq(C.resultRoute(ob, null, diagAt(AT), newer), 'est', '新的晚做完');
    eq(C.resultRoute(ob, null, diagAt(AT + HOUR), newer), 'legacy', '舊的晚交卷');
    eq(C.resultRoute(ob, null, diagAt(AT + 20 * MIN), newer), 'est', '同時取新檢測');
    eq(C.resultRoute(ob, null, diagAt(Date.parse(TF) - DAY), newer), 'est', '開始檢測之前的舊報告不算');
    /* 舊的參數順序(沒有 pl)照舊 */
    eq(C.resultRoute(ob, null, null), 'test');
  };
  T['N3 新檢測做一半:最新一次 end 是 null → 回 S4(沒有級別)或不記完成;做完的那次早於 testFrom 不算'] = () => {
    const half = plOf(runOf({ end: null, done: 'L' }));
    eq([C.resultRoute(obTest(), null, null, half), C.diagRowState(obTest(), null, half)], ['test', 'none']);
    eq(C.resultRoute(obTest(), LV, null, half), 'test', '有級別也不能用舊級別記完成');
    /* 最新一次沒做完、前一次做完:看最新一次 */
    eq(C.resultRoute(obTest(), null, null, plOf(runOf(), runOf({ at: iso(AT + HOUR), end: null }))), 'test');
    eq(C.resultRoute(obTest({ testFrom: iso(AT + HOUR) }), null, null, plOf(runOf())), 'test', '早於 testFrom');
    eq(C.resultRoute(obTest({ status: 'done' }), LV, null, plOf(runOf())), 'draw', '不在設定流程裡');
    eq(C.resultRoute(obTest({ testFrom: null }), null, null, plOf(runOf())), 'test');
  };
  T['N4 只做一科:end 有值、只有聽力做完 → est;homeState 認得新檢測(B_result)'] = () => {
    const one = plOf(runOf({ done: 'L' }));
    assert.equal(C.resultRoute(obTest(), null, null, one), 'est');
    const ctx = { cloudEnabled: true, signedIn: true, onboard: obTest(), nowMs: NOW, createdAtMs: NOW - 30 * DAY, placement: one };
    eq([C.homeState(ctx), C.homeState(Object.assign({}, ctx, { placement: plOf(runOf({ end: null })) }))], ['B_result', 'B']);
  };
  T['N5 levelsFromEstimate:做完的科用預估的級別(來源 est);沒做的科有級別不動、沒有用預估再沒有入門'] = () => {
    const both = runOf();
    eq(C.levelsFromEstimate(view('high', 'entry'), both, null), { listening: 'high', reading: 'entry', source: { listening: 'est', reading: 'est' } });
    const onlyL = runOf({ done: 'L' });
    eq(C.levelsFromEstimate(view('threshold', 'advanced'), onlyL, LV), { listening: 'threshold', reading: 'threshold', source: { listening: 'est', reading: 'score' } }, '另一科不動');
    eq(C.levelsFromEstimate(view('threshold', 'advanced'), onlyL, null), { listening: 'threshold', reading: 'advanced', source: { listening: 'est', reading: 'est' } }, '舊 28 題補回的閱讀');
    eq(C.levelsFromEstimate(view('threshold', null), onlyL, null).reading, 'entry', '沒有數字:入門');
    eq(C.levelsFromEstimate(view('threshold', null), onlyL, null).source.reading, 'entry');
    /* 預估算不出來(題目參數沒載到):用這一次存的結果;都沒有回 null */
    const res = runOf({ res: { L: [345, 275, 415], R: [180, 110, 250] } });
    eq(C.levelsFromEstimate(null, res, null), { listening: 'advanced', reading: 'threshold', source: { listening: 'est', reading: 'est' } });
    eq(C.levelsFromEstimate({ ok: false }, both, null), null);
    eq(C.levelsFromEstimate(view('high', 'high'), runOf({ done: '' }), LV), null, '一科都沒做完');
    const frozen = deepFreeze(JSON.parse(J(LV)));
    C.levelsFromEstimate(view('entry', 'entry'), onlyL, frozen);
  };
  T['N6 estPolicy:設定完過、有級別、有課程進度才只給建議;其他直接寫'] = () => {
    eq([C.estPolicy(obTest({ doneAt: NOW_ISO }), LV, true), C.estPolicy(obTest({ doneAt: NOW_ISO }), LV, false),
      C.estPolicy(obTest(), LV, true), C.estPolicy(obTest({ doneAt: NOW_ISO }), null, true), C.estPolicy(null, LV, true)],
    ['suggest', 'write', 'write', 'write', 'write']);
  };
  T['N7 testedLevels 認得 est(S8b 差 2 級也比新檢測);testPlan:只有舊檢測只做聽力'] = () => {
    const lv = { history: [{ reason: 'legacy', listening: 'entry', reading: 'entry' }, { reason: 'est', listening: 'high', reading: 'advanced' }, { reason: 'manual' }] };
    eq(plain(C.testedLevels(lv)).reason, 'est');
    eq([C.testPlan(null, null), C.testPlan(diagAt(AT), null), C.testPlan(diagAt(AT), plOf(runOf({ done: 'L', end: null }))),
      C.testPlan(diagAt(AT), plOf(runOf({ done: 'R' }))), C.testPlan({ done: false }, null)], ['LR', 'L', 'LR', 'LR', 'LR']);
    eq([C.placementHref(null), C.placementHref('L'), C.placementHref('x')],
      ['placement.html?start=1&from=onboard', 'placement.html?start=1&from=onboard&sec=L', 'placement.html?start=1&from=onboard']);
    assert.equal(C.hasPracticeKeys([PRE + 'fa_v1'], CPID), true);
    assert.equal(C.hasPracticeKeys([PRE + 'placement_v1'], CPID), true);
    assert.equal(C.hasPracticeKeys([PRE + 'est_v1'], CPID), false, '快照不算練習');
  };
  T['N8 settingsRows:有新檢測「重新檢測」放新檢測日期、報告連新結果頁;兩種都有時舊報告另列;只有舊檢測照舊'] = () => {
    const acc = { onboard: { status: 'done', targetScore: 600, examMonth: null }, levels: LV };
    const pl = plOf(runOf({ end: '2026-11-24T04:00:00.000Z' }));
    const rows = (d, p) => plain(C.settingsRows(acc, d, p)).slice(3).map((r) => [r.label, r.value, r.href]);
    eq(rows(null, pl), [['重新檢測', '11 月 24 日', 'start.html?step=test&from=me'], ['檢測報告', '11 月 24 日', 'placement.html?view=last']]);
    eq(rows({ done: true, finishedAt: '2026-11-18T04:00:00.000Z' }, pl), [['重新檢測', '11 月 24 日', 'start.html?step=test&from=me'],
      ['檢測報告', '11 月 24 日', 'placement.html?view=last'], ['閱讀檢測報告', '11 月 18 日', 'diagnostic.html']]);
    eq(rows({ done: true, finishedAt: '2026-11-18T04:00:00.000Z' }, null), [['重新檢測', '11 月 18 日', 'start.html?step=test&from=me'], ['檢測報告', '11 月 18 日', 'diagnostic.html']]);
    eq(rows(null, plOf(runOf({ end: null }))), [['做檢測', '', 'start.html?step=test&from=me']], '做一半不算做過');
  };
  T['N9 資料層:setEstLevels 寫 levels(理由 est)與 onboard;startTest 不動 diag、fa_v1、placement_v1;keepLevelsAfterTest 不動 levels'] = () => {
    const diag = J(diagAt(AT)), fa = J({ v: 1, i: { 'd5-01': [200, 1, 'g'] } }), pl = J(plOf(runOf()));
    const e = dataEnv(signedIn({ init: { [PRE + 'diag']: diag, [PRE + 'fa_v1']: fa, [PRE + 'placement_v1']: pl,
      [PRE + 'onboard']: J({ v: 1, status: 'done', step: 'result', doneAt: NOW_ISO, updatedAt: NOW_ISO }) } }));
    assert.equal(e.D.startTest(), 'ok');
    eq([e.ls.get(PRE + 'diag'), e.ls.get(PRE + 'fa_v1'), e.ls.get(PRE + 'placement_v1')], [diag, fa, pl], '舊檢測與作答紀錄都還在');
    eq(plain(e.D.placement()), JSON.parse(pl));
    eq(plain(e.D.context(null).placement), JSON.parse(pl));
    assert.equal(e.D.setEstLevels({ listening: 'high', reading: 'entry', source: { listening: 'est', reading: 'manual' } }), 'ok');
    const lv = JSON.parse(e.ls.get(PRE + 'levels')), ob = JSON.parse(e.ls.get(PRE + 'onboard'));
    eq([lv.listening, lv.reading, lv.source, lv.history[0].reason, ob.levelSource, ob.step], ['high', 'entry', { listening: 'est', reading: 'manual' }, 'est', 'est', 'result']);
    assert.equal(e.D.startTest(), 'ok');
    assert.equal(e.D.keepLevelsAfterTest(), 'ok');
    eq([e.ls.get(PRE + 'levels') === J(lv), JSON.parse(e.ls.get(PRE + 'onboard')).step], [true, 'result']);
    assert.equal(e.D.applyEst({ listening: 'entry', reading: 'entry', source: { listening: 'est', reading: 'est' } }), 'ok');
    eq(JSON.parse(e.ls.get(PRE + 'levels')).history.map((h) => h.reason), ['est', 'est']);
    eq([e.D.hasCourse(), dataEnv(signedIn({ init: { [PRE + 'plan']: J({ v: 1 }) } })).D.hasCourse()], [false, true]);
    const g = dataEnv({});
    eq([g.D.setEstLevels({ listening: 'high', reading: 'high', source: {} }), g.D.keepLevelsAfterTest(), g.D.applyEst({})], ['guest', 'guest', 'guest']);
    const r = dataEnv(signedIn({ reloading: true }));
    assert.equal(r.D.setEstLevels({ listening: 'high', reading: 'high', source: {} }), 'blocked');
  };
};

