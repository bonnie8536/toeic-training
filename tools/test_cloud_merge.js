/* 小雞第二階段:js/cloud.js 對 pet 先合併再上傳、灌雲端資料時先合併不覆蓋(規格附錄 A.5、實作契約第 3 節)。
   用法:node tools/test_cloud_merge.js            全部
         node tools/test_cloud_merge.js --part=A   只跑 A 部分
   A 部分:只靠 js/cloud.js 和一個假的 PET.cloudMerge(items 取聯集;v 大於 2 回 ok:false),cloud.js 自己就要全綠。
           其他鍵逐位元組不變:tools/test_sync.js 的每個情境,用第 1 步的 cloud.js(tools/fixtures/cloud_step1.js)和新版各跑一次,
           本機、分頁暫存、雲端、每一次請求都要一樣。
   B 部分:載入真的 js/common.js、js/pet.js、js/pet-food.js、js/pet-store.js(附錄 C「test_pet_store.js 新增」第 4、5、9 條等),
           pet.js 還沒有 cloudMerge 之前會紅,由 Integrate 跑綠。
   跟 tools/test_sync.js 同一套做法:假的 Supabase、假的 localStorage、假的時鐘與計時器。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const exists = f => fs.existsSync(path.join(REPO, f));
const maybe = f => (exists(f) ? read(f) : '');
/* 第 1 步(27557eb)那一版:有 fixture 用 fixture,沒有就從 git 拿 */
function step1(file, fixture) {
  if (exists(fixture)) return read(fixture);
  try { return execFileSync('git', ['-C', REPO, 'show', '27557eb:' + file], { encoding: 'utf8' }); } catch (e) { return ''; }
}
const COMMON = read('js/common.js');
const NEW = { cloud: read('js/cloud.js'), pet: read('js/pet.js'), food: maybe('js/pet-food.js'), store: maybe('js/pet-store.js'), config: maybe('js/pet-config.js') };
const OLD = { cloud: read('tools/fixtures/cloud_step1.js'), pet: step1('js/pet.js', 'tools/fixtures/pet_step1.js'), food: '',
  store: step1('js/pet-store.js', 'tools/fixtures/pet_store_step1.js'), config: '' };

const USER = { id: '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72', email: 's@x.com', user_metadata: { name: '學生' } };
const OTHER = { id: '9a9a9a9a-0000-4000-8000-000000000000', email: 'b@x.com' };
const PID = 'c' + USER.id.replace(/-/g, '');
const PREFIX = 'tr_u' + PID + '_';
const LEDGER = 'tr_unsynced_' + USER.id;
const SB_KEY = 'sb-x-auth-token';
const HOUR = 3600e3;
const TODAY = '2026-10-16';
const FROM = '2026-10-01';
/* 食物上線日放在 v1() 的達標日 10-10 之後:不然第 1 階段算上線後才到,第一張券照規則是麵包蟲 w:s1,不是這裡要測的 d(Integrate 改) */
const FOOD_FROM = '2026-10-11';
const T0 = Date.parse(TODAY + 'T12:00:00+08:00');
const iso = t => new Date(t).toISOString();
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const YDAY = addDays(TODAY, -1);
const OLD_BANK = [{ name: '我的題庫', words: ['apple'] }];
const NEW_BANK = [{ name: '我的題庫', words: ['apple', 'banana', 'cherry'] }];
/* 「其他鍵照舊整份上傳」用的例子:以前是自訂題庫 vgame_banks,題庫改成先合併再上傳(js/sync-merge.js)後換成不在合併表上的錯題本 */
const PLAIN = 'drill_p5';

/* ---------- 假的環境 ---------- */
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
  return { db: db || [], local: makeStorage(), session: makeStorage(), offline: false, reloads: 0, confirms: [], confirmAnswer: true,
    clock: { t: T0 }, ops: [], events: [] };
}
function token(w, user) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const iat = Math.floor((w.clock.t + (w.serverAhead || 0)) / 1000);   // serverAhead:伺服器時間比這台快多少(這台時鐘慢)
  return b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: user.id, iat, exp: iat + 3600 }) + '.sig';
}
/* w.ops:每一次請求 { table, op, k('*' 是整批), v };readGate、readError、readNull、onRead 只作用在讀單一鍵 */
function makeClient(w) {
  return {
    auth: {
      getSession: async () => {
        if (w.noSession) return { data: { session: null }, error: null };
        if (w.offline && w.tokenExpired) return { data: { session: null }, error: { message: 'TypeError: Failed to fetch' } };
        return { data: { session: { user: USER, access_token: token(w, USER) } } };
      },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => { w.local.removeItem(SB_KEY); return { error: null }; },
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
        const k = q.op === 'upsert' ? q.row.k : q.filters.k;
        w.ops.push({ table, op: q.op, k: k === undefined ? '*' : k, v: q.op === 'upsert' ? JSON.parse(JSON.stringify(q.row.v)) : undefined });
        if (w.offline) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
        if (table === 'teachers') return { data: [], error: null };
        if (table !== 'progress') return { data: null, error: null };
        if (q.op === 'select') {
          if (q.filters.k !== undefined) {
            if (w.readGate) await w.readGate;
            if (w.offline) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
            if (w.readError) return { data: null, error: { message: 'JWT expired', code: 'PGRST301' } };
            if (w.readNull) return { data: null, error: null };
            if (w.onRead) { const f = w.onRead; w.onRead = null; f(); }
          }
          return { data: w.db.filter(r => r.user_id === q.filters.user_id && (q.filters.k === undefined || r.k === q.filters.k)).map(r => JSON.parse(JSON.stringify(r))), error: null };
        }
        if (q.op === 'upsert') {
          const row = JSON.parse(JSON.stringify(q.row));
          const i = w.db.findIndex(r => r.user_id === row.user_id && r.k === row.k);
          if (i >= 0) w.db[i] = row; else w.db.push(row);
        }
        return { data: null, error: null };
      }
      return b;
    },
  };
}
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

/* 假的合併函式:{ v, items } 的 items 取聯集;任一邊不是物件、或 v 大於 2 回 ok:false(像雲端是 v3) */
function fakePet(w) {
  const usable = x => !!x && typeof x === 'object' && !Array.isArray(x) && !(typeof x.v === 'number' && x.v > 2);
  const canon = x => JSON.stringify(x);
  return {
    cloudMerge(a, b) {
      (w.merges = w.merges || []).push(1);
      if (!usable(a) || !usable(b)) return { ok: false };
      const items = [...new Set([].concat(a.items || [], b.items || []))].sort();
      const out = { v: a.v === 2 || b.v === 2 ? 2 : 1, items };
      return { ok: true, v: out, sameAsLocal: canon(out) === canon(a), sameAsCloud: canon(out) === canon(b) };
    },
  };
}
const P = (items, v) => ({ v: v || 1, items });

