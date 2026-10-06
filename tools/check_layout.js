/* 網站版面回歸檢查:用本機的 Chrome(無頭模式)量各頁在手機與桌機寬度下的關鍵元素位置,
   跟 tools/layout_baseline.json 比對。用來確認「網站模式改動前後完全一樣」,也順便抓頁面上的 JS 錯誤。
   不用安裝任何套件(Node 22+ 內建 WebSocket)。

   用法:
     node tools/check_layout.js                 比對目前的檔案和基準,有差異或有 JS 錯誤就 exit 1
     node tools/check_layout.js --save          把目前的量測存成新基準(只有「刻意改版面」時才做,並在 commit 說明)
     node tools/check_layout.js --root <資料夾>  量別的資料夾(例如舊版本的匯出)
     node tools/check_layout.js --pages index.html,grammar.html  只量這幾頁 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const BASELINE = path.join(__dirname, 'layout_baseline.json');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : null; };
const ROOT = path.resolve(opt('--root') || REPO);
const SAVE = args.includes('--save');
const WIDTHS = [375, 1280];
const PAGES = (opt('--pages') || 'index.html,learn.html,drill.html,me.html,grammar.html,phonics.html,practice.html,reading.html,dialogue.html,grammar.html?ref=tenses,listening.html,vocab.html,grammar.html?ref=verbs,writing.html,review.html,history.html,analysis.html,diagnostic.html,mock.html,signup.html,terms.html,reset.html,offline.html').split(',');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
  .find((p) => fs.existsSync(p));
const PORT = 8846, DEBUG_PORT = 9346;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };

/* 每頁量的東西:位置取 [x, y(含捲動), 寬, 高] */
const PROBE = `(() => {
  const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)]; };
  const modal = document.querySelector('.modal-auth');
  return { cls: document.documentElement.className, topbar: q('.topbar'), inner: q('.topbar-inner'), brand: q('.brand'),
    topnav: q('.topnav'), profile: q('.profile-widget'), main: q('main'), h1: q('h1'), footer: q('footer'),
    mask: q('.modal-mask'), modal: q('.modal-auth'), aria: modal && modal.getAttribute('aria-modal'),
    bodyH: document.body.scrollHeight, shell: document.querySelectorAll('.app-tabbar,.app-back,.app-title').length };
})()`;

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, p);
      if (!path.resolve(file).startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(buf);
      });
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-layout-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + DEBUG_PORT, '--user-data-dir=' + dir,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/version'); if (r.ok) return { proc, dir }; } catch (e) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Chrome 沒有啟動');
}

async function openPage() {
  const r = await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/new?about:blank', { method: 'PUT' });
  const { webSocketDebuggerUrl } = await r.json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map(), errors = [];
  let loaded = null;
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text);
    if (msg.method === 'Page.loadEventFired' && loaded) { loaded(); loaded = null; }
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  return {
    errors,
    async measure(url, width) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      const done = new Promise((res) => { loaded = res; });
      await send('Page.navigate', { url });
      await Promise.race([done, new Promise((r) => setTimeout(r, 15000))]);
      await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true });
      await new Promise((r) => setTimeout(r, 2000));
      const out = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
      return out.result.result.value;
    },
    close() { ws.close(); },
  };
}

(async () => {
  if (!CHROME) { console.error('找不到 Chrome 或 Edge'); process.exit(2); }
  const srv = await serve();
  const { proc, dir } = await launch();
  const now = {}, jsErrors = [];
  try {
    const page = await openPage();
    for (const w of WIDTHS) for (const p of PAGES) {
      if (!fs.existsSync(path.join(ROOT, p))) continue;
      const before = page.errors.length;
      now[w + ' ' + p] = await page.measure('http://127.0.0.1:' + PORT + '/' + p, w);
      page.errors.slice(before).forEach((e) => jsErrors.push(w + ' ' + p + ': ' + String(e).split('\n')[0]));
    }
    page.close();
  } finally {
    proc.kill(); srv.close();
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }, 1000);
  }

  if (SAVE) {
    fs.writeFileSync(BASELINE, JSON.stringify(now, null, 1) + '\n');
    console.log('已存基準:' + Object.keys(now).length + ' 項 → ' + path.relative(REPO, BASELINE));
  } else {
    const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
    let same = 0; const diffs = [];
    for (const k of Object.keys(now)) {
      if (!base[k]) { diffs.push(k + ':基準裡沒有這頁(新頁面?)'); continue; }
      const d = Object.keys(now[k]).filter((f) => JSON.stringify(now[k][f]) !== JSON.stringify(base[k][f]))
        .map((f) => f + ' ' + JSON.stringify(base[k][f]) + ' → ' + JSON.stringify(now[k][f]));
      if (d.length) diffs.push(k + ':' + d.join(';')); else same++;
    }
    Object.keys(base).filter((k) => !now[k] && PAGES.includes(k.split(' ')[1])).forEach((k) => diffs.push(k + ':這次沒量到(頁面被刪了?)'));
    console.log('版面相同 ' + same + ' / ' + Object.keys(now).length);
    diffs.forEach((d) => console.log('差異 ' + d));
    if (jsErrors.length) { console.log('頁面 JS 錯誤 ' + jsErrors.length + ' 個:'); jsErrors.forEach((e) => console.log('  ' + e)); }
    process.exitCode = diffs.length || jsErrors.length ? 1 : 0;
  }
  setTimeout(() => process.exit(process.exitCode || 0), 1500);
})().catch((e) => { console.error(e); process.exit(2); });
