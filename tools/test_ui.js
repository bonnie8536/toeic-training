/* 共用元件(js/ui.js)的測試:結算卡的姿勢分級與分數、沒載到圖時不丟錯、destroy 停計時器、專心模式進出、
   離開前確認、確認與輸入視窗(確定、取消、Esc、點遮罩、焦點)、空狀態、點心列、不讀寫儲存。
   主角鵜鶘:有 PelicanArt 時結算卡與空狀態用牠、沒有或載入失敗退回 ChickArt、兩個都沒有不畫、canvas[data-mascot] 掛載、尺寸照 metrics 的比例。
   第二版:點心事件的認法(特別點心的 id、兩張卡不互搶)、只有點心列、內嵌小卡、屬性(attrs)、通知視窗、輸入框提示、空狀態的連結與 extra、
   作答列的 slot 與回饋小字、鍵盤彈出、面板、UI.mount;樣式檢查只看共用元件那一段。
   用法:node tools/test_ui.js
   js/ui.js 在 vm 裡跑,配一個很小的假 DOM(只做 ui.js 用到的);計時器、圖的程式、IntersectionObserver 都是假的,由測試手動推進。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'js', 'ui.js'), 'utf8');

/* ---------- 假 DOM ---------- */
function makeDom() {
  const doc = { visibilityState: 'visible', readyState: 'complete', activeElement: null, listeners: {}, currentScript: null };
  class Node {
    constructor(tag) {
      this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.kids = []; this.parentNode = null;
      this.attrs = {}; this.className = ''; this.on = {}; this.dataset = {}; this.value = ''; this.disabled = false;
      const st = {};
      st.setProperty = (k, v) => { st[k] = v; };
      st.removeProperty = (k) => { delete st[k]; };
      this.style = st;
      const self = this;
      const list = () => self.className.split(/\s+/).filter(Boolean);
      this.classList = {
        add: (...cs) => { const s = list(); cs.forEach((c) => { if (!s.includes(c)) s.push(c); }); self.className = s.join(' '); },
        remove: (...cs) => { self.className = list().filter((x) => !cs.includes(x)).join(' '); },
        contains: (c) => list().includes(c),
        toggle: (c, force) => { const on = force === undefined ? !list().includes(c) : !!force; if (on) self.classList.add(c); else self.classList.remove(c); return on; },
      };
    }
    get firstChild() { return this.kids[0] || null; }
    get children() { return this.kids.filter((k) => k.nodeType === 1); }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.documentElement; }
    get offsetHeight() { return 80; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    set textContent(t) { this.replaceChildren(); if (t !== '' && t !== null && t !== undefined) this.append(doc.createTextNode(t)); }
    set innerHTML(v) { throw new Error('ui.js 不該用 innerHTML'); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    adopt(n) { if (n.parentNode) n.remove(); n.parentNode = this; return n; }
    append(...ns) { ns.forEach((n) => { n = n.nodeType ? n : doc.createTextNode(n); this.kids.push(this.adopt(n)); if (n.tagName === 'SCRIPT') doc.onScript(n); }); }
    prepend(...ns) { ns.reverse().forEach((n) => { n = n.nodeType ? n : doc.createTextNode(n); this.kids.unshift(this.adopt(n)); }); }
    after(n) { const p = this.parentNode; p.adopt(n); p.kids.splice(p.kids.indexOf(this) + 1, 0, n); }
    remove() { const p = this.parentNode; if (!p) return; p.kids.splice(p.kids.indexOf(this), 1); this.parentNode = null; }
    replaceChildren(...ns) { this.kids.slice().forEach((k) => { k.parentNode = null; }); this.kids = []; this.append(...ns); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }
    removeEventListener(t, f) { this.on[t] = (this.on[t] || []).filter((x) => x !== f); }
    focus() { doc.activeElement = this; doc.fire('focusin', { target: this }); }
    select() {}
    matches(sel) { return sel.split(',').some((s) => simple(this, s.trim())); }
    all() { const out = []; this.kids.forEach((k) => { if (k.nodeType === 1) { out.push(k); out.push(...k.all()); } }); return out; }
    querySelectorAll(sel) { return this.all().filter((n) => n.matches(sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getElementsByTagName(t) { return this.all().filter((n) => n.tagName === t.toUpperCase()); }
  }
  /* 支援 tag、.class、[attr]、[attr="v"] 的組合;用空白分開的是子孫選擇器 */
  function simple(n, s) {
    const parts = s.split(/\s+/);
    if (!one(n, parts[parts.length - 1])) return false;
    let p = n.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) { while (p && !(p.nodeType === 1 && one(p, parts[i]))) p = p.parentNode; if (!p) return false; p = p.parentNode; }
    return true;
  }
  function one(n, s) {
    const m = s.match(/^([a-z0-9]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i);
    if (!m) return false;
    if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && !m[2].split('.').filter(Boolean).every((c) => n.classList.contains(c))) return false;
    for (const a of (m[3].match(/\[[^\]]+\]/g) || [])) {
      const [, k, v] = a.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/) || [];
      if (!k || !(k in n.attrs) || (v !== undefined && n.attrs[k] !== v)) return false;
    }
    return true;
  }
  doc.Node = Node;
  doc.createElement = (tag) => new Node(tag);
  doc.createElementNS = (ns, tag) => new Node(tag);
  doc.createTextNode = (t) => ({ nodeType: 3, textContent: String(t), parentNode: null, remove() { const p = this.parentNode; if (p) { p.kids.splice(p.kids.indexOf(this), 1); this.parentNode = null; } } });
  doc.documentElement = new Node('html');
  doc.head = new Node('head');
  doc.body = new Node('body');
  doc.documentElement.append(doc.head, doc.body);
  doc.querySelector = (sel) => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.documentElement.querySelectorAll(sel);
  doc.getElementsByTagName = (t) => doc.documentElement.getElementsByTagName(t);
  doc.addEventListener = (t, f) => { (doc.listeners[t] = doc.listeners[t] || []).push(f); };
  doc.removeEventListener = (t, f) => { doc.listeners[t] = (doc.listeners[t] || []).filter((x) => x !== f); };
  doc.fire = (t, extra) => { const ev = Object.assign({ type: t, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } }, extra); (doc.listeners[t] || []).slice().forEach((f) => f(ev)); return ev; };
  doc.onScript = () => {};
  return doc;
}
/* 點一下:事件從目標往上冒泡 */
function click(n) {
  const ev = { type: 'click', target: n, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  for (let p = n; p; p = p.parentNode) { ev.currentTarget = p; (p.on && p.on.click || []).slice().forEach((f) => f(ev)); }
  return ev;
}
/* 按下(pointerdown、mousedown)只送到目標本身 */
function press(n) { ['pointerdown', 'mousedown'].forEach((t) => (n.on[t] || []).slice().forEach((f) => f({ type: t, target: n }))); }
function pressOn(target, host) { ['pointerdown', 'mousedown'].forEach((t) => (host.on[t] || []).slice().forEach((f) => f({ type: t, target }))); }
function submit(form) { const ev = { type: 'submit', target: form, preventDefault() { this.prevented = true; } }; (form.on.submit || []).forEach((f) => f(ev)); return ev; }
function key(doc, k, shift) { return doc.fire('keydown', { key: k, shiftKey: !!shift }); }
const tick = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 8; i++) await tick(); }

/* ---------- 一頁:ui.js 載入一次。opt.pelican、opt.chick、opt.food:要不要有假的 PelicanArt、ChickArt、FoodArt ---------- */
function fakeChick(poses) { return fakeArt(poses || ['idle', 'happy', 'eat', 'hungry', 'sleep', 'walk', 'run'], { width: 240, height: 280 }); }
function fakePelican(poses) { return fakeArt(poses || ['idle', 'happy', 'oops', 'read', 'sleep'], { width: 300, height: 280 }); }
function fakeArt(poses, metrics) {
  const made = [];
  return {
    made,
    lib: {
      poses,
      calm: { idle: 1, happy: 0, sleep: 0 },
      holds: () => [1, 1, 1, 1],
      fps: { idle: 8, happy: 8 },
      metrics,
      animate(canvas, o) {
        const a = { canvas, opt: o, pose: o.pose, stops: 0, timer: true, poses: [o.pose], shown: null,
          setPose(p) { this.pose = p; this.poses.push(p); this.timer = true; },
          setFps() { this.timer = true; },
          show(k, v, p) { if (p) this.pose = p; this.shown = [k, v, p]; this.timer = false; },
          stop() { this.stops++; this.timer = false; } };
        made.push(a);
        return a;
      },
    },
  };
}
function fakeFood() {
  const mounted = [];
  return { mounted, lib: { ids: ['corn', 'tomato', 'melon'], mount(cv, id, o) { const m = { cv, id, o, stopped: 0, stop() { this.stopped++; } }; mounted.push(m); return m; } } };
}
function loadPage(opt) {
  const o = opt || {};
  const doc = makeDom();
  const timers = new Map();
  let tid = 0;
  const storage = { touched: [] };
  const winListeners = {};
  const ctx = {
    document: doc, console, Promise, Math, Number, String, Array, Object, Date, JSON,
    setTimeout: (fn, ms) => { tid++; timers.set(tid, { fn, ms }); return tid; },
    clearTimeout: (id) => { timers.delete(id); },
    matchMedia: (q) => ({ matches: !!(o.media && o.media[q]) }),
    addEventListener: (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); },
    removeEventListener: (t, f) => { winListeners[t] = (winListeners[t] || []).filter((x) => x !== f); },
    history: { length: 1, back() { ctx.wentBack = true; } },
    location: { href: '' },
  };
  ['localStorage', 'sessionStorage', 'indexedDB'].forEach((k) => {
    Object.defineProperty(ctx, k, { get() { storage.touched.push(k); throw new Error('不該讀寫 ' + k); }, configurable: true });
  });
  if (o.pelican) ctx.PelicanArt = o.pelican.lib;
  if (o.chick) ctx.ChickArt = o.chick.lib;
  if (o.food) ctx.FoodArt = o.food.lib;
  if (o.io) {
    ctx.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; this.off = false; o.io.push(this); }
      observe(n) { this.n = n; }
      disconnect() { this.off = true; }
      fire(on) { this.cb([{ isIntersecting: on, target: this.n }]); }
    };
  }
  /* 頁面加的 <script>:loads 裡有的就「載到」(設全域、送 load),其他送 error */
  const loads = o.loads || {};
  const scripts = [];
  doc.onScript = (s) => {
    scripts.push(s.src || s.getAttribute('src'));
    setImmediate(() => {
      const name = Object.keys(loads).find((k) => String(s.src).endsWith(loads[k].file));
      if (name) { ctx[name] = loads[name].lib; (s.on.load || []).forEach((f) => f({})); }
      else (s.on.error || []).forEach((f) => f({}));
    });
  };
  if (o.markup) o.markup(doc);
  if (o.extra) Object.assign(ctx, o.extra);   // 其他全域(visualViewport、innerHeight 等)
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'js/ui.js' });
  return {
    doc, ctx, UI: ctx.UI, timers, storage, scripts,
    emit(t, detail) { (winListeners[t] || []).slice().forEach((f) => f({ type: t, detail })); },
    listeners: (t) => (winListeners[t] || []).length,
    runTimers() { const list = Array.from(timers.entries()); timers.clear(); list.forEach(([, t]) => t.fn()); },
  };
}

/* ---------- 測項 ---------- */
const T = {};

T['結算卡:姿勢照分數分級(80% 以上 happy、50% 到 79% idle、50% 以下 oops),沒有 oops 時退回 idle'] = async () => {
  const ch = fakePelican(['idle', 'happy', 'sleep']);
  const p = loadPage({ pelican: ch });
  const cases = [[8, 10, 'happy'], [10, 10, 'happy'], [5, 10, 'idle'], [79, 100, 'idle'], [4, 10, 'oops'], [0, 10, 'oops']];
  for (const [s, t, want] of cases) {
    const c = p.UI.result({ score: s, total: t, primary: { label: '再做一次' } });
    p.doc.body.append(c.el);
    assert.strictEqual(c.pose, want, s + ' / ' + t + ' 應該是 ' + want);
    const a = ch.made[ch.made.length - 1];
    assert.strictEqual(a.opt.pose, want === 'oops' ? 'idle' : want, '沒有 oops 姿勢時畫 idle');
    c.destroy();
  }
  /* 有 oops 姿勢時照用;給 pose 時照給的 */
  const ch2 = fakePelican(['idle', 'happy', 'oops', 'read']);
  const p2 = loadPage({ pelican: ch2 });
  p2.UI.result({ score: 2, total: 10 });
  assert.strictEqual(ch2.made[0].opt.pose, 'oops');
  const c2 = p2.UI.result({ score: 2, total: 10, pose: 'happy' });
  assert.strictEqual(c2.pose, 'happy');
};

