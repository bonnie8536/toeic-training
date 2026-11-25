/* 新用戶設定起始程度(start.html)的測試:純函式(js/onboard-core.js)、資料層(js/onboard-data.js)。
   頁面接點與靜態檢查在 tools/test_onboard_pages.js,畫面行為在 tools/test_onboard_screens.js。
   核心檔在沒有 document、localStorage 的沙盒載入;資料層用真的 js/common.js 配假的 localStorage 與假的 CLOUD。
   台北時間的算法另外用 TZ=UTC 與 TZ=America/Los_Angeles 各再跑一次(只跑純函式),確認不看裝置時區。
   用法:node tools/test_onboard.js */
'use strict';
const vm = require('vm');
const assert = require('assert');
const { spawnSync } = require('child_process');

const { REPO, read, exists, MIN, HOUR, DAY, NOW, NOW_ISO, UID, CPID, C, J, deepFreeze, plain, eq, guestOf, NONCE, dataEnv, signedIn } = require('./onboard_kit');
const ONLY_CORE = process.argv.includes('--core');
const DRAFT = { listening: '325', reading: '270', total: '', examYm: '2026-05', fromTotal: false };
const DRAFT_TOTAL = { listening: '', reading: '', total: '595', examYm: 'older', fromTotal: true };

const T = {};

