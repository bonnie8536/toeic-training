/* 估分核心(js/estimate-core.js、js/estimate-data.js)的純函式測試:
   作答機率與資訊量、網格後驗平均(EAP)、換算曲線與反查、預估與範圍、兩端顯示、四級與各級機率、題目 key、
   第一次作答紀錄的編碼與合併、檢測紀錄合併、預估快照合併、舊資料補回、選題(種子、排除、跳格)、顯示門檻、衰減、顯示平滑。
   手算值另外用一般的公式逐步算過(寫在各測試的註解);不開瀏覽器、不連網。用法:node tools/test_estimate.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FILES = ['js/estimate-core.js', 'js/estimate-data.js'];
function load(extra) {
  const ctx = Object.assign({ console: { log() {}, warn() {}, error() {}, info() {} } }, extra || {});
  ctx.window = ctx;
  vm.createContext(ctx);
  FILES.forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  return ctx;
}
const X = load().ESTIMATE;
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, (m || '') + ' 得到 ' + a + ',應為 ' + b + ' ± ' + tol);
/* 載入的檔在另一個 vm 環境,錯誤物件不是這邊的 Error,只看有沒有訊息 */
const throws = (fn, re, m) => assert.throws(fn, (e) => !!e && typeof e.message === 'string' && (!re || re.test(e.message)), m);

/* 測試用的小型參數:曲線照兩科換算點,參考卷每個 Part 只放 3 個難度,題目難度只放測試要用的題 */
const CURVE_L = [[0, 5], [.15, 55], [.25, 85], [.30, 110], [.35, 140], [.40, 170], [.45, 200], [.50, 230], [.55, 260], [.60, 290], [.65, 320], [.70, 350], [.75, 380], [.80, 410], [.86, 440], [.92, 470], [.97, 495]];
const CURVE_R = [[0, 5], [.15, 30], [.20, 38], [.25, 69], [.30, 105], [.35, 134], [.40, 163], [.45, 191], [.50, 220], [.55, 247], [.60, 273], [.65, 300], [.70, 331], [.75, 362], [.80, 393], [.86, 426], [.90, 448], [.92, 460], [.97, 490], [1, 495]];
const PARAMS = {
  ip: 'ip-test', cv: 'c-test',
  curve: { L: CURVE_L, R: CURVE_R },
  ref: { 1: [-1.3, -0.3, 0.7], 2: [-1, 0, 1], 3: [-0.7, 0.3, 1.3], 4: [-0.7, 0.3, 1.3], 5: [-1, 0, 1], 6: [-0.8, 0.2, 1.2], '7s': [-0.5, 0.5, 1.5], '7m': [-0.2, 0.8, 1.8] },
  b: {
    'p5-a': -1, 'p5-b': 0, 'p5-c': 1, 'p5-d': 0.5, 'p5-e': -0.5, 'p5-f': 1.5, 'p5-g': 2, 'p5-h': -2, 'p5-i': 0.2, 'p5-j': -0.2,
    'p6-x:1': 0.2, 'p6-x:2': 0.7, 'p6-x:3': 0, 'p6-x:4': 0.4, 'p7-y:0': 1, 'p7-y:1': 0.3, 'p7-y:2': 0.5, 'p7-y:3': 0.9,
    'l1-a': -0.3, 'l1-b': 0.5, 'l2-a': 0, 'l2-b': -1, 'l2-c': 1, 'l2-d': 0.3, 'l2-e': -0.4, 'l2-f': 0.8,
    'l3-z:0': 0.3, 'l3-z:1': 0.8, 'l3-z:2': -0.2, 'l4-w:0': 0.1, 'l4-w:1': 0.6, 'l4-w:2': 1.1,
    'd5-01': -1, 'd5-02': 0, 'd6:1': 0.2, 'd7:1': 0.5,
  },
};
const ev = (b, c, x, w) => ({ b, c, x, w });
/* 閱讀 10 筆:單題 6 筆權重 1、題組 4 筆權重 0.75 */
const EV_R = [ev(-1, .25, 1, 1), ev(0, .25, 1, 1), ev(1, .25, 0, 1), ev(.5, .25, 1, 1), ev(-.5, .25, 1, 1),
  ev(.2, .25, 1, .75), ev(.7, .25, 0, .75), ev(1, .25, 0, .75), ev(.3, .25, 1, .75), ev(1.5, .25, 0, 1)];
const EV_L = [ev(-.3, .25, 1, 1), ev(0, 1 / 3, 1, 1), ev(-1, 1 / 3, 0, 1), ev(1, 1 / 3, 1, 1), ev(.3, .25, 1, .75), ev(.8, .25, 0, .75), ev(-.2, .25, 1, .75)];
const sumOf = (sec, evid, f) => X.summarize(PARAMS, sec, X.logPost(X.prior(PARAMS, sec), evid), f || 0);

/* 測試用亂數(固定種子) */
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const T = {};

/* ---------- 作答機率與資訊量 ---------- */
/* 手算:能力 0、難度 0、四選一:0.25 + 0.75 × 0.5 = 0.625;資訊量 (0.5)² × 0.375 ÷ 0.625 = 0.15。
   能力 1、難度 0、三選一:σ(1) = 0.7310586,p = 1/3 + 2/3 × 0.7310586 = 0.8207057;
   資訊量 0.7310586² × 0.1792943 ÷ 0.8207057 = 0.1167571。
   最有資訊的位置 b = θ − δ,δ = ln((1 + √(1 + 8c)) ÷ 2):c = 0.25 → ln(1.3660254) = 0.3119;c = 1/3 → ln(1.4574271) = 0.3767 */
T['作答機率、資訊量、最有資訊的位置對手算值'] = () => {
  near(X.prob(0, 0, .25), 0.625, 1e-12);
  near(X.info(0, 0, .25), 0.15, 1e-12);
  near(X.prob(1, 0, 1 / 3), 0.8207057190866700, 1e-12);
  near(X.info(1, 0, 1 / 3), 0.1167571088430023, 1e-12);
  near(X.delta(.25), 0.312, 5e-4, 'δ(0.25)');
  near(X.delta(1 / 3), 0.377, 5e-4, 'δ(1/3)');
  [.25, 1 / 3].forEach((c) => {
    let best = 0, bi = 0;
    for (let b = -2; b <= 2; b += 0.001) { const v = X.info(0, b, c); if (v > best) { best = v; bi = b; } }
    near(bi, -X.delta(c), 2e-3, '資訊量最大處 c=' + c);
  });
  eq([X.cOf('2'), X.cOf(2), X.cOf('1'), X.cOf('5'), X.cOf('7s'), X.cOf('7')], [1 / 3, 1 / 3, .25, .25, .25, .25]);
  throws(() => X.prob(NaN, 0, .25), /能力/);
  throws(() => X.prob(0, 0, 1), /猜/);
  throws(() => X.cOf('8'), /Part/);
};

/* ---------- 曲線與反查 ---------- */
/* 手算:聽力 0.62 落在 (0.60, 290)–(0.65, 320),290 + 30 × 0.4 = 302;閱讀 (0.60, 273)–(0.65, 300),273 + 27 × 0.4 = 283.8;
   閱讀 0.985 落在 (0.97, 490)–(1, 495),490 + 5 × 0.5 = 492.5;聽力 0.97 以上一律 495 */
T['曲線:兩條都單調、兩端 5 與 495、直線內插、反查來回在一格內'] = () => {
  ['L', 'R'].forEach((sec) => {
    const pts = PARAMS.curve[sec];
    for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] > pts[i - 1][0] && pts[i][1] >= pts[i - 1][1], sec + ' 單調');
    eq([X.scoreOf(pts, 0), X.scoreOf(pts, 1)], [5, 495], sec + ' 兩端');
    const S = X.scoreGrid(PARAMS, sec);
    for (let g = 1; g < S.length; g++) assert.ok(S[g] >= S[g - 1], sec + ' 每格分數不遞減');
    for (let s = 30; s <= 470; s += 5) {
      if (s < S[0] || s > S[S.length - 1]) continue;
      const th = X.thetaOfScore(PARAMS, sec, s), g = Math.round((th + 4) / 0.05);
      const step = Math.max(Math.abs(S[g] - S[Math.max(0, g - 1)]), Math.abs(S[Math.min(160, g + 1)] - S[g]));
      assert.ok(Math.abs(S[g] - s) <= step, sec + ' 反查 ' + s + ' 得到 ' + S[g]);
    }
  });
  near(X.scoreOf(CURVE_L, .62), 302, 1e-9);
  near(X.scoreOf(CURVE_R, .62), 283.8, 1e-9);
  near(X.scoreOf(CURVE_R, .985), 492.5, 1e-9);
  eq([X.scoreOf(CURVE_L, .97), X.scoreOf(CURVE_L, .99)], [495, 495]);
  throws(() => X.checkCurve([[0, 5], [.5, 300], [.4, 200], [1, 495]]), /曲線/);
  throws(() => X.checkCurve([[0, 5], [.5, 300], [.6, 250], [1, 495]]), /曲線/);
  throws(() => X.checkCurve([[.1, 5], [1, 495]]), /曲線/);
  throws(() => X.scoreOf(CURVE_L, NaN), /答對率/);
};

