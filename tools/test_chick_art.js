/* 塗鴉小雞第五版(js/chick-art.js)的回歸測試:舊的 8 個姿勢一筆都不能變,新姿勢照小雞第二階段規格第 2 節、附錄 B。
   用法:node tools/test_chick_art.js
   - 第一部分在 Node 裡跑,用假的 canvas 記下每一個繪圖呼叫(含每個數字的完整值),跟第四版
     (tools/fixtures/chick_art_v4.js,27557eb 那一版的原樣)逐呼叫比對。呼叫序列一樣,畫出來的像素就一樣。
   - 第二部分用本機的 Chrome 或 Edge(無頭模式)真的畫出來,逐像素比對 4 種大小 × 舊姿勢每一格 × 2 種抖動,共 512 張。
     找不到 Chrome 時這部分略過,第一部分照樣要全過。除錯埠用 8900 到 8919 裡沒人用的那一個。 */
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const V4_SRC = read('tools/fixtures/chick_art_v4.js');
const V5_SRC = read('js/chick-art.js');
const OLD = ['idle', 'happy', 'eat', 'hungry', 'demand', 'sleep', 'walk', 'run'];
const NEW = ['takeoff', 'fly', 'land', 'nope', 'flop'];
const SIZES = [48, 96, 160, 200];
const W = 240, H = 280;

/* ---------- 假的 canvas:記下每一個呼叫和屬性設定 ---------- */
const digest = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const fmt = (v) => (v && typeof v === 'object' && Array.isArray(v.log) ? 'img:' + digest(v.log.join('\n')) : String(v));
function makeCanvas() {
  const log = [];
  const c = { width: 300, height: 150, style: {}, log, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } };
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

/* 一個獨立的假頁面:自己的計時器、自己的 ChickArt */
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
  return {
    g, timers,
    load(src, name) { vm.runInContext(src, g, { filename: name }); return g; },
    intervals: () => [...timers.values()].filter((t) => !t.once),
  };
}
const loadArt = (src, opt) => makeEnv(opt).load(src, 'chick-art.js').ChickArt;
const V4 = loadArt(V4_SRC), V5 = loadArt(V5_SRC);

function frameLog(A, pose, k, variant, size) {
  const c = makeCanvas();
  A.drawFrame(c.getContext('2d'), pose, k, { variant, size });
  return c.log.join('\n');
}
/* 某個大小、某個 dpr 下,烤好的每一格(含開頭那一下 scale)的指紋 → [格, 抖動組] */
function bakedMap(A, pose, size, dpr) {
  const px = size / W * dpr, m = new Map();
  for (let k = 0; k < A.frameCount(pose); k++) for (const v of [0, 1]) {
    m.set('img:' + digest(['scale(' + px + ',' + px + ')', frameLog(A, pose, k, v, size)].join('\n')), [k, v]);
  }
  return m;
}
const painted = (canvas) => canvas.log.filter((l) => l.startsWith('drawImage(')).map((l) => l.slice(10).split(',')[0]);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* 開一個動畫,跑 n 拍(第一拍是 animate 當下畫的),回傳主畫布的記錄、onTick 的內容、計時器間隔 */
function run200(src, pose, size, extra, n) {
  const env = makeEnv({ dpr: 2 });
  const A = env.load(src, 'chick-art.js').ChickArt;
  const canvas = makeCanvas(), ticks = [];
  const a = A.animate(canvas, Object.assign({ size, fps: 8, maxDpr: 2, pose, onTick: (t) => ticks.push(JSON.stringify(t)) }, extra));
  const iv = env.intervals();
  for (let i = 1; i < (n || 200); i++) iv[0].fn();
  return { A, a, env, canvas, ticks, ms: iv.map((t) => t.ms), log: canvas.log.join('\n') };
}

const T = {};

