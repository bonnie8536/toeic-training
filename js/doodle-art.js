/* 導覽與功能入口的塗鴉圖示。原檔與預覽不在這個 repo;要改圖先改原檔、在預覽看過,再整份複製過來(保留這段開頭)。
   這裡只畫圖,不讀寫任何儲存;抖動全用種子亂數(不用瀏覽器的隨機數),同樣的參數畫兩次一模一樣。 */
/* 塗鴉圖示:跟塗鴉小雞(js/chick-art.js)、塗鴉食物(js/food-art.js)同一套畫法。
   抖動的黑色墨線 #151515(收筆多畫一小段、不一定閉合)、亂繞而密的黃色塗鴉 #ffe100、形狀故意略歪。
   強調色是固定規則,只有意思需要時才用:紅 = 答錯(錯題本的叉),綠 = 今天做完(每日練習的勾)。
   其他的勾(題庫刷題)表示「這題做過了」,不是對錯,一律用墨線色。
   黃底上還要再分一塊時用同色系的深黃、淡黃(文章的圖、鉛筆筆身、嘴裡、最高的長條),不另外加色。
   畫在 100×100 的邏輯畫布裡。依畫出來的大小分三級細節:
     - 36px 以下(分頁列約 26px):線條加粗(約 2 css px),細節省到只剩認得出來的部分(書上的橫線只留兩條、答案卡只有 3×2 格)。
       灰線版再加粗、再省(只留外形加一兩個特徵)。
     - 36 到 63px:中等細節。
     - 64px 以上:多一點細節(窗戶、刻度、摺角)。
   tone:'fill' 有黃色塗鴉(預設);'line' 只有墨線(給沒選中的分頁用),強調色也一起換成墨線色。
   ink:墨線顏色(預設 #151515;沒選中的分頁傳 #767f88)。paper:遮住後面東西用的紙色(預設白)。
   用法:
     DoodleArt.mountAll(document);                          // 掛上所有 <canvas data-doodle="home" data-size="26" data-tone="line">
     const h = DoodleArt.mount(canvas, 'home', { size: 26, tone: 'line', ink: '#767f88' });
     h.setTone('fill'); h.setInk('#151515'); h.stop();
     DoodleArt.render('mock', { size: 72, variant: 1 }) → 一張畫好的 canvas(同參數重用同一張)
     DoodleArt.draw(ctx, 'mock', { x, y, size })            // 貼進別人的畫布(css 像素)
   animate 預設 false:圖示不動、不開計時器;true 時像食物一樣輪流換抖動組(減少動態時一律不動)。 */
