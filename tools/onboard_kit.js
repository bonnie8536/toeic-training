/* 新用戶設定起始程度的測試共用:固定時間、假帳號、核心檔(沙盒載入)、資料層的假環境(真的 js/common.js 配假的 localStorage 與假的 CLOUD)。
   tools/test_onboard.js、tools/test_onboard_pages.js 用。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(REPO, f));

const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
const NOW = Date.parse('2026-11-19T12:00:00+08:00');
const NOW_ISO = new Date(NOW).toISOString();
const UID = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72';
const CPID = 'c' + UID.replace(/-/g, '');

function loadCore() {
  const ctx = {};
  vm.createContext(ctx);
  if (exists('js/onboard-core.js')) vm.runInContext(read('js/onboard-core.js'), ctx);
  return ctx.ONBOARD_CORE || {};
}
const C = loadCore();
const J = JSON.stringify;
function deepFreeze(o) {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}
/* 物件在 vm 裡建的,原型不同:先轉成本地物件再比 */
const plain = (x) => (x === undefined ? undefined : JSON.parse(J(x)));
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);

function guestOf(over) {
  return Object.assign({ v: 1, createdAt: NOW - HOUR, expiresAt: NOW - HOUR + 7 * DAY, step: 'level', targetScore: 600, examMonth: '2027-03',
    scoreDraft: null, pendingAction: null, authStartedAt: null, authNonce: null }, over || {});
}
/* S9 登入卡產生的隨機碼(這個分頁的 sessionStorage 與訪客暫存各一份) */
const NONCE = 'abcdefghij0123456789';

/* ---------- 資料層 ---------- */
/* opt.ls:兩個分頁共用同一個 localStorage(T8);opt.session:這個分頁的 sessionStorage(預設有 S9 的隨機碼 NONCE);
   opt.teacherQuery:'fail' 查教師表失敗、'noclient' 雲端元件沒載到;opt.join:假的 CLASSES.api.join 結果 */
function dataEnv(opt) {
  opt = opt || {};
  const ls = opt.ls || new Map(Object.entries(opt.init || {}));
  const ss = new Map(Object.entries(opt.session || { ob_auth_nonce: NONCE }));
  const joins = [];
  if (opt.pid) ls.set('tr_current_profile', J(opt.pid));
  const pushed = [];
  const state = { failSet: false };
  const clock = { t: opt.now || NOW };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.t); } }
  FakeDate.now = () => clock.t;
  const user = opt.user === undefined ? null : opt.user;
  const ctx = {
    console: { warn() {}, log() {} }, JSON, Date: FakeDate, Object, Array, Set, Map, Math, String, Number, Promise, URLSearchParams,
    localStorage: {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => { if (state.failSet && k !== 'tr_onboard_guest') { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } ls.set(k, String(v)); },
      removeItem: (k) => { ls.delete(k); },
      get length() { return ls.size; },
      key: (i) => [...ls.keys()][i] || null,
    },
    sessionStorage: { getItem: (k) => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => { ss.set(k, String(v)); }, removeItem: (k) => { ss.delete(k); } },
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    location: { search: '' }, Uint32Array, crypto: require('crypto').webcrypto,
  };
  ctx.window = ctx;
  const teacherRows = opt.teacherQuery === 'fail' ? { data: null, error: { message: 'x' } } : { data: opt.teacher ? [{ user_id: UID }] : [], error: null };
  const client = opt.teacherQuery === 'noclient' ? null : { from: () => ({ select: () => ({ eq: () => Promise.resolve(teacherRows) }) }) };
  ctx.CLOUD = { enabled: true, push: (k) => pushed.push(k), user, isTeacher: !!opt.teacher, reloading: !!opt.reloading, client,
    ready: Promise.resolve(user), folderReady: () => opt.folderReady !== false };
  /* 假的 js/classes.js:暫存碼照真的格式放在 tr_pending_join */
  ctx.CLASSES = {
    pending: { take: () => { const v = ls.get('tr_pending_join'); ls.delete('tr_pending_join'); return v ? JSON.parse(v).code : null; },
      save: (c) => ls.set('tr_pending_join', J({ code: c, at: clock.t })) },
    api: { join: (c) => { joins.push(c); return Promise.resolve(opt.join || { ok: true, name: '週三班' }); }, normalize: (s) => String(s || '').toUpperCase() },
  };
  vm.createContext(ctx);
  vm.runInContext(read('js/common.js') + '\n;globalThis.__store = store;', ctx);
  vm.runInContext(read('js/onboard-core.js'), ctx);
  vm.runInContext(read('js/onboard-data.js'), ctx);
  return { ctx, ls, ss, joins, pushed, state, clock, D: ctx.ONBOARD_DATA, store: ctx.__store };
}
const signedIn = (over) => Object.assign({ pid: CPID, user: { id: UID, created_at: new Date(NOW - 30 * DAY).toISOString() } }, over || {});

module.exports = { REPO, read, exists, MIN, HOUR, DAY, NOW, NOW_ISO, UID, CPID, C, J, deepFreeze, plain, eq, guestOf, NONCE, dataEnv, signedIn };
