/* 走動的小雞放大(Bonnie 2026-10-23:「小雞要大一點 現在好小」「About 2x」):js/pet-roam2.js、css/style.css。
   用法:node tools/test_pet_roam_size.js
   - 每種模式一個數字(CFG.sizes):App 分頁列上 96、網站模式 1023 以下 96;電腦版到處走照視窗寬分段(1440 以上 110、1344 以上 94、1328 以上 86、1312 以上 78、1296 以上 70、其他 62);框高照引擎的比例。
   - 兩側空白的門檻、空地、站點、落地前的再確認、可以點的範圍一律照現在的大小算;載入時、拖完視窗(CFG.resizeEnd)換大小,一次只重開一次引擎(畫布照 DPR 重配)。
   - css:按鈕和地面那一條照 --pet2-w、--pet2-h,頁面底部留白(網站模式、App 模式)照 --pet2-h,最後的內容捲得到小雞上面。
   - 用 tools/pet_roam_sim.js 的假瀏覽器照檔案裡真的大小(size: 'real')跑五個主分頁 1024、1280、1366、1440、1920(另外 1152、1240、1270、每一段的下限、實際的視窗高):停著的時候不蓋到按鈕、卡片、文字,
     走、跳、飛的時候點擊穿過;印出量到幾塊空地和 10/20 的走法數字(改之前一律 110 的對照)。 */
