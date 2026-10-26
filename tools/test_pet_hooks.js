/* 小雞第二階段:練習結束時領點心的掛勾(js/pet-hook.js)與各模組的呼叫點。
   用法:node tools/test_pet_hooks.js
   1. pet-hook.js 配假的 PET_STORE、假的 PET、小假 DOM:三種結束畫面文字逐字對;其他結果、逾時、丟錯都不寫字、不丟錯;
      PET_STORE.food 不是 true 時不碰 DOM;into 已經離開畫面時不寫;同一個 into 只有一個 .pet-earn。
   2. 每個呼叫點(實作契約第 7.2 節):讀原始碼確認呼叫在對的函式裡、是那個函式的最後一句、id 和 n 寫法對、
      前面有 window.PET_HOOK 的判斷;vocab.js 的 gameOver() 沒有呼叫;跟 27557eb 比,只多了這幾行,沒有刪改任何一行
      (站名改名的行,與搬家另外加的「/* 搬家」開頭整段除外)。
   3. 真的 daily-ui.js 跑在假 DOM 上:沒有掛勾或開關關著時畫面跟原本一樣;掛勾出錯(earn 丟錯、view 丟錯)時成績頁照樣畫完。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const exists = f => fs.existsSync(path.join(REPO, f));
const BASE = '27557eb';
const LATER_BASE = ['js/vocab.js', 'js/reading.js'];   // 27557eb 之後被別的功能改過的檔案(同步合併),基準在 tools/fixtures/pet_hooks_base/

/* ---------- 小假 DOM(跟 test_daily.js 同一套做法,多了 isConnected) ---------- */
function fakeDom() {
  const made = [];
  class Text { constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; } }
  class El {
    constructor(tag) {
      this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.childNodes = []; this.parentNode = null;
      this.attrs = {}; this.listeners = {}; this.style = {}; this.value = ''; this.disabled = false; this.readOnly = false; this.hidden = false;
      this._cls = new Set();
    }
    get className() { return [...this._cls].join(' '); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get classList() {
      const s = this._cls;
      return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)), contains: c => s.has(c),
        toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; if (on) s.add(c); else s.delete(c); return on; } };
    }
    get children() { return this.childNodes.filter(c => c.nodeType === 1); }
    get clientWidth() { return this._w !== undefined ? this._w : this.parentNode && this.parentNode._shrink ? 0 : this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode.clientWidth : 0; }   // 寬:自己的 _w,沒有就跟外層一樣(區塊元素);外層是置中的直排(_shrink,像 .game-over)時空的子元素縮成 0;都沒有是 0
    get isConnected() { let e = this; while (e.parentNode) e = e.parentNode; return !!e._mounted; }
    setAttribute(k, v) {
      if (k === 'class') this.className = v;
      else if (k === 'disabled') this.disabled = true;
      else if (k === 'hidden') this.hidden = true;
      else if (k === 'readonly') this.readOnly = true;
      else this.attrs[k] = String(v);
    }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { if (k === 'disabled') this.disabled = false; else if (k === 'hidden') this.hidden = false; else delete this.attrs[k]; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    fire(t, e) { (this.listeners[t] || []).slice().forEach(f => f(Object.assign({ type: t, target: this, preventDefault() {} }, e))); }
    click() { if (!this.disabled) this.fire('click'); }
    focus() { dom.activeElement = this; }
    _adopt(c) {
      if (c === null || c === undefined || typeof c !== 'object') c = new Text(String(c));
      if (c.parentNode) c.parentNode._drop(c);
      c.parentNode = this;
      return c;
    }
    _drop(c) { const i = this.childNodes.indexOf(c); if (i > -1) this.childNodes.splice(i, 1); c.parentNode = null; }
    append(...cs) { cs.forEach(c => { this.childNodes.push(this._adopt(c)); }); }
    replaceChildren(...cs) { this.childNodes.slice().forEach(c => this._drop(c)); this.append(...cs); }
    replaceWith(n) {
      const p = this.parentNode; if (!p) return;
      const node = p._adopt(n);
      p.childNodes.splice(p.childNodes.indexOf(this), 1, node);
      this.parentNode = null;
    }
    remove() { if (this.parentNode) this.parentNode._drop(this); }
    after(n) { const p = this.parentNode; if (!p) return; const node = p._adopt(n); p.childNodes.splice(p.childNodes.indexOf(this) + 1, 0, node); }
    get nextElementSibling() { const p = this.parentNode; if (!p) return null; const s = p.children; return s[s.indexOf(this) + 1] || null; }
    get textContent() { return this.childNodes.map(c => (c.nodeType === 3 ? c.data : c.textContent)).join(''); }
    set textContent(v) { this.replaceChildren(); if (String(v)) this.append(String(v)); }
    set innerHTML(v) { this.replaceChildren(); this._html = String(v); }
    get innerHTML() { return this._html || ''; }
    querySelectorAll(sel) {
      const parts = sel.trim().split(/\s+/);
      const match = (el, p) => {
        const m = /^([a-z]*)((?:\.[\w-]+)*)$/i.exec(p);
        if (!m) return false;
        if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
        return m[2].split('.').filter(Boolean).every(c => el._cls.has(c));
      };
      const out = [];
      const walk = (el) => el.children.forEach(c => {
        if (match(c, parts[parts.length - 1])) {
          let ok = true, cur = c.parentNode;
          for (let k = parts.length - 2; k >= 0 && ok; k--) {
            while (cur && cur !== this && !match(cur, parts[k])) cur = cur.parentNode;
            if (!cur || cur === this) ok = false; else cur = cur.parentNode;
          }
          if (ok) out.push(c);
        }
        walk(c);
      });
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  const byId = {};
  const dom = {
    title: '', activeElement: null, visibilityState: 'visible', listeners: {}, made,
    createElement: t => { const e = new El(t); made.push(e); return e; },
    createTextNode: t => new Text(t),
    getElementById: id => byId[id] || null,
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    fire(t) { (this.listeners[t] || []).slice().forEach(f => f({ type: t })); },
    querySelector: () => null, querySelectorAll: () => [],
    mount(id) { const e = new El('div'); e.attrs.id = id; e._mounted = true; byId[id] = e; return e; },
  };
  return dom;
}
/* DOM 序列化:標籤、class、屬性、文字,比對兩次畫出來的是不是一模一樣 */
function ser(el) {
  if (!el) return '';
  if (el.nodeType === 3) return JSON.stringify(el.data);
  const attrs = Object.keys(el.attrs).sort().map(k => k + '=' + JSON.stringify(el.attrs[k])).join(' ');
  return '<' + el.tagName + (el.className ? ' .' + el.className : '') + (attrs ? ' ' + attrs : '') + (el.disabled ? ' disabled' : '') + (el.hidden ? ' hidden' : '') + '>'
    + el.childNodes.map(ser).join('') + '</' + el.tagName + '>';
}
const tick = () => new Promise(r => setImmediate(r));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }

