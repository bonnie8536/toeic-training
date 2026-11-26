/* 頁尾不在第一屏的無頭 Chrome 測試:
   1. 每一頁有 <footer> 的頁面,在 375×667、375×812、768×1024、1280×720 四種視窗、沒登入(雲端、假的 supabase-js)打開,
      載入完成後頁尾的上緣在視窗外(footer.top ≥ innerHeight);捲到最底頁尾整個看得到(不被 App 分頁列蓋住)。
   2. App 模式(主畫面開啟,navigator.standalone)抽幾頁查同一件事。
   3. 有專心模式的頁(題庫刷題、聽力訓練、模擬考、每日練習、程度檢測舊頁 diagnostic.html 與新頁 placement.html)實際進到作答畫面(本機模式、已選學生):
      頁尾不顯示、捲到底也沒有,題目短時整頁不能捲;結束專心模式後頁尾又出現在頁面最底、仍不在第一屏。
      程度檢測(placement.html)的作答畫面多量 390×844、768×1024、1440×900,App 模式量 375×812、390×844;
      聽力題組(Part 3、Part 4)是先把前面幾格寫進紀錄,打開接著做到那一格再量。
   4. 程度檢測、起始程度、預估分數的其他畫面(STATES:檢測開始頁、兩科中間、結果頁、還沒有結果、「我的」與能力分析的預估分數卡、
      新用戶設定的檢測說明與結果、模擬考交卷後的結果頁)在 375×812、390×844、768×1024、1440×900 與 App 模式(375×812、390×844)查第 1 項同一件事,
      而且要真的畫到那個畫面(sel 找得到)。檢測紀錄用頁面裡真的 ESTIMATE_STORE 寫(本機學生檔案);
      登入的畫面用假雲端(tools/fixtures/lesson_cloud_stub.js,不連外網、不用真的帳號)。
   用法:node tools/test_footer_fold.js [--port <起始埠,預設 9200,用三個:雲端、本機、Chrome 除錯埠>] [--debug-port <埠>]
        [--tmp <放 Chrome 使用者資料的資料夾>] [--pages index.html,daily.html](只量這幾頁) [--only fold|app|quiz|state]
   每次一個新的使用者資料夾,跑完刪掉。其他腳本可以 require 這支拿 serve、launch、connect、open。 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const STUB = require('./fixtures/lesson_cloud_stub.js');

const REPO = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const TMP = path.resolve(opt('--tmp') || os.tmpdir());
const BASE = Number(opt('--port')) || 9200;
const CLOUD_PORT = BASE, LOCAL_PORT = BASE + 1, DEBUG = Number(opt('--debug-port')) || BASE + 2;
const CLOUD = 'http://127.0.0.1:' + CLOUD_PORT, LOCAL = 'http://127.0.0.1:' + LOCAL_PORT;
const ONLY = opt('--only') || '';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.webp': 'image/webp' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
const out = (s) => process.stdout.write(s + '\n');

const SIZES = [{ width: 375, height: 667 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1280, height: 720 }];
/* 程度檢測、起始程度、預估分數的畫面量的視窗;App 模式量前兩種 */
const ADAPT_SIZES = [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }];
const ADAPT_APP = ADAPT_SIZES.slice(0, 2);
const LPID = 'ptest01';
/* 登入的畫面用的假雲端(雲端那個埠的 /__cloud);帳號 id 是假的 */
const CLOUD_DB = STUB.createCloud({});
const USER = (n) => ({ id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), email: 's' + n + '@example.com', user_metadata: { name: '同學' + n }, created_at: '2026-11-20T00:00:00.000Z' });
/* 有頁尾的頁面:repo 根目錄裡含 <footer 的 .html */
const ALL = fs.readdirSync(REPO).filter((f) => f.endsWith('.html') && /<footer[\s>]/.test(fs.readFileSync(path.join(REPO, f), 'utf8'))).sort();
const PAGES = opt('--pages') ? opt('--pages').split(',') : ALL;

/* cloud:true 時 js/cloud-config.js 換成假的設定(配合頁面裡的假 supabase-js,不連外網);false 是本機模式 */
function serve(port, cloud) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      if (cloud && STUB.serveCloud(CLOUD_DB, req, res, 0)) return;
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

