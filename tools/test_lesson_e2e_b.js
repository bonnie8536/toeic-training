/* 課程第 5–8 堂、每週堂數、獨立小檢核、程度調整的無頭 Chrome 測試(tools/lesson_e2e_kit.js:真的頁面與引擎、假雲端、假時鐘)。
   種好的進度用真的 js/pack-core.js 選題;作答率要算程度調整的堂,每一題照固定比例寫成第一次作答(答對或答錯)。
   用法:node tools/test_lesson_e2e_b.js [--port <起始埠,用三個>] [--tmp <放 Chrome 使用者資料的資料夾>] [--shots <截圖資料夾>] [--only <名稱的一段,幾段用 | 分開>]
   --shots 給了時存 375 與 1280 兩張。每次一個新的使用者資料夾,跑完刪掉。 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const K = require('./lesson_kit.js');
const X = require('./lesson_e2e_kit.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const PORT = Number(opt('--port')) || 8981;
X.configure({ port: PORT, debug: PORT + 2, tmp: path.resolve(opt('--tmp') || os.tmpdir()), shots: opt('--shots') ? path.resolve(opt('--shots')) : null });
const ONLY = opt('--only') || '';
const { J, sleep, DAY_MS, PILOT, ONBOARD, SV, user, LV, nowMs, advance, resetClock, tab, shot, drive, les, noErrors, freshCloud, seedUser, pilotUser, finishLesson, homeCard } = X;
const { EE, TT } = K;
const T = {};
const ISO = (ms) => new Date(ms).toISOString();
const dayStr = (ms) => { const d = new Date(ms), p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };

/* ---------- 種進度 ---------- */
/* plan:開始日 startMs 那天;over 蓋過欄位(上線前的格式不給 perWeek、weeklyAskedAt) */
function planOf(startMs, over) {
  return Object.assign({ v: 1, source: 'self', classId: PILOT, packs: {}, packVersions: {}, startDate: dayStr(startMs), lessonsPerWeek: null, mainDay: 1, extDay: null,
    term: 1, postponedWeeks: 0, previous: null, perWeek: [], weeklyAskedAt: ISO(startMs), updatedAt: startMs }, over || {});
}
/* 第 nos 堂上完(at(no) 是開堂的 epoch 秒);rate 有給時固定段(區塊 <80)與前測檢討的題庫題每題寫一筆第一次作答,照比例答對 */
async function seedLessons(c, u, lv, nos, at, rate) {
  const e = K.env({ bank: true, now: at(nos[0]) });
  await e.D.packs();
  for (const no of nos) {
    const t = at(no), lesson = e.lesson(lv, no), cx = e.D.ctx(lesson, t);
    let s;
    if (lesson.kind === 'test') { const f = await e.D.testForm(cx); s = [0, 1].reduce((a, i) => e.P.freeze(a, i, f[i], t), e.P.newState(lesson, t)); }
    else s = (await e.P.pickFixed(lesson, e.P.newState(lesson, t), cx)).state;
    if (rate !== undefined && lesson.kind !== 'test') {
      let n = 0;
      Object.keys(s.pk).map(Number).filter((b) => b < 80).forEach((b) => (s.pk[b].ids || []).filter((id) => /^(l[1-4]|p[5-7])-/.test(id)).forEach((id) => {
        const ok = (++n * 7) % 10 < rate * 10;
        s = e.P.answer(s, { b, id, c: ok ? 0 : 1, ok, f: true, t: t + 60 });
      }));
    }
    s = lesson.segments.reduce((a, x) => e.P.setSegment(a, lesson, x.slot, x.fixed ? 'done' : 'skip', t + 600), s);
    c.put(u.id, e.P.lessonKey(1, no), JSON.parse(J(s)), ISO((t + 700) * 1000));
  }
}
const sec = (ms) => Math.floor(ms / 1000);
const storeGet = (p, k) => p.eval('store.get(' + J(k) + ', null)');
const calibs = (lv) => ((lv && lv.history) || []).filter((h) => h.reason === 'calibrate');
const cardText = (p, sel) => p.eval('(() => { const c = document.querySelector(".lsn-home"); const e = c && c.querySelector(' + J(sel) + '); return e ? e.textContent.trim() : null; })()');
async function lessonsPage(p) { await p.go('lessons.html'); await p.wait("document.querySelector('.lsn-list') || document.querySelector('.lsn-weekly')", '課程總覽'); }
const rowsText = (p) => p.eval("[...document.querySelectorAll('.lsn-list li')].map((li) => [li.textContent.trim(), !!li.querySelector('a')])");