T['結算卡:大分數「8 / 10」、「165 分」、標記、stats 最多 3 格、note、主按鈕與文字連結'] = async () => {
  const p = loadPage({ pelican: fakePelican() });
  let again = 0;
  const c = p.UI.result({ score: 8, total: 10, kicker: '題庫刷題', flag: '新紀錄', primary: { label: '再做一次', onClick: () => again++ },
    links: [{ label: '看錯題本', href: 'review.html' }, { label: '回題庫', onClick() {} }] });
  const el = c.el;
  assert.strictEqual(el.querySelector('.result-score b').textContent, '8');
  assert.strictEqual(el.querySelector('.result-of').textContent, '/ 10');
  assert.strictEqual(el.querySelector('.result-score').textContent, '8 / 10 新紀錄');
  assert.strictEqual(el.querySelector('.result-kicker').textContent, '題庫刷題');
  assert.strictEqual(el.querySelectorAll('.btn.primary').length, 1, '只有一顆實色主按鈕');
  click(el.querySelector('.result-go'));
  assert.strictEqual(again, 1);
  const links = el.querySelectorAll('.result-link');
  assert.deepStrictEqual(links.map((n) => n.tagName + ':' + n.textContent), ['A:看錯題本', 'BUTTON:回題庫']);
  assert.strictEqual(links[0].getAttribute('href'), 'review.html');
  assert.strictEqual(el.querySelector('.result-stats'), null, '沒給 stats 就不出現');
  assert.strictEqual(el.querySelector('.result-note'), null, '沒給 note 就不出現');
  assert.strictEqual(el.getAttribute('aria-labelledby'), el.querySelector('.result-score').getAttribute('id'));

  const m = p.UI.result({ big: '165', unit: '分', stats: [['聽力', '110'], ['閱讀', '55'], ['a', '1'], ['b', '2']], note: '參考換算，非正式成績',
    primary: { label: '再做一次' }, links: [{ label: '看錯題本', href: 'javascript:alert(1)' }] });
  assert.strictEqual(m.el.querySelector('.result-score').textContent, '165 分');
  assert.strictEqual(m.pose, 'idle', '沒有分數比例時用 idle');
  const cells = m.el.querySelectorAll('.result-stat');
  assert.strictEqual(cells.length, 3, 'stats 最多 3 格');
  assert.deepStrictEqual([cells[0].querySelector('dt').textContent, cells[0].querySelector('dd').textContent], ['聽力', '110']);
  assert.strictEqual(m.el.querySelector('.result-note').textContent, '參考換算，非正式成績');
  assert.strictEqual(m.el.querySelector('.result-link').tagName, 'BUTTON', 'javascript: 網址不放進 href');
  /* 連結只收相對路徑與 http(s);含 tab、換行、前置空白的 javascript: 也擋 */
  const hrefOf = (h) => { const r = p.UI.result({ score: 1, total: 2, links: [{ label: 'x', href: h }] }); const n = r.el.querySelector('.result-link'); return n.tagName === 'A' ? n.getAttribute('href') : null; };
  assert.strictEqual(hrefOf('java\tscript:alert(1)'), null);
  assert.strictEqual(hrefOf(' \njavascript:alert(1)'), null);
  assert.strictEqual(hrefOf('JaVaScRiPt:alert(1)'), null);
  assert.strictEqual(hrefOf('data:text/html,x'), null);
  assert.strictEqual(hrefOf('vbscript:x'), null);
  assert.strictEqual(hrefOf('review.html?x=1'), 'review.html?x=1');
  assert.strictEqual(hrefOf('https://example.test/a'), 'https://example.test/a');
  /* 外部字串一律是文字,不會變成標籤 */
  const x = p.UI.result({ score: 1, total: 2, kicker: '<img src=x onerror=1>' });
  assert.strictEqual(x.el.querySelector('.result-kicker').textContent, '<img src=x onerror=1>');
  assert.strictEqual(x.el.querySelector('img'), null);
  /* 緊湊版:鵜鶘 120 */
  const ch = fakePelican();
  const p2 = loadPage({ pelican: ch, media: { '(min-width: 900px)': true } });
  p2.UI.result({ score: 1, total: 2 });
  p2.UI.result({ score: 1, total: 2, compact: true });
  assert.deepStrictEqual(ch.made.map((a) => a.opt.size), [200, 120], '桌機 200、緊湊版 120');
  const p3 = loadPage({ pelican: ch });
  p3.UI.result({ score: 1, total: 2 });
  assert.strictEqual(ch.made[ch.made.length - 1].opt.size, 180, '手機 180');
};

T['沒載到圖(ChickArt、FoodArt、DoodleArt 都沒有、載入失敗):元件照常顯示,不丟錯'] = async () => {
  const p = loadPage({ markup(doc) { const cv = doc.createElement('canvas'); cv.setAttribute('data-doodle', 'home'); cv.setAttribute('data-size', '26'); doc.body.append(cv); } });
  const c = p.UI.result({ score: 9, total: 10, primary: { label: '再做一次' } });
  p.doc.body.append(c.el);
  assert.ok(c.el.querySelector('canvas.result-chick'), '角色的位置還在');
  assert.strictEqual(c.el.querySelector('.result-chick').style.width, '180px', '畫布先佔好大小(照鵜鶘)');
  assert.strictEqual(c.el.querySelector('.result-chick').style.height, '168px', '高度照鵜鶘的比例 280/300');
  const e = p.UI.empty({ text: '沒有錯題', action: { label: '去刷題', href: 'practice.html' } });
  const f = p.UI.focus.enter({ total: 3 });
  f.progress(1);
  f.leave();
  p.emit('pet:earn', { result: 'got', food: 'melon' });
  c.destroy();
  await settle();
  assert.ok(e.querySelector('.ui-empty-text'));
  const r = await p.UI.art.ensure(['ChickArt', 'food', 'DoodleArt', 'NoSuch']);
  assert.deepStrictEqual(Object.assign({}, r), { ChickArt: false, FoodArt: false, DoodleArt: false, NoSuch: false });
  assert.ok(p.scripts.some((s) => s.endsWith('js/doodle-art.js')), '頁面載入時試著載 DoodleArt');
  assert.ok(!p.doc.documentElement.classList.contains('doodle-ready'), '沒畫上就不標 doodle-ready');
  assert.strictEqual(p.timers.size, 0, '載入失敗後沒有留下計時器');
  /* 圖的程式本身丟錯也不丟到外面 */
  const bad = { poses: ['idle'], animate() { throw new Error('壞了'); } };
  const p2 = loadPage({ pelican: { lib: bad } });
  const c2 = p2.UI.result({ score: 1, total: 1 });
  c2.destroy();
  const ok = await p2.UI.art.ensure('PelicanArt');
  assert.strictEqual(ok.PelicanArt, true);
};

T['要用時才載:DoodleArt 載到後畫上 canvas[data-doodle] 並標 doodle-ready;canvas[data-chick] 畫上小雞'] = async () => {
  const drawn = [];
  const D = { mountAll(root) { drawn.push(root); } };
  const ch = fakeChick();
  const p = loadPage({ loads: { DoodleArt: { file: 'js/doodle-art.js', lib: D }, ChickArt: { file: 'js/chick-art.js', lib: ch.lib } },
    markup(doc) {
      const cv = doc.createElement('canvas'); cv.setAttribute('data-doodle', 'learn'); doc.body.append(cv);
      const c2 = doc.createElement('canvas'); c2.setAttribute('data-chick', 'idle'); c2.setAttribute('data-size', '140'); doc.body.append(c2);
    } });
  await settle();
  assert.strictEqual(drawn.length, 1, 'mountAll(document) 呼叫一次');
  assert.strictEqual(drawn[0], p.doc);
  assert.ok(p.doc.documentElement.classList.contains('doodle-ready'));
  assert.strictEqual(ch.made.length, 1);
  assert.deepStrictEqual([ch.made[0].opt.size, ch.made[0].opt.pose], [140, 'idle']);
  /* 第二次要同一個不再加 <script> */
  const before = p.scripts.length;
  await p.UI.art.ensure(['DoodleArt', 'ChickArt']);
  assert.strictEqual(p.scripts.length, before);
  /* 沒有 mountAll 時逐一 mount,帶 size、tone、ink */
  const calls = [];
  const p2 = loadPage({ loads: { DoodleArt: { file: 'js/doodle-art.js', lib: { mount: (cv, id, o) => calls.push([id, o.size, o.tone, o.ink]) } } },
    markup(doc) { const cv = doc.createElement('canvas'); cv.setAttribute('data-doodle', 'home'); cv.setAttribute('data-size', '26'); cv.setAttribute('data-tone', 'fill'); cv.setAttribute('data-ink', '#151515'); doc.body.append(cv); } });
  await settle();
  assert.deepStrictEqual(calls, [['home', 26, 'fill', '#151515']]);
  assert.ok(p2.doc.documentElement.classList.contains('doodle-ready'));
};

T['destroy 與離開畫面:停掉小雞的計時器、拿掉監聽;減少動態時只畫靜止格'] = async () => {
  const ch = fakePelican();
  const ios = [];
  const p = loadPage({ pelican: ch, io: ios });
  const c = p.UI.result({ score: 6, total: 10 });
  p.doc.body.append(c.el);
  assert.strictEqual(ch.made.length, 0, '還沒看到之前不開動畫');
  ios[0].fire(true);
  const a = ch.made[0];
  assert.ok(a.timer, '看得到才動');
  ios[0].fire(false);
  assert.ok(!a.timer && a.stops === 1, '離開畫面就停');
  ios[0].fire(true);
  assert.ok(a.timer, '回到畫面再動');
  /* 拿到點心時跳一下:畫 happy 的靜止格、整張畫布跳(.is-hop),排了回到原姿勢與拿掉 .is-hop 的計時器;destroy 要一起清掉 */
  const line = p.doc.createElement('p'); line.className = 'pet-earn'; c.reward.append(line);
  p.emit('pet:earn', { result: 'got', food: 'tomato' });
  assert.strictEqual(a.pose, 'happy');
  assert.deepStrictEqual(a.shown, [0, 0, 'happy'], '跳的時候畫 happy 第一格(正常比例),不播壓扁的畫格');
  assert.ok(c.el.querySelector('.result-chick').classList.contains('is-hop'));
  assert.ok(p.timers.size >= 1);
  c.destroy();
  assert.ok(!a.timer, 'destroy 停掉動畫');
  assert.deepStrictEqual(a.shown, [1, 0, 'idle'], 'destroy 後停在靜止格');
  assert.ok(!c.el.querySelector('.result-chick').classList.contains('is-hop'), 'destroy 拿掉跳躍');
  assert.ok(ios[0].off, 'destroy 拿掉 IntersectionObserver');
  assert.strictEqual(p.listeners('pet:earn'), 0, 'destroy 拿掉 pet:earn 監聽');
  assert.strictEqual(p.doc.listeners.visibilitychange.length, 0, 'destroy 拿掉 visibilitychange 監聽');
  await settle();
  assert.strictEqual(p.timers.size, 0, 'destroy 後沒有留下計時器');
  c.destroy();   // 再呼叫一次不出錯
  /* 減少動態:畫靜止格,不跳、不留計時器 */
  const ch3 = fakePelican();
  const p3 = loadPage({ pelican: ch3, media: { '(prefers-reduced-motion: reduce)': true } });
  const c3 = p3.UI.result({ score: 9, total: 10 });
  assert.strictEqual(ch3.made.length, 1);
  assert.deepStrictEqual(ch3.made[0].shown, [0, 0, 'happy'], 'happy 的靜止格');
  assert.ok(!ch3.made[0].timer);
  assert.ok(!c3.el.querySelector('.result-chick').classList.contains('is-hop'), '減少動態不跳');
  assert.strictEqual(p3.timers.size, 0);
};

T['happy 不播畫格(裡面有壓得很扁的格):只畫第一格,進場整張跳一次,跳完拿掉 .is-hop'] = async () => {
  const ch = fakePelican();
  const p = loadPage({ pelican: ch });
  const c = p.UI.result({ score: 8, total: 10 });
  p.doc.body.append(c.el);
  const a = ch.made[0];
  assert.deepStrictEqual(a.shown, [0, 0, 'happy'], '靜止格是第 0 格');
  assert.ok(!a.timer, '不開畫格的計時器');
  assert.deepStrictEqual(a.poses, ['happy'], '沒有 setPose 去播 happy 的畫格');
  const cv = c.el.querySelector('.result-chick');
  assert.ok(cv.classList.contains('is-hop'), '進場跳一次');
  p.runTimers();
  assert.ok(!cv.classList.contains('is-hop'), '跳完拿掉');
  assert.ok(!a.timer, '跳完還是不開計時器');
  /* 首頁「今日練習已完成」的 canvas[data-chick="happy"] 也一樣只畫第一格(不跳) */
  const ch2 = fakeChick();
  const p2 = loadPage({ chick: ch2, markup(doc) { const cv2 = doc.createElement('canvas'); cv2.setAttribute('data-chick', 'happy'); cv2.setAttribute('data-size', '72'); doc.body.append(cv2); } });
  assert.deepStrictEqual(ch2.made[0].shown, [0, 0, 'happy']);
  assert.ok(!ch2.made[0].timer);
  assert.ok(!p2.doc.querySelector('canvas').classList.contains('is-hop'));
};