async function launch(debugPort) {
  fs.mkdirSync(TMP, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP, 'footer-fold-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + debugPort, '--user-data-dir=' + dir, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + debugPort + '/json/version'); if (r.ok) return { proc, dir, ws: (await r.json()).webSocketDebuggerUrl }; } catch (e) { /* 還沒好 */ }
    await sleep(200);
  }
  throw new Error('Chrome 沒有啟動');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map(), errors = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text);
  };
  const send = (method, params, sessionId) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(J(Object.assign({ id: i, method, params: params || {} }, sessionId ? { sessionId } : {}))); });
  return new Promise((resolve, reject) => { ws.onopen = () => resolve({ ws, send, errors }); ws.onerror = reject; });
}

/* 頁面裡的假 supabase-js(沒登入):loadSdk 看到 window.supabase 就不去 CDN 載 */
const FAKE_SDK = `(() => {
  const res = { data: [], error: null };
  const chain = () => { const p = Promise.resolve(res); return new Proxy(function () {}, { get: (t, k) => k === 'then' ? p.then.bind(p) : k === 'catch' ? p.catch.bind(p) : k === 'finally' ? p.finally.bind(p) : () => chain(), apply: () => chain() }); };
  const base = { getSession: () => Promise.resolve({ data: { session: null }, error: null }) };
  const auth = new Proxy(base, { get: (t, k) => t[k] || (() => Promise.resolve({ data: {}, error: null })) });
  const client = new Proxy({}, { get: (t, k) => k === 'auth' ? auth : k === 'then' ? undefined : () => chain() });
  window.supabase = { createClient: () => client };
})();`;
/* 主畫面 App(加到主畫面後開啟):每頁 head 的開機程式看 navigator.standalone */
const STANDALONE = "Object.defineProperty(navigator, 'standalone', { get: () => true });";

/* 開一個新分頁。o.mode 'cloud'(沒登入;o.user 時用假雲端登入這個帳號)或 'local'(o.profile 時選好學生);o.ls 額外灌的 localStorage */
async function open(B, o) {
  const origin = o.mode === 'local' ? LOCAL : CLOUD;
  const t = await B.send('Target.createTarget', { url: 'about:blank' });
  const targetId = t.result.targetId;
  const sid = (await B.send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  const send = (m, p) => B.send(m, p, sid);
  const s = {
    send,
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error('頁面錯誤:' + J(r.result.exceptionDetails).slice(0, 300));
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    async loaded() { for (let i = 0; i < 150; i++) { try { if ((await s.eval('document.readyState')) === 'complete') return; } catch (e) { /* 換頁中 */ } await sleep(100); } throw new Error('頁面沒載完'); },
    async go(u) { await send('Page.navigate', { url: origin + '/' + u }); await sleep(150); await s.loaded(); },
    async settle() { await s.eval('window.CLOUD && CLOUD.ready ? CLOUD.ready.then(() => true, () => true) : true'); await s.eval('document.fonts.ready.then(() => true)'); await sleep(1200); },
    async shot(file, full) {
      const r = await send('Page.captureScreenshot', Object.assign({ format: 'png' }, full ? { captureBeyondViewport: false } : {}));
      fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    },
    close: () => B.send('Target.closeTarget', { targetId }),
  };
  await send('Page.enable'); await send('Runtime.enable');
  const size = o.size || { width: 375, height: 812 };
  await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.width < 768 });
  if (o.app) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (o.mode !== 'local') await send('Page.addScriptToEvaluateOnNewDocument', { source: o.user ? STUB.sdkScript(o.user) : FAKE_SDK });
  if (o.app) await send('Page.addScriptToEvaluateOnNewDocument', { source: STANDALONE });
  await s.go('robots.txt');
  const seed = Object.assign({}, o.ls || {});
  if (o.profile) { seed.tr_profiles = J([{ id: LPID, name: '小安', created: '2026-10-01' }]); seed.tr_current_profile = J(LPID); }
  if (o.user) seed.tr_current_profile = J('c' + o.user.id.replace(/-/g, ''));
  await s.eval('localStorage.clear(); sessionStorage.clear(); Object.entries(' + J(seed) + ').forEach(([k, v]) => localStorage.setItem(k, v)); true');
  await s.go(o.url);
  await s.settle();
  return s;
}

