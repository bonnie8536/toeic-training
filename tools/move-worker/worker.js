/* 衝衝英文:舊網址 www.shuashualanguage.com 與 shuashualanguage.com 的 Cloudflare Worker(搬家計畫第三節)。
   用法:Cloudflare → Workers & Pages → 建一個 Worker,把這整份貼上;切換日在 Settings → Domains & Routes 加兩條 Route
   (www.shuashualanguage.com/*、shuashualanguage.com/*),再把舊網域原本的 DNS 紀錄改成 Proxied(紀錄不刪,名字一直查得到)。
   這個 Worker 回應每一個請求,不會轉給 GitHub。步驟在 D:/claudecode/刷刷英文開發/搬家/步驟_Cloudflare.md。
   測試:node tools/test_worker.js(PHASE A、B 每一條路徑)。
   - 沒有加密的 http(帶不帶 www、哪個階段):最先處理,一律 301 到 https 的帶 www 舊網址同一路徑。以前 GitHub Pages 的 Enforce HTTPS 做這件事,
     Worker 接手之後要自己做:http 是另一個網域(localStorage 是空的、看不到進度,搬家程式也不載),登入密碼與網頁程式也不能走沒加密的路。
     B 階段也先到 https 的舊網址,不直接到新網址:有資料的裝置帶的 tr_hd cookie 只在 https 送出,到了那裡 Worker 才看得到、給它搬家頁。
     https 代理回來的回應加 Strict-Transport-Security(不含子網域),之後瀏覽器自己改走 https。
   - 不帶 www 的舊網址:PHASE A 301 到帶 www 的舊網址同一路徑(以前 GitHub 就是這樣轉的;資料在帶 www 的那邊,要在那裡看到搬家提示),
     PHASE B 301 到新網址同一路徑。
   - PHASE 'A' 重疊期(切換日起 8 週):帶 www 的舊網址整站代理新網址,瀏覽器看到的網域還是舊的,讀得到舊網址的資料,網站照常能用,
     搬家提示由頁面上的 js/move-out.js 處理。轉送原本的請求標頭(只拿掉 cookie 與 host),Range(iPhone 播音檔)與 If-None-Match 照轉。
     上游的轉址如果指到新網址(https 或 http),改回舊網址;改完如果就是這次請求的網址(會一直轉),改回 503 維護頁。上游的 set-cookie 拿掉;請求帶著 tr_hd=1(這台有舊資料)或 tr_moved=1
     (搬好了)時,由伺服器續寫這兩個 cookie(Safari 對程式寫的 cookie 只留 7 天,伺服器寫的不受這條限制)。
   - PHASE 'B' 轉址期:搬家頁、ping、sw.js 與搬家頁載入的檔案(KEEP_ASSETS,測試從 move-out.html 讀出來比對)照樣代理、永遠不轉址;
     導覽請求帶 tr_hd=1、沒有 tr_moved=1:回搬家頁的內容(網址不變),讓他按;其他一律 301 到新網址同一路徑加查詢字串。
     301 自己組回應,帶 Cache-Control(前 4 週 3600 秒,穩定後改 86400):瀏覽器記住的 301 連 Worker 都碰不到。
   - 新網址連不上就回 503 維護頁(不快取、不帶任何轉址、帶 x-rushup-maintenance: 1,舊網址的 service worker 看到它就改給存好的頁面),不改抓 http:舊網址存著學生的資料,在那裡跑的網頁與程式一定要走 HTTPS 拿。
     「連不上」包括:fetch 丟錯、Cloudflare 自己產生的 520 到 530(新網址憑證還沒好時 Worker 拿到的是 526,不會丟錯)、
     GitHub Pages 還不認得新網域時的「Site not found」404。新網址自己的 404、500 照轉。
   - 不加 Cross-Origin-Opener-Policy(加了 window.opener 會變 null,搬家就斷了)、不加 Clear-Site-Data(會清掉學生的進度)。
   - 只接受 GET、HEAD,其他回 405(網站是靜態的)。
   換階段:改 PHASE 那一行重新部署,不用動 DNS。 */
