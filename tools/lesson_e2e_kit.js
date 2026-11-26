/* 課程頁無頭 Chrome 測試的共用函式(tools/test_lesson_e2e.js 與之後的頁面測試共用):本機伺服器(js/cloud-config.js 換成假的設定、
   js/packs-config.js 的試行班名單換成測試用的班、sw.js 回 404)、假雲端(tools/fixtures/lesson_cloud_stub.js)、假時鐘、Chrome 與 CDP、
   分頁、截圖、走一段(drive)、種好上完的堂(seedDone)、試行生走第 1–4 堂(walk)。不連外網、不用真的帳號。
   用法:const X = require('./lesson_e2e_kit.js');X.configure({ port, debug, tmp, shots });await X.start();…;await X.stop()。
   頁面裡的小幫手 __step():有沒選的選項就選(第 __choice 個;分頁開的時候給 smart(0–1),題庫回合照正解答對那麼多比例,
   答錯選正解的下一個)、有主按鈕就按(只按 button,不點離開課程頁的連結)。 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');
const STUB = require('./fixtures/lesson_cloud_stub.js');
const K = require('./lesson_kit.js');

const REPO = path.join(__dirname, '..');
/* Chrome 或 Edge:從 Windows 的程式資料夾環境變數找(不寫死磁碟路徑) */
const PF = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean);
const CHROME = [].concat(...PF.map((d) => [path.join(d, 'Google/Chrome/Application/chrome.exe'), path.join(d, 'Microsoft/Edge/Application/msedge.exe')]))
  .find((p) => fs.existsSync(p));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.webp': 'image/webp' };