/* ---------- 舊姿勢:一筆都不能變 ---------- */
T['舊的 8 個姿勢:每一格、兩種抖動、48/96/160/200 px 的繪圖呼叫跟第四版完全相同(512 張)'] = () => {
  let n = 0;
  const bad = [];
  for (const size of SIZES) for (const pose of OLD) for (let k = 0; k < V4.frameCount(pose); k++) for (const v of [0, 1]) {
    n++;
    const a = frameLog(V4, pose, k, v, size), b = frameLog(V5, pose, k, v, size);
    if (a !== b || a.length < 1000) bad.push(size + ' ' + pose + ' ' + k + '/' + v);
  }
  return { ok: n === 512 && !bad.length, detail: n + ' 張,不同 ' + bad.length + ':' + bad.slice(0, 8).join('、') };
};
T['舊姿勢的順序、格數、holds、travel、fps、metrics 跟第四版相同'] = () => {
  const d = [];
  if (!eq(V4.poses, OLD) || !eq(V5.poses.slice(0, 8), OLD)) d.push('poses ' + JSON.stringify(V5.poses));
  OLD.forEach((p) => {
    if (V4.frameCount(p) !== V5.frameCount(p)) d.push('frameCount ' + p);
    if (!eq(V4.holds(p), V5.holds(p))) d.push('holds ' + p);
    if (V4.fps[p] !== V5.fps[p]) d.push('fps ' + p + ' ' + V4.fps[p] + '→' + V5.fps[p]);
    if ((V4.travel[p] || 0) !== (V5.travel[p] || 0)) d.push('travel ' + p);
  });
  if (!eq(V4.metrics, V5.metrics) || !eq(V5.metrics, { width: 240, height: 280, ground: 254 })) d.push('metrics ' + JSON.stringify(V5.metrics));
  if (!eq(V5.travel, { walk: 10, run: 20, fly: 0 })) d.push('travel ' + JSON.stringify(V5.travel));
  return { ok: !d.length, detail: d.join(';') };
};
T['靜止格:舊姿勢只有 eat 從 0 改成 3(規格 3.6),其他跟第四版相同'] = () => {
  const want = { idle: 1, happy: 0, eat: 3, hungry: 0, demand: 1, sleep: 0, walk: 0, run: 1, takeoff: 0, fly: 0, land: 3, nope: 5, flop: 3 };
  const same = OLD.filter((p) => p !== 'eat').every((p) => V4.calm[p] === V5.calm[p]);
  return { ok: same && V4.calm.eat === 0 && eq(V5.calm, want), detail: JSON.stringify(V5.calm) };
};
for (const size of [48, 160]) {
  T['animate 前 200 拍:舊姿勢每一拍畫的格與抖動組、onTick、播放速度跟第四版相同(' + size + ' px)'] = () => {
    const d = [];
    OLD.forEach((pose) => {
      const a = run200(V4_SRC, pose, size), b = run200(V5_SRC, pose, size);
      if (a.log !== b.log) d.push(pose + ' 畫的格不同');
      if (!eq(a.ticks, b.ticks)) d.push(pose + ' onTick 不同');
      if (!eq(a.ms, b.ms)) d.push(pose + ' 間隔 ' + a.ms + '→' + b.ms);
      const map = bakedMap(b.A, pose, size, 2), kv = painted(b.canvas).map((x) => map.get(x));
      if (kv.length !== 200 || kv.some((x) => !x)) d.push(pose + ' 畫了認不得的格');
    });
    return { ok: !d.length, detail: d.join(';') };
  };
}
T['animate 換姿勢、換速度、停下:舊姿勢的播放跟第四版相同'] = () => {
  const go = (src) => {
    const env = makeEnv({ dpr: 2 });
    const A = env.load(src, 'chick-art.js').ChickArt, canvas = makeCanvas(), ticks = [];
    const a = A.animate(canvas, { size: 96, fps: 8, maxDpr: 2, pose: 'idle', onTick: (t) => ticks.push(JSON.stringify(t)) });
    const step = (n) => { for (let i = 0; i < n; i++) env.intervals()[0].fn(); };
    step(30); a.setPose('eat'); step(25); a.setFps(6); step(10); a.setPose('walk'); step(40); a.setPose('nope-not-a-pose'); step(5);
    a.setPose('happy'); step(20); a.stop();
    return { log: canvas.log.join('\n'), ticks, left: env.intervals().length, pose: a.pose, fps: a.fps };
  };
  const a = go(V4_SRC), b = go(V5_SRC);
  return { ok: a.log === b.log && eq(a.ticks, b.ticks) && a.left === 0 && b.left === 0 && a.pose === b.pose && a.fps === b.fps,
    detail: JSON.stringify({ sameLog: a.log === b.log, sameTicks: eq(a.ticks, b.ticks), left: [a.left, b.left], pose: [a.pose, b.pose], fps: [a.fps, b.fps] }) };
};

