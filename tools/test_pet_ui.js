/* 小雞面板的文字與焦點(js/pet-ui.js):唯讀時不叫學生「再試一次」;說明不許下做不到的承諾;
   按下去才發現唯讀時,狀態列說清楚名字或目標沒有改,焦點留在面板(或卡片)裡。
   用法:node tools/test_pet_ui.js
   載入真的 js/pet-ui.js 與 js/common.js 的 h(),配一個很小的假 DOM 和假的 PET_STORE(只回這裡設好的 view 與結果)。
   這裡只看畫面上的字;讀寫與資料安全由 tools/test_pet_store.js 驗。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const H_SRC = (read('js/common.js').match(/function h\(tag[\s\S]*?\r?\n\}\r?\n/) || [''])[0];
if (!H_SRC) throw new Error('js/common.js 裡找不到 function h(tag, ...)');
const UI_SRC = read('js/pet-ui.js');

const RETRY = '沒有存到，再試一次。';
const OLD_BAD = '小雞的資料讀不到，這台先不能餵。';
const CLOCK = '這台裝置的日期不對，調好以後再餵。';
/* 按下去才發現唯讀:狀態列的一句(跟說明一樣不叫學生再試) */
const NOT_SAVED = {
  取名: { readOnly: '名字沒有改，這台先不能改小雞的資料。', clock: '名字沒有改，這台裝置的日期不對，調好以後再改。' },
  改目標: { readOnly: '目標沒有改，這台先不能改小雞的資料。', clock: '目標沒有改，這台裝置的日期不對，調好以後再改。' },
};

