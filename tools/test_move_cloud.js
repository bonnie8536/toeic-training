/* 搬家計畫 2.7:js/cloud.js 的 flushForMove(舊網址寄出頁)與搬家暫存區 tr_move_pending_<帳號 id>(新網址登入灌資料時合併)。
   跟 tools/test_cloud_merge.js 同一套假的 Supabase、localStorage、時鐘與計時器;合併規則載入真的 js/move-rules.js、js/move-merge.js,
   小雞用真的 js/pet.js。用法:node tools/test_move_cloud.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const SRC = { cloud: read('js/cloud.js'), pet: read('js/pet.js'), food: read('js/pet-food.js'), rules: read('js/move-rules.js'), merge: read('js/move-merge.js'), daily: read('js/daily.js') };
const USER = { id: '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72', email: 's@x.com', user_metadata: { name: '學生' } };
const OTHER = '9a9a9a9a-0000-4000-8000-000000000000';
const PID = 'c' + USER.id.replace(/-/g, '');
const PREFIX = 'tr_u' + PID + '_';
const LEDGER = 'tr_unsynced_' + USER.id;
const PEND = 'tr_move_pending_' + USER.id;
const SB_KEY = 'sb-x-auth-token';
const HOUR = 3600e3;
const T0 = Date.parse('2026-11-05T12:00:00+08:00');
const iso = (t) => new Date(t).toISOString();
const J = (x) => JSON.stringify(x);
const bank = (id, name, words) => ({ id, name, words: words.map((w) => ({ en: w, zh: '中' + w })) });

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
    key: (i) => { const a = Array.from(m.keys()); return i < a.length ? a[i] : null; }, get length() { return m.size; }, dump: () => Object.fromEntries(m),
  };
}
function makeWorld() { return { db: [], local: makeStorage(), session: makeStorage(), offline: false, reloads: 0, clock: { t: T0 }, ops: [] }; }
function token(w) {
  const b64 = (o) => Buffer.from(J(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const iat = Math.floor(w.clock.t / 1000);
  return b64({ alg: 'HS256' }) + '.' + b64({ sub: USER.id, iat, exp: iat + 3600 }) + '.sig';
}
function makeClient(w) {
  return {
    auth: {
      getSession: async () => ({ data: { session: w.noSession ? null : { user: USER, access_token: token(w) } } }),
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => ({ error: null }),
    },
    rpc: async () => ({ error: null }),
    from(table) {
      const q = { op: null, filters: {}, row: null, cols: '' };
      const b = {
        select(c) { q.op = 'select'; q.cols = c; return b; }, eq(c, v) { q.filters[c] = v; return b; },
        upsert(row) { q.op = 'upsert'; q.row = row; return b; }, then(ok, bad) { return run().then(ok, bad); },
      };
      async function run() {
        w.ops.push({ table, op: q.op, k: q.op === 'upsert' ? q.row.k : (q.filters.k || '*'), cols: q.cols });
        if (w.offline) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
        if (table !== 'progress') return { data: [], error: null };
        if (q.op === 'select') return { data: w.db.filter((r) => r.user_id === q.filters.user_id && (q.filters.k === undefined || r.k === q.filters.k)).map((r) => JSON.parse(J(r))), error: null };
        const row = JSON.parse(J(q.row));
        const i = w.db.findIndex((r) => r.user_id === row.user_id && r.k === row.k);
        if (i >= 0) w.db[i] = row; else w.db.push(row);
        return { data: null, error: null };
      }
      return b;
    },
  };
}
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

/* opt.movers:'yes'(先載好 MOVE_RULES、MOVE_MERGE)、'fail'(要載時載不到)、不給同 'yes' */
function loadPage(w, opt) {
  opt = opt || {};
  const timers = new Map(); let tid = 0;
  const listeners = {};
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(w.clock.t); } static now() { return w.clock.t; } }
  const ctx = {
    console: { warn() {}, log() {}, error() {} }, Date: FakeDate,
    setTimeout: (fn) => { const id = ++tid; timers.set(id, fn); return id; }, clearTimeout: (id) => { timers.delete(id); },
    localStorage: w.local, sessionStorage: w.session,
    location: { hash: '', search: '', pathname: '/index.html', origin: 'https://www.rushuplanguage.com', href: 'https://www.rushuplanguage.com/index.html', reload() { w.reloads++; } },
    history: { replaceState() {} },
    document: {
      visibilityState: 'visible', addEventListener(ev, fn) { (listeners['doc:' + ev] = listeners['doc:' + ev] || []).push(fn); },
      createElement() { return {}; }, head: { appendChild(s) { w.scriptLoads = (w.scriptLoads || 0) + 1; Promise.resolve().then(() => s.onerror && s.onerror(new Error('404'))); } },
      querySelector() { return null; }, querySelectorAll() { return []; },
    },
    confirm: () => true, navigator: { get onLine() { return !w.offline; } }, URLSearchParams,
    atob: (s) => Buffer.from(s, 'base64').toString('latin1'),
  };
  ctx.window = ctx;
  ctx.addEventListener = (ev, fn) => { (listeners['win:' + ev] = listeners['win:' + ev] || []).push(fn); };
  ctx.dispatchEvent = () => true;
  ctx.CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'k' };
  ctx.supabase = { createClient: () => makeClient(w) };
  vm.createContext(ctx);
  try { ctx.__PROFILE_ID = JSON.parse(w.local.getItem('tr_current_profile')) || null; } catch (e) { ctx.__PROFILE_ID = null; }
  Object.assign(ctx, { PET_ON: true, PET_FOOD: true, PET_FOOD_FROM: '2026-10-20' });
  vm.runInContext(SRC.pet, ctx); vm.runInContext(SRC.food, ctx);
  if (opt.movers !== 'fail') { vm.runInContext(SRC.rules, ctx); vm.runInContext(SRC.merge, ctx); vm.runInContext(SRC.daily, ctx); }
  vm.runInContext(SRC.cloud, ctx);
  return {
    ctx,
    ready: ctx.CLOUD.ready.then(tick),
    async runTimers() { const fns = [...timers.values()]; timers.clear(); for (const f of fns) await f(); await tick(); },
    async fire(name) { (listeners[name] || []).forEach((f) => f()); await tick(); },
  };
}
function signedIn(w) { w.local.setItem(SB_KEY, J({ access_token: 'a', expires_at: 1, user: USER })); w.local.setItem('tr_current_profile', J(PID)); }
async function openLoggedIn(w, opt) {
  signedIn(w);
  let pg = loadPage(w, opt); await pg.ready;
  pg = loadPage(w, opt); await pg.ready;
  return pg;
}
function cloudRow(w, k, v, at, uid) { w.db.push({ user_id: uid || USER.id, k, v, updated_at: iso(at) }); }
const cv = (w, k) => { const r = w.db.find((r) => r.user_id === USER.id && r.k === k); return r ? r.v : undefined; };
const lv = (w, k) => { const raw = w.local.getItem(PREFIX + k); return raw === null ? null : JSON.parse(raw); };
const ledger = (w) => JSON.parse(w.local.getItem(LEDGER) || '{}');
const ups = (w) => w.ops.filter((o) => o.op === 'upsert' && o.k !== '_meta').map((o) => o.k);

