/* 小雞第二階段的載入(Integrate):js/app-shell.js 的載入程式與每一頁 HTML 的 script 順序。
   用法:node tools/test_pet_loader.js
   - 開關都關著:App 模式每一頁、每一種「頁面上已經有什麼」的組合,載入的檔案和順序跟 27557eb 那一版的 app-shell.js 完全一樣;
     網站模式一個檔都不多載。
   - 開關打開:App 模式照實作契約第 11 節加 pet-food.js、pet-hook.js、food-art.js,PET_ROAM_V2 換成 pet-roam2.js;
     網站模式照第 7.3 節。網址參數打不開新的開關。
   - HTML:每個載入 js/cloud.js 的頁面,緊接在它前面是 js/pet-config.js、js/pet.js;首頁、「我的」不重複,
     js/pet-food.js 在 pet.js 後面,js/food-art.js 在 pet-ui.js 前面。
   LOADER_ROOT 環境變數可以指到別的資料夾(先紅後綠時拿舊版來跑)。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { execSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const ROOT = process.env.LOADER_ROOT || REPO;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NEW_SHELL = read('js/app-shell.js');
const OLD_SHELL = execSync('git show 27557eb:js/app-shell.js', { cwd: REPO, encoding: 'utf8' });

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + detail : ''));
}

/* ---------- 很小的假瀏覽器:只做 app-shell.js 用到的 ---------- */
function fakeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), kids: [], attrs: {}, cls: new Set(), style: {}, dataset: {},
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach(c => this.cls.add(c)); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.kids.push(c); if (this.onAppend) this.onAppend(c); return c; },
    append(...cs) { cs.forEach(c => this.appendChild(c)); },
    insertBefore(c) { this.kids.unshift(c); return c; },
    addEventListener() {}, removeEventListener() {}, remove() {}, focus() {},
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
  };
  el.classList = { add: c => el.cls.add(c), remove: c => el.cls.delete(c), contains: c => el.cls.has(c), toggle: (c, on) => { if (on) el.cls.add(c); else el.cls.delete(c); } };
  return el;
}
/* opt:page、standalone、tabbar(App 模式有分頁列)、cloud(頁面有 common.js 與 cloud.js)、has(頁面上已經有的全域,例如 PET)、
   config(pet-config.js 設的值;undefined 代表頁面沒有靜態載入它)、search */
function run(src, opt) {
  const added = [];
  const warns = [];
  const htmlEl = fakeEl('html');
  if (opt.standalone) { htmlEl.cls.add('is-app'); htmlEl.cls.add('app-shell'); if (opt.tabbar) htmlEl.cls.add('has-tabbar'); }
  const body = fakeEl('body');
  const win = {};
  body.onAppend = c => {
    if (c.tagName !== 'SCRIPT') return;
    added.push(c.src);
    setImmediate(() => {
      if (c.src === 'js/pet-config.js') Object.assign(win, opt.configLater || {});
      if (typeof c.onload === 'function') c.onload();
    });
  };
  const doc = {
    documentElement: htmlEl, body, referrer: '',
    createElement: t => fakeEl(t),
    querySelector: sel => (sel === '.app-tabbar' ? body.kids.filter(k => k.cls && k.cls.has('app-tabbar'))[0] || null : null),
    querySelectorAll: () => [],
    addEventListener() {}, activeElement: null, visibilityState: 'visible',
  };
  Object.assign(win, {
    document: doc, navigator: { userAgent: 'Mozilla/5.0 Chrome/130', platform: 'Win32', maxTouchPoints: 0 },
    location: { pathname: '/' + opt.page, search: opt.search || '', href: 'https://x/' + opt.page, origin: 'https://x' },
    history: { length: 1, back() {} },
    matchMedia: () => ({ matches: false }),
    addEventListener() {}, requestAnimationFrame: () => 0, scrollTo() {}, pageYOffset: 0, innerHeight: 800,
    console: { warn: (...a) => warns.push(a.join(' ')), log() {}, error() {} },
    URLSearchParams, URL, Promise, setTimeout, clearTimeout,
  });
  win.window = win;
  if (opt.cloud) { win.storageKey = k => 'tr_' + k; win.CLOUD = { user: null, enabled: false }; }
  Object.assign(win, opt.config || {});
  (opt.has || []).forEach(n => { if (n === 'PET.earn') win.PET = Object.assign(win.PET || {}, { earn() {} }); else win[n] = win[n] || {}; });
  vm.createContext(win);
  vm.runInContext(src, win);
  return new Promise(resolve => setTimeout(() => resolve({ added, warns }), 20));
}

