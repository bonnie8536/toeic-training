/* 塗鴉鵜鶘(js/pelican-art.js,version 3:本體、待機,加上開心、尷尬、看書、睡覺四個姿勢)的測試。
   用法:node tools/test_pelican_art.js
   在 Node 裡跑,用假的 canvas 記下每一個繪圖呼叫(含每個數字的完整值)和每一次設定的顏色、筆粗,檢查:
   - 介面:姿勢清單、格數、holds、靜止格、速度、metrics、version。
   - 同樣的參數畫兩次,呼叫序列一模一樣;換抖動組、換格會不一樣。
   - 播放:照 holds 展開的順序循環、間隔跟著速度;減少動態時只畫靜止格、不開計時器;show 會停計時器;onTick 裡換姿勢不會多留計時器。
   - 不讀寫任何儲存、不用 Math.random。
   - 畫出來的點都在畫布裡;全身不出現藍色系;白色身體真的有塗白(一大片純白,蓋住身體、頭和上嘴)。
   - 第二版:墨線有輕重;嘴袋的黃色是一束一束、方向不一的掃筆。
   - version 2:姿勢清單照順序是 idle、happy、oops、read、sleep;各姿勢的格數、holds、靜止格、速度(尷尬和看書比待機慢、睡覺最慢);
     每個姿勢的每一格都畫得出來、畫兩次一樣、不超出畫布、沒有藍色、白色身體有塗白;減少動態時換到哪個姿勢都只畫那個姿勢的靜止格;
     看書那幾格多了書頁的白色。
   - version 3:看書改成正面捧書:每一格都有一本書(一大片白色、在身體下半),書沒有任何黃色,嘴袋的黃色跟書頂之間留白縫;
     其他姿勢沒有書;睡覺的 z 和呆毛離畫布上緣至少 8%。 */
const POSES = ['idle', 'happy', 'oops', 'read', 'sleep'];
/* 各姿勢的格數範圍 */
const FRAMES = { idle: [7, 10], happy: [9, 11], oops: [8, 10], read: [7, 9], sleep: [6, 8] };
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'js/pelican-art.js'), 'utf8');
const SIZES = [52, 96, 120, 160, 180, 300];

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

/* 一個獨立的假頁面:自己的計時器、自己的 PelicanArt。碰到任何儲存就記下來;Math.random 一被呼叫就丟例外 */
function makeEnv(opt) {
  const o = Object.assign({ dpr: 1, reduce: false }, opt);
  const timers = new Map(), touched = [];
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
  ['localStorage', 'sessionStorage', 'indexedDB'].forEach((k) => Object.defineProperty(g, k, { get() { touched.push(k); return undefined; } }));
  Object.defineProperty(g.document, 'cookie', { get() { touched.push('cookie'); return ''; }, set() { touched.push('cookie'); } });
  g.window = g;
  vm.createContext(g);
  vm.runInContext('Math.random = function () { throw new Error("用了 Math.random"); };', g);
  vm.runInContext(SRC, g, { filename: 'pelican-art.js' });
  return { A: g.PelicanArt, g, timers, touched, intervals: () => [...timers.values()].filter((t) => !t.once) };
}
const ART = makeEnv().A;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function frameLog(A, pose, k, variant, size, seed) {
  const c = makeCanvas();
  A.drawFrame(c.getContext('2d'), pose, k, seed === undefined ? { variant, size } : { variant, size, seed });
  return c.log;
}
/* 某個大小、某個 dpr 下,烤好的每一格(含開頭那一下 scale)的指紋 → [格, 抖動組] */
function bakedMap(A, pose, size, dpr) {
  const px = size / A.metrics.width * dpr, m = new Map();
  for (let k = 0; k < A.frameCount(pose); k++) for (const v of [0, 1]) {
    m.set('img:' + digest(['scale(' + px + ',' + px + ')'].concat(frameLog(A, pose, k, v, size)).join('\n')), [k, v]);
  }
  return m;
}
const painted = (canvas) => canvas.log.filter((l) => l.startsWith('drawImage(')).map((l) => l.slice(10).split(',')[0]);
const nums = (l) => l.slice(l.indexOf('(') + 1, -1).split(',').map(Number);

