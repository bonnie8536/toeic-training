/* 每日練習的測試(她 2026-10-12 的決定:聽寫 5 句、單字 5 題、文法 5 題,每天換題、所有人都能做)。
   用法:node tools/test_daily.js
   js/daily.js 在沒有 document、localStorage 的沙盒裡載入;記錄的路徑用真的 js/common.js(store、logAttempt)
   配假的 localStorage 與假的 CLOUD 跑,訪客與登入各一次。
   最後用 TZ=UTC 與 TZ=America/Los_Angeles 各再跑一次,確認跨日只看台北時間、不看裝置時區。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const exists = f => fs.existsSync(path.join(REPO, f));

function loadDaily() {
  const ctx = { console };
  vm.createContext(ctx);
  if (exists('js/daily.js')) vm.runInContext(read('js/daily.js'), ctx);
  return ctx.DAILY;
}
const D = loadDaily() || {};

/* 題庫資料(唯讀) */
const DATA = (function () {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  ['data/ear.js', 'data/grammar.js', 'data/articles.js'].forEach(f => vm.runInContext(read(f), ctx));
  return ctx.TOEIC;
})();

function freeze(o) {
  if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); }
  return o;
}
function tp(s) { return Date.parse(s.replace(' ', 'T') + '+08:00'); }
function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
const ids = n => Array.from({ length: n }, (_, i) => 'x-' + String(i).padStart(3, '0'));

/* 跑真的 common.js:假的 localStorage、假的 CLOUD(記下 push 了哪些鍵)。
   opt.dom 給一個假的 document(畫面測試用),opt.search 是網址的 ?part=,opt.now 是時鐘 */
function commonEnv(profileId, opt) {
  opt = opt || {};
  const ls = new Map();
  if (profileId) ls.set('tr_current_profile', JSON.stringify(profileId));
  const pushed = [];
  const clock = { t: opt.now || Date.now() };
  class FakeDate extends Date {}
  FakeDate.now = () => clock.t;
  const ctx = {
    console, JSON, Date: FakeDate, Object, Array, Set, Map, Math, String, Number, Promise, URLSearchParams,
    localStorage: {
      getItem: k => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => { ls.set(k, String(v)); },
      removeItem: k => { ls.delete(k); },
    },
    document: opt.dom || { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    location: { search: opt.search || '' },
  };
  ctx.window = ctx;
  ctx.CLOUD = { enabled: true, push: (k) => pushed.push(k) };
  if (opt.toeic) ctx.TOEIC = opt.toeic;
  vm.createContext(ctx);
  vm.runInContext(read('js/common.js') + '\n;globalThis.__api = { store, logAttempt };', ctx);
  return { ctx, ls, pushed, clock, store: ctx.__api.store, logAttempt: ctx.__api.logAttempt };
}

/* ---------- 很小的假 DOM:只做 daily-ui.js 用到的部分 ----------
   replaceChildren / append 照 DOM 規格:null 會變成文字 "null"(就是要抓這種錯) */
function fakeDom() {
  const all = [];
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
      const i = p.childNodes.indexOf(this);
      const node = p._adopt(n);
      p.childNodes.splice(p.childNodes.indexOf(this), 1, node);
      this.parentNode = null;
      void i;
    }
    remove() { if (this.parentNode) this.parentNode._drop(this); }
    get textContent() { return this.childNodes.map(c => (c.nodeType === 3 ? c.data : c.textContent)).join(''); }
    set textContent(v) { this.replaceChildren(String(v)); }
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
    title: '', activeElement: null, visibilityState: 'visible', listeners: {},
    createElement: t => { const e = new El(t); all.push(e); return e; },
    createTextNode: t => new Text(t),
    getElementById: id => byId[id] || null,
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    fire(t) { (this.listeners[t] || []).slice().forEach(f => f({ type: t })); },
    querySelector: () => null, querySelectorAll: () => [],
    mount(id) { const e = new El('div'); e.attrs.id = id; byId[id] = e; return e; },
  };
  return dom;
}
/* 看得到的字:藏起來的元素不算 */
function seen(el) {
  if (!el) return '';
  if (el.nodeType === 3) return el.data;
  if (el.hidden) return '';
  return el.childNodes.map(seen).join(el.tagName === 'DIV' || el.tagName === 'P' || el.tagName === 'LI' ? '\n' : '');
}
/* 載入 daily.js 與 daily-ui.js:mount 是 'daily-root'(daily.html)或 'daily-home'(首頁) */
function uiEnv(o) {
  const dom = fakeDom();
  const root = dom.mount(o.mount || 'daily-root');
  const audios = [];
  const env = commonEnv(o.profile || null, { dom, search: o.search || '', now: o.now, toeic: DATA });
  const ctx = env.ctx;
  ctx.scrollTo = () => {};
  const winL = {};
  ctx.addEventListener = (t, f) => { (winL[t] = winL[t] || []).push(f); };
  ctx.Audio = class {
    constructor(src) { this.src = src; this.listeners = {}; this.playbackRate = 1; this.currentTime = 0; audios.push(this); }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    fire(t) { (this.listeners[t] || []).forEach(f => f({ type: t })); }
    play() { return Promise.resolve(); }
    pause() {}
  };
  if (o.before) o.before(env);
  vm.runInContext(read('js/daily.js'), ctx);
  vm.runInContext(read('js/daily-ui.js'), ctx);
  return Object.assign(env, { dom, root, audios, D: ctx.DAILY });
}
function btnByText(root, re) { return root.querySelectorAll('button').concat(root.querySelectorAll('a')).find(b => re.test(b.textContent)); }

