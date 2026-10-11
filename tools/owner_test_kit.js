/* 站長後台「收費管理」測試共用的假環境(tools/test_owner_accounts.js、tools/test_owner_lookup.js 都用)。
   假的 Supabase 回的是 tools/fixtures/owner_contract.json:本機 PGlite 跑真的 supabase_paid_access.sql 錄下來的回傳
   (參數、回傳形狀、錯誤訊息都是真的)。fixture 每次重錄 id 與時間都會變,所以測試不寫死 id 與日期,一律從 fixture 讀。
   最小 DOM 跟 test_admin_classes.js 同一套,多了 activeElement 與鍵盤事件。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const tryRead = f => { try { return read(f); } catch (e) { return ''; } };
const FX = JSON.parse(read('tools/fixtures/owner_contract.json'));
const FILES = ['js/admin-owner-core.js', 'js/admin-owner-accounts.js', 'js/admin-owner-lookup.js', 'js/admin-owner-billing.js', 'js/admin-owner-overview.js'];
const SRC = FILES.map(tryRead);
const AC_SRC = read('js/admin-classes.js');
const ADMIN_SRC = read('js/admin.js');
const PLANS_SRC = read('js/plans-config.js');
const COMMON = read('js/common.js');
const H_SRC = (COMMON.match(/function h\(tag[\s\S]*?\n}\r?\n/) || [''])[0];

const clone = x => JSON.parse(JSON.stringify(x));
const ACC = FX._meta.accounts;
const OWNER_ID = ACC.owner.id;
const ALL = FX['owner_accounts.all'].data;
const rowBy = (key, data) => clone((data || ALL).rows.find(r => r.email === ACC[key].email));

/* 台北時間的日期(跟程式各自算一次,不拿程式的函式當答案) */
const tp = iso => { const d = new Date(Date.parse(iso) + 8 * 3600e3); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
const pad = n => (n < 10 ? '0' : '') + n;
const DATE = iso => { const p = tp(iso); return p.y + '/' + pad(p.m) + '/' + pad(p.d); };
const DAY = (iso, now) => { const p = tp(iso), n = tp(now); return p.y === n.y ? p.m + ' 月 ' + p.d + ' 日' : DATE(iso); };
const isoOf = ms => new Date(ms).toISOString();

/* ---------- 假的 Supabase:rpc 回 fixture,from 只給 admin.js 與班級區讀 ---------- */
const LOOKUPS = ['owner', 'teacher_over_seats', 'teacher_grace', 'demoted', 'legacy', 'paid_with_credits', 'trial', 'over_seats_by_id', 'expired_upper_email'].map(k => 'owner_lookup.' + k);
function world() {
  const w = { rpcs: [], froms: [], next: {}, lookups: {}, accounts: null };
  const answer = fx => (fx.ok === false || fx.error ? { data: null, error: clone(fx.error) } : { data: clone(fx.data), error: null });
  w.route = (fn, args) => {
    const q = w.next[fn];
    if (q && q.length) { const x = q.shift(); return typeof x === 'string' ? answer(FX[x]) : x; }
    if (fn === 'owner_accounts') {
      if (w.accounts) return w.accounts(args);
      if (args.p_search) {
        const k = Object.keys(FX).find(k => k.startsWith('owner_accounts.search') && FX[k].args.p_filter === args.p_filter
          && String(FX[k].args.p_search).toLowerCase() === String(args.p_search).toLowerCase());
        return answer(FX[k || 'owner_accounts.search_no_match']);
      }
      return answer(FX['owner_accounts.' + args.p_filter] || FX['error.accounts_bad_filter']);
    }
    if (fn === 'owner_lookup') {
      const who = String(args.p_who).trim().toLowerCase();
      if (w.lookups[who]) return { data: clone(w.lookups[who]), error: null };
      const k = LOOKUPS.find(k => FX[k].data.user_id === who || String(FX[k].data.email).toLowerCase() === who);
      return answer(FX[k || 'error.lookup_not_found']);
    }
    if (fn === 'owner_overview') return answer(FX['owner_overview.d14']);
    if (fn === 'owner_export') return answer(FX['owner_export.after_writes']);
    return { data: null, error: { message: '測試沒有準備 ' + fn, code: 'P0001' } };
  };
  w.client = {
    rpc: async (fn, args) => { w.rpcs.push([fn, clone(args || {})]); return w.route(fn, args || {}); },
    from(table) {
      const q = { table, op: 'select' };
      const b = {
        select() { return b; }, eq() { return b; }, in() { return b; }, order() { return b; },
        insert() { q.op = 'insert'; return b; }, update() { q.op = 'update'; return b; }, upsert() { q.op = 'upsert'; return b; }, delete() { q.op = 'delete'; return b; },
        then(ok, bad) {
          w.froms.push(q);
          const res = table === 'progress' && w.progressError ? { data: null, error: { message: w.progressError } } : { data: table === 'progress' ? (w.progressRows || []) : [], error: null };
          return Promise.resolve(res).then(ok, bad);
        },
      };
      return b;
    },
  };
  w.calls = fn => w.rpcs.filter(r => r[0] === fn).map(r => r[1]);
  w.writes = () => w.froms.filter(q => q.op !== 'select');
  /* 讓下一次 fn 的回覆卡住,呼叫 release() 才回 */
  w.hold = (fn, reply) => { let release; const p = new Promise(r => { release = () => r(reply); }); (w.next[fn] = w.next[fn] || []).push(p); return () => release(); };
  return w;
}

function fakeDom() {
  class Node {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.nodeType = tag === '#text' ? 3 : 1; this.children = []; this.parentNode = null; this.attrs = {}; this.className = ''; this._text = ''; this.on = {}; this.dataset = {}; this.style = {}; this.hidden = false; this.disabled = false; this.value = ''; this.checked = false; }
    get type() { return this.attrs.type || ''; }
    set type(v) { this.attrs.type = String(v); }
    append(...ns) { ns.forEach(n => { if (n === null || n === undefined) return; if (!(n instanceof Node)) { const t = new Node('#text'); t._text = String(n); n = t; } if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.children.push(n); }); }
    prepend(n) { if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.children.unshift(n); }
    after(n) { const p = this.parentNode; if (!p) return; if (n.parentNode) n.parentNode._rm(n); const i = p.children.indexOf(this); n.parentNode = p; p.children.splice(i + 1, 0, n); }
    insertBefore(n, ref) { if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); }
    replaceWith(n) { const p = this.parentNode; if (!p) return; if (n.parentNode) n.parentNode._rm(n); const i = p.children.indexOf(this); p.children[i] = n; n.parentNode = p; this.parentNode = null; }
    replaceChildren(...ns) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = ''; this.append(...ns); }
    _rm(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; }
    remove() { if (this.parentNode) this.parentNode._rm(this); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    closest() { return null; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.tagName === 'ROOT'; }
    get firstChild() { return this.children[0] || null; }
    setAttribute(k, v) {
      this.attrs[k] = String(v); if (k === 'hidden') this.hidden = true;
      /* style="display:none" 跟瀏覽器一樣讀得到 el.style.display(教師後台展開學生詳情用) */
      if (k === 'style') String(v).split(';').forEach(d => { const i = d.indexOf(':'); if (i > 0) this.style[d.slice(0, i).trim().replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = d.slice(i + 1).trim(); });
    }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; if (k === 'hidden') this.hidden = false; }
    addEventListener(t, fn) { (this.on[t] = this.on[t] || []).push(fn); }
    removeEventListener(t, fn) { this.on[t] = (this.on[t] || []).filter(f => f !== fn); }
    async fire(t, ev) { const e = Object.assign({ preventDefault() {}, stopPropagation() {}, currentTarget: this, target: this }, ev); for (const f of (this.on[t] || [])) await f(e); }
    click() { return this.fire('click'); }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = String(v); }
    set innerHTML(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = ''; this._html = String(v); }
    get innerHTML() { return this._html || ''; }
    get classList() { const el = this; return { add(c) { el.classList.toggle(c, true); }, remove(c) { el.classList.toggle(c, false); }, toggle(c, on) { const s = new Set(el.className.split(' ').filter(Boolean)); if (on === undefined) on = !s.has(c); if (on) s.add(c); else s.delete(c); el.className = [...s].join(' '); }, contains(c) { return el.className.split(' ').includes(c); } }; }
    scrollIntoView() {} focus() { Node.focused = this; } blur() {} select() {}
    find(pred) { const out = []; const walk = n => { if (pred(n)) out.push(n); n.children.forEach(walk); }; walk(this); return out; }
    byClass(c) { return this.find(n => n.className.split(' ').includes(c)); }
    byText(t) { return this.find(n => n.nodeType === 1 && (n.tagName === 'BUTTON' || n.tagName === 'A') && n.textContent === t); }
    visibleText() { if (this.hidden) return ''; return this._text + this.children.map(c => c.visibleText()).join(''); }
    querySelector() { return null; }
    querySelectorAll() { return []; }
  }
  const root = new Node('ROOT');
  const body = new Node('body'); root.append(body);
  const document = {
    createElement: t => new Node(t), createTextNode: t => { const n = new Node('#text'); n._text = String(t); return n; },
    querySelector: s => (s === '.modal-mask' ? body.byClass('modal-mask')[0] || null : null),
    listeners: [],
    addEventListener(t, fn, cap) { document.listeners.push({ t, fn, cap: !!cap }); },
    removeEventListener(t, fn, cap) { document.listeners = document.listeners.filter(l => !(l.t === t && l.fn === fn && l.cap === !!cap)); },
    /* 跟瀏覽器一樣:有焦點的元素被拿掉以後,焦點回到 body */
    get activeElement() { return Node.focused && Node.focused.isConnected ? Node.focused : body; },
    body, documentElement: new Node('html'),
  };
  document.key = ev => { let prevented = false; const e = Object.assign({ preventDefault() { prevented = true; }, stopPropagation() {}, target: document.activeElement }, ev); document.listeners.filter(l => l.t === 'keydown').forEach(l => l.fn(e)); return prevented; };
  return { root, body, document, Node };
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