/* 從呼叫記錄裡抓出每一個用到的點(arc 用圓心加減半徑) */
function points(log) {
  const pts = [];
  log.forEach((l) => {
    if (/^(moveTo|lineTo)\(/.test(l)) { const [x, y] = nums(l); pts.push([x, y]); }
    else if (l.startsWith('quadraticCurveTo(')) { const [a, b, c, d] = nums(l); pts.push([a, b], [c, d]); }
    else if (l.startsWith('arc(')) { const [x, y, r] = nums(l); pts.push([x - r, y - r], [x + r, y + r]); }
  });
  return pts;
}
/* 每一次 fill() 的多邊形和當時的填色 */
function fills(log) {
  const out = [];
  let color = null, path = [];
  log.forEach((l) => {
    if (l.startsWith('fillStyle=')) color = l.slice(10);
    else if (l === 'beginPath()') path = [];
    else if (/^(moveTo|lineTo)\(/.test(l)) path.push(nums(l));
    else if (l === 'fill()') out.push({ color, path: path.slice() });
  });
  return out;
}
const area = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0)) / 2;
function inside(p, [x, y]) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/* 藍色系:藍色明顯比紅、綠都多(#0b72c4、淡藍 #dbeaf7 這種都算) */
function bluish(css) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(css).trim());
  if (!m) return true;                           // 不是 #rrggbb 的顏色一律當可疑
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return b > r + 12 && b >= g;
}

const T = {};

/* ---------- 介面 ---------- */
T['姿勢清單、version、metrics、速度'] = () => {
  const d = [];
  if (!eq(ART.poses, POSES)) d.push('poses ' + JSON.stringify(ART.poses));
  if (ART.version !== 3) d.push('version ' + ART.version);
  if (!eq(ART.metrics, { width: 300, height: 280, ground: 258 })) d.push('metrics ' + JSON.stringify(ART.metrics));
  if (!POSES.every((p) => ART.fps[p] > 0 && ART.fps[p] <= 8)) d.push('fps ' + JSON.stringify(ART.fps));
  // 尷尬比待機慢、看書不比待機快、睡覺最慢
  const f = ART.fps;
  if (!(f.oops < f.idle && f.read <= f.idle && POSES.every((p) => p === 'sleep' || f.sleep < f[p]))) d.push('速度順序 ' + JSON.stringify(f));
  ['animate', 'drawFrame', 'frameCount', 'holds'].forEach((k) => { if (typeof ART[k] !== 'function') d.push(k + ' 不是函式'); });
  return { ok: !d.length, detail: d.join(';') };
};
T['idle 約 8 格,holds 是正整數、一圈 2 到 4 秒;靜止格在範圍內;不認得的姿勢格數是 0'] = () => {
  const n = ART.frameCount('idle'), h = ART.holds('idle');
  const beats = h.reduce((a, b) => a + b, 0), sec = beats / ART.fps.idle;
  const ok = n >= 7 && n <= 10 && h.length === n && h.every((x) => Number.isInteger(x) && x >= 1 && x <= 4)
    && sec >= 2 && sec <= 4 && Number.isInteger(ART.calm.idle) && ART.calm.idle >= 0 && ART.calm.idle < n
    && ART.frameCount('nope') === 0 && eq(ART.holds('nope'), []);
  return { ok, detail: JSON.stringify({ n, h, sec, calm: ART.calm }) };
};

T['四個新姿勢:格數、holds(正整數、1 到 3)、靜止格都在範圍內;一圈的秒數合理(開心 1~3 秒,其他 2~5 秒)'] = () => {
  const d = [], info = {};
  POSES.slice(1).forEach((p) => {
    const n = ART.frameCount(p), h = ART.holds(p), c = ART.calm[p];
    const sec = h.reduce((a, b) => a + b, 0) / ART.fps[p];
    info[p] = { n, sec: +sec.toFixed(2), calm: c };
    if (!(n >= FRAMES[p][0] && n <= FRAMES[p][1])) d.push(p + ' 格數 ' + n);
    if (!(h.length === n && h.every((x) => Number.isInteger(x) && x >= 1 && x <= 3))) d.push(p + ' holds ' + JSON.stringify(h));
    if (!(Number.isInteger(c) && c >= 0 && c < n)) d.push(p + ' 靜止格 ' + c);
    const [lo, hi] = p === 'happy' ? [1, 3] : [2, 5];
    if (!(sec >= lo && sec <= hi)) d.push(p + ' 一圈 ' + sec.toFixed(2) + ' 秒');
  });
  return { ok: !d.length, detail: d.join(';') + ' ' + JSON.stringify(info) };
};