const T = {};

/* ---------- 台北日期 ---------- */
T['台北跨日:15:59:59Z 是當天,16:00Z 換下一天'] = () => {
  const a = D.dateOf(Date.parse('2026-10-12T15:59:59Z')), b = D.dateOf(Date.parse('2026-10-12T16:00:00Z'));
  return { ok: a === '2026-10-12' && b === '2026-10-13', detail: a + ' / ' + b };
};
T['台北凌晨換題:23:59 與 00:00 的題目不同,00:00 與 23:59 隔天以前相同'] = () => {
  const pool = ids(140);
  const a = D.pick(pool, 'd', D.dateOf(tp('2026-10-12 23:59:59')), 5);
  const b = D.pick(pool, 'd', D.dateOf(tp('2026-10-13 00:00:00')), 5);
  const c = D.pick(pool, 'd', D.dateOf(tp('2026-10-13 23:59:00')), 5);
  return { ok: a.join() !== b.join() && b.join() === c.join(), detail: a.join() + ' | ' + b.join() };
};

/* ---------- 選題 ---------- */
T['同一天同一個題庫,選出的題目每次都一樣(人人一樣)'] = () => {
  const pool = ids(140);
  const a = D.pick(pool, 'd', '2026-10-12', 5), b = D.pick(pool.slice(), 'd', '2026-10-12', 5);
  return { ok: a.length === 5 && a.join() === b.join(), detail: a.join() };
};
T['題庫順序打亂不影響選題(各裝置載入順序不同也一樣)'] = () => {
  const pool = ids(140);
  const a = D.pick(pool, 'g', '2026-10-12', 5), b = D.pick(pool.slice().reverse(), 'g', '2026-10-12', 5);
  return { ok: a.join() === b.join(), detail: a.join() + ' | ' + b.join() };
};
T['三項用不同的順序(聽寫與文法同一天不是同樣的位置)'] = () => {
  const pool = ids(140);
  const a = D.pick(pool, 'd', '2026-10-12', 5), b = D.pick(pool, 'g', '2026-10-12', 5);
  return { ok: a.join() !== b.join(), detail: a.join() + ' | ' + b.join() };
};
T['每天 5 題不重複;連續 floor(N/5) 天內不會出現重複的題'] = () => {
  const bad = [];
  [[140, 'd'], [752, 'g'], [436, 'v'], [12, 'd'], [13, 'g'], [5, 'v']].forEach(([n, part]) => {
    const pool = ids(n), W = Math.floor(n / 5);
    for (let s = 0; s < 40; s++) {
      const start = addDays('2026-10-12', s * 37 - 600);
      const seen = new Set();
      for (let i = 0; i < W; i++) {
        D.pick(pool, part, addDays(start, i), 5).forEach(x => { if (seen.has(x)) bad.push(n + part + ' ' + start + '+' + i + ' ' + x); seen.add(x); });
      }
      if (seen.size !== W * 5) bad.push(n + part + ' 數量 ' + seen.size);
    }
  });
  return { ok: !bad.length, detail: bad.slice(0, 3).join(';') || '全部不重複' };
};
T['題庫比 5 題少:有幾題給幾題,不重複;空題庫給空陣列'] = () => {
  const a = D.pick(ids(3), 'v', '2026-10-12', 5), b = D.pick([], 'v', '2026-10-12', 5);
  const c = D.pick(['a', 'a', 'b'], 'v', '2026-10-12', 5);
  return { ok: a.length === 3 && new Set(a).size === 3 && b.length === 0 && c.length === 2, detail: a.join() + ' / ' + c.join() };
};
T['每一題都會輪到(140 句聽寫 28 天剛好出完一輪)'] = () => {
  const pool = ids(140), seen = new Set();
  for (let i = 0; i < 28; i++) D.pick(pool, 'd', addDays('2026-10-12', i), 5).forEach(x => seen.add(x));
  return { ok: seen.size === 140, detail: String(seen.size) };
};
T['輸入陣列不被改動'] = () => {
  const pool = freeze(ids(30));
  D.pick(pool, 'd', '2026-10-12', 5);
  return { ok: true };
};