function context(w, o) {
  o = o || {};
  const dom = fakeDom();
  /* 下載備份:Blob 的內容記在 ctx.blobs;createObjectURL 回假的網址 */
  class FakeURL extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() {} }
  const ctx = { console: { warn() {}, log() {}, error() {} }, document: dom.document, window: {}, URL: FakeURL, setTimeout, clearTimeout, Promise, TextEncoder,
    Blob: function (parts) { ctx.blobs.push((parts || []).join('')); }, blobs: [],
    location: { origin: 'https://x', pathname: '/admin.html', href: 'https://x/admin.html', reload() {} }, confirm: () => { ctx.nativeConfirms = (ctx.nativeConfirms || 0) + 1; return true; }, alert() {} };
  ctx.window = ctx;
  /* randomUUID 依序回 key-1、key-2…(送出編號);subtle 用 node 的真的 SHA-256 */
  ctx.uuidN = 0;
  ctx.crypto = { getRandomValues: a => a.fill(7), randomUUID: () => 'key-' + (++ctx.uuidN), subtle: require('crypto').webcrypto.subtle };
  ctx.navigator = { clipboard: { writeText: async t => { ctx.copied = t; } } };
  vm.createContext(ctx);
  vm.runInContext(PLANS_SRC, ctx);   // window.PLANS(記一筆收款預填金額);PAID_UI 在這支檔案是 false
  ctx.PAID_UI = o.paid === undefined ? undefined : o.paid;
  const access = o.access === undefined ? clone(FX['owner_lookup.owner'].data.access) : o.access;
  ctx.CLOUD = { enabled: true, user: { id: OWNER_ID, email: ACC.owner.email }, client: w.client, ready: Promise.resolve(), isTeacher: o.isTeacher !== false,
    access, accessReady: Promise.resolve(access) };
  vm.runInContext(H_SRC, ctx);
  vm.runInContext('var $ = (sel, root) => (root || document).querySelector(sel);', ctx);
  SRC.forEach(s => { if (s) vm.runInContext(s, ctx); });
  return { ctx, dom, O: ctx.ADMIN_OWNER };
}

