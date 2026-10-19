/* 小雞第二階段:整頁跑(js/pet-roam2.js;規格 小雞第二階段規格.md 第 1、2 節、附錄 A.1、A.9;實作契約第 5 節)。
   用法:node tools/test_pet_roam2.js
   - util 的純計算:freeSpans(可點的東西間隔 8 px、文字圖片卡片 4 px、整排沒空位)、sideColumns(兩側空白 80 px 門檻)、
     leanFor(最多 11 度、中段最斜、頭尾 0、60 px 以下照比例)、flyFrames(照 ChickArt.flyPlan、2.5 秒上限、飛不到就不去)。
   - obstaclesOf 配一個很小的假 DOM:附錄 A.1 的可以點的東西、計算後 cursor: pointer、文字、圖片、卡片、略過自己那一層。
   - 原始碼檢查:不讀寫 localStorage、不碰 PET_STORE、不讀網址參數、sessionStorage 只用 pet_roam_x、設定集中在一個凍結的物件。
   - 開機:缺 PET_UI 或舊版引擎、頁面上已經有舊的 .pet-roam 時什麼都不做;App 模式放在分頁列前面,DOM 照契約。
   瀏覽器裡的行為(地面高度、站點、點擊穿過、淡出)由 scratchpad 的 Chrome 檢查看,不進 repo。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const FILE = path.join(REPO, 'js/pet-roam2.js');
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.log('FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name, { got: a, want: b }); }
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);

/* ---------- 載入 ---------- */
let SRC = '';
try { SRC = fs.readFileSync(FILE, 'utf8'); } catch (e) { SRC = ''; }
ok(SRC.length > 0, 'js/pet-roam2.js 存在');

function loadUtil() {
  const mod = { exports: {} };
  const ctx = { module: mod, console, Math, JSON, Object, Array, Number, String, Set, Map, Infinity, NaN, isFinite, parseFloat };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'pet-roam2.js' });
  return mod.exports;
}
let U = null, CFG = null;
try { const m = loadUtil(); U = m.util || null; CFG = m.CFG || null; } catch (e) { console.log('載入失敗:', e.message); }
ok(!!U, 'node 拿得到 util');

/* 引擎的 flyPlan(從 js/chick-art.js 載入,不用自己抄一份) */
function loadPlan() {
  const ctx = { window: {}, console, Math, JSON, Object, Array, Number, String };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'js/chick-art.js'), 'utf8'), ctx);
  return ctx.window.ChickArt;
}
const ART = loadPlan();
const PLAN = ART.flyPlan;
ok(Array.isArray(PLAN) && PLAN.length >= 6, '引擎有 flyPlan');

function run(name, f) { try { f(); } catch (e) { fail++; console.log('FAIL ' + name + ' 丟錯: ' + (e && e.stack || e)); } }

/* ---------- 設定集中在一個凍結的物件 ---------- */
run('設定', () => {
  ok(!!CFG && Object.isFrozen(CFG), '設定物件凍結');
  if (!CFG) return;
  eq([CFG.flyChance, CFG.flyAfter, CFG.perchMin, CFG.perchMax], [0.3, 4000, 8000, 20000], '飛:30%、4 秒、停 8 到 20 秒');
  eq([CFG.failChance, CFG.failEvery], [0.05, 180000], '試飛失敗 0.05、最多每 3 分鐘');
  eq([CFG.hopMax, CFG.hopDur], [80, 0.4], '小跳 80 px、0.4 秒');
  eq([CFG.scrollIdle, CFG.mutThrottle, CFG.fade], [150, 250, 200], '捲動停 150、節流 250、淡出 200 毫秒');
  eq([CFG.flyMax, CFG.fallMax, CFG.leanMax, CFG.leanFull], [2.5, 1.2, 11, 60], '飛 2.5 秒、落 1.2 秒、斜 11 度、60 px');
  eq([CFG.size, CFG.padI, CFG.padO, CFG.sideMin, CFG.gap, CFG.webLift], [48, 8, 4, 80, 16, 4], '尺寸與間隔');
});