const path = require('path');
const { ART, nodeLoad, ROAM, ZONES, Z, sim, site, wanderRun, obstaclesNow, read, WHITE, median } = require('./pet_roam_sim.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.log('FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 500) : ''));
}
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, { got: a, want: b });
function run(name, f) { try { f(); } catch (e) { fail++; console.log('FAIL ' + name + ' 丟錯: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } }
const M = ART.metrics, boxOf = (s) => Math.round(s * M.ground / M.width);
/* 障礙 o 有沒有碰到小雞框 [x, x+w]×[top, bot](可以點的四邊 8 px;文字、圖片、卡片左右下 4 px,框上緣本來就留了頭頂的空) */
const hitW = (o, x, w, top, bot) => o.l - o.p < x + w && o.r + o.p > x && o.t - o.p < bot && o.b + (o.k === 'i' ? o.p : 0) > top;

let mod = null;
try { mod = nodeLoad(ROAM); } catch (e) { mod = null; }
const CFG = mod && mod.CFG, U = mod && mod.util;

/* 電腦版到處走的大小照視窗寬(innerWidth,含捲軸)分段(10/23 晚上,主對話的決定;Bonnie 10/20「電腦板小雞也是要可以到處走」):
   1440 以上 110;以下挑學習、刷題頁還量得到 3 塊空地的最大值(每 8 px 一級)。無頭 Chrome 實測(10/24):主要內容 1040 寬置中(版面寬 cw 扣掉捲軸),
   兩側空白 mainL = (cw - 1040) / 2,兩側那一層要走得動 24 px:小雞寬 ≤ mainL - 48(js/pet-roam-zones.js 的 sideWalk、edgeIn、gap)。
   學習頁有捲軸(Windows 的 Chrome 15 px,算 17 px 留餘裕),所以一段的下限是 2 × 寬 + 1153:94 從 1344、86 從 1328、78 從 1312、70 從 1296;
   刷題頁卡片上緣 173、頂欄下緣 59:框高 102(96 px)以下才站得上那一層,所以 1440 以下最大 94。
   62 是最小的一段(約 1.3 倍),往下不再縮:學習頁約 1275(捲軸 15)以下、刷題頁 1260 以下多小(48、56 px 也只有 0 到 1 塊)都量不到 3 塊空地,
   主要內容貼著兩側、卡片都可以點(附錄 D 第八輪的 (3) 才有辦法),下面「規則的限制」那一項照實測寫成明確的預期(主對話待決定) */
const BANDS = [[1440, 110], [1344, 94], [1328, 86], [1312, 78], [1296, 70], [0, 62]];
const sizeAt = (W) => BANDS.find(([w]) => W >= w)[1];
const VH = { 1024: 768, 1152: 768, 1240: 800, 1256: 800, 1260: 800, 1270: 800, 1280: 800, 1296: 800, 1312: 800, 1328: 800, 1344: 800, 1365: 768, 1366: 768, 1439: 900, 1440: 900, 1536: 864, 1920: 1080 };
/* 實際的視窗高(扣掉工作列和瀏覽器的列,審查第 1 輪 #1):1280×690、1366×657、1440×790、1536×730(1920 寬 125% 縮放) */
const REAL_H = [[1280, 690], [1366, 657], [1440, 790], [1536, 730]];
const barOf = (name, W) => (name === 'index' || (name === 'learn' && W < 1920) ? 15 : 0);   // 實測:首頁、學習頁捲得動(學習頁 1920×1080 一頁放得下),Windows 的 Chrome 捲軸 15 px;刷題、複習、我的不捲
run('設定:每種模式一個數字,電腦版到處走照視窗寬分段', () => {
  eq(CFG && CFG.sizes, { app: 96, appLand: 64, web: 96, wide: BANDS }, 'CFG.sizes:App 96、App 橫放 64(審查第 2 輪 #4)、網站 96、電腦版到處走 [視窗寬下限, 大小]:1440 以上 110、1344 以上 94、1328 以上 86、1312 以上 78、1296 以上 70、其他 62');
  ok(BANDS.every(([w, S], i) => i === 0 || (w === 0 ? S === 62 : w >= 2 * S + 1153 && S <= 96 && S < BANDS[i - 1][1])), '每一段的下限:學習頁(捲軸 17 px)兩側那一層走得動(2 × 寬 + 1153 以上);1440 以下不超過 96(刷題頁頂欄下面那一層);越窄越小、最小 62');
  ok(!!CFG && Object.isFrozen(CFG.sizes) && Object.isFrozen(CFG.sizes.wide) && CFG.sizes.wide.every((b) => Object.isFrozen(b)) && !('size' in CFG) && !('sideMin' in CFG), '凍結(分段表也是);舊的 size、sideMin 拿掉(門檻照大小算)');
  ok(!!U && typeof U.sizeFor === 'function' && U.sizeFor(true, false) === 96 && U.sizeFor(true, true) === 96 && U.sizeFor(false, false) === 96 && U.sizeFor(false, true) === 110
    && U.sizeFor(true, false, true) === 64 && U.sizeFor(true, false, false) === 96 && U.sizeFor(false, false, true) === 96 && U.sizeFor(false, true, true) === 110, 'sizeFor(App, 電腦版到處走, 矮的橫放):橫放只在 App 模式換成 64;沒給視窗寬時電腦版 110');
  const got = [1920, 1440, 1439, 1366, 1344, 1343, 1328, 1327, 1312, 1311, 1296, 1295, 1280, 1024].map((w) => U.sizeFor(false, true, false, w));
  eq(got, [110, 110, 94, 94, 94, 86, 86, 78, 78, 70, 70, 62, 62, 62], 'sizeFor(..., 視窗寬):1440 以上 110,1344 到 1439 是 94,1328 起 86,1312 起 78,1296 起 70,1295 以下 62');
  ok(U.sizeFor(false, false, false, 1280) === 96 && U.sizeFor(true, false, false, 1280) === 96 && U.sizeFor(true, false, true, 1280) === 64, '不是電腦版到處走時不看視窗寬(窄的網站 96、App 96、App 橫放 64)');
  ok(!!CFG && CFG.resizeEnd >= 200 && CFG.resizeEnd <= 500, '拖動視窗停下多久才換大小(CFG.resizeEnd)在 200 到 500 毫秒', CFG && CFG.resizeEnd);
  ok(!!CFG && CFG.landH === 500, '橫放的門檻跟分頁列的 @media 一樣:視窗高 500 以下', CFG && CFG.landH);
  ok(!!CFG && !!CFG.tap && Object.isFrozen(CFG.tap) && CFG.tap.min === 44, '可以點的範圍比例在設定物件裡,最小 44', CFG && CFG.tap);
  eq([boxOf(96), boxOf(110), boxOf(94), boxOf(86), boxOf(78), boxOf(70), boxOf(62)], [102, 116, 99, 91, 83, 74, 66], '框高照引擎的比例:102、116、99、91、83、74、66');
  ok(96 / 48 === 2 && 110 / 48 > 2 && 110 / 48 < 2.4 && 62 / 48 > 1.25, '約 2 倍(App、窄的網站 2 倍,電腦版 1440 以上 2.3 倍);1295 以下的電腦版 1.3 倍');
});

run('兩側空白、空位照傳進來的大小算', () => {
  const C = U.sideColumns;
  eq(C(200, 1240, 1440, 110), [{ side: 'left', lo: 16, hi: 74 }, { side: 'right', lo: 1256, hi: 1314 }], '110:1440 寬兩側都站得下');
  eq(C(142, 1298, 1440, 110), [{ side: 'left', lo: 16, hi: 16 }, { side: 'right', lo: 1314, hi: 1314 }], '110:剛好 142 px(110 加兩邊各 16)站得下');
  eq(C(141, 1299, 1440, 110), [], '110:141 px 不算');
  eq(C(80, 1360, 1440, 48), [{ side: 'left', lo: 16, hi: 16 }, { side: 'right', lo: 1376, hi: 1376 }], '48:跟以前一樣 80 px 的門檻');
  eq(C(127, 1313, 1440, 96), [], '96:127 px 不算');
  const btn = { l: 100, t: 100, r: 140, b: 150, p: 8, k: 'i' };
  eq(U.freeSpans([btn], 0, 300, 100, 216, 110), [[148, 300]], 'freeSpans:110 寬的框,按鈕左邊 -18 以前才放得下');
  ok(!U.clearAt([btn], 0, 100, 216, 110) && U.clearAt([btn], 148, 100, 216, 110) && U.clearAt([btn], 0, 100, 216, 48) && !U.clearAt([btn], 50, 100, 216, 48), 'clearAt 照大小算(同一個位置 48 放得下、110 放不下)');
});

/* ---------- 假瀏覽器:照檔案裡真的大小 ---------- */
function narrowPage(W) {
  return (add) => {
    add(null, 'header', { cls: 'topbar', box: [0, 0, W, 59], fixed: true, style: WHITE });
    const main = add(null, 'main', { box: [16, 59, W - 16, 1300] });
    add(main, 'h1', { box: [16, 80, W - 16, 120], texts: [[16, 84, 150, 116]] });
    const c = add(main, 'section', { cls: 'part-card', box: [16, 140, W - 16, 400], style: WHITE, texts: [[32, 160, 200, 180]] });
    add(c, 'button', { box: [32, 340, 200, 380] });
    add(null, 'footer', { box: [0, 1320, W, 1500], style: { borderTopWidth: '1px', borderTopStyle: 'solid' } });
  };
}
const vars = (P) => [P.html.vars['--pet2-w'], P.html.vars['--pet2-h']];
run('App 模式 375 與 窄的網站模式:96 px、框高 102,css 變數寫在 <html>,引擎只開一次', () => {
  const app = sim({ src: ROAM, size: 'real', W: 375, H: 812, page: 'learn.html', app: true, htmlClass: ['app-shell', 'has-tabbar', 'is-tab-root'], build: narrowPage(375), seed: 2 });
  app.step(3000);
  const s = app.R();
  ok(s && s.size === 96 && s.boxH === 102, 'App:state.size 96、boxH 102', s);
  eq(app.anim.sizes, [96], 'App:引擎用 96 開一次');
  eq(vars(app), ['96px', '102px'], 'App:--pet2-w 96px、--pet2-h 102px');
  const b = app.box();
  ok(Math.abs(b.b - (812 - 52)) < 0.5 && b.r - b.l === 96 && b.b - b.t === 102, 'App:腳踩分頁列上緣,框 96×102', b);
  for (const W of [860, 1000]) {
    const web = sim({ src: ROAM, zones: ZONES, size: 'real', W, H: 900, page: 'review.html', build: narrowPage(W), seed: 3 });
    web.step(3000);
    ok(web.R().size === 96 && web.R().wide === false && JSON.stringify(vars(web)) === JSON.stringify(['96px', '102px']) && JSON.stringify(web.anim.sizes) === '[96]', '網站 ' + W + ':96 px', { s: web.R(), v: vars(web), sizes: web.anim.sizes });
  }
});
run('電腦版到處走 1440:110 px、框高 116;寬度跨過 1024 換大小、重開引擎,回來再換回來', () => {
  const P = sim({ src: ROAM, zones: ZONES, size: 'real', W: 1440, H: 900, page: 'learn.html', build: site('learn', 1440, 900), seed: 3 });
  P.step(3000);
  ok(P.R().wide === true && P.R().size === 110 && P.R().boxH === 116, '1440:wide、110、116', P.R());
  eq(vars(P), ['110px', '116px'], '1440:css 變數 110px、116px');
  eq(P.anim.sizes.slice(-1), [110], '1440:引擎用 110');
  P.resize(1000); P.step(2000);
  ok(P.R().wide === false && P.R().size === 96 && P.R().ground === true, '變成 1000 寬:96、回地面', P.R());
  eq(vars(P), ['96px', '102px'], '1000:css 變數跟著改');
  eq(P.anim.sizes.slice(-1), [96], '1000:引擎重開成 96');
  const n = P.anim.sizes.length;
  P.resize(1010); P.step(500);
  ok(P.anim.sizes.length === n, '大小沒變的視窗變動:不重開引擎', P.anim.sizes);
  P.resize(1440); P.step(2000);
  ok(P.R().size === 110 && vars(P)[0] === '110px' && P.anim.sizes[P.anim.sizes.length - 1] === 110, '變回 1440:110', { s: P.R(), sizes: P.anim.sizes });
});
run('電腦版到處走 1440 載入:引擎只用 110 開一次(不先用 96 開一次再換;審查第 1 輪 #9)', () => {
  for (const name of ['learn', 'index']) {
    const P = sim({ src: ROAM, zones: ZONES, size: 'real', W: 1440, H: 900, page: name + '.html', build: site(name, 1440, 900), seed: 4 });
    P.step(1000);
    eq(P.anim.sizes, [110], name + ' 1440:anim.sizes 只有 110');
  }
});
const webSim = (name, W, o) => { const bar = barOf(name, W), H = VH[W] || 900; return sim(Object.assign({ src: ROAM, zones: ZONES, size: 'real', W, H, bar, page: name + '.html', build: site(name, W - bar, H), seed: 2 }, o || {})); };
run('電腦版到處走照視窗寬分段:載入時就是那一段的大小,引擎只開一次,css 變數跟著', () => {
  for (const [W, name] of [[1920, 'learn'], [1440, 'learn'], [1440, 'drill'], [1439, 'drill'], [1366, 'learn'], [1366, 'drill'], [1365, 'drill'], [1344, 'learn'], [1328, 'drill'], [1312, 'learn'], [1296, 'drill'], [1280, 'learn'], [1280, 'drill'], [1280, 'index'], [1240, 'learn'], [1024, 'drill'], [1024, 'review'], [1024, 'me']]) {
    const P = webSim(name, W), S = sizeAt(W);
    P.step(1500);
    const tag = name + ' ' + W + (barOf(name, W) ? '(捲軸 15)' : '') + ':';
    ok(P.R().wide === true && P.R().size === S && P.R().boxH === boxOf(S), tag + '到處走、' + S + ' px、框高 ' + boxOf(S), P.R());
    eq(P.anim.sizes, [S], tag + '引擎只用 ' + S + ' 開一次');
    eq(vars(P), [S + 'px', boxOf(S) + 'px'], tag + 'css 變數');
  }
  for (const name of ['learn', 'index']) {
    const P = webSim(name, 1024);
    P.step(1500);
    ok(P.R().wide === false && P.R().size === 96 && JSON.stringify(P.anim.sizes) === '[96]', name + ' 1024(捲軸 15,版面 1009 不到 1024):照窄的網站 96,跟以前一樣不到處走', { s: P.R(), sizes: P.anim.sizes });
  }
});
/* 換大小只在載入、拖完視窗(最後一次 resize 之後 CFG.resizeEnd 毫秒)的時候;拖的途中跨過幾段都不換,一次拖動最多重開一次引擎(審查第 3 輪 #0 那種重開) */
function drag(P, from, to, H) {
  const d = to > from ? 8 : -8, seen = new Set();
  for (let w = from + d; d > 0 ? w < to : w > to; w += d) { P.resize(w, H); P.step(16); seen.add(P.R().size); }
  P.resize(to, H); P.step(16); seen.add(P.R().size);
  return seen;
}
run('拖動視窗:拖的途中大小不變,停下 CFG.resizeEnd 毫秒後換成新的那一段,一次拖動只重開一次引擎', () => {
  const R0 = CFG.resizeEnd;
  for (const [from, to] of [[1920, 1100], [1100, 1920], [1920, 1000], [1000, 1500], [1440, 1366], [1366, 1300], [1300, 1340]]) {
    const P = sim({ src: ROAM, zones: ZONES, size: 'real', W: from, H: 900, page: 'review.html', build: site('review', from, 900), seed: 3 });
    P.step(2500);
    const S0 = P.R().size, n0 = P.anim.sizes.length, S1 = to >= 1024 ? sizeAt(to) : 96;
    const seen = drag(P, from, to, 900), tag = from + ' → ' + to + ':';
    ok(seen.size === 1 && seen.has(S0) && P.anim.sizes.length === n0, tag + '拖的途中一直是 ' + S0, { seen: Array.from(seen), sizes: P.anim.sizes });
    P.step(R0 - 60);
    ok(P.R().size === S0, tag + '停下不到 ' + R0 + ' 毫秒還沒換', P.R());
    P.step(120);
    ok(P.R().size === S1 && vars(P)[0] === S1 + 'px', tag + '停下 ' + R0 + ' 毫秒後換成 ' + S1, { s: P.R(), v: vars(P) });
    P.step(3000);
    eq(P.anim.sizes.length - n0, S1 === S0 ? 0 : 1, tag + (S1 === S0 ? '同一段:沒有重開引擎' : '只重開一次引擎'));
    ok(P.anim.live <= 1, tag + '同時最多一個引擎計時器', P.anim.live);
  }
});
run('站在空地上時換了大小(1440 → 1280):回到地面,用新的大小重量空地,5 秒內再離開地面', () => {
  for (const seed of [1, 2, 3]) {
    const P = webSim('learn', 1440, { seed });
    let s = null;
    for (let t = 0; t < 40000; t += 100) { P.step(100); s = P.R(); if (!s.ground && s.zone && s.zone !== 'ground' && !s.move && !s.flying) break; }
    ok(!!s && !s.ground, '#' + seed + ' 1440:先站上一塊空地', s);
    P.resize(1280, 800, 15); P.step(CFG.resizeEnd + 40);
    const a = P.R();
    ok(a.size === 62 && a.ground === true && !a.flying && !a.move, '#' + seed + ' 換成 62 時回到地面', a);
    let up = -1;
    for (let t = 0; t < 5000 && up < 0; t += 100) { P.step(100); const q = P.R(); if (q.move || q.flying || !q.ground) up = t; }
    ok(up >= 0, '#' + seed + ' 5 秒內再離開地面', { up, s: P.R() });
    ok(P.R().zones > 0 && P.R().size === 62, '#' + seed + ' 用 62 量到空地', P.R());
  }
});
run('關掉走動、或減少動態時,寬度跨過 1024 換大小:新的引擎也停在靜止格,不跑計時器、不抖(審查第 1 輪 #7)', () => {
  for (const ui of [{ roam: false }, { reduced: true }]) {
    const tag = ui.roam === false ? '關掉走動' : '減少動態';
    const P = sim({ src: ROAM, zones: ZONES, size: 'real', W: 1000, H: 900, page: 'review.html', build: narrowPage(1000), seed: 5, ui });
    P.step(3000);
    const a0 = P.anim.ticks; P.step(3000);
    ok(P.anim.ticks === a0 && P.R().still === true, tag + ' 1000:靜止格,3 秒內引擎沒有跑', { ticks: P.anim.ticks - a0, s: P.R() });
    for (const W of [1440, 1000, 1440]) {
      P.resize(W); P.step(500);
      const t0 = P.anim.ticks; P.step(5000);
      ok(P.anim.ticks === t0 && P.R().still === true && P.layer.classList.contains('is-still') && P.R().size === (W > 1023 ? 110 : 96), tag + ' 換成 ' + W + ' 寬:新的引擎 5 秒內沒有跑', { ticks: P.anim.ticks - t0, s: P.R(), sizes: P.anim.sizes });
    }
  }
});

/* ---------- 五個主分頁:停著不蓋東西、移動中點擊穿過;量到幾塊空地 ---------- */
const PAGES = ['index', 'learn', 'drill', 'review', 'me'];
const WIDTHS = [1024, 1280, 1366, 1440, 1920];
/* size:'real'(檔案裡的分段)或一個數字(三種模式都改成那個數字;110 是 10/23 那一版的電腦版,當「改之前」) */
function zoneCount(name, W, size) {
  const P = webSim(name, W, { size, seed: 1 });
  P.step(6000);
  return P.R().zones;
}
/* 1024 不到處走、或量不到 3 塊空地的頁(實測,見最上面的說明):首頁、學習頁有捲軸,版面 1009 不到 1024,照窄的網站;刷題頁量不到空地 */
const WANDERS = (name, W) => !((name === 'index' && W - barOf(name, W) < 1024) || ((name === 'learn' || name === 'drill') && W - barOf(name, W) < 1260));   // 學習頁版面寬 1260(視窗約 1275)、刷題頁 1260 以下:下面「規則的限制」
run('五個主分頁 1024、1280、1366、1440、1920(照分段的大小):停著的時候不蓋到按鈕、卡片、文字;走、跳、飛的時候點擊穿過;框沒有跑出視窗', () => {
  const table = [];
  for (const W of WIDTHS) for (const name of PAGES) {
    if (W === 1024 && name !== 'review' && name !== 'me' && name !== 'drill') continue;
    const hits = [], taps = [], outside = [], H = VH[W], S = sizeAt(W), bar = barOf(name, W), CW = W - bar;
    let rest = 0, up = 0;
    for (const seed of [1, 2]) {
      wanderRun({ name, W, H, bar, seed, size: 'real', ms: 3 * 60 * 1000, mark: (Q, s) => {
        const b = Q.box(), w = b.r - b.l;
        const moving = !!s.move || s.flying || s.pose === 'walk' || s.pose === 'run';
        if (Math.abs(w - S) > 0.01) outside.push({ t: Q.st.t, w });
        if (b.l < 16 - 0.5 || b.r > CW - 16 + 0.5) outside.push({ t: Q.st.t, b });
        if (!s.ground && !moving) up++;
        /* 視窗下緣的地面是固定的一條,內容從牠底下捲過去(頁面底部留白讓最後的內容捲得上來),不算;整條橫幅是背景(同 zones 的 band) */
        if (!s.flying && !s.move && !s.ground) for (const q of obstaclesNow(Q)) {
          const stand = (q.k === 'c' && Math.abs(q.t - b.b) < 1.5) || (q.k === 'c' && q.r - q.l > 0.9 * CW);
          if (!stand && hitW(q, b.l, w, b.t, b.b)) { hits.push({ t: Q.st.t, b, q, zone: s.zone }); break; }
        }
        if (moving && Q.tappable()) taps.push({ t: Q.st.t, s });
        if (!moving && Q.tappable()) rest++;
      } });
    }
    const tag = name + ' ' + W + '(' + S + ' px):';
    ok(!hits.length, tag + '停著、走著的時候框不碰到障礙', hits.slice(0, 2));
    ok(!taps.length, tag + '走、跳、飛的時候點擊穿過', taps.slice(0, 2));
    ok(!outside.length, tag + '框 ' + S + ' 寬、在版面兩側 16 px 以內', outside.slice(0, 2));
    ok(rest > 100, tag + '停著的時候點得到', rest);
    table.push(name + ' ' + W + ' ' + Math.round(up / (2 * 1800) * 100));
  }
  console.log('  離開地面、停在空地上的時間比例(%):' + table.join(';'));
});
run('量到幾塊空地(改之前一律 110 → 照分段):1280、1366 的學習、刷題頁有 3 塊以上;1440 以下小雞變小,空地不會變少', () => {
  const rows = [];
  for (const W of WIDTHS) for (const name of PAGES) {
    const before = zoneCount(name, W, 110), after = zoneCount(name, W, 'real');
    rows.push(name + ' ' + W + ' ' + before + '→' + after);
    if ((W === 1280 || W === 1366) && (name === 'learn' || name === 'drill')) ok(after >= 3, name + ' ' + W + ':' + sizeAt(W) + ' px 量得到 3 塊以上', { before, after });
    if (W < 1440) ok(after >= before, name + ' ' + W + ':小雞變小,空地不會變少', { before, after });
    else ok(after === before, name + ' ' + W + ':1440 以上大小不變,空地數一樣', { before, after });
  }
  console.log('  空地數(110 px → 照分段):' + rows.join(';'));
});

/* ---------- 真的大小的走法數字(審查第 1 輪 #8):pet_roam_sim 沒給 size 時照 48 px 跑,這裡照檔案裡的大小釘住 10/20 的要求 ---------- */
function wanderStats(name, W, size, H) {
  const a = { minZones: Infinity, maxGround: 0, first: 0, stays: [], maxZ: 0, ground: 0 };
  for (const seed of [1, 2]) {
    const r = wanderRun({ name, W, H: H || VH[W], bar: barOf(name, W), seed, size, ms: 3 * 60 * 1000, mark: (Q, s) => { a.maxZ = Math.max(a.maxZ, s.zones); } });
    a.minZones = Math.min(a.minZones, r.minZones); a.maxGround = Math.max(a.maxGround, r.maxGround); a.ground = Math.max(a.ground, r.ground);
    a.first = Math.max(a.first, r.first < 0 ? Infinity : r.first); a.stays.push(...r.stays);
  }
  return a;
}
const fmt = (a) => a.minZones + ' 處/' + Math.round(a.maxGround * 100) + '%/' + (isFinite(a.first) ? (a.first / 1000).toFixed(1) + ' 秒' : '沒離開');
run('真的大小:1024 的複習、我的,1280 以上五個主分頁,照 10/20 的要求(任一段 60 秒去 3 個地方以上、在地面不到 3 成、5 秒內離開地面、每塊待 5 到 15 秒);印出改之前(110)對照', () => {
  const rows = [];
  for (const W of WIDTHS) for (const name of PAGES) {
    if (!WANDERS(name, W)) continue;
    const a = wanderStats(name, W, 'real'), b = W < 1440 ? wanderStats(name, W, 110) : a;
    rows.push(name + ' ' + W + ' ' + fmt(b) + ' → ' + fmt(a));
    const tag = name + ' ' + W + '(' + sizeAt(W) + ' px):';
    ok(a.minZones >= 3 && a.maxGround <= 0.3 && a.first >= 0 && a.first <= 5000, tag + '去 3 個地方以上、在地面不到 3 成、5 秒內離開地面', a);
    ok(median(a.stays) >= 5 && median(a.stays) <= 15, tag + '每塊空地停 5 到 15 秒', median(a.stays));
  }
  console.log('  任一段 60 秒最少去幾處/在地面最多幾成/第一次離開地面(改之前 110 → 照分段):' + rows.join(';'));
});
run('真的大小:忙的時候(一直按鍵)1280、1440、1920 的刷題、學習頁照樣在同一側換、5 秒內開始離開、不飛過主要內容那一欄', () => {
  const key3 = (o) => { let last = -1e9; return (Q) => { if (Q.st.t - last >= 3000) { last = Q.st.t; Q.fireDoc('keydown', { key: 'Shift' }); } if (o) o(Q); }; };
  for (const [W, H] of [[1280, 800], [1440, 900], [1920, 1080]]) for (const name of ['drill', 'learn']) for (const seed of [1, 2]) {
    const bar = barOf(name, W), L = Math.round((W - bar - 1040) / 2), R = L + 1040;
    let cross = 0, runAt = -1, runX = 0, upX = null;
    const r = wanderRun({ name, W, H, bar, seed, size: 'real', startX: Math.round(W / 2), ms: 150000, mark: key3((Q) => {
      const s = Q.R(), b = Q.box();
      if (runAt < 0 && s.ground && s.pose === 'run') { runAt = Q.st.t; runX = s.x; }
      if (upX === null && (s.move || s.flying || !s.ground)) upX = s.x;
      if ((s.move === 'fly' || s.move === 'fall') && b.r > L && b.l < R) cross++;
    }) });
    const go = runAt >= 0 ? runAt : r.first, need = runAt >= 0 ? Math.abs(upX - runX) / Z.CFG.runSpeed * 1000 + 2500 : 0;
    /* 刷題頁 110 px(1440 以上):卡片上緣那一層站不上去,一側只有頁尾上緣那一塊;忙的時候不飛過主要內容,只剩這一側和地面 2 個地方、地面約 3 成。
       這是規則的限制(主對話待決定:刷題頁也要 3 個地方就得 96 px 以下,或改頂欄下面的留空),這裡照現在的樣子寫成明確的預期 */
    const few = name === 'drill' && sizeAt(W) === 110;
    ok((few ? r.minZones >= 2 && r.ground <= 0.35 : r.minZones >= 3 && r.ground <= 0.3) && go >= 0 && go <= 5000 && r.first - go <= need + 1 && cross === 0, name + ' ' + W + ' #' + seed + '(' + sizeAt(W) + ' px,忙' + (few ? ',只有一側和地面' : '') + '):', { minZones: r.minZones, ground: r.ground, first: r.first, runAt, need, cross });
  }
});
/* 規則的限制(審查第 1 輪 #0、#3;主對話待決定):學習頁版面寬 1260 以下(視窗約 1275,捲軸 15)、刷題頁 1260 以下,主要內容貼著兩側、卡片都可以點,
   62 px 也量不到 3 塊空地(無頭 Chrome 實測 0 塊,48、56 px 也只有 0 到 1 塊),小雞大多在視窗下緣。要改得讓小雞站在可以點的卡片上緣(附錄 D 第八輪的 (3)),
   或接受這一段只在地面(要 Bonnie 同意)。這裡把現在的樣子寫成明確的預期,改了規則或大小這一項會變紅;1024 的學習頁有捲軸,版面 1009 不到 1024,照窄的網站 96 */
const DEAD = [[1024, 'drill'], [1152, 'learn'], [1152, 'drill'], [1240, 'learn'], [1240, 'drill'], [1256, 'drill'], [1270, 'learn']];
run('規則的限制:學習頁約 1275 以下、刷題頁 1260 以下 62 px 量不到 3 塊空地、9 成以上在地面、停著點得到;學習頁 1024 照窄的網站 96;邊界外 3 塊以上', () => {
  const rows = [];
  for (const [W, name] of DEAD) for (const seed of [1, 2]) {
    let maxZ = 0, rest = 0;
    const r = wanderRun({ name, W, H: VH[W], bar: barOf(name, W), seed, size: 'real', ms: 2 * 60 * 1000, mark: (Q, s) => {
      maxZ = Math.max(maxZ, s.zones);
      if (s.ground && !s.move && s.pose !== 'walk' && s.pose !== 'run' && Q.tappable()) rest++;
    } });
    if (seed === 1) rows.push(name + ' ' + W + ' 空地 ' + maxZ + '、地面 ' + Math.round(r.ground * 100) + '%');
    ok(r.P.R().wide === true && r.P.R().size === 62 && maxZ < 3 && r.ground >= 0.9 && rest > 100, name + ' ' + W + ' #' + seed + ':62 px、空地不到 3 塊、9 成以上在地面、停著點得到', { maxZ, ground: r.ground, rest, s: r.P.R() });
  }
  for (const seed of [1, 2]) {
    const L = webSim('learn', 1024, { seed });
    L.step(20000);
    ok(L.R().wide === false && L.R().size === 96, 'learn 1024 #' + seed + ':窄的網站 96', L.R());
  }
  for (const [W, name] of [[1280, 'learn'], [1260, 'drill'], [1270, 'drill']]) { const z = zoneCount(name, W, 'real'); ok(z >= 3, name + ' ' + W + ':62 px 量得到 3 塊以上(邊界外)', z); }
  console.log('  規則的限制(62 px):' + rows.join(';'));
});
/* 每一段的下限(審查第 1 輪 #4):學習頁捲軸 15、17 px、刷題頁沒有捲軸,都量得到 3 塊以上;大一級(+8 px)時學習頁(捲軸 15)或刷題頁不到 3 塊,所以是最大的 */
run('每一段的下限:學習頁(捲軸 15、17)、刷題頁量得到 3 塊以上;再大一級就不到 3 塊', () => {
  const rows = [];
  for (const [W, S] of BANDS.filter(([w]) => w > 0 && w < 1440)) {
    const n = (name, bar, size) => { const P = sim({ src: ROAM, zones: ZONES, size, W, H: 800, bar, page: name + '.html', build: site(name, W - bar, 800), seed: 1 }); P.step(6000); return P.R().zones; };
    const got = [n('learn', 15, 'real'), n('learn', 17, 'real'), n('drill', 0, 'real')], up = [n('learn', 15, S + 8), n('drill', 0, S + 8)];
    rows.push(W + ' ' + S + ' px ' + got.join('/') + ',' + (S + 8) + ' px ' + up.join('/'));
    ok(got.every((z) => z >= 3), W + '(' + S + ' px):學習頁捲軸 15、17 和刷題頁都 3 塊以上', got);
    ok(up.some((z) => z < 3), W + ':' + (S + 8) + ' px 時學習頁或刷題頁不到 3 塊', up);
  }
  console.log('  每一段的下限 空地數(學習 15/學習 17/刷題,大一級 學習 15/刷題):' + rows.join(';'));
});
/* 假瀏覽器的刷題頁照真的版型(審查第 1 輪 #1:以前兩排卡片、頁尾在 600,量到 6 塊,真的只有 2 塊):
   10/24 無頭 Chrome 1440×900:標題 93 到 139,一排兩張卡片 173 到 301(寬 509、中間 22),頁尾上緣 331 */
run('假瀏覽器的刷題頁:一排兩張卡片 173 到 301、頁尾上緣 331(照無頭 Chrome 實測)', () => {
  const got = [];
  site('drill', 1440, 900)((parent, tag, o) => { got.push([tag, o.box]); return { tag }; });
  eq(got.filter(([t]) => t === 'a').map(([, b]) => b), [[200, 173, 709, 301], [731, 173, 1240, 301]], '卡片');
  eq((got.find(([t]) => t === 'footer') || [])[1].slice(1, 2), [331], '頁尾上緣');
});
/* 實際的視窗高(審查第 1 輪 #1):刷題頁 1440、1536 在 110 px 時框高 116,卡片上緣那一層站不上去,只有頁尾上緣那一層的兩側 2 塊(實測一樣),地面還是不到 3 成 */
run('實際的視窗高 1280×690、1366×657、1440×790、1536×730(和 1440×900):學習、刷題頁照 10/20 的要求;刷題頁 110 px 只有兩側 2 塊', () => {
  const rows = [];
  for (const [W, H] of REAL_H.concat([[1440, 900]])) for (const name of ['learn', 'drill']) {
    const a = wanderStats(name, W, 'real', H);
    rows.push(name + ' ' + W + '×' + H + ' ' + fmt(a) + ',空地 ' + a.maxZ);
    const tag = name + ' ' + W + '×' + H + '(' + sizeAt(W) + ' px):';
    ok(a.minZones >= 3 && a.maxGround <= 0.3 && a.first >= 0 && a.first <= 5000, tag + '去 3 個地方以上、在地面不到 3 成、5 秒內離開地面', a);
    ok(median(a.stays) >= 5 && median(a.stays) <= 15, tag + '每塊空地停 5 到 15 秒', median(a.stays));
    if (name === 'drill' && sizeAt(W) === 110) ok(a.maxZ === 2, tag + '只有兩側 2 塊(實測一樣)', a.maxZ);
  }
  console.log('  實際的視窗高 最少去幾處/在地面最多幾成/第一次離開地面:' + rows.join(';'));
});

/* 手機(App 375、網站 375)的主分頁:放大以後 102 高的框塞不進頂欄和頁面標題之間,標題右邊那個站點不能用,偶爾飛上站點在手機上沒有了
   (審查第 1 輪 #5;規格 1.4、附錄 D 第八輪,等 Bonnie 選)。這裡把現在的樣子寫成明確的預期,48 px 對照組照樣飛得上去 */
function phonePage(W, topH) {
  return (add) => {
    add(null, 'header', { cls: 'topbar', box: [0, 0, W, topH], fixed: true, style: WHITE });
    const main = add(null, 'main', { box: [16, topH, W - 16, 1400] });
    add(main, 'h1', { box: [16, topH + 34, 60, topH + 73], texts: [[16, topH + 36, 60, topH + 71]] });
    for (let i = 0; i < 4; i++) add(main, 'a', { attrs: { href: 'x.html' }, box: [16, topH + 100 + i * 180, W - 16, topH + 260 + i * 180], style: Object.assign({ cursor: 'pointer' }, WHITE) });
  };
}
run('手機 375(App、網站):110 px 以前的 48 px 飛得上標題右邊;現在 96 px 框高 102 放不進頂欄和標題之間,主分頁不飛上站點(等 Bonnie 決定)', () => {
  for (const [app, topH] of [[true, 53], [false, 94]]) {
    const count = (size) => {
      let perched = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const o = { src: ROAM, size, W: 375, H: 812, page: 'drill.html', build: phonePage(375, topH), seed };
        if (app) Object.assign(o, { app: true, htmlClass: ['app-shell', 'has-tabbar', 'is-tab-root'] }); else o.zones = ZONES;
        const P = sim(o);
        let up = false;
        for (let t = 0; t < 20000; t += 250) { P.step(250); const s = P.R(); if (s && s.perch) up = true; }
        if (up) perched++;
      }
      return perched;
    };
    const small = count(48), big = count('real');
    ok(small > 0 && big === 0, (app ? 'App' : '網站') + ' 375 刷題頁:48 px 有 ' + small + ' 次飛上標題,96 px 0 次', { small, big });
  }
});

/* ---------- 可以點的範圍(審查第 2 輪 #3):框留了跳起來的頭頂空間,手機上那一條透明的地方會吃掉卡片的點擊。
   按鈕只有畫出來的小雞那麼大(腳底對齊框底、左右置中),畫布照舊整個框;至少 44×44 ---------- */
const ARTSRC = read('js/chick-art.js');
const artN = (k) => Number((ARTSRC.match(new RegExp('\\b' + k + ' = (\\d+)')) || [])[1]);
const tapVars = (P) => [P.html.vars['--pet2-tw'], P.html.vars['--pet2-th']].map((v) => parseFloat(v));
run('可以點的範圍:只有畫出來的小雞那麼大,框上緣往下 14 px 的正中間點得到底下的內容;每種大小都蓋住小雞的身體、至少 44×44', () => {
  const body = { l: (artN('CX') - artN('RX')) / M.width, r: (artN('CX') + artN('RX')) / M.width, t: (artN('CY') - artN('RY')) / M.width };   // 身體在畫布裡的比例(畫布寬 S,畫布高 S×H/W,腳底在框底)
  ok(body.l > 0 && body.r < 1 && body.t > 0, '從 chick-art.js 讀到身體的位置', body);
  const cases = [
    ['App 375', { app: true, htmlClass: ['app-shell', 'has-tabbar', 'is-tab-root'], W: 375, H: 812, page: 'learn.html', build: narrowPage(375) }, 96],
    ['網站 375', { zones: ZONES, W: 375, H: 812, page: 'learn.html', build: narrowPage(375) }, 96],
    ['電腦版 1440', { zones: ZONES, W: 1440, H: 900, page: 'learn.html', build: site('learn', 1440, 900) }, 110],
    ['電腦版 1366', { zones: ZONES, W: 1366, H: 768, page: 'drill.html', build: site('drill', 1366, 768) }, 94],
    ['電腦版 1280', { zones: ZONES, W: 1280, H: 800, page: 'drill.html', build: site('drill', 1280, 800) }, 62],
    ['App 橫放 932×430', { app: true, htmlClass: ['app-shell', 'has-tabbar'], W: 932, H: 430, page: 'practice.html', build: narrowPage(932) }, 64],
  ];
  for (const [tag, o, S] of cases) {
    const P = sim(Object.assign({ src: ROAM, size: 'real', seed: 2 }, o));
    P.step(2000);
    const BOXH = boxOf(S), [tw, th] = tapVars(P);
    ok(P.R().size === S, tag + ':大小 ' + S, P.R());
    ok(tw >= 44 && th >= 44 && tw < S && th < BOXH, tag + ':按鈕 ' + tw + '×' + th + ',比框 ' + S + '×' + BOXH + ' 小、至少 44×44', { tw, th });
    ok(BOXH - th > 14, tag + ':框上緣往下 14 px 不在按鈕裡(落到底下的內容)', { band: BOXH - th });
    const left = (S - tw) / 2, top = BOXH - th;
    ok(left <= body.l * S && left + tw >= body.r * S && top <= body.t * S, tag + ':按鈕蓋住小雞的身體', { tap: [left, top, left + tw, BOXH], body: [body.l * S, body.t * S, body.r * S] });
  }
});
run('App 橫放(手機橫拿,視窗高 500 以下):小雞 64 px、框高 68;轉回直放換回 96,再橫放又是 64(審查第 2 輪 #4)', () => {
  const P = sim({ src: ROAM, size: 'real', W: 932, H: 430, page: 'practice.html', app: true, htmlClass: ['app-shell', 'has-tabbar'], build: narrowPage(932), seed: 2 });
  P.step(2000);
  ok(P.R().size === 64 && P.R().boxH === 68, '932×430:64、68', P.R());
  eq(vars(P), ['64px', '68px'], '932×430:--pet2-w 64px、--pet2-h 68px(--pet-h 跟著它,文章框只扣 68)');
  eq(P.anim.sizes, [64], '932×430:引擎用 64 開一次');
  P.resize(430, 932); P.step(1000);
  ok(P.R().size === 96 && vars(P)[1] === '102px', '轉成直放 430×932:96、102', { s: P.R(), v: vars(P) });
  P.resize(932, 430); P.step(1000);
  ok(P.R().size === 64 && vars(P)[1] === '68px' && P.anim.sizes.slice(-1)[0] === 64, '轉回橫放:64、68', { s: P.R(), v: vars(P), sizes: P.anim.sizes });
  const web = sim({ src: ROAM, zones: ZONES, size: 'real', W: 932, H: 430, page: 'review.html', build: narrowPage(932), seed: 2 });
  web.step(2000);
  ok(web.R().size === 96, '網站模式的矮視窗不換(只有 App 分頁列那一套)', web.R());
});

/* ---------- 換大小重開引擎(審查第 3 輪 #0):新引擎開的時候第一拍是同步跑的,那時 anim 還指著停掉的舊引擎;
   那一拍換姿勢會把舊引擎叫醒,之後沒人停得掉。轉來轉去、跨過 1024 來回 80 次:同時只有一個引擎計時器在跑,每秒拍數跟 fps 差不多 ---------- */
const FPS_MAX = Math.max(...Object.values(ART.fps));
function flipRun(mk, flip) {
  const out = [];
  for (let seed = 1; seed <= 6; seed++) {
    const P = mk(seed);
    P.step(2000);
    let maxLive = P.anim.live;
    for (let k = 0; k < 80; k++) { flip(P, k); P.step(400 + (k % 7) * 37); maxLive = Math.max(maxLive, P.anim.live); }
    const t0 = P.anim.ticks; P.step(10000);
    out.push({ seed, maxLive, endLive: P.anim.live, rate: (P.anim.ticks - t0) / 10, sizes: P.anim.sizes.length });
  }
  return out;
}
run('換大小重開引擎:App 轉來轉去、網站跨過 1024 來回 80 次,舊引擎不會被叫醒(同時最多一個引擎計時器、每秒拍數不超過 fps)', () => {
  const cases = [
    ['App 412×915 ↔ 915×412', (seed) => sim({ src: ROAM, size: 'real', W: 412, H: 915, page: 'learn.html', app: true, htmlClass: ['app-shell', 'has-tabbar', 'is-tab-root'], build: narrowPage(412), seed }),
      (P, k) => (k % 2 ? P.resize(412, 915) : P.resize(915, 412))],
    ['網站 1000 ↔ 1100', (seed) => sim({ src: ROAM, zones: ZONES, size: 'real', W: 1000, H: 900, page: 'learn.html', build: site('learn', 1000, 900), seed }),
      (P, k) => (k % 2 ? P.resize(1000, 900) : P.resize(1100, 900))],
    ['電腦版 1300 ↔ 1500(70 ↔ 110,都在到處走)', (seed) => sim({ src: ROAM, zones: ZONES, size: 'real', W: 1300, H: 900, page: 'learn.html', build: site('learn', 1300, 900), seed }),
      (P, k) => (k % 2 ? P.resize(1300, 900) : P.resize(1500, 900))],
  ];
  for (const [tag, mk, flip] of cases) {
    const r = flipRun(mk, flip);
    ok(r.every((q) => q.sizes > 40), tag + ':真的有換大小、重開引擎', r.map((q) => q.sizes));
    ok(r.every((q) => q.maxLive <= 1 && q.endLive <= 1), tag + ':同時最多一個引擎計時器', r.map((q) => [q.maxLive, q.endLive]));
    ok(r.every((q) => q.rate <= FPS_MAX + 0.5), tag + ':每秒拍數不超過 ' + FPS_MAX, r.map((q) => q.rate));
  }
});
/* 直放的手機視窗變矮(會把版面縮起來的鍵盤、分割畫面;審查第 3 輪 #2):不是橫放,不換成 64,底部留白不縮、讀的位置不跳 */
run('App 直放的視窗變矮(360×760 → 360×440 → 360×760):大小、--pet2-h 不變,不重開引擎;螢幕是直的時寬比高大也不換', () => {
  const P = sim({ src: ROAM, size: 'real', W: 360, H: 760, page: 'learn.html', app: true, htmlClass: ['app-shell', 'has-tabbar', 'is-tab-root'], build: narrowPage(360), seed: 2 });
  P.step(2000);
  ok(P.R().size === 96, '360×760:96', P.R());
  P.resize(360, 440); P.step(1000);
  ok(P.R().size === 96 && vars(P)[1] === '102px', '360×440(直放、變矮):還是 96、102px', { s: P.R(), v: vars(P) });
  P.resize(360, 760); P.step(1000);
  ok(P.R().size === 96 && JSON.stringify(P.anim.sizes) === '[96]', '回到 360×760:引擎只開過一次', P.anim.sizes);
  P.win.screen = { orientation: { type: 'portrait-primary' } };
  P.resize(360, 340); P.step(1000);
  ok(P.R().size === 96 && vars(P)[1] === '102px', '螢幕是直的、視窗 360×340(鍵盤把版面縮到比寬還矮):還是 96', { s: P.R(), v: vars(P) });
  P.win.screen = { orientation: { type: 'landscape-primary' } };
  P.resize(760, 340); P.step(1000);
  ok(P.R().size === 64, '真的轉成橫放 760×340:64', P.R());
});
run('App 鍵盤打開(html.app-kb)的時候視窗大小變了:不換大小,收起來以後再照視窗換', () => {
  const P = sim({ src: ROAM, size: 'real', W: 932, H: 430, page: 'practice.html', app: true, htmlClass: ['app-shell', 'has-tabbar'], build: narrowPage(932), seed: 2 });
  P.step(1000);
  ok(P.R().size === 64, '932×430:64', P.R());
  P.html.classList.add('app-kb');
  P.resize(430, 932); P.step(1000);
  ok(P.R().size === 64, '鍵盤開著:還是 64', P.R());
  P.html.classList.remove('app-kb');
  P.resize(430, 932); P.step(1000);
  ok(P.R().size === 96, '鍵盤收起來:直放 96', P.R());
});

/* ---------- css ---------- */
run('css:按鈕、地面那一條、頁面底部留白照小雞的大小', () => {
  const css = read('css/style.css');
  const a = css.indexOf('小雞第二階段:roam(js/pet-roam2.js)開始'), b = css.indexOf('小雞第二階段:roam 結束');
  const blk = css.slice(a, b);
  ok(/html\.pet-roam2 \{ --pet2-w: 96px; --pet2-h: 102px; --pet2-tw: 69px; --pet2-th: 71px; \}/.test(blk), '預設(js 還沒寫之前)96×102,可以點的範圍 69×71');
  ok(/\.pet-roam2-btn \{[^}]*left: calc\(\(var\(--pet2-w\) - var\(--pet2-tw\)\) \/ 2\); top: calc\(var\(--pet2-h\) - var\(--pet2-th\)\); width: var\(--pet2-tw\); height: var\(--pet2-th\);/.test(blk),
    '按鈕(可以點的範圍)照 --pet2-tw、--pet2-th,腳底對齊框底、左右置中(審查第 2 輪 #3)');
  ok(/\.pet-roam2-cv \{[^}]*left: calc\(\(var\(--pet2-tw\) - var\(--pet2-w\)\) \/ 2\); top: calc\(var\(--pet2-th\) - var\(--pet2-h\)\);/.test(blk)
    && /\.pet-roam2-btn\.is-perch \.pet-roam2-cv \{ top: calc\(8px \+ var\(--pet2-th\) - var\(--pet2-h\)\); \}/.test(blk), '畫布照舊佔整個框(移回框的左上角);站在上緣時一樣往下 8 px');
  ok(/div\.pet-roam2\.is-ground \{[^}]*height: var\(--pet2-h\)/.test(blk), '地面那一條照 --pet2-h');
  ok(/html\.pet-roam2\.has-pet:not\(\.app-shell\) body \{ padding-bottom: calc\(var\(--pet2-h\) \+ 8px \+ env\(safe-area-inset-bottom\)\); \}/.test(blk), '網站模式:頁面底部留小雞的高度加 8 px');
  ok(/html\.app-shell\.pet-roam2 \{ --pet-h: var\(--pet2-h\); \}/.test(blk), 'App 模式:分頁列那一套留白(--pet-h)照走動那隻的高度');
  const app = blk.indexOf('html.app-shell.pet-roam2 {'), media = blk.lastIndexOf('@media (max-width: 860px), (pointer: coarse) and (max-height: 500px)', app);
  ok(app > media && media > 0 && !/\n\}\r?\n/.test(blk.slice(media, app)),'App 模式那一條在分頁列的 @media 裡(寬視窗沒有分頁列時不作用)');
});

/* ---------- 原始碼 ---------- */
run('原始碼:大小只寫在設定物件裡、800 行以內', () => {
  const code = ROAM.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  const rest = code.replace(/const CFG = Object\.freeze\(\{[\s\S]*?\}\);/, '');
  ok(!/CFG\.size\b|\bsize: \d+|\bS = [1-9]/.test(rest), 'pet-roam2.js 設定物件以外沒有寫死小雞的大小', (rest.match(/.{0,40}(CFG\.size\b|size: \d+|S = [1-9]).{0,20}/g) || []).slice(0, 4));
  ok(ROAM.split('\n').length <= 800, 'pet-roam2.js 800 行以內', ROAM.split('\n').length);
  ok(/maxDpr: 2/.test(code), '畫布照裝置像素比(最多 2 倍)畫,放大以後一樣清楚');
});

run('註解:電腦版分段寫的跟 CFG.sizes.wide 一樣(審查第 3 輪 LOW:110 下一段是 94,差 16,不是每 8 px 一級)', () => {
  const lineOf = (src, re) => (src.split('\n').find((l) => re.test(l)) || '');
  const cfgLine = lineOf(ROAM, /^\s*sizes: Object\.freeze\(/), zoneLine = lineOf(ZONES, /minWalk: \d+, headroom: \d+/);
  const pairs = (s) => [...s.matchAll(/(\d{4}) 以上 (\d+)/g)].map((m) => [+m[1], +m[2]]);
  const inTable = (s) => pairs(s).every(([w, S]) => BANDS.some(([bw, bs]) => bw === w && bs === S));
  const noEvery8 = (s) => !/(以下|往下)每 8 px 一級/.test(s);
  ok(!!cfgLine && noEvery8(cfgLine) && inTable(cfgLine) && BANDS.filter(([w]) => w > 0).every(([w, S]) => pairs(cfgLine).some(([a, b]) => a === w && b === S)) && /其他 62/.test(cfgLine),
    'js/pet-roam2.js CFG 那一行的註解照表列出每一段(1440 以上 110、1344 以上 94、1328 以上 86、1312 以上 78、1296 以上 70、其他 62)', cfgLine.slice(cfgLine.indexOf('//'), cfgLine.indexOf('//') + 200));
  ok(!!zoneLine && noEvery8(zoneLine) && inTable(zoneLine) && /CFG\.sizes\.wide/.test(zoneLine),
    'js/pet-roam-zones.js minWalk 那一行的註解指向 CFG.sizes.wide,不自己重寫級距', zoneLine.slice(zoneLine.indexOf('//'), zoneLine.indexOf('//') + 200));
  const CSS = read('css/style.css');
  ok(noEvery8(CSS) && inTable(lineOf(CSS, /電腦版到處走照視窗寬/)), 'css/style.css 的註解也跟表一樣');
});

console.log((fail ? 'FAILED' : 'OK') + ' pet-roam size:' + pass + ' 通過,' + fail + ' 失敗');
process.exit(fail ? 1 : 0);