/* ---------- 純函式 ---------- */
T['O1 LEVELS 順序;levelName 四級,不認得回空字串'] = () => {
  eq(C.LEVELS, ['entry', 'threshold', 'advanced', 'high']);
  eq(['entry', 'threshold', 'advanced', 'high', 'x', null].map(C.levelName), ['入門', '門檻', '進階', '高分', '', '']);
};
T['O2 levelsLabel:正常回全形斜線;形狀不對一律「未設定」'] = () => {
  assert.equal(C.levelsLabel({ listening: 'threshold', reading: 'entry' }), '聽力 門檻／閱讀 入門');
  [{ listening: 'threshold' }, { listening: 'x', reading: 'entry' }, null, [], 'entry', undefined].forEach((v) => assert.equal(C.levelsLabel(v), '未設定', J(v)));
};
const L_TABLE = [[5, 'entry'], [220, 'entry'], [225, 'threshold'], [320, 'threshold'], [325, 'advanced'], [410, 'advanced'], [415, 'high'], [495, 'high']];
const R_TABLE = [[5, 'entry'], [170, 'entry'], [175, 'threshold'], [270, 'threshold'], [275, 'advanced'], [365, 'advanced'], [370, 'high'], [495, 'high']];
T['O3 聽力對級 8 個邊界'] = () => { L_TABLE.forEach(([s, l]) => assert.equal(C.bandOf('listening', s), l, String(s))); };
T['O4 閱讀對級 8 個邊界'] = () => { R_TABLE.forEach(([s, l]) => assert.equal(C.bandOf('reading', s), l, String(s))); };
T['O5 parseScoreInput:全形數字、頭尾空白可以;小數、科學記號、負號、空字串是 NaN'] = () => {
  assert.equal(C.parseScoreInput('２２５'), 225);
  assert.equal(C.parseScoreInput(' 225 '), 225);
  ['22.5', '2e2', '-5', '', '   ', 'abc', null].forEach((s) => assert.ok(Number.isNaN(C.parseScoreInput(s)), J(s)));
};
T['O6 分數欄檢查:錯誤文字逐字比對'] = () => {
  const S = '請輸入 5 到 495 之間、5 的倍數', TT = '請輸入 10 到 990 之間、5 的倍數';
  ['', '0', '4', '500', '-5', '222', '22.5', '2e2'].forEach((s) => assert.equal(C.checkSection(C.parseScoreInput(s)), S, s));
  ['5', '495', ' 225 ', '２２５'].forEach((s) => assert.equal(C.checkSection(C.parseScoreInput(s)), '', s));
  ['5', '995', '603'].forEach((s) => assert.equal(C.checkTotal(C.parseScoreInput(s)), TT, s));
  ['10', '990'].forEach((s) => assert.equal(C.checkTotal(C.parseScoreInput(s)), '', s));
  const e = C.draftErrors({ listening: '225', reading: '175', total: '', examYm: '', fromTotal: false });
  assert.equal(e.examYm, '請選擇考試年月');
};
T['O7 splitTotal:表上 9 列;10 到 990 每 5 分兩科都是 5 的倍數、在 5 到 495、相加等於總分'] = () => {
  const rows = [[10, 5, 5, 'entry', 'entry'], [395, 225, 170, 'threshold', 'entry'], [400, 225, 175, 'threshold', 'threshold'],
    [595, 325, 270, 'advanced', 'threshold'], [600, 325, 275, 'advanced', 'advanced'], [780, 415, 365, 'high', 'advanced'],
    [785, 420, 365, 'high', 'advanced'], [945, 495, 450, 'high', 'high'], [990, 495, 495, 'high', 'high']];
  rows.forEach(([t, l, r, bl, br]) => {
    eq(C.splitTotal(t), { listening: l, reading: r }, String(t));
    assert.equal(C.bandOf('listening', l), bl); assert.equal(C.bandOf('reading', r), br);
  });
  for (let t = 10; t <= 990; t += 5) {
    const s = C.splitTotal(t);
    assert.ok(s.listening % 5 === 0 && s.reading % 5 === 0 && s.listening >= 5 && s.listening <= 495 && s.reading >= 5 && s.reading <= 495 && s.listening + s.reading === t, String(t));
  }
};
T['O8 levelsFromScore:分開填與只填總分;source 兩科 score'] = () => {
  eq(C.levelsFromScore({ listening: 325, reading: 170 }), { listening: 'advanced', reading: 'entry', source: { listening: 'score', reading: 'score' } });
  const s = C.scoreFromDraft(DRAFT_TOTAL);
  eq(s, { listening: 325, reading: 270, total: 595, examYm: 'older', fromTotal: true });
  eq(C.levelsFromScore(s), { listening: 'advanced', reading: 'threshold', source: { listening: 'score', reading: 'score' } });
  eq(C.scoreFromDraft(DRAFT), { listening: 325, reading: 270, total: 595, examYm: '2026-05', fromTotal: false });
  assert.equal(C.scoreFromDraft({ listening: '222', reading: '270', total: '', examYm: '2026-05', fromTotal: false }), null);
  assert.equal(C.scoreFromDraft({ listening: '225', reading: '270', total: '', examYm: '', fromTotal: false }), null);
};
T['O9 monthsBetween、scoreTooOld(台北 2026-11-19)'] = () => {
  [['2026-11', 0, false], ['2024-11', 24, false], ['2024-10', 25, true]].forEach(([ym, n, old]) => {
    assert.equal(C.monthsBetween(ym, NOW), n, ym); assert.equal(C.scoreTooOld(ym, NOW), old, ym);
  });
  assert.equal(C.scoreTooOld('older', NOW), true);
  assert.equal(C.dayLabel('2026-11-18T16:30:00.000Z'), '11 月 19 日');   // 台北已經是隔天
  assert.equal(C.dayLabel('x'), '');
  assert.equal(C.ymLabel('2027-03'), '2027 年 3 月');
};
T['O10 scoreMonths:37 個,第一個是本月、最後是更早;跨年;台北跨日'] = () => {
  const m = C.scoreMonths(NOW);
  assert.equal(m.length, 37);
  eq(m[0], { value: '2026-11', label: '2026 年 11 月' });
  assert.equal(m[35].value, '2023-12');
  eq(m[36], { value: 'older', label: '更早' });
  const jan = C.scoreMonths(Date.parse('2027-01-10T12:00:00+08:00'));
  assert.equal(jan[0].value, '2027-01'); assert.equal(jan[1].value, '2026-12');
  assert.equal(C.scoreMonths(Date.parse('2026-11-30T16:00:00Z'))[0].value, '2026-12');
  assert.equal(C.scoreMonths(Date.parse('2026-11-30T15:59:00Z'))[0].value, '2026-11');
};
T['O11 examMonths:12 個、本月起、標籤格式、台北跨日兩列'] = () => {
  const m = C.examMonths(NOW);
  assert.equal(m.length, 12);
  assert.equal(m[0].value, '2026-11'); assert.equal(m[11].value, '2027-10');
  assert.equal(m[4].label, '2027 年 3 月');
  assert.equal(C.examMonths(Date.parse('2026-11-30T16:00:00Z'))[0].value, '2026-12');
  assert.equal(C.examMonths(Date.parse('2026-12-31T16:00:00Z'))[0].value, '2027-01');
};
function loadDiagData() {
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('data/diagnostic.js'), ctx);
  return ctx.TOEIC.diagnostic;
}
T['O12 flattenDiagItems:真的題目 28 筆,順序同 js/diagnostic.js(P5、P6、P7),基礎題 8 題'] = () => {
  const D = loadDiagData();
  const items = C.flattenDiagItems(D);
  const want = [].concat(D.p5, D.p6.questions, D.p7.questions).map((q) => ({ answer: q.answer, difficulty: q.difficulty }));
  assert.equal(items.length, 28);
  eq(items, want);
  assert.equal(items.filter((x) => x.difficulty === '基礎').length, 8);
  eq(C.flattenDiagItems(null), []);
  assert.ok(/D\.p5\.forEach[\s\S]*D\.p6\.questions\.forEach[\s\S]*D\.p7\.questions\.forEach/.test(read('js/diagnostic.js')), 'js/diagnostic.js 的攤平順序變了');
};
/* 假題目:前 8 題是基礎題,正解都是 0 */
const FAKE_ITEMS = Array.from({ length: 28 }, (_, i) => ({ answer: 0, difficulty: i < 8 ? '基礎' : '中級' }));
function diagWith(correct, basic, strKeys) {
  const answers = {};
  for (let i = 0; i < 28; i++) answers[strKeys ? String(i) : i] = 1;
  for (let i = 0; i < basic; i++) answers[i] = 0;
  for (let i = 0; i < correct - basic; i++) answers[8 + i] = 0;
  return { answers, done: true, startedAt: '2026-11-18T01:00:00.000Z', finishedAt: '2026-11-18T01:20:00.000Z' };
}
T['O13 legacyReading:表上 8 列;未完成、answers 缺、鍵是字串'] = () => {
  [[0, 0, 'entry'], [13, 4, 'entry'], [13, 5, 'threshold'], [14, 2, 'threshold'], [18, 8, 'threshold'], [19, 8, 'advanced'], [23, 8, 'advanced'], [24, 8, 'high'], [28, 8, 'high']]
    .forEach(([c, b, lv]) => {
      const r = C.legacyReading(diagWith(c, b), FAKE_ITEMS);
      assert.equal(r.level, lv, c + '/' + b); assert.equal(r.correct, c); assert.equal(r.basicCorrect, b); assert.equal(r.total, 28); assert.equal(r.basicTotal, 8);
    });
  assert.equal(C.legacyReading({ answers: {}, done: false }, FAKE_ITEMS), null);
  assert.equal(C.legacyReading(diagWith(20, 8), []), null);
  assert.equal(C.legacyReading({ done: true }, FAKE_ITEMS).level, 'entry');
  const s = C.legacyReading(JSON.parse(J(diagWith(19, 8, true))), FAKE_ITEMS);
  assert.equal(s.correct, 19); assert.equal(s.level, 'advanced');
};
T['O14 plusOne 四級;levelsFromLegacy 的 source'] = () => {
  eq(['entry', 'threshold', 'advanced', 'high'].map(C.plusOne), ['threshold', 'advanced', 'high', 'high']);
  eq(C.levelsFromLegacy(diagWith(13, 5), FAKE_ITEMS), { listening: 'advanced', reading: 'threshold', source: { listening: 'legacy_plus1', reading: 'legacy' } });
  eq(C.levelsFromLegacy(diagWith(28, 8), FAKE_ITEMS).listening, 'high');
  assert.equal(C.levelsFromLegacy({ done: false }, FAKE_ITEMS), null);
};
T['O15 legacyUsable:179 天 23 小時可以,180 天整不行,finishedAt 缺或壞不行'] = () => {
  const f = (ms) => ({ done: true, finishedAt: new Date(NOW - ms).toISOString() });
  assert.equal(C.legacyUsable(f(180 * DAY - HOUR), NOW), true);
  assert.equal(C.legacyUsable(f(180 * DAY), NOW), false);
  assert.equal(C.legacyUsable({ done: true }, NOW), false);
  assert.equal(C.legacyUsable({ done: true, finishedAt: 'x' }, NOW), false);
  assert.equal(C.legacyUsable({ done: false, finishedAt: NOW_ISO }, NOW), false);
};
T['O16 practiceLink:先取較低的一科,同級取閱讀;形狀不對回 null'] = () => {
  [['threshold', 'entry', 'grammar.html'], ['entry', 'threshold', 'practice.html?part=1'], ['entry', 'entry', 'grammar.html'],
    ['advanced', 'threshold', 'practice.html?part=5'], ['threshold', 'advanced', 'practice.html?part=2'], ['high', 'advanced', 'practice.html?part=6'],
    ['advanced', 'high', 'practice.html?part=3'], ['high', 'high', 'practice.html?part=7']]
    .forEach(([l, r, url]) => assert.equal(C.practiceLink({ listening: l, reading: r }), url, l + '/' + r));
  assert.equal(C.practiceLink({ listening: 'x', reading: 'entry' }), null);
  assert.equal(C.practiceLink(null), null);
};
T['O16b practiceLink:16 種組合裡聽力高分(part=4)一個都選不到(同級取閱讀,實際只有 7 種可到)'] = () => {
  const got = new Set();
  C.LEVELS.forEach((l) => C.LEVELS.forEach((r) => got.add(C.practiceLink({ listening: l, reading: r }))));
  assert.equal(got.has('practice.html?part=4'), false);
  eq([...got].sort(), ['grammar.html', 'practice.html?part=1', 'practice.html?part=2', 'practice.html?part=3', 'practice.html?part=5', 'practice.html?part=6', 'practice.html?part=7']);
};
T['O16c bandOf、levelsFromScore 防呆:不是 5 到 495 的 5 的倍數回 null'] = () => {
  [NaN, undefined, null, 0, 500, 222, '225', 22.5].forEach((v) => assert.equal(C.bandOf('listening', v), null, String(v)));
  assert.equal(C.levelsFromScore({ listening: 325, reading: NaN }), null);
  assert.equal(C.levelsFromScore(null), null);
};
T['O16e newLevels:最後一筆一樣、1 分鐘內不再多記;超過 1 分鐘照記'] = () => {
  const a = C.newLevels(null, 'entry', 'entry', { listening: 'entry', reading: 'entry' }, 'entry', NOW_ISO);
  const b = C.newLevels(a, 'entry', 'entry', { listening: 'entry', reading: 'entry' }, 'entry', new Date(NOW + 5e3).toISOString());
  assert.equal(b.history.length, 1);
  const c = C.newLevels(a, 'entry', 'entry', { listening: 'entry', reading: 'entry' }, 'entry', new Date(NOW + 2 * MIN).toISOString());
  assert.equal(c.history.length, 2);
  assert.equal(C.newLevels(a, 'high', 'entry', {}, 'manual', NOW_ISO).history.length, 2);
};
T['O16f resultRoute:重新檢測還沒交卷回 test,不記完成'] = () => {
  const lv = { listening: 'advanced', reading: 'threshold' };
  const tf = '2026-11-19T01:00:00.000Z';
  const oldDiag = null;
  assert.equal(C.resultRoute({ status: 'in_progress', step: 'test', testFrom: tf }, lv, oldDiag), 'test');
  assert.equal(C.resultRoute({ status: 'in_progress', step: 'test', testFrom: tf }, lv, { done: true, finishedAt: '2026-11-19T02:00:00.000Z' }), 'legacy');
  assert.equal(C.resultRoute({ status: 'in_progress', step: 'result' }, lv, null), 'done');
  assert.equal(C.resultRoute({ status: 'done', step: 'test' }, lv, null), 'draw');
  assert.equal(C.resultRoute({ status: 'in_progress', step: 'exam' }, lv, null), 'exam');
  assert.equal(C.resultRoute(null, lv, null), 'done');
  assert.equal(C.resultRoute({ status: 'in_progress', step: 'test' }, null, null), 'test');
  assert.equal(C.resultRoute({ status: 'in_progress', step: 'score' }, null, null), 'level');
};
T['O17 levelGap'] = () => {
  assert.equal(C.levelGap('entry', 'entry'), 0); assert.equal(C.levelGap('entry', 'threshold'), 1);
  assert.equal(C.levelGap('high', 'threshold'), 2); assert.equal(C.levelGap('entry', 'high'), 3);
};
T['O18 pushHistory:不改原物件;第 21 筆刪最舊;reason 保留'] = () => {
  const hist = Array.from({ length: 20 }, (_, i) => ({ at: 'h' + i, listening: 'entry', reading: 'entry', reason: 'manual' }));
  const lv = deepFreeze({ listening: 'entry', reading: 'entry', source: { listening: 'entry', reading: 'entry' }, setAt: 'x', history: hist });
  const out = C.pushHistory(lv, { at: 'new', listening: 'high', reading: 'high', reason: 'score' });
  assert.equal(out.history.length, 20); assert.equal(out.history[0].at, 'h1'); assert.equal(out.history[19].reason, 'score');
  assert.equal(lv.history.length, 20);
  assert.equal(C.pushHistory(null, { at: 'a', listening: 'entry', reading: 'entry', reason: 'entry' }).history.length, 1);
};
T['O19 readGuest:正常;壞的一律 null;7 天期限與時鐘誤差'] = () => {
  const ok = guestOf();
  eq(C.readGuest(J(ok), NOW), ok);
  ['{bad', J(guestOf({ v: 2 })), J(guestOf({ targetScore: 500 })), J(guestOf({ examMonth: '2027-3' })), J(guestOf({ pendingAction: 'x' })),
    J(guestOf({ step: 'test' })), J(guestOf({ pendingAction: 'score', authStartedAt: NOW, scoreDraft: null })), 'null', null]
    .forEach((raw) => assert.equal(C.readGuest(raw, NOW), null, raw));
  const at = (ago) => J(guestOf({ createdAt: NOW - ago, expiresAt: NOW - ago + 7 * DAY }));
  assert.ok(C.readGuest(at(7 * DAY - MIN), NOW));
  assert.equal(C.readGuest(at(7 * DAY), NOW), null);
  assert.ok(C.readGuest(at(-MIN), NOW));
  assert.equal(C.readGuest(at(-3 * MIN), NOW), null);
  assert.ok(C.readGuest(J(guestOf({ pendingAction: 'score', authStartedAt: NOW, scoreDraft: DRAFT })), NOW));
  const g = C.newGuest(NOW);
  assert.equal(g.expiresAt - g.createdAt, 7 * DAY); assert.equal(g.step, 'target');
  /* 先整理草稿再檢查:fromTotal 是字串 "true" 會被整理成 false,只填了總分就不算有效草稿 */
  const strTrue = Object.assign({}, DRAFT_TOTAL, { fromTotal: 'true' });
  assert.equal(C.readGuest(J(guestOf({ pendingAction: 'score', authStartedAt: NOW, scoreDraft: strTrue })), NOW), null);
  /* 隨機碼:沒有、null、16 到 40 個小寫英數可以;其他不行 */
  assert.equal(C.readGuest(J(guestOf({ authNonce: NONCE })), NOW).authNonce, NONCE);
  const noField = guestOf(); delete noField.authNonce;
  assert.equal(C.readGuest(J(noField), NOW).authNonce, null);
  ['short', 'ABCDEFGHIJ0123456789', 123].forEach((n) => assert.equal(C.readGuest(J(guestOf({ authNonce: n })), NOW), null, String(n)));
};
T['O20 resumeEligible:接回表 5 列'] = () => {
  const g = (a, ago) => guestOf({ pendingAction: a, authStartedAt: NOW - ago, scoreDraft: a === 'score' ? DRAFT : null });
  assert.equal(C.resumeEligible(g(null, MIN), NOW), false);
  assert.equal(C.resumeEligible(g('test', 24 * HOUR - MIN), NOW), true);
  assert.equal(C.resumeEligible(g('test', 24 * HOUR), NOW), false);
  assert.equal(C.resumeEligible(g('score', -MIN), NOW), true);
  assert.equal(C.resumeEligible(g('entry', -3 * MIN), NOW), false);
  assert.equal(C.resumeEligible(null, NOW), false);
};

