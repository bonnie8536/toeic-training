/* 程度檢測頁的無頭 Chrome 走查:真的頁面、假雲端(tools/fixtures/lesson_cloud_stub.js,不連外網、不用真的帳號)、假的 Audio(很快播完,可以指定出錯)。
   每個寬度一個新帳號從開始頁做到結果頁:375×812(手機、觸控)與 1280×900。走到的每種畫面截一張圖,console 有錯就失敗。
   用法:node tools/e2e_placement.js --port <起始埠,用兩個> --tmp <放 Chrome 使用者資料的資料夾> [--shots <截圖資料夾>]
   使用者資料夾每次新開、跑完刪掉。 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');
const STUB = require('./fixtures/lesson_cloud_stub.js');

const REPO = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const PORT = Number(opt('--port')) || 8990, DEBUG = Number(opt('--debug-port')) || PORT + 1;
const TMP = path.resolve(opt('--tmp') || os.tmpdir());
const SHOTS = opt('--shots') ? path.resolve(opt('--shots')) : null;
const PF = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean);
const CHROME = [].concat(...PF.map((d) => [path.join(d, 'Google/Chrome/Application/chrome.exe'), path.join(d, 'Microsoft/Edge/Application/msedge.exe')])).find((p) => fs.existsSync(p));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain' };
const J = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let CLOUD = null;

function serve() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      if (CLOUD && STUB.serveCloud(CLOUD, req, res, 0)) return;
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      if (p === '/js/cloud-config.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end("window.CLOUD_CONFIG = { url: 'https://fakeproj.supabase.co', anonKey: 'x' };"); }
      if (p === '/sw.js') { res.writeHead(404); return res.end(); }
      const file = path.join(REPO, p);
      if (!path.resolve(file).startsWith(REPO)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(buf);
      });
    });
    srv.on('error', (e) => reject(new Error('埠 ' + PORT + ' 不能用(' + e.code + ')')));
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

let B = null, chrome = null, chromeDir = null;
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
async function launch() {
  fs.mkdirSync(TMP, { recursive: true });
  chromeDir = fs.mkdtempSync(path.join(TMP, 'pl-e2e-'));
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + DEBUG, '--user-data-dir=' + chromeDir, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 75; i++) {
    try { const r = await fetch('http://127.0.0.1:' + DEBUG + '/json/version'); if (r.ok) return connect((await r.json()).webSocketDebuggerUrl); } catch (e) { /* 還沒好 */ }
    await sleep(200);
  }
  throw new Error('Chrome 沒有啟動');
}

/* 假的 Audio:播放 6 倍速(3 秒的音檔半秒播完);window.__audioFail = n 時接下來 n 次播放出錯 */
const AUDIO = `(() => {
  class A extends EventTarget {
    constructor(src) { super(); this.src = src || ''; this.preload = ''; this.currentTime = 0; this.duration = 3; this.ended = false; this.paused = true; }
    play() {
      this.paused = false;
      if (window.__audioFail > 0) { window.__audioFail--; setTimeout(() => this.dispatchEvent(new Event('error')), 80); return Promise.resolve(); }
      const t0 = performance.now();
      const tick = () => {
        if (this.paused) return;
        this.currentTime = Math.min(this.duration, (performance.now() - t0) / 1000 * 6);
        if (this.currentTime >= this.duration) { this.ended = true; this.paused = true; this.dispatchEvent(new Event('ended')); return; }
        setTimeout(tick, 80);
      };
      setTimeout(tick, 80);
      return Promise.resolve();
    }
    pause() { if (this.paused) return; this.paused = true; this.dispatchEvent(new Event('pause')); }
    load() {}
  }
  window.Audio = A;
})();`;
/* 頁面裡的小幫手:__pl() 認畫面;__plStep(c) 做一步(能播就播、沒選的選第 c 個、能按下一題就按) */
const ROBOT = `(() => {
  if (window.__plStep) return;
  const vis = (e) => !!e && e.offsetParent !== null;
  window.__pl = () => {
    const r = document.getElementById('pl-root');
    const badge = r.querySelector('.pl-meta .badge');
    const screen = document.querySelector('.ui-dialog') ? 'dialog' : r.querySelector('.result-card') ? 'result' : r.querySelector('.pl-between') ? 'between'
      : r.querySelector('.pl-intro') ? 'intro' : badge ? 'quiz' : 'other';
    const c = document.querySelector('.quiz-count');
    return { screen, part: badge ? badge.textContent.replace('Part ', '') : null, count: c ? c.textContent : null,
      listen: !!r.querySelector('.pl-play') && !r.querySelector('.opts') && !r.querySelector('.letter-row'), retry: /重新播放/.test(r.textContent) };
  };
  window.__plStep = (choice) => {
    const r = document.getElementById('pl-root');
    const play = r.querySelector('.pl-play');
    if (play && !play.disabled && !play.classList.contains('is-done')) { play.click(); return 'play'; }
    if (play && play.disabled && !play.classList.contains('is-done')) return 'wait';
    for (const g of r.querySelectorAll('.opts, .letter-row')) {
      const bs = Array.from(g.children);
      if (bs.some((b) => b.getAttribute('aria-pressed') === 'true')) continue;
      bs[(choice || 0) % bs.length].click();
      return 'pick';
    }
    const next = document.querySelector('.quiz-foot .pl-next');
    if (vis(next) && !next.disabled) { next.click(); return 'next'; }
    return 'idle';
  };
})()`;

