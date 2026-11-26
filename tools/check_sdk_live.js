/* 無頭 Chrome 真的從 CDN 載 supabase-js(要連網路,不登入、不連 Supabase):
   1. 本機伺服器開 index.html(雲端模式,js/cloud-config.js 換成假的專案網址):js/cloud.js 建的 script 載入成功、window.supabase 可以用、
      CLOUD.client 建好了,主控台沒有 integrity 的錯誤。
   2. 同一個網址的回應被改掉一個字(用 CDP 的 Fetch 攔下來改):瀏覽器擋下、window.supabase 不存在、CLOUD.client 是 null,
      證明 integrity 真的有在檢查。
   用法:node tools/check_sdk_live.js [--port <本機伺服器的埠,預設 9396>] [--debug-port <Chrome 除錯埠,預設 port+1>] [--tmp <放 Chrome 使用者資料的資料夾>]
   Chrome 的使用者資料夾每次新建,跑完刪掉。 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { serve, connect } = require('./test_footer_fold.js');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const PORT = Number(opt('--port')) || 9396, DEBUG = Number(opt('--debug-port')) || PORT + 1;
const TMP = path.resolve(opt('--tmp') || os.tmpdir());
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (s) => process.stdout.write(s + '\n');

async function launch() {
  fs.mkdirSync(TMP, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP, 'sdk-live-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + DEBUG, '--user-data-dir=' + dir, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + DEBUG + '/json/version'); if (r.ok) return { proc, dir, ws: (await r.json()).webSocketDebuggerUrl }; } catch (e) { /* 還沒好 */ }
    await sleep(200);
  }
  throw new Error('Chrome 沒有啟動');
}

/* 開 index.html,回 { loaded, client, integrity, crossOrigin, src, logs }。tamper:CDN 的回應改掉一個字再交給頁面 */
async function run(B, tamper) {
  const t = await B.send('Target.createTarget', { url: 'about:blank' });
  const sid = (await B.send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true })).result.sessionId;
  const send = (m, p) => B.send(m, p, sid);
  const logs = [];
  const prev = B.ws.onmessage;
  B.ws.onmessage = async (m) => {
    const msg = JSON.parse(m.data);
    if (msg.sessionId === sid && msg.method === 'Log.entryAdded') logs.push(msg.params.entry.level + ' ' + msg.params.entry.text);
    if (msg.sessionId === sid && msg.method === 'Runtime.consoleAPICalled') logs.push(msg.params.type + ' ' + msg.params.args.map((a) => a.value || a.description || '').join(' '));
    if (msg.sessionId === sid && msg.method === 'Fetch.requestPaused') {
      const p = msg.params;
      const body = await send('Fetch.getResponseBody', { requestId: p.requestId });
      const text = body.result.base64Encoded ? Buffer.from(body.result.body, 'base64').toString('utf8') : body.result.body;
      const changed = text.replace(/createClient/, 'createClienT');
      send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: p.responseStatusCode, responseHeaders: p.responseHeaders,
        body: Buffer.from(changed, 'utf8').toString('base64') });
      return;
    }
    prev(m);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  if (tamper) await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase-js@*', requestStage: 'Response' }] });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
  for (let i = 0; i < 100 && (await ev('document.readyState')) !== 'complete'; i++) await sleep(100);
  const res = await ev(`(async () => {
    await Promise.race([window.CLOUD && CLOUD.ready ? CLOUD.ready.then(() => 0, () => 0) : 0, new Promise((r) => setTimeout(r, 20000))]);
    const s = Array.from(document.scripts).find((x) => /supabase-js@/.test(x.src));
    return { loaded: !!(window.supabase && typeof window.supabase.createClient === 'function'), client: !!(window.CLOUD && CLOUD.client),
      src: s ? s.src : null, integrity: s ? s.integrity : null, crossOrigin: s ? s.crossOrigin : null };
  })()`);
  await sleep(300);
  await B.send('Target.closeTarget', { targetId: t.result.targetId });
  B.ws.onmessage = prev;
  return Object.assign(res || {}, { logs });
}

async function main() {
  if (!CHROME) throw new Error('找不到 Chrome');
  const srv = await serve(PORT, true);
  const C = await launch();
  let fail = 0;
  try {
    const B = await connect(C.ws);
    const ok = await run(B, false);
    const intErr = ok.logs.filter((l) => /integrity/i.test(l));
    const p1 = ok.loaded && ok.client && /^sha384-/.test(ok.integrity || '') && ok.crossOrigin === 'anonymous' && /@\d+\.\d+\.\d+\//.test(ok.src || '') && !intErr.length;
    if (!p1) fail++;
    out((p1 ? 'PASS ' : 'FAIL ') + '真的從 CDN 載入:函式庫可以用、連線建好、主控台沒有 integrity 錯誤  →  ' + JSON.stringify({ src: ok.src, loaded: ok.loaded, client: ok.client, crossOrigin: ok.crossOrigin, integrityErrors: intErr }));
    const bad = await run(B, true);
    const blocked = bad.logs.some((l) => /integrity/i.test(l));
    const p2 = !bad.loaded && !bad.client && blocked;
    if (!p2) fail++;
    out((p2 ? 'PASS ' : 'FAIL ') + '回應被改掉一個字:瀏覽器擋下,函式庫不執行  →  ' + JSON.stringify({ loaded: bad.loaded, client: bad.client, log: bad.logs.filter((l) => /integrity/i.test(l)).slice(0, 1) }));
    B.ws.close();
  } finally {
    srv.close();
    C.proc.kill();
    await sleep(800);
    try { fs.rmSync(C.dir, { recursive: true, force: true }); } catch (e) { out('使用者資料夾刪不掉:' + C.dir); }
  }
  out((2 - fail) + ' / 2 通過');
  process.exitCode = fail ? 1 : 0;
}
main().then(() => setTimeout(() => process.exit(process.exitCode || 0), 300), (e) => { out(String(e && e.stack || e)); process.exit(2); });
