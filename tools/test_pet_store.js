/* 小雞寫回(路線圖 1.2c,規格在 repo 外的 小雞規格.md 第 9 節):js/pet-store.js 什麼時候寫、寫到哪裡、會不會蓋掉雲端。
   用法:node tools/test_pet_store.js
   載入真的 js/common.js(store、logAttempt)、js/cloud.js(帳本、上傳、readKey)、js/pet.js、js/pet-config.js、js/pet-store.js,
   配假的 Supabase、假的 localStorage、假的時鐘與計時器(跟 tools/test_sync.js 同一套做法)。
   鐵則:只寫 pet 這一個鍵;寫雲端之前一定先讀雲端那一份合併;讀不到雲端就只寫本機、不記帳、不上傳。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const SRC = {
  common: read('js/common.js'),
  cloud: read('js/cloud.js'),
  pet: read('js/pet.js'),
  food: fs.existsSync(path.join(REPO, 'js/pet-food.js')) ? read('js/pet-food.js') : '',
  config: fs.existsSync(path.join(REPO, 'js/pet-config.js')) ? read('js/pet-config.js') : '',
  store: fs.existsSync(path.join(REPO, 'js/pet-store.js')) ? read('js/pet-store.js') : '',
};
/* 第二階段第 1 步的相容版(線上 27557eb 的 js/pet.js 與 js/pet-store.js 原樣複製):開 opt.step1 時用它們 */
const STEP1 = { pet: read('tools/fixtures/pet_step1.js'), store: read('tools/fixtures/pet_store_step1.js'),
  /* 舊分頁連 cloud.js 也是舊的(27557eb,cloud 的 builder 存的原樣複製);沒有這個檔就用現在的 */
  cloud: fs.existsSync(path.join(REPO, 'tools/fixtures/cloud_step1.js')) ? read('tools/fixtures/cloud_step1.js') : read('js/cloud.js') };

const USER = { id: '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72', email: 's@x.com', user_metadata: { name: '學生' } };
const PID = 'c' + USER.id.replace(/-/g, '');
const PREFIX = 'tr_u' + PID + '_';
const LEDGER = 'tr_unsynced_' + USER.id;
const SB_KEY = 'sb-x-auth-token';
const PETKEY = PREFIX + 'pet';
const GUESTKEY = 'tr_pet';

/* 台北時間 'YYYY-MM-DD HH:MM:SS' 轉成時間戳 */
function tp(s) { return Date.parse(s.replace(' ', 'T') + '+08:00'); }
function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
const TODAY = '2026-10-16';
const YDAY = addDays(TODAY, -1);
/* 某天(台北)做了 n 題,每題隔 10 秒 */
function dayHist(d, n, m = 'p5', hour = '09') {
  const t0 = tp(d + ' ' + hour + ':00:00');
  return Array.from({ length: n }, (_, i) => ({ m, id: m + '-' + d + '-' + hour + '-' + i, c: 0, ok: true, t: t0 + i * 10000 }));
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
/* 一台裝置:自己的 localStorage 與分頁暫存;db 可以跟另一台共用(同一個帳號的雲端) */
function makeWorld(db) {
  return { db: db || [], local: makeStorage(), session: makeStorage(), offline: false, reloads: 0, clock: { t: tp(TODAY + ' 12:00:00') }, keyReads: [], upserts: [], events: [] };
}
/* 伺服器發的登入憑證(JWT):iat 是伺服器簽發的時間。w.server 是伺服器的時間(預設跟這台的時鐘一樣,就是時鐘準);
   w.noToken 時 session 沒有 access_token,w.badToken 時憑證解不開 */
function token(w, user) {
  if (w.noToken) return undefined;
  if (w.badToken) return 'not-a-jwt';
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const iat = Math.floor((w.server !== undefined ? w.server : w.clock.t) / 1000) - (w.tokenAge || 0);
  return b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: user.id, iat, exp: iat + 3600 }) + '.sig';
}
function makeClient(w) {
  return {
    auth: {
      getSession: async () => {
        if (w.noSession) return { data: { session: null }, error: null };
        if (w.sessionUser) return { data: { session: { user: w.sessionUser, access_token: token(w, w.sessionUser) } } };
        return w.offline && w.tokenExpired
          ? { data: { session: null }, error: { message: 'TypeError: Failed to fetch' } }
          : { data: { session: { user: USER, access_token: token(w, USER) } } };
      },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({ error: null }),
    },
    rpc: async () => ({ error: null }),
    from(table) {
      const q = { op: null, filters: {}, row: null };
      const b = {
        select() { q.op = 'select'; return b; },
        eq(c, v) { q.filters[c] = v; return b; },
        upsert(row) { q.op = 'upsert'; q.row = row; return b; },
        then(ok, bad) { return run().then(ok, bad); },
      };
      async function run() {
        if (w.offline) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
        if (table === 'teachers') return { data: [], error: null };
        if (table !== 'progress') return { data: null, error: null };
        if (q.op === 'select') {
          if (q.filters.k !== undefined) {
            w.keyReads.push(Object.assign({}, q.filters));
            if (w.readGate) await w.readGate;
            if (w.offline) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
            if (w.beforeReadReturns) { const f = w.beforeReadReturns; w.beforeReadReturns = null; f(); }
          }
          return { data: w.db.filter(r => r.user_id === q.filters.user_id && (q.filters.k === undefined || r.k === q.filters.k)).map(r => JSON.parse(JSON.stringify(r))), error: null };
        }
        if (q.op === 'upsert') {
          const row = JSON.parse(JSON.stringify(q.row));
          w.upserts.push(row.k);
          const i = w.db.findIndex(r => r.user_id === row.user_id && r.k === row.k);
          if (i >= 0) w.db[i] = row; else w.db.push(row);
          return { data: null, error: null };
        }
        return { data: null, error: null };
      }
      return b;
    },
  };
}
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

/* 開一頁:opt.on 是 PET_ON(預設 true),opt.search 是網址的 ?,opt.noCloud 是沒填雲端設定的網站;
   opt.step1:載入第 1 步的相容版(連 cloud.js 也是舊的;opt.newCloud 時用現在的 cloud.js,opt.oldCloud 時新版也配舊的 cloud.js);opt.food、opt.roam、opt.from:PET_FOOD、PET_ROAM_V2、PET_FOOD_FROM(沒給就照 pet-config.js);
   opt.merged:true 時假裝 cloud.js 已經是先合併再上傳的新版(CLOUD.mergedKeys 有 pet),false 時拿掉 */
function loadPage(w, opt) {
  opt = opt || {};
  const timers = new Map(); let tid = 0;
  const delays = new Map();   // 每個計時器排的毫秒數(runShort 只跑短的)
  const listeners = {};
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(w.clock.t); }
    static now() { return w.clock.t; }
  }
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    Date: FakeDate, CustomEvent,
    setTimeout: (fn, ms) => { const id = ++tid; timers.set(id, fn); delays.set(id, Number(ms) || 0); return id; },
    clearTimeout: id => { timers.delete(id); delays.delete(id); },
    localStorage: w.local,
    sessionStorage: w.session,
    location: { hash: '', search: opt.search || '', pathname: '/index.html', origin: 'https://x', href: 'https://x/index.html' + (opt.search || ''), reload() { w.reloads++; } },
    history: { replaceState() {} },
    document: {
      visibilityState: 'visible',
      addEventListener(ev, fn) { (listeners['doc:' + ev] = listeners['doc:' + ev] || []).push(fn); },
      createElement() { return {}; },
      head: { appendChild() {} },
      querySelector() { return null; }, querySelectorAll() { return []; },
    },
    confirm: () => true,
    navigator: { get onLine() { return !w.offline; } },
    URLSearchParams,
    atob: s => Buffer.from(s, 'base64').toString('latin1'),
  };
  ctx.window = ctx;
  ctx.addEventListener = (ev, fn) => { (listeners['win:' + ev] = listeners['win:' + ev] || []).push(fn); };
  ctx.dispatchEvent = e => { w.events.push(e.type); (w.evs = w.evs || []).push({ type: e.type, detail: e.detail }); return true; };
  ctx.CLOUD_CONFIG = opt.noCloud ? {} : { url: 'https://x.supabase.co', anonKey: 'k' };
  ctx.supabase = { createClient: () => makeClient(w) };
  vm.createContext(ctx);
  vm.runInContext(SRC.common + '\n;globalThis.__api = { store, logAttempt };', ctx);
  vm.runInContext((opt.step1 || opt.oldCloud) && !opt.newCloud ? STEP1.cloud : SRC.cloud, ctx);
  vm.runInContext(opt.step1 ? STEP1.pet : SRC.pet, ctx);
  if (!opt.step1 && SRC.food) vm.runInContext(SRC.food, ctx);
  /* 相容版配新的 cloud.js 時,cloud.js 找不到 PET.cloudMerge 就不上傳 pet;要比的是 pet-store 本身的行為,所以借新版的合併函式給它 */
  if (opt.step1 && opt.lendMerge) { const c2 = { console }; vm.createContext(c2); vm.runInContext(SRC.pet, c2); if (c2.PET.cloudMerge) ctx.PET.cloudMerge = c2.PET.cloudMerge; }
  if (SRC.config) vm.runInContext(SRC.config, ctx);
  ctx.PET_ON = opt.on === undefined ? true : opt.on;
  if (opt.food !== undefined) ctx.PET_FOOD = opt.food;
  if (opt.roam !== undefined) ctx.PET_ROAM_V2 = opt.roam;
  if (opt.from !== undefined) ctx.PET_FOOD_FROM = opt.from;
  if (opt.merged === true) ctx.CLOUD.mergedKeys = Object.freeze(['pet']);
  if (opt.merged === false) delete ctx.CLOUD.mergedKeys;
  if (!SRC.store) throw new Error('js/pet-store.js 還不存在');
  vm.runInContext(opt.step1 ? STEP1.store : SRC.store, ctx);
  const S = ctx.PET_STORE;
  return {
    ctx, S,
    ready: ctx.CLOUD.ready.then(tick).then(() => S && S.ready).then(tick),
    /* 排程中的計時器全部跑完(跑的過程又排的也跑,最多 6 輪);不等小雞的同步佇列,免得卡在等逾時計時器的 readKey */
    async runTimers() { for (let n = 0; n < 6 && timers.size; n++) { const fns = [...timers.values()]; timers.clear(); for (const f of fns) await f(); await tick(); } await tick(); },
    /* 只跑排了 max 毫秒以內的計時器一輪(例如 earn 等雲端的上限;讀雲端 8 秒的逾時、答題後 4 秒的同步不跑) */
    async runShort(max) { const ids = [...timers.keys()].filter(i => delays.get(i) <= max); for (const i of ids) { const f = timers.get(i); timers.delete(i); delays.delete(i); if (f) await f(); } await tick(); },
    async fire(name) { (listeners[name] || []).forEach(f => f()); await tick(); },
    answer(m, id) { w.clock.t += 10000; ctx.__api.logAttempt(m, id, 0, true); },
  };
}
/* 已登入、這個分頁已經灌過雲端資料的頁面 */
async function openLoggedIn(w, opt) {
  w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
  let pg = loadPage(w, opt); await pg.ready;     // 新工作階段:灌資料後 reload
  pg = loadPage(w, opt); await pg.ready;         // reload 後的頁面
  await pg.runTimers();
  return pg;
}
function setLocal(w, k, v) { w.local.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }
function cloudRow(w, k, v, at) { w.db.push({ user_id: USER.id, k, v, updated_at: at || '2026-10-15T00:00:00.000Z' }); }
const lp = (w, k) => { const raw = w.local.getItem(k || PETKEY); return raw === null ? null : JSON.parse(raw); };
const cp = w => { const r = w.db.find(r => r.user_id === USER.id && r.k === 'pet'); return r ? r.v : undefined; };
const ledger = w => JSON.parse(w.local.getItem(LEDGER) || '{}');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/* pet 以外的東西(本機每個鍵、帳本裡 pet 以外的項目、雲端每一列)全部轉成字串:比對「其他鍵一個 byte 都沒變」用 */
function others(w) {
  const o = {};
  for (let i = 0; i < w.local.length; i++) {
    const k = w.local.key(i);
    if (k === PETKEY || k === GUESTKEY) continue;
    if (k === LEDGER) { const l = JSON.parse(w.local.getItem(k)); delete l.pet; o[k] = JSON.stringify(l); continue; }
    o[k] = w.local.getItem(k);
  }
  const db = w.db.filter(r => r.k !== 'pet' && r.k !== '_meta').map(r => JSON.stringify(r)).sort();
  return JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]])) + '|' + JSON.stringify(db);
}
const sum = days => Object.values(days || {}).reduce((a, b) => a + b, 0);
const J = x => JSON.stringify(x);
const NEWK = ['got', 'ate', 'foodOld', 'once', 'roam'];
const FROM = addDays(TODAY, -10);            // 食物上線日
const FOOD = { food: true, from: FROM };     // 打開食物
const evs = (w, type) => (w.evs || []).filter(e => e.type === type).map(e => e.detail);
/* 從現在起本機 pet 每一次被寫進去的內容(不論誰寫) */
function recordPetWrites(w) {
  const log = [];
  const orig = w.local.setItem;
  w.local.setItem = (k, v) => { if (k === PETKEY || k === GUESTKEY) log.push(String(v)); return orig(k, v); };
  return log;
}
const looksV2 = s => /"v":2/.test(s) || /"(got|ate|foodOld|once|roam)":/.test(s);
/* n 張某種食物的券,放在今天以前的 n 天 */
function ticketsBefore(food, n) { const got = {}; for (let i = 1; i <= n; i++) got[addDays(TODAY, -i)] = { ['r:t' + i]: food }; return got; }
/* cloud.js 是不是先合併再上傳的新版(規格 A.5):是的話讀不到雲端時 pet-store 改用 store.set(記帳),帳本上會有 pet */
const merged = pg => { try { const k = pg.ctx.CLOUD.mergedKeys; return Array.isArray(k) && k.indexOf('pet') >= 0; } catch (e) { return false; } };
/* 讀不到雲端時記帳交給 cloud.js:要 cloud.js 是先合併的新版,而且第二階段的開關打開了(第 3 步;第 2 步時同一台可能還開著第 1 步的分頁,它的 cloud.js 補傳不先合併,第二輪審查 X1) */
const ledgers = pg => merged(pg) && !!pg.S && (pg.S.food === true || pg.S.roamV2 === true);