/* ---------- 畫法固定 ---------- */
T['同樣的參數畫兩次,呼叫序列相同(每個姿勢的每一格、兩種抖動、6 種大小);換抖動組、換格、換種子都不一樣'] = () => {
  const B = makeEnv().A, d = [];
  let n = 0, want = 0;
  for (const pose of POSES) for (const size of SIZES) for (let k = 0; k < ART.frameCount(pose); k++) {
    const a0 = frameLog(ART, pose, k, 0, size).join('\n'), a1 = frameLog(ART, pose, k, 1, size).join('\n');
    const b0 = frameLog(B, pose, k, 0, size).join('\n'), again = frameLog(ART, pose, k, 0, size).join('\n');
    n++;
    if (a0 !== b0 || a0 !== again) d.push(pose + ' ' + size + ' 第 ' + k + ' 格畫兩次不同');
    if (a0 === a1) d.push(pose + ' ' + size + ' 第 ' + k + ' 格兩種抖動一樣');
    if (a0.length < 2000) d.push(pose + ' ' + size + ' 第 ' + k + ' 格幾乎沒畫');
    if (k && a0 === frameLog(ART, pose, k - 1, 0, size).join('\n')) d.push(pose + ' ' + size + ' 第 ' + k + ' 格跟前一格一樣');
  }
  POSES.forEach((p) => { want += SIZES.length * ART.frameCount(p); });
  if (frameLog(ART, 'idle', 0, 0, 180, 7).join('\n') === frameLog(ART, 'idle', 0, 0, 180, 8).join('\n')) d.push('換種子沒變');
  // 不同姿勢的同一格不會畫成一樣(各姿勢的種子不同)
  if (frameLog(ART, 'idle', 0, 0, 180).join('\n') === frameLog(ART, 'oops', 0, 0, 180).join('\n')) d.push('idle 和 oops 第 0 格一樣');
  return { ok: !d.length && n === want, detail: n + ' 組;' + d.slice(0, 8).join('、') };
};

