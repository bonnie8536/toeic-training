/* 塗鴉食物的圖(小雞第二階段規格 4.2)。原檔在 repo 外:D:/claudecode/刷刷英文開發/小雞/第二階段/food-art.js(2026-10-17),
   預覽 D:/claudecode/刷刷英文開發/小雞/第二階段/食物預覽.html。要改圖先改原檔、在預覽看過,再整份複製過來(保留這段開頭)。
   這裡只畫圖,不讀寫任何儲存。托盤裡每種只用 render(id, { size: 40, variant: 0 }) 畫一張、不動(規格 3.3);
   會抖的只有舞台上 mount 的那一份,面板關掉時 stop()。 */
/* 塗鴉食物(小雞第二階段):跟塗鴉小雞同一套畫法。抖動的黑色外框 #151515、大而密的塗鴉圈圈填色、
   每種食物畫 3 種抖動(麵包蟲 4 格蠕動、地瓜 3 格熱氣),播放時輪流,線條會沸騰。
   畫在 100×100 的邏輯畫布裡,食物底部貼著地面 ground = 84(跟小雞的腳底對齊時用)。
   黃色塗鴉不用遮罩硬切:圈心只在食物裡面走,靠邊的圈自動縮小、可以塗出去一點點。
   被吃:小雞從左邊啄(吃東西的姿勢是面向右邊),所以咬痕和被挑走的那一顆都從左邊開始。
     - bite 類(玉米、青江菜、小番茄、西瓜、地瓜):每啄一下,左邊少一口(扇形咬痕,咬痕邊緣補黑線)。
     - build 類(飼料、豌豆、藍莓、麵包蟲):飼料堆變矮、豆子一顆一顆被挑走、藍莓一顆一顆不見、麵包蟲從尾巴變短。
     - 每啄一下噴出食物顏色的碎屑。step = steps 時食物吃完,只剩碎屑落地。
   用法:
     const f = FoodArt.mount(canvas, 'corn', { size: 40 });     // 托盤裡的小圖,自己會抖
     f.bite();          // 啄一下(跟小雞同步:ChickArt 的 eat 姿勢 onTick 收到 frame 3 或 5 時呼叫)
     f.finish();        // 直接吃完(減少動態時用:食物直接消失)
     f.setFood('pea'); f.reset(); f.stop();
     FoodArt.render('corn', { size: 64, variant: 0, step: 0, crumb: null }) → 一張畫好的 canvas
     FoodArt.draw(ctx, 'corn', { x, y, size, variant, step, crumb })  // 畫進別人的畫布(css 像素)
   2026-10-17 初版。 */
