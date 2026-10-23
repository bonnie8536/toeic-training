/* 小雞第二階段:電腦版到處走的空地(小雞第二階段規格.md 1.11)。
   - 只由 js/app-shell.js 的網站模式載入清單載入,放在 js/pet-roam2.js 前面;App 模式不載。沒有這個檔時 pet-roam2.js 照 1.3、1.4 走。
   - 這裡只有計算:找空地(floorsOf、zonesOf)、兩塊空地之間怎麼過去(routeOf)、下一個去哪裡(choose)、學生在不在忙(tracker),
     和在瀏覽器裡量一次(measure)。動畫、點擊、淡出都在 pet-roam2.js。
   - 不讀寫任何儲存、不碰學生資料、不讀網址參數。數字都在下面一個凍結的設定物件。 */
(function (root) {
  'use strict';
  const CFG = Object.freeze({
    minW: 1024,                 // 視窗寬 1024 以上的網站模式才到處走
    maxEls: 600, budget: 4,     // 量的時候最多量 600 個元素的外框(視窗外的整塊不往裡面看);量不完就當這次沒有空地。超過 4 毫秒記在 ms(預覽看)
    band: 0.9,                  // 寬度超過視窗 90% 的底色區塊當背景
    gap: 16, edgeIn: 8,         // 視窗兩側各留 16 px;站在卡片上緣時兩邊各縮 8 px(同 1.4)
    sideLayers: 3, layerGap: 64, // 兩側每邊最多 3 層;上下差不到 64 px 又左右重疊的兩塊算同一個地方
    titleRun: 120,              // 頁面標題下緣只算到標題文字右邊 120 px(再往右是半空)
    cardW: 160, cardH: 48,      // 兩側借上下緣的卡片(可以點的也算):寬 160、高 48 以上
    minWalk: 48, headroom: 8,   // 空地寬:小雞的寬加 48 以上(至少走得動 48 px);高:框高加 8 以上(小雞的大小由 pet-roam2.js 傳進來,10/23 起電腦版 110×116)
    sideWalk: 24,               // 兩側空白走得動 24 px 就留(1280 只有 48,有捲軸時更少;第二輪審查 #2)
    firstMin: 2000, firstMax: 4000,   // 進頁(和寬度跨過 1024)後 2 到 4 秒第一次離開地面(Bonnie 10/20:5 秒內)
    stayMin: 6000, stayMax: 15000, arriveMin: 1000, arriveMax: 2000,   // 每塊空地待 6 到 15 秒(含路上),到了先站 1 到 2 秒
    groundMin: 2000, groundMax: 5000, wGround: 0.15, landT: 0.6,   // 地面只待 2 到 5 秒,權重 0.15(空地至少 1):60 秒裡在地面不到 3 成
    restEvery: 180000, restMin: 20000, restMax: 30000,  // 長休息:最多每 3 分鐘一次,只在地面以外的空地,20 到 30 秒(60 秒裡還是去得了 3 個地方)
    retry: 1000, retryLand: 1000,   // 挑不到地方(忙、剛捲過):1 秒後再挑(第四輪審查 #3;原本 5 秒)
    edge: 200, scrollMemo: 10000,   // 10 秒內捲動過:腳離可見範圍上緣、地面 200 px 內的空地不去,在地面上又沒有別的地方去時才去(下一次捲動不會馬上把牠捲出去;第四輪審查 #1)
    flyGap: 4000, calm: 2000,   // 兩次起飛至少隔 4 秒;不忙超過 2 秒才往主要內容那一欄起飛
    walkGap: 8, hopDy: 64, hopDx: 80, hopDur: 0.4,
    flySpeed: 400, arch: 24, reach: 2.5, fallMin: 0.6, fallMax: 1.2, fallSpeed: 520, walkSpeed: 16, runSpeed: 48,   // 跑:忙的時候從主要內容底下的地面跑到一側空白(第三輪複查 #0)
    reachFar: 4,                // 這一側的都剛去過、別的地方都在 2.5 秒外:不忙的時候可以飛到 4 秒(不在一側「上、下、地面」一直繞;第五輪審查 #1)
    farSide: 0.5,               // 不忙、飛得到的都在腳下這一側空白:一半的機會把 4 秒內飛得到的另一側也放進來(一側有三層時不會一直在那一條裡繞;第三輪複查 #1)
    busyKey: 20000, busyScroll: 1000, busyMouse: 5000, nearX: 240, nearT: 10000,   // 捲動後 1 秒算忙,再 2 秒不忙才起飛(原本 3 秒,每 6 秒捲一次就一直在地面;第五輪審查 #2)
    gesture: 500, cadence: 15000, scrollGap: 1500,   // 捲動停 0.5 秒以上算下一次;照最近的間隔(15 秒內)估下一次,起飛(0.5 秒)加上飛的時間再留 1 秒,在估的時間前飛不完的不起飛
    remeasure: 1000,            // 最多每秒量一次
    hoverOut: 1000,             // 滑鼠移開 1 秒後再走
    mid: 0.2, wMid: 2, roomy: 200, wRoomy: 1.5, narrow: 100, wNarrow: 0.5, wNear: 0.2, recent: 2,
  });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const standing = (o, y) => o.k === 'c' && Math.abs(o.t - y) < 1.5;   // 腳下那張卡片不擋
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
  const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

  /* 整條橫幅(寬度超過視窗 90% 的卡片)不當障礙;裡面的字、按鈕另外算 */
  function cleanObs(obs, ctx) { return obs.filter((o) => !(o.k === 'c' && o.r - o.l > CFG.band * ctx.W)); }

  /* 地板:卡片上緣、有底色的整條橫幅下緣、頁面標題(main 裡的 h1)下緣、頁尾上緣;兩側空白借主要內容裡卡片的上下緣(每側最多 3 層)。
     obs 是 obstaclesOf 的結果(視窗座標),extra = { heads: [標題外框], foot: 頁尾外框 | null, bands: [有底色的整條橫幅外框] }。
     很寬但沒有底色的(只有上框線的頁尾)下緣看不到,不當地板。k:c 卡片、b 橫幅、h 標題、f 頁尾、s 兩側借的層(zonesOf 用來挑留哪塊) */
  function floorsOf(obs, extra, ctx) {
    const W = ctx.W, g = CFG.gap, out = [];
    const band = (o) => o.r - o.l > CFG.band * W;
    for (const o of obs) if (o.k === 'c' && !band(o)) out.push({ y: o.t, l: o.l + CFG.edgeIn, r: o.r - CFG.edgeIn, k: 'c' });
    for (const b of extra.bands || []) out.push({ y: b.bottom, l: g, r: W - g, k: 'b' });
    for (const h of extra.heads || []) {   // 標題文字右邊一小段;沒量到文字就從標題外框右邊算
      const tx = obs.filter((o) => o.k === 't' && o.t >= h.top - 1 && o.b <= h.bottom + 1 && o.l >= h.left - 1 && o.r <= h.right + 1);
      const r = tx.length ? Math.max(...tx.map((o) => o.r)) : h.right;
      out.push({ y: h.bottom, l: h.left, r: Math.min(W - g, r + CFG.titleRun), k: 'h' });
    }
    if (extra.foot) out.push({ y: extra.foot.top, l: g, r: W - g, k: 'f' });
    const big = (o) => o.k === 'c' || (o.k === 'i' && o.r - o.l >= CFG.cardW && o.b - o.t >= CFG.cardH);   // 小雞站在旁邊,不站在卡片上:可以點的卡片也借
    const inMain = obs.filter((o) => big(o) && !band(o) && o.l >= ctx.mainL - 1 && o.r <= ctx.mainR + 1);
    const ys = Array.from(new Set(inMain.flatMap((o) => [o.t, o.b]))).sort((a, b) => a - b)
      .filter((y) => (ctx.top === undefined || y - (ctx.BOXH || 51) - CFG.headroom >= ctx.top + 4) && (ctx.bottom === undefined || y <= ctx.bottom));
    const spread = [];
    for (const y of ys) if (!spread.length || y - spread[spread.length - 1] >= CFG.layerGap) spread.push(y);
    const n = spread.length, picked = n <= CFG.sideLayers ? spread : [0, 1, 2].map((i) => spread[Math.round(i * (n - 1) / 2)]);
    const keep = ctx.keep === undefined ? undefined : ys.find((y) => Math.abs(y - ctx.keep) < 1.5);   // 小雞正站著的那層:那條邊還看得到就留著(捲動後挑的 3 層換了也不掉下來;第四輪審查 #1)
    const layers = keep === undefined || picked.some((y) => Math.abs(y - keep) < 1.5) ? picked : picked.concat([keep]);
    const S = ctx.S || 48;
    for (const y of layers) {
      if (ctx.mainL - g - CFG.edgeIn >= S) out.push({ y, l: g, r: ctx.mainL - CFG.edgeIn, k: 's' });   // 靠主要內容那邊留 8 px(同卡片的間隔),視窗那邊 16 px
      if (W - ctx.mainR - g - CFG.edgeIn >= S) out.push({ y, l: ctx.mainR + CFG.edgeIn, r: W - g, k: 's' });
    }
    return out;
  }

  /* 上下差不到 64 px 又左右重疊的兩塊只留一塊:真的邊(卡片、橫幅、頁尾)先留,再來標題,最後兩側借的層;同一級寬的先留。
     被擋到的那塊扣掉重疊的那段,剩下的還走得動 48 px 才留 */
  const PRIO = { h: 2, s: 1 };
  const walkMin = (k) => (k === 's' ? CFG.sideWalk : CFG.minWalk);
  function spaced(zs, S) {
    const pr = (z) => PRIO[z.k] || 3, kept = [];
    for (const z of zs.slice().sort((a, b) => pr(b) - pr(a) || (b.hi - b.lo) - (a.hi - a.lo))) {
      let parts = [[z.lo, z.hi]];
      for (const k of kept) {
        if (Math.abs(k.y - z.y) >= CFG.layerGap) continue;
        const a = k.lo - S, b = k.hi + S;
        parts = parts.flatMap(([l, h]) => [[l, Math.min(h, a)], [Math.max(l, b), h]]).filter(([l, h]) => h - l >= walkMin(z.k));
      }
      for (const [l, h] of parts) kept.push({ y: z.y, lo: l, hi: h, k: z.k });
    }
    return kept.sort((a, b) => a.y - b.y || a.lo - b.lo);
  }

  /* 每條地板上小雞框放得下、碰不到障礙(同 1.4 的間隔)的範圍;同一條地板高度、中間沒有障礙的併成一塊 */
  function zonesOf(obs, floors, ctx) {
    const { W, S, BOXH, top, bottom, scrollY } = ctx, g = CFG.gap, F = ctx.freeSpans;
    const raw = [];
    for (const f of floors) {
      const y = f.y;
      if (y - BOXH - CFG.headroom < top + 4 || y > bottom) continue;
      const lo = Math.max(g, Math.ceil(f.l)), hi = Math.min(W - g - S, Math.floor(f.r - S));
      if (hi - lo < walkMin(f.k)) continue;
      const o2 = obs.filter((o) => !standing(o, y));
      for (const sp of F(o2, lo, hi, y - BOXH - CFG.headroom, y, S)) raw.push({ y, lo: sp[0], hi: sp[1], o2, k: f.k });
    }
    raw.sort((a, b) => a.y - b.y || a.lo - b.lo);
    const out = [];
    for (const z of raw) {
      const p = out[out.length - 1];
      const join = p && Math.abs(p.y - z.y) < 1 && (z.lo <= p.hi + 1 ||
        (z.lo - (p.hi + S) <= CFG.walkGap && F(z.o2, p.hi, z.lo, z.y - BOXH - CFG.headroom, z.y, S).some((s) => s[0] <= p.hi && s[1] >= z.lo)));
      if (join) { p.hi = Math.max(p.hi, z.hi); if ((PRIO[z.k] || 3) > (PRIO[p.k] || 3)) p.k = z.k; }
      else out.push({ y: z.y, lo: z.lo, hi: z.hi, k: z.k });
    }
    return spaced(out.filter((z) => z.hi - z.lo >= walkMin(z.k)), S).map((z) => {
      const kind = z.hi + S <= ctx.mainL + 1 ? 'side-L' : z.lo >= ctx.mainR - 1 ? 'side-R' : 'main';
      const feetDoc = z.y + scrollY;
      return { key: kind + ':' + Math.round(feetDoc) + ':' + z.lo, kind, feetDoc, y: z.y, lo: z.lo, hi: z.hi };
    });
  }

  /* from、to:{ feet 視窗座標, lo, hi, x(from), ground };回 { how: walk | hop | fly | fall, dur 秒 } 或 null(到不了、忙的時候不飛) */
  function routeOf(from, to, tx, o) {
    const S = o.S || 48;
    const fallDur = (dy) => Math.min(CFG.fallMax, Math.max(CFG.fallMin, dy / CFG.fallSpeed));
    if (to.ground) return from.ground || o.busy ? null : { how: 'fall', dur: fallDur(to.feet - from.feet) };
    const dy = from.feet - to.feet, dx = Math.abs(tx - from.x);
    const gap = Math.max(to.lo - (from.hi + S), from.lo - (to.hi + S), 0);
    if (!from.ground && Math.abs(dy) < 2 && gap <= CFG.walkGap) return { how: 'walk', dur: dx / CFG.walkSpeed };
    if (Math.abs(dy) <= CFG.hopDy && gap <= CFG.hopDx && dx <= CFG.hopDx) return { how: 'hop', dur: CFG.hopDur };
    if (o.busy) return null;
    const t = dx / CFG.flySpeed;
    if (t > (o.reach || CFG.reach)) return null;
    if (dy > 2) { const F = o.flyFrames(dy, t); return F ? { how: 'fly', dur: F.dur } : null; }
    if (dy >= -CFG.arch) return { how: 'fly', dur: Math.max(CFG.fallMin, t) };
    const d = fallDur(-dy);
    return dx <= CFG.flySpeed * d ? { how: 'fall', dur: d } : { how: 'fly', dur: Math.max(d, t) };   // 往下又橫移遠:邊飛邊往下(原本到不了,只能先回地面;第五輪審查 #1)
  }

  /* 忙、剛忙完(quiet)的時候能去哪裡(choose 用)。主要內容那一欄 M 兩側的空白叫一側(L、R);一側的層 = 看得到、有一段在那一側空白裡的空地。
     - 'side':同一側裡往上一層、下一層換(最低那層下面是地面),不跳過中間那層(第四輪審查 #2)。
     - 'out':不忙(只是滑鼠在主要內容裡動、剛忙完)、站在主要內容底下(地面或一路通到一側空白的地板):到最近、有空地的那一側(地面去最低那層,空地去高度最近的那層),
       路線離學生正在用的地方(near、mouse)240 px 以外才走;都太近就沿著腳下走到那一側(walkOut;第四輪審查 #0:忙也不能把牠釘在地面)。
       忙的時候沒有 'out'(會斜斜飛過主要內容),只用 walkOut:在地面用跑的(每秒 48 px)到那一側,到了再照 'side' 往上飛(第三輪複查 #0)。 */
  function quietLanes(c, vis, S) {
    const here = c.here, M = c.main, gf = c.ground.feet;
    const gut = (x) => (!M ? '' : x + S <= M.l ? 'L' : x >= M.r ? 'R' : '');
    const end = (s) => (s === 'L' ? Math.floor(M.l - S) : Math.ceil(M.r));   // 那一側空白的開頭(小雞框不碰主要內容)
    const lv = (s) => vis.filter((q) => (s === 'L' ? q.lo + S <= M.l : q.hi >= M.r)).map((q) => q.feetDoc - c.scrollY);
    const between = (s, a, b) => lv(s).some((f) => f > Math.min(a, b) + 2 && f < Math.max(a, b) - 2);
    const h = gut(here.x), under = !!M && !h;
    const dist = (s) => (s === 'L' ? here.x - M.l + S : M.r - here.x);
    const side0 = !under ? '' : ['L', 'R'].filter((s) => lv(s).length).sort((a, b) => dist(a) - dist(b))[0] || '';   // 最近、有空地的那一側
    const closest = (s, f) => !lv(s).some((q) => Math.abs(q - here.feet) < Math.abs(f - here.feet) - 2);
    function lane(z, tx) {
      const s = gut(tx);
      if (!M || !s) return '';
      if (z.ground) return !here.ground && h === s && !between(s, here.feet, gf) ? 'side' : '';
      if (h) return h === s && !between(s, here.ground ? gf : here.feet, z.feet) ? 'side' : '';
      return !c.busy && s === side0 && (here.ground ? !between(s, z.feet, gf) : closest(s, z.feet)) ? 'out' : '';
    }
    function walkOut() {
      if (!under) return null;
      const pts = (c.near || []).concat(c.mouse === null || c.mouse === undefined ? [] : [c.mouse]);
      const o = ['L', 'R'].filter((s) => lv(s).length).map((s) => {
        const tx = clamp(end(s), here.lo, here.hi), lo = Math.min(here.x, tx), hi = Math.max(here.x, tx) + S;
        return { tx, ok: gut(tx) === s, d: Math.abs(tx - here.x), pass: pts.some((p) => p >= lo && p <= hi) ? 1 : 0 };
      }).filter((q) => q.ok && q.d > 0).sort((a, b) => a.pass - b.pass || a.d - b.d)[0];
      return !o ? null : here.ground ? { z: c.ground, tx: o.tx, how: 'walk', pose: 'run', dur: o.d / CFG.runSpeed } : { z: here.src || here, tx: o.tx, how: 'walk', dur: o.d / CFG.walkSpeed };   // 地面用跑的(第三輪複查 #0)
    }
    /* 停在一側的那段(寬的地板只在那一側空白裡走來走去,不走進主要內容底下) */
    const clip = (z, tx) => (gut(tx) === 'L' ? [z.lo, Math.min(z.hi, end('L'))] : gut(tx) === 'R' ? [Math.max(z.lo, end('R')), z.hi] : null);
    return { lane, walkOut, clip, nx: (q) => clamp(side0 ? end(side0) : here.x, q.lo, q.hi) };
  }

  /* 下一個去哪裡。c:{ zones, here, ground, now, busy, calm 不忙了多久, near 學生正在用的 x, mouse 5 秒內滑鼠在主要內容裡的 x 或 null, mouseY 那時的高度(可以沒有), sc 捲動的步幅和節奏(tracker.scrollInfo), lastFly, recent, order,
     scrolled 離上次捲動幾毫秒, H, top, bottom, scrollY, S, BOXH, flyFrames, rnd, main 主要內容那一欄 { l, r } }。同一條地板中間有障礙的兩塊(量的時候沒併起來)改小跳,遠一點的改平飛。
     起飛和落下的路線(起點到終點的小雞框)離 mouse 水平 240 px 內不走;最近去過的只在沒有別的地方去時才去,挑最久沒去的。
     忙、剛忙完的時候不往主要內容那一欄起飛、不飛過它,只照 quietLanes 換;只有滑鼠在主要內容裡動時 quietLanes 也能走,別的照上面離滑鼠 240 px 的規則(第五輪審查 #0)。
     10 秒內捲動過:少去靠近可見範圍上下緣的空地(第四輪審查 #1);照捲動的節奏,下一次捲動前飛不完、目的地又會被捲走的不起飛(第五輪審查 #2)。
     回 { z, tx, how, dur, span 停下以後走動的範圍 | 沒有, pose };how 'walk' 是沿著腳下走到一側空白(z 是腳下那塊;pose 'run' 是在地面用跑的) */
  function choose(c) {
    const S = c.S || 48, B = c.BOXH || 51, here = c.here, list = [], sc = c.sc || {};
    const quiet = !!c.busy || c.calm < CFG.calm || (c.mouse !== null && c.mouse !== undefined);   // 滑鼠在主要內容裡動也算:一側的路和沿著地面走出去照樣能用(第五輪審查 #0)
    const vis = c.zones.filter((q) => q.key !== here.key && q.feetDoc - c.scrollY - B - CFG.headroom >= c.top + 4 && q.feetDoc - c.scrollY <= c.bottom);
    const Q = quiet && c.main ? quietLanes(c, vis, S) : null;
    /* 照捲動的節奏,飛到一半就會捲動、目的地往上或往下再捲一次就看不到了(在頁面最上面、最下面只看捲得動的那個方向) */
    const gone = (f) => { const up = f - sc.step - B < c.top, dn = f + sc.step > c.ground.feet; return sc.only ? (sc.dir > 0 ? up : dn) : up || dn; };
    const soon = (d, f) => sc.next > c.now && c.now + d * 1000 + CFG.scrollGap > sc.next && gone(f);
    /* 起飛、落下的路線離滑鼠 240 px 以外。只看左右(主要內容那一欄裡有滑鼠,就不飛過那一欄);
       一側的路(lane,不飛過主要內容)又知道滑鼠的高度(mouseY)時,量小雞框中心走的那條線到滑鼠的距離(扣掉半個框;第五輪審查 #0) */
    const clear = (z, tx, lane) => {
      if (c.mouse === null || c.mouse === undefined) return true;
      if (!lane || c.mouseY === null || c.mouseY === undefined) return Math.max(Math.min(here.x, tx) - c.mouse, c.mouse - (Math.max(here.x, tx) + S), 0) > CFG.nearX;
      const ax = here.x + S / 2, ay = here.feet - B / 2, dx = tx - here.x, dy = z.feet - here.feet, L = dx * dx + dy * dy;
      const k = L ? clamp(((c.mouse - ax) * dx + (c.mouseY - ay) * dy) / L, 0, 1) : 0;
      return Math.hypot(c.mouse - ax - k * dx, c.mouseY - ay - k * dy) - S / 2 > CFG.nearX;
    };
    const route = (z, tx, reach) => {
      const g = Q ? Q.lane(z, tx) : '', busy = !!c.busy && !g, lo = Math.min(here.x, tx), hi = Math.max(here.x, tx) + S, far = (p) => p === null || p === undefined || Math.max(lo - p, p - hi, 0) > CFG.nearX;
      let r = routeOf(here, z, tx, { busy, flyFrames: c.flyFrames, S, reach });
      if (r && r.how === 'walk') r = Math.abs(tx - here.x) <= CFG.hopDx ? { how: 'hop', dur: CFG.hopDur } : busy ? null : { how: 'fly', dur: Math.max(CFG.fallMin, Math.abs(tx - here.x) / CFG.flySpeed) };
      if (r && r.how === 'fly' && (c.now - c.lastFly < CFG.flyGap || (!g && c.calm < CFG.calm) || r.dur > (reach || CFG.reach) || soon(r.dur, z.feet))) return null;
      if (r && r.how !== 'hop' && (!clear(z, tx, g) || (g === 'out' && !(c.near || []).every((p) => far(p) || p === c.mouse)))) return null;   // near 裡的滑鼠已經用 clear 量過
      return r && Object.assign({}, r, { g, reach });
    };
    /* 剛捲過:離可見範圍上下緣 200 px 內的下一次捲動可能就看不到了;往下捲時的上緣、往上捲時的下緣改成上一次捲的距離加 20 px(最多視窗高的 4 成)那麼寬 */
    const memo = c.scrolled < CFG.scrollMemo, stepE = Math.min(sc.step || 0, c.H * 0.4) + 20;
    const eTop = Math.max(CFG.edge, sc.dir > 0 ? stepE : 0), eBot = Math.max(CFG.edge, sc.dir < 0 ? stepE : 0);
    const old = [], late = [];
    let hid = 0;   // 剛捲過、靠近上下緣先不去的有幾塊
    function consider(q, reach) {
      const feet = q.feetDoc - c.scrollY;
      const edgy = memo && (feet - B - c.top < eTop || c.ground.feet - feet < eBot);
      if (edgy && (!here.ground || reach)) { hid++; return; }   // 站在空地上就先別去;在地面上的只在沒有別的地方去時才去(late)
      const z = { key: q.key, kind: q.kind, feet, lo: q.lo, hi: q.hi, src: q };
      /* 忙的時候從主要內容底下出去:落在最近那一側空白裡;只是滑鼠在動、走的不是一側的路時照原本的位置(第五輪審查 #0) */
      let nx = clamp(here.x, q.lo, q.hi), r = null;
      if (Q) { const n1 = Q.nx(q), r1 = route(z, n1, reach); if (r1 && (r1.g || c.busy)) { nx = n1; r = r1; } else if (c.busy && !(r = route(z, nx, reach))) return; }   // 忙:主要內容裡的空地照舊小跳到隔壁
      r = r || route(z, nx, reach);
      if (!r) return;
      if (edgy) { late.push({ z, w: 1, nx, r }); return; }
      if (c.recent.indexOf(q.key) > -1) { if (!reach) old.push({ z, w: 1, nx, r, age: c.recent.indexOf(q.key) }); return; }
      let w = 1;
      const mid = feet - B / 2;
      if (mid >= c.H * CFG.mid && mid <= c.H * (1 - CFG.mid)) w *= CFG.wMid;
      if (q.hi - q.lo >= CFG.roomy) w *= CFG.wRoomy;
      if (q.kind !== 'main' && q.hi - q.lo < CFG.narrow) w *= CFG.wNarrow;
      if ((c.near || []).some((p) => Math.max(q.lo - p, p - (q.hi + S), 0) <= CFG.nearX)) w *= CFG.wNear;
      list.push({ z, w, nx, r });
    }
    for (const q of vis) consider(q);
    /* 平常飛得到的都剛去過(一側只有兩塊,別的都在 2.5 秒外):不忙的時候遠一點的也去,不在「上、下、地面」一直繞(第五輪審查 #1) */
    if (!list.length && !quiet) for (const q of vis) if (c.recent.indexOf(q.key) < 0) consider(q, CFG.reachFar);
    /* 不忙、飛得到的都在腳下這一側空白(1280 一側有三層、另一側在 2.5 秒外):有時候也去另一側,不一直在同一條 48 px 裡上下繞(第三輪複查 #1) */
    const side = quiet || !c.main ? '' : here.x + S <= c.main.l ? 'side-L' : here.x >= c.main.r ? 'side-R' : '';
    if (side && list.length && list.every((it) => it.z.kind === side) && c.rnd() < CFG.farSide) for (const q of vis) if (q.kind !== side && c.recent.indexOf(q.key) < 0) consider(q, CFG.reachFar);
    /* 別的空地都剛去過:最久沒去的那塊跟地面比,照 order(含地面的去過順序)去比較久沒去的那個;沒有 order 就一起抽。
       不然疊著的兩塊(高的那塊只有從低的那塊飛得到),高的那塊去過一次以後只剩地面和低的那塊輪流(第三輪審查 #2) */
    const fresh = list.length;
    let g = null;
    if (!here.ground) { const r = route(c.ground, here.x); if (r) list.push(g = { z: c.ground, w: CFG.wGround, nx: here.x, r }); }
    if (!fresh && old.length) {
      const o = old.sort((a, b) => b.age - a.age)[0], ord = c.order || [], gi = ord.indexOf('ground'), oi = ord.indexOf(o.z.key);
      if (!g || gi < 0 || oi < 0) list.push(o);
      else if (oi > gi) list.splice(list.indexOf(g), 1, o);
    }
    if (!list.length) list.push(...late);
    /* 剛捲過、別的空地都靠近上下緣、腳下這塊還不會被下一次捲走:先站著,不為了換地方落回地面(第五輪審查 #2) */
    if (memo && g && list.length === 1 && list[0] === g && hid && !(here.feet - B - c.top < eTop || c.ground.feet - here.feet < eBot)) return null;
    let sum = 0;
    for (const it of list) sum += it.w;
    if (!(sum > 0)) return Q ? Q.walkOut() : null;
    let v = c.rnd() * sum, it = list[list.length - 1];
    for (const q of list) { if ((v -= q.w) < 0) { it = q; break; } }
    let tx = it.nx, r = it.r;
    if (!it.z.ground) {
      const t2 = clamp(it.nx + (c.rnd() - 0.5) * 240, it.z.lo, it.z.hi), r2 = route(it.z, t2, r.reach);
      if (r2 && r2.how === r.how) { tx = Math.round(t2); r = r2; }
    }
    const span = r.g ? Q.clip(it.z, tx) : null;
    return Object.assign({ z: it.z.ground ? it.z : it.z.src, tx, how: r.how, dur: r.dur }, span ? { span } : {});
  }

  /* 這一頁的走動紀錄(只在記憶體裡):空地、現在在哪、下次換地方的時間、換了幾次、上次起飛、最近去過的、上次長休息 */
  const span = (r, a, b) => a + Math.floor(r() * (b - a + 1));
  function memory(now, rnd) {   // 進頁(和寬度跨過 1024)當作剛到地面:2 到 4 秒後就離開(Bonnie 10/20;原本 15 到 40 秒)
    return { zones: [], at: 'ground', until: now + span(rnd || Math.random, CFG.firstMin, CFG.firstMax), changes: 0, lastFly: -1e9, recent: [], order: ['ground'], rest: 0, restAt: now, arrive: false, lane: null, measuredAt: -1e9, pend: 0, dirty: false, main: null, ms: 0 };
  }
  /* 出發去 key 的時候呼叫(空地待的時間含路上):地面是落下(travel 秒)再落地站好以後 2 到 5 秒(不剛落下就飛回去;第五輪審查 #1);空地 6 到 15 秒;離上次長休息 3 分鐘以上、要去的不是地面:這次長休息 20 到 30 秒(rest) */
  function arrived(m, key, now, rnd, travel) {
    m.at = key; m.lane = null;
    if (key !== 'ground') m.recent = [key].concat(m.recent.filter((k) => k !== key)).slice(0, CFG.recent);   // 地面不佔位子(只有一塊空地的頁面才會一直輪流)
    m.order = [key].concat(m.order.filter((k) => k !== key)).slice(0, CFG.recent + 2);   // 含地面的去過順序,新的在前(choose 用)
    m.changes++;
    if (key === 'ground') m.until = now + Math.round(((travel || 0) + CFG.landT) * 1000) + span(rnd, CFG.groundMin, CFG.groundMax);
    else if (now - m.restAt >= CFG.restEvery) { m.restAt = now; m.rest = m.until = now + span(rnd, CFG.restMin, CFG.restMax); }
    else m.until = now + span(rnd, CFG.stayMin, CFG.stayMax);
  }
  /* 在空地上(到了、站完 1 到 2 秒之後)下一個動作:多半站著;窄的(200 px 以下)站 4 到 8 秒、偶爾往空間多的那邊走一小段;
     寬的站 3 到 6 秒、走 2 到 5 秒,不跑。calm(地面):整條視窗寬也照窄的走,不在讀的人眼前走來走去(第三輪審查 #3)。回 { pose, left 拍數, dir } */
  function stroll(sp, x, rnd, calm) {
    const w = sp[1] - sp[0], narrow = !!calm || w < CFG.roomy, ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    if (w < 8 || rnd() < (narrow ? 0.8 : 0.6)) return { pose: 'idle', left: narrow ? ri(32, 64) : ri(24, 48) };
    const dir = sp[1] - x > x - sp[0] ? 1 : -1;
    return { pose: 'walk', left: narrow ? ri(8, 16) : ri(16, 40), dir: narrow || rnd() < 0.7 ? dir : -dir };
  }
  /* 重新量完:腳下那塊還在就回 { z };不在就回 80 px 內小跳得到、ok(z, tx) 通過的空地 { hop: { z, tx } };都沒有回 {}(落回地面) */
  function keepOrHop(zones, feetDoc, x, max, ok) {
    const z = zones.find((q) => Math.abs(q.feetDoc - feetDoc) < 2 && x >= q.lo - 1 && x <= q.hi + 1);
    if (z) return { z };
    const hop = hopNear(zones, feetDoc, x, max).find((c) => ok(c.z, c.tx));
    return hop ? { hop } : {};
  }
  /* 腳下那塊沒了:80 px 內小跳得到的空地,近的先 */
  function hopNear(zones, feetDoc, x, max) {
    return zones.map((z) => ({ z, tx: clamp(x, z.lo, z.hi) })).filter((c) => Math.abs(c.z.feetDoc - feetDoc) <= CFG.hopDy && Math.abs(c.tx - x) <= max)
      .sort((a, b) => Math.abs(a.tx - x) - Math.abs(b.tx - x));
  }
  /* 站的、要去的空地被捲到頂欄底下(往下讀的時候):從 feet(視窗座標)往下撲到看得到的空地,離上緣 200 px 以上的先、近的先;
     ok(z, tx) 是落地前的再確認。c:{ top, bottom, scrollY, BOXH }。回 choose 一樣的 { z, tx, how: 'fall', dur } 或 null(回地面;第五輪審查 #2) */
  function rescue(zones, x, feet, c, ok) {
    const B = c.BOXH || 51, fallDur = (dy) => Math.min(CFG.fallMax, Math.max(CFG.fallMin, dy / CFG.fallSpeed));
    const roomy = (q) => (q.f - B - c.top >= CFG.edge ? 1 : 0);
    return zones.map((z) => { const f = z.feetDoc - c.scrollY, tx = clamp(x, z.lo, z.hi); return { z, tx, f, dy: f - feet, dx: Math.abs(tx - x), d: fallDur(f - feet) }; })
      .filter((q) => q.dy > 2 && q.f - B - CFG.headroom >= c.top + 4 && q.f <= c.bottom && q.dx <= CFG.flySpeed * q.d)
      .sort((a, b) => roomy(b) - roomy(a) || (a.dy + a.dx) - (b.dy + b.dx))
      .map((q) => ({ z: q.z, tx: Math.round(q.tx), how: 'fall', dur: q.d })).find((d) => ok(d.z, d.tx)) || null;
  }
  /* 回到地面(落下、捲出去直接放回):在地面最多再待 2 到 5 秒,長休息不在地面 */
  function grounded(m, now) { m.at = 'ground'; m.rest = 0; m.until = Math.min(m.until, now + CFG.groundMax); }
  /* 標題的裝飾(::before、::after,例如頁面標題的黃色螢光筆)也是障礙:回它們在視窗裡的外框(Bonnie 10/20)。
     gcs = getComputedStyle。絕對定位的照 left、right、top、bottom、width、height(% 照標題的大小換算)放在標題的框裡,再加上 transform(轉一點點的螢光筆);
     不是絕對定位的(跟著字排的)整個標題框都算。只看 h1 到 h6 */
  function decoRects(e, gcs) {
    if (!e || !/^H[1-6]$/.test(e.tagName)) return [];
    const out = [];
    let r = null, es = null;
    for (const p of ['::before', '::after']) {
      const s = gcs(e, p);
      if (!s || !s.content || s.content === 'none' || s.content === 'normal' || s.display === 'none') continue;
      r = r || e.getBoundingClientRect();
      if (s.position !== 'absolute' && s.position !== 'fixed') { out.push(r); continue; }
      es = es || gcs(e);
      const bw = (k) => parseFloat(es['border' + k + 'Width']) || 0;
      const cl = r.left + bw('Left'), cr = r.right - bw('Right'), ct = r.top + bw('Top'), cb = r.bottom - bw('Bottom');
      const v = (x, full) => { const n = parseFloat(x); return !isFinite(n) ? null : /%$/.test(String(x).trim()) ? n * full / 100 : n; };
      const W = cr - cl, H = cb - ct, L = v(s.left, W), R = v(s.right, W), T = v(s.top, H), B = v(s.bottom, H), w = v(s.width, W), h = v(s.height, H);
      const l = L !== null ? cl + L : R !== null && w !== null ? cr - R - w : cl, rr = R !== null ? cr - R : w !== null ? l + w : cr;
      const t = T !== null ? ct + T : B !== null && h !== null ? cb - B - h : ct, bb = B !== null ? cb - B : h !== null ? t + h : cb;
      const m = /matrix\(([^)]+)\)/.exec(s.transform || ''), k = m ? m[1].split(',').map(Number) : null;
      let x0 = l, x1 = rr, y0 = t, y1 = bb;
      if (k && k.length === 6 && k.every(isFinite)) {   // 繞中心轉、縮放、位移後的外框
        const cx = (l + rr) / 2 + k[4], cy = (t + bb) / 2 + k[5], hw = (Math.abs(k[0]) * (rr - l) + Math.abs(k[2]) * (bb - t)) / 2, hh = (Math.abs(k[1]) * (rr - l) + Math.abs(k[3]) * (bb - t)) / 2;
        x0 = cx - hw; x1 = cx + hw; y0 = cy - hh; y1 = cy + hh;
      }
      if (x1 > x0 && y1 > y0) out.push({ left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0 });
    }
    return out;
  }
  /* 落地前用 elementsFromPoint 再確認時不算的:腳下那張卡片、整條橫幅 */
  const landObs = (obs, feet, W) => obs.filter((o) => !(standing(o, feet) || (o.k === 'c' && o.r - o.l > CFG.band * W)));
  /* 換空地途中第 t 秒:腳的位置(文件座標)、橫移進度 q、畫哪一格。g:{ how, F 往上飛的 flyFrames, f0, f1, D 秒, plan flyPlan }。
     小跳:直線加拋物線 64 px;往上飛:照 flyFrames 的位移(下拍一開始衝最快);平飛:中段拱起 24 px、flyPlan 的格;落下:越掉越快、fly 第 1、2 格慢速 */
  function glideAt(g, t) {
    const p = Math.min(1, t / g.D), f0 = g.f0, f1 = g.f1;
    if (g.how === 'hop') return { feet: f0 + (f1 - f0) * p - 64 * p * (1 - p), q: p, p, pose: 'takeoff', k: p < 0.5 ? 1 : 2, v: 0 };
    if (g.F) {
      const F = g.F, f = Math.min(F.n - 0.001, t * 12), n = Math.floor(f), fr = f - n, e = F.cum[n + 1] - F.cum[n];
      return { feet: f0 + F.cum[n] + e * (e < 0 ? 1 - (1 - fr) * (1 - fr) : fr), q: ease(p), p, pose: 'fly', k: F.frames[n][0], v: F.frames[n][1] };
    }
    if (g.how === 'fly') {
      const P = g.plan, i = Math.floor(t * 12), s = P[i % P.length];
      return { feet: f0 + (f1 - f0) * ease(p) - CFG.arch * Math.sin(Math.PI * p), q: ease(p), p, pose: 'fly', k: s[0], v: (s[1] + Math.floor(i / P.length)) % 2 };
    }
    return { feet: f0 + (f1 - f0) * p * p, q: ease(p), p, pose: 'fly', k: Math.floor(t * 6) % 2, v: 0 };
  }

  /* 學生在讀、在打字:欄位有焦點、20 秒內按過鍵、有選取的文字、1 秒內捲動過(原本 3 秒;第五輪審查 #2)。5 秒內滑鼠在主要內容那一欄裡動過不算整個忙,
     只由 pointer()、pointerY() 給位置,choose 當它剛忙完(一側的路照樣走),不往那附近起飛、落下(不然一般用滑鼠的學生幾乎看不到小雞離開地面)。
     滑鼠移到小雞上(box() 是小雞現在的位置,不量版面):hover(true),移開 1 秒後 hover(false)。
     滑鼠停著不動、小雞飛走了(飛的時候點擊穿過,收不到 pointerleave):每秒拿最後的滑鼠位置對小雞現在的框,不在底下就 hover(false)(第二輪審查 #1)。
     o:{ now(), mainLR() → { l, r } | null, top() 頂欄下緣(這以上的滑鼠不算在主要內容裡;第五輪審查 #0), box() → { l, t, w, h } | null, hover(on) } */
  /* 不忙的時間從進頁開始算(held 起點是進頁的時間;第三輪審查 #4) */
  function tracker(win, doc, o) {
    const t = { key: -1e9, scroll: -1e9, inMain: -1e9, held: o.now(), mouse: null, mainX: 0, mainY: 0, pos: null, y: win.scrollY || 0, acc: 0, step: 0, dir: 0, gs: [] };
    let ht = 0, hk = '';   // hk:排著的是 check(每秒再看)還是 out(移開 1 秒)
    const stay = () => { if (ht) { win.clearTimeout(ht); ht = 0; hk = ''; } };
    const arm = (k, fn) => { stay(); hk = k; ht = win.setTimeout(() => { ht = 0; hk = ''; fn(); }, CFG.hoverOut); };
    const under = (b, p) => !!(b && p) && p.x >= b.l && p.x <= b.l + b.w && p.y >= b.t && p.y <= b.t + b.h;
    const recheck = () => { if (under(o.box && o.box(), t.pos)) arm('check', recheck); else o.hover(false); };
    const leave = () => { if (hk !== 'out') arm('out', () => o.hover(false)); };
    doc.addEventListener('keydown', () => { t.key = o.now(); }, true);
    win.addEventListener('scroll', () => {   // 一次捲動(中間停不到 0.5 秒的算同一次)捲了多遠、往哪邊;最近三次開始的時間(scrollInfo 估節奏)
      const n = o.now(), y = win.scrollY || 0;
      if (n - t.scroll > CFG.gesture) { t.gs = [n].concat(t.gs).slice(0, 3); t.acc = 0; }
      t.acc += y - t.y; t.y = y; t.scroll = n;
      if (Math.abs(t.acc) >= 1) { t.step = Math.abs(t.acc); t.dir = Math.sign(t.acc); }
    }, { passive: true });
    doc.addEventListener('pointerout', (e) => { if (!e.relatedTarget) t.pos = null; }, true);   // 滑鼠離開視窗
    doc.addEventListener('pointermove', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const n = o.now(), m = o.mainLR();
      t.mouse = { x: e.clientX, t: n };
      t.pos = { x: e.clientX, y: e.clientY };
      if (m && e.clientX >= m.l && e.clientX <= m.r && !(o.top && e.clientY < o.top())) { t.inMain = n; t.mainX = e.clientX; t.mainY = e.clientY; }   // 頂欄上的不算(第五輪審查 #0)
      const b = o.box && o.box();
      if (!b) return;
      if (under(b, t.pos)) { arm('check', recheck); o.hover(true); } else leave();
    }, { passive: true });
    function field() {
      const a = doc.activeElement;
      return a && a !== doc.body && (a.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) ? a : null;
    }
    function sel() {
      try { const s = win.getSelection && win.getSelection(); return s && !s.isCollapsed && s.rangeCount ? s : null; } catch (e) { return null; }
    }
    const until = () => Math.max(t.key + CFG.busyKey, t.scroll + CFG.busyScroll, t.held);
    function busy(n) { if (field() || sel()) { t.held = n; return true; } return n < until(); }
    return {
      busy, stay, leave,
      calm(n) { return busy(n) ? 0 : n - until(); },
      pointer(n) { return n - t.inMain <= CFG.busyMouse ? t.mainX : null; },
      pointerY(n) { return n - t.inMain <= CFG.busyMouse ? t.mainY : null; },   // choose 的 mouseY
      scrolled(n) { return n - t.scroll; },   // 離上次捲動幾毫秒(choose 的 scrolled)
      /* choose 的 sc:上一次捲了多遠(step)、往哪邊(dir 1 往下讀、-1 往上)、是不是只能往那邊捲(only:在最上面、最下面),和照最近的間隔(兩個取短的)估的下一次(next;只捲過一次、間隔超過 15 秒是 0) */
      scrollInfo() {
        const g = t.gs, d = g.slice(1).map((v, i) => g[i] - v), y = win.scrollY || 0, de = doc.documentElement;
        const end = y <= 0 ? 1 : de && y + win.innerHeight >= de.scrollHeight - 1 ? -1 : 0;   // 在最上面只能往下捲,在最下面只能往上
        return { step: t.step, dir: end || t.dir, only: !!end, next: d.length && Math.max(...d) <= CFG.cadence ? g[0] + Math.min(...d) : 0 };
      },
      near(n) {
        const out = [];
        if (t.mouse && n - t.mouse.t <= CFG.nearT) out.push(t.mouse.x);
        const cx = (r) => { if (r && r.width > 0) out.push((r.left + r.right) / 2); };
        try { const f = field(); if (f) cx(f.getBoundingClientRect()); const s = sel(); if (s) cx(s.getRangeAt(0).getBoundingClientRect()); } catch (e) { /* 量不到就不算 */ }
        return out;
      },
    };
  }

  /* 在瀏覽器裡量一次(捲動停下、視窗大小改變、內容變動時由 pet-roam2.js 呼叫,最多每秒一次)。
     io:{ doc, mainEl, W, H, docH, top, bottom, scrollY, S, BOXH, mainL, mainR, keep 小雞正站著的那層(視窗座標)| undefined, util(pet-roam2 的 util), env, now() } */
  function measure(io) {
    const t0 = io.now(), els = [], heads = [], bands = [];
    let out = null, seen = 0, full = false;   // out:整塊在視窗外(或不算)的元素,文件順序裡它的子元素都跳過,不量(第三輪審查 #5)
    for (const e of io.doc.body.querySelectorAll('*')) {
      if (out && out.contains(e)) continue;
      out = null;
      if (e === io.mainEl) continue;
      if (io.env.skip(e)) { out = e; continue; }
      if (++seen > CFG.maxEls) { full = true; break; }
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;   // 0 大小的外框(display: contents 之類)裡面還是可能有東西
      if (r.bottom <= io.top || r.top >= io.H || r.right <= 0 || r.left >= io.W) { out = e; continue; }   // 從視窗外的外框跑出來的東西,落地前 elementsFromPoint 還會再確認
      if (r.width * r.height > 0.85 * io.W * Math.max(io.docH || 0, io.H)) continue;   // 整頁的外框
      els.push(e);
      if (e.tagName === 'H1' && io.mainEl && io.mainEl.contains(e)) heads.push(r);
      if (r.width > CFG.band * io.W) { const s = io.env.style(e), ps = e.parentElement ? io.env.style(e.parentElement) : null; if (alpha(s.backgroundColor) > 0.05 && (!ps || s.backgroundColor !== ps.backgroundColor)) bands.push(r); }   // 只有頁面標題;卡片裡的標題下緣不往右延伸(會站在半空)
    }
    if (full) return { zones: [], ms: io.now() - t0, n: els.length, full };   // 沒量完:後面的元素可能就在視窗裡,不當空地(留在地面)
    const fe = io.doc.querySelector('footer');
    const fr = fe && fe.getClientRects().length ? fe.getBoundingClientRect() : null;
    const ctx = { W: io.W, S: io.S, BOXH: io.BOXH, top: io.top, bottom: io.bottom, scrollY: io.scrollY, mainL: io.mainL, mainR: io.mainR, keep: io.keep, freeSpans: io.util.freeSpans };
    const obs = io.util.obstaclesOf(els, { text: true, media: true, cards: true }, io.env);
    const floors = floorsOf(obs, { heads, bands, foot: fr && fr.top < io.H ? fr : null }, ctx);
    const zones = zonesOf(cleanObs(obs, ctx), floors, ctx);
    return { zones, ms: io.now() - t0, n: els.length, full };
  }

  const api = Object.freeze({ version: 1, CFG, cleanObs, floorsOf, zonesOf, routeOf, choose, memory, arrived, grounded, stroll, hopNear, keepOrHop, rescue, landObs, decoRects, glideAt, tracker, measure });
  if (typeof module === 'object' && module && module.exports) { module.exports = api; return; }
  if (!root.PET_ROAM_ZONES) root.PET_ROAM_ZONES = api;
})(typeof window !== 'undefined' ? window : globalThis);
