/* 小雞第二階段的餵食面板(js/pet-ui.js;規格 小雞第二階段規格.md 第 3 節、實作契約第 6 節)。
   用法:node tools/test_pet_ui_food.js
   - 開關都關:新的 pet-ui.js 跟第 1 步那版(tools/fixtures/pet_ui_step1.js)對同一組假 view() 畫出的卡片和面板,
     DOM 序列化後完全相同,焦點順序、掛的事件、呼叫 PET_STORE 與 ChickArt 的參數也相同。
   - 開關打開:托盤、格子狀態與標籤、鍵盤、提示、吃東西的流程、走動開關、卡片的「餵牠」。
   載入真的 js/pet-ui.js 與 js/common.js 的 h(),配很小的假 DOM、假的 PET_STORE、ChickArt、FoodArt、PET、計時器。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const H_SRC = (read('js/common.js').match(/function h\(tag[\s\S]*?\r?\n\}\r?\n/) || [''])[0];
if (!H_SRC) throw new Error('js/common.js 裡找不到 function h(tag, ...)');
const NEW_SRC = read('js/pet-ui.js');
const OLD_SRC = read('tools/fixtures/pet_ui_step1.js');

const NAMES = { grain: '飼料', corn: '玉米', greens: '青江菜', pea: '豌豆', berry: '藍莓', tomato: '小番茄', melon: '西瓜', yam: '地瓜', worm: '麵包蟲' };
const IDS = Object.keys(NAMES);
const RO_TEXT = { readOnly: '小雞的資料讀不到，這台先不能餵。', clock: '這台裝置的日期不對，調好以後再餵。' };

/* ---------- 假 DOM ---------- */
function makeDom(timers) {
  const doc = { visibilityState: 'visible', activeElement: null, listeners: {} };
  class Node {
    constructor(tag) {
      this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.kids = []; this.parentNode = null;
      this.attrs = {}; this.className = ''; this.style = {}; this.on = {}; this.hidden = false; this.inert = false; this.value = '';
      const self = this;
      this.classList = {
        add: c => { const s = self.className.split(/\s+/).filter(Boolean); if (!s.includes(c)) s.push(c); self.className = s.join(' '); },
        remove: c => { self.className = self.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
        contains: c => self.className.split(/\s+/).includes(c),
        toggle: (c, on) => { const has = self.classList.contains(c); const want = on === undefined ? !has : !!on; if (want && !has) self.classList.add(c); if (!want && has) self.classList.remove(c); return want; },
      };
    }
    get children() { return this.kids.filter(k => k.nodeType === 1); }
    get firstChild() { return this.kids[0] || null; }
    get nextSibling() { const p = this.parentNode; return p ? p.kids[p.kids.indexOf(this) + 1] || null : null; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.body; }
    get offsetParent() { if (!this.isConnected) return null; let n = this; while (n) { if (n.hidden) return null; n = n.parentNode; } return this.parentNode; }
    get offsetWidth() { return 100; }
    get disabled() { return 'disabled' in this.attrs; }
    get textContent() { return this.kids.map(k => k.textContent).join(this.kids.length > 1 && this.kids.every(k => k.nodeType === 1 && k.tagName === 'P') ? '\n' : ''); }
    set textContent(t) { this.replaceChildren(); if (t) this.append(doc.createTextNode(t)); }
    set innerHTML(v) { this.kids = []; this.html = v; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    adopt(n) { if (n.parentNode) n.remove(); n.parentNode = this; return n; }
    append(...ns) { ns.forEach(n => { n = n.nodeType ? n : doc.createTextNode(n); this.kids.push(this.adopt(n)); }); }
    prepend(...ns) { ns.reverse().forEach(n => { this.kids.unshift(this.adopt(n)); }); }
    after(n) { const p = this.parentNode; p.adopt(n); p.kids.splice(p.kids.indexOf(this) + 1, 0, n); }
    before(n) { const p = this.parentNode; p.adopt(n); p.kids.splice(p.kids.indexOf(this), 0, n); }
    remove() { const p = this.parentNode; if (!p) return; p.kids.splice(p.kids.indexOf(this), 1); this.parentNode = null; }
    replaceChildren(...ns) { this.kids.slice().forEach(k => { k.parentNode = null; }); this.kids = []; this.append(...ns); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
    removeEventListener(t, f) { this.on[t] = (this.on[t] || []).filter(x => x !== f); }
    fire(t, extra) {
      const ev = Object.assign({ type: t, target: this, currentTarget: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }, extra);
      (this.on[t] || []).slice().forEach(f => f(ev));
      return ev;
    }
    focus() { const was = doc.activeElement; if (was === this) return; doc.activeElement = this; if (was && was.fire) was.fire('blur'); this.fire('focus'); }
    select() {}
    setPointerCapture() {}
    getContext() {
      if (this.tagName !== 'CANVAS') return null;
      if (this._g) return this._g;
      const log = this.ctxLog = [], props = { fillStyle: '' };
      const fmt = a => (typeof a === 'number' ? a.toFixed(2) : String(a));
      this._g = new Proxy({}, { get: (t, k) => (k in props ? props[k] : (...a) => { log.push(String(k) + '(' + a.map(fmt).join(',') + ')'); }),
        set: (t, k, v) => { props[k] = v; log.push(String(k) + '=' + fmt(v)); return true; } });
      return this._g;
    }
    matches(sel) { return sel.split(',').some(s => simple(this, s.trim())); }
    closest(sel) { let n = this; while (n && n.nodeType === 1) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
    all() { const out = []; this.kids.forEach(k => { if (k.nodeType === 1) { out.push(k); out.push(...k.all()); } }); return out; }
    querySelectorAll(sel) { return this.all().filter(n => n.matches(sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  function simple(n, s) {
    const m = s.match(/^([a-z0-9]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i);
    if (!m) return false;
    if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && !m[2].split('.').filter(Boolean).every(c => n.classList.contains(c))) return false;
    for (const a of (m[3].match(/\[[^\]]+\]/g) || [])) {
      const [, k, v] = a.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/) || [];
      if (!k || !(k in n.attrs) || (v !== undefined && n.attrs[k] !== v)) return false;
    }
    return true;
  }
  doc.createElement = tag => new Node(tag);
  doc.createTextNode = t => ({ nodeType: 3, textContent: String(t), parentNode: null, remove() { const p = this.parentNode; if (p) { p.kids.splice(p.kids.indexOf(this), 1); this.parentNode = null; } } });
  doc.body = new Node('body');
  doc.ids = {};
  doc.getElementById = id => doc.ids[id] || doc.body.all().find(n => n.attrs.id === id) || null;
  doc.querySelector = sel => doc.body.querySelector(sel);
  doc.addEventListener = (t, f) => { (doc.listeners[t] = doc.listeners[t] || []).push(f); };
  doc.removeEventListener = (t, f) => { doc.listeners[t] = (doc.listeners[t] || []).filter(x => x !== f); };
  doc.key = (key, extra) => { const ev = Object.assign({ key, shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }, extra); (doc.listeners.keydown || []).slice().forEach(f => f(ev)); return ev; };
  return doc;
}

/* 計時器:advance(ms) 依時間順序執行 */
function makeTimers() {
  let now = 0, seq = 1;
  const list = [];
  return {
    set(f, ms) { const id = seq++; list.push({ id, at: now + (ms || 0), f }); return id; },
    clear(id) { const i = list.findIndex(t => t.id === id); if (i >= 0) list.splice(i, 1); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        list.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = list[0];
        if (!t || t.at > end) break;
        list.shift(); now = t.at; t.f();
      }
      now = end;
    },
    get count() { return list.length; },
  };
}

/* ---------- 假資料 ---------- */
function status(over) {
  return Object.assign({ today: '2026-11-02', name: '小黃', streak: 5, shields: 1, practicedDays: 12, todayCount: 12, goal: 20, nextGoal: 20,
    metToday: false, food: 4, sleeping: false, hungry: false, totalMet: 23 }, over || {});
}
function pantry(over) {
  return Object.assign({ stock: { corn: 2, pea: 0, yam: 9 }, order: ['corn', 'pea', 'yam'], practiced: true, ateToday: false, ateFood: null,
    gotToday: { id: 'g:ga-01', food: 'pea' }, canSnack: true, fav: 'greens', favKnown: false }, over || {});
}
/* 開關都關時 pet-store 給的 view(第 1 步那版的鍵) */
function oldView(kind) {
  const base = { on: true, cloud: false, guest: true, readOnly: false, reason: '', newer: false, pet: { v: 1, days: { '2026-11-01': 3, '2026-11-02': 12 } } };
  const k = {
    normal: { status: status() },
    hungry: { status: status({ hungry: true, food: 5, metToday: false }) },
    sleep: { status: status({ sleeping: true }) },
    met: { status: status({ food: 0, metToday: true, todayCount: 25 }) },
    bad: { readOnly: true, reason: 'readOnly', status: status() },
    newer: { readOnly: true, reason: 'readOnly', newer: true, status: status() },
    clock: { readOnly: true, reason: 'clock', status: status() },
    guest: { cloud: true, guest: true, status: status() },
    nofood: { status: status({ food: 0, streak: 0, shields: 0, practicedDays: 0, todayCount: 0, totalMet: 0, hungry: true }) },
  }[kind];
  if (!k) throw new Error(kind);
  return Object.assign({}, base, k);
}
function foodView(over) {
  over = over || {};
  const v = Object.assign(oldView(over.kind || 'normal'), { food: true, pantry: pantry(over.pantry) });
  if (over.status) v.status = status(Object.assign({}, v.status, over.status));
  if (over.readOnly) Object.assign(v, { readOnly: true, reason: over.reason || 'readOnly' });
  if (over.roamV2) { v.roamV2 = true; v.roam = over.roam !== false; }
  return v;
}

/* ---------- 載入一個頁面 ---------- */
function load(opt) {
  const timers = makeTimers();
  const doc = makeDom(timers);
  const log = { animate: [], poses: [], mounts: [], render: [], calls: [], win: [], storage: {}, drawFrame: 0 };
  const state = { view: opt.view };
  const mm = q => ({ matches: /reduced-motion/.test(q) ? !!opt.reduce : /orientation/.test(q) ? !!opt.land : false, addEventListener() {}, removeEventListener() {} });
  const ctx = {
    document: doc, console,
    setTimeout: (f, ms) => timers.set(f, ms), clearTimeout: id => timers.clear(id), setInterval: () => 0, clearInterval() {},
    matchMedia: mm,
    addEventListener(t, f) { log.win.push(t); (state.wl = state.wl || {})[t] = (state.wl[t] || []).concat(f); },
    MutationObserver: class { observe() {} },
    PET: { foodName: id => (id === 'grain' ? '飼料' : NAMES[id] || '') },
    ChickArt: {
      metrics: { width: 240, height: 280, ground: 254 }, holds: () => [1], calm: { idle: 1, eat: 3, nope: 5, happy: 0, hungry: 0, sleep: 0 },
      drawFrame() { log.drawFrame++; },
      animate: (c, o) => { log.animate.push(Object.assign({}, o, { onTick: typeof o.onTick })); state.tick = o.onTick; log.poses.push(o.pose);
        return { pose: o.pose, setPose(p) { this.pose = p; log.poses.push(p); }, stop() {}, setFps() {}, show(k, v, p) { if (p) this.pose = p; log.poses.push('show:' + this.pose + ':' + k); } }; },
    },
    FoodArt: {
      ids: IDS, metrics: { width: 100, height: 100, ground: 84 }, chickImpactFrames: [3, 5],
      info: Object.fromEntries(IDS.map(id => [id, { name: NAMES[id], steps: 3 }])),
      render: (id, o) => { log.render.push([id, o]); return { width: 40, height: 40 }; },
      mount: (cv, id, o) => { const m = { id, opt: o, bites: 0, stopped: false, bite() { this.bites++; }, finish() { this.done = true; if (o && o.onDone) o.onDone(id); }, stop() { this.stopped = true; }, reset() {}, setFood() {} }; log.mounts.push(m); return m; },
    },
    localStorage: opt.noStorage ? undefined : {
      getItem: k => (k in log.storage ? log.storage[k] : null),
      setItem: (k, v) => { log.storage[k] = String(v); },
    },
    PET_STORE: Object.assign({
      on: true,
      view: () => (typeof state.view === 'function' ? state.view() : state.view),
      feed: async () => { log.calls.push('feed'); return state.feedRes || { ok: true }; },
      setGoal: async n => { log.calls.push('goal' + n); return { ok: true }; },
      rename: async () => { log.calls.push('rename'); return { ok: true }; },
    }, opt.food === undefined ? {} : { food: opt.food }, opt.roam2 === undefined ? {} : { roamV2: opt.roam2 },
    opt.food ? {
      eat: f => { log.calls.push('eat:' + f); const r = (state.eat || (() => ({ ok: true, reason: null, left: 1 })))(f); if (r.saved === undefined) r.saved = state.saved || Promise.resolve({ ok: true }); return r; },
      earn: async () => ({ result: 'off' }),
    } : {}, opt.roam2 ? { setRoam: v => { log.calls.push('roam:' + v); return state.roamRes || Promise.resolve({ ok: true }); } } : {}),
  };
  if (opt.noStorage) Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('blocked'); } });
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(H_SRC + '\nthis.h = h;', ctx);
  if (opt.home) { doc.ids['daily-home'] = doc.createElement('section'); doc.body.append(doc.ids['daily-home']); }
  if (opt.me) { doc.ids['me-root'] = doc.createElement('div'); doc.body.append(doc.ids['me-root']); }
  vm.runInContext(opt.src || NEW_SRC, ctx);
  const pg = { doc, ctx, log, state, timers };
  pg.emit = (t) => (state.wl && state.wl[t] || []).forEach(f => f({ detail: null }));
  pg.open = (o) => { const b = doc.createElement('button'); doc.body.append(b); b.focus(); ctx.PET_UI.openSheet(b, o); pg.opener = b; pg.sheet = doc.body.querySelector('.pet-sheet'); return pg.sheet; };
  pg.tile = id => pg.sheet.querySelector('[data-focus="food-' + id + '"]');
  pg.tiles = () => pg.sheet.querySelectorAll('.pet-tile');
  pg.live = () => pg.sheet.querySelector('.pet-msg').textContent;
  pg.count = id => pg.tile(id).querySelector('.pet-tile-c').textContent;
  return pg;
}
const flush = () => new Promise(r => setImmediate(r));
function ser(n) {
  if (n.nodeType === 3) return JSON.stringify(n.textContent);
  const a = Object.keys(n.attrs).sort().map(k => k + '=' + JSON.stringify(n.attrs[k])).join(' ');
  const ev = Object.keys(n.on).sort().map(t => t + ':' + n.on[t].length).join(',');
  return '<' + n.tagName + ' class="' + n.className + '" ' + a + (n.hidden ? ' hidden' : '') + (n.inert ? ' inert' : '') + (n.html ? ' html' : '') +
    ' style=' + JSON.stringify(n.style) + ' ev=' + ev + '>' + n.kids.map(ser).join('') + '</' + n.tagName + '>';
}
function focusOrder(root) {
  return root.querySelectorAll('button, a[href], input').filter(n => !n.disabled && n.offsetParent !== null && n.getAttribute('tabindex') !== '-1')
    .map(n => n.tagName + '.' + n.className + '#' + (n.getAttribute('data-focus') || n.getAttribute('aria-label') || n.textContent));
}

const T = {};

/* ================= A. 開關都關:跟第 1 步那版完全相同 ================= */
const KINDS = ['normal', 'hungry', 'sleep', 'met', 'bad', 'newer', 'clock', 'guest', 'nofood'];
const FLAG_SETS = [
  ['旗子沒給', {}],
  ['旗子是 false', { food: false, roam2: false }],
];
async function snapshot(src, flags, kind, where, steps) {
  const pg = load(Object.assign({ src, view: oldView(kind) }, flags, where === 'home' ? { home: true } : where === 'me' ? { me: true } : {}));
  const out = [];
  const shot = (tag) => out.push(tag + ' ' + ser(pg.doc.body) + ' focus=' + (pg.doc.activeElement ? ser(pg.doc.activeElement).slice(0, 200) : 'none') + ' order=' + focusOrder(pg.doc.body).join('|'));
  shot('load');
  if (where === 'sheet' || where === 'sheetMe') { pg.open(where === 'sheetMe' ? { noGoal: true } : undefined); shot('open'); }
  else if (where === 'home' || where === 'me') {
    const pic = pg.doc.body.querySelector('.pet-pic');
    pic.fire('click'); pg.sheet = pg.doc.body.querySelector('.pet-sheet'); shot('cardOpen');
  }
  for (const s of steps) {
    if (s === 'feed') { const b = pg.doc.body.querySelector('[data-focus="feed"]'); if (b) { b.focus(); b.fire('click'); } }
    if (s === 'goal') { const b = pg.doc.body.querySelector('[data-focus="goal40"]'); if (b) { b.focus(); b.fire('click'); } }
    if (s === 'tab') { pg.doc.key('Tab'); pg.doc.key('Tab', { shiftKey: true }); }
    if (s === 'esc') pg.doc.key('Escape');
    await flush(); await flush();
    shot(s);
  }
  out.push('animate ' + JSON.stringify(pg.log.animate) + ' poses ' + pg.log.poses.join(',') + ' calls ' + pg.log.calls.join(',') + ' win ' + pg.log.win.join(',') + ' storage ' + JSON.stringify(pg.log.storage) + ' timers ' + pg.timers.count);
  return out;
}
for (const [fname, flags] of FLAG_SETS) {
  for (const where of ['sheet', 'sheetMe', 'home', 'me']) {
    T['開關都關(' + fname + '):' + where + ' 的 DOM、焦點、事件、呼叫跟第 1 步那版相同(9 種 view)'] = async () => {
      const bad = [];
      for (const kind of KINDS) {
        const steps = ['feed', 'goal', 'tab', 'esc'];
        const a = await snapshot(OLD_SRC, flags, kind, where, steps);
        const b = await snapshot(NEW_SRC, flags, kind, where, steps);
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
          if (a[i] !== b[i]) { bad.push(kind + ' 第 ' + i + ' 張:\n舊 ' + String(a[i]).slice(0, 600) + '\n新 ' + String(b[i]).slice(0, 600)); break; }
        }
      }
      return { ok: bad.length === 0, detail: bad.join('\n') };
    };
  }
}
T['開關都關:view 就算多了 pantry、roam 也不畫托盤和開關(只認 PET_STORE.food / roamV2 === true)'] = async () => {
  const v = foodView({ roamV2: true });
  const a = await snapshot(OLD_SRC, { food: false, roam2: false }, 'normal', 'sheet', []);
  const pg = load({ view: v, food: false, roam2: false });
  pg.open();
  return { ok: !pg.sheet.querySelector('.pet-tray') && !pg.sheet.querySelector('.pet-switch-row') && !!pg.sheet.querySelector('.pet-feed') && a.length > 0,
    detail: JSON.stringify({ tray: !!pg.sheet.querySelector('.pet-tray'), sw: !!pg.sheet.querySelector('.pet-switch-row') }) };
};
T['開關都關:旗子是字串 "true" 也不算開'] = async () => {
  const pg = load({ view: foodView({ roamV2: true }), food: 'true', roam2: 1 });
  pg.open();
  return { ok: !pg.sheet.querySelector('.pet-tray') && !pg.sheet.querySelector('.pet-switch-row'), detail: '' };
};

/* ================= B. 四種開關組合 ================= */
for (const [food, roam2] of [[false, false], [true, false], [false, true], [true, true]]) {
  T['開關組合 PET_FOOD=' + food + ' PET_ROAM_V2=' + roam2 + ':面板畫得出來,托盤與走動開關照開關出現'] = async () => {
    const pg = load({ view: foodView({ roamV2: roam2 }), food, roam2 });
    pg.open();
    const tray = pg.sheet.querySelector('.pet-tray'), row = pg.sheet.querySelector('.pet-switch-row');
    const feedBtn = pg.sheet.querySelector('.pet-feed');
    return { ok: !!tray === food && !!row === roam2 && !!feedBtn === !food && !!pg.sheet.querySelector('.pet-big'),
      detail: JSON.stringify({ tray: !!tray, row: !!row, feedBtn: !!feedBtn }) };
  };
}

/* ================= C. 版面與托盤 ================= */
T['食物面板的順序:把手、×、名字、舞台、點心那一行、托盤、提示、今天、live、其他'] = async () => {
  const pg = load({ view: foodView({ roamV2: true }), food: true, roam2: true });
  pg.open();
  const seq = pg.sheet.children.map(n => n.className.split(' ')[0]);
  const want = ['pet-sheet-top', 'modal-close', 'pet-sheet-head', 'pet-stage', 'pet-snack-line', 'pet-tray', 'pet-hint', 'pet-sheet-body', 'pet-msg', 'pet-sheet-body'];
  const stage = pg.sheet.querySelector('.pet-stage');
  const big = stage && stage.querySelector('canvas.pet-big'), sf = stage && stage.querySelector('canvas.pet-stage-food');
  const body = pg.sheet.querySelectorAll('.pet-sheet-body');
  const rest = body[1].children.map(n => n.className.split(' ')[0]);
  return { ok: JSON.stringify(seq) === JSON.stringify(want) && !!big && !!sf && sf.hidden && sf.getAttribute('aria-hidden') === 'true' &&
    !body[0].querySelector('.pet-act') && !pg.sheet.querySelector('.pet-feed') &&
    JSON.stringify(rest) === JSON.stringify(['pet-grow', 'pet-goal', 'pet-switch-row', 'pet-note']),
    detail: JSON.stringify({ seq, rest }) };
};
T['托盤:role=toolbar、aria-label=食物;第一格飼料,後面照 pantry.order'] = async () => {
  const pg = load({ view: foodView({ pantry: { order: ['corn', 'pea', 'yam', 'worm'], stock: { corn: 2, pea: 0, yam: 9, worm: 1 } } }), food: true });
  pg.open();
  const tray = pg.sheet.querySelector('.pet-tray');
  const ids = pg.tiles().map(b => b.getAttribute('data-focus'));
  return { ok: tray.getAttribute('role') === 'toolbar' && tray.getAttribute('aria-label') === '食物' && JSON.stringify(ids) === JSON.stringify(['food-grain', 'food-corn', 'food-pea', 'food-yam', 'food-worm']),
    detail: JSON.stringify(ids) };
};
T['格子:button[type=button]、圖只畫一張(render size 40 variant 0,不 mount)、名字、份數、提示接 aria-describedby'] = async () => {
  const pg = load({ view: foodView(), food: true });
  pg.open();
  pg.timers.advance(1000);   // 小圖在面板第一格之後才畫
  const b = pg.tile('corn'), g = pg.tile('grain');
  const sr = pg.doc.getElementById('pet-tip-corn');
  const renders = pg.log.render.filter(r => r[1] && r[1].size === 40);
  const trayMounts = pg.log.mounts.filter(m => m.opt && m.opt.size === 40);
  return { ok: b.tagName === 'BUTTON' && b.getAttribute('type') === 'button' && !!b.querySelector('canvas.pet-tile-cv') && b.querySelector('.pet-tile-n').textContent === '玉米' &&
    pg.count('corn') === '2 份' && pg.count('grain') === '4 顆' && b.getAttribute('aria-describedby') === 'pet-tip-corn' && g.getAttribute('aria-describedby') === null &&
    !!sr && sr.classList.contains('pet-sr') && sr.textContent === '玉米要壓碎再給小雞，整顆太大。' &&
    pg.doc.getElementById('pet-tip-yam').textContent === '點心只占一小部分，主食還是飼料。' &&
    renders.length === 4 && renders.every(r => r[1].variant === 0) && trayMounts.length === 0,
    detail: JSON.stringify({ renders: renders.map(r => r[0] + JSON.stringify(r[1])), mounts: trayMounts.length, c: pg.count('corn'), g: pg.count('grain') }) };
};

/* 第二輪審查:托盤小圖是完整的塗鴉畫法,9 種在點下去那一下同步畫要 300 毫秒以上(手機慢 4 倍時);
   點下去時只放空白的畫布,面板出來以後一格一格畫(每格一個畫面),同一頁再打開就直接用畫好的 */
T['托盤小圖不在點下去那一下畫:openSheet 回來時 render 0 次、畫布大小已經定好;之後一格一格補上,每格各畫一次;同一頁再打開直接用畫好的'] = async () => {
  const pg = load({ view: foodView({ pantry: { order: ['corn', 'pea', 'yam', 'worm'], stock: { corn: 2, pea: 0, yam: 9, worm: 1 } } }), food: true });
  pg.open();
  const r40 = () => pg.log.render.filter(r => r[1] && r[1].size === 40).length;
  const drawn = () => pg.tiles().map(b => b.querySelector('canvas.pet-tile-cv')).filter(c => (c.ctxLog || []).some(x => /^drawImage/.test(x))).length;
  const sync = r40(), sized = pg.tiles().every(b => { const c = b.querySelector('canvas.pet-tile-cv'); return c.width > 0 && c.height > 0; });
  const d0 = drawn();
  pg.timers.advance(20);
  const step1 = r40();
  pg.timers.advance(1000);
  const all = r40(), d1 = drawn();
  pg.doc.key('Escape'); pg.timers.advance(1000);
  pg.open();
  const again = r40() - all, d2 = drawn();
  return { ok: sync === 0 && d0 === 0 && sized && step1 <= 1 && all === 5 && d1 === 5 && again === 0 && d2 === 5,
    detail: JSON.stringify({ sync, d0, sized, step1, all, d1, again, d2 }) };
};
T['面板在小圖畫完之前就關掉:不再畫、不丟錯'] = async () => {
  const pg = load({ view: foodView(), food: true });
  pg.open();
  pg.doc.key('Escape');
  const before = pg.log.render.length;
  pg.timers.advance(2000);
  return { ok: pg.log.render.filter(r => r[1] && r[1].size === 40).length === 0 && pg.log.render.length === before, detail: String(pg.log.render.length) };
};

/* ================= D. 格子狀態與標籤(契約第 6 節的表) ================= */
const LABEL_CASES = [
  ['飼料有', {}, 'grain', '飼料，4 顆，全部餵牠', [], false],
  ['飼料 0', { status: { food: 0 } }, 'grain', '飼料，0 顆', ['is-empty'], true],
  ['點心可以餵', {}, 'corn', '玉米，2 份，餵一份', [], false],
  ['點心 0 份', {}, 'pea', '豌豆，0 份', ['is-empty'], true],
  ['今天還沒練習', { pantry: { practiced: false, canSnack: false, gotToday: null }, status: { todayCount: 0 } }, 'corn', '玉米，2 份，今天練習一下才能餵', ['is-locked'], true],
  ['今天的點心餵過了', { pantry: { ateToday: true, ateFood: 'pea', canSnack: false } }, 'corn', '玉米，2 份，今天的點心餵過了', ['is-done'], true],
  ['滿了', {}, 'yam', '地瓜，9 份，滿了，餵一份', ['is-full'], false],
  ['最愛(favKnown)', { pantry: { fav: 'corn', favKnown: true } }, 'corn', '玉米，最喜歡的，2 份，餵一份', ['is-fav'], false],
  ['最愛還不知道時不寫', { pantry: { fav: 'corn', favKnown: false } }, 'corn', '玉米，2 份，餵一份', [], false],
];
for (const [name, over, id, label, cls, dis] of LABEL_CASES) {
  T['格子標籤:' + name + ' → 「' + label + '」'] = async () => {
    const pg = load({ view: foodView(over), food: true });
    pg.open();
    const b = pg.tile(id);
    const hasCls = cls.every(c => b.classList.contains(c));
    const others = ['is-empty', 'is-locked', 'is-done', 'is-full', 'is-fav', 'is-busy'].filter(c => !cls.includes(c)).every(c => !b.classList.contains(c));
    const d = b.getAttribute('aria-disabled') === 'true';
    return { ok: b.getAttribute('aria-label') === label && hasCls && others && d === dis && !b.disabled,
      detail: JSON.stringify({ label: b.getAttribute('aria-label'), cls: b.className, dis: b.getAttribute('aria-disabled') }) };
  };
}
T['滿了:份數寫「9 份」,「滿了」自己一行(.pet-tile-f,跟預覽一樣);沒滿的格子那一行空著;最愛有愛心(.pet-heart),還不知道時沒有'] = async () => {
  const pg = load({ view: foodView({ pantry: { fav: 'corn', favKnown: true } }), food: true });
  pg.open();
  const pg2 = load({ view: foodView(), food: true });
  pg2.open();
  const full = id => { const e = pg.tile(id).querySelector('.pet-tile-f'); return e ? e.textContent : null; };
  const kids = pg.tile('yam').children.map(n => n.className);
  return { ok: pg.count('yam') === '9 份' && full('yam') === '滿了' && full('corn') === '' && full('grain') === '' && kids.indexOf('pet-tile-f') === kids.indexOf('pet-tile-c') + 1 &&
    pg.tile('yam').getAttribute('aria-label') === '地瓜，9 份，滿了，餵一份' &&
    !!pg.tile('corn').querySelector('.pet-heart') && !pg2.tile('corn').querySelector('.pet-heart') && !pg.tile('yam').querySelector('.pet-heart'),
    detail: JSON.stringify({ c: pg.count('yam'), f: full('yam'), kids, label: pg.tile('yam').getAttribute('aria-label') }) };
};
T['唯讀:托盤整排變淡(is-ro)、每格 aria-disabled,下面放現有的唯讀說明;點了不吃不餵'] = async () => {
  const bad = [];
  for (const reason of ['readOnly', 'clock']) {
    const pg = load({ view: foodView({ readOnly: true, reason }), food: true });
    pg.open();
    const all = pg.tiles().every(b => b.getAttribute('aria-disabled') === 'true');
    const hint = pg.sheet.querySelector('.pet-hint').textContent;
    pg.tile('corn').fire('click'); pg.tile('grain').fire('click');
    await flush();
    if (!(pg.sheet.querySelector('.pet-tray').classList.contains('is-ro') && all && hint === RO_TEXT[reason] && pg.log.calls.length === 0 && !pg.sheet.querySelector('.pet-pen')))
      bad.push(reason + ' ' + JSON.stringify({ all, hint, calls: pg.log.calls }));
  }
  return { ok: !bad.length, detail: bad.join(' / ') };
};

/* ================= E. 點心那一行、提示、沒有食物 ================= */
T['點心那一行:今天的券是地瓜(y)或麵包蟲(w:)而且還沒吃:「今天拿到 1 份地瓜。」「今天拿到 1 份麵包蟲。」(看不出是不是從結束畫面拿的,第二輪審查);吃過了照樣寫吃過'] = async () => {
  const t = over => { const pg = load({ view: foodView(over), food: true }); pg.open(); return pg.sheet.querySelector('.pet-snack-line').textContent; };
  const y = t({ pantry: { gotToday: { id: 'y', food: 'yam' } } }), ws = t({ pantry: { gotToday: { id: 'w:s1', food: 'worm' } } }), wa = t({ pantry: { gotToday: { id: 'w:a2', food: 'worm' } } });
  const ya = t({ pantry: { gotToday: { id: 'y', food: 'yam' }, ateToday: true } }), g = t({ pantry: { gotToday: { id: 'g:ga-01', food: 'pea' } } });
  return { ok: y === '今天拿到 1 份地瓜。' && ws === '今天拿到 1 份麵包蟲。' && wa === ws && ya === '今天的點心吃過了，明天再餵。' && g === '', detail: JSON.stringify([y, ws, wa, ya, g]) };
};
T['點心那一行:吃過「今天的點心吃過了，明天再餵。」;今天的券是 m 還沒吃「今天拿到 1 份青江菜。」;其他空的'] = async () => {
  const t = over => { const pg = load({ view: foodView(over), food: true }); pg.open(); return pg.sheet.querySelector('.pet-snack-line').textContent; };
  const a = t({ pantry: { ateToday: true } }), b = t({ pantry: { gotToday: { id: 'm', food: 'greens' } } }), c = t({}), d = t({ pantry: { gotToday: { id: 'm', food: 'greens' }, ateToday: true } });
  return { ok: a === '今天的點心吃過了，明天再餵。' && b === '今天拿到 1 份青江菜。' && c === '' && d === a, detail: JSON.stringify([a, b, c, d]) };
};
T['「點一下就餵」前 3 次打開才出現,次數存在 tr_pet_hint'] = async () => {
  const pg = load({ view: foodView(), food: true });
  const seen = [];
  for (let i = 0; i < 5; i++) { pg.open(); seen.push(pg.sheet.querySelector('.pet-hint').textContent); pg.doc.key('Escape'); pg.timers.advance(1000); }
  return { ok: JSON.stringify(seen) === JSON.stringify(['點一下就餵', '點一下就餵', '點一下就餵', '', '']) && pg.log.storage.tr_pet_hint === '3', detail: JSON.stringify([seen, pg.log.storage]) };
};
T['localStorage 讀不到時照樣顯示「點一下就餵」,不丟錯'] = async () => {
  const pg = load({ view: foodView(), food: true, noStorage: true });
  pg.open();
  return { ok: pg.sheet.querySelector('.pet-hint').textContent === '點一下就餵', detail: pg.sheet.querySelector('.pet-hint').textContent };
};
T['今天還沒練習而且有存點心:提示那一行是「今天練習一下，就可以餵點心。」'] = async () => {
  const pg = load({ view: foodView({ pantry: { practiced: false, canSnack: false, gotToday: null } }), food: true });
  pg.open();
  return { ok: pg.sheet.querySelector('.pet-hint').textContent === '今天練習一下，就可以餵點心。', detail: pg.sheet.querySelector('.pet-hint').textContent };
};
T['沒有食物:只剩一格變淡的飼料,下面一行說明加一般按鈕(不是 primary)'] = async () => {
  const pg = load({ view: foodView({ status: { food: 0 }, pantry: { order: [], stock: {}, gotToday: null } }), food: true });
  pg.open();
  const e = pg.sheet.querySelector('.pet-empty');
  const a = e && e.querySelector('a');
  const seq = pg.sheet.children.map(n => n.className.split(' ')[0]);
  return { ok: pg.tiles().length === 1 && pg.tile('grain').classList.contains('is-empty') && !!e && e.querySelector('p').textContent === '答題就有飼料，每天第一個完成的練習有一份點心。' &&
    !!a && a.classList.contains('btn') && a.classList.contains('pet-go') && !a.classList.contains('primary') && a.textContent === '去做每日練習' && seq.indexOf('pet-empty') === seq.indexOf('pet-hint') + 1,
    detail: JSON.stringify({ n: pg.tiles().length, a: a && a.className, seq }) };
};
T['有點心存著或有飼料時沒有 .pet-empty'] = async () => {
  const pg = load({ view: foodView({ status: { food: 0 } }), food: true });
  pg.open();
  return { ok: !pg.sheet.querySelector('.pet-empty'), detail: '' };
};

/* ================= F. 鍵盤 ================= */
T['roving tabindex:整排只有一個 tabindex=0;左右鍵一格一格換、Home、End;上下鍵不處理;Enter、空白鍵不攔(交給按鈕)'] = async () => {
  const pg = load({ view: foodView(), food: true });
  pg.open();
  const tray = pg.sheet.querySelector('.pet-tray');
  const zero = () => pg.tiles().filter(b => b.getAttribute('tabindex') === '0').map(b => b.getAttribute('data-focus'));
  const steps = [];
  const press = key => { const ev = tray.fire('keydown', { key, target: pg.doc.activeElement }); steps.push(key + '>' + (pg.doc.activeElement && pg.doc.activeElement.getAttribute('data-focus')) + '/' + zero().join() + (ev.defaultPrevented ? '!' : '')); return ev; };
  const start = zero().join();
  pg.tile('grain').focus();
  press('ArrowRight'); press('ArrowRight'); press('ArrowLeft'); press('End'); press('ArrowRight'); press('Home'); press('ArrowLeft');
  const up = press('ArrowDown'), en = press('Enter'), sp = press(' ');
  const want = ['ArrowRight>food-corn/food-corn!', 'ArrowRight>food-pea/food-pea!', 'ArrowLeft>food-corn/food-corn!', 'End>food-yam/food-yam!', 'ArrowRight>food-yam/food-yam!', 'Home>food-grain/food-grain!', 'ArrowLeft>food-grain/food-grain!',
    'ArrowDown>food-grain/food-grain', 'Enter>food-grain/food-grain', ' >food-grain/food-grain'];
  return { ok: start === 'food-grain' && JSON.stringify(steps) === JSON.stringify(want) && !up.defaultPrevented && !en.defaultPrevented && !sp.defaultPrevented,
    detail: JSON.stringify({ start, steps }) };
};
T['焦點鎖排除 tabindex=-1:從最後一個 Tab 回到 ×,Shift+Tab 從 × 到最後一個'] = async () => {
  const pg = load({ view: foodView({ roamV2: true }), food: true, roam2: true });
  pg.open();
  const order = focusOrder(pg.sheet);
  const x = pg.sheet.querySelector('.modal-close');
  const last = pg.sheet.querySelectorAll('button, a[href], input').filter(n => !n.disabled && n.offsetParent !== null && n.getAttribute('tabindex') !== '-1').pop();
  x.focus();
  const ev1 = pg.doc.key('Tab', { shiftKey: true });
  const a1 = pg.doc.activeElement;
  last.focus();
  const ev2 = pg.doc.key('Tab');
  const a2 = pg.doc.activeElement;
  const lastTile = pg.tile('yam');
  lastTile.focus();
  const ev3 = pg.doc.key('Tab');
  return { ok: a1 === last && ev1.defaultPrevented && a2 === x && ev2.defaultPrevented && !ev3.defaultPrevented && order.filter(s => /pet-tile/.test(s)).length === 1,
    detail: JSON.stringify({ order, a1: a1 && a1.className, a2: a2 && a2.className }) };
};
T['常識提示:鍵盤把焦點移到格子時出現(role=tooltip),Esc 先收提示、再按一次才關面板'] = async () => {
  const pg = load({ view: foodView(), food: true });
  pg.open();
  pg.doc.key('Tab');
  pg.tile('corn').focus();
  const tip = pg.doc.body.querySelector('.pet-tip');
  const ok1 = !!tip && tip.getAttribute('role') === 'tooltip' && tip.textContent === '玉米要壓碎再給小雞，整顆太大。';
  pg.doc.key('Escape');
  const ok2 = !pg.doc.body.querySelector('.pet-tip') && !!pg.doc.body.querySelector('.pet-sheet') && pg.doc.body.querySelector('.pet-mask').className.indexOf('is-off') < 0;
  pg.doc.key('Escape');
  const ok3 = pg.doc.body.querySelector('.pet-mask') === null || pg.doc.body.querySelector('.pet-mask').classList.contains('is-off');
  return { ok: ok1 && ok2 && ok3, detail: JSON.stringify({ ok1, ok2, ok3 }) };
};
T['常識提示:滑鼠停住出現、離開收起;飼料沒有提示;點滑鼠後的焦點不出提示'] = async () => {
  const pg = load({ view: foodView(), food: true });
  pg.open();
  pg.tile('yam').fire('pointerenter', { pointerType: 'mouse' });
  const a = pg.doc.body.querySelector('.pet-tip');
  const ta = a && a.textContent;
  pg.tile('yam').fire('pointerleave', { pointerType: 'mouse' });
  const b = pg.doc.body.querySelector('.pet-tip');
  pg.tile('grain').fire('pointerenter', { pointerType: 'mouse' });
  const c = pg.doc.body.querySelector('.pet-tip');
  pg.doc.body.querySelector('.pet-mask').fire('pointerdown', { pointerType: 'mouse' });
  pg.tile('corn').focus();
  const d = pg.doc.body.querySelector('.pet-tip');
  return { ok: ta === '點心只占一小部分，主食還是飼料。' && !b && !c && !d, detail: JSON.stringify({ ta, b: !!b, c: !!c, d: !!d }) };
};
T['常識提示:長按 500 毫秒出現,這次放開不算點(不吃)'] = async () => {
  const pg = load({ view: foodView(), food: true });
  pg.open();
  const b = pg.tile('corn');
  b.fire('pointerdown', { pointerType: 'touch' });
  pg.timers.advance(499);
  const early = !!pg.doc.body.querySelector('.pet-tip');
  pg.timers.advance(2);
  const shown = !!pg.doc.body.querySelector('.pet-tip');
  b.fire('pointerup', { pointerType: 'touch' });
  b.fire('click');
  pg.timers.advance(1300);
  const gone = !pg.doc.body.querySelector('.pet-tip');
  b.fire('pointerdown', { pointerType: 'touch' }); pg.timers.advance(100); b.fire('pointerup', { pointerType: 'touch' }); b.fire('click');
  return { ok: !early && shown && gone && pg.log.calls.join() === 'eat:corn', detail: JSON.stringify({ early, shown, gone, calls: pg.log.calls }) };
};

/* ================= G. 吃點心 ================= */
function deferred() { let res; const p = new Promise(r => { res = r; }); return { p, res }; }
T['點心可以餵:S.eat 呼叫一次;份數和點心那一行在點下去當下就變;live 照念;動畫中整排 is-busy、連點不排隊'] = async () => {
  const d = deferred();
  const pg = load({ view: foodView(), food: true });
  pg.state.eat = () => ({ ok: true, reason: null, left: 1, saved: d.p });
  pg.open();
  pg.tile('corn').fire('click');
  pg.timers.advance(50);
  const c1 = pg.count('corn'), line = pg.sheet.querySelector('.pet-snack-line').textContent, live = pg.live();
  const busy = pg.tiles().every(b => b.classList.contains('is-busy') && b.getAttribute('aria-disabled') === 'true');
  const labelDone = pg.tile('yam').getAttribute('aria-label');
  pg.tile('corn').fire('click'); pg.tile('yam').fire('click'); pg.tile('grain').fire('click');
  const calls = pg.log.calls.slice();
  pg.timers.advance(1300);
  const after = pg.tiles().every(b => !b.classList.contains('is-busy'));
  const doneNow = pg.tile('yam').classList.contains('is-done');
  return { ok: c1 === '1 份' && line === '今天的點心吃過了，明天再餵。' && live === '小黃吃了玉米。還有 1 份。' && busy && calls.join() === 'eat:corn' && after && doneNow &&
    labelDone === '地瓜，9 份，滿了，今天的點心餵過了',
    detail: JSON.stringify({ c1, line, live, busy, calls, after, doneNow, labelDone }) };
};
T['吃完最後一份:live「小黃吃了玉米。」'] = async () => {
  const pg = load({ view: foodView({ pantry: { stock: { corn: 1, pea: 0, yam: 9 } } }), food: true });
  pg.state.eat = () => ({ ok: true, reason: null, left: 0 });
  pg.open();
  pg.tile('corn').fire('click'); pg.timers.advance(50);
  return { ok: pg.live() === '小黃吃了玉米。' && pg.count('corn') === '0 份', detail: pg.live() + ' ' + pg.count('corn') };
};
T['第一次吃到最愛:live 加「牠最喜歡玉米。」,格子馬上有愛心;小雞名字空的時候用「小雞」'] = async () => {
  const pg = load({ view: foodView({ status: { name: '' }, pantry: { fav: 'corn' } }), food: true });
  pg.open();
  pg.tile('corn').fire('click'); pg.timers.advance(50);
  return { ok: pg.live() === '小雞吃了玉米。還有 1 份。牠最喜歡玉米。' && !!pg.tile('corn').querySelector('.pet-heart'), detail: pg.live() };
};
/* 第三輪審查 #10 起:eat 不再交給引擎播一次(只啄 2 下),改成照食物的口數一格一格畫(每一口都咬到) */
T['動畫:小雞播 eat 再 happy;啄地那格各咬一口舞台上的食物(56 px、不錯開),口數照食物;面板小雞 maxDpr 1.5、variants 1'] = async () => {
  const pg = load({ view: foodView(), food: true });
  pg.open();
  const opt = pg.log.animate[pg.log.animate.length - 1];
  pg.tile('corn').fire('click'); pg.timers.advance(20);
  const stage = pg.log.mounts.find(m => m.opt && m.opt.size === 56);
  const sf = pg.sheet.querySelector('.pet-stage-food');
  const shown = sf && !sf.hidden;
  const poses = pg.log.poses.slice();
  pg.timers.advance(1600);
  const bites = stage && stage.bites;
  pg.state.tick({ pose: 'happy', frame: 0 });
  return { ok: opt.maxDpr === 1.5 && opt.variants === 1 && opt.size === 160 && !!stage && stage.id === 'corn' && stage.opt.stagger === false && shown && poses.includes('show:eat:1') && bites === 3 && stage.done && sf.hidden,
    detail: JSON.stringify({ opt, stage: stage && stage.opt, shown, poses, bites, done: stage && stage.done, hidden: sf && sf.hidden }) };
};
T['餵點心:食物飛過來時小雞先張嘴(happy 第 1 格停住),食物到了才播 eat、happy;之後不會被拉回待機'] = async () => {
  const pg = load({ view: foodView(), food: true });
  pg.open();
  const n0 = pg.log.poses.length;
  pg.tile('corn').fire('click'); pg.timers.advance(20);
  const seq = pg.log.poses.slice(n0);
  const i = seq.indexOf('show:happy:0'), j = seq.indexOf('show:eat:1');
  pg.timers.advance(600);
  const last = pg.log.poses.slice(n0);
  return { ok: i >= 0 && j > i && last.slice(j).every(p => /^show:eat:/.test(p)), detail: JSON.stringify(last) };
};
T['餵點心的飛行(0.3 秒)途中:小雞一直張著嘴、還沒吃;食物到了才播 eat'] = async () => {
  const pg = load({ view: foodView(), food: true });
  pg.open();
  const proto = Object.getPrototypeOf(pg.sheet);
  proto.animate = () => ({});                                   // 這個假頁面的飛行動畫不會自己結束,靠 0.45 秒的收尾計時器
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, width: 40, height: 40 });
  const n0 = pg.log.poses.length;
  pg.tile('corn').fire('click');
  pg.timers.advance(100);
  const mid = pg.log.poses.slice(n0);
  const flying = !!pg.doc.body.querySelector('.pet-tile-fly');
  pg.timers.advance(400);
  const after = pg.log.poses.slice(n0);
  return { ok: flying && mid.length === 1 && mid[0] === 'show:happy:0' && after.indexOf('show:eat:1') > 0 && after.indexOf('idle') < 0,
    detail: JSON.stringify({ flying, mid, after }) };
};
/* 第三輪審查 #10:引擎的 eat 只啄 2 下,要咬 3、4 口的食物剩一截直接消失。照預覽 eatSeq:第 1 到 5 格,不夠就重複第 4、5 格,最後第 6、7 格 */
const J = x => JSON.stringify(x);
const eatShows = (poses) => poses.filter(p => /^show:eat:/.test(p)).map(p => +p.split(':')[2]);
const wantSeq = n => { const ks = [1, 2, 3, 4, 5]; for (let k = 2; k < n; k++) ks.push(4, 5); return ks.concat([6, 7, 7]); };
T['餵點心:啄地的次數等於食物要咬的口數(3 口、4 口、2 口),每一口都咬到,吃完才接 happy;離開 eat 時食物已經吃完'] = async () => {
  const bad = [];
  for (const [id, steps] of [['corn', 3], ['yam', 4], ['corn', 2]]) {
    const pg = load({ view: foodView(), food: true });
    pg.ctx.FoodArt.info[id].steps = steps;
    pg.open();
    const n0 = pg.log.poses.length;
    pg.tile(id).fire('click'); pg.timers.advance(20);
    const stage = pg.log.mounts.find(m => m.opt && m.opt.size === 56);
    pg.timers.advance(1700);
    const seq = eatShows(pg.log.poses.slice(n0)), bites = stage && stage.bites, doneEarly = stage && stage.done;
    const last = pg.log.poses.slice(-1)[0];
    pg.state.tick({ pose: 'happy', frame: 0 });
    const sf = pg.sheet.querySelector('.pet-stage-food');
    if (!(stage && bites === steps && !doneEarly && J(seq) === J(wantSeq(steps)) && last === 'happy' && stage.done && sf.hidden))
      bad.push(id + ' ' + steps + ' 口:' + JSON.stringify({ seq, bites, doneEarly, last, done: stage && stage.done, hidden: sf.hidden }));
  }
  return { ok: !bad.length, detail: bad.join(' / ') };
};
T['餵飼料:飼料到了舞台、存好了才吃,啄 3 下咬 3 口(飼料 3 口),吃完接 happy'] = async () => {
  let v = foodView();
  const pg = load({ view: () => v, food: true });
  pg.open();
  const n0 = pg.log.poses.length;
  pg.tile('grain').fire('click');
  v = foodView({ status: { food: 0 } });
  await flush(); await flush();
  const stage = pg.log.mounts.find(m => m.opt && m.opt.size === 56 && m.id === 'grain');
  pg.timers.advance(2000);
  const seq = eatShows(pg.log.poses.slice(n0)), bites = stage && stage.bites;
  return { ok: !!stage && bites === 3 && J(seq) === J(wantSeq(3)) && pg.log.poses.slice(-1)[0] === 'happy' && !pg.log.poses.slice(n0).includes('eat'),
    detail: JSON.stringify({ seq, bites, poses: pg.log.poses.slice(n0) }) };
};
/* 第三輪審查 #8:點心飛過去的 0.3 秒內切到背景,食物停在小雞嘴邊、一直重畫 */
T['餵點心時切到背景:飛行途中或吃到一半,回來時舞台上的食物收掉、不再重畫;吃到一半的回到待機,不會一直卡在 eat'] = async () => {
  const bad = [];
  for (const when of ['fly', 'eat']) {
    const pg = load({ view: foodView(), food: true });
    pg.open();
    const proto = Object.getPrototypeOf(pg.sheet);
    if (when === 'fly') { proto.animate = () => ({}); proto.getBoundingClientRect = () => ({ left: 0, top: 0, width: 40, height: 40 }); }
    const vis = (s) => { pg.doc.visibilityState = s; (pg.doc.listeners.visibilitychange || []).slice().forEach(f => f()); };
    pg.tile('corn').fire('click');
    pg.timers.advance(when === 'fly' ? 80 : 400);
    vis('hidden');
    pg.timers.advance(3000);
    vis('visible');
    const stage = pg.log.mounts.find(m => m.opt && m.opt.size === 56);
    const sf = pg.sheet.querySelector('.pet-stage-food');
    const lastPose = pg.log.poses.slice(-1)[0];
    pg.timers.advance(2000);
    const after = pg.log.poses.slice(-1)[0];
    if (!(stage && sf.hidden && stage.stopped && after !== 'eat' && lastPose !== 'eat')) bad.push(when + ':' + JSON.stringify({ stage: !!stage, hidden: sf.hidden, stopped: stage && stage.stopped, lastPose, after }));
    delete proto.animate; delete proto.getBoundingClientRect;
  }
  return { ok: !bad.length, detail: bad.join(' / ') };
};
T['最愛第一次吃到:頭上 3 顆塗鴉愛心畫在畫布上(預覽的 heartPath),每格重畫、線條會抖,約 1.7 秒後收掉;托盤格子的愛心還是那張圖'] = async () => {
  const pg = load({ view: foodView({ pantry: { fav: 'corn' } }), food: true });
  pg.open();
  pg.tile('corn').fire('click'); pg.timers.advance(20);
  pg.state.tick({ pose: 'eat', frame: 1 });
  pg.state.tick({ pose: 'happy', frame: 3 });
  const stage = pg.sheet.querySelector('.pet-stage');
  const pops = stage.querySelectorAll('.pet-pop');
  const c = pops[0];
  const isCanvas = pops.length === 1 && c.tagName === 'CANVAS' && c.getAttribute('aria-hidden') === 'true' && !c.html && !c.querySelector('svg');
  const frames = [];
  for (let i = 0; i < 8; i++) { const n = (c && c.ctxLog || []).length; pg.timers.advance(143); frames.push((c && c.ctxLog || []).slice(n).join(';')); }
  const drawn = frames.filter(f => /lineTo/.test(f));
  const all = frames.join(';');
  const style = /lineWidth=2.20/.test(all) && /strokeStyle=#151515/.test(all) && /fillStyle=#ff7a93/.test(all) && /globalAlpha/.test(all);
  pg.timers.advance(2000);
  const gone = !stage.querySelector('.pet-pop');
  return { ok: isCanvas && drawn.length >= 6 && new Set(drawn).size === drawn.length && style && gone && !!pg.tile('corn').querySelector('.pet-heart'),
    detail: JSON.stringify({ isCanvas, pops: pops.map(p => p.tagName), drawn: drawn.length, distinct: new Set(drawn).size, style, gone }) };
};
T['減少動態的最愛:愛心畫一次(不動),1 秒後收掉'] = async () => {
  const pg = load({ view: foodView({ pantry: { fav: 'corn' } }), food: true, reduce: true });
  pg.open();
  pg.tile('corn').fire('click');
  const stage = pg.sheet.querySelector('.pet-stage');
  const c = stage.querySelector('.pet-pop');
  const n1 = c && c.ctxLog ? c.ctxLog.filter(l => l.startsWith('stroke(')).length : -1;
  pg.timers.advance(900);
  const n2 = c && c.ctxLog ? c.ctxLog.filter(l => l.startsWith('stroke(')).length : -1;
  const still = !!stage.querySelector('.pet-pop');
  pg.timers.advance(200);
  return { ok: !!c && c.tagName === 'CANVAS' && n1 === 3 && n2 === 3 && still && !stage.querySelector('.pet-pop'), detail: JSON.stringify({ tag: c && c.tagName, n1, n2, still }) };
};
T['橫放(高度 500 以下):面板小雞 96 px、舞台食物 40 px'] = async () => {
  const pg = load({ view: foodView(), food: true, land: true });
  pg.open();
  const opt = pg.log.animate[pg.log.animate.length - 1];
  pg.tile('corn').fire('click'); pg.timers.advance(20);
  const stage = pg.log.mounts.find(m => m.opt && m.opt.size === 40);
  return { ok: opt.size === 96 && !!stage, detail: JSON.stringify({ size: opt.size, mounts: pg.log.mounts.map(m => m.opt.size) }) };
};
T['減少動態:食物不上舞台,小雞換 eat 靜止格停 1 秒再回待機;份數立刻更新;live 照念'] = async () => {
  const pg = load({ view: foodView(), food: true, reduce: true });
  pg.open();
  pg.tile('corn').fire('click'); pg.timers.advance(50);
  const p1 = pg.log.poses.slice(-1)[0], c1 = pg.count('corn'), live = pg.live();
  const stage = pg.log.mounts.find(m => m.opt && m.opt.size === 56);
  pg.timers.advance(1000);
  const p2 = pg.log.poses.slice(-1)[0];
  const free = pg.tiles().every(b => !b.classList.contains('is-busy'));
  return { ok: p1 === 'eat' && p2 === 'idle' && c1 === '1 份' && live === '小黃吃了玉米。還有 1 份。' && !stage && free && pg.log.drawFrame > 0,
    detail: JSON.stringify({ p1, p2, c1, live, stage: !!stage, free, drawFrame: pg.log.drawFrame }) };
};
T['saved 失敗:live 說原因(唯讀、時鐘)或「沒有存到，再試一次。」,重畫後份數回來'] = async () => {
  const bad = [];
  for (const [reason, want] of [['readOnly', '玉米沒有餵，這台先不能改小雞的資料。'], ['clock', '玉米沒有餵，這台裝置的日期不對，調好以後再餵。'], ['error', '沒有存到，再試一次。'], ['failed', '沒有存到，再試一次。']]) {
    const pg = load({ view: foodView(), food: true });
    pg.state.saved = Promise.resolve({ ok: false, reason });
    pg.open();
    pg.tile('corn').fire('click');
    await flush(); await flush();
    pg.timers.advance(1300);
    if (!(pg.live() === want && pg.count('corn') === '2 份' && !pg.tile('corn').classList.contains('is-done'))) bad.push(reason + ' ' + pg.live() + ' ' + pg.count('corn'));
  }
  return { ok: !bad.length, detail: bad.join(' / ') };
};
T['saved 成功:份數照 view() 新的資料畫'] = async () => {
  let v = foodView();
  const pg = load({ view: () => v, food: true });
  pg.open();
  pg.tile('corn').fire('click');
  v = foodView({ pantry: { stock: { corn: 1, pea: 0, yam: 9 }, ateToday: true, ateFood: 'corn', canSnack: false } });
  pg.emit('pet:change');
  await flush(); await flush();
  pg.timers.advance(1300);
  return { ok: pg.count('corn') === '1 份' && pg.tile('yam').classList.contains('is-done'), detail: pg.count('corn') };
};
T['今天還沒練習:不吃,提示那一行和 live 念「今天練習一下，就可以餵點心。」'] = async () => {
  const pg = load({ view: foodView({ pantry: { practiced: false, canSnack: false, gotToday: null } }), food: true });
  pg.open();
  pg.tile('corn').fire('click'); pg.timers.advance(100);
  return { ok: pg.log.calls.length === 0 && pg.live() === '今天練習一下，就可以餵點心。' && pg.sheet.querySelector('.pet-hint').textContent === '今天練習一下，就可以餵點心。',
    detail: JSON.stringify({ calls: pg.log.calls, live: pg.live() }) };
};
T['今天餵過了:不呼叫 eat、播 nope、不扣;live「小黃今天吃過點心了，明天再餵。」'] = async () => {
  const pg = load({ view: foodView({ pantry: { ateToday: true, ateFood: 'pea', canSnack: false } }), food: true });
  pg.open();
  pg.tile('corn').fire('click'); pg.timers.advance(100);
  const poses = pg.log.poses.slice(), live = pg.live(), c = pg.count('corn');
  pg.timers.advance(2000);
  const sf = pg.sheet.querySelector('.pet-stage-food');
  return { ok: pg.log.calls.length === 0 && poses.includes('nope') && live === '小黃今天吃過點心了，明天再餵。' && c === '2 份' && sf.hidden && pg.tiles().every(b => !b.classList.contains('is-busy')),
    detail: JSON.stringify({ calls: pg.log.calls, poses, live, c }) };
};
T['eat 當場回 ateToday(另一個分頁剛吃):照「今天餵過了」播 nope,不扣'] = async () => {
  const pg = load({ view: foodView(), food: true });
  pg.state.eat = () => ({ ok: false, reason: 'ateToday' });
  pg.open();
  pg.tile('corn').fire('click'); pg.timers.advance(100);
  return { ok: pg.live() === '小黃今天吃過點心了，明天再餵。' && pg.count('corn') === '2 份' && pg.log.poses.includes('nope'), detail: pg.live() };
};
T['0 份:什麼都不做'] = async () => {
  const pg = load({ view: foodView(), food: true });
  pg.open();
  pg.tile('pea').fire('click'); pg.timers.advance(100);
  return { ok: pg.log.calls.length === 0 && pg.live() === '' && !pg.tiles().some(b => b.classList.contains('is-busy')), detail: JSON.stringify(pg.log.calls) };
};

