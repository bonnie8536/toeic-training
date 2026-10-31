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
  /* 帳號層級的請求(登出、改暱稱、資料庫函式;my_access 不算)記在 sessionStorage 的 __fake_calls:
     { op, as: 送出時這台登入資料的帳號 id }(跟真的 supabase-js 一樣,請求帶的是 localStorage 現在的登入資料;審查 D 那一項看有沒有送、送給誰)。回的東西跟以前一樣 */
  const called = (op) => { const log = ss('__fake_calls'); const cur = session(); log.push({ op, as: cur && cur.user ? cur.user.id : null }); sessionStorage.setItem('__fake_calls', JSON.stringify(log)); };
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
    signOut: () => { called('signOut'); return Promise.resolve({ data: {}, error: null }); },
    updateUser: () => { called('updateUser'); return Promise.resolve({ data: {}, error: null }); },
  }, { get: (t, k) => t[k] || (() => Promise.resolve({ data: {}, error: null })) });
  const client = { auth, from: query, rpc: (n) => { if (n !== 'my_access') called('rpc:' + n); return later(0, { data: n === 'my_access' && C.access ? C.access : null, error: null }); } };
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

/* 2026-10-31 審查(main 130f330 就有,tools/test_sync.js 情境 52~54 測 cloud.js 的記帳;這裡測內容頁擋不擋得住、什麼都不寫):
   甲:別的分頁按登出(帳號資料夾、帳本、登入資料、目前帳號都刪了),這一頁沒重載,記憶體裡還是原帳號:作答跳「重新整理」卡,
       帳號資料夾不會被建回來、不記帳;這一頁不經過作答鈕的寫入(store.set、logAttempt)也不寫。
       這裡是內容頁(grammar.html,profile.js 的 blocksWrite 也擋);沒有 data-require-profile 的頁面只靠 common.js 的最後一道,另見「非內容頁(每日練習)」那兩項。
   乙:帳號資料夾是空的(這台還沒灌過)、讀雲端進度失敗:作答跳「重新整理」卡、什麼都不寫;網路好了重新整理,灌回雲端紀錄、照常作答,雲端原本的紀錄還在 */
T['別的分頁登出後沒重載的內容頁、帳號資料夾還沒灌過又讀不到雲端的內容頁:作答跳「重新整理」卡,什麼都不寫'] = async (B) => {
  const day = Date.now() - 864e5;
  const oldHist = [0, 1, 2].map((n) => ({ m: 'g', id: 'old-' + n, c: 0, ok: true, t: day + n }));
  const rows = J([{ k: 'hist', v: oldHist, updated_at: new Date(day + 10).toISOString() }]);
  const login = J({ access_token: 'x', user: USER });
  const a = {}, b = {};
  let s = await open(B, { url: 'grammar.html?u=ga-01', user: true, sdk: fakeCloud({ user: USER }),
    ls: { [SB]: login, ['tr_u' + CPID + '_hist']: J(oldHist) }, ss: { __fake_rows: rows } });
  try {
    a.at = await s.eval('PROFILE.canAct()');
    await s.eval(`(() => { [${J(SB)}, ${J(SB + '-user')}, 'tr_unsynced_' + ${J(UID)}, 'tr_current_profile'].forEach((k) => localStorage.removeItem(k));
      Object.keys(localStorage).filter((k) => k.indexOf(${J('tr_u' + CPID + '_')}) === 0).forEach((k) => localStorage.removeItem(k)); return true; })()`);
    const before = await snap(s);
    await click(s, '.q-block .opt');
    const st = await state(s);
    a.card = { mask: st.mask, title: st.title, why: st.why };
    await closeBy(s, 'esc');
    await s.eval("store.set('verb_quiz', { n: 1 }); logAttempt('g', 'x', 0, true); true");
    const mid = await snap(s);
    a.wrote = lsDiff(before.ls, mid.ls);
    a.same = mid.main === before.main;
    a.picked = await s.eval(PICKED);
    /* 卡上說的是帳號已經在別的分頁登出,不是「你已經登入了」(第 2 輪審查之後;之前沿用「還沒載入你的練習紀錄」那張) */
    a.ok = a.at === true && a.card.mask && /登出/.test(a.card.title) && !/你已經登入/.test(a.card.why) && !WHY.cloud.test(a.card.why) && !a.wrote.length && a.same && a.picked === 0;
  } finally { await s.close(); }
  s = await open(B, { url: 'robots.txt', early: true, sdk: fakeCloud({ user: USER }),
    ls: { [SB]: login, tr_current_profile: J(CPID) }, ss: { __fake_rows: rows, __fake_fail: '1' } });
  try {
    await s.go('grammar.html?u=ga-01');
    await s.eval('CLOUD.ready.then(() => true, () => true)');
    await sleep(1300);
    b.at = await s.eval(`({ user: !!CLOUD.user, pid: window.__PROFILE_ID === ${J(CPID)}, canAct: PROFILE.canAct(), mark: localStorage.getItem(${J('tr_cloud_unhydrated_' + UID)}) })`);
    const before = await snap(s);
    await click(s, '.q-block .opt');
    const st = await state(s);
    b.card = { mask: st.mask, title: st.title, why: st.why };
    const mid = await snap(s);
    b.wrote = lsDiff(before.ls, mid.ls);
    b.picked = await s.eval(PICKED);
    await s.eval("sessionStorage.removeItem('__fake_fail'); true");
    if (await s.eval("!!document.querySelector('.modal-reload .btn.primary')")) await click(s, '.modal-reload .btn.primary');
    else await s.eval('location.reload(); true');   // 沒跳卡(會紅):照樣重新整理,把之後的結果記下來
    b.settled = await settleNav(s);
    await sleep(1300);
    b.after = await s.eval(`({ canAct: PROFILE.canAct(), mark: localStorage.getItem(${J('tr_cloud_unhydrated_' + UID)}) })`);
    await click(s, '.q-block .opt');
    b.answered = await s.eval("!!document.querySelector('.q-block .opt.correct, .q-block .opt.wrong')");
    await sleep(1500);
    const end = JSON.parse(await s.eval(LS));
    const db = JSON.parse(await s.eval("sessionStorage.getItem('__fake_rows') || '[]'"));
    b.local = JSON.parse(end['tr_u' + CPID + '_hist'] || '[]').length;
    b.cloud = ((db.find((x) => x.k === 'hist') || {}).v || []).length;
    b.ok = b.at.user && b.at.pid && !b.at.canAct && b.at.mark === '1' && b.card.mask && /還沒載入/.test(b.card.title) && !b.wrote.length && b.picked === 0
      && b.settled && b.after.canAct && b.after.mark === null && b.answered && b.local === oldHist.length + 1 && b.cloud === oldHist.length + 1;
  } finally { await s.close(); }
  return { ok: !!a.ok && !!b.ok, detail: '別的分頁登出 ' + J(a) + ' | 還沒灌過又讀不到 ' + J(b) };
};

/* 別的分頁按登出:js/cloud.js logout 刪的那幾個鍵(登入資料、帳本、只在本機的標記、還沒灌過的標記、灌過的記號、目前帳號、整個帳號資料夾) */
const OTHER_TAB_LOGOUT = `(() => { [${J(SB)}, ${J(SB + '-user')}, ${J('tr_unsynced_' + UID)}, ${J('tr_localonly_' + UID)}, ${J('tr_cloud_unhydrated_' + UID)}, ${J('tr_cloud_seen_' + UID)}, 'tr_current_profile'].forEach((k) => localStorage.removeItem(k));
  Object.keys(localStorage).filter((k) => k.indexOf(${J('tr_u' + CPID + '_')}) === 0).forEach((k) => localStorage.removeItem(k)); return true; })()`;
const KEEP = "(typeof canKeepProgress === 'function' ? canKeepProgress() : null)";
const accountKeys = (ls) => Object.keys(JSON.parse(ls)).filter((k) => k.indexOf('tr_u' + CPID + '_') === 0 || k === 'tr_unsynced_' + UID);

/* 第 2 輪審查(2026-10-31):沒有 data-require-profile 的頁面(每日練習)沒有 data-gate,profile.js 的 blocksWrite 也不管,
   別的分頁登出之後只有 common.js 的最後一道擋得住。不擋的話這一頁把登出時刪掉的帳號資料夾建回來,之後帳號在這台登回來時
   資料夾不是空的、不記「還沒灌過」,別的分頁沿用舊的「灌過」旗標整份上傳(tools/test_sync.js 情境 52 那條又回來)。
   甲:已登入、灌過的頁面(記憶體裡還是原帳號):store.set、logAttempt 都不寫;按作答跳「重新整理」卡,說的是帳號已經登出
       (不是「你已經登入了」),不對答案、什麼都不寫。
   乙:頁面還在確認登入(CLOUD.user 還是 null,只有 common.js 的 folderGone 擋得住):寫入一樣不寫;確認完改回訪客,
       帳號資料夾、帳本都沒有被建回來 */
