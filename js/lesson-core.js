/* 課程頁(lessons.html、lesson.html、首頁的今天的課卡、教師後台的目前堂號)的純計算:不碰畫面、不讀寫儲存。
   載入時不依賴其他檔;js/daily.js(vocabOptions)在函式裡才用。讀寫在 js/lesson-data.js,畫面在 js/lesson-home.js、js/lesson.js 等。
   名詞:
     課程頁拿到的 lesson 是 PACK_CORE.compose 的結果(兩包拼好的一堂);state 是那一堂的進度(les_t<期>_<堂>,格式見 js/pack-core.js 檔頭)。
     步驟(round):段裡的區塊照順序排成一步一個畫面。相鄰、同一個引擎、對答方式相同的題庫區塊併成一回合;相鄰的單字小考併成一步。
     可作答的題:呼叫的一方給 has(kind, id) 判斷找得到(kind 是 'bank'、'ear'、'grammar'、'word'、'tip');
       'bank' 回小題數(單題 1、題組是組裡的題數),找不到回 false。被淘汰、改版後找不到的題不算,console.warn 那個 id。
     時間:now、t0、t1、作答的 t 是 epoch 秒;作答紀錄(drill_p*、listen_p*)與學習記錄(hist)的 t 是毫秒,比較前一律換成毫秒。
   介面字串都在 TEXT;測試掃這張表(tools/test_lesson_core.js)。 */
