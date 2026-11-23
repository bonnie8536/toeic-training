/* 學習包的課程引擎:拼課表、選題、凍結選題、解鎖、進度鍵與兩台合併。課程頁用;這一版還沒有頁面載入它。
   要先載入 js/lesson-rules.js(考點與個人段的規則)、js/bank.js(題庫題一律經過 BANK.pick、BANK.get)。
   學習包是 data/packs/pack_<級>.json(schema 在 data/packs/pack_schema.json);這一版只開入門(entry)、門檻(threshold)兩包。

   進度鍵 les_t<期>_<堂>(例 les_t1_03,期 1–99、堂 01–24):一律用 lessonKey(term, no) 產生,不要自己拼字串。內容:
     { v: 1, lessonId: { listening, reading }, packVersion: { listening, reading }, levels: { listening, reading },
       startedAt, doneAt,                                  時間都是 epoch 秒;doneAt 沒上完是 null
       seg: { <段>: { st: 'todo'|'doing'|'done'|'skip', t0, t1 } },
       pk:  { <區塊編號>: { at, ids, r, m, sub } },         凍結的選題;at 是距 startedAt 的秒數,r 是出題原因(個人段才有),
                                                          m、sub 是錯題重做那幾題的模組與小題;字卡區塊不存字(就是那一週全部的字)
       a:   [[區塊編號, id, sub, c, r, dt]] }               作答:sub 題組小題(1 起算,單題 0)、c 選的選項(不是選擇題 -1)、
                                                          r = 答對 1 ＋ 第一次作答 2(0–3)、dt 是距 startedAt 的秒數
   模組不存在作答裡:看區塊(固定段是課表上那個區塊的 module,錯題重做看 pk[80].m)。每堂進度鍵上限 5 KB(LESSON_KEY_MAX)。
   區塊編號:固定段的區塊照課表順序 0 起編;個人段用固定的號碼(回顧 80–84、弱點補練 85–89、測驗檢討 90–97),兩台算出來一樣。
   跨裝置:開堂與每段交卷前先用 CLOUD.readKey 讀雲端那一份,跟本機的合併後再寫;作答中不寫,只在交卷時寫(saveLesson)。
   pts、rvq、tests_v1 也一樣(saveShared);練習引擎寫的 drill_p*、listen_p*、hist 在開堂與交卷前用 syncPractice 併進雲端那一份。
   讀不到雲端(離線、逾時)就照本機寫,下次開堂再合併。
   這一版沒有的:小檢核的 includeUnpassed(還沒過關的考點加題,第 8、24 堂才有)不加題;聽讀差兩級的時間挪移(只開兩級,最多差一級)。 */
