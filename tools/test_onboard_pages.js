/* 新用戶設定起始程度跟其他頁的接點:start.html 的樣板、首頁的卡、「我的」頁學習設定、檢測頁結算卡的主按鈕、教師後台的欄、
   隱私權政策,以及檔案層的靜態檢查(字面字串、store 鍵、跟 main 比只改了該改的行)。
   首頁卡、學習設定、檢測頁用假 DOM 與假的共用元件(js/ui.js 的 UI.sheet、UI.result)把真的程式載進沙盒。不開瀏覽器、不連網。
   用法:node tools/test_onboard_pages.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { REPO, read, MIN, HOUR, DAY, NOW, NOW_ISO, UID, CPID, C, J, plain, eq, guestOf, dataEnv, signedIn } = require('./onboard_kit');

const PRE = 'tr_u' + CPID + '_';
const T = {};

/* ---------- start.html 的樣板 ---------- */
const ONB_FILES = () => fs.readdirSync(path.join(REPO, 'js')).filter((f) => /^onboard.*\.js$/.test(f)).map((f) => 'js/' + f);
const scriptsOf = (f) => (read(f).match(/<script src="[^"]+"/g) || []).map((s) => s.slice(13, -1));
T['S1 start.html:noindex、沒有 canonical、title、body 帶 data-auth-page、theme-color 天藍、頂欄四個導覽(首頁亮)、頁尾「關於本站」'] = () => {
  const s = read('start.html');
  assert.ok(s.indexOf('<meta name="robots" content="noindex">') > -1);
  assert.ok(!/rel="canonical"/.test(s));
  assert.ok(s.indexOf('<title>開始 - 衝衝英文</title>') > -1);
  assert.ok(/<body data-auth-page>/.test(s));
  assert.ok(s.indexOf('<meta name="theme-color" content="#00cdfe">') > -1, 'theme-color 跟全站一樣');
  const nav = /<nav class="topnav" aria-label="主要導覽">[\s\S]*?<\/nav>/.exec(s);
  assert.ok(nav, '頂欄有導覽');
  eq(Array.from(nav[0].matchAll(/<a (?:class="nav-btn" )?href="([^"]+)"(?: class="active" aria-current="page")?>(首頁|日常學習|練練手感|刷刷題目)<\/a>/g)).map((m) => m[2]),
    ['首頁', '日常學習', '練練手感', '刷刷題目']);
  assert.ok(nav[0].indexOf('<a href="index.html" class="active" aria-current="page">首頁</a>') > -1);
  assert.ok(/<details class="foot-about">\s*<summary>關於本站<\/summary>/.test(s));
};
T['S2 start.html 開機程式:清單含 start.html(不加 has-tabbar)、分頁根頁清單照全站;載入 js/ui.js,共用元件在流程檔之前'] = () => {
  const s = read('start.html');
  assert.ok(/\['signup\.html', 'reset\.html', 'terms\.html', 'start\.html'\]\.indexOf\(p\) < 0\) d\.classList\.add\('has-tabbar'\)/.test(s));
  assert.ok(s.indexOf("['index.html', 'learn.html', 'warmup.html', 'drill.html', 'me.html'].indexOf(p) > -1) d.classList.add('is-tab-root')") > -1);
  const sc = scriptsOf('start.html');
  const order = ['js/common.js', 'js/ui.js', 'js/cloud.js', 'js/profile.js', 'js/classes.js', 'js/onboard-core.js', 'js/onboard-data.js', 'js/onboard-ui.js', 'js/onboard.js'];
  order.forEach((f, i) => { assert.ok(sc.indexOf(f) > -1, f); if (i) assert.ok(sc.indexOf(f) > sc.indexOf(order[i - 1]), f + ' 的順序'); });
};
T['S3 app-shell 首頁組含 start.html、頁名表有「開始」;PAID_PAGES 不含 start;版面檢查有 start.html'] = () => {
  const a = read('js/app-shell.js');
  assert.ok(/key: 'home'[^\n]*pages: \[[^\]]*'start\.html'/.test(a));
  assert.ok(a.indexOf("'start.html': '開始'") > -1);
  const pp = /const PAID_PAGES = \[([^\]]*)\]/.exec(read('js/paywall.js'))[1];
  assert.ok(pp.indexOf("'start'") < 0);
  assert.ok(/const PAGES = \(opt\('--pages'\) \|\| '[^']*,start\.html'/.test(read('tools/check_layout.js')));
};

