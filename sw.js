/* 刷刷英文 service worker(2026-10)
   只處理同網域的 GET:頁面網路優先,4 秒沒回應改給快取;JS、CSS、題庫資料等網路,真的連不上才用快取;
   拿快取版頁面的那一頁,它的 JS、CSS 也先拿快取,而且那次晚到的新版頁面不存(頁面和 JS 要一起更新)。圖片先給快取、背景更新。
   快取以檔名為準,不同頁面共用的 JS、CSS 只會留最後抓到的那一版:所以**每次上線只要改到網頁檔案就把 V 換新**
   (node tools/check_release.js 會檢查,--fix 自動換),舊快取整批作廢,不會拿新版共用檔配舊版頁面。
   不經手:跨網域(Supabase、jsDelivr、Google Fonts、Cloudflare)、非 GET、Range 請求、音檔、帶登入參數的頁面。
   這裡不讀寫學生的進度資料,只刪自己 ss- 開頭的快取。 */
const V = 'v20261004-1939';
const PAGES = 'ss-pages-' + V;
const ASSETS = 'ss-assets-' + V;
const IMAGES = 'ss-img-' + V;
const OFFLINE = '/offline.html';
const TIMEOUT = 4000;
const IMG_MAX = 80;
const AUTH_QS = /[?&](code|error|error_code|error_description|access_token|refresh_token|token_hash)=/;
const noop = () => {};
const cachedPages = new Set();   // 這次拿的是快取版 HTML 的頁面(client id)

self.addEventListener('install', (event) => {
  /* Chrome 123+:音檔連 service worker 都不叫醒;其他瀏覽器靠 fetch 裡的判斷 */
  if (event.addRoutes) {
    try {
      event.waitUntil(event.addRoutes([
        { condition: { requestDestination: 'audio' }, source: 'network' },
        { condition: { urlPattern: '/audio/*' }, source: 'network' },
      ]).catch(noop));
    } catch (e) { /* 不支援就跳過 */ }
  }
  event.waitUntil(Promise.all([
    caches.open(PAGES).then((c) => c.add(new Request(OFFLINE, { cache: 'reload' }))),
    caches.open(ASSETS).then((c) => c.add(new Request('/css/style.css', { cache: 'reload' }))),
  ]));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) { /* 舊版 Safari 沒有 */ }
    }
    const keep = [PAGES, ASSETS, IMAGES];
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('ss-') && !keep.includes(n)).map((n) => caches.delete(n)));
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has('range') || req.destination === 'audio' || req.destination === 'video' || url.pathname.startsWith('/audio/')) return;
  if (req.mode === 'navigate') {
    if (AUTH_QS.test(url.search)) {   // 登入回來的網址:照樣走網路、不進快取;要用掉預先載入,不然瀏覽器會抓兩次
      event.respondWith((async () => (event.preloadResponse && (await event.preloadResponse.catch(noop))) || fetch(req))());
      return;
    }
    event.respondWith(networkFirst(event, PAGES, pageKey(url), true));
  } else if (req.destination === 'script' || req.destination === 'style' || req.destination === 'manifest') {
    const key = url.origin + url.pathname;
    event.respondWith(event.clientId && cachedPages.has(event.clientId) ? cacheFirst(event, ASSETS, key) : networkFirst(event, ASSETS, key, false));
  } else if (req.destination === 'image') {
    event.respondWith(staleWhileRevalidate(event, IMAGES, url.origin + url.pathname));
  }
});

function pageKey(url) {
  let p = url.pathname;
  if (p.endsWith('/')) p += 'index.html';
  else if (p.split('/').pop().indexOf('.') < 0) p += '.html';   // GitHub Pages 的 /grammar 就是 grammar.html
  return url.origin + p;
}

function cacheable(res) { return res && res.ok && res.type === 'basic' && !res.redirected; }

function networkFirst(event, cacheName, key, isNav) {
  const net = (async () => {
    const pre = isNav && event.preloadResponse ? await event.preloadResponse.catch(noop) : undefined;
    return pre || (await fetch(event.request));
  })();
  const store = (res) => {
    if (cacheable(res)) {
      const copy = res.clone();
      event.waitUntil(caches.open(cacheName).then((c) => c.put(key, copy)).catch(noop));
    }
    return res;
  };
  event.waitUntil(net.then(noop, noop));
  if (!isNav) {   // 不設逾時:各檔各自逾時的話,慢網路下一頁會拼出新舊版本混雜的檔案
    return net.then(store, async (err) => {
      const hit = await (await caches.open(cacheName)).match(key);
      if (hit) return hit;
      throw err;
    });
  }
  return (async () => {
    let timer;
    const late = new Promise((r) => { timer = setTimeout(r, TIMEOUT); })
      .then(() => caches.open(cacheName)).then((c) => c.match(key)).then((hit) => hit && { hit });
    try {
      const first = await Promise.race([net.then((res) => ({ res })), late]);
      clearTimeout(timer);
      if (first && first.res) return store(first.res);
      if (first && first.hit) { markCached(event); return first.hit; }   // 晚到的新版不存:這一頁用的是快取版 JS
      return store(await net);              // 逾時又沒快取:繼續等網路,不回空白
    } catch (err) {
      clearTimeout(timer);
      const hit = await (await caches.open(cacheName)).match(key);
      if (hit) { markCached(event); return hit; }
      const off = await caches.match(OFFLINE);
      if (off) { markCached(event); return off; }
      throw err;
    }
  })();
}

/* 這一頁拿的是快取版:記下它,之後它載入的 JS、CSS 也先拿快取 */
function markCached(event) {
  if (!event.resultingClientId) return;
  if (cachedPages.size > 100) cachedPages.clear();
  cachedPages.add(event.resultingClientId);
}

async function cacheFirst(event, cacheName, key) {
  const hit = await (await caches.open(cacheName)).match(key);
  return hit || networkFirst(event, cacheName, key, false);
}

function staleWhileRevalidate(event, cacheName, key) {
  const net = fetch(event.request).then((res) => {
    if (cacheable(res)) {
      const copy = res.clone();
      event.waitUntil(caches.open(cacheName).then((c) => c.put(key, copy).then(() => trim(c, IMG_MAX))).catch(noop));
    }
    return res;
  });
  event.waitUntil(net.then(noop, noop));
  return caches.open(cacheName).then((c) => c.match(key)).then((hit) => hit || net);
}

async function trim(cache, max) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}
