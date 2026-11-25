/* 新用戶設定接上程度檢測的無頭 Chrome 測試:真的 start.html、index.html、me.html、diagnostic.html,假雲端(tools/fixtures/lesson_cloud_stub.js,
   不連外網、不用真的帳號)。預設(或 repo 裡沒有 placement.html 時)伺服器回一個假的檢測頁(真的檢測頁整段走完在 tools/test_placement_e2e.js):
   照真的 js/estimate-store.js 開始一次檢測、每科送出 12 題、結束,再回 start.html?step=result(同檢測頁「下一步」的去處)。
   1. 新用戶:開始頁 → 目標 → 月份 → 「不確定，幫我測」 → 檢測說明 → 開始檢測 → (假的)檢測頁 → 結果頁(級別來源 est) → 首頁卡。
   2. 舊使用者(只有舊 28 題的結果):檢測說明只做聽力 → (假的)檢測頁只做聽力 → 結果頁聽力用預估、閱讀不動;舊報告還在;「我的」頁兩份報告都連得到。
   用法:node tools/test_onboard_e2e.js [--port <本機伺服器的埠>] [--debug-port <Chrome 的埠>] [--tmp <放 Chrome 使用者資料的資料夾>]
        [--shots <截圖資料夾>] [--real-placement]
   --shots 給了時,每個畫面存 375 與 1280 兩張(檔名「編號_畫面_寬.png」)。每次一個新的使用者資料夾,跑完刪掉。 */
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
const PORT = Number(opt('--port')) || 8981, DEBUG = Number(opt('--debug-port')) || PORT + 2;
const TMP = path.resolve(opt('--tmp') || os.tmpdir());
const SHOTS = opt('--shots') ? path.resolve(opt('--shots')) : null;
const FAKE = args.indexOf('--real-placement') < 0 || !fs.existsSync(path.join(REPO, 'placement.html'));   // 真的檢測頁要作答,整段走完在 tools/test_placement_e2e.js
const PF = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean);
const CHROME = [].concat(...PF.map((d) => [path.join(d, 'Google/Chrome/Application/chrome.exe'), path.join(d, 'Microsoft/Edge/Application/msedge.exe')]))
  .find((p) => fs.existsSync(p));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const J = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 假的檢測頁:跟 start.html 一樣的檔,加題目難度與 js/estimate-store.js ---------- */
const FAKE_SCRIPTS = ['js/cloud-config.js', 'js/plans-config.js', 'js/packs-config.js', 'js/common.js', 'js/ui.js', 'js/sync-merge.js', 'js/sync-merge-lesson.js',
  'js/estimate-core.js', 'js/estimate-data.js', 'js/sync-merge-estimate.js', 'js/pet-config.js', 'js/pet.js', 'js/cloud.js', 'js/profile.js', 'data/item-params.js', 'js/estimate-store.js'];
const PARTS = { L: [['l1', 2], ['l2', 4], ['l3', 3], ['l4', 3]], R: [['p5', 4], ['p6', 4], ['p7', 4]] };
function fakePlacement() {
  const run = `(async () => {
  await CLOUD.ready;
  if (CLOUD.reloading) return;
  const q = new URLSearchParams(location.search), sec = q.get('sec') === 'L' || q.get('sec') === 'R' ? q.get('sec') : 'LR';
  const S = ESTIMATE_STORE, keys = Object.keys(ITEM_PARAMS.b), parts = ${J(PARTS)};
  const r = await S.startRun({ sec });
  const at = r.run.at;
  for (const s of sec.split('')) {
    S.beginSection(at, s);
    let i = 0;
    parts[s].forEach(([p, n]) => keys.filter((k) => k.indexOf(p + '-') === 0 && !r.fa.i[k]).slice(0, n).forEach((key) => {
      S.answer(at, [{ s, key, choice: 0, ok: i++ % 3 === 2 ? 0 : 1, secs: 20 }]);
    }));
    S.endSection(at, s);
  }
  await S.finishRun(at);
  document.body.setAttribute('data-done', '1');
  if (q.get('from') === 'onboard') location.href = 'start.html?step=result';
})();`;
  return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>程度檢測</title></head><body><main><p>測試用的檢測頁</p></main>'
    + FAKE_SCRIPTS.map((s) => '<script src="' + s + '"></script>').join('') + '<script>' + run + '</script></body></html>';
}

