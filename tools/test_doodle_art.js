/* 塗鴉圖示(js/doodle-art.js)的測試。
   用法:node tools/test_doodle_art.js
   在 Node 裡跑,用假的 canvas 記下每一個繪圖呼叫(跟 tools/test_food_art.js 同一套):
   圖示清單和順序、兩種 tone 都畫得出來、同參數兩次一模一樣、至少 3 組抖動、animate 預設不開計時器、
   減少動態不開計時器、mountAll 不重掛、不讀寫儲存也不用 Math.random、不認得的 id 丟出清楚的錯誤。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const SRC_FILE = path.join(REPO, 'js/doodle-art.js');
const SRC = fs.existsSync(SRC_FILE) ? fs.readFileSync(SRC_FILE, 'utf8') : '';
const EXPECT = [['home', '首頁'], ['learn', '日常學習'], ['warmup', '練練手感'], ['drill', '刷刷題目'], ['me', '我的'],
  ['grammar', '文法基礎'], ['phonics', '自然發音'], ['reading', '閱讀訓練'], ['dialogue', '對話練習'], ['vocab', '單字訓練'],
  ['listening', '聽力訓練'], ['writing', '寫作練習'], ['verbs', '不規則動詞'], ['practice', '題庫刷題'], ['mock', '模擬考'],
  ['diagnostic', '程度檢測'], ['wrongbook', '錯題本'], ['daily', '每日練習'], ['analysis', '能力分析'], ['history', '學習記錄']];
const YELLOW = '#ffe100';

/* ---------- 假的 canvas:記下每一個呼叫和屬性設定 ---------- */
const digest = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const fmt = (v) => (v && typeof v === 'object' && Array.isArray(v.log) ? 'img:' + digest(v.log.join('\n')) : String(v));
function makeCanvas(dataset) {
  const log = [];
  const c = { width: 300, height: 150, style: {}, log, dataset: dataset || {} };
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
/* 環境:儲存與 Math.random 一碰就記下來(不該被碰) */
function makeEnv(opt) {
  const o = Object.assign({ dpr: 1, reduce: false }, opt);
  const timers = new Map(), touched = [];
  let tid = 0;
  const g = {
    console, devicePixelRatio: o.dpr,
    matchMedia: (q) => ({ matches: o.reduce && /reduce/.test(q) }),
    setInterval: (fn, ms) => { timers.set(++tid, { fn, ms }); return tid; },
    clearInterval: (id) => { timers.delete(id); },
    setTimeout: (fn, ms) => { timers.set(++tid, { fn, ms, once: true }); return tid; },
    clearTimeout: (id) => { timers.delete(id); },
    document: { createElement: () => makeCanvas() },
  };
  ['localStorage', 'sessionStorage', 'indexedDB'].forEach((k) => Object.defineProperty(g, k, { get() { touched.push(k); return {}; } }));
  Object.defineProperty(g.document, 'cookie', { get() { touched.push('cookie'); return ''; }, set() { touched.push('cookie'); } });
  g.window = g;
  vm.createContext(g);
  vm.runInContext('Math.random = function () { globalThis.__rand = (globalThis.__rand || 0) + 1; return 0.5; };', g);
  if (SRC) vm.runInContext(SRC, g, { filename: 'doodle-art.js' });
  return { g, D: g.DoodleArt, timers, touched, rand: () => g.__rand || 0 };
}
const logOf = (c) => c.log.join('\n');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const strokes = (c) => c.log.filter((l) => l === 'stroke()').length;
const drawsOf = (c) => c.log.filter((l) => l.startsWith('drawImage(')).length;
const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e && e.message)); } };