const T = {};

T['flushForMove:帳本比雲端新的照常上傳;雲端比較新的不上傳、交給搬家包;這一頁之後關頁也不自動補傳它'] = async () => {
  const w = makeWorld();
  cloudRow(w, 'vgame_banks', [bank('b1', '雲端的', ['a'])], T0 - 24 * HOUR);
  cloudRow(w, 'hist', [], T0 - 24 * HOUR);
  const pg = await openLoggedIn(w);
  w.offline = true;
  w.clock.t += 1000; w.local.setItem(PREFIX + 'hist', J([{ m: 'p5', id: 'q', c: 1, ok: true, t: w.clock.t }])); pg.ctx.CLOUD.push('hist', 1);
  w.clock.t += 1000; w.local.setItem(PREFIX + 'vgame_banks', J([bank('b1', '雲端的', ['a']), bank('b2', '離線加的', ['z'])])); pg.ctx.CLOUD.push('vgame_banks', 1);
  await pg.runTimers();
  /* 別台(新網址)這時更新了雲端的題庫 */
  w.db.find((r) => r.k === 'vgame_banks').updated_at = iso(w.clock.t + 60e3);
  w.offline = false; w.ops = [];
  const r = await pg.ctx.CLOUD.flushForMove();
  const carried = (r.accounts[USER.id] || []).map((e) => e[0]);
  const upOnce = ups(w);
  await pg.fire('win:pagehide');
  const after = ups(w);
  const ok = r.left === 1 && J(carried) === J(['vgame_banks']) && J(upOnce) === J(['hist']) && J(after) === J(['hist'])
    && cv(w, 'vgame_banks')[0].name === '雲端的' && cv(w, 'vgame_banks').length === 1 && 'vgame_banks' in ledger(w);
  return { ok, detail: J({ left: r.left, carried, upOnce, after, ledger: ledger(w) }) };
};