/* ---------- 重入:onTick 裡呼叫 setPose(pet-roam2 走到邊緣那一拍就換姿勢) ---------- */
/* 走路第一拍就換回 idle(還可以再換一次 run),回傳計時器數與畫的格 */
function reenter(src, depth) {
  const env = makeEnv({ dpr: 2 });
  const A = env.load(src, 'chick-art.js').ChickArt, canvas = makeCanvas(), ticks = [];
  let a = null, left = depth;
  a = A.animate(canvas, { size: 48, fps: 8, maxDpr: 2, pose: 'idle', onTick: (t) => {
    ticks.push(t.pose + t.frame + '/' + t.tick);
    if (a && t.pose !== 'idle' && t.tick === 0 && left-- > 0) a.setPose(left % 2 ? 'run' : 'idle');
  } });
  a.setPose('walk');
  const live = env.intervals().length;
  const log = canvas.log.join('\n');
  for (let i = 0; i < 3; i++) env.intervals().forEach((t) => t.fn());
  const after3 = canvas.log.length;
  a.stop();
  return { live, left: env.intervals().length, log, ticks: ticks.slice(), pose: a.pose, after3 };
}
T['重入:onTick 裡呼叫 setPose 只留一個計時器,stop() 之後一個都不剩;畫的格跟第四版相同'] = () => {
  const d = [];
  for (const depth of [1, 2]) {
    const a = reenter(V5_SRC, depth), b = reenter(V4_SRC, depth);
    if (a.live !== 1) d.push('深度 ' + depth + ':setPose 後有 ' + a.live + ' 個計時器');
    if (a.left !== 0) d.push('深度 ' + depth + ':stop() 後還有 ' + a.left + ' 個');
    if (a.log !== b.log) d.push('深度 ' + depth + ':換姿勢當下畫的格跟第四版不同');
    if (a.pose !== b.pose) d.push('深度 ' + depth + ':姿勢 ' + a.pose + ' / ' + b.pose);
  }
  return { ok: !d.length, detail: d.join(';') };
};
T['重入之後每拍只畫一次(不會兩倍速)'] = () => {
  const r = reenter(V5_SRC, 1);
  const env = makeEnv({ dpr: 2 });
  const A = env.load(V5_SRC, 'chick-art.js').ChickArt, canvas = makeCanvas();
  const a = A.animate(canvas, { size: 48, fps: 8, maxDpr: 2, pose: 'idle' });
  a.setPose('idle');
  const before = canvas.log.length;
  for (let i = 0; i < 3; i++) env.intervals().forEach((t) => t.fn());
  const perTick = (canvas.log.length - before) / 3;
  const rPer = (r.after3 - r.log.split('\n').length) / 3;
  return { ok: rPer === perTick, detail: '重入後每拍 ' + rPer + ' 筆,一般每拍 ' + perTick + ' 筆' };
};

