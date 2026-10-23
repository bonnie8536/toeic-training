/* 購買與付款結果(js/checkout.js、js/pay-result.js、js/cloud.js 的 startCheckout / myCheckout / isOwner)。
   全部用假的 fetch、假的 Supabase、假的 document 跑,不連網、不碰真的資料庫。
   重點:
   - PAID_UI 沒開、網址也沒帶 ?paytest=1 時,checkout.js 一個節點都不碰(價格頁維持現在的樣子)。
   - 金額只在伺服器決定:送給 newebpay-checkout 的只有 sku、consent: true、consent_at,沒有任何金額。
   - 伺服器回來的表單只送到藍新的兩個付款網址,欄位只有四個,而且要對得上正式或測試環境。
   - 連按兩次只建一張單;沒有勾選同意(沒有同意時間)就不呼叫伺服器。
   - 付款結果頁只讀(my_checkout,讀不到退回 my_billing),最多查 60 秒,付款狀態一律以伺服器為準。
   - 文案:付款、條款、隱私、退款頁不再提 ATM;11 月 1 日起收費;勾選同意的句子一字不差。
   用法:node tools/test_checkout.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { pathToFileURL } = require('url');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const tryRead = f => { try { return read(f); } catch (e) { return ''; } };
const CLOUD_SRC = read('js/cloud.js');
const PLANS_SRC = read('js/plans-config.js');
const PAYWALL_SRC = tryRead('js/paywall.js');
const CHECKOUT_SRC = tryRead('js/checkout.js');
const RESULT_SRC = tryRead('js/pay-result.js');
const PROD_MOD = import(pathToFileURL(path.join(REPO, 'supabase/functions/_shared/products.ts')).href);

const USER = { id: '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72', email: 's@x.com', created_at: '2026-10-07T03:00:00Z', user_metadata: { name: '學生' } };
const SB_KEY = 'sb-x-auth-token';
const PROD = 'https://core.newebpay.com/MPG/mpg_gateway';
const TEST = 'https://ccore.newebpay.com/MPG/mpg_gateway';
const ORDER = 'S261101093000AB12C3D';
const FIELDS = { MerchantID: 'MS1845581245', TradeInfo: 'ab'.repeat(96), TradeSha: 'C'.repeat(64), Version: '2.3' };
const CONSENT_TEXT = '我同意線上服務開始使用後，不適用 7 天猶豫期。';
const NB = ' ';

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

/* 很小的假 DOM:只做 pay() 送表單用得到的部分 */
function makeDoc() {
  const made = [];
  function el(tag) {
    const n = { tag, attrs: {}, children: [], submitted: 0, style: {},
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      append(...c) { this.children.push(...c); },
      appendChild(c) { this.children.push(c); return c; },
      submit() { this.submitted++; },
      remove() {},
    };
    ['method', 'action', 'name', 'value', 'type'].forEach(p => Object.defineProperty(n, p, {
      get() { return this.attrs[p] === undefined ? '' : this.attrs[p]; }, set(v) { this.attrs[p] = String(v); } }));
    made.push(n);
    return n;
  }
  const body = el('body');
  return { made, body, createElement: el, addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } };
}

/* w:{ paid, search, session(登入資料), access(my_access 回應), teachers, rpc:{ fn: 回應 }, fetch(url, init) } */
function makeWorld(o) {
  return Object.assign({ local: makeStorage(), sess: makeStorage(), rpcCalls: [], fetchCalls: [], fromCalls: [], teachers: [],
    loggedIn: true, token: 'jwt-abc', paid: false, search: '', pathname: '/pricing.html' }, o || {});
}
function makeClient(w) {
  return {
    auth: {
      getSession: async () => ({ data: { session: w.loggedIn ? { user: USER, access_token: w.token } : null } }),
      signOut: async () => ({ error: null }),
    },
    rpc(fn, args) {
      w.rpcCalls.push([fn, args]);
      const r = w.rpc && w.rpc[fn];
      if (typeof r === 'function') return r(args);
      return Promise.resolve(r || { data: null, error: null });
    },
    from(table) {
      const q = { table, cols: '', eq: [] };
      w.fromCalls.push(q);
      const b = { select(c) { q.cols = c; return b; }, eq(k, v) { q.eq.push([k, v]); return b; }, upsert() { return b; },
        then(ok, bad) { return run().then(ok, bad); } };
      async function run() {
        if (table === 'teachers') {
          if (w.teachersError) return { data: null, error: { message: 'boom' } };
          return { data: w.teachers.map(t => Object.assign({}, t)), error: null };
        }
        return { data: [], error: null };
      }
      return b;
    },
  };
}
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

function load(w, opts) {
  opts = opts || {};
  const touched = [];
  const doc = opts.proxyDoc
    ? new Proxy({}, { get(t, k) { touched.push(String(k)); if (k === 'addEventListener') return () => {}; return undefined; } })
    : (w.doc = makeDoc());
  const listeners = [];
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    setTimeout, clearTimeout, URLSearchParams, Date, JSON, Promise,
    localStorage: w.local, sessionStorage: w.sess,
    location: { hash: '', search: w.search, pathname: w.pathname, origin: 'https://x', href: 'https://x' + w.pathname + w.search, reload() {} },
    history: { replaceState() {} },
    document: doc,
    navigator: { onLine: true },
    addEventListener(type, fn) { listeners.push([type, fn]); },
    fetch: (url, init) => { w.fetchCalls.push([url, init]); return w.fetch ? w.fetch(url, init) : Promise.reject(new TypeError('Failed to fetch')); },
  };
  ctx.window = ctx;
  if (!opts.cloudOff) ctx.CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'anon-k' };
  ctx.supabase = { createClient: () => makeClient(w) };
  if (w.loggedIn) {
    w.local.setItem('tr_current_profile', JSON.stringify('c' + USER.id.replace(/-/g, '')));
    w.local.setItem(SB_KEY, JSON.stringify({ user: USER }));
    w.sess.setItem('tr_cloud_hydrated_' + USER.id, '1');
  }
  try { ctx.__PROFILE_ID = JSON.parse(w.local.getItem('tr_current_profile')) || null; } catch (e) { ctx.__PROFILE_ID = null; }
  vm.createContext(ctx);
  vm.runInContext(PLANS_SRC, ctx);
  if (w.paid !== undefined) ctx.PAID_UI = w.paid;
  if (w.access) ctx.__ACCESS = w.access;
  vm.runInContext(CLOUD_SRC, ctx);
  touched.length = 0;   // cloud.js 本身碰 document 的不算
  if (opts.paywall) vm.runInContext(PAYWALL_SRC, ctx);
  vm.runInContext(CHECKOUT_SRC, ctx);
  return { ctx, C: ctx.CLOUD, K: ctx.CHECKOUT, P: ctx.PAYWALL, touched, listeners, ready: ctx.CLOUD.ready.then(tick) };
}
const okJson = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
const GOOD = { action: PROD, fields: FIELDS, order_no: ORDER };

/* 假的計時器:wait(ms) 只把時間往前推 */
function clock(start) {
  let t = start;
  return { now: () => t, wait: ms => { t += ms; return Promise.resolve(); } };
}

/* 文案規則(交接文件第 5 節):沒有 emoji、破折號、「不是…而是」,中文旁邊的標點是全形 */
function copyProblems(s) {
  const out = [];
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)) out.push('emoji');
  if (/[—–]|──/.test(s)) out.push('破折號');
  if (/不是[^。！？\n]{0,30}而是/.test(s)) out.push('不是…而是');
  const han = '[一-鿿]';
  if (new RegExp(han + '\\s*[,;:?!]|[,;:]\\s*' + han).test(s)) out.push('半形標點');
  if (/[!！]/.test(s)) out.push('驚嘆號');
  return out;
}
/* 個人資料檢查:公開的程式庫不能寫出要擋的字,所以這裡只放 SHA-256。
   每一筆是 { len, sha256 },把文字轉小寫後,用長度 len 的視窗一路滑過去,算出來的雜湊對上就算有。 */
const CONTACT_EMAIL = 'shuashualanguage@gmail.com';
const PRIVATE_HASHES = [
  { len: 10, sha256: '3d8402edab4526030bb0c0d69fc43a954c126a5bf9faad17871661c7319cb290' },
  { len: 3, sha256: '9a1a49fda8cad4af41cd35e893f1c04163e6fb1e52d60f8947d14ca015d21d07' },
];
const sha256 = s => require('crypto').createHash('sha256').update(s, 'utf8').digest('hex');
function hashedHits(s, list) {
  const chars = Array.from(String(s).toLowerCase());
  const hits = [];
  list.forEach((h, i) => {
    for (let k = 0; k + h.len <= chars.length; k++) {
      if (sha256(chars.slice(k, k + h.len).join('')) === h.sha256) { hits.push(i); return; }
    }
  });
  return hits;
}
function foreignEmails(s) {
  return (String(s).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).filter(e => e.toLowerCase() !== CONTACT_EMAIL);
}
/* 只取 JS 檔字串常數裡有中文的部分(註解不算) */
function jsStrings(src) {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(noComments))) { const s = m[1] !== undefined ? m[1] : m[2]; if (/[一-鿿]/.test(s)) out.push(s); }
  return out;
}
const html = f => tryRead(f);
const text = f => html(f).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/ /g, ' ');


