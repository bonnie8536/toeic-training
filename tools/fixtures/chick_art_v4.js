/* 塗鴉小雞的圖(路線圖 1.5)。原檔在 repo 外:D:/claudecode/刷刷英文開發/小雞/chick-art.js(第四版,Bonnie 2026-10-16 定稿),
   預覽 D:/claudecode/刷刷英文開發/小雞/塗鴉小雞預覽.html。要改圖先改原檔、在預覽看過,再整份複製過來(保留這段開頭)。
   這裡只畫圖,不讀寫任何儲存;畫面怎麼用見 js/pet-ui.js、js/pet-roam.js。 */
/* 塗鴉小雞:用程式畫出手繪感(抖動的黑線、亂繞的黃色塗鴉),每一格重畫一次讓線條「沸騰」。
   風格依 Bonnie 2026-10-04 的參考圖;第二版依她的意見:動作更誇張、黃色塗鴉不用遮罩硬切、要有「雞掰可愛」的表情。
   第三版(2026-10-12):身體更圓潤可愛、黃色塗鴉的圈圈畫大一點。
   第四版(2026-10-13)依她的意見:塗鴉圈圈再大再密、照動畫原則加大變形、肚子餓改成「扁掉」(舊的跺腳大叫留成 demand 備用)、
     新增走路 walk / 跑步 run(面向右邊,要往左走就把畫布左右翻轉)。
   第四版修正(4.1,動畫導演意見):
     - 塗鴉圈圈不再跟著身體一起壓扁:只有圈心跟著身體走,圈圈本身在螢幕上畫,永遠是圓的(大小約 24~40,每圈不一樣、
       每行上下飄、橢圓比例也會變),比較像手畫;畫得很小(<120px)時左邊少塗出去一半。
     - 肚子餓:下半身變成「麻糬」——底部平貼地面、兩側往下垂;臉往下移、比例跟著縮,八字眉保持夠斜;
       一次吸氣嘆氣約 2.7 秒;呆毛和翅膀慢一拍、塌下去時甩過頭;最後斜眼瞄你一下(討拍)。
       注意:這個動作故意「漏氣」,面積會變小(不是保持體積)。
     - 吃東西改成四分之三側面、嘴巴帶頭啄下去,後腳往後翹;走路腿分開一點、身體抬高;跑步加快到每秒約 4 步、
       騰空時兩腳都離地很明顯、前傾、吐舌頭往後飄。
     - 每個動作有自己的速度(相對於 fps):跑步 1.5 倍、睡覺 5/8、肚子餓 6/8。
   2026-10-16:只改播放,圖沒變:用到哪一格才畫哪一格(審查發現第一次打開面板會一口氣畫完整個姿勢,卡住畫面約 0.1 秒)。
   畫法:所有點先算好再畫,壓扁拉長只動點的位置不動筆的粗細,線條才不會一邊粗一邊細。
   用法:const a = ChickArt.animate(canvas, { size: 200, fps: 8, pose: 'idle', onTick }); a.setPose('eat'); a.setFps(6); a.stop();
   fps 是「基準速度」:各動作會按 ChickArt.fps 的比例換算(fps 8 時跑步每秒 12 張、睡覺 5 張、肚子餓 6 張)。 */