/* ---------- 入口判斷 ---------- */
function ctxOf(over) {
  return Object.assign({ joinParam: null, signedIn: true, isTeacher: false, onboard: null, guest: null, nowMs: NOW, createdAtMs: NOW - 30 * DAY,
    hasPracticeKeys: false, isApp: false, hasLocalData: false, cloudEnabled: true, diag: null }, over || {});
}
const route = (over) => plain(C.entryRoute(ctxOf(over)));
const pend = (a, ago) => guestOf({ pendingAction: a, authStartedAt: NOW - ago });
T['E1–E18 入口判斷十列與優先順序'] = () => {
  assert.equal(route({ joinParam: 'ABCD2345', signedIn: false }).row, 1);
  assert.equal(route({ joinParam: 'ABCD2345', signedIn: false }).state, 'join');
  eq(route({ guest: pend('test', 10 * MIN) }), { row: 2, state: 'resume', cleanupGuest: false });
  const e3 = route({ guest: guestOf() });
  assert.equal(e3.cleanupGuest, true); assert.equal(e3.row, 7); assert.equal(e3.state, 'E');
  const e4 = route({ guest: pend('test', 25 * HOUR) });
  assert.equal(e4.cleanupGuest, true); assert.equal(e4.row, 7);
  eq(route({ isTeacher: true }), { row: 3, state: 'none', cleanupGuest: false });
  eq(route({ onboard: { status: 'done' } }), { row: 4, state: 'D0', cleanupGuest: false });
  eq(route({ onboard: { status: 'in_progress' } }), { row: 5, state: 'B', cleanupGuest: false });
  eq(route({ createdAtMs: NOW - 6 * DAY }), { row: 6, state: 'A', cleanupGuest: false });
  eq(route({ createdAtMs: NOW - 8 * DAY }), { row: 7, state: 'E', cleanupGuest: false });
  eq(route({ createdAtMs: NOW - DAY, hasPracticeKeys: true }), { row: 7, state: 'E', cleanupGuest: false });
  eq(route({ createdAtMs: null }), { row: 7, state: 'E', cleanupGuest: false });
  eq(route({ onboard: { status: 'dismissed' } }), { row: 7, state: 'none', cleanupGuest: false });
  eq(route({ signedIn: false, guest: guestOf({ step: 'exam' }) }), { row: 8, state: 'B', cleanupGuest: false });
  eq(route({ signedIn: false, isApp: true }), { row: 9, state: 'S0', cleanupGuest: false });
  eq(route({ signedIn: false, isApp: true, hasLocalData: true }), { row: 10, state: 'A', cleanupGuest: false });
  eq(route({ signedIn: false }), { row: 10, state: 'A', cleanupGuest: false });
  assert.equal(route({ joinParam: 'ABCD2345', guest: pend('test', MIN) }).row, 1);
  assert.equal(route({ isTeacher: true, guest: pend('test', MIN) }).row, 2);
  eq(route({ cloudEnabled: false }), { row: 0, state: 'none', cleanupGuest: false });
};
T['E19 homeState:檢測中、交卷晚於 testFrom → B_result'] = () => {
  const ob = { status: 'in_progress', step: 'test', testFrom: '2026-11-19T01:00:00.000Z' };
  assert.equal(C.homeState(ctxOf({ onboard: ob, diag: { done: true, finishedAt: '2026-11-19T02:00:00.000Z' } })), 'B_result');
  assert.equal(C.homeState(ctxOf({ onboard: ob, diag: { done: true, finishedAt: '2026-11-18T02:00:00.000Z' } })), 'B');
  assert.equal(C.homeState(ctxOf({ onboard: { status: 'done' } })), 'D0');
};
T['入口判斷:帳號資料夾的練習鍵與本機學習資料'] = () => {
  assert.equal(C.hasPracticeKeys(['tr_u' + CPID + '_hist'], CPID), true);
  assert.equal(C.hasPracticeKeys(['tr_u' + CPID + '_drill_p5'], CPID), true);
  assert.equal(C.hasPracticeKeys(['tr_u' + CPID + '_listen_p12'], CPID), true);
  assert.equal(C.hasPracticeKeys(['tr_u' + CPID + '_diag'], CPID), true);
  assert.equal(C.hasPracticeKeys(['tr_u' + CPID + '_pet', 'tr_hist', 'tr_ucother_hist'], CPID), false);
  assert.equal(C.hasLocalData(['tr_onboard_guest', 'sb-x', 'tr_pending_join']), false);
  assert.equal(C.hasLocalData(['tr_current_profile']), true);
  assert.equal(C.hasLocalData(['tr_upabc123_hist']), true);
};