/* ---------- 播放 ---------- */
function run(opt, n, envOpt) {
  const env = makeEnv(Object.assign({ dpr: 2 }, envOpt));
  const canvas = makeCanvas(), ticks = [];
  const a = env.A.animate(canvas, Object.assign({ size: 180, fps: 8, maxDpr: 2, pose: 'idle', onTick: (t) => ticks.push(t) }, opt));
  for (let i = 1; i < n; i++) { const iv = env.intervals(); if (iv.length) iv[0].fn(); }
  return { env, a, canvas, ticks };
}
T['animate:照 holds 展開的順序循環,抖動組每圈輪替;間隔 1000/5 ms(基準 fps 8),setFps(4) 變兩倍;畫布大小照 size'] = () => {
  const { env, a, canvas, ticks } = run({}, 60);
  const want = [];
  ART.holds('idle').forEach((h, k) => { for (let j = 0; j < h; j++) want.push(k); });
  const got = ticks.map((t) => t.frame);
  const seqOk = got.every((k, i) => k === want[i % want.length]);
  const map = bakedMap(env.A, 'idle', 180, 2), kv = painted(canvas).map((x) => map.get(x));
  const kvOk = kv.length === 60 && kv.every((x, i) => x && x[0] === want[i % want.length]);
  const vary = new Set(kv.filter(Boolean).map((x) => x[1])).size === 2;
  const ms0 = env.intervals().map((t) => t.ms);
  a.setFps(4);
  const ms1 = env.intervals().map((t) => t.ms);
  const sizeOk = canvas.width === 360 && canvas.height === 336 && canvas.style.width === '180px' && canvas.style.height === '168px';
  a.stop();
  const ok = seqOk && kvOk && vary && eq(ms0, [200]) && eq(ms1, [400]) && a.fps === 2.5 && sizeOk && env.intervals().length === 0;
  return { ok, detail: JSON.stringify({ seqOk, kvOk, vary, ms0, ms1, fps: a.fps, w: canvas.width, h: canvas.height, style: canvas.style }) };
};
T['variants: 1 時只用抖動組 0'] = () => {
  const { env, canvas } = run({ variants: 1 }, 40);
  const map = bakedMap(env.A, 'idle', 180, 2), kv = painted(canvas).map((x) => map.get(x));
  return { ok: kv.length === 40 && kv.every((x) => x && x[1] === 0), detail: JSON.stringify(kv.slice(0, 6)) };
};
T['減少動態:只畫靜止格、不開計時器;setPose、setFps 之後也一樣;show 也畫靜止格'] = () => {
  const { env, a, canvas, ticks } = run({}, 1, { reduce: true });
  const map = bakedMap(env.A, 'idle', 180, 2);
  const calm = ART.calm.idle;
  const c0 = painted(canvas).map((x) => map.get(x));
  const iv0 = env.intervals().length;
  a.setPose('idle'); a.setFps(4);
  a.show(calm === 3 ? 4 : 3, 1);
  const all = painted(canvas).map((x) => map.get(x));
  const ok = a.reducedMotion === true && iv0 === 0 && env.intervals().length === 0 && ticks.length === 0
    && c0.length === 1 && all.length === 4 && all.every((x) => x && x[0] === calm && x[1] === 0);
  return { ok, detail: JSON.stringify({ iv0, left: env.intervals().length, all, ticks: ticks.length }) };
};
T['減少動態:setPose 換到每個新姿勢都只畫那個姿勢的靜止格、不開計時器;show 指定姿勢也一樣'] = () => {
  const { env, a, canvas } = run({}, 1, { reduce: true });
  const d = [];
  POSES.forEach((p) => {
    const map = bakedMap(env.A, p, 180, 2);
    const start = painted(canvas).length;
    a.setPose(p);
    a.show(ART.calm[p] + 1, 1, p);
    const got = painted(canvas).slice(start).map((x) => map.get(x));
    if (!(got.length === 2 && got.every((x) => x && x[0] === ART.calm[p] && x[1] === 0))) d.push(p + ' ' + JSON.stringify(got));
    if (a.pose !== p) d.push(p + ' pose 是 ' + a.pose);
  });
  return { ok: !d.length && env.intervals().length === 0, detail: d.join(';') + ' 計時器 ' + env.intervals().length };
};
T['播放新姿勢:setPose 之後照該姿勢的 holds 循環,間隔照該姿勢的速度'] = () => {
  const d = [];
  POSES.slice(1).forEach((p) => {
    const { env, a, ticks } = run({ pose: p }, 40);
    const want = [];
    ART.holds(p).forEach((h, k) => { for (let j = 0; j < h; j++) want.push(k); });
    const got = ticks.map((t) => t.frame);
    if (!(got.length === 40 && got.every((k, i) => k === want[i % want.length]))) d.push(p + ' 順序 ' + got.slice(0, 12).join(','));
    const ms = env.intervals().map((t) => t.ms);
    if (!eq(ms, [1000 / ART.fps[p]])) d.push(p + ' 間隔 ' + JSON.stringify(ms));
    a.stop();
  });
  return { ok: !d.length, detail: d.join(';') };
};
T['show 會停掉計時器、只畫指定那一格(格號取餘數,負的也行)'] = () => {
  const { env, a, canvas } = run({}, 5);
  const before = env.intervals().length;
  const map = bakedMap(env.A, 'idle', 180, 2), n = ART.frameCount('idle');
  const start = painted(canvas).length;
  a.show(3, 1); a.show(n + 2, 0); a.show(-1, 1);
  const shown = painted(canvas).slice(start).map((x) => map.get(x));
  const ok = before === 1 && env.intervals().length === 0 && eq(shown, [[3, 1], [2, 0], [n - 1, 1]]);
  return { ok, detail: JSON.stringify({ before, after: env.intervals().length, shown }) };
};
T['重入:onTick 裡呼叫 setPose 只留一個計時器,stop() 之後一個都不剩'] = () => {
  const env = makeEnv({ dpr: 1 });
  const canvas = makeCanvas();
  let a = null, n = 0;
  a = env.A.animate(canvas, { size: 120, pose: 'idle', onTick: () => { if (a && n++ < 3) a.setPose('idle'); } });
  for (let i = 0; i < 6; i++) env.intervals()[0].fn();
  const live = env.intervals().length;
  a.stop();
  return { ok: live === 1 && env.intervals().length === 0, detail: 'live ' + live + ',stop 後 ' + env.intervals().length };
};
T['不讀寫任何儲存、不用 Math.random(原始碼裡也沒有這些字)'] = () => {
  const { env } = run({}, 30);
  const B = env.A;
  for (const size of SIZES) frameLog(B, 'idle', 0, 1, size);
  const words = ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'Math.random'].filter((w) => SRC.includes(w));
  return { ok: !env.touched.length && !words.length, detail: JSON.stringify({ touched: env.touched, words }) };
};