(function () {
  const W = 240, H = 280;                 // 畫布的邏輯尺寸
  const CX = 120, CY = 172, RX = 67, RY = 60, B = CY + RY, GROUND = 254;
  const INK = '#151515', YELLOW = '#ffe100', SEED_C = '#c98a1c', SHINE = '#ffffff';
  const RAD = Math.PI / 180;
  const ID = (p) => p;
  let XF = ID;                            // 目前的座標轉換:身體的壓扁拉長、臉的跟隨
  let INKW = 1;                           // 線條加粗倍數:畫得很小(分頁列 52px)時線條加粗,才看得清楚
  let FACE_K = 1;                         // 臉被壓扁的程度(寬/高),八字眉靠它保持斜度
  const inkFor = (size) => (!size || size >= 120 ? 1 : Math.min(1.9, 1 + (120 - size) / 75));

  function rng(seed) {                    // mulberry32,同一個 seed 畫出同一張
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 把 (x,y) 先以 (px,py) 為支點縮放、旋轉,再搬到 (ox,oy) */
  function makeXF(ox, oy, px, py, sx, sy, th) {
    const c = Math.cos(th), s = Math.sin(th);
    return ([x, y]) => {
      const u = (x - px) * sx, v = (y - py) * sy;
      return [ox + u * c - v * s, oy + u * s + v * c];
    };
  }
  const rot = ([x, y], th) => [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)];

  /* 麻糬變形(肚子餓攤平用):下半身從橢圓變成方圓形(底部變平),越往下越寬(重量垂到地上);上半身越往上越窄,像圓頂 */
  function puddleWarp(p) {
    if (!p) return ID;
    const e = 2 / (2 + 1.2 * p), widen = 0.25 * p;
    return ([x, y]) => {
      const u = (x - CX) / RX, v = (y - CY) / RY;
      if (v <= 0) return [CX + u * (1 + 0.3 * p * v) * RX, y];   // 上半身收窄成圓頂
      const rho = Math.hypot(u, v);
      if (rho < 1e-6) return [x, y];
      const c = u / rho, s = v / rho;
      const v2 = rho * Math.pow(s, e);
      const u2 = rho * Math.sign(c) * Math.pow(Math.abs(c), e) * (1 + widen * v2);
      return [CX + u2 * RX, CY + v2 * RY];
    };
  }
  /* 攤平時貼地:最底下 8px 壓成 3px,底部看起來平平地貼在地上 */
  const flatten = ([x, y]) => (y > GROUND - 8 ? [x, GROUND - 8 + (y - (GROUND - 8)) * 0.4] : [x, y]);

  function curve(ctx, p) {
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length - 1; i++) {
      ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    }
    const last = p[p.length - 1];
    ctx.lineTo(last[0], last[1]);
  }
  /* 一條手畫的線:點先經過目前的轉換,再加一點抖動,用中點二次曲線連起來 */
  function line(ctx, pts, r, w, jit) {
    const j = jit === undefined ? 1.3 : jit;
    const p = pts.map(XF).map(([x, y]) => [x + (r() - 0.5) * 2 * j, y + (r() - 0.5) * 2 * j]);
    ctx.lineWidth = w * INKW;
    curve(ctx, p);
    ctx.stroke();
  }
  function fillPoly(ctx, pts) {
    const p = pts.map(XF);
    ctx.beginPath();
    p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }
  function dot(ctx, x, y, rad) { const [px, py] = XF([x, y]); ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill(); }
  function ring(x, y, rx, ry, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push([x + Math.cos(i / n * Math.PI * 2) * rx, y + Math.sin(i / n * Math.PI * 2) * ry]);
    return pts;
  }

  /* 不太圓的外框:半徑有幾個低頻起伏(每隻小雞固定) */
  function blob(shape, cx, cy, rx, ry, from, sweep, step) {
    const pts = [];
    for (let a = from; a <= from + sweep + 0.001; a += step) {
      const t = a * RAD;
      const k = 1 + shape.reduce((s, h) => s + h.amp * Math.sin(h.n * t + h.ph), 0);
      pts.push([cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k]);
    }
    return pts;
  }

  /* 黃色塗鴉:像拿筆來回繞大圈亂塗,整片是一大團大圈圈。
     只有「圈心」跟著身體變形(XF),圈圈本身在螢幕上畫,所以身體壓扁拉長時圈圈還是圓的(像動畫師重畫一次塗鴉)。
     圈圈大小每圈不一樣(約 24~40)、每行會上下飄、橢圓比例 0.8~1.0;圈心只在身體裡面走,靠邊的圈自然塗出去一點,
     不裁切;左邊多塗出去一些(跟參考圖一樣),畫得很小時左邊少塗一半,免得變成一圈模糊的黃暈。 */
  function scribble(ctx, r, k) {
    const sx = k.sx, sq = k.sq, spill = k.size && k.size < 120 ? 0.5 : 1;
    const base = Math.min(31 * Math.sqrt(sx * sq), RY * sq * 0.6, RX * sx * 0.6);   // 螢幕上的圈半徑
    const rows = Math.max(9, Math.round(15 * Math.sqrt(Math.min(1, sq))));
    const cx = CX - 4, cy = CY + 1;
    const yHalf = Math.max(3, RY - base * 0.95 / sq), rxl = base / sx;              // 圈心可以走的範圍(身體座標)
    const pts = [];
    for (let row = 0; row < rows; row++) {
      const t = -1 + (row + 0.5) * 2 / rows;
      const span = Math.sqrt(Math.max(0, 1 - t * t));
      const y0 = cy + t * yHalf + (r() - 0.5) * 3;
      const hwL = Math.max(4, RX * span - rxl * 0.9 + 6 * spill), hwR = Math.max(4, RX * span - rxl * 0.95);
      const dir = row % 2 ? -1 : 1;
      let x = dir > 0 ? cx - hwL : cx + hwR;
      let ang = r() * Math.PI * 2;
      const ph = [r() * 6, r() * 6, r() * 6, r() * 6], wob = 0.17 + r() * 0.06;
      const big = base * (0.8 + 0.2 * span);
      while (dir > 0 ? x < cx + hwR : x > cx - hwL) {
        ang += 0.26 + r() * 0.05;
        x += dir * (0.8 + r() * 0.25);
        const drift = 6 * Math.min(1, sq) * Math.sin(x / 40 * Math.PI * 2 + ph[0]);
        const c = XF([x, y0]);
        const rad = big * (1 + wob * Math.sin(ang * 0.16 + ph[1]) + 0.1 * Math.sin(ang * 0.45 + ph[2]));
        const ratio = 0.9 + 0.1 * Math.sin(ang * 0.21 + ph[3]);
        let px = c[0] + Math.cos(ang) * rad, py = c[1] + drift + Math.sin(ang) * rad * ratio;
        if (k.puddle) py = Math.min(py, GROUND - 2);
        pts.push([px, py]);
      }
    }
    ctx.save();
    ctx.strokeStyle = YELLOW;
    ctx.lineWidth = 2.7 * (1 + (INKW - 1) * 0.4);
    ctx.lineJoin = ctx.lineCap = 'round';
    curve(ctx, pts);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 臉(look > 0 時五官往右挪,像轉成四分之三側面) ---------- */
  function oval(ctx, r, x, y, w, h) {
    fillPoly(ctx, blob([{ n: 2, amp: 0.06, ph: r() * 6 }], x, y, w, h, 0, 360, 30));
  }
  /* 八字眉:臉被壓扁時把眉毛在臉的座標裡畫得更斜,壓扁後在螢幕上仍然至少約 25° */
  function sadBrows(ctx, r, L, R) {
    const d = Math.min(20, 8 * FACE_K);
    line(ctx, [[L[0] - 9, L[1] - 12 + d / 2], [L[0] + 6, L[1] - 12 - d / 2]], r, 3.6, 0.5);
    line(ctx, [[R[0] + 9, R[1] - 12 + d / 2], [R[0] - 6, R[1] - 12 - d / 2]], r, 3.6, 0.5);
  }
  function smugLids(ctx, r, L, R, sad) {   // 半睜眼:下半個眼珠 + 一條眼皮
    [L, R].forEach(([x, y], i) => {
      const half = [];
      const sh = sad ? 1.5 : 0;            // 斜眼瞄人時眼珠往一邊靠
      for (let a = 0; a <= 180; a += 20) half.push([x + sh + Math.cos(a * RAD) * 6.2, y + 2 + Math.sin(a * RAD) * 7]);
      fillPoly(ctx, half);
      const tiltLid = sad ? (i ? 2 : -2) : (i ? -1 : 1);   // sad:眼皮外側往下垂;smug:外側往上翹
      line(ctx, [[x - 8, y + 1 - tiltLid], [x + 8, y + 1 + tiltLid]], r, 3.8, 0.5);
    });
  }
  function eyes(ctx, r, kind, look) {
    const lk = look || 0;
    const L = [CX - 21 + lk * 1.15, CY - 24], R = [CX + 20 + lk * 0.85, CY - 24];
    ctx.fillStyle = INK;
    if (kind === 'open') { oval(ctx, r, L[0], L[1], 6, 10.5); oval(ctx, r, R[0], R[1], 6, 10.5); return; }
    if (kind === 'smug') { smugLids(ctx, r, L, R, false); return; }          // 半睜眼、一臉看不起人
    if (kind === 'smugmad') {                                               // 半睜眼 + 倒豎眉:跑步時的拚勁
      smugLids(ctx, r, L, R, false);
      line(ctx, [[L[0] - 10, L[1] - 13], [L[0] + 7, L[1] - 6]], r, 4, 0.6);
      line(ctx, [[R[0] + 10, R[1] - 13], [R[0] - 7, R[1] - 6]], r, 4, 0.6);
      return;
    }
    if (kind === 'sidesad') { smugLids(ctx, r, L, R, true); sadBrows(ctx, r, L, R); return; }   // 可憐兮兮地斜眼瞄你
    if (kind === 'derp') { oval(ctx, r, L[0], L[1], 7, 12); oval(ctx, r, R[0] + 1, R[1] + 3, 4, 6.5); return; }
    if (kind === 'happy') {              // ^ ^
      [L, R].forEach(([x, y]) => line(ctx, [[x - 8, y + 4], [x - 3, y - 4], [x + 3, y - 4], [x + 8, y + 4]], r, 4, 0.7));
      return;
    }
    if (kind === 'closed') {             // 睡覺
      [L, R].forEach(([x, y]) => line(ctx, [[x - 8, y], [x - 3, y + 5], [x + 3, y + 5], [x + 8, y]], r, 4, 0.7));
      return;
    }
    if (kind === 'squeeze') {            // > <
      line(ctx, [[L[0] - 7, L[1] - 7], [L[0] + 5, L[1]], [L[0] - 7, L[1] + 7]], r, 4, 0.6);
      line(ctx, [[R[0] + 7, R[1] - 7], [R[0] - 5, R[1]], [R[0] + 7, R[1] + 7]], r, 4, 0.6);
      return;
    }
    if (kind === 'angry') {              // 眉毛倒豎
      oval(ctx, r, L[0], L[1] + 2, 5.5, 8.5); oval(ctx, r, R[0], R[1] + 2, 5.5, 8.5);
      line(ctx, [[L[0] - 10, L[1] - 15], [L[0] + 7, L[1] - 8]], r, 4, 0.6);
      line(ctx, [[R[0] + 10, R[1] - 15], [R[0] - 7, R[1] - 8]], r, 4, 0.6);
      return;
    }
    if (kind === 'sad') {                // 八字眉、水汪汪的大眼(加一個反光點),可憐但可愛
      oval(ctx, r, L[0], L[1] + 3, 7, 10.5); oval(ctx, r, R[0], R[1] + 3, 7, 10.5);
      ctx.fillStyle = SHINE;
      dot(ctx, L[0] + 2.2, L[1] - 1, 2.4); dot(ctx, R[0] + 2.2, R[1] - 1, 2.4);
      ctx.fillStyle = INK;
      sadBrows(ctx, r, L, R);
      return;
    }
    if (kind === 'sadshut') {            // 嘆氣時閉眼:往下彎的弧(臉壓扁時彎得更多,才不會變成橫線)
      const k = Math.min(2.4, FACE_K);
      [L, R].forEach(([x, y]) => line(ctx, [[x - 7, y + 2 * k], [x - 3, y - 1 * k], [x + 3, y - 1 * k], [x + 7, y + 2 * k]], r, 4, 0.5));
      sadBrows(ctx, r, L, R);
      return;
    }
    if (kind === 'blink') {
      [L, R].forEach(([x, y]) => line(ctx, [[x - 7, y + 1], [x, y + 2], [x + 7, y + 1]], r, 4, 0.6));
    }
  }

  /* 嘴:closed 閉、open 張、yell 大叫、bleh 吐舌頭(舌尖會甩)、sigh 嘆氣的小 o */
  function beak(ctx, r, kind, tongue, look) {
    const x = CX + 1 + (look || 0) * 1.35, y = CY + 6;
    const S = (pts) => pts.map(([a, b]) => [x + (a - x) * 1.35, y + (b - y) * 1.35]);
    if (kind === 'closed') {
      line(ctx, S([[x - 9, y - 2], [x + 3, y - 9], [x + 10, y + 3], [x - 1, y + 5], [x - 9, y - 2]]), r, 3.4, 0.8);
      return;
    }
    const open = kind === 'yell' ? 13 : kind === 'bleh' ? 6 : kind === 'sigh' ? 8 : 5;
    line(ctx, S([[x - 9, y - 2], [x + 3, y - 10], [x + 11, y + 3 + open], [x, y + open - 1], [x - 9, y - 2]]), r, 3.4, 0.8);
    if (kind === 'bleh') {
      const tx = tongue || 0;
      line(ctx, S([[x - 1, y + open - 1], [x - 3 + tx, y + open + 11], [x + 3 + tx, y + open + 13], [x + 5, y + open + 1]]), r, 3, 0.6);
      line(ctx, S([[x + 1, y + open + 2], [x + 1 + tx * 0.6, y + open + 9]]), r, 2, 0.4);
    } else if (kind === 'open') {
      line(ctx, S([[x - 1, y + open - 1], [x - 2, y + open + 6], [x + 3, y + open + 7], [x + 4, y + open + 1]]), r, 2.8, 0.6);
    }
  }

  /* 翅膀:角度制。0 = 水平往外,90 = 垂直往下,負的往上舉。會跟著身體傾斜一起轉,但長度不被壓扁 */
  const WING_PRESETS = {
    rest: [100, 100, 21], up: [-58, -58, 26], down: [88, 88, 24], flapA: [-38, -38, 26], flapB: [22, 22, 26],
    flailA: [-60, 28, 27], flailB: [28, -60, 27], limp: [50, 50, 24],
  };
  function wing(ctx, r, o, a, len, body, th) {
    const S = body([CX + o * RX * 0.97, CY + 2]);
    const d = rot([o * Math.cos(a * RAD), Math.sin(a * RAD)], th);
    const pp = [-o * d[1], o * d[0]];        // 翅膀的「下面」那一側
    const P = (k, m) => [S[0] + d[0] * len * k + pp[0] * len * m, S[1] + d[1] * len * k + pp[1] * len * m];
    line(ctx, [S, P(0.5, -0.18), P(1, 0), P(0.5, 0.42), P(0.08, 0.3)], r, 3.6);
  }
  function wings(ctx, r, f, body, th) {
    const p = WING_PRESETS[f.wings || 'rest'] || WING_PRESETS.rest;
    const len = f.wlen || p[2];
    wing(ctx, r, -1, f.wl !== undefined ? f.wl : p[0], len, body, th);
    wing(ctx, r, 1, f.wr !== undefined ? f.wr : p[1], len, body, th);
  }

  /* 呆毛:tuft 是相對身體的彎曲角度(正 = 往右倒),越靠尖端彎越多;tl 是長度(>1 拉長、<1 縮短);
     kink 是尖端再多折的角度(軟趴趴的羽毛) */
  function tuft(ctx, r, f, body, th) {
    const base = body([CX + (f.look || 0) * 0.3, CY - RY + 4]);
    const bend = (f.tuft !== undefined ? f.tuft : -(f.tilt || 0) * 0.6) * RAD, kink = (f.kink || 0) * RAD;
    const tl = f.tl || 1, side = 1 / Math.sqrt(tl);
    const map = (pts) => pts.map(([x, y]) => {
      const q = [x * side, y * tl];
      const d = Math.hypot(x, y);
      const v = rot(q, th + bend * (0.3 + 0.7 * Math.min(1, d / 46)) + kink * Math.max(0, Math.min(1, (d - 22) / 20)));
      return [base[0] + v[0], base[1] + v[1]];
    });
    line(ctx, map([[-2, 0], [-4, -18], [-3, -36], [2, -46], [8, -34], [7, -16], [4, -6]]), r, 3.6, 0.9);
    line(ctx, map([[6, -16], [13, -24], [20, -18], [16, -10], [7, -10]]), r, 3.4, 0.8);
  }

  /* 腳:legs = [[左腳水平偏移, 抬高], [右腳...]],腳掌位置以地面為準(踩著的腳不會跟著身體滑)。
     舊的 feet 名稱還能用:stand 站、jump 騰空收腳、stompL/stompR 抬一隻腳跺、tuck 攤平時只露出腳趾。
     側身時左腳(index 0)是遠的那隻,畫細一點,兩隻腳才分得開 */
  function feet(ctx, r, f, body) {
    const look = f.look || 0, dir = look > 4 ? 1 : look < -4 ? -1 : 0;
    const hx = dir ? [CX - 9, CX + 9] : [CX - 22, CX + 14];
    const kind = f.feet || 'stand';
    const hips = hx.map((x) => body([x, B - 3]));
    if (kind === 'jump') {
      hips.forEach(([x, y], i) => {
        const s = i ? 1 : -1;
        line(ctx, [[x, y], [x + s * 3, y + 13], [x + s * 9, y + 18]], r, 3.6);
      });
      return;
    }
    if (kind === 'tuck') {                  // 攤成一灘:腳藏在肚子下,只露出一點腳趾
      hx.forEach((x0) => {
        const x = body([x0 + (x0 < CX ? -10 : 10), B])[0];
        line(ctx, [[x - 10, GROUND + 1], [x, GROUND], [x + 10, GROUND + 1]], r, 3.4, 0.8);
        line(ctx, [[x, GROUND], [x - 4, GROUND + 6]], r, 2.8, 0.6);
      });
      return;
    }
    const legs = f.legs || [[0, kind === 'stompL' ? 14 : 0], [0, kind === 'stompR' ? 14 : 0]];
    hips.forEach((hip, i) => {
      const [ldx, lift] = legs[i];
      const w = dir && i === 0 ? 2.7 : 3.6;
      let foot = [hx[i] + (f.dx || 0) * 0.3 + ldx, GROUND - lift];
      if (foot[1] < hip[1] + 9) foot = [hip[0] + ldx * 0.3, hip[1] + 11];   // 腳抬太高就收在肚子下
      const knee = [(hip[0] + foot[0]) / 2 - dir * Math.min(lift, 14) * 0.45, (hip[1] + foot[1]) / 2];
      line(ctx, dir ? [hip, knee, foot] : [hip, foot], r, w);
      const tilt = lift > 3 ? dir * 22 * RAD : 0;              // 抬起來的腳腳趾朝下
      const T = (pts) => pts.map(([x, y]) => { const v = rot([x, y], tilt); return [foot[0] + v[0], foot[1] + v[1]]; });
      if (dir === 0) {
        line(ctx, T([[-13, 1], [-2, 0], [12, 1]]), r, w);
        line(ctx, T([[-1, 0], [-6, 7]]), r, w - 0.6, 0.8);
      } else {
        line(ctx, T([[-8 * dir, 1], [0, 0], [15 * dir, 1]]), r, w);
        line(ctx, T([[0, 0], [-5 * dir, 6]]), r, w - 0.6, 0.8);
      }
    });
  }

  /* ---------- 特效 ---------- */
  const FACE_FX = (e) => e === 'bang' || e === 'sweat' || e.startsWith('bubble') || e.startsWith('sigh');
  function fx(ctx, r, list, k) {
    ctx.save();
    ctx.strokeStyle = INK; ctx.fillStyle = INK;
    ctx.lineCap = ctx.lineJoin = 'round';
    list.forEach((e) => {
      const [name, arg] = e.split(':');
      const n = +arg || 0;
      if (name === 'dust') {                     // 落地的煙,在身體壓扁後的兩側(不超出畫布)
        [-1, 1].forEach((s) => {
          const x = CX + s * Math.min(RX * k.sx + 6, 94);
          line(ctx, [[x, GROUND - 2], [x + s * 10, GROUND - 11], [x + s * 19, GROUND - 6], [x + s * 23, GROUND - 1]], r, 2.6, 1);
          line(ctx, [[x + s * 4, GROUND - 16], [x + s * 10, GROUND - 22]], r, 2.2, 0.6);
        });
      } else if (name === 'stomp') {             // 跺腳的震動線
        [-1, 1].forEach((s) => line(ctx, [[CX + s * 46, GROUND - 3], [CX + s * 60, GROUND - 12]], r, 2.4, 0.6));
      } else if (name === 'motion') {            // 往上衝的速度線:畫在身體兩側,不會看起來像多長了腳
        [-1, 1].forEach((s) => {
          const x = k.cx + s * (RX * k.sx + 8);
          line(ctx, [[x, k.cy + 6], [x, k.cy + 34]], r, 2.4, 0.6);
          line(ctx, [[x + s * 9, k.cy + 18], [x + s * 9, k.cy + 40]], r, 2.2, 0.6);
        });
      } else if (name === 'speed') {             // 跑步時身後的速度線,n = 長度(10 = 最長)
        const x0 = k.cx - (RX * k.sx + 10) * k.dir, m = (n || 10) / 10;
        [[-26, 22], [2, 30], [26, 18]].forEach(([dy, len]) =>
          line(ctx, [[x0, k.cy + dy], [x0 - len * m * k.dir, k.cy + dy + 2]], r, 2.4, 0.6));
      } else if (name === 'shadow') {            // 騰空時地上留一小段影子線,看得出腳離地
        line(ctx, [[k.cx - 22, GROUND + 1], [k.cx + 18, GROUND + 1]], r, 2.4, 0.5);
      } else if (name === 'kick') {              // 腳踢起來的小煙
        const x = CX - 36 * k.dir;
        line(ctx, [[x, GROUND - 1], [x - 7 * k.dir, GROUND - 9], [x - 15 * k.dir, GROUND - 5], [x - 18 * k.dir, GROUND]], r, 2.4, 0.8);
      } else if (name === 'crumbs') {            // 飼料噴出來
        ctx.fillStyle = SEED_C;
        [[1, -0.6], [1.4, -1.1], [0.7, -1.4], [1.8, -0.4], [-0.6, -1]].forEach(([vx, vy], i) => {
          dot(ctx, k.beak[0] + 4 + vx * n * 9 + i * 4, GROUND - 6 + vy * n * 10 + n * n * 1.6, 2.8);
        });
        ctx.fillStyle = INK;
      } else if (name === 'impact') {            // 啄到地面的小衝擊線
        const x = k.beak[0] + 6;
        [[-1, -0.3], [0, -1], [1, -0.3]].forEach(([ux, uy]) =>
          line(ctx, [[x + ux * 9, GROUND - 4 + uy * 9], [x + ux * 17, GROUND - 4 + uy * 17]], r, 2.2, 0.4));
      } else if (name === 'bang') {              // 生氣的 !!,每格抖一下位置和角度
        const jx = (r() - 0.5) * 4, ja = (r() - 0.5) * 10 * RAD;
        const J = (pts) => pts.map(([x, y]) => { const v = rot([x - (CX + 79), y - (CY - 54)], ja); return [CX + 79 + v[0] + jx, CY - 54 + v[1]]; });
        line(ctx, J([[CX + 74, CY - 70], [CX + 72, CY - 48]]), r, 3.6, 0.8);
        line(ctx, J([[CX + 86, CY - 66], [CX + 84, CY - 46]]), r, 3.6, 0.8);
        J([[CX + 71, CY - 40], [CX + 83, CY - 38]]).forEach(([x, y]) => dot(ctx, x, y, 2.4));
      } else if (name === 'sweat') {
        line(ctx, [[CX - 72, CY - 56], [CX - 77, CY - 46], [CX - 72, CY - 42], [CX - 68, CY - 47], [CX - 72, CY - 56]], r, 2.4, 0.6);
      } else if (name === 'bubble') {            // 鼻涕泡
        if (n > 0) {
          line(ctx, ring(CX + 14 + n * 0.7, CY + 2 + n * 0.2, n, n, 14), r, 2.2, 0.3);
          line(ctx, ring(CX + 14 + n * 0.4, CY - n * 0.3, Math.max(1, n * 0.25), Math.max(1, n * 0.25), 6).slice(1, 4), r, 2, 0.2);
        } else {                                 // 啵:破掉的小線
          [[1, 0], [0.7, -0.7], [0.7, 0.7], [0, -1], [0, 1]].forEach(([dx, dy]) =>
            line(ctx, [[CX + 24 + dx * 8, CY + 4 + dy * 8], [CX + 24 + dx * 14, CY + 4 + dy * 14]], r, 2, 0.4));
        }
      } else if (name === 'sigh') {              // 嘆出來的一小團氣,往旁邊飄
        const x = CX + 70 + n * 6, y = CY - 16 - n * 14, s = 4 + n * 2.5;   // 從嘴巴往右上飄出去
        line(ctx, ring(x, y, s, s * 0.8, 10), r, 2.2, 0.5);
        line(ctx, [[x - s - 2, y + 2], [x - s - 10, y + 5]], r, 2, 0.4);
      } else if (name === 'growl') {             // 肚子咕嚕:身體右側、肚子高度,外框外面 3 條彎線 )))
        const e0 = k.body([CX + RX, CY + 14]);
        const x = Math.min(e0[0] + 7, W - 24), y = e0[1];
        [0, 1, 2].forEach((i) => {
          const h = 5 + i * 3.5, xx = x + i * 6;
          line(ctx, [[xx, y - h], [xx + 3 + i, y], [xx, y + h]], r, 2.3, 0.3);
        });
      } else if (name === 'z') {                 // 打呼的 z
        const z = (x, y, s) => line(ctx, [[x, y], [x + s, y], [x, y + s], [x + s, y + s]], r, 2.6, 0.5);
        z(CX + 58 + n * 3, CY - 74 - n * 5, 10);
        if (n >= 2) z(CX + 76 + n * 2, CY - 96 - n * 4, 7);
      }
    });
    ctx.restore();
  }

  /* ---------- 動作 ----------
     每格:dy 上下、dx 左右、sq 垂直縮放(<1 壓扁、>1 拉長,以腳底為支點,寬度自動變 1/sq 保持體積)、
     sx 想自己指定寬度時用、tilt 傾斜(度)、look 五官往右挪(側身)、eyes、beak、tongue 舌尖偏移、
     wings 翅膀預設名或 wl/wr 左右翅膀角度、tuft/tl/kink 呆毛彎曲、長度、尖端折角、feet 或 legs 腳、fx 特效、
     fy 臉往下移(啄地時嘴巴帶頭)、puddle 攤平成麻糬(0~1)、floor 讓身體最低點離地多少、hold 這格停幾拍(極端姿勢多停 = 漸快漸慢)。 */
  const GR = GROUND - B;                           // 身體底部貼地要往下移多少

  /* 待機(嗆聲):扭屁股。停在兩端時壓扁(0.84,多停一拍)、經過中間時拉長(1.12);
     呆毛、舌頭、翅膀都慢半拍再甩過頭(±24,回彈 12) */
  const idle = [
    [-10, -5, 0.84, -24, 2], [-10, -5, 1.0, 12, 1], [-2, -1, 1.12, -24, 1], [6, 3, 1.03, -24, 1],
    [10, 5, 0.84, 24, 2], [10, 5, 1.0, -12, 1], [2, 1, 1.12, 24, 1], [-6, -3, 1.03, 24, 1],
  ].map(([tilt, dx, sq, lag, hold]) => ({
    tilt, dx, sq, tuft: lag, tl: sq < 0.95 ? 0.88 : sq > 1.05 ? 1.1 : 1, wl: 100 + lag, wr: 100 - lag,
    eyes: 'smug', beak: 'bleh', tongue: lag * 0.5, hold,
  }));

  /* 走路(面向右):8 格兩步。接觸 → 往下壓(壓扁) → 經過(拉長、身體最高) → 抬起;
     踩地的腳每格往後 10;身體抬高、腿長一點,小尺寸才看得到腳在動。變形收斂在 0.88~1.1,不會像果凍 */
  const WALK_LEG = [[18, 0], [8, 0], [-2, 0], [-12, 0], [-22, 5], [-10, 17], [6, 20], [16, 8]];
  const WALK_BODY = [[-16, 0.98, 6, 1.0, -10], [-12, 0.88, 8, 1.14, -4], [-22, 1.1, 5, 0.86, -16], [-24, 1.04, 4, 0.95, -12]];
  const walk = WALK_LEG.map((legA, i) => {
    const [dy, sq, tilt, tl, tf] = WALK_BODY[i % 4];
    const sw = Math.cos(i / 8 * Math.PI * 2) * 24;
    return {
      dy, sq, tilt, tl, tuft: tf, look: 14, legs: [legA, WALK_LEG[(i + 4) % 8]],
      wl: 92 + sw, wr: 92 - sw, eyes: 'smug', beak: 'bleh', tongue: [-5, 6, 2, -4][i % 4],
    };
  });

  /* 跑步(面向右、身體前傾):6 格兩步,每秒 12 張 = 每秒 4 步。
     落地壓扁(前傾 10°)→ 蹬地拉長(前傾 22°)→ 兩腳騰空(後腳往後踢高、前腳往前伸、身體最高,上升變慢,地上留一小段影子線)。
     踩地的腳每格往後 20。呆毛落地時往前甩、騰空時往後飄;舌頭往後飄;速度線每格都有,落地時短一點 */
  const RUN_LEG = [[20, 0], [0, 0], [-30, 28], [-12, 26], [8, 22], [22, 20]];
  const RUN_BODY = [
    [-6, 0.84, 10, 10, -30, ['kick', 'speed:5'], -5],
    [-20, 1.14, 22, -30, 10, ['speed:8'], -9],
    [-28, 1.2, 22, -60, 45, ['speed:10', 'shadow'], -8],
  ];
  const run = RUN_LEG.map((legA, i) => {
    const [dy, sq, tilt, tf, wa, fxs, tg] = RUN_BODY[i % 3];
    return {
      dy, sq, tilt, tl: 1.3, tuft: tf, look: 18, legs: [legA, RUN_LEG[(i + 3) % 6]],
      wl: wa, wr: wa + 8, eyes: 'smugmad', beak: 'bleh', tongue: tg, fx: fxs,
    };
  });

  /* 吃東西:轉成四分之三側面(嘴巴帶頭),往後仰預備(停兩拍)→ 拉長衝下去 → 嘴先碰地、身體只壓一點(0.86),
     靠呆毛甩過去、飼料噴出來和後腳往後翹來表現撞擊 → 彈回 → 再啄 → 抬頭拉長 → 得意吐舌 */
  const PECK = { tilt: 31, floor: 1, sq: 0.86, look: 24, fy: 22, tuft: 34, tl: 0.8, eyes: 'squeeze', legs: [[-8, 18], [0, 0]] };
  const eat = [
    { tilt: 4, eyes: 'open', beak: 'closed', hold: 2 },
    { tilt: -14, dy: -3, sq: 1.1, look: 16, tuft: 14, eyes: 'smug', beak: 'closed', wl: 82, wr: 118, hold: 2 },
    { tilt: 22, floor: 12, sq: 1.12, look: 20, fy: 12, tuft: -22, tl: 1.12, eyes: 'squeeze', beak: 'open', wl: 62, wr: 62 },
    Object.assign({ beak: 'closed', wl: 30, wr: 30, fx: ['crumbs:1', 'impact'] }, PECK),
    { tilt: 18, floor: 14, sq: 1.06, look: 20, fy: 10, tuft: -12, eyes: 'open', beak: 'closed', wl: 74, wr: 74, fx: ['crumbs:2'] },
    Object.assign({ beak: 'open', wl: 34, wr: 34, fx: ['crumbs:1', 'impact'] }, PECK),
    { tilt: -10, dy: -4, sq: 1.12, look: 10, tuft: 22, tl: 1.1, eyes: 'smug', beak: 'closed', wl: 110, wr: 80, fx: ['crumbs:3'] },
    { tilt: -6, sq: 0.94, tuft: -8, eyes: 'smug', beak: 'bleh', tongue: 3, hold: 2 },
  ];

  const POSES = {
    idle,
    // 開心:站好 → 蹲很低(預備,多停一拍)→ 腳還踩著地、身體拉長往上衝 → 騰空(一開始最快、越接近頂點越慢)→
    // 頂點停一下 → 落下越來越快(拉長)→ 落地壓到最扁(0.6)冒煙 → 反彈 → 翅膀甩過頭再回來。直上直下,不左右飄
    happy: [
      { eyes: 'happy', beak: 'open', wings: 'rest' },
      { sq: 0.7, eyes: 'squeeze', beak: 'closed', wl: 60, wr: 60, tuft: 0, tl: 0.7, hold: 2 },
      { sq: 1.3, eyes: 'happy', beak: 'yell', wl: 80, wr: 80, tl: 0.8, tuft: -6 },
      { sq: 1.2, dy: -30, tilt: -3, eyes: 'happy', beak: 'yell', wl: 30, wr: 30, feet: 'jump', tl: 0.95, tuft: 6, fx: ['motion'] },
      { sq: 1.06, dy: -48, tilt: -2, eyes: 'happy', beak: 'yell', wl: -50, wr: -50, feet: 'jump', tl: 1.1, tuft: 8 },
      { sq: 0.96, dy: -56, tilt: 3, eyes: 'happy', beak: 'yell', wl: 18, wr: 18, feet: 'jump', tl: 1.28, tuft: -10, hold: 2 },
      { sq: 1.04, dy: -48, tilt: 3, eyes: 'happy', beak: 'open', wl: -20, wr: -20, feet: 'jump', tl: 1.3, tuft: -6 },
      { sq: 1.2, dy: -24, tilt: 2, eyes: 'happy', beak: 'open', wl: -62, wr: -62, feet: 'jump', tl: 1.35, tuft: -4 },
      { sq: 0.6, eyes: 'squeeze', beak: 'open', wl: 5, wr: 5, tl: 0.7, tuft: 12, fx: ['dust'] },
      { sq: 1.12, dy: -3, eyes: 'happy', beak: 'open', wl: 118, wr: 118, tl: 1.25, tuft: -10 },
      { sq: 0.95, eyes: 'happy', beak: 'open', wl: 100, wr: 100, tl: 0.95, tuft: 4 },
    ],
    eat,
    // 肚子餓(扁掉):下半身攤成麻糬貼在地上,呆毛軟趴趴折下來、翅膀攤在地上。
    // 慢慢吸氣鼓起來(一臉期待,停 3 拍)→ 很快嘆一口氣 → 塌過頭(停 3 拍)→ 回彈一點、肚子咕嚕 → 斜眼瞄你討拍(停 3 拍)。
    // 呆毛和翅膀都比身體慢一拍,塌下去時甩過頭。可憐但可愛,不是死掉。這個動作故意漏氣,面積會變小
    hungry: [
      { sq: 0.52, sx: 1.24, eyes: 'sad', beak: 'closed', wl: 28, wr: 28, tuft: 40, hold: 2 },
      { sq: 0.66, sx: 1.16, eyes: 'sad', beak: 'closed', wl: 28, wr: 28, tuft: 38 },
      { sq: 0.88, sx: 1.08, eyes: 'sad', beak: 'closed', wl: 60, wr: 60, tuft: 32, hold: 3 },
      { sq: 0.6, sx: 1.2, eyes: 'sadshut', beak: 'sigh', wl: 74, wr: 74, tuft: 24, fx: ['sigh:1'] },
      { sq: 0.45, sx: 1.28, eyes: 'sadshut', beak: 'sigh', wl: 16, wr: 16, tuft: 54, fx: ['sigh:2'], hold: 3 },
      { sq: 0.52, sx: 1.24, eyes: 'sad', beak: 'closed', wl: 30, wr: 30, tuft: 40, fx: ['growl'], hold: 2 },
      { sq: 0.52, sx: 1.24, look: 8, eyes: 'sidesad', beak: 'closed', wl: 26, wr: 34, tuft: 38, fx: ['growl'], hold: 3 },
      { sq: 0.52, sx: 1.24, eyes: 'sad', beak: 'closed', wl: 28, wr: 28, tuft: 40 },
    ].map((f) => Object.assign({ dy: GR, feet: 'tuck', puddle: 1, tl: 1.3, kink: 45 }, f)),
    // 討食(備用,原本的肚子餓):抬腳時拉長、跺下去壓扁加震動線,翅膀亂揮,呆毛甩來甩去(跺下去那格甩到 ±28)
    demand: [
      { dx: -5, tilt: -9, dy: -4, sq: 1.12, eyes: 'angry', beak: 'yell', wl: -62, wr: 30, feet: 'stompL', tuft: 16, fx: ['bang'] },
      { dx: 3, tilt: 6, sq: 0.8, eyes: 'angry', beak: 'yell', wl: 26, wr: -55, tuft: -28, tl: 0.85, fx: ['bang', 'stomp'] },
      { dx: 5, tilt: 9, dy: -4, sq: 1.12, eyes: 'squeeze', beak: 'yell', wl: 30, wr: -62, feet: 'stompR', tuft: -16, fx: ['bang'] },
      { dx: -3, tilt: -6, sq: 0.8, eyes: 'angry', beak: 'yell', wl: -55, wr: 26, tuft: 28, tl: 0.85, fx: ['bang', 'stomp'] },
      { dx: -5, tilt: -9, dy: -4, sq: 1.12, eyes: 'angry', beak: 'yell', wl: -62, wr: 30, feet: 'stompL', tuft: 16, fx: ['bang', 'sweat'] },
      { dx: 3, tilt: 6, sq: 0.8, eyes: 'squeeze', beak: 'yell', wl: 26, wr: -55, tuft: -28, tl: 0.85, fx: ['bang', 'sweat', 'stomp'] },
      { dx: 5, tilt: 9, dy: -4, sq: 1.12, eyes: 'angry', beak: 'yell', wl: 30, wr: -62, feet: 'stompR', tuft: -16, fx: ['bang'] },
      { dx: -3, tilt: -6, sq: 0.8, eyes: 'angry', beak: 'yell', wl: -55, wr: 26, tuft: 28, tl: 0.85, fx: ['bang', 'stomp'] },
    ],
    // 睡覺:呼吸變大(0.92~1.08),吸飽和吐完各停三拍,一次呼吸約 2.4 秒;呆毛垂著,比身體晚一拍晃;
    // 鼻涕泡跟著吸氣變大再破掉
    sleep: [
      { sq: 0.92, tuft: -38, tl: 0.9, fx: ['bubble:3', 'z:0'], hold: 3 },
      { sq: 0.98, tuft: -46, tl: 0.9, fx: ['bubble:6', 'z:1'] },
      { sq: 1.04, tuft: -42, tl: 0.95, fx: ['bubble:10', 'z:2'] },
      { sq: 1.08, tuft: -32, tl: 1.0, fx: ['bubble:14', 'z:3'], hold: 3 },
      { sq: 1.04, tuft: -26, tl: 1.0, fx: ['bubble:0', 'z:4'] },
      { sq: 0.97, tuft: -30, tl: 0.95, fx: ['z:5'], hold: 2 },
      { sq: 0.93, tuft: -40, tl: 0.9, fx: ['bubble:1', 'z:6'] },
    ].map((f) => Object.assign({ tilt: -4, eyes: 'closed', beak: 'bleh', tongue: 1, wings: 'down' }, f)),
    walk,
    run,
  };
  /* 不想看動畫(減少動態)時每個姿勢顯示的那一格 */
  const CALM = { idle: 1, happy: 0, eat: 0, hungry: 0, demand: 1, sleep: 0, walk: 0, run: 1 };
  /* 走路和跑步每拍該往前移動多少(邏輯像素),移動速度跟腳步對上才不會滑 */
  const TRAVEL = { walk: 10, run: 20 };
  /* 各動作在基準 fps = 8 時的播放速度;實際 = 呼叫者給的 fps × 這裡 / 8 */
  const POSE_FPS = { run: 12, sleep: 5, hungry: 6 };
  const fpsFor = (pose, base) => base * (POSE_FPS[pose] || 8) / 8;

  /* floor:讓身體(轉過、壓扁後)最低的那一點離地面剛好 floor 像素,啄地時身體才會貼地而不是陷進地裡 */
  function floorDy(f) {
    const sq = f.sq || 1, sx = f.sx || 1 / sq, th = (f.tilt || 0) * RAD;
    const low = -RY * sq * Math.cos(th) + Math.hypot(RX * sx * Math.sin(th), RY * sq * Math.cos(th));
    return GROUND - f.floor - (B + low);
  }

  /* 畫一格。shape 是這隻小雞固定的身形,seed 決定這一格的抖動 */
  function draw(ctx, shape, f, seed, size) {
    const r = rng(seed);
    INKW = inkFor(size);
    const sq = f.sq || 1, dx = f.dx || 0, look = f.look || 0, pud = f.puddle || 0;
    const dy = (f.floor !== undefined ? floorDy(f) : (f.dy || 0)) + (pud ? 4.8 : 0);   // 攤平時貼地壓縮掉的高度補回來
    const sx = f.sx || 1 / sq;                    // 壓扁就變寬、拉長就變窄,面積不變(肚子餓例外)
    const th = (f.tilt || 0) * RAD;
    const affine = makeXF(CX + dx, B + dy, CX, B, sx, sq, th);
    const warp = puddleWarp(pud);
    const body = pud ? (p) => flatten(affine(warp(p))) : affine;
    // 五官跟著身體走但只變形一部分,小尺寸也看得清楚;壓得很扁時臉往下移、縮得多一點,才不會撞到頭頂
    const fpw = sq < 0.7 ? 0.6 : 0.45;
    const fc0 = body([CX, CY - 12 + (f.fy || 0)]), fc = [fc0[0], fc0[1] + Math.max(0, 1 - sq) * (pud ? 18 : 12)];
    const fsx = Math.pow(sx, fpw), fsy = Math.pow(sq, fpw);
    FACE_K = fsx / fsy;
    const face = makeXF(fc[0], fc[1], CX, CY - 12, fsx, fsy, th);
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = INK; ctx.fillStyle = INK;

    XF = ID;
    feet(ctx, r, f, body);

    XF = body;
    scribble(ctx, r, { sx, sq, size, puddle: pud });
    ctx.strokeStyle = INK;
    line(ctx, blob(shape, CX, CY, RX, RY, -112, 338, 9), r, 4.4, 1.0);   // 外框左上留缺口

    XF = ID;
    tuft(ctx, r, f, body, th);
    wings(ctx, r, f, body, th);

    XF = face;
    eyes(ctx, r, f.eyes || 'open', look);
    beak(ctx, r, f.beak || 'open', f.tongue, look);
    const list = f.fx || [];
    fx(ctx, r, list.filter(FACE_FX), {});

    XF = ID;
    const ctr = body([CX, CY]);
    fx(ctx, r, list.filter((e) => !FACE_FX(e)), {
      sx, sq, bottom: B + dy, cx: ctr[0], cy: ctr[1], dir: look < 0 ? -1 : 1, body,
      beak: face([CX + 1 + look * 1.35, CY + 10]),
    });
    ctx.restore();
  }

  function makeShape(seed) {
    const r = rng(seed);
    return [2, 3, 4].map((n) => ({ n, amp: 0.006 + r() * 0.01, ph: r() * Math.PI * 2 }));
  }
  const poseSeed = (seed, pose) => seed * 1000 + Object.keys(POSES).indexOf(pose) * 97;
  const frameSeed = (base, i, variant) => base + i * 13 + variant * 101;

  /* 每一格各畫 2 種抖動到離屏畫布,播的時候交替,線條會沸騰。
     用到哪一格才畫哪一格(第一次打開不會一口氣畫完整個姿勢卡住畫面;減少動態時只畫靜止的那一格),畫過的留著重播。 */
  function bake(pose, px, shape, seedBase, size) {
    const slots = POSES[pose].map(() => [null, null]);
    return (i, b) => slots[i][b] || (slots[i][b] = (() => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * px); c.height = Math.round(H * px);
      const ctx = c.getContext('2d');
      ctx.scale(px, px);
      draw(ctx, shape, POSES[pose][i], frameSeed(seedBase, i, b), size);
      return c;
    })());
  }

  /* 把 hold 展開成播放順序:[格, 這格的第幾拍] */
  function sequence(pose) {
    const seq = [];
    POSES[pose].forEach((f, k) => { for (let j = 0; j < (f.hold || 1); j++) seq.push([k, j]); });
    return seq;
  }

  function animate(canvas, opt) {
    const o = Object.assign({ size: 200, fps: 8, pose: 'idle', seed: 7 }, opt || {});
    const dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr || 3);   // maxDpr:限制解析度,省記憶體(每格預先畫好兩張)
    const px = o.size / W * dpr;
    canvas.width = Math.round(W * px); canvas.height = Math.round(H * px);
    canvas.style.width = o.size + 'px'; canvas.style.height = Math.round(o.size * H / W) + 'px';
    const ctx = canvas.getContext('2d');
    const shape = makeShape(o.seed);
    const cache = {};
    const framesOf = (p) => cache[p] || (cache[p] = bake(p, px, shape, poseSeed(o.seed, p), o.size));
    let pose = POSES[o.pose] ? o.pose : 'idle', fps = o.fps, i = 0, timer = null, seq = sequence(pose);
    const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    function paint(img) { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0); }
    function tick() {
      const fr = framesOf(pose);
      if (reduce) { paint(fr(CALM[pose] || 0, 0)); return; }
      const [k, j] = seq[i % seq.length];
      paint(fr(k, (Math.floor(i / seq.length) + j) % 2));
      if (typeof o.onTick === 'function') o.onTick({ pose, frame: k, tick: i, travel: (TRAVEL[pose] || 0) * o.size / W });
      i++;
    }
    function start() { stop(); tick(); if (!reduce) timer = setInterval(tick, 1000 / fpsFor(pose, fps)); }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    start();
    return {
      setPose(p) { if (POSES[p]) { pose = p; seq = sequence(p); i = 0; start(); } },
      setFps(n) { fps = n; start(); },
      stop,
      get pose() { return pose; },
      get fps() { return fpsFor(pose, fps); },
      reducedMotion: reduce,
    };
  }

  /* 給測試和印格子表用:把某個姿勢的第 k 格畫進 ctx(邏輯尺寸 W×H,呼叫的人自己縮放) */
  function drawFrame(ctx, pose, k, opt) {
    const o = Object.assign({ seed: 7, variant: 0, size: 200 }, opt || {});
    draw(ctx, makeShape(o.seed), POSES[pose][k], frameSeed(poseSeed(o.seed, pose), k, o.variant), o.size);
  }

  window.ChickArt = {
    animate,
    poses: Object.keys(POSES),
    drawFrame,
    frameCount: (p) => (POSES[p] ? POSES[p].length : 0),
    holds: (p) => (POSES[p] ? POSES[p].map((f) => f.hold || 1) : []),
    calm: Object.assign({}, CALM),
    travel: Object.assign({}, TRAVEL),       // 走路/跑步每拍前進的邏輯像素(乘上 size / metrics.width 就是螢幕像素)
    fps: Object.assign({ idle: 8, happy: 8, eat: 8, demand: 8, walk: 8 }, POSE_FPS),   // 基準 8 時各動作的每秒張數
    metrics: { width: W, height: H, ground: GROUND },   // ground = 腳底在畫布裡的高度(邏輯像素)
  };
})();
