/* 塗鴉圖示的第二批:聽力訓練的四個入口、寫作練習的三個級別。要先載 js/doodle-art.js,這支再往 DoodleArt 登記。
   畫法跟 doodle-art.js 完全一樣(同一套抖動墨線、黃色塗鴉、三級細節、tone 'fill'/'line'),
   只是 doodle-art.js 快滿 800 行,新的圖示放這裡。這裡只畫圖,不讀寫任何儲存,也不用瀏覽器的隨機數。 */
(function () {
  if (!window.DoodleArt || typeof window.DoodleArt.extend !== 'function') return;
  window.DoodleArt.extend(({ def, L, OUT, DEEP, rotAbout, ellipse, spline, arc, rrect, bubble, pencil, dot }) => {

    /* 句子跟讀:站在樹枝上的鸚鵡(跟著說)。身體塗黃、彎鉤嘴留白、翅膀塗深黃,尾巴垂到樹枝下面。
       26px 灰線版只留身體、嘴、眼睛和樹枝 */
    def('parrot', '句子跟讀', '跟著說', (lvl, slim) => {
      const body = spline([[52, 11], [64, 14], [70, 26], [69, 44], [64, 60], [57, 71], [46, 82], [36, 94], [30, 90], [37, 72], [39, 52], [40, 30], [44, 17]], true, 6);
      const beak = spline([[67, 19], [77, 20], [84, 29], [82, 41], [77, 38], [74, 33], [68, 34]], true, 4);
      const ops = [{ line: [[12, 80], [50, 78.5], [92, 81.5]], w: L(lvl, 4, 3.4, 3.2) }];
      if (!slim) ops.push({ fill: body });
      ops.push({ out: body, jit: 0.8 });
      if (lvl) {
        const wing = spline([[46, 36], [58, 44], [60, 58], [52, 70], [42, 70], [42, 52]], true, 5);
        ops.push({ fill: wing, color: DEEP, R: 8 }, { out: wing, w: 2.6, jit: 0.5 });
        if (lvl === 2) ops.push({ line: [[46, 50], [54, 54]], w: 1.8, jit: 0.3 }, { line: [[45, 60], [53, 63]], w: 1.8, jit: 0.3 });
      }
      ops.push({ solid: beak, color: 'paper' }, { out: beak, w: L(lvl, 3.2, 3, 2.8), jit: 0.4 });
      ops.push(dot(57, 25, L(lvl, 3.8, 3.2, 2.8)));
      [[52, 72], [60, 68]].forEach(([x, y]) => ops.push({ line: [[x, y], [x + 0.5, 79], [x + 4.5, 82]], w: L(lvl, 3.2, 2.8, 2.6), jit: 0.25 }));
      return ops;
    });

    /* 句子聽寫:一隻耳朵加一支鉛筆(聽了寫下來)。耳朵塗黃、裡面一筆問號形的耳廓;鉛筆跟寫作練習同一支 */
    def('dictation', '句子聽寫', '聽了寫下來', (lvl, slim) => {
      const ear = spline([[34, 10], [50, 15], [57, 31], [54, 48], [46, 59], [42, 73], [35, 86], [24, 89], [16, 80], [13, 60], [13, 36], [20, 17]], true, 6);
      const ops = slim ? [] : [{ fill: ear }];
      ops.push({ out: ear, jit: 0.8 });
      ops.push({ line: spline(L(lvl, [[25, 44], [29, 31], [39, 27], [46, 35], [43, 47], [35, 54], [33, 66]],
        [[24, 42], [28, 30], [38, 25], [47, 33], [44, 46], [36, 52], [34, 63], [29, 69]],
        [[24, 42], [28, 30], [38, 25], [47, 33], [44, 46], [36, 52], [34, 63], [29, 69]]), false, 5), w: L(lvl, 3.6, 3.2, 3) });
      if (lvl === 2) ops.push({ line: spline([[31, 46], [33, 38], [39, 36], [40, 42]], false, 4), w: 2, jit: 0.3 });
      return ops.concat(pencil([65, 88], [93, 14], L(lvl, 8, 7.5, 7), L(lvl, 62, 64, 64), lvl));
    });

    /* 相似音辨析:兩個幾乎一樣的對話框,中間一個等號(聽起來一樣?)。兩框都塗黃,裡面三個點,右邊那個略歪 */
    def('soundalike', '相似音辨析', '聽出差別', (lvl, slim) => {
      const left = bubble(3, 25, 37, 62, 11, 13, 9, [7, 76]);
      const right = rotAbout(bubble(63, 25, 97, 62, 11, 87, 9, [93, 76]), 80, 44, 4);
      const ops = [];
      [left, right].forEach((b) => { if (!slim) ops.push({ fill: b, R: 12 }); ops.push({ out: b, jit: 0.8 }); });
      const r = L(lvl, 3.4, 3, 2.8);
      if (!slim) [[20, 44], [80, 44]].forEach(([cx, cy], i) => [-9, 0, 9].forEach((dx) => ops.push(dot(cx + dx, cy + (i ? dx * 0.07 : 0), r))));
      const ew = L(lvl, 4.6, 4, 3.6);
      ops.push({ line: [[44, 39], [56, 38.5]], w: ew, jit: 0.3 }, { line: [[44, 50], [56, 49.5]], w: ew, jit: 0.3 });
      return ops;
    });

    /* 數字與價格:三枚疊著的硬幣。每枚是扁的圓柱:頂面塗黃、側邊一圈塗深黃;64px 以上側邊有刻紋、頂面有內圈 */
    def('coins', '數字與價格', '數字和錢', (lvl, slim) => {
      const ops = [];
      const rx = 22, ry = 9.5, t = L(lvl, 10, 9, 9);
      [[58, 33], [31, 57], [68, 66]].forEach(([cx, cy]) => {
        const shape = [].concat(arc(cx, cy, rx, ry, 180, 360, 16), arc(cx, cy + t, rx, ry, 0, 180, 16));
        const band = [].concat(arc(cx, cy, rx, ry, 0, 180, 14), arc(cx, cy + t, rx, ry, 180, 0, 14));
        ops.push({ solid: shape, color: 'paper' });
        if (!slim) ops.push({ fill: shape, R: 10 }, ...(lvl ? [{ fill: band, color: DEEP, R: 5 }] : []));
        ops.push({ out: shape, w: L(lvl, 3.4, 3.2, 3), jit: 0.5 }, { line: arc(cx, cy, rx, ry, 4, 176, 12), w: L(lvl, 3, 2.8, 2.6), jit: 0.4 });
        if (lvl) ops.push({ out: ellipse(cx, cy, rx * 0.62, ry * 0.58, 16), w: 1.6, jit: 0.3 });
        if (lvl === 2) [30, 60, 90, 120, 150].forEach((a) => {
          const x = cx + Math.cos(a * Math.PI / 180) * rx, y = cy + Math.sin(a * Math.PI / 180) * ry;
          ops.push({ line: [[x, y + 1.5], [x, y + t - 1]], w: 1.4, jit: 0.2 });
        });
      });
      return ops;
    });

    /* 句子力:一支鉛筆畫出一條短線(寫一句)。只有鉛筆和線,沒有紙(跟寫作練習的「鉛筆在紙上寫」分開);
       筆身塗黃(這張圖沒有別的黃) */
    def('sentence', '句子力', '寫一句', (lvl) => {
      const tip = [44, 80];
      const ops = [{ line: [[6, 81], [16, 80], [28, 81.5], [tip[0] - 1, tip[1] + 0.5]], w: L(lvl, 4.4, 4, 3.8), jit: 0.4 }];
      if (lvl) ops.push(dot(6, 81, L(lvl, 0, 2.6, 2.4)));
      const pen = pencil(tip, [92, 12], L(lvl, 10, 9.5, 9), L(lvl, 66, 70, 70), lvl).map((op) => (op.color === DEEP ? { fill: op.fill, R: 10 } : op));
      return ops.concat(pen);
    });

    /* Email 力:一架紙飛機(寄出去)。上面那片翅膀塗黃、下面摺進去的那片塗深黃,左下兩三道速度線 */
    def('plane', 'Email 力', '寄出去', (lvl, slim) => {
      const N = [93, 15], A = [8, 47], B = [44, 57], C = [57, 89];
      const wing = [N, A, B], under = [N, B, C];
      const ops = [];
      if (!slim) ops.push({ fill: wing, R: 12 }, { fill: under, color: DEEP, R: 8 });
      ops.push({ out: wing, jit: 0.7 }, { out: under, w: OUT, jit: 0.7 });
      if (lvl) ops.push({ line: [B, [49, 66], [54, 72]], w: 2.2, jit: 0.3 });
      const sw = L(lvl, 3.6, 3.2, 3);
      L(lvl, [[[12, 70], [26, 63]], [[18, 84], [32, 77]]], [[[10, 68], [26, 61]], [[18, 82], [34, 74]]],
        [[[10, 68], [26, 61]], [[18, 82], [34, 74]], [[34, 92], [44, 87]]]).forEach((ln) => ops.push({ line: ln, w: sw, jit: 0.3 }));
      return ops;
    });

    /* 論述力:一顆燈泡加一支筆(有想法、寫成文章)。燈泡塗黃、燈座留白有螺紋;筆身塗黃、筆尖留白;
       36px 以上燈泡裡有燈絲、上面有光芒 */
    def('idea', '論述力', '想清楚再寫', (lvl, slim) => {
      const bulb = spline([[35, 13], [53, 19], [60, 37], [54, 54], [47, 64], [24, 64], [17, 54], [11, 37], [17, 19]], true, 6);
      const base = rrect(24, 64, 47, 79, 3), cap = rrect(29, 79, 42, 86, 3);
      const ops = [];
      if (!slim) ops.push({ fill: bulb });
      ops.push({ out: bulb, jit: 0.8 }, { solid: base, color: 'paper' }, { out: base, w: L(lvl, 3.2, 3, 2.8), jit: 0.4 }, { out: cap, w: L(lvl, 3.2, 3, 2.8), jit: 0.4 });
      if (lvl) {
        ops.push({ line: [[25, 71.5], [46, 71]], w: 2.2, jit: 0.3 });
        ops.push({ line: spline([[30, 63], [30, 48], [33, 44], [36, 49], [39, 44], [42, 48], [42, 63]], false, 4), w: 2.2, jit: 0.3 });
        [215, 270, 325].forEach((a) => {
          const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
          ops.push({ line: [[35 + c * 30, 38 + s * 31], [35 + c * 37, 38 + s * 38]], w: 2.8, jit: 0.2 });
        });
      }
      /* 筆:圓頭筆蓋、筆夾、筆身塗黃,尖頭留白、筆尖一點墨 */
      const T = (pts) => rotAbout(pts, 79, 52, 14);
      const pen = T([].concat(arc(79, 20, 8, 8, 180, 360, 8), [[87, 72], [79, 91], [71, 72]]));
      ops.push({ solid: pen, color: 'paper' });
      if (!slim) ops.push({ fill: T([[71, 20], [87, 20], [87, 72], [71, 72]]), R: 8 });
      ops.push({ out: pen, w: L(lvl, 3.4, 3.2, 3), jit: 0.5 }, { line: T([[71, 72], [87, 72]]), w: 2.8 });
      ops.push({ solid: T([[76.5, 85], [81.5, 85], [79, 91.5]]), color: 'ink' });
      if (lvl) ops.push({ line: T([[71, 34], [87, 34]]), w: 2.4 }, { line: T([[87, 20], [91, 22], [91, 46]]), w: 2.4, jit: 0.3 });
      return ops;
    });
  });
})();