/* ---------- 第 1 條 門檻第 5–8 堂 ---------- */
T['1 試行乙:第 1–4 堂種好(答對約 6 成)→ 第 5–8 堂照頁面上完;第 8 堂小檢核 5 列只有判定字;第 9 堂尚未開放(首頁、總覽、上課頁);程度沒變也記一筆'] = async () => {
  resetClock();
  const c = freshCloud(), u = user(31, '試行乙B');
  pilotUser(c, u, TT);
  const start = nowMs() - 10 * DAY_MS;
  c.put(u.id, 'plan', planOf(start));
  await seedLessons(c, u, TT, [1, 2, 3, 4], (no) => sec(start) + no * 86400, 0.6);
  const p = await tab(u, { url: 'index.html', smart: 0.6 });
  const h5 = await homeCard(p);
  assert.deepStrictEqual([h5.go, h5.solid], ['開始第 5 堂', 1], J(h5));
  const lv0 = await storeGet(p, 'levels');
  assert.deepStrictEqual([calibs(lv0).length, lv0.listening, lv0.reading], [1, 'threshold', 'threshold'], '沒變也記一筆');
  for (const no of [5, 6, 7, 8]) {
    if (no === 7) await advance(DAY_MS);
    await finishLesson(p, no, false);
  }
  const cp = await p.eval("[...document.querySelectorAll('.lsn-verdicts li')].map((li) => li.textContent.trim())");
  assert.deepStrictEqual(cp.map((t) => t.replace(/(達標|持平|弱點|沒有出題)$/, '')), ['是非問句', '簡短對話', '時態與語態', '主詞動詞一致', '連接詞與介系詞'], J(cp));
  assert.ok(cp.every((t) => /(達標|持平|弱點)$/.test(t)) && !cp.some((t) => /\d|%/.test(t)), J(cp));
  assert.equal(await p.eval("!!document.querySelector('.lsn-calib')"), false, '第 8 堂沒有程度調整');
  await shot(p, '40_第8堂本堂結果');
  const h9 = await homeCard(p);
  assert.deepStrictEqual([h9.h, h9.go, h9.daily, h9.solid], ['第 9 堂尚未開放', null, true, 1]);
  await shot(p, '41_首頁卡_第9堂尚未開放');
  await lessonsPage(p);
  const r = await rowsText(p);
  assert.ok(r.slice(8).every((x) => /未開放$/.test(x[0]) && !x[1]) && r.slice(0, 8).every((x) => /完成$/.test(x[0])), J(r.slice(6, 10)));
  await p.go('lesson.html?no=9');
  await p.wait("document.querySelector('.ui-empty-text')", '第 9 堂');
  assert.deepStrictEqual(await p.eval("[document.querySelector('.ui-empty-text').textContent, document.querySelector('.ui-empty-go').textContent, document.querySelector('.ui-empty-go').classList.contains('primary')]"),
    ['第 9 堂尚未開放', '每日練習', true]);
  assert.equal(calibs(await storeGet(p, 'levels')).length, 1, '只記一次');
  noErrors(p, '第 1 條');
  await p.close();
  return '第 8 堂小檢核:' + cp.join('、');
};