/* ---------- pet-hook.js 的環境 ---------- */
const FOOD_NAMES = { grain: '飼料', corn: '玉米', greens: '青江菜', pea: '豌豆', berry: '藍莓', tomato: '小番茄', melon: '西瓜', yam: '地瓜', worm: '麵包蟲' };
function hookEnv(o) {
  o = o || {};
  const dom = fakeDom();
  const timers = [];
  const warns = [];
  const calls = [];
  const ctx = {
    console: { log() {}, warn: (...a) => warns.push(a), error() {} },
    document: dom, Promise, Object, Array, JSON, Number, String, Error, TypeError,
    /* 10 秒的等候只在 fire() 時跑;比較短的(寫字前等一下)預設在下一個 task 自己跑,o.manual 時也要 fire() */
    setTimeout: (f, ms) => {
      const t = { f, ms, done: false };
      timers.push(t);
      if (!o.manual && ms < 10000) setImmediate(() => { if (!t.done) { t.done = true; f(); } });
      return t;
    },
    clearTimeout: t => { if (t) t.done = true; },
  };
  if (o.fontSize) ctx.getComputedStyle = el => ({ fontSize: o.fontSize + 'px', paddingLeft: ((el && el._padL) || 0) + 'px', paddingRight: ((el && el._padR) || 0) + 'px' });
  ctx.window = ctx;
  if (o.store !== null) {
    const name = o.name === undefined ? '小黃' : o.name;
    ctx.PET_STORE = o.store || {
      food: o.food === undefined ? true : o.food,
      view: o.view || (() => ({ status: { name } })),
      earn: o.earn || (a => { calls.push(a); return Promise.resolve('result' in o ? o.result : { result: 'got', food: 'tomato', id: 'r:a1' }); }),
    };
  }
  ctx.PET = Object.assign({ foodName: c => FOOD_NAMES[c] || '', SNACKS: Object.keys(FOOD_NAMES).slice(1) }, o.pet || {});   // SNACKS:跟 pet.js 一樣是飼料以外的點心
  vm.createContext(ctx);
  if (exists('js/pet-hook.js')) vm.runInContext(read('js/pet-hook.js'), ctx, { filename: 'pet-hook.js' });
  const root = dom.mount('root');
  const head = dom.createElement('div'); head.className = 'report-head';
  if (o.width) head._w = o.width;
  root.append(head);
  const fire = ms => timers.filter(t => !t.done && t.ms <= ms).forEach(t => { t.done = true; t.f(); });
  return { ctx, dom, root, head, timers, warns, calls, fire, H: ctx.PET_HOOK };
}
const earnP = env => env.head.querySelectorAll('p').filter(p => p.classList.contains('pet-earn'));

const T = {};

/* ================= 1. pet-hook.js ================= */
T['pet-hook.js 存在,定義 window.PET_HOOK.done'] = () => {
  const e = hookEnv();
  return { ok: !!e.H && typeof e.H.done === 'function', detail: String(e.H) };
};
T['拿到:當下在 into 最後加空的 p.pet-earn[role=status],結果回來寫「小黃拿到 1 份小番茄。」'] = async () => {
  const e = hookEnv();
  const pr = e.H.done('r:a1', { into: e.head });
  const p0 = earnP(e)[0];
  const sync = !!p0 && p0.tagName === 'P' && p0.getAttribute('role') === 'status' && p0.textContent === '' && e.head.childNodes[e.head.childNodes.length - 1] === p0;
  const r = await pr;
  return { ok: sync && p0.textContent === '小黃拿到 1 份小番茄。' && r && r.result === 'got' && e.calls.length === 1 && e.calls[0].id === 'r:a1',
    detail: [sync, p0 && p0.textContent, JSON.stringify(r), JSON.stringify(e.calls)].join(' | ') };
};
T['讀螢幕念得到:空的那一行先進畫面,至少隔 150 毫秒(另一個 task)才寫字;earn 早就回來也一樣'] = async () => {
  const e = hookEnv({ manual: true });
  const pr = e.H.done('g:ga-01', { n: 8, into: e.head });
  let r = 'pending';
  pr.then(v => { r = v; });
  await settle();
  const p = earnP(e)[0];
  const t = e.timers.find(x => x.ms >= 150 && x.ms < 10000 && !x.done);
  const emptyAfterEarn = !!p && p.textContent === '' && e.calls.length === 1 && r === 'pending';
  e.fire(149);
  await settle();
  const stillEmpty = !!p && p.textContent === '';
  e.fire(t ? t.ms : 150);
  await settle();
  return { ok: emptyAfterEarn && !!t && stillEmpty && p.textContent === '小黃拿到 1 份小番茄。' && r && r.result === 'got',
    detail: [emptyAfterEarn, t && t.ms, stillEmpty, p && p.textContent, JSON.stringify(r)].join(' | ') };
};
T['earn 比 150 毫秒慢才回來:回來就寫,不再多等'] = async () => {
  let res;
  const e = hookEnv({ manual: true, earn: () => new Promise(r => { res = r; }) });
  const pr = e.H.done('mock', { into: e.head });
  e.fire(150);
  await settle();
  res({ result: 'got', food: 'melon', id: 'mock' });
  await pr;
  const p = earnP(e)[0];
  return { ok: !!p && p.textContent === '小黃拿到 1 份西瓜。', detail: p && p.textContent };
};
T['等那 150 毫秒時那一行離開畫面:不寫字'] = async () => {
  const e = hookEnv({ manual: true });
  const pr = e.H.done('d', { into: e.head });
  await settle();
  e.head.remove();
  e.fire(150);
  const r = await pr;
  const p = e.head.querySelector('p');
  return { ok: !!p && p.textContent === '' && r && r.result === 'got', detail: p && JSON.stringify(p.textContent) };
};
T['今天的 3 份都拿了(cap):「今天的 3 份點心都拿到了，明天再來。」'] = async () => {
  const e = hookEnv({ result: { result: 'cap', food: null, id: null, left: 0 } });
  await e.H.done('mock', { into: e.head });
  const p = earnP(e)[0];
  return { ok: !!p && p.textContent === '今天的 3 份點心都拿到了，明天再來。', detail: p && p.textContent };
};
T['拿到而且知道今天還能拿幾份:「小黃拿到 1 份小番茄。今天還能拿 2 份。」;拿到第 3 份:「小黃拿到 1 份小番茄。今天的 3 份點心都拿到了。」'] = async () => {
  const e = hookEnv({ result: { result: 'got', food: 'tomato', id: 'p5', left: 2 } });
  await e.H.done('p5', { n: 10, into: e.head });
  const a = earnP(e)[0];
  const e2 = hookEnv({ result: { result: 'got', food: 'tomato', id: 'p5', left: 0 } });
  await e2.H.done('p5', { n: 10, into: e2.head });
  const b = earnP(e2)[0];
  return { ok: !!a && a.textContent === '小黃拿到 1 份小番茄。今天還能拿 2 份。' && !!b && b.textContent === '小黃拿到 1 份小番茄。今天的 3 份點心都拿到了。', detail: [a && a.textContent, b && b.textContent].join(' / ') };
};
T['同一個練習今天拿過了(dup):「這個練習今天拿過點心了，換別的練習還能拿 2 份。」;沒有 left 時只說前半句'] = async () => {
  const e = hookEnv({ result: { result: 'dup', food: null, id: null, left: 2 } });
  await e.H.done('p5', { n: 10, into: e.head });
  const a = earnP(e)[0];
  const e2 = hookEnv({ result: { result: 'dup', food: null, id: null } });
  await e2.H.done('p5', { n: 10, into: e2.head });
  const b = earnP(e2)[0];
  return { ok: !!a && a.textContent === '這個練習今天拿過點心了，換別的練習還能拿 2 份。' && !!b && b.textContent === '這個練習今天拿過點心了。' && !a.classList.contains('is-held'), detail: [a && a.textContent, b && b.textContent].join(' / ') };
};
/* 手機上那一行比一行長(審查第 3 輪 #1:375 寬時那一行 305 px,拿過了、拿到第 3 份、名字 10 個字的那幾句會折成兩行,
   只留一行的話字寫上去時下面的按鈕往下跳 24 px)。等結果的時候就照這次可能寫的最長一句留夠行數(style.minHeight,每行 1.6em),
   寫上去、沒字可寫都一直留著:按鈕不往下跳也不往上跳。這裡的版面照「每個字 1 個字寬」算(中文字剛好、數字和空白只會算多) */