/* ---------- 用真的題庫組今天的題目 ---------- */
T['真的題庫:今天三項各 5 題,聽寫的音檔都在'] = () => {
  const it = D.itemsFor(DATA, '2026-10-12');
  const miss = it.d.filter(x => !exists('audio/' + x.id + '.mp3'));
  const ok = it.d.length === 5 && it.v.length === 5 && it.g.length === 5 && !miss.length
    && it.d.every(x => x.text && x.zh) && it.g.every(x => x.q && x.options.length === 4 && x.answer >= 0 && x.unit);
  return { ok, detail: it.d.map(x => x.id).join() + ' | ' + it.g.map(x => x.id).join() + ' | ' + it.v.map(x => x.id).join() };
};
T['真的題庫:單字題 4 個選項中文不重複、正解在裡面、同一天兩次一樣'] = () => {
  const bad = [];
  for (let i = 0; i < 60; i++) {
    const day = addDays('2026-10-12', i);
    const a = D.itemsFor(DATA, day).v, b = D.itemsFor(DATA, day).v;
    a.forEach((x, k) => {
      if (x.options.length !== 4 || new Set(x.options).size !== 4) bad.push(day + ' ' + x.id + ' 選項 ' + x.options.join('/'));
      if (x.options[x.a] !== x.zh) bad.push(day + ' ' + x.id + ' 正解不在');
      if (JSON.stringify(x) !== JSON.stringify(b[k])) bad.push(day + ' ' + x.id + ' 兩次不同');
    });
  }
  return { ok: !bad.length, detail: bad.slice(0, 3).join(';') || '60 天都對' };
};
T['真的題庫:文法題的 id 是「課:題號」,選項順序照原題(學習記錄才查得回來)'] = () => {
  const it = D.itemsFor(DATA, '2026-10-12').g;
  const bad = it.filter(x => {
    const [uid, qi] = x.id.split(':');
    const u = DATA.grammar.find(y => y.id === uid);
    const q = u && u.quiz[Number(qi)];
    return !q || q.q !== x.q || JSON.stringify(q.options) !== JSON.stringify(x.options) || q.answer !== x.answer;
  });
  return { ok: !bad.length, detail: it.map(x => x.id).join() };
};
T['題庫沒載入:不丟錯,該項給空陣列'] = () => {
  const it = D.itemsFor({}, '2026-10-12');
  return { ok: it.d.length === 0 && it.v.length === 0 && it.g.length === 0 };
};

/* ---------- 聽寫對答案(跟聽力訓練頁同一套規則) ---------- */
T['聽寫:大小寫、標點不計;數字可寫阿拉伯數字;多打一個字就不算全對'] = () => {
  const a = D.checkDictation('The taxi will arrive in ten minutes.', 'the taxi will arrive in 10 minutes');
  const b = D.checkDictation('The taxi will arrive in ten minutes.', 'the taxi will arrive in ten minutes now');
  const c = D.checkDictation("I have a doctor's appointment today.", 'I have a doctor’s appointment');
  return { ok: a.perfect && a.hits === 7 && !b.perfect && b.hits === 7 && !c.perfect && c.hits === 5 && c.words === 6,
    detail: JSON.stringify([a.hits, b.perfect, c.hits, c.words]) };
};

/* ---------- 完成紀錄 daily_done ---------- */
T['完成紀錄的格式:{ 台北日期: { d: { 題號: 1 或 0 } } },不改到原本的物件'] = () => {
  const prev = freeze({ '2026-10-11': { g: { 'ga-01:0': 1 } } });
  const next = D.mark(prev, '2026-10-12', 'd', 'd-01', true);
  const next2 = D.mark(next, '2026-10-12', 'd', 'd-02', false);
  const ok = JSON.stringify(next2) === JSON.stringify({ '2026-10-11': { g: { 'ga-01:0': 1 } }, '2026-10-12': { d: { 'd-01': 1, 'd-02': 0 } } });
  return { ok, detail: JSON.stringify(next2) };
};
T['同一題同一天只記第一次的對錯'] = () => {
  const a = D.mark({}, '2026-10-12', 'v', 'revenue', false);
  const b = D.mark(a, '2026-10-12', 'v', 'revenue', true);
  return { ok: b['2026-10-12'].v.revenue === 0, detail: JSON.stringify(b) };
};
T['只留最近 14 天;比今天晚 7 天以上的丟掉;壞掉的值丟掉'] = () => {
  const raw = {
    '2026-09-28': { d: { a: 1 } }, '2026-09-29': { d: { a: 1 } }, '2026-10-12': { d: { a: 1, b: 'x', c: 0 }, z: { a: 1 }, g: [] },
    '2026-10-19': { d: { a: 1 } }, '2026-10-20': { d: { a: 1 } }, 'junk': { d: { a: 1 } }, '2026-02-30': { d: { a: 1 } },
  };
  const s = D.sanitize(raw, '2026-10-12');
  const ok = JSON.stringify(Object.keys(s)) === JSON.stringify(['2026-09-29', '2026-10-12', '2026-10-19'])
    && JSON.stringify(s['2026-10-12']) === JSON.stringify({ d: { a: 1, c: 0 } });
  return { ok, detail: JSON.stringify(s) };
};
T['整個壞掉(字串、陣列、null)當成沒有紀錄,不丟錯'] = () => {
  const r = ['x', [1, 2], null, undefined, 42].map(v => JSON.stringify(D.sanitize(v, '2026-10-12')));
  return { ok: r.every(x => x === '{}'), detail: r.join(' ') };
};
T['寫入時順便清掉 14 天以前的'] = () => {
  const s = D.mark({ '2026-09-01': { d: { a: 1 } } }, '2026-10-12', 'd', 'b', true);
  return { ok: !s['2026-09-01'] && s['2026-10-12'].d.b === 1, detail: JSON.stringify(s) };
};
T['進度:三項各 5 題做完才算今日完成;昨天的不算今天'] = () => {
  let s = {};
  ['a', 'b', 'c', 'd', 'e'].forEach(x => { s = D.mark(s, '2026-10-12', 'd', x, true); s = D.mark(s, '2026-10-12', 'v', x, x !== 'a'); });
  ['a', 'b', 'c', 'd'].forEach(x => { s = D.mark(s, '2026-10-12', 'g', x, true); });
  const p1 = D.progress(s, '2026-10-12');
  s = D.mark(s, '2026-10-12', 'g', 'e', false);
  const p2 = D.progress(s, '2026-10-12');
  const p3 = D.progress(s, '2026-10-13');
  const ok = !p1.complete && p1.doneParts === 2 && p1.d.done === 5 && p1.v.ok === 4 && p1.g.done === 4
    && p2.complete && p2.doneParts === 3 && !p3.complete && p3.doneParts === 0;
  return { ok, detail: JSON.stringify([p1.doneParts, p2.doneParts, p3.doneParts]) };
};

