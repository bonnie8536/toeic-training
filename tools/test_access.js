/* 收費的使用權層(js/cloud.js 的 my_access 部分與 js/plans-config.js):用假的 Supabase 跑。
   重點:付費牆的開關沒開時一次都不呼叫 my_access;呼叫失敗、逾時、讀快取都不能把人鎖住。
   用法:node tools/test_access.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'js', 'cloud.js'), 'utf8');
const PLANS_SRC = fs.readFileSync(path.join(REPO, 'js', 'plans-config.js'), 'utf8');
const PRICING = fs.readFileSync(path.join(REPO, 'pricing.html'), 'utf8');

const USER = { id: '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72', email: 's@x.com', created_at: '2026-10-07T03:00:00Z', user_metadata: { name: '學生' } };
const SB_KEY = 'sb-x-auth-token';
const CACHE = 'tr_access_' + USER.id;
const MIN = 60e3, DAY = 864e5;

function makeStorage(broken) {
  const m = new Map();
  const no = () => { if (broken) throw new Error('QuotaExceededError'); };
  return {
    getItem: k => { if (broken === 'all') no(); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (broken && /^tr_access_/.test(k)) no(); m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    key: i => { const a = Array.from(m.keys()); return i < a.length ? a[i] : null; },
    get length() { return m.size; },
  };
}

/* access:my_access 的回應。{ data } / 'error' / 'nodata' / 'hang' / 'throw' / 'reject' */
function makeWorld(o) {
  return Object.assign({ local: makeStorage(o && o.brokenStorage), session: makeStorage(), offline: false, reloads: 0,
    rpc: [], teachers: [], access: 'nodata', paid: undefined, pending: [] }, o || {});
}
function makeClient(w) {
  return {
    auth: {
      getSession: async () => (w.offline ? { data: { session: null }, error: { message: 'TypeError: Failed to fetch' } }
        : { data: { session: w.local.getItem(SB_KEY) ? { user: USER } : null } }),
      signInWithPassword: async () => { w.local.setItem(SB_KEY, JSON.stringify({ user: USER })); return { data: { user: USER }, error: null }; },
      signOut: async () => ({ error: null }),
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    },
    rpc(fn, args) {
      w.rpc.push([fn, args]);
      if (fn !== 'my_access') {
        const r = w.other && w.other[fn];
        return Promise.resolve(r || { data: null, error: null });
      }
      const a = w.access;
      if (a === 'throw') throw new Error('boom');
      if (a === 'reject') return Promise.reject(new Error('TypeError: Failed to fetch'));
      if (a === 'hang') return new Promise(() => {});
      if (a === 'error') return Promise.resolve({ data: null, error: { message: 'Could not find the function public.my_access without parameters in the schema cache', code: 'PGRST202' } });
      if (a === 'nodata') return Promise.resolve({ data: null, error: null });
      if (a === 'deferred') return new Promise(r => w.pending.push(d => r({ data: JSON.parse(JSON.stringify(d.data)), error: null })));
      return Promise.resolve(w.accessFirst ? { data: JSON.parse(JSON.stringify(a.data)), error: null } : new Promise(r => setImmediate(() => r({ data: JSON.parse(JSON.stringify(a.data)), error: null }))));
    },
    from(table) {
      const b = { select() { return b; }, eq() { return b; }, upsert() { return b; }, then(ok, bad) { return run().then(ok, bad); } };
      async function run() {
        if (w.offline) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
        if (table === 'teachers') {
          if (w.accessFirst) await new Promise(r => setTimeout(r, 5));   // 教師查詢比 my_access 晚回來
          return { data: w.teachers.slice(), error: null };
        }
        return { data: [], error: null };
      }
      return b;
    },
  };
}
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