T['flushForMove:離線時全部交給搬家包;什麼都沒有時不打任何請求;沒登入回空的'] = async () => {
  const w = makeWorld();
  const pg = await openLoggedIn(w);
  w.ops = [];
  const none = await pg.ctx.CLOUD.flushForMove();
  const quiet = w.ops.length === 0;
  w.offline = true;
  w.clock.t += 1000; w.local.setItem(PREFIX + 'diag', J({ done: true })); pg.ctx.CLOUD.push('diag', 1);
  await pg.runTimers();
  const r = await pg.ctx.CLOUD.flushForMove();
  const w2 = makeWorld();
  const pg2 = loadPage(w2); await pg2.ready;
  const g = await pg2.ctx.CLOUD.flushForMove();
  const ok = none.left === 0 && quiet && r.left === 1 && r.accounts[USER.id][0][0] === 'diag' && g.left === 0 && J(g.accounts) === '{}';
  return { ok, detail: J({ none, quiet, r: r.left, g }) };
};

T['暫存區:登入灌資料時題庫跟雲端那份聯集(兩邊的題庫都在),練習紀錄聯集,上傳後刪掉暫存區、帳本清空'] = async () => {
  const w = makeWorld();
  cloudRow(w, 'vgame_banks', [bank('b1', '雲端的', ['a'])], T0 - HOUR);
  cloudRow(w, 'hist', [{ m: 'p5', id: 'c', c: 1, ok: true, t: T0 - 2 * HOUR }], T0 - HOUR);
  w.local.setItem(PEND, J({ from: 'https://www.shuashualanguage.com', at: T0, items: [
    ['hist', J([{ m: 'p5', id: 'o', c: 2, ok: false, t: T0 - 3 * HOUR }]), T0 - 3 * HOUR],
    ['vgame_banks', J([bank('b2', '舊網址離線加的', ['z'])]), T0 - 3 * HOUR],
  ] }));
  await openLoggedIn(w);
  const banks = (cv(w, 'vgame_banks') || []).map((b) => b.name);
  const hist = (cv(w, 'hist') || []).map((r) => r.id);
  const ok = J(banks) === J(['雲端的', '舊網址離線加的']) && J(hist) === J(['o', 'c']) && w.local.getItem(PEND) === null && !Object.keys(ledger(w)).length
    && J(lv(w, 'vgame_banks').map((b) => b.name)) === J(banks);
  return { ok, detail: J({ banks, hist, pend: w.local.getItem(PEND), ledger: ledger(w) }) };
};

T['暫存區:單一值比雲端新才用,換掉的雲端那份備份;雲端比較新就用雲端的,暫存那份備份'] = async () => {
  const w = makeWorld();
  cloudRow(w, 'diag', { score: 1 }, T0 - 5 * HOUR);
  cloudRow(w, 'ph_slow', true, T0 - HOUR);
  w.local.setItem(PEND, J({ items: [['diag', J({ score: 2 }), T0 - 2 * HOUR], ['ph_slow', 'false', T0 - 3 * HOUR]] }));
  await openLoggedIn(w);
  const bk = Object.keys(w.local.dump()).filter((k) => /^tr_move_backup_/.test(k)).map((k) => JSON.parse(w.local.getItem(k)))[0];
  const ok = cv(w, 'diag').score === 2 && cv(w, 'ph_slow') === true && !!bk && J(bk.keys) === J([['diag', J({ score: 1 })], ['ph_slow', 'false']]);
  return { ok, detail: J({ diag: cv(w, 'diag'), slow: cv(w, 'ph_slow'), bk }) };
};