/* ---------- 伺服器 ---------- */
const SV = { cloud: null, hits: [] };   // hits:檢測頁被開的網址(假的檢測頁很快就轉回結果頁)
function serve(port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      if (SV.cloud && STUB.serveCloud(SV.cloud, req, res, 0)) return;
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      const send = (body, type) => { res.writeHead(200, { 'Content-Type': type || TYPES['.js'], 'Cache-Control': 'no-store' }); res.end(body); };
      if (p === '/js/cloud-config.js') return send("window.CLOUD_CONFIG = { url: 'https://fakeproj.supabase.co', anonKey: 'x' };");
      if (p === '/sw.js') { res.writeHead(404); return res.end(); }
      if (p === '/placement.html') SV.hits.push(req.url.slice(1));
      if (p === '/placement.html' && FAKE) return send(fakePlacement(), TYPES['.html']);
      const file = path.join(REPO, p);
      if (!path.resolve(file).startsWith(REPO)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
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
  fs.mkdirSync(TMP, { recursive: true });
  chromeDir = fs.mkdtempSync(path.join(TMP, 'onboard-e2e-'));
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + DEBUG, '--user-data-dir=' + chromeDir, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
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
const user = (n, name, createdAt) => ({ id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), email: 's' + n + '@example.com', user_metadata: { name }, created_at: createdAt });
const pidOf = (u) => 'c' + u.id.replace(/-/g, '');

/* 一個分頁(自己的瀏覽器設定檔):seed 是先放進 localStorage 的鍵 */
async function tab(u) {
  const ctx = (await B.send('Target.createBrowserContext', { disposeOnDetach: true })).result.browserContextId;
  const targetId = (await B.send('Target.createTarget', { url: 'about:blank', browserContextId: ctx })).result.targetId;
  const sid = (await B.send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  const send = (m, p) => B.send(m, p, sid);
  const p = { send, errors: [], origin: 'http://127.0.0.1:' + PORT };
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
  p.text = (sel) => p.eval('(() => { const e = document.querySelector(' + J(sel) + '); return e ? e.textContent.trim() : null; })()');
  p.texts = (sel) => p.eval('Array.from(document.querySelectorAll(' + J(sel) + ')).map((e) => e.textContent.trim())');
  /* 按畫面上字一樣的按鈕或連結 */
  p.press = async (t) => {
    await p.eval('window.__oldPage = true');
    const ok = await p.eval('(() => { const b = Array.from(document.querySelectorAll("button, a")).find((e) => e.textContent.trim() === ' + J(t) + ' && e.offsetParent !== null); if (!b) return false; b.click(); return true; })()');
    assert.ok(ok, '找不到按鈕「' + t + '」');
    await sleep(500);
  };
  p.store = (k) => p.eval('store.get(' + J(k) + ', null)');
  p.close = async () => { B.subs.delete(sid); await B.send('Target.closeTarget', { targetId }); };
  await send('Page.enable'); await send('Runtime.enable');
  await p.metrics(1280, 900, false);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB.sdkScript(u) });
  await p.go('robots.txt');
  await p.eval('localStorage.setItem("tr_current_profile", ' + J(J(pidOf(u))) + '); true');
  return p;
}

/* 每個畫面 375 與 1280 兩張整頁截圖 */
async function shot(p, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, h, mobile] of [[375, 812, true], [1280, 900, false]]) {
    await p.metrics(w, h, mobile);
    await sleep(500);
    const full = Math.min(3200, Math.max(h, Number(await p.eval('Math.ceil(document.documentElement.scrollHeight)')) || h));
    if (full > h) { await p.metrics(w, full, mobile); await sleep(400); }
    const r = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: full, scale: 1 } });
    fs.writeFileSync(path.join(SHOTS, name + '_' + w + '.png'), Buffer.from(r.result.data, 'base64'));
  }
  await p.metrics(1280, 900, false);
  await sleep(300);
}
const noErrors = (p, what) => assert.deepStrictEqual(p.errors, [], what + ' console 有錯誤:' + J(p.errors).slice(0, 600));
const freshCloud = () => { SV.cloud = STUB.createCloud({}); return SV.cloud; };
const waitResult = (p) => p.wait("location.search === '?step=result' && !!document.querySelector('.result-card') && !document.querySelector('.ob-loading')", '結果頁', 30000);

