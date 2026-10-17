/* 塗鴉食物(js/food-art.js)的測試:小雞第二階段規格 3.3、4.2、附錄 A.9,實作契約第 4.2 節。
   用法:node tools/test_food_art.js
   - 第一部分在 Node 裡跑,用假的 canvas 記下每一個繪圖呼叫:9 種的順序和名字、每種至少 3 張不同的抖動、
     同樣參數畫兩次一模一樣、托盤用的 render 一張就好、mount 不抖時不開計時器、bite() 吃完只呼叫一次 onDone。
   - 第二部分用本機的 Chrome 或 Edge(無頭模式)真的畫出來比像素;找不到 Chrome 時略過。除錯埠用 8900 到 8919。 */
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const FOOD_SRC = fs.existsSync(path.join(REPO, 'js/food-art.js')) ? read('js/food-art.js') : '';
/* 契約第 2.1 節的 PET.FOODS(托盤順序);js/pet.js 有 PET.FOODS 時改用它 */
const CONTRACT_FOODS = [['grain', '飼料'], ['corn', '玉米'], ['greens', '青江菜'], ['pea', '豌豆'], ['berry', '藍莓'],
  ['tomato', '小番茄'], ['melon', '西瓜'], ['yam', '地瓜'], ['worm', '麵包蟲']];

/* ---------- 假的 canvas:記下每一個呼叫和屬性設定 ---------- */
const digest = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const fmt = (v) => (v && typeof v === 'object' && Array.isArray(v.log) ? 'img:' + digest(v.log.join('\n')) : String(v));
function makeCanvas() {
  const log = [];
  const c = { width: 300, height: 150, style: {}, log };
  const props = {};
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return c;
      if (k in props) return props[k];
      return (...a) => { log.push(String(k) + '(' + a.map(fmt).join(',') + ')'); };
    },
    set(t, k, v) { props[k] = v; log.push(String(k) + '=' + fmt(v)); return true; },
  });
  c.getContext = () => ctx;
  return c;
}
function makeEnv(opt) {
  const o = Object.assign({ dpr: 1, reduce: false }, opt);
  const timers = new Map();
  let tid = 0;
  const g = {
    console, devicePixelRatio: o.dpr,
    matchMedia: () => ({ matches: o.reduce }),
    setInterval: (fn, ms) => { timers.set(++tid, { fn, ms }); return tid; },
    clearInterval: (id) => { timers.delete(id); },
    setTimeout: (fn, ms) => { timers.set(++tid, { fn, ms, once: true }); return tid; },
    clearTimeout: (id) => { timers.delete(id); },
    document: { createElement: () => makeCanvas() },
  };
  g.window = g;
  vm.createContext(g);
  if (FOOD_SRC) vm.runInContext(FOOD_SRC, g, { filename: 'food-art.js' });
  return { g, F: g.FoodArt, timers, intervals: () => [...timers.values()].filter((t) => !t.once) };
}
const logOf = (c) => c.log.join('\n');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const drawsOf = (c) => c.log.filter((l) => l.startsWith('drawImage(')).length;

/* PET.FOODS:data 那邊寫好以後用真的,還沒寫好就對契約 */
function petFoods() {
  try {
    const g = {};
    vm.createContext(g);
    vm.runInContext(read('js/pet.js'), g, { filename: 'pet.js' });
    const P = g.PET;
    if (P && Array.isArray(P.FOODS)) return { from: 'js/pet.js', list: P.FOODS.map((f) => [f.id, f.name]), foodName: P.foodName };
  } catch (e) { /* 讀不到就對契約 */ }
  return { from: '契約第 2.1 節(js/pet.js 還沒有 PET.FOODS)', list: CONTRACT_FOODS, foodName: null };
}