/* 手算:能力 0 時閱讀的參考卷預期答對率 = Σ(Part 題數 ÷ 100 × 該 Part 三個難度的平均答對機率)= 0.5656974,
   套閱讀曲線 (0.55, 247)–(0.60, 273):247 + 26 × 0.313948 = 255.1626;聽力 0.6051625 → 290 + 30 × 0.10325 = 293.0975 */
T['參考卷預期答對率與每格分數;模擬考的換算用同一個函式'] = () => {
  near(X.expected(PARAMS, 'R', 0), 0.56569738980644, 1e-9);
  near(X.expected(PARAMS, 'L', 0), 0.6051625345561136, 1e-9);
  near(X.scoreGrid(PARAMS, 'R')[80], 255.1626426993488, 1e-6);
  near(X.scoreGrid(PARAMS, 'L')[80], 293.09752073366815, 1e-6);
  const S = X.scoreGrid(PARAMS, 'R');
  X.GRID.forEach((t, g) => near(S[g], X.scoreOf(CURVE_R, X.expected(PARAMS, 'R', t)), 1e-9, '第 ' + g + ' 格'));
  /* 題庫的難度表只影響選題與作答,參考卷才決定換算 */
  const more = Object.assign({}, PARAMS, { b: Object.assign({}, PARAMS.b, { 'p5-new': 3 }) });
  near(X.expected(more, 'R', 0.7), X.expected(PARAMS, 'R', 0.7), 0);
  const mock = path.join(ROOT, 'js/mock.js');
  const wired = fs.existsSync(mock) && /ESTIMATE\.scoreOf/.test(fs.readFileSync(mock, 'utf8'));
  return wired ? 'js/mock.js 已改用 ESTIMATE.scoreOf' : 'js/mock.js 還沒接上 ESTIMATE.scoreOf(由改模擬考的那一步處理)';
};

/* ---------- 先驗 ---------- */
/* 手算(另外逐格算過):閱讀預設起點 265 分,最近的格是 θ = 0.10(第 82 格,263.27 分);聽力 315 → θ = 0.25(第 85 格,316.40 分)。
   自填聽力 400、12 個月前:最近格 θ = 1.20(第 104 格),斜率 (S[105] − S[103]) ÷ 0.1 = 80.05 分/logit,
   分數誤差 √(35² + (15 × 2)²) = 46.10,換成 logit 46.10 ÷ 80.05 = 0.5759。
   自填總分拆出的閱讀 300、3 個月前:θ = 0.55(第 91 格),斜率 93.39,誤差 √(50² + (15 × 0.5)²) = 50.56 → 0.5414 */
T['先驗:沒有成績用平均分數反查、寬 2.0;自填成績照斜率換寬度、上限 2.0;太舊不用'] = () => {
  const r = X.prior(PARAMS, 'R'), l = X.prior(PARAMS, 'L');
  near(r.mu, 0.1, 1e-9); near(l.mu, 0.25, 1e-9); eq([r.sd, l.sd], [2, 2]);
  const s1 = X.prior(PARAMS, 'L', { score: 400, months: 12 });
  near(s1.mu, 1.2, 1e-9); near(s1.sd, 0.5758716045780299, 1e-9);
  const s2 = X.prior(PARAMS, 'R', { score: 300, months: 3, fromTotal: true });
  near(s2.mu, 0.55, 1e-9); near(s2.sd, 0.5413618483169937, 1e-9);
  eq(X.prior(PARAMS, 'L', { score: 400, months: 25 }), l, '超過 24 個月');
  eq(X.prior(PARAMS, 'L', { score: 400, months: NaN }), l, '月份不明');
  eq(X.prior(PARAMS, 'L', { score: 495, months: 0 }).sd <= 2, true, '曲線平的地方上限 2.0');
  throws(() => X.prior(PARAMS, 'L', { score: 401, months: 1 }), /分數/);
};

/* ---------- EAP ---------- */
/* 回歸基準(另外用一支獨立程式逐格算過):先驗 N(0.10, 2.0²)+ EV_R 十筆 → θ̂ = 0.3195616,分數平均 285.636 → 預估 285;
   隨機誤差 72.051、系統誤差 √(35² + 15²) = 38.079,√(72.051² + 38.079²) = 81.50 → 半寬 80,範圍 205–365;
   各級機率(每格用原始分數對級)0.0601、0.3487、0.4450、0.1462。聽力 EV_L 七筆 → 310,半寬 100(91.48 與 38.08)。沒有作答 → 270,半寬 125 */
T['網格後驗平均:固定輸入的 θ̂、預估、範圍、各級機率(回歸基準)'] = () => {
  const a = sumOf('R', EV_R);
  near(a.theta, 0.3195616095271085, 1e-9); near(a.mean, 285.63629417686354, 1e-6); near(a.srand, 72.05135035587661, 1e-6);
  eq([a.est, a.h, a.lo, a.hi], [285, 80, 205, 365]);
  [0.06005990749297138, 0.34874415122984986, 0.44498108223035326, 0.1462148590468262].forEach((p, k) => near(a.pb[k], p, 1e-9, '第 ' + k + ' 級'));
  const b = sumOf('L', EV_L);
  near(b.theta, 0.17232493140078803, 1e-9); eq([b.est, b.h, b.lo, b.hi], [310, 100, 210, 410]);
  const z = sumOf('R', []);
  near(z.theta, 0.07781243492615503, 1e-9); eq([z.est, z.h, z.lo, z.hi], [270, 125, 145, 395]);
  eq(a.band, 'advanced'); eq(b.band, 'threshold');
};

T['數值:全對、全錯、上千筆、權重 0 都有合理輸出,不會 NaN'] = () => {
  const right = sumOf('R', Array.from({ length: 30 }, () => ev(0, .25, 1, 1)));
  const wrong = sumOf('R', Array.from({ length: 30 }, () => ev(0, .25, 0, 1)));
  eq([right.est, wrong.est], [465, 90], '30 題全對 465、全錯 90(另外算過)');
  const huge = sumOf('R', Array.from({ length: 3000 }, () => ev(-3, .25, 0, 1)));
  assert.ok(Number.isFinite(huge.theta) && huge.est >= 5 && huge.est <= 495 && huge.h >= 25);
  const top = sumOf('L', Array.from({ length: 3000 }, () => ev(3, 1 / 3, 1, 1)));
  assert.ok(Number.isFinite(top.theta) && top.est === 495 && top.hi === 495, '上緣夾在 495');
  near(sumOf('R', [ev(0, .25, 1, 0)]).theta, sumOf('R', []).theta, 1e-12, '權重 0 等於沒作答');
  throws(() => X.logPost(X.prior(PARAMS, 'R'), [ev(0, .25, 2, 1)]), /對錯/);
  throws(() => X.logPost(X.prior(PARAMS, 'R'), [ev(0, .25, 1, -1)]), /權重/);
  throws(() => X.summarize(PARAMS, 'X', X.logPost(X.prior(PARAMS, 'R'), [])), /科/);
  throws(() => X.checkParams({ curve: {} }), /參數/);
};

/* ---------- 範圍 ---------- */
/* 手算:系統誤差 √(35² + 15² + (20f)²):f = 0 → 38.079;f = 0.5 → √1550 = 39.370;f = 1 → √1850 = 43.012。
   總分 595(310 + 285),半寬 √(91.483² + 72.051² + (38.079 + 38.079)²) = 139.14 → 140,範圍 455–735 */
T['範圍:系統誤差三項、最窄 25、總分系統項相加、兩端顯示規則'] = () => {
  near(X.sysErr(0), 38.07886552931954, 1e-9); near(X.sysErr(.5), 39.370039370059054, 1e-9); near(X.sysErr(1), 43.01162633521314, 1e-9);
  const tight = X.summarize(PARAMS, 'R', X.logPost({ mu: 0, sd: 0.01 }, []), 0, { sys: { C: 0, P: 0, Q: 0 } });
  eq(tight.h, 25, '隨機與系統誤差都很小時,半寬 25');
  const t = X.total(sumOf('L', EV_L), sumOf('R', EV_R));
  eq([t.est, t.h, t.lo, t.hi], [595, 140, 455, 735]);
  const t2 = X.total({ est: 20, srand: 0, sys: 0 }, { est: 10, srand: 0, sys: 0 });
  eq([t2.h, t2.lo], [35, 10], '總分最窄 35、下緣夾在 10');
  const k = (est, h) => X.ends({ est, h, lo: Math.max(5, est - h), hi: Math.min(495, est + h) });
  eq([k(145, 70).kind, k(150, 70).kind, k(445, 70).kind, k(450, 70).kind], ['low', 'num', 'num', 'high']);
  eq([k(445, 70).hi, k(445, 70).lo], [495, 375], '上緣超過 495 寫到 495');
};

