/* 「加入班級」的邏輯測試:用假的 Supabase 跑 js/classes.js 的 CLASSES.api。
   用法:node tools/test_classes.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'classes.js'), 'utf8');
const USER = { id: '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72' };

/* 假的 Supabase:join_class 跟資料庫函式一樣大小寫不分、去頭尾空白;memberships 只回自己的列 */
function world() {
  const w = {
    offline: false,
    classes: [{ id: 'c1', name: '晨讀班', code: 'ABCD2345', active: true, teacher: 'T0' },
              { id: 'c2', name: '週六班', code: 'KX7MPQ2R', active: false, teacher: 'T1' }],
    members: [], calls: [],
  };
  w.client = {
    rpc: async (fn, args) => {
      w.calls.push(['rpc', fn, args]);
      if (w.offline) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
      const c = w.classes.find(x => x.code === String(args.p_code).trim().toUpperCase() && x.active);
      if (!c) return { data: null, error: { message: '邀請碼不存在或已停用' } };
      if (!w.members.some(m => m.class_id === c.id)) w.members.push({ student_id: USER.id, class_id: c.id, joined_at: '2026-10-02T00:00:00Z' });
      return { data: c.name, error: null };
    },
    from(table) {
      const q = { op: 'select', filters: {} };
      const b = {
        select() { q.op = 'select'; return b; },
        delete() { q.op = 'delete'; return b; },
        eq(c, v) { q.filters[c] = v; return b; },
        order() { return b; },
        then(ok, bad) { return run().then(ok, bad); },
      };
      async function run() {
        w.calls.push([table, q.op, q.filters]);
        if (w.offline) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
        if (q.op === 'select') {
          return { data: w.members.filter(m => m.student_id === USER.id).map(m => ({ class_id: m.class_id, joined_at: m.joined_at, classes: { name: w.classes.find(c => c.id === m.class_id).name } })), error: null };
        }
        const before = w.members.length;
        w.members = w.members.filter(m => !(m.student_id === q.filters.student_id && m.class_id === q.filters.class_id));
        return { data: null, error: null, count: before - w.members.length };
      }
      return b;
    },
  };
  return w;
}

