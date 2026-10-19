/* 小雞第二階段:整頁跑(小雞第二階段規格.md 第 1、2 節、附錄 A.1、A.9;原型在 小雞/第二階段/roam-proto.js)。
   - 只由 js/app-shell.js 依 PET_ROAM_V2 載入,跟 js/pet-roam.js 二選一。不讀寫學生資料;唯一的儲存是 sessionStorage pet_roam_x。
   - App 模式(html.app-shell 有分頁列):腳一直踩在分頁列上緣(Bonnie 10/17 選 B),地面上不閃、不縮。
     網站模式(五個主分頁):地面是視窗下緣往上 4 px,兩側各留 16 px。
   - 主分頁偶爾飛上站點(停 4 秒以上、今天吃過飼料、不在睡覺、不餓:30%,每次進頁最多一次),停 8 到 20 秒再撲著翅膀落回地面。
     站點只選不能點、旁邊有空位的地方(可以點的東西間隔 8 px,文字、圖片、卡片 4 px);寬螢幕的網站模式,主要內容兩側的空白也是站點。
     飛行照 ChickArt.flyPlan 播,格號和位移在同一個 requestAnimationFrame 迴圈算,飛行中點擊穿過小雞。
   - 練習頁(App 模式非主分頁)坐在分頁列上畫靜止格;遊戲回合中、鍵盤打開、任何面板打開時整層隱藏;分頁在背景時停止。
   - 有小雞的卡片(.pet-card)在畫面上時,走動那隻原地淡出,畫面上只有一隻。
   - 減少動態、或學生關掉「小雞在頁面上走動」(view().roam === false):停在地面畫靜止格,不抖,一樣可以點。
   - 電腦版到處走(規格 1.11):網站模式、寬 1024 以上、有 js/pet-roam-zones.js 時不飛站點,在空地之間一直換地方;走、跳、飛時點擊穿過(is-move),
     停著才點得到;空地只在捲動停下、視窗大小改變、內容變動時量(最多每秒一次)。App 模式和 1023 以下照上面不變。 */