/* ---------- 四級 ---------- */
T['四級:預估在切點上下都對上新用戶設定的對級;各級機率加起來是 1;建議改級要 ≥0.8 且跟目前不同'] = () => {
  const ob = load();
  vm.runInContext(read('js/onboard-core.js'), ob, { filename: 'js/onboard-core.js' });
  const B = ob.ONBOARD_CORE.bandOf;
  for (let s = 5; s <= 495; s += 5) {
    eq(X.bandOf('L', s), B('listening', s), '聽力 ' + s);
    eq(X.bandOf('R', s), B('reading', s), '閱讀 ' + s);
  }
  eq([X.bandOf('L', 220), X.bandOf('L', 225), X.bandOf('R', 365), X.bandOf('R', 370)], ['entry', 'threshold', 'advanced', 'high']);
  [EV_R, [], EV_R.slice(0, 3)].forEach((e) => near(sumOf('R', e).pb.reduce((a, b) => a + b, 0), 1, 1e-9));
  eq(X.suggest({ pb: [0, 0.05, 0.1, 0.85] }, 'advanced'), 'high');
  eq(X.suggest({ pb: [0, 0.05, 0.1, 0.85] }, 'high'), null, '同一級不提示');
  eq(X.suggest({ pb: [0, 0.25, 0.4, 0.35] }, 'entry'), null, '沒有一級到 0.8');
  eq(X.suggest({ pb: [0.8, 0.2, 0, 0] }, 'threshold'), 'entry', '剛好 0.8 也提示');
  eq(X.suggest({ pb: [0.79, 0.21, 0, 0] }, 'threshold'), null, '0.79 不提示');
};

/* ---------- 題目 key ---------- */
T['keyOf:單題用題目 id;題組用「組 id:」加空格號,沒有空格號用 0 起算的位置;課程的 1 起算小題號換得回來'] = () => {
  eq(X.keyOf('1', 'l1-01', {}, 0), 'l1-01');
  eq(X.keyOf('2', 'l2-07', { num: 3 }, 0), 'l2-07', '單題不看 num');
  eq(X.keyOf('5', 'p5-b1-01', {}, 0), 'p5-b1-01');
  eq(X.keyOf('3', 'l3-11', {}, 0), 'l3-11:0');
  eq(X.keyOf('4', 'l4-02', {}, 2), 'l4-02:2');
  eq(X.keyOf('6', 'p6-b1-1', { num: 131 }, 0), 'p6-b1-1:131');
  eq(X.keyOf('7', 'p7-b1-1', {}, 3), 'p7-b1-1:3');
  eq(X.keyOf('7s', 'p7-b1-1', {}, 1), 'p7-b1-1:1');
  eq(X.keyOf('6', 'd6', { num: 2 }, 1), 'd6:2', '舊檢測題組');
  eq([X.keyOf('3', 'l3-11', { num: 5 }, 1), X.keyOf('4', 'l4-02', { num: 9 }, 0)], ['l3-11:1', 'l4-02:0'], '聽力題組跟聽力頁一樣不看 num');
  eq(X.keyOf('7', 'p7-b1-1', { num: 4 }, 0), 'p7-b1-1:4', '閱讀題組跟刷題頁一樣有 num 用 num');
  eq([X.keyFromSub('6', 'p6-b1-1', 131), X.keyFromSub('3', 'l3-11', 1), X.keyFromSub('7', 'p7-b1-1', 4), X.keyFromSub('5', 'p5-x', 0), X.keyFromSub('1', 'l1-01', null)],
    ['p6-b1-1:131', 'l3-11:0', 'p7-b1-1:3', 'p5-x', 'l1-01']);
  eq(['l1-01', 'l2-x', 'l3-11:0', 'l4-02:2', 'p5-b1-01', 'p6-b1-1:131', 'p7-b1-1:3', 'd5-01', 'd6:2', 'd7:4', 'zz-1'].map(X.partOfKey),
    ['1', '2', '3', '4', '5', '6', '7', '5', '6', '7', null]);
  throws(() => X.keyOf('8', 'x', {}, 0), /Part/);
  throws(() => X.keyOf('3', '', {}, 0), /id/);
  throws(() => X.keyOf('3', 'l3-1', {}, -1), /位置/);
  throws(() => X.keyFromSub('3', 'l3-1', 0), /小題/);
};

/* 練習頁、聽力頁、課程的寫法(照原檔抄一份,不改原檔):刷題 set.id + ':' + (q.num ?? qi);聽力題組 set.id + ':' + qi;單題用 q.id */
T['keyOf 對上題庫:每一題都有 key、跟練習頁與課程的寫法一致;學習記錄樣本的 key 全部查得到難度'] = () => {
  const ctx = load();
  ['data/part5.js', 'data/part6.js', 'data/part7.js', 'data/listening.js', 'data/bank-meta.js', 'js/lesson-core.js'].forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  const D = ctx.TOEIC, LC = ctx.LESSON_CORE, keys = [], hist = [];
  const practiceQid = (set, q, qi) => set.id + ':' + (q.num !== undefined ? q.num : qi);
  D.part5.forEach((q) => { keys.push(X.keyOf('5', q.id, q, 0)); hist.push({ m: 'p5', id: q.id }); });
  [['6', D.part6], ['7', D.part7]].forEach(([p, sets]) => sets.forEach((set) => set.questions.forEach((q, qi) => {
    const k = X.keyOf(p, set.id, q, qi); keys.push(k);
    eq(k, practiceQid(set, q, qi)); eq(k, LC.itemKeys(p, set, set.id)[qi].key, '課程 ' + k);
    hist.push({ m: 'p' + p, id: practiceQid(set, q, qi) });
  })));
  [['1', D.listening.p1], ['2', D.listening.p2]].forEach(([p, arr]) => arr.forEach((q) => { keys.push(X.keyOf(p, q.id, q, 0)); hist.push({ m: 'l' + p, id: q.id }); }));
  [['3', D.listening.p3], ['4', D.listening.p4]].forEach(([p, sets]) => sets.forEach((set) => set.questions.forEach((q, qi) => {
    const k = X.keyOf(p, set.id, q, qi); keys.push(k); eq(k, set.id + ':' + qi); eq(k, LC.itemKeys(p, set, set.id)[qi].key);
    hist.push({ m: 'l' + p, id: set.id + ':' + qi });
  })));
  const meta = ctx.BANK_META.items.reduce((a, m) => a + (m.size || 1), 0);
  eq(keys.length, meta, '小題數對上題庫索引');
  eq(new Set(keys).size, keys.length, 'key 不重複');
  keys.forEach((k) => assert.ok(X.partOfKey(k), '認得 Part ' + k));
  const b = {}; keys.forEach((k) => { b[k] = 0; });
  const P2 = Object.assign({}, PARAMS, { b });
  const got = X.evidence(P2, X.backfill(X.faEmpty(), { hist: hist.map((h, i) => Object.assign({ c: 0, ok: i % 2 === 0, t: Date.UTC(2026, 10, 1) + i }, h)), now: Date.UTC(2026, 10, 20) }), 'R', 330);
  eq(got.missing, [], '查不到難度的 key(閱讀)');
  eq(X.evidence(P2, X.backfill(X.faEmpty(), { hist: hist.map((h, i) => Object.assign({ c: 0, ok: true, t: Date.UTC(2026, 10, 1) + i }, h)), now: Date.UTC(2026, 10, 20) }), 'L', 330).missing, [], '聽力');
  throws(() => X.backfill(X.faEmpty(), { diag: { done: true, answers: {} }, now: 1 }), /舊檢測/);
  const ipFile = path.join(ROOT, 'data/item-params.js');
  if (!fs.existsSync(ipFile)) return keys.length + ' 小題;data/item-params.js 還沒產生,用題庫 key 當難度表';
  const ip = load(); vm.runInContext(fs.readFileSync(ipFile, 'utf8'), ip);
  const lack = keys.filter((k) => !(k in ip.ITEM_PARAMS.b));
  eq(lack, [], 'item-params 缺的 key');
  return keys.length + ' 小題;item-params 全部查得到';
};

/* 真的題目參數:隨機抽題(固定種子)的 key 都查得到難度;照題庫組成的候選題全部可出;估分、顯示跑得動 */
T['真的 item-params:隨機抽題的 key 查得到難度、選題的候選題完整、估分與顯示跑得動'] = () => {
  const ctx = load();
  ['data/part5.js', 'data/part6.js', 'data/part7.js', 'data/listening.js', 'data/diagnostic.js', 'data/item-params.js'].forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  const IP = JSON.parse(JSON.stringify(ctx.ITEM_PARAMS)), D = ctx.TOEIC;
  X.checkParams(IP);
  const units = [];
  [['1', D.listening.p1], ['2', D.listening.p2], ['5', D.part5]].forEach(([p, arr]) => arr.forEach((q) => units.push({ id: q.id, part: p, keys: [X.keyOf(p, q.id, q, 0)] })));
  [['3', D.listening.p3], ['4', D.listening.p4], ['6', D.part6], ['7', D.part7]].forEach(([p, arr]) => arr.forEach((s) => units.push({ id: s.id, part: p, keys: s.questions.map((q, qi) => X.keyOf(p, s.id, q, qi)) })));
  const rnd = mulberry(20261125);
  let fa = X.faEmpty();
  for (let i = 0; i < 300; i++) {
    const u = units[Math.floor(rnd() * units.length)];
    u.keys.forEach((k) => { assert.ok(Number.isFinite(IP.b[k]), '查得到難度 ' + k); fa = X.faAdd(fa, k, 300 + (i % 20), rnd() < 0.6 ? 1 : 0, 'p'); });
  }
  X.legacyItems(D.diagnostic).forEach((it) => assert.ok(Number.isFinite(IP.b[it.key]), '舊 28 題 ' + it.key));
  ['1', '2', '3', '4', '5', '6', '7'].forEach((p) => {
    const all = units.filter((u) => u.part === p);
    eq(X.available({ part: p, units: all, params: IP, fa: X.faEmpty() }).length, all.length, 'Part ' + p + ' 候選題完整');
    const got = X.pickUnit({ units: all, params: IP, theta: 0, seed: 's' + p, runAt: 'r', slot: 0 });
    got.keys.forEach((k) => assert.ok(Number.isFinite(IP.b[k]), '選到的題查得到難度 ' + k));
  });
  ['L', 'R'].forEach((sec) => {
    const e = X.estimate(IP, sec, { fa, today: 330 });
    eq(e.missing, [], sec + ' 查不到難度的 key');
    assert.ok(e.n > 0 && e.est >= 5 && e.est <= 495, sec + ' 預估 ' + e.est);
  });
  const view = X.display({ params: IP, fa, today: 330, now: 'n' });
  assert.ok(view.L.show && view.R.show, '兩科都夠題數');
  near(X.scoreOf(IP.curve.R, 1), 495, 0, '閱讀曲線到 495');
  return '抽 300 次;聽力 ' + view.L.est + '、閱讀 ' + view.R.est;
};

