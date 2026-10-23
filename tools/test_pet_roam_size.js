/* 走動的小雞放大(Bonnie 2026-10-23:「小雞要大一點 現在好小」「About 2x」):js/pet-roam2.js、css/style.css。
   用法:node tools/test_pet_roam_size.js
   - 每種模式一個數字(CFG.sizes):App 分頁列上 96、網站模式 1023 以下 96、電腦版到處走 110;框高照引擎的比例(102、116)。
   - 兩側空白的門檻、空地、站點、落地前的再確認、可以點的範圍一律照現在的大小算;寬度跨過 1024 換大小時重開引擎(畫布照 DPR 重配)。
   - css:按鈕和地面那一條照 --pet2-w、--pet2-h,頁面底部留白(網站模式、App 模式)照 --pet2-h,最後的內容捲得到小雞上面。
   - 用 tools/pet_roam_sim.js 的假瀏覽器照檔案裡真的大小(size: 'real')跑五個主分頁:停著的時候不蓋到按鈕、卡片、文字,
     走、跳、飛的時候點擊穿過;另外印出每頁 1280、1920 量到幾塊空地(48 px 那一版對照)。 */
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

run('設定:每種模式一個數字,約 2 倍', () => {
  eq(CFG && CFG.sizes, { app: 96, appLand: 64, web: 96, wide: 110 }, 'CFG.sizes:App 96、App 橫放 64(審查第 2 輪 #4)、網站 96、電腦版到處走 110');
  ok(!!CFG && Object.isFrozen(CFG.sizes) && !('size' in CFG) && !('sideMin' in CFG), '凍結;舊的 size、sideMin 拿掉(門檻照大小算)');
  ok(!!U && typeof U.sizeFor === 'function' && U.sizeFor(true, false) === 96 && U.sizeFor(true, true) === 96 && U.sizeFor(false, false) === 96 && U.sizeFor(false, true) === 110
    && U.sizeFor(true, false, true) === 64 && U.sizeFor(true, false, false) === 96 && U.sizeFor(false, false, true) === 96 && U.sizeFor(false, true, true) === 110, 'sizeFor(App, 電腦版到處走, 矮的橫放):橫放只在 App 模式換成 64');
  ok(!!CFG && CFG.landH === 500, '橫放的門檻跟分頁列的 @media 一樣:視窗高 500 以下', CFG && CFG.landH);
  ok(!!CFG && !!CFG.tap && Object.isFrozen(CFG.tap) && CFG.tap.min === 44, '可以點的範圍比例在設定物件裡,最小 44', CFG && CFG.tap);
  eq([boxOf(96), boxOf(110)], [102, 116], '框高照引擎的比例:102、116');
  ok(96 / 48 === 2 && 110 / 48 > 2 && 110 / 48 < 2.4, '約 2 倍(App、窄的網站 2 倍,電腦版 2.3 倍)');
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
function zoneCount(name, W, H, size) {
  const P = sim({ src: ROAM, zones: ZONES, size, W, H, page: name + '.html', build: site(name, W, H), seed: 1 });
  P.step(6000);
  return P.R().zones;
}
run('五個主分頁 1280、1440、1920(110 px):停著的時候不蓋到按鈕、卡片、文字;走、跳、飛的時候點擊穿過;框沒有跑出視窗', () => {
  const table = [];
  for (const [W, H] of [[1280, 800], [1440, 900], [1920, 1080]]) for (const name of PAGES) {
    const hits = [], taps = [], outside = [];
    let rest = 0, up = 0;
    for (const seed of [1, 2]) {
      wanderRun({ name, W, H, seed, size: 'real', ms: 3 * 60 * 1000, mark: (Q, s) => {
        const b = Q.box(), w = b.r - b.l;
        const moving = !!s.move || s.flying || s.pose === 'walk' || s.pose === 'run';
        if (Math.abs(w - 110) > 0.01) outside.push({ t: Q.st.t, w });
        if (b.l < 16 - 0.5 || b.r > W - 16 + 0.5) outside.push({ t: Q.st.t, b });
        if (!s.ground && !moving) up++;
        /* 視窗下緣的地面是固定的一條,內容從牠底下捲過去(頁面底部留白讓最後的內容捲得上來),不算;整條橫幅是背景(同 zones 的 band) */
        if (!s.flying && !s.move && !s.ground) for (const q of obstaclesNow(Q)) {
          const stand = (q.k === 'c' && Math.abs(q.t - b.b) < 1.5) || (q.k === 'c' && q.r - q.l > 0.9 * W);
          if (!stand && hitW(q, b.l, w, b.t, b.b)) { hits.push({ t: Q.st.t, b, q, zone: s.zone }); break; }
        }
        if (moving && Q.tappable()) taps.push({ t: Q.st.t, s });
        if (!moving && Q.tappable()) rest++;
      } });
    }
    const tag = name + ' ' + W + ':';
    ok(!hits.length, tag + '停著、走著的時候框不碰到障礙', hits.slice(0, 2));
    ok(!taps.length, tag + '走、跳、飛的時候點擊穿過', taps.slice(0, 2));
    ok(!outside.length, tag + '框 110 寬、在視窗兩側 16 px 以內', outside.slice(0, 2));
    ok(rest > 100, tag + '停著的時候點得到', rest);
    table.push({ page: name, W, upShare: Math.round(up / (2 * 1800) * 100) });
  }
  console.log('  離開地面、停在空地上的時間比例(%):' + table.map((r) => r.page + ' ' + r.W + ' ' + r.upShare).join(';'));
});
run('量到幾塊空地(1280、1920;48 px 那一版對照):1920 每頁都有空地', () => {
  const rows = [];
  for (const W of [1280, 1920]) {
    const H = W === 1280 ? 800 : 1080;
    for (const name of PAGES) {
      const before = zoneCount(name, W, H, 48), after = zoneCount(name, W, H, 'real');
      rows.push(name + ' ' + W + ' ' + before + '→' + after);
      if (W === 1920) ok(after >= 1, name + ' 1920:110 px 還量得到空地', { before, after });
      ok(after <= before, name + ' ' + W + ':小雞變大,空地不會變多', { before, after });
    }
  }
  console.log('  空地數(48 px → 110 px):' + rows.join(';'));
});

/* ---------- 真的大小的走法數字(審查第 1 輪 #8):pet_roam_sim 沒給 size 時照 48 px 跑,這裡照檔案裡的大小釘住 10/20 的要求 ---------- */
run('真的大小:1366、1440、1920 五個主分頁和 1280 的複習、我的,照 10/20 的要求(任一段 60 秒去 3 個地方以上、在地面不到 3 成、5 秒內離開地面、每塊待 5 到 15 秒)', () => {
  const list = [];
  for (const [W, H] of [[1366, 768], [1440, 900], [1920, 1080]]) for (const name of PAGES) list.push([name, W, H]);
  list.push(['review', 1280, 800], ['me', 1280, 800]);
  for (const [name, W, H] of list) {
    const a = { minZones: Infinity, maxGround: 0, first: 0, stays: [] };
    for (const seed of [1, 2]) {
      const r = wanderRun({ name, W, H, seed, size: 'real', ms: 3 * 60 * 1000 });
      a.minZones = Math.min(a.minZones, r.minZones); a.maxGround = Math.max(a.maxGround, r.maxGround);
      a.first = Math.max(a.first, r.first < 0 ? Infinity : r.first); a.stays.push(...r.stays);
    }
    const tag = name + ' ' + W + '(110 px):';
    ok(a.minZones >= 3 && a.maxGround <= 0.3 && a.first >= 0 && a.first <= 5000, tag + '去 3 個地方以上、在地面不到 3 成、5 秒內離開地面', a);
    ok(median(a.stays) >= 5 && median(a.stays) <= 15, tag + '每塊空地停 5 到 15 秒', median(a.stays));
  }
});
run('真的大小:忙的時候(一直按鍵)1440、1920 的刷題、學習頁照樣在同一側換、5 秒內開始離開、不飛過主要內容那一欄', () => {
  const key3 = (o) => { let last = -1e9; return (Q) => { if (Q.st.t - last >= 3000) { last = Q.st.t; Q.fireDoc('keydown', { key: 'Shift' }); } if (o) o(Q); }; };
  for (const [W, H] of [[1440, 900], [1920, 1080]]) for (const name of ['drill', 'learn']) for (const seed of [1, 2]) {
    const L = Math.round((W - 1040) / 2), R = L + 1040;
    let cross = 0, runAt = -1, runX = 0, upX = null;
    const r = wanderRun({ name, W, H, seed, size: 'real', startX: Math.round(W / 2), ms: 150000, mark: key3((Q) => {
      const s = Q.R(), b = Q.box();
      if (runAt < 0 && s.ground && s.pose === 'run') { runAt = Q.st.t; runX = s.x; }
      if (upX === null && (s.move || s.flying || !s.ground)) upX = s.x;
      if ((s.move === 'fly' || s.move === 'fall') && b.r > L && b.l < R) cross++;
    }) });
    const go = runAt >= 0 ? runAt : r.first, need = runAt >= 0 ? Math.abs(upX - runX) / Z.CFG.runSpeed * 1000 + 2500 : 0;
    ok(r.minZones >= 3 && r.ground <= 0.3 && go >= 0 && go <= 5000 && r.first - go <= need + 1 && cross === 0, name + ' ' + W + ' #' + seed + '(110 px,忙):', { minZones: r.minZones, ground: r.ground, first: r.first, runAt, need, cross });
  }
});
/* 1280 的寬版頁(首頁、學習、刷題)放大以後的代價(規格 1.11 的 10/23 實測、附錄 D 第八輪,等 Bonnie 從 (1)(2)(3) 選;這一版照 (1) 接受)。
   這裡把現在的樣子寫成明確的預期,改了做法就會紅,要一起改這裡:學習、刷題量不到空地、只在視窗下緣走;首頁只剩兩塊 */
run('1280 的寬版頁(110 px,照附錄 D 第八輪 (1)):學習、刷題量不到空地,只在視窗下緣走來走去、停著時點得到;首頁 5 秒內離開地面、任一段 60 秒去 2 個地方以上', () => {
  for (const name of ['learn', 'drill']) for (const seed of [1, 2]) {
    let maxZ = 0, up = 0, rest = 0;
    const xs = new Set();
    const r = wanderRun({ name, W: 1280, H: 800, seed, size: 'real', ms: 2 * 60 * 1000, mark: (Q, s) => {
      maxZ = Math.max(maxZ, s.zones); if (!s.ground && !s.move && !s.flying) up++; if (s.ground) xs.add(Math.round(s.x / 20));
      if (s.ground && !s.move && s.pose !== 'walk' && s.pose !== 'run' && Q.tappable()) rest++;
    } });
    ok(maxZ === 0 && up === 0 && r.ground >= 0.9 && xs.size >= 3 && rest > 100, name + ' 1280 #' + seed + ':0 塊空地、都在地面、沿著下緣走、停著點得到', { maxZ, up, ground: r.ground, xs: xs.size, rest });
  }
  for (const seed of [1, 2]) {
    const r = wanderRun({ name: 'index', W: 1280, H: 800, seed, size: 'real', ms: 3 * 60 * 1000 });
    ok(r.first >= 0 && r.first <= 5000 && r.minZones >= 2 && r.maxGround <= 0.4, 'index 1280 #' + seed + ':5 秒內離開地面、去 2 個地方以上、在地面最多 4 成', { first: r.first, minZones: r.minZones, maxGround: r.maxGround });
  }
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

console.log((fail ? 'FAILED' : 'OK') + ' pet-roam size:' + pass + ' 通過,' + fail + ' 失敗');
process.exit(fail ? 1 : 0);
