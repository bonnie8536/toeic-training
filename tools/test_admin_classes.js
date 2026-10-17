/* 教師後台的班級區(js/admin-classes.js)與接上 admin.js 的測試:用假的 Supabase 跑。
   重點(鐵律):學生資料不能被改到或刪掉。
   - 移除學生只刪「那一班、那一位」的一列 memberships,要先確認;按取消什麼都不送。
   - 停用只改 active;換邀請碼只改 code;任何操作都不碰 progress、不刪 classes。
   - 現在的資料庫(supabase_teacher_scoping.sql)與收費版(supabase_paid_access.sql)都要能用:
     收費版只把 memberships 的老師政策拆成讀與移除、加上邀請碼不分大小寫唯一,classes 的政策不變。
   - 方案與名額那一列只有 PAID_UI 打開、而且知道使用權時才出現。
   用法:node tools/test_admin_classes.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
let SRC = '';
try { SRC = read('js/admin-classes.js'); } catch (e) { /* 還沒寫:每一項都會失敗 */ }
const ADMIN_SRC = read('js/admin.js');
const COMMON = read('js/common.js');
const H_SRC = (COMMON.match(/function h\(tag[\s\S]*?\n}\r?\n/) || [''])[0];

const ME = '7a1c0d2e-1111-4a2b-8c3d-000000000001';
const OTHER_T = '7a1c0d2e-2222-4a2b-8c3d-000000000002';
const S1 = '5b000000-0000-4000-8000-000000000001', S2 = '5b000000-0000-4000-8000-000000000002', S3 = '5b000000-0000-4000-8000-000000000003';
const NOW = '2026-10-11T03:00:00Z';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/* ---------- 假的 Supabase(照兩份 SQL 的政策) ---------- */
function world(o) {
  o = o || {};
  const w = {
    paid: !!o.paid, noActive: !!o.noActive, offline: false,
    classes: [
      { id: 'k1', teacher_id: ME, name: '晨讀班', code: 'ABCD2345', active: true, created_at: '2026-09-01T00:00:00Z' },
      { id: 'k2', teacher_id: ME, name: '週六班', code: 'KX7MPQ2R', active: false, created_at: '2026-09-05T00:00:00Z' },
      { id: 'k9', teacher_id: OTHER_T, name: '別人的班', code: 'ZZZZ2345', active: true, created_at: '2026-09-02T00:00:00Z' },
    ],
    memberships: [
      { student_id: S1, class_id: 'k1', joined_at: '2026-09-10T00:00:00Z' },
      { student_id: S2, class_id: 'k1', joined_at: '2026-09-11T00:00:00Z' },
      { student_id: S1, class_id: 'k2', joined_at: '2026-09-12T00:00:00Z' },
      { student_id: S3, class_id: 'k2', joined_at: '2026-09-13T00:00:00Z' },
      { student_id: S2, class_id: 'k9', joined_at: '2026-09-14T00:00:00Z' },
    ],
    progress: [{ user_id: S1, k: 'grammar_done', v: { a1: 1 } }],
    calls: [], rpcs: [], dupNext: 0, nextDefault: ['N3WC2DE5', 'Q8RS7TUV'],
  };
  if (w.noActive) w.classes.forEach(c => { delete c.active; });
  const snapshot = () => JSON.stringify({ c: w.classes, m: w.memberships, p: w.progress });
  w.snapshot = snapshot;
  const mine = c => c.teacher_id === ME;
  const ownsClass = id => w.classes.some(c => c.id === id && mine(c));
  const dup = code => w.classes.some(c => (w.paid ? c.code.toUpperCase() === code.toUpperCase() : c.code === code));
  const DUP_ERR = { code: '23505', message: 'duplicate key value violates unique constraint "classes_code_key"' };
  const NO_COL = { code: '42703', message: 'column classes.active does not exist' };
  const pick = (row, cols) => { if (!cols || cols === '*') return Object.assign({}, row); const out = {}; cols.split(',').map(s => s.trim()).forEach(k => { out[k] = row[k]; }); return out; };

  w.client = {
    rpc: async (fn, args) => { w.rpcs.push([fn, args]); return { data: null, error: null }; },
    from(table) {
      const q = { table, op: 'select', cols: null, filters: [], payload: null, ret: null };
      const b = {
        select(cols) { if (q.op === 'select') q.cols = cols; else q.ret = cols || '*'; return b; },
        insert(p) { q.op = 'insert'; q.payload = p; return b; },
        update(p) { q.op = 'update'; q.payload = p; return b; },
        upsert(p) { q.op = 'upsert'; q.payload = p; return b; },
        delete() { q.op = 'delete'; return b; },
        eq(c, v) { q.filters.push(['eq', c, v]); return b; },
        in(c, v) { q.filters.push(['in', c, v]); return b; },
        order() { return b; },
        then(ok, bad) { return run().then(ok, bad); },
      };
      const match = row => q.filters.every(([op, c, v]) => (op === 'eq' ? row[c] === v : v.indexOf(row[c]) >= 0));
      async function run() {
        w.calls.push({ table: q.table, op: q.op, cols: q.cols, filters: q.filters.slice(), payload: q.payload });
        if (w.offline) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
        if (table === 'classes') {
          const usesActive = (q.cols && /\bactive\b/.test(q.cols)) || (q.payload && 'active' in q.payload) || (q.ret && /\bactive\b/.test(q.ret));
          if (w.noActive && usesActive) return { data: null, error: NO_COL };
          if (q.op === 'select') return { data: w.classes.filter(mine).filter(match).map(r => pick(r, q.cols)), error: null };
          if (q.op === 'insert') {
            const p = q.payload;
            if (Array.isArray(p) || p.teacher_id !== ME) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "classes"' } };
            if (!p.name) return { data: null, error: { code: '23502', message: 'null value in column "name"' } };
            const code = p.code || w.nextDefault.shift() || 'D3FAULT2';
            if (w.dupNext > 0) { w.dupNext--; return { data: null, error: DUP_ERR }; }
            if (dup(code)) return { data: null, error: DUP_ERR };
            const row = { id: 'new' + w.classes.length, teacher_id: ME, name: p.name, code, created_at: NOW };
            if (!w.noActive) row.active = true;
            w.classes.push(row);
            return { data: q.ret ? [pick(row, q.ret)] : null, error: null };
          }
          if (q.op === 'update') {
            const rows = w.classes.filter(mine).filter(match);
            if ('code' in q.payload) {
              if (w.dupNext > 0) { w.dupNext--; return { data: null, error: DUP_ERR }; }
              if (rows.length && w.classes.some(c => c.id !== rows[0].id && (w.paid ? c.code.toUpperCase() === q.payload.code.toUpperCase() : c.code === q.payload.code))) return { data: null, error: DUP_ERR };
            }
            rows.forEach(r => Object.assign(r, q.payload));
            return { data: q.ret ? rows.map(r => pick(r, q.ret)) : null, error: null };
          }
          if (q.op === 'delete') { const before = w.classes.length; w.classes = w.classes.filter(c => !(mine(c) && match(c))); return { data: [], error: null, count: before - w.classes.length }; }
        }
        if (table === 'memberships') {
          if (q.op === 'select') return { data: w.memberships.filter(m => ownsClass(m.class_id)).filter(match).map(r => pick(r, q.cols)), error: null };
          if (q.op === 'delete') {
            const gone = w.memberships.filter(m => ownsClass(m.class_id) && match(m));
            w.memberships = w.memberships.filter(m => gone.indexOf(m) < 0);
            return { data: q.ret ? gone.map(r => pick(r, q.ret)) : null, error: null };
          }
          if (w.paid) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "memberships"' } };
          return { data: null, error: null };
        }
        if (table === 'progress') {
          if (q.op === 'select') return { data: w.progressRows || [], error: null };
          return { data: null, error: null };
        }
        return { data: null, error: { message: 'unknown table ' + table } };
      }
      return b;
    },
  };
  return w;
}