/* ================= H. 飼料 ================= */
T['飼料:呼叫 feed,份數當下變 0,成功 live「餵了 4 顆。」'] = async () => {
  let v = foodView();
  const pg = load({ view: () => v, food: true });
  pg.open();
  pg.tile('grain').fire('click');
  const c0 = pg.count('grain');
  v = foodView({ status: { food: 0 } });
  await flush(); await flush();
  pg.timers.advance(1300);
  return { ok: pg.log.calls.join() === 'feed' && c0 === '0 顆' && pg.live() === '餵了 4 顆。' && pg.count('grain') === '0 顆', detail: JSON.stringify({ c0, live: pg.live(), calls: pg.log.calls }) };
};
T['飼料:失敗時份數畫回來,live「沒有存到，再試一次。」'] = async () => {
  const pg = load({ view: foodView(), food: true });
  pg.state.feedRes = { ok: false, reason: 'error' };
  pg.open();
  pg.tile('grain').fire('click');
  await flush(); await flush();
  pg.timers.advance(3000);
  const sf = pg.sheet.querySelector('.pet-stage-food');
  return { ok: pg.count('grain') === '4 顆' && pg.live() === '沒有存到，再試一次。' && sf.hidden, detail: pg.count('grain') + ' ' + pg.live() };
};