/* ---------- freeSpans ---------- */
run('freeSpans', () => {
  const F = U.freeSpans;
  const S = 48;
  eq(F([], 0, 300, 100, 151, S), [[0, 300]], '沒有障礙:整條');
  // 可以點的東西:左右各 8 px,再扣掉小雞自己的寬度
  const btn = { l: 100, t: 120, r: 140, b: 140, p: 8, k: 'i' };
  eq(F([btn], 0, 300, 100, 151, S), [[0, 44], [148, 300]], '按鈕:間隔 8 px');
  const txt = { l: 100, t: 120, r: 140, b: 140, p: 4, k: 't' };
  eq(F([txt], 0, 300, 100, 151, S), [[0, 48], [144, 300]], '文字:間隔 4 px');
  const card = { l: 100, t: 120, r: 140, b: 140, p: 4, k: 'c' };
  eq(F([card], 0, 300, 100, 151, S), [[0, 48], [144, 300]], '卡片:間隔 4 px');
  // 上下:按鈕在框上方 8 px 以內也擋;文字在框上方不另加間隔(框的上緣本來就留了頭頂的空)
  eq(F([{ l: 100, t: 80, r: 140, b: 95, p: 8, k: 'i' }], 0, 300, 100, 151, S), [[0, 44], [148, 300]], '按鈕在上方 5 px:擋');
  eq(F([{ l: 100, t: 80, r: 140, b: 91, p: 8, k: 'i' }], 0, 300, 100, 151, S), [[0, 300]], '按鈕在上方 9 px:不擋');
  eq(F([{ l: 100, t: 80, r: 140, b: 99, p: 4, k: 't' }], 0, 300, 100, 151, S), [[0, 300]], '文字在框上方:不擋');
  eq(F([{ l: 100, t: 154, r: 140, b: 170, p: 4, k: 't' }], 0, 300, 100, 151, S), [[0, 48], [144, 300]], '文字在框下方 3 px:擋');
  eq(F([{ l: 100, t: 156, r: 140, b: 170, p: 4, k: 't' }], 0, 300, 100, 151, S), [[0, 300]], '文字在框下方 5 px:不擋');
  eq(F([{ l: 100, t: 156, r: 140, b: 170, p: 8, k: 'i' }], 0, 300, 100, 151, S), [[0, 44], [148, 300]], '按鈕在框下方 5 px:擋');
  // 整排沒空位
  eq(F([{ l: -20, t: 100, r: 400, b: 150, p: 8, k: 'i' }], 0, 300, 100, 151, S), [], '整排都是按鈕:沒有空位');
  eq(F([{ l: 0, t: 100, r: 120, b: 150, p: 4, k: 't' }, { l: 130, t: 100, r: 400, b: 150, p: 4, k: 't' }], 0, 300, 100, 151, S), [], '兩段文字中間 10 px:站不下');
  // 重疊、排序不影響
  const a = { l: 200, t: 110, r: 220, b: 140, p: 8, k: 'i' }, b2 = { l: 40, t: 110, r: 60, b: 140, p: 4, k: 't' };
  eq(F([a, b2], 0, 400, 100, 151, S), F([b2, a], 0, 400, 100, 151, S), '順序不影響');
  eq(F([a, b2], 0, 400, 100, 151, S), [[64, 144], [228, 400]], '兩個障礙');
  // 不改輸入
  const obs = Object.freeze([Object.freeze({ l: 1, t: 110, r: 9, b: 140, p: 8, k: 'i' })]);
  F(obs, 0, 300, 100, 151, S);
  ok(true, '凍結的輸入不丟錯');
  ok(U.clearAt([btn], 30, 100, 151, S) && !U.clearAt([btn], 45, 100, 151, S) && U.clearAt([btn], 148, 100, 151, S), 'clearAt 跟 freeSpans 一致');
});

/* ---------- 兩側空白 ---------- */
run('sideColumns', () => {
  const C = U.sideColumns;
  eq(C(200, 1240, 1440), [{ side: 'left', lo: 16, hi: 136 }, { side: 'right', lo: 1256, hi: 1376 }], '1440 寬:兩側都是站點');
  eq(C(80, 1360, 1440), [{ side: 'left', lo: 16, hi: 16 }, { side: 'right', lo: 1376, hi: 1376 }], '剛好 80 px:站得下');
  eq(C(79, 1361, 1440), [], '79 px:不算');
  eq(C(20, 1004, 1024), [], '1024 寬:沒有兩側空白');
  eq(C(90, 1300, 1320), [{ side: 'left', lo: 16, hi: 26 }], '只有一邊夠寬:只算那一邊');
});

/* ---------- 往前進的方向斜 ---------- */
run('leanFor', () => {
  const L = U.leanFor;
  ok(near(L(200, 0.5), 11), '橫移夠多:中段 11 度', L(200, 0.5));
  ok(near(L(-200, 0.5), -11), '往左:負的');
  ok(near(L(200, 0), 0) && Math.abs(L(200, 1)) < 1e-9, '頭尾回正');
  ok(near(L(30, 0.5), 5.5), '橫移 30 px:照比例 5.5 度', L(30, 0.5));
  ok(near(L(60, 0.5), 11), '60 px:剛好 11 度');
  ok(L(0, 0.5) === 0 || Object.is(L(0, 0.5), -0), '沒橫移:不斜');
  let max = 0, at = 0;
  for (let i = 0; i <= 100; i++) { const v = Math.abs(L(500, i / 100)); if (v > max) { max = v; at = i; } }
  ok(max <= 11 + 1e-9 && at === 50, '最斜在中段、不超過 11 度', { max, at });
  ok(near(L(200, -1), 0) && near(L(200, 2), 0), '進度超出範圍:夾回 0 到 1');
});

/* ---------- 飛行的格與位移 ---------- */
run('flyFrames', () => {
  const FF = U.flyFrames;
  const f = FF(600, PLAN);
  ok(!!f, '600 px 飛得到');
  ok(f.n / 12 <= 2.5 + 1e-9 && near(f.dur, f.n / 12), '不超過 2.5 秒', f && f.dur);
  ok(f.cum.length === f.n + 1 && f.cum[0] === 0 && near(f.cum[f.n], -600, 1e-6), '總位移剛好到站點', f && f.cum[f.n]);
  let planOk = true;
  for (let i = 0; i < f.n; i++) {
    const p = PLAN[i % PLAN.length];
    if (f.frames[i][0] !== p[0] || f.frames[i][1] !== (p[1] + Math.floor(i / PLAN.length)) % 2) planOk = false;
    const d = f.cum[i + 1] - f.cum[i];
    if (Math.sign(d) !== Math.sign(p[2])) planOk = false;          // 下拍往上、上拍往下、失速往下
    if (p[2] > 0 && !near(d, p[2])) planOk = false;               // 往下沉的拍照引擎的位移
  }
  ok(planOk, '格號、抖動組、每一拍的方向照 flyPlan');
  const short = FF(100, PLAN);
  ok(short.n >= 8 && short.n <= 12, '短距離至少 8 拍、最多 1 秒', short && short.n);
  ok(FF(0, PLAN) === null && FF(-10, PLAN) === null, '不是往上:不飛');
  ok(near(CFG.flyMax * 12, FF(CFG.maxRise, PLAN).n), '最遠飛得到的距離用滿 2.5 秒');
  ok(FF(CFG.maxRise + 1, PLAN) === null, '超過 2.5 秒飛不到:不去', CFG.maxRise);
  ok(CFG.maxRise >= 700, '從分頁列飛到標題(手機約 620 px)飛得到', CFG.maxRise);
  ok(FF(400, PLAN).n === 30 && FF(160, PLAN).n === 12, '每秒 160 px 的節奏,1 到 2.5 秒');
});