/* ---------- 記錄路徑(真的 common.js) ---------- */
function recordAll(env, now) {
  const it = D.itemsFor(DATA, D.dateOf(now));
  let t = now;
  it.d.forEach((x, i) => { D.record({ store: env.store, log: env.logAttempt, now: env.clock.t = (t += 5000), part: 'd', item: x, typed: i ? x.text : 'wrong words' }); });
  it.v.forEach((x, i) => { D.record({ store: env.store, log: env.logAttempt, now: env.clock.t = (t += 5000), part: 'v', item: x, pick: i ? x.a : (x.a + 1) % 4 }); });
  it.g.forEach((x, i) => { D.record({ store: env.store, log: env.logAttempt, now: env.clock.t = (t += 5000), part: 'g', item: x, pick: i ? x.answer : (x.answer + 1) % 4 }); });
  return it;
}
T['訪客:寫進訪客資料夾(tr_ 開頭、沒有帳號前綴),一樣寫學習記錄'] = () => {
  const env = commonEnv(null);
  const now = tp('2026-10-12 10:00:00');
  recordAll(env, now);
  const keys = [...env.ls.keys()].sort();
  const done = JSON.parse(env.ls.get('tr_daily_done'));
  const p = D.progress(done, D.dateOf(now));
  const hist = JSON.parse(env.ls.get('tr_hist'));
  const ok = JSON.stringify(keys) === JSON.stringify(['tr_daily_done', 'tr_ear_d', 'tr_hist', 'tr_vgame_miss'])
    && p.complete && hist.length === 15;
  return { ok, detail: keys.join(',') + ' 歷程 ' + hist.length };
};
T['登入:寫進帳號資料夾 tr_u<id>_,每個鍵都交給 CLOUD.push 同步'] = () => {
  const env = commonEnv('abc');
  recordAll(env, tp('2026-10-12 10:00:00'));
  const keys = [...env.ls.keys()].filter(k => k !== 'tr_current_profile').sort();
  const pushed = [...new Set(env.pushed)].sort();
  const ok = JSON.stringify(keys) === JSON.stringify(['tr_uabc_daily_done', 'tr_uabc_ear_d', 'tr_uabc_hist', 'tr_uabc_vgame_miss'])
    && JSON.stringify(pushed) === JSON.stringify(['daily_done', 'ear_d', 'hist', 'vgame_miss']);
  return { ok, detail: keys.join(',') + ' / push ' + pushed.join(',') };
};
T['學習記錄的格式跟其他頁一樣:文法 g、單字 vq(mcq)、聽寫 ed;聽寫不帶 n'] = () => {
  const env = commonEnv(null);
  const it = recordAll(env, tp('2026-10-12 10:00:00'));
  const hist = JSON.parse(env.ls.get('tr_hist'));
  const g = hist.filter(r => r.m === 'g'), v = hist.filter(r => r.m === 'vq'), d = hist.filter(r => r.m === 'ed');
  const ok = g.length === 5 && v.length === 5 && d.length === 5
    && g[0].id === it.g[0].id && g[0].c === (it.g[0].answer + 1) % 4 && g[0].ok === false && g[1].ok === true
    && v[0].id === it.v[0].id && v[0].g === 'mcq' && Array.isArray(v[0].o) && v[0].a === it.v[0].a && v[1].ok === true
    && d[0].id === it.d[0].id && d[0].ok === false && d[1].ok === true && d.every(r => r.n === undefined && typeof r.q === 'string' && typeof r.x === 'string');
  return { ok, detail: JSON.stringify(d[0]) };
};
T['聽寫照聽力訓練頁的格式寫 ear_d;單字答錯記進漏接池、答對移出'] = () => {
  const env = commonEnv(null);
  const it = recordAll(env, tp('2026-10-12 10:00:00'));
  const ear = JSON.parse(env.ls.get('tr_ear_d'));
  const miss = JSON.parse(env.ls.get('tr_vgame_miss'));
  const ok = ear[it.d[0].id].ok === false && ear[it.d[0].id].text === 'wrong words' && ear[it.d[1].id].ok === true
    && miss[it.v[0].id] === 1 && Object.keys(miss).length === 1;
  return { ok, detail: JSON.stringify(miss) };
};
T['已經答過的題再送一次:不重寫、不多一筆學習記錄'] = () => {
  const env = commonEnv(null);
  const now = tp('2026-10-12 10:00:00');
  const x = D.itemsFor(DATA, D.dateOf(now)).g[0];
  const r1 = D.record({ store: env.store, log: env.logAttempt, now, part: 'g', item: x, pick: x.answer });
  const r2 = D.record({ store: env.store, log: env.logAttempt, now: env.clock.t = now + 5000, part: 'g', item: x, pick: x.answer });
  const hist = JSON.parse(env.ls.get('tr_hist'));
  return { ok: r1.recorded && !r2.recorded && hist.length === 1, detail: hist.length + ' 筆' };
};
T['過了午夜才交:記回題目那一天(頁面載入時的日期),隔天的進度不多算'] = () => {
  const env = commonEnv(null);
  const day = '2026-10-12';
  const x = D.itemsFor(DATA, day).g[0];
  const now = tp('2026-10-13 00:00:30');
  D.record({ store: env.store, log: env.logAttempt, now: env.clock.t = now, date: day, part: 'g', item: x, pick: x.answer });
  const done = JSON.parse(env.ls.get('tr_daily_done'));
  return { ok: done[day] && done[day].g[x.id] === 1 && !done['2026-10-13'], detail: JSON.stringify(done) };
};
T['date 給壞的值就用 now 的台北日期'] = () => {
  const env = commonEnv(null);
  const now = tp('2026-10-12 10:00:00');
  const x = D.itemsFor(DATA, '2026-10-12').g[0];
  D.record({ store: env.store, log: env.logAttempt, now: env.clock.t = now, date: '2026-13-40', part: 'g', item: x, pick: x.answer });
  const done = JSON.parse(env.ls.get('tr_daily_done'));
  return { ok: Object.keys(done).join() === '2026-10-12', detail: JSON.stringify(done) };
};
T['小雞算得到:每日練習的 15 筆照小雞的規則算 15 題'] = () => {
  const env = commonEnv(null);
  const now = tp('2026-10-12 10:00:00');
  recordAll(env, now);
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(read('js/pet.js'), ctx);
  const c = ctx.PET.countHist(JSON.parse(env.ls.get('tr_hist')));
  return { ok: c[ctx.PET.dateOf(now)] === 15, detail: JSON.stringify(c) };
};
T['已存的其他鍵一個都不動'] = () => {
  const env = commonEnv(null);
  env.ls.set('tr_drill_p5', '{"x":1}'); env.ls.set('tr_pet', '{"v":1}'); env.ls.set('tr_grammar_done', '{}');
  recordAll(env, tp('2026-10-12 10:00:00'));
  return { ok: env.ls.get('tr_drill_p5') === '{"x":1}' && env.ls.get('tr_pet') === '{"v":1}' && env.ls.get('tr_grammar_done') === '{}' };
};