const T = {};
T['載入後有 window.DoodleArt,介面齊全,邏輯畫布 100×100'] = () => {
  const { D } = makeEnv();
  const keys = ['ids', 'info', 'metrics', 'render', 'draw', 'mount', 'mountAll'];
  const missing = D ? keys.filter((k) => !(k in D)) : keys;
  return { ok: !!D && !missing.length && D.metrics.width === 100 && D.metrics.height === 100,
    detail: D ? '缺 ' + missing.join('、') + ' metrics ' + JSON.stringify(D.metrics) : '沒有 DoodleArt' };
};
T['20 個圖示的 id、順序、中文名稱'] = () => {
  const { D } = makeEnv();
  if (!D) return { ok: false, detail: '沒有 DoodleArt' };
  const mine = D.ids.map((id) => [id, D.info[id] && D.info[id].name]);
  const meaning = D.ids.every((id) => typeof D.info[id].meaning === 'string' && D.info[id].meaning.length > 0);
  return { ok: eq(mine, EXPECT) && meaning, detail: JSON.stringify(mine) };
};
T['每個圖示兩種 tone、26 和 72px 都有畫東西;fill 有黃色塗鴉、line 沒有'] = () => {
  const { D } = makeEnv();
  if (!D) return { ok: false, detail: '沒有 DoodleArt' };
  const bad = [];
  D.ids.forEach((id) => [26, 72].forEach((size) => {
    const f = D.render(id, { size, tone: 'fill' }), l = D.render(id, { size, tone: 'line' });
    if (strokes(f) < 3 || logOf(f).length < 800) bad.push(id + ' ' + size + ' fill 沒畫東西');
    if (strokes(l) < 2 || logOf(l).length < 300) bad.push(id + ' ' + size + ' line 沒畫東西');
    if (!logOf(f).includes('strokeStyle=' + YELLOW)) bad.push(id + ' ' + size + ' fill 沒有黃色塗鴉');
    if (logOf(l).includes(YELLOW)) bad.push(id + ' ' + size + ' line 有黃色');
  }));
  return { ok: !bad.length, detail: bad.slice(0, 8).join('、') };
};
T['tone line 加 ink #767f88:所有墨線都是灰的(強調色也換掉),強調色各只用一次'] = () => {
  const { D } = makeEnv();
  if (!D) return { ok: false, detail: '沒有 DoodleArt' };
  const bad = D.ids.filter((id) => {
    const styles = logOf(D.render(id, { size: 26, tone: 'line', ink: '#767f88' })).split('\n')
      .filter((s) => /^(strokeStyle|fillStyle)=/.test(s)).map((s) => s.split('=')[1]);
    return styles.some((s) => s !== '#767f88' && s !== '#ffffff');
  });
  /* 強調色各只用在一個圖示:紅叉只在錯題本、綠勾只在每日練習(題庫刷題的勾用墨線色) */
  const using = (c) => D.ids.filter((id) => logOf(D.render(id, { size: 72 })).includes(c));
  const red = using('#c94040'), green = using('#3a8a4d');
  const accents = red.join() === 'wrongbook' && green.join() === 'daily';
  return { ok: !bad.length && accents, detail: '有別的顏色:' + bad.join('、') + ' 紅:' + red.join('、') + ' 綠:' + green.join('、') };
};
T['同樣的參數畫兩次一模一樣(兩個各自載入的 DoodleArt 比繪圖呼叫)'] = () => {
  const a = makeEnv().D, b = makeEnv().D;
  if (!a || !b) return { ok: false, detail: '沒有 DoodleArt' };
  const bad = [];
  a.ids.forEach((id) => [[26, 0, 'line'], [26, 1, 'fill'], [40, 2, 'fill'], [128, 0, 'fill']].forEach(([size, variant, tone]) => {
    const o = { size, variant, tone, dpr: 2 };
    if (logOf(a.render(id, o)) !== logOf(b.render(id, Object.assign({}, o)))) bad.push(id + ' ' + JSON.stringify(o));
  }));
  return { ok: !bad.length, detail: bad.slice(0, 6).join('、') };
};
T['至少 3 組抖動,彼此不同;variant 3 回到第 0 組'] = () => {
  const { D } = makeEnv();
  if (!D) return { ok: false, detail: '沒有 DoodleArt' };
  const bad = D.ids.filter((id) => {
    const logs = [0, 1, 2, 3].map((v) => logOf(D.render(id, { size: 72, variant: v })));
    return new Set(logs.slice(0, 3)).size < 3 || logs[3] !== logs[0];
  });
  return { ok: D.variants >= 3 && !bad.length, detail: '不到 3 組:' + bad.join('、') };
};
T['render 照 dpr 定大小、同參數重用同一張;小尺寸線條比較粗'] = () => {
  const { D } = makeEnv({ dpr: 2 });
  if (!D) return { ok: false, detail: '沒有 DoodleArt' };
  const c = D.render('home', { size: 40 });
  const width = (size) => Math.max(...logOf(D.render('home', { size, tone: 'line', dpr: 1 })).split('\n')
    .filter((s) => s.startsWith('lineWidth=')).map((s) => +s.split('=')[1]));
  return { ok: c.width === 80 && c.height === 80 && D.render('home', { size: 40 }) === c && width(26) > width(128) * 1.8,
    detail: JSON.stringify({ w: c.width, h: c.height, w26: width(26), w128: width(128) }) };
};
T['draw(ctx, id, ...) 把畫好的那張貼到別人的畫布上'] = () => {
  const { D } = makeEnv();
  if (!D) return { ok: false, detail: '沒有 DoodleArt' };
  const c = makeCanvas();
  D.draw(c.getContext('2d'), 'mock', { x: 10, y: 20, size: 56, variant: 1 });
  const img = 'img:' + digest(logOf(D.render('mock', { size: 56, variant: 1, dpr: 1 })));
  return { ok: eq(c.log, ['drawImage(' + img + ',10,20,56,56)']), detail: JSON.stringify(c.log) };
};
T['mount 預設不動:只畫一張、不開計時器;setTone、setInk 重畫'] = () => {
  const env = makeEnv({ dpr: 2 });
  if (!env.D) return { ok: false, detail: '沒有 DoodleArt' };
  const c = makeCanvas();
  const h = env.D.mount(c, 'learn', { size: 26, tone: 'line', ink: '#767f88' });
  const first = drawsOf(c);
  h.setTone('fill'); h.setInk('#151515');
  const lineImg = 'img:' + digest(logOf(env.D.render('learn', { size: 26, tone: 'line', ink: '#767f88', dpr: 2 })));
  return { ok: env.timers.size === 0 && first === 1 && drawsOf(c) === 3 && c.width === 52 && c.style.width === '26px' && h.tone === 'fill'
    && c.log.some((l) => l.includes(lineImg)) && !h.animating && typeof h.stop === 'function',
  detail: JSON.stringify({ timers: env.timers.size, draws: drawsOf(c), w: c.width, css: c.style.width }) };
};
T['animate: true 輪流換抖動組,stop() 清掉計時器'] = () => {
  const env = makeEnv();
  if (!env.D) return { ok: false, detail: '沒有 DoodleArt' };
  const c = makeCanvas();
  const h = env.D.mount(c, 'home', { size: 40, animate: true });
  const iv = [...env.timers.values()].filter((t) => !t.once);
  if (iv.length !== 1) return { ok: false, detail: '計時器 ' + iv.length };
  for (let i = 0; i < 3; i++) iv[0].fn();
  const imgs = c.log.filter((l) => l.startsWith('drawImage('));
  h.stop();
  return { ok: imgs.length === 4 && new Set(imgs.slice(0, 3)).size === 3 && imgs[3] === imgs[0] && env.timers.size === 0 && h.animating === false,
    detail: JSON.stringify({ imgs: imgs.length, distinct: new Set(imgs).size, timers: env.timers.size }) };
};
T['減少動態:animate: true 也不開計時器'] = () => {
  const env = makeEnv({ reduce: true });
  if (!env.D) return { ok: false, detail: '沒有 DoodleArt' };
  const h = env.D.mount(makeCanvas(), 'mock', { size: 40, animate: true });
  const root = { querySelectorAll: () => [makeCanvas({ doodle: 'home', size: '26', animate: 'true' })] };
  env.D.mountAll(root);
  return { ok: env.timers.size === 0 && h.reducedMotion === true, detail: '計時器 ' + env.timers.size };
};
T['mountAll:照 data-* 畫好、掛過的不重掛、不認得的 id 其他照掛再丟錯'] = () => {
  const env = makeEnv({ dpr: 2 });
  if (!env.D) return { ok: false, detail: '沒有 DoodleArt' };
  const a = makeCanvas({ doodle: 'home', size: '26', tone: 'line', ink: '#767f88' });
  const b = makeCanvas({ doodle: 'vocab', size: '72' });
  const c = makeCanvas({ doodle: 'mock' });
  const list = [a, b, c];
  const root = { querySelectorAll: (sel) => (sel === 'canvas[data-doodle]' ? list : []) };
  const first = env.D.mountAll(root);
  const again = env.D.mountAll(root);
  const ok1 = first.length === 3 && again.length === 0 && [a, b, c].every((x) => drawsOf(x) === 1);
  const sizes = a.width === 52 && b.width === 144 && c.width === 80 && first[0].tone === 'line' && first[1].tone === 'fill';
  const lineImg = 'img:' + digest(logOf(env.D.render('home', { size: 26, tone: 'line', ink: '#767f88', dpr: 2 })));
  const d = makeCanvas({ doodle: 'nope' }), e = makeCanvas({ doodle: 'daily', size: '40' });
  list.push(d, e);
  const threw = throwsWith(() => env.D.mountAll(root), /nope/);
  return { ok: ok1 && sizes && a.log.some((l) => l.includes(lineImg)) && threw && drawsOf(e) === 1 && env.timers.size === 0 && env.D.handleOf(a) === first[0],
    detail: JSON.stringify({ first: first.length, again: again.length, sizes: [a.width, b.width, c.width], threw, e: drawsOf(e) }) };
};
T['不讀寫儲存、不用 Math.random(原始碼和實際執行都查)'] = () => {
  const env = makeEnv({ reduce: false });
  if (!env.D) return { ok: false, detail: '沒有 DoodleArt' };
  env.D.ids.forEach((id) => { env.D.render(id, { size: 26 }); env.D.render(id, { size: 72, tone: 'line', variant: 2 }); });
  const h = env.D.mount(makeCanvas(), 'home', { animate: true });
  [...env.timers.values()].forEach((t) => t.fn());
  h.stop();
  env.D.mountAll({ querySelectorAll: () => [makeCanvas({ doodle: 'me' })] });
  const src = !/localStorage|sessionStorage|indexedDB|document\.cookie|Math\.random/.test(SRC);
  return { ok: src && !env.touched.length && env.rand() === 0, detail: JSON.stringify({ src, touched: env.touched, rand: env.rand() }) };
};
T['26px 灰線版另外簡化:答案卡、嘴、文章、錯題本的墨線筆畫比上色版少,其他尺寸的灰線版不受影響'] = () => {
  const { D } = makeEnv();
  if (!D) return { ok: false, detail: '沒有 DoodleArt' };
  /* 只數墨線的筆畫(塗鴉不算;強調色在灰線版會換成墨線色,所以也算):走過繪圖紀錄,stroke() 當下的 strokeStyle 是墨線色或強調色才算一筆 */
  const inkStrokes = (c) => { let s = '', k = 0; c.log.forEach((l) => { if (l.startsWith('strokeStyle=')) s = l.slice(12); else if (l === 'stroke()' && ['#151515', '#c94040', '#3a8a4d'].includes(s)) k++; }); return k; };
  const n = (id, size, tone) => inkStrokes(D.render(id, { size, tone }));
  const slim = ['drill', 'phonics', 'reading', 'wrongbook'];
  const bad = slim.filter((id) => !(n(id, 26, 'line') < n(id, 26, 'fill')));
  /* 72px 的灰線版跟上色版是同一組墨線(只少了塗鴉) */
  const big = D.ids.filter((id) => n(id, 72, 'line') !== n(id, 72, 'fill'));
  return { ok: !bad.length && !big.length, detail: '沒變少:' + bad.join('、') + ' 72px 墨線不同:' + big.join('、') };
};
T['不認得的 id、tone 丟出清楚的錯誤'] = () => {
  const { D } = makeEnv();
  if (!D) return { ok: false, detail: '沒有 DoodleArt' };
  const r = [
    throwsWith(() => D.render('nope', { size: 40 }), /DoodleArt.*nope/),
    throwsWith(() => D.mount(makeCanvas(), 'nope'), /DoodleArt.*nope/),
    throwsWith(() => D.draw(makeCanvas().getContext('2d'), 'toString'), /DoodleArt.*toString/),
    throwsWith(() => D.render('home', { tone: 'bold' }), /tone/),
    throwsWith(() => D.mount(makeCanvas(), 'home').setIcon('nope'), /nope/),
  ];
  return { ok: r.every(Boolean), detail: JSON.stringify(r) };
};
T['檔頭說原檔不在 repo,不寫本機路徑'] = () => {
  const head = SRC.split('*/')[0];
  return { ok: /原檔與預覽不在這個 repo/.test(head) && !/[A-Za-z]:[\\/]/.test(SRC) && !/\/(Users|home)\//.test(SRC), detail: head.slice(0, 160) };
};

let pass = 0;
const names = Object.keys(T);
for (const name of names) {
  let r;
  try { r = T[name](); } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e) }; }
  if (r.ok) pass++;
  console.log((r.ok ? 'PASS ' : 'FAIL ') + name + (r.ok ? '' : '\n     ' + r.detail));
}
console.log('\n' + pass + ' / ' + names.length + ' 通過');
process.exit(pass === names.length ? 0 : 1);