/* 收費管理直接掛進假的頁面(不經過 admin.js) */
async function area(w, o) {
  const L = context(w, Object.assign({ paid: true }, o));
  const a = L.O.mount({ ownerId: OWNER_ID });
  L.dom.body.append(a.el);
  a.show();
  await settle();
  return Object.assign(L, { a, el: a.el });
}

/* 接上 admin.js */
function loadAdmin(w, o) {
  const L = context(w, o);
  const root = new L.dom.Node('div'); root.attrs.id = 'admin-root'; L.dom.body.append(root);
  const ctx = L.ctx;
  ctx.TOEIC = {};
  ctx.bandEstimate = () => ({ band: '-' });
  ctx.$ = sel => (sel === '#admin-root' ? root : null);
  w.progressRows = o && o.rows ? o.rows : [{ user_id: ACC.amy.id, k: '_meta', v: { name: 'Amy', email: ACC.amy.email }, updated_at: '2026-10-10T00:00:00Z' }];
  vm.runInContext(AC_SRC, ctx);
  vm.runInContext(ADMIN_SRC, ctx);
  return { ctx, root, w };
}

/* 工具:找列、找按鈕、找視窗、填欄位、送出 */
const rowOf = (L, key) => L.el.byClass('ow-row').find(li => li.byClass('ow-mail')[0].textContent === ACC[key].email);
const btn = (scope, t) => scope.byText(t)[0];
const dlg = L => { const d = L.dom.body.byClass('ow-dialog'); return d[d.length - 1] || null; };
const field = (d, name) => d.find(n => (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') && n.attrs.name === name && n.attrs.type !== 'radio')[0];
const radio = (d, name, value) => d.find(n => n.tagName === 'INPUT' && n.attrs.name === name && n.attrs.type === 'radio' && n.attrs.value === value)[0];
async function setVal(inp, v) { inp.value = v; await inp.fire('input'); await settle(); }
async function pick(inp) { inp.checked = true; await inp.fire('change'); await settle(); }
async function ok(d) { await d.byClass('ow-form')[0].fire('submit'); await settle(); }
async function cancel(d) { await btn(d, '取消').click(); await settle(); }
const lines = d => d.byClass('ow-line').map(n => n.textContent);
const warns = d => d.byClass('ow-warn').map(n => n.textContent);
const onlyOwnerRpcs = w => w.rpcs.every(r => /^owner_/.test(r[0])) && w.writes().length === 0;

/* 跑一組測試,印出每一條,全部通過才 exit 0 */
function run(cases) {
  let running = '';
  process.on('beforeExit', () => { if (running) { console.log('FAIL ' + running + '  →  卡住沒有結束'); process.exit(1); } });
  (async () => {
    let pass = 0;
    for (const [name, fn] of Object.entries(cases)) {
      let r;
      running = name;
      try { r = await fn(); } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e) }; }
      if (r.ok) pass++;
      console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + r.detail);
    }
    running = '';
    console.log(pass + ' / ' + Object.keys(cases).length + ' 通過');
    process.exit(pass === Object.keys(cases).length ? 0 : 1);
  })();
}

module.exports = {
  REPO, FX, FILES, SRC, ACC, OWNER_ID, ALL, clone, rowBy, DATE, DAY, isoOf, world, fakeDom, settle, wait, context, area, loadAdmin,
  rowOf, btn, dlg, field, radio, setVal, pick, ok, cancel, lines, warns, onlyOwnerRpcs, run,
};