const rowsOf = (t, w, fs) => Math.max(1, Math.ceil(String(t).length * fs / w));
const minRows = p => { const v = p && p.style && p.style.minHeight; return v ? Math.round(parseFloat(v) / 1.6) : 1; };
async function waitThenWrite(o, result) {
  let res;
  const e = hookEnv(Object.assign({ manual: true, earn: () => new Promise(r => { res = r; }) }, o));
  const pr = e.H.done('p5', { n: 10, into: e.head });
  const p = earnP(e)[0];
  const before = { wait: !!p && p.classList.contains('is-wait'), min: p && p.style.minHeight, rows: minRows(p) };
  res(result); await settle(); e.fire(200); await pr; await settle();
  return { p, before, after: { min: p && p.style.minHeight, rows: minRows(p), text: p ? p.textContent : '', held: !!p && p.classList.contains('is-held') } };
}
const LONG_NAME = '一二三四五六七八九十';   // 名字最多 10 個字(pet.js NAME_MAX)
const RESULTS = [
  ['拿過了', { result: 'dup', food: null, id: null, left: 2 }],
  ['拿到第 3 份', { result: 'got', food: 'berry', id: 'p5', left: 0 }],
  ['拿到第 3 份(麵包蟲)', { result: 'got', food: 'worm', id: 'p5', left: 0 }],
  ['拿到、還能拿 2 份', { result: 'got', food: 'tomato', id: 'p5', left: 2 }],
  ['3 份都拿了', { result: 'cap', food: null, id: null, left: 0 }],
  ['存滿', { result: 'full', food: 'tomato', id: null }],
];
T['手機寬(305、320、250 px):等結果時就照最長的一句留夠行數,寫上字以後高度不變,下面的按鈕不跳(拿過了、拿到第 3 份、名字 10 個字;審查第 3 輪 #1)'] = async () => {
  const bad = [];
  for (const w of [305, 320, 250]) for (const name of ['小黃', LONG_NAME]) for (const [tag, r] of RESULTS) {
    const fs = 15;
    const { before, after } = await waitThenWrite({ width: w, fontSize: fs, name }, r);
    const need = rowsOf(after.text, w, fs);
    const label = w + ' px、' + name + '、' + tag;
    if (!before.wait) bad.push(label + ':沒有先留高度');
    if (!after.text) bad.push(label + ':沒寫字');
    if (need > before.rows) bad.push(label + ':字要 ' + need + ' 行,只留了 ' + before.rows + ' 行(按鈕往下跳)');
    if (after.min !== before.min) bad.push(label + ':寫上字以後留的高度從 ' + before.min + ' 變成 ' + after.min + '(按鈕跳)');
  }
  const d = await waitThenWrite({ width: 305, fontSize: 15 }, RESULTS[0][1]);
  if (!(d.before.rows >= 2)) bad.push('305 px 拿過了那一句一定要留兩行以上,留了 ' + d.before.rows);
  return { ok: !bad.length, detail: bad.slice(0, 6).join('; ') };
};
T['寬的時候(720 px)最長的一句也放得下一行:不另外留高度(照 css 的一行);量不到寬(0)時也照 css'] = async () => {
  const a = await waitThenWrite({ width: 720, fontSize: 15, name: LONG_NAME }, RESULTS[1][1]);
  const b = await waitThenWrite({}, RESULTS[0][1]);
  return { ok: !a.before.min && !a.after.min && a.after.text !== '' && !b.before.min && !b.after.min && b.after.text !== '',
    detail: JSON.stringify([a.before, a.after, b.before, b.after]) };
};
T['手機寬留了兩行、結果沒有字(once)時一直留著(is-held,高度不變);一開始就看得出沒字(題數不夠)時不留'] = async () => {
  const a = await waitThenWrite({ width: 305, fontSize: 15, name: LONG_NAME }, { result: 'once', food: null, id: null });
  const e = hookEnv({ width: 305, fontSize: 15, pet: { ROUND_MIN: 5 } });
  await e.H.done('p5', { n: 1, into: e.head });
  const q = earnP(e)[0];
  return { ok: a.before.rows >= 2 && a.after.held && a.after.min === a.before.min && a.after.text === '' && !!q && !q.style.minHeight && !q.classList.contains('is-wait'),
    detail: JSON.stringify([a.before, a.after, q && q.style.minHeight, q && q.className]) };
};
/* 掉落通關畫面(vocab.js PET_HOOK.done('fall', { into: overlay })):.game-over 是置中的直排(align-items: center),
   空的那一行縮成 0 寬,量不到寬就只留一行;手機上字寫上去折成兩行,再挑戰一關、回單字訓練往上跳 12 px(審查第 2 輪 寬度 #1)。
   量不到自己的寬時改量外層扣掉左右 padding 的寬,照那個寬留夠行數 */