/* ---------- 檔案層 ---------- */
/* 字串常值('…' 與 `…` 的文字段),不看註解 */
function literals(src) {
  const out = [];
  const re = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
  let m;
  while ((m = re.exec(src))) { if (m[0][0] === "'" || m[0][0] === '`') out.push(m[0].slice(1, -1)); }
  return out;
}
T['S4 介面字串:沒有保證、準確、進步、分數區間、還沒做的課表與學習包、半形標點接中文、破折號、英文大寫小標'] = () => {
  const bad = [];
  ONB_FILES().forEach((f) => literals(read(f)).forEach((s) => {
    if (/保證|準確|進步|分數區間/.test(s)) bad.push(f + ' 字眼 ' + s);
    if (/課表|學習包|第 ?\d* ?週|考前可上|堂/.test(s)) bad.push(f + ' 還沒做的功能 ' + s);
    if (/[一-鿿][,;:?!]|[,;:?!][一-鿿]/.test(s)) bad.push(f + ' 半形標點 ' + s);
    if (/—/.test(s)) bad.push(f + ' 破折號 ' + s);
    if (/^[A-Z]{3,}$/.test(s.trim()) && /[A-Z]{4,}/.test(s) && !/^(GET|POST)$/.test(s)) bad.push(f + ' 大寫 ' + s);
  }));
  eq(bad, []);
};
T['S5 onboard*.js 不在事後加 data-nosnippet;首頁區塊建立時就帶'] = () => {
  ONB_FILES().forEach((f) => assert.ok(read(f).indexOf("setAttribute('data-nosnippet'") < 0, f));
  const m = /<section id="onboard-home"[^>]*>/.exec(read('index.html'));
  assert.ok(m && /data-nosnippet/.test(m[0]));
};
T['S6 onboard*.js 的 store 鍵都是字面字串;三鍵與訪客鍵只在資料檔寫;核心檔不讀寫儲存、不碰 DOM'] = () => {
  ONB_FILES().forEach((f) => {
    const src = read(f);
    const calls = src.match(/store\.(get|set|remove)\(\s*[^)]/g) || [];
    calls.forEach((c) => assert.ok(/\(\s*'/.test(c), f + ' ' + c));
    if (f !== 'js/onboard-data.js') {
      assert.ok(!/store\.(set|remove)\(/.test(src), f + ' 不該直接寫 store');
      assert.ok(!/setItem\(/.test(src), f + ' 不該直接寫 localStorage');
    }
  });
  assert.ok(!/localStorage|store\./.test(read('js/onboard-core.js')), '核心檔不讀寫儲存');
  assert.ok(!/document\.|window\./.test(read('js/onboard-core.js')), '核心檔不碰 DOM');
};
/* 比對基準:設定起始程度上線前最後一版 main(4323272)。上線後 main 已經含這些改動,跟 main 比會變成沒有差異,
   所以固定跟上線前那一版比:檢查的還是「這個功能只動了這幾行」 */
const PRE_ONBOARD = '432327216b';   // 短 hash:完整 40 字會被金鑰檢查當成金鑰
function baseRef() {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', PRE_ONBOARD + '^{commit}'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(r.status, 0, '找不到比對基準 ' + PRE_ONBOARD + '(要完整的 git 歷史)');
  return PRE_ONBOARD;
}
/* 跟 main 比的改動行(去掉換行差異、前後空白) */
function changedLines(file) {
  const d = spawnSync('git', ['diff', '-U0', '--ignore-cr-at-eol', baseRef(), '--', file], { cwd: REPO, encoding: 'utf8' });
  assert.equal(d.status, 0, 'git diff 失敗');
  return String(d.stdout || '').split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)).map((l) => l.replace(/\r$/, ''));
}
T['S7 題目資料、common.js 跟 main 相同;檢測頁只換結算卡的主按鈕與從開始頁進來直接開考;cloud.js 只多引導三個鍵與課程進度的合併規則'] = () => {
  const files = ['data/diagnostic.js', 'js/common.js'];
  const r = spawnSync('git', ['diff', '--quiet', '--ignore-cr-at-eol', baseRef(), '--'].concat(files), { cwd: REPO });
  assert.equal(r.status, 0, '有改到:' + files.join('、'));
  /* 檢測頁:diag 的格式與讀寫不動;結算卡的 primary 換成「看起始程度」(設定中交的卷);從開始頁進來直接開考(按「開始」那段抽成 begin) */
  const dg = changedLines('js/diagnostic.js').map((l) => l.slice(0, 1) + l.slice(1).trim());
  eq(dg, [
    '+const AUTO_WAIT = 8000;   // 直接開考前等雲端確認登入的上限(毫秒)',
    '+const wantStart = takeStartParam();',
    '+else if (wantStart && testPending()) autoStart();',
    '+/* 網址的 start=1(從開始頁按「開始檢測」進來)一開頁就讀出來並從網址拿掉:重新整理、上一頁、書籤都照一般規則 */',
    '+function takeStartParam() {',
    '+try {',
    '+const q = new URLSearchParams(location.search);',
    "+if (q.get('start') !== '1') return false;",
    "+q.delete('start');",
    '+const rest = q.toString();',
    "+history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);",
    '+return true;',
    '+} catch (e) { return false; }',
    '+}',
    '+function testPending() {',
    '+try { return !!(window.ONBOARD_UI && ONBOARD_UI.testPending && ONBOARD_UI.testPending()); } catch (e) { return false; }',
    '+}',
    '+/* 設定起始程度停在檢測這一步、還沒有作答:等雲端確認登入,還能寫才直接開考,不用再按一次「開始」。',
    '+確認完不能寫(登入失效、別台登出)、確認失敗或等太久:照原本畫開始頁,按「開始」時 js/profile.js 照常攔下。頁面正要重載就不畫 */',
    '+function autoStart() {',
    "+root.replaceChildren(h('p', { class: 'result-note', role: 'status' }, '載入中…'));",
    '+let settled = false;',
    '+const timer = setTimeout(() => finish(false), AUTO_WAIT);',
    '+function finish(ok) {',
    '+if (settled) return;',
    '+settled = true;',
    '+clearTimeout(timer);',
    '+if (window.CLOUD && CLOUD.reloading) return;',
    '+st = store.get(KEY, null);',
    '+if (st && st.done) renderReport();',
    '+else if (st) renderTest();',
    '+else if (ok && testPending() && canWrite()) begin();',
    '+else renderIntro();',
    '+}',
    '+Promise.resolve(window.CLOUD ? CLOUD.ready : null).then(() => finish(true), () => finish(false));',
    '+}',
    '+function canWrite() {',
    "+try { return !window.PROFILE || typeof PROFILE.canAct !== 'function' || !!PROFILE.canAct(); } catch (e) { return false; }",
    '+}',
    '+',
    '+function begin() {',
    '+if (!uiReady()) return;   // 共用元件沒載到:不清掉原本的作答紀錄',
    '+st = { answers: {}, done: false, startedAt: new Date().toISOString() };',
    '+store.set(KEY, st);',
    '+cur = 0;',
    '+renderTest();',
    '+focus.focusMain();',
    '+}',
    '+',
    '-onclick: () => {',
    '-if (!uiReady()) return;   // 共用元件沒載到:不清掉原本的作答紀錄',
    '-st = { answers: {}, done: false, startedAt: new Date().toISOString() };',
    '-store.set(KEY, st);',
    '-cur = 0;',
    '-renderTest();',
    '-focus.focusMain();',
    '-},',
    '+onclick: begin,',
    '-/* 第一屏:結算卡。姓名與日期放在分數上面的小字;三個難度的正確率跟在卡片下面一行 */',
    '+/* 第一屏:結算卡。姓名與日期放在分數上面的小字;三個難度的正確率跟在卡片下面一行。',
    '+新用戶設定起始程度途中交的卷,主按鈕換成「看起始程度」(js/onboard-ui.js,只有這種時候不是 null) */',
    '+let next = null; try { next = window.ONBOARD_UI ? ONBOARD_UI.diagPrimary() : null; } catch (e) { /* 照原本的「去刷題」 */ }',
    "-primary: { label: '去刷題', href: 'practice.html' },",
    "+primary: next || { label: '去刷題', href: 'practice.html' },",
  ]);
  /* cloud.js:引導的三個鍵只准合併表加三列、SYNC_FN 加三個鍵、檔頭說明(下面 ok 的規則);
     課程進度(les_t、pts、rvq、tests_v1)那一份逐行列在 COURSE:合併表三列、用鍵名規則認的課程進度(MERGED_FAMILIES、mergedIn、localNames)、
     搬家暫存區的 SYNC_FAMILY 與 SYNC_TWO(兩邊的鍵都在,takeSynced 的分支改看 SYNC_TWO)、搬家暫存區補載 js/sync-merge-lesson.js
     (已經載好的判斷 have() 也要看到 SYNC_MERGE.lesson)、檔頭說明 */
  const ok = [
    /^\+    (levels: \{ merge: SMF\('levels'\) \}|onboard: \{ merge: SMF\('onboard'\) \}|self_score: \{ merge: SMF\('selfScore'\) \}),$/,
    /^-  const SYNC_FN = \{ sync_del: 'tombs', vgame_banks: 'banks', mock_history: 'mock', mock_wrong: 'mockWrong' \};$/,
    /^-      else if \(fn === 'mock' \|\| fn === 'mockWrong'\) \{ const a = run\(\(\) => S\[fn\]\(cv\[k\], x\.pv\)\); m = ok\(a\) \? run\(\(\) => S\[fn\]\(base, a\.v\)\) : null; \}$/,
    /^\+     · levels、onboard、self_score\(新用戶的起始程度設定\)/,
    /^\+       (整份留自己時間欄位|先讀雲端、合併、再上傳;灌資料|部署前就開著的舊版分頁\(合併表沒有這三個鍵\))/,
  ];
  const COURSE = [
    '+     · 課程(js/pack-core.js、js/lesson-rules.js):les_t<期>_<堂>(一堂一鍵,用 MERGED_FAMILIES 的鍵名規則認)、pts、rvq、tests_v1。',
    '+       合併函式 SYNC_MERGE.lesson、pts、rvq、tests(規則見 js/sync-merge-lesson.js)。以前整份上傳:離線做的一段、開新分頁灌資料、',
    '+       讀雲端逾時後補傳、兩台差不多同時交卷,後到的會把另一台的作答整份蓋掉。現在跟題庫一樣先讀雲端合併再上傳,灌資料時也合併;',
    '+       加 reconcile:登出、搬家前對帳時本機有這些鍵才多讀它們(沒有課程資料的帳號請求跟以前一樣)。搬家暫存區(SYNC_FN、SYNC_FAMILY)也合併。',
    '+       部署前就開著的舊版分頁(合併表沒有這些鍵)照舊整份上傳,同已知限制 8;課程頁跟這一版 cloud.js 一起上線,舊分頁沒有課程頁。',
    '+       tools/test_lesson_sync.js。',
    "+    pts: { merge: SMF('pts'), reconcile: true },",
    "+    rvq: { merge: SMF('rvq'), reconcile: true },",
    "+    tests_v1: { merge: SMF('tests'), reconcile: true },",
    "-  const spec = k => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(MERGED, k) ? MERGED[k] : null);",
    '+  /* 用鍵名規則認的合併表:課程進度一堂一鍵 les_t<期>_<堂>(期 1–99、堂 01–24,跟 js/pack-core.js 的 lessonKey 一樣) */',
    "+  const MERGED_FAMILIES = [{ re: /^les_t[1-9]\\d?_(0[1-9]|1\\d|2[0-4])$/, spec: { merge: SMF('lesson'), reconcile: true } }];",
    '+  const spec = k => {',
    "+    if (typeof k !== 'string') return null;",
    '+    if (Object.prototype.hasOwnProperty.call(MERGED, k)) return MERGED[k];',
    '+    const f = MERGED_FAMILIES.filter(x => x.re.test(k))[0];',
    '+    return f ? f.spec : null;',
    '+  };',
    '+  /* 合併表上的鍵:固定的那幾個(照表上的順序,sync_del 在 vgame_banks 前面),加上 names 裡符合規則的(排序、不重複) */',
    '+  const mergedIn = names => Object.keys(MERGED).concat(Array.from(new Set(names || [])).filter(k => !Object.prototype.hasOwnProperty.call(MERGED, k) && spec(k)).sort());',
    '+  /* 這個資料夾本機有的鍵名 */',
    '+  function localNames(prefix) {',
    '+    const out = [];',
    '+    try { for (let i = 0; i < localStorage.length; i++) { const lk = localStorage.key(i); if (lk && lk.startsWith(prefix)) out.push(lk.slice(prefix.length)); } } catch (e) { /* 讀不到就只看固定的那幾個 */ }',
    '+    return out;',
    '+  }',
    '-      Object.keys(MERGED).forEach(k => { if (!plan.hold[k]) unmark(user.id, k, Infinity); });',
    '+      mergedIn(Object.keys(readLocalOnly(user.id))).forEach(k => { if (!plan.hold[k]) unmark(user.id, k, Infinity); });',
    '-    const keys = Object.keys(MERGED).filter(k => MERGED[k].reconcile && has(k));',
    '+    const keys = mergedIn(localNames(prefix)).filter(k => spec(k).reconcile && has(k));',
    '-    const want = keys.some(k => MERGED[k].tombs) && keys.indexOf(TOMBS) < 0 ? [TOMBS].concat(keys) : keys;',
    '+    const want = keys.some(k => spec(k).tombs) && keys.indexOf(TOMBS) < 0 ? [TOMBS].concat(keys) : keys;',
    '-    Object.keys(MERGED).filter(k => want.indexOf(k) >= 0).forEach(k => {',
    '+    mergedIn(want).filter(k => want.indexOf(k) >= 0).forEach(k => {',
    '-    try { vals = Object.keys(MERGED).map(k => localStorage.getItem(prefix + k)); } catch (e) { /* 讀不到就只比帳本 */ }',
    '+    try { vals = mergedIn(localNames(prefix)).map(k => localStorage.getItem(prefix + k)); } catch (e) { /* 讀不到就只比帳本 */ }',
    '-    Object.keys(MERGED).forEach(k => {',
    '-      const s = MERGED[k];',
    '+    mergedIn(Object.keys(cloud).concat(localNames(prefix))).forEach(k => {',
    '+      const s = spec(k);',
    "+      .then(() => (window.SYNC_MERGE && window.SYNC_MERGE.lesson ? null : add('js/sync-merge-lesson.js')))",
    '-    const have = () => !!(window.MOVE_RULES && window.MOVE_MERGE && window.DAILY && window.SYNC_MERGE);',
    '+    const have = () => !!(window.MOVE_RULES && window.MOVE_MERGE && window.DAILY && window.SYNC_MERGE && window.SYNC_MERGE.lesson);',
    '-     鍵清單跟著 MERGED 走(takePending 也是看 MERGED 把鍵交過來);每個鍵用哪個合併函式寫在 SYNC_FN。',
    '-     MERGED 上有、SYNC_FN 沒有的鍵(以後加進合併表卻忘了這裡):暫存那份一律放進備份,不准當成題庫合併、也不准略過(略過的話暫存區照樣刪掉)。',
    '+     鍵清單跟著 MERGED 走(takePending 也是看 MERGED 把鍵交過來,用鍵名規則認的課程進度也在裡面);每個鍵用哪個合併函式寫在 SYNC_FN',
    '+     (規則認的鍵寫在 SYNC_FAMILY)。MERGED 上有、SYNC_FN 沒有的鍵(以後加進合併表卻忘了這裡):暫存那份一律放進備份,',
    '+     不准當成題庫合併、也不准略過(略過的話暫存區照樣刪掉)。',
    "+  const SYNC_FAMILY = [[/^les_t/, 'lesson']];",
    '+  const SYNC_TWO = { mock: 1, mockWrong: 1, levels: 1, onboard: 1, selfScore: 1, pts: 1, rvq: 1, tests: 1, lesson: 1 };   // 雲端和暫存那份先合、再合本機(不用標記)',
    "+  const SYNC_FN = { sync_del: 'tombs', vgame_banks: 'banks', mock_history: 'mock', mock_wrong: 'mockWrong', levels: 'levels', onboard: 'onboard', self_score: 'selfScore', pts: 'pts', rvq: 'rvq', tests_v1: 'tests' };",
    '-    const KEYS = Object.keys(MERGED).filter((k) => !MERGED[k].clock);',
    '+    const KEYS = Object.keys(MERGED).filter((k) => !MERGED[k].clock).concat(mergedIn(syncItems.map((x) => x.k)).filter((k) => !MERGED[k]));',
    '-      const fn = Object.prototype.hasOwnProperty.call(SYNC_FN, k) ? SYNC_FN[k] : null;',
    '+      const fam = SYNC_FAMILY.filter((f) => !MERGED[k] && f[0].test(k))[0];',
    '+      const fn = Object.prototype.hasOwnProperty.call(SYNC_FN, k) ? SYNC_FN[k] : fam ? fam[1] : null;',
    '+      else if (SYNC_TWO[fn]) { const a = run(() => S[fn](cv[k], x.pv)); m = ok(a) ? run(() => S[fn](base, a.v)) : null; }',
    '-      Object.keys(marks).forEach(k => { if (MERGED[k]) at[k] = marks[k]; });',
    '+      Object.keys(marks).forEach(k => { if (spec(k)) at[k] = marks[k]; });',
    '-    try { unsure = (await checkCloud(user)).unsure; } catch (e) { unsure = Object.keys(MERGED).filter(k => MERGED[k].reconcile); }',
    "+    try { unsure = (await checkCloud(user)).unsure; } catch (e) { unsure = mergedIn(localNames('tr_u' + pidOf(user) + '_')).filter(k => spec(k).reconcile); }",
  ];
  /* 後來加的保護(跟起始程度無關):supabase-js 鎖版本與 integrity、網址帶回來的登入錯誤只顯示固定說明、
     註冊訊息不分辨信箱有沒有註冊過、搬家暫存區讀值時拿掉 __proto__ 鍵;逐行列在 tools/fixtures/cloud_harden_lines.json(同一行出現幾次就列幾次) */
  const HARDEN = require('./fixtures/cloud_harden_lines.json');
  /* 清單逐行計次比對:清單上的每一行要出現同樣的次數,多一行(包括空行、右括號這類一般的行)或少一行都不算 */
  const rest = changedLines('js/cloud.js').filter((l) => !ok.some((re) => re.test(l)) && COURSE.indexOf(l) < 0);
  eq(rest.slice().sort(), HARDEN.slice().sort(), 'cloud.js 的改動跟清單不一樣');
};
T['S7b js/classes.js 只改兩處:加入班級的小字補「程度檢測結果」、匯出邀請碼格式檢查'] = () => {
  const changed = changedLines('js/classes.js').map((l) => l.slice(0, 1) + l.slice(1).trim());
  eq(changed, [
    '-const api = { normalize, join, list, leave };',
    '+/* check:邀請碼格式的錯誤訊息(合格回空字串),start.html 的 C1 離開欄位時用 */',
    '+const api = { normalize, check: (raw) => formatError(normalize(raw)), join, list, leave };',
    "-h('p', { class: 'auth-fine' }, '加入後這個班的老師看得到你的暱稱、Email 和學習記錄。'));",
    "+h('p', { class: 'auth-fine' }, '加入後這個班的老師看得到你的暱稱、Email、程度檢測結果和學習記錄。'));",
  ]);
  assert.ok(read('js/onboard.js').indexOf("'加入後這個班的老師看得到你的暱稱、Email、程度檢測結果和學習記錄。'") > -1, 'C1 同一句');
};
T['檔案大小:新的 js 檔與測試都小於 800 行'] = () => {
  ONB_FILES().concat(['tools/test_onboard.js', 'tools/test_onboard_pages.js', 'tools/test_onboard_screens.js', 'tools/test_onboard_sync.js', 'tools/onboard_kit.js'])
    .forEach((f) => assert.ok(read(f).split('\n').length < 800, f));
};
T['S8 公開的新檔不寫內部用語與 repo 外的路徑'] = () => {
  const files = ONB_FILES().concat(['start.html', 'tools/test_onboard.js', 'tools/test_onboard_pages.js', 'tools/test_onboard_screens.js', 'tools/test_onboard_sync.js', 'tools/onboard_kit.js']);
  const bad = [];
  /* 字寫成 \u 跳脫,這支測試自己也不出現那些字;另外抓里程碑代號、Windows 磁碟路徑 */
  const WORDS = /\u5be9\u67e5|\u898f\u683c|\u6846\u67b6|\u7d93\u71df\u8005|\u5de5\u4f5c\u5305|\u4ee3\u7406|\u3014|\x47PT|\bM1\b|\b[A-Z]:[\\/]/g;
  files.forEach((f) => { const m = read(f).match(WORDS); if (m) bad.push(f + ' ' + m.join(',')); });
  eq(bad, []);
};

/* ---------- 首頁的卡、學習設定(純計算) ---------- */
T['B1 homeCard:訪客 A 不畫(首屏的「先測程度」連 start.html);已登入 A、B、B_result、D0、E 的標題與按鈕;其他狀態不畫'] = () => {
  assert.equal(C.homeCard('A', { signedIn: false }), null);
  const a = plain(C.homeCard('A', { signedIn: true }));
  /* 按鈕字跟狀態 E 一樣是「設定程度」:每日練習卡已經有一顆「開始」 */
  eq([a.title, a.sub, a.primary.text, a.primary.href, a.secondary.text, a.secondary.href, a.dismiss],
    ['找出你的起始程度', '填多益成績，或做 28 題檢測（約 20 分鐘）', '設定程度', 'start.html?step=target', '我有班級代碼', 'start.html?step=join', false]);
  const bg = plain(C.homeCard('B', { signedIn: false, guest: guestOf({ step: 'exam' }) }));
  eq([bg.title, bg.sub, bg.primary.text, bg.primary.href, bg.secondary], ['繼續設定起始程度', '', '繼續', 'start.html?step=exam', null]);
  assert.equal(C.homeCard('B', { signedIn: true, onboard: { status: 'in_progress', step: 'test' } }).primary.href, 'start.html?step=test');
  const br = plain(C.homeCard('B_result', { signedIn: true, onboard: { status: 'in_progress', step: 'test' } }));
  eq([br.title, br.primary.text, br.primary.href], ['繼續設定起始程度', '看起始程度', 'start.html?step=result']);
  const d0 = plain(C.homeCard('D0', { signedIn: true, levels: { listening: 'threshold', reading: 'entry' } }));
  eq([d0.title, d0.sub, d0.primary.text, d0.primary.href], ['你的起始程度', '聽力 門檻／閱讀 入門', '開始練習', 'grammar.html']);
  eq(plain(C.homeCard('D0', { signedIn: true, levels: null })).primary, { text: '看起始程度', href: 'start.html?step=result' });
  const e = plain(C.homeCard('E', { signedIn: true }));
  eq([e.title, e.sub, e.primary.text, e.primary.href, e.dismiss], ['找出你的起始程度', '填多益成績，或做 28 題檢測（約 20 分鐘）', '設定程度', 'start.html?step=target', true]);
  ['none', 'S0', 'resume', 'join', undefined].forEach((s) => assert.equal(C.homeCard(s, {}), null, String(s)));
};
T['B1b continueHref:接著中斷的那一步;沒有或不認得回 S1'] = () => {
  eq(['target', 'exam', 'level', 'score', 'test', 'result'].map((s) => C.continueHref({ step: s })),
    ['target', 'exam', 'level', 'score', 'test', 'result'].map((s) => 'start.html?step=' + s));
  [null, {}, { step: null }, { step: 'signup' }, { step: 'resume' }, { step: 'x' }].forEach((v) => assert.equal(C.continueHref(v), 'start.html?step=target', J(v)));
};
T['B2 settingsRows:有程度五列(「檢測報告」有 diag.done 才有,不叫「舊版」);沒程度只有「設定程度」'] = () => {
  const lv = { listening: 'threshold', reading: 'entry' };
  const ob = { status: 'done', targetScore: 600, examMonth: '2027-03' };
  const rows = plain(C.settingsRows({ onboard: ob, levels: lv }, { done: true, finishedAt: '2026-11-18T04:00:00.000Z' }));
  eq(rows.map((r) => [r.label, r.value, r.href || r.action]), [
    ['程度', '聽力 門檻／閱讀 入門', 'levels'], ['目標分數', '600 分', 'start.html?step=target&from=me'],
    ['考試月份', '2027 年 3 月', 'start.html?step=exam&from=me'], ['重新檢測', '11 月 18 日', 'start.html?step=test&from=me'],
    ['檢測報告', '11 月 18 日', 'diagnostic.html']]);
  assert.ok(!/舊版/.test(read('js/onboard-core.js').split('\n').filter((l) => /label: '/.test(l)).join('\n')), '列名不寫「舊版」');
  const r2 = plain(C.settingsRows({ onboard: { status: 'done', targetScore: null, examMonth: null }, levels: lv }, { done: false }));
  eq(r2.map((r) => r.value), ['聽力 門檻／閱讀 入門', '還不確定', '還沒報名', '']);
  assert.equal(r2[3].label, '做檢測', '沒做過檢測叫「做檢測」,跟 S8 一致');
  assert.equal(C.settingsRows({ onboard: { targetScore: 860 }, levels: lv }, null)[1].value, '860 分以上');
  eq(plain(C.settingsRows({ onboard: null, levels: null }, null)), [{ key: 'setup', label: '設定程度', value: '', href: 'start.html?step=target' }]);
  eq(plain(C.settingsRows({ onboard: { status: 'dismissed' }, levels: null }, null))[0].href, 'start.html?step=target');
  eq(plain(C.settingsRows({ onboard: { status: 'in_progress', step: 'score' }, levels: { listening: 'x' } }, null))[0].href, 'start.html?step=score');
};
T['B2b 重新檢測:startTest 把已完成的設定改回 in_progress,交卷後檢測頁才認得'] = () => {
  const e = dataEnv(signedIn());
  e.ls.set(PRE + 'onboard', J({ v: 1, status: 'done', step: 'result', targetScore: 600, examMonth: null, testFrom: null }));
  assert.equal(e.D.startTest(), 'ok');
  const ob = JSON.parse(e.ls.get(PRE + 'onboard'));
  eq([ob.status, ob.step, ob.testFrom, ob.targetScore], ['in_progress', 'test', NOW_ISO, 600]);
  assert.equal(C.diagRowState(ob, { done: true, finishedAt: new Date(NOW + MIN).toISOString() }), 'result');
};

/* ---------- 假 DOM 與假的共用元件 ---------- */
/* 夠 onboard-ui.js(首頁卡、學習設定、改級別面板)與 diagnostic.js(結算卡)用。選擇器只認 #id、.class、tag */
function miniDom() {
  class N {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = tag === '#text' ? 3 : 1; this.children = []; this.parentNode = null; this.attrs = {}; this.className = ''; this._t = ''; this.on = {}; this.hidden = false; this.checked = false; }
    get classList() {
      const cls = () => this.className.split(' ').filter(Boolean);
      return { contains: (c) => cls().indexOf(c) > -1, add: (c) => { if (cls().indexOf(c) < 0) this.className = cls().concat([c]).join(' '); },
        remove: (c) => { this.className = cls().filter((x) => x !== c).join(' '); }, toggle: () => {} };
    }
    append(...ns) { ns.forEach((n) => { if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.children.push(n); }); }
    replaceChildren(...ns) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._t = ''; this.append(...ns); }
    after(n) { const p = this.parentNode; if (n.parentNode) n.parentNode._rm(n); n.parentNode = p; p.children.splice(p.children.indexOf(this) + 1, 0, n); }
    replaceWith(n) { const p = this.parentNode; const i = p.children.indexOf(this); p._rm(this); n.parentNode = p; p.children.splice(i, 0, n); }
    get nextElementSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
    _rm(c) { const i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); c.parentNode = null; }
    remove() { if (this.parentNode) this.parentNode._rm(this); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
    click() { (this.on.click || []).forEach((f) => f({ currentTarget: this, target: this, preventDefault() {} })); }
    focus() {}
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.tagName === 'ROOT'; }
    get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children = []; this._t = String(v); }
    set innerHTML(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._t = ''; }
    all() { const out = []; const w = (n) => { n.children.forEach((c) => { out.push(c); w(c); }); }; w(this); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) {
      const one = (n, s) => (s[0] === '#' ? n.attrs.id === s.slice(1) : s[0] === '.' ? n.className.split(' ').indexOf(s.slice(1)) > -1
        : s === 'input:checked' ? n.tagName === 'INPUT' && n.checked : n.tagName === s.toUpperCase());
      return this.all().filter((n) => n.nodeType === 1 && sel.split(',').some((s) => one(n, s.trim())));
    }
  }
  const root = new N('root');
  const body = new N('body'); root.append(body);
  const document = { createElement: (t) => new N(t), createTextNode: (t) => { const n = new N('#text'); n._t = String(t); return n; },
    createDocumentFragment: () => new N('#frag'), readyState: 'complete',
    addEventListener() {}, querySelector: (s) => root.querySelector(s), querySelectorAll: (s) => root.querySelectorAll(s),
    getElementById: (id) => root.querySelector('#' + id), body, activeElement: null, documentElement: { classList: { contains: () => false } } };
  return { N, root, body, document };
}
/* 假的 js/ui.js:只記下呼叫的參數,畫最少的節點 */
function fakeUI(e, document) {
  e.sheets = []; e.results = [];
  return {
    sheet: (o) => { const el = document.createElement('div'); el.className = 'ui-sheet'; (o.nodes || []).forEach((n) => el.append(n)); document.body.append(el);
      const api = { el, opt: o, open: true, close: () => { api.open = false; el.remove(); } }; e.sheets.push(api); return api; },
    result: (o) => { e.results.push(o); const el = document.createElement('section'); el.className = 'result-card'; return { el, reward: document.createElement('div'), heading: el, destroy() {} }; },
    detail: () => document.createElement('details'), empty: () => document.createElement('div'), mount() {},
  };
}
function uiEnv(opt) {
  opt = opt || {};
  const dom = miniDom();
  const e = dataEnv(opt);
  const ctx = e.ctx;
  ctx.document = dom.document;
  ctx.setTimeout = setTimeout;
  ctx.PROFILE = { showLogin: () => { e.logins = (e.logins || 0) + 1; }, askToAct: () => { e.asked = (e.asked || 0) + 1; }, current: () => ({ name: '測試' }) };
  ctx.UI = fakeUI(e, dom.document);
  e.replaced = [];
  ctx.location = { search: '', replace: (u) => e.replaced.push(u), href: '' };
  ctx.sessionStorage = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; })();
  vm.runInContext(read('js/onboard-ui.js'), ctx);
  return Object.assign(e, { dom, UI: ctx.ONBOARD_UI });
}
const texts = (n) => n.all().filter((x) => x.tagName === 'A' || x.tagName === 'BUTTON' || x.tagName === 'H2').map((x) => x.textContent);
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
/* 首頁的格線:每日練習卡、(小雞卡)、這張卡 */
function homeGrid(env, withPet) {
  const grid = env.dom.document.createElement('div'); env.dom.body.append(grid);
  const daily = env.dom.document.createElement('section'); daily.setAttribute('id', 'daily-home'); grid.append(daily);
  if (withPet) { const pet = env.dom.document.createElement('section'); pet.className = 'pet-home'; grid.append(pet); }
  const box = env.dom.document.createElement('section'); box.hidden = true; grid.append(box);
  return { grid, daily, box };
}