/* ---------- 量障礙(附錄 A.1),配很小的假 DOM ---------- */
function fakeEl(tag, o) {
  o = o || {};
  const attrs = Object.assign({}, o.attrs || {});
  const cls = (o.cls || '').split(/\s+/).filter(Boolean);
  const e = {
    tagName: tag.toUpperCase(), parentElement: o.parent || null,
    style: Object.assign({ display: 'block', visibility: 'visible', opacity: '1', cursor: 'auto', backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none', boxShadow: 'none', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px',
      borderTopStyle: 'none', borderRightStyle: 'none', borderBottomStyle: 'none', borderLeftStyle: 'none',
      borderTopColor: 'rgb(0, 0, 0)', borderRightColor: 'rgb(0, 0, 0)', borderBottomColor: 'rgb(0, 0, 0)', borderLeftColor: 'rgb(0, 0, 0)' }, o.style || {}),
    rect: Object.assign({ left: 10, top: 10, right: 50, bottom: 30 }, o.rect || {}),
    texts: o.texts || [],
    classList: { contains: (c) => cls.includes(c) },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
    contains(n) { while (n) { if (n === e) return true; n = n.parentElement; } return false; },
  };
  e.rect.width = e.rect.right - e.rect.left; e.rect.height = e.rect.bottom - e.rect.top;
  return e;
}
const ENV = (own) => ({
  skip: (e) => !!(own && own.includes(e)),
  style: (e) => e.style,
  rect: (e) => e.rect,
  textRects: (e) => e.texts.map((r) => Object.assign({ width: r.right - r.left, height: r.bottom - r.top }, r)),
});
const ALL = { text: true, media: true, cards: true };
function kinds(list, o, own) { return U.obstaclesOf(list, o || ALL, ENV(own)).map((x) => x.k + x.p); }
run('obstaclesOf', () => {
  const page = fakeEl('div', { style: { backgroundColor: 'rgb(246, 248, 250)' } });
  const mk = (tag, o) => fakeEl(tag, Object.assign({ parent: page }, o || {}));
  // 附錄 A.1:可以點的東西一律 8 px
  const clickables = [mk('a'), mk('a', { attrs: { href: 'x.html' } }), mk('button'), mk('input'), mk('select'), mk('textarea'), mk('label'), mk('summary'),
    mk('details'), mk('video'), mk('audio'), mk('iframe'), mk('canvas'), mk('div', { attrs: { draggable: 'true' } }), mk('div', { attrs: { contenteditable: '' } }),
    mk('div', { attrs: { contenteditable: 'true' } }), mk('span', { attrs: { role: 'button' } }), mk('span', { attrs: { role: 'link' } }), mk('span', { attrs: { role: 'tab' } }),
    mk('span', { attrs: { role: 'checkbox' } }), mk('span', { attrs: { role: 'radio' } }), mk('span', { attrs: { role: 'switch' } }), mk('div', { attrs: { tabindex: '0' } }),
    mk('div', { cls: 'game-field' }), mk('div', { style: { cursor: 'pointer' } })];
  clickables.forEach((e, i) => eq(kinds([e]), ['i8'], '可以點的 #' + i + ' ' + e.tagName));
  eq(kinds([mk('div', { attrs: { tabindex: '-1' } })]), [], 'tabindex=-1 不算可以點');
  eq(kinds([mk('div', { attrs: { contenteditable: 'false' } })]), [], 'contenteditable=false 不算');
  eq(kinds([mk('div', { attrs: { draggable: 'false' } })]), [], 'draggable=false 不算');
  // 文字、圖片、卡片 4 px
  eq(kinds([mk('img')]), ['m4'], '圖片');
  eq(kinds([mk('svg')]), ['m4'], 'svg 圖示');
  eq(kinds([mk('progress')]), ['m4'], '進度條');
  eq(kinds([mk('img')], { text: true, media: false, cards: true }), [], '不看圖片時略過');
  eq(kinds([mk('p', { texts: [{ left: 0, top: 0, right: 30, bottom: 16 }, { left: 0, top: 18, right: 20, bottom: 34 }] })]), ['t4', 't4'], '文字一行一個框');
  eq(kinds([mk('div', { style: { backgroundColor: 'rgb(255, 255, 255)' } })]), ['c4'], '白底卡片');
  eq(kinds([mk('div', { style: { backgroundColor: 'rgb(246, 248, 250)' } })]), [], '跟外層同色:不是卡片');
  eq(kinds([mk('div', { style: { borderTopWidth: '1px', borderTopStyle: 'solid' } })]), ['c4'], '有框線:卡片');
  eq(kinds([mk('div', { style: { boxShadow: '0 1px 2px #000' } })]), ['c4'], '有陰影:卡片');
  eq(kinds([mk('div', { style: { backgroundColor: 'rgba(255, 255, 255, 0.02)' } })]), [], '幾乎透明:不是卡片');
  eq(kinds([mk('div', { style: { backgroundColor: 'rgb(255, 255, 255)' } })], { text: true, media: true, cards: false }), [], '不看卡片時略過');
  // 看不見的、自己那一層、站的那張卡片
  eq(kinds([mk('button', { style: { display: 'none' } })]), [], 'display:none 略過');
  eq(kinds([mk('button', { style: { visibility: 'hidden' } })]), [], 'visibility:hidden 略過');
  eq(kinds([mk('button', { style: { opacity: '0.01' } })]), [], '透明略過');
  const mine = mk('button');
  eq(kinds([mine], ALL, [mine]), [], '自己那一層略過');
  const anchor = mk('div', { style: { backgroundColor: 'rgb(255, 255, 255)' }, texts: [{ left: 0, top: 0, right: 10, bottom: 10 }] });
  const outer = mk('section', { style: { backgroundColor: 'rgb(255, 255, 255)' } });
  anchor.parentElement = outer;
  eq(U.obstaclesOf([anchor, outer], Object.assign({ anchor }, ALL), ENV()).map((x) => x.k + x.p), ['t4'], '站的那張:只有自己的文字算,包著它的卡片不算');
  const ob = U.obstaclesOf([mk('button', { rect: { left: 5, top: 6, right: 25, bottom: 46 } })], ALL, ENV())[0];
  eq([ob.l, ob.t, ob.r, ob.b], [5, 6, 25, 46], '外框照 getBoundingClientRect');
  eq(kinds([mk('button', { rect: { left: 5, top: 6, right: 5.2, bottom: 46 } })]), [], '0 寬略過');
});