/* ---------- 第 2、3 條 程度調整 ---------- */
T['2 試行甲(入門)答對 9 成:第 4 堂從頁面上到本堂結果,出「程度調整」兩列入門 → 門檻;ⓘ 面板七行、Esc 關、焦點回 ⓘ;重開不多寫;總覽也出;第 5 堂上門檻包'] = async () => {
  resetClock();
  const c = freshCloud(), u = user(32, '試行甲B');
  pilotUser(c, u, EE);
  c.put(u.id, 'levels', LV(Object.assign({ history: [{ at: '2026-11-01T00:00:00.000Z', listening: 'entry', reading: 'entry', reason: 'score' }] }, EE)), ISO(nowMs() - DAY_MS));
  const start = nowMs() - 6 * DAY_MS;
  c.put(u.id, 'plan', planOf(start));
  await seedLessons(c, u, EE, [1, 2, 3], (no) => sec(start) + no * 86400, 0.9);
  const p = await tab(u, { url: 'index.html', smart: 0.9 });
  await finishLesson(p, 4, false);
  const rows = await p.eval("[...document.querySelectorAll('.lsn-calib li')].map((li) => li.textContent.trim())");
  assert.deepStrictEqual(rows, ['聽力入門 → 門檻', '閱讀入門 → 門檻']);
  assert.ok(await p.eval("(() => { const m = document.querySelector('.lsn-result-more'); const k = [...m.children]; return k.indexOf(m.querySelector('.lsn-calib')) > k.indexOf(m.querySelector('.lsn-verdicts')); })()"), '小檢核清單下面');
  await shot(p, '42_第4堂本堂結果_程度調整');
  await p.eval("(() => { const b = document.querySelector('.lsn-info'); b.focus(); b.click(); return true; })()");   // 滑鼠點按鈕時焦點在按鈕上
  await p.wait("document.querySelector('.ui-sheet')", 'ⓘ 面板');
  assert.deepStrictEqual(await p.eval("[document.querySelector('.ui-sheet-h').textContent, document.querySelectorAll('.ui-sheet .lsn-info-line').length]"), ['程度調整', 7]);
  await shot(p, '43_程度調整說明');
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await p.wait("!document.querySelector('.ui-sheet') && document.activeElement && document.activeElement.classList.contains('lsn-info')", 'Esc 關、焦點回 ⓘ');
  const lv = await storeGet(p, 'levels');
  assert.deepStrictEqual([calibs(lv).length, lv.listening, lv.reading, lv.source.listening], [1, 'threshold', 'threshold', 'calibrate']);
  await p.go('lesson.html?no=4');
  await p.wait("document.querySelector('.lsn-calib')", '重看第 4 堂');
  assert.equal(calibs(await storeGet(p, 'levels')).length, 1, '重開不多寫');
  await lessonsPage(p);
  assert.ok(await p.eval("!!document.querySelector('#lsn-root > .lsn-calib')"), '總覽出程度調整');
  await shot(p, '44_課程總覽_程度調整');
  await p.go('lesson.html?no=5');
  await p.wait("document.querySelector('.lsn-steps')", '第 5 堂總覽');
  await p.click('.lsn-go');
  await p.wait("!document.querySelector('.lsn-steps')", '開始第 5 堂');
  await sleep(800);
  assert.deepStrictEqual((await les(p, 5)).levels, { listening: 'threshold', reading: 'threshold' });
  noErrors(p, '第 2 條');
  await p.close();
};
T['3 試行乙答對 3 成:門檻 → 入門,首頁「第 5 堂尚未開放」'] = async () => {
  resetClock();
  const c = freshCloud(), u = user(33, '試行乙降');
  pilotUser(c, u, TT);
  const start = nowMs() - 8 * DAY_MS;
  c.put(u.id, 'plan', planOf(start));
  await seedLessons(c, u, TT, [1, 2, 3, 4], (no) => sec(start) + no * 86400, 0.3);
  const p = await tab(u, { url: 'index.html' });
  await p.wait("(() => { const h = document.querySelector('#lsn-home-h'); return h && h.textContent.trim() === '第 5 堂尚未開放'; })()", '第 5 堂尚未開放');
  const lv = await storeGet(p, 'levels');
  assert.deepStrictEqual([lv.listening, lv.reading, calibs(lv).length], ['entry', 'entry', 1]);
  noErrors(p, '第 3 條');
  await p.close();
};

