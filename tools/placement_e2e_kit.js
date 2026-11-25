/* 程度檢測整合測試(tools/test_placement_e2e.js)的共用:本機伺服器(repo 與對照用的資料夾)、假雲端(tools/fixtures/lesson_cloud_stub.js)、
   無頭 Chrome 與 CDP、假時鐘、假的 Audio、頁面裡的作答小幫手、截圖。不連外網、不用真的帳號。
   每個 tab() 是一個新的瀏覽器設定檔(Target.createBrowserContext);同一個帳號開兩個就是兩台裝置。 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');
const STUB = require('./fixtures/lesson_cloud_stub.js');

const REPO = path.join(__dirname, '..');
const J = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PF = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean);
const CHROME = [].concat(...PF.map((d) => [path.join(d, 'Google/Chrome/Application/chrome.exe'), path.join(d, 'Microsoft/Edge/Application/msedge.exe')])).find((p) => fs.existsSync(p));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain' };

/* 時鐘(所有頁面與假雲端共用):真的時間往後撥 OFF 毫秒 */
const CLK = { off: 0 };
const nowMs = () => Date.now() + CLK.off;
const SV = { cloud: null };
function serve(root, port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      if (SV.cloud && STUB.serveCloud(SV.cloud, req, res, 0)) return;
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      const send = (body, type) => { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
      if (p === '/js/cloud-config.js') return send("window.CLOUD_CONFIG = { url: 'https://fakeproj.supabase.co', anonKey: 'x' };", TYPES['.js']);
      if (p === '/sw.js') { res.writeHead(404); return res.end(); }
      const file = path.join(root, p);
      if (!path.resolve(file).startsWith(path.resolve(root))) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => { if (err) { res.writeHead(404); return res.end(); } send(buf, TYPES[path.extname(file)] || 'application/octet-stream'); });
    });
    srv.on('error', (e) => reject(new Error('埠 ' + port + ' 不能用(' + e.code + '),換 --port')));
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
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
const CH = { proc: null, dir: null, B: null };
async function launch(tmp, debugPort) {
  if (!CHROME) throw new Error('找不到 Chrome 或 Edge');
  fs.mkdirSync(tmp, { recursive: true });
  CH.dir = fs.mkdtempSync(path.join(tmp, 'pl-int-'));
  CH.proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + debugPort, '--user-data-dir=' + CH.dir, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 75; i++) {
    try { const r = await fetch('http://127.0.0.1:' + debugPort + '/json/version'); if (r.ok) { CH.B = await connect((await r.json()).webSocketDebuggerUrl); return CH.B; } } catch (e) { /* 還沒好 */ }
    await sleep(200);
  }
  throw new Error('Chrome 沒有啟動');
}
async function shutdown() {
  try { if (CH.B) CH.B.ws.close(); } catch (e) { /* 已關 */ }
  if (CH.proc) { CH.proc.kill(); await sleep(900); }
  try { if (CH.dir) fs.rmSync(CH.dir, { recursive: true, force: true }); } catch (e) { return '使用者資料夾沒刪掉:' + CH.dir; }
  return '';
}