T['非內容頁(每日練習):別的分頁登出後沒重載,寫入與作答都不把帳號資料夾建回來、不記帳,作答跳「重新整理」卡'] = async (B) => {
  const day = Date.now() - 864e5;
  const oldHist = [0, 1, 2].map((n) => ({ m: 'g', id: 'old-' + n, c: 0, ok: true, t: day + n }));
  const rows = J([{ k: 'hist', v: oldHist, updated_at: new Date(day + 10).toISOString() }]);
  const login = J({ access_token: 'x', user: USER });
  const probe = "store.set('daily_probe', { n: 1 }); logAttempt('g', 'stale-a', 0, true); true";
  const a = {}, b = {};
  let s = await open(B, { url: 'daily.html?part=g', user: true, sdk: fakeCloud({ user: USER }),
    ls: { [SB]: login, ['tr_u' + CPID + '_hist']: J(oldHist) }, ss: { __fake_rows: rows } });
  try {
    a.at = await s.eval(`({ user: !!CLOUD.user, canAct: PROFILE.canAct(), keep: ${KEEP} })`);
    await s.eval(OTHER_TAB_LOGOUT);
    const before = await snap(s);
    await s.eval(probe);
    await sleep(1500);
    const mid = await snap(s);
    a.wrote = lsDiff(before.ls, mid.ls);
    await click(s, '.q-block .opt');
    const st = await state(s);
    a.card = { mask: st.mask, title: st.title, why: st.why };
    a.picked = await s.eval(PICKED);
    await sleep(800);
    const end = await snap(s);
    a.wrote2 = lsDiff(mid.ls, end.ls);
    a.mine = accountKeys(end.ls);
    a.ok = a.at.user && a.at.canAct && a.at.keep === true && !a.wrote.length
      && a.card.mask && /登出/.test(a.card.title) && !/你已經登入/.test(a.card.why) && /重新整理/.test(a.card.why) && a.picked === 0 && !a.wrote2.length && !a.mine.length;
  } finally { await s.close(); }
  s = await open(B, { url: 'robots.txt', early: true, sdk: fakeCloud({ user: USER, sessionDelay: 3000 }),
    ls: { [SB]: login, tr_current_profile: J(CPID), ['tr_u' + CPID + '_hist']: J(oldHist) }, ss: { __fake_rows: rows, ['tr_cloud_hydrated_' + UID]: '1' } });
  try {
    await s.go('daily.html?part=g');
    b.at = await s.eval(`({ user: !!CLOUD.user, pid: window.__PROFILE_ID === ${J(CPID)} })`);
    await s.eval(OTHER_TAB_LOGOUT);
    const before = await snap(s);
    await s.eval(probe);
    const mid = await snap(s);
    b.wrote = lsDiff(before.ls, mid.ls);
    b.settled = await settleNav(s);   // 確認完:這台已經沒有登入資料,改回訪客、重載
    await sleep(1300);
    b.after = await s.eval('({ user: !!CLOUD.user, pid: window.__PROFILE_ID })');
    b.mine = accountKeys(await s.eval(LS));
    b.ok = !b.at.user && b.at.pid && !b.wrote.length && b.settled && !b.after.user && b.after.pid === null && !b.mine.length;
  } finally { await s.close(); }
  /* 丙:每日複習(個人頁,一打開就要登入,但作答一樣沒有 data-gate):複習到一半別的分頁登出,按選項跳卡、不對答案、不寫 */
  const c = {};
  s = await open(B, { url: 'review.html', user: true, sdk: fakeCloud({ user: USER }), ls: { [SB]: login }, ss: { __fake_rows: J([]) } });
  try {
    await s.eval(`localStorage.setItem(${J('tr_u' + CPID + '_drill_p5')}, JSON.stringify({ [TOEIC.part5[0].id]: { ok: false, t: 1 } })); location.reload(); true`);
    c.settled = await settleNav(s);
    await sleep(800);
    await click(s, '.part-card .btn.primary');   // 開始複習
    c.items = await s.eval("document.querySelectorAll('.q-block .opts .opt').length");
    await s.eval(OTHER_TAB_LOGOUT);
    const before = await snap(s);
    await click(s, '.q-block .opts .opt');
    const st = await state(s);
    c.card = { mask: st.mask, title: st.title };
    c.picked = await s.eval(PICKED);
    await sleep(800);
    c.wrote = lsDiff(before.ls, (await snap(s)).ls);
    c.ok = c.settled && c.items > 0 && c.card.mask && /登出/.test(c.card.title) && c.picked === 0 && !c.wrote.length;
  } finally { await s.close(); }
  return { ok: !!a.ok && !!b.ok && !!c.ok, detail: '已登入的頁面 ' + J(a) + ' | 還在確認登入 ' + J(b) + ' | 每日複習 ' + J(c) };
};

/* 第 2 輪審查(2026-10-31):已登入、這台的帳號資料夾還沒灌過(空的,「還沒灌過」標記在)、讀雲端進度失敗時,
   每日練習(非內容頁)以前照常顯示對錯、寫進帳號資料夾但不記帳;網路好了灌資料用雲端蓋回去,剛答的題目沒有任何提示就不見了
   (雲端也有今天的每日進度時一起被蓋掉)。要跟內容頁一樣:作答跳「重新整理」卡、不對答案、什麼都不寫;
   網路好了重新整理,灌回雲端紀錄、照常作答,雲端原本的紀錄還在 */
T['非內容頁(每日練習):已登入、帳號資料夾還沒灌過又讀不到雲端,作答跳「重新整理」卡、什麼都不寫;重新整理後照常作答'] = async (B) => {
  const day = Date.now() - 864e5;
  const oldHist = [0, 1, 2].map((n) => ({ m: 'g', id: 'old-' + n, c: 0, ok: true, t: day + n }));
  const rows = J([{ k: 'hist', v: oldHist, updated_at: new Date(day + 10).toISOString() }]);
  const MARK = J('tr_cloud_unhydrated_' + UID);
  const s = await open(B, { url: 'robots.txt', early: true, sdk: fakeCloud({ user: USER }),
    ls: { [SB]: J({ access_token: 'x', user: USER }), tr_current_profile: J(CPID) }, ss: { __fake_rows: rows, __fake_fail: '1' } });
  const r = {};
  try {
    await s.go('daily.html?part=g');
    await s.eval('CLOUD.ready.then(() => true, () => true)');
    await sleep(1300);
    r.at = await s.eval(`({ user: !!CLOUD.user, pid: window.__PROFILE_ID === ${J(CPID)}, canAct: PROFILE.canAct(), keep: ${KEEP}, mark: localStorage.getItem(${MARK}) })`);
    const before = await snap(s);
    await click(s, '.q-block .opt');
    const st = await state(s);
    r.card = { mask: st.mask, title: st.title, why: st.why };
    r.picked = await s.eval(PICKED);
    await s.eval("store.set('daily_probe', { n: 1 }); logAttempt('g', 'probe', 0, true); true");
    await sleep(800);
    r.wrote = lsDiff(before.ls, (await snap(s)).ls);
    await s.eval("sessionStorage.removeItem('__fake_fail'); true");
    if (await s.eval("!!document.querySelector('.modal-reload .btn.primary')")) await click(s, '.modal-reload .btn.primary');
    else await s.eval('location.reload(); true');   // 沒跳卡(會紅):照樣重新整理,把之後的結果記下來
    r.settled = await settleNav(s);
    await sleep(1300);
    r.after = await s.eval(`({ canAct: PROFILE.canAct(), keep: ${KEEP}, mark: localStorage.getItem(${MARK}) })`);
    await click(s, '.q-block .opt');
    r.answered = await s.eval(PICKED);
    await sleep(1500);
    const end = JSON.parse(await s.eval(LS));
    const db = JSON.parse(await s.eval("sessionStorage.getItem('__fake_rows') || '[]'"));
    r.local = JSON.parse(end['tr_u' + CPID + '_hist'] || '[]').length;
    r.cloud = ((db.find((x) => x.k === 'hist') || {}).v || []).length;
    r.done = 'tr_u' + CPID + '_daily_done' in end;
    r.ok = r.at.user && r.at.pid && !r.at.canAct && r.at.keep === false && r.at.mark === '1'
      && r.card.mask && /還沒載入/.test(r.card.title) && r.picked === 0 && !r.wrote.length
      && r.settled && r.after.canAct && r.after.keep === true && r.after.mark === null && r.answered > 0
      && r.local === oldHist.length + 1 && r.cloud === oldHist.length + 1 && r.done;
  } finally { await s.close(); }
  return { ok: !!r.ok, detail: J(r) };
};

