/* 小雞第二階段:電腦版到處走(規格 1.11;js/pet-roam-zones.js 加 js/pet-roam2.js)。
   用法:node tools/test_pet_roam_wide.js
   - 純計算:floorsOf(卡片上緣、整條橫幅當背景、標題右邊、頁尾上緣、兩側每邊最多 3 層)、zonesOf(同 1.4 的間隔、寬 96、高 59、
     可見範圍)、routeOf(走過去、小跳、努力飛 2.5 秒、落下、忙的時候只走和小跳)、choose(權重、最近去過的不去、起飛間隔)。
   - 模擬:一個很小的假瀏覽器(時鐘、計時器、requestAnimationFrame、elementsFromPoint、捲動、視窗大小、MutationObserver),
     把 js/pet-roam-zones.js 和 js/pet-roam2.js 原樣載入,用固定種子的亂數跑幾分鐘,檢查:會換好幾塊空地、停著和走著時不碰到障礙、
     不瞬間移動、移動中點擊穿過、餓和睡在地面、減少動態和關掉走動不動、滑鼠移上去停下、忙的時候不起飛、只在該量的時候量、
     寬度跨過 1024 回地面。
   - App 模式、860 以下和 861 到 1023 的網站模式:跟 f94cec7 那一版的 js/pet-roam2.js 用同一個種子跑,每 100 毫秒的位置、
     姿勢、class 完全一樣。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = (f) => { try { return fs.readFileSync(path.join(REPO, f), 'utf8'); } catch (e) { return ''; } };
const ROAM = read('js/pet-roam2.js'), ZONES = read('js/pet-roam-zones.js');
let OLD = '';
try { OLD = execFileSync('git', ['-C', REPO, 'show', 'f94cec7:js/pet-roam2.js'], { encoding: 'utf8' }); } catch (e) { OLD = ''; }
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.log('FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 400) : ''));
}
function run(name, f) { try { f(); } catch (e) { fail++; console.log('FAIL ' + name + ' 丟錯: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } }

const { ART, nodeLoad, mulberry, S, BOXH, ob, hitBox, CS0, WHITE, sim, learnPage, supported, obstaclesNow, wideSim } = require('./pet_roam_sim.js');   // 假瀏覽器、引擎資料
let Z = null, RU = null;
try { Z = nodeLoad(ZONES); } catch (e) { Z = null; }
try { RU = nodeLoad(ROAM).util; } catch (e) { RU = null; }
ok(ZONES.length > 0 && !!Z && !!Z.CFG && typeof Z.zonesOf === 'function', 'js/pet-roam-zones.js 存在,node 拿得到');
ok(!!OLD, '拿得到 f94cec7 的 js/pet-roam2.js(比對 App 模式、窄螢幕)');

/* ---------- 純計算 ---------- */
run('floorsOf', () => {
  const ctx = { W: 1440, S, gap: 16, mainL: 200, mainR: 1240 };
  const cards = [ob(200, 150, 710, 420, 'c'), ob(200, 440, 710, 640, 'c'), ob(200, 700, 710, 760, 'c'), ob(200, 800, 710, 860, 'c'), ob(0, 60, 1440, 300, 'c')];
  const fl = Z.floorsOf(cards.concat([ob(730, 150, 1240, 420, 'i'), ob(0, 1000, 1440, 1100, 'c'), ob(200, 84, 420, 120, 't')]), { heads: [{ left: 200, top: 80, right: 1240, bottom: 124 }], foot: { left: 0, top: 1000, right: 1440, bottom: 1100 },
    bands: [{ left: 0, top: 60, right: 1440, bottom: 300 }] }, ctx);
  const has = (y, l, r) => fl.some((f) => Math.abs(f.y - y) < 1 && (l === undefined || Math.abs(f.l - l) < 1) && (r === undefined || Math.abs(f.r - r) < 1));
  ok(has(150, 208, 702) && has(440, 208, 702), '卡片上緣是地板(兩邊各縮 8 px)', fl);
  ok(!fl.some((f) => Math.abs(f.y - 150) < 1 && f.l >= 730 && f.l < 1240), '可以點的卡片上緣不是地板');
  ok(has(300, 16, 1424), '有底色、寬度超過視窗 90% 的整條橫幅:下緣當地板(整條)');
  ok(!has(1100), '只有上框線的頁尾(寬,沒有底色):下緣不是地板(會站在頁尾裡、半空)');
  ok(has(124, 200, 420 + Z.CFG.titleRun) && !fl.some((f) => Math.abs(f.y - 124) < 1 && f.r > 420 + Z.CFG.titleRun + 1), '標題下緣:只到標題文字右邊 ' + Z.CFG.titleRun + ' px(不往右延伸到卡片那一排上面的半空)', fl.filter((f) => Math.abs(f.y - 124) < 1));
  const inl = Z.floorsOf([], { heads: [{ left: 200, top: 80, right: 252, bottom: 124 }], foot: null }, ctx);
  ok(inl.length === 1 && inl[0].l === 200 && inl[0].r === 252 + Z.CFG.titleRun, '標題沒有量到文字(inline-block 的標題):從標題外框右邊算', inl);
  ok(has(1000, 16, 1424), '頁尾上緣:整條');
  const left = fl.filter((f) => f.r <= 200 + 1), right = fl.filter((f) => f.l >= 1240 - 1);
  ok(left.length >= 1 && left.length <= 3 && right.length >= 1 && right.length <= 3, '兩側每邊最多 3 層', { left: left.length, right: right.length });
  ok(left.every((f) => f.l === 16 && f.r === 200 - 8) && right.every((f) => f.l === 1240 + 8 && f.r === 1440 - 16), '兩側的地板:視窗那邊留 16 px、主要內容那邊 8 px(規格 1.11 量的 1280 兩側 96 寬)', left.concat(right));
  ok(Z.floorsOf(cards, { heads: [], foot: null }, Object.assign({}, ctx, { mainL: 120, mainR: 1320 })).every((f) => !(f.r <= 120 + 1) || f.r - f.l >= 0), '窄的兩側不出錯');
  const links = [ob(200, 150, 710, 420, 'i'), ob(730, 150, 1240, 420, 'i'), ob(200, 520, 710, 760, 'i'), ob(300, 900, 400, 940, 'i')];
  const lf = Z.floorsOf(links, { heads: [], foot: null }, ctx), lside = lf.filter((f) => f.r <= 200 + 1);
  ok(lside.length >= 2 && lside.some((f) => f.y === 150) && lside.some((f) => f.y === 520 || f.y === 420), '整排都是可以點的卡片(學習、刷題、首頁):兩側也借卡片的上下緣', lside);
  ok(!lf.some((f) => Math.abs(f.y - 900) < 1 || Math.abs(f.y - 940) < 1), '小按鈕(寬 160、高 48 以下)不借', lf);
  ok(!lf.some((f) => f.l >= 200 && f.r <= 1240 && f.y === 150), '可以點的卡片上緣還是不能站', lf);
  const clean = Z.cleanObs(cards, ctx);
  ok(!clean.some((o) => o.r - o.l > 0.9 * 1440) && clean.length === cards.length - 1, '整條橫幅不當障礙(裡面的字和按鈕另外算)');
});
const ZC = (o) => Object.assign({ W: 1440, S, BOXH, gap: 16, top: 59, bottom: 896 - BOXH - 8, scrollY: 0, mainL: 200, mainR: 1240, freeSpans: RU && RU.freeSpans }, o || {});
run('zonesOf', () => {
  const obs = [ob(200, 84, 420, 120, 't'), ob(200, 150, 710, 420, 'c'), ob(730, 150, 1240, 420, 'i'), ob(224, 170, 500, 190, 't'), ob(224, 360, 400, 400, 'i')];
  const floors = [{ y: 124, l: 200, r: 1424, k: 'h' }, { y: 150, l: 208, r: 702 }, { y: 420, l: 16, r: 184 }, { y: 30, l: 16, r: 1424 }, { y: 860, l: 16, r: 1424 }];
  const zs = Z.zonesOf(obs, floors, ZC());
  const at = (y) => zs.filter((z) => Math.abs(z.feetDoc - y) < 1);
  ok(at(124).length === 1 && at(124)[0].lo >= 700 && at(124)[0].hi === 1424 - S, '標題右邊:避開標題文字 4 px,右邊到視窗 16 px;跟下面卡片上緣的空地重疊的那段不要(差不到 64 px)', at(124));
  ok(at(150).length === 1 && at(150)[0].lo >= 424 && at(150)[0].hi <= 654, '站在卡片上緣:那張卡片不擋,上面的標題文字擋', at(150));
  ok(at(420).length === 1 && at(420)[0].kind === 'side-L', '左側的地板:side-L', at(420));
  ok(at(30).length === 0, '被頂欄蓋住的不算');
  ok(at(860).length === 0, '離地面太近(視窗下緣往上 59 px 內)的不算');
  ok(zs.every((z) => z.hi - z.lo >= 48), '寬 96 以上(至少走得動 48 px)');
  let bad = [];
  for (const z of zs) for (let x = z.lo; x <= z.hi; x += 4) for (const o of obs) {
    const stand = o.k === 'c' && Math.abs(o.t - z.feetDoc) < 1.5;
    if (!stand && hitBox(o, x, z.feetDoc - BOXH, z.feetDoc)) bad.push([z.key, x, o]);
  }
  eq0(bad, '空地裡每個位置都不碰到障礙(可以點的 8 px、文字卡片 4 px)');
  const tall = Z.zonesOf([ob(500, 100, 600, 118, 'i')], [{ y: 170, l: 400, r: 800 }], ZC());
  ok(tall.every((z) => z.lo >= 600 + 8 || z.hi + S <= 500 - 8), '高 59 以上:框上方 8 px 內有按鈕的位置不算', tall);
  const sc = Z.zonesOf(obs, floors, ZC({ scrollY: 300 }));
  ok(sc.every((z) => Math.abs(z.feetDoc - z.y - 300) < 0.01), '空地記文件座標(跟著內容捲)', sc.slice(0, 2));
  ok(new Set(zs.map((z) => z.key)).size === zs.length, '每塊空地有自己的 key');
});
function eq0(list, name) { ok(list.length === 0, name, list.slice(0, 3)); }
const FF = (d, m) => RU.flyFrames(d, ART.flyPlan, m);
run('routeOf', () => {
  const R = (from, to, tx, busy) => Z.routeOf(from, to, tx, { busy: !!busy, flyFrames: FF, S });
  const A = { feet: 300, lo: 100, hi: 300, x: 200 }, G = { feet: 896, lo: 16, hi: 1376, x: 600, ground: true };
  ok((R(A, { feet: 300, lo: 352, hi: 600 }, 352) || {}).how === 'walk', '同一條地板、中間 8 px 以內:走過去');
  ok((R(A, { feet: 300, lo: 420, hi: 600 }, 420) || {}).how !== 'walk', '中間超過 8 px:不走');
  const hop = R(Object.assign({}, A, { x: 300 }), { feet: 260, lo: 400, hi: 600 }, 370);
  ok(hop && hop.how === 'hop' && Math.abs(hop.dur - 0.4) < 1e-9, '高低差 64 以內、空隙 80 以內:小跳 0.4 秒', hop);
  ok((R(Object.assign({}, A, { x: 300 }), { feet: 220, lo: 400, hi: 600 }, 370) || {}).how === 'fly', '高低差超過 64:努力飛');
  const up = R(G, { feet: 124, lo: 424, hi: 1376 }, 700);
  ok(up && up.how === 'fly' && up.dur <= 2.5 + 1e-9, '從地面往上飛,2.5 秒內', up);
  ok(R(Object.assign({}, G, { x: 16 }), { feet: 400, lo: 1256, hi: 1376 }, 1300) === null, '橫移超過每秒 400 px × 2.5 秒:到不了');
  const lvl = R(A, { feet: 290, lo: 800, hi: 1000 }, 800);
  ok(lvl && lvl.how === 'fly' && Math.abs(lvl.dur - 1.5) < 1e-9, '平飛:橫移每秒 400 px', lvl);
  const dn = R(A, { feet: 600, lo: 100, hi: 300 }, 200);
  ok(dn && dn.how === 'fall' && dn.dur <= 1.2 + 1e-9, '往下:撲著翅膀落下,最多 1.2 秒', dn);
  ok((R(A, G, 200) || {}).how === 'fall', '回地面:落下');
  ok(R(G, G, 200) === null, '已經在地面:不用動');
  ok(R(A, { feet: 290, lo: 800, hi: 1000 }, 800, true) === null && R(A, G, 200, true) === null, '忙的時候:不起飛、不落下');
  ok((R(A, { feet: 300, lo: 352, hi: 600 }, 352, true) || {}).how === 'walk' && (R(Object.assign({}, A, { x: 300 }), { feet: 260, lo: 400, hi: 600 }, 370, true) || {}).how === 'hop', '忙的時候:還是可以走過去、小跳到隔壁');
});
run('choose', () => {
  const zones = [{ key: 'a', kind: 'main', feetDoc: 124, lo: 424, hi: 1376 }, { key: 'b', kind: 'side-L', feetDoc: 420, lo: 16, hi: 136 },
    { key: 'c', kind: 'side-R', feetDoc: 420, lo: 1256, hi: 1376 }, { key: 'd', kind: 'main', feetDoc: 150, lo: 424, hi: 654 }];
  const ground = { key: 'ground', feet: 896, lo: 16, hi: 1376, ground: true };
  const base = (o) => Object.assign({ zones, here: Object.assign({ x: 600 }, ground), ground, now: 100000, busy: false, calm: 60000, near: [], lastFly: -1e9,
    recent: [], H: 900, top: 59, bottom: 837, scrollY: 0, S, flyFrames: FF }, o);
  const pick = (o, n) => { const rnd = mulberry(7), out = {}; for (let i = 0; i < (n || 400); i++) { const d = Z.choose(base(Object.assign({ rnd }, o))); const k = d ? d.z.key : 'none'; out[k] = (out[k] || 0) + 1; } return out; };
  const p0 = pick({});
  ok(!p0.ground && !p0.none && p0.a > 0 && p0.b > 0 && p0.c > 0, '在地面:去各塊空地,不選自己', p0);
  const p1 = pick({ recent: ['a', 'b'] });
  ok(!p1.a && !p1.b, '最近去過的 2 塊不去', p1);
  const p2 = pick({ lastFly: 100000 - 5000 });
  ok(Object.keys(p2).every((k) => k === 'none'), '上次起飛不到 20 秒:不起飛', p2);
  const p3 = pick({ calm: 3000 });
  ok(Object.keys(p3).every((k) => k === 'none'), '不忙還不到 8 秒:不起飛', p3);
  const p4 = pick({ near: [80] }, 2000), p5 = pick({}, 2000);
  ok(p4.b < p5.b * 0.5, '學生正在用的地方旁邊 240 px 內:少去(× 0.2)', { near: p4.b, far: p5.b });
  const inZone = { key: 'd', x: 500, feet: 150, lo: 424, hi: 654 };
  const p6 = pick({ here: inZone, busy: true, calm: 0 });
  ok(Object.keys(p6).every((k) => k === 'none' || k === 'a'), '忙的時候:只小跳到隔壁', p6);
  const p7 = pick({ here: inZone });
  ok(p7.ground > 0, '在空地上:地面也是一個選項', p7);
  const d = Z.choose(base({ rnd: mulberry(3) }));
  ok(d && d.tx >= d.z.lo && d.tx <= d.z.hi && typeof d.how === 'string' && d.dur > 0, '決定裡有目的地 x、方式、時間', d);
  const off = Z.choose(base({ rnd: mulberry(3), scrollY: 2000 }));
  ok(!off || off.z.ground, '捲出可見範圍的空地不去', off);
});

