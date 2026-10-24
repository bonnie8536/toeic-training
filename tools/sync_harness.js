/* 多台裝置同步測試共用的假環境(tools/test_sync_union.js、tools/test_sync_fuzz.js 用;不是測試檔,不單獨跑)。
   - 一個假的 Supabase(所有裝置共用同一個 db,同一個帳號),支援 select().eq()/in()、upsert(一列或多列,多列一起成功或一起失敗)。
   - 每台裝置自己的 localStorage、分頁暫存、時鐘偏差、離線開關;頁面在 node 的 vm 沙盒裡載入真的 js/sync-merge.js 與 js/cloud.js
     (或 tools/fixtures/cloud_sync_base.js:main 4c823ec 那一版、沒有合併表的舊版 cloud.js,當「部署前就開著的舊版頁面」)。
   - 頁面寫入照新版 js/vocab.js 的做法:每次寫入前重讀本機、用 SYNC_MERGE 的戳記函式改、先存刪除標記再存題庫(store.set = 寫本機 + CLOUD.push)。
   每一次請求記在 dev.ops:{ op: 'read' | 'write' | 'teachers', keys: [...] }。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const SCRIPTS = {
  cloud: new vm.Script(read('js/cloud.js'), { filename: 'js/cloud.js' }),
  old: new vm.Script(read('tools/fixtures/cloud_sync_base.js'), { filename: 'cloud_sync_base.js' }),
  sm: new vm.Script(read('js/sync-merge.js'), { filename: 'js/sync-merge.js' }),
};

const USER = { id: '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72', email: 's@x.com', user_metadata: { name: '學生' } };
const PID = 'c' + USER.id.replace(/-/g, '');
const PREFIX = 'tr_u' + PID + '_';
const LEDGER = 'tr_unsynced_' + USER.id;
const SB_KEY = 'sb-x-auth-token';
const T0 = Date.parse('2026-10-24T12:00:00+08:00');
const J = x => JSON.stringify(x);
const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/* 固定種子的亂數(mulberry32);SYNC_MERGE 的 _r 也用它,同一個種子每次跑結果一樣 */
function makeRand(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    key: i => { const a = Array.from(m.keys()); return i < a.length ? a[i] : null; },
    get length() { return m.size; },
  };
}
const tick = async (n) => { for (let i = 0; i < (n || 4); i++) await new Promise(r => setImmediate(r)); };