/* ---------- 第 4 條 每週 1 堂與獨立小檢核 ---------- */
T['4 每週 1 堂:第 1 堂後出每週上幾堂 → 選每週 1 堂 → 第 2 列課後練習;跳過第 2 堂上第 3 堂;到第 5 堂建議日期首頁第一列「第 4 堂小檢核」→ 直接進說明頁 → 結果卡＋判定清單 → 繼續回總覽'] = async () => {
  resetClock();
  const c = freshCloud(), u = user(34, '每週一堂');
  pilotUser(c, u, TT);
  const start = nowMs() - DAY_MS;
  c.put(u.id, 'plan', planOf(start, { weeklyAskedAt: null }));
  await seedLessons(c, u, TT, [1], () => sec(start) + 3600);
  const p = await tab(u, { url: 'lessons.html', smart: 0.6 });
  await p.wait("document.querySelector('.lsn-weekly')", '每週上幾堂');
  assert.deepStrictEqual(await p.eval("[document.querySelector('.lsn-weekly h2').textContent, document.activeElement === document.querySelector('.lsn-weekly h2'), document.querySelectorAll('.lsn-weekly .ob-choice').length, document.querySelectorAll('main .btn.primary').length]"),
    ['每週上幾堂', true, 2, 0]);
  await shot(p, '30_每週上幾堂');
  await p.eval("document.querySelectorAll('.lsn-weekly .ob-choice')[1].click(); true");
  await p.wait("document.querySelector('.lsn-list')", '總覽');
  assert.ok(/課後練習$/.test((await rowsText(p))[1][0]), '第 2 列課後練習');
  await shot(p, '31_課程總覽_課後練習');
  await finishLesson(p, 3, false);
  await advance(13 * DAY_MS);
  await p.go('index.html', 1500);
  await p.wait("document.querySelector('.lsn-home .lsn-solo')", '獨立小檢核那一列');
  assert.deepStrictEqual([await cardText(p, '.lsn-solo a'), await cardText(p, '.lsn-home-go')], ['第 4 堂小檢核18 分鐘', '開始第 5 堂']);
  assert.equal(calibs(await storeGet(p, 'levels')).length, 0, '小檢核交卷前不調整');
  await shot(p, '32_首頁卡_獨立小檢核');
  await p.mark(); await p.click('.lsn-solo a'); await sleep(300); await p.loaded(); await p.settle();
  await p.wait("document.querySelector('.lsn-intro')", '小檢核說明頁');
  assert.deepStrictEqual(await p.eval("[...document.querySelectorAll('.lsn-intro .lsn-rule')].map((e) => e.textContent)").then((x) => x.slice(0, 1)), ['結果在交卷後顯示']);
  await shot(p, '33_獨立小檢核說明頁');
  await drive(p, { until: (s) => s === 'result' });
  const res = await p.eval("[document.querySelector('.result-kicker').textContent, document.querySelector('.result-score').textContent.trim(), document.querySelector('.result-go').textContent, document.querySelector('.result-go').getAttribute('href'), document.querySelectorAll('.lsn-verdicts li').length, document.querySelectorAll('#lsn-root h2.me-sec-h').length]");
  assert.deepStrictEqual(res, ['第 4 堂', '小檢核', '繼續', 'lessons.html', 3, 0], J(res));
  await shot(p, '34_獨立小檢核結果');
  assert.equal(calibs(await storeGet(p, 'levels')).length, 1, '小檢核交卷後調整');
  await p.mark(); await p.click('.result-go'); await sleep(300); await p.loaded(); await p.settle();
  await p.wait("document.querySelector('.lsn-list')", '繼續回總覽');
  await p.go('index.html', 1500);
  await p.wait("document.querySelector('.lsn-home-go')", '首頁卡');
  assert.deepStrictEqual([await p.eval("!!document.querySelector('.lsn-solo')"), await cardText(p, '.lsn-home-go')], [false, '開始第 5 堂'], '同一天不再出現,第 5 堂可開');
  noErrors(p, '第 4 條');
  await p.close();
};