/* 開一頁。opt.src:cloud.js 的原始碼(預設新版);opt.pet:'fake'(假的 cloudMerge)、'real'(真的 pet.js、pet-food.js)、不給就沒有 PET。
   opt.stack:B 部分整套(common.js、pet-config.js、pet.js、pet-food.js、cloud.js、pet-store.js),opt.food 是 PET_FOOD */
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
    location: { hash: '', search: '', pathname: '/index.html', origin: 'https://x', href: 'https://x/index.html', reload() { w.reloads++; } },
    history: { replaceState() {} },
    document: {
      visibilityState: 'visible',
      addEventListener(ev, fn) { (listeners['doc:' + ev] = listeners['doc:' + ev] || []).push(fn); },
      createElement() { return {}; },
      head: { appendChild() {} },
      querySelector() { return null; }, querySelectorAll() { return []; },
    },
    confirm: msg => { w.confirms.push(msg); return w.confirmAnswer; },
    navigator: { get onLine() { return !w.offline; } },
    URLSearchParams,
    atob: s => Buffer.from(s, 'base64').toString('latin1'),
  };
  ctx.window = ctx;
  ctx.addEventListener = (ev, fn) => { (listeners['win:' + ev] = listeners['win:' + ev] || []).push(fn); };
  ctx.dispatchEvent = e => { w.events.push(e); return true; };
  ctx.CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'k' };
  ctx.supabase = { createClient: () => makeClient(w) };
  vm.createContext(ctx);
  const stack = opt.stack;
  if (stack) {
    if (!stack.store) throw new Error('js/pet-store.js 還不存在');
    vm.runInContext(COMMON + '\n;globalThis.__api = { store, logAttempt };', ctx);
    if (stack.config) vm.runInContext(stack.config, ctx);
    Object.assign(ctx, { PET_ON: true, PET_FOOD: !!opt.food, PET_ROAM_V2: false, PET_FOOD_FROM: opt.food ? FOOD_FROM : '' });
    vm.runInContext(stack.pet, ctx);
    if (stack.food) vm.runInContext(stack.food, ctx);
    vm.runInContext(stack.cloud, ctx);
    vm.runInContext(stack.store, ctx);
  } else {
    try { ctx.__PROFILE_ID = JSON.parse(w.local.getItem('tr_current_profile')) || null; } catch (e) { ctx.__PROFILE_ID = null; }
    if (opt.pet === 'fake') ctx.PET = fakePet(w);
    if (opt.pet === 'real') { vm.runInContext(NEW.pet, ctx); if (NEW.food) vm.runInContext(NEW.food, ctx); }
    vm.runInContext(opt.src || NEW.cloud, ctx);
  }
  const S = ctx.PET_STORE;
  return {
    ctx, S,
    ready: ctx.CLOUD.ready.then(tick).then(() => S && S.ready).then(tick),
    /* 只跑現在排著的計時器一輪(跑的時候新排的,例如讀雲端的 8 秒逾時,留到下一次) */
    async runTimers() { const fns = [...timers.values()]; timers.clear(); for (const f of fns) await f(); await tick(); },
    /* 跑到沒有計時器為止(最多 6 輪),給 B 部分 pet-store 的去抖動用 */
    async runAll() { for (let n = 0; n < 6 && timers.size; n++) { const fns = [...timers.values()]; timers.clear(); for (const f of fns) await f(); await tick(); } await tick(); },
    async fire(name) { (listeners[name] || []).forEach(f => f()); await tick(); },
  };
}

const lp = (w, k) => { const raw = w.local.getItem(PREFIX + (k || 'pet')); return raw === null ? null : JSON.parse(raw); };
const cp = (w, k) => { const r = w.db.find(r => r.user_id === USER.id && r.k === (k || 'pet')); return r ? r.v : undefined; };
const ledger = w => JSON.parse(w.local.getItem(LEDGER) || '{}');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const J = x => JSON.stringify(x);
const petOps = w => w.ops.filter(o => o.k === 'pet').map(o => (o.op === 'select' ? 'read' : 'up')).join(',') || '(沒有)';
function cloudRow(w, k, v, at) { w.db.push({ user_id: USER.id, k, v, updated_at: iso(at || w.clock.t - 24 * HOUR) }); }
function setCloud(w, k, v) {
  const r = w.db.find(r => r.user_id === USER.id && r.k === k);
  if (r) { r.v = v; r.updated_at = iso(w.clock.t); } else cloudRow(w, k, v, w.clock.t);
}
/* 學生在頁面上改資料:跟 common.js 的 store.set 一樣,先寫本機再 CLOUD.push;時鐘先走 1 秒,每次寫入的帳本時間才分得開 */
function write(pg, w, k, v) {
  w.clock.t += 1000;
  w.local.setItem(PREFIX + k, JSON.stringify(v));
  pg.ctx.CLOUD.push(k, v);
}
/* 這台登入過、這個帳號就是目前的資料夾(隔天重開的狀態) */
function signedIn(w) {
  w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
  w.local.setItem('tr_current_profile', JSON.stringify(PID));
}
const newSession = w => { w.session = makeStorage(); };
async function openLoggedIn(w, opt) {
  w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
  let pg = loadPage(w, opt); await pg.ready;      // 新工作階段:灌資料後 reload
  pg = loadPage(w, opt); await pg.ready;          // reload 後的頁面
  if (opt && opt.stack) { await pg.runAll(); await pg.S.idle(); }
  return pg;
}

