/* 課程進度多台裝置的合併規則:les_t<期>_<堂>、pts、rvq、tests_v1、mock_seen(模擬考作答過的題)、plan(課表設定)。純計算,不讀寫儲存。
   從 js/sync-merge.js 分出來的(兩個檔合在一起超過 800 行);載入時把 lesson、pts、rvq、tests、mockSeen、plan 加進 window.SYNC_MERGE
   (換成一份新的凍結物件,原有的函式還是同一個,對外的名稱與行為跟以前在 js/sync-merge.js 裡一樣)。
   每一頁都緊接在 js/sync-merge.js 後面、js/cloud.js 之前載入(tools/test_sync_union.js 檢查)。js/sync-merge.js 沒載到就什麼都不做:
   js/cloud.js 拿不到這幾個合併函式,跟舊快取一樣不上傳、帳本留著。合併函式的約定跟 js/sync-merge.js 一樣。
   搬家寄出頁 move-out.html 不載這個檔:它在舊網址,舊網址的 Worker 轉址期只代理固定的檔案清單(tools/move-worker/worker.js 的 KEEP_ASSETS)。
   那一頁的課程進度照上面的規則不上傳、放進搬家包,到新網址登入時再合併(搬家暫存區要用時也會補載這個檔)。 */
(function (root) {
  'use strict';
  const base = root.SYNC_MERGE;
  if (!base || typeof base.canon !== 'function') return;
  /* 跟 js/sync-merge.js 同一組小工具(canon 直接用它的) */
  const isArr = Array.isArray, keysOf = Object.keys, canon = base.canon;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isPlain = x => !!x && typeof x === 'object' && !isArr(x);
  const isNum = x => typeof x === 'number' && isFinite(x);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  /* ---------- 課程(js/pack-core.js、js/lesson-rules.js 寫):les_t<期>_<堂>、pts、rvq、tests_v1 ----------
     形狀見那兩個檔的檔頭。都是一份是 null 就用另一份;形狀不對的那份當成沒有,兩份都不對回 ok:false;lesson 的 v 不是 1 回 ok:false。
     · lesson(一堂的進度):開始時間早的那份為主。兩份的 levels、lessonId、packVersion 一樣時:段以交卷或略過優先(都交卷取早的);
       凍結選題取凍結得早的,個人段(回顧 80–84、弱點補練 85–89、測驗檢討 90–97,跟 js/pack-core.js 的 RESERVED 一樣)整段取同一份,
       不把兩台照不同計畫選的區塊拼在一起;作答以(區塊、題、小題)聯集,同一題取作答時間早的;所有段都交卷或略過而 doneAt 是空的,
       補成各段交卷時間最晚的那個。不一樣(兩台用不同的級開同一堂):只留主要那份,另一份只併入題目對得上主要那份凍結選題的作答,
       其他的丟掉(dropped 是丟掉幾筆)。
     · pts(考點狀態):hits 以批次編號 b 聯集(同一批取題數多的),pauseUntil 取晚的(批數上限跟 js/lesson-rules.js 的 HITS_MAX 一樣);s 是寫入時算的快取:合併後跟其中一份一樣就用那份的,
       不然用最近作答日期晚的那份的(課程頁讀的時候一律重算,js/lesson-rules.js mergePts)。每個考點最多 PTS_HITS_MAX 批(留新的)。
     · rvq(回顧佇列):同一項取新的:d0(答錯或過關那天)晚的、一樣時 step 大的;帶 x 的是做完移出的刪除紀錄,一樣新時刪除紀錄贏。
       佇列裡的項目最多 300 筆(留 d0 新的),刪除紀錄最多 600 筆;刪除紀錄保留幾天由 js/lesson-rules.js 整理(這裡不看日期)。
     · tests(tests_v1):同一期同一次測驗取 at 早的(第一次交卷)。 */
  const COURSE_GROUPS = [[80, 85], [85, 90], [90, 98]], PTS_HITS_MAX = 400, RVQ_LIVE_MAX = 300, RVQ_GONE_MAX = 600, LES_DT = 5;
  const setCanon = arr => canon(arr.map(canon).sort());
  function course(fn, shape, eq, versioned) {
    const same = eq || ((x, y) => canon(x) === canon(y));
    return function (a, b) {
      const none = x => x === null || x === undefined;
      if (versioned && [a, b].some(x => isPlain(x) && own(x, 'v') && x.v !== 1)) return { ok: false };
      if (none(a) && none(b)) return { ok: true, v: null, sameAsLocal: a === null, sameAsCloud: b === null };
      const ga = !none(a) && shape(a), gb = !none(b) && shape(b);
      if (!ga && !gb) return { ok: false };
      const r = ga && gb ? fn(a, b) : { v: ga ? a : b };
      const sameAsLocal = ga && same(r.v, a), sameAsCloud = gb && same(r.v, b);
      const out = { ok: true, v: sameAsLocal ? a : sameAsCloud ? b : r.v, sameAsLocal, sameAsCloud };
      if (r.dropped) out.dropped = r.dropped;
      return out;
    };
  }
  const intOr = (x, d) => (Number.isInteger(x) ? x : d);
  const SEG_RANK = { todo: 0, doing: 1, skip: 2, done: 3 };
  function joinSeg(x, y) {
    if (!isPlain(x) || !isPlain(y)) return isPlain(x) ? x : y;
    const t0 = [x.t0, y.t0].filter(Number.isInteger).sort((p, q) => p - q)[0];
    const rx = SEG_RANK[x.st] || 0, ry = SEG_RANK[y.st] || 0;
    const win = ry > rx || (ry === rx && Number.isInteger(y.t1) && (!Number.isInteger(x.t1) || y.t1 < x.t1)) ? y : x;
    return { st: win.st, t0: t0 === undefined ? null : t0, t1: intOr(win.t1, null) };
  }
  const lessonShape = s => isPlain(s) && Number.isInteger(s.startedAt) && isPlain(s.seg) && isArr(s.a);
  const rowKey = x => x[0] + '|' + x[1] + '|' + x[2];
  /* 凍結選題:一般區塊各自取凍結早的;個人段一整段取最早凍結的那一份 */
  function joinPk(list) {
    const pk = {}, at = {}, pkOf = s => (isPlain(s.pk) ? s.pk : {});
    const group = k => COURSE_GROUPS.findIndex(g => k >= g[0] && k < g[1]);
    const absOf = (s, e) => s.startedAt + (isNum(e.at) ? e.at : 0);
    const sig = (s, e) => canon(Object.assign({}, e, { at: absOf(s, e) }));   // 比較用:時間換成絕對時間,合併前後一樣
    /* 每一份的每個個人段:最早凍結的時間與整段的內容,先凍結的那份贏(一樣早比內容) */
    const best = {};
    list.forEach((s, i) => {
      const by = {};
      keysOf(pkOf(s)).sort().forEach(k => {
        const e = pkOf(s)[k], g = group(Number(k));
        if (!isPlain(e) || g < 0) return;
        const o = by[g] || (by[g] = { abs: Infinity, sig: '' });
        o.abs = Math.min(o.abs, absOf(s, e));
        o.sig += k + '=' + sig(s, e) + ';';
      });
      keysOf(by).forEach(g => { const o = by[g]; if (!best[g] || o.abs < best[g].abs || (o.abs === best[g].abs && o.sig < best[g].sig)) best[g] = Object.assign({ i }, o); });
    });
    list.forEach((s, i) => keysOf(pkOf(s)).forEach(k => {
      const e = pkOf(s)[k], g = group(Number(k));
      if (!isPlain(e) || (g >= 0 && best[g].i !== i)) return;
      const abs = absOf(s, e);
      if (!pk[k] || abs < at[k] || (abs === at[k] && sig(s, e) < canon(Object.assign({}, pk[k], { at: at[k] })))) { pk[k] = e; at[k] = abs; }
    }));
    return { pk, at };
  }
  function lesson2(a, b) {
    const id = s => canon([s.levels, s.lessonId, s.packVersion]);
    const rest = s => { const o = Object.assign({}, s); ['seg', 'pk', 'a', 'doneAt'].forEach(k => delete o[k]); return canon(o); };
    const aFirst = a.startedAt !== b.startedAt ? a.startedAt < b.startedAt : id(a) !== id(b) ? id(a) < id(b) : rest(a) <= rest(b);
    const [p, q] = aFirst ? [a, b] : [b, a];
    const start = p.startedAt;
    const same = id(p) === id(q);
    const j = joinPk(same ? [p, q] : [p]), pk = {};
    keysOf(j.pk).forEach(k => { pk[k] = Object.assign({}, j.pk[k], { at: j.at[k] - start }); });
    const fits = x => same || (isPlain(pk[x[0]]) && isArr(pk[x[0]].ids) && pk[x[0]].ids.indexOf(x[1]) > -1);
    const rows = new Map();
    let dropped = 0;
    [p, q].forEach(s => s.a.forEach(x => {
      if (!isArr(x) || !Number.isInteger(x[0]) || typeof x[1] !== 'string' || !Number.isInteger(x[LES_DT])) return;
      if (s === q && !fits(x)) { dropped++; return; }
      const abs = s.startedAt + x[LES_DT], o = rows.get(rowKey(x));
      if (!o || abs < o.abs || (abs === o.abs && canon(x.slice(0, LES_DT)) < canon(o.x.slice(0, LES_DT)))) rows.set(rowKey(x), { abs, x });
    }));
    const list = Array.from(rows.values()).sort((m, n) => m.abs - n.abs || cmp(rowKey(m.x), rowKey(n.x)));
    const seg = {};
    if (same) new Set(keysOf(p.seg).concat(keysOf(q.seg))).forEach(k => { seg[k] = joinSeg(p.seg[k], q.seg[k]); });
    else keysOf(p.seg).forEach(k => { seg[k] = p.seg[k]; });
    const segs = keysOf(seg).map(k => seg[k]);
    const dones = (same ? [p.doneAt, q.doneAt] : [p.doneAt]).filter(Number.isInteger).sort((m, n) => m - n);
    const all = segs.length > 0 && segs.every(x => isPlain(x) && (x.st === 'done' || x.st === 'skip'));
    const doneAt = dones.length ? dones[0] : all ? Math.max.apply(null, segs.map(x => intOr(x.t1, start))) : null;
    const v = Object.assign({}, p, { v: 1, startedAt: start, doneAt, seg, pk, a: list.map(r => r.x.slice(0, LES_DT).concat([r.abs - start])) });
    return { v, dropped };
  }
  const hitOk = h => isPlain(h) && typeof h.b === 'string' && typeof h.d === 'string' && isNum(h.n) && isNum(h.ok);
  const hitsOf = e => (isArr(e.hits) ? e.hits.filter(hitOk) : []);
  const lastDay = e => hitsOf(e).reduce((m, h) => (h.d > m ? h.d : m), '');
  function pts2(A, B) {
    const out = {};
    new Set(keysOf(A).concat(keysOf(B))).forEach(k => {
      const x = isPlain(A[k]) ? A[k] : null, y = isPlain(B[k]) ? B[k] : null;
      if (!x || !y) { if (x || y) out[k] = x || y; return; }
      const by = new Map();
      hitsOf(x).concat(hitsOf(y)).forEach(h => {
        const o = by.get(h.b);
        if (!o || h.n > o.n || (h.n === o.n && canon(h) < canon(o))) by.set(h.b, h);
      });
      const hits = Array.from(by.values()).sort((m, n) => cmp(m.d, n.d) || cmp(m.b, n.b)).slice(-PTS_HITS_MAX);
      const pu = [x.pauseUntil, y.pauseUntil].filter(s => typeof s === 'string').sort().pop() || null;
      const like = [x, y].filter(e => setCanon(hitsOf(e)) === setCanon(hits) && (e.pauseUntil || null) === pu).sort((m, n) => cmp(canon(m), canon(n)))[0];
      const sOf = (lastDay(x) !== lastDay(y) ? (lastDay(x) > lastDay(y) ? x : y) : canon(x.s) <= canon(y.s) ? x : y).s;
      out[k] = like || { s: sOf, hits, pauseUntil: pu };
    });
    return { v: out };
  }
  const rvqOk = e => isPlain(e) && typeof e.d0 === 'string' && (typeof e.k === 'string' || (typeof e.m === 'string' && typeof e.id === 'string'));
  const rvqId = e => (typeof e.k === 'string' ? 'k|' + e.k : 'i|' + e.m + '|' + e.id + '|' + (e.sub === undefined || e.sub === null ? '' : e.sub));
  function rvqNewer(x, y) {
    const sx = isNum(x.step) ? x.step : 0, sy = isNum(y.step) ? y.step : 0;
    if (x.d0 !== y.d0) return x.d0 > y.d0 ? x : y;
    if (sx !== sy) return sx > sy ? x : y;
    if (!!x.x !== !!y.x) return x.x ? x : y;
    return canon(x) <= canon(y) ? x : y;
  }
  function rvq2(A, B) {
    const by = new Map();
    A.concat(B).forEach(e => { if (rvqOk(e)) by.set(rvqId(e), by.has(rvqId(e)) ? rvqNewer(by.get(rvqId(e)), e) : e); });
    const all = Array.from(by.values()), order = (f) => (m, n) => cmp(f(n), f(m)) || cmp(rvqId(m), rvqId(n));
    const live = all.filter(e => !e.x).sort(order(e => e.d0)).slice(0, RVQ_LIVE_MAX);
    const gone = all.filter(e => e.x).sort(order(e => String(e.x))).slice(0, RVQ_GONE_MAX);
    return { v: live.concat(gone) };
  }
  function tests2(A, B) {
    const out = {}, atOf = r => (isNum(r.at) ? r.at : Infinity);
    new Set(keysOf(A).concat(keysOf(B))).forEach(t => {
      const x = isPlain(A[t]) ? A[t] : {}, y = isPlain(B[t]) ? B[t] : {}, o = {};
      new Set(keysOf(x).concat(keysOf(y))).forEach(k => {
        const p = x[k], q = y[k];
        const w = !isPlain(q) ? p : !isPlain(p) ? q : atOf(q) < atOf(p) || (atOf(q) === atOf(p) && canon(q) < canon(p)) ? q : p;
        if (w !== undefined) o[k] = w;
      });
      out[t] = o;
    });
    return { v: out };
  }
  /* ---------- 模擬考作答過的題(mock_seen,js/mock.js 交卷時寫)與課表設定(plan,js/lesson-data.js 寫) ----------
     · mockSeen:{ 題目 key: 交卷時間(毫秒) }。聯集;同一個 key 取大的;不是有限數字的值輸給是的(都不是取 canon 小的);
       超過 MOCK_SEEN_MAX 筆留時間新的(一樣時照 key 字典序);輸出 key 照字典序。兩份有一份不是一般物件(也不是 null)回 ok:false。
     · plan:兩份都要是一般物件、v 是 1(不然 ok:false)。updatedAt(毫秒)大的那份當主要,超過 now 一天以後的當成沒有時間,
       一樣時取 canon 小的;主要那份的欄位照抄,例外三個:startDate 取兩份裡較早的合法日期(課表不會因為合併往後移);
       perWeek 兩份照週(w)聯集,同一週取主要那份的 n,照 w 排序;weeklyAskedAt 取兩份裡較早的非空值。
       lessonsPerWeek 跟著合併後最後一筆 perWeek。兩份都沒有 perWeek、weeklyAskedAt 欄位(舊的 plan)時不加這兩個欄位。 */
  const MOCK_SEEN_MAX = 3000, PLAN_FUTURE_MS = 864e5;
  function sameFlags(v, a, b) {
    const s = canon(v), sameAsLocal = isPlain(a) && s === canon(a), sameAsCloud = isPlain(b) && s === canon(b);
    return { ok: true, v: sameAsLocal ? a : sameAsCloud ? b : v, sameAsLocal, sameAsCloud };
  }
  function seenWin(x, y) {
    if (isNum(x) !== isNum(y)) return isNum(x) ? x : y;
    if (isNum(x)) return Math.max(x, y);
    return canon(x) <= canon(y) ? x : y;
  }
  function mockSeen(a, b) {
    const okShape = x => x === null || x === undefined || isPlain(x);
    if (!okShape(a) || !okShape(b)) return { ok: false };
    if (!isPlain(a) && !isPlain(b)) return { ok: true, v: null, sameAsLocal: a === null, sameAsCloud: b === null };
    const out = new Map();
    [a || {}, b || {}].forEach(o => keysOf(o).forEach(k => out.set(k, out.has(k) ? seenWin(out.get(k), o[k]) : o[k])));
    let ks = Array.from(out.keys());
    if (ks.length > MOCK_SEEN_MAX) {
      const tOf = k => (isNum(out.get(k)) ? out.get(k) : -Infinity);
      ks = ks.sort((x, y) => tOf(y) - tOf(x) || cmp(x, y)).slice(0, MOCK_SEEN_MAX);
    }
    const v = {};
    ks.sort(cmp).forEach(k => { v[k] = out.get(k); });
    return sameFlags(v, a, b);
  }
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const weekRows = p => (isArr(p.perWeek) ? p.perWeek.filter(e => isPlain(e) && Number.isInteger(e.w) && e.w >= 1 && e.w <= 12 && (e.n === 1 || e.n === 2)) : []);
  function planMain(a, b, lim) {
    const tOf = p => (isNum(p.updatedAt) && p.updatedAt <= lim ? p.updatedAt : NaN);
    const ta = tOf(a), tb = tOf(b);
    if (isFinite(ta) !== isFinite(tb)) return isFinite(ta) ? [a, b] : [b, a];
    if (isFinite(ta) && ta !== tb) return ta > tb ? [a, b] : [b, a];
    return canon(a) <= canon(b) ? [a, b] : [b, a];
  }
  function plan2(a, b, lim) {
    const [m, o] = planMain(a, b, lim), v = Object.assign({}, m);
    const days = [m.startDate, o.startDate].filter(d => typeof d === 'string' && DATE_RE.test(d)).sort();
    if (days.length) v.startDate = days[0];
    if (isArr(m.perWeek) || isArr(o.perWeek)) {
      const by = new Map();
      weekRows(o).concat(weekRows(m)).forEach(e => by.set(e.w, { w: e.w, n: e.n }));
      v.perWeek = Array.from(by.values()).sort((x, y) => x.w - y.w);
      if (v.perWeek.length) v.lessonsPerWeek = v.perWeek[v.perWeek.length - 1].n;
    }
    if (own(m, 'weeklyAskedAt') || own(o, 'weeklyAskedAt')) {
      const asked = [m.weeklyAskedAt, o.weeklyAskedAt].filter(s => typeof s === 'string' && isFinite(Date.parse(s))).sort((x, y) => Date.parse(x) - Date.parse(y) || cmp(x, y));
      v.weeklyAskedAt = asked.length ? asked[0] : null;
    }
    return v;
  }
  function plan(a, b, now) {
    const none = x => x === null || x === undefined;
    if ([a, b].some(x => !none(x) && (!isPlain(x) || x.v !== 1))) return { ok: false };
    if (none(a) && none(b)) return { ok: true, v: null, sameAsLocal: a === null, sameAsCloud: b === null };
    if (none(a) || none(b)) return sameFlags(none(a) ? b : a, a, b);
    return sameFlags(plan2(a, b, (isNum(now) ? now : Date.now()) + PLAN_FUTURE_MS), a, b);
  }

  const lesson = course(lesson2, lessonShape, null, true);
  const pts = course(pts2, isPlain);
  const rvq = course(rvq2, isArr, (x, y) => setCanon(x) === setCanon(y));
  const tests = course(tests2, isPlain);

  root.SYNC_MERGE = Object.freeze(Object.assign({}, base, { lesson, pts, rvq, tests, mockSeen, plan }));
})(typeof window !== 'undefined' ? window : globalThis);