/* 頁尾的位置:先回到最上面量第一屏,再捲到最底量一次。
   visible:頁尾有沒有畫出來(display 不是 none 而且有高度);bar:底部固定列(App 分頁列)擋住的高度 */
const MEASURE = `(async () => {
  const f = document.querySelector('footer');
  const tab = document.querySelector('.app-tabbar');
  const tr = tab ? tab.getBoundingClientRect() : null;
  const bar = tr && getComputedStyle(tab).display !== 'none' && tr.height > 0 ? Math.round(window.innerHeight - tr.top) : 0;
  const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.scrollTo(0, 0); await wait();
  const cs = f ? getComputedStyle(f) : null;
  const a = f ? f.getBoundingClientRect() : null;
  const mn = document.querySelector('body > main');
  const mr = mn ? mn.getBoundingClientRect() : null;
  if (mn) mn.style.minHeight = '0px';
  const mainNat = mn ? mn.getBoundingClientRect().height : 0;
  if (mn) mn.style.minHeight = '';
  window.scrollTo(0, document.documentElement.scrollHeight); await wait();
  const b = f ? f.getBoundingClientRect() : null;
  const gap = b ? Math.round(document.documentElement.scrollHeight - (window.scrollY + b.bottom)) : null;
  const docH = document.documentElement.scrollHeight;
  const res = { ih: window.innerHeight, bar, has: !!f, display: cs ? cs.display : null, visible: !!f && cs.display !== 'none' && a.height > 0,
    top: a ? Math.round(a.top) : null, bottomAtEnd: b ? Math.round(b.bottom) : null, topAtEnd: b ? Math.round(b.top) : null,
    docH, gap, padB: Math.round(parseFloat(getComputedStyle(document.body).paddingBottom) || 0), quiz: document.documentElement.classList.contains('is-quiz'), tabbar: document.documentElement.classList.contains('has-tabbar'),
    shell: document.documentElement.classList.contains('app-shell'),
    mainTop: mr ? Math.round(mr.top) : null, footMT: cs ? Math.round(parseFloat(cs.marginTop) || 0) : 0, short: !!mr && mainNat + 1 < mr.height };
  window.scrollTo(0, 0); await wait();
  return res;
})()`;
async function measure(s) { return s.eval(MEASURE); }

/* 一般狀態:第一屏看不到頁尾;捲到底整個頁尾看得到(在底部固定列上面) */
function foldProblems(m) {
  const bad = [];
  if (!m.has) return ['沒有 footer'];
  if (!m.visible) bad.push('頁尾沒顯示(display ' + m.display + ')');
  if (m.top < m.ih) bad.push('第一屏看得到頁尾(top ' + m.top + ' < ' + m.ih + ')');
  /* 內容短(main 是被撐高的)時,頁尾就在第一屏下緣外面:main 撐到「視窗高 − 最矮頂欄 53」,只多出頂欄比 53 高的那一截和頁尾的上邊距 */
  if (m.visible && m.short && m.top > m.ih + Math.max(0, m.mainTop - 53) + m.footMT + 2) bad.push('短頁面頁尾離第一屏下緣太遠(top ' + m.top + ',main 從 ' + m.mainTop + ' 開始)');
  if (m.visible && m.bottomAtEnd > m.ih - m.bar + 1) bad.push('捲到底頁尾被蓋住(bottom ' + m.bottomAtEnd + ' > ' + (m.ih - m.bar) + ')');
  if (m.visible && m.topAtEnd >= m.ih - m.bar) bad.push('捲到底還是看不到頁尾');
  return bad;
}

/* 專心模式:進得去,頁尾不顯示 */
function quizProblems(m) {
  const bad = [];
  if (!m.quiz) bad.push('沒有進到專心模式');
  if (m.visible) bad.push('作答中看得到頁尾(display ' + m.display + ',top ' + m.top + ')');
  return bad;
}

