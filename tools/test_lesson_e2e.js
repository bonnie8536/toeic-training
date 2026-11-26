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
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');
const STUB = require('./fixtures/lesson_cloud_stub.js');
const K = require('./lesson_kit.js');
const H = require('./sync_harness');

const REPO = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const PORT = Number(opt('--port')) || 8971, BASE_PORT = PORT + 1, DEBUG = Number(opt('--debug-port')) || PORT + 2;
const TMP = path.resolve(opt('--tmp') || os.tmpdir());
const BASE = opt('--base') ? path.resolve(opt('--base')) : null;
const SHOTS = opt('--shots') ? path.resolve(opt('--shots')) : null;
const ONLY = opt('--only') || '';
/* Chrome 或 Edge:從 Windows 的程式資料夾環境變數找(不寫死磁碟路徑) */
const PF = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean);
const CHROME = [].concat(...PF.map((d) => [path.join(d, 'Google/Chrome/Application/chrome.exe'), path.join(d, 'Microsoft/Edge/Application/msedge.exe')]))
  .find((p) => fs.existsSync(p));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.webp': 'image/webp' };
const J = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY_MS = 864e5;
const { EE, TT, TE } = K;

/* ---------- 帳號與班級 ---------- */
const PILOT = 'aaaaaaaa-1111-4222-8333-000000000001', OTHER = 'bbbbbbbb-1111-4222-8333-000000000002';
const user = (n, name) => ({ id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), email: 's' + n + '@example.com', user_metadata: { name } });
const pidOf = (u) => 'c' + u.id.replace(/-/g, '');
const LV = (lv) => Object.assign({ source: { listening: 'score', reading: 'score' }, setAt: '2026-11-01T00:00:00.000Z', history: [] }, lv);
const ONBOARD = { v: 1, status: 'done', step: 'result', path: 'self', updatedAt: '2026-11-01T00:00:00.000Z' };

/* ---------- 時鐘(所有頁面與假雲端共用):真的時間往後撥 OFF 毫秒 ---------- */
let OFF = 0;
const nowMs = () => Date.now() + OFF;
const pages = new Set();
async function advance(ms) {
  OFF += ms;
  for (const p of pages) { try { await p.clock(ms); } catch (e) { /* 換頁中:新頁面會用新的時鐘 */ } }
}

/* ---------- 伺服器 ---------- */
const SV = { cloud: null, paid: false, failPacks: false, classDelay: 0 };
function serve(root, port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      if (SV.cloud && STUB.serveCloud(SV.cloud, req, res, SV.classDelay)) return;
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      const send = (body, type) => { res.writeHead(200, { 'Content-Type': type || TYPES['.js'], 'Cache-Control': 'no-store' }); res.end(body); };
      if (p === '/js/cloud-config.js') return send("window.CLOUD_CONFIG = { url: 'https://fakeproj.supabase.co', anonKey: 'x' };");
      if (p === '/sw.js' || (SV.failPacks && p.startsWith('/data/packs/'))) { res.writeHead(404); return res.end(); }
      const file = path.join(root, p);
      if (!path.resolve(file).startsWith(root)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        if (p === '/js/packs-config.js') return send(String(buf).replace(/window\.PACKS_PILOT_CLASSES = \[[^\]]*\];/,'window.PACKS_PILOT_CLASSES = ' + J([PILOT]) + ';'));
        if (p === '/js/plans-config.js' && SV.paid) return send(String(buf).replace('window.PAID_UI = false;', 'window.PAID_UI = true;'));
        send(buf, TYPES[path.extname(file)] || 'application/octet-stream');
      });
    });
    srv.on('error', (e) => reject(new Error('埠 ' + port + ' 不能用(' + e.code + '),換 --port')));
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

