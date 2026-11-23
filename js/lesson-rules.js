/* 課程的判定規則(純計算,不讀寫儲存、不碰畫面):考點鍵、考點狀態、題組型的週累計、小檢核判定、
   回顧排程(review_v1)、弱點補練(weak_v1)、測驗檢討出題(test_review_v1)。js/pack-core.js、課程頁、tools/test_lesson_rules.js 共用。
   這一版是簡化版:題目還沒有新的考點標籤,考點一律換成舊欄位的寫法(legacyKey)再判定:
     P1.photo;P2.wh、yn、choice、request(Can you／Could you 開頭的是非問句)、statement、neg(否定與附加問句合併);
     P3.set、P4.set、P7.set(整組);P5.cat:<分類>;P6.type:<小題題型>。
   日期一律是 'YYYY-MM-DD' 字串(學生當地的日子,由呼叫的一方給);週是週一到週日。
   兩台的 pts、rvq 合併用 js/sync-merge.js(SYNC_MERGE.pts、rvq;雲端同步也用同一份),要先載入它。
   考點狀態(store 鍵 pts):{ <考點鍵>: { s, hits: [{ d, n, ok, src, b, v }], pauseUntil } }
     s:new(沒練)、learning(學習中)、met(達標過一次、還沒過關)、passed(過關)、weak(弱點)、stuck(卡關,pauseUntil 之前暫停不排)。
       s 是寫入時算的快取,兩台合併後可能過時,讀的時候用 statusOf 或 mergePts 重算
     hits:一批作答一筆(一個區塊交卷),只算首次作答;n 題數、ok 答對數、b 這一批的編號(合併兩台時用);
       src 'p' 一般練習／'w' 弱點補練／'c' 小檢核／'r' 考點回顧(回顧段的考點回顧新題;錯題重做不是首次作答,不記);
       v 只有小檢核那一批有:記作答時的判定 'm' 達標、'h' 持平、'w' 弱點(judgeCheckpoint 用同一個函式算)。60 天前的批次刪掉
     小檢核那一批自己判:不跟同一天其他練習合算(題組型不到 5 題時才併往前 7 天內、含今天稍早的一般作答),判達標就是那一天(題組型那一週)的一次達標。
     考點回顧答對不到 2/3:那一天(題組型那一週)以前的達標都不算,要重新達標兩次才再過關(退回學習中)。
     錯題重做(回顧段第 80 區塊)不算進「最近一次作答」:答錯不會讓過關的考點退回,要不要算由站長決定(還沒定)。
   回顧佇列(store 鍵 rvq):[{ m, id, sub, due, step, d0 }](錯題重做)或 [{ k, due, step, d0 }](考點回顧),最多 RVQ_MAX 筆;
     做完移出的留刪除紀錄(同一項加 x:移出那天、沒有 due),保留 TOMB_DAYS 天,另一台的舊佇列合併時才不會把它帶回來 */