/* 作答畫面怎麼進去:url 直接開考;click 是開頁後要按的按鈕(文字) */
const QUIZ = [
  { name: '題庫刷題', url: 'practice.html?part=5' },
  { name: '聽力訓練', url: 'listening.html?sec=mp' },
  { name: '每日練習', url: 'daily.html?part=v' },
  { name: '程度檢測', url: 'diagnostic.html', ls: { ['tr_u' + LPID + '_diag']: J({ answers: {}, done: false, startedAt: '2026-11-01T00:00:00.000Z' }) } },
  { name: '模擬考', url: 'mock.html', click: '開始' },
  { name: '程度檢測(新頁)', url: 'placement.html', click: '開始', adapt: true },
  { name: '程度檢測 只做閱讀', url: 'placement.html?sec=R', click: '開始', adapt: true },
  { name: '程度檢測 先做閱讀', url: 'placement.html', click: '沒有耳機，先做閱讀', adapt: true },
  { name: '程度檢測 從新用戶設定直接開考', url: 'placement.html?start=1&from=onboard', adapt: true },
  { name: '程度檢測 中途離開後接著做', url: 'placement.html', seed: 'midway', adapt: true },
  /* 聽力題組:前面幾格先寫進紀錄(listenAt),打開就接著做到 Part 3／Part 4 那一格;part 是畫面上該看到的 Part */
  { name: '程度檢測 聽力題組 Part 3', url: 'placement.html', seed: 'p3', adapt: true, part: '3' },
  { name: '程度檢測 聽力題組 Part 4', url: 'placement.html', seed: 'p4', adapt: true, part: '4' },
];
async function enterQuiz(s, q) {
  if (q.click) {
    await s.eval(`(() => { const b = [...document.querySelectorAll('main button')].find((e) => e.textContent.trim() === ${J(q.click)}); if (b) b.click(); return !!b; })()`);
    await sleep(1500);
  }
  /* 程度檢測開考前要先讀存檔、挑題:等到進專心模式(最多 6 秒),進不去由 quizProblems 報 */
  if (q.adapt) for (let i = 0; i < 30 && !(await s.eval("document.documentElement.classList.contains('is-quiz')")); i++) await sleep(200);
}