T['B3 首頁卡:訪客沒有暫存不畫(首屏有「先測程度」);訪客設定到一半畫「繼續設定起始程度」;雲端沒開不畫;老師等 CLOUD.ready 後收掉'] = async () => {
  const g = uiEnv();
  const h0 = homeGrid(g); g.UI.homeCard(h0.box); await settle();
  eq([h0.box.hidden, h0.box.children.length], [true, 0]);

  const b = uiEnv({ init: { tr_onboard_guest: J(guestOf({ step: 'exam' })) } });
  const hb = homeGrid(b); b.UI.homeCard(hb.box);
  eq([hb.box.hidden, texts(hb.box)], [false, ['繼續設定起始程度', '繼續']]);
  assert.equal(hb.box.all().find((x) => x.tagName === 'A').getAttribute('href'), 'start.html?step=exam');

  const off = uiEnv({ init: { tr_onboard_guest: J(guestOf({ step: 'exam' })) } }); off.ctx.CLOUD.enabled = false;
  const ho = homeGrid(off); off.UI.homeCard(ho.box); await settle();
  assert.equal(ho.box.hidden, true);

  const t = uiEnv(signedIn());
  t.ctx.CLOUD.ready = Promise.resolve().then(() => { t.ctx.CLOUD.isTeacher = true; });   // 老師身分要等 CLOUD.ready 才知道
  t.ls.set(PRE + 'onboard', J({ v: 1, status: 'in_progress', step: 'exam' }));
  const ht = homeGrid(t); t.UI.homeCard(ht.box);
  assert.equal(ht.box.hidden, false, '有 onboard 先同步畫 B');
  await settle();
  eq([ht.box.hidden, ht.box.children.length], [true, 0]);
};
T['B3b 首頁卡:已登入沒有 onboard 等 CLOUD.ready 前不畫;之後新帳號 A、舊帳號 E;「不用了」寫 dismissed 並收掉'] = async () => {
  const n = uiEnv(signedIn({ user: { id: UID, created_at: new Date(NOW - DAY).toISOString() } }));
  const hn = homeGrid(n); n.UI.homeCard(hn.box);
  eq([hn.box.hidden, hn.box.children.length], [true, 0], '等 CLOUD.ready:不畫');
  await settle();
  eq([hn.box.hidden, texts(hn.box)], [false, ['找出你的起始程度', '設定程度', '我有班級代碼']]);
  /* 帳號有不認得的 onboard:ready 之前先畫的卡沒有「不用了」(還沒確定登入) */
  const u = uiEnv(signedIn());
  u.ls.set(PRE + 'onboard', J({ v: 1, status: 'weird' }));
  u.ctx.CLOUD.ready = new Promise(() => {});
  const hu = homeGrid(u); u.UI.homeCard(hu.box);
  assert.equal(texts(hu.box).indexOf('不用了'), -1);

  const o = uiEnv(signedIn());
  const ho = homeGrid(o); o.UI.homeCard(ho.box); await settle();
  eq(texts(ho.box), ['找出你的起始程度', '設定程度', '不用了']);
  ho.box.all().find((x) => x.textContent === '不用了').click();
  eq([ho.box.hidden, JSON.parse(o.ls.get(PRE + 'onboard')).status], [true, 'dismissed']);
};
T['B3c 首頁:已登入且有可接回的訪客鍵 → 轉 start.html?step=resume;主畫面開的訪客沒有學習資料 → 轉 start.html 一次'] = async () => {
  const r = uiEnv(Object.assign(signedIn(), { init: { tr_onboard_guest: J(guestOf({ pendingAction: 'test', authStartedAt: NOW - MIN })) } }));
  r.UI.homeCard(homeGrid(r).box); await settle();
  eq(r.replaced, ['start.html?step=resume']);

  const s = uiEnv(Object.assign(signedIn(), { init: { tr_onboard_guest: J(guestOf()) } }));
  s.UI.homeCard(homeGrid(s).box); await settle();
  eq([s.replaced, s.ls.has('tr_onboard_guest')], [[], false]);

  const p = uiEnv();
  p.ctx.document.documentElement = { classList: { contains: (c) => c === 'is-app' } };
  const hp = homeGrid(p);
  p.UI.homeCard(hp.box); p.UI.homeCard(hp.box); await settle();
  eq(p.replaced, ['start.html']);
};
T['B3d 首頁卡的位置與按鈕:排在每日練習卡後面(小雞卡前面);按鈕是描邊鈕與文字按鈕,實色主按鈕留給每日練習'] = async () => {
  const d = uiEnv(signedIn());
  d.ls.set(PRE + 'onboard', J({ v: 1, status: 'done', step: 'result', updatedAt: NOW_ISO }));
  d.ls.set(PRE + 'levels', J({ listening: 'advanced', reading: 'threshold', source: { listening: 'score', reading: 'score' }, setAt: NOW_ISO, history: [] }));
  const hd = homeGrid(d, true); d.UI.homeCard(hd.box); await settle();
  eq(hd.grid.children.map((x) => x.attrs.id || x.className), ['daily-home', '', 'pet-home']);
  assert.equal(hd.grid.children[1], hd.box);
  eq(texts(hd.box), ['你的起始程度', '開始練習']);
  assert.ok(/聽力 進階／閱讀 門檻/.test(hd.box.textContent));
  const btns = hd.box.all().filter((x) => x.tagName === 'A' || x.tagName === 'BUTTON');
  eq(btns.map((x) => x.className), ['btn']);
  assert.equal(btns[0].getAttribute('href'), 'practice.html?part=5');
  const e = uiEnv(signedIn());
  const he = homeGrid(e, true); e.UI.homeCard(he.box); await settle();
  eq(he.box.all().filter((x) => x.tagName === 'A' || x.tagName === 'BUTTON').map((x) => x.className), ['btn', 'btn-text']);
};
/* 試行班(js/lesson-home.js):首頁格帶 .home-grid、課程的開關與名單,有 plan 的學生開頁當下就知道是試行班(課程的其他檔不用載到) */
function pilotHome(over) {
  const e = uiEnv(signedIn());
  Object.entries(Object.assign({ levels: { listening: 'entry', reading: 'entry', source: {}, history: [] }, plan: { v: 1, classId: 'class-a', term: 1 } }, over))
    .forEach(([k, v]) => e.ls.set(PRE + k, J(v)));
  Object.assign(e.ctx, { PACKS_UI: 'pilot', PACKS_PILOT_CLASSES: ['class-a'], addEventListener() {} });
  const g = homeGrid(e, true);
  g.grid.className = 'home-grid';
  vm.runInContext(read('js/lesson-home.js'), e.ctx);
  e.UI.homeCard(g.box);
  return Object.assign(e, { g });
}
T['B3e 試行班:設定做完(D0)不畫起始程度卡(讓給今天的課卡);剛交卷(B_result)照畫起始程度卡'] = async () => {
  const d0 = pilotHome({ onboard: { v: 1, status: 'done', step: 'result', updatedAt: NOW_ISO } });
  eq([d0.g.box.hidden, d0.g.box.children.length], [true, 0], '同步畫的那一次');
  await settle();
  eq([d0.g.box.hidden, d0.g.box.children.length], [true, 0], 'CLOUD.ready 之後');
  const ip = { v: 1, status: 'in_progress', step: 'test', testFrom: new Date(NOW - HOUR).toISOString() };
  const br = pilotHome({ onboard: ip, diag: { answers: {}, done: true, startedAt: new Date(NOW - 30 * MIN).toISOString(), finishedAt: new Date(NOW - MIN).toISOString() } });
  await settle();
  eq([br.g.box.hidden, texts(br.g.box)], [false, ['繼續設定起始程度', '看起始程度']]);
};
T['B4 「我的」頁學習設定:老師、訪客、雲端沒開不顯示;有程度五列;程度那列開改級別面板(UI.sheet),套用寫 manual'] = () => {
  assert.equal(uiEnv().UI.settingsSection(), null);
  assert.equal(uiEnv(signedIn({ teacher: true })).UI.settingsSection(), null);
  const off = uiEnv(signedIn()); off.ctx.CLOUD.enabled = false; assert.equal(off.UI.settingsSection(), null);
  eq(texts(uiEnv(signedIn()).UI.settingsSection()), ['學習設定', '設定程度']);
  const e = uiEnv(signedIn());
  e.ls.set(PRE + 'onboard', J({ v: 1, status: 'done', step: 'result', targetScore: 785, examMonth: '2027-03' }));
  e.ls.set(PRE + 'levels', J({ listening: 'advanced', reading: 'threshold', source: { listening: 'score', reading: 'score' }, history: [{ at: NOW_ISO, listening: 'advanced', reading: 'threshold', reason: 'score' }] }));
  const sec = e.UI.settingsSection();
  e.dom.body.append(sec);
  eq(texts(sec), ['學習設定', '程度聽力 進階／閱讀 門檻', '目標分數785 分', '考試月份2027 年 3 月', '做檢測']);
  assert.equal(sec.getAttribute('id'), 'learning-settings');
  sec.all().find((x) => x.tagName === 'BUTTON').click();
  assert.equal(e.sheets.length, 1, '開了改級別面板');
  const sh = e.sheets[0];
  eq([sh.opt.title, sh.opt.focus && sh.opt.focus.getAttribute('value')], ['改級別', 'advanced']);
  const radios = sh.el.all().filter((x) => x.tagName === 'INPUT');
  eq(radios.filter((x) => x.checked).map((x) => x.getAttribute('value')), ['advanced', 'threshold']);
  const pickR = radios.find((x) => x.getAttribute('name').indexOf('ob-reading') === 0 && x.getAttribute('value') === 'high');
  pickR.on.change[0]({});
  assert.ok(/與檢測結果差 2 級/.test(sh.el.textContent), '差 2 級的提示');
  const apply = sh.el.all().find((x) => x.tagName === 'BUTTON' && x.textContent === '套用');
  assert.equal(apply.className, 'btn primary ob-apply');
  apply.click();
  const lv = JSON.parse(e.ls.get(PRE + 'levels'));
  eq([lv.reading, lv.source.reading, lv.source.listening, lv.history[lv.history.length - 1].reason, sh.open], ['high', 'manual', 'score', 'manual', false]);
};
/* 檢測頁:真的 js/diagnostic.js 載進沙盒,看結算卡的主按鈕 */
function diagPage(ob, diag, opt, tweak) {
  const e = uiEnv(Object.assign(signedIn(), opt || {}));
  if (ob) e.ls.set(PRE + 'onboard', J(ob));
  if (diag) e.ls.set(PRE + 'diag', J(diag));
  const root = e.dom.document.createElement('div'); root.setAttribute('id', 'diag-root'); e.dom.body.append(root);
  const ctx = e.ctx;
  Object.assign(ctx, { TOEIC: {}, scrollTo() {}, print() {} });
  e.focusLog = [];
  ctx.clearTimeout = clearTimeout;
  ctx.UI = Object.assign(ctx.UI, { focus: { enter: () => { e.focusLog.push('enter'); return { active: true, leave() {}, progress() {}, setTotal() {}, foot() {}, action() {}, focusMain() { e.focusLog.push('main'); } }; } } });
  vm.runInContext(read('data/diagnostic.js'), ctx);
  if (tweak) tweak(ctx);
  const before = e.ls.get(PRE + 'diag');
  vm.runInContext(read('js/diagnostic.js'), ctx);
  return { e, before };
}
const ANS28 = () => { const a = {}; for (let i = 0; i < 28; i++) a[i] = i % 4; return a; };
T['B5 檢測頁:設定中、按「開始檢測」之後交的卷,結算卡主按鈕換成「看起始程度」;其他時候照原本「去刷題」;diag 不改'] = () => {
  const done = { answers: ANS28(), done: true, startedAt: new Date(NOW - 20 * MIN).toISOString(), finishedAt: new Date(NOW).toISOString() };
  const ip = { v: 1, status: 'in_progress', step: 'test', testFrom: new Date(NOW - HOUR).toISOString() };
  const a = diagPage(ip, done);
  eq(plain(a.e.results[0].primary), { label: '看起始程度', href: 'start.html?step=result' });
  assert.equal(a.e.ls.get(PRE + 'diag'), a.before, 'diag 一個字都沒改');
  const late = diagPage(Object.assign({}, ip, { testFrom: new Date(NOW + MIN).toISOString() }), done);
  eq(plain(late.e.results[0].primary), { label: '去刷題', href: 'practice.html' }, '舊報告(早於按開始檢測)不算');
  const fin = diagPage({ v: 1, status: 'done', step: 'result' }, done);
  eq(plain(fin.e.results[0].primary), { label: '去刷題', href: 'practice.html' });
  const none = diagPage(null, done);
  eq(plain(none.e.results[0].primary), { label: '去刷題', href: 'practice.html' });
  const guest = uiEnv();
  assert.equal(guest.UI.diagPrimary(), null, '訪客');
  /* 換主按鈕的程式丟錯、核心檔沒載到:報告照畫,主按鈕照原本 */
  const boom = diagPage(ip, done, null, (ctx) => { ctx.ONBOARD_UI = { diagPrimary() { throw new Error('x'); } }; });
  eq([boom.e.results.length, plain(boom.e.results[0].primary)], [1, { label: '去刷題', href: 'practice.html' }]);
  const noCore = uiEnv(signedIn());
  noCore.ctx.ONBOARD_CORE = undefined;
  vm.runInContext(read('js/onboard-ui.js'), noCore.ctx);
  assert.equal(noCore.ctx.ONBOARD_UI.diagPrimary(), null, '核心檔沒載到');
};
T['B5b 檢測頁:從開始頁進來(網址 start=1、設定停在檢測這一步、還沒作答)等雲端確認登入、還能寫才直接開考;參數一開頁就拿掉;其他情況照原本'] = async () => {
  const ip = { v: 1, status: 'in_progress', step: 'test', testFrom: new Date(NOW - MIN).toISOString() };
  const url = (search, more) => (ctx) => {
    Object.assign(ctx.location, { search, pathname: '/diagnostic.html', hash: '' });
    ctx.history = { replaceState(s, t, u) { ctx.__replaced = u; } };
    if (more) more(ctx);
  };
  const body = (p) => p.e.dom.body.all();
  const intro = (p) => body(p).some((x) => x.tagName === 'BUTTON' && x.textContent === '開始');
  const quiz = (p) => body(p).some((x) => /(^| )q-block( |$)/.test(x.className || ''));
  const loading = (p) => body(p).some((x) => x.textContent === '載入中…' && x.getAttribute('role') === 'status');
  const anyDiag = (p) => Array.from(p.e.ls.keys()).some((k) => /diag$/.test(k));
  /* 正常:雲端確認前只顯示載入中、不寫;確認完能寫 → 開考(專心模式、第 1 題、焦點) */
  let release;
  const go = diagPage(ip, null, null, url('?start=1', (ctx) => { ctx.CLOUD.ready = new Promise((r) => { release = r; }); }));
  eq([go.e.ctx.__replaced, loading(go), anyDiag(go), intro(go), quiz(go)], ['/diagnostic.html', true, false, false, false], '確認前');
  release(go.e.ctx.CLOUD.user); await settle();
  const d = JSON.parse(go.e.ls.get(PRE + 'diag'));
  eq([d.done, Object.keys(d.answers).length, typeof d.startedAt, intro(go), quiz(go), loading(go), go.e.focusLog], [false, 0, 'string', false, true, false, ['enter', 'main']], '確認後');
  /* 不開考、畫開始頁、不寫 diag 的情況 */
  const notStart = [
    ['沒帶網址參數', diagPage(ip, null, null, url(''))],
    ['設定已完成', diagPage({ v: 1, status: 'done', step: 'result' }, null, null, url('?start=1'))],
    ['設定中但不在檢測這一步', diagPage({ v: 1, status: 'in_progress', step: 'result' }, null, null, url('?start=1'))],
    ['設定完成但停在檢測這一步', diagPage({ v: 1, status: 'done', step: 'test' }, null, null, url('?start=1'))],
    ['沒有設定', diagPage(null, null, null, url('?start=1'))],
    ['訪客(訪客資料夾也有停在檢測的設定)', diagPage(null, null, { pid: 'p1', user: null }, url('?start=1', (ctx) => { ctx.localStorage.setItem('tr_up1_onboard', J(ip)); }))],
    ['引導的程式沒載到', diagPage(ip, null, null, url('?start=1', (ctx) => { ctx.ONBOARD_UI = undefined; }))],
    ['確認完不能寫(登入失效)', diagPage(ip, null, null, url('?start=1', (ctx) => { ctx.PROFILE.canAct = () => false; }))],
    ['雲端確認失敗', diagPage(ip, null, null, url('?start=1', (ctx) => { ctx.CLOUD.ready = Promise.reject(new Error('x')); }))],
  ];
  await settle();
  notStart.forEach(([name, p]) => eq([anyDiag(p), intro(p), quiz(p), p.e.focusLog.length], [false, true, false, 0], name));
  notStart.slice(1).forEach(([name, p]) => assert.equal(p.e.ctx.__replaced, '/diagnostic.html', name + ':參數拿掉'));
  /* 頁面正要重載:只留載入中,不寫、不畫 */
  const rl = diagPage(ip, null, null, url('?start=1', (ctx) => { ctx.CLOUD.reloading = true; }));
  await settle();
  eq([anyDiag(rl), intro(rl), quiz(rl), loading(rl)], [false, false, false, true], '正要重載');
  /* 等太久:照原本畫開始頁;之後雲端才確認也不再開考 */
  let late, fire;
  const slow = diagPage(ip, null, null, url('?start=1', (ctx) => {
    ctx.CLOUD.ready = new Promise((r) => { late = r; });
    ctx.setTimeout = (fn, ms) => { fire = fn; ctx.__wait = ms; return 1; };
  }));
  assert.equal(slow.e.ctx.__wait, 8000);
  fire(); late(slow.e.ctx.CLOUD.user); await settle();
  eq([anyDiag(slow), intro(slow), quiz(slow)], [false, true, false], '等太久');
  /* 等的時候別的分頁開考了:照讀到的作答接著做,不重開 */
  let r2;
  const other = diagPage(ip, null, null, url('?start=1', (ctx) => { ctx.CLOUD.ready = new Promise((r) => { r2 = r; }); }));
  const half = { answers: { 0: 1 }, done: false, startedAt: new Date(NOW - MIN).toISOString() };
  other.e.ls.set(PRE + 'diag', J(half));
  r2(other.e.ctx.CLOUD.user); await settle();
  eq([JSON.parse(other.e.ls.get(PRE + 'diag')).answers, quiz(other)], [{ 0: 1 }, true], '別的分頁先開考');
  /* 已經有作答或報告:照原本接著做或看報告,不重開;參數照樣拿掉 */
  const cont = diagPage(ip, half, null, url('?start=1'));
  eq([JSON.parse(cont.e.ls.get(PRE + 'diag')).answers, cont.e.ctx.__replaced, quiz(cont), loading(cont)], [{ 0: 1 }, '/diagnostic.html', true, false], '有作答');
  const done = { answers: ANS28(), done: true, startedAt: new Date(NOW - 20 * MIN).toISOString(), finishedAt: new Date(NOW).toISOString() };
  const rep = diagPage(ip, done, null, url('?start=1'));
  eq([rep.e.results.length, rep.e.ctx.__replaced, rep.e.ls.get(PRE + 'diag')], [1, '/diagnostic.html', rep.before], '有報告');
  /* 其他網址參數留著 */
  const keep = diagPage(ip, half, null, url('?start=1&x=2'));
  assert.equal(keep.e.ctx.__replaced, '/diagnostic.html?x=2');
};