function loadPage(w) {
  const timers = new Map(); let tid = 0;
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    setTimeout: (fn, ms) => { const id = ++tid; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => { timers.delete(id); },
    localStorage: w.local, sessionStorage: w.session,
    location: { hash: '', search: '', pathname: '/me.html', origin: 'https://x', href: 'https://x/me.html', reload() { w.reloads++; } },
    history: { replaceState() {} },
    document: { visibilityState: 'visible', addEventListener() {}, createElement() { return {}; }, head: { appendChild() {} } },
    confirm: () => true,
    navigator: { get onLine() { return !w.offline; } },
    addEventListener() {},
  };
  ctx.window = ctx;
  ctx.CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'k' };
  ctx.supabase = { createClient: () => makeClient(w) };
  if (w.paid !== undefined) ctx.PAID_UI = w.paid;
  try { ctx.__PROFILE_ID = JSON.parse(w.local.getItem('tr_current_profile')) || null; } catch (e) { ctx.__PROFILE_ID = null; }
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return {
    ctx, C: ctx.CLOUD,
    ready: ctx.CLOUD.ready.then(tick),
    /* 只觸發「逾時」那種計時器(上傳的去抖動 0.8 秒不動) */
    async fireTimeouts() { for (const [id, t] of [...timers]) { if (t.ms > 1000) { timers.delete(id); t.fn(); } } await tick(); },
  };
}
/* 已登入、這個分頁已灌過資料的情況(重載後那一頁) */
function loggedIn(w) {
  w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
  w.local.setItem(SB_KEY, JSON.stringify({ user: USER }));
  w.session.setItem('tr_cloud_hydrated_' + USER.id, '1');
  return w;
}
const ACTIVE = { data: { active: true, until: null, source: 'legacy', is_owner: false, is_teacher: false, role: 'student', teacher_trial_available: true, server_now: '2026-10-07T03:00:00Z', classes: [] } };
const EXPIRED = { data: { active: false, until: null, source: 'none', is_owner: false, is_teacher: false, role: 'student', trial_until: '2026-10-05T00:00:00Z', paid_through: null, server_now: '2026-10-07T03:00:00Z', classes: [] } };
const calls = w => w.rpc.filter(c => c[0] === 'my_access').length;

