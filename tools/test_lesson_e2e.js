/* 課程頁的無頭 Chrome 測試:真的頁面、真的練習引擎、假雲端(tools/fixtures/lesson_cloud_stub.js,不連外網、不用真的帳號)、假時鐘。
   一個本機伺服器放 repo 的檔:js/cloud-config.js 換成假的設定、js/packs-config.js 的試行班名單換成測試用的班、sw.js 回 404;
   --base 給了時,另一個埠放那個資料夾(例如上一版的匯出),第 1 條拿來比非試行帳號的畫面。
   每個帳號一個瀏覽器設定檔(Target.createBrowserContext),兩個設定檔同一個帳號就是兩台裝置。作答用頁面裡的小幫手 __step():
   有沒選的選項就選、有主按鈕就按(只按 button,不點離開課程頁的連結)。最後一條(同步)不開瀏覽器,用 tools/sync_harness.js 的多台裝置。
   用法:node tools/test_lesson_e2e.js [--port <起始埠,用兩個>] [--debug-port <Chrome 的埠>] [--tmp <放 Chrome 使用者資料的資料夾>]
        [--base <對照用的資料夾>] [--shots <截圖資料夾>] [--only <測試名稱的一段,幾段用 | 分開>]
   --shots 給了時,走到的每個畫面存 375 與 1280 兩張(檔名「編號_畫面_寬.png」)。每次一個新的使用者資料夾,跑完刪掉。 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const K = require('./lesson_kit.js');
const H = require('./sync_harness');
const X = require('./lesson_e2e_kit.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const PORT = Number(opt('--port')) || 8971, BASE_PORT = PORT + 1, DEBUG = Number(opt('--debug-port')) || PORT + 2;
const TMP = path.resolve(opt('--tmp') || os.tmpdir());
const BASE = opt('--base') ? path.resolve(opt('--base')) : null;
const SHOTS = opt('--shots') ? path.resolve(opt('--shots')) : null;
const ONLY = opt('--only') || '';
X.configure({ port: PORT, debug: DEBUG, tmp: TMP, shots: SHOTS });
const { REPO, J, sleep, DAY_MS, PILOT, OTHER, ONBOARD, SV, NAMES, pages, user, LV, nowMs, tab, shot, drive, countOf, les, noErrors, freshCloud, seedUser, seedDone,
  pilotUser, settled, firstDiff, walk } = X;
const { EE, TT, TE } = K;

const T = {};
T['1 非試行學生:首頁、程度結果頁、我的、學習、刷題跟上一版一樣;結果頁主按鈕不等名單;名單一個分頁只查一次;課程兩頁「課程尚未開放」'] = async () => {
  const c = freshCloud();
  const u = user(11, '非試行');
  c.members[u.id] = [{ id: OTHER, name: '別班' }];
  seedUser(c, u, { onboard: ONBOARD, levels: LV(EE) });
  const urls = ['index.html', 'start.html?step=result', 'me.html', 'learn.html', 'drill.html'];
  const p = await tab(u, { url: urls[0] });
  const mine = [];
  for (const url of urls) { if (url !== urls[0]) await p.go(url, 1500); mine.push([url, await p.eval('document.title'), await settled(p)]); }
  const n = c.count('classes', u.id);
  if (BASE) {
    const b = await tab(u, { origin: 'http://127.0.0.1:' + BASE_PORT, url: urls[0] });
    for (let i = 0; i < urls.length; i++) {
      if (i) await b.go(urls[i], 1500);
      const theirs = [urls[i], await b.eval('document.title'), await settled(b)];
      const at = firstDiff(theirs[2], mine[i][2]);
      assert.deepStrictEqual(theirs, mine[i], urls[i] + ' 跟上一版不一樣:上一版「' + theirs[2].slice(Math.max(0, at - 120), at + 120) + '」這一版「' + mine[i][2].slice(Math.max(0, at - 120), at + 120) + '」');
    }
    assert.strictEqual(n - (c.count('classes', u.id) - n), 1, '課程判定多查的班級名單次數');
    await b.close();
  }
  await p.go('start.html?step=result', 300);
  assert.strictEqual(await p.text('.result-card .result-go'), '開始練習');
  await shot(p, '06_S8_非試行');
  await p.go('lessons.html');
  await p.wait("document.querySelector('.ui-empty-text')", '課程總覽空狀態');
  assert.strictEqual(await p.text('.ui-empty-text'), '課程尚未開放');
  await shot(p, '24_空狀態_課程尚未開放');
  await p.go('lesson.html?no=1');
  await p.wait("document.querySelector('.ui-empty-text')", '上課頁空狀態');
  assert.strictEqual(await p.text('.ui-empty-text'), '課程尚未開放');
  noErrors(p, '非試行');
  /* 新的分頁工作階段、班級名單慢 3 秒:結果頁的「開始練習」照樣馬上畫出 */
  SV.classDelay = 3000;
  const q = await tab(u, {});
  const t0 = Date.now();
  await q.send('Page.navigate', { url: q.origin + '/start.html?step=result' });
  await q.wait("(() => { const a = document.querySelector('.result-card .result-go'); return a && a.textContent.trim() === '開始練習'; })()", '開始練習', 2800);
  const ms = Date.now() - t0;
  SV.classDelay = 0;
  await q.close(); await p.close();
  return '班級名單查詢 ' + (BASE ? '比上一版多 1 次' : n + ' 次(沒給 --base,沒比上一版)') + ';名單慢 3 秒時 ' + ms + ' 毫秒畫出「開始練習」';
};

