/* 新用戶設定起始程度(start.html)的資料:訪客暫存 tr_onboard_guest 與三個 store 鍵(onboard、self_score、levels)的讀寫、登入後的接回。
   這四個鍵只在這個檔寫;畫面(js/onboard.js、js/onboard-ui.js)只呼叫這裡。純計算在 js/onboard-core.js。
   - 訪客(這一頁的資料夾不是雲端帳號、也沒有 CLOUD.user)只寫 tr_onboard_guest,而且只有調查答案(目標、考試月份、成績草稿、目前步驟)。
     帳號的鍵一律不寫;要作答(檢測、從入門開始、送出成績)時記下 pendingAction,先登入。
   - 已登入時寫 store 鍵(自動上傳 progress 表)。寫之前看 canKeepProgress()(js/common.js):帳號資料夾還不能用、正要重載就不寫。
     store.set 不回報結果:寫完立刻讀回,一樣才算成功;上傳失敗由 js/cloud.js 的帳本補傳。
   - 共用電腦:顯示 S9、C1 登入卡時產生一個隨機碼,同時記在這個分頁的 sessionStorage(ob_auth_nonce)
     與 tr_onboard_guest.authNonce。登入後兩邊一樣才自動接回;不一樣(別頁的登入卡、Email 驗證信、換人)先問本人要不要帶入,
     自填成績與班級代碼不帶入。sessionStorage 的鍵不是 tr_ 開頭,搬家不管。
   - 讀到壞掉、過期的訪客暫存一律刪掉(載入這個檔時就看一次)。 */
