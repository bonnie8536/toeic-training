/* 搬家計畫 2.7:js/cloud.js 的 flushForMove(舊網址寄出頁)與搬家暫存區 tr_move_pending_<帳號 id>(新網址登入灌資料時合併)。
   跟 tools/test_cloud_merge.js 同一套假的 Supabase(加上 in() 與一次傳多列的 upsert,題庫跟 sync_del 一起讀、一起傳)、localStorage、時鐘與計時器;
   合併規則載入真的 js/sync-merge.js(每一頁都在 cloud.js 前面載入)、js/move-rules.js、js/move-merge.js,
   小雞用真的 js/pet.js。用法:node tools/test_move_cloud.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const SRC = { cloud: read('js/cloud.js'), sync: read('js/sync-merge.js'), pet: read('js/pet.js'), food: read('js/pet-food.js'), rules: read('js/move-rules.js'), merge: read('js/move-merge.js'), daily: read('js/daily.js') };
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
      const q = { op: null, filters: {}, rows: null, cols: '', inKeys: null };
      const b = {
        select(c) { q.op = 'select'; q.cols = c; return b; }, eq(c, v) { q.filters[c] = v; return b; },
        in(c, v) { if (c === 'k') q.inKeys = v.slice(); else q.filters[c] = v; return b; },
        upsert(rows) { q.op = 'upsert'; q.rows = Array.isArray(rows) ? rows : [rows]; return b; }, then(ok, bad) { return run().then(ok, bad); },
      };
      async function run() {
        if (q.op === 'upsert') q.rows.forEach((r) => w.ops.push({ table, op: q.op, k: r.k, cols: q.cols }));
        else w.ops.push({ table, op: q.op, k: q.inKeys ? q.inKeys.join(',') : (q.filters.k || '*'), cols: q.cols });
        if (w.offline) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
        if (q.op === 'upsert' && w.failUpsert) return { data: null, error: { message: 'payload too large' } };   // 讀得到、傳不上去
        if (table !== 'progress') return { data: [], error: null };
        if (q.op === 'select') return { data: w.db.filter((r) => r.user_id === q.filters.user_id && (q.filters.k === undefined || r.k === q.filters.k) && (!q.inKeys || q.inKeys.includes(r.k))).map((r) => JSON.parse(J(r))), error: null };
        q.rows.forEach((x) => {
          const row = JSON.parse(J(x));
          const i = w.db.findIndex((r) => r.user_id === row.user_id && r.k === row.k);
          if (i >= 0) w.db[i] = row; else w.db.push(row);
        });
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
  vm.runInContext(SRC.pet, ctx); vm.runInContext(SRC.food, ctx); vm.runInContext(SRC.sync, ctx);
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

T['flushForMove:帳本比雲端新的照常上傳;雲端比較新的(不在合併表上的鍵)不上傳、交給搬家包;這一頁之後關頁也不自動補傳它'] = async () => {
  const w = makeWorld();
  cloudRow(w, 'diag', { s: 1 }, T0 - 24 * HOUR);
  cloudRow(w, 'hist', [], T0 - 24 * HOUR);
  const pg = await openLoggedIn(w);
  w.offline = true;
  w.clock.t += 1000; w.local.setItem(PREFIX + 'hist', J([{ m: 'p5', id: 'q', c: 1, ok: true, t: w.clock.t }])); pg.ctx.CLOUD.push('hist', 1);
  w.clock.t += 1000; w.local.setItem(PREFIX + 'diag', J({ s: 2 })); pg.ctx.CLOUD.push('diag', 1);
  await pg.runTimers();
  /* 別台(新網址)這時更新了雲端的 diag */
  w.db.find((r) => r.k === 'diag').updated_at = iso(w.clock.t + 60e3);
  w.offline = false; w.ops = [];
  const r = await pg.ctx.CLOUD.flushForMove();
  const carried = (r.accounts[USER.id] || []).map((e) => e[0]);
  const upOnce = ups(w);
  await pg.fire('win:pagehide');
  const after = ups(w);
  const ok = r.left === 1 && J(carried) === J(['diag']) && J(upOnce) === J(['hist']) && J(after) === J(['hist'])
    && cv(w, 'diag').s === 1 && 'diag' in ledger(w);
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