/* ---------- Chrome 與 CDP ---------- */
let B = null, chrome = null, chromeDir = null;
async function launch() {
  chromeDir = fs.mkdtempSync(path.join(TMP, 'lesson-e2e-'));
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + DEBUG, '--user-data-dir=' + chromeDir, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 75; i++) {
    try { const r = await fetch('http://127.0.0.1:' + DEBUG + '/json/version'); if (r.ok) return connect((await r.json()).webSocketDebuggerUrl); } catch (e) { /* 還沒好 */ }
    await sleep(200);
  }
  throw new Error('Chrome 沒有啟動');
}
function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map(), subs = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); return; }
    if (msg.sessionId && subs.has(msg.sessionId)) subs.get(msg.sessionId)(msg);
  };
  const send = (method, params, sessionId) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(J(Object.assign({ id: i, method, params: params || {} }, sessionId ? { sessionId } : {}))); });
  return new Promise((resolve, reject) => { ws.onopen = () => resolve({ ws, send, subs }); ws.onerror = reject; });
}

/* 頁面裡的小幫手:__screen() 認出現在是哪個畫面;__step() 做一步(有確認視窗按確定、沒選的選項選第 __choice 個、按主按鈕) */
const ROBOT = `(() => {
  if (window.__step) return;
  const vis = (e) => !!e && !e.disabled && e.offsetParent !== null;
  const txt = (e) => ((e && e.textContent) || '').trim();
  window.__screen = () => {
    if (document.querySelector('.ui-dialog')) return 'dialog';
    const r = document.getElementById('lsn-root');
    if (!r) return 'page';
    const q = (s) => r.querySelector(s);
    const list = [['.lsn-steps', 'overview'], ['.ui-empty', 'empty'], ['.lsn-tip', 'tip'], ['.lsn-words-wrap', 'cards'], ['.lsn-wq', 'wordquiz'], ['.lsn-bridge', 'bridge'],
      ['.lsn-block-result', 'block'], ['.lsn-grammar', 'grammar'], ['.lsn-intro', 'intro'], ['.lsn-pre-step', 'prestep'], ['.lsn-list', 'lessons'], ['.result-card', 'result']];
    for (const [s, name] of list) if (q(s)) return name;
    if (document.querySelector('.mock-timer')) return 'test';
    if (q('.write-area, .pair-btn')) return 'ear';
    if (document.querySelector('.quiz-close')) return 'quiz';
    return q('.lsn-loading') ? 'loading' : 'other';
  };
  window.__step = () => {
    const dlg = document.querySelector('.ui-dialog .ui-dialog-ok');
    if (dlg) { dlg.click(); return 'dialog'; }
    const s = window.__screen();
    if (['overview', 'empty', 'loading', 'lessons', 'page'].indexOf(s) > -1) return 'idle:' + s;
    const r = document.getElementById('lsn-root');
    const ta = r.querySelector('textarea.write-area');
    if (ta && !ta.value && !ta.disabled) { ta.value = 'a'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    const groups = new Map();
    r.querySelectorAll('.opt, .letter-big, .pair-btn').forEach((b) => {
      if (b.offsetParent === null || b.closest('.lsn-review, .result-detail')) return;
      const g = b.closest('.opts, .letter-row, .pair-row') || b.parentElement;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(b);
    });
    for (const bs of groups.values()) {
      if (bs.some((b) => b.disabled || b.getAttribute('aria-pressed') === 'true' || /(^| )(picked|correct|wrong)( |$)/.test(b.className))) continue;
      bs[(window.__choice || 0) % bs.length].click();
      return 'pick';
    }
    const foot = document.querySelector('.quiz-foot .btn.primary');
    if (vis(foot)) { foot.click(); return 'next:' + txt(foot); }
    const act = Array.from(document.querySelectorAll('.quiz-act')).filter((b) => txt(b) === '交卷' && vis(b))[0];
    if (act) { act.click(); return 'submit'; }
    const go = Array.from(r.querySelectorAll('button.btn.primary')).filter((b) => vis(b) && !b.classList.contains('player-btn'))[0];
    if (go) { go.click(); return 'go:' + txt(go); }
    return 'idle:' + s;
  };
})()`;