/* ---------- 接回與 X1 ---------- */
/* trusted:登入是這個分頁的 S9 發起的(隨機碼一致)。R 系列預設一致,不一致的案例在 R13 起 */
const acc = (over) => Object.assign({ onboard: null, self_score: null, levels: null, isTeacher: false, hasPendingJoin: false, trusted: true }, over || {});
const gp = (a, over) => guestOf(Object.assign({ pendingAction: a, authStartedAt: NOW - MIN, scoreDraft: a === 'score' ? DRAFT : null, authNonce: NONCE }, over || {}));
T['R1 test:寫 onboard(訪客的目標與月份、in_progress、step test、previous null),去 S4'] = () => {
  const p = plain(C.resumePlan(gp('test'), acc(), NOW_ISO));
  assert.equal(p.kind, 'write'); assert.equal(p.next, 'test');
  eq(Object.keys(p.writes), ['onboard']);
  const o = p.writes.onboard;
  eq([o.v, o.status, o.step, o.path, o.targetScore, o.examMonth, o.previous, o.startedAt, o.updatedAt, o.doneAt],
    [1, 'in_progress', 'test', 'self', 600, '2027-03', null, NOW_ISO, NOW_ISO, null]);
};
T['R2 entry:另寫 levels 兩科入門,去 S8'] = () => {
  const p = plain(C.resumePlan(gp('entry'), acc(), NOW_ISO));
  assert.equal(p.next, 'result');
  eq([p.writes.levels.listening, p.writes.levels.reading, p.writes.levels.source], ['entry', 'entry', { listening: 'entry', reading: 'entry' }]);
  assert.equal(p.writes.levels.history[0].reason, 'entry');
  assert.equal(p.writes.onboard.levelSource, 'entry'); assert.equal(p.writes.onboard.step, 'result');
};
T['R3 score(分開填):self_score 與草稿相同、levels 照對級'] = () => {
  const p = plain(C.resumePlan(gp('score'), acc(), NOW_ISO));
  eq(p.writes.self_score, { listening: 325, reading: 270, total: 595, examYm: '2026-05', fromTotal: false, enteredAt: NOW_ISO });
  eq([p.writes.levels.listening, p.writes.levels.reading], ['advanced', 'threshold']);
  assert.equal(p.writes.onboard.levelSource, 'score'); assert.equal(p.next, 'result');
};
T['R4 score(只填總分):fromTotal、拆分照 O7'] = () => {
  const p = plain(C.resumePlan(gp('score', { scoreDraft: DRAFT_TOTAL }), acc(), NOW_ISO));
  eq([p.writes.self_score.fromTotal, p.writes.self_score.listening, p.writes.self_score.reading], [true, 325, 270]);
};
T['R5 帳號 in_progress、沒有 levels:previous 帶原本的 onboard,沒有 self_score、levels 就不放'] = () => {
  const ob = { v: 1, status: 'in_progress', step: 'exam' };
  const p = plain(C.resumePlan(gp('test'), acc({ onboard: ob }), NOW_ISO));
  assert.equal(p.kind, 'write');
  eq(p.writes.onboard.previous, { onboard: ob });
};
T['R5b(T2)帳號 in_progress(或 dismissed)但已有 levels → X1,不寫'] = () => {
  const lv = { listening: 'advanced', reading: 'advanced', source: { listening: 'legacy_plus1', reading: 'legacy' }, setAt: 'x', history: [] };
  ['in_progress', 'dismissed'].forEach((st) => {
    const p = plain(C.resumePlan(gp('entry'), acc({ onboard: { v: 1, status: st, step: 'test' }, levels: lv }), NOW_ISO));
    eq([p.kind, p.writes], ['x1', {}], st);
  });
};
T['R5c(T3)previous 不套層:舊 onboard 的 previous 拿掉;levels 只留兩科、來源、時間'] = () => {
  const ob = { v: 1, status: 'done', step: 'result', previous: { onboard: { v: 1, previous: { onboard: {} } } } };
  const lv = { listening: 'high', reading: 'high', source: { listening: 'manual', reading: 'manual' }, setAt: 'x', history: [{ at: 'h', listening: 'high', reading: 'high', reason: 'manual' }] };
  const r = plain(C.applyX1('reset', gp('test'), acc({ onboard: ob, levels: lv, self_score: { listening: 400 } }), NOW_ISO));
  eq(r.writes.onboard.previous, { onboard: { v: 1, status: 'done', step: 'result' }, self_score: { listening: 400 },
    levels: { listening: 'high', reading: 'high', source: { listening: 'manual', reading: 'manual' }, setAt: 'x' } });
  /* 連續 5 次重新設定,previous 還是只有一層 */
  let cur = ob;
  for (let i = 0; i < 5; i++) cur = plain(C.applyX1('reset', gp('test'), acc({ onboard: cur }), NOW_ISO)).writes.onboard;
  assert.equal(cur.previous.onboard.previous, undefined);
};
T['R6 帳號 done → X1,不寫'] = () => {
  const p = plain(C.resumePlan(gp('test'), acc({ onboard: { status: 'done' } }), NOW_ISO));
  assert.equal(p.kind, 'x1'); eq(p.writes, {});
};
T['R7、R8 applyX1:keep 不寫、回首頁;reset 照 R5 寫'] = () => {
  const a = acc({ onboard: { v: 1, status: 'done' }, levels: { listening: 'high', reading: 'high' } });
  eq(C.applyX1('keep', gp('test'), a, NOW_ISO), { kind: 'keep', writes: {}, next: 'home' });
  const r = plain(C.applyX1('reset', gp('test'), a, NOW_ISO));
  assert.equal(r.kind, 'write'); assert.equal(r.next, 'test');
  eq(r.writes.onboard.previous, { onboard: { v: 1, status: 'done' }, levels: { listening: 'high', reading: 'high' } });
  assert.equal(r.writes.onboard.status, 'in_progress');
};
T['R13(T1)隨機碼不一致、還沒確認 → confirm,不寫任何鍵'] = () => {
  ['test', 'entry', 'score'].forEach((a) => eq(C.resumePlan(gp(a), acc({ trusted: false }), NOW_ISO), { kind: 'confirm', writes: {}, next: 'home' }, a));
};
T['R14 不一致、本人確認帶入:只帶目標與月份;自填成績不帶,改到 S3a 重填'] = () => {
  const p = plain(C.resumePlan(gp('score'), acc({ trusted: false, confirmed: true }), NOW_ISO));
  eq([p.kind, p.next, Object.keys(p.writes)], ['write', 'score', ['onboard']]);
  eq([p.writes.onboard.step, p.writes.onboard.targetScore, p.writes.onboard.examMonth, p.writes.onboard.levelSource], ['score', 600, '2027-03', null]);
  const t = plain(C.resumePlan(gp('test'), acc({ trusted: false, confirmed: true }), NOW_ISO));
  eq([t.kind, t.next], ['write', 'test']);
  /* 確認之後帳號已有設定一樣出 X1;X1 重新設定也不帶成績 */
  const a = acc({ trusted: false, confirmed: true, onboard: { status: 'done' } });
  assert.equal(C.resumePlan(gp('score'), a, NOW_ISO).kind, 'x1');
  eq(Object.keys(plain(C.applyX1('reset', gp('score'), a, NOW_ISO)).writes), ['onboard']);
};
T['R15(L1)成績草稿不合法:writePlan 回 none,不丟錯'] = () => {
  const bad = gp('score', { scoreDraft: { listening: '', reading: '', total: '595', examYm: 'older', fromTotal: false } });
  eq(C.resumePlan(bad, acc(), NOW_ISO), { kind: 'none', writes: {}, next: 'home' });
};
T['R9 老師:teacher,不寫'] = () => { eq(C.resumePlan(gp('test'), acc({ isTeacher: true }), NOW_ISO), { kind: 'teacher', writes: {}, next: 'home' }); };
T['R10、R11 join:有暫存碼且隨機碼一致 → join;碼不在、或不一致(別人的碼) → none,不寫任何鍵'] = () => {
  eq(C.resumePlan(gp('join'), acc({ hasPendingJoin: true }), NOW_ISO), { kind: 'join', writes: {}, next: 'join' });
  eq(C.resumePlan(gp('test'), acc({ hasPendingJoin: true }), NOW_ISO), { kind: 'join', writes: {}, next: 'join' });   // 接回的第一步:加入班級
  eq(C.resumePlan(gp('join', { targetScore: null, examMonth: null, step: 'target' }), acc(), NOW_ISO), { kind: 'none', writes: {}, next: 'home' });
  eq(C.resumePlan(gp('join'), acc({ hasPendingJoin: true, trusted: false }), NOW_ISO), { kind: 'none', writes: {}, next: 'home' });
  eq(C.resumePlan(gp('join'), acc({ hasPendingJoin: true, trusted: false, confirmed: true }), NOW_ISO), { kind: 'none', writes: {}, next: 'home' });
};
T['R12 resumePlan 不改傳入的物件'] = () => {
  const g = deepFreeze(gp('score'));
  const a = deepFreeze(acc({ onboard: { status: 'in_progress' }, levels: { listening: 'entry', reading: 'entry', history: [{ at: 'x' }] } }));
  C.resumePlan(g, a, NOW_ISO);
  C.applyX1('reset', g, a, NOW_ISO);
};
T['patchOnboard:新建、沿用、dismissed 改回 in_progress;不改原物件'] = () => {
  const n = plain(C.patchOnboard(null, { targetScore: 600, step: 'exam' }, NOW_ISO));
  eq([n.status, n.path, n.targetScore, n.step, n.startedAt], ['in_progress', 'self', 600, 'exam', NOW_ISO]);
  const done = deepFreeze({ v: 1, status: 'done', step: 'result', targetScore: 450, startedAt: 'old' });
  const d = plain(C.patchOnboard(done, { targetScore: 785 }, NOW_ISO));
  eq([d.status, d.targetScore, d.startedAt, d.updatedAt], ['done', 785, 'old', NOW_ISO]);
  assert.equal(C.patchOnboard({ v: 1, status: 'dismissed' }, { step: 'target' }, NOW_ISO).status, 'in_progress');
  assert.equal(C.dismissedOnboard(NOW_ISO).status, 'dismissed');
};