T['2 試行甲(入門):結果頁「開始第 1 堂」→ 前測(快轉)→ 第 2 堂 → 同一天第 3 堂明天開放 → 隔天第 3、4 堂 → 第 5 堂尚未開放'] = async () => {
  X.resetClock();
  return walk(user(21, '試行甲'), EE, true);
};
T['2 試行乙(門檻):同上,題庫回合照正解答對約 6 成;第 4 堂上完首頁「開始第 5 堂」、總覽第 5 列可上、第 6 列未開放'] = async () => {
  X.resetClock();
  return walk(user(22, '試行乙'), TT, false, { smart: 0.6, open5: true });
};
T['2 照片描述的題在課程外(刷題頁)全部做過、清單裡沒有沒做過的:第 4 堂小檢核說明頁寫「這次沒有照片描述的題」,本堂結果那一列「沒有出題」'] = async () => {
  X.resetClock();
  const c = freshCloud(), u = user(24, '試行戊');
  pilotUser(c, u, EE);
  await seedDone(c, u, EE, 3);
  const t = nowMs() - DAY_MS, rec = {};
  K.env({}).ctx.BANK_META.items.filter((r) => r.part === '1').forEach((r) => { rec[r.id] = { c: 0, ok: true, t }; });
  seedUser(c, u, { listen_p1: rec });
  const p = await tab(u, { url: 'lesson.html?no=4' });
  await p.wait("document.querySelector('.lsn-steps')", '第 4 堂總覽');
  let intro = null;
  const grab = async (q) => { if (intro === null) intro = await q.eval("document.getElementById('lsn-root').textContent"); return null; };
  await drive(p, { goOn: true, shots: { intro: grab }, until: (s) => s === 'result' });
  assert.ok(/這次沒有照片描述的題/.test(intro || ''), '小檢核說明頁:' + String(intro).slice(0, 300));
  const rows = await p.eval("[...document.querySelectorAll('.lsn-verdicts li')].map((li) => li.textContent.trim())");
  const p1 = rows.filter((x) => /照片描述/.test(x));
  assert.ok(rows.length === 3 && p1.length === 1 && /沒有出題$/.test(p1[0]) && rows.filter((x) => x !== p1[0]).every((x) => /(達標|持平|弱點)$/.test(x)), J(rows));
  noErrors(p, '戊');
  await p.close();
  return rows.join('、');
};