/* 一個分頁。o = { ctx(沿用的設定檔), mobile, touch, seed(localStorage), url, origin } */
async function tab(u, o) {
  const ctx = o.ctx || (await B.send('Target.createBrowserContext', { disposeOnDetach: true })).result.browserContextId;
  const targetId = (await B.send('Target.createTarget', { url: 'about:blank', browserContextId: ctx })).result.targetId;
  const sid = (await B.send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  const send = (m, p) => B.send(m, p, sid);
  const origin = o.origin || 'http://127.0.0.1:' + PORT;
  const p = { u, ctx, sid, send, origin, errors: [], clockId: null, size: o.mobile ? [375, 812, true] : [1280, 900, false] };
  B.subs.set(sid, (msg) => {
    if (msg.method === 'Runtime.exceptionThrown') p.errors.push((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') p.errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
  });
  p.eval = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error('頁面錯誤:' + J(r.result.exceptionDetails).slice(0, 400));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  p.metrics = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  p.clock = async (ms) => {
    if (p.clockId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: p.clockId });
    p.clockId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB.clockScript(OFF) })).result.identifier;
    if (ms) await p.eval('window.__clockAdd ? (__clockAdd(' + ms + '), true) : true');
  };
  /* 換頁前在舊頁放記號,記號不見(新頁)而且載完才算:機器忙的時候舊頁可能還沒開始換,不能只看 readyState */
  p.mark = () => p.eval('window.__oldPage = true').catch(() => null);
  p.loaded = async () => { for (let i = 0; i < 200; i++) { try { if ((await p.eval('!window.__oldPage && document.readyState')) === 'complete') return; } catch (e) { /* 換頁中 */ } await sleep(100); } throw new Error('頁面沒載完'); };
  p.settle = async (ms) => { await p.eval('window.CLOUD && CLOUD.ready ? CLOUD.ready.then(() => true, () => true) : true'); await sleep(ms === undefined ? 900 : ms); };
  p.go = async (url, ms) => { await p.mark(); await send('Page.navigate', { url: p.origin + '/' + url }); await sleep(200); await p.loaded(); await p.settle(ms); };
  p.reload = async () => { await p.mark(); await send('Page.reload', {}); await sleep(300); await p.loaded(); await p.settle(); };
  p.wait = async (expr, what, ms) => {
    for (let i = 0; i < (ms || 15000) / 100; i++) { try { if (await p.eval(expr)) return; } catch (e) { /* 換頁中 */ } await sleep(100); }
    throw new Error('等不到:' + (what || expr));
  };
  p.text = (sel) => p.eval('(() => { const e = document.querySelector(' + J(sel) + '); return e ? e.textContent.trim() : null; })()');
  p.click = (sel) => p.eval('(() => { const e = document.querySelector(' + J(sel) + '); if (!e) return false; e.click(); return true; })()');
  p.screen = () => p.eval(ROBOT + ';window.__screen()');
  p.step = () => p.eval(ROBOT + ';window.__step()');
  p.close = async () => { pages.delete(p); B.subs.delete(sid); await B.send('Target.closeTarget', { targetId }); };
  await send('Page.enable'); await send('Runtime.enable');
  await p.metrics(...p.size);
  if (o.touch) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB.sdkScript(u) });
  await p.clock(0);
  pages.add(p);
  if (!o.ctx) {
    await p.go('robots.txt', 0);
    const seed = Object.assign(u ? { tr_current_profile: J(pidOf(u)) } : {}, o.seed);
    await p.eval('Object.entries(' + J(seed) + ').forEach(([k, v]) => localStorage.setItem(k, v)); true');
  }
  if (o.url) await p.go(o.url);
  return p;
}

