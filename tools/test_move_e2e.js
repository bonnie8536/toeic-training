/* 搬家的無頭 Chrome 測試(搬家計畫 7.4):127.0.0.1:8931 當舊網址、localhost:8932 當新網址(兩個不同的網域,js/move-config.js 寫死這兩個),
   127.0.0.1:8933 當冒充的網站。用真的滑鼠點擊(window.open 要使用者的點擊)。
   不連外網:js/cloud-config.js 換成空的(不載 Supabase),其他網域一律解析不到。
   情境:訪客搬家、新網址已經有資料(題庫同 id 不同內容)、同一包再搬、搬家碼貼上、其他分頁開著要先關、冒充的網站送來的包不收、
   4 MB 的大包、舊網址每一頁的提示與搬完之後帶走、寫到一半被關掉之後還原。
   用法:node tools/test_move_e2e.js [--tmp <放 Chrome 使用者資料的資料夾>] [--only <測試名稱的一段>]   每次一個新的使用者資料夾,跑完刪掉。 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const args = process.argv.slice(2);
const TMP = path.resolve(args.indexOf('--tmp') > -1 ? args[args.indexOf('--tmp') + 1] : os.tmpdir());
const OLD = 'http://127.0.0.1:8931', NEW = 'http://localhost:8932', EVIL = 'http://127.0.0.1:8933';
const PORTS = [8931, 8932, 8933], DEBUG = 8934;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* 新網址的 move-ping.txt:'ok' 照常、'down' 回 503(新網址連不上) */
let PING = 'ok';
/* 新網址的 move-in.html:DROP_MOVE_IN = n 時,從現在起第 n 次以後的請求都直接切斷連線(自動搬家第二次進收件頁、帶著密文的那一站連不上) */
let DROP_MOVE_IN = 0, moveInHits = 0;

const EVIL_PAGE = `<!doctype html><meta charset="utf-8"><body><button id="go">go</button><script>
document.getElementById('go').onclick = () => {
  const w = window.open('${NEW}/move-in.html', '_blank');
  const pack = { app: 'rushup-move', v: 1, keys: [['tr_hist', '[{"m":"p5","id":"evil","c":1,"ok":true,"t":1}]']], accounts: {} };
  window.addEventListener('message', (ev) => { if (ev.data && ev.data.type === 'hello') { window.__hello = (window.__hello || 0) + 1; w.postMessage({ type: 'pack', nonce: ev.data.nonce, hash: 'a'.repeat(64), pack }, '*'); } });
};
</script>`;

function serve(port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (port === 8933) { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(EVIL_PAGE); }
      if (p === '/') p = '/index.html';
      if (port === 8932 && p === '/move-in.html' && DROP_MOVE_IN && ++moveInHits >= DROP_MOVE_IN) { req.socket.destroy(); return; }
      if (port === 8932 && p === '/move-ping.txt' && PING === 'down') { res.writeHead(503, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); return res.end('down'); }
      if (p === '/js/cloud-config.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }); return res.end('window.CLOUD_CONFIG = {};'); }
      const file = path.join(REPO, p);
      if (!path.resolve(file).startsWith(REPO)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        const h = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
        if (p === '/move-ping.txt') h['Access-Control-Allow-Origin'] = '*';
        res.writeHead(200, h);
        res.end(buf);
      });
    });
    srv.on('error', (e) => reject(new Error('埠 ' + port + ' 不能用(' + e.code + '),先關掉占用它的程式')));
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

async function launch() {
  const dir = fs.mkdtempSync(path.join(TMP, 'move-e2e-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + DEBUG, '--user-data-dir=' + dir, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-popup-blocking', '--host-resolver-rules=MAP localhost 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:' + DEBUG + '/json/version'); if (r.ok) return { proc, dir, ws: (await r.json()).webSocketDebuggerUrl }; } catch (e) { /* 還沒好 */ }
    await sleep(200);
  }
  throw new Error('Chrome 沒有啟動');
}