/* ---------- 3. 試行丙:聽門檻、讀入門 ---------- */
T['3 試行丙(聽門檻讀入門)第 3 堂:聽力段出門檻包的題、閱讀段出入門包的題'] = async () => {
  X.resetClock();
  const c = freshCloud(), u = user(31, '試行丙');
  pilotUser(c, u, TE);
  await seedDone(c, u, TE, 2);
  const p = await tab(u, { url: 'lesson.html?no=3' });
  await p.wait("document.querySelector('.lsn-steps')", '第 3 堂總覽');
  await p.click('.lsn-go');
  await p.wait("document.querySelector('.lsn-words-wrap, .lsn-tip, .quiz-close')", '開始');
  const r = await p.eval(`(async () => { const files = await LESSON_DATA.packs(); const l = PACK_CORE.compose(files.packs, ${J(TE)}, 3);
    const s = store.get('les_t1_03'); const seg = (n) => l.segments.filter((x) => x.slot === n)[0].blocks;
    const part = new Map(BANK_META.items.map((x) => [x.id, x.part]));
    const ids = (n) => [].concat(...seg(n).map((b) => (s.pk[b.idx] || {}).ids || [])).filter((id) => part.has(id)).map((id) => [id, part.get(id)]);
    return { lis: seg('listening').map((b) => b.blockId), rd: seg('reading').map((b) => b.blockId), lisIds: ids('listening'), rdIds: ids('reading'), lv: s.levels }; })()`);
  assert.ok(r.lis.every((id) => /^threshold-/.test(id)) && r.rd.every((id) => /^entry-/.test(id)), J(r).slice(0, 300));
  /* 凍結的題庫題:聽力段都是 Part 1–4、閱讀段都是 Part 5–7(技巧卡、字卡不在題目索引裡) */
  assert.ok(r.lisIds.length && r.lisIds.every((x) => /^[1-4]$/.test(x[1])), '聽力段凍結的題:' + J(r.lisIds));
  assert.ok(r.rdIds.length && r.rdIds.every((x) => /^[5-7]$/.test(x[1])), '閱讀段凍結的題:' + J(r.rdIds));
  assert.deepStrictEqual(r.lv, TE);
  noErrors(p, '丙');
  await p.close();
  return '聽力區塊 ' + r.lis.length + ' 個(門檻)、閱讀區塊 ' + r.rd.length + ' 個(入門)';
};

/* ---------- 4. 中途重新整理:即時回合、交卷回合(前測在第 2 條甲那一段) ---------- */
T['4 中途重新整理:即時回合答 2 題後回來從第 3 題;交卷回合作答一半回來整回合;前測接著做(第 2 條)'] = async () => {
  X.resetClock();
  const c = freshCloud(), u = user(41, '試行丁');
  pilotUser(c, u, EE);
  await seedDone(c, u, EE, 2);
  const p = await tab(u, { url: 'lesson.html?no=3' });
  await p.wait("document.querySelector('.lsn-steps')", '第 3 堂總覽');
  /* 單字段(字卡、單字小考不是專心模式的題庫回合)做完回總覽,再進聽力段:技巧卡 → 第一個題庫回合(即時對答) */
  await drive(p, { goOn: true, until: (s) => s === 'quiz' });
  assert.strictEqual(await p.eval("!!document.querySelector('.lsn-bridge')"), false, '第一個題庫回合前面沒有過場');
  const [, total] = await countOf(p);
  for (let k = 0; k < 4; k++) { await p.step(); await sleep(250); }
  assert.deepStrictEqual((await countOf(p))[0], 3, '答了 2 題');
  await p.reload();
  await drive(p, { goOn: true, until: (s) => s === 'quiz' });
  assert.deepStrictEqual((await countOf(p))[1], total - 2, '回來只出沒答的題');
  await drive(p, { until: (s) => s === 'bridge' });
  await p.click('.lsn-bridge .lsn-go');
  await p.wait("document.querySelector('.quiz-count')", '交卷回合');
  const [, full] = await countOf(p);
  for (let k = 0; k < Math.floor(full / 2) * 2; k++) { await p.step(); await sleep(150); }
  await p.reload();
  await drive(p, { goOn: true, until: (s) => s === 'bridge' });
  await p.click('.lsn-bridge .lsn-go');
  await p.wait("document.querySelector('.quiz-count')", '交卷回合重出');
  assert.deepStrictEqual(await countOf(p), [1, full], '交卷回合整回合重做');
  noErrors(p, '丁');
  await p.close();
  return '即時回合 ' + total + ' 題 → 回來 ' + (total - 2) + ' 題;交卷回合 ' + full + ' 題 → 回來 ' + full + ' 題';
};