/* 第二階段的紀錄(v2):第一階段的欄位加上食物與走動開關。第 1 步的相容版只能看、一筆都不寫 */
function v2Pet(over) {
  const days = {}, met = [];
  for (let i = 9; i >= 0; i--) { const d = addDays(TODAY, -i); days[d] = 25; met.push(d); }
  return Object.assign({ v: 2, born: addDays(TODAY, -9), goals: [], days, met, oldMet: 0, oldBefore: '', fed: { [TODAY]: 25 }, name: '小黃', nameAt: 5,
    got: { [YDAY]: { d: 'corn' } }, ate: { [YDAY]: { mh2lq01xk7: YDAY + '/d' } }, foodOld: { before: '2026-07-05', got: { corn: 2 }, ate: {} }, once: { diag: YDAY }, roam: { on: false, at: 1793000000000 } }, over || {});
}
/* 從現在起數本機 pet 被寫了幾次(不論誰寫) */
function countPetWrites(w) {
  const c = { n: 0 };
  const orig = w.local.setItem;
  w.local.setItem = (k, v) => { if (k === PETKEY || k === GUESTKEY) c.n++; return orig(k, v); };
  return c;
}
/* 同步、餵飼料、改目標、取名各 3 次,外加答題後的自動同步 */
async function pokeAll(pg, w) {
  const res = [];
  for (let i = 0; i < 3; i++) {
    res.push(await pg.S.sync()); res.push(await pg.S.feed()); res.push(await pg.S.setGoal(40)); res.push(await pg.S.rename('啾' + i));
    w.clock.t += 2 * 60e3;
    await pg.fire('doc:visibilitychange'); await pg.fire('win:online'); await pg.runTimers(); await pg.S.idle();
  }
  return res;
}
/* 答題(會寫 hist,這是練習本身的寫入)之後的自動同步 */
async function answerAll(pg) {
  for (let i = 0; i < 3; i++) { pg.answer('p5', 'poke-' + i); await pg.runTimers(); await pg.S.idle(); }
}
/* 唯讀時每個動作都回 ok:false,而且什麼都沒寫 */
const allRefused = res => res.length === 12 && res.every(r => r && r.ok === false && r.uploaded !== true);

