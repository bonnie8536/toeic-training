/* 設定起始程度共用的畫面元件:S8b 改級別面板(start.html 與「我的」頁)、首頁的卡(index.html #onboard-home)、
   「我的」頁學習設定(js/profile.js renderAccount)、檢測頁結算卡的主按鈕(js/diagnostic.js)。
   面板用 js/ui.js 的 UI.sheet(手機從底部升起、焦點鎖在裡面、Esc 與點遮罩關、關了焦點回到打開它的按鈕)。
   不直接讀寫儲存:讀寫一律經過 js/onboard-data.js(ONBOARD_DATA),純計算在 js/onboard-core.js。 */
(function () {
  'use strict';
  const C = window.ONBOARD_CORE;
  let seq = 0;

  /* S8b 改級別:兩組四選一(原生 radio,不自動前進);跟最後一次檢測或成績的結果差 2 級以上多一行提示(不擋)。
     opts:{ levels, onApply(listening, reading) 回 true 才關 }。共用元件沒載到回 null */
  function levelPanel(opts) {
    if (!window.UI || typeof UI.sheet !== 'function') return null;
    const lv = opts.levels || {};
    const tested = C.testedLevels(lv);
    const note = h('p', { class: 'auth-fine ob-gap', role: 'status' });
    const pick = { listening: lv.listening, reading: lv.reading };
    const group = (sec, label) => {
      const name = 'ob-' + sec + '-' + (++seq);
      return h('fieldset', { class: 'auth-role ob-level-set' },
        h('legend', { class: 'ob-level-legend' }, label),
        h('div', { class: 'ob-level-row' }, C.LEVELS.map((code) => {
          const input = h('input', { type: 'radio', name, value: code, onchange: () => { pick[sec] = code; showGap(); } });
          input.checked = lv[sec] === code;
          return h('label', { class: 'auth-role-card' }, input, h('span', null, C.levelName(code)));
        })));
    };
    function showGap() {
      const far = tested && (C.levelGap(pick.listening, tested.listening) >= 2 || C.levelGap(pick.reading, tested.reading) >= 2);
      note.textContent = far ? '與檢測結果差 2 級' : '';
    }
    showGap();
    let sheet = null;
    const apply = h('button', { class: 'btn primary ob-apply', type: 'button', onclick: () => {
      if (C.levelName(pick.listening) && C.levelName(pick.reading) && opts.onApply(pick.listening, pick.reading) && sheet) sheet.close();
    } }, '套用');
    const listening = group('listening', '聽力');
    sheet = UI.sheet({ title: '改級別', class: 'ob-sheet', focus: listening.querySelector('input:checked') || undefined,
      nodes: [listening, group('reading', '閱讀'), note, h('div', { class: 'ob-sheet-actions' }, apply)] });
    return sheet;
  }

  /* ---------- 首頁的卡 ----------
     放在每日練習卡後面(桌機在右欄);按鈕是描邊鈕與文字按鈕,不搶每日練習的實色主按鈕。
     訪客與帳號已有 onboard 的人開頁當下就畫(不等雲端元件從 CDN 載完);已登入但沒有 onboard 的人要等 CLOUD.ready
     才知道是不是老師、帳號建立多久,等的期間不畫。「不用了」也等確定登入之後才給。
     轉頁(接回、主畫面開的訪客到 S0)只在確定登入狀態之後做;正要灌雲端資料重載的那一頁什麼都不做。 */
  function homeCard(root) {
    const D = window.ONBOARD_DATA;
    if (!root || !D || !window.CLOUD || !CLOUD.enabled) return;
    const pid = window.__PROFILE_ID;
    const cloudPid = typeof pid === 'string' && pid.charAt(0) === 'c';
    if (!cloudPid) {
      const ctx = D.context(null);
      /* 主畫面開啟、這台沒有任何學習資料的訪客:直接到 S0,同一個工作階段只轉一次(返回鍵回首頁不會又被轉走) */
      if (C.entryRoute(ctx).state === 'S0' && D.firstPwaVisit()) { location.replace('start.html'); return; }
      paintHome(root, ctx, false);
    } else if (D.account().onboard) paintHome(root, D.context(null), false);
    Promise.resolve(CLOUD.ready).then(() => {
      if (CLOUD.reloading) return;
      const ctx = D.context(null);
      const r = C.entryRoute(ctx);
      if (r.cleanupGuest) D.clearGuest();
      if (r.state === 'resume') { location.replace('start.html?step=resume'); return; }
      paintHome(root, r.cleanupGuest ? D.context(null) : ctx, true);
    });
  }
  function paintHome(root, ctx, ready) {
    const D = window.ONBOARD_DATA;
    let state = C.homeState(ctx);
    if (state === 'S0') state = 'A';
    /* 試行班的今天的課卡(js/lesson-home.js)要這個位置時:這張卡清空、藏起來 */
    if (window.LESSON_HOME && LESSON_HOME.owns(state)) { root.innerHTML = ''; root.hidden = true; return; }
    const m = C.homeCard(state, { signedIn: ctx.signedIn, onboard: ctx.onboard, guest: ctx.guest, levels: ctx.signedIn ? D.account().levels : null });
    root.innerHTML = '';
    if (!m) { root.hidden = true; return; }
    /* 小雞卡(js/pet-ui.js)也插在每日練習卡後面:這張卡排在它前面 */
    const daily = document.getElementById('daily-home');
    if (daily && daily.parentNode === root.parentNode && daily.nextElementSibling !== root) daily.after(root);
    const text = (label, onClick) => h('button', { class: 'btn-text', type: 'button', onclick: onClick }, label);
    /* 原生 append(null) 會印出 null 這個字:先濾掉 */
    root.append(...[h('h2', { id: 'ob-home-h' }, m.title), m.sub ? h('p', { class: 'ob-home-sub' }, m.sub) : null,
      h('div', { class: 'ob-home-actions' }, h('a', { class: 'btn', href: m.primary.href }, m.primary.text),
        m.secondary ? h('a', { class: 'btn-text', href: m.secondary.href }, m.secondary.text) : null,
        m.dismiss && ready ? text('不用了', (e) => dismissHome(root, e.currentTarget)) : null)].filter(Boolean));
    root.hidden = false;
  }
  /* 狀態 E「不用了」:onboard 記 dismissed,之後在「我的」頁學習設定找得到 */
  function dismissHome(root, el) {
    const r = window.ONBOARD_DATA.dismiss();
    if (r === 'ok') { root.innerHTML = ''; root.hidden = true; return; }
    if (r === 'blocked' && window.PROFILE && PROFILE.askToAct) PROFILE.askToAct(el);
  }

  /* ---------- 「我的」頁學習設定(js/profile.js renderAccount 在 CLOUD.ready 之後呼叫) ----------
     老師、訪客、本機學生檔案(雲端沒開)不顯示,回 null */
  function settingsSection() {
    const D = window.ONBOARD_DATA;
    if (!D || !window.CLOUD || !CLOUD.enabled || CLOUD.isTeacher || D.isGuest()) return null;
    const rows = C.settingsRows(D.account(), D.diag());
    const box = h('section', { class: 'me-sec', id: 'learning-settings', 'aria-labelledby': 'me-learning-h' },
      h('h2', { class: 'me-sec-h', id: 'me-learning-h' }, '學習設定'));
    const inner = (r) => [h('span', null, r.label), r.value ? h('span', { class: 'me-row-val' }, r.value) : null];
    box.append(h('ul', { class: 'me-list' }, rows.map((r) => h('li', null, r.href
      ? h('a', { class: 'me-row', href: r.href }, inner(r))
      : h('button', { class: 'me-row', type: 'button', onclick: (e) => openLevels(box, e.currentTarget) }, inner(r))))));
    return box;
  }
  function openLevels(box, opener) {
    const D = window.ONBOARD_DATA;
    levelPanel({ levels: D.account().levels, onApply: (l, r) => {
      const res = D.applyManual(l, r);
      if (res === 'blocked' && window.PROFILE && PROFILE.askToAct) PROFILE.askToAct(opener);
      if (res !== 'ok') return false;
      const next = settingsSection();
      if (next && box.parentNode) {
        box.replaceWith(next);
        const first = next.querySelector('.me-row');
        if (first) setTimeout(() => { try { first.focus(); } catch (e) { /* 照樣往下 */ } }, 0);
      }
      return true;
    } });
  }

  /* ---------- 檢測頁(js/diagnostic.js)結算卡的主按鈕 ----------
     設定中、按「開始檢測」之後交的卷:換成「看起始程度」;其他時候回 null(檢測頁照原本的「去刷題」)。
     核心檔或資料檔沒載到也回 null,不讓檢測報告畫不出來 */
  function diagPrimary() {
    const D = window.ONBOARD_DATA;
    if (!C || !D || D.isGuest()) return null;
    return C.diagRowState(D.account().onboard, D.diag()) === 'result' ? { label: '看起始程度', href: 'start.html?step=result' } : null;
  }

  /* 檢測頁開頁時直接開考的條件(js/diagnostic.js autoStart):登入著、設定停在檢測這一步、還沒有作答 */
  function testPending() {
    const D = window.ONBOARD_DATA;
    if (!C || !D || D.isGuest()) return false;
    const ob = D.account().onboard;
    return !!ob && ob.status === 'in_progress' && ob.step === 'test' && D.diag() === null;
  }

  document.addEventListener('DOMContentLoaded', () => { homeCard(document.getElementById('onboard-home')); });

  window.ONBOARD_UI = Object.freeze({ levelPanel, homeCard, settingsSection, diagPrimary, testPending });
})();