T['暫存區:寫作兩份都留(新的放原位、另一份 alt);閱讀題雲端已經答的不被換掉;文章單字兩份都留'] = async () => {
  const w = makeWorld();
  cloudRow(w, 'writing_y', { y1: { text: 'cloud essay', updatedAt: '2026-10-01T00:00:00Z' } }, T0 - HOUR);
  cloudRow(w, 'read_q_art1', { 0: 0 }, T0 - HOUR);
  cloudRow(w, 'vocab_art1', { 3: { t: '雲端' } }, T0 - HOUR);
  w.local.setItem(PEND, J({ items: [
    ['writing_y', J({ y1: { text: 'old site essay newer', updatedAt: '2026-10-23T00:00:00Z' } }), T0 - 2 * HOUR],
    ['read_q_art1', J({ 0: 2, 1: 1 }), T0 - 2 * HOUR],
    ['vocab_art1', J({ 3: { t: '舊網址' } }), T0 - 2 * HOUR],
  ] }));
  await openLoggedIn(w);
  const y = cv(w, 'writing_y') || {}, q = cv(w, 'read_q_art1'), v = cv(w, 'vocab_art1') || {};
  const ok = y.y1 && y.y1.text === 'old site essay newer' && J((y.y1.alt || []).map((a) => a.text)) === J(['cloud essay'])
    && J(q) === J({ 0: 0, 1: 1 }) && v[3] && v[3].t === '雲端' && J(v[3].alt) === J(['舊網址']) && w.local.getItem(PEND) === null;
  return { ok, detail: J({ y, q, v }) };
};

T['暫存區:別的帳號的不會用到;小雞本機沒有就放暫存那份、再跟雲端那份合併(兩邊的天數都在)'] = async () => {
  const w = makeWorld();
  const pet = (days) => ({ v: 1, born: '2026-10-01', goals: [], days, met: [], fed: {}, oldMet: 0, name: '' });
  cloudRow(w, 'pet', pet({ '2026-11-04': 7 }), T0 - HOUR);
  w.local.setItem('tr_move_pending_' + OTHER, J({ items: [['diag', '{}', 1]] }));
  w.local.setItem(PEND, J({ items: [['pet', J(pet({ '2026-11-01': 30 })), T0 - 2 * HOUR]] }));
  await openLoggedIn(w);
  const days = Object.keys((cv(w, 'pet') || {}).days || {}).sort();
  const ok = J(days) === J(['2026-11-01', '2026-11-04']) && w.local.getItem('tr_move_pending_' + OTHER) !== null && w.local.getItem(PEND) === null;
  return { ok, detail: J({ days, other: w.local.getItem('tr_move_pending_' + OTHER) }) };
};

T['暫存區:這個分頁已經灌過資料,有暫存區就重灌一次;合併程式載不到時暫存區留著,不會一直重新整理'] = async () => {
  const w = makeWorld();
  cloudRow(w, 'vgame_banks', [bank('b1', '雲端的', ['a'])], T0 - HOUR);
  const pg = await openLoggedIn(w);
  const r0 = w.reloads;
  w.local.setItem(PEND, J({ items: [['vgame_banks', J([bank('b9', '舊的', ['q'])]), T0 - 2 * HOUR]] }));
  const p1 = loadPage(w, { movers: 'fail' }); await p1.ready;
  const r1 = w.reloads;
  const p2 = loadPage(w, { movers: 'fail' }); await p2.ready;
  const r2 = w.reloads;
  const still = w.local.getItem(PEND) !== null;
  const bankNames = (cv(w, 'vgame_banks') || []).map((b) => b.name);
  const ok = r1 === r0 + 1 && r2 === r1 && still && J(bankNames) === J(['雲端的']) && !!pg;
  return { ok, detail: J({ r0, r1, r2, still, bankNames }) };
};