/* ---------- 最小 DOM ---------- */
function fakeDom() {
  class Node {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.nodeType = tag === '#text' ? 3 : 1; this.children = []; this.parentNode = null; this.attrs = {}; this.className = ''; this._text = ''; this.on = {}; this.dataset = {}; this.style = {}; this.hidden = false; this.disabled = false; this.value = ''; this.checked = false; }
    append(...ns) { ns.forEach(n => { if (n === null || n === undefined) return; if (!(n instanceof Node)) { const t = new Node('#text'); t._text = String(n); n = t; }   /* 跟真的 DOM 一樣:不是節點就變成文字(陣列會變成 [object …]) */ if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.children.push(n); }); }
    prepend(n) { if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.children.unshift(n); }
    after(n) { const p = this.parentNode; if (!p) return; if (n.parentNode) n.parentNode._rm(n); const i = p.children.indexOf(this); n.parentNode = p; p.children.splice(i + 1, 0, n); }
    insertBefore(n, ref) { if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); }
    replaceWith(n) { const p = this.parentNode; if (!p) return; if (n.parentNode) n.parentNode._rm(n); const i = p.children.indexOf(this); p.children[i] = n; n.parentNode = p; this.parentNode = null; }
    _rm(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; }
    remove() { if (this.parentNode) this.parentNode._rm(this); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.tagName === 'ROOT'; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'hidden') this.hidden = true; }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; if (k === 'hidden') this.hidden = false; }
    addEventListener(t, fn) { (this.on[t] = this.on[t] || []).push(fn); }
    removeEventListener(t, fn) { this.on[t] = (this.on[t] || []).filter(f => f !== fn); }
    async fire(t, ev) { const e = Object.assign({ preventDefault() {}, currentTarget: this, target: this }, ev); for (const f of (this.on[t] || [])) await f(e); }
    click() { return this.fire('click'); }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = String(v); }
    set innerHTML(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = ''; this._html = String(v); }
    get innerHTML() { return this._html || ''; }
    get classList() { const el = this; return { add(c) { el.classList.toggle(c, true); }, remove(c) { el.classList.toggle(c, false); }, toggle(c, on) { const s = new Set(el.className.split(' ').filter(Boolean)); if (on === undefined) on = !s.has(c); if (on) s.add(c); else s.delete(c); el.className = [...s].join(' '); }, contains(c) { return el.className.split(' ').includes(c); } }; }
    scrollIntoView() {} focus() { Node.focused = this; } blur() {}
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
    body, documentElement: new Node('html'),
  };
  /* 在 document 上送一個鍵盤事件,回傳有沒有被擋下(preventDefault) */
  document.key = ev => { let prevented = false; const e = Object.assign({ preventDefault() { prevented = true; }, stopPropagation() {}, target: Node.focused || body }, ev); document.listeners.filter(l => l.t === 'keydown').forEach(l => l.fn(e)); return prevented; };
  return { root, body, document, Node };
}
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

function load(w, o) {
  o = o || {};
  const dom = fakeDom();
  const ctx = { console: { warn() {}, log() {}, error() {} }, document: dom.document, window: {}, URL, setTimeout, clearTimeout, Promise,
    location: { origin: 'https://www.shuashualanguage.com', pathname: '/admin.html', href: 'https://www.shuashualanguage.com/admin.html', reload() { ctx.reloads = (ctx.reloads || 0) + 1; } },
    confirm: () => { ctx.nativeConfirms = (ctx.nativeConfirms || 0) + 1; return true; }, alert() {} };
  ctx.window = ctx;
  ctx.crypto = { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; } };
  if (o.paid !== undefined) ctx.PAID_UI = o.paid;
  ctx.CLOUD = { enabled: true, user: o.user === undefined ? { id: ME, email: 'teacher@example.com' } : o.user, client: w.client, ready: Promise.resolve(),
    isTeacher: o.isTeacher !== false, access: o.access || null, accessReady: Promise.resolve(o.access || null) };
  vm.createContext(ctx);
  vm.runInContext(H_SRC, ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, A: ctx.ADMIN_CLASSES, dom };
}

/* 班級區畫進假的頁面 */
async function mount(w, o) {
  o = o || {};
  const L = load(w, o);
  const asked = [];
  const opts = Object.assign({
    nameOf: uid => ({ [S1]: { name: '王小明', email: 's1@example.com' }, [S2]: { name: '<img src=x onerror=alert(1)>', email: 's2@example.com' } }[uid] || null),
    ask: async q => { asked.push(q); return o.answer !== undefined ? o.answer : true; },
    askName: async () => o.newName,
    copy: async t => { L.copied = t; },
  }, o.opts || {});
  const box = L.A.section(opts);
  L.dom.body.append(box);
  await settle();
  return Object.assign(L, { box, asked, opts });
}
const rowOf = (m, name) => m.box.byClass('ac-class').find(li => li.byClass('ac-name')[0].textContent === name);