/* ---------- 畫出來的東西 ---------- */
T['所有點都在畫布裡(每個姿勢的每一格、兩種抖動、6 種大小,離邊至少 1 px,300×280)'] = () => {
  const W = ART.metrics.width, H = ART.metrics.height, bad = [];
  let worst = [Infinity, Infinity, -Infinity, -Infinity];
  for (const pose of POSES) for (const size of SIZES) for (let k = 0; k < ART.frameCount(pose); k++) for (const v of [0, 1]) {
    points(frameLog(ART, pose, k, v, size)).forEach(([x, y]) => {
      worst = [Math.min(worst[0], x), Math.min(worst[1], y), Math.max(worst[2], x), Math.max(worst[3], y)];
      if (!(x >= 1 && x <= W - 1 && y >= 1 && y <= H - 1)) bad.push(pose + ' ' + size + '/' + k + '/' + v + ' ' + x.toFixed(1) + ',' + y.toFixed(1));
    });
  }
  return { ok: !bad.length, detail: '範圍 ' + worst.map((x) => x.toFixed(1)).join(',') + ';超出 ' + bad.length + ':' + bad.slice(0, 6).join('、') };
};
T['全身不出現藍色系:每個姿勢(含看書的書)所有填色和線色只有墨黑、黃、純白三種'] = () => {
  const seen = new Set();
  for (const pose of POSES) for (const size of SIZES) for (let k = 0; k < ART.frameCount(pose); k++) for (const v of [0, 1]) {
    frameLog(ART, pose, k, v, size).forEach((l) => { if (/^(fillStyle|strokeStyle)=/.test(l)) seen.add(l.split('=')[1].toLowerCase()); });
  }
  const list = [...seen].sort();
  const blue = list.filter(bluish);
  return { ok: !blue.length && eq(list, ['#151515', '#ffe100', '#ffffff']), detail: JSON.stringify({ list, blue }) };
};
T['白色身體有實際塗白:每一格都有一大片純白填色,蓋住頭、身體、上嘴和嘴袋,而且在黃色塗鴉和外框之前塗'] = () => {
  const d = [];
  const probes = { 頭: [190, 75], 身體: [215, 150], 肚子: [170, 225], 上嘴: [70, 103], 嘴袋: [100, 160] };
  for (const size of SIZES) for (let k = 0; k < ART.frameCount('idle'); k++) {
    const log = frameLog(ART, 'idle', k, 0, size);
    const white = fills(log).filter((f) => f.color === '#ffffff').sort((a, b) => area(b.path) - area(a.path));
    if (!white.length) { d.push(size + '/' + k + ' 沒有塗白'); continue; }
    const big = white[0].path, A = area(big);
    if (A < 25000) d.push(size + '/' + k + ' 白色面積只有 ' + Math.round(A));
    Object.entries(probes).forEach(([name, p]) => { if (!inside(big, p)) d.push(size + '/' + k + ' ' + name + '沒塗到'); });
    const iWhite = log.indexOf('fillStyle=#ffffff'), iYellow = log.indexOf('strokeStyle=#ffe100');
    const iOutline = log.findIndex((l, i) => i > iYellow && l === 'strokeStyle=#151515');
    if (!(iWhite >= 0 && iWhite < iYellow && iYellow < iOutline)) d.push(size + '/' + k + ' 塗白的順序不對');
    if (white.length < 4) d.push(size + '/' + k + ' 翅膀或呆毛沒塗白');
  }
  return { ok: !d.length, detail: d.slice(0, 8).join('、') };
};
T['新姿勢的白色身體也有塗白:每一格最大一片純白夠大、蓋住肚子中間,在黃色和外框之前塗;翅膀和呆毛也塗白'] = () => {
  const d = [];
  for (const pose of POSES.slice(1)) for (const size of SIZES) for (let k = 0; k < ART.frameCount(pose); k++) {
    const log = frameLog(ART, pose, k, 0, size);
    const white = fills(log).filter((f) => f.color === '#ffffff').sort((a, b) => area(b.path) - area(a.path));
    if (!white.length) { d.push(pose + ' ' + size + '/' + k + ' 沒有塗白'); continue; }
    const big = white[0].path, A = area(big);
    // 身體會壓扁(最扁約 0.8),面積下限放寬到 2 萬;肚子中間(身體中線、碗和肚子底部之間)一定在白色裡面
    if (A < 20000) d.push(pose + ' ' + size + '/' + k + ' 白色面積只有 ' + Math.round(A));
    const xs = big.map((p) => p[0]), ys = big.map((p) => p[1]);
    const probe = [(Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2 + 40, (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2];
    if (!inside(big, probe)) d.push(pose + ' ' + size + '/' + k + ' 身體中間沒塗到');
    const iWhite = log.indexOf('fillStyle=#ffffff'), iYellow = log.indexOf('strokeStyle=#ffe100');
    const iOutline = log.findIndex((l, i) => i > iYellow && l === 'strokeStyle=#151515');
    if (!(iWhite >= 0 && iWhite < iYellow && iYellow < iOutline)) d.push(pose + ' ' + size + '/' + k + ' 塗白的順序不對');
    if (white.length < 4) d.push(pose + ' ' + size + '/' + k + ' 翅膀或呆毛沒塗白');
  }
  return { ok: !d.length, detail: d.slice(0, 8).join('、') };
};
/* 書:最大一片「整個在畫布下半(上緣低於 175)、寬超過 100」的白色填色 */
function bookOf(log) {
  const box = (p) => { const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]); return [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)]; };
  const cands = fills(log).filter((f) => f.color === '#ffffff' && f.path.length > 3).map((f) => box(f.path)).filter((b) => b[1] > 175 && b[2] - b[0] > 100);
  return cands.length ? cands.sort((a, b) => (b[2] - b[0]) - (a[2] - a[0]))[0] : null;
}
/* 黃色筆畫用到的每一個點 */
function yellowPoints(log) {
  let color = null;
  const out = [];
  log.forEach((l) => {
    if (l.startsWith('strokeStyle=')) color = l.slice(12);
    else if (color === '#ffe100' && /^(moveTo|lineTo)\(/.test(l)) out.push(nums(l));
    else if (color === '#ffe100' && l.startsWith('quadraticCurveTo(')) { const [a, b, c, d] = nums(l); out.push([a, b], [c, d]); }
  });
  return out;
}
T['看書的每一格都有書(下半一大片白色);書裡沒有黃色,嘴袋的黃色最低點離書頂至少 8(300 的畫布);其他姿勢沒有書'] = () => {
  const d = [];
  let minGap = Infinity;
  for (const size of SIZES) for (let k = 0; k < ART.frameCount('read'); k++) for (const v of [0, 1]) {
    const log = frameLog(ART, 'read', k, v, size), b = bookOf(log);
    if (!b) { d.push('read ' + size + '/' + k + ' 沒有書'); continue; }
    const ys = yellowPoints(log);
    if (!ys.length) d.push('read ' + size + '/' + k + ' 沒有嘴袋的黃色');
    const inBook = ys.filter(([x, y]) => x >= b[0] && x <= b[2] && y >= b[1]);
    if (inBook.length) d.push('read ' + size + '/' + k + ' 書裡有黃色 ' + inBook.length);
    const low = Math.max.apply(null, ys.filter(([x]) => x >= b[0] && x <= b[2]).map((p) => p[1]).concat([-Infinity]));
    minGap = Math.min(minGap, b[1] - low);
    if (b[1] - low < 8) d.push('read ' + size + '/' + k + ' 黃色離書頂只有 ' + (b[1] - low).toFixed(1));
  }
  ['idle', 'happy', 'oops', 'sleep'].forEach((p) => { for (let k = 0; k < ART.frameCount(p); k++) if (bookOf(frameLog(ART, p, k, 0, 180))) d.push(p + ' ' + k + ' 有書'); });
  return { ok: !d.length, detail: '最小白縫 ' + minGap.toFixed(1) + ';' + d.slice(0, 6).join('、') };
};
T['看書時嘴、嘴袋、書、腳整圈不動(各格的黃色範圍和書的位置都一樣)'] = () => {
  const d = [], ref = {};
  for (let k = 0; k < ART.frameCount('read'); k++) {
    const log = frameLog(ART, 'read', k, 0, 300), b = bookOf(log), ys = yellowPoints(log);
    const yb = [Math.min.apply(null, ys.map((p) => p[0])), Math.max.apply(null, ys.map((p) => p[1]))];
    if (!k) { ref.b = b; ref.yb = yb; continue; }
    if (b.some((x, i) => Math.abs(x - ref.b[i]) > 3)) d.push(k + ' 書動了 ' + JSON.stringify(b.map(Math.round)));
    if (yb.some((x, i) => Math.abs(x - ref.yb[i]) > 4)) d.push(k + ' 嘴袋動了 ' + JSON.stringify(yb.map(Math.round)));
  }
  return { ok: !d.length, detail: d.slice(0, 6).join('、') };
};
T['睡覺:每一格所有的點(含 z、呆毛)離畫布上緣至少 8%'] = () => {
  const lim = ART.metrics.height * 0.08, bad = [];
  for (const size of SIZES) for (let k = 0; k < ART.frameCount('sleep'); k++) for (const v of [0, 1]) {
    const top = Math.min.apply(null, points(frameLog(ART, 'sleep', k, v, size)).map((p) => p[1]));
    if (top < lim) bad.push(size + '/' + k + '/' + v + ' ' + top.toFixed(1));
  }
  return { ok: !bad.length, detail: '上限 ' + lim.toFixed(1) + ';' + bad.slice(0, 6).join('、') };
};
T['墨線有輕重(粗細很多種);嘴袋黃色是一束一束方向不一的掃筆(至少 30 束,方向至少差 25°)'] = () => {
  const log = frameLog(ART, 'idle', 0, 0, 180);
  let color = null;
  const inkW = new Set(), sweeps = [];
  let path = [];
  log.forEach((l) => {
    if (l.startsWith('strokeStyle=')) color = l.slice(12);
    else if (l.startsWith('lineWidth=') && color === '#151515') inkW.add(l.slice(10));
    else if (l === 'beginPath()') path = [];
    else if (/^(moveTo|lineTo)\(/.test(l)) path.push(nums(l));
    else if (l.startsWith('quadraticCurveTo(')) { const [a, b, c, d] = nums(l); path.push([a, b], [c, d]); }
    else if (l === 'stroke()' && color === '#ffe100' && path.length > 2) sweeps.push(path.slice());
  });
  // 每一束取第一筆的方向(第一點到離它最遠的點),換成 0~180°
  const angs = sweeps.map((p) => {
    let far = p[0], dmax = 0;
    p.forEach((q) => { const dd = Math.hypot(q[0] - p[0][0], q[1] - p[0][1]); if (dd > dmax) { dmax = dd; far = q; } });
    return ((Math.atan2(far[1] - p[0][1], far[0] - p[0][0]) * 180 / Math.PI) + 360) % 180;
  });
  const spread = angs.length ? Math.max.apply(null, angs) - Math.min.apply(null, angs) : 0;
  const ok = inkW.size >= 30 && sweeps.length >= 30 && spread >= 25;
  return { ok, detail: JSON.stringify({ inkWidths: inkW.size, sweeps: sweeps.length, spread: Math.round(spread) }) };
};
T['畫得小時墨線加粗(52 px 比 180 px 粗),180 px 以上不加粗'] = () => {
  const widths = (size) => frameLog(ART, 'idle', 0, 0, size).filter((l) => l.startsWith('lineWidth=')).map((l) => +l.slice(10));
  const max = (a) => Math.max.apply(null, a);
  const w52 = max(widths(52)), w180 = max(widths(180)), w300 = max(widths(300));
  return { ok: w52 > w180 * 1.5 && w180 === w300, detail: JSON.stringify({ w52, w180, w300 }) };
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let r;
    try { r = await T[name](); } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + (r.ok ? '' : '\n     ' + r.detail));
  }
  console.log('\n' + pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
