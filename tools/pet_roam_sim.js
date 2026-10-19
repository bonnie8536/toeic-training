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

/* o:{ src, zones(載入 js/pet-roam-zones.js), W, H, page, app, docH, seed, build(add) 建頁面, ui:{ mood, hungry, roam, reduced } } */
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
      this.cs = Object.assign({}, CS0, x.style || {}); this.box = x.box || null; this.fixed = !!x.fixed; this.texts = (x.texts || []).map((r) => ({ nodeType: 3, nodeValue: '字', r }));
      this.kids = []; this.parentElement = null; this.hidden = false; this.inert = false; this.style = {}; this.on = {}; this.isConnected = true; this.isContentEditable = false;
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
        return RECT(0, g - BOXH, st.W, g);
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
    getComputedStyle: (e) => (e === layer ? Object.assign({}, CS0, o.app ? {} : { paddingLeft: '16px', paddingRight: '16px' }) : e.cs),
    getSelection: () => ({ isCollapsed: !st.sel, rangeCount: st.sel ? 1 : 0, getRangeAt: () => ({ getBoundingClientRect: () => RECT(st.sel[0], st.sel[1], st.sel[2], st.sel[3]) }) }),
    sessionStorage: { getItem: () => null, setItem() {} },
    MutationObserver: class { constructor(cb) { this.cb = cb; muts.push(this); } observe(t) { this.t = t; } },
    IntersectionObserver: class { constructor(cb) { ios.push(cb); } observe() {} },
  };
  win.clearInterval = win.clearTimeout;
  const ui = Object.assign({ mood: 'idle', hungry: false, roam: true, reduced: false }, o.ui || {});
  const subs = [];
  const view = () => ({ on: true, status: { hungry: ui.hungry }, roam: ui.roam });
  win.PET_UI = { reduced: ui.reduced, mood: () => ui.mood, label: () => '小黃', view, onChange: (f) => { subs.push(f); f(view(), {}); }, openSheet() {} };
  const anim = { pose: 'idle', shown: null };
  win.ChickArt = Object.assign({}, ART, {
    animate(cv, opt) {
      let pose = opt.pose || 'idle', i = 0, timer = 0;
      const seqOf = (p) => { const s = []; ART.holds(p).forEach((h, k) => { for (let j = 0; j < h; j++) s.push(k); }); return s; };
      let seq = seqOf(pose);
      const tick = () => { const k = seq[i % seq.length]; anim.shown = pose; opt.onTick({ pose, frame: k, tick: i, travel: (ART.travel[pose] || 0) * opt.size / ART.metrics.width }); i++; };
      const stop = () => { if (timer) win.clearTimeout(timer); timer = 0; };
      const start = () => { stop(); timer = win.setInterval(tick, 1000 / (ART.fps[pose] || 8)); tick(); };
      const a = { setPose(p) { pose = p; anim.pose = p; seq = seqOf(p); i = 0; start(); }, setFps() {}, show(k, v, p) { if (p) { pose = p; anim.pose = p; } anim.shown = pose; stop(); }, stop, get pose() { return pose; } };
      start();
      return a;
    },
  });
  win.window = win;
  vm.createContext(win);
  if (o.zones) vm.runInContext(o.zones, win, { filename: 'pet-roam-zones.js' });
  vm.runInContext(o.src, win, { filename: 'pet-roam2.js' });
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
  const box = () => { const [x, y] = ty(); const r = layer.getBoundingClientRect(); return { l: x, t: r.top + y, r: x + S, b: r.top + y + BOXH }; };
  const api = { st, add, win, doc, html, body, page, layer, btn, cv, anim, ui, step, fireWin, fireDoc, change, muts, ios, box, ty, R: () => win.PET_ROAM2 && win.PET_ROAM2.state,
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

module.exports = { REPO, read, ROAM, ZONES, ART, nodeLoad, Z, mulberry, S, BOXH, ob, hitBox, RECT, CS0, WHITE, sim, learnPage, supported, obstaclesNow, wideSim };