/* ---------- 取樣點 ---------- */
run('samplePoints', () => {
  const pts = U.samplePoints(100, 164, 40, 107, 12, 1000, 800);
  const has = (x, y) => pts.some((p) => near(p[0], x, 0.6) && near(p[1], y, 0.6));
  ok(has(100, 40) && has(164, 40) && has(100, 107) && has(164, 107) && has(132, 73.5), '四角加中心(附錄 A.1)', pts.slice(0, 6));
  ok(pts.every((p) => p[0] >= 0 && p[0] < 1000 && p[1] >= 0 && p[1] < 800), '都在視窗裡');
  ok(U.samplePoints(-50, 30, -10, 20, 12, 1000, 800).every((p) => p[0] >= 0 && p[1] >= 0), '超出視窗的夾回來');
  ok(pts.length <= 80, '取樣點有上限(不列舉全頁)', pts.length);
});

/* ---------- 原始碼:不碰學生資料、不留後門 ---------- */
run('原始碼', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  ok(!/localStorage/.test(code), '不讀寫 localStorage');
  ok(!/PET_STORE/.test(code), '不碰 PET_STORE');
  ok(!/location\.(search|hash|href)|URLSearchParams|\?pet/.test(code), '不讀網址參數');
  ok(!/\bstore\.(get|set)\b|CLOUD/.test(code), '不碰 store、CLOUD');
  const keys = (code.match(/sessionStorage\.(getItem|setItem|removeItem)\(([^,)]+)/g) || []).map((s) => s.replace(/.*\(/, ''));
  ok(keys.length > 0 && keys.every((k) => /^(KEY|'pet_roam_x')$/.test(k.trim())), 'sessionStorage 只用 pet_roam_x', keys);
  ok(/KEY\s*=\s*'pet_roam_x'/.test(code) || !/\bKEY\b/.test(code), 'KEY 是 pet_roam_x');
  ok(/try\s*\{[^}]*sessionStorage/.test(code), 'sessionStorage 讀寫包 try/catch');
  ok(!/forceFly|forceFail|__roamProto|roamProtoCfg/.test(code), '沒有原型的測試入口');
  const rest = code.replace(/const CFG = Object\.freeze\(\{[\s\S]*?\}\);/, '');
  ok(!/(flyChance|failChance|flyAfter|perchMin|perchMax|failEvery)\s*[:=]/.test(rest) && /CFG\.flyChance/.test(rest) && /CFG\.failChance/.test(rest), '機率和時間只寫在設定物件裡');
  const lines = SRC.split('\n').length;
  ok(lines <= 800, '800 行以內', lines);
  console.log('  js/pet-roam2.js:' + lines + ' 行,' + Buffer.byteLength(SRC, 'utf8') + ' bytes(規格 A.9 目標 15 KB)');
});