T['卡片被拿出頁面卻沒呼叫 destroy:小雞自己停掉計時器、拿掉監聽(有 IntersectionObserver 與沒有的瀏覽器)'] = async () => {
  /* 有 IntersectionObserver:拿掉時會收到「看不到」,那時發現畫布不在頁面上就自己收掉 */
  const ch = fakePelican();
  const ios = [];
  const p = loadPage({ pelican: ch, io: ios });
  const c = p.UI.result({ score: 6, total: 10 });
  p.doc.body.append(c.el);
  ios[0].fire(true);
  assert.ok(ch.made[0].timer);
  c.el.remove();
  ios[0].fire(false);
  assert.ok(!ch.made[0].timer, '停掉動畫');
  assert.ok(ios[0].off, '拿掉 IntersectionObserver');
  assert.strictEqual(p.doc.listeners.visibilitychange.length, 0, '拿掉 visibilitychange 監聽');
  assert.strictEqual(c.chick.alive, false);
  p.emit('pet:earn', { result: 'got', food: 'corn', id: 'x' });
  assert.strictEqual(p.listeners('pet:earn'), 0, '下一個點心事件來時連 pet:earn 監聽一起拿掉');
  /* 還沒放進頁面的卡(剛建好)不會被當成拿掉 */
  const c2 = p.UI.result({ score: 6, total: 10 });
  p.doc.visibilityState = 'hidden'; p.doc.fire('visibilitychange');
  p.doc.visibilityState = 'visible'; p.doc.fire('visibilitychange');
  assert.strictEqual(c2.chick.alive, true, '沒放進頁面過的不收');
  c2.destroy();
  /* 沒有 IntersectionObserver:每 5 秒看一次還在不在頁面上 */
  const chB = fakePelican();
  const pB = loadPage({ pelican: chB });
  const cB = pB.UI.result({ score: 6, total: 10 });
  pB.doc.body.append(cB.el);
  assert.ok(chB.made[0].timer);
  pB.runTimers();
  assert.strictEqual(cB.chick.alive, true, '還在頁面上:繼續動、繼續看');
  assert.ok(chB.made[0].timer);
  assert.strictEqual(pB.timers.size, 1);
  assert.strictEqual(Array.from(pB.timers.values())[0].ms, 5000);
  cB.el.remove();
  pB.runTimers();
  assert.strictEqual(cB.chick.alive, false, '拿掉了就自己收掉');
  assert.ok(!chB.made[0].timer);
  assert.strictEqual(pB.timers.size, 0, '不再排下一次檢查');
  assert.strictEqual(pB.doc.listeners.visibilitychange.length, 0);
  /* destroy 也清掉這個檢查 */
  const cC = pB.UI.result({ score: 6, total: 10 });
  pB.doc.body.append(cC.el);
  assert.strictEqual(pB.timers.size, 1);
  cC.destroy();
  assert.strictEqual(pB.timers.size, 0);
};

T['分頁到背景時停,回來再動'] = async () => {
  const ch = fakePelican();
  const p = loadPage({ pelican: ch });
  p.UI.result({ score: 6, total: 10 });
  const a = ch.made[0];
  assert.ok(a.timer);
  p.doc.visibilityState = 'hidden'; p.doc.fire('visibilitychange');
  assert.ok(!a.timer);
  p.doc.visibilityState = 'visible'; p.doc.fire('visibilitychange');
  assert.ok(a.timer);
};

T['點心列:收到 pet:earn(got)時畫出那個食物、小雞跳一次;其他結果、別張卡的點心不畫;掛勾那行字不動'] = async () => {
  const ch = fakePelican(), fd = fakeFood();
  const p = loadPage({ pelican: ch, food: fd });
  const c = p.UI.result({ score: 6, total: 10 });
  p.doc.body.append(c.el);
  /* 掛勾還沒把那一行放進來:不是給這張卡的,不畫 */
  p.emit('pet:earn', { result: 'got', food: 'tomato', id: 'p5' });
  await settle();
  assert.strictEqual(fd.mounted.length, 0, '點心列裡沒有掛勾的那一行時不畫');
  const line = p.doc.createElement('p'); line.className = 'pet-earn'; line.setAttribute('role', 'status');
  c.reward.append(line);
  assert.strictEqual(c.reward.querySelector('canvas'), null);
  p.emit('pet:earn', { result: 'full', food: 'tomato' });
  p.emit('pet:earn', { result: 'got' });
  await settle();
  assert.strictEqual(fd.mounted.length, 0, '沒拿到不畫');
  assert.ok(!c.reward.classList.contains('has-food'));
  line.textContent = '+1 小番茄';
  p.emit('pet:earn', { result: 'got', food: 'tomato', id: 'p5' });
  assert.ok(!c.reward.classList.contains('has-food'), '食物圖畫上之前不加 has-food');
  await settle();
  assert.strictEqual(fd.mounted.length, 1);
  assert.strictEqual(fd.mounted[0].id, 'tomato');
  assert.strictEqual(fd.mounted[0].o.size, 56);
  assert.strictEqual(fd.mounted[0].o.animate, false);
  assert.ok(c.reward.classList.contains('has-food'));
  assert.strictEqual(c.reward.children[0].tagName, 'CANVAS', '食物在左邊');
  assert.strictEqual(line.textContent, '+1 小番茄', '掛勾寫的字不改');
  assert.strictEqual(ch.made[0].pose, 'happy', '小雞跳一次 happy');
  assert.ok(c.el.querySelector('.result-chick').classList.contains('is-hop'));
  p.runTimers();
  assert.strictEqual(ch.made[0].pose, 'idle', '跳完回到原本的姿勢');
  assert.ok(ch.made[0].timer, '跳完繼續原本的動畫');
  /* 一張卡只認第一個:之後再來的(例如同一批補寫送出的)不換掉已經畫上的食物 */
  p.emit('pet:earn', { result: 'got', food: 'corn', id: 'p6' });
  await settle();
  assert.strictEqual(fd.mounted.length, 1, '第二個事件不畫');
  assert.strictEqual(c.reward.querySelectorAll('canvas').length, 1);
  /* 沒有的食物 id:不畫、不留空框、不丟錯 */
  const cn = p.UI.result({ score: 6, total: 10 });
  p.doc.body.append(cn.el);
  const ln = p.doc.createElement('p'); ln.className = 'pet-earn'; cn.reward.append(ln);
  c.destroy();
  p.emit('pet:earn', { result: 'got', food: 'nope' });
  await settle();
  assert.strictEqual(fd.mounted.length, 1);
  assert.ok(!cn.reward.classList.contains('has-food'), '沒畫上就不加 has-food');
  assert.strictEqual(cn.reward.querySelector('canvas'), null, '沒畫上就拿掉畫布');
  cn.destroy();
  /* 補寫舊紀錄(later)、從既有紀錄補的(backfill)不是這張卡的;掛勾這一次的(hook)才畫 */
  const cs = p.UI.result({ score: 6, total: 10 });
  p.doc.body.append(cs.el);
  const ls = p.doc.createElement('p'); ls.className = 'pet-earn'; cs.reward.append(ls);
  p.emit('pet:earn', { result: 'got', food: 'corn', id: 'old', source: 'later' });
  p.emit('pet:earn', { result: 'got', food: 'corn', id: 'old2', source: 'backfill' });
  await settle();
  assert.ok(!cs.reward.classList.contains('has-food'), 'later、backfill 不畫');
  p.emit('pet:earn', { result: 'got', food: 'melon', id: 'p5', source: 'hook' });
  await settle();
  assert.ok(cs.reward.classList.contains('has-food'), 'hook 才畫');
  assert.strictEqual(fd.mounted[fd.mounted.length - 1].id, 'melon');
  cs.destroy();
  /* 兩張卡同時在:只畫在掛勾放了那一行的那張 */
  const a1 = p.UI.result({ score: 6, total: 10 }), a2 = p.UI.result({ score: 6, total: 10 });
  p.doc.body.append(a1.el, a2.el);
  const l2 = p.doc.createElement('p'); l2.className = 'pet-earn'; a2.reward.append(l2);
  p.emit('pet:earn', { result: 'got', food: 'corn', id: 'x' });
  await settle();
  assert.ok(!a1.reward.classList.contains('has-food'), '沒有那一行的卡不畫');
  assert.ok(a2.reward.classList.contains('has-food'));
  a1.destroy(); a2.destroy();
  /* 指定 earnId 時只認那一個(不用等那一行) */
  const c2 = p.UI.result({ score: 6, total: 10, earnId: 'mock' });
  p.doc.body.append(c2.el);
  p.emit('pet:earn', { result: 'got', food: 'melon', id: 'p5' });
  await settle();
  assert.ok(!c2.reward.classList.contains('has-food'));
  p.emit('pet:earn', { result: 'got', food: 'melon', id: 'mock' });
  await settle();
  assert.ok(c2.reward.classList.contains('has-food'));
  /* destroy 收掉食物 */
  c2.destroy();
  assert.strictEqual(fd.mounted[fd.mounted.length - 1].stopped, 1);
  /* 卡片已經不在頁面上時不畫 */
  const c3 = p.UI.result({ score: 6, total: 10, earnId: 'q' });
  const n = fd.mounted.length;
  p.emit('pet:earn', { result: 'got', food: 'corn', id: 'q' });
  await settle();
  assert.ok(!c3.reward.classList.contains('has-food'));
  assert.strictEqual(fd.mounted.length, n);
};

T['專心模式:進出時 <html> 類別、作答列、底部列與 body.dataset.leaveConfirm 的設定與清除'] = async () => {
  const p = loadPage({ markup(doc) {
    const top = doc.createElement('header'); top.className = 'topbar';
    const inner = doc.createElement('div'); inner.className = 'topbar-inner'; top.append(inner);
    const main = doc.createElement('main'); const foot = doc.createElement('footer');
    doc.body.append(top, main, foot);
  } });
  const html = p.doc.documentElement;
  const f = p.UI.focus.enter({ total: 10, body: '模擬考還沒交卷，離開後這次作答不會計分。確定離開？' });
  assert.ok(html.classList.contains('is-quiz'));
  const bar = p.doc.querySelector('.quiz-bar');
  assert.strictEqual(bar.parentNode.className, 'topbar', '作答列放在原本的頂欄裡');
  f.progress(3);
  assert.strictEqual(bar.querySelector('.quiz-count').textContent, '3 / 10');
  assert.strictEqual(bar.querySelector('.quiz-fill').style.transform, 'scaleX(0.3)');
  assert.strictEqual(bar.querySelector('.quiz-track').getAttribute('aria-valuenow'), '3');
  f.setTotal(12);
  assert.strictEqual(bar.querySelector('.quiz-count').textContent, '3 / 12');
  assert.strictEqual(p.doc.body.dataset.leaveConfirm, undefined, '還沒作答不用確認');
  f.dirty(true);
  assert.strictEqual(p.doc.body.dataset.leaveConfirm, '模擬考還沒交卷，離開後這次作答不會計分。確定離開？');
  /* 底部固定列:放在 main 後面,沒有按鈕時收起來 */
  const foot = p.doc.querySelector('.quiz-foot');
  const main = p.doc.querySelector('main');
  assert.strictEqual(main.parentNode.kids[main.parentNode.kids.indexOf(main) + 1], foot);
  assert.ok(foot.classList.contains('is-empty'));
  assert.ok(!html.classList.contains('has-quiz-foot'));
  const hand = p.doc.createElement('button'); hand.className = 'btn-text'; hand.textContent = '交卷';
  const next = p.doc.createElement('button'); next.className = 'btn primary'; next.textContent = '下一題';
  f.foot([hand, next]);
  assert.ok(!foot.classList.contains('is-empty'));
  assert.ok(html.classList.contains('has-quiz-foot'));
  /* Tab 順序:作答列的關閉鈕在頂欄(最前面),底部列在 main 後面;底部先文字按鈕再主按鈕 */
  const order = p.doc.documentElement.all();
  assert.ok(order.indexOf(bar.querySelector('.quiz-close')) < order.indexOf(main) && order.indexOf(main) < order.indexOf(hand) && order.indexOf(hand) < order.indexOf(next));
  f.foot(null);
  assert.ok(foot.classList.contains('is-empty'));
  f.dirty(false);
  assert.strictEqual(p.doc.body.dataset.leaveConfirm, undefined);
  f.dirty(true);
  f.leave();
  assert.ok(!html.classList.contains('is-quiz'));
  assert.ok(!html.classList.contains('has-quiz-foot'));
  assert.strictEqual(p.doc.querySelector('.quiz-bar'), null);
  assert.strictEqual(p.doc.querySelector('.quiz-foot'), null);
  assert.strictEqual(p.doc.body.dataset.leaveConfirm, undefined, '離開時清掉');
  f.leave();   // 再呼叫一次不出錯
  /* 頁面原本自己設的值(不是這裡設的)不清 */
  p.doc.body.dataset.leaveConfirm = '別的';
  const g = p.UI.focus.enter({ total: 2, confirmExit: false });
  g.dirty(true);
  g.leave();
  assert.strictEqual(p.doc.body.dataset.leaveConfirm, '別的');
  delete p.doc.body.dataset.leaveConfirm;
  /* 沒有頂欄的頁面自己加一條;再進一次會先收掉前一次 */
  const p2 = loadPage();
  const a = p2.UI.focus.enter({ total: 2 });
  assert.ok(p2.doc.querySelector('.quiz-host .quiz-bar'));
  const b = p2.UI.focus.enter({ total: 3 });
  assert.ok(!a.active && b.active);
  assert.strictEqual(p2.doc.querySelectorAll('.quiz-bar').length, 1);
  b.leave();
  assert.strictEqual(p2.doc.querySelector('.quiz-host'), null);
};

