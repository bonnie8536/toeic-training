/* 估分用的資料格式:第一次作答紀錄(fa_v1)、檢測紀錄(placement_v1)、預估快照(est_v1)的編碼與合併,以及從舊資料補回第一次作答。
   純函式:不碰畫面、不讀寫儲存、不用現在時間(now 由呼叫的一方給)。
   載入順序:js/estimate-core.js 之後;載入後 ESTIMATE 換成「核心 + 這支」的凍結物件。
   格式:
     fa_v1        { v: 1, i: { key: [日數, 對錯 1/0 或 null(看過、不計分), 來源] } }
                  來源:t 檢測、k 課程前測、g 舊 28 題、l 聽力一次、p 刷題、r 聽力重播或改速、h 從學習記錄補、c 課程回合(看過)、o 舊紀錄(看過)
     placement_v1 { v: 1, runs: [{ at, end, ip, cv, sec, tm, items: [[科, key, 選項, 對錯, 秒數], …], res }] }(最多 5 次)
     est_v1       { ip, cv, at, L: [預估, 下緣, 上緣, 題數] 或 null, R }
   合併都滿足交換律、結合律、冪等(tools/test_estimate.js 用隨機資料驗)。 */
(function (root) {
  'use strict';

  const CORE = root.ESTIMATE;
  if (!CORE) throw new Error('js/estimate-data.js 要在 js/estimate-core.js 之後載入');
  const SOURCES = CORE.SOURCES;
  const ORIGIN = Date.UTC(2026, 0, 1);
  const DAY_MS = 864e5;
  const RUNS_MAX = 5;
  const HIST_MAX = 1500;
  const HIST_DAYS = 60;
  const HIST_MODS = { p5: '5', p6: '6', p7: '7', l1: '1', l2: '2', l3: '3', l4: '4' };
  const RECORD_KEYS = ['drill_p5', 'drill_p6', 'drill_p7', 'listen_p1', 'listen_p2', 'listen_p3', 'listen_p4'];

  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const fin = (x) => typeof x === 'number' && isFinite(x);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  function need(ok, msg) { if (!ok) throw new TypeError(msg); }

  /* 本地日期的第幾天(2026-01-01 是 0) */
  function dayNum(ms) {
    need(fin(ms), '時間要是毫秒數');
    const d = new Date(ms);
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - ORIGIN) / DAY_MS);
  }

  /* ---------- 第一次作答紀錄 ---------- */
  function faEmpty() { return { v: 1, i: {} }; }
  const okOf = CORE.okOf;
  /* 不合格式的筆數丟掉,其餘照 key 排(每筆的檢查跟估分用的是同一個函式) */
  function faNormalize(fa) {
    const src = isPlain(fa) && isPlain(fa.i) ? fa.i : {};
    const i = {};
    Object.keys(src).sort().forEach((k) => { const e = k ? CORE.faEntry(src[k]) : null; if (e) i[k] = e; });
    return { v: 1, i };
  }
  /* 只在還沒有這一題時寫;回傳新物件,原物件不動 */
  function faAdd(fa, key, day, ok, src) {
    need(typeof key === 'string' && key !== '', '題目 key 要是非空字串');
    need(Number.isInteger(day), '日數要是整數');
    need(okOf(ok) !== undefined, '對錯要是 1、0 或 null');
    need(typeof src === 'string' && src.length === 1 && SOURCES.indexOf(src) > -1, '認不得的來源：' + src);
    need(isPlain(fa) && isPlain(fa.i), '第一次作答紀錄要是 { v, i }');
    if (Object.prototype.hasOwnProperty.call(fa.i, key)) return fa;
    return { v: 1, i: Object.assign({}, fa.i, { [key]: [day, okOf(ok), src] }) };
  }
  /* 同一題兩邊都有:日數小的;同日照來源先後;再同,對錯小的(看過最小) */
  function earlier(a, b) {
    const ok = (x) => (x === null ? -1 : x);
    const d = (a[0] - b[0]) || (SOURCES.indexOf(a[2]) - SOURCES.indexOf(b[2])) || (ok(a[1]) - ok(b[1]));
    return d <= 0 ? a : b;
  }
  function mergeFirstAttempts(a, b) {
    const x = faNormalize(a).i, y = faNormalize(b).i, i = {};
    Object.keys(Object.assign({}, x, y)).sort().forEach((k) => {
      i[k] = x[k] && y[k] ? earlier(x[k], y[k]).slice() : (x[k] || y[k]).slice();
    });
    return { v: 1, i };
  }

  /* ---------- 檢測紀錄 ---------- */
  const SEC_RANK = { L: 0, R: 1 };
  function validItem(it) { return Array.isArray(it) && it.length >= 2 && typeof it[1] === 'string' && it[1] !== ''; }
  /* 同一題兩份不同時取字串比較大的那份,只為了結果固定 */
  function itemsUnion(lists) {
    const by = {};
    lists.forEach((list) => (Array.isArray(list) ? list : []).filter(validItem).forEach((it) => {
      const k = String(it[0]) + '|' + it[1];
      if (!by[k] || JSON.stringify(it) > JSON.stringify(by[k])) by[k] = it.slice();
    }));
    return Object.keys(by).map((k) => by[k])
      .sort((p, q) => ((SEC_RANK[p[0]] === undefined ? 2 : SEC_RANK[p[0]]) - (SEC_RANK[q[0]] === undefined ? 2 : SEC_RANK[q[0]])) || cmp(p[1], q[1]));
  }
  function headOf(r) {
    return { at: r.at, end: typeof r.end === 'string' ? r.end : null, ip: r.ip, cv: r.cv, sec: r.sec };
  }
  /* 兩份同一次檢測的其他欄位:有結束時間的優先,再比結束時間,再比整份字串 */
  function betterHead(a, b) {
    if (!!a.end !== !!b.end) return a.end ? a : b;
    if (a.end !== b.end) return a.end > b.end ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }
  /* 每科的開始與結束時間分開併:開始取早的,結束取有值的(都有取晚的);一科做完的時間不會被另一份沒做完的蓋掉 */
  const isTime = (x) => typeof x === 'string' && x !== '';
  function pickTime(a, b, later) {
    if (!isTime(a)) return isTime(b) ? b : null;
    if (!isTime(b)) return a;
    return (later ? a > b : a < b) ? a : b;
  }
  function mergeTm(a, b) {
    const out = {};
    ['L', 'R'].forEach((sec) => {
      const x = isPlain(a) && Array.isArray(a[sec]) ? a[sec] : null, y = isPlain(b) && Array.isArray(b[sec]) ? b[sec] : null;
      if (!x && !y) return;
      out[sec] = [pickTime(x && x[0], y && y[0], false), pickTime(x && x[1], y && y[1], true)];
    });
    return out;
  }
  /* 每科的結果分開併:兩份都有時取字串比較大的那份,只為了結果固定 */
  function mergeRes(a, b) {
    const out = {};
    ['L', 'R'].forEach((sec) => {
      const x = isPlain(a) && Array.isArray(a[sec]) ? a[sec] : null, y = isPlain(b) && Array.isArray(b[sec]) ? b[sec] : null;
      if (x || y) out[sec] = (!y || (x && JSON.stringify(x) >= JSON.stringify(y)) ? x : y).slice();
    });
    return out;
  }
  function runsOf(p) {
    const runs = isPlain(p) && Array.isArray(p.runs) ? p.runs : [];
    return runs.filter((r) => isPlain(r) && typeof r.at === 'string' && r.at !== '');
  }
  function mergePlacementRuns(a, b) {
    const by = {};
    runsOf(a).concat(runsOf(b)).forEach((r) => {
      const prev = by[r.at];
      by[r.at] = prev
        ? { head: betterHead(prev.head, headOf(r)), tm: mergeTm(prev.tm, r.tm), res: mergeRes(prev.res, r.res), items: itemsUnion([prev.items, r.items]) }
        : { head: headOf(r), tm: mergeTm(r.tm, null), res: mergeRes(r.res, null), items: itemsUnion([r.items]) };
    });
    const ats = Object.keys(by).sort().slice(-RUNS_MAX);
    return { v: 1, runs: ats.map((at) => JSON.parse(JSON.stringify(Object.assign({}, by[at].head, { tm: by[at].tm, items: by[at].items, res: by[at].res })))) };
  }

  /* 一次檢測裡某一科的作答,寫成來源 t 的第一次作答紀錄(沒作答的不寫);存這次結果時只用它加先驗估 */
  function runFa(r, sec, day) {
    need(isPlain(r) && Array.isArray(r.items), '檢測紀錄要有 items');
    need(sec === 'L' || sec === 'R', '科要是 L 或 R:' + sec);
    need(Number.isInteger(day), '日數要是整數');
    return r.items.filter(validItem).reduce((fa, it) => (it[0] === sec && (it[3] === 0 || it[3] === 1) ? faAdd(fa, it[1], day, it[3], 't') : fa), faEmpty());
  }

  /* ---------- 預估快照:時間新的整份贏 ---------- */
  function mergeEst(a, b) {
    const ok = (x) => isPlain(x) && typeof x.at === 'string';
    if (!ok(a)) return ok(b) ? b : null;
    if (!ok(b)) return a;
    if (a.at !== b.at) return a.at > b.at ? a : b;
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  /* ---------- 舊資料補回 ---------- */
  /* 舊 28 題卷的小題,順序 P5、P6、P7(同舊檢測頁) */
  function legacyItems(D) {
    need(isPlain(D) && Array.isArray(D.p5) && isPlain(D.p6) && isPlain(D.p7), '舊檢測題目格式不對');
    const groupKeys = (p, g) => (g.questions || []).map((q, qi) => ({ key: CORE.keyOf(p, g.id, q, qi), answer: q.answer, part: p }));
    return D.p5.map((q) => ({ key: CORE.keyOf('5', q.id, q, 0), answer: q.answer, part: '5' }))
      .concat(groupKeys('6', D.p6), groupKeys('7', D.p7));
  }
  function fromDiag(diag, legacy) {
    if (!isPlain(diag) || diag.done !== true) return [];
    need(legacy, '補回舊檢測要給舊檢測題目');
    const t = Date.parse(diag.finishedAt || diag.startedAt);
    if (!fin(t)) return [];
    const ans = isPlain(diag.answers) ? diag.answers : {};
    return legacyItems(legacy).reduce((rows, it, i) => {
      const a = ans[i];
      return a === undefined || a === null ? rows : rows.concat([{ key: it.key, day: dayNum(t), ok: a === it.answer ? 1 : 0, src: 'g' }]);
    }, []);
  }
  function recordRows(records) {
    const rows = [];
    if (!isPlain(records)) return rows;
    RECORD_KEYS.forEach((name) => {
      const st = records[name];
      if (!isPlain(st)) return;
      Object.keys(st).forEach((key) => { if (isPlain(st[key]) && fin(Number(st[key].t))) rows.push({ key, t: Number(st[key].t) }); });
    });
    return rows;
  }
  /* 學習記錄只留 60 天、最多 1500 筆:最舊一筆距今 <60 天、筆數 <1500,而且作答紀錄沒有比最舊一筆還早的,才算沒被截斷 */
  function histCut(hist, recs, now) {
    const ts = hist.map((h) => Number(h && h.t)).filter(fin);
    if (!ts.length) return false;
    const oldest = Math.min.apply(null, ts);
    return hist.length >= HIST_MAX || now - oldest >= HIST_DAYS * DAY_MS || recs.some((r) => r.t < oldest);
  }
  function histSource(h) {
    if (HIST_MODS[h.m] > '4' || (h.pl === undefined && h.sp === undefined)) return 'h';
    const pl = h.pl === undefined ? 1 : Number(h.pl), sp = h.sp === undefined ? 1 : Number(h.sp);
    return pl <= 1 && sp === 1 ? 'l' : 'r';
  }
  function fromHist(hist, recs, now) {
    const list = hist.filter((h) => isPlain(h) && HIST_MODS[h.m] && typeof h.id === 'string' && fin(Number(h.t)));
    const cut = histCut(hist, recs, now);
    const first = {};
    list.forEach((h) => { if (!first[h.id] || Number(h.t) < Number(first[h.id].t)) first[h.id] = h; });
    const rows = Object.keys(first).sort().map((id) => {
      const h = first[id], day = dayNum(Number(h.t));
      return cut ? { key: id, day, ok: null, src: 'o' } : { key: id, day, ok: h.ok ? 1 : 0, src: histSource(h) };
    });
    return { rows, cut, ids: new Set(list.map((h) => h.id)) };
  }
  function addRows(fa, rows, stats) {
    return rows.reduce((acc, r) => {
      const next = faAdd(acc, r.key, r.day, r.ok, r.src);
      if (next !== acc && stats) stats[r.src] = (stats[r.src] || 0) + 1;
      return next;
    }, fa);
  }
  /* src = { diag, legacy(舊檢測題目), rows(課程前測等逐題 { key, day, ok, src },沒作答的 ok 給 null 就不寫), hist, records({ drill_p5: …, listen_p1: … }), now }
     只補還沒有的 key;回傳 { fa, stats } */
  /* 舊 28 題、課程前測、學習記錄三種逐題的列先照日數排,同一天照來源先後、再照 key,才寫進去:
     同一題先在刷題做過、後來又出現在前測,留的是較早的那次 */
  const byTime = (p, q) => (p.day - q.day) || (SOURCES.indexOf(p.src) - SOURCES.indexOf(q.src)) || cmp(p.key, q.key);
  function backfillRun(fa, src) {
    const s = isPlain(src) ? src : {};
    need(fin(s.now), '補回要給現在時間（毫秒）');
    need(s.hist === undefined || Array.isArray(s.hist), '學習記錄要是陣列');
    const stats = { g: 0, k: 0, h: 0, l: 0, r: 0, o: 0, cut: false };
    const rows = (Array.isArray(s.rows) ? s.rows : []).filter((r) => isPlain(r) && Number.isInteger(r.day) && (r.ok === 0 || r.ok === 1 || r.ok === true || r.ok === false));
    const recs = recordRows(s.records);
    const h = fromHist(s.hist || [], recs, s.now);
    stats.cut = h.cut;
    const dated = fromDiag(s.diag, s.legacy).concat(rows, h.rows).sort(byTime);
    let out = addRows(faNormalize(fa), dated, stats);
    const seen = recs.filter((r) => !h.ids.has(r.key)).sort((a, b) => cmp(a.key, b.key)).map((r) => ({ key: r.key, day: dayNum(r.t), ok: null, src: 'o' }));
    out = addRows(out, seen, stats);
    return { fa: out, stats };
  }
  function backfill(fa, src) { return backfillRun(fa, src).fa; }
  function backfillStats(fa, src) { return backfillRun(fa, src).stats; }

  root.ESTIMATE = Object.freeze(Object.assign({}, CORE, {
    dayNum, faEmpty, faNormalize, faAdd, mergeFirstAttempts, mergePlacementRuns, mergeEst, runFa,
    legacyItems, backfill, backfillStats,
  }));
})(typeof globalThis !== 'undefined' ? globalThis : this);
