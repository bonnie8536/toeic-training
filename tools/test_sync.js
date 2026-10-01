/* 同步會不會掉資料:用假的 Supabase 跑真實情境(App 被殺、斷網、跨裝置衝突、登出)。
   改 js/cloud.js 的同步邏輯之前與之後都要跑,8 項全過才能上線。
   用法:node tools/test_sync.js */
const fs = require('fs');
const vm = require('vm');

const path = require('path');
const REPO = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'js', 'cloud.js'), 'utf8');

const USER = { id: 'u1-aaaa-bbbb', email: 's@x.com', user_metadata: { name: '學生' } };
const PREFIX = 'tr_u' + 'c' + USER.id.replace(/-/g, '') + '_';
const LEDGER = 'tr_unsynced_' + USER.id;
const HOUR = 3600e3;

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
function makeWorld() {
  return { db: [], local: makeStorage(), session: makeStorage(), offline: false, reloads: 0, confirms: [], confirmAnswer: true };
}
function makeClient(w) {
  return {
    auth: {
      getSession: async () => ({ data: { session: { user: USER } } }),
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
          return { data: w.db.filter(r => r.user_id === q.filters.user_id).map(r => JSON.parse(JSON.stringify(r))), error: null };
        }
        if (q.op === 'upsert') {
          const row = JSON.parse(JSON.stringify(q.row));
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
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

/* 開一次頁面。close() = 頁面被系統殺掉:排程中的上傳全部消失,而且不會觸發 pagehide */
function loadPage(w, src) {
  const timers = new Map(); let tid = 0;
  const listeners = {};
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    setTimeout: fn => { const id = ++tid; timers.set(id, fn); return id; },
    clearTimeout: id => { timers.delete(id); },
    localStorage: w.local,
    sessionStorage: w.session,
    location: { hash: '', search: '', pathname: '/index.html', origin: 'https://x', href: 'https://x/index.html', reload() { w.reloads++; } },
    history: { replaceState() {} },
    document: {
      visibilityState: 'visible',
      addEventListener(ev, fn) { (listeners['doc:' + ev] = listeners['doc:' + ev] || []).push(fn); },
      createElement() { return {}; }, head: { appendChild() {} },
    },
    confirm: msg => { w.confirms.push(msg); return w.confirmAnswer; },
  };
  ctx.window = ctx;
  ctx.addEventListener = (ev, fn) => { (listeners['win:' + ev] = listeners['win:' + ev] || []).push(fn); };
  ctx.CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'k' };
  ctx.supabase = { createClient: () => makeClient(w) };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return {
    ctx,
    ready: ctx.CLOUD.ready.then(tick),
    async runTimers() { const fns = [...timers.values()]; timers.clear(); for (const f of fns) await f(); await tick(); },
    close() { timers.clear(); },
    async fire(name) { (listeners[name] || []).forEach(f => f()); await tick(); },
  };
}
const lv = (w, k) => { const raw = w.local.getItem(PREFIX + k); return raw === null ? null : JSON.parse(raw); };
const cv = (w, k) => { const r = w.db.find(r => r.user_id === USER.id && r.k === k); return r ? r.v : undefined; };
const newSession = w => { w.session = makeStorage(); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* 學生在頁面上改資料:跟 common.js 的 store.set 一樣,先寫本機再 CLOUD.push */
function studentWrites(pg, w, k, v) {
  w.local.setItem(PREFIX + k, JSON.stringify(v));
  pg.ctx.CLOUD.push(k, v);
}
/* 已登入、已灌過資料的頁面 */
async function openLoggedIn(w, src) {
  let pg = loadPage(w, src); await pg.ready;          // 新工作階段:灌資料後 reload
  pg = loadPage(w, src); await pg.ready;              // reload 後的頁面
  return pg;
}

const OLD_BANK = [{ name: '我的題庫', words: ['apple'] }];
const NEW_BANK = [{ name: '我的題庫', words: ['apple', 'banana', 'cherry'] }];

const scenarios = {
  '1. 自訂題庫加字後 0.8 秒內 App 被關掉,隔天重開': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'vgame_banks', v: OLD_BANK, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    const pg = await openLoggedIn(w, src);
    studentWrites(pg, w, 'vgame_banks', NEW_BANK);
    pg.close();
    newSession(w);
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: same(lv(w, 'vgame_banks'), NEW_BANK) && same(cv(w, 'vgame_banks'), NEW_BANK),
             detail: '本機 ' + JSON.stringify(lv(w, 'vgame_banks')[0].words) + ' / 雲端 ' + JSON.stringify(cv(w, 'vgame_banks')[0].words) };
  },
  '2. 網路不穩上傳失敗,下次連線開站': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'vgame_banks', v: OLD_BANK, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    const pg = await openLoggedIn(w, src);
    w.offline = true;
    studentWrites(pg, w, 'vgame_banks', NEW_BANK);
    await pg.runTimers();                                // 上傳失敗
    w.offline = false;
    newSession(w);
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: same(lv(w, 'vgame_banks'), NEW_BANK) && same(cv(w, 'vgame_banks'), NEW_BANK),
             detail: '本機 ' + JSON.stringify(lv(w, 'vgame_banks')[0].words) + ' / 雲端 ' + JSON.stringify(cv(w, 'vgame_banks')[0].words) };
  },
  '3. 修改前就沒傳上去的新題庫(雲端從沒有這一列)': async src => {
    const w = makeWorld();
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(PREFIX + 'vgame_banks', JSON.stringify(NEW_BANK));   // 沒有帳本、雲端沒有列
    const pg = loadPage(w, src); await pg.ready; await pg.runTimers();
    return { ok: same(lv(w, 'vgame_banks'), NEW_BANK) && same(cv(w, 'vgame_banks'), NEW_BANK),
             detail: '本機 ' + JSON.stringify(lv(w, 'vgame_banks')) + ' / 雲端 ' + JSON.stringify(cv(w, 'vgame_banks')) };
  },
  '4. 另一台裝置比較新:要用雲端的,不能被舊的本機蓋回去': async src => {
    const w = makeWorld();
    const otherDevice = [{ name: '我的題庫', words: ['from-phone'] }];
    w.db.push({ user_id: USER.id, k: 'vgame_banks', v: otherDevice, updated_at: new Date(Date.now() - 1 * HOUR).toISOString() });
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(PREFIX + 'vgame_banks', JSON.stringify(NEW_BANK));
    w.local.setItem(LEDGER, JSON.stringify({ vgame_banks: Date.now() - 2 * HOUR }));   // 本機改動比較舊
    const pg = loadPage(w, src); await pg.ready; await pg.runTimers();
    return { ok: same(lv(w, 'vgame_banks'), otherDevice) && same(cv(w, 'vgame_banks'), otherDevice),
             detail: '本機 ' + JSON.stringify(lv(w, 'vgame_banks')[0].words) + ' / 雲端 ' + JSON.stringify(cv(w, 'vgame_banks')[0].words) };
  },
  '5. 開站時沒網路:本機一個都不能刪': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'vgame_banks', v: OLD_BANK, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(PREFIX + 'vgame_banks', JSON.stringify(NEW_BANK));
    w.local.setItem(LEDGER, JSON.stringify({ vgame_banks: Date.now() }));
    w.offline = true;
    const pg = loadPage(w, src); await pg.ready; await pg.runTimers();
    return { ok: same(lv(w, 'vgame_banks'), NEW_BANK), detail: '本機 ' + JSON.stringify(lv(w, 'vgame_banks')[0].words) };
  },
  '6. 一般寫入照常上傳,帳本清空': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    studentWrites(pg, w, 'vgame_banks', NEW_BANK);
    await pg.runTimers();
    const led = JSON.parse(w.local.getItem(LEDGER) || '{}');
    return { ok: same(cv(w, 'vgame_banks'), NEW_BANK) && Object.keys(led).length === 0,
             detail: '雲端 ' + JSON.stringify(cv(w, 'vgame_banks')) + ' / 帳本剩 ' + Object.keys(led).length + ' 筆' };
  },
  '7. 關頁(pagehide)立刻補傳,不等 0.8 秒': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    studentWrites(pg, w, 'vgame_banks', NEW_BANK);
    await pg.fire('win:pagehide');
    return { ok: same(cv(w, 'vgame_banks'), NEW_BANK), detail: '雲端 ' + JSON.stringify(cv(w, 'vgame_banks')) };
  },
  '8. 還有沒同步的資料時登出:先問,按取消就不刪': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    w.offline = true;
    studentWrites(pg, w, 'vgame_banks', NEW_BANK);
    await pg.runTimers();
    w.confirmAnswer = false;
    const before = w.reloads;
    await pg.ctx.CLOUD.logout(); await tick();
    return { ok: w.confirms.length === 1 && same(lv(w, 'vgame_banks'), NEW_BANK) && w.reloads === before,
             detail: '問了 ' + w.confirms.length + ' 次 / 本機題庫 ' + (lv(w, 'vgame_banks') ? '還在' : '被刪了') };
  },
};

(async () => {
  let pass = 0;
  for (const [name, fn] of Object.entries(scenarios)) {
    let r;
    try { r = await fn(SRC); } catch (e) { r = { ok: false, detail: '例外 ' + e.message }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + r.detail);
  }
  const total = Object.keys(scenarios).length;
  console.log(pass + ' / ' + total + ' 通過');
  process.exit(pass === total ? 0 : 1);
})();