/* ---------- css/style.css 裡 roam 那一塊:開關關著時不作用;<html> 也有 pet-roam2 這個 class,規則不能套到 <html> ---------- */
function cssProblems(block) {
  const out = [];
  const body = block.replace(/\/\*[\s\S]*?\*\//g, '');
  const sels = [];
  body.replace(/([^{};]+)\{/g, (m, s) => { s = s.trim(); if (!/^@/.test(s)) sels.push(...s.split(',').map((x) => x.trim())); return m; });
  for (const s of sels) {
    if (!/pet-roam2/.test(s)) out.push('沒掛在 pet-roam2 底下:' + s);
    if (/(^|[\s>+~])\.pet-roam2(?![\w-])/.test(s)) out.push('會套到 <html>:' + s);
  }
  return out;
}
run('CSS', () => {
  const css = fs.readFileSync(path.join(REPO, 'css/style.css'), 'utf8');
  const a = css.indexOf('/* ======== 小雞第二階段:roam(js/pet-roam2.js)開始 ======== */'), b = css.indexOf('/* ======== 小雞第二階段:roam 結束 ======== */');
  ok(a >= 0 && b > a, 'style.css 有 roam 那一塊(開始、結束標記)');
  if (a < 0 || b < a) return;
  const block = css.slice(a, b);
  eq(cssProblems(block), [], '每一條都掛在 pet-roam2 底下,而且不會套到 <html>');
  ok(cssProblems('.pet-roam2 { pointer-events: none; }').length === 1 && cssProblems('.x { color: red; }').length === 1, '檢查本身抓得到錯');
  ok(/html\.app-shell\.has-tabbar\.pet-roam2 \.pet-card\.pet-me:not\(\[hidden\]\) \{ display: grid; \}/.test(block), 'App 模式「我的」那一區顯示出來');
  ok(/div\.pet-roam2\.is-air \{[^}]*z-index: 49/.test(block) && /div\.pet-roam2\.is-ground \{[^}]*z-index: 91/.test(block), '站點層 49、地面層 91');
  ok(/html\.pet-roam2:not\(\.app-shell\) div\.pet-roam2\.is-ground \{[^}]*z-index: 49/.test(block), '網站模式的地面層 49:頂端導覽列(50)的下拉選單、個人選單蓋在小雞上面');
  ok(/prefers-reduced-motion/.test(block) && /@media print/.test(block), '減少動態、列印各自處理');
  ok(css.slice(0, a).indexOf('pet-roam2') < 0, '檔尾那一塊以外沒有 pet-roam2');
});

/* ---------- 開機:很小的假瀏覽器 ---------- */
function fakeBrowser(o) {
  o = o || {};
  const all = [];
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.kids = []; this.parentNode = null; this.attrs = {}; this.style = {}; this.on = {}; this.hidden = false; this.inert = false; this._cls = [];
      const self = this;
      this.classList = {
        add: (...c) => c.forEach((x) => { if (!self._cls.includes(x)) self._cls.push(x); }),
        remove: (...c) => { self._cls = self._cls.filter((x) => !c.includes(x)); },
        contains: (c) => self._cls.includes(c),
        toggle: (c, on) => { const want = on === undefined ? !self._cls.includes(c) : !!on; if (want) self.classList.add(c); else self.classList.remove(c); return want; },
      };
      all.push(this);
    }
    get className() { return this._cls.join(' '); }
    set className(v) { this._cls = String(v).split(/\s+/).filter(Boolean); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    set tabIndex(v) { this.attrs.tabindex = String(v); }
    append(...ns) { ns.forEach((n) => { n.parentNode = this; this.kids.push(n); }); }
    before(n) { const p = this.parentNode; n.parentNode = p; p.kids.splice(p.kids.indexOf(this), 0, n); }
    after(n) { const p = this.parentNode; n.parentNode = p; p.kids.splice(p.kids.indexOf(this) + 1, 0, n); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
    getClientRects() { return []; }
    matches() { return false; }
    closest() { return null; }
    focus() { doc.activeElement = this; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
  }
  const doc = { readyState: 'complete', visibilityState: 'visible', activeElement: null, on: {} };
  const html = new El('html'), body = new El('body'), main = new El('main'), footer = new El('footer');
  (o.htmlClass || []).forEach((c) => html.classList.add(c));
  html.clientWidth = 375; doc.documentElement = html; doc.body = body; body.parentNode = html;
  body.append(main, footer);
  let tabbar = null;
  if (o.tabbar) { tabbar = new El('nav'); tabbar.classList.add('app-tabbar'); body.append(tabbar); tabbar.getClientRects = () => (o.bar && o.bar.shown ? [{ top: 760 }] : []); }
  let old = null;
  if (o.old) { old = new El('div'); old.classList.add('pet-roam'); body.append(old); }
  doc.createElement = (t) => new El(t);
  doc.querySelector = (s) => (s === '.app-tabbar' ? tabbar : s === '.pet-roam' ? old : s === 'main' ? main : s === 'footer' ? footer : null);
  doc.querySelectorAll = (s) => (o.qsa ? o.qsa(s) : []);
  doc.addEventListener = (t, f) => { (doc.on[t] = doc.on[t] || []).push(f); };
  doc.elementsFromPoint = () => [];
  const subs = [], rafs = [], winOn = {}, anim = { stops: 0, poses: [], shows: 0 }, ios = [], timers = [];
  const win = {
    /* o.random:從載入那一刻就固定機率(載入時 onChange 馬上回呼一次,5% 的試飛失敗會在換掉 Math 之前就發生) */
    document: doc, console, Math: o.random === undefined ? Math : Object.assign(Object.create(Math), { random: () => o.random }), JSON, Object, Array, Number, String, Set, Map, Infinity, NaN, isFinite, parseFloat, Date,
    location: { pathname: '/' + (o.page || 'index.html') },
    innerHeight: 812, scrollY: 0, scrollX: 0,
    performance: { now: () => (o.clock ? o.clock.t : 0) },
    setTimeout: (fn, ms) => { if (!o.timers) return 0; timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: (f) => { rafs.push(f); return rafs.length; }, cancelAnimationFrame() {},
    addEventListener(t, f) { (winOn[t] = winOn[t] || []).push(f); },
    getComputedStyle: () => ({ paddingLeft: '0px', paddingRight: '0px', display: 'block', visibility: 'visible', opacity: '1', cursor: 'auto' }),
    sessionStorage: { getItem: () => null, setItem() {} },
    MutationObserver: class { observe() {} },
    IntersectionObserver: class { constructor(cb) { ios.push(cb); } observe() {} },
  };
  if (o.ui !== false) {
    win.PET_UI = { reduced: false, mood: () => 'idle', label: () => '小黃，連續 5 天', view: () => ({ on: true, status: { hungry: false } }),
      onChange: (f) => { subs.push(f); f({ on: true, status: { hungry: false }, roam: true }, {}); }, openSheet() {} };
  }
  if (o.art !== false) {
    win.ChickArt = { version: o.artVersion || 5, metrics: { width: 240, height: 280, ground: 254 }, calm: { idle: 1 }, fps: {}, holds: () => [1], flyPlan: PLAN,
      animate: () => ({ pose: 'idle', setPose(p) { this.pose = p; anim.poses.push(p); }, setFps() {}, show(k, v, p) { anim.shows++; anim.shown = p; }, stop() { anim.stops++; } }) };
  }
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SRC, win, { filename: 'pet-roam2.js' });
  const runRaf = (t) => { const l = rafs.splice(0); l.forEach((f) => f(t === undefined ? 0 : t)); };
  const fire = (t, detail) => (winOn[t] || []).forEach((f) => f({ type: t, detail }));
  const change = (v, ev) => subs.forEach((f) => f(v, ev || {}));
  const fireDoc = (t) => (doc.on[t] || []).forEach((f) => f({ type: t }));
  return { win, doc, html, body, main, tabbar, all, anim, runRaf, fire, fireDoc, change, ios, timers };
}
run('開機', () => {
  const none = fakeBrowser({ ui: false, page: 'index.html' });
  ok(!none.win.PET_ROAM2 && !none.html.classList.contains('pet-roam2') && !none.all.some((e) => e.classList.contains('pet-roam2')), '沒有 PET_UI:什麼都不做');
  const v4 = fakeBrowser({ artVersion: 4, page: 'index.html' });
  ok(!v4.win.PET_ROAM2 && !v4.html.classList.contains('has-pet'), '引擎是第四版:什麼都不做');
  const old = fakeBrowser({ old: true, tabbar: true, htmlClass: ['app-shell', 'has-tabbar', 'is-tab-root'], page: 'index.html' });
  ok(!old.win.PET_ROAM2 && !old.all.some((e) => e.classList.contains('pet-roam2')), '已經有舊的 .pet-roam:什麼都不做');
  const prac = fakeBrowser({ page: 'grammar.html' });
  ok(!prac.win.PET_ROAM2 && !prac.html.classList.contains('pet-roam2'), '網站模式的練習頁:不放');
  const shellNoBar = fakeBrowser({ htmlClass: ['app-shell'], page: 'index.html' });
  ok(!shellNoBar.win.PET_ROAM2, 'App 模式沒有分頁列:不放');

  const app = fakeBrowser({ tabbar: true, htmlClass: ['app-shell', 'has-tabbar', 'is-tab-root'], page: 'learn.html' });
  const layer = app.body.kids.find((e) => e.classList.contains('pet-roam2'));
  ok(!!layer, 'App 模式:放了一層');
  if (layer) {
    ok(app.body.kids.indexOf(layer) === app.body.kids.indexOf(app.tabbar) - 1, '放在分頁列前面');
    ok(layer.classList.contains('is-ground') && !layer.getAttribute('role') && !layer.getAttribute('aria-label'), '外層:地面、沒有角色和文字');
    const btn = layer.kids[0];
    ok(btn && btn.tagName === 'BUTTON' && btn.classList.contains('pet-roam2-btn') && btn.getAttribute('type') === 'button' && btn.getAttribute('aria-haspopup') === 'dialog', '按鈕');
    ok(btn && btn.getAttribute('aria-label') === '小黃，連續 5 天，打開餵食', '按鈕標籤加上「打開餵食」', btn && btn.attrs);
    const cv = btn && btn.kids[0];
    ok(cv && cv.tagName === 'CANVAS' && cv.classList.contains('pet-roam2-cv') && cv.getAttribute('aria-hidden') === 'true', '畫布 aria-hidden');
  }
  ok(app.html.classList.contains('pet-roam2') && app.html.classList.contains('has-pet'), '<html> 加 pet-roam2、has-pet');
  ok(app.win.PET_ROAM === true, 'window.PET_ROAM = true');
  const R = app.win.PET_ROAM2;
  ok(!!R && R.version === 1 && !!R.util && typeof R.util.freeSpans === 'function', 'PET_ROAM2 有 version、util');
  if (R) {
    const s = R.state;
    ok(s && s.mode === 'app' && s.ground === true && s.flying === false && s.faded === false && typeof s.x === 'number' && 'pose' in s && 'perch' in s, 'state 快照', s);
    const fns = Object.keys(R).filter((k) => k !== 'util' && typeof R[k] === 'function');
    eq(fns, [], 'PET_ROAM2 沒有會改行為的函式');
    let threw = false;
    try { R.state.x = 999; } catch (e) { threw = true; }
    ok(R.state.x !== 999, 'state 改不動', threw);
  }

  const web = fakeBrowser({ page: 'me.html' });
  const wl = web.body.kids.find((e) => e.classList.contains('pet-roam2'));
  ok(!!wl && web.body.kids.indexOf(wl) === web.body.kids.indexOf(web.main) + 1, '網站模式:放在 main 後面、頁尾前面');
  ok(web.win.PET_ROAM2 && web.win.PET_ROAM2.state.mode === 'web', '網站模式的 state');
  const again = web.all.length;
  vm.runInContext(SRC, web.win);
  ok(web.all.length === again, '載入兩次不會有第二隻');
});

run('這一層畫不出來時停住(App 模式分頁列藏起來的寬視窗、小雞關掉)', () => {
  const bar = { shown: false };
  const app = fakeBrowser({ tabbar: true, bar, htmlClass: ['app-shell', 'has-tabbar', 'is-tab-root'], page: 'learn.html', random: 0.99 });
  const layer = app.body.kids.find((e) => e.classList.contains('pet-roam2'));
  const R = app.win.PET_ROAM2;
  app.runRaf();
  const p0 = app.anim.poses.length;
  ok(R && R.state.off === true && layer.classList.contains('is-off'), '分頁列沒畫出來(寬視窗):off、整層 is-off', R && R.state);
  ok(app.anim.stops > 0, '分頁列沒畫出來:引擎停下來', app.anim);
  app.fire('resize');
  ok(app.anim.poses.length === p0 && R.state.off === true, '還是畫不出來時視窗變動:不走動、不換姿勢', app.anim.poses.slice(p0));
  bar.shown = true;
  app.fire('resize');
  ok(R.state.off === false && !layer.classList.contains('is-off') && app.anim.poses.length > p0, '視窗變窄、分頁列畫出來:恢復走動', R.state);
  const s1 = app.anim.stops;
  app.change({ on: false, status: { hungry: false }, roam: true });
  ok(layer.hidden === true && R.state.off === true && app.anim.stops > s1, '小雞關掉(整層 hidden):停下來', R.state);
  app.change({ on: true, status: { hungry: false }, roam: true });
  ok(layer.hidden === false && R.state.off === false, '小雞打開:恢復', R.state);
  bar.shown = false;
  app.fire('orientationchange');
  ok(R.state.off === true, '轉向後分頁列不見:停下來', R.state);

  const web = fakeBrowser({ page: 'me.html' });
  web.runRaf();
  ok(web.win.PET_ROAM2.state.off === false, '網站模式沒有分頁列:照常走動', web.win.PET_ROAM2.state);
});

/* 第二輪審查:進頁第一格還沒放好位置就畫出來;靜止的小雞被滑鼠停住、鍵盤焦點時又開始抖 */
run('進頁:第一次排好位置之前整層看不到(is-init),排好以後才拿掉', () => {
  const app = fakeBrowser({ tabbar: true, bar: { shown: true }, htmlClass: ['app-shell', 'has-tabbar', 'is-tab-root'], page: 'me.html' });
  const layer = app.body.kids.find((e) => e.classList.contains('pet-roam2'));
  ok(!!layer && layer.classList.contains('is-init'), '剛放進頁面:is-init', layer && layer.className);
  app.runRaf();
  ok(!!layer && !layer.classList.contains('is-init'), '第一個畫面排好以後:拿掉 is-init', layer && layer.className);
  const css = fs.readFileSync(path.join(REPO, 'css/style.css'), 'utf8');
  ok(/div\.pet-roam2\.is-init \.pet-roam2-btn \{[^}]*opacity: 0[^}]*transition: none/.test(css), 'css:is-init 時按鈕透明、不做淡出淡入');
});
run('靜止的小雞(練習頁、關掉走動):滑鼠停住、鍵盤焦點都畫靜止格,不換回會抖的姿勢', () => {
  const hover = (b, on) => (b.on[on ? 'pointerenter' : 'pointerleave'] || []).forEach((f) => f({ pointerType: 'mouse' }));
  const prac = fakeBrowser({ tabbar: true, bar: { shown: true }, htmlClass: ['app-shell', 'has-tabbar'], page: 'grammar.html' });
  prac.runRaf();
  const btn = prac.all.find((e) => e.classList.contains('pet-roam2-btn'));
  ok(prac.win.PET_ROAM2.state.still === true, '練習頁:still');
  let p0 = prac.anim.poses.length, s0 = prac.anim.shows;
  hover(btn, true);
  ok(prac.anim.poses.length === p0 && prac.anim.shows > s0, '練習頁滑鼠停住:不 setPose,畫靜止格', { poses: prac.anim.poses.slice(p0), shows: prac.anim.shows - s0 });
  p0 = prac.anim.poses.length;
  hover(btn, false);
  ok(prac.anim.poses.length === p0, '練習頁滑鼠離開:還是靜止格', prac.anim.poses.slice(p0));
  (btn.on.focus || []).forEach((f) => f({}));
  ok(prac.anim.poses.length === p0, '練習頁拿到焦點:不 setPose', prac.anim.poses.slice(p0));

  // 不試飛、不飛(機率從載入就固定),姿勢只看停住與否
  const main = fakeBrowser({ tabbar: true, bar: { shown: true }, htmlClass: ['app-shell', 'has-tabbar', 'is-tab-root'], page: 'learn.html', random: 0.99 });
  main.runRaf();
  main.change({ on: true, status: { hungry: false }, roam: false });
  const b2 = main.all.find((e) => e.classList.contains('pet-roam2-btn'));
  ok(main.win.PET_ROAM2.state.still === true, '關掉走動:still');
  const q0 = main.anim.poses.length;
  hover(b2, true);
  ok(main.anim.poses.length === q0, '關掉走動、滑鼠停住:不 setPose', main.anim.poses.slice(q0));
  main.change({ on: true, status: { hungry: false }, roam: true });
  const q1 = main.anim.poses.length;
  hover(b2, false); hover(b2, true);
  ok(main.anim.poses.length > q1, '走動打開、滑鼠停住:照常換成待機姿勢(停下來)', main.anim.poses.slice(q1));
});

/* ---------- 第三輪審查:中止動作後回到地面(#6 落下來到一半、#7 地面上跳到一半)、觸控留下的焦點不擋淡出(#3) ---------- */
const rectOf = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t });
const OFFSCREEN = rectOf(0, 2000, 300, 2100), ONSCREEN = rectOf(0, 300, 300, 400);
/* 一頁:時間可以撥、計時器記下來、有一張 .pet-card(card.r 是它現在的位置)、學習頁標題右邊是站點;App 模式分頁列上緣在 760 */
function roamPage(page, o) {
  o = o || {};
  const clock = { t: 0 }, card = { hidden: false, r: OFFSCREEN };
  card.getBoundingClientRect = () => card.r;
  const h1 = { tagName: 'H1', isConnected: true, parentElement: null, getAttribute: () => null, classList: { contains: () => false }, closest: () => null,
    getBoundingClientRect: () => rectOf(64, 54, 375, 150) };
  const qsa = (s) => (s === '.pet-card' ? [card] : s === 'main h1' ? [h1] : []);
  const app = !o.web;
  const P = fakeBrowser(Object.assign({ page, clock, timers: true, qsa, random: o.random === undefined ? 0.99 : o.random }, app ?{ tabbar: true, bar: { shown: true }, htmlClass: ['app-shell', 'has-tabbar', 'is-tab-root'] } : {}));
  if (app) P.tabbar.getBoundingClientRect = () => rectOf(0, 760, 375, 812);
  const btn = P.all.find((e) => e.classList.contains('pet-roam2-btn'));
  const ty = () => { const m = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(btn.style.transform || ''); return m ? +m[2] : NaN; };
  const at = (t) => { clock.t = t; P.runRaf(t); };
  const V = { on: true, status: { hungry: false }, roam: true };
  /* 中止的三種方式:切到背景再回來、打開小雞面板再關掉、有小雞的卡片捲進畫面(淡出)再捲出去 */
  function cut(how) {
    if (how === 'hidden') { P.doc.visibilityState = 'hidden'; P.fireDoc('visibilitychange'); P.doc.visibilityState = 'visible'; P.fireDoc('visibilitychange'); }
    if (how === 'sheet') { P.change(V, { sheet: true }); P.change(V, { sheet: false }); }
    if (how === 'fade') { card.r = ONSCREEN; P.ios.forEach((f) => f([])); card.r = OFFSCREEN; P.ios.forEach((f) => f([])); }
  }
  return Object.assign(P, { clock, card, btn, ty, at, cut, V, R: P.win.PET_ROAM2 });
}
run('第三輪審查 #7:地面上試飛失敗跳到一半被中止(切到背景、打開面板、淡出),回來時腳踩在地面上,不浮在分頁列上面', () => {
  for (const how of ['hidden', 'sheet', 'fade']) {
    const P = roamPage('index.html', { random: 0.01 });   // 剛進頁還不能飛,5% 的試飛失敗一定發生
    P.at(0);
    P.at(300);   // 起飛 0.125 秒之後往上 30 px 的那一段
    const mid = P.ty();
    P.cut(how);
    ok(mid < -10 && P.ty() === 0 && P.R.state.ground === true, '試飛失敗跳到一半、' + how + ':回來時 y 是 0', { mid, after: P.ty(), state: P.R.state });
    P.at(5000);
    ok(P.ty() === 0, '試飛失敗跳到一半、' + how + ':之後走動也在地面上', P.ty());
  }
});
run('第三輪審查 #6:從站點撲著翅膀落回地面到一半被中止(切到背景、淡出、打開面板),回來時在地面上,不卡在半空', () => {
  for (const how of ['hidden', 'fade', 'sheet']) {
    const P = roamPage('learn.html', { random: 0.01 });
    P.at(5000);   // 停了 4 秒以上:30% 的飛一定發生
    const up = P.R.state.flying;
    P.at(9000);   // 飛完、站上標題右邊
    const perched = P.R.state.perch === 'main h1' && !P.R.state.ground;
    const pe = P.timers.filter((t) => t.fn && t.fn.name === 'perchEnd').pop();
    if (pe) pe.fn();   // 站的時間到了,開始落
    P.at(9300);
    const falling = P.R.state.flying && !P.R.state.ground;
    P.cut(how);
    const s = P.R.state;
    ok(up && perched && !!pe && falling && s.ground === true && s.perch === null && s.flying === false && P.ty() === 0,
      '落到一半、' + how + ':回來時在地面上', { up, perched, pe: !!pe, falling, state: s, y: P.ty() });
  }
});
/* chick2 第二輪修正 #6:站的時間到了的那一刻,站點上正在播一小段動作(拿到點心開心跳一下、站點上的小跳)。
   以前 descend() 先清掉計時器、看到正在播就直接回去,之後沒有人再排下一次,小雞一直站在站點上 */