T['專心模式:dirty 時關閉會先確認,取消就留著,確定才呼叫 onExit;沒作答直接離開'] = async () => {
  const p = loadPage();
  let exits = 0;
  const f = p.UI.focus.enter({ total: 5, onExit: () => exits++ });
  f.dirty(true);
  const close = p.doc.querySelector('.quiz-close');
  click(close);
  click(close);
  assert.strictEqual(p.doc.querySelectorAll('.ui-dialog').length, 1, '連按兩下只開一個確認');
  let dlg = p.doc.querySelector('.ui-dialog');
  assert.ok(dlg, '跳出確認');
  assert.strictEqual(dlg.querySelector('.ui-dialog-h').textContent, '離開這次練習？');
  assert.strictEqual(dlg.querySelector('.ui-dialog-ok').textContent, '離開');
  assert.ok(dlg.querySelector('.ui-dialog-ok').classList.contains('is-danger'));
  assert.strictEqual(dlg.querySelector('.ui-dialog-cancel').textContent, '繼續作答');
  click(dlg.querySelector('.ui-dialog-cancel'));
  await settle();
  assert.strictEqual(exits, 0);
  assert.ok(p.doc.documentElement.classList.contains('is-quiz'));
  click(close);
  dlg = p.doc.querySelector('.ui-dialog');
  submit(dlg);
  await settle();
  assert.strictEqual(exits, 1);
  assert.ok(!p.doc.documentElement.classList.contains('is-quiz'));
  assert.strictEqual(p.doc.body.dataset.leaveConfirm, undefined);
  /* 沒作答:直接離開 */
  const g = p.UI.focus.enter({ total: 5, onExit: () => exits++ });
  click(p.doc.querySelector('.quiz-close'));
  await settle();
  assert.strictEqual(exits, 2);
  assert.strictEqual(p.doc.querySelector('.ui-dialog'), null);
  void g;
  /* 沒給 onExit:回上一頁(沒有上一頁回首頁) */
  const h2 = p.UI.focus.enter({ total: 1 });
  click(p.doc.querySelector('.quiz-close'));
  assert.strictEqual(p.ctx.location.href, 'index.html');
  void h2;
};

T['回饋條:播報區(role=status)一進專心模式就在、不在會藏起來的底部列裡;一顆主按鈕(最後一題「看成績」),焦點移到按鈕'] = async () => {
  const p = loadPage();
  const f = p.UI.focus.enter({ total: 10 });
  const live = p.doc.querySelector('.quiz-live');
  assert.ok(live, '讀屏的播報區一開始就在');
  assert.strictEqual(live.getAttribute('role'), 'status');
  assert.ok(!p.doc.querySelector('.quiz-foot').contains(live), '播報區不在底部列裡(底部列沒有回饋時是 display:none)');
  assert.strictEqual(p.doc.querySelectorAll('[role="status"]').length, 1, '只有一個播報區,不會念兩次');
  let nexts = 0;
  const b1 = f.feedback({ ok: true, onNext: () => nexts++ });
  const foot = p.doc.querySelector('.quiz-foot');
  const shown = foot.querySelector('.quiz-fb-text');
  assert.ok(foot.classList.contains('is-fb') && foot.classList.contains('is-ok'));
  assert.strictEqual(live.textContent, '答對');
  assert.strictEqual(shown.textContent, '答對');
  assert.strictEqual(b1.textContent, '下一題');
  assert.strictEqual(p.doc.activeElement, b1);
  click(b1);
  assert.strictEqual(nexts, 1);
  const b2 = f.feedback({ ok: false, answer: 'B. completed', next: '看成績' });
  assert.ok(foot.classList.contains('is-bad') && !foot.classList.contains('is-ok'));
  assert.strictEqual(live.textContent, '答錯 · 正解 B. completed');
  assert.strictEqual(b2.textContent, '看成績');
  assert.strictEqual(foot.querySelectorAll('.btn.primary').length, 1);
  f.foot([]);
  assert.strictEqual(live.textContent, '');
  assert.ok(!foot.classList.contains('is-fb'));
  f.leave();
  assert.strictEqual(p.doc.querySelector('.quiz-live'), null, '離開時拿掉播報區');
};

T['作答列的「交卷」:opt.action 放在進度數字後面,點了呼叫;action(null) 拿掉'] = async () => {
  const p = loadPage();
  let n = 0;
  const f = p.UI.focus.enter({ total: 10, action: { label: '交卷', onClick: () => n++ } });
  const bar = p.doc.querySelector('.quiz-bar');
  const act = bar.querySelector('.quiz-act');
  assert.deepStrictEqual([act.tagName, act.textContent], ['BUTTON', '交卷']);
  const kids = bar.all();
  assert.ok(kids.indexOf(bar.querySelector('.quiz-count')) < kids.indexOf(act), 'Tab 順序:關閉、題數、交卷');
  click(act);
  assert.strictEqual(n, 1);
  f.action(null);
  assert.strictEqual(bar.querySelector('.quiz-act'), null);
  assert.ok(!bar.classList.contains('has-act'));
  f.action({ label: '交卷' });
  assert.ok(bar.querySelector('.quiz-act') && bar.classList.contains('has-act'));
  f.leave();
  const g = p.UI.focus.enter({ total: 3 });
  assert.strictEqual(p.doc.querySelector('.quiz-act'), null, '沒給就沒有');
  g.leave();
};

T['確認視窗:確定 true、取消 false、Esc false、點遮罩 false;焦點鎖在視窗內,關掉回到原本的按鈕'] = async () => {
  const p = loadPage();
  const opener = p.doc.createElement('button'); p.doc.body.append(opener); opener.focus();
  let v = p.UI.confirm({ title: '刪除帳號？', body: '刪掉後無法復原', ok: '刪除', danger: true });
  let dlg = p.doc.querySelector('.ui-dialog');
  assert.strictEqual(dlg.getAttribute('role'), 'alertdialog');
  assert.strictEqual(dlg.getAttribute('aria-modal'), 'true');
  assert.strictEqual(dlg.getAttribute('aria-describedby'), dlg.querySelector('.ui-dialog-body').getAttribute('id'));
  const cancel = dlg.querySelector('.ui-dialog-cancel'), ok = dlg.querySelector('.ui-dialog-ok');
  assert.strictEqual(p.doc.activeElement, cancel, '危險的確認先停在取消');
  assert.ok(ok.classList.contains('is-danger'));
  /* 取消在左、確定在右 */
  const acts = dlg.querySelector('.ui-dialog-actions').children;
  assert.deepStrictEqual([acts[0], acts[1]], [cancel, ok]);
  /* Tab 在最後一個 → 回到第一個;Shift+Tab 在第一個 → 最後一個 */
  ok.focus();
  let ev = key(p.doc, 'Tab');
  assert.ok(ev.defaultPrevented && p.doc.activeElement === cancel);
  ev = key(p.doc, 'Tab', true);
  assert.ok(ev.defaultPrevented && p.doc.activeElement === ok);
  /* 焦點跑到外面就拉回來 */
  opener.focus();
  assert.ok(dlg.contains(p.doc.activeElement));
  click(ok);   // type=submit:真的瀏覽器會送 submit
  submit(dlg);
  assert.strictEqual(await v, true);
  assert.strictEqual(p.doc.querySelector('.ui-mask'), null);
  assert.strictEqual(p.doc.activeElement, opener, '關掉後焦點回到原本的按鈕');

  v = p.UI.confirm({ title: 'A' });
  dlg = p.doc.querySelector('.ui-dialog');
  assert.strictEqual(p.doc.activeElement, dlg.querySelector('.ui-dialog-ok'), '一般的確認停在確定');
  assert.strictEqual(dlg.querySelector('.ui-dialog-ok').textContent, '確定');
  assert.strictEqual(dlg.querySelector('.ui-dialog-cancel').textContent, '取消');
  assert.strictEqual(dlg.querySelector('.ui-dialog-body'), null, '沒給 body 就不出現');
  click(dlg.querySelector('.ui-dialog-cancel'));
  assert.strictEqual(await v, false);

  const lines = p.doc.createElement('span'); lines.textContent = '兩行內文';
  v = p.UI.confirm({ title: 'A2', body: lines, ok: '改用', cancel: '保留', focusCancel: true });
  dlg = p.doc.querySelector('.ui-dialog');
  assert.strictEqual(p.doc.activeElement, dlg.querySelector('.ui-dialog-cancel'), 'focusCancel:停在取消');
  assert.ok(!dlg.querySelector('.ui-dialog-ok').classList.contains('is-danger'), 'focusCancel 不把確定變紅');
  assert.strictEqual(dlg.querySelector('.ui-dialog-body').firstChild, lines, '內文給節點就照樣接上(分行用)');
  key(p.doc, 'Escape');
  assert.strictEqual(await v, false);

  v = p.UI.confirm({ title: 'B' });
  const esc = key(p.doc, 'Escape');
  assert.ok(esc.stopped, 'Esc 不往下傳給頁面上其他處理');
  assert.strictEqual(await v, false);
  assert.strictEqual((p.doc.listeners.keydown || []).length, 0, '關掉後拿掉鍵盤監聽');

  v = p.UI.confirm({ title: 'C' });
  const mask = p.doc.querySelector('.ui-mask');
  click(mask.querySelector('.ui-dialog-h'));   // 點視窗裡面不關
  assert.ok(p.doc.querySelector('.ui-mask'));
  /* 在視窗裡按下、放開在遮罩上(拖選文字):不關 */
  pressOn(mask.querySelector('.ui-dialog-h'), mask);
  click(mask);
  assert.ok(p.doc.querySelector('.ui-mask'), '按下不在遮罩上就不關');
  press(mask);
  click(mask);
  assert.strictEqual(await v, false);
};

T['輸入視窗:確定回字串(去頭尾空白)、取消與 Esc 回 null、空白不能送、maxLength'] = async () => {
  const p = loadPage();
  let v = p.UI.prompt({ title: '改暱稱', label: '暱稱', value: '小明', ok: '儲存', maxLength: 20 });
  let dlg = p.doc.querySelector('.ui-dialog');
  const input = dlg.querySelector('input');
  assert.strictEqual(dlg.getAttribute('role'), 'dialog');
  assert.strictEqual(p.doc.activeElement, input);
  assert.strictEqual(input.value, '小明');
  assert.strictEqual(input.getAttribute('maxlength'), '20');
  assert.strictEqual(dlg.querySelector('label'), null, '只有一個欄位:不放看得到的欄位標籤(標題已經說了)');
  assert.strictEqual(input.getAttribute('aria-label'), '暱稱', 'opt.label 變成輸入框的 aria-label');
  input.value = '   '; (input.on.input || []).forEach((f) => f({}));
  assert.ok(dlg.querySelector('.ui-dialog-ok').disabled, '空白時不能按確定');
  submit(dlg);
  assert.ok(p.doc.querySelector('.ui-dialog'), '空白送不出去');
  /* Tab 只在可以按的東西之間轉(確定停用時跳過) */
  dlg.querySelector('.ui-dialog-cancel').focus();
  assert.ok(key(p.doc, 'Tab').defaultPrevented); assert.strictEqual(p.doc.activeElement, input, '取消是最後一個:回到輸入框');
  assert.ok(key(p.doc, 'Tab', true).defaultPrevented); assert.strictEqual(p.doc.activeElement, dlg.querySelector('.ui-dialog-cancel'));
  input.value = '  小華 '; (input.on.input || []).forEach((f) => f({}));
  submit(dlg);
  assert.strictEqual(await v, '小華');

  v = p.UI.prompt({ title: '改暱稱', value: 'x' });
  dlg = p.doc.querySelector('.ui-dialog');
  assert.strictEqual(dlg.querySelector('input').getAttribute('aria-label'), '改暱稱', '沒給 label 時用標題當名字');
  click(dlg.querySelector('.ui-dialog-cancel'));
  assert.strictEqual(await v, null);
  v = p.UI.prompt({ title: '改暱稱' });
  key(p.doc, 'Escape');
  assert.strictEqual(await v, null);
  /* 外部字串只當文字 */
  v = p.UI.prompt({ title: '<b>x</b>', value: '<script>' });
  dlg = p.doc.querySelector('.ui-dialog');
  assert.strictEqual(dlg.querySelector('.ui-dialog-h').textContent, '<b>x</b>');
  assert.strictEqual(dlg.querySelector('b'), null);
  key(p.doc, 'Escape');
  await v;
};

