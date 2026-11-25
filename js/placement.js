/* 程度檢測頁(placement.html):聽力 12 題、閱讀 12 題的適性檢測。window.PLACEMENT。
   流程:開始頁 → 一科一科作答(每一格是一題或一整組,答完一格才選下一格)→ 兩科中間 → 結果頁(含看作答)。
   · 選題一律呼叫 ESTIMATE(js/estimate-core.js):可出的題(available)、事先數好每一格(planSlots)、目前能力(estimate)、挑題(pickUnit)。
     第一格用「目前能力 − 0.5」(startTheta);種子是學生檔案 id,亂數加上這次的開始時間與第幾格,重整頁面挑到同一題。
   · 讀寫一律經 ESTIMATE_STORE(js/estimate-store.js):startRun、beginSection、answer(每送出一格就存)、endSection、finishRun、activeRun、excludeFor。
     不寫 hist、drill_p*、listen_p*。級別(levels)只在下面 applyLevels 的條件寫:沒設定過、在新用戶設定流程裡、或沒有課程進度;有課程進度時只給「改成這個級別」。
   · 作答:選好按「下一題」才送出,題組全部選完才能按;不能回上一題,沒有題號面板;不顯示對錯。每題記作答秒數(題組平均分給每一小題)。
   · 聽力:按播放才播、只播一次;出錯或沒播完停住可以「重新播放」一次;再出錯換同一個 Part 的另一題,這題不記。
     P3、P4 先播音,播完三題一起出。開始播的題記在這台裝置(tr_placement_heard,不同步):離開後回來,播到一半的那題換新題,不重播。
     沒有網路時不開始聽力(兩科都做的改成先做閱讀)。
   · 中途離開:24 小時內回來從下一格接著做(activeRun);離開前問一次。
   網址:?sec=L|R 只做一科;?start=1 直接開始(從新用戶設定來);?from=onboard 結果頁主按鈕回新用戶設定;?view=last 看最近一次的結果。
   課程預留題排除:RESERVE_ON 是開關(現在關),打開時讀 window.PLACEMENT_RESERVE() 給的題目 id。 */
