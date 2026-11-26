/* 課程的入口:首頁「今天的課」卡(index.html 的 .home-grid 第一張)、程度結果頁(start.html)的主按鈕、課程總覽頂端那張卡(js/lessons.js 用 renderCard)。
   只有試行班的學生看得到。開關關著、名單是空的、老師、訪客:一支檔都不多載、不查班級名單、畫面一個節點都不動。
   其他登入的學生在背後判定(js/lesson-data.js 的 LESSON_DATA.pilot):確定是試行班才把課程的檔依序載進來、讀學習包、畫卡;
   不是試行班(或查不到)的人畫面跟原本一樣。
   有 plan(開過第 1 堂)而且班級在名單上的人開頁當下就知道是試行班,不等雲端、不查名單。
   這支檔只讀 store 的 plan 與 levels;其他讀寫都經過 LESSON_DATA。字串在 LESSON_CORE.TEXT(js/lesson-core.js)。
   起始程度卡(js/onboard-ui.js 的 paintHome)每次畫之前問 owns(首頁狀態):是 true 就不畫,讓給這張卡。 */
(function () {
  'use strict';

  /* ---------- 依序載入 ---------- */
  /* 動態插入的 script 執行順序不保證:一支 onload 之後才插下一支。已經有的不重載 */
  const FILES = {
    core: ['js/lesson-core.js', () => !!window.LESSON_CORE],
    data: ['js/lesson-data.js', () => !!window.LESSON_DATA],
    classes: ['js/classes.js', () => !!window.CLASSES],
    rules: ['js/lesson-rules.js', () => !!window.LESSON_RULES],
    merge: ['js/sync-merge-lesson.js', () => !!(window.SYNC_MERGE && window.SYNC_MERGE.lesson)],
    util: ['js/pack-util.js', () => !!window.PACK_UTIL],
    pack: ['js/pack-core.js', () => !!window.PACK_CORE],
  };
  const pending = new Map();
  function loadOne(name) {
    const f = FILES[name];
    if (f[1]()) return Promise.resolve();
    if (pending.has(name)) return pending.get(name);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = f[0];
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => { pending.delete(name); reject(new Error('載入失敗：' + f[0])); };
      (document.head || document.body).append(s);
    });
    pending.set(name, p);
    return p;
  }
  const chain = (names) => names.reduce((p, n) => p.then(() => loadOne(n)), Promise.resolve());
  const loadBase = () => chain(['core', 'data']);
  const loadRest = () => chain(['core', 'data', 'rules', 'merge', 'util', 'pack']);

  /* ---------- 不用連網就知道的 ---------- */
  const LEVELS = ['entry', 'threshold', 'advanced', 'high'];
  const ui = () => window.PACKS_UI;
  const ids = () => (Array.isArray(window.PACKS_PILOT_CLASSES) ? window.PACKS_PILOT_CLASSES : []);
  const switchedOn = () => ui() === 'pilot' || ui() === 'on';
  /* 可能有人看得到課程:開關開著,而且是全站開放或名單不是空的 */
  const anyone = () => switchedOn() && (ui() === 'on' || ids().length > 0);
  function cloudPid() { const p = window.__PROFILE_ID; return typeof p === 'string' && p.charAt(0) === 'c'; }
  const signedIn = () => cloudPid() || !!(window.CLOUD && CLOUD.user);
  const teacher = () => !!(window.CLOUD && CLOUD.isTeacher);
  const reloading = () => !!(window.CLOUD && CLOUD.reloading);
  const cloudReady = () => Promise.resolve(window.CLOUD ? CLOUD.ready : null).catch(() => null);
  /* 只讀這兩個鍵(js/common.js 的 store) */
  const hasStore = () => typeof store !== 'undefined' && !!store && typeof store.get === 'function';
  const READ = { plan: () => store.get('plan', null), levels: () => store.get('levels', null) };
  function readKey(k) {
    try { return hasStore() ? READ[k]() : null; } catch (e) { return null; }
  }
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  /* 上課用的級別排得出來(兩科都是四級之一);LESSON_CORE.courseLevels 載到了就用它 */
  function courseOk() {
    const lv = readKey('levels');
    if (window.LESSON_CORE) return !!LESSON_CORE.courseLevels(lv);
    return isObj(lv) && LEVELS.indexOf(lv.listening) > -1 && LEVELS.indexOf(lv.reading) > -1;
  }
  /* 有 plan 而且班級在名單上(或全站開放):開頁當下就知道是試行班 */
  function planned() {
    if (!anyone() || !cloudPid() || teacher()) return false;
    const plan = readKey('plan');
    return isObj(plan) && (ui() === 'on' || ids().indexOf(plan.classId) > -1);
  }
  let confirmed = false;   // 這一頁已經查到是試行班
  function isPilot() {
    if (!anyone() || teacher() || !signedIn()) return false;
    if (confirmed || planned()) return true;
    try { return !!window.LESSON_DATA && LESSON_DATA.pilotNow().state === 'pilot'; } catch (e) { return false; }
  }

  /* ---------- 判定試行班 ---------- */
  const none = (state) => ({ state, classId: null });
  let readyRun = null;
  /* 開關關、名單空、老師、訪客不載任何檔;其他人先載 lesson-core.js、lesson-data.js,沒有快取時再載 classes.js 查一次名單 */
  async function decide() {
    if (!switchedOn()) return none('off');
    if (!planned()) {
      await cloudReady();   // 老師身分、登入在 CLOUD.ready 之後才確定
      if (reloading()) return none('checking');
      if (!signedIn()) return none('guest');
      if (teacher()) return none('teacher');
      if (!anyone()) return none('no');
    }
    await loadBase();
    if (LESSON_DATA.pilotNow().state === 'checking') await loadOne('classes');
    return LESSON_DATA.pilot();
  }
  /* → Promise<{ state, classId }>(同 LESSON_DATA.pilot;查名單逾時 8 秒算 unknown)。同一頁只判一次 */
  function ready() {
    if (!readyRun) {
      readyRun = decide().then((p) => { if (p && p.state === 'pilot') confirmed = true; return p; }, (e) => {
        console.error('判定課程的資格失敗：', e);
        return none('unknown');
      });
    }
    return readyRun;
  }

  /* ---------- 課程進度 ---------- */
  const nowSec = () => Math.floor(Date.now() / 1000);
  /* { packs, levels, states, unlock, lessonOf };沒有起始程度回 null;學習包讀不到時丟錯。
     opt.local:只用本機的進度;沒給時再從下一堂起一堂一堂跟雲端合併(讀到上完了就往後一堂),直到沒上完的那一堂 */
  async function course(opt) {
    const D = window.LESSON_DATA, P = window.PACK_CORE;
    const levels = D.levels();
    if (!levels) return null;
    const packs = (await D.packs({ lite: true })).packs;
    const today = P.dayOf(nowSec());
    let states = D.states();
    let unlock = P.unlockState({ packs, levels, states, today });
    for (let n = 0; !(opt && opt.local) && unlock.next !== null && n < 24; n++) {
      const no = unlock.next;
      const r = await D.open(no);
      if (r && r.state) states = Object.assign({}, states, { [no]: r.state });
      unlock = P.unlockState({ packs, levels, states, today });
      if (!(r && r.state && r.state.doneAt)) break;
    }
    /* 做過的堂照那一堂自己的級別拼(兩台級別不同時以進度裡的為準) */
    const lessonOf = (no) => {
      const lv = states[no] && isObj(states[no].levels) ? states[no].levels : levels;
      try { return P.compose(packs, lv, no); } catch (e) { return P.compose(packs, levels, no); }
    };
    return { packs, levels, states, unlock, lessonOf };
  }
  const modelOf = (c, onLessons) => LESSON_CORE.homeModel({ unlock: c.unlock, states: c.states, lessonOf: c.lessonOf, onLessons: !!onLessons });

  /* ---------- 卡片 ---------- */
  /* model:LESSON_CORE.homeModel 的結果,或 { kind: 'loading' }、{ kind: 'failed' }。
     opt.onLessons:課程總覽頂端(沒有右上的連結);opt.onRetry:「重試」按下去做什麼。回 section(插進頁面後再 UI.mount) */
  function renderCard(model, opt) {
    const o = opt || {}, m = model || { kind: 'loading' }, T = LESSON_CORE.TEXT.home;
    const wait = m.kind === 'loading', failed = m.kind === 'failed';
    const pose = wait ? null : failed ? 'sleep' : m.pose;
    const all = !o.onLessons && typeof m.done === 'number'
      ? h('a', { class: 'lsn-home-all', href: 'lessons.html', 'aria-label': T.doneLabel(m.done) }, T.done(m.done)) : null;
    const head = m.kicker || all ? h('div', { class: 'lsn-home-head' }, m.kicker ? h('p', { class: 'lsn-kicker' }, m.kicker) : null, all) : null;
    const tags = Array.isArray(m.tags) && m.tags.length ? h('p', { class: 'mock-tags' }, m.tags.map((t) => h('span', { class: 'mock-tag' }, t))) : null;
    const main = h('div', { class: 'lsn-home-main' }, head, h('h2', { id: 'lsn-home-h', tabindex: '-1' }, wait || failed ? T.course : m.title), tags);
    let act = null;
    if (wait) act = h('div', { class: 'lsn-home-act' }, h('p', { class: 'result-note lsn-home-note', role: 'status' }, T.loading));
    else if (failed) {
      act = h('div', { class: 'lsn-home-act' }, h('p', { class: 'lsn-home-note' }, T.failed),
        h('button', { class: 'btn lsn-home-retry', type: 'button', onclick: () => { if (typeof o.onRetry === 'function') o.onRetry(); } }, T.retry));
    } else if (m.href && m.label) act = h('a', { class: 'btn primary lsn-home-go', href: m.href }, m.label);
    return h('section', { class: 'daily-card lsn-home', 'aria-labelledby': 'lsn-home-h', 'data-nosnippet': '' },
      pose ? h('canvas', { class: 'lsn-home-art', 'data-mascot': pose, 'data-size': '72', 'aria-hidden': 'true' }) : null, main, act);
  }

  /* ---------- 首頁 ---------- */
  const BLOCKED = { B: true, B_result: true };   // 設定起始程度還沒做完(級別可能要變):照畫起始程度卡
  const home = { grid: null, card: null, sig: '', owned: false, state: null, seq: 0, running: false };
  /* 首頁狀態:起始程度卡畫過就用它給的;還沒畫過自己算(同 js/onboard-ui.js) */
  function homeState() {
    if (home.state !== null) return home.state;
    try {
      const s = ONBOARD_CORE.homeState(ONBOARD_DATA.context(null));
      return s === 'S0' ? 'A' : s;
    } catch (e) { return null; }
  }
  function hideOnboard() {
    const ob = document.getElementById('onboard-home');
    if (ob && (ob.children.length || !ob.hidden)) { ob.innerHTML = ''; ob.hidden = true; }
  }
  function dropCard() {
    if (home.card) home.card.remove();
    home.card = null;
    home.sig = '';
    if (home.grid) { home.grid.classList.remove('has-lesson'); home.grid.classList.remove('lesson-go'); }
  }
  /* 卡片換掉時焦點不動(沒有按任何東西);按「重試」的人焦點放到新卡的標題 */
  function paintCard(model, focus) {
    if (!home.grid || !window.LESSON_CORE) return;
    const sig = JSON.stringify(model);
    if (home.card && home.card.parentNode && sig === home.sig) return;
    const card = renderCard(model, { onRetry: () => refresh(true) });
    if (home.card && home.card.parentNode) home.card.replaceWith(card); else home.grid.prepend(card);
    home.card = card;
    home.sig = sig;
    home.grid.classList.add('has-lesson');
    if (model.kind === 'start' || model.kind === 'doing') home.grid.classList.add('lesson-go'); else home.grid.classList.remove('lesson-go');
    hideOnboard();
    if (window.UI && typeof UI.mount === 'function') UI.mount(card);
    if (focus) { const t = card.querySelector('h2'); if (t) t.focus(); }
  }
  /* 先用本機的進度畫,再跟雲端合併後重畫(有變才換);新的一次開始後舊的那次不畫。
     「載入中」在 lesson-core.js(字串在那裡)載完就畫,不等其他檔 */
  async function refresh(focus) {
    const my = ++home.seq;
    home.running = true;
    try {
      await loadOne('core');
      if (my !== home.seq || !mine()) return;
      if (!home.card) paintCard({ kind: 'loading' });
      await loadRest();
      for (const local of [true, false]) {
        const c = await course({ local });
        if (my !== home.seq || !mine()) return;
        if (!c) { dropCard(); return; }
        paintCard(modelOf(c, false), focus && local);
      }
    } catch (e) {
      if (my !== home.seq || !mine()) return;
      console.error('今天的課卡畫不出來：', e);
      paintCard({ kind: 'failed' }, focus);
    } finally {
      if (my === home.seq) home.running = false;
    }
  }
  /* 這張卡現在該不該出現:試行班、排得出級別、首頁狀態不是 B 或 B_result */
  const mine = () => home.owned && isPilot() && courseOk() && !BLOCKED[homeState()];
  function own() {
    if (home.owned) return;
    home.owned = true;
    window.addEventListener('cloud:merged', (e) => { if (e && e.detail && /^(les_t|plan$|levels$)/.test(String(e.detail.key))) update(); });
    window.addEventListener('pageshow', (e) => { if (e && e.persisted) update(); });
    update();
  }
  function update() {
    if (!mine()) { dropCard(); return; }
    hideOnboard();
    refresh(false);
  }
  /* js/onboard-ui.js 的 paintHome 每次畫起始程度卡之前問:true 就由這張卡取代(起始程度卡清空並藏起來) */
  function owns(state) {
    home.state = state === undefined ? null : state;
    if (!home.grid || !home.owned) return false;
    if (!mine()) { dropCard(); return false; }
    if (!home.card && !home.running) update();
    return true;
  }
  function bootHome() {
    home.grid = document.querySelector('.home-grid');
    if (!home.grid || !anyone()) return;
    if (planned()) own();
    cloudReady().then(() => {
      if (reloading()) return;
      if (home.owned) { update(); return; }
      ready().then((p) => { if (p.state === 'pilot' && !reloading()) own(); });
    });
  }

  /* ---------- 程度結果頁(start.html)的主按鈕 ----------
     結果卡照原本畫、不等名單;確定是試行班之後只換主按鈕的字與連結。沒有 plan:開始第 1 堂;有 plan:照首頁卡,
     可開始、進行中才換,明天開放、尚未開放、讀不到學習包時照原本。卡片已經不在頁面上就不動 */
  async function resultTarget() {
    const C = LESSON_CORE;
    if (!C.courseLevels(readKey('levels'))) return null;
    if (!LESSON_DATA.plan()) return { label: C.TEXT.s8.first, href: 'lesson.html?no=1' };
    await loadRest();
    const c = await course();
    const m = c ? modelOf(c, false) : null;
    if (!m || (m.kind !== 'start' && m.kind !== 'doing')) return null;
    return { label: m.kind === 'start' ? C.TEXT.s8.start(m.no) : C.TEXT.s8.resume(m.no), href: m.href };
  }
  function decorateResult(el) {
    const go = el && typeof el.querySelector === 'function' ? el.querySelector('.result-go') : null;
    if (!go || go.tagName !== 'A' || !anyone()) return;
    ready().then((p) => (p.state === 'pilot' && el.isConnected ? resultTarget() : null)).then((t) => {
      if (!t || !el.isConnected || !go.isConnected) return;
      go.textContent = t.label;
      go.setAttribute('href', t.href);
    }).catch((e) => { console.error('結果頁的主按鈕沒換：', e); });
  }

  window.LESSON_HOME = Object.freeze({ owns, ready, decorateResult, renderCard, course });
  if (document.readyState === 'loading' && !document.querySelector('.home-grid')) document.addEventListener('DOMContentLoaded', bootHome);
  else bootHome();
})();
