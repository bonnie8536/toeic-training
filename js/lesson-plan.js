/* 課表設定(plan)與第 4 堂後的程度調整:純計算,不讀寫儲存、不碰畫面;讀寫在 js/lesson-data.js。對外是 window.LESSON_PLAN。
   載入時不依賴其他檔;soloCheckpoint 在函式裡才用 PACK_CORE(拼課表、建議日期、固定段交卷)。
   - 課程週:第 w 週是 plan.startDate ＋ 7(w−1) 天到 ＋7w−1 天(跟建議日期同一套)。日期是這台的當地日期 'YYYY-MM-DD'。
   - 每週堂數 plan.perWeek = [{ w, n }](照 w 排):第 x 週的值是最後一筆 w ≤ x 的 n,沒有是 2。第一次選當週生效、之後改下週生效,
     第 12 週之後不能改。plan.weeklyAskedAt:第一次問過(選了或按之後再選)的時間;沒有欄位或 null 都算還沒問過(舊的 plan 沒有這兩個欄位)。
   - 每週 1 堂:那一週的第 2 堂(偶數堂)是課後練習,可以不做、不擋下一堂(PACK_CORE.unlockState 的 optional)。
   - 程度調整:本期第 2–4 堂固定段(含小檢核)與前測檢討的題庫題、第一次作答,一科 ≥20 題才判,>80% 升一級、<45% 降一級;
     寫在 levels(起始程度),history 記一筆 reason 'calibrate'(沒變也記,用來判斷這一期做過了)。 */