/* ---------- 截圖:每個畫面 375 與 1280 兩張 ---------- */
const NAMES = {};
async function shot(p, name) {
  if (!SHOTS || NAMES[name]) return;
  NAMES[name] = true;
  fs.mkdirSync(SHOTS, { recursive: true });
  /* 小幫手用 element.click() 作答,不是真的滑鼠或手指,Chrome 會把之後程式移過去的焦點畫成鍵盤焦點框;
     手指操作不會畫(第 7 條驗過)。截圖照手指操作的樣子:拍照時不畫鍵盤焦點框 */
  await p.eval("(() => { const s = document.createElement('style'); s.id = '__shot'; s.textContent = ':focus-visible { outline: none !important; }'; document.head.append(s); return true; })()");
  for (const [w, h, mobile] of [[375, 812, true], [1280, 900, false]]) {
    await p.metrics(w, h, mobile);
    await sleep(500);
    const full = Math.min(3200, Math.max(h, Number(await p.eval('Math.ceil(document.documentElement.scrollHeight)')) || h));
    /* 整頁截圖:視窗拉到整頁高(只拉一次,專心模式的頁面高度跟著視窗長),固定在底部的作答列才會在頁面最下面,
       不然會疊在第一個視窗的底部、蓋住中間的內容 */
    if (full > h) { await p.metrics(w, full, mobile); await sleep(400); }
    const r = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: full, scale: 1 } });
    fs.writeFileSync(path.join(SHOTS, name + '_' + w + '.png'), Buffer.from(r.result.data, 'base64'));
  }
  await p.eval("(() => { const s = document.getElementById('__shot'); if (s) s.remove(); return true; })()");
  await p.metrics(...p.size);
  await sleep(300);
}

/* ---------- 走一段:用小幫手作答,遇到 shots 裡的畫面先截圖;until(畫面) 成立就停;overview 時按主按鈕繼續(goOn) ---------- */
async function drive(p, o) {
  let idle = 0, last = '';
  for (let i = 0; i < (o.max || 1500); i++) {
    const s = await p.screen().catch(() => 'nav');
    if (o.shots && o.shots[s]) {
      const name = typeof o.shots[s] === 'function' ? await o.shots[s](p) : o.shots[s];
      if (name) { await (o.before ? o.before(s) : null); await shot(p, name); }
    }
    if (o.until(s)) return s;
    if (s === 'overview' && o.goOn) { await p.click('.lsn-go'); await sleep(400); continue; }
    const did = await p.step().catch(() => 'nav');
    if (/^idle/.test(did)) { idle = did === last ? idle + 1 : 0; if (idle > 80) throw new Error('卡在 ' + did); await sleep(150); }
    else { idle = 0; await sleep(o.pace || 120); }
    last = did;
  }
  throw new Error('走太多步');
}
const countOf = async (p) => { const t = await p.text('.quiz-count'); const m = /(\d+)\s*\/\s*(\d+)/.exec(t || ''); return m ? [Number(m[1]), Number(m[2])] : null; };
const les = async (p, no) => p.eval('store.get(' + J('les_t1_' + String(no).padStart(2, '0')) + ', null)');
const noErrors = (p, what) => assert.deepStrictEqual(p.errors, [], (what || '') + ' console 有錯誤:' + J(p.errors).slice(0, 600));

/* ---------- 假雲端與種子 ---------- */
function freshCloud(o) {
  const c = STUB.createCloud(Object.assign({ now: nowMs }, o));
  SV.cloud = c;
  return c;
}
function seedUser(c, u, keys) { Object.keys(keys).forEach((k) => c.put(u.id, k, keys[k], new Date(nowMs() - DAY_MS).toISOString())); }
/* 第 1..n 堂已上完(兩天前)、plan:用真的 pack-core 選題 */
async function seedDone(c, u, lv, n) {
  const t = Math.floor(nowMs() / 1000) - 2 * 86400;
  const e = K.env({ bank: true, now: t });
  await e.D.packs();
  for (let no = 1; no <= n; no++) {
    const lesson = e.lesson(lv, no), cx = e.D.ctx(lesson, t);
    let s;
    if (lesson.kind === 'test') { const f = await e.D.testForm(cx); s = [0, 1].reduce((a, i) => e.P.freeze(a, i, f[i], t), e.P.newState(lesson, t)); }
    else s = (await e.P.pickFixed(lesson, e.P.newState(lesson, t), cx)).state;
    s = lesson.segments.reduce((a, x) => e.P.setSegment(a, lesson, x.slot, 'done', t + 600), s);
    c.put(u.id, e.P.lessonKey(1, no), JSON.parse(J(s)), new Date((t + 700) * 1000).toISOString());
  }
  c.put(u.id, 'plan', { v: 1, source: 'self', classId: PILOT, packs: {}, packVersions: {}, startDate: '2026-11-01', lessonsPerWeek: null, mainDay: 1, extDay: null,
    term: 1, postponedWeeks: 0, previous: null, updatedAt: nowMs() - 2 * DAY_MS });
}
const pilotUser = (c, u, lv) => { c.members[u.id] = [{ id: PILOT, name: '試行班' }]; seedUser(c, u, { onboard: ONBOARD, levels: LV(lv) }); };