/* ---------- 衰減與證據 ---------- */
/* 手算:權重 × 0.5^(天數 ÷ 180) × 0.5^(之後的題數 ÷ 200):180 天 → 0.5;之後 200 題 → 0.5;兩者 → 0.25;720 天 → 1/16,沒有下限 */
T['衰減:天數與題數兩項相乘,沒有下限'] = () => {
  eq([X.decay(0, 0), X.decay(180, 0), X.decay(0, 200), X.decay(180, 200), X.decay(720, 0)], [1, 0.5, 0.5, 0.25, 0.0625]);
  near(X.decay(3600, 2000), Math.pow(0.5, 20) * Math.pow(0.5, 10), 1e-18, '很久以前也不設下限');
  throws(() => X.decay(-1, 0), /天/);
};

T['證據:來源權重、題組 0.75、看過不計分、查不到難度的 key 記下來;之後的題數照日數與來源排序'] = () => {
  let fa = X.faEmpty();
  const add = (k, d, ok, s) => { fa = X.faAdd(fa, k, d, ok, s); };
  add('p5-a', 100, 1, 't'); add('p5-b', 100, 0, 'k'); add('d5-01', 90, 1, 'g'); add('p5-c', 101, 1, 'p');
  add('p6-x:1', 101, 1, 'p'); add('p5-d', 101, null, 'o'); add('p5-e', 101, 0, 'c'); add('p5-zz', 101, 1, 'p');
  add('l2-a', 100, 1, 'l'); add('l2-b', 100, 1, 'r'); add('l1-a', 100, 0, 'h'); add('l3-z:0', 100, 1, 't');
  const r = X.evidence(PARAMS, fa, 'R', 101);
  eq(r.missing, ['p5-zz']);
  eq(r.list.map((e) => e.key), ['d5-01', 'p5-a', 'p5-b', 'p5-c', 'p6-x:1'], '照日數、來源先後、key 排');
  const w = (k) => r.list.filter((e) => e.key === k)[0].w;
  near(w('p6-x:1'), 0.8 * 0.75, 1e-12, '刷題題組');
  near(w('p5-c'), 0.8 * Math.pow(0.5, 1 / 200), 1e-12, '之後還有 1 題');
  near(w('d5-01'), Math.pow(0.5, 11 / 180) * Math.pow(0.5, 4 / 200), 1e-12, '舊檢測 11 天前、之後 4 題');
  eq([r.n, r.parts], [5, { 5: 4, 6: 1 }]);
  const wp = w('p5-c') + w('p6-x:1'), wa = r.list.reduce((a, e) => a + e.w, 0);
  near(r.f, wp / wa, 1e-12, '練習佔權重比例');
  const l = X.evidence(PARAMS, fa, 'L', 100);
  eq(l.list.map((e) => [e.key, +e.w.toFixed(6)]), [['l3-z:0', +(0.75 * Math.pow(0.5, 3 / 200)).toFixed(6)], ['l2-a', +(0.8 * Math.pow(0.5, 2 / 200)).toFixed(6)], ['l2-b', +(0.5 * Math.pow(0.5, 1 / 200)).toFixed(6)], ['l1-a', 0.7]]);
  const off = X.evidence(PARAMS, fa, 'R', 101, { sources: 'tgplrh' });
  assert.ok(off.list.every((e) => e.src !== 'k'), '課程前測可以關掉');
  throws(() => X.evidence(PARAMS, { v: 1, i: [] }, 'R', 1), /第一次作答/);
};

/* ---------- 顯示門檻 ---------- */
T['顯示門檻:做完檢測、有效成績,或 20 題以上且 Part 分布夠;不夠時給「再做 N 題」'] = () => {
  const g = (sec, parts, flags) => X.enough(sec, parts, flags || {});
  eq(g('L', { 1: 20 }), { show: false, need: 4, kind: 'big' }, '20 題全是 P1:再做 4 題對話或獨白題(P3 到 4 題就有兩個 Part)');
  eq(g('R', { 5: 8, 6: 12 }).show, true, 'P5 8 題+其他 12 題');
  eq(g('R', { 5: 19 }), { show: false, need: 1, kind: 'any' });
  eq(g('L', { 1: 16, 2: 4 }).show, true, '兩個 Part 各 4 題以上');
  eq(g('L', { 1: 17, 2: 3 }), { show: false, need: 4, kind: 'big' }, 'P2 差 1 題也一樣請他做對話或獨白題');
  eq(g('L', { 1: 17, 3: 3 }), { show: false, need: 1, kind: 'big' }, 'P3 再 1 題就有兩個 Part 各 4 題');
  eq(g('R', { 5: 6, 6: 14 }).show, true, '已經有兩個 Part 各 4 題');
  eq(g('R', { 6: 20 }), { show: false, need: 4, kind: 'big' }, '補 4 題 P5 或 P7');
  eq(g('L', {}), { show: false, need: 20, kind: 'any' });
  eq(g('L', {}, { done: true }).show, true, '做完這一科的檢測');
  eq(g('R', {}, { self: true }).show, true, '有效自填成績');
};

/* ---------- 選題 ---------- */
const UNITS = [
  ...['p5-a', 'p5-b', 'p5-c', 'p5-d', 'p5-e', 'p5-f', 'p5-g', 'p5-h', 'p5-i', 'p5-j'].map((id) => ({ id, part: '5', keys: [id] })),
  { id: 'p6-x', part: '6', keys: ['p6-x:1', 'p6-x:2', 'p6-x:3', 'p6-x:4'] },
  { id: 'p7-y', part: '7s', keys: ['p7-y:0', 'p7-y:1', 'p7-y:2', 'p7-y:3'] },
  { id: 'p5-nob', part: '5', keys: ['p5-nob'] },
];
T['選題:同種子同作答選同一題;不同種子會不同;只從資訊量前 5 題挑;同分照種子排'] = () => {
  const pool = UNITS.filter((u) => u.part === '5' && u.id !== 'p5-nob');
  const pick = (seed, at, slot) => X.pickUnit({ params: PARAMS, units: pool, theta: 0.3, seed, runAt: at, slot }).id;
  eq(pick('user-1', '2026-11-25T10:00:00Z', 0), pick('user-1', '2026-11-25T10:00:00Z', 0), '重整頁面挑同一題');
  const seen = new Set(); for (let i = 0; i < 30; i++) seen.add(pick('user-' + i, '2026-11-25T10:00:00Z', 0));
  assert.ok(seen.size >= 3, '不同種子挑到 ' + seen.size + ' 種');
  const top5 = pool.slice().sort((a, b) => X.info(0.3, PARAMS.b[b.id], .25) - X.info(0.3, PARAMS.b[a.id], .25)).slice(0, 5).map((u) => u.id);
  seen.forEach((id) => assert.ok(top5.indexOf(id) > -1, id + ' 不在前 5'));
  const same = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => ({ id: 'q-' + s, part: '5', keys: ['q-' + s] }));
  const pz = Object.assign({}, PARAMS, { b: { 'q-a': 0, 'q-b': 0, 'q-c': 0, 'q-d': 0, 'q-e': 0, 'q-f': 0 } });
  const rank = (seed) => X.rankUnits({ params: pz, units: same, theta: 0, seed }).map((u) => u.id).join();
  eq(rank('s1'), rank('s1')); assert.notEqual(rank('s1'), rank('s2'), '同分時每人順序不同');
  const g = X.pickUnit({ params: PARAMS, units: UNITS.filter((u) => u.part === '6' || u.part === '7s'), theta: 0, seed: 'x', runAt: 'a', slot: 5 });
  assert.ok(g.id === 'p6-x' || g.id === 'p7-y');
  eq(X.startTheta(0.8, true), 0.30000000000000004); eq(X.startTheta(0.8, false), 0.8);
  throws(() => X.pickUnit({ params: PARAMS, units: [], theta: 0, seed: 'x', runAt: 'a', slot: 0 }), /沒有/);
  throws(() => X.pickUnit({ params: PARAMS, units: pool, theta: 0, seed: '', runAt: 'a', slot: 0 }), /種子/);
};