async function fallThenWrite(W, name, result) {
  let res;
  const e = hookEnv({ manual: true, fontSize: 15, name, earn: () => new Promise(r => { res = r; }) });
  const ov = e.dom.createElement('div'); ov.className = 'game-over'; ov._w = W; ov._shrink = true; ov._padL = 16; ov._padR = 16;
  const h = e.dom.createElement('h2'); h.textContent = '過關'; ov.append(h);
  e.root.append(ov);
  const pr = e.H.done('fall', { into: ov });
  const p = ov.querySelector('.pet-earn');
  const before = { wait: !!p && p.classList.contains('is-wait'), min: p && p.style.minHeight, rows: minRows(p) };
  res(result); await settle(); e.fire(200); await pr; await settle();
  return { p, before, after: { min: p && p.style.minHeight, rows: minRows(p), text: p ? p.textContent : '' } };
}
T['掉落通關畫面(.game-over 置中直排,空的那一行量起來 0 寬):手機寬照外層扣掉 padding 的寬留夠行數,寫上字後高度不變,按鈕不跳(審查第 2 輪 寬度 #1)'] = async () => {
  const bad = [];
  for (const W of [337, 352, 375]) for (const name of ['小黃', LONG_NAME]) for (const [tag, r] of RESULTS) {
    const { before, after } = await fallThenWrite(W, name, r);
    const need = rowsOf(after.text, W - 32, 15);
    const label = W + ' px、' + name + '、' + tag;
    if (!before.wait) bad.push(label + ':沒有先留高度');
    if (!after.text) bad.push(label + ':沒寫字');
    if (need > before.rows) bad.push(label + ':字要 ' + need + ' 行,只留了 ' + before.rows + ' 行(按鈕往上跳)');
    if (after.min !== before.min) bad.push(label + ':寫上字以後留的高度從 ' + before.min + ' 變成 ' + after.min);
  }
  const d = await fallThenWrite(375, '小黃', RESULTS[0][1]);
  if (!(d.before.rows >= 2)) bad.push('375 px(那一行 343 px)拿過了那一句一定要留兩行以上,留了 ' + d.before.rows);
  const z = await fallThenWrite(0, '小黃', RESULTS[0][1]);
  if (z.before.min || !z.after.text) bad.push('外層也量不到寬(0)時照 css 一行:' + JSON.stringify([z.before, z.after]));
  return { ok: !bad.length, detail: bad.slice(0, 6).join('; ') };
};
T['css:掉落通關畫面的那一行撐滿 .game-over 的寬(align-self: stretch),字照樣置中'] = () => {
  const css = read('css/style.css');
  const m = /\.game-over\s*>\s*\.pet-earn\s*\{([^}]*)\}/.exec(css);
  return { ok: !!m && /align-self\s*:\s*stretch/.test(m[1]) && /text-align\s*:\s*center/.test(m[1]), detail: m ? m[1] : '沒有 .game-over > .pet-earn' };
};
T['存滿:「小番茄已經存滿 9 份，先餵掉一些再來拿。」'] = async () => {
  const e = hookEnv({ result: { result: 'full', food: 'tomato', id: null } });
  await e.H.done('rv', { n: 10, into: e.head });
  const p = earnP(e)[0];
  return { ok: !!p && p.textContent === '小番茄已經存滿 9 份，先餵掉一些再來拿。', detail: p && p.textContent };
};
T['小雞還沒取名:用「小雞」'] = async () => {
  const e = hookEnv({ name: '', result: { result: 'got', food: 'corn', id: 'd' } });
  await e.H.done('d', { into: e.head });
  const p = earnP(e)[0];
  return { ok: !!p && p.textContent === '小雞拿到 1 份玉米。', detail: p && p.textContent };
};
T['off、once、short、bad、later、不認得的結果、不認得的食物:不寫字,也不丟錯'] = async () => {
  const bad = [];
  for (const r of [{ result: 'off' }, { result: 'once' }, { result: 'short' }, { result: 'bad' }, { result: 'later' }, { result: 'zzz' }, null, 'got',
    { result: 'got', food: 'pizza', id: 'd' }, { result: 'full', food: '', id: null }]) {
    const e = hookEnv({ result: r });
    let threw = false;
    try { await e.H.done('d', { into: e.head }); } catch (x) { threw = true; }
    const p = earnP(e)[0];
    if (threw || !p || p.textContent !== '') bad.push(JSON.stringify(r) + ' → ' + (threw ? '丟錯' : p ? JSON.stringify(p.textContent) : '沒有 p'));
  }
  return { ok: !bad.length, detail: bad.join('; ') };
};
T['只在有給 n 時才把 n 傳給 earn'] = async () => {
  const e = hookEnv();
  await e.H.done('g:ga-01', { n: 5, into: e.head });
  await e.H.done('fall', { into: e.head });
  await e.H.done('pairs');
  const [a, b, c] = e.calls;
  return { ok: e.calls.length === 3 && a.id === 'g:ga-01' && a.n === 5 && b.id === 'fall' && !('n' in b) && c.id === 'pairs' && !('n' in c),
    detail: JSON.stringify(e.calls) };
};
T['等超過 10 秒:回 null、不寫字;之後才回來的結果也不寫'] = async () => {
  let late;
  const e = hookEnv({ earn: () => new Promise(r => { late = r; }) });
  const pr = e.H.done('mock', { into: e.head });
  const t = e.timers.find(x => x.ms === 10000);
  e.fire(9999);
  let early = 'pending';
  pr.then(v => { early = v; });
  await settle();
  const stillPending = early === 'pending';
  e.fire(10000);
  const r = await pr;
  late({ result: 'got', food: 'melon', id: 'mock' });
  await settle();
  const p = earnP(e)[0];
  return { ok: !!t && stillPending && r === null && !!p && p.textContent === '', detail: [!!t, stillPending, JSON.stringify(r), p && p.textContent].join(' | ') };
};
T['結果在 10 秒內回來就清掉計時器'] = async () => {
  const e = hookEnv();
  await e.H.done('d', { into: e.head });
  const t = e.timers.find(x => x.ms === 10000);
  return { ok: !!t && t.done === true, detail: JSON.stringify(e.timers.map(x => [x.ms, x.done])) };
};
T['earn 當場丟錯:done 不丟錯、回 null、不寫字,console.warn「小雞獎勵失敗：」'] = async () => {
  const e = hookEnv({ earn: () => { throw new Error('boom'); } });
  let threw = false, r;
  try { r = await e.H.done('d', { into: e.head }); } catch (x) { threw = true; }
  const p = earnP(e)[0];
  return { ok: !threw && r === null && !!p && p.textContent === '' && e.warns.some(w => w[0] === '小雞獎勵失敗：' && w[1] && w[1].message === 'boom'),
    detail: [threw, JSON.stringify(r), JSON.stringify(e.warns.map(w => w[0]))].join(' | ') };
};
T['earn 回傳被拒絕的 Promise、或回傳不是 Promise:不丟錯、不寫字'] = async () => {
  const a = hookEnv({ earn: () => Promise.reject(new Error('net')) });
  const b = hookEnv({ earn: () => 42 });
  let threw = false, ra, rb;
  try { ra = await a.H.done('d', { into: a.head }); rb = await b.H.done('d', { into: b.head }); } catch (x) { threw = true; }
  return { ok: !threw && ra === null && rb === null && earnP(a)[0].textContent === '' && earnP(b)[0].textContent === '' && a.warns.length === 1,
    detail: [threw, JSON.stringify(ra), JSON.stringify(rb), a.warns.length].join(' | ') };
};
T['view() 丟錯時名字用「小雞」,不影響'] = async () => {
  const e = hookEnv({ view: () => { throw new Error('v'); } });
  let threw = false;
  try { await e.H.done('d', { into: e.head }); } catch (x) { threw = true; }
  const p = earnP(e)[0];
  return { ok: !threw && !!p && p.textContent === '小雞拿到 1 份小番茄。', detail: p && p.textContent };
};
T['PET_STORE 不在、food 不是 true(false、"true"、1、沒有):回 null,不碰 DOM、不呼叫 earn'] = async () => {
  const bad = [];
  for (const [label, o] of [['沒有 PET_STORE', { store: null }], ['food false', { food: false }], ['food "true"', { food: 'true' }], ['food 1', { food: 1 }], ['沒有 food', { food: undefined, store: { view: () => ({}), earn: () => { throw new Error('不該呼叫'); } } }]]) {
    const e = hookEnv(o);
    const before = e.dom.made.length;
    const r = await e.H.done('d', { into: e.head });
    if (r !== null || e.dom.made.length !== before || e.head.childNodes.length || e.calls.length) bad.push(label);
  }
  return { ok: !bad.length, detail: bad.join(', ') };
};
T['into 在結果回來前離開畫面:不寫字'] = async () => {
  let res;
  const e = hookEnv({ earn: () => new Promise(r => { res = r; }) });
  const pr = e.H.done('tq:a1', { into: e.head });
  e.head.remove();
  res({ result: 'got', food: 'tomato', id: 'tq:a1' });
  const r = await pr;
  const p = e.head.querySelector('p');
  return { ok: !!p && p.textContent === '' && r && r.result === 'got', detail: p && JSON.stringify(p.textContent) };
};
T['同一個 into 呼叫兩次只有一個 .pet-earn,文字是後來那次的'] = async () => {
  let n = 0;
  const e = hookEnv({ earn: () => Promise.resolve(n++ ? { result: 'cap' } : { result: 'got', food: 'pea', id: 'iv' }) });
  await e.H.done('iv', { n: 10, into: e.head });
  await e.H.done('g:ga-01', { n: 5, into: e.head });
  const ps = earnP(e);
  return { ok: ps.length === 1 && ps[0].textContent === '今天的 3 份點心都拿到了，明天再來。', detail: ps.length + ' ' + (ps[0] && ps[0].textContent) };
};
T['into 不是元素(null、字串、沒給):照樣領,不碰 DOM、不丟錯'] = async () => {
  const e = hookEnv();
  const before = e.dom.made.length;
  let threw = false;
  try { await e.H.done('d', { into: null }); await e.H.done('d', { into: 'x' }); await e.H.done('d'); await e.H.done('d', null); } catch (x) { threw = true; }
  return { ok: !threw && e.calls.length === 4 && e.dom.made.length === before, detail: [threw, e.calls.length, e.dom.made.length - before].join() };
};
/* 第三輪審查 #9:空的那一行不占位置,字 150 毫秒到 10 秒後才寫上去,下面的按鈕(再練一輪等)往下跳 36 px */
T['等結果的時候先留一行的高度(.is-wait),寫上字時拿掉;沒有字可寫(later、逾時)也拿掉 is-wait,但改成 is-held 保留高度(chick2 第一輪修正 #6)'] = async () => {
  const out = [];
  const e = hookEnv();
  const pr = e.H.done('r:a1', { into: e.head });
  const p = earnP(e)[0];
  const waiting = !!p && p.classList.contains('is-wait') && p.textContent === '';
  await pr;
  out.push(['拿到', waiting && p.textContent === '小黃拿到 1 份小番茄。' && !p.classList.contains('is-wait')]);
  const l = hookEnv({ result: { result: 'later' } });
  await l.H.done('d', { into: l.head });
  const lp = earnP(l)[0];
  out.push(['later', !!lp && lp.textContent === '' && !lp.classList.contains('is-wait') && lp.classList.contains('is-held')]);
  const m = hookEnv({ manual: true });
  m.ctx.PET_STORE.earn = () => new Promise(() => {});
  const mp = m.H.done('d', { into: m.head });
  const mw = earnP(m)[0].classList.contains('is-wait');
  m.fire(10000); m.fire(200);
  await mp; await settle();
  out.push(['逾時', mw && !earnP(m)[0].classList.contains('is-wait') && earnP(m)[0].classList.contains('is-held') && earnP(m)[0].textContent === '']);
  return { ok: out.every(x => x[1]), detail: JSON.stringify(out) };
};
/* chick2 第一輪修正 #6:結果是 once(重做程度檢測)、later、off 時沒有字,以前拿掉 is-wait 就收起來,下面的按鈕往上跳 34 px。
   留過一行的那一行,這個結束畫面裡就一直留著那一行的高度(is-held);空的 role=status 留著不會被念 */
