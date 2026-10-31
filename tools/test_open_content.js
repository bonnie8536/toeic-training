/* 「先看再登入」的無頭 Chrome 測試(站長 2026-10-31 的決定):內容頁沒登入(雲端)、沒選學生(本機)也看得到內容,
   第一次作答時才跳出登入卡或「你是哪位？」,那一下不生效、不寫任何資料,視窗可以關(X、Esc、點遮罩),關掉再作答又跳。
   個人頁(學習記錄、能力分析、每日複習、教師後台)照舊一打開就要登入、關不掉。已登入、已選學生的人行為完全不變。
   兩個本機伺服器:127.0.0.1:8961 雲端模式(js/cloud-config.js 換成假的設定,supabase-js 換成頁面裡的假元件,不連外網),
   127.0.0.1:8962 本機模式(cloud-config 是空的)。用真的滑鼠、鍵盤事件(CDP Input),比對每個動作前後的 localStorage 與畫面。
   用法:node tools/test_open_content.js [--tmp <放 Chrome 使用者資料的資料夾>] [--port <起始埠,預設 8961,用四個>] [--only <測試名稱的一段>]
        [--old-common <上一版 js/common.js 的檔案>](「新舊檔混用」那一項用;沒給就拿現在的 common.js 把 canKeepProgress 改名,等於還沒有這個函式的上一版)
   每次一個新的使用者資料夾,跑完刪掉。 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const TMP = path.resolve(opt('--tmp') || os.tmpdir());
const BASE = Number(opt('--port')) || 8961;
const CLOUD_PORT = BASE, LOCAL_PORT = BASE + 1, DEBUG = BASE + 2;
const CLOUD = 'http://127.0.0.1:' + CLOUD_PORT, LOCAL = 'http://127.0.0.1:' + LOCAL_PORT;
const ONLY = opt('--only') || '';
const OLD_COMMON = opt('--old-common');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

/* 測試用的帳號(雲端)與學生(本機) */
const UID = '11111111-2222-3333-4444-555555555555';
const CPID = 'c' + UID.replace(/-/g, '');
const LPID = 'ptest01';
const USER = { id: UID, email: 'student@example.com', user_metadata: { name: '測試' }, app_metadata: { providers: ['email'] } };

/* 換掉某幾個檔(網址路徑 → 內容):模擬上線那幾分鐘,瀏覽器 HTTP 快取還拿著上一版的檔、其他檔已經是新的 */
let SWAP = null;

function serve(port, cloud) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      if (SWAP && SWAP[p] !== undefined) {
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        return res.end(SWAP[p]);
      }
      if (p === '/js/cloud-config.js') {
        res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
        return res.end(cloud ? "window.CLOUD_CONFIG = { url: 'https://fakeproj.supabase.co', anonKey: 'x' };" : 'window.CLOUD_CONFIG = {};');
      }
      if (p === '/sw.js') { res.writeHead(404); return res.end(); }   // 不裝 service worker:每次都拿這個資料夾裡的檔案
      const file = path.join(REPO, p);
      if (!path.resolve(file).startsWith(REPO)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(buf);
      });
    });
    srv.on('error', (e) => reject(new Error('埠 ' + port + ' 不能用(' + e.code + '),換 --port')));
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

/* scrollbars:不帶 --hide-scrollbars,畫面跟桌機一樣有捲軸(「桌機矮視窗」那一項另外開一個,用下一個埠) */
async function launch(scrollbars) {
  const dir = fs.mkdtempSync(path.join(TMP, 'open-content-'));
  const port = scrollbars ? DEBUG + 1 : DEBUG;
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions'].concat(scrollbars ? [] : ['--hide-scrollbars'], ['--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank']), { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/json/version'); if (r.ok) return { proc, dir, ws: (await r.json()).webSocketDebuggerUrl }; } catch (e) { /* 還沒好 */ }
    await sleep(200);
  }
  throw new Error('Chrome 沒有啟動');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map(), errors = [], warns = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'warning') warns.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
  };
  const send = (method, params, sessionId) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(J(Object.assign({ id: i, method, params: params || {} }, sessionId ? { sessionId } : {}))); });
  return new Promise((resolve, reject) => { ws.onopen = () => resolve({ ws, send, errors, warns }); ws.onerror = reject; });
}

/* 頁面裡的假 supabase-js:loadSdk 看到 window.supabase 就不去 CDN 載。user 是 null 就是沒登入;delay 毫秒之後 getSession 才回 */
function fakeSdk(user, delay) {
  return `(() => {
  const res = { data: [], error: null };
  const chain = () => { const p = Promise.resolve(res); return new Proxy(function () {}, { get: (t, k) => k === 'then' ? p.then.bind(p) : k === 'catch' ? p.catch.bind(p) : k === 'finally' ? p.finally.bind(p) : () => chain(), apply: () => chain() }); };
  const session = ${user ? J({ access_token: 'x', user }) : 'null'};
  const base = { getSession: () => new Promise((r) => setTimeout(() => r({ data: { session }, error: null }), ${delay || 0})) };
  const auth = new Proxy(base, { get: (t, k) => t[k] || (() => Promise.resolve({ data: {}, error: null })) });
  const client = new Proxy({}, { get: (t, k) => k === 'auth' ? auth : k === 'then' ? undefined : () => chain() });
  window.supabase = { createClient: () => client };
})();`;
}
/* 會登入、會存雲端的假 supabase-js(第 2 輪審查的三項用):登入資料存在 SB(跟真的 supabase-js 同一個鍵),重載後 getSession 讀得到;
   雲端的 progress 表與收到的 upsert 放 sessionStorage(__fake_rows、__fake_up),重載後還在。
   c = { user:登入後的帳號, teachersDelay、progressDelay:查詢延遲毫秒, sessionDelay:getSession 延遲毫秒, access:rpc('my_access') 回的使用權 } */
const SB = 'sb-fakeproj-auth-token';
function fakeCloud(c) {
  return `(() => {
  const C = ${J(c)}, SB = ${J(SB)};
  const ss = (k) => { try { return JSON.parse(sessionStorage.getItem(k)) || []; } catch (e) { return []; } };
  const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms || 0));
  function query(table) {
    const f = {}; let up = null;
    const run = () => {
      if (up) {
        const log = ss('__fake_up'), db = ss('__fake_rows');
        up.forEach((r) => { const row = { k: r.k, v: r.v === undefined ? null : r.v, updated_at: r.updated_at || new Date().toISOString() };
          log.push({ k: row.k, v: row.v }); const i = db.findIndex((x) => x.k === r.k); if (i > -1) db[i] = row; else db.push(row); });
        sessionStorage.setItem('__fake_up', JSON.stringify(log)); sessionStorage.setItem('__fake_rows', JSON.stringify(db));
        return later(0, { data: null, error: null });
      }
      if (table === 'teachers') return later(C.teachersDelay, { data: [], error: null });
      /* sessionStorage 的 __fake_fail 有值:讀 progress 失敗(網路斷一下、Supabase 休眠),upsert 照常 */
      if (table === 'progress') return later(C.progressDelay, sessionStorage.getItem('__fake_fail') ? { data: null, error: { message: 'Failed to fetch' } }
        : { data: ss('__fake_rows').filter((r) => !f.k || r.k === f.k), error: null });
      return later(0, { data: [], error: null });
    };
    const q = { select: () => q, eq: (k, v) => { f[k] = v; return q; }, in: () => q, order: () => q, limit: () => q,
      upsert: (rows) => { up = [].concat(rows); return q; }, then: (a, b) => run().then(a, b) };
    return q;
  }
  const session = () => { try { return JSON.parse(localStorage.getItem(SB)); } catch (e) { return null; } };
  /* Google 登入:先離開這一頁(到 robots.txt,當作 Google 的同意頁),測試再開 redirectTo#access_token=…;
     回來那一頁 getSession 跟真的 supabase-js(detectSessionInUrl)一樣,把網址上的登入資料存起來、清掉網址。
     C.sessionDelay:getSession 慢這麼多毫秒才回(真的 supabase-js 回來那一頁要先拿 access_token 去問 /auth/v1/user),登入資料到那時才存 */
  const fromUrl = () => {
    if (/[#&]access_token=/.test(location.hash)) {
      localStorage.setItem(SB, JSON.stringify({ access_token: 'x', user: C.user }));
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    }
    return { data: { session: session() }, error: null };
  };
  const auth = new Proxy({
    getSession: () => (C.sessionDelay ? later(C.sessionDelay).then(fromUrl) : later(0, fromUrl())),
    /* 送了幾次密碼記在 sessionStorage 的 __fake_pw(重載後還在) */
    signInWithPassword: () => { sessionStorage.setItem('__fake_pw', String(Number(sessionStorage.getItem('__fake_pw') || 0) + 1));
      const s = { access_token: 'x', user: C.user }; localStorage.setItem(SB, JSON.stringify(s)); return later(0, { data: { user: C.user, session: s }, error: null }); },
    signInWithOAuth: (o) => { sessionStorage.setItem('__fake_oauth_to', (o && o.options && o.options.redirectTo) || ''); setTimeout(() => location.assign('/robots.txt'), 0); return later(0, { data: {}, error: null }); },
  }, { get: (t, k) => t[k] || (() => Promise.resolve({ data: {}, error: null })) });
  const client = { auth, from: query, rpc: (n) => later(0, { data: n === 'my_access' && C.access ? C.access : null, error: null }) };
  window.supabase = { createClient: () => client };
})();`;
}
/* 主畫面 App(加到主畫面後開啟):每頁 head 的開機程式看 navigator.standalone */
const STANDALONE = "Object.defineProperty(navigator, 'standalone', { get: () => true });";