/* 一個帳號的雲端 + 共用時鐘;rand 給 SYNC_MERGE 的 _r 與測試自己用 */
function makeWorld(seed) {
  const rand = makeRand(seed || 1);
  const world = { db: [], clock: { t: T0 }, rand, devices: [] };
  const ctx = { Math: Object.assign(Object.create(Math), { random: () => rand() }) };
  ctx.window = ctx;
  vm.createContext(ctx);
  SCRIPTS.sm.runInContext(ctx);
  world.SM = ctx.SYNC_MERGE;
  return world;
}
function token(dev) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const iat = Math.floor(dev.world.clock.t / 1000);
  return b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: USER.id, iat, exp: iat + 3600 }) + '.sig';
}
function makeClient(dev) {
  const w = dev.world;
  return {
    auth: {
      getSession: async () => {
        if (dev.offline && dev.tokenExpired) return { data: { session: null }, error: { message: 'TypeError: Failed to fetch' } };
        if (!dev.local.getItem(SB_KEY)) return { data: { session: null }, error: null };
        return { data: { session: { user: USER, access_token: token(dev) } } };
      },
      signInWithPassword: async () => {
        if (dev.offline) return { data: {}, error: { message: 'TypeError: Failed to fetch' } };
        dev.local.setItem(SB_KEY, J({ access_token: 'a', user: USER }));
        return { data: { user: USER, session: { user: USER } }, error: null };
      },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => { dev.local.removeItem(SB_KEY); return { error: null }; },
    },
    rpc: async () => ({ data: null, error: null }),
    from(table) {
      const q = { op: null, filters: {}, inKeys: null, rows: null };
      const b = {
        select() { q.op = 'select'; return b; },
        eq(c, v) { q.filters[c] = v; return b; },
        in(c, v) { if (c === 'k') q.inKeys = v.slice(); else q.filters[c] = v; return b; },
        upsert(rows) { q.op = 'upsert'; q.rows = Array.isArray(rows) ? rows : [rows]; return b; },
        then(ok, bad) { return run().then(ok, bad); },
      };
      async function run() {
        if (table === 'teachers') { dev.ops.push({ op: 'teachers' }); return dev.offline ? { data: null, error: { message: 'TypeError: Failed to fetch' } } : { data: [], error: null }; }
        if (table !== 'progress') return { data: null, error: null };
        if (q.op === 'select') {
          const keys = q.inKeys || (q.filters.k !== undefined ? [q.filters.k] : ['*']);
          dev.ops.push({ op: 'read', keys, viaIn: !!q.inKeys });
          if (dev.readGate) await dev.readGate;
          if (dev.offline) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
          if (dev.readError && keys[0] !== '*') return { data: null, error: { message: 'JWT expired', code: 'PGRST301' } };
          if (dev.onRead) { const f = dev.onRead; dev.onRead = null; f(); }
          const rows = w.db.filter(r => r.user_id === q.filters.user_id && (keys[0] === '*' || keys.indexOf(r.k) >= 0));
          return { data: clone(rows), error: null };
        }
        if (q.op === 'upsert') {
          const t0 = w.db.find(r => r.user_id === USER.id && r.k === 'sync_del');
          dev.ops.push({ op: 'write', keys: q.rows.map(r => r.k), rows: clone(q.rows), tombsInCloud: t0 ? clone(t0.v) : null });
          if (dev.writeGate) await dev.writeGate;
          if (dev.offline) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
          if (dev.writeError) return { data: null, error: { message: 'value too large' } };
          q.rows.forEach(row0 => {
            const row = clone(row0);
            const i = w.db.findIndex(r => r.user_id === row.user_id && r.k === row.k);
            if (i >= 0) w.db[i] = row; else w.db.push(row);
          });
        }
        return { data: null, error: null };
      }
      return b;
    },
  };
}

