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
    minWalk: 48, headroom: 8,   // 空地寬 96 以上(至少走得動 48 px)、高 59 以上(框 51 加 8)
    sideWalk: 24,               // 兩側空白走得動 24 px 就留(1280 只有 48,有捲軸時更少;第二輪審查 #2)
    stayMin: 15000, stayMax: 40000, arriveMin: 1000, arriveMax: 2000,
    longEvery: 3, longMin: 45000, longMax: 90000, retry: 5000, retryLand: 1000,
    flyGap: 20000, calm: 8000,  // 兩次起飛至少隔 20 秒;不忙超過 8 秒才起飛
    walkGap: 8, hopDy: 64, hopDx: 80, hopDur: 0.4,
    flySpeed: 400, arch: 24, reach: 2.5, fallMin: 0.6, fallMax: 1.2, fallSpeed: 520, walkSpeed: 16,
    busyKey: 20000, busyScroll: 3000, busyMouse: 5000, nearX: 240, nearT: 10000,
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
    const n = spread.length, layers = n <= CFG.sideLayers ? spread : [0, 1, 2].map((i) => spread[Math.round(i * (n - 1) / 2)]);
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
    if (t > CFG.reach) return null;
    if (dy > 2) { const F = o.flyFrames(dy, t); return F ? { how: 'fly', dur: F.dur } : null; }
    if (dy >= -CFG.arch) return { how: 'fly', dur: Math.max(CFG.fallMin, t) };
    const d = fallDur(-dy);
    return dx <= CFG.flySpeed * d ? { how: 'fall', dur: d } : null;
  }

  /* 下一個去哪裡。c:{ zones, here, ground, now, busy, calm 不忙了多久, near 學生正在用的 x, mouse 5 秒內滑鼠在主要內容裡的 x 或 null, lastFly, recent, order,
     H, top, bottom, scrollY, S, BOXH, flyFrames, rnd }。同一條地板中間有障礙的兩塊(量的時候沒併起來)改小跳,遠一點的改平飛。
     起飛和落下的路線(起點到終點的小雞框)離 mouse 水平 240 px 內不走;最近去過的只在沒有別的地方去時才去,挑最久沒去的 */
  function choose(c) {
    const S = c.S || 48, B = c.BOXH || 51, here = c.here, list = [];
    const opt = { busy: c.busy, flyFrames: c.flyFrames, S };
    const route = (z, tx) => {
      let r = routeOf(here, z, tx, opt);
      if (r && r.how === 'walk') r = Math.abs(tx - here.x) <= CFG.hopDx ? { how: 'hop', dur: CFG.hopDur } : c.busy ? null : { how: 'fly', dur: Math.max(CFG.fallMin, Math.abs(tx - here.x) / CFG.flySpeed) };
      if (r && r.how === 'fly' && (c.now - c.lastFly < CFG.flyGap || c.calm < CFG.calm || r.dur > CFG.reach)) return null;
      const m = c.mouse;
      if (r && r.how !== 'hop' && m !== null && m !== undefined && Math.max(Math.min(here.x, tx) - m, m - (Math.max(here.x, tx) + S), 0) <= CFG.nearX) return null;
      return r;
    };
    const old = [];
    for (const q of c.zones) {
      if (q.key === here.key) continue;
      const feet = q.feetDoc - c.scrollY;
      if (feet - B - CFG.headroom < c.top + 4 || feet > c.bottom) continue;
      const z = { key: q.key, kind: q.kind, feet, lo: q.lo, hi: q.hi, src: q };
      const nx = clamp(here.x, q.lo, q.hi), r = route(z, nx);
      if (!r) continue;
      if (c.recent.indexOf(q.key) > -1) { old.push({ z, w: 1, nx, r, age: c.recent.indexOf(q.key) }); continue; }
      let w = 1;
      const mid = feet - B / 2;
      if (mid >= c.H * CFG.mid && mid <= c.H * (1 - CFG.mid)) w *= CFG.wMid;
      if (q.hi - q.lo >= CFG.roomy) w *= CFG.wRoomy;
      if (q.kind !== 'main' && q.hi - q.lo < CFG.narrow) w *= CFG.wNarrow;
      if ((c.near || []).some((p) => Math.max(q.lo - p, p - (q.hi + S), 0) <= CFG.nearX)) w *= CFG.wNear;
      list.push({ z, w, nx, r });
    }
    /* 別的空地都剛去過:最久沒去的那塊跟地面比,照 order(含地面的去過順序)去比較久沒去的那個;沒有 order 就一起抽。
       不然疊著的兩塊(高的那塊只有從低的那塊飛得到),高的那塊去過一次以後只剩地面和低的那塊輪流(第三輪審查 #2) */
    const fresh = list.length;
    let g = null;
    if (!here.ground) { const r = route(c.ground, here.x); if (r) list.push(g = { z: c.ground, w: 1, nx: here.x, r }); }
    if (!fresh && old.length) {
      const o = old.sort((a, b) => b.age - a.age)[0], ord = c.order || [], gi = ord.indexOf('ground'), oi = ord.indexOf(o.z.key);
      if (!g || gi < 0 || oi < 0) list.push(o);
      else if (oi > gi) list.splice(list.indexOf(g), 1, o);
    }
    let sum = 0;
    for (const it of list) sum += it.w;
    if (!(sum > 0)) return null;
    let v = c.rnd() * sum, it = list[list.length - 1];
    for (const q of list) { if ((v -= q.w) < 0) { it = q; break; } }
    let tx = it.nx, r = it.r;
    if (!it.z.ground) {
      const t2 = clamp(it.nx + (c.rnd() - 0.5) * 240, it.z.lo, it.z.hi), r2 = route(it.z, t2);
      if (r2 && r2.how === r.how) { tx = Math.round(t2); r = r2; }
    }
    return { z: it.z.ground ? it.z : it.z.src, tx, how: r.how, dur: r.dur };
  }

  /* 這一頁的走動紀錄(只在記憶體裡):空地、現在在哪、下次換地方的時間、換了幾次、上次起飛、最近去過的 */
  function memory(now, rnd) {   // 進頁(和寬度跨過 1024)當作剛到地面:先待 15 到 40 秒(第三輪審查 #4)
    const r = rnd || Math.random;
    return { zones: [], at: 'ground', until: now + CFG.stayMin + Math.floor(r() * (CFG.stayMax - CFG.stayMin + 1)), changes: 0, lastFly: -1e9, recent: [], order: ['ground'], rest: 0, arrive: false, measuredAt: -1e9, pend: 0, dirty: false, main: null, ms: 0 };
  }
  function arrived(m, key, now, rnd) {
    m.at = key;
    if (key !== 'ground') m.recent = [key].concat(m.recent.filter((k) => k !== key)).slice(0, CFG.recent);   // 地面不佔位子(只有一塊空地的頁面才會一直輪流)
    m.order = [key].concat(m.order.filter((k) => k !== key)).slice(0, CFG.recent + 2);   // 含地面的去過順序,新的在前(choose 用)
    m.changes++;
    m.until = now + CFG.stayMin + Math.floor(rnd() * (CFG.stayMax - CFG.stayMin + 1));
  }
  /* 在空地上(到了、站完 1 到 2 秒之後)下一個動作:多半站著;窄的(200 px 以下)站 4 到 8 秒、偶爾往空間多的那邊走一小段;
     寬的站 3 到 6 秒、走 2 到 5 秒,不跑。calm(地面):整條視窗寬也照窄的走,不在讀的人眼前走來走去(第三輪審查 #3)。回 { pose, left 拍數, dir } */
  function stroll(sp, x, rnd, calm) {
    const w = sp[1] - sp[0], narrow = !!calm || w < CFG.roomy, ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    if (w < 8 || rnd() < (narrow ? 0.8 : 0.6)) return { pose: 'idle', left: narrow ? ri(32, 64) : ri(24, 48) };
    const dir = sp[1] - x > x - sp[0] ? 1 : -1;
    return { pose: 'walk', left: narrow ? ri(8, 16) : ri(16, 40), dir: narrow || rnd() < 0.7 ? dir : -dir };
  }
  /* 腳下那塊沒了:80 px 內小跳得到的空地,近的先 */
  function hopNear(zones, feetDoc, x, max) {
    return zones.map((z) => ({ z, tx: clamp(x, z.lo, z.hi) })).filter((c) => Math.abs(c.z.feetDoc - feetDoc) <= CFG.hopDy && Math.abs(c.tx - x) <= max)
      .sort((a, b) => Math.abs(a.tx - x) - Math.abs(b.tx - x));
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

  /* 學生在讀、在打字:欄位有焦點、20 秒內按過鍵、有選取的文字、3 秒內捲動過。5 秒內滑鼠在主要內容那一欄裡動過不算整個忙,
     只由 pointer() 給位置,choose 不往那附近起飛、落下(不然一般用滑鼠的學生幾乎看不到小雞離開地面)。
     滑鼠移到小雞上(box() 是小雞現在的位置,不量版面):hover(true),移開 1 秒後 hover(false)。
     滑鼠停著不動、小雞飛走了(飛的時候點擊穿過,收不到 pointerleave):每秒拿最後的滑鼠位置對小雞現在的框,不在底下就 hover(false)(第二輪審查 #1)。
     o:{ now(), mainLR() → { l, r } | null, box() → { l, t, w, h } | null, hover(on) } */
  /* 不忙的時間從進頁開始算(held 起點是進頁的時間;第三輪審查 #4) */
  function tracker(win, doc, o) {
    const t = { key: -1e9, scroll: -1e9, inMain: -1e9, held: o.now(), mouse: null, mainX: 0, pos: null };
    let ht = 0, hk = '';   // hk:排著的是 check(每秒再看)還是 out(移開 1 秒)
    const stay = () => { if (ht) { win.clearTimeout(ht); ht = 0; hk = ''; } };
    const arm = (k, fn) => { stay(); hk = k; ht = win.setTimeout(() => { ht = 0; hk = ''; fn(); }, CFG.hoverOut); };
    const under = (b, p) => !!(b && p) && p.x >= b.l && p.x <= b.l + b.w && p.y >= b.t && p.y <= b.t + b.h;
    const recheck = () => { if (under(o.box && o.box(), t.pos)) arm('check', recheck); else o.hover(false); };
    const leave = () => { if (hk !== 'out') arm('out', () => o.hover(false)); };
    doc.addEventListener('keydown', () => { t.key = o.now(); }, true);
    win.addEventListener('scroll', () => { t.scroll = o.now(); }, { passive: true });
    doc.addEventListener('pointerout', (e) => { if (!e.relatedTarget) t.pos = null; }, true);   // 滑鼠離開視窗
    doc.addEventListener('pointermove', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const n = o.now(), m = o.mainLR();
      t.mouse = { x: e.clientX, t: n };
      t.pos = { x: e.clientX, y: e.clientY };
      if (m && e.clientX >= m.l && e.clientX <= m.r) { t.inMain = n; t.mainX = e.clientX; }
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
     io:{ doc, mainEl, W, H, docH, top, bottom, scrollY, S, BOXH, mainL, mainR, util(pet-roam2 的 util), env, now() } */
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
    const ctx = { W: io.W, S: io.S, BOXH: io.BOXH, top: io.top, bottom: io.bottom, scrollY: io.scrollY, mainL: io.mainL, mainR: io.mainR, freeSpans: io.util.freeSpans };
    const obs = io.util.obstaclesOf(els, { text: true, media: true, cards: true }, io.env);
    const floors = floorsOf(obs, { heads, bands, foot: fr && fr.top < io.H ? fr : null }, ctx);
    const zones = zonesOf(cleanObs(obs, ctx), floors, ctx);
    return { zones, ms: io.now() - t0, n: els.length, full };
  }

  const api = Object.freeze({ version: 1, CFG, cleanObs, floorsOf, zonesOf, routeOf, choose, memory, arrived, stroll, hopNear, landObs, glideAt, tracker, measure });
  if (typeof module === 'object' && module && module.exports) { module.exports = api; return; }
  if (!root.PET_ROAM_ZONES) root.PET_ROAM_ZONES = api;
})(typeof window !== 'undefined' ? window : globalThis);
