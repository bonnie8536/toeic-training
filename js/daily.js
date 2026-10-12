/* 每日練習(她 2026-10-12 的決定):聽寫 5 句、單字 5 題、文法 5 題,每天換題,所有人(含訪客)都能做,收費後也不擋。
   這個檔不碰畫面;畫面在 js/daily-ui.js。測試:node tools/test_daily.js。
   - 選題:看台北日期(UTC+8,不看裝置時區),人人一樣。每個題庫依「題號雜湊」排成固定順序,第 k 天取第 5k 到 5k+4 個(繞回開頭),
     所以連續 floor(題數 / 5) 天內不會重複,每題都會輪到。
     注意:起點是「天數 × 5 除以題數的餘數」,題庫只要多一題或少一題,整個輪替就重新排過,
     最近出過的題可能馬上再出,當天上線的話那一天的題目也會換(進度照算,不會壞)。
   - 記錄:每答一題照其他頁的寫法記進學習記錄(logAttempt),小雞與學習記錄頁都算得到;
     聽寫另外照聽力訓練頁寫 ear_d,單字照單字訓練頁更新漏接池 vgame_miss(兩個都是原本的鍵,格式與意思不變)。
     聽寫打的字只存前 300 個字元;空白不算作答。
   - 新鍵只有一個 daily_done:{ '台北日期': { d: { 題號: 1 或 0 }, v: {...}, g: {...} } },只留最近 14 天。
     同一題同一天只記第一次。 */