/* ---------- 選題要真的打散(題號只差最後幾個字的不能排在一起) ---------- */
T['真的題庫:28 天裡同一天 5 句聽寫全是同一個程度的,不超過 2 天'] = () => {
  const lv = {};
  DATA.ear.dictation.forEach(x => { lv[x.id] = x.level; });
  let same = 0;
  for (let i = 0; i < 28; i++) {
    const d = D.itemsFor(DATA, addDays('2026-10-12', i)).d;
    if (new Set(d.map(x => lv[x.id])).size === 1) same++;
  }
  return { ok: same <= 2, detail: same + ' 天(隨機約 0.3 天)' };
};
T['真的題庫:今天的聽寫不是一串連號(題號相差 2 以內的不超過 1 組)'] = () => {
  const n = D.itemsFor(DATA, '2026-10-12').d.map(x => Number(x.id.replace(/\D/g, '')));
  let near = 0;
  n.forEach((a, i) => n.forEach((b, j) => { if (i < j && Math.abs(a - b) <= 2) near++; }));
  return { ok: near <= 1, detail: n.join(',') };
};
T['真的題庫:7 天的文法題至少來自 25 課,同一課最多 2 題'] = () => {
  const c = {};
  for (let i = 0; i < 7; i++) D.itemsFor(DATA, addDays('2026-10-12', i)).g.forEach(x => { c[x.unitId] = (c[x.unitId] || 0) + 1; });
  const max = Math.max(...Object.values(c));
  return { ok: Object.keys(c).length >= 25 && max <= 2, detail: Object.keys(c).length + ' 課,最多 ' + max };
};
T['真的題庫:150 天裡同一天有兩題同一課的,不超過 30 天'] = () => {
  let rep = 0;
  for (let i = 0; i < 150; i++) {
    const g = D.itemsFor(DATA, addDays('2026-10-12', i)).g;
    if (new Set(g.map(x => x.unitId)).size < g.length) rep++;
  }
  return { ok: rep <= 30, detail: rep + ' 天(隨機約 15.5 天)' };
};

