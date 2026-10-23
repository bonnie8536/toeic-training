/* 2026-10-23 存的對照：一天一份點心那一版（5dbf684）的 js/pet.js 加 js/pet-food.js，原樣串在一起。
   只給 tools/test_pet_food3.js 比對「舊規則寫出來的紀錄，新版讀回來不變」用，頁面不載入。 */
/* 小雞的純計算(路線圖 1.2a;第二階段規格在 repo 外的 小雞第二階段規格.md)。不碰畫面、不讀寫任何儲存鍵:
   呼叫的人把 hist 與 pet 傳進來,自己決定要不要存。測試:node tools/test_pet.js。
   - 有效題數:同一題(模組加題號)同一天只算一次;跟上一筆相隔不到 2 秒的不算;
     交卷時用迴圈一次寫很多筆(時間只差幾毫秒)算同一批,整批跟前一筆比;單字考題用 n、翻牌配對用配對數(最多 50)。
   - 跨日一律看台北時間(UTC+8,沒有日光節約),不看裝置時區。
   - pet 只存發生過的事實(每天題數、達標日、目標歷史、餵了幾顆、名字),連續天數、保護卡、成長階段每次重算。
     合併逐日取大、達標日取聯集,兩台裝置怎麼互蓋都不會倒退。
   - 日期比今天晚 7 天以內的先留著、不算進任何數字(時鐘慢的裝置不會刪掉別台的新進度);更晚的丟掉(時鐘被調快不留永久的錯)。
   - 壞掉的欄位一個一個救;整個救不回或版本不認得(v 是大於 1 又不是 2 的數字)就唯讀,不寫回。
   - 第二階段(v: 2)加了食物與走動開關:got(拿到的券)、ate(吃掉哪一張)、foodOld(壓縮掉的舊券)、once(一輩子一次的)、
     roam(走動開關)。這一版照常讀寫 v2;新欄位只在有內容時才寫出來。v1 進來、沒有新內容,出去還是 v1,
     而且跟 f18d208 那一版逐位元組相同(test_pet.js 比對)。唯一的例外是合併時 oldMet 只增不減:兩份對不上
     (較早移出的那份記得的達標比較晚那份多)時,f18d208 只取較晚那份會少算,這一版取大(chick2 第二輪修正 #2)。
     已知限制(chick2 第三輪修正 #2):時鐘快的裝置寫的紀錄,oldBefore 會比合併那台的 400 天截止日晚(最多晚兩台的時鐘差)。
     三份以上的紀錄合併時,落在截止日與那個 oldBefore 之間的達標日,依合併的順序可能被加起來或取大,累積達標差這幾天;
     任何一種順序都不少於任何一份輸入,也不少於 f18d208。oldBefore 都不晚於截止日時跟順序無關(test_pet.js 釘住)。
     要消掉得記下壓縮掉的是哪幾天,資料格式要改,所以不做;時鐘允許的範圍縮到 3 天(第三輪修正 #1)讓這段從 12 天縮到 6 天左右。
     合併只取聯集,同步得到的券不會因為合併少掉。
     foodOld 分開記每種「壓縮進去幾張券」(got)和「其中吃掉幾張」(ate),合併時各自取大,剩的是相減:
     壓縮時沒看到某一口的那份,蓋不掉看到的那份,吃掉的點心不會隔天又回來(chick2 第二輪修正 #1、#4)。
     已知限制:壓縮進去的券認不出是哪幾張。一張券超過 119 天沒同步、另一份同種的舊券已經壓縮成不少於它的數字時,
     合併逐種取大,這一張不另外加(附錄 A.3、A.4;取大是唯一不會越合併越多的做法,test_pet.js 釘住這個行為)。
     兩台都離線、各自吃了一口又各自壓縮,合併後只算得到一口(寧可多給)。
     同一張券兩台各吃一次、一口在壓縮那天之前、一口在之後(吃到舊券)時,兩邊都算到;舊券剩的夾在 0、吃掉的不超過壓縮進去的,
     多算的那一口不會扣到同種還沒吃的新券(chick2 第三輪修正 #3)。
     獎勵規則(拿到哪種食物)在 js/pet-food.js。 */
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
  const V_NEXT = 2;
  /* 剛好是 v2 才算 */
  function isNext(raw) { return isPlain(raw) && raw.v === V_NEXT; }
  /* 救不回:不是物件、或版本比 1 新又不是 2(v3、1.5 這些不認得的版本) */
  function unusable(raw) {
    if (raw === null || raw === undefined) return false;
    if (!isPlain(raw)) return true;
    return typeof raw.v === 'number' && raw.v > V && raw.v !== V_NEXT;
  }
  /* 會產生要寫出去的那份的函式拿到救不回的,直接丟錯,不回傳任何 pet */
  function writable(raw) {
    if (unusable(raw)) throw new Error('這份小雞資料是較新的版本或讀不懂,這一版不改它');
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

  /* 第一階段的欄位(v1 的樣子;v2 的新欄位另外由 readFood 整理) */
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
  /* 整份整理:v1 照舊;v2 另外帶上整理過的新欄位 */
  function full(raw, today) {
    const p = sanitizeObj(raw, today);
    return isNext(raw) ? attach(p, readFood(raw, today), true) : p;
  }
  function sanitize(raw, now) {
    const today = todayOf(now);
    if (unusable(raw)) return { pet: empty(), readOnly: true };
    return { pet: full(raw, today), readOnly: false };
  }

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

  /* ---------- 第二階段的欄位:食物(券)與走動開關 ---------- */
  const KEEP_FOOD = 120;    // got、ate 留幾天,更早的壓縮進 foodOld
  const MAX_STOCK = 9;      // 每種點心最多存幾份(在拿到時判斷,js/pet-food.js)
  const PER_DAY = 4;        // 每天最多留幾張券、幾筆吃掉(正常一天 1 張;要 4 台以上同時離線才會超過)
  const LEFT_MAX = 100000;
  const ID_RE = /^[a-z0-9:_-]{1,24}$/;
  const EAT_ID_RE = /^[a-z0-9]{1,24}$/;
  const FOOD_RE = /^[a-z]{2,10}$/;
  const TICKET_RE = /^(\d{4}-\d{2}-\d{2}\/[a-z0-9:_-]{1,24}|old:\d{4}-\d{2}-\d{2}:[a-z]{2,10}:(0|[1-9]\d{0,5}))$/;
  const OLD_RE = /^old:(\d{4}-\d{2}-\d{2}):([a-z]{2,10}):(0|[1-9]\d{0,5})$/;
  const FOODS = Object.freeze([
    ['grain', '飼料', '顆'], ['corn', '玉米', '份'], ['greens', '青江菜', '份'], ['pea', '豌豆', '份'], ['berry', '藍莓', '份'],
    ['tomato', '小番茄', '份'], ['melon', '西瓜', '份'], ['yam', '地瓜', '份'], ['worm', '麵包蟲', '份'],
  ].map(([id, name, unit]) => Object.freeze({ id, name, unit })));
  const SNACKS = Object.freeze(FOODS.slice(1).map(f => f.id));
  const FAVS = Object.freeze(['corn', 'greens', 'yam']);

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const okId = id => ID_RE.test(id) && id !== '__proto__';
  const isFood = x => typeof x === 'string' && FOOD_RE.test(x);
  const isTicket = x => typeof x === 'string' && TICKET_RE.test(x);
  function nonEmpty(o) { return !!o && Object.keys(o).length > 0; }
  function noFood() { return { got: {}, ate: {}, foodOld: null, once: {}, roam: null }; }

  /* 一種「日期 -> { id: 值 }」的欄位:日期有效、不晚於今天加 7 天、不早於 before;id 符合格式、值通過 ok;
     每天最多留 PER_DAY 筆(id 最小的)。被刪掉的吃掉紀錄會讓食物退回來,這是刻意的(寧可多給) */
  function cleanDated(o, today, before, ok) {
    const out = {};
    if (!isPlain(o)) return out;
    Object.keys(o).sort().forEach(d => {
      if (!isDate(d) || d > addDays(today, AHEAD) || (before && d < before) || !isPlain(o[d])) return;
      const day = {};
      Object.keys(o[d]).filter(id => okId(id) && ok(o[d][id])).sort().slice(0, PER_DAY).forEach(id => { day[id] = o[d][id]; });
      if (nonEmpty(day)) out[d] = day;
    });
    return out;
  }
  /* foodOld 裡「每種幾張」的表:食物代號符合格式、數字有限,夾在 0 到 100000 */
  function cleanTally(o) {
    const out = {};
    if (isPlain(o)) Object.keys(o).sort().forEach(k => { if (FOOD_RE.test(k) && typeof o[k] === 'number' && isFinite(o[k])) out[k] = cleanCount(o[k], LEFT_MAX); });
    return out;
  }
  /* 讀 v2 的新欄位,壞掉的那一欄自己丟掉,其他照留。
     foodOld 是 { before, got: 每種壓縮進去幾張券, ate: 其中吃掉幾張 }(chick2 第二輪修正 #1)。
     舊的寫法 { before, left: 每種剩幾張 } 也讀得懂,當成 got 是 left、ate 是 0(線上沒有人寫過 v2,只是測試資料用得到) */
  function readFood(raw, today) { return compress(rawFood(raw, today), today); }
  function rawFood(raw, today) {
    const F = noFood();
    const fo = raw.foodOld;
    if (isPlain(fo) && isDate(fo.before) && fo.before <= addDays(today, AHEAD)) {
      const got = isPlain(fo.got) ? cleanTally(fo.got) : cleanTally(fo.left);
      F.foodOld = { before: fo.before, got, ate: isPlain(fo.got) ? cleanTally(fo.ate) : {} };
    }
    F.got = raw.got;
    F.ate = raw.ate;
    if (isPlain(raw.once)) Object.keys(raw.once).sort().forEach(id => { if (okId(id) && isDate(raw.once[id])) F.once[id] = raw.once[id]; });
    const r = raw.roam;
    if (isPlain(r) && typeof r.on === 'boolean' && typeof r.at === 'number' && isFinite(r.at)) F.roam = { on: r.on, at: cleanCount(r.at, 9e15) };
    return cleanFood(F, today);
  }
  /* 只做日期與格式的整理,不壓縮(合併前兩邊都用這個,壓縮等合併完、看得到兩邊的吃掉紀錄再做) */
  function cleanFood(F, today) {
    const before = F.foodOld ? F.foodOld.before : '';
    return { got: cleanDated(F.got, today, before, isFood), ate: cleanDated(F.ate, today, before, isTicket), foodOld: F.foodOld, once: F.once, roam: F.roam };
  }
  function normFood(F, today) { return compress(cleanFood(F, today), today); }
  function foodOf(raw, today) { return isNext(raw) ? readFood(raw, today) : noFood(); }
  function rawFoodOf(raw, today) { return isNext(raw) ? rawFood(raw, today) : noFood(); }

  function eatenOf(F) {
    const s = new Set();
    Object.keys(F.ate).forEach(d => Object.keys(F.ate[d]).forEach(id => s.add(F.ate[d][id])));
    return s;
  }
  /* 舊券 old:<before>:<食物>:<序號>,序號 0 到 got-1;還沒壓縮進 foodOld.ate 的吃掉紀錄指到幾張 */
  function oldEaten(fo, f, eaten) {
    let n = 0;
    eaten.forEach(t => { const m = OLD_RE.exec(t); if (m && m[1] === fo.before && m[2] === f && +m[3] < (fo.got[f] || 0)) n++; });
    return n;
  }
  /* 舊券還剩幾張:壓縮進去的減掉壓縮時已經吃掉的,再減掉之後吃掉的,最少 0。
     同一張券在兩台各吃一次、一口在壓縮前(壓縮時算進 foodOld.ate)、一口在壓縮後(吃到舊券 old:…)時,合併後兩邊都算到,
     會減成負的;負的加到同種的新券上,會把還沒吃的新券抵掉(chick2 第三輪修正 #3)。舊券不會被吃掉比壓縮進去的還多,所以夾在 0 */
  function oldLeft(fo, f, eaten) { return Math.max(0, (fo.got[f] || 0) - (fo.ate[f] || 0) - oldEaten(fo, f, eaten)); }
  /* 壓縮(附錄 A.4):最早一筆 got 或 ate 早於「今天減 119 天」時,截止日 c 設成那天;
     早於 c 的券逐種數進 foodOld.got,其中被 ate(不論日期)指到的、加上指到舊券的吃掉紀錄,逐種數進 foodOld.ate;刪掉早於 c 的 got 與 ate。
     吃光的食物在 got 還是有數字,托盤那一格才不會消失 */
  function compress(F, today) {
    const c = addDays(today, -(KEEP_FOOD - 1));
    if (!Object.keys(F.got).concat(Object.keys(F.ate)).some(d => d < c)) return F;
    return fold(F, c, eatenOf(F));
  }
  /* 把 F 壓縮到截止日 c,before 設成 c,刪掉早於 c 的 got 與 ate。eaten 由呼叫的人給(合併時是兩邊的吃掉紀錄)。
     foodOld.got 加上早於 c 的券;foodOld.ate 加上其中被 eaten 指到的,再加上指到舊券、這次一起壓縮掉的吃掉紀錄:
     只算指到這一份現在的舊券(before 相同、序號在範圍內)的。指到別的 before 的舊券,是這份已經壓縮過的(壓縮時看到的算過了,
     沒看到的由合併時取大補上),或是根本不在這份裡的券,不再算,免得一口算兩次、或扣到不相干的券 */
  function fold(F, c, eaten) {
    const fo = F.foodOld, n = {}, e = {};
    if (fo) { Object.assign(n, fo.got); Object.assign(e, fo.ate); }
    /* 舊券吃掉的不超過壓縮進去的:同一張券一口在壓縮前、一口在壓縮後(兩台各吃一次)時兩邊都算到,不夾的話再壓縮一次,
       多算的那一口會把這次壓縮進去、還沒吃的新券扣掉(chick2 第三輪修正 #3) */
    if (fo) Object.keys(fo.got).forEach(f => { const k = oldEaten(fo, f, eaten); if (k) e[f] = Math.min(fo.got[f], (own(e, f) ? e[f] : 0) + k); });
    const add = (o, f) => { o[f] = (own(o, f) ? o[f] : 0) + 1; if (!own(n, f)) n[f] = 0; };
    const got = {}, ate = {};
    Object.keys(F.got).forEach(d => {
      if (d >= c) { got[d] = F.got[d]; return; }
      Object.keys(F.got[d]).forEach(id => { const f = F.got[d][id]; add(n, f); if (eaten.has(d + '/' + id)) add(e, f); });
    });
    Object.keys(F.ate).forEach(d => { if (d >= c) ate[d] = F.ate[d]; });
    return { got, ate, foodOld: { before: c, got: clampTally(n), ate: clampTally(e) }, once: F.once, roam: F.roam };
  }
  function clampTally(o) { const s = {}; Object.keys(o).sort().forEach(f => { s[f] = Math.max(0, Math.min(LEFT_MAX, o[f])); }); return s; }

  /* 合併(附錄 A.3):got、ate 逐日逐 id 聯集(同 id 不同值取字串較小的);foodOld 兩邊先壓縮到較晚的 before,got、ate 再各自逐種取大;
     once 聯集取較早的日期;roam 後改的贏,同時改的 on:false 贏(休息優先)。合併完再整理一次(每天上限、壓縮) */
  function unionDated(a, b) {
    const out = {};
    [a, b].forEach(o => Object.keys(o).forEach(d => {
      const day = own(out, d) ? out[d] : (out[d] = {});
      Object.keys(o[d]).forEach(id => { const v = o[d][id]; if (!own(day, id) || v < day[id]) day[id] = v; });
    }));
    return out;
  }
  function mergeFood(A, B) {
    /* 兩邊的 before 不同時(例如一台停用很久,自己壓縮到今天的截止日;另一台在截止日附近沒有券,before 還停在以前):
       先把兩邊都壓縮到較晚的那個 before,再逐種取大。直接取 before 較晚的那組,會整份丟掉另一邊的舊券(第三輪審查 #1)。
       重新壓縮時看兩邊的吃掉紀錄,另一台吃掉的舊券不會又算成沒吃。
       「壓縮進去幾張」和「其中吃掉幾張」分開取大:一份壓縮時沒看到某一口,它的吃掉數比較小,蓋不掉看到那一口的那份
       (以前只記剩幾張、逐種取大,沒看到那一口的那份剩得多,吃掉的又回來;chick2 第二輪修正 #1、#4)。
       壓縮進去的券認不出是哪幾張,所以券數也只能取大:一邊超過 119 天沒同步的券,若另一邊同種的券數不少於它,就不另外加(開頭的已知限制) */
    let foodOld = null;
    const befores = [A.foodOld, B.foodOld].filter(Boolean).map(o => o.before).sort();
    if (befores.length) {
      const cut = befores[befores.length - 1];
      const eaten = new Set([...eatenOf(A), ...eatenOf(B)]);
      const at = F => (F.foodOld && F.foodOld.before === cut ? F : fold(F, cut, eaten));
      A = at(A); B = at(B);
      const big = k => { const o = {}; [A.foodOld[k], B.foodOld[k]].forEach(x => Object.keys(x).forEach(f => { o[f] = Math.max(own(o, f) ? o[f] : 0, x[f]); })); return sortedKeys(o); };
      foodOld = { before: cut, got: big('got'), ate: big('ate') };
    }
    const once = {};
    [A.once, B.once].forEach(o => Object.keys(o).forEach(id => { if (!own(once, id) || o[id] < once[id]) once[id] = o[id]; }));
    let roam = A.roam || B.roam;
    if (A.roam && B.roam) roam = A.roam.at !== B.roam.at ? (A.roam.at > B.roam.at ? A.roam : B.roam) : { on: A.roam.on && B.roam.on, at: A.roam.at };
    return { got: unionDated(A.got, B.got), ate: unionDated(A.ate, B.ate), foodOld, once, roam };
  }
  /* 把新欄位接到整理好的舊欄位後面:有任何一個有內容、或輸入本來就是 v2,結果才是 v2;空的欄位不寫出來 */
  function attach(p, F, wasNext) {
    const has = nonEmpty(F.got) || nonEmpty(F.ate) || !!F.foodOld || nonEmpty(F.once) || !!F.roam;
    if (!wasNext && !has) return p;
    p.v = V_NEXT;
    const dated = o => { const s = {}; Object.keys(o).sort().forEach(d => { s[d] = sortedKeys(o[d]); }); return s; };
    if (nonEmpty(F.got)) p.got = dated(F.got);
    if (nonEmpty(F.ate)) p.ate = dated(F.ate);
    if (F.foodOld) p.foodOld = { before: F.foodOld.before, got: sortedKeys(F.foodOld.got), ate: sortedKeys(F.foodOld.ate) };
    if (nonEmpty(F.once)) p.once = sortedKeys(F.once);
    if (F.roam) p.roam = { on: F.roam.on, at: F.roam.at };
    return p;
  }
  /* 動作(feed、setGoal、rename)做在舊欄位上,新欄位原樣帶著 */
  function carry(p, raw, today) { return isNext(raw) ? attach(p, readFood(raw, today), true) : p; }

  /* ---------- 合併 ---------- */
  function mergeClean(a, b, today) {
    const p = empty();
    /* oldBefore 取較晚的;oldMet 只增不減:每一邊把自己早於那天的達標日也算進去,取大的。
       以前成對取 oldBefore 較晚的那組:很久沒同步、還留著 400 天前練習日的那份,整理時自己移到今天的截止日,
       oldBefore 比雲端晚、oldMet 卻比較小,雲端累積的達標整個被丟掉(chick2 第二輪修正 #2)。
       兩份對得上時兩邊算出來一樣,結果跟以前逐位元組相同;只有對不上(以前會少掉)時不同 */
    p.oldBefore = a.oldBefore > b.oldBefore ? a.oldBefore : b.oldBefore;
    const folded = x => x.oldMet + (p.oldBefore ? x.met.filter(d => d < p.oldBefore).length : 0);
    p.oldMet = Math.min(1e6, Math.max(folded(a), folded(b)));
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
  /* 有一邊是 v2 時新欄位聯集;兩邊都是 v1 就跟以前完全一樣。
     兩邊先不壓縮:各自只用自己的吃掉紀錄壓縮到今天的截止日,會把另一邊吃掉的算成沒吃;合併完、看得到兩邊的吃掉紀錄再壓縮 */
  function withFood(p, a, b, today) {
    if (!isNext(a) && !isNext(b)) return p;
    return attach(p, normFood(mergeFood(rawFoodOf(a, today), rawFoodOf(b, today)), today), true);
  }
  function merge(a, b, now) {
    writable(a); writable(b);
    const today = todayOf(now);
    return withFood(mergeClean(sanitizeObj(a, today), sanitizeObj(b, today), today), a, b, today);
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
    return carry(p, pet, today);
  }
  function rename(pet, name, now) {
    writable(pet);
    const today = todayOf(now);
    const p = sanitizeObj(pet, today);
    p.name = Array.from(String(name || '').trim()).slice(0, NAME_MAX).join('');
    p.nameAt = p.name ? Math.floor(now) : 0;
    return carry(p, pet, today);
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
     readOnly:有一份救不回(不認得的版本),這次只顯示不寫,也不動雲端那份;救不回的那份當成空的。
     v2 照常合併、照常寫(新欄位聯集)。
     changed:結果跟本機存的不一樣(要寫回本機);remoteBehind:結果跟雲端那份不一樣(要上傳)。 */
  function reconcile(o) {
    const today = todayOf(o.now);
    const readOnly = unusable(o.local) || unusable(o.remote);
    const lraw = unusable(o.local) ? null : o.local, rraw = unusable(o.remote) ? null : o.remote;
    const local = lraw === null ? empty() : sanitizeObj(lraw, today);
    const remote = rraw === null ? empty() : sanitizeObj(rraw, today);
    const pet = withFood(absorb(mergeClean(local, remote, today), o.hist, today), lraw, rraw, today);
    if (readOnly) return { pet, readOnly: true, changed: false, remoteBehind: false };
    const c = canon(pet);
    return {
      pet, readOnly: false,
      changed: o.local === null || o.local === undefined || c !== canon(o.local),
      remoteBehind: o.remote !== null && o.remote !== undefined && c !== canon(o.remote),
    };
  }

  /* ---------- 餵食(飼料) ---------- */
  function feed(pet, now) {
    writable(pet);
    const today = todayOf(now);
    const p = sanitizeObj(pet, today);
    p.fed[today] = Math.max(p.fed[today] || 0, p.days[today] || 0);
    p.fed = sortedKeys(p.fed);
    return carry(p, pet, today);
  }

  /* ---------- 點心:剩幾份、吃 ---------- */
  function foodName(code) { const f = FOODS.find(x => x.id === code); return f ? f.name : ''; }
  function favOf(born) {
    if (typeof born !== 'string' || !born) return FAVS[0];
    return FAVS[[...born].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % FAVS.length];
  }
  /* 每種還沒被吃掉的券有幾張(含不認得的食物代號;畫面只看 SNACKS)。maxDate:只算這天以前的券(晚於今天的到那天才顯示) */
  function stockOf(F, maxDate) {
    const eaten = eatenOf(F);
    const n = {};
    if (F.foodOld) Object.keys(F.foodOld.got).forEach(f => { n[f] = oldLeft(F.foodOld, f, eaten); });
    Object.keys(F.got).forEach(d => {
      if (maxDate && d > maxDate) return;
      Object.keys(F.got[d]).forEach(id => { const f = F.got[d][id]; n[f] = (own(n, f) ? n[f] : 0) + (eaten.has(d + '/' + id) ? 0 : 1); });
    });
    return n;
  }
  function ticketFood(t, F) {
    const m = OLD_RE.exec(t);
    if (m) return m[2];
    const i = t.indexOf('/'), d = t.slice(0, i), id = t.slice(i + 1);
    return own(F.got, d) && own(F.got[d], id) ? F.got[d][id] : '';
  }
  function pantryOf(p, F, today) {
    const stock = stockOf(F, today);
    const seen = new Set(F.foodOld ? Object.keys(F.foodOld.got) : []);
    Object.keys(F.got).forEach(d => { if (d <= today) Object.keys(F.got[d]).forEach(id => seen.add(F.got[d][id])); });
    eatenOf(F).forEach(t => { const f = ticketFood(t, F); if (f) seen.add(f); });
    const order = SNACKS.filter(f => seen.has(f));
    const out = {};
    order.forEach(f => { out[f] = Math.max(0, own(stock, f) ? stock[f] : 0); });
    const gotIds = own(F.got, today) ? Object.keys(F.got[today]).sort() : [];
    const ateIds = own(F.ate, today) ? Object.keys(F.ate[today]).sort() : [];
    const practiced = (p.days[today] || 0) > 0 || gotIds.length > 0;
    const af = ateIds.length ? ticketFood(F.ate[today][ateIds[0]], F) : '';
    return {
      stock: out, order, practiced,
      ateToday: ateIds.length > 0,
      ateFood: SNACKS.includes(af) ? af : null,
      gotToday: gotIds.length ? { id: gotIds[0], food: F.got[today][gotIds[0]] } : null,
      canSnack: practiced && !ateIds.length,
      fav: favOf(p.born), favKnown: own(F.once, 'fav'),
    };
  }
  function split(pet, today) { return unusable(pet) ? { p: empty(), F: noFood() } : { p: sanitizeObj(pet, today), F: foodOf(pet, today) }; }
  /* 托盤要的東西;畫面只看這個,不自己算券 */
  function pantry(pet, now) {
    const today = todayOf(now);
    const s = split(pet, today);
    return pantryOf(s.p, s.F, today);
  }
  /* 同種裡最舊、還沒被吃掉的那張:先舊券(序號小的),再依日期、id */
  function pickTicket(F, food, today) {
    const eaten = eatenOf(F);
    if (F.foodOld && own(F.foodOld.got, food) && oldLeft(F.foodOld, food, eaten) > 0) {
      for (let i = 0; i < F.foodOld.got[food]; i++) { const t = 'old:' + F.foodOld.before + ':' + food + ':' + i; if (!eaten.has(t)) return t; }
    }
    for (const d of Object.keys(F.got).sort()) {
      if (d > today) break;
      for (const id of Object.keys(F.got[d]).sort()) { const t = d + '/' + id; if (F.got[d][id] === food && !eaten.has(t)) return t; }
    }
    return '';
  }
  /* 吃一份點心。eatId 由 pet-store 產生([a-z0-9]{1,24})。拒絕時什麼都不寫、不回 pet */
  function eat(pet, food, eatId, now) {
    if (unusable(pet)) return { ok: false, reason: 'readOnly' };
    if (!SNACKS.includes(food)) return { ok: false, reason: 'badFood' };
    if (typeof eatId !== 'string' || !EAT_ID_RE.test(eatId)) throw new Error('吃的 id 格式不對');
    const today = todayOf(now);
    const { p, F } = split(pet, today);
    const pan = pantryOf(p, F, today);
    if (!pan.practiced) return { ok: false, reason: 'notToday' };
    if (pan.ateToday) return { ok: false, reason: 'ateToday' };
    const ticket = pickTicket(F, food, today);
    if (!ticket) return { ok: false, reason: 'none' };
    const ate = Object.assign({}, F.ate, { [today]: Object.assign({}, own(F.ate, today) ? F.ate[today] : {}, { [eatId]: ticket }) });
    const once = food === favOf(p.born) && !own(F.once, 'fav') ? Object.assign({}, F.once, { fav: today }) : F.once;
    const F2 = normFood(Object.assign({}, F, { ate, once }), today);
    return { ok: true, pet: attach(p, F2, true), ticket, left: Math.max(0, stockOf(F2, today)[food] || 0) };
  }

  /* ---------- 走動開關 ---------- */
  function roamOn(pet) { return !(isNext(pet) && isPlain(pet.roam) && pet.roam.on === false); }
  function setRoam(pet, on, now) {
    writable(pet);
    const today = todayOf(now);
    const { p, F } = split(pet, today);
    return attach(p, Object.assign({}, F, { roam: { on: !!on, at: cleanCount(now, 9e15) } }), true);
  }

  /* ---------- cloud.js 上傳前用:本機那份跟雲端那份合併(不讀 hist、不補今天) ---------- */
  function cloudMerge(localRaw, cloudRaw, now) {
    if (unusable(localRaw) || unusable(cloudRaw)) return { ok: false };
    const v = merge(localRaw, cloudRaw, now);
    const c = canon(v);
    return { ok: true, v, sameAsLocal: c === canon(localRaw), sameAsCloud: c === canon(cloudRaw) };
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

  return {
    dateOf, isSleeping, countHist, sanitize, merge, reconcile, setGoal, rename, feed, status, stageOf, accessoriesOf, goalOn, canon, isNext, isDate,
    FOODS, SNACKS, MAX_STOCK, FAVS, KEEP_FOOD, foodName, favOf, roamOn, setRoam, pantry, eat, cloudMerge,
    /* 給 js/pet-food.js 用的內部工具(同一套整理與合併規則);畫面不要用 */
    _inner: Object.freeze({ STAGES, DAY, AHEAD, ID_RE, okId, isTime, todayOf, addDays, unusable, streakOf, split, normFood, attach, stockOf, own }),
  };
})();
/* 小雞第二階段的獎勵規則(規格 4.3、5.2、附錄 A.2;規格在 repo 外的 小雞第二階段規格.md)。純函式:
   不碰畫面、不讀寫任何儲存鍵、不用亂數、不讀時鐘(現在的時間一律由參數 now 傳入)。輸入一律不改,回傳新物件。
   載入在 js/pet.js 之後,把 sourceFood、ROUND_MIN、earn、backfill 掛到同一個 PET 上;pet.js 沒載入就什麼都不做。
   - 一天最多拿到 1 份點心,由當天第一個完成的練習給,種類看是什麼練習(來源 id 對照表);在寫入的那台判斷,
     判斷時用這台合併後的資料,種類寫進券以後不再改。
   - 特別的日子:拿到那一刻的連續天數(含保護卡,含今天)剛好是 7 的倍數 → 地瓜;
     之前某一天長到新階段、或累積達標滿 60、90…天還沒領過 → 麵包蟲(記進 once),一天給一個。兩個都符合先給地瓜。
     只算上線日(from)以後的事,上線前的紀錄不補發。
     已知限制(chick2 第二輪修正 #5):麵包蟲領過沒有只看判斷那台的 once。一台的資料停在別台領之前(離線、網路卡住),
     隔天在那台完成練習,同一個階段的麵包蟲會再給一次;日期不同是另一張券,合併兩張都留著(寧可多給,不收回已經給的)。
     這一張占掉那台那天的名額,學生拿到麵包蟲而不是那天的點心,總份數不變。同步之後 once 記較早那天,不會再給第三次。
   - 每種最多存 9 份,滿了不給(full),當天的名額留給下一個完成的練習。
   - 補寫(backfill):最近 7 天裡還沒有券的日子,從既有的鍵看得到的完成補一張。
   測試:node tools/test_pet_food.js */
'use strict';
(function () {
  const P = globalThis.PET;
  if (!P || !P._inner) return;
  const K = P._inner;
  const ROUND_MIN = 5;          // 一回合少於 5 題不算(題數由這一輪決定的練習才傳 n)
  const RANGE = 7 * K.DAY;      // 完成時間跟現在差超過 7 天不算
  const WEEK = 7;

  /* 來源 id 與食物(附錄 A.2);表的順序也是補寫時「看不出時間」的完成彼此的先後 */
  const RULES = [
    [/^d$/, 'corn'],
    [/^((g|pn):[a-z0-9:_-]+|iv)$/, 'pea'],
    [/^(fall|pairs|toast|mcq|ph)$/, 'berry'],
    [/^((r|tq|dlg):[a-z0-9:_-]+|p[567]|pr|l[1-4]|es|ed|emp|en|rv)$/, 'tomato'],
    [/^(mock|diag)$/, 'melon'],
    [/^(wr:[a-z0-9:_-]+|m)$/, 'greens'],
  ];
  const SPECIAL = [[/^y$/, 'yam'], [/^w:(s[1-6]|a[1-9]\d{0,3})$/, 'worm']];
  function lookup(rules, id) {
    if (typeof id !== 'string' || !K.okId(id)) return '';
    const r = rules.find(([re]) => re.test(id));
    return r ? r[1] : '';
  }
  function regularFood(id) { return lookup(RULES, id); }
  function sourceFood(id) { return regularFood(id) || lookup(SPECIAL, id); }

  /* ---------- 連續天數 ---------- */
  /* 某一天的連續天數(含那天;那天還沒練就不算那天)。days 只留 400 天:連續的起點早於留存的範圍時(被截掉了),
     從留存範圍裡第一個「週期對齊」的日子起算,這樣範圍每天往後移,地瓜還是每 7 天一次 */
  function dayIndex(d) { return Math.round(Date.parse(d + 'T00:00:00Z') / K.DAY); }
  function streakAt(p, d) {
    const dates = Object.keys(p.days).filter(x => p.days[x] > 0).sort();
    if (!dates.length) return 0;
    const s = K.streakOf(p.days, d).streak;
    if (!p.oldBefore || s === 0 || !reachesStart(p.days, dates[0], d)) return s;
    let a = dates[0];
    while (dayIndex(a) % WEEK !== 0) a = K.addDays(a, 1);
    const cut = {};
    Object.keys(p.days).forEach(x => { if (x >= a) cut[x] = p.days[x]; });
    return K.streakOf(cut, d).streak;
  }
  /* 那天的連續是不是一路接到最早的紀錄(中間沒斷過):照 streakOf 的走法,記下最後一次歸零的地方 */
  function reachesStart(days, first, d) {
    let shields = 1, run = 0, broke = false;
    for (let x = first; x < d; x = K.addDays(x, 1)) {
      if (days[x] > 0) { run++; if (run % WEEK === 0) shields = Math.min(2, shields + 1); }
      else if (shields > 0) { shields--; run = 0; }
      else { broke = true; run = 0; }
    }
    return !broke;
  }

  /* ---------- 麵包蟲 ---------- */
  /* 還沒領的階段或累積達標:達到的那天嚴格早於 d、不早於 from、once 裡沒有;好幾個時給最早達到的那個 */
  function wormDue(p, F, d, from) {
    const met = p.met.filter(x => x < d);
    const base = p.oldMet;               // 這些的日期已經不在了(早於 oldBefore),當成上線前,不給
    const total = base + met.length;
    const dateAt = need => (need > base && need <= total ? met[need - base - 1] : '');
    const cands = [];
    K.STAGES.forEach((need, i) => { if (i > 0) cands.push(['w:s' + i, need]); });
    for (let k = 1; 30 + 30 * k <= total; k++) cands.push(['w:a' + k, 30 + 30 * k]);
    for (const [id, need] of cands) {
      const at = dateAt(need);
      if (at && at >= from && !K.own(F.once, id)) return id;
    }
    return '';
  }

  /* ---------- 決定那天拿什麼(earn 與 backfill 共用) ---------- */
  /* 回傳 { result, food, id, F }:F 是寫好的新欄位(只有 got 時有) */
  function decide(p, F, src, d, from, streak) {
    if (K.own(F.got, d) && Object.keys(F.got[d]).length) return { result: 'cap' };
    if (src === 'diag' && K.own(F.once, 'diag')) return { result: 'once' };
    const stock = K.stockOf(F);
    const room = f => (K.own(stock, f) ? stock[f] : 0) < P.MAX_STOCK;
    let id = src, food = regularFood(src);
    const once = Object.assign({}, F.once);
    if (streak > 0 && streak % WEEK === 0 && (p.days[d] || 0) > 0 && room('yam')) { id = 'y'; food = 'yam'; }
    else {
      const w = wormDue(p, F, d, from);
      if (w && room('worm')) { id = w; food = 'worm'; once[w] = d; }
      else if (!room(food)) return { result: 'full', food };
    }
    if (src === 'diag') once.diag = d;   // 程度檢測一輩子只給一次:第一次交卷那天就記下,就算那天換成了特別的食物
    const got = Object.assign({}, F.got, { [d]: { [id]: food } });
    return { result: 'got', food, id, F: Object.assign({}, F, { got, once }) };
  }

  /* 一個練習完成(掛勾呼叫,經過 pet-store):at 是完成的時間(決定券算哪一天),now 是現在(整理用) */
  function earn(pet, o, now) {
    const id = o && o.id, at = o && o.at, from = o && o.from;
    if (K.unusable(pet) || !P.isDate(from) || !K.isTime(at) || !K.isTime(now) || at > now + RANGE || at < now - RANGE) return { result: 'off' };
    const d = P.dateOf(at);
    if (d < from) return { result: 'off' };
    if (!regularFood(id)) return { result: 'bad' };
    const today = K.todayOf(now);
    const { p, F } = K.split(pet, today);
    const r = decide(p, F, id, d, from, streakAt(p, d));
    if (r.result === 'full') return { result: 'full', food: r.food };
    if (r.result !== 'got') return { result: r.result };
    return { result: 'got', food: r.food, id: r.id, date: d, pet: K.attach(p, K.normFood(r.F, today), true) };
  }

  /* ---------- 補寫最近 7 天 ---------- */
  const isPlain = o => !!o && typeof o === 'object' && !Array.isArray(o);
  const timeOf = s => (typeof s === 'string' ? Date.parse(s) : NaN);
  /* 每天的完成:有時間的取 { id, t };看不出時間的 t 是 Infinity,d 排在 m 前面 */
  function completions(p, src, lo, hi) {
    const by = {};
    const add = (d, id, t, rank) => { if (d >= lo && d <= hi && K.okId(id)) (by[d] = by[d] || []).push({ id, t, rank }); };
    if (Array.isArray(src.hist)) src.hist.forEach(r => {
      if (!isPlain(r) || !K.isTime(r.t)) return;
      const d = P.dateOf(r.t);
      if (r.m === 'vq' && r.id === 'fall' && r.ok === true) add(d, 'fall', r.t, 0);
      else if (r.m === 'vq' && r.id === 'pairs') add(d, 'pairs', r.t, 0);
      else if (r.m === 'tq' && typeof r.id === 'string') add(d, 'tq:' + r.id, r.t, 0);
    });
    if (Array.isArray(src.mock)) src.mock.forEach(r => { const t = isPlain(r) ? timeOf(r.d) : NaN; if (K.isTime(t)) add(P.dateOf(t), 'mock', t, 0); });
    if (isPlain(src.diag) && src.diag.done) { const t = timeOf(src.diag.finishedAt); if (K.isTime(t)) add(P.dateOf(t), 'diag', t, 0); }
    if (isPlain(src.daily)) Object.keys(src.daily).forEach(d => {
      const day = src.daily[d];
      if (P.isDate(d) && isPlain(day) && ['d', 'v', 'g'].some(k => isPlain(day[k]) && Object.keys(day[k]).length >= ROUND_MIN)) add(d, 'd', Infinity, 1);
    });
    p.met.forEach(d => add(d, 'm', Infinity, 2));
    Object.keys(by).forEach(d => by[d].sort((a, b) => (a.t - b.t) || (a.rank - b.rank)));
    return by;
  }
  function backfill(pet, src, now) {
    const s = isPlain(src) ? src : {};
    if (K.unusable(pet) || !P.isDate(s.from) || !K.isTime(now)) return { pet, added: [] };
    const today = K.todayOf(now);
    const lo = [K.addDays(today, -6), s.from].sort()[1];
    if (lo > today) return { pet, added: [] };
    const sp = K.split(pet, today);
    const p = sp.p;
    let F = sp.F;
    const by = completions(p, s, lo, today);
    const added = [];
    for (let d = lo; d <= today; d = K.addDays(d, 1)) {
      if (!by[d] || (K.own(F.got, d) && Object.keys(F.got[d]).length)) continue;
      const streak = streakAt(p, d);
      for (const c of by[d]) {
        const r = decide(p, F, c.id, d, s.from, streak);
        if (r.result === 'got') { F = r.F; added.push({ date: d, id: r.id, food: r.food, src: c.id }); break; }
        if (r.result === 'cap') break;
      }
    }
    if (!added.length) return { pet, added };
    return { pet: K.attach(p, K.normFood(F, today), true), added };
  }

  Object.assign(P, { ROUND_MIN, sourceFood, earn, backfill });
})();