const cases = {
  /* ---------- 純邏輯 ---------- */
  'admin-classes.js 載入後有 ADMIN_CLASSES;邀請碼的字母表跟資料庫 gen_class_code 一樣(沒有 0、1、I、O),8 碼': () => {
    const { A } = load(world());
    const sql = read('tools/supabase_teacher_scoping.sql');
    const codes = Array.from({ length: 300 }, () => A.genCode());
    const ok = !!A && A.ALPHABET === ALPHA && sql.includes("'" + ALPHA + "'") && codes.every(c => /^[A-HJ-NP-Z2-9]{8}$/.test(c)) && new Set(codes).size > 290;
    return { ok, detail: codes.slice(0, 3).join(',') + ' / 不重複 ' + new Set(codes).size };
  },
  '讀班級:只讀自己的班(含停用的),人數與名額照資料庫算法(所有班不重複的學生,停用的班也算)': async () => {
    const w = world(); const { A } = load(w);
    const r = await A.api.list();
    const counts = r.classes.map(c => c.name + ':' + A.countOf(r.members, c.id));
    const ok = r.ok && r.hasActive === true && r.classes.map(c => c.id).join() === 'k1,k2' && counts.join() === '晨讀班:2,週六班:2'
      && A.seatsUsed(r.members) === 3 && !r.members.some(m => m.classId === 'k9')
      && w.calls[0].table === 'classes' && w.calls[0].filters.some(f => f[1] === 'teacher_id' && f[2] === ME);
    return { ok, detail: JSON.stringify({ counts, seats: A.seatsUsed(r.members), hasActive: r.hasActive }) };
  },
  '資料庫沒有 active 欄位:改用不含 active 的查法,hasActive false(畫面不出現停用與啟用)': async () => {
    const w = world({ noActive: true }); const { A } = load(w);
    const r = await A.api.list();
    const m = await mount(world({ noActive: true }));
    const ok = r.ok && r.hasActive === false && r.classes.length === 2 && m.box.byText('停用').length === 0 && m.box.byText('啟用').length === 0 && m.box.byClass('ac-class').length === 2;
    return { ok, detail: JSON.stringify({ ok: r.ok, hasActive: r.hasActive, n: r.classes.length }) };
  },
  '新增班級:只送 teacher_id 與班名(邀請碼由資料庫產生),空白不送,太長不送;資料庫錯誤原樣顯示補句號': async () => {
    const w = world(); const { A } = load(w);
    const empty = await A.api.create('   ');
    const long = await A.api.create('班'.repeat(31));
    const before = w.calls.length;
    const okr = await A.api.create('  週三班  ');
    const ins = w.calls.filter(c => c.op === 'insert');
    const w2 = world(); w2.client.from = (orig => t => { const b = orig(t); const ins0 = b.insert; b.insert = p => { ins0(p); return Object.assign(b, { then: (ok) => Promise.resolve({ data: null, error: { message: '這個帳號不能新增班級' } }).then(ok) }); }; return b; })(w2.client.from);
    const bad = await load(w2).A.api.create('A班');
    const ok = !empty.ok && empty.field && empty.message === '請輸入班級名稱。' && !long.ok && long.field && before === 0
      && okr.ok && okr.class.name === '週三班' && okr.class.code === 'N3WC2DE5'
      && ins.length === 1 && JSON.stringify(Object.keys(ins[0].payload).sort()) === '["name","teacher_id"]' && ins[0].payload.teacher_id === ME
      && !bad.ok && bad.message === '這個帳號不能新增班級。';
    return { ok, detail: JSON.stringify({ empty: empty.message, long: long.message, okr, payload: ins[0] && ins[0].payload, bad: bad.message }) };
  },
  '新增班級時資料庫產生的邀請碼剛好撞號(23505):再送一次就好;一直撞就停下來說明': async () => {
    const w = world(); w.dupNext = 1; const { A } = load(w);
    const r = await A.api.create('週三班');
    const w2 = world(); w2.dupNext = 99; const r2 = await load(w2).A.api.create('週三班');
    const tries2 = w2.calls.filter(c => c.op === 'insert').length;
    const ok = r.ok && w.calls.filter(c => c.op === 'insert').length === 2 && !r2.ok && tries2 >= 2 && tries2 <= 5 && /邀請碼/.test(r2.message) && w2.classes.length === 3;
    return { ok, detail: JSON.stringify({ r: r.ok, r2: r2.message, tries2 }) };
  },
  '換一組邀請碼:只改這一班的 code(條件含 teacher_id),撞號就換一組再送;收費版只差大小寫也算撞號': async () => {
    const w = world({ paid: true }); const { A } = load(w);
    const seq = ['ZZZZ2345', 'KX7MPQ2R', 'P4QR5STU'];   // 別人的班、自己另一班的碼,第三組才沒撞
    const r = await A.api.regenerate('k1', () => seq.shift());
    const ups = w.calls.filter(c => c.op === 'update');
    const ok = r.ok && r.code === 'P4QR5STU' && w.classes.find(c => c.id === 'k1').code === 'P4QR5STU' && ups.length === 3
      && ups.every(u => JSON.stringify(Object.keys(u.payload)) === '["code"]' && u.filters.some(f => f[1] === 'id' && f[2] === 'k1') && u.filters.some(f => f[1] === 'teacher_id' && f[2] === ME))
      && w.classes.find(c => c.id === 'k9').code === 'ZZZZ2345';
    return { ok, detail: JSON.stringify({ r, tries: ups.length }) };
  },
  '換一組邀請碼:一直撞號最多試 5 次就停;別人的班或找不到的班(更新到 0 列)說找不到,不假裝成功': async () => {
    const w = world(); w.dupNext = 99; const { A } = load(w);
    const r = await A.api.regenerate('k1');
    const tries = w.calls.filter(c => c.op === 'update').length;
    const w2 = world(); const r2 = await load(w2).A.api.regenerate('k9');
    const ok = !r.ok && tries === 5 && /再試/.test(r.message) && w.classes.find(c => c.id === 'k1').code === 'ABCD2345'
      && !r2.ok && /找不到/.test(r2.message) && w2.classes.find(c => c.id === 'k9').code === 'ZZZZ2345';
    return { ok, detail: JSON.stringify({ r: r.message, tries, r2: r2.message }) };
  },
  '停用與啟用:只改 active 一個欄位,條件含班級 id 與 teacher_id': async () => {
    const w = world(); const { A } = load(w);
    const off = await A.api.setActive('k1', false); const on = await A.api.setActive('k2', true);
    const ups = w.calls.filter(c => c.op === 'update');
    const ok = off.ok && on.ok && w.classes.find(c => c.id === 'k1').active === false && w.classes.find(c => c.id === 'k2').active === true
      && ups.every(u => JSON.stringify(Object.keys(u.payload)) === '["active"]' && u.filters.some(f => f[1] === 'teacher_id' && f[2] === ME));
    return { ok, detail: JSON.stringify(ups.map(u => u.payload)) };
  },
  '移除學生:只刪那一班那一位的一列(兩個條件都要有),同一位學生在別班的列、別的學生、進度都不動;現在與收費版都能刪': async () => {
    const out = [];
    for (const paid of [false, true]) {
      const w = world({ paid }); const { A } = load(w);
      const before = w.memberships.length;
      const r = await A.api.remove('k1', S1);
      const del = w.calls.filter(c => c.op === 'delete');
      out.push(r.ok && before - w.memberships.length === 1 && !w.memberships.some(m => m.class_id === 'k1' && m.student_id === S1)
        && w.memberships.some(m => m.class_id === 'k2' && m.student_id === S1) && w.memberships.some(m => m.class_id === 'k1' && m.student_id === S2)
        && w.progress.length === 1 && del.length === 1 && del[0].table === 'memberships'
        && del[0].filters.some(f => f[0] === 'eq' && f[1] === 'class_id' && f[2] === 'k1') && del[0].filters.some(f => f[0] === 'eq' && f[1] === 'student_id' && f[2] === S1));
    }
    return { ok: out.every(Boolean), detail: out.join(',') };
  },
  '移除學生:少一個條件就不送;已經不在班上(刪到 0 列)照實說': async () => {
    const w = world(); const { A } = load(w);
    const a = await A.api.remove('k1', ''); const b = await A.api.remove('', S1); const c = await A.api.remove(null, null);
    const sent = w.calls.length;
    const gone = await A.api.remove('k1', S3);
    const ok = !a.ok && !b.ok && !c.ok && sent === 0 && !gone.ok && /不在/.test(gone.message) && w.memberships.length === 5;
    return { ok, detail: JSON.stringify([a.message, gone.message, sent]) };
  },
  '沒登入、沒網路:不打 API 或說連不上,不說碼錯': async () => {
    const w = world(); const { A } = load(w, { user: null });
    const r = await A.api.list();
    const w2 = world(); w2.offline = true; const r2 = await load(w2).A.api.create('A班');
    const ok = !r.ok && /登入/.test(r.message) && w.calls.length === 0 && !r2.ok && /網路/.test(r2.message);
    return { ok, detail: r.message + ' | ' + r2.message };
  },
  '邀請連結:me.html?join=邀請碼,跟網站同一個資料夾': () => {
    const { A } = load(world());
    const a = A.joinLink('ABCD2345', { origin: 'https://www.shuashualanguage.com', pathname: '/admin.html' });
    const b = A.joinLink('ABCD2345', { origin: 'http://127.0.0.1:8754', pathname: '/toeic-training/admin.html' });
    return { ok: a === 'https://www.shuashualanguage.com/me.html?join=ABCD2345' && b === 'http://127.0.0.1:8754/toeic-training/me.html?join=ABCD2345', detail: a + ' | ' + b };
  },

  /* ---------- 方案與名額 ---------- */
  '方案那一列:PAID_UI 沒開、不知道使用權、站長、不是老師都不出現': () => {
    const { A } = load(world());
    const t = { is_teacher: true, role: 'teacher', teacher_source: 'paid', seats: 30, seats_used: 12, teacher_active: true, teacher_live: true, teacher_in_grace: false, teacher_until: '2026-11-03T16:30:00Z', server_now: NOW };
    const r = [
      A.planInfo(t, { paidUi: false }), A.planInfo(t, { paidUi: 'true' }), A.planInfo(null, { paidUi: true }), A.planInfo([], { paidUi: true }),
      A.planInfo(Object.assign({}, t, { is_owner: true, role: 'owner' }), { paidUi: true }),
      A.planInfo({ is_teacher: false, teacher_trial_available: false, server_now: NOW }, { paidUi: true }),
    ];
    return { ok: r.every(x => x === null), detail: JSON.stringify(r) };
  },
  '方案那一列:方案 30 位以內、已用 12 人、到期日 2026/11/04;已用以班級列為準(移除後馬上變);用滿寫名額已滿': () => {
    const { A } = load(world());
    const t = { is_teacher: true, role: 'teacher', teacher_source: 'paid', seats: 30, seats_used: 12, teacher_active: true, teacher_live: true, teacher_in_grace: false, teacher_until: '2026-11-03T16:30:00Z', server_now: NOW };
    const a = A.planInfo(t, { paidUi: true });
    const b = A.planInfo(t, { paidUi: true, used: 11 });
    const full = A.planInfo(Object.assign({}, t, { seats: 10, seats_used: 10 }), { paidUi: true });
    const trial = A.planInfo(Object.assign({}, t, { teacher_source: 'trial', seats: 10, seats_used: 2, teacher_until: '2026-10-14T03:00:00Z' }), { paidUi: true });
    const unlimited = A.planInfo(Object.assign({}, t, { teacher_source: 'legacy', seats: null, seats_used: 40, teacher_until: null }), { paidUi: true });
    const ok = a.kind === 'plan' && a.chips.join('|') === '方案 30\u00a0位以內|已用 12 人|到期日 2026/11/04' && !a.full && a.lines.length === 0
      && b.chips[1] === '已用 11 人'
      && full.full === true && full.lines.join() === '名額已滿，新的學生會加入失敗'
      && trial.chips.join('|') === '試用 10\u00a0位以內|已用 2 人|到期日 2026/10/14'
      && unlimited.chips.join('|') === '名額不限|已用 40 人' && !unlimited.full;
    return { ok, detail: JSON.stringify({ a, b: b.chips, full, trial: trial.chips, unlimited: unlimited.chips }) };
  },
  '方案那一列:寬限中寫幾號以前續約;過了寬限寫學生資料都還在;有老師列沒方案寫還沒開通;不是老師可以試用就出試用區': () => {
    const { A } = load(world());
    const base = { is_teacher: true, role: 'teacher', teacher_source: 'paid', seats: 30, seats_used: 12, teacher_until: '2026-10-10T16:00:00Z', teacher_grace_until: '2026-10-13T16:00:00Z', server_now: NOW };
    const grace = A.planInfo(Object.assign({}, base, { teacher_active: false, teacher_live: true, teacher_in_grace: true }), { paidUi: true });
    const expired = A.planInfo(Object.assign({}, base, { teacher_active: false, teacher_live: false, teacher_in_grace: false, seats: 0 }), { paidUi: true });
    const none = A.planInfo({ is_teacher: true, role: 'teacher', teacher_source: null, teacher_trial_available: true, server_now: NOW }, { paidUi: true });
    const offer = A.planInfo({ is_teacher: false, role: 'student', teacher_trial_available: true, server_now: NOW }, { paidUi: true });
    const ok = grace.kind === 'grace' && grace.lines.join() === '方案已到期，10 月 14 日以前續約可以繼續查看學生進度'
      && expired.kind === 'expired' && expired.lines.join() === '方案已到期，續約後恢復查看學生進度。學生資料都還在。' && expired.chips.length === 0
      && none.kind === 'no_plan' && none.lines.join() === '這個帳號還沒有開通老師方案' && none.trial === true
      && offer.kind === 'trial_offer' && offer.trial === true;
    return { ok, detail: JSON.stringify({ grace, expired, none, offer }) };
  },

  /* ---------- 畫面 ---------- */
  '班級區:每班一列(班名、邀請碼、複製、人數、停用或啟用),停用的班寫已停用、不給複製;班名與學生名字用文字放進畫面': async () => {
    const m = await mount(world());
    const r1 = rowOf(m, '晨讀班'), r2 = rowOf(m, '週六班');
    const anyHtml = m.box.find(n => n._html).length;
    const ok = m.box.byClass('ac-class').length === 2 && !!r1 && !!r2
      && r1.byClass('ac-code')[0].textContent === 'ABCD2345' && r1.byText('複製').length === 1 && r1.byText('複製邀請連結').length === 1
      && r1.byText('換一組邀請碼').length === 1 && r1.byText('停用').length === 1 && /2 人/.test(r1.byClass('ac-count')[0].textContent)
      && r2.byText('啟用').length === 1 && r2.byText('複製').length === 0 && /已停用/.test(r2.textContent)
      && m.box.byText('新增班級').length === 1 && anyHtml === 0;
    return { ok, detail: JSON.stringify({ rows: m.box.byClass('ac-class').map(li => li.textContent), anyHtml }) };
  },
  '班級區:按複製把邀請碼放進剪貼簿;按複製邀請連結放 me.html?join=': async () => {
    const m = await mount(world());
    const r1 = rowOf(m, '晨讀班');
    await r1.byText('複製')[0].click(); const a = m.copied;
    await r1.byText('複製邀請連結')[0].click(); const b = m.copied;
    const ok = a === 'ABCD2345' && b === 'https://www.shuashualanguage.com/me.html?join=ABCD2345';
    return { ok, detail: a + ' | ' + b };
  },
  '展開成員:列出名字(老師備註暱稱或 _meta)與 Email;名字是 HTML 也只當文字;沒有名字退回帳號前 8 碼': async () => {
    const m = await mount(world());
    const r2 = rowOf(m, '週六班');
    const exp = r2.byClass('ac-expand')[0];
    const panel = r2.byClass('ac-members')[0];
    const hiddenBefore = panel.hidden;
    await exp.click(); await settle();
    const names = r2.byClass('ac-m-name').map(n => n.textContent);
    const r1 = rowOf(m, '晨讀班'); await r1.byClass('ac-expand')[0].click(); await settle();
    const n1 = r1.byClass('ac-m-name').map(n => n.textContent);
    const ok = hiddenBefore === true && panel.hidden === false && exp.getAttribute('aria-expanded') === 'true'
      && names.join() === '王小明,' + S3.slice(0, 8) && n1[1] === '<img src=x onerror=alert(1)>' && r1.byText('移除').length === 2;
    return { ok, detail: JSON.stringify({ names, n1 }) };
  },
  '移除:先問(寫出學生與班名),按取消什麼都不送;按確定只刪那一列,人數與名額跟著變': async () => {
    const w0 = world();
    const no = await mount(w0, { answer: false });
    const r = rowOf(no, '晨讀班'); await r.byClass('ac-expand')[0].click(); await settle();
    await r.byText('移除')[0].click(); await settle();
    const noDeletes = w0.calls.filter(c => c.op === 'delete').length === 0 && w0.memberships.length === 5;
    const w = world();
    const yes = await mount(w, { answer: true });
    const ry = rowOf(yes, '晨讀班'); await ry.byClass('ac-expand')[0].click(); await settle();
    await ry.byText('移除')[0].click(); await settle();
    const del = w.calls.filter(c => c.op === 'delete');
    const ry2 = rowOf(yes, '晨讀班');
    const ok = noDeletes && no.asked.length === 1 && /王小明/.test(no.asked[0].title) && /晨讀班/.test(no.asked[0].title)
      && !no.ctx.nativeConfirms
      && del.length === 1 && w.memberships.length === 4 && /1 人/.test(ry2.byClass('ac-count')[0].textContent)
      && w.memberships.some(m => m.student_id === S1 && m.class_id === 'k2');
    const noW = no;
    return { ok: ok && noW.asked.length === 1, detail: JSON.stringify({ asked: noDeletes, dels: del.length, left: w.memberships.length }) };
  },
  '換一組邀請碼:先問(寫出舊碼會失效),取消不送;確定後畫面換成新碼': async () => {
    const w0 = world();
    const no = await mount(w0, { answer: false });
    await rowOf(no, '晨讀班').byText('換一組邀請碼')[0].click(); await settle();
    const w = world();
    const yes = await mount(w, { answer: true });
    await rowOf(yes, '晨讀班').byText('換一組邀請碼')[0].click(); await settle();
    const code = rowOf(yes, '晨讀班').byClass('ac-code')[0].textContent;
    const ok = no.asked.length === 1 && /ABCD2345/.test(no.asked[0].lines.join('')) && /失效/.test(no.asked[0].lines.join(''))
      && w0.calls.filter(c => c.op === 'update').length === 0
      && code !== 'ABCD2345' && /^[A-HJ-NP-Z2-9]{8}$/.test(code) && w.classes.find(c => c.id === 'k1').code === code;
    return { ok, detail: JSON.stringify({ title: no.asked[0] && no.asked[0].title, lines: no.asked[0] && no.asked[0].lines, code }) };
  },
  '新增班級:輸入班名後出現在列表,顯示邀請碼;取消不送': async () => {
    const w0 = world();
    const no = await mount(w0, { newName: null });
    await no.box.byText('新增班級')[0].click(); await settle();
    const w = world();
    const yes = await mount(w, { newName: '週三班' });
    await yes.box.byText('新增班級')[0].click(); await settle();
    const row = rowOf(yes, '週三班');
    const ok = w0.calls.filter(c => c.op === 'insert').length === 0 && !!row && row.byClass('ac-code')[0].textContent === 'N3WC2DE5' && /0 人/.test(row.byClass('ac-count')[0].textContent);
    return { ok, detail: JSON.stringify(yes.box.byClass('ac-class').map(li => li.textContent)) };
  },
  '內建的確認視窗:標題與說明行是文字(不是 [object …]),按取消不送、按確定才換碼;視窗關掉後不留在頁面上': async () => {
    const w = world();
    const m = await mount(w, { opts: { ask: undefined } });
    const btn = () => rowOf(m, '晨讀班').byText('換一組邀請碼')[0];
    btn().click(); await settle();
    const dlg = m.dom.body.byClass('ac-dialog')[0];
    const title = dlg && dlg.byClass('ac-dialog-h')[0].textContent;
    const line = dlg && dlg.byClass('ac-dialog-line').map(n => n.textContent).join('');
    const all = dlg ? dlg.textContent : '';
    await dlg.byText('取消')[0].click(); await settle();
    const afterCancel = { masks: m.dom.body.byClass('modal-mask').length, updates: w.calls.filter(c => c.op === 'update').length };
    btn().click(); await settle();
    const dlg2 = m.dom.body.byClass('ac-dialog')[0];
    const form = dlg2.find(n => n.tagName === 'FORM')[0];
    await form.fire('submit'); await settle();
    const ok = title === '換一組邀請碼？' && /ABCD2345/.test(line) && !/\[object/.test(all)
      && afterCancel.masks === 0 && afterCancel.updates === 0
      && w.calls.filter(c => c.op === 'update').length === 1 && m.dom.body.byClass('modal-mask').length === 0 && w.classes.find(c => c.id === 'k1').code !== 'ABCD2345';
    return { ok, detail: JSON.stringify({ title, line, bad: /\[object/.test(all), afterCancel }) };
  },
  '內建的新增班級視窗:空白不送、說明貼在欄位下;填了班名按建立才新增': async () => {
    const w = world();
    const m = await mount(w, { opts: { askName: undefined } });
    m.box.byText('新增班級')[0].click(); await settle();   // 不 await:按鈕的處理要等視窗按下去才結束
    const dlg = m.dom.body.byClass('ac-dialog')[0];
    const input = dlg.find(n => n.tagName === 'INPUT')[0];
    const form = dlg.find(n => n.tagName === 'FORM')[0];
    input.value = '   '; await form.fire('submit'); await settle();
    const err = dlg.byClass('auth-note')[0].textContent;
    const still = m.dom.body.byClass('ac-dialog').length;
    input.value = '週三班'; await form.fire('submit'); await settle();
    const ins = w.calls.filter(c => c.op === 'insert');
    const ok = err === '請輸入班級名稱。' && still === 1 && ins.length === 1 && ins[0].payload.name === '週三班' && !!rowOf(m, '週三班') && m.dom.body.byClass('modal-mask').length === 0;
    return { ok, detail: JSON.stringify({ err, still, inserts: ins.length }) };
  },
  '停用按鈕:不用確認,改完畫面寫已停用、按鈕變啟用': async () => {
    const w = world();
    const m = await mount(w);
    await rowOf(m, '晨讀班').byText('停用')[0].click(); await settle();
    const r = rowOf(m, '晨讀班');
    const ok = w.classes.find(c => c.id === 'k1').active === false && r.byText('啟用').length === 1 && /已停用/.test(r.textContent) && m.asked.length === 0;
    return { ok, detail: r.textContent };
  },
  'PAID_UI 打開才有方案那一列;沒開時班級區照樣出現': async () => {
    const access = { is_teacher: true, role: 'teacher', teacher_source: 'paid', seats: 3, seats_used: 3, teacher_active: true, teacher_live: true, teacher_in_grace: false, teacher_until: '2026-11-03T16:30:00Z', server_now: NOW };
    const off = await mount(world(), { paid: false, access, opts: { access } });
    const on = await mount(world(), { paid: true, access, opts: { access } });
    const ok = off.box.byClass('ac-plan').length === 0 && off.box.byClass('ac-class').length === 2
      && on.box.byClass('ac-plan').length === 1 && /方案 3\u00a0位以內/.test(on.box.textContent) && /已用 3 人/.test(on.box.textContent) && /名額已滿，新的學生會加入失敗/.test(on.box.textContent);
    return { ok, detail: JSON.stringify({ off: off.box.byClass('ac-plan').length, on: on.box.byClass('ac-plan').map(n => n.textContent) }) };
  },
  '全形標點:admin-classes.js 的中文字串裡沒有半形逗號、冒號、括號、問號、驚嘆號、破折號': () => {
    const strs = (SRC.match(/'[^'\n]*'/g) || []).filter(s => /[一-鿿]/.test(s));
    const bad = strs.filter(s => /[一-鿿][,:;()?!]|[,:;()?!][一-鿿]/.test(s) || /—|–/.test(s));
    return { ok: strs.length > 0 && bad.length === 0, detail: strs.length + ' 個中文字串 / 有問題 ' + JSON.stringify(bad) };
  },
  '鐵律掃描:admin-classes.js 不碰 progress、不刪 classes、不寫 memberships(只刪)、不用 innerHTML 放使用者文字': () => {
    const noProgress = !/from\(\s*'progress'/.test(SRC);
    const noClassDelete = !/from\(\s*'classes'\s*\)[^;]*\.delete\(/.test(SRC);
    const noMemberWrite = !/from\(\s*'memberships'\s*\)[^;]*\.(insert|update|upsert)\(/.test(SRC);
    const html = (SRC.match(/innerHTML\s*=\s*([^;]+);/g) || []).filter(s => !/=\s*''/.test(s));
    const ok = noProgress && noClassDelete && noMemberWrite && html.length === 0;
    return { ok, detail: JSON.stringify({ noProgress, noClassDelete, noMemberWrite, html }) };
  },

  /* ---------- 審查修正(移除的確認文字、焦點、無障礙名稱、唯讀) ---------- */
  '移除的確認(現在的資料庫):只在這位老師的班的學生,寫出看不到進度、備份不再包含他;還在別班就不寫;停用的班不說用邀請碼回來': async () => {
    const a = await askRemove({}, '晨讀班', S2NAME);
    const b = await askRemove({}, '晨讀班', '王小明');
    const c = await askRemove({}, '週六班', S3.slice(0, 8));
    const ok = a.lines[0] === '他的學習記錄不會刪除。' && a.lines.some(l => /下載全部備份也不會再包含他/.test(l)) && a.lines.includes('要回來得再輸入一次邀請碼。') && !a.lines.some(l => /使用權/.test(l))
      && !b.lines.some(l => /下載全部備份/.test(l)) && b.lines.includes('要回來得再輸入一次邀請碼。')
      && c.lines.includes('這個班停用中，重新啟用以前他不能用邀請碼加入。') && !c.lines.some(l => /要回來得/.test(l))
      && [a, b, c].every(x => x.w.calls.filter(k => k.op === 'delete').length === 0);
    return { ok, detail: JSON.stringify({ a: a.lines, b: b.lines, c: c.lines }) };
  },
  '移除的確認(PAID_UI 打開):寬限中、超過名額不能用邀請碼回來;剛好用滿可以;還在別班不受影響,但超過名額時寫名額順序會變': async () => {
    const T = { is_teacher: true, role: 'teacher', teacher_source: 'paid', seats: 30, seats_used: 3, teacher_active: true, teacher_live: true, teacher_in_grace: false, teacher_until: '2026-11-03T16:30:00Z', server_now: NOW };
    const P = x => { const access = Object.assign({}, T, x); return { paid: true, access, opts: { access } }; };
    const grace = P({ teacher_active: false, teacher_in_grace: true, teacher_grace_until: '2026-10-13T16:00:00Z' });
    const g2 = await askRemove(grace, '晨讀班', S2NAME);
    const g1 = await askRemove(grace, '晨讀班', '王小明');
    const o2 = await askRemove(P({ seats: 2 }), '晨讀班', S2NAME);
    const f2 = await askRemove(P({ seats: 3 }), '晨讀班', S2NAME);
    const o1 = await askRemove(P({ seats: 2 }), '晨讀班', '王小明');
    const f1 = await askRemove(P({ seats: 3 }), '晨讀班', '王小明');
    const ok = g2.lines.includes('你的方案到期了，續約以前他不能用邀請碼加入。') && g2.lines.includes('他會失去這個班提供的使用權。') && !g2.lines.some(l => /要回來得/.test(l))
      && g1.lines.includes('要回來得再輸入一次邀請碼。') && !g1.lines.some(l => /使用權|名額/.test(l))
      && o2.lines.includes('現在超過名額，他不能再用邀請碼加入。')
      && f2.lines.includes('要回來得再輸入一次邀請碼。') && !f2.lines.some(l => /名額/.test(l))
      && o1.lines.some(l => /名額順序/.test(l)) && o1.lines.includes('要回來得再輸入一次邀請碼。')
      && !f1.lines.some(l => /名額/.test(l));
    return { ok, detail: JSON.stringify({ g2: g2.lines, g1: g1.lines, o2: o2.lines, f2: f2.lines, o1: o1.lines, f1: f1.lines }) };
  },
  '移除成功後:不在別班的學生,訊息寫重新整理以後進度表裡就不會有他': async () => {
    const w = world(); const m = await mount(w);
    const r = rowOf(m, '晨讀班'); await r.byClass('ac-expand')[0].click(); await settle();
    await memberBtn(r, S2NAME).click(); await settle();
    const t = m.box.byClass('ac-msg')[0].textContent;
    return { ok: /移出/.test(t) && /重新整理以後/.test(t) && w.memberships.length === 4, detail: t };
  },
  'PAID_UI 打開、方案過了寬限:成員照樣列出,不給移除': async () => {
    const access = { is_teacher: true, role: 'teacher', teacher_source: 'paid', seats: 0, seats_used: 3, teacher_active: false, teacher_live: false, teacher_in_grace: false, teacher_until: '2026-10-01T00:00:00Z', server_now: NOW };
    const m = await mount(world({ paid: true }), { paid: true, access, opts: { access } });
    const r = rowOf(m, '晨讀班'); await r.byClass('ac-expand')[0].click(); await settle();
    const ok = r.byClass('ac-member').length === 2 && m.box.byText('移除').length === 0;
    return { ok, detail: JSON.stringify({ members: r.byClass('ac-member').length, rm: m.box.byText('移除').length }) };
  },
  'PAID_UI 打開但讀不到使用權:班級唯讀(不給新增、換碼、停用、移除),寫重新整理;複製照常': async () => {
    const m = await mount(world(), { paid: true, access: null, opts: { access: null } });
    const r = rowOf(m, '晨讀班'); await r.byClass('ac-expand')[0].click(); await settle();
    const t = m.box.textContent;
    const ok = m.box.byText('新增班級').length === 0 && m.box.byText('換一組邀請碼').length === 0 && m.box.byText('停用').length === 0
      && m.box.byText('啟用').length === 0 && m.box.byText('移除').length === 0 && r.byText('複製').length === 1 && r.byClass('ac-member').length === 2 && /重新整理/.test(t);
    return { ok, detail: t.slice(0, 160) };
  },
  '內建的移除確認:焦點先放在取消;說明行接到 aria-describedby;按住 Enter 的重複按鍵被擋下,什麼都不送': async () => {
    const w = world();
    const m = await mount(w, { opts: { ask: undefined } });
    const r = rowOf(m, '晨讀班'); await r.byClass('ac-expand')[0].click(); await settle();
    memberBtn(r, '王小明').click(); await settle();
    const dlg = m.dom.body.byClass('ac-dialog')[0];
    const focused = m.dom.Node.focused;
    const lines = dlg.byClass('ac-dialog-line');
    const desc = (dlg.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    const blocked = m.dom.document.key({ key: 'Enter', repeat: true });
    const plain = m.dom.document.key({ key: 'Enter', repeat: false });
    const ok = !!focused && focused.textContent === '取消' && lines.length >= 2 && desc.length === lines.length && lines.every((l, i) => l.getAttribute('id') === desc[i])
      && blocked === true && plain === false && w.calls.filter(c => c.op === 'delete').length === 0;
    await dlg.byText('取消')[0].click(); await settle();
    return { ok: ok && w.memberships.length === 5, detail: JSON.stringify({ focused: focused && focused.textContent, desc, ids: lines.map(l => l.getAttribute('id')), blocked, plain }) };
  },
  '操作完焦點留在同一班:停用後在啟用、換碼後在換一組邀請碼、移除後在下一位的移除,最後一位移除後在成員': async () => {
    const w = world(); const m = await mount(w);
    const F = () => m.dom.Node.focused;
    const inRow = (el, name) => !!el && el.isConnected && rowOf(m, name).contains(el);
    await rowOf(m, '晨讀班').byText('停用')[0].click(); await settle();
    const a = F(); const okA = inRow(a, '晨讀班') && a.textContent === '啟用';
    await rowOf(m, '晨讀班').byText('換一組邀請碼')[0].click(); await settle();
    const b = F(); const okB = inRow(b, '晨讀班') && b.textContent === '換一組邀請碼';
    const r = rowOf(m, '晨讀班'); await r.byClass('ac-expand')[0].click(); await settle();
    await memberBtn(rowOf(m, '晨讀班'), '王小明').click(); await settle();
    const c = F(); const okC = inRow(c, '晨讀班') && c.textContent === '移除' && c.parentNode.byClass('ac-m-name')[0].textContent === S2NAME;
    await memberBtn(rowOf(m, '晨讀班'), S2NAME).click(); await settle();
    const d = F(); const okD = inRow(d, '晨讀班') && d.className === 'ac-expand';
    return { ok: okA && okB && okC && okD, detail: JSON.stringify([a && a.textContent, b && b.textContent, c && c.textContent, d && d.textContent]) };
  },
  '停用的班換邀請碼:成功訊息寫啟用以後才能用': async () => {
    const m = await mount(world());
    await rowOf(m, '週六班').byText('換一組邀請碼')[0].click(); await settle();
    const t = m.box.byClass('ac-msg')[0].textContent;
    const m2 = await mount(world());
    await rowOf(m2, '晨讀班').byText('換一組邀請碼')[0].click(); await settle();
    const t2 = m2.box.byClass('ac-msg')[0].textContent;
    return { ok: /啟用以後才能用/.test(t) && !/啟用/.test(t2), detail: t + ' | ' + t2 };
  },
  '兩個班都展開:每顆按鈕的無障礙名稱不重複,而且包含看得到的字': async () => {
    const m = await mount(world());
    for (const n of ['晨讀班', '週六班']) { await rowOf(m, n).byClass('ac-expand')[0].click(); await settle(); }
    const btns = m.box.find(n => n.tagName === 'BUTTON');
    const names = btns.map(b => b.getAttribute('aria-label') || b.textContent);
    const dup = names.filter((x, i) => names.indexOf(x) !== i);
    const missing = btns.filter(b => !(b.getAttribute('aria-label') || b.textContent).includes(b.textContent)).map(b => b.textContent);
    return { ok: dup.length === 0 && missing.length === 0 && names.length >= 10, detail: JSON.stringify({ dup, missing, names }) };
  },
  '方案那一列:寬限的最後一天在明年時,日期和以前之間有空格': () => {
    const { A } = load(world());
    const base = { is_teacher: true, role: 'teacher', teacher_source: 'paid', seats: 30, teacher_active: false, teacher_live: true, teacher_in_grace: true, teacher_until: '2026-12-30T16:00:00Z' };
    const x = A.planInfo(Object.assign({}, base, { teacher_grace_until: '2027-01-02T16:00:00Z', server_now: '2026-12-31T03:00:00Z' }), { paidUi: true });
    return { ok: x.lines[0] === '方案已到期，2027/01/03 以前續約可以繼續查看學生進度', detail: x.lines[0] };
  },
};
const S2NAME = '<img src=x onerror=alert(1)>';
function memberBtn(row, name) {
  return row.find(n => n.tagName === 'BUTTON' && n.textContent === '移除' && n.parentNode.byClass('ac-m-name')[0].textContent === name)[0];
}
/* 展開某班、按某位學生的移除,回傳確認視窗的內容(預設按取消) */
async function askRemove(o, cls, name) {
  const w = world({ paid: !!o.paid });
  const m = await mount(w, Object.assign({ answer: false }, o));
  const r = rowOf(m, cls); await r.byClass('ac-expand')[0].click(); await settle();
  await memberBtn(r, name).click(); await settle();
  return { m, w, q: m.asked[0], lines: (m.asked[0] && m.asked[0].lines) || [] };
}

/* ---------- 接上 admin.js:其他功能照舊 ---------- */
function loadAdmin(w, o) {
  o = o || {};
  const dom = fakeDom();
  const root = new dom.Node('div'); root.attrs.id = 'admin-root'; dom.body.append(root);
  const ctx = { console: { warn() {}, log() {}, error() {} }, document: dom.document, window: {}, URL, setTimeout, clearTimeout, Promise, Blob: function () {},
    location: { origin: 'https://x', pathname: '/admin.html', href: 'https://x/admin.html', reload() {} }, confirm: () => true, alert() {} };
  ctx.window = ctx;
  ctx.crypto = { getRandomValues: a => a.fill(7) };
  if (o.paid !== undefined) ctx.PAID_UI = o.paid;
  ctx.TOEIC = {};
  ctx.bandEstimate = () => ({ band: '-' });
  ctx.$ = sel => (sel === '#admin-root' ? root : null);
  w.progressRows = o.rows || [];
  ctx.CLOUD = { enabled: true, user: { id: ME, email: 'teacher@example.com' }, client: w.client, ready: Promise.resolve(), isTeacher: !!o.isTeacher,
    access: o.access || null, accessReady: Promise.resolve(o.access || null) };
  if (o.trialDialog) ctx.PAYWALL = { trialDialog: o.trialDialog };
  vm.createContext(ctx);
  vm.runInContext(H_SRC, ctx);
  if (SRC) vm.runInContext(SRC, ctx);
  vm.runInContext(ADMIN_SRC, ctx);
  return { ctx, root, w };
}
const rowsFor = () => [
  { user_id: S1, k: '_meta', v: { name: '王小明', email: 's1@example.com' }, updated_at: '2026-10-10T00:00:00Z' },
  { user_id: S1, k: 'drill_p5', v: { q1: { ok: true } }, updated_at: '2026-10-10T00:00:00Z' },
];
Object.assign(cases, {
  'admin.js:PAID_UI 沒開、不是老師:畫面還是原本那句,不呼叫任何函式、不查班級': async () => {
    const w = world(); const a = loadAdmin(w, { paid: false, isTeacher: false });
    await settle();
    const ok = a.root.textContent === '這個帳號沒有教師權限。請用教師帳號登入（教師帳號=已加入 teachers 表的帳號，見指南步驟 D）。' && w.calls.length === 0 && w.rpcs.length === 0;
    return { ok, detail: a.root.textContent + ' / 查詢 ' + w.calls.length };
  },
  'admin.js:老師(PAID_UI 沒開):原本的備份按鈕、學生表、讀進度一次照舊;多一個班級區,沒有方案那一列': async () => {
    const w = world(); const a = loadAdmin(w, { paid: false, isTeacher: true, rows: rowsFor() });
    await settle();
    const prog = w.calls.filter(c => c.table === 'progress');
    const backup = a.root.find(n => n.tagName === 'BUTTON' && /^下載全部備份（2 列）$/.test(n.textContent));
    const ok = prog.length === 1 && prog[0].op === 'select' && prog[0].cols === 'user_id,k,v,updated_at' && backup.length === 1
      && a.root.find(n => n.tagName === 'TABLE').length === 1 && a.root.byClass('ac-box').length === 1 && a.root.byClass('ac-plan').length === 0
      && w.rpcs.length === 0;
    return { ok, detail: JSON.stringify({ prog: prog.length, backup: backup.length, box: a.root.byClass('ac-box').length }) };
  },
  'admin.js:成員名字從學生的 _meta 讀(展開晨讀班看得到王小明)': async () => {
    const w = world(); const a = loadAdmin(w, { paid: false, isTeacher: true, rows: rowsFor() });
    await settle();
    const row = a.root.byClass('ac-class').find(li => li.byClass('ac-name')[0].textContent === '晨讀班');
    await row.byClass('ac-expand')[0].click(); await settle();
    const names = row.byClass('ac-m-name').map(n => n.textContent);
    return { ok: names[0] === '王小明' && names[1] === S2.slice(0, 8), detail: JSON.stringify(names) };
  },
  'admin.js:PAID_UI 打開、不是老師但可以試用:出現開始老師試用(按下去用付費牆的試用視窗),不出現原本那句': async () => {
    const w = world(); let opened = 0;
    const a = loadAdmin(w, { paid: true, isTeacher: false, access: { is_teacher: false, role: 'student', teacher_trial_available: true, server_now: NOW }, trialDialog: () => { opened++; } });
    await settle();
    const btn = a.root.find(n => n.tagName === 'BUTTON' && n.textContent === '開始老師試用');
    if (btn[0]) await btn[0].click();
    const ok = btn.length === 1 && opened === 1 && !/沒有教師權限/.test(a.root.textContent) && w.calls.length === 0;
    return { ok, detail: a.root.textContent };
  },
  'admin.js:PAID_UI 打開、被站長改成學生(不能試用):還是原本那句': async () => {
    const w = world();
    const a = loadAdmin(w, { paid: true, isTeacher: false, access: { is_teacher: false, role: 'student', teacher_trial_available: false, server_now: NOW } });
    await settle();
    return { ok: /沒有教師權限/.test(a.root.textContent) && !/開始老師試用/.test(a.root.textContent), detail: a.root.textContent };
  },
  'admin.js:PAID_UI 打開、老師方案過了寬限:寫學生資料都還在,不寫還沒有學生資料': async () => {
    const w = world();
    const access = { is_teacher: true, role: 'teacher', teacher_source: 'paid', seats: 0, seats_used: 3, teacher_active: false, teacher_live: false, teacher_in_grace: false, teacher_until: '2026-10-01T00:00:00Z', teacher_grace_until: '2026-10-04T00:00:00Z', server_now: NOW };
    const a = loadAdmin(w, { paid: true, isTeacher: true, access, rows: [] });
    await settle();
    const t = a.root.textContent;
    return { ok: /學生資料都還在/.test(t) && !/還沒有學生資料/.test(t) && a.root.byClass('ac-class').length === 2, detail: t.slice(0, 200) };
  },
  'admin.js:還沒有學生資料時,說明學生要用邀請碼加入班級才會出現': async () => {
    const w = world(); const a = loadAdmin(w, { paid: false, isTeacher: true, rows: [] });
    await settle();
    const t = a.root.textContent;
    return { ok: /還沒有學生資料。學生用邀請碼加入班級、開始作答後，這裡會出現他們的進度。/.test(t) && !/學生第一次登入/.test(t), detail: t.slice(-80) };
  },
  'admin.js:PAID_UI 打開、老師方案期內:方案那一列出現在班級區上方': async () => {
    const w = world();
    const access = { is_teacher: true, role: 'teacher', teacher_source: 'paid', seats: 30, seats_used: 3, teacher_active: true, teacher_live: true, teacher_in_grace: false, teacher_until: '2026-11-03T16:30:00Z', server_now: NOW };
    const a = loadAdmin(w, { paid: true, isTeacher: true, access, rows: rowsFor() });
    await settle();
    const plan = a.root.byClass('ac-plan');
    return { ok: plan.length === 1 && /方案 30\u00a0位以內/.test(plan[0].textContent) && /已用 3 人/.test(plan[0].textContent) && /到期日 2026\/11\/04/.test(plan[0].textContent), detail: plan.map(p => p.textContent).join() };
  },
});

/* 某一項卡住(promise 永遠不回)時 node 會直接結束、看起來像沒事:這裡改成失敗 */
let running = '';
process.on('beforeExit', () => { if (running) { console.log('FAIL ' + running + '  →  卡住沒有結束'); process.exit(1); } });

(async () => {
  let pass = 0;
  for (const [name, fn] of Object.entries(cases)) {
    let r;
    running = name;
    try { r = await fn(); } catch (e) { r = { ok: false, detail: '例外 ' + e.message }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + r.detail);
  }
  running = '';
  console.log(pass + ' / ' + Object.keys(cases).length + ' 通過');
  process.exit(pass === Object.keys(cases).length ? 0 : 1);
})();
