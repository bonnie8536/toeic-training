/* 舊網址 Cloudflare Worker(tools/move-worker/worker.js)的測試,在 Node 裡用假的上游跑(搬家計畫 3.3、3.4、3.6、7.4)。
   PHASE A、B 兩版都跑:把原始碼的 PHASE 那一行換掉再載入。用法:node tools/test_worker.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'tools/move-worker/worker.js'), 'utf8');
const OLD = 'https://www.shuashualanguage.com';

/* up:假的上游。{ https: (url, init) => Response | 'fail', http: 同上 };log 記每次上游請求 */
function load(phase, up) {
  const log = [];
  const src = SRC.replace(/^const PHASE = '[AB]';/m, "const PHASE = '" + phase + "';").replace('export default', 'globalThis.__worker =');
  assert.ok(src.indexOf("const PHASE = '" + phase + "'") > -1);
  const ctx = {
    URL, Headers, Request, Response,
    fetch: async (u, init) => {
      log.push({ url: u, headers: Object.fromEntries(new Headers(init.headers)), redirect: init.redirect, method: init.method });
      const fn = /^https:/.test(u) ? up.https : up.http;
      const r = fn ? fn(u, init) : 'fail';
      if (r === 'fail') throw new TypeError('fetch failed');
      return r;
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { w: ctx.__worker, log };
}
const ok200 = (body, headers) => () => new Response(body || 'page', { status: 200, headers: headers || { 'content-type': 'text/html' } });
const req = (p, o) => new Request((o && o.scheme ? o.scheme : 'https') + '://' + (o && o.host ? o.host : 'www.shuashualanguage.com') + p, { method: (o && o.method) || 'GET', headers: (o && o.headers) || {} });
const NAV = { 'sec-fetch-mode': 'navigate', accept: 'text/html' };

const T = {};
T['不帶 www 的舊網址:A 階段 301 到帶 www 的舊網址(資料在那邊、看得到搬家提示),B 階段 301 到新網址;同一路徑與查詢字串,帶 Cache-Control'] = async () => {
  for (const [ph, want] of [['A', OLD + '/grammar.html?id=3'], ['B', 'https://www.rushuplanguage.com/grammar.html?id=3']]) {
    const { w, log } = load(ph, { https: ok200() });
    const r = await w.fetch(req('/grammar.html?id=3', { host: 'shuashualanguage.com' }));
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), want, ph);
    assert.equal(r.headers.get('cache-control'), 'max-age=3600');
    assert.equal(log.length, 0);
  }
};
T['沒有加密的 http(帶不帶 www、哪個階段、哪一頁):一律先 301 到 https 的帶 www 舊網址同一路徑,不代理、不回搬家頁、不寫 cookie'] = async () => {
  for (const ph of ['A', 'B']) {
    const { w, log } = load(ph, { https: ok200('MOVE PAGE') });
    for (const host of ['www.shuashualanguage.com', 'shuashualanguage.com']) {
      for (const p of ['/me.html', '/move-out.html', '/', '/grammar.html?id=2', '/move-ping.txt']) {
        const r = await w.fetch(req(p, { scheme: 'http', host, headers: Object.assign({ cookie: 'tr_hd=1' }, NAV) }));
        assert.equal(r.status, 301, ph + ' ' + host + p);
        assert.equal(r.headers.get('location'), OLD + p, ph + ' ' + host + p);
        assert.equal(r.headers.get('set-cookie'), null);
      }
    }
    assert.equal(log.length, 0, ph + ' 不該抓上游');
  }
};
T['A:https 代理回來的頁面帶 HSTS(之後瀏覽器自己改走 https)'] = async () => {
  const { w } = load('A', { https: ok200() });
  const r = await w.fetch(req('/grammar.html', { headers: NAV }));
  assert.match(r.headers.get('strict-transport-security') || '', /^max-age=[0-9]+$/);
};
T['A:代理新網址,轉送原本的標頭(Range、If-None-Match),拿掉 cookie 與 host,不自動跟著轉址'] = async () => {
  const { w, log } = load('A', { https: () => new Response('part', { status: 206, headers: { 'content-range': 'bytes 0-3/100', etag: '"x"' } }) });
  const r = await w.fetch(req('/audio/l1.mp3', { headers: { range: 'bytes=0-3', 'if-none-match': '"x"', cookie: 'tr_hd=1; other=2', accept: '*/*' } }));
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 0-3/100');
  assert.equal(log[0].url, 'https://www.rushuplanguage.com/audio/l1.mp3');
  assert.equal(log[0].headers.range, 'bytes=0-3');
  assert.equal(log[0].headers['if-none-match'], '"x"');
  assert.equal(log[0].headers.cookie, undefined);
  assert.equal(log[0].headers.host, undefined);
  assert.equal(log[0].redirect, 'manual');
};
T['A:304 照原樣回;HEAD 照轉'] = async () => {
  const { w, log } = load('A', { https: () => new Response(null, { status: 304 }) });
  assert.equal((await w.fetch(req('/js/common.js', { headers: { 'if-none-match': '"a"' } }))).status, 304);
  await w.fetch(req('/index.html', { method: 'HEAD' }));
  assert.equal(log[1].method, 'HEAD');
};
T['A:上游轉址指到新網址(https 或 http)改回舊網址;指到別的網站、相對路徑不動'] = async () => {
  for (const [loc, want] of [['https://www.rushuplanguage.com/learn/', OLD + '/learn/'], ['http://www.rushuplanguage.com/learn/?a=1', OLD + '/learn/?a=1'], ['/learn/', '/learn/'],
    ['https://www.rushuplanguage.com', OLD], ['https://example.com/x', 'https://example.com/x'], ['https://www.rushuplanguage.com.evil.com/', 'https://www.rushuplanguage.com.evil.com/']]) {
    const { w } = load('A', { https: () => new Response(null, { status: 301, headers: { location: loc } }) });
    const r = await w.fetch(req('/learn'));
    assert.equal(r.headers.get('location'), want, loc);
  }
};
T['A:上游的 set-cookie 拿掉;請求有 tr_hd=1 或 tr_moved=1 時由伺服器續寫 400 天;沒有就不寫'] = async () => {
  const { w } = load('A', { https: ok200('x', { 'set-cookie': 'gh=1', 'content-type': 'text/html' }) });
  const a = await w.fetch(req('/', { headers: { cookie: 'tr_hd=1' } }));
  assert.equal(a.headers.get('set-cookie'), 'tr_hd=1; Max-Age=34560000; Path=/; Secure; SameSite=Lax');
  const b = await w.fetch(req('/', { headers: { cookie: 'tr_hd=10; xtr_moved=1' } }));
  assert.equal(b.headers.get('set-cookie'), null);
  const c = await w.fetch(req('/', { headers: { cookie: 'a=1; tr_moved=1' } }));
  assert.equal(c.headers.get('set-cookie'), 'tr_moved=1; Max-Age=34560000; Path=/; Secure; SameSite=Lax');
};
T['A:不加 Cross-Origin-Opener-Policy、不加 Clear-Site-Data'] = async () => {
  const { w } = load('A', { https: ok200() });
  const r = await w.fetch(req('/move-in.html', { headers: NAV }));
  assert.equal(r.headers.get('cross-origin-opener-policy'), null);
  assert.equal(r.headers.get('clear-site-data'), null);
};
T['新網址 https 連不上(丟錯):不改抓 http,直接回 503 維護頁、Retry-After、不轉址'] = async () => {
  const one = load('A', { https: () => 'fail', http: ok200('via http') });
  const m = await one.w.fetch(req('/grammar.html'));
  assert.equal(m.status, 503);
  assert.deepEqual(one.log.map((x) => x.url), ['https://www.rushuplanguage.com/grammar.html']);
  assert.equal(m.headers.get('retry-after'), '300');
  assert.equal(m.headers.get('cache-control'), 'no-store');
  assert.equal(m.headers.get('location'), null);
  assert.equal(m.headers.get('x-rushup-maintenance'), '1');   // 舊網址的 service worker 看到這個記號,有快取的頁面就給快取
  assert.match(await m.text(), /你的進度都還在這台裝置上/);
  assert.equal(SRC.indexOf('http://www.rushuplanguage.com'), -1, '程式裡不該再有 http 的新網址');
};
T['新網址憑證還沒好(Cloudflare 回 520 到 530,例如 526):當成連不上,回 503 維護頁,不把錯誤頁給學生'] = async () => {
  for (const code of [520, 521, 522, 523, 524, 525, 526, 530]) {
    const { w, log } = load('A', { https: () => new Response('<h1>Error ' + code + '</h1>', { status: code, headers: { 'content-type': 'text/html' } }) });
    const r = await w.fetch(req('/grammar.html', { headers: NAV }));
    assert.equal(r.status, 503, String(code));
    assert.equal(log.length, 1);
    assert.match(await r.text(), /網站正在搬家/);
  }
  const { w } = load('A', { https: () => new Response('err', { status: 500 }) });
  assert.equal((await w.fetch(req('/x.html'))).status, 500);   // 新網址自己的錯誤照轉
};
T['GitHub Pages 還沒認得新網域(Site not found 的 404):回 503 維護頁;網站自己的 404 照轉'] = async () => {
  const gh = '<!DOCTYPE html><html><head><title>Site not found &middot; GitHub Pages</title></head><body><h1>404</h1><p><strong>There isn&#39;t a GitHub Pages site here.</strong></p></body></html>';
  const a = load('A', { https: () => new Response(gh, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', server: 'GitHub.com' } }) });
  assert.equal((await a.w.fetch(req('/index.html', { headers: NAV }))).status, 503);
  const b = load('A', { https: () => new Response('<h1>File not found</h1>', { status: 404, headers: { 'content-type': 'text/html', server: 'GitHub.com' } }) });
  const r = await b.w.fetch(req('/nope.html', { headers: NAV }));
  assert.equal(r.status, 404);
  assert.match(await r.text(), /File not found/);
  const c = load('B', { https: () => new Response(gh, { status: 404, headers: { 'content-type': 'text/html' } }) });
  assert.equal((await c.w.fetch(req('/move-out.html'))).status, 503);
};
T['上游轉址改回舊網址之後指到同一個網址(會一直轉):回 503 維護頁,不回 301'] = async () => {
  for (const loc of ['https://www.rushuplanguage.com/grammar.html', 'https://www.rushuplanguage.com/grammar.html?a=1']) {
    const { w } = load('A', { https: () => new Response(null, { status: 301, headers: { location: loc, 'cache-control': 'max-age=600' } }) });
    const r = await w.fetch(req(loc.slice('https://www.rushuplanguage.com'.length)));
    assert.equal(r.status, 503, loc);
    assert.equal(r.headers.get('location'), null);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  const { w } = load('A', { https: () => new Response(null, { status: 301, headers: { location: 'https://www.rushuplanguage.com/learn/' } }) });
  const r = await w.fetch(req('/learn'));
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), OLD + '/learn/');
};
T['演練版 Worker(tools/build_rehearsal_worker.js):只換三個網域,代理演練的新網址、轉址改回 Worker 的網址、憑證不對回 503'] = async () => {
  const { build } = require('./build_rehearsal_worker.js');
  const WH = 'rushup-move-worker.example.workers.dev', NP = 'https://rushup-move-new.pages.dev';
  const src = build(SRC, { old: WH, new: NP });
  const lines = (s) => s.replace(/\r\n/g, '\n').split('\n');   // Windows 上 git 取出來的是 CRLF
  const diff = lines(src).slice(1).filter((l, i) => l !== lines(SRC)[i]);
  assert.deepEqual(diff, ["const NEW = '" + NP + "';", "const NEW_HOST = 'rushup-move-new.pages.dev';", "const OLD_WWW = '" + WH + "';"]);
  const up = (status, headers) => () => new Response(status === 200 ? 'page' : null, { status, headers: headers || {} });
  const run = async (respond, p) => {
    const log = [];
    const ctx = { URL, Headers, Request, Response, fetch: async (u) => { log.push(u); return respond(u); } };
    ctx.globalThis = ctx; vm.createContext(ctx);
    vm.runInContext(src.replace('export default', 'globalThis.__worker ='), ctx);
    const r = await ctx.__worker.fetch(new Request('https://' + WH + p, { headers: NAV }));
    return { r, log };
  };
  const a = await run(up(200), '/grammar.html');
  assert.equal(a.r.status, 200);
  assert.deepEqual(a.log, [NP + '/grammar.html']);
  const b = await run(up(308, { location: NP + '/grammar' }), '/grammar.html');
  assert.equal(b.r.headers.get('location'), 'https://' + WH + '/grammar');
  const c = await run(up(526), '/');
  assert.equal(c.r.status, 503);
  assert.throws(() => build(SRC, { old: 'https://x', new: NP }));
  assert.throws(() => build('nothing here', { old: WH, new: NP }));
};
T['POST、PUT 等:405'] = async () => {
  for (const ph of ['A', 'B']) {
    const { w, log } = load(ph, { https: ok200() });
    assert.equal((await w.fetch(req('/', { method: 'POST' }))).status, 405);
    assert.equal(log.length, 0);
  }
};
T['B:沒有 cookie 的導覽與檔案一律 301(首頁也是,網址變更要這個);301 自己組,帶 Cache-Control'] = async () => {
  const { w, log } = load('B', { https: ok200() });
  for (const p of ['/', '/grammar.html?id=2', '/js/vocab.js', '/audio/a.mp3', '/move-outx', '/move-out.html.bak']) {
    const r = await w.fetch(req(p, { headers: NAV }));
    assert.equal(r.status, 301, p);
    assert.equal(r.headers.get('location'), 'https://www.rushuplanguage.com' + p);
    assert.equal(r.headers.get('cache-control'), 'max-age=3600');
  }
  assert.equal(log.length, 0);
};
T['B:搬家頁(帶不帶 .html)、ping、sw.js 與搬家頁載入的每個檔案永遠代理、不轉址'] = async () => {
  const { w } = load('B', { https: ok200() });
  const html = fs.readFileSync(path.join(REPO, 'move-out.html'), 'utf8');
  const assets = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u)).map((u) => '/' + u.replace(/^\.?\//, ''));
  const keep = eval('(' + /const KEEP_ASSETS = (\[[\s\S]*?\]);/.exec(SRC)[1] + ')');
  assert.deepEqual([...keep].sort(), [...new Set(assets)].sort(), 'KEEP_ASSETS 要跟 move-out.html 載入的檔案一樣');
  for (const p of ['/move-out', '/move-out.html', '/move-ping.txt', '/sw.js'].concat(keep)) {
    const r = await w.fetch(req(p));
    assert.equal(r.status, 200, p);
  }
};
T['B:導覽帶 tr_hd=1、沒有 tr_moved=1:回搬家頁的內容(網址不變、不快取);搬好的、不是導覽的照常 301'] = async () => {
  const { w, log } = load('B', { https: (u) => new Response(u.endsWith('/move-out.html') ? 'MOVE PAGE' : 'other', { status: 200 }) });
  const r = await w.fetch(req('/grammar.html', { headers: Object.assign({ cookie: 'tr_hd=1' }, NAV) }));
  assert.equal(await r.text(), 'MOVE PAGE');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(log[0].url, 'https://www.rushuplanguage.com/move-out.html');
  const accOnly = await w.fetch(req('/index.html', { headers: { cookie: 'tr_hd=1', accept: 'text/html,application/xhtml+xml' } }));
  assert.equal(await accOnly.text(), 'MOVE PAGE');
  const doneR = await w.fetch(req('/grammar.html', { headers: Object.assign({ cookie: 'tr_hd=1; tr_moved=1' }, NAV) }));
  assert.equal(doneR.status, 301);
  const img = await w.fetch(req('/img/a.png', { headers: { cookie: 'tr_hd=1', accept: 'image/*' } }));
  assert.equal(img.status, 301);
};

/* 要貼到 Cloudflare 的那一份在 repo 外(D:/claudecode/刷刷英文開發/搬家/worker/舊網址worker_貼上用.js):改了這裡要一起換、線上 Worker 也要重貼。
   那份不在這台(別的電腦、CI)就略過 */
T['tools/move-worker/worker.js 跟貼上用那一份(repo 外)一樣'] = async () => {
  const p = path.join(REPO, '..', '刷刷英文開發', '搬家', 'worker', '舊網址worker_貼上用.js');
  if (!fs.existsSync(p)) return;
  const n = (s) => s.replace(/\r\n/g, '\n');
  assert.equal(n(fs.readFileSync(p, 'utf8')), n(SRC), '兩份不一樣:改了 tools/move-worker/worker.js 要把貼上用那份一起換掉(線上 Worker 也要重貼)');
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const n of names) {
    try { await T[n](); pass++; console.log('PASS ' + n); }
    catch (e) { console.log('FAIL ' + n + '  →  ' + (e && e.message)); }
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
