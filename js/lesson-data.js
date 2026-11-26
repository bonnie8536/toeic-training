/* 課程頁的讀寫:讀學習包與字表、查試行班(這個分頁的 sessionStorage 鍵 lsn_pilot)、讀每堂進度、建立進度與學習計畫 plan(含補凍結)、
   組選題的 ctx(含下一次小檢核的預留題)、凍結、記作答、段的狀態、pts／rvq／tests_v1 的排隊寫入、syncPractice、作答前的紀錄快照、個人段試排、
   前測的最後畫面時間(sessionStorage 鍵 lsn_clock)。
   課程頁的檔裡只有這一支寫 store、讀寫 sessionStorage;進度鍵一律經過 js/pack-core.js 的 loadLesson、saveLesson、saveLessonLocal(先合併雲端那一份)。
   載入時不依賴其他檔:LESSON_CORE、PACK_CORE、LESSON_RULES、BANK、CLASSES、CLOUD、store 都在函式裡才用,首頁可以只載 lesson-core.js 與這一支就判定試行班。
   sessionStorage 的兩個鍵不是 tr_ 開頭,搬家不管;讀寫不到就當沒有(重查班級、退回用最後作答時間)。
   時間:now 是 epoch 秒;作答紀錄、學習記錄的 t 是毫秒。today 是這台的當地日期(PACK_CORE.dayOf)。 */
