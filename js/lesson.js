/* 上課頁 lesson.html?no=n 的控制:開頁判斷、段落總覽、瀏覽歷史、段與步驟的流程、題庫回合(呼叫練習引擎、交卷寫入、中途離開補回)、
   文法單元、英語耳、字卡與單字小考。畫面在 js/lesson-views.js;讀寫一律經過 js/lesson-data.js(這個檔不寫 store)。
   第 1 堂前測交給 js/lesson-test.js(LESSON_TEST),回顧、弱點補練、前測檢討、小檢核、本堂結果交給 js/lesson-personal.js(LESSON_PERSONAL),
   呼叫時傳 ctx = { no, lesson, slot, segment, host, key, classId, levels, state(), setState(s), runRound(blocks, opt), step(round),
     push(), show(el, focus), note(lines), has(kind, id), meta, files, data, views, items, now(), nowMs(), today() }。
   runRound(blocks 或 LESSON_CORE.rounds 的一步, opt) → Promise<'done'|'exit'>:同步作答紀錄 → 作答前快照 → 只出還沒答的題 → 呼叫引擎 →
     交卷時逐題寫進度、排 pts 與 rvq。opt = { feedback('instant'|'submit'), plays, src('p'|'w'|'r';null 不記 pts 與 rvq;小檢核回合預設 null),
     wrong(false 不排錯題), first(false 時一律不是第一次作答), result(false 交卷後不出區塊結果), onItems(rows, result), opener(按下的按鈕) }。
   有 LESSON_PERSONAL.rejudge(ctx) 時開頁呼叫一次(小檢核判定前關頁的補判)。
   時間:now 是 epoch 秒,作答紀錄與學習記錄是毫秒(LESSON_CORE 換算)。 */