const cases = {
  '開關沒開(PAID_UI false):登入、灌資料、重載,一次都不呼叫 my_access,教師身分照舊看 teachers': async () => {
    const w = makeWorld({ paid: false, teachers: [{ user_id: USER.id }], access: ACTIVE });
    w.local.setItem(SB_KEY, JSON.stringify({ user: USER }));
    const p1 = loadPage(w); await p1.ready;            // 第一次開:灌資料後重載
    const p2 = loadPage(w); await p2.ready;            // 重載後那一頁
    const r = await p2.C.accessReady;
    return { ok: calls(w) === 0 && w.reloads === 1 && p2.C.isTeacher === true && p2.C.access === null && r === null && p2.C.locked() === false,
      detail: 'my_access ' + calls(w) + ' 次 / 重載 ' + w.reloads + ' / isTeacher ' + p2.C.isTeacher };
  },
  '沒載入 plans-config(PAID_UI 未定義):也不呼叫': async () => {
    const w = loggedIn(makeWorld({ access: ACTIVE }));
    const p = loadPage(w); await p.ready; await p.C.accessReady;
    await p.C.refreshAccess();
    return { ok: calls(w) === 0 && p.C.locked() === false, detail: 'my_access ' + calls(w) + ' 次' };
  },
  '開關打開:登入灌資料那一頁呼叫 1 次、重載後那一頁再 1 次': async () => {
    const w = makeWorld({ paid: true, access: ACTIVE });
    w.local.setItem(SB_KEY, JSON.stringify({ user: USER }));
    const p1 = loadPage(w); await p1.ready; const n1 = calls(w);
    const p2 = loadPage(w); await p2.ready; await p2.C.accessReady; const n2 = calls(w);
    return { ok: n1 === 1 && n2 === 2 && w.reloads === 1 && p2.C.access && p2.C.access.active === true, detail: '重載前 ' + n1 + ' / 重載後累計 ' + n2 };
  },
  'my_access 回錯誤(資料庫還沒有這個函式):放行,教師身分退回看 teachers': async () => {
    const w = loggedIn(makeWorld({ paid: true, access: 'error', teachers: [{ user_id: USER.id }] }));
    const p = loadPage(w); await p.ready; const r = await p.C.accessReady;
    return { ok: r === null && p.C.access === null && p.C.locked() === false && p.C.isTeacher === true, detail: 'locked ' + p.C.locked() + ' / isTeacher ' + p.C.isTeacher };
  },
  'my_access 沒回資料:放行': async () => {
    const w = loggedIn(makeWorld({ paid: true, access: 'nodata' }));
    const p = loadPage(w); await p.ready; const r = await p.C.accessReady;
    return { ok: r === null && p.C.locked() === false, detail: 'locked ' + p.C.locked() };
  },
  'my_access 丟例外或 promise 失敗:放行,登入照常完成': async () => {
    const out = [];
    for (const mode of ['throw', 'reject']) {
      const w = loggedIn(makeWorld({ paid: true, access: mode }));
      const p = loadPage(w); const u = await p.C.ready; await p.ready; const r = await p.C.accessReady;
      out.push(u && u.id === USER.id && r === null && p.C.locked() === false);
    }
    return { ok: out.every(Boolean), detail: out.join(',') };
  },
  'my_access 一直沒回應:登入不等它,逾時後放行': async () => {
    const w = loggedIn(makeWorld({ paid: true, access: 'hang' }));
    const p = loadPage(w);
    const u = await p.C.ready;                          // 不會被卡住
    let settled = false; p.C.accessReady.then(() => { settled = true; });
    await tick();
    const before = settled;
    await p.fireTimeouts();
    return { ok: u && u.id === USER.id && before === false && settled === true && p.C.locked() === false && p.C.access === null,
      detail: '逾時前 accessReady ' + (before ? '已結束' : '等待中') + ' / 逾時後 ' + (settled ? '已結束' : '等待中') + ' / locked ' + p.C.locked() };
  },
  '伺服器明確回 active false:才鎖': async () => {
    const w = loggedIn(makeWorld({ paid: true, access: EXPIRED }));
    const p = loadPage(w); await p.ready; await p.C.accessReady;
    return { ok: p.C.locked() === true, detail: 'locked ' + p.C.locked() };
  },
  'active true:不鎖': async () => {
    const w = loggedIn(makeWorld({ paid: true, access: ACTIVE }));
    const p = loadPage(w); await p.ready; await p.C.accessReady;
    return { ok: p.C.locked() === false && p.C.access.source === 'legacy', detail: 'locked ' + p.C.locked() };
  },
  '開關關著時,就算有東西把 access 設成 active false 也不鎖': async () => {
    const w = loggedIn(makeWorld({ paid: false }));
    const p = loadPage(w); await p.ready;
    p.C.access = { active: false };
    return { ok: p.C.locked() === false, detail: 'locked ' + p.C.locked() };
  },
  '成功後存快取;離線開 App 讀得到快取(只顯示日期),但快取是 active false 也不鎖': async () => {
    const w = loggedIn(makeWorld({ paid: true, access: EXPIRED }));
    const p1 = loadPage(w); await p1.ready; await p1.C.accessReady;
    const saved = JSON.parse(w.local.getItem(CACHE));
    w.offline = true;
    const p2 = loadPage(w); await p2.ready; const r = await p2.C.accessReady;
    const cached = p2.C.cachedAccess();
    return { ok: saved && saved.access && saved.access.active === false && p2.C.user && r === null && p2.C.access === null
      && cached && cached.active === false && p2.C.locked() === false && calls(w) === 1,
      detail: '快取 ' + (saved ? 'active ' + saved.access.active : '無') + ' / 離線 locked ' + p2.C.locked() + ' / cachedAccess ' + (cached ? 'active ' + cached.active : 'null') };
  },
  '快取壞掉、寫不進去、讀了會丟例外:都不影響登入與判斷': async () => {
    const w1 = loggedIn(makeWorld({ paid: true, access: ACTIVE, brokenStorage: true }));
    const p1 = loadPage(w1); await p1.ready; await p1.C.accessReady;
    const w2 = loggedIn(makeWorld({ paid: true, access: 'error' }));
    w2.local.setItem(CACHE, '{壞掉');
    const p2 = loadPage(w2); await p2.ready; await p2.C.accessReady;
    return { ok: p1.C.access && p1.C.access.active === true && p1.C.locked() === false && p2.C.cachedAccess() === null && p2.C.locked() === false,
      detail: '寫不進去 access ' + (p1.C.access && p1.C.access.active) + ' / 壞快取 ' + p2.C.cachedAccess() };
  },
  '拿到 my_access 後教師身分只看 is_teacher(被改成學生的人 teachers 列還在);教師查詢比較晚回來也一樣': async () => {
    const demoted = { data: Object.assign({}, ACTIVE.data, { is_teacher: false, role: 'student' }) };
    const w1 = loggedIn(makeWorld({ paid: true, access: demoted, teachers: [{ user_id: USER.id }] }));
    const p1 = loadPage(w1); await p1.ready; await p1.C.accessReady;
    const w2 = loggedIn(makeWorld({ paid: true, access: demoted, teachers: [{ user_id: USER.id }], accessFirst: true }));
    const p2 = loadPage(w2); await p2.ready; await p2.C.accessReady; await new Promise(r => setTimeout(r, 20)); await tick();
    const teacher = { data: Object.assign({}, ACTIVE.data, { is_teacher: true, role: 'teacher' }) };
    const w3 = loggedIn(makeWorld({ paid: true, access: teacher, teachers: [] }));
    const p3 = loadPage(w3); await p3.ready; await p3.C.accessReady;
    return { ok: p1.C.isTeacher === false && p2.C.isTeacher === false && p3.C.isTeacher === true,
      detail: '一般 ' + p1.C.isTeacher + ' / 教師查詢晚回 ' + p2.C.isTeacher + ' / 自助老師 ' + p3.C.isTeacher };
  },
  'refreshAccess:跟著伺服器最新的回答;重新查失敗時保留上一次的回答': async () => {
    const w = loggedIn(makeWorld({ paid: true, access: ACTIVE }));
    const p = loadPage(w); await p.ready; await p.C.accessReady;
    const a = p.C.locked();
    w.access = EXPIRED; await p.C.refreshAccess(); const b = p.C.locked();
    w.access = 'error'; const r = await p.C.refreshAccess(); const c = p.C.locked();
    w.access = ACTIVE; await p.C.refreshAccess(); const d = p.C.locked();
    return { ok: a === false && b === true && r === null && c === true && d === false && calls(w) === 4, detail: [a, b, c, d].join(' → ') };
  },
  '包裝函式:參數照資料庫函式的名字傳,資料庫的中文錯誤原樣丟出(句尾補句號),連不上改說網路': async () => {
    const w = loggedIn(makeWorld({ paid: false, other: {
      join_class: { data: '晨讀班', error: null },
      start_teacher_trial: { data: null, error: { message: '老師試用每個帳號只能開始一次' } },
      my_billing: { data: null, error: { message: 'TypeError: Failed to fetch' } },
    } }));
    const p = loadPage(w); await p.ready;
    const name = await p.C.joinClass('ABCD2345');
    let e1 = '', e2 = '';
    try { await p.C.startTeacherTrial(30, '週六班'); } catch (e) { e1 = e.message; }
    try { await p.C.myBilling(); } catch (e) { e2 = e.message; }
    const j = w.rpc.find(c => c[0] === 'join_class'), s = w.rpc.find(c => c[0] === 'start_teacher_trial');
    return { ok: name === '晨讀班' && j[1].p_code === 'ABCD2345' && s[1].p_seats === 30 && s[1].p_class_name === '週六班'
      && e1 === '老師試用每個帳號只能開始一次。' && /網路/.test(e2) && calls(w) === 0,
      detail: name + ' | ' + e1 + ' | ' + e2 };
  },
  '包裝函式:沒登入不呼叫': async () => {
    const w = makeWorld({ paid: true, offline: true });
    const p = loadPage(w); await p.ready;
    let m = '';
    try { await p.C.joinClass('ABCD2345'); } catch (e) { m = e.message; }
    return { ok: /登入/.test(m) && w.rpc.length === 0, detail: m };
  },
  '註冊意向:30 分鐘內、這次才建立的帳號(Email 對得上)、資料庫說可以試用,三個都成立才自動開': async () => {
    const C = loadPage(makeWorld()).C;
    const now = Date.parse('2026-10-07T03:10:00Z');
    const fresh = { seats: 30, name: '週六班', at: now - 12 * MIN, email: 'S@x.com' };
    const newUser = Object.assign({}, USER, { created_at: new Date(now - 11 * MIN).toISOString() });
    const ok = C.trialIntentOk(fresh, newUser, { teacher_trial_available: true }, now);
    return { ok: ok === true, detail: String(ok) };
  },
  '帶著舊意向登入既有帳號:不自動開': async () => {
    const C = loadPage(makeWorld()).C;
    const now = Date.parse('2026-10-07T03:10:00Z');
    const intent = { seats: 10, name: '', at: now - 5 * MIN, email: 's@x.com' };
    const oldUser = Object.assign({}, USER, { created_at: '2026-09-01T00:00:00Z' });
    const r = C.trialIntentOk(intent, oldUser, { teacher_trial_available: true }, now);
    return { ok: r === false, detail: String(r) };
  },
  '超過 30 分鐘的意向、資料庫說不能試用、還不知道使用權、意向格式不對:都不自動開': async () => {
    const C = loadPage(makeWorld()).C;
    const now = Date.parse('2026-10-07T03:10:00Z');
    const u = Object.assign({}, USER, { created_at: new Date(now - 40 * MIN).toISOString() });
    const r = [
      C.trialIntentOk({ seats: 10, name: '', email: 's@x.com', at: now - 31 * MIN }, u, { teacher_trial_available: true }, now),
      C.trialIntentOk({ seats: 10, name: '', email: 's@x.com', at: now - 1 * MIN }, Object.assign({}, USER, { created_at: new Date(now).toISOString() }), { teacher_trial_available: false }, now),
      C.trialIntentOk({ seats: 10, name: '', email: 's@x.com', at: now - 1 * MIN }, Object.assign({}, USER, { created_at: new Date(now).toISOString() }), null, now),
      C.trialIntentOk({ seats: 25, name: '', email: 's@x.com', at: now - 1 * MIN }, Object.assign({}, USER, { created_at: new Date(now).toISOString() }), { teacher_trial_available: true }, now),
      C.trialIntentOk({ seats: 10, email: 's@x.com', at: now + 60 * MIN }, Object.assign({}, USER, { created_at: new Date(now).toISOString() }), { teacher_trial_available: true }, now),
      C.trialIntentOk(null, USER, { teacher_trial_available: true }, now),
      C.trialIntentOk({ seats: 10, email: 's@x.com', at: now - MIN }, { id: 'x' }, { teacher_trial_available: true }, now),
    ];
    return { ok: r.every(x => x === false), detail: r.join(',') };
  },
  '註冊意向綁在帳號上:Email 不同、舊格式沒有 Email 的都不開;Google 那條只認這個分頁 sessionStorage 裡的': async () => {
    const now = Date.parse('2026-10-07T03:10:00Z');
    const u = Object.assign({}, USER, { created_at: new Date(now - 5 * MIN).toISOString() });
    const ok = { teacher_trial_available: true };
    const w = makeWorld(); const C = loadPage(w).C;
    const other = C.trialIntentOk({ seats: 30, name: 'A 的班', email: 'a@x.com', at: now - 20 * MIN }, u, ok, now);
    const noMail = C.trialIntentOk({ seats: 30, name: 'A 的班', at: now - 20 * MIN }, u, ok, now);
    const forged = C.trialIntentOk({ seats: 30, at: now - 20 * MIN, _session: true }, u, ok, now);   // 直接傳進來的不算數
    /* 存與讀:有 Email 的放 localStorage,Google(沒有 Email)放 sessionStorage */
    C.saveSignupIntent({ seats: 30, name: '週六班', email: 'S@X.com' }, now - 10 * MIN);
    const savedMail = JSON.parse(w.local.getItem('tr_signup_intent'));
    const tookMail = C.takeSignupIntent();
    const mailOk = C.trialIntentOk(tookMail, u, ok, now);
    const leftMail = w.local.getItem('tr_signup_intent');
    C.saveSignupIntent({ seats: 10, name: '' }, now - 10 * MIN);
    const inLocal = w.local.getItem('tr_signup_intent');
    const tookG = C.takeSignupIntent();
    const gOk = C.trialIntentOk(tookG, u, ok, now);
    const leftG = w.session.getItem('tr_signup_intent');
    /* 有人在 localStorage 塞一個沒有 Email、標成 _session 的意向:讀出來也不算 Google 那條 */
    w.local.setItem('tr_signup_intent', JSON.stringify({ seats: 10, at: now - MIN, _session: true }));
    const fake = C.trialIntentOk(C.takeSignupIntent(), u, ok, now);
    return { ok: other === false && noMail === false && forged === false && savedMail.email === 's@x.com' && mailOk === true && leftMail === null
      && inLocal === null && gOk === true && leftG === null && fake === false,
      detail: ['別人的 Email ' + other, '沒有 Email ' + noMail, '偽造 ' + forged, 'Email 那條 ' + mailOk, 'Google 那條 ' + gOk, 'localStorage 偽造 ' + fake].join(' / ') };
  },
  '選學生註冊:先清掉這台留著的老師意向(A 選老師去收信,B 接著用學生註冊,B 不會變老師)': async () => {
    const now = Date.parse('2026-10-07T03:10:00Z');
    const w = makeWorld(); const C = loadPage(w).C;
    C.saveSignupIntent({ seats: 30, name: 'A 的班', email: 'a@x.com' }, now - 20 * MIN);
    C.saveSignupIntent({ seats: 10, name: '' }, now - 20 * MIN);
    C.clearSignupIntent();
    const t = C.takeSignupIntent();
    return { ok: t === null && w.local.getItem('tr_signup_intent') === null && w.session.getItem('tr_signup_intent') === null, detail: String(t) };
  },
  '快取只存顯示日期要用的欄位:班名、點數、角色、教師欄位都不存': async () => {
    const full = { data: Object.assign({}, EXPIRED.data, { credits: 3, role: 'teacher', is_teacher: true, seats: 30, paid_through: '2026-12-01T00:00:00Z',
      teacher_until: '2026-12-01T00:00:00Z', teacher_trial_available: false, classes: [{ class_name: '王老師週六班' }] }) };
    const w = loggedIn(makeWorld({ paid: true, access: full }));
    const p = loadPage(w); await p.ready; await p.C.accessReady;
    const raw = w.local.getItem(CACHE) || '';
    const saved = JSON.parse(raw);
    const keys = Object.keys(saved.access).sort().join(',');
    return { ok: !/王老師|credits|role|is_teacher|seats|classes|teacher_trial_available/.test(raw) && saved.access.paid_through === '2026-12-01T00:00:00Z'
      && saved.access.active === false && typeof saved.at === 'number' && p.C.access.credits === 3,
      detail: keys };
  },
  '登出後重載:這台不留任何 tr_access_': async () => {
    const w = loggedIn(makeWorld({ paid: true, access: ACTIVE }));
    const p1 = loadPage(w); await p1.ready; await p1.C.accessReady;
    const before = !!w.local.getItem(CACHE);
    await p1.C.logout();
    const p2 = loadPage(w); await p2.ready;
    const left = Array.from({ length: w.local.length }, (_, i) => w.local.key(i)).filter(k => /^tr_access_/.test(k));
    return { ok: before && w.reloads === 1 && !p2.C.user && left.length === 0, detail: '登出前有快取 ' + before + ' / 重載後剩 ' + JSON.stringify(left) };
  },
  '刪除帳號後重載:不留 tr_access_;開關關著時的頁面也照樣清': async () => {
    const w = loggedIn(makeWorld({ paid: true, access: ACTIVE }));
    const p1 = loadPage(w); await p1.ready; await p1.C.accessReady;
    await p1.C.deleteAccount();
    w.paid = false;
    const p2 = loadPage(w); await p2.ready;
    const left = Array.from({ length: w.local.length }, (_, i) => w.local.key(i)).filter(k => /^tr_access_/.test(k));
    return { ok: w.rpc.some(c => c[0] === 'delete_own_account') && !p2.C.user && left.length === 0, detail: '剩 ' + JSON.stringify(left) };
  },
  '同一台換另一個帳號登入:前一個帳號留下的 tr_access_ 清掉,自己的留著': async () => {
    const w = loggedIn(makeWorld({ paid: true, access: ACTIVE }));
    w.local.setItem('tr_access_aaaaaaaa-0000-4000-8000-000000000001', JSON.stringify({ at: 1, access: { active: true, classes: [{ class_name: '別人的班' }] } }));
    const p = loadPage(w); await p.ready; await p.C.accessReady;
    const keys = Array.from({ length: w.local.length }, (_, i) => w.local.key(i)).filter(k => /^tr_access_/.test(k));
    return { ok: keys.length === 1 && keys[0] === CACHE, detail: JSON.stringify(keys) };
  },
  '舊的回答比新的晚回來(開頁的查詢還沒回、就按了開始老師試用):不採用舊的,不會鎖、不會掉老師身分': async () => {
    const TRIAL = { data: Object.assign({}, ACTIVE.data, { source: 'trial', is_teacher: true, role: 'teacher', until: '2026-10-21T03:00:00Z' }) };
    const w = loggedIn(makeWorld({ paid: true, access: 'deferred', other: { start_teacher_trial: { data: { until: '2026-10-21T03:00:00Z', seats: 30 }, error: null } } }));
    const p = loadPage(w); await p.ready;
    let first = 'pending'; p.C.accessReady.then(a => { first = a; });
    await p.C.startTeacherTrial(30, '週六班');
    const inflight = w.pending.length;
    w.pending[1](TRIAL); await tick();
    w.pending[0](EXPIRED); await tick();
    const ar = await p.C.accessReady;
    const cached = JSON.parse(w.local.getItem(CACHE));
    return { ok: inflight === 2 && p.C.locked() === false && p.C.isTeacher === true && p.C.access.source === 'trial'
      && ar && ar.source === 'trial' && first && first.source === 'trial' && cached.access.source === 'trial',
      detail: '同時 ' + inflight + ' 個 / locked ' + p.C.locked() + ' / isTeacher ' + p.C.isTeacher + ' / source ' + (p.C.access && p.C.access.source)
        + ' / accessReady ' + (ar && ar.source) + ' / 快取 ' + cached.access.source };
  },
  '先送的先回來、後送的後回來:兩個都採用,最後是新的': async () => {
    const w = loggedIn(makeWorld({ paid: true, access: 'deferred' }));
    const p = loadPage(w); await p.ready;
    const r = p.C.refreshAccess();
    w.pending[0](ACTIVE); await tick();
    const mid = p.C.locked();
    w.pending[1](EXPIRED); await tick(); await r;
    return { ok: mid === false && p.C.locked() === true && p.C.access.source === 'none', detail: mid + ' → ' + p.C.locked() };
  },
  '試用中已付款:顯示已付費,不出試用快結束的提示條': async () => {
    const C = loadPage(makeWorld()).C;
    const a = { active: true, source: 'trial', until: '2026-11-08T00:00:00Z', trial_until: '2026-10-08T00:00:00Z',
      paid_through: '2026-11-08T00:00:00Z', server_now: '2026-10-07T03:00:00Z', is_owner: false };
    const s = C.accessStatus(a);
    return { ok: s.kind === 'paid' && s.until === a.paid_through && C.trialEndsSoon(a) === false, detail: JSON.stringify(s) + ' / 提示條 ' + C.trialEndsSoon(a) };
  },
  '方案狀態的判斷順序與提示條(只有試用、而且 2 天內到期才出現)': async () => {
    const C = loadPage(makeWorld()).C;
    const now = '2026-10-07T03:00:00Z';
    const t = (o) => Object.assign({ active: true, server_now: now, is_owner: false, paid_through: null, until: null }, o);
    const r = {
      owner: C.accessStatus(t({ is_owner: true, source: 'owner' })).kind,
      paidPast: C.accessStatus(t({ active: false, source: 'none', paid_through: '2026-10-01T00:00:00Z' })).kind,
      legacy: C.accessStatus(t({ source: 'legacy' })).kind,
      cls: C.accessStatus(t({ source: 'class', until: '2026-12-01T00:00:00Z' })).kind,
      trial: C.accessStatus(t({ source: 'trial', until: '2026-10-08T00:00:00Z' })).kind,
      none: C.accessStatus(t({ active: false, source: 'none' })).kind,
      nullAccess: C.accessStatus(null),
      soon: C.trialEndsSoon(t({ source: 'trial', until: '2026-10-08T00:00:00Z' })),
      far: C.trialEndsSoon(t({ source: 'trial', until: '2026-10-12T00:00:00Z' })),
      past: C.trialEndsSoon(t({ source: 'trial', until: '2026-10-06T00:00:00Z' })),
      legacySoon: C.trialEndsSoon(t({ source: 'legacy', until: '2026-10-08T00:00:00Z' })),
    };
    const ok = r.owner === 'owner' && r.paidPast === 'expired' && r.legacy === 'legacy' && r.cls === 'class' && r.trial === 'trial'
      && r.none === 'expired' && r.nullAccess === null && r.soon === true && r.far === false && r.past === false && r.legacySoon === false;
    return { ok, detail: JSON.stringify(r) };
  },
  'plans-config:開關預設關,價格跟 pricing.html 寫的一模一樣': async () => {
    const ctx = {}; ctx.window = ctx; vm.createContext(ctx); vm.runInContext(PLANS_SRC, ctx);
    const P = ctx.PLANS;
    const fmt = n => n.toLocaleString('en-US');
    const has = (label, n) => new RegExp(label + '[\\s\\S]{0,80}?' + fmt(n) + '<small>').test(PRICING);
    const checks = [
      ctx.PAID_UI === false,
      P.student.month === 199 && P.student.year === 1990, has('一個月', P.student.month), has('一年', P.student.year),
      P.teacherYearMonths === 10,
      [10, 30, 60].every(s => has(s + ' 位以內</th><td class="num">', P.teacher[s]) && has(s + ' 位以內</th>[\\s\\S]{0,60}?<td class="num">', P.teacher[s] * P.teacherYearMonths)),
      Object.keys(P.teacher).join(',') === '10,30,60',
      P.correction.one === 150 && P.correction.five === 650, has('一篇', P.correction.one), has('5\\s篇批改服務', P.correction.five),
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') };
  },
};

(async () => {
  let pass = 0;
  for (const [name, fn] of Object.entries(cases)) {
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, detail: '例外 ' + e.message }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + r.detail);
  }
  console.log(pass + ' / ' + Object.keys(cases).length + ' 通過');
  process.exit(pass === Object.keys(cases).length ? 0 : 1);
})();