const folderKeys = (ls) => [...ls.keys()].filter((k) => /^tr_u/.test(k));
const G_KEY = 'tr_onboard_guest';

T['D1 訪客答 S1、S2:只有 tr_onboard_guest,沒有 tr_u 鍵,沒有上傳'] = () => {
  const e = dataEnv();
  assert.equal(e.D.answer({ targetScore: 600, step: 'exam' }), 'ok');
  assert.equal(e.D.answer({ examMonth: '2027-03', step: 'level' }), 'ok');
  const g = JSON.parse(e.ls.get(G_KEY));
  eq([g.targetScore, g.examMonth, g.step, g.pendingAction], [600, '2027-03', 'level', null]);
  eq(folderKeys(e.ls), []); eq(e.pushed, []);
  eq([...e.ls.keys()].filter((k) => k !== G_KEY), []);
  e.D.startPending('test');
  const g2 = JSON.parse(e.ls.get(G_KEY));
  eq([g2.pendingAction, g2.authStartedAt], ['test', NOW]);
  e.D.cancelPending();
  eq([JSON.parse(e.ls.get(G_KEY)).pendingAction, JSON.parse(e.ls.get(G_KEY)).authStartedAt], [null, null]);
};
T['D1b 訪客不能寫帳號資料:submitScore、chooseEntry 一律不寫'] = () => {
  const e = dataEnv();
  assert.equal(e.D.chooseEntry(), 'guest');
  assert.equal(e.D.submitScore({ listening: 325, reading: 270, total: 595, examYm: '2026-05', fromTotal: false }), 'guest');
  eq(folderKeys(e.ls), []); eq(e.pushed, []);
};
T['D2 過期訪客鍵:載入資料檔就被刪'] = () => {
  const old = J(guestOf({ createdAt: NOW - 8 * DAY, expiresAt: NOW - DAY }));
  const e = dataEnv({ init: { [G_KEY]: old } });
  assert.equal(e.ls.has(G_KEY), false);
  const ok = dataEnv({ init: { [G_KEY]: J(guestOf()) } });
  assert.equal(ok.ls.has(G_KEY), true);
};
T['D3 已登入接回:寫三鍵、讀回相符、刪訪客鍵、上傳 onboard'] = async () => {
  const e = dataEnv(signedIn({ init: { [G_KEY]: J(gp('score')) } }));
  const r = plain(await e.D.resume());
  eq(r, { status: 'ok', next: 'result' });
  assert.equal(e.ls.has(G_KEY), false);
  ['onboard', 'self_score', 'levels'].forEach((k) => assert.ok(e.ls.has('tr_u' + CPID + '_' + k), k));
  assert.ok(e.pushed.indexOf('onboard') > -1 && e.pushed.indexOf('levels') > -1 && e.pushed.indexOf('self_score') > -1);
  assert.equal(JSON.parse(e.ls.get('tr_u' + CPID + '_onboard')).targetScore, 600);
};
T['D4 正要重載:不寫、不刪'] = async () => {
  const e = dataEnv(signedIn({ reloading: true, init: { [G_KEY]: J(gp('test')) } }));
  eq(plain(await e.D.resume()), { status: 'reloading' });
  assert.equal(e.ls.has(G_KEY), true); eq(folderKeys(e.ls), []);
};
T['D5 資料夾還不能用:不寫、不刪,回 blocked'] = async () => {
  const e = dataEnv(signedIn({ folderReady: false, init: { [G_KEY]: J(gp('test')) } }));
  eq(plain(await e.D.resume()), { status: 'blocked' });
  assert.equal(e.ls.has(G_KEY), true); eq(folderKeys(e.ls), []);
};
T['D6 localStorage 寫不進去:讀回不符,訪客鍵留著,回 failed'] = async () => {
  const e = dataEnv(signedIn({ init: { [G_KEY]: J(gp('entry')) } }));
  e.state.failSet = true;
  eq(plain(await e.D.resume()), { status: 'failed' });
  assert.equal(e.ls.has(G_KEY), true);
};
T['D7 pendingAction 25 小時前:刪訪客鍵,帳號資料夾沒有新鍵'] = async () => {
  const e = dataEnv(signedIn({ init: { [G_KEY]: J(gp('test', { authStartedAt: NOW - 25 * HOUR })) } }));
  eq(plain(await e.D.resume()), { status: 'expired' });
  assert.equal(e.ls.has(G_KEY), false); eq(folderKeys(e.ls), []); eq(e.pushed, []);
};
T['D7b 老師:刪訪客鍵,不寫'] = async () => {
  const e = dataEnv(signedIn({ teacher: true, init: { [G_KEY]: J(gp('test')) } }));
  eq(plain(await e.D.resume()), { status: 'teacher' });
  assert.equal(e.ls.has(G_KEY), false); eq(folderKeys(e.ls), []);
};
T['D8 X1:保留不動帳號三鍵;重新設定照寫'] = async () => {
  const pre = 'tr_u' + CPID + '_';
  const init = { [G_KEY]: J(gp('test')), [pre + 'onboard']: J({ v: 1, status: 'done', step: 'result' }),
    [pre + 'levels']: J({ listening: 'high', reading: 'advanced', source: { listening: 'manual', reading: 'manual' }, setAt: 'x', history: [] }), [pre + 'self_score']: J({ listening: 400 }) };
  const e = dataEnv(signedIn({ init }));
  const before = [pre + 'onboard', pre + 'levels', pre + 'self_score'].map((k) => e.ls.get(k));
  const r = plain(await e.D.resume());
  assert.equal(r.status, 'x1');
  eq(plain(e.D.applyX1('keep')), { status: 'ok', next: 'home' });
  eq([pre + 'onboard', pre + 'levels', pre + 'self_score'].map((k) => e.ls.get(k)), before);
  assert.equal(e.ls.has(G_KEY), false);
  const e2 = dataEnv(signedIn({ init }));
  await e2.D.resume();
  eq(plain(e2.D.applyX1('reset')), { status: 'ok', next: 'test' });
  const ob = JSON.parse(e2.ls.get(pre + 'onboard'));
  eq([ob.status, ob.step, ob.previous.onboard.status, ob.previous.self_score.listening], ['in_progress', 'test', 'done', 400]);
};
T['D9 diagRowState:設定中、檢測晚於 testFrom 才出現'] = () => {
  const ob = { status: 'in_progress', step: 'test', testFrom: '2026-11-19T01:00:00.000Z' };
  assert.equal(C.diagRowState(ob, { done: true, finishedAt: '2026-11-19T01:00:00.000Z' }), 'result');
  assert.equal(C.diagRowState(ob, { done: true, finishedAt: '2026-11-19T00:59:59.000Z' }), 'none');
  assert.equal(C.diagRowState(Object.assign({}, ob, { status: 'done' }), { done: true, finishedAt: '2026-11-19T02:00:00.000Z' }), 'none');
  assert.equal(C.diagRowState(ob, { done: false }), 'none');
  assert.equal(C.diagRowState(Object.assign({}, ob, { testFrom: null }), { done: true, finishedAt: '2026-11-19T02:00:00.000Z' }), 'none');
};
T['D9b 已登入的每一步:onboard、levels、self_score 照寫,S8 第一次顯示記 done'] = () => {
  const e = dataEnv(signedIn());
  const pre = 'tr_u' + CPID + '_';
  assert.equal(e.D.answer({ targetScore: 785, step: 'exam' }), 'ok');
  assert.equal(JSON.parse(e.ls.get(pre + 'onboard')).targetScore, 785);
  assert.equal(e.ls.has(G_KEY), false);
  assert.equal(e.D.submitScore({ listening: 415, reading: 170, total: 585, examYm: '2026-05', fromTotal: false }), 'ok');
  eq(JSON.parse(e.ls.get(pre + 'levels')).listening, 'high');
  assert.equal(JSON.parse(e.ls.get(pre + 'onboard')).step, 'result');
  assert.equal(e.D.markDone(), 'ok');
  const ob = JSON.parse(e.ls.get(pre + 'onboard'));
  eq([ob.status, ob.doneAt], ['done', NOW_ISO]);
  assert.equal(e.D.applyManual('entry', 'high'), 'ok');
  const lv = JSON.parse(e.ls.get(pre + 'levels'));
  eq([lv.listening, lv.reading, lv.source.listening, lv.source.reading, lv.history[lv.history.length - 1].reason], ['entry', 'high', 'manual', 'manual', 'manual']);
  assert.equal(e.D.startTest(), 'ok');
  eq([JSON.parse(e.ls.get(pre + 'onboard')).step, JSON.parse(e.ls.get(pre + 'onboard')).testFrom], ['test', NOW_ISO]);
  assert.equal(e.D.dismiss(), 'ok');
  assert.equal(JSON.parse(e.ls.get(pre + 'onboard')).status, 'dismissed');
};
T['D9c 時間只往前走:本機讀到的 setAt、updatedAt、enteredAt 比現在晚(別台時鐘快 5 分鐘),新寫的那份時間比它們晚'] = () => {
  const pre = 'tr_u' + CPID + '_';
  const ahead = new Date(NOW + 5 * 60e3).toISOString();
  const after = (x) => Date.parse(x) > Date.parse(ahead);
  const init = {};
  init[pre + 'levels'] = J({ listening: 'high', reading: 'high', source: { listening: 'score', reading: 'score' }, setAt: ahead,
    history: [{ at: ahead, listening: 'high', reading: 'high', reason: 'score' }] });
  init[pre + 'onboard'] = J({ v: 1, status: 'done', step: 'result', path: 'self', targetScore: 600, examMonth: null, levelSource: 'score', testFrom: null,
    previous: null, startedAt: ahead, doneAt: ahead, updatedAt: ahead });
  init[pre + 'self_score'] = J({ listening: 400, reading: 400, total: 800, examYm: '2026-05', fromTotal: false, enteredAt: ahead });
  const e = dataEnv(signedIn({ init }));
  assert.equal(e.D.submitScore({ listening: 325, reading: 270, total: 595, examYm: '2026-05', fromTotal: false }), 'ok');
  const lv = JSON.parse(e.ls.get(pre + 'levels')), s = JSON.parse(e.ls.get(pre + 'self_score'));
  eq([after(lv.setAt), after(lv.history[lv.history.length - 1].at), after(s.enteredAt), after(JSON.parse(e.ls.get(pre + 'onboard')).updatedAt)], [true, true, true, true]);
  const ob0 = JSON.parse(e.ls.get(pre + 'onboard')).updatedAt;
  assert.equal(e.D.dismiss(), 'ok');
  assert.ok(Date.parse(JSON.parse(e.ls.get(pre + 'onboard')).updatedAt) > Date.parse(ob0), '略過也要比前一份晚');
  const lv0 = JSON.parse(e.ls.get(pre + 'levels')).setAt;
  assert.equal(e.D.applyManual('entry', 'entry'), 'ok');
  assert.ok(Date.parse(JSON.parse(e.ls.get(pre + 'levels')).setAt) > Date.parse(lv0), '手動改級別也要比前一份晚');
};
T['D9d 時間只往前走的例外:本機讀到的時間在一天以後(時鐘錯很多),不跟著它,用現在的時間;沒有前一份也用現在'] = () => {
  // 用 tools/onboard_kit.js 載入的核心檔
  assert.equal(typeof C.stampAfter, 'function', '還沒有 ONBOARD_CORE.stampAfter');
  const far = new Date(NOW + 365 * DAY).toISOString();
  eq([C.stampAfter(far, NOW_ISO), C.stampAfter(null, NOW_ISO), C.stampAfter('壞掉', NOW_ISO), C.stampAfter(new Date(NOW - 1000).toISOString(), NOW_ISO),
    C.stampAfter(NOW_ISO, NOW_ISO)], [NOW_ISO, NOW_ISO, NOW_ISO, NOW_ISO, new Date(NOW + 1).toISOString()]);
  const lv = C.newLevels({ listening: 'high', reading: 'high', setAt: far, history: [] }, 'entry', 'entry', { listening: 'entry', reading: 'entry' }, 'entry', NOW_ISO);
  eq([lv.setAt, C.patchOnboard({ v: 1, status: 'done', updatedAt: far }, { step: 'result' }, NOW_ISO).updatedAt], [NOW_ISO, NOW_ISO]);
};
T['D10 搬家規則:訪客鍵不搬;三鍵 single'] = () => {
  const ctx = {}; vm.createContext(ctx); vm.runInContext(read('js/move-rules.js'), ctx);
  const R = ctx.MOVE_RULES;
  assert.equal(R.classify('tr_onboard_guest', new Set()).kind, 'skip');
  ['onboard', 'self_score', 'levels'].forEach((k) => assert.equal(R.ruleOf(k), 'single', k));
};