T['CLOUD.reloading:這一頁第一次灌完雲端資料要重載時是 true(舊網址自動搬家看到就不帶走,免得重載把換頁取消掉);灌過的分頁、訪客是 false'] = async () => {
  const w = makeWorld();
  signedIn(w);
  const p1 = loadPage(w); await p1.ready;
  const first = p1.ctx.CLOUD.reloading;
  const p2 = loadPage(w); await p2.ready;
  const second = p2.ctx.CLOUD.reloading;
  const g = makeWorld();
  g.noSession = true;   // 這台沒登入過
  const p3 = loadPage(g); await p3.ready;
  const guest = p3.ctx.CLOUD.reloading;
  const ok = first === true && w.reloads === 1 && second === false && guest === false;
  return { ok, detail: J({ first, second, guest, reloads: w.reloads }) };
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

/* ---------- 跟同步合併(js/sync-merge.js)對齊:合併表上的鍵(題庫、刪除標記、模擬考紀錄)用同一套合併(同步合併設計 3.12) ---------- */
const SMX = { console: { log() {}, warn() {}, error() {} } };
SMX.window = SMX;
vm.createContext(SMX);
vm.runInContext(SRC.sync, SMX);
const SM = SMX.SYNC_MERGE;
const DAY = 24 * HOUR;
/* 新版頁面做的題庫(有 _r、_t、_p 戳記) */
const sbank = (id, name, words, t) => SM.editBank([], id, t, (b) => SM.addWords(Object.assign(b, { name }), words.map((x) => ({ en: x, zh: '中' + x })), t))[0];
const addW = (b, en, t) => SM.editBank([b], b.id, t, (x) => SM.addWords(x, [{ en, zh: '中' + en }], t))[0];
const enOf = (b) => b.words.map((x) => x.en).sort();
const mockRec = (d, n) => ({ d, size: 'mini', lRaw: n, rRaw: n, lScore: 5, rScore: 5 });

T['暫存區:同一個題庫雲端(別台)和暫存那份(舊網址)各加了字、戳記不同:合併成一個題庫、字都在,不另存「（舊網址）」'] = async () => {
  const w = makeWorld();
  const b0 = sbank('b1', '甲', ['a'], T0 - 5 * DAY);
  cloudRow(w, 'vgame_banks', [addW(b0, 'c', T0 - 3 * DAY)], T0 - HOUR);
  w.local.setItem(PEND, J({ items: [['vgame_banks', J([addW(b0, 'z', T0 - 4 * DAY)]), T0 - 4 * DAY]] }));
  await openLoggedIn(w);
  const c = cv(w, 'vgame_banks') || [];
  const ok = c.length === 1 && c[0].id === 'b1' && c[0].name === '甲' && J(enOf(c[0])) === J(['a', 'c', 'z'])
    && J(SM.stateKey(lv(w, 'vgame_banks'))) === J(SM.stateKey(c)) && w.local.getItem(PEND) === null && !Object.keys(ledger(w)).length;
  return { ok, detail: J({ c: c.map((b) => [b.id, b.name, enOf(b)]), ledger: ledger(w) }) };
};

T['暫存區:舊網址離線刪掉的題庫(暫存區帶刪除標記 sync_del):搬過來登入之後雲端也刪掉、標記傳上去,不會回來'] = async () => {
  const w = makeWorld();
  const b1 = sbank('b1', '留著', ['a'], T0 - 5 * DAY), b2 = sbank('b2', '舊網址刪的', ['x'], T0 - 5 * DAY);
  cloudRow(w, 'vgame_banks', [b1, b2], T0 - HOUR);
  const d = SM.deleteBank([b1, b2], null, 'b2', T0 - 3 * HOUR);
  w.local.setItem(PEND, J({ items: [['sync_del', J(d.tombs), T0 - 3 * HOUR], ['vgame_banks', J(d.banks), T0 - 3 * HOUR]] }));
  await openLoggedIn(w);
  const ids = (cv(w, 'vgame_banks') || []).map((b) => b.id);
  const t = cv(w, 'sync_del');
  const ok = J(ids) === J(['b1']) && !!t && !!t.vgame_banks.b.b2 && J((lv(w, 'vgame_banks') || []).map((b) => b.id)) === J(['b1'])
    && J(lv(w, 'sync_del')) === J(t) && w.local.getItem(PEND) === null;
  return { ok, detail: J({ ids, t, local: lv(w, 'vgame_banks') }) };
};

T['暫存區:模擬考紀錄跟雲端聯集、留到 300 筆(同步的規則),不照搬家的 30 筆把舊網址的裁掉'] = async () => {
  const w = makeWorld();
  const cloud = Array.from({ length: 30 }, (x, i) => mockRec('2026-10-' + String(i + 1).padStart(2, '0') + 'T10:00', i));
  const old = Array.from({ length: 5 }, (x, i) => mockRec('2026-09-0' + (i + 1) + 'T10:00', 100 + i));
  cloudRow(w, 'mock_history', cloud, T0 - HOUR);
  w.local.setItem(PEND, J({ items: [['mock_history', J(old), T0 - 2 * HOUR]] }));
  await openLoggedIn(w);
  const c = cv(w, 'mock_history') || [];
  const ok = c.length === 35 && c[0].d === old[0].d && J(lv(w, 'mock_history')) === J(c) && w.local.getItem(PEND) === null;
  return { ok, detail: J({ n: c.length, first: c[0] && c[0].d }) };
};

T['flushForMove:題庫、刪除標記就算雲端比較新也先合併上傳(不蓋掉別台的),傳上去的不放進搬家包;離線時兩個都放進搬家包,收件端驗證收得下'] = async () => {
  const w = makeWorld();
  const other = sbank('bo', '別台的', ['o'], T0 - 2 * DAY), mine = sbank('bm', '這台離線加的', ['m'], T0 - 2 * DAY), gone = sbank('bg', '這台離線刪的', ['g'], T0 - 2 * DAY);
  cloudRow(w, 'vgame_banks', [gone], T0 - DAY);
  const pg = await openLoggedIn(w);
  w.offline = true;
  w.clock.t += 1000;
  const d = SM.deleteBank([gone, mine], null, 'bg', w.clock.t);
  w.local.setItem(PREFIX + 'sync_del', J(d.tombs)); pg.ctx.CLOUD.push('sync_del', 1);
  w.local.setItem(PREFIX + 'vgame_banks', J(d.banks)); pg.ctx.CLOUD.push('vgame_banks', 1);
  await pg.runTimers();
  /* 搬家前:別台在雲端加了一個題庫(雲端那一列比帳本新) */
  w.db.find((r) => r.k === 'vgame_banks').v = [gone, other];
  w.db.find((r) => r.k === 'vgame_banks').updated_at = iso(w.clock.t + 60e3);
  const off = await pg.ctx.CLOUD.flushForMove();
  const carriedOff = (off.accounts[USER.id] || []).map((e) => e[0]);
  const v = pg.ctx.MOVE_RULES.validate({ app: 'rushup-move', v: 1, keys: [], accounts: off.accounts }, w.clock.t);
  w.offline = false;
  const r = await pg.ctx.CLOUD.flushForMove();
  const carried = (r.accounts[USER.id] || []).map((e) => e[0]);
  const ids = (cv(w, 'vgame_banks') || []).map((b) => b.id).sort();
  const ok = J(carriedOff) === J(['sync_del', 'vgame_banks']) && v.ok === true && J(carried) === J([]) && J(ids) === J(['bm', 'bo'])
    && !!(cv(w, 'sync_del') || { vgame_banks: { b: {} } }).vgame_banks.b.bg && !Object.keys(ledger(w)).length;
  return { ok, detail: J({ carriedOff, v: v.ok || v.why, carried, ids, ledger: ledger(w) }) };
};

/* ---------- 搬家前也跟雲端對帳(跟登出前 reconcile 一樣):離開舊網址之後這台的本機那份再也用不到 ----------
   這台(舊網址,新版)建了題庫 B、已經上傳(帳本空的);別台舊版頁面(整份上傳,沒看過 B)改了 A、把雲端蓋成只剩 A'。
   這台是唯一還有 B 的地方。 */
async function overwrittenByOld(w) {
  const A = sbank('bA', '共用的', ['a'], T0 - 5 * DAY);
  cloudRow(w, 'vgame_banks', [A], T0 - 5 * DAY);
  const pg = await openLoggedIn(w);
  w.clock.t += 1000;
  const B = sbank('bB', '這台新建的', ['bee', 'cat'], w.clock.t);
  w.local.setItem(PREFIX + 'vgame_banks', J([A, B])); pg.ctx.CLOUD.push('vgame_banks', 1);
  await pg.runTimers();
  const uploaded = (cv(w, 'vgame_banks') || []).map((b) => b.id);
  w.clock.t += 60e3;
  const row = w.db.find((r) => r.k === 'vgame_banks');
  row.v = [Object.assign({}, A, { words: A.words.concat([{ en: 'dog', zh: '狗', on: true }]) })];
  row.updated_at = iso(w.clock.t);
  w.clock.t += 60e3;
  return { pg, uploaded };
}

T['flushForMove:別台舊版頁面剛把雲端的題庫整份蓋掉(這台帳本空的):先跟雲端對帳,合併後補回雲端(別台改的字也在),不放進搬家包'] = async () => {
  const w = makeWorld();
  const { pg, uploaded } = await overwrittenByOld(w);
  const before = ledger(w);
  const r = await pg.ctx.CLOUD.flushForMove();
  const carried = (r.accounts[USER.id] || []).map((e) => e[0]);
  const c = cv(w, 'vgame_banks') || [];
  const ids = c.map((b) => b.id).sort();
  const a = c.find((b) => b.id === 'bA');
  const ok = J(uploaded) === J(['bA', 'bB']) && !Object.keys(before).length && J(ids) === J(['bA', 'bB']) && !!a && J(enOf(a)) === J(['a', 'dog'])
    && r.left === 0 && J(carried) === J([]) && !Object.keys(ledger(w)).length;
  return { ok, detail: J({ uploaded, before, ids, a: a && enOf(a), left: r.left, carried, ledger: ledger(w) }) };
};

T['flushForMove:對帳發現雲端少了題庫但傳不上去:題庫放進搬家包(left>0,前往新網址會改去寄出頁),收件端驗證收得下;新網址收件登入後兩個題庫都在'] = async () => {
  const w = makeWorld();
  const { pg } = await overwrittenByOld(w);
  w.failUpsert = true;
  const r = await pg.ctx.CLOUD.flushForMove();
  const carried = (r.accounts[USER.id] || []).map((e) => e[0]);
  const v = pg.ctx.MOVE_RULES.validate({ app: 'rushup-move', v: 1, keys: [], accounts: r.accounts }, w.clock.t);
  /* 新網址:同一個雲端、空的 localStorage,收件頁把這幾項存成暫存區,登入灌資料時合併 */
  const w2 = makeWorld();
  w2.db = w.db; w2.clock.t = w.clock.t + 60e3;
  const items = r.accounts[USER.id] || [];
  w2.local.setItem(PEND, J({ from: 'https://www.shuashualanguage.com', at: w.clock.t, items }));
  await openLoggedIn(w2);
  const ids = (cv(w2, 'vgame_banks') || []).map((b) => b.id).sort();
  const local2 = (lv(w2, 'vgame_banks') || []).map((b) => b.id).sort();
  const ok = r.left > 0 && carried.indexOf('vgame_banks') >= 0 && v.ok === true && J(ids) === J(['bA', 'bB']) && J(local2) === J(['bA', 'bB'])
    && w2.local.getItem(PEND) === null;
  return { ok, detail: J({ left: r.left, carried, v: v.ok || v.why, ids, local2 }) };
};

T['flushForMove:讀不到雲端(離線)、帳本空的但本機有題庫和模擬考紀錄:確認不了雲端有沒有少,一起放進搬家包(寧可多帶)'] = async () => {
  const w = makeWorld();
  const A = sbank('bA', '共用的', ['a'], T0 - 5 * DAY);
  const mocks = [mockRec('2026-10-01T10:00', 1)];
  cloudRow(w, 'vgame_banks', [A], T0 - 5 * DAY);
  cloudRow(w, 'mock_history', mocks, T0 - 5 * DAY);
  const pg = await openLoggedIn(w);
  w.offline = true;
  const r = await pg.ctx.CLOUD.flushForMove();
  const carried = (r.accounts[USER.id] || []).map((e) => e[0]);
  const v = pg.ctx.MOVE_RULES.validate({ app: 'rushup-move', v: 1, keys: [], accounts: r.accounts }, w.clock.t);
  const ok = J(lv(w, 'vgame_banks')) === J([A]) && J(carried) === J(['mock_history', 'vgame_banks']) && r.left === 2 && v.ok === true
    && !Object.keys(ledger(w)).length;
  return { ok, detail: J({ left: r.left, carried, v: v.ok || v.why, ledger: ledger(w) }) };
};

T['flushForMove:題庫跟雲端一樣、帳本空的:讀一次雲端就好,不上傳、不放進搬家包(照樣直接前往新網址)'] = async () => {
  const w = makeWorld();
  const A = sbank('bA', '共用的', ['a'], T0 - 5 * DAY);
  cloudRow(w, 'vgame_banks', [A], T0 - 5 * DAY);
  const pg = await openLoggedIn(w);
  w.ops = [];
  const r = await pg.ctx.CLOUD.flushForMove();
  const reads = w.ops.filter((o) => o.op === 'select').length;
  const ok = r.left === 0 && J(r.accounts) === '{}' && reads === 1 && ups(w).length === 0 && J(cv(w, 'vgame_banks')) === J([A]);
  return { ok, detail: J({ left: r.left, reads, ups: ups(w) }) };
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
