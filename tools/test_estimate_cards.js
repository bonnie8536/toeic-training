/* 預估多益分數卡放到頁面上(js/estimate-cards.js、js/profile.js、js/analysis.js)與教師後台的預估分數(js/admin.js)。
   第一段(不開瀏覽器):教師後台在 node 的 vm 裡跑(tools/owner_test_kit.js 的假 DOM 與假 Supabase):
     有預估快照的學生那一格與展開列、只有一科、兩端、壞掉的快照、沒有快照的學生跟改之前一模一樣、畫面上不出現 null。
   第二段(無頭 Chrome、假雲端 tools/fixtures/lesson_cloud_stub.js,不連外網、不用真的帳號):
     「我的」頁與能力分析頁是同一張卡、同一個數字;舊使用者第一次打開(只有舊 28 題、只有練習紀錄、什麼都沒有);
     建議改級(有課程進度先確認,取消不改、確定才改;沒有課程進度直接改);沒登入;本機學生檔案與匯入進度檔;教師後台。
   用法:node tools/test_estimate_cards.js [--port <起始埠,用兩個>] [--tmp <Chrome 使用者資料的上層資料夾>] [--shots <截圖資料夾>] [--no-browser]
   --shots 給了時,每個畫面存 375 與 1280 兩張。Chrome 的使用者資料夾每次新建、跑完刪掉。 */