/* ---------- 資料安全:共用電腦、老師、時鐘、兩個分頁(T1–T12) ---------- */
const PRE = 'tr_u' + CPID + '_';
const acctKeys = (ls) => ['onboard', 'self_score', 'levels'].map((k) => ls.get(PRE + k));
T['T0 S9 顯示:隨機碼同時記在這個分頁與訪客暫存;取消時兩邊都清;forgetNonce 只清分頁那份'] = () => {
  const e = dataEnv({ session: {} });
  e.D.startPending('test');
  const g = JSON.parse(e.ls.get(G_KEY));
  assert.ok(/^[0-9a-z]{16,40}$/.test(g.authNonce), g.authNonce);
  assert.equal(e.ss.get('ob_auth_nonce'), g.authNonce);
  e.D.forgetNonce();
  eq([e.ss.has('ob_auth_nonce'), JSON.parse(e.ls.get(G_KEY)).pendingAction], [false, 'test']);
  e.D.startPending('entry'); e.D.cancelPending();
  eq([e.ss.has('ob_auth_nonce'), JSON.parse(e.ls.get(G_KEY)).authNonce], [false, null]);
};
T['T1 共用電腦換人:隨機碼不一致 → confirm,帳號三鍵不寫;「不用」刪訪客鍵;「帶入」只帶目標與月份'] = async () => {
  const g = J(gp('score', { authStartedAt: NOW - 2 * HOUR }));
  const e = dataEnv(signedIn({ session: {}, init: { [G_KEY]: g } }));
  const r = plain(await e.D.resume());
  eq([r.status, r.answers], ['confirm', { targetScore: 600, examMonth: '2027-03', pendingAction: 'score' }]);
  eq(acctKeys(e.ls), [undefined, undefined, undefined]); eq(e.pushed, []);
  assert.equal(e.ls.has(G_KEY), true);
  eq(plain(await e.D.confirmImport(false)), { status: 'ok', next: 'home' });
  eq([e.ls.has(G_KEY), acctKeys(e.ls)], [false, [undefined, undefined, undefined]]);

  const y = dataEnv(signedIn({ session: { ob_auth_nonce: 'zzzzzzzzzzzzzzzzzzzz' }, init: { [G_KEY]: g } }));
  assert.equal((await y.D.resume()).status, 'confirm');
  eq(plain(await y.D.confirmImport(true)), { status: 'ok', next: 'score' });
  const ob = JSON.parse(y.ls.get(PRE + 'onboard'));
  eq([ob.targetScore, ob.examMonth, ob.step, y.ls.has(PRE + 'self_score'), y.ls.has(PRE + 'levels'), y.ls.has(G_KEY)], [600, '2027-03', 'score', false, false, false]);
};
T['T2 帳號 in_progress、已有 levels:接回出 X1,levels 不變'] = async () => {
  const lv = J({ listening: 'advanced', reading: 'advanced', source: { listening: 'legacy_plus1', reading: 'legacy' }, setAt: 'x', history: [] });
  const e = dataEnv(signedIn({ init: { [G_KEY]: J(gp('entry')), [PRE + 'onboard']: J({ v: 1, status: 'in_progress', step: 'test' }), [PRE + 'levels']: lv } }));
  const r = plain(await e.D.resume());
  eq([r.status, r.trusted], ['x1', true]);
  assert.equal(e.ls.get(PRE + 'levels'), lv);
};
T['T4 X1 開著時訪客鍵被別的分頁接走:「重新設定」回 none,三鍵不變'] = async () => {
  const init = { [G_KEY]: J(gp('test')), [PRE + 'onboard']: J({ v: 1, status: 'done', step: 'result' }) };
  const e = dataEnv(signedIn({ init }));
  assert.equal((await e.D.resume()).status, 'x1');
  const before = acctKeys(e.ls);
  e.ls.delete(G_KEY);
  eq(plain(e.D.applyX1('reset', true)), { status: 'none' });
  eq(acctKeys(e.ls), before);
  /* 過期也一樣 */
  const f = dataEnv(signedIn({ init }));
  await f.D.resume();
  f.clock.t = NOW + 25 * HOUR;
  eq(plain(f.D.applyX1('reset', true)), { status: 'none' });
  eq(acctKeys(f.ls), before);
};
T['T5 還沒確認是不是老師(查教師表失敗、雲端元件沒載到):回 failed,不寫、訪客鍵留著'] = async () => {
  for (const q of ['fail', 'noclient']) {
    const e = dataEnv(signedIn({ teacherQuery: q, init: { [G_KEY]: J(gp('entry')) } }));
    eq(plain(await e.D.resume()), { status: 'failed' }, q);
    eq([e.ls.has(G_KEY), folderKeys(e.ls)], [true, []], q);
  }
  const t = dataEnv(signedIn({ init: { [G_KEY]: J(gp('entry')) } }));
  t.ctx.CLOUD.client = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [{ user_id: UID }], error: null }) }) }) };
  eq(plain(await t.D.resume()), { status: 'teacher' });
  eq(folderKeys(t.ls), []);
};
T['T7 重新檢測不刪舊檢測:開始檢測(包括正要重載時)本機 diag 還在,資料層沒有刪 diag 的函式'] = () => {
  [false, true].forEach((reloading) => {
    const e = dataEnv(signedIn({ reloading, init: { [PRE + 'diag']: J({ done: true }) } }));
    e.D.startTest();
    assert.equal(e.ls.get(PRE + 'diag'), J({ done: true }), reloading ? '正要重載' : '一般');
    assert.equal(e.D.removeDiag, undefined);
  });
};
T['T8 兩個分頁同時接回(共用 localStorage):levels.history 只有一筆'] = async () => {
  const ls = new Map(Object.entries({ [G_KEY]: J(gp('score')) }));
  const a = dataEnv(signedIn({ ls }));
  const b = dataEnv(signedIn({ ls }));
  const saved = ls.get(G_KEY);
  const ra = await a.D.resume();
  ls.set(G_KEY, saved);   // B 在 A 刪掉之前就讀到了
  const rb = await b.D.resume();
  eq([ra.status, rb.status], ['ok', 'x1']);
  assert.equal(JSON.parse(ls.get(PRE + 'levels')).history.length, 1);
  b.D.applyX1('reset', true);
  assert.equal(JSON.parse(ls.get(PRE + 'levels')).history.length, 1, '重新設定同一份成績也不多記');
};
T['T9 班級:隨機碼一致且有暫存碼 → 自動加入、寫 path class、到 S4;失敗帶回碼與原因;不一致不帶入別人的碼'] = async () => {
  const pj = J({ code: 'ABCD2345', at: NOW - MIN });
  const ok = dataEnv(signedIn({ init: { [G_KEY]: J(gp('join')), tr_pending_join: pj } }));
  eq(plain(await ok.D.resume()), { status: 'ok', next: 'test', joined: '週三班' });
  eq([ok.joins, ok.ls.has(G_KEY), ok.ls.has('tr_pending_join'), JSON.parse(ok.ls.get(PRE + 'onboard')).path], [['ABCD2345'], false, false, 'class']);

  const bad = dataEnv(signedIn({ join: { ok: false, message: '找不到這個邀請碼。' }, init: { [G_KEY]: J(gp('join')), tr_pending_join: pj } }));
  eq(plain(await bad.D.resume()), { status: 'joinFailed', code: 'ABCD2345', message: '找不到這個邀請碼。', gone: false });
  eq([bad.ls.has(G_KEY), folderKeys(bad.ls)], [false, []]);

  const other = dataEnv(signedIn({ session: {}, init: { [G_KEY]: J(gp('join')), tr_pending_join: pj } }));
  eq(plain(await other.D.resume()), { status: 'none' });
  eq([other.joins, other.ls.has('tr_pending_join'), other.ls.has(G_KEY), folderKeys(other.ls)], [[], false, false, []]);

  const gone = dataEnv(signedIn({ init: { [G_KEY]: J(gp('join')) } }));
  eq(plain(await gone.D.resume()), { status: 'none' });
  eq([gone.ls.has(G_KEY), folderKeys(gone.ls)], [false, []]);
};
T['T10 重新檢測還沒交卷:markDone 不記完成,交卷後檢測頁仍出「看起始程度」'] = () => {
  const e = dataEnv(signedIn({ init: { [PRE + 'onboard']: J({ v: 1, status: 'done', step: 'result', testFrom: null }),
    [PRE + 'levels']: J({ listening: 'high', reading: 'advanced', source: {}, history: [] }) } }));
  assert.equal(e.D.startTest(), 'ok');
  assert.equal(e.D.markDone(), 'skipped');
  const ob = JSON.parse(e.ls.get(PRE + 'onboard'));
  eq([ob.status, ob.step], ['in_progress', 'test']);
  assert.equal(C.diagRowState(ob, { done: true, finishedAt: new Date(NOW + 20 * MIN).toISOString() }), 'result');
  assert.equal(C.resultRoute(ob, JSON.parse(e.ls.get(PRE + 'levels')), null), 'test');
};
T['T11 「不用了」:還沒確定登入(CLOUD.user 還是 null)不寫'] = () => {
  const e = dataEnv({ pid: CPID, user: null });
  assert.equal(e.D.dismiss(), 'blocked');
  eq(folderKeys(e.ls), []);
};
T['T12 已登入的 S3a 草稿:存在這個分頁,送出成功後刪掉;訪客不存'] = () => {
  const e = dataEnv(signedIn());
  e.D.saveDraft(DRAFT);
  eq(e.D.draft(), DRAFT);
  assert.equal(e.D.submitScore({ listening: 325, reading: 270, total: 595, examYm: '2026-05', fromTotal: false }), 'ok');
  assert.equal(e.D.draft(), null);
  const g = dataEnv({ session: {} });
  g.D.saveDraft(DRAFT);
  assert.equal(g.ss.has('ob_score_draft'), false);
};

/* 新檢測與預估分數的接點(N 開頭) */
require('./onboard_est_cases')(T);

/* ---------- 跑 ---------- */
(async () => {
  let pass = 0;
  const names = Object.keys(T).filter((n) => !ONLY_CORE || /^O(9|10|11)\b|^O15|^E|^N8\b/.test(n));
  for (const name of names) {
    let detail = '', ok = true;
    try { detail = await T[name](); } catch (e) {
      ok = false;
      detail = e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e);
      if (e && e.actual !== undefined) detail = '實際 ' + J(e.actual) + ' 預期 ' + J(e.expected) + ' ' + detail;
    }
    if (ok) pass++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + String(detail).slice(0, 400) : ''));
  }
  let tzOk = true;
  if (!ONLY_CORE) {
    ['UTC', 'America/Los_Angeles'].forEach((tz) => {
      const r = spawnSync(process.execPath, [__filename, '--core'], { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' });
      const last = (r.stdout || '').trim().split('\n').pop();
      console.log('TZ=' + tz + ' ' + last);
      if (r.status !== 0) tzOk = false;
    });
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length && tzOk ? 0 : 1);
})();
