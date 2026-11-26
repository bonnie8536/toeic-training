/* start.html:新用戶設定起始程度。網址 ?step= 決定畫面,換步用 history.pushState,返回鍵回上一題、答案保留。
   S0 開始、S1 目標分數(target)、S2 考試月份(exam)、S3 程度(level)、S3a 輸入成績(score):不登入就能填,訪客的回答只存在這台(tr_onboard_guest)。
   要作答之前(S3「不確定，幫我測」「我是初學，從入門開始」、S3a「送出」、加入班級)訪客先到 S9 登入卡(signup);
   登入後在接回(resume)把回答搬進帳號,再到 S4 檢測說明(test)或 S8 結果(result)。C1 加入班級(join)。
   狀態只放在 tr_onboard_guest 與 store 鍵(登入後整頁會重載一次,記憶體留不住)。讀寫一律經過 js/onboard-data.js。
   畫面用 js/ui.js 的共用元件:S0 的鵜鶘(data-mascot)、S8 的結算卡(UI.result)、確認視窗(UI.confirm)、S8b 的面板(UI.sheet,js/onboard-ui.js)。
   一個畫面只有一顆實色主按鈕,其他是文字按鈕。行為測試在 tools/test_onboard_screens.js。 */
(function () {
  'use strict';
  const C = window.ONBOARD_CORE, D = window.ONBOARD_DATA, OUI = window.ONBOARD_UI;
  const STEPS = ['start', 'target', 'exam', 'level', 'score', 'signup', 'resume', 'test', 'listen', 'result', 'join'];
  const TITLES = { start: '開始', target: '你的多益目標', exam: '預計什麼時候考', level: '你的英文程度', score: '輸入多益成績', signup: '建立帳號',
    resume: '載入中', test: '程度檢測', listen: '程度檢測', result: '你的起始程度', join: '加入班級' };
  const PROGRESS = { target: 1, exam: 2, level: 3, score: 3 };
  const PREV = { target: 'start', exam: 'target', level: 'exam', score: 'level' };
  const AUTH_TITLES = { signup: '建立帳號', login: '登入', forgot: '重設密碼', sent: '驗證信已寄出' };
  const BACK_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  const STALE_DIAG = 7 * 864e5;
  const JOIN_FINE = '加入後這個班的老師看得到你的暱稱、Email、程度檢測結果和學習記錄。';
  let root = null, current = null, depth = 0, joinPrefill = '', joinError = '', flash = '', authSent = false, card = null;

  /* ---------- 網址與換步 ---------- */
  const urlOf = (step, from) => 'start.html' + (step === 'start' ? '' : '?step=' + step + (from ? '&from=' + from : ''));
  function stepOfUrl() { const s = getParam('step'); return STEPS.indexOf(s) > -1 ? s : 'start'; }
  function fromOfUrl() { const f = getParam('from'); return f === 'result' || f === 'me' ? f : ''; }
  function go(step, from) {
    depth++;
    history.pushState({ ob: true, step, depth }, '', urlOf(step, from));
    render(step, true);
  }
  function replaceTo(step, focus) {
    history.replaceState({ ob: true, step, depth }, '', urlOf(step, fromOfUrl()));
    render(step, focus);
  }
  /* 上一題:有自己推進來的紀錄就照瀏覽器返回,不然換成上一步的網址 */
  function back() {
    if (depth > 0) { history.back(); return; }
    const from = fromOfUrl();
    if (from === 'me') location.replace('me.html');
    else if (from === 'result') replaceTo('result', true);
    else if (current === 'target' && !D.isGuest()) location.replace('index.html');
    else replaceTo(PREV[current] || 'start', true);
  }
  /* S1、S2 帶 from(從 S8、「我的」頁來改答案):選完回原處 */
  function afterAnswer(next) {
    if (fromOfUrl()) back();
    else go(next);
  }
  function onPop(e) {
    const st = e.state && e.state.ob ? e.state : null;
    const step = st ? st.step : stepOfUrl();
    depth = st ? st.depth : 0;
    if (current === 'signup') D.cancelPending();
    /* 結果已經存進帳號:從 S8 往回退就回首頁 */
    if (current === 'result' && step !== 'result' && !fromOfUrl()) { location.replace('index.html'); return; }
    render(guard(step), true);
  }
  /* 訪客不能開作答的畫面;已登入不用再看登入卡 */
  function guard(step) {
    if (D.isGuest()) {
      if (step === 'test' || step === 'listen' || step === 'result' || step === 'signup') { const g = D.guest(); return g && g.pendingAction ? 'signup' : 'level'; }
      return step;
    }
    return step === 'signup' ? 'resume' : step;
  }

  /* ---------- 畫面骨架 ---------- */
  function render(step, focus) {
    current = step;
    if (window.ONBOARD_LISTEN) ONBOARD_LISTEN.stop();
    if (card) { card.destroy(); card = null; }
    root.innerHTML = '';
    document.title = TITLES[step] + ' - 衝衝英文';
    SCREENS[step]();
    if (window.UI && typeof UI.mount === 'function') UI.mount(root);   // S0 的鵜鶘(頁面載入時 js/ui.js 掛過一次,之後畫的自己掛)
    if (focus) {
      const t = root.querySelector('h1') || root.querySelector('.result-score');
      if (t) { t.setAttribute('tabindex', '-1'); try { t.focus({ preventScroll: true }); } catch (e) { /* 照樣往下 */ } }
      try { window.scrollTo(0, 0); } catch (e) { /* 照樣往下 */ }
    }
  }
  function head(step) {
    const n = PROGRESS[step];
    return h('div', { class: 'ob-head' },
      h('button', { class: 'ob-back', type: 'button', 'aria-label': '返回', html: BACK_ICON, onclick: back }),
      h('span', { class: 'ob-progress', 'aria-label': '第 ' + n + ' 題，共 3 題' }, n + '／3'));
  }
  function pageHead(title, sub) {
    return h('div', { class: 'page-head' }, h('h1', { id: 'ob-title' }, title), sub ? h('p', null, sub) : null);
  }
  /* 等雲端、算級別時:一行小字(同文法查表頁的「載入中…」),不畫頁面大標 */
  const loading = () => h('p', { class: 'result-note ob-loading', role: 'status' }, '載入中…');
  /* 原生 append(null) 會印出 null 這個字(S4 沒有提示、S8 沒有條件列時):先濾掉 */
  const put = (...nodes) => root.append(...nodes.filter(Boolean));
  const actions = (...nodes) => h('div', { class: 'ob-actions' }, nodes.filter(Boolean));
  const btn = (text, onClick) => h('button', { class: 'btn primary', type: 'button', onclick: onClick }, text);
  const textBtn = (text, onClick, extra) => h('button', { class: 'btn-text' + (extra ? ' ' + extra : ''), type: 'button', onclick: onClick }, text);
  const msgLine = () => h('p', { class: 'auth-msg', role: 'alert' });
  function say(el, text) { el.textContent = text || ''; el.className = 'auth-msg' + (text ? ' bad' : ''); }
  /* 寫入的結果:帳號資料夾還不能用就開「重新整理」卡(js/profile.js),讀回不符就說沒存到 */
  function wrote(r, msg, opener) {
    if (r === 'ok') return true;
    if (r === 'blocked' && window.PROFILE && PROFILE.askToAct) PROFILE.askToAct(opener);
    else say(msg, '沒有存到，請再試一次。');
    return false;
  }

  /* 單選卡片:方向鍵只移焦點(tabindex 跟著移),點、Enter、空白鍵才選定並前進;aria-checked 只標已選定的那一個 */
  function choices(options, selected, onPick) {
    const box = h('div', { class: 'ob-choices', role: 'radiogroup', 'aria-labelledby': 'ob-title' });
    const items = options.map((o) => h('button', { class: 'ob-choice', type: 'button', role: 'radio',
      'aria-checked': o.value === selected ? 'true' : 'false', tabindex: '-1', onclick: (e) => onPick(o.value, e.currentTarget) }, o.label));
    const start = Math.max(0, options.findIndex((o) => o.value === selected));
    items[start].setAttribute('tabindex', '0');
    box.addEventListener('keydown', (e) => {
      const i = items.indexOf(document.activeElement);
      const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (i < 0 || !d) return;
      e.preventDefault();
      const n = items[(i + d + items.length) % items.length];
      items.forEach((x) => x.setAttribute('tabindex', x === n ? '0' : '-1'));
      n.focus();
    });
    box.append(...items);
    return box;
  }
  /* 已登入看帳號的 onboard,訪客看暫存 */
  function answers() {
    if (D.isGuest()) { const g = D.guest(); return g ? { step: g.step, targetScore: g.targetScore, examMonth: g.examMonth } : null; }
    return D.account().onboard;
  }

  /* ---------- S0 ---------- */
  /* 標題短到手機上跟鵜鶘並排也是一行(螢光筆只壓一行);「（約 23 分鐘）」不從中間斷開 */
  function screenStart() {
    put(h('div', { class: 'ob-start' },
      pageHead('找出你的起始程度', ['填多益成績，或做 36 題檢測', h('span', { class: 'ob-nowrap' }, '（約 23 分鐘）')]),
      h('canvas', { class: 'ob-start-art', 'data-mascot': 'read', 'data-size': '160', 'aria-hidden': 'true' })),
    actions(btn('開始', () => go('target')), textBtn('我有班級代碼', () => go('join')),
      D.isGuest() ? textBtn('登入', () => PROFILE.showLogin('login')) : null));
  }

  /* ---------- S1 ---------- */
  function screenTarget() {
    const a = answers();
    const answered = !!a && a.step && a.step !== 'target';
    const opts = C.TARGETS.map((v) => ({ value: v, label: C.targetLabel(v) })).concat([{ value: null, label: '還不確定' }]);
    const msg = msgLine();
    put(head('target'), pageHead(TITLES.target),
      choices(opts, answered || (a && a.targetScore) ? a.targetScore : undefined, (v, el) => {
        const p = fromOfUrl() ? { targetScore: v } : { targetScore: v, step: 'exam' };
        if (wrote(D.answer(p), msg, el)) afterAnswer('exam');
      }),
      msg,
      h('p', { class: 'auth-fine ob-foot' }, '回答只用來判斷起始程度、推薦適合的練習。', h('a', { href: 'privacy.html#learning' }, '個資說明')));
  }

  /* ---------- S2 ---------- */
  function screenExam() {
    const a = answers();
    const sel = h('select', { class: 'auth-input', id: 'ob-exam', name: 'exam-month' },
      h('option', { value: '' }, '請選擇'), C.examMonths(Date.now()).map((m) => h('option', { value: m.value }, m.label)));
    if (a && a.examMonth) sel.value = a.examMonth;
    if (sel.value !== (a && a.examMonth)) sel.value = '';
    const msg = msgLine();
    const save = (v, el) => {
      const p = fromOfUrl() ? { examMonth: v } : { examMonth: v, step: 'level' };
      if (wrote(D.answer(p), msg, el)) afterAnswer('level');
    };
    const next = btn('下一步', (e) => save(sel.value, e.currentTarget));
    next.disabled = !sel.value;
    sel.addEventListener('change', () => { next.disabled = !sel.value; });
    put(head('exam'), pageHead(TITLES.exam),
      h('div', { class: 'auth-field ob-field' }, h('label', { for: 'ob-exam' }, '考試月份'), sel),
      msg, actions(next, textBtn('還沒報名', (e) => save(null, e.currentTarget))));
  }

  /* ---------- S3 ---------- */
  /* 訪客要作答:記下停在哪一題(登入卡按「返回」回這裡)與去處,先到登入卡 */
  function guestPending(action) {
    D.answer({ step: current === 'score' ? 'score' : 'level' });
    D.startPending(action);
    go('signup');
  }
  /* 「不確定，幫我測」:訪客先登入 */
  function pickTest(msg, el) {
    if (D.isGuest()) { guestPending('test'); return; }
    if (wrote(D.answer({ step: 'test' }), msg, el)) go('test');
  }
  function pickEntry(msg, el) {
    if (D.isGuest()) { guestPending('entry'); return; }
    if (wrote(D.chooseEntry(), msg, el)) go('result');
  }
  function screenLevel() {
    const msg = msgLine();
    const opts = [{ value: 'score', label: '我有多益成績' }, { value: 'test', label: '不確定，幫我測' }, { value: 'entry', label: '我是初學，從入門開始' }];
    put(head('level'), pageHead(TITLES.level),
      choices(opts, undefined, (v, el) => {
        if (v === 'score') { if (wrote(D.answer({ step: 'score' }), msg, el)) go('score'); }
        else if (v === 'test') pickTest(msg, el);
        else pickEntry(msg, el);
      }), msg);
  }

  /* ---------- S3a ---------- */
  function noteField(el, input, note, id) {
    return (m) => {
      note.textContent = m || ''; note.className = 'auth-note' + (m ? ' bad' : '');
      el.classList.toggle('is-bad', !!m);
      input.setAttribute('aria-invalid', m ? 'true' : 'false');
      if (m) input.setAttribute('aria-describedby', id); else input.removeAttribute('aria-describedby');
      return !m;
    };
  }
  function scoreField(id, label, value) {
    const input = h('input', { class: 'auth-input', id, type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '4' });
    input.value = value || '';
    const note = h('p', { class: 'auth-note', id: id + '-note', role: 'alert' });
    const el = h('div', { class: 'auth-field' }, h('label', { for: id }, label), input, note);
    return { el, input, bad: noteField(el, input, note, id + '-note') };
  }
  /* 草稿:訪客在 tr_onboard_guest,已登入在這個分頁的 sessionStorage(重新整理不清空) */
  function startDraft() {
    const g = D.isGuest() ? D.guest() : null;
    return (g ? g.scoreDraft : D.draft()) || { listening: '', reading: '', total: '', examYm: '', fromTotal: false };
  }
  function screenScore() {
    const d = Object.assign({}, startDraft());
    d.fromTotal = d.fromTotal === true;
    const f = { listening: scoreField('ob-l', '聽力', d.listening), reading: scoreField('ob-r', '閱讀', d.reading), total: scoreField('ob-t', '總分', d.total) };
    const ym = h('select', { class: 'auth-input', id: 'ob-ym', name: 'exam-ym' }, h('option', { value: '' }, '請選擇'),
      C.scoreMonths(Date.now()).map((m) => h('option', { value: m.value }, m.label)));
    ym.value = d.examYm || '';
    if (ym.value !== (d.examYm || '')) ym.value = '';
    const ymNote = h('p', { class: 'auth-note', id: 'ob-ym-note', role: 'alert' });
    const ymField = h('div', { class: 'auth-field' }, h('label', { for: 'ob-ym' }, '考試年月'), ym, ymNote);
    const ymBad = noteField(ymField, ym, ymNote, 'ob-ym-note');
    const grid = h('div', { class: 'ob-score' });
    const toggle = h('button', { class: 'btn-text ob-toggle', type: 'button' });
    const msg = msgLine();
    const read = () => ({ listening: f.listening.input.value, reading: f.reading.input.value, total: f.total.input.value, examYm: ym.value, fromTotal: d.fromTotal });
    const keep = () => { const v = read(); if (D.isGuest()) D.answer({ scoreDraft: v, step: 'score' }); else D.saveDraft(v); };
    const check = (k) => { const e = C.draftErrors(read()); return k === 'examYm' ? ymBad(e.examYm) : f[k].bad(e[k]); };
    function layout() {
      grid.innerHTML = '';
      if (d.fromTotal) grid.append(f.total.el); else grid.append(f.listening.el, f.reading.el);
      grid.classList.toggle('is-one', d.fromTotal);
      toggle.textContent = d.fromTotal ? '分開填' : '只記得總分';
    }
    ['listening', 'reading', 'total'].forEach((k) => f[k].input.addEventListener('blur', () => { if (f[k].input.value) check(k); keep(); }));
    ym.addEventListener('change', () => { check('examYm'); keep(); });
    toggle.addEventListener('click', () => { d.fromTotal = !d.fromTotal; ['listening', 'reading', 'total'].forEach((k) => f[k].bad('')); layout(); keep(); });
    layout();
    /* 「送出」放在 form 裡、type=submit:分開填兩欄時在欄位按 Enter 也會送出(HTML 的隱含送出) */
    const submit = h('button', { class: 'btn primary', type: 'submit' }, '送出');
    const form = h('form', { class: 'ob-form', novalidate: 'novalidate',
      onsubmit: (e) => { e.preventDefault(); submitScore(read(), check, msg, submit); } },
    grid, h('p', { class: 'ob-switch' }, toggle), ymField, msg,
    actions(submit, textBtn('改成幫我測', (e) => { keep(); pickTest(msg, e.currentTarget); })));
    put(head('score'), pageHead(TITLES.score), form);
  }
  function submitScore(draft, check, msg, el) {
    const keys = (draft.fromTotal ? ['total'] : ['listening', 'reading']).concat(['examYm']);
    const okAll = keys.map((k) => check(k)).every(Boolean);
    const self = okAll ? C.scoreFromDraft(draft) : null;
    if (!self) { const b = root.querySelector('.is-bad input, .is-bad select'); if (b) b.focus(); return; }
    if (D.isGuest()) { D.answer({ scoreDraft: draft }); guestPending('score'); return; }
    if (wrote(D.submitScore(self), msg, el)) go('result');
  }

  /* ---------- S9 ---------- */
  /* 登入卡送出(Email)或按了 Google:這次離開頁面是去登入,隨機碼要留著;沒送出就離開(點頂欄、關分頁)由 pagehide 清掉 */
  function watchAuth(authCard) {
    authSent = false;
    authCard.addEventListener('submit', () => { authSent = true; }, true);
    authCard.addEventListener('click', (e) => { const t = e.target; if (t && t.closest && t.closest('.btn-google')) authSent = true; }, true);
    return authCard;
  }
  function screenSignup() {
    const g = D.guest();
    const act = g && g.pendingAction;
    if (!act) { replaceTo('level'); return; }
    D.startPending(act);   // 每次顯示登入卡都換新的隨機碼與時間
    const h1 = h('h1', { id: 'ob-title' }, TITLES.signup);
    const authCard = watchAuth(PROFILE.buildAuthCard({ mode: 'signup', backTo: 'start.html?step=resume', autofocus: false,
      onMode: (m) => { h1.textContent = AUTH_TITLES[m] || TITLES.signup; document.title = h1.textContent + ' - 衝衝英文'; } }));
    const backTo = act === 'score' ? 'score' : act === 'join' ? 'join' : 'level';
    put(h('div', { class: 'auth-page' }, h('div', { class: 'page-head' }, h1), authCard,
      h('p', { class: 'ob-auth-back' }, textBtn('返回', () => {
        D.cancelPending();
        if (depth > 0) history.back(); else replaceTo(backTo, true);
      }))));
  }

  /* ---------- 接回 ---------- */
  function screenResume() {
    put(loading());
    D.resume().then(afterResume, () => resumeFailed('failed'));
  }
  function afterResume(r) {
    if (!r || r.status === 'reloading') return;   // 灌完雲端資料要重載,重載後再接
    if (r.status === 'ok') {
      if (r.joined) flash = '已加入「' + r.joined + '」。';
      if (r.next === 'home') location.replace('index.html'); else replaceTo(r.next, true);
      return;
    }
    if (r.status === 'signedOut') { replaceTo(guard('signup'), true); return; }
    if (r.status === 'joinFailed') {
      joinPrefill = r.code || ''; joinError = r.message || '';
      replaceTo('join', true);
      if (r.gone && window.PROFILE && PROFILE.accountGone) PROFILE.accountGone(null);
      return;
    }
    if (r.status === 'confirm') { askImport(r.answers); return; }
    if (r.status === 'x1') { askX1(r); return; }
    if (r.status === 'blocked' || r.status === 'failed') { resumeFailed(r.status); return; }
    location.replace('index.html');   // none、expired、teacher:照首頁
  }
  /* X1:帳號已經設定過程度。Esc、點遮罩、「保留設定」都是保留(UI.confirm 的取消),視窗一開焦點也停在保留上。
     「改用剛才的答案」不刪資料(帳號原本的設定存進 onboard.previous),不用紅色的危險按鈕。
     內文兩行:帳號的設定、剛才的答案(兩顆按鈕各對一行)。按鈕字要短:手機上兩顆排一列。
     共用元件沒載到時(uiReady)不問、不動訪客暫存,畫面換成重新整理 */
  const PICKED = { score: '有多益成績', test: '幫我測', entry: '從入門開始' };
  function uiOrReload() {
    if (uiReady()) return true;
    root.innerHTML = '';   // 拿掉「載入中…」,只留重新整理那一塊
    return false;
  }
  function askX1(r) {
    if (!uiOrReload()) return;
    const a = r.answers || {};
    const body = h('span', null, h('span', { class: 'ob-line' }, '帳號的設定：' + C.levelsLabel(r.levels)),
      h('span', { class: 'ob-line' }, '剛才的答案：目標 ' + C.targetLabel(a.targetScore) + (PICKED[a.pendingAction] ? '／' + PICKED[a.pendingAction] : '')));
    UI.confirm({ title: '這個帳號已有學習設定', body, ok: '改用剛才的答案', cancel: '保留設定', focusCancel: true })
      .then((reset) => afterResume(D.applyX1(reset ? 'reset' : 'keep', r.trusted)));
  }
  /* 不是在這個分頁的登入卡登入的:列出要帶入的答案(成績不帶),本人選。Esc、點遮罩當作「不用」 */
  function askImport(a) {
    if (!uiOrReload()) return;
    const body = '目標　' + C.targetLabel(a.targetScore) + '／考試　' + (C.ymLabel(a.examMonth) || '還沒報名');
    UI.confirm({ title: '要帶入這台裝置上填的答案嗎？', body, ok: '帶入', cancel: '不用' })
      .then((yes) => D.confirmImport(!!yes)).then(afterResume, () => resumeFailed('failed'));
  }
  /* 回「重試」按鈕;retry 是重試要回到的那一步(S8 算級別失敗回 result,不是重跑接回) */
  function resumeFailed(status, retry) {
    root.innerHTML = '';
    const b = status === 'blocked' ? btn('重新整理', () => location.reload()) : btn('重試', () => replaceTo(retry || 'resume', true));
    put(pageHead(status === 'blocked' ? '還沒載入你的練習紀錄' : '載入失敗'), actions(b));
    return b;
  }

  /* ---------- S4 ---------- */
  /* 舊檢測的正解只在要算級別時才載入 */
  function loadItems() {
    const have = () => (window.TOEIC && TOEIC.diagnostic ? C.flattenDiagItems(TOEIC.diagnostic) : null);
    if (have()) return Promise.resolve(have());
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'data/diagnostic.js';
      s.onload = () => resolve(have() || []);
      s.onerror = () => resolve([]);
      document.head.append(s);
    });
  }
  function startAndGo(msg, el) { if (wrote(D.startTest(), msg, el)) location.href = 'diagnostic.html?start=1'; }   // 檢測頁直接開考,不再按一次「開始」
  /* 先做聽力短測 8 題(full:之後接閱讀 28 題;legacy:用上次的閱讀檢測,做完直接算級別) */
  function listenFirst(mode, msg, el) { if (wrote(D.startListen(mode), msg, el)) go('listen'); }
  /* 舊檢測沒做完、而且是 7 天前開始的:不接著舊作答(可能混到幾個月前的答案),跟有報告時一樣先確認再清掉 */
  function staleDiag(diag) {
    if (!diag || diag.done) return false;
    const s = Date.parse(diag.startedAt);
    return isFinite(s) && Date.now() - s > STALE_DIAG;
  }
  /* 有舊報告或很久以前沒做完的作答:先確認再清掉(跟檢測頁「再測一次」同一個動作) */
  const RETEST = {
    done: { title: '清除這份報告？', body: '刷題與閱讀進度不受影響', ok: '重新檢測', cancel: '取消', danger: true },
    stale: { title: '清除上次沒做完的作答？', body: '刷題與閱讀進度不受影響', ok: '重新開始', cancel: '取消', danger: true },
  };
  /* 畫面同檢測頁的開始頁(js/diagnostic.js renderIntro):標題左邊的圖示、卡片裡兩個小標籤與實色主按鈕 */
  function screenTest() {
    const diag = D.diag();
    const msg = msgLine();
    const start = btn('開始檢測', (e) => {
      const el = e.currentTarget;
      const done = !!(diag && diag.done);
      if (diag && !done && !staleDiag(diag)) { startAndGo(msg, el); return; }   // 上線前就開始、7 天內沒做完的 28 題:照原本接著做
      if (!diag) { listenFirst('full', msg, el); return; }
      if (!uiReady()) return;   // 共用元件沒載到:不清掉上次的作答
      UI.confirm(done ? RETEST.done : RETEST.stale).then((yes) => { if (yes && wrote(D.removeDiag(), msg, el)) listenFirst('full', msg, el); });
    });
    const legacy = C.legacyUsable(diag, Date.now()) ? h('button', { class: 'btn-text', type: 'button', onclick: (e) => useLegacy(diag, msg, e.currentTarget) },
      '用上次的閱讀檢測', h('span', { class: 'ob-date' }, C.dayLabel(diag.finishedAt))) : null;
    put(flash ? h('p', { class: 'auth-msg ok', role: 'status' }, flash) : null,
      h('div', { class: 'page-head' }, h('canvas', { class: 'hub-art', 'data-doodle': 'diagnostic', 'data-size': '40', 'aria-hidden': 'true' }),
        h('h1', { id: 'ob-title' }, TITLES.test)),
      h('div', { class: 'diag-intro ob-intro' },
        h('p', { class: 'mock-tags' }, ['聽力 8 題', '閱讀 28 題', '約 23 分鐘'].map((t) => h('span', { class: 'mock-tag' }, t))),
        h('p', { class: 'ob-intro-note' }, '每題音檔只播一次'), msg, start,
        h('div', { class: 'ob-intro-more' }, textBtn('先跳過，從入門開始', (e) => { if (wrote(D.chooseEntry(), msg, e.currentTarget)) go('result'); }), legacy)));
    flash = '';
  }
  function useLegacy(diag, msg, el) { listenFirst('legacy', msg, el); }

  /* ---------- 聽力短測(js/onboard-listen.js) ----------
     還沒做完:從下一題接著做(8 題答完要自評時是自評頁);做完了:full 出中場(閱讀 28 題接著做)、legacy 直接用上次的閱讀檢測算級別到 S8 */
  function screenListen() {
    const OL = window.ONBOARD_LISTEN, ob = D.account().onboard, l = ob && ob.listen;
    if (!OL || !l || !Array.isArray(l.ids)) { replaceTo('test'); return; }
    const fail = () => { if (current === 'listen') resumeFailed('failed', 'listen'); };
    if (!l.doneAt) {
      put(loading());
      OL.test(root, { listen: l, save: (i, c, f) => D.saveListen(i, c, f), finish: (self) => D.finishListen(self),
        onDone: () => { if (current === 'listen') render('listen', true); }, onExit: () => location.replace('index.html'), onFail: fail });
      return;
    }
    if (l.mode === 'legacy') { computeLegacy(); return; }
    OL.middle(root, { onLater: () => location.replace('index.html'), onGo: (el) => { const msg = msgLine(); put(msg); startAndGo(msg, el); } });
  }

  /* ---------- S8 ---------- */
  function screenResult() {
    const acc = D.account();
    const route = C.resultRoute(acc.onboard, acc.levels, D.diag());
    if (route === 'legacy') { computeLegacy(); return; }
    if (route === 'done') D.markDone();
    if (route === 'done' || route === 'draw') { drawResult(D.account()); return; }
    replaceTo(route);   // 檢測還沒交卷回 S4;還沒走到結果的回中斷的那一步
  }
  /* 剛交的卷(或用上次閱讀檢測做完短測):先算級別存進帳號再畫;失敗的「重試」回這一頁重算,帳號資料夾還不能用時開「重新整理」卡。
     有算數的短測(ONBOARD_CORE.listenFor)時聽力照短測,短測的題目載不到也算失敗 */
  function computeLegacy() {
    const step = current, listen = C.listenFor(D.account().onboard), OL = window.ONBOARD_LISTEN;
    put(loading());
    Promise.all([loadItems(), listen && OL ? OL.answers() : null]).then(([items, answerOf]) => {
      if (current !== step) return;
      const lv = listen && !answerOf ? null : C.levelsFromLegacy(D.diag(), items, listen, answerOf);
      const r = lv ? D.setLegacyLevels(lv) : 'failed';
      if (r === 'ok') { if (step === 'result') render('result'); else replaceTo('result', true); return; }
      const retry = resumeFailed('failed', step);
      if (r === 'blocked' && window.PROFILE && PROFILE.askToAct) PROFILE.askToAct(retry);
    });
  }
  /* 結算卡下面的小字(一行):第 4 堂後調整過的最優先;再來是聽力怎麼來的;自填的成績超過 2 年另外標出來(看最後一筆檢測或成績的來源,改過級別也不會消失) */
  const LISTEN_NOTE = { short: '聽力依 8 題短測', self: '聽力依自評', legacy_plus1: '聽力依閱讀結果推估' };
  function sourceNote(acc) {
    const lv = acc.levels, tl = C.testedLevels(lv), from = lv.source || {};
    if (from.listening === 'calibrate' || from.reading === 'calibrate') return '依第 2 到 4 堂作答調整過';
    const old = !!acc.self_score && !!tl && tl.reason === 'score' && C.scoreTooOld(acc.self_score.examYm, Date.now());
    const src = from.listening;
    if (src === 'score') return old ? '依你填的成績（超過 2 年）' : '依你填的成績';
    if (LISTEN_NOTE[src]) return LISTEN_NOTE[src];
    return old ? '成績超過 2 年' : null;
  }
  function drawResult(acc) {
    if (!uiReady()) return;   // 結算卡靠共用元件:沒載到時說一聲、給重新整理
    const lv = acc.levels, ob = acc.onboard || {};
    const tl = C.testedLevels(lv);
    const tested = ob.levelSource === 'legacy' || (ob.levelSource === 'manual' && !!tl && tl.reason === 'legacy');
    /* 班級學生沒答 S1、S2:不出「你的選擇」 */
    const own = ob.path !== 'class';
    const link = C.practiceLink(lv);
    const msg = msgLine();
    const edit = (label, value, step) => h('li', null, h('button', { class: 'me-row', type: 'button', onclick: () => go(step, 'result') },
      h('span', null, label + '　' + value), h('span', { class: 'me-row-val' }, '修改')));
    card = UI.result({ big: TITLES.result, pose: 'happy', note: sourceNote(acc),
      stats: [['聽力', C.levelName(lv.listening)], ['閱讀', C.levelName(lv.reading)]],
      primary: link ? { label: '開始練習', href: link } : null,
      links: [{ label: '改級別', onClick: () => openLevels(lv, msg) }, { label: tested ? '重新檢測' : '做檢測', onClick: () => go('test') }] });
    card.el.classList.add('ob-result');
    if (window.LESSON_HOME) LESSON_HOME.decorateResult(card.el);   // 試行班:主按鈕在背後換成上課的入口(js/lesson-home.js)
    put(card.el, msg, own ? h('section', { class: 'ob-mine', 'aria-labelledby': 'ob-mine-h' },
      h('h2', { class: 'me-sec-h', id: 'ob-mine-h' }, '你的選擇'),
      h('ul', { class: 'me-list' }, edit('目標', C.targetLabel(ob.targetScore), 'target'), edit('考試', C.ymLabel(ob.examMonth) || '還沒報名', 'exam'))) : null);
  }
  function openLevels(lv, msg) {
    OUI.levelPanel({ levels: lv, onApply: (l, r) => {
      const ok = wrote(D.applyManual(l, r), msg, null);
      if (ok) setTimeout(() => render('result', true), 0);
      return ok;
    } });
  }

  /* ---------- C1 ---------- */
  function normalizeCode(s) {
    return window.CLASSES ? CLASSES.api.normalize(s) : String(s || '').replace(/\s/g, '').toUpperCase();
  }
  function codeError(c) { return window.CLASSES && CLASSES.api.check ? CLASSES.api.check(c) : (c ? '' : '請輸入邀請碼。'); }
  function screenJoin() {
    const input = h('input', { class: 'auth-input join-code', id: 'ob-join', type: 'text', name: 'class-code', autocomplete: 'off',
      autocapitalize: 'characters', spellcheck: 'false', maxlength: '20' });
    input.value = normalizeCode(joinPrefill || getParam('join') || '');
    const note = h('p', { class: 'auth-note', id: 'ob-join-note', role: 'alert' });
    const field = h('div', { class: 'auth-field ob-field' }, h('label', { for: 'ob-join' }, '邀請碼'), input, h('p', { class: 'auth-hint' }, '向老師拿 8 碼的邀請碼'), note);
    const bad = noteField(field, input, note, 'ob-join-note');
    const fine = h('p', { class: 'auth-fine' }, JOIN_FINE);
    bad(joinError);
    joinError = '';
    if (D.isGuest()) {
      /* 碼合格才先存(tr_pending_join)並記待辦;不合格清掉舊碼與待辦,離開欄位時說原因 */
      const remember = (show) => {
        const c = normalizeCode(input.value);
        const err = codeError(c);
        if (!err) { CLASSES.pending.save(c); D.startPending('join'); bad(''); return; }
        D.dropJoin();
        if (show) bad(err);
      };
      input.addEventListener('input', () => { bad(''); remember(false); });
      input.addEventListener('blur', () => { if (input.value) remember(true); });
      if (input.value) remember(false);
      /* 訪客:代碼欄、小字、註冊卡放在同一個置中的欄裡(同 S9 登入卡的寬度),左緣對齊 */
      put(h('div', { class: 'auth-page ob-join-guest' }, pageHead(TITLES.join), field, fine,
        h('div', { class: 'ob-join-auth' }, watchAuth(PROFILE.buildAuthCard({ mode: 'signup', backTo: 'start.html?step=resume', autofocus: false })))));
      return;
    }
    put(pageHead(TITLES.join), field);
    const submit = btn('加入', async (e) => {
      const el = e.currentTarget;
      el.disabled = true;
      const r = await CLASSES.api.join(input.value);
      el.disabled = false;
      if (!r.ok) { bad(r.message); input.focus(); if (r.gone && PROFILE.accountGone) PROFILE.accountGone(el); return; }
      flash = '已加入「' + r.name + '」。';
      if (wrote(D.joinedClass(), note, el)) go('test');
    });
    input.addEventListener('input', () => bad(''));
    put(fine, actions(submit));
  }

  const SCREENS = { start: screenStart, target: screenTarget, exam: screenExam, level: screenLevel, score: screenScore, signup: screenSignup,
    resume: screenResume, test: screenTest, listen: screenListen, result: screenResult, join: screenJoin };

  /* ---------- 開頁 ---------- */
  function readJoin() {
    try { const u = new URL(location.href); return u.searchParams.has('join') ? (u.searchParams.get('join') || '').slice(0, 40) : null; } catch (e) { return null; }
  }
  /* 入口判斷:接回、班級代碼優先於 ?step=;老師不走這裡。
     已登入開 S0(在 S0 按「登入」回來也是):照首頁的判斷,完成的人到首頁、設定中的人接著做 */
  function first() {
    const join = readJoin();
    const ctx = D.context(join);
    const r = C.entryRoute(ctx);
    if (r.cleanupGuest) D.clearGuest();
    if (r.state === 'resume') { replaceTo('resume'); return; }
    if (ctx.signedIn && window.CLOUD && CLOUD.user && CLOUD.isTeacher) { location.replace('index.html'); return; }
    if (r.state === 'join') { joinPrefill = join; replaceTo('join'); return; }
    if (ctx.signedIn && window.CLOUD && CLOUD.user && stepOfUrl() === 'start') {
      const st = C.homeState(ctx);
      if (st === 'D0' || st === 'none') { location.replace('index.html'); return; }
      if (st === 'B') { location.replace(C.continueHref(ctx.onboard)); return; }
      if (st === 'B_result') { location.replace('start.html?step=result'); return; }
    }
    replaceTo(guard(stepOfUrl()));
  }
  async function init() {
    root = document.getElementById('ob-root');
    if (!root) return;
    if (!window.CLOUD || !CLOUD.enabled) { location.replace('index.html'); return; }
    window.addEventListener('popstate', onPop);
    /* 沒送出就離開 S9、C1 的登入卡:之後在別頁登入不算這個分頁發起的(接回前要問本人) */
    window.addEventListener('pagehide', () => { if (!authSent && (current === 'signup' || current === 'join')) D.forgetNonce(); });
    /* 訪客不用等雲端元件載完(CDN)就能先畫;已登入、剛從 Google 回來的要等確認登入 */
    const pid = window.__PROFILE_ID;
    const maybeSigned = (typeof pid === 'string' && pid.charAt(0) === 'c') || !!CLOUD.authReturning;
    if (maybeSigned) put(loading());
    else first();
    await CLOUD.ready;
    if (CLOUD.reloading) return;
    if (maybeSigned || CLOUD.user) first();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