async function tab(u, w, h, touch) {
  const ctx = (await B.send('Target.createBrowserContext', { disposeOnDetach: true })).result.browserContextId;
  const targetId = (await B.send('Target.createTarget', { url: 'about:blank', browserContextId: ctx })).result.targetId;
  const sid = (await B.send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  const send = (m, p) => B.send(m, p, sid);
  const p = { send, errors: [], w, h, touch };
  B.subs.set(sid, (msg) => {
    if (msg.method === 'Runtime.exceptionThrown') p.errors.push((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') p.errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
    /* sw.js 這裡故意回 404(不裝 service worker):註冊失敗的那一行不算 */
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon|beacon|cloudflareinsights|fonts\.g|sw\.js/.test(msg.params.entry.url || '')
      && !/fetching the script/.test(msg.params.entry.text)) p.errors.push(msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
  });
  p.eval = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error('頁面錯誤:' + J(r.result.exceptionDetails).slice(0, 300));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  p.metrics = (ww, hh) => send('Emulation.setDeviceMetricsOverride', { width: ww, height: hh, deviceScaleFactor: 1, mobile: touch });
  p.go = async (url) => {
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' + url });
    for (let i = 0; i < 100; i++) { await sleep(150); if ((await p.eval('document.readyState').catch(() => '')) === 'complete') break; }
    await p.eval('window.CLOUD && CLOUD.ready ? CLOUD.ready.then(() => true, () => true) : true');
    await sleep(600);
  };
  p.close = async () => { B.subs.delete(sid); await B.send('Target.closeTarget', { targetId }); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await p.metrics(w, h);
  if (touch) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB.sdkScript(u) });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: AUDIO });
  await p.go('robots.txt');
  await p.eval('localStorage.setItem("tr_current_profile", ' + J(J('c' + u.id.replace(/-/g, ''))) + '); true');
  return p;
}