T['空狀態:小雞靜態一張(預設 sleep)、一行字、一個出口;沒有計時器、沒有監聽,有 destroy'] = async () => {
  const ch = fakePelican();
  const p = loadPage({ pelican: ch });
  const e = p.UI.empty({ text: '沒有錯題', action: { label: '去刷題', href: 'practice.html' } });
  assert.ok(e.classList.contains('ui-empty'));
  assert.strictEqual(e.querySelector('.ui-empty-text').textContent, '沒有錯題');
  const go = e.querySelector('.ui-empty-go');
  assert.deepStrictEqual([go.tagName, go.textContent, go.getAttribute('href')], ['A', '去刷題', 'practice.html']);
  assert.ok(go.classList.contains('btn') && !go.classList.contains('primary'), '出口是描邊按鈕');
  assert.strictEqual(ch.made[0].opt.size, 130, '畫布 130(鵜鶘)');
  assert.deepStrictEqual(ch.made[0].shown, [0, 0, 'sleep'], '靜止格');
  assert.ok(!ch.made[0].timer);
  assert.strictEqual((p.doc.listeners.visibilitychange || []).length, 0, '靜態的小雞不掛 visibilitychange');
  assert.strictEqual(typeof e.destroy, 'function');
  e.destroy(); e.destroy();
  /* 等開始用 read(鵜鶘有 read);出口是按鈕時呼叫 onClick */
  let n = 0;
  const e2 = p.UI.empty({ pose: 'read', text: '還沒開始', action: { label: '開始', onClick: () => n++ } });
  assert.strictEqual(ch.made[1].opt.pose, 'read');
  click(e2.querySelector('.ui-empty-go'));
  assert.strictEqual(n, 1);
  const e3 = p.UI.empty({ text: '沒有紀錄' });
  assert.strictEqual(e3.querySelector('.ui-empty-go'), null);
  assert.strictEqual(p.timers.size, 0);
};

/* ---------- 主角鵜鶘:有 PelicanArt 就用,沒有或載入失敗退回 ChickArt,兩個都沒有就不畫 ---------- */
T['結算卡與空狀態:有 PelicanArt 就畫鵜鶘(不碰 ChickArt),畫布加 .is-pelican'] = async () => {
  const pe = fakePelican(), ck = fakeChick();
  const p = loadPage({ pelican: pe, chick: ck });
  const c = p.UI.result({ score: 9, total: 10 });
  const e = p.UI.empty({ text: '沒有錯題' });
  assert.strictEqual(pe.made.length, 2, '結算卡與空狀態各畫一隻鵜鶘');
  assert.strictEqual(ck.made.length, 0, '小雞沒被叫出來');
  assert.ok(c.el.querySelector('.result-chick').classList.contains('is-pelican'));
  assert.ok(e.querySelector('.ui-empty-art').classList.contains('is-pelican'));
  assert.strictEqual(c.mascot, c.chick, 'card.mascot 與舊名 card.chick 是同一個');
  assert.strictEqual(pe.made[0].opt.pose, 'happy');
  assert.strictEqual(pe.made[1].opt.pose, 'sleep');
  await settle();
  assert.ok(!p.scripts.some((s) => String(s).endsWith('chick-art.js')), '有鵜鶘時不載小雞的檔');
  c.destroy();
};

T['鵜鶘還沒載進頁面:會去載 js/pelican-art.js(UI.art.ensure 也認別名 pelican),載到後畫鵜鶘'] = async () => {
  const pe = fakePelican(), ck = fakeChick();
  const p = loadPage({ chick: ck, loads: { PelicanArt: { file: 'js/pelican-art.js', lib: pe.lib } } });
  const c = p.UI.result({ score: 9, total: 10 });
  assert.strictEqual(pe.made.length, 0, '還沒載到');
  await settle();
  assert.ok(p.scripts.some((s) => String(s).endsWith('js/pelican-art.js')), '載了 pelican-art.js');
  assert.strictEqual(pe.made.length, 1, '載到後畫鵜鶘');
  assert.strictEqual(ck.made.length, 0);
  assert.ok(c.el.querySelector('.result-chick').classList.contains('is-pelican'));
  assert.strictEqual((await p.UI.art.ensure(['pelican'])).PelicanArt, true);
};

T['鵜鶘載入失敗:退回 ChickArt,畫布換成小雞的寬與比例、拿掉 .is-pelican;兩個都沒有就不畫、不丟錯'] = async () => {
  const ck = fakeChick();
  const p = loadPage({ chick: ck });   // 沒有 PelicanArt,也載不到(<script> 送 error)
  const c = p.UI.result({ score: 9, total: 10 });
  const cv = c.el.querySelector('.result-chick');
  assert.strictEqual(cv.style.width, '180px', '一開始先照鵜鶘留位置');
  await settle();
  assert.strictEqual(ck.made.length, 1, '退回小雞');
  assert.strictEqual(ck.made[0].opt.pose, 'happy');
  assert.strictEqual(ck.made[0].opt.size, 140, '小雞手機 140');
  assert.strictEqual(cv.style.width, '140px');
  assert.strictEqual(cv.style.height, Math.round(140 * 280 / 240) + 'px', '高度照小雞的比例');
  assert.ok(!cv.classList.contains('is-pelican'), '小雞用原本的邊距');
  assert.strictEqual(c.mascot.art, 'ChickArt');
  /* 小雞沒有的姿勢仍會退回 idle */
  const ck2 = fakeChick(['idle', 'happy', 'sleep']);
  const p2 = loadPage({ chick: ck2 });
  p2.UI.result({ score: 1, total: 10 });
  await settle();
  assert.strictEqual(ck2.made[0].opt.pose, 'idle');
  /* 空狀態退回小雞:136 */
  const ck3 = fakeChick();
  const p3 = loadPage({ chick: ck3 });
  const e = p3.UI.empty({ text: 'x' });
  await settle();
  assert.strictEqual(ck3.made[0].opt.size, 136);
  assert.strictEqual(e.querySelector('.ui-empty-art').style.width, '136px');
  /* 兩個都沒有:畫布照鵜鶘留著、不丟錯、沒有留下計時器 */
  const p4 = loadPage();
  const c4 = p4.UI.result({ score: 1, total: 2, compact: true });
  const e4 = p4.UI.empty({ text: 'y' });
  await settle();
  assert.strictEqual(c4.el.querySelector('.result-chick').style.width, '120px');
  assert.ok(c4.el.querySelector('.result-chick').classList.contains('is-pelican'));
  c4.destroy(); e4.destroy();
  assert.strictEqual(p4.timers.size, 0);
  /* 鵜鶘的 animate 丟錯:不丟到外面;鵜鶘存在就不另外叫小雞 */
  const bad = { poses: ['idle', 'happy'], animate() { throw new Error('壞了'); } };
  const ck5 = fakeChick();
  const p5 = loadPage({ pelican: { lib: bad }, chick: ck5 });
  p5.UI.result({ score: 1, total: 2 }).destroy();
  assert.strictEqual(ck5.made.length, 0);
};

T['data-mascot 掛載:頁面載入時畫鵜鶘(姿勢、寬、data-still);data-chick 仍畫小雞;各掛各的'] = async () => {
  const pe = fakePelican(), ck = fakeChick();
  const p = loadPage({ pelican: pe, chick: ck, markup(doc) {
    const a = doc.createElement('canvas'); a.setAttribute('data-mascot', 'read'); a.setAttribute('data-size', '200'); doc.body.append(a);
    const b = doc.createElement('canvas'); b.setAttribute('data-mascot', 'happy'); b.setAttribute('data-size', '120'); b.setAttribute('data-still', ''); doc.body.append(b);
    const d = doc.createElement('canvas'); d.setAttribute('data-chick', 'idle'); d.setAttribute('data-size', '80'); doc.body.append(d);
    const f = doc.createElement('canvas'); f.setAttribute('data-mascot', ''); doc.body.append(f);
  } });
  const cvs = p.doc.querySelectorAll('canvas');
  assert.deepStrictEqual(pe.made.map((a) => [a.opt.size, a.opt.pose]), [[200, 'read'], [120, 'happy'], [180, 'idle']], '鵜鶘:姿勢、寬(沒給寬 180、沒給姿勢 idle)');
  assert.deepStrictEqual(ck.made.map((a) => [a.opt.size, a.opt.pose]), [[80, 'idle']], 'data-chick 還是小雞');
  assert.ok(cvs[0].classList.contains('is-pelican') && !cvs[2].classList.contains('is-pelican'));
  assert.strictEqual(pe.made[1].timer, false, 'data-still 只畫靜止格');
  assert.strictEqual(cvs[0].getAttribute('data-mascot-on'), '1');
  assert.strictEqual(cvs[2].getAttribute('data-chick-on'), '1');
  assert.strictEqual(cvs[2].getAttribute('data-mascot-on'), null, 'data-chick 不被當成主角');
  /* 沒有鵜鶘時 data-mascot 退回小雞(寬 ×0.78) */
  const ck2 = fakeChick();
  const p2 = loadPage({ chick: ck2, markup(doc) { const a = doc.createElement('canvas'); a.setAttribute('data-mascot', 'idle'); a.setAttribute('data-size', '180'); doc.body.append(a); } });
  await settle();
  assert.deepStrictEqual([ck2.made[0].opt.size, ck2.made[0].opt.pose], [140, 'idle']);
  assert.strictEqual(typeof p2.UI.mascot, 'function');
};

T['尺寸照 metrics 的比例算:寬 180/200/120/130,高 = 寬 × 高/寬(不變形);metrics 換了高度跟著換'] = async () => {
  const pe = fakePelican();
  const p = loadPage({ pelican: pe, media: { '(min-width: 900px)': false } });
  const sizeOf = (n) => [n.style.width, n.style.height];
  const c = p.UI.result({ score: 5, total: 10 });
  assert.deepStrictEqual(sizeOf(c.el.querySelector('.result-chick')), ['180px', '168px'], '手機 180 × 168');
  const k = p.UI.result({ score: 5, total: 10, compact: true });
  assert.deepStrictEqual(sizeOf(k.el.querySelector('.result-chick')), ['120px', '112px'], '緊湊版 120 × 112');
  const e = p.UI.empty({ text: 'z' });
  assert.deepStrictEqual(sizeOf(e.querySelector('.ui-empty-art')), ['130px', '121px'], '空狀態 130 × 121');
  const pw = loadPage({ pelican: pe, media: { '(min-width: 900px)': true } });
  const w = pw.UI.result({ score: 5, total: 10 });
  assert.deepStrictEqual(sizeOf(w.el.querySelector('.result-chick')), ['200px', '187px'], '桌機 200 × 187');
  /* 比例不是寫死的:metrics 換成 300×300,高度跟著變成寬 */
  const sq = fakeArt(['idle', 'happy', 'oops', 'read', 'sleep'], { width: 300, height: 300 });
  const ps = loadPage({ pelican: sq });
  const s = ps.UI.result({ score: 5, total: 10 });
  assert.deepStrictEqual(sizeOf(s.el.querySelector('.result-chick')), ['180px', '180px']);
  /* 傳給 animate 的寬就是畫布的寬,沒有另外縮放 */
  assert.ok(pe.made.every((a) => [180, 120, 130, 200].includes(a.opt.size)));
};