T['選題排除:不在難度表、做過或看過、這次出過、課程預留(開關);沒題的格跳過、總題數事先算好'] = () => {
  let fa = X.faEmpty(); fa = X.faAdd(fa, 'p5-a', 10, 1, 'p'); fa = X.faAdd(fa, 'p5-b', 10, null, 'o'); fa = X.faAdd(fa, 'p6-x:3', 10, 0, 'c');
  const base = { params: PARAMS, units: UNITS, part: '5', fa, used: ['p5-c'], reserve: ['p5-d'] };
  const ids = (o) => X.available(Object.assign({}, base, o)).map((u) => u.id);
  eq(ids({}), ['p5-d', 'p5-e', 'p5-f', 'p5-g', 'p5-h', 'p5-i', 'p5-j'], '預留開關預設關');
  eq(ids({ reserveOn: true }), ['p5-e', 'p5-f', 'p5-g', 'p5-h', 'p5-i', 'p5-j'], '開關打開就排除預留題');
  eq(ids({ part: '6' }), [], '題組有一小題看過就整組不出');
  eq(ids({ part: '7s' }), ['p7-y']);
  const script = [{ part: '5' }, { part: '5' }, { part: '6', group: true }, { part: '7s', group: true }, { part: '5' }];
  const plan = X.planSlots(script, (part) => X.available(Object.assign({}, base, { part })));
  eq(plan.slots.map((s) => s.part), ['5', '5', '7s', '5']);
  eq(plan.total, 7, '3 單題 + 一組 4 題');
  const few = X.planSlots(script, (part) => (part === '5' ? UNITS.slice(0, 2) : []));
  eq([few.slots.length, few.total], [2, 2], 'P5 只剩 2 題:第 3 個 P5 格也跳過');
};

/* ---------- 第一次作答紀錄 ---------- */
T['第一次作答:只寫還沒有的題;格式檢查;日數從 2026-01-01 起算'] = () => {
  let fa = X.faEmpty();
  fa = X.faAdd(fa, 'p5-a', 329, 1, 'p');
  const again = X.faAdd(fa, 'p5-a', 330, 0, 't');
  eq(again, fa, '第二次作答不寫');
  assert.notStrictEqual(X.faAdd(fa, 'p5-b', 1, 0, 'p'), fa, '回傳新物件');
  eq(fa, { v: 1, i: { 'p5-a': [329, 1, 'p'] } }, '原物件沒被改');
  eq(X.dayNum(new Date(2026, 0, 1, 0, 0).getTime()), 0); eq(X.dayNum(new Date(2026, 0, 1, 23, 59).getTime()), 0);
  eq(X.dayNum(new Date(2026, 10, 25, 9).getTime()), 328); eq(X.dayNum(new Date(2025, 11, 31, 12).getTime()), -1);
  throws(() => X.faAdd(fa, 'p5-c', 1, 1, 'x'), /來源/);
  throws(() => X.faAdd(fa, 'p5-c', 1.5, 1, 'p'), /日數/);
  throws(() => X.faAdd(fa, 'p5-c', 1, 2, 'p'), /對錯/);
  throws(() => X.faAdd(fa, '', 1, 1, 'p'), /key/);
  eq(X.faNormalize({ v: 1, i: { a: [1, 1, 'p'], b: [1, 3, 'p'], c: 'x', d: [1, null, 'o'] } }), { v: 1, i: { a: [1, 1, 'p'], d: [1, null, 'o'] } });
  eq([X.faNormalize(null), X.faNormalize([])], [X.faEmpty(), X.faEmpty()]);
};

function randFa(rnd) {
  const src = 'tkglprhco', i = {};
  const n = Math.floor(rnd() * 8);
  for (let k = 0; k < n; k++) {
    const ok = [0, 1, null][Math.floor(rnd() * 3)];
    i['k' + Math.floor(rnd() * 6)] = [Math.floor(rnd() * 3), ok, src[Math.floor(rnd() * src.length)]];
  }
  return { v: 1, i };
}
T['合併第一次作答:交換律、結合律、冪等(固定種子 500 組);留日數小、同日照來源、再同照對錯(看過最小);輸出照 key 排'] = () => {
  const M = X.mergeFirstAttempts, rnd = mulberry(20261125);
  for (let r = 0; r < 500; r++) {
    const a = randFa(rnd), b = randFa(rnd), c = randFa(rnd);
    eq(M(a, b), M(b, a), '交換 ' + r);
    eq(M(M(a, b), c), M(a, M(b, c)), '結合 ' + r);
    eq(M(a, a), M(a, X.faEmpty()), '冪等 ' + r);
    eq(M(M(a, b), b), M(a, b), '再合一次不變 ' + r);
  }
  const A = { v: 1, i: { z: [5, 1, 'p'], y: [3, 1, 'p'], x: [3, 1, 'p'], w: [3, 1, 'h'] } };
  const B = { v: 1, i: { z: [4, 0, 'p'], y: [3, 0, 't'], x: [3, null, 'p'], w: [3, 0, 'c'], v: [1, 1, 'g'] } };
  const m = M(A, B);
  eq(Object.keys(m.i), ['v', 'w', 'x', 'y', 'z']);
  eq(m.i, { v: [1, 1, 'g'], w: [3, 1, 'h'], x: [3, null, 'p'], y: [3, 0, 't'], z: [4, 0, 'p'] });
  eq(M(null, { v: 1, i: { a: [1, 1, 'p'] } }), { v: 1, i: { a: [1, 1, 'p'] } }, '一邊沒有資料');
  eq(X.SOURCES, 'tkglprhco');
};

/* ---------- 檢測紀錄、預估快照 ---------- */
const run = (at, end, items, extra) => Object.assign({ at, end, ip: 'ip1', cv: 'c1', sec: 'LR', tm: {}, items, res: {} }, extra || {});
T['合併檢測紀錄:同一次的作答照 key 聯集、結束時間取有值的、只留最新 5 次;交換、結合、冪等'] = () => {
  const M = X.mergePlacementRuns;
  const a = { v: 1, runs: [run('2026-11-20T01:00:00Z', null, [['L', 'l1-a', 1, 1, 9], ['L', 'l2-a', 0, 0, 7]])] };
  const b = { v: 1, runs: [run('2026-11-20T01:00:00Z', '2026-11-20T01:20:00Z', [['L', 'l1-a', 1, 1, 9], ['R', 'p5-a', 2, 1, 30]], { res: { R: [285, 205, 365] } })] };
  const m = M(a, b);
  eq(m.runs.length, 1); eq(m.runs[0].end, '2026-11-20T01:20:00Z'); eq(m.runs[0].res, { R: [285, 205, 365] });
  eq(m.runs[0].items.map((x) => x[1]).sort(), ['l1-a', 'l2-a', 'p5-a']);
  const many = { v: 1, runs: [1, 2, 3, 4, 5, 6, 7].map((d) => run('2026-11-0' + d + 'T00:00:00Z', null, [])) };
  eq(M(many, { v: 1, runs: [] }).runs.map((r) => r.at.slice(8, 10)), ['03', '04', '05', '06', '07']);
  const rnd = mulberry(7);
  const rr = () => ({ v: 1, runs: Array.from({ length: Math.floor(rnd() * 4) }, () => run('2026-11-0' + (1 + Math.floor(rnd() * 7)) + 'T00:00:00Z',
    rnd() < 0.5 ? null : '2026-11-0' + (1 + Math.floor(rnd() * 3)) + 'T09:00:00Z',
    Array.from({ length: Math.floor(rnd() * 3) }, () => ['R', 'p5-' + Math.floor(rnd() * 4), Math.floor(rnd() * 4), Math.floor(rnd() * 2), Math.floor(rnd() * 60)]))) });
  for (let r = 0; r < 300; r++) {
    const x = rr(), y = rr(), z = rr();
    eq(M(x, y), M(y, x), '交換 ' + r); eq(M(M(x, y), z), M(x, M(y, z)), '結合 ' + r); eq(M(M(x, y), y), M(x, y), '冪等 ' + r);
  }
  eq(M(null, undefined), { v: 1, runs: [] });
};

T['合併檢測紀錄:每科的開始、結束時間與結果分開併,一科做完的時間不會被另一份沒做完的蓋掉;交換、結合、冪等'] = () => {
  const M = X.mergePlacementRuns, AT = '2026-11-20T01:00:00Z';
  const local = { v: 1, runs: [run(AT, null, [['L', 'l1-a', 1, 1, 9]], { tm: { L: [AT, '2026-11-20T01:08:00Z'] }, res: { L: [300, 230, 370] } })] };
  const cloud = { v: 1, runs: [run(AT, null, [['L', 'l1-a', 1, 1, 9], ['L', 'l2-a', 0, 0, 7], ['L', 'l2-b', 0, 0, 7], ['L', 'l2-c', 0, 0, 7], ['L', 'l2-d', 0, 0, 7], ['L', 'l2-e', 0, 0, 7], ['L', 'l2-f', 0, 0, 7], ['L', 'l2-g', 0, 0, 7], ['L', 'l2-h', 0, 0, 7], ['L', 'l2-i', 0, 0, 7], ['L', 'l2-j', 0, 0, 7]], { tm: { L: [AT, null], R: ['2026-11-20T01:09:00Z', null] } })] };
  [M(local, cloud), M(cloud, local)].forEach((m, i) => {
    eq(m.runs[0].tm, { L: [AT, '2026-11-20T01:08:00Z'], R: ['2026-11-20T01:09:00Z', null] }, '時間 ' + i);
    eq(m.runs[0].res, { L: [300, 230, 370] }, '結果 ' + i);
    eq(m.runs[0].items.length, 11, '作答 ' + i);
  });
  const rnd = mulberry(11), t = (d, h) => '2026-11-0' + d + 'T0' + h + ':00:00Z';
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const rr = () => ({ v: 1, runs: Array.from({ length: Math.floor(rnd() * 3) }, () => run(t(1 + Math.floor(rnd() * 3), 0), rnd() < 0.5 ? null : t(1, 9), [], {
    tm: { L: [pick([null, t(1, 1), t(1, 2)]), pick([null, t(1, 3), t(1, 4)])], R: [pick([null, t(1, 5)]), pick([null, t(1, 6), t(1, 7)])] },
    res: rnd() < 0.5 ? {} : { L: [pick([200, 300]), 150, 400] },
  })) });
  for (let r = 0; r < 300; r++) {
    const x = rr(), y = rr(), z = rr();
    eq(M(x, y), M(y, x), '交換 ' + r); eq(M(M(x, y), z), M(x, M(y, z)), '結合 ' + r); eq(M(M(x, y), y), M(x, y), '冪等 ' + r);
  }
};