(function (root) {
  'use strict';
  /* 規格的數字都在這裡(時間是毫秒,flyMax、fallMax、hopDur 是秒) */
  const CFG = Object.freeze({
    size: 48, padI: 8, padO: 4, step: 12, maxPts: 240, turnTicks: 8, gap: 16, sideMin: 80, webLift: 4,
    flyChance: 0.3, flyAfter: 4000, perchMin: 8000, perchMax: 20000, perchRetry: 3000, hopMax: 80, hopDur: 0.4,
    failChance: 0.05, failEvery: 180000, scrollIdle: 150, mutThrottle: 250, fade: 200,
    flyMax: 2.5, fallMax: 1.2, leanMax: 11, leanFull: 60,
    maxRise: 880,          // 2.5 秒內飛得到的最大高度:每次下拍最多抬升 flyPlan 的 4 倍
  });
  const KEY = 'pet_roam_x';
  const CLICK_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'details', 'video', 'audio', 'iframe', 'canvas']);
  const ROLES = new Set(['button', 'link', 'tab', 'checkbox', 'radio', 'switch']);
  const MEDIA = new Set(['img', 'svg', 'picture', 'video', 'audio', 'iframe', 'canvas', 'progress', 'meter']);
  const CLICK_UP = 'a[href],button,[role=button],[role=link]';
  const GAME = '.game-field,.mem-grid,.toast-grid';
  const WEB_PAGES = ['index.html', 'learn.html', 'drill.html', 'review.html', 'me.html'];
  /* 站點設定表(規格 1.4):找不到錨點就當這頁沒有站點 */
  const STATIONS = {
    'index.html': [{ sel: '#daily-home', edge: 'top' }],
    'learn.html': [{ sel: 'main h1', edge: 'right' }],
    'drill.html': [{ sel: 'main h1', edge: 'right' }],
    'review.html': [{ sel: 'main h1', edge: 'right' }, { sel: '.part-card', edge: 'top' }],
    'me.html': [{ sel: 'main h1', edge: 'right' }],
  };

  /* ---------- 純計算(node 測試用 module.exports 拿) ---------- */
  function alpha(c) { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; }
  function shown(s) { return !!s && s.display !== 'none' && s.visibility !== 'hidden' && !(Number(s.opacity) <= 0.05); }
  /* 附錄 A.1 可以點的東西,另外看計算後的 cursor: pointer(本站的點擊大多用 addEventListener 綁) */
  function isClickable(e, s) {
    if (CLICK_TAGS.has(e.tagName.toLowerCase())) return true;
    if (e.getAttribute('draggable') === 'true' || ROLES.has(e.getAttribute('role'))) return true;
    const ce = e.getAttribute('contenteditable'), ti = e.getAttribute('tabindex');
    if ((ce !== null && ce !== 'false') || (ti !== null && ti.trim() !== '-1')) return true;
    return !!(e.classList && e.classList.contains('game-field')) || (!!s && s.cursor === 'pointer');
  }
  /* 卡片:有自己的底色(跟外層不同)、框線、陰影或背景圖 */
  function isSurface(s, ps) {
    const bg = alpha(s.backgroundColor) > 0.05 && (!ps || s.backgroundColor !== ps.backgroundColor);
    const bd = ['Top', 'Right', 'Bottom', 'Left'].some((k) => parseFloat(s['border' + k + 'Width']) > 0 && s['border' + k + 'Style'] !== 'none' && alpha(s['border' + k + 'Color']) > 0.05);
    return bg || bd || (!!s.boxShadow && s.boxShadow !== 'none') || (!!s.backgroundImage && s.backgroundImage !== 'none');
  }
  /* 取樣點的元素 → 障礙外框 { l, t, r, b, p 間隔, k 種類 i 可以點 / m 圖片 / t 文字 / c 卡片 }。
     o:{ text, media, cards, anchor 站的那個元素(只算它的文字,包著它的卡片不算) };env 由呼叫的人給(瀏覽器或測試的假 DOM) */
  function obstaclesOf(elems, o, env) {
    const out = [];
    const push = (r, p, k) => { if (r && r.width > 0.5 && r.height > 0.5) out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom, p, k }); };
    const texts = (e) => env.textRects(e).forEach((r) => push(r, CFG.padO, 't'));
    for (const e of elems) {
      if (env.skip(e)) continue;
      const s = env.style(e);
      if (!shown(s)) continue;
      if (o.anchor && e === o.anchor) { if (o.text) texts(e); continue; }
      if (isClickable(e, s)) { push(env.rect(e), CFG.padI, 'i'); continue; }
      if (MEDIA.has(e.tagName.toLowerCase())) { if (o.media) push(env.rect(e), CFG.padO, 'm'); continue; }
      if (o.text) texts(e);
      if (o.cards && !(o.anchor && e.contains(o.anchor)) && isSurface(s, e.parentElement ? env.style(e.parentElement) : null)) push(env.rect(e), CFG.padO, 'c');
    }
    return out;
  }
  /* 小雞框 [v, v+size]×[top, bot] 不碰到任何障礙(含間隔)的 v 範圍。框的上緣本來就留了頭頂的空,
     所以框上方的文字、圖片、卡片不再另加間隔;可以點的東西四邊都加 */
  const hits = (o, top, bot) => o.t - o.p < bot && o.b + (o.k === 'i' ? o.p : 0) > top;
  function freeSpans(obs, lo, hi, top, bot, size) {
    const S = size || CFG.size, bl = [];
    for (const o of obs) if (hits(o, top, bot)) bl.push([o.l - o.p - S, o.r + o.p]);
    bl.sort((a, b) => a[0] - b[0]);
    const out = [];
    let cur = lo;
    for (const [a, b] of bl) {
      if (b <= cur) continue;
      if (a > cur) out.push([cur, Math.min(a, hi)]);
      cur = Math.max(cur, b);
      if (cur > hi) break;
    }
    if (cur <= hi) out.push([cur, hi]);
    return out.map(([a, b]) => [Math.ceil(a), Math.floor(b)]).filter(([a, b]) => b >= a);
  }
  function clearAt(obs, v, top, bot, size) {
    const S = size || CFG.size;
    return !obs.some((o) => hits(o, top, bot) && o.l - o.p - S < v && o.r + o.p > v);
  }
  /* 主要內容外左右各有 80 px 以上的空白:那一欄也是站點(兩邊各留 16 px) */
  function sideColumns(mainL, mainR, vw) {
    const out = [], S = CFG.size, g = CFG.gap;
    if (mainL >= CFG.sideMin) out.push({ side: 'left', lo: g, hi: Math.floor(mainL - g - S) });
    if (vw - mainR >= CFG.sideMin) out.push({ side: 'right', lo: Math.ceil(mainR + g), hi: vw - g - S });
    return out;
  }
  /* 往旁邊飛時往前進的方向斜:最多 11 度,中段最斜、頭尾回正,橫移不到 60 px 照比例 */
  function leanFor(dx, p) {
    const q = Math.min(1, Math.max(0, p));
    return Math.sign(dx) * CFG.leanMax * Math.min(1, Math.abs(dx) / CFG.leanFull) * Math.sin(Math.PI * q);
  }
  /* 往上飛 dist px:照 flyPlan 的拍子(每秒 12 拍),下拍的抬升等比放大到剛好飛到;飛不到(超過 2.5 秒的高度)回 null。
     minDur:至少飛幾秒(電腦版到處走橫移遠時,每秒約 400 px)。cum[i] 是第 i 拍開始時的位移(負 = 往上),frames[i] 是 [格, 抖動組] */
  function flyFrames(dist, plan, minDur) {
    plan = plan || (root.ChickArt && root.ChickArt.flyPlan);
    if (!(dist > 0) || dist > CFG.maxRise || !plan || !plan.length) return null;
    const n = Math.max(8, Math.round(Math.min(CFG.flyMax, Math.max(1, dist / 160, minDur || 0)) * 12));
    const at = (i) => plan[i % plan.length];
    let ups = 0, downs = 0;
    for (let i = 0; i < n; i++) { const v = at(i)[2]; if (v < 0) ups -= v; else downs += v; }
    const k = (dist + downs) / ups, cum = [0], frames = [];
    for (let i = 0; i < n; i++) {
      const p = at(i);
      cum.push(cum[i] + (p[2] < 0 ? p[2] * k : p[2]));
      frames.push([p[0], (p[1] + Math.floor(i / plan.length)) % 2]);
    }
    return { n, dur: n / 12, k, cum, frames };
  }
  /* 在 [x0,x1]×[y0,y1] 取樣(視窗座標,夾在視窗裡):格點加四角和中心;點太多就放大間距 */
  function samplePoints(x0, x1, y0, y1, step, W, H) {
    const cx = (v) => Math.min(W - 0.5, Math.max(0.5, v)), cy = (v) => Math.min(H - 0.5, Math.max(0.5, v));
    const a = cx(x0 + 0.5), b = cx(x1 - 0.5), c = cy(y0 + 0.5), d = cy(y1 - 0.5);
    let st = step;
    while (((b - a) / st + 2) * ((d - c) / st + 2) > CFG.maxPts) st *= 1.5;
    const xs = [], ys = [], out = [];
    for (let v = a; v < b; v += st) xs.push(v);
    xs.push(b);
    for (let v = c; v < d; v += st) ys.push(v);
    ys.push(d);
    for (const y of ys) for (const x of xs) out.push([x, y]);
    out.push([(a + b) / 2, (c + d) / 2]);
    return out;
  }
  const util = Object.freeze({ freeSpans, clearAt, sideColumns, leanFor, flyFrames, obstaclesOf, samplePoints, isClickable, isSurface, shown });
  if (typeof module === 'object' && module && module.exports) { module.exports = { util, CFG }; return; }

  const doc = root.document;
  if (!doc || root.PET_ROAM2) return;
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
  const spanAt = (list, v) => list.find(([a, b]) => v >= a - 1 && v <= b + 1) || null;
  function nearest(list, v) {
    let best = null, d = Infinity;
    for (const [a, b] of list) { const c = Math.max(a, Math.min(b, v)); if (Math.abs(c - v) < d) { d = Math.abs(c - v); best = c; } }
    return best;
  }
  function pageName() {
    let p = String((root.location && root.location.pathname) || '').split('/').pop() || 'index.html';
    if (p.indexOf('.') < 0) p += '.html';
    return p;
  }

  function boot() {
    const U = root.PET_UI, A = root.ChickArt;
    if (root.PET_ROAM2 || !U || typeof U.onChange !== 'function' || !A || !(A.version >= 5) || typeof A.animate !== 'function') return;
    if (doc.querySelector('.pet-roam') || doc.querySelector('div.pet-roam2')) return;   // <html> 也有 pet-roam2,一律寫 div.pet-roam2
    const html = doc.documentElement, tabbar = doc.querySelector('.app-tabbar'), page = pageName();
    const shell = html.classList.contains('app-shell');
    const APP = shell && !!tabbar;
    if (!APP && (shell || WEB_PAGES.indexOf(page) < 0)) return;
    start(U, A, html, tabbar, APP, page, APP ? html.classList.contains('is-tab-root') : true);
  }

  function start(U, A, html, tabbar, APP, PAGE, MAIN) {
    const S = CFG.size, M = A.metrics;
    const BOXH = Math.round(S * M.ground / M.width);
    const layer = doc.createElement('div');
    layer.className = 'pet-roam2 is-ground is-init';   // 第一次排好位置之前看不到(css),免得在左緣或卡片旁邊閃一下
    const btn = doc.createElement('button');
    btn.className = 'pet-roam2-btn';
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-haspopup', 'dialog');
    const cv = doc.createElement('canvas');
    cv.className = 'pet-roam2-cv';
    cv.setAttribute('aria-hidden', 'true');
    btn.append(cv);
    layer.append(btn);
    const mainEl = doc.querySelector('main');
    if (APP) tabbar.before(layer);
    else if (mainEl) mainEl.after(layer);
    else doc.body.append(layer);
    html.classList.add('pet-roam2', 'has-pet');
    root.PET_ROAM = true;

    const reduced = !!U.reduced;
    let roamOff = false;
    const still = () => reduced || roamOff || !MAIN;
    let mode = 'ground', x = 0, gy = 0, feetDoc = 0, origin = 0, dir = Math.random() < 0.5 ? 1 : -1, lean = 0;
    let lane = [0, 0], groundOff = CFG.webLift, perch = null, faded = false, off = false, sheetOpen = false, scrolling = false;
    let act = null, turning = 0, held = false, flown = false, script = null, raf = 0, perchTimer = 0, lastFrame = '', lastMood = null, mine = false;
    let failAt = 0;
    const enteredAt = performance.now();
    const anim = A.animate(cv, { size: S, fps: 8, maxDpr: 2, pose: 'idle', onTick });
    const Z = !APP && MAIN && root.PET_ROAM_ZONES && root.PET_ROAM_ZONES.version === 1 ? root.PET_ROAM_ZONES : null, ZST = Object.freeze({ sel: 'zone', edge: 'zone' });
    let wide = false, wz = null, curPose = 'idle';

    /* ---------- 儲存:只有上一頁的 x(和上次試飛失敗的時間,最多每 3 分鐘一次) ---------- */
    function readKey() {
      try { const v = String(sessionStorage.getItem(KEY) || '').split(','); return { x: v[0] === '' ? NaN : Number(v[0]), fail: Number(v[1]) || 0 }; } catch (e) { return { x: NaN, fail: 0 }; }
    }
    function writeKey() {
      try { sessionStorage.setItem(KEY, Math.round(x) + (failAt ? ',' + failAt : '')); } catch (e) { /* 私密視窗、存不了:下一頁從隨機的位置開始 */ }
    }

    /* ---------- 版面(只在換動作、捲動停下、內容變動、轉向時量;每格只改 transform) ---------- */
    function measure() {
      const cs = getComputedStyle(layer), W = html.clientWidth;
      lane = [Math.ceil(parseFloat(cs.paddingLeft) || 0), Math.floor(W - (parseFloat(cs.paddingRight) || 0) - S)];
      if (lane[1] < lane[0]) lane[1] = lane[0];
      if (!APP && mode === 'ground' && !off) { const b = layer.getBoundingClientRect().bottom; if (b > 0) groundOff = innerHeight - b; }
    }
    const clampLane = (v) => Math.max(lane[0], Math.min(lane[1], v));
    const groundLine = () => (APP ? tabbar.getBoundingClientRect().top : innerHeight - groundOff);
    function topLimit() { const t = doc.querySelector('.topbar'); return t ? Math.max(0, t.getBoundingClientRect().bottom) : 0; }
    let range = null;
    const env = {
      skip: (e) => e === html || e === doc.body || layer.contains(e) || (!!tabbar && tabbar.contains(e)) ||
        !!e.closest('.pet-mask,.modal-mask,.topbar') || (e instanceof SVGElement && e.tagName.toLowerCase() !== 'svg'),
      style: (e) => getComputedStyle(e),
      rect: (e) => e.getBoundingClientRect(),
      textRects(e) {
        const out = [];
        range = range || doc.createRange();
        for (const n of e.childNodes) {
          if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) out.push(r);
        }
        return out;
      },
    };
    function collect(x0, x1, y0, y1, o) {
      const seen = new Set(), els = [];
      for (const [px, py] of samplePoints(x0, x1, y0, y1, CFG.step, html.clientWidth, innerHeight)) {
        for (const e of doc.elementsFromPoint(px, py)) if (!seen.has(e)) { seen.add(e); els.push(e); }
      }
      return obstaclesOf(els, o, env);
    }
    function mainBox() {
      if (!mainEl) return null;
      const r = mainEl.getBoundingClientRect(), s = getComputedStyle(mainEl);
      return { l: r.left + (parseFloat(s.paddingLeft) || 0), r: r.right - (parseFloat(s.paddingRight) || 0) };
    }

    /* ---------- 站點 ---------- */
    /* 站點現在的位置:腳的高度、小雞左緣可以在的範圍、框下面要看多少 */
    function geom(st, a) {
      const W = html.clientWidth, r = a.getBoundingClientRect();
      if (st.edge === 'side') {
        const m = mainBox(), col = m && sideColumns(m.l, m.r, W).find((c) => c.side === st.side);
        return col ? { feet: r.top, lo: col.lo, hi: col.hi, below: CFG.padO } : null;
      }
      if (st.edge === 'top') return { feet: r.top, lo: Math.max(0, r.left + 8), hi: Math.min(W - S, r.right - S - 8), below: CFG.padO };
      const right = (a.parentElement || a).getBoundingClientRect().right;
      return { feet: r.bottom, lo: Math.max(0, r.left), hi: Math.min(W - S, right - S), below: CFG.padI };
    }
    function spansOf(st, a, g) {
      const obs = collect(g.lo - CFG.padI, g.hi + S + CFG.padI, g.feet - BOXH - CFG.padI, g.feet + g.below,
        { text: true, media: true, cards: true, anchor: st.edge === 'side' ? null : a });
      return freeSpans(obs, g.lo, g.hi, g.feet - BOXH, g.feet);
    }
    const inView = (feet) => feet - BOXH >= topLimit() + 4 && feet <= groundLine() - BOXH - 8;
    function addCand(out, st, a) {
      const g = geom(st, a);
      if (!g || g.hi < g.lo || !inView(g.feet) || !flyFrames(groundLine() - g.feet)) return;
      const sp = spansOf(st, a, g);
      if (sp.length) out.push({ st, a, g, sp });
    }
    /* 網站模式兩側空白的高度:對齊主要內容裡一張看得到、不能點的卡片上緣(沿著內容邊緣往下取樣) */
    function sideCards(sx) {
      const out = [], top = topLimit() + BOXH + 4, bot = groundLine() - BOXH - 8;
      for (let y = top + 2; y < bot && out.length < 4; y += 24) {
        for (const e of doc.elementsFromPoint(sx, y)) {
          if (e === mainEl || !mainEl.contains(e) || out.includes(e)) continue;
          const s = getComputedStyle(e);
          if (!shown(s) || isClickable(e, s) || e.closest(CLICK_UP) || !isSurface(s, e.parentElement ? getComputedStyle(e.parentElement) : null)) continue;
          const t = e.getBoundingClientRect().top;
          if (t >= top && t <= bot) { out.push(e); break; }
        }
      }
      return out;
    }
    function stations() {
      const out = [];
      for (const st of STATIONS[PAGE] || []) {
        const a = Array.from(doc.querySelectorAll(st.sel)).find((e) => shown(getComputedStyle(e)) && e.getBoundingClientRect().width > 0);
        if (!a || isClickable(a, getComputedStyle(a)) || a.closest(CLICK_UP)) continue;
        addCand(out, st, a);
      }
      const m = !APP && mainEl ? mainBox() : null;
      if (m) {
        for (const col of sideColumns(m.l, m.r, html.clientWidth)) {
          const cards = sideCards(col.side === 'left' ? m.l + 12 : m.r - 12);
          if (cards.length) addCand(out, { sel: 'side-' + col.side, edge: 'side', side: col.side }, cards[Math.floor(Math.random() * cards.length)]);
        }
      }
      return out;
    }

    /* ---------- 擺位置 ---------- */
    function place() {
      const y = (mode === 'air' ? feetDoc - BOXH - origin : 0) + gy;
      btn.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      cv.classList.toggle('is-left', dir < 0);
      cv.style.transform = (lean ? 'rotate(' + lean.toFixed(1) + 'deg)' : '') + (dir < 0 ? ' scaleX(-1)' : '');
    }
    function toAir() {
      if (mode === 'air') return;
      mode = 'air';
      layer.classList.remove('is-ground');
      layer.classList.add('is-air');
      origin = layer.getBoundingClientRect().top + scrollY;
      gy = 0;
    }
    function toGround() {
      mode = 'ground';
      perch = null;
      clearTimeout(perchTimer);
      btn.classList.remove('is-perch');
      layer.classList.remove('is-air');
      layer.classList.add('is-ground');
      gy = 0;
      x = clampLane(x);
      if (wz) wz.at = 'ground';
    }
    function frame(pose, k, v) {
      const key = pose + k + v;
      if (key === lastFrame) return;
      lastFrame = key;
      anim.show(k, v, pose);
    }
    function setPose(p) { lastFrame = ''; curPose = p; anim.setPose(p); syncMove(); }
    function showStill() { const m = U.mood(); lastFrame = ''; curPose = m; anim.show(A.calm[m] || 0, 0, m); syncMove(); }
    function syncMove() { if (Z) layer.classList.toggle('is-move', wide && !held && (!!script || ((curPose === 'walk' || curPose === 'run') && !still()))); }   // 電腦版:走、跳、飛時點擊穿過,停著才點得到
    /* 鍵盤焦點(看得到焦點框)在小雞上:不淡出、不飛、站點上不飛走(規格 1.2、1.8)。點小雞(觸控、滑鼠)、關掉面板後
       pet-ui 把焦點放回來,沒有焦點框,不算(第三輪審查 #3:不然卡片捲回畫面時兩隻同時在) */
    let hovered = false, keyFocus = false;
    const focusShown = () => { try { return btn.matches(':focus-visible'); } catch (e) { return false; } };
    const focused = () => doc.activeElement === btn && (keyFocus || focusShown());

    /* ---------- 畫面上只有一隻:有小雞的卡片在畫面上時原地淡出 ---------- */
    function twin() {
      const top = topLimit(), bot = groundLine();
      for (const c of doc.querySelectorAll('.pet-card')) {
        if (c.hidden) continue;
        const r = c.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.bottom > top && r.top < bot) return true;
      }
      return false;
    }
    function setFaded(want) {
      if (want === faded || (want && focused())) return;
      faded = want;
      layer.classList.toggle('is-faded', faded);
      btn.inert = faded;
      if (faded) {
        stopScript();
        anim.stop();
      } else { lastFrame = ''; if (!off) next(); }
    }

    /* ---------- 要不要整層藏起來 ---------- */
    function typing() {
      const a = doc.activeElement;
      if (!a || a === btn || a === doc.body) return false;
      if (a.isContentEditable || a.tagName === 'TEXTAREA') return true;
      return a.tagName === 'INPUT' && !/^(button|checkbox|radio|range|submit|reset|file|color|image|hidden)$/i.test(a.type || 'text');
    }
    function gameOn() {
      const g = Array.from(doc.querySelectorAll(GAME)).some((e) => e.getClientRects().length && shown(getComputedStyle(e)));
      return g && !doc.querySelector('.report-head,.game-over');
    }
    /* 這一層畫不出來:小雞關掉(hidden),或 App 模式分頁列藏起來的寬視窗(css 跟分頁列用同一組條件,看分頁列就知道)。
       不能看這一層自己:停住時加的 is-off 也是 display: none */
    const unshown = () => layer.hidden || (APP && tabbar.getClientRects().length === 0);
    function offCheck() {
      const now = unshown() || sheetOpen || !!doc.querySelector('.modal-mask') || html.classList.contains('app-kb') || typing() || gameOn() || doc.visibilityState === 'hidden';
      if (now === off) return off;
      off = now;
      layer.classList.toggle('is-off', off);
      if (off) { stopScript(); anim.stop(); if (mode === 'air' && !perch) { toGround(); place(); } }
      else { lastFrame = ''; measure(); place(); if (wz && wz.dirty) remeasure(); next(); }   // 藏著的時候內容變了:馬上看腳下那塊還在不在(第三輪審查 #1)
      return off;
    }

    /* ---------- 量完決定要怎麼站 ---------- */
    function settle() {
      if (offCheck() || script || scrolling) { if (wz) wz.dirty = true; return; }   // 飛完、回到畫面上的時候再量
      measure();
      setFaded(twin());
      if (mode === 'air') checkPerch(true);
      else { x = clampLane(x); place(); if (wide) remeasure(); }
    }
    /* 站點上:還在可見範圍(碰到頂欄、分頁列或視窗下緣就直接回地面)、錨點沒移動、腳下那一格沒被新東西佔走(80 px 以內小跳) */
    function checkPerch(full) {
      if (!perch || script) return;
      const feet = perch.feetDoc - scrollY;
      if (feet - BOXH < topLimit() || feet > groundLine()) { snapGround(); return; }
      if (!full) return;
      if (perch.zone) { remeasure(); return; }   // 空地:量完看腳下那塊還在不在(zoneRecheck)
      const a = perch.a, g = a.isConnected && shown(getComputedStyle(a)) ? geom(perch.st, a) : null;
      if (!g || !(Math.abs(g.feet - feet) < 2) || g.hi < g.lo) { descend(); return; }
      const sp = spansOf(perch.st, a, g), here = spanAt(sp, x);
      if (here) { perch.span = here; return; }
      const nx = nearest(sp, x);
      if (nx !== null && Math.abs(nx - x) <= CFG.hopMax) { perch.span = spanAt(sp, nx); hop(nx); } else descend();
    }
    /* 不播動畫直接回地面,從比較近的一側走進來(規格 1.7) */
    function snapGround() {
      abortScript();
      const left = x + S / 2 < html.clientWidth / 2;
      toGround();
      x = left ? lane[0] : lane[1];
      dir = left ? 1 : -1;
      place();
      if (!still() && !off && !faded && !held) { act = { pose: 'walk', left: rand(12, 24) }; turning = 0; setPose('walk'); }
      else next();
    }

    /* ---------- 一般走動(引擎計時器每拍呼叫) ---------- */
    const span = () => (mode === 'air' ? perch && perch.span : lane);
    function onTick(t) {
      if (script || off || faded || still() || scrolling || held) return;
      if (turning > 0) {
        if (--turning === 0) { dir = -dir; place(); setPose(act ? act.pose : 'idle'); }
        return;
      }
      if (t.pose === 'walk' || t.pose === 'run') {
        const sp = span();
        if (!sp) { next(); return; }
        x += dir * t.travel;
        if (x <= sp[0] || x >= sp[1]) {
          x = Math.max(sp[0], Math.min(sp[1], x));
          turning = wide ? 0 : CFG.turnTicks;   // 電腦版的空地和地面:走到邊就站著,不來回踱步
          setPose(U.mood() === 'hungry' ? 'hungry' : 'idle');
        }
        place();
      }
      if (act && --act.left <= 0) next();
    }
    function next() {
      if (script || off || faded) return;
      layer.classList.toggle('is-still', still());
      if (still()) { showStill(); return; }
      if (held) { setPose(U.mood()); return; }
      if (wide && wideNext()) return;
      if (mode === 'ground' && (maybeFly() || maybeFail())) return;
      const m = U.mood(), r = Math.random(), sp = span();
      const roomy = !!sp && sp[1] - sp[0] >= 8;
      if (m === 'sleep') act = { pose: 'sleep', left: Infinity };
      else if (m === 'hungry') act = r < 0.65 || !roomy ? { pose: 'hungry', left: rand(30, 60) } : { pose: 'walk', left: rand(10, 20) };
      else if (wide && sp) act = Z.stroll(sp, x, Math.random, mode === 'ground');   // 電腦版的空地和地面都多半站著,不跑(第三輪審查 #3)
      else if (r < 0.35 || !roomy) act = { pose: 'idle', left: rand(16, 32) };
      else if (r < 0.85) act = { pose: 'walk', left: rand(20, 48) };
      else act = { pose: 'run', left: rand(12, 24) };
      if (act.dir) dir = act.dir; else if ((act.pose === 'walk' || act.pose === 'run') && Math.random() < 0.3) dir = -dir;
      turning = 0; setPose(act.pose); place();
    }

    /* ---------- 一個 requestAnimationFrame 迴圈播一串動作 ---------- */
    function play(segs, done, air, how) {
      abortScript();
      script = { segs, i: 0, t0: performance.now(), done, air: !!air, how };
      if (air) { layer.classList.add('is-fly'); btn.tabIndex = -1; }   // 飛行中點擊穿過小雞,落到底下的東西
      syncMove();
      raf = requestAnimationFrame(step);
    }
    function step(now) {
      if (!script) return;
      let t = Math.max(0, (now - script.t0) / 1000);
      let sg = script.segs[script.i];
      while (t >= sg.dur) {
        sg.apply(sg.dur);
        if (!script) return;
        if (sg.end) sg.end();
        if (!script) return;
        script.i++; script.t0 += sg.dur * 1000; t -= sg.dur;
        if (script.i >= script.segs.length) { const d = script.done; endScript(); if (d) d(); return; }
        sg = script.segs[script.i];
      }
      sg.apply(t);
      if (script) raf = requestAnimationFrame(step);
    }
    function endScript() {
      const air = script && script.air;
      script = null;
      cancelAnimationFrame(raf);
      if (air) { btn.removeAttribute('tabindex'); layer.classList.remove('is-fly'); }
      /* 地面上跳到一半(試飛失敗、小跳)被中止時 gy 還沒歸零:一起放回去,不然之後一直浮在地面上面(第三輪審查 #7) */
      if (lean || gy) { lean = 0; gy = 0; place(); }
      syncMove();
    }
    function abortScript() { if (script) endScript(); }
    /* 中止正在播的動作;飛上去或落下來到一半(在空中、不在站點上)直接回地面(第三輪審查 #6) */
    function stopScript() {
      const flying = !!script && script.air && !perch;
      abortScript();
      if (flying) { toGround(); place(); }
    }
    /* 照引擎的 hold 播一個姿勢;pos(p) 收 0 到 1 的進度 */
    function seq(pose, pos) {
      const fps = A.fps[pose] || 8, ticks = [];
      A.holds(pose).forEach((h, k) => { for (let j = 0; j < h; j++) ticks.push([k, j]); });
      const n = ticks.length;
      return { dur: n / fps, apply(t) {
        const i = Math.min(n - 1, Math.floor(t * fps));
        frame(pose, ticks[i][0], ticks[i][1] % 2);
        if (pos) { pos(Math.min(1, t * fps / n)); place(); }
      } };
    }

    /* ---------- 飛上站點 ---------- */
    function maybeFly() {
      if (wide || flown || !MAIN || still() || mode !== 'ground' || script || off || faded || scrolling || held || sheetOpen || focused()) return false;
      if (performance.now() - enteredAt < CFG.flyAfter) return false;
      const v = U.view(), st = v && v.status;
      if (!st || st.hungry || U.mood() !== 'idle') return false;
      flown = true;
      if (Math.random() >= CFG.flyChance) return false;
      return flyUp();
    }
    function flyUp() {
      const c = stations();
      if (!c.length) return false;
      const pick = c[Math.floor(Math.random() * c.length)];
      const sp = pick.sp.slice().sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
      const tx = sp[0] + Math.random() * (sp[1] - sp[0]);
      const gl = groundLine(), F = flyFrames(gl - pick.g.feet);
      if (!F) return false;
      const sy = scrollY, x0 = x;
      toAir();
      const start = gl + sy, end = pick.g.feet + sy;
      feetDoc = start;
      dir = tx >= x0 ? 1 : -1;
      place();
      const lost = () => { const f = end - scrollY; return f - BOXH < topLimit() || f > groundLine(); };
      const fly = { dur: F.dur, apply(t) {
        if (lost()) { snapGround(); return; }
        const f = Math.min(F.n - 0.001, t * 12), n = Math.floor(f), fr = f - n, d = F.cum[n + 1] - F.cum[n];
        feetDoc = start + F.cum[n] + d * (d < 0 ? 1 - (1 - fr) * (1 - fr) : fr);   // 下拍一開始衝最快
        const p = Math.min(1, t / F.dur);
        x = x0 + (tx - x0) * ease(p);
        lean = leanFor(tx - x0, p);
        frame('fly', F.frames[n][0], F.frames[n][1]);
        place();
      }, end() { feetDoc = end; x = tx; lean = 0; place(); } };
      play([seq('takeoff'), fly, seq('land')], () => {
        perch = { st: pick.st, a: pick.a, feetDoc: end, span: spanAt(pick.sp, tx) || [tx, tx] };
        if (pick.st.edge !== 'right') btn.classList.add('is-perch');   // 站在上緣:可點範圍往上移 8 px
        perchTimer = setTimeout(perchEnd, rand(CFG.perchMin, CFG.perchMax));
        next();
      }, true);
      return true;
    }
    /* 站的時間到了:滑鼠停在牠身上、鍵盤焦點在牠身上時不飛走,過一下再看(規格 1.8) */
    function perchEnd() { if (held || focused()) perchTimer = setTimeout(perchEnd, CFG.perchRetry); else descend(); }
    /* 撲著翅膀落回地面(fly 第 1、2 格慢速循環,邊撲邊掉,最多 1.2 秒) */
    function descend() {
      clearTimeout(perchTimer);
      if (mode !== 'air') return;
      /* 站點上正在播一小段(拿到點心開心跳一下、站點上的小跳):過一下再看。以前直接回去,之後沒人再排,小雞一直站著(chick2 第二輪修正 #6) */
      if (script) { if (perch) perchTimer = setTimeout(perchEnd, CFG.perchRetry); return; }
      if (off || sheetOpen || faded || still()) { snapGround(); return; }
      perch = null;   // 一開始落就離開站點:途中被中止(切到背景、淡出)時照「飛到一半」回地面,不會卡在半空(第三輪審查 #6)
      const gl = groundLine(), start = feetDoc, x0 = x, tx = clampLane(x), sy0 = scrollY;
      const D = Math.min(CFG.fallMax, Math.max(0.6, (gl + sy0 - start) / 520));
      dir = tx >= x0 ? 1 : -1;
      btn.classList.remove('is-perch');
      const fall = { dur: D, apply(t) {
        const p = Math.min(1, t / D), end = gl + scrollY;   // 落的途中捲動:地面跟著視窗走
        feetDoc = start + (end - start) * p * p;
        x = x0 + (tx - x0) * ease(p);
        lean = leanFor(tx - x0, p);
        frame('fly', Math.floor(t * 6) % 2, 0);
        place();
      }, end() { x = tx; lean = 0; toGround(); place(); } };
      play([fall, seq('land')], () => next(), true);
    }

    /* ---------- 小跳、試飛失敗、開心一下 ---------- */
    function hop(nx) {
      const x0 = x;
      dir = nx >= x0 ? 1 : -1;
      const jump = { dur: CFG.hopDur, apply(t) {
        const p = Math.min(1, t / CFG.hopDur);
        x = x0 + (nx - x0) * p; gy = -64 * p * (1 - p);
        frame('takeoff', p < 0.5 ? 1 : 2, 0); place();
      }, end() { x = nx; gy = 0; place(); } };
      play([jump, { dur: 0.25, apply(t) { frame('land', t < 0.125 ? 0 : 1, 0); } }], () => next());
    }
    function maybeFail() {
      if (!MAIN || still() || mode !== 'ground' || held || faded || Math.random() >= CFG.failChance) return false;
      if (Date.now() - failAt < CFG.failEvery) return false;
      failAt = Date.now();
      writeKey();
      const rise = { dur: 4 / 12, apply(t) { gy = -30 * Math.min(1, t * 3); frame('fly', Math.min(3, Math.floor(t * 12)), 0); place(); } };
      const drop = { dur: 2 / 12, apply(t) { gy = -30 * (1 - Math.min(1, t * 6)); frame('fly', 6, 0); place(); }, end() { gy = 0; place(); } };
      play([seq('takeoff'), rise, drop, seq('flop')], () => next());
      return true;
    }
    /* 餵完吃東西、拿到點心:播一次(練習頁的靜止小雞也跳一下);減少動態、關掉走動、淡出、看不到時不播 */
    function playOnce(list) {
      if (reduced || roamOff || script || off || faded) return;
      play(list.map((p) => seq(p)), () => next());
    }

    /* ---------- 電腦版到處走(規格 1.11;空地、路線、權重、途中位置在 js/pet-roam-zones.js) ---------- */
    function wzReset() { wide = !!Z && html.clientWidth >= Z.CFG.minW; wz = wide ? Z.memory(performance.now(), Math.random) : null; }
    /* 量空地:捲動停下、視窗大小改變、內容變動時,最多每秒一次。腳下那塊還在就留著,不在就小跳到 80 px 內的空地,再不行落回地面 */
    function remeasure() {
      if (!wide || off || faded || script || scrolling || still() || U.mood() !== 'idle') { if (wz) wz.dirty = true; return; }   // 不能走的時候不量,能走了 wanderTick 再量
      const now = performance.now(), wait = wz.measuredAt + Z.CFG.remeasure - now, w = wz;
      if (wait > 0) { if (!w.pend) w.pend = setTimeout(() => { w.pend = 0; if (wz === w) remeasure(); }, wait); return; }
      const m = mainBox(), W = html.clientWidth;
      Object.assign(wz, { measuredAt: now, dirty: false, main: m });
      const res = Z.measure({ doc, mainEl, W, H: innerHeight, docH: html.scrollHeight, top: topLimit(), bottom: groundLine() - BOXH - 8, scrollY, S, BOXH,
        mainL: m ? m.l : 0, mainR: m ? m.r : W, util, env, now: () => performance.now() });
      wz.zones = res.zones; wz.ms = res.ms;
      if (!perch || !perch.zone || script) return;
      const z = wz.zones.find((q) => Math.abs(q.feetDoc - perch.feetDoc) < 2 && x >= q.lo - 1 && x <= q.hi + 1);
      if (z) { perch.zone = z; perch.span = [z.lo, z.hi]; return; }
      const h = Z.hopNear(wz.zones, perch.feetDoc, x, CFG.hopMax).find((c) => landOk(c.z, c.tx));
      if (h) goZone({ z: h.z, tx: h.tx, how: 'hop', dur: Z.CFG.hopDur }); else descend();
    }
    const groundZone = () => ({ key: 'ground', ground: true, feet: groundLine(), lo: lane[0], hi: lane[1], x });
    /* 落地前照 1.4 用 elementsFromPoint 再確認一次 */
    function landOk(z, tx) {
      const f = z.feetDoc - scrollY, o = collect(tx - CFG.padI, tx + S + CFG.padI, f - BOXH - CFG.padI, f + CFG.padI, { text: true, media: true, cards: true });
      return clearAt(Z.landObs(o, f, html.clientWidth), tx, f - BOXH, f);
    }
    /* 換到另一塊:小跳、努力飛、撲著翅膀落下(途中照 Z.glideAt);回地面照 descend()。途中點擊穿過(is-fly、is-move) */
    function goZone(d) {
      const z = d.z, now = performance.now(), how = d.how, tl = topLimit();
      Z.arrived(wz, z.key, now, Math.random);
      if (z.ground) { wz.arrive = true; descend(); return; }   // 回到地面也先站 1 到 2 秒
      const f0 = mode === 'air' ? feetDoc : groundLine() + scrollY, x0 = x, dx = d.tx - x0;
      const F = how === 'fly' && f0 - z.feetDoc > 2 ? flyFrames(f0 - z.feetDoc, null, Math.abs(dx) / Z.CFG.flySpeed) : null;
      const g = { how, F, f0, f1: z.feetDoc, D: F ? F.dur : d.dur, plan: A.flyPlan };
      if (how === 'fly') wz.lastFly = now;
      toAir(); perch = null; feetDoc = f0; dir = dx >= 0 ? 1 : -1; place();
      const mv = { dur: g.D, apply(t) {
        const fz = g.f1 - scrollY;
        if (fz - BOXH < tl || fz > groundLine()) { snapGround(); return; }   // 目的地捲出視窗:直接回地面
        const s = Z.glideAt(g, t);
        feetDoc = s.feet; x = x0 + dx * s.q; lean = how === 'hop' ? 0 : leanFor(dx, s.p);
        frame(s.pose, s.k, s.v); place();
      }, end() { feetDoc = g.f1; x = d.tx; lean = 0; place(); } };
      const land = how === 'hop' ? { dur: 0.25, apply(t) { frame('land', t < 0.125 ? 0 : 1, 0); } } : seq('land');
      play(how === 'fly' ? [seq('takeoff'), mv, land] : [mv, land], () => { perch = { st: ZST, zone: z, feetDoc: g.f1, span: [z.lo, z.hi] }; wz.arrive = true; next(); }, true, how);
    }
    /* next() 的電腦版部分:空地上餓了、要睡了就落回地面;剛到先站 1 到 2 秒;長休息時站著 */
    function wideNext() {
      if (mode === 'air' && perch && perch.zone && U.mood() !== 'idle') { descend(); return true; }
      const ms = wz.arrive ? rand(Z.CFG.arriveMin, Z.CFG.arriveMax) : wz.rest - performance.now();
      if (ms < 250) return false;
      wz.arrive = false; act = { pose: 'idle', left: Math.ceil(ms / 125) }; turning = 0; setPose('idle'); place();
      return true;
    }
    /* 每秒看一次:待夠了(15 到 40 秒)就挑下一塊;換 3 次後長休息 45 到 90 秒。餓、睡、忙、淡出、看不到、滑鼠或焦點在牠身上時不換 */
    function wanderTick() {
      if (!wide || script || off || faded || still() || scrolling || held || sheetOpen || focused()) return;
      const now = performance.now(), v = U.view(), st = v && v.status;
      if (wz.dirty || wz.measuredAt < 0) { remeasure(); if (script) return; }
      if (!st || st.hungry || U.mood() !== 'idle' || now < wz.until) return;
      if (wz.changes >= Z.CFG.longEvery) { wz.changes = 0; wz.rest = wz.until = now + rand(Z.CFG.longMin, Z.CFG.longMax); next(); return; }
      const here = mode === 'air' && perch && perch.zone ? Object.assign({}, perch.zone, { x, feet: perch.feetDoc - scrollY }) : groundZone();
      const d = Z.choose({ zones: wz.zones, here, ground: groundZone(), now, busy: tr.busy(now), calm: tr.calm(now), near: tr.near(now), mouse: tr.pointer(now), lastFly: wz.lastFly,
        recent: wz.recent, order: wz.order, H: innerHeight, top: topLimit(), bottom: groundLine() - BOXH - 8, scrollY, S, BOXH, flyFrames: (a, m) => flyFrames(a, null, m), rnd: Math.random });
      if (!d) { wz.until = now + Z.CFG.retry; return; }
      if (!d.z.ground && !landOk(d.z, d.tx)) { wz.zones = wz.zones.filter((q) => q !== d.z); wz.until = now + Z.CFG.retryLand; return; }
      goZone(d);
    }
    /* 滑鼠移到小雞上:走動中點擊穿過、收不到 pointerenter,改用小雞現在的位置算(不量版面):當場停下、點得到,移開 1 秒後再走 */
    const hover = (on) => { if (hovered !== on) { hovered = on; pause(); } };
    const tr = Z ? Z.tracker(root, doc, { now: () => performance.now(), mainLR: () => wz && wz.main, hover,
      box: () => (wide && !off && !faded ? { l: x, t: (mode === 'air' ? feetDoc - scrollY : innerHeight - groundOff) - BOXH + gy, w: S, h: BOXH } : null) }) : null;
    wzReset();

    /* ---------- 事件 ---------- */
    let scrollTimer = 0, mutTimer = 0;
    root.addEventListener('scroll', () => {
      scrolling = true;
      layer.classList.add('is-scroll');                 // 捲動中和停下來 150 毫秒內點擊穿過小雞,落到捲過來的內容
      if (perch) checkPerch(false);
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scrolling = false;
        layer.classList.remove('is-scroll');
        settle();
        if (!script && !off && !faded) next();
      }, CFG.scrollIdle);
    }, { passive: true });
    new MutationObserver((recs) => {
      if (mutTimer || recs.every((r) => layer.contains(r.target) || (r.target.closest && r.target.closest('.pet-mask')))) return;
      mutTimer = setTimeout(() => { mutTimer = 0; settle(); }, CFG.mutThrottle);
    }).observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
    const relayout = () => { offCheck(); measure(); if (Z && (html.clientWidth >= Z.CFG.minW) !== wide) { if (mode === 'air') snapGround(); wzReset(); syncMove(); } else if (wide && mode === 'air' && x > lane[1]) snapGround(); if (perch) checkPerch(true); else settle(); };   // 分頁列藏起來時停住;寬度跨過 1024 時回地面換規則;變窄後小雞在視窗外(右側空白不見了)直接回地面,不從視窗外飛回來、頁面不變寬(第二輪審查 #3)
    root.addEventListener('resize', relayout);
    root.addEventListener('orientationchange', relayout);
    new MutationObserver(() => offCheck()).observe(html, { attributes: true, attributeFilter: ['class'] });   // app-kb
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') { if (mode === 'ground') writeKey(); stopScript(); }
      offCheck();
    });
    doc.addEventListener('focusin', () => offCheck());
    doc.addEventListener('focusout', () => setTimeout(offCheck, 0));
    root.addEventListener('pagehide', () => { if (mode === 'ground') writeKey(); });
    /* 在別處按下手指時小雞先不接點擊,放開再恢復(拖字卡時放在小雞底下的空格收得到) */
    doc.addEventListener('pointerdown', (e) => { if (!btn.contains(e.target)) layer.classList.add('is-pass'); }, true);
    const unpass = () => setTimeout(() => layer.classList.remove('is-pass'), 0);
    doc.addEventListener('pointerup', unpass, true);
    doc.addEventListener('pointercancel', unpass, true);
    function pause() {
      const was = held;
      held = hovered || keyFocus;
      if (held && !script) { if (still()) showStill(); else setPose(U.mood()); } else if (was && !held) next();   // 靜止的小雞停住時也不抖
    }
    btn.addEventListener('focus', () => { keyFocus = focusShown(); pause(); });
    /* 焦點離開:有焦點時沒淡出的,現在補(第三輪審查 #3) */
    btn.addEventListener('blur', () => { keyFocus = false; pause(); if (!off && !scrolling) setFaded(twin()); });
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { if (tr) tr.stay(); hovered = true; pause(); } });
    btn.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { if (wide) tr.leave(); else { hovered = false; pause(); } } });
    btn.addEventListener('click', () => { if (script && script.air) return; mine = true; U.openSheet(btn); });
    root.addEventListener('pet:earn', (e) => { const d = e && e.detail; if (d && d.result === 'got') playOnce(['happy']); });

    measure();
    U.onChange((v, ev) => {
      if (!v.on || !v.status) { layer.hidden = true; html.classList.remove('has-pet'); abortScript(); offCheck(); return; }
      layer.hidden = false;
      offCheck();
      html.classList.add('has-pet');
      btn.setAttribute('aria-label', U.label(v) + '，打開餵食');
      const ro = v.roam === false, roamChanged = ro !== roamOff;
      if (roamChanged) { roamOff = ro; if (roamOff && mode === 'air') snapGround(); }
      if (ev.sheet === true) {
        /* 小雞面板打開:中止飛行回地面、整層隱藏 */
        sheetOpen = true;
        if (mode === 'air') { abortScript(); toGround(); place(); }
        offCheck();
        return;
      }
      if (ev.sheet === false) {
        /* 同一個回呼裡馬上顯示,pet-ui 接著把焦點放回小雞;牠淡出(inert)放不回去時改放到頁面標題 */
        sheetOpen = false;
        offCheck();
        setFaded(twin());
        if (mine && btn.inert) {
          const t = doc.querySelector('main h1') || doc.querySelector('h1');
          if (t) { if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1'); t.focus(); }
        }
        mine = false;
      }
      const m = U.mood(v);
      if (m !== lastMood || ev.sheet === false || roamChanged) { lastMood = m; if (!script) next(); }
      if (ev.fed) playOnce(['eat', 'happy']);
    });
    if ('IntersectionObserver' in root) {
      const io = new IntersectionObserver(() => { if (!scrolling) setFaded(twin()); });
      doc.querySelectorAll('.pet-card').forEach((c) => io.observe(c));
    }
    /* 每秒看一次要不要飛(在地面上、沒在播動作時) */
    setInterval(() => { if (wide) wanderTick(); else if (mode === 'ground' && !script && !off && !faded) maybeFly(); }, 1000);

    /* 第一次排好版以後才放位置:上一頁記下的 x,沒有就隨機(減少動態放中間) */
    requestAnimationFrame(() => {
      measure();
      const k = readKey();
      failAt = k.fail;
      x = isFinite(k.x) ? clampLane(k.x) : reduced ? (lane[0] + lane[1]) / 2 : lane[0] + Math.random() * (lane[1] - lane[0]);
      place();
      offCheck();
      setFaded(twin());
      next();
      layer.classList.remove('is-init');
    });

    root.PET_ROAM2 = Object.freeze({
      version: 1,
      /* 唯讀的快照,給預覽和量測腳本讀 */
      get state() {
        return Object.freeze({ mode: APP ? 'app' : 'web', main: MAIN, x: Math.round(x), ground: mode === 'ground',
          perch: perch ? perch.st.sel : null, faded, flying: !!(script && script.air), pose: anim.pose, still: still(), off, scrolling,
          wide, zone: wz ? wz.at : null, zones: wz ? wz.zones.length : 0, move: script ? script.how || 'act' : null, measureMs: wz ? Math.round(wz.ms * 10) / 10 : 0 });
      },
      util,
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