const T = {};
T['1 新用戶:幫我測 → 檢測說明 → 檢測頁 → 結果頁用預估對回四級(來源 est) → 首頁卡'] = async () => {
  freshCloud();
  const u = user(21, '新同學', new Date().toISOString());
  const p = await tab(u);
  await p.go('start.html');
  assert.ok(/24 題檢測/.test(await p.text('.page-head p')), '開始頁副標');
  await shot(p, '01_開始頁');
  await p.press('開始'); await p.press('600 分');
  await p.wait("location.search === '?step=exam'", '考試月份');
  await p.press('還沒報名');
  await p.wait("location.search === '?step=level'", '程度');
  await p.press('不確定，幫我測');
  await p.wait("location.search === '?step=test' && !!document.querySelector('.diag-intro')", '檢測說明');
  assert.deepStrictEqual(await p.texts('.diag-intro .mock-tag'), ['聽力 12 題', '閱讀 12 題', '約 15–20 分鐘']);
  await shot(p, '02_檢測說明_新用戶');
  SV.hits = [];
  await p.press('開始檢測');
  await waitResult(p);
  assert.deepStrictEqual(SV.hits, ['placement.html?start=1&from=onboard']);
  await sleep(800);
  const lv = await p.store('levels'), ob = await p.store('onboard');
  assert.deepStrictEqual([lv.source, lv.history.map((h) => h.reason), ob.levelSource, ob.status], [{ listening: 'est', reading: 'est' }, ['est'], 'est', 'done']);
  const est = await p.eval('ESTIMATE_STORE.peek()');
  assert.deepStrictEqual([lv.listening, lv.reading], [est.L.band, est.R.band], '級別等於預估的級別');
  assert.strictEqual(await p.text('.result-card .result-note'), '依程度檢測與練習');
  await shot(p, '03_結果頁_新用戶');
  await p.go('index.html');
  await p.wait("!!document.querySelector('#onboard-home h2')", '首頁卡');
  assert.strictEqual(await p.text('#onboard-home h2'), '你的起始程度');
  await shot(p, '04_首頁卡_新用戶');
  noErrors(p, '新用戶');
  await p.close();
  return '聽力 ' + lv.listening + '、閱讀 ' + lv.reading;
};
T['2 舊使用者(只有舊 28 題):只做聽力;閱讀不動、舊報告還在;「我的」頁兩份報告'] = async () => {
  const c = freshCloud();
  const u = user(22, '舊同學', '2026-09-01T00:00:00.000Z');
  const old = new Date(Date.now() - 20 * 864e5).toISOString();
  const answers = {}; for (let i = 0; i < 28; i++) answers[i] = i % 4;
  const diag = { answers, done: true, startedAt: old, finishedAt: old };
  const levels = { listening: 'advanced', reading: 'threshold', source: { listening: 'legacy_plus1', reading: 'legacy' }, setAt: old,
    history: [{ at: old, listening: 'advanced', reading: 'threshold', reason: 'legacy' }] };
  const onboard = { v: 1, status: 'done', step: 'result', path: 'self', targetScore: 600, examMonth: null, levelSource: 'legacy', testFrom: old, previous: null,
    startedAt: old, doneAt: old, updatedAt: old };
  [['diag', diag], ['levels', levels], ['onboard', onboard]].forEach(([k, v]) => c.put(u.id, k, v, old));
  const p = await tab(u);
  await p.go('me.html');
  await p.wait("!!document.querySelector('#learning-settings')", '學習設定');
  await shot(p, '05_我的_舊使用者_檢測前');
  await p.go('start.html?step=test&from=me');
  await p.wait("!!document.querySelector('.diag-intro')", '檢測說明');
  assert.deepStrictEqual(await p.texts('.diag-intro .mock-tag'), ['聽力 12 題']);
  await shot(p, '06_檢測說明_舊使用者');
  SV.hits = [];
  await p.press('做聽力檢測');
  await waitResult(p);
  assert.deepStrictEqual(SV.hits, ['placement.html?start=1&from=onboard&sec=L']);
  await sleep(800);
  const lv = await p.store('levels');
  assert.deepStrictEqual([lv.reading, lv.source.reading, lv.source.listening, lv.history[lv.history.length - 1].reason], ['threshold', 'legacy', 'est', 'est']);
  assert.deepStrictEqual(await p.store('diag'), diag, '舊檢測還在');
  await shot(p, '07_結果頁_舊使用者');
  await p.go('me.html');
  await p.wait("!!document.querySelector('#learning-settings')", '學習設定');
  const rows = await p.eval("Array.from(document.querySelectorAll('#learning-settings .me-row')).map((a) => [a.firstChild.textContent, a.getAttribute('href')])");
  assert.deepStrictEqual(rows.slice(3), [['重新檢測', 'start.html?step=test&from=me'], ['檢測報告', 'placement.html?view=last'], ['閱讀檢測報告', 'diagnostic.html']]);
  await shot(p, '08_我的_舊使用者_檢測後');
  await p.go('diagnostic.html');
  await p.wait("!!document.querySelector('.result-card')", '舊檢測報告');
  await shot(p, '09_舊檢測報告');
  noErrors(p, '舊使用者');
  await p.close();
  return '聽力 ' + lv.listening + '(est)、閱讀 ' + lv.reading + '(legacy)';
};

async function main() {
  if (!CHROME) throw new Error('找不到 Chrome 或 Edge');
  const srv = await serve(PORT);
  let pass = 0;
  const names = Object.keys(T);
  try {
    B = await launch();
    for (const name of names) {
      let detail = '', ok = true;
      try { detail = await T[name](); } catch (e) { ok = false; detail = e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e); }
      if (ok) pass++;
      console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + String(detail).slice(0, 600) : ''));
    }
  } finally {
    try { if (B) B.ws.close(); } catch (e) { /* 已經關了 */ }
    if (chrome) { chrome.kill(); await sleep(800); }
    try { fs.rmSync(chromeDir, { recursive: true, force: true }); } catch (e) { console.warn('使用者資料夾沒刪掉:' + chromeDir); }
    srv.close();
  }
  console.log((FAKE ? '(假的檢測頁)' : '(真的檢測頁)') + pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