'use strict';
globalThis.DAILY = (function () {
  const KEY = 'daily_done';
  const DAY = 864e5;
  const TZ_MS = 8 * 3600e3;
  const KEEP = 14;      // 留幾天
  const AHEAD = 7;      // 比今天晚 7 天以內的先留著(時鐘慢的裝置不會刪掉別台的紀錄)
  const PARTS = [
    { key: 'd', name: '聽寫', unit: '句', n: 5 },
    { key: 'v', name: '單字', unit: '題', n: 5 },
    { key: 'g', name: '文法', unit: '題', n: 5 },
  ];
  const PART_KEYS = PARTS.map(p => p.key);
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* ---------- 日期 ---------- */
  function dateOf(t) { return new Date(t + TZ_MS).toISOString().slice(0, 10); }
  function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
  function isDate(d) {
    if (typeof d !== 'string' || !DATE_RE.test(d)) return false;
    const t = Date.parse(d + 'T00:00:00Z');
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  }
  function dayIndex(d) { return Math.round(Date.parse(d + 'T00:00:00Z') / DAY); }

  /* ---------- 選題 ---------- */
  /* FNV-1a 32 位元,最後加 murmur3 的 fmix32 打散:不加的話題號只差最後一個字的(d-31、d-32)會排在一起 */
  function hash(s) {
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b) >>> 0;
    x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0;
    x ^= x >>> 16;
    return x >>> 0;
  }
  function rng(seed) {   // mulberry32
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function orderOf(ids, part) {
    const uniq = Array.from(new Set(ids.map(String)));
    const hs = {};
    uniq.forEach(id => { hs[id] = hash(part + '|' + id); });
    return uniq.sort((a, b) => (hs[a] - hs[b]) || (a < b ? -1 : a > b ? 1 : 0));
  }
  function pick(ids, part, date, n) {
    const ord = orderOf(Array.isArray(ids) ? ids : [], part);
    const N = ord.length;
    const k = Math.min(n, N);
    if (!k) return [];
    const start = ((dayIndex(date) * k) % N + N) % N;
    return Array.from({ length: k }, (_, i) => ord[(start + i) % N]);
  }

  /* ---------- 題庫 ---------- */
  /* 單字池的規則跟單字訓練頁 buildWordPool('全部') 一樣:文章標記單字,去重,太長的不要 */
  function wordPool(T) {
    const seen = {}, pool = [];
    ((T && T.articles) || []).forEach(a => {
      (a && a.vocab || []).forEach(v => {
        const ans = String(v.base || v.word || '').toLowerCase().trim();
        if (!ans || ans.length > 16 || seen[ans] || !v.zh) return;
        seen[ans] = true;
        pool.push({ answer: ans, zh: String(v.zh) });
      });
    });
    return pool;
  }
  function shuffled(arr, r) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  /* 單字題:看英文選中文;同一天同一個字人人一樣。
     錯的選項跟正解不共用任何一個中文字(「貨運、運費」不拿「運送(費)」當錯的),彼此也不重複;
     題庫太小湊不滿 3 個時,才退回只要中文不同 */
  function hanOf(s) { return new Set(String(s).match(/[一-鿿]/g) || []); }
  function vocabItem(pool, w, date) {
    const r = rng(hash(date + '|v|' + w.answer));
    const mine = hanOf(w.zh);
    const cand = shuffled(pool, r);
    const used = new Set([w.zh]);
    const wrong = [];
    const take = strict => cand.forEach(p => {
      if (wrong.length >= 3 || p.answer === w.answer || used.has(p.zh)) return;
      if (strict && Array.from(hanOf(p.zh)).some(ch => mine.has(ch))) return;
      used.add(p.zh);
      wrong.push(p.zh);
    });
    take(true);
    if (wrong.length < 3) take(false);
    const options = shuffled([w.zh].concat(wrong), r);
    return { id: w.answer, word: w.answer, zh: w.zh, options, a: options.indexOf(w.zh) };
  }
  function itemsFor(T, date) {
    const ear = (T && T.ear && Array.isArray(T.ear.dictation)) ? T.ear.dictation : [];
    const dById = {};
    ear.forEach(x => { if (x && x.id) dById[x.id] = x; });
    const d = pick(Object.keys(dById), 'd', date, 5).map(id => {
      const x = dById[id];
      return { id, text: x.text, zh: x.zh, note: x.note && x.note !== '無' ? x.note : '', level: x.level };
    });

    const gById = {};
    ((T && T.grammar) || []).forEach(u => {
      (u && u.quiz || []).forEach((q, qi) => {
        if (q && Array.isArray(q.options) && q.options.length) gById[u.id + ':' + qi] = { u, q };
      });
    });
    const g = pick(Object.keys(gById), 'g', date, 5).map(id => {
      const { u, q } = gById[id];
      return { id, unit: u.title, unitId: u.id, q: q.q, options: q.options.slice(), answer: q.answer, explanation: q.explanation || '' };
    });

    const pool = wordPool(T);
    const vById = {};
    pool.forEach(w => { vById[w.answer] = w; });
    const v = pool.length >= 4 ? pick(Object.keys(vById), 'v', date, 5).map(id => vocabItem(pool, vById[id], date)) : [];
    return { d, v, g };
  }

  /* ---------- 聽寫對答案:跟聽力訓練頁(js/ear.js)同一套規則 ---------- */
  const NUM = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
  function normText(s) {
    return String(s).toLowerCase().replace(/[.,!?;:"()]/g, '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
  }
  function checkDictation(answer, typed) {
    const ansWords = normText(answer).split(' ');
    const gotWords = normText(typed).split(' ').filter(Boolean);
    const same = (a, b) => a === b || NUM[a] === b || NUM[b] === a;
    const pool = gotWords.slice();
    const diff = ansWords.map(w => {
      const gi = pool.findIndex(g => same(w, g));
      if (gi > -1) pool.splice(gi, 1);
      return { w, hit: gi > -1 };
    });
    const hits = diff.filter(x => x.hit).length;
    return { diff, hits, words: ansWords.length, perfect: hits === ansWords.length && gotWords.length === ansWords.length };
  }

  /* ---------- daily_done ---------- */
  function isPlain(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function laterOf(a, b) { return isDate(b) && b > a ? b : a; }
  function sanitize(raw, today) {
    const out = {};
    if (!isPlain(raw)) return out;
    const from = addDays(today, -(KEEP - 1)), to = addDays(today, AHEAD);
    Object.keys(raw).filter(d => isDate(d) && d >= from && d <= to).sort().forEach(d => {
      const day = raw[d];
      if (!isPlain(day)) return;
      const clean = {};
      PART_KEYS.forEach(p => {
        if (!isPlain(day[p])) return;
        const m = {};
        Object.keys(day[p]).forEach(id => { if (day[p][id] === 1 || day[p][id] === 0) m[id] = day[p][id]; });
        if (Object.keys(m).length) clean[p] = m;
      });
      if (Object.keys(clean).length) out[d] = clean;
    });
    return out;
  }
  /* 回傳新物件,不改原本的;同一題已經有紀錄就保留第一次。
     today 是清舊資料用的「今天」,沒給就用 date(頁面開了很多天才交答案時,要給現在的日期,才不會把新的幾天刪掉) */
  function mark(raw, date, part, id, ok, today) {
    const s = sanitize(raw, laterOf(date, today));
    if (PART_KEYS.indexOf(part) < 0) return s;
    const day = Object.assign({}, s[date] || {});
    const m = Object.assign({}, day[part] || {});
    if (m[id] === undefined) m[id] = ok ? 1 : 0;
    day[part] = m;
    const out = Object.assign({}, s);
    out[date] = day;
    const sorted = {};
    Object.keys(out).sort().forEach(k => { sorted[k] = out[k]; });
    return sorted;
  }
  /* 本機與雲端那一份取聯集(兩台各做一項時,雲端只留最後上傳的那一份,這裡補回來);
     同一題兩邊都有就留本機的。回傳新物件 */
  function merge(local, cloud, today) {
    const a = sanitize(local, today), b = sanitize(cloud, today);
    const out = {};
    Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort().forEach(d => {
      const day = {};
      PART_KEYS.forEach(p => {
        const m = Object.assign({}, (b[d] || {})[p] || {}, (a[d] || {})[p] || {});
        if (Object.keys(m).length) day[p] = m;
      });
      out[d] = day;
    });
    return out;
  }
  function progress(raw, date) {
    const day = isPlain(raw) && isPlain(raw[date]) ? sanitize({ [date]: raw[date] }, date)[date] || {} : {};
    const out = { date, doneParts: 0, complete: false };
    PARTS.forEach(p => {
      const m = day[p.key] || {};
      const vals = Object.keys(m).map(k => m[k]);
      const done = Math.min(p.n, vals.length);
      out[p.key] = { n: p.n, done, ok: Math.min(done, vals.filter(x => x === 1).length), finished: done >= p.n, answered: m };
      if (done >= p.n) out.doneParts++;
    });
    out.complete = out.doneParts === PARTS.length;
    return out;
  }

  /* ---------- 記錄一題 ----------
     o = { store, log, now, date(這組題目屬於哪一天), part, item, pick(單字、文法選的選項), typed(聽寫打的字) }
     store 是 common.js 的 store(訪客寫本機、登入的照常同步),log 是 logAttempt。
     date 由頁面在載入時定好:過了午夜才交的答案記回題目那一天,不會算進隔天的進度。
     清舊資料看的是 date 與現在兩個裡比較晚的那天,頁面開了很多天也不會刪掉新的紀錄。 */
  const TYPED_MAX = 300;
  function record(o) {
    const st = o.store, now = o.now, item = o.item, part = o.part;
    const date = isDate(o.date) ? o.date : dateOf(now);
    const today = laterOf(date, dateOf(now));
    const typed = String(o.typed || '').slice(0, TYPED_MAX);
    if (part === 'd' && !typed.trim()) return { recorded: false };
    const cur = sanitize(st.get(KEY, null), today);
    if (cur[date] && cur[date][part] && cur[date][part][item.id] !== undefined) return { recorded: false };
    let ok = false, result = null;
    if (part === 'd') {
      result = checkDictation(item.text, typed);
      ok = result.perfect;
      o.log('ed', item.id, result.hits, ok, { q: item.text, x: typed, w: result.words });
      const ear = st.get('ear_d', {});
      const next = Object.assign({}, isPlain(ear) ? ear : {});
      next[item.id] = { ok, text: typed };
      st.set('ear_d', next);
    } else if (part === 'v') {
      ok = o.pick === item.a;
      o.log('vq', item.id, o.pick, ok, { q: item.word, o: item.options.slice(), a: item.a, g: 'mcq' });
      const miss = st.get('vgame_miss', {});
      const m = Object.assign({}, isPlain(miss) ? miss : {});
      if (ok) {
        if (m[item.id]) { delete m[item.id]; st.set('vgame_miss', m); }
      } else {
        m[item.id] = (m[item.id] || 0) + 1;
        st.set('vgame_miss', m);
      }
    } else if (part === 'g') {
      ok = o.pick === item.answer;
      o.log('g', item.id, o.pick, ok);
    } else {
      return { recorded: false };
    }
    st.set(KEY, mark(cur, date, part, item.id, ok, today));
    return { recorded: true, ok, result };
  }

  return { KEY, PARTS, TYPED_MAX, dateOf, addDays, pick, wordPool, vocabItem, itemsFor, checkDictation, sanitize, mark, merge, progress, record };
})();