'use strict';
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const OK = require('./owner_test_kit.js');
const EK = require('./estimate_kit.js');
const STUB = require('./fixtures/lesson_cloud_stub.js');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const PORT = Number(opt('--port')) || 9240, DEBUG = PORT + 1;
const TMP = path.resolve(opt('--tmp') || os.tmpdir());
const SHOTS = opt('--shots') ? path.resolve(opt('--shots')) : null;
const BROWSER = args.indexOf('--no-browser') < 0;
const J = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY_MS = 864e5;
const BAD_TEXT = /null|undefined|NaN|\[object/;

/* ---------- 共用的種子資料(用真的估分程式算期望值) ---------- */
const EC = EK.load({ dom: false });
vm.runInContext(read('data/diagnostic.js'), EC, { filename: 'data/diagnostic.js' });
const E = EC.ESTIMATE, P = EC.ITEM_PARAMS, LEGACY = EC.TOEIC.diagnostic;
const NOW = Date.now(), TODAY = E.dayNum(NOW);
const KEYS = Object.keys(P.b).sort();
const R_KEYS = KEYS.filter((k) => /^p/.test(k)), L_KEYS = KEYS.filter((k) => /^l/.test(k)), P5_KEYS = KEYS.filter((k) => /^p5-/.test(k));
const isoAgo = (days) => new Date(NOW - days * DAY_MS).toISOString();
function oldDiag() {
  const items = [...LEGACY.p5, ...LEGACY.p6.questions, ...LEGACY.p7.questions];
  const answers = {};
  items.forEach((it, i) => { answers[i] = i % 5 < 3 ? it.answer : (it.answer + 1) % 4; });
  return { done: true, answers, startedAt: isoAgo(30), finishedAt: isoAgo(30) };
}
const practiceHist = () => P5_KEYS.slice(0, 24).map((id, i) => ({ m: 'p5', id, c: 0, ok: i % 3 !== 0, t: NOW - 2 * DAY_MS + i * 1000 }));
function richFa() {
  const i = {};
  R_KEYS.slice(0, 120).forEach((k, n) => { i[k] = [TODAY - 2, n % 10 < 9 ? 1 : 0, 'p']; });
  L_KEYS.slice(0, 60).forEach((k, n) => { i[k] = [TODAY - 2, n % 10 < 6 ? 1 : 0, 'p']; });
  return { v: 1, i };
}
const LEVELS = (l, r) => ({ listening: l, reading: r, source: { listening: 'score', reading: 'score' }, setAt: isoAgo(20), history: [{ at: isoAgo(20), listening: l, reading: r, reason: 'score' }] });
const ONBOARD = { v: 1, status: 'done', step: 'result', path: 'self', updatedAt: isoAgo(20) };
/* 期望值:跟頁面一樣的算法(peek),給第二段比數字 */
function expectOf(keys) {
  const st = EK.fakeStore(keys);
  return EC.ESTIMATE_STORE.peek({ store: st, params: P, legacy: LEGACY, now: NOW, profile: EK.CPID, cloud: null, canWrite: () => true });
}
const scoreOf = (v) => (v.kind === 'low' ? '150 以下' : v.kind === 'high' ? '450 以上' : String(v.est));

/* =========================================================
   第一段:教師後台(vm)
   ========================================================= */
const S = (n) => '5c000000-0000-4000-8000-00000000000' + n;
const row = (uid, k, v, at) => ({ user_id: uid, k, v, updated_at: at || isoAgo(1) });
const SNAP = (at, L, R) => ({ ip: 'ip1', cv: 'c1', at, L, R });
const AT = '2026-11-25T04:00:00.000Z';
function openAdmin(rows, src) {
  const w = OK.world();
  w.progressRows = rows;
  const L = OK.context(w, { paid: false });
  const ctx = L.ctx;
  ctx.TOEIC = {}; ctx.window.TOEIC = ctx.TOEIC;
  vm.runInContext(read('data/diagnostic.js'), ctx);
  ctx.bandEstimate = () => ({ band: '600–700' });
  const root = new L.dom.Node('div'); root.attrs.id = 'admin-root'; L.dom.body.append(root);
  ctx.$ = (sel) => (sel === '#admin-root' ? root : null);
  vm.runInContext(src || read('js/admin.js'), ctx);
  return OK.settle().then(() => ({ root, ctx }));
}
const cellsOf = (root) => root.find((n) => n.tagName === 'TR' && n.attrs.style === 'cursor:pointer').map((tr) => tr.children.map((td) => td.textContent));
const meta = (uid, name) => row(uid, '_meta', { name, email: name + '@example.com' });
const dayText = (iso) => { const d = new Date(Date.parse(iso)); return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日'; };
function oldAdminSrc() {
  const { execFileSync } = require('child_process');
  return execFileSync('git', ['-C', REPO, 'show', '5928f0d:js/admin.js'], { encoding: 'utf8' });
}

const A = {};
/* 預估卡「再做 N 題」連到的練習頁:要是會記第一次作答的那一頁(載 js/listening.js、js/practice-fa.js、js/estimate-store.js),不是聽力訓練(listening.html) */
A['練習頁連結:聽力連 practice.html#listen(載 listening.js、practice-fa.js、estimate-store.js,有 id 是 listen 的面板),閱讀連 practice.html'] = async () => {
  const src = read('js/estimate-cards.js');
  const m = /return { L: '([^']+)', R: '([^']+)' };/.exec(src);
  const pageOf = (href) => href.split('#')[0];
  const loads = (href) => ['js/listening.js', 'js/practice-fa.js', 'js/estimate-store.js'].every((f) => read(pageOf(href)).indexOf('<script src="' + f + '"') > -1);
  const anchor = /class: 'practice-panel listen-panel', id: 'listen'/.test(read('js/practice.js')) && /location.hash === '#listen'/.test(read('js/practice.js'));
  const ok = !!m && m[1] === 'practice.html#listen' && m[2] === 'practice.html' && loads(m[1]) && loads(m[2]) && anchor && read('listening.html').indexOf('js/practice-fa.js') < 0;
  return { ok, detail: J(m && m.slice(1)) + ' anchor=' + anchor };
};
A['後台:有預估快照的學生「檢測結果」那一格寫「聽力 345／閱讀 290（預估 · 日期）」,展開列寫範圍與根據幾題、本站估計'] = async () => {
  const rows = [meta(S(1), '小安'), row(S(1), 'est_v1', SNAP(AT, [345, 300, 390, 100], [290, 245, 335, 86])), row(S(1), 'diag', oldDiag())];
  const { root } = await openAdmin(rows);
  const cell = cellsOf(root)[0][2];
  const want = '聽力 345／閱讀 290（預估 · ' + dayText(AT) + '）';
  const tr = root.find((n) => n.tagName === 'TR' && n.attrs.style === 'cursor:pointer')[0];
  await tr.fire('click', { target: tr });
  await OK.settle();
  const t = root.textContent;
  const ok = cell === want && t.includes('預估分數（' + dayText(AT) + '）：聽力 345（300–390）／閱讀 290（245–335）')
    && t.includes('根據 186 題 · 本站估計，不是正式成績。') && t.includes('檢測(') && !BAD_TEXT.test(t);
  return { ok, detail: cell + ' | ' + (t.match(/預估分數（[^。]*。/) || [''])[0] };
};
A['後台:只有一科有數字時另一科寫「—」;兩端寫「150 以下」「450 以上」、不寫範圍'] = async () => {
  const rows = [meta(S(1), '甲'), row(S(1), 'est_v1', SNAP(AT, null, [120, 70, 170, 30])),
    meta(S(2), '乙'), row(S(2), 'est_v1', SNAP(AT, [470, 420, 495, 60], [300, 250, 350, 40]), isoAgo(2))];
  const { root } = await openAdmin(rows);
  const cells = cellsOf(root).map((c) => c[2]);
  const d = dayText(AT);
  const trs = root.find((n) => n.tagName === 'TR' && n.attrs.style === 'cursor:pointer');
  for (const tr of trs) await tr.fire('click', { target: tr });
  await OK.settle();
  const t = root.textContent;
  const ok = cells[0] === '聽力 —／閱讀 150 以下（預估 · ' + d + '）' && cells[1] === '聽力 450 以上／閱讀 300（預估 · ' + d + '）'
    && t.includes('聽力 —／閱讀 150 以下') && t.includes('聽力 450 以上／閱讀 300（250–350）') && !BAD_TEXT.test(t);
  return { ok, detail: J(cells) };
};
A['後台:壞掉的快照(兩科都不是數字、沒有日期、不是物件)當成沒有,照舊顯示舊檢測或「未檢測」,不出現 null'] = async () => {
  const rows = [meta(S(1), '甲'), row(S(1), 'est_v1', SNAP(AT, [null, null, null, null], 'x')),
    meta(S(2), '乙'), row(S(2), 'est_v1', { L: [300, 250, 350, 20] }),
    meta(S(3), '丙'), row(S(3), 'est_v1', 'oops'), row(S(3), 'diag', oldDiag())];
  const { root } = await openAdmin(rows);
  const cells = cellsOf(root).map((c) => c[2]);
  const ok = cells.filter((c) => c === '未檢測').length === 2 && cells.some((c) => /^\d+\/28 · 600–700$/.test(c)) && !BAD_TEXT.test(root.textContent);
  return { ok, detail: J(cells) };
};
A['後台:學生都沒有預估快照時,畫面跟改之前的 js/admin.js 一模一樣(表格、展開列)'] = async () => {
  const rows = [meta(S(1), '甲'), row(S(1), 'diag', oldDiag()), row(S(1), 'drill_p5', { 'p5-b1-01': { ok: true } }), meta(S(2), '乙')];
  const now = await openAdmin(rows), old = await openAdmin(rows, oldAdminSrc());
  const open = async (root) => { for (const tr of root.find((n) => n.tagName === 'TR' && n.attrs.style === 'cursor:pointer')) await tr.fire('click', { target: tr }); await OK.settle(); };
  await open(now.root); await open(old.root);
  const a = now.root.textContent, b = old.root.textContent;
  return { ok: a === b && a.length > 100, detail: a.length + ' 字;一樣 ' + (a === b) };
};
A['後台:預估快照是開頁時重算寫的,不算「最近活動」;程度檢測紀錄算「檢測」'] = async () => {
  const rows = [Object.assign(meta(S(1), '甲'), { updated_at: isoAgo(5) }), row(S(1), 'drill_p5', { 'p5-b1-01': { ok: true } }, isoAgo(3)), row(S(1), 'est_v1', SNAP(AT, [345, 300, 390, 30], null), isoAgo(0)),
    row(S(1), 'placement_v1', { v: 1, runs: [] }, isoAgo(2))];
  const { root } = await openAdmin(rows);
  const last = cellsOf(root)[0][1];
  const t = root.textContent;
  return { ok: last === isoAgo(2).slice(0, 10) && t.includes('甲：刷題、檢測'), detail: last + ' | ' + (t.match(/甲：[^（]*/) || [''])[0] };
};

/* =========================================================
   第二段:無頭 Chrome
   ========================================================= */
const PF = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean);
const CHROME = [].concat(...PF.map((d) => [path.join(d, 'Google/Chrome/Application/chrome.exe'), path.join(d, 'Microsoft/Edge/Application/msedge.exe')])).find((p) => fs.existsSync(p));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const SV = { cloud: null, local: false };
function serve(port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      if (SV.cloud && STUB.serveCloud(SV.cloud, req, res, 0)) return;
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      const send = (body, type) => { res.writeHead(200, { 'Content-Type': type || TYPES['.js'], 'Cache-Control': 'no-store' }); res.end(body); };
      if (p === '/js/cloud-config.js') return send(SV.local ? "window.CLOUD_CONFIG = { url: '', anonKey: '' };" : "window.CLOUD_CONFIG = { url: 'https://fakeproj.supabase.co', anonKey: 'x' };");
      if (p === '/sw.js') { res.writeHead(404); return res.end(); }
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
let B = null, chrome = null, chromeDir = null;
async function launch() {
  fs.mkdirSync(TMP, { recursive: true });
  chromeDir = fs.mkdtempSync(path.join(TMP, 'est-cards-'));
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
const user = (n, name) => ({ id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), email: 's' + n + '@example.com', user_metadata: { name } });
const pidOf = (u) => 'c' + u.id.replace(/-/g, '');

/* 一個分頁(自己的設定檔):u 是登入的帳號(null 是沒登入);seed 是先放進 localStorage 的值 */
async function tab(u, seed) {
  const ctxId = (await B.send('Target.createBrowserContext', { disposeOnDetach: true })).result.browserContextId;
  const targetId = (await B.send('Target.createTarget', { url: 'about:blank', browserContextId: ctxId })).result.targetId;
  const sid = (await B.send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  const send = (m, p) => B.send(m, p, sid);
  const p = { errors: [], send };
  B.subs.set(sid, (msg) => {
    if (msg.method === 'Runtime.exceptionThrown') p.errors.push((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') p.errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
  });
  p.eval = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error('頁面錯誤:' + J(r.result.exceptionDetails).slice(0, 300));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  p.metrics = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  p.loaded = async () => { for (let i = 0; i < 200; i++) { try { if ((await p.eval('!window.__old && document.readyState')) === 'complete') return; } catch (e) { /* 換頁中 */ } await sleep(100); } throw new Error('頁面沒載完'); };
  p.go = async (url) => { await p.eval('window.__old = true').catch(() => null); await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' + url }); await sleep(300); await p.loaded(); };
  p.wait = async (expr, what) => { for (let i = 0; i < 200; i++) { try { if (await p.eval(expr)) return; } catch (e) { /* 換頁中 */ } await sleep(100); } throw new Error('等不到:' + (what || expr)); };
  /* 畫面停下來:隔 600 毫秒讀兩次 main 一樣(雲端灌完資料會重載一次、卡片第二次畫) */
  p.still = async () => { let last = null; for (let i = 0; i < 30; i++) { const t = await p.eval("(document.querySelector('main') || document.body).innerText").catch(() => null); if (t !== null && t === last) return t; last = t; await sleep(600); } return last; };
  p.close = async () => { B.subs.delete(sid); await B.send('Target.closeTarget', { targetId }); };
  await send('Page.enable'); await send('Runtime.enable');
  await p.metrics(1280, 900, false);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB.sdkScript(u) });
  await p.go('robots.txt');
  const ls = Object.assign(u ? { tr_current_profile: J(pidOf(u)) } : {}, seed || {});
  await p.eval('Object.entries(' + J(ls) + ').forEach(([k, v]) => localStorage.setItem(k, v)); true');
  return p;
}
async function shot(p, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, h, mobile] of [[375, 812, true], [1280, 900, false]]) {
    await p.metrics(w, h, mobile);
    await sleep(500);
    const full = Math.min(4000, Math.max(h, Number(await p.eval('Math.ceil(document.documentElement.scrollHeight)')) || h));
    if (full > h) { await p.metrics(w, full, mobile); await sleep(400); }
    const r = await p.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: full, scale: 1 } });
    fs.writeFileSync(path.join(SHOTS, name + '_' + w + '.png'), Buffer.from(r.result.data, 'base64'));
  }
  await p.metrics(1280, 900, false);
}

