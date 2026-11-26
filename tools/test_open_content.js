/* 「先看再登入」的無頭 Chrome 測試(2026-10-31 決定):內容頁沒登入(雲端)、沒選學生(本機)也看得到內容,
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
/* true 時 .html 送 no-cache(不是 no-store):頁面進得了 bfcache,跟 GitHub Pages 一樣,按上一頁是原樣拿回來(錯題本 U16 用) */
let BFCACHE = false;

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
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': BFCACHE && path.extname(file) === '.html' ? 'no-cache' : 'no-store' });
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
  const waiting = new Map(), errors = [], warns = [], subs = new Set();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); return; }
    if (msg.method) subs.forEach((f) => f(msg));   // on():事件(例如 Page.javascriptDialogOpening,flatten 時帶 sessionId)
    if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'warning') warns.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
  };
  const send = (method, params, sessionId) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(J(Object.assign({ id: i, method, params: params || {} }, sessionId ? { sessionId } : {}))); });
  const on = (f) => { subs.add(f); return () => subs.delete(f); };
  return new Promise((resolve, reject) => { ws.onopen = () => resolve({ ws, send, errors, warns, on }); ws.onerror = reject; });
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
/* 會登入、會存雲端的假 supabase-js:登入資料存在 SB(跟真的 supabase-js 同一個鍵),重載後 getSession 讀得到;
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
     { op, as: 送出時這台登入資料的帳號 id }(跟真的 supabase-js 一樣,請求帶的是 localStorage 現在的登入資料;看有沒有送、送給誰)。回的東西跟以前一樣 */
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
    send, origin, sid,
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
/* 單字頁「練哪些字」勾著的來源(清單順序) */
const VG_PICKED = "[...document.querySelectorAll('.vg-pick input[type=checkbox][value]')].filter((e) => e.checked).map((e) => e.value).join(',')";

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
  { url: 'dialogue.html?id=dlg-01', see: '.dlg-bubble', free: [{ sel: '.dlg-bubble', thenText: ['.vocab-progress', /聽過 1 \//] }, { sel: '.vw.dlg-sl', then: '.vocab-pop' }] },
  { url: 'vocab.html', see: '.vg-games .vg-tile', act: [{ sel: '.vg-play .btn.primary' }, { sel: '.exercise-head .btn' }],
    free: [{ sel: '.vg-games .vg-tile', i: 1, then: '.vg-games .vg-tile.on' }, { sel: '.vg-phrase-tile', then: '.phrase-table' }], pick: true },
  { url: 'vocab.html', see: '.vg-games .vg-tile', pre: [{ sel: '.vg-games .vg-tile', i: 3 }], act: [{ sel: '.vg-play .btn.primary' }] },   // 先選第四塊磚(單字選擇題),再按「開始」
  { url: 'vocab.html#phrase', see: '.phrase-table', act: [{ sel: '.part-card:has(.phrase-table) .btn:not(.pop-mini)' }], free: [{ sel: '.part-card .pop-mini', thenText: ['.part-card .pop-mini', /收起/] }] },
  { url: 'listening.html', see: '.part-card', act: [{ sel: 'a.tile[href^="listening.html?sec="]' }] },
  { url: 'listening.html?sec=n', see: '.player-btn', act: [{ sel: '.opts .opt' }], free: [{ sel: '.player-btn', thenText: ['.player-note', /已播 1 次|音檔|找不到/] }] },
  { url: 'listening.html?sec=mp', see: '.pair-btn', act: [{ sel: '.pair-btn' }] },
  { url: 'listening.html?sec=d', see: 'textarea.write-area', act: [{ sel: 'textarea.write-area', text: true }, { sel: '.quiz-foot .btn.primary' }] },
  { url: 'listening.html?sec=s', see: '.shadow-stage', act: [{ sel: '.player .player-btn' }] },
  { url: 'writing.html', see: 'a.part-card' },
  { url: 'writing.html?level=l1', see: 'a.unit-row', free: [{ sel: 'a.unit-row', i: 2, nav: /u=2/ }] },
  { url: 'writing.html?level=l1&u=0', see: '.lesson-point', act: [{ sel: '.lesson-view .btn.primary' }] },
  { url: 'writing.html?level=l1&u=1', see: '.tiles .tile', act: [{ sel: '.tiles .tile' }, { sel: '.unit-block .pop-btns .btn.primary' }] },
  { url: 'writing.html?level=l1&u=23', see: 'textarea.write-area', act: [{ sel: 'textarea.write-area', text: true }], free: [{ sel: '.unit-block > .btn', then: '.model-box' }] },
  { url: 'writing.html?level=l3&u=3', see: '.outline-grid textarea', act: [{ sel: '.outline-grid textarea', text: true }, { sel: 'textarea.write-area', i: 4, text: true }] },
  { url: 'practice.html', see: '.practice-panel', act: [{ sel: '.practice-start' }, { sel: '.listen-start' }] },
  { url: 'practice.html?part=5', see: '.opts .opt', act: [{ sel: '.opts .opt' }], free: [{ sel: '.quiz-foot .btn.primary', then: '.quiz-foot .btn-text' }] },
  { url: 'practice.html?mode=wrong&part=5', see: '#practice-root .ui-empty' },   // 錯題本清單:沒登入看得到空狀態「沒有錯題」
  { url: 'diagnostic.html', see: '.diag-intro', act: [{ sel: '.diag-intro .btn.primary' }] },
  { url: 'mock.html', see: '.part-card', act: [{ sel: '.part-card .btn.primary' }, { sel: '.part-card .btn:not(.primary)' }] },
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
    for (const a of pg.pre || []) await click(s, a.sel, a.i);   // 作答前要先做的選擇(選磚)
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
      /* 閱讀頁的單字考題:字卡拖進空格(pointerdown 起頭)也被擋下,放開時跳出視窗(以前不跳,看不出為什麼拖不動) */
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
    if (pg.pick) {
      /* 練哪些字(看內容):點開清單,點「片語」那一列的名稱勾起來;照樣換,不跳視窗、不存 */
      const before = await snap(s);
      await click(s, '.vg-pick > summary');
      const opened = await s.eval("document.querySelector('.vg-pick').open");
      await click(s, '.vg-pick-row .vg-pick-name', 1);
      const on = await s.eval(VG_PICKED);
      if ((await state(s)).mask || !opened || on !== 'word,phrase') bad.push('勾字庫跳視窗或沒換 ' + J({ opened, on }));
      const d = lsDiff(before.ls, (await snap(s)).ls);
      if (d.length) bad.push('勾字庫寫了 ' + d.join(','));
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
      const ok = a.mask && !a.x && !a.why && b.mask && (mode === 'cloud' ? a.aria === 'true' : /選擇學生|新增學生/.test(a.title));
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
      /* 換字庫(練哪些字的勾選清單:勾片語、取消文章單字):存起來,跟以前選單存的一字不差;下面的遊戲卡片照新的字庫重畫(片語的最佳紀錄出現) */
      const v = await open(B, Object.assign({ url: 'vocab.html' }, r.o, { ls: { [r.prefix + 'vgame_best']: J({ phrase: 12 }) } }));
      await click(v, '.vg-pick > summary');
      await click(v, '.vg-pick-row .vg-pick-name', 1);
      await click(v, '.vg-pick-row .vg-pick-name', 0);
      const src = JSON.parse(await v.eval(LS))[r.prefix + 'vgame_src'];
      res.src = src === '{"mode":"phrase","level":"全部"}' && /最佳 中翻英 12/.test(await v.eval("document.querySelector('.vg-games').textContent"));
      await v.close();
      const d = await open(B, Object.assign({ url: 'dialogue.html?id=dlg-01' }, r.o));
      await click(d, '.dlg-bubble');
      await sleep(300);
      const heard = JSON.parse(await d.eval(LS))[r.prefix + 'dlg_heard'];
      res.heard = /聽過 1 \//.test(await d.eval("(document.querySelector('.vocab-progress') || {}).textContent || ''")) && /dlg-01/.test(heard || '');
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

/* 沒登入按「播放全部」,播到一半從頭像選單登入。登入成功(CLOUD.user 有了)到頁面重載之間,這一頁的資料夾還是訪客的;
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

/* 付費牆(PAID_UI 打開、試用結束)在 App 外殼裡跟登入視窗一樣露出頂欄和分頁列,分頁點得到(內容頁改成 on-action 之後也一樣) */
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

/* 矮一點的手機(iPhone SE、mini 的 Safari、Android)上,作答跳出的登入卡(切到註冊更高)比畫面高時遮罩可以捲:
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

/* 登入失效(別台按「登出所有裝置」)改回訪客,或別的分頁登出(帳號資料夾刪掉了),這個分頁灌過資料的旗標還在。
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

/* 桌機視窗比卡片矮(1366x768 的筆電、1920x1080 放大 125%)時遮罩有捲軸。按住捲軸拖是要捲動看下面,
   不是點遮罩:視窗不能關、打的字要還在。點遮罩的空白處照樣關 */
T['桌機矮視窗:按住登入卡、註冊卡、「你是哪位？」遮罩的捲軸拖動不會關掉視窗,打的字還在;點遮罩空白處照樣關'] = async () => {
  const out = [];
  const L = await launch(true);
  const B = await connect(L.ws);
  try {
    const cases = [
      { mode: 'cloud', w: 1280, h: 600, tab: 'signup' }, { mode: 'cloud', w: 1280, h: 560, tab: 'login' },
      { mode: 'local', w: 1280, h: 220 },
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

/* 閱讀頁單字考題說「字卡拖進空格」,拖曳是第一種作答方法。沒登入時拖不動,放開那一下要跳出視窗說明為什麼
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

/* 作答框按 Ctrl+V 貼上、把別處的文字拖進來,跟打字一樣是作答:沒登入時跳出視窗、框裡什麼都沒進來、什麼都不寫。
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

/* 先看再登入的主要流程是「沒登入按作答 → 登入卡 → Google → 回到同一個內容頁」。回來那一頁內容先畫好,
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

/* Google 回來(或在登入卡用密碼登入)時讀雲端進度失敗(網路斷一下、Supabase 慢或休眠):這一頁不重載,
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
   (98f3778 就有);重載後照常作答、寫進帳號資料夾、雲端原本的紀錄還在 */
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

/* 2026-10-31(main 130f330 就有,tools/test_sync.js 情境 52~54 測 cloud.js 的記帳;這裡測內容頁擋不擋得住、什麼都不寫):
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
    /* 卡上說的是帳號已經在別的分頁登出,不是「你已經登入了」(之前沿用「還沒載入你的練習紀錄」那張) */
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

/* 2026-10-31:沒有 data-require-profile 的頁面(每日練習)沒有 data-gate,profile.js 的 blocksWrite 也不管,
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

/* 2026-10-31:已登入、這台的帳號資料夾還沒灌過(空的,「還沒灌過」標記在)、讀雲端進度失敗時,
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

/* 2026-10-31:模擬考的「交卷」(和時間到自動交卷)沒有 data-gate。考到一半別的分頁登出、換帳號,
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
  /* 錯題本(E2、E3):Part 5 前兩題答錯(抽題固定);第 2 題 mock_wrong 裡已經有一筆比這次交卷新的,補存後還是那一筆 */
  const P5 = BANK.part5, newer = { [P5[1].id]: { c: P5[1].answer, ok: true, t: Date.now() + 600e3 } };
  const rows = J([{ k: 'mock_history', v: three, updated_at: new Date(day + 10000).toISOString() }, { k: 'mock_wrong', v: newer, updated_at: new Date(day + 10000).toISOString() }]);
  const login = J({ access_token: 'x', user: USER });
  const LATER = "JSON.parse(sessionStorage.getItem('tr_mock_unsaved') || '[]').length";
  const ANS = "(JSON.parse(sessionStorage.getItem('tr_mock_unsaved') || '[]')[0] || {}).ans || null";
  const MW = (pid) => `JSON.parse(localStorage.getItem(${J('tr_u' + (pid || CPID) + '_mock_wrong')}) || 'null')`;
  const mwOk = (v) => !!v && !!v[P5[0].id] && v[P5[0].id].ok === false && v[P5[0].id].c === wrongOf(P5[0]) && J(v[P5[1].id]) === J(newer[P5[1].id]);
  const out = [];
  for (const how of ['照常', '登出', '換帳號', '登回來還沒灌好', '時間到']) {
    const r = { how };
    const s = await open(B, { url: 'mock.html', user: true, sdk: fakeCloud({ user: USER }), pre: FIXRAND,
      ls: { [SB]: login, ['tr_u' + CPID + '_mock_history']: J(three), ['tr_u' + CPID + '_mock_wrong']: J(newer) }, ss: { __fake_rows: rows } });
    try {
      await click(s, '.part-card .btn.primary');   // 開始(這時登入著、能作答)
      r.started = await s.eval("!!document.querySelector('.quiz-bar .mock-timer') && PROFILE.canAct()");
      await mockPick(s, 8, 0, wrongOf(P5[0]));
      await mockPick(s, 9, 0, wrongOf(P5[1]));
      if (how !== '照常') await s.eval(OTHER_TAB_LOGOUT);
      if (how === '換帳號') await s.eval(`localStorage.setItem(${J(SB)}, ${J(J({ access_token: 'y', user: Y_USER }))}); localStorage.setItem('tr_current_profile', ${J(J(YPID))}); true`);
      if (how === '登回來還沒灌好') await s.eval(`localStorage.setItem(${J(SB)}, ${J(login)}); localStorage.setItem('tr_current_profile', ${J(J(CPID))}); localStorage.setItem(${J('tr_cloud_unhydrated_' + UID)}, '1'); true`);
      const before = await s.eval(LS);
      await s.eval('window.confirm = () => true; true');
      if (how === '時間到') { await s.eval('(() => { const t = Date.now; Date.now = () => t() + 60 * 60e3; return true; })()'); await sleep(1600); }
      else { await click(s, '.quiz-act'); await sleep(400); await click(s, '.ui-dialog-ok'); }   // 交卷(還有題沒答完,確認視窗按「交卷」)
      await sleep(how === '照常' ? 1500 : 600);
      r.result = await s.eval(`({ title: document.title, head: (document.querySelector('.result-card') || {}).textContent || '',
        note: (document.querySelector('.mock-unsaved') || {}).textContent || '', mask: !!document.querySelector('.modal-mask'), later: ${LATER} })`);
      r.wrote = lsDiff(before, await s.eval(LS)).filter((k) => /^tr_u|^tr_unsynced_/.test(k));
      r.ups = JSON.parse(await s.eval("sessionStorage.getItem('__fake_up') || '[]'")).filter((u) => u.k === 'mock_history').length;
      r.mwUps = JSON.parse(await s.eval("sessionStorage.getItem('__fake_up') || '[]'")).filter((u) => u.k === 'mock_wrong').length;
      const shown = /模擬考結果/.test(r.result.title) && /參考總分/.test(r.result.head) && !r.result.mask;
      if (how === '照常') {
        const db = JSON.parse(await s.eval("sessionStorage.getItem('__fake_rows') || '[]'"));
        r.cloud = ((db.find((x) => x.k === 'mock_history') || {}).v || []).length;
        r.mw = mwOk(await s.eval(MW())) && mwOk((db.find((x) => x.k === 'mock_wrong') || {}).v);
        r.ok = r.started && shown && !r.result.note && r.result.later === 0 && r.ups >= 1 && r.cloud === 4 && r.mw && r.mwUps === 1;
        out.push(r);
        continue;
      }
      /* 存不進去:錯題沒寫、沒傳;分頁暫存那一筆帶著作答(只有 [題目 key, 選的]) */
      r.ans = await s.eval(ANS);
      r.ansOk = Array.isArray(r.ans) && J(r.ans) === J([[P5[0].id, wrongOf(P5[0])], [P5[1].id, wrongOf(P5[1])]]);
      if (how === '換帳號') {   // 這個分頁重新整理,變成別人的頁面:不能補存進他的資料夾
        await s.eval('location.reload(); true');
        r.ySettled = await settleNav(s);
        await sleep(1300);
        r.y = await s.eval(`({ pid: window.__PROFILE_ID === ${J(YPID)}, has: (JSON.parse(localStorage.getItem(${J('tr_u' + YPID + '_mock_history')}) || '[]')).length, later: ${LATER},
          mw: localStorage.getItem(${J('tr_u' + YPID + '_mock_wrong')}) })`);
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
      r.mw = mwOk(end['tr_u' + CPID + '_mock_wrong'] ? JSON.parse(end['tr_u' + CPID + '_mock_wrong']) : null) && mwOk((db.find((x) => x.k === 'mock_wrong') || {}).v);
      r.ok = r.started && shown && /還沒存/.test(r.result.note) && r.result.later === 1 && !r.wrote.length && r.ups === 0 && r.mwUps === 0 && r.ansOk
        && (how !== '換帳號' || (r.ySettled && r.y.pid && r.y.has === three.length && r.y.later === 1 && !(JSON.parse(r.y.mw || '{}') || {})[P5[0].id]))   // 假雲端不分帳號:別人灌下來的是雲端那份,沒有這次的錯題
        && r.settled && r.local === 4 && r.cloud === 4 && r.laterEnd === 0 && r.rows === 5 && r.mw;
    } finally { await s.close(); }
    out.push(r);
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 多分頁(2026-11-01):單字頁的題庫編輯器(加入單字、勾選、刪字、改名)和遊戲、片語特訓的選項沒有 data-gate
   (進來那一下的「新增題庫」「編輯」「開始練習」才有)。進來之後別的分頁登出,或這台的帳號資料夾還沒灌過(別的分頁正在灌、讀不到雲端):
   以前 common.js 的 store 靜靜不寫,畫面卻寫「加入 3 個」、清空輸入框、清單 0 個字,選項照樣對答案,什麼提示都沒有(e49e444 則會寫進
   被刪掉的資料夾、記帳)。要的是:跳「重新整理」卡,輸入框的字留著、勾選不變、字沒刪,什麼都不寫;照常的時候跟以前一樣 */
const VOCAB_BANK = [{ id: 'b_old', name: '舊題庫', words: [{ en: 'apple', zh: '蘋果', on: true }, { en: 'pear', zh: '梨', on: true }] }];
const BREAK_ACCOUNT = { '登出': OTHER_TAB_LOGOUT, '還沒灌過': `localStorage.setItem(${J('tr_cloud_unhydrated_' + UID)}, '1'); true` };
/* 單字頁:先選第 i 塊玩法磚(0 掉落消除、1 翻牌配對、2 記憶吐司、3 單字選擇題),再按唯一的主按鈕「開始」 */
async function pickGame(s, i) { await click(s, '.vg-games .vg-tile', i); await click(s, '.vg-play .btn.primary'); }
async function vocabOpen(B, hash) {
  const ls = { [SB]: J({ access_token: 'x', user: USER }), ['tr_u' + CPID + '_vgame_banks']: J(VOCAB_BANK) };
  const rows = J([{ k: 'vgame_banks', v: VOCAB_BANK, updated_at: new Date(Date.now() - 864e5).toISOString() }]);
  return open(B, { url: 'vocab.html' + (hash || ''), user: true, sdk: fakeCloud({ user: USER }), ls, ss: { __fake_rows: rows } });
}
async function pressText(s, sel, text) {
  await s.eval(`(() => { const b = [...document.querySelectorAll(${J(sel)})].find((x) => x.textContent.indexOf(${J(text)}) > -1); if (!b) return false; b.id = '__press'; return true; })()`);
  await click(s, '#__press');
}
/* 專心模式(UI.focus)作答列的總數(進度條的 aria-valuemax):題庫、聽力的題號列拿掉之後,「這一輪幾個單元」看這裡 */
const QUIZ_TOTAL = "Number((document.querySelector('.quiz-track') || { getAttribute: () => 0 }).getAttribute('aria-valuemax'))";
/* 按下去會開頁面裡的確認視窗(UI.confirm)的按鈕:按下去、等視窗出現,先跑 during,再按確定。回 ['confirm'](沒開視窗回 []) */
async function pressUiConfirm(s, sel, text, during) {
  await pressText(s, sel, text);
  await sleep(400);
  if (!(await s.eval("!!document.querySelector('.ui-dialog')"))) return [];
  if (during) await during();
  await sleep(300);
  await click(s, '.ui-dialog-ok');
  return ['confirm'];
}

/* 單字頁「練哪些字」改成勾選清單(2026-11 決定):
   已登入:點開清單勾兩個題庫、取消文章單字 → 存起來(mode 是第一個、modes 照清單順序),重新整理還記得,記憶吐司烤的字就是兩個題庫的字;
   全部取消:不存、寫「至少勾一個。」、四個「開始」都不能按(按了也不跳視窗);再勾回一個(3 個字):掉落、翻牌能按,吐司、選擇題不能,卡片寫要幾個。
   手機寬(375、320):點開清單沒有左右捲動、每一列至少 40px 高、點名稱就能勾、級別選單不在 label 裡(點它不會切換勾選)。
   沒登入:勾了照樣換、不跳視窗、不存,重新整理回到原本的(只記在這一頁) */
const PICK_BANKS = [
  { id: 'bA', name: '甲題庫', words: [{ en: 'apple', zh: '蘋果', on: true }, { en: 'pear', zh: '梨', on: true }, { en: 'kiwi', zh: '奇異果', on: true }] },
  { id: 'bB', name: '乙題庫', words: [{ en: 'grape', zh: '葡萄', on: true }, { en: 'lemon', zh: '檸檬', on: true }, { en: 'mango', zh: '芒果', on: true }] },
];
async function pickOpen(B, extra, banks) {
  banks = banks || PICK_BANKS;
  const ls = { [SB]: J({ access_token: 'x', user: USER }), ['tr_u' + CPID + '_vgame_banks']: J(banks) };
  const rows = J([{ k: 'vgame_banks', v: banks, updated_at: new Date(Date.now() - 864e5).toISOString() }]);
  return open(B, Object.assign({ url: 'vocab.html', user: true, sdk: fakeCloud({ user: USER }), ls, ss: { __fake_rows: rows } }, extra || {}));
}
async function reload(s) {
  await s.go('vocab.html');
  await s.eval('window.CLOUD && CLOUD.ready ? CLOUD.ready.then(() => true, () => true) : true');
  await sleep(1000);
}
T['單字頁「練哪些字」勾選清單:勾兩個題庫存起來、重新整理還在、遊戲的字來自兩個題庫;全部取消不存、開始不能按;手機寬好點;沒登入只記在這一頁'] = async (B) => {
  const r = {};
  const SRCK = 'tr_u' + CPID + '_vgame_src';
  const STARTS = "[...document.querySelectorAll('.vg-games .vg-tile')].map((b) => b.classList.contains('is-blocked'))";   // 四塊玩法磚能不能玩(不能玩的磚不給按「開始」)
  const SUM = "document.querySelector('.vg-pick > summary').textContent";
  const noPet = (keys) => keys.filter((k) => !/_pet$/.test(k));
  let s = await pickOpen(B);
  try {
    r.first = await s.eval(VG_PICKED);
    await click(s, '.vg-pick > summary');
    await click(s, '.vg-pick-row .vg-pick-name', 2);   // 甲題庫
    await click(s, '.vg-pick-row .vg-pick-name', 3);   // 乙題庫
    await click(s, '.vg-pick-row .vg-pick-name', 0);   // 取消文章單字
    r.checked = await s.eval(VG_PICKED);
    r.src = JSON.parse(await s.eval(LS))[SRCK];
    r.sum = await s.eval(SUM);
    await sleep(900);   // 0.8 秒後上傳雲端
    await reload(s);
    r.reload = { checked: await s.eval(VG_PICKED), open: await s.eval("document.querySelector('.vg-pick').open"), sum: await s.eval(SUM) };
    await pickGame(s, 2);   // 記憶吐司
    r.toast = await s.eval("[...document.querySelectorAll('.toast-card b')].map((e) => e.textContent).sort().join(',')");
    await reload(s);
    await click(s, '.vg-pick > summary');
    await click(s, '.vg-pick-row .vg-pick-name', 2);   // 剩乙題庫(存了);再取消乙 = 0 個,不存
    await sleep(900);
    const before = await s.eval(LS);
    await click(s, '.vg-pick-row .vg-pick-name', 3);
    r.zero = { checked: await s.eval(VG_PICKED), note: await s.eval("document.querySelector('.vg-pick-note').textContent"), starts: await s.eval(STARTS), sum: await s.eval(SUM),
      cards: await s.eval("[...document.querySelectorAll('.vg-games .vg-tile')].every((c) => /先在上面勾要練的字/.test(c.textContent))") };
    await click(s, '.vg-play .btn.primary');   // 不能按:不跳視窗、不開始
    r.zero.mask = (await state(s)).mask;
    r.zero.home = await s.eval("!!document.querySelector('[data-vview=home]')");
    r.zero.wrote = noPet(lsDiff(before, await s.eval(LS)));
    await click(s, '.vg-pick-row .vg-pick-name', 2);
    r.one = { starts: await s.eval(STARTS), src: JSON.parse(await s.eval(LS))[SRCK], card: await s.eval("document.querySelectorAll('.vg-games .vg-tile')[2].textContent") };
  } finally { await s.close(); }
  for (const width of [375, 320]) {
    s = await pickOpen(B, { size: { width, height: 760 } });
    try {
      await click(s, '.vg-pick > summary');
      const m = await s.eval(`(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth,
        rows: [...document.querySelectorAll('.vg-pick-check')].map((e) => Math.round(e.getBoundingClientRect().height)),
        selInLabel: !!document.querySelector('.vg-pick select').closest('label') }))()`);
      await click(s, '.vg-pick-row .vg-pick-name', 1);   // 點「片語」兩個字
      m.after = await s.eval(VG_PICKED);
      r['w' + width] = m;
    } finally { await s.close(); }
  }
  s = await open(B, { url: 'vocab.html' });   // 沒登入
  try {
    const before = await s.eval(LS);
    await click(s, '.vg-pick > summary');
    await click(s, '.vg-pick-row .vg-pick-name', 1);
    r.guest = { checked: await s.eval(VG_PICKED), mask: (await state(s)).mask, wrote: noPet(lsDiff(before, await s.eval(LS))) };
    await reload(s);
    r.guest.after = await s.eval(VG_PICKED);
  } finally { await s.close(); }
  const mobileOk = (m) => m.sw <= m.iw && m.rows.length >= 4 && m.rows.every((x) => x >= 40) && !m.selInLabel && m.after === 'word,phrase';
  const ok = r.first === 'word' && r.checked === 'bank:bA,bank:bB' && r.src === J({ mode: 'bank:bA', level: '全部', modes: ['bank:bA', 'bank:bB'] }) && /甲題庫、乙題庫 · 2 個 · 共 6 個字/.test(r.sum)
    && r.reload.checked === 'bank:bA,bank:bB' && !r.reload.open && /甲題庫、乙題庫/.test(r.reload.sum)
    && r.toast === 'apple,grape,kiwi,lemon,mango,pear'
    && r.zero.checked === '' && /至少勾一個/.test(r.zero.note) && r.zero.starts.length === 4 && r.zero.starts.every(Boolean) && /還沒勾/.test(r.zero.sum) && r.zero.cards
    && !r.zero.mask && r.zero.home && !r.zero.wrote.length
    && J(r.one.starts) === J([false, false, true, true]) && r.one.src === '{"mode":"bank:bA","level":"全部"}' && /字不夠 · 要 4 個以上/.test(r.one.card)
    && mobileOk(r.w375) && mobileOk(r.w320)
    && r.guest.checked === 'word,phrase' && !r.guest.mask && !r.guest.wrote.length && r.guest.after === 'word';
  return { ok, detail: J(r) };
};
/* 補的(2026-11-11):
   手機寬(320、375、390):老師按週出的題庫名稱前面都一樣,點開清單每個名稱整個看得到(換行,不變省略號);窄螢幕清單佔滿一整行(「練哪些字」在上面)。
   框(summary)的無障礙名稱(Chrome 算的)開頭是旁邊看得到的「練哪些字」,後面是勾了哪些、共幾個字。
   全選的勾選框跟題庫的勾選框在同一欄;題庫有字沒勾時,清單那一列寫「練 N 個」,跟下面題庫卡片的數字一樣。
   按題庫卡片的「只練這個」:只勾那一個、捲回上面,焦點在框上(鍵盤、報讀軟體從這裡接著用) */
const WEEK_BANKS = [1, 2, 3].map((n) => ({ id: 'bw' + n, name: '多益單字（老師上課補充）第 ' + n + ' 週',
  words: [['desk', '桌子'], ['chair', '椅子'], ['lamp', '檯燈'], ['sofa', '沙發']].map(([en, zh], i) => ({ en: en + n, zh: zh + n, on: !(n === 2 && i === 3) })) }));
T['單字頁「練哪些字」:手機上長的題庫名稱整個看得到、框的名稱有「練哪些字」、全選對齊、題庫字數跟卡片一樣、只練這個題庫後焦點在框上'] = async (B) => {
  const r = {};
  for (const width of [320, 375, 390]) {
    const s = await pickOpen(B, { size: { width, height: 760 } }, WEEK_BANKS);
    try {
      await click(s, '.vg-pick > summary');
      r['w' + width] = await s.eval(`(() => {
        const names = [...document.querySelectorAll('.vg-pick-name')].map((e) => {
          const row = e.closest('.vg-pick-row').getBoundingClientRect();
          const rg = document.createRange(); rg.selectNodeContents(e); const t = rg.getBoundingClientRect();
          return { t: e.textContent, cut: e.scrollWidth > e.clientWidth + 1, out: t.right > row.right + 1 || t.left < row.left - 1,
            lines: Math.round(t.height / parseFloat(getComputedStyle(e).lineHeight)) };
        });
        const pick = document.querySelector('.vg-pick').getBoundingClientRect(), src = document.querySelector('.vg-source').getBoundingClientRect(),
          lab = document.querySelector('.vg-source > span').getBoundingClientRect();
        return { sw: document.documentElement.scrollWidth, iw: innerWidth, names, full: pick.width >= src.width - 1, labelAbove: lab.bottom <= pick.top + 1,
          rows: [...document.querySelectorAll('.vg-pick-check')].map((e) => Math.round(e.getBoundingClientRect().height)) };
      })()`);
    } finally { await s.close(); }
  }
  const s = await pickOpen(B, null, WEEK_BANKS);
  try {
    await click(s, '.vg-pick > summary');
    const ref = await s.send('Runtime.evaluate', { expression: "document.querySelector('.vg-pick > summary')" });
    const ax = await s.send('Accessibility.getPartialAXTree', { objectId: ref.result.result.objectId, fetchRelatives: false });
    const node = ((ax.result || {}).nodes || [])[0] || {};
    r.axName = node.name ? node.name.value : '(沒有)';
    r.desk = await s.eval(`(() => {
      const x = (e) => e ? Math.round(e.getBoundingClientRect().left) : null;
      const row = (id) => document.querySelector('.vg-pick input[value="bank:' + id + '"]').closest('.vg-pick-row');
      return { all: x(document.querySelector('.vg-pick-all input')), banks: ['bw1', 'bw2', 'bw3'].map((id) => x(row(id).querySelector('input'))),
        n2: row('bw2').querySelector('.vg-pick-n').textContent,
        card2: [...document.querySelectorAll('.part-card')].map((c) => c.textContent).filter((t) => t.indexOf('第 2 週') > -1 && t.indexOf('只練這個') > -1).join('') };
    })()`);
    await pressText(s, '.part-card .btn', '只練這個');
    await sleep(900);
    r.only = await s.eval(`({ active: document.activeElement ? document.activeElement.tagName : '', inPick: !!document.activeElement.closest('.vg-pick'),
      y: Math.round(scrollY), picked: ${VG_PICKED} })`);
  } finally { await s.close(); }
  const mobileOk = (m) => m.sw <= m.iw && m.names.length === 5 && m.names.every((n) => !n.cut && !n.out) && m.full && m.labelAbove && m.rows.every((h) => h >= 40);
  const ok = mobileOk(r.w320) && mobileOk(r.w375) && mobileOk(r.w390)
    && /^練哪些字\s*文章單字\s*· 共 [\d,]+ 個字$/.test(r.axName)
    && r.desk.banks.every((x) => x === r.desk.all) && r.desk.n2 === '練 3 個' && r.desk.card2.indexOf('4 個字 · 練 3 個') > -1
    && r.only.active === 'SUMMARY' && r.only.inPick && r.only.picked === 'bank:bw1' && r.only.y < 200;
  return { ok, detail: J(r) };
};
/* 補的(2026-11-11):
   手機寬(375、320)框收起來時:長的週題庫名稱可以被省略號切掉,但後面那段「N 個 · 共 X 個字」整個看得到(勾 5 個、只勾 3 個週題庫都一樣),框還是一行。
   題庫卡片的「只練這個」在 320、360、375、390 寬都是一行(跟同一列的「編輯」一樣高),沒有超出卡片、沒有左右捲動。
   框的無障礙名稱從框裡的字來(開頭是「練哪些字」),Chrome 不再把同一段字放進描述(以前報讀軟體會唸兩次)。
   鍵盤:框按 Enter 打開、Tab 到「片語」按空白鍵勾起來、按 Esc:清單收起來、焦點回到框上、片語還是勾著;再按 Enter 又打開 */
T['單字頁「練哪些字」:手機上框收起來看得到勾了幾個、只練這個不斷行、框的名稱不重複唸、Esc 收起清單'] = async (B) => {
  const r = {};
  const SUMM = `(() => { const sum = document.querySelector('.vg-pick > summary'), n = document.querySelector('.vg-pick-sum-n'), t = document.querySelector('.vg-pick-sum-text');
    const sb = sum.getBoundingClientRect(), nb = n.getBoundingClientRect(), tb = t.getBoundingClientRect();
    return { n: n.textContent, nCut: n.scrollWidth > n.clientWidth + 1, nIn: nb.left >= sb.left - 1 && nb.right <= sb.right + 1, tW: Math.round(tb.width),
      open: document.querySelector('.vg-pick').open, h: Math.round(sb.height), sw: document.documentElement.scrollWidth, iw: innerWidth }; })()`;
  for (const width of [375, 320]) {
    const s = await pickOpen(B, { size: { width, height: 760 } }, WEEK_BANKS);
    try {
      await click(s, '.vg-pick > summary');
      await click(s, '.vg-pick-all');                     // 全選三個週題庫(文章單字本來就勾著)
      await click(s, '.vg-pick-row .vg-pick-name', 1);    // 片語
      await click(s, '.vg-pick > summary');               // 收起來
      const five = await s.eval(SUMM);
      await click(s, '.vg-pick > summary');
      await click(s, '.vg-pick-row .vg-pick-name', 0);    // 取消文章單字
      await click(s, '.vg-pick-row .vg-pick-name', 1);    // 取消片語
      await click(s, '.vg-pick > summary');
      r['w' + width] = { five, three: await s.eval(SUMM), picked: await s.eval(VG_PICKED) };
    } finally { await s.close(); }
  }
  for (const width of [320, 360, 375, 390]) {
    const s = await pickOpen(B, { size: { width, height: 760 } }, WEEK_BANKS);
    try {
      r['b' + width] = await s.eval(`(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth,
        cards: [...document.querySelectorAll('.part-card')].filter((c) => [...c.querySelectorAll('button')].some((b) => b.textContent === '編輯')).map((c) => {
          const bs = [...c.querySelectorAll('button')], only = bs.find((b) => b.textContent === '只練這個'), edit = bs.find((b) => b.textContent === '編輯');
          const cb = c.getBoundingClientRect(), ob = only ? only.getBoundingClientRect() : { height: 0, right: 0 };
          return { has: !!only, h: Math.round(ob.height), eh: Math.round(edit.getBoundingClientRect().height), out: ob.right > cb.right + 1 };
        }) }))()`);
    } finally { await s.close(); }
  }
  const s = await pickOpen(B, null, WEEK_BANKS);
  try {
    const ref = await s.send('Runtime.evaluate', { expression: "document.querySelector('.vg-pick > summary')" });
    const ax = await s.send('Accessibility.getPartialAXTree', { objectId: ref.result.result.objectId, fetchRelatives: false });
    const node = ((ax.result || {}).nodes || [])[0] || {};
    r.ax = { name: node.name ? node.name.value : '(沒有)', desc: node.description ? node.description.value : '' };
    await s.eval("document.querySelector('.vg-pick > summary').focus(), true");
    await key(s, 'Enter');
    r.kb = { opened: await s.eval("document.querySelector('.vg-pick').open") };
    await key(s, 'Tab'); await key(s, 'Tab'); await key(s, 'Tab');
    r.kb.at = await s.eval('document.activeElement.value || document.activeElement.tagName');
    await key(s, ' ');
    await key(s, 'Escape');
    Object.assign(r.kb, { open: await s.eval("document.querySelector('.vg-pick').open"), active: await s.eval('document.activeElement.tagName'), picked: await s.eval(VG_PICKED) });
    await key(s, 'Enter');
    r.kb.reopen = await s.eval("document.querySelector('.vg-pick').open");
  } finally { await s.close(); }
  const sumOk = (m, re) => re.test(m.n) && !m.nCut && m.nIn && m.tW >= 40 && !m.open && m.h <= 44 && m.sw <= m.iw;
  const wOk = (w) => sumOk(w.five, /^ · 5 個 · 共 [\d,]+ 個字$/) && sumOk(w.three, /^ · 3 個 · 共 11 個字$/) && w.picked === 'bank:bw1,bank:bw2,bank:bw3';
  const bOk = (b) => b.sw <= b.iw && b.cards.length === 3 && b.cards.every((c) => c.has && c.h === c.eh && !c.out);
  const ok = wOk(r.w375) && wOk(r.w320) && bOk(r.b320) && bOk(r.b360) && bOk(r.b375) && bOk(r.b390)
    && /^練哪些字\s*文章單字\s*· 共 [\d,]+ 個字$/.test(r.ax.name) && r.ax.desc === ''
    && r.kb.opened && r.kb.at === 'phrase' && !r.kb.open && r.kb.active === 'SUMMARY' && r.kb.picked === 'word,phrase' && r.kb.reopen;
  return { ok, detail: J(r) };
};
T['單字頁:題庫編輯器的加入單字、勾選、刪字、改名,片語特訓的選項,在別的分頁登出、帳號資料夾還沒灌過時跳「重新整理」卡,輸入框的字留著、什麼都不寫;照常時照樣存'] = async (B) => {
  const out = [];
  const LINES = ['banana 香蕉', 'cherry 櫻桃', 'grape 葡萄'].join(String.fromCharCode(10));
  for (const how of ['照常', '登出', '還沒灌過']) {
    const r = { how };
    let s = await vocabOpen(B);
    try {
      await pressText(s, 'button', '新增單字本');
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
      await pressText(s, '.part-card:has(.p-stats) .btn', '開始');   // data-gate,這時能作答
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

/* (73900cf 新加的擋下):
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
      await click(s, '.vg-play .btn.primary');   // 掉落消除「開始」(data-gate,這時能作答;預設選著第一塊磚)
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
      await click(s, '.vg-play .btn.primary');
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
      await pickGame(s, 2);
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
      r.toast = { card: await s.eval(CARD), report: await s.eval("(document.querySelector('.result-card .result-kicker') || {}).textContent || ''") };
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

/* 帳號那一邊存不進去時的漏攔偵測:js/common.js 的 keepOrWarn 在 accountBlock 時不印「還沒登入」
   (小雞開頁同步也會走到,不是漏攔),最下面主程式那一道看不到。這裡把 keepOrWarn 包一層,記下「帳號那一邊靜靜擋下」的寫入(小雞的不算):
   作答被 data-gate、holdForAccount 擋在前面時一筆都不會有;有的話就是某個作答漏攔,畫面照樣說存了。重載後要再裝一次 */
const COUNT_SILENT = `(() => { if (window.__silent) return true; const f = window.keepOrWarn; window.__silent = [];
  window.keepOrWarn = (what) => { const ok = f(what); if (!ok && !/^pet/.test(String(what)) && typeof accountBlock === 'function' && accountBlock()) window.__silent.push(what); return ok; }; return true; })()`;
const SILENT = '(window.__silent || []).slice()';
const UPS = "JSON.parse(sessionStorage.getItem('__fake_up') || '[]').map((u) => u.k).filter((k) => k !== 'pet' && k !== '_meta')";
/* 刷題頁的聽力隨機練習、聽力錯題複習(js/listening.js)和文法頁的動詞測驗(js/verbs.js)進來之後的作答、交卷沒有 data-gate
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
      await pressText(s, '.listen-start', '開始');   // data-gate,這時能作答
      r.letters = await s.eval("document.querySelectorAll('.letter-row .letter-big').length");
      await click(s, '.letter-row .letter-big', 0);   // 能作答時先選 A
      await s.eval(COUNT_SILENT);
      if (BREAK_ACCOUNT[how]) await s.eval(BREAK_ACCOUNT[how]);
      const before = await s.eval(LS), up0 = await s.eval(UPS);
      await click(s, '.letter-row .letter-big', 1);   // 改選 B
      r.pickCard = await card(s);
      r.picked = await s.eval(PICKED_L);
      if (r.pickCard) await closeBy(s, 'esc');
      await pressText(s, '.quiz-act', '交卷');
      await sleep(400);
      /* 照常:還有 9 題沒答完,頁面裡的確認視窗,按「交卷」。擋下時按下去那一刻就跳「重新整理」卡,沒有確認視窗 */
      if (await s.eval("!!document.querySelector('.ui-dialog')")) await click(s, '.ui-dialog-ok');
      r.submitCard = await card(s);
      r.report = await s.eval("((document.querySelector('.result-score') || {}).textContent || '').trim()");
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
      /* 錯題本面板那一列的「查看」→ 聽力 Part 2 的錯題本清單 →「開始複習」(data-gate,這時能作答) */
      await s.eval("(() => { const row = [...document.querySelectorAll('.review-row')].find((x) => /聽力 Part 2/.test(x.textContent)); const b = row && row.querySelector('.btn'); if (!b) return false; b.id = '__press'; return true; })()");
      await click(s, '#__press');   // 查看
      r.listSettled = await settleNav(s);
      await sleep(600);
      await pressText(s, '.wb-start .btn.primary', '開始');
      r.revSettled2 = await settleNav(s);
      await sleep(600);
      r.revLetters = await s.eval("document.querySelectorAll('.letter-row .letter-big').length");
      await s.eval(COUNT_SILENT);
      if (BREAK_ACCOUNT[how]) await s.eval(BREAK_ACCOUNT[how]);
      const before = await s.eval(LS), up0 = await s.eval(UPS);
      await click(s, '.letter-row .letter-big', await s.eval('TOEIC.listening.p2[0].answer'));   // 點正確答案
      r.revCard = await card(s);
      r.verdict = await s.eval("(document.querySelector('.quiz-fb-text') || {}).textContent || ''");   // 底部回饋條「答對」
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
      if (how !== '照常') { await click(s, '.quiz-foot .btn.primary'); r.btnCard = await card(s); }   // 「對答案」(專心模式底部)
      r.vals = await s.eval("[...document.querySelectorAll('input.vb-input')].map((x) => x.value)");
      r.vbVerdict = await s.eval("(document.querySelector('.quiz-fb-text') || {}).textContent || ''");
      r.marked = await s.eval("(document.querySelector('.quiz-count') || {}).textContent || ''");   // 作答列右邊「第幾題 / 共幾題」:答完往下是 2 / 10
      await sleep(1300);
      r.vbWrote = lsDiff(before, await s.eval(LS)).filter((k) => !/_pet$/.test(k));
      r.vbUps = (await s.eval(UPS)).slice(up0.length);
      r.vbSilent = await s.eval(SILENT);
    } finally { await s.close(); }
    const has = (a, ks) => ks.every((k) => a.includes(k));
    if (how === '照常') {
      r.ok = r.letters === 3 && !r.pickCard && r.picked === 1 && !r.submitCard && /^\d+ \/ 10$/.test(r.report) && has(r.wrote, [HIST, P2]) && has(r.ups, ['hist', 'listen_p2'])
        && r.revSettled && r.revLetters === 3 && !r.revCard && /答對/.test(r.verdict) && has(r.revWrote, [HIST, P2]) && has(r.revUps, ['hist', 'listen_p2']) && r.revOk === true
        /* 照常按 Enter 對完答案,同一下 Enter 落到剛拿到焦點的「下一題」(main 就是這樣),畫面已經是下一題:只看作答列的題號往下一題、存了 */
        && r.inputs === 2 && !r.typeCard && !r.enterCard && r.marked === '2 / 10' && has(r.vbWrote, [HIST, VQ]) && has(r.vbUps, ['hist', 'verb_quiz'])
        && !r.silent.length && !r.revSilent.length && !r.vbSilent.length;
    } else {
      const title = how === '登出' ? /已經在別的分頁登出/ : /還沒載入/;
      r.ok = r.letters === 3 && title.test(r.pickCard) && r.picked === 0 && title.test(r.submitCard) && !r.report && r.picked2 === 0 && !r.wrote.length && !r.ups.length
        && r.revSettled && r.revLetters === 3 && title.test(r.revCard) && !r.verdict && !r.revWrote.length && !r.revUps.length && r.revOk === (how === '登出' ? null : false)
        && r.inputs === 2 && title.test(r.typeCard) && title.test(r.enterCard) && title.test(r.btnCard) && J(r.vals) === J(['went', '']) && !r.vbVerdict && r.marked === '1 / 10'
        && !r.vbWrote.length && !r.vbUps.length && !r.silent.length && !r.revSilent.length && !r.vbSilent.length;
    }
    out.push(r);
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 刷題頁的隨機練習、聽力隨機練習、程度檢測交卷時,沒答完會先問「還有 N 個單元沒答完，確定要交卷嗎？」。
   data-gate 在按下去那一刻檢查(這時還能作答),確認視窗開著的時候別的分頁登出(或這台的帳號資料夾變成還沒灌過):
   以前按確定之後照樣批改,store.set 被 common.js 的最後一道靜靜擋下,畫面卻寫「答錯的 N 題已收進錯題本。」、畫出檢測報告,
   其實一筆都沒存、也沒跳卡(e49e444 則寫進被刪掉的資料夾、上傳)。要的是:問完之後再查一次,擋下就跳「重新整理」卡、不批改、不出成績,
   作答留在畫面上(交卷鈕還在),什麼都不寫;照常的時候跟以前一樣存、上傳(模擬考是在問完之後才算 canSaveNow,見上面模擬考那一項) */
T['刷題頁隨機練習、聽力隨機練習、程度檢測:交卷的確認視窗開著時別的分頁登出、帳號資料夾變成還沒灌過,按確定跳「重新整理」卡、不出成績、什麼都不寫;照常時照樣存'] = async (B) => {
  const login = J({ access_token: 'x', user: USER });
  const day = Date.now() - 864e5;
  const oldHist = [0, 1, 2].map((n) => ({ m: 'g', id: 'old-' + n, c: 0, ok: true, t: day + n }));
  const rows = J([{ k: 'hist', v: oldHist, updated_at: new Date(day + 10).toISOString() }]);
  const HIST = 'tr_u' + CPID + '_hist', P5 = 'tr_u' + CPID + '_drill_p5', P2 = 'tr_u' + CPID + '_listen_p2', DIAG = 'tr_u' + CPID + '_diag';
  const card = async (s) => { const st = await state(s); return st.mask ? st.title : ''; };
  const REPORT = "((document.querySelector('.report-head, .result-score') || {}).textContent || '').trim()";
  const PAGES = [
    { name: '隨機練習', ui: true, url: 'practice.html', start: ['.practice-panel .btn.primary', '開始'], pick: '.q-block .opt', submit: '交卷', keys: [HIST, P5], up: ['hist', 'drill_p5'], report: /^\d+ \/ 10$/, kept: "document.querySelectorAll('.q-block .opt.picked').length" },
    { name: '聽力隨機練習', ui: true, url: 'practice.html', start: ['.listen-start', '開始'], pick: '.letter-row .letter-big', submit: '交卷', keys: [HIST, P2], up: ['hist', 'listen_p2'], report: /^\d+ \/ 10$/, kept: "document.querySelectorAll('.letter-row .letter-big.picked').length" },
    { name: '程度檢測', url: 'diagnostic.html', start: ['.diag-intro .btn.primary', '開始'], pick: '.q-block .opt', submit: '交卷', keys: [DIAG], up: ['diag'], report: /./, kept: null, ui: true },
  ];
  const out = [];
  for (const how of ['照常', '登出', '還沒灌過']) {
    for (const pg of PAGES) {
      const r = { how, page: pg.name };
      const s = await open(B, { url: pg.url, user: true, sdk: fakeCloud({ user: USER }), ls: { [SB]: login, [HIST]: J(oldHist) }, ss: { __fake_rows: rows } });
      try {
        await pressText(s, pg.start[0], pg.start[1]);   // data-gate,這時能作答
        await click(s, pg.pick, 0);                     // 答一題(其他沒答,交卷時會問)
        await sleep(1000);                              // 程度檢測每答一題就存:等它 0.8 秒後上傳完,再拍「之前」
        await s.eval(COUNT_SILENT);
        await s.eval(`window.confirm = (m) => { window.__asked = String(m); ${BREAK_ACCOUNT[how] || 'true'}; return true; }; true`);
        const before = await s.eval(LS), up0 = await s.eval(UPS);
        if (pg.ui) {
          /* 題庫、聽力、程度檢測的確認是頁面裡的視窗(UI.confirm):開著的時候別的分頁登出或帳號資料夾變成還沒灌過,按確定再查一次 */
          await pressText(s, '.quiz-act', pg.submit);
          await sleep(400);
          await s.eval("window.__asked = (document.querySelector('.ui-dialog-h') || {}).textContent || ''; true");
          if (BREAK_ACCOUNT[how]) await s.eval(BREAK_ACCOUNT[how]);
          await click(s, '.ui-dialog-ok');
        } else await pressText(s, '.drill-nav-btns .btn', pg.submit);
        r.asked = await s.eval("window.__asked || ''");
        await sleep(300);
        r.card = await card(s);
        /* 成績讀結算卡的 .result-score(題庫、聽力是「N / 10」,程度檢測有分數就好);舊的 .report-head 也認 */
        r.report = await s.eval(REPORT);
        r.submitLeft = await s.eval(`[...document.querySelectorAll('.drill-nav-btns .btn, .quiz-act')].some((b) => b.textContent.indexOf(${J(pg.submit)}) > -1)`);
        r.kept = pg.kept ? await s.eval(pg.kept) : null;
        await sleep(1300);
        /* 「之前」是問之前拍的:別的分頁登出刪掉的、記上的標記不算,只看這一頁寫出來的(登出之後帳號資料夾的鍵又出現也算) */
        const after = await s.eval(LS), a = JSON.parse(after);
        r.wrote = lsDiff(before, after).filter((k) => a[k] !== undefined && !/_pet$/.test(k) && k !== 'tr_cloud_unhydrated_' + UID);
        r.ups = (await s.eval(UPS)).slice(up0.length);
        r.silent = await s.eval(SILENT);
      } finally { await s.close(); }
      const has = (a, ks) => ks.every((k) => a.includes(k));
      if (how === '照常') r.ok = !!r.asked && !r.card && pg.report.test(r.report) && has(r.wrote, pg.keys) && has(r.ups, pg.up) && !r.silent.length;
      else {
        const title = how === '登出' ? /已經在別的分頁登出/ : /還沒載入/;
        r.ok = !!r.asked && title.test(r.card) && !r.report && r.submitLeft && (pg.kept === null || r.kept === 1) && !r.wrote.length && !r.ups.length && !r.silent.length;
      }
      out.push(r);
    }
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 站內視窗(js/ui.js):開著而且還沒記過的那一個,回 'prompt'(有輸入框)或 'confirm',記過就標上;按確定時 prompt 先填字 */
const UI_DLG_OPEN = "!!document.querySelector('.ui-mask .ui-dialog:not([data-seen])')";
const UI_DLG_SEEN = "(() => { const d = document.querySelector('.ui-mask .ui-dialog:not([data-seen])'); if (!d) return ''; d.setAttribute('data-seen', '1'); return d.querySelector('.ui-dialog-input') ? 'prompt' : 'confirm'; })()";
const UI_DLG_OK = "(text) => { const d = document.querySelector('.ui-mask .ui-dialog'); if (!d) return false; const i = d.querySelector('.ui-dialog-input');"
  + " if (i) { i.value = text; i.dispatchEvent(new Event('input')); } d.querySelector('.ui-dialog-ok').click(); return true; }";
/* 按下去會跳原生視窗(confirm、prompt)或站內視窗的按鈕(用文字找,exact:整段文字要一樣):滑鼠放開那一下不等 CDP 回應(視窗開著時不回),
   等 Page.javascriptDialogOpening。每跳一個視窗先跑 during(第幾個視窗),再按確定(prompt 填 promptText)。回跳過的視窗種類 */
async function pressDialogs(B, s, sel, text, exact, during, promptText) {
  const ok = await s.eval(`(() => { const old = document.getElementById('__press'); if (old) old.removeAttribute('id');
    const b = [...document.querySelectorAll(${J(sel)})].find((x) => ${exact ? `x.textContent.trim() === ${J(text)}` : `x.textContent.indexOf(${J(text)}) > -1`}); if (!b) return false; b.id = '__press'; return true; })()`);
  if (!ok) throw new Error('找不到 ' + sel + ' 「' + text + '」');
  const p = await point(s, '#__press');
  const queue = [], asked = [];
  let wake = null, done = false;
  const probe = (expr, none) => Promise.race([s.eval(expr).catch(() => none), sleep(400).then(() => none)]);
  const off = B.on((m) => { if (m.sessionId === s.sid && m.method === 'Page.javascriptDialogOpening') { queue.push(m.params); if (wake) wake(); } });
  try {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    const released = s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }).then(() => { done = true; if (wake) wake(); });
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      /* 站內的確認與輸入視窗(js/ui.js UI.confirm、UI.prompt):跟原生視窗一樣記下種類、先跑 during,再填字(prompt)、按確定 */
      /* 原生視窗開著時頁面的 eval 不會回:滑鼠放開回來了(沒有原生視窗卡著)才看,而且最多等 400 毫秒;換頁中讀不到也當沒有 */
      if (!queue.length && done) {
        const ui = await probe(UI_DLG_SEEN, '');
        if (ui) {
          asked.push(ui);
          if (during) await during(asked.length, { type: ui });
          await sleep(300);
          await s.eval(`(${UI_DLG_OK})(${J(promptText || '')})`).catch(() => false);
          await sleep(100);
          continue;
        }
      }
      if (!queue.length) {
        if (done) { await sleep(400); if (!queue.length && !(await probe(UI_DLG_OPEN, false))) break; continue; }
        await Promise.race([new Promise((r) => { wake = r; }), sleep(500)]);
        wake = null;
        continue;
      }
      const d = queue.shift();
      asked.push(d.type);
      if (during) await during(asked.length, d);
      await sleep(300);
      await s.send('Page.handleJavaScriptDialog', d.type === 'prompt' ? { accept: true, promptText: promptText || '' } : { accept: true });
    }
    await released;
  } finally { off(); }
  await sleep(350);
  return asked;
}

/* (e49e444 就有;49a5080 那一項的確認視窗是同一頁裡的替身,抓不到):Chrome 的原生確認視窗開著的時候,
   別的分頁對 localStorage 的改動不會送進這一頁,按確定之後同一段程式裡讀到的還是舊值(holdForAccount、canSaveNow、帳號動作的 mustBeShown 都放行)。
   這裡真的開兩個分頁(A 是要測的頁面,O 是同網域的 robots.txt)、跳真的視窗:視窗開著時 O 登出 X(或記上「還沒灌過」、改登入 Y),再按確定。
   以前:交卷照樣批改、出成績,把登出時刪掉的帳號資料夾寫回來、上傳;模擬考照樣存進紀錄;刪除帳號送出 delete_own_account
   (真的 supabase-js 送出時讀的是 O 剛登入的 Y,刪掉的是 Y)、登出所有裝置送出 signOut、改暱稱送出 updateUser。
   要的是:交卷跳「重新整理」卡、不出成績、什麼都不寫不傳(模擬考照樣給他看結果、寫明還沒存、成績留在分頁);
   帳號動作跳「已經在別的分頁登出」卡、一個請求都不送。照常(O 什麼都沒做)時照樣存、上傳、送給 X */
T['真的確認視窗開著時另一個分頁登出、記上還沒灌過、改登入別人:按確定後交卷(隨機練習、聽力隨機練習、程度檢測、模擬考)跳卡、不寫不傳,刪除帳號、登出所有裝置、改暱稱不送;照常時照樣'] = async (B) => {
  const login = J({ access_token: 'x', user: USER });
  const day = Date.now() - 864e5;
  const oldHist = [0, 1, 2].map((n) => ({ m: 'g', id: 'old-' + n, c: 0, ok: true, t: day + n }));
  const three = [1, 2, 3].map((n) => ({ d: new Date(day + n * 1000).toISOString(), size: 'quick', lRaw: n, lTotal: 12, rRaw: n, rTotal: 18, lScore: 5, rScore: 5 }));
  const HIST = 'tr_u' + CPID + '_hist', P5 = 'tr_u' + CPID + '_drill_p5', P2 = 'tr_u' + CPID + '_listen_p2', DIAG = 'tr_u' + CPID + '_diag', MH = 'tr_u' + CPID + '_mock_history';
  const TO_Y = `(() => { ${OTHER_TAB_LOGOUT}; localStorage.setItem(${J(SB)}, ${J(J({ access_token: 'y', user: Y_USER }))}); localStorage.setItem('tr_current_profile', ${J(J(YPID))}); return true; })()`;
  const BREAK = { 登出: OTHER_TAB_LOGOUT, 還沒灌過: BREAK_ACCOUNT['還沒灌過'], 換帳號: TO_Y };
  const REPORT = "((document.querySelector('.report-head, .result-score') || {}).textContent || '').trim()";
  const LATER = "JSON.parse(sessionStorage.getItem('tr_mock_unsaved') || '[]').length";
  const SENT = "JSON.parse(sessionStorage.getItem('__fake_calls') || '[]').map((c) => c.op)";
  /* O:同網域的另一個分頁(先開:A 開的時候會清空、灌好 localStorage) */
  const o = await open(B, { url: 'robots.txt', early: true });
  const out = [];
  try {
    const PAGES = [
      { name: '隨機練習', ui: true, url: 'practice.html', start: ['.practice-panel .btn.primary', '開始'], pick: '.q-block .opt', submit: ['.quiz-act', '交卷'], keys: [HIST, P5], up: ['hist', 'drill_p5'], report: /^\d+ \/ 10$/ },
      { name: '聽力隨機練習', ui: true, url: 'practice.html', start: ['.listen-start', '開始'], pick: '.letter-row .letter-big', submit: ['.quiz-act', '交卷'], keys: [HIST, P2], up: ['hist', 'listen_p2'], report: /^\d+ \/ 10$/ },
      { name: '程度檢測', url: 'diagnostic.html', start: ['.diag-intro .btn.primary', '開始'], pick: '.q-block .opt', submit: ['.quiz-act', '交卷'], keys: [DIAG], up: ['diag'], report: /./, ui: true },
      { name: '模擬考', url: 'mock.html', start: ['.part-card .btn.primary', ''], pick: null, submit: ['.quiz-act', '交卷'], keys: [MH], up: ['mock_history'], report: /參考總分/, mock: true, ui: true },
      /* 錯題本:抽題固定,聽力 2 第 1 題答錯 → 照常時多寫、多傳 mock_wrong 各一次;擋下時一個鍵都不寫 */
      { name: '模擬考(答一題錯)', url: 'mock.html', start: ['.part-card .btn.primary', ''], pick: '#mock-root .letter-row .letter-big', pickI: wrongOf(BANK.listening.p2[0]), pre: FIXRAND,
        submit: ['.quiz-act', '交卷'], keys: [MH, 'tr_u' + CPID + '_mock_wrong'], up: ['mock_history', 'mock_wrong'], once: 'mock_wrong', report: /參考總分/, mock: true, ui: true },
    ];
    for (const how of ['照常', '登出', '還沒灌過']) {
      for (const pg of PAGES) {
        const r = { how, page: pg.name };
        const ls = { [SB]: login, [HIST]: J(oldHist) };
        if (pg.mock) ls[MH] = J(three);
        const rows = pg.mock ? [{ k: 'mock_history', v: three, updated_at: new Date(day + 10000).toISOString() }] : [{ k: 'hist', v: oldHist, updated_at: new Date(day + 10).toISOString() }];
        const s = await open(B, { url: pg.url, user: true, sdk: fakeCloud({ user: USER }), ls, ss: { __fake_rows: J(rows) }, pre: pg.pre });
        try {
          await pressText(s, pg.start[0], pg.start[1]);   // data-gate,這時能作答
          if (pg.pick) await click(s, pg.pick, pg.pickI || 0);   // 答一題(其他沒答,交卷時會問)
          await sleep(1000);                              // 程度檢測每答一題就存:等它 0.8 秒後上傳完,再拍「之前」
          await s.eval(COUNT_SILENT);
          const before = await s.eval(LS), up0 = await s.eval(UPS);
          const during = async () => { if (BREAK[how]) r.broke = await o.eval(BREAK[how]); };
          /* 題庫、聽力、程度檢測、模擬考的確認是頁面裡的視窗(UI.confirm):視窗開著時另一個分頁改帳號,再按它的「交卷」;其他頁還是原生視窗 */
          r.asked = pg.ui ? await pressUiConfirm(s, pg.submit[0], pg.submit[1], during) : await pressDialogs(B, s, pg.submit[0], pg.submit[1], pg.mock, async () => { await during(); });
          await sleep(900);
          const st = await state(s);
          r.card = st.mask ? st.title : '';
          /* 模擬考的「參考總分」在結算卡的小字(kicker),讀整張卡;其他頁讀 .result-score(題庫、聽力是「N / 10」) */
          r.report = pg.mock ? await s.eval("(document.querySelector('.result-card') || {}).textContent || ''") : await s.eval(REPORT);
          if (pg.mock) r.note = await s.eval("(document.querySelector('.mock-unsaved') || {}).textContent || ''"), r.later = await s.eval(LATER);
          await sleep(1300);
          /* 只看這一頁寫出來的(O 刪掉的、記上的標記不算;登出之後帳號資料夾的鍵又出現也算) */
          const after = await s.eval(LS), a = JSON.parse(after);
          r.wrote = lsDiff(before, after).filter((k) => a[k] !== undefined && !/_pet$/.test(k) && k !== 'tr_cloud_unhydrated_' + UID);
          r.ups = (await s.eval(UPS)).slice(up0.length);
          r.silent = await s.eval(SILENT);
        } finally { await s.close(); }
        const has = (x, ks) => ks.every((k) => x.includes(k));
        const asked = J(r.asked) === J(['confirm']);
        if (how === '照常') r.ok = asked && !r.card && pg.report.test(r.report) && has(r.wrote, pg.keys) && has(r.ups, pg.up) && !r.silent.length && (!pg.mock || (!r.note && r.later === 0))
          && (!pg.once || r.ups.filter((k) => k === pg.once).length === 1);
        else if (pg.mock) r.ok = asked && r.broke === true && pg.report.test(r.report) && /還沒存/.test(r.note) && r.later === 1 && !r.wrote.length && !r.ups.length;
        else {
          const title = how === '登出' ? /已經在別的分頁登出/ : /還沒載入/;
          r.ok = asked && r.broke === true && title.test(r.card) && !r.report && !r.wrote.length && !r.ups.length && !r.silent.length;
        }
        out.push(r);
      }
    }
    /* 「我的」頁的帳號動作:刪除帳號問兩次(第二個視窗開著時 O 改登入 Y),登出所有裝置、改暱稱問一次 */
    const ACTS = [
      { name: '刪除帳號', sel: '.me-delete button', text: '刪除帳號', at: 2, sent: ['rpc:delete_own_account', 'signOut'] },
      { name: '登出所有裝置', sel: '.me-row', text: '登出所有裝置', at: 1, sent: ['signOut'] },
      { name: '改暱稱', sel: '.me-row', text: '改暱稱', at: 1, sent: ['updateUser'] },
    ];
    for (const how of ['照常', '換帳號']) {
      for (const act of ACTS) {
        const r = { how, act: act.name };
        const s = await open(B, { url: 'me.html', user: true, sdk: fakeCloud({ user: USER }), ls: { [SB]: login, [HIST]: J(oldHist) } });
        try {
          await s.eval('window.__mark = 1; true');
          const c0 = (await s.eval(SENT)).length;
          r.asked = await pressDialogs(B, s, act.sel, act.text, true, async (n) => { if (how !== '照常' && n === act.at) r.broke = await o.eval(TO_Y); }, '新暱稱');
          await sleep(900);
          await s.loaded();
          r.stay = await s.eval('window.__mark === 1');
          const st = await state(s);
          r.card = st.mask ? st.title : '';
          r.sent = (await s.eval(SENT)).slice(c0);
        } finally { await s.close(); }
        r.ok = how === '照常' ? J(r.sent) === J(act.sent)
          : r.broke === true && r.asked.length === act.at && r.stay && /已經在別的分頁登出/.test(r.card) && !r.sent.length;
        out.push(r);
      }
    }
  } finally { await o.close(); }
  const bad = out.filter((x) => !x.ok);
  return { ok: !bad.length, detail: bad.length ? '不對的 ' + bad.length + ' / ' + out.length + ' 項:' + bad.map((x) => x.how + '/' + (x.page || x.act)).join('、') + ' | ' + J(bad)
    : J(out.map((x) => x.how + '/' + (x.page || x.act) + ' 問 ' + x.asked.join(','))) };
};

/* 跟 pressDialogs 一樣按一下、等原生視窗;第一個視窗按確定、滑鼠放開那一下回來之後馬上再按一次(交卷排在 50 毫秒後,這時還沒批改),
   之後跳的視窗都按確定。during(第幾個視窗):按確定之前跑。回跳過的視窗種類 */
async function pressTwice(B, s, sel, text, exact, during) {
  const ok = await s.eval(`(() => { const old = document.getElementById('__press'); if (old) old.removeAttribute('id');
    const b = [...document.querySelectorAll(${J(sel)})].find((x) => ${exact ? `x.textContent.trim() === ${J(text)}` : `x.textContent.indexOf(${J(text)}) > -1`}); if (!b) return false; b.id = '__press'; return true; })()`);
  if (!ok) throw new Error('找不到 ' + sel + ' 「' + text + '」');
  const p = await point(s, '#__press');
  const queue = [], asked = [];
  let wake = null;
  const off = B.on((m) => { if (m.sessionId === s.sid && m.method === 'Page.javascriptDialogOpening') { queue.push(m.params); if (wake) wake(); } });
  try {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    for (let n = 0; n < 2; n++) {
      let done = false;
      await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      const released = s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }).then(() => { done = true; if (wake) wake(); });
      const end = Date.now() + 15000;
      while (Date.now() < end) {
        if (queue.length) {
          const d = queue.shift();
          asked.push(d.type);
          if (during) await during(asked.length, d);
          await sleep(300);
          await s.send('Page.handleJavaScriptDialog', { accept: true });
          if (n === 0) break;   // 第一下:按完確定就去按第二下
          continue;
        }
        if (done) { if (n === 0) break; await sleep(400); if (!queue.length) break; continue; }
        await Promise.race([new Promise((r) => { wake = r; }), sleep(500)]);
        wake = null;
      }
      await released;
    }
  } finally { off(); }
  await sleep(350);
  return asked;
}

/* 8dbb805 之後:交卷的確認視窗按確定之後等 50 毫秒才批改,那 50 毫秒裡交卷鈕還按得到。以前再按一次又問一次、又排一次交卷,
   批改、寫紀錄(錯題、hist、程度檢測)、小雞的 PET_HOOK.done 都跑兩次。這裡跳真的原生視窗:沒答完按交卷、按確定,
   馬上(還在那 50 毫秒裡)再按一次,有視窗就按確定。要的是:第二下不算(不再問),只批改一次:PET_HOOK.done 一次、
   每個紀錄鍵 store.set 一次、hist 只多答的那一筆。模擬考本來就有 over:只看存一次。
   問的時候別的分頁登出(擋下跳卡),登回原帳號、關掉卡之後再按一次:照常問、照常交一次(擋下時不能把交卷鈕一直鎖住) */
T['交卷的確認視窗按確定之後馬上再按一次交卷(還在等那 50 毫秒):不再問、只批改只寫紀錄只叫小雞一次(隨機練習、聽力隨機練習、程度檢測;模擬考只存一次);問的時候擋下跳卡,登回來再按照常交'] = async (B) => {
  const login = J({ access_token: 'x', user: USER });
  const day = Date.now() - 864e5;
  const oldHist = [0, 1, 2].map((n) => ({ m: 'g', id: 'old-' + n, c: 0, ok: true, t: day + n }));
  const three = [1, 2, 3].map((n) => ({ d: new Date(day + n * 1000).toISOString(), size: 'quick', lRaw: n, lTotal: 12, rRaw: n, rTotal: 18, lScore: 5, rScore: 5 }));
  const HIST = 'tr_u' + CPID + '_hist', MH = 'tr_u' + CPID + '_mock_history';
  /* 小雞的掛勾換成只記次數的(js/app-shell.js 看到已經有 PET_HOOK 就不載 pet-hook.js) */
  const HOOK = 'window.__done = []; window.PET_HOOK = { done: (id) => { window.__done.push(id); return null; } };';
  /* 記下 store.set 寫了哪些鍵,每一下點擊點在哪個按鈕上、那時批改了沒 */
  const WATCH = `(() => { window.__sets = []; const f = store.set; store.set = function (k, v) { window.__sets.push(k); return f.apply(this, arguments); };
    window.__clicks = []; addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button');
      window.__clicks.push({ txt: b ? b.textContent.trim() : '', done: window.__done.length, sets: window.__sets.length }); }, true); return true; })()`;
  const COUNTS = "(() => { const n = {}; window.__sets.forEach((k) => { n[k] = (n[k] || 0) + 1; }); return { done: window.__done.slice(), sets: n, clicks: window.__clicks.slice() }; })()";
  const N = (k) => `JSON.parse(localStorage.getItem(${J(k)}) || '[]').length`;
  const BACK_X = `(() => { localStorage.setItem(${J(SB)}, ${J(login)}); localStorage.setItem('tr_current_profile', ${J(J(CPID))}); return true; })()`;
  const PAGES = [
    { name: '隨機練習', ui: true, url: 'practice.html', start: ['.practice-panel .btn.primary', '開始'], pick: '.q-block .opt', submit: ['.quiz-act', '交卷'], sets: ['drill_p5', 'hist'], count: HIST, add: 1, report: /^\d+ \/ 10$/ },
    { name: '聽力隨機練習', ui: true, url: 'practice.html', start: ['.listen-start', '開始'], pick: '.letter-row .letter-big', submit: ['.quiz-act', '交卷'], sets: ['listen_p2', 'hist'], count: HIST, add: 1, report: /^\d+ \/ 10$/ },
    { name: '程度檢測', url: 'diagnostic.html', start: ['.diag-intro .btn.primary', '開始'], pick: '.q-block .opt', submit: ['.quiz-act', '交卷'], sets: ['diag'], count: HIST, add: 0, report: /./, ui: true },
    { name: '模擬考', url: 'mock.html', start: ['.part-card .btn.primary', ''], pick: null, submit: ['.quiz-act', '交卷'], sets: ['mock_history'], count: MH, add: 1, report: /參考總分/, mock: true, ui: true },
    /* 錯題本:有作答時按兩下交卷,mock_wrong 也只寫一次 */
    { name: '模擬考(答一題錯)', url: 'mock.html', start: ['.part-card .btn.primary', ''], pick: '#mock-root .letter-row .letter-big', pickI: wrongOf(BANK.listening.p2[0]), fix: FIXRAND,
      submit: ['.quiz-act', '交卷'], sets: ['mock_history', 'mock_wrong'], count: MH, add: 1, report: /參考總分/, mock: true, ui: true },
  ];
  /* 模擬考的「參考總分」在結算卡的小字(kicker),讀整張卡;其他頁讀 .result-score(題庫、聽力是「N / 10」) */
  const REPORT = (pg) => pg.mock ? "(document.querySelector('.result-card') || {}).textContent || ''" : "((document.querySelector('.report-head, .result-score') || {}).textContent || '').trim()";
  const card = async (s) => { const st = await state(s); return st.mask ? st.title : ''; };
  const o = await open(B, { url: 'robots.txt', early: true });   // 別的分頁(先開:A 開的時候會清空、灌好 localStorage)
  const out = [];
  try {
    for (const how of ['照常', '擋下後登回']) {
      for (const pg of PAGES) {
        if (how !== '照常' && pg.mock) continue;   // 模擬考問完不跳卡(存不進去先留在分頁),上面那一項測過
        const r = { how, page: pg.name };
        const ls = { [SB]: login, [HIST]: J(oldHist) };
        if (pg.mock) ls[MH] = J(three);
        const rows = pg.mock ? [{ k: 'mock_history', v: three, updated_at: new Date(day + 10000).toISOString() }] : [{ k: 'hist', v: oldHist, updated_at: new Date(day + 10).toISOString() }];
        const s = await open(B, { url: pg.url, user: true, sdk: fakeCloud({ user: USER }), ls, ss: { __fake_rows: J(rows) }, pre: HOOK + (pg.fix || '') });
        try {
          await pressText(s, pg.start[0], pg.start[1]);
          if (pg.pick) await click(s, pg.pick, pg.pickI || 0);   // 答一題(其他沒答,交卷時會問)
          await sleep(1000);
          await s.eval(COUNT_SILENT);
          await s.eval(WATCH);
          const n0 = await s.eval(N(pg.count));
          /* 題庫、聽力、程度檢測、模擬考的確認是頁面裡的視窗(UI.confirm),按確定之前後面的頁面按不到,沒有「那 50 毫秒」:按一次確定,只批改一次 */
          r.asked = pg.ui ? await pressUiConfirm(s, pg.submit[0], pg.submit[1], async () => { if (how !== '照常') r.broke = await o.eval(OTHER_TAB_LOGOUT); })
            : await pressTwice(B, s, pg.submit[0], pg.submit[1], pg.mock, async (n) => { if (how !== '照常' && n === 1) r.broke = await o.eval(OTHER_TAB_LOGOUT); });
          await sleep(900);
          const c = await s.eval(COUNTS);
          r.done = c.done.length; r.sets = c.sets;
          /* 兩下都點在交卷鈕上,第二下的時候還沒批改(不然這一次不算數:第二下太晚,已經過了那 50 毫秒)。
             UI.confirm 沒有「按確定之後還等一下」的空檔,不會有第二下:只看批改一次 */
          r.inTime = pg.ui ? c.done.length === 1 : c.clicks.length === 2 && c.clicks.every((x) => x.txt.indexOf(pg.submit[1]) > -1) && c.clicks[1].done === 0 && c.clicks[1].sets === 0;
          r.card = await card(s);
          r.report = await s.eval(REPORT(pg));
          if (how === '照常') {
            r.add = (await s.eval(N(pg.count))) - n0;
            r.silent = await s.eval(SILENT);
          } else {
            r.back = await s.eval(BACK_X);
            r.closed = await closeBy(s, 'esc');
            r.asked2 = pg.ui ? await pressUiConfirm(s, pg.submit[0], pg.submit[1]) : await pressDialogs(B, s, pg.submit[0], pg.submit[1], false);
            await sleep(900);
            const c2 = await s.eval(COUNTS);
            r.done2 = c2.done.length; r.sets2 = c2.sets;
            r.card2 = await card(s);
            r.report2 = await s.eval(REPORT(pg));
          }
        } finally { await s.close(); }
        const once = (sets) => pg.sets.every((k) => sets[k] === 1);
        if (how === '照常') {
          r.ok = r.inTime && r.done === 1 && once(r.sets) && r.add === pg.add && !r.card && pg.report.test(r.report) && !r.silent.length
            && (pg.mock || pg.ui || J(r.asked) === J(['confirm']));
        } else {
          r.ok = r.broke === true && /已經在別的分頁登出/.test(r.card) && !r.report && r.done === 0 && !Object.keys(r.sets).length
            && r.back && r.closed && J(r.asked2) === J(['confirm']) && r.done2 === 1 && once(r.sets2) && !r.card2 && pg.report.test(r.report2);
        }
        out.push(r);
      }
    }
  } finally { await o.close(); }
  const bad = out.filter((x) => !x.ok);
  return { ok: !bad.length, detail: bad.length ? '不對的 ' + bad.length + ' / ' + out.length + ' 項:' + bad.map((x) => x.how + '/' + x.page).join('、') + ' | ' + J(bad)
    : J(out.map((x) => x.how + '/' + x.page + ' 問 ' + x.asked.join(',') + (x.asked2 ? ' 再問 ' + x.asked2.join(',') : '') + ' 批改 ' + (x.done2 !== undefined ? x.done2 : x.done) + ' 次')) };
};

/* 多分頁(2026-11-01):別的分頁登出又登回來、正在灌資料(「還沒灌過」標記記著、帳號資料夾空的)時,這個分頁換到寫作頁的技巧課。
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

/* 加入班級視窗開著(自己按開的、邀請連結 ?join= 開的)、改暱稱視窗開著的時候,別的分頁登出 X、改登入 Y。
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
    /* 改暱稱是站內的輸入視窗(UI.prompt,回 Promise):換成替身,記下預先填的字;第一次開著的時候換成 Y、回「新暱稱」,第二次按取消(null) */
    await s.eval(`(() => { window.__prompts = []; window.__mark = 1; window.alert = (m) => { window.__prompts.push('alert:' + m); };
      UI.prompt = (o) => { window.__prompts.push(o.value); if (window.__prompts.length === 1) ${TO_Y}; return Promise.resolve(window.__prompts.length === 1 ? '新暱稱' : null); }; return true; })()`);
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

/* e49e444 就有(tools/test_sync.js 情境 63 測 js/cloud.js 送出前的確認):分頁畫面是帳號 X、沒重載,別的分頁登出 X、改登入 Y(或只登出)。
   supabase-js 送出時用的是這台現在的登入資料:以前這一頁按「刪除帳號」刪掉的是 Y 的帳號與雲端進度,「登出」把 Y 登出,
   「改暱稱」改的是 Y,「加入班級」把 Y 加進班。要的是:「我的」頁、頭像選單的這些按鈕都不問、不送,跳「這個帳號已經在別的分頁登出」卡,
   說剛剛按的沒有送出;Y 的登入資料、目前帳號、資料夾都不動,這一頁不重載,X 的資料夾不會被建回來。
   問的時候換帳號:確認視窗、暱稱視窗開著時別的分頁才換成 Y,按確定之後 js/cloud.js 送出前那一次確認擋下,一樣跳卡、不跳 alert、不送。
   平常登入著的「我的」頁:改暱稱、刪除帳號照常問、照常送到 X。
   這台已經沒有任何人登入著(只登出;或登入被撤銷、別的分頁照 leaveStaleAccount 改回訪客,X 的資料夾還留著)時按「登出」,
   不會登出到別人:照 e49e444 清掉 X 留在這台的東西、重載,但不呼叫 signOut(31745ec 跳卡、X 的資料留在共用電腦上)。刪除帳號照樣擋 */
T['別的分頁登出、改登入別人後沒重載的頁面:按登出、登出所有裝置、改暱稱、刪除帳號、加入班級都不問不送,跳「這個帳號已經在別的分頁登出」卡;平常登入著照常'] = async (B) => {
  const login = J({ access_token: 'x', user: USER });
  /* 確認視窗、輸入視窗記在 sessionStorage 的 __dlg(重載後還在):都回「確定」。「我的」頁的帳號動作用站內視窗(UI.confirm、UI.prompt,回 Promise),一樣換成替身 */
  const DLG = `(() => { const rec = (x) => { const d = JSON.parse(sessionStorage.getItem('__dlg') || '[]'); d.push(x); sessionStorage.setItem('__dlg', JSON.stringify(d)); };
    window.confirm = () => { rec('confirm'); return true; }; window.prompt = () => { rec('prompt'); return '新暱稱'; }; window.alert = (m) => { rec('alert:' + m); };
    UI.confirm = () => { rec('confirm'); return Promise.resolve(true); }; UI.prompt = () => { rec('prompt'); return Promise.resolve('新暱稱'); };
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
    /* 頭像選單收斂成「去哪裡」加登出:改暱稱、刪除帳號只在「我的」頁(上面兩項),選單裡沒有了 */
    '頭像選單:登出': async (s) => { await click(s, '.profile-btn'); await press(s, '.profile-menu .pm-item', '登出'); },
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
          const c = window.confirm, p = window.prompt; window.confirm = (m) => { sw(); return c(m); }; window.prompt = (m, d) => { sw(); return p(m, d); };
          const uc = UI.confirm, up = UI.prompt; UI.confirm = (o) => { sw(); return uc(o); }; UI.prompt = (o) => { sw(); return up(o); }; return true; })()`);
      }
      const before = keys(await s.eval(LS));
      const c0 = JSON.parse(await s.eval("sessionStorage.getItem('__fake_calls') || '[]'")).length;
      await ACTS[name](s);
      await sleep(900);
      /* 登出時還有沒同步的進度,cloud.js 問的是 UI.confirm(頁面上的視窗,不是原生 confirm):照原本「按確定」的意圖點「登出」 */
      if ((how === '只登出' || how === '撤銷後改回訪客') && /登出$/.test(name) && !/所有裝置/.test(name)
        && await s.eval("!!document.querySelector('.ui-dialog .ui-dialog-ok')")) { await click(s, '.ui-dialog .ui-dialog-ok'); await sleep(900); }
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

/* ================= 錯題本:模擬考錯題收進錯題本、錯題本分組 =================
   題庫在 node 這邊也載一份(灌學生紀錄、算答案用)。模擬考抽題固定:開頁前把 Math.random 換成 () => 0.999,洗牌不換位置,
   快速回合抽到的就是各 Part 題庫的前幾題(單元順序:聽力 2 ×6、聽力 3、聽力 4、閱讀 5 ×10、閱讀 6、閱讀 7) */
const BANK = (() => {
  const vm = require('vm');
  const ctx = { window: {} }; ctx.window = ctx; vm.createContext(ctx);
  ['data/part5.js', 'data/part6.js', 'data/part7.js', 'data/listening.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx));
  return ctx.TOEIC;
})();
const FIXRAND = 'Math.random = () => 0.999;';
const AK = (k) => 'tr_u' + CPID + '_' + k;
const wrongOf = (q) => (q.answer + 1) % q.options.length;
const login0 = () => J({ access_token: 'x', user: USER });
/* 點畫面上第 i 個符合 sel 的元素(先用 id 標記,真的滑鼠點) */
async function clickNth(s, sel, i) {
  const ok = await s.eval(`(() => { ${UNPRESS_JS} const e = document.querySelectorAll(${J(sel)})[${i}]; if (!e) return false; e.dataset.pressWas = e.id; e.id = '__press'; return true; })()`);
  if (!ok) throw new Error('找不到 ' + sel + ' #' + i);
  await click(s, '#__press');
  await s.eval(UNPRESS);   // 不留著:pressText 找的也是 #__press(畫面沒重畫時會點到這個舊的);元素原本的 id 放回去
}
const UNPRESS_JS = "{ const o = document.getElementById('__press'); if (o) { if (o.dataset.pressWas) o.id = o.dataset.pressWas; else o.removeAttribute('id'); delete o.dataset.pressWas; } }";
const UNPRESS = '(() => { ' + UNPRESS_JS + ' return true; })()';
/* 模擬考第 u 個單元、題組裡第 b 題的第 o 個選項(聽力 1/2 是字母鈕) */
async function mockPick(s, u, b, o) {
  await click(s, '.quiz-count');
  await clickNth(s, '.mock-panel .q-nav button', u);
  const n = await s.eval(`(() => { const old = document.getElementById('__press'); if (old) old.removeAttribute('id');
    const lr = document.querySelector('#mock-root .letter-row');
    if (lr) { lr.querySelectorAll('.letter-big')[${o}].id = '__press'; return 1; }
    const opts = document.querySelector('#mock-root .set-layout') ? [...document.querySelectorAll('#mock-root .set-layout .q-block')][${b}].querySelectorAll('.opt') : document.querySelectorAll('#mock-root .opts .opt');
    opts[${o}].id = '__press'; return opts.length; })()`);
  if (!n) throw new Error('找不到選項 ' + u + '/' + b + '/' + o);
  await click(s, '#__press');
  await s.eval(UNPRESS);
}
const WATCH_SETS = "(() => { if (window.__sets) return true; window.__sets = []; const f = store.set; store.set = function (k) { window.__sets.push(k); return f.apply(this, arguments); }; return true; })()";
const SETS_OF = (k) => `(window.__sets || []).filter((x) => x === ${J(k)}).length`;
const LSJ = (k) => `JSON.parse(localStorage.getItem(${J(AK(k))}) || 'null')`;

T['錯題本 E1:模擬考交卷把答錯的題收進 mock_wrong(只寫一次、只傳一次),原本在錯題本答對的寫已訂正、沒作答的不收;其他鍵逐字不動;結果頁照實講;題庫首頁錯題數跟著變'] = async (B) => {
  const P5 = BANK.part5, P6 = BANK.part6[0], L2 = BANK.listening.p2;
  const day = Date.now() - 864e5;
  const ls = {
    [SB]: login0(),
    [AK('drill_p5')]: J({ [P5[1].id]: { c: wrongOf(P5[1]), ok: false, t: day }, [P5[20].id]: { c: wrongOf(P5[20]), ok: false, t: day + 1 }, [P5[30].id]: { c: P5[30].answer, ok: true, t: day } }),
    [AK('drill_p6')]: J({ [P6.id + ':' + P6.questions[3].num]: { c: 0, ok: P6.questions[3].answer === 0, t: day } }),
    [AK('listen_p2')]: J({ [L2[9].id]: { c: wrongOf(L2[9]), ok: false, t: day } }),
    [AK('hist')]: J([{ m: 'p5', id: P5[1].id, c: wrongOf(P5[1]), ok: false, t: day }]),
    [AK('mock_history')]: J([{ d: new Date(day).toISOString(), size: 'quick', lRaw: 1, lTotal: 12, rRaw: 1, rTotal: 18, lScore: 5, rScore: 5 }]),
  };
  const s = await open(B, { url: 'mock.html', user: true, sdk: fakeCloud({ user: USER }), ls, pre: FIXRAND });
  const r = {};
  try {
    await click(s, '.part-card .btn.primary');
    await mockPick(s, 8, 0, wrongOf(P5[0]));             // Part 5 第 1 題:錯
    await mockPick(s, 9, 0, P5[1].answer);              // Part 5 第 2 題:對(原本在錯題本)
    await mockPick(s, 0, 0, wrongOf(L2[0]));            // 聽力 2 第 1 題:錯
    await mockPick(s, 18, 0, P6.questions[0].answer);   // Part 6 第 1 格:對
    await mockPick(s, 18, 1, wrongOf(P6.questions[1])); // Part 6 第 2 格:錯
    await sleep(1200);
    await s.eval(WATCH_SETS);
    const before = await s.eval(LS), up0 = await s.eval(UPS);
    await click(s, '.quiz-act');
    await sleep(400);
    await click(s, '.ui-dialog-ok');
    await sleep(1800);
    const after = await s.eval(LS);
    /* 小雞(pet-store)自己的「只在本機」標記、帳本不算 */
    r.changed = lsDiff(before, after).filter((k) => !/_pet$/.test(k) && k !== AK('mock_history') && k !== AK('mock_wrong') && k !== AK('mock_seen') && k !== 'tr_unsynced_' + UID && k !== 'tr_localonly_' + UID);
    const mw = JSON.parse(JSON.parse(after)[AK('mock_wrong')] || 'null') || {};
    const mh = JSON.parse(JSON.parse(after)[AK('mock_history')] || '[]');
    const T0 = Date.parse(mh[mh.length - 1].d);
    const want = { [P5[0].id]: false, [P5[1].id]: true, [L2[0].id]: false, [P6.id + ':' + P6.questions[1].num]: false };
    r.mw = Object.keys(mw).sort();
    r.right = J(r.mw) === J(Object.keys(want).sort()) && Object.keys(want).every((k) => mw[k].ok === want[k] && mw[k].t === T0);
    /* mock_seen:課程把模擬考作答過的題算做過;交卷時記作答過的題與交卷時間(答對答錯都記、沒作答的不記) */
    const seen = JSON.parse(JSON.parse(after)[AK('mock_seen')] || 'null') || {};
    const seenWant = [P5[0].id, P5[1].id, L2[0].id, P6.id + ':' + P6.questions[0].num, P6.id + ':' + P6.questions[1].num].sort();
    r.seen = Object.keys(seen).sort();
    r.seenRight = J(r.seen) === J(seenWant) && r.seen.every((k) => seen[k] === T0);
    r.sets = await s.eval(SETS_OF('mock_wrong'));
    r.ups = (await s.eval(UPS)).slice(up0.length).filter((k) => k === 'mock_wrong').length;
    r.note = await s.eval("[...document.querySelectorAll('.mock-wb-note p')].map((p) => p.textContent)");   // 完整的句子,一行一件事
    r.link = await s.eval("!!document.querySelector('.result-links a[href=\"review.html\"]')");
    await s.go('practice.html#wrongbook');
    await sleep(1500);
    r.p5 = await s.eval("(() => { const row = [...document.querySelectorAll('#wrongbook .review-row')].find((x) => /Part 5/.test(x.textContent)); return row ? row.querySelector('b').textContent : ''; })()");
    /* 捲到面板:面板頂端貼近視窗上緣;頁面比視窗只高一點、已經捲到底時,面板整個在視窗內也算(頁面變短之後頂端貼不到上緣) */
    r.scrolled = await s.eval("(() => { const p = document.getElementById('wrongbook').getBoundingClientRect(); const e = document.scrollingElement; return Math.abs(p.top) < 80 || (scrollY >= e.scrollHeight - innerHeight - 1 && p.top >= 0 && p.bottom <= innerHeight); })()");
  } finally { await s.close(); }
  r.ok = !r.changed.length && r.right && r.seenRight && r.sets === 1 && r.ups === 1 && r.note.length === 3 && r.note[0] === '答錯的 3 題已加進錯題本。' && r.note[1] === '錯題本裡有 1 題這次答對了，已移出錯題本。' && /^沒作答的 \d+ 題不會加進錯題本。$/.test(r.note[2])
    && r.link && r.p5 === '2 題' && r.scrolled;
  return { ok: r.ok, detail: J(r) };
};

/* 2026-11-23:模擬考首頁三種規模(快速回合、標準半回、完整一回),完整一回 200 題、限時 120 分鐘。
   首頁只有一顆實色主按鈕(快速回合);完整一回開考有 100 個題號、依 Part 分組;切到背景回來倒數照實際時間(回到畫面馬上對一次);
   時間到自動交卷,寫進 mock_history 的 size 是 'full'、聽力 100 閱讀 100 題;作答的錯題收進 mock_wrong,首頁歷次紀錄顯示「完整一回」 */
T['模擬考 完整一回:首頁三張卡(一顆主按鈕)、開考 120 分鐘與 100 個題號分 Part;回到畫面倒數照實際時間;時間到交卷存 size full、錯題收進錯題本;歷次紀錄寫「完整一回」'] = async (B) => {
  const P5 = BANK.part5;
  const s = await open(B, { url: 'mock.html', user: true, sdk: fakeCloud({ user: USER }), ls: { [SB]: login0() }, pre: FIXRAND });
  const r = {};
  try {
    r.cards = await s.eval("[...document.querySelectorAll('.part-card')].map((c) => c.querySelector('h3').textContent + '|' + c.querySelector('.mock-tags').textContent + '|' + (c.querySelector('.btn.primary') ? 'P' : 'O'))");
    r.primaries = await s.eval("document.querySelectorAll('.btn.primary').length");
    await clickNth(s, '.part-card .btn', 2);
    await sleep(600);
    r.timer0 = await s.eval("document.querySelector('.mock-timer').textContent");
    r.count = await s.eval("document.querySelector('.quiz-count').textContent");
    await click(s, '.quiz-count');
    r.panel = await s.eval("({ labels: [...document.querySelectorAll('.mock-panel .mock-panel-label')].map((x) => x.textContent), btns: document.querySelectorAll('.mock-panel .q-nav button').length, note: (document.querySelector('.ui-sheet-note') || {}).textContent })");
    await s.eval("(() => { const b = document.querySelector('.ui-sheet-close'); if (b) b.click(); return true; })()");
    await sleep(300);
    await mockPick(s, 54, 0, wrongOf(P5[0]));   // Part 5 第 1 題:錯
    /* 切到背景 30 分鐘後回來:不等下一個一秒,回到畫面那一下就對 */
    await s.eval("(() => { const t = Date.now; window.__realNow = t; Date.now = () => t() + 30 * 60e3; document.dispatchEvent(new Event('visibilitychange')); return true; })()");
    r.timer1 = await s.eval("document.querySelector('.mock-timer').textContent");
    await s.eval("(() => { const t = window.__realNow; Date.now = () => t() + 121 * 60e3; document.dispatchEvent(new Event('visibilitychange')); return true; })()");
    await sleep(1800);
    r.result = await s.eval("({ title: document.title, flag: (document.querySelector('.result-card') || {}).textContent || '' })");
    const ls = JSON.parse(await s.eval(LS));
    const mh = JSON.parse(ls[AK('mock_history')] || '[]'), mw = JSON.parse(ls[AK('mock_wrong')] || '{}');
    r.rec = mh[mh.length - 1];
    r.mw = Object.keys(mw);
    r.note = await s.eval("[...document.querySelectorAll('.mock-wb-note p')].map((p) => p.textContent)");   // 完整的句子,一行一件事
    await s.go('mock.html');
    await sleep(1200);
    r.hist = await s.eval("(document.querySelector('.cat-table tr:nth-child(2) td:nth-child(2)') || {}).textContent || ''");
  } finally { await s.close(); }
  const d = ['快速回合|', '標準半回|', '完整一回|聽力 100 題 · 閱讀 100 題限時 120 分鐘'];
  r.ok = r.cards.length === 3 && r.cards.every((c, i) => c.startsWith(d[i]) || (i < 2 && c.startsWith(d[i].split('|')[0]))) && r.cards[0].endsWith('|P') && r.cards[1].endsWith('|O') && r.cards[2].endsWith('|O') && r.primaries === 1
    && /^(120:00|119:5\d)$/.test(r.timer0) && /^1 \/ 100$/.test(r.count.replace(/\s/g, ' ').trim())
    && J(r.panel.labels) === J(['聽力 Part 1 · 6 題', '聽力 Part 2 · 25 題', '聽力 Part 3 · 13 組', '聽力 Part 4 · 10 組', '閱讀 Part 5 · 30 題', '閱讀 Part 6 · 4 組', '閱讀 Part 7 · 12 組']) && r.panel.btns === 100
    && /^(89|90):\d\d$/.test(r.timer1) && /模擬考結果/.test(r.result.title) && /時間到/.test(r.result.flag)
    && r.rec && r.rec.size === 'full' && r.rec.lTotal === 100 && r.rec.rTotal === 100
    && J(r.mw) === J([P5[0].id]) && r.note[0] === '答錯的 1 題已加進錯題本。' && r.hist === '完整一回';
  return { ok: !!r.ok, detail: J(r) };
};

T['錯題本 E5:每日複習出現只在模擬考錯題裡的題;答對不動刷題紀錄、寫已訂正記號;答錯在刷題紀錄新加一筆、mock_wrong 不變,錯題本那題變成今天、不標模擬考'] = async (B) => {
  const P5 = BANK.part5, day = Date.now() - 864e5;
  const mw = { [P5[3].id]: { c: wrongOf(P5[3]), ok: false, t: day }, [P5[5].id]: { c: wrongOf(P5[5]), ok: false, t: day + 1 } };
  const d5 = { [P5[50].id]: { c: P5[50].answer, ok: true, t: day } };
  const s = await open(B, { url: 'review.html', user: true, sdk: fakeCloud({ user: USER }), ls: { [SB]: login0(), [AK('mock_wrong')]: J(mw), [AK('drill_p5')]: J(d5) } });
  const r = {};
  try {
    r.todo = await s.eval("(document.querySelector('.part-card p') || {}).textContent || ''");
    await s.eval(WATCH_SETS);
    await pressText(s, '.part-card .btn.primary', '開始');
    r.first = await s.eval("(document.querySelector('.q-text') || {}).textContent || ''");
    await clickNth(s, '.q-block .opts .opt', P5[3].answer);
    await sleep(300);
    r.afterOk = { d5: await s.eval(LSJ('drill_p5')), mw: (await s.eval(LSJ('mock_wrong')))[P5[3].id], dsets: await s.eval(SETS_OF('drill_p5')) };
    await pressText(s, '.quiz-foot .btn.primary', '下一題');
    await clickNth(s, '.q-block .opts .opt', wrongOf(P5[5]));
    await sleep(300);
    r.afterBad = { d5: (await s.eval(LSJ('drill_p5')))[P5[5].id], mw: (await s.eval(LSJ('mock_wrong')))[P5[5].id], dsets: await s.eval(SETS_OF('drill_p5')) };
    await s.go('practice.html?mode=wrong&part=5');
    await sleep(1200);
    await s.eval("document.querySelectorAll('.wb-toggle').forEach((b) => { if (b.getAttribute('aria-expanded') !== 'true') b.click(); }); true");
    r.rows = await s.eval("[...document.querySelectorAll('.wb-item')].map((x) => (x.querySelector('.wb-meta') || {}).textContent || '')");
  } finally { await s.close(); }
  const today = (new Date().getMonth() + 1) + '/' + new Date().getDate();
  r.ok = /待複習 2 題/.test(r.todo) && r.first.indexOf(P5[3].question.slice(0, 20)) > -1 && J(r.afterOk.d5) === J(d5) && r.afterOk.dsets === 0
    && r.afterOk.mw.ok === true && r.afterOk.mw.t > day + 1000 && !!r.afterBad.d5 && r.afterBad.d5.ok === false && r.afterBad.d5.c === wrongOf(P5[5]) && r.afterBad.dsets === 1
    && J(r.afterBad.mw) === J(mw[P5[5].id]) && J(r.rows) === J([today]);
  return { ok: r.ok, detail: J(r) };
};

/* 刷題時答對過、之後模擬考答錯(模擬考那筆比較新,所以在錯題本):每日複習答對不能刪掉刷題那筆答對紀錄(已作答數會少);
   答錯不能只把那筆答對紀錄的時間改成現在(那樣它變成最新的一筆、還是答對,題目就從錯題本消失) */
T['錯題本 E5b:每日複習刷題答對過、模擬考答錯的題:答對不刪刷題的答對紀錄、寫已訂正記號;答錯後刷題那筆變成這次的錯答,還留在錯題本'] = async (B) => {
  const P5 = BANK.part5, day = Date.now() - 864e5;
  const d5 = { [P5[3].id]: { c: P5[3].answer, ok: true, t: day }, [P5[5].id]: { c: P5[5].answer, ok: true, t: day } };
  const mw = { [P5[3].id]: { c: wrongOf(P5[3]), ok: false, t: day + 10 }, [P5[5].id]: { c: wrongOf(P5[5]), ok: false, t: day + 11 } };
  const s = await open(B, { url: 'review.html', user: true, sdk: fakeCloud({ user: USER }), ls: { [SB]: login0(), [AK('mock_wrong')]: J(mw), [AK('drill_p5')]: J(d5) } });
  const r = {};
  try {
    r.todo = await s.eval("(document.querySelector('.part-card p') || {}).textContent || ''");
    await pressText(s, '.part-card .btn.primary', '開始');
    r.first = await s.eval("(document.querySelector('.q-text') || {}).textContent || ''");
    await clickNth(s, '.q-block .opts .opt', P5[3].answer);
    await sleep(300);
    r.afterOk = { d5: (await s.eval(LSJ('drill_p5')))[P5[3].id], mw: (await s.eval(LSJ('mock_wrong')))[P5[3].id] };
    await pressText(s, '.quiz-foot .btn.primary', '下一題');
    await clickNth(s, '.q-block .opts .opt', wrongOf(P5[5]));
    await sleep(300);
    r.afterBad = { d5: (await s.eval(LSJ('drill_p5')))[P5[5].id], mw: (await s.eval(LSJ('mock_wrong')))[P5[5].id] };
    await s.go('practice.html?mode=wrong&part=5');
    await sleep(1200);
    await s.eval("document.querySelectorAll('.wb-toggle').forEach((b) => { if (b.getAttribute('aria-expanded') !== 'true') b.click(); }); true");
    r.rows = await s.eval("[...document.querySelectorAll('.wb-item')].map((x) => (x.querySelector('.wb-meta') || {}).textContent || '')");
  } finally { await s.close(); }
  const today = (new Date().getMonth() + 1) + '/' + new Date().getDate();
  r.ok = /待複習 2 題/.test(r.todo) && r.first.indexOf(P5[3].question.slice(0, 20)) > -1
    && J(r.afterOk.d5) === J(d5[P5[3].id]) && !!r.afterOk.mw && r.afterOk.mw.ok === true && r.afterOk.mw.t > day + 1000
    && !!r.afterBad.d5 && r.afterBad.d5.ok === false && r.afterBad.d5.c === wrongOf(P5[5]) && r.afterBad.d5.t > day + 1000
    && J(r.afterBad.mw) === J(mw[P5[5].id]) && J(r.rows) === J([today]);
  return { ok: r.ok, detail: J(r) };
};

T['錯題本 E6:錯題本複習答對只在模擬考錯題裡的題:刷題紀錄照舊多一筆答對、mock_wrong 不變,回清單少一題'] = async (B) => {
  const P5 = BANK.part5, day = Date.now() - 864e5;
  const q = P5.find((x) => x.category === P5[0].category && x !== P5[0]);
  const mw = { [q.id]: { c: wrongOf(q), ok: false, t: day } };
  const d5 = { [P5[0].id]: { c: wrongOf(P5[0]), ok: false, t: day - 5 } };
  const s = await open(B, { url: 'practice.html?mode=review&part=5&g=' + encodeURIComponent(P5[0].category), user: true, sdk: fakeCloud({ user: USER }),
    ls: { [SB]: login0(), [AK('mock_wrong')]: J(mw), [AK('drill_p5')]: J(d5) } });
  const r = {};
  try {
    r.dots = await s.eval(QUIZ_TOTAL);
    r.close = await s.eval("!!document.querySelector('.quiz-close')");   // 專心模式:作答列左邊的關閉鈕回錯題本
    await clickNth(s, '.q-block .opts .opt', P5[0].answer);     // 最早錯的先出:P5[0]
    await pressText(s, '.quiz-foot .btn', '下一題');
    r.second = await s.eval("(document.querySelector('.q-text') || {}).textContent || ''");
    await clickNth(s, '.q-block .opts .opt', q.answer);
    await sleep(300);
    r.d5 = (await s.eval(LSJ('drill_p5')))[q.id];
    r.mw = (await s.eval(LSJ('mock_wrong')))[q.id];
    await pressText(s, '.quiz-foot .btn', '看成績');
    r.sum = await s.eval("(document.querySelector('.result-card') || {}).textContent || ''");
    r.back = await s.eval("[...document.querySelectorAll('.result-card a')].map((a) => a.textContent + '>' + a.getAttribute('href'))");
    await s.go('practice.html?mode=wrong&part=5');
    await sleep(1000);
    r.after = await s.eval("(document.querySelector('.ui-empty-text') || {}).textContent || ''");
  } finally { await s.close(); }
  r.ok = r.dots === 2 && r.close && r.second.indexOf(q.question.slice(0, 20)) > -1 && !!r.d5 && r.d5.ok === true && J(r.mw) === J(mw[q.id])
    && /移出\s*2\s*題/.test(r.sum) && J(r.back) === J(['回錯題本>practice.html?mode=wrong&part=5']) && /沒有錯題/.test(r.after);
  return { ok: r.ok, detail: J(r) };
};

/* 介面:一個學生,Part 5 刷題錯 60 題分在 8 個考點(第 3 個考點「字彙辨析」24 題,一回放不下)、模擬考錯 3 題(1 題在第 9 個考點);
   Part 6、7、聽力 2、3、4(兩組機場廣播)各有幾題 */
function wbStudent() {
  const P5 = BANK.part5, L = BANK.listening, day = Date.now() - 864e5;
  const cats = [...new Set(P5.map((q) => q.category))];
  const by = (c) => P5.filter((q) => q.category === c);
  const d5 = {}, mw = {};
  let t = day - 1e6;
  const take = [6, 6, 24, 6, 6, 4, 4, 4];
  cats.slice(0, 8).forEach((c, i) => by(c).slice(0, take[i]).forEach((q) => { d5[q.id] = { c: wrongOf(q), ok: false, t: t += 1000 }; }));
  const ninth = by(cats[8])[0];
  mw[ninth.id] = { c: wrongOf(ninth), ok: false, t: day };
  by(cats[1]).slice(10, 12).forEach((q) => { mw[q.id] = { c: wrongOf(q), ok: false, t: day + 5 }; });
  const d6 = {}, d7 = {}, l2 = {}, l3 = {}, l4 = {};
  BANK.part6.slice(0, 3).forEach((s, i) => { const q = s.questions[0]; d6[s.id + ':' + q.num] = { c: wrongOf(q), ok: false, t: day + i }; });
  BANK.part7.slice(0, 30).forEach((s, i) => { d7[s.id + ':0'] = { c: wrongOf(s.questions[0]), ok: false, t: day + i }; });
  L.p2.slice(0, 8).forEach((q, i) => { l2[q.id] = { c: wrongOf(q), ok: false, t: day + i }; });
  L.p3.slice(0, 2).forEach((s, i) => { l3[s.id + ':0'] = { c: wrongOf(s.questions[0]), ok: false, t: day + i }; });
  L.p4.filter((s) => s.type === '機場廣播').forEach((s, i) => { l4[s.id + ':1'] = { c: wrongOf(s.questions[1]), ok: false, t: day + i }; });
  return { cats, ninth, ls: { [SB]: login0(), [AK('drill_p5')]: J(d5), [AK('mock_wrong')]: J(mw), [AK('drill_p6')]: J(d6), [AK('drill_p7')]: J(d7),
    [AK('listen_p2')]: J(l2), [AK('listen_p3')]: J(l3), [AK('listen_p4')]: J(l4) } };
}
const WB_STATE = `(() => { const g = [...document.querySelectorAll('.wb-group')].map((x) => { const b = x.querySelector('.wb-toggle'), l = document.getElementById(b.getAttribute('aria-controls'));
  return { name: x.querySelector('.wb-name').textContent, n: Number((b.querySelector('b').textContent.match(/\\d+/) || [0])[0]), open: b.getAttribute('aria-expanded'), hidden: !l || l.hidden,
    items: l ? l.querySelectorAll('.wb-item').length : -1, mock: l ? [...l.querySelectorAll('.wb-meta')].filter((m) => /模擬考/.test(m.textContent)).length : 0 }; });
  const all = document.querySelector('.wb-all'); return { g, all: all ? all.textContent + '|' + all.getAttribute('aria-expanded') : null }; })()`;

T['錯題本 U1–U10:Part 5 清單分 9 組照題庫順序、預設收起、可同時開、鍵盤切換、結構對、全部展開、空組不出現、複習一組一回 20 題有「下一回」、答對回清單少一題開的組還開著、手機寬'] = async (B) => {
  const st = wbStudent();
  const r = {};
  let s = await open(B, { url: 'practice.html?mode=wrong&part=5', user: true, sdk: fakeCloud({ user: USER }), ls: st.ls });
  try {
    const a = await s.eval(WB_STATE);
    const names = a.g.map((x) => x.name);
    r.u1 = { n: a.g.length, sum: a.g.reduce((k, x) => k + x.n, 0), order: J(names) === J(st.cats.filter((c) => names.includes(c))), sumLine: await s.eval("(document.querySelector('.wb-sum') || {}).textContent") };
    r.u2 = a.g.every((x) => x.open === 'false' && x.hidden);
    await clickNth(s, '.wb-toggle', 0);
    await clickNth(s, '.wb-toggle', 1);
    const b = await s.eval(WB_STATE);
    r.u3 = b.g[0].open === 'true' && !b.g[0].hidden && b.g[0].items === b.g[0].n && b.g[1].open === 'true' && b.g[2].open === 'false';
    r.u1mock = { g1: b.g[1].mock, g0: b.g[0].mock };
    /* 鍵盤:焦點在「全部展開」,Tab 到第一組的展開鈕,Enter 收起、空白鍵打開 */
    await s.eval("document.querySelector('.wb-all').focus(); true");
    r.u4from = await s.eval("document.activeElement ? document.activeElement.className : ''");
    await key(s, 'Tab');
    r.u4focus = await s.eval("document.activeElement ? document.activeElement.id || document.activeElement.tagName + '.' + document.activeElement.className : ''");
    await key(s, 'Enter');
    const k1 = (await s.eval(WB_STATE)).g[0].open;
    await key(s, ' ');
    const k2 = (await s.eval(WB_STATE)).g[0].open;
    r.u4 = r.u4focus === 'wb-b-5-0' && k1 === 'false' && k2 === 'true';
    r.u5 = await s.eval(`(() => [...document.querySelectorAll('.wb-h')].every((h) => h.children.length === 1 && h.children[0].tagName === 'BUTTON' && h.tagName === 'H2')
      && [...document.querySelectorAll('.wb-toggle')].every((b) => !!document.getElementById(b.getAttribute('aria-controls')))
      && [...document.querySelectorAll('.wb-go')].every((g) => !g.closest('.wb-h') && /^開始複習「.+」\\d+ 題$/.test(g.getAttribute('aria-label')) && g.hasAttribute('data-gate'))
      && !document.querySelector('[role=region]'))()`);
    await click(s, '.wb-all');
    const c = await s.eval(WB_STATE);
    r.u6 = c.g.every((x) => x.open === 'true' && !x.hidden) && c.all === '全部收起|true';
    r.u7 = !c.g.some((x) => x.n === 0);
    /* 第 3 組(字彙辨析 24 題)的複習:一回 20 題,做完有「下一回」 */
    await clickNth(s, '.wb-go', 2);
    await sleep(800);
    r.u8url = await s.eval('location.search');
    r.u8dots = await s.eval(QUIZ_TOTAL);
    const cats = new Set();
    for (let i = 0; i < r.u8dots; i++) {
      cats.add(await s.eval("(document.querySelector('.q-block .badge.cat') || {}).textContent"));
      const q = await s.eval("document.querySelector('.q-text').textContent");
      const item = BANK.part5.find((x) => q.indexOf(x.question.slice(0, 30)) > -1);
      await clickNth(s, '.q-block .opts .opt', i === 0 ? item.answer : wrongOf(item));   // 第一題答對,其他答錯
      await pressText(s, '.quiz-foot .btn', i === r.u8dots - 1 ? '看成績' : '下一題');
    }
    r.u8cats = [...cats];
    r.u8sum = await s.eval("(document.querySelector('.result-card') || {}).textContent");
    r.u8next = await s.eval("[...document.querySelectorAll('.result-card a')].map((a) => a.textContent)");
    r.u8 = /g=/.test(r.u8url) && r.u8dots === 20 && J(r.u8cats) === J([st.cats[2]]) && /還沒複習\s*4 題/.test(r.u8sum) && J(r.u8next) === J(['下一回', '回錯題本']);
    /* 回錯題本:那一組少一題,剛剛開的組(全部展開過)還開著 */
    await pressText(s, '.result-card a', '回錯題本');
    await sleep(1000);
    const d = await s.eval(WB_STATE);
    r.u9 = d.g[2].n === 23 && d.g.every((x) => x.open === 'true');
    /* 第 9 個考點只有模擬考那 1 題:答對之後那組不見 */
    await s.go('practice.html?mode=review&part=5&g=' + encodeURIComponent(st.cats[8]));
    await sleep(800);
    await clickNth(s, '.q-block .opts .opt', st.ninth.answer);
    await s.go('practice.html?mode=wrong&part=5');
    await sleep(1000);
    const e = await s.eval(WB_STATE);
    r.u9b = e.g.length === 8 && !e.g.some((x) => x.name === st.cats[8]);
    /* sessionStorage 讀不懂:頁面照常、全部收起 */
    await s.eval("sessionStorage.setItem('tr_wb_open', '{壞掉'); true");
    await s.go('practice.html?mode=wrong&part=5');
    await sleep(1000);
    const f = await s.eval(WB_STATE);
    r.u9c = f.g.length === 8 && f.g.every((x) => x.open === 'false');
  } finally { await s.close(); }
  /* U10:手機 375 */
  s = await open(B, { url: 'practice.html?mode=wrong&part=5', user: true, sdk: fakeCloud({ user: USER }), ls: st.ls, size: { width: 375, height: 812 } });
  try {
    r.u10 = await s.eval(`(() => { const g = document.querySelector('.wb-group'), name = g.querySelector('.wb-name').getBoundingClientRect(), go = g.querySelector('.wb-go').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, top: Math.round(g.getBoundingClientRect().top), same: Math.abs((name.top + name.bottom) / 2 - (go.top + go.bottom) / 2) < 12 }; })()`);
    await s.eval("document.querySelectorAll('.wb-toggle').forEach((b) => b.click()); true");
    r.u10open = await s.eval('document.documentElement.scrollWidth');
  } finally { await s.close(); }
  const ok = r.u1.n === 9 && r.u1.sum === 63 && r.u1.order && /63 題 · 9 類/.test(r.u1.sumLine) && r.u2 && r.u3 && r.u1mock.g1 === 2 && r.u1mock.g0 === 0 && r.u4 && r.u5 && r.u6 && r.u7 && r.u8 && r.u9 && r.u9b && r.u9c
    && r.u10.sw <= 375 && r.u10.top < 400 && r.u10.same && r.u10open <= 375;
  return { ok, detail: J(r) };
};

T['錯題本 U11–U13、U15:聽力網址直接開、聽力 3 一段一組、聽力 4 同類併組;題庫首頁面板「查看」;能力分析同一套分組;模擬考首頁照實講舊的補不回來'] = async (B) => {
  const st = wbStudent();
  const r = {};
  let s = await open(B, { url: 'practice.html?mode=wrong&part=2', user: true, sdk: fakeCloud({ user: USER }), ls: st.ls });
  try {
    r.l2 = (await s.eval(WB_STATE)).g.map((x) => x.name);
    await s.go('practice.html?mode=wrong&part=3');
    await sleep(900);
    r.l3 = (await s.eval(WB_STATE)).g.map((x) => x.name + ':' + x.n);
    r.l3sum = await s.eval("(document.querySelector('.wb-sum') || {}).textContent");
    await s.go('practice.html?mode=wrong&part=4');
    await sleep(900);
    const l4 = await s.eval(WB_STATE);
    r.l4 = l4.g.map((x) => x.name + ':' + x.n); r.l4all = l4.all;
    await s.go('practice.html?mode=wrong&part=1');
    await sleep(900);
    r.l1 = await s.eval("(document.querySelector('.ui-empty-text') || {}).textContent || ''");
    await s.go('practice.html?mode=review&part=2');
    await sleep(900);
    r.l2review = { letters: await s.eval("document.querySelectorAll('.letter-row .letter-big').length"), bar: await s.eval("!!document.querySelector('.quiz-close')") };
    /* U12:題庫首頁面板 */
    await s.go('practice.html');
    await sleep(1000);
    r.panel = await s.eval("[...document.querySelectorAll('#wrongbook .review-row')].map((x) => { const a = x.querySelector('a.btn'); return x.querySelector('b').textContent + '|' + (a ? a.textContent + '>' + a.getAttribute('href') : x.lastChild.textContent); })");
    /* U13:能力分析 */
    await s.go('analysis.html');
    await sleep(1200);
    r.an = await s.eval(`(() => { const t = [...document.querySelectorAll('.wb-toggle')]; const p7 = t.filter((b) => /^wb-b-7-/.test(b.id)).map((b) => b.querySelector('.wb-name').textContent);
      const before = t[0] && t[0].getAttribute('aria-expanded'); if (t[0]) t[0].click(); const after = t[0] && t[0].getAttribute('aria-expanded');
      return { n: t.length, h4: [...document.querySelectorAll('.wb-h')].every((h) => h.tagName === 'H4'), before, after, p7, old: /題組 25/.test(document.body.textContent),
        links: [...document.querySelectorAll('a.btn')].filter((a) => a.textContent === '看錯題本').map((a) => a.getAttribute('href')) }; })()`);
  } finally { await s.close(); }
  /* U15:模擬考首頁(最近 8 筆有一筆早於上線 → 有那行;全部晚於 → 沒有) */
  const rec = (d) => ({ d, size: 'quick', lRaw: 3, lTotal: 12, rRaw: 4, rTotal: 18, lScore: 85, rScore: 85 });
  const SINCE = Date.parse(/const SINCE = '([^']+)'/.exec(fs.readFileSync(path.join(REPO, 'js/wrongbook.js'), 'utf8'))[1]);
  r.sinceDay = (new Date(SINCE).getMonth() + 1) + '/' + new Date(SINCE).getDate();   // 說明開頭的日期就是 SINCE 那天(Chrome 跟 node 同一個時區)
  for (const [name, list] of [['old', [rec(new Date(SINCE - 864e5).toISOString()), rec(new Date(SINCE + 3600e3).toISOString())]], ['new', [rec(new Date(SINCE + 3600e3).toISOString())]]]) {
    s = await open(B, { url: 'mock.html', user: true, sdk: fakeCloud({ user: USER }), ls: { [SB]: login0(), [AK('mock_history')]: J(list) } });
    try { r['mock_' + name] = await s.eval("(document.querySelector('.mock-old-note') || {}).textContent || ''"); } finally { await s.close(); }
  }
  const cats2 = [...new Set(BANK.listening.p2.slice(0, 8).map((q) => q.category))];
  const ok = J(r.l2.slice().sort()) === J(cats2.slice().sort()) && J(r.l3) === J(BANK.listening.p3.slice(0, 2).map((x) => x.title + ':1')) && /2 題 · 2 段對話/.test(r.l3sum)
    && J(r.l4) === J(['機場廣播:2']) && r.l4all === null && /沒有錯題/.test(r.l1) && r.l2review.letters === 3 && r.l2review.bar
    && J(r.panel) === J(['63 題|查看>practice.html?mode=wrong&part=5', '3 題|查看>practice.html?mode=wrong&part=6', '30 題|查看>practice.html?mode=wrong&part=7',
      '8 題|查看>practice.html?mode=wrong&part=2', '2 題|查看>practice.html?mode=wrong&part=3', '2 題|查看>practice.html?mode=wrong&part=4'])
    && r.an.n > 9 && r.an.h4 && r.an.before === 'false' && r.an.after === 'true' && r.an.p7.length > 2 && r.an.p7.indexOf('多篇閱讀') === r.an.p7.length - 1 && !r.an.old
    && J(r.an.links) === J(['practice.html?mode=wrong&part=5', 'practice.html?mode=wrong&part=6', 'practice.html?mode=wrong&part=7'])
    && r.mock_old.indexOf(r.sinceDay + ' 前的模擬考錯題未收進錯題本') === 0 && r.mock_new === '';
  return { ok, detail: J(r) };
};

/* 2026-11-18:從複習按瀏覽器上一頁(手機返回鍵、iPhone 右滑)回來。網站真的上線時 .html 不是 no-store,
   頁面從 bfcache 原樣拿回來:以前題數沒變、剛答對的題還列著。window.__mark 還在＝真的是 bfcache 拿回來的(不是重新載入) */
async function back(s) { await s.eval('history.back(); true'); await sleep(900); await s.loaded(); await sleep(300); }
const QTEXT_ITEM = async (s) => { const q = await s.eval("document.querySelector('.q-text').textContent"); return BANK.part5.find((x) => q.indexOf(x.question.slice(0, 30)) > -1); };
const WB_ITEMS = "[...document.querySelectorAll('.wb-group')].map((g) => [...g.querySelectorAll('.wb-stem')].map((x) => x.textContent))";

T['錯題本 U16:從複習按上一頁回來(bfcache 原樣拿回來):錯題本清單、題庫首頁面板、能力分析都跟著變,剛答對的題不在、題數少一題,開的組還開著、焦點回到同一組的「複習」;只剩 1 題的組答對後不見;別的分頁答完、叫回前景也重畫'] = async (B) => {
  const st = wbStudent();
  const r = {};
  BFCACHE = true;
  let s = null;
  try {
    s = await open(B, { url: 'practice.html?mode=wrong&part=5', user: true, sdk: fakeCloud({ user: USER }), ls: st.ls });
    /* 清單頁:開第 1 組,鍵盤在這組的「複習」按 Enter,答對第 1 題,上一頁 */
    await clickNth(s, '.wb-toggle', 0);
    const a = await s.eval(WB_STATE);
    await s.eval("window.__mark = 1; document.querySelectorAll('.wb-go')[0].focus(); true");
    await key(s, 'Enter');
    await s.loaded(); await sleep(500);
    const it = await QTEXT_ITEM(s);
    await clickNth(s, '.q-block .opts .opt', it.answer);
    await back(s);
    const b = await s.eval(WB_STATE);
    const stems = await s.eval(WB_ITEMS);
    r.list = { bf: await s.eval('window.__mark === 1'), n: [a.g[0].n, b.g[0].n], open: b.g[0].open, shown: b.g[0].items, sum: await s.eval("document.querySelector('.wb-sum').textContent"),
      gone: !stems[0].some((t) => t.indexOf(it.question.slice(0, 30)) > -1), focus: await s.eval("document.activeElement === document.querySelectorAll('.wb-go')[0]") };
    /* 只剩 1 題的組(第 9 個考點,模擬考那 1 題):答對後上一頁,那組不見 */
    await s.eval('window.__mark = 2; true');
    await s.go('practice.html?mode=review&part=5&g=' + encodeURIComponent(st.cats[8]));
    await sleep(600);
    await clickNth(s, '.q-block .opts .opt', st.ninth.answer);
    await back(s);
    const c = await s.eval(WB_STATE);
    r.one = { bf: await s.eval('window.__mark === 2'), n: c.g.length, gone: !c.g.some((x) => x.name === st.cats[8]) };
    /* 題庫首頁面板 */
    await s.go('practice.html');
    await sleep(900);
    const P5ROW = "(() => { const row = [...document.querySelectorAll('#wrongbook .review-row')].find((x) => /Part 5/.test(x.textContent)); return row ? row.querySelector('b').textContent : ''; })()";
    const h0 = await s.eval(P5ROW);
    await s.eval('window.__mark = 3; true');
    await s.go('practice.html?mode=review&part=5&g=' + encodeURIComponent(st.cats[0]));
    await sleep(600);
    await clickNth(s, '.q-block .opts .opt', (await QTEXT_ITEM(s)).answer);
    await back(s);
    r.home = { bf: await s.eval('window.__mark === 3'), n: [h0, await s.eval(P5ROW)] };
    /* 能力分析:開 Part 5 第 1 組,按它的「複習」(滑鼠),答對,上一頁 */
    await s.go('analysis.html');
    await sleep(1200);
    await click(s, '#wb-b-5-0');
    const AN = "(() => { const b = document.getElementById('wb-b-5-0'); return b ? b.querySelector('b').textContent + '|' + b.getAttribute('aria-expanded') + '|' + document.getElementById(b.getAttribute('aria-controls')).querySelectorAll('.wb-item').length : ''; })()";
    const an0 = await s.eval(AN);
    await s.eval('window.__mark = 4; true');
    await clickNth(s, '.wb-go', 0);
    await s.loaded(); await sleep(500);
    await clickNth(s, '.q-block .opts .opt', (await QTEXT_ITEM(s)).answer);
    await back(s);
    r.an = { bf: await s.eval('window.__mark === 4'), v: [an0, await s.eval(AN)] };
    /* 別的分頁把第 1 組剩下的題都答對了,這頁叫回前景(visibilitychange):那組不見 */
    const left = BANK.part5.filter((q) => q.category === st.cats[0]).slice(0, 6).map((q) => [q.id, q.answer]);
    await s.eval(`(() => { const k = ${J(AK('drill_p5'))}, v = JSON.parse(localStorage.getItem(k)); ${J(left)}.forEach(([id, a]) => { v[id] = { c: a, ok: true, t: Date.now() }; });
      localStorage.setItem(k, JSON.stringify(v)); document.dispatchEvent(new Event('visibilitychange')); return true; })()`);
    r.vis = { state: await s.eval('document.visibilityState'), names: await s.eval(`[...document.querySelectorAll('[data-part="5"] .wb-name')].map((x) => x.textContent)`) };
  } finally { BFCACHE = false; if (s) await s.close(); }
  const ok = r.list.bf && r.list.n[1] === r.list.n[0] - 1 && r.list.open === 'true' && r.list.shown === r.list.n[1] && /^62 題/.test(r.list.sum) && r.list.gone && r.list.focus
    && r.one.bf && r.one.n === 8 && r.one.gone
    && r.home.bf && r.home.n[0] === '61 題' && r.home.n[1] === '60 題'   // 63 − 清單頁那題 − 第 9 組那題 = 61
    && r.an.bf && r.an.v[0] === '4 題|true|4' && r.an.v[1] === '3 題|true|3'
    && r.vis.names.length === 7 && r.vis.names.indexOf(st.cats[0]) < 0;
  return { ok, detail: J(r) };
};

/* 模擬考結果「看錯題本 →」、每日複習「前往」連到 practice.html#wrongbook:標題、第一列不能被固定的頂欄蓋住
   (桌機頂欄一列、手機兩列,320 可能更高,所以照頂欄實際的高度算) */
T['錯題本 U17:practice.html#wrongbook 捲到錯題本面板時,「錯題本」標題和第一列在頂欄下面、沒被蓋住(1280、375、320)'] = async (B) => {
  const st = wbStudent();
  const out = {};
  for (const w of [1280, 375, 320]) {
    const s = await open(B, { url: 'practice.html#wrongbook', user: true, sdk: fakeCloud({ user: USER }), ls: st.ls, size: w === 1280 ? null : { width: w, height: 740 } });
    try {
      await sleep(400);
      out[w] = await s.eval(`(() => { const bar = Math.round(document.querySelector('.topbar').getBoundingClientRect().bottom), p = document.getElementById('wrongbook'),
        h = p.querySelector('h2').getBoundingClientRect(), row = p.querySelector('.review-row').getBoundingClientRect(), hit = document.elementFromPoint(h.left + 8, (h.top + h.bottom) / 2);
        return { bar, panel: Math.round(p.getBoundingClientRect().top), h2: Math.round(h.top), row: Math.round(row.top), hit: !!hit && !!hit.closest('#wrongbook h2'), y: Math.round(scrollY), end: scrollY >= document.scrollingElement.scrollHeight - innerHeight - 1 }; })()`);
    } finally { await s.close(); }
  }
  /* 面板上緣在頂欄下面一點點(真的捲過去了、沒有留一大段空白);頁面比視窗只高一點、已經捲到底時,面板上緣離頂欄較遠也算(捲不動了) */
  const ok = [1280, 375, 320].every((w) => out[w].y > 0 && out[w].hit && out[w].panel >= out[w].bar && (out[w].panel - out[w].bar < 30 || out[w].end) && out[w].h2 >= out[w].bar && out[w].row >= out[w].bar);
  return { ok, detail: J(out) };
};

/* 手機上「你的答案」「正解」各佔一行,標籤和答案不分開(以前「· 正⏎解：D. …」);桌機也不能把標籤拆開 */
/* 2026-11-19 加:答案整句列出,跟學習記錄一樣不截斷(以前截在 30 字,Part 7、聽力大半的正解看不完整);整句變長了手機照樣不出現橫向捲動 */
T['錯題本 U18:每列「你的答案：…」「正解：…」整句列出不截斷;手機(375、320)各佔一行、標籤和答案同一行、不橫向捲動;桌機標籤不拆開'] = async (B) => {
  const st = wbStudent();
  const L1 = BANK.listening.p1, day = Date.now() - 864e5, l1 = {};
  L1.slice(0, 4).forEach((q, i) => { l1[q.id] = { c: wrongOf(q), ok: false, t: day + i }; });
  const ls = Object.assign({}, st.ls, { [AK('listen_p1')]: J(l1) });
  const CHECK = `(() => {
    const line = (el, n) => { const t = el.firstChild; if (!t || t.nodeType !== 3) return false; const rg = document.createRange(); rg.setStart(t, 0); rg.setEnd(t, Math.min(t.length, n));
      const c = [...rg.getClientRects()].filter((x) => x.width > 0).map((x) => (x.top + x.bottom) / 2); return c.length > 0 && c.every((y) => Math.abs(y - c[0]) < 6); };
    const rows = [...document.querySelectorAll('.wb-ans')];
    let split = 0, same = 0;
    rows.forEach((a) => { const y = a.querySelector('.wb-you'), k = a.querySelector('.wb-key');
      if ((y && !line(y, '你的答案：'.length + 1)) || !line(k, '正解：'.length + 1)) split++;
      if (y && k.getClientRects()[0].top < y.getClientRects()[y.getClientRects().length - 1].bottom - 2) same++; });
    const texts = rows.map((a) => [a.querySelector('.wb-you') ? a.querySelector('.wb-you').textContent : null, a.querySelector('.wb-key').textContent]);
    return { rows: rows.length, split, same, sw: document.documentElement.scrollWidth, texts };
  })()`;
  /* 每個 Part 題庫裡所有「字母. 選項全文」 */
  const QS = { '7': BANK.part7.flatMap((x) => x.questions), '6': BANK.part6.flatMap((x) => x.questions), '1': L1, '2': BANK.listening.p2, '4': BANK.listening.p4.flatMap((x) => x.questions) };
  const FULL = {};
  Object.keys(QS).forEach((p) => { FULL[p] = new Set(QS[p].flatMap((q) => (q.options || []).map((o, i) => 'ABCD'[i] + '. ' + o))); });
  const out = {}, cut = [];
  let long = 0;
  for (const w of [375, 320, 1280]) {
    const s = await open(B, { url: 'practice.html?mode=wrong&part=7', user: true, sdk: fakeCloud({ user: USER }), ls, size: w === 1280 ? null : { width: w, height: 740 } });
    try {
      for (const p of ['7', '6', '1', '2', '4']) {
        if (p !== '7') { await s.go('practice.html?mode=wrong&part=' + p); await sleep(700); }
        await s.eval("document.querySelectorAll('.wb-toggle').forEach((b) => { if (b.getAttribute('aria-expanded') !== 'true') b.click(); }); true");
        const got = await s.eval(CHECK);
        got.texts.forEach(([you, key]) => [[you, '你的答案：'], [key, '正解：']].forEach(([t, lab]) => {
          if (t === null) return;
          const a = t.indexOf(lab) === 0 ? t.slice(lab.length) : null;
          if (a === null || !FULL[p].has(a)) cut.push(w + '/' + p + ' ' + t.slice(0, 60));
          else if (a.length > 33) long++;
        }));
        delete got.texts;
        out[w + '/' + p] = got;
      }
    } finally { await s.close(); }
  }
  const ok = Object.keys(out).every((k) => out[k].rows > 0 && out[k].split === 0 && (/^1280/.test(k) || out[k].same === 0) && out[k].sw <= Number(k.split('/')[0]))
    && cut.length === 0 && long > 0;
  return { ok, detail: J({ cut: cut.length, long, sample: cut.slice(0, 4), out }) };
};

/* 第 i 題(第 i 個 .opts)的第 o 個選項,真的滑鼠點 */
async function pickIn(s, i, o) {
  const ok = await s.eval(`(() => { ${UNPRESS_JS} const g = document.querySelectorAll('.q-block .opts')[${i}]; const e = g && g.querySelectorAll('.opt')[${o}]; if (!e) return false; e.id = '__press'; return true; })()`);
  if (!ok) throw new Error('找不到第 ' + i + ' 題的選項');
  await click(s, '#__press');
  await s.eval(UNPRESS);
}

/* 聽力 3、4 複習整組重答,頂部要寫「這一回 X 組（N 題）」,N 是整組的題數,跟成績頁的分母一樣 */
T['錯題本 U19:聽力 3、4 錯題本複習:作答列的總數是這一回的組數,N 是整組的題數,跟成績卡「x / N」一樣'] = async (B) => {
  const st = wbStudent();
  const L = BANK.listening;
  const sets4 = L.p4.filter((x) => x.type === '機場廣播'), sets3 = L.p3.slice(0, 2);
  const out = {};
  const s = await open(B, { url: 'practice.html?mode=review&part=4&g=' + encodeURIComponent('機場廣播'), user: true, sdk: fakeCloud({ user: USER }), ls: st.ls });
  try {
    for (const [name, url, sets] of [['l4', null, sets4], ['l3', 'practice.html?mode=review&part=3', sets3]]) {
      if (url) { await s.go(url); await sleep(700); }
      const dots = await s.eval(QUIZ_TOTAL);
      for (let u = 0; u < dots; u++) {
        const nq = await s.eval("document.querySelectorAll('.q-block .opts').length");
        for (let i = 0; i < nq; i++) await pickIn(s, i, 0);   // 每一題都點 A(畫面每點一下重畫一次)
        await pressText(s, '.quiz-foot .btn', u === dots - 1 ? '看成績' : '下一題');
      }
      const sum = await s.eval("((document.querySelector('.result-score') || {}).textContent || '').trim()");
      const kicker = await s.eval("(document.querySelector('.result-kicker') || {}).textContent || ''");
      const q = /^\d+ \/ (\d+)$/.exec(sum);
      out[name] = { kicker, dots, sum, want: [sets.length, sets.reduce((k, x) => k + x.questions.length, 0)], q: q ? Number(q[1]) : null };
    }
  } finally { await s.close(); }
  const ok = ['l4', 'l3'].every((k) => { const o = out[k]; return o.dots === o.want[0] && o.q === o.want[1]; })
    && /Part 4/.test(out.l4.kicker) && /Part 3/.test(out.l3.kicker);
  return { ok, detail: J(out) };
};

/* 同名的「查看」「看錯題本」「全部展開」,讀螢幕要分得出是哪個 Part(aria-label 開頭是畫面上的字,WCAG 2.5.3) */
T['錯題本 U20:題庫首頁「查看」、能力分析「看錯題本」「全部展開」的報讀名稱都帶 Part、不重複,開頭是畫面上的字;全部展開按下去名稱跟著變'] = async (B) => {
  const st = wbStudent();
  const r = {};
  const NAMES = (sel) => `[...document.querySelectorAll(${J(sel)})].map((e) => [e.textContent.trim(), e.getAttribute('aria-label') || ''])`;
  const good = (list) => list.length > 1 && list.every(([t, a]) => a.indexOf(t) === 0 && a.length > t.length) && new Set(list.map((x) => x[1])).size === list.length;
  const s = await open(B, { url: 'practice.html', user: true, sdk: fakeCloud({ user: USER }), ls: st.ls });
  try {
    r.see = await s.eval(NAMES('#wrongbook a.btn'));
    await s.go('analysis.html');
    await sleep(1200);
    r.book = await s.eval(`[...document.querySelectorAll('a.btn')].filter((a) => a.textContent === '看錯題本').map((e) => [e.textContent.trim(), e.getAttribute('aria-label') || ''])`);
    r.all = await s.eval(NAMES('.wb-all'));
    await clickNth(s, '.wb-all', 0);
    r.all2 = await s.eval(NAMES('.wb-all'));
  } finally { await s.close(); }
  const ok = good(r.see) && r.see.every(([, a]) => /Part \d/.test(a)) && good(r.book) && good(r.all) && good(r.all2) && r.all2[0][0] === '全部收起' && r.all2[1][0] === '全部展開';
  return { ok, detail: J(r) };
};

/* 2026-11-19:部署前就開著、沒重新整理的舊版分頁(合併表沒有 mock_wrong)會把帳本上的 mock_wrong 整份上傳。
   會寫或顯示錯題本的頁面開頁先跟雲端對齊一次(CLOUD.syncKey('mock_wrong'),跟單字頁、閱讀頁開頁對齊題庫一樣):
   別台考的錯題先進本機,之後就算被舊分頁整份傳上去也還在。本機多的合併後上傳;雲端跟本機一樣時不上傳;畫面照合併後的算 */
T['錯題本 S1:模擬考、每日複習、題庫首頁、錯題本清單、能力分析開頁先跟雲端對齊 mock_wrong:別台的錯題進本機、畫面跟著算,本機多的合併上傳、一樣的不傳;其他鍵不動'] = async (B) => {
  const P5 = BANK.part5, day = Date.now() - 864e5;
  const mine = { [P5[3].id]: { c: wrongOf(P5[3]), ok: false, t: day } };
  const other = { [P5[5].id]: { c: wrongOf(P5[5]), ok: false, t: day + 1000 } };
  const both = Object.keys(Object.assign({}, mine, other)).sort();
  const P5ROW = "(() => { const row = [...document.querySelectorAll('#wrongbook .review-row')].find((x) => /Part 5/.test(x.textContent)); return row ? row.querySelector('b').textContent : ''; })()";
  const PAGES = [
    { url: 'mock.html' },
    { url: 'review.html', shown: "(document.querySelector('.part-card p') || {}).textContent || ''", want: /^待複習 2 題/ },
    { url: 'practice.html', shown: P5ROW, want: /^2 題$/ },
    { url: 'practice.html?mode=wrong&part=5', shown: "(document.querySelector('.wb-sum') || {}).textContent || ''", want: /^2 題/ },
    { url: 'analysis.html', shown: "(() => { const b = document.querySelector('.q-block[data-part=\"5\"]'); return b ? b.firstElementChild.textContent : ''; })()", want: /^Part 5 單句填空2 題/ },
    { url: 'mock.html', same: true },
  ];
  const out = [];
  for (const pg of PAGES) {
    const drill = J(Object.fromEntries(P5.slice(40, 50).map((q) => [q.id, { c: q.answer, ok: true, t: day }])));   // 能力分析滿 10 題才分析
    const ls = { [SB]: login0(), [AK('mock_wrong')]: J(mine), [AK('drill_p5')]: drill };
    const rows = [{ k: 'mock_wrong', v: pg.same ? mine : other, updated_at: new Date(day + 2000).toISOString() }];
    const s = await open(B, { url: pg.url, user: true, sdk: fakeCloud({ user: USER }), ls, ss: { __fake_rows: J(rows) } });
    const r = { url: pg.url + (pg.same ? '(雲端一樣)' : '') };
    try {
      await sleep(300);
      const after = JSON.parse(await s.eval(LS));
      r.local = Object.keys(JSON.parse(after[AK('mock_wrong')] || '{}')).sort();
      r.up = JSON.parse(await s.eval("sessionStorage.getItem('__fake_up') || '[]'")).filter((u) => u.k === 'mock_wrong').map((u) => Object.keys(u.v || {}).sort());
      r.drill = after[AK('drill_p5')] === drill;
      r.led = JSON.parse(after['tr_unsynced_' + UID] || '{}');
      if (pg.shown) r.shown = await s.eval(pg.shown);
    } finally { await s.close(); }
    r.ok = pg.same ? J(r.local) === J(Object.keys(mine)) && !r.up.length && r.drill && !('mock_wrong' in r.led)
      : J(r.local) === J(both) && r.up.length === 1 && J(r.up[0]) === J(both) && r.drill && !('mock_wrong' in r.led) && (!pg.want || pg.want.test(r.shown));
    out.push(r);
  }
  const bad = out.filter((r) => !r.ok);
  return { ok: !bad.length, detail: bad.length ? '不對的:' + J(bad) : J(out.map((r) => r.url + ' ' + (r.shown || '')).join(' / ')) };
};

/* 2026-11-19:能力分析的錯題區。
   每個 Part 的標題列(Part 名稱、題數、看錯題本)在 320 寬也各一行:數字和「題」不拆開、按鈕字不從中間斷(錯題本清單的組標題列同一套,css .wb-head)。
   Part 名稱是標題(h3)、組標題是 h4:報讀用標題跳讀時,從 Part 5 最後一組跳到 Part 6 第一組之前先聽到「Part 6 段落填空」
   (APG Accordion:組標題的層級對應頁面結構;錯題本清單頁 Part 是 h1、組是 h2)。字級、粗細跟以前的 <b> 一樣 */
T['錯題本 U21:能力分析錯題區:每個 Part 的標題列在 320、375、1280 寬三段各一行、不橫向捲動;Part 名稱是 h3、組是 h4,標題順序 h2 錯題 → h3 Part → h4 組;字級粗細跟以前一樣'] = async (B) => {
  const st = wbStudent();
  const LINES = `(() => { const lines = (e) => { const g = document.createRange(); g.selectNodeContents(e); return new Set([...g.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
    return { rows: [...document.querySelectorAll('#analysis-root .q-block[data-part]')].map((b) => [...b.firstElementChild.children].map((c) => c.textContent + ':' + lines(c))),
      wide: document.documentElement.scrollWidth - document.documentElement.clientWidth }; })()`;
  const HEADS = `(() => { const hs = [...document.querySelectorAll('#analysis-root h1, #analysis-root h2, #analysis-root h3, #analysis-root h4, #analysis-root h5, #analysis-root h6')];
    const i = hs.findIndex((x) => x.tagName === 'H2' && x.textContent.trim() === '錯題'); const j = hs.findIndex((x, n) => n > i && x.tagName === 'H2');
    const part = (x) => { const b = x.closest('[data-part]'); return b ? b.dataset.part : ''; };
    const list = hs.slice(i, j < 0 ? hs.length : j);
    let cur = '', sameParent = true;
    list.forEach((x) => { if (x.tagName === 'H3') cur = part(x); else if (x.tagName === 'H4' && part(x) !== cur) sameParent = false; });
    const h3 = list.filter((x) => x.tagName === 'H3');
    const row = h3[0] && h3[0].parentElement;
    return { tags: list.map((x) => x.tagName).join(' ').replace(/(H4 )*H4/g, 'H4…'), h3: h3.map((x) => x.textContent), sameParent,
      wbh: [...document.querySelectorAll('#analysis-root .wb-h')].every((x) => x.tagName === 'H4' && x.children.length === 1 && x.children[0].tagName === 'BUTTON'),
      font: h3.length && row ? [getComputedStyle(h3[0]).fontSize === getComputedStyle(row).fontSize, Number(getComputedStyle(h3[0]).fontWeight) >= 700, getComputedStyle(h3[0]).marginTop, getComputedStyle(h3[0]).marginBottom] : null }; })()`;
  /* Part 名稱每個字(空格分開)各在一行裡:放不下時只在空格換行(「Part 5 / 單句填空」),不拆中文字 */
  const WORDS = `(() => { const t = document.querySelector('#analysis-root .q-block[data-part="5"] h3'); if (!t || !t.firstChild) return null; const s = t.firstChild.textContent; let at = 0;
    const tops = (a, b) => { const g = document.createRange(); g.setStart(t.firstChild, a); g.setEnd(t.firstChild, b); return new Set([...g.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
    return s.split(' ').map((w) => { const n = tops(at, at + w.length); at += w.length + 1; return w + ':' + n; }); })()`;
  const r = {};
  for (const w of [320, 375, 1280]) {
    const s = await open(B, { url: 'analysis.html', user: true, sdk: fakeCloud({ user: USER }), ls: st.ls, size: { width: w, height: 800 }, desktop: w >= 1024 });
    try {
      r['w' + w] = await s.eval(LINES);
      if (w === 375) r.heads = await s.eval(HEADS);
    } finally { await s.close(); }
  }
  /* 三位數題數(Part 5 錯 152 題):320 寬題數、看錯題本照樣一行,Part 名稱只在空格換行;375 寬三段一行 */
  const P5 = BANK.part5, day = Date.now() - 864e5;
  const many = { [SB]: login0(), [AK('drill_p5')]: J(Object.fromEntries(P5.slice(0, 152).map((q, i) => [q.id, { c: wrongOf(q), ok: false, t: day + i }]))) };
  for (const w of [320, 375]) {
    const s = await open(B, { url: 'analysis.html', user: true, sdk: fakeCloud({ user: USER }), ls: many, size: { width: w, height: 800 } });
    try { r['many' + w] = await s.eval(LINES); r['words' + w] = await s.eval(WORDS); } finally { await s.close(); }
  }
  const TITLES = ['Part 5 單句填空', 'Part 6 段落填空', 'Part 7 閱讀理解'];
  const oneLine = (x, n) => x.rows.length === (n || 3) && x.rows.every((cells) => cells.length === 3 && cells.every((c) => /:1$/.test(c))) && x.wide <= 0;
  const m320 = (r.many320 || { rows: [] }).rows[0] || [];
  const hd = r.heads || {};
  const ok = oneLine(r.w320) && oneLine(r.w375) && oneLine(r.w1280)
    && hd.tags === 'H2 H3 H4… H3 H4… H3 H4…' && J(hd.h3) === J(TITLES) && hd.sameParent && hd.wbh
    && J(hd.font) === J([true, true, '0px', '0px'])
    && m320.length === 3 && /^152 題:1$/.test(m320[1]) && /^看錯題本:1$/.test(m320[2]) && /:[12]$/.test(m320[0]) && r.many320.wide <= 0
    && J(r.words320) === J(['Part:1', '5:1', '單句填空:1']) && oneLine(r.many375, 1);
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
