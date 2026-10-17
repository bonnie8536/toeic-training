/* 小雞的純計算(路線圖 1.2a)。不碰畫面、不讀寫任何儲存鍵:呼叫的人把 hist 與 pet 傳進來,自己決定要不要存。
   測試:node tools/test_pet.js。目前沒有頁面載入這個檔。
   - 有效題數:同一題(模組加題號)同一天只算一次;跟上一筆相隔不到 2 秒的不算;
     交卷時用迴圈一次寫很多筆(時間只差幾毫秒)算同一批,整批跟前一筆比;單字考題用 n、翻牌配對用配對數(最多 50)。
   - 跨日一律看台北時間(UTC+8,沒有日光節約),不看裝置時區。
   - pet 只存發生過的事實(每天題數、達標日、目標歷史、餵了幾顆、名字),連續天數、保護卡、成長階段每次重算。
     合併逐日取大、達標日取聯集,兩台裝置怎麼互蓋都不會倒退。
   - 日期比今天晚 7 天以內的先留著、不算進任何數字(時鐘慢的裝置不會刪掉別台的新進度);更晚的丟掉(時鐘被調快不留永久的錯)。
   - 壞掉的欄位一個一個救;整個救不回或版本比 1 新就唯讀,不寫回。
   - 第二階段的格式(v: 2)看得懂舊欄位、照常顯示,但唯讀;feed、setGoal、rename、merge 拿到它或救不回的直接丟錯。
     這一版從不寫出 v2 或任何新欄位(第二階段規格 5.3 第 1 步)。 */
