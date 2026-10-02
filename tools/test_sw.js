/* service worker 的邏輯測試:在模擬的 ServiceWorkerGlobalScope 裡跑 sw.js 與 tools/sw-killswitch.js。
   改 sw.js 之前與之後都要跑,全部通過才能上線。用法:node tools/test_sw.js */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const path = require('path');
const REPO = path.join(__dirname, '..');
const ORIGIN = 'https://www.shuashualanguage.com';
const TIME_SCALE = 0.01; // 4000ms timeout -> 40ms

function abs(u) { return new URL(typeof u === 'string' ? u : u.url, ORIGIN + '/').href; }

function mkRes(body, { status = 200, type = 'basic', redirected = false } = {}) {
  const r = new Response(body, { status });
  Object.defineProperty(r, 'type', { value: type });
  Object.defineProperty(r, 'redirected', { value: redirected });
  return r;
}

class MockCache {
  constructor() { this.map = new Map(); }
  async match(req) { const r = this.map.get(abs(req)); return r ? r.clone() : undefined; }
  async put(req, res) { const k = abs(req); this.map.delete(k); this.map.set(k, res); }
  async add(req) {
    const res = await state.fetch(req);
    if (!res.ok) throw new TypeError('add: bad status ' + res.status);
    await this.put(req, res);
  }
  async keys() { return [...this.map.keys()].map((url) => ({ url })); }
  async delete(req) { return this.map.delete(abs(req)); }
}
class MockCacheStorage {
  constructor() { this.store = new Map(); }
  async open(n) { if (!this.store.has(n)) this.store.set(n, new MockCache()); return this.store.get(n); }
  async keys() { return [...this.store.keys()]; }
  async delete(n) { return this.store.delete(n); }
  async match(req) { for (const c of this.store.values()) { const r = await c.match(req); if (r) return r; } return undefined; }
  dump() { const o = {}; for (const [n, c] of this.store) o[n] = [...c.map.keys()].map((k) => k.replace(ORIGIN, '')); return o; }
}

const state = { fetch: null, log: [] };

function loadWorker(file) {
  const listeners = {};
  const caches = new MockCacheStorage();
  const reg = { unregistered: false, preloadEnabled: false,
    navigationPreload: { enable: async () => { reg.preloadEnabled = true; } },
    unregister: async () => { reg.unregistered = true; return true; } };
  const self = {
    location: new URL(ORIGIN + '/sw.js'),
    registration: reg,
    skipped: false,
    skipWaiting() { self.skipped = true; return Promise.resolve(); },
    addEventListener(t, fn) { listeners[t] = fn; },
  };
  class SWRequest extends Request { constructor(u, init) { super(abs(u), init); } }
  const ctx = vm.createContext({
    self, caches, Request: SWRequest, Response, Headers, URL, Promise, console,
    fetch: (...a) => state.fetch(...a),
    setTimeout: (fn, ms) => setTimeout(fn, ms * TIME_SCALE), clearTimeout,
  });
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  return { listeners, caches, reg, self };
}