/* ---------- 單字題的干擾選項 ---------- */
const han = s => new Set(String(s).match(/[一-鿿]/g) || []);
T['真的題庫:單字題的錯誤選項跟正解沒有共用的中文字(近義的不能當錯的)'] = () => {
  const bad = [];
  for (let i = 0; i < 90; i++) {
    const day = addDays('2026-10-12', i);
    D.itemsFor(DATA, day).v.forEach(x => {
      const a = han(x.zh);
      x.options.forEach((o, k) => { if (k !== x.a && [...han(o)].some(ch => a.has(ch))) bad.push(day + ' ' + x.id + ' ' + x.zh + ' vs ' + o); });
    });
  }
  return { ok: !bad.length, detail: bad.slice(0, 3).join(';') || '90 天都沒有' };
};
T['freight 不會拿「運送(費)」當錯的選項'] = () => {
  const pool = D.wordPool(DATA);
  const w = pool.find(x => x.answer === 'freight');
  if (!w) return { ok: false, detail: '題庫沒有 freight' };
  const bad = [];
  for (let i = 0; i < 60; i++) {
    const it = D.vocabItem(pool, w, addDays('2026-10-12', i));
    if (it.options.some((o, k) => k !== it.a && /運/.test(o))) bad.push(it.options.join('/'));
    if (it.options.length !== 4) bad.push('選項 ' + it.options.length);
  }
  return { ok: !bad.length, detail: bad[0] || '' };
};
T['題庫很小找不到夠多「不共用字」的選項時,退回只要中文不同'] = () => {
  const pool = [{ answer: 'a', zh: '貨運' }, { answer: 'b', zh: '運費' }, { answer: 'c', zh: '運送' }, { answer: 'd', zh: '貨物' }];
  const it = D.vocabItem(pool, pool[0], '2026-10-12');
  return { ok: it.options.length === 4 && it.options[it.a] === '貨運', detail: it.options.join('/') };
};

/* ---------- 記錄的邊界 ---------- */
T['頁面開著超過 7 天才交答案:今天(別的分頁、別台)的紀錄不會被刪掉'] = () => {
  const env = commonEnv(null);
  const old = '2026-10-11';
  const today = D.itemsFor(DATA, '2026-10-20').d.map(x => x.id);
  const keep = {}; today.forEach(id => { keep[id] = 1; });
  env.store.set('daily_done', { '2026-10-20': { d: keep } });
  const x = D.itemsFor(DATA, old).g[0];
  const now = Date.parse('2026-10-20T03:00:00Z');
  const r = D.record({ store: env.store, log: env.logAttempt, now: env.clock.t = now, date: old, part: 'g', item: x, pick: x.answer });
  const done = JSON.parse(env.ls.get('tr_daily_done'));
  return { ok: r.recorded && !!done['2026-10-20'] && Object.keys(done['2026-10-20'].d).length === 5 && done[old].g[x.id] === 1, detail: JSON.stringify(Object.keys(done)) };
};
T['聽寫打很長的字:學習記錄與 ear_d 只存前 300 個字元'] = () => {
  const env = commonEnv(null);
  const now = tp('2026-10-12 10:00:00');
  const x = D.itemsFor(DATA, '2026-10-12').d[0];
  D.record({ store: env.store, log: env.logAttempt, now: env.clock.t = now, part: 'd', item: x, typed: 'a'.repeat(300000) });
  const hist = JSON.parse(env.ls.get('tr_hist'));
  const ear = JSON.parse(env.ls.get('tr_ear_d'));
  return { ok: hist[0].x.length === 300 && ear[x.id].text.length === 300, detail: hist[0].x.length + ' / ' + ear[x.id].text.length };
};
T['聽寫空白不記錄(不算答過、不寫學習記錄)'] = () => {
  const env = commonEnv(null);
  const x = D.itemsFor(DATA, '2026-10-12').d[0];
  const r = D.record({ store: env.store, log: env.logAttempt, now: env.clock.t = tp('2026-10-12 10:00:00'), part: 'd', item: x, typed: '   \n ' });
  return { ok: !r.recorded && !env.ls.has('tr_hist') && !env.ls.has('tr_daily_done') };
};
T['合併雲端那一份:取聯集,同一題兩邊都有就留本機的,不改原本的物件'] = () => {
  const local = freeze({ '2026-10-12': { d: { a: 1 }, v: { w: 0 } } });
  const cloud = freeze({ '2026-10-12': { d: { a: 0, b: 1 }, g: { 'u:1': 1 } }, '2026-10-11': { v: { z: 1 } }, junk: 1 });
  const m = D.merge(local, cloud, '2026-10-12');
  const ok = JSON.stringify(m) === JSON.stringify({ '2026-10-11': { v: { z: 1 } }, '2026-10-12': { d: { a: 1, b: 1 }, v: { w: 0 }, g: { 'u:1': 1 } } });
  return { ok, detail: JSON.stringify(m) };
};