(function () {
  const W = 100, H = 100;
  const INK = '#151515', YELLOW = '#ffe100', RED = '#c94040', GREEN = '#3a8a4d', PAPER = '#ffffff';
  /* 同一個黃的深淺:DEEP 給「黃底上還要再分一塊」的地方(文章的圖、鉛筆筆身),PALE 給疊在後面或前面、要淡一點的那片 */
  const DEEP = '#f0b400', PALE = '#fff089';
  const RAD = Math.PI / 180;
  const OUT = 3.2;                         // 外框粗細(邏輯像素)
  const VARIANTS = 3;                      // 抖動組數
  let INKW = 1;                            // 畫得小時線條加粗
  /* 目標:26px 時墨線約 2 css px、40px 約 2.2、72px 約 2.8、128px 約 3.8(跟食物 128px 差不多) */
  const inkFor = (size) => {
    if (!size) return 1;
    const px = 1.5 + size * 0.018;
    return Math.max(1, Math.min(2.6, px / (OUT * size / W)));
  };
  const levelFor = (size) => (!size || size >= 64 ? 2 : size >= 36 ? 1 : 0);
  const L = (lvl, a, b, c) => (lvl === 0 ? a : lvl === 1 ? b : c);

  function rng(seed) {                     // mulberry32,跟小雞、食物同一個
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
  function ellipse(cx, cy, rx, ry, n) {
    const pts = [], N = n || 36;
    for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
    return pts;
  }
  /* catmull-rom:穿過控制點的平滑曲線(跟食物同一個) */
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
  /* 弧:角度用度,0 = 右、90 = 下(螢幕座標);a1 < a0 時反方向走 */
  function arc(cx, cy, rx, ry, a0, a1, n) {
    const pts = [], N = n || Math.max(4, Math.ceil(Math.abs(a1 - a0) / 10));
    for (let i = 0; i <= N; i++) { const a = (a0 + (a1 - a0) * i / N) * RAD; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
    return pts;
  }
  function rrect(x0, y0, x1, y1, r) {
    return [].concat(arc(x0 + r, y0 + r, r, r, 180, 270, 3), arc(x1 - r, y0 + r, r, r, 270, 360, 3),
      arc(x1 - r, y1 - r, r, r, 0, 90, 3), arc(x0 + r, y1 - r, r, r, 90, 180, 3));
  }
  /* 對話框:圓角方框,底邊 tx 處長出一個尖角指向 tip */
  function bubble(x0, y0, x1, y1, r, tx, tw, tip) {
    return [].concat(arc(x0 + r, y0 + r, r, r, 180, 270, 3), arc(x1 - r, y0 + r, r, r, 270, 360, 3),
      arc(x1 - r, y1 - r, r, r, 0, 90, 3), [[tx + tw / 2, y1], tip, [tx - tw / 2, y1]], arc(x0 + r, y1 - r, r, r, 90, 180, 3));
  }
  /* 環:外圈接內圈(反向),中間一條來回的縫;塗鴉用奇偶規則判斷裡外,所以中間是空的 */
  function annulus(cx, cy, r0, r1, n) {
    const o = ellipse(cx, cy, r0, r0, n), i = ellipse(cx, cy, r1, r1, n);
    return o.concat([o[0], i[0]], i.slice(1).reverse(), [i[0]]);
  }
  /* 箭頭的頭:尖端 tip,朝 deg 方向,兩邊各張開 spread 度 */
  function head(tip, deg, len, spread) {
    const s = spread || 34, a = (deg + 180 - s) * RAD, b = (deg + 180 + s) * RAD;
    return [[tip[0] + Math.cos(a) * len, tip[1] + Math.sin(a) * len], tip, [tip[0] + Math.cos(b) * len, tip[1] + Math.sin(b) * len]];
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
  function densify(pts, closed, step) {
    const out = [], n = pts.length, S = step || 5;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n], k = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / S);
      for (let j = 0; j < k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
    }
    if (!closed) out.push(pts[n - 1]);
    return out;
  }

  /* ---------- 筆觸(跟食物同一套) ---------- */
  function curve(ctx, p) {
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    const last = p[p.length - 1];
    ctx.lineTo(last[0], last[1]);
  }
  /* 一條手畫的線;closed 時從隨機的地方起筆,收筆多畫一小段蓋過起點。
     圖示多是直線和方框,只加細抖動會像尺畫的,所以再沿著線加一個低頻的彎(手畫直線會微微鼓起),
     彎的大小約 jit 的 1.3 倍、波長 30 到 48,每一組抖動相位不同(換抖動組時線條會「沸騰」)。 */
  function stroke(ctx, r, pts, w, color, jit, closed) {
    const j = jit === undefined ? 0.7 : jit;
    let p = densify(pts, closed, 5);
    if (closed) { const s = Math.floor(r() * p.length); p = p.slice(s).concat(p.slice(0, s), p.slice(s, s + 2)); }
    const lam = 30 + r() * 18, ph = r() * Math.PI * 2, amp = j * 1.3;
    let run = 0;
    p = p.map(([x, y], i) => {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      const n = unit([a[1] - b[1], b[0] - a[0]]), k = amp * Math.sin(run / lam * Math.PI * 2 + ph);
      if (i + 1 < p.length) run += Math.hypot(p[i + 1][0] - x, p[i + 1][1] - y);
      return [x + n[0] * k + (r() - 0.5) * 2 * j * 0.7, y + n[1] * k + (r() - 0.5) * 2 * j * 0.7];
    });
    ctx.strokeStyle = color;
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
  /* 塗鴉填色:一行一行來回繞大圈(跟食物一樣)。圈半徑最多 16,小零件跟著零件的厚度縮;
     圈心只在形狀裡面走,靠邊的圈最多塗出去約半徑的三分之一。 */
  const LOOP = 16;
  function thickness(poly) {
    const b = bbox(poly);
    let m = 0;
    for (let y = b.y0 + 1; y < b.y1; y += 2) for (let x = b.x0 + 1; x < b.x1; x += 2) if (inside(poly, x, y)) m = Math.max(m, distEdge(poly, x, y));
    return m;
  }
  function scribble(ctx, r, poly, color, maxR) {
    const b = bbox(poly);
    const R = Math.min(maxR || LOOP, Math.max(3.5, thickness(poly) * 1.6 + 2)), spill = R * 0.32, gap = R * 0.42;
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
    segs.forEach((sg) => {
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

  /* ---------- 圖示 ----------
     build(lvl, slim) 回傳 ops;slim = 26px 灰線版(沒選中的分頁),只留外形加一兩個特徵。ops 依序畫:
     { fill, color, R } 塗鴉填色(只有 tone 'fill' 畫;color 預設黃);{ solid, color } 實心('ink' 墨線色、'paper' 紙色);
     { out, w, color } 封閉外框;{ line, w, color, jit } 開放的線。強調色在 tone 'line' 時換成墨線色。
     任何一筆加 only: 'fill' 或 'line' 就只在那種 tone 畫(例如文字線外圍的白邊、嘴裡的深色只在上色版)。 */
  const ICONS = {};
  const def = (id, name, meaning, build) => { ICONS[id] = { name, meaning, build }; };
  const dot = (x, y, r) => ({ solid: ellipse(x, y, r, r, 14), color: 'ink' });

  /* 首頁:小房子。屋頂斜線伸出牆外、門留白(塗鴉繞開門);64px 以上加煙囪、窗戶、門把 */
  def('home', '首頁', '家', (lvl) => {
    const ops = [{ fill: [[15, 54], [50, 19], [85, 54], [76, 54], [76, 86], [57, 86], [57, 64], [43, 64], [43, 86], [24, 86], [24, 54]] }];
    if (lvl) ops.push({ line: [[64, 30], [64.5, 17], [72.5, 17.5], [72, 38]], w: 2.8 });
    ops.push({ line: [[8, 57], [29, 35.5], [50, 14], [71, 35], [92, 56.5]] });
    ops.push({ line: [[24, 49], [23.5, 87.5]] }, { line: [[76, 49], [76.5, 88]] }, { line: [[16, 88], [50, 87.5], [84, 88.5]] });
    ops.push({ line: [[43, 87.5], [42.5, 63.5], [57.5, 63], [57, 87.5]], w: L(lvl, 3, 2.8, 2.8) });
    if (lvl === 2) ops.push(dot(53.5, 76, 1.8), { out: rrect(63, 58, 71.5, 67, 1.5), w: 2.2 }, { line: [[67.2, 58], [67.2, 67]], w: 1.6 }, { line: [[63, 62.5], [71.5, 62.5]], w: 1.6 });
    return ops;
  });

  /* 日常學習:攤開的書,兩頁往中間凹,頁上有橫線(26px 時每頁兩條) */
  def('learn', '日常學習', '讀書、上課', (lvl) => {
    const left = [[50, 31], [40, 26], [28, 24], [11, 28], [11, 74], [28, 70.5], [40, 72.5], [50, 79]];
    const right = [[50, 31], [60, 26], [72, 24], [89, 28.5], [89, 74.5], [72, 70.5], [60, 72.5], [50, 79]];
    const ops = [{ fill: left }, { fill: right }, { out: left }, { line: right }];
    if (lvl) ops.push({ line: [[8, 71], [8, 78], [28, 75.5], [50, 85], [72, 75.5], [92, 78.5], [92, 71]], w: 2.6 });
    L(lvl, [42, 56], [40, 50, 60], [38, 46, 54, 62]).forEach((y, i, all) => {
      const w = L(lvl, 2.6, 2.2, 2), short = i === all.length - 1 ? 7 : 0;
      ops.push({ line: [[18, y], [31, y - 0.9], [44, y + 1.6]], w }, { line: [[56, y + 1.6], [69, y - 0.9], [82 - short, y + 0.2]], w });
    });
    return ops;
  });

  /* 練練手感:靶(外圈塗黃、中圈留白、靶心實心)加一支射中靶心的飛鏢 */
  def('warmup', '練練手感', '練準頭', (lvl) => {
    const cx = 41, cy = 59, tip = [cx + 3, cy - 3], tail = [86, 14];
    const d = unit([tail[0] - tip[0], tail[1] - tip[1]]), n = [-d[1], d[0]];
    const A = add(tip, d, 0.7 * Math.hypot(tail[0] - tip[0], tail[1] - tip[1]));
    const fw = L(lvl, 10, 9, 8.5);
    const f1 = [A, add(add(tail, n, fw), d, 3), tail], f2 = [A, add(add(tail, n, -fw), d, 3), tail];
    const ops = [{ fill: annulus(cx, cy, 33, 20, 40) }, { out: ellipse(cx, cy, 33.5, 32.5, 40) }, { out: ellipse(cx, cy, 20, 19.5, 32), w: L(lvl, 2.8, 2.6, 2.6) }];
    if (lvl === 2) ops.push({ out: ellipse(cx, cy, 27, 26.5, 36), w: 1.4, jit: 0.5 });
    ops.push(dot(cx, cy, L(lvl, 9, 8, 7.5)));
    ops.push({ line: [add(tip, d, 2), add(tip, d, 25), tail], w: OUT + 0.4 });
    ops.push({ fill: f1, R: 6 }, { fill: f2, R: 6 }, { out: f1, w: 2.4 }, { out: f2, w: 2.4 });
    return ops;
  });

  /* 鉛筆:筆尖 tip 朝 toward 的反方向長出去。外框留白、筆身塗深黃、削尖的木頭留白、筆芯塗黑,尾端一個小橡皮。
     hw 是半寬,len 是筆尖到金屬圈的長度。寫作練習和刷刷題目共用 */
  function pencil(tip, toward, hw, len, lvl) {
    const d = unit([toward[0] - tip[0], toward[1] - tip[1]]), n = [-d[1], d[0]];
    const at = (t, k) => add(add(tip, d, t), n, k);
    const tipL = hw * 1.7, bodyEnd = len - 7;
    const shape = [tip, at(tipL, -hw), at(len + 4, -hw), at(len + 6.5, -hw * 0.75), at(len + 8, 0), at(len + 6.5, hw * 0.75), at(len + 4, hw), at(tipL, hw)];
    const body = [at(tipL, hw), at(bodyEnd, hw), at(bodyEnd, -hw), at(tipL, -hw)];
    const ops = [{ solid: shape, color: 'paper' }, { fill: body, color: DEEP, R: 9 }, { out: shape }];
    ops.push({ line: [at(tipL, hw), at(tipL, -hw)], w: 2.8 }, { line: [at(bodyEnd, hw), at(bodyEnd, -hw)], w: 2.8 }, { line: [at(len, hw), at(len, -hw)], w: 2.8 });
    ops.push({ solid: [at(tipL * 0.44, hw * 0.46), at(-0.5, 0), at(tipL * 0.44, -hw * 0.46)], color: 'ink' });
    if (lvl === 2) ops.push({ line: [at(tipL + 3, 0.5), at(bodyEnd - 3, -0.5)], w: 1.8, jit: 0.4 });
    return ops;
  }

  /* 刷刷題目:答案卡加一支剛劃過卡的鉛筆。白紙、3 排 × 2 欄的大圓圈(兩個塗黑),下半張塗黃。
     (第一、二版是滿版小圓點格,小圖被看成計算機;灰線版的小點糊成一團)
     26px 灰線版只留紙、左上一個大圓圈、兩條橫線和鉛筆 */
  def('drill', '刷刷題目', '考試作答', (lvl, slim) => {
    const T = (pts) => rotAbout(pts, 40, 51, -3);
    const sheet = T(rrect(10, 8, 68, 93, 3));
    const ops = [];
    if (slim) {
      ops.push({ solid: sheet, color: 'paper' }, { out: sheet }, { out: T(ellipse(27, 27, 9.5, 9, 18)), w: 3 });
      [54, 72].forEach((y) => ops.push({ line: T([[21, y], [40, y - 0.8], [57, y + 0.4]]), w: 3 }));
      return ops.concat(pencil([58, 40], [95, 6], 7.5, 38, lvl));
    }
    ops.push({ solid: sheet, color: 'paper' }, { fill: T([[10, 52], [68, 49], [68, 93], [10, 93]]) }, { out: sheet });
    const r = L(lvl, 9.5, 8.5, 7.5), on = ['0,1', '1,0'];
    [27, 50, 73].forEach((y, i) => [27, 49].forEach((x, k) => {
      const b = T(ellipse(x, y, r, r * 0.94, 16));
      if (on.includes(i + ',' + k)) ops.push({ solid: T(ellipse(x, y, r + 0.8, r + 0.5, 16)), color: 'ink' });
      else ops.push({ solid: b, color: 'paper' }, { out: b, w: L(lvl, 1.7, 2.2, 2.2), jit: 0.35 });
    }));
    return ops.concat(pencil([58, 38], [95, 5], L(lvl, 7.5, 7, 6.5), L(lvl, 38, 40, 40), lvl));
  });

  /* 我的:吉祥物小雞,整隻(第一版只有頭,大圖被看成橘子)。比例照 chick-art 縮小約 0.47 倍:
     略扁的橢圓身體、b 字形呆毛、半睜眼、張嘴吐舌的三角喙、兩隻細腿帶短趾;36px 以上加兩片小翅膀。
     26px 時嘴換成大一點的閉嘴三角喙、腳趾加長,灰線版也看得出兩隻腳 */
  def('me', '我的', '我', (lvl) => {
    const cx = 50, cy = 53, rx = 33, ry = 27.5, tilt = -4;
    const T = (pts) => rotAbout(pts, cx, cy, tilt);
    const body = T(ellipse(cx, cy, rx, ry, 40));
    const ops = [{ fill: body }, { out: body }];
    /* 腿:臀部在身體底邊(左右不對稱,跟 chick-art 一樣左腳偏外),腳掌三趾 + 一根後趾 */
    const lw = L(lvl, 3.8, 3, 2.8), toe = L(lvl, 1.3, 1.1, 1);
    L(lvl, [[cx - 14, 79.5], [cx + 12, 80]], [[cx - 11, 81], [cx + 7, 81.5]], [[cx - 11, 81], [cx + 7, 81.5]]).forEach(([x, hy]) => {
      const foot = [x + 0.5, 93];
      ops.push({ line: [[x, hy - 1.5], foot], w: lw, jit: 0.3 });
      ops.push({ line: [[foot[0] - 6.5 * toe, foot[1] + 0.6], foot, [foot[0] + 6 * toe, foot[1] + 0.4]], w: lw, jit: 0.25 });
      if (lvl) ops.push({ line: [foot, [foot[0] - 3, foot[1] + 3.5]], w: lw - 0.5, jit: 0.2 });
    });
    /* 翅膀:chick-art 的 rest 翅膀(往下垂的小片) */
    if (lvl) [-1, 1].forEach((o) => {
      const a = 100 * RAD, len = 11, S = T([[cx + o * rx * 0.97, cy + 2]])[0];
      const d = [o * Math.cos(a), Math.sin(a)], pp = [-o * d[1], o * d[0]];
      const P = (k, m) => [S[0] + d[0] * len * k + pp[0] * len * m, S[1] + d[1] * len * k + pp[1] * len * m];
      ops.push({ line: [S, P(0.5, -0.2), P(1, 0), P(0.5, 0.42), P(0.08, 0.3)], w: L(lvl, 3, 2.8, 2.6), jit: 0.3 });
    });
    /* 呆毛:跟 chick-art 同一筆(細長的圈 + 右邊一個小 b 圈) */
    const tk = L(lvl, 0.5, 0.5, 0.52), base = T([[cx, cy - ry + 2]])[0];
    const tf = (pts) => rotAbout(pts.map(([x, y]) => [base[0] + x * tk, base[1] + y * tk]), base[0], base[1], tilt);
    if (!lvl) ops.push({ line: tf([[0, 0], [-3, -22], [3, -38], [12, -32], [9, -22]]), w: 3.2, jit: 0.3 });   // 26px:一筆勾起來的呆毛(兩個圈會糊成一團)
    else {
      ops.push({ line: tf([[-2, 0], [-4, -18], [-3, -36], [2, -46], [8, -34], [7, -16], [4, -6]]), w: L(lvl, 3.2, 3, 2.8), jit: 0.4 });
      ops.push({ line: tf([[6, -16], [13, -24], [20, -18], [16, -10], [7, -10]]), w: L(lvl, 3, 2.8, 2.6), jit: 0.4 });
    }
    /* 眼:下半個眼珠 + 一條外側上翹的眼皮(小尺寸放大) */
    const fs = L(lvl, 0.8, 0.62, 0.55), ey = cy - 11, ew = L(lvl, 3, 2.8, 2.6);
    [[cx - 10.5, 1], [cx + 9.5, -1]].forEach(([x, lid]) => {
      if (!lvl) { ops.push({ solid: T(ellipse(x, ey + 2, 3.4, 4.2, 12)), color: 'ink' }); return; }   // 26px:眼皮會看成皺眉,只留兩顆眼珠
      const half = [];
      for (let a = 0; a <= 180; a += 20) half.push([x + Math.cos(a * RAD) * 6.2 * fs, ey + 2 * fs + Math.sin(a * RAD) * 7 * fs]);
      ops.push({ solid: T(half), color: 'ink' }, { line: T([[x - 8 * fs, ey + fs - lid * fs], [x + 8 * fs, ey + fs + lid * fs]]), w: ew, jit: 0.25 });
    });
    /* 嘴:三角喙。36px 以上張嘴吐舌(chick-art 的 bleh),26px 閉嘴但放大 */
    const bx = cx + 1, by = cy + L(lvl, 5, 3, 3), S = L(lvl, 1, 0.95, 0.88), B = (pts) => T(pts.map(([x, y]) => [bx + x * S, by + y * S]));
    if (!lvl) ops.push({ out: B([[-8, -3], [7, -4.5], [0.5, 7]]), w: ew, jit: 0.25 });
    else {
      ops.push({ line: B([[-9, -2], [3, -10], [11, 9], [0, 5], [-9, -2]]), w: ew, jit: 0.3 });
      ops.push({ line: B([[0, 5], [-2, 15], [3, 17], [5, 7]]), w: ew - 0.4, jit: 0.25 });
    }
    return ops;
  });

  /* 文法基礎:兩片拼圖並排咬合,整組置中。只有一個凸頭:左片(塗黃)的凸頭伸進右片(留白)。
     (第一版左片下面還有一個凸頭,小尺寸看起來像槌子) */
  def('grammar', '文法基礎', '把句子組起來', (lvl) => {
    const T = (pts) => rotAbout(pts, 50, 50, -5);
    const kr = L(lvl, 10.5, 10, 9.5), cy = 50;
    const seam = [[50, 24], [50.5, cy - 7]].concat(arc(50 + kr * 0.95, cy, kr, kr, 218, 502, 16), [[50.5, cy + 7], [50, 76]]);
    const left = [[11, 24.5]].concat(seam, [[11.5, 76]]);
    const right = [[50, 24], [89, 23.5], [89.5, 76.5], [50, 76]];
    return [{ fill: T(left) }, { out: T(left) }, { line: T(right) }];
  });

  /* 自然發音:張開的嘴(上唇有唇峰的嘴唇塗黃、嘴裡深色;64px 以上看得到上排牙齒)加聲波 */
  /* 自然發音:張開的嘴加兩道聲波。嘴唇塗黃、粗墨線外框;嘴裡塗深黃(不塗黑),36px 以上加上排牙齒和一小塊舌頭。
     (第二版嘴裡整塊塗黑,重量比其他圖示重太多,像貼紙)
     26px 灰線版只留嘴形外框、兩唇中間一條線和一道聲波 */
  def('phonics', '自然發音', '開口唸', (lvl, slim) => {
    const cx = 33, cy = 56, T = (pts) => rotAbout(pts.map(([x, y]) => [x + 4, y]), cx + 4, cy, -4);   // 整組往右移 4,26px 粗外框才不會被左邊切掉
    const outer = spline([[4, 56], [12, 44], [24, 38], [33, 42.5], [42, 38], [54, 44], [62, 56], [53, 68.5], [33, 75.5], [13, 68.5]], true, 5);
    const waveW = L(lvl, 4.8, 4.4, 4.2), wave = (r, a) => ({ line: T(arc(cx, cy, r, r, -a, a, 8)), w: waveW });
    if (slim) {
      return [{ out: T(outer), w: OUT + 0.4 }, { line: T(spline([[8, 56], [20, 55], [33, 58.5], [46, 55], [58, 56]], false, 4)), w: 3 }, wave(42, 32)];
    }
    const hr = L(lvl, [14.5, 8], [16, 9.5], [16, 9.5]);
    const hole = spline([[cx - hr[0], 55], [cx - hr[0] * 0.55, 55 - hr[1] * 0.85], [cx, 55 - hr[1] * 0.75], [cx + hr[0] * 0.55, 55 - hr[1] * 0.85],
      [cx + hr[0], 55], [cx + hr[0] * 0.6, 55 + hr[1]], [cx, 55 + hr[1] * 1.15], [cx - hr[0] * 0.6, 55 + hr[1]]], true, 4);
    const lips = outer.concat([outer[0], hole[0]], hole.slice(1).reverse(), [hole[0]]);
    const [ha, hb] = hr;
    const ops = [{ fill: T(lips), R: 7 }, { solid: T(hole), color: 'paper' }, { fill: T(hole), color: DEEP, R: 6 }];
    /* 上排牙齒:白色一條(26px 也畫,嘴才不會被看成一隻眼睛);36px 以上下緣加一條細墨線,嘴底一小塊舌頭(只畫上緣) */
    ops.push({ solid: T([[cx - ha * 0.8, 55 - hb * 0.5], [cx - ha * 0.4, 55 - hb * 0.8], [cx, 55 - hb * 0.78], [cx + ha * 0.4, 55 - hb * 0.8],
      [cx + ha * 0.8, 55 - hb * 0.5], [cx + ha * 0.74, 55 - hb * L(lvl, 0.05, 0.18, 0.18)], [cx - ha * 0.74, 55 - hb * L(lvl, 0.05, 0.18, 0.18)]]), color: 'paper' });
    if (lvl) {
      ops.push({ line: T([[cx - ha * 0.74, 55 - hb * 0.18], [cx, 55 - hb * 0.1], [cx + ha * 0.74, 55 - hb * 0.18]]), w: 1.8, jit: 0.3 });
      ops.push({ line: T(arc(cx + 2, 55 + hb * 1.05, ha * 0.42, hb * 0.55, 200, 340, 8)), w: 2.2, jit: 0.3 });
    }
    ops.push({ out: T(outer), w: OUT + 0.8 }, { out: T(hole), w: L(lvl, 2.8, 2.6, 2.4) });
    ops.push(wave(L(lvl, 40, 39, 39), 34), wave(L(lvl, 53, 52, 52), 30));
    return ops;
  });

  /* 閱讀訓練:一張文章頁。整張紙塗黃,粗標題、一塊塗深黃的圖、兩條粗內文線(墨線外圍一圈留白,
     白色只留給文字線);64px 以上右上角摺起來。外框用跟首頁一樣的線寬與抖動 */
  /* 閱讀訓練:一張文章頁(每個尺寸都有右上摺角,跟題庫刷題的疊紙、刷刷題目的答案卡分開)。
     整張紙塗黃,一條粗短的標題、一塊塗深黃的圖、兩條內文線(墨線外圍一圈留白,白色只留給文字線)。
     26px 灰線版只留紙、摺角、標題和圖 */
  def('reading', '閱讀訓練', '文章', (lvl, slim) => {
    const T = (pts) => rotAbout(pts, 50, 50, 2);
    const ear = L(lvl, 18, 16, 15), x1 = 84;
    const page = T([[16, 8], [x1 - ear, 8], [x1, 8 + ear], [x1, 92], [16, 92]]), fold = T([[x1 - ear, 8], [x1 - ear + 0.5, 8 + ear], [x1, 8 + ear]]);
    const ops = slim ? [] : [{ fill: page }];
    ops.push({ solid: fold, color: 'paper' }, { out: page, jit: 0.9 }, { line: fold, w: L(lvl, 3, 2.8, 2.8), jit: 0.6 });
    const tl = (pts, w) => [{ line: pts, w: w + L(lvl, 3, 3.6, 4), color: 'paper', only: 'fill' }, { line: pts, w }];
    ops.push(...tl(T([[26, 22], [37, 21.5], [L(lvl, 50, 49, 48), 22.5]]), L(lvl, 7.5, 7.5, 8)));
    const img = T(rrect(25, 33, 53, 58, 2.5));
    if (!slim) ops.push({ solid: img, color: 'paper' }, { fill: img, color: DEEP, R: 9 });
    ops.push({ out: img, w: OUT, jit: 0.9 });
    if (lvl === 2) ops.push({ line: T([[28, 55], [35, 44], [41, 51], [45, 47], [51, 55]]), w: 2.2, jit: 0.5 });
    if (slim) return ops;
    const tw = L(lvl, 3.4, 3.4, 3.2);
    L(lvl, [70, 82], [70, 82], [70, 82]).forEach((y, i) => ops.push(...tl(T([[25, y], [50, y - 0.6], [i ? 60 : 75, y + 0.4]]), tw)));
    return ops;
  });

  /* 對話練習:後面一個大的對話框塗黃,前面疊一個小的塗淡黃(第一版前面那個全白,兩框不平衡),裡面三個略歪的點。
     兩個框的外框線寬、抖動都跟首頁一樣 */
  def('dialogue', '對話練習', '兩個人講話', (lvl) => {
    const big = bubble(8, 12, 68, 56, 14, 26, 12, [16, 71]);
    const small = bubble(38, 45, 92, 82, 13, 76, 11, [87, 94]);
    const r = L(lvl, 3.8, 3.4, 3.1);
    const blob = (x, y, k, a) => ({ solid: rotAbout(ellipse(x, y, r * k, r * (2 - k), 14), x, y, a), color: 'ink' });
    return [{ fill: big }, { out: big, jit: 0.9 }, { solid: small, color: 'paper' }, { fill: small, color: PALE, R: 12 }, { out: small, jit: 0.9 },
      blob(53, 63.8, 1.08, 20), blob(65, 63.2, 0.94, -30), blob(77.2, 64, 1.05, 60)];
  });

  /* 單字訓練:一疊卡片,最上面那張塗黃、寫 Aa(手寫的筆畫,不用字型)。
     26px 灰線版後面那張只畫露出來的上緣和右緣(整圈外框會跟前面那張糊在一起) */
  def('vocab', '單字訓練', '單字卡', (lvl, slim) => {
    const ops = [];
    if (lvl) { const c2 = rotAbout(rrect(30, 12, 88, 62, 5), 59, 37, 9); ops.push({ solid: c2, color: 'paper' }, { out: c2, w: 2.6 }); }
    const c1 = rotAbout(rrect(22, 19, 82, 71, 5), 52, 45, 3);
    const top = rotAbout(rrect(10, 30, 74, 86, 5), 42, 58, -5);
    if (slim) ops.push({ line: rotAbout([[26, 19], [77, 19], [82, 24], [82, 66]], 52, 45, 3), w: 2.8 });
    else ops.push({ solid: c1, color: 'paper' }, { out: c1, w: 2.8 });
    ops.push({ solid: top, color: 'paper' }, { fill: top }, { out: top });
    const T = (pts) => rotAbout(pts, 42, 58, -5), w = L(lvl, 3.6, 3.4, 3.2);
    ops.push({ line: T([[20, 77], [29.5, 43], [39, 77]]), w }, { line: T([[24, 65], [35, 64.5]]), w: w - 0.4 });
    ops.push({ out: T(ellipse(53, 68, 7.5, 8.5, 16)), w }, { line: T([[60.5, 57], [61, 77]]), w });
    return ops;
  });

  /* 聽力訓練:頭戴式耳機。26px 時頭帶畫成一條粗線,大一點時頭帶有寬度、塗黃,耳罩內側有軟墊 */
  def('listening', '聽力訓練', '聽', (lvl) => {
    const ops = [];
    if (!lvl) ops.push({ line: arc(50, 58, 33, 33, 186, 354, 16), w: 4.2 });
    else {
      const band = arc(50, 58, 34, 34, 182, 358, 16).concat(arc(50, 58, 26, 26, 358, 182, 14));
      ops.push({ fill: band, R: 5 }, { out: band, w: 2.6 });
    }
    [[12, 50, 31, 88], [69, 50, 88, 88]].forEach(([x0, y0, x1, y1], i) => {
      const cup = rotAbout(rrect(x0, y0, x1, y1, 8), (x0 + x1) / 2, (y0 + y1) / 2, i ? -4 : 4);
      ops.push({ solid: cup, color: 'paper' }, { fill: cup }, { out: cup });
      if (lvl) ops.push({ line: i ? [[69, 57], [65, 59], [65, 79], [69, 81]] : [[31, 57], [35, 59], [35, 79], [31, 81]], w: 2.4 });
    });
    return ops;
  });

  /* 寫作練習:一張塗黃的紙,一支大鉛筆在紙上拖出簽名(一個圈 + 波浪)。
     鉛筆筆身塗深黃跟紙分開,削尖的木頭留白,筆芯塗黑。(第一版紙是白的、簽名太細,看起來只是潦草線條) */
  def('writing', '寫作練習', '動筆寫', (lvl) => {
    const T0 = [45, 77], E = [93, 21], hw = L(lvl, 10, 10, 9.5);
    const paper = rotAbout(rrect(5, 36, 74, 94, 3), 40, 65, -4);
    const ops = [{ fill: paper }, { out: paper, jit: 0.9 }];
    /* 簽名:往上繞一個圈,再接波浪拖到筆尖 */
    const sig = [[10, 84], [15, 79], [20, 70], [21, 62], [17, 60], [14, 65], [16, 75], [21, 82], [26, 84], [30, 78], [33, 74], [37, 78], [39, 83], [42, 80], T0];
    ops.push({ line: spline(sig, false, 4), w: L(lvl, 4.4, 4.2, 4), jit: 0.35 });
    return ops.concat(pencil(T0, E, hw, L(lvl, 61, 67, 67), lvl));   // 26px 短一點,筆尾才不會出框
  });

  /* 不規則動詞:三張直立的小卡排成一列(卡上不寫字),上方用弧形箭頭把卡串起來:卡 → 卡 → 卡。
     箭頭畫在卡片上方而不是夾在卡片中間,才不會跟卡片糊成一串。36px 以上兩支箭頭一張跳一張;
     26px 兩支箭頭太小會變成一團波浪,改成一支大弧從第一張跳到第三張。
     (第一版三張卡中間夾直箭頭,糊成一串點;第二版兩張卡加一支箭頭,看不出「三個」) */
  def('verbs', '不規則動詞', '三個形態的變化', (lvl, slim) => {
    const ops = [];
    const xs = [15, 50, 85], tilt = [-5, 2, 5], hw = L(lvl, 11, 11.5, 11.5), hh = L(lvl, 19, 21, 21), cy = L(lvl, 67, 65, 65);
    const lift = [0, -2, 0];
    xs.forEach((x, i) => {
      const c = rotAbout(rrect(x - hw, cy + lift[i] - hh, x + hw, cy + lift[i] + hh, 4), x, cy, tilt[i]);
      if (!slim) ops.push({ fill: c, R: L(lvl, 8, 10, 11) });
      ops.push({ out: c, w: OUT + 0.2, jit: L(lvl, 0.5, 0.8, 0.9) });
    });
    const aw = L(lvl, 4.8, 4.4, 4.2), top = cy - hh - 5;
    const hop = (a, b, ry, ang, hl) => {
      const mx = (a + b) / 2, rx = (b - a) / 2, end = [mx + Math.cos(ang * RAD) * rx, top + Math.sin(ang * RAD) * ry];
      const t = unit([-Math.sin(ang * RAD) * rx, Math.cos(ang * RAD) * ry]);
      ops.push({ line: arc(mx, top, rx, ry, 196, ang, 12), w: aw, jit: 0.35 }, { line: head(end, Math.atan2(t[1], t[0]) / RAD, hl, 38), w: aw, jit: 0.3 });
    };
    if (!lvl) hop(xs[0] + 2, xs[2] - 2, 30, 338, 14);
    else [0, 1].forEach((i) => hop(xs[i] + 3, xs[i + 1] - 3, L(lvl, 0, 20, 21), 336, L(lvl, 0, 10, 9.5)));
    return ops;
  });

  /* 題庫刷題:錯開疊著的紙(36px 以上三張、26px 兩張),每張都斜放、往右上錯開一大截,後面的塗黃;
     最前面那張白的,打一個大黑勾(勾 = 這題做過了,不是答對,所以不用綠色)。
     (第二版兩張紙幾乎對齊,小圖只看得出一張打勾的卡片) */
  def('practice', '題庫刷題', '一題一題刷', (lvl, slim) => {
    const ops = [];
    const sheet = (x0, y0, x1, y1, a) => rotAbout(rrect(x0, y0, x1, y1, 3), (x0 + x1) / 2, (y0 + y1) / 2, a);
    if (lvl) {
      const s3 = sheet(44, 9, 90, 60, 10);   // 斜放後四角都留在畫布裡
      ops.push({ solid: s3, color: 'paper' }, { fill: s3, color: PALE, R: 12 }, { out: s3, w: 2.8, jit: 0.9 });
    }
    const s2 = lvl ? sheet(29, 14, 80, 74, 6) : sheet(34, 8, 88, 70, 10);
    const s1 = sheet(10, 30, 64, 94, -8);
    if (!slim) ops.push({ solid: s2, color: 'paper' }, { fill: s2 });
    ops.push({ out: s2, w: OUT, jit: 0.9 }, { solid: s1, color: 'paper' }, { out: s1, jit: 0.9 });
    ops.push({ line: rotAbout([[19, 62], [32, 77], [57, 44]], 37, 62, -6), w: L(lvl, 6.4, 6, 5.6) });
    return ops;
  });

  /* 模擬考:碼錶。上面有按鈕、斜邊一個小按鈕,錶面塗黃、一根指針 */
  def('mock', '模擬考', '計時考試', (lvl) => {
    const cx = 50, cy = 59, R = 31;
    const face = ellipse(cx, cy, R, R - 0.5, 40);
    const ops = [{ out: rrect(45, 20, 55, 28.5, 1), w: 2.6 }];
    const btn = rrect(39, 12, 61, 20, 3);
    ops.push({ fill: btn, R: 5 }, { out: btn, w: 2.8 });
    if (lvl) ops.push({ out: rotAbout(rrect(72, 25, 80, 32, 1.5), 76, 28.5, 45), w: 2.4 });
    ops.push({ fill: face }, { out: face });
    const ticks = L(lvl, [], [0, 90, 180, 270], [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]);
    ticks.forEach((a) => {
      const major = a % 90 === 0, r0 = R - 3, r1 = R - (major ? 9 : 6);
      ops.push({ line: [[cx + Math.cos(a * RAD) * r0, cy + Math.sin(a * RAD) * r0], [cx + Math.cos(a * RAD) * r1, cy + Math.sin(a * RAD) * r1]], w: major ? 2.4 : 1.6, jit: 0.3 });
    });
    ops.push({ line: [[cx, cy], [cx + 13, cy - 16]], w: L(lvl, 3.4, 3.2, 3) }, dot(cx, cy, L(lvl, 4.6, 3.8, 3.4)));
    return ops;
  });

  /* 程度檢測:半圓儀表。弧形色帶塗黃、刻度、一根指針、黑色圓點軸心。
     26px 刻度只留三條粗線、指針加粗(第二版小圖的細刻度糊在一起) */
  def('diagnostic', '程度檢測', '量程度', (lvl, slim) => {
    const cx = 50, cy = 70, Ro = 40, Ri = L(lvl, 21, 22, 23);
    const band = arc(cx, cy, Ro, Ro, 180, 360, 20).concat(arc(cx, cy, Ri, Ri, 360, 180, 14));
    const ops = slim ? [] : [{ fill: band }];
    ops.push(slim ? { line: arc(cx, cy, Ro, Ro, 180, 360, 20) } : { out: band });
    L(lvl, [220, 270, 320], [210, 240, 270, 300, 330], [195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345]).forEach((a, i) => {
      const major = lvl < 2 || i % 2 === 1, r1 = Ro - (major ? L(lvl, 11, 8, 8) : 5);
      ops.push({ line: [[cx + Math.cos(a * RAD) * (Ro - 2), cy + Math.sin(a * RAD) * (Ro - 2)], [cx + Math.cos(a * RAD) * r1, cy + Math.sin(a * RAD) * r1]], w: major ? L(lvl, 3.6, 2.6, 2.2) : 1.5, jit: 0.3 });
    });
    const na = 305 * RAD, len = L(lvl, 31, 33, 34);
    ops.push({ line: [[cx, cy], [cx + Math.cos(na) * len, cy + Math.sin(na) * len]], w: L(lvl, 5, 4.2, 3.8) }, dot(cx, cy, L(lvl, 7.5, 6, 5.5)));
    return ops;
  });

  /* 錯題本:線圈筆記本,封面塗黃(圈小一點、塗得密,跟其他圖示的黃一樣濃)、一個紅叉。
     26px 灰線版線圈只留兩個 */
  def('wrongbook', '錯題本', '記下答錯的題', (lvl, slim) => {
    const T = (pts) => rotAbout(pts, 55, 51, -3);
    const cover = T(rrect(24, 10, 86, 91, 5));
    const ops = [{ fill: cover, R: 11 }, { out: cover }];
    if (lvl === 2) ops.push({ line: T([[33, 12], [33.5, 89]]), w: 1.6, jit: 0.4 });
    const rx = L(lvl, 8, 7, 6.5), ry = L(lvl, 4.4, 3.8, 3.4);
    (slim ? [30, 72] : L(lvl, [27, 51, 75], [25, 42, 59, 76], [22, 36, 50, 64, 78])).forEach((y) => ops.push({ out: T(ellipse(24, y, rx, ry, 16)), w: L(lvl, 2.6, 2.4, 2.2), jit: 0.4 }));
    const x = 58, y = 51, a = L(lvl, 13, 12, 12), w = L(lvl, 5, 4.8, 4.4);
    ops.push({ line: T([[x - a, y - a], [x + a + 1, y + a]]), w, color: RED }, { line: T([[x + a, y - a - 1], [x - a, y + a]]), w, color: RED });
    return ops;
  });

  /* 每日練習:撕頁式日曆。上面兩個吊環、塗黃的表頭、底邊撕過的鋸齒,頁面上一個綠勾 */
  def('daily', '每日練習', '每天做', (lvl) => {
    const T = (pts) => rotAbout(pts, 50, 56, 2);
    let page;
    if (!lvl) page = rrect(16, 22, 84, 90, 5);
    else {
      const jag = [];
      for (let i = 0; i <= 10; i++) jag.push([84 - i * 6.8, i % 2 ? 87 : 91]);
      page = [].concat(arc(21, 27, 5, 5, 180, 270, 3), arc(79, 27, 5, 5, 270, 360, 3), [[84, 60]], jag, [[16, 60]]);
    }
    const header = [].concat(arc(21, 27, 5, 5, 180, 270, 3), arc(79, 27, 5, 5, 270, 360, 3), [[84, 40], [16, 40]]);
    const ops = [];
    if (lvl === 2) ops.push({ line: T([[19, 93], [50, 95], [82, 93.5]]), w: 2 });
    ops.push({ fill: T(header), R: 9 }, { out: T(page) }, { line: T([[16, 40], [50, 39.5], [84, 40]]), w: 2.6 });
    [34, 66].forEach((x) => ops.push({ out: T(ellipse(x, 22, 3.6, 8.5, 14)), w: L(lvl, 2.8, 2.6, 2.4), jit: 0.4 }));
    ops.push({ line: T(L(lvl, [[30, 63], [43, 76], [68, 49]], [[31, 64], [43, 75], [66, 51]], [[31, 64], [43, 75], [66, 51]])), w: L(lvl, 5.2, 4.6, 4.4), color: GREEN });
    return ops;
  });

  /* 能力分析:三根高低不同的長條,站在一條底線上。每根塗滿黃(圈小、塗得密),最高那根再疊一層深黃 */
  def('analysis', '能力分析', '看強弱', (lvl) => {
    const ops = [];
    [[14, 34, 50], [41, 60, 14], [67, 87, 62]].forEach(([x0, x1, top], i) => {
      const b = [[x0, 88], [x0 + (i - 1) * 0.6, top], [x1 + (i - 1) * 0.4, top + 0.8], [x1, 88]];
      ops.push({ fill: b, R: 9 });
      if (i === 1) ops.push({ fill: b, color: DEEP, R: 8 });
      ops.push({ out: b, w: L(lvl, 3, 3, 3) });
    });
    ops.push({ line: [[6, 88.5], [50, 88], [94, 89]] });
    return ops;
  });

  /* 學習記錄:時鐘,外圈是逆時針轉回去的箭頭(左下留一個缺口給箭頭) */
  def('history', '學習記錄', '過去的紀錄', (lvl) => {
    const cx = 53, cy = 53, R = 32;
    const ops = [{ fill: ellipse(cx, cy, R - 2, R - 2.5, 36) }, { line: arc(cx, cy, R, R - 0.5, 132, -180, 34) }];
    ops.push({ line: head([cx - R, cy + 8], 90, L(lvl, 11, 10, 9), 42) });
    if (lvl === 2) [270, 0, 90].forEach((a) => ops.push({ line: [[cx + Math.cos(a * RAD) * (R - 3), cy + Math.sin(a * RAD) * (R - 3)], [cx + Math.cos(a * RAD) * (R - 8), cy + Math.sin(a * RAD) * (R - 8)]], w: 2.2, jit: 0.3 }));
    ops.push({ line: [[cx, cy], [cx + 0.5, cy - 18]], w: L(lvl, 3.4, 3.2, 3) }, { line: [[cx, cy], [cx + 12, cy + 9]], w: L(lvl, 3.4, 3.2, 3) }, dot(cx, cy, L(lvl, 4.4, 3.6, 3.2)));
    return ops;
  });

  /* ---------- 畫 ---------- */
  const built = new Map();
  function opsFor(id, lvl, line) {
    const k = id + '|' + lvl + '|' + (line ? 1 : 0);
    if (!built.has(k)) built.set(k, ICONS[id].build(lvl, !!line));
    return built.get(k);
  }
  const vmod = (v) => ((Math.floor(+v || 0) % VARIANTS) + VARIANTS) % VARIANTS;
  function check(id) { if (!Object.prototype.hasOwnProperty.call(ICONS, id)) throw new Error('DoodleArt: 沒有這個圖示 ' + JSON.stringify(id) + '(有:' + Object.keys(ICONS).join('、') + ')'); }
  function paint(ctx, id, o) {
    const lvl = levelFor(o.size), v = vmod(o.variant), lineOnly = o.tone === 'line';
    /* 墨線每一筆用自己的種子(圖示、抖動組、第幾筆),兩種 tone 跳過的筆不同也不會讓其他筆跟著變,換 tone 時線條不跳 */
    const rsFor = (k) => rng(hash(id) + v * 101 + k * 7907);
    const rf = rng((hash(id) ^ 0x5bd1e995) + v * 7919);       // 塗鴉用
    /* 灰線版沒有色塊撐著,26px 時墨線再加粗三成(約 2.6 css px),細節也另外省到只剩外形加一兩個特徵(build 的第二個參數) */
    INKW = inkFor(o.size) * (lineOnly && lvl === 0 ? 1.3 : 1);
    const ink = o.ink || INK, paper = o.paper || PAPER;
    const col = (c) => (!c || c === 'ink' ? ink : c === 'paper' ? paper : lineOnly ? ink : c);
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    opsFor(id, lvl, lineOnly && lvl === 0).forEach((op, k) => {
      if (op.only && op.only !== o.tone) return;              // only: 'fill' / 'line' 只在那種 tone 畫
      if (op.fill) { if (!lineOnly) scribble(ctx, rf, op.fill, op.color || YELLOW, op.R); }
      else if (op.solid) solid(ctx, op.solid, col(op.color));
      else if (op.out) stroke(ctx, rsFor(k), op.out, op.w || OUT, col(op.color), op.jit, true);
      else if (op.line) stroke(ctx, rsFor(k), op.line, op.w || OUT, col(op.color), op.jit, false);
    });
    ctx.restore();
  }

  /* 把 undefined 的欄位拿掉再合併,data-* 沒寫的值才不會蓋掉預設 */
  function opts(defaults, opt) {
    const o = Object.assign({}, defaults);
    Object.keys(opt || {}).forEach((k) => { if (opt[k] !== undefined && opt[k] !== null && opt[k] !== '') o[k] = opt[k]; });
    if (o.tone !== 'fill' && o.tone !== 'line') throw new Error('DoodleArt: tone 只能是 fill 或 line,收到 ' + JSON.stringify(o.tone));
    return o;
  }
  const cache = new Map();
  /* 畫好一張 canvas(css 尺寸 size,解析度 × dpr),同樣的參數會重複用 */
  function render(id, opt) {
    check(id);
    const o = opts({ size: 40, variant: 0, tone: 'fill', ink: INK, paper: PAPER, dpr: (typeof window !== 'undefined' && window.devicePixelRatio) || 1 }, opt);
    const key = [id, o.size, o.dpr, vmod(o.variant), o.tone, o.ink, o.paper].join('|');
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
    const o = Object.assign({ x: 0, y: 0, size: 40 }, opt || {});
    ctx.drawImage(render(id, o), o.x, o.y, o.size, o.size * H / W);
  }

  /* 掛在一個 canvas 上。opt:size、tone、ink、paper、variant、animate(預設 false)、fps(animate 時,預設 6)、maxDpr(預設 3) */
  function mount(canvas, id, opt) {
    check(id);
    const o = opts({ size: 40, tone: 'fill', ink: INK, paper: PAPER, variant: 0, animate: false, fps: 6, maxDpr: 3 }, opt);
    const dpr = Math.min((window.devicePixelRatio || 1), o.maxDpr);
    canvas.width = Math.round(o.size * dpr); canvas.height = Math.round(o.size * H / W * dpr);
    canvas.style.width = o.size + 'px'; canvas.style.height = Math.round(o.size * H / W) + 'px';
    const ctx = canvas.getContext('2d');
    const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let icon = id, tone = o.tone, ink = o.ink, i = vmod(o.variant), timer = null;
    function paintNow() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(render(icon, { size: o.size, dpr, variant: i, tone, ink, paper: o.paper }), 0, 0);
    }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    paintNow();
    if (o.animate && !reduce) timer = setInterval(() => { i = (i + 1) % VARIANTS; paintNow(); }, 1000 / o.fps);
    return {
      stop,
      setTone(t) { if (t !== 'fill' && t !== 'line') throw new Error('DoodleArt: tone 只能是 fill 或 line'); tone = t; paintNow(); },
      setInk(c) { ink = c || INK; paintNow(); },
      setIcon(nid) { check(nid); icon = nid; paintNow(); },
      redraw: paintNow,
      get id() { return icon; },
      get tone() { return tone; },
      get animating() { return !!timer; },
      reducedMotion: reduce,
    };
  }

  /* 把 root 底下所有 <canvas data-doodle="id" data-size="40" data-tone="fill"> 畫好;掛過的不重掛。
     也讀 data-ink、data-variant、data-animate("true" 或 "1")。回傳這次新掛上的 handle;
     有不認得的 id 時,其他的照樣掛好,最後丟一個錯誤列出是哪些。 */
  const mounted = typeof WeakMap === 'function' ? new WeakMap() : new Map();
  function mountAll(root) {
    const scope = root || document;
    const list = scope.querySelectorAll ? scope.querySelectorAll('canvas[data-doodle]') : [];
    const out = [], bad = [];
    Array.prototype.forEach.call(list, (c) => {
      if (mounted.has(c)) return;
      const d = c.dataset || {};
      if (!Object.prototype.hasOwnProperty.call(ICONS, d.doodle)) { bad.push(d.doodle); return; }
      const h = mount(c, d.doodle, { size: +d.size || 40, tone: d.tone, ink: d.ink, variant: +d.variant || 0, animate: d.animate === 'true' || d.animate === '1' });
      mounted.set(c, h);
      out.push(h);
    });
    if (bad.length) throw new Error('DoodleArt: 沒有這個圖示 ' + bad.map((b) => JSON.stringify(b)).join('、'));
    return out;
  }
  const handleOf = (canvas) => mounted.get(canvas) || null;

  window.DoodleArt = {
    ids: Object.keys(ICONS),
    info: Object.fromEntries(Object.entries(ICONS).map(([id, f]) => [id, { name: f.name, meaning: f.meaning }])),
    colors: { ink: INK, yellow: YELLOW, deep: DEEP, pale: PALE, red: RED, green: GREEN, paper: PAPER, lineInk: '#767f88' },
    variants: VARIANTS,
    render,
    draw,
    mount,
    mountAll,
    handleOf,
    metrics: { width: W, height: H },
  };
})();