const T = {};
T['js/food-art.js 載入後有 window.FoodArt,介面齊全'] = () => {
  const { F } = makeEnv();
  const keys = ['ids', 'info', 'colors', 'render', 'draw', 'mount', 'chickImpactFrames', 'metrics'];
  const missing = F ? keys.filter((k) => !(k in F)) : keys;
  return { ok: !!F && !missing.length && eq(F.metrics, { width: 100, height: 100, ground: 84 }) && eq(F.chickImpactFrames, [3, 5]),
    detail: F ? '缺 ' + missing.join('、') + ' metrics ' + JSON.stringify(F.metrics) : '沒有 FoodArt' };
};
T['9 種食物的順序和名字跟 PET.FOODS 相同'] = () => {
  const { F } = makeEnv();
  if (!F) return { ok: false, detail: '沒有 FoodArt' };
  const P = petFoods();
  const mine = F.ids.map((id) => [id, F.info[id] && F.info[id].name]);
  const named = !P.foodName || F.ids.every((id) => P.foodName(id) === F.info[id].name);
  return { ok: eq(mine, P.list) && named, note: '對照 ' + P.from, detail: '對照 ' + P.from + ':' + JSON.stringify(mine) };
};
T['每種食物至少 3 張不同的抖動(舞台上那份會抖)'] = () => {
  const { F } = makeEnv();
  if (!F) return { ok: false, detail: '沒有 FoodArt' };
  const bad = F.ids.filter((id) => {
    const logs = [0, 1, 2].map((v) => logOf(F.render(id, { size: 56, variant: v, dpr: 1 })));
    return new Set(logs).size < 3 || logs.some((l) => l.length < 500);
  });
  return { ok: !bad.length, detail: '不到 3 張:' + bad.join('、') };
};
T['同樣的參數畫兩次一模一樣(兩個各自載入的 FoodArt 比繪圖呼叫)'] = () => {
  const a = makeEnv().F, b = makeEnv().F;
  if (!a || !b) return { ok: false, detail: '沒有 FoodArt' };
  const bad = [];
  a.ids.forEach((id) => {
    const steps = a.info[id].steps;
    [[40, 0, 0, null], [56, 1, 0, null], [56, 2, 1, 0.55], [96, 0, steps, 1]].forEach(([size, variant, step, crumb]) => {
      const o = { size, variant, step, crumb, dpr: 2 };
      if (logOf(a.render(id, o)) !== logOf(b.render(id, Object.assign({}, o)))) bad.push(id + ' ' + JSON.stringify(o));
    });
  });
  return { ok: !bad.length, detail: bad.slice(0, 6).join('、') };
};
T['托盤:render(id, { size: 40, variant: 0 }) 每種一張、大小照 dpr、同參數重用同一張(不重畫)'] = () => {
  const { F } = makeEnv({ dpr: 2 });
  if (!F) return { ok: false, detail: '沒有 FoodArt' };
  const bad = F.ids.filter((id) => {
    const c = F.render(id, { size: 40, variant: 0 });
    return c.width !== 80 || c.height !== 80 || F.render(id, { size: 40, variant: 0 }) !== c || logOf(c).length < 500;
  });
  let threw = false;
  try { F.render('nope', { size: 40 }); } catch (e) { threw = true; }
  return { ok: !bad.length && threw, detail: '不對:' + bad.join('、') + ' 不認得的食物丟錯 ' + threw };
};
T['draw(ctx, id, ...) 把畫好的那張貼到別人的畫布上'] = () => {
  const { F } = makeEnv();
  if (!F) return { ok: false, detail: '沒有 FoodArt' };
  const c = makeCanvas();
  F.draw(c.getContext('2d'), 'tomato', { x: 10, y: 20, size: 56, variant: 1 });
  const img = 'img:' + digest(logOf(F.render('tomato', { size: 56, variant: 1, dpr: 1 })));
  return { ok: eq(c.log, ['drawImage(' + img + ',10,20,56,56)']), detail: JSON.stringify(c.log) };
};
T['mount(..., { animate: false }):只畫一張、不設計時器'] = () => {
  const env = makeEnv({ dpr: 2 });
  if (!env.F) return { ok: false, detail: '沒有 FoodArt' };
  const c = makeCanvas();
  const m = env.F.mount(c, 'corn', { size: 56, animate: false });
  return { ok: env.timers.size === 0 && drawsOf(c) === 1 && c.width === 112 && c.style.width === '56px' && m.step === 0 && m.steps === 3 && m.food === 'corn',
    detail: JSON.stringify({ timers: env.timers.size, draws: drawsOf(c), w: c.width, css: c.style.width }) };
};
T['減少動態:mount 不設計時器'] = () => {
  const env = makeEnv({ reduce: true });
  if (!env.F) return { ok: false, detail: '沒有 FoodArt' };
  const m = env.F.mount(makeCanvas(), 'yam', { size: 56 });
  return { ok: env.timers.size === 0 && m.reducedMotion === true, detail: '計時器 ' + env.timers.size };
};
T['bite() 走完 steps 後 onDone 只呼叫一次(不抖、會抖兩種都是);stop() 清掉計時器'] = () => {
  const d = [];
  const env = makeEnv();
  if (!env.F) return { ok: false, detail: '沒有 FoodArt' };
  env.F.ids.forEach((id) => {
    let done = 0;
    const m = env.F.mount(makeCanvas(), id, { size: 56, animate: false, onDone: () => done++ });
    for (let i = 0; i < m.steps + 3; i++) m.bite();
    if (done !== 1 || m.step !== m.steps) d.push(id + ' 不抖:onDone ' + done + ' 次');
  });
  ['grain', 'corn', 'worm'].forEach((id) => {
    const e = makeEnv();
    let done = 0;
    const m = e.F.mount(makeCanvas(), id, { size: 56, stagger: false, onDone: () => done++ });
    const tick = (n) => { for (let i = 0; i < n; i++) e.intervals()[0].fn(); };
    for (let i = 0; i < m.steps; i++) { m.bite(); if (i < m.steps - 1) tick(6); }
    if (done !== 0) d.push(id + ' 會抖:碎屑還沒落地就呼叫了 onDone');
    tick(10); m.bite(); tick(10);
    if (done !== 1) d.push(id + ' 會抖:onDone ' + done + ' 次');
    m.stop();
    if (e.timers.size) d.push(id + ' stop 之後還有計時器');
  });
  return { ok: !d.length, detail: d.join(';') };
};
T['檔頭寫了原檔位置;不讀寫任何儲存'] = () => {
  const head = FOOD_SRC.split('*/')[0];
  return { ok: /小雞\/第二階段\/food-art\.js/.test(head) && !/localStorage|sessionStorage|PET_STORE|CLOUD/.test(FOOD_SRC),
    detail: head.slice(0, 200) };
};