/* ---------- 程度檢測與預估分數的紀錄:用頁面裡真的 ESTIMATE_STORE 寫,寫完把 localStorage 整份拿出來,之後開頁灌回去 ---------- */
const PARTS = { L: [['l1', 2], ['l2', 4], ['l3', 3], ['l4', 3]], R: [['p5', 4], ['p6', 4], ['p7', 4]] };
/* 開始一次兩科的檢測;secs 是做完的科,n 是另外在下一科先送出幾題(中途離開),finish 是整次結束 */
const RUN = (secs, n, finish) => `(async () => {
  if (window.CLOUD && CLOUD.ready) await CLOUD.ready.catch(() => null);
  const S = ESTIMATE_STORE, keys = Object.keys(ITEM_PARAMS.b), parts = ${J(PARTS)};
  const r = await S.startRun({ sec: 'LR' });
  if (!r || !r.run) return false;
  const at = r.run.at, used = new Set();
  const take = (s, max) => {
    let i = 0;
    parts[s].forEach(([p, k]) => keys.filter((x) => x.indexOf(p + '-') === 0 && !r.fa.i[x] && !used.has(x)).slice(0, k).forEach((key) => {
      if (i >= max) return;
      used.add(key);
      S.answer(at, [{ s, key, choice: 0, ok: i++ % 3 === 2 ? 0 : 1, secs: 20 }]);
    }));
  };
  for (const s of ${J(secs)}) { S.beginSection(at, s); take(s, 99); S.endSection(at, s); }
  const next = ${J(secs)}.length === 1 ? (${J(secs)}[0] === 'R' ? 'L' : 'R') : null;
  if (next && ${n} > 0) { S.beginSection(at, next); take(next, ${n}); }
  if (${finish}) await S.finishRun(at);
  return true;
})()`;
/* 聽力做到一半:Part 1 兩格、Part 2 四格(part 是 '4' 時再加 Part 3 一組三題)先答完,停在下一格;沒有結束這一科 */
const LISTEN_AT = (part) => `(async () => {
  if (window.CLOUD && CLOUD.ready) await CLOUD.ready.catch(() => null);
  const S = ESTIMATE_STORE, keys = Object.keys(ITEM_PARAMS.b);
  const r = await S.startRun({ sec: 'LR' });
  if (!r || !r.run) return false;
  const at = r.run.at, unit = (k) => k.split(':')[0];
  const units = (p, n) => [...new Set(keys.filter((k) => k.indexOf(p + '-') === 0 && !r.fa.i[k]).map(unit))].slice(0, n);
  const plan = [['l1', 2], ['l2', 4]].concat(${J(part)} === '4' ? [['l3', 1]] : []);
  S.beginSection(at, 'L');
  let i = 0;
  plan.forEach(([p, n]) => units(p, n).forEach((u) => keys.filter((k) => unit(k) === u).forEach((key) => {
    S.answer(at, [{ s: 'L', key, choice: 0, ok: i++ % 3 === 2 ? 0 : 1, secs: 20 }]);
  })));
  return true;
})()`;
const DUMP = 'JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))';
async function waitFor(s, expr, ms) {
  for (let i = 0; i < (ms || 15000) / 200; i++) { try { if (await s.eval(expr)) return true; } catch (e) { /* 換頁中 */ } await sleep(200); }
  return false;
}
/* 本機學生檔案:先做閱讀、停在兩科中間(between);閱讀做完、聽力做了 4 題離開(midway);兩科做完(result) */
async function localSeed(B, secs, n, finish, script) {
  const s = await open(B, { mode: 'local', profile: true, url: 'placement.html?view=last' });
  const ok = await s.eval(script || RUN(secs, n, finish));
  const ls = JSON.parse(await s.eval(DUMP));
  await s.close();
  if (!ok) throw new Error('檢測紀錄寫不進去(' + secs.join('') + ')');
  return ls;
}
/* 登入的新用戶:新用戶設定記下「開始檢測」→ 兩科做完 → 回設定流程的結果頁,用預估對回四級 */
async function accountSeed(B, u) {
  const s = await open(B, { mode: 'cloud', user: u, url: 'start.html?step=test' });
  const st = await s.eval('ONBOARD_DATA.startTest()');
  await s.go('placement.html?view=last'); await s.settle();
  const ok = await s.eval(RUN(['L', 'R'], 0, true));
  await s.go('start.html?step=result'); await s.settle();
  const drawn = await waitFor(s, "!!document.querySelector('.result-card') && !document.querySelector('.ob-loading')", 20000);
  const ls = JSON.parse(await s.eval(DUMP));
  await s.close();
  if (st !== 'ok' || !ok || !drawn) throw new Error('新用戶設定的結果頁沒做出來(startTest ' + st + ',檢測 ' + ok + ',結果頁 ' + drawn + ')');
  return ls;
}
async function makeSeeds(B) {
  const old = '2026-10-20T00:00:00.000Z', answers = {};
  for (let i = 0; i < 28; i++) answers[i] = i % 4;
  CLOUD_DB.put(USER(33).id, 'diag', { answers, done: true, startedAt: old, finishedAt: old }, old);   // 舊使用者:只有舊 28 題
  return {
    between: await localSeed(B, ['R'], 0, false),
    midway: await localSeed(B, ['R'], 4, false),
    result: await localSeed(B, ['L', 'R'], 0, true),
    p3: await localSeed(B, ['L'], 0, false, LISTEN_AT('3')),
    p4: await localSeed(B, ['L'], 0, false, LISTEN_AT('4')),
    account: await accountSeed(B, USER(31)),
  };
}