(function (root) {
  'use strict';
  const doc = root.document;
  const C = root.LESSON_CORE, D = root.LESSON_DATA, V = root.LESSON_VIEWS, P = root.PACK_CORE;
  if (!doc || !C || !D || !V) return;
  const T = C.TEXT;
  const ENGINES = ['DRILL', 'LISTEN', 'GRAMMAR', 'EAR', 'DAILY', 'BANK'];
  const EAR_SEC = { ear_dictation: 'd', ear_pairs: 'mp', ear_numbers: 'n', ear_shadow: 's' };
  const EAR_LIST = { d: 'dictation', mp: 'pairs', n: 'numbers', s: 'shadow' };
  const EAR_REC = { d: 'ear_d', mp: 'ear_mp', n: 'ear_n', s: 'ear_s' };
  const HAS = { bank: 'bank', test: 'bank', ear: 'ear', grammar: 'grammar', words: 'word', tip: 'tip' };
  const SINGLE = { 1: true, 2: true, 5: true };
  const DELEGATE = {
    test_listening: ['LESSON_TEST', 'run'], test_reading: ['LESSON_TEST', 'run'], review: ['LESSON_PERSONAL', 'review'],
    weak: ['LESSON_PERSONAL', 'weak'], test_review: ['LESSON_PERSONAL', 'testReview'], checkpoint: ['LESSON_PERSONAL', 'checkpoint'],
    wrapup: ['LESSON_PERSONAL', 'wrapup'],
  };
  const SELF_START = { test_listening: true, test_reading: true, wrapup: true };   // 這幾段的開始時間由各自的程式記
  const SKIPPABLE = { review: true, weak: true };
  const SET_SIZE = 3;       // 前測組卷前的聽力題數:P3、P4 一組 3 題(36 題)
  const READING_EST = 41;   // 前測組卷前的閱讀題數:39–43 題取中間(約 30 分鐘)
  const S = {
    no: null, files: null, meta: new Map(), lesson: null, state: null, levels: null, classId: null, trial: null, note: null,
    slot: null, depth: 0, url: '', run: 0, screen: '', ignorePop: false, focus: null, onExit: null, words: null, pool: null,
  };

  /* ---------- 小工具 ---------- */
  const nowSec = () => Math.floor(Date.now() / 1000);
  const nowMs = () => Date.now();
  const today = () => P.dayOf(nowSec());
  const host = () => doc.getElementById('lsn-root');
  const segOf = (slot) => S.lesson.segments.filter((s) => s.slot === slot)[0];
  const hold = (btn) => typeof holdForAccount === 'function' && holdForAccount(btn || null);   // js/common.js
  function div(cls) { const n = doc.createElement('div'); n.className = cls; return n; }
  function termNow() { const p = D.plan(); return p && Number.isInteger(p.term) && p.term >= 1 && p.term <= 99 ? p.term : 1; }
  const progressKey = () => C.lessonKey(termNow(), S.no);
  function histNow() { return typeof store !== 'undefined' && store ? store.get('hist', []) || [] : []; }   // 只讀(學習記錄)
  function fail(e) { console.error(e); empty('badData', true); }

  /* ---------- 頁首、標題、換畫面 ---------- */
  function heads() { const h1 = doc.getElementById('lsn-h'); return { h1, kicker: doc.querySelector('.lsn-kicker'), head: h1 ? h1.parentNode : null }; }
  function topSlot() {
    let t = doc.querySelector('.lsn-top');
    const head = heads().head;
    if (!t && head) { t = div('lsn-top'); head.before(t); }
    return t;
  }
  function setTitles() {
    doc.title = S.no ? T.page.lesson(S.no) : T.page.title;
    const a = doc.querySelector('.app-title');
    if (a) a.textContent = S.no ? T.app.lesson(S.no) : T.app.title;
  }
  const titleNow = () => (S.lesson ? C.lessonTitle(S.lesson) : S.no ? T.lesson.kicker(S.no) : T.list.h1);
  /* 段落總覽時看得到 kicker 與 h1(堂名);其他畫面 h1 藏起來(讀屏照念),上方的返回連結與通知收掉 */
  function setHead(visible, title, top) {
    const x = heads();
    if (x.h1) { x.h1.textContent = title; x.h1.classList.toggle('daily-sr', !visible); }
    if (x.kicker) { x.kicker.textContent = S.no ? T.lesson.kicker(S.no) : ''; x.kicker.hidden = !visible; }
    if (x.head) x.head.classList.toggle('lsn-sr', !visible);
    const t = topSlot();
    if (t) { t.replaceChildren(...(visible ? (top || []).filter(Boolean) : [])); t.hidden = !visible; }
  }
  function screen(node, focus, name) {
    S.screen = name || 'other';
    setHead(false, titleNow());
    return V.show(host(), node, !!focus);
  }
  function empty(kind, focus, extra) {
    S.screen = 'empty';
    leaveFocus();
    setHead(false, (kind === 'locked' || kind === 'limit') && S.lesson ? C.lessonTitle(S.lesson) : titleNow0());
    V.show(host(), V.empty(kind, Object.assign({ no: S.no }, extra)), !!focus);
  }
  const titleNow0 = () => (S.no ? T.lesson.kicker(S.no) : T.list.h1);
  function loading() { S.screen = 'loading'; setHead(false, titleNow()); V.show(host(), V.loading(), false); }

  /* ---------- 瀏覽歷史:進段、換步驟 pushState;返回鍵回總覽;專心模式中按返回等於按關閉 ---------- */
  const histState = (depth) => ({ lsn: S.no, depth });
  function urlOf(slot) {
    const i = slot && S.lesson ? S.lesson.segments.findIndex((s) => s.slot === slot) : -1;
    return 'lesson.html?no=' + S.no + (i > -1 ? '&s=' + (i + 1) : '');
  }
  function pushStep(slot) {
    S.depth += 1;
    S.url = urlOf(slot || S.slot);
    root.history.pushState(histState(S.depth), '', S.url);
  }
  function onPop(e) {
    const st = e && e.state;
    const d = st && st.lsn === S.no && Number.isInteger(st.depth) ? st.depth : 0;
    if (S.ignorePop || S.screen === 'overview' || !S.lesson) { S.ignorePop = false; S.depth = d; return; }
    const f = root.UI && root.UI.focus ? root.UI.focus.active : null;
    if (f && f.active) {
      root.history.pushState(histState(S.depth), '', S.url);   // 補回這一層:學生選「繼續作答」時還在原處
      const x = doc.querySelector('.quiz-close');
      if (x) x.click();
      return;
    }
    S.depth = d;
    toOverview().catch(fail);
  }
  async function toOverview() {
    S.run += 1;
    leaveFocus();
    if (S.depth > 0) { const n = S.depth; S.depth = 0; S.ignorePop = true; root.history.go(-n); }
    else root.history.replaceState(histState(0), '', urlOf());
    if (S.state && S.state.doneAt) return showDone();
    if (S.slot === 'review') S.trial = await trialNow();
    return overview(true);
  }

  /* ---------- 開頁 ---------- */
  function parseNo() {
    const v = new URLSearchParams(root.location.search || '').get('no');
    return /^[1-9]\d?$/.test(v || '') && Number(v) <= 24 ? Number(v) : null;
  }
  function boot() {
    root.addEventListener('popstate', onPop);
    S.no = parseNo();
    setTitles();
    if (S.no !== null) root.history.replaceState(histState(0), '', urlOf());   // 帶 s 的網址一律回總覽
    if (S.no === null) { empty('notFound', false); return; }
    if (typeof uiReady === 'function' && !uiReady()) return;   // js/common.js:共用元件沒載到
    open(false).catch(fail);
  }
  async function open(focus) {
    S.run += 1;
    loading();
    const CL = root.CLOUD;
    if (CL && CL.ready) { try { await CL.ready; } catch (e) { /* 照下面判 */ } }
    if (CL && CL.reloading) return;
    const p = await D.pilot();
    if (p.state === 'checking') return;
    if (p.state === 'guest') { host().replaceChildren(); return; }   // 登入卡由 js/profile.js 畫
    if (p.state === 'unknown') return empty('unknown', focus, { retry: () => open(true).catch(fail) });
    if (p.state !== 'pilot') return empty('off', focus);
    S.classId = p.classId;
    S.levels = D.levels();
    if (!S.levels) return empty('noLevels', focus);
    if (!(await loadFiles())) return empty('failed', focus, { retry: () => open(true).catch(fail) });
    if (!P || !ENGINES.every((k) => !!root[k]) || !(await loadMeta())) return empty('itemsFailed', focus);
    return openLesson(focus);
  }
  async function loadFiles() {
    try { S.files = await D.packs(); return true; } catch (e) { return false; }   // 讀不到的網址 lesson-data.js 已經印出
  }
  async function loadMeta() {
    if (S.meta.size) return true;
    try { (await root.BANK.meta()).forEach((r) => S.meta.set(r.id, r)); return S.meta.size > 0; } catch (e) { console.error(e); return false; }
  }
  async function openLesson(focus) {
    S.state = (await D.open(S.no)).state;
    try { S.lesson = P.compose(S.files.packs, S.state ? S.state.levels : S.levels, S.no); } catch (e) { console.error(e); return empty('badData', focus); }
    S.words = null; S.pool = null;
    const st = statusNow();
    if (st.status !== 'open') return showStatus(st, focus);
    await prepare();
    if (S.state && S.state.doneAt) return showDone();
    return overview(focus);
  }
  function statusNow() {
    const states = Object.assign({}, D.states());
    if (S.state) states[S.no] = S.state;
    const u = P.unlockState({ packs: S.files.packs, levels: S.levels, states, today: today() });
    return { status: u.lessons[S.no - 1].status, next: u.next };
  }
  function showStatus(st, focus) {
    if (st.status === 'done') return showDone();
    if (st.status === 'not_live') return empty('notLive', focus);
    if (st.status === 'locked') return empty('locked', focus, { m: st.next });
    return empty('limit', focus);
  }
  /* 有進度時補凍結、個人段試排、前測的時間;小檢核補判(有的話) */
  async function prepare() {
    const jobs = [trialNow()];
    if (S.state) jobs.push(D.fillFixed(S.no, S.lesson, S.state, pickCtx()));
    const out = await Promise.all(jobs);
    S.trial = out[0];
    if (out[1]) S.state = out[1];
    const LP = root.LESSON_PERSONAL;
    if (S.state && segOf('checkpoint') && LP && typeof LP.rejudge === 'function') await LP.rejudge(ctxOf('checkpoint'));
    S.note = (S.note || []).concat(await testClock());
  }
  function trialNow() {
    return D.trial(S.no, S.lesson, S.state).catch((e) => { console.error(e); return { review: null, weak: null }; });
  }
  function pickCtx() {
    const LT = root.LESSON_TEST;
    return Object.assign({}, D.ctx(S.lesson, nowSec()), LT && typeof LT.assemble === 'function' ? { assemble: LT.assemble } : {});
  }

  /* ---------- 前測的時間(第 1 堂) ---------- */
  function testCount(slot) {
    const e = S.state && S.state.pk ? S.state.pk[C.TEST_QUOTA[slot].idx] : null;
    if (!e || !Array.isArray(e.ids)) return null;
    return e.ids.reduce((a, id) => a + (Number(has('bank', id)) || 0), 0);
  }
  const quotaCount = (slot) => C.TEST_QUOTA[slot].parts.reduce((a, x) => a + (SINGLE[x[0]] ? x[1] : x[1] * SET_SIZE), 0);
  const minutesFor = (slot, n) => Math.round(C.testLimit(slot, n) / 60);
  function testTime(slot) {
    const n = testCount(slot);
    const est = n !== null ? n : slot === 'test_listening' ? quotaCount(slot) : null;
    return est === null ? T.lesson.aboutMin(minutesFor(slot, READING_EST)) : T.lesson.itemsMin(est, minutesFor(slot, est));
  }
  /* 剩餘時間:最後活動＝這一段最後一題的作答時間與這個分頁記的最後畫面時間取晚的 */
  function testLeft(slot) {
    const idx = C.TEST_QUOTA[slot].idx, seg = S.state.seg[slot];
    const last = (S.state.a || []).filter((x) => x[0] === idx).reduce((m, x) => Math.max(m, S.state.startedAt + x[5]), 0);
    const lastAt = Math.max(last, D.clock(progressKey(), slot).last() || 0) || seg.t0;
    return C.testResume({ limit: C.testLimit(slot, testCount(slot) || 0), t0: seg.t0, lastAt, now: nowSec() });
  }
  const testDoing = () => (S.lesson.kind === 'test' && S.state ? Object.keys(C.TEST_QUOTA).filter((s) => S.state.seg[s] && S.state.seg[s].st === 'doing') : []);
  /* 開頁時:超過 24 小時或時間已用完的測驗段直接交卷,回總覽上方的通知 */
  async function testClock() {
    const notes = [];
    for (const slot of testDoing()) {
      const r = testLeft(slot);
      if (!r.expired && r.remaining > 0) continue;
      S.state = await D.segment(S.no, S.lesson, slot, 'done', nowSec());
      const listening = slot === 'test_listening';
      if (r.expired) notes.push(listening ? T.lesson.overListening : T.lesson.overReading, T.lesson.autoSubmitted);
      else if (listening) notes.push(T.lesson.timeUpListening);
    }
    return notes;
  }
  function leftMinutes() {
    const out = {};
    testDoing().forEach((slot) => { out[slot] = Math.max(0, Math.ceil(testLeft(slot).remaining / 60)); });
    return out;
  }

  /* ---------- 段落總覽 ---------- */
  function stepsNow() { return C.steps(S.lesson, S.state, Object.assign({}, S.trial || {}, { left: leftMinutes() })); }
  function timeOf(s) {
    if (Number.isFinite(s.left)) return T.lesson.left(s.left);
    return C.TEST_QUOTA[s.slot] ? testTime(s.slot) : T.lesson.min(s.minutes);
  }
  function overview(focus) {
    S.screen = 'overview';
    S.slot = null;
    leaveFocus();
    const steps = stepsNow();
    const cur = steps.filter((s) => s.st === 'current')[0];
    const listen = S.state && S.state.seg.test_listening;
    const model = {
      steps: steps.map((s) => Object.assign({}, s, { time: timeOf(s) })),
      label: S.state && S.state.startedAt ? T.lesson.resume : T.lesson.start,
      skip: cur && SKIPPABLE[cur.slot] ? cur.name : null,
      rules: S.lesson.kind === 'test' && (!listen || listen.st === 'todo') ? [T.test.oncePlay, T.test.noBack] : [],
    };
    const note = V.note(S.note);
    S.note = null;
    setHead(true, C.lessonTitle(S.lesson), [V.back(T.lesson.back, 'lessons.html'), note]);
    V.show(host(), V.overview(model, { go: (e) => onGo(e).catch(fail), skip: (e) => onSkip(e, cur).catch(fail) }), false);
    if (focus || note) { const t = note || heads().h1; if (t) t.focus(); }
  }
  async function onGo(e) {
    const btn = e && e.currentTarget;
    if (hold(btn)) return;
    if (btn) btn.disabled = true;
    if (!(S.state && S.state.startedAt) && !(await startLesson())) return;
    const slot = await skipEmpty();
    if (slot) await enterSegment(slot);
    else overview(true);
  }
  /* 按「開始」:重算能不能上,選題(第 1 堂組卷)與建立進度同一次寫 */
  async function startLesson() {
    const st = statusNow();
    if (st.status !== 'open') { showStatus(st, true); return false; }
    const t = nowSec(), c = pickCtx();
    let picked;
    if (S.lesson.kind === 'test') {
      const form = await (c.assemble ? c.assemble(c) : D.testForm(c));
      picked = [0, 1].reduce((s, i) => P.freeze(s, i, form[i] || [], t), P.newState(S.lesson, t));
    } else {
      const r = await P.pickFixed(S.lesson, P.newState(S.lesson, t), c);
      if (r.need && r.need.length) console.info('選題不夠或放寬過：', r.need);
      picked = r.state;
    }
    S.state = await D.start(S.no, S.lesson, t, S.classId, picked);
    return true;
  }
  /* 目前那一段前面試排 0 題的個人段先記成略過;回目前那一段 */
  async function skipEmpty() {
    for (const s of stepsNow()) {
      if (s.st === 'current') return s.slot;
      const seg = S.state.seg[s.slot];
      if (s.st === 'skip' && seg && seg.st !== 'skip' && seg.st !== 'done') S.state = await D.segment(S.no, S.lesson, s.slot, 'skip', nowSec());
    }
    return null;
  }
  async function onSkip(e, cur) {
    const btn = e && e.currentTarget;
    const yes = await root.UI.confirm({ title: T.lesson.skipAsk(cur.name), body: T.lesson.skipBody, ok: T.lesson.skipOk, cancel: T.lesson.cancel, focusCancel: true });
    if (!yes || hold(btn)) return;
    S.state = await D.segment(S.no, S.lesson, cur.slot, 'skip', nowSec());
    overview(true);
  }

  /* ---------- 段 ---------- */
  async function enterSegment(slot) {
    const run = ++S.run;
    S.slot = slot;
    const seg = S.state.seg[slot];
    if (!SELF_START[slot] && seg && seg.st === 'todo') S.state = await D.segment(S.no, S.lesson, slot, 'doing', nowSec());
    pushStep(slot);
    const out = DELEGATE[slot] ? await runDelegate(slot) : await runFixed(segOf(slot), run);
    if (run !== S.run || out === 'gone') return;
    if (S.state && S.state.doneAt && (slot === 'wrapup' || S.lesson.kind === 'test')) {
      if (!host().querySelector('.result-card')) await showDone();   // 前測結果、本堂結果由各自的程式畫
      return;
    }
    await toOverview();
  }
  async function runDelegate(slot) {
    const [mod, fn] = DELEGATE[slot];
    const M = root[mod];
    if (!M || typeof M[fn] !== 'function') { console.error('沒有載入 ' + mod + '.' + fn); empty('itemsFailed', true); return 'gone'; }
    return M[fn](ctxOf(slot), slot === 'wrapup' ? { first: true } : undefined);
  }
  async function showDone() {
    S.screen = 'done';
    leaveFocus();
    const test = S.lesson.kind === 'test';
    const M = root[test ? 'LESSON_TEST' : 'LESSON_PERSONAL'], fn = test ? 'result' : 'wrapup';
    setHead(false, titleNow());
    if (!M || typeof M[fn] !== 'function') { console.error('沒有載入 ' + (test ? 'LESSON_TEST' : 'LESSON_PERSONAL') + '.' + fn); empty('itemsFailed', false); return; }
    const out = await M[fn](ctxOf(test ? 'test_reading' : 'wrapup'), { first: false });
    if (out && out.nodeType) screen(out, true, 'done');
  }
  /* 固定段:從第一個沒完成的步驟做到最後,全部完成記交卷 */
  async function runFixed(seg, run) {
    const list = C.rounds(seg, S.state);
    const first = C.nextStep(seg, S.state, has);
    let n = 0;
    for (let i = first ? first.index : list.length; i < list.length; i++) {
      if (run !== S.run) return 'gone';
      if (stepDone(list[i])) continue;
      if (n++) pushStep(seg.slot);
      const out = await runStep(list[i], list[i + 1]);
      if (out !== 'done') return out;
    }
    leaveFocus();
    if (run !== S.run) return 'gone';
    S.state = await D.segment(S.no, S.lesson, seg.slot, 'done', nowSec());
    return 'done';
  }
  const quietIds = (b) => C.idsOf(b, S.state).filter((id) => !!has(HAS[C.stepKind(b)], id));
  const loudIds = (b) => C.answerable(b, C.idsOf(b, S.state), has);
  /* 這一步的題都答過了(全部找不到的也算,印出 id) */
  function stepDone(r) {
    if (['bank', 'grammar', 'ear', 'words'].indexOf(r.kind) < 0) return false;
    return r.blocks.every((b) => C.blockDone(b, loudIds(b), S.state, has));
  }
  function runStep(r, next) {
    const fn = { tip: stepTip, cards: stepCards, words: stepWords, bank: stepBank, grammar: stepGrammar, ear: stepEar }[r.kind];
    if (!fn) { console.warn('這一步不在一般段：' + r.kind); return Promise.resolve('done'); }
    return fn(r, next);
  }

  /* ---------- 可作答的判斷 ---------- */
  const tipCard = (id) => (root.TIP_CARDS && Array.isArray(root.TIP_CARDS.cards) ? root.TIP_CARDS.cards : []).filter((c) => c.id === id)[0] || null;
  function earSet(sec) {
    const E = (root.TOEIC && root.TOEIC.ear) || {};
    const list = sec === 's' ? E.shadow || E.dictation : E[EAR_LIST[sec]];
    return new Set((list || []).map((q) => q.id));
  }
  function has(kind, id) {
    if (kind === 'bank') { const r = S.meta.get(id); return r ? (SINGLE[r.part] ? 1 : r.size || false) : false; }
    if (kind === 'ear') return Object.keys(EAR_LIST).some((s) => earSet(s).has(id));
    if (kind === 'grammar') return !!(root.TOEIC && (root.TOEIC.grammar || []).some((u) => u.id === id));
    if (kind === 'word') return !!wordOf(id);
    if (kind === 'tip') return !!tipCard(id);
    return false;
  }

  /* ---------- 專心模式(字卡、單字小考共用一個) ---------- */
  function enterFocus(total, onExit) {
    S.onExit = onExit;
    if (S.focus && S.focus.active) { S.focus.setTotal(total); return S.focus; }
    S.focus = root.UI.focus.enter({ total, confirmExit: false, onExit: () => { const f = S.onExit; S.focus = null; S.onExit = null; if (f) f(); } });
    return S.focus;
  }
  /* 離開專心模式(引擎丟錯時留下的也一起收掉) */
  function leaveFocus() {
    S.onExit = null;
    if (S.focus) { S.focus.leave(); S.focus = null; }
    const f = root.UI && root.UI.focus ? root.UI.focus.active : null;
    if (f && typeof f.leave === 'function') f.leave();
  }

  /* ---------- 技巧卡 ---------- */
  async function stepTip(r) {
    for (const id of loudIds(r.blocks[0])) {
      const out = await new Promise((resolve) => {
        screen(V.tip(id, { no: S.no, back: () => resolve('exit'), next: () => resolve('done') }), true, 'tip');
      });
      if (out !== 'done') return out;
    }
    return 'done';
  }

  /* ---------- 字卡與單字小考 ---------- */
  const wordFile = () => (S.files && S.files.words ? S.files.words[S.lesson.levels.reading] : null);
  function vocabWord(a, base) {
    const v = a && (a.vocab || []).filter((x) => x.base === base)[0];
    return v ? { base: v.base, en: v.base, pos: v.pos || '', zh: v.zh } : null;
  }
  const verbWord = (v) => (v ? { base: v.base, en: [v.base, v.past, v.pp].join(' · '), pos: '', zh: v.zh } : null);
  function wordOf(id) {
    if (!S.words) {
      const X = root.TOEIC || {}, file = wordFile();
      const arts = new Map((X.articles || []).map((a) => [a.id, a])), verbs = new Map((X.verbs || []).map((v) => [v.id, v]));
      S.words = new Map();
      ((file && file.words) || []).forEach((w) => {
        const r = w.kind === 'verb' ? verbWord(verbs.get(w.id)) : vocabWord(arts.get(w.article), w.base);
        if (r) S.words.set(String(w.n), r);
      });
    }
    return S.words.get(String(id)) || null;
  }
  function pool() {
    if (!S.pool) { wordOf(''); S.pool = Array.from(S.words.values()).map((w) => ({ answer: w.base, zh: w.zh })); }
    return S.pool;
  }
  /* 字卡:那一週全部的字(區塊不存字) */
  function cardWords(b) {
    const file = wordFile();
    const which = (b.select && b.select.where && b.select.where.weekWords) || ['this_week'];
    const ids = file ? which.reduce((a, w) => a.concat(C.weekWordsFrom(file)(S.lesson.week, w)), []) : [];
    return ids.filter((id) => { const ok = !!wordOf(id); if (!ok) console.warn('找不到這個字，略過：' + id); return ok; }).map(wordOf);
  }
  function quizItems(r, loud) {
    const all = [];
    r.blocks.forEach((b) => (loud ? loudIds(b) : quietIds(b)).forEach((id) => all.push({ b: b.idx, id })));
    const got = new Set((S.state.a || []).map((x) => x[0] + '|' + x[1]));
    return { all, todo: all.filter((x) => !got.has(x.b + '|' + x.id)) };
  }
  function stepCards(r, next) {
    const quiz = next && next.kind === 'words' ? quizItems(next, false) : null;
    return new Promise((resolve) => {
      const f = enterFocus(quiz ? quiz.all.length : 0, () => resolve('exit'));
      f.progress(quiz ? quiz.all.length - quiz.todo.length : 0);
      screen(V.words(cardWords(r.blocks[0])), true, 'cards');
      const label = quiz && quiz.todo.length ? T.words.start : T.tip.next;
      f.foot([V.button(label, () => { if (!quiz) leaveFocus(); resolve('done'); }, 'btn primary lsn-go', true)]);
    });
  }
  function stepWords(r) {
    const q = quizItems(r, true);
    if (!q.todo.length) { leaveFocus(); return Promise.resolve('done'); }
    return new Promise((resolve, reject) => {
      const f = enterFocus(q.all.length, () => resolve('exit'));
      f.foot(null);
      const done = q.all.length - q.todo.length;
      const ask = (i) => {
        if (i >= q.todo.length) { leaveFocus(); resolve('done'); return; }
        f.progress(done + i + 1);
        try { askWord(q.todo[i], f, i === q.todo.length - 1, () => ask(i + 1)); } catch (e) { reject(e); }
      };
      ask(0);
    });
  }
  function askWord(item, f, last, onNext) {
    const w = wordOf(item.id);
    const opt = C.vocabOptions({ answer: w.base, zh: w.zh }, pool(), progressKey() + '|' + item.id);
    const q = { word: w.base, pos: w.pos, options: opt.options, answer: opt.answer, picked: null };
    const draw = () => screen(V.wordQuiz(q, { pick }), false, 'words');
    function pick(i, e) {
      if (q.picked !== null || hold(e && e.currentTarget)) return;
      q.picked = i;
      const ok = i === q.answer;
      S.state = D.record(S.no, S.lesson, [{ b: item.b, id: item.id, c: i, ok, f: true, t: nowSec() }]);
      f.keep(draw);
      f.feedback({ ok, answer: ok ? null : q.options[q.answer], next: last ? T.words.done : T.words.next, onNext });
    }
    draw();
    f.focusMain();
  }

  /* ---------- 題庫回合 ---------- */
  function stepBank(r) {
    if (r.feedback !== 'submit') return runRound(r);
    const count = r.blocks.reduce((a, b) => a + quietIds(b).reduce((x, id) => x + (Number(has('bank', id)) || 0), 0), 0);
    if (!count) return runRound(r);
    return new Promise((resolve) => {
      screen(V.bridge({ parts: r.parts, count }, { start: (e) => resolve(e.currentTarget) }), true, 'bridge');
    }).then((btn) => runRound(r, { opener: btn }));
  }
  const partsOfIds = (ids) => ids.map(C.partOfId).filter((p, i, a) => p && a.indexOf(p) === i);
  async function runRound(input, opt) {
    const o = opt || {};
    const blocks = Array.isArray(input) ? input : input.blocks;
    const round = Array.isArray(input) ? {} : input;
    const ids = [].concat(...blocks.map(quietIds));
    const engine = Number(partsOfIds(ids)[0] || (round.engine === 'LISTEN' ? 1 : 5)) <= 4 ? 'LISTEN' : 'DRILL';
    const feedback = o.feedback || round.feedback || (blocks[0] && blocks[0].timing === 'guided' ? 'instant' : 'submit');
    const cp = o.cp !== undefined ? !!o.cp : !!round.cp;
    const x = { engine, feedback, o: Object.assign({ src: cp ? null : 'p' }, o), plays: o.plays || round.plays || (feedback === 'instant' ? 2 : 1) };
    if (hold(o.opener)) return 'exit';
    const run = S.run;
    loading();
    await D.sync(C.syncKeys({ kind: 'bank', parts: partsOfIds(ids) }));
    const job = await roundJob(blocks, feedback);
    if (run !== S.run) return 'gone';
    if (!job.units.length) return 'done';
    return callEngine(job, x);
  }
  /* 這一回合的題:可作答、拿得到的題;作答前快照;即時回合先補回已答的;交卷回合有沒答完的就整回合重出 */
  async function roundJob(blocks, feedback) {
    const ids = [], byId = new Map();
    blocks.forEach((b) => loudIds(b).forEach((id) => { if (!byId.has(id)) { byId.set(id, b); ids.push(id); } }));
    const got = ids.length ? await root.BANK.get(ids) : [];
    const items = new Map();
    ids.forEach((id, i) => { if (got[i]) items.set(id, got[i]); else console.warn('找不到這一題，略過：' + id); });
    const keys = [];
    items.forEach((item, id) => C.itemKeys(C.partOfId(id), item, id).forEach((k) => keys.push({ id, part: C.partOfId(id), sub: k.sub, key: k.key })));
    const snap = new Set();
    partsOfIds(Array.from(items.keys())).forEach((p) => D.snapshot(p, keys.filter((k) => k.part === p).map((k) => k.key)).forEach((k) => snap.add(k)));
    const job = { blocks, items, byId, keys, snap, units: [] };
    if (feedback === 'instant') record(reconcileRows(job, null));
    const left = pendingIds(job);
    const use = feedback === 'instant' ? left : left.length ? Array.from(items.keys()) : [];
    job.units = use.map((id) => ({ p: C.partOfId(id), item: items.get(id) }));
    return job;
  }
  function pendingIds(job) {
    const got = new Set((S.state.a || []).map((x) => x[0] + '|' + x[1] + '|' + x[2]));
    return Array.from(job.items.keys()).filter((id) => {
      const b = job.byId.get(id);
      const subs = b.module === 'redo' ? b.list.map((x, i) => (x === id ? (b.sub && b.sub[i]) || 0 : null)).filter((s) => s !== null)
        : job.keys.filter((k) => k.id === id).map((k) => k.sub);
      return subs.some((s) => !got.has(b.idx + '|' + id + '|' + s));
    });
  }
  /* 即時回合補回:作答紀錄 t ≥ 這一段開始的小題(snapshot 是這一回合開始前的快照;沒給時照時間與學習記錄判斷第一次) */
  function reconcileRows(job, snapshot) {
    const seg = S.state.seg[S.slot];
    const since = ((seg && seg.t0) || S.state.startedAt) * 1000;
    const blocks = job.blocks.map((b) => (b.module === 'redo' ? b : { idx: b.idx, ids: C.idsOf(b, S.state).filter((id) => job.items.has(id)) }));
    return C.reconcile({ blocks, items: (id) => job.items.get(id), records: D.ctx(S.lesson, nowSec()).records, sinceMs: since, snapshot, hist: histNow() });
  }
  function record(rows) { if (rows && rows.length) S.state = D.record(S.no, S.lesson, rows); }
  function callEngine(job, x) {
    const el = div('lsn-engine');
    screen(el, false, 'engine');
    return new Promise((resolve, reject) => {
      const onDone = (res) => { finishRound(job, res, x).then(resolve, reject); };
      const onExit = () => {
        try { if (x.feedback === 'instant') record(reconcileRows(job, job.snap)); resolve('exit'); } catch (e) { reject(e); }
      };
      const opts = { feedback: x.feedback, onDone, onExit };
      if (x.engine === 'LISTEN') root.LISTEN.startQuiz(el, null, Object.assign({ units: job.units, plays: x.plays }, opts));
      else root.DRILL.startQuiz(el, job.units, opts);
    });
  }
  async function finishRound(job, res, x) {
    const before = new Set((S.state.a || []).map((r) => r[0] + '|' + r[1] + '|' + r[2]));
    const items = (res && res.items) || [];
    const rows = items.map((it) => rowOf(it, job, x.o)).filter(Boolean);
    record(rows);
    if (x.o.src) queuePoints(job, rows, before, x.o);
    if (typeof x.o.onItems === 'function') await x.o.onItems(rows, res);
    if (x.feedback !== 'submit' || x.o.result === false) return 'done';
    return new Promise((resolve) => {
      const r = { parts: partsOfIds(job.units.map((u) => u.item.id)), score: res.score, total: res.total, units: job.units, answers: items, wrong: res.total - res.score };
      screen(V.blockResult(r, { next: () => resolve('done') }), true, 'block');
    });
  }
  function rowOf(it, job, o) {
    const b = job.byId.get(it.id);
    if (!b) return null;
    const first = o.first !== false && b.module !== 'redo' && !job.snap.has(it.key);
    return { b: b.idx, id: it.id, sub: it.sub || 0, c: Number.isInteger(it.c) ? it.c : -1, ok: !!it.ok, f: first, t: nowSec() };
  }
  /* 考點:照進度裡這個區塊的全部作答記一批(同一批重記只留題數多的);答錯的新題排回顧 */
  function queuePoints(job, rows, before, o) {
    const day = today(), key = progressKey();
    job.blocks.filter((b, i, a) => b.module !== 'redo' && a.indexOf(b) === i).forEach((b) => {
      const answers = blockAnswers(b.idx);
      if (answers.length) D.hits(answers, { today: day, src: o.src, b: key + ':' + b.idx });
    });
    if (o.wrong === false) return;
    const refs = rows.filter((r) => !r.ok && !before.has(r.b + '|' + r.id + '|' + r.sub))
      .map((r) => ({ m: job.byId.get(r.id).module, id: r.id, sub: r.sub || null }));
    if (refs.length) D.wrong(refs, day);
  }
  function blockAnswers(idx) {
    const R = root.LESSON_RULES;
    return (S.state.a || []).filter((x) => x[0] === idx).map((x) => {
      const row = S.meta.get(x[1]);
      const keys = row && R ? R.keysOfRow(row) : [];
      return { key: keys[x[2] ? x[2] - 1 : 0] || null, ok: (x[4] & 1) === 1, first: (x[4] & 2) === 2 };
    }).filter((a) => a.key);
  }

  /* ---------- 文法單元、英語耳 ---------- */
  function stepGrammar(r) {
    const b = r.blocks[0];
    const id = loudIds(b)[0];
    if (!id) return Promise.resolve('done');
    const was = !!root.GRAMMAR.done(id);
    return new Promise((resolve, reject) => {
      const box = div('lsn-grammar lsn-screen'), eng = div('lsn-engine'), tail = div('lsn-tail');
      box.append(V.back(T.lesson.backTo(S.no), urlOf(), () => resolve('exit')), eng, tail);
      screen(box, false, 'grammar');
      const onDone = (res) => {
        try {
          record(((res && res.items) || []).map((it) => ({ b: b.idx, id, sub: it.sub || 0, c: Number.isInteger(it.c) ? it.c : -1, ok: !!it.ok, f: !was, t: nowSec() })));
          const card = V.grammarDone({ score: res.score, total: res.total }, { next: () => resolve('done') });
          box.destroy = card.destroy;
          tail.replaceChildren(card);
          V.focusIn(card);
        } catch (e) { reject(e); }
      };
      root.GRAMMAR.unit(eng, id, { onDone, onExit: () => resolve('exit') });
      const h2 = eng.querySelector('h2');
      if (h2) { h2.setAttribute('tabindex', '-1'); h2.focus(); }
    });
  }
  function stepEar(r) {
    const b = r.blocks[0], sec = EAR_SEC[b.module];
    const list = earSet(sec);
    const ids = loudIds(b).filter((id) => { const ok = list.has(id); if (!ok) console.warn('找不到這一題，略過：' + id); return ok; });
    if (!sec || !ids.length) return Promise.resolve('done');
    const seen = D.ctx(S.lesson, nowSec()).earRecords[EAR_REC[sec]] || {};
    return new Promise((resolve, reject) => {
      const eng = div('lsn-engine');
      screen(eng, false, 'ear');
      const onDone = (res) => {
        try {
          record(((res && res.items) || []).map((it) => ({ b: b.idx, id: it.id, c: Number.isInteger(it.c) ? it.c : -1, ok: !!it.ok, f: !seen[it.id], t: nowSec() })));
          resolve('done');
        } catch (e) { reject(e); }
      };
      root.EAR.round(eng, sec, { items: ids, onDone, onExit: () => resolve('exit') });
    });
  }

  /* ---------- 給測驗與個人段的 ctx ---------- */
  function ctxOf(slot) {
    return Object.freeze({
      no: S.no, lesson: S.lesson, slot, segment: segOf(slot), host: host(), key: progressKey(), classId: S.classId, levels: S.levels,
      state: () => S.state, setState: (s) => { if (s && typeof s === 'object') S.state = s; },
      runRound, step: (r) => runStep(r), push: () => pushStep(slot), show: (node, focus) => screen(node, focus !== false),
      note: (lines) => { S.note = [].concat(lines || []).filter(Boolean); }, has, meta: S.meta, files: S.files,
      data: D, views: V, items: root.LESSON_ITEMS, now: nowSec, nowMs, today,
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
  doc.addEventListener('DOMContentLoaded', setTitles);   // App 頂欄的頁名(js/app-shell.js 載完才有)
})(typeof globalThis !== 'undefined' ? globalThis : this);
