/* 「先看再登入」的無頭 Chrome 測試(站長 2026-10-31 的決定):內容頁沒登入(雲端)、沒選學生(本機)也看得到內容,
   第一次作答時才跳出登入卡或「你是哪位？」,那一下不生效、不寫任何資料,視窗可以關(X、Esc、點遮罩),關掉再作答又跳。
   個人頁(學習記錄、能力分析、每日複習、教師後台)照舊一打開就要登入、關不掉。已登入、已選學生的人行為完全不變。
   兩個本機伺服器:127.0.0.1:8961 雲端模式(js/cloud-config.js 換成假的設定,supabase-js 換成頁面裡的假元件,不連外網),
   127.0.0.1:8962 本機模式(cloud-config 是空的)。用真的滑鼠、鍵盤事件(CDP Input),比對每個動作前後的 localStorage 與畫面。
   用法:node tools/test_open_content.js [--tmp <放 Chrome 使用者資料的資料夾>] [--port <起始埠,預設 8961,用三個>] [--only <測試名稱的一段>]
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

function serve(port, cloud) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
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

async function launch() {
  const dir = fs.mkdtempSync(path.join(TMP, 'open-content-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + DEBUG, '--user-data-dir=' + dir, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + DEBUG + '/json/version'); if (r.ok) return { proc, dir, ws: (await r.json()).webSocketDebuggerUrl }; } catch (e) { /* 還沒好 */ }
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
  await send('Emulation.setDeviceMetricsOverride', o.app ? { width: 375, height: 812, deviceScaleFactor: 1, mobile: true } : { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  if (o.mode !== 'local') await send('Page.addScriptToEvaluateOnNewDocument', { source: fakeSdk(o.user || null, o.delay || 0) });
  if (o.app) await send('Page.addScriptToEvaluateOnNewDocument', { source: STANDALONE });
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
const KEYS = { Enter: { code: 'Enter', keyCode: 13, text: '\r' }, ' ': { code: 'Space', keyCode: 32, text: ' ' }, Escape: { code: 'Escape', keyCode: 27 }, a: { code: 'KeyA', keyCode: 65, text: 'a' } };
async function key(s, k) {
  const d = KEYS[k];
  await s.send('Input.dispatchKeyEvent', { type: d.text ? 'keyDown' : 'rawKeyDown', key: k, code: d.code, windowsVirtualKeyCode: d.keyCode, text: d.text });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: d.code, windowsVirtualKeyCode: d.keyCode });
  await sleep(300);
}
const state = (s) => s.eval(STATE);

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
      /* 閱讀頁的單字考題:字卡拖進空格(pointerdown 起頭)也被擋下 */
      const before = await snap(s);
      const a = await point(s, '.tq-chip', 0), b = await point(s, '.tq-blank', 0);
      await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1 });
      for (let k = 1; k <= 6; k++) await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * k / 6, y: a.y + (b.y - a.y) * k / 6, button: 'left', buttons: 1 });
      await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
      await sleep(400);
      if ((await state(s)).mask) await closeBy(s, 'esc');
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
      const closed = await closeBy(s, 'esc');
      const back = await s.eval("document.activeElement === document.querySelectorAll('.q-block .opt')[1]");
      const ls = lsDiff(before.ls, (await snap(s)).ls);
      out.push({ mode, k, ok: st.mask && st.x && main === before.main && closed && back && !ls.length, st: { mask: st.mask, x: st.x }, back, ls });
    }
    await s.close();
  }
  return { ok: out.every((x) => x.ok), detail: J(out) };
};

/* 已登入、已選學生:跟以前一樣,打開不跳、作答生效、寫進自己的資料夾(包括開頁頭一秒雲端還沒確認登入時) */
T['已登入(雲端)與已選學生(本機):打開不跳視窗,作答照常生效、寫進自己的資料夾;雲端還沒確認登入(頭幾秒)就作答也一樣'] = async (B) => {
  const out = [];
  const user = { id: UID, email: 'student@example.com', user_metadata: { name: '測試' }, app_metadata: { providers: ['email'] } };
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