const OFF = { PET_ON: true, PET_FOOD: false, PET_ROAM_V2: false, PET_FOOD_FROM: '' };
const FOOD = Object.assign({}, OFF, { PET_FOOD: true, PET_FOOD_FROM: '2026-11-01' });
const ROAM = Object.assign({}, OFF, { PET_ROAM_V2: true });
const BOTH = Object.assign({}, FOOD, { PET_ROAM_V2: true });
const PAGES = ['index.html', 'learn.html', 'drill.html', 'review.html', 'me.html', 'daily.html', 'grammar.html', 'practice.html', 'vocab.html',
  'reading.html', 'listening.html', 'writing.html', 'mock.html', 'diagnostic.html', 'dialogue.html', 'phonics.html', 'history.html', 'pricing.html', 'signup.html'];
/* 每一頁靜態載入了哪些(第 2 步:每個載入 cloud.js 的頁面都有 PET;首頁和「我的」另外有面板那一套) */
const STATIC = p => (p === 'index.html' || p === 'me.html' ? ['PET', 'PET.earn', 'PET_STORE', 'ChickArt', 'FoodArt', 'PET_UI'] : ['PET']);
const STATIC_OLD = p => (p === 'index.html' || p === 'me.html' ? ['PET', 'PET_STORE', 'ChickArt', 'PET_UI'] : []);

