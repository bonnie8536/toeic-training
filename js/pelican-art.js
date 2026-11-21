/* 塗鴉鵜鶘的圖(主要吉祥物)。原檔與預覽不在這個 repo(第五版)。要改圖先改原檔、在預覽看過,再整份複製過來(保留這段開頭)。
   這裡只畫圖,不讀寫任何儲存;畫法跟塗鴉小雞(js/chick-art.js)同一套,兩隻要看起來是同一個人畫的。
   第一版:本體定型 + 待機(idle)。
   - 長相照選定的草圖:圓滾滾的身體、往左伸的長直嘴(上嘴是一條細長三角、尖端很尖;嘴的下緣一條直線),
     下面掛著很大的嘴袋,從嘴尖附近一路鼓到身體前方;嘴袋塗黃色蠟筆(斜線來回塗、中間留白縫、左邊和下緣塗出去);
     兩道往中間壓低的眉毛加兩個小圓眼(臭臉但可愛,跟小雞一樣嘴硬);頭頂一撮往後倒的呆毛(兩個小圈);
     身體右側一隻小翅膀,尾端三瓣羽毛;短短的火柴腿,各三根腳趾。
   - 跟草圖不同的兩點:不畫眼睛旁邊那一勾藍色(全身不出現藍色);白色部分(身體、頭、上嘴、翅膀、呆毛)全部塗成純白,
     放在灰底或別的東西上面時蓋得住後面,不是透明的。
   - 畫法:所有點先算好再畫;身體呼吸起伏、嘴袋晃動只動點的位置,不動筆的粗細。墨線每格重新抖一次,線條會「沸騰」。
     黃色斜線只有「範圍」跟著身體變形,斜線本身在畫面上畫,方向永遠一樣(像重新塗一次)。
   - 大小:邏輯畫布 300×280,腳底的地面線固定在 258。鵜鶘是主角,通常畫得比小雞大;
     筆粗是小雞的 0.84 倍,鵜鶘畫成小雞的 1.5 倍寬時(例如 180 對 120)兩隻的墨線在螢幕上一樣粗、抖動一樣大。
   - 待機(idle):臭臉站著等你。輕輕吸氣吐氣(身體往上鼓一點再落回來)、吸飽時眨一下眼,
     嘴袋比身體慢半拍:吸氣時往下墜、吐氣時往上甩過頭再晃回來;呆毛也慢半拍。8 格、一圈約 2.4 秒(每秒 5 張)。
   第二版(只改畫法,格數、holds、速度、靜止格都沒變):
   - 嘴袋的黃色改成一束一束彎彎的掃筆:每束 2~4 筆來回,方向在 20°~60° 之間亂跳、長短不一,約三成是後來反方向彎著疊上去的;
     留白變成零散的小碎縫;左邊和下緣塗出去的地方參差不齊。
   - 墨線像真的筆畫:同一條線起筆收筆細、中段粗,中間有輕重(±25%);接頭的地方線會多畫出去一點;
     頭頂到呆毛那一段多描一次。抖動加大到 1.4 倍,整體筆粗加粗 15%。
   - 眼睛改成比較大的圓點,上面約四分之一壓在眉毛下;眉毛加粗、右眉斜度改成約 15°。
   - 畫得很小時:96 以下線條至少 1.5 倍粗,52 時約 2.3 倍,眼睛再放大、眉毛縮短,省略腳趾。
   第三版(格數、holds、速度、靜止格都沒變):外框、嘴袋、臉、翅膀、呆毛改成在選定的圖上量座標來對。
   - 臉:眉毛縮短、變細、放平(左約 17°、右約 12°),內側粗、眉尾細;眼睛小一點,跟眉毛之間留一條細縫(臭臉但可愛,不兇)。
   - 嘴袋:碗的左半、碗底、右半一筆畫完,碗底圓圓的、最低點在嘴袋寬一半多一點;右上端停在嘴線下面,嘴線右端不再往上勾。
     黃色白縫放寬到約一成五,左下多塗出去一點。
   - 身體接近正圓(右半邊照圖收回來,右上方飽滿一點);呆毛大一點、圈頭圓;翅膀尾端改成三片圓頭的羽毛,中間最長、凹口深。
   - 待機:起伏和嘴袋晃動收到約四成,抖動收回 1.25 倍,各格輪廓大小幾乎不變;頭頂多描的那一筆離原線近一點。
   第四版(格數、holds、速度、靜止格都沒變):
   - 臉:眼睛改成上緣切平的半圓(瞇眼、垂著眼皮),平的一邊直接頂著眉毛;眉毛加粗、斜約 22°,
     內側那一端壓在眼睛的內上角,兩條眉合起來是 V 字。沒睡飽、不爽但可愛,跟小雞的瞇眼對得起來。
   - 頭:上嘴的上緣畫到眉毛前面就停(多畫出去一點),頭頂另外一筆圓弧(最高點在身體中線附近、右上方收進來),
     頭到身體接近一顆圓球,不再是往右斜的水滴;呆毛跟著移到新的頭頂,縮小一成、再往右後倒一點。
   - 嘴袋的碗底往下放,白肚子只露出一彎細月牙。
   - 52 px 時墨線再加粗,眼睛放大跟眉毛合成一塊,臭臉看得出來。
   第五版(version 2):本體、待機一筆都沒改(待機的畫法、亂數用量都跟第四版一樣),新姿勢接在 idle 後面。
     姿勢的名字跟小雞一樣(網站的元件用同樣的名字叫牠):
   - happy 成績好:「哼,還不錯嘛」的得意,不是歡呼。抬著下巴站好 → 蹲一下(預備,停 2 拍)→ 腳還踩著地、身體拉長往上衝 →
     騰空(收腳、翅膀張開、地上留影子線)→ 頂點停一下、頭旁邊冒出得意的短線 → 落下 → 落地壓扁冒煙、眼睛擠一下 → 回彈 →
     抬下巴得意(停 2 拍)→ 回到開頭。眉毛鬆開、眼睛是開心的弧線;嘴袋比身體慢半拍,往上衝時往下墜、落下時往上甩、落地時重重一甩。
     畫布上方的空間不多,跳得不高(約 28),靠收腳、影子線和嘴袋的甩動看出騰空。10 格,每秒 8 張。
   - oops 成績不理想:尷尬加懊惱,不哭也不裝可憐。縮一下 → 縮到最底,眼睛擠成 > <、眉毛皺起來,嘴往下垂、嘴袋垂下來,
     額頭上方冒出一團打結的黑線、頭的右邊一滴汗(停 2 拍)→ 回彈 → 吸一口氣(線團鬆開)→ 嘆氣扁下去、嘴邊冒一團氣(停 2 拍)→
     鬆下來 → 斜眼瞄你一下(一邊眉毛挑高,「看什麼看」,停 3 拍)→ 眨眼回到開頭。9 格,每秒 4 張(比待機慢)。
   - read 看書:右邊的翅膀轉下來扶著書的右邊,左邊伸出一隻小一號、同樣三瓣羽毛的翅膀壓住書的左下角;
     書在身體前面、嘴袋的右下方(蓋住碗底一點),不擋眼睛。
     書頁白色、封面用黃色斜線塗(跟嘴袋同一種蠟筆),全身沒有藍色。眼睛半閉往下看,在書上左右掃 → 皺眉 → 翻一頁(右頁翹起來、
     落到左邊)→ 點一下頭 → 抬回來。8 格,每秒 4 張,動作小,可以長時間放著。
   - sleep 睡覺:坐在地上(身體放低、只露出腳趾)、嘴微微往下垂,眼睛閉成兩道往下彎的弧線,眉毛放鬆;
     慢慢吸氣吐氣,嘴袋跟著鼓一下,頭上冒出墨線畫的 z(一個變兩個、往右上飄)。7 格,每秒 3 張(最慢)。
   - 頭往下低(嘴往下)的格子,整隻往右挪一點,長嘴的尖端才不會超出畫布;身體壓扁時幾乎不變寬(左右只剩嘴尖到翅膀尖的空間)。
   - 新的特效(線團、汗、嘆氣、z、得意的短線、落地的煙、影子線)都用同一支墨線畫,每格重抖;畫得很小時一樣加粗。
   用法:const a = PelicanArt.animate(canvas, { size: 180, fps: 8, pose: 'idle', onTick }); a.setPose('happy'); a.setFps(6); a.stop();
   fps 是「基準速度」:各動作會按 PelicanArt.fps 的比例換算(fps 8 時待機每秒 5 張、開心 8 張、尷尬和看書 4 張、睡覺 3 張)。 */
