/* 學習包的課程引擎:拼課表、選題、凍結選題、解鎖、進度鍵與兩台合併。課程頁用;這一版還沒有頁面載入它。
   要先載入 js/sync-merge.js 與 js/sync-merge-lesson.js(兩台的合併)、js/lesson-rules.js(考點與個人段的規則)、js/bank.js(題庫題一律經過 BANK.pick、BANK.get、BANK.meta)。
   學習包是 data/packs/pack_<級>.json(schema 在 data/packs/pack_schema.json);這一版只開入門(entry)、門檻(threshold)兩包。

   進度鍵 les_t<期>_<堂>(例 les_t1_03,期 1–99、堂 01–24):一律用 lessonKey(term, no) 產生,不要自己拼字串。內容:
     { v: 1, lessonId: { listening, reading }, packVersion: { listening, reading }, levels: { listening, reading },
       startedAt, doneAt,                                  時間都是 epoch 秒;doneAt 沒上完是 null
       seg: { <段>: { st: 'todo'|'doing'|'done'|'skip', t0, t1 } },
       pk:  { <區塊編號>: { at, ids, r, m, sub, k, p } },   凍結的選題;at 是距 startedAt 的秒數,r 是出題原因(個人段才有);
                                                          錯題重做(80)的 m、sub 是那幾題的模組與小題(陣列);弱點補練(85–89)的 m 是區塊的模組
                                                          ('grammar'、'ear_dictation'、'p1'–'p7')、k 是考點鍵(沒有是 null);
                                                          測驗檢討(90–97)的 m 是 'tip' 或 'p1'–'p7'、p 是 Part。字卡區塊不存字(就是那一週全部的字)
       a:   [[區塊編號, id, sub, c, r, dt]] }               作答:sub 題組小題(1 起算,單題 0)、c 選的選項(不是選擇題 -1)、
                                                          r = 答對 1 ＋ 第一次作答 2(0–3)、dt 是距 startedAt 的秒數
   模組不存在作答裡:看區塊(固定段是課表上那個區塊的 module,個人段看 pk 的 m)。每堂進度鍵上限 5 KB(LESSON_KEY_MAX,超過時先縮,見 fitLesson)。
   區塊編號:固定段的區塊照課表順序 0 起編;個人段用固定的號碼(回顧 80–84、弱點補練 85–89、測驗檢討 90–97),兩台算出來一樣。
   跨裝置:les_t*、pts、rvq、tests_v1 在 js/cloud.js 的合併表上(合併函式在 js/sync-merge-lesson.js):上傳前先讀雲端那一份合併,開新分頁灌雲端資料時
   本機和雲端都有就存合併結果,不會整份蓋掉別台的;讀不到雲端就不上傳、帳本留著。這裡開堂、交卷時再讀一次雲端合併(loadLesson、saveLesson、
   saveShared、loadShared),畫面一開始就有別台的進度;讀不到雲端(離線、逾時)就照本機寫,上傳時 cloud.js 會合併。
   作答中每答一題用 saveLessonLocal 只寫本機、不讀雲端(中途關分頁,回來從沒答的題接著做);交卷用 saveLesson。
   練習引擎寫的 drill_p*、listen_p*、hist 還是整份上傳(還不在合併表上):每一段呼叫引擎「之前」用 syncPractice 併進雲端那一份。
   只保護這一段開始之前別台寫的紀錄;這一段作答中別台寫的,這台引擎寫入時整份上傳會蓋掉(跟現在的刷題頁一樣),要等這三種鍵也進合併表。
   小檢核的預留題(reserveFor):每個帳號下一次小檢核那一堂先算好一份,練習選題先避開、湊不滿才用,讓小檢核有沒做過的清單題可選。
   這一版沒有的:小檢核的 includeUnpassed(還沒過關的考點加題,第 8、24 堂才有)不加題;聽讀差兩級的時間挪移(只開兩級,最多差一級);
   學習包 legacyWhere 裡 bank.js 篩不了的欄位(例 stemKeyword)不篩,選題結果的 need 會列出來(ignored)。 */