T['逐題收合:預設收合,標題右邊「答錯 N 題」(數 .opt.wrong 或照給的數字)'] = async () => {
  const p = loadPage();
  const mk = (wrong) => { const b = p.doc.createElement('div'); b.className = 'q-block'; const o = p.doc.createElement('button'); o.className = wrong ? 'opt wrong' : 'opt correct'; b.append(o); return b; };
  const d = p.UI.detail('逐題解析 10 題', [mk(true), mk(false), mk(true)]);
  assert.strictEqual(d.tagName, 'DETAILS');
  assert.ok(!d.hasAttribute('open'));
  assert.strictEqual(d.querySelector('.result-detail-t').textContent, '逐題解析 10 題');
  assert.strictEqual(d.querySelector('.result-detail-bad').textContent, '答錯 2 題');
  assert.strictEqual(d.querySelector('.result-detail-body').children.length, 3);
  const d2 = p.UI.detail('逐題解析 3 題', [mk(false)], { wrong: 0 });
  assert.strictEqual(d2.querySelector('.result-detail-bad'), null, '全對時不寫');
};

T['不讀寫儲存、不用 innerHTML、不寫 console.log'] = async () => {
  const ch = fakePelican(), fd = fakeFood();
  const p = loadPage({ pelican: ch, food: fd });
  const f = p.UI.focus.enter({ total: 3 });
  f.dirty(true); f.progress(1); f.feedback({ ok: false, answer: 'A' }); f.leave();
  const c = p.UI.result({ score: 1, total: 3 }); p.doc.body.append(c.el);
  p.emit('pet:earn', { result: 'got', food: 'corn' });
  const v = p.UI.prompt({ title: 'x', value: 'y' }); key(p.doc, 'Escape'); await v;
  p.UI.empty({ text: 'z' });
  await settle();
  assert.deepStrictEqual(p.storage.touched, []);
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code), '原始碼不碰儲存');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(code), '原始碼不用 innerHTML');
  assert.ok(!/console\.log/.test(code), '原始碼沒有 console.log');
};

T['圖示:不認得的 id 標 .is-noart(版面照沒圖排),其他照畫並標 doodle-ready;頁面先載好 DoodleArt 時當下就畫'] = async () => {
  const drawn = [];
  const D = { ids: ['home', 'learn'], mountAll(root) { drawn.push(root); throw new Error('DoodleArt: 沒有這個圖示 "review"'); } };
  const p = loadPage({ loads: { DoodleArt: { file: 'js/doodle-art.js', lib: D } },
    markup(doc) {
      ['learn', 'review'].forEach((id) => { const cv = doc.createElement('canvas'); cv.setAttribute('data-doodle', id); doc.body.append(cv); });
    } });
  await settle();
  const cvs = p.doc.querySelectorAll('canvas');
  assert.strictEqual(drawn.length, 1);
  assert.ok(p.doc.documentElement.classList.contains('doodle-ready'), 'mountAll 丟錯也標 doodle-ready(其他圖都畫上了)');
  assert.ok(!cvs[0].classList.contains('is-noart'));
  assert.ok(cvs[1].classList.contains('is-noart'), '不認得的標 is-noart');
  /* 頁面自己先載了 doodle-art.js:不加 <script>,同步畫完 */
  const D2 = { ids: ['home'], mountAll() {} };
  const p2 = loadPage({ markup(doc) { const cv = doc.createElement('canvas'); cv.setAttribute('data-doodle', 'home'); doc.body.append(cv); } });
  assert.ok(!p2.doc.documentElement.classList.contains('doodle-ready'));
  p2.ctx.DoodleArt = D2;
  const r = p2.UI.doodle(p2.doc);
  assert.ok(p2.doc.documentElement.classList.contains('doodle-ready'), '已經有 DoodleArt 時當下就標');
  assert.strictEqual(await r, true);
};

T['原始碼與樣式沒有本機路徑;樣式有專心模式、付費牆與分頁列的規則'] = async () => {
  const css = fs.readFileSync(path.join(REPO, 'css', 'style.css'), 'utf8');
  const start = css.indexOf('/* ======== 共用元件(js/ui.js)');
  assert.ok(start > 0, 'style.css 最後一段的開頭註解');
  /* 只檢查共用元件那一段:後面「各頁面的補充樣式」是各頁自己的規則,不受這裡的限制 */
  const end = css.indexOf('/* ---------------- 各頁面的補充樣式', start);
  assert.ok(end > start, '共用元件那一段的結尾標記(各頁面的補充樣式)');
  const kit = css.slice(start, end);
  /* repo 是公開的:不寫本機的絕對路徑 */
  const local = /(^|[^A-Za-z])[A-Za-z]:[\\/]/;
  assert.ok(!local.test(kit) && !local.test(SRC), '樣式與 js/ui.js 不該有本機路徑');
  ['html.is-quiz .topbar-inner', 'html.is-quiz.app-shell .app-tabbar', 'html.is-quiz .pet-roam', 'html.is-quiz.app-shell.has-tabbar body::after',
    '.modal-mask.pw-mask', 'html.is-quiz.app-kb .quiz-foot', '.tile-featured', '.tile-badge', '.tile-group-h', '.result-reward', '.ui-empty', '.app-tab-art',
    'a.nav-btn', '--fs-3xl', '--r-full', '--snack-tint', '.tile-featured .tile-go:not(.primary)', '.page-head:has(> .hub-art)', '.tile-group-art', '.quiz-live', '@keyframes ui-hop', 'html.is-quiz:not(.app-gate) .topbar',
    'html.is-quiz.ui-kb .quiz-foot', '.quiz-slot', '.quiz-fb-note', '.result-card.is-inline', '.ui-reward-row', '.ui-empty-links', '.ui-empty-extra', '.ui-dialog-hint',
    '.modal-mask.ui-sheet-mask', '.ui-sheet-close'].forEach((s) => assert.ok(kit.includes(s), '樣式少了 ' + s));
  /* 各練習頁原本的 .result-note、寫作練習的 .tile 不被新規則蓋到:新段落裡不出現沒掛在新類別底下的這兩個選擇器 */
  const sels = (kit.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{/g) || []).map((x) => x.replace(/\{$/, '').trim());
  const parts = [].concat(...sels.map((x) => x.split(',').map((y) => y.trim())));
  assert.ok(!parts.some((x) => /(^|\s)\.result-note\b/.test(x) && !/\.result-card \.result-note/.test(x)), '.result-note 要掛在 .result-card 底下');
  assert.ok(!parts.some((x) => /(^|[\s>])\.tile(?![\w-])/.test(x) && !/\.module-card\.tile|\.tile-grid/.test(x)), '.tile 要跟 .module-card 一起寫');
  assert.ok(/\.module-card\.tile:hover \{[^}]*background: #fff/.test(kit), '新磚滑過時蓋掉寫作排字塊的淡藍底');
  /* 跳一下的壓扁量:scaleX ≤ 1.1、scaleY ≥ 0.9 */
  const hopK = kit.match(/@keyframes ui-hop \{([^{}]*\{[^}]*\}\s*)+\}/);
  assert.ok(hopK, '有 ui-hop');
  (hopK[0].match(/scale\(([^)]+)\)/g) || []).forEach((m) => {
    const [x, y] = m.slice(6, -1).split(',').map(Number);
    assert.ok(x <= 1.1 && (y === undefined ? x >= 0.9 : y >= 0.9), '壓扁量太大:' + m);
  });
  /* 動畫只動 transform 與 opacity */
  const trans = kit.match(/transition:[^;]+;/g) || [];
  trans.forEach((t) => assert.ok(/^transition: (transform|opacity|none)/.test(t) && !/(width|height|top|left|margin|padding|color|background|border)/.test(t.replace(/var\(--ease-out\)/, '')), '只動 transform 與 opacity:' + t));
  const keys = kit.match(/@keyframes[^{]+\{([^{}]*\{[^}]*\}\s*)+\}/g) || [];
  keys.forEach((k) => assert.ok(!/(width|height|top|left|margin)\s*:/.test(k), 'keyframes 只動 transform 與 opacity:' + k));
  /* 舊規則一條都沒刪:最後一段之前跟上一版一樣 */
  const { execSync } = require('child_process');
  /* 往回找最近一個還沒有新段落的版本來比 */
  let before = '';
  for (let i = 0; i < 12 && !before; i++) {
    let t = '';
    try { t = execSync('git show HEAD~' + i + ':css/style.css', { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }); } catch (e) { break; }
    if (!t.includes('/* ======== 共用元件(js/ui.js)')) before = t;
  }
  if (before) {
    const norm = (s) => s.replace(/\r\n/g, '\n').trimEnd();
    assert.strictEqual(norm(css.slice(0, start)), norm(before), '最後一段之前的舊樣式不動');
  }
};

/* ---------- 第二版:點心事件的認法、點心列、內嵌小卡、通知視窗、面板、掛載 ---------- */
const line = (p, card, wait) => { const n = p.doc.createElement('p'); n.className = 'pet-earn' + (wait ? ' is-wait' : ''); card.reward.append(n); return n; };

T['點心事件:earnId 也認特別點心的 id(y_<來源>、w:…_<來源>、截到 24 字的),不認只是字尾相像的'] = async () => {
  const fd = fakeFood();
  const p = loadPage({ pelican: fakePelican(), food: fd });
  const got = (earnId, id) => {
    const c = p.UI.result({ score: 6, total: 10, earnId });
    p.doc.body.append(c.el);
    p.emit('pet:earn', { result: 'got', food: 'corn', id, source: 'hook' });
    const n = c.reward.querySelectorAll('canvas').length;
    c.destroy();
    return n;
  };
  assert.strictEqual(got('rv', 'rv'), 1, '一般點心:id 就是來源');
  assert.strictEqual(got('rv', 'w:s1_rv'), 1, '麵包蟲:w:s1_<來源>');
  assert.strictEqual(got('p5', 'y_p5'), 1, '地瓜:y_<來源>');
  assert.strictEqual(got('mock', 'w:a12_mock'), 1, '每 30 天的麵包蟲');
  const long = 'wr:abcdefghijklmnopqrstuvwxyz';
  assert.strictEqual(got(long, ('w:s2_' + long).slice(0, 24)), 1, '超過 24 字截掉後面的特別點心');
  assert.strictEqual(got('p5', 'y_p55'), 0, '字尾相像但不是這個來源');
  assert.strictEqual(got('p5', 'p6'), 0);
  assert.strictEqual(p.listeners('pet:earn'), 0, '每張卡 destroy 後拿掉監聽');
};

T['點心事件:同一頁兩張卡不互相搶(掛勾正在等的那一行優先,其次 earnId,最後是已經有那一行的卡)'] = async () => {
  const fd = fakeFood();
  const p = loadPage({ pelican: fakePelican(), food: fd });
  const has = (c) => c.reward.querySelectorAll('canvas').length;
  /* 舊卡留著上一次掛勾的那一行(已經寫完,不是 is-wait);新卡的掛勾正在等 */
  const a = p.UI.result({ score: 6, total: 10 }), b = p.UI.result({ score: 6, total: 10 });
  p.doc.body.append(a.el, b.el);
  line(p, a, false);
  line(p, b, true);
  p.emit('pet:earn', { result: 'got', food: 'corn', id: 'x', source: 'hook' });
  await settle();
  assert.deepStrictEqual([has(a), has(b)], [0, 1], '畫在掛勾正在等的那一張');
  /* 舊的那一行不是 is-wait 也不在 earnId:另一張給了 earnId 的卡優先 */
  const c = p.UI.result({ score: 6, total: 10, earnId: 'mock' });
  p.doc.body.append(c.el);
  p.emit('pet:earn', { result: 'got', food: 'melon', id: 'y_mock', source: 'hook' });
  await settle();
  assert.deepStrictEqual([has(a), has(c)], [0, 1], 'earnId 對得上的那張');
  assert.ok(c.reward.classList.contains('has-food'));
  /* 掛勾正在等 + earnId 對得上:兩張都在等時挑對得上的 */
  const d = p.UI.result({ score: 6, total: 10, earnId: 'g:1' }), e = p.UI.result({ score: 6, total: 10, earnId: 'g:2' });
  p.doc.body.append(d.el, e.el);
  line(p, d, true); line(p, e, true);
  p.emit('pet:earn', { result: 'got', food: 'tomato', id: 'g:1', source: 'hook' });
  await settle();
  assert.deepStrictEqual([has(d), has(e)], [1, 0]);
  /* 沒有任何一張認得:都不畫 */
  const f = p.UI.result({ score: 6, total: 10, earnId: 'q' });
  p.doc.body.append(f.el);
  p.emit('pet:earn', { result: 'got', food: 'corn', id: 'zz', source: 'hook' });
  await settle();
  assert.strictEqual(has(f), 0);
  [a, b, c, d, e, f].forEach((x) => x.destroy());
  assert.strictEqual(p.listeners('pet:earn'), 0);
};