run('chick2 第二輪修正 #6:站的時間到了時站點上正在播開心跳一下,播完過一下照樣落回地面,不會一直站著', () => {
  const P = roamPage('learn.html', { random: 0.01 });
  P.at(5000);
  P.at(9000);   // 飛完、站上標題右邊
  const perched = P.R.state.perch === 'main h1' && !P.R.state.ground;
  const ends = () => P.timers.filter((t) => t.fn && t.fn.name === 'perchEnd');
  const n0 = ends().length;
  P.fire('pet:earn', { result: 'got' });   // 開心跳一下,正在播
  P.at(9050);
  const playing = P.anim.shown === 'happy';
  ends().pop().fn();   // 站的時間剛好到了
  const rearmed = ends().length === n0 + 1;
  const still = P.R.state.perch === 'main h1';
  P.at(12000);   // 開心那一段播完
  const re = ends().pop();
  if (rearmed) re.fn();
  for (let t = 12100; t <= 16000; t += 100) P.at(t);
  const s = P.R.state;
  ok(perched && playing && rearmed && still && s.ground === true && s.perch === null && P.ty() === 0,
    '站點上播開心時站的時間到了:重排一次,之後落回地面', { perched, playing, rearmed, still, state: s, y: P.ty() });
});
run('第三輪審查 #3:點小雞(觸控、滑鼠)留下的焦點沒有焦點框,有小雞的卡片回到畫面時照樣淡出;鍵盤焦點才不淡出,焦點離開就補淡出', () => {
  const P = roamPage('me.html', { web: true });
  P.at(0);
  ok(P.R.state.faded === false, '卡片不在畫面上:不淡出');
  (P.btn.on.click || []).forEach((f) => f({}));
  P.change(P.V, { sheet: true }); P.change(P.V, { sheet: false });
  P.btn.focus(); (P.btn.on.focus || []).forEach((f) => f({}));   // pet-ui 把焦點放回小雞;觸控沒有焦點框
  P.card.r = ONSCREEN; P.ios.forEach((f) => f([]));
  ok(P.doc.activeElement === P.btn && P.R.state.faded === true && P.btn.inert === true, '觸控關掉面板、卡片捲回畫面:淡出(畫面上只有一隻)', P.R.state);

  const K = roamPage('me.html', { web: true });
  K.at(0);
  K.btn.matches = (s) => s === ':focus-visible';   // 鍵盤移過來,看得到焦點框
  K.btn.focus(); (K.btn.on.focus || []).forEach((f) => f({}));
  K.card.r = ONSCREEN; K.ios.forEach((f) => f([]));
  ok(K.R.state.faded === false, '鍵盤焦點在小雞上:不淡出', K.R.state);
  K.doc.activeElement = K.body; K.btn.matches = () => false; (K.btn.on.blur || []).forEach((f) => f({}));
  ok(K.R.state.faded === true && K.btn.inert === true, '焦點離開:馬上補淡出,不用等下一次捲動', K.R.state);
});

console.log((fail ? 'FAILED' : 'OK') + ' pet-roam2:' + pass + ' 通過,' + fail + ' 失敗');
process.exit(fail ? 1 : 0);
