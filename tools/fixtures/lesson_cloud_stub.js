/* 課程頁無頭 Chrome 測試(tools/test_lesson_e2e.js)用的假雲端:不連外網、不用真的帳號。
   - Node 這一邊:createCloud(opt) 開一個記憶體裡的資料庫(progress 表、老師、班級成員、使用權),
     handle(body) 處理頁面送來的一個請求。同一個 createCloud 給好幾個瀏覽器設定檔共用,就是「同一個帳號在兩台裝置」。
   - 頁面這一邊:sdkScript(user) 是注入頁面的假 supabase-js(js/cloud.js 看到 window.supabase 就不去 CDN 載),
     每個查詢用 fetch 送到同一個網域的 /__cloud,由上面的 handle 回答。window.__cloudOff = true 時每個請求都失敗(離線)。
   - clockScript(offsetMs) 是注入頁面的假時鐘:Date 往後撥 offsetMs;window.__clockAdd(ms) 在開著的頁面再往後撥。
   只支援 js/cloud.js、js/classes.js、js/admin.js 用到的寫法:select().eq().in().order().limit()、upsert、delete、rpc。 */
'use strict';

const J = JSON.stringify;
const PATH = '/__cloud';

/* opt = { teachers: [帳號 id], members: { 帳號 id: [{ id, name }] }, access: { 帳號 id: my_access 的回應 }, now: () => 毫秒 } */
function createCloud(opt) {
  const o = opt || {};
  const db = [];                 // { user_id, k, v, updated_at }
  const log = [];                // { as, op, t, keys }
  const teachers = new Set(o.teachers || []);
  const members = Object.assign({}, o.members);
  const access = Object.assign({}, o.access);
  let now = typeof o.now === 'function' ? o.now : () => Date.now();

  const iso = (ms) => new Date(ms).toISOString();
  const find = (uid, k) => db.find((r) => r.user_id === uid && r.k === k);
  function put(uid, k, v, at) {
    const row = { user_id: uid, k, v: v === undefined ? null : v, updated_at: at || iso(now()) };
    const i = db.findIndex((r) => r.user_id === uid && r.k === k);
    if (i > -1) db[i] = row; else db.push(row);
    return row;
  }
  const pick = (row, cols) => {
    if (!cols || cols === '*') return Object.assign({}, row);
    return cols.split(',').map((c) => c.trim()).reduce((a, c) => { a[c] = row[c]; return a; }, {});
  };
  const match = (row, f) => Object.keys(f || {}).every((k) => (Array.isArray(f[k]) ? f[k].indexOf(row[k]) > -1 : row[k] === f[k]));

  function progress(b) {
    if (b.op === 'upsert') {
      (b.rows || []).forEach((r) => put(r.user_id || b.as, r.k, r.v, r.updated_at));
      log.push({ as: b.as, op: 'write', keys: (b.rows || []).map((r) => r.k) });
      return { data: null, error: null };
    }
    if (b.op !== 'select') return { data: null, error: null };
    const f = Object.assign({}, b.f);
    /* 老師查全部學生的列(沒帶 user_id):只回不是老師的帳號 */
    const rows = db.filter((r) => (f.user_id ? true : teachers.has(b.as) && !teachers.has(r.user_id)) && match(r, f));
    log.push({ as: b.as, op: 'read', keys: f.k ? [f.k] : ['*'] });
    return { data: rows.map((r) => pick(r, b.cols)), error: null };
  }
  function handle(body) {
    const b = body || {};
    if (b.op === 'rpc') {
      log.push({ as: b.as, op: 'rpc', keys: [b.fn] });
      return { data: b.fn === 'my_access' ? access[b.as] || null : null, error: null };
    }
    if (b.t === 'progress') return progress(b);
    if (b.t === 'teachers') return { data: teachers.has((b.f || {}).user_id) ? [{ user_id: b.f.user_id, is_owner: false }] : [], error: null };
    if (b.t === 'memberships' && b.op === 'select') {
      log.push({ as: b.as, op: 'classes', keys: [] });
      const list = members[(b.f || {}).student_id] || [];
      return { data: list.map((c, i) => ({ class_id: c.id, joined_at: iso(Date.parse('2026-11-01T00:00:00Z') + i * 1000), classes: { name: c.name } })), error: null };
    }
    return { data: [], error: null };
  }
  return {
    db, log, handle, put, teachers, members, access,
    get: (uid, k) => { const r = find(uid, k); return r ? r.v : undefined; },
    setNow(fn) { now = fn; },
    count: (op, as) => log.filter((x) => x.op === op && (!as || x.as === as)).length,
  };
}