(function (root) {
  'use strict';

  const LEVELS = ['entry', 'threshold', 'advanced', 'high'];
  const COURSE_LEVEL = { entry: 'entry', threshold: 'threshold', advanced: 'threshold', high: 'threshold' };
  const SINGLE = { 1: true, 2: true, 5: true };
  const REDO = 80;
  const PERSONAL = { review: [80, 85], weak: [85, 90], test_review: [90, 98] };
  const DAY_SEC = 86400;

  const freeze = (o) => {
    Object.keys(o).forEach((k) => { if (o[k] && typeof o[k] === 'object') freeze(o[k]); });
    return Object.freeze(o);
  };
  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const pad = (n) => (n < 10 ? '0' : '') + n;

  /* Part 名稱(同練習頁)、考點的學生頁名稱(舊欄位寫法的考點鍵;表上沒有的鍵用 Part 名稱,不顯示程式鍵);TEXT 也放一份 */
  const PART_NAME = freeze({
    1: 'Part 1 照片描述', 2: 'Part 2 應答', 3: 'Part 3 簡短對話', 4: 'Part 4 簡短獨白', 5: 'Part 5 單句填空', 6: 'Part 6 段落填空', 7: 'Part 7 閱讀理解',
  });
  const P5C = (cat) => 'P5.cat:' + cat;   // 程式用的代碼,冒號是半形(同 js/lesson-rules.js)
  const P6T = (type) => 'P6.type:' + type;
  const POINT_NAME = freeze({
    'P1.photo': '照片描述', 'P2.wh': 'WH 問句', 'P2.yn': '是非問句', 'P2.choice': '選擇問句', 'P2.request': '請求與提議',
    'P2.neg': '否定與附加問句', 'P2.statement': '平敘句回應', 'P3.set': '簡短對話', 'P4.set': '簡短獨白',
    [P5C('詞性變化')]: '詞性', [P5C('連接詞vs介系詞')]: '連接詞與介系詞', [P5C('關係詞')]: '關係詞', [P5C('字彙辨析')]: '單句字彙',
    [P6T('文法')]: '段落文法', [P6T('字彙')]: '段落字彙',
  });

  /* ---------- 介面字串 ---------- */
  const lessonNo = (n) => '第 ' + n + ' 堂';
  const segsOf = (a, b) => a + ' / ' + b + ' 段';
  const doneOf = (d) => d + ' / 24 堂';
  const partsLabel = (list) => (list || []).map((p) => 'Part ' + p).join('、');
  const TEXT = freeze({
    page: { title: '課程 - 衝衝英文', lesson: (n) => lessonNo(n) + ' - 衝衝英文' },
    app: { title: '課程', lesson: lessonNo },
    home: {
      kicker: lessonNo, done: doneOf, doneLabel: (d) => '課程 ' + doneOf(d), notLive: (n) => lessonNo(n) + '尚未開放',
      about60: '約 60 分鐘', about50: '約 50 分鐘', segs: segsOf, tomorrow: '明天開放',
      start: (n) => '開始' + lessonNo(n), resume: (n) => '繼續' + lessonNo(n), daily: '每日練習',
      course: '課程', loading: '載入中…', failed: '載入失敗', retry: '重試',
    },
    s8: { first: '開始第 1 堂', start: (n) => '開始' + lessonNo(n), resume: (n) => '繼續' + lessonNo(n) },
    list: { h1: '課程', done: doneOf, label: '24 堂', complete: '完成', segs: segsOf, todo: '未開始', closed: '未開放' },
    empty: {
      off: '課程尚未開放', unknown: '讀不到班級資料', noLevels: '還沒設定起始程度', setLevels: '設定程度',
      failed: '載入失敗', retry: '重試', itemsFailed: '題目載入失敗', reload: '重新整理', badData: '課程資料有誤', home: '回首頁',
      notFound: '找不到這一堂', back: '回課程', locked: (m) => '先完成' + lessonNo(m), goTo: (m) => '前往' + lessonNo(m),
      limit: (n) => lessonNo(n) + '明天開放', notLive: (n) => lessonNo(n) + '尚未開放', daily: '每日練習',
    },
    lesson: {
      back: '← 回課程', backTo: (n) => '← 回' + lessonNo(n), kicker: lessonNo, steps: '段落',
      min: (m) => m + ' 分鐘', aboutMin: (m) => '約 ' + m + ' 分鐘', itemsMin: (n, m) => n + ' 題 · ' + m + ' 分鐘',
      done: '完成', skip: '略過', current: '目前', left: (m) => '剩 ' + m + ' 分鐘', start: '開始', resume: '繼續',
      skipSeg: '略過這一段', skipAsk: (name) => '略過' + name + '？', skipBody: '略過後不能再做', skipOk: '略過', cancel: '取消',
      timeUpListening: '聽力測驗時間到', overListening: '聽力測驗超過 24 小時', overReading: '閱讀測驗超過 24 小時', autoSubmitted: '已自動交卷',
    },
    tip: { example: '示例', photo: '照片', play: '播出', book: '題本', next: '下一步' },
    words: { h: '本週新字', count: (n) => n + ' 個字', start: '開始小考', next: '下一題', done: '完成' },
    bridge: { parts: partsLabel, count: (n) => n + ' 題', note: '交卷後才對答案', start: '開始' },
    block: { parts: partsLabel, next: '下一步', review: (n) => '逐題解析 ' + n + ' 題' },
    grammar: { kicker: '小試身手', next: '下一步' },
    test: {
      listening: '聽力測驗', reading: '閱讀測驗', count: (n) => n + ' 題', min: (m) => m + ' 分鐘',
      oncePlay: '每題音檔只播一次', noBack: '開始後不能回上一題', start: '開始', play: '播放 · 限一次', played: '已播放', noAudio: '找不到音檔',
      picked: (x) => '已選 ' + x, next: '下一題', blankOne: '這一題還沒答', blankSet: (n) => '這一組還有 ' + n + ' 題沒答',
      submit: '交卷', blankAll: (n) => '還有 ' + n + ' 題沒答完', blankBody: '未作答的算錯', keepGoing: '繼續作答',
      timer: '剩餘時間', five: '剩 5 分鐘', one: '剩 1 分鐘', timeUp: '時間到',
    },
    pretest: {
      kicker: '第 1 堂', title: '前測完成', timeUp: '時間到', next: '繼續', tag: '暫用試卷', note: '不能跟之後的測驗直接比較',
      listening: '聽力', reading: '閱讀', part: PART_NAME, pct: (p) => p + '%', none: '—',
    },
    testReview: { title: '前測結果', tag: '暫用試卷', note: '不能跟之後的測驗直接比較', next: '下一步' },
    checkpoint: { title: '小檢核', count: (n) => n + ' 題', aboutMin: (m) => '約 ' + m + ' 分鐘', note: '結果在本堂最後顯示', start: '開始', reading: '閱讀' },
    wrapup: { kicker: lessonNo, next: '繼續', wrong: (k) => '錯題 ' + k + ' 題', checkpoint: '小檢核', checkpointReview: '小檢核解析', met: '達標', hold: '持平', weak: '弱點', point: POINT_NAME },
    admin: { col: '目前堂號', at: lessonNo, done: '完成', none: '—' },
  });

  const VERDICT = freeze({
    code: { m: 'met', h: 'hold', w: 'weak' },
    met: { text: TEXT.wrapup.met, icon: 'check' }, hold: { text: TEXT.wrapup.hold, icon: 'dash' }, weak: { text: TEXT.wrapup.weak, icon: 'dot' },
  });
  /* 考點名稱:先換成舊欄位寫法(js/lesson-rules.js 有載入時),表上沒有就用 Part 名稱 */
  function pointName(key) {
    const R = root.LESSON_RULES;
    const k = R && typeof R.legacyKey === 'function' ? R.legacyKey(key) || key : key;
    if (POINT_NAME[k]) return POINT_NAME[k];
    const m = /^P([1-7])\./.exec(String(k || ''));
    return m ? PART_NAME[m[1]] : '';
  }

  /* ---------- 試行班與級別 ---------- */
  const PILOT_ORDER = ['off', 'guest', 'teacher', 'pilot', 'no', 'checking', 'unknown'];
  /* 由上往下判,符合就停。membership:還在查是 null 或 undefined;查到是 { ok: true, classes: [{ id }] };查不到是 { ok: false }。
     cached:這個分頁工作階段已經查過的結果 { s: 'pilot'|'no', c }(帳號不同的由呼叫的一方先丟掉) */
  function pilotState(opt) {
    const o = opt || {};
    const ids = Array.isArray(o.pilotIds) ? o.pilotIds.filter((x) => typeof x === 'string' && x) : [];
    const plan = isPlain(o.plan) ? o.plan : null;
    if (o.ui !== 'pilot' && o.ui !== 'on') return { state: 'off', classId: null };
    if (!o.signedIn) return { state: 'guest', classId: null };
    if (o.teacher) return { state: 'teacher', classId: null };
    if (o.ui === 'on') return { state: 'pilot', classId: plan && plan.classId ? plan.classId : null };
    if (plan && ids.indexOf(plan.classId) > -1) return { state: 'pilot', classId: plan.classId };
    if (!ids.length) return { state: 'no', classId: null };
    const c = isPlain(o.cached) ? o.cached : null;
    if (c && c.s === 'no') return { state: 'no', classId: null };
    if (c && c.s === 'pilot' && ids.indexOf(c.c) > -1) return { state: 'pilot', classId: c.c };
    const m = o.membership;
    if (m === null || m === undefined) return { state: 'checking', classId: null };
    if (!isPlain(m) || m.ok !== true || !Array.isArray(m.classes)) return { state: 'unknown', classId: null };
    const hit = m.classes.filter((x) => x && ids.indexOf(x.id) > -1)[0];
    return hit ? { state: 'pilot', classId: hit.id } : { state: 'no', classId: null };
  }

  /* 上課用的級別:兩科的進階、高分一律上門檻包;不是四級之一回 null */
  function courseLevels(levels) {
    if (!isPlain(levels) || LEVELS.indexOf(levels.listening) < 0 || LEVELS.indexOf(levels.reading) < 0) return null;
    return { listening: COURSE_LEVEL[levels.listening], reading: COURSE_LEVEL[levels.reading] };
  }
  /* 堂名一律用閱讀級那一包的 */
  function lessonTitle(lesson) {
    const t = lesson && lesson.titleZh;
    if (typeof t === 'string') return t;
    return t ? t.reading || t.listening || '' : '';
  }

  /* ---------- 首頁卡、課程總覽、教師後台 ---------- */
  const finished = (seg) => !!seg && (seg.st === 'done' || seg.st === 'skip');
  function segCount(lesson, state) {
    const segs = lesson && Array.isArray(lesson.segments) ? lesson.segments : [];
    return [segs.filter((s) => state && state.seg && finished(state.seg[s.slot])).length, segs.length];
  }
  /* unlock 是 PACK_CORE.unlockState 的結果;lessonOf(no) 回拼好的那一堂;onLessons:課程總覽頂端(明天開放、尚未開放時放「每日練習」)。
     kind:start 可開始、doing 進行中、limit 明天開放、off 尚未開放(或 24 堂都上完) */
  function homeModel(opt) {
    const o = opt || {};
    const list = o.unlock && Array.isArray(o.unlock.lessons) ? o.unlock.lessons : [];
    const done = list.filter((x) => x.status === 'done').length;
    const no = o.unlock ? o.unlock.next : null;
    const item = list.filter((x) => x.no === no)[0];
    const status = item ? item.status : 'not_live';
    const state = o.states ? o.states[no] : null;
    const kind = no === null || status === 'not_live' ? 'off' : status === 'daily_limit' ? 'limit' : state && state.startedAt ? 'doing' : 'start';
    const lesson = kind === 'off' ? null : o.lessonOf(no);
    const segs = lesson ? segCount(lesson, state) : null;
    const about = no === 1 ? TEXT.home.about50 : TEXT.home.about60;
    const daily = kind === 'limit' || kind === 'off';
    const go = { start: [TEXT.home.start(no), 'read'], doing: [TEXT.home.resume(no), 'read'], limit: [null, 'happy'], off: [null, 'sleep'] }[kind];
    return {
      no, kind, done, segs, daily, pose: go[1],
      kicker: kind === 'off' ? null : TEXT.home.kicker(no),
      title: kind === 'off' ? (no === null ? TEXT.home.course : TEXT.home.notLive(no)) : lessonTitle(lesson),
      tags: kind === 'start' ? [about] : kind === 'doing' ? [about, TEXT.home.segs(segs[0], segs[1])] : kind === 'limit' ? [TEXT.home.tomorrow] : [],
      href: daily ? (o.onLessons ? 'daily.html' : null) : 'lesson.html?no=' + no,
      label: daily ? (o.onLessons ? TEXT.home.daily : null) : go[0],
    };
  }
  /* 課程總覽一列:完成、可上(有進度寫段數,沒有寫未開始)、不能上(未開放,不連結) */
  function rowStatus(status, state, lesson) {
    if (status === 'done') return { text: TEXT.list.complete, link: true, mark: 'done' };
    if (status !== 'open') return { text: TEXT.list.closed, link: false, mark: null };
    if (!(state && state.startedAt)) return { text: TEXT.list.todo, link: true, mark: 'todo' };
    const s = segCount(lesson, state);
    return { text: TEXT.list.segs(s[0], s[1]), link: true, mark: 'doing' };
  }
  /* 進度鍵(同 PACK_CORE.lessonKey;這裡不依賴它,教師後台只載這個檔) */
  function lessonKey(term, no) {
    if (!Number.isInteger(term) || term < 1 || term > 99 || !Number.isInteger(no) || no < 1 || no > 24) throw new TypeError('期要是 1–99、堂號要是 1–24');
    return 'les_t' + term + '_' + pad(no);
  }
  /* 教師後台:keys 是一個學生雲端的鍵。沒有 plan 回 null;24 堂都完成回 'done';其他回 { no }(第一個沒有進度或還沒上完的堂) */
  function currentNo(keys) {
    const k = isPlain(keys) ? keys : {};
    if (!isPlain(k.plan)) return null;
    const term = Number.isInteger(k.plan.term) && k.plan.term >= 1 && k.plan.term <= 99 ? k.plan.term : 1;
    for (let no = 1; no <= 24; no++) {
      const s = k[lessonKey(term, no)];
      if (!isPlain(s) || !s.doneAt) return { no };
    }
    return 'done';
  }

  /* ---------- 段落總覽 ---------- */
  /* trial = { review, weak, left }:個人段試排的題數(0 畫略過);left 是 { <段>: 剩幾分鐘 }(前測做到一半那一段) */
  function steps(lesson, state, trial) {
    const t = trial || {};
    let current = false;
    return (lesson.segments || []).map((s) => {
      const seg = state && state.seg ? state.seg[s.slot] : null;
      let st = seg && seg.st === 'done' ? 'done' : seg && seg.st === 'skip' ? 'skip' : null;
      if (!st && (!seg || seg.st === 'todo') && (s.slot === 'review' || s.slot === 'weak') && t[s.slot] === 0) st = 'skip';
      if (!st) { st = current ? 'todo' : 'current'; current = true; }
      const left = t.left && Number.isFinite(t.left[s.slot]) ? t.left[s.slot] : null;
      return { slot: s.slot, name: s.titleZh, minutes: s.minutes, fixed: !!s.fixed, st, left };
    });
  }

  /* ---------- 區塊與步驟 ---------- */
  const BANK_MOD = /^p([1-7])$/;
  function stepKind(b) {
    const m = b && b.module;
    if (m === 'tip_cards') return 'tip';
    if (m === 'test_result') return 'result';
    if (m === 'article_vocab') return b.unit === 'card' ? 'cards' : 'words';
    if (m === 'redo' || BANK_MOD.test(m)) return 'bank';
    if (m === 'grammar') return 'grammar';
    if (/^ear_/.test(String(m))) return 'ear';
    if (m === 'test_forms') return 'test';
    return 'unknown';
  }
  const HAS_KIND = { bank: 'bank', test: 'bank', ear: 'ear', grammar: 'grammar', words: 'word', tip: 'tip' };
  function partOfId(id) {
    const m = /^(?:l([1-4])|p([5-7]))-/.exec(String(id || ''));
    return m ? m[1] || m[2] : null;
  }
  const partOfBlock = (b) => (b.module === 'redo' ? (b.track === 'listening' ? '1' : '5') : (BANK_MOD.exec(b.module) || [])[1] || null);
  /* 區塊的題:技巧卡是區塊寫的卡片 id;個人段拆出來的區塊帶自己的 list;其他看凍結選題 */
  function idsOf(block, state) {
    if (Array.isArray(block.list)) return block.list.slice();
    if (block.module === 'tip_cards') return (block.ids || []).map((x) => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
    const e = state && state.pk ? state.pk[block.idx] : null;
    return e && Array.isArray(e.ids) ? e.ids.slice() : [];
  }
  /* 個人段:照凍結的選題拆成區塊(錯題重做 80 照聽讀拆兩塊、只算原本答錯的小題;考點回顧 81–84;弱點補練 85–89;測驗檢討 90–97 前面加前測結果那一步) */
  function personalBlocks(slot, state) {
    const range = PERSONAL[slot];
    const pk = state && state.pk ? state.pk : {};
    const idxs = Object.keys(pk).map(Number).filter((i) => i >= range[0] && i < range[1]).sort((a, b) => a - b);
    const out = slot === 'test_review' ? [{ idx: null, module: 'test_result', list: [] }] : [];
    idxs.forEach((idx) => {
      const e = pk[idx] || {};
      const ids = Array.isArray(e.ids) ? e.ids : [];
      if (idx === REDO) { out.push(...redoBlocks(e, ids)); return; }
      const m = idx < 85 ? 'p' + ((/^point_review:P(\d)/.exec(e.r || '') || [])[1] || partOfId(ids[0]) || '5') : e.m || 'p' + (partOfId(ids[0]) || '5');
      if (m === 'tip') out.push({ idx, module: 'tip_cards', unit: 'card', list: ids.slice() });
      else out.push({ idx, module: m, unit: 'item', timing: 'guided', playsAllowed: 2, list: ids.slice(), key: e.k || null });
    });
    return out;
  }
  function redoBlocks(e, ids) {
    const subs = Array.isArray(e.sub) ? e.sub : [];
    return ['listening', 'reading'].map((track) => {
      const at = ids.map((id, i) => i).filter((i) => (Number(partOfId(ids[i])) <= 4) === (track === 'listening'));
      return { idx: REDO, module: 'redo', track, unit: 'item', timing: 'guided', playsAllowed: 2, list: at.map((i) => ids[i]), sub: at.map((i) => subs[i] || null) };
    }).filter((b) => b.list.length);
  }
  function roundOf(b, kind, cp) {
    if (kind !== 'bank') return { kind, blocks: [b], engine: { grammar: 'GRAMMAR', ear: 'EAR' }[kind] || null, feedback: null, plays: null, parts: [], cp: false };
    const part = partOfBlock(b);
    const engine = Number(part) <= 4 ? 'LISTEN' : 'DRILL';
    const feedback = b.timing === 'guided' ? 'instant' : 'submit';
    return { kind, blocks: [b], engine, feedback, plays: engine === 'LISTEN' ? (feedback === 'instant' ? b.playsAllowed || 2 : 1) : null, parts: [], cp: !!cp && !b.fill };
  }
  /* 一段的步驟:[{ kind: 'tip'|'cards'|'words'|'bank'|'grammar'|'ear'|'test'|'result', blocks, engine, feedback, plays, parts, cp }]。
     bank 的 parts 是這一回合的 Part(照出現順序,做過場與區塊結果的小字);cp 是小檢核的檢核回合(交卷只寫進度,判定另外做) */
  function rounds(segment, state) {
    const blocks = Array.isArray(segment.blocks) ? segment.blocks : PERSONAL[segment.slot] ? personalBlocks(segment.slot, state) : [];
    const cp = segment.slot === 'checkpoint';
    const out = [];
    blocks.forEach((b) => {
      const kind = stepKind(b);
      const last = out[out.length - 1];
      const r = roundOf(b, kind, cp);
      const join = last && last.kind === kind && (kind === 'words'
        || (kind === 'bank' && last.engine === r.engine && last.feedback === r.feedback && last.cp === r.cp && (last.blocks[0].module === 'redo') === (b.module === 'redo')));
      if (join) last.blocks.push(b); else out.push(r);
    });
    out.forEach((r) => {
      if (r.kind !== 'bank') return;
      r.parts = r.blocks.reduce((a, b) => a.concat(b.module === 'redo' ? b.list.map(partOfId) : [partOfBlock(b)]), []).filter((p, i, a) => p && a.indexOf(p) === i);
      if (r.engine === 'LISTEN' && r.feedback === 'instant') r.plays = Math.max(...r.blocks.map((b) => b.playsAllowed || 2));
    });
    return out;
  }

  /* 呼叫引擎前要先跟雲端合併的作答紀錄(PACK_CORE.syncPractice 的鍵):題庫回合用到的 listen_pN 或 drill_pN 加 hist;英語耳、文法、單字不保護 */
  function syncKeys(round) {
    if (!round || round.kind !== 'bank') return [];
    return (round.parts || []).map((p) => (Number(p) <= 4 ? 'listen_p' : 'drill_p') + p).concat(['hist']);
  }

  function filterIds(block, ids, has, warn) {
    const kind = HAS_KIND[stepKind(block)];
    if (!kind) return [];
    return (ids || []).filter((id) => {
      const ok = typeof has === 'function' ? !!has(kind, id) : true;
      if (!ok && warn && typeof console !== 'undefined') console.warn('找不到這一題，略過：' + id);
      return ok;
    });
  }
  /* 可作答的題(字卡一律是空的) */
  function answerable(block, ids, has) {
    return filterIds(block, ids, has, true);
  }
  /* 一個區塊答過的題(id,題組小題是 id:sub) */
  function answeredIn(state, b) {
    return new Set((state && Array.isArray(state.a) ? state.a : []).filter((x) => x[0] === b).map((x) => (x[2] ? x[1] + ':' + x[2] : x[1])));
  }
  /* 要作答的小題鍵(跟 answeredIn 同一種寫法);錯題重做只算原本答錯的小題 */
  function subKeys(block, ids, has) {
    if (block.module === 'redo') {
      const ok = new Set(ids);
      return block.list.map((id, i) => [id, block.sub ? block.sub[i] : null]).filter((x) => ok.has(x[0])).map((x) => (x[1] ? x[0] + ':' + x[1] : x[0]));
    }
    return ids.reduce((a, id) => {
      const part = partOfId(id);
      if (!part || SINGLE[part]) return a.concat([id]);
      const n = typeof has === 'function' ? has('bank', id) : 1;
      return a.concat(Array.from({ length: typeof n === 'number' && n > 0 ? n : 1 }, (_, i) => id + ':' + (i + 1)));
    }, []);
  }
  /* 區塊完成:可作答的題都已作答(0 題直接算完成);文法單元有任何一筆作答就算;字卡、技巧卡不看作答(nextStep 另外判)。
     ids 是可作答的題;has 有給時題組照小題數展開 */
  function blockDone(block, ids, state, has) {
    const kind = stepKind(block);
    if (kind === 'tip' || kind === 'cards' || kind === 'result' || kind === 'unknown') return false;
    const list = ids || [];
    if (!list.length) return true;
    const got = answeredIn(state, block.idx);
    if (kind === 'grammar') return got.size > 0;
    return subKeys(block, list, has).every((k) => got.has(k));
  }
  /* 續做時的下一步:第一個沒完成的步驟(加 index),都完成回 null。
     技巧卡、字卡、前測結果沒有作答紀錄:同一段後面的區塊已有作答就跳過,沒有就再出一次;技巧卡全部找不到也跳過 */
  function nextStep(segment, state, has) {
    const list = rounds(segment, state);
    const rows = state && Array.isArray(state.a) ? state.a : [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.kind === 'tip' || r.kind === 'cards' || r.kind === 'result') {
        const later = new Set([].concat(...list.slice(i + 1).map((x) => x.blocks.map((b) => b.idx))));
        if (rows.some((x) => later.has(x[0]))) continue;
        if (r.kind === 'tip' && !filterIds(r.blocks[0], idsOf(r.blocks[0], state), has, false).length) continue;
        return Object.assign({ index: i }, r);
      }
      const done = r.blocks.every((b) => blockDone(b, filterIds(b, idsOf(b, state), has, false), state, has));
      if (!done) return Object.assign({ index: i }, r);
    }
    return null;
  }

  /* ---------- 作答紀錄 ---------- */
  /* 一題(組)的小題:sub 是進度裡的寫法(單題 0、題組 1 起算,P6 是空格號);key 是作答紀錄的鍵(P6「組:空格號」、P3、P4、P7「組:第幾題(0 起算)」);qi 0 起算。
     item 可以是題目、題目索引的一列({ id, size }),或只給小題數 */
  function itemKeys(part, item, id) {
    const p = String(part).replace(/^[pPlL]/, '');
    const iid = item && typeof item === 'object' ? item.id : id;
    if (SINGLE[p]) return [{ sub: 0, key: iid, qi: 0 }];
    const qs = item && Array.isArray(item.questions) ? item.questions : null;
    const n = qs ? qs.length : typeof item === 'number' ? item : (item && item.size) || 0;
    return Array.from({ length: n }, (_, qi) => {
      const num = qs && qs[qi] && qs[qi].num !== undefined ? qs[qi].num : qi + 1;
      return { sub: num, key: iid + ':' + (p === '6' ? num : qi), qi };
    });
  }
  const histMod = (part) => (Number(part) <= 4 ? 'l' : 'p') + part;
  /* 第一次作答:有回合開始前的快照就看快照;沒有(即時回合中途離開後補回)看作答紀錄與學習記錄有沒有比這一段開始(sinceMs)早的 */
  function firstOf(opt) {
    const o = opt || {};
    if (o.snapshot && typeof o.snapshot.has === 'function') return !o.snapshot.has(o.key);
    const since = Number(o.sinceMs) || 0;
    if (o.rec && Number(o.rec.t) < since) return false;
    return !(Array.isArray(o.hist) && o.hist.some((h) => h && h.m === o.m && h.id === o.key && Number(h.t) < since));
  }
  function itemFrom(items, id) {
    if (typeof items === 'function') return items(id);
    if (items && typeof items.get === 'function') return items.get(id);
    return items ? items[id] : null;
  }
  /* 即時回合補回:凍結的題裡,作答紀錄 t ≥ sinceMs 的小題 → 進度的作答列 [{ b, id, sub, c, ok, f, t }]。
     blocks:[{ idx, ids 或 list }];items(id) 回題目或小題數;records:{ '1'…'7': 作答紀錄 };錯題重做(80)的 f 一律 false */
  function reconcile(opt) {
    const o = opt || {};
    const since = Number(o.sinceMs) || 0;
    const rows = [];
    (o.blocks || []).forEach((b) => {
      (Array.isArray(b.list) ? b.list : b.ids || []).forEach((id) => {
        const part = partOfId(id), item = itemFrom(o.items, id);
        if (!part || !item) return;
        itemKeys(part, item, id).forEach((k) => {
          const rec = o.records && o.records[part] ? o.records[part][k.key] : null;
          if (!rec || !(Number(rec.t) >= since)) return;
          const f = b.idx !== REDO && firstOf({ key: k.key, m: histMod(part), snapshot: o.snapshot, rec, hist: o.hist, sinceMs: since });
          rows.push({ b: b.idx, id, sub: k.sub, c: Number.isInteger(rec.c) ? rec.c : -1, ok: !!rec.ok, f, t: Math.floor(Number(rec.t) / 1000) });
        });
      });
    });
    return rows;
  }

  /* ---------- 小檢核、補記 ---------- */
  const hitsOf = (pts) => (isPlain(pts) ? Object.keys(pts).map((k) => [k, isPlain(pts[k]) && Array.isArray(pts[k].hits) ? pts[k].hits : []]) : []);
  /* 判過沒有:任一考點有這一批(b 是 '<進度鍵>:cp') */
  function judged(pts, b) {
    return hitsOf(pts).some(([, hits]) => hits.some((h) => h && h.b === b));
  }
  /* 這一批的判定(存在 pts 那一批的 v) */
  function verdictsOf(pts, b) {
    return hitsOf(pts).reduce((a, [key, hits]) => {
      const h = hits.filter((x) => x && x.b === b && VERDICT.code[x.v])[0];
      return h ? a.concat([{ key, verdict: VERDICT.code[h.v] }]) : a;
    }, []);
  }
  /* 本堂結果補記 pts 的來源與批次:小檢核 c、考點回顧 r、弱點補練 w、其他題庫區塊 p;錯題重做、前測不記(回 null)。key 是進度鍵 */
  function rerecord(idx, slot, key) {
    if (slot === 'test_listening' || slot === 'test_reading' || idx === REDO) return null;
    const k = key || '';
    if (slot === 'checkpoint') return { src: 'c', b: k + ':cp' };
    const src = idx > REDO && idx < 85 ? 'r' : idx >= 85 && idx < 90 ? 'w' : 'p';
    return { src, b: k + ':' + idx };
  }

  /* ---------- 第 1 堂前測 ---------- */
  /* 配額(模擬考標準半回);idx 是凍結的區塊編號 */
  const TEST_QUOTA = freeze({
    test_listening: { idx: 0, parts: [['1', 3], ['2', 12], ['3', 4], ['4', 3]] },
    test_reading: { idx: 1, parts: [['5', 15], ['6', 2], ['7', 4]] },
  });
  const TEST_PACE = { test_listening: [1380, 49], test_reading: [2220, 50] };
  /* 限時(秒):照學習包每題的速度換算 */
  function testLimit(slot, questions) {
    const p = TEST_PACE[slot];
    if (!p) throw new TypeError('不是測驗段：' + slot);
    return Math.round(p[0] * Math.max(0, Number(questions) || 0) / p[1]);
  }
  /* 接著做:lastAt 是最後活動時間(最後一題的作答時間與這個分頁記的最後畫面時間取晚的,沒有就是 t0)。
     超過 24 小時 expired;否則剩餘＝限時 −(最後活動 − t0),不會小於 0 */
  function testResume(opt) {
    const o = opt || {};
    const t0 = Number(o.t0) || 0;
    const last = Math.max(t0, Number(o.lastAt) || 0);
    if (Number(o.now) - last > DAY_SEC) return { remaining: 0, expired: true };
    return { remaining: Math.max(0, (Number(o.limit) || 0) - (last - t0)), expired: false };
  }
  /* 各 Part 的 { n, ok }:凍結的前測題裡可作答的(題組照 metaSize(id) 展開成小題),ok 照進度的作答 */
  function partsOf(state, metaSize, has) {
    const out = {};
    for (let p = 1; p <= 7; p++) out['P' + p] = { n: 0, ok: 0 };
    const rows = new Map((state && Array.isArray(state.a) ? state.a : []).map((x) => [x[0] + '|' + x[1] + '|' + (x[2] || 0), x]));
    [0, 1].forEach((idx) => {
      const e = state && state.pk ? state.pk[idx] : null;
      (e && Array.isArray(e.ids) ? e.ids : []).forEach((id) => {
        const part = partOfId(id);
        if (!part || (typeof has === 'function' && !has('bank', id))) return;
        const n = SINGLE[part] ? 1 : Number(typeof metaSize === 'function' ? metaSize(id) : 0) || 0;
        const subs = SINGLE[part] ? [0] : Array.from({ length: n }, (_, i) => i + 1);
        subs.forEach((sub) => {
          const x = rows.get(idx + '|' + id + '|' + sub);
          out['P' + part].n++;
          if (x && (x[4] & 1) === 1) out['P' + part].ok++;
        });
      });
    });
    return out;
  }

  /* ---------- 單字 ---------- */
  /* 英翻中四選一:用每日練習的選項規則(js/daily.js 的 DAILY.vocabItem)。word、pool 的每個字是 { answer(或 base), zh } */
  function vocabOptions(word, pool, seed) {
    const D = root.DAILY;
    if (!D || typeof D.vocabItem !== 'function') throw new Error('要先載入 js/daily.js');
    const w = { answer: word.answer || word.base, zh: word.zh };
    const p = (pool || []).map((x) => ({ answer: x.answer || x.base, zh: x.zh }));
    const r = D.vocabItem(p, w, String(seed));
    return { options: r.options.slice(), answer: r.a };
  }
  /* 字表(data/packs/words_<級>.json)→ weekWords(週, 'this_week'|'last_week'|'three_weeks_ago') → 字序字串;沒有那一週回空陣列 */
  function weekWordsFrom(file) {
    const weeks = file && isPlain(file.weeks) ? file.weeks : {};
    const back = { this_week: 0, last_week: 1, three_weeks_ago: 3 };
    return function (week, which) {
      const w = weeks[String(Number(week) - (back[which] === undefined ? NaN : back[which]))];
      if (!w || !Number.isInteger(w.from) || !Number.isInteger(w.to)) return [];
      return Array.from({ length: Math.max(0, w.to - w.from + 1) }, (_, i) => String(w.from + i));
    };
  }

  root.LESSON_CORE = Object.freeze({
    PILOT_ORDER, TEXT, PART_NAME, POINT_NAME, VERDICT, TEST_QUOTA, REDO,
    pilotState, courseLevels, lessonTitle, homeModel, rowStatus, lessonKey, currentNo, steps,
    stepKind, partOfId, idsOf, rounds, syncKeys, answerable, answeredIn, blockDone, nextStep,
    itemKeys, firstOf, reconcile, judged, verdictsOf, rerecord, testLimit, testResume, partsOf,
    vocabOptions, weekWordsFrom, pointName,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