'use strict';
globalThis.PET = (function () {
  const V = 1;
  const DAY = 864e5;
  const TZ_MS = 8 * 3600e3;
  const GAP_MS = 2000;      // 跟上一筆相隔不到這麼久不算
  const BATCH_MS = 50;      // 程式迴圈一次寫的多筆,時間差在這以內算同一批
  const MAX_N = 50;         // 一筆紀錄最多代表幾題
  const MAX_DAY = 10000;    // 一天的題數上限(擋壞掉的值)
  const KEEP_DAYS = 400;    // days 與 met 留幾天
  const KEEP_FED = 7;       // fed 留幾天
  const AHEAD = 7;          // 比今天晚 7 天以內的日期先留著不算(時鐘慢的裝置不會刪掉別台的新進度),更晚的丟掉
  const KEEP_GOALS = 20;
  const GOALS = [10, 20, 40];
  const DEFAULT_GOAL = 20;
  const NAME_MAX = 10;
  const MAX_SHIELDS = 2;
  const SHIELD_EVERY = 7;
  const STAGES = [0, 1, 3, 7, 14, 21, 30];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* ---------- 日期 ---------- */
  function dateOf(t) { return new Date(t + TZ_MS).toISOString().slice(0, 10); }
  function hourOf(t) { return new Date(t + TZ_MS).getUTCHours(); }
  function isSleeping(t) { const h = hourOf(t); return h >= 23 || h < 7; }
  function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
  function isDate(d) {
    if (typeof d !== 'string' || !DATE_RE.test(d)) return false;
    const t = Date.parse(d + 'T00:00:00Z');
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  }
  function isTime(t) { return typeof t === 'number' && isFinite(t) && t > 0 && t < 8.6e15; }
  /* now 壞掉(NaN、undefined)就用現在時間,不丟錯 */
  function todayOf(now) { return dateOf(isTime(now) ? now : Date.now()); }

  /* ---------- 有效題數 ---------- */
  function weightOf(r) {
    let n = 1;
    if (r.n !== undefined) n = r.n;
    else if (r.g === 'pairs' && typeof r.q === 'string') {
      const m = r.q.match(/(\d+)\s*對\s*$/);
      if (m) n = +m[1];
    }
    n = Math.floor(Number(n));
    if (!isFinite(n) || n < 1) return 1;
    return Math.min(n, MAX_N);
  }
  function keyOf(r) {
    /* 翻牌配對每一局的 id 都是 'pairs',用牌組說明(名稱加對數)區分 */
    if (r.g === 'pairs') return r.m + '|pairs|' + r.q;
    return r.m + '|' + r.id;
  }
  function countHist(hist) {
    const out = {};
    if (!Array.isArray(hist)) return out;
    const recs = hist.filter(r => r && typeof r === 'object' && isTime(r.t) && r.m !== undefined && r.id !== undefined)
      .slice().sort((a, b) => a.t - b.t);
    const seen = {};
    let prevT = -Infinity;      // 上一筆的時間
    let batchOk = false;
    for (const r of recs) {
      if (r.t - prevT >= BATCH_MS) { // 新的一批:跟上一筆夠遠才算
        batchOk = r.t - prevT >= GAP_MS;
      }
      prevT = r.t;
      if (!batchOk) continue;
      const d = dateOf(r.t);
      const k = d + '|' + keyOf(r);
      if (seen[k]) continue;
      seen[k] = true;
      out[d] = Math.min(MAX_DAY, (out[d] || 0) + weightOf(r));
    }
    return out;
  }

  /* ---------- 整理(救壞掉的欄位) ---------- */
  function empty() { return { v: V, born: '', goals: [], days: {}, met: [], oldMet: 0, oldBefore: '', fed: {}, name: '', nameAt: 0 }; }
  function isPlain(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  /* 第二階段的格式(v2):第一階段的欄位原樣,加上食物與走動開關。這一版看得懂第一階段那些欄位,
     照常顯示,但整份唯讀、一筆都不寫(不寫回本機、不上傳、不把它整理成 v1 寫出去);新欄位不看也不帶出去 */
  const V_NEXT = 2;
  /* 剛好是 v2 才算;v3、1.5 這些不認得的版本不算(規格 5.3:跟現在一樣)。pet-store 用它決定畫面要不要說「新版網頁存的」 */
  function isNext(raw) { return isPlain(raw) && raw.v === V_NEXT; }
  /* 救不回:不是物件、或版本比 1 新又不是 2 */
  function unusable(raw) {
    if (raw === null || raw === undefined) return false;
    if (!isPlain(raw)) return true;
    return typeof raw.v === 'number' && raw.v > V && raw.v !== V_NEXT;
  }
  /* 會產生要寫出去的那份的函式(feed、setGoal、rename、merge)拿到 v2 或救不回的,直接丟錯,不回傳任何 pet */
  function writable(raw) {
    if (unusable(raw) || isNext(raw)) throw new Error('這份小雞資料是較新的版本或讀不懂,這一版不改它');
  }
  function cleanCount(x, max) {
    if (typeof x !== 'number' || !isFinite(x)) return 0;
    return Math.max(0, Math.min(max, Math.floor(x)));
  }
  function cleanDays(o, today, keepFrom) {
    const out = {};
    if (!isPlain(o)) return out;
    Object.keys(o).forEach(d => {
      if (!isDate(d) || d > addDays(today, AHEAD) || (keepFrom && d < keepFrom)) return;
      const n = cleanCount(o[d], MAX_DAY);
      if (n > 0) out[d] = n;
    });
    return out;
  }
  function sortedKeys(o) { const s = {}; Object.keys(o).sort().forEach(k => { s[k] = o[k]; }); return s; }

  function sanitizeObj(raw, today) {
    const p = empty();
    if (!isPlain(raw)) return p;
    if (isDate(raw.born) && raw.born <= addDays(today, AHEAD)) p.born = raw.born;
    if (Array.isArray(raw.goals)) {
      raw.goals.forEach(g => {
        if (isPlain(g) && isDate(g.from) && GOALS.includes(g.n)) p.goals.push({ from: g.from, n: g.n, at: cleanCount(g.at, 9e15) });
      });
    }
    p.goals = dedupeGoals(p.goals);
    if (typeof raw.oldMet === 'number' && isDate(raw.oldBefore) && raw.oldBefore <= addDays(today, AHEAD)) {
      p.oldMet = cleanCount(raw.oldMet, 1e6);
      p.oldBefore = raw.oldBefore;
    }
    p.days = cleanDays(raw.days, today, p.oldBefore);
    if (Array.isArray(raw.met)) {
      p.met = [...new Set(raw.met.filter(d => isDate(d) && d <= addDays(today, AHEAD) && !(p.oldBefore && d < p.oldBefore)))].sort();
    }
    p.fed = cleanDays(raw.fed, today, addDays(today, -(KEEP_FED - 1)));
    if (typeof raw.name === 'string') p.name = Array.from(raw.name.trim()).slice(0, NAME_MAX).join('');
    if (p.name) p.nameAt = cleanCount(raw.nameAt, 9e15);
    return trim(p, today);
  }
  function sanitize(raw, now) {
    const today = todayOf(now);
    if (unusable(raw)) return { pet: empty(), readOnly: true };
    if (isNext(raw)) return { pet: markNext(sanitizeObj(raw, today)), readOnly: true };
    return { pet: sanitizeObj(raw, today), readOnly: false };
  }
  /* 顯示用的那份保留 v:2,不會變成看起來可以寫的 v1 */
  function markNext(p) { p.v = V_NEXT; return p; }

  /* 同一天開始的目標只留一筆:後改的(at 大)贏,同時改的取大的,結果跟順序無關 */
  function dedupeGoals(list) {
    const by = {};
    list.forEach(g => {
      const o = by[g.from];
      if (!o || g.at > o.at || (g.at === o.at && g.n > o.n)) by[g.from] = g;
    });
    return Object.keys(by).sort().map(k => by[k]).slice(-KEEP_GOALS);
  }

  /* 只留最近 400 天:移出的達標天數加進 oldMet */
  function trim(p, today) {
    const cutoff = addDays(today, -(KEEP_DAYS - 1));
    if (p.oldBefore && p.oldBefore >= cutoff) return p;
    const moved = p.met.filter(d => d < cutoff).length;
    const anyOld = moved || Object.keys(p.days).some(d => d < cutoff);
    if (!anyOld) return p;
    p.oldMet += moved;
    p.oldBefore = cutoff;
    p.met = p.met.filter(d => d >= cutoff);
    Object.keys(p.days).forEach(d => { if (d < cutoff) delete p.days[d]; });
    return p;
  }

  /* ---------- 合併 ---------- */
  function mergeClean(a, b, today) {
    const p = empty();
    /* oldMet 與 oldBefore 成對取:移出得比較晚的那組;一樣晚取大的 */
    const pair = (a.oldBefore > b.oldBefore || (a.oldBefore === b.oldBefore && a.oldMet >= b.oldMet)) ? a : b;
    p.oldMet = pair.oldMet;
    p.oldBefore = pair.oldBefore;
    const keep = d => !(p.oldBefore && d < p.oldBefore);
    [a.days, b.days].forEach(o => Object.keys(o).forEach(d => { if (keep(d)) p.days[d] = Math.max(p.days[d] || 0, o[d]); }));
    p.days = sortedKeys(p.days);
    p.met = [...new Set(a.met.concat(b.met).filter(keep))].sort();
    [a.fed, b.fed].forEach(o => Object.keys(o).forEach(d => { p.fed[d] = Math.max(p.fed[d] || 0, o[d]); }));
    p.fed = sortedKeys(p.fed);
    p.goals = dedupeGoals(a.goals.concat(b.goals));
    p.born = [a.born, b.born].filter(Boolean).sort()[0] || '';
    /* 名字:後取的贏;同時取的照字串排序,結果跟順序無關 */
    const names = [a, b].filter(x => x.name).sort((x, y) => (y.nameAt - x.nameAt) || (x.name < y.name ? 1 : x.name > y.name ? -1 : 0));
    if (names.length) { p.name = names[0].name; p.nameAt = names[0].nameAt; }
    return trim(p, today);
  }
  function merge(a, b, now) {
    writable(a); writable(b);
    const today = todayOf(now);
    return mergeClean(sanitizeObj(a, today), sanitizeObj(b, today), today);
  }

  /* ---------- 目標 ---------- */
  function goalOn(p, d) {
    let n = DEFAULT_GOAL;
    (p.goals || []).forEach(g => { if (g.from <= d) n = g.n; });
    return n;
  }
  function setGoal(pet, n, now) {
    if (!GOALS.includes(n)) throw new Error('目標只能是 ' + GOALS.join('、'));
    writable(pet);
    const today = todayOf(now);
    const p = sanitizeObj(pet, today);
    const from = addDays(today, 1);
    p.goals = dedupeGoals(p.goals.filter(g => g.from < from).concat([{ from, n, at: Math.floor(now) }]));
    return p;
  }
  function rename(pet, name, now) {
    writable(pet);
    const today = todayOf(now);
    const p = sanitizeObj(pet, today);
    p.name = Array.from(String(name || '').trim()).slice(0, NAME_MAX).join('');
    p.nameAt = p.name ? Math.floor(now) : 0;
    return p;
  }

  /* ---------- 從 hist 補進來,重算達標日 ---------- */
  function absorb(p, hist, today) {
    const counts = countHist(hist);
    Object.keys(counts).forEach(d => {
      if (d > today || d < addDays(today, -(KEEP_DAYS - 1)) || (p.oldBefore && d < p.oldBefore)) return;
      p.days[d] = Math.max(p.days[d] || 0, counts[d]);
    });
    p.days = sortedKeys(p.days);
    const met = new Set(p.met);
    Object.keys(p.days).forEach(d => { if (p.days[d] >= goalOn(p, d)) met.add(d); });
    p.met = [...met].sort();
    if (!p.born) p.born = today;
    return trim(p, today);
  }

  /* 打開小雞時呼叫:本機那份、雲端那份(沒有就 null)、hist,回傳要顯示的 pet 與要不要寫回。
     readOnly:有一份救不回或是新版格式,這次只顯示不寫,也不動雲端那份。
     有一份是 v2:兩邊認得的欄位合併起來顯示(那份保留 v:2),一樣唯讀;救不回的那份當成空的。
     changed:結果跟本機存的不一樣(要寫回本機);remoteBehind:結果跟雲端那份不一樣(要上傳)。 */
  function reconcile(o) {
    const today = todayOf(o.now);
    const next = isNext(o.local) || isNext(o.remote);
    const readOnly = next || unusable(o.local) || unusable(o.remote);
    const local = unusable(o.local) ? empty() : sanitizeObj(o.local, today);
    const remote = unusable(o.remote) ? empty() : sanitizeObj(o.remote, today);
    const pet = absorb(mergeClean(local, remote, today), o.hist, today);
    if (next) markNext(pet);
    if (readOnly) return { pet, readOnly: true, changed: false, remoteBehind: false };
    const c = canon(pet);
    return {
      pet, readOnly: false,
      changed: o.local === null || o.local === undefined || c !== canon(o.local),
      remoteBehind: o.remote !== null && o.remote !== undefined && c !== canon(o.remote),
    };
  }

  /* ---------- 餵食 ---------- */
  function feed(pet, now) {
    writable(pet);
    const today = todayOf(now);
    const p = sanitizeObj(pet, today);
    p.fed[today] = Math.max(p.fed[today] || 0, p.days[today] || 0);
    p.fed = sortedKeys(p.fed);
    return p;
  }

  /* ---------- 狀態(畫面用) ---------- */
  function stageOf(totalMet) {
    let s = 0;
    STAGES.forEach((need, i) => { if (totalMet >= need) s = i; });
    return s;
  }
  function accessoriesOf(totalMet) { return totalMet >= 30 ? Math.floor((totalMet - 30) / 30) : 0; }

  /* 連續天數與保護卡:從最早有紀錄的那天逐日走到今天。一開始 1 張,連續有練 7 天再 1 張,最多 2 張;
     漏一天自動用一張,連續天數不斷但那天不加;沒卡可用就歸零。今天還沒練不算漏。 */
  function streakOf(days, today) {
    const dates = Object.keys(days).filter(d => days[d] > 0 && d <= today).sort();
    if (!dates.length) return { streak: 0, shields: 1 };
    let streak = 0, shields = 1, run = 0;
    for (let d = dates[0]; d <= today; d = addDays(d, 1)) {
      if (days[d] > 0) {
        streak++; run++;
        if (run % SHIELD_EVERY === 0) shields = Math.min(MAX_SHIELDS, shields + 1);
      } else if (d === today) {
        break;
      } else if (shields > 0) {
        shields--; run = 0;
      } else {
        streak = 0; run = 0;
      }
    }
    return { streak, shields };
  }

  function status(pet, now) {
    const today = todayOf(now);
    const p = sanitizeObj(pet, today);
    const todayCount = p.days[today] || 0;
    const goal = goalOn(p, today);
    const { streak, shields } = streakOf(p.days, today);
    const past = Object.keys(p.days).filter(d => d <= today);
    const totalMet = p.oldMet + p.met.filter(d => d <= today).length;
    const fedToday = p.fed[today] || 0;
    return {
      today, todayCount, goal, nextGoal: goalOn(p, addDays(today, 1)),
      metToday: p.met.includes(today),
      streak, shields,
      broken: streak === 0 && past.length > 0,
      practicedDays: past.length,
      totalMet, stage: stageOf(totalMet), accessories: accessoriesOf(totalMet),
      food: Math.max(0, todayCount - fedToday), hungry: fedToday === 0,
      sleeping: isSleeping(now),
      name: p.name,
    };
  }

  /* 比對用:物件的鍵排序後轉字串 */
  function canon(x) {
    if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
    return JSON.stringify(x === undefined ? null : x);
  }

  return { dateOf, isSleeping, countHist, sanitize, merge, reconcile, setGoal, rename, feed, status, stageOf, accessoriesOf, goalOn, canon, isNext };
})();