(function (root) {
  'use strict';
  const R = root.LESSON_RULES;
  if (!R) throw new Error('要先載入 js/lesson-rules.js');

  const OPEN_LEVELS = ['entry', 'threshold'];
  const LESSON_KEY = /^les_t(\d{1,2})_(\d{2})$/;
  const LESSON_KEY_MAX = 5 * 1024;
  const DAILY_MAX = 2;
  const READING_SLOTS = ['vocab', 'reading', 'test_reading'];
  const LISTENING_MODULES = /^(p[1-4]|ear_\w+)$/;
  const BANK_PART = { p1: '1', p2: '2', p3: '3', p4: '4', p5: '5', p6: '6', p7: '7' };
  const DIFF = { D1: '基礎', D2: '中級', D3: '進階' };
  const BORROW = ['D2', 'D3', 'D1', 'D4'];
  const EAR = { ear_dictation: ['dictation', 'ear_d'], ear_pairs: ['pairs', 'ear_mp'], ear_numbers: ['numbers', 'ear_n'], ear_shadow: ['shadow', 'ear_s'] };
  const RESERVED = { review: 80, weak: 85, test_review: 90 };
  const CP_MIN = 918, CP_MAX = 1080, CP_INTRO = 60;

  /* ---------- 進度鍵 ---------- */
  function lessonKey(term, no) {
    if (!Number.isInteger(term) || term < 1 || term > 99) throw new TypeError('期要是 1 到 99 的整數：' + JSON.stringify(term));
    if (!Number.isInteger(no) || no < 1 || no > 24) throw new TypeError('堂號要是 1 到 24 的整數：' + JSON.stringify(no));
    return 'les_t' + term + '_' + (no < 10 ? '0' : '') + no;
  }
  function parseLessonKey(key) {
    const m = LESSON_KEY.exec(String(key));
    if (!m) return null;
    const term = Number(m[1]), no = Number(m[2]);
    return term >= 1 && no >= 1 && no <= 24 && m[1].charAt(0) !== '0' ? { term, no } : null;
  }

  /* ---------- 拼課表 ---------- */
  function packFor(packs, level) {
    if (OPEN_LEVELS.indexOf(level) < 0) throw new Error('這一級的學習包還沒開放：' + level);
    const p = packs && packs[level];
    if (!p || p.level !== level || !Array.isArray(p.lessons) || p.lessons.length !== 24) throw new Error('學習包沒有載入或格式不對：' + level);
    if (p.status !== 'live') throw new Error('學習包不是開放狀態：' + level);
    return p;
  }
  function lessonOf(pack, no) {
    const l = pack.lessons.filter((x) => x.no === no)[0];
    if (!l) throw new Error('學習包沒有第 ' + no + ' 堂：' + pack.packId);
    return l;
  }
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const trackOf = (module) => (LISTENING_MODULES.test(module) ? 'listening' : 'reading');
  const blockSeconds = (b) => b.count * b.secondsPerUnit;

  /* 聽讀不同級時的小檢核:聽力題跟聽力級的包、閱讀題跟閱讀級的包;檢核題 ＋ 說明 60 秒超過 1,080 秒時先拿掉權重最低的考點,
     不到 918 秒時加補足區塊。檢核區塊與考點一一對應(先聽力、再閱讀,順序同 checkpoint.listening、reading) */
  function composeCheckpoint(ll, rl, seg) {
    if (ll === rl) return { seg: clone(seg), cp: clone(ll.checkpoint) };
    const lc = ll.checkpoint, rc = rl.checkpoint;
    const lseg = ll.segments.filter((s) => s.slot === 'checkpoint')[0], rseg = rl.segments.filter((s) => s.slot === 'checkpoint')[0];
    let picks = lseg.blocks.slice(0, lc.listening.length).map((b, i) => ({ b, key: lc.listening[i] }))
      .concat(rseg.blocks.slice(rc.listening.length, rc.listening.length + rc.reading.length).map((b, i) => ({ b, key: rc.reading[i] })));
    const answer = () => picks.reduce((a, x) => a + blockSeconds(x.b), 0);
    while (picks.length > 1 && answer() + CP_INTRO > CP_MAX) {
      const low = picks.slice().sort((x, y) => R.weightOf(R.legacyKey(x.key)) - R.weightOf(R.legacyKey(y.key)))[0];
      picks = picks.filter((x) => x !== low);
    }
    /* 補足:兩包的補足區塊依序加,放不下整塊時,可以減量的(聽寫句、單字題)只取補到 918 秒需要的數量 */
    const fills = [];
    let total = answer() + CP_INTRO;
    const seen = new Set();
    (lc.fill || []).concat(rc.fill || []).forEach((b) => {
      const id = b.module + JSON.stringify(b.select || b.ids);
      if (total >= CP_MIN || seen.has(id)) return;
      seen.add(id);
      const scalable = b.unit === 'sentence' || b.unit === 'word';
      const n = blockSeconds(b) + total <= CP_MAX ? b.count : scalable ? Math.min(b.count, Math.ceil((CP_MIN - total) / b.secondsPerUnit)) : 0;
      if (n < 1 || total + n * b.secondsPerUnit > CP_MAX) return;
      fills.push(Object.assign(clone(b), { count: n }));
      total += n * b.secondsPerUnit;
    });
    const cp = {
      coversWeeks: clone(lc.coversWeeks), itemsPerPoint: clone(lc.itemsPerPoint), rules: clone(lc.rules),
      listening: picks.filter((x) => trackOf(x.b.module) === 'listening').map((x) => x.key),
      reading: picks.filter((x) => trackOf(x.b.module) === 'reading').map((x) => x.key),
      answerSeconds: answer(), fill: fills, includeUnpassed: !!(lc.includeUnpassed || rc.includeUnpassed),
    };
    return { seg: Object.assign(clone(seg), { blocks: picks.map((x) => clone(x.b)) }), cp };
  }

  /* 一堂課:packs = { entry, threshold }(學習包 JSON),levels = { listening, reading }。
     回 { no, week, kind, lessonType, levels, lessonId, packVersion, titleZh, focus, mix, liveThrough, segments, checkpoint, test }:
     段照聽力級那一包的順序;聽力、聽力測驗跟聽力級,單字、閱讀、閱讀測驗跟閱讀級,其他段(回顧的分鐘數會跟著聽力段的重播調整)跟聽力級。
     固定段的區塊加上 idx(區塊編號)與 track;小檢核的補足區塊接在檢核題後面、加 fill: true */
  function compose(packs, levels, no) {
    if (!levels || typeof levels !== 'object') throw new TypeError('levels 要是 { listening, reading }');
    const L = packFor(packs, levels.listening), Rp = packFor(packs, levels.reading);
    const ll = lessonOf(L, no), rl = lessonOf(Rp, no);
    if (ll.kind !== rl.kind) throw new Error('兩包第 ' + no + ' 堂的種類不同');
    let cp = null;
    const segments = ll.segments.slice().sort((a, b) => a.order - b.order).map((s) => {
      if (s.slot === 'checkpoint') {
        const c = composeCheckpoint(ll, rl, s);
        cp = c.cp;
        return Object.assign(c.seg, { blocks: c.seg.blocks.concat((c.cp.fill || []).map((b) => Object.assign(clone(b), { fill: true }))) });
      }
      if (READING_SLOTS.indexOf(s.slot) < 0) return clone(s);
      const r = rl.segments.filter((x) => x.slot === s.slot)[0];
      if (!r) throw new Error('閱讀級那一包第 ' + no + ' 堂沒有這一段：' + s.slot);
      return Object.assign(clone(r), { order: s.order });
    });
    const minutes = segments.reduce((a, s) => a + s.minutes, 0);
    if (minutes !== ll.minutes) throw new Error('第 ' + no + ' 堂拼起來是 ' + minutes + ' 分，不是 ' + ll.minutes + ' 分');
    let idx = 0;
    segments.forEach((s) => { (s.blocks || []).forEach((b) => { b.idx = idx++; b.track = trackOf(b.module); }); });
    return {
      no, week: ll.week, kind: ll.kind, lessonType: ll.lessonType, levels: { listening: levels.listening, reading: levels.reading },
      lessonId: { listening: ll.lessonId, reading: rl.lessonId }, packVersion: { listening: L.packVersion, reading: Rp.packVersion },
      titleZh: { listening: ll.titleZh, reading: rl.titleZh }, focus: { listening: clone(ll.focus.listening), reading: clone(rl.focus.reading) },
      mix: { listening: clone(L.difficultyMix), reading: clone(Rp.difficultyMix) },
      liveThrough: Math.min(L.liveThrough, Rp.liveThrough), segments,
      checkpoint: cp, test: ll.test ? clone(ll.test) : null,
    };
  }

  /* ---------- 建議日期與解鎖 ---------- */
  function suggestedDate(start, no) {
    if (!Number.isInteger(no) || no < 1 || no > 24) throw new TypeError('堂號要是 1 到 24');
    const main = R.addDays(start, 7 * (Math.ceil(no / 2) - 1));
    return no % 2 ? main : R.addDays(main, 3);
  }
  /* epoch 秒 → 這台的當地日期 'YYYY-MM-DD' */
  function dayOf(sec) {
    const d = new Date(sec * 1000);
    const p = (n) => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  const finished = (seg) => !!seg && (seg.st === 'done' || seg.st === 'skip');
  function fixedDone(lesson, state) {
    return !!state && lesson.segments.filter((s) => s.fixed).every((s) => state.seg && state.seg[s.slot] && state.seg[s.slot].st === 'done');
  }

  /* 每一堂能不能上。opt = { packs, levels, states: { <堂號>: 進度 }, today }。
     回 { lessons: [{ no, status }], next }:status 'done'(全部段交卷或略過)、'open'、'locked'(前一堂固定段沒交完)、
     'not_live'(還沒開放,顯示「第 n 堂尚未開放」)、'daily_limit'(今天已經開了 2 堂,明天再上);next 是第一個沒上完的堂號(都上完是 null) */
  function unlockState(opt) {
    const { packs, levels, today } = opt;
    const states = opt.states || {};
    const lessons = [];
    const startedToday = Object.keys(states).filter((n) => states[n] && states[n].startedAt && dayOf(states[n].startedAt) === today).length;
    let prevFixed = true, next = null;
    for (let no = 1; no <= 24; no++) {
      const l = compose(packs, levels, no), st = states[no];
      let status;
      if (st && st.doneAt) status = 'done';
      else if (no > l.liveThrough) status = 'not_live';
      else if (!prevFixed) status = 'locked';
      else if (!(st && st.startedAt) && startedToday >= DAILY_MAX) status = 'daily_limit';
      else status = 'open';
      if (next === null && status !== 'done') next = no;
      lessons.push({ no, status });
      prevFixed = fixedDone(l, st);
    }
    return { lessons, next };
  }

  /* ---------- 進度鍵的內容 ---------- */
  function newState(lesson, now) {
    if (!Number.isInteger(now)) throw new TypeError('now 要是 epoch 秒');
    const seg = {};
    lesson.segments.forEach((s) => { seg[s.slot] = { st: 'todo', t0: null, t1: null }; });
    return { v: 1, lessonId: clone(lesson.lessonId), packVersion: clone(lesson.packVersion), levels: clone(lesson.levels), startedAt: now, doneAt: null, seg, pk: {}, a: [] };
  }

  const A_DT = 5;
  const aKey = (x) => x[0] + '|' + x[1] + '|' + x[2];

  /* 記一題作答(新物件);同一區塊同一題已經有了就不動(只留第一次)。
     entry = { b, id, sub(題組小題 1 起算,單題不給), c(選項;不是選擇題不給), ok, f(第一次作答), t(epoch 秒) } */
  function answer(state, e) {
    if (!e || !Number.isInteger(e.b) || typeof e.id !== 'string' || !e.id || !Number.isInteger(e.t)) throw new TypeError('作答要有 b、id、t');
    const sub = Number.isInteger(e.sub) && e.sub > 0 ? e.sub : 0;
    const row = [e.b, e.id, sub, Number.isInteger(e.c) ? e.c : -1, (e.ok ? 1 : 0) + (e.f ? 2 : 0), Math.max(0, e.t - state.startedAt)];
    if (state.a.some((x) => aKey(x) === aKey(row))) return state;
    return Object.assign({}, state, { a: state.a.concat([row]) });
  }
  /* 一列作答 → { b, id, sub, c, ok, f, t } */
  function readAnswer(state, x) {
    return { b: x[0], id: x[1], sub: x[2] || null, c: x[3] < 0 ? null : x[3], ok: (x[4] & 1) === 1, f: (x[4] & 2) === 2, t: state.startedAt + x[A_DT] };
  }

  /* 段的狀態(新物件);所有段都交卷或略過時記 doneAt */
  function setSegment(state, lesson, slot, st, now) {
    if (['todo', 'doing', 'done', 'skip'].indexOf(st) < 0) throw new TypeError('段的狀態要是 todo、doing、done、skip');
    const seg = lesson.segments.filter((s) => s.slot === slot)[0];
    if (!seg) throw new TypeError('這一堂沒有這一段：' + slot);
    if (st === 'skip' && seg.fixed) throw new TypeError('固定段不能略過：' + slot);
    const cur = state.seg[slot] || { st: 'todo', t0: null, t1: null };
    const next = { st, t0: cur.t0 || (st === 'todo' ? null : now), t1: st === 'done' || st === 'skip' ? now : null };
    const segs = Object.assign({}, state.seg, { [slot]: next });
    const all = lesson.segments.every((s) => finished(segs[s.slot]));
    return Object.assign({}, state, { seg: segs, doneAt: state.doneAt || (all ? now : null) });
  }

  /* 一個區塊答過的題(id,題組小題是 id:sub) */
  function answeredIn(state, b) {
    return new Set((state && state.a || []).filter((x) => x[0] === b).map((x) => (x[2] ? x[1] + ':' + x[2] : x[1])));
  }

  /* 存起來的大小(UTF-8 位元組) */
  function sizeOf(v) {
    return new TextEncoder().encode(JSON.stringify(v)).length;
  }

  /* 兩台的進度合併:段以「交卷或略過」優先,兩邊都交卷取交卷時間早的;選題取凍結得早的;作答以(區塊、題、小題)聯集,
     同一題兩邊都有取作答時間早的(第一次作答)。其中一邊是 null 就回另一邊的複本 */
  const RANK = { todo: 0, doing: 1, skip: 2, done: 3 };
  function mergeSeg(x, y) {
    if (!x) return clone(y);
    if (!y) return clone(x);
    const t0 = [x.t0, y.t0].filter((v) => v !== null && v !== undefined).sort((a, b) => a - b)[0];
    const win = RANK[y.st] > RANK[x.st] || (RANK[y.st] === RANK[x.st] && y.t1 !== null && (x.t1 === null || y.t1 < x.t1)) ? y : x;
    return { st: win.st, t0: t0 === undefined ? null : t0, t1: win.t1 };
  }
  function mergeLesson(a, b) {
    const ok = (s) => !!s && typeof s === 'object' && Number.isInteger(s.startedAt) && s.seg && Array.isArray(s.a);
    if (!ok(a)) return ok(b) ? clone(b) : null;
    if (!ok(b)) return clone(a);
    const first = a.startedAt <= b.startedAt ? a : b;
    const start = first.startedAt;
    const seg = {};
    new Set(Object.keys(a.seg).concat(Object.keys(b.seg))).forEach((k) => { seg[k] = mergeSeg(a.seg[k], b.seg[k]); });
    const pk = {};
    const pkAt = {};
    [a, b].forEach((s) => Object.keys(s.pk || {}).forEach((k) => {
      const abs = s.startedAt + s.pk[k].at;
      if (!pk[k] || abs < pkAt[k]) { pk[k] = clone(s.pk[k]); pkAt[k] = abs; }
    }));
    Object.keys(pk).forEach((k) => { pk[k].at = pkAt[k] - start; });
    const rows = new Map();
    [a, b].forEach((s) => s.a.forEach((x) => {
      const abs = s.startedAt + x[A_DT], o = rows.get(aKey(x));
      if (!o || abs < o.abs) rows.set(aKey(x), { abs, x });
    }));
    const merged = [...rows.values()].sort((p, q) => p.abs - q.abs || (aKey(p.x) < aKey(q.x) ? -1 : 1)).map((r) => r.x.slice(0, A_DT).concat([r.abs - start]));
    const done = [a.doneAt, b.doneAt].filter(Number.isInteger).sort((p, q) => p - q)[0];
    return {
      v: 1, lessonId: clone(first.lessonId), packVersion: clone(first.packVersion), levels: clone(first.levels),
      startedAt: start, doneAt: done === undefined ? null : done, seg, pk, a: merged,
    };
  }

  /* tests_v1 合併:{ t1: { pre, mid, post } },同一次測驗兩邊都有取 at 早的(第一次交卷) */
  function mergeTests(a, b) {
    const A = a && typeof a === 'object' ? a : {}, B = b && typeof b === 'object' ? b : {};
    const out = {};
    new Set(Object.keys(A).concat(Object.keys(B))).forEach((t) => {
      const x = A[t] || {}, y = B[t] || {};
      out[t] = {};
      new Set(Object.keys(x).concat(Object.keys(y))).forEach((k) => {
        out[t][k] = clone(!x[k] ? y[k] : !y[k] ? x[k] : (y[k].at < x[k].at ? y[k] : x[k]));
      });
    });
    return out;
  }

  /* ---------- 凍結選題 ---------- */
  function freeze(state, idx, ids, now, extra) {
    if (state.pk && state.pk[idx]) return state;
    const entry = Object.assign({ at: Math.max(0, now - state.startedAt), ids: ids.slice() }, extra || {});
    return Object.assign({}, state, { pk: Object.assign({}, state.pk, { [idx]: entry }) });
  }
  const frozenIds = (state) => Object.keys(state.pk || {}).reduce((a, k) => a.concat(state.pk[k].ids || []), []);

  /* ---------- 選題 ---------- */
  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  /* 難度配比 → 各級題數:四捨五入,差額補給比例最大的一級 */
  function allocate(n, mix) {
    const lv = ['D1', 'D2', 'D3', 'D4'];
    const out = {};
    lv.forEach((l) => { out[l] = Math.round(n * (mix[l] || 0)); });
    const big = lv.slice().sort((x, y) => (mix[y] || 0) - (mix[x] || 0))[0];
    out[big] += n - lv.reduce((a, l) => a + out[l], 0);
    if (out[big] < 0) { out[big] = 0; }
    return out;
  }
  function bankWhereOf(sel) {
    const lw = sel.legacyWhere || {}, w = {};
    ['difficulty', 'category', 'type', 'format'].forEach((k) => { if (lw[k]) w[k] = lw[k].slice(); });
    if (lw.maxWordCount) w.maxWords = lw.maxWordCount;
    if (typeof lw.canYou === 'boolean') w.canYou = lw.canYou;
    if (sel.where && sel.where.setSize) w.size = sel.where.setSize.slice();
    return w;
  }
  function doneIds(records) {
    return Object.keys(records || {}).map((k) => k.split(':')[0]);
  }
  function bankOf(ctx) {
    const B = ctx.bank || root.BANK;
    if (!B || typeof B.pick !== 'function') throw new Error('要先載入 js/bank.js');
    return B;
  }

  /* 題庫題:levelMix 分配到各難度,不夠的照 D2→D3→D1→D4 借;還不夠就放寬「14 天內做過」,並記一筆 need */
  async function pickBankIds(part, n, where, mix, ctx, avoid, within) {
    const B = bankOf(ctx);
    const base = { part, where, within, records: ctx.records ? ctx.records[part] || {} : undefined, random: ctx.random };
    const got = [];
    const take = async (w, k, extraAvoid) => {
      if (k <= 0) return;
      const ids = await B.pick(Object.assign({}, base, { n: k, where: w, exclude: avoid.concat(got, extraAvoid || []) }));
      ids.forEach((id) => got.push(id));
    };
    const seen = ctx.seen ? Array.from(ctx.seen) : [];
    const hasDiff = /^[1-5]$/.test(part) && mix && !where.difficulty;
    if (hasDiff) {
      const want = allocate(n, mix);
      for (const l of ['D1', 'D2', 'D3', 'D4']) if (DIFF[l]) await take(Object.assign({}, where, { difficulty: [DIFF[l]] }), want[l], seen);
      for (const l of BORROW) if (DIFF[l]) await take(Object.assign({}, where, { difficulty: [DIFF[l]] }), n - got.length, seen);
    } else await take(where, n, seen);
    let relaxed = false;
    if (got.length < n && seen.length) { relaxed = true; await take(where, n - got.length, []); }
    return { ids: got, relaxed };
  }

  function earIds(block, ctx, avoid) {
    const map = EAR[block.module];
    const E = ctx.ear || (root.TOEIC && root.TOEIC.ear);
    if (!E) throw new Error('英語耳的題目沒有載入');
    const list = E[map[0]] || (map[0] === 'shadow' ? E.dictation : null) || [];
    const levels = block.select && block.select.where && block.select.where.earLevel;
    const rec = (ctx.earRecords || {})[map[1]] || {};
    const pool = list.filter((q) => (!levels || levels.indexOf(q.level) > -1) && avoid.indexOf(q.id) < 0);
    const rand = ctx.random || Math.random;
    const fresh = pool.filter((q) => !rec[q.id]), wrong = pool.filter((q) => rec[q.id] && !rec[q.id].ok), done = pool.filter((q) => rec[q.id] && rec[q.id].ok);
    return shuffle(fresh, rand).concat(shuffle(wrong, rand), shuffle(done, rand)).slice(0, block.count).map((q) => q.id);
  }

  /* 單字:ctx.weekWords(週, 'this_week'|'last_week'|'three_weeks_ago') 回那一週的字的 id。
     字的 id 用字序(例 '37',字序跟學習包版本走),不用英文字本身,一堂的進度鍵才放得進 5 KB */
  function wordIds(block, lesson, ctx, avoid) {
    if (typeof ctx.weekWords !== 'function') throw new Error('每週新字表沒有載入');
    const which = block.select.where.weekWords;
    const list = which.reduce((a, w) => a.concat(ctx.weekWords(lesson.week, w) || []), []);
    if (block.unit === 'card') return [];
    return shuffle(list.filter((id) => avoid.indexOf(id) < 0), ctx.random || Math.random).slice(0, block.count);
  }

  /* 一個固定區塊選題。回 { ids, need }(need 是不夠的題數,夠就是 0) */
  async function pickBlock(block, lesson, ctx, avoid, inCheckpoint) {
    if (block.ids) return { ids: block.ids.map((x) => x.id), need: 0 };
    const sel = block.select, part = BANK_PART[block.module];
    if (part) {
      const mix = sel.levelMix === 'pack' ? lesson.mix[block.track] : sel.levelMix === 'none' ? null : sel.levelMix;
      let within;
      if (inCheckpoint && !block.fill) {
        if (!Array.isArray(ctx.checkpointPool)) throw new Error('小檢核要給可用題清單（checkpointPool）');
        const done = new Set(doneIds(ctx.records && ctx.records[part]));
        within = ctx.checkpointPool.filter((id) => !done.has(id));
      }
      const r = await pickBankIds(part, block.count, bankWhereOf(sel), mix, ctx, avoid, within);
      return { ids: r.ids, need: block.count - r.ids.length, relaxed: r.relaxed };
    }
    if (block.module === 'grammar') return { ids: sel.where.unitIds.slice(), need: 0 };
    if (EAR[block.module]) { const ids = earIds(block, ctx, avoid); return { ids, need: block.count - ids.length }; }
    if (block.module === 'article_vocab' && sel.where.weekWords) {
      const ids = wordIds(block, lesson, ctx, avoid);
      return { ids, need: block.unit === 'card' ? 0 : block.count - ids.length };
    }
    throw new Error('這一版還不會選這種區塊：' + block.module);
  }

  /* 固定段全部區塊選題並凍結(已經凍結的不動)。ctx = { bank, records: { '1'…'7': 作答紀錄 }, seen(14 天內做過的 id),
     checkpointPool, ear, earRecords, weekWords(week, which), random, now }。回 { state, need: [{ idx, module, want, got }] } */
  async function pickFixed(lesson, state, ctx) {
    if (!Number.isInteger(ctx && ctx.now)) throw new TypeError('ctx.now 要是 epoch 秒');
    let st = state;
    const need = [];
    const avoid = frozenIds(st);
    for (const seg of lesson.segments) {
      for (const b of seg.blocks || []) {
        if (st.pk[b.idx]) continue;
        const r = await pickBlock(b, lesson, ctx, avoid, seg.slot === 'checkpoint');
        r.ids.forEach((id) => avoid.push(id));
        if (r.need > 0 || r.relaxed) need.push({ idx: b.idx, module: b.module, want: b.count, got: r.ids.length, relaxed: !!r.relaxed });
        st = freeze(st, b.idx, r.ids, ctx.now);
      }
    }
    return { state: st, need };
  }

  /* 弱點補練:plans 是 LESSON_RULES.planWeak 的結果;每個考點先放改派的基礎模組,再出同考點的題。凍結在 85 起 */
  async function pickWeak(lesson, state, plans, ctx) {
    let st = state, idx = RESERVED.weak;
    const avoid = frozenIds(st), blocks = [];
    const put = (module, ids, r) => {
      st = freeze(st, idx, ids, ctx.now, { r });
      st.pk[idx].ids.forEach((id) => avoid.push(id));
      blocks.push({ idx, module, ids: st.pk[idx].ids, r });
      idx++;
    };
    for (const p of plans || []) {
      if (p.base) {
        /* 改派的聽寫只會出現在聽力級入門(LESSON_RULES 的 baseModule),用初級句 */
        const ids = st.pk[idx] ? st.pk[idx].ids : p.base.module === 'grammar' ? p.base.ids.slice()
          : earIds({ module: p.base.module, count: p.base.count, select: { where: { earLevel: ['初級'] } } }, ctx, avoid);
        put(p.base.module, ids, 'base_module');
      }
      const w = p.key ? R.bankWhere(p.key) : { part: p.part, where: {} };
      const ids = st.pk[idx] ? st.pk[idx].ids : (await pickBankIds(w.part, R.weakCount(p), w.where, null, ctx, avoid)).ids;
      put('p' + w.part, ids, p.reason);
    }
    return { state: st, blocks };
  }

  /* 回顧:units 是 LESSON_RULES.pickReview 的 units。錯題重做原題放 80;考點回顧每個考點 3 題新題放 81 起 */
  async function pickReview(lesson, state, units, ctx) {
    let st = state;
    const redo = (units || []).filter((u) => !u.k), keys = (units || []).filter((u) => u.k);
    st = freeze(st, RESERVED.review, redo.map((u) => u.id), ctx.now, { r: 'review', sub: redo.map((u) => (u.sub === undefined ? null : u.sub)), m: redo.map((u) => u.m) });
    const avoid = frozenIds(st);
    let idx = RESERVED.review + 1;
    for (const u of keys.slice(0, 4)) {
      const w = R.bankWhere(u.k);
      const got = st.pk[idx] ? { ids: st.pk[idx].ids } : await pickBankIds(w.part, R.isGroupKey(u.k) ? 1 : 3, w.where, null, ctx, avoid);
      got.ids.forEach((id) => avoid.push(id));
      st = freeze(st, idx++, got.ids, ctx.now, { r: 'point_review:' + u.k });
    }
    return { state: st };
  }

  /* 測驗檢討:parts 是測驗各 Part 的 { n, ok };技巧卡與新題凍結在 90 起;testIds(測驗出過的題)不再出 */
  async function pickTestReview(lesson, state, parts, ctx) {
    let st = state, idx = RESERVED.test_review;
    const avoid = frozenIds(st).concat(ctx.testIds || []), blocks = [];
    for (const x of R.planTestReview(parts)) {
      if (x.kind === 'result') continue;
      let ids;
      if (x.kind === 'tip') ids = [x.id];
      else {
        const where = x.part === '7' ? { format: ['single'], size: x.size } : {};
        ids = st.pk[idx] ? st.pk[idx].ids : (await pickBankIds(x.part, x.count, where, lesson.mix[x.part <= '4' ? 'listening' : 'reading'], ctx, avoid)).ids;
      }
      ids.forEach((id) => avoid.push(id));
      const at = idx++;
      st = freeze(st, at, ids, ctx.now, { r: 'test_review' });
      blocks.push(Object.assign({ idx: at }, x, { ids: st.pk[at].ids }));
    }
    return { state: st, blocks };
  }

  /* ---------- 讀寫(開堂與交卷前先合併雲端那一份) ---------- */
  function depsOf(deps) {
    const d = deps || {};
    const s = d.store || (typeof store !== 'undefined' ? store : null);   // js/common.js 的 store
    if (!s || typeof s.get !== 'function' || typeof s.set !== 'function') throw new Error('沒有 store');
    return { store: s, cloud: d.cloud === undefined ? root.CLOUD : d.cloud };
  }
  /* 讀雲端單一鍵;讀不到(沒登入、離線、逾時)回 { ok: false },呼叫的一方照本機的做 */
  async function readCloud(key, cloud) {
    if (!cloud || typeof cloud.readKey !== 'function') return { ok: false };
    try {
      const r = await cloud.readKey(key);
      return r && r.ok === true ? { ok: true, v: r.found ? r.v : null } : { ok: false };
    } catch (e) {
      return { ok: false };
    }
  }

  /* 開堂:本機與雲端合併;合併後跟本機不同才寫回本機(合併結果包含雲端那一份,寫回不會蓋掉別台的) */
  async function loadLesson(term, no, deps) {
    const { store, cloud } = depsOf(deps);
    const local = store.get(lessonKey(term, no), null);
    const r = await readCloud(lessonKey(term, no), cloud);
    const merged = r.ok ? mergeLesson(local, r.v) : local;
    if (merged && JSON.stringify(merged) !== JSON.stringify(local)) store.set(lessonKey(term, no), merged);
    return { state: merged, cloudRead: r.ok };
  }

  /* 交卷:先讀雲端合併,再套用 update(state) 寫出。回寫出的內容 */
  async function saveLesson(term, no, update, deps) {
    const { store, cloud } = depsOf(deps);
    const local = store.get(lessonKey(term, no), null);
    const r = await readCloud(lessonKey(term, no), cloud);
    const next = update(r.ok ? mergeLesson(local, r.v) : local);
    if (sizeOf(next) > LESSON_KEY_MAX) throw new Error('進度太大：' + lessonKey(term, no) + ' ' + sizeOf(next) + ' 位元組');
    store.set(lessonKey(term, no), next);
    return next;
  }

  /* pts、rvq、tests_v1:寫入前同樣先讀雲端合併。today 給 pts 重算狀態用 */
  const SHARED = {
    pts: { get: (store) => store.get('pts', null), set: (store, v) => store.set('pts', v), merge: (a, b, today) => R.mergePts(a, b, today) },
    rvq: { get: (store) => store.get('rvq', null), set: (store, v) => store.set('rvq', v), merge: (a, b) => R.mergeRvq(a, b) },
    tests_v1: { get: (store) => store.get('tests_v1', null), set: (store, v) => store.set('tests_v1', v), merge: (a, b) => mergeTests(a, b) },
  };
  async function saveShared(key, update, today, deps) {
    const K = SHARED[key];
    if (!K) throw new TypeError('saveShared 只接受 pts、rvq、tests_v1');
    const { store, cloud } = depsOf(deps);
    const local = K.get(store);
    const r = await readCloud(key, cloud);
    const base = r.ok ? K.merge(local, r.v, today) : local;
    const next = update(base);
    K.set(store, next);
    return next;
  }
  async function loadShared(key, today, deps) {
    const K = SHARED[key];
    if (!K) throw new TypeError('loadShared 只接受 pts、rvq、tests_v1');
    const { store, cloud } = depsOf(deps);
    const local = K.get(store);
    const r = await readCloud(key, cloud);
    return r.ok ? K.merge(local, r.v, today) : local;
  }

  /* 課程頁開著的時候練習引擎會寫作答紀錄(drill_p*、listen_p*)與學習記錄(hist),這些鍵上傳是整份換:
     開堂與每段交卷前先讀雲端那一份,用搬家的合併規則(js/move-merge.js 的 pool、hist,寧可多留)併進本機,
     別台這段時間寫的才不會被這台交卷時蓋掉。合併後跟本機一樣就不寫。回 { <鍵>: 'merged'|'same'|'offline' } */
  const PRACTICE_KEYS = ['drill_p5', 'drill_p6', 'drill_p7', 'listen_p1', 'listen_p2', 'listen_p3', 'listen_p4', 'hist'];
  async function syncPractice(keys, deps) {
    const MM = (deps && deps.merge) || root.MOVE_MERGE;
    if (!MM || typeof MM.pool !== 'function' || typeof MM.hist !== 'function') throw new Error('要先載入 js/move-merge.js');
    (keys || []).forEach((k) => { if (PRACTICE_KEYS.indexOf(k) < 0) throw new TypeError('syncPractice 只接受 ' + PRACTICE_KEYS.join('、')); });
    const { store, cloud } = depsOf(deps);
    const now = deps && Number.isFinite(deps.nowMs) ? deps.nowMs : Date.now();
    const out = {};
    for (const key of keys || []) {
      const r = await readCloud(key, cloud);
      if (!r.ok) { out[key] = 'offline'; continue; }
      const local = store.get(key, null);
      const empty = key === 'hist' ? [] : {};
      const merged = r.v === null || r.v === undefined ? local : key === 'hist' ? MM.hist(local || empty, r.v, now) : MM.pool(local || empty, r.v);
      const same = merged === null || JSON.stringify(merged) === JSON.stringify(local);
      if (!same) store.set(key, merged);
      out[key] = same ? 'same' : 'merged';
    }
    return out;
  }

  root.PACK_CORE = Object.freeze({
    LESSON_KEY, LESSON_KEY_MAX, RESERVED, OPEN_LEVELS,
    lessonKey, parseLessonKey, compose, suggestedDate, dayOf, unlockState, fixedDone,
    newState, answer, readAnswer, setSegment, answeredIn, sizeOf, mergeLesson, mergeTests, freeze, allocate,
    pickFixed, pickWeak, pickReview, pickTestReview,
    loadLesson, saveLesson, loadShared, saveShared, syncPractice, PRACTICE_KEYS,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