(function (root) {
  'use strict';
  const LEVELS = ['entry', 'threshold', 'advanced', 'high'];
  const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const WEEKS = 12, MIN_N = 20, UP = 0.8, DOWN = 0.45;
  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const pad = (n) => (n < 10 ? '0' : '') + n;

  /* ---------- 日期 ---------- */
  function dayNum(d) {
    const m = DATE.exec(String(d || ''));
    return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 864e5) : NaN;
  }
  /* 毫秒 → 這台的當地日期 */
  function localDay(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  /* 開始日的當地 00:00(毫秒) */
  function startMs(startDate) {
    const m = DATE.exec(String(startDate || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN;
  }
  /* 今天是第幾週(開始日之前算第 1 週);沒有 plan 或開始日回 null */
  function courseWeek(plan, today) {
    const s = isPlain(plan) ? dayNum(plan.startDate) : NaN, t = dayNum(today);
    if (!Number.isFinite(s) || !Number.isFinite(t)) return null;
    return Math.max(1, Math.floor((t - s) / 7) + 1);
  }

  /* ---------- 每週堂數 ---------- */
  const rowsOf = (plan) => (isPlain(plan) && Array.isArray(plan.perWeek) ? plan.perWeek.filter((e) => isPlain(e) && Number.isInteger(e.w) && (e.n === 1 || e.n === 2)) : []);
  function perWeekOf(plan, w) {
    const hit = rowsOf(plan).filter((e) => e.w <= w).sort((a, b) => a.w - b.w).pop();
    return hit ? hit.n : 2;
  }
  /* 選每週 n 堂(新的 plan):還沒選過當週生效、選過下週生效(同一週換掉);第 12 週之後不能改(回原本的) */
  function withWeekly(plan, n, today, nowMs) {
    if (n !== 1 && n !== 2) throw new TypeError('每週堂數要是 1 或 2');
    if (!isPlain(plan)) throw new TypeError('沒有 plan');
    const cur = courseWeek(plan, today) || 1, rows = rowsOf(plan);
    const w = rows.length ? cur + 1 : cur;
    if (w > WEEKS) return plan;
    const perWeek = rows.filter((e) => e.w !== w).concat([{ w, n }]).map((e) => ({ w: e.w, n: e.n })).sort((a, b) => a.w - b.w);
    return Object.assign({}, plan, {
      perWeek, lessonsPerWeek: perWeek[perWeek.length - 1].n, weeklyAskedAt: plan.weeklyAskedAt || new Date(nowMs).toISOString(),
      updatedAt: Math.max(nowMs, (Number(plan.updatedAt) || 0) + 1),
    });
  }
  /* 第 no 堂是不是課後練習(偶數堂、那一週每週 1 堂) */
  function optionalOf(plan) {
    return (no) => no % 2 === 0 && perWeekOf(plan, no / 2) === 1;
  }
  function requiredCount(plan) {
    const opt = optionalOf(plan);
    let n = 0;
    for (let no = 1; no <= 24; no++) if (!opt(no)) n++;
    return n;
  }

  /* ---------- 本週一列 ---------- */
  /* 一堂進度裡的作答與交卷時間(毫秒) */
  function lessonTimes(s) {
    if (!isPlain(s) || !Number.isInteger(s.startedAt)) return [];
    const rows = Array.isArray(s.a) ? s.a.filter((x) => Array.isArray(x) && Number.isFinite(x[5])).map((x) => (s.startedAt + x[5]) * 1000) : [];
    const segs = isPlain(s.seg) ? Object.keys(s.seg).map((k) => s.seg[k]).filter((x) => isPlain(x) && Number.isInteger(x.t1)).map((x) => x.t1 * 1000) : [];
    return rows.concat(segs);
  }
  /* { w, done, want, days, wantDays }:本週要上幾堂、上完幾堂必上的、有作答的日數與目標日數(第 1、7、12 週少 1 天);第 12 週以後或沒有 plan 回 null */
  function weekGoal(opt) {
    const o = opt || {}, w = courseWeek(o.plan, o.today);
    if (!w || w > WEEKS) return null;
    const want = perWeekOf(o.plan, w), opt2 = optionalOf(o.plan), states = o.states || {};
    const done = [2 * w - 1, 2 * w].filter((no) => !opt2(no) && isPlain(states[no]) && states[no].doneAt).length;
    const from = dayNum(o.plan.startDate) + 7 * (w - 1);
    const ms = [].concat(...Object.keys(states).map((k) => lessonTimes(states[k])),
      (Array.isArray(o.hist) ? o.hist : []).map((h) => Number(h && h.t)), (Array.isArray(o.mockHistory) ? o.mockHistory : []).map((r) => Date.parse(r && r.d)));
    const days = new Set(ms.filter(Number.isFinite).map(localDay).filter((d) => dayNum(d) >= from && dayNum(d) < from + 7));
    return { w, done, want, days: days.size, wantDays: (want === 2 ? 3 : 2) - ([1, 7, 12].indexOf(w) > -1 ? 1 : 0) };
  }

  /* ---------- 獨立小檢核 ---------- */
  function pack() {
    const P = root.PACK_CORE;
    if (!P) throw new Error('要先載入 js/pack-core.js');
    return P;
  }
  /* 有進度的堂照它自己的級別拼,拼不出來用目前的 */
  function lessonFor(packs, levels, states, no) {
    const s = states && states[no];
    if (isPlain(s) && isPlain(s.levels)) { try { return pack().compose(packs, s.levels, no); } catch (e) { /* 用目前的級別 */ } }
    return pack().compose(packs, levels, no);
  }
  const cpSeg = (l) => l.segments.filter((s) => s.slot === 'checkpoint')[0] || null;
  function soloOk(o, no, opt, rows) {
    const P = pack(), states = o.states || {}, l = lessonFor(o.packs, o.levels, states, no), cp = cpSeg(l);
    if (!cp || !opt(no) || no > l.liveThrough || no >= 24) return null;
    const s = states[no], seg = isPlain(s) && isPlain(s.seg) ? s.seg.checkpoint : null;
    if (seg && seg.st === 'done') return null;
    if (!P.fixedDone(lessonFor(o.packs, o.levels, states, no - 1), states[no - 1])) return null;
    const m = no === 12 ? 15 : no + 1, ms = states[m];
    if (!(o.today >= P.suggestedDate(o.plan.startDate, m) || (isPlain(ms) && ms.startedAt))) return null;
    return rows[no] && rows[no].status === 'open' ? { no, minutes: cp.minutes } : null;
  }
  /* 每週 1 堂的學生沒上的第 4k 堂小檢核:到了第 4k＋1 堂(第 12 堂是第 15 堂)的建議日期起出現。opt = { plan, states, unlock, today, packs, levels }。
     回 { no, minutes }(最小的那一堂)或 null */
  function soloCheckpoint(opt) {
    const o = opt || {};
    if (!isPlain(o.plan) || !o.unlock || !Array.isArray(o.unlock.lessons)) return null;
    const opt2 = optionalOf(o.plan), rows = {};
    o.unlock.lessons.forEach((x) => { rows[x.no] = x; });
    for (let no = 2; no < 24; no++) { const hit = soloOk(o, no, opt2, rows); if (hit) return hit; }
    return null;
  }

  /* ---------- 程度調整 ---------- */
  const PART = /^(?:l([1-4])|p([5-7]))-/;
  const counted = (b) => (b < 80) || (b >= 90 && b <= 97);
  /* 第 2–4 堂的答對率:{ listening: { n, ok }, reading: { n, ok } }。lessonOf(no) 有給時,固定段只算那一堂課表上有的區塊編號 */
  function calibrationRates(states, lessonOf) {
    const out = { listening: { n: 0, ok: 0 }, reading: { n: 0, ok: 0 } };
    [2, 3, 4].forEach((no) => {
      const s = states && states[no];
      if (!isPlain(s) || !Array.isArray(s.a)) return;
      const l = typeof lessonOf === 'function' ? lessonOf(no) : null;
      const idx = l ? new Set([].concat(...l.segments.map((x) => (x.blocks || []).map((b) => b.idx)))) : null;
      s.a.forEach((x) => {
        const m = Array.isArray(x) ? PART.exec(String(x[1])) : null;
        if (!m || !Number.isInteger(x[0]) || !counted(x[0]) || !(x[4] & 2) || (idx && x[0] < 80 && !idx.has(x[0]))) return;
        const r = out[m[1] ? 'listening' : 'reading'];
        r.n++;
        if (x[4] & 1) r.ok++;
      });
    });
    return out;
  }
  function moved(level, rate) {
    const i = LEVELS.indexOf(level);
    if (i < 0 || !rate || rate.n < MIN_N) return level;
    const p = rate.ok / rate.n;
    return p > UP ? LEVELS[Math.min(i + 1, LEVELS.length - 1)] : p < DOWN ? LEVELS[Math.max(i - 1, 0)] : level;
  }
  /* 新的 levels(newLevels 是 ONBOARD_CORE.newLevels)與 changed: { listening: [舊, 新] | null, reading } */
  function calibrateLevels(prev, rates, nowIso, newLevels) {
    if (!isPlain(prev) || typeof newLevels !== 'function') throw new TypeError('要給目前的 levels 與 newLevels');
    const l = moved(prev.listening, rates && rates.listening), r = moved(prev.reading, rates && rates.reading);
    const source = Object.assign({}, isPlain(prev.source) ? prev.source : {});
    if (l !== prev.listening) source.listening = 'calibrate';
    if (r !== prev.reading) source.reading = 'calibrate';
    return {
      levels: newLevels(prev, l, r, source, 'calibrate', nowIso),
      changed: { listening: l !== prev.listening ? [prev.listening, l] : null, reading: r !== prev.reading ? [prev.reading, r] : null },
    };
  }
  /* 這一期的那一筆(history 裡 reason 'calibrate'、時間在開始日當地 00:00 以後的最後一筆)的位置;沒有回 -1 */
  function termIndex(levels, startDate) {
    const h = isPlain(levels) && Array.isArray(levels.history) ? levels.history : [], from = startMs(startDate);
    for (let i = h.length - 1; i >= 0; i--) if (isPlain(h[i]) && h[i].reason === 'calibrate' && Date.parse(h[i].at) >= from) return i;
    return -1;
  }
  function calibrated(levels, startDate) { return termIndex(levels, startDate) > -1; }
  /* 畫面用:本期那一筆跟它前一筆比 → { changed };本期沒做過回 null */
  function calibration(levels, startDate) {
    const i = termIndex(levels, startDate);
    if (i < 0) return null;
    const h = levels.history, cur = h[i], prev = i > 0 && isPlain(h[i - 1]) ? h[i - 1] : null;
    const diff = (k) => (prev && prev[k] !== cur[k] ? [prev[k], cur[k]] : null);
    return { changed: { listening: diff('listening'), reading: diff('reading') } };
  }

  root.LESSON_PLAN = Object.freeze({
    WEEKS, courseWeek, perWeekOf, withWeekly, optionalOf, requiredCount, weekGoal, soloCheckpoint,
    calibrationRates, calibrateLevels, calibrated, calibration,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