T['預估快照:時間新的整份贏,不合併欄位'] = () => {
  const a = { ip: 'ip1', cv: 'c1', at: '2026-11-20T00:00:00Z', L: [300, 250, 350, 30], R: null };
  const b = { ip: 'ip1', cv: 'c1', at: '2026-11-21T00:00:00Z', L: null, R: [280, 230, 330, 40] };
  eq(X.mergeEst(a, b), b); eq(X.mergeEst(b, a), b); eq(X.mergeEst(a, null), a); eq(X.mergeEst(null, null), null);
};

/* ---------- 舊資料補回 ---------- */
/* 舊 28 題卷的「答案形狀」:{ done, answers: { 0..27: 選項 }, finishedAt }。5 份完整作答的答對數是 12、16、16、17、18(43%–64%),
   這裡照答對數自己編答案,不是帳號資料 */
const LEGACY = (() => {
  const ctx = load(); vm.runInContext(read('data/diagnostic.js').replace('window.TOEIC = window.TOEIC || {};', 'var TOEIC = {};'), ctx);
  return vm.runInContext('TOEIC.diagnostic', ctx);
})();
function shapeOf(nRight, rnd) {
  const items = X.legacyItems(LEGACY), order = items.map((_, i) => i).sort(() => rnd() - 0.5), ans = {};
  order.forEach((i, k) => { ans[i] = k < nRight ? items[i].answer : (items[i].answer + 1) % 4; });
  return { done: true, answers: ans, startedAt: '2026-09-01T02:00:00Z', finishedAt: '2026-09-01T02:20:00Z' };
}
T['補回舊 28 題:5 份作答形狀逐題批改、來源舊檢測;沒做完不補;沒作答的題不寫'] = () => {
  const items = X.legacyItems(LEGACY);
  eq(items.length, 28); eq(items.slice(19, 22).map((x) => x.key), ['d5-20', 'd6:1', 'd6:2']); eq(items[27].key, 'd7:3', '舊 P7 沒有小題號,用 0 起算的位置');
  const rnd = mulberry(3), now = Date.UTC(2026, 10, 25);
  [12, 16, 16, 17, 18].forEach((n) => {
    const fa = X.backfill(X.faEmpty(), { diag: shapeOf(n, rnd), legacy: LEGACY, now });
    const vals = Object.keys(fa.i).map((k) => fa.i[k]);
    eq([vals.length, vals.filter((v) => v[1] === 1).length, vals.every((v) => v[2] === 'g' && v[0] === 243)], [28, n, true], '答對 ' + n);
  });
  const part = shapeOf(20, rnd); delete part.answers[3]; delete part.answers[25];
  eq(Object.keys(X.backfill(X.faEmpty(), { diag: part, legacy: LEGACY, now }).i).length, 26);
  eq(X.backfill(X.faEmpty(), { diag: Object.assign({}, part, { done: false }), legacy: LEGACY, now }), X.faEmpty());
};

const DAY = 864e5, NOW = Date.UTC(2026, 10, 25, 4);
T['補回學習記錄:沒被截斷時每題取最早一筆(聽力看播放次數與速度);截斷時全部記看過;只有作答紀錄的題記看過;已有的不動'] = () => {
  const hist = [
    { m: 'p5', id: 'p5-a', c: 1, ok: false, t: NOW - 10 * DAY }, { m: 'p5', id: 'p5-a', c: 2, ok: true, t: NOW - 5 * DAY },
    { m: 'l2', id: 'l2-a', c: 0, ok: true, t: NOW - 9 * DAY, pl: 1, sp: 1 }, { m: 'l2', id: 'l2-b', c: 0, ok: true, t: NOW - 9 * DAY, pl: 2, sp: 1 },
    { m: 'l3', id: 'l3-z:0', c: 0, ok: false, t: NOW - 8 * DAY, pl: 1, sp: 1.25 }, { m: 'g', id: 'g-1', c: 0, ok: true, t: NOW - 8 * DAY },
  ];
  const records = { drill_p5: { 'p5-a': { c: 2, ok: true, t: NOW - 5 * DAY }, 'p5-b': { c: 1, ok: false, t: NOW - 3 * DAY } }, listen_p2: { 'l2-a': { c: 0, ok: true, t: NOW - 9 * DAY } } };
  const pre = X.faAdd(X.faEmpty(), 'l2-a', 300, 0, 't');
  const fa = X.backfill(pre, { hist, records, now: NOW });
  const d = (ms) => X.dayNum(ms);
  eq(fa.i, { 'l2-a': [300, 0, 't'], 'l2-b': [d(NOW - 9 * DAY), 1, 'r'], 'l3-z:0': [d(NOW - 8 * DAY), 0, 'r'], 'p5-a': [d(NOW - 10 * DAY), 0, 'h'], 'p5-b': [d(NOW - 3 * DAY), null, 'o'] });
  const plain = X.backfill(X.faEmpty(), { hist: [{ m: 'l1', id: 'l1-a', c: 0, ok: true, t: NOW - DAY }], now: NOW });
  eq(plain.i['l1-a'][2], 'h', '沒帶播放資訊的聽力記 h');
  const full = Array.from({ length: 1500 }, (_, i) => ({ m: 'p5', id: 'p5-' + (i % 7), c: 0, ok: true, t: NOW - DAY + i }));
  const cut = X.backfill(X.faEmpty(), { hist: full, now: NOW });
  assert.ok(Object.keys(cut.i).every((k) => cut.i[k][1] === null && cut.i[k][2] === 'o'), '筆數到 1500:全部看過');
  const old = X.backfill(X.faEmpty(), { hist: [{ m: 'p5', id: 'p5-a', c: 0, ok: true, t: NOW - 60 * DAY }], now: NOW });
  eq(old.i['p5-a'], [X.dayNum(NOW - 60 * DAY), null, 'o'], '最舊一筆滿 60 天:看過');
  const lost = X.backfill(X.faEmpty(), { hist: [{ m: 'p5', id: 'p5-a', c: 0, ok: true, t: NOW - DAY }], records: { drill_p5: { 'p5-q': { c: 0, ok: true, t: NOW - 40 * DAY } } }, now: NOW });
  eq(lost.i['p5-a'][2], 'o', '作答紀錄比學習記錄最舊一筆還早:前面的已經被清掉,也當截斷');
  eq(X.backfillStats(X.faEmpty(), { hist, records, now: NOW }), { g: 0, k: 0, h: 1, l: 1, r: 2, o: 1, cut: false });
  const rows = X.backfill(X.faEmpty(), { rows: [{ key: 'p5-a', day: 5, ok: 1, src: 'k' }, { key: 'p5-b', day: 5, ok: null, src: 'k' }], now: NOW });
  eq(rows.i, { 'p5-a': [5, 1, 'k'] }, '課程前測逐題寫入、沒作答的不寫');
  const order = X.backfill(X.faEmpty(), { hist: [{ m: 'p5', id: 'p5-a', c: 0, ok: false, t: NOW - 9 * DAY }], rows: [{ key: 'p5-a', day: X.dayNum(NOW - 2 * DAY), ok: 1, src: 'k' }, { key: 'p5-c', day: X.dayNum(NOW - 2 * DAY), ok: 0, src: 'k' }], now: NOW });
  eq(order.i, { 'p5-a': [X.dayNum(NOW - 9 * DAY), 0, 'h'], 'p5-c': [X.dayNum(NOW - 2 * DAY), 0, 'k'] }, '先刷題、後來在前測又出現:留較早的刷題那次');
  throws(() => X.backfill(X.faEmpty(), { hist: 'x', now: NOW }), /學習記錄/);
  throws(() => X.backfill(X.faEmpty(), { now: NaN }), /時間/);
};