(function () {
  const W = 300, H = 280, GROUND = 258;    // 邏輯尺寸;GROUND = 腳底(地面線)的高度
  const CX = 150, BOT = 242;               // 呼吸時身體以肚子底部為支點上下伸縮
  const INK = '#151515', YELLOW = '#ffe100', WHITE = '#ffffff';
  const PEN = 0.84;                        // 筆粗與抖動是小雞的幾倍(見開頭說明)
  const PEN_W = PEN * 1.15, JIT = PEN * 1.25; // 第二版:筆粗再加 15%;抖動第二版加到 1.4 倍,第三版收回 1.25 倍(輪廓比較穩)
  const RAD = Math.PI / 180;
  const ID = (p) => p;
  let XF = ID;                             // 目前的座標轉換:身體的呼吸、嘴袋的晃動
  let INKW = 1;                            // 線條加粗倍數:畫得很小時線條加粗,才看得清楚
  let TINY = false;                        // 畫得非常小(64 以下):省略腳趾、眉毛縮短、眼睛再放大
  /* 150 以上不加粗;96 時 1.5 倍;52 時約 3.3 倍(第四版:52 時再加粗,臭臉才看得出來) */
  const inkFor = (size) => (!size || size >= 150 ? 1 : size >= 96 ? 1 + 0.5 * (150 - size) / 54
    : Math.min(3.4, 1.5 + 1.8 * (96 - size) / 44));

  function rng(seed) {                     // mulberry32,同一個 seed 畫出同一張
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rot = ([x, y], th) => [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)];
  const smooth = (t) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };

  /* 穿過每個點的平滑曲線(Catmull-Rom),每 seg 長取一個點;line() 會讓每個點各抖一點,線才像手畫 */
  function spline(pts, seg) {
    const out = [pts[0].slice()];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const n = Math.max(1, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / seg));
      for (let j = 1; j <= n; j++) {
        const t = j / n, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2
          + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * t3)));
      }
    }
    return out;
  }
  function curve(ctx, p) {
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length - 1; i++) {
      ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    }
    const last = p[p.length - 1];
    ctx.lineTo(last[0], last[1]);
  }
  /* 一條手畫的線:點先經過目前的轉換,再加一點抖動,用中點二次曲線連起來(筆粗乘 PEN_W、抖動乘 JIT)。
     press = true 時像真的筆:起筆收筆細(0.78)、中段粗(1.15),中間再有一兩次輕重起伏,整條在 ±25% 之內;
     做法是把曲線攤成密密的折線,一小段一小段換筆粗畫(圓頭接起來看不出接縫)。畫得很小時輕重變化收小,線才夠黑 */
  function line(ctx, pts, r, w, jit, press) {
    const j = (jit === undefined ? 1.3 : jit) * JIT;
    const p = pts.map(XF).map(([x, y]) => [x + (r() - 0.5) * 2 * j, y + (r() - 0.5) * 2 * j]);
    const lw = w * PEN_W * INKW;
    if (!press || p.length < 3) {
      ctx.lineWidth = lw;
      curve(ctx, p);
      ctx.stroke();
      return;
    }
    const d = dense(p), n = d.length - 1;
    const amp = INKW > 1.4 ? 0.4 : 1, f = 1 + r() * 2, ph = r() * 6.3;
    const prof = (u) => 1 + amp * (-0.22 + 0.37 * Math.sqrt(Math.max(0, Math.sin(Math.PI * u))) + 0.08 * Math.sin(u * f * 6.28 + ph));
    const step = 4;
    for (let a = 0; a < n; a += step) {
      const b = Math.min(n, a + step);
      ctx.lineWidth = lw * Math.max(0.75, Math.min(1.25, prof((a + b) / 2 / n)));
      ctx.beginPath();
      ctx.moveTo(d[a][0], d[a][1]);
      for (let i = a + 1; i <= b; i++) ctx.lineTo(d[i][0], d[i][1]);
      ctx.stroke();
    }
  }
  /* 把 curve() 會畫的中點二次曲線攤成折線(每段二次曲線取 3 個點) */
  function dense(p) {
    const out = [p[0]];
    let cur = p[0];
    for (let i = 1; i < p.length - 1; i++) {
      const c = p[i], e = [(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2];
      for (let k = 1; k <= 3; k++) {
        const t = k / 3, s = 1 - t;
        out.push([s * s * cur[0] + 2 * s * t * c[0] + t * t * e[0], s * s * cur[1] + 2 * s * t * c[1] + t * t * e[1]]);
      }
      cur = e;
    }
    out.push(p[p.length - 1]);
    return out;
  }
  /* 線頭多畫出去一點(接頭的地方超出去,像手畫):a 是起點往外延多少、b 是終點往外延多少 */
  function extend(pts, a, b) {
    const out = pts.slice();
    const push = (p, q, k) => { const L = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1; return [p[0] + (p[0] - q[0]) / L * k, p[1] + (p[1] - q[1]) / L * k]; };
    if (a) out.unshift(push(pts[0], pts[1], a));
    if (b) out.push(push(pts[pts.length - 1], pts[pts.length - 2], b));
    return out;
  }
  function fillPoly(ctx, pts) {
    const p = pts.map(XF);
    ctx.beginPath();
    p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }

  /* ---------- 形狀(邏輯座標,面向左邊) ---------- */
  /* 第三版起,外框、嘴袋、臉、翅膀、呆毛的座標都是在選定的圖上量的(圖上的位置換算成這裡的邏輯座標,取線的中心) */
  /* 外框分兩筆(第四版):
     第一筆是上嘴的上緣,從嘴尖斜上去,在眉毛前面就停(J 點);
     第二筆從 J 點開始畫頭頂的圓弧(比上嘴陡,接頭有個轉折,頭才是一顆圓頂,不是一路斜上去的水滴),
     最高點在身體中線附近,右上方收進來,繞過右邊、肚子底部,往左上收進嘴袋的底(停在嘴袋碗底下面)。
     頭頂圓弧用兩個四分之一橢圓接起來(共用最高點與圓心高度);左邊(額頭)是比橢圓再飽滿一點的超橢圓(次方 P),
     從接頭處就陡陡地鼓起來,額頭才圓;左邊的寬度由「要經過 J 點」算出來 */
  const J = [113, 78.1];
  const HEAD = (() => {
    const h = { cx: 168, cy: 155, ry: 94.5, rxR: 86, P: 0.85 };
    const s = Math.pow((h.cy - J[1]) / h.ry, 1 / h.P), c = Math.sqrt(1 - s * s);
    h.tJ = Math.atan2(s, c) / RAD;
    h.rxL = (h.cx - J[0]) / Math.pow(c, h.P);
    return h;
  })();
  const BEAK_TOP = spline([[14, 111.7], [45, 99.9], [88.4, 85.6], J], 8);
  const DOME = (() => {
    const out = [], P = HEAD.P;
    for (let a = HEAD.tJ; a < 90; a += 6) {
      out.push([HEAD.cx - HEAD.rxL * Math.pow(Math.cos(a * RAD), P), HEAD.cy - HEAD.ry * Math.pow(Math.sin(a * RAD), P)]);
    }
    for (let a = 90; a > 0; a -= 7) out.push([HEAD.cx + HEAD.rxR * Math.cos(a * RAD), HEAD.cy - HEAD.ry * Math.sin(a * RAD)]);
    return out;
  })();
  const OUT_REST = DOME.concat([[254, 155], [253.5, 167], [251.5, 179], [247.5, 190.5], [241, 201.5], [232.5, 211], [222.5, 219.5],
    [210.5, 226.5], [197.5, 231.5], [183, 235], [169, 237], [152, 237.8], [137, 237], [124, 235], [110, 231], [101, 227],
    [95, 224.5], [90.5, 222.5]]);
  const OUT_HEAD = spline(OUT_REST, 8);
  const OUTLINE = BEAK_TOP.concat(OUT_HEAD.slice(1));
  /* 嘴的下緣:一條直線,從嘴尖(多畫出去一點,跟上緣交叉成尖尖的嘴)到嘴袋右上角,右端直接收掉 */
  const BEAK_LOW = spline([[10.5, 112.6], [60, 112.2], [110, 111.3], [170.5, 110.2]], 10);
  /* 嘴袋的碗:一筆 U 形,從左上往下繞過圓圓的碗底(最低點在嘴袋寬一半多一點的地方),再往右上鼓著爬回去,
     停在嘴的下緣稍下方、稍左邊(跟嘴線末端留一點空隙) */
  const BOWL_PTS = [[34.5, 132], [33.2, 141.9], [32.8, 151.7], [33.4, 161.4], [35.8, 171.2], [39.8, 180.9], [45.6, 190.7],
    [53.5, 199.5], [63.5, 206.5], [75, 211.6], [87, 214.6], [97, 215.3], [107.5, 213.8], [118, 209.8], [127.2, 203.4],
    [134.8, 195.8], [141, 187.6], [146.4, 178.8], [151, 169.6], [154.8, 160], [158.1, 150], [161, 140], [163.4, 130.5], [165.4, 122]]
    // 第四版:碗底往下放 7(越下面放越多,右下那條弧線跟著拉長),白肚子只露出一彎細月牙
    .map(([x, y]) => [x, y + 7 * Math.pow(Math.max(0, Math.min(1, (y - 150) / 65)), 1.5)]);
  const BOWL = spline(BOWL_PTS, 7);
  /* 頭頂到呆毛那一段外框(多描一次用) */
  const HEAD_TOP = OUT_HEAD.filter(([x, y]) => x > 112 && x < 206 && y < 80);
  /* 塗白的範圍:外框(含上嘴)接回碗的左半,左上缺口那裡往內收一點,白色不會跑出黃色塗鴉外面 */
  const WHITE_BODY = OUTLINE.concat(BOWL_PTS.slice(0, 11).reverse(), [[33.6, 126], [28, 113.6]]);
  /* 嘴袋(塗黃的範圍)。第三個數字是那一邊可以塗出去多少:上緣(嘴的下緣)和胸口那一邊幾乎不出去,左邊和下緣出去最多 */
  const POUCH = [[24, 112.5, 0.4], [100, 111.6, 0.4], [171.5, 110.4, 1.2]]
    // 碗底下面離肚子的外框很近,那一段少塗出去一點(不會蓋過外框、把白肚子塗黃)
    .concat(BOWL_PTS.slice().reverse().map(([x, y], i) => [x, y, i < 10 ? 0.7 : i < 12 ? 2 : i < 15 ? 3.5 : 9]))
    .concat([[33, 126, 9], [29, 116, 6]]);
  /* 翅膀:身體右側,從裡面往下彎、底下一個小波浪,尾端伸出身體外面分成三片圓頭的羽毛(中間那片最長,片和片之間凹得深) */
  /* 一片羽毛:從 A 繞一個圓頭到 B,往 deg 度的方向伸出 L 長(半個橢圓;片和片在接點處夾出深深的凹口) */
  const lobe = (A, B, L, deg) => {
    const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], a = Math.hypot(B[0] - A[0], B[1] - A[1]) / 2;
    const u = [(B[0] - A[0]) / (2 * a), (B[1] - A[1]) / (2 * a)], w = [Math.cos(deg * RAD), Math.sin(deg * RAD)];
    const out = [];
    for (let i = 0; i <= 6; i++) {
      const f = Math.PI * i / 6, c = -Math.cos(f) * a, s = Math.pow(Math.sin(f), 0.6) * L;   // 0.6 次方:頭圓一點,不會尖
      out.push([M[0] + c * u[0] + s * w[0], M[1] + c * u[1] + s * w[1]]);
    }
    return out;
  };
  const WING_N = [[261.6, 187.6], [263, 173.2]];   // 兩個凹口
  const WING = [[208, 157], [208.8, 168], [211.8, 179], [216.4, 188.4], [221.6, 193.8], [225.6, 191.2], [227.4, 182.6],
    [229.6, 189.6], [235, 194.6], [241, 196.6]]
    .concat(lobe([246, 197.6], WING_N[0], 12, 18))                 // 下面那片,往右稍微朝下
    .concat(lobe(WING_N[0], WING_N[1], 18, -10).slice(1))          // 中間那片最長,往右
    .concat(lobe(WING_N[1], [254.2, 164.6], 13.5, -50).slice(1));  // 上面那片往右上翹
  const WING_PIVOT = [208, 157];
  /* 呆毛:一個高高的圓頭圈(稍微往右倒)+ 右邊一個小圈,往後(右)倒。
     第四版:根部移到新的頭頂最高點稍微偏右;整撮縮成 0.9 倍、再往右後倒 15°(在 tuft() 裡換算) */
  const TUFT_BASE = [175, HEAD.cy - HEAD.ry * Math.sqrt(1 - Math.pow((175 - HEAD.cx) / HEAD.rxR, 2)) + 0.4];
  const TUFT_K = 0.9, TUFT_TILT = 15;
  const TUFT1 = [[0, 0], [0.6, -14], [2.6, -28], [6, -37.5], [11.5, -42.5], [17.5, -42.5], [20.6, -38], [20.8, -30],
    [18.4, -21], [13.4, -11], [7.6, -3.6], [2.6, -0.4]];
  const TUFT2 = [[1.4, -2.4], [8.8, -10], [16.8, -16.6], [24.6, -20.6], [30.6, -20.2], [31.8, -15.6], [27, -10], [18.4, -5],
    [12.2, -2.8]];
  /* 臉(第四版):眉毛外側高、內側壓低,兩條都斜約 22°,合起來是 V 字;內側那一端壓在眼睛的內上角。
     眼睛是上緣切平的半圓(瞇眼),平的一邊順著眉毛的斜度、直接頂在眉毛底下,不留縫。眼睛的位置沒動 */
  const BROWS = [[[128, 77], [146.5, 84.5]], [[162, 84.5], [182, 76.4]]];
  const EYES = [137, 170.5];                         // 眼睛中心 x
  /* 腳:[髖(跟著身體), 腳掌(貼地), 往外的腳趾, 往內的腳趾, 往下的腳趾] */
  const LEGS = [
    [[128.7, 235], [128.7, GROUND], [107, GROUND + 3.1], [141.1, GROUND], [120.6, GROUND + 8.7]],
    [[186, 235], [186, GROUND], [171.2, GROUND + 5], [207.1, GROUND + 1.9], [180.5, GROUND + 8.7]],
  ];
  /* 黃色蠟筆:一束一束彎彎的掃筆(見 pouchFill) */
  const SWEEP = {
    cell: 14.8,        // 束和束的間距(畫面上的 px,網格再亂挪);第三版放寬,白縫約一成五
    ang: [20, 60],     // 掃筆方向(往右上斜幾度)
    len: [0.15, 0.45], // 每筆多長(嘴袋寬的幾成)
    bow: [0.1, 0.15],  // 彎曲(筆長的幾成)
    over: 0.3,         // 多少比例是後來反方向彎著疊上去的
    width: 2.6,        // 筆粗
  };

  /* ---------- 變形 ---------- */
  /* 嘴袋晃動:越靠嘴袋左下(離嘴和胸口越遠)動得越多,嘴、臉、胸口和腳不動 */
  function pouchWarp(dx, dy) {
    if (!dx && !dy) return ID;
    return ([x, y]) => {
      const w = smooth((y - 112) / 100) * smooth((126 - x) / 46);
      return [x + dx * w, y + dy * w];
    };
  }
  /* 身體:以肚子底部為支點先伸縮(sq 上下、sx 左右)、再轉 tilt 度(正 = 順時針,嘴往上抬),最後搬 dx、dy。
     第五版才有 sx、tilt、dx、dy;待機沒有這些欄位,算法跟第四版一模一樣 */
  function bodyXF(f) {
    const sq = f.sq || 1, sx = f.sx || 1 + (sq - 1) * 0.7;   // 吸氣時往上鼓、也一起變胖(不會變得又高又窄)
    const th = (f.tilt || 0) * RAD, dx = f.dx || 0, dy = f.dy || 0;
    const pw = pouchWarp((f.pouch || [0, 0])[0], (f.pouch || [0, 0])[1]);
    const affine = th || dx || dy
      ? ([x, y]) => { const v = rot([(x - CX) * sx, (y - BOT) * sq], th); return [CX + v[0] + dx, BOT + v[1] + dy]; }
      : ([x, y]) => [CX + (x - CX) * sx, BOT + (y - BOT) * sq];
    return { body: (p) => affine(pw(p)), affine, th };
  }

  /* ---------- 各部位 ---------- */
  /* 嘴袋的黃色蠟筆:像拿蠟筆一束一束地掃。嘴袋上鋪一張亂挪過的網格,每個格點掃一束:
     一束是 2~3 筆來回(一筆畫完不提筆、折回來再掃一筆),方向在 20°~60° 之間亂跳,長短是嘴袋寬的 15%~45%,
     每筆都彎一點(筆長的 10%~15%);約三成的束最後才畫、彎的方向相反,疊在前面的上面。
     每一筆量一下嘴袋在這條線上的範圍,兩端依那一邊的規定塗出去,塗出去多少每筆都不一樣,左邊和下緣才會參差不齊;
     彎出去的中段如果跑出嘴袋就拉回直線,不會蓋過嘴的下緣或胸口那條線。
     只有範圍跟著身體變形,筆的方向和粗細在畫面上固定。畫得很小時少塗出去一半 */
  function pouchFill(ctx, r, size) {
    const spill = size && size < 120 ? 0.5 : 1;
    const poly = POUCH.map(([x, y, s]) => { const p = XF([x, y]); return [p[0], p[1], s * spill]; });
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    const g = SWEEP.cell, main = [], over = [];
    for (let y = y0 + g * 0.3, row = 0; y < y1; y += g * 0.8, row++) {
      const cols = [];
      for (let x = x0 + (row % 2) * g * 0.5; x < x1; x += g) cols.push(x);
      if (row % 2) cols.reverse();
      cols.forEach((x) => {
        const c = [x + (r() - 0.5) * g * 0.8, y + (r() - 0.5) * g * 0.6];
        if (!inPoly(poly, c)) return;
        const isOver = r() < SWEEP.over;
        const b = bundle(poly, r, c, x1 - x0, isOver);
        if (b) (isOver ? over : main).push(b);
      });
    }
    ctx.save();
    ctx.strokeStyle = YELLOW;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.lineWidth = SWEEP.width * (1 + (INKW - 1) * 0.4);
    main.concat(over).forEach((pts) => { curve(ctx, pts); ctx.stroke(); });
    ctx.restore();
  }
  /* 一束掃筆:回傳一串點(一筆畫完) */
  function bundle(poly, r, c, wid, isOver) {
    const S = SWEEP, pick = (a) => a[0] + (a[1] - a[0]) * r();
    // 方向在 20°~60° 之間,稍微偏平一點(第三版調得比較平均,整片看起來是斜斜往右上塗)
    const ang = -(S.ang[0] + (S.ang[1] - S.ang[0]) * Math.pow(r(), 1.05)) * RAD, d = [Math.cos(ang), Math.sin(ang)], n = [-d[1], d[0]];
    const L = wid * pick(S.len), bowK = pick(S.bow) * (isOver ? -1 : 1);
    const m = 2 + Math.floor(r() * 1.5), sp = 3.2 + r() * 1.4, sc = (r() - 0.5) * L * 0.3;
    const pts = [];
    for (let i = 0; i < m; i++) {
      const off = (i - (m - 1) / 2) * sp + (r() - 0.5) * 0.8;
      const o = [c[0] + n[0] * off, c[1] + n[1] * off];
      const ch = chord(poly, o, d);
      if (!ch) continue;
      const [lo, hi, sLo, sHi] = ch;
      const s0 = Math.max(lo - sLo * (0.2 + r()), sc - L / 2 + (r() - 0.5) * 5);
      const s1 = Math.min(hi + sHi * (0.2 + r()), sc + L / 2 + (r() - 0.5) * 5);
      if (s1 - s0 < 3) continue;
      const bow = bowK * (s1 - s0) * (0.7 + 0.6 * r());   // 同一束裡每筆彎得不一樣,中間才會夾出細細的白縫
      const one = [0, 0.25, 0.5, 0.75, 1].map((u, k) => {
        const s = s0 + (s1 - s0) * u, flat = [o[0] + d[0] * s, o[1] + d[1] * s];
        if (k === 0 || k === 4) return flat;
        const b = bow * Math.sin(Math.PI * u), q = [flat[0] + n[0] * b, flat[1] + n[1] * b];
        return inPoly(poly, q) ? q : flat;
      });
      if (i % 2) one.reverse();
      pts.push.apply(pts, one);
      pts.push(one[4]);                          // 折返的地方重複一點:轉角是尖的(像蠟筆折回來),不會繞成波浪
    }
    return pts.length >= 2 ? pts : null;
  }
  /* 從 o 沿著 d 方向的直線跟嘴袋外框的交點:最前、最後兩個交點的位置,和那兩點那一邊可以塗出去多少 */
  function chord(poly, o, d) {
    let lo = Infinity, hi = -Infinity, sLo = 0, sHi = 0;
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i], B = poly[(i + 1) % poly.length];
      const ex = B[0] - A[0], ey = B[1] - A[1], den = d[0] * ey - d[1] * ex;
      if (Math.abs(den) < 1e-9) continue;
      const ax = A[0] - o[0], ay = A[1] - o[1];
      const s = (ax * ey - ay * ex) / den, u = (ax * d[1] - ay * d[0]) / den;
      if (u < 0 || u > 1) continue;
      const sp = A[2] + (B[2] - A[2]) * u;
      if (s < lo) { lo = s; sLo = sp; }
      if (s > hi) { hi = s; sHi = sp; }
    }
    return lo < hi ? [lo, hi, sLo, sHi] : null;
  }
  function inPoly(poly, [x, y]) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  /* f.wingAt(第五版,看書用):翅膀整隻再挪多少 [x, y](扶著書的右邊,不蓋住書頁) */
  function wing(ctx, r, f) {
    const a = (f.wing || 0) * RAD, [mx, my] = f.wingAt || [0, 0];
    const pts = WING.map(([x, y]) => { const v = rot([x - WING_PIVOT[0], y - WING_PIVOT[1]], a); return [WING_PIVOT[0] + v[0] + mx, WING_PIVOT[1] + v[1] + my]; });
    ctx.fillStyle = WHITE;
    fillPoly(ctx, pts);                      // 先塗白:羽毛伸出身體的地方蓋住後面的外框
    ctx.strokeStyle = INK;
    line(ctx, spline(pts, 6), r, 3.5, 0.8, true);
  }

  /* 呆毛:tuft 是往右(往後)倒的角度,越靠尖端彎越多;th 是身體轉的角度(第五版,呆毛跟著頭一起轉)。
     回傳呆毛尖在畫面上的位置(不用亂數) */
  function tuft(ctx, r, f, th) {
    const base = XF(TUFT_BASE), bend = (f.tuft || 0) * RAD;
    const map = (pts) => pts.map(([x0, y0]) => {
      const x = x0 * TUFT_K, y = y0 * TUFT_K;
      const v = rot([x, y], TUFT_TILT * RAD + bend * (0.3 + 0.7 * Math.min(1, Math.hypot(x, y) / 29)) + (th || 0));
      return [base[0] + v[0], base[1] + v[1]];
    });
    const saved = XF;
    XF = ID;
    const a = spline(map(TUFT1), 7), b = spline(map(TUFT2), 6);   // 點取疏一點,圈圈才圓、不會抖出稜角
    ctx.fillStyle = WHITE;
    fillPoly(ctx, a); fillPoly(ctx, b);      // 圈圈裡面也是白的
    ctx.strokeStyle = INK;
    line(ctx, extend(a, 3 + r() * 2, 0), r, 3.5, 0.9, true);   // 呆毛根部多畫進頭裡一點
    line(ctx, b, r, 3.3, 0.8, true);
    XF = saved;
    return map([[14.5, -42.5]])[0];
  }

  /* 臉:open 半圓瞇眼(上緣切平、頂著眉毛)、blink 閉眼(眉毛下一道彎線)。
     畫得很小時眼睛跟著線條放大一點;非常小時眼睛再放大、眉毛縮短成一筆短粗線(剪掉外側一段),眉眼合成一塊,臭臉才看得出來 */
  const CUT = 0.3;                                   // 眼睛:圓心在切平的上緣下面 0.3 個半徑(寬約 2 個半徑、高約 1.3 個半徑)
  function face(ctx, r, kind) {
    if (kind !== 'open' && kind !== 'blink') { moodFace(ctx, r, kind); return; }   // 第五版的表情;待機不會走到
    const k = TINY ? 1.65 : 1 + (INKW - 1) * 0.5;      // 眼睛放大倍數
    const bk = 1 + (INKW - 1) * (TINY ? 0.35 : 0.6), R = 6.6 * k, bw = 6 * PEN_W * bk;
    ctx.fillStyle = INK;
    EYES.forEach((ex, i) => {
      const [[x0, y0], [x1, y1]] = BROWS[i];
      const slope = (y1 - y0) / (x1 - x0), al = Math.atan(slope);
      const u = [Math.cos(al), Math.sin(al)], v = [-Math.sin(al), Math.cos(al)];   // u 順著眉毛、v 垂直往下
      const mid = y0 + slope * (ex - x0);                    // 眉毛中線在眼睛中心這一點的高度
      const lid = mid + (bw / 2) / Math.cos(al) - 0.9;        // 眉毛下緣(眼睛平的那一邊稍微塞進眉毛底下,不留縫)
      if (kind === 'blink') {
        const b = lid + 1.5;
        line(ctx, [[ex - 6 * k, b - 6 * k * slope], [ex, b + 3.5 * k], [ex + 6 * k, b + 6 * k * slope]], r, 3.2, 0.4);
        return;
      }
      const c = [ex + v[0] * CUT * R + (r() - 0.5) * 0.4, lid + v[1] * CUT * R + (r() - 0.5) * 0.3], dot = [];
      const a0 = -Math.asin(CUT) / RAD;
      for (let a = a0; a <= 180 - a0 + 0.01; a += (180 - 2 * a0) / 14) {
        const rr = R * (0.97 + r() * 0.06), cs = Math.cos(a * RAD) * rr, sn = Math.sin(a * RAD) * rr;
        dot.push([c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn]);
      }
      fillPoly(ctx, dot);                                     // 回到起點那一段就是切平的上緣
    });
    BROWS.forEach(([a, b], i) => {
      // 眉毛:內側粗、眉尾細一點;非常小時剪掉外側 30%
      const outer = i ? b : a, inner = i ? a : b, t = TINY ? 0.3 : 0;
      const o = [outer[0] + (inner[0] - outer[0]) * t, outer[1] + (inner[1] - outer[1]) * t];
      taper(ctx, r, inner, o, bw, bw * (TINY ? 0.85 : 0.72));
    });
  }
  /* 第五版的表情。眉毛的位置用待機的眉毛當底,內側、外側各往上抬多少(負的往下壓):
     [左眉 [內, 外], 右眉 [內, 外]]。內側抬高 = 眉毛鬆開;內側壓低、外側抬高 = 皺眉 */
  const MOODS = {
    happy: [[7, 3], [7, 3]],          // 開心:眉毛鬆開、只剩一點點 V(還是那張嘴硬的臉)
    squeeze: [[-1, 3], [-1, 3]],      // > <:眉頭皺緊
    meh: [[4, -2], [4, -2]],          // 嘆氣:眉毛拉平
    closed: [[6, 1], [6, 1]],         // 睡覺:眉毛放鬆
    sideeye: [[0, -3], [7, 10]],      // 斜眼瞄你:左眉壓平、右眉挑高
    read: [[6, 2], [6, 2]],           // 看書:眉毛放平(專心,不是在生氣)
    readfrown: [[-2, 6], [-2, 6]],    // 看到不懂的地方:眉頭皺起來
  };
  const EYE_Y = 87;                   // 眼睛中心的高度(待機的半圓眼差不多在這裡)
  /* kind:happy 開心的弧線 ∩、squeeze > <、meh 眼皮垂成兩條橫線、closed 睡著(往下彎的弧 ∪)、
     sideeye 半睜眼、眼珠擠到右邊、'read:3' 往下看(數字 = 眼珠往右挪多少,負的往左)、'readfrown:3' 同上加皺眉 */
  function moodFace(ctx, r, kind) {
    const [name, arg] = kind.split(':'), sh = +arg || 0;
    const k = TINY ? 1.65 : 1 + (INKW - 1) * 0.5;
    const bk = 1 + (INKW - 1) * (TINY ? 0.35 : 0.6), bw = 6 * PEN_W * bk;
    const reading = name === 'read' || name === 'readfrown';
    const E = EYE_Y + (name === 'squeeze' ? 1 : 0);
    ctx.fillStyle = INK;
    EYES.forEach((ex, i) => {
      const s = i ? -1 : 1;                                   // 往臉中間的方向
      const P = (pts) => pts.map(([u, v]) => [ex + u * k, E + v * k]);
      if (name === 'happy') line(ctx, P([[-6.5, 3], [-2.5, -3], [2.5, -3], [6.5, 3]]), r, 3.6, 0.4);
      else if (name === 'squeeze') line(ctx, P([[-s * 5, -5], [s * 4.5, 0], [-s * 5, 5]]), r, 3.6, 0.4);
      else if (name === 'meh') line(ctx, P([[-7, 0], [0, 1.5], [7, 0]]), r, 3.8, 0.4);
      else if (name === 'closed') line(ctx, P([[-6.5, -1.5], [-2.5, 3], [2.5, 3], [6.5, -1.5]]), r, 3.6, 0.4);
      else if (name === 'sideeye' || reading) {
        const cx = name === 'sideeye' ? 3 : sh, lid = name === 'sideeye' ? -2 : 0;
        const half = [];
        for (let a = 0; a <= 180; a += 20) half.push([cx + Math.cos(a * RAD) * 5.4, lid + Math.sin(a * RAD) * 5.8]);
        fillPoly(ctx, P(half));
        line(ctx, P([[-7 + cx * 0.3, lid], [cx * 0.5, lid + 0.5], [7 + cx * 0.3, lid - 0.3]]), r, 3.6, 0.4);   // 平的眼皮
      }
    });
    // 畫得非常小時,開心和睡著不畫眉毛(眉毛會跟弧線黏成一團,看起來像 xx)
    if (TINY && (name === 'happy' || name === 'closed')) return;
    (MOODS[name] || MOODS.read).forEach(([dIn, dOut], i) => {
      const [a, b] = BROWS[i], inner0 = i ? a : b, outer0 = i ? b : a;
      const inner = [inner0[0], inner0[1] - dIn], outer = [outer0[0], outer0[1] - dOut], t = TINY ? 0.3 : 0;
      const o = [outer[0] + (inner[0] - outer[0]) * t, outer[1] + (inner[1] - outer[1]) * t];
      taper(ctx, r, inner, o, bw, bw * (TINY ? 0.85 : 0.72));
    });
  }
  /* 一筆由粗變細的短線(眉毛用):從 a(粗 w0)畫到 b(細 w1),分幾小段換筆粗,圓頭接起來看不出接縫 */
  function taper(ctx, r, a, b, w0, w1) {
    const j = 0.4 * JIT, n = 5;
    const p = [0, 0.5, 1].map((u) => [a[0] + (b[0] - a[0]) * u + (r() - 0.5) * 2 * j, a[1] + (b[1] - a[1]) * u + (r() - 0.5) * 2 * j]);
    const at = (u) => (u < 0.5 ? [p[0][0] + (p[1][0] - p[0][0]) * u * 2, p[0][1] + (p[1][1] - p[0][1]) * u * 2]
      : [p[1][0] + (p[2][0] - p[1][0]) * (u - 0.5) * 2, p[1][1] + (p[2][1] - p[1][1]) * (u - 0.5) * 2]);
    for (let s = 0; s < n; s++) {
      const q0 = XF(at(s / n)), q1 = XF(at((s + 1) / n));
      ctx.lineWidth = w0 + (w1 - w0) * (s + 0.5) / n;
      ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.stroke();
    }
  }

  /* 腳:髖跟著身體,腳掌貼地,三根腳趾(往外、往內、往下)。非常小時只畫兩條加粗的腿。
     第五版:mode 'jump' 騰空(腳跟著身體懸著、腳趾往下垂);'sit' 坐著(腿藏在肚子下面,只露出腳趾) */
  function legs(ctx, r, affine, mode, dx) {
    // dx:整隻往右挪時腳掌也跟著挪(待機沒有 dx,點跟第四版一樣)
    const mv = (p) => (dx ? [p[0] + dx, p[1]] : p);
    LEGS.map((g) => g.map((p, i) => (i ? mv(p) : p))).forEach(([hip, foot, out, inn, down]) => {
      if (mode === 'jump') {
        const h = affine(hip), F = [h[0] + 1, h[1] + 17];
        if (TINY) { line(ctx, [h, [F[0], F[1] + 3]], r, 4.6, 0.5); return; }
        line(ctx, [h, F], r, 3.6, 0.8);
        line(ctx, [[F[0] - 13, F[1] + 6], F, [F[0] + 9, F[1] + 5]], r, 3.4, 0.6);
        line(ctx, [F, [F[0] - 3, F[1] + 9]], r, 3, 0.5);
        return;
      }
      if (mode === 'sit') {
        const F = [affine(hip)[0], foot[1]];
        const T = (p) => [F[0] + p[0] - foot[0], F[1] + p[1] - foot[1]];
        if (TINY) { line(ctx, [T(out), F, T(inn)], r, 4.6, 0.5); return; }
        line(ctx, [[F[0] + 1, F[1] - 12], F], r, 3.6, 0.6);   // 上端藏在肚子後面(身體塗白時蓋掉)
        line(ctx, [T(out), F, T(inn)], r, 3.4, 0.8);
        return;
      }
      if (TINY) { line(ctx, [affine(hip), [foot[0], foot[1] + 3]], r, 4.6, 0.5); return; }
      line(ctx, extend([affine(hip), foot], 0, 2 + r() * 2), r, 3.6, 0.8);
      line(ctx, [out, foot, inn], r, 3.4, 0.8);
      line(ctx, [foot, down], r, 3, 0.6);
    });
  }

  /* ---------- 第五版:看書 ----------
     一本攤開的書擋在身體前面、嘴袋的右下方(書頂離眼睛很遠,不擋臉)。書頁朝外攤開:兩頁白紙、中間書背凹下去、
     每頁兩行字,底下露出一條封面,用黃色斜線來回塗(跟嘴袋同一種蠟筆,全身沒有藍色)。
     書跟著身體走(點的位置經過身體的轉換),先塗白蓋住後面的身體、再塗黃、書頁再塗一次白(黃色塗出去的蓋掉)、最後描墨線。
     page 1 = 右頁外緣翹起來往書背捲;page 2 = 那一頁越過書背往左邊落下(從右往左翻) */
  /* c 書的中心、w 半頁寬(書的座標)、s 放大倍數(書的座標 → 邏輯座標)、tilt 書斜幾度(左邊稍微抬高,像拿起來看) */
  const BOOK = { c: [164, 194], w: 52, s: 1.25, tilt: -5 };
  /* 把折線每段切成約 seg 長的小段;line() 會讓每個點各抖一點,書的線才跟身體外框一樣不平順 */
  function wobble(pts, seg) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / seg));
      for (let j = 1; j <= n; j++) out.push([x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n]);
    }
    return out;
  }
  const atBook = (pts) => pts.map(([u, v]) => {
    const q = rot([u * BOOK.s, v * BOOK.s], BOOK.tilt * RAD);
    return [BOOK.c[0] + q[0], BOOK.c[1] + q[1]];
  });
  function book(ctx, r, f) {
    const w = BOOK.w;
    const ink = (pts, wd) => line(ctx, wobble(atBook(pts), 9), r, wd, 0.9);
    const M = (pts) => pts.map(([u, v]) => [-u, v]).reverse();          // 左右鏡射
    const pageL = [[0, -11], [-10, -17], [-26, -19], [-w + 12, -18], [-w + 1, -14], [-w + 1, 9], [-w + 14, 11], [-26, 12], [-10, 14], [0, 18]];
    const cover = [[-w - 3, -12], [-w - 3, 20], [-26, 25], [0, 31], [26, 25], [w + 3, 20], [w + 3, -12]];
    ctx.fillStyle = WHITE;
    fillPoly(ctx, atBook(cover.concat([[w - 10, -17], [0, -11], [-w + 10, -17]])));
    // 封面:書頁底下露出的那一條,斜斜地來回塗兩趟(第二趟錯開半格、方向反過來),可以塗出去一點
    ctx.save();
    ctx.strokeStyle = YELLOW;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.lineWidth = SWEEP.width * (1 + (INKW - 1) * 0.4);
    [[1, 0], [-1, 1.7]].forEach(([dir, off]) => {
      const pts = [];
      for (let u = -dir * (w + 3) + off, i = 0; dir > 0 ? u <= w + 3 : u >= -w - 3; u += dir * (3.4 + r() * 1.2), i++) {
        const a = Math.min(1, Math.abs(u) / w), top = 6 + 9 * (1 - a), bot = 22 + 11 * (1 - a);
        pts.push(i % 2 ? [u + dir * 2.5, top + r() * 2] : [u - dir * 2.5, bot - r() * 2]);
      }
      curve(ctx, atBook(pts).map(XF));
      ctx.stroke();
    });
    ctx.restore();
    ctx.fillStyle = WHITE;
    fillPoly(ctx, atBook(pageL.concat(M(pageL))));
    ctx.strokeStyle = INK;
    ink(cover.slice(0, 6).concat([[w + 3, -10]]), 3.4);                               // 封面外緣(上面被書頁蓋住)
    ink(pageL.slice(0, 6).reverse(), 3.4);                                             // 左頁的上緣和外側
    ink(M(pageL).slice(4), 3.4);                                                       // 右頁
    line(ctx, atBook([[0, -11], [1, 4], [0, 18]]), r, 2.8, 0.8);                       // 書背
    ink([[-w + 1, 9], [-26, 12], [-10, 14], [0, 18], [10, 14], [26, 12], [w - 1, 9]], 2.6);   // 書頁底
    [[-1, -7], [1, -7], [-1, 1], [1, 1]].forEach(([s, v]) => {                         // 每頁兩行字
      if (f.page === 1 && s > 0 && v < 0) return;                                      // 右頁翹起來時,上面那行被翹起的紙蓋住
      const a = s * 9, b = s * (w - 9), d = v < -3 ? -1 : 0;
      line(ctx, atBook([[a, v + d], [(a * 2 + b) / 3, v - 1], [(a + b * 2) / 3, v], [b, v - 1]]), r, 1.9, 0.6);
    });
    if (f.page) {
      const pg = f.page === 1
        ? [[0, -11], [10, -15], [22, -20], [32, -25], [39, -26], [39, -14], [36, -2], [29, 5], [14, 11], [1, 16]]
        : [[0, -11], [-8, -14], [-20, -19], [-32, -23], [-42, -23], [-44, -11], [-43, 3], [-31, 8], [-14, 12], [-1, 16]];
      ctx.fillStyle = WHITE;
      fillPoly(ctx, atBook(pg));
      ink(pg, 2.8);
      const s = f.page === 1 ? 1 : -1;          // 翹起來那張紙上的一行字,看得出是一頁書
      line(ctx, atBook([[s * 8, -6], [s * 18, -9], [s * 28, -12]]), r, 1.9, 0.6);
    }
  }
  /* 看書時左邊的翅膀:右邊那隻翅膀左右翻過來、縮成 0.62 倍,從嘴袋前面伸過來,三瓣羽毛壓住書的左下角
     (右邊用真的翅膀轉下來扶),兩隻翅膀一看就是同一種。先塗白蓋住後面的線,再描墨線 */
  const LWING = { at: [90, 178], k: 0.62, deg: -98 };
  function bookWing(ctx, r) {
    const th = LWING.deg * RAD;
    const pts = WING.map(([x, y]) => {
      const v = rot([-(x - WING_PIVOT[0]) * LWING.k, (y - WING_PIVOT[1]) * LWING.k], th);
      return [LWING.at[0] + v[0], LWING.at[1] + v[1]];
    });
    ctx.fillStyle = WHITE;
    fillPoly(ctx, pts);
    ctx.strokeStyle = INK;
    line(ctx, spline(pts, 5), r, 3.3, 0.7, true);
  }

  /* ---------- 第五版:特效(都在畫面座標畫,位置跟著身體) ---------- */
  function fx(ctx, r, list, k) {
    ctx.save();
    ctx.strokeStyle = INK; ctx.fillStyle = INK;
    ctx.lineCap = ctx.lineJoin = 'round';
    const small = k.size && k.size < 96;
    list.forEach((e) => {
      const [name, arg] = e.split(':'), n = +arg || 0;
      if (name === 'tangle') {
        // 額頭左上方(嘴的上面)一團打結的線:n = 1 剛冒出來、2、3 最大、4 鬆開一半、5 只剩一小段線頭。
        // 3~4 個歪歪的大圈,每圈換一個圈心、一筆繞下去互相交叉,最後拉出一條線頭(跟小雞的線團同一種畫法)
        // 圈心在嘴和頭的接頭(J)左上方,離嘴線夠遠不壓到嘴;頭抬高時往下讓,不超出畫布上緣
        // 畫得小(96 以下)時線團放大 1.2 倍,52 px 才看得出是一團纏起來的線
        const R = ([0, 26, 30, 33, 22, 0][n] || 0) * (small ? 1.2 : 1), J0 = k.body(J), t = [J0[0] - 12, Math.max(J0[1] - 50, 8 + R * 0.95)];
        if (n === 5) {
          const x = t[0] - 4, y = t[1] + 6;
          line(ctx, [[x - 10, y + 2], [x - 4, y - 5], [x + 2, y + 1], [x + 8, y - 6], [x + 14, y - 1], [x + 19, y - 7]], r, 2.8, 0.5);
        } else if (R) {
          const loops = (n === 3 ? 4 : n === 4 ? 2 : 3) - (small && n !== 4 ? 1 : 0);   // 畫得小時少一圈,不糊成一團黑
          const pts = [];
          let a = r() * Math.PI * 2, dir = 1;
          for (let i = 0; i < loops; i++) {
            const ox = (r() - 0.5) * R * 0.95, oy = (r() - 0.5) * R * 0.6, rad = R * (0.45 + 0.35 * r()), tl = (r() - 0.5) * 2;
            const steps = 7 + Math.floor(r() * 5);
            if (r() < 0.45) dir = -dir;
            for (let s = 0; s < steps; s++) {
              a += dir * 0.75;
              const v = rot([Math.cos(a) * rad * 1.2, Math.sin(a) * rad * 0.72], tl);
              pts.push([t[0] + ox + v[0], t[1] + oy + v[1]]);
            }
          }
          const q = pts[pts.length - 1], tail = n === 4 ? 1.8 : 1;   // 線頭:鬆開一半時拉得比較長
          pts.push([q[0] - R * 0.5 * tail, q[1] + R * 0.25], [q[0] - R * 0.95 * tail, q[1] - R * 0.1], [q[0] - R * 1.3 * tail, q[1] + R * 0.3]);
          line(ctx, pts, r, 2.8, 0.5);
        }
      } else if (name === 'drop') {
        // 一大滴汗貼在頭的右上方外面,n 越大沿著頭的輪廓往下滑
        const a = (52 - n * 9) * RAD;
        const p = k.body([HEAD.cx + (HEAD.rxR + 14) * Math.cos(a), HEAD.cy - (HEAD.ry + 14) * Math.sin(a)]);
        const [x, y] = p, g = small ? 1.3 : 1;     // 畫得小時汗滴放大 1.3 倍
        line(ctx, [[0, -15], [-8, 2], [-5, 8.5], [0, 10], [5, 8.5], [8, 2], [0, -15]].map(([u, v]) => [x + u * g, y + v * g]), r, 3.2, 0.4);
        if (!small) line(ctx, [[x + 12, y - 12], [x + 18, y - 19]], r, 2.6, 0.4);
      } else if (name === 'sigh') {
        // 嘆出來的一小團氣:從上嘴根部冒出來,往左上飄、越飄越大
        const b = k.body([86, 88]), x = b[0] - 8 - n * 9, y = b[1] - 18 - n * 13, s = 7 + n * 3.5;
        const ring = [];
        for (let i = 0; i <= 12; i++) ring.push([x + Math.cos(i / 12 * Math.PI * 2) * s, y + Math.sin(i / 12 * Math.PI * 2) * s * 0.8]);
        line(ctx, ring, r, 2.8, 0.5);
        line(ctx, [[x + s + 3, y + 3], [x + s + 12, y + 8]], r, 2.6, 0.4);
      } else if (name === 'z') {
        // 打呼的 z:頭的右上方冒出來,往右上飄;n >= 2 時多一個小的
        const b = k.body([236, 58]);
        const z = (x, y, s) => line(ctx, [[x, y], [x + s, y], [x, y + s], [x + s, y + s]], r, 3.4, 0.5);
        z(b[0] + n * 3, b[1] - n * 4, 16);
        if (n >= 2) z(b[0] + 26 + n * 2, b[1] - 26 - n * 3, 11);
      } else if (name === 'pop') {
        // 得意的短線:頭的右上方三條往外放射的短線(「哼」)
        [[[222, 46], [231, 30]], [[244, 62], [258, 51]], [[256, 88], [272, 84]]].forEach(([a, b], i) => {
          if (small && i === 1) return;
          line(ctx, [k.body(a), k.body(b)], r, 3, 0.5);
        });
      } else if (name === 'dust') {
        // 落地的煙:兩隻腳的外側
        [[96, -1], [220, 1]].forEach(([x0, s]) => {
          const x = x0 + (k.dx || 0);
          line(ctx, [[x, GROUND - 2], [x + s * 10, GROUND - 11], [x + s * 19, GROUND - 6], [x + s * 23, GROUND - 1]], r, 2.6, 1);
          if (!small) line(ctx, [[x + s * 4, GROUND - 16], [x + s * 10, GROUND - 22]], r, 2.2, 0.6);
        });
      } else if (name === 'shadow') {
        // 騰空時地上留一小段影子線,看得出腳離地
        const c = k.body([157, 242])[0];
        line(ctx, [[c - 42, GROUND + 1], [c + 40, GROUND + 1]], r, 2.4, 0.5);
      } else if (name === 'motion') {
        // 往上衝的速度線:畫在身體兩側(嘴袋左下、翅膀下面),不會看起來像多長了腳
        [[52, 214, 0], [40, 222, 0], [262, 214, 1], [274, 206, 1]].forEach(([x, y], i) => {
          if (small && i % 2) return;
          const p = k.body([x, y]);
          line(ctx, [[p[0], p[1] + 6], [p[0], p[1] + 28]], r, 2.4, 0.6);
        });
      }
    });
    ctx.restore();
  }

  /* ---------- 動作 ----------
     每格:sq 身體上下伸縮(以肚子底部為支點,>1 吸氣鼓起來)、pouch 嘴袋最下面那一點的位移 [x, y]、
     tuft 呆毛往後倒的角度、wing 翅膀轉的角度、eyes、hold 這格停幾拍。 */
  /* 待機:吐完氣站著(停 3 拍)→ 吸氣,嘴袋往下墜 → 吸飽(停 2 拍)→ 眨一下眼,嘴袋開始往前甩 →
     吐氣,嘴袋往上甩過頭 → 落回來(停 2 拍),嘴袋往後晃 → 稍微沉一點 → 回到開頭。呆毛和翅膀比身體慢一拍 */
  /* 第三版:起伏和嘴袋的晃動都收小(約剩四成),輪廓大小在各格之間幾乎不變,看起來是線在抖、不是身體在變形 */
  const idle = [
    [1.0, 0, 0, 0, 'open', 3],
    [1.006, 0.6, 2, -4, 'open', 1],
    [1.012, 1.6, 3.6, -7, 'open', 2],
    [1.011, 2.6, 1.4, -5, 'blink', 1],
    [1.005, 1.4, -2.2, 2.5, 'open', 1],
    [1.0, -1.8, -2.8, 6.5, 'open', 2],
    [0.997, -1.2, 1, 4, 'open', 1],
    [1.0, -0.4, 0.6, 1, 'open', 1],
  ].map(([sq, pdx, pdy, tf, eyes, hold]) => ({ sq, pouch: [pdx, pdy], tuft: tf, wing: -tf * 0.25, eyes, hold }));

  /* ---------- 第五版 ----------
     新欄位:sx 左右伸縮(沒給時跟待機一樣跟著 sq 算)、tilt 轉幾度(正 = 嘴往上抬)、dx、dy 整隻搬多少、
     feet 'jump' 騰空 / 'sit' 坐著、fx 特效、book 捧著書、page 翻頁。嘴往下低時(tilt 負的)要給 dx,嘴尖才不會超出畫布 */
  /* 開心(「哼,還不錯嘛」):抬下巴站好 → 蹲(預備,嘴袋往上頂)→ 拉長往上衝(嘴袋往下墜)→ 騰空、翅膀張開 →
     頂點(停 2 拍)、得意的短線 → 落下(嘴袋往上甩)→ 落地壓扁、眼睛擠一下、嘴袋重重甩下去、冒煙 → 回彈 →
     抬下巴得意(停 2 拍)→ 放鬆接回開頭。呆毛比身體慢一拍 */
  const happy = [
    { eyes: 'happy', tilt: 2, wing: -4, tuft: -4, pouch: [0, 1] },
    { sq: 0.86, sx: 1.03, tilt: -1, dx: 3, eyes: 'happy', wing: 8, tuft: 10, pouch: [1, -3], hold: 2 },
    { sq: 1.1, sx: 0.95, dy: -3, tilt: 5, eyes: 'happy', wing: -30, tuft: 16, pouch: [1, 6] },
    { sq: 1.05, sx: 0.96, dy: -20, tilt: 8, eyes: 'happy', wing: -50, feet: 'jump', tuft: 24, pouch: [-1, 8], fx: ['motion', 'shadow'] },
    { sq: 0.98, dy: -28, tilt: 9, eyes: 'happy', wing: -42, feet: 'jump', tuft: 4, pouch: [0, 1], fx: ['pop', 'shadow'], hold: 2 },
    { sq: 1.05, sx: 0.97, dy: -14, tilt: 6, eyes: 'happy', wing: -56, feet: 'jump', tuft: -16, pouch: [1, -6], fx: ['shadow'] },
    { sq: 0.8, sx: 1.04, tilt: 1, dx: 1, eyes: 'squeeze', wing: 14, tuft: -22, pouch: [-3, 10], fx: ['dust'] },
    { sq: 1.06, sx: 0.97, tilt: 6, eyes: 'happy', wing: -20, tuft: 12, pouch: [2, -5] },
    { sq: 0.99, tilt: 7, eyes: 'happy', wing: -28, tuft: -6, pouch: [-1, 3], fx: ['pop'], hold: 2 },
    { tilt: 4, eyes: 'happy', wing: -12, tuft: 2, pouch: [0, 0.5] },
  ];
  /* 尷尬懊惱(成績不理想):不哭也不裝可憐,是「嘖」。站好 → 縮一下、頭低下去 → 縮到最底,> <、嘴袋垂下來,
     額頭上方冒出打結的線團、頭的右邊一滴汗(停 2 拍)→ 回彈 → 吸一口氣抬頭(線團鬆開)→ 嘆氣扁下去、嘴邊一團氣(停 2 拍)→
     鬆下來、呆毛往後塌 → 斜眼瞄你一下(停 3 拍)→ 眨眼接回開頭 */
  const oops = [
    { eyes: 'open', tuft: -2 },
    { sq: 0.9, sx: 1.02, tilt: -2, dx: 5, eyes: 'squeeze', wing: 8, tuft: 10, pouch: [0, 4], fx: ['tangle:1'] },
    { sq: 0.84, sx: 1.03, tilt: -4, dx: 8, eyes: 'squeeze', wing: 12, tuft: -14, pouch: [1, 8], fx: ['tangle:3', 'drop:0'], hold: 2 },
    { sq: 0.9, sx: 1.02, tilt: -1, dx: 5, eyes: 'squeeze', wing: 6, tuft: -18, pouch: [0, 6], fx: ['tangle:2', 'drop:1'] },
    { sq: 1.06, sx: 0.98, tilt: 3, eyes: 'meh', wing: -10, tuft: 8, pouch: [0, 1], fx: ['tangle:4', 'drop:2'] },
    { sq: 0.88, sx: 1.03, tilt: -3, dx: 7, eyes: 'meh', wing: 10, tuft: 16, pouch: [1, 9], fx: ['tangle:5', 'sigh:1'], hold: 2 },
    { sq: 0.86, sx: 1.03, tilt: -3, dx: 7, eyes: 'meh', wing: 14, tuft: 26, pouch: [1, 10], fx: ['sigh:2'] },
    { tilt: -1, dx: 2, eyes: 'sideeye', wing: 4, tuft: -8, pouch: [0, 5], hold: 3 },
    { sq: 1.02, eyes: 'blink', tuft: 4, pouch: [0, 2] },
  ];
  /* 看書:翅膀轉下來扶著書(wing 52°),動作小而安靜。眼睛往下看、在書上左右掃(一行兩拍,頭跟著偏一點)→
     皺眉 → 翻一頁(右頁翹起來時右邊的翅膀往上推一點,接著落到左邊)→ 點一下頭 → 抬回來 */
  const readFrame = (o) => Object.assign({ book: 1, wing: 60, wingAt: [14, 2] }, o);
  const read = [
    { eyes: 'read:-3', tilt: -1, dx: 2, tuft: 4, hold: 2 },
    { eyes: 'read:3', tilt: 1, tuft: -6, hold: 2 },
    { eyes: 'readfrown:-3', sq: 0.98, tilt: -1, dx: 2, tuft: 6, hold: 2 },
    { eyes: 'readfrown:3', sq: 0.98, tilt: 1, tuft: -4 },
    { eyes: 'read:3', page: 1, wing: 52, wingAt: [14, -4], tilt: 1, tuft: -6 },
    { eyes: 'read:-3', page: 2, tilt: -1, dx: 2, tuft: 6 },
    { eyes: 'read:0', sq: 0.97, tilt: -2, dx: 3, tuft: 10, pouch: [0, 1.5] },
    { eyes: 'read:0', sq: 1.01, tuft: -4, hold: 2 },
  ].map(readFrame);
  /* 睡覺:坐在地上,嘴微微往下垂,翅膀垂著,呆毛往後倒。吐完氣(停 3 拍)→ 慢慢吸氣,嘴袋跟著往左下鼓 →
     吸飽(停 3 拍)→ 吐氣 → 回到開頭。z 一格一格往右上飄 */
  const sleep = [
    { sq: 0.97, pouch: [1, -1], tuft: 30, fx: ['z:0'], hold: 3 },
    { sq: 0.99, pouch: [-0.5, 1.5], tuft: 34, fx: ['z:1'] },
    { sq: 1.02, pouch: [-2, 3.5], tuft: 38, fx: ['z:2'] },
    { sq: 1.04, pouch: [-3, 5], tuft: 36, fx: ['z:3'], hold: 3 },
    { sq: 1.02, pouch: [-2, 3], tuft: 30, fx: ['z:4'] },
    { sq: 0.99, pouch: [0, 0.5], tuft: 26, fx: ['z:5'], hold: 2 },
    { sq: 0.97, pouch: [1, -1.5], tuft: 28, fx: ['z:6'] },
  ].map((f) => Object.assign({ eyes: 'closed', feet: 'sit', dy: 18, tilt: -3, dx: 6, wing: 10 }, f));

  /* 第五版的姿勢接在 idle 後面(待機的種子用姿勢的順序算,不變) */
  const POSES = { idle, happy, oops, read, sleep };
  /* 不想看動畫(減少動態)時每個姿勢顯示的那一格:
     happy 第 8 格(站著抬下巴、開心的眼睛、得意的短線)、oops 第 2 格(縮到最底、> <、線團和汗都在)、
     read 第 0 格(捧著書往下看)、sleep 第 3 格(吸飽氣、兩個 z) */
  const CALM = { idle: 0, happy: 8, oops: 2, read: 0, sleep: 3 };
  /* 各動作在基準 fps = 8 時的播放速度;實際 = 呼叫者給的 fps × 這裡 / 8 */
  const POSE_FPS = { idle: 5, happy: 8, oops: 4, read: 4, sleep: 3 };
  const fpsFor = (pose, base) => base * (POSE_FPS[pose] || 8) / 8;

  /* 畫一格。seed 決定這一格的抖動 */
  function draw(ctx, f, seed, size) {
    const r = rng(seed);
    INKW = inkFor(size);
    TINY = !!size && size <= 64;
    const { body, affine, th } = bodyXF(f);
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = INK; ctx.fillStyle = INK;

    XF = ID;
    legs(ctx, r, affine, f.feet, f.dx);      // 先畫腳,身體塗白時蓋住腳的上端

    XF = body;
    ctx.fillStyle = WHITE;
    fillPoly(ctx, WHITE_BODY);               // 身體、頭、上嘴、嘴袋整片先塗白
    pouchFill(ctx, r, size);
    ctx.strokeStyle = INK;
    // 外框兩筆:上嘴的上緣在眉毛前面停(多畫出去一點,伸進頭裡),頭頂的圓弧從接頭處另起一筆
    line(ctx, extend(BEAK_TOP, 0, 2.5 + r() * 2), r, 4.4, 1.0, true);
    line(ctx, OUT_HEAD, r, 4.4, 1.0, true);
    // 頭頂到呆毛那一段多描一次(偏上一點、頭尾不一定對齊)
    // 第二筆兩頭貼回原來的線、中段離開約 2.5~3.5(像描第二次時手偏了一下;第三版收近,不像另一條頭的輪廓)
    const nH = HEAD_TOP.length, k0 = Math.floor(r() * nH * 0.3), k1 = nH - Math.floor(r() * nH * 0.2);
    const dx = 0.6 + r() * 1, dy = -2.4 - r() * 1.1, run = HEAD_TOP.slice(k0, k1);
    if (!TINY) line(ctx, run.map(([x, y], i) => { const w = 0.3 + 0.7 * Math.sin(Math.PI * i / Math.max(1, run.length - 1)); return [x + dx * w, y + dy * w]; }), r, 2.8, 0.9, true);
    // 嘴的下緣右端只多畫出去一點點就收掉(不往上勾);嘴袋的碗一筆畫完,右上端停在嘴線下面
    line(ctx, extend(BEAK_LOW, 0, 1 + r() * 2), r, 3.8, 0.7, true);
    line(ctx, BOWL, r, 4.1, 0.9, true);
    if (f.book) book(ctx, r, f);             // 第五版才有;待機不會走到這裡,亂數用量不變
    wing(ctx, r, f);
    if (f.book) bookWing(ctx, r);
    const tip = tuft(ctx, r, f, th);
    face(ctx, r, f.eyes || 'open');
    XF = ID;
    if (f.fx) fx(ctx, r, f.fx, { body, tip, size, dx: f.dx });
    ctx.restore();
  }

  const poseSeed = (seed, pose) => seed * 1000 + Object.keys(POSES).indexOf(pose) * 97;
  const frameSeed = (base, i, variant) => base + i * 13 + variant * 101;

  /* 每一格各畫 2 種抖動到離屏畫布,播的時候交替,線條會沸騰。用到哪一格才畫哪一格,畫過的留著重播 */
  function bake(pose, px, seedBase, size) {
    const slots = POSES[pose].map(() => [null, null]);
    return (i, b) => slots[i][b] || (slots[i][b] = (() => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * px); c.height = Math.round(H * px);
      const ctx = c.getContext('2d');
      ctx.scale(px, px);
      draw(ctx, POSES[pose][i], frameSeed(seedBase, i, b), size);
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
    const o = Object.assign({ size: 180, fps: 8, pose: 'idle', seed: 7 }, opt || {});
    const dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr || 3);   // maxDpr:限制解析度,省記憶體(每格預先畫好兩張)
    const px = o.size / W * dpr;
    canvas.width = Math.round(W * px); canvas.height = Math.round(H * px);
    canvas.style.width = o.size + 'px'; canvas.style.height = Math.round(o.size * H / W) + 'px';
    const ctx = canvas.getContext('2d');
    const one = o.variants === 1;            // 只用一種抖動(省一半記憶體)
    const cache = {};
    const framesOf = (p) => cache[p] || (cache[p] = bake(p, px, poseSeed(o.seed, p), o.size));
    let pose = POSES[o.pose] ? o.pose : 'idle', fps = o.fps, i = 0, timer = null, seq = sequence(pose);
    const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    function paint(img) { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0); }
    function tick() {
      const fr = framesOf(pose);
      if (reduce) { paint(fr(CALM[pose] || 0, 0)); return; }
      const [k, j] = seq[i % seq.length];
      paint(fr(k, one ? 0 : (Math.floor(i / seq.length) + j) % 2));
      if (typeof o.onTick === 'function') o.onTick({ pose, frame: k, tick: i });
      i++;
    }
    // 先開計時器再畫第一拍:onTick 裡又呼叫 setPose 時,裡面那次 start() 的 stop() 清得到這個計時器
    function start() { stop(); if (!reduce) timer = setInterval(tick, 1000 / fpsFor(pose, fps)); tick(); }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    start();
    return {
      setPose(p) { if (POSES[p]) { pose = p; seq = sequence(p); i = 0; start(); } },
      setFps(n) { fps = n; start(); },
      // 停掉計時器,只畫指定的那一格;減少動態時一律畫該姿勢的靜止格
      show(k, variant, p) {
        if (p && POSES[p] && p !== pose) { pose = p; seq = sequence(p); i = 0; }
        stop();
        const n = POSES[pose].length;
        paint(framesOf(pose)(reduce ? (CALM[pose] || 0) : (((k | 0) % n) + n) % n, reduce || one ? 0 : (variant ? 1 : 0)));
      },
      stop,
      get pose() { return pose; },
      get fps() { return fpsFor(pose, fps); },
      reducedMotion: reduce,
    };
  }

  /* 給測試和印格子表用:把某個姿勢的第 k 格畫進 ctx(邏輯尺寸 W×H,呼叫的人自己縮放) */
  function drawFrame(ctx, pose, k, opt) {
    const o = Object.assign({ seed: 7, variant: 0, size: 180 }, opt || {});
    draw(ctx, POSES[pose][k], frameSeed(poseSeed(o.seed, pose), k, o.variant), o.size);
  }

  window.PelicanArt = {
    animate,
    poses: Object.keys(POSES),
    drawFrame,
    frameCount: (p) => (POSES[p] ? POSES[p].length : 0),
    holds: (p) => (POSES[p] ? POSES[p].map((f) => f.hold || 1) : []),
    calm: Object.assign({}, CALM),
    fps: Object.assign({}, POSE_FPS),        // 基準 8 時各動作的每秒張數
    version: 2,
    metrics: { width: W, height: H, ground: GROUND },   // ground = 腳底在畫布裡的高度(邏輯像素)
  };
})();