/* 瀏覽器層的 CDP 連線;每個分頁用 flatten 的 session */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map(), created = [], errors = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); return; }
    if (msg.method === 'Target.targetCreated' && msg.params.targetInfo.type === 'page') created.push(msg.params.targetInfo);
    if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text);
  };
  const send = (method, params, sessionId) => new Promise((res) => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify(Object.assign({ id: i, method, params: params || {} }, sessionId ? { sessionId } : {}))); });
  return new Promise((resolve, reject) => {
    ws.onopen = async () => { await send('Target.setDiscoverTargets', { discover: true }); resolve({ ws, send, created, errors }); };
    ws.onerror = reject;
  });
}
async function tab(B, url) {
  const t = await B.send('Target.createTarget', { url: 'about:blank' });
  return attach(B, t.result.targetId, url);
}
async function attach(B, targetId, url) {
  const a = await B.send('Target.attachToTarget', { targetId, flatten: true });
  const sid = a.result.sessionId;
  const s = {
    targetId, sid,
    send: (m, p) => B.send(m, p, sid),
    async eval(expr) {
      const r = await B.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      if (r.result && r.result.exceptionDetails) throw new Error('頁面錯誤:' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result && r.result.result ? r.result.result.value : undefined;
    },
    async go(u) { await B.send('Page.navigate', { url: u }, sid); await s.loaded(); },
    async loaded() { for (let i = 0; i < 100; i++) { try { if ((await s.eval('document.readyState')) === 'complete') return; } catch (e) { /* 換頁中 */ } await sleep(100); } throw new Error('頁面沒載完'); },
    async until(expr, ms, what) {
      const end = Date.now() + (ms || 8000);
      while (Date.now() < end) { try { if (await s.eval(expr)) return true; } catch (e) { /* 換頁中 */ } await sleep(100); }
      throw new Error('等不到:' + (what || expr) + ' 畫面:' + String(await s.eval('document.body ? document.body.innerText : ""').catch(() => '')).slice(0, 300));
    },
    /* 用真的滑鼠點文字是 text 的按鈕 */
    async click(text) {
      const c = await s.eval(`(() => { const b = [...document.querySelectorAll('button,a')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled);
        if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (!c) throw new Error('找不到按鈕「' + text + '」:' + String(await s.eval('document.body.innerText')).slice(0, 300));
      await B.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 }, sid);
      await B.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 }, sid);
    },
    text: () => s.eval('document.body.innerText'),
    ls: () => s.eval('JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))').then(JSON.parse),
    close: () => B.send('Target.closeTarget', { targetId }),
  };
  await s.send('Page.enable'); await s.send('Runtime.enable');
  if (url) await s.go(url);
  return s;
}
async function popup(B, before, match) {
  for (let i = 0; i < 80; i++) {
    const t = B.created.slice(before).find((x) => x.url.indexOf(match) > -1 || x.url === '' || x.url === 'about:blank');
    if (t) { const s = await attach(B, t.targetId); await s.loaded().catch(() => {}); await s.until('location.href.indexOf(' + JSON.stringify(match) + ') > -1', 5000); await s.loaded(); return s; }
    await sleep(100);
  }
  throw new Error('新分頁沒有開');
}
const J = JSON.stringify;
const bank = (id, name, words) => ({ id, name, words: words.map((w) => ({ en: w, zh: '中' + w })) });
const NOWISH = Date.now();
const hist = (n, tag) => Array.from({ length: n }, (_, i) => ({ m: 'p5', id: tag + i, c: 1, ok: i % 2 === 0, t: NOWISH - (i + 1) * 60000 }));
const PET = (days, name) => ({ v: 1, born: '2026-10-01', goals: [], days, met: [], fed: {}, oldMet: 0, name: name || '' });
async function seed(s, origin, kv, clear) {
  await s.go(origin + '/move-ping.txt');
  await s.eval((clear ? 'localStorage.clear();' : '') + 'Object.entries(' + J(kv) + ').forEach(([k, v]) => localStorage.setItem(k, v)); true');
}
/* 這個分頁當成「試過自動搬家了」(js/move-out.js 的 tr_move_auto):要測按鈕流程的情境用,舊網址每一頁才會照舊顯示按鈕 */
async function noAuto(s) { await s.eval('sessionStorage.setItem("tr_move_auto", JSON.stringify({ step: "test" })); true'); }
/* 舊網址的寄出頁搬到新網址,回收件頁的分頁 */
async function sendViaWindow(B, oldTab) {
  await oldTab.go(OLD + '/move-out.html');
  await oldTab.until('[...document.querySelectorAll("button")].some((b) => b.textContent === "準備搬家" || b.textContent === "再搬一次")', 8000, '準備搬家按鈕');
  if (await oldTab.eval('[...document.querySelectorAll("button")].some((b) => b.textContent === "再搬一次")')) await oldTab.click('再搬一次');
  await oldTab.until('[...document.querySelectorAll("button")].some((b) => b.textContent === "準備搬家")', 8000, '準備搬家按鈕');
  await oldTab.click('準備搬家');
  await oldTab.until('[...document.querySelectorAll("button")].some((b) => b.textContent === "送到新網址")', 8000, '送到新網址按鈕');
  const before = B.created.length;
  await oldTab.click('送到新網址');
  const inTab = await popup(B, before, NEW + '/move-in.html');
  await inTab.until('[...document.querySelectorAll("button")].some((b) => b.textContent === "確定搬進來") || /已經搬過/.test(document.body.innerText)', 10000, '確認畫面');
  return inTab;
}

const T = {};
T['訪客:寄出頁兩下送出、收件頁確認寫入;新網址有題庫、小雞、紀錄;舊網址的資料一個位元組都沒變,只多了 tr_move_done 與 tr_move_device'] = async (B) => {
  const oldTab = await tab(B);
  const data = { tr_hist: J(hist(30, 'q')), tr_vgame_banks: J([bank('b1', '我的單字', ['apple', 'banana'])]), tr_pet: J(PET({ '2026-10-20': 25 }, '小黃')),
    tr_grammar_done: J({ g1: true }), 'sb-x-auth-token': J({ access_token: 'secret-token', refresh_token: 'r' }), tr_access_x: '{}' };
  await seed(oldTab, OLD, data, true);
  const before = await oldTab.ls();
  const newTab = await tab(B); await seed(newTab, NEW, {}, true); await newTab.close();
  const inTab = await sendViaWindow(B, oldTab);
  const txt = await inTab.text();
  await inTab.click('確定搬進來');
  await inTab.until('/搬好了/.test(document.body.innerText)', 8000, '搬好了');
  const got = await inTab.ls();
  await oldTab.until('/搬好了/.test(document.body.innerText)', 8000, '舊網址也顯示搬好了');
  const after = await oldTab.ls();
  const extra = Object.keys(after).filter((k) => !(k in before));
  const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
  const ok = JSON.parse(got.tr_vgame_banks)[0].name === '我的單字' && JSON.parse(got.tr_hist).length === 30 && JSON.parse(got.tr_pet).name === '小黃'
    && !Object.keys(got).some((k) => /^sb-|^tr_access_/.test(k)) && J(got).indexOf('secret-token') < 0 && J(extra.slice().sort()) === J(['tr_move_device', 'tr_move_done']) && !changed.length;
  await inTab.close(); await oldTab.close();
  return { ok, detail: J({ newKeys: Object.keys(got), extra, changed, txt: txt.slice(0, 160) }) };
};
T['新網址已經有資料:自動建的小雞與同 id 不同內容的題庫,合併後兩邊都在;同一包再搬說已經搬過'] = async (B) => {
  const oldTab = await tab(B);
  await seed(oldTab, OLD, { tr_hist: J(hist(5, 'o')), tr_vgame_banks: J([bank('b1', '共同', ['a', 'z'])]), tr_pet: J(PET({ '2026-10-20': 25 })) }, true);
  const newTab = await tab(B);
  await seed(newTab, NEW, { tr_hist: J(hist(3, 'n')), tr_vgame_banks: J([bank('b1', '共同', ['a'])]), tr_pet: J(PET({})), tr_diag: J({ done: true }) }, true);
  await newTab.close();
  let inTab = await sendViaWindow(B, oldTab);
  await inTab.click('確定搬進來');
  await inTab.until('/搬好了/.test(document.body.innerText)', 8000, '搬好了');
  const got = await inTab.ls();
  await inTab.close();
  const names = JSON.parse(got.tr_vgame_banks).map((b) => b.name);
  const h = JSON.parse(got.tr_hist).length;
  inTab = await sendViaWindow(B, oldTab);
  const again = /已經搬過/.test(await inTab.text());
  await inTab.close(); await oldTab.close();
  const ok = J(names) === J(['共同', '共同（舊網址）']) && h === 8 && JSON.parse(got.tr_pet).days['2026-10-20'] === 25 && got.tr_diag === J({ done: true }) && again;
  return { ok, detail: J({ names, h, again }) };
};
T['搬家碼:舊網址組好的搬家碼,在新網址直接打開收件頁貼上,一樣搬得進來'] = async (B) => {
  const oldTab = await tab(B);
  await seed(oldTab, OLD, { tr_vgame_banks: J([bank('b5', '用搬家碼', ['x'])]) }, true);
  await oldTab.go(OLD + '/move-out.html');
  await oldTab.until('!!window.MOVE_PACK');
  const code = await oldTab.eval('(async () => { const r = MOVE_PACK.collect(localStorage, { from: location.origin }); return MOVE_PACK.toCode(r.pack, await MOVE_PACK.hashOf(r.pack)); })()');
  const inTab = await tab(B);
  await seed(inTab, NEW, {}, true);
  await inTab.go(NEW + '/move-in.html');
  await inTab.until('!!document.querySelector("textarea")', 5000, '備案');
  await inTab.eval('document.querySelector("textarea").value = ' + J(code) + '; true');
  await inTab.click('讀取搬家碼');
  await inTab.until('[...document.querySelectorAll("button")].some((b) => b.textContent === "確定搬進來")', 8000, '確認畫面');
  await inTab.click('確定搬進來');
  await inTab.until('/搬好了/.test(document.body.innerText)', 8000, '搬好了');
  const got = await inTab.ls();
  await inTab.close(); await oldTab.close();
  return { ok: /^RU1Z:/.test(code) && JSON.parse(got.tr_vgame_banks)[0].name === '用搬家碼', detail: code.slice(0, 12) + '… ' + code.length };
};
T['其他新網址分頁開著:要求先關掉才寫;關掉之後再按就寫進去'] = async (B) => {
  const oldTab = await tab(B);
  await seed(oldTab, OLD, { tr_diag: J({ done: true, s: 1 }) }, true);
  const other = await tab(B);
  await seed(other, NEW, {}, true);
  await other.go(NEW + '/grammar.html');
  await other.until('!!window.MOVE_IN_BOOT', 8000, '新網址的提示程式');
  const inTab = await sendViaWindow(B, oldTab);
  await inTab.click('確定搬進來');
  await inTab.until('/還有 1 個衝衝英文的分頁開著/.test(document.body.innerText)', 5000, '要求先關');
  const blocked = (await inTab.ls()).tr_diag === undefined;
  await other.close();
  await inTab.click('確定搬進來');
  await inTab.until('/搬好了/.test(document.body.innerText)', 8000, '搬好了');
  const done = (await inTab.ls()).tr_diag === J({ done: true, s: 1 });
  await inTab.close(); await oldTab.close();
  return { ok: blocked && done, detail: J({ blocked, done }) };
};
T['冒充的網站開收件頁、送假的包:收件頁不理(網域不在 MOVE.from、也不是真的 opener 送的)'] = async (B) => {
  const ev = await tab(B, EVIL + '/');
  const nt = await tab(B); await seed(nt, NEW, {}, true); await nt.close();
  const before = B.created.length;
  await ev.click('go');
  const inTab = await popup(B, before, NEW + '/move-in.html');
  await inTab.until('/正在從舊網址接收/.test(document.body.innerText)', 5000, '等待中');
  await sleep(4500);
  const hellos = await ev.eval('window.__hello || 0');
  const txt = await inTab.text();
  const ls = await inTab.ls();
  await inTab.close(); await ev.close();
  return { ok: !('tr_hist' in ls) && !/確定搬進來/.test(txt), detail: J({ hellos, txt: txt.slice(0, 80) }) };
};
T['4 MB 的大包從視窗一次送到,寫得進去'] = async (B) => {
  const oldTab = await tab(B);
  const kv = { tr_hist: J(hist(1500, 'h')) };
  for (let i = 0; i < 38; i++) kv['tr_read_q_art-' + i] = J({ note: 'w'.repeat(100 * 1024) });
  await seed(oldTab, OLD, kv, true);
  const nt = await tab(B); await seed(nt, NEW, {}, true); await nt.close();
  const t0 = Date.now();
  const inTab = await sendViaWindow(B, oldTab);
  await inTab.click('確定搬進來');
  await inTab.until('/搬好了/.test(document.body.innerText)', 15000, '搬好了');
  const n = Object.keys(await inTab.ls()).filter((k) => /^tr_read_q_/.test(k)).length;
  await inTab.close(); await oldTab.close();
  return { ok: n === 38, detail: n + ' 個鍵,' + (Date.now() - t0) + ' ms' };
};
T['舊網址每一頁:有資料(這個分頁試過自動搬家)出現搬家按鈕;搬好之後帶到新網址同一路徑;登入回來的網址不帶走'] = async (B) => {
  const s = await tab(B);
  await seed(s, OLD, { tr_hist: J(hist(2, 'p')) }, true);
  await noAuto(s);
  await s.go(OLD + '/grammar.html');
  await s.until('!!document.getElementById("move-bar")', 8000, '搬家提示');
  const barTxt = await s.eval('document.getElementById("move-bar").innerText');
  const cookie = await s.eval('document.cookie');
  await s.eval('localStorage.setItem("tr_move_done", JSON.stringify({ to: "x", at: 1 })); true');
  await s.go(OLD + '/index.html#access_token=abc&type=signup');
  await sleep(4000);
  const stayed = (await s.eval('location.origin')) === OLD;
  await s.go(OLD + '/vocab.html?x=1');
  await s.until('location.origin === ' + J(NEW), 8000, '帶到新網址');
  const where = await s.eval('location.pathname + location.search');
  await s.close();
  return { ok: /帶我過去/.test(barTxt) && /tr_hd=1/.test(cookie) && stayed && where === '/vocab.html?x=1', detail: J({ cookie, stayed, where }) };
};
T['兩邊都有的寫作與文章單字:兩份都留(比較新的放原位);閱讀題新網址的作答不被換掉;確認畫面明講,不說「不會少」'] = async (B) => {
  const oldTab = await tab(B);
  await seed(oldTab, OLD, { tr_writing_y: J({ y1: { text: 'OLD essay written on the old site, much longer', updatedAt: '2026-10-23T10:00:00Z' } }),
    tr_vocab_art1: J({ 3: { t: '舊網址填的' }, 4: { t: 'x' } }), tr_read_q_art1: J({ 0: 2, 1: 1 }) }, true);
  const nt = await tab(B);
  await seed(nt, NEW, { tr_writing_y: J({ y1: { text: 'NEW short', updatedAt: '2026-10-01T10:00:00Z' } }), tr_vocab_art1: J({ 3: { t: '新網址填的' } }), tr_read_q_art1: J({ 0: 0 }) }, true);
  await nt.close();
  const inTab = await sendViaWindow(B, oldTab);
  const txt = await inTab.text();
  await inTab.click('確定搬進來');
  await inTab.until('/搬好了/.test(document.body.innerText)', 8000, '搬好了');
  const got = await inTab.ls();
  await inTab.close(); await oldTab.close();
  const y = JSON.parse(got.tr_writing_y).y1, v = JSON.parse(got.tr_vocab_art1), q = JSON.parse(got.tr_read_q_art1);
  const ok = y.text === 'OLD essay written on the old site, much longer' && J(y.alt.map((a) => a.text)) === J(['NEW short'])
    && v[3].t === '新網址填的' && J(v[3].alt) === J(['舊網址填的']) && v[4].t === 'x' && J(q) === J({ 0: 0, 1: 1 })
    && /兩份都留著/.test(txt) && /閱讀題作答有 1 題兩邊不一樣/.test(txt) && !/不會少/.test(txt);
  return { ok, detail: J({ y, v, q, txt: txt.slice(0, 400) }) };
};
T['寫作頁:搬家留下的另一份顯示在那一題下面,按「換成這一份」兩份對調,都還在'] = async (B) => {
  const s = await tab(B);
  await seed(s, NEW, {}, true);
  await s.go(NEW + '/writing.html?level=l2&u=2');
  await s.until('!!(window.TOEIC && TOEIC.writing)', 8000, '寫作教材');
  const id = await s.eval('TOEIC.writing.l2.emails[0].id');
  await s.eval('localStorage.setItem("tr_profiles", ' + J(J([{ id: 'pabc123', name: '小明' }])) + '); localStorage.setItem("tr_current_profile", ' + J(J('pabc123')) + '); true');
  await s.eval('localStorage.setItem("tr_upabc123_writing_e", ' + J(J({ [id]: { text: 'Dear Tom, newer reply', updatedAt: '2026-10-23T10:00:00Z', alt: [{ text: 'Dear Tom, older reply', updatedAt: '2026-10-01T10:00:00Z' }] } })) + '); true');
  await s.go(NEW + '/writing.html?level=l2&u=2');
  await s.until('/搬家時留下的另一份/.test(document.body.innerText)', 8000, '另一份');
  const before = await s.eval('document.querySelector("textarea.write-area").value');
  await s.click('換成這一份');
  await s.until('document.querySelector("textarea.write-area").value === "Dear Tom, older reply"', 3000, '換過來');
  const st = JSON.parse((await s.ls()).tr_upabc123_writing_e)[id];
  const shown = /Dear Tom, newer reply/.test(await s.text());
  await s.close();
  return { ok: before === 'Dear Tom, newer reply' && st.text === 'Dear Tom, older reply' && J(st.alt.map((a) => a.text)) === J(['Dear Tom, newer reply']) && shown, detail: J({ before, st }) };
};
T['只在本機的小雞(登入失效後留下的,沒有帳本):舊網址照樣提示搬家、寄出頁列出來,不會直接帶走'] = async (B) => {
  const U = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72', CP = 'c' + U.replace(/-/g, '');
  const s = await tab(B);
  await seed(s, OLD, { ['tr_localonly_' + U]: J({ pet: Date.now() - 5000 }), ['tr_u' + CP + '_pet']: J(PET({ '2026-10-20': 9 }, '只在本機')) }, true);
  await noAuto(s);
  await s.go(OLD + '/grammar.html');
  await s.until('!!document.getElementById("move-bar")', 8000, '搬家提示');
  const stayed = (await s.eval('location.origin')) === OLD;
  await s.go(OLD + '/move-out.html');
  await s.until('[...document.querySelectorAll("button")].some((b) => b.textContent === "準備搬家")', 8000, '準備搬家按鈕');
  await s.click('準備搬家');
  await s.until('/帳號還沒上傳到雲端的進度 1 項/.test(document.body.innerText)', 8000, '摘要列出帳號的小雞');
  await s.close();
  return { ok: stayed, detail: J({ stayed }) };
};
T['很大的自訂題庫(約 3.6 MB)從視窗送到,新網址寫得進去;舊網址摘要列出題庫名稱'] = async (B) => {
  const oldTab = await tab(B);
  const words = (n, tag) => Array.from({ length: n }, (_, i) => tag + i + 'abcdefghij');
  await seed(oldTab, OLD, { tr_vgame_banks: J([bank('b1', '大題庫一', words(36000, 'a')), bank('b2', '大題庫二', words(36000, 'b'))]), tr_hist: J(hist(3, 'z')) }, true);
  const size = await oldTab.eval('localStorage.getItem("tr_vgame_banks").length');
  const nt = await tab(B); await seed(nt, NEW, {}, true); await nt.close();
  const inTab = await sendViaWindow(B, oldTab);
  const sum = await oldTab.text();
  await inTab.click('確定搬進來');
  await inTab.until('/搬好了/.test(document.body.innerText)', 15000, '搬好了');
  const got = await inTab.ls();
  await inTab.close(); await oldTab.close();
  const names = got.tr_vgame_banks ? JSON.parse(got.tr_vgame_banks).map((b) => b.name) : [];
  return { ok: size > 3e6 && J(names) === J(['大題庫一', '大題庫二']) && /大題庫一/.test(sum) && !/讀不懂/.test(sum), detail: J({ size, names }) };
};
T['格式不對的搬家碼(keys 不是陣列):收件頁說不能用、什麼都不寫、備案還在,頁面沒有錯誤'] = async (B) => {
  const inTab = await tab(B);
  await seed(inTab, NEW, { tr_hist: J(hist(1, 'n')) }, true);
  await inTab.go(NEW + '/move-in.html');
  await inTab.until('!!document.querySelector("textarea")', 5000, '備案');
  const errs = B.errors.length;
  const code = 'RU1:' + Buffer.from(J({ pack: { app: 'rushup-move', v: 1, keys: 'abc', accounts: { x: 5 } }, hash: 'a'.repeat(64) })).toString('base64');
  await inTab.eval('document.querySelector("textarea").value = ' + J(code) + '; true');
  await inTab.click('讀取搬家碼');
  await inTab.until('/這份搬家資料不能用/.test(document.body.innerText)', 5000, '不能用的訊息');
  const still = await inTab.eval('!!document.querySelector("textarea")');
  const ls = await inTab.ls();
  await inTab.close();
  return { ok: still && J(Object.keys(ls).sort()) === J(['tr_hist']) && B.errors.length === errs, detail: J({ still, keys: Object.keys(ls), errs: B.errors.slice(errs) }) };
};
T['iPhone 主畫面 App:舊網址寄出頁不給「送到新網址」、教用搬家碼;新網址提示的主按鈕是「貼上搬家碼」'] = async (B) => {
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const app = async () => {
    const s = await tab(B);
    await s.send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'iPhone' });
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: 'Object.defineProperty(Navigator.prototype, "standalone", { get: () => true, configurable: true });' });
    return s;
  };
  const o = await app();
  await seed(o, OLD, { tr_hist: J(hist(2, 'i')) }, true);
  await o.go(OLD + '/move-out.html');
  await o.until('[...document.querySelectorAll("button")].some((b) => b.textContent === "準備搬家")', 8000, '準備搬家按鈕');
  const note = /主畫面的 App/.test(await o.text());
  await o.click('準備搬家');
  await o.until('[...document.querySelectorAll("button")].some((b) => b.textContent === "複製搬家碼")', 8000, '複製搬家碼');
  const noSend = await o.eval('![...document.querySelectorAll("button")].some((b) => b.textContent === "送到新網址")');
  await o.close();
  const n = await app();
  await seed(n, NEW, {}, true);
  await n.go(NEW + '/grammar.html');
  await n.until('!!document.getElementById("move-bar")', 8000, '新網址提示');
  const main = await n.eval('(() => { const a = document.querySelector("#move-bar a.btn.primary"); return a ? [a.textContent, a.getAttribute("href")] : null; })()');
  await n.close();
  return { ok: note && noSend && J(main) === J(['貼上搬家碼', 'move-in.html']), detail: J({ note, noSend, main }) };
};
T['寫到一半被關:新網址下一頁照日誌處理(新加的拿掉、換掉的換回、合併的留著)、提示再搬一次'] = async (B) => {
  const s = await tab(B);
  await seed(s, NEW, {}, true);
  await s.go(NEW + '/move-in.html');
  const now = Date.now() - 60000;
  const banks = J([bank('b1', '寫一半', ['a'])]), merged = J(hist(2, 'k')), diag = J({ tag: 'OLD' });
  const bk = 'tr_move_backup_' + now;
  const j = await s.eval('JSON.stringify({ v: 2, at: ' + now + ', backup: ' + J(bk) + ', keys: [["tr_vgame_banks", "add", moveHash(' + J(banks) + ')], ["tr_hist", "grow", moveHash(' + J(merged) + ')], ["tr_diag", "replace", moveHash(' + J(diag) + ')]] })');
  await seed(s, NEW, { tr_hist: merged, tr_diag: diag, tr_vgame_banks: banks, [bk]: J({ at: now, keys: [['tr_diag', J({ tag: 'NEW' })]] }), tr_move_journal: j }, true);
  await s.go(NEW + '/grammar.html');
  await s.until('!!document.getElementById("move-bar")', 8000, '還原提示');
  const ls = await s.ls();
  const bar = await s.eval('document.getElementById("move-bar").innerText');
  await s.close();
  const ok = !('tr_vgame_banks' in ls) && JSON.parse(ls.tr_hist).length === 2 && JSON.parse(ls.tr_diag).tag === 'NEW' && !('tr_move_journal' in ls) && !(bk in ls) && /再搬一次/.test(bar);
  return { ok, detail: J({ bar: bar.slice(0, 80), keys: Object.keys(ls) }) };
};
T['搬好之後新網址連不上:舊網址每一頁說這裡練習的不會自動過去;連上之後不帶走、提示再搬一次,再搬就過去'] = async (B) => {
  PING = 'ok';
  const oldTab = await tab(B);
  await seed(oldTab, OLD, { tr_hist: J(hist(2, 'm')) }, true);
  const nt = await tab(B); await seed(nt, NEW, {}, true); await nt.close();
  let inTab = await sendViaWindow(B, oldTab);
  await inTab.click('確定搬進來');
  await inTab.until('/搬好了/.test(document.body.innerText)', 8000, '搬好了');
  await inTab.close();
  await oldTab.until('/搬好了/.test(document.body.innerText)', 8000, '舊網址也顯示搬好了');
  PING = 'down';
  await oldTab.go(OLD + '/grammar.html');
  await oldTab.until('!!document.getElementById("move-bar")', 8000, '連不上的提示');
  const offTxt = await oldTab.eval('document.getElementById("move-bar").innerText');
  await oldTab.eval('(() => { const x = JSON.parse(localStorage.getItem("tr_hist")); x.unshift({ m: "p5", id: "practiced-while-down", c: 1, ok: true, t: Date.now() }); localStorage.setItem("tr_hist", JSON.stringify(x)); return true; })()');
  PING = 'ok';
  await noAuto(oldTab);
  await oldTab.go(OLD + '/vocab.html');
  await oldTab.until('!!document.getElementById("move-bar")', 8000, '再搬一次的提示');
  await sleep(1500);
  const stayed = (await oldTab.eval('location.origin')) === OLD;
  const againTxt = await oldTab.eval('document.getElementById("move-bar").innerText');
  const cookie = await oldTab.eval('document.cookie');
  inTab = await sendViaWindow(B, oldTab);
  await inTab.click('確定搬進來');
  await inTab.until('/搬好了/.test(document.body.innerText)', 8000, '再搬一次搬好了');
  const got = await inTab.ls();
  await inTab.close(); await oldTab.close();
  const ok = /連不上新網址/.test(offTxt) && /不會自動過去/.test(offTxt) && stayed && /再搬一次/.test(againTxt) && /拍謝！我們換網址了，因為名字跟別人重疊！/.test(againTxt)
    && /tr_hd=1/.test(cookie) && !/tr_moved=1/.test(cookie) && J(got.tr_hist).indexOf('practiced-while-down') > -1;
  return { ok, detail: J({ offTxt: offTxt.slice(0, 80), stayed, againTxt: againTxt.slice(0, 80), cookie }) };
};
T['再搬一次(錯題本):搬完之後在舊網址又答錯同一題,舊網址提示再搬;再搬之後新網址的錯題本是新的作答'] = async (B) => {
  PING = 'ok';
  const oldTab = await tab(B);
  await seed(oldTab, OLD, { tr_drill_p5: J({ q1: { c: 0, ok: true, t: NOWISH - 5 * 864e5 }, q2: { c: 1, ok: true, t: NOWISH - 5 * 864e5 } }) }, true);
  const nt = await tab(B); await seed(nt, NEW, {}, true); await nt.close();
  let inTab = await sendViaWindow(B, oldTab);
  await inTab.click('確定搬進來');
  await inTab.until('/搬好了/.test(document.body.innerText)', 8000, '搬好了');
  await inTab.close();
  await oldTab.until('/搬好了/.test(document.body.innerText)', 8000, '舊網址也顯示搬好了');
  await oldTab.go(OLD + '/move-ping.txt');
  await oldTab.eval('(() => { const x = JSON.parse(localStorage.getItem("tr_drill_p5")); x.q1 = { c: 3, ok: false, t: Date.now() }; localStorage.setItem("tr_drill_p5", JSON.stringify(x)); return true; })()');
  await noAuto(oldTab);
  await oldTab.go(OLD + '/vocab.html');
  await oldTab.until('!!document.getElementById("move-bar")', 8000, '再搬一次的提示');
  const bar = await oldTab.eval('document.getElementById("move-bar").innerText');
  inTab = await sendViaWindow(B, oldTab);
  const txt = await inTab.text();
  await inTab.click('確定搬進來');
  await inTab.until('/搬好了/.test(document.body.innerText)', 8000, '再搬一次搬好了');
  const q = JSON.parse((await inTab.ls()).tr_drill_p5);
  await inTab.close(); await oldTab.close();
  const ok = /再搬一次/.test(bar) && q.q1.c === 3 && q.q1.ok === false && q.q2.ok === true && /合併 1 項/.test(txt);
  return { ok, detail: J({ q, bar: bar.slice(0, 60), txt: txt.slice(0, 120) }) };
};
T['新網址已經有 280 萬字的題庫:舊網址的小題庫與紀錄照樣搬得進去,舊網址標成搬好了'] = async (B) => {
  const oldTab = await tab(B);
  await seed(oldTab, OLD, { tr_vgame_banks: J([bank('s1', '小題庫', ['a', 'b'])]), tr_hist: J(hist(3, 'h')) }, true);
  const nt = await tab(B);
  await seed(nt, NEW, {}, true);
  await nt.eval('localStorage.setItem("tr_vgame_banks", JSON.stringify([{ id: "big", name: "大題庫", words: Array.from({ length: 60700 }, (_, i) => ({ en: "w" + i + "abcdefgh", zh: "中w" + i + "abcdefgh" })) }])); true');
  const size = await nt.eval('localStorage.getItem("tr_vgame_banks").length');
  await nt.close();
  const inTab = await sendViaWindow(B, oldTab);
  await inTab.click('確定搬進來');
  await inTab.until('/搬好了/.test(document.body.innerText)', 15000, '搬好了');
  const got = await inTab.ls();
  await inTab.close();
  await oldTab.until('/搬好了/.test(document.body.innerText)', 8000, '舊網址也顯示搬好了');
  const done = (await oldTab.ls()).tr_move_done !== undefined;
  await oldTab.close();
  const names = JSON.parse(got.tr_vgame_banks).map((b) => b.name);
  return { ok: size > 2.8e6 && J(names) === J(['大題庫', '小題庫']) && JSON.parse(got.tr_hist).length === 3 && done, detail: J({ size, names, done }) };
};
T['被換掉的值太大、備份放不下:選了「用舊網址的」不會默默不換就算搬完;先下載這台現在的資料,再換成舊網址的,才標成搬好了'] = async (B) => {
  await B.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: B.dir });
  const oldTab = await tab(B);
  await seed(oldTab, OLD, { tr_diag: J({ tag: 'OLD' }), tr_hist: J(hist(2, 'o')) }, true);
  const nt = await tab(B);
  await seed(nt, NEW, {}, true);
  await nt.eval('localStorage.setItem("tr_diag", JSON.stringify({ tag: "NEW", pad: "x".repeat(2400000) })); true');
  await nt.close();
  const inTab = await sendViaWindow(B, oldTab);
  await inTab.eval('(() => { const r = [...document.querySelectorAll("label")].find((l) => /用舊網址的/.test(l.textContent)).querySelector("input"); r.click(); return true; })()');
  await inTab.click('確定搬進來');
  await inTab.until('/大部分搬好了/.test(document.body.innerText)', 15000, '大部分搬好了');
  const mid = await inTab.text();
  const midLs = await inTab.ls();
  await sleep(500);
  const oldMid = (await oldTab.ls()).tr_move_done === undefined && !/搬好了/.test(await oldTab.text());
  await inTab.click('下載這台現在的資料');
  await inTab.until('/已經下載/.test(document.body.innerText)', 5000, '下載好了');
  let file = null;
  for (let i = 0; i < 30 && !file; i++) { await sleep(200); file = fs.readdirSync(B.dir).find((f) => /^衝衝英文這台的備份_.*\.json$/.test(f)); }
  const saved = file ? JSON.parse(fs.readFileSync(path.join(B.dir, file), 'utf8')) : null;
  await inTab.click('換成舊網址的');
  await inTab.until('/搬好了。/.test(document.body.innerText)', 8000, '換好之後搬好了');
  const got = await inTab.ls();
  await inTab.close();
  await oldTab.until('/搬好了/.test(document.body.innerText)', 8000, '舊網址也顯示搬好了');
  await oldTab.close();
  const savedDiag = saved && saved.pack.keys.filter((e) => e[0] === 'tr_diag')[0];
  const ok = /還沒換/.test(mid) && JSON.parse(midLs.tr_diag).tag === 'NEW' && JSON.parse(midLs.tr_hist).length === 2 && oldMid
    && !!savedDiag && JSON.parse(savedDiag[1]).tag === 'NEW' && JSON.parse(got.tr_diag).tag === 'OLD';
  return { ok, detail: J({ mid: mid.slice(0, 200), oldMid, file, diag: JSON.parse(got.tr_diag).tag }) };
};
T['新網址只開過首頁(只有自動建的小雞):舊網址的學生檔案直接切過去,搬完不是空的訪客畫面'] = async (B) => {
  const oldTab = await tab(B);
  await seed(oldTab, OLD, { tr_profiles: J([{ id: 'pabc1234', name: '小明' }]), tr_current_profile: J('pabc1234'), tr_upabc1234_hist: J(hist(20, 'm')) }, true);
  const nt = await tab(B);
  await seed(nt, NEW, {}, true);
  await nt.go(NEW + '/index.html');
  await sleep(1500);
  const keys = Object.keys(await nt.ls());
  await nt.close();
  const inTab = await sendViaWindow(B, oldTab);
  const txt = await inTab.text();
  await inTab.click('確定搬進來');
  await inTab.until('/搬好了/.test(document.body.innerText)', 8000, '搬好了');
  const got = await inTab.ls();
  await inTab.close(); await oldTab.close();
  return { ok: got.tr_current_profile === J('pabc1234') && !/要不要切換/.test(txt), detail: J({ keys, cur: got.tr_current_profile }) };
};
T['寄出頁在新網址連不上時:說連不上(不說還沒開放),照樣能準備、下載搬家檔、複製搬家碼;連上之後才給送出'] = async (B) => {
  PING = 'down';
  const s = await tab(B);
  await seed(s, OLD, { tr_vgame_banks: J([bank('b1', '連不上也要帶走', ['a'])]) }, true);
  await s.go(OLD + '/move-out.html');
  await s.until('[...document.querySelectorAll("button")].some((b) => b.textContent === "準備搬家")', 20000, '準備搬家按鈕');
  const t1 = await s.text();
  await s.click('準備搬家');
  await s.until('[...document.querySelectorAll("button")].some((b) => b.textContent === "下載搬家檔")', 8000, '下載搬家檔');
  const btns = await s.eval('[...document.querySelectorAll("button")].map((b) => b.textContent)');
  PING = 'ok';
  await s.click('再連一次新網址');
  await s.until('[...document.querySelectorAll("button")].some((b) => b.textContent === "送到新網址")', 15000, '連上之後的送出');
  await s.close();
  const ok = /連不上新網址/.test(t1) && !/還沒開放/.test(t1) && btns.includes('複製搬家碼') && btns.includes('下載搬家檔') && btns.includes('再連一次新網址') && !btns.includes('送到新網址');
  return { ok, detail: J({ t1: t1.slice(0, 160), btns }) };
};

/* ---------- 自動搬家(有資料的訪客打開舊網址任何一頁,不用按按鈕) ---------- */
const onNewPage = (p) => 'location.origin === ' + J(NEW) + ' && location.pathname === ' + J(p) + ' && document.readyState === "complete"';
/* 這個分頁的上一頁紀錄裡有沒有搬家碼、ack(Page.getNavigationHistory 給每一筆現在的網址) */
async function historyUrls(s) { const r = await s.send('Page.getNavigationHistory'); return r.result.entries.map((e) => e.url); }
async function oldLs(B) { const t = await tab(B); await t.go(OLD + '/move-ping.txt'); const ls = await t.ls(); await t.close(); return ls; }
T['自動搬家:有題庫的訪客打開舊網址的文法頁,不用按 → 新網址合併 → 回舊網址寫完成(含指紋)→ 回到新網址的文法頁;網址列與上一頁紀錄沒有搬家碼;舊網址的資料沒變'] = async (B) => {
  PING = 'ok';
  const s = await tab(B);
  await seed(s, OLD, { tr_vgame_banks: J([bank('a1', '自動搬的題庫', ['apple', 'pear'])]), tr_hist: J(hist(5, 'a')), tr_pet: J(PET({ '2026-10-20': 25 }, '小黃')) }, true);
  const before = await s.ls();
  const nt = await tab(B); await seed(nt, NEW, {}, true); await nt.close();
  await s.send('Page.navigate', { url: OLD + '/grammar.html?u=2' });
  await s.until('/正在把你的進度帶過去/.test(document.body.innerText)', 10000, '舊網址的自動搬家提示');
  const barTxt = await s.eval('document.getElementById("move-bar").innerText');
  const btns = await s.eval('[...document.querySelectorAll("#move-bar .btn")].map((b) => b.textContent).join(",")');
  await s.until(onNewPage('/grammar.html'), 25000, '回到新網址的文法頁');
  const where = await s.eval('location.href');
  const got = await s.ls();
  const keyLeft = await s.eval('sessionStorage.getItem("tr_move_key")');
  const urls = await historyUrls(s);
  await s.close();
  const after = await oldLs(B);
  const done = after.tr_move_done ? JSON.parse(after.tr_move_done) : null;
  const extra = Object.keys(after).filter((k) => !(k in before)).sort();
  /* 小雞是頁面自己寫的(打開文法頁就加今天的分數),不是搬家改的:搬過去的那份要有這一天 */
  const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
  const names = got.tr_vgame_banks ? JSON.parse(got.tr_vgame_banks).map((b) => b.name) : [];
  const ok = /拍謝！我們換網址了，因為名字跟別人重疊！正在把你的進度帶過去…/.test(barTxt) && btns === '等一下再搬' && where === NEW + '/grammar.html?u=2' && keyLeft === null
    && J(names) === J(['自動搬的題庫']) && JSON.parse(got.tr_hist).length === 5 && JSON.parse(got.tr_pet).name === '小黃'
    && !!done && /^[0-9a-f]{64}$/.test(done.hash) && typeof done.fp === 'string' && done.manual === false && done.to === NEW
    && J(extra) === J(['tr_move_device', 'tr_move_done']) && changed.every((k) => k === 'tr_pet')
    && J(JSON.parse(got.tr_pet).days) === J(JSON.parse(after.tr_pet).days)
    && !urls.some((u) => /auto=|ack=|RU1/.test(u));
  return { ok, detail: J({ changed, petBefore: before.tr_pet, petAfter: after.tr_pet, urls, barTxt: barTxt.slice(0, 60), btns, keyLeft, where, names, done, extra }) };
};
T['自動搬家冪等:舊網址沒記到搬好了(ack 沒回來),換一個分頁再開舊網址 → 再自動一次,同一包不重寫、題庫不多一份;之後又練習再開一次,只多那筆紀錄'] = async (B) => {
  PING = 'ok';
  const s = await tab(B);
  await seed(s, OLD, { tr_vgame_banks: J([bank('i1', '只要一份', ['a', 'b'])]), tr_hist: J(hist(4, 'i')) }, true);
  const nt = await tab(B); await seed(nt, NEW, {}, true); await nt.close();
  await s.send('Page.navigate', { url: OLD + '/grammar.html' });
  await s.until(onNewPage('/grammar.html'), 25000, '第一次自動搬家');
  await s.close();
  /* 當成 ack 沒回來:舊網址沒有搬好的記號 */
  const t1 = await tab(B); await t1.go(OLD + '/move-ping.txt'); await t1.eval('localStorage.removeItem("tr_move_done"); true'); await t1.close();
  const s2 = await tab(B);
  await s2.go(OLD + '/move-ping.txt');
  await s2.send('Page.navigate', { url: OLD + '/vocab.html' });
  await s2.until(onNewPage('/vocab.html'), 25000, '第二次自動搬家');
  const got2 = await s2.ls();
  await s2.close();
  const done2 = !!(await oldLs(B)).tr_move_done;
  /* 搬完之後又在舊網址練習了一筆:新的分頁再自動一次 */
  const t2 = await tab(B); await t2.go(OLD + '/move-ping.txt');
  await t2.eval('(() => { const x = JSON.parse(localStorage.getItem("tr_hist")); x.unshift({ m: "p5", id: "after-move", c: 1, ok: true, t: Date.now() }); localStorage.setItem("tr_hist", JSON.stringify(x)); return true; })()');
  await t2.close();
  const s3 = await tab(B);
  await s3.go(OLD + '/move-ping.txt');
  await s3.send('Page.navigate', { url: OLD + '/index.html' });
  await s3.until(onNewPage('/index.html'), 25000, '第三次自動搬家');
  const got3 = await s3.ls();
  await s3.close();
  const after = await oldLs(B);
  const names2 = JSON.parse(got2.tr_vgame_banks).map((b) => b.name), names3 = JSON.parse(got3.tr_vgame_banks).map((b) => b.name);
  const fpNow = after.tr_move_done ? JSON.parse(after.tr_move_done).fp : null;
  const ok = J(names2) === J(['只要一份']) && J(names3) === J(['只要一份']) && JSON.parse(got2.tr_hist).length === 4 && done2
    && JSON.parse(got3.tr_hist).length === 5 && J(got3.tr_hist).indexOf('after-move') > -1 && typeof fpNow === 'string';
  return { ok, detail: J({ names2, names3, h2: JSON.parse(got2.tr_hist).length, h3: JSON.parse(got3.tr_hist).length, done2, fpNow }) };
};
T['自動搬家:搬家碼超過 48 KB 回原頁面照舊顯示按鈕、不帶走;LINE 內建瀏覽器自動搬過去(同一個分頁,資料留在 LINE 裡的新網址)'] = async (B) => {
  PING = 'ok';
  const noise = (n) => { let x = ''; while (x.length < n) x += Math.random().toString(36).slice(2); return x.slice(0, n); };
  const s = await tab(B);
  await seed(s, OLD, { tr_vgame_banks: J([bank('g1', '大的', ['a'])]), 'tr_read_q_art-9': J({ note: noise(90 * 1024) }) }, true);
  await s.go(OLD + '/grammar.html');
  await s.until('!!document.getElementById("move-bar") && /帶我過去（進度一起搬）/.test(document.getElementById("move-bar").innerText)', 15000, '大的照舊顯示按鈕');
  await sleep(2500);
  const stayed = (await s.eval('location.origin')) === OLD;
  const memo = await s.eval('sessionStorage.getItem("tr_move_auto")');
  await s.close();
  const l = await tab(B);
  await l.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/13.0.0' });
  await seed(l, OLD, { tr_vgame_banks: J([bank('l1', 'LINE 裡的', ['a'])]), tr_hist: J(hist(3, 'l')) }, true);
  const nl = await tab(B); await seed(nl, NEW, {}, true); await nl.close();
  await l.send('Page.navigate', { url: OLD + '/grammar.html' });
  await l.until(onNewPage('/grammar.html'), 25000, 'LINE 自動搬到新網址的文法頁');
  const lineGot = await l.ls();
  const lineUrl = await l.eval('location.href');
  await l.close();
  const lineDone = !!(await oldLs(B)).tr_move_done;
  const lineNames = lineGot.tr_vgame_banks ? JSON.parse(lineGot.tr_vgame_banks).map((b) => b.name) : [];
  const lineOk = J(lineNames) === J(['LINE 裡的']) && JSON.parse(lineGot.tr_hist || '[]').length === 3 && lineDone && lineUrl === NEW + '/grammar.html';
  return { ok: stayed && !!memo && JSON.parse(memo).step === 'big' && lineOk, detail: J({ stayed, memo, lineNames, lineDone, lineUrl }) };
};
T['自動搬家遇到要選的(兩邊不一樣):停在確認畫面等人按;按了之後一樣回舊網址寫完成、回到原頁面'] = async (B) => {
  PING = 'ok';
  const s = await tab(B);
  await seed(s, OLD, { tr_diag: J({ done: true, tag: 'OLD' }), tr_vgame_banks: J([bank('c1', '要確認的', ['a'])]) }, true);
  const nt = await tab(B); await seed(nt, NEW, { tr_diag: J({ done: false, tag: 'NEW' }) }, true); await nt.close();
  await s.send('Page.navigate', { url: OLD + '/grammar.html' });
  await s.until('location.origin === ' + J(NEW) + ' && [...document.querySelectorAll("button")].some((b) => b.textContent === "確定搬進來" && !b.disabled)', 20000, '確認畫面');
  await sleep(1500);
  const txt = await s.text();
  const mid = await s.ls();
  const oldMid = !(await oldLs(B)).tr_move_done;
  const stillHere = (await s.eval('location.pathname')) === '/move-in.html';
  await s.click('確定搬進來');
  await s.until(onNewPage('/grammar.html'), 20000, '按了之後回到文法頁');
  const got = await s.ls();
  await s.close();
  const done = !!(await oldLs(B)).tr_move_done;
  const ok = stillHere && /要你決定留哪一份/.test(txt) && /回舊網址用按鈕搬/.test(txt) && !mid.tr_vgame_banks && oldMid
    && JSON.parse(got.tr_vgame_banks)[0].name === '要確認的' && JSON.parse(got.tr_diag).tag === 'NEW' && done;
  return { ok, detail: J({ stillHere, oldMid, done, txt: txt.slice(0, 200) }) };
};
T['自動搬家失敗(新網址還有別的分頁開著):什麼都沒寫、說清楚、給「回舊網址用按鈕搬」;回到舊網址這個分頁不再自動(不會一直來回)'] = async (B) => {
  PING = 'ok';
  const s = await tab(B);
  await seed(s, OLD, { tr_vgame_banks: J([bank('f1', '失敗也還在', ['a'])]) }, true);
  const other = await tab(B);
  await seed(other, NEW, {}, true);
  await other.go(NEW + '/grammar.html');
  await other.until('!!window.MOVE_IN_BOOT', 8000, '新網址的提示程式');
  await s.send('Page.navigate', { url: OLD + '/vocab.html' });
  await s.until('location.origin === ' + J(NEW) + ' && /還有 1 個衝衝英文的分頁開著/.test(document.body.innerText)', 20000, '要求先關');
  const wrote = (await s.ls()).tr_vgame_banks !== undefined;
  const oldDone = !!(await oldLs(B)).tr_move_done;
  await s.click('回舊網址用按鈕搬');
  await s.until('location.origin === ' + J(OLD) + ' && [...document.querySelectorAll("button")].some((b) => b.textContent === "準備搬家")', 15000, '舊網址的搬家頁');
  await s.go(OLD + '/grammar.html');
  await s.until('!!document.getElementById("move-bar") && /帶我過去/.test(document.getElementById("move-bar").innerText)', 10000, '舊網址照舊顯示按鈕');
  await sleep(2500);
  const stayed = (await s.eval('location.origin')) === OLD;
  await other.close(); await s.close();
  return { ok: !wrote && !oldDone && stayed, detail: J({ wrote, oldDone, stayed }) };
};
T['別人拿到的 #auto= 網址(明文的搬家碼、別的分頁加密的):解不開,什麼都不顯示、不寫;網址列一樣拿掉'] = async (B) => {
  const s = await tab(B);
  await seed(s, OLD, { tr_vgame_banks: J([bank('e1', '別人塞的', ['x'])]) }, true);
  const nt = await tab(B); await seed(nt, NEW, {}, true); await nt.close();
  /* 用舊網址的程式組一包(等於有人拿到一份搬家碼):一份明文,一份用「另一個分頁」的金鑰加密(像是從共用電腦的歷史紀錄撿到的) */
  await s.go(OLD + '/move-out.html');
  await s.until('!!window.MOVE_PACK');
  const codes = await s.eval(`(async () => { const r = MOVE_PACK.collect(localStorage, { from: location.origin });
    const plain = await MOVE_PACK.toCode(r.pack, await MOVE_PACK.hashOf(r.pack));
    const k = await MOVE_LINK.newKey();
    return { plain, sealed: await MOVE_LINK.seal(k.pub, plain) }; })()`);
  await s.close();
  const out = [];
  for (const code of [codes.plain, codes.sealed]) {
    const e = await tab(B);
    await e.go(NEW + '/move-in.html#auto=' + code + '&back=%2Fvocab.html');
    await e.until('/已經用過、過期了/.test(document.body.innerText)', 10000, '解不開的說明');
    await sleep(1000);
    const txt = await e.text();
    out.push({ wrote: !!(await e.ls()).tr_vgame_banks, shows: /別人塞的/.test(txt), confirm: /確定搬進來/.test(txt), href: await e.eval('location.href') });
    await e.close();
  }
  return { ok: out.every((x) => !x.wrote && !x.shows && !x.confirm && x.href === NEW + '/move-in.html'), detail: J(out) };
};
T['自動搬家的網址都不帶明文:帶著密文的那一站連不上(錯誤頁),網址列只有密文、解不開;網路好了重新整理,同一個分頁照樣搬完'] = async (B) => {
  PING = 'ok';
  const s = await tab(B);
  await seed(s, OLD, { tr_vgame_banks: J([bank('d1', '斷線也還在', ['secretword'])]), tr_hist: J(hist(2, 'd')) }, true);
  const nt = await tab(B); await seed(nt, NEW, {}, true); await nt.close();
  moveInHits = 0; DROP_MOVE_IN = 2;   // 第一次進收件頁是拿金鑰(#want),第二次是帶著密文(#auto=)
  await s.send('Page.navigate', { url: OLD + '/vocab.html' });
  let cur = '';
  for (let i = 0; i < 150 && !/#auto=/.test(cur); i++) { await sleep(100); const r = await s.send('Page.getNavigationHistory'); cur = (r.result.entries[r.result.currentIndex] || {}).url || ''; }
  await sleep(1500);
  DROP_MOVE_IN = 0;
  const r = await s.send('Page.getNavigationHistory');
  const urls = r.result.entries.map((e) => e.url);
  const current = urls[r.result.currentIndex] || '';
  const oldMid = !(await oldLs(B)).tr_move_done;
  const plainInUrls = urls.some((u) => /RU1Z?:|secretword/.test(u));
  await s.send('Page.reload');
  await s.until(onNewPage('/vocab.html'), 25000, '重新整理之後搬完');
  const got = await s.ls();
  await s.close();
  const done = !!(await oldLs(B)).tr_move_done;
  const ok = /#auto=RU1E:/.test(current) && !plainInUrls && oldMid && JSON.parse(got.tr_vgame_banks)[0].name === '斷線也還在' && done;
  return { ok, detail: J({ current: current.slice(0, 90), plainInUrls, oldMid, done }) };
};
T['自動搬家:按「等一下再搬」不帶走、提示拿掉;在頁面上點了別的(作答、按開始)也不帶走,改顯示按鈕'] = async (B) => {
  PING = 'ok';
  const s = await tab(B);
  await seed(s, OLD, { tr_vgame_banks: J([bank('w1', '等一下', ['a'])]) }, true);
  await s.send('Page.navigate', { url: OLD + '/grammar.html' });
  await s.until('!!document.getElementById("move-bar") && /正在把你的進度帶過去/.test(document.getElementById("move-bar").innerText)', 10000, '自動搬家提示');
  await s.click('等一下再搬');
  await sleep(3500);
  const a = { origin: await s.eval('location.origin'), bar: await s.eval('!!document.getElementById("move-bar")') };
  await s.close();
  const t = await tab(B);
  await seed(t, OLD, { tr_vgame_banks: J([bank('w2', '作答中', ['a'])]) }, true);
  await t.send('Page.navigate', { url: OLD + '/mock.html' });
  await t.until('!!document.getElementById("move-bar") && /正在把你的進度帶過去/.test(document.getElementById("move-bar").innerText)', 10000, '自動搬家提示');
  await B.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 500, button: 'left', clickCount: 1 }, t.sid);
  await B.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 300, y: 500, button: 'left', clickCount: 1 }, t.sid);
  await sleep(3500);
  const b = { origin: await t.eval('location.origin'), bar: await t.eval('document.getElementById("move-bar") ? document.getElementById("move-bar").innerText : ""') };
  await t.close();
  const ok = a.origin === OLD && !a.bar && b.origin === OLD && /帶我過去（進度一起搬）/.test(b.bar);
  return { ok, detail: J({ a, b: { origin: b.origin, bar: b.bar.slice(0, 80) } }) };
};

/* 跑完所有情境、瀏覽器正常關掉之後,讀使用者資料夾的 Default/History(SQLite 的 urls 表,chrome://history、網址列建議、同步用的就是它):
   replaceState 改不了這裡,所以裡面任何一個網址都不能有明文的搬家碼(RU1Z:、RU1:)或題庫裡的字;有跑自動搬家時,要看得到加密過的 #auto=RU1E:(證明真的查到了那一站) */
const HISTORY_NAME = '瀏覽器的歷史紀錄檔(History)裡沒有明文的搬家碼,只有加密過的';
function historyCheck(dir, ranAuto) {
  const db = path.join(dir, 'Default', 'History');
  if (!fs.existsSync(db)) return { ok: false, detail: '沒有 History 檔' };
  const copy = path.join(dir, 'History-copy');
  fs.copyFileSync(db, copy);
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(copy, { readOnly: true });
  const urls = d.prepare('SELECT url FROM urls').all().map((r) => r.url);
  d.close();
  const plain = urls.filter((u) => /RU1Z?:|secretword|apple|%E8%87%AA/.test(u));
  const sealed = urls.filter((u) => /#auto=RU1E:/.test(u));
  return { ok: !plain.length && (!ranAuto || sealed.length > 0), detail: J({ rows: urls.length, plain: plain.map((u) => u.slice(0, 80)), sealed: sealed.length }) };
}

(async () => {
  if (!CHROME) { console.error('找不到 Chrome 或 Edge'); process.exit(2); }
  const srvs = [];
  for (const p of PORTS) srvs.push(await serve(p));
  const { proc, dir, ws } = await launch();
  let pass = 0;
  const only = args.indexOf('--only') > -1 ? args[args.indexOf('--only') + 1] : '';
  const names = Object.keys(T).filter((n) => !only || n.indexOf(only) > -1);
  try {
    const B = await connect(ws);
    B.dir = dir;
    for (const n of names) {
      let r;
      try { r = await T[n](B); } catch (e) { r = { ok: false, detail: '丟錯:' + (e && e.message) }; }
      if (r.ok) pass++;
      console.log((r.ok ? 'PASS ' : 'FAIL ') + n + '  →  ' + String(r.detail).slice(0, 400));
    }
    if (B.errors.length) console.log('頁面 JS 錯誤:' + B.errors.slice(0, 5).join(' | '));
    /* 正常關掉瀏覽器,歷史紀錄才會寫進檔案 */
    try { await Promise.race([B.send('Browser.close'), sleep(3000)]); } catch (e) { /* 照樣往下 */ }
    for (let i = 0; i < 50 && proc.exitCode === null; i++) await sleep(200);
    B.ws.close();
    const h = historyCheck(dir, names.some((n) => /自動搬家/.test(n)));
    if (h.ok) pass++;
    console.log((h.ok ? 'PASS ' : 'FAIL ') + HISTORY_NAME + '  →  ' + String(h.detail).slice(0, 400));
  } finally {
    if (proc.exitCode === null) proc.kill();
    srvs.forEach((s) => s.close());
    await sleep(1500);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('使用者資料夾沒刪掉:' + dir); }
  }
  console.log(pass + ' / ' + (names.length + 1) + ' 通過');
  process.exit(pass === names.length + 1 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