/* ---------- 估分與顯示 ---------- */
T['估分與顯示:一個函式算兩科與總分;差不到 10 分沿用上次、範圍以顯示的數字為中心、四級用新算的;版本換了就不沿用'] = () => {
  let fa = X.faEmpty();
  const R = ['p5-a', 'p5-b', 'p5-c', 'p5-d', 'p5-e', 'p6-x:1', 'p6-x:2', 'p7-y:0', 'p7-y:1', 'p5-f'], xs = [1, 1, 0, 1, 1, 1, 0, 0, 1, 0];
  R.forEach((k, i) => { fa = X.faAdd(fa, k, 300, xs[i], 't'); });
  const acc = { params: PARAMS, fa, today: 300, now: '2026-10-28T00:00:00Z', done: { R: true } };
  const d0 = X.display(acc);
  eq([d0.R.show, d0.R.raw.est, d0.R.est, d0.R.lo, d0.R.hi, d0.R.kind, d0.R.n, d0.R.band], [true, 285, 285, 205, 365, 'num', 10, 'advanced'], '跟回歸基準同一組作答');
  eq([d0.L.show, d0.L.need, d0.total], [false, { n: 20, kind: 'any' }, null]);
  eq(d0.snapshot, { ip: 'ip-test', cv: 'c-test', at: '2026-10-28T00:00:00Z', L: null, R: [285, 205, 365, 10] });
  const keep = X.display(Object.assign({}, acc, { prev: { ip: 'ip-test', cv: 'c-test', at: 'x', R: [290, 0, 0, 9] } }));
  eq([keep.R.est, keep.R.lo, keep.R.hi, keep.R.raw.est, keep.R.band], [290, 210, 370, 285, 'advanced'], '差 5 分沿用 290');
  const move = X.display(Object.assign({}, acc, { prev: { ip: 'ip-test', cv: 'c-test', at: 'x', R: [295, 0, 0, 9] } }));
  eq(move.R.est, 285, '差 10 分就換');
  const ver = X.display(Object.assign({}, acc, { prev: { ip: 'ip-old', cv: 'c-test', at: 'x', R: [290, 0, 0, 9] } }));
  eq(ver.R.est, 285, '難度版本換了不沿用');
  ['l1-a', 'l1-b', 'l2-a', 'l2-b', 'l2-c', 'l2-d', 'l3-z:0', 'l3-z:1', 'l3-z:2'].forEach((k, i) => { fa = X.faAdd(fa, k, 300, i % 3 ? 1 : 0, 't'); });
  const both = X.display(Object.assign({}, acc, { fa, done: { L: true, R: true } }));
  assert.ok(both.total && both.total.est === both.L.est + both.R.est, '兩科都有數字才有總分');
  const low = X.display(Object.assign({}, acc, { fa: R.reduce((f, k) => X.faAdd(f, k, 300, 0, 't'), X.faEmpty()) }));
  eq([low.R.kind, low.R.est < 150], ['low', true], '150 以下');
  const self = X.display({ params: PARAMS, fa: X.faEmpty(), today: 300, now: 'n', self: { L: { score: 400, months: 3 } } });
  eq([self.L.show, self.R.show], [true, false], '自填成績那一科顯示');
  throws(() => X.display({ params: PARAMS, fa: X.faEmpty(), today: 1.5, now: 'n' }), /日數/);
};

/* ---------- 補強:各級機率、壞資料、常數、平滑與四級、排除、補回日期、總分上緣、題數不一、這次檢測的結果 ---------- */
/* 用很窄的先驗把後驗放在單一格:那一格的原始分數在切點上方、取 5 的倍數會落到切點(例如閱讀 271.4 → 270),各級機率要照原始分數 */
T['各級機率:每格用原始分數對級,不先取 5 的倍數'] = () => {
  let hit = 0;
  ['L', 'R'].forEach((sec) => X.scoreGrid(PARAMS, sec).forEach((s, g) => {
    const raw = X.bandOf(sec, s);
    if (raw === X.bandOf(sec, Math.round(s / 5) * 5)) return;
    hit++;
    const one = X.summarize(PARAMS, sec, X.logPost({ mu: X.GRID[g], sd: 1e-3 }, []), 0);
    near(one.pb[X.LEVELS.indexOf(raw)], 1, 1e-9, sec + ' 第 ' + g + ' 格 ' + s.toFixed(2));
  }));
  assert.ok(hit >= 3, '切點附近的格只有 ' + hit + ' 格');
};

T['估分:第一次作答紀錄混了壞筆不丟錯,結果跟整理過的一樣;對錯存成 true/false 照 1/0 算'] = () => {
  let fa = X.faEmpty();
  ['p5-a', 'p5-b', 'p5-c', 'p5-d', 'p5-e', 'l2-a', 'l2-b'].forEach((k, i) => { fa = X.faAdd(fa, k, 300, i % 2, 't'); });
  const bad = { 'p5-f': null, 'p5-g': 'x', 'p5-h': [300, true, 'p'], 'p5-i': ['300', 1, 'p'], 'p5-j': [300, 1, 'z'], 'l2-c': [300, false, 'l'], 'l2-d': [300, 1] };
  const dirty = { v: 1, i: Object.assign({}, fa.i, bad) };
  const acc = { params: PARAMS, today: 300, now: 'n', done: { L: true, R: true } };
  const a = X.display(Object.assign({}, acc, { fa: dirty }));
  eq(a, X.display(Object.assign({}, acc, { fa: X.faNormalize(dirty) })), '跟整理過的一樣');
  eq([a.R.n, a.L.n], [6, 3], '閱讀 5 筆 + true 那筆;聽力 2 筆 + false 那筆');
  eq(X.evidence(PARAMS, dirty, 'R', 300).list.filter((e) => e.key === 'p5-h')[0].x, 1);
  eq([X.faEntry([300, false, 'l']), X.faEntry([300, 1, 'z'])], [[300, 0, 'l'], null]);
};

T['證據:各來源的權重(課程前測 1);刷題、聽力一次、重播改速、補回算練習;看過的筆不計分'] = () => {
  const one = (src) => X.evidence(PARAMS, X.faAdd(X.faEmpty(), 'p5-a', 300, 1, src), 'R', 300);
  eq(['t', 'k', 'g', 'p', 'l', 'r', 'h'].map((s) => one(s).list[0].w), [1, 1, 1, 0.8, 0.8, 0.5, 0.7]);
  eq(['t', 'k', 'g', 'p', 'l', 'r', 'h'].map((s) => one(s).f), [0, 0, 0, 1, 1, 1, 1], '練習佔權重比例');
  eq(['o', 'c'].map((s) => one(s).n), [0, 0], '看過的來源就算存成答對也不計分');
};

/* 資訊量排名用 rankUnits 自己排;換很多種子挑,挑得到的剛好是前 5(題組前 3) */
T['選題:單題前 5 每一題都挑得到、第 6 以後挑不到;題組前 3 組都挑得到、第 4 組以後挑不到'] = () => {
  const b = {}, singles = [], groups = [];
  for (let k = 0; k < 8; k++) { b['s' + k] = -0.3 + 0.2 * k; singles.push({ id: 's' + k, part: '5', keys: ['s' + k] }); }
  for (let k = 0; k < 6; k++) {
    b['g' + k + ':1'] = -0.3 + 0.3 * k; b['g' + k + ':2'] = -0.2 + 0.3 * k;
    groups.push({ id: 'g' + k, part: '6', keys: ['g' + k + ':1', 'g' + k + ':2'] });
  }
  const P = Object.assign({}, PARAMS, { b });
  [[singles, 5], [groups, 3]].forEach(([units, top]) => {
    const seen = new Set();
    for (let i = 0; i < 400; i++) seen.add(X.pickUnit({ params: P, units, theta: 0, seed: 'u' + i, runAt: 'r', slot: i % 7 }).id);
    const ranked = X.rankUnits({ params: P, units, theta: 0, seed: 'u0' }).map((u) => u.id);
    eq(Array.from(seen).sort(), ranked.slice(0, top).sort(), '前 ' + top);
  });
};

T['顯示:數字差不到 10 分沿用上次,但四級照新算的數字(跨切點時看得出來)'] = () => {
  const acc = { params: PARAMS, fa: X.faEmpty(), today: 300, now: 'n', self: { R: { score: 270, months: 0 } } };
  const d0 = X.display(acc);
  eq([d0.R.raw.est, d0.R.band], [275, 'advanced'], '新算 275');
  const d1 = X.display(Object.assign({}, acc, { prev: { ip: 'ip-test', cv: 'c-test', at: 'x', R: [270, 0, 0, 0] } }));
  eq([d1.R.est, d1.R.band, X.bandOf('R', 270)], [270, 'advanced', 'threshold'], '顯示沿用 270,四級還是照 275');
};

T['選題排除:呼叫的一方只給這次出過的組 id 也排除;總分上緣 990;題數不一的題組沒給 size 就擋下來'] = () => {
  eq(X.available({ params: PARAMS, units: UNITS, part: '6', fa: X.faEmpty(), used: ['p6-x'] }), [], '只給組 id');
  eq(X.available({ params: PARAMS, units: UNITS, part: '6', fa: X.faEmpty(), used: [] }).length, 1);
  eq(X.total({ est: 495, srand: 0, sys: 0 }, { est: 495, srand: 0, sys: 0 }), { est: 990, h: 35, lo: 990 - 35, hi: 990 });
  const g = (id, n) => ({ id, part: '7', keys: Array.from({ length: n }, (_, i) => id + ':' + i) });
  const mixed = [g('a', 2), g('b', 4)], same = [g('a', 3), g('b', 3)];
  throws(() => X.planSlots([{ part: '7' }], () => mixed), /size/);
  eq(X.planSlots([{ part: '7' }, { part: '7' }], () => same).total, 6);
  eq(X.planSlots([{ part: '7', size: 4 }], () => [mixed[1]]).total, 4);
};