/* 卡片讀成資料:每一列、總分、根據幾題、提示、主按鈕 */
const CARD = `(() => { const c = document.querySelector('.est-card'); if (!c) return null; const t = (e) => e.textContent.replace(/\\s+/g, ' ').trim();
  return { rows: [...c.querySelectorAll('.est-row')].map(t), total: [...c.querySelectorAll('.est-total')].map(t), meta: [...c.querySelectorAll('.est-meta')].map(t),
    note: [...c.querySelectorAll('.est-note')].map(t), suggest: [...c.querySelectorAll('.est-suggest')].map(t),
    primary: [...c.querySelectorAll('.btn.primary')].map((b) => t(b) + '>' + b.getAttribute('href')), go: [...c.querySelectorAll('.est-go')].map((b) => t(b) + '>' + b.getAttribute('href')), links: [...c.querySelectorAll('.est-need a')].map((a) => a.getAttribute('href')) }; })()`;
/* 整頁看得到的實色主按鈕(不含頂欄與小雞卡:小雞卡是另一個功能,有自己的按鈕) */
const PRIMARIES = "[...document.querySelectorAll('main .btn.primary')].filter((b) => b.offsetParent !== null && !b.closest('.pet-card')).map((b) => b.textContent.trim())";
/* 整頁看得到的實色主按鈕,含小雞卡(每個畫面最多一顆) */
const ALL_PRIMARIES = "[...document.querySelectorAll('.btn.primary')].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim())";
const MAIN_TEXT = "(document.querySelector('main') || document.body).textContent";
async function seedCloud(c, u, keys) { Object.keys(keys).forEach((k) => c.put(u.id, k, keys[k], isoAgo(1))); }
async function cardOn(p, url) {
  await p.go(url);
  await p.wait("!!document.querySelector('.est-card')", url + ' 的預估卡');
  await p.still();
  return p.eval(CARD);
}
const noBad = async (p) => !BAD_TEXT.test(await p.eval(MAIN_TEXT));
/* 一個帳號:種子放雲端,開「我的」與能力分析;回兩頁的卡片 */
async function both(n, keys, more) {
  const c = STUB.createCloud();
  SV.cloud = c; SV.local = false;
  const u = user(n, '學生' + n);
  await seedCloud(c, u, Object.assign({ onboard: ONBOARD }, keys));
  const p = await tab(u);
  const me = await cardOn(p, 'me.html');
  const meOk = await noBad(p);
  const meBtns = await p.eval(PRIMARIES);
  const meAll = await p.eval(ALL_PRIMARIES);
  if (more && more.me) await more.me(p);
  const an = await cardOn(p, 'analysis.html');
  const anOk = await noBad(p);
  const anBtns = await p.eval(PRIMARIES);
  if (more && more.an) await more.an(p);
  const out = { me, an, clean: meOk && anOk, meBtns, meAll, anBtns, errors: p.errors.slice(), p, c, u };
  return out;
}
const sameNumbers = (r) => J(r.me.rows) === J(r.an.rows) && J(r.me.total) === J(r.an.total) && J(r.me.meta) === J(r.an.meta);

