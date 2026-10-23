/* 小雞第二階段的測試用假瀏覽器(tools/test_pet_roam_wide.js 用;原本在那個檔裡,第三輪審查後拆出來,讓測試檔留在 800 行以內)。
   sim(o) 建一個很小的假瀏覽器(時鐘、計時器、requestAnimationFrame、elementsFromPoint、捲動、視窗大小、MutationObserver),
   把 js/pet-roam-zones.js 和 js/pet-roam2.js 原樣載入。st.qsaStar 數量了幾次空地(querySelectorAll('*')),st.rects 數 getBoundingClientRect 叫了幾次。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = (f) => { try { return fs.readFileSync(path.join(REPO, f), 'utf8'); } catch (e) { return ''; } };
const ROAM = read('js/pet-roam2.js'), ZONES = read('js/pet-roam-zones.js');
/* ---------- 引擎資料(格數、fps、flyPlan)直接從 js/chick-art.js 拿 ---------- */
const ART = (() => { const c = { window: {}, console, Math, JSON, Object, Array, Number, String }; vm.createContext(c); vm.runInContext(read('js/chick-art.js'), c); return c.window.ChickArt; })();
function nodeLoad(src) { const mod = { exports: {} }; const c = { module: mod, console, Math, JSON, Object, Array, Number, String, Set, Map, Infinity, NaN, isFinite, parseFloat }; vm.createContext(c); vm.runInContext(src, c); return mod.exports; }
let Z = null;
try { Z = nodeLoad(ZONES); } catch (e) { Z = null; }
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const S = 48, BOXH = 51;
const ob = (l, t, r, b, k) => ({ l, t, r, b, k, p: k === 'i' ? 8 : 4 });
const hitBox = (o, x, top, bot) => o.l - o.p < x + S && o.r + o.p > x && o.t - o.p < bot && o.b + (o.k === 'i' ? o.p : 0) > top;