/* ---------- 第 5 條 本週一列與每週堂數面板 ---------- */
T['5 還沒選堂數:第 0、3 天上完第 1、2 堂,第 3 天首頁「本週　完成 2 / 2 堂　練習 2 / 2 天」＋設定堂數 → 每週 1 堂 →「完成 1 / 1 堂　練習 2 / 1 天」;我的頁改回 2 → 本週不變、多一筆第 2 週'] = async () => {
  resetClock();
  const c = freshCloud(), u = user(35, '本週一列');
  pilotUser(c, u, TT);
  const start = nowMs() - 3 * DAY_MS;
  c.put(u.id, 'plan', planOf(start - 3600e3));
  await seedLessons(c, u, TT, [1, 2], (no) => (no === 1 ? sec(start) : sec(nowMs() - 3 * 3600e3)));
  const p = await tab(u, { url: 'index.html' });
  await p.wait("document.querySelector('.lsn-week')", '本週一列');
  assert.equal(await cardText(p, '.lsn-week'), '本週　完成 2 / 2 堂　練習 2 / 2 天設定堂數');
  await shot(p, '35_首頁卡_本週一列');
  await p.click('.lsn-week-set');
  await p.wait("document.querySelector('.ui-sheet')", '每週堂數面板');
  assert.equal(await p.eval("document.querySelector('.ui-sheet-note')"), null, '第一次選沒有下週起生效');
  await shot(p, '36_每週堂數面板');
  await p.eval("(() => { const i = document.querySelectorAll('.ui-sheet input')[1]; i.click(); document.querySelector('.ui-sheet .ob-apply').click(); return true; })()");
  await p.wait("(() => { const w = document.querySelector('.lsn-week'); return w && !w.querySelector('button'); })()", '本週一列重畫');
  assert.equal(await cardText(p, '.lsn-week'), '本週　完成 1 / 1 堂　練習 2 / 1 天');
  await p.go('me.html', 1500);
  await p.wait("document.querySelector('.me-row-weekly')", '我的頁每週堂數');
  assert.equal(await p.eval("document.querySelector('.me-row-weekly').textContent.trim()"), '每週堂數每週 1 堂');
  await shot(p, '37_我的頁_每週堂數');
  await p.click('.me-row-weekly');
  await p.wait("document.querySelector('.ui-sheet')", '面板');
  assert.equal(await p.eval("document.querySelector('.ui-sheet-note').textContent"), '下週起生效');
  await p.eval("(() => { document.querySelectorAll('.ui-sheet input')[0].click(); document.querySelector('.ui-sheet .ob-apply').click(); return true; })()");
  await sleep(500);
  assert.deepStrictEqual((await storeGet(p, 'plan')).perWeek, [{ w: 1, n: 1 }, { w: 2, n: 2 }]);
  await p.go('index.html', 1500);
  await p.wait("document.querySelector('.lsn-week')", '本週一列');
  assert.equal(await cardText(p, '.lsn-week'), '本週　完成 1 / 1 堂　練習 2 / 1 天');
  noErrors(p, '第 5 條');
  await p.close();
};