(function (root) {
  'use strict';
  const FILE = { LESSON_CORE: 'js/lesson-core.js', PACK_CORE: 'js/pack-core.js', LESSON_RULES: 'js/lesson-rules.js', BANK: 'js/bank.js' };
  function need(name) {
    const x = root[name];
    if (!x) throw new Error('要先載入 ' + FILE[name]);
    return x;
  }
  const core = () => need('LESSON_CORE');
  const pack = () => need('PACK_CORE');
  const rules = () => need('LESSON_RULES');
  const nowSec = () => Math.floor(Date.now() / 1000);
  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  function hasStore() { return typeof store !== 'undefined' && store && typeof store.get === 'function'; }   // js/common.js 的 store

  /* ---------- 學習包、字表、小檢核清單(同一頁只讀一次;讀不到不記,下次重讀) ---------- */
  const SRC = {
    pack: { entry: 'data/packs/pack_entry.json', threshold: 'data/packs/pack_threshold.json' },
    words: { entry: 'data/packs/words_entry.json', threshold: 'data/packs/words_threshold.json' },
    pool: 'data/packs/checkpoint_pool.json',
  };
  const files = new Map();
  const mem = { packs: null, words: {}, pool: null };
  function getJson(url) {
    if (files.has(url)) return files.get(url);
    const p = Promise.resolve().then(() => root.fetch(url)).then((r) => {
      if (!r || !r.ok) throw Object.assign(new Error('讀不到 ' + url), { status: r ? r.status : 0 });
      return r.json();
    }).catch((e) => {
      files.delete(url);
      console.error(url, e && e.status !== undefined ? e.status : e);
      throw e;
    });
    files.set(url, p);
    return p;
  }
  /* 回 { packs: { entry, threshold }, words: { entry, threshold }, pool };opt.lite 只讀兩包學習包(首頁、課程總覽),words、pool 是 null */
  async function packs(opt) {
    const [entry, threshold] = await Promise.all([getJson(SRC.pack.entry), getJson(SRC.pack.threshold)]);
    mem.packs = { entry, threshold };
    if (opt && opt.lite) return { packs: mem.packs, words: null, pool: null };
    const [we, wt, pool] = await Promise.all([getJson(SRC.words.entry), getJson(SRC.words.threshold), getJson(SRC.pool)]);
    mem.words = { entry: we, threshold: wt };
    mem.pool = pool;
    return { packs: mem.packs, words: mem.words, pool };
  }

  /* ---------- 試行班 ---------- */
  const PILOT_KEY = 'lsn_pilot', CLOCK_KEY = 'lsn_clock', PILOT_TIMEOUT_MS = 8000;
  function sGet(k) { try { return root.sessionStorage.getItem(k); } catch (e) { return null; } }
  function sSet(k, v) { try { root.sessionStorage.setItem(k, v); } catch (e) { /* 存不進去:下次開頁重查 */ } }
  function readJson(raw) { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
  /* 帳號:雲端帳號的資料夾(c 開頭),或還沒換資料夾時的 CLOUD.user */
  function accountId() {
    const pid = root.__PROFILE_ID;
    if (typeof pid === 'string' && pid.charAt(0) === 'c') return pid;
    const C = root.CLOUD;
    return C && C.user && typeof C.user.id === 'string' ? 'u' + C.user.id : null;
  }
  function readPlan() { return hasStore() ? store.get('plan', null) : null; }
  function pilotInput(membership) {
    const id = accountId();
    const c = readJson(sGet(PILOT_KEY));
    return {
      ui: root.PACKS_UI, pilotIds: Array.isArray(root.PACKS_PILOT_CLASSES) ? root.PACKS_PILOT_CLASSES : [], signedIn: !!id,
      teacher: !!(root.CLOUD && root.CLOUD.isTeacher), plan: id ? readPlan() : null,
      cached: id && isPlain(c) && c.p === id ? c : null, membership,
    };
  }
  /* 不連網就判得出來的(第 1–7 列與快取);要查班級名單時是 'checking' */
  function pilotNow() { return core().pilotState(pilotInput()); }
  async function listClasses() {
    const K = root.CLASSES;
    if (!K || !K.api || typeof K.api.list !== 'function') return { ok: false };
    let timer = null;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false }), PILOT_TIMEOUT_MS); });
    try { return (await Promise.race([K.api.list(), timeout])) || { ok: false }; } catch (e) { return { ok: false }; } finally { clearTimeout(timer); }
  }
  async function checkPilot() {
    const first = pilotNow();
    if (first.state !== 'checking') return first;
    const C = root.CLOUD;
    if (C && C.ready) { try { await C.ready; } catch (e) { /* 照下面判 */ } }
    const again = pilotNow();                       // 登入、老師身分在 CLOUD.ready 之後才確定
    if (again.state !== 'checking' || (C && C.reloading)) return again;
    const out = core().pilotState(pilotInput(await listClasses()));
    if (out.state === 'pilot' || out.state === 'no') sSet(PILOT_KEY, JSON.stringify({ p: accountId(), s: out.state, c: out.classId }));
    return out;
  }
  let pilotRun = null;
  /* 判定試行班(同一頁同時叫只查一次);查到 pilot 或 no 記在這個分頁工作階段,unknown 不記 */
  function pilot() {
    if (!pilotRun) pilotRun = checkPilot().finally(() => { pilotRun = null; });
    return pilotRun;
  }

  /* ---------- 進度 ---------- */
  function termOf(plan) { return isPlain(plan) && Number.isInteger(plan.term) && plan.term >= 1 && plan.term <= 99 ? plan.term : 1; }
  const curTerm = () => termOf(readPlan());
  /* 上課用的級別(兩科的進階、高分換成門檻);沒有起始程度回 null */
  function levels() { return core().courseLevels(store.get('levels', null)); }
  function localLesson(term, no) {
    const lessonKey = pack().lessonKey;
    return store.get(lessonKey(term, no), null);
  }
  /* 本機的 24 堂進度 { 堂號: 進度 }(沒有進度的堂不放) */
  function states() {
    const term = curTerm(), out = {};
    for (let no = 1; no <= 24; no++) { const s = localLesson(term, no); if (s) out[no] = s; }
    return out;
  }
  /* 開堂:本機與雲端合併 → { state, cloudRead } */
  function open(no) { return pack().loadLesson(curTerm(), no); }
  function warnOver(r, no) { if (r && r.over) console.warn('第 ' + no + ' 堂的進度超過 5 KB：', r.trimmed); }
  /* 補凍結:s 沒有就用選題那份;s 已經有(另一台先開了)就保留它的 startedAt 與已凍結的格,只補沒有的格 */
  function fillFrozen(s, picked, now) {
    if (!picked) throw new TypeError('要給選題的結果');
    if (!s) return picked;
    const P = pack();
    return Object.keys(picked.pk || {}).reduce((acc, k) => {
      if (acc.pk && acc.pk[k]) return acc;
      const e = picked.pk[k], extra = Object.assign({}, e);
      delete extra.at; delete extra.ids;
      return P.freeze(acc, Number(k), e.ids || [], now, extra);
    }, s);
  }
  function planOf(lesson, classId, now) {
    const lv = lesson.levels, pv = lesson.packVersion;
    return {
      v: 1, source: 'self', classId: classId || null,
      packs: { listening: 'pack-' + lv.listening + '-v1', reading: 'pack-' + lv.reading + '-v1' },
      packVersions: { listening: pv.listening, reading: pv.reading },
      startDate: pack().dayOf(now), lessonsPerWeek: null, mainDay: new Date(now * 1000).getDay(), extDay: null,
      term: 1, postponedWeeks: 0, previous: null, updatedAt: Date.now(),
    };
  }
  /* 按「開始」:建立進度與凍結選題同一次寫(picked 是選題後的進度,選題丟錯時什麼都沒寫);第 1 堂同一次把聽力測驗設成作答中,
     沒有 plan 時寫一次 plan。回寫出的進度 */
  async function start(no, lesson, now, classId, picked) {
    const P = pack();
    const r = await P.saveLesson(curTerm(), no, (s) => {
      const st = fillFrozen(s, picked, now);
      const seg = st.seg && st.seg.test_listening;
      return lesson.kind === 'test' && seg && seg.st === 'todo' ? P.setSegment(st, lesson, 'test_listening', 'doing', now) : st;
    }, { lesson });
    warnOver(r, no);
    if (no === 1 && !readPlan()) store.set('plan', planOf(lesson, classId, now));
    return r.state;
  }

  /* 個人段(回顧 80–84、弱點補練 85–89、前測檢討 90–97)的選題寫進進度:range = [起, 迄)。
     整段取先凍結的那一份:另一台已經凍結了這一段的任一格就用它的,不拼接;沒有才把 picked 在這一段的格補進去 */
  function takePersonal(s, picked, range) {
    if (!s) return picked;
    const inRange = (k) => Number(k) >= range[0] && Number(k) < range[1];
    if (Object.keys(s.pk || {}).some(inRange)) return s;
    const pk = Object.assign({}, s.pk);
    Object.keys(picked.pk || {}).filter(inRange).forEach((k) => { pk[k] = picked.pk[k]; });
    return Object.assign({}, s, { pk });
  }
  async function freeze(no, lesson, picked, range) {
    if (!picked || !Array.isArray(range) || range.length !== 2) throw new TypeError('要給選題的結果與區塊範圍');
    const r = await pack().saveLesson(curTerm(), no, (s) => takePersonal(s, picked, range), { lesson });
    warnOver(r, no);
    return r.state;
  }

  /* ---------- 選題 ---------- */
  const REC = {
    1: () => store.get('listen_p1', {}), 2: () => store.get('listen_p2', {}), 3: () => store.get('listen_p3', {}), 4: () => store.get('listen_p4', {}),
    5: () => store.get('drill_p5', {}), 6: () => store.get('drill_p6', {}), 7: () => store.get('drill_p7', {}),
  };
  /* 練習引擎寫的作答紀錄(drill_p*、listen_p*):即時回合補回只能看這些(模擬考在別的分頁剛交卷的不算這一回合的作答) */
  function roundRecords() {
    const out = {};
    Object.keys(REC).forEach((p) => { const v = REC[p](); out[p] = isPlain(v) ? v : {}; });
    return out;
  }
  /* 模擬考作答過的題(js/mock.js 交卷時寫):{ 題目 key: 交卷時間(毫秒) } */
  function mockSeen() {
    const v = hasStore() ? store.get('mock_seen', null) : null;
    return isPlain(v) ? v : {};
  }
  /* 選題用的作答紀錄(新物件):每個 Part 先放模擬考作答過的題 { ok, t }(mock_wrong 同一題答錯而且時間不比它舊時 ok 是 false),
     再用練習紀錄蓋上去(兩邊都有取 t 大的)。模擬考做過的題因此在課程裡算做過:小檢核不選、練習排在後面、14 天內做過照放寬規則 */
  function practiceRecords() {
    const round = roundRecords(), seen = mockSeen(), wrong = store.get('mock_wrong', null), out = {};
    Object.keys(round).forEach((p) => { out[p] = {}; });
    Object.keys(seen).forEach((k) => {
      const t = Number(seen[k]), p = core().partOfId(k.split(':')[0]), w = isPlain(wrong) ? wrong[k] : null;
      if (p && out[p] && Number.isFinite(t)) out[p][k] = { ok: !(isPlain(w) && w.ok === false && Number(w.t) >= t), t };
    });
    Object.keys(round).forEach((p) => Object.keys(round[p]).forEach((k) => {
      const r = round[p][k], m = out[p][k];
      if (!m || !(m.t > Number(r && r.t))) out[p][k] = r;
    }));
    return out;
  }
  /* 引導流程的聽力短測做過的 8 題(onboard.listen.ids 有 8 個字串才算);沒有回 [] */
  function shortIds() {
    const o = hasStore() ? store.get('onboard', null) : null;
    const ids = isPlain(o) && isPlain(o.listen) && Array.isArray(o.listen.ids) ? o.listen.ids : [];
    return ids.length === 8 && ids.every((id) => typeof id === 'string' && id) ? ids.slice() : [];
  }
  /* 本期前測的全部題(tests_v1 的 items,加上第 1 堂凍結的前測題),加上聽力短測的 8 題(跟前測題一樣:小檢核不選、練習排在後面) */
  function pretestIds() {
    const term = curTerm();
    const t = store.get('tests_v1', null), pre = isPlain(t) && isPlain(t['t' + term]) ? t['t' + term].pre : null;
    const ids = isPlain(pre) && Array.isArray(pre.items) ? pre.items.map((x) => x && x[0]) : [];
    const s = localLesson(term, 1);
    [0, 1].forEach((i) => { const e = s && s.pk ? s.pk[i] : null; (e && Array.isArray(e.ids) ? e.ids : []).forEach((id) => ids.push(id)); });
    shortIds().forEach((id) => ids.push(id));
    return ids.filter((id, i) => typeof id === 'string' && ids.indexOf(id) === i);
  }
  /* 14 天內做過的題(題組取組 id),加上前測的題 */
  function seenIds(records, nowMs, testIds) {
    const from = nowMs - 14 * 864e5, out = new Set(testIds);
    Object.keys(records).forEach((p) => Object.keys(records[p] || {}).forEach((k) => {
      const r = records[p][k];
      if (r && Number(r.t) >= from) out.add(k.split(':')[0]);
    }));
    return Array.from(out);
  }
  /* 之後兩次小檢核的預留題(PACK_CORE.reserveFor,回 { ids, near, far }):有帳號才有,種子用帳號的資料夾名稱(雲端帳號 c 開頭、不含連字號);
     做過聽力短測的帳號,清單先扣掉那 8 題。同一頁同一組條件只算一次。算不出來(例如題目索引沒載入)就這次不預留,照原本的選題 */
  const reserves = new Map();
  function reserveOf(lesson) {
    const id = accountId();
    if (!id || !mem.packs || !mem.pool || !Array.isArray(mem.pool.ids)) return undefined;
    const account = id.charAt(0) === 'u' ? 'c' + id.slice(1).replace(/-/g, '') : id;
    const short = shortIds(), pool = mem.pool.ids.filter((id) => short.indexOf(id) < 0);
    const key = [account, lesson.no, lesson.levels.listening, lesson.levels.reading, short.length ? 'short' : ''].join('|');
    return () => {
      if (!reserves.has(key)) {
        const run = Promise.resolve().then(() => pack().reserveFor(mem.packs, lesson.levels, lesson.no, { account, pool, bank: root.BANK }))
          .catch((e) => { reserves.delete(key); console.warn('預留題算不出來，這次不預留：', e); return []; });
        reserves.set(key, run);
      }
      return reserves.get(key);
    };
  }
  /* 選題的 ctx(要先 await packs() 才有字表與小檢核清單) */
  function ctx(lesson, now) {
    const records = practiceRecords(), testIds = pretestIds();
    const words = mem.words[lesson.levels.reading];
    return {
      bank: root.BANK, records, seen: seenIds(records, now * 1000, testIds),
      checkpointPool: mem.pool && Array.isArray(mem.pool.ids) ? mem.pool.ids.filter((id) => testIds.indexOf(id) < 0) : undefined,
      reserve: reserveOf(lesson),
      ear: root.TOEIC && root.TOEIC.ear,
      earRecords: { ear_d: store.get('ear_d', {}) || {}, ear_mp: store.get('ear_mp', {}) || {}, ear_n: store.get('ear_n', {}) || {}, ear_s: store.get('ear_s', {}) || {} },
      weekWords: words ? core().weekWordsFrom(words) : undefined, random: Math.random, now,
    };
  }
  /* 前測組卷:照配額 BANK.pick(不限難度、沒做過的先),Part 1→7 排成兩個 id 陣列 → { 0: 聽力, 1: 閱讀 }。
     先避開下一次小檢核的預留題(c.reserve),不夠才用 */
  async function testForm(c) {
    const B = c.bank || need('BANK'), Q = core().TEST_QUOTA, out = {};
    const hold = await pack().reserved(c);
    for (const slot of ['test_listening', 'test_reading']) {
      const ids = [];
      for (const [part, n] of Q[slot].parts) {
        const spec = { part, order: 'fresh', records: (c.records || {})[part] || {}, random: c.random };
        const got = await B.pick(Object.assign({ n, exclude: hold }, spec));
        if (got.length < n && hold.length) (await B.pick(Object.assign({}, spec, { n: n - got.length, exclude: got }))).forEach((id) => got.push(id));
        got.forEach((id) => ids.push(id));
      }
      out[Q[slot].idx] = ids;
    }
    return out;
  }
  const sameFrozen = (a, b) => JSON.stringify(Object.keys(a.pk || {}).sort()) === JSON.stringify(Object.keys(b.pk || {}).sort());
  /* 開頁補凍結:一般堂 pickFixed 補還沒凍結的;前測(kind 'test')缺 0 或 1 就重新組卷、只補缺的那一格(c.assemble 有給就用它)。沒變不寫 */
  async function fillFixed(no, lesson, state, c) {
    if (!state) return state;
    const P = pack();
    let picked;
    if (lesson.kind === 'test') {
      if (state.pk && state.pk[0] && state.pk[1]) return state;
      const form = await (typeof c.assemble === 'function' ? c.assemble(c) : testForm(c));
      picked = [0, 1].reduce((s, i) => P.freeze(s, i, form[i] || [], c.now), state);
    } else {
      const r = await P.pickFixed(lesson, state, c);
      if (r.need && r.need.length) console.info('選題不夠或放寬過：', r.need);
      picked = r.state;
    }
    if (sameFrozen(picked, state)) return state;
    const out = await P.saveLesson(curTerm(), no, (s) => fillFrozen(s || picked, picked, c.now), { lesson });
    warnOver(out, no);
    return out.state;
  }

  /* ---------- 個人段要的資料(回顧、弱點補練、前測檢討) ---------- */
  const finished = (state, slot) => !!(state && state.seg && state.seg[slot] && (state.seg[slot].st === 'done' || state.seg[slot].st === 'skip'));
  const frozenIn = (state, from, to) => Object.keys((state && state.pk) || {}).map(Number).some((i) => i >= from && i < to);
  /* pts(重算過的)、rvq、tests_v1、題目索引(id → 那一列);讀雲端最久 8 秒 */
  async function inputs(now) {
    const P = pack(), today = P.dayOf(now);
    const [pts, rvq, tests, rows] = await Promise.all([P.loadShared('pts', today), P.loadShared('rvq', today), P.loadShared('tests_v1', today), need('BANK').meta()]);
    return { today, pts, rvq, tests, meta: new Map(rows.map((r) => [r.id, r])) };
  }
  function keyOfEntry(e, meta) {
    const row = meta.get(e.id), keys = row ? rules().keysOfRow(row) : [];
    return keys[e.sub ? e.sub - 1 : 0] || null;
  }
  function secondsOf(e, meta) {
    const R = rules(), S = R.PRACTICE_SECONDS;
    if (e.k) { const w = R.bankWhere(e.k), p = w ? w.part : '5'; return S[p] * (R.isGroupKey(e.k) ? 1 : 3); }
    const p = String(e.m || '').replace(/^p/, ''), row = meta.get(e.id);
    return /^[3467]$/.test(p) && row && row.size ? S[p] / row.size : S[p] || 0;
  }
  /* LESSON_RULES.pickReview 的 opt(回呼是同步的,只查題目索引) */
  function reviewOpt(seg, inp) {
    const R = rules();
    return {
      today: inp.today, seconds: seg.minutes * 60, maxUnits: seg.maxUnits || 12,
      secondsOf: (e) => secondsOf(e, inp.meta), keyOf: (e) => keyOfEntry(e, inp.meta), accuracy: (k) => R.accuracyOf(inp.pts[k], inp.today),
    };
  }
  /* 回顧已經凍結的秒數(換裝置時從 80–84 重算;沒有凍結是 0) */
  function frozenReviewSeconds(state, inp) {
    const pk = (state && state.pk) || {};
    let sec = 0;
    const redo = pk[80];
    if (redo && Array.isArray(redo.ids)) redo.ids.forEach((id, i) => { sec += secondsOf({ id, m: (redo.m || [])[i], sub: (redo.sub || [])[i] }, inp.meta); });
    [81, 82, 83, 84].forEach((i) => { const k = pk[i] && /^point_review:(.+)$/.exec(pk[i].r || ''); if (k) sec += secondsOf({ k: k[1] }, inp.meta); });
    return sec;
  }
  /* 前測各 Part 的 { n, ok }:tests_v1 有就用,沒有從第 1 堂的進度算 */
  function testParts(inp) {
    const t = inp.tests && inp.tests['t' + curTerm()];
    if (t && t.pre && isPlain(t.pre.parts)) return t.pre.parts;
    const s = localLesson(curTerm(), 1);
    return s ? core().partsOf(s, (id) => (inp.meta.get(id) || {}).size, (k, id) => inp.meta.has(id)) : {};
  }
  function doneUnits() {
    const G = root.GRAMMAR, list = (root.TOEIC && root.TOEIC.grammar) || [];
    if (G && typeof G.done === 'function') return new Set(list.map((u) => u.id).filter((id) => !!G.done(id)));
    return new Set(Object.keys(store.get('grammar_done', {}) || {}));
  }
  /* LESSON_RULES.planWeak 的 opt。reviewUsed:回顧已排的秒數(null 時看凍結的);沒用完的回顧秒數給弱點補練 */
  function weakOpt(no, lesson, state, inp, reviewUsed) {
    const seg = (s) => lesson.segments.filter((x) => x.slot === s)[0];
    const rv = seg('review'), wk = seg('weak');
    const used = reviewUsed === null || reviewUsed === undefined ? frozenReviewSeconds(state, inp) : reviewUsed;
    const f = no < 24 && mem.packs ? pack().compose(mem.packs, lesson.levels, no + 1).focus : null;
    return {
      pts: inp.pts, levels: lesson.levels, today: inp.today, doneUnits: doneUnits(),
      seconds: (wk ? wk.minutes * 60 : 0) + Math.max(0, (rv ? rv.minutes * 60 : 0) - used),
      fallback: { testParts: testParts(inp), nextFocus: f ? f.listening.concat(f.reading) : [] },
    };
  }
  /* 段落總覽的試排(不寫任何鍵):回 { review, weak } 題數,不用試排的段是 null */
  async function trial(no, lesson, state) {
    const R = rules();
    const seg = (s) => lesson.segments.filter((x) => x.slot === s)[0];
    const rv = seg('review'), wk = seg('weak');
    const rvOpen = !!rv && !finished(state, 'review') && !frozenIn(state, 80, 85);
    const wkOpen = !!wk && !finished(state, 'weak') && !frozenIn(state, 85, 90);
    if (!rvOpen && !wkOpen) return { review: null, weak: null };
    const inp = await inputs(nowSec());
    let review = null, used = null, weak = null;
    if (rvOpen) { const r = R.pickReview(inp.rvq, reviewOpt(rv, inp)); review = r.units.length; used = r.seconds; }
    if (wkOpen) weak = R.planWeak(weakOpt(no, lesson, state, inp, used)).reduce((a, p) => a + (p.base ? 1 : 0) + R.weakCount(p), 0);
    return { review, weak };
  }

  /* ---------- 作答與段 ---------- */
  /* 每答一題(單字、前測)或一回合交卷:只寫本機。rows = [{ b, id, sub, c, ok, f, t }] */
  function record(no, lesson, rows) {
    const P = pack(), term = curTerm();
    if (!localLesson(term, no)) throw new Error('第 ' + no + ' 堂還沒開始');
    const f = P.saveLessonLocal(term, no, (s) => (rows || []).reduce((acc, r) => P.answer(acc, r), s), { lesson });
    warnOver(f, no);
    return f.state;
  }
  /* 段的狀態(先讀雲端合併,之後一律用回傳的進度) */
  async function segment(no, lesson, slot, st, now) {
    const P = pack();
    const r = await P.saveLesson(curTerm(), no, (s) => {
      if (!s) throw new Error('第 ' + no + ' 堂還沒開始');
      return P.setSegment(s, lesson, slot, st, now);
    }, { lesson });
    warnOver(r, no);
    return r.state;
  }
  /* 回合開始前:這幾題(作答紀錄的鍵)哪些已經有紀錄(練習紀錄或模擬考作答過) */
  function snapshot(part, keys) {
    const get = REC[String(part).replace(/^[pPlL]/, '')];
    const rec = get ? get() || {} : {}, seen = mockSeen();
    return new Set((keys || []).filter((k) => !!rec[k] || seen[k] !== undefined));
  }
  function sync(keys) { return pack().syncPractice(keys); }

  /* ---------- pts、rvq、tests_v1:一條排隊,照順序寫、不擋畫面 ---------- */
  let queue = Promise.resolve();
  function enqueue(fn) {
    const run = queue.then(fn);
    queue = run.then(() => undefined, (e) => { console.error('課程紀錄寫入失敗：', e); });
    return run.then((v) => v, () => null);
  }
  /* 這一批記之前、記之後的狀態比對,變成過關的鍵 */
  function newlyPassed(before, after, today) {
    const R = rules();
    return Object.keys(after || {}).filter((k) => R.statusOf(k, after[k], today) === 'passed' && R.statusOf(k, (before || {})[k], today) !== 'passed');
  }
  function rvqWrite(today, fn) { return pack().saveShared('rvq', fn, today); }
  /* 回顧規劃:同一個 rvq 寫入裡選項目(LESSON_RULES.pickReview),排在前面的寫入之後。回 pickReview 的結果 */
  function planReview(opt, d) {
    const today = dayNow(d);
    return enqueue(async () => {
      let out = null;
      await rvqWrite(today, (q) => { out = rules().pickReview(q, opt); return out.rvq; });
      return out;
    });
  }
  /* 沒給日期就用今天(這台的當地日期) */
  const dayNow = (today) => today || pack().dayOf(nowSec());
  /* 一批作答記進 pts(opt = { today, src, b });變成過關的考點接著排考點回顧。回變成過關的鍵 */
  function hits(answers, opt) {
    const o = Object.assign({}, opt, { today: dayNow(opt && opt.today) });
    return enqueue(async () => {
      let up = [];
      await pack().saveShared('pts', (p) => { const next = rules().addHits(p, answers, o); up = newlyPassed(p, next, o.today); return next; }, o.today);
      if (up.length) await rvqWrite(o.today, (q) => up.reduce((a, k) => rules().schedulePassed(a, k, o.today), q));
      return up;
    });
  }
  /* 答錯的題排回顧(refs = [{ m, id, sub }]) */
  function wrong(refs, d) {
    const today = dayNow(d);
    return enqueue(() => (refs && refs.length ? rvqWrite(today, (q) => refs.reduce((a, r) => rules().scheduleWrong(a, r, today), q)) : null));
  }
  function passed(keys, d) {
    const today = dayNow(d);
    return enqueue(() => (keys && keys.length ? rvqWrite(today, (q) => keys.reduce((a, k) => rules().schedulePassed(a, k, today), q)) : null));
  }
  /* 回顧做完的項目(items = [{ entry, ok }]) */
  function reviewed(items, d) {
    const today = dayNow(d);
    return enqueue(() => (items && items.length ? rvqWrite(today, (q) => items.reduce((a, x) => rules().reviewDone(a, x.entry, x.ok, today), q)) : null));
  }
  /* 小檢核判定:同一個 pts 寫入裡先判再記(src 'c'、b '<進度鍵>:cp'),接著答錯的題排回顧、會過關的考點排考點回顧。
     answers = [{ key, ok, first: true, m, id, sub }](檢核區塊全部可作答的小題,沒作答算錯)。已經判過就不再判、不再排。
     回 { fresh(這次判的), verdicts: [{ key, verdict, passes }] } */
  function checkpoint(no, answers, d) {
    const today = dayNow(d), b = pack().lessonKey(curTerm(), no) + ':cp';
    return enqueue(async () => {
      let out = null;
      await pack().saveShared('pts', (p) => {
        if (core().judged(p, b)) { out = { fresh: false, verdicts: core().verdictsOf(p, b) }; return p; }
        out = { fresh: true, verdicts: rules().judgeCheckpoint(answers, p, today) };
        return rules().addHits(p, answers, { today, src: 'c', b });
      }, today);
      if (!out.fresh) return out;
      const refs = (answers || []).filter((a) => !a.ok && a.m && a.id).map((a) => ({ m: a.m, id: a.id, sub: a.sub || null }));
      const keys = out.verdicts.filter((v) => v.passes).map((v) => v.key);
      if (refs.length || keys.length) {
        await rvqWrite(today, (q) => keys.reduce((a, k) => rules().schedulePassed(a, k, today), refs.reduce((a, r) => rules().scheduleWrong(a, r, today), q)));
      }
      return out;
    });
  }
  /* 前測紀錄:同一期只寫一次(已經有 pre 就不動) */
  function tests(pre, d) {
    const k = 't' + curTerm(), today = dayNow(d);
    return enqueue(() => pack().saveShared('tests_v1', (t) => (t[k] && t[k].pre ? t : Object.assign({}, t, { [k]: Object.assign({}, t[k], { pre }) })), today));
  }
  /* 第 1 堂兩段都交卷(doneAt 有值)才有前測紀錄:{ form, at, parts, items: [[id, sub, c, ok]] };沒作答的小題 c 是 -1、算錯 */
  async function pretest(state) {
    if (!state || !state.doneAt) return null;
    const meta = new Map((await need('BANK').meta()).map((r) => [r.id, r]));
    const C = core(), rows = new Map((state.a || []).map((x) => [x[0] + '|' + x[1] + '|' + (x[2] || 0), x]));
    const items = [];
    [0, 1].forEach((i) => ((state.pk && state.pk[i] && state.pk[i].ids) || []).forEach((id) => {
      if (!meta.has(id)) return;
      C.itemKeys(C.partOfId(id), meta.get(id), id).forEach((k) => {
        const x = rows.get(i + '|' + id + '|' + k.sub);
        items.push([id, k.sub, x ? x[3] : -1, !!x && (x[4] & 1) === 1]);
      });
    }));
    const parts = C.partsOf(state, (id) => (meta.get(id) || {}).size, (kind, id) => meta.has(id));
    return { form: 'interim_half', at: state.doneAt, parts, items };
  }
  function flush() { return queue; }
  /* 學習記錄(只讀):即時回合補回時判斷第一次作答 */
  function hist() { const h = hasStore() ? store.get('hist', []) : []; return Array.isArray(h) ? h : []; }

  /* ---------- 前測的最後畫面時間(這個分頁) ----------
     記 { p: 帳號, k: 進度鍵, s: 段, at }:同一個分頁先後登入兩個帳號時(公用電腦),進度鍵一樣,帳號不同就不用 */
  function clock(key, slot) {
    return {
      touch() { sSet(CLOCK_KEY, JSON.stringify({ p: accountId(), k: key, s: slot, at: nowSec() })); },
      last() {
        const v = readJson(sGet(CLOCK_KEY)), p = accountId();
        return isPlain(v) && !!p && v.p === p && v.k === key && v.s === slot && Number.isInteger(v.at) ? v.at : null;
      },
    };
  }

  root.LESSON_DATA = Object.freeze({
    packs, pilot, pilotNow, plan: readPlan, levels, states, open, start, ctx, testForm, fillFixed, trial, freeze,
    inputs, reviewOpt, weakOpt, testIds: pretestIds, testParts, record, segment, snapshot, sync, hist, roundRecords, mockSeen,
    hits, wrong, passed, reviewed, checkpoint, tests, pretest, planReview, flush, clock,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