const T = {};
T['只有舊 28 題:兩頁同一張卡;閱讀有數字、聽力「再做 20 題聽力」、檢測按鈕「做聽力檢測」(能力分析頁實色、「我的」頁描邊,整頁最多一顆實色);補回的作答記成來源 g,舊結果不動'] = async () => {
  const diag = oldDiag();
  const x = expectOf({ diag });
  const r = await both(21, { diag }, { me: (p) => shot(p, 'c1_old28_me') });
  const fa = await r.p.eval("store.get('fa_v1', null)");
  const diagAfter = await r.p.eval("store.get('diag', null)");
  const gN = fa ? Object.values(fa.i).filter((e) => e[2] === 'g').length : 0;
  await r.p.close();
  const ok = sameNumbers(r) && r.me.rows[0] === '聽力再做 20 題聽力，就會顯示預估分數。' && r.me.rows[1].startsWith('閱讀 ' + scoreOf(x.R))
    && J(r.me.go) === J(['做聽力檢測>placement.html?sec=L']) && J(r.me.primary) === '[]' && J(r.an.primary) === J(['做聽力檢測>placement.html?sec=L'])
    && r.me.total.length === 0 && gN === 28 && J(diagAfter) === J(diag)
    && r.clean && !r.errors.length && r.meBtns.length === 0 && r.meAll.length <= 1 && J(r.anBtns) === J(['做聽力檢測']);
  return { ok, detail: J(r.me) + ' g=' + gN + ' same=' + sameNumbers(r) + ' diag=' + (J(diagAfter) === J(diag)) + ' clean=' + r.clean + ' btns=' + J(r.meBtns) + ' all=' + J(r.meAll) + ' 錯誤 ' + J(r.errors).slice(0, 200) };
};
T['只有練習紀錄(24 題 Part 5):閱讀有數字、聽力「再做 20 題聽力」;兩頁一樣;「再做 N 題」連到題庫頁的聽力練習'] = async () => {
  const hist = practiceHist();
  const x = expectOf({ hist });
  const r = await both(22, { hist });
  await r.p.close();
  const ok = sameNumbers(r) && r.me.rows[1].startsWith('閱讀 ' + scoreOf(x.R)) && /^聽力再做 \d+ 題聽力/.test(r.me.rows[0])
    && J(r.me.links) === J(['practice.html#listen']) && J(r.an.links) === J(['practice.html#listen']) && r.clean && !r.errors.length;
  return { ok, detail: J(r.me) };
};
T['什麼都沒有:卡片只有標題與一顆檢測按鈕「做程度檢測」;能力分析頁是實色(整頁一顆主按鈕)、「我的」頁是描邊(整頁最多一顆實色)'] = async () => {
  const r = await both(23, {}, { an: (p) => shot(p, 'c3_none_analysis') });
  await r.p.close();
  const ok = r.me.rows.length === 0 && r.me.note.length === 0 && J(r.me.go) === J(['做程度檢測>placement.html']) && J(r.me.primary) === '[]'
    && J(r.an.primary) === J(['做程度檢測>placement.html']) && J(r.an.go) === J(r.me.go) && J(r.an.rows) === J(r.me.rows)
    && J(r.anBtns) === J(['做程度檢測']) && r.meAll.length <= 1 && r.clean && !r.errors.length;
  return { ok, detail: J(r.me) + ' 能力分析主按鈕 ' + J(r.anBtns) + ' 我的整頁 ' + J(r.meAll) };
};
T['建議改級(有課程進度):個人頁有提示與文字按鈕、能力分析頁沒有;按了先確認,取消不改,確定才改 levels(來源與理由記 est)'] = async () => {
  const fa = richFa();
  const x = expectOf({ fa_v1: fa, levels: LEVELS('threshold', 'entry') });
  const less = { v: 1, at: Math.floor(NOW / 1000) - 3 * 86400, items: [] };
  let res = {};
  const r = await both(24, { fa_v1: fa, levels: LEVELS('threshold', 'entry'), les_t1_01: less }, {
    me: async (p) => {
      res.course = await p.eval('ESTIMATE_CARDS.hasCourse()');
      await shot(p, 'c4_suggest_me');
      await p.eval("document.querySelector('.est-suggest-go').click(); true");
      await p.wait("!!document.querySelector('.ui-dialog')", '確認視窗');
      res.dlg = await p.eval("document.querySelector('.ui-dialog').textContent");
      await shot(p, 'c4_confirm_me');
      await p.eval("(() => { const b = [...document.querySelectorAll('.ui-dialog button')].find((x) => x.textContent.trim() === '取消'); b.click(); return true; })()");
      await sleep(600);
      res.afterCancel = await p.eval("store.get('levels', null)");
      await p.eval("document.querySelector('.est-suggest-go').click(); true");
      await p.wait("!!document.querySelector('.ui-dialog .ui-dialog-ok')", '確認視窗');
      await p.eval("document.querySelector('.ui-dialog .ui-dialog-ok').click(); true");
      await sleep(800);
      res.after = await p.eval("store.get('levels', null)");
      res.card = await p.eval(CARD);
    },
    an: (p) => shot(p, 'c4_full_analysis'),
  });
  await r.p.close();
  const sug = x.R.show ? EC.ESTIMATE_STORE.suggestions(x, LEVELS('threshold', 'entry')) : [];
  const first = sug[0] || {};
  const a = res.after || {}, key = first.sec === 'L' ? 'listening' : 'reading';
  const last = (a.history || [])[(a.history || []).length - 1] || {};
  const ok = sug.length > 0 && res.course === true && r.me.suggest.length === sug.length && r.an.suggest.length === 0
    && /改級別會換學習包/.test(res.dlg || '') && J(res.afterCancel && [res.afterCancel.listening, res.afterCancel.reading]) === J(['threshold', 'entry'])
    && a[key] === first.level && a.source && a.source[key] === 'est' && last.reason === 'est' && res.card.suggest.length === sug.length - 1
    && J(r.me.rows) === J(r.an.rows) && J(r.me.total) === J(r.an.total) && r.clean && !r.errors.length;
  return { ok, detail: J({ sug, me: r.me.suggest, after: a && [a.listening, a.reading, a.source, last.reason], dlg: res.dlg }) };
};
T['建議改級(沒有課程進度):按「改成…」直接改,不跳確認'] = async () => {
  const fa = richFa();
  let res = {};
  const r = await both(25, { fa_v1: fa, levels: LEVELS('threshold', 'entry') }, {
    me: async (p) => {
      res.course = await p.eval('ESTIMATE_CARDS.hasCourse()');
      await p.eval("document.querySelector('.est-suggest-go').click(); true");
      await sleep(800);
      res.dlg = await p.eval("!!document.querySelector('.ui-dialog')");
      res.after = await p.eval("store.get('levels', null)");
    },
  });
  await r.p.close();
  const a = res.after || {};
  const ok = res.course === false && res.dlg === false && (a.listening !== 'threshold' || a.reading !== 'entry') && !r.errors.length;
  return { ok, detail: J({ dlg: res.dlg, after: [a.listening, a.reading] }) };
};
T['沒登入:「我的」頁只有登入、註冊,沒有預估卡、不出現 null'] = async () => {
  SV.cloud = STUB.createCloud(); SV.local = false;
  const p = await tab(null);
  await p.go('me.html');
  await p.wait("!!document.querySelector('#me-root .me-actions')", '登入按鈕');
  await p.still();
  const card = await p.eval("!!document.querySelector('.est-card')");
  const clean = await noBad(p);
  await shot(p, 'c6_guest_me');
  const errs = p.errors.slice();
  await p.close();
  return { ok: !card && clean && !errs.length, detail: 'card ' + card + ' 錯誤 ' + J(errs).slice(0, 200) };
};
T['本機學生檔案:「我的」頁有同一張卡;匯入進度檔後換到新的學生,他的舊 28 題補成作答紀錄、卡片有閱讀數字'] = async () => {
  SV.cloud = null; SV.local = true;
  const pid = 'ptest01';
  const diag = oldDiag();
  const seed = { tr_profiles: J([{ id: pid, name: '小安', created: '2026-11-01' }]), tr_current_profile: J(pid), ['tr_u' + pid + '_hist']: J(practiceHist()) };
  const p = await tab(null, seed);
  const me = await cardOn(p, 'me.html');
  await shot(p, 'c7_local_me');
  const payload = { app: 'toeic-reading-room', version: 1, name: '小宏', exported: new Date(NOW).toISOString(), data: { diag: J(diag) } };
  await p.eval("window.__old = true; (() => { const i = document.querySelector('#me-root input[type=file]'); const dt = new DataTransfer();"
    + 'dt.items.add(new File([' + J(J(payload)) + "], 'x.json', { type: 'application/json' })); i.files = dt.files; i.dispatchEvent(new Event('change')); return true; })()");
  await sleep(800); await p.loaded();
  await p.wait("!!document.querySelector('.est-card')", '匯入後的卡片');
  await p.still();
  const after = await p.eval(CARD);
  const fa = await p.eval("store.get('fa_v1', null)");
  const gN = fa ? Object.values(fa.i).filter((e) => e[2] === 'g').length : 0;
  const clean = await noBad(p);
  const errs = p.errors.slice();
  await p.close();
  const ok = me.rows.length === 2 && /^閱讀 \S+/.test(me.rows[1]) && gN === 28 && /^閱讀 /.test(after.rows[1]) && !/再做/.test(after.rows[1]) && clean && !errs.length;
  return { ok, detail: J({ me: me.rows, after: after.rows, gN }) + ' 錯誤 ' + J(errs).slice(0, 200) };
};
T['教師後台(頁面):有預估快照的學生寫預估、沒有的照舊;展開列看得到預估與舊檢測'] = async () => {
  const c = STUB.createCloud();
  SV.cloud = c; SV.local = false;
  const t = user(30, '老師');
  c.teachers.add(t.id);
  const s1 = user(31, '小安'), s2 = user(32, '小宏'), s3 = user(33, '小美');
  c.put(s1.id, '_meta', { name: '小安', email: s1.email }, isoAgo(1));
  c.put(s1.id, 'est_v1', SNAP(AT, [345, 300, 390, 100], [290, 245, 335, 86]), isoAgo(1));
  c.put(s1.id, 'diag', oldDiag(), isoAgo(30));
  c.put(s2.id, '_meta', { name: '小宏', email: s2.email }, isoAgo(2));
  c.put(s2.id, 'diag', oldDiag(), isoAgo(2));
  c.put(s3.id, '_meta', { name: '小美', email: s3.email }, isoAgo(3));
  c.put(s3.id, 'drill_p5', { 'p5-b1-01': { ok: true } }, isoAgo(3));
  const p = await tab(t);
  await p.go('admin.html');
  await p.wait("document.querySelectorAll('.cat-table tr').length > 3", '學生表');
  await p.still();
  const cells = await p.eval("[...document.querySelectorAll('.cat-table tr[style*=pointer]')].map((r) => r.children[2].textContent)");
  await p.eval("document.querySelector('.cat-table tr[style*=pointer]').click(); true");
  await sleep(400);
  const det = await p.eval("document.querySelector('.cat-table tr[style*=pointer] + tr').textContent");
  await shot(p, 'c8_admin');
  const clean = await noBad(p);
  const errs = p.errors.slice();
  await p.close();
  const ok = cells[0] === '聽力 345／閱讀 290（預估 · ' + dayText(AT) + '）' && /^\d+\/28 · /.test(cells[1]) && cells[2] === '未檢測'
    && det.includes('預估分數（') && det.includes('本站估計，不是正式成績。') && det.includes('檢測(') && clean && !errs.length;
  return { ok, detail: J(cells) + ' 錯誤 ' + J(errs).slice(0, 200) };
};

