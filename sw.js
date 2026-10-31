/* 衝衝英文 service worker(2026-10)
   只處理同網域的 GET:頁面網路優先,4 秒沒回應改給快取;JS、CSS、題庫資料等網路,真的連不上才用快取;
   拿快取版頁面的那一頁,它的 JS、CSS 也先拿快取,而且那次晚到的新版頁面不存(頁面和 JS 要一起更新)。圖片先給快取、背景更新。
   快取以檔名為準,不同頁面共用的 JS、CSS 只會留最後抓到的那一版:所以**每次上線只要改到網頁檔案就把 V 換新**
   (node tools/check_release.js 會檢查,--fix 自動換),舊快取整批作廢,不會拿新版共用檔配舊版頁面。
   不經手:跨網域(Supabase、jsDelivr、Google Fonts、Cloudflare)、非 GET、Range 請求、音檔、帶登入參數的頁面。
   這裡不讀寫學生的進度資料,只刪自己 ss- 開頭的快取。 */
const V = 'v20261031-1333';
const PAGES = 'ss-pages-' + V;
const ASSETS = 'ss-assets-' + V;
const IMAGES = 'ss-img-' + V;
const OFFLINE = '/offline.html';
const TIMEOUT = 4000;
const IMG_MAX = 80;
const AUTH_QS = /[?&](code|error|error_code|error_description|access_token|refresh_token|token_hash)=/;
const noop = () => {};
const cachedPages = new Set();   // 這次拿的是快取版 HTML 的頁面(client id)
/* 搬家(搬家計畫 3.5):舊網址轉址期第一次回來、有資料還沒搬的裝置,在離開之前先看到搬家頁。
   網域清單跟 js/move-config.js、tools/move-worker/worker.js 一樣(tools/test_move_core.js 檢查);後面那個是本機測試用的舊網址。
   只在舊網址:安裝時多存一份搬家頁與它載入的檔案(MOVE_ASSETS,tools/test_sw.js 從 move-out.html 讀出來比對);
   導覽的回應是轉址(opaqueredirect)而且有 ss-move-flag 這個記號(js/move-out.js 在「有資料、還沒搬」時建的空快取)時,改回存好的搬家頁。
   沒有記號照常放行;新網址完全不受影響。這裡讀不到 localStorage,也不碰學生的資料。
   舊網址的導覽拿到 503(Worker 的維護頁帶 x-rushup-maintenance: 1,切換當晚新網址憑證還沒好、或之後上游一時連不上)而且這一頁有快取:
   給快取的頁面(跟離線一樣,之後的 JS、CSS 也拿快取),沒快取才給維護頁;維護頁不進快取。 */
const MOVE_FROM = ['https://www.shuashualanguage.com', 'http://127.0.0.1:8931'];
const ON_OLD = MOVE_FROM.indexOf(self.location.origin) > -1;
const MOVE = 'ss-move-' + V;
const MOVE_FLAG = 'ss-move-flag';
const MOVE_PAGE = '/move-out.html';
const MOVE_ASSETS = [MOVE_PAGE, '/css/style.css', '/img/favicon.svg', '/js/move-config.js', '/js/cloud-config.js', '/js/common.js', '/js/sync-merge.js', '/js/pet-config.js',
  '/js/pet.js', '/js/cloud.js', '/js/move-rules.js', '/js/move-merge.js', '/js/move-pack.js', '/js/move-link.js', '/js/move-out.js', '/js/move-out-page.js'];

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
  if (ON_OLD) event.waitUntil(caches.open(MOVE).then((c) => Promise.all(MOVE_ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(noop)))).catch(noop));   // 存不到也不擋安裝
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) { /* 舊版 Safari 沒有 */ }
    }
    const keep = [PAGES, ASSETS, IMAGES, MOVE, MOVE_FLAG];
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
    event.respondWith(ON_OLD ? moveOnRedirect(networkFirst(event, PAGES, pageKey(url), true)) : networkFirst(event, PAGES, pageKey(url), true));
  } else if (req.destination === 'script' || req.destination === 'style' || req.destination === 'manifest') {
    const key = url.origin + url.pathname;
    event.respondWith(event.clientId && cachedPages.has(event.clientId) ? cacheFirst(event, ASSETS, key) : networkFirst(event, ASSETS, key, false));
  } else if (req.destination === 'image') {
    event.respondWith(staleWhileRevalidate(event, IMAGES, url.origin + url.pathname));
  }
});

/* 舊網址的導覽被轉址、這台有資料還沒搬:回存好的搬家頁(網址不變);拿不到就照常放行 */
async function moveOnRedirect(p) {
  const res = await p;
  if (!res || res.type !== 'opaqueredirect') return res;
  try {
    if (!(await caches.has(MOVE_FLAG))) return res;
    const page = await (await caches.open(MOVE)).match(MOVE_PAGE);
    return page || res;
  } catch (e) { return res; }
}

function pageKey(url) {
  let p = url.pathname;
  if (p.endsWith('/')) p += 'index.html';
  else if (p.split('/').pop().indexOf('.') < 0) p += '.html';   // GitHub Pages 的 /grammar 就是 grammar.html
  return url.origin + p;
}

function cacheable(res) { return res && res.ok && res.type === 'basic' && !res.redirected; }
function maintenance(res) { return !!res && res.status === 503 && (ON_OLD || res.headers.get('x-rushup-maintenance') === '1'); }

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
      const hit = (await (await caches.open(cacheName)).match(key)) || (ON_OLD ? await (await caches.open(MOVE)).match(key) : undefined);
      if (hit) return hit;
      throw err;
    });
  }
  /* 導覽拿到維護頁:有快取就給快取 */
  const pick = async (res) => {
    if (maintenance(res)) {
      const hit = await (await caches.open(cacheName)).match(key).catch(noop);
      if (hit) { markCached(event); return hit; }
    }
    return store(res);
  };
  return (async () => {
    let timer;
    const late = new Promise((r) => { timer = setTimeout(r, TIMEOUT); })
      .then(() => caches.open(cacheName)).then((c) => c.match(key)).then((hit) => hit && { hit });
    try {
      const first = await Promise.race([net.then((res) => ({ res })), late]);
      clearTimeout(timer);
      if (first && first.res) return pick(first.res);
      if (first && first.hit) { markCached(event); return first.hit; }   // 晚到的新版不存:這一頁用的是快取版 JS
      return pick(await net);               // 逾時又沒快取:繼續等網路,不回空白
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
