/* 付費牆(js/paywall.js)的判斷邏輯:要不要蓋遮罩、遮罩寫什麼、試用快結束的提示條、「我的」頁的方案文字。
   重點:使用權不知道(null、錯誤、逾時、離線、雲端沒開、PAID_UI 不是 true)一律不鎖、不顯示;
   站長、班級涵蓋的人不鎖;writing.html 有批改篇數就放行;除了自己的提示條鍵,不碰 localStorage。
   cloud.js 用「雲端沒開」的方式一起載入(paywall.js 會用到 CLOUD.locked、CLOUD.trialEndsSoon)。
   用法:node tools/test_paywall.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const CLOUD_SRC = read('js/cloud.js');
let PAYWALL_SRC = '';
try { PAYWALL_SRC = read('js/paywall.js'); } catch (e) { /* 還沒寫:每一項都會失敗 */ }

const NOW = '2026-10-07T03:00:00Z';
const UID = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72';
const BANNER_KEY = 'tr_trial_note_closed';
const NB = '\u00a0';

/* 記錄每一次讀寫的 localStorage */
function makeStorage() {
  const m = new Map(), log = [];
  return {
    log,
    getItem: k => { log.push(['get', k]); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { log.push(['set', k]); m.set(k, String(v)); },
    removeItem: k => { log.push(['remove', k]); m.delete(k); },
    clear: () => { log.push(['clear']); m.clear(); },
    key: i => { const a = Array.from(m.keys()); return i < a.length ? a[i] : null; },
    get length() { return m.size; },
  };
}

/* 載入 cloud.js(雲端沒開)與 paywall.js。document 會記下被碰了幾次 */
function load(o) {
  o = o || {};
  const touched = [];
  const doc = new Proxy({}, { get(t, k) { touched.push(String(k)); if (k === 'addEventListener') return () => {}; return undefined; } });
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    setTimeout, clearTimeout, URLSearchParams,
    localStorage: o.local || makeStorage(), sessionStorage: makeStorage(),
    location: { hash: '', search: o.search || '', pathname: o.pathname || '/reading.html', origin: 'https://x', href: 'https://x' + (o.pathname || '/reading.html') + (o.search || ''), reload() {} },
    history: { replaceState() {} },
    document: doc,
    navigator: { onLine: true },
    addEventListener() {},
  };
  ctx.window = ctx;
  if (o.grammar) ctx.TOEIC = { grammar: o.grammar };
  if (o.MutationObserver) ctx.MutationObserver = o.MutationObserver;
  if (o.paid !== undefined) ctx.PAID_UI = o.paid;
  vm.createContext(ctx);
  vm.runInContext(CLOUD_SRC, ctx);
  touched.length = 0;   // cloud.js 本身碰 document 的不算
  vm.runInContext(PAYWALL_SRC, ctx);
  return { ctx, P: ctx.PAYWALL, C: ctx.CLOUD, touched, local: ctx.localStorage };
}

const base = o => Object.assign({ active: false, source: 'none', is_owner: false, is_teacher: false, role: 'student', until: null,
  trial_until: '2026-10-10T17:00:00Z', paid_through: null, credits: 0, classes: [], server_now: NOW }, o);
const LOCK = { paidUi: true, locked: true, page: 'paid' };
const kindOf = r => (r ? r.kind : null);