/* 假的 Audio:6 倍速播完;window.__audioFail = n 時接下來 n 次播放出錯 */
const AUDIO = `(() => {
  class A extends EventTarget {
    constructor(src) { super(); this.src = src || ''; this.preload = ''; this.currentTime = 0; this.duration = 3; this.ended = false; this.paused = true; this.playbackRate = 1; }
    play() {
      this.paused = false;
      if (window.__audioFail > 0) { window.__audioFail--; setTimeout(() => this.dispatchEvent(new Event('error')), 80); return Promise.resolve(); }
      const t0 = performance.now();
      const tick = () => {
        if (this.paused) return;
        this.currentTime = Math.min(this.duration, (performance.now() - t0) / 1000 * 6);
        this.dispatchEvent(new Event('timeupdate'));
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

/* 檢測頁的小幫手:__pl() 認畫面;__plStep(mode) 做一步(能播就播、沒選的照 mode 選:right 正解、wrong 錯的、mix 五題對三題、數字是第幾個;能按下一題就按) */
const PL_ROBOT = `(() => {
  if (window.__plStep) return;
  const vis = (e) => !!e && e.offsetParent !== null;
  window.__pl = () => {
    const r = document.getElementById('pl-root');
    const badge = r && r.querySelector('.pl-meta .badge');
    const screen = document.querySelector('.ui-dialog') ? 'dialog' : !r ? 'other' : r.querySelector('.result-card') ? 'result' : r.querySelector('.pl-between') ? 'between'
      : r.querySelector('.pl-intro') ? 'intro' : badge ? 'quiz' : 'other';
    const c = document.querySelector('.quiz-count');
    const st = window.PLACEMENT && PLACEMENT.state(), u = st && st.cur ? st.cur.unit : null;
    return { screen, part: badge ? badge.textContent.replace('Part ', '') : null, count: c ? c.textContent : null, unit: u ? u.id : null,
      listen: !!(r && r.querySelector('.pl-play')) && !(r && r.querySelector('.opts, .letter-row')), retry: !!r && /重新播放/.test(r.textContent) };
  };
  const answerOf = (u, qi) => (/^[125]$/.test(u.part) ? u.item.answer : u.item.questions[qi].answer);
  window.__plStep = (mode) => {
    const r = document.getElementById('pl-root');
    const play = r.querySelector('.pl-play');
    if (play && !play.disabled && !play.classList.contains('is-done')) { play.click(); return 'play'; }
    if (play && play.disabled && !play.classList.contains('is-done')) return 'wait';
    const u = PLACEMENT.state().cur && PLACEMENT.state().cur.unit;
    const groups = Array.from(r.querySelectorAll('.opts, .letter-row'));
    for (let qi = 0; qi < groups.length; qi++) {
      const bs = Array.from(groups[qi].children);
      if (bs.some((b) => b.getAttribute('aria-pressed') === 'true')) continue;
      const a = u ? answerOf(u, qi) : 0;
      const m = mode === 'mix' ? ((window.__mixN = (window.__mixN || 0) + 1) % 5 < 3 ? 'right' : 'wrong') : mode;   // mix:五題對三題
      bs[m === 'right' ? a : m === 'wrong' ? (a + 1) % bs.length : Number(m || 0) % bs.length].click();
      return 'pick';
    }
    const next = document.querySelector('.quiz-foot .pl-next');
    if (vis(next) && !next.disabled) { next.click(); return 'next'; }
    return 'idle';
  };
})()`;

/* 刷題頁的小幫手:__prStep(right) 做一步(對話框按主按鈕;沒選的題選正解或第一個;有下一題按下一題;最後按交卷) */
const PR_ROBOT = `(() => {
  if (window.__prStep) return;
  const vis = (e) => !!e && !e.disabled && e.offsetParent !== null;
  const txt = (e) => ((e && e.textContent) || '').trim();
  const P5 = () => (window.TOEIC && TOEIC.part5) || [];
  window.__prStep = (right) => {
    if (document.querySelector('.result-card')) return 'result';
    const dlg = document.querySelector('.ui-dialog');
    if (dlg) { const b = Array.from(dlg.querySelectorAll('button')).find((x) => /primary/.test(x.className)) || dlg.querySelector('button'); b.click(); return 'dialog'; }
    const opts = Array.from(document.querySelectorAll('.q-block .opts')).find((g) => vis(g.querySelector('.opt')) && !g.querySelector('.opt.picked'));
    if (opts) {
      const bs = Array.from(opts.querySelectorAll('.opt'));
      const shown = bs.map((b) => txt(b.lastChild));
      const q = P5().find((x) => Array.isArray(x.options) && x.options.join('|') === shown.join('|'));
      bs[right && q ? q.answer : 0].click();
      return 'pick';
    }
    const main = Array.from(document.querySelectorAll('.quiz-foot .btn.primary')).find(vis);
    if (main) { main.click(); return 'next:' + txt(main); }
    const act = Array.from(document.querySelectorAll('.quiz-act, .quiz-bar button')).find((b) => vis(b) && txt(b) === '交卷');
    if (act) { act.click(); return 'submit'; }
    return 'idle';
  };
})()`;

/* 一個分頁:u 是帳號(null 是沒登入);o = { port, w, h, touch, clock(要不要裝假時鐘,預設要) } */
async function tab(u, o) {
  const B = CH.B;
  const ctx = (await B.send('Target.createBrowserContext', { disposeOnDetach: true })).result.browserContextId;
  const targetId = (await B.send('Target.createTarget', { url: 'about:blank', browserContextId: ctx })).result.targetId;
  const sid = (await B.send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  const send = (m, p) => B.send(m, p, sid);
  const p = { send, errors: [], w: o.w || 1280, h: o.h || 900, touch: !!o.touch, origin: 'http://127.0.0.1:' + o.port, clockId: null };
  B.subs.set(sid, (msg) => {
    if (msg.method === 'Runtime.exceptionThrown') p.errors.push((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') p.errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
  });
  p.eval = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error('頁面錯誤:' + J(r.result.exceptionDetails).slice(0, 300));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  p.metrics = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: p.touch });
  p.wait = async (expr, what, ms) => {
    for (let i = 0; i < (ms || 15000) / 100; i++) { try { if (await p.eval(expr)) return; } catch (e) { /* 換頁中 */ } await sleep(100); }
    throw new Error('等不到:' + (what || expr));
  };
  p.go = async (url) => {
    await p.eval('window.__oldPage = true').catch(() => null);
    await send('Page.navigate', { url: p.origin + '/' + url });
    await p.wait("!window.__oldPage && document.readyState === 'complete'", url + ' 載完');
    await p.eval('window.CLOUD && CLOUD.ready ? CLOUD.ready.then(() => true, () => true) : true');
    await sleep(900);
  };
  p.reload = async () => {
    await p.eval('window.__oldPage = true');
    await send('Page.reload', {});
    await p.wait("!window.__oldPage && document.readyState === 'complete'", '重新整理');
    await p.eval('window.CLOUD && CLOUD.ready ? CLOUD.ready.then(() => true, () => true) : true');
    await sleep(900);
  };
  p.clock = async (ms) => {
    if (p.clockId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: p.clockId });
    p.clockId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB.clockScript(CLK.off) })).result.identifier;
    if (ms) await p.eval('window.__clockAdd ? (__clockAdd(' + ms + '), true) : true').catch(() => null);
  };
  p.text = (sel) => p.eval('(() => { const e = document.querySelector(' + J(sel) + '); return e ? e.textContent.replace(/\\s+/g, " ").trim() : null; })()');
  p.texts = (sel) => p.eval('Array.from(document.querySelectorAll(' + J(sel) + ')).map((e) => e.textContent.replace(/\\s+/g, " ").trim())');
  p.press = async (t, scope) => {
    const ok = await p.eval('(() => { const b = Array.from(document.querySelectorAll(' + J((scope ? scope + ' ' : '') + 'button, ' + (scope ? scope + ' ' : '') + 'a') + ')).find((e) => e.textContent.trim() === ' + J(t) + ' && e.offsetParent !== null); if (!b) return false; b.click(); return true; })()');
    assert.ok(ok, '找不到按鈕「' + t + '」');
    await sleep(500);
  };
  p.store = (k) => p.eval('store.get(' + J(k) + ', null)');
  p.close = async () => { B.subs.delete(sid); await B.send('Target.closeTarget', { targetId }); };
  await send('Page.enable'); await send('Runtime.enable');
  await p.metrics(p.w, p.h);
  if (p.touch) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB.sdkScript(u) });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: AUDIO });
  if (o.clock !== false) await p.clock(0);
  await p.go('robots.txt');
  if (u) await p.eval('localStorage.setItem("tr_current_profile", ' + J(J('c' + u.id.replace(/-/g, ''))) + '); true');
  return p;
}
async function advance(pages, ms) {
  CLK.off += ms;
  for (const p of pages) { try { await p.clock(ms); } catch (e) { /* 換頁中:新頁面會用新的時鐘 */ } }
}

/* 檢測頁做到結果頁或兩科中間(stopAt 'between' 時停在那裡);hook(s, i) 每一步之前叫 */
async function walk(p, mode, opt) {
  const o = opt || {}, units = [];
  for (let i = 0; i < 400; i++) {
    const s = await p.eval(PL_ROBOT + ';window.__pl()');
    if (s.screen === 'quiz' && s.unit && units[units.length - 1] !== s.unit) units.push(s.unit);
    if (o.hook) { const stop = await o.hook(s, i, units); if (stop) return { screen: s.screen, units }; }
    if (s.screen === 'between') { if (o.stopAt === 'between') return { screen: s.screen, units }; await p.press('開始' + (/閱讀/.test(await p.text('.pl-between')) ? '閱讀' : '聽力')); continue; }
    if (s.screen === 'result') return { screen: s.screen, units };
    const did = await p.eval(PL_ROBOT + ';window.__plStep(' + J(mode) + ')');
    await sleep(did === 'wait' ? 200 : 80);
  }
  throw new Error('檢測走太多步');
}
/* 刷題一回:url 打開就開始作答(?part=5 之類),做到成績卡 */
async function practiceRound(p, url, right) {
  await p.go(url);
  for (let i = 0; i < 200; i++) {
    const did = await p.eval(PR_ROBOT + ';window.__prStep(' + (right ? 'true' : 'false') + ')');
    if (did === 'result') return;
    await sleep(did === 'idle' ? 250 : 80);
  }
  throw new Error('刷題走太多步:' + url);
}

async function shot(p, dir, name) {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const [w, h, touch] of [[375, 812, true], [1280, 900, false]]) {
    await send2(p, w, h, touch);
    await sleep(500);
    await p.eval("(() => { const s = document.createElement('style'); s.id = '__shot'; s.textContent = ':focus-visible, :focus { outline: none !important; }'; document.head.append(s); return true; })()");
    const full = Math.min(4000, Math.max(h, Number(await p.eval('Math.ceil(document.documentElement.scrollHeight)')) || h));
    if (full > h) { await send2(p, w, full, touch); await sleep(400); }
    await p.eval('window.scrollTo(0, 0), true');   // 整頁截圖從頂端開始
    await sleep(150);
    const r = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: full, scale: 1 } });
    fs.writeFileSync(path.join(dir, name + '_' + w + '.png'), Buffer.from(r.result.data, 'base64'));
    await p.eval("(() => { const s = document.getElementById('__shot'); if (s) s.remove(); return true; })()");
  }
  await send2(p, p.w, p.h, p.touch);
  await sleep(300);
}
function send2(p, w, h, touch) { return p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: touch }); }
async function noOverflow(p, what) {
  const o = await p.eval('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  assert.ok(o <= 1, what + ' 橫向超出 ' + o + 'px');
}
const noErrors = (p, what) => assert.deepStrictEqual(p.errors.filter((e) => !/sw\.js|cloudflareinsights|beacon/.test(e)), [], what + ' console 有錯誤:' + J(p.errors).slice(0, 600));

module.exports = { REPO, J, sleep, STUB, SV, CLK, nowMs, serve, launch, shutdown, tab, advance, walk, practiceRound, shot, noOverflow, noErrors, PL_ROBOT };