(function () {
  const W = 100, H = 100, GROUND = 84;
  const INK = '#151515', SHINE = '#ffffff';
  const RAD = Math.PI / 180;
  const OUT = 3.0;                         // 外框粗細(邏輯像素)
  let INKW = 1;                            // 畫得小時線條加粗
  const inkFor = (size) => (!size || size >= 96 ? 1 : Math.min(2.1, 1 + (96 - size) / 58));

  function rng(seed) {                     // mulberry32,跟小雞同一個
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

  /* ---------- 幾何 ---------- */
  const add = (p, q, k = 1) => [p[0] + q[0] * k, p[1] + q[1] * k];
  const unit = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  function rotAbout(pts, cx, cy, deg) {
    const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
    return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
  }
  function ellipse(cx, cy, rx, ry, n, dent) {
    const pts = [];
    for (let i = 0; i < (n || 40); i++) {
      const a = i / (n || 40) * Math.PI * 2;
      const k = dent ? 1 - dent.d * Math.exp(-Math.pow((a - dent.at) / dent.w, 2)) - dent.d * Math.exp(-Math.pow((a - dent.at - Math.PI * 2) / dent.w, 2)) : 1;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return pts;
  }
  /* catmull-rom:穿過控制點的平滑曲線 */
  function spline(ctrl, closed, seg) {
    const n = ctrl.length, out = [], S = seg || 8, m = closed ? n : n - 1;
    const P = (i) => (closed ? ctrl[(i + n) % n] : ctrl[Math.max(0, Math.min(n - 1, i))]);
    for (let i = 0; i < m; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let s = 0; s < S; s++) {
        const t = s / S, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    if (!closed) out.push(ctrl[n - 1]);
    return out;
  }
  /* 葉子:從 p0 長到 p1 的尖葉,中間最寬 w,bend 讓葉子往一邊彎 */
  function leaf(p0, p1, w, bend) {
    const d = [p1[0] - p0[0], p1[1] - p0[1]], n = unit([-d[1], d[0]]);
    const q = add([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], n, (bend || 0) * 2);   // 二次曲線的控制點
    const at = (t) => [0, 1].map((k) => (1 - t) * (1 - t) * p0[k] + 2 * t * (1 - t) * q[k] + t * t * p1[k]);
    const L = [], R = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14, c = at(t), hw = w * Math.pow(Math.sin(Math.PI * t), 0.75) * (t < 0.5 ? 0.85 : 1);
      L.push(add(c, n, hw)); R.push(add(c, n, -hw));
    }
    return L.concat(R.reverse().slice(1, -1));
  }
  /* 管子:沿著中線長出有寬度的形狀(玉米棒、地瓜、麵包蟲);cap = round 圓頭、flat 平切、jag 鋸齒、jagRound 圓頭鋸齒(咬過、剝開) */
  function tube(center, rf, t0, t1, cap0, cap1) {
    const N = center.length - 1;
    const at = (t) => {
      const f = Math.max(0, Math.min(N - 1e-6, t * N)), i = Math.floor(f), k = f - i;
      const p = center[i], q = center[i + 1];
      return { p: [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k], d: unit([q[0] - p[0], q[1] - p[1]]) };
    };
    const M = Math.max(6, Math.round((t1 - t0) * 50)), L = [], R = [];
    for (let i = 0; i <= M; i++) {
      const t = t0 + (t1 - t0) * i / M, { p, d } = at(t), n = [-d[1], d[0]], r = rf(t);
      L.push(add(p, n, r)); R.push(add(p, n, -r));
    }
    const cap = (t, kind, sgn) => {
      const { p, d: d0 } = at(t), d = [d0[0] * sgn, d0[1] * sgn], n = [-d0[1] * sgn, d0[0] * sgn], r = rf(t), pts = [];
      if (kind === 'flat') return pts;
      if (kind === 'jag') {
        for (let i = 1; i < 7; i++) pts.push(add(add(p, n, r * (1 - 2 * i / 7)), d, (i % 2 ? 1 : -1) * r * 0.16));
        return pts;
      }
      const teeth = kind === 'jagRound';
      for (let i = 1; i < 12; i++) {
        const a = i / 12 * Math.PI, k = teeth ? (i % 2 ? 0.88 : 1) : 1;
        pts.push(add(p, [n[0] * Math.cos(a) + d[0] * Math.sin(a), n[1] * Math.cos(a) + d[1] * Math.sin(a)], r * k));
      }
      return pts;
    };
    const end = cap(t1, cap1, 1), start = cap(t0, cap0, -1);
    return { poly: L.concat(end, R.reverse(), start), end, at };
  }
  function bbox(poly) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    poly.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }
  function inside(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function distEdge(poly, x, y) {
    let m = 1e9;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[j], [bx, by] = poly[i], dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      m = Math.min(m, Math.hypot(x - ax - dx * t, y - ay - dy * t));
    }
    return m;
  }
  function spans(poly, y) {
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y)) xs.push((xj - xi) * (y - yi) / (yj - yi) + xi);
    }
    xs.sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
    return out;
  }
  /* 長的邊中間補點,抖動才會落在整條線上;原本的角保留 */
  function densify(pts, closed, step) {
    const out = [], n = pts.length, S = step || 5;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n], k = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / S);
      for (let j = 0; j < k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
    }
    if (!closed) out.push(pts[n - 1]);
    return out;
  }

  /* ---------- 筆觸 ---------- */
  function curve(ctx, p) {
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    const last = p[p.length - 1];
    ctx.lineTo(last[0], last[1]);
  }
  /* 一條手畫的線;closed 時從隨機的地方起筆,收筆多畫一小段蓋過起點(像一筆畫回來) */
  function stroke(ctx, r, pts, w, color, jit, closed) {
    const j = jit === undefined ? 0.6 : jit;
    let p = densify(pts, closed, 5);
    if (closed) { const s = Math.floor(r() * p.length); p = p.slice(s).concat(p.slice(0, s), p.slice(s, s + 2)); }
    p = p.map(([x, y]) => [x + (r() - 0.5) * 2 * j, y + (r() - 0.5) * 2 * j]);
    ctx.strokeStyle = color || INK;
    ctx.lineWidth = w * INKW;
    curve(ctx, p);
    ctx.stroke();
  }
  function solid(ctx, poly, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }
  /* 塗鴉填色:一行一行來回繞大圈。審查後(2026-10-17)跟小雞放在一起比對過:
     - 圈半徑一律約 16(56px 時約 9px,跟面板裡 160px 小雞的圈看起來一樣大),不再每種食物各自一個大小。
     - 小零件(玉米葉、西瓜皮、豆子、麵包蟲的頭)圈半徑跟著零件最厚的地方縮,畫成 1、2 個大圈,不再一串小圈。
     - 圈心只走在形狀裡面,靠邊的圈最多塗出去約 R 的三分之一(跟小雞一樣塗出去一點,不硬切)。
     - 筆畫粗 2(小圖照比例加粗),原本 1.25 太細。 */
  const LOOP = 16;
  function thickness(poly) {               // 形狀最厚的地方:裡面離邊最遠的距離(取樣)
    const b = bbox(poly);
    let m = 0;
    for (let y = b.y0 + 1; y < b.y1; y += 2) for (let x = b.x0 + 1; x < b.x1; x += 2) if (inside(poly, x, y)) m = Math.max(m, distEdge(poly, x, y));
    return m;
  }
  function scribble(ctx, r, poly, color) {
    const b = bbox(poly);
    const R = Math.min(LOOP, Math.max(3.5, thickness(poly) * 1.6 + 2)), spill = R * 0.32, gap = R * 0.42;
    const rows = Math.max(1, Math.round(b.h / gap));
    const segs = [];
    for (let row = 0; row < rows; row++) {
      const y0 = b.y0 + b.h * (row + 0.5) / rows + (r() - 0.5) * gap * 0.4;
      const dir = row % 2 ? -1 : 1;
      const sp = spans(poly, y0);
      (dir > 0 ? sp : sp.slice().reverse()).forEach(([a, z]) => {
        const pts = [], ph = [r() * 6, r() * 6, r() * 6];
        let ang = r() * Math.PI * 2;
        const a0 = ang, x1 = a + 0.5, x2 = z - 0.5;
        let x = dir > 0 ? x1 : x2;
        for (let g = 0; g < 4000; g++) {
          const step = 0.42 + r() * 0.08;
          ang += step;
          x += dir * 0.62 * R * step / (Math.PI * 2) * (0.8 + r() * 0.4);
          if ((dir > 0 ? x > x2 : x < x1) && ang - a0 > Math.PI * 2) break;
          const cx = Math.max(x1, Math.min(x2, x));
          const cy = y0 + R * 0.12 * Math.sin(cx / (R * 2.2) + ph[0]);
          const d = inside(poly, cx, cy) ? distEdge(poly, cx, cy) : 0;
          const rad = Math.max(1.5, Math.min(R * (1 + 0.16 * Math.sin(ang * 0.16 + ph[1])), d + spill));
          const ratio = 0.86 + 0.12 * Math.sin(ang * 0.21 + ph[2]);
          pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * ratio]);
        }
        if (pts.length > 1) segs.push(pts);
      });
    }
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.0 * (1 + (INKW - 1) * 0.9);
    ctx.lineJoin = ctx.lineCap = 'round';
    let run = null;
    segs.forEach((sg) => {   // 跟上一段接得起來(中間點在形狀裡)就一筆畫下去,不然另起一筆
      if (run) {
        const a = run[run.length - 1], c = sg[0];
        if (inside(poly, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2)) { run = run.concat(sg); return; }
        curve(ctx, run); ctx.stroke();
      }
      run = sg;
    });
    if (run) { curve(ctx, run); ctx.stroke(); }
    ctx.restore();
  }

  /* ---------- 食物 ----------
     build(phase, step) 回傳 { ops, sil }:ops 依序畫,sil 是食物輪廓(咬痕判斷「在食物裡面」用)。
     op:{ fill, color, R } 塗鴉填色;{ solid, color } 實心;{ out, w } 封閉外框;{ line, w, color, jit } 開放的線 */
  const C = {
    grain: '#c98a1c', corn: '#ffd23a', cornLine: '#c98a1c', husk: '#7cc242',
    leaf: '#5fb84a', stalk: '#eef5e6', pod: '#8ccf5a', pea: '#5aa83a',
    berry: '#4a5bd0', crown: '#2c357f', tomato: '#e8402f', calyx: '#3f9a3a',
    flesh: '#f2545b', rind: '#3f9a3a', seed: '#151515', yamSkin: '#b5536b', yamFlesh: '#f6b13c',
    worm: '#d9a45b', wormLine: '#8a5a1e',
  };

  /* 飼料(審查後重畫):一顆一顆分開的穀粒鬆鬆地堆成小堆,顆粒之間有縫,旁邊散幾顆。
     原本實心的小山加圓點,40px 看起來像饅頭。托盤寫「顆」,圖也是一顆一顆的。
     吃的時候從上面、左邊開始少:14 顆 → 9 顆 → 5 顆 → 吃完 */
  const GRAINS = [
    [42.5, 47, -20], [57.5, 48, 15],
    [35, 58, 25], [50, 57.5, -10], [65, 58.5, 30],
    [27.5, 68.5, -30], [42.5, 68, 10], [57.5, 68.5, -15], [72.5, 69, 20],
    [20, 78.5, 15], [35, 79, -25], [50, 78.5, 5], [65, 79, -20], [80, 78.5, 30],
  ];
  const GRAIN_LEFT = [14, 9, 5];
  function grain(ph, step) {
    const keep = GRAINS.slice(GRAINS.length - GRAIN_LEFT[Math.min(step, 2)]);
    const ops = [], sil = [];
    keep.forEach(([x, y, a], i) => {
      const g = rotAbout(ellipse(x + (i % 3 - 1) * 0.6, y, 6.4, 4.5, 16), x, y, a);
      ops.push({ solid: g, color: '#eab450' }, { fill: g, color: C.grain }, { out: g, w: 1.9 });   // 底下先鋪淺色,不然小小一顆中間是白的,看起來像一圈圈的環
      sil.push(g);
    });
    [[7, 81, -20], [93, 80, 25], [11, 72, 40]].slice(0, 2 + Math.min(step, 1)).forEach(([x, y, a]) => {
      const g = rotAbout(ellipse(x, y, 4.6, 3.4, 12), x, y, a);
      ops.push({ solid: g, color: C.grain }, { out: g, w: 1.8 });
    });
    const t = keep[0];
    return { ops, sil, eat: [t[0], t[1] - 2] };
  }

  /* 玉米(審查後重畫):原本葉子從細的那頭長出來、粒畫成斜格子,32 到 40px 像鳳梨。
     改成橫躺一點的玉米棒:葉子在粗的那頭往後翻、往下垂,粒是一排一排圓圓的凸起,細的那頭冒一小撮玉米鬚 */
  const CORN = (() => {
    const B = [30, 70], L = 50, th = -16 * RAD, a = [Math.cos(th), Math.sin(th)], n = [-a[1], a[0]];
    const M = (u, v) => [B[0] + a[0] * u + n[0] * v, B[1] + a[1] * u + n[1] * v];
    const rr = (u) => 14 - 4 * Math.max(0, Math.min(1, u / L));
    return { M, L, rr };
  })();
  function corn() {
    const { M, L, rr } = CORN;
    const husks = [leaf(M(6, -7), M(-22, -16), 7, 3), leaf(M(4, 0), M(-25, 4), 6.5, 2), leaf(M(6, 7), M(-16, 10), 7, -3)];
    const ops = [];
    husks.forEach((p) => ops.push({ fill: p, color: C.husk }, { out: p, w: 2.6 }));
    const cob = tube([M(0, 0), M(L / 2, 0), M(L, 0)], (t) => rr(t * L), 0, 1, 'round', 'round').poly;
    ops.push({ fill: cob, color: C.corn });
    [-0.6, -0.2, 0.2, 0.6].forEach((k, j) => {                    // 一排一排的粒:每顆是一個往外鼓的小圓弧
      const pts = [];
      const u0 = 2 + (j % 2) * 3, u1 = L + rr(L) * 0.55 * Math.sqrt(1 - k * k);
      for (let u = u0; u <= u1; u += 0.8) {
        const ph = ((u - u0) / 6.2) % 1;
        pts.push(M(u, k * rr(Math.min(L, u)) * 0.95 - Math.sin(ph * Math.PI) * 2.2));
      }
      ops.push({ line: pts, w: 1.5, color: C.cornLine, jit: 0.25 });
    });
    ops.push({ out: cob });
    const tip = M(L + rr(L) * 0.8, 0);
    [[-7, 13], [0, 16], [7, 12]].forEach(([v, len]) => {           // 玉米鬚
      const e = M(L + rr(L) * 0.8 + len, v);
      ops.push({ line: [tip, [(tip[0] + e[0]) / 2 + 1.5, (tip[1] + e[1]) / 2 - 1.5], e], w: 1.4, color: '#a8742a', jit: 0.3 });
    });
    return { ops, sil: [cob].concat(husks) };
  }

  /* 青江菜:一株;白色寬梗朝下收在一起,綠葉往上張開,葉子中間有一條白色葉脈 */
  function greensLeaf(ang, s) {
    const base = [50, GROUND];
    const T = (pts) => rotAbout(pts.map(([x, y]) => [50 + x * s, GROUND + y * s]), base[0], base[1], ang);
    const blade = T(spline([[0, -24], [-14, -30], [-19, -46], [-16, -62], [0, -71], [16, -62], [19, -46], [14, -30]], true, 6));
    const stalk = T([[-3, 0], [-4.5, -9], [-6.5, -19], [-6.5, -27], [-3, -38], [0, -50], [3, -38], [6.5, -27], [6.5, -19], [4.5, -9], [3, 0]]);
    const veins = [T([[0, -42], [-8, -48], [-12, -54]]), T([[0, -50], [8, -56], [12, -62]])];
    return { blade, stalk, veins };
  }
  const GREENS = [greensLeaf(-30, 0.86), greensLeaf(30, 0.86), greensLeaf(0, 1.0)];
  function greens() {
    const ops = [];
    GREENS.forEach(({ blade, stalk, veins }) => {
      ops.push({ fill: blade, color: C.leaf, R: 10 }, { out: blade });
      veins.forEach((v) => ops.push({ line: v, w: 1.8, color: C.stalk, jit: 0.3 }));
      ops.push({ fill: stalk, color: C.stalk, R: 6 }, { solid: stalk, color: C.stalk }, { out: stalk, w: 2.6 });
    });
    return { ops, sil: GREENS.flatMap((g) => [g.blade, g.stalk]) };
  }

  /* 豌豆:打開的豆莢,裡面 3 顆圓豆;一啄挑走一顆(從左邊開始),最後連豆莢一起吃掉 */
  const PEAS = [[32, 60], [50, 58.5], [68, 57]];
  function pea(ph, step) {
    const back = spline([[16, 60], [28, 47], [50, 42], [72, 43], [87, 52], [72, 52], [50, 53], [28, 56]], true, 6);
    const front = spline([[11, 61], [30, 66], [50, 66], [72, 63], [89, 53], [84, 66], [66, 77], [44, 79], [24, 74]], true, 6);
    const ops = [{ fill: back, color: C.pod, R: 7 }, { out: back, w: 2.6 }];
    PEAS.forEach(([x, y], i) => {
      if (step > i) return;
      const p = ellipse(x, y, 8.6, 8.4, 24);
      ops.push({ fill: p, color: C.pea, R: 6 }, { out: p, w: 2.4 }, { line: [[x - 4.5, y - 2.5], [x - 2.5, y - 5]], w: 1.8, color: SHINE, jit: 0.2 });
    });
    ops.push({ fill: front, color: C.pod, R: 9 }, { out: front });
    ops.push({ line: [[12, 60], [7, 56], [5, 50], [8, 46]], w: 2.4 });   // 蒂頭捲起來
    const eat = step >= 1 && step <= 3 ? PEAS[step - 1] : [50, 66];
    return { ops, sil: [back, front], eat };
  }

  /* 藍莓:2 顆靠在一起,頂上星形的蒂;一啄吃一顆(左邊那顆先) */
  const BERRIES = [[37, 58, 19], [62, 64, 19]];
  function star(cx, cy, ro, ri, rot) {
    const pts = [];
    for (let i = 0; i < 10; i++) { const a = (rot + i * 36) * RAD, r = i % 2 ? ri : ro; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8]); }
    return pts;
  }
  function berry(ph, step) {
    const ops = [], sil = [];
    BERRIES.forEach(([x, y, r], i) => {
      if (step > i) return;
      const b = ellipse(x, y, r, r * 0.95, 36);
      const cr = star(x + 2, y - r * 0.5, 7, 3, -90 + i * 17);
      const shine = []; for (let a = 195; a <= 245; a += 10) shine.push([x + Math.cos(a * RAD) * r * 0.62, y + Math.sin(a * RAD) * r * 0.62]);
      ops.push({ fill: b, color: C.berry, R: 13 }, { line: shine, w: 2.4, color: SHINE, jit: 0.2 }, { out: b }, { solid: cr, color: C.crown }, { out: cr, w: 1.6 });
      sil.push(b);
    });
    return { ops, sil, eat: BERRIES[Math.min(1, Math.max(0, step - 1))] };
  }

  /* 小番茄:一顆圓的,頂上綠色星形蒂頭和一小截梗 */
  function tomato() {
    const body = ellipse(50, 60, 27, 24, 44, { at: -Math.PI / 2, w: 0.45, d: 0.07 });
    const cx = 50, cy = 39;
    const sepals = [[188, 15], [148, 12], [100, 10], [52, 12], [-8, 15]].map(([a, l]) => leaf([cx, cy], [cx + Math.cos(a * RAD) * l, cy + Math.sin(a * RAD) * l * 0.75], 3.6, 1.2));
    const shine = []; for (let a = 200; a <= 245; a += 9) shine.push([50 + Math.cos(a * RAD) * 18, 60 + Math.sin(a * RAD) * 16]);
    const ops = [{ fill: body, color: C.tomato, R: 17 }, { line: shine, w: 2.6, color: SHINE, jit: 0.2 }, { out: body }];
    sepals.forEach((s) => ops.push({ solid: s, color: C.calyx }, { out: s, w: 1.7 }));
    ops.push({ line: [[50, 39], [51, 33], [54, 28]], w: 4.6 }, { line: [[50, 38], [51, 33], [53.6, 28.5]], w: 2, color: C.calyx, jit: 0.2 });
    return { ops, sil: [body] };
  }

  /* 西瓜:三角形切片,綠皮在下,一條淡淡的白皮,幾顆黑籽 */
  function melon() {
    const arc = (dy, x0, x1) => { const p = []; for (let i = 0; i <= 16; i++) { const x = x0 + (x1 - x0) * i / 16, t = (x - 50) / 37; p.push([x, 68 + 16 * (1 - t * t) - dy]); } return p; };
    const side = (a, b, bulge) => { const p = []; for (let i = 1; i < 10; i++) { const t = i / 10, m = Math.sin(Math.PI * t) * bulge; p.push([a[0] + (b[0] - a[0]) * t - m * (b[1] - a[1]) / 62, a[1] + (b[1] - a[1]) * t + m * (b[0] - a[0]) / 62]); } return p; };
    const tip = [50, 15], outer = arc(0, 13, 87);
    const whole = [tip].concat(side(tip, [87, 68], 3), outer.slice().reverse(), side([13, 68], tip, 3));
    const inner = arc(7.5, 18, 82), fleshArc = arc(9.5, 20, 80);
    const rind = inner.concat(outer.slice().reverse());
    const flesh = [tip].concat(side(tip, [80, 66], 3), fleshArc.slice().reverse(), side([20, 66], tip, 3));
    const ops = [{ fill: rind, color: C.rind, R: 4.5 }, { line: arc(8.5, 19, 81), w: 2.6, color: '#d8ecc8', jit: 0.2 }, { fill: flesh, color: C.flesh, R: 14 }];
    [[50, 34, 0], [42, 48, -12], [58, 48, 12], [34, 62, -20], [50, 61, 0], [66, 62, 20]].forEach(([x, y, a]) =>
      ops.push({ solid: rotAbout(ellipse(x, y, 1.9, 3.2, 10, { at: -Math.PI / 2, w: 0.5, d: 0.35 }), x, y, a), color: C.seed }));
    ops.push({ line: inner, w: 1.6, jit: 0.3 }, { out: whole });
    return { ops, sil: [whole] };
  }

  /* 地瓜:剝開一半的烤地瓜。右邊尖尖的一頭是紫紅色的皮,左邊斷開、露出橘色的肉,冒兩三條彎曲的熱氣 */
  const YAM = spline([[88, 75], [72, 69], [52, 62], [31, 56]], false, 10);
  const yamR = (t) => 3.5 + 14.5 * Math.pow(Math.sin(Math.min(1, t * 1.12) * Math.PI / 2), 0.9);
  function yam(ph) {
    const whole = tube(YAM, yamR, 0, 1, 'round', 'jagRound');
    const flesh = tube(YAM, yamR, 0.5, 1, 'flat', 'jagRound').poly;
    const skin = tube(YAM, yamR, 0, 0.64, 'round', 'jag');
    const ops = [{ fill: flesh, color: C.yamFlesh, R: 11 }, { fill: skin.poly, color: C.yamSkin, R: 11 }];
    ops.push({ line: skin.end, w: 2.2, jit: 0.3 });   // 皮剝開的鋸齒邊
    [[0.2, 0.3], [0.33, -0.35], [0.46, 0.2]].forEach(([t, k]) => {        // 皮上的小坑
      const { p, d } = whole.at(t), n = [-d[1], d[0]], r = yamR(t), c = add(p, n, k * r);
      ops.push({ line: [add(c, d, -2), add(c, d, 2)], w: 1.4, color: '#7d2f45', jit: 0.2 });
    });
    const e = whole.at(0.97), en = [-e.d[1], e.d[0]];                     // 斷面的纖維線
    ops.push({ line: [-0.6, -0.2, 0.25, 0.6].map((k) => add(add(e.p, en, k * yamR(1) * 0.9), e.d, -Math.cos(k * 1.4) * 3)), w: 1.4, color: '#d98a1e', jit: 0.3 });
    ops.push({ out: whole.poly });
    [[20, 37], [30, 33], [40, 36]].forEach(([bx, by], i) => {              // 熱氣:往上飄的彎線,每格往上挪一點
      const pts = [];
      for (let k = 0; k <= 6; k++) { const y = by - k * 3.6 - ph * 1.6; pts.push([bx + 2.8 * Math.sin(k * 1.1 + ph * 1.9 + i * 2), y]); }
      ops.push({ line: pts, w: 1.6, jit: 0.2 });
    });
    return { ops, sil: [whole.poly] };
  }

  /* 麵包蟲:S 形一條,幾道節紋,頭是深色的。會蠕動(4 格),被吃時從尾巴變短。
     審查後拿掉頭上的白色反光點:看起來像眼睛,「有眼睛的蟲被吃掉」可能讓學生不舒服 */
  function wormLine(ph) {
    const pts = [];
    for (let i = 0; i <= 30; i++) { const x = 17 + i * 2.2; pts.push([x, 63 + 10 * Math.sin((x - 17) / 66 * Math.PI * 2 * 0.95 - ph * Math.PI / 2) + (i > 26 ? -(i - 26) * 0.6 : 0)]); }
    return pts;
  }
  const wormR = (t) => 4.2 + 3 * Math.min(1, t / 0.25) + (t > 0.86 ? 0.6 : 0);
  function worm(ph, step) {
    const c = wormLine(ph), t0 = [0, 0.26, 0.5][Math.min(step, 2)];
    const body = tube(c, wormR, t0, 1, step ? 'jagRound' : 'round', 'round');
    const head = tube(c, wormR, 0.86, 1, 'flat', 'round').poly;
    const ops = [{ fill: body.poly, color: C.worm, R: 6 }, { fill: head, color: C.wormLine, R: 4.5 }];
    for (let t = t0 + 0.07; t < 0.84; t += 0.068) {
      const { p, d } = body.at(t), n = [-d[1], d[0]], r = wormR(t) * 0.92;
      ops.push({ line: [add(p, n, r), add(add(p, d, 1.2), n, 0), add(p, n, -r)], w: 1.5, color: C.wormLine, jit: 0.2 });
    }
    ops.push({ line: [add(body.at(0.86).p, [-body.at(0.86).d[1], body.at(0.86).d[0]], wormR(0.86)), add(body.at(0.86).p, [body.at(0.86).d[1], -body.at(0.86).d[0]], wormR(0.86))], w: 2, jit: 0.3 });
    ops.push({ out: body.poly });
    return { ops, sil: [body.poly], eat: body.at(Math.min(0.9, t0 + 0.04)).p };
  }

  /* 食物清單(順序 = 托盤順序)。crumb = 碎屑的顏色;bites = 每啄一下咬掉的位置 [x, y, 半徑](從左邊開始) */
  const FOODS = {
    grain: { name: '飼料', kind: 'build', steps: 3, phases: 2, build: grain, crumb: [C.grain] },
    corn: { name: '玉米', kind: 'bite', steps: 3, phases: 2, build: corn, crumb: [C.corn, C.corn, C.cornLine],
      bites: [CORN.M(12, -12).concat(11), CORN.M(28, -11).concat(11)] },
    greens: { name: '青江菜', kind: 'bite', steps: 3, phases: 2, build: greens, crumb: [C.leaf, C.leaf, C.stalk],
      bites: [rotAbout([[50 - 19 * 0.86, GROUND - 48 * 0.86]], 50, GROUND, -30)[0].concat(11), [34, 24, 10]] },
    pea: { name: '豌豆', kind: 'build', steps: 4, phases: 2, build: pea, crumb: [C.pea, C.pod] },
    berry: { name: '藍莓', kind: 'build', steps: 2, phases: 2, build: berry, crumb: [C.berry, C.crown] },
    tomato: { name: '小番茄', kind: 'bite', steps: 3, phases: 2, build: tomato, crumb: [C.tomato, C.tomato, C.calyx],
      bites: [[23, 60, 12], [30, 42, 11]] },
    melon: { name: '西瓜', kind: 'bite', steps: 3, phases: 2, build: melon, crumb: [C.flesh, C.flesh, C.seed],
      bites: [[24, 54, 11], [45, 19, 11]] },
    yam: { name: '地瓜', kind: 'bite', steps: 3, phases: 3, build: yam, crumb: [C.yamFlesh, C.yamFlesh, C.yamSkin],
      bites: [[20, 56, 11], [30, 41, 10]] },
    worm: { name: '麵包蟲', kind: 'build', steps: 3, phases: 4, build: worm, crumb: [C.worm, C.wormLine] },
  };
  Object.keys(FOODS).forEach((id) => {          // 咬痕往食物中心咬:先算好每種食物的中心
    const f = FOODS[id], b = bbox(f.build(0, 0).sil.flat());
    f.center = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  });

  /* ---------- 咬痕和碎屑 ---------- */
  function biteCircles([x, y, R], ctr) {
    const th = Math.atan2(ctr[1] - y, ctr[0] - x), o = R * 0.78, s = R * 0.62;
    return [[x, y, R], [x + Math.cos(th + 1.35) * o, y + Math.sin(th + 1.35) * o, s], [x + Math.cos(th - 1.35) * o, y + Math.sin(th - 1.35) * o, s]];
  }
  function applyBites(ctx, r, def, sil, step) {
    const circles = def.bites.slice(0, step).flatMap((b) => biteCircles(b, def.center));
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    circles.forEach(([x, y, R]) => { ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
    const inFood = (x, y) => sil.some((p) => inside(p, x, y));
    circles.forEach(([x, y, R], ci) => {          // 咬痕邊緣:只畫在食物裡面、沒被別的咬痕吃掉的那段
      const N = 36, keep = [];
      for (let i = 0; i < N; i++) {
        const a = i / N * Math.PI * 2, px = x + Math.cos(a) * R, py = y + Math.sin(a) * R;
        keep.push(inFood(px, py) && !circles.some(([u, v, S], k) => k !== ci && Math.hypot(px - u, py - v) < S - 0.4));
      }
      const start = keep.indexOf(false);
      if (start < 0) return;
      let run = [];
      for (let k = 1; k <= N; k++) {
        const i = (start + k) % N;
        if (keep[i]) run.push([x + Math.cos(i / N * Math.PI * 2) * R, y + Math.sin(i / N * Math.PI * 2) * R]);
        else if (run.length) { if (run.length > 1) stroke(ctx, r, run, OUT * 0.85, INK, 0.4); run = []; }
      }
      if (run.length > 1) stroke(ctx, r, run, OUT * 0.85, INK, 0.4);
    });
  }
  /* 碎屑:從被啄的地方噴出來,往上再落到地上;prog 0~1 */
  function crumbs(ctx, def, origin, prog, seed) {
    const r = rng(seed), k = 1 + (INKW - 1) * 0.5;
    for (let i = 0; i < 7; i++) {
      const vx = (r() - 0.4) * 2.4, vy = -(0.5 + r() * 1.1), size = (1.6 + r() * 1.5) * k;
      const x = origin[0] + vx * prog * 17, y = Math.min(GROUND - size * 0.6, origin[1] + vy * prog * 22 + prog * prog * 30);
      const p = [];
      for (let j = 0; j < 5; j++) { const a = j / 5 * Math.PI * 2 + r(); p.push([x + Math.cos(a) * size * (0.7 + r() * 0.5), y + Math.sin(a) * size * (0.7 + r() * 0.5)]); }
      solid(ctx, p, def.crumb[i % def.crumb.length]);
      ctx.lineWidth = 0.8 * INKW; ctx.strokeStyle = INK;
      ctx.beginPath(); p.forEach(([a, b], j) => (j ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); ctx.stroke();
    }
  }

  /* ---------- 畫 ---------- */
  function paint(ctx, id, o) {
    const def = FOODS[id], step = Math.max(0, Math.min(def.steps, o.step || 0)), v = (o.variant || 0) % drawings(id), phase = v % def.phases;
    const r = rng(hash(id) + v * 101 + step * 7);
    INKW = inkFor(o.size);
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    let built = null;
    if (step < def.steps) {
      built = def.build(phase, def.kind === 'build' ? step : 0);
      built.ops.forEach((op) => {
        if (op.fill) scribble(ctx, r, op.fill, op.color, op.R);
        else if (op.solid) solid(ctx, op.solid, op.color);
        else if (op.out) stroke(ctx, r, op.out, op.w || OUT, INK, 0.6, true);
        else if (op.line) stroke(ctx, r, op.line, op.w || OUT, op.color || INK, op.jit, false);
      });
      if (def.kind === 'bite' && step > 0) applyBites(ctx, r, def, built.sil, step);
    }
    if (o.crumb !== null && o.crumb !== undefined && step > 0) {
      const at = def.kind === 'bite' ? (step < def.steps ? def.bites[step - 1] : def.center)
        : (def.build(phase, step - 1).eat || def.center);
      crumbs(ctx, def, at, o.crumb, hash(id) + step * 31);
    }
    ctx.restore();
  }

  /* 一種食物有幾張不同的抖動:至少 3 張(審查後;原本 2 張來回翻看起來像閃爍),會動的食物(地瓜熱氣 3、麵包蟲 4)照它的格數 */
  const drawings = (id) => Math.max(3, FOODS[id].phases);
  const cache = new Map();
  /* 畫好一張 canvas(css 尺寸 size,解析度 × dpr),同樣的參數會重複用 */
  function render(id, opt) {
    const o = Object.assign({ size: 64, variant: 0, step: 0, crumb: null, dpr: (typeof window !== 'undefined' && window.devicePixelRatio) || 1 }, opt || {});
    if (!FOODS[id]) throw new Error('FoodArt: 沒有這種食物 ' + id);
    const key = [id, o.size, o.dpr, o.variant % drawings(id), o.step, o.crumb].join('|');
    if (cache.has(key)) return cache.get(key);
    const px = o.size / W * o.dpr, c = document.createElement('canvas');
    c.width = Math.round(W * px); c.height = Math.round(H * px);
    const ctx = c.getContext('2d');
    ctx.scale(px, px);
    paint(ctx, id, o);
    if (cache.size > 600) cache.delete(cache.keys().next().value);
    cache.set(key, c);
    return c;
  }
  function draw(ctx, id, opt) {
    const o = Object.assign({ x: 0, y: 0, size: 64 }, opt || {});
    ctx.drawImage(render(id, o), o.x, o.y, o.size, o.size * H / W);
  }

  const CRUMB_SEQ = [0.2, 0.55, 0.85, 1, 1];
  /* 掛在一個 canvas 上:自己抖(6~8 fps,預設 7),bite() 啄一下會噴碎屑。
     opt:size(css px)、fps、step、animate(false = 不抖,截圖用)、onDone(吃完、碎屑落地後呼叫)、
     stagger(預設 true,審查後加:從隨機的一張開始、隨機延後起跑,托盤裡好幾格才不會同時翻頁) */
  function mount(canvas, id, opt) {
    const o = Object.assign({ size: 40, fps: 7, step: 0, animate: true, maxDpr: 3, stagger: true }, opt || {});
    const dpr = Math.min((window.devicePixelRatio || 1), o.maxDpr);
    canvas.width = Math.round(o.size * dpr); canvas.height = Math.round(o.size * H / W * dpr);
    canvas.style.width = o.size + 'px'; canvas.style.height = Math.round(o.size * H / W) + 'px';
    const ctx = canvas.getContext('2d');
    const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let food = id, step = o.step, i = o.stagger ? Math.floor(Math.random() * 12) : 0, burst = null, timer = null, delay = null, done = false;
    function tick() {
      const def = FOODS[food];
      const crumb = burst === null ? null : CRUMB_SEQ[burst];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!(done && burst === null)) ctx.drawImage(render(food, { size: o.size, dpr, variant: reduce || !o.animate ? 0 : i, step, crumb }), 0, 0);
      i++;
      if (burst !== null && ++burst >= CRUMB_SEQ.length) {
        burst = null;
        if (step >= def.steps && !done) { done = true; tick(); if (typeof o.onDone === 'function') o.onDone(food); }
      }
    }
    function start() {
      stop(); tick();
      if (!o.animate || reduce) return;
      const run = () => { delay = null; timer = setInterval(tick, 1000 / o.fps); };
      if (o.stagger) delay = setTimeout(() => { tick(); run(); }, Math.random() * 1000 / o.fps); else run();
    }
    function stop() { if (timer) clearInterval(timer); if (delay) clearTimeout(delay); timer = null; delay = null; }
    start();
    return {
      bite() {
        const def = FOODS[food];
        if (step >= def.steps) return step;
        step++;
        if (reduce || !o.animate) {           // 不播碎屑:直接換到下一個樣子
          if (step >= def.steps) { done = true; tick(); if (typeof o.onDone === 'function') o.onDone(food); } else tick();
        } else { burst = 0; tick(); }
        return step;
      },
      finish() { step = FOODS[food].steps; burst = null; done = true; tick(); if (typeof o.onDone === 'function') o.onDone(food); },
      reset() { step = 0; burst = null; done = false; tick(); },
      setFood(nid) { if (FOODS[nid]) { food = nid; step = 0; burst = null; done = false; tick(); } },
      stop,
      get step() { return step; },
      get steps() { return FOODS[food].steps; },
      get food() { return food; },
      reducedMotion: reduce,
    };
  }

  window.FoodArt = {
    ids: Object.keys(FOODS),
    info: Object.fromEntries(Object.entries(FOODS).map(([id, f]) => [id, { name: f.name, kind: f.kind, steps: f.steps, phases: f.phases, crumb: f.crumb.slice() }])),
    colors: Object.assign({}, C),
    render,
    draw,
    mount,
    chickImpactFrames: [3, 5],               // ChickArt eat 姿勢裡嘴巴碰到地的那兩格:收到時呼叫 bite()
    metrics: { width: W, height: H, ground: GROUND },
  };
})();