/* 程度檢測、起始程度、預估分數的畫面:sel 是這個畫面一定有的元素(找不到表示沒畫到,不算通過) */
const STATES = [
  { name: '程度檢測 開始頁(沒登入)', url: 'placement.html', sel: '.pl-intro' },
  { name: '程度檢測 開始頁(從新用戶設定來)', url: 'placement.html?from=onboard', local: true, sel: '.pl-intro' },
  { name: '程度檢測 只做閱讀的開始頁', url: 'placement.html?sec=R', local: true, sel: '.pl-intro' },
  { name: '程度檢測 兩科中間', url: 'placement.html', local: true, seed: 'between', sel: '.pl-between' },
  { name: '程度檢測 結果頁', url: 'placement.html?view=last', local: true, seed: 'result', sel: '#pl-root .result-card' },
  { name: '程度檢測 還沒有結果', url: 'placement.html?view=last', local: true, sel: '#pl-root .ui-empty' },
  { name: '我的 預估分數卡', url: 'me.html', local: true, seed: 'result', sel: '.est-card' },
  { name: '能力分析 預估分數卡', url: 'analysis.html', local: true, seed: 'result', sel: '.est-card' },
  { name: '新用戶設定 檢測說明', url: 'start.html?step=test', user: 32, sel: '.diag-intro' },
  { name: '新用戶設定 檢測說明(只做聽力)', url: 'start.html?step=test', user: 33, sel: '.diag-intro' },
  { name: '新用戶設定 結果(預估分數對回級別)', url: 'start.html?step=result', user: 31, seed: 'account', sel: '.result-card' },
  /* 模擬考交卷後的結果頁(標題旁有 ⓘ):開始後直接交卷(沒作答也能交),結果出來時已經離開專心模式 */
  { name: '模擬考 交卷後的結果頁', url: 'mock.html', local: true, sel: '#mock-root .result-card', act: mockSubmit },
];
async function mockSubmit(s) {
  const click = (expr) => s.eval('(() => { const b = ' + expr + '; if (b) b.click(); return !!b; })()');
  await click("[...document.querySelectorAll('main button')].find((e) => e.textContent.trim() === '開始')");
  await waitFor(s, "!!document.querySelector('.quiz-bar')", 8000);
  await sleep(600);
  await click("[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '交卷' && x.offsetParent !== null)");
  await waitFor(s, "!!document.querySelector('.ui-dialog .ui-dialog-ok')", 8000);
  await sleep(400);
  await click("document.querySelector('.ui-dialog .ui-dialog-ok')");
}
function stateOpts(st, seeds, size, app) {
  const o = { url: st.url, size, app, ls: st.seed ? seeds[st.seed] : undefined };
  if (st.local) return Object.assign(o, { mode: 'local', profile: true });
  return Object.assign(o, { mode: 'cloud', user: st.user ? USER(st.user) : undefined });
}
async function runState(B, results, seeds) {
  for (const st of STATES) for (const app of [false, true]) for (const size of app ? ADAPT_APP : ADAPT_SIZES) {
    if (opt('--pages') && !PAGES.includes(st.url.split('?')[0])) continue;
    const s = await open(B, stateOpts(st, seeds, size, app));
    if (st.act) await st.act(s);
    const drawn = await waitFor(s, 'document.querySelector(' + J(st.sel) + ') !== null', 8000);
    await sleep(300);
    const m = await measure(s);
    await s.close();
    const bad = foldProblems(m);
    if (!drawn) bad.unshift('沒有畫到這個畫面(找不到 ' + st.sel + ')');
    if (app && !m.shell) bad.push('沒有進到 App 外殼');
    results.push({ name: 'state ' + size.width + '×' + size.height + (app ? ' App' : '') + ' ' + st.name, bad, m });
  }
}

async function runFold(B, results) {
  for (const size of SIZES) for (const p of PAGES) {
    const s = await open(B, { mode: 'cloud', url: p, size });
    const m = await measure(s);
    await s.close();
    results.push({ name: 'fold ' + size.width + '×' + size.height + ' ' + p, bad: foldProblems(m), m });
  }
}

async function runApp(B, results) {
  const pages = ['index.html', 'daily.html', 'learn.html', 'practice.html', 'me.html', 'pricing.html', 'mock.html'].filter((p) => PAGES.includes(p));
  for (const size of [{ width: 375, height: 667 }, { width: 375, height: 812 }]) for (const p of pages) {
    const s = await open(B, { mode: 'cloud', url: p, size, app: true });
    const m = await measure(s);
    await s.close();
    const bad = foldProblems(m);
    if (!m.shell) bad.push('沒有進到 App 外殼');
    results.push({ name: 'app ' + size.width + '×' + size.height + ' ' + p + (m.tabbar ? '(分頁列)' : ''), bad, m });
  }
}