/* 第 2 輪審查(2026-10-31):模擬考的「交卷」(和時間到自動交卷)沒有 data-gate。考到一半別的分頁登出、換帳號,
   或登回來時帳號資料夾空的又讀不到雲端(「還沒灌過」標記),交卷那一下被 common.js 的最後一道靜靜擋下:
   以前結果畫面照常出現,這次成績哪裡都沒有存,學生也不知道。
   要的是:結果照樣給他看,寫明「這次成績還沒存進紀錄」,成績先放這個分頁的 sessionStorage(綁交卷時的帳號資料夾);
   這個分頁之後回到同一個帳號、能作答了就補存(模擬考紀錄先合併再上傳,不會蓋掉別台的)。換成別人的帳號時不補進別人的資料夾。
   照常:平常登入著交卷,跟以前一樣馬上存、上傳,沒有提示 */
const Y_USER = { id: '99999999-8888-4777-8666-555544443333', email: 'other@example.com', user_metadata: { name: '別人' }, app_metadata: { providers: ['email'] } };
const YPID = 'c' + Y_USER.id.replace(/-/g, '');
T['模擬考考到一半別的分頁登出、換帳號、登回來還沒灌好,或時間到自動交卷:結果寫明還沒存,成績留在這個分頁,回到同一個帳號後補存;不寫進別人的資料夾'] = async (B) => {
  const day = Date.now() - 864e5;
  const three = [1, 2, 3].map((n) => ({ d: new Date(day + n * 1000).toISOString(), size: 'quick', lRaw: n, lTotal: 12, rRaw: n, rTotal: 18, lScore: 5, rScore: 5 }));
  const rows = J([{ k: 'mock_history', v: three, updated_at: new Date(day + 10000).toISOString() }]);
  const login = J({ access_token: 'x', user: USER });
  const LATER = "JSON.parse(sessionStorage.getItem('tr_mock_unsaved') || '[]').length";
  const out = [];
  for (const how of ['照常', '登出', '換帳號', '登回來還沒灌好', '時間到']) {
    const r = { how };
    const s = await open(B, { url: 'mock.html', user: true, sdk: fakeCloud({ user: USER }),
      ls: { [SB]: login, ['tr_u' + CPID + '_mock_history']: J(three) }, ss: { __fake_rows: rows } });
    try {
      await click(s, '.part-card .btn.primary');   // 開始(這時登入著、能作答)
      r.started = await s.eval("!!document.querySelector('.drill-top .mock-timer') && PROFILE.canAct()");
      if (how !== '照常') await s.eval(OTHER_TAB_LOGOUT);
      if (how === '換帳號') await s.eval(`localStorage.setItem(${J(SB)}, ${J(J({ access_token: 'y', user: Y_USER }))}); localStorage.setItem('tr_current_profile', ${J(J(YPID))}); true`);
      if (how === '登回來還沒灌好') await s.eval(`localStorage.setItem(${J(SB)}, ${J(login)}); localStorage.setItem('tr_current_profile', ${J(J(CPID))}); localStorage.setItem(${J('tr_cloud_unhydrated_' + UID)}, '1'); true`);
      const before = await s.eval(LS);
      await s.eval('window.confirm = () => true; true');
      if (how === '時間到') { await s.eval('(() => { const t = Date.now; Date.now = () => t() + 60 * 60e3; return true; })()'); await sleep(1600); }
      else await click(s, '.drill-top .btn');   // 交卷
      await sleep(how === '照常' ? 1500 : 600);
      r.result = await s.eval(`({ title: document.title, head: (document.querySelector('.report-head h2') || {}).textContent || '',
        note: (document.querySelector('.mock-unsaved') || {}).textContent || '', mask: !!document.querySelector('.modal-mask'), later: ${LATER} })`);
      r.wrote = lsDiff(before, await s.eval(LS)).filter((k) => /^tr_u|^tr_unsynced_/.test(k));
      r.ups = JSON.parse(await s.eval("sessionStorage.getItem('__fake_up') || '[]'")).filter((u) => u.k === 'mock_history').length;
      const shown = /模擬考結果/.test(r.result.title) && /參考總分/.test(r.result.head) && !r.result.mask;
      if (how === '照常') {
        const db = JSON.parse(await s.eval("sessionStorage.getItem('__fake_rows') || '[]'"));
        r.cloud = ((db.find((x) => x.k === 'mock_history') || {}).v || []).length;
        r.ok = r.started && shown && !r.result.note && r.result.later === 0 && r.ups >= 1 && r.cloud === 4;
        out.push(r);
        continue;
      }
      if (how === '換帳號') {   // 這個分頁重新整理,變成別人的頁面:不能補存進他的資料夾
        await s.eval('location.reload(); true');
        r.ySettled = await settleNav(s);
        await sleep(1300);
        r.y = await s.eval(`({ pid: window.__PROFILE_ID === ${J(YPID)}, has: (JSON.parse(localStorage.getItem(${J('tr_u' + YPID + '_mock_history')}) || '[]')).length, later: ${LATER} })`);
        await s.eval(`(() => { [${J(SB)}, 'tr_current_profile'].forEach((k) => localStorage.removeItem(k));
          Object.keys(localStorage).filter((k) => k.indexOf(${J('tr_u' + YPID + '_')}) === 0).forEach((k) => localStorage.removeItem(k)); return true; })()`);   // 別人登出
      }
      if (how === '登回來還沒灌好') {   // 網路好了,按結果上的「重新整理」
        if (await s.eval("!!document.querySelector('.mock-unsaved .btn')")) await click(s, '.mock-unsaved .btn');
        else await s.eval('location.reload(); true');
      } else {   // 原帳號在這個分頁登回來(登入資料存回來,下一頁灌資料、重載)
        await s.eval(`localStorage.setItem(${J(SB)}, ${J(login)}); true`);
        await s.go('mock.html');
      }
      r.settled = await settleNav(s);
      await sleep(1500);
      const end = JSON.parse(await s.eval(LS));
      const db = JSON.parse(await s.eval("sessionStorage.getItem('__fake_rows') || '[]'"));
      r.local = JSON.parse(end['tr_u' + CPID + '_mock_history'] || '[]').length;
      r.cloud = ((db.find((x) => x.k === 'mock_history') || {}).v || []).length;
      r.laterEnd = await s.eval(LATER);
      r.rows = await s.eval("document.querySelectorAll('.cat-table tr').length");   // 歷次紀錄:表頭加 4 筆
      r.ok = r.started && shown && /還沒存/.test(r.result.note) && r.result.later === 1 && !r.wrote.length && r.ups === 0
        && (how !== '換帳號' || (r.ySettled && r.y.pid && r.y.has === three.length && r.y.later === 1))
        && r.settled && r.local === 4 && r.cloud === 4 && r.laterEnd === 0 && r.rows === 5;
    } finally { await s.close(); }
    out.push(r);
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 多分頁第 3 輪審查 #2(2026-11-01):單字頁的題庫編輯器(加入單字、勾選、刪字、改名)和遊戲、片語特訓的選項沒有 data-gate
   (進來那一下的「新增題庫」「編輯」「開始練習」才有)。進來之後別的分頁登出,或這台的帳號資料夾還沒灌過(別的分頁正在灌、讀不到雲端):
   以前 common.js 的 store 靜靜不寫,畫面卻寫「加入 3 個」、清空輸入框、清單 0 個字,選項照樣對答案,什麼提示都沒有(e49e444 則會寫進
   被刪掉的資料夾、記帳)。要的是:跳「重新整理」卡,輸入框的字留著、勾選不變、字沒刪,什麼都不寫;照常的時候跟以前一樣 */
const VOCAB_BANK = [{ id: 'b_old', name: '舊題庫', words: [{ en: 'apple', zh: '蘋果', on: true }, { en: 'pear', zh: '梨', on: true }] }];
const BREAK_ACCOUNT = { '登出': OTHER_TAB_LOGOUT, '還沒灌過': `localStorage.setItem(${J('tr_cloud_unhydrated_' + UID)}, '1'); true` };
async function vocabOpen(B, hash) {
  const ls = { [SB]: J({ access_token: 'x', user: USER }), ['tr_u' + CPID + '_vgame_banks']: J(VOCAB_BANK) };
  const rows = J([{ k: 'vgame_banks', v: VOCAB_BANK, updated_at: new Date(Date.now() - 864e5).toISOString() }]);
  return open(B, { url: 'vocab.html' + (hash || ''), user: true, sdk: fakeCloud({ user: USER }), ls, ss: { __fake_rows: rows } });
}
async function pressText(s, sel, text) {
  await s.eval(`(() => { const b = [...document.querySelectorAll(${J(sel)})].find((x) => x.textContent.indexOf(${J(text)}) > -1); if (!b) return false; b.id = '__press'; return true; })()`);
  await click(s, '#__press');
}
T['單字頁:題庫編輯器的加入單字、勾選、刪字、改名,片語特訓的選項,在別的分頁登出、帳號資料夾還沒灌過時跳「重新整理」卡,輸入框的字留著、什麼都不寫;照常時照樣存'] = async (B) => {
  const out = [];
  const LINES = ['banana 香蕉', 'cherry 櫻桃', 'grape 葡萄'].join(String.fromCharCode(10));
  for (const how of ['照常', '登出', '還沒灌過']) {
    const r = { how };
    let s = await vocabOpen(B);
    try {
      await pressText(s, 'button', '新增題庫');
      r.editor = await s.eval(`!!document.querySelector('[data-vview="edit"]')`);
      await s.eval(`(() => { const n = document.querySelector('input.game-input'); n.value = '第3課'; n.dispatchEvent(new Event('change')); return true; })()`);
      await s.eval(`(() => { document.querySelector('textarea.write-area').value = ${J(LINES)}; return true; })()`);
      await sleep(1300);   // 名稱存好(建了空的題庫)、0.8 秒後上傳完,帳本劃掉,再拍「之前」
      if (BREAK_ACCOUNT[how]) await s.eval(BREAK_ACCOUNT[how]);
      const before = await s.eval(LS);
      await click(s, '.pop-btns .btn.primary');   // 加入單字
      await sleep(800);
      const st = await state(s);
      r.card = { mask: st.mask, title: st.title };
      r.status = await s.eval("(document.querySelector('.result-note') || {}).textContent || ''");
      r.kept = (await s.eval("document.querySelector('textarea.write-area').value")) === LINES;
      r.listed = await s.eval("document.querySelectorAll('.bank-word').length");
      r.wrote = lsDiff(before, await s.eval(LS));
      if (st.mask) await closeBy(s, 'esc');
      /* 改名:擋下時名稱留在框裡、不存 */
      const b2 = await s.eval(LS);
      await s.eval(`(() => { const n = document.querySelector('input.game-input'); n.value = '第4課'; n.dispatchEvent(new Event('change')); return true; })()`);
      await sleep(300);
      r.renameCard = (await state(s)).mask;
      r.renameWrote = lsDiff(b2, await s.eval(LS));
      if (r.renameCard) await closeBy(s, 'esc');
    } finally { await s.close(); }
    /* 舊題庫:勾選、刪字 */
    s = await vocabOpen(B);
    try {
      await pressText(s, '.btn', '編輯');
      r.words0 = await s.eval("document.querySelectorAll('.bank-word').length");
      if (BREAK_ACCOUNT[how]) await s.eval(BREAK_ACCOUNT[how]);
      const before = await s.eval(LS);
      await click(s, '.bank-word input[type=checkbox]');
      await sleep(400);
      r.checkCard = (await state(s)).mask;
      r.stillOn = await s.eval("(() => { const c = document.querySelector('.bank-word input[type=checkbox]'); return c ? c.checked : null; })()");   // 清單被清空(會紅)時是 null
      if (r.checkCard) await closeBy(s, 'esc');
      if (await s.eval("!!document.querySelector('.bank-word-del')")) { await click(s, '.bank-word-del'); await sleep(400); }
      r.delCard = (await state(s)).mask;
      r.words1 = await s.eval("document.querySelectorAll('.bank-word').length");
      if (r.delCard) await closeBy(s, 'esc');
      r.wrote2 = lsDiff(before, await s.eval(LS));
    } finally { await s.close(); }
    /* 片語特訓:開始之後才擋下,按選項跳卡、不對答案 */
    s = await vocabOpen(B, '#phrase');
    try {
      await pressText(s, '.part-card .btn.primary', '開始練習');   // data-gate,這時能作答
      r.drill = await s.eval("document.querySelectorAll('.opts .opt').length");
      if (BREAK_ACCOUNT[how]) await s.eval(BREAK_ACCOUNT[how]);
      const before = await s.eval(LS);
      await click(s, '.opts .opt');
      await sleep(400);
      r.drillCard = (await state(s)).mask;
      r.drillPicked = await s.eval("document.querySelectorAll('.opts .opt.correct, .opts .opt.wrong').length");
      await sleep(600);
      r.wrote3 = lsDiff(before, await s.eval(LS));
    } finally { await s.close(); }
    const bank = 'tr_u' + CPID + '_vgame_banks';
    if (how === '照常') {
      r.ok = r.editor && !r.card.mask && /加入 3 個/.test(r.status) && r.listed === 3 && !r.kept && r.wrote.includes(bank)
        && !r.renameCard && r.renameWrote.includes(bank) && r.words0 === 2 && !r.checkCard && !r.stillOn && !r.delCard && r.words1 === 1
        && r.drill > 0 && !r.drillCard && r.drillPicked > 0;
    } else {
      const title = how === '登出' ? /登出/ : /還沒載入/;
      r.ok = r.editor && r.card.mask && title.test(r.card.title) && !/加入/.test(r.status) && r.kept && r.listed === 0 && !r.wrote.length
        && r.renameCard && !r.renameWrote.length && r.words0 === 2 && r.checkCard && r.stillOn && r.delCard && r.words1 === 2 && !r.wrote2.length
        && r.drill > 0 && r.drillCard && r.drillPicked === 0 && !r.wrote3.length;
    }
    out.push(r);
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 審查 D 第 1 輪 #4、#5、#6(73900cf 新加的擋下):
   甲 掉落消除玩到一半擋下(別的分頁登出、帳號資料夾還沒灌過),學生在輸入框打字按 Enter:以前同一下 Enter 的 keypress 落到卡上的「重新整理」,
      頁面馬上重載,打的字和這一局都沒了、卡片根本看不到。要的是:不重載,卡片在,打的字留著,遊戲暫停;卡片開著時再按一次 Enter 也不重載
      (卡的焦點停在標題:重新整理會清掉這一頁還沒存的東西,不當預設按鈕),卡上寫明重新整理會清掉還沒存的。
   乙 擋下之後不再打字:以前字照樣往下掉、扣命,最後「沒命了，分數 N（新紀錄）」,其實一筆都沒存。要的是:字掉到底時暫停、跳卡、不扣命、不結束。
   丙 記憶吐司答完最後一題才擋下,按「看成績」:以前照樣寫「（新紀錄）」卻沒存。要的是:跳卡、不出成績、什麼都不寫。
   照常的時候三樣都跟以前一樣 */
T['單字頁遊戲:掉落消除擋下時按 Enter 不重新整理、字掉到底先暫停跳卡不扣命,記憶吐司「看成績」跳卡;卡上寫明重新整理會清掉還沒存的;照常時照樣玩'] = async (B) => {
  const out = [];
  const HUD = "({ lives: (document.querySelector('.hud-lives') || {}).textContent || '', pause: (document.querySelector('.game-hud .btn') || {}).textContent || '', over: !!document.querySelector('.game-over'), input: (document.querySelector('input.game-input') || {}).value })";
  const CARD = `(() => { const m = document.querySelector('.modal-reload'); const a = document.activeElement;
    return m ? { title: (m.querySelector('h2') || {}).textContent || '', sub: [...m.querySelectorAll('.modal-sub')].map((p) => p.textContent).join(' '),
      desc: (m.getAttribute('aria-describedby') || '').split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '), focus: a ? a.tagName : '' } : null; })()`;
  for (const how of ['照常', '登出', '還沒灌過']) {
    const r = { how };
    /* 甲:Enter */
    let s = await vocabOpen(B);
    try {
      await click(s, '.vg-games .btn.primary', 0);   // 掉落消除「開始」(data-gate,這時能作答)
      await s.eval('window.__mark = 1; true');   // 重載了就不在
      if (BREAK_ACCOUNT[how]) await s.eval(BREAK_ACCOUNT[how]);
      const before = await s.eval(LS);
      await s.eval("document.querySelector('input.game-input').focus(); true");
      await s.send('Input.insertText', { text: 'zzqq' });
      await key(s, 'Enter');
      await sleep(1200);
      r.stay = await s.eval('window.__mark === 1');
      r.card = r.stay ? await s.eval(CARD) : null;
      r.hud = r.stay ? await s.eval(HUD) : null;
      if (r.card) { await key(s, 'Enter'); await sleep(900); r.stay2 = await s.eval('window.__mark === 1'); }
      r.wrote = r.stay ? lsDiff(before, await s.eval(LS)).filter((k) => !/_pet$/.test(k)) : ['重載了'];
    } finally { await s.close(); }
    /* 乙:擋下之後不再打字,等字掉到底(遊戲區縮矮,字很快到底) */
    s = await vocabOpen(B);
    try {
      await click(s, '.vg-games .btn.primary', 0);
      await s.eval("document.querySelector('.game-field').style.height = '90px'; true");
      if (BREAK_ACCOUNT[how]) await s.eval(BREAK_ACCOUNT[how]);
      const before = await s.eval(LS);
      const moved = "!!document.querySelector('.modal-mask') || (document.querySelector('.hud-lives') || {}).textContent !== '♥♥♥'";
      for (let i = 0; i < 60 && !(await s.eval(moved)); i++) await sleep(250);
      await sleep(1500);
      r.fall = { hud: await s.eval(HUD), card: await s.eval(CARD) };
      r.fallWrote = lsDiff(before, await s.eval(LS)).filter((k) => !/_pet$/.test(k));
    } finally { await s.close(); }
    /* 丙:記憶吐司答完 6 題,擋下,按「看成績」 */
    s = await vocabOpen(B);
    try {
      await click(s, '.vg-games .btn.primary', 2);
      await pressText(s, '.btn', '直接開考');
      for (let i = 0; i < 6; i++) {
        await click(s, '.q-block .opt');
        if (i < 5) await pressText(s, '.q-block .btn', '下一題');
      }
      r.toastLast = await s.eval("[...document.querySelectorAll('.q-block .btn')].map((b) => b.textContent).join('/')");
      await sleep(1300);   // 最後一題的作答紀錄 0.8 秒後上傳完、帳本劃掉,再擋下、拍「之前」
      if (BREAK_ACCOUNT[how]) await s.eval(BREAK_ACCOUNT[how]);
      const before = await s.eval(LS);
      await pressText(s, '.q-block .btn', '看成績');
      await sleep(600);
      r.toast = { card: await s.eval(CARD), report: await s.eval("(document.querySelector('.report-head h2') || {}).textContent || ''") };
      r.toastWrote = lsDiff(before, await s.eval(LS)).filter((k) => !/_pet$/.test(k));
    } finally { await s.close(); }
    if (how === '照常') {
      r.ok = r.stay && !r.card && r.hud.input === 'zzqq' && r.hud.pause === '暫停' && !r.wrote.length
        && !r.fall.card && r.fall.hud.lives !== '♥♥♥' && r.fallWrote.includes('tr_u' + CPID + '_vgame_miss')
        && /看成績/.test(r.toastLast) && !r.toast.card && /記憶吐司/.test(r.toast.report);   // 新紀錄(答對幾題)看運氣,這裡只看成績出得來
    } else {
      const title = how === '登出' ? /已經在別的分頁登出/ : /還沒載入/;
      const card = (c) => !!c && title.test(c.title) && /重新整理會清掉這一頁還沒存的/.test(c.sub) && /重新整理會清掉這一頁還沒存的/.test(c.desc) && c.focus === 'H2';
      r.ok = r.stay && card(r.card) && r.stay2 && r.hud.input === 'zzqq' && r.hud.pause === '繼續' && !r.hud.over && !r.wrote.length
        && card(r.fall.card) && r.fall.hud.lives === '♥♥♥' && r.fall.hud.pause === '繼續' && !r.fall.hud.over && !r.fallWrote.length
        && /看成績/.test(r.toastLast) && card(r.toast.card) && !r.toast.report && !r.toastWrote.length
        && (how !== '登出' || /先在別的分頁登回原本的帳號/.test(r.card.sub));
    }
    out.push(r);
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 帳號那一邊存不進去時的漏攔偵測(審查 D 第 2 輪 #2):js/common.js 的 keepOrWarn 在 accountBlock 時不印「還沒登入」
   (小雞開頁同步也會走到,不是漏攔),最下面主程式那一道看不到。這裡把 keepOrWarn 包一層,記下「帳號那一邊靜靜擋下」的寫入(小雞的不算):
   作答被 data-gate、holdForAccount 擋在前面時一筆都不會有;有的話就是某個作答漏攔,畫面照樣說存了。重載後要再裝一次 */
const COUNT_SILENT = `(() => { if (window.__silent) return true; const f = window.keepOrWarn; window.__silent = [];
  window.keepOrWarn = (what) => { const ok = f(what); if (!ok && !/^pet/.test(String(what)) && typeof accountBlock === 'function' && accountBlock()) window.__silent.push(what); return ok; }; return true; })()`;
const SILENT = '(window.__silent || []).slice()';
const UPS = "JSON.parse(sessionStorage.getItem('__fake_up') || '[]').map((u) => u.k).filter((k) => k !== 'pet' && k !== '_meta')";
/* 審查 D 第 2 輪 #2:刷題頁的聽力隨機練習、聽力錯題複習(js/listening.js)和文法頁的動詞測驗(js/verbs.js)進來之後的作答、交卷沒有 data-gate
   (進來那一下「開始聽力練習」「複習」「測驗這些字」才有)。開始之後別的分頁登出,或這台的帳號資料夾還沒灌過:
   以前 common.js 靜靜不寫,畫面卻照樣選取、對答案,交卷後寫「答錯的題目已收進錯題本。」,其實一筆都沒存、也沒跳卡(e49e444 則寫進被刪掉的資料夾、記帳)。
   要的是:跟同一頁的閱讀練習一樣跳「重新整理」卡,不選取、不對答案、不出成績,之前選好、打好的留著,什麼都不寫;照常的時候跟以前一樣存、上傳 */
T['刷題頁聽力隨機練習、聽力錯題複習、動詞測驗:開始之後別的分頁登出、帳號資料夾還沒灌過時,作答與交卷跳「重新整理」卡、不對答案、什麼都不寫;照常時照樣存'] = async (B) => {
  const login = J({ access_token: 'x', user: USER });
  const day = Date.now() - 864e5;
  const oldHist = [0, 1, 2].map((n) => ({ m: 'g', id: 'old-' + n, c: 0, ok: true, t: day + n }));
  const rows = J([{ k: 'hist', v: oldHist, updated_at: new Date(day + 10).toISOString() }]);
  const P2 = 'tr_u' + CPID + '_listen_p2', HIST = 'tr_u' + CPID + '_hist', VQ = 'tr_u' + CPID + '_verb_quiz';
  const PICKED_L = "[...document.querySelectorAll('.letter-row .letter-big')].findIndex((b) => b.classList.contains('picked'))";
  const page = (url) => open(B, { url, user: true, sdk: fakeCloud({ user: USER }), ls: { [SB]: login, [HIST]: J(oldHist) }, ss: { __fake_rows: rows } });
  const card = async (s) => { const st = await state(s); return st.mask ? st.title : ''; };
  const out = [];
  for (const how of ['照常', '登出', '還沒灌過']) {
    const r = { how };
    /* 甲:聽力隨機練習(交卷式:先選、交卷才對答案) */
    let s = await page('practice.html');
    try {
      await pressText(s, '.practice-panel .btn.primary', '開始聽力練習');   // data-gate,這時能作答
      r.letters = await s.eval("document.querySelectorAll('.letter-row .letter-big').length");
      await click(s, '.letter-row .letter-big', 0);   // 能作答時先選 A
      await s.eval(COUNT_SILENT);
      if (BREAK_ACCOUNT[how]) await s.eval(BREAK_ACCOUNT[how]);
      const before = await s.eval(LS), up0 = await s.eval(UPS);
      await click(s, '.letter-row .letter-big', 1);   // 改選 B
      r.pickCard = await card(s);
      r.picked = await s.eval(PICKED_L);
      if (r.pickCard) await closeBy(s, 'esc');
      await s.eval('window.confirm = () => true; true');
      await pressText(s, '.drill-nav-btns .btn', '直接交卷');
      r.submitCard = await card(s);
      r.report = await s.eval("(document.querySelector('.report-head') || {}).textContent || ''");
      r.picked2 = await s.eval(PICKED_L);
      await sleep(1300);
      r.wrote = lsDiff(before, await s.eval(LS)).filter((k) => !/_pet$/.test(k));
      r.ups = (await s.eval(UPS)).slice(up0.length);
      r.silent = await s.eval(SILENT);
    } finally { await s.close(); }
    /* 乙:聽力錯題複習(即時對答,答對才移出錯題本) */
    s = await page('practice.html');
    try {
      await s.eval(`window.__old = true; localStorage.setItem(${J(P2)}, JSON.stringify({ [TOEIC.listening.p2[0].id]: { c: (TOEIC.listening.p2[0].answer + 1) % 3, ok: false, t: 1 } })); location.reload(); true`);
      r.revSettled = await settleNav(s);
      await sleep(800);
      await s.eval("(() => { const row = [...document.querySelectorAll('.review-row')].find((x) => /聽力 Part 2/.test(x.textContent)); const b = row && row.querySelector('.btn'); if (!b) return false; b.id = '__press'; return true; })()");
      await click(s, '#__press');   // 複習(data-gate,這時能作答)
      r.revLetters = await s.eval("document.querySelectorAll('.letter-row .letter-big').length");
      await s.eval(COUNT_SILENT);
      if (BREAK_ACCOUNT[how]) await s.eval(BREAK_ACCOUNT[how]);
      const before = await s.eval(LS), up0 = await s.eval(UPS);
      await click(s, '.letter-row .letter-big', await s.eval('TOEIC.listening.p2[0].answer'));   // 點正確答案
      r.revCard = await card(s);
      r.verdict = await s.eval("(document.querySelector('.verdict') || {}).textContent || ''");
      await sleep(1300);
      r.revWrote = lsDiff(before, await s.eval(LS)).filter((k) => !/_pet$/.test(k));
      r.revUps = (await s.eval(UPS)).slice(up0.length);
      r.revOk = await s.eval(`(() => { const st = JSON.parse(localStorage.getItem(${J(P2)}) || 'null'); return st ? !!st[TOEIC.listening.p2[0].id].ok : null; })()`);
      r.revSilent = await s.eval(SILENT);
    } finally { await s.close(); }
    /* 丙:動詞測驗(打過去式、過去分詞,Enter 或「對答案」) */
    s = await page('grammar.html?ref=verbs');
    try {
      await click(s, '.vb-bar .btn.primary');   // 測驗這些字(data-gate,這時能作答)
      r.inputs = await s.eval("document.querySelectorAll('input.vb-input').length");
      await s.eval("document.querySelectorAll('input.vb-input')[0].focus(); true");
      await s.send('Input.insertText', { text: 'went' });   // 能作答時先打第一格
      await s.eval(COUNT_SILENT);
      if (BREAK_ACCOUNT[how]) await s.eval(BREAK_ACCOUNT[how]);
      const before = await s.eval(LS), up0 = await s.eval(UPS);
      await s.eval("document.querySelectorAll('input.vb-input')[1].focus(); true");
      await key(s, 'a');   // 第二格打字
      r.typeCard = await card(s);
      if (r.typeCard) await closeBy(s, 'esc');
      await s.eval("document.querySelectorAll('input.vb-input')[0].focus(); true");
      await key(s, 'Enter');   // 在第一格按 Enter(第二格有字就是對答案)
      r.enterCard = await card(s);
      if (r.enterCard) await closeBy(s, 'esc');
      if (how !== '照常') { await click(s, '.vb-inputs .btn.primary'); r.btnCard = await card(s); }   // 「對答案」
      r.vals = await s.eval("[...document.querySelectorAll('input.vb-input')].map((x) => x.value)");
      r.vbVerdict = await s.eval("(document.querySelector('.q-block .verdict') || {}).textContent || ''");
      r.marked = await s.eval("document.querySelectorAll('.q-nav .ok, .q-nav .ng').length");
      await sleep(1300);
      r.vbWrote = lsDiff(before, await s.eval(LS)).filter((k) => !/_pet$/.test(k));
      r.vbUps = (await s.eval(UPS)).slice(up0.length);
      r.vbSilent = await s.eval(SILENT);
    } finally { await s.close(); }
    const has = (a, ks) => ks.every((k) => a.includes(k));
    if (how === '照常') {
      r.ok = r.letters === 3 && !r.pickCard && r.picked === 1 && !r.submitCard && /答對 \d+ \/ 10 題/.test(r.report) && has(r.wrote, [HIST, P2]) && has(r.ups, ['hist', 'listen_p2'])
        && r.revSettled && r.revLetters === 3 && !r.revCard && /答對了/.test(r.verdict) && has(r.revWrote, [HIST, P2]) && has(r.revUps, ['hist', 'listen_p2']) && r.revOk === true
        /* 照常按 Enter 對完答案,同一下 Enter 落到剛拿到焦點的「下一題」(main 就是這樣),畫面已經是下一題:只看題號列記了對錯、存了 */
        && r.inputs === 2 && !r.typeCard && !r.enterCard && r.marked === 1 && has(r.vbWrote, [HIST, VQ]) && has(r.vbUps, ['hist', 'verb_quiz'])
        && !r.silent.length && !r.revSilent.length && !r.vbSilent.length;
    } else {
      const title = how === '登出' ? /已經在別的分頁登出/ : /還沒載入/;
      r.ok = r.letters === 3 && title.test(r.pickCard) && r.picked === 0 && title.test(r.submitCard) && !r.report && r.picked2 === 0 && !r.wrote.length && !r.ups.length
        && r.revSettled && r.revLetters === 3 && title.test(r.revCard) && !r.verdict && !r.revWrote.length && !r.revUps.length && r.revOk === (how === '登出' ? null : false)
        && r.inputs === 2 && title.test(r.typeCard) && title.test(r.enterCard) && title.test(r.btnCard) && J(r.vals) === J(['went', '']) && !r.vbVerdict && r.marked === 0
        && !r.vbWrote.length && !r.vbUps.length && !r.silent.length && !r.revSilent.length && !r.vbSilent.length;
    }
    out.push(r);
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 多分頁第 3 輪審查 #1(2026-11-01):別的分頁登出又登回來、正在灌資料(「還沒灌過」標記記著、帳號資料夾空的)時,這個分頁換到寫作頁的技巧課。
   寫作頁的 readMap 是畫面時讀的(開頁時是空的),按「標記讀完」整份寫回。這一頁確認登入(查教師身分)之前別的分頁先灌好、劃掉標記:
   以前這一頁不灌資料,按下去雲端 writing_read 從三課變成只剩這一課。要的是:這一頁重灌重載,畫面換成灌好的資料夾,按下去四課都在;
   這一頁自己讀雲端也失敗時,按下去跳「重新整理」卡、什麼都不寫,雲端三課還在 */
T['寫作頁:開頁時帳號資料夾還沒灌過(別的分頁正在灌),確認登入前別的分頁先灌好:這一頁重灌重載,按「標記讀完」雲端原本的課都在;自己讀不到雲端時跳卡、不寫'] = async (B) => {
  const READ3 = { 'w1-lesson-1': true, 'w1-lesson-3': true, 'w2-lesson-1': true };
  const rows = J([{ k: 'writing_read', v: READ3, updated_at: new Date(Date.now() - 864e5).toISOString() }]);
  const out = [];
  for (const how of ['讀得到', '這一頁也讀不到']) {
    const r = { how };
    const ss = { __fake_rows: rows, ['tr_cloud_hydrated_' + UID]: '1' };
    if (how !== '讀得到') ss.__fake_fail = '1';
    const s = await open(B, { url: 'robots.txt', early: true, sdk: fakeCloud({ user: USER, teachersDelay: 2500 }),
      ls: { [SB]: J({ access_token: 'x', user: USER }), tr_current_profile: J(CPID), ['tr_cloud_unhydrated_' + UID]: '1' }, ss });
    try {
      await s.go('writing.html?level=l1&u=8');
      r.atLoad = await s.eval(`({ btn: !![...document.querySelectorAll('button')].find((b) => b.textContent === '標記讀完'), read: localStorage.getItem(${J('tr_u' + CPID + '_writing_read')}) })`);
      /* 別的分頁灌好了:帳號資料夾寫進雲端那三課、記上「灌過」、劃掉「還沒灌過」(js/cloud.js afterAuth 灌好時做的) */
      await s.eval(`window.__old = true; localStorage.setItem(${J('tr_u' + CPID + '_writing_read')}, ${J(J(READ3))}); localStorage.setItem(${J('tr_cloud_seen_' + UID)}, '1');
        localStorage.removeItem(${J('tr_cloud_unhydrated_' + UID)}); true`);
      for (let i = 0; i < 60; i++) { await sleep(150); try { if (await s.eval("document.readyState === 'complete' && !!window.CLOUD && CLOUD.ready.then(() => !CLOUD.reloading, () => !CLOUD.reloading)")) break; } catch (e) { /* 換頁中 */ } }
      await sleep(1500);
      r.reloaded = await s.eval('!window.__old');
      r.canAct = await s.eval('PROFILE.canAct()');
      await pressText(s, 'button', '標記讀完');
      await sleep(1500);
      const st = await state(s);
      r.card = { mask: st.mask, title: st.title };
      r.local = Object.keys(JSON.parse((await s.eval(`localStorage.getItem(${J('tr_u' + CPID + '_writing_read')})`)) || '{}')).sort();
      const db = JSON.parse(await s.eval("sessionStorage.getItem('__fake_rows') || '[]'"));
      r.cloud = Object.keys((db.find((x) => x.k === 'writing_read') || {}).v || {}).sort();
      const keep3 = Object.keys(READ3).every((k) => r.cloud.includes(k));
      r.ok = r.atLoad.btn && r.atLoad.read === null && keep3 && (how === '讀得到'
        ? r.reloaded && r.canAct && !r.card.mask && r.cloud.length === 4 && r.local.length === 4
        : !r.reloaded && !r.canAct && r.card.mask && /還沒載入/.test(r.card.title) && r.cloud.length === 3 && r.local.length === 3);
    } finally { await s.close(); }
    out.push(r);
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 審查 D 第 2 輪 #3:加入班級視窗開著(自己按開的、邀請連結 ?join= 開的)、改暱稱視窗開著的時候,別的分頁登出 X、改登入 Y。
   以前按「加入」:不送(對),但連視窗帶打好的邀請碼一起關掉、開卡;卡上說「要留著的話，先在別的分頁登回原本的帳號，再回來按一次」,
   照做之後視窗是空的(?join= 的碼開頁時就從網址拿掉了)。改暱稱也一樣,打的暱稱不見了。
   要的是:加入視窗不關,那句話寫在表單的訊息行,碼留在框裡;登回 X 再按一次「加入」照常送到 X。
   改暱稱:跳卡、不送;登回 X 再按「改暱稱」,視窗裡預先填的是剛剛打的那個暱稱 */
T['加入班級、改暱稱的視窗開著時別的分頁換帳號:按下去不送,邀請碼留在視窗裡、打的暱稱下次打開還在;登回原帳號再按一次照常送'] = async (B) => {
  const login = J({ access_token: 'x', user: USER });
  const TO_Y = `(() => { ${OTHER_TAB_LOGOUT}; localStorage.setItem(${J(SB)}, ${J(J({ access_token: 'y', user: Y_USER }))}); localStorage.setItem('tr_current_profile', ${J(J(YPID))}); return true; })()`;
  const BACK_X = `(() => { localStorage.setItem(${J(SB)}, ${J(login)}); localStorage.setItem('tr_current_profile', ${J(J(CPID))}); return CLOUD.accountCheck() === ''; })()`;
  const SENT = "JSON.parse(sessionStorage.getItem('__fake_calls') || '[]').map((c) => c.op + '@' + (c.as === " + J(UID) + " ? 'X' : c.as === " + J(Y_USER.id) + " ? 'Y' : c.as))";
  const press = async (s, sel, text) => {
    const ok = await s.eval(`(() => { const old = document.getElementById('__press'); if (old) old.removeAttribute('id');
      const b = [...document.querySelectorAll(${J(sel)})].find((x) => x.textContent.trim() === ${J(text)}); if (!b) return false; b.id = '__press'; return true; })()`);
    if (!ok) throw new Error('找不到 ' + sel + ' 「' + text + '」');
    await click(s, '#__press');
  };
  const JOIN = "(() => { const m = document.querySelector('.modal-join'); return m ? { code: m.querySelector('.join-code').value, msg: (m.querySelector('.auth-msg') || {}).textContent || '' } : null; })()";
  const out = [];
  for (const how of ['自己開的視窗', '邀請連結']) {
    const r = { how };
    const s = await open(B, { url: how === '邀請連結' ? 'me.html?join=ABCD2345' : 'me.html', user: true, sdk: fakeCloud({ user: USER }), ls: { [SB]: login } });
    try {
      await s.eval('window.__mark = 1; true');
      if (how !== '邀請連結') {
        await press(s, '.me-row', '加入班級');
        await s.eval("(() => { const i = document.querySelector('.modal-join .join-code'); i.value = 'ABCD2345'; i.dispatchEvent(new Event('input')); return true; })()");
      }
      r.open = await s.eval(JOIN);
      await s.eval(TO_Y);
      await press(s, '.modal-join .auth-submit', '加入');
      await sleep(900);
      r.sent = await s.eval(SENT);
      r.after = await s.eval(JOIN);
      r.card = (await state(s)).title;
      r.reload = !!(await s.eval("document.querySelector('.modal-reload')"));
      r.back = await s.eval(BACK_X);
      if (r.after) { await press(s, '.modal-join .auth-submit', '加入'); await sleep(900); }
      r.sent2 = (await s.eval(SENT)).slice(r.sent.length);
      r.stay = await s.eval('window.__mark === 1');
      r.ok = !!r.open && r.open.code === 'ABCD2345' && !r.sent.length && !!r.after && r.after.code === 'ABCD2345' && /已經在別的分頁登出/.test(r.after.msg) && !r.reload
        && r.back && J(r.sent2) === J(['rpc:join_class@X']) && r.stay;
    } finally { await s.close(); }
    out.push(r);
  }
  /* 改暱稱:暱稱視窗開著的時候別的分頁換成 Y */
  const r = { how: '改暱稱' };
  const s = await open(B, { url: 'me.html', user: true, sdk: fakeCloud({ user: USER }), ls: { [SB]: login } });
  try {
    await s.eval(`(() => { window.__prompts = []; window.__mark = 1; window.alert = (m) => { window.__prompts.push('alert:' + m); };
      window.prompt = (m, d) => { window.__prompts.push(d); if (window.__prompts.length === 1) ${TO_Y}; return window.__prompts.length === 1 ? '新暱稱' : null; }; return true; })()`);
    await press(s, '.me-row', '改暱稱');
    await sleep(900);
    r.card = (await state(s)).title;
    r.sent = await s.eval(SENT);
    if ((await state(s)).mask) await closeBy(s, 'esc');
    r.back = await s.eval(BACK_X);
    await press(s, '.me-row', '改暱稱');   // 登回 X 之後再按一次:這次按取消
    await sleep(500);
    r.prompts = await s.eval('window.__prompts');
    r.sent2 = (await s.eval(SENT)).slice(r.sent.length);
    r.stay = await s.eval('window.__mark === 1');
    r.ok = /已經在別的分頁登出/.test(r.card) && !r.sent.length && r.back && J(r.prompts) === J(['測試', '新暱稱']) && !r.sent2.length && r.stay;
  } finally { await s.close(); }
  out.push(r);
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 審查 D(e49e444 就有;tools/test_sync.js 情境 63 測 js/cloud.js 送出前的確認):分頁畫面是帳號 X、沒重載,別的分頁登出 X、改登入 Y(或只登出)。
   supabase-js 送出時用的是這台現在的登入資料:以前這一頁按「刪除帳號」刪掉的是 Y 的帳號與雲端進度,「登出」把 Y 登出,
   「改暱稱」改的是 Y,「加入班級」把 Y 加進班。要的是:「我的」頁、頭像選單的這些按鈕都不問、不送,跳「這個帳號已經在別的分頁登出」卡,
   說剛剛按的沒有送出;Y 的登入資料、目前帳號、資料夾都不動,這一頁不重載,X 的資料夾不會被建回來。
   問的時候換帳號:確認視窗、暱稱視窗開著時別的分頁才換成 Y,按確定之後 js/cloud.js 送出前那一次確認擋下,一樣跳卡、不跳 alert、不送。
   平常登入著的「我的」頁:改暱稱、刪除帳號照常問、照常送到 X。
   審查 D 第 1 輪 #1、#3:這台已經沒有任何人登入著(只登出;或登入被撤銷、別的分頁照 leaveStaleAccount 改回訪客,X 的資料夾還留著)時按「登出」,
   不會登出到別人:照 e49e444 清掉 X 留在這台的東西、重載,但不呼叫 signOut(31745ec 跳卡、X 的資料留在共用電腦上)。刪除帳號照樣擋 */
T['別的分頁登出、改登入別人後沒重載的頁面:按登出、登出所有裝置、改暱稱、刪除帳號、加入班級都不問不送,跳「這個帳號已經在別的分頁登出」卡;平常登入著照常'] = async (B) => {
  const login = J({ access_token: 'x', user: USER });
  /* 確認視窗、輸入視窗記在 sessionStorage 的 __dlg(重載後還在):都回「確定」 */
  const DLG = `(() => { const rec = (x) => { const d = JSON.parse(sessionStorage.getItem('__dlg') || '[]'); d.push(x); sessionStorage.setItem('__dlg', JSON.stringify(d)); };
    window.confirm = () => { rec('confirm'); return true; }; window.prompt = () => { rec('prompt'); return '新暱稱'; }; window.alert = (m) => { rec('alert:' + m); };
    window.__mark = 1; return true; })()`;
  const OTHER = {
    換帳號: `(() => { ${OTHER_TAB_LOGOUT}; localStorage.setItem(${J(SB)}, ${J(J({ access_token: 'y', user: Y_USER }))}); localStorage.setItem('tr_current_profile', ${J(J(YPID))});
      localStorage.setItem(${J('tr_u' + YPID + '_hist')}, '[1]'); return true; })()`,
    只登出: OTHER_TAB_LOGOUT,
    /* 登入被撤銷(supabase-js 清掉登入資料),別的分頁開頁改回訪客(刪掉目前帳號);X 的資料夾照設計留著 */
    撤銷後改回訪客: `(() => { [${J(SB)}, ${J(SB + '-user')}, 'tr_current_profile'].forEach((k) => localStorage.removeItem(k)); return true; })()`,
  };
  const press = async (s, sel, text) => {
    const ok = await s.eval(`(() => { const old = document.getElementById('__press'); if (old) old.removeAttribute('id');
      const b = [...document.querySelectorAll(${J(sel)})].find((x) => x.textContent.trim() === ${J(text)}); if (!b) return false; b.id = '__press'; return true; })()`);
    if (!ok) throw new Error('找不到 ' + sel + ' 「' + text + '」');
    await click(s, '#__press');
  };
  const ACTS = {
    '我的頁:登出': (s) => press(s, '.me-row', '登出'),
    '我的頁:登出所有裝置': (s) => press(s, '.me-row', '登出所有裝置'),
    '我的頁:改暱稱': (s) => press(s, '.me-row', '改暱稱'),
    '我的頁:刪除帳號': (s) => press(s, '.me-delete button', '刪除帳號'),
    /* 以前會先開加入視窗:照樣填碼按加入,看請求送給誰 */
    '我的頁:加入班級': async (s) => {
      await press(s, '.me-row', '加入班級');
      if (await s.eval("!!document.querySelector('.modal-join')")) {
        await s.eval("document.querySelector('.modal-join .join-code').value = 'ABCD2345'; true");
        await press(s, '.modal-join .auth-submit', '加入');
      }
    },
    '頭像選單:登出': async (s) => { await click(s, '.profile-btn'); await press(s, '.profile-menu .pm-item', '登出'); },
    '頭像選單:改暱稱': async (s) => { await click(s, '.profile-btn'); await press(s, '.profile-menu .pm-item', '改暱稱'); },
    '頭像選單:刪除帳號': async (s) => { await click(s, '.profile-btn'); await press(s, '.profile-menu .pm-item', '刪除帳號'); },
  };
  const keys = (ls) => { const o = JSON.parse(ls); return { sb: o[SB] || null, cp: o.tr_current_profile || null, y: o['tr_u' + YPID + '_hist'] || null, x: accountKeys(ls).length }; };
  const who = (id) => (id === UID ? 'X' : id === Y_USER.id ? 'Y' : String(id));
  const run = async (how, name) => {
    const r = { how, name };
    const s = await open(B, { url: 'me.html', user: true, sdk: fakeCloud({ user: USER }), ls: { [SB]: login, ['tr_u' + CPID + '_hist']: J([{ m: 'g', id: 'x-1', c: 0, ok: true, t: Date.now() - 864e5 }]) } });
    try {
      await s.eval(DLG);
      if (OTHER[how]) await s.eval(OTHER[how]);
      /* 第一個確認視窗、暱稱視窗開著的時候,別的分頁換成 Y */
      if (how === '問的時候換帳號') {
        await s.eval(`(() => { const sw = () => { if (!window.__switched) { window.__switched = 1; ${OTHER['換帳號']}; } };
          const c = window.confirm, p = window.prompt; window.confirm = (m) => { sw(); return c(m); }; window.prompt = (m, d) => { sw(); return p(m, d); }; return true; })()`);
      }
      const before = keys(await s.eval(LS));
      const c0 = JSON.parse(await s.eval("sessionStorage.getItem('__fake_calls') || '[]'")).length;
      await ACTS[name](s);
      await sleep(900);
      await s.loaded();
      r.stay = await s.eval('window.__mark === 1');   // 這一頁沒有重載
      const st = await state(s);
      r.card = { mask: st.mask, title: st.title, why: st.why };
      r.dlg = JSON.parse(await s.eval("sessionStorage.getItem('__dlg') || '[]'"));
      r.sent = JSON.parse(await s.eval("sessionStorage.getItem('__fake_calls') || '[]'")).slice(c0).map((c) => c.op + '@' + who(c.as));
      const after = keys(await s.eval(LS));
      r.kept = how === '問的時候換帳號'
        ? after.cp === J(YPID) && JSON.parse(after.sb || '{}').user.id === Y_USER.id && after.y === '[1]' && after.x === 0
        : J(before) === J(after);
      r.x0 = before.x; r.xLeft = after.x;
    } finally { await s.close(); }
    const asked = { '我的頁:改暱稱': ['prompt'], '我的頁:登出所有裝置': ['confirm'], '我的頁:刪除帳號': ['confirm', 'confirm'] };
    const cleared = (how === '只登出' || how === '撤銷後改回訪客') && /登出$/.test(name) && !/所有裝置/.test(name);
    r.ok = cleared
      ? !r.stay && !/已經在別的分頁登出/.test(r.card.title) && !r.dlg.some((d) => /^(prompt|alert)/.test(d)) && !r.sent.length && r.xLeft === 0 && (how !== '撤銷後改回訪客' || r.x0 > 0)
      : how === '平常'
      ? (name === '我的頁:改暱稱' ? J(r.dlg) === J(['prompt']) && J(r.sent) === J(['updateUser@X'])
        : J(r.dlg) === J(['confirm', 'confirm']) && J(r.sent) === J(['rpc:delete_own_account@X', 'signOut@X']))
      : r.stay && r.card.mask && /已經在別的分頁登出/.test(r.card.title) && /剛剛按的沒有送出/.test(r.card.why) && /重新整理/.test(r.card.why)
        && (how === '問的時候換帳號' ? J(r.dlg) === J(asked[name]) : !r.dlg.length) && !r.sent.length && r.kept && (how === '撤銷後改回訪客' ? r.xLeft > 0 : r.xLeft === 0);
    return r;
  };
  const out = [];
  for (const name of Object.keys(ACTS)) out.push(await run('換帳號', name));
  for (const name of ['我的頁:刪除帳號', '頭像選單:登出']) out.push(await run('只登出', name));
  for (const name of ['我的頁:登出', '頭像選單:登出', '我的頁:刪除帳號']) out.push(await run('撤銷後改回訪客', name));
  for (const name of ['我的頁:改暱稱', '我的頁:登出所有裝置', '我的頁:刪除帳號']) out.push(await run('問的時候換帳號', name));
  for (const name of ['我的頁:改暱稱', '我的頁:刪除帳號']) out.push(await run('平常', name));
  const bad = out.filter((r) => !r.ok);
  return { ok: !bad.length, detail: bad.length ? '不對的 ' + bad.length + ' 項:' + J(bad) : J(out.map((r) => r.how + '/' + r.name + ' 送了 ' + (r.sent.join(',') || '沒有'))) };
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