/* ---------- 5. 兩個設定檔、同一個帳號 ---------- */
T['5 兩台:(a) 一台做聽力段、一台做閱讀段,兩邊總覽都看到兩段完成;(b) 兩台同時做同一個即時回合各答幾題後離開,已答題是聯集'] = async () => {
  X.resetClock();
  const c = freshCloud(), u = user(51, '試行戊');
  pilotUser(c, u, EE);
  await seedDone(c, u, EE, 2);
  const a = await tab(u, { url: 'lesson.html?no=3' }), b = await tab(u, { url: 'lesson.html?no=3' });
  /* (b) a 做完單字段進聽力段;b 重新整理(拿到 a 凍結的題)也進聽力段;兩台同時做同一個即時回合 */
  await a.wait("document.querySelector('.lsn-steps')"); await b.wait("document.querySelector('.lsn-steps')");
  await drive(a, { goOn: true, until: (s) => s === 'tip' });
  await b.reload();
  await drive(b, { goOn: true, until: (s) => s === 'tip' });
  await drive(a, { until: (s) => s === 'quiz' }); await drive(b, { until: (s) => s === 'quiz' });
  await a.eval('window.__choice = 0'); await b.eval('window.__choice = 1');
  for (let k = 0; k < 4; k++) { await a.step(); await sleep(200); }
  for (let k = 0; k < 6; k++) { await b.step(); await sleep(200); }
  await a.click('.quiz-close'); await b.click('.quiz-close');
  const keys = (s) => ((s && s.a) || []).filter((x) => x[0] >= 4 && x[0] <= 5).map((x) => x[1] + '|' + x[2] + '|' + x[3]).sort();
  /* 兩台離開後各自在 800 毫秒後上傳(讀雲端、合併、寫回)。兩台幾乎同時上傳時,讀雲端都在對方寫之前,後寫的那份會蓋掉先寫的
     (js/cloud.js 的讀、合併、寫不是一次完成的);被蓋掉的那台本機還有,下次開這一堂(loadLesson 合併後寫回本機、上傳)就補回去。
     所以兩台各開兩次這一堂,最後雲端與兩台都是聯集 */
  await sleep(3000);
  for (let round = 0; round < 2; round++) {
    await a.reload(); await b.reload();
    await a.wait("document.querySelector('.lsn-steps')", 'a 的總覽'); await b.wait("document.querySelector('.lsn-steps')", 'b 的總覽');
    await sleep(2500);
  }
  const sa = await les(a, 3), sb = await les(b, 3), cloud = c.get(u.id, 'les_t1_03');
  assert.strictEqual(keys(cloud).length, 3, '雲端三題:' + J(keys(cloud)));
  assert.deepStrictEqual([keys(sa), keys(sb)], [keys(cloud), keys(cloud)], J({ a: keys(sa), b: keys(sb) }));
  /* (a) a 做完聽力段;b 開總覽看到聽力完成,做閱讀段;最後兩台開總覽都看到兩段完成 */
  const st = async (p) => p.eval("[...document.querySelectorAll('.lsn-step')].filter((li) => /聽力|閱讀/.test(li.textContent)).map((li) => li.className.replace('lsn-step is-', ''))");
  const segment = async (p) => {
    await p.click('.lsn-go');
    await p.wait("!document.querySelector('.lsn-steps')", '進段');
    await drive(p, { until: (s) => s === 'overview' });
  };
  const segDone = (slot) => { const v = c.get(u.id, 'les_t1_03'); return !!(v && v.seg && v.seg[slot] && v.seg[slot].st === 'done'); };
  await segment(a);
  assert.deepStrictEqual(await st(a), ['done', 'current']);
  for (let i = 0; i < 100 && !segDone('listening'); i++) await sleep(150);
  await b.reload();
  await b.wait("document.querySelector('.lsn-steps')", 'b 的總覽');
  assert.deepStrictEqual(await st(b), ['done', 'current'], 'b 開總覽看到聽力完成');
  await segment(b);
  for (let i = 0; i < 100 && !segDone('reading'); i++) await sleep(150);
  await a.reload(); await b.reload();
  await a.wait("document.querySelector('.lsn-steps')", 'a 的總覽'); await b.wait("document.querySelector('.lsn-steps')", 'b 的總覽');
  assert.deepStrictEqual([await st(a), await st(b)], [['done', 'done'], ['done', 'done']]);
  noErrors(a, 'A'); noErrors(b, 'B');
  await a.close(); await b.close();
};