/* 一台裝置。opt.old:這台的頁面是部署前的舊版(舊版 cloud.js、沒有 sync-merge.js);opt.noSm:新版 cloud.js 但頁面沒載到 sync-merge.js */
function makeDevice(world, name, opt) {
  opt = opt || {};
  const dev = { world, name, old: !!opt.old, noSm: !!opt.noSm, local: makeStorage(), session: makeStorage(), offline: false, skew: 0,
    confirms: [], confirmAnswer: false, reloads: 0, events: [], ops: [], pg: null, snapshot: null };
  world.devices.push(dev);
  return dev;
}
function loadPage(dev) {
  const w = dev.world;
  const timers = new Map(); let tid = 0;
  const listeners = {};
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(w.clock.t + dev.skew); }
    static now() { return w.clock.t + dev.skew; }
  }
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    Date: FakeDate, CustomEvent,
    Math: Object.assign(Object.create(Math), { random: () => w.rand() }),
    setTimeout: fn => { const id = ++tid; timers.set(id, fn); return id; },
    clearTimeout: id => { timers.delete(id); },
    localStorage: dev.local,
    sessionStorage: dev.session,
    location: { hash: '', search: '', pathname: '/vocab.html', origin: 'https://x', href: 'https://x/vocab.html', reload() { dev.reloads++; } },
    history: { replaceState() {} },
    document: {
      visibilityState: 'visible',
      addEventListener(ev, fn) { (listeners['doc:' + ev] = listeners['doc:' + ev] || []).push(fn); },
      createElement() { return {}; },
      head: { appendChild() {} },
    },
    confirm: msg => { dev.confirms.push(msg); return dev.confirmAnswer; },
    navigator: { get onLine() { return !dev.offline; } },
    atob: s => Buffer.from(s, 'base64').toString('latin1'),
  };
  ctx.window = ctx;
  ctx.addEventListener = (ev, fn) => { (listeners['win:' + ev] = listeners['win:' + ev] || []).push(fn); };
  ctx.dispatchEvent = e => { dev.events.push(e); return true; };
  ctx.CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'k' };
  ctx.supabase = { createClient: () => makeClient(dev) };
  try { ctx.__PROFILE_ID = JSON.parse(dev.local.getItem('tr_current_profile')) || null; } catch (e) { ctx.__PROFILE_ID = null; }
  vm.createContext(ctx);
  if (!dev.old && !dev.noSm) SCRIPTS.sm.runInContext(ctx);
  (dev.old ? SCRIPTS.old : SCRIPTS.cloud).runInContext(ctx);
  const pg = {
    ctx, dev, closed: false,
    ready: ctx.CLOUD.ready.then(() => tick()),
    /* 跑現在排著的計時器一輪(0.8 秒去抖動的上傳);跑的時候新排的(讀雲端的逾時)留著 */
    async runTimers() { const fns = [...timers.values()]; timers.clear(); for (const f of fns) await f(); await tick(); },
    pending() { return timers.size; },
    close() { timers.clear(); pg.closed = true; },
    async fire(name) { (listeners[name] || []).forEach(f => f()); await tick(); },
  };
  dev.pg = pg;
  return pg;
}
/* 開頁:灌資料後會重載,重載後再開一次(跟真的瀏覽器一樣) */
async function open(dev) {
  const r0 = dev.reloads;
  let pg = loadPage(dev); await pg.ready;
  if (dev.reloads > r0) { pg.close(); pg = loadPage(dev); await pg.ready; }
  dev.snapshot = banksOf(dev);
  return pg;
}
/* 第一次在這台登入(或登出後重新登入) */
async function signIn(dev) {
  dev.local.setItem(SB_KEY, J({ access_token: 'a', expires_at: 1, user: USER }));
  dev.session = makeStorage();
  return open(dev);
}
/* 隔天、或 App 被關掉重開:新的工作階段(會再灌一次雲端資料) */
async function newSession(dev) {
  if (dev.pg) dev.pg.close();
  dev.session = makeStorage();
  return open(dev);
}
async function logout(dev) {
  const r0 = dev.reloads;
  await dev.pg.ctx.CLOUD.logout(); await tick();
  const done = dev.reloads > r0;
  if (done) { dev.pg.close(); await open(dev); }
  return done;
}
const loggedIn = dev => dev.local.getItem('tr_current_profile') === J(PID) && !!dev.local.getItem(SB_KEY);

const banksOf = dev => { const raw = dev.local.getItem(PREFIX + 'vgame_banks'); return raw === null ? [] : JSON.parse(raw); };
const tombsOf = dev => { const raw = dev.local.getItem(PREFIX + 'sync_del'); return raw === null ? null : JSON.parse(raw); };
const localOf = (dev, k) => { const raw = dev.local.getItem(PREFIX + k); return raw === null ? null : JSON.parse(raw); };
const cloudOf = (world, k) => { const r = world.db.find(r => r.user_id === USER.id && r.k === k); return r ? clone(r.v) : undefined; };
const ledgerOf = dev => JSON.parse(dev.local.getItem(LEDGER) || '{}');
function setCloud(world, k, v, at) {
  const row = { user_id: USER.id, k, v: clone(v), updated_at: new Date(at || world.clock.t).toISOString() };
  const i = world.db.findIndex(r => r.user_id === USER.id && r.k === k);
  if (i >= 0) world.db[i] = row; else world.db.push(row);
}