run('zonesOf:上下差不到 64 px、左右重疊的兩塊算同一個地方,留真的邊', () => {
  const fl = [{ y: 244, l: 16, r: 184, k: 's' }, { y: 274, l: 16, r: 1424, k: 'f' }, { y: 139, l: 200, r: 600, k: 'h' }, { y: 163, l: 208, r: 702, k: 'c' },
    { y: 520, l: 16, r: 184, k: 's' }, { y: 560, l: 1256, r: 1424, k: 's' }];
  const obs = [ob(200, 100, 260, 135, 't'), ob(200, 163, 710, 230, 'c'), ob(730, 163, 1240, 230, 'i'), ob(200, 280, 1240, 300, 't')];
  const zs = Z.zonesOf(obs, fl, ZC({ bottom: 837 }));
  const L = zs.filter((z) => z.kind === 'side-L').map((z) => Math.round(z.feetDoc));
  ok(L.includes(274) && !L.includes(244), '左側:卡片下緣 244 和頁尾上緣 274 差 30 px:只留頁尾那一塊', zs);
  ok(!zs.some((z) => Math.abs(z.feetDoc - 139) < 1 && z.lo < 400 && z.hi + S > 208), '標題 139 和卡片上緣 163 差 24 px 又左右重疊:那段只留卡片上緣', zs);
  ok(L.includes(520) && zs.some((z) => z.kind === 'side-R' && Math.abs(z.feetDoc - 560) < 1), '差 40 px 但一左一右(不重疊):兩塊都留', zs);
  for (const a of zs) for (const b of zs) if (a !== b && Math.abs(a.feetDoc - b.feetDoc) < 64) ok(a.hi + S <= b.lo || b.hi + S <= a.lo, '任兩塊上下差不到 64 px 時左右不重疊', [a, b]);
});
run('choose:只有一塊空地的頁面,地面和那塊一直輪流(不卡在地面)', () => {
  const zones = [{ key: 'main:139:176', kind: 'main', feetDoc: 139, lo: 176, hi: 400 }];
  const ground = { key: 'ground', feet: 750, lo: 16, hi: 1216, ground: true };
  const m = Z.memory(0), rnd = mulberry(5), seq = [];
  let here = Object.assign({ x: 300 }, ground);
  for (let i = 0; i < 12; i++) {
    const d = Z.choose({ zones, here, ground, now: 100000 + i * 60000, busy: false, calm: 60000, near: [], lastFly: -1e9, recent: m.recent, H: 800, top: 59, bottom: 690, scrollY: 0, S, BOXH, flyFrames: FF, rnd });
    seq.push(d ? d.z.key : 'none');
    if (!d) continue;
    Z.arrived(m, d.z.key, 100000 + i * 60000, rnd);
    here = d.z.ground ? Object.assign({ x: d.tx }, ground) : { key: d.z.key, kind: d.z.kind, x: d.tx, feet: d.z.feetDoc, lo: d.z.lo, hi: d.z.hi };
  }
  ok(!seq.includes('none') && seq.filter((k) => k !== 'ground').length >= 5, '12 次都有地方去,一半去那塊空地', seq);
  ok(m.recent.indexOf('ground') < 0, '地面不佔「最近去過」的位子', m.recent);
  const two = Z.choose({ zones: zones.concat([{ key: 'side-L:300:16', kind: 'side-L', feetDoc: 300, lo: 16, hi: 120 }]), here: Object.assign({ x: 300 }, ground), ground, now: 1e7, busy: false, calm: 60000, near: [],
    lastFly: -1e9, recent: ['side-L:300:16', 'main:139:176'], H: 800, top: 59, bottom: 690, scrollY: 0, S, BOXH, flyFrames: FF, rnd: mulberry(2) });
  ok(two && two.z.key === 'main:139:176', '每塊都剛去過:挑最久沒去的那塊', two && two.z.key);
});
run('choose:滑鼠在主要內容裡動,只擋經過滑鼠附近 240 px 的起飛和落下', () => {
  const zones = [{ key: 'a', kind: 'main', feetDoc: 124, lo: 640, hi: 760 }, { key: 'b', kind: 'side-L', feetDoc: 420, lo: 16, hi: 136 }];
  const ground = { key: 'ground', feet: 896, lo: 16, hi: 1376, ground: true };
  const base = (o) => Object.assign({ zones, here: Object.assign({ x: 100 }, ground), ground, now: 100000, busy: false, calm: 60000, near: [], lastFly: -1e9,
    recent: [], H: 900, top: 59, bottom: 837, scrollY: 0, S, BOXH, flyFrames: FF }, o);
  const pick = (o) => { const rnd = mulberry(9), out = {}; for (let i = 0; i < 300; i++) { const d = Z.choose(base(Object.assign({ rnd }, o))); const k = d ? d.z.key : 'none'; out[k] = (out[k] || 0) + 1; } return out; };
  const p1 = pick({ mouse: 700 });
  ok(!p1.a && p1.b > 0, '滑鼠在 x 700:不飛去滑鼠旁邊那塊,飛去左側可以', p1);
  const p2 = pick({ mouse: 200 });
  ok(!p2.a && !p2.b, '滑鼠在 x 200:從 x 100 起飛的都經過滑鼠附近,不飛', p2);
  const p3 = pick({ mouse: 700, here: { key: 'a', kind: 'main', x: 700, feet: 124, lo: 640, hi: 760 } });
  ok(!p3.ground && !p3.b, '站在滑鼠旁邊的空地上:不落下、不起飛', p3);
  const p4 = pick({ mouse: null });
  ok(p4.a > 0 && p4.b > 0, '滑鼠沒在主要內容裡動:照常', p4);
});
run('tracker:滑鼠在主要內容裡動不算整個忙,只記位置 5 秒', () => {
  const on = {}, won = {};
  const win = { addEventListener: (t, f) => { won[t] = f; }, setTimeout: () => 1, clearTimeout() {}, getSelection: () => ({ isCollapsed: true, rangeCount: 0 }) };
  const doc = { addEventListener: (t, f) => { on[t] = f; }, activeElement: null, body: {} };
  let now = 0;
  const T = Z.tracker(win, doc, { now: () => now, mainLR: () => ({ l: 200, r: 1240 }), box: () => null, hover() {} });
  now = 100000; on.pointermove({ clientX: 700, clientY: 400, pointerType: 'mouse' });
  now = 101000;
  ok(!T.busy(now) && T.calm(now) >= 8000 && T.pointer(now) === 700, '剛動過滑鼠:不忙、calm 照按鍵和捲動算、pointer 是 700', { busy: T.busy(now), calm: T.calm(now), p: T.pointer(now) });
  now = 106500;
  ok(T.pointer(now) === null, '5 秒沒動:pointer 沒了', T.pointer(now));
  on.pointermove({ clientX: 100, clientY: 400, pointerType: 'mouse' });
  ok(T.pointer(now) === null, '滑鼠在兩側動:不算', T.pointer(now));
  on.keydown({ key: 'a' });
  ok(T.busy(now) && T.calm(now) === 0, '按鍵:忙', T.calm(now));
});
run('tracker:滑鼠停在飛走的小雞上不動,小雞離開滑鼠底下以後 1 秒內放開(第二輪審查 #1)', () => {
  const on = {}, timers = [];
  let now = 0, b = { l: 600, t: 800, w: 48, h: 51 };
  const win = { addEventListener() {}, setTimeout: (f, ms) => { timers.push({ f, at: now + ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].dead = true; },
    getSelection: () => ({ isCollapsed: true, rangeCount: 0 }) };
  const doc = { addEventListener: (t, f) => { on[t] = f; }, activeElement: null, body: {} };
  const hov = [], last = () => hov[hov.length - 1];
  Z.tracker(win, doc, { now: () => now, mainLR: () => null, box: () => b, hover: (v) => hov.push(v) });
  const adv = (ms) => { const end = now + ms; for (;;) { const t = timers.filter((q) => !q.dead && q.at <= end).sort((p, q) => p.at - q.at)[0]; if (!t) break; t.dead = true; now = t.at; t.f(); } now = end; };
  on.pointermove({ clientX: 620, clientY: 820, pointerType: 'mouse' });
  ok(last() === true, '滑鼠移到小雞上:hover(true)', hov);
  adv(3000);
  ok(last() === true, '小雞還在滑鼠底下、滑鼠不動:一直停著', hov);
  b = { l: 140, t: 200, w: 48, h: 51 };   // 飛到別的地方了,滑鼠沒動
  adv(1100);
  ok(last() === false, '小雞不在滑鼠底下了(滑鼠沒動):1 秒內放開', hov);
  b = { l: 600, t: 800, w: 48, h: 51 };
  on.pointermove({ clientX: 620, clientY: 820, pointerType: 'mouse' });
  adv(900);
  on.pointermove({ clientX: 10, clientY: 10, pointerType: 'mouse' });
  adv(500);
  ok(last() === true, '滑鼠移開 0.5 秒:還停著(照舊移開 1 秒後再走)', hov);
  adv(600);
  ok(last() === false, '滑鼠移開 1 秒:放開', hov);
});
run('zonesOf:1280 的寬版頁(主要內容 120 到 1160)兩側還是空地,有捲軸(1263)也是(第二輪審查 #2)', () => {
  for (const [W, L] of [[1280, 120], [1263, 111.5]]) {
    const R = W - L, ctx = ZC({ W, mainL: L, mainR: R, bottom: 800 - 4 - BOXH - 8 });
    for (const [name, k] of [['學習', 'c'], ['首頁、刷題', 'i']]) {
      const M = (L + R) / 2;
      const obs = [ob(L, 84, L + 220, 120, 't'), ob(L, 150, M - 10, 420, k), ob(M + 10, 150, R, 420, 'i'), ob(L, 440, M - 10, 640, k)];
      const zs = Z.zonesOf(obs, Z.floorsOf(obs, { heads: [{ left: L, top: 80, right: R, bottom: 124 }], foot: null }, ctx), ctx);
      const sl = zs.filter((z) => z.kind === 'side-L'), sr = zs.filter((z) => z.kind === 'side-R');
      ok(sl.length >= 2 && sr.length >= 2, W + ' ' + name + ':兩側各有 2 塊以上的空地', zs);
      ok(sl.concat(sr).every((z) => z.lo >= 16 && z.hi + S <= W - 16 && (z.kind === 'side-L' ? z.hi + S <= L - 8 : z.lo >= R + 8)), W + ' ' + name + ':兩側的空地離視窗邊 16 px、離主要內容 8 px', sl.concat(sr));
      if (W === 1280) ok(sl.every((z) => z.hi - z.lo >= 48), '1280:兩側走得動 48 px(規格 1.11)', sl);
      let bad = [];
      for (const z of zs) for (let x = z.lo; x <= z.hi; x += 2) for (const o of obs) if (!(o.k === 'c' && Math.abs(o.t - z.feetDoc) < 1.5) && hitBox(o, x, z.feetDoc - BOXH, z.feetDoc)) bad.push([z.key, x, o]);
      eq0(bad, W + ' ' + name + ':空地裡每個位置都不碰到障礙');
    }
  }
});
run('stroll:窄的空地多半站著,走也是短短一段、往空的那邊走', () => {
  const count = (sp, x) => { const rnd = mulberry(4), c = { idle: 0, walk: 0, run: 0, toward: 0, n: 0 }; for (let i = 0; i < 2000; i++) { const a = Z.stroll(sp, x, rnd); c[a.pose]++; if (a.pose === 'walk') { c.n++; if ((a.dir > 0) === (sp[1] - x > x - sp[0])) c.toward++; } } return c; };
  const nar = count([16, 136], 30), roomy = count([200, 900], 500);
  ok(nar.idle / 2000 >= 0.7 && nar.run === 0, '寬 120 的空地:站著 7 成以上,不跑', nar);
  ok(nar.toward === nar.n, '窄的空地:往空間多的那邊走', nar);
  ok(roomy.walk / 2000 >= 0.25 && roomy.idle / 2000 >= 0.5 && roomy.run === 0, '寬 700 的空地:站多走少', roomy);
  const a = Z.stroll([16, 136], 30, mulberry(1));
  ok(a.left > 0 && (a.pose !== 'walk' || a.dir === 1 || a.dir === -1), 'stroll 回 { pose, left, dir }', a);
});

/* ---------- 模擬:電腦版到處走 ---------- */
run('電腦版:幾分鐘內換好幾塊空地,停著和走著都不碰到障礙,不瞬間移動,移動中點擊穿過', () => {
  for (const seed of [1, 2, 3]) {
    const zones = new Set(), hits = [], jumps = [], taps = [], flights = [], floating = [];
    let prev = null, rest = 0, flyT = 0, changes = 0, lastZone = null, sgn = 0, flips = 0, zoneT = 0;
    const each = (P) => {
      const s = P.R(); if (!s) return;
      const b = P.box();
      if (s.zone && s.zone !== 'ground') zones.add(s.zone);
      if (s.zone !== lastZone) { if (lastZone !== null) changes++; lastZone = s.zone; }
      const moving = !!s.move || s.flying || s.pose === 'walk' || s.pose === 'run';
      if (!s.flying && !s.move) for (const q of obstaclesNow(P)) {
        const stand = q.k === 'c' && Math.abs(q.t - b.b) < 1.5;
        if (!stand && hitBox(q, b.l, b.t, b.b)) { hits.push({ t: P.st.t, b, q, s }); break; }
      }
      if (!s.flying && !s.move && !s.ground && !supported(P, b)) floating.push({ t: P.st.t, b, zone: s.zone });
      if (prev && (Math.abs(b.l - prev.l) > 40 || Math.abs(b.t - prev.t) > 80)) jumps.push({ t: P.st.t, prev, b, s });
      if (moving && P.tappable()) taps.push({ t: P.st.t, s });
      if (!moving && P.tappable()) rest++;
      if (s.flying) flyT += 16; else if (flyT) { flights.push(flyT); flyT = 0; }
      if (s.zone !== 'ground' && !s.move && !s.flying && prev) { zoneT += 16; const d = Math.sign(b.l - prev.l); if (d && sgn && d !== sgn) flips++; if (d) sgn = d; } else sgn = 0;
      prev = b;
    };
    const P = wideSim({ seed, each });
    P.step(5 * 60 * 1000);
    const s = P.R() || {};
    ok(s.wide === true, '#' + seed + ' 1440 寬的學習頁:state.wide', s);
    ok(zones.size >= 2 && changes >= 4, '#' + seed + ' 5 分鐘內去過 2 塊以上的空地、換地方 4 次以上', { zones: [...zones], changes });
    eq0(hits, '#' + seed + ' 停著和走著時小雞框不碰到障礙');
    eq0(jumps, '#' + seed + ' 每一格的位移連續(不瞬間移動)');
    eq0(floating, '#' + seed + ' 停在空地上時腳下 12 px 內有真的邊(不站在半空)');
    eq0(taps, '#' + seed + ' 走、跳、飛的時候點擊穿過');
    ok(rest > 100, '#' + seed + ' 停著的時候點得到', rest);
    ok(flights.every((ms) => ms <= (2.5 + 1.6) * 1000), '#' + seed + ' 每次飛行(含起飛、落地)不超過 2.5 秒加起落', flights);
    ok(zoneT < 30000 || flips / (zoneT / 60000) <= 3, '#' + seed + ' 在空地上多半站著:每分鐘轉身 3 次以內', { flips, min: zoneT / 60000 });
  }
});
/* 只有標題右邊一塊空地的頁面(1100 寬,卡片都可以點、兩側 80 px 太窄(扣掉間隔只剩 56)、頁尾在視窗外) */
function oneZonePage(add) {
  add(null, 'header', { cls: 'topbar', box: [0, 0, 1100, 59], fixed: true, style: WHITE });
  const main = add(null, 'main', { box: [80, 59, 1020, 1400] });
  add(main, 'h1', { box: [80, 80, 1020, 124], texts: [[80, 84, 160, 120]] });
  for (const [l, t, r, b] of [[80, 150, 540, 420], [560, 150, 1020, 420], [80, 440, 540, 700], [560, 440, 1020, 700]]) add(main, 'a', { attrs: { href: 'x.html' }, box: [l, t, r, b], style: Object.assign({ cursor: 'pointer' }, WHITE) });
  add(null, 'footer', { box: [0, 1500, 1100, 1700], style: { borderTopWidth: '1px', borderTopStyle: 'solid' } });
  return {};
}
run('電腦版:只有一塊空地的頁面,5 分鐘裡地面和那塊一直輪流', () => {
  let visits = 0, last = null, ground = 0, n = 0;
  const P = sim({ src: ROAM, zones: ZONES, W: 1100, H: 800, page: 'learn.html', build: oneZonePage, seed: 13, each: (Q) => { const s = Q.R(); if (!s) return; n++; if (s.ground) ground++; if (s.zone !== last) { if (s.zone && s.zone !== 'ground') visits++; last = s.zone; } } });
  P.step(5 * 60 * 1000);
  ok(P.R().zones === 1, '這頁量到 1 塊空地', P.R());
  ok(visits >= 3 && ground / n < 0.85, '去那塊 3 次以上、在地面不到 85%', { visits, ground: ground / n });
});
run('電腦版:餓了攤平在地面、睡覺在地面睡,不去別的空地', () => {
  for (const mood of ['hungry', 'sleep']) {
    let up = 0;
    const P = wideSim({ seed: 4, ui: { mood, hungry: mood === 'hungry' }, each: (Q) => { const s = Q.R(); if (s && (!s.ground || s.flying)) up++; } });
    P.step(3 * 60 * 1000);
    ok(up === 0 && P.R().ground && P.anim.pose === mood || (mood === 'hungry' && up === 0 && ['hungry', 'walk', 'idle'].includes(P.anim.pose)), mood + ':3 分鐘都在地面', { up, pose: P.anim.pose });
  }
  const P = wideSim({ seed: 5 });
  let t = 0;
  while (t < 5 * 60 * 1000 && !(P.R().zone && P.R().zone !== 'ground' && !P.R().move && !P.R().flying)) { P.step(500); t += 500; }
  const inZone = P.R().zone !== 'ground';
  P.ui.mood = 'hungry'; P.ui.hungry = true; P.change({});
  P.step(4000);
  ok(inZone && P.R().ground === true && P.R().zone === 'ground', '在空地上變餓:落回地面', { inZone, s: P.R() });
});
run('電腦版:減少動態、關掉「小雞在頁面上走動」:停在地面不動', () => {
  for (const ui of [{ reduced: true }, { roam: false }]) {
    const xs = new Set();
    const P = wideSim({ seed: 6, ui, each: (Q) => { const s = Q.R(); if (s) xs.add(Q.trace().split('|')[0] + (s.ground ? '' : 'air')); } });
    P.step(3 * 60 * 1000);
    ok(xs.size <= 2 && P.R().ground && P.R().still, JSON.stringify(ui) + ':3 分鐘都在同一個位置', [...xs].slice(0, 4));
  }
});
run('電腦版:滑鼠移到走動中的小雞上,當場停下、點得到;移開 1 秒後再走', () => {
  const P = wideSim({ seed: 7 });
  let t = 0;
  while (t < 120000 && !(P.R().pose === 'walk' && !P.R().flying && !P.R().move)) { P.step(100); t += 100; }
  ok(P.R().pose === 'walk' && !P.tappable(), '找到走動中的小雞(點擊穿過)', P.R());
  const b = P.box();
  P.fireDoc('pointermove', { clientX: b.l + 24, clientY: b.t + 25, pointerType: 'mouse' });
  P.step(50);
  const x0 = P.box().l;
  P.step(1000);
  ok(P.tappable() && P.anim.pose !== 'walk' && Math.abs(P.box().l - x0) < 0.5, '滑鼠在牠身上:停下、點得到', { pose: P.anim.pose, tap: P.tappable(), dx: P.box().l - x0 });
  P.fireDoc('pointermove', { clientX: 5, clientY: 5, pointerType: 'mouse' });
  P.step(500);
  const still = P.anim.pose !== 'walk' && P.tappable();
  P.step(30000);
  ok(still && Math.abs(P.box().l - x0) > 1, '移開 0.5 秒還停著,之後再走', { still, dx: P.box().l - x0 });
});
run('電腦版:學生在打字、捲動、滑鼠在主要內容裡動時不起飛;閒下來 8 秒以後才起飛', () => {
  let flyStart = [];
  let was = false;
  const P = wideSim({ seed: 8, each: (Q) => { const s = Q.R(); const f = !!(s && s.flying && s.move === 'fly'); if (f && !was) flyStart.push(Q.st.t); was = f; } });
  for (let i = 0; i < 24; i++) { P.fireDoc('keydown', { key: 'a' }); P.step(5000); }   // 2 分鐘一直在打字
  const busyFlights = flyStart.filter((t) => t < 115000 + 20000 + 8000);
  ok(busyFlights.length === 0, '一直按鍵(20 秒內按過):不起飛', busyFlights);
  P.step(4 * 60 * 1000);
  ok(flyStart.length > 0, '不忙以後照常起飛', flyStart.length);
  /* 滑鼠在主要內容裡、離小雞現在的位置遠的那一邊(小雞就停在滑鼠旁邊時,本來就不從滑鼠旁邊飛走) */
  const near = [], t0 = P.st.t, mx = P.box().l + 24 < 720 ? 1150 : 290;
  let moves = 0, z0 = P.R().zone;
  for (let i = 0; i < 60; i++) {
    P.fireDoc('pointermove', { clientX: mx, clientY: 500, pointerType: 'mouse' });
    for (let k = 0; k < 125; k++) {
      P.step(16);
      const s = P.R(), b = P.box();
      if (s.zone !== z0) { moves++; z0 = s.zone; }
      if (P.st.t - t0 > 3000 && (s.move === 'fly' || s.move === 'fall') && Math.max(b.l - mx, mx - b.r, 0) <= 240) near.push({ t: P.st.t, b, move: s.move });
    }
  }
  eq0(near, '滑鼠在主要內容 x ' + mx + ' 一直動:不飛、不落到滑鼠旁邊 240 px 內');
  ok(moves >= 1, '滑鼠一直動的 2 分鐘裡,離滑鼠遠的地方照常換(不被釘在地面)', moves);
});
run('電腦版:空地只在捲動停下、視窗大小改變、內容變動(節流)時量,不是每一格都量', () => {
  const P = wideSim({ seed: 9 });
  P.step(1000);
  const n0 = P.st.qsaStar;
  P.step(60000);
  const n1 = P.st.qsaStar;
  ok(n0 >= 1 && n1 - n0 <= 1, '沒有事件的一分鐘:最多量 1 次', { n0, n1 });
  for (let y = 0; y <= 300; y += 20) { P.scroll(y); P.step(40); }
  const n2 = P.st.qsaStar;
  ok(n2 === n1, '捲動中不量', { n1, n2 });
  P.step(5000);
  const n3 = P.st.qsaStar;
  ok(n3 > n2 && n3 - n2 <= 3, '捲動停下:量一次', { n2, n3 });
  P.resize(1400); P.step(5000);
  const n4 = P.st.qsaStar;
  ok(n4 > n3 && n4 - n3 <= 3, '視窗大小改變:量一次', { n3, n4 });
  for (let i = 0; i < 40; i++) { P.muts.forEach((m) => m.cb([{ target: P.page.a }])); P.step(50); }
  P.step(5000);
  const n5 = P.st.qsaStar;
  ok(n5 > n4 && n5 - n4 <= 5, '內容一直變動 2 秒(之後等 5 秒):節流,最多每秒一次', { n4, n5 });
});
run('電腦版:捲動時空地跟著內容走,捲出可見範圍就回地面;寬度跨過 1024 回地面換規則', () => {
  const P = wideSim({ seed: 10 });
  let t = 0;
  while (t < 5 * 60 * 1000 && !(P.R().zone && P.R().zone !== 'ground' && !P.R().move && !P.R().flying)) { P.step(200); t += 200; }
  const b0 = P.box();
  ok(P.R().zone !== 'ground', '先站到一塊空地上', P.R());
  P.scroll(10); P.step(16);
  ok(Math.abs(P.box().t - (b0.t - 10)) < 0.5, '捲 10 px:小雞跟著內容往上 10 px', { b0, b1: P.box() });
  P.scroll(900); P.step(400);
  ok(P.R().ground === true && P.R().zone === 'ground', '捲到看不到那塊空地:回地面', P.R());
  P.scroll(0); P.step(400);
  P.resize(1000); P.step(16);
  ok(P.R().wide === false && P.R().ground === true, '寬度變成 1000:不是電腦版的到處走,在地面', P.R());
});

/* 1280×800 的學習頁:主要內容 120 到 1160(1080 寬、左右各 20 px 內距) */
function learn1280(add) {
  add(null, 'header', { cls: 'topbar', box: [0, 0, 1280, 59], fixed: true, style: WHITE });
  const main = add(null, 'main', { box: [120, 59, 1160, 1300] });
  add(main, 'h1', { box: [120, 80, 1160, 124], texts: [[120, 84, 340, 120]] });
  add(main, 'section', { box: [120, 150, 630, 420], style: WHITE, texts: [[144, 170, 400, 190]] });
  add(main, 'a', { attrs: { href: 'x.html' }, box: [650, 150, 1160, 420], style: Object.assign({ cursor: 'pointer' }, WHITE) });
  add(main, 'section', { box: [120, 440, 630, 640], style: WHITE });
  add(null, 'footer', { box: [0, 1320, 1280, 1500], style: { borderTopWidth: '1px', borderTopStyle: 'solid' } });
  return {};
}
run('電腦版 1280:兩側空白也去,5 分鐘不只在標題右邊和地面之間來回(第二輪審查 #2)', () => {
  const places = new Set();
  const P = sim({ src: ROAM, zones: ZONES, W: 1280, H: 800, page: 'learn.html', build: learn1280, seed: 3, each: (Q) => { const s = Q.R(); if (s && s.zone && !s.move && !s.flying) places.add(s.zone.split(':')[0] === 'ground' ? 'ground' : s.zone); } });
  P.step(5 * 60 * 1000);
  const kinds = new Set([...places].map((k) => k.split(':')[0]));
  ok(P.R().zones >= 3 && (kinds.has('side-L') || kinds.has('side-R')) && places.size >= 3, '1280 學習頁:量到 3 塊以上、去過兩側、5 分鐘去過 3 個以上的地方', { zones: P.R().zones, places: [...places] });
});
run('電腦版:小雞飛的時候滑鼠掃過牠就不動了,牠落到別處以後照常換地方(第二輪審查 #1)', () => {
  let tried = 0, moves = 0, landed = false;
  for (const seed of [21, 22, 23, 24]) {
    const P = wideSim({ seed });
    let t = 0;
    while (t < 5 * 60 * 1000 && P.R().move !== 'fly') { P.step(16); t += 16; }
    if (P.R().move !== 'fly') continue;
    tried++;
    P.step(200);
    const b = P.box();
    P.fireDoc('pointermove', { clientX: b.l + 24, clientY: b.t + 25, pointerType: 'mouse' });
    let z = null;
    for (let i = 0; i < 2400; i++) {   // 滑鼠之後一直不動,看 2 分鐘
      P.step(50);
      const s = P.R();
      if (!s.move && !s.flying) { if (z === null) { z = s.zone; landed = true; } else if (s.zone !== z) { moves++; z = s.zone; } }
    }
  }
  ok(tried >= 2 && landed && moves >= tried, '滑鼠停著不動:落地後照常換地方(每次 1 次以上)', { tried, moves });
});
run('電腦版:停在右側空白時視窗變窄(還在 1024 以上),小雞不超出視窗、頁面不變寬(第二輪審查 #3)', () => {
  let found = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const P = wideSim({ seed });
    let t = 0;
    while (t < 6 * 60 * 1000 && !(String(P.R().zone).startsWith('side-R') && !P.R().move && !P.R().flying)) { P.step(200); t += 200; }
    if (!String(P.R().zone).startsWith('side-R')) continue;
    found++;
    const out = [];
    P.resize(1100);
    for (let i = 0; i < 150; i++) { P.step(16); const b = P.box(); if (b.r > 1100 - 16 + 0.5 || b.l < 0) out.push({ t: i * 16, b, s: P.R() }); }
    eq0(out, 'seed ' + seed + ':變窄以後每一格小雞框都在視窗裡(右邊留 16 px)');
    P.resize(1300); P.step(100); P.resize(1050);
    const o2 = [];
    for (let i = 0; i < 100; i++) { P.step(16); const b = P.box(); if (b.r > 1050 - 16 + 0.5) o2.push({ t: i * 16, b }); }
    eq0(o2, 'seed ' + seed + ':1 秒內連著改大小(量的節流期間)也不超出');
    if (found >= 2) break;
  }
  ok(found >= 1, '找到停在右側空白的小雞', found);
});