/* ---------- 6. 老師 ---------- */
T['6 教師後台:學生都沒有 plan 時 9 欄;有 plan 時 10 欄、展開列跨 10、值正確'] = async () => {
  X.resetClock();
  const t = user(61, '老師'), s1 = user(62, '學生一'), s2 = user(63, '學生二');
  const c = freshCloud({ teachers: [t.id] });
  seedUser(c, s1, { onboard: ONBOARD, levels: LV(EE) });
  const p = await tab(t, { url: 'admin.html' });
  await p.wait("document.querySelector('.cat-table')", '學生表', 20000);
  const cols = () => p.eval("[document.querySelectorAll('.cat-table tr:first-child th').length, Number((document.querySelector('.cat-table td[colspan]') || {}).getAttribute ? document.querySelector('.cat-table td[colspan]').getAttribute('colspan') : 0)]");
  assert.deepStrictEqual(await cols(), [9, 9]);
  pilotUser(c, s2, EE);
  await seedDone(c, s2, EE, 2);
  await p.reload();
  await p.wait("document.querySelector('.cat-table')", '學生表', 20000);
  assert.deepStrictEqual(await cols(), [10, 10]);
  const vals = await p.eval("[...document.querySelectorAll('.cat-table tr')].slice(1).filter((tr) => !tr.querySelector('td[colspan]')).map((tr) => tr.children[4].textContent).sort()");
  assert.deepStrictEqual(vals, ['—', '第 3 堂']);
  await shot(p, '27_教師後台堂號欄');
  noErrors(p, '老師');
  await p.close();
};

/* ---------- 7. iPhone 尺寸、觸控:前測的播放鈕、倒數、確認視窗 ---------- */
async function tap(p, sel) {
  const r = await p.eval('(() => { const e = document.querySelector(' + J(sel) + '); if (!e) return null; e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()');
  assert.ok(r, '找不到 ' + sel);
  await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] });
  await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
}
T['7 iPhone 375×812 觸控:前測的播放鈕只播一次、倒數在走、沒選就按下一題會問'] = async () => {
  X.resetClock();
  const c = freshCloud(), u = user(71, '試行己');
  pilotUser(c, u, EE);
  const p = await tab(u, { mobile: true, touch: true, url: 'lesson.html?no=1' });
  await p.wait("document.querySelector('.lsn-steps')", '第 1 堂總覽');
  await tap(p, '.lsn-go');
  await p.wait("document.querySelector('.mock-timer')", '前測作答');
  const t1 = await p.text('.mock-timer');
  /* 讀屏念的字:▶ 是 aria-hidden,不算 */
  const said = "(() => { const b = document.querySelector('.lsn-once').cloneNode(true); b.querySelectorAll('[aria-hidden=\"true\"]').forEach((x) => x.remove()); return b.getAttribute('aria-label') || b.textContent.trim(); })()";
  assert.strictEqual(await p.eval(said), '播放 · 限一次');
  await tap(p, '.lsn-once');
  await p.wait("(() => { const b = document.querySelector('.lsn-once'); return b && b.disabled && /已播放|找不到音檔/.test(b.textContent); })()", '播完停用', 30000);
  await sleep(1200);
  assert.notStrictEqual(await p.text('.mock-timer'), t1, '倒數沒在走');
  await tap(p, '.quiz-foot .btn.primary');
  await p.wait("document.querySelector('.ui-dialog')", '確認視窗');
  assert.deepStrictEqual([await p.text('.ui-dialog-h'), await p.text('.ui-dialog-cancel'), await p.text('.ui-dialog-ok')], ['這一題還沒答', '繼續作答', '下一題']);
  await tap(p, '.ui-dialog-cancel');
  assert.deepStrictEqual(await countOf(p), [1, 36]);
  /* 用手指點選項、點「下一題」:換題時程式把焦點移到題目,手指操作不畫鍵盤焦點框 */
  await tap(p, '#lsn-root .letter-big, #lsn-root .opt');
  await tap(p, '.quiz-foot .btn.primary');
  await p.wait("(() => { const t = document.querySelector('.quiz-count'); return t && /^2 \\//.test(t.textContent.trim()); })()", '第 2 題');
  const ring = await p.eval("(() => { const e = document.querySelector(':focus-visible'); return e ? e.className || e.tagName : null; })()");
  assert.strictEqual(ring, null, '手指操作後不該有鍵盤焦點框:' + ring);
  noErrors(p, 'iPhone');
  await p.close();
};