/* ---------- 很小的假 DOM:只做 pet-ui.js 用到的 ---------- */
function makeDom() {
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
      };
    }
    get children() { return this.kids.filter(k => k.nodeType === 1); }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.body; }
    get offsetParent() { return this.isConnected ? this.parentNode : null; }
    get offsetWidth() { return 100; }
    get disabled() { return 'disabled' in this.attrs; }
    get textContent() { return this.kids.map(k => k.textContent).join(this.kids.length > 1 && this.kids.every(k => k.nodeType === 1 && k.tagName === 'P') ? '\n' : ''); }
    set textContent(t) { this.replaceChildren(); if (t) this.append(doc.createTextNode(t)); }
    set innerHTML(v) { this.kids = []; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    adopt(n) { if (n.parentNode) n.remove(); n.parentNode = this; return n; }
    append(...ns) { ns.forEach(n => { n = n.nodeType ? n : doc.createTextNode(n); this.kids.push(this.adopt(n)); }); }
    prepend(...ns) { ns.reverse().forEach(n => { this.kids.unshift(this.adopt(n)); }); }
    after(n) { const p = this.parentNode; p.adopt(n); p.kids.splice(p.kids.indexOf(this) + 1, 0, n); }
    remove() { const p = this.parentNode; if (!p) return; p.kids.splice(p.kids.indexOf(this), 1); this.parentNode = null; }
    replaceChildren(...ns) { this.kids.slice().forEach(k => { k.parentNode = null; }); this.kids = []; this.append(...ns); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
    removeEventListener(t, f) { this.on[t] = (this.on[t] || []).filter(x => x !== f); }
    fire(t, extra) { const ev = Object.assign({ type: t, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} }, extra); (this.on[t] || []).slice().forEach(f => f(ev)); }
    focus() { doc.activeElement = this; }
    select() {}
    setPointerCapture() {}
    matches(sel) { return sel.split(',').some(s => simple(this, s.trim())); }
    closest(sel) { let n = this; while (n && n.nodeType === 1) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
    all() { const out = []; this.kids.forEach(k => { if (k.nodeType === 1) { out.push(k); out.push(...k.all()); } }); return out; }
    querySelectorAll(sel) { return this.all().filter(n => n.matches(sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  /* 支援 tag、.class、[attr]、[attr="v"] 的組合 */
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
  doc.getElementById = id => doc.ids[id] || null;
  doc.querySelector = sel => doc.body.querySelector(sel);
  doc.addEventListener = (t, f) => { (doc.listeners[t] = doc.listeners[t] || []).push(f); };
  doc.removeEventListener = (t, f) => { doc.listeners[t] = (doc.listeners[t] || []).filter(x => x !== f); };
  return doc;
}

/* ---------- 一個頁面:假的 PET_STORE 由 state 決定 view() 與每個動作的結果 ---------- */
function status(over) {
  return Object.assign({ today: '2026-10-16', name: '小黃', streak: 10, shields: 2, practicedDays: 12, todayCount: 25, goal: 20, nextGoal: 20,
    metToday: true, food: 0, sleeping: false, hungry: false, totalMet: 10 }, over || {});
}
function viewOf(kind) {
  const base = { on: true, cloud: false, guest: true, pet: { v: 1, days: {} } };
  if (kind === 'v1') return Object.assign(base, { readOnly: false, reason: '', newer: false, status: status() });
  if (kind === 'v2') return Object.assign(base, { readOnly: true, reason: 'readOnly', newer: true, pet: { v: 2, days: {} }, status: status() });
  if (kind === 'bad') return Object.assign(base, { readOnly: true, reason: 'readOnly', newer: false, status: status() });
  if (kind === 'clock') return Object.assign(base, { readOnly: true, reason: 'clock', newer: false, status: status() });
  throw new Error(kind);
}
function loadPage(state) {
  const doc = makeDom();
  const ctx = {
    document: doc, console,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    matchMedia: () => ({ matches: true }),
    /* pet:change:pet-store 寫入或讀到新資料時發的事件,state.emit() 可以手動發 */
    addEventListener(t, f) { if (t === 'pet:change') state.emit = f; },
    MutationObserver: class { observe() {} },
    PET: {},
    ChickArt: { metrics: { width: 100, height: 100 }, holds: () => [1], animate: (c, o) => ({ pose: o.pose, setPose(p) { this.pose = p; }, stop() {}, setFps() {} }) },
    PET_STORE: {
      on: true,
      view: () => viewOf(state.view),
      feed: async () => state.act('feed'),
      setGoal: async () => state.act('goal'),
      rename: async () => state.act('rename'),
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(H_SRC + '\nthis.h = h;', ctx);
  if (state.me) { doc.ids['me-root'] = doc.createElement('div'); doc.body.append(doc.ids['me-root']); }
  if (state.setup) state.setup(ctx, doc);   // 測試自己再加的(假的 html、MutationObserver、animate)
  vm.runInContext(UI_SRC, ctx);
  if (state.me) return { doc, ctx, card: doc.ids['me-root'].querySelector('.pet-card'), live: () => doc.ids['me-root'].querySelector('.pet-msg').textContent };
  const opener = doc.createElement('button');
  doc.body.append(opener);
  ctx.PET_UI.openSheet(opener);
  const sheet = doc.body.querySelector('.pet-sheet');
  return { doc, ctx, sheet, live: () => sheet.querySelector('.pet-msg').textContent, act: () => sheet.querySelector('.pet-act').textContent };
}
const flush = () => new Promise(r => setImmediate(r));

/* 學生按下去以後,這個分頁才發現紀錄變成 v2 或時鐘不對(另一台或新分頁剛寫了 v2);result 是 pet-store 回的結果。
   emit:pet-store 在回結果之前先發 pet:change(run() 的 finish() 就是這樣) */
function actor(result, after, emit) {
  const state = { view: 'v1', act: () => { state.view = after; if (emit && state.emit) state.emit(); return result; } };
  return state;
}
async function goalThen(result, after, emit) {
  const pg = loadPage(actor(result, after, emit));
  const b = pg.sheet.querySelector('[data-focus="goal40"]');
  if (!b) throw new Error('找不到 40 題的按鈕');
  b.focus(); b.fire('click'); await flush(); await flush();
  return pg;
}
async function renameThen(result, after, emit) {
  const state = actor(result, after, emit);
  const pg = loadPage(state);
  const pen = pg.sheet.querySelector('.pet-pen');
  if (!pen) throw new Error('找不到取名的筆');
  pen.fire('click');
  const form = pg.sheet.querySelector('form');
  form.querySelector('input').value = '阿啾';
  form.fire('submit'); await flush(); await flush();
  return pg;
}

const T = {};
for (const [what, run] of [['改目標', goalThen], ['取名', renameThen]]) {
  for (const [reason, after, note] of [['readOnly', 'v2', null], ['readOnly', 'bad', OLD_BAD], ['clock', 'clock', CLOCK]]) {
    for (const emit of [true, false]) {
      const when = emit ? '先收到 pet:change' : '沒有 pet:change';
      T[what + ':按下去才發現唯讀(' + reason + ',' + after + ',' + when + '),狀態列說沒有改、不叫學生再試,焦點留在面板裡'] = async () => {
        const pg = await run({ ok: false, reason, readOnly: true }, after, emit);
        const live = pg.live(), act = pg.act(), a = pg.doc.activeElement;
        const okNote = note ? act === note : act.length > 0 && !act.includes(RETRY);
        const okFocus = !!a && a.isConnected && pg.sheet.contains(a);
        return { ok: live === NOT_SAVED[what][reason] && !live.includes(RETRY) && okNote && okFocus,
          detail: '狀態列 ' + JSON.stringify(live) + ' / 說明 ' + JSON.stringify(act) + ' / 焦點 ' + (a && a.tagName) + ' 在畫面上 ' + (a && a.isConnected) + ' 在面板裡 ' + (a && pg.sheet.contains(a)) };
      };
    }
  }
  for (const reason of ['error', 'loggedOut', 'failed']) {
    T[what + ':真的沒存到(' + reason + ')照樣說「' + RETRY + '」'] = async () => {
      const pg = await run({ ok: false, reason }, 'v1');
      return { ok: pg.live() === RETRY, detail: '狀態列 ' + JSON.stringify(pg.live()) };
    };
  }
  T[what + ':沒有回覆也說「' + RETRY + '」'] = async () => {
    const pg = await run(undefined, 'v1');
    return { ok: pg.live() === RETRY, detail: '狀態列 ' + JSON.stringify(pg.live()) };
  };
}

T['取名:按下去才發現唯讀,打的名字沒有被當成存好,標題還是原來的名字,焦點回到 ×'] = async () => {
  const pg = await renameThen({ ok: false, reason: 'readOnly', readOnly: true }, 'v2', true);
  const a = pg.doc.activeElement, h2 = pg.sheet.querySelector('h2').textContent;
  return { ok: h2 === '小黃' && !pg.sheet.querySelector('.pet-pen') && !pg.sheet.querySelector('form') && a === pg.sheet.querySelector('.modal-close'),
    detail: JSON.stringify({ h2, pen: !!pg.sheet.querySelector('.pet-pen'), form: !!pg.sheet.querySelector('form'), focus: a && a.className }) };
};
T['取名:存好了,焦點回到取名的筆,狀態列空白'] = async () => {
  const pg = await renameThen({ ok: true }, 'v1', true);
  const a = pg.doc.activeElement;
  return { ok: pg.live() === '' && !!a && a.classList.contains('pet-pen') && a.isConnected, detail: JSON.stringify({ live: pg.live(), focus: a && a.className, on: a && a.isConnected }) };
};
T['取名:按取消,焦點回到取名的筆'] = async () => {
  const pg = loadPage({ view: 'v1', act: () => ({ ok: true }) });
  pg.sheet.querySelector('.pet-pen').fire('click');
  const cancel = pg.sheet.querySelector('form').querySelectorAll('button').find(b => b.getAttribute('type') === 'button');
  cancel.fire('click');
  const a = pg.doc.activeElement;
  return { ok: !!a && a.classList.contains('pet-pen') && a.isConnected, detail: JSON.stringify({ focus: a && a.className }) };
};
T['取名中途變唯讀(另一台寫了 v2)再按取消,焦點留在面板裡'] = async () => {
  const state = { view: 'v1', act: () => ({ ok: true }) };
  const pg = loadPage(state);
  pg.sheet.querySelector('.pet-pen').fire('click');
  state.view = 'v2'; state.emit();
  const cancel = pg.sheet.querySelector('form').querySelectorAll('button').find(b => b.getAttribute('type') === 'button');
  cancel.fire('click');
  const a = pg.doc.activeElement;
  return { ok: !!a && a.isConnected && pg.sheet.contains(a), detail: JSON.stringify({ focus: a && a.tagName, on: a && a.isConnected }) };
};
T['「我的」頁那一區:改目標才發現唯讀,狀態列說目標沒有改,焦點留在卡片裡'] = async () => {
  const state = actor({ ok: false, reason: 'readOnly', readOnly: true }, 'v2', true);
  state.me = true;
  const pg = loadPage(state);
  const b = pg.card.querySelector('[data-focus="goal40"]');
  if (!b) throw new Error('卡片裡找不到 40 題的按鈕');
  b.focus(); b.fire('click'); await flush(); await flush();
  const a = pg.doc.activeElement;
  return { ok: pg.live() === NOT_SAVED['改目標'].readOnly && !!a && a.isConnected && pg.card.contains(a),
    detail: JSON.stringify({ live: pg.live(), focus: a && a.className, on: a && a.isConnected }) };
};
T['v2 唯讀的說明:不說重新整理就好(退回第 1 步那一版時重新整理也一樣),也不用資料讀不到那句'] = async () => {
  const pg = loadPage({ view: 'v2', act: () => ({ ok: false }) });
  const act = pg.act();
  return { ok: act.length > 0 && !/重新整理/.test(act) && act !== OLD_BAD && act !== CLOCK && /新版/.test(act) && /[。]$/.test(act), detail: JSON.stringify(act) };
};
T['不認得的版本與讀不到(newer 沒亮)照舊是「' + OLD_BAD + '」;時鐘不對照舊'] = async () => {
  const a = loadPage({ view: 'bad', act: () => ({ ok: false }) }).act();
  const c = loadPage({ view: 'clock', act: () => ({ ok: false }) }).act();
  return { ok: a === OLD_BAD && c === CLOCK, detail: JSON.stringify([a, c]) };
};

/* 第二階段加的(餵食面板 160 px 小雞省記憶體,規格 A.9):chick() 第四個參數照給;沒給時跟第 1 步一樣,不多帶 variants */
T['PET_UI.chick:沒給 opt 時 animate 參數跟第 1 步一樣;給 { maxDpr, variants } 時照用'] = async () => {
  const pg = loadPage({ view: 'v1', act: () => ({ ok: true }) });
  const got = [];
  pg.ctx.ChickArt.animate = (c, o) => { got.push(Object.assign({}, o, { onTick: typeof o.onTick })); return { pose: o.pose, setPose() {}, stop() {}, setFps() {} }; };
  pg.ctx.PET_UI.chick(pg.doc.createElement('canvas'), 48);
  pg.ctx.PET_UI.chick(pg.doc.createElement('canvas'), 160, null, { maxDpr: 1.5, variants: 1 });
  const a = got[0], b = got[1];
  return { ok: !!a && !!b && JSON.stringify(Object.keys(a)) === JSON.stringify(['size', 'fps', 'maxDpr', 'pose', 'onTick']) && a.maxDpr === 2 &&
    b.maxDpr === 1.5 && b.variants === 1 && b.size === 160, detail: JSON.stringify(got) };
};

/* 電腦版到處走(pet-roam2.js 在 html 加 pet-roam2-wide,css 把卡片裡的小雞藏起來):卡片裡的小雞停住不畫,class 拿掉就照常動(第四輪審查 #4) */
T['首頁卡片、我的:html 有 pet-roam2-wide 時卡片裡的小雞停住(不跑計時器、不畫),拿掉就照常動;面板裡的小雞不受影響'] = async () => {
  const out = [];
  for (const [me, wide0] of [[true, true], [true, false], [false, true]]) {
    const log = { start: 0, stop: 0 }, mos = [];
    const pg = loadPage({ view: 'v1', me, act: () => ({ ok: true }), setup(ctx, doc) {
      doc.documentElement = doc.createElement('html');
      if (wide0) doc.documentElement.classList.add('pet-roam2-wide');
      ctx.MutationObserver = class { constructor(cb) { this.cb = cb; mos.push(this); } observe(t, o) { this.t = t; this.o = o; } };
      ctx.ChickArt.animate = (c, o) => { log.start++; return { pose: o.pose, setPose() { log.start++; }, stop() { log.stop++; }, setFps() { log.start++; } }; };
    } });
    const html = pg.doc.documentElement, fire = () => mos.filter((m) => m.t === html).forEach((m) => m.cb([{ attributeName: 'class' }]));
    const card = me ? pg.card : null;
    const a = Object.assign({}, log);
    html.classList.remove('pet-roam2-wide'); fire();
    const b = Object.assign({}, log);
    html.classList.add('pet-roam2-wide'); fire();
    const c = Object.assign({}, log);
    out.push({ me, wide0, card: !!card, a, b, c, watched: mos.some((m) => m.t === html) });
  }
  const [m1, m2, sh] = out;
  const okMe = m1.watched && m1.a.stop >= 1 && m1.b.start > m1.a.start && m1.c.stop > m1.b.stop;   // 假 DOM 沒有 IntersectionObserver:建好先畫一格就停
  const okMe2 = m2.a.start > 0 && m2.c.stop > m2.b.stop;
  const okSheet = sh.a.start > 0 && sh.c.stop === sh.b.stop;   // 只有面板(沒有卡片):面板裡的小雞照常動
  return { ok: okMe && okMe2 && okSheet, detail: JSON.stringify(out) };
};

/* 規格 1.11「只有一隻」:列印時卡片的小雞照常印出來(第三輪複查 #2)。css 在列印時把卡片的小雞放回來、拿掉空的窩;
   js 在 beforeprint 讓停住的小雞畫一格(不然印出來是舊的那格或空白),afterprint 再停住 */
T['列印:電腦版到處走時卡片的小雞照常印出來(css 列印時放回小雞、拿掉窩;beforeprint 畫一格,afterprint 再停住)'] = async () => {
  const css = read('css/style.css').replace(/\r\n/g, '\n'), pm = css.match(/@media print\s*\{[\s\S]*?\n\}/g) || [];
  const pr = pm.join('\n');
  const cssOk = /html\.pet-roam2\.pet-roam2-wide \.pet-card \.pet-cv\s*\{[^}]*visibility:\s*visible/.test(pr) && /html\.pet-roam2\.pet-roam2-wide \.pet-card \.pet-pic\s*\{[^}]*background-image:\s*none/.test(pr);
  const log = { start: 0, stop: 0 }, win = {};
  const pg = loadPage({ view: 'v1', me: true, act: () => ({ ok: true }), setup(ctx, doc) {
    doc.documentElement = doc.createElement('html');
    doc.documentElement.classList.add('pet-roam2-wide');
    const add0 = ctx.addEventListener;
    ctx.addEventListener = (t, f) => { (win[t] = win[t] || []).push(f); add0(t, f); };
    ctx.MutationObserver = class { constructor(cb) { this.cb = cb; } observe() {} };
    ctx.ChickArt.animate = (c, o) => { log.start++; return { pose: o.pose, setPose() { log.start++; }, stop() { log.stop++; }, setFps() { log.start++; } }; };
  } });
  const fire = (t) => (win[t] || []).forEach((f) => f({ type: t }));
  const a = Object.assign({}, log);
  fire('beforeprint');
  const b = Object.assign({}, log);
  fire('afterprint');
  const c = Object.assign({}, log);
  const jsOk = !!pg.card && b.start > a.start && c.stop > b.stop;
  return { ok: cssOk && jsOk, detail: JSON.stringify({ cssOk, a, b, c, printBlocks: pm.length }) };
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let r;
    try { r = await T[name](); } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + (r.ok ? '' : '\n     ' + r.detail));
  }
  console.log('\n' + pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