/* ================= I. pet:earn、走動開關、卡片 ================= */
T['面板打開時收到 pet:earn 就重畫'] = async () => {
  let v = foodView();
  const pg = load({ view: () => v, food: true });
  pg.open();
  v = foodView({ pantry: { stock: { corn: 3, pea: 0, yam: 9 } } });
  pg.emit('pet:earn');
  return { ok: pg.count('corn') === '3 份' && pg.log.win.includes('pet:earn'), detail: pg.count('corn') };
};
T['走動開關:role=switch、aria-checked 跟 view().roam 一致、aria-labelledby;按了呼叫 setRoam(!on),存的時候 aria-disabled'] = async () => {
  const d = deferred();
  const pg = load({ view: foodView({ roamV2: true, roam: true }), roam2: true });
  pg.state.roamRes = d.p;
  pg.open();
  const sw = pg.sheet.querySelector('.pet-switch');
  const lab = pg.doc.getElementById('pet-roam-l');
  const a = sw.getAttribute('role') === 'switch' && sw.getAttribute('aria-checked') === 'true' && sw.getAttribute('aria-labelledby') === 'pet-roam-l' && lab && lab.textContent === '小雞在頁面上走動' && sw.getAttribute('type') === 'button' && sw.getAttribute('data-focus') === 'roam';
  sw.focus(); sw.fire('click');
  const s2 = pg.sheet.querySelector('.pet-switch');
  const busy = s2.getAttribute('aria-disabled') === 'true';
  s2.fire('click');
  d.res({ ok: true });
  await flush(); await flush();
  const s3 = pg.sheet.querySelector('.pet-switch');
  const pg2 = load({ view: foodView({ roamV2: true, roam: false }), roam2: true });
  pg2.open();
  const off = pg2.sheet.querySelector('.pet-switch').getAttribute('aria-checked') === 'false';
  pg2.sheet.querySelector('.pet-switch').fire('click');
  return { ok: a && busy && pg.log.calls.join() === 'roam:false' && s3.getAttribute('aria-disabled') === null && pg.doc.activeElement === s3 && off && pg2.log.calls.join() === 'roam:true',
    detail: JSON.stringify({ a, busy, calls: pg.log.calls, c2: pg2.log.calls }) };
};
T['走動開關:存不了時用 saveMsg 說「設定沒有改…」;「我的」那一區打開的面板也有'] = async () => {
  const pg = load({ view: foodView({ roamV2: true }), roam2: true });
  pg.state.roamRes = Promise.resolve({ ok: false, reason: 'readOnly' });
  pg.open({ noGoal: true });
  const has = !!pg.sheet.querySelector('.pet-switch') && !pg.sheet.querySelector('.pet-goal');
  pg.sheet.querySelector('.pet-switch').fire('click');
  await flush(); await flush();
  return { ok: has && pg.live() === '設定沒有改，這台先不能改小雞的資料。', detail: pg.live() };
};
T['卡片(食物模式):.pet-act 一律放 button.btn.primary.pet-open「餵牠」,按了打開面板、關掉焦點回到它;唯讀說明照放'] = async () => {
  const bad = [];
  for (const where of ['home', 'me']) {
    for (const ro of [false, true]) {
      const pg = load({ view: foodView(ro ? { readOnly: true } : { status: { food: 0 } }), food: true, [where]: true });
      const card = pg.doc.body.querySelector('.pet-card');
      const act = card.querySelector('.pet-act');
      const b = act.querySelector('button.pet-open');
      const ok1 = !!b && b.classList.contains('btn') && b.classList.contains('primary') && b.textContent === '餵牠' && b.getAttribute('aria-haspopup') === 'dialog' && b.getAttribute('type') === 'button' &&
        !act.querySelector('.pet-feed') && !act.querySelector('.pet-go') && (!ro || (act.querySelector('.pet-note') && act.querySelector('.pet-note').textContent === RO_TEXT.readOnly));
      b.focus(); b.fire('click');
      const sheet = pg.doc.body.querySelector('.pet-sheet');
      const goal = !!(sheet && sheet.querySelector('.pet-goal'));
      pg.emit('pet:change');
      pg.doc.key('Escape');
      const back = pg.doc.activeElement === b && b.isConnected;
      if (!(ok1 && sheet && back && goal === (where === 'home' && !ro))) bad.push(where + (ro ? ' 唯讀' : '') + ' ' + JSON.stringify({ ok1, sheet: !!sheet, back, goal }));
    }
  }
  return { ok: !bad.length, detail: bad.join(' / ') };
};