function makeStorage(broken) {
  const m = new Map();
  return {
    getItem: k => { if (broken) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (broken) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    key: i => { const a = Array.from(m.keys()); return i < a.length ? a[i] : null; },
    get length() { return m.size; },
  };
}

function load(w, user, local) {
  const ctx = { console, document: { addEventListener() {} }, window: {} };
  ctx.window = ctx;
  ctx.localStorage = local || makeStorage();
  ctx.CLOUD = { enabled: true, user: user === undefined ? USER : user, client: w.client, ready: Promise.resolve() };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.CLASSES.api;
}
function loadPending(local) {
  const ctx = { console, document: { addEventListener() {} }, window: {}, localStorage: local };
  ctx.window = ctx;
  ctx.CLOUD = { enabled: true, user: null, client: null, ready: Promise.resolve(null) };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.CLASSES.pending;
}

const cases = {
  '邀請碼整理:小寫、空白、連字號都接受': async () => {
    const api = load(world());
    const r = ['abcd2345', ' ABCD 2345 ', 'ABCD-2345'].map(api.normalize);
    return { ok: r.every(x => x === 'ABCD2345'), detail: JSON.stringify(r) };
  },
  '中文輸入法打出的全形字母數字也接受': async () => {
    const api = load(world());
    const r = api.normalize('ａｂｃｄ２３４５');
    return { ok: r === 'ABCD2345', detail: r };
  },
  '收費上線後的名額檢查:資料庫的新訊息原樣顯示,句尾補句號': async () => {
    const w = world();
    w.client.rpc = async (fn, args) => { w.calls.push(['rpc', fn, args]); return { data: null, error: { message: '這位老師的班級名額已滿（上限 10 人），請聯絡老師' } }; };
    const api = load(w);
    const r = await api.join(' abcd-2345 ');
    return { ok: !r.ok && r.message === '這位老師的班級名額已滿（上限 10 人），請聯絡老師。' && w.calls[0][1] === 'join_class' && w.calls[0][2].p_code === 'ABCD2345', detail: r.message };
  },
  '資料庫訊息本來就有句號、驚嘆號或問號:不重複補': async () => {
    const out = [];
    for (const m of ['這是你自己開的班級。', '請先登入！', '要加入嗎？']) {
      const w = world();
      w.client.rpc = async () => ({ data: null, error: { message: m } });
      out.push((await load(w).join('ABCD2345')).message === m);
    }
    return { ok: out.every(Boolean), detail: out.join(',') };
  },
  '沒登入的人打開邀請連結:碼先存在這台,登入後讀一次就清掉': async () => {
    const local = makeStorage();
    const p = loadPending(local);
    p.save(' abcd-2345 ');
    const raw = JSON.parse(local.getItem('tr_pending_join'));
    const a = p.take(); const b = p.take();
    p.save('');
    const c = local.getItem('tr_pending_join');
    return { ok: raw && raw.code === 'ABCD2345' && typeof raw.at === 'number' && a === 'ABCD2345' && b === null && c === null,
      detail: JSON.stringify(raw) + ' / 第一次 ' + a + ' / 第二次 ' + b + ' / 空碼不存 ' + c };
  },
  '存著的邀請碼超過一天、格式壞掉、存不進去:都當作沒有,不丟例外': async () => {
    const l1 = makeStorage();
    l1.setItem('tr_pending_join', JSON.stringify({ code: 'ABCD2345', at: Date.now() - 25 * 3600e3 }));
    const old = loadPending(l1).take();
    const gone = l1.getItem('tr_pending_join');
    const l2 = makeStorage(); l2.setItem('tr_pending_join', '{壞掉');
    const broken = loadPending(l2).take();
    const l3 = makeStorage(true); const p3 = loadPending(l3);
    p3.save('ABCD2345'); const blocked = p3.take();
    return { ok: old === null && gone === null && broken === null && blocked === null, detail: [old, gone, broken, blocked].join(',') };
  },
  '格式不對:不打 API,直接說明': async () => {
    const w = world(); const api = load(w);
    const res = await Promise.all(['', 'ABCD234', 'ABCD23459', 'ABCD2340', 'OBCD2345'].map(c => api.join(c)));
    return { ok: res.every(r => !r.ok && r.message) && w.calls.length === 0, detail: res.map(r => r.message).join(' | ') + ' / 呼叫 ' + w.calls.length + ' 次' };
  },
  '正確的碼:加入、回傳班名、列表出現': async () => {
    const w = world(); const api = load(w);
    const r = await api.join('abcd2345');
    const list = await api.list();
    return { ok: r.ok && r.name === '晨讀班' && list.ok && list.classes.length === 1 && list.classes[0].name === '晨讀班',
             detail: JSON.stringify(r) + ' / ' + JSON.stringify(list) };
  },
  '重複加入同一班:不會變成兩筆': async () => {
    const w = world(); const api = load(w);
    await api.join('ABCD2345'); const r = await api.join('ABCD2345');
    const list = await api.list();
    return { ok: r.ok && list.classes.length === 1, detail: '班級數 ' + list.classes.length };
  },
  '停用或不存在的碼:顯示資料庫給的說明(線上的舊訊息沒有句號,前端補)': async () => {
    const w = world(); const api = load(w);
    const a = await api.join('KX7MPQ2R'); const b = await api.join('ZZZZZZZZ');
    return { ok: !a.ok && !b.ok && a.message === '邀請碼不存在或已停用。' && b.message === a.message, detail: a.message + ' | ' + b.message };
  },
  '沒網路:說連不上,不是說碼錯': async () => {
    const w = world(); w.offline = true; const api = load(w);
    const r = await api.join('ABCD2345'); const l = await api.list();
    return { ok: !r.ok && /網路/.test(r.message) && !l.ok && /網路/.test(l.message), detail: r.message + ' | ' + l.message };
  },
  '沒登入:不打 API': async () => {
    const w = world(); const api = load(w, null);
    const r = await api.join('ABCD2345');
    return { ok: !r.ok && /登入/.test(r.message) && w.calls.length === 0, detail: r.message };
  },
  '退出:只刪自己在那一班的那一列,其他班不動': async () => {
    const w = world(); w.classes[1].active = true; const api = load(w);
    await api.join('ABCD2345'); await api.join('KX7MPQ2R');
    w.members.push({ student_id: 'someone-else', class_id: 'c1', joined_at: 'x' });
    const r = await api.leave('c1');
    const del = w.calls.find(c => c[0] === 'memberships' && c[1] === 'delete');
    const list = await api.list();
    return { ok: r.ok && del && del[2].student_id === USER.id && del[2].class_id === 'c1' && list.classes.length === 1 && list.classes[0].name === '週六班' && w.members.some(m => m.student_id === 'someone-else'),
             detail: JSON.stringify(del && del[2]) + ' / 剩 ' + list.classes.map(c => c.name).join(',') };
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
