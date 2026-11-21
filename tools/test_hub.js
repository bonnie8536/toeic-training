/* 分組頁進度(js/hub.js)的測試:文法與自然發音的上課進度、主打磚的「繼續上課」、錯題本的待複習徽章、
   讀不到時維持靜態數字、只讀不寫。
   用法:node tools/test_hub.js
   js/hub.js 在 vm 裡跑,配一個很小的假 DOM 與假的 store、fetch;頁面骨架照 learn.html、drill.html 的磚。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(REPO, 'js', 'hub.js'), 'utf8');

/* ---------- 假 DOM:tag、.class、[attr="v"] 的組合 ---------- */
function makeDoc() {
  class Node {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.kids = []; this.parentNode = null; this.attrs = {}; this.className = ''; this.dataset = {}; this._text = ''; }
    get classList() { const self = this; return { contains: (c) => self.className.split(/\s+/).includes(c) }; }
    get textContent() { return this.kids.length ? this.kids.map((k) => k.textContent).join('') : this._text; }
    set textContent(v) { this.kids = []; this._text = String(v); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    append(...ns) { ns.forEach((n) => { n.parentNode = this; this.kids.push(n); }); }
    remove() { if (!this.parentNode) return; this.parentNode.kids.splice(this.parentNode.kids.indexOf(this), 1); this.parentNode = null; }
    all() { const out = []; this.kids.forEach((k) => { out.push(k); out.push(...k.all()); }); return out; }
    matches(sel) {
      const m = sel.match(/^([a-z0-9]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i);
      if (!m) return false;
      if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
      if (!m[2].split('.').filter(Boolean).every((c) => this.classList.contains(c))) return false;
      return (m[3].match(/\[[^\]]+\]/g) || []).every((a) => { const [, k, v] = a.match(/^\[([\w-]+)="([^"]*)"\]$/); return this.attrs[k] === v; });
    }
    querySelectorAll(sel) { return this.all().filter((n) => n.matches(sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  const root = new Node('html');
  const doc = {
    readyState: 'complete', documentElement: root,
    createElement: (t) => new Node(t),
    querySelectorAll: (s) => root.querySelectorAll(s), querySelector: (s) => root.querySelector(s),
    addEventListener() {},
  };
  const el = (tag, cls, attrs, text) => { const n = new Node(tag); n.className = cls || ''; Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k])); if (cls) n.attrs.class = cls; if (text !== undefined) n._text = text; return n; };
  /* 一塊磚:a.tile[href] > h2 + p (+ .tile-go) */
  function addTile(href, name, num, featured) {
    const a = el('a', 'module-card tile' + (featured ? ' tile-featured' : ''), { href });
    a.append(el('h2', '', {}, name), el('p', '', {}, num));
    if (featured) a.append(el('span', 'btn primary tile-go', {}, '開始'));
    root.append(a);
    return a;
  }
  return { doc, addTile, Node };
}

/* 假 store:讀 data 物件;set、remove 被呼叫就記下來(hub.js 只讀不寫) */
function makeStore(data) {
  const writes = [];
  return { get: (k, fb) => (Object.prototype.hasOwnProperty.call(data, k) ? JSON.parse(JSON.stringify(data[k])) : fb), set: (k) => writes.push(k), remove: (k) => writes.push(k), writes };
}

function boot(opt) {
  const d = makeDoc();
  const tiles = {};
  (opt.tiles || []).forEach(([key, href, name, num, featured]) => { tiles[key] = d.addTile(href, name, num, featured); });
  const fetches = [];
  const ctx = {
    document: d.doc, console, Promise, setTimeout,
    fetch: opt.fetch === null ? undefined : (url) => { fetches.push(url); return opt.fetch ? opt.fetch(url) : Promise.resolve({ ok: true, json: () => Promise.resolve({ retired: opt.retired || [] }) }); },
  };
  ctx.window = ctx;
  ctx.window.addEventListener = () => {};
  if (opt.store !== null) ctx.store = opt.store;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, tiles, fetches, d };
}
const LEARN = [['g', 'grammar.html', '文法基礎', '8 章 94 課', true], ['p', 'phonics.html', '自然發音', '8 章 54 課'], ['r', 'reading.html', '閱讀訓練', '40 篇文章']];
const DRILL = [['pr', 'practice.html', '題庫刷題', 'Part 1–7', true], ['w', 'review.html', '錯題本', '']];
const obj = (n, f) => { const o = {}; for (let i = 1; i <= n; i++) o[f(i)] = { ok: i % 2 === 0, t: 1000 + i }; return o; };
const text = (n) => n.querySelector('p').textContent;

const T = {};
T['沒有 store 或讀不到:磚維持靜態數字、不丟錯'] = async () => {
  const a = boot({ tiles: LEARN.concat(DRILL), store: null });
  await a.ctx.HUB.paint();
  assert.equal(text(a.tiles.g), '8 章 94 課');
  assert.equal(a.tiles.g.querySelector('.tile-go').textContent, '開始');
  const bad = { get() { throw new Error('壞掉'); }, set() { throw new Error('不該寫'); } };
  const b = boot({ tiles: LEARN.concat(DRILL), store: bad });
  await b.ctx.HUB.paint();
  assert.equal(text(b.tiles.p), '8 章 54 課');
  assert.equal(b.tiles.w.querySelector('.tile-badge'), null);
};
T['文法上過幾課:主打磚「上到第 N 課」加按鈕「繼續上課」;沒上過就維持「8 章 94 課」與「開始」'] = async () => {
  const none = boot({ tiles: LEARN, store: makeStore({}) });
  await none.ctx.HUB.paint();
  assert.equal(text(none.tiles.g), '8 章 94 課');
  assert.equal(none.tiles.g.querySelector('.tile-go').textContent, '開始');
  const st = makeStore({ grammar_done: obj(12, (i) => 'ga-' + i) });
  const h = boot({ tiles: LEARN, store: st });
  await h.ctx.HUB.paint();
  assert.equal(text(h.tiles.g), '上到第 12 課');
  assert.equal(h.tiles.g.querySelector('.tile-go').textContent, '繼續上課');
  assert.ok(h.tiles.g.querySelector('.tile-go').classList.contains('primary'), '主按鈕還是實色');
  assert.equal(text(h.tiles.r), '40 篇文章', '沒有進度的磚不動');
};
T['自然發音「上過 N / 總數 課」;記錄比總數多時最多顯示總數;重畫不會把總數讀成進度'] = async () => {
  const st = makeStore({ phonics_done: obj(7, (i) => 'pa-' + i), grammar_done: obj(120, (i) => 'g-' + i) });
  const h = boot({ tiles: LEARN, store: st });
  await h.ctx.HUB.paint();
  assert.equal(text(h.tiles.p), '上過 7 / 54 課');
  assert.equal(text(h.tiles.g), '上到第 94 課');
  await h.ctx.HUB.paint();
  assert.equal(text(h.tiles.p), '上過 7 / 54 課');
  assert.equal(h.tiles.p.dataset.total, '54');
};
T['錯題本徽章:Part 5、聽力 1、2、片語答錯的才算;模擬考答錯的那筆比較新就算、比較舊不算;題組的鍵不算;0 題不畫徽章、第二行維持空白'] = async () => {
  const data = {
    drill_p5: { 'p5-1': { ok: false, t: 10 }, 'p5-2': { ok: true, t: 10 }, 'p5-3': { ok: false, t: 10 } },
    listen_p1: { 'l1-1': { ok: false, t: 10 } },
    listen_p2: { 'l2-1': { ok: true, t: 10 } },
    mock_wrong: { 'p5-1': { c: 'A', ok: true, t: 20 }, 'p5-2': { c: 'B', ok: false, t: 20 }, 'l2-1': { c: 'A', ok: false, t: 5 }, 'p6-1:3': { c: 'A', ok: false, t: 20 }, 'l3-1:0': { c: 'A', ok: false, t: 20 } },
    phrase_drill: { 'ph-1': { ok: false, t: 1 }, 'ph-2': { ok: true, t: 1 } },
  };
  /* p5-1 已訂正(模擬考較新且答對)、p5-2 模擬考答錯較新、p5-3 答錯、l1-1 答錯、l2-1 刷題答對且比模擬考新、片語 ph-1 答錯:共 4 題 */
  const h = boot({ tiles: DRILL, store: makeStore(data) });
  await h.ctx.HUB.paint();
  const b = h.tiles.w.querySelector('.tile-badge');
  assert.ok(b, '有徽章');
  assert.equal(b.textContent, '4');
  assert.equal(b.getAttribute('aria-label'), '待複習 4 題');
  assert.equal(b.parentNode, h.tiles.w);
  assert.equal(text(h.tiles.w), '', '第二行維持空白');
  const zero = boot({ tiles: DRILL, store: makeStore({ drill_p5: { 'p5-1': { ok: true, t: 1 } } }) });
  await zero.ctx.HUB.paint();
  assert.equal(zero.tiles.w.querySelector('.tile-badge'), null);
  assert.equal(text(zero.tiles.w), '');
  assert.equal(zero.fetches.length, 0, '沒有待複習的題就不讀 data/retired.json');
};
T['已淘汰的題不算;data/retired.json 讀不到時照原本的數;超過 99 題寫「99+」;重畫不會疊兩個徽章'] = async () => {
  const data = { drill_p5: { 'p5-1': { ok: false, t: 1 }, 'p5-2': { ok: false, t: 1 }, 'p5-3': { ok: false, t: 1 } } };
  const a = boot({ tiles: DRILL, store: makeStore(data), retired: [{ id: 'p5-2' }, { id: 'zz' }, null] });
  await a.ctx.HUB.paint();
  assert.equal(a.tiles.w.querySelector('.tile-badge').textContent, '2');
  assert.deepEqual(Array.from(new Set(a.fetches)), ['data/retired.json']);
  await a.ctx.HUB.paint();
  assert.equal(a.tiles.w.querySelectorAll('.tile-badge').length, 1);
  const f = boot({ tiles: DRILL, store: makeStore(data), fetch: () => Promise.reject(new Error('離線')) });
  await f.ctx.HUB.paint();
  assert.equal(f.tiles.w.querySelector('.tile-badge').textContent, '3');
  const nf = boot({ tiles: DRILL, store: makeStore(data), fetch: null });
  await nf.ctx.HUB.paint();
  assert.equal(nf.tiles.w.querySelector('.tile-badge').textContent, '3');
  const big = {}; for (let i = 1; i <= 120; i++) big['p5-' + i] = { ok: false, t: 1 };
  const m = boot({ tiles: DRILL, store: makeStore({ drill_p5: big }) });
  await m.ctx.HUB.paint();
  assert.equal(m.tiles.w.querySelector('.tile-badge').textContent, '99+');
  assert.equal(m.tiles.w.querySelector('.tile-badge').getAttribute('aria-label'), '待複習 120 題');
};
T['只讀不寫:整個過程沒有呼叫 store.set 或 store.remove;原始碼也沒有'] = async () => {
  const st = makeStore({ grammar_done: obj(3, (i) => 'ga-' + i), drill_p5: { 'p5-1': { ok: false, t: 1 } } });
  const h = boot({ tiles: LEARN.concat(DRILL), store: st });
  await h.ctx.HUB.paint();
  assert.deepEqual(st.writes, []);
  assert.equal(/store\.(set|remove)|localStorage|sessionStorage|innerHTML|console\./.test(SRC), false);
};
T['頁面:三個分組頁都載入 js/hub.js,而且在 common.js 之後;沒有說明句'] = async () => {
  ['learn.html', 'warmup.html', 'drill.html'].forEach((f) => {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    const srcs = Array.from(src.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)).map((m) => m[1]);
    assert.ok(srcs.indexOf('js/hub.js') > srcs.indexOf('js/common.js') && srcs.indexOf('js/common.js') > -1, f + ' ' + srcs.join(' '));
    assert.ok(srcs.indexOf('js/doodle-art.js') > -1 && srcs.indexOf('js/doodle-art.js') < srcs.indexOf('js/ui.js'), f + ' 圖示要在 ui.js 前面載入');
  });
  /* 磚上的 href 要是 hub.js 找得到的寫法 */
  const learn = fs.readFileSync(path.join(REPO, 'learn.html'), 'utf8'), drill = fs.readFileSync(path.join(REPO, 'drill.html'), 'utf8');
  ['grammar.html', 'phonics.html'].forEach((h) => assert.ok(new RegExp('<a class="module-card tile[^"]*" href="' + h + '">').test(learn), h));
  assert.ok(/<a class="module-card tile" href="review\.html">/.test(drill));
};

(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of Object.entries(T)) {
    try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '  →  ' + (e && e.message)); }
  }
  console.log('\n' + pass + ' / ' + (pass + fail) + ' 通過');
  process.exit(fail ? 1 : 0);
})();
