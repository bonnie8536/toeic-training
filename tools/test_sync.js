/* 同步會不會掉資料:用假的 Supabase 跑真實情境(App 被殺、斷網、跨裝置衝突、登出)。
   改 js/cloud.js 的同步邏輯之前與之後都要跑,全部通過才能上線。
   用法:node tools/test_sync.js */
const fs = require('fs');
const vm = require('vm');

const path = require('path');
const REPO = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'js', 'cloud.js'), 'utf8');

const USER = { id: '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72', email: 's@x.com', user_metadata: { name: '學生' } };   // 跟 Supabase 一樣是 UUID
const PREFIX = 'tr_u' + 'c' + USER.id.replace(/-/g, '') + '_';
const LEDGER = 'tr_unsynced_' + USER.id;
const SB_KEY = 'sb-x-auth-token';   // supabase-js 存登入資料的位置(專案網址 https://x.supabase.co)
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
  const cbs = [];
  const emit = ev => cbs.forEach(cb => cb(ev, null));
  return {
    emit,
    auth: {
      /* 登入憑證過期(預設 1 小時)又沒網路:supabase-js 換不到新憑證,回 session null */
      /* 跟真的 supabase-js 一樣:
         - 網路類的失敗(離線、憑證過期又換不到)回 session null,但 localStorage 的登入資料(SB_KEY)留著。
         - w.revoked:登入被撤銷(別台按登出、帳號刪除),回 session null 並且清掉 SB_KEY。
         - w.authGate:還沒放行前,確認登入卡住(離線時 supabase-js 會重試約 25 秒)。 */
      getSession: async () => {
        if (w.authGate) await w.authGate;
        if (w.revoked) { w.local.removeItem(SB_KEY); emit('SIGNED_OUT'); return { data: { session: null }, error: null }; }
        return w.offline && w.tokenExpired
          ? { data: { session: null }, error: { message: 'TypeError: Failed to fetch' } }
          : { data: { session: { user: USER } } };
      },
      signInWithPassword: async () => {
        if (w.offline) return { data: {}, error: { message: 'TypeError: Failed to fetch' } };
        w.revoked = false; w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', user: USER }));
        return { data: { user: USER, session: { user: USER } }, error: null };
      },
      /* 跟真的一樣:登出、自動更新換不到憑證(被撤銷)、別的分頁登出,都會清掉 SB_KEY 並通知 SIGNED_OUT */
      onAuthStateChange(cb) { cbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      /* 照 auth-js 2.117.2 的 _signOut:沒給 scope 是 global(所有裝置),'local' 只登出這台。
         - 這台沒有登入資料:不呼叫伺服器,直接回成功(別台不受影響)。
         - 憑證過期又沒網路:換不到新憑證,回 error,登入資料留著。
         - 憑證沒過期但連不上伺服器:先清掉這台的登入資料,再回 error。
         w.otherDevice:別台還登入著;w.signOuts:真的打到伺服器的 scope */
      signOut: async opts => {
        const scope = (opts && opts.scope) || 'global';
        if (!w.local.getItem(SB_KEY)) { emit('SIGNED_OUT'); return { error: null }; }
        if (w.offline && w.tokenExpired) return { error: { message: 'TypeError: Failed to fetch' } };
        (w.signOuts = w.signOuts || []).push(scope);
        if (w.offline) { w.local.removeItem(SB_KEY); emit('SIGNED_OUT'); return { error: { message: 'TypeError: Failed to fetch' } }; }
        if (scope === 'global') w.otherDevice = false;
        w.local.removeItem(SB_KEY); emit('SIGNED_OUT'); return { error: null };
      },
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
        if (table === 'teachers') { if (w.teacherGate) await w.teacherGate; return { data: [], error: null }; }   // teacherGate:登入後查教師身分卡住(灌資料之前)
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
      createElement() { return {}; },
      head: { appendChild(el) { if (w.sdkFail && el.onerror) setImmediate(el.onerror); } },   // 雲端元件沒快取又沒網路
    },
    confirm: msg => { w.confirms.push(msg); return w.confirmAnswer; },
    navigator: { get onLine() { return w.lieFi ? true : !w.offline; } },   // lieFi:手機以為有網路,其實連不出去
  };
  ctx.window = ctx;
  ctx.addEventListener = (ev, fn) => { (listeners['win:' + ev] = listeners['win:' + ev] || []).push(fn); };
  ctx.CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'k' };
  if (!w.sdkFail) ctx.supabase = { createClient: () => makeClient(w) };
  /* 跟 common.js 一樣:頁面載入時讀一次目前帳號,store.set 寫進 tr_u<這個帳號>_ */
  try { ctx.__PROFILE_ID = JSON.parse(w.local.getItem('tr_current_profile')) || null; } catch (e) { ctx.__PROFILE_ID = null; }
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
/* 已登入、已灌過資料的頁面(supabase-js 的登入資料存在 SB_KEY) */
async function openLoggedIn(w, src) {
  w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
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
  '9. 離線開 App、登入憑證已過期:離線時練的進度,恢復連線開站後要留著並上雲': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'verb_quiz', v: { n: 1 }, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    await openLoggedIn(w, src);
    w.offline = true; w.tokenExpired = true; newSession(w);
    const pg = loadPage(w, src); await pg.ready;
    studentWrites(pg, w, 'verb_quiz', { n: 2 });
    await pg.runTimers(); await pg.fire('win:pagehide'); pg.close();
    w.offline = false; w.tokenExpired = false; newSession(w);
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: same(lv(w, 'verb_quiz'), { n: 2 }) && same(cv(w, 'verb_quiz'), { n: 2 }),
             detail: '本機 ' + JSON.stringify(lv(w, 'verb_quiz')) + ' / 雲端 ' + JSON.stringify(cv(w, 'verb_quiz')) };
  },
  '10. 離線開 App、雲端元件也沒快取:離線時練的進度要留著並上雲': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'verb_quiz', v: { n: 1 }, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    await openLoggedIn(w, src);
    w.offline = true; w.sdkFail = true; newSession(w);
    const pg = loadPage(w, src); await pg.ready;
    studentWrites(pg, w, 'verb_quiz', { n: 2 });
    await pg.runTimers(); pg.close();
    w.offline = false; w.sdkFail = false; newSession(w);
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: same(lv(w, 'verb_quiz'), { n: 2 }) && same(cv(w, 'verb_quiz'), { n: 2 }),
             detail: '本機 ' + JSON.stringify(lv(w, 'verb_quiz')) + ' / 雲端 ' + JSON.stringify(cv(w, 'verb_quiz')) };
  },
  '11. 同一個工作階段裡斷線又過期,恢復連線後的下一頁要補傳': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'verb_quiz', v: { n: 1 }, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    await openLoggedIn(w, src);
    w.offline = true; w.tokenExpired = true;               // 不換工作階段:已灌過資料的旗標還在
    const pg = loadPage(w, src); await pg.ready;
    studentWrites(pg, w, 'verb_quiz', { n: 2 });
    await pg.runTimers(); pg.close();
    w.offline = false; w.tokenExpired = false;
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: same(lv(w, 'verb_quiz'), { n: 2 }) && same(cv(w, 'verb_quiz'), { n: 2 }),
             detail: '本機 ' + JSON.stringify(lv(w, 'verb_quiz')) + ' / 雲端 ' + JSON.stringify(cv(w, 'verb_quiz')) };
  },
  '12. 頁面還在確認登入時就寫入(用的是舊的本機資料):灌資料仍以雲端較新的為準': async src => {
    const w = makeWorld();
    const otherDevice = [{ name: '我的題庫', words: ['from-phone'] }];
    w.db.push({ user_id: USER.id, k: 'vgame_banks', v: otherDevice, updated_at: new Date(Date.now() - 1 * HOUR).toISOString() });
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(PREFIX + 'vgame_banks', JSON.stringify(OLD_BANK));   // 這台很久沒開
    const pg = loadPage(w, src);
    studentWrites(pg, w, 'vgame_banks', OLD_BANK);                      // 還沒確認登入就寫
    await pg.ready; await pg.runTimers();
    return { ok: same(lv(w, 'vgame_banks'), otherDevice) && same(cv(w, 'vgame_banks'), otherDevice),
             detail: '本機 ' + JSON.stringify(lv(w, 'vgame_banks')[0].words) + ' / 雲端 ' + JSON.stringify(cv(w, 'vgame_banks')[0].words) };
  },
  '13. 沒登入、用的是本機學生檔案:寫入不會產生任何雲端帳本': async src => {
    const w = makeWorld();
    w.offline = true; w.tokenExpired = true;
    w.local.setItem('tr_current_profile', JSON.stringify('pabc123'));
    const pg = loadPage(w, src); await pg.ready;
    w.local.setItem('tr_upabc123_verb_quiz', JSON.stringify({ n: 5 }));
    pg.ctx.CLOUD.push('verb_quiz', { n: 5 });
    await pg.runTimers();
    const ledgers = []; for (let i = 0; i < w.local.length; i++) { const k = w.local.key(i); if (k.startsWith('tr_unsynced_')) ledgers.push(k); }
    return { ok: ledgers.length === 0 && same(JSON.parse(w.local.getItem('tr_upabc123_verb_quiz')), { n: 5 }),
             detail: '帳本 ' + ledgers.length + ' 個 / 本機檔案資料 ' + w.local.getItem('tr_upabc123_verb_quiz') };
  },
  '14. 離線開 App,還在確認登入(重試中)就開始練,之後才確認是未登入:要留著並上雲': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'verb_quiz', v: { n: 1 }, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    await openLoggedIn(w, src);
    w.offline = true; w.tokenExpired = true; newSession(w);
    let release; w.authGate = new Promise(r => { release = r; });
    const pg = loadPage(w, src); await tick();
    studentWrites(pg, w, 'verb_quiz', { n: 2 });
    release(); w.authGate = null; await pg.ready; await pg.runTimers(); pg.close();
    w.offline = false; w.tokenExpired = false; newSession(w);
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: same(lv(w, 'verb_quiz'), { n: 2 }) && same(cv(w, 'verb_quiz'), { n: 2 }),
             detail: '本機 ' + JSON.stringify(lv(w, 'verb_quiz')) + ' / 雲端 ' + JSON.stringify(cv(w, 'verb_quiz')) };
  },
  '15. 離線開 App,還在確認登入就練完、把 App 關掉:要留著並上雲': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'verb_quiz', v: { n: 1 }, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    await openLoggedIn(w, src);
    w.offline = true; w.tokenExpired = true; newSession(w);
    w.authGate = new Promise(() => {});
    const pg = loadPage(w, src); await tick();
    studentWrites(pg, w, 'verb_quiz', { n: 2 });
    await pg.fire('win:pagehide'); pg.close();
    w.authGate = null; w.offline = false; w.tokenExpired = false; newSession(w);
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: same(lv(w, 'verb_quiz'), { n: 2 }) && same(cv(w, 'verb_quiz'), { n: 2 }),
             detail: '本機 ' + JSON.stringify(lv(w, 'verb_quiz')) + ' / 雲端 ' + JSON.stringify(cv(w, 'verb_quiz')) };
  },
  '16. 同一個工作階段換頁,新頁還在確認登入時的寫入也要上傳': async src => {
    const w = makeWorld();
    await openLoggedIn(w, src);
    let release; w.authGate = new Promise(r => { release = r; });
    const pg = loadPage(w, src); await tick();
    studentWrites(pg, w, 'verb_quiz', { n: 7 });
    release(); w.authGate = null; await pg.ready; await pg.runTimers();
    const led = JSON.parse(w.local.getItem(LEDGER) || '{}');
    return { ok: same(cv(w, 'verb_quiz'), { n: 7 }) && Object.keys(led).length === 0,
             detail: '雲端 ' + JSON.stringify(cv(w, 'verb_quiz')) + ' / 帳本剩 ' + Object.keys(led).length + ' 筆' };
  },
  '17. 有網路、還在確認登入就寫入又馬上關頁:下次灌資料仍以雲端較新的為準': async src => {
    const w = makeWorld();
    const otherDevice = [{ name: '我的題庫', words: ['from-phone'] }];
    w.db.push({ user_id: USER.id, k: 'vgame_banks', v: otherDevice, updated_at: new Date(Date.now() - 1 * HOUR).toISOString() });
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(PREFIX + 'vgame_banks', JSON.stringify(OLD_BANK));
    w.authGate = new Promise(() => {});
    const pg = loadPage(w, src); await tick();
    studentWrites(pg, w, 'vgame_banks', OLD_BANK);
    await pg.fire('win:pagehide'); pg.close();
    w.authGate = null;
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: same(lv(w, 'vgame_banks'), otherDevice) && same(cv(w, 'vgame_banks'), otherDevice),
             detail: '本機 ' + JSON.stringify(lv(w, 'vgame_banks')[0].words) + ' / 雲端 ' + JSON.stringify(cv(w, 'vgame_banks')[0].words) };
  },
  '18. 離線開 App(登入憑證過期):仍是登入狀態、不跳登入框;離線練的進度恢復連線後上雲': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'verb_quiz', v: { n: 1 }, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    await openLoggedIn(w, src);
    w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
    w.offline = true; w.tokenExpired = true; newSession(w);
    const pg = loadPage(w, src); await pg.ready;
    const u = pg.ctx.CLOUD.user;
    studentWrites(pg, w, 'verb_quiz', { n: 2 });
    await pg.runTimers(); pg.close();
    w.offline = false; w.tokenExpired = false; newSession(w);
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: !!u && u.id === USER.id && same(lv(w, 'verb_quiz'), { n: 2 }) && same(cv(w, 'verb_quiz'), { n: 2 }),
             detail: '離線時登入者 ' + (u ? u.email : 'null') + ' / 本機 ' + JSON.stringify(lv(w, 'verb_quiz')) + ' / 雲端 ' + JSON.stringify(cv(w, 'verb_quiz')) };
  },
  '19. 手機以為有網路、其實連不出去(憑證換不到):一樣維持登入狀態': async src => {
    const w = makeWorld();
    await openLoggedIn(w, src);
    w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
    w.offline = true; w.lieFi = true; w.tokenExpired = true; newSession(w);
    const pg = loadPage(w, src); await pg.ready;
    const u = pg.ctx.CLOUD.user;
    return { ok: !!u && u.id === USER.id, detail: '登入者 ' + (u ? u.email : 'null') };
  },
  '20. 連不出去、雲端元件也沒快取時按登出:有沒同步的進度要先問,按取消就不刪': async src => {
    const w = makeWorld();
    await openLoggedIn(w, src);
    w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
    w.offline = true; w.lieFi = true; w.sdkFail = true; newSession(w);
    const pg = loadPage(w, src); await pg.ready;
    studentWrites(pg, w, 'verb_quiz', { n: 2 });
    w.confirmAnswer = false;
    const before = w.reloads;
    await pg.ctx.CLOUD.logout(); await tick();
    return { ok: !!pg.ctx.CLOUD.user && w.confirms.length === 1 && same(lv(w, 'verb_quiz'), { n: 2 }) && w.reloads === before,
             detail: '登入者 ' + (pg.ctx.CLOUD.user ? 'ok' : 'null') + ' / 問了 ' + w.confirms.length + ' 次 / 本機 ' + JSON.stringify(lv(w, 'verb_quiz')) };
  },
  '21. 離線時確定登出:這台的登入資料也清掉,下次開站不會自動登回去': async src => {
    const w = makeWorld();
    await openLoggedIn(w, src);
    w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
    w.offline = true; w.lieFi = true; w.sdkFail = true; newSession(w);
    const pg = loadPage(w, src); await pg.ready;
    w.confirmAnswer = true;
    await pg.ctx.CLOUD.logout(); await tick();
    return { ok: w.local.getItem(SB_KEY) === null && w.local.getItem('tr_current_profile') === null,
             detail: '登入資料 ' + (w.local.getItem(SB_KEY) === null ? '已清' : '還在') + ' / 目前帳號 ' + w.local.getItem('tr_current_profile') };
  },
  '22. 這台裝置留的登入資料是別的帳號:離線時不會被當成登入': async src => {
    const w = makeWorld();
    await openLoggedIn(w, src);
    const OTHER = { id: '9a9a9a9a-1111-4222-8333-444455556666', email: 'o@x.com', user_metadata: {} };
    w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: OTHER }));
    w.offline = true; w.tokenExpired = true; newSession(w);
    const pg = loadPage(w, src); await pg.ready;
    return { ok: pg.ctx.CLOUD.user === null, detail: '登入者 ' + (pg.ctx.CLOUD.user ? pg.ctx.CLOUD.user.email : 'null') };
  },
  '23. 別台按登出(這台的登入被撤銷)後,在這台沒登入的狀態下練習:不能記帳,重新登入時以雲端較新的為準': async src => {
    const w = makeWorld();
    const phone = ['d1', 'phone1', 'phone2'];
    w.db.push({ user_id: USER.id, k: 'hist', v: ['d1'], updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    await openLoggedIn(w, src);                                   // 這台灌過 ['d1'] 之後就沒再開
    w.db[0] = { user_id: USER.id, k: 'hist', v: phone, updated_at: new Date(Date.now() - 1 * HOUR).toISOString() };
    w.revoked = true; newSession(w);
    const pg = loadPage(w, src); await pg.ready;
    const loggedOut = pg.ctx.CLOUD.user === null;
    studentWrites(pg, w, 'hist', ['d1', 'logged-out-answer']);    // 舊資料加一筆
    await pg.runTimers(); await pg.fire('win:pagehide');
    const ledgerAfter = w.local.getItem(LEDGER);
    await pg.ctx.CLOUD.login('s@x.com', 'test-only'); await tick(); pg.close();
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: loggedOut && ledgerAfter === null && same(cv(w, 'hist'), phone) && same(lv(w, 'hist'), phone),
             detail: '未登入 ' + loggedOut + ' / 帳本 ' + ledgerAfter + ' / 雲端 ' + JSON.stringify(cv(w, 'hist')) + ' / 本機 ' + JSON.stringify(lv(w, 'hist')) };
  },
  '24. 連不到雲端時維持登入的頁面,恢復連線後不能直接上傳舊帳本:要等灌資料時比對新舊': async src => {
    const w = makeWorld();
    const phone = ['d1', 'phone1', 'phone2'];
    w.db.push({ user_id: USER.id, k: 'hist', v: phone, updated_at: new Date(Date.now() - 1 * HOUR).toISOString() });
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
    w.local.setItem(PREFIX + 'hist', JSON.stringify(['d1', 'old-offline']));
    w.local.setItem(LEDGER, JSON.stringify({ hist: Date.now() - 2 * HOUR }));   // 兩小時前離線改的,比手機那筆舊
    w.offline = true; w.lieFi = true; w.tokenExpired = true;
    const pg = loadPage(w, src); await pg.ready;
    const adopted = !!pg.ctx.CLOUD.user;
    w.offline = false; w.lieFi = false; w.tokenExpired = false;
    pg.ctx.document.visibilityState = 'hidden'; await pg.fire('doc:visibilitychange'); await pg.fire('win:online');
    const cloudAfterFlush = cv(w, 'hist');
    pg.close();
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: adopted && same(cloudAfterFlush, phone) && same(cv(w, 'hist'), phone) && same(lv(w, 'hist'), phone),
             detail: '維持登入 ' + adopted + ' / 恢復連線後雲端 ' + JSON.stringify(cloudAfterFlush) + ' / 下一頁本機 ' + JSON.stringify(lv(w, 'hist')) };
  },
  '25. 還在確認登入時寫入、離線時切到背景,之後同一頁連上並灌資料:那些寫入作廢,以雲端較新的為準': async src => {
    const w = makeWorld();
    const otherDevice = [{ name: '我的題庫', words: ['from-phone'] }];
    w.db.push({ user_id: USER.id, k: 'vgame_banks', v: otherDevice, updated_at: new Date(Date.now() - 1 * HOUR).toISOString() });
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
    w.local.setItem(PREFIX + 'vgame_banks', JSON.stringify(OLD_BANK));
    let release; w.authGate = new Promise(r => { release = r; });
    const pg = loadPage(w, src); await tick();
    studentWrites(pg, w, 'vgame_banks', OLD_BANK);
    w.offline = true;
    pg.ctx.document.visibilityState = 'hidden'; await pg.fire('doc:visibilitychange');
    w.offline = false; pg.ctx.document.visibilityState = 'visible';
    release(); w.authGate = null; await pg.ready; await pg.runTimers();
    return { ok: same(lv(w, 'vgame_banks'), otherDevice) && same(cv(w, 'vgame_banks'), otherDevice),
             detail: '本機 ' + JSON.stringify(lv(w, 'vgame_banks')[0].words) + ' / 雲端 ' + JSON.stringify(cv(w, 'vgame_banks')[0].words) };
  },
  '26. 共用裝置:登入被撤銷後,沒登入的人練習產生的新鍵,不能在原帳號下次登入時被傳上去': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'vgame_banks', v: NEW_BANK, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    await openLoggedIn(w, src);
    w.revoked = true; newSession(w);
    const reloadsBefore = w.reloads;
    const pg = loadPage(w, src); await pg.ready;
    const switched = w.local.getItem('tr_current_profile') === null && w.reloads === reloadsBefore + 1;
    const pg2 = loadPage(w, src); await pg2.ready;                 // 重載後是訪客
    pageWrites(pg2, w, 'verb_quiz', { n: 9 });                     // 不規則動詞頁不需登入
    await pg2.runTimers(); await pg2.fire('win:pagehide');
    await pg2.ctx.CLOUD.login('s@x.com', 'test-only'); await tick(); pg2.close();
    const pg3 = loadPage(w, src); await pg3.ready; await pg3.runTimers();
    return { ok: switched && cv(w, 'verb_quiz') === undefined && lv(w, 'verb_quiz') === null && same(lv(w, 'vgame_banks'), NEW_BANK),
             detail: '改回訪客 ' + switched + ' / 雲端 verb_quiz ' + JSON.stringify(cv(w, 'verb_quiz')) + ' / 帳號本機 verb_quiz ' + JSON.stringify(lv(w, 'verb_quiz')) + ' / 題庫 ' + JSON.stringify(lv(w, 'vgame_banks')) };
  },
  '27. 改回訪客時一筆都不刪:原帳號在這台的資料與還沒上雲的帳本都留著': async src => {
    const w = makeWorld();
    await openLoggedIn(w, src);
    w.local.setItem(PREFIX + 'vgame_banks', JSON.stringify(NEW_BANK));
    w.local.setItem(LEDGER, JSON.stringify({ vgame_banks: Date.now() - HOUR }));
    w.revoked = true; newSession(w);
    const pg = loadPage(w, src); await pg.ready;
    const led = JSON.parse(w.local.getItem(LEDGER) || '{}');
    return { ok: w.local.getItem('tr_current_profile') === null && same(lv(w, 'vgame_banks'), NEW_BANK) && led.vgame_banks !== undefined,
             detail: '目前帳號 ' + w.local.getItem('tr_current_profile') + ' / 題庫 ' + (lv(w, 'vgame_banks') ? '還在' : '被刪了') + ' / 帳本 ' + JSON.stringify(led) };
  },
  '28. 只有雲端帳號的資料夾會改回訪客:本機學生檔案、離線維持登入都不動': async src => {
    const w = makeWorld();
    w.local.setItem('tr_current_profile', JSON.stringify('pabc123'));
    w.revoked = true;                                              // 這台沒有任何登入資料
    const pg = loadPage(w, src); await pg.ready;
    const localKept = JSON.parse(w.local.getItem('tr_current_profile')) === 'pabc123';
    const w2 = makeWorld();
    await openLoggedIn(w2, src);
    w2.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
    w2.offline = true; w2.lieFi = true; w2.tokenExpired = true; newSession(w2);
    const r0 = w2.reloads;
    const pg2 = loadPage(w2, src); await pg2.ready;
    const offlineKept = w2.local.getItem('tr_current_profile') !== null && w2.reloads === r0 && !!pg2.ctx.CLOUD.user;
    return { ok: localKept && offlineKept, detail: '本機檔案 ' + localKept + ' / 離線維持登入 ' + offlineKept };
  },
  '29. 登入被撤銷、確認登入還沒結束時就有寫入:改回訪客,那些值不給訪客看、本機不刪;帳本上原帳號還沒上雲的資料照常上傳': async src => {
    const w = makeWorld();
    await openLoggedIn(w, src);
    w.local.setItem(PREFIX + 'vgame_banks', JSON.stringify(NEW_BANK));
    w.local.setItem(LEDGER, JSON.stringify({ vgame_banks: Date.now() - HOUR }));   // 學生自己還沒上雲的題庫
    w.revoked = true; newSession(w);
    let release; w.authGate = new Promise(r => { release = r; });
    const pg = loadPage(w, src); await tick();
    pageWrites(pg, w, 'verb_quiz', { n: 9, by: 'stranger' });
    pageWrites(pg, w, 'vgame_banks', NEW_BANK);                    // 讀進來再寫回的鍵:帳本上有,不能搬走
    release(); w.authGate = null; await pg.ready;
    const moved = w.local.getItem('tr_verb_quiz') === null;
    const bankKept = same(lv(w, 'vgame_banks'), NEW_BANK) && w.local.getItem('tr_vgame_banks') === null;
    await pg.close();
    const pg2 = loadPage(w, src); await pg2.ready;
    await pg2.ctx.CLOUD.login('s@x.com', 'test-only'); await tick(); pg2.close();
    const pg3 = loadPage(w, src); await pg3.ready; await pg3.runTimers();
    return { ok: moved && bankKept && same(cv(w, 'vgame_banks'), NEW_BANK) && lv(w, 'verb_quiz').n === 9,
             detail: '沒給訪客 ' + moved + ' / 本機還在 ' + JSON.stringify(lv(w, 'verb_quiz')) + ' / 題庫留在帳號 ' + bankKept + ' / 雲端 verb_quiz ' + JSON.stringify(cv(w, 'verb_quiz')) + ' / 雲端題庫 ' + JSON.stringify(cv(w, 'vgame_banks')) };
  },
  '30. 登入被撤銷又載不到雲端元件:一樣改回訪客;訪客資料夾原有的不動': async src => {
    const w = makeWorld();
    await openLoggedIn(w, src);
    w.local.setItem('tr_verb_quiz', JSON.stringify({ n: 1, by: 'guest' }));
    w.local.removeItem(SB_KEY); w.sdkFail = true; newSession(w);
    const r0 = w.reloads;
    const pg = loadPage(w, src);                                    // 還沒確認完登入就寫入
    pageWrites(pg, w, 'verb_quiz', { n: 9, by: 'stranger' });
    await new Promise(r => setTimeout(r, 20)); await pg.ready;
    const guestKept = JSON.parse(w.local.getItem('tr_verb_quiz')).by === 'guest';
    const switched = w.local.getItem('tr_current_profile') === null && w.reloads === r0 + 1;
    w.sdkFail = false;
    const pg2 = loadPage(w, src); await pg2.ready;
    await pg2.ctx.CLOUD.login('s@x.com', 'test-only'); await tick(); pg2.close();
    const pg3 = loadPage(w, src); await pg3.ready; await pg3.runTimers();
    return { ok: switched && guestKept,
             detail: '改回訪客 ' + switched + ' / 訪客原本的 ' + guestKept + ' / 雲端 verb_quiz ' + JSON.stringify(cv(w, 'verb_quiz')) };
  },
  '31. 自己按登出:只重載一次,這台的帳號資料刪光,一筆都不會跑到訪客資料夾': async src => {
    const w = makeWorld();
    await openLoggedIn(w, src);
    let release; w.authGate = new Promise(r => { release = r; });
    const pg = loadPage(w, src);
    studentWrites(pg, w, 'vgame_banks', NEW_BANK);
    release(); w.authGate = null; await pg.ready; await pg.runTimers();
    const r0 = w.reloads;
    await pg.ctx.CLOUD.logout(); await tick();
    const left = []; for (let i = 0; i < w.local.length; i++) { const k = w.local.key(i); if (k.startsWith(PREFIX) || k === 'tr_vgame_banks') left.push(k); }
    return { ok: w.reloads === r0 + 1 && left.length === 0 && same(cv(w, 'vgame_banks'), NEW_BANK),
             detail: '重載 +' + (w.reloads - r0) + ' / 留下 ' + JSON.stringify(left) + ' / 雲端 ' + JSON.stringify(cv(w, 'vgame_banks')) };
  },
  '32. 從訪客頁登入、灌資料途中有寫入:不能被當成登入失效而清掉登入者': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'vgame_banks', v: OLD_BANK, updated_at: new Date(Date.now() - HOUR).toISOString() });
    w.revoked = true;                                              // 這台沒有登入資料
    const pg = loadPage(w, src); await pg.ready;                   // 訪客
    let release; w.teacherGate = new Promise(r => { release = r; });
    const p = pg.ctx.CLOUD.login('s@x.com', 'test-only'); await tick();   // 剛登入、還沒灌資料
    const mid = !!pg.ctx.CLOUD.user;
    pageWrites(pg, w, 'verb_quiz', { n: 1 });
    const kept = !!pg.ctx.CLOUD.user;
    release(); w.teacherGate = null; await p; await tick();
    return { ok: mid && kept && w.local.getItem('tr_current_profile') !== null,
             detail: '寫入後登入者 ' + (kept ? 'ok' : 'null') + ' / 目前帳號 ' + w.local.getItem('tr_current_profile') };
  },
  '33. 原帳號很久以前沒傳上去的舊資料(沒帳本、雲端沒有),登入失效時自己在確認前改了它:一筆都不能刪': async src => {
    const w = makeWorld();
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(PREFIX + 'vgame_banks', JSON.stringify(OLD_BANK));   // 10/1 以前留下、從沒上雲
    w.revoked = true;
    let release; w.authGate = new Promise(r => { release = r; });
    const pg = loadPage(w, src);
    pageWrites(pg, w, 'vgame_banks', NEW_BANK);
    release(); w.authGate = null; await pg.ready;
    const kept1 = same(lv(w, 'vgame_banks'), NEW_BANK);
    const pg2 = loadPage(w, src); await pg2.ready;
    await pg2.ctx.CLOUD.login('s@x.com', 'test-only'); await tick(); pg2.close();
    const pg3 = loadPage(w, src); await pg3.ready; await pg3.runTimers();
    return { ok: kept1 && same(lv(w, 'vgame_banks'), NEW_BANK),
             detail: '改回訪客後 ' + JSON.stringify(lv(w, 'vgame_banks')) + ' / 再登入後 ' + JSON.stringify(lv(w, 'vgame_banks')) + ' / 雲端 ' + JSON.stringify(cv(w, 'vgame_banks')) };
  },
  '34. 登入資料的格式看不懂(supabase-js 改版):照舊記帳上傳,不能把學生踢回訪客': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1 }));   // 沒有 user 欄位
    const r0 = w.reloads;
    studentWrites(pg, w, 'vgame_banks', NEW_BANK); await pg.runTimers();
    return { ok: w.reloads === r0 && same(cv(w, 'vgame_banks'), NEW_BANK) && !!pg.ctx.CLOUD.user,
             detail: '重載 +' + (w.reloads - r0) + ' / 雲端 ' + JSON.stringify(cv(w, 'vgame_banks')) };
  },
  '35. 開站確認登入時,別的分頁已經換成另一個帳號登入:不能把新帳號的「目前帳號」清掉': async src => {
    const w = makeWorld();
    await openLoggedIn(w, src);
    w.revoked = true; newSession(w);
    let release; w.authGate = new Promise(r => { release = r; });
    const pg = loadPage(w, src);
    const otherPid = JSON.stringify('c11111111222233334444555555555555');
    w.local.setItem('tr_current_profile', otherPid);               // 別的分頁剛登入另一個帳號
    const r0 = w.reloads;
    release(); w.authGate = null; await pg.ready;
    return { ok: w.local.getItem('tr_current_profile') === otherPid && w.reloads === r0 + 1,
             detail: '目前帳號 ' + w.local.getItem('tr_current_profile') + ' / 重載 +' + (w.reloads - r0) };
  },
  '36. 登入失效改回訪客後,重載的那一頁要知道「登入已失效」,而且只有那一次': async src => {
    const w = makeWorld();
    await openLoggedIn(w, src);
    w.revoked = true; newSession(w);
    const pg = loadPage(w, src); await pg.ready;                   // 改回訪客並重載
    const pg2 = loadPage(w, src); await pg2.ready;                 // 重載後的頁面
    const pg3 = loadPage(w, src); await pg3.ready;                 // 同一個分頁再換一頁
    return { ok: pg2.ctx.CLOUD.sessionExpired === true && pg3.ctx.CLOUD.sessionExpired === false && w.local.getItem('tr_current_profile') === null,
             detail: '重載後 ' + pg2.ctx.CLOUD.sessionExpired + ' / 再換一頁 ' + pg3.ctx.CLOUD.sessionExpired };
  },
  '37. 沒有登入失效的情況不顯示提示:從沒登入的訪客、自己按登出、還在登入中、別的分頁已換成另一個帳號': async src => {
    const w = makeWorld();
    const guest = loadPage(w, src); await guest.ready;
    const w2 = makeWorld();
    const pg = await openLoggedIn(w2, src);
    const loggedIn = pg.ctx.CLOUD.sessionExpired;
    await pg.ctx.CLOUD.logout(); pg.close();
    const after = loadPage(w2, src); await after.ready;
    /* 35 的情況:改回訪客時別的分頁已換成另一個帳號,重載後跟著那個帳號,不該說「登入已失效」 */
    const w3 = makeWorld();
    await openLoggedIn(w3, src);
    w3.revoked = true; newSession(w3);
    let release; w3.authGate = new Promise(r => { release = r; });
    const p3 = loadPage(w3, src);
    w3.local.setItem('tr_current_profile', JSON.stringify('c11111111222233334444555555555555'));
    release(); w3.authGate = null; await p3.ready;
    const p4 = loadPage(w3, src); await p4.ready;
    return { ok: guest.ctx.CLOUD.sessionExpired === false && loggedIn === false && after.ctx.CLOUD.sessionExpired === false && p4.ctx.CLOUD.sessionExpired === false,
             detail: '訪客 ' + guest.ctx.CLOUD.sessionExpired + ' / 登入中 ' + loggedIn + ' / 登出後 ' + after.ctx.CLOUD.sessionExpired + ' / 別的帳號 ' + p4.ctx.CLOUD.sessionExpired };
  },
  '38. 按「登出」只登出這台:別台(例如學生的手機)維持登入,這台的登入資料與個資照樣清掉': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    w.otherDevice = true;
    studentWrites(pg, w, 'vgame_banks', [{ id: 'b1' }]); await pg.runTimers();
    await pg.ctx.CLOUD.logout(); await tick();
    const scopes = (w.signOuts || []).join(',');
    return { ok: scopes === 'local' && w.otherDevice === true && w.local.getItem(SB_KEY) === null && lv(w, 'vgame_banks') === null && same(cv(w, 'vgame_banks'), [{ id: 'b1' }]),
             detail: 'signOut ' + scopes + ' / 別台 ' + (w.otherDevice ? '還登入' : '被登出') + ' / 雲端題庫 ' + JSON.stringify(cv(w, 'vgame_banks')) };
  },
  '39. 按「登出所有裝置」:所有裝置都登出,這台清掉登入資料並重載': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    w.otherDevice = true;
    const r0 = w.reloads;
    await pg.ctx.CLOUD.logout({ everywhere: true }); await tick();
    const scopes = (w.signOuts || []).join(',');
    return { ok: scopes === 'global' && w.otherDevice === false && w.local.getItem(SB_KEY) === null && w.local.getItem('tr_current_profile') === null && w.reloads === r0 + 1,
             detail: 'signOut ' + scopes + ' / 別台 ' + (w.otherDevice ? '還登入' : '被登出') + ' / 重載 +' + (w.reloads - r0) };
  },
  '40. 「登出所有裝置」連不上伺服器(憑證沒過期、已過期兩種):別台沒登出,這台也不登出、不刪資料,而且要讓畫面知道失敗': async src => {
    const one = async expired => {
      const w = makeWorld();
      const pg = await openLoggedIn(w, src);
      w.otherDevice = true;
      studentWrites(pg, w, 'vgame_banks', [{ id: 'b1' }]); await pg.runTimers();
      w.offline = true; w.tokenExpired = expired;
      const r0 = w.reloads;
      let err = null;
      try { await pg.ctx.CLOUD.logout({ everywhere: true }); } catch (e) { err = e; }
      await tick();
      const ok = !!err && w.otherDevice === true && w.local.getItem(SB_KEY) !== null && same(lv(w, 'vgame_banks'), [{ id: 'b1' }]) && !!pg.ctx.CLOUD.user && w.reloads === r0;
      return { ok, detail: (expired ? '過期:' : '沒過期:') + '錯誤 ' + (err ? '有' : '沒有') + ' / 登入資料 ' + (w.local.getItem(SB_KEY) ? '還在' : '已清') + ' / 本機題庫 ' + JSON.stringify(lv(w, 'vgame_banks')) };
    };
    const a = await one(false), b = await one(true);
    return { ok: a.ok && b.ok, detail: a.detail + ' | ' + b.detail };
  },
  '42. 這台的登入資料已經不見(例如上一次失敗、別的分頁先登出)時按「登出所有裝置」:不能假裝成功,什麼都不刪': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    w.otherDevice = true;
    studentWrites(pg, w, 'vgame_banks', [{ id: 'b3' }]); await pg.runTimers();
    w.local.removeItem(SB_KEY);
    const r0 = w.reloads;
    let err = null;
    try { await pg.ctx.CLOUD.logout({ everywhere: true }); } catch (e) { err = e; }
    await tick();
    return { ok: !!err && w.otherDevice === true && same(lv(w, 'vgame_banks'), [{ id: 'b3' }]) && w.reloads === r0 && w.confirms.length === 0,
             detail: '錯誤 ' + (err ? err.message : '沒有') + ' / 別台 ' + (w.otherDevice ? '還登入' : '被登出') + ' / 本機題庫 ' + JSON.stringify(lv(w, 'vgame_banks')) + ' / 重載 +' + (w.reloads - r0) };
  },
  '41. 「登出所有裝置」時有沒同步的進度:先問,按取消就什麼都不做(不呼叫登出)': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    w.lieFi = true; w.offline = true;
    studentWrites(pg, w, 'vgame_banks', [{ id: 'b2' }]);
    w.confirmAnswer = false;
    await pg.ctx.CLOUD.logout({ everywhere: true }); await tick();
    return { ok: w.confirms.length === 1 && !(w.signOuts || []).length && same(lv(w, 'vgame_banks'), [{ id: 'b2' }]) && !!pg.ctx.CLOUD.user,
             detail: '問了 ' + w.confirms.length + ' 次 / signOut ' + ((w.signOuts || []).join(',') || '沒呼叫') + ' / 本機題庫 ' + JSON.stringify(lv(w, 'vgame_banks')) };
  },
};

/* 跟 common.js 的 store.set 一樣依「目前資料夾」寫:訪客寫 tr_<鍵>,帳號寫 tr_u<id>_<鍵> */
function pageWrites(pg, w, k, v) {
  const id = pg.ctx.__PROFILE_ID;
  w.local.setItem('tr_' + (id ? 'u' + id + '_' : '') + k, JSON.stringify(v));
  pg.ctx.CLOUD.push(k, v);
}

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