const backups = (w) => Object.keys(w.local.dump()).filter((k) => /^tr_move_backup_/.test(k)).map((k) => JSON.parse(w.local.getItem(k)));
const backupVals = (w) => [].concat(...backups(w).map((b) => b.keys.map((e) => e[1])));
/* 新網址這台登入中、離線時改了單一值(帳本記著),之後才收到舊網址的暫存區 */
async function offlineLocalEdit(w, k, v) {
  const pg = await openLoggedIn(w);
  w.offline = true;
  w.clock.t += 60e3;
  w.local.setItem(PREFIX + k, J(v)); pg.ctx.CLOUD.push(k, 1);
  await pg.runTimers();
  return w.clock.t;
}
async function newTab(w) { w.offline = false; w.session = makeStorage(); const p = loadPage(w); await p.ready; return p; }

T['暫存區:新網址本機帳本上比雲端新的單一值,暫存那份比較舊就留本機(上傳),暫存那份和雲端那份都備份'] = async () => {
  const w = makeWorld();
  cloudRow(w, 'diag', { tag: 'cloud' }, T0 - 10 * HOUR);
  const tl = await offlineLocalEdit(w, 'diag', { done: true, tag: 'new-origin-local' });
  w.local.setItem(PEND, J({ items: [['diag', J({ tag: 'old-origin' }), T0 - 5 * HOUR]] }));
  await newTab(w);
  const bv = backupVals(w);
  const ok = lv(w, 'diag').tag === 'new-origin-local' && cv(w, 'diag').tag === 'new-origin-local' && bv.includes(J({ tag: 'old-origin' })) && bv.includes(J({ tag: 'cloud' }))
    && w.local.getItem(PEND) === null && tl > 0;
  return { ok, detail: J({ local: lv(w, 'diag'), cloud: cv(w, 'diag'), bv }) };
};

T['暫存區:暫存那份比新網址本機帳本上的還新才用,換掉的本機那份備份'] = async () => {
  const w = makeWorld();
  cloudRow(w, 'diag', { tag: 'cloud' }, T0 - 10 * HOUR);
  const tl = await offlineLocalEdit(w, 'diag', { tag: 'new-origin-local' });
  w.clock.t += HOUR;
  w.local.setItem(PEND, J({ items: [['diag', J({ tag: 'old-origin-newer' }), tl + 30 * 60e3]] }));
  await newTab(w);
  const bv = backupVals(w);
  const ok = lv(w, 'diag').tag === 'old-origin-newer' && cv(w, 'diag').tag === 'old-origin-newer' && bv.includes(J({ tag: 'new-origin-local' })) && bv.includes(J({ tag: 'cloud' }));
  return { ok, detail: J({ local: lv(w, 'diag'), cloud: cv(w, 'diag'), bv }) };
};

T['暫存區:帳號資料夾裡從沒上傳過的題庫(沒帳本、雲端沒有)跟暫存那份聯集,兩份都在'] = async () => {
  const w = makeWorld();
  await openLoggedIn(w);
  w.local.setItem(PREFIX + 'vgame_banks', J([bank('nb', '新網址本機的題庫', ['pear'])]));
  w.local.removeItem(LEDGER);
  w.local.setItem(PEND, J({ items: [['vgame_banks', J([bank('ob', '舊網址的題庫', ['apple'])]), T0 - HOUR]] }));
  await newTab(w);
  const names = (lv(w, 'vgame_banks') || []).map((b) => b.name).sort();
  const cloudNames = (cv(w, 'vgame_banks') || []).map((b) => b.name).sort();
  const want = J(['新網址本機的題庫', '舊網址的題庫'].sort());
  const ok = J(names) === want && J(cloudNames) === want && w.local.getItem(PEND) === null;
  return { ok, detail: J({ names, cloudNames }) };
};

T['暫存區:從沒上傳過的單一值(沒帳本、雲端沒有)留本機,暫存那份備份'] = async () => {
  const w = makeWorld();
  await openLoggedIn(w);
  w.local.setItem(PREFIX + 'ph_slow', 'true');
  w.local.removeItem(LEDGER);
  w.local.setItem(PEND, J({ items: [['ph_slow', 'false', T0 - HOUR]] }));
  await newTab(w);
  const ok = lv(w, 'ph_slow') === true && cv(w, 'ph_slow') === true && backupVals(w).includes('false');
  return { ok, detail: J({ local: lv(w, 'ph_slow'), cloud: cv(w, 'ph_slow'), bv: backupVals(w) }) };
};