T['留過高度的那一行,結果沒有字(once、later、off、出錯)時保留高度(is-held、不收起來);拿到時沒有 is-held'] = async () => {
  const out = [];
  for (const res of [{ result: 'once' }, { result: 'later' }, { result: 'off' }, null]) {
    const e = res ? hookEnv({ result: res }) : hookEnv({ earn: () => { throw new Error('boom'); } });
    const pr = e.H.done('diag', { into: e.head });
    const p = earnP(e)[0];
    const w0 = !!p && p.classList.contains('is-wait');
    await pr; await settle();
    out.push([res ? res.result : '出錯', w0 && p.textContent === '' && !p.classList.contains('is-wait') && p.classList.contains('is-held')]);
  }
  const g = hookEnv();
  await g.H.done('r:a1', { into: g.head });
  const gp = earnP(g)[0];
  out.push(['拿到', gp.textContent === '小黃拿到 1 份小番茄。' && !gp.classList.contains('is-held') && !gp.classList.contains('is-wait')]);
  return { ok: out.every(x => x[1]), detail: JSON.stringify(out) };
};
T['看得出一定沒有字的(題數少於一回合、不認得的練習):一開始就不留高度'] = async () => {
  const pet = { ROUND_MIN: 5, sourceFood: id => id !== 'zz:new' };
  const s = hookEnv({ pet, result: { result: 'short' } });
  s.H.done('g:ga-01', { n: 3, into: s.head });
  const b = hookEnv({ pet, result: { result: 'bad' } });
  b.H.done('zz:new', { into: b.head });
  const g = hookEnv({ pet });
  g.H.done('g:ga-01', { n: 5, into: g.head });
  const cls = env => earnP(env)[0].classList.contains('is-wait');
  return { ok: !cls(s) && !cls(b) && cls(g), detail: JSON.stringify([cls(s), cls(b), cls(g)]) };
};
/* 第三輪審查 #4、#5:結束的那一行要在學生眼前(對話放在最後聽的那一句下面、題庫放在成績下面),不是工具列或整塊的最後 */
T['after:那一行放在指定元素的正後面(不是 into 的最後);同一個位置再呼叫一次重用同一行'] = async () => {
  const e = hookEnv();
  const area = e.dom.createElement('div'), res = e.dom.createElement('div'), zh = e.dom.createElement('div');
  res.className = 'tq-result'; zh.className = 'tq-zh';
  area.append(res, zh); e.root.append(area);
  await e.H.done('tq:a1', { into: area, after: res });
  await e.H.done('tq:a1', { into: area, after: res });
  const kids = area.children.map(c => c.className);
  const p = area.children[1];
  return { ok: JSON.stringify(kids) === JSON.stringify(['tq-result', 'pet-earn', 'tq-zh']) && p.textContent === '小黃拿到 1 份小番茄。' && p.getAttribute('role') === 'status',
    detail: JSON.stringify(kids) };
};
T['after 不是畫面上的元素時改放進 into'] = async () => {
  const e = hookEnv();
  const loose = e.dom.createElement('div');
  await e.H.done('d', { into: e.head, after: loose });
  await e.H.done('d', { into: e.head, after: null });
  return { ok: earnP(e).length === 1 && !loose.nextElementSibling, detail: String(earnP(e).length) };
};
T['PET_HOOK 改不掉、凍結;重複載入不會丟錯也不會換掉'] = () => {
  const e = hookEnv();
  const first = e.H;
  let threw = false;
  try { vm.runInContext(read('js/pet-hook.js'), e.ctx); } catch (x) { threw = true; }
  try { e.ctx.PET_HOOK = 1; } catch (x) { /* 嚴格模式會丟,一樣算改不掉 */ }
  try { first.done = null; } catch (x) { /* 同上 */ }
  return { ok: !threw && e.ctx.PET_HOOK === first && typeof first.done === 'function' && Object.isFrozen(first), detail: [threw, e.ctx.PET_HOOK === first].join() };
};
T['pet-hook.js 不碰學生資料、網址、隨機,不用 innerHTML'] = () => {
  const s = exists('js/pet-hook.js') ? read('js/pet-hook.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '') : '';
  const bad = ['localStorage', 'sessionStorage', 'location', 'URLSearchParams', 'store.', 'CLOUD', 'Math.random', 'innerHTML', 'getParam', '.feed(', '.eat(', '.sync(']
    .filter(w => s.includes(w));
  return { ok: !!s && !bad.length, detail: bad.join(', ') || (s ? '' : '沒有檔案') };
};
T['pet-hook.js 在 800 行以內'] = () => {
  const n = exists('js/pet-hook.js') ? read('js/pet-hook.js').split('\n').length : 0;
  return { ok: n > 0 && n <= 800, detail: n + ' 行' };
};

T['style.css 檔尾有 hooks 那一塊,每一條規則都掛在 .pet-earn 上(開關關著時不會起作用)'] = () => {
  const css = read('css/style.css');
  const a = css.indexOf('/* ======== 小雞第二階段:hooks(js/pet-hook.js)開始 ======== */'), b = css.indexOf('/* ======== 小雞第二階段:hooks 結束 ======== */');
  if (a < 0 || b < a) return { ok: false, detail: '找不到那一塊' };
  const body = css.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
  const sels = [...body.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(Boolean);
  const bad = sels.filter(s => s.split(',').some(x => !x.includes('.pet-earn')));
  /* 第三輪審查 #9:等結果時留一行的高度;#4、#5:對話放在那一句下面、題庫放在成績下面 */
  const raw = css.slice(a, b);
  /* chick2 第一輪修正 #6:留過高度、結果沒有字的那一行(is-held)不收起來;#5:播放全部捲到的那一句下面留出那一行的空間 */
  const more = [/\.pet-earn \{[^}]*min-height: 1\.6em/, /\.pet-earn:empty:not\(\.is-wait\):not\(\.is-held\) \{[^}]*position: absolute[^}]*min-height: 0/,
    /:has\(> \.pet-earn\.is-wait\)/, /:has\(> \.pet-earn\.is-held\)/, /\.dlg-lines > \.pet-earn \{/, /\.tq-result \+ \.pet-earn \{/,
    /:has\(\+ \.pet-earn:empty:not\(\.is-wait\):not\(\.is-held\)\)/, /\.dlg-line:has\(\+ \.pet-earn\) \.dlg-bubble \{[^}]*scroll-margin-bottom: \d+px/].filter(r => !r.test(raw));
  return { ok: sels.length > 0 && !bad.length && !more.length, detail: bad.join(' | ') + ' 缺:' + more.map(String).join(' ') };
};

/* ================= 2. 呼叫點(讀原始碼) ================= */
/* 每一列:檔案、依序要找到的錨點(最後一個錨點所在那行開的區塊就是呼叫點所在的函式)、那一句的全文。
   區塊用縮排判斷:從錨點那一行到下一個同樣縮排、開頭是 } 的那一行。 */
const G = "if (window.PET_HOOK) PET_HOOK.done(";
const RH = "root.querySelector('.report-head')";
const SITES = [
  ['js/daily-ui.js', 'runPart summary()', ['function runPart(', 'function summary() {'], G + "'d', { into: " + RH + ' });'],
  ['js/grammar.js', 'finish()', ['function finish() {'], G + "'g:' + u.id, { n: u.quiz.length, into: tail.querySelector('.report-head') });"],
  ['js/phonics.js', 'finish()', ['function finish() {'], G + "'pn:' + u.id, { n: u.quiz.length, into: tail.querySelector('.report-head') });"],
  ['js/verbs.js', 'startQuiz summary()', ['function startQuiz(', 'function summary() {'], G + "'iv', { n: items.length, into: " + RH + ' });'],
  ['js/vocab.js', 'roundClear()', ['function roundClear() {'], G + "'fall', { into: overlay });"],
  ['js/vocab.js', 'startPairs finish()', ['function startPairs(', 'function finish() {'], G + "'pairs', { into: " + RH + ' });'],
  ['js/vocab.js', 'startToast summary()', ['function startToast(', 'function summary() {'], G + "'toast', { n: results.length, into: " + RH + ' });'],
  ['js/vocab.js', 'startMcq summary()', ['function startMcq(', 'function summary() {'], G + "'mcq', { n: list.length, into: " + RH + ' });'],
  ['js/vocab.js', 'startDrill summary()', ['function startDrill(', 'function summary() {'], G + "'ph', { n: list.length, into: " + RH + ' });'],
  ['js/reading.js', 'renderQuestions 選項 onclick', ['function renderQuestions(', 'function drawQuestion(', /onclick: \(\) => \{$/],
    "if (window.PET_HOOK && Object.keys(answers).length === a.questions.length) PET_HOOK.done('r:' + a.id, { into: list.querySelector('.drill-nav-btns') });"],
  ['js/reading.js', 'renderTransfer submit()', ['function renderTransfer(', 'function submit() {'], G + "'tq:' + a.id, { into: area, after: area.querySelector('.tq-result') });"],
  ['js/practice.js', 'startQuiz submit()(交卷後的 review)', ['function startQuiz(', 'function submit() {'],
    G + "'p' + config[0].p, { n: units.reduce((s, u, i) => s + (u.p === '5' ? [session.answers[i]] : u.item.questions.map((q, qi) => session.answers[i][qid(u.item, q, qi)])).filter(r => r && r.c > -1).length, 0), into: " + RH + ' });'],
  ['js/practice.js', 'startReview summary()', ['function startReview(', 'function summary() {'],
    G + "'pr', { n: Object.values(session).reduce((s, r) => s + (p === '5' ? 1 : Object.keys(r).length), 0), into: " + RH + ' });'],
  ['js/listening.js', 'startQuiz summary()(錯題複習)', ['function startQuiz(', 'function summary() {'],
    G + "opts.wrongOnly ? 'pr' : 'l' + config[0].p, { n: units.reduce((s, u, i) => s + (u.p === '1' || u.p === '2' ? (sess[i].answers.c > -1 ? 1 : 0) : u.item.questions.filter((q, qi) => sess[i].answers[qi] !== undefined).length), 0), into: " + RH + ' });'],
  ['js/listening.js', 'startQuiz submit()(一般練習交卷)', ['function startQuiz(', 'function submit() {'],
    G + "'l' + config[0].p, { n: units.reduce((s, u, i) => s + (u.p === '1' || u.p === '2' ? (sess[i].answers.c > -1 ? 1 : 0) : u.item.questions.filter((q, qi) => sess[i].answers[qi] !== undefined).length), 0), into: " + RH + ' });'],
  ['js/ear.js', 'summary()', ['function startRound(', 'function summary() {'], G + "'e' + sec, { n: list.length, into: " + RH + ' });'],
  ['js/review.js', 'summary()', ['function summary() {'], G + "'rv', { n: list.length, into: " + RH + ' });'],
  ['js/dialogue.js', 'markHeard()', ['function markHeard('],
    "if (window.PET_HOOK && cur && cur.id === id && cur.lines.every((l, k) => k === i || list.indexOf(k) > -1)) PET_HOOK.done('dlg:' + id, { after: root.querySelectorAll('.dlg-line')[i] });"],
  ['js/mock.js', 'submit()', ['function submit(timeUp) {'], G + "'mock', { into: " + RH + ' });'],
  ['js/diagnostic.js', '「交卷，看報告」onclick', ['function renderTest(', "class: 'btn primary',", /onclick: \(\) => \{$/], G + "'diag', { into: " + RH + ' });'],
  ['js/writing.js', '技巧課「標記讀完」onclick', ['function lessonView(', /onclick: \(\) => \{$/], "if (window.PET_HOOK && unitDone(units[idx])) PET_HOOK.done('wr:' + les.id, { into: wrap });"],
  ['js/writing.js', '句子重組答對', ['function scrambleBlock(', "if (picked.map(t => t.w).join(' ') === s.answer) {"], "if (window.PET_HOOK && unitDone({ t: 's', ref: s })) PET_HOOK.done('wr:' + s.id, { into: block });"],
  ['js/writing.js', '造句、回信、論述存檔 saveNow()', ['function writeArea(', 'function saveNow() {'], "if (window.PET_HOOK && !petWas && unitDone(petU)) PET_HOOK.done('wr:' + id, { into: savedNote.parentNode });"],
];
/* 寫作存檔要先記下寫入前是不是已經完成,所以 saveNow 在 store.set 前多一行 */
const WRITE_BEFORE = "const petU = window.PET_HOOK ? { t: Object.keys(KEYS).find(k => KEYS[k] === storeKey), ref: { id } } : null, petWas = !petU || unitDone(petU);";

const FILES = [...new Set(SITES.map(s => s[0]))];
function block(file, anchors) {
  const lines = read(file).split('\n');
  let at = -1;
  for (const a of anchors) {
    const from = at + 1;
    at = lines.findIndex((l, i) => i >= from && (a instanceof RegExp ? a.test(l.trimEnd()) : l.includes(a)));
    if (at < 0) return { err: '找不到 ' + a };
  }
  const ind = /^\s*/.exec(lines[at])[0];
  let end = at + 1;
  while (end < lines.length && !(lines[end].startsWith(ind + '}') && /^\s*$/.test(lines[end].slice(0, ind.length)))) end++;
  return { start: at, end, body: lines.slice(at + 1, end) };
}
SITES.forEach(([file, label, anchors, stmt]) => {
  T['呼叫點 ' + file + ' ' + label + ':在對的函式裡、是最後一句、id 和 n 對、有 window.PET_HOOK 判斷'] = () => {
    const b = block(file, anchors);
    if (b.err) return { ok: false, detail: b.err };
    const body = b.body.map(l => l.trim()).filter(Boolean);
    const hits = body.filter(l => l === stmt).length;
    const last = body[body.length - 1];
    return { ok: hits === 1 && last === stmt, detail: hits + ' 次;最後一句:' + last };
  };
});
T['writing.js saveNow:寫入前先記下是不是已經完成(只在有掛勾時讀),那一行在 store.set 前面'] = () => {
  const b = block('js/writing.js', ['function writeArea(', 'function saveNow() {']);
  if (b.err) return { ok: false, detail: b.err };
  const body = b.body.map(l => l.trim());
  const i = body.indexOf(WRITE_BEFORE), j = body.indexOf('store.set(storeKey, m);');
  return { ok: i > -1 && j > -1 && i === j - 1, detail: i + ' / ' + j };
};
T['vocab.js 的 gameOver()(沒命)沒有呼叫'] = () => {
  const b = block('js/vocab.js', ['function gameOver() {']);
  return { ok: !b.err && !b.body.some(l => /PET_HOOK|PET_STORE|pet-earn/.test(l)), detail: b.err || '' };
};
T['14 個模組裡每一個 PET_HOOK.done 前面都有 window.PET_HOOK 判斷,總數跟表一樣'] = () => {
  let total = 0;
  const bad = [];
  FILES.forEach(f => read(f).split('\n').forEach((l, i) => {
    if (!/PET_HOOK\.done\(/.test(l)) return;
    total++;
    if (!/^\s*if \(window\.PET_HOOK[ )&]/.test(l)) bad.push(f + ':' + (i + 1));
  }));
  return { ok: total === SITES.length && !bad.length, detail: total + ' / ' + SITES.length + ' ' + bad.join(', ') };
};
T['14 個模組都有改到(每日練習、文法、發音、動詞、單字、閱讀、題庫、聽力、聽力訓練、複習、對話、模擬考、檢測、寫作)'] = () => {
  const want = ['js/daily-ui.js', 'js/grammar.js', 'js/phonics.js', 'js/verbs.js', 'js/vocab.js', 'js/reading.js', 'js/practice.js', 'js/listening.js',
    'js/ear.js', 'js/review.js', 'js/dialogue.js', 'js/mock.js', 'js/diagnostic.js', 'js/writing.js'];
  const miss = want.filter(f => !FILES.includes(f) || !/PET_HOOK\.done\(/.test(read(f)));
  return { ok: !miss.length, detail: miss.join(', ') };
};
const MOVE_REPLACED = {
  'js/writing.js': [["    return { ta, bar: h('div', { class: 'wc-bar' }, counter, savedNote), value: () => ta.value };",
    "    return { ta, bar: h('div', null, h('div', { class: 'wc-bar' }, counter, savedNote), alt), value: () => ta.value };"]],
};
T['跟 ' + BASE + ' 比:只多了掛勾那幾行,沒有刪掉或改掉任何一行'] = () => {
  const allowed = new Set(SITES.map(s => s[3]).concat([WRITE_BEFORE]));
  const bad = [];
  let added = 0;
  FILES.forEach(f => {
    /* 之後別的功能(同步合併,2026-10-24)改過的檔案:比對基準換成 tools/fixtures/pet_hooks_base/ 裡「那一版拿掉掛勾那幾行」的樣子,
       一樣要求跟基準比只多了掛勾、沒有刪改任何一行。之後再改這幾個檔案,要重新產生基準(拿掉掛勾那幾行)並在 commit 說明 */
    const fixture = 'tools/fixtures/pet_hooks_base/' + f.split('/').pop();
    if (LATER_BASE.includes(f) && exists(fixture)) {
      const base = read(fixture).replace(/\r\n/g, '\n').split('\n');
      const cur = read(f).replace(/\r\n/g, '\n').split('\n');
      const kept = [];
      cur.forEach(l => { if (allowed.has(l.trim())) added++; else kept.push(l); });
      if (kept.join('\n') !== base.join('\n')) {
        const i = kept.findIndex((l, n) => l !== base[n]);
        bad.push(f + ' 跟 ' + fixture + ' 比,第 ' + (i + 1) + ' 行起不一樣:' + String(kept[i]).slice(0, 80));
      }
      return;
    }
    const r = spawnSync('git', ['-C', REPO, 'diff', '--no-color', '-U0', BASE, '--', f], { encoding: 'utf8' });
    if (r.status !== 0) { bad.push(f + ' git 失敗:' + (r.stderr || '').trim()); return; }
    /* 搬家(2026-10,第一輪審查):寫作與文章單字顯示「搬家留下的另一份」。那幾段整段是新加的、第一行是「/* 搬家」開頭的註解,
       只換掉 MOVE_REPLACED 列的那一行;這樣的段落不算掛勾以外的刪改。其他段落照原本的規則檢查。 */
    const hunks = [];
    r.stdout.split('\n').filter(l => !/^(\+\+\+|---) /.test(l)).forEach(l => {
      if (/^@@/.test(l)) hunks.push([]); else if (hunks.length) hunks[hunks.length - 1].push(l.replace(/\r$/, ''));
    });
    const moveHunk = h => {
      const plus = h.filter(l => l.startsWith('+')), minus = h.filter(l => l.startsWith('-'));
      const first = plus.map(l => l.slice(1).trim()).find(Boolean);
      if (!first || first.indexOf('/* 搬家') !== 0) return false;
      return minus.every(m => (MOVE_REPLACED[f] || []).some(([o, n]) => m.slice(1) === o && plus.some(p => p.slice(1) === n)));
    };
    /* 站名從刷刷英文改成衝衝英文(2026-10)那一批只換站名的行成對抵掉,不算刪改 */
    const lines = hunks.filter(h => !moveHunk(h)).reduce((a, h) => a.concat(h), []);
    const minus = lines.filter(l => l.startsWith('-'));
    const renamed = lines.filter(l => l.startsWith('+') && /衝衝英文/.test(l)).filter(l => {
      const i = minus.indexOf('-' + l.slice(1).replace(/衝衝英文/g, '刷刷英文'));
      if (i < 0) return false;
      minus.splice(i, 1);
      return true;
    });
    minus.forEach(l => bad.push(f + ' 刪改:' + l.slice(0, 80)));
    lines.filter(l => l.startsWith('+') && !renamed.includes(l)).forEach(l => {
      added++; if (!allowed.has(l.slice(1).trim())) bad.push(f + ' 多了:' + l.slice(0, 80));
    });
  });
  return { ok: !bad.length && added === allowed.size, detail: '多了 ' + added + ' 行,應該 ' + allowed.size + ' 行;' + bad.join(' | ') };
};

/* ================= 3. 真的 daily-ui.js(掛勾出錯不影響練習頁) ================= */
function commonCtx(dom, now, profile) {
  const ls = new Map();
  if (profile) ls.set('tr_current_profile', JSON.stringify(profile));
  class FakeDate extends Date {}
  FakeDate.now = () => now;
  const warns = [];
  const ctx = {
    console: { log() {}, warn: (...a) => warns.push(a), error() {} }, JSON, Date: FakeDate, Object, Array, Set, Map, Math, String, Number, Promise, URLSearchParams, Error,
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: k => { ls.delete(k); } },
    document: dom, location: { search: '?part=v' },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)), clearTimeout: t => clearTimeout(t),
  };
  ctx.window = ctx;
  ctx.CLOUD = { enabled: true, push() {} };
  ctx.scrollTo = () => {};
  ctx.addEventListener = () => {};
  ctx.Audio = class { constructor() { this.playbackRate = 1; } addEventListener() {} play() { return Promise.resolve(); } pause() {} };
  ctx.__warns = warns;
  ctx.__ls = ls;
  return ctx;
}
const DATA = (function () {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  ['data/ear.js', 'data/grammar.js', 'data/articles.js'].forEach(f => vm.runInContext(read(f), ctx));
  return ctx.TOEIC;
})();
const NOW = Date.parse('2026-10-12T10:00:00+08:00');
/* hook:'none' 不載入 pet-hook.js;其他載入真的 pet-hook.js,配上 store 指定的假 PET_STORE */
function dailyRun(o) {
  const dom = fakeDom();
  const root = dom.mount('daily-root');
  const ctx = commonCtx(dom, NOW, null);
  ctx.TOEIC = DATA;
  vm.createContext(ctx);
  vm.runInContext(read('js/common.js') + '\n;globalThis.__store = store;', ctx);
  vm.runInContext(read('js/daily.js'), ctx);
  const D = ctx.DAILY;
  let s = {};
  D.itemsFor(DATA, '2026-10-12').v.forEach((x, i) => { s = D.mark(s, '2026-10-12', 'v', x.id, i >= 1); });
  ctx.__store.set('daily_done', s);
  const lsBefore = JSON.stringify([...ctx.__ls]);
  if (o.store) ctx.PET_STORE = o.store;
  ctx.PET = { foodName: c => FOOD_NAMES[c] || '' };
  if (o.hook !== 'none' && exists('js/pet-hook.js')) vm.runInContext(read('js/pet-hook.js'), ctx);
  let threw = null;
  try { vm.runInContext(read('js/daily-ui.js'), ctx); } catch (e) { threw = e; }
  return { dom, root, ctx, threw, lsBefore };
}
/* 等結果的時候那一行多一個 is-wait(先留一行的高度,第三輪審查 #9) */
const dropEarn = html => html.replace(/<P \.pet-earn( is-wait| is-held)? role="status"><\/P>/g, '');
T['每日練習頁:沒有掛勾、或開關關著(PET_STORE.food false),成績頁一模一樣、沒有 .pet-earn、不呼叫 earn'] = async () => {
  let called = 0;
  const a = dailyRun({ hook: 'none' });
  const b = dailyRun({ store: { food: false, view: () => ({}), earn: () => { called++; return Promise.resolve({ result: 'off' }); } } });
  await settle();
  const sa = ser(a.root), sb = ser(b.root);
  return { ok: !a.threw && !b.threw && /答對 4 \/ 5/.test(a.root.textContent) && sa === sb && !/pet-earn/.test(sb) && called === 0,
    detail: [a.threw && a.threw.message, b.threw && b.threw.message, sa === sb, called].join(' | ') };
};
T['每日練習頁:開關打開時成績頁的 .report-head 裡多一行「小黃拿到 1 份玉米。」,其他不變,只寫了 pet 以外的什麼都沒有'] = async () => {
  const calls = [];
  const base = dailyRun({ hook: 'none' });
  const r = dailyRun({ store: { food: true, view: () => ({ status: { name: '小黃' } }), earn: a => { calls.push(a); return Promise.resolve({ result: 'got', food: 'corn', id: 'd' }); } } });
  await new Promise(res => setTimeout(res, 40));   // 寫字前等的 150 毫秒在這個假頁面縮成 5 毫秒
  await settle();
  const head = r.root.querySelector('.report-head');
  const p = head && head.querySelectorAll('p').find(x => x.classList.contains('pet-earn'));
  const same = dropEarn(ser(r.root).replace(/<P \.pet-earn role="status">"[^"]*"<\/P>/, '<P .pet-earn role="status"></P>')) === ser(base.root);
  return { ok: !r.threw && !!p && p.textContent === '小黃拿到 1 份玉米。' && calls.length === 1 && calls[0].id === 'd' && !('n' in calls[0]) && same
    && JSON.stringify([...r.ctx.__ls]) === r.lsBefore,
    detail: [r.threw && r.threw.message, p && p.textContent, JSON.stringify(calls), same].join(' | ') };
};
T['每日練習頁:掛勾出錯(earn 當場丟錯、view 丟錯、earn 被拒絕)時成績頁照樣畫完,不丟錯'] = async () => {
  const bad = [];
  const base = ser(dailyRun({ hook: 'none' }).root);
  for (const [label, store] of [
    ['earn 丟錯', { food: true, view: () => ({ status: { name: '小黃' } }), earn: () => { throw new Error('boom'); } }],
    ['view 丟錯、earn 拿到', { food: true, view: () => { throw new Error('v'); }, earn: () => Promise.resolve({ result: 'got', food: 'corn', id: 'd' }) }],
    ['earn 被拒絕', { food: true, view: () => ({}), earn: () => Promise.reject(new Error('net')) }],
    ['earn 是壞的', { food: true, view: () => ({}), earn: 'nope' }],
  ]) {
    const r = dailyRun({ store });
    await settle();
    const s = dropEarn(ser(r.root).replace(/<P \.pet-earn( is-wait| is-held)? role="status">"[^"]*"<\/P>/, ''));
    if (r.threw || s !== base) bad.push(label + (r.threw ? ' 丟錯:' + r.threw.message : ' 畫面不同'));
  }
  return { ok: !bad.length, detail: bad.join('; ') };
};

/* ---------- 執行 ---------- */
(async () => {
  let pass = 0, fail = 0;
  for (const [name, fn] of Object.entries(T)) {
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, detail: '丟錯:' + (e && e.message) }; }
    if (r.ok) pass++; else fail++;
    console.log((r.ok ? '通過 ' : '失敗 ') + name + (r.ok ? '' : '  ' + (r.detail || '')));
  }
  console.log('通過 ' + pass + ' / ' + (pass + fail));
  process.exit(fail ? 1 : 0);
})();