/* ---------- 第三輪審查 ---------- */
function restInZone(P, limit) {
  for (let t = 0; t < (limit || 6 * 60 * 1000); t += 200) { const s = P.R(); if (s.zone && s.zone !== 'ground' && !s.move && !s.flying && P.tappable()) return true; P.step(200); }
  return false;
}
const overlap = (b, r) => b.l < r.right && b.r > r.left && b.t < r.bottom && b.b > r.top;
run('電腦版:分頁在背景時內容變了(新連結蓋到小雞停的地方),回到前景時馬上離開那裡,不停在連結上讓人點到(第三輪審查 #1)', () => {
  let tried = 0;
  for (const seed of [1, 2, 3, 4]) {
    const P = wideSim({ seed });
    if (!restInZone(P)) continue;
    tried++;
    const b = P.box(), y = P.st.scrollY;
    P.doc.visibilityState = 'hidden'; P.fireDoc('visibilitychange');
    const link = P.add(P.page.main, 'a', { attrs: { href: 'y.html' }, box: [b.l - 20, b.t + y - 10, b.r + 20, b.b + y + 10], style: { cursor: 'pointer' } });
    P.muts.forEach((m) => m.cb([{ target: link }]));
    P.step(1500);
    P.doc.visibilityState = 'visible'; P.fireDoc('visibilitychange');
    const over = [];
    for (let i = 0; i < 190; i++) { P.step(16); const q = P.box(); if (P.tappable() && overlap(q, link.getBoundingClientRect())) over.push({ t: i * 16, q, s: P.R() }); }
    eq0(over, 'seed ' + seed + ':回到前景後 3 秒內,小雞不停在新連結上(點得到)');
  }
  ok(tried >= 2, '找到停在空地上的小雞', tried);
});
run('choose:上下疊著的兩塊空地(高的那塊只有從低的那塊飛得到),高的那塊之後還會再去(第三輪審查 #2)', () => {
  const zones = [{ key: 'side-R:173:1488', kind: 'side-R', feetDoc: 173, lo: 1488, hi: 1856 }, { key: 'side-R:331:1488', kind: 'side-R', feetDoc: 331, lo: 1488, hi: 1856 }];
  const ground = { key: 'ground', feet: 1072, lo: 16, hi: 1856, ground: true };
  for (const seed of [1, 2, 3, 4]) {
    const m = Z.memory(0), rnd = mulberry(seed), seq = [];
    let here = Object.assign({ x: 1700 }, ground);
    for (let i = 0; i < 16; i++) {
      const now = 100000 + i * 60000;
      const d = Z.choose({ zones, here, ground, now, busy: false, calm: 1e9, near: [], mouse: null, lastFly: -1e9, recent: m.recent, order: m.order, H: 1080, top: 64, bottom: 1072 - BOXH - 8, scrollY: 0, S, BOXH, flyFrames: FF, rnd });
      seq.push(d ? d.z.key : 'none');
      if (!d) continue;
      Z.arrived(m, d.z.key, now, rnd);
      here = d.z.ground ? Object.assign({ x: d.tx }, ground) : { key: d.z.key, kind: d.z.kind, x: d.tx, feet: d.z.feetDoc, lo: d.z.lo, hi: d.z.hi };
    }
    const n = (k) => seq.filter((v) => v === k).length;
    ok(n('side-R:173:1488') >= 3 && n('side-R:331:1488') >= 3 && n('ground') >= 3 && !seq.includes('none'), 'seed ' + seed + ':16 次裡高的、低的、地面都去 3 次以上', seq);
  }
});
run('電腦版:地面也是一個地方,多半站著;不跑、不隨便轉身(第三輪審查 #3)', () => {
  for (const seed of [1, 2, 3]) {
    let n = 0, idle = 0, run = 0, flips = 0, sgn = 0, prev = null;
    const P = wideSim({ seed, each: (Q) => {
      const s = Q.R(); if (!s) return;
      const b = Q.box();
      if (s.ground && !s.move && !s.flying) {
        n++; if (Q.anim.pose === 'idle') idle++; if (Q.anim.pose === 'run') run++;
        if (prev) { const d = Math.sign(b.l - prev.l); if (d && sgn && d !== sgn) flips++; if (d) sgn = d; }
      } else sgn = 0;
      prev = b;
    } });
    P.step(5 * 60 * 1000);
    const min = n * 16 / 60000;
    ok(run === 0, '#' + seed + ' 地面上不跑', run);
    ok(n > 0 && idle / n >= 0.5, '#' + seed + ' 地面上一半以上的時間站著', { idle: idle / n, min });
    ok(min < 0.5 || flips / min <= 3, '#' + seed + ' 地面上每分鐘轉身 3 次以內', { flips, min });
  }
});
run('電腦版:進到新的一頁先待 15 秒以上才換地方,不忙的時間從進頁開始算(第三輪審查 #4)', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    let first = -1;
    const P = wideSim({ seed, each: (Q) => { const s = Q.R(); if (first < 0 && s && (s.move === 'fly' || s.move === 'hop' || s.move === 'fall' || (s.zone && s.zone !== 'ground'))) first = Q.st.t; } });
    P.step(60000);
    ok(first >= Z.CFG.stayMin, '#' + seed + ' 第一次換地方在進頁 ' + Z.CFG.stayMin / 1000 + ' 秒以後', first);
  }
  const m = Z.memory(1000, () => 0);
  ok(m.until - 1000 >= Z.CFG.stayMin, 'memory:進頁當作剛到,待 stayMin 以上', m.until);
  const win = { addEventListener() {}, setTimeout: () => 1, clearTimeout() {}, getSelection: () => ({ isCollapsed: true, rangeCount: 0 }) };
  const doc = { addEventListener() {}, activeElement: null, body: {} };
  let now = 5e6;
  const T = Z.tracker(win, doc, { now: () => now, mainLR: () => null, box: () => null, hover() {} });
  now += 1000;
  const c1 = T.calm(now);
  now += Z.CFG.calm;
  ok(c1 < Z.CFG.calm && T.calm(now) >= Z.CFG.calm, 'tracker:不忙的時間從進頁開始算(進頁 1 秒還不能起飛,8 秒以後可以)', { c1, c2: T.calm(now) });
});
/* 很長的頁面:學習頁下面接 n 張卡片(每張裡面有 k 個子元素),都在視窗下面 */
const longPage = (n, k) => (add) => {
  const p = learnPage(add);
  for (let i = 0; i < n; i++) { const c = add(p.main, 'section', { box: [200, 1500 + i * 120, 1240, 1600 + i * 120], style: WHITE }); for (let j = 0; j < k; j++) add(c, 'p', { box: [224, 1510 + i * 120 + j * 20, 900, 1528 + i * 120 + j * 20], texts: [[224, 1510 + i * 120 + j * 20, 600, 1528 + i * 120 + j * 20]] }); }
  return p;
};
function measureCost(P) {
  P.step(30000);
  const r0 = P.st.rects, q0 = P.st.qsaStar;
  P.scroll(4); P.step(1500);
  return { rects: P.st.rects - r0, measured: P.st.qsaStar - q0, zones: P.R().zones };
}
run('電腦版:量空地時看的元素有上限,視窗外的整塊不往裡面看(第三輪審查 #5)', () => {
  const mid = measureCost(wideSim({ seed: 2, build: longPage(300, 4) }));
  ok(mid.measured === 1 && mid.rects <= 300 + 120 && mid.zones > 0, '視窗下面 300 張卡片(各 4 個子元素):子元素不量,還是有空地', mid);
  const big = measureCost(wideSim({ seed: 2, build: longPage(2000, 2) }));
  ok(big.measured === 1 && big.rects <= Z.CFG.maxEls + 120 && big.zones === 0, '很長的頁面(超過上限):量的元素不超過 ' + Z.CFG.maxEls + ' 個,沒量完不當空地(留在地面)', big);
});
run('電腦版:減少動態、關掉走動、餓、睡覺時捲動停下不量空地;能走了再量(第三輪審查 #6)', () => {
  for (const ui of [{ reduced: true }, { roam: false }, { mood: 'hungry', hungry: true }, { mood: 'sleep' }]) {
    const P = wideSim({ seed: 3, ui });
    P.step(3000);
    const n0 = P.st.qsaStar;
    for (let i = 1; i <= 6; i++) { P.scroll(i * 20); P.step(1500); }
    P.muts.forEach((m) => m.cb([{ target: P.page.a }])); P.step(1500);
    ok(P.st.qsaStar === n0, JSON.stringify(ui) + ':捲動停 6 次、內容變動,都不量', { n0, n1: P.st.qsaStar });
    if (!ui.mood) continue;
    P.ui.mood = 'idle'; P.ui.hungry = false; P.change({}); P.step(2500);
    ok(P.st.qsaStar > n0 && P.R().zones > 0, JSON.stringify(ui) + ' 變回不餓、醒著:量一次空地', { n0, n1: P.st.qsaStar, zones: P.R().zones });
  }
});