/* ---------- 新姿勢 ---------- */
T['新姿勢接在最後:順序、格數、速度、version'] = () => {
  const counts = NEW.map((p) => V5.frameCount(p));
  const fps = NEW.map((p) => V5.fps[p]);
  return { ok: eq(V5.poses, OLD.concat(NEW)) && eq(counts, [3, 8, 4, 6, 4]) && eq(fps, [8, 12, 8, 8, 8]) && V5.version === 5,
    detail: JSON.stringify({ poses: V5.poses, counts, fps, version: V5.version }) };
};
T['新姿勢在 4 種大小、兩種抖動都畫得出來,兩種抖動不一樣'] = () => {
  const d = NEW.filter((p) => !V5.frameCount(p)).map((p) => p + ' 沒有這個姿勢');
  for (const size of SIZES) for (const pose of NEW) for (let k = 0; k < V5.frameCount(pose); k++) {
    try {
      const a = frameLog(V5, pose, k, 0, size), b = frameLog(V5, pose, k, 1, size);
      if (a.length < 1000 || a === b) d.push(size + ' ' + pose + ' ' + k);
    } catch (e) { d.push(size + ' ' + pose + ' ' + k + ' 例外 ' + e.message); }
  }
  return { ok: !d.length, detail: d.slice(0, 8).join('、') };
};
T['flyPlan:1 到 6 格一圈、1 到 6 格加第 7 格停 2 拍加第 8 格一圈;淨升 40 和 45;flyRise 8 格'] = () => {
  const plan = V5.flyPlan || [];
  const ks = plan.map((p) => p[0]), vs = plan.map((p) => p[1]), dy = plan.map((p) => p[2]);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const okShape = plan.every((p) => Array.isArray(p) && p.length === 3 && Number.isFinite(p[2]) && (p[1] === 0 || p[1] === 1));
  const okK = eq(ks, [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 6, 6, 7]);
  const okRise = sum(dy.slice(0, 6)) === -40 && sum(dy.slice(6)) === -45;
  /* animate 播 fly 照這個順序;改到匯出的那份不影響引擎自己的 */
  const r = run200(V5_SRC, 'fly', 96, {}, 30);
  const frames = r.ticks.map((t) => JSON.parse(t).frame);
  if (r.A.flyPlan.length) r.A.flyPlan[0][0] = 7;
  r.A.flyPlan.length = 0;
  r.ticks.length = 0;
  r.a.setPose('fly');
  for (let i = 1; i < 15; i++) r.env.intervals()[0].fn();
  const again = r.ticks.map((t) => JSON.parse(t).frame);
  r.a.stop();
  const okPlay = eq(frames, ks.concat(ks).slice(0, 30)) && eq(again, ks) && r.ms[0] === 1000 / 12;
  return { ok: okShape && okK && okRise && Array.isArray(V5.flyRise) && V5.flyRise.length === 8 && okPlay,
    detail: JSON.stringify({ ks, vs, dy, flyRise: V5.flyRise, frames, ms: r.ms }) };
};
T['seedIndex:fly 第 k 格用 floor(k/2),其他姿勢用 k'] = () => {
  if (typeof V5.seedIndex !== 'function') return { ok: false, detail: '沒有 seedIndex' };
  const fly = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => V5.seedIndex('fly', k));
  const others = OLD.concat(['takeoff', 'land', 'nope', 'flop']).every((p) => [0, 1, 2, 3, 4].every((k) => V5.seedIndex(p, k) === k));
  return { ok: eq(fly, [0, 0, 1, 1, 2, 2, 3, 3]) && others, detail: JSON.stringify(fly) };
};

/* ---------- variants、show ---------- */
T['animate 的 variants: 1:前 200 拍只畫抖動組 0,格的順序不變;預設兩種都用'] = () => {
  const d = [];
  ['idle', 'eat', 'walk', 'happy'].forEach((pose) => {
    const two = run200(V5_SRC, pose, 160), one = run200(V5_SRC, pose, 160, { variants: 1 });
    const map = bakedMap(one.A, pose, 160, 2);
    const kv2 = painted(two.canvas).map((x) => map.get(x)), kv1 = painted(one.canvas).map((x) => map.get(x));
    if (kv1.some((x) => !x || x[1] !== 0)) d.push(pose + ' 畫了抖動組 1');
    if (!kv2.some((x) => x && x[1] === 1)) d.push(pose + ' 預設沒有用到抖動組 1');
    if (!eq(kv1.map((x) => x && x[0]), kv2.map((x) => x && x[0]))) d.push(pose + ' 格的順序變了');
    if (!eq(one.ticks, two.ticks)) d.push(pose + ' onTick 變了');
  });
  return { ok: !d.length, detail: d.join(';') };
};
T['show(k, variant, pose):停掉計時器,只畫指定的那一格;fly 用自己的線條種子;variants 1 時一律抖動組 0'] = () => {
  const d = [];
  const r = run200(V5_SRC, 'idle', 96, {}, 5);
  if (typeof r.a.show !== 'function') return { ok: false, detail: '沒有 show()' };
  const last = () => painted(r.canvas).slice(-1)[0];
  r.a.show(3, 1);
  if (r.env.intervals().length) d.push('show 之後還有計時器');
  if (!eq(bakedMap(r.A, 'idle', 96, 2).get(last()), [3, 1])) d.push('idle 第 3 格抖動組 1 沒畫對');
  const flyMap = bakedMap(r.A, 'fly', 96, 2);
  [[0, 0], [1, 0], [6, 1], [7, 1], [9, 0], [-1, 1]].forEach(([k, v]) => {
    r.a.show(k, v, 'fly');
    const want = [((k % 8) + 8) % 8, v];
    if (!eq(flyMap.get(last()), want)) d.push('fly ' + k + '/' + v + ' 畫成 ' + JSON.stringify(flyMap.get(last())));
  });
  if (r.a.pose !== 'fly' || r.env.intervals().length) d.push('show 換姿勢後 pose ' + r.a.pose + ' 計時器 ' + r.env.intervals().length);
  r.a.setPose('idle');
  if (r.env.intervals().length !== 1) d.push('setPose 沒有重新開始播');
  r.a.stop();
  const one = run200(V5_SRC, 'idle', 96, { variants: 1 }, 3);
  one.a.show(2, 1, 'fly');
  if (!eq(bakedMap(one.A, 'fly', 96, 2).get(painted(one.canvas).slice(-1)[0]), [2, 0])) d.push('variants 1 的 show 畫了抖動組 1');
  return { ok: !d.length, detail: d.join(';') };
};