/* ================= J. 文字規則 ================= */
T['新文字:沒有 emoji、沒有破折號、沒有「不是…而是」'] = async () => {
  const strs = (NEW_SRC.match(/'[^'\n]*[一-鿿][^'\n]*'/g) || []);
  const bad = strs.filter(s => /[—–⸺]|--|不是.*而是|[\u{1F300}-\u{1FAFF}☀-➿]/u.test(s));
  return { ok: bad.length === 0, detail: JSON.stringify(bad) };
};
T['pet-ui.js 不讀網址參數、不用 sessionStorage,localStorage 只用 tr_pet_hint;檔案 800 行以內'] = async () => {
  const lines = NEW_SRC.split('\n').length;
  const ls = (NEW_SRC.match(/localStorage\.[a-zA-Z]+\(([^)]*)\)/g) || []);
  return { ok: !/location\.search|URLSearchParams|sessionStorage/.test(NEW_SRC) && ls.every(s => /HINT_KEY/.test(s)) && /HINT_KEY = 'tr_pet_hint'/.test(NEW_SRC) && lines <= 800,
    detail: JSON.stringify({ lines, ls }) };
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let r;
    try { r = await T[name](); } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + (r.ok ? '' : '\n     ' + r.detail));
  }
  console.log('\n' + pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
