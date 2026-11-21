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
/* 這裡測的是「整份上傳、後傳的蓋掉先傳的」那一套(帳本、灌資料時二選一)。以前拿自訂題庫(vgame_banks)當例子;
   題庫改成先讀雲端、合併再上傳之後(js/sync-merge.js,tools/test_sync_union.js 測),改用不在合併表上的鍵(錯題本 drill_p5),
   情境與規則都沒變。OLD_BANK、NEW_BANK 只是拿來當值 */
const K = 'drill_p5';

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
        if (w.noSession) return { data: { session: null }, error: null };
        if (w.sessionUser) return { data: { session: { user: w.sessionUser } } };   // supabase-js 手上是另一個帳號(或 null:沒有登入)
        if (w.offline && w.tokenExpired) return { data: { session: null }, error: { message: 'TypeError: Failed to fetch' } };
        /* w.authFromStorage:跟真的 supabase-js 一樣看這台 localStorage 的登入資料(別的分頁登出清掉了就是沒登入) */
        if (w.authFromStorage) { const u = storedUser(w); return { data: { session: u ? (w.withToken ? { user: u, access_token: 'tok-' + u.id } : { user: u }) : null }, error: null }; }   // withToken:付款要的登入憑證(情境 63)
        return { data: { session: { user: USER } } };
      },
      /* w.loginAs:這次登入的是別的帳號(換帳號) */
      signInWithPassword: async () => {
        if (w.offline) return { data: {}, error: { message: 'TypeError: Failed to fetch' } };
        const u = w.loginAs || USER;
        w.revoked = false; w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', user: u }));
        return { data: { user: u, session: { user: u } }, error: null };
      },
      /* 跟真的一樣:登出、自動更新換不到憑證(被撤銷)、別的分頁登出,都會清掉 SB_KEY 並通知 SIGNED_OUT */
      onAuthStateChange(cb) { cbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      /* 照 auth-js 2.117.2 的 _signOut:沒給 scope 是 global(所有裝置),'local' 只登出這台。
         - 這台沒有登入資料:不呼叫伺服器,直接回成功(別台不受影響)。
         - 憑證過期又沒網路:換不到新憑證,回 error,登入資料留著。
         - 憑證沒過期但連不上伺服器:先清掉這台的登入資料,再回 error。
         w.otherDevice:別台還登入著;w.signOuts:真的打到伺服器的 scope */
      signOut: async opts => {
        w.signOutCalls = (w.signOutCalls || 0) + 1;   // 有沒有呼叫(這台沒有登入資料時也算;情境 63、64)
        const scope = (opts && opts.scope) || 'global';
        if (!w.local.getItem(SB_KEY)) { emit('SIGNED_OUT'); return { error: null }; }
        if (w.offline && w.tokenExpired) return { error: { message: 'TypeError: Failed to fetch' } };
        (w.signOuts = w.signOuts || []).push(scope);
        (w.signOutAs = w.signOutAs || []).push((storedUser(w) || {}).id || null);   // 用這台現在的登入資料登出的是哪個帳號(情境 63)
        if (w.offline) { w.local.removeItem(SB_KEY); emit('SIGNED_OUT'); return { error: { message: 'TypeError: Failed to fetch' } }; }
        if (scope === 'global') w.otherDevice = false;
        w.local.removeItem(SB_KEY); emit('SIGNED_OUT'); return { error: null };
      },
      /* 改暱稱、改密碼(情境 63):跟真的一樣作用在這台現在的登入資料那個帳號上;w.authCalls 記下作用在誰身上 */
      updateUser: async attrs => {
        const u = storedUser(w);
        (w.authCalls = w.authCalls || []).push({ op: 'updateUser', as: u ? u.id : null, attrs: JSON.parse(JSON.stringify(attrs || {})) });
        if (!u) return { data: { user: null }, error: { message: 'Auth session missing!' } };
        const meta = attrs && attrs.data ? Object.assign({}, u.user_metadata, attrs.data) : u.user_metadata;
        return { data: { user: Object.assign({}, u, { user_metadata: meta }) }, error: null };
      },
    },
    /* 資料庫函式(刪除帳號、加入班級、老師試用…):跟真的一樣用這台現在的登入資料;w.rpcs 記下呼叫了什麼、作用在誰身上(情境 63) */
    rpc: async fn => { (w.rpcs = w.rpcs || []).push({ fn, as: (storedUser(w) || {}).id || null }); return { error: null }; },
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
          if (q.filters.k !== undefined) {   // 讀單一鍵(readKey):記下查了什麼;readGate 還沒放行前卡住
            (w.keyReads = w.keyReads || []).push(Object.assign({}, q.filters));
            if (w.readGate) await w.readGate;
            if (w.offline) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
            if (w.readError) return { data: null, error: { message: 'JWT expired', code: 'PGRST301' } };
            if (w.readNull) return { data: null, error: null };
          } else {   // 整批讀(灌資料):progressGate 只卡住下一次(還在讀);progressFail 打開時回 Failed to fetch(網路斷一下、Supabase 慢或休眠)
            w.fullReads = (w.fullReads || 0) + 1;   // 整批讀了幾次(換頁有沒有多灌一次)
            if (w.progressGate) { const g = w.progressGate; w.progressGate = null; await g; }
            if (w.progressFail) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
          }
          if (w.rls && !rlsOk(w, q.filters.user_id)) return { data: [], error: null };   // 沒有登入資料或不是這個帳號:只回空陣列
          return { data: w.db.filter(r => r.user_id === q.filters.user_id && (q.filters.k === undefined || r.k === q.filters.k)).map(r => JSON.parse(JSON.stringify(r))), error: null };
        }
        if (q.op === 'upsert') {
          if (w.rls && !rlsOk(w, q.row.user_id)) return { data: null, error: { message: 'new row violates row-level security policy for table "progress"', code: '42501' } };
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
/* 這台 localStorage 裡 supabase-js 的登入資料是哪個帳號(沒有就是 null) */
function storedUser(w) { try { const s = JSON.parse(w.local.getItem(SB_KEY)); return s && s.user ? s.user : null; } catch (e) { return null; } }
/* w.rls:照 Supabase 的 RLS,請求帶的是這台現在的登入資料(supabase-js 每次都從 storage 讀);沒有、或不是這一列的帳號就擋下 */
function rlsOk(w, uid) { const u = storedUser(w); return !!u && u.id === uid; }
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
    confirm: msg => { w.confirms.push(msg); if (w.onConfirm) { const f = w.onConfirm; w.onConfirm = null; f(); } return w.confirmAnswer; },   // onConfirm:確認視窗開著的時候發生的事(情境 63)
    /* 新版 cloud.js 的確認視窗是 UI.confirm(Promise);舊版基準檔仍用上面的原生 confirm。兩個記同一份 confirms */
    UI: { confirm: o => { w.confirms.push(o.title + '\n' + (o.body || '')); if (w.onConfirm) { const f = w.onConfirm; w.onConfirm = null; f(); } return Promise.resolve(w.confirmAnswer); } },
    navigator: { get onLine() { return w.lieFi ? true : !w.offline; } },   // lieFi:手機以為有網路,其實連不出去
    /* 付款(startCheckout 打 Edge Function):w.fetches 記下送了幾次、帶的是誰的登入憑證(情境 63) */
    fetch: async (url, init) => {
      const m = /tok-(.+)$/.exec(String((init && init.headers && init.headers.Authorization) || ''));
      (w.fetches = w.fetches || []).push({ url: String(url), as: m ? m[1] : null });
      return { status: 200, ok: true, json: async () => ({ action: 'https://pay', fields: {}, order_no: 'o1' }) }; },
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
  '1. 錯題本(整份上傳的鍵)改了之後 0.8 秒內 App 被關掉,隔天重開': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: K, v: OLD_BANK, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    const pg = await openLoggedIn(w, src);
    studentWrites(pg, w, K, NEW_BANK);
    pg.close();
    newSession(w);
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: same(lv(w, K), NEW_BANK) && same(cv(w, K), NEW_BANK),
             detail: '本機 ' + JSON.stringify(lv(w, K)[0].words) + ' / 雲端 ' + JSON.stringify(cv(w, K)[0].words) };
  },
  '2. 網路不穩上傳失敗,下次連線開站': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: K, v: OLD_BANK, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    const pg = await openLoggedIn(w, src);
    w.offline = true;
    studentWrites(pg, w, K, NEW_BANK);
    await pg.runTimers();                                // 上傳失敗
    w.offline = false;
    newSession(w);
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: same(lv(w, K), NEW_BANK) && same(cv(w, K), NEW_BANK),
             detail: '本機 ' + JSON.stringify(lv(w, K)[0].words) + ' / 雲端 ' + JSON.stringify(cv(w, K)[0].words) };
  },
  '3. 修改前就沒傳上去的鍵(雲端從沒有這一列)': async src => {
    const w = makeWorld();
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(PREFIX + K, JSON.stringify(NEW_BANK));   // 沒有帳本、雲端沒有列
    const pg = loadPage(w, src); await pg.ready; await pg.runTimers();
    return { ok: same(lv(w, K), NEW_BANK) && same(cv(w, K), NEW_BANK),
             detail: '本機 ' + JSON.stringify(lv(w, K)) + ' / 雲端 ' + JSON.stringify(cv(w, K)) };
  },
  '4. 另一台裝置比較新:要用雲端的,不能被舊的本機蓋回去': async src => {
    const w = makeWorld();
    const otherDevice = [{ name: '我的題庫', words: ['from-phone'] }];
    w.db.push({ user_id: USER.id, k: K, v: otherDevice, updated_at: new Date(Date.now() - 1 * HOUR).toISOString() });
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(PREFIX + K, JSON.stringify(NEW_BANK));
    w.local.setItem(LEDGER, JSON.stringify({ [K]: Date.now() - 2 * HOUR }));   // 本機改動比較舊
    const pg = loadPage(w, src); await pg.ready; await pg.runTimers();
    return { ok: same(lv(w, K), otherDevice) && same(cv(w, K), otherDevice),
             detail: '本機 ' + JSON.stringify(lv(w, K)[0].words) + ' / 雲端 ' + JSON.stringify(cv(w, K)[0].words) };
  },
  '5. 開站時沒網路:本機一個都不能刪': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: K, v: OLD_BANK, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(PREFIX + K, JSON.stringify(NEW_BANK));
    w.local.setItem(LEDGER, JSON.stringify({ [K]: Date.now() }));
    w.offline = true;
    const pg = loadPage(w, src); await pg.ready; await pg.runTimers();
    return { ok: same(lv(w, K), NEW_BANK), detail: '本機 ' + JSON.stringify(lv(w, K)[0].words) };
  },
  '6. 一般寫入照常上傳,帳本清空': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    studentWrites(pg, w, K, NEW_BANK);
    await pg.runTimers();
    const led = JSON.parse(w.local.getItem(LEDGER) || '{}');
    return { ok: same(cv(w, K), NEW_BANK) && Object.keys(led).length === 0,
             detail: '雲端 ' + JSON.stringify(cv(w, K)) + ' / 帳本剩 ' + Object.keys(led).length + ' 筆' };
  },
  '7. 關頁(pagehide)立刻補傳,不等 0.8 秒': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    studentWrites(pg, w, K, NEW_BANK);
    await pg.fire('win:pagehide');
    return { ok: same(cv(w, K), NEW_BANK), detail: '雲端 ' + JSON.stringify(cv(w, K)) };
  },
  '8. 還有沒同步的資料時登出:先問,按取消就不刪': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    w.offline = true;
    studentWrites(pg, w, K, NEW_BANK);
    await pg.runTimers();
    w.confirmAnswer = false;
    const before = w.reloads;
    await pg.ctx.CLOUD.logout(); await tick();
    return { ok: w.confirms.length === 1 && same(lv(w, K), NEW_BANK) && w.reloads === before,
             detail: '問了 ' + w.confirms.length + ' 次 / 本機題庫 ' + (lv(w, K) ? '還在' : '被刪了') };
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
    w.db.push({ user_id: USER.id, k: K, v: otherDevice, updated_at: new Date(Date.now() - 1 * HOUR).toISOString() });
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(PREFIX + K, JSON.stringify(OLD_BANK));   // 這台很久沒開
    const pg = loadPage(w, src);
    studentWrites(pg, w, K, OLD_BANK);                      // 還沒確認登入就寫
    await pg.ready; await pg.runTimers();
    return { ok: same(lv(w, K), otherDevice) && same(cv(w, K), otherDevice),
             detail: '本機 ' + JSON.stringify(lv(w, K)[0].words) + ' / 雲端 ' + JSON.stringify(cv(w, K)[0].words) };
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
    w.db.push({ user_id: USER.id, k: K, v: otherDevice, updated_at: new Date(Date.now() - 1 * HOUR).toISOString() });
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(PREFIX + K, JSON.stringify(OLD_BANK));
    w.authGate = new Promise(() => {});
    const pg = loadPage(w, src); await tick();
    studentWrites(pg, w, K, OLD_BANK);
    await pg.fire('win:pagehide'); pg.close();
    w.authGate = null;
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();
    return { ok: same(lv(w, K), otherDevice) && same(cv(w, K), otherDevice),
             detail: '本機 ' + JSON.stringify(lv(w, K)[0].words) + ' / 雲端 ' + JSON.stringify(cv(w, K)[0].words) };
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
    w.db.push({ user_id: USER.id, k: K, v: otherDevice, updated_at: new Date(Date.now() - 1 * HOUR).toISOString() });
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
    w.local.setItem(PREFIX + K, JSON.stringify(OLD_BANK));
    let release; w.authGate = new Promise(r => { release = r; });
    const pg = loadPage(w, src); await tick();
    studentWrites(pg, w, K, OLD_BANK);
    w.offline = true;
    pg.ctx.document.visibilityState = 'hidden'; await pg.fire('doc:visibilitychange');
    w.offline = false; pg.ctx.document.visibilityState = 'visible';
    release(); w.authGate = null; await pg.ready; await pg.runTimers();
    return { ok: same(lv(w, K), otherDevice) && same(cv(w, K), otherDevice),
             detail: '本機 ' + JSON.stringify(lv(w, K)[0].words) + ' / 雲端 ' + JSON.stringify(cv(w, K)[0].words) };
  },
  '26. 共用裝置:登入被撤銷後,沒登入的人練習產生的新鍵,不能在原帳號下次登入時被傳上去': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: K, v: NEW_BANK, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
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
    return { ok: switched && cv(w, 'verb_quiz') === undefined && lv(w, 'verb_quiz') === null && same(lv(w, K), NEW_BANK),
             detail: '改回訪客 ' + switched + ' / 雲端 verb_quiz ' + JSON.stringify(cv(w, 'verb_quiz')) + ' / 帳號本機 verb_quiz ' + JSON.stringify(lv(w, 'verb_quiz')) + ' / 題庫 ' + JSON.stringify(lv(w, K)) };
  },
  '27. 改回訪客時一筆都不刪:原帳號在這台的資料與還沒上雲的帳本都留著': async src => {
    const w = makeWorld();
    await openLoggedIn(w, src);
    w.local.setItem(PREFIX + K, JSON.stringify(NEW_BANK));
    w.local.setItem(LEDGER, JSON.stringify({ [K]: Date.now() - HOUR }));
    w.revoked = true; newSession(w);
    const pg = loadPage(w, src); await pg.ready;
    const led = JSON.parse(w.local.getItem(LEDGER) || '{}');
    return { ok: w.local.getItem('tr_current_profile') === null && same(lv(w, K), NEW_BANK) && led[K] !== undefined,
             detail: '目前帳號 ' + w.local.getItem('tr_current_profile') + ' / 題庫 ' + (lv(w, K) ? '還在' : '被刪了') + ' / 帳本 ' + JSON.stringify(led) };
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
    w.local.setItem(PREFIX + K, JSON.stringify(NEW_BANK));
    w.local.setItem(LEDGER, JSON.stringify({ [K]: Date.now() - HOUR }));   // 學生自己還沒上雲的題庫
    w.revoked = true; newSession(w);
    let release; w.authGate = new Promise(r => { release = r; });
    const pg = loadPage(w, src); await tick();
    pageWrites(pg, w, 'verb_quiz', { n: 9, by: 'stranger' });
    pageWrites(pg, w, K, NEW_BANK);                    // 讀進來再寫回的鍵:帳本上有,不能搬走
    release(); w.authGate = null; await pg.ready;
    const moved = w.local.getItem('tr_verb_quiz') === null;
    const bankKept = same(lv(w, K), NEW_BANK) && w.local.getItem('tr_' + K) === null;
    await pg.close();
    const pg2 = loadPage(w, src); await pg2.ready;
    await pg2.ctx.CLOUD.login('s@x.com', 'test-only'); await tick(); pg2.close();
    const pg3 = loadPage(w, src); await pg3.ready; await pg3.runTimers();
    return { ok: moved && bankKept && same(cv(w, K), NEW_BANK) && lv(w, 'verb_quiz').n === 9,
             detail: '沒給訪客 ' + moved + ' / 本機還在 ' + JSON.stringify(lv(w, 'verb_quiz')) + ' / 題庫留在帳號 ' + bankKept + ' / 雲端 verb_quiz ' + JSON.stringify(cv(w, 'verb_quiz')) + ' / 雲端題庫 ' + JSON.stringify(cv(w, K)) };
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
    studentWrites(pg, w, K, NEW_BANK);
    release(); w.authGate = null; await pg.ready; await pg.runTimers();
    const r0 = w.reloads;
    await pg.ctx.CLOUD.logout(); await tick();
    const left = []; for (let i = 0; i < w.local.length; i++) { const k = w.local.key(i); if (k.startsWith(PREFIX) || k === 'tr_' + K) left.push(k); }
    return { ok: w.reloads === r0 + 1 && left.length === 0 && same(cv(w, K), NEW_BANK),
             detail: '重載 +' + (w.reloads - r0) + ' / 留下 ' + JSON.stringify(left) + ' / 雲端 ' + JSON.stringify(cv(w, K)) };
  },
  '32. 從訪客頁登入、灌資料途中有寫入:不能被當成登入失效而清掉登入者': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: K, v: OLD_BANK, updated_at: new Date(Date.now() - HOUR).toISOString() });
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
    w.local.setItem(PREFIX + K, JSON.stringify(OLD_BANK));   // 10/1 以前留下、從沒上雲
    w.revoked = true;
    let release; w.authGate = new Promise(r => { release = r; });
    const pg = loadPage(w, src);
    pageWrites(pg, w, K, NEW_BANK);
    release(); w.authGate = null; await pg.ready;
    const kept1 = same(lv(w, K), NEW_BANK);
    const pg2 = loadPage(w, src); await pg2.ready;
    await pg2.ctx.CLOUD.login('s@x.com', 'test-only'); await tick(); pg2.close();
    const pg3 = loadPage(w, src); await pg3.ready; await pg3.runTimers();
    return { ok: kept1 && same(lv(w, K), NEW_BANK),
             detail: '改回訪客後 ' + JSON.stringify(lv(w, K)) + ' / 再登入後 ' + JSON.stringify(lv(w, K)) + ' / 雲端 ' + JSON.stringify(cv(w, K)) };
  },
  '34. 登入資料的格式看不懂(supabase-js 改版):照舊記帳上傳,不能把學生踢回訪客': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1 }));   // 沒有 user 欄位
    const r0 = w.reloads;
    studentWrites(pg, w, K, NEW_BANK); await pg.runTimers();
    return { ok: w.reloads === r0 && same(cv(w, K), NEW_BANK) && !!pg.ctx.CLOUD.user,
             detail: '重載 +' + (w.reloads - r0) + ' / 雲端 ' + JSON.stringify(cv(w, K)) };
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
    studentWrites(pg, w, K, [{ id: 'b1' }]); await pg.runTimers();
    await pg.ctx.CLOUD.logout(); await tick();
    const scopes = (w.signOuts || []).join(',');
    return { ok: scopes === 'local' && w.otherDevice === true && w.local.getItem(SB_KEY) === null && lv(w, K) === null && same(cv(w, K), [{ id: 'b1' }]),
             detail: 'signOut ' + scopes + ' / 別台 ' + (w.otherDevice ? '還登入' : '被登出') + ' / 雲端題庫 ' + JSON.stringify(cv(w, K)) };
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
      studentWrites(pg, w, K, [{ id: 'b1' }]); await pg.runTimers();
      w.offline = true; w.tokenExpired = expired;
      const r0 = w.reloads;
      let err = null;
      try { await pg.ctx.CLOUD.logout({ everywhere: true }); } catch (e) { err = e; }
      await tick();
      const ok = !!err && w.otherDevice === true && w.local.getItem(SB_KEY) !== null && same(lv(w, K), [{ id: 'b1' }]) && !!pg.ctx.CLOUD.user && w.reloads === r0;
      return { ok, detail: (expired ? '過期:' : '沒過期:') + '錯誤 ' + (err ? '有' : '沒有') + ' / 登入資料 ' + (w.local.getItem(SB_KEY) ? '還在' : '已清') + ' / 本機題庫 ' + JSON.stringify(lv(w, K)) };
    };
    const a = await one(false), b = await one(true);
    return { ok: a.ok && b.ok, detail: a.detail + ' | ' + b.detail };
  },
  '42. 這台的登入資料已經不見(例如上一次失敗、別的分頁先登出)時按「登出所有裝置」:不能假裝成功,什麼都不刪': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    w.otherDevice = true;
    studentWrites(pg, w, K, [{ id: 'b3' }]); await pg.runTimers();
    w.local.removeItem(SB_KEY);
    const r0 = w.reloads;
    let err = null;
    try { await pg.ctx.CLOUD.logout({ everywhere: true }); } catch (e) { err = e; }
    await tick();
    return { ok: !!err && w.otherDevice === true && same(lv(w, K), [{ id: 'b3' }]) && w.reloads === r0 && w.confirms.length === 0,
             detail: '錯誤 ' + (err ? err.message : '沒有') + ' / 別台 ' + (w.otherDevice ? '還登入' : '被登出') + ' / 本機題庫 ' + JSON.stringify(lv(w, K)) + ' / 重載 +' + (w.reloads - r0) };
  },
  '41. 「登出所有裝置」時有沒同步的進度:先問,按取消就什麼都不做(不呼叫登出)': async src => {
    const w = makeWorld();
    const pg = await openLoggedIn(w, src);
    w.lieFi = true; w.offline = true;
    studentWrites(pg, w, K, [{ id: 'b2' }]);
    w.confirmAnswer = false;
    await pg.ctx.CLOUD.logout({ everywhere: true }); await tick();
    return { ok: w.confirms.length === 1 && !(w.signOuts || []).length && same(lv(w, K), [{ id: 'b2' }]) && !!pg.ctx.CLOUD.user,
             detail: '問了 ' + w.confirms.length + ' 次 / signOut ' + ((w.signOuts || []).join(',') || '沒呼叫') + ' / 本機題庫 ' + JSON.stringify(lv(w, K)) };
  },
  /* ---------- 讀單一鍵(路線圖 1.2b,小雞寫回前先抓雲端那一份合併) ---------- */
  '43. 讀單一鍵:只回這個帳號那一列,而且什麼都不寫(本機、帳本、雲端都不變)': async src => {
    const w = makeWorld();
    const PET = { v: 1, days: { '2026-10-10': 12 } };
    w.db.push({ user_id: USER.id, k: 'pet', v: PET, updated_at: '2026-10-10T08:00:00.000Z' });
    w.db.push({ user_id: 'someone-else', k: 'pet', v: { v: 1, days: { '2026-10-10': 99 } }, updated_at: '2026-10-11T08:00:00.000Z' });
    const pg = await openLoggedIn(w, src);
    studentWrites(pg, w, 'pet', { v: 1, days: { '2026-10-11': 3 } });   // 本機有一筆還沒傳的改動(帳本上有)
    const before = snapshot(w);
    const r = await pg.ctx.CLOUD.readKey('pet');
    const after = snapshot(w);
    const reads = (w.keyReads || []).map(f => f.user_id + ':' + f.k).join(',');
    return { ok: !!r && r.ok === true && r.found === true && same(r.v, PET) && r.updated_at === '2026-10-10T08:00:00.000Z' && before === after && reads === USER.id + ':pet',
             detail: '回傳 ' + JSON.stringify(r) + ' / 查詢 ' + reads + ' / 儲存與雲端 ' + (before === after ? '沒變' : '變了') };
  },
  '44. 讀單一鍵:雲端沒有這一列回 found:false;別台刪掉的(v=null)回 found:true、v:null': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'gone', v: null, updated_at: '2026-10-10T08:00:00.000Z' });
    const pg = await openLoggedIn(w, src);
    const a = await pg.ctx.CLOUD.readKey('pet');
    const b = await pg.ctx.CLOUD.readKey('gone');
    return { ok: !!a && a.ok === true && a.found === false && a.v === null && !!b && b.ok === true && b.found === true && b.v === null,
             detail: '沒有 ' + JSON.stringify(a) + ' / 刪掉的 ' + JSON.stringify(b) };
  },
  '45. 讀單一鍵:離線、沒登入(訪客)、鍵不合法都回 ok:false,不能讓呼叫的人以為雲端沒有': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'pet', v: { v: 1 }, updated_at: '2026-10-10T08:00:00.000Z' });
    const pg = await openLoggedIn(w, src);
    w.offline = true;
    const off = await pg.ctx.CLOUD.readKey('pet');
    w.offline = false;
    const n0 = (w.keyReads || []).length;
    const bad = [await pg.ctx.CLOUD.readKey(''), await pg.ctx.CLOUD.readKey(null), await pg.ctx.CLOUD.readKey({ k: 'pet' })];
    const badQueried = (w.keyReads || []).length - n0;
    const g = makeWorld();
    g.db.push({ user_id: USER.id, k: 'pet', v: { v: 1 }, updated_at: '2026-10-10T08:00:00.000Z' });
    const guest = loadPage(g, src); await guest.ready;
    const gr = await guest.ctx.CLOUD.readKey('pet');
    return { ok: !!off && off.ok === false && bad.every(x => x && x.ok === false) && badQueried === 0 && !!gr && gr.ok === false && !(g.keyReads || []).length,
             detail: '離線 ' + JSON.stringify(off) + ' / 不合法 ' + JSON.stringify(bad) + '(查了 ' + badQueried + ' 次) / 訪客 ' + JSON.stringify(gr) };
  },
  '46. 讀單一鍵:讀到一半換了帳號(別的分頁登入別人)回 ok:false,不把 A 的雲端資料交給 B 的頁面': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'pet', v: { v: 1, days: { '2026-10-10': 12 } }, updated_at: '2026-10-10T08:00:00.000Z' });
    const pg = await openLoggedIn(w, src);
    let open; w.readGate = new Promise(r => { open = r; });
    const p = pg.ctx.CLOUD.readKey('pet');
    await tick();
    pg.ctx.CLOUD.user = { id: '9a9a9a9a-0000-4000-8000-000000000000', email: 'b@x.com' };
    open(); const r = await p;
    return { ok: !!r && r.ok === false, detail: '回傳 ' + JSON.stringify(r) };
  },
  '47. 讀單一鍵:伺服器一直不回(Supabase 休眠剛醒、手機訊號差),逾時回 ok:false,不會永遠卡住': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'pet', v: { v: 1 }, updated_at: '2026-10-10T08:00:00.000Z' });
    const pg = await openLoggedIn(w, src);
    w.readGate = new Promise(() => {});
    let r = 'pending';
    pg.ctx.CLOUD.readKey('pet').then(x => { r = x; });
    await tick();
    const stillPending = r === 'pending';
    await pg.runTimers();
    return { ok: stillPending && r !== 'pending' && !!r && r.ok === false, detail: '逾時前 ' + (stillPending ? '等待中' : '已回') + ' / 逾時後 ' + JSON.stringify(r) };
  },
  '48. 讀單一鍵:剛灌完雲端資料、頁面要重載的那一頁不查(回 ok:false),重載後的頁面照常讀': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'pet', v: { v: 1 }, updated_at: '2026-10-10T08:00:00.000Z' });
    w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));   // 隔天重開:資料夾已經是這個帳號
    const first = loadPage(w, src); await first.ready;    // 新工作階段:灌資料後要重載
    const r1 = await first.ctx.CLOUD.readKey('pet');
    const second = loadPage(w, src); await second.ready;
    const r2 = await second.ctx.CLOUD.readKey('pet');
    return { ok: !!r1 && r1.ok === false && !!r2 && r2.ok === true && r2.found === true,
             detail: '重載前 ' + JSON.stringify(r1) + ' / 重載後 ' + JSON.stringify(r2) };
  },
  '49. 讀單一鍵:supabase-js 手上已經沒有登入、或是別的帳號(查詢會被 RLS 回空陣列):回 ok:false,不能當成雲端沒有': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'pet', v: { v: 1 }, updated_at: '2026-10-10T08:00:00.000Z' });
    const pg = await openLoggedIn(w, src);
    w.noSession = true;
    const a = await pg.ctx.CLOUD.readKey('pet');
    w.noSession = false; w.sessionUser = { id: '9a9a9a9a-0000-4000-8000-000000000000' };
    const b = await pg.ctx.CLOUD.readKey('pet');
    return { ok: !!a && a.ok === false && !!b && b.ok === false && !(w.keyReads || []).length,
             detail: '沒有登入 ' + JSON.stringify(a) + ' / 別的帳號 ' + JSON.stringify(b) + ' / 查詢 ' + (w.keyReads || []).length + ' 次' };
  },
  '50. 讀單一鍵:伺服器回錯誤(憑證過期 401)或回 data:null,都回 ok:false': async src => {
    const w = makeWorld();
    w.db.push({ user_id: USER.id, k: 'pet', v: { v: 1 }, updated_at: '2026-10-10T08:00:00.000Z' });
    const pg = await openLoggedIn(w, src);
    w.readError = true;
    const a = await pg.ctx.CLOUD.readKey('pet');
    w.readError = false; w.readNull = true;
    const b = await pg.ctx.CLOUD.readKey('pet');
    return { ok: !!a && a.ok === false && !!b && b.ok === false, detail: '401 ' + JSON.stringify(a) + ' / data:null ' + JSON.stringify(b) };
  },
  '51. 從訪客頁登入、灌資料途中有寫入(寫在訪客資料夾):不記進帳號的帳本,灌資料時不把帳號雲端那一列蓋成 null': async src => {
    const w = makeWorld();
    const row = { n: 7 };
    w.db.push({ user_id: USER.id, k: 'verb_quiz', v: row, updated_at: new Date(Date.now() - HOUR).toISOString() });   // 帳號在雲端本來就有
    w.revoked = true;                                              // 這台沒有登入資料
    const pg = loadPage(w, src); await pg.ready;                   // 訪客
    let release; w.teacherGate = new Promise(r => { release = r; });
    const p = pg.ctx.CLOUD.login('s@x.com', 'test-only'); await tick();   // 剛登入、還沒灌資料
    pageWrites(pg, w, 'verb_quiz', { n: 1 });                      // 這一頁的資料夾還是訪客的:寫進 tr_verb_quiz
    release(); w.teacherGate = null; await p; await tick();
    const led = Object.keys(JSON.parse(w.local.getItem(LEDGER) || '{}'));
    const pg2 = loadPage(w, src); await pg2.ready; await pg2.runTimers();   // 重載後那一頁
    return { ok: same(cv(w, 'verb_quiz'), row) && same(lv(w, 'verb_quiz'), row) && !led.includes('verb_quiz'),
             detail: '雲端 ' + JSON.stringify(cv(w, 'verb_quiz')) + ' / 帳號資料夾 ' + JSON.stringify(lv(w, 'verb_quiz')) + ' / 帳本 ' + JSON.stringify(led) };
  },
  /* ---------- 同一台好幾個分頁、讀雲端進度失敗(main 130f330 就有的掉資料路徑,2026-10-31 審查) ----------
     下面幾個情境用 w.authFromStorage(登入看這台的登入資料)、w.rls(請求帶這台現在的登入資料,不是這個帳號就擋下),
     兩個分頁共用 localStorage、各自一份 sessionStorage(換 w.session)。作答照 practice.js:寫入當下重讀本機、加一筆、整份寫回 */
  '52. 同一台兩個分頁都登入,一個登出再登回來、讀雲端進度失敗或還在讀:另一個分頁換頁後要重灌,作答不能把錯題本(整份上傳)蓋掉雲端': async src => {
    const one = async timing => {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      w.db.push({ user_id: USER.id, k: K, v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      const sA = w.session;
      const pgOld = await openLoggedIn(w, src);                      // 分頁 A 灌過
      w.session = makeStorage();                                     // 分頁 B:新的工作階段,灌資料後重載
      let pgB = loadPage(w, src); await pgB.ready;
      pgB = loadPage(w, src); await pgB.ready;
      await pgB.ctx.CLOUD.logout(); await tick();                    // B 登出:帳號資料夾、帳本刪光,只清 B 自己的旗標
      pgB = loadPage(w, src); await pgB.ready;                       // B 重載成訪客
      let release = null;
      if (timing === 'inflight') w.progressGate = new Promise(r => { release = r; }); else w.progressFail = true;
      const loginP = pgB.ctx.CLOUD.login('s@x.com', 'test-only').then(() => null, e => e);
      await tick();
      if (timing !== 'inflight') await loginP;
      w.session = sA;
      let pgA = timing === 'stale' ? pgOld : (await settle(w, src)).pg;   // A 換頁;stale:A 用登出前就開著的那一頁
      studentWrites(pgA, w, K, (lv(w, K) || []).concat(['new-q']));
      await pgA.runTimers(); await pgA.fire('win:pagehide');
      const mid = cv(w, K);
      if (release) { release(); await loginP; await tick(); }
      w.progressFail = false;
      pgA = (await settle(w, src)).pg;                               // 網路恢復,A 再換一頁
      const shown = lv(w, K) || [];
      studentWrites(pgA, w, K, shown.concat(['new-q2']));
      await pgA.runTimers();
      const end = cv(w, K);
      return { ok: hasAll(mid, FIVE) && hasAll(shown, FIVE) && hasAll(end, FIVE.concat(['new-q2'])),
               detail: ({ fail: '讀失敗', inflight: '還在讀', stale: '讀失敗、A 沒換頁' })[timing] + ':A 作答後雲端 ' + JSON.stringify(mid) + ' / 下一頁本機 ' + JSON.stringify(shown) + ' / 最後雲端 ' + JSON.stringify(end) };
    };
    const rs = [await one('fail'), await one('inflight'), await one('stale')];
    return { ok: rs.every(r => r.ok), detail: rs.map(r => r.detail).join(' | ') };
  },
  '53. 同一台兩個分頁都登入,一個登出(或改登入別的帳號)後,另一個沒重載的分頁照常作答:不記進原帳號的帳本,原帳號之後在這台登入時雲端不能變少': async src => {
    const one = async swap => {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      w.db.push({ user_id: USER.id, k: K, v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      const pgA = await openLoggedIn(w, src);                        // 分頁 A 灌過,之後一直沒重載
      w.session = makeStorage();
      let pgB = loadPage(w, src); await pgB.ready;
      pgB = loadPage(w, src); await pgB.ready;
      await pgB.ctx.CLOUD.logout(); await tick();
      pgB = loadPage(w, src); await pgB.ready;                       // B 重載成訪客
      if (swap) {                                                    // B 改登入別的帳號
        w.loginAs = OTHER_USER; await pgB.ctx.CLOUD.login('o@x.com', 'test-only'); await tick(); w.loginAs = null;
        pgB = loadPage(w, src); await pgB.ready;
      }
      studentWrites(pgA, w, K, (lv(w, K) || []).concat(['only-one']));   // A:記憶體裡還是原帳號
      await pgA.runTimers(); await pgA.fire('win:pagehide');
      const led = w.local.getItem(LEDGER);
      if (swap) { await pgB.ctx.CLOUD.logout(); await tick(); pgB = loadPage(w, src); await pgB.ready; }
      await pgB.ctx.CLOUD.login('s@x.com', 'test-only'); await tick();   // 原帳號之後在這台登入
      await settle(w, src);
      return { ok: led === null && same(cv(w, K), FIVE) && same(lv(w, K), FIVE),
               detail: (swap ? '換帳號' : '登出') + ':A 作答後帳本 ' + led + ' / 再登入後雲端 ' + JSON.stringify(cv(w, K)) + ' / 本機 ' + JSON.stringify(lv(w, K)) };
    };
    const a = await one(false), b = await one(true);
    return { ok: a.ok && b.ok, detail: a.detail + ' | ' + b.detail };
  },
  '54. 資料夾已經是這個帳號、但這台還沒灌過(空的),這一頁讀雲端進度失敗:這一頁的作答不記帳,下一頁不能只拿新的那幾筆蓋掉雲端的 hist': async src => {
    const after = async (w, pg, how) => {
      const user = !!pg.ctx.CLOUD.user;
      studentWrites(pg, w, 'hist', (lv(w, 'hist') || []).concat(['new1'])); await pg.runTimers();
      studentWrites(pg, w, 'hist', (lv(w, 'hist') || []).concat(['new2'])); await pg.runTimers(); await pg.fire('win:pagehide');
      const led = Object.keys(JSON.parse(w.local.getItem(LEDGER) || '{}'));
      w.progressFail = false;
      await settle(w, src);                                          // 網路恢復,下一頁
      return { ok: user && !led.includes('hist') && same(cv(w, 'hist'), FIVE) && same(lv(w, 'hist'), FIVE),
               detail: how + ':登入著 ' + user + ' / 帳本 ' + JSON.stringify(led) + ' / 下一頁雲端 ' + JSON.stringify(cv(w, 'hist')) + ' / 本機 ' + JSON.stringify(lv(w, 'hist')) };
    };
    /* 甲:開頁時資料夾已經是這個帳號、登入資料也在,資料夾是空的(審查的重現方式) */
    const w1 = makeWorld(); w1.authFromStorage = true; w1.rls = true;
    w1.db.push({ user_id: USER.id, k: 'hist', v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    w1.local.setItem('tr_current_profile', JSON.stringify(PID));
    w1.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
    w1.progressFail = true;
    const pg1 = loadPage(w1, src); await pg1.ready;
    const a = await after(w1, pg1, '開在帳號資料夾');
    /* 乙:這台第一次登入(訪客頁),讀不到 → 按「重新整理」 → 還是讀不到 → 作答 */
    const w2 = makeWorld(); w2.authFromStorage = true; w2.rls = true;
    w2.db.push({ user_id: USER.id, k: 'hist', v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    const guest = loadPage(w2, src); await guest.ready;
    w2.progressFail = true;
    const err = await guest.ctx.CLOUD.login('s@x.com', 'test-only').then(() => null, e => e);
    const pg2 = loadPage(w2, src); await pg2.ready;
    const b = await after(w2, pg2, '第一次登入');
    /* 丙:同甲,但還在確認登入時就作答了(確認登入前的寫入,讀不到雲端時也不記帳) */
    const w3 = makeWorld(); w3.authFromStorage = true; w3.rls = true;
    w3.db.push({ user_id: USER.id, k: 'hist', v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    w3.local.setItem('tr_current_profile', JSON.stringify(PID));
    w3.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
    w3.progressFail = true;
    let release; w3.authGate = new Promise(r => { release = r; });
    const pg3 = loadPage(w3, src); await tick();
    studentWrites(pg3, w3, 'hist', ['early1']);
    release(); w3.authGate = null; await pg3.ready;
    const c = await after(w3, pg3, '確認登入前就作答');
    return { ok: a.ok && !!err && b.ok && c.ok, detail: a.detail + ' | 登入丟錯 ' + !!err + ' / ' + b.detail + ' | ' + c.detail };
  },
  '55. 登入失效改回訪客後,在同一個分頁登回來(密碼、Google 回來)讀雲端進度失敗:下一頁要重灌,不能沿用失效前的「灌過」旗標拿舊值整份上傳': async src => {
    const phone = [{ name: '我的題庫', words: ['from-phone'] }];
    const one = async how => {
      const w = makeWorld();
      w.db.push({ user_id: USER.id, k: K, v: OLD_BANK, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      await openLoggedIn(w, src);                                    // 灌過 OLD_BANK,旗標在這個分頁
      w.db[0] = { user_id: USER.id, k: K, v: phone, updated_at: new Date(Date.now() - 1 * HOUR).toISOString() };   // 別台改新
      w.revoked = true;                                              // 同一個分頁:不換工作階段
      let pg = loadPage(w, src); await pg.ready;                     // 改回訪客、重載
      pg = loadPage(w, src); await pg.ready;                         // 訪客頁
      const flagKept = w.session.getItem(FLAG) === '1';
      let backReloaded = null;
      if (how === '密碼') {
        w.progressFail = true;
        await pg.ctx.CLOUD.login('s@x.com', 'test-only').then(() => null, e => e);
      } else {                                                       // Google 回來:supabase-js 從網址拿到登入,這一頁的資料夾還是訪客的
        w.revoked = false; w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
        if (how === 'Google 讀失敗') w.progressFail = true;
        const r = w.reloads;
        pg = loadPage(w, src); await pg.ready;
        backReloaded = w.reloads > r;
      }
      w.progressFail = false;
      const s = await settle(w, src);                                // 下一頁
      const shown = lv(w, K);
      studentWrites(s.pg, w, K, (shown || []).concat([{ name: '新題庫', words: ['x'] }]));
      await s.pg.runTimers(); await s.pg.fire('win:pagehide');
      const cloud = cv(w, K);
      const ok = flagKept && (how === 'Google 讀到' ? backReloaded && !s.reloaded : s.reloaded) && same(shown, phone) && JSON.stringify(cloud).includes('from-phone');
      return { ok, detail: how + ':' + (backReloaded === null ? '' : '回來那頁重載 ' + backReloaded + ' / ') + '下一頁重灌 ' + s.reloaded + ' / 下一頁本機 ' + JSON.stringify(shown) + ' / 寫入後雲端 ' + JSON.stringify(cloud) };
    };
    const rs = [await one('密碼'), await one('Google 讀失敗'), await one('Google 讀到')];
    return { ok: rs.every(r => r.ok), detail: rs.map(r => r.detail).join(' | ') };
  },
  /* 第 2 輪審查(2026-10-31):「帳號資料夾是空的」以前把這一頁確認登入前寫的鍵(early)一律當成不算。
     資料夾本來就有資料、只是剛好每個鍵都在確認登入前重寫過(新學生的資料夾常常只有 hist),會被當成空的、記上「還沒灌過」:
     讀雲端進度失敗時,已登入、本機有完整資料的人被擋下,那一筆也丟掉;另一個早就灌好的分頁一樣被擋下。
     要的是:不記標記,確認前那一筆照常記帳,下一頁雲端留著(e49e444 就是這樣) */
  '56. 帳號資料夾本來就有資料,新分頁確認登入前把每個鍵都重寫過、讀雲端進度失敗:不能當成空的資料夾,確認前那一筆照常記帳、下一頁上雲,另一個灌好的分頁也照常作答': async src => {
    const UNHYD = 'tr_cloud_unhydrated_' + USER.id;
    const ready = pg => (typeof pg.ctx.CLOUD.folderReady === 'function' ? pg.ctx.CLOUD.folderReady() : true);   // 舊版沒有這個函式:當成可以
    /* 甲:這台灌過,資料夾只有 hist(跟雲端一樣);新分頁還在確認登入時作答(根據的是完整的本機資料) */
    const one = async () => {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      w.db.push({ user_id: USER.id, k: 'hist', v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      await openLoggedIn(w, src);
      newSession(w);                                                 // 新分頁
      w.progressFail = true;
      let release; w.authGate = new Promise(r => { release = r; });
      const pg = loadPage(w, src); await tick();
      studentWrites(pg, w, 'hist', (lv(w, 'hist') || []).concat(['early-ok']));
      release(); w.authGate = null; await pg.ready;
      const mark = w.local.getItem(UNHYD), led = Object.keys(JSON.parse(w.local.getItem(LEDGER) || '{}')), can = ready(pg);
      w.progressFail = false;
      await settle(w, src);                                          // 網路好了,下一頁
      const want = FIVE.concat(['early-ok']);
      return { ok: mark === null && led.includes('hist') && can && same(cv(w, 'hist'), want) && same(lv(w, 'hist'), want),
               detail: '只有 hist:標記 ' + mark + ' / 帳本 ' + JSON.stringify(led) + ' / 能作答 ' + can + ' / 下一頁雲端 ' + JSON.stringify(cv(w, 'hist')) + ' / 本機 ' + JSON.stringify(lv(w, 'hist')) };
    };
    /* 乙:另一個分頁 A 早就灌好、一直開著;新分頁 B 確認登入前把 hist、錯題本都重寫過,讀雲端失敗。A 照常作答 */
    const two = async () => {
      const D3 = ['d1', 'd2', 'd3'];
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      w.db.push({ user_id: USER.id, k: 'hist', v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      w.db.push({ user_id: USER.id, k: K, v: D3, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      const sA = w.session;
      const pgA = await openLoggedIn(w, src);
      w.session = makeStorage();                                     // 分頁 B
      w.progressFail = true;
      let release; w.authGate = new Promise(r => { release = r; });
      const pgB = loadPage(w, src); await tick();
      studentWrites(pgB, w, K, (lv(w, K) || []).concat(['early-d']));
      studentWrites(pgB, w, 'hist', (lv(w, 'hist') || []).concat(['early-h']));
      release(); w.authGate = null; await pgB.ready;
      const mark = w.local.getItem(UNHYD), canA = ready(pgA);
      studentWrites(pgA, w, 'hist', (lv(w, 'hist') || []).concat(['A-ans'])); await pgA.runTimers();
      const led = Object.keys(JSON.parse(w.local.getItem(LEDGER) || '{}')).sort();
      w.progressFail = false;
      w.session = sA;
      await settle(w, src);                                          // A 換頁
      const hist = FIVE.concat(['early-h', 'A-ans']), drill = D3.concat(['early-d']);
      return { ok: mark === null && canA && same(cv(w, 'hist'), hist) && same(cv(w, K), drill) && same(lv(w, 'hist'), hist) && same(lv(w, K), drill),
               detail: '另一個灌好的分頁:標記 ' + mark + ' / A 能作答 ' + canA + ' / A 作答後帳本 ' + JSON.stringify(led) + ' / 最後雲端 hist ' + JSON.stringify(cv(w, 'hist')) + '、錯題本 ' + JSON.stringify(cv(w, K)) };
    };
    const a = await one(), b = await two();
    return { ok: a.ok && b.ok, detail: a.detail + ' | ' + b.detail };
  },
  /* 跟 56 同一條(不能把有資料的資料夾當成空的),這次是開頁時資料夾真的是空的:分頁 B 是這台第一次登入、正在讀雲端進度
     (資料夾空的、標記記著),這時開分頁 C;C 還在確認登入時 B 灌好了(資料夾有 hist、標記劃掉)。
     C 確認登入時資料夾已經有東西,不能因為開頁那一刻是空的又記上標記:C 還在讀雲端進度的時候,灌好的 B 照常作答、上雲;
     C 讀到之後灌資料重載,看得到 B 剛答的那一筆。
     (多分頁第 3 輪審查 2026-11-01:以前這裡測的是 C 讀雲端失敗、照常記帳。C 的畫面是照空資料夾畫的,寫作頁這類照畫面整份寫回的鍵
     會把雲端蓋掉,現在 C 自己讀失敗時不能作答,那條改在情境 60 測;這裡留 C 讀得到的那條,請求與儲存跟第 1 步那版逐位元組比) */
  '57. 新分頁開頁時帳號資料夾是空的(別的分頁正在灌),確認登入前那個分頁灌好了:不能再記「還沒灌過」,新分頁讀雲端的時候灌好的分頁照常作答、上雲,新分頁讀到後看得到': async src => {
    const UNHYD = 'tr_cloud_unhydrated_' + USER.id;
    const w = makeWorld(); w.authFromStorage = true; w.rls = true;
    w.db.push({ user_id: USER.id, k: 'hist', v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    const sB = w.session;
    const guest = loadPage(w, src); await guest.ready;             // 分頁 B:訪客頁
    let go; w.progressGate = new Promise(r => { go = r; });
    const loginP = guest.ctx.CLOUD.login('s@x.com', 'test-only').then(() => null, e => e); await tick();
    const markB = w.local.getItem(UNHYD);
    const sC = makeStorage(); w.session = sC;                      // 分頁 C
    let release; w.authGate = new Promise(r => { release = r; });
    const pgC = loadPage(w, src); await tick();
    const emptyAtOpen = lv(w, 'hist') === null;
    go(); await loginP; await tick();                              // B 灌好了、重載
    let goC; w.progressGate = new Promise(r => { goC = r; });
    release(); w.authGate = null; await tick(); await tick();      // C 確認登入,正在讀雲端進度
    w.session = sB;
    const pgB = loadPage(w, src); await pgB.ready;                 // B 重載後的頁面(灌過,不再讀)
    const mark = w.local.getItem(UNHYD), canB = ready(pgB);
    studentWrites(pgB, w, 'hist', (lv(w, 'hist') || []).concat(['b-ans'])); await pgB.runTimers();
    const midCloud = cv(w, 'hist');
    goC(); await pgC.ready;                                        // C 讀到了:灌資料、重載
    w.session = sC;
    const s = await settle(w, src);                                // C 重載後的頁面
    const want = FIVE.concat(['b-ans']);
    return { ok: markB === '1' && emptyAtOpen && mark === null && canB && same(midCloud, want) && same(cv(w, 'hist'), want) && same(lv(w, 'hist'), want) && !s.reloaded,
             detail: 'B 讀的時候標記 ' + markB + ' / C 開頁時空的 ' + emptyAtOpen + ' / C 讀雲端時標記 ' + mark + ' / B 能作答 ' + canB + ' / B 作答後雲端 ' + JSON.stringify(midCloud) +
               ' / C 重載後本機 ' + JSON.stringify(lv(w, 'hist')) + ' / C 再換頁又灌 ' + s.reloaded };
  },
  /* 跟 56、57 反過來:開頁時資料夾還有東西,確認登入之前別的分頁按了登出(資料夾刪光)、又用密碼登回來,登入資料存好了、
     但那個分頁還在查教師身分,還沒走到記「還沒灌過」。這一頁確認登入時資料夾已經空了,要當成空的記上標記,
     不能只看開頁那一刻(不然讀雲端失敗時,這一頁拿空資料夾作答、記帳,下一頁只拿新的那一筆蓋掉雲端的 hist) */
  '58. 新分頁開頁時帳號資料夾還有東西,確認登入前別的分頁登出又登回來(還沒記標記):確認登入時資料夾已經空了,要記「還沒灌過」,讀雲端失敗時作答不記帳,雲端不變少': async src => {
    const UNHYD = 'tr_cloud_unhydrated_' + USER.id;
    const w = makeWorld(); w.authFromStorage = true; w.rls = true;
    w.db.push({ user_id: USER.id, k: 'hist', v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    await openLoggedIn(w, src);
    newSession(w);                                                 // 新分頁:開頁時帳號資料夾有 hist
    let release; w.authGate = new Promise(r => { release = r; });
    const pg = loadPage(w, src); await tick();
    /* 別的分頁:登出(cloud.js logout 刪的那些),又登回來(登入資料存好了,afterAuth 還在查教師身分) */
    const folder = [];
    for (let i = 0; i < w.local.length; i++) { const k = w.local.key(i); if (k.startsWith(PREFIX)) folder.push(k); }
    folder.concat([SB_KEY, LEDGER, SEEN, 'tr_current_profile']).forEach(k => w.local.removeItem(k));   // SEEN:第 3 輪起登出也刪「這台灌過」
    w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'a', expires_at: 1, user: USER }));
    w.progressFail = true;
    release(); w.authGate = null; await pg.ready;
    const mark = w.local.getItem(UNHYD);
    const can = typeof pg.ctx.CLOUD.folderReady === 'function' ? pg.ctx.CLOUD.folderReady() : true;
    studentWrites(pg, w, 'hist', (lv(w, 'hist') || []).concat(['new1'])); await pg.runTimers(); await pg.fire('win:pagehide');
    const led = Object.keys(JSON.parse(w.local.getItem(LEDGER) || '{}'));
    w.progressFail = false;
    await settle(w, src);                                          // 網路好了,下一頁
    return { ok: folder.length > 0 && mark === '1' && !can && !led.includes('hist') && same(cv(w, 'hist'), FIVE) && same(lv(w, 'hist'), FIVE),
             detail: '開頁時資料夾 ' + JSON.stringify(folder.map(k => k.slice(PREFIX.length))) + ' / 標記 ' + mark + ' / 能作答 ' + can + ' / 帳本 ' + JSON.stringify(led) +
               ' / 下一頁雲端 ' + JSON.stringify(cv(w, 'hist')) + ' / 本機 ' + JSON.stringify(lv(w, 'hist')) };
  },
  /* 多分頁第 3 輪審查 #1(2026-11-01):分頁 A 灌過;分頁 B 登出(資料夾刪光)又用密碼登回來、正在讀雲端進度(標記記著、資料夾空的),
     這時 A 換頁:A 的畫面照空資料夾畫(寫作頁的 readMap、作文框都是開頁時讀的)。A 確認登入前 B 先灌好、劃掉標記,
     A 確認登入時標記不在、自己的旗標還在,以前就不灌資料:照空畫面按「標記讀完」整份寫回,雲端 writing_read 從三課變成只剩一課。
     要的是:開頁時資料夾是空的、這台這個帳號也還沒灌過,確認登入時資料夾卻有東西了(別的分頁灌好了),這一頁要重灌重載。
     - 卡在確認登入(authGate)、卡在查教師身分(teacherGate,比較接近真的時序):A 重灌重載,畫面換成灌好的資料夾
     - A 自己讀雲端也失敗:不能作答、不記帳(畫面還是空的),下一頁照常
     - B 第一次也讀失敗、A 換頁時灌不成;之後 B 重新整理灌好、劃掉標記:A 這一頁還是照空畫面,一樣不能作答(不能因為標記劃掉了就放行) */
  '59. 別的分頁登出又登回來、正在灌資料時這個分頁換頁(開頁時帳號資料夾是空的),確認登入前或之後別的分頁先灌好:這一頁照空資料夾畫的,要重灌重載,自己讀不到雲端時不能作答,寫作紀錄不被蓋掉': async src => {
    const READ3 = { l1: true, l2: true, l3: true };
    const one = async how => {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      w.db.push({ user_id: USER.id, k: WR, v: READ3, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      const sA = w.session;
      await openLoggedIn(w, src);                                    // A 灌過(旗標在 A)
      const sB = makeStorage(); w.session = sB;
      let pgB = loadPage(w, src); await pgB.ready; pgB = loadPage(w, src); await pgB.ready;
      await pgB.ctx.CLOUD.logout(); await tick();
      pgB = loadPage(w, src); await pgB.ready;                       // B 訪客頁
      const later = how === 'B 之後才灌好';
      let goB = null;
      if (later) w.progressFail = true; else w.progressGate = new Promise(r => { goB = r; });
      const loginP = pgB.ctx.CLOUD.login('s@x.com', 'test-only').then(() => null, e => e); await tick();
      if (later) await loginP;
      const markB = w.local.getItem(UNHYD);
      w.session = sA;                                                // A 換頁
      let release = null;
      if (how === '卡在查教師身分') w.teacherGate = new Promise(r => { release = r; });
      else if (!later) w.authGate = new Promise(r => { release = r; });
      const pgA = loadPage(w, src); await tick();
      const atLoad = lv(w, WR);                                      // A 的畫面照開頁時的資料夾畫
      if (goB) { goB(); await loginP; await tick(); }                // B 灌好、重載
      if (how === 'A 也讀失敗') w.progressFail = true;
      const r1 = w.reloads;
      if (release) { release(); w.authGate = null; w.teacherGate = null; }
      await pgA.ready; await pgA.runTimers();
      const aReloaded = w.reloads > r1;
      if (later) { w.progressFail = false; w.session = sB; await settle(w, src); w.session = sA; }   // B 重新整理,這次灌好
      const canA = ready(pgA);
      const map = Object.assign({}, atLoad || {}, { l4: true });     // 寫作頁:readMap 是畫面時讀的,按「標記讀完」整份寫回
      const wrote = storeSet(pgA, w, WR, map);
      if (!wrote) pgA.ctx.CLOUD.push(WR, map);                       // common.js 擋下了,cloud.js 這一層也不能記帳
      await pgA.runTimers(); await pgA.fire('win:pagehide');
      const led = Object.keys(JSON.parse(w.local.getItem(LEDGER) || '{}'));
      const mid = cv(w, WR);
      w.progressFail = false;
      const s = await settle(w, src);                                // A 的下一頁
      const shown = lv(w, WR);
      storeSet(s.pg, w, WR, Object.assign({}, shown || {}, { l4: true })); await s.pg.runTimers();
      const end = cv(w, WR);
      const want = Object.assign({}, READ3, { l4: true });
      const okHow = how === 'A 也讀失敗' || later ? !canA && !wrote && !led.includes(WR) : aReloaded;
      return { ok: markB === '1' && atLoad === null && okHow && same(mid, READ3) && same(shown, READ3) && same(end, want),
               detail: how + ':B 讀的時候標記 ' + markB + ' / A 開頁時 ' + JSON.stringify(atLoad) + ' / A 重灌 ' + aReloaded + ' / A 能作答 ' + canA + ' / 寫進去 ' + wrote +
                 ' / 帳本 ' + JSON.stringify(led) + ' / A 作答後雲端 ' + JSON.stringify(mid) + ' / 下一頁本機 ' + JSON.stringify(shown) + ' / 最後雲端 ' + JSON.stringify(end) };
    };
    const rs = [await one('卡在確認登入'), await one('卡在查教師身分'), await one('A 也讀失敗'), await one('B 之後才灌好')];
    return { ok: rs.every(r => r.ok), detail: rs.map(r => r.detail).join(' | ') };
  },
  /* 多分頁第 3 輪審查 #1 同一條,新分頁那一邊(以前情境 57 的後半):分頁 B 這台第一次登入、正在讀雲端進度時開新分頁 C(資料夾空的),
     C 確認登入前 B 灌好了,C 自己讀雲端失敗。C 的畫面照空資料夾畫:以前照常作答記帳,寫作頁整份寫回,下一頁把雲端蓋成只剩 C 那一課。
     要的是:C 不能作答、不記帳;不記「還沒灌過」標記,灌好的 B 照常作答上雲;C 網路好了重新整理,看得到全部 */
  '60. 新分頁開頁時帳號資料夾是空的(別的分頁正在灌),確認登入前那個分頁灌好了、這個新分頁自己讀雲端失敗:新分頁不能作答、不記帳,灌好的分頁照常,寫作紀錄不被蓋掉': async src => {
    const READ3 = { l1: true, l2: true, l3: true };
    const w = makeWorld(); w.authFromStorage = true; w.rls = true;
    w.db.push({ user_id: USER.id, k: WR, v: READ3, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    const sB = w.session;
    const guest = loadPage(w, src); await guest.ready;               // 分頁 B:訪客頁
    let go; w.progressGate = new Promise(r => { go = r; });
    const loginP = guest.ctx.CLOUD.login('s@x.com', 'test-only').then(() => null, e => e); await tick();
    const markB = w.local.getItem(UNHYD);
    const sC = makeStorage(); w.session = sC;                        // 分頁 C
    let release; w.authGate = new Promise(r => { release = r; });
    const pgC = loadPage(w, src); await tick();
    const atLoad = lv(w, WR);
    go(); await loginP; await tick();                                // B 灌好了、重載
    w.progressFail = true;
    release(); w.authGate = null; await pgC.ready;                   // C 讀雲端失敗
    w.session = sB;
    const pgB = loadPage(w, src); await pgB.ready;                   // B 重載後的頁面(灌過,不再讀)
    const mark = w.local.getItem(UNHYD), canC = ready(pgC), canB = ready(pgB);
    const wroteB = storeSet(pgB, w, WR, Object.assign({}, lv(w, WR) || {}, { b1: true })); await pgB.runTimers();
    await new Promise(r => setTimeout(r, 5));                       // C 按下去比 B 上傳晚(同一毫秒的話灌資料時雲端算新,看不出會不會蓋掉)
    const map = Object.assign({}, atLoad || {}, { c1: true });
    const wroteC = storeSet(pgC, w, WR, map);
    if (!wroteC) pgC.ctx.CLOUD.push(WR, map);
    await pgC.runTimers(); await pgC.fire('win:pagehide');
    const led = Object.keys(JSON.parse(w.local.getItem(LEDGER) || '{}'));
    const mid = cv(w, WR);
    w.progressFail = false;
    w.session = sC;
    const s = await settle(w, src);                                  // C 重新整理(網路好了)
    const shown = lv(w, WR);
    storeSet(s.pg, w, WR, Object.assign({}, shown || {}, { c1: true })); await s.pg.runTimers();
    const withB = Object.assign({}, READ3, { b1: true });
    const ok = markB === '1' && atLoad === null && mark === null && !canC && canB && wroteB && !wroteC && !led.includes(WR)
      && s.reloaded && same(mid, withB) && same(shown, withB) && same(cv(w, WR), Object.assign({}, withB, { c1: true }));   // C 自己沒灌成:重新整理時照樣重灌
    return { ok, detail: 'B 讀的時候標記 ' + markB + ' / C 開頁時 ' + JSON.stringify(atLoad) + ' / C 讀失敗後標記 ' + mark + ' / C 能作答 ' + canC + ' / B 能作答 ' + canB +
      ' / C 寫進去 ' + wroteC + ' / 帳本 ' + JSON.stringify(led) + ' / C 作答後雲端 ' + JSON.stringify(mid) + ' / C 重新整理重灌 ' + s.reloaded + ' / C 重新整理後本機 ' + JSON.stringify(shown) + ' / 最後雲端 ' + JSON.stringify(cv(w, WR)) };
  },
  /* 多分頁第 3 輪審查 #3(e49e444 就有):分頁 A 換頁,getSession 已經拿到 X、還在查教師身分;這時分頁 B 按登出(資料夾、帳本、目前帳號、登入資料全刪)。
     以前 A 確認完照樣把目前帳號寫回 X:A 的資料夾對得上、folderReady 是 true,拿被刪空的資料夾作答、記帳(上傳被 RLS 擋下、帳本留著),
     X 之後在這台登入時灌資料把帳本當成本機比較新,整份上傳把雲端錯題本蓋成只剩新那一題;別的沒重載的分頁 C 也跟著又能記帳。
     要的是:A 不寫回目前帳號、不灌資料;A、C 都不能作答、不記帳;X 再登入後雲端還是 5 題 */
  '61. 分頁還在確認登入(查教師身分)時別的分頁登出:確認完不能把目前帳號寫回去,這一頁和其他沒重載的分頁都不能作答、不記帳,原帳號之後在這台登入時雲端不能變少': async src => {
    const w = makeWorld(); w.authFromStorage = true; w.rls = true;
    w.db.push({ user_id: USER.id, k: K, v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
    const sA = w.session;
    await openLoggedIn(w, src);                                      // A 灌過
    w.session = makeStorage();
    let pgC = loadPage(w, src); await pgC.ready; pgC = loadPage(w, src); await pgC.ready;   // C 灌過,之後一直沒重載
    const sB = makeStorage(); w.session = sB;
    let pgB = loadPage(w, src); await pgB.ready; pgB = loadPage(w, src); await pgB.ready;   // B 灌過
    w.session = sA;
    let release; w.teacherGate = new Promise(r => { release = r; });
    const pgA = loadPage(w, src); await tick();                       // A 換頁,卡在查教師身分
    const userA = !!pgA.ctx.CLOUD.user;
    w.session = sB; await pgB.ctx.CLOUD.logout(); await tick();
    pgB = loadPage(w, src); await pgB.ready;                         // B 重載成訪客
    const r0 = w.reloads;
    release(); w.teacherGate = null; await pgA.ready;
    const cp = w.local.getItem('tr_current_profile'), aReloaded = w.reloads > r0;
    const canA = ready(pgA), canC = ready(pgC);
    studentWrites(pgA, w, K, (lv(w, K) || []).concat(['new-q'])); await pgA.runTimers(); await pgA.fire('win:pagehide');
    studentWrites(pgC, w, K, (lv(w, K) || []).concat(['new-c'])); await pgC.runTimers(); await pgC.fire('win:pagehide');
    const led = w.local.getItem(LEDGER);
    w.session = sB;
    pgB = loadPage(w, src); await pgB.ready;                         // B 換頁(還是訪客,或發現資料夾是登出的帳號改回訪客)
    if (pgB.ctx.__PROFILE_ID) { pgB = loadPage(w, src); await pgB.ready; }
    await pgB.ctx.CLOUD.login('s@x.com', 'test-only'); await tick();  // 原帳號之後在這台登入
    await settle(w, src);
    return { ok: userA && cp === null && !aReloaded && !canA && !canC && led === null && same(cv(w, K), FIVE) && same(lv(w, K), FIVE),
             detail: '卡住時 A 已拿到帳號 ' + userA + ' / A 確認後目前帳號 ' + cp + ' / A 重載 ' + aReloaded + ' / A 能作答 ' + canA + ' / C 能作答 ' + canC +
               ' / 帳本 ' + led + ' / 再登入後雲端 ' + JSON.stringify(cv(w, K)) + ' / 本機 ' + JSON.stringify(lv(w, K)) };
  },
  /* 多分頁第 3 輪審查 #4、#5(這個分支新加的回歸):雲端還沒有任何進度的帳號(新註冊、只看後台的老師)灌完資料夾還是空的。
     以前開新分頁時「資料夾是空的」就記「還沒灌過」標記:別的分頁正在灌、或灌失敗時,早就灌好的分頁也被擋下(還說「還沒載入你的練習紀錄」),
     換頁多讀一次、多重載一次;新分頁讀失敗後被關掉,原分頁一直被擋。要的是:這台灌過這個帳號(登出前)就不記標記,跟 e49e444 一樣 */
  '62. 雲端還沒有任何進度的帳號(新註冊、老師帳號):灌好的分頁在別的分頁正在灌、或灌失敗時照常作答、上雲,換頁不多讀、不多重載': async src => {
    const one = async (how, meta) => {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      if (meta) w.db.push({ user_id: USER.id, k: '_meta', v: { email: USER.email }, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      const sA = w.session;
      const pgA = await openLoggedIn(w, src);
      const empty = (() => { for (let i = 0; i < w.local.length; i++) if (w.local.key(i).startsWith(PREFIX)) return false; return true; })();
      const can0 = ready(pgA);
      w.session = makeStorage();                                     // 分頁 B
      let go = null;
      if (how === '讀失敗') w.progressFail = true; else w.progressGate = new Promise(r => { go = r; });
      const pgB = loadPage(w, src); await tick(); await tick();
      const markMid = w.local.getItem(UNHYD), canMid = ready(pgA);
      const wrote = storeSet(pgA, w, 'hist', ['A1']); await pgA.runTimers();
      if (go) go();
      await pgB.ready;
      const markEnd = w.local.getItem(UNHYD), canEnd = ready(pgA);
      w.progressFail = false;
      w.session = sA;
      const f0 = w.fullReads || 0;
      const s = await settle(w, src);                                // A 換頁
      const extra = (w.fullReads || 0) - f0;
      return { ok: empty && can0 && markMid === null && canMid && wrote && markEnd === null && canEnd && !s.reloaded && extra === 0 && same(cv(w, 'hist'), ['A1']) && same(lv(w, 'hist'), ['A1']),
               detail: (meta ? '只有 _meta' : '什麼都沒有') + '、B ' + how + ':A 灌好後資料夾空的 ' + empty + ' 能作答 ' + can0 + ' / B 讀的時候標記 ' + markMid + ' A 能作答 ' + canMid +
                 ' / A 寫進去 ' + wrote + ' / B 讀完標記 ' + markEnd + ' A 能作答 ' + canEnd + ' / A 換頁重灌 ' + s.reloaded + ' 多讀 ' + extra + ' / 雲端 ' + JSON.stringify(cv(w, 'hist')) };
    };
    /* 開頁時資料夾空的(雲端本來就沒進度、這台灌過),確認登入前別的分頁寫了一筆:這一頁的畫面不是照「還沒灌過」的資料夾畫的,
       不用重灌(不多讀、不重載);這時讀雲端又剛好會失敗,也不能被當成沒灌過擋下 */
    const two = async () => {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      const sA = w.session;
      await openLoggedIn(w, src);
      const sD = makeStorage(); w.session = sD;                      // 分頁 D 也灌好了
      let pgD = loadPage(w, src); await pgD.ready; pgD = loadPage(w, src); await pgD.ready;
      w.session = sA;
      let release; w.authGate = new Promise(r => { release = r; });
      const f0 = w.fullReads || 0, r0 = w.reloads;
      const pgA = loadPage(w, src); await tick();                     // A 換頁,還在確認登入
      const wroteD = storeSet(pgD, w, 'hist', ['D1']); await pgD.runTimers();
      w.progressFail = true;
      release(); w.authGate = null; await pgA.ready; await pgA.runTimers();
      const extra = (w.fullReads || 0) - f0, reloaded = w.reloads > r0, can = ready(pgA);
      const wrote = storeSet(pgA, w, 'hist', (lv(w, 'hist') || []).concat(['A1'])); await pgA.runTimers();
      w.progressFail = false;
      return { ok: wroteD && extra === 0 && !reloaded && can && wrote && same(cv(w, 'hist'), ['D1', 'A1']),
               detail: '這一頁確認登入時別的分頁寫了:多讀 ' + extra + ' / 重載 ' + reloaded + ' / A 能作答 ' + can + ' / 雲端 ' + JSON.stringify(cv(w, 'hist')) };
    };
    const rs = [await one('讀失敗', true), await one('還在讀', true), await one('讀失敗', false), await two()];
    return { ok: rs.every(r => r.ok), detail: rs.map(r => r.detail).join(' | ') };
  },
  /* 審查 D(e49e444 就有):帳號層級的動作送出時,supabase-js 用的是這台 localStorage 現在的登入資料,不是這一頁記憶體裡的 CLOUD.user。
     分頁 A 畫面是帳號 X、沒重載,別的分頁登出 X、改登入 Y:A 按「刪除帳號」刪掉的是 Y 的帳號與雲端進度(接著把 Y 登出),
     「登出」「登出所有裝置」登出的是 Y,「改暱稱」「改密碼」改的是 Y,加入班級、老師試用開在 Y 身上。
     要的是:送出前這台的目前帳號(tr_current_profile)與登入資料不是畫面上這個帳號,就一個請求都不送、不問、不重載,丟 code 'account_gone'
     (js/profile.js 開「這個帳號已經在別的分頁登出」卡),本機、分頁暫存、雲端一個字都不動。
     三種:別的分頁換帳號、只登出、剛在別的分頁登入 Y(登入資料已經是 Y,還在查教師身分、目前帳號還沒改)。
     別的分頁登出又登回 X、平常登入著的頁面:照常送,作用在 X 身上 */
  '63. 分頁 A 畫面是帳號 X、沒重載,別的分頁登出 X 改登入 Y(或只登出、或剛登入 Y):A 按刪除帳號、登出、登出所有裝置、改暱稱、改密碼、加入班級、老師試用、付款,一個請求都不送,什麼都不動;登回 X、平常登入著照常送': async src => {
    const ACTS = {
      刪除帳號: C => C.deleteAccount(),
      登出: C => C.logout(),
      登出所有裝置: C => C.logout({ everywhere: true }),
      改暱稱: C => C.updateName('新暱稱'),
      改密碼: C => C.updatePassword('new-pass-123'),
      加入班級: C => C.joinClass('ABCD2345'),
      老師試用: C => C.startTeacherTrial(10, '週六班'),
      付款: C => C.startCheckout('student_month', '2026-11-01T01:30:00.000Z'),
    };
    const who = id => (id === USER.id ? 'X' : id === OTHER_USER.id ? 'Y' : String(id));
    /* A 灌過、之後一直沒重載;另一個分頁 B 照 how 改這台的登入 */
    const setup = async how => {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true; w.withToken = true;
      w.db.push({ user_id: USER.id, k: K, v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      w.db.push({ user_id: OTHER_USER.id, k: K, v: ['y1'], updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      const sA = w.session;
      const pgA = await openLoggedIn(w, src);
      if (how === '剛登入 Y') w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'b', user: OTHER_USER }));   // B(訪客畫面)送出 Y 的密碼,還在查教師身分
      else if (how !== '平常') {
        w.session = makeStorage();
        let pgB = loadPage(w, src); await pgB.ready; pgB = loadPage(w, src); await pgB.ready;   // B 也灌過
        await pgB.ctx.CLOUD.logout(); await tick();
        pgB = loadPage(w, src); await pgB.ready;                       // B 重載成訪客
        const as = how === '換帳號' ? OTHER_USER : how === '登回 X' ? USER : null;
        if (as) { w.loginAs = as; await pgB.ctx.CLOUD.login(as.email, 'test-only'); await tick(); w.loginAs = null; }
        w.session = sA;
      }
      return { w, pgA };
    };
    const run = async (how, act) => {
      const { w, pgA } = await setup(how);
      const n = k => (w[k] || []).length;
      const n0 = { rpcs: n('rpcs'), authCalls: n('authCalls'), signOutAs: n('signOutAs'), fetches: n('fetches'), signOutCalls: w.signOutCalls || 0 };
      const before = snapshot(w), r0 = w.reloads, c0 = w.confirms.length;
      let err = null;
      try { await ACTS[act](pgA.ctx.CLOUD); } catch (e) { err = e; }
      await tick();
      const sent = [].concat(
        (w.rpcs || []).slice(n0.rpcs).map(x => x.fn + '@' + who(x.as)),
        (w.authCalls || []).slice(n0.authCalls).map(x => x.op + '@' + who(x.as)),
        (w.signOutAs || []).slice(n0.signOutAs).map(x => 'signOut@' + who(x)),
        (w.fetches || []).slice(n0.fetches).map(x => 'checkout@' + who(x.as)));
      return { how, act, err: err ? (err.code || '') + ':' + err.message : '', code: err && err.code, sent, same: snapshot(w) === before, reloaded: w.reloads > r0, asked: w.confirms.length > c0,
        signOutCalls: (w.signOutCalls || 0) - n0.signOutCalls, cleared: xGone(w) };
    };
    const bad = [];
    for (const how of ['換帳號', '只登出', '剛登入 Y']) {
      for (const act of Object.keys(ACTS)) {
        const r = await run(how, act);
        /* 只登出、按「登出」:這台已經沒有任何人登入著(目前帳號、登入資料都刪了),不會登出到別人。照 e49e444 清掉 X 留在這台的東西
           (這裡 B 登出時已經刪光了,剩 A 這個分頁的灌過旗標)、重載,但不呼叫 signOut(審查 D 第 1 輪 #1、#3,情境 64) */
        if (how === '只登出' && act === '登出') {
          if (!(!r.err && !r.sent.length && !r.signOutCalls && r.cleared && r.reloaded && !r.asked)) bad.push(r);
          continue;
        }
        if (!(r.code === 'account_gone' && !r.sent.length && r.same && !r.reloaded && !r.asked)) bad.push(r);
      }
    }
    /* 有還沒同步的進度、問「確定要登出？」的時候別的分頁換成 Y(登入資料、目前帳號都是 Y):按確定之後也不能登出 Y、不刪 X 這台的進度 */
    {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      w.db.push({ user_id: USER.id, k: K, v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      const pgA = await openLoggedIn(w, src);
      w.offline = true; w.lieFi = true;
      studentWrites(pgA, w, K, FIVE.concat(['off-1'])); await pgA.runTimers();   // 傳不上去,帳本記著
      const yPid = 'c' + OTHER_USER.id.replace(/-/g, '');
      w.onConfirm = () => { w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'b', user: OTHER_USER })); w.local.setItem('tr_current_profile', JSON.stringify(yPid)); };
      const c0 = w.confirms.length, r0 = w.reloads, o0 = (w.signOutAs || []).length;
      let err = null;
      try { await pgA.ctx.CLOUD.logout(); } catch (e) { err = e; }
      await tick();
      const r = { how: '問的時候換帳號', act: '登出', err: err ? (err.code || '') + ':' + err.message : '', sent: (w.signOutAs || []).slice(o0).map(x => 'signOut@' + who(x)),
        same: (storedUser(w) || {}).id === OTHER_USER.id && w.local.getItem('tr_current_profile') === JSON.stringify(yPid) && same(lv(w, K), FIVE.concat(['off-1'])) && w.local.getItem(LEDGER) !== null,
        reloaded: w.reloads > r0, asked: w.confirms.length > c0 };
      if (!(err && err.code === 'account_gone' && !r.sent.length && r.same && !r.reloaded && r.asked)) bad.push(r);
    }
    for (const how of ['平常', '登回 X']) {
      for (const act of Object.keys(ACTS)) {
        const r = await run(how, act);
        if (r.err || !r.sent.length || !r.sent.every(s => /@X$/.test(s))) bad.push(r);
      }
    }
    return { ok: !bad.length, detail: bad.length ? '不對的 ' + bad.length + ' 項:' + bad.map(r => r.how + '/' + r.act + ' 送了 ' + (r.sent.join(',') || '沒有') + ' 錯誤 ' + (r.err || '沒有') + ' 沒動 ' + r.same + ' 重載 ' + r.reloaded + ' 問了 ' + r.asked).join(' | ')
      : '換帳號、只登出、剛登入 Y × 8 個動作都沒送、什麼都沒動(只登出時按登出:不呼叫 signOut,清掉 X 留在這台的、重載);平常、登回 X 都照常送到 X' };
  },
  /* 審查 D 第 1 輪 #1、#3(31745ec 新造成的):X 的登入被撤銷(別台按「登出所有裝置」、帳號刪除),supabase-js 清掉這台的登入資料;
     別的分頁開頁照 leaveStaleAccount 改回訪客(目前帳號刪掉,X 的資料夾、帳本照設計留著)。沒重載的分頁 A 按「登出」:
     31745ec 當成「別的分頁換人了」擋下(account_gone),X 的進度、自訂題庫、帳本留在這台(共用電腦),之後沒有按鈕能刪(訪客頁沒有登出)。
     這時這台沒有任何人登入著,不會登出到別人。要的是:跟 e49e444 一樣清掉 X 留在這台的東西、重載,有沒同步的進度照樣先問、按取消什麼都不刪;
     但不呼叫 signOut、不動登入資料與目前帳號(別的分頁可能正要登入別人)。問的時候別的分頁登入了 Y:照樣擋下(account_gone)、什麼都不刪。
     「登出所有裝置」照樣擋(情境 63)。對照:沒有別的分頁改回訪客(目前帳號還是 X)時,跟 e49e444 一樣照常登出 */
  '64. 登入被撤銷、別的分頁已經改回訪客之後,沒重載的分頁按「登出」:這台沒有任何人登入著,清掉這個帳號留在這台的資料夾與帳本、重載,不呼叫 signOut;有沒同步的先問,問的時候別人登入了就擋下': async src => {
    const HIST = ['h1', 'h2'];
    const yPid = 'c' + OTHER_USER.id.replace(/-/g, '');
    const one = async how => {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      w.db.push({ user_id: USER.id, k: K, v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      const sA = w.session;
      const pgA = await openLoggedIn(w, src);
      studentWrites(pgA, w, 'hist', HIST); await pgA.runTimers();   // 這台的作答紀錄(上傳完,帳本劃掉)
      if (how !== '沒有沒同步的' && how !== '對照:沒有別的分頁') { w.offline = true; w.lieFi = true; studentWrites(pgA, w, K, FIVE.concat(['off-1'])); await pgA.runTimers(); w.offline = false; w.lieFi = false; }
      w.local.removeItem(SB_KEY); w.revoked = true;                   // 別台按「登出所有裝置」:supabase-js 清掉這台的登入資料
      if (how !== '對照:沒有別的分頁') {
        w.session = makeStorage();
        const pgB = loadPage(w, src); await pgB.ready;               // 分頁 B 開頁:leaveStaleAccount 刪掉目前帳號、重載成訪客
        w.session = sA;
      }
      const cp0 = w.local.getItem('tr_current_profile'), folder0 = lv(w, 'hist'), led0 = w.local.getItem(LEDGER);
      if (how === '有沒同步的、按取消') w.confirmAnswer = false;
      if (how === '問的時候別人登入') w.onConfirm = () => { w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'b', user: OTHER_USER })); w.local.setItem('tr_current_profile', JSON.stringify(yPid)); };
      const c0 = w.confirms.length, r0 = w.reloads, s0 = w.signOutCalls || 0;
      let err = null;
      try { await pgA.ctx.CLOUD.logout(); } catch (e) { err = e; }
      await tick();
      const hadLed = how !== '沒有沒同步的' && how !== '對照:沒有別的分頁';
      const r = { how, cp0, had: same(folder0, HIST) && (hadLed ? led0 !== null : led0 === null), err: err ? (err.code || '') + ':' + err.message : '',
        asked: w.confirms.length > c0, reloaded: w.reloads > r0, signOutCalls: (w.signOutCalls || 0) - s0, gone: xGone(w),
        kept: same(lv(w, 'hist'), HIST) && w.local.getItem(LEDGER) === led0,
        y: (storedUser(w) || {}).id === OTHER_USER.id && w.local.getItem('tr_current_profile') === JSON.stringify(yPid), sb: w.local.getItem(SB_KEY) };
      const want = {
        沒有沒同步的: !r.err && !r.asked && r.reloaded && !r.signOutCalls && r.gone && r.sb === null,
        '有沒同步的、按確定': !r.err && r.asked && r.reloaded && !r.signOutCalls && r.gone && r.sb === null,
        '有沒同步的、按取消': !r.err && r.asked && !r.reloaded && !r.signOutCalls && r.kept,
        問的時候別人登入: !!err && err.code === 'account_gone' && r.asked && !r.reloaded && !r.signOutCalls && r.kept && r.y,
        '對照:沒有別的分頁': !r.err && !r.asked && r.reloaded && r.gone && r.sb === null,
      }[how];
      r.ok = r.had && (how === '對照:沒有別的分頁' ? cp0 !== null : cp0 === null) && want;
      return r;
    };
    const rs = [];
    for (const how of ['沒有沒同步的', '有沒同步的、按確定', '有沒同步的、按取消', '問的時候別人登入', '對照:沒有別的分頁']) rs.push(await one(how));
    return { ok: rs.every(r => r.ok), detail: rs.map(r => r.how + ':' + (r.ok ? '對' : '不對 ' + JSON.stringify(r))).join(' | ') };
  },
  /* 審查 D 第 1 輪 #2(e49e444 就有;這個分支 73900cf 加的「灌過」記號把 4ea2c29 已經擋住的又打開):部署前就開著的舊版分頁
     (tools/fixtures/cloud_step1.js;e49e444 的登出一樣)不認得 tr_cloud_seen_<帳號 id>,在那裡按登出:資料夾、帳本、目前帳號刪光,記號留著。
     之後 X 在這台用新版登入、讀雲端進度失敗(網路斷一下、Supabase 休眠):以前看到記號就不記「還沒灌過」,學生在空資料夾上作答、記帳,
     網路好了下一頁整份上傳,雲端錯題本從五題變成只剩新那一題。要的是:剛登入(fresh)或這一頁的資料夾不是這個帳號的(Google 回來)時,
     「灌過」記號不算數(先刪掉,灌好再寫),照樣記標記、不能作答、不記帳,雲端不變少。
     丙:別的分頁正在登回來灌資料時這個分頁換頁(開頁時資料夾空的),確認登入前那個分頁灌好了:這一頁的畫面照空資料夾畫,要重灌重載(情境 59 那條,舊版登出之後也要成立) */
  '65. 舊版分頁登出(留下「灌過」記號)之後,這個帳號在這台用新版登入、讀雲端進度失敗:照樣記「還沒灌過」、不能作答、不記帳,雲端不變少;那時換頁的分頁照空資料夾畫的要重灌': async src => {
    const OLDSRC = fs.readFileSync(path.join(REPO, 'tools', 'fixtures', 'cloud_step1.js'), 'utf8');
    const READ3 = { l1: true, l2: true, l3: true };
    /* 舊版分頁 O、新版分頁 N 都灌好(N 寫下「灌過」記號),然後在 O 按登出。回 N 的工作階段與記號前後 */
    const base = async () => {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      w.db.push({ user_id: USER.id, k: K, v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      w.db.push({ user_id: USER.id, k: WR, v: READ3, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      const sO = w.session;
      const pgO = await openLoggedIn(w, OLDSRC);
      const sN = makeStorage(); w.session = sN;
      let pgN = loadPage(w, src); await pgN.ready; pgN = loadPage(w, src); await pgN.ready;
      const seen0 = w.local.getItem(SEEN);
      w.session = sO; await pgO.ctx.CLOUD.logout(); await tick();
      return { w, sN, seen0, seenLeft: w.local.getItem(SEEN), cpLeft: w.local.getItem('tr_current_profile') };
    };
    /* 讀不到雲端的那一頁(學生按「重新整理」)作答,網路好了再開一頁 */
    const after = async (w, how, b) => {
      const mark = w.local.getItem(UNHYD);
      const pg = loadPage(w, src); await pg.ready;
      const can = ready(pg);
      const v = (lv(w, K) || []).concat(['new1']);
      const wrote = storeSet(pg, w, K, v);
      if (!wrote) pg.ctx.CLOUD.push(K, v);                          // common.js 擋下了,cloud.js 這一層也不能記帳
      await pg.runTimers(); await pg.fire('win:pagehide');
      const led = Object.keys(JSON.parse(w.local.getItem(LEDGER) || '{}'));
      w.progressFail = false;
      await settle(w, src);
      const ok = b.seen0 === '1' && b.seenLeft === '1' && b.cpLeft === null && mark === '1' && !can && !wrote && !led.includes(K) && same(cv(w, K), FIVE) && same(lv(w, K), FIVE);
      return { ok, detail: how + ':舊版登出後記號 ' + b.seenLeft + ' / 標記 ' + mark + ' / 能作答 ' + can + ' / 寫進去 ' + wrote + ' / 帳本 ' + JSON.stringify(led) + ' / 下一頁雲端 ' + JSON.stringify(cv(w, K)) };
    };
    /* 甲:訪客頁用密碼登入(fresh) */
    const a = await (async () => {
      const b = await base(); const w = b.w;
      w.session = makeStorage();
      const guest = loadPage(w, src); await guest.ready;
      w.progressFail = true;
      const err = await guest.ctx.CLOUD.login('s@x.com', 'test-only').then(() => null, e => e);
      const r = await after(w, '密碼登入', b);
      return { ok: !!err && r.ok, detail: r.detail + ' / 登入丟錯 ' + !!err };
    })();
    /* 乙:Google 回來(開頁時登入資料已經是 X、資料夾是訪客的:otherFolder) */
    const g = await (async () => {
      const b = await base(); const w = b.w;
      w.session = makeStorage();
      w.local.setItem(SB_KEY, JSON.stringify({ access_token: 'g', expires_at: 1, user: USER }));
      w.progressFail = true;
      const back = loadPage(w, src); await back.ready;
      return after(w, 'Google 回來', b);
    })();
    /* 丙:分頁 B 密碼登入、正在讀雲端進度(標記記著、資料夾空的);N 換頁(N 自己的旗標還在),確認登入前 B 灌好了 */
    const c = await (async () => {
      const b = await base(); const w = b.w;
      const sB = makeStorage(); w.session = sB;
      const guest = loadPage(w, src); await guest.ready;
      let goB; w.progressGate = new Promise(r => { goB = r; });
      const loginP = guest.ctx.CLOUD.login('s@x.com', 'test-only').then(() => null, e => e); await tick();
      const markB = w.local.getItem(UNHYD);
      w.session = b.sN;
      let release; w.authGate = new Promise(r => { release = r; });
      const pgN = loadPage(w, src); await tick();
      const atLoad = lv(w, WR);
      goB(); await loginP; await tick();                             // B 灌好、重載
      const r1 = w.reloads;
      release(); w.authGate = null; await pgN.ready; await pgN.runTimers();
      const nReloaded = w.reloads > r1;
      const map = Object.assign({}, atLoad || {}, { l4: true });     // 寫作頁:照畫面時讀的 readMap 整份寫回
      const wrote = storeSet(pgN, w, WR, map);
      if (!wrote) pgN.ctx.CLOUD.push(WR, map);
      await pgN.runTimers(); await pgN.fire('win:pagehide');
      const mid = cv(w, WR);
      const s = await settle(w, src);
      storeSet(s.pg, w, WR, Object.assign({}, lv(w, WR) || {}, { l4: true })); await s.pg.runTimers();
      const want = Object.assign({}, READ3, { l4: true });
      return { ok: b.seenLeft === '1' && markB === '1' && atLoad === null && nReloaded && same(mid, READ3) && same(cv(w, WR), want),
               detail: '換頁:B 讀的時候標記 ' + markB + ' / N 開頁時 ' + JSON.stringify(atLoad) + ' / N 重灌 ' + nReloaded + ' / N 作答後雲端 ' + JSON.stringify(mid) + ' / 最後雲端 ' + JSON.stringify(cv(w, WR)) };
    })();
    return { ok: a.ok && g.ok && c.ok, detail: a.detail + ' | ' + g.detail + ' | ' + c.detail };
  },
  /* 審查 D 第 2 輪 #1(e49e444 就有,情境 61 沒蓋到的那一條):分頁 A 灌過(旗標在 A),換到新的一頁 P,P 還在確認登入(查教師身分)。
     這時分頁 B 登出 X(資料夾、帳本、灌過記號、目前帳號都刪掉),又用同一個帳號 X 登回來,B 也還在查教師身分、還沒記「還沒灌過」標記。
     以前 P 確認完:登入資料是 X 就當成「登回同一個帳號」放行(情境 58 是沒有旗標的新分頁),旗標在、標記沒記,P 不灌資料、照常作答記帳:
     - P 確認前作答過:early 那一筆照樣記帳,init 最後補傳讀到被刪掉的鍵,雲端 hist 被蓋成 null,B 灌資料也拿到 null
     - P 確認後才作答:照被刪空的資料夾寫成只有新那一筆,上傳蓋掉雲端;B 看到資料夾不是空的不記標記,B 讀雲端失敗時下一頁也不擋
     要的是:確認登入途中目前帳號被換過(登出又登回同一帳號),P 照新分頁的規則重灌:讀得到就重載(確認前那一筆作廢),
     讀不到就不能作答、不記帳(B 之後灌好了也一樣);雲端 hist 一直是 5 筆。對照:別的分頁沒動,P 照常不重灌、能作答、上雲 */
  '66. 灌過的分頁換頁、還在確認登入時別的分頁登出又登回同一個帳號:這一頁要照新分頁重灌,讀不到雲端時不能作答、不記帳,雲端練習紀錄不能被蓋成 null 或只剩新那一筆': async src => {
    const one = async how => {
      const relogin = how !== '別的分頁沒動', earlyWrite = /確認前/.test(how), pFail = /讀不到/.test(how), bFail = /B 也讀不到/.test(how);
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      w.db.push({ user_id: USER.id, k: 'hist', v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      const sA = w.session;
      await openLoggedIn(w, src);                                    // A 灌過(旗標在 A)
      const sB = makeStorage(); w.session = sB;
      let pgB = loadPage(w, src); await pgB.ready; pgB = loadPage(w, src); await pgB.ready;   // B 灌過
      w.session = sA;
      let relP; w.teacherGate = new Promise(r => { relP = r; });
      const pgP = loadPage(w, src); await tick();                    // A 換頁成 P,卡在查教師身分
      const early = earlyWrite ? storeSet(pgP, w, 'hist', (lv(w, 'hist') || []).concat(['early1'])) : null;
      let relB = null, loginP = null;
      if (relogin) {
        w.session = sB; await pgB.ctx.CLOUD.logout(); await tick();
        pgB = loadPage(w, src); await pgB.ready;                     // B 訪客頁
        w.teacherGate = new Promise(r => { relB = r; });
        loginP = pgB.ctx.CLOUD.login('s@x.com', 'test-only').then(() => null, e => e); await tick();   // B 登回 X,還在查教師身分
      }
      w.session = sA;
      if (pFail) w.progressFail = true;
      const r0 = w.reloads;
      relP(); if (!relogin) w.teacherGate = null;
      await pgP.ready; await pgP.runTimers();
      const pReloaded = w.reloads > r0, canP = ready(pgP);
      let wrote = null;
      if (!earlyWrite) {
        const v = (lv(w, 'hist') || []).concat(['new1']);
        wrote = storeSet(pgP, w, 'hist', v);
        if (!wrote) pgP.ctx.CLOUD.push('hist', v);                   // common.js 擋下了,cloud.js 這一層也不能記帳
      }
      await pgP.runTimers(); await pgP.fire('win:pagehide');
      const led = Object.keys(JSON.parse(w.local.getItem(LEDGER) || '{}'));
      const mid = cv(w, 'hist');
      let markB = null;
      if (relB) {
        if (!bFail) w.progressFail = false;
        w.session = sB; relB(); w.teacherGate = null; await loginP; await tick();   // B 確認完、灌資料
        markB = w.local.getItem(UNHYD);
      }
      const canPLater = ready(pgP);
      w.progressFail = false;
      w.session = relogin ? sB : sA;
      await settle(w, src);                                          // 網路好了,下一頁
      const end = cv(w, 'hist'), local = lv(w, 'hist');
      let ok;
      if (!relogin) ok = !pReloaded && canP && wrote === true && !led.includes('hist') && same(end, FIVE.concat(['new1'])) && same(local, end);
      else if (pFail) ok = !pReloaded && !canP && !canPLater && wrote !== true && !led.includes('hist') && same(mid, FIVE) && (!bFail || markB === '1') && same(end, FIVE) && same(local, FIVE);
      else ok = pReloaded && wrote !== true && same(mid, FIVE) && same(end, FIVE) && same(local, FIVE);
      return { ok, detail: how + ':P 確認前寫進去 ' + early + ' / P 重灌 ' + pReloaded + ' / P 能作答 ' + canP + ' / 確認後寫進去 ' + wrote + ' / 帳本 ' + JSON.stringify(led) +
        ' / P 之後雲端 ' + JSON.stringify(mid) + (relogin ? ' / B 灌完標記 ' + markB + ' / 那時 P 能作答 ' + canPLater : '') + ' / 最後雲端 ' + JSON.stringify(end) + ' / 本機 ' + JSON.stringify(local) };
    };
    const rs = [];
    for (const how of ['別的分頁沒動', '確認前作答、P 讀得到', '確認前作答、P 讀不到', '確認後作答、P 讀得到', '確認後作答、P 讀不到、B 也讀不到']) rs.push(await one(how));
    return { ok: rs.every(r => r.ok), detail: rs.map(r => r.detail).join(' | ') };
  },
  /* 審查 D 第 3 輪 #1(be7104d 造成,73900cf、31745ec 沒有):雲端還沒有進度的帳號(新註冊、只看後台的老師),分頁 A 登入、灌好
     (資料夾還是空的)。分頁 B 是 A 登入之前就開著的訪客頁(頂欄還是「登入」),在 B 用密碼再登入同一個帳號。
     be7104d 起「剛登入、訪客頁登入」一律先刪掉「灌過」記號,資料夾又是空的,就記上「還沒灌過」標記:
     B 還在讀雲端時 A 不能作答;B 讀失敗時 A 一直卡在「還沒載入」卡,換頁也一樣,要等讀得到雲端才恢復(e49e444 照常作答、上雲)。
     要的是:A 照常作答、上雲,換頁不多讀、不重載、照常作答,標記一直沒記。
     情境 65(舊版分頁登出留下記號)那一條照樣要擋:舊版登出會刪掉目前帳號,所以確認登入那一刻這個帳號不是這台的目前帳號時才刪記號 */
  '67. 雲端還沒有進度的帳號,灌好的分頁開著時,在登入前就開著的訪客頁再登入同一個帳號(還在讀雲端、或讀失敗):灌好的分頁照常作答、上雲,換頁不多讀、不重載': async src => {
    const one = async how => {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      const pgB = loadPage(w, src); await pgB.ready;                 // B:A 登入之前就開著的訪客頁
      const sA = makeStorage(); w.session = sA;
      const guestA = loadPage(w, src); await guestA.ready;
      await guestA.ctx.CLOUD.login('s@x.com', 'test-only');          // A 登入、灌資料(雲端沒有進度)、重載
      guestA.close();
      const pgA = loadPage(w, src); await pgA.ready; await pgA.runTimers();
      const bGuest = pgB.ctx.CLOUD.user === null && pgB.ctx.__PROFILE_ID === null, can0 = ready(pgA);
      let go = null;
      if (how === '讀失敗') w.progressFail = true; else w.progressGate = new Promise(r => { go = r; });
      const loginP = pgB.ctx.CLOUD.login('s@x.com', 'test-only').then(() => 'ok', () => 'err'); await tick();
      const markMid = w.local.getItem(UNHYD), canMid = ready(pgA);
      const wrote = storeSet(pgA, w, 'hist', ['a1']); await pgA.runTimers();
      const mid = cv(w, 'hist');
      if (go) go();
      const res = await loginP; await tick();
      const markEnd = w.local.getItem(UNHYD), canEnd = ready(pgA);
      w.session = sA;
      const f0 = w.fullReads || 0;
      const s = await settle(w, src);                                // A 換頁(讀失敗那一種:雲端還是讀不到)
      const extra = (w.fullReads || 0) - f0, canNav = ready(s.pg);
      const wrote2 = storeSet(s.pg, w, 'hist', (lv(w, 'hist') || []).concat(['a2'])); await s.pg.runTimers();
      w.progressFail = false;
      const end = cv(w, 'hist');
      return { ok: bGuest && can0 && markMid === null && canMid && wrote && same(mid, ['a1']) && markEnd === null && canEnd && !s.reloaded && extra === 0 && canNav && wrote2 && same(end, ['a1', 'a2']) && same(lv(w, 'hist'), end),
               detail: 'B ' + how + ':B 是訪客頁 ' + bGuest + ' / A 能作答 ' + can0 + ' / B 登入後標記 ' + markMid + ' A 能作答 ' + canMid + ' / A 寫進去 ' + wrote + ' 雲端 ' + JSON.stringify(mid) +
                 ' / B 登入 ' + res + ' 標記 ' + markEnd + ' A 能作答 ' + canEnd + ' / A 換頁重灌 ' + s.reloaded + ' 多讀 ' + extra + ' 能作答 ' + canNav + ' 寫進去 ' + wrote2 + ' / 雲端 ' + JSON.stringify(end) };
    };
    const rs = [await one('還在讀'), await one('讀失敗')];
    return { ok: rs.every(r => r.ok), detail: rs.map(r => r.detail).join(' | ') };
  },
  /* 審查 D 第 3 輪 #2(e49e444 就有,73900cf 的 59 沒有補完):帳號在雲端只有一個整份上傳的鍵(只用過寫作頁的新學生,雲端只有 writing_read={l1,l2,l3})。
     分頁 A 灌過;分頁 B 登出又登回同一個帳號,正在讀雲端(標記記著、資料夾空的)。A 換頁成 P(開頁時資料夾空的、沒有「灌過」記號:照空資料夾畫),
     P 還在確認登入(getSession)時學生按了「標記讀完」,寫作頁照開頁時的空畫面寫 {l4}(在 B 灌好之前或之後)。
     以前 P 確認登入時,資料夾唯一的鍵是 P 自己確認前寫過的,不算「別的分頁灌好了」,P 不重灌:確認前那一筆記帳,
     之後照記憶體裡的 {l4} 整份寫回 {l4,l5},雲端 {l1,l2,l3} 被蓋掉(P 是新分頁、自己讀雲端又失敗時一樣能作答、記帳)。
     要的是:B 灌好一定會寫「灌過」記號,P 開頁時沒有、確認時有,就是別的分頁灌好了:P 重灌重載(確認前那一筆作廢),讀不到雲端時不能作答、不記帳;
     而且 P 讀不到時這個分頁下一頁也要重灌(確認前那一筆可能已經蓋掉 B 灌好的本機那一份),學生在下一頁照常作答,雲端 l1~l3 都還在 */
  '68. 雲端只有一個整份上傳的鍵,別的分頁登出又登回來、正在灌時換頁,確認登入前照空畫面寫過那個鍵:要重灌,讀不到雲端時不能作答、下一頁也重灌,雲端寫作紀錄不被蓋掉': async src => {
    const READ3 = { l1: true, l2: true, l3: true };
    const one = async (order, pFlag, pFail) => {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      w.db.push({ user_id: USER.id, k: WR, v: READ3, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      const sA = w.session;
      await openLoggedIn(w, src);                                    // A 灌過(旗標在 A)
      const sB = makeStorage(); w.session = sB;
      let pgB = loadPage(w, src); await pgB.ready; pgB = loadPage(w, src); await pgB.ready;
      await pgB.ctx.CLOUD.logout(); await tick();
      pgB = loadPage(w, src); await pgB.ready;                       // B 訪客頁
      let goB; w.progressGate = new Promise(r => { goB = r; });
      const loginP = pgB.ctx.CLOUD.login('s@x.com', 'test-only').then(() => null, e => e); await tick();   // B 登回來,讀雲端卡住
      const sP = pFlag ? sA : makeStorage();
      w.session = sP;
      let release; w.authGate = new Promise(r => { release = r; });
      const pgP = loadPage(w, src); await tick();                    // P 卡在 getSession
      const atLoad = lv(w, WR);
      const map1 = Object.assign({}, atLoad || {}, { l4: true });    // 寫作頁:readMap 是開頁時讀的
      let early;
      if (order === 'P 先寫') { early = storeSet(pgP, w, WR, map1); goB(); await loginP; await tick(); }
      else { goB(); await loginP; await tick(); early = storeSet(pgP, w, WR, map1); }
      if (pFail) w.progressFail = true;
      const r0 = w.reloads;
      release(); w.authGate = null;
      await pgP.ready; await pgP.runTimers();
      const pReloaded = w.reloads > r0, canP = ready(pgP);
      let wrote = null;
      if (!pReloaded) {
        const map2 = Object.assign({}, map1, { l5: true });          // 照記憶體整份寫回
        wrote = storeSet(pgP, w, WR, map2);
        if (!wrote) pgP.ctx.CLOUD.push(WR, map2);                    // common.js 擋下了,cloud.js 這一層也不能記帳
      }
      await pgP.runTimers(); await pgP.fire('win:pagehide');
      const mid = cv(w, WR);
      const led = Object.keys(JSON.parse(w.local.getItem(LEDGER) || '{}'));
      w.progressFail = false;
      w.session = sP;
      const s = await settle(w, src);                                // 這個分頁的下一頁(網路好了)
      const next = lv(w, WR);
      const wrote3 = storeSet(s.pg, w, WR, Object.assign({}, next || {}, { l6: true })); await s.pg.runTimers();
      const end = cv(w, WR), want = Object.assign({}, READ3, { l6: true });
      const ok = early === true && atLoad === null && (pFail ? !pReloaded && !canP && wrote === false && !led.includes(WR) : pReloaded) && same(mid, READ3)
        && same(next, READ3) && wrote3 && same(end, want);
      return { ok, detail: [order, pFlag ? '有旗標' : '新分頁', pFail ? 'P 讀不到' : 'P 讀得到'].join('/') + ':P 開頁 ' + JSON.stringify(atLoad) + ' / 確認前寫進去 ' + early +
        ' / P 重灌 ' + pReloaded + ' 能作答 ' + canP + ' / 再寫進去 ' + wrote + ' / 帳本 ' + JSON.stringify(led) + ' / P 之後雲端 ' + JSON.stringify(mid) +
        ' / 下一頁重灌 ' + s.reloaded + ' 本機 ' + JSON.stringify(next) + ' / 最後雲端 ' + JSON.stringify(end) };
    };
    const rs = [];
    for (const order of ['P 先寫', 'B 先灌'])
      for (const [pFlag, pFail] of [[true, false], [true, true], [false, false], [false, true]]) rs.push(await one(order, pFlag, pFail));
    return { ok: rs.every(r => r.ok), detail: rs.map(r => r.detail).join(' | ') };
  },
  /* 審查 D 第 4 輪 #1(e49e444 就有;5aff2d5 擋得住,49a5080 又打開):舊版分頁 O 和新版分頁 A 都灌好(A 寫了「灌過」記號),O 按登出:
     資料夾、目前帳號刪光,記號留著。學生在新版的訪客頁 N 用密碼登入同一個帳號,N 卡在查教師身分,讀雲端進度失敗。
     甲:A 換頁成 P、P 也卡在查教師身分,P 先確認完(走 moved:確認途中有人登出又登回同一帳號),把目前帳號寫回去;
     乙:另一個舊版分頁 O2 在 N 送出登入之後換頁(舊版 afterAuth 一律先寫回目前帳號);
     N 確認時目前帳號已經是它(wasCurrent),49a5080 就不刪記號、也不記「還沒灌過」:N 分頁和 A 分頁各換一頁(還是讀不到),
     照空資料夾作答記帳,網路好了整份上傳,雲端 hist 5 筆變成只剩新的那兩筆。
     要的是:moved 時記號不可信、一樣刪;N 送出登入那一刻這個帳號就不是這台的目前帳號,記號也不算數(不管確認時是誰寫回去的)。
     記上「還沒灌過」,N、A 兩個分頁換頁都不能作答、不記帳,雲端 5 筆不變。丙(對照):N 先確認,49a5080 就擋得住 */
  '69. 舊版分頁登出後,同一個帳號在新版訪客頁登入、還在確認登入時別的分頁先把目前帳號寫回去(灌過的分頁換頁先確認完、或舊版分頁換頁),讀雲端失敗:照樣記「還沒灌過」、換頁都不能作答,雲端練習紀錄不變少': async src => {
    const OLDSRC = fs.readFileSync(path.join(REPO, 'tools', 'fixtures', 'cloud_step1.js'), 'utf8');
    const one = async how => {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      w.db.push({ user_id: USER.id, k: 'hist', v: FIVE, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      const sO = w.session;
      const pgO = await openLoggedIn(w, OLDSRC);                     // 舊版分頁 O 灌好
      let sO2 = null;
      if (how === '舊版分頁換頁') { sO2 = makeStorage(); w.session = sO2; await loadPage(w, OLDSRC).ready; await loadPage(w, OLDSRC).ready; }   // 舊版分頁 O2 也灌好
      const sA = makeStorage(); w.session = sA;
      let pgA = loadPage(w, src); await pgA.ready; pgA = loadPage(w, src); await pgA.ready;   // 新版分頁 A 灌好,寫下記號
      const seen0 = w.local.getItem(SEEN);
      let relP = null, pgP = null;
      if (how !== '舊版分頁換頁') { w.teacherGate = new Promise(r => { relP = r; }); pgP = loadPage(w, src); await tick(); }   // A 換頁成 P,卡在查教師身分
      w.session = sO; await pgO.ctx.CLOUD.logout(); await tick();    // 舊版登出:資料夾、目前帳號刪光,記號留著
      const seenLeft = w.local.getItem(SEEN), cpLeft = w.local.getItem('tr_current_profile');
      const sN = makeStorage(); w.session = sN; w.teacherGate = null;
      const guestN = loadPage(w, src); await guestN.ready;           // 新版訪客頁 N
      let relN; w.teacherGate = new Promise(r => { relN = r; });
      w.progressFail = true;
      const loginN = guestN.ctx.CLOUD.login('s@x.com', 'test-only').then(() => null, e => e); await tick();   // N 卡在查教師身分
      if (how === 'P 先確認') { w.session = sA; relP(); await pgP.ready; }
      if (how === '舊版分頁換頁') { const g = w.teacherGate; w.teacherGate = null; w.session = sO2; await loadPage(w, OLDSRC).ready; w.teacherGate = g; }
      const cpBeforeN = w.local.getItem('tr_current_profile');
      w.session = sN; relN(); const err = await loginN; await tick(); w.teacherGate = null;
      if (how === 'N 先確認') { w.session = sA; relP(); await pgP.ready; }
      const mark = w.local.getItem(UNHYD);
      /* N 分頁、A 分頁各換一頁(雲端還是讀不到),照常作答 */
      const tryWrite = async (session, tag) => {
        w.session = session;
        const pg = loadPage(w, src); await pg.ready; await pg.runTimers();
        const can = ready(pg), v = (lv(w, 'hist') || []).concat([tag]);
        const wrote = storeSet(pg, w, 'hist', v);
        if (!wrote) pg.ctx.CLOUD.push('hist', v);                    // common.js 擋下了,cloud.js 這一層也不能記帳
        await pg.runTimers(); await pg.fire('win:pagehide');
        return { can, wrote };
      };
      const n = await tryWrite(sN, 'newN'), a = await tryWrite(sA, 'newA');
      const led = Object.keys(JSON.parse(w.local.getItem(LEDGER) || '{}'));
      w.progressFail = false;
      w.session = sN;
      await settle(w, src);                                          // 網路好了,下一頁
      const end = cv(w, 'hist'), local = lv(w, 'hist');
      const ok = seen0 === '1' && seenLeft === '1' && cpLeft === null && (how === 'N 先確認' || cpBeforeN === JSON.stringify(PID)) && !!err
        && mark === '1' && !n.can && !n.wrote && !a.can && !a.wrote && !led.includes('hist') && same(end, FIVE) && same(local, FIVE);
      return { ok, detail: how + ':舊版登出後記號 ' + seenLeft + ' 目前帳號 ' + cpLeft + ' / N 確認前目前帳號 ' + cpBeforeN + ' / N 登入丟錯 ' + !!err + ' / 標記 ' + mark +
        ' / N 換頁能作答 ' + n.can + ' 寫進去 ' + n.wrote + ' / A 換頁能作答 ' + a.can + ' 寫進去 ' + a.wrote + ' / 帳本 ' + JSON.stringify(led) +
        ' / 最後雲端 ' + JSON.stringify(end) + ' / 本機 ' + JSON.stringify(local) };
    };
    const rs = [await one('P 先確認'), await one('舊版分頁換頁'), await one('N 先確認')];
    return { ok: rs.every(r => r.ok), detail: rs.map(r => r.detail).join(' | ') };
  },
  /* 審查 D 第 4 輪 #2(e49e444 就有,49a5080 的 68 只修了一半):情境 68 的「B 先灌」,P 確認前照開頁時的空畫面寫了 {l4},
     把 B 灌好的本機那一份({l1,l2,l3})蓋掉;P 確認時重灌,但讀不到雲端,P 被擋下,本機還是 {l4}。
     49a5080 只讓 P 這個分頁的下一頁重灌,讀得到雲端才有用:
     甲:P 分頁的下一頁還是讀不到:沒有「還沒灌過」標記、開頁時有記號,照 {l4} 作答記帳,網路好了整份上傳,雲端只剩 {l4,l5}
     乙:B 分頁換頁(網路好了):B 有旗標、不重灌,照 {l4} 作答直接上傳,雲端的 l1~l3 不見
     要的是:filled、而且這一頁確認前寫過,就記上「還沒灌過」:之後哪一頁灌成功(本機換回雲端那一份)之前,所有分頁都不能作答、不記帳 */
  '70. 確認登入前照空畫面寫過、蓋掉別的分頁剛灌好的本機那一份,這一頁讀雲端又失敗:這個分頁下一頁還是讀不到、或灌好的那個分頁換頁,都不能照被蓋掉的本機作答,雲端寫作紀錄不被蓋掉': async src => {
    const READ3 = { l1: true, l2: true, l3: true };
    const keep3 = v => !!v && ['l1', 'l2', 'l3'].every(k => v[k] === true);
    const one = async (pFlag, then) => {
      const w = makeWorld(); w.authFromStorage = true; w.rls = true;
      w.db.push({ user_id: USER.id, k: WR, v: READ3, updated_at: new Date(Date.now() - 24 * HOUR).toISOString() });
      const sA = w.session;
      await openLoggedIn(w, src);                                    // A 灌過(旗標在 A)
      const sB = makeStorage(); w.session = sB;
      let pgB = loadPage(w, src); await pgB.ready; pgB = loadPage(w, src); await pgB.ready;
      await pgB.ctx.CLOUD.logout(); await tick();
      pgB = loadPage(w, src); await pgB.ready;                       // B 訪客頁
      let goB; w.progressGate = new Promise(r => { goB = r; });
      const loginB = pgB.ctx.CLOUD.login('s@x.com', 'test-only').then(() => null, e => e); await tick();   // B 登回來,讀雲端卡住
      const sP = pFlag ? sA : makeStorage();
      w.session = sP;
      let release; w.authGate = new Promise(r => { release = r; });
      const pgP = loadPage(w, src); await tick();                    // P 卡在 getSession,開頁時資料夾是空的
      const atLoad = lv(w, WR);
      w.session = sB; goB(); await loginB; await tick();             // B 灌好(本機三課)、重載
      const filledB = lv(w, WR);
      w.session = sP;
      const early = storeSet(pgP, w, WR, Object.assign({}, atLoad || {}, { l4: true }));   // 寫作頁照開頁時的空畫面整份寫回:蓋掉 B 灌好的那一份
      w.progressFail = true;
      release(); w.authGate = null;
      await pgP.ready; await pgP.runTimers();
      const canP = ready(pgP);
      await pgP.fire('win:pagehide');
      const mark = w.local.getItem(UNHYD);
      if (then === 'B 分頁換頁') { w.progressFail = false; w.session = sB; } else w.session = sP;
      const s = await settle(w, src);
      const shown = lv(w, WR), canNext = ready(s.pg);
      const v = Object.assign({}, shown || {}, { l5: true });
      const wrote = storeSet(s.pg, w, WR, v);
      if (!wrote) s.pg.ctx.CLOUD.push(WR, v);                        // common.js 擋下了,cloud.js 這一層也不能記帳
      await s.pg.runTimers(); await s.pg.fire('win:pagehide');
      const mid = cv(w, WR);
      w.progressFail = false;
      w.session = sP;
      const s2 = await settle(w, src);                               // 網路好了,P 分頁再開一頁
      const next = lv(w, WR);
      const wrote3 = storeSet(s2.pg, w, WR, Object.assign({}, next || {}, { l6: true })); await s2.pg.runTimers();
      const end = cv(w, WR);
      const ok = atLoad === null && same(filledB, READ3) && early === true && !canP && mark === '1'
        && (then === 'B 分頁換頁' ? s.reloaded && keep3(shown) && canNext && wrote : !canNext && !wrote)
        && keep3(mid) && keep3(next) && wrote3 && keep3(end) && end.l6 === true;
      return { ok, detail: (pFlag ? 'P 有旗標' : 'P 新分頁') + '/' + then + ':P 開頁 ' + JSON.stringify(atLoad) + ' / B 灌好 ' + JSON.stringify(filledB) + ' / P 確認前寫進去 ' + early +
        ' / P 能作答 ' + canP + ' / 標記 ' + mark + ' / 下一頁重灌 ' + s.reloaded + ' 看到 ' + JSON.stringify(shown) + ' 能作答 ' + canNext + ' 寫進去 ' + wrote +
        ' / 之後雲端 ' + JSON.stringify(mid) + ' / 網路好了本機 ' + JSON.stringify(next) + ' / 最後雲端 ' + JSON.stringify(end) };
    };
    const rs = [];
    for (const pFlag of [true, false]) for (const then of ['P 下一頁也讀不到', 'B 分頁換頁']) rs.push(await one(pFlag, then));
    return { ok: rs.every(r => r.ok), detail: rs.map(r => r.detail).join(' | ') };
  },
};
const FIVE = ['q1', 'q2', 'q3', 'q4', 'q5'];
const PID = 'c' + USER.id.replace(/-/g, '');
const FLAG = 'tr_cloud_hydrated_' + USER.id;
const OTHER_USER = { id: '9a9a9a9a-1111-4222-8333-444455556666', email: 'o@x.com', user_metadata: {} };
const hasAll = (v, want) => Array.isArray(v) && want.every(x => v.includes(x));
const UNHYD = 'tr_cloud_unhydrated_' + USER.id;   // 「這台帳號資料夾還沒灌過」標記
const SEEN = 'tr_cloud_seen_' + USER.id;          // 「這台灌過這個帳號」(第 3 輪起,登出刪掉)
const WR = 'writing_read';                        // 寫作頁:畫面時讀的 readMap,按「標記讀完」整份寫回(整份上傳的鍵)
/* 這一頁能不能作答(js/cloud.js folderReady;舊版沒有這個函式就當成可以) */
const ready = pg => (typeof pg.ctx.CLOUD.folderReady === 'function' ? pg.ctx.CLOUD.folderReady() : true);
/* 跟 js/common.js 的 store.set 一樣先問 accountBlock:別的分頁登出、換帳號(folderGone),或已登入但 folderReady 說還不能用、頁面正要重載,
   就不寫本機也不 push(回 false);不然跟 studentWrites 一樣寫本機再 push */
function storeSet(pg, w, k, v) {
  const C = pg.ctx.CLOUD, id = pg.ctx.__PROFILE_ID;
  const gone = typeof id === 'string' && id.charAt(0) === 'c' && w.local.getItem('tr_current_profile') !== JSON.stringify(id);
  if (gone || C.reloading || (C.user && typeof C.folderReady === 'function' && !C.folderReady())) return false;
  studentWrites(pg, w, k, v);
  return true;
}
/* X 留在這台的東西都清掉了:帳號資料夾、帳本、只在本機的標記、灌過記號、還沒灌過標記,和現在這個分頁的灌過旗標(情境 63、64) */
function xGone(w) {
  for (let i = 0; i < w.local.length; i++) if (w.local.key(i).startsWith(PREFIX)) return false;
  return [LEDGER, 'tr_localonly_' + USER.id, SEEN, UNHYD].every(k => w.local.getItem(k) === null) && w.session.getItem(FLAG) === null;
}
/* 開一頁;這一頁灌了資料要重載就再開一次(重載後的那一頁)。回 { pg, reloaded } */
async function settle(w, src) {
  const r0 = w.reloads;
  let pg = loadPage(w, src); await pg.ready; await pg.runTimers();
  const reloaded = w.reloads > r0;
  if (reloaded) { pg.close(); pg = loadPage(w, src); await pg.ready; await pg.runTimers(); }
  return { pg, reloaded };
}

/* 本機、分頁暫存、雲端全部轉成字串(比對「什麼都沒寫」用) */
function snapshot(w) {
  const dump = s => { const o = {}; for (let i = 0; i < s.length; i++) { const k = s.key(i); o[k] = s.getItem(k); } return JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]])); };
  return dump(w.local) + '|' + dump(w.session) + '|' + JSON.stringify(w.db);
}

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