(function (root) {
  'use strict';
  function sync() {
    const S = root.SYNC_MERGE;
    if (!S || typeof S.pts !== 'function' || typeof S.rvq !== 'function') throw new Error('要先載入 js/sync-merge.js');
    return S;
  }

  /* ---------- 日期 ---------- */
  const DAY = 864e5;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  function checkDate(d) {
    if (typeof d !== 'string' || !DATE.test(d) || isNaN(Date.parse(d + 'T00:00:00Z'))) throw new TypeError('日期要是 YYYY-MM-DD：' + JSON.stringify(d));
    return d;
  }
  function addDays(d, n) {
    return new Date(Date.parse(checkDate(d) + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    return Math.round((Date.parse(checkDate(b) + 'T00:00:00Z') - Date.parse(checkDate(a) + 'T00:00:00Z')) / DAY);
  }
  /* 那一週的週一 */
  function weekOf(d) {
    const wd = new Date(Date.parse(checkDate(d) + 'T00:00:00Z')).getUTCDay();
    return addDays(d, -((wd + 6) % 7));
  }

  /* ---------- 考點鍵:新代碼 → 舊欄位 ---------- */
  const P2_CAT = { 'WH問句': 'wh', 'Yes/No問句': 'yn', '選擇問句': 'choice', '附加/否定問句': 'neg', '陳述句': 'statement', '陳述句回應': 'statement' };
  const P2_WHERE = {
    wh: { category: ['WH問句'] }, yn: { category: ['Yes/No問句'], canYou: false }, request: { category: ['Yes/No問句'], canYou: true },
    choice: { category: ['選擇問句'] }, statement: { category: ['陳述句', '陳述句回應'] }, neg: { category: ['附加/否定問句'] },
  };
  /* P5 新的第二層考點 → 舊分類 */
  const P5_CAT = {
    noun_slot: '詞性變化', adj_slot: '詞性變化', adv_slot: '詞性變化', verb_slot: '詞性變化', word_form: '詞性變化',
    tense: '動詞時態與語態', voice: '動詞時態與語態', mood: '動詞時態與語態', agreement: '主謂一致',
    inf_gerund: '不定詞與動名詞', participle: '分詞', pron_case: '代名詞', reflexive: '代名詞', demonstrative: '代名詞', quantifier: '代名詞',
    prep_vs_conj: '連接詞vs介系詞', sub_conj: '連接詞vs介系詞', correlative: '連接詞vs介系詞', prep_meaning: '介系詞',
    relative_pron: '關係詞', relative_adv: '關係詞', compound_relative: '關係詞', comparison: '比較級',
    collocation: '慣用搭配', phrasal_verb: '片語動詞',
  };
  /* P5 的 qType → 舊分類(可以是幾個) */
  const P5_QTYPE = {
    word_form: ['詞性變化'], verb_form: ['動詞時態與語態', '主謂一致', '不定詞與動名詞', '分詞'], pronoun: ['代名詞'],
    connector: ['連接詞vs介系詞', '介系詞'], clause: ['關係詞'], vocab: ['字彙辨析', '慣用搭配', '片語動詞'], other_structure: ['比較級'],
  };
  const P6_TYPE = { grammar: '文法', transition: '文法', vocab: '字彙', insertion: '句子插入' };
  const VOCAB_CATS = ['字彙辨析', '慣用搭配', '片語動詞'];

  function p5Cat(code) {
    if (/^vocab(_|$)/.test(code)) return '字彙辨析';
    return P5_CAT[code.replace(/-\d{2}$/, '')] || null;
  }

  /* 新或舊寫法的考點鍵 → 舊欄位的考點鍵;認不得回 null */
  function legacyKey(key) {
    const m = /^P([1-7])\.(.+)$/.exec(String(key || ''));
    if (!m) return null;
    const p = m[1], code = m[2];
    if (p === '1') return code === 'photo' ? 'P1.photo' : null;
    if (p === '2') {
      if (code === 'tag' || code === 'neg') return 'P2.neg';
      return P2_WHERE[code] ? 'P2.' + code : null;
    }
    if (p === '3' || p === '4' || p === '7') return /^[a-z_]+$/.test(code) ? 'P' + p + '.set' : null;
    if (p === '5') {
      if (/^cat:\S+$/.test(code)) return 'P5.' + code;
      const cat = p5Cat(code);
      return cat ? 'P5.cat:' + cat : null;
    }
    if (/^type:\S+$/.test(code)) return 'P6.' + code;
    return /^[a-z_]+$/.test(code) ? 'P6.type:' + (P6_TYPE[code] || '文法') : null;
  }

  /* 舊欄位考點鍵 → BANK.pick 的 { part, where } */
  function bankWhere(key) {
    const k = legacyKey(key);
    if (!k) return null;
    const p = k.charAt(1), code = k.slice(3);
    if (p === '2') return { part: '2', where: Object.assign({}, P2_WHERE[code], { category: P2_WHERE[code].category.slice() }) };
    if (p === '5') return { part: '5', where: { category: [code.slice(4)] } };
    if (p === '6') return { part: '6', where: { type: [code.slice(5)] } };
    return { part: p, where: {} };
  }

  /* 一筆題目索引(data/bank-meta.js)→ 各小題的考點鍵(舊欄位寫法),單題回一個 */
  function keysOfRow(row) {
    const p = String(row && row.part);
    if (p === '1') return ['P1.photo'];
    if (p === '2') {
      const q = row.category === 'Yes/No問句' && row.canYou ? 'request' : P2_CAT[row.category];
      return q ? ['P2.' + q] : [];
    }
    if (p === '5') return row.category ? ['P5.cat:' + row.category] : [];
    if (p === '6') return (row.types || []).map((t) => 'P6.type:' + t);
    if (p === '3' || p === '4' || p === '7') return Array.from({ length: row.size || 0 }, () => 'P' + p + '.set');
    return [];
  }

  const isGroupKey = (key) => /^P[3467]\./.test(String(key));

  /* ---------- 考點狀態 ---------- */
  const WINDOW_DAYS = 60;
  const MET_MIN = 5, MET_RATE = 0.8, HOLD_RATE = 0.6, PAUSE_DAYS = 7, HITS_MAX = 400;

  const rate = (ok, n) => (n > 0 ? ok / n : 0);
  function recentHits(entry, today) {
    const from = addDays(today, -WINDOW_DAYS);
    return (entry && Array.isArray(entry.hits) ? entry.hits : []).filter((h) => h.d >= from && h.d <= today);
  }
  const unitOf = (key, d) => (isGroupKey(key) ? weekOf(d) : d);
  /* 一次判定:≥5 題且 ≥80% 達標('m')、≥60% 持平('h')、其他弱點('w') */
  function verdictOf(n, ok) {
    const r = rate(ok, n);
    return n >= MET_MIN && r >= MET_RATE ? 'm' : r >= HOLD_RATE ? 'h' : 'w';
  }
  const cpVerdict = (h) => (h.v === 'm' || h.v === 'h' || h.v === 'w' ? h.v : verdictOf(h.n, h.ok));
  /* 小檢核一個考點的判定:題組型不到 5 題時,併往前 7 天內(含今天稍早)同考點、不是小檢核的首次作答 */
  function judgeOne(key, n0, ok0, entry, today) {
    let n = n0, ok = ok0;
    if (isGroupKey(key) && n < MET_MIN) {
      const from = addDays(today, -7);
      recentHits(entry, today).filter((h) => h.d >= from && h.src !== 'c').forEach((h) => { n += h.n; ok += h.ok; });
    }
    return { n, ok, v: verdictOf(n, ok) };
  }

  /* 達標過的日子(單題型)或週(題組型):小檢核那一批判達標就算;其他作答同一天／同一週合計 ≥5 題、≥80% */
  function metUnits(key, hits) {
    const units = new Set(), by = new Map();
    hits.forEach((h) => {
      const u = unitOf(key, h.d);
      if (h.src === 'c') { if (cpVerdict(h) === 'm') units.add(u); return; }
      const x = by.get(u) || { n: 0, ok: 0 };
      by.set(u, { n: x.n + h.n, ok: x.ok + h.ok });
    });
    by.forEach((x, u) => { if (x.n >= MET_MIN && rate(x.ok, x.n) >= MET_RATE) units.add(u); });
    return [...units].sort();
  }
  /* 最近一次答對不到 2/3 的考點回顧(沒有回 null) */
  function lastFailedReview(hits) {
    return hits.filter((h) => h.src === 'r' && h.ok * 3 < h.n * 2).reduce((a, h) => (!a || h.d >= a.d ? h : a), null);
  }

  function latestDay(hits) {
    const last = hits.reduce((a, h) => (h.d > a ? h.d : a), '');
    const day = hits.filter((h) => h.d === last);
    return { d: last, n: day.reduce((a, h) => a + h.n, 0), ok: day.reduce((a, h) => a + h.ok, 0) };
  }

  /* 弱點補練的幾次(每次 ≥5 題),卡關只看上次暫停結束之後的 */
  function weakRuns(entry, hits) {
    const after = entry && entry.pauseUntil ? entry.pauseUntil : '';
    return hits.filter((h) => h.src === 'w' && h.n >= MET_MIN && h.d >= after).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  }

  /* 一個考點今天的狀態(由上往下判,先符合者為準) */
  function statusOf(key, entry, today) {
    checkDate(today);
    if (entry && entry.pauseUntil && today < entry.pauseUntil) return 'stuck';
    const hits = recentHits(entry, today);
    if (!hits.length) return 'new';
    const fail = lastFailedReview(hits);
    const met = metUnits(key, hits).filter((u) => !fail || u > unitOf(key, fail.d));
    const last = latestDay(hits);
    if (met.length >= 2 && rate(last.ok, last.n) >= HOLD_RATE) return 'passed';
    const runs = weakRuns(entry, hits);
    if (runs.length >= 3 && runs.slice(-3).every((h) => rate(h.ok, h.n) < HOLD_RATE)) return 'stuck';
    const n = hits.reduce((a, h) => a + h.n, 0), ok = hits.reduce((a, h) => a + h.ok, 0);
    const cps = hits.filter((h) => h.src === 'c');
    const lastCp = cps.length ? cps.reduce((a, h) => (h.d >= a.d ? h : a)) : null;
    if ((n >= MET_MIN && rate(ok, n) < HOLD_RATE) || (lastCp && cpVerdict(lastCp) === 'w')) return 'weak';
    return met.length ? 'met' : 'learning';
  }

  /* 重算一個考點(新物件):剛變成卡關的,暫停到 7 天後 */
  function settle(key, entry, today) {
    const s = statusOf(key, entry, today);
    const paused = !!(entry.pauseUntil && today < entry.pauseUntil);
    const pauseUntil = s === 'stuck' && !paused ? addDays(today, PAUSE_DAYS) : entry.pauseUntil || null;
    return { s, hits: entry.hits, pauseUntil };
  }

  function sameHit(a, b) { return a.b === b.b; }
  /* 60 天前的批次刪掉(不照批數刪,常出現的考點 60 天內超過幾十批也不會丟掉還算數的達標);另外最多留 HITS_MAX 批(新的) */
  function capHits(hits, today) {
    const from = addDays(today, -WINDOW_DAYS);
    const sorted = hits.filter((h) => h.d >= from).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    return sorted.slice(Math.max(0, sorted.length - HITS_MAX));
  }

  /* 記一批作答:answers = [{ key, ok, first }],src、b 見檔頭;只算 first 的。回新的 pts。
     小檢核(src 'c')要在 judgeCheckpoint 之後記,這一批的判定(v)用同一個函式算 */
  function addHits(pts, answers, opt) {
    const { today, src, b } = opt || {};
    checkDate(today);
    if (['p', 'w', 'c', 'r'].indexOf(src) < 0) throw new TypeError('src 要是 p、w、c、r');
    if (typeof b !== 'string' || !b) throw new TypeError('b 要是這一批的編號');
    const add = new Map();
    (answers || []).forEach((x) => {
      const k = legacyKey(x && x.key);
      if (!k || !x.first) return;
      const h = add.get(k) || { d: today, n: 0, ok: 0, src, b };
      add.set(k, Object.assign({}, h, { n: h.n + 1, ok: h.ok + (x.ok ? 1 : 0) }));
    });
    const out = Object.assign({}, pts || {});
    add.forEach((h0, k) => {
      const prev = out[k] || { s: 'new', hits: [], pauseUntil: null };
      const h = src === 'c' ? Object.assign({}, h0, { v: judgeOne(k, h0.n, h0.ok, prev, today).v }) : h0;
      const old = (prev.hits || []).filter((x) => sameHit(x, h))[0];
      /* 同一批重送(例如交卷後補答):留題數多的那筆 */
      const hits = !old ? capHits((prev.hits || []).concat([h]), today)
        : h.n > old.n ? capHits(prev.hits.filter((x) => !sameHit(x, h)).concat([h]), today) : prev.hits;
      out[k] = settle(k, Object.assign({}, prev, { hits }), today);
    });
    return out;
  }

  /* 兩台的 pts 合併(SYNC_MERGE.pts:hits 以 b 聯集、同一批取題數多的,暫停取晚的),再刪 60 天前的批次、重算每個考點的狀態。
     b 是 null 也會重算(雲端同步合併過的 s 可能過時) */
  function mergePts(a, b, today) {
    checkDate(today);
    const plainOr = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : null);
    const m = sync().pts(plainOr(a), plainOr(b));
    const base = m.ok && m.v ? m.v : {};
    const out = {};
    Object.keys(base).forEach((k) => {
      const e = base[k] && typeof base[k] === 'object' ? base[k] : {};
      out[k] = settle(k, { hits: capHits(Array.isArray(e.hits) ? e.hits : [], today), pauseUntil: e.pauseUntil || null }, today);
    });
    return out;
  }

  /* 近 60 天首次作答的答對率(沒有作答回 null)與近 7 天答錯題數 */
  function accuracyOf(entry, today) {
    const hits = recentHits(entry, today);
    const n = hits.reduce((a, h) => a + h.n, 0);
    return n ? rate(hits.reduce((a, h) => a + h.ok, 0), n) : null;
  }
  function recentWrong(entry, today) {
    const from = addDays(today, -7);
    return recentHits(entry, today).filter((h) => h.d >= from).reduce((a, h) => a + h.n - h.ok, 0);
  }

  /* ---------- 小檢核判定 ----------
     items = [{ key, ok }](這次小檢核計分的小題;補足區塊不算)。回 [{ key, n, ok, verdict, passes }]:
     verdict 'met'(達標)、'hold'(持平)、'weak'(弱點);題數 <5 時只判持平或弱點。
     題組型考點不足 5 題時,跟往前 7 天內(含今天稍早,不含小檢核)同考點的首次作答合併計(n、ok 是合併後的)。
     passes:把這一批記進去之後(addHits src 'c',同一個判定函式),狀態會是過關。要在記這一批之前呼叫 */
  const VERDICT = { m: 'met', h: 'hold', w: 'weak' };
  function judgeCheckpoint(items, pts, today) {
    checkDate(today);
    const by = new Map();
    (items || []).forEach((x) => {
      const k = legacyKey(x && x.key);
      if (!k) return;
      const c = by.get(k) || { n: 0, ok: 0 };
      by.set(k, { n: c.n + 1, ok: c.ok + (x.ok ? 1 : 0) });
    });
    return [...by.entries()].map(([key, c]) => {
      const entry = (pts || {})[key];
      const j = judgeOne(key, c.n, c.ok, entry, today);
      const hits = recentHits(entry, today).concat([{ d: today, n: c.n, ok: c.ok, src: 'c', b: '', v: j.v }]);
      const passes = j.v === 'm' && statusOf(key, Object.assign({}, entry, { hits }), today) === 'passed';
      return { key, n: j.n, ok: j.ok, verdict: VERDICT[j.v], passes };
    });
  }

  /* 還沒過關的考點(第 24 堂的「達標一次、還沒過關」用 onlyMet) */
  function unpassedKeys(pts, keys, onlyMet) {
    const out = [];
    (keys || []).forEach((key) => {
      const k = legacyKey(key);
      if (!k || out.indexOf(k) > -1) return;
      const s = pts && pts[k] ? pts[k].s : 'new';
      if (onlyMet ? s === 'met' : s !== 'passed') out.push(k);
    });
    return out;
  }

  /* ---------- 回顧排程 review_v1 ---------- */
  const RVQ_MAX = 300, STEPS = [1, 7, 21], OVERDUE_DAYS = 14, OVERDUE_KEEP = 30, TOMB_DAYS = 14;
  const idOf = (e) => (e.k ? 'k|' + e.k : 'i|' + e.m + '|' + e.id + '|' + (e.sub === undefined || e.sub === null ? '' : e.sub));
  const live = (list) => (list || []).filter((e) => e && !e.x);

  /* 佇列裡的項目最多 RVQ_MAX 筆(留最近答錯的);today 有給時刪掉超過 TOMB_DAYS 天的刪除紀錄 */
  function capQueue(list, today) {
    const from = today ? addDays(today, -TOMB_DAYS) : '';
    const gone = list.filter((e) => e && e.x && e.x >= from), q = live(list);
    if (q.length <= RVQ_MAX) return q.concat(gone);
    return q.slice().sort((a, b) => (a.d0 < b.d0 ? 1 : a.d0 > b.d0 ? -1 : 0)).slice(0, RVQ_MAX).concat(gone);
  }
  /* 做完移出:留刪除紀錄(這一項當時的 d0、step,加 x) */
  function tomb(e, today) {
    const t = Object.assign({}, e, { x: today });
    delete t.due;
    return t;
  }

  /* 答錯一題(練習、小檢核;測驗題由呼叫的一方決定何時放進來):排 D+1,已經在佇列(或有刪除紀錄)就從頭排 */
  function scheduleWrong(rvq, ref, today) {
    checkDate(today);
    if (!ref || typeof ref.m !== 'string' || typeof ref.id !== 'string') throw new TypeError('要給 { m, id, sub }');
    const e = { m: ref.m, id: ref.id, sub: ref.sub === undefined ? null : ref.sub, due: addDays(today, 1), step: 1, d0: today };
    return capQueue((rvq || []).filter((x) => idOf(x) !== idOf(e)).concat([e]), today);
  }

  /* 考點變成過關:排 D+7、D+21 的考點回顧(佇列裡已經有就不動;只有刪除紀錄的重新排) */
  function schedulePassed(rvq, key, today) {
    checkDate(today);
    const k = legacyKey(key);
    if (!k) throw new TypeError('認不得的考點鍵：' + key);
    if (live(rvq).some((x) => x.k === k)) return capQueue((rvq || []).slice(), today);
    return capQueue((rvq || []).filter((x) => x.k !== k).concat([{ k, due: addDays(today, 7), step: 7, d0: today }]), today);
  }

  /* 回顧做完一項:錯題重做 ok 是對錯;考點回顧 ok 是「3 題對 2 題以上」。回新的佇列(移出的留刪除紀錄) */
  function reviewDone(rvq, entry, ok, today) {
    checkDate(today);
    const id = idOf(entry);
    const cur = live(rvq).filter((x) => idOf(x) === id)[0];
    if (!cur) return capQueue((rvq || []).slice(), today);
    const rest = (rvq || []).filter((x) => idOf(x) !== id);
    if (!ok) return cur.k ? capQueue(rest.concat([tomb(cur, today)]), today) : scheduleWrong(rest, cur, today);
    const next = STEPS[STEPS.indexOf(cur.step) + 1];
    if (!next) return capQueue(rest.concat([tomb(cur, today)]), today);
    return capQueue(rest.concat([Object.assign({}, cur, { step: next, due: addDays(cur.d0, next) })]), today);
  }

  /* 開回顧段時選項目。opt = { today, seconds, maxUnits, secondsOf(e), keyOf(e)(錯題重做那題的考點鍵), accuracy(key) }
     回 { units, rvq }:逾期超過 14 天的錯題重做只留最近答錯的 30 題,其餘改成考點回顧(rvq 是整理過的佇列) */
  function pickReview(rvq, opt) {
    const { today, seconds, maxUnits } = opt;
    checkDate(today);
    const secondsOf = opt.secondsOf, keyOf = opt.keyOf || (() => null), acc = opt.accuracy || (() => 1);
    const old = live(rvq).filter((e) => !e.k && daysBetween(e.due, today) > OVERDUE_DAYS)
      .sort((a, b) => (a.d0 < b.d0 ? 1 : a.d0 > b.d0 ? -1 : 0));
    const drop = new Set(old.slice(OVERDUE_KEEP).map(idOf));
    let queue = (rvq || []).filter((e) => e && !(drop.has(idOf(e)) && !e.x));
    old.slice(OVERDUE_KEEP).forEach((e) => {
      const k = legacyKey(keyOf(e));
      if (k && !live(queue).some((x) => x.k === k)) queue = queue.filter((x) => x.k !== k).concat([{ k, due: today, step: 7, d0: addDays(today, -7) }]);
    });
    const due = live(queue).filter((e) => e.due <= today).sort((a, b) => {
      if (!!a.k !== !!b.k) return a.k ? 1 : -1;
      if (a.due !== b.due) return a.due < b.due ? -1 : 1;
      return acc(a.k || keyOf(a)) - acc(b.k || keyOf(b));
    });
    const units = [];
    let used = 0;
    due.forEach((e) => {
      const s = secondsOf(e);
      if (units.length < maxUnits && used + s <= seconds) { units.push(e); used += s; }
    });
    return { units, seconds: used, rvq: capQueue(queue, today) };
  }

  /* 兩台的回顧佇列合併(SYNC_MERGE.rvq):同一項取新的(d0 晚、一樣時 step 大),刪除紀錄一樣新時贏;
     舊的那台還是第 1 步、或已經做完移出的,不會蓋掉進度、也不會被帶回來 */
  function mergeRvq(a, b) {
    const m = sync().rvq(Array.isArray(a) ? a : null, Array.isArray(b) ? b : null);
    return m.ok && Array.isArray(m.v) ? capQueue(m.v.slice()) : [];
  }

  /* ---------- 弱點補練 weak_v1(簡化版) ---------- */
  /* 舊欄位寫法的考點鍵(程式用的代碼,冒號是半形) */
  const P5C = (cat) => 'P5.cat:' + cat;
  const P6T = (type) => 'P6.type:' + type;
  /* 先備(舊欄位寫法):左邊是弱點時,先備是弱點或沒練過就改補先備 */
  const PREREQ = {
    [P5C('分詞')]: P5C('動詞時態與語態'), [P5C('關係詞')]: P5C('代名詞'),
    'P2.statement': 'P2.wh', 'P2.neg': 'P2.wh', [P6T('句子插入')]: 'P7.set',
  };
  /* 一回正式卷的題數權重;沒列的用 2 */
  const WEIGHT = { 'P1.photo': 6, 'P2.wh': 11, 'P2.yn': 3, 'P2.statement': 3, [P5C('詞性變化')]: 7, [P6T('句子插入')]: 4 };
  VOCAB_CATS.forEach((c) => { WEIGHT[P5C(c)] = 11 / VOCAB_CATS.length; });
  /* 各級先不排的考點(舊欄位寫法判得出來的才列) */
  const NOT_FOR = { entry: [], threshold: [], advanced: [], high: [] };
  /* 答對率 <40% 時改派的文法單元(依舊分類) */
  const BASE_UNITS = {
    '詞性變化': ['ga-01', 'ga-02', 'gf-01', 'gf-02', 'gf-03', 'gf-04'], '動詞時態與語態': ['gb-04', 'gb-09', 'gc-01', 'gc-02', 'gh-01'],
    '主謂一致': ['gb-01', 'gb-05'], '代名詞': ['ga-09', 'ga-10'], '介系詞': ['gg-01', 'gg-02', 'gg-03', 'gg-04'],
    '連接詞vs介系詞': ['gg-08', 'gg-09'], '關係詞': ['gh-03', 'gh-04'], '不定詞與動名詞': ['gg-05'], '分詞': ['gf-02'],
    '比較級': ['gf-05', 'gf-06', 'gf-07'],
  };
  const PRACTICE_SECONDS = { '1': 40, '2': 35, '3': 180, '4': 180, '5': 40, '6': 240, '7': 360 };
  const TRACK_OF = (key) => (/^P[1-4]\./.test(key) ? 'listening' : 'reading');
  const LEVEL_RANK = { entry: 0, threshold: 1, advanced: 2, high: 3 };

  function weightOf(key) { return WEIGHT[key] || 2; }

  /* 候選考點:弱點(卡關暫停中的不算),先備換上(排序用原本那個弱點考點的分數),排除該級先不排的 */
  function weakCandidates(pts, levels, today) {
    const out = [];
    Object.keys(pts || {}).forEach((k) => {
      if (statusOf(k, pts[k], today) !== 'weak') return;
      const pre = PREREQ[k];
      const preS = pre ? statusOf(pre, (pts || {})[pre], today) : null;
      const pick = pre && (preS === 'weak' || preS === 'new') ? { key: pre, from: k, reason: 'prereq:' + pre } : { key: k, from: k, reason: 'weak:' + k };
      const lv = levels[TRACK_OF(pick.key)];
      if ((NOT_FOR[lv] || []).indexOf(pick.key) > -1 || out.some((x) => x.key === pick.key)) return;
      out.push(pick);
    });
    return out;
  }

  /* 改派基礎模組:閱讀級入門、門檻的 P5 文法類 <40% → 文法單元 1 個;聽力級入門的 P1、P2 <40% → 聽寫 5 句 */
  function baseModule(key, accuracy, levels, doneUnits) {
    if (accuracy === null || accuracy >= 0.4) return null;
    const cat = /^P5\.cat:(.+)$/.exec(key);
    if (cat && (levels.reading === 'entry' || levels.reading === 'threshold') && BASE_UNITS[cat[1]]) {
      const unit = BASE_UNITS[cat[1]].filter((u) => !(doneUnits && doneUnits.has(u)))[0] || BASE_UNITS[cat[1]][0];
      return { module: 'grammar', ids: [unit], seconds: 480 };
    }
    if (/^P[12]\./.test(key) && levels.listening === 'entry') return { module: 'ear_dictation', count: 5, seconds: 300 };
    return null;
  }

  /* opt = { pts, levels: { listening, reading }, seconds, today, doneUnits(Set,文法單元做過的), fallback: { testParts, nextFocus } }
     回 [{ key, part, track, seconds, reason, base }]:最多 2 個考點;聽讀差一級時弱科的考點排前面、至少分到 2/3 的時間。
     沒有候選:fallback a(最近一次測驗答對率最低的 Part)、b(下週主考點)、c(閱讀 P5 混合) */
  function planWeak(opt) {
    const { pts, levels, seconds, today } = opt;
    checkDate(today);
    if (!levels || !LEVEL_RANK.hasOwnProperty(levels.listening) || !LEVEL_RANK.hasOwnProperty(levels.reading)) throw new TypeError('levels 要有 listening、reading 的級');
    const cands = weakCandidates(pts, levels, today).map((c) => {
      const accFrom = accuracyOf((pts || {})[c.from], today);
      return Object.assign(c, {
        acc: accuracyOf((pts || {})[c.key], today), score: (0.6 - (accFrom === null ? 0 : accFrom)) * weightOf(c.from),
        wrong7: recentWrong((pts || {})[c.from], today),
      });
    }).sort((a, b) => b.score - a.score || b.wrong7 - a.wrong7);
    const diff = LEVEL_RANK[levels.listening] - LEVEL_RANK[levels.reading];
    const weakTrack = diff < 0 ? 'listening' : diff > 0 ? 'reading' : null;
    let chosen = cands.slice(0, 2);
    if (weakTrack) {
      const first = cands.filter((c) => TRACK_OF(c.key) === weakTrack)[0];
      if (first) chosen = [first].concat(cands.filter((c) => c !== first)).slice(0, 2);
    }
    if (!chosen.length) return [fallbackPlan(opt, seconds)];
    const share = chosen.length === 1 ? [seconds]
      : weakTrack && TRACK_OF(chosen[0].key) === weakTrack && TRACK_OF(chosen[1].key) !== weakTrack
        ? [Math.ceil(seconds * 2 / 3), seconds - Math.ceil(seconds * 2 / 3)] : [Math.ceil(seconds / 2), Math.floor(seconds / 2)];
    return fitBase(chosen.map((c, i) => ({
      key: c.key, part: c.key.charAt(1), track: TRACK_OF(c.key), seconds: share[i], reason: c.reason,
      base: baseModule(c.key, c.acc, levels, opt.doneUnits),
    })), seconds);
  }

  /* 改派的基礎模組要放得進分到的時間(文法單元 480 秒、聽寫 300 秒):整段都放不下就不改派;
     兩個考點的模組加起來放不下,整段只出第一個考點;放得下但分到的不夠,先補足有模組的那個,另一個拿剩下的。合計一定等於段的秒數 */
  function fitBase(plans, seconds) {
    let out = plans.map((p) => Object.assign({}, p, { base: p.base && p.base.seconds <= seconds ? p.base : null }));
    if (out.length === 2) {
      const need = out.map((p) => (p.base ? p.base.seconds : 0));
      if (need[0] + need[1] > seconds) out = [Object.assign({}, out[0], { seconds })];
      else [0, 1].forEach((i) => { if (out[i].seconds < need[i]) { out[1 - i].seconds = seconds - need[i]; out[i].seconds = need[i]; } });
    }
    return out;
  }

  /* ---------- 個人段的難度(弱點補練、考點回顧、測驗檢討) ----------
     補標前用舊的 difficulty 對照學生那一科的級(暫定):入門只出基礎、中級,P3、P4 只出基礎的組;門檻以上三種都可以。
     lastWrong 是這個考點最近答錯那題的難度,有就不高於它。回 { allow: [可以出的難度], up: 題不夠時放寬一級用的難度(不超過那一級可以出的)或 null };
     P6、P7 沒有難度,回 null */
  const DIFFS = ['基礎', '中級', '進階'];
  function personalDiff(level, part, lastWrong) {
    if (!LEVEL_RANK.hasOwnProperty(level)) throw new TypeError('認不得的級：' + level);
    if (!/^[1-5]$/.test(String(part))) return null;
    const base = level === 'entry' ? (/^[34]$/.test(String(part)) ? ['基礎'] : ['基礎', '中級']) : DIFFS.slice();
    const cap = DIFFS.indexOf(lastWrong);
    const allow = cap < 0 ? base : base.filter((d) => DIFFS.indexOf(d) <= cap);
    return { allow, up: base[allow.length] || null };
  }

  function fallbackPlan(opt, seconds) {
    const fb = opt.fallback || {};
    const parts = fb.testParts || {};
    const tested = Object.keys(parts).filter((p) => /^P[1-7]$/.test(p) && parts[p] && parts[p].n > 0);
    if (tested.length) {
      const low = tested.sort((a, b) => rate(parts[a].ok, parts[a].n) - rate(parts[b].ok, parts[b].n) || (a < b ? -1 : 1))[0];
      return { key: null, part: low.charAt(1), track: TRACK_OF(low + '.'), seconds, reason: 'fallback:a', base: null };
    }
    const next = (fb.nextFocus || []).map(legacyKey).filter(Boolean)[0];
    if (next) return { key: next, part: next.charAt(1), track: TRACK_OF(next), seconds, reason: 'fallback:b', base: null };
    return { key: null, part: '5', track: 'reading', seconds, reason: 'fallback:c', base: null };
  }

  /* 一個弱點計畫要幾題(組):秒數 ÷ 練習時間,題組至少 1 組;有改派基礎模組時先扣它的秒數 */
  function weakCount(plan) {
    const left = plan.seconds - (plan.base ? plan.base.seconds : 0);
    const per = PRACTICE_SECONDS[plan.part];
    const n = Math.floor(Math.max(0, left) / per);
    return /^[3467]$/.test(plan.part) ? Math.max(1, n) : n;
  }

  /* ---------- 測驗檢討 test_review_v1 ----------
     parts = { P1: { n, ok }, … P7 }。結果頁 40 秒;聽力、閱讀各取答對率最低的 Part(同率取 Part 號小的),各 1 張技巧卡＋1 個新題區塊 */
  const TIP_OF = { '1': 'tip-P1-photo', '2': 'tip-P2-wh', '3': 'tip-P3-gist', '4': 'tip-P4-gist', '5': 'tip-P5-word_form', '6': 'tip-P6-grammar', '7': 'tip-P7-detail' };
  const REVIEW_BLOCKS = {
    '1': [{ part: '1', count: 6 }], '2': [{ part: '2', count: 7 }], '3': [{ part: '3', count: 1 }, { part: '2', count: 2 }],
    '4': [{ part: '4', count: 1 }, { part: '2', count: 2 }], '5': [{ part: '5', count: 7 }], '6': [{ part: '6', count: 1 }, { part: '5', count: 1 }],
    '7': [{ part: '7', count: 1, size: [2, 3, 4] }],
  };
  function planTestReview(parts) {
    const p = parts || {};
    const low = (list) => list.filter((x) => p['P' + x] && p['P' + x].n > 0)
      .sort((a, b) => rate(p['P' + a].ok, p['P' + a].n) - rate(p['P' + b].ok, p['P' + b].n) || (a < b ? -1 : 1))[0] || null;
    const picks = [low(['1', '2', '3', '4']) || '2', low(['5', '6', '7']) || '5'];
    const out = [{ kind: 'result', seconds: 40 }];
    picks.forEach((part) => {
      out.push({ kind: 'tip', part, id: TIP_OF[part], seconds: 120 });
      REVIEW_BLOCKS[part].forEach((b) => out.push(Object.assign({ kind: 'items', seconds: b.count * PRACTICE_SECONDS[b.part] }, b)));
    });
    return out;
  }

  root.LESSON_RULES = Object.freeze({
    addDays, daysBetween, weekOf, legacyKey, bankWhere, keysOfRow, isGroupKey, statusOf, addHits, mergePts, accuracyOf,
    judgeCheckpoint, unpassedKeys, scheduleWrong, schedulePassed, reviewDone, pickReview, mergeRvq,
    planWeak, weakCount, weightOf, planTestReview, personalDiff, P5_QTYPE, P6_TYPE, PRACTICE_SECONDS, RVQ_MAX, TOMB_DAYS, HITS_MAX,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