/* ---------- 畫面(假 DOM 跑真的 daily-ui.js) ---------- */
const NOW = tp('2026-10-12 10:00:00');
function preset(parts) {
  return env => {
    let s = {};
    const it = D.itemsFor(DATA, '2026-10-12');
    Object.keys(parts).forEach(p => it[p].forEach((x, i) => { if (i < parts[p].n) s = D.mark(s, '2026-10-12', p, x.id, i >= parts[p].wrong); }));
    env.store.set('daily_done', s);
  };
}
T['畫面:一項做完、三項還沒做完時,成績頁沒有 null,只有一個回每日練習,列出答錯的'] = () => {
  const ui = uiEnv({ search: '?part=v', now: NOW, before: preset({ v: { n: 5, wrong: 1 } }) });
  const t = seen(ui.root);
  const back = (t.match(/回每日練習/g) || []).length;
  const w = D.itemsFor(DATA, '2026-10-12').v[0];
  return { ok: !/null|undefined/.test(t) && back === 1 && t.includes(w.word) && t.includes(w.zh), detail: JSON.stringify(t) };
};
T['畫面:三項都做完的成績頁也沒有 null'] = () => {
  const ui = uiEnv({ search: '?part=g', now: NOW, before: preset({ d: { n: 5, wrong: 0 }, v: { n: 5, wrong: 0 }, g: { n: 5, wrong: 2 } }) });
  const t = seen(ui.root);
  const g = D.itemsFor(DATA, '2026-10-12').g[0];
  return { ok: !/null|undefined/.test(t) && /明天換新題/.test(t) && t.includes(g.options[g.answer]), detail: JSON.stringify(t) };
};
T['畫面:聽寫沒打字時對答案按不下去,按 Enter 也不記;打了字才可以'] = () => {
  const ui = uiEnv({ search: '?part=d', now: NOW });
  const ta = ui.root.querySelector('textarea');
  const btn = btnByText(ui.root, /對答案/);
  const before = btn.disabled;
  ta.value = '  '; ta.fire('input'); ta.fire('keydown', { key: 'Enter' });
  btn.click();
  const none = !ui.ls.has('tr_daily_done');
  ta.value = 'we'; ta.fire('input');
  const after = btn.disabled;
  return { ok: before && none && !after && ta.getAttribute('maxlength') === '300', detail: [before, none, after, ta.getAttribute('maxlength')].join() };
};
T['畫面:文法題答之前不顯示課名,答完有一個連到那一課的連結'] = () => {
  const ui = uiEnv({ search: '?part=g', now: NOW });
  const g = D.itemsFor(DATA, '2026-10-12').g[0];
  const t1 = seen(ui.root);
  const opts = ui.root.querySelectorAll('.opts .opt');
  opts[g.answer].click();
  const link = ui.root.querySelectorAll('a').find(a => a.getAttribute('href') === 'grammar.html?u=' + g.unitId);
  return { ok: !t1.includes(g.unit) && !!link, detail: JSON.stringify(t1.slice(0, 120)) };
};
T['畫面:音檔載不到時說要重新整理,可以跳過這句,不記成答錯'] = () => {
  const ui = uiEnv({ search: '?part=d', now: NOW });
  ui.audios[ui.audios.length - 1].fire('error');
  const t = seen(ui.root);
  const skip = btnByText(ui.root, /跳過這句/);
  if (skip) skip.click();
  const cur = ui.root.querySelectorAll('.q-nav button').findIndex(b => b.classList.contains('cur'));
  return { ok: /音檔載入失敗，請重新整理頁面。/.test(t) && !!skip && cur === 1 && !ui.ls.has('tr_daily_done'), detail: JSON.stringify(t.slice(0, 160)) + ' cur ' + cur };
};
T['畫面:跳過的那句,做完後面的會再回來'] = () => {
  const ui = uiEnv({ search: '?part=d', now: NOW });
  const it = D.itemsFor(DATA, '2026-10-12').d;
  ui.audios[ui.audios.length - 1].fire('error');
  btnByText(ui.root, /跳過這句/).click();
  for (let i = 1; i < 5; i++) {
    const ta = ui.root.querySelector('textarea');
    ta.value = it[i].text; ta.fire('input');
    ui.clock.t += 5000;
    btnByText(ui.root, /對答案/).click();
    const next = btnByText(ui.root, /下一題|看成績/);
    if (i === 4 && /看成績/.test(next.textContent)) return { ok: false, detail: '跳過的那句沒有回來' };
    next.click();
  }
  const cur = ui.root.querySelectorAll('.q-nav button').findIndex(b => b.classList.contains('cur'));
  return { ok: cur === 0, detail: 'cur ' + cur };
};
T['畫面:聽寫選的速度下一句還在,下一句時焦點在播放鍵'] = () => {
  const ui = uiEnv({ search: '?part=d', now: NOW });
  const it = D.itemsFor(DATA, '2026-10-12').d;
  const sel = ui.root.querySelector('.speed-sel');
  sel.value = '0.75'; sel.fire('change');
  const ta = ui.root.querySelector('textarea');
  ta.value = it[0].text; ta.fire('input');
  btnByText(ui.root, /對答案/).click();
  btnByText(ui.root, /下一題/).click();
  const sel2 = ui.root.querySelector('.speed-sel');
  const a = ui.audios[ui.audios.length - 1];
  const f = ui.dom.activeElement;
  return { ok: sel2 !== sel && sel2.value === '0.75' && a.playbackRate === 0.75 && !!f && f.classList.contains('player-btn'),
    detail: [sel2.value, a.playbackRate, f && f.className].join() };
};
T['畫面:首頁過了午夜回到前景,換成新的一天'] = () => {
  const ui = uiEnv({ mount: 'daily-home', now: NOW, before: preset({ d: { n: 5, wrong: 0 }, v: { n: 5, wrong: 0 }, g: { n: 5, wrong: 0 } }) });
  const t1 = seen(ui.root);
  ui.clock.t = tp('2026-10-13 07:00:00');
  ui.dom.fire('visibilitychange');
  const t2 = seen(ui.root);
  return { ok: /明天換新題/.test(t1) && !/明天換新題/.test(t2) && /0 \/ 5/.test(t2), detail: JSON.stringify(t2) };
};