/* 開一個新分頁:先到同網域的 robots.txt 清空、灌好 localStorage / sessionStorage,再開要測的那一頁 */
async function open(B, o) {
  const origin = o.mode === 'local' ? LOCAL : CLOUD;
  const t = await B.send('Target.createTarget', { url: 'about:blank' });
  const targetId = t.result.targetId;
  const sid = (await B.send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  const send = (m, p) => B.send(m, p, sid);
  const s = {
    send, origin,
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error('頁面錯誤:' + J(r.result.exceptionDetails).slice(0, 300));
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    async loaded() { for (let i = 0; i < 150; i++) { try { if ((await s.eval('document.readyState')) === 'complete') return; } catch (e) { /* 換頁中 */ } await sleep(100); } throw new Error('頁面沒載完'); },
    async go(u) { await send('Page.navigate', { url: origin + '/' + u }); await sleep(150); await s.loaded(); },
    close: () => B.send('Target.closeTarget', { targetId }),
  };
  await send('Page.enable'); await send('Runtime.enable');
  const size = o.size || (o.app || o.touch ? { width: 375, height: 812 } : null);
  await send('Emulation.setDeviceMetricsOverride', size ? { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: !o.desktop } : { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  if (o.touch) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });   // 觸控螢幕:(pointer: coarse) 成立
  if (o.mode !== 'local') await send('Page.addScriptToEvaluateOnNewDocument', { source: o.sdk || fakeSdk(o.user || null, o.delay || 0) });
  if (o.app) await send('Page.addScriptToEvaluateOnNewDocument', { source: STANDALONE });
  if (o.pre) await send('Page.addScriptToEvaluateOnNewDocument', { source: o.pre });
  await s.go('robots.txt');
  const seed = Object.assign({}, o.ls || {});
  const ss = Object.assign({}, o.ss || {});
  if (o.user) { seed.tr_current_profile = J(CPID); ss['tr_cloud_hydrated_' + UID] = '1'; }
  if (o.profile) { seed.tr_profiles = J([{ id: LPID, name: '小安', created: '2026-10-01' }]); seed.tr_current_profile = J(LPID); }
  await s.eval('localStorage.clear(); sessionStorage.clear(); Object.entries(' + J(seed) + ').forEach(([k, v]) => localStorage.setItem(k, v)); Object.entries(' + J(ss) + ').forEach(([k, v]) => sessionStorage.setItem(k, v)); true');
  await s.go(o.url);
  if (!o.early) {
    await s.eval('window.CLOUD && CLOUD.ready ? CLOUD.ready.then(() => true, () => true) : true');
    await sleep(1300);   // 小雞(pet-store)開頁同步寫 tr_pet 是非同步的,等它寫完再拍「之前」的樣子
  }
  return s;
}

/* ---------- 頁面上的量測 ---------- */
const LS = 'JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])))';
const STATE = `(() => {
  const m = document.querySelector('.modal-mask');
  const box = m && m.querySelector('.modal');
  const r = m && m.getBoundingClientRect();
  return { mask: !!m, x: !!(m && m.querySelector('.modal-close')), why: m ? ((m.querySelector('.auth-why,.modal-why') || {}).textContent || '') : '',
    title: m ? ((m.querySelector('h2') || {}).textContent || '') : '', aria: box ? box.getAttribute('aria-modal') : null,
    inert: [...document.body.children].filter((e) => e.inert).length, gate: document.documentElement.classList.contains('app-gate'),
    shell: document.documentElement.classList.contains('app-shell'), top: r ? Math.round(r.top) : null };
})()`;
/* main 的內容(作答被攔下時一個字都不能變;readonly 是攔截時加的,不算) */
const MAIN = "(document.querySelector('main') || document.body).innerHTML.replace(/ readonly=\"\"/g, '')";
async function snap(s) { return { ls: await s.eval(LS), main: await s.eval(MAIN), href: await s.eval('location.href') }; }
function lsDiff(a, b) {
  const x = JSON.parse(a), y = JSON.parse(b);
  return Object.keys(Object.assign({}, x, y)).filter((k) => x[k] !== y[k]);
}

/* 第 i 個符合 sel 的元素捲到畫面中間,回中心點;點下去最上面的元素要是它(或它裡面的東西) */
async function point(s, sel, i) {
  const r = await s.eval(`(() => { const e = document.querySelectorAll(${J(sel)})[${i || 0}]; if (!e) return null; e.scrollIntoView({ block: 'center' });
    const b = e.getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + Math.min(b.height / 2, 12); const top = document.elementFromPoint(x, y);
    return { x, y, hit: !!top && (top === e || e.contains(top)), tag: top ? top.tagName + '.' + top.className : '' }; })()`);
  if (!r) throw new Error('找不到 ' + sel + ' #' + (i || 0));
  if (!r.hit) throw new Error(sel + ' 被 ' + r.tag + ' 蓋住');
  return r;
}
async function mouse(s, x, y) {
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function click(s, sel, i) { const p = await point(s, sel, i); await mouse(s, p.x, p.y); await sleep(350); }
const KEYS = { Enter: { code: 'Enter', keyCode: 13, text: '\r' }, ' ': { code: 'Space', keyCode: 32, text: ' ' }, Escape: { code: 'Escape', keyCode: 27 }, a: { code: 'KeyA', keyCode: 65, text: 'a' },
  Tab: { code: 'Tab', keyCode: 9 } };
async function key(s, k, shift) {
  const d = KEYS[k];
  const m = shift ? 8 : 0;
  await s.send('Input.dispatchKeyEvent', { type: d.text ? 'keyDown' : 'rawKeyDown', key: k, code: d.code, windowsVirtualKeyCode: d.keyCode, text: d.text, modifiers: m });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: d.code, windowsVirtualKeyCode: d.keyCode, modifiers: m });
  await sleep(shift || k === 'Tab' ? 80 : 300);
}
/* 觸控點一下(touchStart/touchEnd;瀏覽器自己補 pointer、click) */
async function tap(s, sel, i) {
  const p = await point(s, sel, i);
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
}
/* 焦點在哪:在不在視窗裡、是什麼;視窗的描述(aria-describedby 指到的字) */
const FOCUS = `(() => {
  const m = document.querySelector('.modal-mask'), a = document.activeElement, box = m && m.querySelector('[role=dialog]');
  const ids = box ? (box.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean) : [];
  return { inMask: !!(m && a && m.contains(a)), tag: a ? a.tagName + (a.className ? '.' + String(a.className).split(' ')[0] : '') + (a.name ? '[' + a.name + ']' : '') : '',
    desc: ids.map((id) => (document.getElementById(id) || {}).textContent || '').join(' '), y: Math.round(scrollY) };
})()`;
const state = (s) => s.eval(STATE);

/* 閱讀頁單字考題的第一張字卡和第一個空格:捲一次讓兩個都在畫面裡,再一起量(分兩次量,第二次捲動會讓第一個的座標過時) */
async function chipAndBlank(s) {
  const r = await s.eval(`(() => { const c = document.querySelector('.tq-chip'), k = document.querySelector('.tq-blank'); if (!c || !k) return null;
    const top = Math.min(c.getBoundingClientRect().top, k.getBoundingClientRect().top) + scrollY, bot = Math.max(c.getBoundingClientRect().bottom, k.getBoundingClientRect().bottom) + scrollY;
    window.scrollTo({ top: Math.max(0, (top + bot) / 2 - innerHeight / 2), behavior: 'instant' });
    const at = (e) => { const b = e.getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2, t = document.elementFromPoint(x, y); return { x, y, hit: !!t && (t === e || e.contains(t)) }; };
    return { a: at(c), b: at(k) }; })()`);
  if (!r) throw new Error('找不到字卡或空格');
  if (!r.a.hit || !r.b.hit) throw new Error('字卡或空格不在畫面上 ' + J(r));
  return r;
}
async function mouseDrag(s, a, b) {
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let k = 1; k <= 12; k++) await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * k / 12, y: a.y + (b.y - a.y) * k / 12, button: 'left', buttons: 1 });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(400);
}
async function touchDrag(s, a, b) {
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  for (let k = 1; k <= 12; k++) await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * k / 12, y: a.y + (b.y - a.y) * k / 12 }] });
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
}
/* Ctrl+V(Windows、Linux 的貼上);頁面收到幾次 paste 記在 window.__pastes */
async function ctrlV(s) {
  await s.eval("if (window.__pastes === undefined) { window.__pastes = 0; addEventListener('paste', () => { window.__pastes++; }, true); } true");
  await s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 });
  await s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 0 });
  await sleep(300);
}
/* 從別的地方拖一段文字放進 (x, y) */
async function dropText(s, x, y, text) {
  const data = { items: [{ mimeType: 'text/plain', data: text }], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x, y, data });
  await sleep(300);
}

/* 關掉視窗的三種方法 */
async function closeBy(s, how) {
  if (how === 'x') await click(s, '.modal-mask .modal-close');
  else if (how === 'esc') await key(s, 'Escape');
  else { await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 4, y: 450, button: 'left', clickCount: 1 }); await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 4, y: 450, button: 'left', clickCount: 1 }); await sleep(300); }
  return !(await state(s)).mask;
}

/* ---------- 內容頁與它們的動作 ----------
   see:代表內容(畫出來了);act:作答類(要被攔下);free:看內容類(不跳視窗、不寫資料;then = 點了之後要出現的東西) */
