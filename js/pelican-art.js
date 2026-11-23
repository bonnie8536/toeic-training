/* 塗鴉鵜鶘的圖(主要吉祥物)。原檔與預覽不在這個 repo(第七版)。要改圖先改原檔、在預覽看過,再整份複製過來(保留這段開頭)。
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
   第六版(version 3;姿勢清單不變):
   - 本體小修:腿短約 15%(身體整隻往下放 3.5,地面線不動)、腿線粗約 20%、三根腳趾扇形散開;
     翅膀往下移約 6% 身高、羽毛尖往內收、內側線往下拉成比較深的 U;嘴袋的黃色改成密一點的掃筆,
     中間的白洞改成順著筆觸的細長白縫,左下那段弧線外面補一圈短短的黃色毛邊,右上角的黃色收回框內;
     眼睛改成直立的橢圓、放大約 15%,跟眉毛之間留一條縫;嘴的下緣越往右越往下(右端低約 4.4)、加粗約 20%,右端停在右眼正下方。
   - 小尺寸(96 以下):每隻眼睛的眉毛和眼珠合成一筆往臉中間壓低的粗斜線(畫出來至少 2 px 寬、純黑);
     呆毛畫大一點、線細一點,兩瓣留得出白;腳趾只剩一筆;開心、睡覺的眼睛也是斜的。
   - 看書(read)整個重畫:改成四分之三正面站著,兩隻翅膀在胸前捧著一本攤開的書。
     臉照待機:V 字怒眉、實心眼珠;長長的上嘴往左下斜出身體外,嘴袋從嘴下面垂成一大塊半月形(黃色只在嘴袋);
     書只用墨線(白頁、幾行字、封面只描邊),書頂跟嘴袋最低點之間一直留著一段白縫;翅膀從身體兩側伸下來捏住書的兩個角,
     翅膀先塗白再描線,書線在翅膀那裡斷開。只動三樣:眼珠在書上左右掃(掃完一行跳回來)、
     右頁沿著弧線翻到左邊(翻起來的那頁只比書頂高一點點,碰不到嘴袋)、身體很小的呼吸;中間皺一次眉。
     嘴、嘴袋、書、翅膀、腳整圈都不動。
   - 開心:騰空那三格翅膀往外上方張開(第 4 格最大,羽毛尖超出身體輪廓),身體往上、腳下看得到空隙;落地那格的眼睛改成壓扁的開心弧線。
   - 尷尬:最後斜眼瞄人那格眼珠整個推到一邊、上眼皮壓低、頭轉一點;線團離額頭和嘴遠一點,畫得小時圈數少、線細。
   - 睡覺:呆毛整撮(兩瓣的形狀不變)往一側倒;身體不比待機大(坐下用放低表示),呼吸起伏大一點;z 不靠近畫布上緣。
   第七版(version 3;姿勢清單、格數、holds、速度、靜止格都沒變,本體和待機一筆沒改):
   - 看書:眼睛改成往下看書(畫法同小雞的看書):眉毛下面隔一段白,一條往下垂的眼皮橫線,下面掛著半個眼珠,稍微往書那邊靠;
     96 左右眉毛和眼睛分開畫,64 以下合成一筆、下面掛半個眼珠;中間皺眉那兩格臉往下點一點(嘴、嘴袋、書不動)。
     腳的位置改成跟待機一樣;很小時書背再粗、每頁 2 行字拉開行距。
   - 開心:騰空三格和抬下巴那格的翅膀張得更開(約 1.5 倍),三片羽毛扇形散開;第 0 格保留待機的眼睛,第 1 格才笑瞇。
   - 播放:看書(正面)跟其他姿勢互換時,畫面淡出淡入約 150 ms。
   第八版(version 4;前面五個姿勢一筆沒改,種子也不變):新姿勢 daydream 白日夢接在最後(首頁首屏用)。
   - 整隻趴在地上:身體壓扁、屁股往後拉長,肚子貼地;頭往上抬、嘴往左上翹,眉毛鬆開抬高、眼珠往上看(發呆,還是那張臭臉);
     翅膀往上收一點,兩隻腳往後伸出屁股、腳底朝天。長相(圓身、大嘴袋、全白、臭臉眉毛)照待機的畫法,只換姿勢。
   - 上方飄著三本小書(攤開的大書、黃色蠟筆封面的闔起來的書、攤開的小書),大小不一、高低錯開、微微傾斜;頭上兩個小圈往書那邊冒。
   - 動態:書各自慢慢上下飄、腳趾輪流翹、很小的呼吸和嘴袋晃動、偶爾眨眼。12 格,每秒 4 張(一圈約 3 秒)。靜止格第 0 格。
   - 播放:白日夢(趴著)跟站著的姿勢互換時也淡出淡入。
   用法:const a = PelicanArt.animate(canvas, { size: 180, fps: 8, pose: 'idle', onTick }); a.setPose('happy'); a.setFps(6); a.stop();
   fps 是「基準速度」:各動作會按 PelicanArt.fps 的比例換算(fps 8 時待機每秒 5 張、開心 8 張、尷尬、看書和白日夢 4 張、睡覺 3 張)。 */
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
  let SMALL = false;                       // 第六版:96 以下,臉改成簡化的粗斜線、呆毛留白、腳趾只剩一筆
  let SIZE = 300;                          // 第六版:目前畫的大小(css px),小尺寸的線寬要換算成螢幕上的 px
  const DROP = 3.5;                        // 第六版:身體整隻往下放多少(腿短約 15%,腳底的地面線不動)
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
  /* 第六版:越往右越往下(右端低約 4.4,約身高的 2.5%),右端停在右眼正下方 */
  const BEAK_LOW = spline([[10.5, 112.6], [60, 113.6], [110, 114.2], [168.5, 114.6]], 10);
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
  // 第六版:上緣跟著嘴的下緣往下;右上角收回框內(不塗出去)
  const POUCH = [[24, 113.4, 0.4], [100, 114.4, 0.4], [164, 115.6, 0]]
    // 碗底下面離肚子的外框很近,那一段少塗出去一點(不會蓋過外框、把白肚子塗黃)
    .concat(BOWL_PTS.slice().reverse().map(([x, y], i) => [x, y, i < 3 ? 0 : i < 10 ? 0.7 : i < 12 ? 2 : i < 15 ? 3.5 : 9]))
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
  /* 第六版:內側線往下多拉一段(U 比較深);整隻往下移 10.5(約身高 6%),羽毛尖往內收約 8(約身寬 5%,越靠尖端收越多) */
  const WING_DY = 10.5, WING_IN = 8;
  /* 第七版:fan 是三片羽毛扇形散開幾度(開心張翅膀時用;0 = 原本的翅膀,一點都不變),散開時每片也長一點 */
  const wingPts = (fan) => [[208, 157], [208.8, 168], [211.4, 180], [215.4, 191], [220.6, 198.6], [225.8, 199.4], [228.6, 193.4], [229, 184],
    [231, 191], [235.6, 195.6], [241, 196.6]]
    .concat(lobe([246, 197.6], WING_N[0], 12 * (1 + fan / 50), 18 + fan))                 // 下面那片,往右稍微朝下
    .concat(lobe(WING_N[0], WING_N[1], 18 * (1 + fan / 70), -10).slice(1))                // 中間那片最長,往右
    .concat(lobe(WING_N[1], [254.2, 164.6], 13.5 * (1 + fan / 50), -50 - fan).slice(1))   // 上面那片往右上翹
    .map(([x, y]) => [x - WING_IN * smooth((x - 228) / 40), y + WING_DY]);
  const WING = wingPts(0);
  const WING_PIVOT = [208, 157 + WING_DY];
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
  /* 第六版:三根腳趾扇形散開(往前稍微朝上、往前下、往後),兩隻腳一樣 */
  const TOES = [[-18, -0.8], [12.5, 0.8], [-10.5, 7.8]];
  const LEGS = [[128.7, 235], [186, 235]].map(([x, y]) => {
    const F = [x, GROUND];
    return [[x, y], F].concat(TOES.map(([u, v]) => [x + u, GROUND + v]));
  });
  /* 黃色蠟筆:一束一束彎彎的掃筆(見 pouchFill) */
  const SWEEP = {
    cell: 12.6,        // 束和束的間距(畫面上的 px,網格再亂挪);第三版放寬到 14.8,第六版收密(圓圓的白洞改用 slits 畫細長白縫)
    slits: 6,          // 第六版:順著筆觸的細長白縫有幾條
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
    if (f.lie) return lieXF(f);                              // 第八版:白日夢趴著,另外算
    const sq = f.sq || 1, sx = f.sx || 1 + (sq - 1) * 0.7;   // 吸氣時往上鼓、也一起變胖(不會變得又高又窄)
    const th = (f.tilt || 0) * RAD, dx = f.dx || 0, dy = f.dy || 0;
    const pw = pouchWarp((f.pouch || [0, 0])[0], (f.pouch || [0, 0])[1]);
    const affine = th || dx || dy
      ? ([x, y]) => { const v = rot([(x - CX) * sx, (y - BOT) * sq], th); return [CX + v[0] + dx, BOT + v[1] + dy + DROP]; }
      : ([x, y]) => [CX + (x - CX) * sx, BOT + (y - BOT) * sq + DROP];   // DROP:第六版整隻往下放(腿短一點)
    return { body: (p) => affine(pw(p)), affine, th };
  }

  /* ---------- 各部位 ---------- */
  /* 嘴袋的黃色蠟筆:像拿蠟筆一束一束地掃。嘴袋上鋪一張亂挪過的網格,每個格點掃一束:
     一束是 2~3 筆來回(一筆畫完不提筆、折回來再掃一筆),方向在 20°~60° 之間亂跳,長短是嘴袋寬的 15%~45%,
     每筆都彎一點(筆長的 10%~15%);約三成的束最後才畫、彎的方向相反,疊在前面的上面。
     每一筆量一下嘴袋在這條線上的範圍,兩端依那一邊的規定塗出去,塗出去多少每筆都不一樣,左邊和下緣才會參差不齊;
     彎出去的中段如果跑出嘴袋就拉回直線,不會蓋過嘴的下緣或胸口那條線。
     只有範圍跟著身體變形,筆的方向和粗細在畫面上固定。畫得很小時少塗出去一半 */
  /* area:別的嘴袋範圍(看書的正面嘴袋用,格式同 POUCH);cell:束和束的間距;fringe:毛邊沿著哪一段弧(邏輯座標的點串) */
  function pouchFill(ctx, r, size, area, cell, fringe) {
    const spill = size && size < 120 ? 0.5 : 1;
    const poly = (area || POUCH).map(([x, y, s]) => { const p = XF([x, y]); return [p[0], p[1], s * spill]; });
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    const g = cell || SWEEP.cell, main = [], over = [];
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
    // 第六版:左下那段弧線外面一圈短短的毛邊(從線裡面一點掃到線外面,長短、斜度每筆不一樣)
    const arc = (fringe || BOWL_PTS.slice(1, 11)).map(XF);
    for (let i = 0; i < arc.length - 1; i++) {
      const a = arc[i], b = arc[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-t[1], t[0]];   // n:往弧線外面(弧線往下走時是左邊)
      for (let s = r() * 3; s < L; s += 4.2 + r() * 2.6) {
        const p = [a[0] + t[0] * s, a[1] + t[1] * s], out = (2.5 + r() * 4.5) * spill, slant = (r() - 0.3) * 3;
        curve(ctx, [[p[0] - n[0] * 3, p[1] - n[1] * 3], [p[0] + n[0] * out + t[0] * slant, p[1] + n[1] * out + t[1] * slant]]);
        ctx.stroke();
      }
    }
    // 第六版:順著筆觸方向(往右上斜)的細長白縫,只在嘴袋裡面(兩端和中間都要離邊夠遠),取代以前圓圓的白洞
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = Math.max(1.6, 2.2 * (1 + (INKW - 1) * 0.25));
    const nSlit = Math.round(SWEEP.slits * Math.min(1, (x1 - x0) / 120)) - (size && size < 120 ? 2 : 0);
    for (let i = 0, tries = 0; i < nSlit && tries < 60; tries++) {
      const c = [x0 + (x1 - x0) * (0.15 + 0.7 * r()), y0 + (y1 - y0) * (0.2 + 0.65 * r())];
      const ang = -(24 + 30 * r()) * RAD, d = [Math.cos(ang), Math.sin(ang)], L = 9 + r() * 12, bw = (r() - 0.5) * 3;
      const pts = [-1, -0.5, 0, 0.5, 1].map((u) => [c[0] + d[0] * L * u / 2 - d[1] * bw * (1 - u * u), c[1] + d[1] * L * u / 2 + d[0] * bw * (1 - u * u)]);
      const pad = (p) => [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]].every(([u, v]) => inPoly(poly, [p[0] + u, p[1] + v]));
      if (!pts.every(pad)) continue;
      curve(ctx, pts); ctx.stroke();
      i++;
    }
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

  /* f.wingAt:翅膀整隻再挪多少 [x, y](第六版開心騰空時往外上方張開用);f.fan:羽毛扇形散開幾度(第七版) */
  function wing(ctx, r, f) {
    const a = (f.wing || 0) * RAD, [mx, my] = f.wingAt || [0, 0];
    const pts = (f.fan ? wingPts(f.fan) : WING).map(([x, y]) => { const v = rot([x - WING_PIVOT[0], y - WING_PIVOT[1]], a); return [WING_PIVOT[0] + v[0] + mx, WING_PIVOT[1] + v[1] + my]; });
    ctx.fillStyle = WHITE;
    fillPoly(ctx, pts);                      // 先塗白:羽毛伸出身體的地方蓋住後面的外框
    ctx.strokeStyle = INK;
    line(ctx, spline(pts, 6), r, 3.5, 0.8, true);
  }

  /* 呆毛:tuft 是往右(往後)倒的角度,越靠尖端彎越多;th 是身體轉的角度(第五版,呆毛跟著頭一起轉)。
     回傳呆毛尖在畫面上的位置(不用亂數) */
  /* 第六版:f.tuftRigid 時整撮一起轉(兩瓣的形狀不變,睡覺往一側倒用);96 以下呆毛放大 1.3 倍、線細一點(96 時 0.78 倍、64 以下 0.6 倍),兩瓣裡面留得出白 */
  function tuft(ctx, r, f, th) {
    const base = XF(TUFT_BASE), bend = (f.tuft || 0) * RAD, K = TUFT_K * (SMALL ? 1.3 : 1);
    const map = (pts) => pts.map(([x0, y0]) => {
      const x = x0 * K, y = y0 * K, far = Math.min(1, Math.hypot(x0, y0) * TUFT_K / 29);
      const v = rot([x, y], TUFT_TILT * RAD + (f.tuftRigid ? bend : bend * (0.3 + 0.7 * far)) + (th || 0));
      return [base[0] + v[0], base[1] + v[1]];
    });
    const saved = XF, wk = TINY ? 0.6 : SMALL ? 0.78 : 1;
    XF = ID;
    const a = spline(map(TUFT1), 7), b = spline(map(TUFT2), 6);   // 點取疏一點,圈圈才圓、不會抖出稜角
    ctx.fillStyle = WHITE;
    fillPoly(ctx, a); fillPoly(ctx, b);      // 圈圈裡面也是白的
    ctx.strokeStyle = INK;
    line(ctx, extend(a, 3 + r() * 2, 0), r, 3.5 * wk, 0.9, true);   // 呆毛根部多畫進頭裡一點
    line(ctx, b, r, 3.3 * wk, 0.8, true);
    XF = saved;
    return map([[14.5, -42.5]])[0];
  }

  /* 臉:open 張眼、blink 閉眼(眉毛下一道彎線)。look 是眼珠往右挪多少(負的往左,看書時用)。
     第六版:眼睛改成實心的直立橢圓(比第四版的半圓大約 15%),跟眉毛之間留一條縫;96 以下改畫簡化的臉(smallFace) */
  const PUPIL = [5, 6.9];                            // 眼珠的半寬、半高
  const EYE_GAP = 1.8;                               // 眉毛下緣到眼珠上緣的縫
  /* 眉毛下緣在 x 這一點的高度(待機的眉毛) */
  function browUnder(i, x, bw, lift) {
    const [[x0, y0], [x1, y1]] = BROWS[i], slope = (y1 - y0) / (x1 - x0);
    return y0 + slope * (x - x0) + (bw / 2) / Math.cos(Math.atan(slope)) - (lift || 0);
  }
  function pupil(ctx, r, c, k, kx) {
    const pts = [];
    for (let a = 0; a < 360; a += 30) {
      const rr = 0.97 + r() * 0.06;
      pts.push([c[0] + Math.cos(a * RAD) * PUPIL[0] * k * (kx || 1) * rr, c[1] + Math.sin(a * RAD) * PUPIL[1] * k * rr]);
    }
    fillPoly(ctx, spline(pts.concat([pts[0]]), 2));
  }
  /* look 有給時(看書)改畫往下看的眼睛(readEye,第七版);frown 皺眉:眉頭往下壓多少(眉尾抬一半),眼睛跟著往下讓 */
  function face(ctx, r, kind, look, frown) {
    if (SMALL) { smallFace(ctx, r, kind); return; }
    if (kind !== 'open' && kind !== 'blink') { moodFace(ctx, r, kind); return; }   // 第五版起的表情;待機不會走到
    const k = 1 + (INKW - 1) * 0.5;                   // 眼睛放大倍數(150 以上不放大)
    const bw = 6 * PEN_W * (1 + (INKW - 1) * 0.6), fr = frown || 0;
    ctx.fillStyle = INK;
    EYES.forEach((ex, i) => {
      const lid = browUnder(i, ex, bw);
      if (kind === 'blink') {
        const [[x0, y0], [x1, y1]] = BROWS[i], slope = (y1 - y0) / (x1 - x0), b = lid + 3;
        line(ctx, [[ex - 6 * k, b - 6 * k * slope], [ex, b + 3.5 * k], [ex + 6 * k, b + 6 * k * slope]], r, 3.2, 0.4);
        return;
      }
      if (look !== undefined) { readEye(ctx, r, ex, i, lid, look, fr, k); return; }
      pupil(ctx, r, [ex + (r() - 0.5) * 0.4, lid + EYE_GAP + PUPIL[1] * k + (r() - 0.5) * 0.3], k);
    });
    BROWS.forEach(([a, b], i) => {                            // 眉毛:內側粗、眉尾細一點
      const outer = i ? b : a, inner = i ? a : b;
      taper(ctx, r, [inner[0], inner[1] + fr], [outer[0], outer[1] - fr * 0.5], bw, bw * 0.72);
    });
  }
  /* 第七版:看書的眼睛(畫法同小雞的看書):眉毛下面隔一段白,一條往下垂的眼皮橫線,眼皮下面掛著半個眼珠(上緣切平、下面圓),
     整個眼睛比待機低約三成、稍微往書(兩眼中間下面)靠;眼珠和眼皮跟著 look 左右掃(眼皮挪得少一點)。
     i:0 左眼、1 右眼;lid:待機眉毛下緣的高度;fr:皺眉時整個再往下讓一點 */
  function readEye(ctx, r, ex, i, lid, look, fr, k) {
    const s = i ? -1 : 1;                              // 往臉中間(書那邊)的方向
    const y = lid + 8.5 + fr * 0.4, x = ex + s * 1.2 + look;
    const half = [];
    for (let a = 0; a <= 180; a += 20) half.push([x + Math.cos(a * RAD) * 5.6 * k, y + 0.6 + Math.sin(a * RAD) * 8 * k]);
    fillPoly(ctx, half);
    const lx = ex + s * 1.2 + look * 0.55;            // 眼皮:外側高一點點(跟著眉毛的方向),稍微往下彎
    line(ctx, [[lx - 8.5 * k, y - 0.9 * s], [lx, y + 0.5], [lx + 8.5 * k, y + 0.9 * s]], r, 3.6, 0.4);
  }
  /* 96 以下的臉:每隻眼睛的眉毛和眼珠合成一筆粗斜線,外側高、往臉中間壓低(兩筆合起來是 V,臭臉);
     線寬換算成螢幕上至少 2 px、純黑。表情只改這一筆的彎法,斜度都留著 */
  const SMALL_EYES = [[[125, 78], [149, 93]], [[184, 78], [159, 93]]];   // [外側, 內側]
  function smallFace(ctx, r, kind) {
    const name = kind.split(':')[0];
    const W = Math.max(2.8 * 300 / SIZE, 6 * PEN_W * INKW * 0.6);   // 邏輯單位;畫出來約 2.8 px(至少 2 px)
    const fat = (pts, w) => {
      const p = pts.map(([x, y]) => XF([x + (r() - 0.5) * 0.6, y + (r() - 0.5) * 0.6]));
      ctx.lineWidth = w; curve(ctx, p); ctx.stroke();
    };
    ctx.strokeStyle = INK; ctx.fillStyle = INK;
    SMALL_EYES.forEach(([o, n], i) => {
      const m = [(o[0] + n[0]) / 2, (o[1] + n[1]) / 2], s = i ? -1 : 1;
      if (name === 'happy' || name === 'happysquash') fat([o, [m[0], m[1] - 5], [n[0], n[1] - 2]], W);          // 往上拱的斜弧
      else if (name === 'closed') fat([[o[0], o[1] + 3], [m[0] + s * 2, m[1] + 5], [n[0], n[1] + 1]], W * 0.9); // 往下垂的斜弧
      else if (name === 'squeeze') fat([[n[0] - s * 14, n[1] - 9], [n[0] - s * 2, n[1] - 3], [n[0] - s * 14, n[1] + 3]], W);
      else if (name === 'meh') fat([[o[0], o[1] + 7], [n[0], n[1] + 1]], W * 0.9);
      else if (name === 'sideeye') fat(i ? [[o[0], o[1] - 4], [n[0], n[1] - 3]] : [[o[0], o[1] + 6], [n[0], n[1] + 1]], W);
      else if (name === 'blink') fat([[o[0], o[1] + 4], [n[0], n[1] + 2]], W * 0.9);
      else if (name === 'dream' || name === 'dreamblink') {
        // 第八版:發呆往上看。斜線放平一點、整筆往上提,下面掛一顆圓眼珠(靠左上,往上看);眨眼時眼珠換成一小橫
        const a = [o[0], o[1] - 5], b = [n[0], n[1] - 10];
        const m = [(a[0] + b[0]) / 2 - 2.5, (a[1] + b[1]) / 2 + W * 0.5 + (TINY ? 5 : 6.5)];
        fat([a, b], W);
        if (name === 'dreamblink') fat([[m[0] - 5, m[1]], [m[0] + 5, m[1] + 1]], W * 0.7);
        else { const c = XF(m); ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(TINY ? 6 : 5.5, W * 0.55), 0, Math.PI * 2); ctx.fill(); }
      }
      else if (name === 'look' || name === 'lookfrown') {
        // 第七版:看書。斜線放平一點、整筆往上提(眼皮壓著),中間下面掛著半個眼珠(往下看),眼珠跟著 look 左右掃;
        // 眼珠的下緣離嘴的上緣留一點白,52 px 也不黏在一起
        // 96 左右(線還不算太粗):眉毛跟眼睛分開畫,眉毛提高、下面隔一條白縫掛著上緣切平的半個眼珠;
        // 64 以下(線太粗、擺不下兩樣):眉毛和眼皮合成一筆,中間下面掛著半個眼珠
        const lk = (+kind.split(':')[1] || 0) * 0.5, fr = name === 'lookfrown' ? 1.5 : 0;
        const a = TINY ? [o[0] + lk * 0.5, o[1] - 3 - fr] : [o[0] + 2, o[1] - 8 - fr];
        const b = TINY ? [n[0] + lk * 0.5, n[1] - 6 + fr] : [n[0] - 2, n[1] - 14 + fr];
        fat([a, b], W);
        const c = TINY ? XF([(a[0] + b[0]) / 2 + lk * 0.7 + s * 2.5, (a[1] + b[1]) / 2]) : XF([(o[0] + n[0]) / 2 + lk + s * 2, 89 + fr * 0.5]);
        const rx = Math.max(6.5, W * 0.55), dy = TINY ? W * 0.5 + 6.5 : Math.max(7.5, W * 0.7);
        const half = [];
        for (let t = 0; t <= 180; t += 30) half.push([c[0] + Math.cos(t * RAD) * rx, c[1] + Math.sin(t * RAD) * dy]);
        ctx.beginPath(); half.forEach(([x, y], q) => (q ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
      } else fat([o, n], W);
    });
  }
  /* 第五版起的表情。眉毛的位置用待機的眉毛當底,內側、外側各往上抬多少(負的往下壓):
     [左眉 [內, 外], 右眉 [內, 外]]。內側抬高 = 眉毛鬆開;內側壓低、外側抬高 = 皺眉 */
  const MOODS = {
    happy: [[7, 3], [7, 3]],          // 開心:眉毛鬆開、只剩一點點 V(還是那張嘴硬的臉)
    happysquash: [[6, 3], [6, 3]],    // 落地壓扁時的開心
    squeeze: [[-1, 3], [-1, 3]],      // > <:眉頭皺緊
    meh: [[4, -2], [4, -2]],          // 嘆氣:眉毛拉平
    closed: [[6, 1], [6, 1]],         // 睡覺:眉毛放鬆
    sideeye: [[1, -2], [8, 12]],      // 斜眼瞄你:左眉壓平、右眉挑高
    dream: [[8, 3], [8, 3]],      // 第八版:發呆,眉毛整條抬高、V 鬆一點(還是那張臭臉)
    dreamblink: [[8, 3], [8, 3]],
  };
  const EYE_Y = 90;                   // 表情的眼睛中心高度(第六版:眼睛跟眉毛之間多了縫,往下 3)
  /* kind:happy 開心的弧線 ∩、happysquash 壓扁的開心弧線(落地)、squeeze > <、meh 眼皮垂成兩條橫線、
     closed 睡著(往下彎的弧 ∪)、sideeye 斜眼:上眼皮壓低,眼珠整個推到右邊(往外瞄) */
  function moodFace(ctx, r, kind) {
    const name = kind.split(':')[0];
    const k = 1 + (INKW - 1) * 0.5;
    const bw = 6 * PEN_W * (1 + (INKW - 1) * 0.6);
    const E = EYE_Y + (name === 'squeeze' ? 1 : 0);
    ctx.fillStyle = INK;
    EYES.forEach((ex, i) => {
      const s = i ? -1 : 1;                                   // 往臉中間的方向
      const P = (pts) => pts.map(([u, v]) => [ex + u * k, E + v * k]);
      if (name === 'happy') line(ctx, P([[-6.5, 3], [-2.5, -3], [2.5, -3], [6.5, 3]]), r, 3.6, 0.4);
      else if (name === 'happysquash') line(ctx, P([[-8, 2.5], [-3, -0.8], [3, -0.8], [8, 2.5]]), r, 3.9, 0.4);
      else if (name === 'squeeze') line(ctx, P([[-s * 5, -5], [s * 4.5, 0], [-s * 5, 5]]), r, 3.6, 0.4);
      else if (name === 'meh') line(ctx, P([[-7, 0], [0, 1.5], [7, 0]]), r, 3.8, 0.4);
      else if (name === 'closed') line(ctx, P([[-6.5, -1.5], [-2.5, 3], [2.5, 3], [6.5, -1.5]]), r, 3.6, 0.4);
      else if (name === 'dream') pupil(ctx, r, [ex - 1.4 * k, E - 1.6 * k], k * 0.92);   // 第八版:發呆往上看,眼珠往上靠、稍微往左(書那邊)
      else if (name === 'dreamblink') line(ctx, P([[-6, -0.5], [-2, 2], [2, 2], [6, -0.5]]), r, 3.4, 0.4);
      else if (name === 'sideeye') {
        // 上眼皮壓得很低(一條往外稍微翹的平線),眼珠只露出下半個,整個推到眼皮的右端
        const lid = 1.5, cx = 4.6, half = [];
        for (let a = 0; a <= 180; a += 20) half.push([cx + Math.cos(a * RAD) * 4.6, lid + Math.sin(a * RAD) * 5.4]);
        fillPoly(ctx, P(half));
        line(ctx, P([[-8.5, lid + 0.6], [0, lid + 0.2], [9, lid - 0.8]]), r, 4, 0.4);
      }
    });
    (MOODS[name] || MOODS.happy).forEach(([dIn, dOut], i) => {
      const [a, b] = BROWS[i], inner0 = i ? a : b, outer0 = i ? b : a;
      const inner = [inner0[0], inner0[1] - dIn], outer = [outer0[0], outer0[1] - dOut];
      taper(ctx, r, inner, outer, bw, bw * 0.72);
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

  /* 腳:髖跟著身體,腳掌貼地,三根腳趾扇形散開(往前稍微朝上、往後、往前下)。
     第五版:mode 'jump' 騰空(腳跟著身體懸著、腳趾往下垂);'sit' 坐著(腿藏在肚子下面,只露出腳趾)。
     第六版:腿和腳趾的線粗約 20%;96 以下腳趾只剩一筆(往前、往後) */
  const LEG_W = 4.3, TOE_W = 4.1, TOE2_W = 3.6;
  function legs(ctx, r, affine, mode, dx) {
    // dx:整隻往右挪時腳掌也跟著挪
    const mv = (p) => (dx ? [p[0] + dx, p[1]] : p);
    LEGS.map((g) => g.map((p, i) => (i ? mv(p) : p))).forEach(([hip, foot, out, inn, down]) => {
      const toes = (F) => {
        const T = (p) => [F[0] + p[0] - foot[0], F[1] + p[1] - foot[1]];
        if (SMALL) { line(ctx, [T(out), F, T(inn)], r, TOE_W, 0.5); return; }
        line(ctx, [T(out), F, T(inn)], r, TOE_W, 0.8);
        line(ctx, [F, T(down)], r, TOE2_W, 0.6);
      };
      if (mode === 'jump') {
        const h = affine(hip), F = [h[0] + 1, h[1] + 14];
        line(ctx, [h, F], r, LEG_W, 0.8);
        if (SMALL) { line(ctx, [[F[0] - 10, F[1] + 5], F, [F[0] + 7, F[1] + 4]], r, TOE_W, 0.5); return; }
        line(ctx, [[F[0] - 13, F[1] + 6], F, [F[0] + 9, F[1] + 5]], r, TOE_W, 0.6);
        line(ctx, [F, [F[0] - 4, F[1] + 9]], r, TOE2_W, 0.5);
        return;
      }
      if (mode === 'sit') {
        const F = [affine(hip)[0], foot[1]];
        if (!SMALL) line(ctx, [[F[0] + 1, F[1] - 12], F], r, LEG_W, 0.6);   // 上端藏在肚子後面(身體塗白時蓋掉)
        toes(F);
        return;
      }
      line(ctx, extend([affine(hip), foot], 0, SMALL ? 0 : 2 + r() * 2), r, LEG_W, 0.8);
      toes(foot);
    });
  }

  /* ---------- 第六版:看書 ----------
     四分之三正面站著(頭往左轉一點),兩隻翅膀在胸前捧著一本攤開的書。
     - 臉照待機:V 字怒眉、實心眼珠(往下看書);長長的上嘴從兩眼中間往左下斜出去,尖端伸出身體外;
       嘴袋從嘴的下緣垂下來,是一大塊半月形,最低點跟書頂之間一直留著白縫。黃色只在嘴袋。
     - 書只用墨線:白頁、書背、每頁幾行字,封面只描邊。書在身體前面,翅膀在書的外側捏住兩個角;
       翅膀先塗白、再描線,書線在翅膀那裡自然斷開,兩條線不交叉。
     - 只動三樣:眼珠左右掃(f.look)、右頁翻到左頁(f.page 1 翹起、2 立在書背上、3 落到左邊)、身體很小的呼吸(f.br 0~1);
       f.frown 皺眉一下。嘴、嘴袋、書、翅膀、腳整圈都不動。 */
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
  const RB = { cx: 160, cy: 148, rx: 84, ry: 86 };            // 正面的身體:一顆圓球(下半稍微飽滿)
  const RFACE = [6, 6];                                         // 臉(眉毛、眼睛)從待機的位置搬多少
  const RBEAK = {
    top: [[155, 110], [118, 117.5], [80, 125.5], [42, 133]],    // 上嘴的上緣:嘴根(兩眼中間下面)→ 嘴尖(往左稍微朝下)
    low: [[39, 134.5], [85, 131.6], [131, 128], [177, 124]],   // 嘴的下緣:嘴尖 → 右端(右眼正下方);上嘴在嘴根那邊比較厚
  };
  /* 嘴袋的碗:從嘴的下緣右端往下,繞過圓圓的碗底(最低點約 178),左邊幾乎直直地爬回嘴的下緣(停在嘴尖後面一點,像待機的碗) */
  const RBOWL = [[174, 127], [176.5, 139], [173, 151], [164, 163.5], [149, 172.5], [129, 177.5], [107, 178], [86, 172.5],
    [70, 163], [59.5, 151], [54.5, 140.5], [53.5, 134]];
  const RBOOK = { c: [160, 214], s: 1.08, tilt: -3 };           // 書的中心、放大、斜幾度(左邊稍微抬高)
  const RLEGS = [128.7, 186];                                  // 第七版:腳的位置跟待機一模一樣,切過來時腳不會跳
  const RWINGS = [[86, 184, 47, false], [234, 184, -47, true]]; // 肩膀的位置、轉幾度、要不要左右翻
  /* 圓球上的點:a 是角度(0 = 右、90 = 下) */
  function ballPts(B, a0, a1, step) {
    const out = [];
    for (let a = a0; a <= a1 + 0.01; a += step) {
      const c = Math.cos(a * RAD), s = Math.sin(a * RAD);
      out.push([B.cx + B.rx * Math.sign(c) * Math.pow(Math.abs(c), 0.92), B.cy + B.ry * (s > 0 ? Math.pow(s, 0.8) : s)]);
    }
    return out;
  }
  function readBody(ctx, r, f) {
    const k = (f.br || 0) * 0.014, B = { cx: RB.cx, rx: RB.rx * (1 + k * 0.4), ry: RB.ry * (1 + k), cy: RB.cy - RB.ry * k };   // 呼吸:底部不動,往上鼓
    ctx.fillStyle = WHITE;
    fillPoly(ctx, ballPts(B, 0, 356, 4));
    ctx.strokeStyle = INK;
    line(ctx, spline(ballPts(B, 100, 466, 9), 8), r, 4.4, 1.0, true);           // 一筆繞一圈,接頭多畫一點
    if (!TINY) {                                                                // 頭頂多描一次(偏上一點)
      const top = ballPts(B, 222 + r() * 10, 310 - r() * 10, 6), n = top.length - 1;
      line(ctx, top.map(([x, y], i) => { const w = 0.3 + 0.7 * Math.sin(Math.PI * i / n); return [x + 0.8 * w, y - 2.8 * w]; }), r, 2.8, 0.9, true);
    }
    return B;
  }
  function readBeak(ctx, r, size) {
    // 嘴袋:先塗白(伸出身體外的那一塊才蓋得住後面),再塗黃;下緣幾乎不塗出去(書頂那邊要留白縫),左邊塗出去多一點
    const area = RBEAK.low.slice().reverse().map(([x, y]) => [x, y, 0.3])
      .concat(RBOWL.map(([x, y], i) => [x, y, i < 3 ? 0 : i < 8 ? 0.6 : 5]));
    ctx.fillStyle = WHITE;
    fillPoly(ctx, area);
    pouchFill(ctx, r, size, area, 11.5, RBOWL.slice(7).reverse());   // 毛邊在碗的左下
    ctx.strokeStyle = INK;
    line(ctx, extend(spline(RBOWL, 7), 0, 2), r, 4.1, 0.9, true);              // 碗:一筆從右上繞到嘴尖下面
    ctx.fillStyle = WHITE;
    fillPoly(ctx, RBEAK.top.concat(RBEAK.low));                                 // 上嘴塗白
    line(ctx, extend(spline(RBEAK.top, 8), 2.5, 2.5), r, 4.4, 1.0, true);      // 上嘴的上緣(嘴尖多畫出去一點,跟下緣交叉)
    line(ctx, extend(spline(RBEAK.low, 10), 0, 1.5), r, 4.6, 0.7, true);       // 嘴的下緣
  }
  /* 攤開的書(墨線,不塗色)。page:1 右頁上角翹起來、2 立在書背上(只比書頂高一點點)、3 落到左邊;
     每頁的字:很小時 2 行(線加粗)、中等 3 行、大的 4 行 */
  const RPAGES = {
    1: [[0, -11], [12, -16], [24, -20.5], [34, -23], [41, -22], [45, -8], [49, 9], [36, 11], [24, 12], [10, 14], [0, 18]],
    2: [[0, -11], [4, -17], [9, -23], [14, -26], [18, -23], [17, -9], [13, 4], [6, 12], [0, 18]],
    3: [[0, -11], [-12, -16], [-26, -19.5], [-39, -21.5], [-45, -20], [-46, -6], [-45, 7], [-30, 11], [-14, 13.5], [0, 18]],
  };
  function readBook(ctx, r, page) {
    const P = RBOOK, w = 52;
    const at = (pts) => pts.map(([u, v]) => { const q = rot([u * P.s, v * P.s], P.tilt * RAD); return [P.c[0] + q[0], P.c[1] + q[1]]; });
    const ink = (pts, wd, j) => line(ctx, wobble(at(pts), 9), r, wd, j === undefined ? 0.8 : j);
    const M = (pts) => pts.map(([u, v]) => [-u, v]).reverse();
    const pageL = [[0, -11], [-10, -17], [-26, -19], [-w + 12, -18], [-w + 1, -14], [-w + 1, 9], [-w + 14, 11], [-26, 12], [-10, 14], [0, 18]];
    const cover = [[-w - 4, -11], [-w - 4, 15], [-26, 19], [0, 25], [26, 19], [w + 4, 15], [w + 4, -11]];
    ctx.fillStyle = WHITE;
    fillPoly(ctx, at(cover.concat([[w - 10, -17], [0, -11], [-w + 10, -17]])));
    fillPoly(ctx, at(pageL.concat(M(pageL))));
    ctx.strokeStyle = INK;
    ink(cover, 3.4, 0.9);                                                                  // 封面(只描邊)
    if (!TINY) ink([[-w + 1, 13], [-26, 16], [-10, 18.5], [0, 22], [10, 18.5], [26, 16], [w - 1, 13]], 2, 0.6);   // 書頁的厚度
    ink(pageL.slice(0, 6).reverse(), 3.2);                                                 // 左頁上緣和外側
    ink(M(pageL).slice(4), 3.2);                                                           // 右頁
    if (!TINY) ink([[-w + 1, 9], [-26, 12], [-10, 14], [0, 18], [10, 14], [26, 12], [w - 1, 9]], 2.6);   // 書頁底
    line(ctx, extend(at([[0, -11], [0.8, 3], [0, 23]]), 1, 0), r, TINY ? 5.8 : 4.2, 0.6);   // 書背加粗(第七版:很小時再粗一點,兩頁的 V 才清楚)
    // 第七版:很小時每頁 2 行、行距拉開、兩頭多留白,不會糊成一條灰色
    const rows = TINY ? [-10, 2] : SMALL ? [-9, -3, 3] : [-10.5, -5, 0.5, 6];
    const tw = TINY ? 2.6 : 1.9;
    const text = (s, v, a, b) => { const d = v < -5 ? -1.2 : 0; line(ctx, at([[a, v + d], [(a * 2 + b) / 3, v - 1 + d * 0.5], [(a + b * 2) / 3, v], [b, v - 0.8]]), r, tw, 0.5); };
    rows.forEach((v) => [-1, 1].forEach((s) => {
      if ((page === 1 && s > 0) || (page === 3 && s < 0)) return;                          // 被翻起來的那頁蓋住的字不畫
      text(s, v, s * (TINY ? 12 : 9), s * (w - (TINY ? 15 : 10)));
    }));
    if (page) {
      const pg = RPAGES[page];
      ctx.fillStyle = WHITE;
      fillPoly(ctx, at(pg));
      ink(pg, 2.8);
      if (page === 1) rows.slice(0, TINY ? 1 : 2).forEach((v) => text(1, v - 2, 9, 36));   // 翹起來那頁上也有字,看得出是書頁
      if (page === 3) rows.slice(0, TINY ? 1 : 2).forEach((v) => text(-1, v - 1, -9, -38));
    }
  }
  /* 正面的翅膀:同一隻三瓣羽毛的翅膀(mirror 左右翻),以 at 為肩膀轉 deg 度、縮成 0.78 倍;
     整片在身體外面,外緣也要描。先塗白,書線在這裡斷開 */
  function readWing(ctx, r, [ax, ay, deg, mirror]) {
    const th = deg * RAD, k = 0.78;
    const pts = WING.map(([x, y]) => {
      const v = rot([(mirror ? -1 : 1) * (x - WING_PIVOT[0]) * k, (y - WING_PIVOT[1]) * k], th);
      return [ax + v[0], ay + v[1]];
    });
    ctx.fillStyle = WHITE;
    fillPoly(ctx, pts);
    ctx.strokeStyle = INK;
    line(ctx, spline(pts.concat([pts[0]]), 5), r, 3.4, 0.7, true);
  }
  function readLegs(ctx, r) {
    RLEGS.forEach((x) => {
      const F = [x, GROUND], T = TOES.map(([u, v]) => [x + u, GROUND + v]);
      line(ctx, extend([[x, 226], F], 0, SMALL ? 0 : 2), r, LEG_W, 0.8);
      line(ctx, [T[0], F, T[1]], r, TOE_W, SMALL ? 0.5 : 0.8);
      if (!SMALL) line(ctx, [F, T[2]], r, TOE2_W, 0.6);
    });
  }
  function drawRead(ctx, r, f, size) {
    readLegs(ctx, r);                                         // 腳先畫,上端被身體和書蓋住
    const B = readBody(ctx, r, f);
    XF = ([x, y]) => [x - TUFT_BASE[0] + RB.cx + 6, y - TUFT_BASE[1] + B.cy - B.ry + 1.5];
    tuft(ctx, r, { tuft: 6 }, 0);
    XF = ID;
    readBeak(ctx, r, size);
    const nod = f.nod || 0;                                   // 第七版:點頭時臉(眉毛、眼睛)往下點一點,嘴和嘴袋不動
    XF = ([x, y]) => [x + RFACE[0], y + RFACE[1] + nod];
    face(ctx, r, SMALL ? (f.frown ? 'lookfrown:' : 'look:') + f.look : 'open', f.look, f.frown);
    XF = ID;
    readBook(ctx, r, f.page || 0);
    RWINGS.forEach((g) => readWing(ctx, r, g));
  }

  /* ---------- 第八版:白日夢(daydream) ----------
     整隻趴在地上:本體還是同一顆球(外框、嘴袋、翅膀、呆毛、臉都照待機的畫法,長相一筆沒改),
     整隻壓扁、屁股往後拉長,肚子貼著地面線;頭往上抬(嘴往左上翹),眉毛鬆開抬高、眼珠往上看(發呆);
     翅膀往上收一點,兩隻腳往後伸出屁股、腳底朝天(三根腳趾往右上攤開),腳趾輪流翹一下。
     上方飄著三本小書(大小不一、高低錯開、微微傾斜),各自慢慢上下飄;頭上兩個小圈往書那邊冒(想的泡泡)。
     書只用墨線、白頁和嘴袋那支黃色蠟筆,全身照樣不出現藍色。 */
  /* 身體:先在身體座標壓扁(sq)、屁股那一半往後拉長(sx、back),再以 LIE.pivot 為軸把頭往上抬:
     越上面轉越多(頭整個轉 tilt 度,肚子只轉 tiltBody 度),頭還是一顆圓頂,嘴袋跟著往下垂;
     每格重算整隻要往下放多少,讓最低點剛好碰到地面線(呼吸時肚子不離地,只有背往上鼓) */
  const LIE = { pivot: [180, 200], y0: 125, y1: 205 };   // 抬頭:y0 以上整個轉 tilt 度,y1 以下只轉 tiltBody 度,中間慢慢過去
  function lieXF(f) {
    const th = (f.tilt || 0) * RAD, thB = (f.tiltBody || 0) * RAD, sq = f.sq || 1, sx = f.sx || 1, back = f.back || 0, dx = f.dx || 0;
    const pw = pouchWarp((f.pouch || [0, 0])[0], (f.pouch || [0, 0])[1]);
    const [px, py] = LIE.pivot;
    const base = ([x, y]) => {
      const x1 = CX + (x - CX) * (sx + back * smooth((x - 150) / 100)), y1 = BOT + (y - BOT) * sq;   // 先壓扁、屁股往後拉長
      const a = thB + (th - thB) * smooth((LIE.y1 - y1) / (LIE.y1 - LIE.y0));                         // 再把頭往上抬(越上面轉越多)
      const v = rot([x1 - px, y1 - py], a);
      return [px + v[0], py + v[1]];
    };
    let low = -Infinity;
    OUTLINE.forEach((p) => { low = Math.max(low, base(p)[1]); });
    const dy = GROUND - 0.5 - low;
    const affine = (p) => { const q = base(p); return [q[0] + dx, q[1] + dy]; };
    return { body: (p) => affine(pw(p)), affine, th };
  }
  /* 腳(趴著):往後伸出屁股,只露出一小段腿和腳掌。腿貼著地往後(上端藏在屁股裡),腳踝在屁股後面,
     三根腳趾往右上攤開(腳底朝天);kick 是兩隻腳的腳趾各往上翹幾度(輪流動一下)。很小時只剩兩根腳趾 */
  const LIE_FEET = [[260, 2.5], [274, 5]];            // 腳踝:[x(畫面座標,再加 dx), 離地多高];後面那隻高一點、靠後一點
  const LIE_TOES = [[-74, 10.5], [-40, 13], [-6, 10.5]];   // 腳趾往右上攤開:[幾度(負的往上), 多長]
  function lieLegs(ctx, r, f) {
    LIE_FEET.forEach(([x0, up], i) => {
      const A = [x0 + (f.dx || 0), GROUND - up], kick = (f.kick || [0, 0])[i];
      const T = ([deg, L]) => [A[0] + Math.cos((deg - kick) * RAD) * L, A[1] + Math.sin((deg - kick) * RAD) * L];
      line(ctx, extend([[A[0] - 26, GROUND - 9 - up * 0.5], A], 0, 1), r, LEG_W, 0.6);   // 腿往後伸,上端藏在屁股裡(身體塗白時蓋掉)
      if (SMALL) { line(ctx, [T(LIE_TOES[0]), A, T(LIE_TOES[2])], r, TOE_W, 0.5); return; }
      line(ctx, [T(LIE_TOES[0]), A, T(LIE_TOES[2])], r, TOE_W, 0.8);
      line(ctx, [A, T(LIE_TOES[1])], r, TOE2_W, 0.6);
    });
  }
  /* 飄著的書(畫面座標)。三本:[種類, 中心, 大小, 斜幾度];每格 f.books 給每本 [往上飄多少, 多轉幾度]。
     open:攤開的書(兩頁往上翹成淺淺的 V,書背在中間,每頁一兩行字);shut:闔起來的書(封面黃色蠟筆、右下露出書頁的厚度、書背一條線) */
  const DAY_BOOKS = [
    ['open', [92, 46], 1.12, -10],
    ['shut', [180, 34], 1, 14],
    ['open', [34, 74], 0.66, 12],
  ];
  function openBook(ctx, r, at, k) {
    const w = 30, ink = (pts, wd, j) => line(ctx, wobble(at(pts), 6), r, wd * k, j === undefined ? 0.7 : j);
    const pageL = [[0, -3], [-8, -8], [-19, -10], [-w + 2, -9], [-w, -7], [-w, 9], [-w + 8, 10], [-19, 10.5], [-8, 11.5], [0, 14]];
    const M = (pts) => pts.map(([u, v]) => [-u, v]).reverse();
    const cover = [[-w - 3, -5], [-w - 3, 12], [-16, 14], [0, 18], [16, 14], [w + 3, 12], [w + 3, -5]];
    ctx.fillStyle = WHITE;
    fillPoly(ctx, at(cover.concat([[w - 4, -9], [0, -3], [-w + 4, -9]])));
    fillPoly(ctx, at(pageL.concat(M(pageL))));
    ctx.strokeStyle = INK;
    ink(cover, 3.2, 0.8);
    ink(pageL.slice(0, 6).reverse(), 3);
    ink(M(pageL).slice(4), 3);
    line(ctx, extend(at([[0, -3], [0.6, 6], [0, 16]]), 1, 0), r, (TINY ? 5 : 3.8) * k, 0.5);   // 書背
    const rows = SMALL ? [-1] : [-3, 3];
    rows.forEach((v) => [-1, 1].forEach((s) => {
      const a = s * 6, b = s * (w - 7), d = v < 0 ? -0.8 : 0;
      line(ctx, at([[a, v + d], [(a * 2 + b) / 3, v - 0.8 + d * 0.5], [(a + b * 2) / 3, v], [b, v - 0.6]]), r, (SMALL ? 2.6 : 1.9) * Math.max(0.8, k), 0.4);
    }));
  }
  function shutBook(ctx, r, at, size) {
    const w = 21, h = 14, t = 5;                     // 封面半寬、半高、書頁厚度
    const cover = [[-w, -h], [w, -h], [w, h], [-w, h]];
    const block = [[w, -h], [w + t, -h + t * 0.7], [w + t, h + t * 0.7], [-w + t, h + t * 0.7], [-w, h], [w, h]];
    ctx.fillStyle = WHITE;
    fillPoly(ctx, at(block));
    fillPoly(ctx, at(cover));
    pouchFill(ctx, r, size, at(cover).map(([x, y]) => [x, y, 0.6]), 7, []);   // 封面:嘴袋那支黃色蠟筆
    ctx.strokeStyle = INK;
    line(ctx, wobble(at(cover.concat([cover[0]])), 6), r, 3.2, 0.7);
    line(ctx, wobble(at([[w, -h], [w + t, -h + t * 0.7], [w + t, h + t * 0.7], [-w + t, h + t * 0.7], [-w, h]]), 6), r, 2.8, 0.6);
    if (!TINY) line(ctx, wobble(at([[w + 1, h - 1 + t * 0.35], [-w + t * 0.5 + 1, h + t * 0.35]]), 8), r, 1.6, 0.3);   // 書頁的線
    line(ctx, at([[-w + 6, -h + 1], [-w + 6, h - 1]]), r, 2.4, 0.4);                        // 書背
  }
  function dayBooks(ctx, r, f, size) {
    const mv = f.books || [];
    DAY_BOOKS.forEach(([kind, c, k, deg], i) => {
      const [up, turn] = mv[i] || [0, 0];
      const th = (deg + turn) * RAD;
      const at = (pts) => pts.map(([u, v]) => { const q = rot([u * k, v * k], th); return [c[0] + q[0], c[1] - up + q[1]]; });
      if (kind === 'open') openBook(ctx, r, at, k); else shutBook(ctx, r, at, size);
    });
    // 想的泡泡:頭頂左上方兩個小圈,一個小一個大,往書那邊冒
    if (!TINY) [[152, 98, 3.2], [134, 83, 5]].forEach(([x, y, s]) => {
      const ring = [];
      for (let a = 0; a <= 360; a += 40) ring.push([x + Math.cos(a * RAD) * s, y + Math.sin(a * RAD) * s * 0.9]);
      line(ctx, ring, r, 2.4, 0.3);
    });
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
        // 第六版:圈心再往左上移(離額頭和嘴的上緣遠一點)、整團小一成五;畫得小時只繞兩圈、線細一點,52 px 不糊成一團黑
        const R = ([0, 26, 30, 33, 22, 0][n] || 0) * (small ? 1.1 : 0.85), J0 = k.body(J);
        const t = [J0[0] - 34, Math.max(J0[1] - 54, 6 + R * 0.9)], tw = small ? 1.9 : 2.8;
        if (n === 5) {
          const x = t[0] - 4, y = t[1] + 6;
          line(ctx, [[x - 10, y + 2], [x - 4, y - 5], [x + 2, y + 1], [x + 8, y - 6], [x + 14, y - 1], [x + 19, y - 7]], r, tw, 0.5);
        } else if (R) {
          const loops = small ? 2 : n === 3 ? 4 : n === 4 ? 2 : 3;
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
          line(ctx, pts, r, tw, 0.5);
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
        // 第六版:整條路徑放低,最高的 z 也離畫布上緣至少 8%(24 以下)
        const b = k.body([232, 70]), top = 25;
        const z = (x, y, s) => line(ctx, [[x, y], [x + s, y], [x, y + s], [x + s, y + s]], r, 3.4, 0.5);
        z(b[0] + n * 3, Math.max(top + 12, b[1] - n * 3.5), 15);
        if (n >= 2) z(b[0] + 24 + n * 2, Math.max(top, b[1] - 24 - n * 2.5), 10);
      } else if (name === 'pop') {
        // 得意的短線:頭的右上方三條往外放射的短線(「哼」);pop:2 只畫上面兩條(第七版:翅膀張到最大時,最下面那條會碰到羽毛)
        [[[222, 46], [231, 30]], [[244, 62], [258, 51]], [[256, 88], [272, 84]]].forEach(([a, b], i) => {
          if ((small && i === 1) || (n === 2 && i === 2)) return;
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
     feet 'jump' 騰空 / 'sit' 坐著、fx 特效、wingAt 翅膀整隻挪多少、tuftRigid 呆毛整撮一起轉。
     嘴往下低時(tilt 負的)要給 dx,嘴尖才不會超出畫布 */
  /* 開心(「哼,還不錯嘛」):抬下巴站好 → 蹲(預備,嘴袋往上頂)→ 拉長往上衝(嘴袋往下墜)→ 騰空、翅膀往外上方張開 →
     頂點(停 2 拍)、翅膀張到最大、得意的短線 → 落下(嘴袋往上甩)→ 落地壓扁、眼睛笑成壓扁的弧線、嘴袋重重甩下去、冒煙 → 回彈 →
     抬下巴得意(停 2 拍)→ 放鬆接回開頭。呆毛比身體慢一拍。
     第六版:騰空三格翅膀轉高、整隻往外上方挪(羽毛尖超出身體輪廓),身體拉長、腳下看得到空隙;第 0 格接近待機的站姿 */
  const happy = [
    { eyes: 'open', tilt: 1, wing: -3, tuft: -3, pouch: [0, 1] },
    { sq: 0.86, sx: 1.03, tilt: -1, dx: 3, eyes: 'happy', wing: 8, tuft: 10, pouch: [1, -3], hold: 2 },
    { sq: 1.1, sx: 0.95, dy: -4, tilt: 5, eyes: 'happy', wing: -30, tuft: 16, pouch: [1, 6] },
    { sq: 1.08, sx: 0.95, dy: -22, tilt: 7, eyes: 'happy', wing: -62, wingAt: [8, -12], fan: 14, feet: 'jump', tuft: 24, pouch: [-1, 8], fx: ['motion', 'shadow'] },
    { sq: 1.03, sx: 0.98, dy: -28, tilt: 8, eyes: 'happy', wing: -76, wingAt: [8, -17], fan: 22, feet: 'jump', tuft: 12, pouch: [0, 1], fx: ['pop:2', 'shadow'], hold: 2 },
    { sq: 1.07, sx: 0.96, dy: -17, tilt: 6, eyes: 'happy', wing: -54, wingAt: [7, -10], fan: 12, feet: 'jump', tuft: 8, pouch: [1, -6], fx: ['shadow'] },
    { sq: 0.8, sx: 1.04, tilt: 1, dx: 1, eyes: 'happysquash', wing: 14, tuft: -22, pouch: [-3, 10], fx: ['dust'] },
    { sq: 1.06, sx: 0.97, tilt: 6, eyes: 'happy', wing: -20, tuft: 12, pouch: [2, -5] },
    { sq: 0.99, tilt: 7, eyes: 'happy', wing: -42, wingAt: [8, -5], fan: 12, tuft: -6, pouch: [-1, 3], fx: ['pop'], hold: 2 },
    { tilt: 3, eyes: 'happy', wing: -10, tuft: 2, pouch: [0, 0.5] },
  ];
  /* 尷尬懊惱(成績不理想):不哭也不裝可憐,是「嘖」。站好 → 縮一下、頭低下去 → 縮到最底,> <、嘴袋垂下來,
     額頭左上方冒出打結的線團、頭的右邊一滴汗(停 2 拍)→ 回彈 → 吸一口氣抬頭(線團鬆開)→ 嘆氣扁下去、嘴邊一團氣(停 2 拍)→
     鬆下來、呆毛往後塌 → 斜眼瞄你一下(第六版:眼珠推到一邊、上眼皮壓低、頭往上轉 2.5 度,停 3 拍)→ 眨眼接回開頭 */
  const oops = [
    { eyes: 'open', tuft: -2 },
    { sq: 0.9, sx: 1.02, tilt: -2, dx: 5, eyes: 'squeeze', wing: 8, tuft: 10, pouch: [0, 4], fx: ['tangle:1'] },
    { sq: 0.84, sx: 1.03, tilt: -4, dx: 8, eyes: 'squeeze', wing: 12, tuft: -14, pouch: [1, 8], fx: ['tangle:3', 'drop:0'], hold: 2 },
    { sq: 0.9, sx: 1.02, tilt: -1, dx: 5, eyes: 'squeeze', wing: 6, tuft: -18, pouch: [0, 6], fx: ['tangle:2', 'drop:1'] },
    { sq: 1.06, sx: 0.98, tilt: 3, eyes: 'meh', wing: -10, tuft: 8, pouch: [0, 1], fx: ['tangle:4', 'drop:2'] },
    { sq: 0.88, sx: 1.03, tilt: -3, dx: 7, eyes: 'meh', wing: 10, tuft: 16, pouch: [1, 9], fx: ['tangle:5', 'sigh:1'], hold: 2 },
    { sq: 0.86, sx: 1.03, tilt: -3, dx: 7, eyes: 'meh', wing: 14, tuft: 26, pouch: [1, 10], fx: ['sigh:2'] },
    { tilt: 2.5, eyes: 'sideeye', wing: 4, tuft: -8, pouch: [0, 4], hold: 3 },
    { sq: 1.02, eyes: 'blink', tuft: 4, pouch: [0, 2] },
  ];
  /* 看書(第六版重畫,見 drawRead):look 眼珠往右挪多少、frown 皺眉、nod 臉往下點多少(第七版)、page 翻頁、br 呼吸。
     往左看 → 中間 → 看到右邊(停 2 拍)→ 跳回下一行的開頭、皺一下眉(停 2 拍)→ 中間 → 看到右邊、右頁翹起來 →
     那頁立在書背上 → 落到左邊(停 2 拍)→ 接回開頭(新的一頁)。一圈 12 拍(每秒 4 張約 3 秒) */
  const read = [
    { look: -4.5, br: 0, hold: 2 },
    { look: 0, br: 0.5 },
    { look: 4.5, br: 1, hold: 2 },
    { look: -4.5, frown: 2.5, nod: 1, br: 0.6, hold: 2 },
    { look: 0, frown: 1.5, nod: 2, br: 0.2 },
    { look: 4.5, page: 1, br: 0 },
    { look: 1.5, page: 2, br: 0.5 },
    { look: -3.5, page: 3, br: 1, hold: 2 },
  ].map((f) => Object.assign({ front: true }, f));
  /* 睡覺:坐在地上(整隻放低、只露出腳趾),嘴微微往下垂,翅膀垂著,呆毛整撮往後倒。吐完氣(停 3 拍)→ 慢慢吸氣,嘴袋跟著往左下鼓 →
     吸飽(停 3 拍)→ 吐氣 → 回到開頭。z 一格一格往右上飄。
     第六版:身體一直比待機小一點(sq 0.9~0.99),呼吸起伏比第五版大;呆毛整撮轉(兩瓣的形狀不變) */
  const sleep = [
    { sq: 0.9, pouch: [1, -1], tuft: 14, fx: ['z:0'], hold: 3 },
    { sq: 0.93, pouch: [-0.5, 2], tuft: 16, fx: ['z:1'] },
    { sq: 0.965, pouch: [-2.5, 4.5], tuft: 19, fx: ['z:2'] },
    { sq: 0.99, pouch: [-3.5, 6.5], tuft: 18, fx: ['z:3'], hold: 3 },
    { sq: 0.965, pouch: [-2.5, 4], tuft: 15, fx: ['z:4'] },
    { sq: 0.93, pouch: [0, 1], tuft: 13, fx: ['z:5'], hold: 2 },
    { sq: 0.905, pouch: [1, -1.5], tuft: 13, fx: ['z:6'] },
  ].map((f) => Object.assign({ eyes: 'closed', feet: 'sit', dy: 12, tilt: -3, dx: 6, wing: 10, tuftRigid: true }, f));

  /* 第八版:白日夢(見 lieXF、lieLegs、dayBooks)。趴著、嘴往上抬、發呆看著上面飄的書。
     一圈 12 格、每格 1 拍:三本書各自上下飄(相位錯開三分之一圈,飄的時候順便轉一點)、兩隻腳的腳趾輪流翹、
     身體很小的呼吸(背往上鼓,肚子不離地)、嘴袋和呆毛跟著輕輕晃;第 7 格眨一下眼。
     每秒 4 張、一圈約 3 秒,動作小,可以長時間放著 */
  const DAY_N = 12;
  const daydream = Array.from({ length: DAY_N }, (_, k) => {
    const a = k / DAY_N * Math.PI * 2, ph = (i) => a + i * Math.PI * 2 / 3;
    return {
      sq: 0.74 + 0.012 * (1 - Math.cos(a)) / 2,
      pouch: [0.6 * Math.sin(a), 1.4 * Math.sin(a - 0.9)],
      tuft: 3 + 4 * Math.sin(a - 0.8),
      kick: [7 + 7 * Math.sin(a), 7 - 7 * Math.sin(a)],
      books: [0, 1, 2].map((i) => [6 * Math.sin(ph(i)), 2.5 * Math.cos(ph(i))]),
      eyes: k === 7 ? 'dreamblink' : 'dream',
    };
  }).map((f) => Object.assign({ lie: true, tilt: 30, tiltBody: 10, sx: 0.88, back: 0.16, dx: -18, wing: -32 }, f));

  /* 第五版的姿勢接在 idle 後面(待機的種子用姿勢的順序算,不變);第八版的白日夢接在最後(前面各姿勢的種子不變) */
  const POSES = { idle, happy, oops, read, sleep, daydream };
  /* 不想看動畫(減少動態)時每個姿勢顯示的那一格:
     happy 第 8 格(站著抬下巴、開心的眼睛、得意的短線)、oops 第 2 格(縮到最底、> <、線團和汗都在)、
     read 第 0 格(捧著書往下看)、sleep 第 3 格(吸飽氣、兩個 z)、daydream 第 0 格(三本書都在空中、張著眼往上看) */
  const CALM = { idle: 0, happy: 8, oops: 2, read: 0, sleep: 3, daydream: 0 };
  /* 各動作在基準 fps = 8 時的播放速度;實際 = 呼叫者給的 fps × 這裡 / 8 */
  const POSE_FPS = { idle: 5, happy: 8, oops: 4, read: 4, sleep: 3, daydream: 4 };
  const fpsFor = (pose, base) => base * (POSE_FPS[pose] || 8) / 8;

  /* 畫一格。seed 決定這一格的抖動 */
  function draw(ctx, f, seed, size) {
    const r = rng(seed);
    INKW = inkFor(size);
    TINY = !!size && size <= 64;
    SMALL = !!size && size <= 96;
    SIZE = size || 300;
    const { body, affine, th } = bodyXF(f);
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = INK; ctx.fillStyle = INK;

    XF = ID;
    if (f.front) { drawRead(ctx, r, f, size); ctx.restore(); return; }   // 第六版:看書是正面,另外畫
    if (f.lie) lieLegs(ctx, r, f);           // 第八版:趴著,腳往後伸出屁股
    else legs(ctx, r, affine, f.feet, f.dx); // 先畫腳,身體塗白時蓋住腳的上端

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
    line(ctx, extend(BEAK_LOW, 0, 0.5 + r()), r, 4.6, 0.7, true);   // 第六版:加粗約 20%
    line(ctx, BOWL, r, 4.1, 0.9, true);
    wing(ctx, r, f);
    const tip = tuft(ctx, r, f, th);
    face(ctx, r, f.eyes || 'open');
    XF = ID;
    if (f.fx) fx(ctx, r, f.fx, { body, tip, size, dx: f.dx });
    if (f.books) dayBooks(ctx, r, f, size);  // 第八版:白日夢上方飄的書
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
    /* 第七版:看書是正面,跟其他(側面)姿勢互換時,上一張畫面用約 150 ms 淡出、新的淡入,整隻不會一下子跳過去。
       第八版:白日夢是趴著的,跟站著的(側面、正面)互換時也淡出淡入;站著的側面姿勢之間照舊直接換。
       減少動態時、或環境沒有 requestAnimationFrame 時不做 */
    const FADE_MS = 150, raf = typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame.bind(window) : null;
    const scene = (p) => (POSES[p][0].front ? 'front' : POSES[p][0].lie ? 'lie' : 'side');
    const now = () => (window.performance && performance.now ? performance.now() : Date.now());
    let last = null, fade = null;
    function paint(img) {
      last = img;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const t = fade ? (now() - fade.t0) / FADE_MS : 1;
      if (t >= 1) { fade = null; ctx.drawImage(img, 0, 0); return; }
      ctx.globalAlpha = 1 - t; ctx.drawImage(fade.from, 0, 0);
      ctx.globalAlpha = t; ctx.drawImage(img, 0, 0);
      ctx.globalAlpha = 1;
    }
    function fadeFrom(p) {
      if (reduce || !raf || !last || scene(p) === scene(pose)) return;
      fade = { from: last, t0: now() };
      const step = () => { if (!fade || !last) return; paint(last); if (fade) raf(step); };
      raf(step);
    }
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
      setPose(p) { if (POSES[p]) { fadeFrom(p); pose = p; seq = sequence(p); i = 0; start(); } },
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
    version: 4,
    metrics: { width: W, height: H, ground: GROUND },   // ground = 腳底在畫布裡的高度(邏輯像素)
  };
})();