(function () {
  'use strict';
  const C = window.ONBOARD_CORE;
  const GUEST_KEY = 'tr_onboard_guest';
  const PENDING_JOIN = 'tr_pending_join';
  const NONCE_KEY = 'ob_auth_nonce';
  const DRAFT_KEY = 'ob_score_draft';
  const nowIso = () => new Date().toISOString();

  /* store 鍵一律寫成字面字串(tools/test_move_core.js 掃描新鍵有沒有搬家規則) */
  const GET = {
    onboard: () => store.get('onboard', null),
    self_score: () => store.get('self_score', null),
    levels: () => store.get('levels', null),
  };
  const SET = {
    onboard: (v) => store.set('onboard', v),
    self_score: (v) => store.set('self_score', v),
    levels: (v) => store.set('levels', v),
  };

  function signedIn() {
    const pid = window.__PROFILE_ID;
    return (typeof pid === 'string' && pid.charAt(0) === 'c') || !!(window.CLOUD && CLOUD.user);
  }
  function isGuest() { return !signedIn(); }

  /* ---------- 這個分頁的 sessionStorage(讀寫不到就當沒有) ---------- */
  function sGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 存不進去:接回時改問本人 */ } }
  function sDel(k) { try { sessionStorage.removeItem(k); } catch (e) { /* 照樣往下 */ } }
  function makeNonce() {
    let out = '';
    try {
      const a = new Uint32Array(4);
      window.crypto.getRandomValues(a);
      a.forEach((n) => { out += n.toString(36); });
    } catch (e) { for (let i = 0; i < 4; i++) out += Math.floor(Math.random() * 2 ** 32).toString(36); }
    return (out + '0000000000000000').slice(0, 24);
  }

  /* ---------- 訪客暫存 ---------- */
  function rawGuest() { try { return localStorage.getItem(GUEST_KEY); } catch (e) { return null; } }
  function clearGuest() { try { localStorage.removeItem(GUEST_KEY); } catch (e) { /* 刪不掉:7 天後讀到也會當過期 */ } }
  /* 讀一次;原值在但壞掉、過期就刪 */
  function guest() {
    const raw = rawGuest();
    if (raw === null) return null;
    const g = C.readGuest(raw, Date.now());
    if (!g) clearGuest();
    return g;
  }
  /* 只在訪客時寫;寫不進去照樣往下走(登入後要重答) */
  function saveGuest(patch) {
    if (!isGuest()) return null;
    const g = C.guestPatch(guest(), patch, Date.now());
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(g)); } catch (e) { /* 存不進去 */ }
    return g;
  }
  /* 要作答了:顯示登入卡那一刻記下去處、時間與這個分頁的隨機碼。
     buildAuthCard 沒有「按下之前」的掛鉤,所以每次顯示都換新;離開登入卡又沒送出時畫面呼叫 forgetNonce */
  function startPending(action) {
    const nonce = makeNonce();
    sSet(NONCE_KEY, nonce);
    return saveGuest({ pendingAction: action, authStartedAt: Date.now(), authNonce: nonce });
  }
  function cancelPending() { sDel(NONCE_KEY); return saveGuest({ pendingAction: null, authStartedAt: null, authNonce: null }); }
  /* 沒送出就離開登入卡(點頂欄、關分頁):之後在別頁登入不算這個分頁發起的,接回前要問本人 */
  function forgetNonce() { sDel(NONCE_KEY); }
  function trusted(g) { const n = sGet(NONCE_KEY); return !!(g && g.authNonce && n && n === g.authNonce); }

  /* tr_pending_join(js/classes.js)只看不拿:還在一天內就算有 */
  function hasPendingJoin() {
    try {
      const v = JSON.parse(localStorage.getItem(PENDING_JOIN));
      const age = v && typeof v.at === 'number' ? Date.now() - v.at : -1;
      return !!(v && typeof v.code === 'string' && v.code && age >= 0 && age <= 24 * 3600e3);
    } catch (e) { return false; }
  }
  /* C1 的碼不合法:清掉暫存碼與待辦,註冊回來不會帶著舊碼 */
  function dropJoin() {
    if (window.CLASSES && CLASSES.pending) CLASSES.pending.take();
    const g = guest();
    if (g && g.pendingAction === 'join') cancelPending();
  }

  /* ---------- 已登入時 S3a 的草稿(重新整理不清空;這個分頁的 sessionStorage,送出後刪) ---------- */
  function draft() { try { return C.cleanDraft(JSON.parse(sGet(DRAFT_KEY))); } catch (e) { return null; } }
  function saveDraft(d) { if (!isGuest()) sSet(DRAFT_KEY, JSON.stringify(d)); }
  function clearDraft() { sDel(DRAFT_KEY); }

  /* ---------- 帳號的鍵 ---------- */
  function account() { return { onboard: GET.onboard(), self_score: GET.self_score(), levels: GET.levels() }; }
  function diag() { return store.get('diag', null); }
  const blockedNow = () => (window.CLOUD && CLOUD.reloading) || !canKeepProgress();
  /* writes:{ onboard?, self_score?, levels? }。回 ok、blocked(這一頁不能寫)、failed(讀回不符)、guest(沒登入) */
  function writeAll(writes) {
    if (isGuest()) return 'guest';
    if (blockedNow()) return 'blocked';
    const keys = Object.keys(writes).filter((k) => SET[k]);
    keys.forEach((k) => SET[k](writes[k]));
    return keys.every((k) => JSON.stringify(GET[k]()) === JSON.stringify(writes[k])) ? 'ok' : 'failed';
  }
  function patch(p) { return writeAll({ onboard: C.patchOnboard(GET.onboard(), p, nowIso()) }); }

  /* 調查題(S1、S2、S3、S3a):訪客寫暫存,已登入寫 onboard */
  function answer(p) {
    if (isGuest()) {
      const g = {};
      ['targetScore', 'examMonth', 'step', 'scoreDraft'].forEach((k) => { if (Object.prototype.hasOwnProperty.call(p, k)) g[k] = p[k]; });
      return saveGuest(g) ? 'ok' : 'failed';
    }
    return patch(p);
  }
  function levelsWith(l, r, source, reason) { return C.newLevels(GET.levels(), l, r, source, reason, nowIso()); }
  /* 從入門開始(S3、S4):兩科入門 */
  function chooseEntry() {
    if (isGuest()) return 'guest';
    return writeAll({ levels: levelsWith('entry', 'entry', { listening: 'entry', reading: 'entry' }, 'entry'),
      onboard: C.patchOnboard(GET.onboard(), { levelSource: 'entry', step: 'result' }, nowIso()) });
  }
  /* S3a 送出(已登入):self 是 ONBOARD_CORE.scoreFromDraft 的結果 */
  function submitScore(self) {
    if (isGuest()) return 'guest';
    const prev = GET.self_score();
    const s = Object.assign({}, self, { enteredAt: C.stampAfter(prev && typeof prev === 'object' ? prev.enteredAt : null, nowIso()) });
    const lv = C.levelsFromScore(s);
    if (!lv) return 'failed';
    const r = writeAll({ self_score: s, levels: levelsWith(lv.listening, lv.reading, lv.source, 'score'),
      onboard: C.patchOnboard(GET.onboard(), { levelSource: 'score', step: 'result' }, nowIso()) });
    if (r === 'ok') clearDraft();
    return r;
  }
  /* S4「開始檢測」:記開始時間,檢測頁只認這之後交的卷。
     從 S8、「我的」頁重新檢測時設定已經是 done:改回 in_progress,交卷後檢測頁才出「看起始程度」;levels 留到新結果出來 */
  function startTest() { return isGuest() ? 'guest' : patch({ step: 'test', testFrom: nowIso(), status: 'in_progress' }); }
  /* 聽力短測(start.html?step=listen,js/onboard-listen.js):S4「開始檢測」(full,接著做 28 題)或「用上次的閱讀檢測」(legacy)開一份新的;
     每題選了就存(c:0–3,-1 沒選;failed:那一題音檔載不到);全部答完(失敗 2 題以上要自評)寫 doneAt。不寫練習紀錄 */
  function startListen(mode) {
    if (isGuest()) return 'guest';
    return patch({ listen: C.newListen(mode, nowIso()), step: 'listen', status: 'in_progress' });
  }
  function listenNow() { const ob = GET.onboard(); return ob && ob.listen && typeof ob.listen === 'object' ? ob.listen : null; }
  function saveListen(i, c, failed) {
    const l = listenNow();
    if (isGuest() || !l || !Array.isArray(l.a) || !Number.isInteger(i) || i < 0 || i >= l.a.length) return 'failed';
    const a = l.a.slice();
    a[i] = Number.isInteger(c) && c >= 0 ? c : -1;
    const fail = (Array.isArray(l.fail) ? l.fail : []).filter((x) => x !== i).concat(failed ? [i] : []).sort((x, y) => x - y);
    return patch({ listen: Object.assign({}, l, { a, fail }) });
  }
  /* 答完時呼叫(自評頁選了帶 self);還沒答完或還要自評時只存 self、不寫 doneAt */
  function finishListen(self) {
    const l = listenNow();
    if (isGuest() || !l) return 'failed';
    const next = Object.assign({}, l, self ? { self } : {});
    if (C.listenComplete(next) && !next.doneAt) next.doneAt = nowIso();
    return patch({ listen: next });
  }
  /* S4 有舊報告時按「開始檢測」並確定:清掉舊報告(跟 js/diagnostic.js「重新檢測」同一個動作,格式不變)。
     正要重載的那一下不刪:本機刪了不記帳,重載後雲端那份又回來 */
  function removeDiag() {
    if (isGuest() || blockedNow()) return 'blocked';
    store.remove('diag');
    return diag() === null ? 'ok' : 'failed';
  }
  /* 用舊檢測算出的級別(S4「用上次的閱讀檢測」、交卷後第一次到 S8) */
  function setLegacyLevels(lv) {
    if (isGuest()) return 'guest';
    return writeAll({ levels: levelsWith(lv.listening, lv.reading, lv.source, 'legacy'),
      onboard: C.patchOnboard(GET.onboard(), { levelSource: 'legacy', step: 'result' }, nowIso()) });
  }
  /* S8 第一次顯示(已經有 levels、停在 result 這一步):記完成。檢測還沒交卷(step 是 test)不記 */
  function markDone() {
    const ob = GET.onboard();
    if (ob && ob.status === 'done') return 'ok';
    if (ob && ob.status === 'in_progress' && ob.step !== 'result') return 'skipped';
    return isGuest() ? 'guest' : patch({ status: 'done', step: 'result', doneAt: nowIso() });
  }
  /* S8b 套用:改了的那一科來源記 manual */
  function applyManual(l, r) {
    if (isGuest()) return 'guest';
    const cur = GET.levels() || {};
    const src = Object.assign({}, cur.source || {});
    if (cur.listening !== l) src.listening = 'manual';
    if (cur.reading !== r) src.reading = 'manual';
    return writeAll({ levels: levelsWith(l, r, src, 'manual'), onboard: C.patchOnboard(GET.onboard(), { levelSource: 'manual' }, nowIso()) });
  }
  /* 首頁狀態 E「不用了」:要確定登入了(CLOUD.user)才寫 */
  function dismiss() {
    if (isGuest()) return 'guest';
    if (!(window.CLOUD && CLOUD.user)) return 'blocked';
    return writeAll({ onboard: C.dismissedOnboard(nowIso(), GET.onboard()) });
  }
  /* C1 加入班級成功:班級路徑,直接到檢測 */
  function joinedClass() { return isGuest() ? 'guest' : patch({ path: 'class', step: 'test', status: 'in_progress' }); }

  /* ---------- 登入後接回 ---------- */
  /* 接回前要確定不是老師。CLOUD.isTeacher 是 false 也可能是查教師表失敗、離線開 App(js/cloud.js 不報錯):
     自己再查一次,查不到回 null(這次不接回,訪客暫存留著) */
  async function teacherStatus(CL) {
    if (CL.isTeacher) return true;
    try {
      if (window.navigator && navigator.onLine === false) return null;
      if (!CL.client || typeof CL.client.from !== 'function') return null;
      const r = await CL.client.from('teachers').select('user_id').eq('user_id', CL.user.id);
      if (!r || r.error || !Array.isArray(r.data)) return null;
      return r.data.length > 0 || !!CL.isTeacher;
    } catch (e) { return null; }
  }
  /* 還能不能接:訪客暫存還在而且符合條件(別的分頁可能已經接回並刪掉) */
  function eligibleGuest() {
    const g = guest();
    if (!g) return null;
    if (!C.resumeEligible(g, Date.now())) { clearGuest(); return null; }
    return g;
  }
  async function resume() {
    const CL = window.CLOUD;
    if (CL) { try { await CL.ready; } catch (e) { /* ready 不會失敗 */ } }
    if (CL && CL.reloading) return { status: 'reloading' };
    if (!CL || !CL.user) return { status: 'signedOut' };
    const g0 = guest();
    if (!g0) return { status: 'none' };
    if (!C.resumeEligible(g0, Date.now())) { clearGuest(); return { status: 'expired' }; }
    const teacher = await teacherStatus(CL);
    if (teacher === null) return { status: 'failed' };
    if (teacher) { clearGuest(); return { status: 'teacher' }; }
    if (!canKeepProgress()) return { status: 'blocked' };
    const g = eligibleGuest();   // 查教師表的時候別的分頁可能接走了
    if (!g) return { status: 'none' };
    return run(g, { trusted: trusted(g), confirmed: false });
  }
  async function run(g, flags) {
    const acc = Object.assign(account(), { isTeacher: false, hasPendingJoin: hasPendingJoin() }, flags);
    const plan = C.resumePlan(g, acc, nowIso());
    if (plan.kind === 'join') return joinNow();
    if (plan.kind === 'none') {
      if (g.pendingAction === 'join' && !flags.trusted && window.CLASSES) CLASSES.pending.take();   // 不是本人發起的:別人的班級碼不留
      clearGuest();
      return { status: 'none' };
    }
    const answers = { targetScore: g.targetScore, examMonth: g.examMonth, pendingAction: g.pendingAction };
    if (plan.kind === 'confirm') return { status: 'confirm', answers };
    if (plan.kind === 'x1') return { status: 'x1', levels: GET.levels(), trusted: flags.trusted, answers };
    return finish(plan);
  }
  /* 接回的第一步:有暫存碼就加入,成功才刪訪客暫存、到 S4;失敗留在 C1 顯示原因(碼帶回去,可以改) */
  async function joinNow() {
    const code = window.CLASSES ? CLASSES.pending.take() : null;
    clearGuest();
    if (!code) return { status: 'none' };
    let r;
    try { r = await CLASSES.api.join(code); } catch (e) { r = { ok: false, message: '加入失敗，請再試一次。' }; }
    if (!r || !r.ok) return { status: 'joinFailed', code, message: (r && r.message) || '加入失敗，請再試一次。', gone: !!(r && r.gone) };
    const w = joinedClass();
    return w === 'ok' ? { status: 'ok', next: 'test', joined: r.name } : { status: w };
  }
  function finish(plan) {
    const r = writeAll(plan.writes);
    if (r !== 'ok') return { status: r };
    clearGuest();
    return { status: 'ok', next: plan.next };
  }
  /* 確認視窗(不是這個分頁發起的登入):yes 帶入目標與月份(成績不帶),no 刪掉訪客暫存 */
  async function confirmImport(yes) {
    const g = eligibleGuest();
    if (!g) return { status: 'none' };
    if (!yes) { clearGuest(); return { status: 'ok', next: 'home' }; }
    if (blockedNow()) return { status: 'blocked' };
    return run(g, { trusted: false, confirmed: true });
  }
  /* X1:重讀訪客暫存(開著視窗時別的分頁可能已經接回並刪掉),沒有或過期就什麼都不寫 */
  function applyX1(choice, wasTrusted) {
    const g = eligibleGuest();
    if (!g) return { status: 'none' };
    if (choice === 'keep') { clearGuest(); return { status: 'ok', next: 'home' }; }
    if (blockedNow()) return { status: 'blocked' };
    return finish(C.applyX1('reset', g, Object.assign(account(), { trusted: !!wasTrusted }), nowIso()));
  }

  /* 主畫面開啟的訪客被首頁轉到 S0:同一個工作階段只轉一次(sessionStorage ob_pwa_s0,不是 tr_ 鍵,搬家不管)。
     這次該轉回 true 並記下;讀不到 sessionStorage 時不轉,避免返回鍵迴圈 */
  function firstPwaVisit() {
    if (sGet('ob_pwa_s0') === '1') return false;
    sSet('ob_pwa_s0', '1');
    return sGet('ob_pwa_s0') === '1';
  }

  /* 入口判斷的輸入(js/onboard-core.js entryRoute) */
  function context(joinParam) {
    const CL = window.CLOUD || {};
    const keys = [];
    try { for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (e) { /* 讀不到就當沒有 */ }
    const user = CL.user || null;
    const pid = window.__PROFILE_ID;
    let isApp = false;
    try { isApp = document.documentElement.classList.contains('is-app'); } catch (e) { isApp = false; }
    return {
      joinParam: typeof joinParam === 'string' ? joinParam : null, signedIn: signedIn(), isTeacher: !!CL.isTeacher,
      onboard: signedIn() ? GET.onboard() : null, guest: guest(), nowMs: Date.now(),
      createdAtMs: user ? Date.parse(user.created_at) : null, hasPracticeKeys: typeof pid === 'string' && C.hasPracticeKeys(keys, pid),
      isApp, hasLocalData: C.hasLocalData(keys), cloudEnabled: !!CL.enabled, diag: signedIn() ? diag() : null,
    };
  }

  guest();   // 過期的暫存:開頁就刪

  window.ONBOARD_DATA = Object.freeze({
    GUEST_KEY, isGuest, guest, saveGuest, clearGuest, startPending, cancelPending, forgetNonce, hasPendingJoin, dropJoin,
    draft, saveDraft, clearDraft,
    account, diag, answer, chooseEntry, submitScore, startTest, removeDiag, setLegacyLevels, markDone, applyManual, dismiss, joinedClass,
    startListen, saveListen, finishListen,
    resume, confirmImport, applyX1, context, firstPwaVisit,
  });
})();