const CONTENT = [
  { url: 'grammar.html', see: '.gx-unit-row', free: [{ sel: '.gx-stations button.gx-station', i: 1, then: '.gx-stations button.gx-station.on' }] },
  { url: 'grammar.html?u=ga-01', see: '.q-block .opt', act: [{ sel: '.q-block .opt' }] },
  { url: 'grammar.html?ref=verbs', see: '.vb-table', act: [{ sel: '.vb-bar .btn.primary' }], free: [{ sel: '.vb-bar .btn:not(.primary)', then: '.vb-mask' }, { sel: '.vb-chips .hist-tab', i: 1, then: '.vb-chips .hist-tab.on' }] },
  { url: 'grammar.html?ref=tenses', see: 'button.tn-cell', free: [{ sel: 'button.tn-cell', then: '.tn-detail' }] },
  { url: 'phonics.html?u=pa-01', see: '.ph-card', act: [{ sel: '.q-block .opt' }], free: [{ sel: 'button.ph-card' }, { sel: 'button.ph-slow', then: 'button.ph-slow.on' }] },
  { url: 'reading.html', see: 'a.article-card', free: [{ sel: '.drill-filters .chip', i: 1, then: '.drill-filters .chip.on' }] },
  { url: 'reading.html?id=art-1a', see: '.article-body .vw', drag: true,
    act: [{ sel: '.article-body .vw' }, { sel: '.reader-toolbar .btn', i: 1 }, { sel: '#reading-root .q-block .opt' }, { sel: '.tq-chip' }, { sel: '.tq-blank' }],
    free: [{ sel: '.reader-toolbar .btn', i: 0, then: '.article-body.bilingual' }] },
  { url: 'dialogue.html', see: 'a.dlg-card', free: [{ sel: '.drill-filters .chip', i: 1, then: '.drill-filters .chip.on' }] },
  { url: 'dialogue.html?id=dlg-01', see: '.dlg-bubble', free: [{ sel: '.dlg-bubble', thenText: ['.vocab-progress', /聽過 1\//] }, { sel: '.vw.dlg-sl', then: '.vocab-pop' }] },
  { url: 'vocab.html', see: '.vg-games .part-card', act: [{ sel: '.vg-games .btn.primary' }, { sel: '.vg-games .btn.primary', i: 3 }, { sel: '.exercise-head .btn' }],
    free: [{ sel: '.hist-tabs .hist-tab', i: 1, then: '.hist-tabs .hist-tab.on' }], select: '.vg-source select' },
  { url: 'vocab.html#phrase', see: '.phrase-table', act: [{ sel: '.part-card:has(.phrase-table) .btn.primary' }], free: [{ sel: '.part-card .pop-mini', thenText: ['.part-card .pop-mini', /收起/] }] },
  { url: 'listening.html', see: '.part-card', act: [{ sel: 'a.btn.primary[href^="listening.html?sec="]' }] },
  { url: 'listening.html?sec=n', see: '.player-btn', act: [{ sel: '.opts .opt' }], free: [{ sel: '.player-btn', thenText: ['.player-note', /已播 1 次|音檔|找不到/] }] },
  { url: 'listening.html?sec=mp', see: '.pair-btn', act: [{ sel: '.pair-btn' }] },
  { url: 'listening.html?sec=d', see: 'textarea.write-area', act: [{ sel: 'textarea.write-area', text: true }, { sel: '.pop-btns .btn.primary' }] },
  { url: 'listening.html?sec=s', see: '.shadow-stage', act: [{ sel: '.player .player-btn' }] },
  { url: 'writing.html', see: 'a.part-card' },
  { url: 'writing.html?level=l1', see: 'a.unit-row', free: [{ sel: 'a.unit-row', i: 2, nav: /u=2/ }] },
  { url: 'writing.html?level=l1&u=0', see: '.lesson-point', act: [{ sel: '.lesson-view .btn.primary' }] },
  { url: 'writing.html?level=l1&u=1', see: '.tiles .tile', act: [{ sel: '.tiles .tile' }, { sel: '.unit-block .pop-btns .btn.primary' }] },
  { url: 'writing.html?level=l1&u=23', see: 'textarea.write-area', act: [{ sel: 'textarea.write-area', text: true }], free: [{ sel: '.unit-block > .btn', then: '.model-box' }] },
  { url: 'writing.html?level=l3&u=3', see: '.outline-grid textarea', act: [{ sel: '.outline-grid textarea', text: true }, { sel: 'textarea.write-area', i: 4, text: true }] },
  { url: 'practice.html', see: '.practice-panel', act: [{ sel: '.practice-panel .btn.primary' }, { sel: '.practice-panel .btn.primary', i: 1 }] },
  { url: 'practice.html?part=5', see: '.opts .opt', act: [{ sel: '.opts .opt' }], free: [{ sel: '.q-nav button', i: 1, then: '.q-nav button.cur' }] },
  { url: 'diagnostic.html', see: '.diag-intro', act: [{ sel: '.diag-intro .btn.primary' }] },
  { url: 'mock.html', see: '.part-card', act: [{ sel: '.part-card .btn.primary' }, { sel: '.part-card .btn.primary', i: 1 }] },
];
const PERSONAL = ['history.html', 'analysis.html', 'review.html', 'admin.html'];
const WHY = { cloud: /登入之後才能作答/, local: /才能作答/ };

/* 一頁:沒登入打開不跳視窗、內容在;每個作答動作被攔下(視窗可關、再點又跳、畫面與資料不變);看內容的動作不跳視窗 */
async function guestPage(B, mode, pg) {
  const bad = [];
  const s = await open(B, { mode, url: pg.url });
  try {
    const st0 = await state(s);
    const seen = await s.eval('document.querySelectorAll(' + J(pg.see) + ').length');
    const who = await s.eval("(document.querySelector('.profile-btn') || {}).textContent || ''");
    if (st0.mask || st0.inert || st0.gate) bad.push('一打開就有視窗或 inert ' + J(st0));
    if (!seen) bad.push('內容沒畫出來:' + pg.see);
    if (!/登入|選擇學生/.test(who)) bad.push('頂欄不是訪客:' + who);
    for (const a of pg.act || []) {
      const label = a.sel + '#' + (a.i || 0);
      const before = await snap(s);
      if (a.text) {
        /* 作答框:focus 進去(鍵盤 Tab 也一樣)不跳視窗、打不了字;按一個字才跳 */
        await s.eval(`document.querySelectorAll(${J(a.sel)})[${a.i || 0}].focus(); true`);
        await s.send('Input.insertText', { text: 'hello' });
        await sleep(200);
        const v = await s.eval(`document.querySelectorAll(${J(a.sel)})[${a.i || 0}].value`);
        const mid = await state(s);
        if (v !== '' || mid.mask) bad.push(label + ' 打字進去了或一 focus 就跳視窗 value=' + J(v));
        await key(s, 'a');
      } else {
        await click(s, a.sel, a.i);
      }
      const st1 = await state(s);
      const after = await snap(s);
      if (!st1.mask || !st1.x || !WHY[mode].test(st1.why)) bad.push(label + ' 沒有跳出可關的視窗 ' + J(st1));
      if (after.main !== before.main) bad.push(label + ' 畫面變了');
      if (after.href !== before.href) bad.push(label + ' 換頁了 ' + after.href);
      const d1 = lsDiff(before.ls, after.ls);
      if (d1.length) bad.push(label + ' 寫了 ' + d1.join(','));
      if (!(await closeBy(s, 'x'))) bad.push(label + ' X 關不掉');
      /* 關掉之後再作答:又跳;用 Esc 關 */
      if (a.text) { await s.eval(`document.querySelectorAll(${J(a.sel)})[${a.i || 0}].focus(); true`); await key(s, 'a'); } else await click(s, a.sel, a.i);
      if (!(await state(s)).mask) bad.push(label + ' 第二次沒有跳');
      if (!(await closeBy(s, 'esc'))) bad.push(label + ' Esc 關不掉');
      if (!a.text) {
        await click(s, a.sel, a.i);
        if (!(await closeBy(s, 'mask'))) bad.push(label + ' 點遮罩關不掉');
      }
      /* blur 之後(寫作頁的自動存檔)也不能寫 */
      await s.eval('document.activeElement && document.activeElement.blur && document.activeElement.blur(); true');
      await sleep(1100);
      const end = await snap(s);
      const d2 = lsDiff(before.ls, end.ls);
      if (d2.length) bad.push(label + ' 關掉之後寫了 ' + d2.join(','));
      if (end.main !== before.main) bad.push(label + ' 關掉之後畫面變了');
    }
    if (pg.drag) {
      /* 閱讀頁的單字考題:字卡拖進空格(pointerdown 起頭)也被擋下,放開時跳出視窗(第 3 輪審查 #3:以前不跳,看不出為什麼拖不動) */
      const before = await snap(s);
      const { a, b } = await chipAndBlank(s);
      await mouseDrag(s, a, b);
      const st = await state(s);
      if (!st.mask || !st.x || !WHY[mode].test(st.why)) bad.push('字卡拖進空格:放開沒有跳出可關的視窗 ' + J(st));
      if (st.mask) await closeBy(s, 'esc');
      const after = await snap(s);
      if (after.main !== before.main) bad.push('字卡拖進空格:畫面變了');
      if (lsDiff(before.ls, after.ls).length) bad.push('字卡拖進空格:寫了資料');
      if (await s.eval('!!document.querySelector(".tq-ghost")')) bad.push('字卡拖進空格:拖曳開始了');
    }
    if (pg.select) {
      /* 選字庫(看內容):選了照樣換,不跳視窗、不存 */
      const before = await snap(s);
      await s.eval(`(() => { const e = document.querySelector(${J(pg.select)}); e.value = e.options[1].value; e.dispatchEvent(new Event('change')); return true; })()`);
      await sleep(300);
      const v = await s.eval(`document.querySelector(${J(pg.select)}).selectedIndex`);
      if ((await state(s)).mask || v !== 1) bad.push('選字庫跳視窗或沒換');
      const d = lsDiff(before.ls, (await snap(s)).ls);
      if (d.length) bad.push('選字庫寫了 ' + d.join(','));
    }
    for (const f of pg.free || []) {
      const label = '看內容 ' + f.sel + '#' + (f.i || 0);
      const before = await snap(s);
      await click(s, f.sel, f.i);
      await sleep(300);
      if (f.nav) { await s.loaded(); const u = await s.eval('location.href'); if (!f.nav.test(u)) bad.push(label + ' 沒換頁 ' + u); }
      const st = await state(s);
      if (st.mask) { bad.push(label + ' 跳了視窗'); await closeBy(s, 'esc'); }
      if (f.then && !(await s.eval('!!document.querySelector(' + J(f.then) + ')'))) bad.push(label + ' 沒有效果(' + f.then + ')');
      if (f.thenText) { const t = await s.eval('(document.querySelector(' + J(f.thenText[0]) + ') || {}).textContent || ""'); if (!f.thenText[1].test(t)) bad.push(label + ' 沒有效果:' + t); }
      const d = lsDiff(before.ls, (await snap(s)).ls);
      if (d.length) bad.push(label + ' 寫了 ' + d.join(','));
      if (f.nav) break;
    }
  } finally { await s.close(); }
  return bad;
}

const T = {};
for (const mode of ['cloud', 'local']) {
  const who = mode === 'cloud' ? '雲端沒登入' : '本機沒選學生';
  T[who + ':內容頁打開不跳視窗、內容照常;作答被攔下(可關的視窗加說明、畫面與 localStorage 不變、關了再點又跳);看內容的動作不擋'] = async (B) => {
    const bad = [];
    for (const pg of CONTENT) {
      try { (await guestPage(B, mode, pg)).forEach((b) => bad.push(pg.url + ' ' + b)); } catch (e) { bad.push(pg.url + ' 丟錯:' + e.message); }
    }
    return { ok: !bad.length, detail: bad.length ? bad.join(' | ') : CONTENT.length + ' 頁都對' };
  };
  T[who + ':個人頁(學習記錄、能力分析、每日複習、教師後台)照舊一打開就要' + (mode === 'cloud' ? '登入' : '選學生') + '、關不掉'] = async (B) => {
    const out = [];
    for (const u of PERSONAL) {
      const s = await open(B, { mode, url: u });
      const a = await state(s);
      await key(s, 'Escape');
      await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 4, y: 450, button: 'left', clickCount: 1 });
      await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 4, y: 450, button: 'left', clickCount: 1 });
      await sleep(300);
      const b = await state(s);
      await s.close();
      const ok = a.mask && !a.x && !a.why && b.mask && (mode === 'cloud' ? a.aria === 'true' : /你是哪位/.test(a.title));
      out.push({ u, ok, a: { mask: a.mask, x: a.x, why: a.why, aria: a.aria, title: a.title }, still: b.mask });
    }
    return { ok: out.every((x) => x.ok), detail: J(out.filter((x) => !x.ok).length ? out.filter((x) => !x.ok) : out.map((x) => x.u)) };
  };
}