const cases = {
  'paywall.js 載入後有 PAYWALL,PAID_UI 沒開時完全不碰 document': () => {
    const a = load({ paid: false }), b = load({});
    return { ok: !!(a.P && b.P) && a.touched.length === 0 && b.touched.length === 0 && a.P.enabled() === false && b.P.enabled() === false,
      detail: 'false:' + a.touched.length + ' 次 / 未定義:' + b.touched.length + ' 次' };
  },
  'PAID_UI 打開但雲端沒開:不掛任何東西,locked 永遠 false': () => {
    const { P, C, touched } = load({ paid: true });
    const r = P.decide(base(), { paidUi: true, locked: C.locked(), page: 'paid' });
    return { ok: touched.length === 0 && C.locked() === false && r === null, detail: 'document ' + touched.length + ' 次 / locked ' + C.locked() + ' / ' + kindOf(r) };
  },
  '哪些頁面要擋:功能頁擋、寫作頁另外算、其他不擋': () => {
    const { P } = load({ paid: true });
    const paid = ['reading', 'practice', 'listening', 'grammar', 'vocab', 'mock', 'review', 'dialogue', 'phonics'];
    const free = ['index', 'learn', 'drill', 'verbs', 'me', 'history', 'analysis', 'admin', 'signup', 'terms', 'reset', 'pricing', 'diagnostic', 'offline', 'tenses'];
    const r = {
      paid: paid.every(p => P.pageKind('/' + p + '.html', '') === 'paid'),
      sub: P.pageKind('/toeic-training/reading.html', '?id=a3') === 'paid',
      writing: P.pageKind('/writing.html', '') === 'writing',
      free: free.every(p => P.pageKind('/' + p + '.html', '') === null),
      root: P.pageKind('/', '') === null,
      tenses: P.pageKind('/grammar.html', '?ref=tenses') === 'paid',
      verbs: P.pageKind('/grammar.html', '?ref=verbs') === null && P.pageKind('/grammar.html', '?u=c3&ref=verbs') === 'paid',   // 有 u 時 grammar.js 先畫課程
      unit: P.pageKind('/grammar.html', '?u=c3') === 'paid',
    };
    return { ok: Object.values(r).every(Boolean), detail: JSON.stringify(r) };
  },
  '使用權不知道:null、不是物件、陣列,一律不鎖': () => {
    const { P } = load({ paid: true });
    const r = [null, undefined, 'x', 3, [], {}].map(a => P.decide(a, LOCK));
    return { ok: r.every(x => x === null), detail: r.map(kindOf).join(',') };
  },
  'PAID_UI 不是 true、這個分頁沒從伺服器拿到 active false(locked false)、不是功能頁:都不鎖': () => {
    const { P } = load({ paid: true });
    const a = base();
    const r = [
      P.decide(a, { paidUi: false, locked: true, page: 'paid' }),
      P.decide(a, { paidUi: 'true', locked: true, page: 'paid' }),
      P.decide(a, { paidUi: true, locked: false, page: 'paid' }),
      P.decide(a, { paidUi: true, locked: true, page: null }),
      P.decide(base({ active: true }), LOCK),
      P.decide(base({ active: null }), LOCK),
    ];
    return { ok: r.every(x => x === null), detail: r.map(kindOf).join(',') };
  },
  '站長、班級涵蓋(包括站長的班)的人:就算 active false 也不鎖': () => {
    const { P } = load({ paid: true });
    const r = [
      P.decide(base({ is_owner: true }), LOCK),
      P.decide(base({ classes: [{ class_id: 'k1', class_name: '晨讀班', covered: true, reason: null }] }), LOCK),
      P.decide(base({ classes: [{ class_id: 'k1', covered: false, reason: 'expired' }, { class_id: 'k2', covered: true, reason: null }] }), LOCK),
    ];
    return { ok: r.every(x => x === null), detail: r.map(kindOf).join(',') };
  },
  '遮罩的訊息順序:班級老師到期 > 名額已滿 > 試用結束 > 方案到期': () => {
    const { P } = load({ paid: true });
    const both = P.decide(base({ classes: [{ class_id: 'a', covered: false, reason: 'over_seats' }, { class_id: 'b', covered: false, reason: 'expired' }], paid_through: '2026-10-01T00:00:00Z' }), LOCK);
    const seats = P.decide(base({ classes: [{ class_id: 'a', covered: false, reason: 'over_seats' }] }), LOCK);
    const trial = P.decide(base(), LOCK);
    const plan = P.decide(base({ paid_through: '2026-11-03T16:30:00Z' }), LOCK);
    const ok = both.kind === 'class_expired' && both.title === '班級老師的方案已到期' && both.line === '請聯絡老師'
      && seats.kind === 'over_seats' && seats.title === '班級名額已滿' && seats.line === '請聯絡老師'
      && trial.kind === 'trial_ended' && trial.title === '試用已結束' && trial.line === '試用到 10 月 11 日'
      && plan.kind === 'expired' && plan.title === '方案已到期' && plan.line === '到期日 2026/11/04';
    return { ok, detail: [both, seats, trial, plan].map(r => r && r.kind + ':' + r.title + '/' + r.line).join(' | ') };
  },
  '試用結束但沒有 trial_until:只有標題,不寫壞掉的日期': () => {
    const { P } = load({ paid: true });
    const r = P.decide(base({ trial_until: null }), LOCK);
    const bad = P.decide(base({ trial_until: 'abc' }), LOCK);
    return { ok: r.kind === 'trial_ended' && r.line === '' && bad.line === '', detail: JSON.stringify([r.line, bad.line]) };
  },
  '寫作頁:有批改篇數就放行;沒有就擋;別的頁有篇數照樣擋': () => {
    const { P } = load({ paid: true });
    const w1 = P.decide(base({ credits: 2 }), { paidUi: true, locked: true, page: 'writing' });
    const w0 = P.decide(base({ credits: 0 }), { paidUi: true, locked: true, page: 'writing' });
    const wNeg = P.decide(base({ credits: -1 }), { paidUi: true, locked: true, page: 'writing' });
    const wStr = P.decide(base({ credits: '3' }), { paidUi: true, locked: true, page: 'writing' });
    const r1 = P.decide(base({ credits: 2 }), LOCK);
    return { ok: w1 === null && kindOf(w0) === 'trial_ended' && kindOf(wNeg) === 'trial_ended' && kindOf(wStr) === 'trial_ended' && kindOf(r1) === 'trial_ended',
      detail: [kindOf(w1), kindOf(w0), kindOf(wNeg), kindOf(wStr), kindOf(r1)].join(',') };
  },
  '日期格式(台北時間):10 月 11 日、2026/11/04;壞掉的日期回空字串': () => {
    const { P } = load({ paid: true });
    const r = [P.fmtDay('2026-10-10T17:00:00Z'), P.fmtDay('2026-10-10T15:59:00Z'), P.fmtDate('2026-11-03T16:30:00Z'), P.fmtDate('2026-01-05T00:00:00Z'), P.fmtDate(null), P.fmtDay('x')];
    return { ok: r.join('|') === '10 月 11 日|10 月 10 日|2026/11/04|2026/01/05||', detail: r.join('|') };
  },
  '試用快結束的提示條:只有試用中而且 2 天內;關掉後同一個到期日不再出現': () => {
    const local = makeStorage();
    const { P } = load({ paid: true, local });
    const soon = base({ active: true, source: 'trial', until: '2026-10-08T17:00:00Z' });
    const opt = { paidUi: true, page: 'paid', uid: UID };
    const a = P.banner(soon, opt);
    const far = P.banner(base({ active: true, source: 'trial', until: '2026-10-10T03:00:01Z' }), opt);
    const paidInTrial = P.banner(base({ active: true, source: 'trial', until: '2026-11-08T00:00:00Z', paid_through: '2026-11-08T00:00:00Z' }), opt);
    const legacy = P.banner(base({ active: true, source: 'legacy', until: '2026-10-08T00:00:00Z' }), opt);
    const off = P.banner(soon, { paidUi: false, page: 'paid', uid: UID });
    const noPage = P.banner(soon, { paidUi: true, page: null, uid: UID });
    const unknown = P.banner(null, opt);
    P.dismissBanner(UID, soon.until);
    const after = P.banner(soon, opt);
    const other = P.banner(base({ active: true, source: 'trial', until: '2026-10-09T00:00:00Z' }), opt);
    const otherUser = P.banner(soon, { paidUi: true, page: 'paid', uid: 'aaaaaaaa-0000-4000-8000-000000000001' });
    const ok = a && a.text === '試用到 10 月 9 日' && far === null && paidInTrial === null && legacy === null && off === null && noPage === null
      && unknown === null && after === null && other && otherUser;
    return { ok, detail: JSON.stringify({ a, far, paidInTrial, legacy, off, after, other: !!other, otherUser: !!otherUser }) };
  },
  '寫作頁有篇數的人照樣看得到試用提示條;遮罩出現時不放提示條(已鎖的人不是試用中)': () => {
    const { P } = load({ paid: true });
    const soon = base({ active: true, source: 'trial', until: '2026-10-08T17:00:00Z', credits: 3 });
    const w = P.banner(soon, { paidUi: true, page: 'writing', uid: UID });
    const locked = P.banner(base({ source: 'trial', until: '2026-10-08T17:00:00Z' }), { paidUi: true, page: 'paid', uid: UID });
    return { ok: !!w && locked === null, detail: JSON.stringify({ w, locked }) };
  },
  'localStorage:判斷與格式化一個鍵都不讀不寫;提示條只讀寫自己的新鍵,從不刪任何鍵': () => {
    const local = makeStorage();
    local.setItem('tr_uc1_grammar_done', '{"a1":1}'); local.setItem('tr_unsynced_x', '{}'); local.log.length = 0;
    const { P } = load({ paid: true, local });
    const pre = local.log.length;
    P.decide(base(), LOCK); P.status(base({ active: true, source: 'trial', until: NOW })); P.teacherLine(base()); P.classStatus(base(), 'k');
    P.fmtDate(NOW); P.fmtDay(NOW); P.billingLines({ grants: [], payments: [] }); P.showCredits(base(), null);
    const pure = local.log.length - pre;
    const soon = base({ active: true, source: 'trial', until: '2026-10-08T17:00:00Z' });
    P.banner(soon, { paidUi: true, page: 'paid', uid: UID }); P.dismissBanner(UID, soon.until); P.banner(soon, { paidUi: true, page: 'paid', uid: UID });
    const keys = new Set(local.log.map(l => l[1]));
    const removes = local.log.filter(l => l[0] !== 'get' && l[0] !== 'set');
    const ok = pure === 0 && [...keys].every(k => k === BANNER_KEY) && removes.length === 0 && local.getItem('tr_uc1_grammar_done') === '{"a1":1}';
    return { ok, detail: '判斷時 ' + pure + ' 次 / 碰到的鍵 ' + [...keys].join(',') + ' / 刪除 ' + removes.length };
  },
  '提示條的鍵壞掉或 localStorage 丟例外:照樣判斷,不會壞': () => {
    const local = makeStorage();
    local.setItem(BANNER_KEY, '{壞掉');
    const { P, ctx } = load({ paid: true, local });
    const soon = base({ active: true, source: 'trial', until: '2026-10-08T17:00:00Z' });
    const a = P.banner(soon, { paidUi: true, page: 'paid', uid: UID });
    ctx.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('x'); } };
    let threw = false, b = null;
    try { b = P.banner(soon, { paidUi: true, page: 'paid', uid: UID }); P.dismissBanner(UID, soon.until); } catch (e) { threw = true; }
    return { ok: !!a && !!b && !threw, detail: JSON.stringify({ a: !!a, b: !!b, threw }) };
  },
  '「我的」頁方案狀態(六.1 的順序):站長不顯示、已付費、legacy、班級、試用、到期': () => {
    const { P } = load({ paid: true });
    const t = o => P.status(base(Object.assign({ active: true }, o)));
    const r = {
      owner: P.status(base({ active: true, is_owner: true, source: 'owner' })),
      paid: t({ source: 'trial', paid_through: '2026-11-03T16:30:00Z', rights: ['paid', 'trial'] }),
      comp: t({ source: 'comp', paid_through: '2026-11-03T16:30:00Z', rights: ['comp'] }),
      legacy: t({ source: 'legacy' }),
      legacyUntil: t({ source: 'legacy', until: '2026-11-03T16:30:00Z' }),
      cls: t({ source: 'class' }),
      clsUntil: t({ source: 'class', until: '2026-11-03T16:30:00Z' }),
      trial: t({ source: 'trial', until: '2026-10-10T17:00:00Z' }),
      expired: P.status(base({ paid_through: '2026-10-01T00:00:00Z' })),
      unknown: P.status(null),
    };
    const ok = r.owner === null && r.paid.text === '已付費，到 2026/11/04' && r.comp.text === '使用到 2026/11/04'
      && r.legacy.text === '使用期限 無' && r.legacyUntil.text === '使用到 2026/11/04'
      && r.cls.text === '由班級老師提供' && r.clsUntil.text === '由班級老師提供，到 2026/11/04'
      && r.trial.text === '試用到 10 月 11 日' && r.expired.text === '使用期限已到' && r.expired.expired === true && !r.paid.expired && r.unknown === null;
    return { ok, detail: JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && v.text]))) };
  },
  '老師方案那一列:只有 teacher_source 有值才出現;站長不出現': () => {
    const { P } = load({ paid: true });
    const r = [
      P.teacherLine(base({ active: true, is_teacher: true, teacher_source: 'paid', seats: 30, teacher_until: '2026-11-03T16:30:00Z' })),
      P.teacherLine(base({ active: true, is_teacher: true, teacher_source: 'trial', seats: 10, teacher_until: '2026-10-13T17:00:00Z' })),
      P.teacherLine(base({ active: true, is_teacher: true, teacher_source: 'legacy', seats: null, teacher_until: null })),
      P.teacherLine(base({ active: true, is_teacher: true, teacher_source: 'paid', seats: 30, teacher_until: '2026-10-01T00:00:00Z', teacher_in_grace: true })),
      P.teacherLine(base({ active: true, teacher_source: null, seats: 30 })),
      P.teacherLine(base({ active: true, is_owner: true, is_teacher: true, teacher_source: 'owner' })),
      P.teacherLine(null),
    ];
    const ok = r[0] === '老師方案 30 人，到 2026/11/04' && r[1] === '老師試用 10 人，到 2026/10/14' && r[2] === '老師方案 名額不限'
      && r[3] === '老師方案 30 人，2026/10/01 到期' && r[4] === null && r[5] === null && r[6] === null;
    return { ok, detail: JSON.stringify(r) };
  },
  '班級列的狀態:由班級提供、老師方案已到期、超過名額;找不到或不知道就不寫': () => {
    const { P } = load({ paid: true });
    const a = base({ classes: [{ class_id: 'k1', covered: true, reason: null }, { class_id: 'k2', covered: false, reason: 'expired' }, { class_id: 'k3', covered: false, reason: 'over_seats' }, { class_id: 'k4', covered: false, reason: null }] });
    const r = ['k1', 'k2', 'k3', 'k4', 'k9'].map(id => P.classStatus(a, id)).concat([P.classStatus(null, 'k1'), P.classStatus(base({ classes: null }), 'k1')]);
    return { ok: r.join('|') === '由班級提供|老師方案已到期|超過名額||||', detail: r.join('|') };
  },
  '寫作批改那一列:有篇數、或買過(付款或點數紀錄)才出現;文字是「寫作批改 剩 N 篇」': () => {
    const { P } = load({ paid: true });
    const r = {
      has: P.showCredits(base({ credits: 4 }), null),
      none: P.showCredits(base({ credits: 0 }), null),
      bought: P.showCredits(base({ credits: 0 }), { payments: [{ item: 'credits', status: 'paid' }], credit_log: [] }),
      logged: P.showCredits(base({ credits: 0 }), { payments: [], credit_log: [{ delta: 5, reason: 'purchase' }] }),
      other: P.showCredits(base({ credits: 0 }), { payments: [{ item: 'student', status: 'paid' }], credit_log: [] }),
      unknown: P.showCredits(null, null),
      text: P.creditsText(4) + '/' + P.creditsText(0),
    };
    const ok = r.has && !r.none && r.bought && r.logged && !r.other && !r.unknown && r.text === '寫作批改 剩 4 篇/寫作批改 剩 0 篇';
    return { ok, detail: JSON.stringify(r) };
  },
  '方案與付款:使用期間與付款紀錄寫成一行一筆,日期 2026/11/04,金額千分位,不出現點數或儲值': () => {
    const { P } = load({ paid: true });
    const b = {
      grants: [
        { kind: 'student', source: 'legacy', seats: null, starts_at: '2026-10-07T03:00:00Z', ends_at: null, revoked_at: null },
        { kind: 'student', source: 'paid', seats: null, starts_at: '2026-10-11T03:00:00Z', ends_at: '2027-10-11T03:00:00Z', revoked_at: null },
        { kind: 'teacher', source: 'trial', seats: 30, starts_at: '2026-10-07T03:00:00Z', ends_at: '2026-10-14T03:00:00Z', revoked_at: '2026-10-08T03:00:00Z' },
        { kind: 'student', source: 'comp', seats: null, starts_at: '2026-10-07T03:00:00Z', ends_at: '2026-12-07T03:00:00Z', revoked_at: null },
      ],
      payments: [
        { item: 'student', months: 12, seats: null, credits: null, amount: 1990, status: 'paid', paid_at: '2026-10-07T03:00:00Z', created_at: '2026-10-07T03:00:00Z' },
        { item: 'teacher', months: 1, seats: 30, credits: null, amount: 890, status: 'refunded', refund_amount: 890, paid_at: '2026-10-07T03:00:00Z', created_at: '2026-10-07T03:00:00Z' },
        { item: 'credits', months: null, seats: null, credits: 5, amount: 650, status: 'pending', paid_at: null, created_at: '2026-10-08T03:00:00Z' },
      ],
      credit_log: [],
    };
    const r = P.billingLines(b);
    const g = r.grants.map(x => x.text), p = r.payments.map(x => x.text);
    const all = JSON.stringify(r);
    /* 數字與單位、「到」與後面的日期用不換行空白(U+00A0),窄螢幕不會把「元」或日期單獨擠到下一行;付款紀錄新的在上面 */
    const ok = g[0] === '學生方案 既有帳號 2026/10/07 起 無期限'
      && g[1] === '學生方案 付費 2026/10/11 到' + NB + '2027/10/11'
      && g[2] === '老師試用 30' + NB + '人 2026/10/07 到' + NB + '2026/10/14 已撤銷'
      && g[3] === '學生方案 贈送 2026/10/07 到' + NB + '2026/12/07'
      && p[0] === '2026/10/08 寫作批改 5' + NB + '篇 650' + NB + '元 處理中'
      && p[1] === '2026/10/07 老師方案 30' + NB + '人 1' + NB + '個月 890' + NB + '元 已退款 890' + NB + '元'
      && p[2] === '2026/10/07 學生方案 12' + NB + '個月 1,990' + NB + '元'
      && b.payments[0].item === 'student'
      && !/點數|儲值/.test(all) && P.billingLines(null).grants.length === 0 && P.billingLines({}).payments.length === 0;
    return { ok, detail: JSON.stringify({ g, p }) };
  },

  'grammar.html 的網址跟 grammar.js 一樣用 URLSearchParams 讀(鍵也解碼),u 要是真的課程才算課程': () => {
    const { P } = load({ paid: true, grammar: [{ id: 'gc-01' }, { id: 'gc-02' }] });
    const k = q => P.pageKind('/grammar.html', q);
    const r = {
      verbs: k('?ref=verbs'), emptyU: k('?ref=verbs&u='), encVal: k('?ref=%76erbs'),
      encKeyUnit: k('?ref=verbs&%75=gc-02'), badUnit: k('?ref=verbs&u=zzz'), encKeyRef: k('?%72ef=verbs'),
      unit: k('?ref=verbs&u=gc-02'), tenses: k('?ch=z'), home: k(''),
    };
    const ok = r.verbs === null && r.emptyU === null && r.encVal === null && r.encKeyUnit === 'paid' && r.badUnit === null
      && r.encKeyRef === null && r.unit === 'paid' && r.tenses === 'paid' && r.home === 'paid';
    return { ok, detail: JSON.stringify(r) };
  },
  '老師方案撐著的人(plan teacher,until 含 3 天寬限):名字下不另寫狀態,也不出試用提示條,日期只看老師那一列': () => {
    const { P } = load({ paid: true });
    const trialT = base({ active: true, source: 'trial', plan: 'teacher', role: 'teacher', is_teacher: true, teacher_source: 'trial', seats: 30,
      teacher_until: '2026-10-14T03:00:00Z', until: '2026-10-17T03:00:00Z', trial_until: '2026-10-08T03:00:00Z' });
    const lastDay = Object.assign({}, trialT, { server_now: '2026-10-15T03:00:00Z', teacher_in_grace: true });
    const paidT = base({ active: true, source: 'paid', plan: 'teacher', role: 'teacher', is_teacher: true, teacher_source: 'paid', seats: 30,
      teacher_until: '2026-11-04T03:00:00Z', until: '2026-11-07T03:00:00Z' });
    const paidStudentToo = base({ active: true, source: 'paid', plan: 'teacher', role: 'teacher', is_teacher: true, teacher_source: 'paid', seats: 30,
      teacher_until: '2026-11-04T03:00:00Z', until: '2026-11-07T03:00:00Z', paid_through: '2026-11-01T03:00:00Z', rights: ['paid'] });
    const r = {
      trialStatus: P.status(trialT), trialLine: P.teacherLine(trialT),
      bannerLastDay: P.banner(lastDay, { paidUi: true, page: 'paid', uid: UID }), lastDayLine: P.teacherLine(lastDay),
      paidStatus: P.status(paidT), paidLine: P.teacherLine(paidT),
      paidStudentToo: P.status(paidStudentToo),
    };
    const ok = r.trialStatus === null && r.trialLine === '老師試用 30 人，到 2026/10/14' && r.bannerLastDay === null
      && r.lastDayLine === '老師試用 30 人，2026/10/14 到期' && r.paidStatus === null && r.paidLine === '老師方案 30 人，到 2026/11/04'
      && !!r.paidStudentToo && r.paidStudentToo.text === '已付費，到 2026/11/01';
    return { ok, detail: JSON.stringify(r) };
  },
  '老師方案已結束(名額 0):不寫「名額不限」;沒有日期就寫已結束': () => {
    const { P } = load({ paid: true });
    const r = [
      P.teacherLine(base({ is_teacher: true, role: 'teacher', teacher_source: 'trial', seats: 0, teacher_until: '2026-10-01T03:00:00Z' })),
      P.teacherLine(base({ is_teacher: true, role: 'teacher', teacher_source: 'comp', seats: 0, teacher_until: null })),
      P.teacherLine(base({ active: true, is_teacher: true, role: 'teacher', teacher_source: 'legacy', seats: null, teacher_until: null })),
    ];
    const ok = r[0] === '老師試用 2026/10/01 到期' && r[1] === '老師方案 已結束' && r[2] === '老師方案 名額不限';
    return { ok, detail: JSON.stringify(r) };
  },
  '遮罩只在試用真的是最後一段時寫「試用已結束」:很久以前的試用、老師方案結束,各寫對的標題;跨年的日期帶年份': () => {
    const { P } = load({ paid: true });
    const r = {
      legacyEnded: P.decide(base({ trial_until: '2025-03-12T03:00:00Z' }), LOCK),
      oldTrial: P.decide(base({ trial_until: '2026-09-08T03:00:00Z' }), LOCK),
      recentTrial: P.decide(base({ trial_until: '2026-10-05T03:00:00Z' }), LOCK),
      teacherEnded: P.decide(base({ role: 'teacher', is_teacher: true, teacher_source: 'paid', seats: 0, teacher_until: '2026-10-01T03:00:00Z' }), LOCK),
      teacherTrialEnded: P.decide(base({ role: 'teacher', is_teacher: true, teacher_source: 'trial', seats: 0, teacher_until: '2026-10-02T03:00:00Z' }), LOCK),
      newYear: P.decide(base({ trial_until: '2026-12-30T17:00:00Z', server_now: '2027-01-02T03:00:00Z' }), LOCK),
    };
    const t = x => x && x.kind + ':' + x.title + '/' + x.line;
    const ok = t(r.legacyEnded) === 'ended:使用期限已到/' && t(r.oldTrial) === 'ended:使用期限已到/'
      && t(r.recentTrial) === 'trial_ended:試用已結束/試用到 10 月 5 日'
      && t(r.teacherEnded) === 'expired:方案已到期/到期日 2026/10/01'
      && t(r.teacherTrialEnded) === 'trial_ended:試用已結束/試用到 10 月 2 日'
      && t(r.newYear) === 'trial_ended:試用已結束/試用到 2026/12/31';
    return { ok, detail: JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, t(v)]))) };
  },
  '老師試用的回應:班級停用(active false)不把邀請碼當成能用的碼;回應遺失時從最新的使用權看出試用已開始': () => {
    const { P } = load({ paid: true });
    const r = {
      ok: P.trialOutcome({ code: 'K7MPQ2RX', name: '週六班', active: true, until: '2026-10-14T03:00:00Z' }),
      old: P.trialOutcome({ code: 'K7MPQ2RX', name: '週六班', until: '2026-10-14T03:00:00Z' }),
      closed: P.trialOutcome({ code: 'K7MPQ2RX', name: '舊班', active: false, until: '2026-10-14T03:00:00Z' }),
      junk: P.trialOutcome(null),
      started: P.trialStarted(base({ active: true, role: 'teacher', is_teacher: true, teacher_source: 'trial', teacher_trial_available: false })),
      notYet: P.trialStarted(base({ active: true, teacher_source: null, teacher_trial_available: true })),
      unknown: P.trialStarted(null),
    };
    const ok = r.ok.code === 'K7MPQ2RX' && !r.ok.closed && r.old.code === 'K7MPQ2RX' && !r.old.closed
      && r.closed.code === '' && r.closed.closed === true && r.junk.code === '' && !r.junk.closed
      && r.started === true && r.notYet === false && r.unknown === false;
    return { ok, detail: JSON.stringify(r) };
  },
  '模擬考進行中(body 有 data-leave-confirm):遮罩等交卷才出現,不蓋在考試上;沒在考試就馬上出現': () => {
    const observers = [];
    class MO { constructor(cb) { this.cb = cb; this.on = false; observers.push(this); } observe(t, o) { this.on = true; this.t = t; this.o = o; } disconnect() { this.on = false; } }
    const { P } = load({ paid: true, MutationObserver: MO });
    let shown = 0;
    const free = { dataset: {} };
    P.whenNoExam(free, () => shown++);
    const now = shown;
    const exam = { dataset: { leaveConfirm: '模擬考還沒交卷' } };
    P.whenNoExam(exam, () => shown++);
    const during = shown;
    const mo = observers[observers.length - 1];
    mo.cb([]); const stillDuring = shown;          // 別的屬性變了,考試還在
    delete exam.dataset.leaveConfirm; mo.cb([]);   // 交卷(mock.js submit 刪掉這個屬性)
    const after = shown;
    mo.cb([]);
    const ok = now === 1 && during === 1 && stillDuring === 1 && after === 2 && shown === 2 && mo.on === false
      && mo.t === exam && !!mo.o && mo.o.attributes === true && JSON.stringify(mo.o.attributeFilter) === '["data-leave-confirm"]';
    return { ok, detail: JSON.stringify({ now, during, stillDuring, after, end: shown, observing: mo && mo.on }) };
  },
  '全形標點:paywall.js 的中文字串裡沒有半形逗號、冒號、括號、問號、驚嘆號': () => {
    const strs = (PAYWALL_SRC.match(/'[^'\n]*'/g) || []).filter(s => /[一-鿿]/.test(s));
    const bad = strs.filter(s => /[一-鿿][,:;()?!]|[,:;()?!][一-鿿]/.test(s) || /—|–/.test(s));
    return { ok: strs.length > 0 && bad.length === 0, detail: strs.length + ' 個中文字串 / 有問題 ' + JSON.stringify(bad) };
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