/* ---------- 各頁的接點(原始檔) ---------- */
T['B6 index.html:首屏「先測程度」連 start.html;#onboard-home 建立時帶 data-nosnippet 與 hidden、在每日練習卡後面的格線裡;onboard 三檔在 paywall.js 之後'] = () => {
  const idx = read('index.html');
  assert.ok(idx.indexOf('<a class="btn-text" href="start.html">先測程度</a>') > -1);
  assert.ok(idx.indexOf('href="diagnostic.html">先測程度') < 0);
  const m = /<section id="onboard-home"[^>]*>/.exec(idx);
  assert.ok(m, '沒有 #onboard-home');
  assert.ok(/data-nosnippet/.test(m[0]) && /\shidden[\s>]/.test(m[0]) && /class="daily-card ob-home"/.test(m[0]));
  const grid = idx.slice(idx.indexOf('<div class="home-grid">'), idx.indexOf('<section class="home-dir"'));
  assert.ok(grid.indexOf('id="daily-home"') > -1 && grid.indexOf(m[0]) > grid.indexOf('id="daily-home"'), '在格線裡、每日練習卡後面');
  const s = scriptsOf('index.html');
  const i = s.indexOf('js/paywall.js');
  ['js/onboard-core.js', 'js/onboard-data.js', 'js/onboard-ui.js'].forEach((f, k, a) => {
    assert.ok(s.indexOf(f) > i, f + ' 要在 paywall.js 之後');
    if (k) assert.ok(s.indexOf(f) > s.indexOf(a[k - 1]), f + ' 順序');
  });
  assert.ok(s.indexOf('js/ui.js') > -1 && s.indexOf('js/ui.js') < s.indexOf('js/onboard-ui.js'));
  assert.ok(s.indexOf('js/onboard.js') < 0, '首頁不載 start.html 的流程檔');
};
T['B7 me.html、diagnostic.html、admin.html 的載入順序;profile.js 接學習設定'] = () => {
  const me = scriptsOf('me.html');
  assert.ok(me.indexOf('js/onboard-core.js') > me.indexOf('js/classes.js') && me.indexOf('js/onboard-ui.js') < me.indexOf('js/me.js'));
  assert.ok(me.indexOf('js/onboard-data.js') > me.indexOf('js/onboard-core.js') && me.indexOf('js/onboard-ui.js') > me.indexOf('js/onboard-data.js'));
  const dg = scriptsOf('diagnostic.html');
  assert.ok(dg.indexOf('js/onboard-core.js') > dg.indexOf('js/paywall.js'), '檢測頁:在 paywall.js 之後');
  assert.ok(dg.indexOf('js/onboard-ui.js') > dg.indexOf('js/onboard-data.js') && dg.indexOf('js/onboard-ui.js') < dg.indexOf('js/diagnostic.js'), '在 diagnostic.js 之前(結算卡開頁就畫)');
  const ad = scriptsOf('admin.html');
  assert.ok(ad.indexOf('js/onboard-core.js') > -1 && ad.indexOf('js/onboard-core.js') < ad.indexOf('js/admin.js'));
  const p = read('js/profile.js');
  const ra = p.slice(p.indexOf('function renderAccount'), p.indexOf('function renderAccount') + 4000);
  assert.ok(/links,\s*\n?\s*window\.ONBOARD_UI \? ONBOARD_UI\.settingsSection\(\) : null,/.test(ra), 'links 之後接學習設定');
  assert.ok(ra.indexOf('ONBOARD_UI.settingsSection') < ra.indexOf('CLASSES.section'));
};
T['B8 教師後台:「起始程度」欄在檢測結果後、內容用 levelsLabel;表頭格數、每列格數、展開列 colspan 一樣(9)'] = () => {
  const a = read('js/admin.js');
  assert.ok(/h\('th', null, '檢測結果'\), h\('th', null, '起始程度'\)/.test(a));
  assert.ok(a.indexOf("ONBOARD_CORE.levelsLabel(s.keys['levels'])") > -1);
  const tbl = a.slice(a.indexOf("const table = h('table', { class: 'cat-table' }"), a.indexOf('table.append(row, detailRow)'));
  const head = tbl.slice(0, tbl.indexOf('ids.forEach'));
  const row = tbl.slice(tbl.indexOf("const row = h('tr'"), tbl.indexOf('const wb ='));
  const nTh = (head.match(/h\('th'/g) || []).length, nTd = (row.match(/h\('td'/g) || []).length;
  const span = /colspan: '(\d+)'/.exec(tbl);
  eq([nTh, nTd, span && Number(span[1])], [9, 9, 9]);
};
/* 真的 js/admin.js 載進沙盒(假 DOM、假的雲端回 rows),回學生表 */
async function adminTable(rows) {
  const dom = miniDom();
  const append = dom.N.prototype.append;   // 同瀏覽器:append 字串或 null 會變成文字
  dom.N.prototype.append = function (...ns) { return append.apply(this, ns.map((n) => (n && typeof n === 'object' ? n : dom.document.createTextNode(String(n))))); };
  const root = dom.document.createElement('div'); dom.body.append(root);
  const ctx = { console: { log() {}, warn() {}, error() {} }, document: dom.document, Promise, Date, Object, Array, Set, Map, JSON, Math, String, Number, setTimeout,
    TOEIC: {}, $: (s) => (s === '#admin-root' ? root : null), location: { reload() {} } };
  ctx.window = ctx;
  ctx.CLOUD = { enabled: true, user: { id: 'teacher-1' }, isTeacher: true, ready: Promise.resolve(), access: null,
    client: { from: () => ({ select: () => Promise.resolve({ data: rows, error: null }) }) } };
  vm.createContext(ctx);
  vm.runInContext((read('js/common.js').match(/function h\(tag[\s\S]*?\n}\r?\n/) || [''])[0], ctx);
  ['js/onboard-core.js', 'js/lesson-core.js', 'js/admin.js'].forEach((f) => vm.runInContext(read(f), ctx));
  await settle();
  return root.querySelector('table');
}
T['B8b 教師後台「目前堂號」:名單上有學生有 plan 才多這一欄(起始程度後面、10 欄、展開列跨 10);值:沒有 plan「—」、第 n 堂、24 堂完成「完成」、第 2 期看 les_t2_'] = async () => {
  const at = (d) => '2026-11-' + d + 'T00:00:00Z';
  const row = (u, k, v, d) => ({ user_id: u, k, v, updated_at: at(d || 20) });
  const base = [row('s1', '_meta', { name: '甲' }, 23), row('s2', '_meta', { name: '乙' }, 22), row('s3', '_meta', { name: '丙' }, 21)];
  const shape = (t) => [t.children[0].children.length, t.children[1].children.length, Number(t.children[2].children[0].getAttribute('colspan'))];
  const plain9 = await adminTable(base);
  eq([shape(plain9), plain9.children[0].children[4].textContent], [[9, 9, 9], 'Part 5'], '都沒有 plan:跟以前一樣');
  const done24 = Array.from({ length: 24 }, (_, i) => row('s3', 'les_t2_' + String(i + 1).padStart(2, '0'), { doneAt: 1 }));
  const t = await adminTable(base.concat([row('s1', 'plan', { v: 1, term: 1 }), row('s1', 'les_t1_01', { startedAt: 1, doneAt: 2 }), row('s1', 'les_t1_02', { startedAt: 3, doneAt: null }),
    row('s3', 'plan', { v: 1, term: 2 })], done24));
  eq([shape(t), t.children[0].children[3].textContent, t.children[0].children[4].textContent], [[10, 10, 10], '起始程度', '目前堂號']);
  const cells = [1, 3, 5].map((i) => [t.children[i].children[0].children[0].textContent, t.children[i].children[4].textContent]);
  eq(cells, [['甲', '第 2 堂'], ['乙', '—'], ['丙', '完成']]);
};
T['B9 隱私權政策:學習設定一節(蒐集目的整句照指定字樣,不提課表、學習包、題目難易度);Cookie 段補沒登入時的暫存與 7 天;未成年節不動;生效日期換成上線那天'] = () => {
  const p = read('privacy.html');
  const cookie = p.slice(p.indexOf('<h2>Cookie 與裝置上的儲存</h2>'), p.indexOf('<h2>資料安全</h2>'));
  assert.ok(/沒登入時填的目標分數、考試月份與成績只存在這台裝置，7 天後不再使用並自動刪除；登入後改存進帳號。/.test(cookie));
  const sec = p.slice(p.indexOf('<h2 id="learning">學習設定與程度檢測</h2>'), p.indexOf('<h2>你的權利</h2>'));
  assert.ok(sec.length > 40, '有學習設定一節,在「你的權利」之前');
  /* 蒐集目的整句比對:只寫判斷起始程度、推薦練習(跟 S1 頁尾同一個說法),不寫網站還沒有的用途 */
  assert.ok(sec.indexOf('<p>開始使用時，本站會問你的多益目標分數、預計考試月份與英文程度，用來判斷起始程度、推薦適合的練習，不用在其他用途。蒐集者與聯絡方式同本頁開頭。</p>') > -1);
  assert.ok(read('js/onboard.js').indexOf("'回答只用來判斷起始程度、推薦適合的練習。'") > -1, 'S1 頁尾同一個說法');
  assert.ok(!/課表|學習包|難易度/.test(p), '不寫還沒做的功能');
  assert.ok(/<h2>未成年人<\/h2>\r?\n    <p>未滿 18 歲的使用者，請在家長或監護人同意後再註冊並提供個人資料。<\/p>/.test(p));
  assert.ok(p.indexOf('2026 年 11 月 24 日起適用') > -1, '生效日期是加上學習設定一節、上線的那天');
};
T['B10 樣式:首頁卡藏起來時不佔位、不影響每日練習的間距;主按鈕用 --fs-btn;不再有檢測頁那一列'] = () => {
  const css = read('css/style.css');
  const sec = css.slice(css.indexOf('/* ==== 新用戶設定起始程度'));
  assert.ok(sec.length > 100, '有這一段');
  assert.ok(/\.ob-home\[hidden\] \{ display: none; \}/.test(sec));
  assert.equal(/\.ob-home[^{]*\+ \.daily-home/.test(css), false, '卡在每日練習後面,不動它的間距');
  assert.ok(/\.ob-actions \.btn\.primary \{[^}]*font-size: var\(--fs-btn\)/.test(sec));
  assert.equal(/\.ob-diag-row|\.ob-dlg|is-pending/.test(sec), false);
  assert.equal(/\u7d93\u71df\u8005/.test(sec), false);
};
T['B11 start.html 的畫面不直接 append(原生 append(null) 會印出 null):一律經過 put 濾掉'] = () => {
  const s = read('js/onboard.js');
  eq(s.split('root.append(').length - 1, 1);
  assert.ok(s.indexOf('const put = (...nodes) => root.append(...nodes.filter(Boolean));') > -1);
};

/* ---------- 跑 ---------- */
(async () => {
  let pass = 0;
  const names = Object.keys(T);
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
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