const J = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY_MS = 864e5;
const { EE, TT } = K;
/* 設定(configure 給):伺服器的埠、Chrome 的埠、放 Chrome 使用者資料的資料夾、截圖資料夾(null 不截) */
let PORT = 8971, DEBUG = 8973, TMP = null, SHOTS = null;
function configure(o) {
  PORT = o.port; DEBUG = o.debug; TMP = o.tmp; SHOTS = o.shots || null;
}
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
const SV = { cloud: null, paid: false, failPacks: false, classDelay: 0, notFound: null };   // notFound:路徑符合這個正規式的檔回 404(例:音檔載不到)
function serve(root, port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      if (SV.cloud && STUB.serveCloud(SV.cloud, req, res, SV.classDelay)) return;
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      const send = (body, type) => { res.writeHead(200, { 'Content-Type': type || TYPES['.js'], 'Cache-Control': 'no-store' }); res.end(body); };
      if (p === '/js/cloud-config.js') return send("window.CLOUD_CONFIG = { url: 'https://fakeproj.supabase.co', anonKey: 'x' };");
      if (p === '/sw.js' || (SV.failPacks && p.startsWith('/data/packs/')) || (SV.notFound && SV.notFound.test(p))) { res.writeHead(404); return res.end(); }
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

/* 頁面裡的小幫手:__screen() 認出現在是哪個畫面;__step() 做一步(有確認視窗按確定、沒選的選項選第 __choice 個、按主按鈕)。
   window.__smart(0–1,分頁開的時候給)有值時,練習引擎的題庫回合照正解作答:引擎的入口 DRILL.startQuiz、LISTEN.startQuiz 包一層記下這一回合的題,
   照「第幾題 / 共幾題」找到現在這一題,每 10 題答對 __smart×10 題(固定順序),答錯選正解的下一個;其他畫面照 __choice */
const ROBOT = `(() => {
  ['DRILL', 'LISTEN'].forEach((name) => {
    const E = window[name];
    if (!E || E.__spy || typeof E.startQuiz !== 'function') return;
    const orig = E.startQuiz;
    window[name] = Object.assign({}, E, { __spy: true, startQuiz: function () {
      window.__units = name === 'DRILL' ? arguments[1] : (arguments[2] && arguments[2].units) || null;
      return orig.apply(E, arguments);
    } });
  });
  if (window.__step) return;
  const choose = (k, n) => {
    const fb = (window.__choice || 0) % n;
    if (!window.__smart || window.__screen() !== 'quiz' || !Array.isArray(window.__units)) return fb;
    const m = /(\\d+)\\s*\\/\\s*(\\d+)/.exec((document.querySelector('.quiz-count') || {}).textContent || '');
    const u = m ? window.__units[Number(m[1]) - 1] : null, item = u && (u.item || u);
    const q = item && Array.isArray(item.questions) ? item.questions[k] : item;
    if (!q || !Number.isInteger(q.answer)) return fb;
    window.__nAns = (window.__nAns || 0) + 1;
    return (window.__nAns * 7) % 10 < window.__smart * 10 ? q.answer % n : (q.answer + 1) % n;
  };
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
    const all = Array.from(groups.keys());
    for (const [g, bs] of groups) {
      if (bs.some((b) => b.disabled || b.getAttribute('aria-pressed') === 'true' || /(^| )(picked|correct|wrong)( |$)/.test(b.className))) continue;
      bs[choose(all.indexOf(g), bs.length)].click();
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

/* 一個分頁。o = { ctx(沿用的設定檔), mobile, touch, seed(localStorage), url, origin, smart(題庫回合照正解答對的比例,見 ROBOT) } */
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
  if (o.smart) await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__smart = ' + Number(o.smart) + ';' });
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
    term: 1, postponedWeeks: 0, previous: null, weeklyAskedAt: new Date(nowMs() - 2 * DAY_MS).toISOString(), updatedAt: nowMs() - 2 * DAY_MS });
}
const pilotUser = (c, u, lv) => { c.members[u.id] = [{ id: PILOT, name: '試行班' }]; seedUser(c, u, { onboard: ONBOARD, levels: LV(lv) }); };

/* ---------- 畫面比對(非試行學生的頁面跟上一版一樣) ---------- */
/* main 的內容:拿掉 style 與 canvas 的 width、height(畫圖的時機不一定,分頁在背景時可能還沒畫) */
const MAIN = "(() => { const m = document.querySelector('main'); return m ? m.innerHTML.replace(/ style=\"[^\"]*\"/g, '').replace(/(<canvas[^>]*?) width=\"\\d+\" height=\"\\d+\"/g, '$1').replace(/\\s+/g, ' ') : ''; })()";
/* 畫面停下來(隔 700 毫秒讀兩次一樣)才比:機器忙的時候,班級、小雞這些晚到的區塊還在畫 */
async function settled(p) {
  let last = null;
  for (let i = 0; i < 20; i++) { const now = await p.eval(MAIN); if (now === last) return now; last = now; await sleep(700); }
  return last;
}
const firstDiff = (x, y) => { let k = 0; while (k < x.length && x[k] === y[k]) k++; return k; };
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
/* 第 4 堂上完之後:第 5 堂尚未開放(入門) */
async function fiveClosed(p, shots) {
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
}
/* 第 4 堂上完之後:第 5 堂可以開始(門檻開放到第 8 堂)。第 3、4 堂同一天上的,第 5 堂當天是明天開放,先撥到隔天:
   首頁「開始第 5 堂」、總覽第 5 列可上、第 6 列還不能上、上課頁出段落總覽 */
async function fiveOpen(p) {
  const h4 = await homeCard(p);
  assert.deepStrictEqual([h4.tags, h4.go], [['明天開放'], null], '第 3、4 堂同一天:第 5 堂明天開放');
  await advance(DAY_MS);
  const h5 = await homeCard(p);
  assert.deepStrictEqual([h5.go, h5.daily, h5.solid], ['開始第 5 堂', false, 1], J(h5));
  await p.go('lessons.html');
  await p.wait("document.querySelector('.lsn-list')", '課程總覽');
  assert.deepStrictEqual(await p.eval("[...document.querySelectorAll('.lsn-list li')].slice(4, 6).map((li) => [li.textContent.includes('未開放'), !!li.querySelector('a')])"), [[false, true], [true, false]]);
  await p.go('lesson.html?no=5');
  await p.wait("document.querySelector('.lsn-steps')", '第 5 堂總覽');
}
/* 試行生從首頁走第 1–4 堂。o = { smart(題庫回合照正解答對的比例,見 ROBOT), open5(第 4 堂之後第 5 堂可以上) } */
async function walk(u, lv, shots, opt) {
  const o = opt || {};
  const c = freshCloud();
  pilotUser(c, u, lv);
  const p = await tab(u, { url: 'index.html', smart: o.smart });
  const h0 = await homeCard(p);
  assert.deepStrictEqual([h0.go, h0.daily, h0.solid], ['開始第 1 堂', false, 1]);
  if (shots) await shot(p, '01_首頁卡_可開始');
  const s1 = await pretest(p, shots);
  await p.mark(); await p.click('.result-card .result-go');
  await sleep(300); await p.loaded(); await p.settle();
  /* 第 1 堂上完第一次開課程總覽:先問每週上幾堂(之後再選:照每週 2 堂排) */
  await p.wait("document.querySelector('.lsn-weekly')", '每週上幾堂');
  await p.click('.lsn-weekly-later .btn-text');
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
  await (o.open5 ? fiveOpen(p) : fiveClosed(p, shots));
  const rate = await p.eval("window.LESSON_PLAN ? J(LESSON_PLAN.calibrationRates({ 2: store.get('les_t1_02'), 3: store.get('les_t1_03'), 4: store.get('les_t1_04') })) : ''".replace('J(', 'JSON.stringify('));
  noErrors(p, lv.reading);
  await p.close();
  return '第 2–4 堂第一次作答 ' + rate + ';第 4 堂小檢核:' + cp.rows.join('、') + ';點心:前測結果「' + s1 + '」、第 4 堂「' + s4 + '」';
}

/* ---------- 開始與結束 ---------- */
let SRV = null;
async function start() {
  if (!CHROME) throw new Error('找不到 Chrome');
  fs.mkdirSync(TMP, { recursive: true });
  SRV = await serve(REPO, PORT);
  B = await launch();
}
async function closeAll() { for (const p of Array.from(pages)) { try { await p.close(); } catch (e) { /* 已關 */ } } }
async function stop() {
  try { B && B.ws.close(); } catch (e) { /* 已關 */ }
  if (chrome) { chrome.kill(); await sleep(800); }
  try { if (chromeDir) fs.rmSync(chromeDir, { recursive: true, force: true }); } catch (e) { console.warn('使用者資料夾沒刪掉:' + chromeDir); }
  if (SRV) SRV.close();
}
const resetClock = () => { OFF = 0; };

module.exports = {
  REPO, J, sleep, DAY_MS, PILOT, OTHER, ONBOARD, SV, NAMES, pages, user, pidOf, LV, nowMs, advance, resetClock, serve, configure, start, stop, closeAll,
  tab, shot, drive, countOf, les, noErrors, freshCloud, seedUser, seedDone, pilotUser, settled, firstDiff, finishLesson, pretest, snack, homeCard, walk,
};