/* ---------- 第二部分:無頭 Chrome ---------- */
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
function portFree(p) {
  return new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(p, '127.0.0.1', () => s.close(() => res(true))); });
}
async function withChrome(fn) {
  let port = 0;
  for (let p = 8900; p <= 8919 && !port; p++) if (await portFree(p)) port = p;
  if (!port) throw new Error('8900 到 8919 都有人用');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-food-art-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  let ws = null;
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { up = (await fetch('http://127.0.0.1:' + port + '/json/version')).ok; } catch (e) { await new Promise((r) => setTimeout(r, 200)); }
    }
    if (!up) throw new Error('Chrome 沒有啟動');
    const { webSocketDebuggerUrl } = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
    ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const waiting = new Map();
    ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } };
    const evaluate = (expression) => new Promise((res, rej) => {
      const i = ++id;
      waiting.set(i, (msg) => {
        const r = msg.result || {};
        if (msg.error || r.exceptionDetails) rej(new Error(JSON.stringify(msg.error || r.exceptionDetails).slice(0, 400)));
        else res(r.result && r.result.value);
      });
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    return await fn(evaluate);
  } finally {
    if (ws) ws.close();
    proc.kill();
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }, 1000);
  }
}
/* 載入兩次(各自的快取),同參數比像素;同一份裡 3 張抖動要不一樣;每一口、碎屑都畫得出來 */
const PIXELS = `(() => {
  const px = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  const inked = (d) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; };
  const out = { pairs: 0, differ: [], fewer: [], blank: [], steps: 0 };
  for (const id of A.ids) {
    for (const size of [40, 56]) {
      const shots = [0, 1, 2].map((v) => {
        const a = px(A.render(id, { size, variant: v, dpr: 2 })), b = px(B.render(id, { size, variant: v, dpr: 2 }));
        out.pairs++;
        if (!same(a, b)) out.differ.push(id + ' ' + size + ' ' + v);
        if (inked(a) < 50) out.blank.push(id + ' ' + size + ' ' + v);
        return a;
      });
      if (same(shots[0], shots[1]) || same(shots[1], shots[2]) || same(shots[0], shots[2])) out.fewer.push(id + ' ' + size);
    }
    for (let s = 1; s <= A.info[id].steps; s++) for (const crumb of [null, 0.55, 1]) { A.render(id, { size: 56, step: s, crumb, dpr: 1 }); out.steps++; }
  }
  return out;
})()`;

(async () => {
  let pass = 0, skipped = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let r;
    try { r = await T[name](); } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + (r.ok ? (r.note ? '(' + r.note + ')' : '') : '\n     ' + r.detail));
  }
  const title = '無頭 Chrome:兩次載入同參數像素相同、每種 3 張抖動像素都不同、每一口和碎屑都畫得出來';
  if (!CHROME) {
    skipped++;
    console.log('SKIP ' + title + '(找不到 Chrome 或 Edge)');
  } else {
    let r;
    try {
      if (!FOOD_SRC) throw new Error('沒有 js/food-art.js');
      const o = await withChrome(async (ev) => {
        await ev('(() => {' + FOOD_SRC + '\n;window.A = window.FoodArt;' + FOOD_SRC + '\n;window.B = window.FoodArt; return A !== B; })()');
        return ev(PIXELS);
      });
      r = { ok: o.pairs === 54 && !o.differ.length && !o.fewer.length && !o.blank.length && o.steps > 0, detail: JSON.stringify(o) };
    } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.message) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + title + (r.ok ? '' : '\n     ' + r.detail));
  }
  const total = names.length + (CHROME ? 1 : 0);
  console.log('\n' + pass + ' / ' + total + ' 通過' + (skipped ? '(略過 ' + skipped + ')' : ''));
  setTimeout(() => process.exit(pass === total ? 0 : 1), 300);
})();
