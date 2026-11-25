/* 預估分數的讀寫:全站唯一讀寫 fa_v1(第一次作答)、placement_v1(程度檢測紀錄)、est_v1(預估快照)的地方。window.ESTIMATE_STORE。
   計算一律呼叫 ESTIMATE(js/estimate-core.js、js/estimate-data.js),這裡不重寫算式;題目難度用 data/item-params.js 的 ITEM_PARAMS。
   載入順序:js/common.js(store)、js/estimate-core.js、js/estimate-data.js(每一頁都已載,在 js/sync-merge-estimate.js 前面)、
   data/item-params.js、這個檔。補回舊 28 題要 data/diagnostic.js(TOEIC.diagnostic);沒載的頁面先不補舊 28 題,別頁補。
   誰寫:
   · 訪客(沒有學生檔案、沒登入):只算不寫,也不讀寫雲端。
   · 本機學生檔案:寫本機(js/common.js 的 store),不讀雲端。
   · 雲端帳號:寫本機,上傳時 js/cloud.js 先讀雲端合併(合併表上的三個鍵)。load、startRun、finishRun 寫之前先讀雲端那一份合併。
   · 頁面因為帳號那一邊不能存(canKeepProgress 是 false)時不寫。
   資料安全:本機那份的 v 不是 1(更新版的格式)時整個鍵唯讀,不寫回;寫入一律是「原本的 ＋ 新的」,不刪、不蓋既有的作答與舊檢測紀錄
   (只有整份不是物件、讀不懂的 fa_v1 會在記下一題時換成新的一份)。不碰 hist、drill_p*、listen_p*、diag、tests_v1,只讀。
   壞資料(形狀不對的筆、壞掉的自填成績)不丟錯:壞筆照 ESTIMATE 的規則略過,算不出來時 view.ok 是 false。

   deps(每個函式最後一個參數,都可以不給):{ store, cloud, params, legacy, now(毫秒), profile(學生檔案 id), canWrite() }
     預設:store 是 js/common.js 的 store、cloud 是 window.CLOUD、params 是 ITEM_PARAMS、legacy 是 TOEIC.diagnostic、now 是現在、
     profile 是 window.__PROFILE_ID、canWrite 是 canKeepProgress()。

   對外的函式:
   · mode(deps) → 'guest' | 'local' | 'account'
   · peek(deps) → View:只讀本機、補回放在記憶體裡算,什麼都不寫(先畫畫面用)。
   · refresh(deps) → View:讀本機、補回舊資料(只補還沒有的 key)、算、寫 fa_v1(有補到才寫)與 est_v1(數字變了或不是今天才寫)。不讀雲端。
     練習頁交卷後在背景呼叫這個。
   · load(deps) → Promise<View>:同 refresh,但先讀雲端三個鍵合併(讀不到照本機的做)。個人頁、能力分析、結果頁開頁時呼叫。
   · recordFirst(key, ok, src, deps) → boolean:記一題第一次作答(已經有這題就不寫,回 false)。ok 是 1、0、true、false,或 null(看過、不計分);
     src 是一個字的來源(p 刷題、l 聽力一次、r 聽力重播或改速、c 課程回合、o 看過…,見 js/estimate-data.js)。只寫本機。
   · recordMany(rows, deps) → number:rows = [{ key, ok, src, day? }],一次寫入,回新加了幾題。
   · seen(key, deps) → boolean:fa_v1 有沒有這題(含看過)。
   · startRun({ sec: 'LR' | 'L' | 'R', at? }, deps) → Promise<{ run, fa }>:開始一次檢測(先讀雲端 fa_v1、placement_v1 合併),
     at 是這次的開始時間(ISO,也是這次的 id);fa 是合併後的第一次作答(選題排除用)。
   · beginSection(at, sec, deps) → run | null:開始一科(記開始時間;已經開始過不改)。
   · answer(at, rows, deps) → run | null:送出一格。rows = [{ s: 'L' | 'R', key, choice, ok: 1 | 0, secs }];
     寫進這次的 items(同一題不重複)與 fa_v1(來源 t)。只寫本機(每送出一次就存)。
   · endSection(at, sec, deps) → run | null:這一科做完:記結束時間,存這一科只用這一次作答加起點算的結果 res[sec] = [預估, 下緣, 上緣]。
   · finishRun(at, deps) → Promise<View>:整次結束(end 寫現在),先讀雲端合併再寫,回重算後的 View。
   · activeRun(deps) → run | null:最新一次還沒結束、最後一次動作在 24 小時內的檢測(續做用)。
   · runStatus(run, nowMs) → 'done' | 'active' | 'stale':stale 是超過 24 小時沒做完(end 維持 null,作答留在 fa_v1 照樣計分)。
   · excludeFor(at, deps) → { fa, used }:給 ESTIMATE.available 的排除清單(fa 是本機的第一次作答;used 是這次出過的 key 與題組 id)。
   · sectionsDone(placement) → { L, R }:哪一科做完過檢測(那一科的 tm 有結束時間)。
   · selfOf(selfScore, nowMs) → { L, R }:自填成績換成估分的起點({ score, months, fromTotal });不能用的科沒有。
   · suggestions(view, levels) → [{ sec, level }]:另一級機率 ≥0.8 而且跟 levels(listening、reading)不同的科(建議改級);levels 沒有那一科的級別就不建議。
   · KEYS:{ fa: 'fa_v1', placement: 'placement_v1', est: 'est_v1' }
   View = { ok, L, R, total, snapshot, n, at, mode, cloudRead, fa, placement, stats }
     L、R、total、snapshot 就是 ESTIMATE.display 的回傳(L.show、L.need { n, kind: 'any' | 'big' }、L.est、L.lo、L.hi、L.kind 'low' | 'high' | 'num'、
     L.band、L.pb、L.n);n 是兩科計分題數相加;at 是算的時間(ISO);stats 是這次補回的筆數(ESTIMATE.backfillStats 的形狀,沒補是 null)。
     ok 是 false 時(題目參數沒載到、算不出來)L、R、total 是 null。 */