/* ---------- A 部分:cloud.js 自己 ---------- */
const FAKE = { pet: 'fake' };
const A = {
  'A1. 寫入後的計時上傳(push):先讀雲端那一列、合併,再上傳合併結果;本機也存合併結果,帳本清空': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', P(['a', 'c']));
    const pg = await openLoggedIn(w, FAKE);
    w.ops = [];
    write(pg, w, 'pet', P(['a', 'b']));
    await pg.runTimers();
    const want = P(['a', 'b', 'c']);
    return { ok: petOps(w) === 'read,up' && same(cp(w), want) && same(lp(w), want) && !('pet' in ledger(w)),
             detail: '請求 ' + petOps(w) + ' / 雲端 ' + J(cp(w)) + ' / 本機 ' + J(lp(w)) + ' / 帳本 ' + J(ledger(w)) };
  },
  'A2. 帳本補傳的每一條路(關頁、切到背景、恢復連線、開下一頁)都先讀雲端再上傳合併結果,不直接蓋上去': async () => {
    const out = [];
    for (const how of ['pagehide', 'hidden', 'online', 'nextpage']) {
      const w = makeWorld();
      cloudRow(w, 'pet', P(['a']));
      const pg = await openLoggedIn(w, FAKE);
      w.offline = true;
      write(pg, w, 'pet', P(['a', 'b'])); await pg.runTimers();     // 離線:上傳失敗,帳本留著
      setCloud(w, 'pet', P(['a', 'c']));                              // 別台這時傳上去
      w.offline = false; w.ops = [];
      if (how === 'pagehide') await pg.fire('win:pagehide');
      if (how === 'hidden') { pg.ctx.document.visibilityState = 'hidden'; await pg.fire('doc:visibilitychange'); }
      if (how === 'online') await pg.fire('win:online');
      if (how === 'nextpage') { const pg2 = loadPage(w, FAKE); await pg2.ready; }
      const want = P(['a', 'b', 'c']);
      out.push({ ok: petOps(w) === 'read,up' && same(cp(w), want) && same(lp(w), want) && !('pet' in ledger(w)),
                 d: how + ':' + petOps(w) + ' 雲端 ' + J(cp(w).items) + ' 本機 ' + J(lp(w).items) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  'A3. 灌雲端資料:本機和雲端都有 pet(帳本上有、本機較新):本機存合併結果,補傳合併結果': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', P(['a', 'c']), w.clock.t - 2 * HOUR);
    signedIn(w);
    w.local.setItem(PREFIX + 'pet', J(P(['a', 'b'])));
    w.local.setItem(LEDGER, J({ pet: w.clock.t - HOUR }));
    const pg = loadPage(w, FAKE); await pg.ready;
    const want = P(['a', 'b', 'c']);
    return { ok: same(lp(w), want) && same(cp(w), want) && !('pet' in ledger(w)) && w.reloads === 1,
             detail: '本機 ' + J(lp(w)) + ' / 雲端 ' + J(cp(w)) + ' / 帳本 ' + J(ledger(w)) + ' / 重載 ' + w.reloads };
  },
  'A4. 灌雲端資料:雲端比較新、或本機沒記帳,也不再直接蓋掉本機:存合併結果,跟雲端不同就記帳補傳': async () => {
    const out = [];
    for (const led of [null, -3 * HOUR]) {
      const w = makeWorld();
      cloudRow(w, 'pet', P(['a', 'c']), w.clock.t - 2 * HOUR);
      signedIn(w);
      w.local.setItem(PREFIX + 'pet', J(P(['a', 'b'])));
      if (led !== null) w.local.setItem(LEDGER, J({ pet: w.clock.t + led }));
      const pg = loadPage(w, FAKE); await pg.ready;
      const want = P(['a', 'b', 'c']);
      out.push({ ok: same(lp(w), want) && same(cp(w), want) && !('pet' in ledger(w)),
                 d: (led === null ? '沒記帳' : '帳本比雲端舊') + ':本機 ' + J(lp(w).items) + ' 雲端 ' + J(cp(w).items) + ' 帳本 ' + J(ledger(w)) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  'A5. 灌雲端資料:合併結果跟雲端一樣:本機存合併結果,帳本劃掉,不上傳': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', P(['a', 'b']), w.clock.t - 2 * HOUR);
    signedIn(w);
    w.local.setItem(PREFIX + 'pet', J(P(['a'])));
    w.local.setItem(LEDGER, J({ pet: w.clock.t - HOUR }));
    const pg = loadPage(w, FAKE); await pg.ready;
    return { ok: same(lp(w), P(['a', 'b'])) && same(cp(w), P(['a', 'b'])) && !w.ops.some(o => o.k === 'pet' && o.op === 'upsert') && !('pet' in ledger(w)),
             detail: '本機 ' + J(lp(w)) + ' / 請求 ' + petOps(w) + ' / 帳本 ' + J(ledger(w)) };
  },
  'A6. 讀不到雲端(伺服器錯誤、回 data:null、逾時、讀到一半換帳號、supabase-js 沒有登入):不上傳,帳本留著,雲端與本機不變': async () => {
    const out = [];
    for (const how of ['error', 'null', 'timeout', 'switch', 'nosession']) {
      const w = makeWorld();
      cloudRow(w, 'pet', P(['a']));
      const pg = await openLoggedIn(w, FAKE);
      if (how === 'error') w.readError = true;
      if (how === 'null') w.readNull = true;
      if (how === 'timeout') w.readGate = new Promise(() => {});
      if (how === 'switch') w.onRead = () => { pg.ctx.CLOUD.user = OTHER; };
      if (how === 'nosession') w.noSession = true;
      write(pg, w, 'pet', P(['a', 'b']));
      await pg.runTimers();
      if (how === 'timeout') await pg.runTimers();   // 讀雲端的 8 秒逾時
      const ok = !w.ops.some(o => o.k === 'pet' && o.op === 'upsert') && same(cp(w), P(['a'])) && same(lp(w), P(['a', 'b'])) && 'pet' in ledger(w);
      out.push({ ok, d: how + ':' + petOps(w) + ' 帳本' + ('pet' in ledger(w) ? '留著' : '沒了') });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  'A7. 合併說唯讀(雲端是更新版 v3):不上傳、帳本留著、本機不改;登出時算進「還沒同步」;灌資料時照現在的規則選本機或雲端,留本機也不補傳': async () => {
    const V3 = { v: 3, items: ['z'] };
    const w = makeWorld();
    cloudRow(w, 'pet', P(['a']));
    const pg = await openLoggedIn(w, FAKE);
    setCloud(w, 'pet', V3);
    write(pg, w, 'pet', P(['a', 'b'])); await pg.runTimers();
    const a = !w.ops.some(o => o.k === 'pet' && o.op === 'upsert') && same(cp(w), V3) && same(lp(w), P(['a', 'b'])) && 'pet' in ledger(w);
    w.confirmAnswer = false;
    await pg.ctx.CLOUD.logout(); await tick();
    const b = w.confirms.length === 1 && same(lp(w), P(['a', 'b']));
    /* 灌資料:帳本比雲端新 → 留本機、不補傳;沒記帳 → 照現在用雲端那份 */
    const w2 = makeWorld();
    cloudRow(w2, 'pet', V3, w2.clock.t - 2 * HOUR); signedIn(w2);
    w2.local.setItem(PREFIX + 'pet', J(P(['a']))); w2.local.setItem(LEDGER, J({ pet: w2.clock.t - HOUR }));
    const p2 = loadPage(w2, FAKE); await p2.ready;
    const c = same(lp(w2), P(['a'])) && same(cp(w2), V3) && 'pet' in ledger(w2) && !w2.ops.some(o => o.k === 'pet' && o.op === 'upsert');
    const w3 = makeWorld();
    cloudRow(w3, 'pet', V3, w3.clock.t - 2 * HOUR); signedIn(w3);
    w3.local.setItem(PREFIX + 'pet', J(P(['a'])));
    const p3 = loadPage(w3, FAKE); await p3.ready;
    const d = same(lp(w3), V3) && same(cp(w3), V3) && !('pet' in ledger(w3));
    return { ok: a && b && c && d, detail: '上傳時 ' + a + ' / 登出先問 ' + b + '(問了 ' + w.confirms.length + ' 次) / 灌資料留本機 ' + c + ' / 灌資料用雲端 ' + d };
  },
  'A8. 本機那份是 null 或沒有:不上傳 null(不刪雲端那份),帳本劃掉;灌資料時本機沒有就用雲端那份': async () => {
    const out = [];
    for (const how of ['removed', 'null']) {
      const w = makeWorld();
      cloudRow(w, 'pet', P(['a']));
      const pg = await openLoggedIn(w, FAKE);
      w.clock.t += 1000;
      if (how === 'removed') w.local.removeItem(PREFIX + 'pet'); else w.local.setItem(PREFIX + 'pet', 'null');
      pg.ctx.CLOUD.push('pet', null);
      await pg.runTimers();
      out.push({ ok: !w.ops.some(o => o.k === 'pet' && o.op === 'upsert') && same(cp(w), P(['a'])) && !('pet' in ledger(w)), d: how + ':雲端 ' + J(cp(w)) + ' 帳本 ' + J(ledger(w)) });
    }
    const w = makeWorld();
    cloudRow(w, 'pet', P(['a']), w.clock.t - 2 * HOUR); signedIn(w);
    w.local.setItem(LEDGER, J({ pet: w.clock.t - HOUR }));          // 帳本上有、本機卻沒有
    const pg = loadPage(w, FAKE); await pg.ready;
    out.push({ ok: same(lp(w), P(['a'])) && same(cp(w), P(['a'])) && !('pet' in ledger(w)), d: '灌資料:本機 ' + J(lp(w)) + ' 雲端 ' + J(cp(w)) });
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  'A9. 頁面沒有載入 pet.js(拿不到合併函式):pet 不上傳、帳本留著;同一次補傳的其他鍵照常上傳;灌資料時留本機也不補傳': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', P(['a']));
    const pg = await openLoggedIn(w, {});
    write(pg, w, 'pet', P(['a', 'b']));
    write(pg, w, PLAIN, NEW_BANK);
    await pg.runTimers(); await pg.fire('win:pagehide');
    const a = petOps(w) === '(沒有)' && same(cp(w), P(['a'])) && same(cp(w, PLAIN), NEW_BANK) && 'pet' in ledger(w) && !(PLAIN in ledger(w));
    const w2 = makeWorld();
    cloudRow(w2, 'pet', P(['a', 'c']), w2.clock.t - 2 * HOUR); signedIn(w2);
    w2.local.setItem(PREFIX + 'pet', J(P(['a', 'b']))); w2.local.setItem(LEDGER, J({ pet: w2.clock.t - HOUR }));
    const p2 = loadPage(w2, {}); await p2.ready;
    const b = same(lp(w2), P(['a', 'b'])) && same(cp(w2), P(['a', 'c'])) && 'pet' in ledger(w2) && petOps(w2) === '(沒有)';
    return { ok: a && b, detail: '上傳時:請求 ' + petOps(w) + ' 題庫 ' + (same(cp(w, PLAIN), NEW_BANK) ? '上去了' : '沒上去') + ' 帳本 ' + J(Object.keys(ledger(w))) + ' / 灌資料:本機 ' + J(lp(w2)) + ' 雲端 ' + J(cp(w2)) };
  },
  'A10. 同一個鍵的上傳排隊:前一次還在讀雲端時第二次不會同時讀;讀雲端這段時間本機又改了,前一次不寫回、不上傳舊的,後一次傳最新的': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', P(['a']));
    const pg = await openLoggedIn(w, FAKE);
    let open; w.readGate = new Promise(r => { open = r; });
    w.ops = [];
    write(pg, w, 'pet', P(['a', 'b'])); await pg.runTimers();         // 第一次上傳卡在讀雲端
    write(pg, w, 'pet', P(['a', 'b', 'd']));                           // 這時又改了
    await pg.fire('win:pagehide');                                     // 補傳排在後面
    const readsBlocked = w.ops.filter(o => o.k === 'pet').length;
    w.readGate = null; open(); await tick(); await tick();
    const want = P(['a', 'b', 'd']);
    return { ok: readsBlocked === 1 && petOps(w) === 'read,read,up' && same(cp(w), want) && same(lp(w), want) && !('pet' in ledger(w)),
             detail: '卡住時讀了 ' + readsBlocked + ' 次 / 請求 ' + petOps(w) + ' / 雲端 ' + J(cp(w)) + ' / 本機 ' + J(lp(w)) };
  },
  'A11. 灌資料時讀 pet 那一列很慢或一直不回:CLOUD.ready 照樣完成(不等自己,不會卡死),逾時後帳本留著,下次再傳': async () => {
    const setup = () => {
      const w = makeWorld();
      cloudRow(w, 'pet', P(['a', 'c']), w.clock.t - 2 * HOUR); signedIn(w);
      w.local.setItem(PREFIX + 'pet', J(P(['a', 'b']))); w.local.setItem(LEDGER, J({ pet: w.clock.t - HOUR }));
      return w;
    };
    const w = setup();
    w.readGate = new Promise(() => {});
    const pg = loadPage(w, FAKE);
    let done = false; pg.ctx.CLOUD.ready.then(() => { done = true; });
    await tick(); await tick();
    const waiting = !done;
    await pg.runTimers(); await tick();
    const a = waiting && done && same(lp(w), P(['a', 'b', 'c'])) && same(cp(w), P(['a', 'c'])) && 'pet' in ledger(w) && w.reloads === 1;
    const w2 = setup();
    let open; w2.readGate = new Promise(r => { open = r; });
    const p2 = loadPage(w2, FAKE);
    let done2 = false; p2.ctx.CLOUD.ready.then(() => { done2 = true; });
    await tick(); open(); await tick(); await tick();
    const b = done2 && same(cp(w2), P(['a', 'b', 'c'])) && !('pet' in ledger(w2));
    return { ok: a && b, detail: '一直不回:逾時前等待 ' + waiting + '、逾時後完成 ' + done + '、本機 ' + J(lp(w).items) + '、帳本 ' + J(Object.keys(ledger(w))) + ' / 慢一點才回:完成 ' + done2 + '、雲端 ' + J(cp(w2).items) };
  },
  'A12. 第 1 步分頁留在帳本裡的 v1 pet,遇到雲端已經是 v2:新版補傳時合併,雲端還是 v2,新欄位不掉': async () => {
    const run = async src => {
      const w = makeWorld();
      cloudRow(w, 'pet', P(['a']));
      await openLoggedIn(w, { src, pet: 'fake' });
      w.clock.t += 1000;
      w.local.setItem(PREFIX + 'pet', J(P(['a', 'b'])));                 // 第 1 步那版 pet-store 寫的,還沒傳出去
      w.local.setItem(LEDGER, J({ pet: w.clock.t }));
      setCloud(w, 'pet', P(['a', 'g1'], 2));                              // 別台新版已經寫成 v2
      const pg = loadPage(w, { src, pet: 'fake' }); await pg.ready;       // 同一個工作階段開下一頁:帳本補傳
      return w;
    };
    const w = await run(NEW.cloud);
    const old = await run(OLD.cloud);
    const want = P(['a', 'b', 'g1'], 2);
    return { ok: same(cp(w), want) && same(lp(w), want) && !('pet' in ledger(w)),
             detail: '新版 雲端 ' + J(cp(w)) + ' 本機 ' + J(lp(w)) + ' / (對照:第 1 步那版會蓋成 ' + J(cp(old)) + ',規格 5.3 第 3 步要等一週的原因)' };
  },
  'A13. 兩台都離線各自改了 pet,再先後連上:兩邊的東西都在(雲端、兩台本機)': async () => {
    const db = [];
    const wa = makeWorld(db), wb = makeWorld(db);
    cloudRow(wa, 'pet', P(['a']));
    const pa = await openLoggedIn(wa, FAKE), pb = await openLoggedIn(wb, FAKE);
    wa.offline = wb.offline = true;
    write(pa, wa, 'pet', P(['a', 'x'])); await pa.runTimers();
    write(pb, wb, 'pet', P(['a', 'y'])); await pb.runTimers();
    wa.offline = false; await pa.fire('win:online');
    wb.offline = false; await pb.fire('win:online');
    newSession(wa); const pa2 = loadPage(wa, FAKE); await pa2.ready;    // A 隔天重開
    const want = P(['a', 'x', 'y']);
    return { ok: same(cp(wa), want) && same(lp(wa), want) && same(lp(wb), want) && !('pet' in ledger(wa)) && !('pet' in ledger(wb)),
             detail: '雲端 ' + J(cp(wa).items) + ' / A 本機 ' + J(lp(wa).items) + ' / B 本機 ' + J(lp(wb).items) };
  },
  'A14. 其他鍵逐位元組不變:tools/test_sync.js 每個情境,第 1 步的 cloud.js 和新版的本機、分頁暫存、雲端、每一次請求都一樣(頁面沒有 PET)': () => replay('none'),
  'A15. 其他鍵逐位元組不變:同上,頁面有 PET(合併函式在)時,pet 以外的東西都一樣': () => replay('fake'),
  'A16. 混合情境(pet 跟 hist、daily_done、錯題本一起寫:上傳、離線補傳、灌資料、登出):其他鍵的請求順序、內容、本機、帳本跟第 1 步完全相同': async () => {
    const a = await mixed(OLD.cloud), b = await mixed(NEW.cloud);
    const diff = a.findIndex((x, i) => x !== b[i]);
    return { ok: a.length === b.length && diff < 0, detail: '比對 ' + a.length + ' 個檢查點' + (diff < 0 ? ',全部相同' : ',第 ' + (diff + 1) + ' 個不同:' + a[diff].slice(0, 160) + ' ≠ ' + (b[diff] || '').slice(0, 160)) };
  },
};

/* 混合情境:回傳每個檢查點 pet 以外的狀態(請求、本機、帳本、雲端) */
async function mixed(src) {
  const w = makeWorld();
  const shots = [];
  const shot = () => shots.push(otherState(w, true));
  cloudRow(w, 'hist', [1], w.clock.t - 2 * HOUR); cloudRow(w, 'pet', P(['a']), w.clock.t - 2 * HOUR); cloudRow(w, PLAIN, OLD_BANK, w.clock.t - 2 * HOUR);
  signedIn(w);
  w.local.setItem(PREFIX + 'hist', J([1, 2])); w.local.setItem(PREFIX + 'pet', J(P(['a', 'b']))); w.local.setItem(PREFIX + 'daily_done', J({ x: 1 }));
  w.local.setItem(LEDGER, J({ hist: w.clock.t - HOUR, pet: w.clock.t - HOUR }));
  let pg = loadPage(w, { src, pet: 'fake' }); await pg.ready; shot();
  pg = loadPage(w, { src, pet: 'fake' }); await pg.ready; shot();
  write(pg, w, 'hist', [1, 2, 3]); write(pg, w, 'pet', P(['a', 'b', 'c'])); write(pg, w, PLAIN, NEW_BANK);
  await pg.runTimers(); shot();
  w.offline = true;
  write(pg, w, 'daily_done', { x: 2 }); write(pg, w, 'pet', P(['a', 'b', 'c', 'd'])); write(pg, w, 'hist', [1, 2, 3, 4]);
  await pg.runTimers(); shot();
  w.offline = false; await pg.fire('win:online'); shot();
  write(pg, w, PLAIN, OLD_BANK); write(pg, w, 'pet', P(['e']));
  await pg.fire('win:pagehide'); shot();
  newSession(w);
  pg = loadPage(w, { src, pet: 'fake' }); await pg.ready; shot();
  pg = loadPage(w, { src, pet: 'fake' }); await pg.ready;
  write(pg, w, 'hist', [9]); write(pg, w, 'pet', P(['f']));
  await pg.ctx.CLOUD.logout(); await tick(); shot();
  return shots;
}
/* pet 以外的狀態(dropPet 時去掉 pet 的本機、帳本那一項、雲端那一列與請求) */
function otherState(w, dropPet) {
  const isPet = k => k === PREFIX + 'pet' || k === 'tr_pet' || /^tr_u[0-9a-z]+_pet$/.test(k);
  const local = [];
  for (let i = 0; i < w.local.length; i++) {
    const k = w.local.key(i);
    if (dropPet && isPet(k)) continue;
    let v = w.local.getItem(k);
    if (k.indexOf('tr_unsynced_') === 0) { const l = JSON.parse(v); if (dropPet) delete l.pet; v = J(Object.keys(l).sort().map(x => [x, typeof l[x] === 'number' ? 'n' : l[x]])); }
    local.push([k, v]);
  }
  local.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const sess = [];
  for (let i = 0; i < w.session.length; i++) { const k = w.session.key(i); sess.push([k, w.session.getItem(k)]); }
  sess.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const db = w.db.filter(r => !(dropPet && r.k === 'pet')).map(r => J(r)).sort();
  const ops = (w.ops || w.__ops || []).filter(o => !(dropPet && (typeof o === 'string' ? /"k":"pet"/.test(o) : o.k === 'pet'))).map(o => (typeof o === 'string' ? o : J(o)));
  const s = J({ local, sess, db, ops, reloads: w.reloads, confirms: w.confirms, signOuts: w.signOuts || [] });
  return norm(s);
}
/* 時間會跟著跑測試的時刻變:ISO 時間與 13 位數的毫秒時間換成記號再比 */
function norm(s) { return s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<iso>').replace(/\b1\d{12}\b/g, '<ms>'); }

/* tools/test_sync.js 的情境原樣拿來跑(只在它的假環境上加記錄,不改任何情境):記下每個 world 的每一次請求,頁面可以先放 PET */
function syncScenarios() {
  let txt = read('tools/test_sync.js').replace(/\r\n/g, '\n');   // 工作目錄裡是 CRLF(core.autocrlf)
  const cut = txt.lastIndexOf('\n(async () => {');
  if (cut < 0) throw new Error('tools/test_sync.js 的結尾變了');
  txt = txt.slice(0, cut);
  const patch = (from, to) => { if (txt.indexOf(from) < 0) throw new Error('tools/test_sync.js 找不到:' + from.trim()); txt = txt.replace(from, to); };
  patch('function makeWorld() {', 'function makeWorld() { const __w = __makeWorld0(); __HOOK.worlds.push(__w); return __w; }\nfunction __makeWorld0() {');
  patch('      async function run() {\n', '      async function run() {\n        __HOOK.op(w, table, q);\n');
  patch('  vm.runInContext(src, ctx);\n', '  __HOOK.inject(ctx);\n  vm.runInContext(src, ctx);\n');
  return new Function('require', '__dirname', '__HOOK', txt + '\nreturn scenarios;');
}
async function replay(variant) {
  const make = syncScenarios();
  const got = {};
  for (const [label, src] of [['old', OLD.cloud], ['new', NEW.cloud]]) {
    const HOOK = {
      worlds: [],
      op(w, table, q) { (w.__ops = w.__ops || []).push(J({ table, op: q.op, f: q.filters, k: q.row ? q.row.k : q.filters.k, row: q.row })); },
      inject(ctx) { if (variant === 'fake') ctx.PET = fakePet({}); },
    };
    const scen = make(require, __dirname, HOOK);
    for (const [name, fn] of Object.entries(scen)) {
      HOOK.worlds = [];
      let r;
      try { r = await fn(src); } catch (e) { r = { ok: false, detail: '例外 ' + e.message }; }
      const state = HOOK.worlds.map(w => otherState(w, variant === 'fake')).join('||');
      (got[name] = got[name] || {})[label] = J({ ok: r.ok, detail: norm(String(r.detail)) }) + '##' + state;
    }
  }
  const names = Object.keys(got);
  const bad = names.filter(n => got[n].old !== got[n].new);
  const newFail = names.filter(n => !JSON.parse(got[n].new.split('##')[0]).ok);
  return { ok: names.length >= 50 && !bad.length && !newFail.length,
           detail: names.length + ' 個情境' + (bad.length ? ',不同:' + bad.map(n => n.split('.')[0]).join('、') : ',全部相同') + (newFail.length ? ';新版沒通過:' + newFail.map(n => n.split('.')[0]).join('、') : '') };
}

/* ---------- B 部分:真的 pet.js、pet-food.js、pet-store.js ---------- */
function v1(over) {
  return Object.assign({ v: 1, born: FROM, goals: [], days: { '2026-10-10': 25 }, met: ['2026-10-10'], oldMet: 0, oldBefore: '', fed: {}, name: '小黃', nameAt: 5 }, over || {});
}
function v2Pet() {
  return { v: 2, born: FROM, goals: [], days: { [YDAY]: 25 }, met: [YDAY], oldMet: 0, oldBefore: '', fed: {}, name: '小黃', nameAt: 5,
    got: { [YDAY]: { d: 'corn' } }, ate: { [YDAY]: { mh2lq01xk7: YDAY + '/d' } }, foodOld: { before: '2026-07-05', got: { corn: 2 }, ate: {} }, once: { diag: YDAY }, roam: { on: false, at: 1793000000000 } };
}
const ticket = (p, id, d) => !!(p && p.got && p.got[d || TODAY] && p.got[d || TODAY][id]);
const ateCount = (p, d) => (p && p.ate && p.ate[d || TODAY] ? Object.keys(p.ate[d || TODAY]).length : 0);
const FOODON = { stack: NEW, food: true };
const B = {
  'B1. (附錄 C store 4)讀不到雲端時 earn 寫在本機並記帳,之後開新的工作階段灌資料,那張券還在(本機和雲端)': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', v1());
    const pg = await openLoggedIn(w, FOODON);
    w.offline = true;
    const r = await pg.S.earn({ id: 'd' });
    await pg.runAll(); await pg.S.idle();
    const off = ticket(lp(w), 'd') && 'pet' in ledger(w);
    w.offline = false; newSession(w);
    await openLoggedIn(w, FOODON);
    return { ok: !!r && r.result === 'got' && off && ticket(lp(w), 'd') && ticket(cp(w), 'd'),
             detail: 'earn ' + J(r) + ' / 離線時本機有券且記帳 ' + off + ' / 灌資料後本機 ' + ticket(lp(w), 'd') + ' 雲端 ' + ticket(cp(w), 'd') };
  },
  'B2. (附錄 C store 5)A 離線拿到食物、B 拿到並吃掉、A 的帳本傳上去、B 開新的工作階段灌資料:兩台的券和吃掉的紀錄都在': async () => {
    const db = [];
    const wa = makeWorld(db), wb = makeWorld(db);
    cloudRow(wa, 'pet', v1());
    const A1 = await openLoggedIn(wa, FOODON), B1 = await openLoggedIn(wb, FOODON);
    wa.offline = true;
    const ra = await A1.S.earn({ id: 'g:ga-01', n: 10 }); await A1.runAll(); await A1.S.idle();
    const rb = await B1.S.earn({ id: 'd' }); await B1.runAll(); await B1.S.idle();
    const e = B1.S.eat(rb.food); const saved = await e.saved; await B1.runAll(); await B1.S.idle();
    wa.offline = false; await A1.fire('win:online'); await A1.runAll(); await A1.S.idle();
    newSession(wb); await openLoggedIn(wb, FOODON);
    const c = cp(wa), l = lp(wb);
    const ok = ra.result === 'got' && rb.result === 'got' && e.ok && saved.ok &&
      ticket(c, 'g:ga-01') && ticket(c, 'd') && ateCount(c) === 1 && ticket(l, 'g:ga-01') && ticket(l, 'd') && ateCount(l) === 1;
    return { ok, detail: 'A ' + J(ra) + ' / B ' + J(rb) + ' 吃 ' + J({ ok: e.ok, saved }) + ' / 雲端券 ' + J(c && c.got) + ' 吃 ' + ateCount(c) + ' / B 本機券 ' + J(l && l.got) };
  },
  'B3. (附錄 C store 9)第 1 步那版的帳本補傳把 v1 蓋到雲端的 v2 上之後,新版的裝置下次灌資料時合併回 v2,券和吃掉的紀錄都還在': async () => {
    const db = [];
    const wa = makeWorld(db), wc = makeWorld(db);
    cloudRow(wa, 'pet', v1());
    const pc = await openLoggedIn(wc, { src: OLD.cloud });              // 第 1 步那版的分頁
    const pa = await openLoggedIn(wa, FOODON);
    const r = await pa.S.earn({ id: 'd' }); await pa.runAll(); await pa.S.idle();
    const e = pa.S.eat(r.food); await e.saved; await pa.runAll(); await pa.S.idle();
    const was2 = !!cp(wa) && cp(wa).v === 2;
    write(pc, wc, 'pet', v1({ days: { '2026-10-10': 25, '2026-10-12': 30 } })); await pc.runTimers();   // 第 1 步那版直接蓋上去
    const clobbered = cp(wa).v === 1;
    newSession(wa); await openLoggedIn(wa, FOODON);
    const c = cp(wa), l = lp(wa);
    const ok = was2 && clobbered && c.v === 2 && ticket(c, 'd') && ateCount(c) === 1 && c.days['2026-10-12'] === 30 && same(l.got, c.got) && ateCount(l) === 1;
    return { ok, detail: '先是 v2 ' + was2 + ' / 被蓋成 v1 ' + clobbered + ' / 合併後雲端 v' + (c && c.v) + ' 券 ' + J(c && c.got) + ' 吃 ' + ateCount(c) + ' 10/12 題數 ' + (c && c.days['2026-10-12']) };
  },
  'B4. 第 1 步分頁留在帳本裡的 v1 pet 遇到雲端 v2(真的 pet.js):補傳時合併,雲端還是 v2,券、吃掉的、走動開關、本機那天的題數都在': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', v1());
    await openLoggedIn(w, { pet: 'real' });
    w.clock.t += 1000;
    w.local.setItem(PREFIX + 'pet', J(v1({ days: { '2026-10-10': 25, '2026-10-13': 40 } })));
    w.local.setItem(LEDGER, J({ pet: w.clock.t }));
    setCloud(w, 'pet', v2Pet());
    const pg = loadPage(w, { pet: 'real' }); await pg.ready;
    const c = cp(w);
    const ok = !!c && c.v === 2 && ticket(c, 'd', YDAY) && ateCount(c, YDAY) === 1 && c.roam && c.roam.on === false && c.days['2026-10-13'] === 40 && same(lp(w), c) && !('pet' in ledger(w));
    return { ok, detail: '雲端 ' + J(c).slice(0, 220) };
  },
  'B5. 兩台都離線各自改(A 取名、B 改目標、各自哪天的題數),再先後連上:雲端和兩台本機兩邊的都在': async () => {
    const db = [];
    const wa = makeWorld(db), wb = makeWorld(db);
    cloudRow(wa, 'pet', v1());
    const pa = await openLoggedIn(wa, { pet: 'real' }), pb = await openLoggedIn(wb, { pet: 'real' });
    wa.offline = wb.offline = true;
    write(pa, wa, 'pet', v1({ name: '阿啾', nameAt: wa.clock.t + 1000, days: { '2026-10-10': 25, '2026-10-14': 12 } })); await pa.runTimers();
    write(pb, wb, 'pet', v1({ goals: [{ from: TODAY, n: 40, at: wb.clock.t }], days: { '2026-10-10': 25, '2026-10-15': 9 } })); await pb.runTimers();
    wa.offline = false; await pa.fire('win:online');
    wb.offline = false; await pb.fire('win:online');
    newSession(wa); await openLoggedIn(wa, { pet: 'real' });
    const has = p => !!p && p.name === '阿啾' && p.days['2026-10-14'] === 12 && p.days['2026-10-15'] === 9 && p.goals.some(g => g.n === 40);
    return { ok: has(cp(wa)) && has(lp(wa)) && has(lp(wb)), detail: '雲端 ' + has(cp(wa)) + ' / A ' + has(lp(wa)) + ' / B ' + has(lp(wb)) + ' / ' + J(cp(wa)).slice(0, 200) };
  },
  'B6. 雲端 v1、本機 v1(開關關著):合併後上傳的內容跟第 1 步那版(cloud.js、pet.js、pet-store.js)上傳的逐位元組相同': async () => {
    const run = async stack => {
      const w = makeWorld();
      cloudRow(w, 'pet', v1({ days: { '2026-10-10': 25, '2026-10-12': 8 } }));
      w.local.setItem(SB_KEY, J({ access_token: 'a', expires_at: 1, user: USER }));
      const pg = await openLoggedIn(w, { stack, food: false });
      await pg.S.rename('阿啾'); await pg.runAll();
      await pg.S.setGoal(40); await pg.runAll();
      setCloud(w, 'pet', v1({ days: { '2026-10-10': 25, '2026-10-12': 8, '2026-10-15': 3 }, name: '小黃', nameAt: 5 }));   // 別台改了
      w.clock.t += 120e3; await pg.S.sync(); await pg.runAll(); await pg.S.idle();
      return J({ ups: w.ops.filter(o => o.k === 'pet' && o.op === 'upsert').map(o => o.v), cloud: cp(w), local: lp(w) });
    };
    const a = await run(OLD), b = await run(NEW);
    return { ok: a === b && JSON.parse(a).ups.length > 0, detail: (a === b ? '相同,' : '不同,') + '上傳 ' + JSON.parse(a).ups.length + ' / ' + JSON.parse(b).ups.length + ' 次' + (a === b ? '' : ' / 第 1 步 ' + a.slice(0, 160) + ' / 新版 ' + b.slice(0, 160)) };
  },
  /* B7 到 B9(Integrate 加):時鐘差太多的裝置。pet.js 整理時用 now 丟掉晚超過 7 天的日期、把太舊的壓縮掉,
     所以 cloud.js 合併前要跟 pet-store 一樣用登入憑證的 iat 對時,差太多就不合併、不上傳,帳本留著 */
  'B7. 這台時鐘慢 10 天、開新的工作階段灌資料:雲端那份最近幾天的題數不能被合併丟掉,也不上傳 pet;帳本上的本機那份留著': async () => {
    const out = [];
    for (const withLedger of [false, true]) {
      const w = makeWorld();
      const recent = v1({ days: { '2026-10-10': 25, '2026-10-15': 9, '2026-10-16': 12 }, met: ['2026-10-10', '2026-10-16'] });
      cloudRow(w, 'pet', recent, w.clock.t - HOUR);
      const mine = v1({ name: '阿啾', nameAt: 9 });
      signedIn(w);
      w.local.setItem(PREFIX + 'pet', J(mine));
      if (withLedger) w.local.setItem(LEDGER, J({ pet: w.clock.t }));
      w.clock.t -= 10 * 864e5; w.serverAhead = 10 * 864e5;
      await openLoggedIn(w, { pet: 'real' });
      const ups = w.ops.filter(o => o.k === 'pet' && o.op === 'upsert').length;
      const localOk = withLedger ? same(lp(w), mine) && 'pet' in ledger(w) : same(lp(w), recent);
      out.push({ ok: same(cp(w), recent) && ups === 0 && localOk,
        d: (withLedger ? '帳本有 pet' : '帳本沒有') + ':雲端不變 ' + same(cp(w), recent) + ' 上傳 ' + ups + ' 次 本機 ' + J(lp(w)).slice(0, 90) + ' 帳本 ' + J(ledger(w)) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  'B8. 這台時鐘慢 10 天、改了 pet 要上傳:不合併、不上傳,帳本留著;時鐘調好以後恢復連線,合併上傳,兩邊的都在': async () => {
    const w = makeWorld();
    const recent = v1({ days: { '2026-10-10': 25, '2026-10-15': 9, '2026-10-16': 12 }, met: ['2026-10-10', '2026-10-16'] });
    cloudRow(w, 'pet', recent, w.clock.t - HOUR);
    w.clock.t -= 10 * 864e5; w.serverAhead = 10 * 864e5;
    const pg = await openLoggedIn(w, { pet: 'real' });
    write(pg, w, 'pet', Object.assign({}, recent, { name: '阿啾', nameAt: w.clock.t }));
    await pg.runTimers(); await pg.runTimers();
    const ups0 = w.ops.filter(o => o.k === 'pet' && o.op === 'upsert').length;
    const held = same(cp(w), recent) && ups0 === 0 && 'pet' in ledger(w) && lp(w).name === '阿啾';
    w.clock.t += 10 * 864e5; w.serverAhead = 0;
    await pg.fire('win:online'); await pg.runTimers();
    const c = cp(w);
    const merged = !!c && c.name === '阿啾' && c.days['2026-10-15'] === 9 && c.days['2026-10-16'] === 12 && !('pet' in ledger(w));
    return { ok: held && merged, detail: '時鐘慢:雲端不變且沒上傳 ' + held + '(上傳 ' + ups0 + ' 次)/ 調好後:' + J(c).slice(0, 160) + ' 帳本 ' + J(ledger(w)) };
  },
  /* B10(第二輪審查 X1):第 2 步剛上線那一週,同一台還開著第 1 步的分頁。第 1 步的 cloud.js 會把帳本上的 pet 直接傳上去、不先合併,
     所以開關都關著時,讀不到雲端的那一下 pet-store 只能只寫本機(跟第 1 步一樣不記帳);記帳交給 cloud.js 要等第 3 步 */
  'B10. 開關都關:同一台開著第 1 步和第 2 步兩個分頁,手機先把餵食傳上雲端,這台讀不到雲端時改名或改目標,恢復連線後雲端還留著手機的餵食和那天': async () => {
    const out = [];
    const v1x = o => v1(o);
    for (const [act, label] of [[S => S.rename('阿啾'), '改名'], [S => S.setGoal(40), '改目標']]) {
      for (const order of ['old', 'new']) {
        const w = makeWorld();
        cloudRow(w, 'pet', v1x());
        const pa = await openLoggedIn(w, { stack: OLD, food: false });                 // 第 1 步的分頁
        const pb = loadPage(w, { stack: NEW, food: false }); await pb.ready; await pb.runAll(); await pb.S.idle();   // 第 2 步的分頁
        setCloud(w, 'pet', v1x({ days: { '2026-10-10': 25, '2026-10-16': 30 }, fed: { '2026-10-16': 30 } }));          // 手機餵了、題數上去了
        w.offline = true; w.clock.t += 120e3;
        await act(pb.S); await pb.runAll(); await pb.S.idle();
        const led = J(Object.keys(ledger(w)));
        w.offline = false;
        const first = order === 'old' ? pa : pb, second = order === 'old' ? pb : pa;
        await first.fire('win:online'); await first.runAll(); if (first.S) await first.S.idle();
        await second.fire('win:online'); await second.runAll(); if (second.S) await second.S.idle();
        await pb.S.sync(); await pb.runAll(); await pb.S.idle();
        const c = cp(w), l = lp(w);
        const keep = p => !!p && p.fed['2026-10-16'] === 30 && p.days['2026-10-16'] === 30;
        out.push({ ok: keep(c) && keep(l) && led === '[]', d: label + '(' + (order === 'old' ? '舊分頁先' : '新分頁先') + '):帳本 ' + led + ' 雲端 fed ' + J(c && c.fed) + ' 本機 fed ' + J(l && l.fed) });
      }
    }
    /* 對照:兩個分頁都是第 2 步時,照樣留著 */
    const w = makeWorld();
    cloudRow(w, 'pet', v1());
    const pa = await openLoggedIn(w, { stack: NEW, food: false });
    const pb = loadPage(w, { stack: NEW, food: false }); await pb.ready; await pb.runAll(); await pb.S.idle();
    setCloud(w, 'pet', v1({ days: { '2026-10-10': 25, '2026-10-16': 30 }, fed: { '2026-10-16': 30 } }));
    w.offline = true; w.clock.t += 120e3;
    await pb.S.rename('阿啾'); await pb.runAll(); await pb.S.idle();
    w.offline = false;
    await pa.fire('win:online'); await pa.runAll(); await pa.S.idle();
    await pb.fire('win:online'); await pb.runAll(); await pb.S.idle();
    const c = cp(w);
    out.push({ ok: !!c && c.fed['2026-10-16'] === 30 && c.name === '阿啾', d: '對照(兩個都是第 2 步):雲端 fed ' + J(c && c.fed) + ' 名字 ' + (c && c.name) });
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  'B11. 食物打開(第 3 步):讀不到雲端時拿到的券照樣記帳,恢復連線由 cloud.js 先合併再上傳;雲端那邊別台的餵食也留著': async () => {
    const w = makeWorld();
    cloudRow(w, 'pet', v1());
    const pg = await openLoggedIn(w, FOODON);
    setCloud(w, 'pet', v1({ days: { '2026-10-10': 25, '2026-10-16': 30 }, fed: { '2026-10-16': 30 } }));
    w.offline = true;
    const r = await pg.S.earn({ id: 'd' }); await pg.runAll(); await pg.S.idle();
    const led = 'pet' in ledger(w);
    w.offline = false; await pg.fire('win:online'); await pg.runAll(); await pg.S.idle();
    const c = cp(w);
    return { ok: r.result === 'got' && led && ticket(c, 'd') && c.fed['2026-10-16'] === 30, detail: 'earn ' + J(r) + ' / 離線記帳 ' + led + ' / 雲端券 ' + ticket(c, 'd') + ' fed ' + J(c && c.fed) };
  },
  /* B12(chick2 第一輪修正 #2):開關都關時,讀不到雲端的那一下 pet-store 只寫本機、不記帳(B10 的理由)。
     登出以前只看帳本,這些改動(取名、改目標、餵飼料)會不問就跟著帳號資料夾刪掉。現在登出時先把它們合併上傳,傳不上去就算進「還沒同步」 */
  'B12. 開關都關:讀不到雲端時改的名字、目標、餵食,登出時先合併上傳;傳不上去就先問,取消時本機留著;沒有這種改動時登出不多讀雲端': async () => {
    const out = [];
    const base = () => v1({ days: { '2026-10-10': 25, [TODAY]: 25 }, met: ['2026-10-10', TODAY] });
    const localOnly = k => { const o = []; for (let i = 0; i < k.local.length; i++) { const x = k.local.key(i); if (/^tr_localonly_/.test(x)) o.push(x); } return o; };
    for (const how of ['offline', '401', 'readOk', 'none']) {
      const w = makeWorld();
      cloudRow(w, 'pet', base());
      w.local.setItem(SB_KEY, J({ access_token: 'a', expires_at: 1, user: USER }));
      const pg = await openLoggedIn(w, { stack: NEW, food: false });
      if (how === 'offline') w.offline = true;
      if (how === '401' || how === 'readOk') w.readError = true;
      if (how !== 'none') {
        w.clock.t += 60e3; await pg.S.feed(); await pg.runAll(); await pg.S.idle();
        w.clock.t += 1000; await pg.S.rename('阿啾'); await pg.runAll(); await pg.S.idle();
        w.clock.t += 1000; await pg.S.setGoal(40); await pg.runAll(); await pg.S.idle();
      }
      const before = lp(w);
      const led = J(Object.keys(ledger(w)));
      if (how === 'readOk') w.readError = false;     // 讀得到了,學生接著登出
      w.confirmAnswer = false;
      const ops0 = w.ops.length, reloads0 = w.reloads;
      await pg.ctx.CLOUD.logout(); await tick();
      const asked = w.confirms.length, petOpsAtLogout = w.ops.slice(ops0).filter(o => o.k === 'pet').map(o => o.op).join(',');
      const c = cp(w), l = lp(w);
      let ok, d;
      if (how === 'offline' || how === '401') {
        /* 傳不上去:要先問;取消就不登出,本機那份原封不動 */
        ok = led === '[]' && before.name === '阿啾' && asked === 1 && same(l, before) && c.name === '小黃' && w.reloads === reloads0;
        d = how + ':帳本 ' + led + ' 問了 ' + asked + ' 次 本機名字 ' + (l && l.name) + ' 雲端名字 ' + (c && c.name);
      } else if (how === 'readOk') {
        /* 讀得到:合併後上傳,不用問;雲端有名字、目標、餵食,還是 v1(開關關著不寫 v2);本機資料夾與標記照常清掉 */
        ok = asked === 0 && !!c && c.v === 1 && c.name === '阿啾' && c.goals.some(g => g.n === 40) && c.fed[TODAY] === 25 && c.days[TODAY] === 25 && l === null && !localOnly(w).length;
        d = how + ':問了 ' + asked + ' 次 pet 請求 ' + petOpsAtLogout + ' 雲端 ' + J(c).slice(0, 160) + ' 本機 ' + J(l) + ' 標記 ' + J(localOnly(w));
      } else {
        /* 沒有只寫在本機的改動:登出跟以前一樣,不讀雲端的 pet、不問 */
        ok = asked === 0 && petOpsAtLogout === '' && l === null;
        d = how + ':問了 ' + asked + ' 次 pet 請求 ' + (petOpsAtLogout || '(沒有)');
      }
      out.push({ ok, d });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  /* chick2 第二輪修正 #2:第 2 步開新的工作階段時,本機那份(帳本上沒有)會跟雲端那一列合併再上傳。很久沒同步、還留著 400 天前練習日的
     那份,整理時自己移到今天的截止日,oldBefore 比雲端晚;以前成對取 oldBefore 較晚的那組,雲端累積的 30 天達標整個被丟掉再上傳 */
  'B9b. 開新的工作階段:本機那份很久沒同步(還留著 400 天前的練習日)、雲端累積 30 天達標:合併上傳後累積達標不倒退': async () => {
    const w = makeWorld();
    w.clock.t = Date.parse('2029-04-14T12:00:00+08:00');
    const cloud = v1({ born: '2026-10-11', days: {}, met: [], oldMet: 30, oldBefore: '2028-03-06' });
    cloudRow(w, 'pet', cloud, w.clock.t - HOUR);
    signedIn(w);
    w.local.setItem(PREFIX + 'pet', J(v1({ born: '2026-10-11', days: { '2028-02-16': 1 }, met: [] })));
    await openLoggedIn(w, { pet: 'real' });
    const c = cp(w), l = lp(w);
    const total = x => (x ? x.oldMet + x.met.length : -1);
    return { ok: total(c) === 30 && total(l) === 30, detail: '雲端 ' + J(c && [c.oldMet, c.oldBefore, c.met.length]) + ' 本機 ' + J(l && [l.oldMet, l.oldBefore]) };
  },
  /* chick2 第二輪修正 #3:pet.js 的 fed 只留這台的今天往前 6 天。時鐘快 6 天多的裝置,真正的今天就掉出這個範圍,
     合併會把別台今天餵的飼料清掉再上傳。所以快超過 6 天就不合併、不上傳(以前放到 8 天);快 6 天以內照常合併,今天的餵食還在 */
  /* chick2 第三輪修正 #1:允許的範圍兩邊各 3 天(以前 6 天:一快一慢的兩台相差 12 天,慢的那台合併時丟掉快的那台的天) */
  'B9a. 這台時鐘快 3.5、5.9、6.5、7.5 天或慢 3.5、5.9 天、開新的工作階段灌資料:雲端今天餵的飼料不會被清掉,也不上傳 pet;快或慢 2.9 天照常合併,餵食還在': async () => {
    const out = [];
    for (const fast of [6.5, 7.5, 5.9, 3.5, -3.5, -5.9, 2.9, -2.9]) {
      const w = makeWorld();
      const cloud = v1({ days: { '2026-10-10': 25, '2026-10-16': 25 }, met: ['2026-10-10', '2026-10-16'], fed: { '2026-10-16': 25 } });
      cloudRow(w, 'pet', cloud, w.clock.t - HOUR);
      signedIn(w);
      w.local.setItem(PREFIX + 'pet', J(v1({ name: '阿啾', nameAt: 9 })));
      w.clock.t += fast * 864e5; w.serverAhead = -fast * 864e5;
      await openLoggedIn(w, { pet: 'real' });
      const ups = w.ops.filter(o => o.k === 'pet' && o.op === 'upsert').length;
      const c = cp(w);
      const ok = Math.abs(fast) > 3 ? same(c, cloud) && ups === 0 : !!c && c.fed['2026-10-16'] === 25 && c.name === '阿啾' && ups === 1;
      out.push({ ok, d: '快 ' + fast + ' 天:上傳 ' + ups + ' 次 雲端 fed ' + J(c && c.fed) + ' 名字 ' + (c && c.name) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  /* chick2 第三輪修正 #1 的配套:允許範圍改成 3 天以後,差 3 到 6 天的裝置也不合併了。灌資料時對不了時,帳本上沒有、
     只標記「只在本機」的 pet(第 2 步讀不到雲端時改的名字、目標、餵食)以前會被雲端那份蓋掉。現在留在本機、不上傳、標記留著,
     時鐘調好以後同步時合併上傳 */
  'B9b. 這台時鐘快或慢 4 天、開新的工作階段灌資料:只在本機(有標記)改的名字不會被雲端蓋掉,也不上傳;時鐘調好後合併上傳,兩邊的都在': async () => {
    const out = [];
    for (const skew of [4, -4, 10]) {
      const w = makeWorld();
      const recent = v1({ days: { '2026-10-10': 25, '2026-10-15': 9 }, met: ['2026-10-10'] });
      cloudRow(w, 'pet', recent, w.clock.t - HOUR);
      signedIn(w);
      const mine = v1({ days: { '2026-10-12': 30 }, met: ['2026-10-12'], name: '阿啾', nameAt: w.clock.t - HOUR });
      w.local.setItem(PREFIX + 'pet', J(mine));
      w.local.setItem('tr_localonly_' + USER.id, J({ pet: w.clock.t - HOUR }));
      w.clock.t += skew * 864e5; w.serverAhead = -skew * 864e5;
      const pg = await openLoggedIn(w, { stack: NEW, food: false });
      await pg.runAll(); await pg.S.idle();
      const ups0 = w.ops.filter(o => o.k === 'pet' && o.op === 'upsert').length;
      const marks = JSON.parse(w.local.getItem('tr_localonly_' + USER.id) || '{}');
      const held = same(cp(w), recent) && ups0 === 0 && !!lp(w) && lp(w).name === '阿啾' && lp(w).days['2026-10-12'] === 30 && 'pet' in marks;
      /* 時鐘還沒調好就登出:這份還沒上雲,要先問;取消就留著 */
      w.confirmAnswer = false;
      await pg.ctx.CLOUD.logout(); await tick();
      const asked = w.confirms.length > 0 && !!lp(w) && lp(w).name === '阿啾';
      w.clock.t -= skew * 864e5; w.serverAhead = 0;
      await pg.fire('win:online'); await pg.runAll(); await pg.S.idle(); await pg.runAll();
      const c = cp(w);
      const merged = !!c && c.name === '阿啾' && c.days['2026-10-12'] === 30 && c.days['2026-10-15'] === 9 && c.met.includes('2026-10-12');
      out.push({ ok: held && asked && merged, d: (skew > 0 ? '快 ' : '慢 ') + Math.abs(skew) + ' 天:留在本機 ' + held + '(上傳 ' + ups0 + ' 次,標記 ' + J(marks) + ')/ 登出先問 ' + asked + ' / 調好後雲端 ' + J(c).slice(0, 120) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  'B9. 這台時鐘快 500 天、開新的工作階段灌資料:雲端那份不會被壓縮改寫,也不上傳 pet': async () => {
    const w = makeWorld();
    const recent = v1({ days: { '2026-10-10': 25, '2026-10-15': 9, '2026-10-16': 12 }, met: ['2026-10-10', '2026-10-16'] });
    cloudRow(w, 'pet', recent, w.clock.t - HOUR);
    signedIn(w);
    w.local.setItem(PREFIX + 'pet', J(v1({ name: '阿啾', nameAt: 9 })));
    w.local.setItem(LEDGER, J({ pet: w.clock.t }));
    w.clock.t += 500 * 864e5; w.serverAhead = -500 * 864e5;
    await openLoggedIn(w, { pet: 'real' });
    const ups = w.ops.filter(o => o.k === 'pet' && o.op === 'upsert').length;
    return { ok: same(cp(w), recent) && ups === 0 && 'pet' in ledger(w), detail: '雲端不變 ' + same(cp(w), recent) + ' / 上傳 ' + ups + ' 次 / 雲端 ' + J(cp(w)).slice(0, 140) };
  },
};

(async () => {
  const only = (process.argv.find(a => a.indexOf('--part=') === 0) || '').slice(7).toUpperCase();
  const parts = [['A', A], ['B', B]].filter(([p]) => !only || p === only);
  let fail = 0;
  for (const [p, set] of parts) {
    let pass = 0;
    for (const [name, fn] of Object.entries(set)) {
      let r;
      try {
        r = await Promise.race([fn(), new Promise(res => setTimeout(() => res({ ok: false, detail: '30 秒還沒結束(卡住了)' }), 30000))]);
      } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.message) }; }
      if (r.ok) pass++;
      console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + r.detail);
    }
    const total = Object.keys(set).length;
    fail += total - pass;
    console.log(p + ' 部分:' + pass + ' / ' + total + ' 通過');
  }
  process.exit(fail ? 1 : 0);
})();