T['暫存區:每日練習跟雲端那份合併,兩邊的天數都在'] = async () => {
  const w = makeWorld();
  const today = '2026-11-05', yday = '2026-11-04';
  const full = { d: { d1: 1, d2: 1, d3: 1, d4: 1, d5: 1 }, v: { v1: 1, v2: 1, v3: 1, v4: 1, v5: 1 }, g: { g1: 1, g2: 1, g3: 1, g4: 1, g5: 1 } };
  cloudRow(w, 'daily_done', { [today]: { v: { v1: 1, v2: 1 } } }, T0 - HOUR);
  w.local.setItem(PEND, J({ items: [['daily_done', J({ [yday]: full }), T0 - 20 * HOUR]] }));
  await openLoggedIn(w);
  const c = cv(w, 'daily_done') || {}, l = lv(w, 'daily_done') || {};
  const ok = J(c[yday]) === J(full) && J(c[today]) === J({ v: { v1: 1, v2: 1 } }) && J(l) === J(c) && w.local.getItem(PEND) === null;
  return { ok, detail: J({ c, l }) };
};

T['暫存區:每日練習本機帳本上比雲端新,本機、雲端、暫存三份合併'] = async () => {
  const w = makeWorld();
  cloudRow(w, 'daily_done', { '2026-11-03': { v: { v1: 1 } } }, T0 - 10 * HOUR);
  await offlineLocalEdit(w, 'daily_done', { '2026-11-03': { v: { v1: 1 } }, '2026-11-05': { g: { g1: 0 } } });
  w.local.setItem(PEND, J({ items: [['daily_done', J({ '2026-11-04': { d: { d1: 1 } } }), T0 - 5 * HOUR]] }));
  await newTab(w);
  const c = cv(w, 'daily_done') || {};
  const ok = J(Object.keys(c).sort()) === J(['2026-11-03', '2026-11-04', '2026-11-05']) && J(lv(w, 'daily_done')) === J(c);
  return { ok, detail: J({ c }) };
};

T['暫存區:錯題本同一題,暫存那份(舊網址後來答錯)比雲端那份新,就用暫存那份;雲端與本機一樣'] = async () => {
  const w = makeWorld();
  cloudRow(w, 'drill_p5', { q1: { c: 0, ok: true, t: T0 - 240 * HOUR } }, T0 - 200 * HOUR);
  w.local.setItem(PEND, J({ items: [['drill_p5', J({ q1: { c: 2, ok: false, t: T0 - 2 * HOUR } }), T0 - 2 * HOUR]] }));
  await openLoggedIn(w);
  const c = cv(w, 'drill_p5') || {}, l = lv(w, 'drill_p5') || {};
  const ok = c.q1 && c.q1.ok === false && c.q1.t === T0 - 2 * HOUR && J(l) === J(c) && w.local.getItem(PEND) === null;
  return { ok, detail: J({ c, l, pend: w.local.getItem(PEND), bk: backupVals(w) }) };
};

T['暫存區:可以合併的鍵,同一項兩邊不一樣又沒辦法比(沒有時間)時,沒選上的那份放進備份,不會默默不見'] = async () => {
  const w = makeWorld();
  cloudRow(w, 'drill_p5', { q: { c: 1 } }, T0 - HOUR);
  w.local.setItem(PEND, J({ items: [['drill_p5', J({ q: { c: 2 }, r: { c: 3 } }), T0 - 2 * HOUR]] }));
  await openLoggedIn(w);
  const c = cv(w, 'drill_p5') || {};
  const bv = backupVals(w);
  const ok = J(c) === J({ q: { c: 1 }, r: { c: 3 } }) && bv.includes(J({ q: { c: 2 }, r: { c: 3 } })) && w.local.getItem(PEND) === null;
  return { ok, detail: J({ c, bv }) };
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let r;
    try { r = await T[name](); } catch (e) { r = { ok: false, detail: '丟錯:' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + String(r.detail).slice(0, 500));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