(function (root) {
  'use strict';
  const KEYS = Object.freeze({ fa: 'fa_v1', placement: 'placement_v1', est: 'est_v1' });
  const RECORD_KEYS = ['drill_p5', 'drill_p6', 'drill_p7', 'listen_p1', 'listen_p2', 'listen_p3', 'listen_p4'];
  const STALE_MS = 24 * 3600e3;
  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const fin = (x) => typeof x === 'number' && isFinite(x);
  const J = JSON.stringify;

  function est() {
    const E = root.ESTIMATE;
    if (!E || typeof E.display !== 'function' || typeof E.mergeFirstAttempts !== 'function') throw new Error('要先載入 js/estimate-core.js 與 js/estimate-data.js');
    return E;
  }
  /* ---------- 依賴 ---------- */
  function depsOf(deps) {
    const d = deps || {};
    /* global store, canKeepProgress:js/common.js 的頂層宣告 */
    const st = d.store || (typeof store !== 'undefined' ? store : null);
    if (!st || typeof st.get !== 'function' || typeof st.set !== 'function') throw new Error('沒有 store');
    const canWrite = typeof d.canWrite === 'function' ? d.canWrite
      : () => { try { return typeof canKeepProgress !== 'function' || !!canKeepProgress(); } catch (e) { return false; } };
    return {
      store: st,
      cloud: d.cloud === undefined ? root.CLOUD : d.cloud,
      params: d.params !== undefined ? d.params : root.ITEM_PARAMS || null,
      legacy: d.legacy !== undefined ? d.legacy : (root.TOEIC && root.TOEIC.diagnostic) || null,
      now: fin(d.now) ? d.now : Date.now(),
      profile: d.profile !== undefined ? d.profile : root.__PROFILE_ID,
      canWrite,
    };
  }
  function modeOf(dp) {
    const p = dp.profile;
    if (typeof p !== 'string' || !p) return 'guest';
    return p.charAt(0) === 'c' ? 'account' : 'local';
  }
  function mode(deps) { return modeOf(depsOf(deps)); }
  function writable(dp) { return modeOf(dp) !== 'guest' && !!dp.canWrite(); }

  /* ---------- 讀 ---------- */
  /* 版本:none 沒有、ok 是 v1、new 是更新版(唯讀)、bad 形狀不對(當成沒有;寫回時換成新的,只丟掉本來就讀不懂的東西) */
  function verOf(x) {
    if (x === null || x === undefined) return 'none';
    if (!isPlain(x)) return 'bad';
    if (Object.prototype.hasOwnProperty.call(x, 'v') && x.v !== 1) return 'new';
    return 'ok';
  }
  function readLocal(dp) {
    const get = (key) => { try { return dp.store.get(key, null); } catch (e) { return null; } };
    return { fa: get(KEYS.fa), placement: get(KEYS.placement), est: get(KEYS.est) };
  }
  async function readCloud(key, cloud) {
    if (!cloud || typeof cloud.readKey !== 'function') return { ok: false };
    try {
      const r = await cloud.readKey(key);
      return r && r.ok === true ? { ok: true, v: r.found ? r.v : null } : { ok: false };
    } catch (e) {
      return { ok: false };
    }
  }
  /* 雲端帳號才讀雲端;三個鍵一起讀 */
  async function readCloudAll(dp, keys) {
    if (modeOf(dp) !== 'account') return { ok: false };
    const rs = await Promise.all(keys.map((k) => readCloud(KEYS[k], dp.cloud)));
    const out = { ok: rs.every((r) => r.ok) };
    keys.forEach((k, i) => { out[k] = rs[i].ok ? rs[i].v : null; });
    return out;
  }
  /* 兩份合併;一份是更新版的格式時不合併(回 null:這個鍵不寫) */
  function mergeTwo(kind, a, b) {
    const E = est();
    const va = verOf(a), vb = verOf(b);
    if (va === 'new' || vb === 'new') return null;
    if (kind === 'est') return E.mergeEst(a, b);
    const fn = kind === 'fa' ? E.mergeFirstAttempts : E.mergePlacementRuns;
    return fn(va === 'ok' ? a : null, vb === 'ok' ? b : null);
  }

  /* ---------- 自填成績、做完的科 ---------- */
  const YM = /^(\d{4})-(\d{2})$/;
  function monthsSince(ym, nowMs) {
    const m = YM.exec(String(ym || ''));
    if (!m) return NaN;
    const d = new Date(nowMs);
    return (d.getFullYear() - Number(m[1])) * 12 + (d.getMonth() + 1 - Number(m[2]));
  }
  const okScore = (s) => Number.isInteger(s) && s >= 5 && s <= 495 && s % 5 === 0;
  function selfOf(selfScore, nowMs) {
    const out = {};
    if (!isPlain(selfScore) || !fin(nowMs)) return out;
    const months = monthsSince(selfScore.examYm, nowMs);
    if (!(months >= 0 && months <= 24)) return out;
    const fromTotal = selfScore.fromTotal === true;
    if (okScore(selfScore.listening)) out.L = { score: selfScore.listening, months, fromTotal };
    if (okScore(selfScore.reading)) out.R = { score: selfScore.reading, months, fromTotal };
    return out;
  }
  function runsOf(placement) {
    return isPlain(placement) && Array.isArray(placement.runs) ? placement.runs.filter((r) => isPlain(r) && typeof r.at === 'string') : [];
  }
  function sectionsDone(placement) {
    const done = { L: false, R: false };
    runsOf(placement).forEach((r) => {
      ['L', 'R'].forEach((s) => { const t = isPlain(r.tm) ? r.tm[s] : null; if (Array.isArray(t) && typeof t[1] === 'string' && t[1]) done[s] = true; });
    });
    return done;
  }

  /* ---------- 舊資料補回 ---------- */
  /* 課程前測(tests_v1):[[題 id, 小題, 選項, 對錯]];選項 -1 是沒作答,不寫。at 是秒 */
  function testRows(tests) {
    const E = est(), rows = [];
    if (!isPlain(tests)) return rows;
    Object.keys(tests).sort().forEach((t) => {
      const term = tests[t];
      if (!isPlain(term)) return;
      Object.keys(term).sort().forEach((kind) => {
        const x = term[kind];
        if (!isPlain(x) || !fin(x.at) || !Array.isArray(x.items)) return;
        const day = E.dayNum(x.at * 1000);
        x.items.forEach((it) => {
          if (!Array.isArray(it) || typeof it[0] !== 'string' || it[2] === -1) return;
          try {
            const part = E.partOfKey(it[0]);
            if (part) rows.push({ key: E.keyFromSub(part, it[0], it[1] || 0), day, ok: it[3] ? 1 : 0, src: 'k' });
          } catch (e) { /* 認不得的題略過 */ }
        });
      });
    });
    return rows;
  }
  function backfillSrc(dp) {
    const get = (key, d) => { try { const v = dp.store.get(key, d); return v === null || v === undefined ? d : v; } catch (e) { return d; } };
    const diag = get('diag', null), hist = get('hist', []), records = {};
    RECORD_KEYS.forEach((k) => { const v = get(k, null); if (isPlain(v)) records[k] = v; });
    const src = { rows: testRows(get('tests_v1', null)), hist: Array.isArray(hist) ? hist : [], records, now: dp.now };
    if (dp.legacy && isPlain(diag)) { src.diag = diag; src.legacy = dp.legacy; }
    return src;
  }
  function backfill(fa, dp) {
    const E = est();
    try {
      const src = backfillSrc(dp);
      return { fa: E.backfill(fa, src), stats: E.backfillStats(fa, src) };
    } catch (e) {
      return { fa: E.faNormalize(fa), stats: null };
    }
  }

  /* ---------- 算 ---------- */
  function compute(data, dp) {
    const E = est();
    const fa = E.faNormalize(data.fa);
    const at = new Date(dp.now).toISOString();
    const base = { ok: false, L: null, R: null, total: null, snapshot: null, n: 0, at, mode: modeOf(dp), fa, placement: data.placement };
    if (!dp.params) return base;
    try {
      const prev = verOf(data.est) === 'bad' ? null : data.est;
      const selfScore = dp.store.get('self_score', null);
      const v = E.display({ params: dp.params, fa, today: E.dayNum(dp.now), now: at, self: selfOf(selfScore, dp.now), done: sectionsDone(data.placement), prev });
      return Object.assign(base, { ok: true, L: v.L, R: v.R, total: v.total, snapshot: v.snapshot, n: v.L.n + v.R.n });
    } catch (e) {
      return base;
    }
  }
  /* 快照:數字、版本變了,或上一份不是今天的,才寫 */
  function snapChanged(prev, snap, dp) {
    if (!isPlain(prev) || typeof prev.at !== 'string') return true;
    if (prev.ip !== snap.ip || prev.cv !== snap.cv || J(prev.L) !== J(snap.L) || J(prev.R) !== J(snap.R)) return true;
    const t = Date.parse(prev.at);
    return !fin(t) || est().dayNum(t) !== est().dayNum(dp.now);
  }
  function put(dp, key, v) { dp.store.set(key, v); }
  /* fa 有變才寫;本機那份是更新版的格式就不寫 */
  function saveFa(dp, localRaw, fa) {
    if (!writable(dp) || verOf(localRaw) === 'new') return false;
    if (verOf(localRaw) === 'none' && !Object.keys(fa.i).length) return false;
    if (J(est().faNormalize(localRaw)) === J(fa) && verOf(localRaw) === 'ok') return false;
    put(dp, KEYS.fa, fa);
    return true;
  }
  function savePlacement(dp, localRaw, pl) {
    if (!writable(dp) || pl === null || verOf(localRaw) === 'new' || J(localRaw) === J(pl)) return false;
    put(dp, KEYS.placement, pl);
    return true;
  }
  function saveSnap(dp, prev, view) {
    if (!writable(dp) || !view.ok || verOf(prev) === 'new' || !snapChanged(prev, view.snapshot, dp)) return false;
    put(dp, KEYS.est, view.snapshot);
    return true;
  }

  /* data:{ fa, placement, est }(合併過的);localRaw:本機原本的三份 */
  function finish(dp, data, localRaw, write, cloudRead) {
    const b = backfill(data.fa, dp);
    const view = compute({ fa: b.fa, placement: data.placement, est: data.est }, dp);
    if (write) {
      saveFa(dp, localRaw.fa, b.fa);
      savePlacement(dp, localRaw.placement, data.placement);
      saveSnap(dp, data.est, view);
    }
    return Object.assign(view, { cloudRead: !!cloudRead, stats: b.stats });
  }
  function peek(deps) {
    const dp = depsOf(deps), local = readLocal(dp);
    return finish(dp, local, local, false, false);
  }
  function refresh(deps) {
    const dp = depsOf(deps), local = readLocal(dp);
    return finish(dp, local, local, true, false);
  }
  async function load(deps) {
    const dp = depsOf(deps), local = readLocal(dp);
    const c = await readCloudAll(dp, ['fa', 'placement', 'est']);
    if (!c.ok) return finish(dp, local, local, true, false);
    const merged = {
      fa: mergeTwo('fa', local.fa, c.fa),
      placement: mergeTwo('placement', local.placement, c.placement),
      est: mergeTwo('est', local.est, c.est),
    };
    const data = { fa: merged.fa === null ? local.fa : merged.fa, placement: merged.placement === null ? local.placement : merged.placement, est: merged.est };
    return finish(dp, data, local, true, true);
  }

  /* ---------- 第一次作答 ---------- */
  function addRows(fa, rows, day) {
    const E = est();
    let out = fa, n = 0;
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      if (!isPlain(r)) return;
      try {
        const next = E.faAdd(out, r.key, Number.isInteger(r.day) ? r.day : day, r.ok, r.src);
        if (next !== out) { out = next; n++; }
      } catch (e) { /* 格式不對的那一題不寫 */ }
    });
    return { fa: out, n };
  }
  function recordMany(rows, deps) {
    const dp = depsOf(deps);
    if (!writable(dp)) return 0;
    const raw = readLocal(dp).fa;
    if (verOf(raw) === 'new') return 0;
    const r = addRows(est().faNormalize(raw), rows, est().dayNum(dp.now));
    if (r.n) put(dp, KEYS.fa, r.fa);
    return r.n;
  }
  function recordFirst(key, ok, src, deps) { return recordMany([{ key, ok, src }], deps) === 1; }
  function seen(key, deps) {
    const raw = readLocal(depsOf(deps)).fa;
    return isPlain(raw) && isPlain(raw.i) && typeof key === 'string' && Object.prototype.hasOwnProperty.call(raw.i, key);
  }

  /* ---------- 檢測紀錄 ---------- */
  function lastActive(run) {
    const ts = [Date.parse(run.at)];
    if (isPlain(run.tm)) Object.keys(run.tm).forEach((s) => (Array.isArray(run.tm[s]) ? run.tm[s] : []).forEach((x) => ts.push(Date.parse(x))));
    return Math.max.apply(null, ts.filter(fin).concat([-Infinity]));
  }
  function runStatus(run, nowMs) {
    if (!isPlain(run)) return 'stale';
    if (typeof run.end === 'string' && run.end) return 'done';
    return nowMs - lastActive(run) < STALE_MS ? 'active' : 'stale';
  }
  function findRun(placement, at) { return runsOf(placement).filter((r) => r.at === at)[0] || null; }
  function activeRun(deps) {
    const dp = depsOf(deps);
    const runs = runsOf(readLocal(dp).placement).slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return runs.length && runStatus(runs[0], dp.now) === 'active' ? runs[0] : null;
  }
  /* 改本機的一次檢測(新物件寫回;只動這一次)。改不了(訪客、格式是更新版、找不到這次)回 null */
  function editRun(dp, at, fn) {
    if (!writable(dp)) return null;
    const raw = readLocal(dp).placement;
    if (verOf(raw) === 'new') return null;
    const pl = est().mergePlacementRuns(verOf(raw) === 'ok' ? raw : null, null);
    const cur = findRun(pl, at);
    if (!cur) return null;
    const next = fn(JSON.parse(J(cur)));
    put(dp, KEYS.placement, Object.assign({}, pl, { runs: pl.runs.map((r) => (r.at === at ? next : r)) }));
    return next;
  }
  const secOk = (s) => s === 'L' || s === 'R';
  async function startRun(opt, deps) {
    const dp = depsOf(deps), o = opt || {};
    if (['LR', 'L', 'R'].indexOf(o.sec) < 0) throw new TypeError('sec 要是 LR、L 或 R');
    if (!writable(dp)) return { run: null, fa: est().faNormalize(readLocal(dp).fa) };
    const local = readLocal(dp), c = await readCloudAll(dp, ['fa', 'placement']);
    const fa = c.ok ? mergeTwo('fa', local.fa, c.fa) : mergeTwo('fa', local.fa, null);
    const pl0 = c.ok ? mergeTwo('placement', local.placement, c.placement) : mergeTwo('placement', local.placement, null);
    if (fa !== null) saveFa(dp, local.fa, fa);
    if (pl0 === null) return { run: null, fa: fa || est().faNormalize(local.fa) };
    const at = typeof o.at === 'string' && o.at ? o.at : new Date(dp.now).toISOString();
    const p = dp.params || {};
    const run = { at, end: null, ip: p.ip || null, cv: p.cv || null, sec: o.sec, tm: {}, items: [], res: {} };
    const pl = est().mergePlacementRuns(pl0, { v: 1, runs: [run] });
    put(dp, KEYS.placement, pl);
    return { run: findRun(pl, at), fa: fa || est().faNormalize(local.fa) };
  }
  function beginSection(at, sec, deps) {
    if (!secOk(sec)) throw new TypeError('科要是 L 或 R');
    const dp = depsOf(deps), iso = new Date(dp.now).toISOString();
    return editRun(dp, at, (r) => {
      const tm = isPlain(r.tm) ? Object.assign({}, r.tm) : {};
      if (!Array.isArray(tm[sec])) tm[sec] = [iso, null];
      return Object.assign(r, { tm });
    });
  }
  function answer(at, rows, deps) {
    const dp = depsOf(deps);
    const list = (Array.isArray(rows) ? rows : []).filter((x) => isPlain(x) && secOk(x.s) && typeof x.key === 'string' && x.key && (x.ok === 1 || x.ok === 0));
    const run = editRun(dp, at, (r) => {
      const items = Array.isArray(r.items) ? r.items.slice() : [];
      list.forEach((x) => {
        if (items.some((it) => Array.isArray(it) && it[1] === x.key)) return;
        items.push([x.s, x.key, Number.isInteger(x.choice) ? x.choice : null, x.ok, fin(x.secs) ? Math.round(x.secs) : null]);
      });
      return Object.assign(r, { items });
    });
    if (run) recordMany(list.map((x) => ({ key: x.key, ok: x.ok, src: 't' })), deps);
    return run;
  }
  /* 這一科只用這一次作答加起點算的結果 */
  function runResult(dp, run, sec) {
    const E = est();
    if (!dp.params) return null;
    try {
      const day = E.dayNum(dp.now);
      const self = selfOf(dp.store.get('self_score', null), dp.now)[sec];
      const s = E.estimate(dp.params, sec, { fa: E.runFa(run, sec, day), today: day, self });
      return [s.est, s.lo, s.hi];
    } catch (e) {
      return null;
    }
  }
  function endSection(at, sec, deps) {
    if (!secOk(sec)) throw new TypeError('科要是 L 或 R');
    const dp = depsOf(deps), iso = new Date(dp.now).toISOString();
    return editRun(dp, at, (r) => {
      const tm = isPlain(r.tm) ? Object.assign({}, r.tm) : {};
      const t = Array.isArray(tm[sec]) ? tm[sec] : [iso, null];
      tm[sec] = [t[0], t[1] || iso];
      const res = Object.assign({}, isPlain(r.res) ? r.res : {});
      const out = runResult(dp, r, sec);
      if (out) res[sec] = out;
      return Object.assign(r, { tm, res });
    });
  }
  async function finishRun(at, deps) {
    const dp = depsOf(deps), iso = new Date(dp.now).toISOString();
    editRun(dp, at, (r) => Object.assign(r, { end: typeof r.end === 'string' && r.end ? r.end : iso }));
    return load(deps);
  }
  function excludeFor(at, deps) {
    const dp = depsOf(deps), local = readLocal(dp);
    const run = findRun(local.placement, at);
    const used = new Set();
    (run && Array.isArray(run.items) ? run.items : []).forEach((it) => {
      if (!Array.isArray(it) || typeof it[1] !== 'string') return;
      used.add(it[1]);
      used.add(it[1].split(':')[0]);
    });
    return { fa: est().faNormalize(local.fa), used: Array.from(used).sort() };
  }

  /* ---------- 建議改級 ---------- */
  const LEVEL_KEY = { L: 'listening', R: 'reading' };
  function suggestions(view, levels) {
    const E = est(), out = [];
    if (!isPlain(view) || !view.ok) return out;
    ['L', 'R'].forEach((sec) => {
      const v = view[sec];
      if (!v || !v.show || !Array.isArray(v.pb)) return;
      const cur = isPlain(levels) ? levels[LEVEL_KEY[sec]] : null;
      if (typeof cur !== 'string' || !cur) return;
      const lv = E.suggest(v, cur);
      if (lv) out.push({ sec, level: lv });
    });
    return out;
  }

  root.ESTIMATE_STORE = Object.freeze({
    KEYS, mode, peek, refresh, load, recordFirst, recordMany, seen,
    startRun, beginSection, answer, endSection, finishRun, activeRun, runStatus, excludeFor,
    sectionsDone, selfOf, suggestions,
  });
})(typeof window !== 'undefined' ? window : globalThis);