/* 付款結果頁與購買視窗用的假 DOM(tools/owner_test_kit.js 的 fakeDom)與假的 CLOUD;計時器立刻跑 */
const KIT = require('./owner_test_kit');
const H_SRC = (read('js/common.js').match(/function h\(tag[\s\S]*?\n}\r?\n/) || [''])[0];
const settle = KIT.settle;
function domLoad(o) {
  o = o || {};
  const dom = KIT.fakeDom();
  dom.document.getElementById = id => dom.body.find(n => n.attrs && n.attrs.id === id)[0] || null;
  const listeners = [];
  const ctx = { console: { warn() {}, log() {}, error() {} }, setTimeout: fn => { setImmediate(fn); return 0; }, clearTimeout() {}, URLSearchParams, Date, JSON, Promise,
    sessionStorage: makeStorage(), localStorage: makeStorage(), document: dom.document,
    location: { search: o.search || '', pathname: '/pay-result.html', href: 'https://x/pay-result.html' + (o.search || '') },
    addEventListener(t, fn) { listeners.push([t, fn]); } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(PLANS_SRC, ctx);
  vm.runInContext(H_SRC, ctx);
  ctx.PAID_UI = o.paid === undefined ? true : o.paid;
  const access = o.access === undefined ? null : o.access;
  ctx.CLOUD = Object.assign({ enabled: true, ready: Promise.resolve(), user: { id: USER.id, email: USER.email }, access, accessReady: Promise.resolve(access),
    refreshAccess: async () => null, myCheckout: async () => null, myBilling: async () => ({ payments: [] }),
    startCheckout: async () => GOOD, isOwner: async () => false }, o.cloud || {});
  vm.runInContext(CHECKOUT_SRC, ctx);
  return { ctx, dom, K: ctx.CHECKOUT, listeners };
}
async function runResult(D) {
  const root = new D.dom.Node('div'); root.attrs.id = 'pay-root'; D.dom.body.append(root);
  const renders = [];
  const orig = root.append.bind(root);
  root.append = (...ns) => { renders.push(ns.map(x => x.textContent).join('')); return orig(...ns); };
  vm.runInContext(RESULT_SRC, D.ctx);
  for (const l of D.dom.document.listeners.filter(l => l.t === 'DOMContentLoaded')) await l.fn({});
  await settle(); await settle();
  return { root, renders };
}

const cases = {
  /* ---------- 開關 ---------- */
  'PAID_UI 沒開、網址沒有 ?paytest=1:checkout.js 一次都不碰 document': async () => {
    const w = makeWorld({ paid: false });
    const p = load(w, { proxyDoc: true }); await p.ready;
    return { ok: !!p.K && p.touched.length === 0, detail: 'document ' + p.touched.length + ' 次' };
  },
  '要顯示哪些購買區:PAID_UI、登入、老師資格、站長測試': async () => {
    const { K } = load(makeWorld());
    const g = o => K.groupsFor(o).join(',');
    const allowed = { teacher_purchase_allowed: true }, denied = { teacher_purchase_allowed: false };
    const checks = [
      g({ paidUi: false, signedIn: true, access: allowed, owner: true, paytest: false }) === '',
      g({ paidUi: false, signedIn: true, access: null, owner: true, paytest: true }) === 'test',
      g({ paidUi: false, signedIn: true, access: null, owner: false, paytest: true }) === '',
      g({ paidUi: false, signedIn: false, access: null, owner: false, paytest: true }) === '',
      g({ paidUi: true, signedIn: true, access: allowed, owner: false, paytest: false }) === 'student,teacher,credits',
      g({ paidUi: true, signedIn: true, access: denied, owner: false, paytest: false }) === 'student,teacher,credits',   // 老師方案那裡寫聯絡站長
      g({ paidUi: true, signedIn: true, access: null, owner: false, paytest: false }) === 'student,credits',
      g({ paidUi: true, signedIn: false, access: null, owner: false, paytest: false }) === 'student,teacher,credits',
      g({ paidUi: true, signedIn: true, access: allowed, owner: true, paytest: true }) === 'student,teacher,credits,test',
      g({ paidUi: true, signedIn: true, access: allowed, owner: false, paytest: true }) === 'student,teacher,credits',
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') };
  },
  '?paytest=1 只認 1;PAID_UI 沒開但帶 ?paytest=1 會掛上價格頁的初始化': async () => {
    const { K } = load(makeWorld());
    const flags = [K.paytestFlag('?paytest=1'), K.paytestFlag('?paytest=0'), K.paytestFlag(''), K.paytestFlag('?x=1&paytest=1'), K.paytestFlag('?paytest=true')];
    const w = makeWorld({ paid: false, search: '?paytest=1' });
    const p = load(w, { proxyDoc: true }); await p.ready;
    const ok = flags.join() === 'true,false,false,true,false' && p.touched.includes('addEventListener');
    return { ok, detail: flags.join() + ' / ' + p.touched.join(',') };
  },

  /* ---------- 商品與價格 ---------- */
  '畫面上的商品跟 plans-config 與伺服器價格表(products.ts)一模一樣,test10 只給站長': async () => {
    const { K, ctx } = load(makeWorld());
    const { PRODUCTS } = await PROD_MOD;
    const list = K.catalog();
    const P = ctx.PLANS;
    const want = { student_month: P.student.month, student_year: P.student.year, correction_one: P.correction.one, correction_five: P.correction.five, test10: 10 };
    [10, 30, 60].forEach(s => { want['teacher' + s + '_month'] = P.teacher[s]; want['teacher' + s + '_year'] = P.teacher[s] * P.teacherYearMonths; });
    const skus = list.map(x => x.sku).sort().join();
    const server = Array.from(PRODUCTS.keys()).sort().join();
    const amounts = list.every(x => want[x.sku] === x.amount && PRODUCTS.get(x.sku).amount === x.amount);
    const test = list.filter(x => x.group === 'test').map(x => x.sku).join();
    return { ok: skus === server && amounts && test === 'test10' && list.length === 11, detail: skus + ' | ' + server + ' | 金額 ' + amounts };
  },

  /* ---------- 伺服器回應檢查 ---------- */
  '藍新表單:只接受藍新兩個付款網址、四個欄位,而且環境對得上訂單編號': async () => {
    const { K } = load(makeWorld());
    const v = r => !!K.validResponse(r);
    const f = o => Object.assign({}, FIELDS, o);
    const checks = [
      v(GOOD) === true,
      v({ action: TEST, fields: FIELDS, order_no: 'T261101093000AB12C3D' }) === true,
      v({ action: TEST, fields: FIELDS, order_no: ORDER }) === false,              // S 單送到測試環境
      v({ action: PROD, fields: FIELDS, order_no: 'T261101093000AB12C3D' }) === false,
      v({ action: 'https://evil.example/MPG/mpg_gateway', fields: FIELDS, order_no: ORDER }) === false,
      v({ action: 'http://core.newebpay.com/MPG/mpg_gateway', fields: FIELDS, order_no: ORDER }) === false,
      v({ action: PROD, fields: f({ Amt: '1' }), order_no: ORDER }) === false,       // 多一個欄位
      v({ action: PROD, fields: f({ TradeSha: 123 }), order_no: ORDER }) === false,
      v({ action: PROD, fields: f({ TradeInfo: 'zz' }), order_no: ORDER }) === false,
      v({ action: PROD, fields: { MerchantID: 'MS1', TradeInfo: 'ab', TradeSha: 'C'.repeat(64) }, order_no: ORDER }) === false,
      v({ action: PROD, fields: FIELDS, order_no: 'S2611' }) === false,
      v(null) === false, v('x') === false, v({ action: PROD, fields: [], order_no: ORDER }) === false,
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') };
  },
  '訂單編號格式:S 或 T、12 碼時間、7 碼大寫英數': async () => {
    const { K } = load(makeWorld());
    const r = [ORDER, 'T261101093000AB12C3D', 's261101093000AB12C3D', 'S261101093000AB12C3', 'S261101093000ab12c3d', 'S261101093000AB12C3D<', ''].map(K.orderNoOk);
    return { ok: r.join() === 'true,true,false,false,false,false,false', detail: r.join() };
  },

  /* ---------- cloud.js:呼叫 newebpay-checkout ---------- */
  'startCheckout:POST 到 newebpay-checkout,帶登入憑證,內容只有 sku、consent: true、consent_at': async () => {
    const w = makeWorld({ fetch: () => okJson(200, GOOD) });
    const p = load(w); await p.ready;
    const at = '2026-11-01T01:30:00.000Z';
    const r = await p.C.startCheckout('student_month', at);
    const [url, init] = w.fetchCalls[0] || [];
    const body = init ? JSON.parse(init.body) : {};
    const h = (init && init.headers) || {};
    const checks = [
      w.fetchCalls.length === 1,
      url === 'https://x.supabase.co/functions/v1/newebpay-checkout',
      init.method === 'POST',
      h.Authorization === 'Bearer jwt-abc', h.apikey === 'anon-k', /application\/json/.test(h['Content-Type']),
      Object.keys(body).sort().join() === 'consent,consent_at,sku',
      body.sku === 'student_month' && body.consent === true && body.consent_at === at,
      !/amount|amt|price/i.test(init.body),
      r && r.order_no === ORDER,
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') };
  },
  'startCheckout:沒登入不送;伺服器的錯誤訊息照登,401 請重新登入,連不上講網路': async () => {
    const w0 = makeWorld({ loggedIn: false, fetch: () => okJson(200, GOOD) });
    const p0 = load(w0); await p0.ready;
    let e0 = ''; try { await p0.C.startCheckout('student_month', '2026-11-01T01:30:00.000Z'); } catch (e) { e0 = e.message; }
    const msg = async (fetchImpl) => {
      const w = makeWorld({ fetch: fetchImpl });
      const p = load(w); await p.ready;
      try { await p.C.startCheckout('student_month', '2026-11-01T01:30:00.000Z'); return 'ok'; } catch (e) { return e.message; }
    };
    const m409 = await msg(() => okJson(409, { error: '一小時內有太多筆還沒完成的付款' }));
    const m401 = await msg(() => okJson(401, { error: 'Invalid JWT' }));
    const mNet = await msg(() => Promise.reject(new TypeError('Failed to fetch')));
    const m500 = await msg(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error('not json')) }));
    const checks = [w0.fetchCalls.length === 0, e0 === '請先登入。', m409 === '一小時內有太多筆還沒完成的付款。',
      /重新登入/.test(m401) && !/JWT/.test(m401), /連不上/.test(mNet), m500 === '暫時無法建立付款，請稍後再試。'];
    return { ok: checks.every(Boolean), detail: [e0, m409, m401, mNet, m500].join(' | ') };
  },

  /* ---------- checkout.js:付款 ---------- */
  'pay:送出表單到藍新(POST、四個隱藏欄位、送一次),記下訂單編號': async () => {
    const w = makeWorld({ paid: true, fetch: () => okJson(200, GOOD) });
    const p = load(w); await p.ready;
    const o = await p.K.pay('student_year', '2026-11-01T01:30:00.000Z');
    const forms = w.doc.made.filter(n => n.tag === 'form');
    const f = forms[0] || { children: [] };
    const inputs = f.children.filter(n => n.tag === 'input');
    const vals = {}; inputs.forEach(i => { vals[i.name] = i.value; });
    const last = JSON.parse(w.sess.getItem('tr_pay_last') || 'null');
    const checks = [
      o === ORDER, forms.length === 1, f.method.toLowerCase() === 'post', f.action === PROD, f.submitted === 1,
      inputs.length === 4 && inputs.every(i => i.type === 'hidden'),
      JSON.stringify(vals) === JSON.stringify(FIELDS) || Object.keys(FIELDS).every(k => vals[k] === FIELDS[k]),
      last && last.o === ORDER && typeof last.at === 'number',
      JSON.parse(w.fetchCalls[0][1].body).sku === 'student_year',
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') };
  },
  'pay:連按兩次只建一張單;失敗後可以再按': async () => {
    let release;
    const w = makeWorld({ paid: true, fetch: () => new Promise(r => { release = () => r({ ok: true, status: 200, json: () => Promise.resolve(GOOD) }); }) });
    const p = load(w); await p.ready;
    const a = p.K.pay('student_month', '2026-11-01T01:30:00.000Z');
    const b = await p.K.pay('student_month', '2026-11-01T01:30:00.000Z');
    await tick();
    const n1 = w.fetchCalls.length;
    release(); await a;
    const busyAfter = p.K.busy();
    /* 第二個世界:第一次失敗,第二次可以再送 */
    let n = 0;
    const w2 = makeWorld({ paid: true, fetch: () => (++n === 1 ? okJson(409, { error: '太多筆' }) : okJson(200, GOOD)) });
    const p2 = load(w2); await p2.ready;
    let e1 = ''; try { await p2.K.pay('student_month', '2026-11-01T01:30:00.000Z'); } catch (e) { e1 = e.message; }
    const o2 = await p2.K.pay('student_month', '2026-11-01T01:30:00.000Z');
    const checks = [b === null, n1 === 1, busyAfter === true, e1 === '太多筆。', o2 === ORDER, w2.fetchCalls.length === 2];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') };
  },
  'pay:沒有同意時間、不認得的方案、回應不對,都不送出表單': async () => {
    const run = async (sku, at, resp) => {
      const w = makeWorld({ paid: true, fetch: () => okJson(200, resp || GOOD) });
      const p = load(w); await p.ready;
      let err = '';
      try { await p.K.pay(sku, at); } catch (e) { err = e.message; }
      return { err, fetched: w.fetchCalls.length, forms: w.doc.made.filter(n => n.tag === 'form').length, busy: p.K.busy() };
    };
    const a = await run('student_month', null);
    const b = await run('student_month', 'yesterday');
    const c = await run('student_lifetime', '2026-11-01T01:30:00.000Z');
    const d = await run('student_month', '2026-11-01T01:30:00.000Z', { action: 'https://evil.example/x', fields: FIELDS, order_no: ORDER });
    const checks = [a.fetched === 0 && a.forms === 0 && /勾選/.test(a.err), b.fetched === 0, c.fetched === 0 && c.forms === 0,
      d.fetched === 1 && d.forms === 0 && !!d.err && d.busy === false];
    return { ok: checks.every(Boolean), detail: [a.err, b.err, c.err, d.err].join(' | ') };
  },
  'pageshow(從藍新按上一頁回來):可以再按一次': async () => {
    const w = makeWorld({ paid: true, fetch: () => okJson(200, GOOD) });
    const p = load(w); await p.ready;
    await p.K.pay('student_month', '2026-11-01T01:30:00.000Z');
    const before = p.K.busy();
    p.listeners.filter(l => l[0] === 'pageshow').forEach(l => l[1]({ persisted: true }));
    return { ok: before === true && p.K.busy() === false, detail: before + ' → ' + p.K.busy() };
  },

  /* ---------- 付款結果 ---------- */
  '付款結果的狀態:paid、test10、pending、failed、refunded': async () => {
    const { K } = load(makeWorld());
    const s = r => K.resultOf(r).state;
    const r = [s({ status: 'paid', sku: 'student_month' }), s({ status: 'paid', sku: 'test10' }), s({ status: 'pending' }),
      s({ status: 'failed' }), s({ status: 'refunded' }), s({ status: 'weird' }), s({ status: 'paid', item: 'credits', credits: 1, amount: 10 })];
    return { ok: r.join() === 'paid,test,pending,failed,refunded,pending,paid', detail: r.join() };
  },
  '付款結果的文字:品項與金額,成功、處理中、失敗、測試各一段': async () => {
    const { K } = load(makeWorld());
    const v = (state, row) => K.stateView(Object.assign({ state }, row ? { row } : {}));
    const paid = v('paid', { status: 'paid', sku: 'student_month', item: 'student', months: 1, amount: 199 });
    const year = v('paid', { status: 'paid', item: 'teacher', seats: 30, months: 12, amount: 8900 });
    const five = v('paid', { status: 'paid', item: 'credits', credits: 5, amount: 650 });
    const test = v('test', { status: 'paid', sku: 'test10', item: 'credits', credits: 1, amount: 10 });
    const views = ['checking', 'pending', 'slow', 'failed', 'refunded', 'missing', 'noorder', 'login', 'error'].map(s => v(s));
    const all = [paid, year, five, test].concat(views);
    const checks = [
      paid.title === '付款成功' && paid.lines[0] === '學生方案 一個月，199' + NB + '元。',
      year.lines[0] === '老師方案 30' + NB + '位以內 一年，8,900' + NB + '元。',
      five.lines[0] === '寫作批改 5' + NB + '篇，650' + NB + '元。',
      test.title === '測試付款成功' && /退款/.test(test.lines.join('')),
      v('pending').title === '處理中', v('slow').title === '處理中', v('failed').title === '付款沒有完成',
      v('slow').actions.some(a => a.retry), v('login').actions.some(a => a.login),
      all.every(x => typeof x.title === 'string' && x.title && Array.isArray(x.lines) && Array.isArray(x.actions)),
      all.every(x => copyProblems([x.title].concat(x.lines).join('\n')).length === 0),
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') + ' ' + paid.lines[0] };
  },
  '訂單編號從哪來:網址的 ?o= 優先,不合格式就不用;沒有就用這個分頁 2 小時內記下的': async () => {
    const w = makeWorld();
    const { K } = load(w);
    const T0 = Date.parse('2026-11-01T01:30:00Z');
    const a = K.orderFromPage('?o=' + ORDER, T0);
    const b = K.orderFromPage('?o=abc', T0);
    K.rememberOrder('T261101093000ZZZZZZZ', T0);
    const c = K.orderFromPage('?o=abc', T0 + 60e3);
    const d = K.orderFromPage('', T0 + 3 * 3600e3);
    w.sess.setItem('tr_pay_last', '{bad json');
    const e = K.orderFromPage('', T0);
    const r = [a, b, c, d, e];
    return { ok: a === ORDER && b === null && c === 'T261101093000ZZZZZZZ' && d === null && e === null, detail: JSON.stringify(r) };
  },
  'lookup:先查 my_checkout,查不到函式就退回 my_billing 找同一個訂單編號': async () => {
    const w1 = makeWorld({ rpc: { my_checkout: () => Promise.resolve({ data: { status: 'paid', sku: 'student_month', item: 'student', months: 1, amount: 199 }, error: null }) } });
    const p1 = load(w1); await p1.ready;
    const r1 = await p1.K.lookup(ORDER);
    const w2 = makeWorld({ rpc: {
      my_checkout: () => Promise.resolve({ data: null, error: { message: 'Could not find the function public.my_checkout(p_order_no) in the schema cache', code: 'PGRST202' } }),
      my_billing: () => Promise.resolve({ data: { payments: [{ merchant_trade_no: 'S261101000000XXXXXXX', status: 'pending' }, { merchant_trade_no: ORDER, status: 'failed', item: 'student', months: 1, amount: 199 }] }, error: null }),
    } });
    const p2 = load(w2); await p2.ready;
    const r2 = await p2.K.lookup(ORDER);
    const w3 = makeWorld({ rpc: { my_checkout: () => Promise.resolve({ data: null, error: null }) } });
    const p3 = load(w3); await p3.ready;
    const r3 = await p3.K.lookup(ORDER);
    const args = w1.rpcCalls.find(c => c[0] === 'my_checkout');
    const checks = [r1 && r1.status === 'paid', args && args[1].p_order_no === ORDER, r2 && r2.status === 'failed', r3 === null,
      w1.rpcCalls.every(c => !/settle|begin|apply|refund/.test(c[0]))];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') };
  },
  'poll:處理中每 3 秒再查,入帳後停下並更新使用權;60 秒還沒結果就停在「處理中」可以再查': async () => {
    let n = 0;
    const seq = ['pending', 'pending', 'paid'];
    const w = makeWorld({ paid: true, access: null, rpc: { my_checkout: () => Promise.resolve({ data: { status: seq[Math.min(n++, 2)], sku: 'student_month', item: 'student', months: 1, amount: 199 }, error: null }) } });
    const p = load(w); await p.ready;
    const ck = clock(0);
    const states = [];
    const accessBefore = w.rpcCalls.filter(c => c[0] === 'my_access').length;
    const fin = await p.K.poll(ORDER, { now: ck.now, wait: ck.wait, onState: s => states.push(s.state) });
    const accessAfter = w.rpcCalls.filter(c => c[0] === 'my_access').length;
    /* 一直處理中 */
    let m = 0;
    const w2 = makeWorld({ rpc: { my_checkout: () => { m++; return Promise.resolve({ data: { status: 'pending' }, error: null }); } } });
    const p2 = load(w2); await p2.ready;
    const ck2 = clock(0);
    const fin2 = await p2.K.poll(ORDER, { now: ck2.now, wait: ck2.wait, onState() {} });
    /* 查詢失敗(網路)不會停,之後成功就好 */
    let k = 0;
    const w3 = makeWorld({ rpc: { my_checkout: () => (++k < 3 ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ data: { status: 'failed' }, error: null })),
      my_billing: () => Promise.reject(new TypeError('Failed to fetch')) } });
    const p3 = load(w3); await p3.ready;
    const ck3 = clock(0);
    const fin3 = await p3.K.poll(ORDER, { now: ck3.now, wait: ck3.wait, onState() {} });
    const checks = [states.join() === 'pending,pending,paid', fin.state === 'paid', ck.now() === 6000, accessAfter === accessBefore + 1,
      fin2.state === 'slow', m >= 19 && m <= 21, ck2.now() <= 60000, fin3.state === 'failed'];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') + ' 查了 ' + m + ' 次 / ' + ck2.now() + 'ms' };
  },
  'poll:查不到這筆(別的帳號)馬上停;付款結果頁從頭到尾不呼叫任何寫入': async () => {
    const w = makeWorld({ rpc: { my_checkout: () => Promise.resolve({ data: null, error: null }) } });
    const p = load(w); await p.ready;
    const ck = clock(0);
    const fin = await p.K.poll(ORDER, { now: ck.now, wait: ck.wait, onState() {} });
    const writes = w.rpcCalls.filter(c => !/^(my_checkout|my_billing|my_access)$/.test(c[0]));
    return { ok: fin.state === 'missing' && ck.now() === 0 && writes.length === 0 && w.fetchCalls.length === 0, detail: fin.state + ' / 其他呼叫 ' + writes.length };
  },

  /* ---------- cloud.js:站長判斷(只決定要不要顯示測試項目;能不能買由資料庫擋) ---------- */
  'isOwner:有 my_access 用它;沒有就讀自己的 teachers.is_owner;錯誤或沒登入都是 false': async () => {
    const w1 = makeWorld({ teachers: [{ is_owner: true }] });
    const p1 = load(w1); await p1.ready;
    const a = await p1.C.isOwner();
    const q = w1.fromCalls.filter(c => c.table === 'teachers').pop();
    const w2 = makeWorld({ teachers: [] });
    const p2 = load(w2); await p2.ready;
    const b = await p2.C.isOwner();
    const w3 = makeWorld({ teachersError: true, teachers: [{ is_owner: true }] });
    const p3 = load(w3); await p3.ready;
    const c = await p3.C.isOwner();
    const w4 = makeWorld({ loggedIn: false, teachers: [{ is_owner: true }] });
    const p4 = load(w4); await p4.ready;
    const d = await p4.C.isOwner();
    const w5 = makeWorld({ paid: true, teachers: [{ is_owner: true }], rpc: { my_access: () => Promise.resolve({ data: { active: true, is_owner: false, server_now: '2026-11-01T00:00:00Z' }, error: null }) } });
    const p5 = load(w5); await p5.ready; await p5.C.accessReady;
    const e = await p5.C.isOwner();
    const checks = [a === true, q && /is_owner/.test(q.cols) && q.eq.some(x => x[0] === 'user_id' && x[1] === USER.id), b === false, c === false, d === false, e === false];
    return { ok: checks.every(Boolean), detail: [a, b, c, d, e].join() };
  },

  /* ---------- 「我的」頁與付費牆 ---------- */
  '「我的」頁:使用期限已到才多一條「購買方案」到價格頁;付費牆的「查看方案」到價格頁': async () => {
    const p = load(makeWorld({ paid: true }), { paywall: true });
    const P = p.P;
    const expired = { active: false, source: 'none', is_owner: false, server_now: '2026-11-05T00:00:00Z', classes: [] };
    const active = { active: true, source: 'trial', until: '2026-11-08T00:00:00Z', server_now: '2026-11-05T00:00:00Z', classes: [] };
    const checks = [P && P.buyPath(expired) === 'pricing.html', P && P.buyPath(active) === null, P && P.buyPath({ is_owner: true, active: false }) === null,
      /'查看方案'/.test(PAYWALL_SRC) && /href: 'pricing\.html' }, '查看方案'/.test(PAYWALL_SRC), /'購買方案'/.test(PAYWALL_SRC)];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') };
  },


  /* ---------- 審查修正(2026-10-17):已經能用的帳號、班級、被改成學生的老師 ---------- */
  '購買按鈕:既有帳號、無期限贈送、站長不放學生方案按鈕改寫說明;班級提供的保留按鈕加一句;寫作批改一律可以買': async () => {
    const { K } = load(makeWorld());
    const s = (g, a, signedIn) => K.slotFor(g, { signedIn: signedIn !== false, access: a });
    const FREE = '你的帳號可以免費使用練習功能，不需要購買學生方案。';
    const legacy = { active: true, until: null, source: 'legacy', is_owner: false };
    const comp = { active: true, until: null, source: 'comp', is_owner: false };
    const compEnd = { active: true, until: '2026-12-01T00:00:00Z', source: 'comp', is_owner: false };
    const owner = { active: true, until: null, source: 'owner', is_owner: true, teacher_purchase_allowed: false };
    const cls = { active: true, until: '2026-12-01T00:00:00Z', source: 'class', is_owner: false };
    const trial = { active: true, until: '2026-11-08T01:00:00Z', source: 'trial', is_owner: false };
    const checks = [
      JSON.stringify(s('student', null, false)) === JSON.stringify({ button: true, note: null }),
      JSON.stringify(s('student', legacy)) === JSON.stringify({ button: false, note: FREE }),
      JSON.stringify(s('student', comp)) === JSON.stringify({ button: false, note: FREE }),
      JSON.stringify(s('student', owner)) === JSON.stringify({ button: false, note: FREE }),
      JSON.stringify(s('student', compEnd)) === JSON.stringify({ button: true, note: null }),
      JSON.stringify(s('student', cls)) === JSON.stringify({ button: true, note: '你的練習功能目前由班級提供。' }),
      JSON.stringify(s('student', trial)) === JSON.stringify({ button: true, note: null }),
      JSON.stringify(s('student', null)) === JSON.stringify({ button: true, note: null }),
      JSON.stringify(s('credits', legacy)) === JSON.stringify({ button: true, note: null }),
      JSON.stringify(s('credits', owner)) === JSON.stringify({ button: true, note: null }),
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') };
  },
  '老師方案按鈕:被站長改成學生的寫聯絡站長;無期限的既有或贈送老師寫不用買;站長與讀不到使用權不放;沒登入照樣放': async () => {
    const { K } = load(makeWorld());
    const s = (a, signedIn) => K.slotFor('teacher', { signedIn: signedIn !== false, access: a });
    const ASK = '老師方案請寫信到 shuashualanguage@gmail.com 聯絡站長。';
    const demoted = { teacher_purchase_allowed: false, is_owner: false, teacher_source: null };
    const legacyT = { teacher_purchase_allowed: true, is_owner: false, teacher_source: 'legacy', teacher_until: null, seats: null };
    const compT = { teacher_purchase_allowed: true, is_owner: false, teacher_source: 'comp', teacher_until: null, seats: 30 };
    const compEnd = { teacher_purchase_allowed: true, is_owner: false, teacher_source: 'comp', teacher_until: '2026-12-01T00:00:00Z', seats: 30 };
    const fresh = { teacher_purchase_allowed: true, is_owner: false, teacher_source: null, teacher_until: null };
    const owner = { teacher_purchase_allowed: false, is_owner: true };
    const compAll = { teacher_purchase_allowed: true, is_owner: false, teacher_source: 'comp', teacher_until: null, seats: null };
    const r = [s(demoted), s(legacyT), s(compAll), s(compEnd), s(fresh), s(owner), s(null), s(null, false)];
    const checks = [
      JSON.stringify(r[0]) === JSON.stringify({ button: false, note: ASK }),
      !!r[1] && r[1].button === false && /不需要購買老師方案/.test(r[1].note),
      !!r[2] && r[2].button === false && /不需要購買老師方案/.test(r[2].note),
      /* 有名額上限的無期限贈送(30 位):照樣放按鈕,說明寫要更多名額再買 */
      !!s(compT) && s(compT).button === true && s(compT).note === '你的老師方案沒有期限，名額 30' + NB + '位以內。需要更多名額再購買。',
      JSON.stringify(r[3]) === JSON.stringify({ button: true, note: null }),
      JSON.stringify(r[4]) === JSON.stringify({ button: true, note: null }),
      r[5] === null, r[6] === null,
      JSON.stringify(r[7]) === JSON.stringify({ button: true, note: null }),
      K.groupsFor({ paidUi: true, signedIn: true, access: demoted, owner: false, paytest: false }).join() === 'student,teacher,credits',
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') + ' ' + JSON.stringify(r) };
  },
  '老師方案的名額(第一輪複審):無期限但有名額上限的只賣更多名額;伺服器的 plan_starts 是 null 的那一級不賣': async () => {
    const { K } = load(makeWorld());
    const now = '2026-11-05T00:00:00.000Z';
    const comp10 = { teacher_purchase_allowed: true, is_owner: false, teacher_source: 'comp', teacher_until: null, seats: 10, teacher_active: true, server_now: now };
    const withStarts = Object.assign({}, comp10, { seats: 30, plan_starts: { student: now, teacher10: null, teacher30: now, teacher60: now } });
    const allNull = Object.assign({}, comp10, { plan_starts: { student: now, teacher10: null, teacher30: null, teacher60: null } });
    const tiers = a => K.teacherSkus(a).join();
    const checks = [
      tiers(comp10) === 'teacher30_month,teacher30_year,teacher60_month,teacher60_year',
      tiers(withStarts) === 'teacher30_month,teacher30_year,teacher60_month,teacher60_year',
      tiers(allNull) === '', K.slotFor('teacher', { signedIn: true, access: allNull }).button === false,
      tiers({ teacher_purchase_allowed: true, teacher_source: 'paid', teacher_until: '2026-12-01T00:00:00Z', seats: 30 }).split(',').length === 6,
      /* 無期限的 10 位改買 30 位:從今天開始,不寫「不退差額」(沒有剩下的天數) */
      K.startNote('teacher30_month', Object.assign({}, comp10, { plan_starts: { teacher30: now } })) === '這次買的方案從今天開始。',
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') + ' ' + [tiers(comp10), tiers(withStarts), tiers(allNull)].join(' | ') };
  },
  '購買視窗(第一輪複審):無期限 10 位的老師只看到 30、60 位的選項': async () => {
    const access = { active: true, source: 'legacy', until: null, server_now: '2026-11-05T00:00:00Z', teacher_purchase_allowed: true, teacher_source: 'comp',
      teacher_active: true, seats: 10, teacher_until: null, plan_starts: { teacher10: null, teacher30: '2026-11-05T00:00:00Z', teacher60: '2026-11-05T00:00:00Z' } };
    const D = domLoad({ access });
    D.K.buyDialog('teacher', null);
    const box = D.dom.body.byClass('modal-buy')[0];
    const vals = box ? box.find(n => n.tagName === 'INPUT' && n.attrs.type === 'radio').map(x => x.attrs.value) : [];
    return { ok: vals.join() === 'teacher30_month,teacher30_year,teacher60_month,teacher60_year', detail: vals.join() };
  },
  '價格頁的購買區:有說明的照文字放,不放按鈕時只有說明;班級提供的同時有按鈕與說明': async () => {
    const D = domLoad();
    const free = D.K.buySlot('student', true, { button: false, note: '你的帳號可以免費使用練習功能，不需要購買學生方案。' });
    const cls = D.K.buySlot('student', true, { button: true, note: '你的練習功能目前由班級提供。' });
    const plain = D.K.buySlot('credits', true, { button: true, note: null });
    const btns = el => el.find(n => n.tagName === 'BUTTON');
    const checks = [btns(free).length === 0 && /不需要購買學生方案/.test(free.textContent),
      btns(cls).length === 1 && /由班級提供/.test(cls.textContent) && btns(cls)[0].textContent === '購買學生方案',
      btns(plain).length === 1 && plain.textContent === '購買寫作批改'];
    return { ok: checks.every(Boolean), detail: [free.textContent, cls.textContent, plain.textContent].join(' | ') };
  },

  /* ---------- 購買視窗:起算日、開始使用的定義、送出中 ---------- */
  '起算說明:學生接在試用或已付的期間之後;老師買較多人從今天開始不退差額,同人數或較少接在後面;到期了不寫': async () => {
    const { K } = load(makeWorld());
    const now = '2026-11-05T00:00:00Z';
    const n = (sku, a) => K.startNote(sku, Object.assign({ server_now: now }, a));
    const t1 = n('student_month', { trial_until: '2026-11-08T01:00:00Z', paid_through: null });
    const t2 = n('student_year', { trial_until: '2026-11-03T01:00:00Z', paid_through: '2026-11-30T15:59:59Z' });
    const t3 = n('student_month', { trial_until: '2026-11-01T01:00:00Z', paid_through: null });
    const T = { teacher_source: 'paid', teacher_active: true, seats: 10, teacher_until: '2026-11-30T15:59:59Z' };
    const u1 = n('teacher30_month', T);
    const u2 = n('teacher10_year', T);
    const u3 = n('teacher10_month', Object.assign({}, T, { seats: 30 }));
    const u4 = n('teacher30_month', Object.assign({}, T, { teacher_active: false, teacher_until: '2026-11-03T15:59:59Z' }));
    const c = n('correction_five', T);
    const checks = [/接在 2026\/11\/08 之後開始/.test(t1 || ''), /接在 2026\/11\/30 之後開始/.test(t2 || ''), t3 === null,
      u1 === '改買人數較多的方案從今天開始，原本的方案剩下的天數不退差額。', /接在 2026\/11\/30 之後開始/.test(u2 || ''),
      /接在 2026\/11\/30 之後開始/.test(u3 || ''), u4 === null, c === null, K.startNote('student_month', null) === null];
    return { ok: checks.every(Boolean), detail: [t1, t2, t3, u1, u2, u3, u4, c].join(' | ') };
  },
  '起算說明(第一輪複審):有伺服器的 plan_starts 就照它寫;10 位一年加 30 位一個月再續 30 位,接在 30 位那段之後': async () => {
    const { K } = load(makeWorld());
    const now = '2026-10-17T01:00:00.000Z';
    const a = { server_now: now, teacher_source: 'paid', teacher_active: true, seats: 30, teacher_until: '2027-10-16T16:30:00.000Z',
      trial_until: '2026-10-01T00:00:00Z', paid_through: '2027-03-15T00:00:00Z',
      plan_starts: { student: now, teacher10: '2027-10-16T16:30:00.000Z', teacher30: '2026-11-16T16:30:00.000Z', teacher60: now } };
    const r = ['teacher30_month', 'teacher10_year', 'teacher60_month', 'student_month'].map(s => K.startNote(s, a));
    const b = Object.assign({}, a, { plan_starts: { student: '2026-12-01T00:00:00Z' } });
    const checks = [r[0] === '這次買的方案接在 2026/11/17 之後開始。', r[1] === '這次買的方案接在 2027/10/17 之後開始。',
      r[2] === '改買人數較多的方案從今天開始，原本的方案剩下的天數不退差額。',
      /* 學生:伺服器說今天開始(例如還沒開始的贈送接不上),就不寫接在已付期間之後 */
      r[3] === null, K.startNote('student_month', b) === '這次買的方案接在 2026/12/01 之後開始。'];
    return { ok: checks.every(Boolean), detail: r.concat([K.startNote('student_month', b)]).join(' | ') };
  },
  '購買視窗:勾選框下面寫怎樣算開始使用,小字連到退款政策;起算說明跟著選項換;送出中寫正在前往付款頁並標忙碌,出錯恢復並顯示伺服器的話': async () => {
    let reject;
    const access = { active: true, source: 'trial', until: '2026-11-08T01:00:00Z', trial_until: '2026-11-08T01:00:00Z', paid_through: null, server_now: '2026-11-05T00:00:00Z',
      teacher_purchase_allowed: true, teacher_source: 'paid', teacher_active: true, seats: 10, teacher_until: '2026-11-30T15:59:59Z' };
    const D = domLoad({ access, cloud: { startCheckout: () => new Promise((res, rej) => { reject = rej; }) } });
    D.K.buyDialog('teacher', null);
    const box = D.dom.body.byClass('modal-buy')[0];
    if (!box) return { ok: false, detail: '沒有視窗' };
    const def = box.byClass('buy-def')[0];
    const agree = box.find(n => n.tagName === 'INPUT' && n.attrs.type === 'checkbox')[0];
    const note = () => box.byClass('buy-note')[0];
    const note1 = note() ? note().textContent : '';
    const r30 = box.find(n => n.tagName === 'INPUT' && n.attrs.value === 'teacher30_month')[0];
    box.find(n => n.tagName === 'INPUT' && n.attrs.type === 'radio').forEach(x => { x.checked = false; });
    r30.checked = true;
    await r30.fire('change'); await settle();
    const note2 = note() ? note().textContent : '';
    agree.checked = true; await agree.fire('change');
    const submit = box.byClass('buy-submit')[0];
    submit.focus();
    box.byClass('auth-form')[0].fire('submit'); await settle();
    const sending = { text: submit.textContent, busy: box.getAttribute('aria-busy'), dis: submit.disabled };
    D.dom.body.focus();   // 瀏覽器在按鈕停用時把焦點丟到 body,這裡照做
    if (reject) reject(new Error('11 月 1 日開放購買。'));
    await settle();
    const after = { text: submit.textContent, busy: box.getAttribute('aria-busy'), dis: submit.disabled, msg: box.byClass('auth-msg')[0].textContent };
    const links = box.find(n => n.tagName === 'A').map(a => a.attrs.href);
    let inBox = D.dom.document.activeElement;
    while (inBox && inBox !== box) inBox = inBox.parentNode;
    const mask = box.parentNode;
    const checks = [
      /* 這裡開的是老師方案的視窗:第二輪複審起寫老師方案自己的定義(學生方案、批改的視窗照舊,見第二輪複審的案例) */
      !!def && def.textContent === '老師方案開始計算後，用過任何一項需要方案的練習功能、有學生用邀請碼加入你的班級，或在教師後台查看過班上學生的練習進度，就算開始使用。',
      /* 被拒絕後焦點回到視窗裡(第一輪複審) */
      inBox === box && D.dom.document.activeElement === submit,
      /* 視窗比畫面高時可以捲動(第一輪複審) */
      !!mask && /\bbuy-mask\b/.test(mask.className),
      !!def && agree.attrs['aria-describedby'] === def.attrs.id,
      links.includes('refund.html') && links.includes('terms.html'),
      /接在 2026\/11\/30 之後開始/.test(note1), /人數較多/.test(note2),
      sending.text === '正在前往付款頁…' && sending.busy === 'true' && sending.dis === true,
      after.text === '前往付款' && after.busy !== 'true' && after.dis === false && after.msg === '11 月 1 日開放購買。',
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') + ' ' + JSON.stringify({ note1, note2, sending, after, links }) };
  },
  /* ---------- 第二輪複審(2026-10-17) ---------- */
  '學生方案(第二輪複審):老師方案在期內的人,按鈕旁寫老師方案已經包含練習功能;購買視窗照 plan_starts 寫接在老師方案之後': async () => {
    const { K } = load(makeWorld());
    const now = '2026-10-17T01:00:00.000Z';
    const t = { active: true, until: '2026-11-20T01:00:00Z', source: 'paid', plan: 'teacher', is_owner: false, teacher_active: true, teacher_live: true,
      teacher_source: 'paid', teacher_until: '2026-11-17T01:00:00Z', seats: 10, teacher_purchase_allowed: true, server_now: now,
      plan_starts: { student: '2026-11-17T01:00:00.000Z', teacher10: '2026-11-17T01:00:00.000Z', teacher30: now, teacher60: now } };
    const grace = Object.assign({}, t, { teacher_active: false, teacher_in_grace: true, plan_starts: { student: now } });
    const BY_T = '你的老師方案已經包含練習功能，學生方案會接在老師方案之後開始。';
    const s = a => K.slotFor('student', { signedIn: true, access: a });
    const checks = [
      JSON.stringify(s(t)) === JSON.stringify({ button: true, note: BY_T }),
      K.startNote('student_month', t) === '這次買的方案接在 2026/11/17 之後開始。',
      JSON.stringify(s(grace)) === JSON.stringify({ button: true, note: null }),
      JSON.stringify(s({ active: true, until: null, source: 'owner', is_owner: true, teacher_active: true })) === JSON.stringify({ button: false, note: '你的帳號可以免費使用練習功能，不需要購買學生方案。' }),
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') + ' ' + JSON.stringify([s(t), s(grace)]) };
  },
  '老師方案的名額說明(第二輪複審):無期限 10 位加上有期限的 30 位升級,寫無期限那一段的 10 位;舊資料庫看不出來時不寫人數': async () => {
    const { K } = load(makeWorld());
    const now = '2026-10-17T01:00:00.000Z';
    const a = { teacher_purchase_allowed: true, is_owner: false, teacher_source: 'comp', teacher_until: null, seats: 30, teacher_no_end_seats: 10,
      teacher_active: true, server_now: now, plan_starts: { student: now, teacher10: null, teacher30: '2026-11-17T01:00:00.000Z', teacher60: now } };
    const old = Object.assign({}, a);
    delete old.teacher_no_end_seats;
    const n = x => K.slotFor('teacher', { signedIn: true, access: x }).note;
    const checks = [
      n(a) === '你的老師方案沒有期限，名額 10' + NB + '位以內。需要更多名額再購買。',
      K.teacherSkus(a).join() === 'teacher30_month,teacher30_year,teacher60_month,teacher60_year',
      /* 舊資料庫:seats 是 30,但 30 位還在賣,看不出無期限那一段有幾位,就不寫人數 */
      n(old) === '你的老師方案沒有期限，需要更多名額再購買。',
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') + ' ' + JSON.stringify([n(a), n(old)]) };
  },
  '購買視窗(第二輪複審):老師方案的「開始使用」寫老師方案的功能,退款政策也寫;學生方案照舊;條款版本換新': async () => {
    const access = { active: true, source: 'trial', until: '2026-11-08T01:00:00Z', trial_until: '2026-11-08T01:00:00Z', server_now: '2026-11-05T00:00:00Z',
      teacher_purchase_allowed: true, teacher_source: null, teacher_active: false, teacher_until: null };
    const defOf = group => { const D = domLoad({ access }); D.K.buyDialog(group, null); const box = D.dom.body.byClass('modal-buy')[0]; return { K: D.K, def: box ? box.byClass('buy-def')[0].textContent : '' }; };
    const t = defOf('teacher'), s = defOf('student'), c = defOf('credits');
    const { CONSENT_VERSION } = await PROD_MOD;
    const refund = text('refund.html');
    const checks = [
      t.def === t.K.CONSENT_DEF_TEACHER && /有學生用邀請碼加入你的班級/.test(t.def) && /查看過班上學生的練習進度/.test(t.def) && /需要方案的練習功能/.test(t.def),
      s.def === s.K.CONSENT_DEF && !/邀請碼/.test(s.def), c.def === s.K.CONSENT_DEF_CREDITS,
      /老師方案開始計算後，有學生用邀請碼加入你的班級，或在教師後台查看過班上學生的練習進度，就算開始使用。/.test(refund),
      CONSENT_VERSION === 'terms-2026-10-17',
      copyProblems(t.K.CONSENT_DEF_TEACHER).length === 0,
    ];
    return { ok: checks.every(Boolean), detail: checks.map(x => (x ? 'o' : 'x')).join('') + ' ' + JSON.stringify([t.def, s.def, CONSENT_VERSION]) };
  },
  '購買視窗(第二輪複審):送出中焦點移到視窗標題(按鈕停用時不會掉到頁面後面),提示區寫正在前往付款頁': async () => {
    const access = { active: true, source: 'trial', until: '2026-11-08T01:00:00Z', trial_until: '2026-11-08T01:00:00Z', server_now: '2026-11-05T00:00:00Z' };
    const D = domLoad({ access, cloud: { startCheckout: () => new Promise(() => {}) } });
    D.K.buyDialog('student', null);
    const box = D.dom.body.byClass('modal-buy')[0];
    if (!box) return { ok: false, detail: '沒有視窗' };
    const agree = box.find(n => n.tagName === 'INPUT' && n.attrs.type === 'checkbox')[0];
    agree.checked = true; await agree.fire('change');
    const submit = box.byClass('buy-submit')[0];
    submit.focus();
    box.byClass('auth-form')[0].fire('submit'); await settle();
    const head = box.find(n => n.attrs && n.attrs.id === 'buy-h')[0];
    const msg = box.byClass('auth-msg')[0];
    const active = D.dom.document.activeElement;
    const checks = [!!head && active === head, !!head && head.attrs.tabindex === '-1', submit.disabled === true,
      msg.textContent === '正在前往付款頁…' && msg.attrs.role === 'alert', !/\bbad\b/.test(msg.className)];
    return { ok: checks.every(Boolean), detail: checks.map(x => (x ? 'o' : 'x')).join('') + ' ' + JSON.stringify({ active: active && (active.attrs.id || active.tagName), msg: msg.textContent }) };
  },
  '購買視窗與價格頁的小字(第二輪複審):在白底的對比至少 4.5:1,開始使用的定義至少 13.5px': async () => {
    const css = read('css/style.css');
    const root = (/:root\s*\{([^}]*)\}/.exec(css) || [])[1] || '';
    const vars = {};
    root.replace(/(--[\w-]+)\s*:\s*([^;]+);/g, (m, k, v) => { vars[k] = v.trim(); return m; });
    const rule = sel => { const m = new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(css); return m ? m[2] : ''; };
    const prop = (body, p) => { const m = new RegExp('(?:^|;|\\s)' + p + '\\s*:\\s*([^;]+)').exec(body); return m ? m[1].trim() : ''; };
    const resolve = v => { let x = v; for (let i = 0; i < 5; i++) { const m = /^var\((--[\w-]+)\)$/.exec(x); if (!m) break; x = vars[m[1]] || ''; } return x; };
    const lum = hex => { const h = hex.replace('#', ''); const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const ratio = hex => /^#[0-9a-f]{6}$/i.test(hex) ? 1.05 / (lum(hex) + 0.05) : 0;
    const sels = ['.buy-def', '.buy-note', '.pricing-buy-note', '.modal-buy .auth-fine'];
    const got = sels.map(s => { const c = resolve(prop(rule(s), 'color')); return [s, c, Math.round(ratio(c) * 100) / 100]; });
    const size = parseFloat(prop(rule('.buy-def'), 'font-size'));
    const ok = got.every(g => g[2] >= 4.5) && size >= 13.5;
    return { ok, detail: JSON.stringify({ got, size }) };
  },
  '付款頁面其他小字(第三輪複審):訂單編號、付款帳號的信箱在白底,「我的」付款紀錄的小標題在淺灰底,對比都至少 4.5:1': async () => {
    const css = read('css/style.css');
    const root = (/:root\s*\{([^}]*)\}/.exec(css) || [])[1] || '';
    const vars = {};
    root.replace(/(--[\w-]+)\s*:\s*([^;]+);/g, (m, k, v) => { vars[k] = v.trim(); return m; });
    const rule = sel => { const m = new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(css); return m ? m[2] : ''; };
    const prop = (body, p) => { const m = new RegExp('(?:^|;|\\s)' + p + '\\s*:\\s*([^;]+)').exec(body); return m ? m[1].trim() : ''; };
    const resolve = v => { let x = v; for (let i = 0; i < 5; i++) { const m = /^var\((--[\w-]+)\)$/.exec(x); if (!m) break; x = vars[m[1]] || ''; } return x; };
    const lum = hex => { const h = hex.replace('#', ''); const c = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const ratio = (fg, bg) => /^#[0-9a-f]{6}$/i.test(fg) && /^#[0-9a-f]{6}$/i.test(bg) ? (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05) : 0;
    const got = [['.pay-order', '#ffffff'], ['.trial-who', '#ffffff'], ['.me-bill-h', resolve('var(--bg-soft)')]]
      .map(([s, bg]) => { const c = resolve(prop(rule(s), 'color')); return [s, c, bg, Math.round(ratio(c, bg) * 100) / 100]; });
    return { ok: got.every(g => g[3] >= 4.5), detail: JSON.stringify(got) };
  },
  '購買視窗(第三輪複審):學生方案與寫作批改各寫自己的「開始使用」,跟退款政策的那一句一字不差': async () => {
    const access = { active: true, source: 'trial', until: '2026-11-08T01:00:00Z', trial_until: '2026-11-08T01:00:00Z', server_now: '2026-11-05T00:00:00Z',
      teacher_purchase_allowed: true, teacher_source: null, teacher_active: false, teacher_until: null };
    const defOf = group => { const D = domLoad({ access }); D.K.buyDialog(group, null); const box = D.dom.body.byClass('modal-buy')[0]; return box ? box.byClass('buy-def')[0].textContent : ''; };
    const s = defOf('student'), c = defOf('credits');
    const refund = text('refund.html');
    const norm = x => x.split(NB).join(' ');
    const checks = [
      !!s && refund.includes(norm(s)) && /需要方案的練習功能/.test(s) && !/批改/.test(s),
      !!c && refund.includes(norm(c)) && /5 篇批改服務批改過其中一篇，就算開始使用。/.test(norm(c)) && !/練習功能/.test(c),
      copyProblems(s).length === 0 && copyProblems(c).length === 0,
    ];
    return { ok: checks.every(Boolean), detail: checks.map(x => (x ? 'o' : 'x')).join('') + ' ' + JSON.stringify([s, c]) };
  },
  '購買視窗(第三輪複審):送出中「正在前往付款頁」畫面上只出現一次(提示區照樣朗讀,但看不到)': async () => {
    const access = { active: true, source: 'trial', until: '2026-11-08T01:00:00Z', trial_until: '2026-11-08T01:00:00Z', server_now: '2026-11-05T00:00:00Z' };
    let reject;
    const D = domLoad({ access, cloud: { startCheckout: () => new Promise((res, rej) => { reject = rej; }) } });
    D.K.buyDialog('student', null);
    const box = D.dom.body.byClass('modal-buy')[0];
    if (!box) return { ok: false, detail: '沒有視窗' };
    const agree = box.find(n => n.tagName === 'INPUT' && n.attrs.type === 'checkbox')[0];
    agree.checked = true; await agree.fire('change');
    box.byClass('auth-form')[0].fire('submit'); await settle();
    const css = read('css/style.css');
    const hiddenCls = ((/\.auth-msg\.([\w-]+)\s*\{[^}]*clip:\s*rect\(0 0 0 0\)[^}]*\}/.exec(css)) || [])[1] || '';
    const isHidden = n => { for (let x = n; x && x !== box; x = x.parentNode) if (hiddenCls && x.className && new RegExp('\\b' + hiddenCls + '\\b').test(x.className)) return true; return false; };
    const own = n => (n.children || []).every(ch => ch.nodeType === 3);
    const sendingNodes = box.find(n => n.nodeType === 1 && own(n) && n.textContent === '正在前往付款頁…');
    const visible = sendingNodes.filter(n => !isHidden(n));
    const msg = box.byClass('auth-msg')[0];
    const during = { visible: visible.length, all: sendingNodes.length, msg: msg.textContent, role: msg.attrs.role };
    if (reject) reject(new Error('11 月 1 日開放購買。'));
    await settle();
    const after = { msg: msg.textContent, hidden: isHidden(msg) };
    const checks = [!!hiddenCls, during.visible === 1, during.all === 2 && during.msg === '正在前往付款頁…' && during.role === 'alert',
      after.msg === '11 月 1 日開放購買。' && after.hidden === false];
    return { ok: checks.every(Boolean), detail: checks.map(x => (x ? 'o' : 'x')).join('') + ' ' + JSON.stringify({ hiddenCls, during, after }) };
  },
  '付款結果(第三輪複審):主要按鈕照買的項目;老師方案前往教師後台,寫作批改前往寫作練習並寫加入幾篇,學生方案開始練習': async () => {
    const { K } = load(makeWorld());
    const v = row => K.stateView({ state: 'paid', row });
    const tea = v({ status: 'paid', sku: 'teacher30_year', item: 'teacher', seats: 30, months: 12, amount: 8900, applied: true, server_now: '2026-10-17T01:00:00Z',
      plan: { starts_at: '2026-10-17T01:00:00Z', ends_at: '2027-11-03T01:00:00Z' } });
    const five = v({ status: 'paid', sku: 'correction_five', item: 'credits', credits: 5, amount: 650, applied: true, access: { until: null } });
    const one = v({ status: 'paid', sku: 'correction_one', item: 'credits', credits: 1, amount: 150, applied: true });
    const stu = v({ status: 'paid', sku: 'student_month', item: 'student', months: 1, amount: 199, applied: true, server_now: '2026-10-17T01:00:00Z',
      plan: { starts_at: '2026-10-17T01:00:00Z', ends_at: '2026-11-17T01:00:00Z' } });
    const prim = x => x.actions.find(a => a.primary) || {};
    const checks = [
      prim(tea).text === '前往教師後台' && prim(tea).href === 'admin.html' && tea.actions.some(a => a.href === 'me.html'),
      prim(five).text === '前往寫作練習' && prim(five).href === 'writing.html' && five.lines[1] === '已經加入 5' + NB + '篇批改。',
      prim(one).href === 'writing.html' && one.lines[1] === '已經加入 1' + NB + '篇批改。',
      prim(stu).text === '開始練習' && prim(stu).href === 'index.html',
      [tea, five, one, stu].every(x => x.actions.filter(a => a.primary).length === 1 && copyProblems([x.title].concat(x.lines).join('\n')).length === 0),
    ];
    return { ok: checks.every(Boolean), detail: checks.map(x => (x ? 'o' : 'x')).join('') + ' ' + JSON.stringify([prim(tea), prim(five), five.lines, prim(stu)]) };
  },
  '條款(第三輪複審):老師購買學生方案,接在自己的老師方案後面(跟資料庫 _plan_start 同一個規則)': async () => {
    const t = text('terms.html');
    const li = (/<li>方案從開通當天開始計算。[\s\S]*?<\/li>/.exec(html('terms.html')) || [''])[0];
    const checks = [/老師購買學生方案，接在自己的老師方案後面。/.test(li), copyProblems(t).length === 0];
    return { ok: checks.every(Boolean), detail: checks.map(x => (x ? 'o' : 'x')).join('') + ' ' + li.slice(0, 200) };
  },
  'startCheckout:新的回應形狀 { error: 代碼, message: 中文 } 顯示 message;只有英文代碼時不顯示代碼': async () => {
    const msg = async (fetchImpl) => {
      const w = makeWorld({ fetch: fetchImpl });
      const p = load(w); await p.ready;
      try { await p.C.startCheckout('student_month', '2026-11-01T01:30:00.000Z'); return 'ok'; } catch (e) { return e.message; }
    };
    const a = await msg(() => okJson(409, { error: 'not_open', message: '11 月 1 日開放購買。' }));
    const b = await msg(() => okJson(409, { error: 'not_allowed', message: '你的帳號已經可以使用，不需要購買這個方案。' }));
    const c = await msg(() => okJson(409, { error: 'not_open' }));
    const d = await msg(() => okJson(405, { error: 'method not allowed' }));
    const checks = [a === '11 月 1 日開放購買。', b === '你的帳號已經可以使用，不需要購買這個方案。', c === '暫時無法建立付款，請稍後再試。', d === '暫時無法建立付款，請稍後再試。'];
    return { ok: checks.every(Boolean), detail: [a, b, c, d].join(' | ') };
  },

  /* ---------- 付款結果:沒有套用、取消付款、退回 my_billing、到期日 ---------- */
  '付款結果的狀態:已付款但沒有套用是 unapplied;test10 不看 applied;my_billing 退回來的已付款不當成功(slow)': async () => {
    const { K } = load(makeWorld());
    const s = r => K.resultOf(r).state;
    const r = [s({ status: 'paid', sku: 'student_month', applied: false }), s({ status: 'paid', sku: 'student_month', applied: true }),
      s({ status: 'paid', sku: 'student_month' }), s({ status: 'paid', sku: 'test10', applied: true }), s({ status: 'paid', sku: 'test10', applied: false }),
      s({ status: 'paid', via: 'billing', item: 'credits', credits: 1, amount: 10 }), s({ status: 'failed', via: 'billing' }), s({ status: 'pending', via: 'billing' })];
    return { ok: r.join() === 'unapplied,paid,paid,test,test,slow,failed,pending', detail: r.join() };
  },
  '付款結果的文字:成功寫使用到哪天;沒有套用寫站長處理;取消付款的主要按鈕回方案與價格;期間寫一個月/一年': async () => {
    const { K } = load(makeWorld());
    const v = (state, row, extra) => K.stateView(Object.assign({ state }, row ? { row } : {}, extra || {}));
    const stu = v('paid', { status: 'paid', sku: 'student_year', item: 'student', months: 12, amount: 1990, applied: true, access: { until: '2027-11-16T15:59:59Z', paid_through: '2027-11-16T15:59:59Z' } });
    const tea = v('paid', { status: 'paid', sku: 'teacher30_month', item: 'teacher', seats: 30, months: 1, amount: 890, applied: true, access: { until: '2026-12-04T15:59:59Z', teacher_until: '2026-12-01T15:59:59Z' } });
    const cre = v('paid', { status: 'paid', sku: 'correction_one', item: 'credits', credits: 1, amount: 150, applied: true, access: { until: null } });
    const un = v('unapplied', { status: 'paid', sku: 'student_month', item: 'student', months: 1, amount: 199, applied: false });
    /* 第一輪複審:my_checkout 的 plan(這次買的那一段)優先;排在後面才開始的寫哪天開始 */
    const later = v('paid', { status: 'paid', sku: 'teacher30_month', item: 'teacher', seats: 30, months: 1, amount: 890, applied: true, server_now: '2026-10-17T01:00:00Z',
      plan: { starts_at: '2026-11-16T16:30:00Z', ends_at: '2026-12-16T16:30:00Z' }, access: { teacher_until: '2027-10-16T16:30:00Z' } });
    const today = v('paid', { status: 'paid', sku: 'student_month', item: 'student', months: 1, amount: 199, applied: true, server_now: '2026-10-17T01:00:00Z',
      plan: { starts_at: '2026-10-17T01:00:00Z', ends_at: '2026-11-17T01:00:00Z' }, access: { paid_through: '2027-01-15T00:00:00Z' } });
    const back = v('cancelled', { status: 'pending', sku: 'student_month', item: 'student', months: 1, amount: 199 });
    const back0 = v('cancelled');
    const slowW = v('slow', null, { waited: true }), slowN = v('slow', { status: 'paid', item: 'student', months: 1, amount: 199, via: 'billing' });
    const all = [stu, tea, cre, un, back, back0, slowW, slowN, later, today];
    const checks = [
      stu.lines[0] === '學生方案 一年，1,990' + NB + '元。' && stu.lines[1] === '已經開通，使用到 2027/11/16。',
      tea.lines[0] === '老師方案 30' + NB + '位以內 一個月，890' + NB + '元。' && tea.lines[1] === '已經開通，使用到 2026/12/01。',
      cre.lines[1] === '已經加入 1' + NB + '篇批改。',   // 第三輪複審:以前寫「已經開通。」
      un.title === '已收到付款' && un.lines.includes('開通需要站長處理，站長會寫信給你。') && !un.lines.some(l => /^已收到付款/.test(l))
        && !/我們/.test(un.lines.join('')) && !/已經開通/.test(un.lines.join('')),
      later.lines[1] === '已經開通，2026/11/17 開始，使用到 2026/12/17。',
      today.lines[1] === '已經開通，使用到 2026/11/17。',
      back.title === '付款沒有完成' && back.lines.includes('如果已經刷卡成功，幾分鐘後會出現在「我的」頁的方案與付款。')
        && back.actions[0].href === 'pricing.html' && back.actions[0].primary === true && !back.actions.some(a => a.retry),
      back0.title === '付款沒有完成',
      /等了 1 分鐘/.test(slowW.lines.join('')) && !/等了/.test(slowN.lines.join('')) && slowN.title === '處理中',
      all.every(x => copyProblems([x.title].concat(x.lines).join('\n')).length === 0),
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') + ' ' + JSON.stringify([stu.lines, tea.lines, un.lines]) };
  },
  'lookup:退回 my_billing 找到的那一筆標上 via billing;poll 遇到它馬上停在 slow,不更新使用權;沒有套用也馬上停': async () => {
    const w = makeWorld({ paid: true, rpc: {
      my_checkout: () => Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } }),
      my_billing: () => Promise.resolve({ data: { payments: [{ merchant_trade_no: ORDER, status: 'paid', item: 'credits', credits: 1, amount: 10 }] }, error: null }),
    } });
    const p = load(w); await p.ready;
    const row = await p.K.lookup(ORDER);
    const ck = clock(0);
    const acc0 = w.rpcCalls.filter(c => c[0] === 'my_access').length;
    const fin = await p.K.poll(ORDER, { now: ck.now, wait: ck.wait, onState() {} });
    const acc1 = w.rpcCalls.filter(c => c[0] === 'my_access').length;
    const w2 = makeWorld({ paid: true, rpc: { my_checkout: () => Promise.resolve({ data: { status: 'paid', sku: 'student_month', applied: false }, error: null }) } });
    const p2 = load(w2); await p2.ready;
    const ck2 = clock(0);
    const fin2 = await p2.K.poll(ORDER, { now: ck2.now, wait: ck2.wait, onState() {} });
    const checks = [!!row && row.via === 'billing', fin.state === 'slow', ck.now() === 0, acc1 === acc0, fin2.state === 'unapplied', ck2.now() === 0];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') + ' ' + fin.state + '/' + fin2.state };
  },
  'checkOnce(從藍新按返回商店):只查一次;還在處理中就當付款沒有完成;已付款照樣顯示成功並更新使用權': async () => {
    const one = async (resp, billingDown) => {
      let n = 0;
      const w = makeWorld({ paid: true, rpc: { my_checkout: () => { n++; return typeof resp === 'function' ? resp() : Promise.resolve(resp); },
        my_billing: () => (billingDown ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ data: { payments: [] }, error: null })) } });
      const p = load(w); await p.ready;
      const acc0 = w.rpcCalls.filter(c => c[0] === 'my_access').length;
      const st = await p.K.checkOnce(ORDER);
      return { st: st.state, n, refreshed: w.rpcCalls.filter(c => c[0] === 'my_access').length - acc0 };
    };
    const a = await one({ data: { status: 'pending', sku: 'student_month' }, error: null });
    const b = await one({ data: { status: 'paid', sku: 'student_month', applied: true }, error: null });
    const c = await one({ data: null, error: null });
    const d = await one(() => Promise.reject(new TypeError('Failed to fetch')), true);
    const { K } = load(makeWorld());
    const flags = [K.backFlag('?back=1'), K.backFlag('?o=' + ORDER + '&back=1'), K.backFlag('?back=0'), K.backFlag('')];
    const checks = [a.st === 'cancelled' && a.n === 1, b.st === 'paid' && b.n === 1 && b.refreshed === 1, c.st === 'missing', d.st === 'cancelled',
      flags.join() === 'true,true,false,false'];
    return { ok: checks.every(Boolean), detail: JSON.stringify({ a, b, c, d, flags }) };
  },
  'pay-result.js:狀態沒變不重畫;最後結果把焦點移到標題;朗讀區在不會被換掉的 #pay-root': async () => {
    const seq = ['pending', 'pending', 'pending', 'paid'];
    let n = 0;
    const D = domLoad({ search: '?o=' + ORDER, cloud: { myCheckout: async () => ({ status: seq[Math.min(n++, 3)], sku: 'student_month', item: 'student', months: 1, amount: 199, applied: true,
      access: { until: '2026-12-01T15:59:59Z', paid_through: '2026-12-01T15:59:59Z' } }) } });
    const Rs = await runResult(D);
    const head = Rs.root.find(x => x.tagName === 'H2')[0];
    const pr = html('pay-result.html');
    const checks = [Rs.renders.filter(r => /^處理中/.test(r)).length === 1 && Rs.renders.length <= 4, /付款成功/.test(Rs.root.textContent) && /使用到 2026\/12\/01/.test(Rs.root.textContent),
      !!head && head.attrs.tabindex === '-1' && D.dom.document.activeElement === head, n === 4,
      /<div id="pay-root" role="status" aria-live="polite"><\/div>/.test(pr), !Rs.root.find(x => x.tagName === 'SECTION' && x.attrs.role).length];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') + ' renders ' + Rs.renders.length + ' / ' + n };
  },
  'pay-result.js:?back=1 只查一次,處理中就寫付款沒有完成,主要按鈕回方案與價格,不輪詢': async () => {
    let n = 0;
    const D = domLoad({ search: '?back=1', cloud: { myCheckout: async () => { n++; return { status: 'pending', sku: 'student_month', item: 'student', months: 1, amount: 199 }; } } });
    D.ctx.sessionStorage.setItem('tr_pay_last', JSON.stringify({ o: ORDER, at: Date.now() }));
    const Rs = await runResult(D);
    const t = Rs.root.textContent;
    const first = Rs.root.find(x => x.tagName === 'A' || x.tagName === 'BUTTON')[0];
    const checks = [n === 1, /付款沒有完成/.test(t), /如果已經刷卡成功/.test(t), !/處理中/.test(t), !!first && first.attrs.href === 'pricing.html' && /primary/.test(first.className),
      /訂單編號 /.test(t)];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') + ' ' + t.slice(0, 120) };
  },
  'pay-result.js:按「再查一次」後焦點不會掉回頁面開頭(移到標題)': async () => {
    const D = domLoad({ search: '?o=' + ORDER, cloud: { myCheckout: async () => { throw new Error('x'); },
      myBilling: async () => ({ payments: [{ merchant_trade_no: ORDER, status: 'paid', item: 'student', months: 1, amount: 199 }] }) } });
    const Rs = await runResult(D);
    const retry = Rs.root.find(x => x.tagName === 'BUTTON' && x.textContent === '再查一次')[0];
    if (!retry) return { ok: false, detail: '沒有再查一次 ' + Rs.root.textContent.slice(0, 80) };
    retry.focus();
    await retry.click(); await settle();
    const active = D.dom.document.activeElement;
    return { ok: !!active && active.tagName === 'H2', detail: active ? active.tagName : 'null' };
  },

  /* ---------- 頁面與文案 ---------- */
  '價格頁:11 月 1 日起收費,不再寫免費開放;載入購買程式;同意句子一字不差': async () => {
    const pr = html('pricing.html');
    const t = text('pricing.html');
    const order = ['js/cloud-config.js', 'js/plans-config.js', 'js/common.js', 'js/cloud.js', 'js/profile.js', 'js/checkout.js'].map(s => pr.indexOf('src="' + s + '"'));
    const checks = [
      /11 月 1 日起收費。/.test(t), !/目前全站免費開放/.test(t), !/開始收費的日期/.test(t), !/線上付款準備中/.test(t),
      order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])),
      CHECKOUT_SRC.includes("'" + CONSENT_TEXT + "'"),
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') + ' ' + order.join(',') };
  },
  '條款:2026 年 10 月 31 日以前免費、11 月 1 日起收費;只收信用卡;同意的地方寫本站付款前;解除權後面補(7 天猶豫期),跟勾選句對得上': async () => {
    const t = text('terms.html');
    const checks = [t.includes('不適用這 7 天的解除權（7 天猶豫期）'), text('refund.html').includes('不適用 7 天的解除權（7 天猶豫期）'),
      /href="refund\.html"/.test((/消費者權益[\s\S]*?<\/ul>/.exec(html('terms.html')) || [''])[0]),
      text('pricing.html').includes('新帳號可以免費試用 7 天，從信箱驗證完成那天起算。'),t.includes('2026 年 10 月 31 日以前全站免費開放，2026 年 11 月 1 日起收費。'), !/目前全站免費開放/.test(t),
      /信用卡/.test(t), !/付款頁會請你勾選/.test(t), /勾選同意/.test(t)];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') };
  },
  '價格、條款、隱私、退款頁都不提 ATM、WebATM、付款銀行代碼;退款寫退回原信用卡': async () => {
    const pages = ['pricing.html', 'terms.html', 'privacy.html', 'refund.html'];
    const bad = pages.filter(p => /ATM|WebATM|網路銀行|付款銀行代碼|轉帳付款/i.test(text(p)));
    const refund = text('refund.html');
    const checks = [bad.length === 0, /退回原信用卡/.test(refund), /信用卡/.test(text('pricing.html'))];
    return { ok: checks.every(Boolean), detail: '還有 ATM:' + (bad.join('、') || '無') };
  },
  '條款的適用日期跟伺服器記的同意版本(CONSENT_VERSION)是同一天': async () => {
    const { CONSENT_VERSION } = await PROD_MOD;
    const m = /(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日起適用/.exec(text('terms.html'));
    const day = m ? 'terms-' + m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : '';
    const refund = /(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日起適用/.exec(text('refund.html'));
    const rday = refund ? 'terms-' + refund[1] + '-' + refund[2].padStart(2, '0') + '-' + refund[3].padStart(2, '0') : '';
    return { ok: day === CONSENT_VERSION && rday === CONSENT_VERSION, detail: day + ' / ' + rday + ' / ' + CONSENT_VERSION };
  },
  'pay-result.html:noindex、沒有分頁列、載入順序對,外殼標題、版面檢查都有登記': async () => {
    const pr = html('pay-result.html');
    const order = ['js/cloud-config.js', 'js/plans-config.js', 'js/common.js', 'js/cloud.js', 'js/profile.js', 'js/checkout.js', 'js/pay-result.js'].map(s => pr.indexOf('src="' + s + '"'));
    const boot = (/if \(\[([^\]]*)\]\.indexOf\(p\) < 0\) d\.classList\.add\('has-tabbar'\)/.exec(pr) || [])[1] || '';
    const checks = [
      /<meta name="robots" content="noindex">/.test(pr), /<title>付款結果｜衝衝英文<\/title>|<title>付款結果\|衝衝英文<\/title>/.test(pr),
      boot.includes("'pay-result.html'"), order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), /id="pay-root"/.test(pr),
      /'pay-result\.html': '付款結果'/.test(read('js/app-shell.js')), /pay-result\.html/.test(read('tools/check_layout.js')),
      !/sitemap/.test('') && !read('sitemap.xml').includes('pay-result'),
    ];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') };
  },
  '購買視窗的外框(第一輪複審):視窗比畫面高時外框可以捲動,從頂端開始排': async () => {
    const css = read('css/style.css');
    const rule = (/\.modal-mask\.buy-mask\s*\{([^}]*)\}/.exec(css) || [])[1] || '';
    const inner = (/\.modal-mask\.buy-mask\s*>\s*\.modal\s*\{([^}]*)\}/.exec(css) || [])[1] || '';
    const checks = [/overflow-y:\s*auto/.test(rule), /align-items:\s*flex-start/.test(rule), /margin:\s*auto/.test(inner),
      /class: 'modal-mask buy-mask'/.test(CHECKOUT_SRC)];
    return { ok: checks.every(Boolean), detail: checks.map(c => (c ? 'o' : 'x')).join('') + ' ' + rule.trim() };
  },
  '新寫的文案沒有 emoji、破折號、「不是…而是」、半形標點': async () => {
    const srcs = { 'js/checkout.js': CHECKOUT_SRC, 'js/pay-result.js': RESULT_SRC };
    const probs = [];
    Object.entries(srcs).forEach(([f, s]) => jsStrings(s).forEach(x => { const p = copyProblems(x); if (p.length) probs.push(f + ':' + p.join('/') + ':' + x.slice(0, 30)); }));
    ['pricing.html', 'terms.html', 'privacy.html', 'refund.html', 'pay-result.html'].forEach(f => {
      const p = copyProblems(text(f));
      if (p.length) probs.push(f + ':' + p.join('/'));
    });
    return { ok: probs.length === 0 && CHECKOUT_SRC.length > 0 && RESULT_SRC.length > 0, detail: probs.join(' | ') || '無' };
  },
  '付款相關的檔案沒有站長的個人資料:信箱只有聯絡信箱,也對不上任何一筆擋下的雜湊': async () => {
    /* 先確認檢查本身會抓:放進去的字找得到,換掉一個字就找不到,大小寫不影響 */
    const probe = [{ len: 5, sha256: sha256('abcde') }, { len: 2, sha256: sha256('雞蛋') }];
    const self = [
      hashedHits('xxABCDEyy', probe).join() === '0', hashedHits('吃雞蛋糕', probe).join() === '1',
      hashedHits('abcdf 雞肉', probe).length === 0,
      foreignEmails('寫信到 ' + CONTACT_EMAIL + ' 或 SHUASHUALANGUAGE@GMAIL.COM').length === 0,
      foreignEmails('寫信到 someone@example.com').length === 1,
    ];
    const files = ['js/checkout.js', 'js/pay-result.js', 'js/paywall.js', 'js/profile.js', 'js/cloud.js',
      'pay-result.html', 'pricing.html', 'terms.html', 'privacy.html', 'refund.html', 'me.html'];
    const probs = [];
    files.forEach(f => {
      const s = tryRead(f);
      if (!s) { probs.push(f + ':讀不到'); return; }
      const mails = foreignEmails(s);
      if (mails.length) probs.push(f + ':有聯絡信箱以外的信箱 ' + mails.length + ' 個');
      const hits = hashedHits(s, PRIVATE_HASHES);
      if (hits.length) probs.push(f + ':對上擋下的雜湊第 ' + hits.join('、') + ' 筆');
    });
    const ok = self.every(Boolean) && probs.length === 0;
    return { ok, detail: 'self ' + self.map(c => (c ? 'o' : 'x')).join('') + ' ' + (probs.join(' | ') || files.length + ' 個檔案都乾淨') };
  },
};

(async () => {
  let pass = 0;
  for (const [name, fn] of Object.entries(cases)) {
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.message) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + r.detail);
  }
  console.log(pass + ' / ' + Object.keys(cases).length + ' 通過');
  process.exit(pass === Object.keys(cases).length ? 0 : 1);
})();