/* ---------- 減少動態 ---------- */
T['減少動態:animate 和 show 只畫靜止格、不開計時器'] = () => {
  const env = makeEnv({ dpr: 2, reduce: true });
  const A = env.load(V5_SRC, 'chick-art.js').ChickArt, canvas = makeCanvas();
  const a = A.animate(canvas, { size: 96, fps: 8, maxDpr: 2, pose: 'eat' });
  const d = [];
  if (env.intervals().length) d.push('開了計時器');
  if (!eq(bakedMap(A, 'eat', 96, 2).get(painted(canvas).slice(-1)[0]), [3, 0])) d.push('eat 不是第 4 格');
  if (typeof a.show === 'function') {
    a.show(5, 1, 'fly');
    if (!eq(bakedMap(A, 'fly', 96, 2).get(painted(canvas).slice(-1)[0]), [0, 0])) d.push('fly 沒畫靜止格');
  } else d.push('沒有 show()');
  return { ok: !d.length && a.reducedMotion === true, detail: d.join(';') };
};
T['開關關著時看不到 eat 靜止格的改變:減少動態時 pet-ui 的 play() 不播 eat,畫的只有心情與走路跑步的靜止格(跟第四版相同)'] = () => {
  const env = makeEnv({ dpr: 2, reduce: true });
  const g = env.load(V5_SRC, 'chick-art.js');
  const status = { today: '2026-10-17', name: '小黃', streak: 3, shields: 0, practicedDays: 3, todayCount: 0, goal: 20, nextGoal: 20,
    metToday: false, food: 0, sleeping: false, hungry: true, totalMet: 1 };
  const doc = Object.assign(g.document, { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, getElementById: () => null,
    querySelector: () => null, body: { append() {} } });
  Object.assign(g, {
    document: doc, addEventListener() {}, removeEventListener() {}, h: () => makeCanvas(), PET: {},
    PET_STORE: { on: true, view: () => ({ on: true, readOnly: false, reason: '', status, pet: { v: 1 } }) },
    MutationObserver: class { observe() {} },
  });
  const poses = [];
  const real = g.ChickArt.animate;
  g.ChickArt = Object.assign({}, g.ChickArt, { animate: (c, o) => { poses.push(o.pose); const a = real(c, o); const sp = a.setPose; a.setPose = (p) => { poses.push(p); sp(p); }; return a; } });
  env.load(read('js/pet-ui.js'), 'pet-ui.js');
  if (!g.PET_UI || typeof g.PET_UI.chick !== 'function') return { ok: false, detail: 'PET_UI.chick 不在' };
  const canvas = makeCanvas();
  const c = g.PET_UI.chick(canvas, 96);
  c.play(['eat', 'happy']);
  ['hungry', 'sleep', 'walk', 'run', 'idle'].forEach((p) => { c.setBase(p); c.play(['eat', 'happy']); });
  const A = g.ChickArt, eatMap = bakedMap(A, 'eat', 96, 2);
  const shown = painted(canvas);
  const ateShown = shown.filter((x) => eatMap.has(x)).length;
  const calmOk = ['idle', 'hungry', 'sleep', 'walk', 'run'].every((p) => frameLog(V4, p, V4.calm[p], 0, 96) === frameLog(V5, p, V5.calm[p], 0, 96));
  const known = new Map();
  ['idle', 'hungry', 'sleep', 'walk', 'run'].forEach((p) => bakedMap(A, p, 96, 2).forEach((kv, key) => { if (kv[0] === A.calm[p] && kv[1] === 0) known.set(key, p); }));
  const allCalm = shown.length > 0 && shown.every((x) => known.has(x));
  return { ok: ateShown === 0 && !poses.includes('eat') && calmOk && allCalm,
    detail: JSON.stringify({ poses, shown: shown.map((x) => known.get(x) || x), ateShown, calmOk }) };
};
T['pet-roam.js 只透過 play() 播 eat(減少動態時 play 不播)'] = () => {
  const lines = read('js/pet-roam.js').split(/\r?\n/).filter((l) => /['"]eat['"]/.test(l));
  return { ok: lines.every((l) => /\.play\(\[/.test(l)), detail: lines.join(' | ') };
};

/* ---------- 第二部分:無頭 Chrome 逐像素 ---------- */
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
function portFree(p) {
  return new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(p, '127.0.0.1', () => s.close(() => res(true))); });
}
async function withChrome(fn) {
  let port = 0;
  for (let p = 8900; p <= 8919 && !port; p++) if (await portFree(p)) port = p;
  if (!port) throw new Error('8900 到 8919 都有人用');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-chick-art-'));
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
const PIXELS = `(() => {
  const shot = (A, pose, k, variant, size) => {
    const px = size / 240, c = document.createElement('canvas');
    c.width = Math.round(240 * px); c.height = Math.round(280 * px);
    const x = c.getContext('2d'); x.scale(px, px);
    A.drawFrame(x, pose, k, { variant, size });
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  const inked = (d) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; };
  const out = { total: 0, same: 0, diffs: [], blank: [], fresh: 0, freshBad: [] };
  for (const size of ${JSON.stringify(SIZES)}) {
    for (const pose of V4.poses) for (let k = 0; k < V4.frameCount(pose); k++) for (const v of [0, 1]) {
      const a = shot(V4, pose, k, v, size), b = shot(V5, pose, k, v, size);
      out.total++;
      let same = a.length === b.length;
      for (let i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false;
      if (same) out.same++; else out.diffs.push(size + ' ' + pose + ' ' + k + '/' + v);
      if (inked(b) < 100) out.blank.push(size + ' ' + pose + ' ' + k);
    }
    for (const pose of ${JSON.stringify(NEW)}) for (let k = 0; k < V5.frameCount(pose); k++) for (const v of [0, 1]) {
      out.fresh++;
      try { if (inked(shot(V5, pose, k, v, size)) < 100) out.freshBad.push(size + ' ' + pose + ' ' + k + ' 空白'); }
      catch (e) { out.freshBad.push(size + ' ' + pose + ' ' + k + ' ' + e.message); }
    }
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
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + (r.ok ? '' : '\n     ' + r.detail));
  }
  const px = '無頭 Chrome 逐像素:舊姿勢 512 張跟第四版相同,新姿勢 4 種大小都畫得出來';
  if (!CHROME) {
    skipped++;
    console.log('SKIP ' + px + '(找不到 Chrome 或 Edge,只靠第一部分的繪圖呼叫比對)');
  } else {
    let r;
    try {
      const o = await withChrome(async (ev) => {
        await ev('(() => {' + V4_SRC + '\n;window.V4 = window.ChickArt;' + V5_SRC + '\n;window.V5 = window.ChickArt; return true; })()');
        return ev(PIXELS);
      });
      r = { ok: o.total === 512 && o.same === 512 && !o.blank.length && o.fresh > 0 && !o.freshBad.length,
        detail: JSON.stringify({ total: o.total, same: o.same, diffs: o.diffs.slice(0, 8), blank: o.blank.slice(0, 8), fresh: o.fresh, freshBad: o.freshBad.slice(0, 8) }) };
    } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.message) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + px + (r.ok ? '' : '\n     ' + r.detail));
  }
  const total = names.length + (CHROME ? 1 : 0);
  console.log('\n' + pass + ' / ' + total + ' 通過' + (skipped ? '(略過 ' + skipped + ')' : ''));
  setTimeout(() => process.exit(pass === total ? 0 : 1), 300);
})();