function cloudPreset(local, res) {
  return env => {
    preset(local)(env);
    env.pushed.length = 0;
    env.ctx.CLOUD.readKey = k => { env.readKeys = (env.readKeys || []).concat(k); return Promise.resolve(res); };
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));
T['畫面:登入的人打開 daily.html 會併入雲端那一份,清單跟著更新'] = async () => {
  const it = D.itemsFor(DATA, '2026-10-12');
  const v = {}; it.v.forEach(x => { v[x.id] = 1; });
  const ui = uiEnv({ profile: 'abc', now: NOW, before: cloudPreset({ d: { n: 5, wrong: 0 } }, { ok: true, found: true, v: { '2026-10-12': { v } } }) });
  await tick(); await tick();
  const done = JSON.parse(ui.ls.get('tr_uabc_daily_done'));
  const t = seen(ui.root);
  return { ok: Object.keys(done['2026-10-12'].v).length === 5 && Object.keys(done['2026-10-12'].d).length === 5 && /做完 2 \/ 3 項/.test(t) && ui.pushed.includes('daily_done'),
    detail: JSON.stringify(t) };
};
T['畫面:雲端讀不到(ok:false)或內容一樣就不寫、不上傳;訪客不去讀雲端'] = async () => {
  const a = uiEnv({ profile: 'abc', now: NOW, before: cloudPreset({ d: { n: 5, wrong: 0 } }, { ok: false }) });
  const it = D.itemsFor(DATA, '2026-10-12');
  const d = {}; it.d.forEach(x => { d[x.id] = 1; });
  const b = uiEnv({ profile: 'abc', now: NOW, before: cloudPreset({ d: { n: 5, wrong: 0 } }, { ok: true, found: true, v: { '2026-10-12': { d } } }) });
  const g = uiEnv({ now: NOW, before: cloudPreset({ d: { n: 5, wrong: 0 } }, { ok: true, found: true, v: {} }) });
  await tick(); await tick();
  return { ok: !a.pushed.length && !b.pushed.length && !g.readKeys && a.readKeys.join() === 'daily_done', detail: [a.pushed.join(), b.pushed.join(), String(g.readKeys)].join(' | ') };
};

/* ---------- 頁面接線 ---------- */
T['daily.html 不在付費牆清單、不要求登入'] = () => {
  const pw = read('js/paywall.js');
  const m = /const PAID_PAGES = \[([^\]]*)\]/.exec(pw);
  const html = exists('daily.html') ? read('daily.html') : '';
  return { ok: !!m && !/daily/.test(m[1]) && !!html && !/data-require-profile/.test(html), detail: m ? m[1] : '找不到 PAID_PAGES' };
};
T['daily.html 載入題庫與 store,daily.js 在 daily-ui.js 前,paywall.js 在 cloud.js、profile.js 後'] = () => {
  const html = exists('daily.html') ? read('daily.html') : '';
  const s = Array.from(html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)).map(m => m[1]);
  const at = f => s.indexOf(f);
  const ok = ['data/ear.js', 'data/grammar.js', 'data/articles.js'].every(f => at(f) > -1 && at(f) < at('js/common.js'))
    && at('js/common.js') < at('js/cloud.js') && at('js/cloud.js') < at('js/profile.js') && at('js/profile.js') < at('js/paywall.js')
    && at('js/paywall.js') < at('js/daily.js') && at('js/daily.js') < at('js/daily-ui.js') && /id="daily-root"/.test(html);
  return { ok, detail: s.join(' ') };
};
T['首頁只載 daily.js 與 daily-ui.js,不載題庫(首頁只讀完成紀錄)'] = () => {
  const html = read('index.html');
  const s = Array.from(html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)).map(m => m[1]);
  return { ok: s.indexOf('js/daily.js') > s.indexOf('js/common.js') && s.indexOf('js/daily-ui.js') > s.indexOf('js/daily.js')
    && s.indexOf('data/ear.js') < 0 && s.indexOf('data/grammar.js') < 0, detail: s.join(' ') };
};
T['App 外殼:daily.html 有頁名、歸在首頁那一格'] = () => {
  const src = read('js/app-shell.js');
  const home = /key: 'home'[^\n]*pages: \[([^\]]*)\]/.exec(src);
  return { ok: /'daily\.html': '每日練習'/.test(src) && !!home && /'daily\.html'/.test(home[1]), detail: home ? home[1] : '' };
};
T['版面檢查與學習記錄頁都認得每日練習'] = () => {
  const cl = read('tools/check_layout.js'), hs = read('js/history.js');
  return { ok: /daily\.html/.test(cl) && /\bed: \{ label: '聽寫'/.test(hs) };
};
T['首頁有每日練習的區塊,載入 daily.js'] = () => {
  const html = read('index.html');
  return { ok: /id="daily-home"/.test(html) && /js\/daily\.js/.test(html) && /href="daily\.html\?part=d"/.test(html) };
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
console.log('TZ=' + (process.env.TZ || '本機') + ' 通過 ' + pass + ' / ' + (pass + fail));
if (!process.env.__DAILY_CHILD) {
  for (const tz of ['UTC', 'America/Los_Angeles']) {
    const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: tz, __DAILY_CHILD: '1' }), encoding: 'utf8' });
    const last = (r.stdout || '').trim().split('\n').pop();
    console.log(last);
    if (r.status !== 0) { fail++; (r.stdout || '').split('\n').filter(l => l.startsWith('失敗')).forEach(l => console.log('  ' + tz + ' ' + l)); }
  }
}
process.exit(fail ? 1 : 0);
})();