const T = {};
/* ---------- 1. 非試行學生 ---------- */
/* main 的內容:拿掉 style 與 canvas 的 width、height(畫圖的時機不一定,分頁在背景時可能還沒畫) */
const MAIN = "(() => { const m = document.querySelector('main'); return m ? m.innerHTML.replace(/ style=\"[^\"]*\"/g, '').replace(/(<canvas[^>]*?) width=\"\\d+\" height=\"\\d+\"/g, '$1').replace(/\\s+/g, ' ') : ''; })()";
/* 畫面停下來(隔 700 毫秒讀兩次一樣)才比:機器忙的時候,班級、小雞這些晚到的區塊還在畫 */
async function settled(p) {
  let last = null;
  for (let i = 0; i < 20; i++) { const now = await p.eval(MAIN); if (now === last) return now; last = now; await sleep(700); }
  return last;
}
const firstDiff = (x, y) => { let k = 0; while (k < x.length && x[k] === y[k]) k++; return k; };
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

/* ---------- 2. 試行甲(入門)、乙(門檻)走第 1–4 堂 ---------- */
/* 技巧卡截 P1、P5、P7 三張(其他 Part 不截):照標題對回 TIP_CARDS 的 part */
const TIP_PART = "(() => { const h = document.querySelector('.lsn-tip-h'); const c = h && (window.TIP_CARDS || { cards: [] }).cards.filter((x) => x.title === h.textContent.trim())[0]; return c ? c.part : null; })()";
const tipShot = async (p) => { const part = await p.eval(TIP_PART); return ['P1', 'P5', 'P7'].indexOf(part) > -1 ? '09_技巧卡_' + part : null; };
const SHOT_LESSON = { tip: tipShot, cards: '10_單字字卡', wordquiz: '11_單字小考', bridge: '12_過場', block: '13_區塊結果與逐題解析', grammar: '14_文法單元', ear: '15_英語耳', prestep: '20_前測檢討', intro: '21_小檢核' };
async function openDetail(p, s) { if (s === 'block') { await p.eval("(() => { const d = document.querySelector('.lsn-block-result details'); if (d) d.open = true; return true; })()"); await sleep(300); } }
/* 版面:段落總覽每段一列(記號在段名左邊、同一列);課程總覽不能上的列沒有記號(兩頁的樣式表撞名時會跑掉) */
async function stepsLayout(p) {
  const bad = await p.eval(`[...document.querySelectorAll('.lsn-step')].filter((li) => {
    const m = li.querySelector('.lsn-step-mark').getBoundingClientRect(), n = li.querySelector('.lsn-step-name').getBoundingClientRect();
    return !(m.right <= n.left && Math.abs((m.top + m.bottom) / 2 - (n.top + n.bottom) / 2) < 14 && li.getBoundingClientRect().height < 80);
  }).map((li) => li.textContent)`);
  assert.deepStrictEqual(bad, [], '段落總覽排錯的段');
}
async function finishLesson(p, no, shots) {
  await p.go('lesson.html?no=' + no);
  await p.wait("document.querySelector('.lsn-steps')", '第 ' + no + ' 堂總覽');
  if (no === 2) await stepsLayout(p);
  if (shots && no === 2) await shot(p, '08_段落總覽');
  const intro = shots && no === 4 ? Object.assign({}, SHOT_LESSON) : Object.assign({}, SHOT_LESSON, { intro: null });
  await drive(p, { goOn: true, shots: shots ? intro : null, before: (s) => openDetail(p, s), until: (s) => s === 'result' });
  assert.ok((await les(p, no)).doneAt, '第 ' + no + ' 堂沒有完成');
  assert.strictEqual(await p.text('.result-card .result-go'), '繼續');
}
/* 第 1 堂:聽力答 n 題 → (甲)重新整理接著做 → 快轉到剩 5 分 → 時間到;閱讀開始頁 → 答幾題 → 時間到 → 前測結果 */
async function pretest(p, shots) {
  await p.go('start.html?step=result');
  await p.wait("(() => { const a = document.querySelector('.result-card .result-go'); return a && a.textContent.trim() === '開始第 1 堂'; })()", '開始第 1 堂');
  if (shots) await shot(p, '05_S8_試行');
  await p.mark(); await p.click('.result-card .result-go');
  await sleep(300); await p.loaded(); await p.settle();
  await p.wait("document.querySelector('.lsn-steps')", '第 1 堂總覽');
  assert.deepStrictEqual(await p.eval("[...document.querySelectorAll('.lsn-rule')].map((e) => e.textContent)"), ['每題音檔只播一次', '開始後不能回上一題']);
  if (shots) await shot(p, '16_前測開始頁');
  await p.click('.lsn-go');
  await p.wait("document.querySelector('.mock-timer')", '前測作答');
  if (shots) await shot(p, '17_前測作答');
  while ((await countOf(p))[0] < 11) { await p.step(); await sleep(150); }
  const before = await p.text('.mock-timer');
  await p.reload();
  await p.wait("document.querySelector('.lsn-steps')", '重新整理後的總覽');
  assert.match(await p.text('.lsn-step.is-current .lsn-step-min'), /^剩 \d+ 分鐘$/);
  await p.click('.lsn-go');
  await p.wait("document.querySelector('.mock-timer')", '接著做');
  assert.deepStrictEqual((await countOf(p))[0], 11, '接著做從第 11 題');
  const secs = (t) => { const m = /(\d+):(\d+)/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  const left = secs(await p.text('.mock-timer'));
  assert.ok(Math.abs(left - secs(before)) <= 8, '倒數接著剩餘時間:' + before + ' → ' + left);
  await advance((left - 280) * 1000);
  await p.wait("document.querySelector('.mock-timer.low')", '剩不到 5 分鐘變紅');
  if (shots) await shot(p, '18_倒數剩5分');
  await advance(300 * 1000);
  await p.wait("document.querySelector('.lsn-note')", '聽力時間到的通知');
  assert.strictEqual(await p.text('.lsn-note'), '聽力測驗時間到');
  await p.click('.lsn-go');
  await p.wait("document.querySelector('.lsn-intro')", '閱讀測驗開始頁');
  if (shots) await shot(p, '16b_閱讀測驗開始頁');
  await p.click('.lsn-intro .lsn-go');
  await p.wait("document.querySelector('.mock-timer')", '閱讀作答');
  for (let i = 0; i < 6; i++) { await p.step(); await sleep(150); }
  await advance(40 * 60 * 1000);
  await p.wait("document.querySelector('.result-card')", '前測結果');
  const res = await p.eval("document.querySelector('#lsn-root').textContent");
  assert.ok(/前測完成/.test(res) && /時間到/.test(res) && /暫用試卷/.test(res) && /不能跟之後的測驗直接比較/.test(res), res.slice(0, 200));
  assert.ok(!/分數|預估|\d+ 分(?!鐘)/.test(res), '前測結果不能有分數:' + res.slice(0, 300));
  assert.strictEqual(await p.eval("document.querySelectorAll('.lsn-parts li').length"), 7);
  const s = await snack(p);
  if (shots) await shot(p, '19_前測結果');
  return s;
}
/* 結算卡的點心那一行(js/pet-hook.js):拿到小番茄,或一天的份數拿滿了 */
async function snack(p) {
  await p.wait("(() => { const e = document.querySelector('.result-card .pet-earn'); return !!e && !!e.textContent.trim(); })()", '點心那一行');
  const t = await p.text('.result-card .pet-earn');
  assert.match(t, /^\+1 小番茄|份點心都拿到了/);
  return t;
}
async function homeCard(p) {
  await p.go('index.html', 1500);
  await p.wait("document.querySelector('.lsn-home #lsn-home-h') && !document.querySelector('.lsn-home-note')", '今天的課卡');
  return p.eval(`(() => { const c = document.querySelector('.lsn-home'), g = document.querySelector('.daily-go');
    return { h: c.querySelector('#lsn-home-h').textContent.trim(), tags: [...c.querySelectorAll('.mock-tag')].map((t) => t.textContent.trim()), go: (c.querySelector('.lsn-home-go') || {}).textContent || null,
      daily: !!g && getComputedStyle(g).display !== 'none' && g.offsetParent !== null, solid: [...document.querySelectorAll('main .btn.primary')].filter((b) => b.offsetParent !== null).length }; })()`);
}
async function walk(u, lv, shots) {
  const c = freshCloud();
  pilotUser(c, u, lv);
  const p = await tab(u, { url: 'index.html' });
  const h0 = await homeCard(p);
  assert.deepStrictEqual([h0.go, h0.daily, h0.solid], ['開始第 1 堂', false, 1]);
  if (shots) await shot(p, '01_首頁卡_可開始');
  const s1 = await pretest(p, shots);
  await p.mark(); await p.click('.result-card .result-go');
  await sleep(300); await p.loaded(); await p.settle();
  await p.wait("document.querySelector('.lsn-list')", '課程總覽');
  if (shots) await shot(p, '07_課程總覽');
  /* 第 2 堂:上完第一段先回首頁看「進行中」 */
  await p.go('lesson.html?no=2');
  await p.wait("document.querySelector('.lsn-steps')", '第 2 堂總覽');
  await p.click('.lsn-go');
  await p.wait("!document.querySelector('.lsn-steps')", '進第一段');
  for (let k = 0; k < 3; k++) { await p.step(); await sleep(300); }
  const mid = await homeCard(p);
  assert.ok(/^繼續第 2 堂$/.test(mid.go) && mid.solid === 1 && !mid.daily, J(mid));
  if (shots) await shot(p, '02_首頁卡_進行中');
  await finishLesson(p, 2, shots);
  const h3 = await homeCard(p);
  assert.deepStrictEqual([h3.tags, h3.go, h3.daily, h3.solid], [['明天開放'], null, true, 1], '第 3 堂明天開放:卡上沒有按鈕、每日練習卡的「開始」照常');
  if (shots) await shot(p, '03_首頁卡_明天開放');
  await p.go('lesson.html?no=3');
  await p.wait("document.querySelector('.ui-empty-text')", '第 3 堂明天開放');
  assert.strictEqual(await p.text('.ui-empty-text'), '第 3 堂明天開放');
  await advance(DAY_MS);
  await finishLesson(p, 3, shots);
  await finishLesson(p, 4, shots);
  /* 第 4 堂本堂結果:小檢核清單每列一個判定字;小檢核、小檢核解析的標題與清單沒有數字與 % */
  const cp = await p.eval(`(() => { const r = document.getElementById('lsn-root');
    const heads = [...r.querySelectorAll('h2, h3, summary')].map((e) => e.textContent.trim()).filter((t) => /^小檢核/.test(t));
    const rows = [...r.querySelectorAll('.lsn-verdicts li')].map((li) => li.textContent.trim());
    return { heads, rows }; })()`);
  assert.ok(cp.heads.length >= 2 && cp.rows.length > 0, J(cp));
  assert.ok(cp.heads.every((t) => !/[0-9%]/.test(t)) && cp.rows.every((t) => !/%|\d+\s*(題|分)/.test(t)), '小檢核不能有題數、分數與 %:' + J(cp));
  /* 照片描述、WH 問句、詞性各一列,三個考點都有判定:第 2、3 堂的練習先避開第 4 堂小檢核的預留題,照片描述不會被練習用完 */
  assert.ok(cp.rows.length === 3 && cp.rows.every((t) => /(達標|持平|弱點)$/.test(t)), J(cp.rows));
  const s4 = await snack(p);
  if (shots) await shot(p, '22_本堂結果');
  const h5 = await homeCard(p);
  assert.deepStrictEqual([h5.h, h5.go, h5.daily, h5.solid], ['第 5 堂尚未開放', null, true, 1]);
  if (shots) await shot(p, '04_首頁卡_尚未開放');
  await p.go('lessons.html');
  await p.wait("document.querySelector('.lsn-list')", '課程總覽');
  assert.deepStrictEqual(await p.eval("[...document.querySelectorAll('.lsn-list li')].slice(4, 6).map((li) => [li.textContent.includes('未開放'), !!li.querySelector('a')])"), [[true, false], [true, false]]);
  const offMarks = await p.eval("[...document.querySelectorAll('.lsn-row.is-off .lsn-mark')].map((m) => getComputedStyle(m).borderTopWidth + ' ' + getComputedStyle(m, '::before').content).filter((x) => x !== '0px none')");
  assert.deepStrictEqual(offMarks, [], '未開放的列不畫記號');
  await p.go('lesson.html?no=5');
  await p.wait("document.querySelector('.ui-empty-text')", '第 5 堂');
  assert.deepStrictEqual([await p.text('.ui-empty-text'), await p.text('.ui-empty-go')], ['第 5 堂尚未開放', '每日練習']);
  if (shots) await shot(p, '23_第5堂尚未開放');
  noErrors(p, lv.reading);
  await p.close();
  return '第 4 堂小檢核:' + cp.rows.join('、') + ';點心:前測結果「' + s1 + '」、第 4 堂「' + s4 + '」';
}
T['2 試行甲(入門):結果頁「開始第 1 堂」→ 前測(快轉)→ 第 2 堂 → 同一天第 3 堂明天開放 → 隔天第 3、4 堂 → 第 5 堂尚未開放'] = async () => {
  OFF = 0;
  return walk(user(21, '試行甲'), EE, true);
};
T['2 試行乙(門檻):同上'] = async () => {
  OFF = 0;
  return walk(user(22, '試行乙'), TT, false);
};
T['2 照片描述的題在課程外(刷題頁)全部做過、清單裡沒有沒做過的:第 4 堂小檢核說明頁寫「這次沒有照片描述的題」,本堂結果那一列「沒有出題」'] = async () => {
  OFF = 0;
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
  OFF = 0;
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
  OFF = 0;
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
  OFF = 0;
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
  OFF = 0;
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
  OFF = 0;
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
  OFF = 0;
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
  OFF = 0;
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
  const scripts = ['js/lesson-rules.js', 'js/pack-core.js'].map((f) => new vm.Script(fs.readFileSync(path.join(REPO, f), 'utf8'), { filename: f }));
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
  if (!CHROME) throw new Error('找不到 Chrome');
  fs.mkdirSync(TMP, { recursive: true });
  const srv = await serve(REPO, PORT);
  const base = BASE ? await serve(BASE, BASE_PORT) : null;
  let pass = 0, fail = 0;
  const names = Object.keys(T).filter((n) => !ONLY || ONLY.split('|').some((o) => n.indexOf(o) > -1));
  try {
    B = await launch();
    for (const n of names) {
      try { const note = await T[n](); pass++; console.info('PASS ' + n + (note ? '  →  ' + note : '')); }
      catch (e) {
        fail++;
        const at = e && e.stack ? (e.stack.split('\n').filter((l) => /test_lesson_e2e/.test(l))[0] || '').trim() : '';
        console.info('FAIL ' + n + '  →  ' + String(e && e.message ? e.message : e).replace(/\s+/g, ' ').slice(0, 1500) + (at ? '  ' + at : ''));
      }
      for (const p of Array.from(pages)) { try { await p.close(); } catch (e) { /* 已關 */ } }
    }
  } finally {
    try { B && B.ws.close(); } catch (e) { /* 已關 */ }
    if (chrome) { chrome.kill(); await sleep(800); }
    try { fs.rmSync(chromeDir, { recursive: true, force: true }); } catch (e) { console.warn('使用者資料夾沒刪掉:' + chromeDir); }
    srv.close(); if (base) base.close();
  }
  console.info(pass + ' / ' + names.length + ' 通過');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