(function (root) {
  'use strict';
  const SCRIPT = Object.freeze({
    L: Object.freeze([{ part: '1' }, { part: '1' }, { part: '2' }, { part: '2' }, { part: '2' }, { part: '2' }, { part: '3', size: 3 }, { part: '4', size: 3 }]),
    R: Object.freeze([{ part: '5' }, { part: '5' }, { part: '5' }, { part: '5' }, { part: '6', size: 4 }, { part: '7', size: 4 }]),
  });
  const HEARD_KEY = 'tr_placement_heard';
  const AUTO_WAIT = 8000;
  const RESERVE_ON = false;
  const SINGLE = { 1: true, 2: true, 5: true };
  const LEVEL_KEY = { L: 'listening', R: 'reading' };
  const V = () => root.PLACEMENT_VIEWS;
  const E = () => root.ESTIMATE;
  const S = () => root.ESTIMATE_STORE;
  const STR = () => V().STR;
  const doc = () => root.document;
  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const st = { root: null, run: null, sec: null, plan: null, cur: null, focus: null, card: null, skip: new Set(), skipSlots: new Set(), busy: false, asking: false,
    secParam: 'LR', onboard: false, preload: null };

  function el(tag, attrs, kids) {
    const n = doc().createElement(tag);
    Object.keys(attrs || {}).forEach((k) => { if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? '' : String(attrs[k])); });
    [].concat(kids || []).forEach((c) => { if (c !== null && c !== undefined) n.append(c.nodeType ? c : String(c)); });
    return n;
  }

  /* ---------- 題庫 ---------- */
  const cache = {};
  function bankOf(part) {
    const T = root.TOEIC || {}, L = T.listening || {};
    const list = { 1: L.p1, 2: L.p2, 3: L.p3, 4: L.p4, 5: T.part5, 6: T.part6, 7: T.part7 }[part];
    return Array.isArray(list) ? list : [];
  }
  /* 一個 Part 的題(題組是一整組):{ id, part, item, keys };P7 只用單篇 */
  function unitsOf(part) {
    const p = String(part);
    if (cache[p]) return cache[p];
    const ok = (it) => it && typeof it.id === 'string' && (SINGLE[p] || Array.isArray(it.questions)) && (p !== '7' || it.format === 'single');
    cache[p] = bankOf(p).filter(ok).map((it) => ({ id: it.id, part: p, item: it,
      keys: SINGLE[p] ? [E().keyOf(p, it.id, null, 0)] : it.questions.map((q, qi) => E().keyOf(p, it.id, q, qi)) }));
    return cache[p];
  }
  function unitById(id) {
    const p = E().partOfKey(id);
    return p ? unitsOf(p).filter((u) => u.id === id)[0] || null : null;
  }
  const answerOf = (u, qi) => (SINGLE[u.part] ? u.item.answer : u.item.questions[qi].answer);
  const isListen = (u) => Number(u.part) <= 4;

  /* ---------- 小工具 ---------- */
  const params = () => root.ITEM_PARAMS;
  const seed = () => String(root.__PROFILE_ID || 'guest');
  const today = () => E().dayNum(Date.now());
  /* global store:js/common.js 的頂層宣告(不在 window 上) */
  const db = () => (typeof store !== 'undefined' ? store : root.store);
  function readStore(k, d) { try { return db().get(k, d); } catch (e) { return d; } }
  function canKeep() { try { return typeof root.canKeepProgress !== 'function' || !!root.canKeepProgress(); } catch (e) { return false; } }
  function held(opener) { return typeof root.holdForAccount === 'function' && !!root.holdForAccount(opener); }
  function hasCourse() { return isPlain(readStore('plan', null)); }
  function offline() { return !!(root.navigator && root.navigator.onLine === false); }
  function selfFor(sec) { return S().selfOf(readStore('self_score', null), Date.now())[sec]; }
  function reserveIds() {
    if (!RESERVE_ON || !hasCourse() || typeof root.PLACEMENT_RESERVE !== 'function') return [];
    try { const r = root.PLACEMENT_RESERVE(); return Array.isArray(r) ? r : []; } catch (e) { return []; }
  }
  const itemsOf = (run, sec) => (run && Array.isArray(run.items) ? run.items : []).filter((it) => Array.isArray(it) && it[0] === sec && typeof it[1] === 'string');
  function answeredUnits(run, sec) {
    const out = [];
    itemsOf(run, sec).forEach((it) => { const id = it[1].split(':')[0]; if (out.indexOf(id) < 0) out.push(id); });
    return out;
  }
  const tmOf = (run, sec) => (run && isPlain(run.tm) && Array.isArray(run.tm[sec]) ? run.tm[sec] : null);
  const started = (run, sec) => !!tmOf(run, sec);
  const ended = (run, sec) => { const t = tmOf(run, sec); return !!(t && typeof t[1] === 'string' && t[1]); };

  /* 播過的題(這台裝置):{ pid, at, ids };讀寫失敗當作沒有 */
  function heardRead() {
    try {
      const v = JSON.parse(root.localStorage.getItem(HEARD_KEY) || 'null');
      return isPlain(v) && v.pid === seed() && st.run && v.at === st.run.at && Array.isArray(v.ids) ? v.ids.filter((x) => typeof x === 'string') : [];
    } catch (e) { return []; }
  }
  function heardAdd(id) {
    try {
      const ids = heardRead();
      if (ids.indexOf(id) < 0) ids.push(id);
      root.localStorage.setItem(HEARD_KEY, JSON.stringify({ pid: seed(), at: st.run.at, ids }));
    } catch (e) { /* 存不了:回來時可能再出同一題 */ }
  }

  /* ---------- 選題 ---------- */
  function avail(slot, fa, used) {
    return E().available({ units: unitsOf(slot.part), part: slot.part, size: slot.size, params: params(), fa, used, reserve: reserveIds(), reserveOn: RESERVE_ON && hasCourse() });
  }
  /* 這一科事先數好的格:用「這次作答以前」的第一次作答紀錄數,續做時跟開始時數的一樣 */
  function planFor(sec) {
    const ex = S().excludeFor(st.run.at), mine = {};
    (st.run.items || []).forEach((it) => { if (Array.isArray(it)) mine[it[1]] = true; });
    const i = {};
    Object.keys(ex.fa.i).forEach((k) => { if (!mine[k]) i[k] = ex.fa.i[k]; });
    return E().planSlots(SCRIPT[sec], (part, s) => avail(Object.assign({ part }, s), { v: 1, i }, []));
  }
  /* 下一格:每個 Part 已經答了幾組,依序對到格上;跳過的格不算 */
  function position(sec) {
    const done = {}, seen = {};
    answeredUnits(st.run, sec).forEach((id) => { const p = E().partOfKey(id); done[p] = (done[p] || 0) + 1; });
    for (let i = 0; i < st.plan.slots.length; i++) {
      const p = st.plan.slots[i].part;
      seen[p] = (seen[p] || 0) + 1;
      if (seen[p] > (done[p] || 0) && !st.skipSlots.has(i)) return i;
    }
    return -1;
  }
  function numbers(i) {
    let from = 1, total = 0;
    st.plan.slots.forEach((s, k) => {
      if (st.skipSlots.has(k)) return;
      if (k < i) from += s.size || 1;
      total += s.size || 1;
    });
    return { from, to: from + (st.plan.slots[i].size || 1) - 1, total };
  }
  function thetaOf(sec, fa) {
    try { return E().estimate(params(), sec, { fa, today: today(), self: selfFor(sec) }).theta; } catch (e) { return E().estimate(params(), sec, { fa, today: today() }).theta; }
  }
  function pick(sec, i, extra) {
    const slot = st.plan.slots[i];
    const ex = S().excludeFor(st.run.at);
    const pool = avail(slot, ex.fa, ex.used.concat(Array.from(st.skip), extra || []));
    if (!pool.length) return null;
    const first = answeredUnits(st.run, sec).length === 0;
    return E().pickUnit({ units: pool, params: params(), theta: E().startTheta(thetaOf(sec, ex.fa), first), seed: seed(), runAt: st.run.at, slot: slot.index });
  }
  /* 下一格如果是聽力,先把目前最可能出的那題音檔載進來 */
  function preloadNext(i) {
    let j = i + 1;
    while (j < st.plan.slots.length && st.skipSlots.has(j)) j++;
    if (j >= st.plan.slots.length || Number(st.plan.slots[j].part) > 4 || typeof root.Audio !== 'function') return;
    try {
      const u = pick(st.sec, j, [st.cur.unit.id]);
      if (!u) return;
      const a = new root.Audio();
      a.preload = 'auto';
      a.src = 'audio/' + u.id + '.mp3';
      st.preload = a;
    } catch (e) { /* 預先載入失敗不影響作答 */ }
  }

  /* ---------- 專心模式 ---------- */
  function leaveFocus() {
    if (st.cur && st.cur.player) st.cur.player.stop();
    if (st.focus) { st.focus.leave(); st.focus = null; }
  }
  function leaveTo() { leaveFocus(); root.location.href = st.onboard ? 'start.html' : 'drill.html'; }
  function askLeave() {
    if (st.asking) return;
    st.asking = true;
    const L = STR().leave;
    Promise.resolve(root.UI.confirm({ title: L.title, body: L.body, ok: L.ok, cancel: L.cancel })).then((yes) => { st.asking = false; if (yes) leaveTo(); });
  }
  /* 作答列的「離開」:先問一次(UI.focus 內建的問句是練習用的,這裡用檢測的字) */
  function hookClose(f) {
    if (!f.bar || typeof f.bar.addEventListener !== 'function') return;
    f.bar.addEventListener('click', (e) => {
      const t = e && e.target;
      if (!t || typeof t.closest !== 'function' || !t.closest('.quiz-close')) return;
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
      if (typeof e.preventDefault === 'function') e.preventDefault();
      askLeave();
    }, true);
  }
  function ensureFocus() {
    if (st.focus && st.focus.active) return;
    st.focus = root.UI.focus.enter({ total: 0, confirmExit: false, onExit: leaveTo });
    hookClose(st.focus);
  }
  function setCount(text) {
    const c = st.focus.bar && typeof st.focus.bar.querySelector === 'function' ? st.focus.bar.querySelector('.quiz-count') : null;
    if (c) c.textContent = text;
  }

  /* ---------- 作答 ---------- */
  function complete() {
    const c = st.cur;
    return !!c && c.phase === 'answer' && c.unit.keys.every((k, qi) => qi in c.sel);
  }
  function isLastSlot(i) {
    for (let k = i + 1; k < st.plan.slots.length; k++) if (!st.skipSlots.has(k)) return false;
    return true;
  }
  function onPick(qi, c) {
    if (!st.cur) return;
    st.cur.sel = Object.assign({}, st.cur.sel, { [qi]: c });
    st.focus.keep(paintUnit);
    st.focus.say('已選 ' + V().LETTERS[c]);
  }
  function paintUnit() {
    const c = st.cur, n = numbers(c.i);
    ensureFocus();
    st.focus.setTotal(n.total);
    st.focus.progress(n.to);
    setCount(V().countText(st.sec, n.from, n.to, n.total));
    st.root.replaceChildren(V().unitView(c.unit, c.sel, onPick, { player: c.player ? c.player.el : null, phase: c.phase }));
    const btn = el('button', { class: 'btn primary pl-next', type: 'button', 'data-gate': '', disabled: !complete() }, [isLastSlot(c.i) ? STR().finish : STR().next]);
    btn.addEventListener('click', submit);
    st.focus.foot([btn]);
  }
  function makePlayer(u) {
    const group = u.part === '3' || u.part === '4';
    return V().player('audio/' + u.id + '.mp3', {
      onStart: () => heardAdd(u.id),
      onEnd: () => {
        if (!group || !st.cur || st.cur.unit !== u) return;
        st.cur = Object.assign({}, st.cur, { phase: 'answer', t0: Date.now() });
        paintUnit();
        st.focus.focusMain();
      },
      onDead: () => swap(u),
    });
  }
  /* 載入失敗兩次:換同一個 Part 的另一題,這題不記 */
  function swap(u) {
    if (!st.cur || st.cur.unit !== u) return;
    st.skip.add(u.id);
    heardAdd(u.id);
    st.cur = null;
    showSlot();
  }
  function showSlot() {
    const i = position(st.sec);
    if (i < 0) { endSec(); return; }
    const u = pick(st.sec, i);
    if (!u) { st.skipSlots.add(i); showSlot(); return; }
    const group = u.part === '3' || u.part === '4';
    st.cur = { i, unit: u, sel: {}, t0: Date.now(), phase: group ? 'listen' : 'answer', player: null };
    if (isListen(u)) st.cur.player = makePlayer(u);
    paintUnit();
    if (typeof root.scrollTo === 'function') root.scrollTo(0, 0);
    st.focus.focusMain();
    preloadNext(i);
  }
  function submit(e) {
    const c = st.cur;
    if (!c || !complete() || st.busy) return;
    if (held(e && e.currentTarget)) return;
    const secs = (Date.now() - c.t0) / 1000 / c.unit.keys.length;
    const rows = c.unit.keys.map((key, qi) => ({ s: st.sec, key, choice: c.sel[qi], ok: c.sel[qi] === answerOf(c.unit, qi) ? 1 : 0, secs }));
    const run = S().answer(st.run.at, rows);
    if (!run) { root.UI.alert({ title: STR().saveFail }); return; }
    st.run = run;
    if (c.player) c.player.stop();
    st.cur = null;
    showSlot();
  }

  /* ---------- 一科的開始與結束 ---------- */
  function startSec(sec, note) {
    if (sec === 'L' && offline()) { note(STR().offline); return; }
    const run = S().beginSection(st.run.at, sec);
    if (!run) { note(STR().saveFail); return; }
    st.run = run;
    st.sec = sec;
    st.plan = planFor(sec);
    st.skipSlots = new Set();
    showSlot();
  }
  function endSec() {
    const sec = st.sec, run = S().endSection(st.run.at, sec);
    if (run) st.run = run;
    leaveFocus();
    st.cur = null;
    const other = sec === 'L' ? 'R' : 'L';
    if (st.run.sec === 'LR' && !started(st.run, other)) renderBetween(sec);
    else finish();
  }
  function pageHead(text) {
    const head = el('div', { class: 'page-head' }, [el('canvas', { class: 'hub-art', 'data-doodle': 'diagnostic', 'data-size': '40', 'aria-hidden': 'true' }), el('h1', null, [text || STR().title])]);
    if (root.UI && typeof root.UI.mount === 'function' && doc().readyState !== 'loading') root.UI.mount(head);
    return head;
  }
  function dropCard() { if (st.card) { st.card.destroy(); st.card = null; } }
  function paint(nodes) { dropCard(); st.root.replaceChildren(...nodes.filter(Boolean)); }
  function noteIn(node) { return (text) => { const n = node.querySelector('.pl-note'); if (n) n.textContent = text; }; }
  function renderBetween(done) {
    leaveFocus();
    const other = done === 'L' ? 'R' : 'L';
    let box = null;
    box = V().between(done, { onGo: () => { if (!held(box.querySelector('.pl-go'))) startSec(other, noteIn(box)); }, onLater: () => finish() });
    paint([pageHead(), box]);
    const h2 = box.querySelector('.pl-h2');
    if (h2 && typeof h2.focus === 'function') h2.focus();
  }
  function renderIntro(note) {
    leaveFocus();
    const runs = isPlain(readStore('placement_v1', null)) ? readStore('placement_v1', null) : null;
    const done = S().sectionsDone(runs);
    let box = null;
    box = V().intro({ sec: st.secParam, retest: done.L || done.R, onboard: st.onboard, note,
      onStart: () => begin(st.secParam === 'R' ? ['R'] : st.secParam === 'L' ? ['L'] : ['L', 'R'], box),
      onReadFirst: () => begin(['R', 'L'], box), onSkip: skipEntry });
    paint([pageHead(), box]);
  }
  function renderLoading() { paint([el('p', { class: 'result-note', role: 'status' }, [STR().loading])]); }
  async function begin(order, box) {
    if (st.busy || !root.UI) return;
    if (S().mode() === 'guest' || held(box && box.querySelector('.pl-go'))) return;   // 訪客:開始鈕的 data-gate 先請他登入
    let ord = order;
    if (ord[0] === 'L' && offline()) {
      if (ord.length === 1) { renderIntro(STR().offline); return; }
      ord = ['R', 'L'];
    }
    st.busy = true;
    try {
      try { await S().load(); } catch (e) { /* 讀不到雲端照本機的做 */ }
      const r = await S().startRun({ sec: st.secParam });
      if (!r || !r.run) { renderIntro(STR().saveFail); return; }
      st.run = r.run;
      st.skip = new Set();
      startSec(ord[0], (t) => renderIntro(t));
    } finally { st.busy = false; }
  }
  function resume(run) {
    st.run = run;
    st.skip = new Set(heardRead());
    const cur = ['L', 'R'].filter((s) => started(run, s) && !ended(run, s))[0];
    if (cur) {
      st.sec = cur;
      st.plan = planFor(cur);
      st.skipSlots = new Set();
      showSlot();
      return;
    }
    const done = ['L', 'R'].filter((s) => ended(run, s));
    if (run.sec === 'LR' && done.length === 1) renderBetween(done[0]);
    else if (done.length) finish();
    else startSec(run.sec === 'R' ? 'R' : 'L', (t) => renderIntro(t));
  }
  function skipEntry() {
    const D = root.ONBOARD_DATA;
    if (D && typeof D.chooseEntry === 'function' && D.chooseEntry() === 'ok') root.location.href = 'start.html?step=result';
  }

  /* ---------- 結果 ---------- */
  /* 做完的科補記結束時間:兩台(或上傳時跟雲端那份)合併時,同一次檢測沒有結束時間的兩份只留一份的 tm,
     先做完的那一科的結束時間可能被舊的那份蓋掉。整份的格都答完了就再記一次(endSection 只補沒有的) */
  function reEnd() {
    const keep = { sec: st.sec, plan: st.plan, skipSlots: st.skipSlots };
    ['L', 'R'].filter((s) => started(st.run, s) && !ended(st.run, s)).forEach((s) => {
      st.sec = s; st.plan = planFor(s); st.skipSlots = new Set();
      if (position(s) < 0) { const r = S().endSection(st.run.at, s); if (r) st.run = r; }
    });
    Object.assign(st, keep);
  }
  async function finish() {
    leaveFocus();
    renderLoading();
    try { reEnd(); } catch (e) { /* 補不了照樣看結果 */ }
    const at = st.run.at;
    let view = null;
    try { view = await S().finishRun(at); } catch (e) { view = null; }
    const runs = view && view.placement && Array.isArray(view.placement.runs) ? view.placement.runs : [];
    renderResult(view, runs.filter((r) => r && r.at === at)[0] || st.run, true);
  }
  function setLevels(next, done) {
    const C = root.ONBOARD_CORE, D = root.ONBOARD_DATA;
    if (!C || !canKeep()) return false;
    if (D && typeof D.setEstLevels === 'function') return D.setEstLevels(next.listening, next.reading) === 'ok';
    const cur = readStore('levels', null);
    const source = Object.assign({ listening: 'est', reading: 'est' }, isPlain(cur) && isPlain(cur.source) ? cur.source : {});
    done.forEach((s) => { source[LEVEL_KEY[s]] = 'est'; });
    db().set('levels', C.newLevels(cur, next.listening, next.reading, source, 'est', new Date().toISOString()));
    return true;
  }
  /* 寫不寫級別:這次做完、有數字的科照預估對回四級;另一科不動。
     有課程進度、已經設定過、不是在新用戶設定裡:不寫,回 suggest(結果頁給「改成這個級別」) */
  function applyLevels(view, run) {
    const C = root.ONBOARD_CORE;
    if (!C) return {};
    const cur = readStore('levels', null);
    const done = ['L', 'R'].filter((s) => ended(run, s) && view[s] && view[s].show);
    if (!done.length) return {};
    const next = { listening: isPlain(cur) ? cur.listening : null, reading: isPlain(cur) ? cur.reading : null };
    done.forEach((s) => { next[LEVEL_KEY[s]] = view[s].band; });
    if (!C.levelsSet(next)) return {};
    const same = isPlain(cur) && cur.listening === next.listening && cur.reading === next.reading;
    if (C.levelsSet(cur) && hasCourse() && !st.onboard) return same ? {} : { suggest: next, done };
    return { wrote: setLevels(next, done) };
  }
  function levelLinks(lv, view, run) {
    if (lv.suggest) {
      return { label: STR().applyLevel, onClick: () => root.ESTIMATE_UI.confirmLevel(true).then((ok) => { if (ok && setLevels(lv.suggest, lv.done)) renderResult(view, run, false); }) };
    }
    const U = root.ONBOARD_UI, D = root.ONBOARD_DATA;
    if (!U || typeof U.levelPanel !== 'function' || !D) return null;
    return { label: STR().levels, onClick: () => U.levelPanel({ levels: readStore('levels', null), onApply: (l, r) => D.applyManual(l, r) === 'ok' }) };
  }
  function reviewOf(run) {
    const answers = {}, units = [];
    ['L', 'R'].forEach((s) => itemsOf(run, s).forEach((it) => {
      answers[it[1]] = it[2];
      const u = unitById(it[1].split(':')[0]);
      if (u && units.indexOf(u) < 0) units.push(u);
    }));
    if (!units.length) return null;
    const d = root.UI.detail(STR().review, V().review(units, answers), { wrong: 0 });   // 標題不寫答錯幾題(結果頁不顯示答對題數)
    d.classList.add('pl-review');
    return d;
  }
  function renderResult(view, run, fresh) {
    leaveFocus();
    if (!view || !view.ok) {
      paint([pageHead(), root.UI.empty({ text: STR().none, action: { label: STR().start, onClick: () => renderIntro(), primary: true } })]);
      return;
    }
    const lv = fresh ? applyLevels(view, run) : {};
    const C = root.ONBOARD_CORE;
    const link = C && typeof C.practiceLink === 'function' ? C.practiceLink(readStore('levels', null)) : null;
    const primary = st.onboard ? { label: STR().nextStep, href: 'start.html?step=result' } : { label: STR().practice, href: link || 'learn.html' };
    const det = run ? reviewOf(run) : null;
    const links = [levelLinks(lv, view, run), det ? { label: STR().review, onClick: () => { det.open = true; if (typeof det.scrollIntoView === 'function') det.scrollIntoView({ block: 'start' }); } } : null,
      fresh ? null : { label: STR().retestLink, onClick: () => renderIntro() }];
    const card = root.ESTIMATE_UI.result({ view, primary, links, earnId: 'placement' });
    paint([pageHead(), card ? card.el : null, det]);
    st.card = card;
    if (fresh && card && root.PET_HOOK) root.PET_HOOK.done('placement', { into: card.reward });
  }
  async function showLast() {
    renderLoading();
    let view = null;
    try { view = await S().load(); } catch (e) { view = null; }
    const runs = view && view.placement && Array.isArray(view.placement.runs) ? view.placement.runs.slice() : [];
    const run = runs.filter((r) => r && Array.isArray(r.items) && r.items.length).sort((a, b) => (a.at < b.at ? 1 : -1))[0] || null;
    renderResult(view, run, false);
  }

  /* ---------- 開頁 ---------- */
  function readParams() {
    let q = null;
    try { q = new root.URLSearchParams(root.location.search || ''); } catch (e) { return {}; }
    const out = { sec: q.get('sec'), start: q.get('start') === '1', from: q.get('from'), view: q.get('view') };
    if (out.start) {
      q.delete('start');
      const rest = q.toString();
      try { root.history.replaceState(null, '', root.location.pathname + (rest ? '?' + rest : '') + (root.location.hash || '')); } catch (e) { /* 網址留著也照常 */ }
    }
    return out;
  }
  /* ?start=1:等雲端確認登入(最多 AUTO_WAIT),能寫就直接開始,不然畫開始頁 */
  function autoStart() {
    renderLoading();
    let settled = false;
    const timer = root.setTimeout(() => go(false), AUTO_WAIT);
    function go(ok) {
      if (settled) return;
      settled = true;
      root.clearTimeout(timer);
      if (root.CLOUD && root.CLOUD.reloading) return;
      const act = S().activeRun();
      if (act) resume(act);
      else if (ok && canKeep() && S().mode() !== 'guest') begin(['L', 'R'], null);
      else renderIntro();
    }
    Promise.resolve(root.CLOUD ? root.CLOUD.ready : null).then(() => go(true), () => go(false));
  }
  function boot() {
    const box = doc().getElementById('pl-root');
    if (!box) return;
    st.root = box;
    if (!root.UI || !root.ITEM_PARAMS || !root.ESTIMATE_STORE || !root.ESTIMATE_UI || !root.PLACEMENT_VIEWS || !root.TOEIC) {
      if (typeof root.uiReady === 'function' && !root.uiReady()) return;
      box.replaceChildren(el('div', { class: 'page-head' }, [el('h1', null, ['程度檢測'])]), root.UI.empty({ text: '檢測題庫準備中', action: { label: '重新整理', onClick: () => root.location.reload() } }));
      return;
    }
    const p = readParams();
    st.secParam = p.sec === 'L' || p.sec === 'R' ? p.sec : 'LR';
    st.onboard = p.from === 'onboard';
    if (p.view === 'last') { showLast(); return; }
    const act = S().activeRun();
    if (act) resume(act);
    else if (p.start) autoStart();
    else renderIntro();
  }

  root.PLACEMENT = Object.freeze({ SCRIPT, HEARD_KEY, unitsOf, boot, state: () => st });
  if (doc() && doc().readyState === 'loading') doc().addEventListener('DOMContentLoaded', boot);
  else if (doc()) boot();
})(typeof window !== 'undefined' ? window : globalThis);