T['UI.rewardRow:只有點心列(沒有角色、分數、按鈕),掛勾放進 reward 就畫食物;destroy 拿掉監聽;跟結算卡同一套認法'] = async () => {
  const fd = fakeFood(), pe = fakePelican();
  const p = loadPage({ pelican: pe, food: fd });
  const r = p.UI.rewardRow();
  assert.ok(r.el.classList.contains('ui-reward-row'));
  assert.strictEqual(r.reward.parentNode, r.el);
  assert.ok(r.reward.classList.contains('result-reward'));
  assert.strictEqual(r.el.querySelector('canvas'), null, '沒有角色');
  assert.strictEqual(r.el.querySelector('.result-score, .btn'), null);
  assert.strictEqual(pe.made.length, 0);
  p.doc.body.append(r.el);
  /* 另一張結算卡也在頁面上:點心畫在掛勾正在等的點心列 */
  const card = p.UI.result({ score: 6, total: 10 });
  p.doc.body.append(card.el);
  line(p, card, false);
  const ln = line(p, r, true);
  p.emit('pet:earn', { result: 'got', food: 'tomato', id: 'dlg:a1', source: 'hook' });
  await settle();
  assert.ok(r.reward.classList.contains('has-food'));
  assert.strictEqual(r.reward.children[0].tagName, 'CANVAS', '食物在左邊');
  assert.strictEqual(r.reward.children[1], ln, '掛勾那一行不動');
  assert.strictEqual(card.reward.querySelector('canvas'), null, '結算卡不搶');
  card.destroy();
  r.destroy(); r.destroy();
  assert.strictEqual(p.listeners('pet:earn'), 0);
  assert.strictEqual(fd.mounted[0].stopped, 1, 'destroy 收掉食物');
  /* earnId 也可以給;被拿出頁面又沒 destroy:下一個事件來時自己收掉 */
  const r2 = p.UI.rewardRow({ earnId: 'wr:9' });
  p.doc.body.append(r2.el);
  p.emit('pet:earn', { result: 'got', food: 'corn', id: 'y_wr:9', source: 'hook' });
  await settle();
  assert.ok(r2.reward.classList.contains('has-food'));
  r2.el.remove();
  p.emit('pet:earn', { result: 'got', food: 'corn', id: 'other', source: 'hook' });
  assert.strictEqual(p.listeners('pet:earn'), 0, '拿出頁面後自己收掉');
};

T['結算卡:big 沒給 unit 不接出 null;primary、links 可帶 attrs(不收事件與 href);links 的 null 略過'] = async () => {
  const p = loadPage({ pelican: fakePelican() });
  const w = p.UI.result({ compact: true, big: '已儲存', ratio: 1 });
  assert.strictEqual(w.heading.textContent, '已儲存');
  assert.ok(!/null|undefined/.test(w.heading.textContent));
  assert.strictEqual(p.UI.result({ big: 0, unit: null }).heading.textContent, '0');
  const c = p.UI.result({ score: 1, total: 2,
    primary: { label: '再做一次', onClick() {}, attrs: { 'data-gate': '', onclick: 'alert(1)', href: 'javascript:x', class: 'evil', 'aria-describedby': 'n1', hidden: false } },
    links: [null, { label: '再測一次', onClick() {}, attrs: { 'data-gate': true } }, undefined, { label: '回題庫', href: 'practice.html', attrs: { 'data-x': 1 } }] });
  const go = c.el.querySelector('.result-go');
  assert.strictEqual(go.getAttribute('data-gate'), '');
  assert.strictEqual(go.getAttribute('aria-describedby'), 'n1');
  assert.strictEqual(go.getAttribute('onclick'), null, '不收事件屬性');
  assert.strictEqual(go.getAttribute('href'), null, 'href 不從 attrs 進來');
  assert.strictEqual(go.className, 'btn primary result-go', 'class 不被蓋掉');
  assert.strictEqual(go.getAttribute('hidden'), null, 'false 不設');
  const links = c.el.querySelectorAll('.result-link');
  assert.deepStrictEqual(links.map((n) => n.textContent), ['再測一次', '回題庫'], 'null、undefined 略過');
  assert.strictEqual(links[0].getAttribute('data-gate'), '');
  assert.strictEqual(links[1].getAttribute('data-x'), '1');
  assert.strictEqual(links[1].getAttribute('href'), 'practice.html');
};

T['結算卡內嵌版(inline):is-inline、角色跟緊湊版一樣小(鵜鶘 120、退回小雞 96)、沒有按鈕時不留按鈕列'] = async () => {
  const pe = fakePelican();
  const p = loadPage({ pelican: pe, media: { '(min-width: 900px)': true } });
  const c = p.UI.result({ inline: true, score: 3, total: 4, kicker: '小試身手' });
  assert.ok(c.el.classList.contains('result-card') && c.el.classList.contains('is-inline'));
  assert.ok(!c.el.classList.contains('is-compact'), '不是遊戲浮層的緊湊版');
  assert.strictEqual(pe.made[0].opt.size, 120, '桌機也是 120');
  assert.strictEqual(c.el.querySelector('.result-actions').children.length, 0);
  const ck = fakeChick();
  const p2 = loadPage({ chick: ck });
  p2.UI.result({ inline: true, score: 1, total: 4 });
  await settle();
  assert.strictEqual(ck.made[0].opt.size, 96, '退回小雞 96');
  /* compact 與 inline 同時給:照 compact */
  const both = p.UI.result({ compact: true, inline: true, score: 1, total: 2 });
  assert.ok(both.el.classList.contains('is-compact') && !both.el.classList.contains('is-inline'));
};

T['通知視窗 UI.alert:只有一顆按鈕(預設「知道了」),按下、Esc、點遮罩都回 true,焦點回原處'] = async () => {
  const p = loadPage();
  const opener = p.doc.createElement('button'); p.doc.body.append(opener); opener.focus();
  let v = p.UI.alert({ title: '登出失敗', body: '連不上雲端\n請稍後再試' });
  const dlg = p.doc.querySelector('.ui-dialog');
  assert.strictEqual(dlg.getAttribute('role'), 'alertdialog');
  assert.strictEqual(dlg.querySelector('.ui-dialog-cancel'), null, '沒有取消');
  assert.strictEqual(dlg.querySelectorAll('button').length, 1);
  const ok = dlg.querySelector('.ui-dialog-ok');
  assert.strictEqual(ok.textContent, '知道了');
  assert.strictEqual(p.doc.activeElement, ok);
  assert.ok(key(p.doc, 'Tab').defaultPrevented && p.doc.activeElement === ok, 'Tab 停在唯一的按鈕');
  submit(dlg);
  assert.strictEqual(await v, true);
  assert.strictEqual(p.doc.activeElement, opener);
  v = p.UI.alert({ title: 'x', ok: '好' });
  assert.strictEqual(p.doc.querySelector('.ui-dialog-ok').textContent, '好');
  key(p.doc, 'Escape');
  assert.strictEqual(await v, true);
  v = p.UI.alert({ title: 'y' });
  const mask = p.doc.querySelector('.ui-mask');
  press(mask); click(mask);
  assert.strictEqual(await v, true);
  assert.strictEqual((p.doc.listeners.keydown || []).length, 0);
};

T['輸入視窗 hint:輸入框下面一行小字,輸入框 aria-describedby 指到它;沒給就沒有'] = async () => {
  const p = loadPage();
  let v = p.UI.prompt({ title: '改暱稱', label: '暱稱', value: '小明', hint: '老師可見' });
  const dlg = p.doc.querySelector('.ui-dialog');
  const field = dlg.querySelector('.ui-dialog-field');
  assert.deepStrictEqual(field.children.map((n) => n.tagName), ['INPUT', 'P'], '輸入框在上、提示在下');
  const hint = field.querySelector('.ui-dialog-hint');
  assert.strictEqual(hint.textContent, '老師可見');
  assert.strictEqual(field.querySelector('input').getAttribute('aria-describedby'), hint.getAttribute('id'));
  assert.strictEqual(dlg.querySelector('.ui-dialog-body'), null, 'hint 不是 body');
  key(p.doc, 'Escape'); await v;
  v = p.UI.prompt({ title: 'x' });
  assert.strictEqual(p.doc.querySelector('.ui-dialog-hint'), null);
  assert.strictEqual(p.doc.querySelector('.ui-dialog input').getAttribute('aria-describedby'), null);
  key(p.doc, 'Escape'); await v;
};

T['空狀態:action.primary 是實色、links 一排文字連結(null 略過、可帶 attrs)、extra 放在下面'] = async () => {
  const p = loadPage({ pelican: fakePelican() });
  const msg = p.doc.createElement('p'); msg.className = 'ac-msg';
  const e = p.UI.empty({ text: '累計作答 3 / 10 題', action: { label: '去刷題', href: 'practice.html', primary: true },
    links: [{ label: '程度檢測', href: 'diagnostic.html' }, null, { label: '說明', onClick() {}, attrs: { 'data-x': '1' } }], extra: [msg, null] });
  const go = e.querySelector('.ui-empty-go');
  assert.ok(go.classList.contains('btn') && go.classList.contains('primary'));
  const links = e.querySelectorAll('.ui-empty-links .ui-empty-link');
  assert.deepStrictEqual(links.map((n) => n.tagName + ':' + n.textContent), ['A:程度檢測', 'BUTTON:說明']);
  assert.ok(links.every((n) => n.classList.contains('btn-text')));
  assert.strictEqual(links[1].getAttribute('data-x'), '1');
  const kids = e.children.map((n) => n.className);
  assert.deepStrictEqual(kids.slice(1), ['ui-empty-text', 'btn ui-empty-go primary', 'ui-empty-links', 'ui-empty-extra'], '字、出口、連結、extra 的順序');
  assert.strictEqual(e.querySelector('.ui-empty-extra').children[0], msg);
  assert.strictEqual(e.querySelectorAll('.btn.primary').length, 1);
  /* extra 也可以只給一個節點;沒給 links、extra 就沒有那兩格 */
  const e2 = p.UI.empty({ text: 'x', extra: p.doc.createElement('div') });
  assert.strictEqual(e2.querySelector('.ui-empty-extra').children.length, 1);
  const e3 = p.UI.empty({ text: 'y', action: { label: 'z', href: 'a.html' } });
  assert.strictEqual(e3.querySelector('.ui-empty-links'), null);
  assert.strictEqual(e3.querySelector('.ui-empty-extra'), null);
  assert.ok(!e3.querySelector('.ui-empty-go').classList.contains('primary'), '預設描邊');
};

T['專心模式:action 帶 attrs、f.bar 是作答列、f.slot 放在計數左邊、enter 的 dirty 選項、回饋的 note'] = async () => {
  const p = loadPage();
  const f = p.UI.focus.enter({ total: 5, dirty: true, body: '還沒交卷', action: { label: '交卷', onClick() {}, attrs: { 'data-gate': '' } } });
  assert.strictEqual(f.bar, p.doc.querySelector('.quiz-bar'));
  assert.strictEqual(f.bar.querySelector('.quiz-act').getAttribute('data-gate'), '');
  assert.strictEqual(p.doc.body.dataset.leaveConfirm, '還沒交卷', 'dirty: true 一進來就設');
  f.action({ label: '交卷', attrs: { 'data-gate': '' } });
  assert.strictEqual(f.bar.querySelector('.quiz-act').getAttribute('data-gate'), '', '換掉時也帶');
  const timer = p.doc.createElement('span'); timer.className = 'mock-timer'; timer.textContent = '39:59';
  f.slot(timer);
  const kids = f.bar.children;
  const at = (cls) => kids.findIndex((n) => n.classList.contains(cls));
  assert.ok(at('quiz-track') < at('quiz-slot') && at('quiz-slot') < at('quiz-count') && at('quiz-count') < at('quiz-side'), '進度、倒數、計數、交卷');
  assert.strictEqual(f.bar.querySelector('.quiz-slot .mock-timer'), timer);
  f.slot(null);
  assert.strictEqual(f.bar.querySelector('.mock-timer'), null);
  f.feedback({ ok: true, note: '已移出錯題本' });
  const foot = p.doc.querySelector('.quiz-foot');
  assert.strictEqual(foot.querySelector('.quiz-fb-text').textContent, '答對');
  assert.strictEqual(foot.querySelector('.quiz-fb-note').textContent, '已移出錯題本');
  assert.strictEqual(p.doc.querySelector('.quiz-live').textContent, '答對 · 已移出錯題本', '讀屏也念那一行');
  f.feedback({ ok: false, answer: 'B' });
  assert.strictEqual(foot.querySelector('.quiz-fb-note').textContent, '', '下一題沒給 note 就清掉');
  f.foot([]);
  assert.strictEqual(foot.querySelector('.quiz-fb-note').textContent, '');
  f.leave();
  assert.strictEqual(p.doc.body.dataset.leaveConfirm, undefined);
  /* 預設不是 dirty */
  const g = p.UI.focus.enter({ total: 2 });
  assert.strictEqual(p.doc.body.dataset.leaveConfirm, undefined);
  g.leave();
};