/* 一般的作答畫面量 375×812、1280×720 與 App 375×812;程度檢測(adapt)量 ADAPT_SIZES 與 App ADAPT_APP */
const QUIZ_SIZES = [{ width: 375, height: 812 }, { width: 1280, height: 720 }];
async function runQuiz(B, results, seeds) {
  const runs = [];
  for (const size of QUIZ_SIZES) for (const app of [false, true]) for (const q of QUIZ) if (!q.adapt && !(app && size.width > 860)) runs.push({ q, size, app });
  for (const q of QUIZ) if (q.adapt) for (const app of [false, true]) for (const size of app ? ADAPT_APP : ADAPT_SIZES) runs.push({ q, size, app });
  for (const { q, size, app } of runs) {
    if (opt('--pages') && !PAGES.includes(q.url.split('?')[0])) continue;
    const s = await open(B, { mode: 'local', profile: true, url: q.url, size, app, ls: q.seed ? seeds[q.seed] : q.ls });
    await enterQuiz(s, q);
    const m = await measure(s);
    const bad = quizProblems(m);
    if (q.part) {
      const shown = await s.eval("(() => { const b = document.querySelector('#pl-root .pl-meta .badge'); return b ? b.textContent.trim() : null; })()");
      if (shown !== 'Part ' + q.part) bad.push('沒有接到 Part ' + q.part + '(畫面是 ' + shown + ')');
    }
    /* 題目短的時候不能捲:撐高 main 之後的頁面高度不能超過「視窗高」與「main 不撐高時的內容高」兩者較大的那個 */
    const natural = await s.eval(`(() => { const mn = document.querySelector('body > main'); mn.style.minHeight = '0px';
      const h = document.documentElement.scrollHeight; mn.style.minHeight = ''; return h; })()`);
    if (m.docH > Math.max(m.ih, natural)) bad.push('題目短也能捲(頁高 ' + m.docH + ' > 視窗 ' + m.ih + ',內容只要 ' + natural + ')');
    /* 結束專心模式(作答列的關閉鈕會換頁,這裡直接收掉專心模式,看同一頁的頁尾回來);頁尾下面只能剩 body 的底部留白(分頁列、小雞那一條) */
    const left = await s.eval('(() => { const f = window.UI && UI.focus && UI.focus.active; if (f) f.leave(); return !document.documentElement.classList.contains("is-quiz"); })()');
    await sleep(300);
    const after = await measure(s);
    await s.close();
    if (!left) bad.push('專心模式收不掉');
    foldProblems(after).forEach((x) => bad.push('離開作答後:' + x));
    if (after.visible && after.gap > after.padB + 8) bad.push('離開作答後頁尾不在最底(底下還有 ' + after.gap + 'px)');
    results.push({ name: 'quiz ' + size.width + '×' + size.height + (app ? ' App' : '') + ' ' + q.name, bad, m: { during: m, after } });
  }
}

async function main() {
  if (!CHROME) { out('找不到 Chrome 或 Edge'); process.exit(2); }
  const srvs = [await serve(CLOUD_PORT, true), await serve(LOCAL_PORT, false)];
  const L = await launch(DEBUG);
  const results = [];
  let B = null;
  try {
    B = await connect(L.ws);
    if (!ONLY || ONLY === 'fold') await runFold(B, results);
    if (!ONLY || ONLY === 'app') await runApp(B, results);
    const seeds = !ONLY || ONLY === 'quiz' || ONLY === 'state' ? await makeSeeds(B) : null;
    if (!ONLY || ONLY === 'quiz') await runQuiz(B, results, seeds);
    if (!ONLY || ONLY === 'state') await runState(B, results, seeds);
  } finally {
    if (B) B.ws.close();
    L.proc.kill();
    srvs.forEach((x) => x.close());
    await sleep(1000);
    try { fs.rmSync(L.dir, { recursive: true, force: true }); } catch (e) { out('使用者資料夾沒刪掉:' + L.dir); }
  }
  let pass = 0;
  for (const r of results) {
    if (!r.bad.length) pass++;
    else out('FAIL ' + r.name + '  →  ' + r.bad.join(';'));
  }
  const failPages = new Set(results.filter((r) => r.bad.length && r.name.startsWith('fold ')).map((r) => r.name.split(' ').pop()));
  out(pass + ' / ' + results.length + ' 通過' + (failPages.size ? '(第一屏看得到頁尾的頁:' + failPages.size + ' 頁)' : ''));
  if (B && B.errors.length) out('頁面 JS 錯誤 ' + B.errors.length + ' 個(只列出,不算失敗):' + B.errors.slice(0, 5).map((e) => String(e).split('\n')[0]).join(' | '));
  process.exitCode = pass === results.length ? 0 : 1;
}

if (require.main === module) main().then(() => setTimeout(() => process.exit(process.exitCode || 0), 300), (e) => { out(String(e && e.stack || e)); process.exit(2); });
module.exports = { serve, launch, connect, open, measure, enterQuiz, QUIZ, STATES, makeSeeds, stateOpts, CLOUD_PORT, LOCAL_PORT, DEBUG };
