/* 課程頁的測試共用:vm 沙盒載入課程檔,配假的 store(一台一份)、雲端(多台共用同一份 rows)、CLOUD、CLASSES、sessionStorage、fetch,
   與時鐘(秒與毫秒)、可手動推進的計時器。不開瀏覽器、不連網。
   用法:const K = require('./lesson_kit.js');const e = K.env({ ... });e.C 是 LESSON_CORE、e.D 是 LESSON_DATA、e.P 是 PACK_CORE。
   env 的 opt:
     files      另外要載的檔(接在課程檔後面);bank: true 時多載題庫檔(BANK.get 要用)
     cloud      共用的雲端(K.cloudOf()),兩台各開一個 env 傳同一個;沒給就新開一個
     upload     true 時 store.set 也寫進雲端(模擬上傳)
     user       登入的帳號 id(預設 K.UID;null 是訪客);pid 是資料夾(預設 'c' + UID 去掉連字號)
     teacher    CLOUD.isTeacher;ui、pilot:PACKS_UI 與 PACKS_PILOT_CLASSES(預設 'pilot'、[])
     membership CLASSES.api.list() 回什麼;'hang' 是一直不回、'throw' 是丟錯
     session    共用的 sessionStorage(Map,同一個分頁兩次開頁);sessionFail 讀寫都丟錯
     fetchFail  讀不到的網址(Set);now 開始的時間(epoch 秒);timers: 'fake' 時 setTimeout 要 e.tick(毫秒) 才跑 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(REPO, f));
const json = (f) => JSON.parse(read(f));
const PACKS = { entry: json('data/packs/pack_entry.json'), threshold: json('data/packs/pack_threshold.json') };
const WORDS = { entry: json('data/packs/words_entry.json'), threshold: json('data/packs/words_threshold.json') };
const POOL = json('data/packs/checkpoint_pool.json');
const UID = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const CPID = 'c' + UID.replace(/-/g, '');
const DAY = 86400, DAY_MS = 864e5;
const NOW = Math.floor(Date.parse('2026-11-24T10:00:00+08:00') / 1000);
const J = JSON.stringify;
/* vm 裡建的物件原型不同:先轉成本地物件再比 */
const plain = (x) => (x === undefined ? undefined : JSON.parse(J(x)));
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);

const CORE_FILES = ['data/bank-meta.js', 'data/ear.js', 'data/grammar.js', 'js/move-rules.js', 'js/sync-merge.js', 'js/sync-merge-lesson.js', 'js/move-merge.js',
  'js/lesson-rules.js', 'js/bank.js', 'js/pack-util.js', 'js/pack-core.js', 'js/daily.js', 'js/onboard-core.js', 'js/lesson-plan.js', 'js/lesson-core.js', 'js/lesson-data.js'];
const BANK_FILES = ['data/part5.js', 'data/part6.js', 'data/part7.js', 'data/listening.js'];

/* 共用的雲端:rows 存 JSON 字串;ok 是 false 時讀不到(離線) */
function cloudOf() {
  const rows = new Map(), reads = [];
  return {
    rows, reads, ok: true,
    get(k) { return rows.has(k) ? JSON.parse(rows.get(k)) : undefined; },
    put(k, v) { rows.set(k, J(v)); },
  };
}
function storeOf(cloud, upload) {
  const mem = new Map(), sets = [];
  return {
    mem, sets,
    get: (k, fb) => (mem.has(k) ? JSON.parse(mem.get(k)) : fb),
    set: (k, v) => { sets.push(k); mem.set(k, J(v)); if (upload && cloud) cloud.rows.set(k, J(v)); },
    peek: (k) => (mem.has(k) ? JSON.parse(mem.get(k)) : undefined),
  };
}
function sessionOf(map, fail) {
  const ss = map || new Map();
  const boom = () => { throw new Error('SecurityError'); };
  return {
    map: ss,
    getItem: (k) => (fail ? boom() : ss.has(k) ? ss.get(k) : null),
    setItem: (k, v) => (fail ? boom() : ss.set(k, String(v))),
    removeItem: (k) => (fail ? boom() : ss.delete(k)),
  };
}
/* 時鐘:t 是毫秒;FakeDate 不給參數時用它 */
function clockOf(sec) {
  const c = { t: sec * 1000 };
  c.sec = () => Math.floor(c.t / 1000);
  c.ms = () => c.t;
  c.set = (s) => { c.t = s * 1000; };
  c.add = (s) => { c.t += s * 1000; };
  return c;
}
function timersOf(clock) {
  const list = [];
  let seq = 0;
  return {
    list,
    setTimeout: (fn, ms) => { const id = ++seq; list.push({ id, at: clock.t + (ms || 0), fn }); return id; },
    clearTimeout: (id) => { const i = list.findIndex((x) => x.id === id); if (i > -1) list.splice(i, 1); },
    tick(ms) {
      clock.t += ms;
      list.filter((x) => x.at <= clock.t).sort((a, b) => a.at - b.at).forEach((x) => { list.splice(list.indexOf(x), 1); x.fn(); });
    },
  };
}
function fetchOf(fail, log) {
  return (url) => {
    log.push(url);
    if (fail && fail.has(url)) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
    if (!/^data\/packs\/[\w.-]+\.json$/.test(url) || !exists(url)) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
    const body = read(url);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(body)) });
  };
}
function classesOf(opt, calls) {
  return {
    api: {
      list: () => {
        calls.push('list');
        if (opt.membership === 'hang') return new Promise(() => {});
        if (opt.membership === 'throw') return Promise.reject(new Error('offline'));
        return Promise.resolve(opt.membership === undefined ? { ok: true, classes: [] } : opt.membership);
      },
    },
  };
}
function cloudClient(opt, cloud, clock) {
  const user = opt.user === null ? null : { id: opt.user || UID };
  return {
    enabled: true, user, isTeacher: !!opt.teacher, reloading: !!opt.reloading,
    ready: opt.ready || Promise.resolve(user),
    readKey: async (k) => {
      cloud.reads.push(k);
      if (!cloud.ok || !user) return { ok: false };
      return cloud.rows.has(k) ? { ok: true, found: true, v: JSON.parse(cloud.rows.get(k)) } : { ok: true, found: false, v: null };
    },
  };
}

