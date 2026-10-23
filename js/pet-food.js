/* 小雞第二階段的獎勵規則(規格 4.3、5.2、附錄 A.2;規格在 repo 外的 小雞第二階段規格.md)。純函式:
   不碰畫面、不讀寫任何儲存鍵、不用亂數、不讀時鐘(現在的時間一律由參數 now 傳入)。輸入一律不改,回傳新物件。
   載入在 js/pet.js 之後,把 sourceFood、ROUND_MIN、earn、backfill 掛到同一個 PET 上;pet.js 沒載入就什麼都不做。
   - 一天最多拿到 3 份點心(PET.SNACKS_PER_DAY;Bonnie 2026-10-23「每天拿三個阿」「應該有做任何練習都要拿的到食物」),
     每個完成的練習都可以拿,種類看是什麼練習(來源 id 對照表)。同一個來源 id 一天只算一次(再做一次回 dup),
     重複做同一關拿不到第二份。在寫入的那台判斷,判斷時用這台合併後的資料,種類寫進券以後不再改。
     一般的券記在來源 id 底下(日期 -> { 來源 id: 食物 });地瓜、麵包蟲記在自己的 id,後面帶著給它的練習(y_p5、w:s1_p5),
     同一個來源一般券和特別的券的 id 不同,兩台各給一種時合併兩張都留著(審查第 1 輪 #1)。
     一天一份那版的地瓜、麵包蟲券 id 是 y、w:…(沒有來源),照樣讀得懂,算那天的 1 份,也算那天的特別的。
   - 特別的日子:拿到那一刻的連續天數(含保護卡,含今天)剛好是 7 的倍數 → 地瓜;
     之前某一天長到新階段、或累積達標滿 60、90…天還沒領過 → 麵包蟲(記進 once)。兩個都符合先給地瓜。
     特別的算在一天 3 份裡,一天最多一份特別的(那天第一份),麵包蟲留到下一個沒有特別的日子。
     只算上線日(from)以後的事,上線前的紀錄不補發。
     已知限制(chick2 第二輪修正 #5):麵包蟲領過沒有只看判斷那台的 once。一台的資料停在別台領之前(離線、網路卡住),
     隔天在那台完成練習,同一個階段的麵包蟲會再給一次;日期不同是另一張券,合併兩張都留著(寧可多給,不收回已經給的)。
     這一張占掉那台那天的一個名額,學生拿到麵包蟲而不是那一份點心,總份數不變。同步之後 once 記較早那天,不會再給第三次。
   - 每種最多存 9 份,滿了不給(full),不占名額,留給下一個完成的練習。
   - 補寫(backfill):最近 7 天裡還沒有任何券的日子,從既有的鍵看得到的完成補一張(跟一天一份那版相同,不補到 3 份:
     已經有券的日子不動,舊規則寫好的那幾天不會因為改成一天 3 份被補上券)。
   測試:node tools/test_pet_food.js、node tools/test_pet_food3.js */
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

  /* ---------- 特別的券的 id(審查第 1 輪 #1) ---------- */
  /* 地瓜、麵包蟲的券記在自己的 id:y_<來源>、w:s<階段>_<來源>、w:a<第幾個 30 天>_<來源>,超過 24 個字截掉後面。
     不跟同一個來源的一般券共用 id:兩台同一天各自完成同一個來源、一台給了特別的另一台給一般的,合併時兩張都留著
     (共用 id 時合併只留一個值,特別的那張會不見,吃掉紀錄也會指到另一台的一般券)。一天一份那版的 y、w:… 沒有來源 */
  const SPECIAL_ID = /^(y|w:(?:s[1-6]|a[1-9]\d{0,3}))_(.+)$/;
  const specialId = (kind, src) => (kind + '_' + src).slice(0, 24);
  /* 那天的券裡有沒有這個來源給的(一般券的 id 就是來源;特別的券看 _ 後面,截掉的比對前面那段) */
  function usedSource(day, src) {
    if (!day || typeof day !== 'object') return false;
    return Object.keys(day).some(id => {
      if (id === src) return true;
      const m = SPECIAL_ID.exec(id);
      return !!m && (m[2] === src || (id.length === 24 && src.startsWith(m[2])));
    });
  }

  /* ---------- 決定那天拿什麼(earn 與 backfill 共用) ---------- */
  /* 回傳 { result, food, id, left, F }:F 是寫好的新欄位(只有 got 時有);id 是券的 id;left 是那天還能拿幾份。
     先看那天滿 3 張沒有(cap),再看同一個來源拿過沒有(dup) */
  const SPECIAL_FOODS = ['yam', 'worm'];
  function decide(p, F, src, d, from, streak) {
    const day = K.own(F.got, d) ? F.got[d] : {};
    const n = Object.keys(day).length, max = P.SNACKS_PER_DAY;
    if (n >= max) return { result: 'cap', left: 0 };
    if (usedSource(day, src)) return { result: 'dup', left: max - n };
    if (src === 'diag' && K.own(F.once, 'diag')) return { result: 'once' };
    const stock = K.stockOf(F);
    const room = f => (K.own(stock, f) ? stock[f] : 0) < P.MAX_STOCK;
    const special = Object.keys(day).some(id => SPECIAL_FOODS.includes(day[id]));   // 那天給過特別的了(含一天一份那版的 y、w:…)
    let food = regularFood(src), id = src;
    const once = Object.assign({}, F.once);
    if (!special && streak > 0 && streak % WEEK === 0 && (p.days[d] || 0) > 0 && room('yam')) { food = 'yam'; id = specialId('y', src); }
    else {
      const w = special ? '' : wormDue(p, F, d, from);
      if (w && room('worm')) { food = 'worm'; id = specialId(w, src); once[w] = d; }
      else if (!room(food)) return { result: 'full', food, left: max - n };
    }
    if (src === 'diag') once.diag = d;   // 程度檢測一輩子只給一次:第一次交卷那天就記下,就算那天換成了特別的食物
    const got = Object.assign({}, F.got, { [d]: Object.assign({}, day, { [id]: food }) });
    return { result: 'got', food, id, left: max - n - 1, F: Object.assign({}, F, { got, once }) };
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
    if (r.result === 'full') return { result: 'full', food: r.food, left: r.left };
    if (r.result === 'cap' || r.result === 'dup') return { result: r.result, left: r.left };
    if (r.result !== 'got') return { result: r.result };
    return { result: 'got', food: r.food, id: r.id, date: d, left: r.left, pet: K.attach(p, K.normFood(r.F, today), true) };
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

  Object.assign(P, { ROUND_MIN, sourceFood, usedSource, earn, backfill });
})();