T['專心模式的鍵盤:一般網頁輸入框聚焦、可視高度少 120 以上時加 html.ui-kb,收起或離開時拿掉'] = async () => {
  const vvOn = {};
  const vv = { height: 800, addEventListener: (t, fn) => { (vvOn[t] = vvOn[t] || []).push(fn); }, removeEventListener: (t, fn) => { vvOn[t] = (vvOn[t] || []).filter((x) => x !== fn); } };
  const p = loadPage({ extra: { visualViewport: vv, innerHeight: 800 } });
  const html = p.doc.documentElement;
  const input = p.doc.createElement('input'); p.doc.body.append(input);
  const btn = p.doc.createElement('button'); p.doc.body.append(btn);
  const resize = (h) => { vv.height = h; (vvOn.resize || []).forEach((fn) => fn()); };
  const f = p.UI.focus.enter({ total: 3 });
  input.focus();
  resize(420);
  assert.ok(html.classList.contains('ui-kb'), '輸入框聚焦、鍵盤彈出');
  resize(760);
  assert.ok(!html.classList.contains('ui-kb'), '只少 40:不是鍵盤');
  resize(420);
  btn.focus(); p.runTimers();
  assert.ok(!html.classList.contains('ui-kb'), '焦點不在輸入框');
  input.focus(); p.runTimers();
  assert.ok(html.classList.contains('ui-kb'), '焦點回來之後再看一次');
  f.leave();
  assert.ok(!html.classList.contains('ui-kb'), '離開專心模式拿掉');
  assert.strictEqual((vvOn.resize || []).length, 0, '拿掉 visualViewport 監聽');
  assert.strictEqual((p.doc.listeners.focusin || []).length, 0);
  assert.strictEqual(p.timers.size, 0);
  /* 不在專心模式:不管 */
  resize(300);
  assert.ok(!html.classList.contains('ui-kb'));
  /* 沒有 visualViewport 的瀏覽器:不掛監聽也不丟錯 */
  const p2 = loadPage();
  p2.UI.focus.enter({ total: 1 }).leave();
};

T['面板 UI.sheet:標題、小字、關閉;焦點先到 aria-current、鎖在面板裡;Esc、點遮罩、關閉鈕都關,焦點回原處;close(false) 不回;同時只開一個'] = async () => {
  const p = loadPage();
  const opener = p.doc.createElement('button'); p.doc.body.append(opener); opener.focus();
  const mk = (n, cur) => { const b = p.doc.createElement('button'); b.textContent = String(n); if (cur) b.setAttribute('aria-current', 'true'); return b; };
  const nav = p.doc.createElement('div'); nav.className = 'q-nav';
  const b1 = mk(1), b2 = mk(2, true), b3 = mk(3); nav.append(b1, b2, b3);
  let closed = 0;
  const s = p.UI.sheet({ title: '題號', note: '已作答 1 / 3', nodes: [nav, null], class: 'mock-panel', onClose: () => closed++ });
  const box = p.doc.querySelector('.ui-sheet');
  assert.strictEqual(s.el, box);
  assert.ok(box.classList.contains('modal') && box.classList.contains('mock-panel'));
  assert.strictEqual(box.getAttribute('role'), 'dialog');
  assert.strictEqual(box.getAttribute('aria-modal'), 'true');
  assert.strictEqual(box.getAttribute('aria-labelledby'), box.querySelector('.ui-sheet-h').getAttribute('id'));
  assert.strictEqual(box.querySelector('.ui-sheet-h').textContent, '題號');
  assert.strictEqual(box.querySelector('.ui-sheet-note').textContent, '已作答 1 / 3');
  assert.ok(box.querySelector('.ui-sheet-body .q-nav'));
  assert.ok(p.doc.querySelector('.modal-mask.ui-mask.ui-sheet-mask'));
  assert.strictEqual(p.doc.activeElement, b2, '焦點先到目前那一題');
  /* Tab 在最後一個 → 第一個(關閉鈕);Shift+Tab 反過來;焦點跑出去拉回來 */
  b3.focus();
  assert.ok(key(p.doc, 'Tab').defaultPrevented);
  assert.strictEqual(p.doc.activeElement, box.querySelector('.ui-sheet-close'));
  assert.ok(key(p.doc, 'Tab', true).defaultPrevented);
  assert.strictEqual(p.doc.activeElement, b3);
  opener.focus();
  assert.ok(box.contains(p.doc.activeElement));
  const esc = key(p.doc, 'Escape');
  assert.ok(esc.stopped, 'Esc 不往下傳');
  assert.strictEqual(p.doc.querySelector('.ui-sheet'), null);
  assert.strictEqual(p.doc.activeElement, opener, '焦點回原處');
  assert.strictEqual(closed, 1);
  assert.strictEqual(s.open, false);
  s.close(); assert.strictEqual(closed, 1, '關過的再關不重複');
  assert.strictEqual((p.doc.listeners.keydown || []).length, 0);
  assert.strictEqual((p.doc.listeners.focusin || []).length, 0);
  /* 點遮罩(按下也在遮罩上)、關閉鈕 */
  opener.focus();
  p.UI.sheet({ title: 'A', nodes: [] });
  const mask = p.doc.querySelector('.ui-sheet-mask');
  click(mask.querySelector('.ui-sheet-h'));
  assert.ok(p.doc.querySelector('.ui-sheet'), '點面板裡面不關');
  press(mask); click(mask);
  assert.strictEqual(p.doc.querySelector('.ui-sheet'), null);
  assert.strictEqual(p.doc.activeElement, opener);
  p.UI.sheet({ title: 'B' });
  assert.strictEqual(p.doc.activeElement, p.doc.querySelector('.ui-sheet-close'), '沒有 aria-current 時焦點在關閉');
  click(p.doc.querySelector('.ui-sheet-close'));
  assert.strictEqual(p.doc.querySelector('.ui-sheet'), null);
  /* close(false):點題號換題,焦點不回作答列;再開一個會先收掉前一個 */
  opener.focus();
  const x = p.UI.sheet({ title: 'C' });
  const y = p.UI.sheet({ title: 'D' });
  assert.strictEqual(p.doc.querySelectorAll('.ui-sheet').length, 1);
  assert.ok(!x.open && y.open);
  y.close(false);
  assert.notStrictEqual(p.doc.activeElement, opener, 'close(false) 不把焦點拉回去');
  /* 外部字串只當文字 */
  const z = p.UI.sheet({ title: '<b>x</b>', note: '<img>' });
  assert.strictEqual(p.doc.querySelector('.ui-sheet b'), null);
  z.close();
};

T['UI.mount(root):掛上 root 底下的圖示、鵜鶘、小雞;掛過的不重掛;只動 root 裡面'] = async () => {
  const pe = fakePelican(), ck = fakeChick();
  const drawn = [];
  const D = { ids: ['home'], mountAll(root) { drawn.push(root); } };
  const p = loadPage({ pelican: pe, chick: ck, loads: {}, markup(doc) { const a = doc.createElement('canvas'); a.setAttribute('data-chick', 'idle'); doc.body.append(a); } });
  p.ctx.DoodleArt = D;
  assert.strictEqual(ck.made.length, 1, '頁面載入時掛上整頁');
  const box = p.doc.createElement('section');
  const mk = (k, v, size) => { const c = p.doc.createElement('canvas'); c.setAttribute(k, v); if (size) c.setAttribute('data-size', size); box.append(c); return c; };
  mk('data-chick', 'happy', '72'); mk('data-mascot', 'read', '120'); mk('data-doodle', 'home', '40');
  const outside = p.doc.createElement('canvas'); outside.setAttribute('data-chick', 'idle'); p.doc.body.append(outside, box);
  const r = p.UI.mount(box);
  assert.strictEqual(typeof r.then, 'function', '回傳 Promise');
  assert.strictEqual(await r, true);
  assert.deepStrictEqual(ck.made.slice(1).map((a) => [a.opt.size, a.opt.pose]), [[72, 'happy']], 'root 裡的小雞(root 外面的不碰)');
  assert.deepStrictEqual(pe.made.map((a) => [a.opt.size, a.opt.pose]), [[120, 'read']]);
  assert.deepStrictEqual(drawn, [box], '圖示交給 DoodleArt 畫 root');
  assert.strictEqual(outside.getAttribute('data-chick-on'), null);
  p.UI.mount(box);
  assert.strictEqual(ck.made.length, 2, '再呼叫一次不重掛小雞');
  assert.strictEqual(pe.made.length, 1, '不重掛鵜鶘');
};

T['連點兩下不穿過:視窗打開後 400 毫秒內滑鼠點到確定不算(刪除帳號的兩層確認),鍵盤與程式呼叫照常'] = async () => {
  const p = loadPage();
  /* 滑鼠或手指的 click:detail 是點了幾下(1 以上);鍵盤 Enter、element.click() 是 0 */
  const tap = (n) => { const ev = { type: 'click', target: n, detail: 1, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (let q = n; q; q = q.parentNode) (q.on && q.on.click || []).slice().forEach((f) => f(ev)); return ev; };
  /* 真的瀏覽器裡,確定的 click 沒被擋才會送 submit */
  const press = (dlg) => { const ev = tap(dlg.querySelector('.ui-dialog-ok')); if (!ev.defaultPrevented) submit(dlg); return ev; };
  const opener = p.doc.createElement('button'); p.doc.body.append(opener); opener.focus();
  /* 照 js/profile.js 刪除帳號的寫法:第一層確定之後馬上開第二層 */
  let second = null;
  const first = p.UI.confirm({ title: '刪除帳號？', ok: '刪除', danger: true }).then((yes) => {
    if (yes) second = p.UI.confirm({ title: '刪除這個帳號？', ok: '刪除帳號', danger: true });
    return yes;
  });
  let dlg = p.doc.querySelector('.ui-dialog');
  assert.ok(press(dlg).defaultPrevented, '剛打開就點到:不算');
  assert.ok(p.doc.querySelector('.ui-dialog'), '視窗還開著');
  p.runTimers();
  assert.ok(!press(dlg).defaultPrevented, '過了 400 毫秒:照常');
  assert.strictEqual(await first, true);
  await settle();
  assert.ok(second, '第二層開了');
  dlg = p.doc.querySelector('.ui-dialog');
  assert.strictEqual(dlg.querySelector('.ui-dialog-ok').textContent, '刪除帳號');
  const ev = press(dlg);   // 連點兩下的第二下落在第二層的確定上
  assert.ok(ev.defaultPrevented, '第二層剛打開:滑鼠的第二下不算');
  assert.ok(p.doc.querySelector('.ui-dialog'), '第二層還開著,帳號沒有被刪');
  /* 鍵盤或程式呼叫(detail 0)不受影響 */
  const kb = click(dlg.querySelector('.ui-dialog-ok'));
  assert.ok(!kb.defaultPrevented, 'detail 0 照常');
  submit(dlg);
  assert.strictEqual(await second, true);
};

T['同時只開一個視窗:再開一個先把前一個當取消收掉;結束專心模式時收掉它自己開的離開確認'] = async () => {
  const p = loadPage();
  const a = p.UI.confirm({ title: 'A' });
  const b = p.UI.confirm({ title: 'B' });
  assert.strictEqual(await a, false, '前一個當取消');
  assert.strictEqual(p.doc.body.all().filter((n) => n.classList.contains('ui-dialog')).length, 1, '畫面上只有一個視窗');
  key(p.doc, 'Escape');
  assert.strictEqual(await b, false);
  assert.strictEqual((p.doc.listeners.keydown || []).length, 0, '兩個都收乾淨,沒有留下鍵盤監聽');
  /* 可以從外面收掉:cancel() 等於按取消 */
  const c = p.UI.prompt({ title: 'C', value: 'x' });
  c.cancel();
  assert.strictEqual(await c, null);
  assert.strictEqual(p.doc.querySelector('.ui-mask'), null);
  /* 專心模式的離開確認開著時,時間到(模擬考)結束專心模式:確認一起收掉,不會留在結算卡上 */
  let exited = 0;
  const f = p.UI.focus.enter({ total: 3, confirmExit: true, dirty: true, onExit: () => { exited++; } });
  click(p.doc.querySelector('.quiz-close'));
  assert.ok(p.doc.querySelector('.ui-dialog'), '作答中按關閉:先問');
  f.leave();
  await settle();
  assert.strictEqual(p.doc.querySelector('.ui-mask'), null, '離開專心模式時確認視窗一起收掉');
  assert.strictEqual(exited, 0, '收掉等於取消,不呼叫 onExit');
};

/* ---------- 執行 ---------- */
(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of Object.entries(T)) {
    try { await fn(); pass++; process.stdout.write('PASS ' + name + '\n'); }
    catch (e) { fail++; process.stdout.write('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e) + '\n'); }
  }
  process.stdout.write('\n' + pass + ' / ' + (pass + fail) + ' 通過\n');
  process.exitCode = fail ? 1 : 0;
})();