T['舊 28 題頁(diagnostic.html):只有舊卷結果的學生直接打開,舊卷的 28 題先抄進第一次作答(來源 g),舊卷不動(之後「再測一次」刪掉舊卷,作答也還在第一次作答紀錄裡)'] = async () => {
  const c = STUB.createCloud();
  SV.cloud = c; SV.local = false;
  const u = user(41, '學生41');
  const diag = oldDiag();
  await seedCloud(c, u, { onboard: ONBOARD, diag });
  const p = await tab(u);
  await p.go('diagnostic.html');
  await p.wait("(() => { const f = store.get('fa_v1', null); return !!f && Object.values(f.i).filter((e) => e[2] === 'g').length === 28; })()", '補回舊 28 題');
  const diagAfter = await p.eval("store.get('diag', null)");
  const errs = p.errors.slice();
  await p.close();
  return { ok: J(diagAfter) === J(diag) && !errs.length, detail: 'diag 沒動 ' + (J(diagAfter) === J(diag)) + ' 錯誤 ' + J(errs).slice(0, 200) };
};

/* ---------- 跑 ---------- */
async function runAll(cases, prefix) {
  let pass = 0;
  for (const [name, fn] of Object.entries(cases)) {
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + prefix + name + '  →  ' + String(r.detail).slice(0, 700));
  }
  return [pass, Object.keys(cases).length];
}
(async () => {
  const totals = [await runAll(A, '')];
  let srv = null;
  if (BROWSER) {
    if (!CHROME) { console.error('找不到 Chrome 或 Edge'); process.exit(2); }
    try {
      srv = await serve(PORT);
      B = await launch();
      totals.push(await runAll(T, ''));
    } finally {
      if (srv) srv.close();
      if (chrome) { chrome.kill(); await sleep(800); }
      if (chromeDir) { for (let i = 0; i < 10; i++) { try { fs.rmSync(chromeDir, { recursive: true, force: true }); break; } catch (e) { await sleep(500); } } }
    }
  }
  const pass = totals.reduce((a, t) => a + t[0], 0), all = totals.reduce((a, t) => a + t[1], 0);
  console.log(pass + ' / ' + all + ' 通過' + (BROWSER ? '' : '(沒開瀏覽器)'));
  process.exit(pass === all ? 0 : 1);
})();