/* ---------- App 模式、窄的網站模式:跟 f94cec7 一模一樣 ---------- */
function narrowPage(W) {
  return (add) => {
    add(null, 'header', { cls: 'topbar', box: [0, 0, W, 59], fixed: true, style: WHITE });
    const main = add(null, 'main', { box: [16, 59, W - 16, 1300] });
    add(main, 'h1', { box: [16, 80, W - 16, 120], texts: [[16, 84, 150, 116]] });
    const c = add(main, 'section', { cls: 'part-card', box: [16, 140, W - 16, 400], style: WHITE, texts: [[32, 160, 200, 180]] });
    add(c, 'button', { box: [32, 340, 200, 380] });
    add(main, 'section', { cls: 'pet-card', box: [16, 1000, W - 16, 1100], style: WHITE });
    add(null, 'footer', { box: [0, 1320, W, 1500], style: { borderTopWidth: '1px', borderTopStyle: 'solid' } });
  };
}
function scenario(P) {
  const out = [];
  const rec = (n) => { for (let i = 0; i < n; i++) { P.step(100); out.push(P.trace()); } };
  const card = P.html.all().find((e) => e.classList.contains('pet-card'));
  rec(200);
  for (let y = 0; y <= 240; y += 30) { P.scroll(y); rec(1); }
  rec(100);
  P.resize(P.st.W, P.st.H); rec(100);
  P.ui.mood = 'hungry'; P.ui.hungry = true; P.change({}); rec(150);
  P.ui.mood = 'idle'; P.ui.hungry = false; P.change({}); rec(200);
  (P.btn.on.pointerenter || []).forEach((f) => f({ pointerType: 'mouse' })); rec(30);
  (P.btn.on.pointerleave || []).forEach((f) => f({ pointerType: 'mouse' })); rec(100);
  P.fireDoc('pointermove', { clientX: 100, clientY: 700, pointerType: 'mouse' }); P.fireDoc('keydown', { key: 'a' }); rec(50);
  P.scroll(900); rec(5); P.ios.forEach((f) => f([])); rec(50); P.scroll(0); rec(5); P.ios.forEach((f) => f([])); rec(400);
  void card;
  return out;
}
run('App 模式、窄的網站模式(800、1000):跟 f94cec7 那一版用同一個種子跑,每 100 毫秒的位置、姿勢、class 都一樣', () => {
  if (!OLD) return;
  const cases = [
    { name: 'App 375 學習', o: { W: 375, H: 812, page: 'learn.html', app: true, htmlClass: ['app-shell', 'has-tabbar', 'is-tab-root'] }, zones: false },
    { name: 'App 375 學習(頁面上有 zones 模組)', o: { W: 375, H: 812, page: 'learn.html', app: true, htmlClass: ['app-shell', 'has-tabbar', 'is-tab-root'] }, zones: true },
    { name: 'App 375 練習頁', o: { W: 375, H: 812, page: 'grammar.html', app: true, htmlClass: ['app-shell', 'has-tabbar'] }, zones: false },
    { name: '網站 800 複習', o: { W: 800, H: 900, page: 'review.html' }, zones: true },
    { name: '網站 1000 學習', o: { W: 1000, H: 800, page: 'learn.html' }, zones: true },
    { name: '網站 860 首頁', o: { W: 860, H: 900, page: 'index.html' }, zones: true },
  ];
  for (const c of cases) for (const seed of [11, 12]) {
    const mk = (src, z) => sim(Object.assign({ src, zones: z ? ZONES : null, seed, build: narrowPage(c.o.W) }, c.o));
    const a = scenario(mk(OLD, false)), b = scenario(mk(ROAM, c.zones));
    const i = a.findIndex((v, k) => v !== b[k]);
    const moved = new Set(a.map((v) => v.split('|')[0])).size;
    ok(i < 0 && a.length === b.length && (c.o.page === 'grammar.html' || moved > 3), c.name + ' #' + seed + ':' + a.length + ' 格完全一樣', i < 0 ? { moved } : { at: i, old: a[i], now: b[i] });
  }
});