(function (root) {
  'use strict';
  const R = root.LESSON_RULES;
  if (!R) throw new Error('要先載入 js/lesson-rules.js');
  function sync() {
    const S = root.SYNC_MERGE;
    if (!S || typeof S.lesson !== 'function' || typeof S.tests !== 'function') throw new Error('要先載入 js/sync-merge.js 與 js/sync-merge-lesson.js');
    return S;
  }

  const OPEN_LEVELS = ['entry', 'threshold'];
  const LESSON_KEY = /^les_t(\d{1,2})_(\d{2})$/;
  const LESSON_KEY_MAX = 5 * 1024;
  const DAILY_MAX = 2;
  const READING_SLOTS = ['vocab', 'reading', 'test_reading'];
  const LISTENING_MODULES = /^(p[1-4]|ear_\w+)$/;
  const BANK_PART = { p1: '1', p2: '2', p3: '3', p4: '4', p5: '5', p6: '6', p7: '7' };
  const DIFF = { D1: '基礎', D2: '中級', D3: '進階' };
  const LV = ['D1', 'D2', 'D3', 'D4'];
  const CODE = { 基礎: 'D1', 中級: 'D2', 進階: 'D3' };
  const BORROW = ['D2', 'D3', 'D1', 'D4'];
  const LEGACY_OK = ['difficulty', 'category', 'type', 'format', 'maxWordCount', 'canYou'];
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

  /* 兩台的進度合併(SYNC_MERGE.lesson,雲端同步也用同一份):開始時間早的那份為主;段以「交卷或略過」優先,兩邊都交卷取交卷時間早的;
     選題取凍結得早的(個人段整段取同一份);作答以(區塊、題、小題)聯集,同一題取作答時間早的(第一次作答);所有段都交卷或略過時補 doneAt。
     兩份的 levels、lessonId、packVersion 不一樣時只留主要那份,另一份只併入題目對得上的作答。
     其中一邊是 null 或形狀不對就回另一邊的複本;都不對回 null;另一邊是認不得的新版格式時回這一邊(不拿來合併) */
  const v1 = (s) => !!s && typeof s === 'object' && s.v === 1 && Number.isInteger(s.startedAt) && !!s.seg && Array.isArray(s.a);
  function mergeLesson(a, b) {
    const m = sync().lesson(a === undefined ? null : a, b === undefined ? null : b);
    if (m.ok) return m.v === null ? null : clone(m.v);
    return v1(a) ? clone(a) : v1(b) ? clone(b) : null;
  }

  /* tests_v1 合併(SYNC_MERGE.tests):{ t1: { pre, mid, post } },同一次測驗兩邊都有取 at 早的(第一次交卷) */
  function mergeTests(a, b) {
    const plain = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
    const m = sync().tests(plain(a), plain(b));
    return m.ok && m.v ? clone(m.v) : {};
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
  /* 難度配比 → 各級題數(最大餘數法):先取整數部分,剩下的題照小數部分大的先給,一樣時比例大的先、再來級低的先。
     allow 有給時只在這幾級分配(比例照它們之間的相對大小);這幾級的比例都是 0 就全部是 0(呼叫的一方再照借題順序補) */
  function allocate(n, mix, allow) {
    const lv = allow || LV;
    const w = {}, exact = {}, out = { D1: 0, D2: 0, D3: 0, D4: 0 };
    lv.forEach((l) => { w[l] = Math.max(0, Number(mix && mix[l]) || 0); });
    const sum = lv.reduce((a, l) => a + w[l], 0);
    if (!(sum > 0) || !(n > 0)) return out;
    lv.forEach((l) => { exact[l] = n * w[l] / sum; out[l] = Math.floor(exact[l] + 1e-9); });
    let left = n - lv.reduce((a, l) => a + out[l], 0);
    lv.filter((l) => w[l] > 0).sort((x, y) => (exact[y] - out[y]) - (exact[x] - out[x]) || w[y] - w[x] || LV.indexOf(x) - LV.indexOf(y))
      .forEach((l) => { if (left > 0) { out[l]++; left--; } });
    return out;
  }
  /* 學習包的 legacyWhere → BANK.pick 的 where;bank.js 篩不了的欄位列在 ignored(不篩,選題結果的 need 會記) */
  function bankWhereOf(sel) {
    const lw = sel.legacyWhere || {}, w = {};
    ['difficulty', 'category', 'type', 'format'].forEach((k) => { if (lw[k]) w[k] = lw[k].slice(); });
    if (lw.maxWordCount) w.maxWords = lw.maxWordCount;
    if (typeof lw.canYou === 'boolean') w.canYou = lw.canYou;
    if (sel.where && sel.where.setSize) w.size = sel.where.setSize.slice();
    return { where: w, ignored: Object.keys(lw).filter((k) => LEGACY_OK.indexOf(k) < 0) };
  }
  function doneIds(records) {
    return Object.keys(records || {}).map((k) => k.split(':')[0]);
  }
  function bankOf(ctx) {
    const B = ctx.bank || root.BANK;
    if (!B || typeof B.pick !== 'function') throw new Error('要先載入 js/bank.js');
    return B;
  }

  /* 題庫題。plan = { mix(難度配比,可以沒有), allow(先出的難度,D 代碼), extra(不夠時依序再借的難度) },P6、P7 或不分難度是 null。
     有 mix 就照 mix 在 allow 裡分配(最大餘數法),不夠先在 allow 裡照 D2→D3→D1→D4 補,再照 extra 借(個人段是放寬一級);
     還不夠就放寬「14 天內做過」(難度條件不變),記 relaxed。hold = { ids: 下一次小檢核的預留題(reserveFor), fill }:
     前面每一步都先避開 ids,放寬完還不夠、fill 是 true 時才用它補滿,reserved 是補了幾題 */
  async function pickBankIds(part, n, where, plan, ctx, avoid, within, hold) {
    const B = bankOf(ctx);
    const base = { part, within, records: ctx.records ? ctx.records[part] || {} : undefined, random: ctx.random };
    const got = [];
    const take = async (w, k, extraAvoid) => {
      if (k <= 0) return;
      const ids = await B.pick(Object.assign({}, base, { n: k, where: w, exclude: avoid.concat(got, extraAvoid || []) }));
      ids.forEach((id) => got.push(id));
    };
    const keep = hold ? hold.ids : [];
    const seen = ctx.seen ? Array.from(ctx.seen) : [];
    const first = seen.concat(keep);
    const lv = (list) => Object.assign({}, where, { difficulty: list.filter((l) => DIFF[l]).map((l) => DIFF[l]) });
    let last = where;
    if (plan && /^[1-5]$/.test(part)) {
      const allow = plan.allow, extra = (plan.extra || []).filter((l) => DIFF[l] && allow.indexOf(l) < 0);
      if (plan.mix) { const want = allocate(n, plan.mix, allow); for (const l of allow) if (DIFF[l]) await take(lv([l]), want[l], first); }
      else await take(lv(allow), n, first);
      for (const l of BORROW) if (DIFF[l] && allow.indexOf(l) > -1) await take(lv([l]), n - got.length, first);
      for (const l of extra) await take(lv([l]), n - got.length, first);
      last = lv(allow.concat(extra));
    } else await take(where, n, first);
    let relaxed = false, reserved = 0;
    if (got.length < n && seen.length) { relaxed = true; await take(last, n - got.length, keep); }
    if (got.length < n && keep.length && hold.fill) { const had = got.length; await take(last, n - got.length, []); reserved = got.length - had; }
    return { ids: got, relaxed, reserved };
  }
  /* 固定區塊的難度:legacyWhere 寫了難度就在那幾級裡出(有 levelMix 照它分配),不夠照 D2→D3→D1 借別級;
     入門的 P3、P4 只用基礎的組,不借。沒寫難度照 levelMix 分配到三級 */
  function fixedPlan(part, where, mix, strict) {
    if (!/^[1-5]$/.test(part) || (!where.difficulty && !mix)) return null;
    const allow = where.difficulty ? LV.filter((l) => DIFF[l] && where.difficulty.indexOf(DIFF[l]) > -1) : LV;
    const extra = where.difficulty && !strict ? BORROW.filter((l) => DIFF[l] && allow.indexOf(l) < 0) : [];
    return { mix, allow, extra };
  }
  /* 個人段的難度(LESSON_RULES.personalDiff):學生那一科的級可以出的、不高於這個考點最近答錯那題;mix 只給沒有考點的補題(fallback a、c)與測驗檢討 */
  function personalPlan(level, part, lastWrong, mix) {
    const d = R.personalDiff(level, part, lastWrong);
    return d ? { mix, allow: d.allow.map((x) => CODE[x]), extra: d.up ? [CODE[d.up]] : [] } : null;
  }
  /* 這個考點最近答錯那題(組)的難度:看作答紀錄 ctx.records(drill_p*、listen_p* 的 { ok, t });沒答錯過回 null */
  async function lastWrongDiff(key, ctx) {
    const w = R.bankWhere(key);
    const recs = w && /^[1-5]$/.test(w.part) && ctx.records ? ctx.records[w.part] : null;
    if (!recs) return null;
    const lk = R.legacyKey(key);
    let best = null;
    (await bankOf(ctx).meta(w.part)).forEach((row) => {
      if (!row.difficulty || R.keysOfRow(row).indexOf(lk) < 0) return;
      const subs = row.size ? Array.from({ length: row.size }, (_, i) => row.id + ':' + i) : [row.id];
      subs.forEach((k) => {
        const r = recs[k], t = r && Number(r.t) || 0;
        if (r && r.ok === false && (!best || t > best.t)) best = { t, d: row.difficulty };
      });
    });
    return best ? best.d : null;
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

  /* 一個固定區塊選題。回 { ids, need, relaxed, reserved, ignored }(need 是不夠的題數,夠就是 0;reserved 是用預留題補了幾題;
     ignored 是篩不了、沒篩的條件欄位)。hold 是預留題:小檢核的檢核區塊不避開(選題規則不變),其他題庫區塊先避開 */
  async function pickBlock(block, lesson, ctx, avoid, inCheckpoint, hold) {
    if (block.ids) return { ids: block.ids.map((x) => x.id), need: 0 };
    const sel = block.select, part = BANK_PART[block.module];
    if (part) {
      const mix = sel.levelMix === 'pack' ? lesson.mix[block.track] : sel.levelMix === 'none' ? null : sel.levelMix;
      const checking = inCheckpoint && !block.fill;
      let within;
      if (checking) {
        if (!Array.isArray(ctx.checkpointPool)) throw new Error('小檢核要給可用題清單（checkpointPool）');
        const done = new Set(doneIds(ctx.records && ctx.records[part]));
        within = ctx.checkpointPool.filter((id) => !done.has(id));
      }
      const w = bankWhereOf(sel);
      const strict = lesson.levels[block.track] === 'entry' && /^[34]$/.test(part);
      const r = await pickBankIds(part, block.count, w.where, fixedPlan(part, w.where, mix, strict), ctx, avoid, within, checking ? null : hold);
      return { ids: r.ids, need: block.count - r.ids.length, relaxed: r.relaxed, reserved: r.reserved, ignored: w.ignored };
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
     checkpointPool, reserve(預留題,見 reserveFor;可以沒有), ear, earRecords, weekWords(week, which), random, now }。
     回 { state, need: [{ idx, module, want, got, relaxed, reserved, ignored }] }(題不夠、放寬過「14 天內做過」、用預留題補過、
     或有篩不了的條件欄位的區塊) */
  async function pickFixed(lesson, state, ctx) {
    if (!Number.isInteger(ctx && ctx.now)) throw new TypeError('ctx.now 要是 epoch 秒');
    let st = state;
    const need = [];
    const avoid = frozenIds(st);
    const todo = lesson.segments.some((s) => (s.blocks || []).some((b) => !st.pk[b.idx]));
    const hold = { ids: todo ? await reservedOf(ctx) : [], fill: true };
    for (const seg of lesson.segments) {
      for (const b of seg.blocks || []) {
        if (st.pk[b.idx]) continue;
        const r = await pickBlock(b, lesson, ctx, avoid, seg.slot === 'checkpoint', hold);
        r.ids.forEach((id) => avoid.push(id));
        const ignored = r.ignored || [];
        if (r.need > 0 || r.relaxed || r.reserved || ignored.length) need.push(needOf(b.idx, b.module, b.count, r, ignored));
        st = freeze(st, b.idx, r.ids, ctx.now);
      }
    }
    return { state: st, need };
  }
  /* need 的一筆:題不夠、放寬過、用預留題補過的區塊 */
  function needOf(idx, module, want, r, ignored) {
    return Object.assign({ idx, module, want, got: r.ids.length, relaxed: !!r.relaxed }, r.reserved ? { reserved: r.reserved } : {}, ignored && ignored.length ? { ignored } : {});
  }
  const shortOf = (want, r) => r.ids.length < want || r.relaxed || r.reserved > 0;

  /* ---------- 小檢核的預留題 ---------- */
  /* 字串的 32 位元雜湊(FNV-1a)與 mulberry32 亂數:同一個種子在每個瀏覽器排出一樣的順序 */
  function hash32(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* 第 no 堂之後下一次小檢核的堂號(學習包裡有 checkpoint 段的堂);後面沒有回 null */
  function nextCheckpoint(packs, levels, no) {
    const L = packFor(packs, levels.listening);
    for (let m = no + 1; m <= 24; m++) if (lessonOf(L, m).segments.some((s) => s.slot === 'checkpoint')) return m;
    return null;
  }
  /* 照「種子＋題 id」的雜湊值由小到大挑題(代替洗牌):每題的位置只看自己的 id,題庫或清單加減別的題時,已經挑中的題不會跟著換 */
  function rankedBank(B, seed) {
    const memo = new Map();
    const rank = (id) => { if (!memo.has(id)) memo.set(id, mulberry32(hash32(seed + '|' + id))()); return memo.get(id); };
    return {
      pick: async (spec) => (await B.pick(Object.assign({}, spec, { n: Number.MAX_SAFE_INTEGER, order: 'listed' })))
        .sort((x, y) => rank(x) - rank(y) || (x < y ? -1 : 1)).slice(0, spec.n),
    };
  }
  /* 預留題:第 no 堂之後下一次小檢核那一堂,每個檢核區塊照它自己的選題條件(同模組、同難度配比與條件、從小檢核可用題清單選),
     每題用「帳號＋那一堂的堂號＋區塊編號＋題 id」的雜湊值排序,挑出區塊題數那麼多題。不排除做過的題與前測題,不存進任何鍵:
     同一個帳號、同一組級別每次算出來都一樣(換裝置也一樣);題庫或清單少了沒挑中的題整份不變,少了挑中的題只換那一題。
     課程裡的練習選題先避開這些題,湊不滿才用(pickBankIds 的 hold;弱點補練不用);小檢核本身的選題規則不變。
     ctx = { account(帳號 id), pool(小檢核可用題清單,不扣前測題), bank }。沒有帳號(訪客)回 [] */
  async function reserveFor(packs, levels, no, ctx) {
    const c = ctx || {};
    if (typeof c.account !== 'string' || !c.account || !Array.isArray(c.pool)) return [];
    const at = nextCheckpoint(packs, levels, no);
    if (!at) return [];
    const lesson = compose(packs, levels, at), out = [];
    for (const seg of lesson.segments.filter((s) => s.slot === 'checkpoint')) {
      for (const b of seg.blocks) {
        if (b.fill || !BANK_PART[b.module]) continue;
        const pc = { bank: rankedBank(bankOf(c), c.account + '|' + at + '|' + b.idx), records: {}, checkpointPool: c.pool };
        (await pickBlock(b, lesson, pc, out.slice(), true)).ids.forEach((id) => out.push(id));
      }
    }
    return out;
  }
  /* 選題的 ctx 帶的預留題:ctx.reserve 是陣列,或回陣列(或 Promise)的函式;沒有回 [] */
  async function reservedOf(ctx) {
    const r = ctx && ctx.reserve;
    const v = await (typeof r === 'function' ? r() : r);
    return Array.isArray(v) ? v.slice() : [];
  }

  /* 個人段已經凍結的區塊(from ≤ 編號 < to),照編號排 */
  function frozenIn(state, from, to) {
    return Object.keys(state.pk || {}).map(Number).filter((i) => i >= from && i < to).sort((a, b) => a - b).map((i) => ({ idx: i, e: state.pk[i] }));
  }
  /* 沒存模組的舊凍結選題:從題號猜(l1- 到 l4- 是聽力、p5- 到 p7- 是閱讀、g 開頭是文法單元,其他是英語耳) */
  function moduleOfIds(ids) {
    const m = /^(?:l([1-4])|p([5-7]))-/.exec((ids || [])[0] || '');
    return m ? 'p' + (m[1] || m[2]) : /^g[a-z]-\d/.test((ids || [])[0] || '') ? 'grammar' : 'ear_dictation';
  }
  const trackOfPart = (part) => (/^[1-4]$/.test(String(part)) ? 'listening' : 'reading');

  /* 弱點補練:plans 是 LESSON_RULES.planWeak 的結果;每個考點先放改派的基礎模組,再出同考點的題,凍結在 85 起,pk 存模組(m)與考點鍵(k)。
     85–89 已經有任何凍結的區塊(開過這一段、或從別台合併過來)就直接用 pk 重建、不再照這次的計畫選:計畫跟著考點狀態變,
     照編號沿用會讓模組、題目、題數對不上。題目照個人段的難度(personalPlan);沒有考點的補題(fallback a、c)照那一級的難度配比。
     弱點補練、考點回顧、測驗檢討都先避開預留題(ctx.reserve)。考點回顧、測驗檢討的題數是固定的,放寬完還不夠才用預留題補;
     弱點補練的題數是用剩下的時間換算的,不用預留題補,題不夠就照原本少出(這一段提早結束)。
     回傳的 need 跟 pickFixed 一樣(題不夠、放寬過、用預留題補過的區塊,不存) */
  async function pickWeak(lesson, state, plans, ctx) {
    const frozen = frozenIn(state, RESERVED.weak, RESERVED.test_review);
    if (frozen.length) return { state, blocks: frozen.map((x) => ({ idx: x.idx, module: x.e.m || moduleOfIds(x.e.ids), ids: x.e.ids, r: x.e.r, key: x.e.k || null })), need: [] };
    let st = state, idx = RESERVED.weak;
    const avoid = frozenIds(st), blocks = [], need = [], hold = { ids: await reservedOf(ctx), fill: false };
    const put = (module, ids, r, key) => {
      st = freeze(st, idx, ids, ctx.now, { r, m: module, k: key || null });
      st.pk[idx].ids.forEach((id) => avoid.push(id));
      blocks.push({ idx, module, ids: st.pk[idx].ids, r, key: key || null });
      idx++;
    };
    for (const p of plans || []) {
      if (idx + (p.base ? 1 : 0) >= RESERVED.test_review) break;
      if (p.base) {
        /* 改派的聽寫只會出現在聽力級入門(LESSON_RULES 的 baseModule),用初級句 */
        const ids = p.base.module === 'grammar' ? p.base.ids.slice()
          : earIds({ module: p.base.module, count: p.base.count, select: { where: { earLevel: ['初級'] } } }, ctx, avoid);
        put(p.base.module, ids, 'base_module', p.key);
      }
      const w = p.key ? R.bankWhere(p.key) : { part: p.part, where: {} };
      const track = trackOfPart(w.part);
      const plan = personalPlan(lesson.levels[track], w.part, p.key ? await lastWrongDiff(p.key, ctx) : null, p.key ? null : lesson.mix[track]);
      const want = R.weakCount(p), r = await pickBankIds(w.part, want, w.where, plan, ctx, avoid, undefined, hold);
      if (shortOf(want, r)) need.push(needOf(idx, 'p' + w.part, want, r));
      put('p' + w.part, r.ids, p.reason, p.key);
    }
    return { state: st, blocks, need };
  }

  /* 回顧:units 是 LESSON_RULES.pickReview 的 units。錯題重做原題放 80;考點回顧每個考點 3 題新題放 81 起(照個人段的難度,r 記考點鍵)。
     80–84 已經有凍結的區塊就不再選(跟弱點補練一樣,佇列合併後換了項目也不拼進來) */
  async function pickReview(lesson, state, units, ctx) {
    if (frozenIn(state, RESERVED.review, RESERVED.weak).length) return { state, need: [] };
    let st = state;
    const redo = (units || []).filter((u) => !u.k), keys = (units || []).filter((u) => u.k);
    st = freeze(st, RESERVED.review, redo.map((u) => u.id), ctx.now, { r: 'review', sub: redo.map((u) => (u.sub === undefined ? null : u.sub)), m: redo.map((u) => u.m) });
    const avoid = frozenIds(st), need = [], hold = { ids: keys.length ? await reservedOf(ctx) : [], fill: true };
    let idx = RESERVED.review + 1;
    for (const u of keys.slice(0, 4)) {
      const w = R.bankWhere(u.k), want = R.isGroupKey(u.k) ? 1 : 3;
      const plan = st.pk[idx] ? null : personalPlan(lesson.levels[trackOfPart(w.part)], w.part, await lastWrongDiff(u.k, ctx), null);
      const got = st.pk[idx] ? { ids: st.pk[idx].ids } : await pickBankIds(w.part, want, w.where, plan, ctx, avoid, undefined, hold);
      if (!st.pk[idx] && shortOf(want, got)) need.push(needOf(idx, 'p' + w.part, want, got));
      got.ids.forEach((id) => avoid.push(id));
      st = freeze(st, idx++, got.ids, ctx.now, { r: 'point_review:' + u.k });
    }
    return { state: st, need };
  }

  /* 測驗檢討:parts 是測驗各 Part 的 { n, ok };技巧卡與新題凍結在 90 起(pk 存 m:'tip' 或 'p1'–'p7'、p:Part);testIds(測驗出過的題)不再出。
     90–97 已經有任何凍結的區塊就用 pk 重建(tests_v1 合併後最弱的 Part 可能變了)。新題照那一級的難度配比、在個人段的難度內 */
  async function pickTestReview(lesson, state, parts, ctx) {
    const frozen = frozenIn(state, RESERVED.test_review, RESERVED.test_review + 8);
    if (frozen.length) return { state, blocks: frozen.map((x) => testBlockOf(x.idx, x.e)), need: [] };
    let st = state, idx = RESERVED.test_review;
    const avoid = frozenIds(st).concat(ctx.testIds || []), blocks = [], need = [], hold = { ids: await reservedOf(ctx), fill: true };
    for (const x of R.planTestReview(parts)) {
      if (x.kind === 'result') continue;
      let ids;
      if (x.kind === 'tip') ids = [x.id];
      else {
        const where = x.part === '7' ? { format: ['single'], size: x.size } : {};
        const track = trackOfPart(x.part);
        const r = await pickBankIds(x.part, x.count, where, personalPlan(lesson.levels[track], x.part, null, lesson.mix[track]), ctx, avoid, undefined, hold);
        if (shortOf(x.count, r)) need.push(needOf(idx, 'p' + x.part, x.count, r));
        ids = r.ids;
      }
      ids.forEach((id) => avoid.push(id));
      const at = idx++;
      st = freeze(st, at, ids, ctx.now, { r: 'test_review', m: x.kind === 'tip' ? 'tip' : 'p' + x.part, p: x.part });
      blocks.push(Object.assign({ idx: at }, x, { ids: st.pk[at].ids }));
    }
    return { state: st, blocks, need };
  }
  /* 凍結的測驗檢討區塊 → 跟 planTestReview 一樣的形狀(題數照凍結的題) */
  function testBlockOf(idx, e) {
    const tip = e.m === 'tip' || (!e.m && /^tip-/.test((e.ids || [])[0] || ''));
    const part = e.p || (tip ? ((/^tip-P(\d)/.exec(e.ids[0]) || [])[1] || '') : moduleOfIds(e.ids).slice(1));
    const ids = (e.ids || []).slice();
    return tip ? { idx, kind: 'tip', part, id: ids[0], seconds: 120, ids }
      : { idx, kind: 'items', part, count: ids.length, seconds: ids.length * R.PRACTICE_SECONDS[part], ids };
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

  /* 進度超過 5 KB 時先縮(新物件):①刪掉題目不在那個區塊凍結選題裡的作答(兩台各自開堂、選了不同的題,合併後留下的);
     ②有給 lesson(compose 的結果)時,刪掉已交卷或略過的段裡、沒有任何作答的區塊的凍結選題。
     回 { state, trimmed(刪了幾筆), over(縮完還是超過) };還是超過照樣寫(不擋交卷),課程頁提示 */
  const SEG_RANGE = { review: [RESERVED.review, RESERVED.weak], weak: [RESERVED.weak, RESERVED.test_review], test_review: [RESERVED.test_review, RESERVED.test_review + 8] };
  function fitLesson(state, lesson) {
    if (!state || sizeOf(state) <= LESSON_KEY_MAX) return { state, trimmed: 0, over: false };
    const pk = state.pk || {};
    const orphan = (x) => pk[x[0]] && Array.isArray(pk[x[0]].ids) && pk[x[0]].ids.length > 0 && pk[x[0]].ids.indexOf(x[1]) < 0;
    let st = Object.assign({}, state, { a: state.a.filter((x) => !orphan(x)) });
    let trimmed = state.a.length - st.a.length;
    if (sizeOf(st) > LESSON_KEY_MAX && lesson) {
      const answered = new Set(st.a.map((x) => x[0]));
      const drop = new Set();
      lesson.segments.forEach((s) => {
        if (!finished(st.seg[s.slot])) return;
        const idx = (s.blocks || []).map((b) => b.idx);
        const range = SEG_RANGE[s.slot];
        Object.keys(st.pk).map(Number).filter((i) => (idx.indexOf(i) > -1 || (range && i >= range[0] && i < range[1])) && !answered.has(i)).forEach((i) => drop.add(i));
      });
      const kept = {};
      Object.keys(st.pk).forEach((k) => { if (!drop.has(Number(k))) kept[k] = st.pk[k]; });
      st = Object.assign({}, st, { pk: kept });
      trimmed += drop.size;
    }
    return { state: st, trimmed, over: sizeOf(st) > LESSON_KEY_MAX };
  }

  /* 交卷:先讀雲端合併,再套用 update(state)、縮到 5 KB 內(fitLesson)寫出。deps.lesson(compose 的結果)有給才會縮凍結選題。
     回 { state(寫出的內容), cloudRead, trimmed, over } */
  async function saveLesson(term, no, update, deps) {
    const { store, cloud } = depsOf(deps);
    const local = store.get(lessonKey(term, no), null);
    const r = await readCloud(lessonKey(term, no), cloud);
    const f = fitLesson(update(r.ok ? mergeLesson(local, r.v) : local), deps && deps.lesson);
    store.set(lessonKey(term, no), f.state);
    return { state: f.state, cloudRead: r.ok, trimmed: f.trimmed, over: f.over };
  }
  /* 作答中:只寫本機、不讀雲端(每答一題寫一次,中途關分頁回來從沒答的題接著做)。進度合併是聯集,不讀雲端也不會蓋掉別台的:
     cloud.js 上傳前會先讀雲端合併。回 { state, trimmed, over } */
  function saveLessonLocal(term, no, update, deps) {
    const { store } = depsOf(deps);
    const f = fitLesson(update(store.get(lessonKey(term, no), null)), deps && deps.lesson);
    store.set(lessonKey(term, no), f.state);
    return f;
  }

  /* pts、rvq、tests_v1:寫入前同樣先讀雲端合併。today 給 pts 重算狀態用;讀不到雲端也重算(本機的 s 可能是合併過、過時的) */
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
    const next = update(K.merge(local, r.ok ? r.v : null, today));
    K.set(store, next);
    return next;
  }
  async function loadShared(key, today, deps) {
    const K = SHARED[key];
    if (!K) throw new TypeError('loadShared 只接受 pts、rvq、tests_v1');
    const { store, cloud } = depsOf(deps);
    const local = K.get(store);
    const r = await readCloud(key, cloud);
    return K.merge(local, r.ok ? r.v : null, today);
  }

  /* 課程頁開著的時候練習引擎會寫作答紀錄(drill_p*、listen_p*)與學習記錄(hist),這些鍵還不在 cloud.js 的合併表上,上傳是整份換。
     每一段呼叫引擎「之前」讀雲端那一份,用搬家的合併規則(js/move-merge.js 的 pool、hist,寧可多留)併進本機:
     這一段開始之前別台寫的紀錄,不會被這台引擎接下來的寫入蓋掉。這一段作答中別台寫的,還是會被蓋掉(跟現在的刷題頁一樣)。
     合併後跟本機一樣就不寫。回 { <鍵>: 'merged'|'same'|'offline' } */
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
    pickFixed, pickWeak, pickReview, pickTestReview, reserveFor, reserved: reservedOf, nextCheckpoint,
    loadLesson, saveLesson, saveLessonLocal, fitLesson, loadShared, saveShared, syncPractice, PRACTICE_KEYS,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