/* ---------- 8. PAID_UI 打開、使用權到期 ---------- */
T['8 PAID_UI 切 true:使用權到期的試行帳號照常上第 3 堂(刷題頁照樣擋)'] = async () => {
  X.resetClock();
  SV.paid = true;
  try {
    const u = user(81, '試行到期');
    const c = freshCloud({ access: { [user(81).id]: { active: false, until: null, source: 'none', is_owner: false, is_teacher: false, role: 'student', trial_until: '2026-10-05T00:00:00Z', paid_through: null, server_now: new Date(nowMs()).toISOString(), classes: [] } } });
    pilotUser(c, u, EE);
    await seedDone(c, u, EE, 2);
    const p = await tab(u, { url: 'practice.html' });
    await p.wait("document.querySelector('.pw-mask')", '刷題頁擋下');
    await p.go('lesson.html?no=3');
    await p.wait("document.querySelector('.lsn-steps')", '第 3 堂總覽');
    await drive(p, { goOn: true, until: (s) => s === 'quiz' || s === 'cards' });
    assert.strictEqual(await p.eval("!!document.querySelector('.pw-mask')"), false, '課程頁不擋');
    noErrors(p, '到期');
    await p.close();
  } finally { SV.paid = false; }
};

/* ---------- 空狀態截圖:還沒設定起始程度、載入失敗 ---------- */
T['空狀態:還沒設定起始程度、學習包載入失敗'] = async () => {
  X.resetClock();
  const c = freshCloud(), u = user(91, '試行沒程度');
  c.members[u.id] = [{ id: PILOT, name: '試行班' }];
  seedUser(c, u, { onboard: ONBOARD, plan: { v: 1, source: 'self', classId: PILOT, term: 1, updatedAt: 1 } });
  const p = await tab(u, { url: 'lesson.html?no=1' });
  await p.wait("document.querySelector('.ui-empty-text')", '空狀態');
  assert.deepStrictEqual([await p.text('.ui-empty-text'), await p.text('.ui-empty-go')], ['還沒設定起始程度', '設定程度']);
  await shot(p, '25_空狀態_還沒設定起始程度');
  seedUser(c, u, { levels: LV(EE) });
  SV.failPacks = true;
  try {
    const q = await tab(u, { url: 'lessons.html' });
    await q.wait("document.querySelector('.ui-empty-text')", '載入失敗');
    assert.strictEqual(await q.text('.ui-empty-text'), '載入失敗');
    await shot(q, '26_空狀態_載入失敗');
    await q.close();
  } finally { SV.failPacks = false; }
  await p.close();
  if (SHOTS) await tipShots();
};
/* 技巧卡 P1、P5、P7 三張的截圖:第 1–4 堂沒走到的(入門包第 4 堂前沒有 P7 卡),在上課頁用課程頁自己的畫面函式畫出來截 */
async function tipShots() {
  const want = { P1: 'tip-P1-photo', P5: 'tip-P5-word_form', P7: 'tip-P7-detail' };
  const left = Object.keys(want).filter((k) => !NAMES['09_技巧卡_' + k]);
  if (!left.length) return;
  const c = freshCloud(), u = user(92, '試行截圖');
  pilotUser(c, u, EE);
  await seedDone(c, u, EE, 2);
  const p = await tab(u, { url: 'lesson.html?no=3' });
  await p.wait("document.querySelector('.lsn-steps')", '第 3 堂總覽');
  for (const k of left) {
    await p.eval(`(() => { const h = document.getElementById('lsn-h'); h.classList.add('daily-sr'); h.parentNode.classList.add('lsn-sr');
      document.querySelector('.lsn-kicker').hidden = true; const t = document.querySelector('.lsn-top'); if (t) t.hidden = true;
      LESSON_VIEWS.show(document.getElementById('lsn-root'), LESSON_VIEWS.tip(${J(want[k])}, { no: 3, back() {}, next() {} }), false); return true; })()`);
    await shot(p, '09_技巧卡_' + k);
  }
  await p.close();
}

