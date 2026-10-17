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
  config: fs.existsSync(path.join(REPO, 'js/pet-config.js')) ? read('js/pet-config.js') : '',
  store: fs.existsSync(path.join(REPO, 'js/pet-store.js')) ? read('js/pet-store.js') : '',
};

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

/* 開一頁:opt.on 是 PET_ON(預設 true),opt.search 是網址的 ?,opt.noCloud 是沒填雲端設定的網站 */
function loadPage(w, opt) {
  opt = opt || {};
  const timers = new Map(); let tid = 0;
  const listeners = {};
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(w.clock.t); }
    static now() { return w.clock.t; }
  }
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    Date: FakeDate, CustomEvent,
    setTimeout: fn => { const id = ++tid; timers.set(id, fn); return id; },
    clearTimeout: id => { timers.delete(id); },
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
  ctx.dispatchEvent = e => { w.events.push(e.type); return true; };
  ctx.CLOUD_CONFIG = opt.noCloud ? {} : { url: 'https://x.supabase.co', anonKey: 'k' };
  ctx.supabase = { createClient: () => makeClient(w) };
  vm.createContext(ctx);
  vm.runInContext(SRC.common + '\n;globalThis.__api = { store, logAttempt };', ctx);
  vm.runInContext(SRC.cloud, ctx);
  vm.runInContext(SRC.pet, ctx);
  if (SRC.config) vm.runInContext(SRC.config, ctx);
  ctx.PET_ON = opt.on === undefined ? true : opt.on;
  if (!SRC.store) throw new Error('js/pet-store.js 還不存在');
  vm.runInContext(SRC.store, ctx);
  const S = ctx.PET_STORE;
  return {
    ctx, S,
    ready: ctx.CLOUD.ready.then(tick).then(() => S && S.ready).then(tick),
    /* 排程中的計時器全部跑完(跑的過程又排的也跑,最多 6 輪);不等小雞的同步佇列,免得卡在等逾時計時器的 readKey */
    async runTimers() { for (let n = 0; n < 6 && timers.size; n++) { const fns = [...timers.values()]; timers.clear(); for (const f of fns) await f(); await tick(); } await tick(); },
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

/* 第二階段的紀錄(v2):第一階段的欄位加上食物與走動開關。第 1 步的相容版只能看、一筆都不寫 */
function v2Pet(over) {
  const days = {}, met = [];
  for (let i = 9; i >= 0; i--) { const d = addDays(TODAY, -i); days[d] = 25; met.push(d); }
  return Object.assign({ v: 2, born: addDays(TODAY, -9), goals: [], days, met, oldMet: 0, oldBefore: '', fed: { [TODAY]: 25 }, name: '小黃', nameAt: 5,
    got: { [YDAY]: { d: 'corn' } }, ate: { [YDAY]: { mh2lq01xk7: YDAY + '/d' } }, foodOld: { before: '2026-07-05', left: { corn: 2 } }, once: { diag: YDAY }, roam: { on: false, at: 1793000000000 } }, over || {});
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
  '8. 讀不到雲端(離線):只寫本機,不記帳、不上傳;恢復連線後合併上傳,雲端原本的天還在': async () => {
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
    return { ok: !!localOff && localOff.days[TODAY] === 4 && !('pet' in ledOff) && cloudOff === cloudBefore && !!c && c.days['2026-10-01'] === 25 && c.days[TODAY] === 4,
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
    return { ok: r1 === cloudBefore && JSON.stringify(cp(w)) === cloudBefore && !('pet' in led1) && !('pet' in ledger(w)) && !!l && l.days[TODAY] === 3,
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
    return { ok: JSON.stringify(cp(w)) === cloudBefore && !('pet' in ledger(w)) && !!l && l.days[TODAY] === 1,
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
  '12. 雲端那份救不回(字串、陣列、v:2):本機與雲端都不寫,畫面照樣算得出今天的題數': async () => {
    const out = [];
    for (const bad of ['oops', [1, 2], { v: 2, days: { '2026-10-01': 9 } }]) {
      const w = makeWorld();
      cloudRow(w, 'pet', bad);
      cloudRow(w, 'hist', dayHist(TODAY, 3));
      const pg = await openLoggedIn(w);
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
    return { ok: r.ok && r.uploaded === false && off.fed === 5 && !off.led && c.fed[TODAY] === 5 && c.days['2026-10-02'] === 30 && c.days[TODAY] === 5,
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
    return { ok: view === 5 && w.keyReads.length - reads === 1 && w.upserts.filter(k => k === 'pet').length - ups === 1 && c.days[TODAY] === 5 && JSON.parse(w.local.getItem(PREFIX + 'hist')).length === 5,
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
  '34. 雲端是 v2(灌資料後本機也是 v2):開頁、同步、餵飼料、改目標、取名各 3 次,本機與雲端的 pet 一次都沒寫,其他鍵逐位元組不變;畫面照 v2 顯示,說明資料是新版網頁存的(newer)': async () => {
    const w = makeWorld();
    const rec = v2Pet();
    cloudRow(w, 'pet', JSON.parse(JSON.stringify(rec)));
    cloudRow(w, 'hist', dayHist(TODAY, 3));
    cloudRow(w, 'drill_p5', ['a']);
    const pg = await openLoggedIn(w);
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
  '35. 本機 v2、讀不到雲端(離線)與訪客:動作全部回絕,本機那份一個 byte 都沒變,不記帳、不上傳;恢復連線後雲端那份 v1 也不動': async () => {
    const out = [];
    const w = makeWorld();
    const cloud1 = { v: 1, born: '2026-10-01', days: { '2026-10-01': 25 }, met: ['2026-10-01'] };
    cloudRow(w, 'pet', cloud1);
    const pg = await openLoggedIn(w);
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
    const pgG = loadPage(g); await pgG.ready;
    const resG = await pokeAll(pgG, g);
    const vg = pgG.S.view();
    out.push({ ok: gw.n === 0 && g.local.getItem(GUESTKEY) === raw && allRefused(resG) && vg.readOnly && vg.status.name === '小黃' && vg.status.todayCount === 25,
               d: '訪客:寫 ' + gw.n + ' 次、畫面 ' + JSON.stringify({ name: vg.status.name, today: vg.status.todayCount }) });
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  '36. 這個分頁開著時別台把雲端升成 v2(本機還是 v1):本機、雲端都不寫;畫面顯示兩邊合併的結果': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 4));
    const pg = await openLoggedIn(w);
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
  '37. 本機 v2、雲端被舊分頁蓋回 v1(本機有雲端沒有的天):兩邊都不寫,誰都沒少;畫面顯示合併': async () => {
    const w = makeWorld();
    cloudRow(w, 'hist', dayHist(TODAY, 1));
    const pg = await openLoggedIn(w);
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