(async () => {
  /* 1. 開關都關:App 模式跟 27557eb 完全一樣 */
  {
    const diffs = [];
    let cases = 0;
    for (const page of PAGES) {
      for (const tabbar of [true, false]) {
        for (const variant of ['static-now', 'static-old', 'config-later']) {
          const has = variant === 'static-old' ? STATIC_OLD(page) : STATIC(page);
          const base = { page, standalone: true, tabbar, cloud: page !== 'pricing.html' || true, has };
          const opt = variant === 'config-later' ? Object.assign({}, base, { config: {}, configLater: OFF }) : Object.assign({}, base, { config: OFF });
          const a = await run(OLD_SHELL, opt), b = await run(NEW_SHELL, opt);
          cases++;
          if (a.added.join() !== b.added.join()) diffs.push(page + (tabbar ? '' : '(沒分頁列)') + ' ' + variant + ':舊 ' + a.added.join(',') + ' / 新 ' + b.added.join(','));
        }
      }
    }
    check('開關都關,App 模式:每一頁、有沒有分頁列、頁面上已經有什麼,載入的檔案和順序都跟 27557eb 一樣', !diffs.length, cases + ' 種' + (diffs.length ? ',不同 ' + diffs.slice(0, 3).join(' | ') : ',全部相同'));
  }
  /* 2. 開關都關:網站模式一個都不多載(加 ?pet=1 也一樣) */
  {
    const extra = [];
    for (const page of PAGES) for (const search of ['', '?pet=1']) {
      const r = await run(NEW_SHELL, { page, standalone: false, cloud: true, has: STATIC(page), config: OFF, search });
      if (r.added.length) extra.push(page + search + ':' + r.added.join(','));
    }
    check('開關都關,網站模式:每一頁都沒有多載任何檔', !extra.length, extra.length ? extra.slice(0, 3).join(' | ') : PAGES.length * 2 + ' 種都是 0 個');
  }
  /* 3. 網址參數打不開新的開關 */
  {
    const bad = [];
    for (const search of ['?PET_FOOD=1', '?food=1', '?roam=1', '?pet_roam_v2=1', '?pet=1&food=1']) {
      for (const standalone of [true, false]) {
        const page = 'learn.html';
        const r = await run(NEW_SHELL, { page, standalone, tabbar: true, cloud: true, has: STATIC(page), config: OFF, search });
        const want = standalone ? 'js/pet-store.js,js/chick-art.js,js/pet-ui.js,js/pet-roam.js' : '';
        if (r.added.join() !== want) bad.push(search + (standalone ? ' App' : ' 網站') + ':' + r.added.join(','));
      }
    }
    const count = (s, re) => (s.match(re) || []).length;
    const sameUrlUse = count(NEW_SHELL, /location\.search/g) === count(OLD_SHELL, /location\.search/g) && count(NEW_SHELL, /URLSearchParams/g) === count(OLD_SHELL, /URLSearchParams/g)
      && !/sessionStorage|localStorage/.test(NEW_SHELL.replace(/不讀寫任何瀏覽器端儲存/, ''));
    check('網址參數打不開 PET_FOOD、PET_ROAM_V2;app-shell.js 讀網址參數的地方跟 27557eb 一樣多(只有既有的 ?pet=1),也不讀儲存', !bad.length && sameUrlUse,
      bad.length ? bad.join(' | ') : '10 種都照關著,讀網址 ' + count(NEW_SHELL, /location\.search/g) + ' 處');
  }
  /* 4. 開關打開:App 模式 */
  {
    const want = {
      'FOOD learn': [FOOD, 'learn.html', 'js/pet-food.js,js/pet-store.js,js/pet-hook.js,js/chick-art.js,js/food-art.js,js/pet-ui.js,js/pet-roam.js'],
      'ROAM learn': [ROAM, 'learn.html', 'js/pet-store.js,js/chick-art.js,js/pet-ui.js,js/pet-roam2.js'],
      'BOTH learn': [BOTH, 'learn.html', 'js/pet-food.js,js/pet-store.js,js/pet-hook.js,js/chick-art.js,js/food-art.js,js/pet-ui.js,js/pet-roam2.js'],
      'BOTH index': [BOTH, 'index.html', 'js/pet-hook.js,js/pet-roam2.js'],
      'FOOD me': [FOOD, 'me.html', 'js/pet-hook.js,js/pet-roam.js'],
    };
    const bad = [];
    for (const [k, [cfg, page, list]] of Object.entries(want)) {
      const r = await run(NEW_SHELL, { page, standalone: true, tabbar: true, cloud: true, has: STATIC(page), config: cfg });
      if (r.added.join() !== list) bad.push(k + ':' + r.added.join(','));
    }
    /* pet.js 沒有靜態載入時(例如舊的 HTML 快取):pet.js、pet-food.js 都補上,順序在 pet-store.js 前面 */
    const r = await run(NEW_SHELL, { page: 'grammar.html', standalone: true, tabbar: true, cloud: true, has: [], config: {}, configLater: BOTH });
    const wantCold = 'js/pet-config.js,js/pet.js,js/pet-food.js,js/pet-store.js,js/pet-hook.js,js/chick-art.js,js/food-art.js,js/pet-ui.js,js/pet-roam2.js';
    if (r.added.join() !== wantCold) bad.push('cold:' + r.added.join(','));
    check('開關打開,App 模式:PET_FOOD 加 pet-food(pet.js 後)、pet-hook(pet-store 後)、food-art(pet-ui 前);PET_ROAM_V2 換成 pet-roam2;已經有的不重載', !bad.length, bad.length ? bad.join(' | ') : Object.keys(want).length + 1 + ' 種都對');
  }
  /* 5. 開關打開:網站模式(實作契約第 7.3 節) */
  {
    const FOODP = 'js/pet-food.js,js/pet-store.js,js/pet-hook.js';
    const want = [
      [FOOD, 'practice.html', FOODP], [FOOD, 'daily.html', FOODP], [FOOD, 'writing.html', FOODP], [FOOD, 'diagnostic.html', FOODP],
      [FOOD, 'learn.html', ''], [FOOD, 'index.html', ''], [FOOD, 'history.html', ''], [FOOD, 'review.html', FOODP],
      [ROAM, 'learn.html', 'js/pet-store.js,js/chick-art.js,js/pet-ui.js,js/pet-roam2.js'], [ROAM, 'drill.html', 'js/pet-store.js,js/chick-art.js,js/pet-ui.js,js/pet-roam2.js'],
      [ROAM, 'index.html', 'js/pet-roam2.js'], [ROAM, 'me.html', 'js/pet-roam2.js'], [ROAM, 'practice.html', ''], [ROAM, 'history.html', ''],
      [BOTH, 'review.html', 'js/pet-food.js,js/pet-store.js,js/pet-hook.js,js/chick-art.js,js/food-art.js,js/pet-ui.js,js/pet-roam2.js'],
      [BOTH, 'learn.html', 'js/pet-food.js,js/pet-store.js,js/chick-art.js,js/food-art.js,js/pet-ui.js,js/pet-roam2.js'],
      [BOTH, 'index.html', 'js/pet-roam2.js'], [BOTH, 'grammar.html', FOODP],
    ];
    const bad = [];
    for (const [cfg, page, list] of want) {
      const r = await run(NEW_SHELL, { page, standalone: false, cloud: true, has: STATIC(page), config: cfg });
      if (r.added.join() !== list) bad.push(page + ' ' + JSON.stringify({ f: cfg.PET_FOOD, r: cfg.PET_ROAM_V2 }) + ':' + r.added.join(','));
    }
    /* 總開關 PET_ON 關著、或頁面沒有 cloud.js:什麼都不載 */
    const off1 = await run(NEW_SHELL, { page: 'learn.html', standalone: false, cloud: true, has: ['PET'], config: Object.assign({}, BOTH, { PET_ON: false }) });
    const off2 = await run(NEW_SHELL, { page: 'learn.html', standalone: false, cloud: false, has: [], config: BOTH });
    if (off1.added.length || off2.added.length) bad.push('PET_ON 關或沒有 cloud.js 還是載了:' + off1.added.join(',') + ' / ' + off2.added.join(','));
    check('開關打開,網站模式:練習頁(PET_FOOD)載 pet-food、pet-store、pet-hook;學習、刷題、複習(PET_ROAM_V2)載走動和面板;首頁、「我的」只多 pet-roam2', !bad.length, bad.length ? bad.join(' | ') : want.length + 2 + ' 種都對');
  }
  /* 6. 載入失敗只 console.warn */
  {
    const src = NEW_SHELL;
    const ok = /function loadList[\s\S]{0,300}catch\(function \(err\) \{ console\.warn\('小雞載入失敗：', err\); \}\)/.test(src) && /loadWebPet\(\); \} catch \(err\) \{ console\.warn\('小雞載入失敗：', err\); \}/.test(src);
    check('載入失敗只 console.warn,不丟錯', ok);
  }
  /* 7. HTML 的 script 順序 */
  {
    const bad = [];
    let n = 0;
    for (const f of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
      const srcs = [...read(f).matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m => m[1]);
      const ci = srcs.indexOf('js/cloud.js');
      if (ci < 0) continue;
      n++;
      const special = f === 'index.html' || f === 'me.html';
      const before = special ? ['js/pet-config.js', 'js/pet.js', 'js/pet-food.js'] : ['js/pet-config.js', 'js/pet.js'];
      if (srcs.slice(ci - before.length, ci).join() !== before.join()) bad.push(f + ' cloud.js 前面是 ' + srcs.slice(Math.max(0, ci - 3), ci).join(','));
      for (const s of ['js/pet-config.js', 'js/pet.js', 'js/pet-food.js', 'js/food-art.js', 'js/pet-store.js', 'js/pet-ui.js']) {
        if (srcs.filter(x => x === s).length > 1) bad.push(f + ' 重複 ' + s);
      }
      if (special && srcs.indexOf('js/food-art.js') !== srcs.indexOf('js/pet-ui.js') - 1) bad.push(f + ' food-art.js 不在 pet-ui.js 正前面');
      if (!special && srcs.some(s => /pet-(store|ui|hook|roam2?|food)\.js|chick-art|food-art/.test(s))) bad.push(f + ' 靜態載入了第二階段或面板的檔');
    }
    check('HTML:每個載入 cloud.js 的頁面緊接在前面是 pet-config.js、pet.js;首頁和「我的」多 pet-food.js、food-art.js 在 pet-ui.js 前面、不重複', !bad.length && n >= 20, n + ' 頁' + (bad.length ? ':' + bad.slice(0, 4).join(' | ') : ''));
  }
  console.log('\n' + pass + ' / ' + (pass + fail) + ' 通過');
  process.exit(fail ? 1 : 0);
})();