/* ---------- 原始碼:不碰學生資料、檔案大小 ---------- */
run('原始碼', () => {
  const code = ZONES.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  ok(code.length > 0 && !/localStorage|sessionStorage|indexedDB|PET_STORE|CLOUD|fetch\(/.test(code), 'zones 模組不讀寫任何儲存、不碰學生資料');
  ok(!/location\.(search|hash|href)|URLSearchParams/.test(code), 'zones 模組不讀網址參數');
  for (const [f, src] of [['js/pet-roam-zones.js', ZONES], ['js/pet-roam2.js', ROAM]]) {
    const n = src.split('\n').length;
    ok(n <= 800, f + ' 800 行以內', n);
    console.log('  ' + f + ':' + n + ' 行,' + Buffer.byteLength(src, 'utf8') + ' bytes');
  }
  const shell = read('js/app-shell.js');
  ok(/\['PET_ROAM_ZONES', 'js\/pet-roam-zones\.js'\][\s\S]{0,80}\['PET_ROAM', 'js\/pet-roam2\.js'\]/.test(shell), 'app-shell 的網站模式載入清單:zones 模組在 pet-roam2.js 前面');
  const css = read('css/style.css');
  ok(/div\.pet-roam2\.is-move \.pet-roam2-btn/.test(css.slice(css.indexOf('小雞第二階段:roam(js/pet-roam2.js)開始'))), 'css:移動中(is-move)點擊穿過');
});

console.log((fail ? 'FAILED' : 'OK') + ' pet-roam wide:' + pass + ' 通過,' + fail + ' 失敗');
process.exit(fail ? 1 : 0);