/* 鍵盤:Enter、空白鍵按作答鈕也攔得到;視窗關掉後焦點回到那顆鈕 */
T['鍵盤:Enter、空白鍵按作答鈕也攔得到,畫面不變;Esc 關掉後焦點回到原按鈕(雲端與本機)'] = async (B) => {
  const out = [];
  for (const mode of ['cloud', 'local']) {
    const s = await open(B, { mode, url: 'grammar.html?u=ga-01' });
    for (const k of ['Enter', ' ']) {
      const before = await snap(s);
      await s.eval("document.querySelectorAll('.q-block .opt')[1].focus(); true");
      await key(s, k);
      const st = await state(s);
      const main = await s.eval(MAIN);
      const into = await s.eval(FOCUS);   // 視窗一開焦點就要在視窗裡,「回到原按鈕」才有驗到東西
      const closed = await closeBy(s, 'esc');
      const back = await s.eval("document.activeElement === document.querySelectorAll('.q-block .opt')[1]");
      const ls = lsDiff(before.ls, (await snap(s)).ls);
      out.push({ mode, k, ok: st.mask && st.x && into.inMask && main === before.main && closed && back && !ls.length, st: { mask: st.mask, x: st.x }, into: into.tag, back, ls });
    }
    await s.close();
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 已登入、已選學生:跟以前一樣,打開不跳、作答生效、寫進自己的資料夾(包括開頁頭一秒雲端還沒確認登入時) */
T['已登入(雲端)與已選學生(本機):打開不跳視窗,作答照常生效、寫進自己的資料夾;雲端還沒確認登入(頭幾秒)就作答也一樣'] = async (B) => {
  const out = [];
  const user = USER;
  const runs = [
    { name: '雲端已登入', o: { mode: 'cloud', user }, prefix: 'tr_u' + CPID + '_' },
    { name: '雲端已登入、getSession 慢 4 秒', o: { mode: 'cloud', user, delay: 4000, early: true }, prefix: 'tr_u' + CPID + '_' },
    { name: '本機已選學生', o: { mode: 'local', profile: true }, prefix: 'tr_u' + LPID + '_' },
  ];
  for (const r of runs) {
    const s = await open(B, Object.assign({ url: 'grammar.html?u=ga-01' }, r.o));
    let ready0 = null;
    if (r.o.early) { await s.eval("new Promise((res) => { const go = () => setTimeout(res, 200); if (window.PROFILE) go(); else addEventListener('DOMContentLoaded', go); })"); ready0 = await s.eval('!!(window.CLOUD && CLOUD.user)'); }
    await click(s, '.q-block .opt');
    const a = await state(s);
    const done = await s.eval("!!document.querySelector('.q-block .opt.correct')");
    if (r.o.early) { await s.eval('CLOUD.ready.then(() => true)'); await sleep(800); }
    const b = await state(s);
    const ls = JSON.parse(await s.eval(LS));
    const wrote = Object.keys(ls).some((k) => k === r.prefix + 'hist');
    const guestHist = 'tr_hist' in ls;
    await s.close();
    /* 寫作框:打得進字、會自動存 */
    const w = await open(B, Object.assign({ url: 'writing.html?level=l1&u=23' }, r.o, { early: false }));
    await click(w, 'textarea.write-area');
    await w.send('Input.insertText', { text: 'I like it.' });
    await sleep(1400);
    const wl = JSON.parse(await w.eval(LS));
    const ws = await state(w);
    await w.close();
    const typed = !!wl[r.prefix + 'writing_b'] && /I like it/.test(wl[r.prefix + 'writing_b']);
    out.push({ name: r.name, ok: !a.mask && !b.mask && done && wrote && !guestHist && typed && !ws.mask && (ready0 === null || ready0 === false), mask: [a.mask, b.mask, ws.mask], done, wrote, guestHist, typed, ready0 });
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 主畫面 App:內容頁沒登入一打開沒有 app-gate、沒有 inert;作答跳出的視窗可以關、蓋滿整個畫面;個人頁照舊露出頂欄與分頁列、其他設 inert */
T['App 外殼:內容頁沒登入打開不鎖畫面,作答跳出可關的全螢幕視窗;個人頁照舊強制登入(app-gate + inert)'] = async (B) => {
  const s = await open(B, { mode: 'cloud', url: 'grammar.html?u=ga-01', app: true });
  const a = await state(s);
  const before = await snap(s);
  await click(s, '.q-block .opt');
  const b = await state(s);
  const main = await s.eval(MAIN);
  const closed = await closeBy(s, 'x');
  await s.close();
  const p = await open(B, { mode: 'cloud', url: 'history.html', app: true });
  const c = await state(p);
  await p.close();
  const ok = a.shell && !a.mask && !a.inert && !a.gate && b.mask && b.x && !b.gate && !b.inert && b.top === 0 && main === before.main && closed
    && c.shell && c.mask && c.gate && c.inert > 0 && !c.x;
  return { ok, detail: J({ open: a, act: b, closed, personal: c }) };
};

/* 上線那幾分鐘:頁面程式已經是新的,common.js 還是瀏覽器快取裡的上一版(GitHub Pages max-age 600,script 沒帶版本參數)。
   頁面程式用到 common.js 這次才有的 canKeepProgress 時要先看它在不在,不在就跟改動前一樣照存 */
function oldCommon() {
  if (OLD_COMMON) return fs.readFileSync(OLD_COMMON, 'utf8');
  return fs.readFileSync(path.join(REPO, 'js', 'common.js'), 'utf8').replace(/\bcanKeepProgress\b/g, 'oldCommonHasNoCanKeepProgress');
}
T['新舊檔混用:common.js 還是上一版(沒有 canKeepProgress)時,已登入與已選學生的寫作照常自動存,慢速、換字庫、對話聽過也照常存,頁面沒有 JS 錯誤'] = async (B) => {
  const out = [];
  SWAP = { '/js/common.js': oldCommon() };
  try {
    for (const r of [{ name: '雲端已登入', o: { mode: 'cloud', user: USER }, prefix: 'tr_u' + CPID + '_' }, { name: '本機已選學生', o: { mode: 'local', profile: true }, prefix: 'tr_u' + LPID + '_' }]) {
      const res = { name: r.name };
      const w = await open(B, Object.assign({ url: 'writing.html?level=l1&u=23' }, r.o));
      res.old = await w.eval('typeof canKeepProgress');
      await click(w, 'textarea.write-area');
      await w.send('Input.insertText', { text: 'I like it.' });
      await sleep(1400);
      await w.eval('document.activeElement && document.activeElement.blur(); true');
      await sleep(200);
      res.writing = /I like it/.test(JSON.parse(await w.eval(LS))[r.prefix + 'writing_b'] || '') && /已儲存/.test(await w.eval("(document.querySelector('.wc-bar') || {}).textContent || ''"));
      await w.close();
      const p = await open(B, Object.assign({ url: 'phonics.html?u=pa-01' }, r.o));
      await click(p, 'button.ph-slow');
      res.slow = (await p.eval("!!document.querySelector('button.ph-slow.on')")) && JSON.parse(await p.eval(LS))[r.prefix + 'ph_slow'] === 'true';
      await p.close();
      /* 換字庫:存起來,下面的遊戲卡片照新的字庫重畫(片語的最佳紀錄出現) */
      const v = await open(B, Object.assign({ url: 'vocab.html' }, r.o, { ls: { [r.prefix + 'vgame_best']: J({ phrase: 12 }) } }));
      await v.eval("(() => { const e = document.querySelector('.vg-source select'); e.value = 'phrase'; e.dispatchEvent(new Event('change')); return true; })()");
      await sleep(300);
      const src = JSON.parse(await v.eval(LS))[r.prefix + 'vgame_src'];
      res.src = !!src && JSON.parse(src).mode === 'phrase' && /最佳 中翻英 12/.test(await v.eval("document.querySelector('.vg-games').textContent"));
      await v.close();
      const d = await open(B, Object.assign({ url: 'dialogue.html?id=dlg-01' }, r.o));
      await click(d, '.dlg-bubble');
      await sleep(300);
      const heard = JSON.parse(await d.eval(LS))[r.prefix + 'dlg_heard'];
      res.heard = /聽過 1\//.test(await d.eval("(document.querySelector('.vocab-progress') || {}).textContent || ''")) && /dlg-01/.test(heard || '');
      await d.close();
      res.ok = res.old === 'undefined' && res.writing && res.slow && res.src && res.heard;
      out.push(res);
    }
  } finally { SWAP = null; }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 作答被攔下跳出的視窗:一開焦點就在視窗裡(滑鼠、Enter、作答框打字都一樣),Tab 在視窗裡轉,接著打的字進視窗的輸入框;
   說明那一句是視窗的描述(aria-describedby),螢幕報讀會念。觸控螢幕停在視窗標題,不要一按作答就跳出鍵盤蓋住卡片 */
T['焦點:作答跳出的視窗一開焦點就在視窗裡(滑鼠、作答框打字、觸控),Tab 不跑出去,打的字進視窗,說明是視窗的描述(雲端與本機)'] = async (B) => {
  const out = [];
  for (const mode of ['cloud', 'local']) {
    let s = await open(B, { mode, url: 'grammar.html?u=ga-01' });
    await click(s, '.q-block .opt', 1);
    const f1 = await s.eval(FOCUS);
    let tabsIn = true;
    for (let k = 0; k < 5; k++) { await key(s, 'Tab'); if (!(await s.eval(FOCUS)).inMask) tabsIn = false; }
    for (let k = 0; k < 5; k++) { await key(s, 'Tab', true); if (!(await s.eval(FOCUS)).inMask) tabsIn = false; }
    await closeBy(s, 'esc');
    await s.close();
    out.push({ mode, how: '滑鼠', ok: f1.inMask && WHY[mode].test(f1.desc) && tabsIn, at: f1.tag, desc: f1.desc, tabsIn });

    s = await open(B, { mode, url: 'writing.html?level=l1&u=23' });
    await s.eval("document.querySelector('textarea.write-area').focus(); true");
    await key(s, 'a');
    const f2 = await s.eval(FOCUS);
    await s.send('Input.insertText', { text: 'me@example.com' });
    await sleep(200);
    const got = await s.eval("({ field: document.activeElement ? document.activeElement.value : null, ta: document.querySelector('textarea.write-area').value })");
    await closeBy(s, 'esc');
    const back = await s.eval("document.activeElement === document.querySelector('textarea.write-area')");
    await s.close();
    out.push({ mode, how: '作答框打字', ok: f2.inMask && /^INPUT/.test(f2.tag) && got.field === 'me@example.com' && got.ta === '' && back, at: f2.tag, got, back });

    s = await open(B, { mode, url: 'grammar.html?u=ga-01', touch: true });
    const coarse = await s.eval("matchMedia('(pointer: coarse)').matches");
    await tap(s, '.q-block .opt', 1);
    const f3 = await s.eval(FOCUS);
    await s.close();
    out.push({ mode, how: '觸控', ok: coarse && f3.inMask && /^H2/.test(f3.tag) && WHY[mode].test(f3.desc), coarse, at: f3.tag });
  }
  return { ok: out.every((x) => x.ok), detail: J(out.filter((x) => !x.ok).length ? out.filter((x) => !x.ok) : out.map((x) => x.mode + ' ' + x.how + ' → ' + x.at)) };
};

/* 關掉之後焦點回到被按的那個東西(閱讀頁文章裡的單字是 span,也一樣),不跑到頂欄的頭像按鈕;X、Esc、點遮罩都一樣,頁面不捲動;
   焦點離開之後那個字不留下 tabindex(畫面一個字都不變) */
T['焦點回原處:關掉作答跳出的視窗(X、Esc、點遮罩),焦點回到被按的按鈕或文章單字,不跑到頂欄、不捲動(雲端、本機、App 外殼)'] = async (B) => {
  const out = [];
  const W = '.article-body .vw[data-gate]';
  const cases = [
    { mode: 'cloud', url: 'reading.html?id=art-1a', sel: W, i: 9 },
    { mode: 'local', url: 'reading.html?id=art-1a', sel: W, i: 9 },
    { mode: 'cloud', url: 'reading.html?id=art-1a', sel: W, i: 9, app: true },
    { mode: 'cloud', url: 'grammar.html?u=ga-01', sel: '.q-block .opt', i: 1 },
    { mode: 'local', url: 'grammar.html?u=ga-01', sel: '.q-block .opt', i: 1 },
  ];
  for (const c of cases) {
    const s = await open(B, { mode: c.mode, url: c.url, app: c.app });
    const before = await s.eval(MAIN);
    for (const how of c.app ? ['esc', 'x'] : ['esc', 'x', 'mask']) {
      const p = await point(s, c.sel, c.i);
      const y0 = await s.eval('Math.round(scrollY)');
      await mouse(s, p.x, p.y);
      await sleep(350);
      const opened = (await state(s)).mask;
      const closed = await closeBy(s, how);
      const r = await s.eval(`(() => { const e = document.querySelectorAll(${J(c.sel)})[${c.i}], a = document.activeElement;
        return { back: a === e, at: a ? a.tagName + '.' + String(a.className).split(' ')[0] : '', y: Math.round(scrollY) }; })()`);
      await s.eval('document.activeElement && document.activeElement.blur && document.activeElement.blur(); true');
      out.push({ page: c.url + (c.app ? ' App' : '') + ' ' + c.mode, how, ok: opened && closed && r.back && r.y === y0, at: r.at, y: [y0, r.y] });
    }
    const after = await s.eval(MAIN);
    await s.close();
    out.push({ page: c.url + (c.app ? ' App' : '') + ' ' + c.mode, how: '畫面不變', ok: after === before });
  }
  const bad = out.filter((x) => !x.ok);
  return { ok: !bad.length, detail: J(bad.length ? bad : out.length + ' 項都對') };
};

/* 本機「你是哪位？」:還沒有任何檔案時畫面只有「建立你的檔案」,說明也請他建;已經有檔案時才請他選 */
T['本機「你是哪位？」的說明跟著畫面:還沒有檔案時請他建一個,已經有檔案時請他選'] = async (B) => {
  const out = [];
  for (const has of [false, true]) {
    const s = await open(B, { mode: 'local', url: 'grammar.html?u=ga-01', ls: has ? { tr_profiles: J([{ id: LPID, name: '小安', created: '2026-10-01' }]) } : {} });
    await click(s, '.q-block .opt');
    const st = await state(s);
    const list = await s.eval("!!document.querySelector('.modal-mask .modal-list')");
    await s.close();
    const ok = st.mask && (has ? /^選好你的檔案才能作答/.test(st.why) && list : /^建好你的檔案才能作答/.test(st.why) && !list);
    out.push({ has, ok, why: st.why, list });
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 第 2 輪審查 #1:沒登入按「播放全部」,播到一半從頭像選單登入。登入成功(CLOUD.user 有了)到頁面重載之間,這一頁的資料夾還是訪客的;
   這時下一句開始播(第 1 句播完的 ended),不能寫進訪客資料夾、不能記進帳號的帳本。記了帳,灌資料時會把帳號在雲端的那一列當成
   「本機比較新」,讀不到本機的值就上傳 null,把各裝置的「聽過幾句」整列清掉。教師查詢慢 1.5 秒,登入一定落在這段時間裡 */
const AUDIO_HOOK = '(() => { const p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__audio = this; return p.call(this); }; })();';
T['播到一半登入:登入到重載之間下一句開始播,不寫訪客資料夾、不記帳,帳號雲端的「聽過幾句」不被蓋掉,重載後灌回帳號資料夾'] = async (B) => {
  const heard = { 'dlg-02': [0, 1, 2, 3], 'dlg-05': [0, 1, 2, 3, 4, 5] };
  const rows = [{ k: 'dlg_heard', v: heard, updated_at: '2026-10-20T00:00:00.000Z' }];
  const s = await open(B, { url: 'dialogue.html?id=dlg-01', sdk: fakeCloud({ user: USER, teachersDelay: 1500 }), pre: AUDIO_HOOK, ss: { __fake_rows: J(rows) } });
  const r = {};
  try {
    await click(s, '.reader-toolbar .btn.primary');   // 播放全部
    r.playing = /停止/.test(await s.eval("document.querySelector('.reader-toolbar .btn.primary').textContent"));
    await click(s, '.profile-btn');
    await click(s, '.profile-menu .pm-item');          // 登入
    await s.eval("document.querySelector('.modal-auth input[type=email]').focus(); true");
    await s.send('Input.insertText', { text: USER.email });
    await s.eval("document.querySelector('.modal-auth input[name=password]').focus(); true");
    await s.send('Input.insertText', { text: 'password123' });
    await s.eval('window.__old = 1; true');
    await click(s, '.modal-auth .auth-submit');
    for (let i = 0; i < 40 && !(await s.eval('!!CLOUD.user')); i++) await sleep(25);
    r.window = await s.eval("!!CLOUD.user && !CLOUD.reloading && window.__PROFILE_ID === null && !!window.__audio");
    await s.eval("window.__audio.dispatchEvent(new Event('ended')); true");   // 第 1 句播完,播放全部接著播第 2 句
    const mid = JSON.parse(await s.eval(LS));
    for (let i = 0; i < 100; i++) { await sleep(100); try { if ((await s.eval('!window.__old && document.readyState')) === 'complete') break; } catch (e) { /* 換頁中 */ } }
    await s.eval('CLOUD.ready.then(() => true)');
    await sleep(500);
    const end = JSON.parse(await s.eval(LS));
    const ups = JSON.parse(await s.eval("sessionStorage.getItem('__fake_up') || '[]'"));
    const db = JSON.parse(await s.eval("sessionStorage.getItem('__fake_rows') || '[]'"));
    const led = (x) => Object.keys(JSON.parse(x['tr_unsynced_' + UID] || '{}'));
    r.guest = ['tr_dlg_heard' in mid, 'tr_dlg_heard' in end];
    r.ledger = led(mid).concat(led(end));
    r.uploaded = ups.filter((u) => u.k !== '_meta');
    r.cloud = J((db.find((x) => x.k === 'dlg_heard') || {}).v);
    r.local = J(JSON.parse(end['tr_u' + CPID + '_dlg_heard'] || 'null'));
    r.reloaded = end.tr_current_profile === J(CPID);
  } finally { await s.close(); }
  const ok = r.playing && r.window && !r.guest[0] && !r.guest[1] && !r.ledger.includes('dlg_heard') && !r.uploaded.length
    && r.cloud === J(heard) && r.local === J(heard) && r.reloaded;
  return { ok, detail: J(r) };
};

/* 第 2 輪審查 #2:付費牆(PAID_UI 打開、試用結束)在 App 外殼裡跟登入視窗一樣露出頂欄和分頁列,分頁點得到(內容頁改成 on-action 之後也一樣) */
T['付費牆:App 外殼裡內容頁與個人頁的遮罩都露出頂欄和分頁列,點分頁換得了頁'] = async (B) => {
  const out = [];
  SWAP = { '/js/plans-config.js': fs.readFileSync(path.join(REPO, 'js', 'plans-config.js'), 'utf8').replace(/window\.PAID_UI\s*=\s*false/, 'window.PAID_UI = true') };
  const access = { active: false, source: 'trial', trial_until: '2026-10-20T00:00:00.000Z', server_now: new Date().toISOString(), is_owner: false, classes: [] };
  try {
    for (const url of ['grammar.html?u=ga-01', 'reading.html?id=art-1a', 'writing.html?level=l1&u=23', 'review.html']) {
      const s = await open(B, { url, app: true, user: USER, sdk: fakeCloud({ user: USER, access }), ls: { [SB]: J({ access_token: 'x', user: USER }) } });
      try {
        await s.eval('CLOUD.accessReady.then(() => true)');
        await sleep(400);
        const m = await s.eval(`(() => { const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; };
          const tab = [...document.querySelectorAll('.app-tabbar a.app-tab')].find((a) => !location.pathname.endsWith('/' + a.getAttribute('href')));
          const b = tab && tab.getBoundingClientRect(), x = b && b.x + b.width / 2, y = b && b.y + b.height / 2, hit = b && document.elementFromPoint(x, y);
          return { mask: r('.pw-mask'), bar: r('.topbar'), tabs: r('.app-tabbar'), hit: !!(hit && hit.closest('.app-tabbar')), x, y, href: tab && tab.getAttribute('href') }; })()`);
        if (m.x !== undefined && m.x !== null) { await mouse(s, m.x, m.y); await sleep(600); }
        const went = await s.eval('location.pathname');
        const ok = !!m.mask && !!m.bar && !!m.tabs && m.mask[0] >= m.bar[1] - 1 && m.mask[1] <= m.tabs[0] + 1 && m.hit && went === '/' + m.href;
        out.push({ url, ok, mask: m.mask, bar: m.bar, tabs: m.tabs, hit: m.hit, went });
      } finally { await s.close(); }
    }
  } finally { SWAP = null; }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 第 2 輪審查 #3:矮一點的手機(iPhone SE、mini 的 Safari、Android)上,作答跳出的登入卡(切到註冊更高)比畫面高時遮罩可以捲:
   捲到最上面 X、標題、說明句都在畫面裡,捲到最下面看得到「已經有帳號？登入」那一列 */
T['矮手機:作答跳出的登入卡、註冊卡比畫面高時可以捲,X、標題、說明句、最下面的切換列都看得到'] = async (B) => {
  const out = [];
  for (const c of [{ w: 375, h: 627, tab: 'signup' }, { w: 360, h: 640, tab: 'signup' }, { w: 375, h: 548, tab: 'login' }, { w: 375, h: 548, tab: 'signup' }]) {
    const s = await open(B, { mode: 'cloud', url: 'grammar.html?u=ga-01', touch: true, size: { width: c.w, height: c.h } });
    try {
      await tap(s, '.q-block .opt');
      if (c.tab === 'signup') { await s.eval("document.querySelector('.modal-auth .auth-switch .auth-link').click(); true"); await sleep(300); }
      const m = await s.eval(`(() => { const mask = document.querySelector('.modal-mask'); if (!mask) return null;
        const y = (sel, end) => { const e = mask.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return Math.round(end ? b.bottom : b.top); };
        mask.scrollTop = 0; const top = { x: y('.modal-close'), h2: y('h2'), why: y('.auth-why') };
        mask.scrollTop = 1e6; return { top, end: y('.auth-switch', true), vh: innerHeight, title: (mask.querySelector('h2') || {}).textContent }; })()`);
      const ok = !!m && m.top.x >= 0 && m.top.h2 >= 0 && m.top.why >= 0 && m.end !== null && m.end <= m.vh && (c.tab === 'signup' ? /註冊/ : /登入/).test(m.title);
      out.push({ size: c.w + 'x' + c.h, tab: c.tab, ok, m });
    } finally { await s.close(); }
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 第 3 輪審查 #1:登入失效(別台按「登出所有裝置」)改回訪客,或別的分頁登出(帳號資料夾刪掉了),這個分頁灌過資料的旗標還在。
   在同一個分頁用 Google 登回來:這一頁的資料夾不是這個帳號的,要跟剛登入一樣灌資料、重載,之後作答照常寫進帳號資料夾、不跳登入卡,
   上傳的是「雲端原本的 + 新的這一筆」,不能只剩新的這一筆(帳號資料夾是空的時候直接上傳,會把雲端整列蓋掉) */
async function settleNav(s, ms) {
  const end = Date.now() + (ms || 12000);
  while (Date.now() < end) {
    await sleep(150);
    try {
      if (await s.eval("!window.__old && document.readyState === 'complete' && !!window.CLOUD && CLOUD.ready.then(() => !CLOUD.reloading, () => !CLOUD.reloading)")) return true;
    } catch (e) { /* 換頁中 */ }
  }
  return false;
}
T['登入失效或別的分頁登出之後,同一分頁用 Google 登回來:灌資料重載,作答照常寫進帳號資料夾、不跳登入卡,雲端原本的紀錄不被蓋掉'] = async (B) => {
  const out = [];
  const day = Date.now() - 864e5;
  const oldHist = [0, 1, 2].map((n) => ({ m: 'g', id: 'old-' + n, c: 0, ok: true, t: day + n }));
  for (const how of ['登入失效(帳號資料夾還在)', '別的分頁登出(帳號資料夾刪掉了)']) {
    const ls = how.indexOf('還在') > -1 ? { ['tr_u' + CPID + '_hist']: J(oldHist) } : {};
    const ss = { ['tr_cloud_hydrated_' + UID]: '1', __fake_rows: J([{ k: 'hist', v: oldHist, updated_at: new Date(day + 10).toISOString() }]) };
    /* 讀雲端 progress 慢 1.5 秒:Google 回來那一頁灌資料的這段時間看得到(這時作答只擋下、不跳登入卡) */
    const s = await open(B, { url: 'grammar.html?u=ga-01', sdk: fakeCloud({ user: USER, progressDelay: 1500 }), ls, ss });
    const r = { how };
    try {
      r.guest = await s.eval('!CLOUD.user && window.__PROFILE_ID === null');
      await click(s, '.q-block .opt');
      r.card = WHY.cloud.test((await state(s)).why);
      await s.eval('window.__old = 1; true');
      await click(s, '.modal-auth .btn-google');
      for (let i = 0; i < 40 && (await s.eval('location.pathname').catch(() => '')) !== '/robots.txt'; i++) await sleep(100);   // 到了「Google」
      const to = await s.eval("sessionStorage.getItem('__fake_oauth_to')");
      await s.send('Page.navigate', { url: to + '#access_token=fakegoogle&token_type=bearer&expires_in=3600' });
      /* 灌資料中(已經登入、資料夾還是訪客的、還沒要重載):作答只擋下,不跳「登入之後才能作答」 */
      let busy = false;
      for (let i = 0; i < 60 && !busy; i++) { await sleep(50); try { busy = await s.eval("document.readyState !== 'loading' && !!window.CLOUD && !!CLOUD.user && window.__PROFILE_ID === null && !CLOUD.reloading && !!document.querySelector('.q-block .opt')"); } catch (e) { /* 換頁中 */ } }
      if (busy) {
        await s.eval('window.__busy = 1; true');
        try { await click(s, '.q-block .opt'); r.during = await s.eval('window.__busy === 1 ? !document.querySelector(".modal-mask") : "reloaded"'); } catch (e) { r.during = 'reloaded'; }
      } else r.during = 'no-window';
      r.settled = await settleNav(s);
      await sleep(1300);
      r.after = await s.eval(`({ user: !!CLOUD.user, pid: window.__PROFILE_ID === ${J(CPID)}, canAct: PROFILE.canAct() })`);
      const before = await snap(s);
      await click(s, '.q-block .opt');
      const st = await state(s);
      r.mask = st.mask;
      r.answered = await s.eval("!!document.querySelector('.q-block .opt.correct')");
      await sleep(1500);   // 上傳(0.8 秒去抖動)
      const end = JSON.parse(await s.eval(LS));
      const local = JSON.parse(end['tr_u' + CPID + '_hist'] || '[]');
      const db = JSON.parse(await s.eval("sessionStorage.getItem('__fake_rows') || '[]'"));
      const cloud = (db.find((x) => x.k === 'hist') || {}).v || [];
      r.local = local.length;
      r.cloud = cloud.length;
      r.guestHist = 'tr_hist' in end;
      r.screen = before.main !== (await s.eval(MAIN));
      r.ok = r.guest && r.card && r.during === true && r.settled && r.after.user && r.after.pid && r.after.canAct && !r.mask && r.answered && r.screen
        && r.local === oldHist.length + 1 && r.cloud === oldHist.length + 1 && !r.guestHist;
    } finally { await s.close(); }
    out.push(r);
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 第 3 輪審查 #2:桌機視窗比卡片矮(1366x768 的筆電、1920x1080 放大 125%)時遮罩有捲軸。按住捲軸拖是要捲動看下面,
   不是點遮罩:視窗不能關、打的字要還在。點遮罩的空白處照樣關 */
T['桌機矮視窗:按住登入卡、註冊卡、「你是哪位？」遮罩的捲軸拖動不會關掉視窗,打的字還在;點遮罩空白處照樣關'] = async () => {
  const out = [];
  const L = await launch(true);
  const B = await connect(L.ws);
  try {
    const cases = [
      { mode: 'cloud', w: 1280, h: 600, tab: 'signup' }, { mode: 'cloud', w: 1280, h: 560, tab: 'login' },
      { mode: 'local', w: 1280, h: 300 },
    ];
    for (const c of cases) {
      const s = await open(B, { mode: c.mode, url: 'grammar.html?u=ga-01', size: { width: c.w, height: c.h }, desktop: true });
      const r = { case: c.mode + ' ' + c.w + 'x' + c.h + (c.tab ? ' ' + c.tab : '') };
      try {
        await click(s, '.q-block .opt');
        if (c.tab === 'signup') { await s.eval("document.querySelector('.modal-auth .auth-switch .auth-link').click(); true"); await sleep(300); }
        const field = c.mode === 'cloud' ? '.modal-mask .auth input.auth-input' : '.modal-mask .modal-input';
        await s.eval(`document.querySelector(${J(field)}).focus(); true`);
        await s.send('Input.insertText', { text: 'typed-by-user' });
        const m = await s.eval(`(() => { const m = document.querySelector('.modal-mask'); if (!m) return null; const b = m.getBoundingClientRect();
          return { left: b.left, top: b.top, cw: m.clientWidth, ow: m.offsetWidth, ch: m.clientHeight, sh: m.scrollHeight }; })()`);
        r.bar = !!m && m.ow - m.cw > 0 && m.sh > m.ch;
        if (r.bar) {
          const x = m.left + m.cw + (m.ow - m.cw) / 2;
          await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 60 });
          await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: 60, button: 'left', buttons: 1, clickCount: 1 });
          await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: Math.min(200, c.h - 40), button: 'left', buttons: 1 });
          await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: Math.min(200, c.h - 40), button: 'left', buttons: 0, clickCount: 1 });
          await sleep(300);
          r.still = (await state(s)).mask;
          r.kept = await s.eval(`(document.querySelector(${J(field)}) || {}).value === 'typed-by-user'`);
          /* 點遮罩左邊的空白處:照樣關 */
          await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 4, y: 100, button: 'left', buttons: 1, clickCount: 1 });
          await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 4, y: 100, button: 'left', buttons: 0, clickCount: 1 });
          await sleep(300);
          r.closed = !(await state(s)).mask;
        }
        r.ok = r.bar && r.still && r.kept && r.closed;
      } finally { await s.close(); }
      out.push(r);
    }
    if (B.errors.length) out.push({ ok: false, errors: B.errors.slice(0, 3) });
  } finally {
    try { await Promise.race([B.send('Browser.close'), sleep(3000)]); } catch (e) { /* 照樣往下 */ }
    B.ws.close();
    if (L.proc.exitCode === null) L.proc.kill();
    await sleep(1500);
    try { fs.rmSync(L.dir, { recursive: true, force: true }); } catch (e) { console.log('使用者資料夾沒刪掉:' + L.dir); }
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 第 3 輪審查 #3:閱讀頁單字考題說「字卡拖進空格」,拖曳是第一種作答方法。沒登入時拖不動,放開那一下要跳出視窗說明為什麼
   (觸控:放開時根本沒有 click;滑鼠:click 落在字卡與空格共同的外層,不在作答元素上)。
   一般作答鈕按下去拖開再放(取消點擊的慣例)不跳。已登入的人照樣拖得進去 */
T['拖曳:閱讀頁字卡拖進空格(觸控)沒登入時放開就跳出視窗,畫面與資料不變;一般作答鈕按下去拖開不跳;已登入照樣拖得進去'] = async (B) => {
  const out = [];
  for (const mode of ['cloud', 'local']) {
    const s = await open(B, { mode, url: 'reading.html?id=art-1a', touch: true });
    try {
      const before = await snap(s);
      const { a, b } = await chipAndBlank(s);
      await touchDrag(s, a, b);
      const st = await state(s);
      const after = await snap(s);
      const ghost = await s.eval('!!document.querySelector(".tq-ghost")');
      if (st.mask) await closeBy(s, 'esc');
      out.push({ mode, how: '觸控拖字卡', ok: st.mask && st.x && WHY[mode].test(st.why) && after.main === before.main && !lsDiff(before.ls, after.ls).length && !ghost, st: { mask: st.mask, why: st.why } });
    } finally { await s.close(); }
    const g = await open(B, { mode, url: 'grammar.html?u=ga-01' });
    try {
      const p = await point(g, '.q-block .opt', 0);
      await mouseDrag(g, p, { x: 10, y: p.y });   // 拖到頁面左邊的空白處再放
      const st = await state(g);
      out.push({ mode, how: '作答鈕按下去拖開', ok: !st.mask, mask: st.mask });
    } finally { await g.close(); }
  }
  for (const o of [{ mode: 'cloud', user: USER }, { mode: 'local', profile: true }]) {
    for (const how of ['mouse', 'touch']) {
      const s = await open(B, Object.assign({ url: 'reading.html?id=art-1a', touch: how === 'touch' }, o));
      try {
        const { a, b } = await chipAndBlank(s);
        if (how === 'touch') await touchDrag(s, a, b); else await mouseDrag(s, a, b);
        const filled = await s.eval("document.querySelectorAll('.tq-blank.filled').length");
        out.push({ mode: o.mode + ' 已登入', how, ok: filled === 1 && !(await state(s)).mask, filled });
      } finally { await s.close(); }
    }
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 第 3 輪審查 #4:作答框按 Ctrl+V 貼上、把別處的文字拖進來,跟打字一樣是作答:沒登入時跳出視窗、框裡什麼都沒進來、什麼都不寫。
   已登入的人拖得進去 */
T['貼上、拖文字進作答框:沒登入時跳出視窗,框裡沒有字、資料不變;關掉後再貼又跳;已登入的人拖得進去'] = async (B) => {
  const out = [];
  const TA = 'textarea.write-area';
  for (const mode of ['cloud', 'local']) {
    const s = await open(B, { mode, url: 'writing.html?level=l1&u=23' });
    try {
      const before = await snap(s);
      await s.eval(`document.querySelector(${J(TA)}).focus(); true`);
      await ctrlV(s);
      const st1 = await state(s);
      const pastes = await s.eval('window.__pastes');
      await closeBy(s, 'esc');
      const back = await s.eval(`document.activeElement === document.querySelector(${J(TA)})`);
      await ctrlV(s);
      const st2 = await state(s);
      if (st2.mask) await closeBy(s, 'esc');
      const p = await point(s, TA);
      await dropText(s, p.x, p.y, 'Dropped draft.');
      const st3 = await state(s);
      if (st3.mask) await closeBy(s, 'esc');
      await s.eval('document.activeElement && document.activeElement.blur && document.activeElement.blur(); true');
      await sleep(1100);
      const after = await snap(s);
      const value = await s.eval(`document.querySelector(${J(TA)}).value`);
      const ok = pastes >= 1 && st1.mask && WHY[mode].test(st1.why) && back && st2.mask && st3.mask && WHY[mode].test(st3.why) && value === ''
        && after.main === before.main && !lsDiff(before.ls, after.ls).length;
      out.push({ mode, ok, pastes, paste: st1.mask, again: st2.mask, back, drop: st3.mask, value, ls: lsDiff(before.ls, after.ls) });
    } finally { await s.close(); }
  }
  for (const o of [{ mode: 'cloud', user: USER }, { mode: 'local', profile: true }]) {
    const s = await open(B, Object.assign({ url: 'writing.html?level=l1&u=23' }, o));
    try {
      const p = await point(s, TA);
      await dropText(s, p.x, p.y, 'Dropped draft.');
      const value = await s.eval(`document.querySelector(${J(TA)}).value`);
      out.push({ mode: o.mode + ' 已登入', ok: /Dropped draft/.test(value) && !(await state(s)).mask, value });
    } finally { await s.close(); }
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 第 4 輪審查 #1:先看再登入的主要流程是「沒登入按作答 → 登入卡 → Google → 回到同一個內容頁」。回來那一頁內容先畫好,
   supabase-js 要先拿網址上的 access_token 去問帳號(getSession 慢),這段時間 CLOUD.user 是 null、資料夾還是訪客的。
   這時按作答(通常一回來就再按剛剛那一題)只擋下,不能跳「登入之後才能作答」;確認完灌資料、重載,之後照常作答。
   另外這一頁正要灌資料重載時,開著的登入卡上按 Google 不導去 Google(location.assign 會蓋掉重載,剛登入的人又被送去 Google 一次);
   送密碼不導頁、蓋不掉重載,照舊送(tools/test_sync.js 情境 30 就是這樣),最後一樣是登入後的畫面、雲端與本機的紀錄一筆不少 */
const GOOGLE_BACK = '#access_token=fakegoogle&token_type=bearer&expires_in=3600';
/* 在這個分頁開一個網址,內容一出現就回來(不等雲端確認登入) */
async function openNow(s, url) {
  await s.send('Page.navigate', { url: s.origin + '/' + url });
  for (let i = 0; i < 250; i++) { await sleep(20); try { if (await s.eval("!!document.querySelector('.q-block .opt')")) return true; } catch (e) { /* 換頁中 */ } }
  return false;
}
const PICKED = "document.querySelectorAll('.q-block .opt.correct, .q-block .opt.wrong').length";
T['Google 登入回來、雲端還沒確認登入:按作答只擋下、不跳「登入之後才能作答」,確認完照常作答;正要重載時卡上按 Google 不再被送去 Google、送密碼也停在登入後的畫面'] = async (B) => {
  const out = [];
  const day = Date.now() - 864e5;
  const oldHist = [0, 1, 2].map((n) => ({ m: 'g', id: 'old-' + n, c: 0, ok: true, t: day + n }));
  const rows = J([{ k: 'hist', v: oldHist, updated_at: new Date(day + 10).toISOString() }]);
  for (const how of ['第一次登入', '登入失效後同分頁登回來']) {
    const ss = { __fake_rows: rows };
    if (how !== '第一次登入') ss['tr_cloud_hydrated_' + UID] = '1';
    const s = await open(B, { url: 'robots.txt', early: true, sdk: fakeCloud({ user: USER, sessionDelay: 1500, progressDelay: 600 }), ss });
    const r = { how };
    try {
      r.shown = await openNow(s, 'grammar.html?u=ga-01' + GOOGLE_BACK);
      r.at = await s.eval('({ user: !!CLOUD.user, pid: window.__PROFILE_ID, reloading: CLOUD.reloading })');
      const before = await snap(s);
      await s.eval('window.__old = 1; true');
      await click(s, '.q-block .opt');
      const st = await state(s);
      r.card = st.mask ? st.why || st.title : false;
      r.picked = await s.eval(PICKED);
      r.same = (await s.eval(MAIN)) === before.main;
      r.stillWaiting = await s.eval('window.__old === 1 && !CLOUD.user');   // 擋下的那一下真的落在雲端確認之前
      r.settled = await settleNav(s);
      await sleep(1300);
      r.after = await s.eval(`({ user: !!CLOUD.user, pid: window.__PROFILE_ID === ${J(CPID)}, canAct: PROFILE.canAct() })`);
      await click(s, '.q-block .opt');
      r.mask = (await state(s)).mask;
      r.answered = await s.eval("!!document.querySelector('.q-block .opt.correct')");
      await sleep(1500);   // 上傳(0.8 秒去抖動)
      const end = JSON.parse(await s.eval(LS));
      const db = JSON.parse(await s.eval("sessionStorage.getItem('__fake_rows') || '[]'"));
      r.local = JSON.parse(end['tr_u' + CPID + '_hist'] || '[]').length;
      r.cloud = ((db.find((x) => x.k === 'hist') || {}).v || []).length;
      r.guestHist = 'tr_hist' in end;
      r.ok = r.shown && !r.at.user && r.at.pid === null && !r.at.reloading && r.card === false && r.picked === 0 && r.same && r.stillWaiting
        && r.settled && r.after.user && r.after.pid && r.after.canAct && !r.mask && r.answered
        && r.local === oldHist.length + 1 && r.cloud === oldHist.length + 1 && !r.guestHist;
    } finally { await s.close(); }
    out.push(r);
  }
  /* 這一頁開著登入卡、正要灌資料重載(開頁時這台已經有登入資料,資料夾卻還是訪客的):卡上按 Google、送密碼 */
  for (const how of ['Google', '密碼']) {
    const s = await open(B, { url: 'robots.txt', early: true, sdk: fakeCloud({ user: USER, sessionDelay: 900, progressDelay: 1500 }),
      ls: { [SB]: J({ access_token: 'x', user: USER }) }, ss: { __fake_rows: rows } });
    const r = { how };
    try {
      r.shown = await openNow(s, 'grammar.html?u=ga-01');
      await s.eval('window.__old = 1; true');
      await click(s, '.q-block .opt');
      r.card = (await state(s)).mask;
      for (let i = 0; i < 80 && !(await s.eval('!!CLOUD.user')); i++) await sleep(25);
      r.busy = await s.eval('!!CLOUD.user && !CLOUD.reloading && window.__PROFILE_ID === null');   // 已經在灌資料、還沒重載
      if (how === 'Google') await click(s, '.modal-auth .btn-google');
      else {
        for (const [n, v] of [['email', 'student@example.com'], ['password', 'password123']]) {
          await s.eval(`document.querySelector('.modal-auth input[name=${n}]').focus(); true`);
          await s.send('Input.insertText', { text: v });
        }
        await click(s, '.modal-auth .auth-submit');
      }
      r.settled = await settleNav(s);
      await sleep(600);
      r.end = await s.eval(`({ path: location.pathname, oauth: sessionStorage.getItem('__fake_oauth_to'), pw: sessionStorage.getItem('__fake_pw'),
        pid: window.__PROFILE_ID === ${J(CPID)}, canAct: !!window.PROFILE && PROFILE.canAct(), mask: !!document.querySelector('.modal-mask'),
        local: (JSON.parse(localStorage.getItem(${J('tr_u' + CPID + '_hist')}) || '[]')).length,
        cloud: ((JSON.parse(sessionStorage.getItem('__fake_rows') || '[]').find((x) => x.k === 'hist') || {}).v || []).length })`);
      r.ok = r.shown && r.card && r.busy && r.settled && r.end.path === '/grammar.html' && r.end.oauth === null && (how !== '密碼' || r.end.pw === '1')
        && r.end.pid && r.end.canAct && !r.end.mask && r.end.local === oldHist.length && r.end.cloud === oldHist.length;
    } finally { await s.close(); }
    out.push(r);
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 第 4 輪審查 #2:Google 回來(或在登入卡用密碼登入)時讀雲端進度失敗(網路斷一下、Supabase 慢或休眠):這一頁不重載,
   CLOUD.user 有了、頂欄顯示已登入,資料夾卻還是訪客的,作答照樣擋下(寫進訪客資料夾、之後照帳號資料夾的舊值上傳會蓋掉雲端)。
   這時不能叫已登入的人「登入之後才能作答」:跳一張「還沒載入你的練習紀錄」的卡,附「重新整理」;重新整理之後灌回雲端紀錄、照常作答 */
T['登入後讀雲端進度失敗、資料夾還不是這個帳號:作答跳「重新整理」卡(不叫人登入)、什麼都不寫;重新整理後灌回雲端紀錄、照常作答'] = async (B) => {
  const out = [];
  const day = Date.now() - 864e5;
  const oldHist = [0, 1, 2].map((n) => ({ m: 'g', id: 'old-' + n, c: 0, ok: true, t: day + n }));
  const rows = J([{ k: 'hist', v: oldHist, updated_at: new Date(day + 10).toISOString() }]);
  for (const how of ['Google 回來', '登入卡用密碼登入']) {
    const s = await open(B, { url: 'robots.txt', early: true, sdk: fakeCloud({ user: USER }), ss: { __fake_rows: rows, __fake_fail: '1' } });
    const r = { how };
    try {
      await s.go('grammar.html?u=ga-01' + (how === 'Google 回來' ? GOOGLE_BACK : ''));
      await s.eval('CLOUD.ready.then(() => true, () => true)');
      await sleep(300);
      if (how !== 'Google 回來') {
        await click(s, '.q-block .opt');
        for (const [n, v] of [['email', 'student@example.com'], ['password', 'password123']]) {
          await s.eval(`document.querySelector('.modal-auth input[name=${n}]').focus(); true`);
          await s.send('Input.insertText', { text: v });
        }
        await click(s, '.modal-auth .auth-submit');
        for (let i = 0; i < 80 && !(await s.eval("!!document.querySelector('.modal-auth .auth-msg.bad')")); i++) await sleep(25);
        r.loginFailed = await s.eval("(document.querySelector('.modal-auth .auth-msg.bad') || {}).textContent || ''");
        await closeBy(s, 'x');
      }
      await sleep(1300);   // 小雞開頁同步寫 tr_pet 是非同步的,等它寫完再拍「之前」
      r.at = await s.eval('({ user: !!CLOUD.user, pid: window.__PROFILE_ID, canAct: PROFILE.canAct(), reloading: CLOUD.reloading })');
      const before = await snap(s);
      await click(s, '.q-block .opt');
      const st1 = await state(s);
      r.card1 = { mask: st1.mask, x: st1.x, title: st1.title, why: st1.why, aria: st1.aria };
      r.btn = await s.eval("(document.querySelector('.modal-reload .btn.primary') || {}).textContent || ''");
      r.focus = (await s.eval(FOCUS)).inMask;
      r.closed = await closeBy(s, 'esc');
      await click(s, '.q-block .opt');
      const st2 = await state(s);
      r.again = st2.mask && st2.title === st1.title;
      const mid = await snap(s);
      r.wrote = lsDiff(before.ls, mid.ls);
      r.same = mid.main === before.main;
      r.picked = await s.eval(PICKED);
      /* 網路好了,按「重新整理」 */
      await s.eval("sessionStorage.removeItem('__fake_fail'); window.__old = 1; true");
      await click(s, '.modal-reload .btn.primary');
      r.settled = await settleNav(s);
      await sleep(1300);
      r.after = await s.eval(`({ user: !!CLOUD.user, pid: window.__PROFILE_ID === ${J(CPID)}, canAct: PROFILE.canAct() })`);
      const ups = JSON.parse(await s.eval("sessionStorage.getItem('__fake_up') || '[]'"));
      r.uploads = ups.filter((u) => u.k !== '_meta');
      r.localBefore = JSON.parse((JSON.parse(await s.eval(LS)))['tr_u' + CPID + '_hist'] || '[]').length;
      await click(s, '.q-block .opt');
      r.mask = (await state(s)).mask;
      r.answered = await s.eval("!!document.querySelector('.q-block .opt.correct')");
      await sleep(1500);
      const end = JSON.parse(await s.eval(LS));
      const db = JSON.parse(await s.eval("sessionStorage.getItem('__fake_rows') || '[]'"));
      r.local = JSON.parse(end['tr_u' + CPID + '_hist'] || '[]').length;
      r.cloud = ((db.find((x) => x.k === 'hist') || {}).v || []).length;
      r.guestHist = 'tr_hist' in end;
      r.ok = r.at.user && r.at.pid === null && !r.at.canAct && !r.at.reloading
        && r.card1.mask && r.card1.x && r.card1.aria === 'true' && /還沒載入/.test(r.card1.title) && !WHY.cloud.test(r.card1.why) && /重新整理/.test(r.card1.why) && /重新整理/.test(r.btn)
        && r.focus && r.closed && r.again && !r.wrote.length && r.same && r.picked === 0
        && r.settled && r.after.user && r.after.pid && r.after.canAct && !r.uploads.length && r.localBefore === oldHist.length
        && !r.mask && r.answered && r.local === oldHist.length + 1 && r.cloud === oldHist.length + 1 && !r.guestHist;
    } finally { await s.close(); }
    out.push(r);
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 已登入的人開新分頁(sessionStorage 是每個分頁自己的,這個分頁還沒灌過):內容頁照舊先灌雲端資料再重載。
   重載前那一下小雞照常同步一次,寫入被最後一道擋下(根據的是舊畫面,本來就不寫),但那是登入著的人,不能留「還沒登入」的警告
   (第 4 輪審查 #2 的測試重新整理後就是這一頁,98f3778 就有);重載後照常作答、寫進帳號資料夾、雲端原本的紀錄還在 */
T['已登入的人開新分頁的內容頁:灌資料重載前那一下不寫、不留「還沒登入」警告,重載後照常作答'] = async (B) => {
  const day = Date.now() - 864e5;
  const oldHist = [0, 1, 2].map((n) => ({ m: 'g', id: 'old-' + n, c: 0, ok: true, t: day + n }));
  const s = await open(B, { url: 'robots.txt', early: true, sdk: fakeCloud({ user: USER, progressDelay: 300 }),
    ls: { [SB]: J({ access_token: 'x', user: USER }), tr_current_profile: J(CPID), ['tr_u' + CPID + '_hist']: J(oldHist) },
    ss: { __fake_rows: J([{ k: 'hist', v: oldHist, updated_at: new Date(day + 10).toISOString() }]) } });
  const r = {};
  try {
    r.shown = await openNow(s, 'grammar.html?u=ga-01');
    r.settled = await settleNav(s);   // 第一頁灌完要重載(ready 之後 reloading),等的是重載後那一頁
    await sleep(1300);
    r.after = await s.eval(`({ user: !!CLOUD.user, pid: window.__PROFILE_ID === ${J(CPID)}, canAct: PROFILE.canAct(), flag: sessionStorage.getItem(${J('tr_cloud_hydrated_' + UID)}) })`);
    r.meta = JSON.parse(await s.eval("sessionStorage.getItem('__fake_up') || '[]'")).map((u) => u.k);
    await click(s, '.q-block .opt');
    r.mask = (await state(s)).mask;
    r.answered = await s.eval("!!document.querySelector('.q-block .opt.correct')");
    await sleep(1500);
    const end = JSON.parse(await s.eval(LS));
    const db = JSON.parse(await s.eval("sessionStorage.getItem('__fake_rows') || '[]'"));
    r.local = JSON.parse(end['tr_u' + CPID + '_hist'] || '[]').length;
    r.cloud = ((db.find((x) => x.k === 'hist') || {}).v || []).length;
  } finally { await s.close(); }
  const ok = r.shown && r.settled && r.after.user && r.after.pid && r.after.canAct && r.after.flag === '1' && r.meta[0] === '_meta'
    && !r.mask && r.answered && r.local === 4 && r.cloud === 4;
  return { ok, detail: J(r) };
};

(async () => {
  if (!CHROME) { console.error('找不到 Chrome 或 Edge'); process.exit(2); }
  const srvs = [await serve(CLOUD_PORT, true), await serve(LOCAL_PORT, false)];
  const { proc, dir, ws } = await launch();
  let pass = 0;
  const names = Object.keys(T).filter((n) => !ONLY || n.indexOf(ONLY) > -1);
  try {
    const B = await connect(ws);
    for (const n of names) {
      let r;
      const e0 = B.errors.length, w0 = B.warns.length;
      try { r = await T[n](B); } catch (e) { r = { ok: false, detail: '丟錯:' + (e && e.message) }; }
      const errs = B.errors.slice(e0), warns = B.warns.slice(w0).filter((w) => /還沒登入/.test(w));
      if (errs.length) r = { ok: false, detail: r.detail + ' | 頁面 JS 錯誤:' + errs.slice(0, 3).join(' / ') };
      if (warns.length) r = { ok: false, detail: r.detail + ' | 有作答漏攔、靠最後一道擋下:' + warns.slice(0, 3).join(' / ') };
      if (r.ok) pass++;
      console.log((r.ok ? 'PASS ' : 'FAIL ') + n + '  →  ' + String(r.detail).slice(0, 1500));
    }
    try { await Promise.race([B.send('Browser.close'), sleep(3000)]); } catch (e) { /* 照樣往下 */ }
    B.ws.close();
  } finally {
    if (proc.exitCode === null) proc.kill();
    srvs.forEach((x) => x.close());
    await sleep(1500);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('使用者資料夾沒刪掉:' + dir); }
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