const taken = new Set();
async function shot(p, name) {
  if (!SHOTS || taken.has(name + p.w)) return;
  taken.add(name + p.w);
  fs.mkdirSync(SHOTS, { recursive: true });
  await p.eval("(() => { const s = document.createElement('style'); s.id = '__shot'; s.textContent = ':focus-visible { outline: none !important; }'; document.head.append(s); return true; })()");
  await sleep(300);
  const full = Math.min(4000, Math.max(p.h, Number(await p.eval('Math.ceil(document.documentElement.scrollHeight)')) || p.h));
  if (full > p.h) { await p.metrics(p.w, full); await sleep(400); }
  const r = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: p.w, height: full, scale: 1 } });
  fs.writeFileSync(path.join(SHOTS, name + '_' + p.w + '.png'), Buffer.from(r.result.data, 'base64'));
  await p.eval("(() => { const s = document.getElementById('__shot'); if (s) s.remove(); return true; })()");
  await p.metrics(p.w, p.h);
  await sleep(200);
}
/* 頁面沒有橫向捲動 */
async function noOverflow(p, what) {
  const o = await p.eval('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  assert.ok(o <= 1, what + ' 橫向超出 ' + o + 'px');
}

async function walk(p, label) {
  const seen = [];
  let last = '';
  for (let i = 0; i < 400; i++) {
    const s = await p.eval(ROBOT + ';window.__pl()');
    const key = s.screen === 'quiz' ? 'P' + s.part + (s.listen ? '_播放前' : '') : s.screen;
    if (key !== last) { seen.push(key + (s.count ? ' ' + s.count : '')); last = key; }
    if (s.screen === 'quiz') { await noOverflow(p, label + ' ' + key); await shot(p, '02_作答_' + key); }
    if (s.retry) await shot(p, '03_重新播放');
    if (s.screen === 'between') { await shot(p, '04_兩科中間'); await p.eval("document.querySelector('.pl-between .pl-go').click()"); await sleep(500); continue; }
    if (s.screen === 'result') return seen;
    if (s.part === '1' && s.count === '聽力 · 2／12' && !(await p.eval('window.__failed'))) await p.eval('window.__audioFail = 1; window.__failed = true; true');
    const did = await p.eval(ROBOT + ';window.__plStep(' + (i % 3) + ')');
    await sleep(did === 'wait' ? 250 : 150);
  }
  throw new Error(label + ' 走太多步');
}

async function run(w, h, touch, n) {
  const u = { id: '00000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0'), email: 's' + n + '@example.org', user_metadata: { name: 'S' + n } };
  const p = await tab(u, w, h, touch);
  await p.go('placement.html');
  assert.strictEqual(await p.eval("document.querySelector('.pl-intro .pl-go').textContent"), '開始');
  await noOverflow(p, '開始頁');
  await shot(p, '01_開始頁');
  assert.strictEqual(await p.eval("fetch('audio/l1-01.mp3').then(r => r.status)"), 200);
  await p.eval("document.querySelector('.pl-intro .pl-go').click()");
  await sleep(1200);
  /* 離開確認(取消) */
  await p.eval("document.querySelector('.quiz-close').click()");
  await sleep(500);
  const dlg = await p.eval("(() => { const d = document.querySelector('.ui-dialog'); return d ? d.textContent : null; })()");
  assert.ok(dlg && /離開檢測？/.test(dlg) && /下次從這一題接著做。/.test(dlg), '離開確認:' + dlg);
  await shot(p, '05_離開確認');
  await p.eval("Array.from(document.querySelectorAll('.ui-dialog button')).filter(b => b.textContent.trim() === '繼續作答')[0].click()");
  await sleep(400);
  const seen = await walk(p, w + '');
  await sleep(1500);
  await noOverflow(p, '結果頁');
  await shot(p, '06_結果頁');
  await p.eval("Array.from(document.querySelectorAll('.result-link')).filter(b => b.textContent.trim() === '看作答')[0].click()");
  await sleep(500);
  await shot(p, '07_看作答');
  const res = await p.eval("(() => ({ primary: document.querySelectorAll('#pl-root .btn.primary').length, note: (document.querySelector('.result-note') || {}).textContent, items: (store.get('placement_v1', {}).runs || [])[0].items.length, ends: ['L', 'R'].map((x) => !!((store.get('placement_v1', {}).runs || [])[0].tm[x] || [])[1]), hist: store.get('hist', null), listen: store.get('listen_p1', null) }))()");
  assert.strictEqual(res.primary, 1, '結果頁一顆主按鈕');
  assert.strictEqual(res.items, 24);
  assert.deepStrictEqual(res.ends, [true, true], '兩科都記了結束時間');
  assert.ok(/^根據 24 題/.test(res.note), res.note);
  assert.strictEqual(res.hist, null);
  assert.strictEqual(res.listen, null);
  await sleep(3000);
  const up = ['fa_v1', 'placement_v1', 'est_v1'].filter((k) => CLOUD.get(u.id, k) !== undefined);
  assert.deepStrictEqual(p.errors, [], 'console 有錯:' + J(p.errors).slice(0, 500));
  await p.close();
  return w + ':' + seen.join(' → ') + ' | ' + res.note + ' | 上傳 ' + up.join(',');
}

(async () => {
  let srv = null, code = 0;
  try {
    if (!CHROME) throw new Error('找不到 Chrome 或 Edge');
    CLOUD = STUB.createCloud({});
    srv = await serve();
    B = await launch();
    console.log(await run(375, 812, true, 1));
    console.log(await run(1280, 900, false, 2));
    console.log('PASS 兩個寬度都走完');
  } catch (e) {
    code = 1;
    console.log('FAIL ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e));
  } finally {
    try { if (B) B.ws.close(); } catch (e) { /* 已關 */ }
    if (chrome) chrome.kill();
    if (srv) srv.close();
    await sleep(800);
    try { if (chromeDir) fs.rmSync(chromeDir, { recursive: true, force: true }); } catch (e) { console.log('使用者資料夾沒刪掉:' + chromeDir); }
    process.exit(code);
  }
})();