const scenarios = {
  /* ---------- 開關 ---------- */
  '1. PET_ON 關著:不讀雲端、不寫任何東西,餵食等動作回 off': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 5));
    const pg = await openLoggedIn(w, { on: false });
    const before = others(w) + '|' + w.local.getItem(PETKEY) + '|' + JSON.stringify(w.db);
    const r = await pg.S.feed();
    await pg.fire('doc:visibilitychange'); await pg.fire('win:online'); await pg.runTimers();
    const after = others(w) + '|' + w.local.getItem(PETKEY) + '|' + JSON.stringify(w.db);
    return { ok: pg.S.on === false && before === after && !w.keyReads.length && lp(w) === null && r && r.ok === false && r.reason === 'off',
             detail: 'on=' + pg.S.on + ' / 寫入 ' + (before === after ? '沒有' : '有') + ' / 讀雲端 ' + w.keyReads.length + ' 次 / feed ' + JSON.stringify(r) };
  },
  '2. 網址 ?pet=1 可以預覽(PET_ON 關著也打開)': async () => {
    const w = makeWorld();
    w.noSession = true;   // 訪客:supabase-js 沒有登入
    setLocal(w, 'tr_hist', dayHist(TODAY, 4));
    const pg = loadPage(w, { on: false, search: '?pet=1' }); await pg.ready;
    const p = lp(w, GUESTKEY);
    return { ok: pg.S.on === true && !!p && p.days[TODAY] === 4, detail: 'on=' + pg.S.on + ' / 本機 ' + JSON.stringify(p && p.days) };
  },

  /* ---------- 訪客與沒有雲端 ---------- */
  '3. 訪客:只寫訪客資料夾的 pet,不讀雲端、不記帳、不上傳,hist 一個 byte 都沒變': async () => {
    const w = makeWorld();
    w.noSession = true;
    setLocal(w, 'tr_hist', dayHist(TODAY, 6));
    setLocal(w, 'tr_drill_p5', ['x']);
    const before = others(w);
    const pg = loadPage(w); await pg.ready; await pg.runTimers();
    const p = lp(w, GUESTKEY);
    return { ok: !!p && p.days[TODAY] === 6 && p.born === TODAY && others(w) === before && !w.keyReads.length && !w.upserts.length && !w.local.getItem(LEDGER),
             detail: '本機 ' + JSON.stringify(p && p.days) + ' / 其他鍵 ' + (others(w) === before ? '沒變' : '變了') + ' / 讀雲端 ' + w.keyReads.length + ' / 上傳 ' + w.upserts.length };
  },
  '4. 網站沒開雲端(沒填設定):照樣算、只寫本機': async () => {
    const w = makeWorld();
    setLocal(w, 'tr_hist', dayHist(TODAY, 3));
    const pg = loadPage(w, { noCloud: true }); await pg.ready;
    const p = lp(w, GUESTKEY);
    const st = pg.S.view();
    return { ok: !!p && p.days[TODAY] === 3 && st && st.status && st.status.todayCount === 3 && st.guest === true,
             detail: '本機 ' + JSON.stringify(p && p.days) + ' / 畫面 ' + JSON.stringify(st && st.status && st.status.todayCount) };
  },

  /* ---------- 登入:先讀雲端再合併 ---------- */
  '5. 登入:雲端有別台的天、本機有自己的答題,合併後兩邊都有,上傳後帳本清掉,其他鍵沒動': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', { v: 1, born: '2026-10-01', goals: [], days: { '2026-10-01': 25 }, met: ['2026-10-01'], fed: {}, name: '小黃', nameAt: 5 });
    cloudRow(w, 'hist', dayHist(TODAY, 7));
    cloudRow(w, 'drill_p5', ['a', 'b']);
    const pg = await openLoggedIn(w);
    const before = others(w);
    await pg.S.sync(); await pg.runTimers();
    const c = cp(w), l = lp(w);
    return { ok: !!c && c.days['2026-10-01'] === 25 && c.days[TODAY] === 7 && c.met.includes('2026-10-01') && c.name === '小黃' && same(c, l) && !('pet' in ledger(w)) && others(w) === before,
             detail: '雲端 ' + JSON.stringify(c && c.days) + ' / 本機跟雲端 ' + (same(c, l) ? '一樣' : '不一樣') + ' / 帳本 ' + JSON.stringify(ledger(w)) + ' / 其他鍵 ' + (others(w) === before ? '沒變' : '變了') };
  },
  '6. 雲端沒有這一列(found:false):上傳合併結果': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 5));
    const pg = await openLoggedIn(w);
    const c = cp(w);
    return { ok: !!c && c.days[TODAY] === 5 && w.keyReads.some(f => f.k === 'pet'), detail: '雲端 ' + JSON.stringify(c && c.days) };
  },
  '7. 雲端那一列被別台刪掉(v:null):當成空的雲端版本,上傳合併結果': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', null);
    cloudRow(w, 'hist', dayHist(TODAY, 2));
    const pg = await openLoggedIn(w);
    const c = cp(w);
    return { ok: !!c && c.days[TODAY] === 2, detail: '雲端 ' + JSON.stringify(c) };
  },
  '8. 讀不到雲端(離線):寫本機,不上傳(cloud.js 是先合併的新版、而且第二階段開關打開時才記帳,其他不記帳);恢復連線後合併上傳,雲端原本的天還在': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', { v: 1, born: '2026-10-01', days: { '2026-10-01': 25 }, met: ['2026-10-01'] });
    const pg = await openLoggedIn(w);
    const cloudBefore = JSON.stringify(cp(w));
    w.offline = true;
    for (let i = 0; i < 4; i++) pg.answer('p5', 'off-' + i);
    await pg.runTimers();
    const localOff = lp(w);
    const upOff = w.upserts.filter(k => k === 'pet').length;
    const ledOff = ledger(w);
    const cloudOff = JSON.stringify(cp(w));
    w.offline = false;
    await pg.fire('win:online'); await pg.runTimers();
    const c = cp(w);
    return { ok: !!localOff && localOff.days[TODAY] === 4 && ('pet' in ledOff) === ledgers(pg) && cloudOff === cloudBefore && !!c && c.days['2026-10-01'] === 25 && c.days[TODAY] === 4,
             detail: '離線時本機 ' + JSON.stringify(localOff && localOff.days) + ' / 帳本 ' + JSON.stringify(ledOff) + ' / 雲端 ' + (cloudOff === cloudBefore ? '沒動' : '被改了') + '(上傳 pet ' + upOff + ' 次)/ 連線後雲端 ' + JSON.stringify(c && c.days) };
  },
  '9. supabase-js 手上是別的帳號(或沒有登入):readKey 失敗,只寫本機,不上傳': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', { v: 1, days: { '2026-10-01': 25 } });
    const pg = await openLoggedIn(w);
    const cloudBefore = JSON.stringify(cp(w));
    w.sessionUser = { id: '9a9a9a9a-0000-4000-8000-000000000000' };
    pg.answer('p5', 'q1'); pg.answer('p5', 'q2');
    await pg.runTimers();
    const r1 = JSON.stringify(cp(w)), led1 = ledger(w);
    w.sessionUser = null; w.noSession = true;
    pg.answer('p5', 'q3');
    await pg.S.sync(); await pg.runTimers();
    const l = lp(w);
    return { ok: r1 === cloudBefore && JSON.stringify(cp(w)) === cloudBefore && ('pet' in led1) === ledgers(pg) && ('pet' in ledger(w)) === ledgers(pg) && !!l && l.days[TODAY] === 3,
             detail: '雲端 ' + (JSON.stringify(cp(w)) === cloudBefore ? '沒動' : '被改了') + ' / 本機 ' + JSON.stringify(l && l.days) };
  },
  '10. 伺服器一直不回(逾時):只寫本機,不上傳': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', { v: 1, days: { '2026-10-01': 25 } });
    const pg = await openLoggedIn(w);
    const cloudBefore = JSON.stringify(cp(w));
    w.readGate = new Promise(() => {});
    pg.answer('p5', 'q1');
    await pg.runTimers(); await pg.runTimers();
    const l = lp(w);
    return { ok: JSON.stringify(cp(w)) === cloudBefore && ('pet' in ledger(w)) === ledgers(pg) && !!l && l.days[TODAY] === 1,
             detail: '雲端 ' + (JSON.stringify(cp(w)) === cloudBefore ? '沒動' : '被改了') + ' / 本機 ' + JSON.stringify(l && l.days) };
  },
  '11. 讀雲端時別台剛好寫了新的一天:讀到的那份併進來,不會被蓋掉': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', { v: 1, days: { '2026-10-01': 25 } });
    const pg = await openLoggedIn(w);
    w.beforeReadReturns = () => { w.db.find(r => r.k === 'pet').v = { v: 1, days: { '2026-10-01': 25, '2026-10-02': 30 } }; };
    pg.answer('p5', 'q1');
    await pg.runTimers();
    const c = cp(w);
    return { ok: !!c && c.days['2026-10-02'] === 30 && c.days['2026-10-01'] === 25 && c.days[TODAY] === 1, detail: '雲端 ' + JSON.stringify(c && c.days) };
  },

  /* ---------- 救不回的 ---------- */
  '12. 雲端那份救不回(字串、陣列、v:3;相容版遇到 v:2):本機與雲端都不寫,畫面照樣算得出今天的題數': async () => {
    const out = [];
    for (const [bad, opt] of [['oops', {}], [[1, 2], {}], [{ v: 3, days: { '2026-10-01': 9 } }, {}], [{ v: 2, days: { '2026-10-01': 9 } }, { step1: true }]]) {
      const w = makeWorld();
      cloudRow(w, 'pet', bad);
      cloudRow(w, 'hist', dayHist(TODAY, 3));
      const pg = await openLoggedIn(w, opt);
      const r = await pg.S.feed();
      const st = pg.S.view();
      /* 灌資料時 cloud.js 會照抄雲端那份到本機;之後小雞不改它 */
      out.push({ ok: same(cp(w), bad) && same(lp(w), bad) && !w.upserts.includes('pet') && st.readOnly === true && st.status.todayCount === 3 && r.ok === false && r.reason === 'readOnly',
                 d: JSON.stringify(bad).slice(0, 20) + ':雲端 ' + (same(cp(w), bad) ? '沒動' : '被改') + '、本機 ' + (same(lp(w), bad) ? '沒動' : '被改') + '、畫面 ' + st.status.todayCount });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  '13. 本機那份壞掉(不是 JSON、陣列):不寫回,也不上傳': async () => {
    const out = [];
    for (const bad of ['{not json', '[1,2]', '"str"']) {
      const w = makeWorld();
      cloudRow(w, 'hist', dayHist(TODAY, 3));
      const pg = await openLoggedIn(w);
      setLocal(w, PETKEY, bad);
      const ups = w.upserts.length;
      await pg.S.sync(); await pg.runTimers();
      out.push({ ok: w.local.getItem(PETKEY) === bad && w.upserts.length === ups && pg.S.view().readOnly === true, d: bad + ':' + w.local.getItem(PETKEY) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },

  /* ---------- 不必要的寫入 ---------- */
  '14. 沒變就不寫:再同步一次,不上傳、本機不動、帳本沒有 pet': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 5));
    const pg = await openLoggedIn(w);
    const ups = w.upserts.length, raw = w.local.getItem(PETKEY);
    await pg.S.sync(); await pg.runTimers();
    await pg.S.sync(); await pg.runTimers();
    return { ok: w.upserts.length === ups && w.local.getItem(PETKEY) === raw && !('pet' in ledger(w)) && raw !== null,
             detail: '多上傳 ' + (w.upserts.length - ups) + ' 次 / 帳本 ' + JSON.stringify(ledger(w)) };
  },
  '15. 同時叫兩次同步:排隊做,只上傳一次': async () => {
    const w = makeWorld();
    const pg = await openLoggedIn(w);
    w.db.find(r => r.k === 'pet').v = { v: 1, days: { '2026-10-01': 25 } };   // 別台改了雲端
    const ups = w.upserts.length;
    await Promise.all([pg.S.sync(), pg.S.sync()]); await pg.runTimers();
    const c = cp(w);
    return { ok: w.upserts.length - ups === 1 && c.days['2026-10-01'] === 25, detail: '上傳 ' + (w.upserts.length - ups) + ' 次 / 雲端 ' + JSON.stringify(c.days) };
  },

  /* ---------- 動作 ---------- */
  '16. 餵食:飼料 = 今天的有效題數;餵完飼料 0、不餓,雲端記下;沒飼料再按回 noFood 不寫': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 8));
    const pg = await openLoggedIn(w);
    const s0 = pg.S.view().status;
    const r = await pg.S.feed(); await pg.runTimers();
    const ups = w.upserts.length;
    const r2 = await pg.S.feed(); await pg.runTimers();
    const c = cp(w);
    return { ok: s0.food === 8 && s0.hungry === true && r.ok === true && r.status.food === 0 && r.status.hungry === false && c.fed[TODAY] === 8 && r2.ok === false && r2.reason === 'noFood' && w.upserts.length === ups,
             detail: '餵前 ' + s0.food + ' 顆 / 餵後 ' + JSON.stringify(r.status && { food: r.status.food, hungry: r.status.hungry }) + ' / 雲端 fed ' + JSON.stringify(c.fed) + ' / 再按 ' + JSON.stringify(r2) };
  },
  '17. 改目標:今天不變、明天生效,雲端記下;不合法的目標不寫': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 22));
    const pg = await openLoggedIn(w);
    const r = await pg.S.setGoal(40); await pg.runTimers();
    const ups = w.upserts.length, raw = w.local.getItem(PETKEY);
    const bad = await pg.S.setGoal(15); await pg.runTimers();
    const c = cp(w);
    return { ok: r.ok && r.status.goal === 20 && r.status.metToday === true && r.status.nextGoal === 40 && c.goals.some(g => g.from === addDays(TODAY, 1) && g.n === 40) && bad.ok === false && w.upserts.length === ups && w.local.getItem(PETKEY) === raw,
             detail: JSON.stringify(r.status && { goal: r.status.goal, next: r.status.nextGoal }) + ' / 雲端 goals ' + JSON.stringify(c.goals) + ' / 15:' + JSON.stringify(bad) };
  },
  '18. 取名:最多 10 個字,雲端記下': async () => {
    const w = makeWorld();
    const pg = await openLoggedIn(w);
    const r = await pg.S.rename('  小黃黃黃黃黃黃黃黃黃黃黃  '); await pg.runTimers();
    return { ok: r.ok && cp(w).name === '小黃黃黃黃黃黃黃黃黃' && r.status.name === '小黃黃黃黃黃黃黃黃黃', detail: JSON.stringify(cp(w).name) };
  },
  '19. 離線時餵食:先寫本機(不上傳);恢復連線後合併上傳,雲端有 fed 也保留別台的天': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 5));
    const pg = await openLoggedIn(w);
    w.db.find(r => r.k === 'pet').v.days['2026-10-02'] = 30;   // 別台寫的
    w.offline = true;
    const r = await pg.S.feed(); await pg.runTimers();
    const off = { fed: lp(w).fed[TODAY], led: 'pet' in ledger(w) };
    w.offline = false;
    await pg.fire('win:online'); await pg.runTimers();
    const c = cp(w);
    return { ok: r.ok && r.uploaded === false && off.fed === 5 && off.led === ledgers(pg) && c.fed[TODAY] === 5 && c.days['2026-10-02'] === 30 && c.days[TODAY] === 5,
             detail: '離線 ' + JSON.stringify(off) + ' / 連線後雲端 ' + JSON.stringify({ fed: c.fed, days: c.days }) };
  },
  '20. 本機那份救不回時按餵食:回 readOnly,不寫': async () => {
    const w = makeWorld();
    const pg = await openLoggedIn(w);
    setLocal(w, PETKEY, { v: 9 });
    const ups = w.upserts.length;
    const r = await pg.S.feed(); await pg.runTimers();
    return { ok: r.ok === false && r.reason === 'readOnly' && same(lp(w), { v: 9 }) && w.upserts.length === ups, detail: JSON.stringify(r) };
  },

  /* ---------- 答題之後 ---------- */
  '21. 答題後自動更新:連答 5 題只讀雲端一次、上傳一次,今天 5 題;hist 照常由 logAttempt 寫': async () => {
    const w = makeWorld();
    const pg = await openLoggedIn(w);
    const reads = w.keyReads.length, ups = w.upserts.filter(k => k === 'pet').length;
    for (let i = 0; i < 5; i++) pg.answer('g', 'ga-0' + i);
    const view = pg.S.view().status.todayCount;   // 畫面不用等同步
    await pg.runTimers();
    const c = cp(w);
    /* 小雞讀一次;cloud.js 是先合併再上傳的新版時,它上傳前自己再讀一次 */
    return { ok: view === 5 && w.keyReads.length - reads === (merged(pg) ? 2 : 1) && w.upserts.filter(k => k === 'pet').length - ups === 1 && c.days[TODAY] === 5 && JSON.parse(w.local.getItem(PREFIX + 'hist')).length === 5,
             detail: '畫面 ' + view + ' / 讀雲端 ' + (w.keyReads.length - reads) + ' 次 / 上傳 pet ' + (w.upserts.filter(k => k === 'pet').length - ups) + ' 次 / 雲端 ' + JSON.stringify(c.days) };
  },
  '22. 每次同步後通知畫面(pet:change),答題後也會': async () => {
    const w = makeWorld();
    const pg = await openLoggedIn(w);
    const n0 = w.events.filter(e => e === 'pet:change').length;
    pg.answer('p5', 'z'); await pg.runTimers();
    return { ok: n0 >= 1 && w.events.filter(e => e === 'pet:change').length > n0, detail: '開頁 ' + n0 + ' 次 / 答題後 ' + w.events.filter(e => e === 'pet:change').length + ' 次' };
  },
  '23. 回到頁面(visibilitychange)會再同步,把別台的新進度併進本機': async () => {
    const w = makeWorld();
    const pg = await openLoggedIn(w);
    w.db.find(r => r.k === 'pet').v.days['2026-10-03'] = 12;
    w.clock.t += 5 * 60e3;
    await pg.fire('doc:visibilitychange'); await pg.runTimers();
    return { ok: lp(w).days['2026-10-03'] === 12, detail: '本機 ' + JSON.stringify(lp(w).days) };
  },

  /* ---------- 兩台裝置 ---------- */
  '24. 兩台輪流練、輪流同步:雲端的總題數一路不倒退,最後兩台看到的一樣': async () => {
    const db = [];
    const a = makeWorld(db), b = makeWorld(db);
    const pa = await openLoggedIn(a);
    const pb = await openLoggedIn(b);
    const totals = [];
    for (let i = 0; i < 3; i++) {
      a.clock.t = b.clock.t = tp(addDays(TODAY, i) + ' 12:00:00');
      for (let j = 0; j < 3; j++) pa.answer('p5', 'a' + i + j);
      await pa.runTimers();
      totals.push(sum(cp(a).days));
      for (let j = 0; j < 2; j++) pb.answer('p7', 'b' + i + j);
      await pb.runTimers();
      totals.push(sum(cp(b).days));
    }
    await pa.S.sync(); await pa.runTimers();
    const c = cp(a);
    const mono = totals.every((x, i) => i === 0 || x >= totals[i - 1]);
    /* hist 是整鍵後寫的贏(規格第 9 節已知限制):同一天兩台各答,小雞取較多的那台,不加總,也不倒退 */
    return { ok: mono && sum(c.days) === 9 && Object.values(c.days).every(n => n === 3) && same(lp(a).days, c.days),
             detail: '雲端總題數歷程 ' + JSON.stringify(totals) + ' / 最後 ' + JSON.stringify(c.days) };
  },
  '25. 離線只寫本機之後換新工作階段(雲端蓋回本機):重算後天數不倒退': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', { v: 1, days: { '2026-10-01': 25 } });
    const pg = await openLoggedIn(w);
    w.offline = true;
    for (let i = 0; i < 6; i++) pg.answer('p5', 'q' + i);
    await pg.runTimers();
    const off = lp(w).days[TODAY];
    w.offline = false;
    w.session = makeStorage();   // 隔天重開 App:新的工作階段,會灌雲端資料
    let p2 = loadPage(w); await p2.ready;
    p2 = loadPage(w); await p2.ready; await p2.runTimers();
    const c = cp(w), l = lp(w);
    return { ok: off === 6 && l.days[TODAY] === 6 && l.days['2026-10-01'] === 25 && c.days[TODAY] === 6,
             detail: '離線時 ' + off + ' / 重開後本機 ' + JSON.stringify(l.days) + ' / 雲端 ' + JSON.stringify(c.days) };
  },
  '26. 讀雲端時換了帳號(別的分頁登入別人):不上傳到任何帳號': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', { v: 1, days: { '2026-10-01': 25 } });
    const pg = await openLoggedIn(w);
    const before = JSON.stringify(w.db);
    let open; w.readGate = new Promise(r => { open = r; });
    pg.answer('p5', 'x');
    const s = pg.S.sync();
    await tick();
    pg.ctx.CLOUD.user = { id: '9a9a9a9a-0000-4000-8000-000000000000', email: 'b@x.com' };
    open(); w.readGate = null;
    await s; await pg.runTimers();
    const after = JSON.stringify(w.db.filter(r => r.k !== 'hist'));
    return { ok: after === JSON.stringify(JSON.parse(before).filter(r => r.k !== 'hist')) && !w.db.some(r => r.user_id !== USER.id),
             detail: '雲端 pet ' + (after === JSON.stringify(JSON.parse(before).filter(r => r.k !== 'hist')) ? '沒動' : '被改了') };
  },
  '28. 讀雲端時別的分頁剛好寫了本機的 pet:那份也併進來,不會被蓋掉': async () => {
    const w = makeWorld();
    const pg = await openLoggedIn(w);
    w.beforeReadReturns = () => { const l = lp(w); l.days['2026-10-05'] = 9; l.name = '別分頁'; l.nameAt = 1; setLocal(w, PETKEY, l); };
    await pg.S.sync(); await pg.runTimers();
    const c = cp(w), l = lp(w);
    return { ok: l.days['2026-10-05'] === 9 && c.days['2026-10-05'] === 9 && c.name === '別分頁', detail: '本機 ' + JSON.stringify(l.days) + ' / 雲端 ' + JSON.stringify(c.days) + ' ' + c.name };
  },
  '27. 只寫 pet:整套流程(開頁、答題、餵食、改目標、取名、離線、恢復)下來,pet 以外只有 hist 因為答題而變': async () => {
    const w = makeWorld();
    cloudRow(w, 'drill_p5', ['a']); cloudRow(w, 'vgame_banks', [{ name: 'x' }]); cloudRow(w, 'daily', { d: 1 });
    const pg = await openLoggedIn(w);
    const keys = () => { const o = []; for (let i = 0; i < w.local.length; i++) o.push(w.local.key(i)); return o.filter(k => k !== PETKEY && k !== PREFIX + 'hist' && k !== LEDGER).sort().map(k => k + '=' + w.local.getItem(k)).join('\n') + JSON.stringify(w.db.filter(r => !['pet', 'hist', '_meta'].includes(r.k))); };
    const before = keys();
    pg.answer('p5', 'q1'); await pg.runTimers();
    await pg.S.feed(); await pg.S.setGoal(10); await pg.S.rename('啾');
    w.offline = true; pg.answer('p5', 'q2'); await pg.runTimers(); await pg.S.feed();
    w.offline = false; await pg.fire('win:online'); await pg.runTimers();
    const pushed = w.upserts.filter(k => k !== 'pet' && k !== 'hist' && k !== '_meta');
    return { ok: keys() === before && !pushed.length, detail: '其他鍵 ' + (keys() === before ? '沒變' : '變了') + ' / 上傳了 ' + JSON.stringify([...new Set(w.upserts)]) };
  },

  /* ---------- 裝置時鐘不準(10/16 審查):用伺服器發的登入憑證時間(iat)對時 ---------- */
  '29. 時鐘慢 20 天的裝置登入:pet 一個字都不寫(本機、雲端都不動),畫面唯讀;之後時鐘準的裝置開新工作階段,30 天都還在': async () => {
    const db = [];
    const days = {}, met = [];
    for (let i = 29; i >= 0; i--) { const d = addDays(TODAY, -i); days[d] = 25; met.push(d); }
    const pet0 = { v: 1, born: addDays(TODAY, -29), goals: [], days, met, oldMet: 0, oldBefore: '', fed: { [TODAY]: 25 }, name: '小黃', nameAt: 5 };
    db.push({ user_id: USER.id, k: 'pet', v: JSON.parse(JSON.stringify(pet0)), updated_at: '2026-10-16T04:00:00.000Z' });
    /* 題量大的學生:hist 只涵蓋最近 3 天 */
    const hist = [].concat(dayHist(addDays(TODAY, -2), 25), dayHist(addDays(TODAY, -1), 25), dayHist(TODAY, 25));
    db.push({ user_id: USER.id, k: 'hist', v: hist, updated_at: '2026-10-16T04:00:00.000Z' });
    const S = makeWorld(db);
    S.server = tp(TODAY + ' 12:00:00');
    S.clock.t = tp(addDays(TODAY, -20) + ' 12:00:00');
    const ps = await openLoggedIn(S);
    const localAfterOpen = S.local.getItem(PETKEY);
    const cloudSlow = JSON.stringify(cp(S));
    const fed = await ps.S.feed(); await ps.runTimers();
    const v = ps.S.view();
    S.offline = true;   // 之後離線再答題:已經知道時鐘不準,本機那份也不寫
    ps.answer('p5', 'slow-off'); await ps.runTimers(); await ps.S.idle();
    S.offline = false;
    const ok1 = cloudSlow === JSON.stringify(pet0) && JSON.stringify(cp(S)) === JSON.stringify(pet0) && !S.upserts.includes('pet') && !('pet' in ledger(S))
      && same(JSON.parse(localAfterOpen), pet0) && S.local.getItem(PETKEY) === localAfterOpen && v.readOnly === true && v.reason === 'clock' && fed.ok === false && fed.reason === 'clock';
    const A = makeWorld(db);
    A.clock.t = tp(TODAY + ' 13:00:00');
    await openLoggedIn(A);
    const c = cp(A);
    const ok2 = Object.keys(c.days).length === 30 && c.met.length === 30 && c.fed[TODAY] === 25;
    return { ok: ok1 && ok2, detail: '慢的裝置:雲端 ' + (JSON.stringify(cp(S)) === JSON.stringify(pet0) ? '沒動' : '被改') + '、上傳 pet ' + S.upserts.filter(k => k === 'pet').length + ' 次、本機 ' + (S.local.getItem(PETKEY) === localAfterOpen ? '沒動' : '被改') + '、畫面 ' + JSON.stringify({ readOnly: v.readOnly, reason: v.reason }) + '、餵食 ' + JSON.stringify(fed && fed.reason) + ' / 準的裝置之後:雲端 ' + Object.keys(c.days).length + ' 天、達標 ' + c.met.length + '、fed ' + JSON.stringify(c.fed) };
  },
  '30. 時鐘快 20 天的裝置不上傳;雲端已經有別人寫的未來日期(超過 7 天)時,時鐘準的裝置照常清掉': async () => {
    const db = [];
    db.push({ user_id: USER.id, k: 'hist', v: dayHist(TODAY, 5), updated_at: '2026-10-16T04:00:00.000Z' });
    const F = makeWorld(db);
    F.server = tp(TODAY + ' 12:00:00');
    F.clock.t = tp(addDays(TODAY, 20) + ' 12:00:00');
    const pf = await openLoggedIn(F);
    for (let i = 0; i < 6; i++) pf.answer('p5', 'fast-' + i);
    await pf.runTimers(); await pf.S.idle(); await pf.runTimers();
    const fastUp = F.upserts.filter(k => k === 'pet').length;
    const db2 = [];
    const future = addDays(TODAY, 20);
    db2.push({ user_id: USER.id, k: 'pet', v: { v: 1, born: '2026-10-01', days: { '2026-10-01': 25, [future]: 30 }, met: ['2026-10-01', future] }, updated_at: '2026-10-16T04:00:00.000Z' });
    db2.push({ user_id: USER.id, k: 'hist', v: dayHist(TODAY, 5), updated_at: '2026-10-16T04:00:00.000Z' });
    const A = makeWorld(db2);
    await openLoggedIn(A);
    const c = cp(A);
    return { ok: fastUp === 0 && !db.some(r => r.k === 'pet') && !(future in c.days) && !c.met.includes(future) && c.days['2026-10-01'] === 25 && c.days[TODAY] === 5,
             detail: '快的裝置上傳 pet ' + fastUp + ' 次 / 準的裝置之後雲端 ' + JSON.stringify(c.days) + ' 達標 ' + JSON.stringify(c.met) };
  },
  /* chick2 第二輪修正 #3:fed 只留這台的今天往前 6 天,時鐘快 6 天多的裝置會把別台今天餵的飼料清掉再上傳。快超過 6 天就不寫 */
  /* chick2 第三輪修正 #1:兩台一快一慢時相差兩邊上限相加,以前各 6 天、相差 12 天,慢的那台會把快的那台的天丟掉。現在各 3 天:
     快或慢超過 3 天就不寫;3 天以內照常合併上傳 */
  '30a. 時鐘快 3.5、5.9、6.5、7.5 天或慢 3.5、5.9 天的裝置:不合併、不上傳,雲端今天餵的飼料還在;快或慢 2.9 天照常合併上傳,餵食還在': async () => {
    const out = [];
    for (const fast of [6.5, 7.5, 5.9, 3.5, -3.5, -5.9, 2.9, -2.9]) {
      const db = [];
      const pet0 = { v: 1, born: '2026-10-01', goals: [], days: { '2026-10-10': 25, [TODAY]: 25 }, met: ['2026-10-10', TODAY], oldMet: 0, oldBefore: '', fed: { [TODAY]: 25 }, name: '小黃', nameAt: 5 };
      db.push({ user_id: USER.id, k: 'pet', v: JSON.parse(JSON.stringify(pet0)), updated_at: '2026-10-16T04:00:00.000Z' });
      db.push({ user_id: USER.id, k: 'hist', v: dayHist(TODAY, 25), updated_at: '2026-10-16T04:00:00.000Z' });
      const F = makeWorld(db);
      F.server = tp(TODAY + ' 12:00:00');
      F.clock.t = F.server + fast * 864e5;
      const pf = await openLoggedIn(F);
      await pf.S.sync(); await pf.runTimers(); await pf.S.idle();
      const ups = F.upserts.filter(k => k === 'pet').length;
      const c = cp(F), v = pf.S.view();
      const ok = Math.abs(fast) > 3 ? JSON.stringify(c) === JSON.stringify(pet0) && ups === 0 && v.reason === 'clock'
        : !!c && c.fed[TODAY] === 25 && c.days[TODAY] === 25 && v.readOnly === false;
      out.push({ ok, d: '快 ' + fast + ' 天:上傳 pet ' + ups + ' 次 雲端 fed ' + JSON.stringify(c && c.fed) + ' 畫面 ' + JSON.stringify({ readOnly: v.readOnly, reason: v.reason }) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  '31. 時鐘差幾分鐘、憑證已經發了 50 分鐘:照常合併上傳': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 4));
    w.server = w.clock.t + 3 * 60e3;
    w.tokenAge = 50 * 60;
    const pg = await openLoggedIn(w);
    const c = cp(w);
    return { ok: !!c && c.days[TODAY] === 4 && pg.S.view().readOnly === false, detail: '雲端 ' + JSON.stringify(c && c.days) };
  },
  '32. 登入憑證沒有或解不開(對不了時):當成讀不到雲端,只寫本機、不上傳': async () => {
    const out = [];
    for (const flag of ['noToken', 'badToken']) {
      const w = makeWorld();
      cloudRow(w, 'pet', { v: 1, days: { '2026-10-01': 25 } });
      cloudRow(w, 'hist', dayHist(TODAY, 3));
      w[flag] = true;
      const pg = await openLoggedIn(w);
      const l = lp(w);
      out.push({ ok: same(cp(w), { v: 1, days: { '2026-10-01': 25 } }) && !w.upserts.includes('pet') && !('pet' in ledger(w)) && !!l && l.days[TODAY] === 3 && pg.S.view().readOnly === false,
                 d: flag + ':雲端 ' + (same(cp(w), { v: 1, days: { '2026-10-01': 25 } }) ? '沒動' : '被改') + '、本機 ' + JSON.stringify(l && l.days) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },

  /* ---------- 讀雲端時登出(10/16 審查) ---------- */
  '33. 讀雲端時登出:帳號資料夾清掉後不會再寫回 pet 或帳本;訪客照常寫': async () => {
    const out = [];
    for (const variant of ['canon', 'other-device']) {
      const w = makeWorld();
      cloudRow(w, 'pet', { v: 1, born: '2026-10-01', days: { '2026-10-01': 25 }, met: ['2026-10-01'], name: '小黃', nameAt: 5 });
      cloudRow(w, 'hist', dayHist(TODAY, 5));
      const pg = await openLoggedIn(w);
      if (variant === 'other-device') w.db.find(r => r.k === 'pet').v = { v: 1, born: '2026-10-01', days: { '2026-10-01': 25, '2026-10-02': 30 }, met: ['2026-10-01'], name: '小黃', nameAt: 5 };
      let open; w.readGate = new Promise(r => { open = r; });
      w.clock.t += 5 * 60e3;
      const s = pg.S.sync();
      await tick();
      await pg.ctx.CLOUD.logout();
      open(); w.readGate = null;
      const res = await s; await pg.runTimers();
      const keys = []; for (let i = 0; i < w.local.length; i++) keys.push(w.local.key(i));
      const residue = keys.filter(k => k.startsWith(PREFIX) || k === LEDGER);
      out.push({ ok: !residue.length && res.ok === false && res.reason === 'loggedOut', d: variant + ':留下 ' + (residue.join(',') || '沒有') + ' / ' + JSON.stringify(res.reason) });
    }
    const g = makeWorld();
    g.noSession = true;
    setLocal(g, 'tr_hist', dayHist(TODAY, 2));
    const pgG = loadPage(g); await pgG.ready;
    pgG.answer('p5', 'g1');
    await pgG.S.sync();
    const gp = lp(g, GUESTKEY);
    out.push({ ok: !!gp && gp.days[TODAY] === 3, d: '訪客:' + JSON.stringify(gp && gp.days) });
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },

  /* ---------- 第二階段第 1 步:相容版遇到 v2(別台裝了新版)只看不寫 ---------- */
  '34. 相容版:雲端是 v2(灌資料後本機也是 v2):開頁、同步、餵飼料、改目標、取名各 3 次,本機與雲端的 pet 一次都沒寫,其他鍵逐位元組不變;畫面照 v2 顯示,說明資料是新版網頁存的(newer)': async () => {
    const w = makeWorld();
    const rec = v2Pet();
    cloudRow(w, 'pet', JSON.parse(JSON.stringify(rec)));
    cloudRow(w, 'hist', dayHist(TODAY, 3));
    cloudRow(w, 'drill_p5', ['a']);
    const pg = await openLoggedIn(w, { step1: true });
    const afterOpen = { l: w.local.getItem(PETKEY), c: JSON.stringify(cp(w)) };
    const before = others(w);
    const writes = countPetWrites(w);
    const ups0 = w.upserts.length;
    const res = await pokeAll(pg, w);
    const v = pg.S.view();
    const s = v.status;
    const okData = same(JSON.parse(afterOpen.l), rec) && afterOpen.c === JSON.stringify(rec) && w.local.getItem(PETKEY) === afterOpen.l && JSON.stringify(cp(w)) === afterOpen.c
      && writes.n === 0 && w.upserts.length === ups0 && !w.upserts.includes('pet') && !('pet' in ledger(w)) && others(w) === before && allRefused(res);
    const okView = v.readOnly === true && v.newer === true && v.pet.v === 2 && s.stage === 3 && s.name === '小黃' && s.streak === 10 && s.shields === 2 && s.todayCount === 25 && s.food === 0;
    const snap = '本機寫 pet ' + writes.n + ' 次 / 上傳 ' + JSON.stringify(w.upserts.slice(ups0)) + ' / 其他鍵 ' + (others(w) === before ? '沒變' : '變了');
    await answerAll(pg);
    const okAfter = writes.n === 0 && w.local.getItem(PETKEY) === afterOpen.l && JSON.stringify(cp(w)) === afterOpen.c && !w.upserts.includes('pet');
    return { ok: okData && okView && okAfter,
             detail: snap + ' / 資料 ' + okData + ' / 回覆 ' + JSON.stringify(res.map(r => r && r.reason)).slice(0, 80) + ' / 畫面 ' + JSON.stringify({ ro: v.readOnly, newer: v.newer, v: v.pet && v.pet.v, stage: s.stage, name: s.name, streak: s.streak, shields: s.shields, today: s.todayCount, food: s.food }) + ' / 答題後(會寫 hist)pet 寫 ' + writes.n + ' 次、' + okAfter };
  },
  '35. 相容版:本機 v2、讀不到雲端(離線)與訪客:動作全部回絕,本機那份一個 byte 都沒變,不記帳、不上傳;恢復連線後雲端那份 v1 也不動': async () => {
    const out = [];
    const w = makeWorld();
    const cloud1 = { v: 1, born: '2026-10-01', days: { '2026-10-01': 25 }, met: ['2026-10-01'] };
    cloudRow(w, 'pet', cloud1);
    const pg = await openLoggedIn(w, { step1: true });
    const cloudBefore = JSON.stringify(cp(w));
    const raw = JSON.stringify(v2Pet());
    w.local.setItem(PETKEY, raw);   // 同一台另一個分頁的新版寫的
    w.offline = true;
    const writes = countPetWrites(w);
    const res = await pokeAll(pg, w);
    const v = pg.S.view();
    out.push({ ok: writes.n === 0 && w.local.getItem(PETKEY) === raw && !('pet' in ledger(w)) && allRefused(res) && v.readOnly && v.newer === true && v.status.name === '小黃' && v.status.stage === 3,
               d: '離線:寫 ' + writes.n + ' 次、本機 ' + (w.local.getItem(PETKEY) === raw ? '沒動' : '被改') + '、畫面 ' + JSON.stringify({ ro: v.readOnly, newer: v.newer, name: v.status.name, stage: v.status.stage }) });
    w.offline = false;
    const ups = w.upserts.length;
    const res2 = await pokeAll(pg, w);
    out.push({ ok: writes.n === 0 && w.local.getItem(PETKEY) === raw && JSON.stringify(cp(w)) === cloudBefore && !w.upserts.slice(ups).includes('pet') && allRefused(res2),
               d: '連線後:寫 ' + writes.n + ' 次、雲端 ' + (JSON.stringify(cp(w)) === cloudBefore ? '沒動' : '被改') });
    const g = makeWorld();
    g.noSession = true;
    setLocal(g, 'tr_hist', dayHist(TODAY, 2));
    g.local.setItem(GUESTKEY, raw);
    const gw = countPetWrites(g);
    const pgG = loadPage(g, { step1: true }); await pgG.ready;
    const resG = await pokeAll(pgG, g);
    const vg = pgG.S.view();
    out.push({ ok: gw.n === 0 && g.local.getItem(GUESTKEY) === raw && allRefused(resG) && vg.readOnly && vg.status.name === '小黃' && vg.status.todayCount === 25,
               d: '訪客:寫 ' + gw.n + ' 次、畫面 ' + JSON.stringify({ name: vg.status.name, today: vg.status.todayCount }) });
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  '36. 相容版:這個分頁開著時別台把雲端升成 v2(本機還是 v1):本機、雲端都不寫;畫面顯示兩邊合併的結果': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 4));
    const pg = await openLoggedIn(w, { step1: true });
    const localRaw = w.local.getItem(PETKEY);
    const rec = v2Pet();
    w.db.find(r => r.k === 'pet').v = JSON.parse(JSON.stringify(rec));
    const writes = countPetWrites(w);
    const ups = w.upserts.length;
    const before = others(w);
    const res = await pokeAll(pg, w);
    const v = pg.S.view();
    return { ok: writes.n === 0 && w.local.getItem(PETKEY) === localRaw && same(cp(w), rec) && !w.upserts.slice(ups).includes('pet') && !('pet' in ledger(w)) && others(w) === before && allRefused(res)
               && v.readOnly && v.newer === true && v.status.name === '小黃' && v.status.stage === 3 && v.pet.days[TODAY] === 25,
             detail: '寫 ' + writes.n + ' 次 / 本機 ' + (w.local.getItem(PETKEY) === localRaw ? '沒動' : '被改') + ' / 雲端 ' + (same(cp(w), rec) ? '沒動' : '被改') + ' / 畫面 ' + JSON.stringify({ ro: v.readOnly, newer: v.newer, name: v.status.name, stage: v.status.stage, today: v.pet.days[TODAY] }) };
  },
  '37. 相容版:本機 v2、雲端被舊分頁蓋回 v1(本機有雲端沒有的天):兩邊都不寫,誰都沒少;畫面顯示合併': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 1));
    const pg = await openLoggedIn(w, { step1: true });
    const raw = JSON.stringify(v2Pet());
    w.local.setItem(PETKEY, raw);
    const cloud1 = { v: 1, born: '2026-09-01', days: { '2026-09-01': 30 }, met: ['2026-09-01'], name: '阿啾', nameAt: 9 };
    w.db.find(r => r.k === 'pet').v = JSON.parse(JSON.stringify(cloud1));
    const writes = countPetWrites(w);
    const ups = w.upserts.length;
    const res = await pokeAll(pg, w);
    const v = pg.S.view();
    return { ok: writes.n === 0 && w.local.getItem(PETKEY) === raw && same(cp(w), cloud1) && !w.upserts.slice(ups).includes('pet') && allRefused(res)
               && v.readOnly && v.newer === true && v.pet.days['2026-09-01'] === 30 && v.pet.days[TODAY] === 25 && v.status.name === '阿啾',
             detail: '寫 ' + writes.n + ' 次 / 雲端 ' + (same(cp(w), cloud1) ? '沒動' : '被改') + ' / 畫面 ' + JSON.stringify({ newer: v.newer, d0901: v.pet.days['2026-09-01'], today: v.pet.days[TODAY], name: v.status.name }) };
  },
  '38. 雲端或本機是不認得的版本(v3、1.5、1e9)、或本機壞掉:唯讀,畫面照舊不說版本(只有剛好是 v2 才說,規格 5.3);v1 照常不是唯讀': async () => {
    const out = [];
    const cases = [['cloud', { v: 3, days: {} }], ['cloud', { v: 1.5 }], ['cloud', { v: 1e9 }], ['local', { v: 3, days: {} }], ['local', { v: 1.5 }], ['local', '{not json'], ['none', null]];
    for (const [where, bad, newer] of cases.map(c => c.concat(false))) {
      const w = makeWorld();
      if (where === 'cloud') cloudRow(w, 'pet', bad);
      cloudRow(w, 'hist', dayHist(TODAY, 2));
      const pg = await openLoggedIn(w);
      if (where === 'local') { setLocal(w, PETKEY, bad); await pg.S.sync(); }
      const v = pg.S.view();
      out.push({ ok: v.newer === newer && v.readOnly === (where !== 'none'), d: where + ':' + JSON.stringify({ ro: v.readOnly, newer: v.newer }) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  /* ---------- 第二階段第 2 步:新版(開關關著時跟第 1 步一樣;打開時食物、走動開關) ---------- */
  '39. 兩個開關都關著:30 天的使用(答題、同步、餵飼料、改目標、取名、離線、呼叫 earn、eat、setRoam),寫出的每一份 pet、寫入次數、雲端、view() 的鍵都跟第 1 步相同;新函式全部回 off;從頭到尾沒有 v2': async () => {
    const runOne = async opt => {
      const w = makeWorld();
      cloudRow(w, 'pet', { v: 1, born: '2026-09-20', days: { '2026-09-20': 25 }, met: ['2026-09-20'], name: '小黃', nameAt: 3 });
      cloudRow(w, 'hist', dayHist(TODAY, 2));
      cloudRow(w, 'daily_done', { [TODAY]: { d: { a: 1, b: 1, c: 1, e: 1, f: 1 } } });
      cloudRow(w, 'mock_history', [{ d: new Date(tp(TODAY + ' 09:00:00')).toISOString(), size: 'mini' }]);
      const log = recordPetWrites(w);
      const pg = await openLoggedIn(w, Object.assign({ merged: false }, opt));
      const out = { cloud: [], keys: [], offs: [], ups: 0 };
      for (let i = 0; i < 30; i++) {
        w.clock.t = tp(addDays(TODAY, i) + ' 10:00:00');
        w.offline = i % 9 === 4;
        for (let j = 0; j < 3 + (i % 4) * 6; j++) pg.answer('p5', 'd' + i + '-' + j);
        await pg.runTimers(); await pg.S.idle();
        if (i % 3 === 0) await pg.S.feed();
        if (i % 7 === 2) await pg.S.setGoal([10, 20, 40][i % 3]);
        if (i % 11 === 5) await pg.S.rename('啾' + i);
        if (!opt.step1) {
          const e = pg.S.eat('corn');
          out.offs.push(J([(await pg.S.earn({ id: 'd' })).result, (await pg.S.earn({ id: 'g:ga-01', n: 9 })).result, e.ok, e.reason, (await e.saved).reason, (await pg.S.setRoam(false)).reason]));
        }
        w.clock.t += 5 * 60e3; await pg.fire('doc:visibilitychange'); await pg.runTimers(); await pg.S.idle();
        out.cloud.push(JSON.stringify(cp(w)));
        out.keys.push(J(Object.keys(pg.S.view())));
      }
      out.ups = w.upserts.filter(k => k === 'pet').length;
      return { log, out };
    };
    /* 兩組:都配舊的 cloud.js(只比 pet-store 與 pet.js);都配現在的 cloud.js(相容版借新版的合併函式,不然 cloud.js 不上傳 pet) */
    const res = [];
    for (const [na, nb] of [[{ oldCloud: true }, { step1: true }], [{}, { step1: true, newCloud: true, lendMerge: true }]]) {
      const a = await runOne(na), b = await runOne(nb);
      const offOk = a.out.offs.length === 30 && a.out.offs.every(x => x === '["off","off",false,"off","off","off"]');
      const v2 = a.log.concat(a.out.cloud).some(looksV2);
      res.push({ ok: J(a.log) === J(b.log) && J(a.out.cloud) === J(b.out.cloud) && J(a.out.keys) === J(b.out.keys) && a.out.ups === b.out.ups && offOk && !v2 && a.log.length > 20,
                 d: (na.oldCloud ? '舊 cloud.js' : '現在的 cloud.js') + ':本機寫 ' + a.log.length + ' / ' + b.log.length + ' 次、內容 ' + (J(a.log) === J(b.log) ? '相同' : '不同') + '、雲端 ' + (J(a.out.cloud) === J(b.out.cloud) ? '相同' : '不同') + '、上傳 ' + a.out.ups + ' / ' + b.out.ups + '、鍵 ' + (J(a.out.keys) === J(b.out.keys) ? '相同' : '不同') + '、新函式 ' + (a.out.offs[0] || '') + '、v2 ' + v2 });
    }
    return { ok: res.every(x => x.ok), detail: res.map(x => x.d).join(' / ') };
  },
  '40. 新版、開關關著:雲端 v2、本機 v1(別台新版寫的):合併後還是 v2、新欄位一個都沒掉;同步、餵飼料、改目標、取名之後也一樣;不唯讀、不說 newer': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 4));
    const pg = await openLoggedIn(w);
    const rec = v2Pet();
    w.db.find(r => r.k === 'pet').v = JSON.parse(JSON.stringify(rec));
    const res = await pokeAll(pg, w);
    const c = cp(w), l = lp(w), v = pg.S.view();
    const keep = x => !!x && x.v === 2 && NEWK.every(k => J(x[k]) === J(rec[k]));
    return { ok: keep(c) && keep(l) && same(c, l) && c.name === '啾2' && c.days[TODAY] === 25 && res.every(r => r.ok || r.reason === 'noFood') && v.readOnly === false && v.newer === false && !('food' in v) && !('roam' in v),
             detail: J({ cloud: keep(c), local: keep(l), name: c && c.name, res: res.map(r => r.ok || r.reason), ro: v.readOnly, newer: v.newer }) };
  },
  '41. 同一個瀏覽器開相容版和新版兩個分頁(雲端是 v2):各同步 3 輪,寫入 0 次;相容版唯讀,顯示的階段和名字跟新版一致': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', v2Pet());
    cloudRow(w, 'hist', dayHist(TODAY, 3));
    const pgNew = await openLoggedIn(w);
    const pgOld = loadPage(w, { step1: true }); await pgOld.ready; await pgOld.runTimers();
    const writes = countPetWrites(w); const ups = w.upserts.length;
    for (let i = 0; i < 3; i++) {
      await pgNew.S.sync(); await pgOld.S.sync();
      w.clock.t += 2 * 60e3;
      await pgNew.fire('doc:visibilitychange'); await pgOld.fire('doc:visibilitychange'); await pgNew.runTimers(); await pgOld.runTimers();
    }
    const vn = pgNew.S.view(), vo = pgOld.S.view();
    return { ok: writes.n === 0 && !w.upserts.slice(ups).includes('pet') && vo.readOnly && vo.newer && !vn.readOnly && vn.status.stage === vo.status.stage && vn.status.name === vo.status.name && vn.status.streak === vo.status.streak && vn.status.stage === 3,
             detail: '寫 ' + writes.n + ' 次 / 新版 ' + J({ ro: vn.readOnly, stage: vn.status.stage, name: vn.status.name }) + ' / 相容版 ' + J({ ro: vo.readOnly, newer: vo.newer, stage: vo.status.stage, name: vo.status.name }) };
  },
  '42. 食物打開:earn 只寫 pet,其他鍵全部不動;券寫進本機與雲端;送 pet:earn(source hook)': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 3)); cloudRow(w, 'drill_p5', ['a']); cloudRow(w, 'vgame_banks', [{ name: 'x' }]);
    const pg = await openLoggedIn(w, FOOD);
    const before = others(w);
    const r = await pg.S.earn({ id: 'g:ga-01', n: 10 }); await pg.runTimers();
    const c = cp(w);
    const ev = evs(w, 'pet:earn');
    return { ok: r.result === 'got' && r.food === 'pea' && r.id === 'g:ga-01' && !!c && c.v === 2 && c.got[TODAY]['g:ga-01'] === 'pea' && same(lp(w), c) && others(w) === before
               && ev.length === 1 && J(ev[0]) === J({ result: 'got', food: 'pea', id: 'g:ga-01', date: TODAY, source: 'hook' }) && pg.S.food === true && pg.S.roamV2 === false,
             detail: J({ r, got: c && c.got, others: others(w) === before, ev }) };
  },
  /* 第二輪審查:網路看起來連著、其實不通(訊號差、要登入的 Wi-Fi)時,讀雲端要等 8 秒才逾時,前面還排著答題後的同步就是 16 秒;
     結束畫面只等 10 秒。券不用等雲端:等 2 秒還沒結果就先只寫本機(跟讀不到雲端時同一條路),離開頁面時也先寫 */
  '42a. 網路卡住(讀雲端一直不回)、前面還有一次同步在等:earn 2 秒後先寫在本機並回 got,之後換頁那張券還在,網路好了傳上雲端': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 3));
    const pg = await openLoggedIn(w, FOOD);
    w.readGate = new Promise(() => {});
    pg.S.sync();                                     // 答題後排的同步正在讀雲端
    await tick();
    let r = null;
    pg.S.earn({ id: 'g:ga-01', n: 10 }).then(x => { r = x; });
    await tick();
    const early = r;
    await pg.runShort(3000);                         // 只過了 3 秒:讀雲端的 8 秒逾時還沒到
    const l = lp(w), ev = evs(w, 'pet:earn');
    /* 學生換頁(同一個工作階段),網路恢復 */
    w.readGate = null;
    const p2 = loadPage(w, FOOD); await p2.ready; await p2.runTimers(); await p2.S.idle();
    const l2 = lp(w), c = cp(w);
    return { ok: early === null && !!r && r.result === 'got' && r.food === 'pea' && !!l && l.got && l.got[TODAY] && l.got[TODAY]['g:ga-01'] === 'pea' &&
               ev.length === 1 && ev[0].source === 'hook' && !('pet' in ledger(w) && !ledgers(pg)) && l2.got[TODAY]['g:ga-01'] === 'pea' && !!c && c.got && c.got[TODAY]['g:ga-01'] === 'pea',
             detail: J({ early, r, local: l && l.got, ev: ev.length, next: l2 && l2.got, cloud: c && c.got }) };
  },
  '42b. 網路卡住時拿到點心、2 秒內就離開頁面(pagehide):券先寫在本機,下一頁還在;讀不到雲端時寫本機的規則不變(記帳只在第 3 步)': async () => {
    const out = [];
    for (const how of ['pagehide', 'hidden']) {
      const w = makeWorld();
      cloudRow(w, 'hist', dayHist(TODAY, 3));
      const pg = await openLoggedIn(w, FOOD);
      w.readGate = new Promise(() => {});
      pg.S.earn({ id: 'wr:u1' });
      await tick();
      if (how === 'pagehide') await pg.fire('win:pagehide');
      else { pg.ctx.document.visibilityState = 'hidden'; await pg.fire('doc:visibilitychange'); }
      const l = lp(w);
      w.readGate = null;
      const p2 = loadPage(w, FOOD); await p2.ready; await p2.runTimers(); await p2.S.idle();
      const c = cp(w);
      out.push({ ok: !!l && !!l.got && !!l.got[TODAY] && l.got[TODAY]['wr:u1'] === 'greens' && !!c && !!c.got && c.got[TODAY]['wr:u1'] === 'greens',
        d: how + ':離開時本機 ' + J(l && l.got) + ' / 下一頁雲端 ' + J(c && c.got) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  '42d. 網路卡住時拿到點心(2 秒後先寫本機)、卡住的同步又失敗,然後登出:券記在帳本上,登出前補傳到雲端;網路還不通時登出會先問(第三輪審查 #2)': async () => {
    const out = [];
    for (const back of [true, false]) {
      const w = makeWorld();
      cloudRow(w, 'pet', { v: 1, born: addDays(TODAY, -5), goals: [], days: { [YDAY]: 3 }, met: [], oldMet: 0, oldBefore: '', fed: {}, name: '', nameAt: 0 });
      const pg = await openLoggedIn(w, FOOD);
      await pg.S.idle();
      let release; w.readGate = new Promise(r => { release = r; });   // 網路看起來連著,請求卻卡住
      w.clock.t += 60000;
      const p = pg.S.earn({ id: 'pr', n: 10 });
      await tick();
      await pg.runShort(2000);   // earn 等 2 秒:先寫本機
      const r = await p;
      const ledQuick = 'pet' in ledger(w);
      w.offline = true; release(); w.readGate = null;   // 卡住的那次讀雲端終於失敗
      await tick(); await pg.S.idle(); await tick();
      const ledAfter = 'pet' in ledger(w);
      w.offline = !back;   // 網路恢復了但沒有 online 事件(它從來沒顯示離線);或還是不通
      let asked = false; pg.ctx.confirm = () => { asked = true; return false; };
      await pg.ctx.CLOUD.logout();
      const c = cp(w);
      const inCloud = !!(c && c.got && c.got[TODAY] && c.got[TODAY].pr === 'tomato');
      const kept = !!lp(w) && !!lp(w).got && lp(w).got[TODAY].pr === 'tomato';
      out.push({ ok: r.result === 'got' && r.food === 'tomato' && ledQuick && ledAfter && (back ? inCloud && !asked : asked && kept && !inCloud),
        d: (back ? '網路恢復' : '還是不通') + ':' + J({ r: r.result, ledQuick, ledAfter, inCloud, asked, kept }) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  /* chick2 第一輪修正 #3:畫面在點下去的當下就顯示吃掉了,正式寫入卻排在讀雲端後面(網路卡住要 8 秒)。
     這段時間離開頁面,那一口沒寫進任何地方:下一頁點心回到托盤、今天又能餵、第一次吃到最愛的愛心再跳一次。
     現在 eat 跟 earn 一樣:等 2 秒、離開頁面或切到背景時,先照讀不到雲端的規則寫(同一個吃的 id,之後合併只留一筆) */
  '42e. 網路卡住時餵點心,2 秒內離開頁面、切到背景,或等了 2 秒:這一口先寫在本機(第 3 步記帳),下一頁還是吃過了;網路好了以後只有一筆、雲端也有': async () => {
    const out = [];
    const seed = () => { const days = {}, met = []; for (let i = 3; i >= 1; i--) { const d = addDays(TODAY, -i); days[d] = 25; met.push(d); }
      return { v: 2, born: addDays(TODAY, -3), goals: [], days, met, oldMet: 0, oldBefore: '', fed: {}, name: '小黃', nameAt: 5, got: { [YDAY]: { d: 'corn' } } }; };
    const ateToday = p => (p && p.ate && p.ate[TODAY] ? p.ate[TODAY] : {});
    for (const how of ['pagehide', 'hidden', 'wait', 'release']) {
      const w = makeWorld();
      cloudRow(w, 'pet', seed()); cloudRow(w, 'hist', dayHist(TODAY, 3));
      const pg = await openLoggedIn(w, FOOD);
      await pg.S.idle();
      let release; w.readGate = new Promise(r => { release = r; });   // 網路看起來連著,請求卻卡住
      w.clock.t += 60000;
      const e = pg.S.eat('corn');
      let saved = null; e.saved.then(x => { saved = x; });
      await tick();
      if (how === 'pagehide') { await pg.runShort(1000); await pg.fire('win:pagehide'); }
      if (how === 'hidden') { await pg.runShort(1000); pg.ctx.document.visibilityState = 'hidden'; await pg.fire('doc:visibilitychange'); }
      if (how === 'wait' || how === 'release') await pg.runShort(2000);
      const atLeave = ateToday(lp(w));
      const ids = Object.keys(atLeave);
      const okLeave = e.ok && e.left === 0 && ids.length === 1 && atLeave[ids[0]] === YDAY + '/d' && 'pet' in ledger(w);
      let d;
      if (how === 'release') {
        release(); w.readGate = null;
        await tick(); await pg.S.idle(); await pg.runTimers(); await tick();
        const c = cp(w);
        const ok = okLeave && !!saved && saved.ok === true && J(Object.keys(ateToday(lp(w)))) === J(ids) && J(Object.keys(ateToday(c))) === J(ids);
        d = { ok, how, eat: e.ok, saved, local: ateToday(lp(w)), cloud: ateToday(c) };
      } else {
        w.readGate = null;   // 網路好了;同一個工作階段的下一頁
        const p2 = loadPage(w, FOOD); await p2.ready; await p2.runTimers(); await p2.S.idle();
        const v = p2.S.view().pantry;
        const c = cp(w);
        const ok = okLeave && v.stock.corn === 0 && v.ateToday === true && J(Object.keys(ateToday(lp(w)))) === J(ids) && J(Object.keys(ateToday(c))) === J(ids);
        d = { ok, how, eat: e.ok, atLeave, ledger: ledger(w), next: { corn: v.stock.corn, ateToday: v.ateToday }, cloud: ateToday(c) };
      }
      out.push(d);
    }
    return { ok: out.every(x => x.ok), detail: J(out.filter(x => !x.ok)).slice(0, 900) };
  },
  /* chick2 第一輪修正 #4:結束畫面剛出現、earn 還在等讀雲端時就登出。登出前只看帳本,那張還沒寫的券不算,
     沒問就清掉帳號資料夾,'pr' 這種補不回來的券就沒了。現在登出前先叫 pet-store 把還在等的券寫下來,再補傳或先問 */
  '42f. 拿到點心後 1 秒內登出(earn 還在等讀雲端):網路慢但會回時券傳上雲端、不用問;網路卡死時先問,取消就留著': async () => {
    const out = [];
    for (const net of ['slowOk', 'hang']) {
      const w = makeWorld();
      cloudRow(w, 'pet', { v: 1, born: addDays(TODAY, -5), goals: [], days: { [YDAY]: 3 }, met: [], oldMet: 0, oldBefore: '', fed: {}, name: '', nameAt: 0 });
      cloudRow(w, 'hist', dayHist(TODAY, 3));
      const pg = await openLoggedIn(w, FOOD);
      await pg.S.idle();
      let release; w.readGate = new Promise(r => { release = r; });
      w.clock.t += 60000;
      let res = null; pg.S.earn({ id: 'pr', n: 10 }).then(x => { res = x; });
      await tick();
      await pg.runShort(1000);   // 還不到 2 秒:earn 還沒先寫
      const before = !!(lp(w) && lp(w).got);
      let asked = 0; pg.ctx.confirm = () => { asked++; return false; };
      const reloads0 = w.reloads;
      let over = false; const lo = pg.ctx.CLOUD.logout().then(() => { over = true; }, () => { over = true; });
      await tick();
      if (net === 'slowOk') { release(); w.readGate = null; await tick(); await tick(); }   // 讀雲端慢了一點才回來(在 8 秒內)
      for (let i = 0; i < 4 && !over; i++) await pg.runShort(8000);   // 讀雲端 8 秒的逾時
      await lo;
      const c = cp(w), l = lp(w);
      const inCloud = !!(c && c.got && c.got[TODAY] && c.got[TODAY].pr);
      const kept = !!(l && l.got && l.got[TODAY] && l.got[TODAY].pr);
      const ok = !before && (net === 'slowOk' ? inCloud && asked === 0 && w.reloads === reloads0 + 1 : asked === 1 && kept && w.reloads === reloads0);
      out.push({ ok, d: net + ':' + J({ before, inCloud, asked, kept, reloads: w.reloads - reloads0, res }) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  '42c. 網路正常時 earn 照舊等合併後的結果(不先寫本機):別台今天已經拿過,這台回 cap,本機和雲端都只有那一張': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 3));
    const pg = await openLoggedIn(w, FOOD);
    const c0 = cp(w);
    w.db.find(x => x.k === 'pet').v = Object.assign({}, c0, { v: 2, got: { [TODAY]: { d: 'corn' } } });   // 手機剛拿到
    const writes = recordPetWrites(w);
    const r = await pg.S.earn({ id: 'g:ga-01', n: 10 }); await pg.runTimers(); await pg.runShort(5000);
    const c = cp(w), l = lp(w);
    return { ok: r.result === 'cap' && J(c.got) === J({ [TODAY]: { d: 'corn' } }) && J(l.got) === J(c.got) && !writes.some(s => /g:ga-01/.test(s)),
             detail: J({ r, cloud: c.got, local: l.got }) };
  },
  '43. 食物打開:從 daily_done、mock_history、diag、達標補的券寫進 got;補到今天的才送 pet:earn(source backfill);那幾個鍵本機與雲端一個字都沒變': async () => {
    const w = makeWorld();
    const d1 = addDays(TODAY, -3), d2 = addDays(TODAY, -2), d3 = addDays(TODAY, -1);
    const daily = { [d1]: { d: { a: 1, b: 1, c: 1, e: 1, f: 0 } } };
    const mock = [{ d: new Date(tp(d2 + ' 09:00:00')).toISOString(), size: 'mini', lRaw: 1 }];
    const diag = { answers: { 0: 1 }, done: true, startedAt: new Date(tp(d3 + ' 19:00:00')).toISOString(), finishedAt: new Date(tp(d3 + ' 20:00:00')).toISOString() };
    cloudRow(w, 'daily_done', daily); cloudRow(w, 'mock_history', mock); cloudRow(w, 'diag', diag);
    cloudRow(w, 'hist', dayHist(TODAY, 25));
    const raw = () => J([w.local.getItem(PREFIX + 'daily_done'), w.local.getItem(PREFIX + 'mock_history'), w.local.getItem(PREFIX + 'diag'), w.local.getItem(PREFIX + 'hist')]);
    const pg = await openLoggedIn(w, FOOD);
    const r0 = raw();
    await pg.S.sync(); await pg.runTimers();
    const c = cp(w);
    const ev = evs(w, 'pet:earn').filter(e => e.source === 'backfill');
    const rows = ['daily_done', 'mock_history', 'diag'].map(k => J(w.db.find(r => r.k === k).v));
    const want = [[d1, 'd', 'corn'], [d2, 'mock', 'melon'], [d3, 'diag', 'melon'], [TODAY, 'm', 'greens']];
    return { ok: want.every(([d, id, f]) => c.got[d] && c.got[d][id] === f) && c.once.diag === d3 && J(rows) === J([daily, mock, diag].map(J)) && raw() === r0
               && J(JSON.parse(w.local.getItem(PREFIX + 'daily_done'))) === J(daily) && ev.length >= 1 && ev.every(e => e.date === TODAY && e.id === 'm' && e.food === 'greens'),
             detail: J({ got: c && c.got, once: c && c.once, ev: ev.map(e => e.date + ' ' + e.id) }) };
  },
  '44. 每日練習一項做完(daily_done 已經記了 5 題)時掛勾叫 earn("d"):拿到玉米,不會被補寫先搶走變成「拿過了」': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 2));
    const pg = await openLoggedIn(w, FOOD);
    setLocal(w, PREFIX + 'daily_done', { [TODAY]: { d: { a: 1, b: 1, c: 1, e: 1, f: 1 } } });
    const r = await pg.S.earn({ id: 'd' }); await pg.runTimers();
    const ev = evs(w, 'pet:earn').filter(e => e.date === TODAY);
    return { ok: r.result === 'got' && r.food === 'corn' && ev.length === 1 && ev[0].source === 'hook' && cp(w).got[TODAY].d === 'corn', detail: J({ r, ev }) };
  },
  /* chick2 第三輪修正 #4:前一次同步正在讀雲端(網路慢、會回)時交卷。那一輪讀完雲端才讀 hist,補寫先把這次交卷補成今天的券,
     掛勾排在後面拿到 cap,結束畫面寫「今天的點心拿過了」,其實這就是今天第一份。規格 5.2:同一天同一個來源是同一張券 */
  '44a. 前一次同步讀雲端讀到一半時交卷(今天第一個完成):補寫先寫了這次的券,掛勾還是回 got 與那份食物;券只有一張,pet:earn 只送一次': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(YDAY, 5));
    const pg = await openLoggedIn(w, FOOD);
    await pg.S.idle(); await pg.runTimers();
    let release;
    w.readGate = new Promise(r => { release = r; });
    pg.answer('r', 'a1:0');
    w.clock.t += 30000;
    const s1 = pg.S.sync();
    await tick();
    w.clock.t += 1000;
    pg.ctx.__api.logAttempt('tq', 'a1', 4, false, { n: 5 });
    let res = null;
    pg.S.earn({ id: 'tq:a1' }).then(x => { res = x; });
    await tick();
    w.clock.t += 500;
    w.readGate = null; release();
    await s1; await pg.S.idle(); await tick();
    const today = lp(w).got && lp(w).got[TODAY];
    const ev = evs(w, 'pet:earn').filter(e => e.date === TODAY);
    return { ok: !!res && res.result === 'got' && res.food === 'tomato' && res.id === 'tq:a1' && J(today) === J({ 'tq:a1': 'tomato' }) && ev.length === 1,
             detail: J({ res, today, ev }) };
  },
  '44b. 44a 的對照:補寫寫的是今天更早的另一個完成(先玩的落葉),或同一個來源今天已經拿過、再做一次:掛勾照舊回 cap': async () => {
    const out = [];
    /* 先玩了落葉(沒有掛勾,只在 hist),同步讀雲端讀到一半時交卷 */
    {
      const w = makeWorld();
      cloudRow(w, 'hist', dayHist(YDAY, 5));
      const pg = await openLoggedIn(w, FOOD);
      await pg.S.idle(); await pg.runTimers();
      let release;
      w.readGate = new Promise(r => { release = r; });
      w.clock.t += 10000;
      pg.ctx.__api.logAttempt('vq', 'fall', 0, true);
      w.clock.t += 30000;
      const s1 = pg.S.sync();
      await tick();
      w.clock.t += 1000;
      pg.ctx.__api.logAttempt('tq', 'a1', 4, false, { n: 5 });
      let res = null;
      pg.S.earn({ id: 'tq:a1' }).then(x => { res = x; });
      await tick();
      w.readGate = null; release();
      await s1; await pg.S.idle(); await tick();
      const today = lp(w).got && lp(w).got[TODAY];
      out.push({ ok: !!res && res.result === 'cap' && J(today) === J({ fall: 'berry' }), d: '先玩落葉:' + J({ res, today }) });
    }
    /* 同一個來源今天拿過了,再做一次;同時連叫兩次同一個來源 */
    {
      const w = makeWorld();
      cloudRow(w, 'hist', dayHist(YDAY, 5));
      const pg = await openLoggedIn(w, FOOD);
      const r1 = await pg.S.earn({ id: 'tq:a1' }); await pg.runTimers();
      const r2 = await pg.S.earn({ id: 'tq:a1' }); await pg.runTimers();
      out.push({ ok: r1.result === 'got' && r2.result === 'cap', d: '再做一次:' + J([r1.result, r2.result]) });
      const w2 = makeWorld();
      cloudRow(w2, 'hist', dayHist(YDAY, 5));
      const pg2 = await openLoggedIn(w2, FOOD);
      const rs = await Promise.all([pg2.S.earn({ id: 'iv' }), pg2.S.earn({ id: 'iv' })]);
      out.push({ ok: J(rs.map(r => r.result)) === J(['got', 'cap']), d: '連叫兩次:' + J(rs.map(r => r.result)) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  '45. 食物打開:earn 的每一種結果(got、cap、full、once、off、bad、short);short 不排隊、不讀雲端': async () => {
    const w0 = makeWorld(); const p0 = await openLoggedIn(w0, { food: false, from: FROM });
    const off = await p0.S.earn({ id: 'd' });
    const w1 = makeWorld(); const p1 = await openLoggedIn(w1, { food: true, from: '' });
    const off2 = await p1.S.earn({ id: 'd' });
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 6));
    cloudRow(w, 'pet', { v: 2, born: '2026-09-20', got: ticketsBefore('melon', 9), once: { diag: '2026-09-30' } });
    const pg = await openLoggedIn(w, FOOD);
    const reads = w.keyReads.length;
    const short = await pg.S.earn({ id: 'g:ga-01', n: 4 });
    const shortReads = w.keyReads.length - reads;
    const bad = await pg.S.earn({ id: 'zz' });
    const full = await pg.S.earn({ id: 'mock' });
    const once = await pg.S.earn({ id: 'diag' });
    const got = await pg.S.earn({ id: 'iv', n: 5 });
    const cap = await pg.S.earn({ id: 'p5', n: 20 });
    const res = [off, off2, short, bad, full, once, got, cap].map(r => r.result);
    return { ok: J(res) === J(['off', 'off', 'short', 'bad', 'full', 'once', 'got', 'cap']) && shortReads === 0 && full.food === 'melon' && got.food === 'pea' && [off, off2, short, bad, once, cap].every(r => r.food === null) && p0.S.food === false && p1.S.food === false,
             detail: J({ res, shortReads, full, got }) };
  },
  '46. 食物打開:這次唯讀(雲端是更新版 v3)時 earn 回 later,記在分頁裡;之後第一次正常的同步依原本的完成時間(前一天)補寫,送 pet:earn(source later)': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 6));
    const pg = await openLoggedIn(w, FOOD);
    w.db.find(r => r.k === 'pet').v = { v: 3 };
    w.clock.t = tp(TODAY + ' 23:50:00');
    const r = await pg.S.earn({ id: 'g:ga-01', n: 10 });
    const cloudV3 = same(cp(w), { v: 3 }) && !lp(w).got;
    w.clock.t = tp(addDays(TODAY, 1) + ' 08:00:00');
    w.db.find(r => r.k === 'pet').v = JSON.parse(JSON.stringify(lp(w)));   // 別台退回來了
    await pg.S.sync(); await pg.runTimers();
    const c = cp(w);
    const ev = evs(w, 'pet:earn').filter(e => e.source === 'later');
    await pg.S.sync(); await pg.runTimers();
    const ev2 = evs(w, 'pet:earn').filter(e => e.source === 'later');
    return { ok: r.result === 'later' && r.food === null && cloudV3 && !!c.got && c.got[TODAY] && c.got[TODAY]['g:ga-01'] === 'pea' && ev.length === 1 && ev[0].date === TODAY && ev2.length === 1,
             detail: J({ r, cloudV3, got: c && c.got, ev }) };
  },
  '47. 食物打開:eat 當場回 ok 與剩幾份,saved 等正式寫入;寫入時雲端變成 v3 就 saved.ok false、本機沒寫;食物沒開回 off': async () => {
    const w = makeWorld(); cloudRow(w, 'hist', dayHist(TODAY, 6));
    const pg = await openLoggedIn(w, FOOD);
    await pg.S.earn({ id: 'd' }); await pg.runTimers();
    const e = pg.S.eat('corn');
    const s = await e.saved; await pg.runTimers();
    const c = cp(w);
    const after = pg.S.view().pantry;
    const w2 = makeWorld(); cloudRow(w2, 'hist', dayHist(TODAY, 6));
    const pg2 = await openLoggedIn(w2, FOOD);
    await pg2.S.earn({ id: 'iv', n: 9 }); await pg2.runTimers();
    w2.db.find(r => r.k === 'pet').v = { v: 3 };
    const e2 = pg2.S.eat('pea'); const s2 = await e2.saved;
    const w3 = makeWorld(); const pg3 = await openLoggedIn(w3, { food: false });
    const e3 = pg3.S.eat('corn'); const s3 = await e3.saved;
    const bad = pg.S.eat('grain');
    return { ok: e.ok && e.left === 0 && s.ok && !!c.ate && Object.values(c.ate[TODAY]).includes(TODAY + '/d') && same(lp(w), c) && after.ateToday && after.stock.corn === 0
               && e2.ok && s2.ok === false && s2.reason === 'readOnly' && !lp(w2).ate && e3.ok === false && e3.reason === 'off' && s3.ok === false && s3.reason === 'off' && bad.ok === false && bad.reason === 'badFood',
             detail: J({ e: [e.ok, e.left], s, ate: c && c.ate, s2, e3: e3.reason, bad: bad.reason }) };
  },
  '48. 同一個分頁快速連點 5 次:earn 排隊後只有第一個拿到、其他 cap;eat 第一下成功,其他當場就回 ateToday;上傳次數不多': async () => {
    const w = makeWorld(); cloudRow(w, 'hist', dayHist(TODAY, 6));
    const pg = await openLoggedIn(w, FOOD);
    const ups = w.upserts.filter(k => k === 'pet').length;
    const rs = await Promise.all(['g:ga-01', 'iv', 'pairs', 'p5', 'mock'].map(id => pg.S.earn({ id, n: 10 })));
    const eats = [0, 1, 2, 3, 4].map(() => pg.S.eat('pea'));
    const saved = await Promise.all(eats.map(e => e.saved));
    await pg.runTimers();
    const up = w.upserts.filter(k => k === 'pet').length - ups;
    const c = cp(w);
    return { ok: J(rs.map(r => r.result)) === J(['got', 'cap', 'cap', 'cap', 'cap']) && eats[0].ok && eats.slice(1).every(e => e.ok === false && e.reason === 'ateToday') && saved[0].ok && saved.slice(1).every(s => s.ok === false)
               && Object.keys(c.ate[TODAY]).length === 1 && up >= 1 && up <= 2,
             detail: J({ rs: rs.map(r => r.result), eats: eats.map(e => e.ok || e.reason), saved: saved.map(s => s.ok), up, ate: c && c.ate }) };
  },
  '49. view():開關都關時鍵跟第 1 步一樣;食物打開多 food、pantry;走動打開多 roamV2、roam': async () => {
    const keysOf = async opt => { const w = makeWorld(); cloudRow(w, 'hist', dayHist(TODAY, 3)); const pg = await openLoggedIn(w, opt); return Object.keys(pg.S.view()); };
    const k1 = await keysOf({ step1: true }), k0 = await keysOf({}), kf = await keysOf(FOOD), kr = await keysOf({ roam: true }), kb = await keysOf(Object.assign({ roam: true }, FOOD));
    return { ok: J(k0) === J(k1) && J(kf) === J(k1.concat(['food', 'pantry'])) && J(kr) === J(k1.concat(['roamV2', 'roam'])) && J(kb) === J(k1.concat(['food', 'pantry', 'roamV2', 'roam'])),
             detail: J({ k1, k0, kf, kr, kb }) };
  },
  '50. 走動開關:PET_ROAM_V2 關著時 setRoam 回 off、不寫;打開時寫 roam(v2),view().roam 跟著變;食物關著也一樣': async () => {
    const w0 = makeWorld(); const p0 = await openLoggedIn(w0);
    const writes = countPetWrites(w0);
    const r0 = await p0.S.setRoam(false);
    const w = makeWorld(); cloudRow(w, 'hist', dayHist(TODAY, 3));
    const pg = await openLoggedIn(w, { roam: true });
    const v0 = pg.S.view().roam;
    const r = await pg.S.setRoam(false); await pg.runTimers();
    const v1 = pg.S.view().roam, c = cp(w);
    return { ok: r0.ok === false && r0.reason === 'off' && writes.n === 0 && v0 === true && r.ok && v1 === false && c.v === 2 && c.roam.on === false && !c.got && pg.S.roamV2 === true && pg.S.food === false,
             detail: J({ r0, w: writes.n, v0, r: r.ok, v1, roam: c && c.roam }) };
  },
  '51. 讀不到雲端時(規格 A.5):cloud.js 是先合併的新版(mergedKeys 有 pet)而且第二階段的開關打開了(第 3 步)才用 store.set 記帳交給它;開關都關著(第 2 步,同一台可能還開著第 1 步的分頁)或舊版 cloud.js 照舊只寫本機;讀得到雲端但對不了時(沒有憑證)一律只寫本機': async () => {
    const out = [];
    const c0 = { v: 1, born: '2026-10-01', days: { '2026-10-01': 25 }, met: ['2026-10-01'] };
    for (const [m, sw] of [[true, {}], [false, {}], [true, FOOD], [true, { roam: true }], [false, FOOD]]) {
      const w = makeWorld(); cloudRow(w, 'pet', c0);
      const pg = await openLoggedIn(w, Object.assign({ merged: m }, sw));
      const before = J(cp(w));
      const want = m && (sw.food === true || sw.roam === true);
      w.offline = true; pg.answer('p5', 'a'); pg.answer('p5', 'b'); await pg.runTimers(); await pg.S.idle();
      out.push({ ok: merged(pg) === m && ('pet' in ledger(w)) === want && lp(w).days[TODAY] === 2 && J(cp(w)) === before,
        d: 'mergedKeys ' + m + ' 開關 ' + J(sw) + ':帳本 ' + ('pet' in ledger(w)) + '(應該 ' + want + ')、雲端 ' + (J(cp(w)) === before ? '沒動' : '被改') });
    }
    const w = makeWorld(); cloudRow(w, 'pet', c0); cloudRow(w, 'hist', dayHist(TODAY, 3)); w.noToken = true;
    await openLoggedIn(w, { merged: true });
    out.push({ ok: !('pet' in ledger(w)) && same(cp(w), c0) && lp(w).days[TODAY] === 3, d: '沒有憑證:帳本 ' + ('pet' in ledger(w)) + '、雲端 ' + (same(cp(w), c0) ? '沒動' : '被改') });
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  /* chick2 第二輪修正 #4:手機離線吃了最舊的玉米(隔天午夜要壓縮的那張舊券),午夜前沒同步;隔天早上筆電先開,
     自己壓縮到新的截止日(不知道這一口)並上傳;手機恢復連線合併。以前吃掉的那份在兩台都回來 */
  '52. 食物打開:手機離線吃了最舊的舊券、午夜前沒同步,隔天筆電先同步、手機再合併:吃掉的不會回來,兩台都一樣': async () => {
    const db = [];
    const D = TODAY, c0 = addDays(D, -119);
    const days = {}, met = []; for (let i = 6; i >= 1; i--) { const d = addDays(D, -i); days[d] = 25; met.push(d); }
    const seed = { v: 2, born: '2026-01-01', goals: [], days, met, oldMet: 0, oldBefore: '', fed: {}, name: '', nameAt: 0,
      foodOld: { before: c0, got: { corn: 2 }, ate: {} }, got: { [c0]: { d: 'corn' }, [addDays(c0, 1)]: { d: 'corn' }, [YDAY]: { iv: 'pea' } } };
    const wa = makeWorld(db), wb = makeWorld(db);
    cloudRow(wa, 'pet', seed); cloudRow(wa, 'hist', dayHist(D, 3));
    const a = await openLoggedIn(wa, FOOD), b = await openLoggedIn(wb, FOOD);
    await a.S.idle(); await b.S.idle();
    const before = a.S.view().pantry.stock.corn;
    wa.offline = true;
    const e = a.S.eat('corn'); await e.saved;
    const afterEat = a.S.view().pantry.stock.corn;
    const ticket = Object.values((lp(wa).ate || {})[D] || {})[0];
    const morning = tp(addDays(D, 1) + ' 08:00:00');
    wa.clock.t = morning; wb.clock.t = morning;
    const b2 = loadPage(wb, FOOD); await b2.ready; await b2.runTimers(); await b2.S.idle(); await b2.runTimers();
    const laptopFirst = cp(wb).foodOld;
    wa.offline = false; wa.clock.t = morning + 3600e3; wb.clock.t = wa.clock.t;
    await a.fire('win:online'); await a.runTimers(); await a.S.idle(); await a.runTimers();
    const b3 = loadPage(wb, FOOD); await b3.ready; await b3.runTimers(); await b3.S.idle(); await b3.runTimers();
    const ca = a.S.view().pantry.stock.corn, cb = b3.S.view().pantry.stock.corn;
    return { ok: e.ok && /^old:/.test(ticket) && before === 4 && afterEat === 3 && ca === 3 && cb === 3,
      detail: J({ ticket, before, afterEat, laptopFirst, phone: ca, laptop: cb, cloud: cp(wa).foodOld }) };
  },
  /* chick2 第二輪修正 #5(規格 5.2 與附錄 C 第 10 條改寫的取捨):手機分頁停在筆電領麵包蟲之前,隔天在卡住的網路上完成練習,
     用自己舊的那份判斷,同一個階段的麵包蟲又給一次(日期不同,是另一張券)。這一張占掉手機那天的名額,學生拿到麵包蟲而不是那天的點心,
     總份數不變;合併不收回任何一張(寧可多給)。這裡釘住:兩張都在、每天只有一張、once 記較早那天、之後不會再給第三次 */
  '53. 食物打開:同一個階段的麵包蟲在兩台、兩天各給一次:兩張都留著、每天還是只有一張、once 記較早那天;之後不再給第三次': async () => {
    const db = [];
    const wl = makeWorld(db), wp = makeWorld(db);
    cloudRow(wl, 'hist', dayHist(YDAY, 25));
    const lap = await openLoggedIn(wl, FOOD), ph = await openLoggedIn(wp, FOOD);
    await lap.S.idle(); await ph.S.idle();
    const r1 = await lap.S.earn({ id: 'pr', n: 10 }); await lap.runTimers(); await lap.S.idle();
    const D1 = addDays(TODAY, 1), t = tp(D1 + ' 09:00:00'); wl.clock.t = t; wp.clock.t = t;
    wp.readGate = new Promise(() => {});
    let r2 = null; ph.S.earn({ id: 'iv', n: 10 }).then(x => { r2 = x; });
    await tick(); await ph.runShort(2000); await tick();
    wp.readGate = null;
    const ph2 = loadPage(wp, FOOD); await ph2.ready; await ph2.runTimers(); await ph2.S.idle(); await ph2.runTimers();
    await lap.S.sync(); await lap.runTimers();
    const c = cp(wl);
    const perDay = Object.keys(c.got).every(d => Object.keys(c.got[d]).length === 1);
    const D2 = addDays(TODAY, 2); wl.clock.t = tp(D2 + ' 09:00:00');
    const r3 = await lap.S.earn({ id: 'iv', n: 10 }); await lap.runTimers();
    const worms = lap.S.view().pantry.stock.worm || 0;
    return { ok: r1.food === 'worm' && r2 && r2.food === 'worm' && c.got[TODAY]['w:s1'] === 'worm' && c.got[D1]['w:s1'] === 'worm' && perDay
      && c.once['w:s1'] === TODAY && r3.food === 'pea' && worms === 2,
      detail: J({ laptop: r1, phone: r2, got: c.got, once: c.once, third: r3, worms }) };
  },
};

(async () => {
  let pass = 0;
  for (const [name, fn] of Object.entries(scenarios)) {
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + r.detail);
  }
  const total = Object.keys(scenarios).length;
  console.log(pass + ' / ' + total + ' 通過');
  process.exit(pass === total ? 0 : 1);
})();
