/* 小雞第二階段:電腦版到處走,學生在忙、在捲動時(規格 1.11;第四輪審查第 1 輪的 4 項)。
   用法:node tools/test_pet_roam_busy.js
   - 忙的時候站在主要內容底下的地面:不從那裡斜斜飛過主要內容,沿著地面跑到最近那一側空白(路線經過學生正在用的地方附近就去另一側),
     到了再往上飛到那一側的空地,不會一直釘在地面(審查 #0;第三輪複查 #0)。
   - 忙的時候在同一側空白裡只往上一層、下一層換,不跳過中間那層,不飛過主要內容(審查 #2)。
   - 一直來回捲動:剛捲過時少去靠近可見範圍上下緣 200 px 的空地,不會剛落下就被捲出去掉回地面(審查 #1)。
   - 進頁馬上被捲動(捲回上次的位置):一樣 5 秒內離開地面;挑不到地方時 1 秒後再挑(審查 #3)。
   假瀏覽器在 tools/pet_roam_sim.js。 */
const { Z, S, BOXH, mulberry, ART, nodeLoad, ROAM, wanderRun } = require('./pet_roam_sim.js');
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.log('FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 500) : ''));
}
function run(name, f) { try { f(); } catch (e) { fail++; console.log('FAIL ' + name + ' 丟錯: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } }
const RU = nodeLoad(ROAM).util;
const FF = (d, m) => RU.flyFrames(d, ART.flyPlan, m);

/* 1280×800 的寬版頁:主要內容 100 到 1180,左側空白三層(730、530、150)、右側兩層(730、150),標題右邊一塊 */
const MAIN = { l: 100, r: 1180 };
const Lz = (f) => ({ key: 'side-L:' + f + ':16', kind: 'side-L', feetDoc: f, lo: 16, hi: 44 });
const Rz = (f) => ({ key: 'side-R:' + f + ':1188', kind: 'side-R', feetDoc: f, lo: 1188, hi: 1216 });
const ZONES = [Lz(730), Lz(530), Lz(150), Rz(730), Rz(150), { key: 'main:124:199', kind: 'main', feetDoc: 124, lo: 199, hi: 330 }];
const GROUND = { key: 'ground', ground: true, feet: 796, lo: 16, hi: 1216 };
function pick(o, n) {
  const out = {}, rnd = mulberry(o.seed || 7);
  for (let i = 0; i < (n || 200); i++) {
    const here = o.here || Object.assign({}, GROUND, { x: o.x });
    const d = Z.choose(Object.assign({ zones: ZONES, here, ground: Object.assign({}, GROUND, { x: here.x }), now: 1e6, busy: true, calm: 0, near: [], mouse: null, lastFly: -1e9,
      recent: [], order: ['ground'], main: MAIN, H: 800, top: 59, bottom: 737, scrollY: 0, S, BOXH, flyFrames: FF, rnd }, o.c || {}));
    const k = d ? d.z.key + ' ' + d.how + (d.how === 'walk' ? ' ' + d.tx : '') : 'none';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
const only = (p, keys) => Object.keys(p).every((k) => keys.some((q) => k.startsWith(q)));

run('choose:忙的時候站在主要內容底下的地面,不飛過主要內容,沿著地面跑到最近那一側空白(審查 #0;第三輪複查 #0)', () => {
  for (const x of [800, 973]) {
    const p = pick({ x });
    ok(only(p, ['ground walk 1180']), '地面 x ' + x + ':200 次都沿著地面往右到 1180(右側空白的開頭),不起飛', p);
  }
  const l = pick({ x: 300 });
  ok(only(l, ['ground walk 52']), '地面 x 300:沿著地面往左到 52', l);
  const d = Z.choose({ zones: ZONES, here: Object.assign({}, GROUND, { x: 800 }), ground: Object.assign({}, GROUND, { x: 800 }), now: 1e6, busy: true, calm: 0, near: [], mouse: null, lastFly: -1e9,
    recent: [], order: ['ground'], main: MAIN, H: 800, top: 59, bottom: 737, scrollY: 0, S, BOXH, flyFrames: FF, rnd: mulberry(2) });
  ok(!!d && d.pose === 'run' && Z.CFG.runSpeed >= 40 && Math.abs(d.dur - 380 / Z.CFG.runSpeed) < 1e-9, '用跑的(每秒 ' + Z.CFG.runSpeed + ' px),380 px 不用走 24 秒', d);
  /* 第三輪複查 #0 的真頁面:刷題頁 1280,主要內容 120 到 1160,小雞在地面 x 636(腳 796),兩側空地腳 331 */
  const M3 = { l: 120, r: 1160 }, Z3 = [{ key: 'side-L:331:16', kind: 'side-L', feetDoc: 331, lo: 16, hi: 64 }, { key: 'side-R:331:1168', kind: 'side-R', feetDoc: 331, lo: 1168, hi: 1216 }];
  const bad = [], got = {}, rnd = mulberry(9);
  for (let i = 0; i < 200; i++) {
    const here = Object.assign({}, GROUND, { x: 636 }), e = Z.choose({ zones: Z3, here, ground: here, now: 1e6, busy: true, calm: 0, near: [], mouse: null, lastFly: -1e9,
      recent: [], order: ['ground'], main: M3, H: 800, top: 59, bottom: 737, scrollY: 0, S, BOXH, flyFrames: FF, rnd });
    const k = e ? (e.how === 'walk' ? 'walk ' + e.tx : e.z.key + ' ' + e.how) : 'none';
    got[k] = (got[k] || 0) + 1;
    if (e && e.how !== 'walk') bad.push(k);
  }
  ok(!bad.length && !got.none, '刷題頁 1280 地面 x 636:200 次都沿著地面跑出去,不斜斜飛過主要內容到 331', got);
  const g = pick({ x: 30 });
  ok(!g.none && only(g, ['side-L:730:16']), '地面 x 30(已經在左側空白底下):往上到左側最低的那塊', g);
});
run('choose:忙的時候路線經過學生正在用的地方附近(240 px 內),改沿著地面走到那一側空白(審查 #0)', () => {
  const p = pick({ x: 800, c: { near: [700] } });
  ok(only(p, ['ground walk 1180']), '欄位在 700:不起飛,沿著地面往右走到 1180(右側空白的開頭)', p);
  const q = pick({ x: 800, c: { near: [1000] } });
  ok(only(q, ['ground walk 52']), '欄位在 1000:往右的路線經過它,改往左走到 52(左側空白,框右緣 100)', q);
  const m = pick({ x: 800, c: { mouse: 400 } }), m2 = pick({ x: 800, c: { mouse: 1000 } });
  ok(only(m, ['ground walk 1180']) && only(m2, ['ground walk 52']), '忙、滑鼠在 400:沿著地面往右跑;滑鼠在 1000(往右會經過):往左跑', { m, m2 });
  const none = Z.choose({ zones: ZONES.filter((z) => z.kind === 'main'), here: Object.assign({ x: 800 }, GROUND), ground: Object.assign({ x: 800 }, GROUND), now: 1e6, busy: true, calm: 0,
    near: [700], lastFly: -1e9, recent: [], order: ['ground'], main: MAIN, H: 800, top: 59, bottom: 737, scrollY: 0, S, BOXH, flyFrames: FF, rnd: mulberry(1) });
  ok(none === null, '兩側空白都沒有空地:不走(留在原地)', none);
});
run('choose:忙的時候在同一側空白裡只往上一層、下一層換,不跳過中間那層;最低那層可以落回那一側的地面(審查 #2)', () => {
  const at = (z) => Object.assign({}, z, { x: z.lo, feet: z.feetDoc });
  const a = pick({ here: at(Lz(730)) });
  ok(only(a, ['side-L:530:16', 'ground']), '左側 730:只去 530 或落回地面,不直接去 150', a);
  const b = pick({ here: at(Lz(530)) });
  ok(only(b, ['side-L:730:16', 'side-L:150:16']), '左側 530:只去上下相鄰的 730、150', b);
  const c = pick({ here: at(Lz(150)) });
  ok(only(c, ['side-L:530:16']), '左側 150:只去 530,不直接落回地面', c);
  const d = pick({ here: at(Rz(150)) });
  ok(only(d, ['side-R:730:1188']), '右側 150(那一側只有兩層):去 730', d);
  const e = pick({ here: at(Lz(530)), c: { busy: false, calm: 60000 } });
  ok(Object.keys(e).some((k) => k.startsWith('side-R') || k.startsWith('main')), '不忙的時候照常跨過主要內容', e);
});
run('choose:剛捲動過,少去靠近可見範圍上下緣 200 px 的空地(審查 #1)', () => {
  const here = Object.assign({}, GROUND, { x: 30 });
  const free = { busy: false, calm: 60000 };
  const p0 = pick({ here, c: Object.assign({ scrolled: 1e9 }, free) }, 1000), p1 = pick({ here, c: Object.assign({ scrolled: 2000 }, free) }, 1000);
  const n = (p, k) => Object.keys(p).filter((q) => q.startsWith(k)).reduce((a, q) => a + p[q], 0);
  ok(n(p1, 'side-L:530') > n(p0, 'side-L:530') * 1.5 && n(p1, 'side-L:150') < n(p0, 'side-L:150') * 0.5, '剛捲過:中間的 530 多去,靠上緣的 150 少去', { before: p0, after: p1 });
  ok(Z.CFG.retry <= 1000, '挑不到地方:1 秒後再挑', Z.CFG.retry);
});

/* ---------- 模擬:假瀏覽器跑真的 js/pet-roam2.js ---------- */
const key3 = (o) => { let last = -1e9; return (Q) => { if (Q.st.t - last >= 3000) { last = Q.st.t; Q.fireDoc('keydown', { key: 'Shift' }); } if (o) o(Q); }; };
run('電腦版:一直在按鍵(忙),小雞從主要內容底下的地面出發,任一段 60 秒去 3 個地方以上,不一直待在地面(審查 #0)', () => {
  for (const name of ['drill', 'learn']) for (const startX of [800, 973, 400]) for (const seed of [1, 2, 3]) {
    const tag = name + ' 1280 x ' + startX + ' #' + seed + ':';
    let cross = 0, runAt = -1, runX = 0, upX = null;
    const r = wanderRun({ name, W: 1280, H: 800, seed, startX, ms: 200000, mark: key3((Q) => {
      const s = Q.R(), b = Q.box();
      if (runAt < 0 && s.ground && s.pose === 'run') { runAt = Q.st.t; runX = s.x; }
      if (upX === null && (s.move || s.flying || !s.ground)) upX = s.x;
      if ((s.move === 'fly' || s.move === 'fall') && b.r > 120 && b.l < 1160) cross++;   // 飛、落下時小雞框碰到主要內容那一欄
    }) });
    ok(r.minZones >= 3, tag + '任一段 60 秒裡去過 3 個以上的地方', r.minZones);
    const go = runAt >= 0 ? runAt : r.first, need = runAt >= 0 ? Math.abs(upX - runX) / Z.CFG.runSpeed * 1000 + 2500 : 0;
    ok(r.ground <= 0.3 && go >= 0 && go <= 5000 && r.first - go <= need + 1, tag + '在地面不到 3 成,5 秒內開始離開(跑向一側或起飛),跑到一側就往上飛', { ground: r.ground, first: r.first, runAt, need });
    ok(cross === 0, tag + '忙的時候不飛過主要內容那一欄(第三輪複查 #0)', cross);
  }
});
run('電腦版:一直在按鍵(忙),在同一側空白裡換,不跳過中間那層(審查 #2)', () => {
  /* 刷題頁 1280(假瀏覽器的版型,主要內容 120 到 1160):兩側的層 150、330、530,頁尾上緣 600 整條;地面 796 */
  const levels = [150, 330, 530, 600, 796];
  const bad = [];
  let moves = 0;
  for (const seed of [1, 2, 3, 4]) {
    const seq = [];
    wanderRun({ name: 'drill', W: 1280, H: 800, seed, startX: 30, ms: 180000, mark: key3((Q) => {
      const s = Q.R(), b = Q.box();
      if (s.move || s.flying) return;
      const at = { k: s.ground ? 'ground' : s.zone, side: b.r <= 120 ? 'L' : b.l >= 1160 ? 'R' : 'M', feet: Math.round(b.b) };
      const p = seq[seq.length - 1];
      if (at.k && (!p || p.k !== at.k)) seq.push(at);
    }) });
    for (let i = 1; i < seq.length; i++) {
      const p = seq[i - 1], q = seq[i];
      moves++;
      if (p.side !== q.side || p.side === 'M' || levels.some((y) => y > Math.min(p.feet, q.feet) + 2 && y < Math.max(p.feet, q.feet) - 2)) bad.push({ seed, from: p, to: q });
    }
  }
  ok(bad.length === 0 && moves >= 20, '忙的時候每次都換到同一側相鄰的那層(換了 ' + moves + ' 次)', bad.slice(0, 4));
});
run('電腦版:每 7 秒來回捲 160 px,在地面不到 3 成、沒有落下不到 2 秒就被捲出去的(審查 #1)', () => {
  for (const seed of [1, 2, 3, 4]) {
    let n = 0;
    const r = wanderRun({ name: 'learn', W: 1280, H: 800, seed, ms: 210000, mark: (Q) => {
      if (Q.st.t >= 3500 + n * 7000) { Q.scroll(n % 2 ? 0 : 160); n++; }
    } });
    ok(r.ground <= 0.3, '#' + seed + ' 在地面的比例 3 成以下', r.ground);
    ok(Math.min(...r.stays) >= 2, '#' + seed + ' 每次落下都待 2 秒以上', r.stays.filter((s) => s < 2));
  }
});
run('電腦版:進頁馬上被捲到卡片下面(捲回上次的位置),一樣 5 秒內離開地面(審查 #3)', () => {
  for (const name of ['index', 'learn']) for (const seed of [1, 2, 3, 4, 5, 6]) {
    let done = false;
    const r = wanderRun({ name, W: 1280, H: 800, seed, startX: 332, ms: 30000, mark: (Q) => { if (!done && Q.st.t >= 200) { done = true; Q.scroll(600); } } });
    ok(r.first >= 0 && r.first <= 5000, name + ' #' + seed + ':第一次離開地面在 5 秒內', r.first);
  }
});

/* ---------- 第五輪審查 ---------- */
/* 1280×800 的窄版頁(複習):主要內容 255 到 1025,兩側空白各兩層,標題右邊一塊 */
const M5 = { l: 255, r: 1025 };
const Z5 = [{ key: 'side-L:700:16', kind: 'side-L', feetDoc: 700, lo: 16, hi: 199 }, { key: 'side-L:400:16', kind: 'side-L', feetDoc: 400, lo: 16, hi: 199 },
  { key: 'side-R:700:1033', kind: 'side-R', feetDoc: 700, lo: 1033, hi: 1216 }, { key: 'side-R:300:1033', kind: 'side-R', feetDoc: 300, lo: 1033, hi: 1216 },
  { key: 'main:124:300', kind: 'main', feetDoc: 124, lo: 300, hi: 420 }];
const base5 = (o) => Object.assign({ zones: Z5, now: 1e6, busy: false, calm: 60000, near: [], mouse: null, lastFly: -1e9, recent: [], order: ['ground'], main: M5,
  H: 800, top: 59, bottom: 737, scrollY: 0, S, BOXH, flyFrames: FF }, o);
run('choose:不忙、只有滑鼠在主要內容裡動,站在主要內容底下的地面一樣走得掉(第五輪審查 #0)', () => {
  for (const mouse of [640, 500, 900]) {
    const rnd = mulberry(3), out = {}, bad = [];
    for (let i = 0; i < 200; i++) {
      const here = Object.assign({}, GROUND, { x: 770 }), d = Z.choose(base5({ here, ground: here, mouse, rnd }));
      const k = d ? (d.how === 'walk' ? 'walk ' + d.tx : d.z.key + ' ' + d.how) : 'none';
      out[k] = (out[k] || 0) + 1;
      if (!d) continue;
      const gut = d.tx >= M5.r || d.tx + S <= M5.l, lo = Math.min(770, d.tx), hi = Math.max(770, d.tx) + S;
      if (!gut || (d.how === 'walk' ? !d.z.ground : d.z.kind === 'main')) bad.push(k);
      if (d.how !== 'walk' && Math.max(lo - mouse, mouse - hi, 0) <= Z.CFG.nearX) bad.push('near ' + k);
    }
    ok(!out.none && !bad.length, '滑鼠在 ' + mouse + ':200 次都離開(飛到一側空白,或沿著地面走到一側);起飛的路線離滑鼠 240 px 以外', { out, bad: bad.slice(0, 3) });
  }
});
run('choose:知道滑鼠的高度時,量小雞走的那條線到滑鼠的距離(第五輪審查 #0)', () => {
  const here = Object.assign({}, GROUND, { x: 770 });
  const pick5 = (mouseY) => { const rnd = mulberry(5), out = {}; for (let i = 0; i < 200; i++) { const d = Z.choose(base5({ here, ground: here, mouse: 640, mouseY, rnd })); const k = d ? (d.how === 'walk' ? 'walk' : d.z.kind + ' ' + d.how) : 'none'; out[k] = (out[k] || 0) + 1; } return out; };
  const hi = pick5(400), lo = pick5(770);
  ok(!hi.none && !hi.walk && Object.keys(hi).every((k) => k.startsWith('side-')), '滑鼠在 (640, 400)、小雞在地面 x 770:往兩側空白飛(路線離滑鼠 240 px 以外),不去主要內容', hi);
  ok(Object.keys(lo).every((k) => k === 'walk'), '滑鼠在 (640, 770),就在小雞旁邊:不起飛,沿著地面走到一側', lo);
});
run('電腦版:不打字、不捲動,只有滑鼠每 1.5 秒在主要內容中間動一下,小雞一樣 5 秒內離開地面、在地面不到 3 成(第五輪審查 #0)', () => {
  const OLD = require('./pet_roam_sim.js').ZONES.replace(' || (c.mouse !== null && c.mouse !== undefined);', ';').replace('if (c.mouseY === null || c.mouseY === undefined)', 'if (true)');
  const mv = (Q) => { if (Q.st.t % 1500 < 100) Q.fireDoc('pointermove', { clientX: 618 + (Q.st.t / 1500 % 4) * 14, clientY: 300 + (Q.st.t / 1500 % 5) * 50, pointerType: 'mouse' }); };
  const old = wanderRun({ name: 'review', W: 1280, H: 800, seed: 1, startX: 770, ms: 60000, zones: OLD, mark: mv });
  ok(old.ground > 0.5, '(對照)改之前:大部分時間在地面', old.ground);
  for (const [name, x] of [['review', 770], ['learn', 640], ['drill', 900]]) for (const seed of [1, 2, 3]) {
    const r = wanderRun({ name, W: 1280, H: 800, seed, startX: x, ms: 120000, mark: mv });
    ok(r.first >= 0 && r.first <= 5000 && r.ground <= 0.3 && r.minZones >= 3, name + ' 1280 #' + seed + ':5 秒內離開地面、在地面 3 成以下、任一段 60 秒去 3 個地方', { first: r.first, ground: r.ground, minZones: r.minZones });
  }
});
run('tracker:滑鼠在頂欄上(橫的位置對著主要內容)不算在主要內容裡動(第五輪審查 #0)', () => {
  const on = {};
  const win = { addEventListener() {}, setTimeout: () => 1, clearTimeout() {}, getSelection: () => ({ isCollapsed: true, rangeCount: 0 }), scrollY: 0 };
  const doc = { addEventListener: (t, f) => { on[t] = f; }, activeElement: null, body: {} };
  let now = 100000;
  const T = Z.tracker(win, doc, { now: () => now, mainLR: () => ({ l: 255, r: 1025 }), top: () => 59, box: () => null, hover() {} });
  on.pointermove({ clientX: 640, clientY: 30, pointerType: 'mouse' });
  ok(T.pointer(now) === null, '頂欄上:不算', T.pointer(now));
  on.pointermove({ clientX: 640, clientY: 400, pointerType: 'mouse' });
  ok(T.pointer(now) === 640, '頂欄下面:算', T.pointer(now));
});
run('choose:這一側只剩兩塊、別的地方都超過平常飛得到的距離,不在「上、下、地面」三步裡一直繞,也會去另一側(第五輪審查 #1)', () => {
  /* 刷題頁 1920×1080:主要內容 440 到 1480,右側兩層(331、173),左側一層、標題右邊一塊都在 1000 px 以外 */
  const zones = [{ key: 'side-R:331:1488', kind: 'side-R', feetDoc: 331, lo: 1488, hi: 1856 }, { key: 'side-R:173:1488', kind: 'side-R', feetDoc: 173, lo: 1488, hi: 1856 },
    { key: 'side-L:331:16', kind: 'side-L', feetDoc: 331, lo: 16, hi: 384 }, { key: 'main:139:514', kind: 'main', feetDoc: 139, lo: 514, hi: 546 }];
  const ground = { key: 'ground', ground: true, feet: 1076, lo: 16, hi: 1856 };
  for (const seed of [1, 2, 3, 4]) {
    const rnd = mulberry(seed), m = Z.memory(0, rnd), seq = [];
    let here = { key: zones[0].key, kind: 'side-R', x: 1700, feet: 331, lo: 1488, hi: 1856, src: zones[0] }, now = 1e6;
    m.recent = [zones[0].key]; m.order = [zones[0].key, 'ground'];
    for (let i = 0; i < 30; i++) {
      now += 12000;
      const d = Z.choose({ zones, here, ground: Object.assign({}, ground, { x: here.x }), now, busy: false, calm: 60000, near: [], mouse: null, lastFly: m.lastFly, recent: m.recent, order: m.order,
        main: { l: 440, r: 1480 }, H: 1080, top: 59, bottom: 1017, scrollY: 0, S, BOXH, flyFrames: FF, rnd, scrolled: 1e9 });
      if (!d) { seq.push('none'); continue; }
      if (d.how === 'fly') m.lastFly = now;
      Z.arrived(m, d.z.key, now, rnd);
      seq.push(d.z.key);
      here = d.z.ground ? Object.assign({}, ground, { x: d.tx }) : { key: d.z.key, kind: d.z.kind, x: d.tx, feet: d.z.feetDoc, lo: d.z.lo, hi: d.z.hi, src: d.z };
    }
    const g = seq.filter((k) => k === 'ground').length;
    ok(g <= 6, '#' + seed + ' 30 次裡去地面 6 次以下(不是每三次一次)', seq.join(' '));
    ok(seq.some((k) => k.startsWith('side-L') || k.startsWith('main')), '#' + seed + ' 也去另一側或標題右邊', seq.join(' '));
  }
});
run('choose:捲動有固定的節奏、下一次捲動前飛不完,先不往主要內容那一欄起飛(第五輪審查 #2)', () => {
  const here = Object.assign({}, GROUND, { x: 600 });
  const c = (sc, extra) => base5({ zones: Z5.filter((z) => z.kind === 'main').concat([{ key: 'main:330:300', kind: 'main', feetDoc: 330, lo: 300, hi: 900 }], extra || []), here, ground: here, scrolled: 4000, sc, rnd: mulberry(4) });
  ok(Z.choose(c({ next: 1e6 + 500, step: 300, dir: 1 })) === null, '0.5 秒後會往下捲 300 px、目的地會被捲走:不起飛', Z.choose(c({ next: 1e6 + 500, step: 300, dir: 1 })));
  const d = Z.choose(c({ next: 1e6 + 6000, step: 300, dir: 1 }));
  ok(!!d && d.how === 'fly', '6 秒後才捲:照常起飛', d);
  const e = Z.choose(c({ next: 1e6 - 500, step: 300, dir: 1 }));
  ok(!!e, '預計的時間過了還沒捲(學生停下來讀):照常起飛', e);
  const low = { key: 'main:600:300', kind: 'main', feetDoc: 600, lo: 300, hi: 900 }, f = Z.choose(c({ next: 1e6 + 500, step: 300, dir: 1, only: true }, [low]));
  ok(!!f && f.z.key === low.key, '0.5 秒後會捲,但再捲 300 px 還看得到的(腳 600,在頁面最上面只能往下捲):照樣去', f);
});
run('tracker:記得捲動的步幅、方向和節奏(第五輪審查 #2)', () => {
  const won = {};
  const win = { addEventListener: (t, f) => { won[t] = f; }, setTimeout: () => 1, clearTimeout() {}, getSelection: () => ({ isCollapsed: true, rangeCount: 0 }), scrollY: 0 };
  const doc = { addEventListener() {}, activeElement: null, body: {} };
  let now = 100000;
  const T = Z.tracker(win, doc, { now: () => now, mainLR: () => null, box: () => null, hover() {} });
  const wheel = (y) => { for (let k = 1; k <= 3; k++) { win.scrollY += (y - win.scrollY) * k / 3; won.scroll(); now += 100; } };
  wheel(300); now = 106000; wheel(600); now = 112000; wheel(300);
  const s = T.scrollInfo(now);
  ok(Math.abs(s.step - 300) < 2 && s.dir === -1, '最後一次往上捲 300 px', s);
  ok(Math.abs(s.next - (112000 + 6000)) < 400, '照前兩次的間隔(6 秒)估下一次', s);
  ok(Z.CFG.busyScroll <= 1500, '捲動後算忙的時間縮短(' + Z.CFG.busyScroll + ' 毫秒)', Z.CFG.busyScroll);
});
run('arrived:落回地面時,在地面待的 2 到 5 秒從落地站好以後算,不剛落下就飛回去(第五輪審查 #1)', () => {
  const rnd = mulberry(1);
  for (let i = 0; i < 50; i++) {
    const m = Z.memory(0, rnd);
    Z.arrived(m, 'ground', 1e6, rnd, 1.2);
    ok(m.until - 1e6 >= 1200 + 600 + 2000 && m.until - 1e6 <= 1200 + 600 + 5000, '落下 1.2 秒:' + (m.until - 1e6) + ' 毫秒後才換', m.until - 1e6);
  }
});
run('routeOf、rescue:往下又橫移遠的改成邊飛邊往下;腳下的空地被捲到頂欄底下,往下撲到看得到的空地(第五輪審查 #1、#2)', () => {
  const r = Z.routeOf({ x: 546, feet: 139, lo: 514, hi: 546 }, { feet: 331, lo: 1488, hi: 1856 }, 1488, { busy: false, flyFrames: FF, S });
  ok(!!r && r.how === 'fly' && Math.abs(r.dur - (1488 - 546) / 400) < 1e-9, '從標題右邊(腳 139)到右側空白(腳 331、橫移 942 px):邊飛邊往下,每秒 400 px', r);
  ok(Z.routeOf({ x: 546, feet: 139, lo: 514, hi: 546 }, { feet: 331, lo: 1488, hi: 1856 }, 1488, { busy: true, flyFrames: FF, S }) === null, '忙的時候還是不飛');
  const zs = [{ key: 'a', feetDoc: 400, lo: 100, hi: 300 }, { key: 'b', feetDoc: 700, lo: 100, hi: 300 }, { key: 'c', feetDoc: 290, lo: 100, hi: 300 }, { key: 'd', feetDoc: 900, lo: 100, hi: 300 }];
  const ctx = { top: 59, bottom: 737, scrollY: 0, BOXH };
  const d = Z.rescue(zs, 200, 110, ctx, () => true);
  ok(!!d && d.z.key === 'a' && d.how === 'fall' && d.tx === 200, '從頂欄下緣(腳 110)往下:離上緣 200 px 以上、最近的那塊(400),不去太靠上的 290、看不到的 900', d);
  ok(Z.rescue(zs, 200, 110, ctx, (z) => z.key !== 'a').z.key === 'b', '落地前再確認不行的跳過', null);
  ok(Z.rescue(zs, 200, 720, ctx, () => true) === null, '下面沒有看得到的空地:回地面(null)', null);
});
run('電腦版:站的空地被捲到頂欄底下,下面有看得到的空地時往下撲過去,不直接回地面(第五輪審查 #2)', () => {
  let ok1 = 0, tried = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    let st = 0, at = 0, res = '';
    wanderRun({ name: 'learn', W: 1280, H: 800, seed, ms: 90000, mark: (Q, s) => {
      const b = Q.box();
      if (st === 0 && !s.move && !s.flying && !s.ground && s.zone && b.b > 100 && b.b < 600 && Q.st.t > 4000) { st = 1; at = Q.st.t; Q.scroll(Q.st.scrollY + Math.round(b.b - 59 - BOXH + 12)); }
      else if (st === 1 && Q.st.t - at >= 2500) { st = 2; res = s.move || s.flying ? 'move' : s.ground ? 'ground' : 'zone'; }
    } });
    if (st === 2) { tried++; if (res === 'zone') ok1++; }
  }
  ok(tried >= 3 && ok1 === tried, '捲走以後 2.5 秒內站到下面的空地(' + ok1 + ' / ' + tried + ')', { ok1, tried });
});
/* 每 6 秒滾一格 300 px(下、下、上;時間跟每秒的檢查錯開 0.45 秒)。o.zones:換掉 js/pet-roam-zones.js(測試確認改之前的樣子會失敗) */
const P6 = [300, 600, 300, 600, 900, 600, 900, 600, 300, 0];
function wheel6(name, W, H, seed, zones) {
  let n = 0, prev = null, t0 = -1, n0 = 0, sAt = -1e9;
  const drops = [];
  const r = wanderRun(Object.assign({ name, W, H, seed, ms: 180000, mark: (Q, s) => {
    if (Q.st.t >= 3450 + n * 6000) { Q.scroll(P6[n % P6.length]); n++; sAt = Q.st.t; }
    const k = s.move || s.flying ? 'move' : s.ground ? 'ground' : 'zone';
    if (prev === 'ground' && s.move === 'fly') { t0 = Q.st.t; n0 = n; }   // 從地面起飛(不算試飛失敗那一小段)
    if (k === 'ground' && t0 >= 0) { if (Q.st.t - t0 < 2500 && sAt > t0 && n0 >= 2) drops.push(t0 / 1000); t0 = -1; }
    if (k === 'zone') t0 = -1;
    prev = k;
  } }, zones ? { zones } : {}));
  return Object.assign(r, { drops });
}
run('電腦版:每 6 秒滾一格,不在下一次捲動前一刻起飛又馬上被丟回地面;有空地的頁面常常離開地面(第五輪審查 #2)', () => {
  const OLD = require('./pet_roam_sim.js').ZONES.replace('busyScroll: 1000', 'busyScroll: 3000').replace(/sc\.next > c\.now &&/, 'false &&');
  const before = [];
  for (const name of ['review', 'index', 'learn']) for (const seed of [1, 2, 3]) before.push(...wheel6(name, 1280, 800, seed, OLD).drops);
  ok(before.length >= 3, '(對照)捲動後算忙 3 秒、不看節奏:起飛不到 2.5 秒就被捲回地面好幾次', before);
  /* 在地面的比例只看學習頁、複習頁:假的首頁捲到 600 以下只有可以點的大卡片,沒有能站的地方(真的瀏覽器量在回報裡) */
  for (const [name, max] of [['learn', 0.3], ['review', 0.4], ['index', 1]]) for (const seed of [1, 2, 3]) {
    const r = wheel6(name, 1280, 800, seed);
    ok(r.drops.length === 0, name + ' 1280 #' + seed + ':第二次捲動以後,沒有起飛不到 2.5 秒就被捲回地面的', r.drops);
    if (max < 1) ok(r.ground <= max, name + ' 1280 #' + seed + ':在地面 ' + max * 10 + ' 成以下(假的複習頁捲到 900 時看不到能站的地方,只能在地面)', { ground: r.ground, minZones: r.minZones });
  }
});

/* ---------- 第三輪複查 ---------- */
run('choose:一側空白有三層、另一側在 2.5 秒外,不忙的時候不一直在同一側繞,每兩三次就有機會去另一側(第三輪複查 #1)', () => {
  /* 首頁 1280 捲過卡片:主要內容 120 到 1160,兩側各三層(腳 142、442、592),主要內容裡沒有空地 */
  const L3 = (f) => ({ key: 'side-L:' + f + ':16', kind: 'side-L', feetDoc: f, lo: 16, hi: 64 }), R3 = (f) => ({ key: 'side-R:' + f + ':1168', kind: 'side-R', feetDoc: f, lo: 1168, hi: 1216 });
  const zones = [L3(142), L3(442), L3(592), R3(142), R3(442), R3(592)], ground = { key: 'ground', ground: true, feet: 796, lo: 16, hi: 1216 };
  const run1 = (seed, extra) => {
    const rnd = mulberry(seed), m = Z.memory(0, rnd), seq = [];
    let here = { key: zones[0].key, kind: 'side-L', x: 40, feet: 142, lo: 16, hi: 64, src: zones[0] }, now = 1e6;
    m.recent = [zones[0].key]; m.order = [zones[0].key, 'ground'];
    for (let i = 0; i < 40; i++) {
      now += 12000;
      const d = Z.choose(Object.assign({ zones, here, ground: Object.assign({}, ground, { x: here.x }), now, busy: false, calm: 60000, near: [], mouse: null, lastFly: m.lastFly, recent: m.recent, order: m.order,
        main: { l: 120, r: 1160 }, H: 800, top: 59, bottom: 737, scrollY: 0, S, BOXH, flyFrames: FF, rnd, scrolled: 1e9 }, extra || {}));
      if (!d) { seq.push('none'); continue; }
      if (d.how === 'fly') m.lastFly = now;
      Z.arrived(m, d.z.key, now, rnd);
      seq.push(d.z.key);
      here = d.z.ground ? Object.assign({}, ground, { x: d.tx }) : { key: d.z.key, kind: d.z.kind, x: d.tx, feet: d.z.feetDoc, lo: d.z.lo, hi: d.z.hi, src: d.z };
    }
    return seq;
  };
  for (const seed of [1, 2, 3, 4, 5]) {
    const seq = run1(seed), sides = seq.map((k) => (k.startsWith('side-R') ? 'R' : k.startsWith('side-L') ? 'L' : '')).filter(Boolean);
    let sw = 0;
    for (let i = 1; i < sides.length; i++) if (sides[i] !== sides[i - 1]) sw++;
    ok(seq.filter((k) => k.startsWith('side-R')).length >= 6 && sw >= 4, '#' + seed + ' 40 次裡去右側 6 次以上、換邊 4 次以上', seq.join(' '));
    ok(seq.filter((k) => k === 'ground').length <= 12, '#' + seed + ' 去地面的次數沒有變多', seq.filter((k) => k === 'ground').length);
  }
  const q = run1(1, { mouse: 640 });
  ok(q.every((k) => !k.startsWith('side-R')), '滑鼠在主要內容裡動(剛忙完):照舊不飛過主要內容', q.join(' '));
});

console.log((fail ? 'FAILED' : 'OK') + ' pet-roam busy:' + pass + ' 通過,' + fail + ' 失敗');
process.exit(fail ? 1 : 0);