/* ---------- 頁面寫入(store.set = 寫本機 + CLOUD.push;時鐘走 1 秒) ---------- */
function storeSet(dev, k, v) {
  dev.world.clock.t += 1000;
  const id = dev.pg.ctx.__PROFILE_ID;
  dev.local.setItem('tr_' + (id ? 'u' + id + '_' : '') + k, J(v));
  dev.pg.ctx.CLOUD.push(k, v);
}
const now = dev => dev.world.clock.t + dev.skew;
/* 新版頁面:每次寫入前重讀本機,改到才存 */
function edit(dev, id, fn) {
  const SM = dev.world.SM, before = banksOf(dev);
  const after = SM.editBank(before, id, now(dev) + 1000, fn);
  if (after !== before) storeSet(dev, 'vgame_banks', after);
  return after;
}
function newBank(dev, name) {
  const id = dev.world.SM.newBankId(now(dev));
  edit(dev, id, b => Object.assign({}, b, { name }));
  return id;
}
const addWords = (dev, id, list) => edit(dev, id, b => dev.world.SM.addWords(b, list, now(dev) + 1000));
const setWord = (dev, id, en, patch) => edit(dev, id, b => dev.world.SM.setWord(b, dev.world.SM.norm(en), patch, now(dev) + 1000));
const rename = (dev, id, name) => edit(dev, id, b => Object.assign({}, b, { name }));
/* 刪除:先存刪除標記再存題庫(只有雲端帳號的資料夾才寫標記,跟 js/vocab.js 一樣) */
function del(dev, d) {
  const before = banksOf(dev);
  if (d.banks === before) return false;
  if (String(dev.pg.ctx.__PROFILE_ID || '').charAt(0) === 'c') storeSet(dev, 'sync_del', d.tombs);
  storeSet(dev, 'vgame_banks', d.banks);
  return true;
}
const deleteWord = (dev, id, en) => del(dev, dev.world.SM.deleteWord(banksOf(dev), tombsOf(dev), id, dev.world.SM.norm(en), now(dev) + 1000));
const deleteBank = (dev, id) => del(dev, dev.world.SM.deleteBank(banksOf(dev), tombsOf(dev), id, now(dev) + 1000));
/* 舊版頁面:編輯頁開著時記住的那一份陣列(snapshot),改完整份寫回(js/vocab.js 舊版的 renderBankEdit/persist) */
function oldEdit(dev, mutate) {
  const arr = clone(dev.snapshot || []);
  mutate(arr);
  dev.snapshot = arr;
  storeSet(dev, 'vgame_banks', arr);
}
const oldOpenEditor = dev => { dev.snapshot = banksOf(dev); };
/* 模擬考交卷(js/mock.js:讀本機、加一筆、留 30 筆) */
function mockSubmit(dev, score) {
  const h = localOf(dev, 'mock_history') || [];
  h.push({ d: new Date(now(dev)).toISOString(), size: 'mini', lRaw: score, lTotal: 10, rRaw: score, rTotal: 10, lScore: score * 10, rScore: score * 10 });
  storeSet(dev, 'mock_history', h.slice(-30));
}

/* 題庫裡有哪些字(題庫 id|norm(en)|字的 _r) */
function idents(banks) {
  const out = new Set();
  (Array.isArray(banks) ? banks : []).forEach(b => {
    if (!b || typeof b.id !== 'string' || !Array.isArray(b.words)) return;
    b.words.forEach(w => { if (w && typeof w.en === 'string') out.add(b.id + '|' + String(w.en).toLowerCase().trim().replace(/\s+/g, ' ') + '|' + (w._r || '')); });
  });
  return out;
}
const wordKeys = banks => new Set([...idents(banks)].map(s => s.split('|').slice(0, 2).join('|')));

module.exports = {
  USER, PID, PREFIX, LEDGER, SB_KEY, T0, J, clone, tick, makeRand, makeStorage, makeWorld, makeDevice, loadPage, open, signIn, newSession, logout, loggedIn,
  banksOf, tombsOf, localOf, cloudOf, ledgerOf, setCloud, storeSet, now, edit, newBank, addWords, setWord, rename, deleteWord, deleteBank,
  oldEdit, oldOpenEditor, mockSubmit, idents, wordKeys, read,
};