/* ---------- 很小的假瀏覽器 ---------- */
function parseSel(s) {
  const m = /^([a-z0-9]+)?((?:[#.][\w-]+|\[[^\]]+\])*)$/i.exec(s.trim());
  if (!m) return null;
  const out = { tag: m[1] ? m[1].toUpperCase() : null, ids: [], cls: [], attrs: [] };
  (m[2].match(/[#.][\w-]+|\[[^\]]+\]/g) || []).forEach((p) => {
    if (p[0] === '#') out.ids.push(p.slice(1)); else if (p[0] === '.') out.cls.push(p.slice(1));
    else { const a = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(p); out.attrs.push([a[1], a[2]]); }
  });
  return out;
}
function matchOne(e, s) {
  const p = parseSel(s);
  if (!p || !e || !e.tagName) return false;
  if (p.tag && e.tagName !== p.tag) return false;
  if (p.ids.some((i) => e.id !== i) || p.cls.some((c) => !e.classList.contains(c))) return false;
  return p.attrs.every(([k, v]) => e.hasAttribute(k) && (v === undefined || e.getAttribute(k) === v));
}
function matches(e, sel) {
  return sel.split(',').some((part) => {
    const ps = part.trim().split(/\s+/);
    if (!matchOne(e, ps[ps.length - 1])) return false;
    if (ps.length === 1) return true;
    for (let p = e.parentElement; p; p = p.parentElement) if (matchOne(p, ps[0])) return true;
    return false;
  });
}
const RECT = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t });
const CS0 = { display: 'block', visibility: 'visible', opacity: '1', cursor: 'auto', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', boxShadow: 'none',
  paddingLeft: '0px', paddingRight: '0px', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px',
  borderTopStyle: 'none', borderRightStyle: 'none', borderBottomStyle: 'none', borderLeftStyle: 'none',
  borderTopColor: 'rgb(0, 0, 0)', borderRightColor: 'rgb(0, 0, 0)', borderBottomColor: 'rgb(0, 0, 0)', borderLeftColor: 'rgb(0, 0, 0)' };
const WHITE = { backgroundColor: 'rgb(255, 255, 255)' };

/* 小雞的大小(2026-10-23 起每種模式一個數字,CFG.sizes):o.size 沒給時照 48 px 跑(這些模擬原本的數字都是照 48 px 調的,當成走法本身的回歸測試);
   o.size 是數字時三種模式都改成那個大小;'real' 照檔案裡的數字(tools/test_pet_roam_size.js 用)。沒有 sizes 那一行的舊版原樣載入 */
const SIZES_RE = /sizes: Object\.freeze\(\{ app: \d+, (appLand: \d+, )?web: \d+, wide: \d+ \}\)/;   // appLand:App 橫放(審查第 2 輪 #4)
function sized(src, size) {
  if (!src || size === 'real') return src;
  const n = size || 48;
  return src.replace(SIZES_RE, (m, land) => 'sizes: Object.freeze({ app: ' + n + ', ' + (land ? 'appLand: ' + n + ', ' : '') + 'web: ' + n + ', wide: ' + n + ' })');
}
/* o:{ src, zones(載入 js/pet-roam-zones.js), W, H, page, app, docH, seed, startX, build(add) 建頁面, ui:{ mood, hungry, roam, reduced }, size } */
function sim(o) {
  const st = { t: 0, scrollY: 0, W: o.W, H: o.H, qsaStar: 0, rects: 0 };
  const timers = []; let tid = 0, rafs = [];
  const rnd = mulberry(o.seed || 1);
  const docOn = {}, winOn = {}, muts = [], ios = [];
  let layer = null, tabbar = null;
  class El {
    constructor(tag, x) {
      x = x || {};
      this.tagName = tag.toUpperCase(); this.id = x.id || ''; this.attrs = Object.assign({}, x.attrs || {}); this._cls = (x.cls || '').split(/\s+/).filter(Boolean);
      this.cs = Object.assign({}, CS0, x.style || {}); this.box = x.box || null; this.fixed = !!x.fixed; this.texts = (x.texts || []).map((r) => ({ nodeType: 3, nodeValue: '字', r })); this.pseudo = x.pseudo || null;
      this.kids = []; this.parentElement = null; this.hidden = false; this.inert = false; this.on = {}; this.isConnected = true; this.isContentEditable = false;
      const vars = this.vars = {};
      this.style = {}; Object.defineProperty(this.style, 'setProperty', { value: (k, v) => { vars[k] = String(v); } });   // css 變數(--pet2-w、--pet2-h)記在 vars
      const self = this;
      this.classList = { add: (...c) => c.forEach((v) => { if (!self._cls.includes(v)) self._cls.push(v); }), remove: (...c) => { self._cls = self._cls.filter((v) => !c.includes(v)); },
        contains: (c) => self._cls.includes(c), toggle: (c, on) => { const w = on === undefined ? !self._cls.includes(c) : !!on; if (w) self.classList.add(c); else self.classList.remove(c); return w; } };
    }
    get className() { return this._cls.join(' '); }
    set className(v) { this._cls = String(v).split(/\s+/).filter(Boolean); }
    get parentNode() { return this.parentElement; }
    get childNodes() { return this.texts.concat(this.kids); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    set tabIndex(v) { this.attrs.tabindex = String(v); }
    append(...ns) { ns.forEach((n) => { n.parentElement = this; this.kids.push(n); }); }
    before(n) { const p = this.parentElement; n.parentElement = p; p.kids.splice(p.kids.indexOf(this), 0, n); }
    after(n) { const p = this.parentElement; n.parentElement = p; p.kids.splice(p.kids.indexOf(this) + 1, 0, n); }
    contains(n) { for (; n; n = n.parentElement) if (n === this) return true; return false; }
    all() { const out = []; const walk = (e) => e.kids.forEach((k) => { out.push(k); walk(k); }); walk(this); return out; }
    querySelectorAll(s) { if (s === '*') st.qsaStar++; return s === '*' ? this.all() : this.all().filter((e) => matches(e, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    closest(s) { for (let e = this; e && e.tagName; e = e.parentElement) if (matches(e, s)) return e; return null; }
    matches(s) { return s === ':focus-visible' ? false : matches(this, s); }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
    focus() { doc.activeElement = this; }
    getBoundingClientRect() {
      st.rects++;
      if (this === layer) {
        if (!this.classList.contains('is-ground')) return RECT(0, -st.scrollY, st.W, -st.scrollY);
        const g = o.app ? st.H - 52 : st.H - 4;
        return RECT(0, g - liveBox().h, st.W, g);
      }
      const b = this.box; if (!b) return RECT(0, 0, 0, 0);
      const dy = this.fixed ? 0 : st.scrollY;
      return RECT(b[0], b[1] - dy, b[2], b[3] - dy);
    }
    getClientRects() { return this.box && this.cs.display !== 'none' && !this.hidden ? [this.getBoundingClientRect()] : []; }
  }
  const doc = { readyState: 'complete', visibilityState: 'visible', activeElement: null };
  const html = new El('html'), body = new El('body');
  html.append(body);
  Object.defineProperty(html, 'clientWidth', { get: () => st.W });
  doc.documentElement = html; doc.body = body; doc.activeElement = body;
  doc.createElement = (t) => new El(t);
  doc.createRange = () => ({ n: null, selectNodeContents(n) { this.n = n; }, getClientRects() { const r = this.n.r; return [RECT(r[0], r[1] - st.scrollY, r[2], r[3] - st.scrollY)]; } });
  doc.querySelectorAll = (s) => html.querySelectorAll(s);
  doc.querySelector = (s) => html.querySelector(s);
  doc.addEventListener = (t, f) => { (docOn[t] = docOn[t] || []).push(f); };
  doc.elementsFromPoint = (x, y) => {
    const r0 = st.rects;   // 假瀏覽器自己找元素時叫的不算
    const hit = html.all().filter((e) => e.box && e !== layer && e.cs.display !== 'none' && !e.hidden && (() => { const r = e.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; })());
    const depth = (e) => { let d = 0; for (; e; e = e.parentElement) d++; return d; };
    st.rects = r0;
    return hit.sort((a, b) => depth(b) - depth(a)).concat([body, html]);
  };
  (o.htmlClass || []).forEach((c) => html.classList.add(c));
  const add = (parent, tag, x) => { const e = new El(tag, x); (parent || body).append(e); return e; };
  const page = o.build(add, body);
  if (o.app) { tabbar = add(body, 'nav', { cls: 'app-tabbar', box: [0, st.H - 52, st.W, st.H], fixed: true }); }
  const win = {
    document: doc, console, JSON, Object, Array, Number, String, Set, Map, Infinity, NaN, isFinite, parseFloat, SVGElement: class {},
    Math: Object.assign(Object.create(Math), { random: rnd }), Date: { now: () => 1.7e12 + st.t },
    location: { pathname: '/' + (o.page || 'learn.html') },
    get innerHeight() { return st.H; }, get scrollY() { return st.scrollY; }, scrollX: 0,
    performance: { now: () => st.t },
    setTimeout: (fn, ms) => { timers.push({ id: ++tid, at: st.t + (ms || 0), fn }); return tid; },
    setInterval: (fn, ms) => { timers.push({ id: ++tid, at: st.t + ms, fn, every: Math.max(1, ms) }); return tid; },
    clearTimeout: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    requestAnimationFrame: (f) => { rafs.push(f); return rafs.length; }, cancelAnimationFrame() {},
    addEventListener(t, f) { (winOn[t] = winOn[t] || []).push(f); },
    getComputedStyle: (e, p) => (p ? Object.assign({ content: 'none', display: 'inline', position: 'static', transform: 'none' }, (e.pseudo && e.pseudo[p]) || {}) : e === layer ? Object.assign({}, CS0, o.app ? {} : { paddingLeft: '16px', paddingRight: '16px' }) : e.cs),   // p:'::before'、'::after'(假元素)
    getSelection: () => ({ isCollapsed: !st.sel, rangeCount: st.sel ? 1 : 0, getRangeAt: () => ({ getBoundingClientRect: () => RECT(st.sel[0], st.sel[1], st.sel[2], st.sel[3]) }) }),
    sessionStorage: { getItem: () => (o.startX === undefined ? null : String(o.startX)), setItem() {} },   // startX:上一頁記下的 x(小雞從地面的這裡開始)
    MutationObserver: class { constructor(cb) { this.cb = cb; muts.push(this); } observe(t) { this.t = t; } },
    IntersectionObserver: class { constructor(cb) { ios.push(cb); } observe() {} },
  };
  win.clearInterval = win.clearTimeout;
  const ui = Object.assign({ mood: 'idle', hungry: false, roam: true, reduced: false }, o.ui || {});
  const subs = [];
  const view = () => ({ on: true, status: { hungry: ui.hungry }, roam: ui.roam });
  win.PET_UI = { reduced: ui.reduced, mood: () => ui.mood, label: () => '小黃', view, onChange: (f) => { subs.push(f); f(view(), {}); }, openSheet() {} };
  const liveT = new Set();   // 還在跑的引擎計時器(換大小重開引擎時,舊的不能再被叫醒;審查第 3 輪 #0)
  const anim = { pose: 'idle', shown: null, sizes: [], ticks: 0, get live() { return liveT.size; } };   // sizes:每次開引擎的大小(換模式時重開);ticks:引擎的計時器跑了幾拍(靜止的小雞不該跑);live:同時在跑的引擎計時器
  win.ChickArt = Object.assign({}, ART, {
    animate(cv, opt) {
      anim.sizes.push(opt.size);
      let pose = opt.pose || 'idle', i = 0, timer = 0;
      const seqOf = (p) => { const s = []; ART.holds(p).forEach((h, k) => { for (let j = 0; j < h; j++) s.push(k); }); return s; };
      let seq = seqOf(pose);
      const tick = () => { anim.ticks++; const k = seq[i % seq.length]; anim.shown = pose; opt.onTick({ pose, frame: k, tick: i, travel: (ART.travel[pose] || 0) * opt.size / ART.metrics.width }); i++; };
      const stop = () => { if (timer) { win.clearTimeout(timer); liveT.delete(timer); } timer = 0; };
      const start = () => { stop(); timer = win.setInterval(tick, 1000 / (ART.fps[pose] || 8)); liveT.add(timer); tick(); };
      const a = { setPose(p) { pose = p; anim.pose = p; seq = seqOf(p); i = 0; start(); }, setFps() {}, show(k, v, p) { if (p) { pose = p; anim.pose = p; } anim.shown = pose; stop(); }, stop, get pose() { return pose; } };
      start();
      return a;
    },
  });
  win.window = win;
  vm.createContext(win);
  if (o.zones) vm.runInContext(o.zones, win, { filename: 'pet-roam-zones.js' });
  vm.runInContext(sized(o.src, o.size), win, { filename: 'pet-roam2.js' });
  layer = html.all().find((e) => e.tagName === 'DIV' && e.classList.contains('pet-roam2')) || null;
  const btn = layer && layer.kids[0], cv = btn && btn.kids[0];
  function step(ms) {
    const end = st.t + ms;
    while (st.t < end) {
      const nt = Math.min(end, st.t + 16);
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const d = timers[0];
        if (!d || d.at > nt) break;
        st.t = Math.max(st.t, d.at);
        if (d.every) d.at += d.every; else timers.shift();
        d.fn();
      }
      st.t = nt;
      const l = rafs; rafs = []; l.forEach((f) => f(st.t));
      if (o.each) o.each(api);
    }
  }
  const fireWin = (t, e) => (winOn[t] || []).forEach((f) => f(Object.assign({ type: t }, e || {})));
  const fireDoc = (t, e) => (docOn[t] || []).forEach((f) => f(Object.assign({ type: t }, e || {})));
  const change = (ev) => subs.forEach((f) => f(view(), ev || {}));
  const ty = () => { const m = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(btn.style.transform || ''); return m ? [+m[1], +m[2]] : [NaN, NaN]; };
  /* 小雞框在視窗裡的位置(照 css:地面層固定在視窗下緣,站點層從文件頂端算) */
  /* 小雞框現在的大小:新版的 state 有 size、boxH;舊版(f94cec7)沒有,是 48×51 */
  function liveBox() { const s = win.PET_ROAM2 && win.PET_ROAM2.state; return s && s.size ? { w: s.size, h: s.boxH } : { w: S, h: BOXH }; }
  const box = () => { const [x, y] = ty(); const r = layer.getBoundingClientRect(), z = liveBox(); return { l: x, t: r.top + y, r: x + z.w, b: r.top + y + z.h }; };
  const api = { st, add, win, doc, html, body, page, layer, btn, cv, anim, ui, step, fireWin, fireDoc, change, muts, ios, box, liveBox, ty, R: () => win.PET_ROAM2 && win.PET_ROAM2.state,
    scroll(y) { st.scrollY = y; fireWin('scroll'); }, resize(W, H) { st.W = W; if (H) st.H = H; fireWin('resize'); },
    tappable: () => !['is-move', 'is-fly', 'is-scroll', 'is-pass', 'is-faded', 'is-init', 'is-off'].some((c) => layer.classList.contains(c)) && !layer.hidden,
    trace: () => btn.style.transform + '|' + (cv.style.transform || '') + '|' + layer.className + '|' + anim.pose + '|' + anim.shown + '|' + btn.className };
  return api;
}

/* 學習頁 1440×900:頂欄、標題、兩張卡片(一張可以點)、寫作練習卡片和旁邊的空格、一段文字、頁尾 */
function learnPage(add) {
  add(null, 'header', { cls: 'topbar', box: [0, 0, 1440, 59], fixed: true, style: WHITE });
  const main = add(null, 'main', { box: [200, 59, 1240, 1200] });
  const h1 = add(main, 'h1', { box: [200, 80, 1240, 124], texts: [[200, 84, 420, 120]] });
  const a = add(main, 'section', { box: [200, 150, 710, 420], style: WHITE, texts: [[224, 170, 500, 190]] });
  add(a, 'button', { box: [224, 360, 400, 400] });
  add(a, 'img', { box: [520, 200, 690, 340] });
  const b = add(main, 'a', { attrs: { href: 'x.html' }, box: [730, 150, 1240, 420], style: Object.assign({ cursor: 'pointer' }, WHITE), texts: [[754, 170, 1000, 190]] });
  add(b, 'span', { box: [754, 200, 900, 220], texts: [[754, 200, 900, 220]] });
  const c = add(main, 'section', { box: [200, 440, 710, 640], style: WHITE });
  add(c, 'h2', { box: [224, 460, 686, 490], texts: [[224, 462, 330, 488]] });   // 卡片裡的標題(寫作練習):下緣不是旁邊空格的地板
  add(main, 'p', { box: [200, 660, 1240, 700], texts: [[200, 664, 900, 690]] });
  const foot = add(null, 'footer', { box: [0, 1220, 1440, 1400], style: { borderTopWidth: '1px', borderTopStyle: 'solid' }, texts: [[300, 1260, 800, 1280]] });
  return { main, h1, a, b, foot };
}
/* 腳下有真的邊:下面 12 px 內有元素的上緣(卡片、頁尾)、頁面標題(main 裡的 h1)下緣(只到標題文字右邊 titleRun);兩側空白借主要內容裡卡片的上下緣 */
function supported(P, b) {
  const main = P.html.all().find((e) => e.tagName === 'MAIN').getBoundingClientRect();
  const side = b.r <= main.left + 1 || b.l >= main.right - 1;
  return P.html.all().some((e) => {
    if (!e.box || e === P.layer || P.layer.contains(e) || e.tagName === 'MAIN' || e.classList.contains('topbar')) return false;
    const r = e.getBoundingClientRect(), near = (y) => y >= b.b - 1 && y <= b.b + 12;
    if (side) return e.parentElement && e.parentElement.tagName === 'MAIN' && (near(r.top) || near(r.bottom));
    if (e.tagName === 'H1' && near(r.bottom)) { const tr = e.texts.length ? Math.max(...e.texts.map((q) => q.r[2])) : r.right; return b.l >= r.left - 1 && b.r <= tr + Z.CFG.titleRun + 1; }
    return near(r.top) && r.left < b.r && r.right > b.l;
  });
}
/* 量測用的障礙(跟程式無關,照規格自己算):可以點的四邊 8 px;文字、圖片、卡片左右下 4 px;站著的那張卡片、頂欄不算 */
function obstaclesNow(P) {
  const out = [];
  for (const e of P.html.all()) {
    if (!e.box || e === P.layer || P.layer.contains(e) || e.tagName === 'MAIN' || e.classList.contains('topbar') || e.classList.contains('app-tabbar')) continue;
    const r = e.getBoundingClientRect();
    const click = e.tagName === 'A' || e.tagName === 'BUTTON' || e.cs.cursor === 'pointer';
    if (click) { out.push(ob(r.left, r.top, r.right, r.bottom, 'i')); continue; }
    if (e.tagName === 'IMG') out.push(ob(r.left, r.top, r.right, r.bottom, 'm'));
    else if (e.cs.backgroundColor !== CS0.backgroundColor || e.cs.borderTopWidth !== '0px') out.push(ob(r.left, r.top, r.right, r.bottom, 'c'));
    e.texts.forEach((t) => out.push(ob(t.r[0], t.r[1] - P.st.scrollY, t.r[2], t.r[3] - P.st.scrollY, 't')));
  }
  return out;
}
function wideSim(o) {
  return sim(Object.assign({ src: ROAM, zones: ZONES, W: 1440, H: 900, page: 'learn.html', build: learnPage }, o));
}

/* ---------- 五個主分頁的寬版(1.11 實測的版型):site(name, W, H) 回 build ----------
   寬版頁(首頁、學習、刷題)主要內容 1040 寬、窄版頁(複習、我的)768 寬,置中;頁面標題是 .page-head 裡的 inline-block h1,
   黃色螢光筆是 ::before(left -8、right -10、top 46%、bottom 3%、轉 -1.2 度,同 css/style.css 的 .page-head h1::before) */
const MARK = { '::before': { content: '""', display: 'block', position: 'absolute', left: '-8px', right: '-10px', top: '20.24px', bottom: '1.32px', transform: 'matrix(0.99978, -0.020943, 0.020943, 0.99978, 0, 0)' } };
const LINK = (x) => Object.assign({ attrs: { href: 'x.html' }, style: Object.assign({ cursor: 'pointer' }, WHITE) }, x);
function site(name, W, H) {
  const narrow = name === 'review' || name === 'me', mw = narrow ? 768 : 1040, L = Math.round((W - mw) / 2), R = L + mw, M = Math.round((L + R) / 2);
  return (add) => {
    add(null, 'header', { cls: 'topbar', box: [0, 0, W, 59], fixed: true, style: WHITE, texts: [[24, 20, 140, 40]] });
    const main = add(null, 'main', { box: [L, 59, R, 1700] });
    const head = (text) => { const ph = add(main, 'div', { cls: 'page-head', box: [L, 72, R, 128] }); return add(ph, 'h1', { box: [L, 80, L + text, 124], texts: [[L, 84, L + text, 120]], pseudo: MARK }); };
    let h1 = null, card = null;
    if (name === 'index') {
      const band = add(main, 'section', { cls: 'hero', box: [0, 59, W, 250], style: { backgroundColor: 'rgb(246, 247, 249)' } });
      h1 = add(band, 'h1', { box: [L, 80, R, 124], texts: [[L, 84, L + 620, 120]] });
      add(band, 'p', { box: [L, 150, L + 420, 200], texts: [[L, 150, L + 420, 196]] });
      add(main, 'p', { box: [L, 266, R, 292], texts: [[L, 268, L + 460, 290]] });
      const daily = add(main, 'section', { id: 'daily-home', cls: 'daily-home', box: [L, 310, R, 460], style: WHITE, texts: [[L + 24, 330, L + 160, 352]] });
      for (let i = 0; i < 3; i++) add(daily, 'button', { box: [L + 24 + i * 300, 380, L + 284 + i * 300, 424] });
      card = add(main, 'section', { cls: 'pet-card pet-home', box: [L, 476, R, 580], style: WHITE, texts: [[L + 130, 496, L + 260, 520], [L + 130, 528, L + 420, 548]] });
      add(card, 'button', { cls: 'pet-pic', box: [L + 12, 482, L + 108, 574] });
      add(card, 'button', { cls: 'btn', box: [R - 120, 506, R - 24, 550] });
      add(main, 'a', LINK({ box: [L, 602, M - 10, 860] }));
      add(main, 'a', LINK({ box: [M + 10, 602, R, 860] }));
    } else if (name === 'learn' || name === 'drill') {
      h1 = head(64);
      const rows = name === 'learn' ? 4 : 2;
      for (let i = 0; i < rows; i++) { add(main, 'a', LINK({ box: [L, 150 + i * 200, M - 10, 330 + i * 200] })); add(main, 'a', LINK({ box: [M + 10, 150 + i * 200, R, 330 + i * 200] })); }
      if (name === 'learn') { const w = add(main, 'section', { box: [L, 950, M - 10, 1150], style: WHITE }); add(w, 'h2', { box: [L + 24, 970, M - 34, 1000], texts: [[L + 24, 972, L + 130, 998]] }); }
    } else if (name === 'review') {
      h1 = head(64);
      for (let i = 0; i < 4; i++) { const c = add(main, 'section', { cls: 'part-card', box: [L, 150 + i * 170, R, 300 + i * 170], style: WHITE, texts: [[L + 24, 170 + i * 170, L + 200, 194 + i * 170]] }); add(c, 'button', { box: [R - 140, 244 + i * 170, R - 24, 284 + i * 170] }); }
    } else {
      h1 = head(64);
      const hd = add(main, 'div', { cls: 'me-head', box: [L, 150, R, 214] });
      add(hd, 'img', { box: [L, 150, L + 64, 214] });
      add(hd, 'p', { box: [L + 80, 166, L + 300, 198], texts: [[L + 80, 168, L + 260, 196]] });
      card = add(main, 'section', { cls: 'pet-card pet-me', box: [L, 230, R, 340], style: WHITE, texts: [[L + 130, 250, L + 260, 274], [L + 130, 282, L + 420, 302]] });
      add(card, 'button', { cls: 'pet-pic', box: [L + 12, 236, L + 108, 334] });
      for (let i = 0; i < 2; i++) { const c = add(main, 'section', { box: [L, 360 + i * 220, R, 560 + i * 220], style: WHITE, texts: [[L + 24, 380 + i * 220, L + 300, 404 + i * 220]] }); add(c, 'button', { box: [L + 24, 500 + i * 220, L + 200, 540 + i * 220] }); }
    }
    const ft = name === 'drill' ? 600 : 1700;
    add(null, 'footer', { box: [0, ft, W, ft + 160], style: { borderTopWidth: '1px', borderTopStyle: 'solid' }, texts: [[L, ft + 40, L + 400, ft + 60]] });
    return { main, h1, card, L, R };
  };
}
/* 跑 ms 毫秒,每 100 毫秒記一次小雞在哪:'ground'(視窗下緣)、空地的 key、null(換地方途中)。回 1.11 的數字:
   first 第一次離開地面的時間、minZones 任一段 60 秒裡去過幾個地方(地面算一個)的最小值、maxGround 任一段 60 秒裡在地面的比例最大值、
   ground 全程在地面的比例、stays 每次停在空地的秒數(長休息不算)、rests 長休息 [{ at, t, s }]、faded 淡出的比例 */
function wanderRun(o) {
  const lab = [];
  let next = 0, first = -1;
  const each = (Q) => {
    if (Q.st.t < next) return;
    next += 100;
    const s = Q.R();
    if (!s) { lab.push({ at: null }); return; }
    const moving = !!s.move || !!s.flying;
    if (first < 0 && (moving || !s.ground)) first = Q.st.t;
    if (o.mark) o.mark(Q, s);
    lab.push({ at: moving ? null : s.ground ? 'ground' : s.zone, rest: !!s.rest, faded: !!s.faded });
  };
  const P = sim(Object.assign({ src: ROAM, zones: ZONES, W: 1280, H: 800 }, o, { page: o.name + '.html', build: site(o.name, o.W || 1280, o.H || 800), each }));
  P.step(o.ms || 5 * 60 * 1000);
  const win = 600, out = { first, minZones: Infinity, maxGround: 0, stays: [], rests: [], P };
  for (let i = 0; i + win <= lab.length; i += 10) {
    const w = lab.slice(i, i + win), seen = new Set(w.map((q) => q.at).filter((a) => a !== null));
    out.minZones = Math.min(out.minZones, seen.size);
    out.maxGround = Math.max(out.maxGround, w.filter((q) => q.at === 'ground').length / win);
  }
  out.ground = lab.filter((q) => q.at === 'ground').length / lab.length;
  out.faded = lab.filter((q) => q.faded).length / lab.length;
  for (let i = 0; i < lab.length;) {
    let j = i;
    while (j < lab.length && lab[j].at === lab[i].at) j++;
    const a = lab[i].at, rest = lab.slice(i, j).some((q) => q.rest);
    if (a && a !== 'ground' && j < lab.length) { if (rest) out.rests.push({ at: a, t: i / 10, s: (j - i) / 10 }); else out.stays.push((j - i) / 10); }
    if (a === 'ground' && rest) out.rests.push({ at: a, t: i / 10, s: (j - i) / 10 });
    i = j;
  }
  return out;
}
const median = (a) => { const b = a.slice().sort((p, q) => p - q); return b.length ? b[Math.floor(b.length / 2)] : NaN; };

module.exports = { REPO, read, ROAM, ZONES, ART, nodeLoad, Z, mulberry, S, BOXH, ob, hitBox, RECT, CS0, WHITE, sim, sized, learnPage, supported, obstaclesNow, wideSim, site, wanderRun, median, MARK };