/* Node 的 http 伺服器裡接 /__cloud:是的話回 true(已經回應了)。classDelay:班級名單慢這麼多毫秒才回 */
function serveCloud(cloud, req, res, classDelay) {
  if (new URL(req.url, 'http://x').pathname !== PATH) return false;
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let body = {}, out;
    try { body = JSON.parse(raw || '{}'); out = cloud.handle(body); } catch (e) { out = { data: null, error: { message: String(e && e.message) } }; }
    const reply = () => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(J(out)); };
    if (body.t === 'memberships' && classDelay > 0) setTimeout(reply, classDelay); else reply();
  });
  return true;
}

/* 注入頁面的假 supabase-js。user = { id, email, user_metadata } 或 null(沒登入) */
function sdkScript(user) {
  return `(() => {
  const U = ${J(user || null)};
  const send = (b) => (window.__cloudOff ? Promise.resolve({ data: null, error: { message: 'Failed to fetch' } })
    : fetch(${J(PATH)}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ as: U ? U.id : null }, b)) })
      .then((r) => r.json(), () => ({ data: null, error: { message: 'Failed to fetch' } })));
  function query(t) {
    const q = { op: 'select', cols: '*', f: {}, rows: null };
    const b = {
      select(c) { if (q.op === 'select') q.cols = c || '*'; return b; },
      eq(k, v) { q.f[k] = v; return b; }, in(k, v) { q.f[k] = v; return b; },
      order() { return b; }, limit() { return b; }, single() { return b; }, maybeSingle() { return b; },
      upsert(rows) { q.op = 'upsert'; q.rows = [].concat(rows); return b; },
      insert(rows) { q.op = 'upsert'; q.rows = [].concat(rows); return b; },
      delete() { q.op = 'delete'; return b; }, update() { q.op = 'update'; return b; },
      then(a, c) { return send({ t, op: q.op, cols: q.cols, f: q.f, rows: q.rows }).then(a, c); },
    };
    return b;
  }
  const session = U ? { access_token: 'x', user: U } : null;
  const ok = (data) => Promise.resolve({ data: data || {}, error: null });
  const auth = new Proxy({
    getSession: () => ok({ session }), getUser: () => ok({ user: U }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => ok(),
  }, { get: (o, k) => o[k] || (() => ok()) });
  const client = { auth, from: query, rpc: (fn, args) => send({ op: 'rpc', fn, args: args || null }) };
  window.supabase = { createClient: () => client };
})();`;
}

/* 注入頁面的假時鐘:Date 往後撥 offsetMs;計時器照真的時間跑 */
function clockScript(offsetMs) {
  return `(() => {
  const R = Date;
  let off = ${Number(offsetMs) || 0};
  function D(...a) {
    if (!new.target) return new R(R.now() + off).toString();
    return a.length ? new R(...a) : new R(R.now() + off);
  }
  D.prototype = R.prototype;
  D.now = () => R.now() + off;
  D.parse = R.parse;
  D.UTC = R.UTC;
  window.Date = D;
  window.__clockAdd = (ms) => { off += ms; };
})();`;
}

module.exports = { createCloud, serveCloud, sdkScript, clockScript, PATH };
