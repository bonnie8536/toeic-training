/* 估分的純計算:作答機率、資訊量、網格後驗平均(EAP)、參考卷預期答對率、換算曲線、預估與範圍、四級、選題、顯示門檻與平滑。
   不碰畫面、不讀寫儲存、不用亂數與現在時間(種子、日數、時間都由呼叫的一方給)。
   載入順序:js/estimate-core.js → js/estimate-data.js(第一次作答紀錄的編碼、合併、舊資料補回;載入後把函式併進 ESTIMATE)。
   題目難度、換算曲線、參考卷都由參數傳入(格式同 data/item-params.js 的 ITEM_PARAMS):
     { ip, cv, curve: { L: [[答對率, 分數], …], R: […] }, ref: { 1: [b…], 2, 3, 4, 5, 6, '7s', '7m' }, b: { 題目 key: 難度 } }
   名詞:
     科 sec 是 'L'(聽力)或 'R'(閱讀);Part 是 '1'–'6'、'7'(或 '7s' 單篇、'7m' 多篇,只有參考卷分)。
     證據 evid 是 [{ b, c, x, w }]:難度、猜題下限、對錯(1/0)、權重。
     日數:從 2026-01-01(本地日期)起算的第幾天。 */
(function (root) {
  'use strict';

  const GRID = Object.freeze(Array.from({ length: 161 }, (_, g) => -4 + g * 0.05));
  const NG = GRID.length;
  const FORM = Object.freeze({ L: Object.freeze({ 1: 6, 2: 25, 3: 39, 4: 30 }), R: Object.freeze({ 5: 30, 6: 16, '7s': 29, '7m': 25 }) });
  const MEAN = Object.freeze({ L: 315, R: 265 });
  const CUT = Object.freeze({ L: Object.freeze([220, 320, 410]), R: Object.freeze([170, 270, 365]) });
  const LEVELS = Object.freeze(['entry', 'threshold', 'advanced', 'high']);
  const SYS = Object.freeze({ C: 35, P: 15, Q: 20 });
  const PRIOR_SD = 2.0;
  const SOURCES = 'tkglprhco';
  const WEIGHT = Object.freeze({ t: 1, k: 1, g: 1, p: 0.8, l: 0.8, r: 0.5, h: 0.7 });
  const PRACTICE = 'plrh';
  const GROUP_W = 0.75;
  const HALF_DAYS = 180;
  const HALF_ITEMS = 200;
  const SHOW_N = 20;
  const BIG = Object.freeze({ L: Object.freeze(['3', '4']), R: Object.freeze(['5', '7']) });
  const PARTS_OF = Object.freeze({ L: Object.freeze(['1', '2', '3', '4']), R: Object.freeze(['5', '6', '7']) });
  const SMOOTH = 10;
  const SUGGEST_P = 0.8;
  const SINGLE = { 1: true, 2: true, 5: true };

  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const fin = (x) => typeof x === 'number' && isFinite(x);
  const sig = (x) => 1 / (1 + Math.exp(-x));
  const round5 = (x) => Math.round(x / 5) * 5;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function need(ok, msg) { if (!ok) throw new TypeError(msg); }
  function secCheck(sec) { need(sec === 'L' || sec === 'R', '科要是 L 或 R:' + sec); return sec; }

  /* ---------- Part 與題目 key ---------- */
  function partNorm(part) {
    const p = String(part);
    need(/^([1-6]|7|7s|7m)$/.test(p), '認不得的 Part:' + part);
    return p;
  }
  function cOf(part) { return partNorm(part) === '2' ? 1 / 3 : 0.25; }
  function secOf(part) { return Number(partNorm(part)[0]) <= 4 ? 'L' : 'R'; }
  function isGroupPart(part) { return !SINGLE[partNorm(part)]; }
  /* 單題(P1、P2、P5):題目 id;題組:「組 id:」加小題的 num(P6 空格號),沒有 num 用 0 起算的位置 */
  function keyOf(part, setId, q, qi) {
    const p = partNorm(part);
    need(typeof setId === 'string' && setId !== '', '題目 id 要是字串');
    if (SINGLE[p]) return setId;
    if (q && q.num !== undefined && q.num !== null) return setId + ':' + q.num;
    need(Number.isInteger(qi) && qi >= 0, '題組小題的位置要是 0 以上的整數');
    return setId + ':' + qi;
  }
  /* 課程進度的小題號:單題 0 或空;P6 是空格號;其他題組 1 起算 */
  function keyFromSub(part, setId, sub) {
    const p = partNorm(part);
    if (SINGLE[p]) return keyOf(p, setId, null, 0);
    need(Number.isInteger(sub) && sub >= 1, '題組的小題號要是 1 以上的整數');
    return p === '6' ? keyOf(p, setId, { num: sub }, 0) : keyOf(p, setId, null, sub - 1);
  }
  /* key 的前綴:l1–l4 聽力、p5–p7 刷題、d5–d7 舊檢測;認不得回 null */
  function partOfKey(key) {
    const m = /^([lpd])([1-7])[-:]/.exec(String(key || ''));
    if (!m) return null;
    const n = Number(m[2]);
    if (m[1] === 'l' ? n > 4 : n < 5) return null;
    return String(n);
  }

  /* ---------- 作答模型 ---------- */
  function prob(theta, b, c) {
    need(fin(theta), '能力值要是數字');
    need(fin(b), '難度要是數字');
    need(fin(c) && c >= 0 && c < 1, '猜題下限要在 0 到 1 之間');
    return c + (1 - c) * sig(theta - b);
  }
  function info(theta, b, c) {
    const p = prob(theta, b, c), q = (p - c) / (1 - c);
    return q * q * (1 - p) / p;
  }
  function delta(c) { return Math.log((1 + Math.sqrt(1 + 8 * c)) / 2); }

  /* ---------- 換算曲線 ---------- */
  function checkCurve(pts) {
    need(Array.isArray(pts) && pts.length >= 2, '分數曲線至少要兩個點');
    need(pts.every((p) => Array.isArray(p) && fin(p[0]) && fin(p[1])), '分數曲線的點要是 [答對率，分數]');
    need(pts[0][0] === 0, '分數曲線要從答對率 0 開始');
    for (let i = 1; i < pts.length; i++) {
      need(pts[i][0] > pts[i - 1][0] && pts[i][0] <= 1, '分數曲線的答對率要遞增、不超過 1');
      need(pts[i][1] >= pts[i - 1][1], '分數曲線的分數不能變小');
    }
    return pts;
  }
  /* 分段直線內插;最後一點以後照最後一點 */
  function scoreOf(pts, e) {
    need(fin(e), '答對率要是數字');
    need(Array.isArray(pts) && pts.length >= 2, '分數曲線至少要兩個點');
    if (e <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (e <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        return y0 + (y1 - y0) * (e - x0) / (x1 - x0);
      }
    }
    return pts[pts.length - 1][1];
  }
  function checkParams(params) {
    need(isPlain(params) && isPlain(params.curve) && isPlain(params.ref) && isPlain(params.b), '題目參數要有 curve、ref、b');
    ['L', 'R'].forEach((sec) => {
      checkCurve(params.curve[sec]);
      Object.keys(FORM[sec]).forEach((p) => {
        const r = params.ref[p];
        need(Array.isArray(r) && r.length > 0 && r.every(fin), '題目參數的參考卷缺 Part ' + p);
      });
    });
    return params;
  }
  /* 參考卷預期答對率:各 Part 依正式考題數加權,Part 內是參考卷那些難度的平均答對機率 */
  function expected(params, sec, theta) {
    checkParams(params); secCheck(sec);
    let s = 0;
    Object.keys(FORM[sec]).forEach((p) => {
      const r = params.ref[p], c = cOf(p);
      s += FORM[sec][p] / 100 * r.reduce((a, b) => a + prob(theta, b, c), 0) / r.length;
    });
    return s;
  }
  /* 每一格的分數;同一份參數只算一次 */
  const gridCache = new WeakMap();
  function scoreGrid(params, sec) {
    secCheck(sec);
    let c = gridCache.get(params);
    if (!c) { c = {}; gridCache.set(params, c); }
    if (!c[sec]) c[sec] = Object.freeze(GRID.map((t) => scoreOf(params.curve[sec], expected(params, sec, t))));
    return c[sec];
  }
  function gridOfScore(params, sec, score) {
    const S = scoreGrid(params, sec);
    let best = 0, d = Infinity;
    S.forEach((v, i) => { const dd = Math.abs(v - score); if (dd < d) { d = dd; best = i; } });
    return best;
  }
  /* 分數 → 能力:每格分數最接近的那一格(一樣近取較低的格) */
  function thetaOfScore(params, sec, score) {
    need(fin(score), '分數要是數字');
    return GRID[gridOfScore(params, sec, score)];
  }

  /* ---------- 先驗 ---------- */
  function validScore(s) { return Number.isInteger(s) && s >= 5 && s <= 495 && s % 5 === 0; }
  /* self = { score, months, fromTotal }:24 個月內的自填成績;沒有或太舊用平均分數、寬 2.0 */
  function prior(params, sec, self) {
    checkParams(params); secCheck(sec);
    const usable = isPlain(self) && fin(self.months) && self.months >= 0 && self.months <= 24;
    if (!usable) return { mu: thetaOfScore(params, sec, MEAN[sec]), sd: PRIOR_SD };
    need(validScore(self.score), '自填分數要是 5–495 的 5 的倍數');
    const S = scoreGrid(params, sec), g = gridOfScore(params, sec, self.score);
    const lo = Math.max(0, g - 1), hi = Math.min(NG - 1, g + 1);
    const slope = (S[hi] - S[lo]) / (GRID[hi] - GRID[lo]);
    const s = Math.sqrt(Math.pow(self.fromTotal ? 50 : 35, 2) + Math.pow(15 * self.months / 6, 2));
    return { mu: GRID[g], sd: slope > 0 ? Math.min(PRIOR_SD, s / slope) : PRIOR_SD };
  }

  /* ---------- 後驗 ---------- */
  function logPost(pri, evid) {
    need(isPlain(pri) && fin(pri.mu) && fin(pri.sd) && pri.sd > 0, '先驗要有 mu 與大於 0 的 sd');
    need(Array.isArray(evid), '證據要是陣列');
    const lp = new Float64Array(NG);
    for (let g = 0; g < NG; g++) lp[g] = -Math.pow(GRID[g] - pri.mu, 2) / (2 * pri.sd * pri.sd);
    evid.forEach((e) => {
      need(isPlain(e) && (e.x === 0 || e.x === 1 || e.x === true || e.x === false), '證據的對錯要是 0 或 1');
      need(fin(e.w) && e.w >= 0, '證據的權重要是 0 以上的數字');
      if (!e.w) return;
      for (let g = 0; g < NG; g++) {
        const p = prob(GRID[g], e.b, e.c);
        lp[g] += e.w * (e.x ? Math.log(p) : Math.log(1 - p));
      }
    });
    return lp;
  }
  function weightsOf(lp) {
    need(lp && lp.length === NG, '後驗要有 ' + NG + ' 格');
    let mx = -Infinity;
    for (let g = 0; g < NG; g++) if (lp[g] > mx) mx = lp[g];
    need(fin(mx), '後驗算不出來');
    const pi = new Float64Array(NG);
    let z = 0;
    for (let g = 0; g < NG; g++) { pi[g] = Math.exp(lp[g] - mx); z += pi[g]; }
    for (let g = 0; g < NG; g++) pi[g] /= z;
    return pi;
  }
  function sysErr(f, sys) {
    const s = sys || SYS;
    return Math.sqrt(s.C * s.C + s.P * s.P + Math.pow(s.Q * (f || 0), 2));
  }
  function bandOf(sec, score) {
    const cut = CUT[secCheck(sec)];
    if (score <= cut[0]) return LEVELS[0];
    if (score <= cut[1]) return LEVELS[1];
    if (score <= cut[2]) return LEVELS[2];
    return LEVELS[3];
  }
  /* 後驗 → 能力平均、預估(5 的倍數)、隨機與系統誤差、半寬、範圍、各級機率(每格分數先取 5 的倍數再對級) */
  function summarize(params, sec, lp, f, opt) {
    secCheck(sec);
    const S = scoreGrid(checkParams(params), sec), pi = weightsOf(lp);
    let mt = 0, ms = 0, ms2 = 0;
    const pb = [0, 0, 0, 0];
    for (let g = 0; g < NG; g++) {
      mt += pi[g] * GRID[g]; ms += pi[g] * S[g]; ms2 += pi[g] * S[g] * S[g];
      pb[LEVELS.indexOf(bandOf(sec, round5(S[g])))] += pi[g];
    }
    const srand = Math.sqrt(Math.max(0, ms2 - ms * ms));
    const sys = sysErr(f, opt && opt.sys);
    const est = clamp(round5(ms), 5, 495);
    const h = Math.max(25, round5(Math.sqrt(srand * srand + sys * sys)));
    return { theta: mt, mean: ms, est, srand, sys, h, lo: clamp(est - h, 5, 495), hi: clamp(est + h, 5, 495), pb, band: bandOf(sec, est) };
  }
  /* 總分:隨機項平方和、系統項直接相加 */
  function total(l, r) {
    need(isPlain(l) && isPlain(r) && fin(l.est) && fin(r.est), '兩科都要有預估');
    const est = l.est + r.est;
    const h = Math.max(35, round5(Math.sqrt(l.srand * l.srand + r.srand * r.srand + Math.pow(l.sys + r.sys, 2))));
    return { est, h, lo: clamp(est - h, 10, 990), hi: clamp(est + h, 10, 990) };
  }
  /* 兩端:低於 150 只寫「150 以下」;450 以上寫「450 以上」;其他照範圍(上緣已夾在 495) */
  function ends(s) {
    const kind = s.est < 150 ? 'low' : s.est >= 450 ? 'high' : 'num';
    return { kind, est: s.est, lo: clamp(s.lo, 5, 495), hi: clamp(s.hi, 5, 495) };
  }
  /* 建議改級:另一級的後驗機率 ≥0.8 */
  function suggest(sum, current) {
    need(isPlain(sum) && Array.isArray(sum.pb), '要有各級機率');
    const k = sum.pb.findIndex((p) => p >= SUGGEST_P);
    return k > -1 && LEVELS[k] !== current ? LEVELS[k] : null;
  }

  /* ---------- 衰減與證據 ---------- */
  function decay(days, after) {
    need(fin(days) && days >= 0, '距今天數要是 0 以上');
    need(fin(after) && after >= 0, '之後的題數要是 0 以上');
    return Math.pow(0.5, days / HALF_DAYS) * Math.pow(0.5, after / HALF_ITEMS);
  }
  const srcRank = (s) => SOURCES.indexOf(s);
  function entriesOf(fa) {
    need(isPlain(fa) && isPlain(fa.i), '第一次作答紀錄要是 { v, i }');
    return Object.keys(fa.i).map((key) => ({ key, day: fa.i[key][0], ok: fa.i[key][1], src: fa.i[key][2] }));
  }
  function order(a, b) {
    return (a.day - b.day) || (srcRank(a.src) - srcRank(b.src)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  }
  /* 一科的證據:計分的作答照日數、來源、key 排,權重 = 來源 × 題組 × 衰減;回傳 list、計分題數 n、各 Part 題數、練習權重比例 f、查不到難度的 key */
  function evidence(params, fa, sec, today, opt) {
    checkParams(params); secCheck(sec);
    need(Number.isInteger(today), '今天的日數要是整數');
    const allow = (opt && opt.sources) || 'tkglprh';
    const missing = [], rows = [];
    entriesOf(fa).forEach((e) => {
      const part = partOfKey(e.key);
      if (!part || secOf(part) !== sec) return;
      if (!fin(params.b[e.key])) { missing.push(e.key); return; }
      if ((e.ok === 0 || e.ok === 1) && WEIGHT[e.src] && allow.indexOf(e.src) > -1) rows.push(Object.assign({ part }, e));
    });
    rows.sort(order);
    const parts = {};
    let wp = 0, wa = 0;
    const list = rows.map((e, i) => {
      const w = WEIGHT[e.src] * (isGroupPart(e.part) ? GROUP_W : 1) * decay(Math.max(0, today - e.day), rows.length - 1 - i);
      parts[e.part] = (parts[e.part] || 0) + 1;
      wa += w; if (PRACTICE.indexOf(e.src) > -1) wp += w;
      return { key: e.key, b: params.b[e.key], c: cOf(e.part), x: e.ok, w, src: e.src, day: e.day };
    });
    return { list, n: list.length, parts, f: wa ? wp / wa : 0, missing: missing.sort() };
  }
  /* 一科的估計:先驗 + 證據 */
  function estimate(params, sec, ctx) {
    const c = ctx || {};
    const ev = evidence(params, c.fa, sec, c.today, c);
    const sum = summarize(params, sec, logPost(prior(params, sec, c.self), ev.list), ev.f, c);
    return Object.assign(sum, { n: ev.n, parts: ev.parts, f: ev.f, missing: ev.missing });
  }

  /* ---------- 顯示門檻 ---------- */
  function partsOk(sec, parts) {
    const ps = PARTS_OF[sec];
    const twoParts = ps.filter((p) => (parts[p] || 0) >= 4).length >= 2;
    return twoParts || BIG[sec].some((p) => (parts[p] || 0) >= 8);
  }
  /* parts:這一科各 Part 計分題數(7s、7m 都算 7);flags:{ done 做完這一科檢測, self 有效自填成績 } */
  function enough(sec, partsIn, flags) {
    secCheck(sec);
    const parts = {};
    Object.keys(partsIn || {}).forEach((p) => { const k = p[0]; parts[k] = (parts[k] || 0) + partsIn[p]; });
    const f = flags || {};
    if (f.done || f.self) return { show: true, need: 0, kind: null };
    const n = Object.keys(parts).reduce((a, p) => a + parts[p], 0);
    if (n < SHOW_N) return { show: false, need: SHOW_N - n, kind: 'any' };
    if (partsOk(sec, parts)) return { show: true, need: 0, kind: null };
    let best = Infinity;
    BIG[sec].forEach((p) => {
      for (let k = 1; k <= 8 && k < best; k++) {
        if (partsOk(sec, Object.assign({}, parts, { [p]: (parts[p] || 0) + k }))) best = k;
      }
    });
    return { show: false, need: best, kind: 'big' };
  }

  /* ---------- 選題 ---------- */
  /* 字串雜湊(FNV-1a)與種子亂數(mulberry32):同樣的字串一定得到同樣的數列 */
  function hashStr(s) {
    let h = 2166136261;
    const str = String(s);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seeded(s) {
    let a = hashStr(s);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function startTheta(mean, first) { need(fin(mean), '能力值要是數字'); return first ? mean - 0.5 : mean; }
  function unitInfo(params, u, theta) {
    const c = cOf(u.part);
    return u.keys.reduce((a, k) => a + info(theta, params.b[k], c), 0);
  }
  /* 依資訊量由大到小;同分照 hash(種子|題 id) */
  function rankUnits(o) {
    need(isPlain(o) && Array.isArray(o.units), '要有候選題');
    need(typeof o.seed === 'string' && o.seed !== '', '種子要是非空字串');
    return o.units
      .map((u) => ({ u, s: unitInfo(o.params, u, o.theta), h: hashStr(o.seed + '|' + u.id) }))
      .sort((a, b) => (b.s - a.s) || (a.h - b.h))
      .map((x) => x.u);
  }
  /* 單題從前 5 題、題組從前 3 組挑一個;亂數用 種子|開始時間|第幾格,重整頁面挑到同一題 */
  function pickUnit(o) {
    const ranked = rankUnits(o);
    need(ranked.length > 0, '這一格沒有可出的題');
    const k = Math.min(isGroupPart(ranked[0].part) ? 3 : 5, ranked.length);
    const rnd = seeded(o.seed + '|' + o.runAt + '|' + o.slot);
    return ranked[Math.floor(rnd() * k)];
  }
  /* 可出的題,照順序排除:不在難度表、第一次作答紀錄有(含看過)、這次出過、課程預留(開關 reserveOn) */
  function available(o) {
    need(isPlain(o) && Array.isArray(o.units), '要有題目清單');
    const part = partNorm(o.part);
    const fa = (o.fa && o.fa.i) || {};
    const used = new Set(o.used || []), reserve = new Set(o.reserveOn ? o.reserve || [] : []);
    return o.units.filter((u) => u.part === part
      && (!o.size || u.keys.length === o.size)
      && u.keys.length > 0
      && u.keys.every((k) => fin(o.params.b[k]))
      && !u.keys.some((k) => fa[k])
      && !used.has(u.id) && !u.keys.some((k) => used.has(k))
      && !reserve.has(u.id));
  }
  /* 開始前數好每格有沒有題:同一個 Part 的第 n 格要有 n 個可出的題,沒有就跳過;total 是小題數 */
  function planSlots(script, availFn) {
    need(Array.isArray(script) && typeof availFn === 'function', '要有題型腳本與取題函式');
    const used = {}, slots = [];
    let totalN = 0;
    script.forEach((s, index) => {
      const key = s.part + '|' + (s.size || '');
      const pool = availFn(s.part, s);
      const k = used[key] || 0;
      if (pool.length <= k) return;
      used[key] = k + 1;
      totalN += s.size || pool[k].keys.length;
      slots.push(Object.assign({ index }, s));
    });
    return { slots, total: totalN };
  }

  /* ---------- 顯示 ---------- */
  function smooth(raw, prev, params, sec) {
    const p = isPlain(prev) && prev.ip === params.ip && prev.cv === params.cv && Array.isArray(prev[sec]) ? prev[sec][0] : null;
    return fin(p) && Math.abs(raw.est - p) < SMOOTH ? p : raw.est;
  }
  function sectionView(acc, sec) {
    const self = acc.self && acc.self[sec];
    const s = estimate(acc.params, sec, { fa: acc.fa, today: acc.today, self, sources: acc.sources });
    const selfOk = isPlain(self) && fin(self.months) && self.months >= 0 && self.months <= 24;
    const gate = enough(sec, s.parts, { done: !!(acc.done && acc.done[sec]), self: selfOk });
    const est = smooth(s, acc.prev, acc.params, sec);
    const shown = ends({ est, lo: est - s.h, hi: est + s.h });
    return {
      show: gate.show, need: gate.show ? null : { n: gate.need, kind: gate.kind }, n: s.n,
      raw: { est: s.est, lo: s.lo, hi: s.hi }, est, lo: shown.lo, hi: shown.hi, h: s.h, kind: shown.kind,
      band: s.band, pb: s.pb, srand: s.srand, sys: s.sys, theta: s.theta, missing: s.missing,
    };
  }
  /* 全站唯一的顯示函式。acc = { params, fa, today(日數), now(存快照用的時間字串), self: { L, R }, done: { L, R }, prev(上次的快照), sources }
     回傳 { L, R, total, snapshot }:四級用新算的數字;顯示的數字差不到 10 分沿用上次;範圍以顯示的數字為中心 */
  function display(acc) {
    need(isPlain(acc), '要有估分資料');
    need(Number.isInteger(acc.today), '今天的日數要是整數');
    const L = sectionView(acc, 'L'), R = sectionView(acc, 'R');
    const both = L.show && R.show && L.kind === 'num' && R.kind === 'num';
    const tot = both ? total(L, R) : null;
    const snap = (v) => (v.show ? [v.est, v.lo, v.hi, v.n] : null);
    return { L, R, total: tot, snapshot: { ip: acc.params.ip, cv: acc.params.cv, at: acc.now, L: snap(L), R: snap(R) } };
  }

  root.ESTIMATE = Object.freeze({
    GRID, FORM, MEAN, CUT, LEVELS, SYS, SOURCES, WEIGHT, GROUP_W, HALF_DAYS, HALF_ITEMS,
    cOf, secOf, isGroupPart, keyOf, keyFromSub, partOfKey,
    prob, info, delta, checkCurve, scoreOf, checkParams, expected, scoreGrid, thetaOfScore,
    prior, logPost, sysErr, bandOf, summarize, total, ends, suggest,
    decay, evidence, estimate, enough,
    hashStr, seeded, startTheta, rankUnits, pickUnit, available, planSlots,
    display,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