function env(opt) {
  const o = opt || {};
  const cloud = o.cloud || cloudOf();
  const clock = clockOf(o.now || NOW);
  const timers = o.timers === 'fake' ? timersOf(clock) : null;
  const store = storeOf(cloud, o.upload);
  const ss = sessionOf(o.session, o.sessionFail);
  const logs = { warn: [], error: [], info: [] }, fetches = [], classCalls = [];
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.t); } }
  FakeDate.now = () => clock.t;
  const ctx = {
    console: { log() {}, warn: (...a) => logs.warn.push(a), error: (...a) => logs.error.push(a), info: (...a) => logs.info.push(a) },
    Promise, Map, Set, JSON, Object, Array, Math, Number, String, Boolean, RegExp, Date: FakeDate, TypeError, Error, isNaN, TextEncoder, URLSearchParams,
    setTimeout: timers ? timers.setTimeout : setTimeout, clearTimeout: timers ? timers.clearTimeout : clearTimeout,
    store, sessionStorage: ss, fetch: fetchOf(o.fetchFail, fetches),
    PACKS_UI: o.ui === undefined ? 'pilot' : o.ui, PACKS_PILOT_CLASSES: o.pilot || [],
    __PROFILE_ID: o.user === null ? 'pguest01' : o.pid || CPID,
  };
  ctx.window = ctx;
  ctx.CLOUD = cloudClient(o, cloud, clock);
  if (o.classes !== false) ctx.CLASSES = classesOf(o, classCalls);
  vm.createContext(ctx);
  CORE_FILES.concat(o.bank ? BANK_FILES : [], o.files || []).forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  return {
    ctx, cloud, store, ss, clock, logs, fetches, classCalls, timers,
    C: ctx.LESSON_CORE, D: ctx.LESSON_DATA, P: ctx.PACK_CORE, R: ctx.LESSON_RULES, B: ctx.BANK,
    tick: timers ? (ms) => timers.tick(ms) : null,
    lesson: (lv, no) => ctx.PACK_CORE.compose(PACKS, lv, no),
  };
}

/* 只載一支檔(看它載入時不依賴其他檔) */
function bare(file, extra) {
  const ctx = Object.assign({ console: { log() {}, warn() {}, error() {}, info() {} } }, extra || {});
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(file), ctx, { filename: file });
  return ctx;
}

const EE = { listening: 'entry', reading: 'entry' }, TT = { listening: 'threshold', reading: 'threshold' };
const TE = { listening: 'threshold', reading: 'entry' }, ET = { listening: 'entry', reading: 'threshold' };
const flush = () => new Promise((r) => setImmediate(r));

/* 跑一組 { 名稱: 函式 },函式可以回 detail 字串;印 PASS／FAIL 與通過數,有失敗 exit 1 */
async function run(T) {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let detail = '', ok = true;
    try { detail = (await T[name]()) || ''; } catch (e) {
      ok = false;
      detail = (e && e.actual !== undefined ? '實際 ' + J(e.actual) + ' 預期 ' + J(e.expected) + ' ' : '') + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
    }
    if (ok) pass++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + String(detail).slice(0, 500) : ''));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
}

module.exports = {
  REPO, read, exists, PACKS, WORDS, POOL, UID, CPID, DAY, DAY_MS, NOW, J, plain, eq,
  CORE_FILES, BANK_FILES, cloudOf, storeOf, sessionOf, clockOf, env, bare, EE, TT, TE, ET, flush, run,
};