/* ---------- 第 8 條 上線前的 plan ---------- */
T['8 上線前的 plan(沒有 perWeek、weeklyAskedAt)、第 1 堂上完:首頁照每週 2 堂(1 / 24 堂);開課程總覽先出每週上幾堂'] = async () => {
  resetClock();
  const c = freshCloud(), u = user(36, '舊格式');
  pilotUser(c, u, TT);
  const start = nowMs() - 2 * DAY_MS, old = planOf(start);
  delete old.perWeek; delete old.weeklyAskedAt;
  c.put(u.id, 'plan', old);
  await seedLessons(c, u, TT, [1], () => sec(start));
  const p = await tab(u, { url: 'index.html' });
  const h = await homeCard(p);
  assert.deepStrictEqual([h.go, await cardText(p, '.lsn-home-all')], ['開始第 2 堂', '1 / 24 堂']);
  await lessonsPage(p);
  assert.ok(await p.eval("!!document.querySelector('.lsn-weekly') && !document.querySelector('.lsn-list')"), '先出每週上幾堂');
  noErrors(p, '第 8 條');
  await p.close();
};

/* ---------- 第 7 條 模擬考 ---------- */
T['7 模擬考交卷後 mock_seen 有作答的題;接著開第 4 堂,凍結的檢核題沒有模擬考做過的題'] = async () => {
  resetClock();
  const c = freshCloud(), u = user(41, '模擬考');
  pilotUser(c, u, TT);
  const start = nowMs() - 8 * DAY_MS;
  c.put(u.id, 'plan', planOf(start));
  await seedLessons(c, u, TT, [1, 2, 3], (no) => sec(start) + no * 86400);
  const p = await tab(u, { url: 'mock.html' });
  await p.wait("document.querySelector('.mock-sizes .btn.primary')", '模擬考首頁');
  await p.click('.mock-sizes .btn.primary');
  await p.wait("document.querySelector('.quiz-count')", '模擬考作答');
  for (let i = 0; i < 12; i++) {
    await p.eval("(() => { const b = document.querySelector('main .opt:not(.picked), main .letter-big:not(.picked)'); if (b) b.click(); return true; })()");
    await sleep(120);
    await p.eval("(() => { const n = [...document.querySelectorAll('.quiz-foot .btn.primary')].find((x) => x.textContent === '下一題'); if (n) n.click(); return true; })()");
    await sleep(150);
  }
  await p.eval("(() => { const a = [...document.querySelectorAll('.quiz-act')].find((x) => x.textContent === '交卷'); if (a) a.click(); return true; })()");
  await p.wait("document.querySelector('.ui-dialog-ok')", '確認交卷');
  await p.click('.ui-dialog-ok');
  await p.wait("store.get('mock_seen', null)", 'mock_seen');
  const seen = Object.keys(await storeGet(p, 'mock_seen'));
  assert.ok(seen.length >= 10, J(seen));
  await p.go('lesson.html?no=4');
  await p.wait("document.querySelector('.lsn-steps')", '第 4 堂總覽');
  await p.click('.lsn-go');
  await p.wait("!document.querySelector('.lsn-steps')", '開始第 4 堂');
  await sleep(800);
  const st = await les(p, 4), lesson = Object.keys(st.pk).map(Number);
  const cpIds = [].concat(...lesson.map((k) => st.pk[k].ids || []));
  const mockIds = seen.map((k) => k.split(':')[0]);
  assert.deepStrictEqual(cpIds.filter((id) => mockIds.indexOf(id) > -1), [], '凍結的題沒有模擬考做過的題');
  const pool = new Set(JSON.parse(K.read('data/packs/checkpoint_pool.json')).ids);
  noErrors(p, '第 7 條');
  await p.close();
  return '模擬考作答 ' + seen.length + ' 題,其中 ' + mockIds.filter((id) => pool.has(id)).length + ' 題在小檢核清單';
};

/* ---------- 跑 ---------- */
(async () => {
  await X.start();
  let pass = 0;
  const names = Object.keys(T).filter((n) => !ONLY || ONLY.split('|').some((s) => n.indexOf(s) > -1));
  for (const name of names) {
    let detail = '', ok = true;
    try { detail = (await T[name]()) || ''; } catch (err) { ok = false; detail = err && err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : String(err); }
    await X.closeAll();
    SV.notFound = null;
    if (ok) pass++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + String(detail).slice(0, 600) : ''));
  }
  await X.stop();
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
