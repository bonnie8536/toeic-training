/* 新用戶設定起始程度(start.html)的純計算:對級、月份、訪客暫存的檢查、入口判斷、接回要寫什麼。
   不讀寫任何儲存、不碰畫面;start.html、首頁、「我的」頁、檢測頁、教師後台、測試(tools/test_onboard.js)共用。
   - 級別代碼:entry 入門、threshold 門檻、advanced 進階、high 高分。
   - 時間一律用台北時間(UTC+8,沒有日光節約)算月份,不看裝置時區。
   - 回傳的物件都是新的,不改傳進來的物件。 */
(function (root) {
  'use strict';

  const LEVELS = Object.freeze(['entry', 'threshold', 'advanced', 'high']);
  const NAMES = Object.freeze({ entry: '入門', threshold: '門檻', advanced: '進階', high: '高分' });
  const TARGETS = Object.freeze([450, 600, 785, 860]);
  const GUEST_STEPS = Object.freeze(['target', 'exam', 'level', 'score']);
  const ACTIONS = Object.freeze(['test', 'entry', 'score', 'join']);
  const MIN = 60e3, HOUR = 3600e3, DAY = 864e5, TPE = 8 * HOUR;
  const GUEST_TTL = 7 * DAY, RESUME_TTL = 24 * HOUR, SKEW = 2 * MIN, NEW_ACCOUNT = 7 * DAY, LEGACY_TTL = 180 * DAY;
  const HISTORY_MAX = 20;
  const YM = /^(\d{4})-(0[1-9]|1[0-2])$/;
  const NONCE = /^[0-9a-z]{16,40}$/;
  const SECTION_MSG = '請輸入 5 到 495 之間、5 的倍數';
  const TOTAL_MSG = '請輸入 10 到 990 之間、5 的倍數';
  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const isLevel = (x) => LEVELS.indexOf(x) > -1;
  const copy = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

  function levelName(code) { return Object.prototype.hasOwnProperty.call(NAMES, code) ? NAMES[code] : ''; }
  function levelsLabel(lv) {
    if (!isPlain(lv) || !isLevel(lv.listening) || !isLevel(lv.reading)) return '未設定';
    return '聽力 ' + NAMES[lv.listening] + '／閱讀 ' + NAMES[lv.reading];
  }

  /* ---------- 成績 ---------- */
  /* 全形數字轉半形、去頭尾空白;不是純數字回 NaN */
  function parseScoreInput(text) {
    if (typeof text !== 'string' && typeof text !== 'number') return NaN;
    const s = String(text).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();
    return /^\d{1,4}$/.test(s) ? parseInt(s, 10) : NaN;
  }
  const inRange = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi && n % 5 === 0;
  function checkSection(n) { return inRange(n, 5, 495) ? '' : SECTION_MSG; }
  function checkTotal(n) { return inRange(n, 10, 990) ? '' : TOTAL_MSG; }

  /* 成績對級:聽力 ≤220 入門、225–320 門檻、325–410 進階、≥415 高分;閱讀 ≤170、175–270、275–365、≥370 */
  function bandOf(section, score) {
    if (!inRange(score, 5, 495)) return null;
    const cut = section === 'listening' ? [220, 320, 410] : [170, 270, 365];
    if (score <= cut[0]) return 'entry';
    if (score <= cut[1]) return 'threshold';
    if (score <= cut[2]) return 'advanced';
    return 'high';
  }
  /* 只有總分:聽力 = (總分 + 50) ÷ 2 四捨五入到 5 的倍數(x.5 進位,自訂),夾在 5–495;閱讀 = 總分 − 聽力,也夾在 5–495 */
  function splitTotal(total) {
    let l = Math.min(495, Math.max(5, Math.round((total + 50) / 2 / 5) * 5));
    let r = total - l;
    if (r < 5) { r = 5; l = total - 5; }
    if (r > 495) { r = 495; l = total - 495; }
    return { listening: l, reading: r };
  }
  function levelsFromScore(self) {
    const l = isPlain(self) ? bandOf('listening', self.listening) : null;
    const r = isPlain(self) ? bandOf('reading', self.reading) : null;
    if (!l || !r) return null;
    return { listening: l, reading: r, source: { listening: 'score', reading: 'score' } };
  }
  /* S3a 的草稿(欄位都是字串,還沒檢查):{ listening, reading, total, examYm, fromTotal } */
  function draftErrors(d) {
    d = isPlain(d) ? d : {};
    const e = { listening: '', reading: '', total: '', examYm: '' };
    if (d.fromTotal) e.total = checkTotal(parseScoreInput(d.total));
    else { e.listening = checkSection(parseScoreInput(d.listening)); e.reading = checkSection(parseScoreInput(d.reading)); }
    if (d.examYm !== 'older' && !YM.test(String(d.examYm || ''))) e.examYm = '請選擇考試年月';
    return e;
  }
  /* 草稿 → self_score(沒有 enteredAt);有一欄不對就回 null */
  function scoreFromDraft(d) {
    if (!isPlain(d)) return null;
    const e = draftErrors(d);
    if (e.listening || e.reading || e.total || e.examYm) return null;
    if (d.fromTotal) {
      const t = parseScoreInput(d.total), s = splitTotal(t);
      return { listening: s.listening, reading: s.reading, total: t, examYm: d.examYm, fromTotal: true };
    }
    const l = parseScoreInput(d.listening), r = parseScoreInput(d.reading);
    return { listening: l, reading: r, total: l + r, examYm: d.examYm, fromTotal: false };
  }
  function cleanDraft(d) {
    if (!isPlain(d)) return null;
    const s = (x) => (typeof x === 'string' ? x.slice(0, 8) : '');
    return { listening: s(d.listening), reading: s(d.reading), total: s(d.total), examYm: s(d.examYm), fromTotal: d.fromTotal === true };
  }

  /* ---------- 月份(台北時間) ---------- */
  function ymParts(nowMs) { const t = new Date(nowMs + TPE); return [t.getUTCFullYear(), t.getUTCMonth() + 1]; }
  const ymOf = (y, m) => y + '-' + (m < 10 ? '0' : '') + m;
  const labelOf = (y, m) => y + ' 年 ' + m + ' 月';
  function monthList(nowMs, n, dir) {
    let [y, m] = ymParts(nowMs);
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({ value: ymOf(y, m), label: labelOf(y, m) });
      m += dir;
      if (m > 12) { m = 1; y++; } else if (m < 1) { m = 12; y--; }
    }
    return out;
  }
  /* 考試年月:本月往前共 36 個月(含本月,自訂)+「更早」 */
  function scoreMonths(nowMs) { return monthList(nowMs, 36, -1).concat([{ value: 'older', label: '更早' }]); }
  function examMonths(nowMs) { return monthList(nowMs, 12, 1); }
  /* ISO 時間 → 台北的「11 月 18 日」;壞掉回空字串 */
  function dayLabel(iso) {
    const t = Date.parse(iso);
    if (!isFinite(t)) return '';
    const d = new Date(t + TPE);
    return (d.getUTCMonth() + 1) + ' 月 ' + d.getUTCDate() + ' 日';
  }
  function ymLabel(ym) { const m = YM.exec(String(ym || '')); return m ? labelOf(+m[1], +m[2]) : ''; }
  function monthsBetween(ym, nowMs) {
    const m = YM.exec(String(ym || ''));
    if (!m) return NaN;
    const [y, mm] = ymParts(nowMs);
    return (y - +m[1]) * 12 + (mm - +m[2]);
  }
  function scoreTooOld(examYm, nowMs) { return examYm === 'older' || !(monthsBetween(examYm, nowMs) <= 24); }

  /* ---------- 舊檢測(28 題)的過渡對級 ---------- */
  /* 順序同 js/diagnostic.js:P5、P6、P7 */
  function flattenDiagItems(D) {
    if (!isPlain(D) || !Array.isArray(D.p5) || !isPlain(D.p6) || !isPlain(D.p7)) return [];
    return [].concat(D.p5, D.p6.questions || [], D.p7.questions || []).map((q) => ({ answer: q.answer, difficulty: q.difficulty }));
  }
  /* 舊檢測對閱讀級:答對率 <50% 且基礎題 <60% 入門;<50% 其他門檻;50–64% 門檻;65–84% 進階;≥85% 高分。未答算錯 */
  function legacyReading(diag, items) {
    if (!isPlain(diag) || diag.done !== true || !Array.isArray(items) || !items.length) return null;
    const ans = isPlain(diag.answers) ? diag.answers : {};
    let correct = 0, basicCorrect = 0, basicTotal = 0;
    items.forEach((it, i) => {
      const ok = ans[i] === it.answer;
      if (ok) correct++;
      if (it.difficulty === '基礎') { basicTotal++; if (ok) basicCorrect++; }
    });
    const r = correct / items.length, b = basicTotal ? basicCorrect / basicTotal : 0;
    let level = 'high';
    if (r < 0.5) level = b < 0.6 ? 'entry' : 'threshold';
    else if (r < 0.65) level = 'threshold';
    else if (r < 0.85) level = 'advanced';
    return { level, correct, total: items.length, basicCorrect, basicTotal };
  }
  function plusOne(code) { const i = LEVELS.indexOf(code); return i < 0 ? code : LEVELS[Math.min(i + 1, LEVELS.length - 1)]; }
  /* 聽力沒有檢測:聽力 = 閱讀級 + 1(最高高分,暫定) */
  function levelsFromLegacy(diag, items) {
    const r = legacyReading(diag, items);
    if (!r) return null;
    return { listening: plusOne(r.level), reading: r.level, source: { listening: 'legacy_plus1', reading: 'legacy' } };
  }
  function legacyUsable(diag, nowMs) {
    if (!isPlain(diag) || diag.done !== true) return false;
    const f = Date.parse(diag.finishedAt);
    return isFinite(f) && nowMs - f >= -SKEW && nowMs - f < LEGACY_TTL;
  }

  /* ---------- 結果 ---------- */
  /* 「開始練習」:先取較低的一科(同級取閱讀)。
     聽力要比閱讀低才用聽力那一欄,所以聽力高分(practice.html?part=4)照這條規則到不了 */
  const LINKS = Object.freeze({
    listening: { entry: 'practice.html?part=1', threshold: 'practice.html?part=2', advanced: 'practice.html?part=3', high: 'practice.html?part=4' },
    reading: { entry: 'grammar.html', threshold: 'practice.html?part=5', advanced: 'practice.html?part=6', high: 'practice.html?part=7' },
  });
  function practiceLink(lv) {
    if (!isPlain(lv) || !isLevel(lv.listening) || !isLevel(lv.reading)) return null;
    const l = LEVELS.indexOf(lv.listening), r = LEVELS.indexOf(lv.reading);
    return l < r ? LINKS.listening[lv.listening] : LINKS.reading[lv.reading];
  }
  function levelGap(a, b) { return Math.abs(LEVELS.indexOf(a) - LEVELS.indexOf(b)); }
  function pushHistory(lv, entry) {
    const base = isPlain(lv) ? copy(lv) : {};
    const history = (Array.isArray(base.history) ? base.history : []).concat([copy(entry)]);
    return Object.assign(base, { history: history.slice(-HISTORY_MAX) });
  }
  /* 時間欄位(levels.setAt、onboard.updatedAt、self_score.enteredAt)只往前走:取「現在」和「前一份的時間 + 1 毫秒」較晚的那個。
     前一份是本機目前讀到的值(跟雲端合併過就帶著別台的時間),所以別台時鐘快幾分鐘,這台後做的改動合併時還是贏(js/sync-merge.js 留時間新的)。
     前一份在現在一天以後(時鐘錯很多)不跟著它,用現在的時間;js/sync-merge.js 也把超過一天的時間當成沒有時間 */
  function stampAfter(prevIso, nowIso) {
    const n = Date.parse(nowIso), p = typeof prevIso === 'string' ? Date.parse(prevIso) : NaN;
    if (!isFinite(n) || !isFinite(p) || p < n || p > n + DAY) return nowIso;
    return new Date(p + 1).toISOString();
  }
  /* 寫進 levels 的新值:兩科、來源、這一筆的理由。
     最後一筆的級別、理由都一樣,而且是 1 分鐘內記的(兩個分頁同時接回、連按兩下):不再多記一筆 */
  function newLevels(prev, listening, reading, source, reason, nowIso) {
    const old = isPlain(prev) && Array.isArray(prev.history) ? prev.history : [];
    const last = old[old.length - 1];
    const dup = isPlain(last) && last.listening === listening && last.reading === reading && last.reason === reason
      && Math.abs(Date.parse(nowIso) - Date.parse(last.at)) < MIN;
    const at = stampAfter(isPlain(prev) ? prev.setAt : null, nowIso);
    const history = dup ? copy(old).slice(-HISTORY_MAX) : pushHistory(prev, { at, listening, reading, reason }).history;
    return { listening, reading, source: copy(source), setAt: at, history };
  }
  /* 兩科都是認得的級別才算設定過 */
  function levelsSet(lv) { return isPlain(lv) && isLevel(lv.listening) && isLevel(lv.reading); }
  /* S8b「與檢測結果差 2 級」:跟最後一筆檢測或成績的結果比(score 成績、legacy 舊檢測、est 程度檢測與練習);只有 entry、manual 不比 */
  const TESTED = Object.freeze(['score', 'legacy', 'est']);
  function testedLevels(lv) {
    const h = isPlain(lv) && Array.isArray(lv.history) ? lv.history : [];
    for (let i = h.length - 1; i >= 0; i--) if (h[i] && TESTED.indexOf(h[i].reason) > -1) return h[i];
    return null;
  }

  /* ---------- 程度檢測(placement_v1,由 ESTIMATE_STORE 寫) ---------- */
  /* placement_v1 = { v: 1, runs: [{ at, end, sec, tm: { L: [開始, 結束], R: [...] }, items, res: { L: [預估, 下緣, 上緣], R } }] }。
     這裡只讀:最新一次(at 最晚)、做完的檢測(end 有值)、這一次做完了哪幾科(tm 有結束時間) */
  const runsOf = (pl) => (isPlain(pl) && Array.isArray(pl.runs) ? pl.runs.filter((r) => isPlain(r) && typeof r.at === 'string' && isFinite(Date.parse(r.at))) : []);
  const byAt = (a, b) => Date.parse(b.at) - Date.parse(a.at);
  function latestRun(pl) { return runsOf(pl).sort(byAt)[0] || null; }
  const ended = (r) => isPlain(r) && typeof r.end === 'string' && isFinite(Date.parse(r.end));
  /* 最近做完的一次(給「重新檢測」右側的日期、檢測報告);沒有回 null */
  function lastDoneRun(pl) { return runsOf(pl).filter(ended).sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0] || null; }
  function runSections(run) {
    const tm = isPlain(run) && isPlain(run.tm) ? run.tm : {};
    const done = (s) => Array.isArray(tm[s]) && typeof tm[s][1] === 'string' && isFinite(Date.parse(tm[s][1]));
    return { L: done('L'), R: done('R') };
  }
  /* 設定流程裡剛做完的檢測:新檢測(最新一次 end 不早於 testFrom)回 est、舊檢測(交卷不早於 testFrom)回 legacy;
     兩個都有取晚的那個(同時取新檢測);都沒有回 null */
  function freshTest(ob, diag, pl) {
    if (!isPlain(ob) || ob.status !== 'in_progress' || ob.step !== 'test') return null;
    const s = Date.parse(ob.testFrom);
    if (!isFinite(s)) return null;
    const run = latestRun(pl);
    const e = ended(run) ? Date.parse(run.end) : NaN;
    const f = isPlain(diag) && diag.done === true ? Date.parse(diag.finishedAt) : NaN;
    const estOk = isFinite(e) && e >= s, legOk = isFinite(f) && f >= s;
    if (estOk && (!legOk || e >= f)) return 'est';
    return legOk ? 'legacy' : null;
  }
  /* 新檢測要做哪幾科:只有舊檢測(閱讀已有作答)而且還沒用新檢測測過聽力時只做聽力(L),其他兩科(LR) */
  function testPlan(diag, pl) {
    const legacy = isPlain(diag) && diag.done === true;
    const listened = runsOf(pl).some((r) => runSections(r).L);
    return legacy && !listened && !lastDoneRun(pl) ? 'L' : 'LR';
  }
  /* readFirst:兩科都做、沒有耳機的人先做閱讀(檢測頁看 first=R) */
  function placementHref(sec, readFirst) {
    return 'placement.html?start=1&from=onboard' + (sec === 'L' || sec === 'R' ? '&sec=' + sec : readFirst ? '&first=R' : '');
  }

  /* 預估分數對回四級(view 是 ESTIMATE_STORE 的 View,run 是剛做完的那一次,prev 是現在的 levels)。
     這一次做完的科:用預估的級別(view 有數字時),沒有 view 時用這一次存的結果 res(只用這一次作答加起點算的);
     沒做的那一科:已經有級別就不動,沒有的話用 view 有數字的級別,再沒有就入門。
     這一次一科都沒做完,或做完的科兩種都算不出級別:回 null */
  const SEC_KEY = Object.freeze({ L: 'listening', R: 'reading' });
  function bandFromRun(run, sec) {
    const r = isPlain(run) && isPlain(run.res) && Array.isArray(run.res[sec]) ? run.res[sec][0] : NaN;
    return bandOf(SEC_KEY[sec], r);
  }
  function viewBand(view, sec) {
    const v = isPlain(view) && view.ok === true && isPlain(view[sec]) ? view[sec] : null;
    return v && v.show === true && isLevel(v.band) ? v.band : null;
  }
  function levelsFromEstimate(view, run, prev) {
    const done = runSections(run);
    if (!done.L && !done.R) return null;
    const out = { source: {} };
    ['L', 'R'].forEach((sec) => {
      const k = SEC_KEY[sec];
      if (done[sec]) { out[k] = viewBand(view, sec) || bandFromRun(run, sec); out.source[k] = 'est'; return; }
      if (levelsSet(prev)) { out[k] = prev[k]; out.source[k] = isPlain(prev.source) && typeof prev.source[k] === 'string' ? prev.source[k] : 'manual'; return; }
      const other = viewBand(view, sec);
      out[k] = other || 'entry';
      out.source[k] = other ? 'est' : 'entry';
    });
    return out.listening && out.reading ? out : null;
  }
  /* 做完檢測要不要直接改級別:已經設定完過(doneAt 有值)、有級別、又有課程進度的人不自動改,只顯示建議(suggest);其他直接寫(write) */
  function estPolicy(ob, levels, hasCourse) {
    const before = isPlain(ob) && typeof ob.doneAt === 'string' && !!ob.doneAt;
    return before && levelsSet(levels) && !!hasCourse ? 'suggest' : 'write';
  }

  /* ---------- 訪客暫存 tr_onboard_guest ---------- */
  function newGuest(nowMs) {
    return { v: 1, createdAt: nowMs, expiresAt: nowMs + GUEST_TTL, step: 'target', targetScore: null, examMonth: null, scoreDraft: null, pendingAction: null, authStartedAt: null,
      authNonce: null };
  }
  /* 瀏覽器存的原字串 → 物件;壞掉、過期、時鐘差太多一律 null(呼叫端刪掉) */
  function readGuest(raw, nowMs) {
    let g;
    try { g = JSON.parse(raw); } catch (e) { return null; }
    if (!isPlain(g) || g.v !== 1 || typeof g.createdAt !== 'number' || typeof g.expiresAt !== 'number') return null;
    if (GUEST_STEPS.indexOf(g.step) < 0) return null;
    if (g.targetScore !== null && TARGETS.indexOf(g.targetScore) < 0) return null;
    if (g.examMonth !== null && !YM.test(String(g.examMonth))) return null;
    if (g.pendingAction !== null && ACTIONS.indexOf(g.pendingAction) < 0) return null;
    if (g.authStartedAt !== null && typeof g.authStartedAt !== 'number') return null;
    if (g.scoreDraft !== null && !isPlain(g.scoreDraft)) return null;
    const draft = cleanDraft(g.scoreDraft);   // 先整理再檢查:檢查的跟之後用的是同一份
    if (g.pendingAction === 'score' && !scoreFromDraft(draft)) return null;
    const nonce = g.authNonce === undefined ? null : g.authNonce;
    if (nonce !== null && !NONCE.test(String(nonce))) return null;
    if (g.createdAt - nowMs >= SKEW) return null;
    if (nowMs >= Math.min(g.expiresAt, g.createdAt + GUEST_TTL)) return null;
    return { v: 1, createdAt: g.createdAt, expiresAt: g.expiresAt, step: g.step, targetScore: g.targetScore, examMonth: g.examMonth,
      scoreDraft: draft, pendingAction: g.pendingAction, authStartedAt: g.authStartedAt, authNonce: nonce };
  }
  function guestPatch(g, patch, nowMs) {
    const base = isPlain(g) ? copy(g) : newGuest(nowMs);
    const out = Object.assign(base, copy(patch));
    if (Object.prototype.hasOwnProperty.call(patch, 'scoreDraft')) out.scoreDraft = cleanDraft(patch.scoreDraft);
    return out;
  }
  function resumeEligible(g, nowMs) {
    if (!isPlain(g) || ACTIONS.indexOf(g.pendingAction) < 0 || typeof g.authStartedAt !== 'number') return false;
    const d = nowMs - g.authStartedAt;
    return d > -SKEW && d < RESUME_TTL;
  }

  /* ---------- 入口判斷 ---------- */
  const PRACTICE = /^(hist|diag|fa_v1|placement_v1|drill_p\d{1,2}|listen_p\d{1,2})$/;
  function hasPracticeKeys(keys, pid) {
    const pre = 'tr_u' + pid + '_';
    return (keys || []).some((k) => typeof k === 'string' && k.indexOf(pre) === 0 && PRACTICE.test(k.slice(pre.length)));
  }
  /* 本機有沒有學習資料:目前學生、或任何學生資料夾(tr_u 開頭,不含 tr_unsynced_ 這類) */
  function hasLocalData(keys) {
    return (keys || []).some((k) => k === 'tr_current_profile' || /^tr_u(p[0-9a-z]{4,20}|c[0-9a-f]{32})_/.test(k));
  }
  /* ctx:{ joinParam, signedIn, isTeacher, onboard, guest(已檢查過的物件或 null), nowMs, createdAtMs, hasPracticeKeys, isApp, hasLocalData, cloudEnabled }
     回 { row, state, cleanupGuest }。state:join、resume、none、D0、B、A、E、S0 */
  function entryRoute(ctx) {
    const out = (row, state, cleanupGuest) => ({ row, state, cleanupGuest: !!cleanupGuest });
    if (!ctx || !ctx.cloudEnabled) return out(0, 'none');
    if (typeof ctx.joinParam === 'string') return out(1, 'join');
    let cleanup = false;
    if (ctx.signedIn) {
      if (ctx.guest) {
        if (resumeEligible(ctx.guest, ctx.nowMs)) return out(2, 'resume');
        cleanup = true;
      }
      if (ctx.isTeacher) return out(3, 'none', cleanup);
      const st = isPlain(ctx.onboard) ? ctx.onboard.status : null;
      if (st === 'done') return out(4, 'D0', cleanup);
      if (st === 'in_progress') return out(5, 'B', cleanup);
      if (st === 'dismissed') return out(7, 'none', cleanup);
      const age = ctx.nowMs - ctx.createdAtMs;
      if (typeof ctx.createdAtMs === 'number' && isFinite(age) && age < NEW_ACCOUNT && !ctx.hasPracticeKeys) return out(6, 'A', cleanup);
      return out(7, 'E', cleanup);
    }
    if (ctx.guest) return out(8, 'B');
    if (ctx.isApp && !ctx.hasLocalData) return out(9, 'S0');
    return out(10, 'A');
  }
  /* 「看起始程度」:設定中、在檢測這一步、交卷(舊檢測)或做完(新檢測 placement_v1 最新一次的 end)不早於按「開始檢測」的時間 */
  function diagRowState(ob, diag, pl) { return freshTest(ob, diag, pl) ? 'result' : 'none'; }
  function homeState(ctx) {
    const r = entryRoute(ctx);
    if (r.state === 'B' && ctx.signedIn && diagRowState(ctx.onboard, ctx.diag, ctx.placement) === 'result') return 'B_result';
    return r.state;
  }
  /* S8 開頁時要做什麼:est 用剛做完的新檢測對回四級、legacy 用剛交的舊卷算級別;draw 直接畫;done 先記完成再畫;
     其他是要轉去的那一步。按了「重新檢測」(in_progress、test)還沒做完時回 test,不能用舊級別記完成 */
  function resultRoute(ob, levels, diag, pl) {
    const fresh = freshTest(ob, diag, pl);
    if (fresh) return fresh;
    const o = isPlain(ob) ? ob : {};
    if (!levelsSet(levels)) return o.step === 'test' ? 'test' : 'level';
    if (o.status === 'done') return 'draw';
    if (o.status !== 'in_progress' || o.step === 'result') return 'done';
    return RESUME_STEPS.indexOf(o.step) > -1 ? o.step : 'level';
  }
  /* ---------- store 鍵 onboard ---------- */
  function freshOnboard(nowIso) {
    return { v: 1, status: 'in_progress', step: 'target', path: 'self', targetScore: null, examMonth: null, levelSource: null, testFrom: null,
      previous: null, startedAt: nowIso, doneAt: null, updatedAt: nowIso };
  }
  /* 已登入的每一步:沒有或已略過就新建(in_progress),其他照舊合併 */
  function patchOnboard(ob, patch, nowIso) {
    const base = isPlain(ob) && ob.status !== 'dismissed' ? copy(ob) : freshOnboard(nowIso);
    return Object.assign(base, copy(patch), { updatedAt: stampAfter(isPlain(ob) ? ob.updatedAt : null, nowIso) });
  }
  /* prev:本機目前的 onboard(updatedAt 要比它晚) */
  function dismissedOnboard(nowIso, prev) {
    return Object.assign(freshOnboard(nowIso), { status: 'dismissed', step: null, path: null, startedAt: null,
      updatedAt: stampAfter(isPlain(prev) ? prev.updatedAt : null, nowIso) });
  }

  /* ---------- 接回 ---------- */
  /* account:{ onboard, self_score, levels, isTeacher, hasPendingJoin, trusted, confirmed }
     trusted:這次登入是在這個分頁的 S9(或 C1)登入卡發起的(sessionStorage 的隨機碼跟訪客暫存的 authNonce 一樣);
     confirmed:不一樣(別頁的登入卡、Email 驗證信、共用電腦換人)時,本人在確認視窗按了「帶入」。
     回 { kind: teacher|join|none|confirm|x1|write, writes, next: test|result|score|join|home } */
  function resumePlan(guest, account, nowIso) {
    const a = isPlain(account) ? account : {};
    const stay = (kind) => ({ kind, writes: {}, next: 'home' });
    if (a.isTeacher) return stay('teacher');
    if (a.trusted && a.hasPendingJoin) return { kind: 'join', writes: {}, next: 'join' };
    /* 要加入班級但碼已經不在,或不是本人發起的:不帶入代碼,也不寫任何鍵 */
    if (guest.pendingAction === 'join') return stay('none');
    if (!a.trusted && !a.confirmed) return stay('confirm');
    if (hasSettings(a)) return stay('x1');
    return writePlan(guest, a, nowIso);
  }
  /* X1 的條件:設定已完成,或已經有級別(例如「重新檢測」沒做完、按過「不用了」之後) */
  function hasSettings(a) { return (isPlain(a.onboard) && a.onboard.status === 'done') || levelsSet(a.levels); }
  /* 存進 onboard.previous 的舊值:onboard 拿掉它自己的 previous(不然每接回一次多套一層);levels 只留兩科、來源、時間,不帶 history */
  function previousOf(a) {
    const prev = {};
    if (isPlain(a.onboard)) { const o = copy(a.onboard); delete o.previous; prev.onboard = o; }
    if (a.self_score !== null && a.self_score !== undefined) prev.self_score = copy(a.self_score);
    if (isPlain(a.levels)) prev.levels = copy({ listening: a.levels.listening, reading: a.levels.reading, source: a.levels.source, setAt: a.levels.setAt });
    return Object.keys(prev).length ? prev : null;
  }
  const PLAN_STEP = Object.freeze({ test: 'test', entry: 'result', score: 'result', rescore: 'score' });
  function writePlan(guest, a, nowIso) {
    /* 自填成績只在隨機碼一致時帶入;本人確認帶入時只帶目標與月份,成績請本人在 S3a 重填 */
    const act = guest.pendingAction === 'score' && !a.trusted ? 'rescore' : guest.pendingAction;
    if (!PLAN_STEP[act]) return { kind: 'none', writes: {}, next: 'home' };
    const self = act === 'score' ? scoreFromDraft(guest.scoreDraft) : null;
    const lv = self ? levelsFromScore(self) : null;
    if (act === 'score' && !lv) return { kind: 'none', writes: {}, next: 'home' };
    const ob = Object.assign(freshOnboard(nowIso), { step: PLAN_STEP[act], targetScore: guest.targetScore, examMonth: guest.examMonth,
      levelSource: act === 'entry' || act === 'score' ? act : null, previous: previousOf(a),
      updatedAt: stampAfter(isPlain(a.onboard) ? a.onboard.updatedAt : null, nowIso) });
    const writes = { onboard: ob };
    if (act === 'entry') writes.levels = newLevels(a.levels, 'entry', 'entry', { listening: 'entry', reading: 'entry' }, 'entry', nowIso);
    if (act === 'score') {
      writes.self_score = Object.assign(self, { enteredAt: stampAfter(isPlain(a.self_score) ? a.self_score.enteredAt : null, nowIso) });
      writes.levels = newLevels(a.levels, lv.listening, lv.reading, lv.source, 'score', nowIso);
    }
    return { kind: 'write', writes, next: PLAN_STEP[act] };
  }
  function applyX1(choice, guest, account, nowIso) {
    if (choice === 'keep') return { kind: 'keep', writes: {}, next: 'home' };
    return writePlan(guest, isPlain(account) ? account : {}, nowIso);
  }

  /* ---------- 首頁卡、「我的」頁學習設定 ---------- */
  function targetLabel(v) { return TARGETS.indexOf(v) < 0 ? '還不確定' : v === 860 ? '860 分以上' : v + ' 分'; }
  const RESUME_STEPS = Object.freeze(['target', 'exam', 'level', 'score', 'test', 'result']);
  /* 「繼續」:接著中斷的那一步(onboard 或訪客暫存的 step);沒有或不認得從 S1 開始 */
  function continueHref(st) {
    return 'start.html?step=' + (isPlain(st) && RESUME_STEPS.indexOf(st.step) > -1 ? st.step : 'target');
  }
  /* 首頁的卡(每日練習卡後面,桌機在右欄)。state 是 homeState 的結果;info:{ signedIn, onboard, guest, levels }。不畫就回 null。
     訪客的狀態 A 不畫卡:首屏的「先測程度」就連到 start.html。卡上的按鈕都是描邊鈕或文字按鈕,實色主按鈕留給每日練習;
     按鈕字不用「開始」(每日練習卡已經有一顆「開始」) */
  function homeCard(state, info) {
    const i = isPlain(info) ? info : {};
    const card = (title, sub, primary, more) => Object.assign({ state, title, sub, primary, secondary: null, dismiss: false }, more || {});
    if (state === 'A') {
      if (!i.signedIn) return null;
      return card('找出你的起始程度', '填多益成績，或做 24 題檢測（約 15–20 分鐘）', { text: '設定程度', href: 'start.html?step=target' },
        { secondary: { text: '我有班級代碼', href: 'start.html?step=join' } });
    }
    if (state === 'B') return card('繼續設定起始程度', '', { text: '繼續', href: continueHref(i.signedIn ? i.onboard : i.guest) });
    if (state === 'B_result') return card('繼續設定起始程度', '', { text: '看起始程度', href: 'start.html?step=result' });
    if (state === 'D0') {
      const link = practiceLink(i.levels);
      return card('你的起始程度', levelsLabel(i.levels), link ? { text: '開始練習', href: link } : { text: '看起始程度', href: 'start.html?step=result' });
    }
    if (state === 'E') return card('找出你的起始程度', '填多益成績，或做 24 題檢測（約 15–20 分鐘）', { text: '設定程度', href: 'start.html?step=target' }, { dismiss: true });
    return null;
  }
  /* 「我的」頁學習設定(五或六列)。account:{ onboard, levels };diag 是舊檢測;pl 是新檢測(placement_v1)。
     列:{ key, label, value, href } 或 { key, label, value, action:'levels' }(開改級別面板) */
  function settingsRows(account, diag, pl) {
    const a = isPlain(account) ? account : {};
    const ob = isPlain(a.onboard) ? a.onboard : {};
    const legacy = isPlain(diag) && diag.done === true;
    const run = lastDoneRun(pl);
    const tested = legacy || !!run;
    if (levelsLabel(a.levels) === '未設定') {
      return [{ key: 'setup', label: '設定程度', value: '', href: ob.status === 'in_progress' ? continueHref(ob) : continueHref(null) }];
    }
    const rows = [
      { key: 'levels', label: '程度', value: levelsLabel(a.levels), action: 'levels' },
      { key: 'target', label: '目標分數', value: targetLabel(ob.targetScore), href: 'start.html?step=target&from=me' },
      { key: 'exam', label: '考試月份', value: ymLabel(ob.examMonth) || '還沒報名', href: 'start.html?step=exam&from=me' },
      /* 做過檢測叫「重新檢測」、右側放上次日期(有新檢測放新檢測的);沒做過叫「做檢測」,跟 S8 一致 */
      tested ? { key: 'test', label: '重新檢測', value: dayLabel(run ? run.end : diag.finishedAt), href: 'start.html?step=test&from=me' }
        : { key: 'test', label: '做檢測', value: '', href: 'start.html?step=test&from=me' },
    ];
    /* 上次那份報告:有新檢測連新檢測的結果頁;只有舊檢測照舊連檢測頁。兩種都有時舊的那份另列「閱讀檢測報告」,照樣看得到 */
    if (run) rows.push({ key: 'report', label: '檢測報告', value: dayLabel(run.end), href: 'placement.html?view=last' });
    if (legacy) rows.push({ key: 'legacy', label: run ? '閱讀檢測報告' : '檢測報告', value: dayLabel(diag.finishedAt), href: 'diagnostic.html' });
    return rows;
  }

  root.ONBOARD_CORE = Object.freeze({
    LEVELS, TARGETS, levelName, levelsLabel, parseScoreInput, checkSection, checkTotal, bandOf, splitTotal, levelsFromScore,
    draftErrors, scoreFromDraft, cleanDraft, scoreMonths, examMonths, ymLabel, dayLabel, monthsBetween, scoreTooOld,
    flattenDiagItems, legacyReading, plusOne, levelsFromLegacy, legacyUsable,
    practiceLink, levelGap, pushHistory, stampAfter, newLevels, levelsSet, testedLevels,
    latestRun, lastDoneRun, runSections, freshTest, testPlan, placementHref, levelsFromEstimate, estPolicy,
    newGuest, readGuest, guestPatch, resumeEligible,
    hasPracticeKeys, hasLocalData, entryRoute, diagRowState, homeState, resultRoute,
    patchOnboard, dismissedOnboard, resumePlan, applyX1,
    targetLabel, continueHref, homeCard, settingsRows,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