const PHASE = 'A';
const REDIRECT_MAX_AGE = 3600;
const NEW = 'https://www.rushuplanguage.com';
const NEW_HOST = 'www.rushuplanguage.com';
const OLD_WWW = 'www.shuashualanguage.com';
const KEEP_PATHS = [/^\/move-out(\.html)?$/, /^\/move-ping\.txt$/, /^\/sw\.js$/];
const KEEP_ASSETS = ['/css/style.css', '/img/favicon.svg', '/js/move-config.js', '/js/cloud-config.js', '/js/common.js', '/js/sync-merge.js', '/js/pet-config.js',
  '/js/pet.js', '/js/cloud.js', '/js/move-rules.js', '/js/move-merge.js', '/js/move-pack.js', '/js/move-link.js', '/js/move-out.js', '/js/move-out-page.js'];
const COOKIE_AGE = 34560000;   // 400 天,Chrome 的上限
const HSTS = 'max-age=31536000';

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const tail = url.pathname + url.search;
    if (url.protocol === 'http:') return moved('https://' + OLD_WWW + tail);
    if (url.hostname !== OLD_WWW) return moved((PHASE === 'B' ? NEW : 'https://' + OLD_WWW) + tail);
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    const ck = req.headers.get('cookie') || '';
    const hasData = /(?:^|;\s*)tr_hd=1(?:;|$)/.test(ck);
    const done = /(?:^|;\s*)tr_moved=1(?:;|$)/.test(ck);
    if (PHASE === 'B' && !kept(url.pathname)) {
      if (isNav(req) && hasData && !done) return proxy(req, '/move-out.html', hasData, done, true);
      return moved(NEW + tail);
    }
    return proxy(req, tail, hasData, done, false);
  },
};

function kept(p) { return KEEP_PATHS.some((r) => r.test(p)) || KEEP_ASSETS.indexOf(p) > -1; }

function isNav(req) {
  return req.headers.get('sec-fetch-mode') === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') > -1;
}

function moved(to) {
  return new Response(null, { status: 301, headers: { location: to, 'cache-control': 'max-age=' + REDIRECT_MAX_AGE } });
}

async function proxy(req, tail, hasData, done, asMovePage) {
  const fwd = new Headers(req.headers);
  fwd.delete('cookie');
  fwd.delete('host');
  let res;
  try { res = await fetch(NEW + tail, { method: req.method, headers: fwd, redirect: 'manual' }); }
  catch (e) { return maintenance(); }
  if (await unreachable(res)) return maintenance();
  const h = new Headers(res.headers);
  const loc = h.get('location');
  if (loc) {
    const to = oldLocation(loc);
    if (to !== loc) {
      if (to === req.url) return maintenance();   // 改回舊網址之後就是這個網址:回 301 會一直轉
      h.set('location', to);
    }
  }
  h.delete('set-cookie');
  if (hasData) h.append('set-cookie', 'tr_hd=1; Max-Age=' + COOKIE_AGE + '; Path=/; Secure; SameSite=Lax');
  if (done) h.append('set-cookie', 'tr_moved=1; Max-Age=' + COOKIE_AGE + '; Path=/; Secure; SameSite=Lax');
  if (asMovePage) h.set('cache-control', 'no-store');
  h.set('strict-transport-security', HSTS);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/* 新網址那邊其實沒有回應:Cloudflare 自己產生的 52x(憑證不對、連不上源站),或 GitHub Pages 還不認得這個網域 */
async function unreachable(res) {
  if (res.status >= 520 && res.status <= 530) return true;
  if (res.status !== 404) return false;
  if ((res.headers.get('content-type') || '').indexOf('text/html') < 0) return false;
  try { return /Site not found|t a GitHub Pages site here/.test(await res.clone().text()); } catch (e) { return false; }
}

/* 上游轉址指到新網址(https 或 http)的,改成舊網址同一路徑;其他(別的網站、相對路徑)不動 */
function oldLocation(loc) {
  let u;
  try { u = new URL(loc); } catch (e) { return loc; }
  if (u.hostname !== NEW_HOST || (u.protocol !== 'https:' && u.protocol !== 'http:') || u.port) return loc;
  return 'https://' + OLD_WWW + loc.replace(/^https?:\/\/[^/?#]+/i, '');
}

function maintenance() {
  return new Response('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>衝衝英文搬家中</title>'
    + '<body style="font-family:system-ui,sans-serif;max-width:32em;margin:3em auto;padding:0 16px;line-height:1.7"><h1 style="font-size:1.3em">網站正在搬家</h1>'
    + '<p>請過一陣子再打開。你的進度都還在這台裝置上，不會不見。</p></body></html>',
  { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '300', 'cache-control': 'no-store', 'x-rushup-maintenance': '1' } });
}