T['補回舊 28 題:做完的日期照 finishedAt,沒有才用 startedAt'] = () => {
  const d = Object.assign(shapeOf(15, mulberry(5)), { startedAt: '2026-09-01T02:00:00Z', finishedAt: '2026-09-03T02:20:00Z' });
  eq(X.backfill(X.faEmpty(), { diag: d, legacy: LEGACY, now: NOW }).i['d5-01'][0], X.dayNum(Date.parse('2026-09-03T02:20:00Z')));
  const noEnd = Object.assign({}, d, { finishedAt: undefined });
  eq(X.backfill(X.faEmpty(), { diag: noEnd, legacy: LEGACY, now: NOW }).i['d5-01'][0], X.dayNum(Date.parse('2026-09-01T02:00:00Z')));
};

/* 這次檢測的結果只用這次的作答:以前檢測的 t 作答不能混進來 */
T['這次檢測的結果:runFa 只取這次某一科有作答的題,估分不混以前檢測的作答'] = () => {
  const r = run('2026-11-25T01:00:00Z', '2026-11-25T01:20:00Z', [['R', 'p5-a', 0, 1, 10], ['R', 'p5-b', 1, 0, 9], ['L', 'l2-a', 0, 1, 5], ['R', 'p5-c', 2, null, 3]]);
  eq(X.runFa(r, 'R', 328), { v: 1, i: { 'p5-a': [328, 1, 't'], 'p5-b': [328, 0, 't'] } });
  eq(X.runFa(r, 'L', 328), { v: 1, i: { 'l2-a': [328, 1, 't'] } });
  let all = X.runFa(r, 'R', 328);
  ['p5-d', 'p5-e', 'p5-f'].forEach((k) => { all = X.faAdd(all, k, 200, 0, 't'); });
  const now = X.estimate(PARAMS, 'R', { fa: X.runFa(r, 'R', 328), today: 328 });
  eq([now.n, X.estimate(PARAMS, 'R', { fa: all, today: 328, sources: 't' }).n], [2, 5]);
  throws(() => X.runFa({}, 'R', 1), /items/);
};

/* 作答紀錄的 t 是最後一次作答:學習記錄已經沒有這題(60 天前清掉),前測又出現時,作答紀錄那天比前測早,前測不算第一次 */
T['補回:作答紀錄有、學習記錄沒有、課程前測有:作答紀錄那天比前測早就記看過(o),不是前測的 k;作答紀錄比前測晚才留 k'] = () => {
  const d = (ms) => X.dayNum(ms);
  const hist = [{ m: 'g', id: 'g-1', c: 0, ok: true, t: NOW - 20 * DAY }];
  const records = { drill_p5: { 'p5-a': { c: 1, ok: true, t: NOW - 100 * DAY }, 'p5-b': { c: 0, ok: true, t: NOW - DAY } } };
  const rows = [{ key: 'p5-a', day: d(NOW - 2 * DAY), ok: 1, src: 'k' }, { key: 'p5-b', day: d(NOW - 2 * DAY), ok: 0, src: 'k' }];
  const fa = X.backfill(X.faEmpty(), { hist, records, rows, now: NOW });
  eq(fa.i['p5-a'], [d(NOW - 100 * DAY), null, 'o'], '以前做過:看過');
  eq(fa.i['p5-b'], [d(NOW - 2 * DAY), 0, 'k'], '前測之後才在刷題做:前測是第一次');
  eq(X.backfillStats(X.faEmpty(), { hist, records, rows, now: NOW }), { g: 0, k: 1, h: 0, l: 0, r: 0, o: 1, cut: true }, '作答紀錄比學習記錄早:截斷');
};
/* 模擬考答錯的題(mock_wrong)不寫學習記錄:補回時記看過,之後在刷題第一次碰到也不算第一次;不拿來判斷學習記錄有沒有被截斷 */
T['補回:模擬考答錯的題記看過(o,日數是模擬考那天);比它早的刷題紀錄照舊;不影響截斷判斷'] = () => {
  const d = (ms) => X.dayNum(ms);
  const hist = [{ m: 'p5', id: 'p5-b', c: 0, ok: false, t: NOW - 9 * DAY }];
  const mock = { 'p5-a': { c: 1, ok: false, t: NOW - 30 * DAY }, 'p5-b': { c: 2, ok: false, t: NOW - 3 * DAY }, bad: 'x' };
  const fa = X.backfill(X.faEmpty(), { hist, mock, now: NOW });
  eq(fa.i, { 'p5-a': [d(NOW - 30 * DAY), null, 'o'], 'p5-b': [d(NOW - 9 * DAY), 0, 'h'] });
  eq(X.backfillStats(X.faEmpty(), { hist, mock, now: NOW }).cut, false, '模擬考比學習記錄早不算截斷');
};
/* 一次補很多筆:不能每筆複製整份(以前 1500 筆要好幾百毫秒) */
T['補回:1500 筆學習記錄一次補完夠快,結果跟逐筆 faAdd 一樣'] = () => {
  const hist = Array.from({ length: 1499 }, (_, i) => ({ m: 'p5', id: 'p5-q' + i, c: 0, ok: i % 2 === 0, t: NOW - DAY + i }));
  const t0 = Date.now();
  const fa = X.backfill(X.faEmpty(), { hist, now: NOW });
  const ms = Date.now() - t0;
  let slow = X.faEmpty();
  hist.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((h) => { slow = X.faAdd(slow, h.id, X.dayNum(h.t), h.ok ? 1 : 0, 'h'); });
  eq(X.faNormalize(fa), X.faNormalize(slow));
  assert.ok(ms < 100, '補 1499 筆花了 ' + ms + ' 毫秒');
  return ms + ' 毫秒';
};
/* 後驗每一格的 log 機率照 (b, c) 只算一次;結果要跟逐格呼叫 prob 一樣 */
T['後驗:快取每題的 log 機率後,結果跟逐格算一模一樣;988 筆證據的後驗夠快'] = () => {
  const pri = X.prior(PARAMS, 'R');
  const evid = EV_R.concat(EV_R.map((e) => Object.assign({}, e, { w: e.w / 2 })));
  const lp = X.logPost(pri, evid);
  const ref = new Float64Array(X.GRID.length);
  X.GRID.forEach((t, g) => {
    ref[g] = -Math.pow(t - pri.mu, 2) / (2 * pri.sd * pri.sd);
    evid.forEach((e) => { const p = X.prob(t, e.b, e.c); ref[g] += e.w * (e.x ? Math.log(p) : Math.log(1 - p)); });
  });
  eq(Array.from(lp), Array.from(ref));
  const many = Array.from({ length: 988 }, (_, i) => ev(-2 + (i % 41) * 0.1, i % 3 ? 0.25 : 1 / 3, i % 2, 0.8));
  const t0 = Date.now();
  for (let k = 0; k < 5; k++) X.logPost(pri, many);
  const ms = (Date.now() - t0) / 5;
  assert.ok(ms < 40, '988 筆一次 ' + ms + ' 毫秒');
  return ms.toFixed(1) + ' 毫秒';
};

/* ---------- 檔案本身 ---------- */
const INTERNAL = /\u7ad9\u9577|\u7db2\u7ad9\u4e3b\u4eba|\u898f\u683c|\u6846\u67b6|\u5be9\u67e5|\u6311\u932f|\u65b9\u6848|\u6a21\u64ec\u5831\u544a|\u5de5\u4f5c\u5305|\u4ee3\u7406|\u8a55\u5206\u8005|AI ?\u8a55|\x47PT|\b[A-Z]:[\\/]|Users[\\/]|\u00a7|@[a-z0-9-]+\.[a-z]/g;
const BANNED_UI = /\u6e96\u78ba|\u9032\u6b65|\u4fdd\u8b49|\u5206\u6578\u5340\u9593|\u63db\u7b97|\u5b98\u65b9|\u8003\u5230|\u6703\u62ff\u5230/g;
T['檔案:不碰畫面、儲存、亂數、現在時間;每檔 ≤800 行;不出現內部用語、人名信箱與 repo 外路徑;介面字串不用禁用字'] = () => {
  FILES.forEach((f) => {
    const src = read(f), code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    eq(code.match(/\bdocument\b|localStorage|sessionStorage|\bstore\b|\bfetch\b|indexedDB|\bCLOUD\b|Math\.random|Date\.now|new Date\(\)/g) || [], [], f);
    assert.ok(src.split('\n').length <= 800, f + ' 超過 800 行');
    eq(src.match(INTERNAL) || [], [], f + ' 內部用語');
    const strings = code.match(/'[^'\n]*'|`[^`]*`/g) || [];
    eq(strings.join(' ').match(BANNED_UI) || [], [], f + ' 字串');
  });
  eq(read('tools/test_estimate.js').match(INTERNAL) || [], [], '測試檔');
  assert.ok(read('tools/test_estimate.js').split('\n').length <= 800);
  assert.ok(Object.isFrozen(X), '對外的物件凍結');
};

/* ---------- 執行 ---------- */
let pass = 0, fail = 0;
Object.keys(T).forEach((name) => {
  try { const d = T[name](); pass++; console.log('PASS ' + name + (d ? '  (' + d + ')' : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e)); }
});
console.log('\n' + pass + ' 通過,' + fail + ' 失敗');
process.exit(fail ? 1 : 0);