/* ---------- 同步:兩台交錯作答同一堂、一台離線後補傳(不開瀏覽器,真的 js/cloud.js) ---------- */
T['同步:兩台交錯作答第 3 堂同一個區塊,手機中途離線、恢復後開新分頁,已答題都留下'] = async () => {
  const vm = require('vm');
  const PACKS = { entry: JSON.parse(fs.readFileSync(path.join(REPO, 'data/packs/pack_entry.json'), 'utf8')), threshold: JSON.parse(fs.readFileSync(path.join(REPO, 'data/packs/pack_threshold.json'), 'utf8')) };
  const scripts = ['js/lesson-rules.js', 'js/pack-util.js', 'js/pack-core.js'].map((f) => new vm.Script(fs.readFileSync(path.join(REPO, f), 'utf8'), { filename: f }));
  const core = (dev) => {
    const ctx = dev.pg.ctx;
    if (!ctx.PACK_CORE) { ctx.TextEncoder = TextEncoder; scripts.forEach((s) => s.runInContext(ctx)); }
    const store = { get: (k, fb) => { const v = H.localOf(dev, k); return v === null ? fb : v; }, set: (k, v) => H.storeSet(dev, k, v) };
    return { P: ctx.PACK_CORE, store };
  };
  const w = H.makeWorld(7), phone = H.makeDevice(w, '手機'), pc = H.makeDevice(w, '筆電');
  await H.signIn(phone); await H.signIn(pc);
  const ids = ['l1-03', 'l1-05', 'l2-01', 'l2-02'];
  const sec = (dev) => Math.floor(H.now(dev) / 1000);
  const { P } = core(phone);
  const lesson = P.compose(PACKS, EE, 3), blk = lesson.segments.filter((s) => s.slot === 'listening')[0].blocks.filter((b) => b.module === 'p1' || b.module === 'p2')[0];
  const start = (dev) => { const x = core(dev); return x.P.saveLesson(1, 3, (s) => s || x.P.freeze(x.P.newState(lesson, sec(dev)), blk.idx, ids, sec(dev)), { store: x.store, lesson }); };
  const answer = (dev, id, c) => { const x = core(dev); x.P.saveLessonLocal(1, 3, (s) => x.P.answer(s, { b: blk.idx, id, sub: 0, c, ok: c === 0, f: true, t: sec(dev) }), { store: x.store, lesson }); };
  await start(phone); await phone.pg.runTimers();
  await start(pc); await pc.pg.runTimers();
  answer(phone, ids[0], 0); await phone.pg.runTimers();
  answer(pc, ids[1], 1); await pc.pg.runTimers();
  phone.offline = true;
  answer(phone, ids[2], 0); await phone.pg.runTimers();
  w.clock.t += 600e3;
  answer(pc, ids[3], 2); await pc.pg.runTimers();
  phone.offline = false;
  await H.newSession(phone); await H.newSession(pc);
  const got = (v) => (v && v.a ? v.a.filter((x) => x[0] === blk.idx).map((x) => x[1]).sort() : []);
  const want = ids.slice().sort();
  assert.deepStrictEqual([got(H.cloudOf(w, 'les_t1_03')), got(H.localOf(phone, 'les_t1_03')), got(H.localOf(pc, 'les_t1_03'))], [want, want, want]);
  return '雲端與兩台都是 ' + want.join('、');
};

/* ---------- 執行 ---------- */
async function main() {
  const base = BASE ? await X.serve(BASE, BASE_PORT) : null;
  let pass = 0, fail = 0;
  const names = Object.keys(T).filter((n) => !ONLY || ONLY.split('|').some((o) => n.indexOf(o) > -1));
  try {
    await X.start();
    for (const n of names) {
      try { const note = await T[n](); pass++; console.info('PASS ' + n + (note ? '  →  ' + note : '')); }
      catch (e) {
        fail++;
        const at = e && e.stack ? (e.stack.split('\n').filter((l) => /test_lesson_e2e|lesson_e2e_kit/.test(l))[0] || '').trim() : '';
        console.info('FAIL ' + n + '  →  ' + String(e && e.message ? e.message : e).replace(/\s+/g, ' ').slice(0, 1500) + (at ? '  ' + at : ''));
      }
      await X.closeAll();
    }
  } finally {
    await X.stop();
    if (base) base.close();
  }
  console.info(pass + ' / ' + names.length + ' 通過');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