function mkEvent(extra = {}) {
  const ev = { waits: [], responded: null, ...extra };
  ev.waitUntil = (p) => { ev.waits.push(Promise.resolve(p)); };
  ev.respondWith = (p) => { ev.responded = Promise.resolve(p); };
  return ev;
}
function mkReq(path, { method = 'GET', mode = 'no-cors', destination = '', headers = {} } = {}) {
  return { url: path.startsWith('http') ? path : ORIGIN + path, method, mode, destination, headers: new Headers(headers) };
}
async function settle(ev) { for (let i = 0; i < 5; i++) await Promise.allSettled(ev.waits); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// network simulator
let net = { online: true, delay: 0, routes: {} };
state.fetch = async (req) => {
  const u = abs(req).replace(ORIGIN, '');
  state.log.push(u);
  if (net.delay) await sleep(net.delay);
  if (!net.online) throw new TypeError('Failed to fetch');
  const r = net.routes[u.split('?')[0]];
  if (r) return r();
  if (u.startsWith('/offline.html')) return mkRes('OFFLINE PAGE');
  return mkRes('NET ' + u.split('?')[0]);
};

const results = [];
async function t(name, fn) {
  try { await fn(); results.push('PASS ' + name); } catch (e) { results.push('FAIL ' + name + ' :: ' + e.message); }
}

(async () => {
  const W = loadWorker(REPO + '/sw.js');
  const fire = async (req, extra) => { const ev = mkEvent({ request: req, ...extra }); W.listeners.fetch(ev); return ev; };

  await t('install precaches offline.html + style.css, calls skipWaiting', async () => {
    W.caches.store.set('ss-pages-v0', new MockCache());
    W.caches.store.set('someone-else', new MockCache());
    const ev = mkEvent(); W.listeners.install(ev); await settle(ev);
    const d = W.caches.dump();
    assert.deepStrictEqual(d['ss-pages-v1'], ['/offline.html']);
    assert.deepStrictEqual(d['ss-assets-v1'], ['/css/style.css']);
    assert.ok(W.self.skipped);
  });
  await t('install without addRoutes support does not throw (event.addRoutes undefined)', async () => {});
  await t('install with addRoutes that rejects still installs', async () => {
    const W2 = loadWorker(REPO + '/sw.js');
    const ev = mkEvent({ addRoutes: () => Promise.reject(new TypeError('bad condition')) });
    W2.listeners.install(ev); const r = await Promise.allSettled(ev.waits);
    assert.ok(r.every((x) => x.status === 'fulfilled'));
  });
  await t('install with addRoutes that throws synchronously still installs', async () => {
    const W2 = loadWorker(REPO + '/sw.js');
    const ev = mkEvent({ addRoutes: () => { throw new TypeError('sync'); } });
    W2.listeners.install(ev); const r = await Promise.allSettled(ev.waits);
    assert.ok(r.length === 1 && r[0].status === 'fulfilled');
  });
  await t('activate enables navigation preload, deletes only stale ss- caches', async () => {
    const ev = mkEvent(); W.listeners.activate(ev); await settle(ev);
    assert.ok(W.reg.preloadEnabled);
    const names = Object.keys(W.caches.dump()).sort();
    assert.deepStrictEqual(names, ['someone-else', 'ss-assets-v1', 'ss-pages-v1']);
  });
  await t('passthrough: POST, cross-origin, Range, audio, video, /audio/, fetch() with empty destination', async () => {
    const cases = [
      mkReq('/rest', { method: 'POST' }),
      mkReq('https://abc.supabase.co/rest/v1/progress', { destination: '' }),
      mkReq('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', { destination: 'script' }),
      mkReq('https://fonts.googleapis.com/css2?family=x', { destination: 'style' }),
      mkReq('https://fonts.gstatic.com/s/a.woff2', { destination: 'font' }),
      mkReq('https://static.cloudflareinsights.com/beacon.min.js', { destination: 'script' }),
      mkReq('/audio/l1.mp3', { destination: 'audio', headers: { range: 'bytes=0-' } }),
      mkReq('/audio/l1.mp3', { destination: '' }),
      mkReq('/x.mp4', { destination: 'video' }),
      mkReq('/img/a.png', { destination: 'image', headers: { range: 'bytes=0-1' } }),
      mkReq('/data/q.json', { destination: '' }),
    ];
    for (const r of cases) { const ev = await fire(r); assert.strictEqual(ev.responded, null, 'responded to ' + r.url); }
  });
  await t('navigate online: network response returned, cached under normalized key', async () => {
    net = { online: true, delay: 0, routes: {} };
    const ev = await fire(mkReq('/grammar?u=7#top', { mode: 'navigate', destination: 'document' }));
    const res = await ev.responded; assert.strictEqual(await res.text(), 'NET /grammar');
    await settle(ev);
    assert.ok(W.caches.dump()['ss-pages-v1'].includes('/grammar.html'));
    const ev2 = await fire(mkReq('/', { mode: 'navigate', destination: 'document' })); await ev2.responded; await settle(ev2);
    assert.ok(W.caches.dump()['ss-pages-v1'].includes('/index.html'));
    assert.ok(!W.caches.dump()['ss-pages-v1'].some((k) => k.includes('?') || k.includes('#')));
  });
  await t('navigate uses preloadResponse when present (no extra fetch)', async () => {
    state.log = [];
    const ev = await fire(mkReq('/review.html', { mode: 'navigate', destination: 'document' }), { preloadResponse: Promise.resolve(mkRes('PRELOAD review')) });
    assert.strictEqual(await (await ev.responded).text(), 'PRELOAD review');
    await settle(ev); assert.deepStrictEqual(state.log, []);
    assert.ok(W.caches.dump()['ss-pages-v1'].includes('/review.html'));
  });
  await t('navigate offline, page cached: cached copy', async () => {
    net = { online: false, delay: 0, routes: {} };
    const ev = await fire(mkReq('/grammar.html?id=3', { mode: 'navigate', destination: 'document' }));
    assert.strictEqual(await (await ev.responded).text(), 'NET /grammar');
  });
  await t('navigate offline, page never cached: offline.html', async () => {
    const ev = await fire(mkReq('/history.html', { mode: 'navigate', destination: 'document' }), { preloadResponse: Promise.reject(new TypeError('preload failed')) });
    assert.strictEqual(await (await ev.responded).text(), 'OFFLINE PAGE');
  });
  await t('script offline, never cached: rejects (network error), no offline page', async () => {
    const ev = await fire(mkReq('/js/never.js', { destination: 'script' }));
    await assert.rejects(ev.responded);
  });
  await t('login-return navigation (?code=, ?error_description=): uses the preload, else the network; never cached', async () => {
    net = { online: true, delay: 0, routes: {} };
    state.log = [];
    let ev = await fire(mkReq('/index.html?code=abc', { mode: 'navigate', destination: 'document' }), { preloadResponse: Promise.resolve(mkRes('PRELOAD cb')) });
    assert.strictEqual(await (await ev.responded).text(), 'PRELOAD cb'); await settle(ev);
    assert.deepStrictEqual(state.log, []);
    ev = await fire(mkReq('/index.html?foo=1&error_description=x', { mode: 'navigate', destination: 'document' }));
    assert.strictEqual(await (await ev.responded).text(), 'NET /index.html'); await settle(ev);
    const pages = await W.caches.open('ss-pages-v1');
    assert.ok(!(await pages.keys()).some((k) => /code=|error/.test(k.url)));
  });
  await t('slow page (> timeout) with cache: cached copy served at timeout; the late new copy is NOT stored; a fast load stores it', async () => {
    net = { online: true, delay: 0, routes: { '/vocab.html': () => mkRes('v1 page') } };
    let ev = await fire(mkReq('/vocab.html', { mode: 'navigate', destination: 'document' })); await ev.responded; await settle(ev);
    net = { online: true, delay: 120, routes: { '/vocab.html': () => mkRes('v2 page') } }; // 120ms > 40ms scaled timeout
    ev = await fire(mkReq('/vocab.html', { mode: 'navigate', destination: 'document' }), { resultingClientId: 'slow-page' });
    assert.strictEqual(await (await ev.responded).text(), 'v1 page');
    await settle(ev);
    const c = await W.caches.open('ss-pages-v1'); assert.strictEqual(await (await c.match(ORIGIN + '/vocab.html')).text(), 'v1 page');
    net.delay = 0;
    ev = await fire(mkReq('/vocab.html', { mode: 'navigate', destination: 'document' }), { resultingClientId: 'fast-page' });
    assert.strictEqual(await (await ev.responded).text(), 'v2 page'); await settle(ev);
    assert.strictEqual(await (await c.match(ORIGIN + '/vocab.html')).text(), 'v2 page');
  });
  await t('two slow/offline loads in a row: page and its JS stay on the same version; a fast load moves both forward', async () => {
    net = { online: true, delay: 0, routes: { '/writing.html': () => mkRes('w1 page'), '/js/writing.js': () => mkRes('w1 js') } };
    for (const [p, o] of [['/writing.html', { mode: 'navigate', destination: 'document' }], ['/js/writing.js', { destination: 'script' }]]) { const e = await fire(mkReq(p, o)); await e.responded; await settle(e); }
    net = { online: true, delay: 120, routes: { '/writing.html': () => mkRes('w2 page'), '/js/writing.js': () => mkRes('w2 js') } };
    let nav = await fire(mkReq('/writing.html', { mode: 'navigate', destination: 'document' }), { resultingClientId: 'w-slow' });
    assert.strictEqual(await (await nav.responded).text(), 'w1 page');
    let js = await fire(mkReq('/js/writing.js', { destination: 'script' }), { clientId: 'w-slow' });
    assert.strictEqual(await (await js.responded).text(), 'w1 js');
    await settle(nav); await settle(js);
    net = { online: false, delay: 0, routes: {} };
    nav = await fire(mkReq('/writing.html', { mode: 'navigate', destination: 'document' }), { resultingClientId: 'w-off' });
    assert.strictEqual(await (await nav.responded).text(), 'w1 page');
    js = await fire(mkReq('/js/writing.js', { destination: 'script' }), { clientId: 'w-off' });
    assert.strictEqual(await (await js.responded).text(), 'w1 js');
    net = { online: true, delay: 0, routes: { '/writing.html': () => mkRes('w2 page'), '/js/writing.js': () => mkRes('w2 js') } };
    nav = await fire(mkReq('/writing.html', { mode: 'navigate', destination: 'document' }), { resultingClientId: 'w-fast' });
    assert.strictEqual(await (await nav.responded).text(), 'w2 page');
    js = await fire(mkReq('/js/writing.js', { destination: 'script' }), { clientId: 'w-fast' });
    assert.strictEqual(await (await js.responded).text(), 'w2 js');
    await settle(nav); await settle(js);
  });
  await t('slow script on a fresh page: waits for the network (no per-file timeout, no old/new mix)', async () => {
    net = { online: true, delay: 0, routes: { '/js/app.js': () => mkRes('v1 app') } };
    let ev = await fire(mkReq('/js/app.js?v=1', { destination: 'script' })); await ev.responded; await settle(ev);
    net = { online: true, delay: 120, routes: { '/js/app.js': () => mkRes('v2 app') } };
    ev = await fire(mkReq('/js/app.js', { destination: 'script' }), { clientId: 'fresh-page' });
    assert.strictEqual(await (await ev.responded).text(), 'v2 app');
    await settle(ev);
    const c = await W.caches.open('ss-assets-v1'); assert.strictEqual(await (await c.match(ORIGIN + '/js/app.js')).text(), 'v2 app');
  });
  await t('page served from cache: its scripts/styles also come from cache (same version), even if the network is fast', async () => {
    net = { online: true, delay: 0, routes: { '/reading.html': () => mkRes('old page'), '/js/reading.js': () => mkRes('old js') } };
    for (const [p, o] of [['/reading.html', { mode: 'navigate', destination: 'document' }], ['/js/reading.js', { destination: 'script' }]]) { const e = await fire(mkReq(p, o)); await e.responded; await settle(e); }
    net = { online: true, delay: 120, routes: { '/reading.html': () => mkRes('new page'), '/js/reading.js': () => mkRes('new js') } };
    const nav = await fire(mkReq('/reading.html', { mode: 'navigate', destination: 'document' }), { resultingClientId: 'page-A' });
    assert.strictEqual(await (await nav.responded).text(), 'old page');
    net.delay = 0;
    const js = await fire(mkReq('/js/reading.js', { destination: 'script' }), { clientId: 'page-A' });
    assert.strictEqual(await (await js.responded).text(), 'old js');
    const other = await fire(mkReq('/js/reading.js', { destination: 'script' }), { clientId: 'page-B' });
    assert.strictEqual(await (await other.responded).text(), 'new js');
    await settle(nav); await settle(js); await settle(other);
  });
  await t('page served from cache offline, script not cached: tries the network (rejects offline)', async () => {
    net = { online: true, delay: 0, routes: { '/analysis.html': () => mkRes('a page'), '/js/analysis.js': () => mkRes('a js') } };
    for (const [p, o] of [['/analysis.html', { mode: 'navigate', destination: 'document' }], ['/js/analysis.js', { destination: 'script' }]]) { const e = await fire(mkReq(p, o)); await e.responded; await settle(e); }
    net = { online: false, delay: 0, routes: {} };
    const nav = await fire(mkReq('/analysis.html', { mode: 'navigate', destination: 'document' }), { resultingClientId: 'page-C' });
    assert.strictEqual(await (await nav.responded).text(), 'a page');
    const js = await fire(mkReq('/js/uncached.js', { destination: 'script' }), { clientId: 'page-C' });
    await assert.rejects(js.responded);
    const cached = await fire(mkReq('/js/analysis.js', { destination: 'script' }), { clientId: 'page-C' });
    assert.strictEqual(await (await cached.responded).text(), 'a js');
  });
  await t('slow network (> timeout) without cache: keeps waiting for network', async () => {
    net = { online: true, delay: 120, routes: {} };
    const ev = await fire(mkReq('/learn.html', { mode: 'navigate', destination: 'document' }));
    assert.strictEqual(await (await ev.responded).text(), 'NET /learn.html');
  });
  await t('slow network then failure, no cache: offline page (rejection after timeout is caught)', async () => {
    net = { online: false, delay: 120, routes: {} };
    const ev = await fire(mkReq('/me.html', { mode: 'navigate', destination: 'document' }));
    assert.strictEqual(await (await ev.responded).text(), 'OFFLINE PAGE');
  });
  await t('non-cacheable responses are returned but not stored (404, opaque, redirected)', async () => {
    net = { online: true, delay: 0, routes: {
      '/missing.html': () => mkRes('404', { status: 404 }),
      '/js/redir.js': () => mkRes('R', { redirected: true }),
      '/img/op.png': () => mkRes('O', { type: 'opaque' }),
      '/img': () => mkRes('', { status: 0, type: 'opaqueredirect' }),
    } };
    for (const [p, o] of [['/missing.html', { mode: 'navigate', destination: 'document' }], ['/js/redir.js', { destination: 'script' }], ['/img/op.png', { destination: 'image' }], ['/img', { mode: 'navigate', destination: 'document' }]]) {
      const ev = await fire(mkReq(p, o)); await ev.responded; await settle(ev);
    }
    const all = Object.values(W.caches.dump()).flat();
    for (const k of ['/missing.html', '/js/redir.js', '/img/op.png', '/img.html', '/img']) assert.ok(!all.includes(k), k + ' was cached');
  });
  await t('image SWR: first from network, second from cache while revalidating, FIFO trim to 80', async () => {
    net = { online: true, delay: 0, routes: { '/img/a.svg': () => mkRes('A1') } };
    let ev = await fire(mkReq('/img/a.svg?x=1', { destination: 'image' }));
    assert.strictEqual(await (await ev.responded).text(), 'A1'); await settle(ev);
    net.routes['/img/a.svg'] = () => mkRes('A2');
    ev = await fire(mkReq('/img/a.svg', { destination: 'image' }));
    assert.strictEqual(await (await ev.responded).text(), 'A1'); await settle(ev);
    const c = await W.caches.open('ss-img-v1'); assert.strictEqual(await (await c.match(ORIGIN + '/img/a.svg')).text(), 'A2');
    for (let i = 0; i < 90; i++) { const e = await fire(mkReq('/img/art-' + i + '.svg', { destination: 'image' })); await e.responded; await settle(e); }
    const keys = W.caches.dump()['ss-img-v1'];
    assert.strictEqual(keys.length, 80); assert.ok(!keys.includes('/img/a.svg')); assert.ok(keys.includes('/img/art-89.svg'));
  });
  await t('image offline, never cached: rejects; offline cached: served', async () => {
    net = { online: false, delay: 0, routes: {} };
    let ev = await fire(mkReq('/img/nope.png', { destination: 'image' })); await assert.rejects(ev.responded); await settle(ev);
    ev = await fire(mkReq('/img/art-89.svg', { destination: 'image' }));
    assert.strictEqual(await (await ev.responded).text(), 'NET /img/art-89.svg'); await settle(ev);
  });
  await t('style + manifest handled network-first with pathname key', async () => {
    net = { online: true, delay: 0, routes: {} };
    for (const [p, d] of [['/css/style.css?v=9', 'style'], ['/manifest.json', 'manifest']]) { const ev = await fire(mkReq(p, { destination: d })); await ev.responded; await settle(ev); }
    const k = W.caches.dump()['ss-assets-v1']; assert.ok(k.includes('/css/style.css') && k.includes('/manifest.json'));
  });

  // kill switch
  const K = loadWorker(REPO + '/tools/sw-killswitch.js');
  await t('killswitch: no fetch listener, install skipWaiting, activate deletes only ss- caches and unregisters', async () => {
    assert.strictEqual(K.listeners.fetch, undefined);
    for (const n of ['ss-pages-v1', 'ss-assets-v1', 'ss-img-v1', 'ss-pages-v0', 'someone-else']) await K.caches.open(n);
    K.listeners.install(mkEvent()); assert.ok(K.self.skipped);
    const ev = mkEvent(); K.listeners.activate(ev); await settle(ev);
    assert.deepStrictEqual(Object.keys(K.caches.dump()), ['someone-else']);
    assert.ok(K.reg.unregistered);
  });

  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
  process.exit(fails ? 1 : 0);
})();
