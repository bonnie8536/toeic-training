/* 小雞的畫面(路線圖 1.3、1.4;規格在 repo 外的 小雞規格.md 第 5、7 節)。
   - 共用:小雞動畫的控制(只在看得到時動,約每秒 8 張;減少動態時只畫一張靜止的)、底部彈出的餵食面板、心情與文字。
   - 網站模式:首頁每日練習下面一張卡、「我的」頁一區。App 有分頁列時這兩個由 CSS 藏起來,改由 js/pet-roam.js 在分頁列上走。
   - 讀寫一律經過 js/pet-store.js(只寫 pet 這一個鍵);這裡不碰 store、localStorage。名字一律用文字節點放進畫面。
   - 面板照 js/app-shell.js 的 showInstallHelp:遮罩、右上角 ×、Esc、點背景關、關掉焦點回原處;另加從下面滑上來、
     把手與標題那一條往下拉關、背景設 inert、焦點鎖在面板裡。剛打開的 350 毫秒不接受點按(連點小雞時第二下不會按到面板裡的按鈕)。
   - 每日目標只放一個地方:「我的」頁那一區有,從那裡打開的面板就不再放。
   - 第二階段(小雞第二階段規格.md 第 3 節、實作契約第 6 節):PET_STORE.food 為真時面板上半是餵食區(舞台、托盤),
     卡片上的按鈕改成「餵牠」打開面板;PET_STORE.roamV2 為真時面板放「小雞在頁面上走動」開關。兩個開關各自獨立,
     都關著時畫出來的東西、焦點、事件跟第 1 步那版完全一樣(tools/test_pet_ui_food.js 對 tools/fixtures/pet_ui_step1.js 比)。
     食物模式唯一碰 localStorage 的是 tr_pet_hint(「點一下就餵」出現過幾次,不在學生資料裡、不同步)。
   載入順序:common.js、cloud.js、pet-config.js、pet.js、pet-store.js、chick-art.js、(food-art.js)、pet-ui.js(App 再加 pet-roam.js)。 */
(function () {
  'use strict';
  const S = window.PET_STORE, P = window.PET, A = window.ChickArt;
  if (!S || !S.on || !P || !A || typeof h !== 'function') return;
  const FOOD = S.food === true, ROAM2 = S.roamV2 === true;
  const doc = document, GOALS = [10, 20, 40], WEEK = '日一二三四五六';
  const WAKE_MS = 10 * 60e3, SETTLE_MS = 350;   // 晚上點醒以後醒著多久;面板打開後這麼久才接受點按
  const REDUCE = mq('(prefers-reduced-motion: reduce)');
  const X_ICON = "<svg viewBox='0 0 22 22' width='18' height='18' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'><path d='M5 5 17 17M17 5 5 17'/></svg>";
  const PEN = "<svg viewBox='0 0 24 24' width='18' height='18' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M12 20h9'/><path d='M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'/></svg>";

  let cur = S.view(), wokeAt = 0, feeding = false, msg = '';   // msg:面板與卡片下面的一行狀態(餵食結果、出錯)
  const subs = [];

  function mq(q) { try { return window.matchMedia(q).matches; } catch (e) { return false; } }
  function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }

  /* ---------- 心情與文字 ---------- */
  function awake() { return Date.now() - wokeAt < WAKE_MS; }
  function wake() { if (cur.status && cur.status.sleeping && !awake()) { wokeAt = Date.now(); notify({ woke: true }); } }
  /* 睡覺(晚上 11 點到早上 7 點,點一下醒來)、肚子餓(今天還沒餵、也還沒達標)、其他時候待機 */
  function mood(v) {
    const s = (v || cur).status;
    return !s ? 'idle' : s.sleeping && !awake() ? 'sleep' : s.hungry && !s.metToday ? 'hungry' : 'idle';
  }
  function nameOf(v) { return ((v || cur).status && (v || cur).status.name) || '小雞'; }
  /* 斷掉時不寫「連續 0 天」,改寫一起練了幾天;從沒練過什麼都不寫 */
  function streakText(s) { return s.streak > 0 ? '連續 ' + s.streak + ' 天' : s.practicedDays > 0 ? '一起練了 ' + s.practicedDays + ' 天' : ''; }
  function label(v) { const t = streakText((v || cur).status); return nameOf(v) + (t ? '，' + t : ''); }

  /* ---------- 小雞動畫:看得到(畫面上、分頁在前景)才動 ---------- */
  /* opt:{ maxDpr, variants }(餵食面板 160 px 的小雞用 1.5 與 1,規格 A.9);沒給就跟第 1 步一樣 */
  function chick(canvas, size, onTick, opt) {
    const M = A.metrics;
    canvas.style.width = size + 'px';
    canvas.style.height = Math.round(size * M.height / M.width) + 'px';
    canvas.setAttribute('aria-hidden', 'true');
    let anim = null, base = 'idle', queue = [], seen = false, held = false, running = false, eatT = 0;
    const lens = {};
    const len = (p) => lens[p] || (lens[p] = A.holds(p).reduce((a, b) => a + b, 0));
    const want = () => (queue.length ? queue[0].pose : base);
    function tick(t) {
      if (onTick) onTick(t);
      if (!queue.length || t.pose !== queue[0].pose || --queue[0].left > 0) return;
      queue.shift();
      setTimeout(() => { if (anim && running && anim.pose !== want()) anim.setPose(want()); }, 0);
    }
    function sync() {
      const go = seen && !held && doc.visibilityState !== 'hidden';
      if (!go) { if (eatT) { clearTimeout(eatT); eatT = 0; queue = []; } if (anim && running) anim.stop(); running = false; return; }
      if (running) return;
      running = true;
      if (!anim) {
        anim = A.animate(canvas, opt ? { size, fps: 8, maxDpr: opt.maxDpr || 2, variants: opt.variants || 2, pose: want(), onTick: tick }
          : { size, fps: 8, maxDpr: 2, pose: want(), onTick: tick });
        return;
      }
      if (anim.pose !== want()) anim.setPose(want()); else anim.setFps(8);
    }
    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((es) => { seen = es[es.length - 1].isIntersecting; sync(); });
      io.observe(canvas);
    } else { seen = true; }
    doc.addEventListener('visibilitychange', sync);
    sync();
    /* 播一次(例如吃東西再開心),播完回到 base;減少動態或看不到時不播 */
    function play(list) {
      if (REDUCE || !running) return;
      clearTimeout(eatT); eatT = 0;
      queue = list.map((p) => ({ pose: p, left: len(p) }));
      if (queue.length) anim.setPose(queue[0].pose); else if (anim.pose !== base) anim.setPose(base);
    }
    /* 吃 n 口再播 after(規格 3.6;預覽 eatSeq):eat 第 1 到 5 格,口數不夠就重複第 4、5 格,最後第 6、7 格,每秒 8 格;引擎的 eat
       只啄 2 下,要咬 3、4 口的食物會剩一截直接消失(第三輪審查 #10)。啄地那格照樣經過 onTick 咬一口。看不到、減少動態時不播,
       回 false;播到一半看不到了就停,回來時回到 base(舞台的食物由 onTick 收掉) */
    function eat(n, after) {
      if (REDUCE || !running || typeof anim.show !== 'function') return false;
      const fr = [1, 2, 3, 4, 5];
      for (let k = 2; k < n; k++) fr.push(4, 5);
      fr.push(6, 7, 7);
      clearTimeout(eatT); queue = [{ pose: 'eat', left: Infinity }];
      let i = 0;
      const step = () => {
        eatT = 0;
        if (!running) return;
        if (i >= fr.length) { queue = []; play(after || []); return; }
        anim.show(fr[i], i === fr.length - 1 ? 1 : 0, 'eat');   // 最後一格換另一組線條(預覽 [7, 1])
        if (onTick) onTick({ pose: 'eat', frame: fr[i], tick: i, travel: 0 });
        i++; eatT = setTimeout(step, 125);
      };
      step(); return true;
    }
    return {
      setBase(p) { base = p; if (running && !queue.length && anim.pose !== p) anim.setPose(p); },
      play, eat,
      /* 停在某個姿勢 ms 毫秒再回到 base(減少動態時吃東西、搖頭用;那時 animate 只畫靜止格);then 在換上去之後馬上呼叫 */
      still(p, ms, then, k) {
        if (!anim || !running) return;
        clearTimeout(eatT); eatT = 0;
        const mine = { pose: p, left: Infinity };   // 時間到只收自己這一段(接著開始吃的那段不收)
        queue = [mine];
        if (k === undefined || REDUCE || typeof anim.show !== 'function') anim.setPose(p); else anim.show(k, 0, p);   // k:停在第 k 格(餵點心時張嘴)
        if (then) then();
        setTimeout(() => { if (queue[0] !== mine) return; queue = []; if (anim && running) anim.setPose(want()); }, ms);
      },
      hold(on, show) { held = !!on; if (show) seen = true; sync(); },   // show:不在畫面上也畫(列印前;第三輪複查 #2)
      destroy() { held = true; sync(); if (io) io.disconnect(); doc.removeEventListener('visibilitychange', sync); },
      get pose() { return anim ? anim.pose : want(); },
      get busy() { return queue.length > 0; },
      reduced: REDUCE,
    };
  }

  /* ---------- 更新 ---------- */
  function notify(ev) {
    cur = S.view();
    subs.forEach((f) => { try { f(cur, ev || {}); } catch (e) { console.warn('小雞畫面更新失敗：', e); } });
  }
  function onChange(f) { subs.push(f); f(cur, {}); }
  window.addEventListener('pet:change', () => notify());
  if (FOOD) window.addEventListener('pet:earn', () => { if (sheet) notify(); });   // 面板開著時拿到點心就重畫
  /* 過了午夜、到了睡覺時間:每分鐘看一次,有變才重畫 */
  setInterval(() => {
    if (doc.visibilityState === 'hidden') return;
    const v = S.view();
    if (!v.status || !cur.status || v.status.today !== cur.status.today || mood(v) !== mood(cur)) notify();
  }, 60e3);

  /* 回傳有沒有餵成(食物模式的舞台用來決定飼料要不要收回去) */
  async function feed() {
    if (feeding) return false;
    const n = cur.status ? cur.status.food : 0;
    feeding = true; msg = ''; wake(); notify();
    let r;
    try { r = await S.feed(); } catch (e) { r = { ok: false, reason: 'error' }; }
    feeding = false;
    if (r && r.ok) { msg = '餵了 ' + n + ' 顆。'; notify({ fed: n }); return true; }
    /* 唯讀(資料讀不到、時鐘不對)與沒有飼料:action() 已經寫了原因,這裡不重複 */
    msg = r && (r.reason === 'readOnly' || r.reason === 'clock' || r.reason === 'noFood') ? '' : '沒有存到，再試一次。';
    notify();
    return false;
  }
  /* 改目標、取名的結果(what 是「名字」或「目標」):成功不寫;唯讀(資料讀不到、新版網頁存的、時鐘不對)再試也沒用,
     說一句沒有改和原因,跟 action() 的說明對得上(按下去才發現唯讀時,學生要知道剛打的名字或選的目標沒有存);
     其他失敗(出錯、登出、沒存成)才請學生再試一次 */
  function saveMsg(r, what) {
    if (r && r.ok) return '';
    if (r && r.reason === 'clock') return what + '沒有改，這台裝置的日期不對，調好以後再改。';
    if (r && r.reason === 'readOnly') return what + '沒有改，這台先不能改小雞的資料。';
    return '沒有存到，再試一次。';
  }
  async function setGoal(n) {
    msg = '';
    let r;
    try { r = await S.setGoal(n); } catch (e) { r = { ok: false }; }
    msg = saveMsg(r, '目標'); notify();
  }

  /* ---------- 共用的內容 ---------- */
  /* 餵完沒有飼料時換成這個連結;data-focus 跟餵食按鈕一樣,鍵盤焦點會從按鈕移到它 */
  /* plain:食物模式的空托盤用一般按鈕樣式(規格 3.7,不催) */
  function goLink(plain) {
    let done = false;
    try { done = !!(window.DAILY && DAILY.progress(store.get(DAILY.KEY, null), DAILY.dateOf(Date.now())).complete); } catch (e) { done = false; }
    const cls = plain ? 'btn pet-go' : 'btn primary pet-go', key = plain ? 'go' : 'feed';
    return done ? h('a', { class: cls, href: 'drill.html', 'data-focus': key }, '去答題')
      : h('a', { class: cls, href: 'daily.html', 'data-focus': key }, '去做每日練習');
  }
  function roText(v) { return v.newer ? '小雞的資料是新版網頁存的，這台先不能餵。' : v.reason === 'clock' ? '這台裝置的日期不對，調好以後再餵。' : '小雞的資料讀不到，這台先不能餵。'; }
  /* noGo:首頁那張卡就在每日練習下面,沒有飼料時不再放一個去每日練習的按鈕 */
  function action(v, noGo) {
    const s = v.status;
    if (v.readOnly) return h('p', { class: 'pet-note' }, roText(v));
    if (s.food > 0 || feeding) {
      /* 存的時候用 aria-disabled、不用 disabled:按鈕留得住焦點(feeding 擋住重複按) */
      return h('button', { class: 'btn primary pet-feed', type: 'button', 'data-focus': 'feed', 'aria-disabled': feeding ? 'true' : null, onclick: feed },
        '餵牠（' + s.food + ' 顆）');
    }
    return noGo ? null : goLink();
  }
  function todayLine(s) {
    return [
      h('p', { class: 'pet-today' }, '今天 ', h('b', null, String(s.todayCount)), ' / ' + s.goal + ' 題'),
      h('span', { class: 'pet-bar' + (s.metToday ? ' is-met' : ''), 'aria-hidden': 'true' },
        h('i', { style: 'width:' + Math.min(100, Math.round(s.todayCount / s.goal * 100)) + '%' })),
    ];
  }
  function streakLine(s) {
    const t = streakText(s);
    if (!t) return null;
    return h('p', { class: 'pet-streak' }, t + (s.streak > 0 && s.shields > 0 ? '，保護卡 ' + s.shields + ' 張' : ''));
  }
  /* 最近 7 天有沒有練(Duolingo 連續天數畫面的一週列) */
  function week(v) {
    const days = (v.pet && v.pet.days) || {};
    const today = v.status.today;
    let n = 0;
    const cells = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i);
      const did = (days[d] || 0) > 0;
      if (did) n++;
      cells.push(h('span', { class: 'pet-day' + (did ? ' is-on' : '') + (i === 0 ? ' is-today' : '') },
        h('i', { class: 'pet-dot' }), WEEK[new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay()]));
    }
    return h('div', { class: 'pet-week', role: 'img', 'aria-label': '最近 7 天練了 ' + n + ' 天' }, cells);
  }
  function goalControl(v, idp) {
    const s = v.status;
    return h('div', { class: 'pet-goal' },
      h('span', { class: 'pet-goal-l', id: idp + '-goal' }, '每日目標'),
      h('div', { class: 'pet-seg', role: 'group', 'aria-labelledby': idp + '-goal' }, GOALS.map((n) =>
        h('button', { class: 'pet-seg-b', type: 'button', 'data-focus': 'goal' + n, 'aria-pressed': String(s.nextGoal === n), disabled: v.readOnly ? '' : null,
          onclick: () => { if (s.nextGoal !== n) setGoal(n); } }, n + ' 題'))),
      h('p', { class: 'pet-goal-note' }, s.nextGoal !== s.goal ? '明天起每天 ' + s.nextGoal + ' 題。' : '改了從明天開始。'));
  }
  /* 訪客的小雞不會搬到帳號裡(cloud.js 不搬訪客資料);網站沒開雲端時沒有登入,不提 */
  function notes(v, full) {
    return [full && v.status.streak > 0 && v.status.shields > 0 ? h('p', { class: 'pet-note' }, '漏掉一天會自動用掉一張保護卡。') : null,
      v.guest && v.cloud ? h('p', { class: 'pet-note' }, '登入後換成帳號裡的小雞。') : null].filter(Boolean);
  }
  /* 重畫一塊內容,焦點原本在裡面的話放回同一個 data-focus;找不到就放到 fallback(例如首頁卡片的小雞) */
  function paint(box, nodes, fallback) {
    const a = doc.activeElement;
    const key = a && box.contains(a) ? a.getAttribute('data-focus') : null;
    box.replaceChildren(...nodes.flat().filter(Boolean));
    if (!key) return;
    const b = box.querySelector('[data-focus="' + key + '"]');
    if (b && !b.disabled) b.focus();
    else if (fallback && fallback.isConnected) fallback.focus();
  }
  function moodOf(c, v, ev) { c.setBase(mood(v)); if (ev.fed) c.play(['eat', 'happy']); }
  /* 「小雞在頁面上走動」開關(ROAM2 才放;WCAG 2.2.2,規格 1.8) */
  let roamSaving = false;
  function roamRow(v) {
    const on = v.roam !== false;
    return h('div', { class: 'pet-switch-row' }, h('span', { id: 'pet-roam-l' }, '小雞在頁面上走動'),
      h('button', { class: 'pet-switch', type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-labelledby': 'pet-roam-l', 'data-focus': 'roam',
        'aria-disabled': roamSaving || v.readOnly ? 'true' : null, onclick: (e) => setRoam(!on, e.currentTarget) }));
  }
  async function setRoam(on, b) {
    if (roamSaving || cur.readOnly) return;
    roamSaving = true; msg = '';
    if (b) b.setAttribute('aria-disabled', 'true');
    let r;
    try { r = await S.setRoam(on); } catch (e) { r = { ok: false }; }
    roamSaving = false; msg = saveMsg(r, '設定'); notify();
  }

  /* ---------- 餵食區(PET_FOOD;規格第 3 節、契約第 6 節) ---------- */
  const F = window.FoodArt;
  const HINT_KEY = 'tr_pet_hint', HINT_TIMES = 3, MAX_STOCK = 9;    // HINT_KEY:「點一下就餵」出現過幾次(前 3 次打開面板才出現)
  const FLY_MS = 300, EAT_MS = 1200, NOPE_MS = 750, STILL_MS = 1000, LONG_MS = 500, TIP_MS = 1200;
  const LAND_Q = '(orientation: landscape) and (max-height: 500px)';
  /* 舞台上的位置,跟 css 那一塊對齊:食物在小雞嘴前(對舞台中線的位移、上緣),愛心從頭頂冒出來 */
  const STAGE = { port: { chick: 160, food: 56, dx: 36, top: 126, cx: -12, head: 65, rise: 46 }, land: { chick: 96, food: 40, dx: 22, top: 51, cx: -7, head: 20, rise: 16 } };
  const LOCK = '今天練習一下，就可以餵點心。';
  const HEART = "<svg viewBox='0 0 30 28' width='15' height='14' aria-hidden='true' focusable='false'><path d='M15 26C8 20.5 2.6 15.8 2.4 9.6 2.2 5.2 5.5 2.3 9.1 2.6c2.6.2 4.6 2 5.8 4.1 1.3-2.3 3.4-4.2 6.2-4.2 3.7 0 6.6 3.2 6.2 7.4-.6 6-6.2 10.6-12.3 16.1z' fill='#ff7a93' stroke='#151515' stroke-width='2.4' stroke-linejoin='round'/></svg>";
  function foodName(id) {
    try { const n = P.foodName && P.foodName(id); if (n) return n; } catch (e) { /* 舊版 pet.js */ } return F && F.info && F.info[id] ? F.info[id].name : '';
  }
  /* 常識提示只用規格那兩句,其他食物等查證來源(契約 12 第 10 條) */
  function tipOf(id) { return id === 'grain' ? '' : id === 'corn' ? '玉米要壓碎再給小雞，整顆太大。' : '點心只占一小部分，主食還是飼料。'; }
  function hintTurn() {
    try {
      const n = parseInt(localStorage.getItem(HINT_KEY), 10) || 0;
      if (n >= HINT_TIMES) return false;
      localStorage.setItem(HINT_KEY, String(n + 1));
      return true;
    } catch (e) { return true; }
  }
  function eatFail(fn, why) { return why === 'clock' ? fn + '沒有餵，這台裝置的日期不對，調好以後再餵。' : why === 'readOnly' ? fn + '沒有餵，這台先不能改小雞的資料。' : '沒有存到，再試一次。'; }
  /* 吃點心時把 eat 姿勢自帶的飼料色碎屑藏起來(碎屑交給食物自己噴,規格 3.6) */
  function crumbless(g) {
    return new Proxy(g, {
      get(t, p) { const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; },
      set(t, p, v) { t[p] = p === 'fillStyle' && typeof v === 'string' && v.toLowerCase() === '#c98a1c' ? 'rgba(0,0,0,0)' : v; return true; },
    });
  }
  function plainFrame(cv, size, pose, k) {
    const g = cv.getContext && cv.getContext('2d');
    if (!g || typeof A.drawFrame !== 'function') return;
    const px = cv.width / A.metrics.width;
    try {
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.setTransform(px, 0, 0, px, 0, 0);
      A.drawFrame(crumbless(g), pose, k, { size, variant: 0 });
      g.setTransform(1, 0, 0, 1, 0, 0);
    } catch (e) { console.warn('小雞畫面更新失敗：', e); }
  }
  /* 托盤小圖:每種只畫一張、不動(規格 3.3)。塗鴉畫法很花時間(9 種在手機上要好幾百毫秒),點下去那一下只放大小定好的
     空白畫布交給 later 排隊,面板出來以後才一格一格畫;這一頁畫好的留著,再打開直接用 */
  const iconImg = {}, iconDpr = () => Math.min(2, window.devicePixelRatio || 1);
  function icon(id, later) {
    const cv = h('canvas', { class: 'pet-tile-cv', 'aria-hidden': 'true' });
    if (!F) return cv;
    cv.width = cv.height = Math.round(40 * iconDpr());
    if (iconImg[id + iconDpr()] || !later) paintIcon(cv, id); else later(cv, id);
    return cv;
  }
  function paintIcon(cv, id) {
    try {
      const k = id + iconDpr(), img = iconImg[k] || (iconImg[k] = F.render(id, { size: 40, variant: 0, dpr: iconDpr() }));
      if (cv.width !== img.width || cv.height !== img.height) { cv.width = img.width; cv.height = img.height; }
      const g = cv.getContext && cv.getContext('2d');
      if (g) g.drawImage(img, 0, 0);
    } catch (e) { console.warn('小雞畫面更新失敗：', e); }
  }

  /* o:{ mask, box, live, chick() }。回傳面板要放的元素和 draw、onTick 等 */
  function makeFeed(o) {
    const geo = () => (mq(LAND_Q) ? STAGE.land : STAGE.port);
    const cv = h('canvas', { class: 'pet-big' });
    const food = h('canvas', { class: 'pet-stage-food', 'aria-hidden': 'true' });
    food.hidden = true;   // 只在吃的時候出現
    const stage = h('div', { class: 'pet-stage' }, cv, food);
    const line = h('p', { class: 'pet-snack-line' });
    const tray = h('div', { class: 'pet-tray', role: 'toolbar', 'aria-label': '食物' });
    const hint = h('p', { class: 'pet-hint' });
    const hintOn = hintTurn();
    const timers = [], flyers = [];
    let tiles = [], idx = 0, busy = false, pending = null, stageM = null, tok = 0, sawEat = false, noCrumbs = false, spinNext = false;
    let tipEl = null, kbd = false, closed = false, empty = null;
    const later = (f, ms) => { const t = setTimeout(() => { if (!closed) f(); }, ms); timers.push(t); return t; };
    o.mask.addEventListener('pointerdown', () => { kbd = false; });
    o.box.addEventListener('scroll', () => hideTip());   // 提示是 fixed,面板捲動就收起來,不會離開格子

    function say(t) { msg = t; o.live.textContent = ''; later(() => { if (msg === t) o.live.textContent = t; }, 30); }   // 先清掉再寫,同一句也會再念一次
    /* 畫面用的 pantry:剛吃的那一口還在存的時候,份數和「吃過了」先照吃完算(規格 3.4 當下一起更新) */
    function pan(v) {
      const p = v.pantry || { stock: {}, order: [], practiced: false, ateToday: false, gotToday: null, fav: '', favKnown: false };
      if (!pending) return p;
      return Object.assign({}, p, { stock: Object.assign({}, p.stock, { [pending.id]: pending.left }), ateToday: true, ateFood: pending.id,
        canSnack: false, favKnown: p.favKnown || pending.first });
    }
    function stateOf(id, v, p) {
      const snack = id !== 'grain';
      const n = snack ? Math.max(0, (p.stock && p.stock[id]) || 0) : feeding ? 0 : Math.max(0, v.status.food || 0);
      const full = snack && n >= MAX_STOCK, fav = snack && id === p.fav && !!p.favKnown;
      const locked = snack && n > 0 && !p.practiced, done = snack && n > 0 && !!p.practiced && !!p.ateToday;
      const count = n + (snack ? ' 份' : ' 顆'), text = count + (full ? '，滿了' : '');   // 格子上「滿了」自己一行(預覽 .ff)
      const name = foodName(id) + (fav ? '，最喜歡的' : '') + '，' + text;
      const label = n === 0 || v.readOnly ? name : !snack ? name + '，全部餵牠' : locked ? name + '，今天練習一下才能餵' : done ? name + '，今天的點心餵過了' : name + '，餵一份';
      const hold = busy || feeding;
      return { n, count, full, label, fav, off: !!v.readOnly || n === 0 || locked || done || hold,
        cls: { 'is-empty': n === 0, 'is-locked': locked, 'is-done': done, 'is-full': full, 'is-fav': fav, 'is-busy': hold } };
    }
    function rove() { tiles.forEach((t, i) => t.b.setAttribute('tabindex', i === idx ? '0' : '-1')); }
    /* 托盤小圖排隊:面板的第一格先出去,之後每個畫面畫一格;關掉面板就停 */
    const paintQ = [], frame = (f) => { const go = () => { if (!closed) f(); }; if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(go); else later(go, 16); };
    function pump() { const j = paintQ.shift(); if (j) paintIcon(j[0], j[1]); if (paintQ.length) frame(pump); }
    function queueIcon(c, id) { if (paintQ.push([c, id]) === 1) frame(() => frame(pump)); }
    function build(ids) {
      const a = doc.activeElement, had = a && tray.contains(a) ? a.getAttribute('data-focus') : null;
      const was = tiles[idx] ? tiles[idx].id : 'grain';
      hideTip();
      tiles = ids.map((id) => {
        const tip = tipOf(id);
        const b = h('button', { class: 'pet-tile', type: 'button', 'data-focus': 'food-' + id, tabindex: '-1', 'aria-describedby': tip ? 'pet-tip-' + id : null },
          icon(id, queueIcon), h('span', { class: 'pet-tile-n' }, foodName(id)), h('span', { class: 'pet-tile-c' }), h('span', { class: 'pet-tile-f' }));
        wire(b, id);
        return { id, b, sr: tip ? h('span', { class: 'pet-sr', id: 'pet-tip-' + id }, tip) : null };
      });
      tray.replaceChildren(...tiles.map((t) => [t.b, t.sr]).flat().filter(Boolean));
      idx = Math.max(0, ids.indexOf(was));
      rove();
      if (had) { const t = tiles.find((x) => 'food-' + x.id === had); (t || tiles[idx]).b.focus(); }
    }
    function wire(b, id) {
      let lp = 0, held = false;
      b.addEventListener('click', (e) => { if (held) { held = false; e.preventDefault(); return; } act(id); });
      b.addEventListener('focus', () => { idx = Math.max(0, tiles.findIndex((t) => t.b === b)); rove(); if (kbd) showTip(b, id); });
      b.addEventListener('blur', hideTip);
      b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTip(b, id); });
      b.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
      /* 長按 0.5 秒出現提示,這次放開不算點 */
      b.addEventListener('pointerdown', (e) => {
        kbd = false;
        if (e.pointerType === 'mouse') return;
        held = false; clearTimeout(lp);
        lp = later(() => { held = true; showTip(b, id); }, LONG_MS);
      });
      const up = () => { clearTimeout(lp); if (held) later(hideTip, TIP_MS); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    /* 工具列的鍵盤(WAI-ARIA toolbar):左右一格、Home、End;Enter、空白鍵交給按鈕本身 */
    tray.addEventListener('keydown', (e) => {
      const n = tiles.length, k = e.key;
      let i;
      if (k === 'ArrowRight') i = Math.min(n - 1, idx + 1);
      else if (k === 'ArrowLeft') i = Math.max(0, idx - 1);
      else if (k === 'Home') i = 0;
      else if (k === 'End') i = n - 1;
      else return;
      e.preventDefault();
      idx = i; rove();
      tiles[i].b.focus();
    });
    function showTip(b, id) {
      hideTip();
      const t = tipOf(id);
      if (!t || closed) return;
      tipEl = h('div', { class: 'pet-tip', role: 'tooltip' }, t);
      o.mask.append(tipEl);
      try {
        const r = b.getBoundingClientRect(), w = tipEl.offsetWidth;
        tipEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
        tipEl.style.top = Math.max(8, r.top - tipEl.offsetHeight - 6) + 'px';
      } catch (e) { /* 量不到就留在 css 的預設位置 */ }
    }
    function hideTip() { if (!tipEl) return false; tipEl.remove(); tipEl = null; return true; }

    function draw(v, ev) {
      const p = pan(v);
      const ids = ['grain'].concat((p.order || []).filter((id) => id !== 'grain'));
      if (ids.join() !== tiles.map((t) => t.id).join()) build(ids);
      tray.classList.toggle('is-ro', !!v.readOnly);
      tiles.forEach((t) => {
        const st = stateOf(t.id, v, p);
        Object.keys(st.cls).forEach((c) => t.b.classList.toggle(c, st.cls[c]));
        const c = t.b.querySelector('.pet-tile-c'), ff = t.b.querySelector('.pet-tile-f'), fw = st.full ? '滿了' : '';
        if (c.textContent !== st.count) c.textContent = st.count;
        if (ff.textContent !== fw) ff.textContent = fw;
        t.b.setAttribute('aria-label', st.label);
        if (st.off) t.b.setAttribute('aria-disabled', 'true'); else t.b.removeAttribute('aria-disabled');
        const heart = t.b.querySelector('.pet-heart');
        if (st.fav && !heart) t.b.append(h('span', { class: 'pet-heart', 'aria-hidden': 'true', html: HEART }));
        else if (!st.fav && heart) heart.remove();
      });
      /* 今天的券沒有結束畫面講過(達標 m),或看不出是不是結束畫面給的(地瓜 y、麵包蟲 w:):打開面板時講(規格 4.3) */
      const told = !!p.gotToday && /^(m|y|w:.*)$/.test(p.gotToday.id || '');
      const lt = p.ateToday ? '今天的點心吃過了，明天再餵。' : told ? '今天拿到 1 份' + foodName(p.gotToday.food) + '。' : '';
      if (line.textContent !== lt) line.textContent = lt;
      const stocked = (p.order || []).some((id) => ((p.stock && p.stock[id]) || 0) > 0);
      const grain = !feeding && v.status.food > 0;
      const ht = v.readOnly ? roText(v) : !p.practiced && stocked ? LOCK : hintOn && (grain || stocked) ? '點一下就餵' : '';
      if (hint.textContent !== ht) hint.textContent = ht;
      const none = !v.readOnly && !feeding && !grain && !stocked;
      if (none && !empty) {
        empty = h('div', { class: 'pet-empty' }, h('p', null, '答題就有飼料，每天第一個完成的練習有一份點心。'), goLink(true));
        hint.after(empty);
      } else if (!none && empty) {
        if (empty.contains(doc.activeElement)) tiles[0].b.focus();
        empty.remove(); empty = null;
      }
      if (ev && ev.fed && REDUCE) o.chick().still('eat', STILL_MS);
    }
    function redraw() { if (!closed) draw(cur, {}); } function hold(ms) { busy = true; redraw(); later(() => { busy = false; redraw(); }, ms); }

    function act(id) {
      const v = cur, p = pan(v);
      if (closed || busy || feeding || v.readOnly || !v.status) return;
      if (stateOf(id, v, p).n === 0) return;
      wake();
      if (id === 'grain') { grain(); return; }
      if (!p.practiced) { say(LOCK); return; }
      if (p.ateToday) { refuse(id); return; }
      snack(id, p);
    }
    /* 飼料到了舞台、也存好了才吃(每一口都咬到);小雞沒播(看不到)就收回去 */
    async function grain() {
      let t = 0, here = false, ok = false, go = false;
      const eat = () => { if (go || closed || !here || !ok) return; go = true; if (!o.chick().eat(steps('grain'), ['happy'])) unserve(t); };
      t = serve('grain', () => { here = true; eat(); });
      ok = await feed();
      if (closed) return;
      if (!ok) { unserve(t); return; }
      hold(EAT_MS); eat();
      backstop(t, EAT_MS * 2);   // 小雞沒播到(例如畫面外)時也收回去
    }
    /* 備用的收食物(#8):時間到了小雞還在吃(eat、開心還在播,或咬完了碎屑還在落)就隔 0.5 秒再看,切到背景、不吃了、多等 8 秒才收(chick2 第三輪修正 #5:慢的手機吃到一半食物不見) */
    function backstop(t, ms, left = 16) { later(() => { if (t === tok) { if (left > 0 && doc.visibilityState !== 'hidden' && eatingNow()) backstop(t, 500, left - 1); else unserve(t); } }, ms); }
    function eatingNow() { try { return !!o.chick().busy || sawEat || !!(stageM && stageM.step >= stageM.steps); } catch (e) { return false; } }
    function snack(id, p) {
      const first = id === p.fav && !p.favKnown;
      let r;
      try { r = S.eat(id); } catch (e) { r = { ok: false, reason: 'error' }; }
      const fn = foodName(id);
      if (!r || !r.ok) {
        const why = r && r.reason;
        if (why === 'ateToday') refuse(id);
        else if (why === 'notToday') say(LOCK);
        else if (why === 'none') redraw();
        else say(eatFail(fn, why));
        return;
      }
      pending = { id, left: Math.max(0, Math.floor(r.left) || 0), first };
      say(nameOf() + '吃了' + fn + '。' + (pending.left > 0 ? '還有 ' + pending.left + ' 份。' : '') + (first ? '牠最喜歡' + fn + '。' : ''));
      if (REDUCE) {
        hold(STILL_MS);
        o.chick().still('eat', STILL_MS, () => plainFrame(cv, geo().chick, 'eat', A.calm.eat || 0));
        if (first) hearts();
      } else {
        hold(EAT_MS);
        spinNext = first;
        o.chick().still('happy', FLY_MS + 300, null, 0);   // 食物靠近時張嘴(規格 3.6;預覽 eatIt 的 happy 第 1 格),到了才吃
        const t = serve(id, () => { noCrumbs = true; if (!o.chick().eat(steps(id), ['happy'])) unserve(tok); });
        backstop(t, FLY_MS + EAT_MS * 2);   // 切到背景、畫面外時小雞沒吃,也收回去(第三輪審查 #8)
      }
      Promise.resolve(r.saved).then((s) => s, () => ({ ok: false, reason: 'error' })).then((s) => {
        pending = null;
        if (!s || !s.ok) msg = eatFail(fn, s && s.reason);
        notify();
      });
    }
    /* 今天的點心吃過了:搖頭,食物飛回托盤,不扣(規格 3.5) */
    function refuse(id) {
      say(nameOf() + '今天吃過點心了，明天再餵。');
      if (REDUCE) { hold(STILL_MS); o.chick().still('nope', STILL_MS); return; }
      hold(FLY_MS * 2 + NOPE_MS);
      const t = serve(id, () => o.chick().play(['nope']));
      later(() => { unserve(t); fly(id, true, () => {}); }, FLY_MS + NOPE_MS);
    }

    /* 舞台上的那份食物:從格子沿弧線飛過來(0.3 秒),到了才掛上去;減少動態時不上舞台 */
    function serve(id, then) {
      const t = ++tok;
      if (REDUCE || !F) { if (then) then(); return t; }
      fly(id, false, () => {
        if (closed || t !== tok) return;
        stopStage();
        food.hidden = false; sawEat = false;
        try { stageM = F.mount(food, id, { size: geo().food, stagger: false, maxDpr: 2, onDone: () => unserve(t) }); } catch (e) { stageM = null; food.hidden = true; }
        if (then) then();
      });
      return t;
    }
    function stopStage() { if (stageM) { try { stageM.stop(); } catch (e) { /* 已經停了 */ } stageM = null; } }
    function unserve(t) { if (t !== tok) return; stopStage(); food.hidden = true; sawEat = false; noCrumbs = false; }
    function fly(id, back, done) {
      const tile = tiles.find((x) => x.id === id);
      const fl = F && tile ? h('canvas', { class: 'pet-tile-fly', 'aria-hidden': 'true' }) : null;
      if (!fl || typeof fl.animate !== 'function' || typeof stage.getBoundingClientRect !== 'function') { done(); return; }
      try {
        const g = geo(), fs = g.food;
        const from = tile.b.querySelector('canvas').getBoundingClientRect(), sr = stage.getBoundingClientRect();
        const to = { left: sr.left + sr.width / 2 + g.dx, top: sr.top + g.top };
        const img = F.render(id, { size: fs, variant: 0, dpr: Math.min(2, window.devicePixelRatio || 1) });
        fl.width = img.width; fl.height = img.height; fl.style.width = fs + 'px'; fl.style.height = fs + 'px';
        fl.getContext('2d').drawImage(img, 0, 0);
        fl.style.left = to.left + 'px'; fl.style.top = to.top + 'px';
        o.mask.append(fl); flyers.push(fl);
        const dx = from.left + from.width / 2 - (to.left + fs / 2), dy = from.top + from.height / 2 - (to.top + fs / 2), s0 = 40 / fs, frames = [];
        for (let i = 0; i <= 10; i++) {
          const q = back ? 1 - i / 10 : i / 10;
          frames.push({ transform: 'translate(' + (dx * (1 - q)).toFixed(1) + 'px,' + (dy * (1 - q) - 280 * q * (1 - q)).toFixed(1) + 'px) scale(' + (s0 + (1 - s0) * q).toFixed(3) + ')' });
        }
        /* 動畫停住(分頁切到背景、畫面沒在畫)時也照時間收尾,不會卡在半路 */
        let fin = false;
        const end = () => { if (fin) return; fin = true; fl.remove(); done(); };
        fl.animate(frames, { duration: FLY_MS, easing: 'linear', fill: 'forwards' }).onfinish = end;
        later(end, FLY_MS + 150);
      } catch (e) { fl.remove(); done(); }
    }
    /* 小雞每一格:吃點心時蓋掉飼料色碎屑;eat 第 3、5 格咬一口;離開 eat 就收掉食物;最愛第一次吃到 happy 第 3 格轉一圈 */
    const steps = (id) => (F && F.info && F.info[id] && F.info[id].steps) || 2;
    function onTick(t) {
      if (t.pose === 'eat') {
        sawEat = true;
        if (noCrumbs) plainFrame(cv, geo().chick, 'eat', t.frame);
        if (stageM && F && F.chickImpactFrames.indexOf(t.frame) >= 0) { try { stageM.bite(); } catch (e) { /* 照樣播 */ } }
        return;
      }
      /* 離開 eat:每一口都咬了就等最後的碎屑落地(onDone 收);還有剩(看不到時停下來)才直接吃完 */
      if (sawEat) { sawEat = false; noCrumbs = false; if (stageM && !(stageM.step >= stageM.steps)) { try { stageM.finish(); } catch (e) { unserve(tok); } } }
      if (t.pose === 'happy' && t.frame === 3 && spinNext) { spinNext = false; spin(); }
    }
    function spin() {
      try { if (typeof cv.animate === 'function') cv.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(-1)', offset: 0.5 }, { transform: 'scaleX(1)' }], { duration: 520, easing: 'ease-in-out' }); } catch (e) { /* 不轉 */ }
      hearts();
    }
    /* 頭上冒 3 顆塗鴉愛心,照預覽 heartPath/hearts:每秒 7 張、每張線條重抖(±0.8)、左右晃、1.1 秒升起、最後 1/4 淡出;減少動態畫一張(進度 0.4)停 1 秒 */
    function hearts() {
      const g = geo(), dpr = Math.min(2, window.devicePixelRatio || 1), W = 96, TOP = 24, HT = TOP + g.head + 12, c = h('canvas', { class: 'pet-pop', 'aria-hidden': 'true' });
      const gx = c.getContext && c.getContext('2d');
      if (!gx) return;
      Object.assign(c, { width: W * dpr, height: HT * dpr });
      Object.assign(c.style, { width: W + 'px', height: HT + 'px', left: 'calc(50% + ' + (g.cx - W / 2) + 'px)', top: -TOP + 'px' });
      stage.append(c);
      let f = 0, seed = 1; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
      const paint = (tt) => {
        gx.setTransform(dpr, 0, 0, dpr, 0, 0); gx.clearRect(0, 0, W, HT);
        [[-26, 0, 18], [22, 0.18, 15], [-2, 0.36, 21]].forEach(([dx, d, s]) => {
          const p = REDUCE ? 0.4 : Math.min(1, Math.max(0, (tt - d) / 1.1)), cx = W / 2 + dx + Math.sin(p * 6) * 3, cy = TOP + g.head - s / 2 - p * g.rise;
          if (p <= 0 || p >= 1) return;
          gx.globalAlpha = p > 0.75 ? (1 - p) / 0.25 : 1; gx.beginPath();
          for (let i = 0, a = 0; i <= 24; a = ++i / 24 * Math.PI * 2) {
            gx[i ? 'lineTo' : 'moveTo'](cx + 16 * Math.sin(a) ** 3 * s / 32 + r() * 1.6, cy - (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * s / 32 + r() * 1.6);
          }
          gx.closePath(); gx.fillStyle = '#ff7a93'; gx.fill(); gx.lineWidth = 2.2; gx.lineJoin = 'round'; gx.strokeStyle = '#151515'; gx.stroke(); gx.globalAlpha = 1;
        });
      };
      const step = () => { if (f > 11) { c.remove(); return; } paint(f++ / 7); later(step, 1000 / 7); };
      if (REDUCE) { paint(0); later(() => c.remove(), STILL_MS); } else step();
    }
    function destroy() { closed = true; timers.forEach(clearTimeout); tok++; stopStage(); hideTip(); flyers.forEach((f) => f.remove()); }
    return { els: [stage, line, tray, hint], cv, size: () => geo().chick, draw, onTick, hideTip, keyed: () => { kbd = true; }, destroy };
  }

  /* ---------- 餵食面板(底部彈出) ---------- */
  let sheet = null;
  /* opt.noGoal:從「我的」頁那一區打開,那裡已經有每日目標 */
  function openSheet(opener, opt) {
    if (sheet || doc.querySelector('.modal-mask')) return;
    const noGoal = !!(opt && opt.noGoal);
    wake();
    msg = '';
    const mask = h('div', { class: 'pet-mask is-off is-opening' });
    const box = h('div', { class: 'pet-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pet-sheet-h' });
    const top = h('div', { class: 'pet-sheet-top' }, h('span', { class: 'pet-grip', 'aria-hidden': 'true' }));
    const x = h('button', { class: 'modal-close', type: 'button', 'aria-label': '關閉', html: X_ICON });
    const head = h('div', { class: 'pet-sheet-head' });
    const body = h('div', { class: 'pet-sheet-body' });
    const live = h('p', { class: 'pet-msg', role: 'status' });
    const rest = h('div', { class: 'pet-sheet-body' });
    /* 食物模式:舞台、點心那一行、托盤、提示排在名字下面(規格 3.2);舞台上的小雞 160 px、橫放 96 px */
    const fa = FOOD ? makeFeed({ mask, box, live, chick: () => c }) : null;
    const cv = fa ? fa.cv : h('canvas', { class: 'pet-big' });
    if (fa) box.append(top, x, head, ...fa.els, body, live, rest);
    else box.append(top, x, head, cv, body, live, rest);
    mask.append(box);
    doc.body.append(mask);
    const mk = () => (fa ? chick(cv, fa.size(), fa.onTick, { maxDpr: 1.5, variants: 1 }) : chick(cv, 160));
    let c = mk();
    cv.addEventListener('click', () => { wake(); });
    /* 轉成橫放或轉回來:換一隻對的大小的小雞 */
    let landQ = null;
    const onLand = () => { c.destroy(); c = mk(); c.setBase(mood(cur)); };
    if (fa) { try { landQ = window.matchMedia(LAND_Q); landQ.addEventListener('change', onLand); } catch (e) { landQ = null; } }
    let renaming = false;

    function drawHead(v) {
      if (renaming) return;
      paint(head, [h('h2', { id: 'pet-sheet-h' }, nameOf(v)),
        v.readOnly ? null : h('button', { class: 'pet-pen', type: 'button', 'data-focus': 'pen', 'aria-label': '幫小雞取名', html: PEN, onclick: startRename })]);
    }
    function startRename() {
      renaming = true;
      const input = h('input', { class: 'modal-input pet-name-in', type: 'text', maxlength: '10', value: cur.status.name || '', 'aria-label': '小雞的名字', autocomplete: 'off' });
      /* 唯讀時沒有筆可以回去,焦點放到 ×,留在面板裡 */
      const done = () => { renaming = false; drawHead(cur); (head.querySelector('.pet-pen') || x).focus(); };
      const form = h('form', { class: 'pet-name-f' }, input,
        h('button', { class: 'btn primary', type: 'submit' }, '儲存'),
        h('button', { class: 'btn', type: 'button', onclick: () => done() }, '取消'));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = Array.from(input.value.trim()).slice(0, 10).join('');
        let r;
        try { r = await S.rename(name); } catch (err) { r = { ok: false }; }
        msg = saveMsg(r, '名字');
        /* 先用最新的資料重畫(取名中 drawHead 不動),再收起表單:這時才知道還有沒有筆 */
        notify(); done();
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } });
      head.replaceChildren(h('h2', { id: 'pet-sheet-h', class: 'pet-h-hidden' }, nameOf(cur)), form);
      input.focus();
      input.select();
    }
    function draw(v, ev) {
      if (!v.on || !v.status) { close(); return; }
      const s = v.status;
      drawHead(v);
      moodOf(c, v, fa ? {} : ev);   // 食物模式吃飼料由托盤播(grain(),每一口都咬到)
      /* 食物模式不再放「餵牠（N 顆）」按鈕,飼料是托盤第一格(規格 3.8) */
      if (fa) { fa.draw(v, ev); paint(body, [todayLine(s), streakLine(s), week(v)], x); }
      else paint(body, [todayLine(s), streakLine(s), week(v), h('div', { class: 'pet-act' }, action(v))], x);
      paint(rest, [s.totalMet > 0 ? h('p', { class: 'pet-grow' }, '累積達標 ' + s.totalMet + ' 天') : null,
        v.readOnly || noGoal ? null : goalControl(v, 'pet-sheet'), ROAM2 ? roamRow(v) : null, noGoal ? null : notes(v, true)], x);
      if (live.textContent !== msg) live.textContent = msg;
    }

    const shut = [];
    Array.from(doc.body.children).forEach((n) => { if (n !== mask && !n.inert) { n.inert = true; shut.push(n); } });
    /* tabindex="-1" 的(托盤裡沒輪到的格子)不算:Tab 只停托盤一次 */
    function focusables() {
      return Array.from(box.querySelectorAll('button, a[href], input')).filter((n) => !n.disabled && n.offsetParent !== null && n.getAttribute('tabindex') !== '-1');
    }
    function onKey(e) {
      if (fa) fa.keyed();
      if (e.key === 'Escape') { if (fa && fa.hideTip()) return; close(); return; }   // 提示開著時 Esc 先收提示
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      doc.removeEventListener('keydown', onKey);
      shut.forEach((n) => { n.inert = false; });
      c.destroy();
      if (fa) fa.destroy();
      if (landQ) { try { landQ.removeEventListener('change', onLand); } catch (e) { /* 舊瀏覽器 */ } }
      sheet = null;
      msg = '';
      notify({ sheet: false });
      const gone = () => mask.remove();
      if (REDUCE) gone();
      else { mask.classList.add('is-off'); setTimeout(gone, 260); }
      if (opener && opener.isConnected && opener.offsetParent !== null) opener.focus();
    }
    /* 把手和標題那一條(合起來約 66px 高)往下拉超過 80px 就關(觸控與滑鼠都可以);從取名的筆、輸入框、按鈕開始拉的不算 */
    let y0 = null, dy = 0;
    const down = (e) => {
      if (e.target.closest && e.target.closest('button, input, a, form')) return;
      y0 = e.clientY; dy = 0; box.style.transition = 'none';
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* 舊瀏覽器 */ }
    };
    const move = (e) => { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); box.style.transform = dy ? 'translateY(' + dy + 'px)' : ''; };
    const release = () => { if (y0 === null) return; y0 = null; box.style.transition = ''; box.style.transform = ''; if (dy > 80) close(); };
    [top, head].forEach((el) => {
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
    });
    x.addEventListener('click', close);
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    doc.addEventListener('keydown', onKey);

    sheet = { draw, close };
    draw(cur, {});
    notify({ sheet: true });
    void mask.offsetWidth;            // 先畫在下面,下一刻滑上來
    mask.classList.remove('is-off');
    setTimeout(() => mask.classList.remove('is-opening'), SETTLE_MS);
    x.focus();
  }
  subs.push((v, ev) => { if (sheet) sheet.draw(v, ev); });

  /* ---------- 網站模式:首頁一張卡、「我的」頁一區 ---------- */
  function card(kind) {
    const idp = 'pet-' + kind;
    const box = h('section', { class: 'pet-card pet-' + kind, 'aria-labelledby': idp + '-h' });
    const pic = h('button', { class: 'pet-pic', type: 'button', 'aria-haspopup': 'dialog' });
    const cv = h('canvas', { class: 'pet-cv' });
    pic.append(cv);
    const main = h('div', { class: 'pet-main' });
    const act = h('div', { class: 'pet-act' });
    const more = h('div', { class: 'pet-more' });
    const live = h('p', { class: 'pet-msg', role: 'status' });
    box.append(pic, main, act, more, live);
    const c = chick(cv, 96), de = doc.documentElement, isWide = () => !!de && de.classList.contains('pet-roam2-wide'), wide = () => c.hold(isWide());   // 電腦版到處走(pet-roam2.js 加 html.pet-roam2-wide,css 藏起來):停住不畫,拿掉照常動
    if (de && 'MutationObserver' in window) { new MutationObserver(wide).observe(de, { attributes: true, attributeFilter: ['class'] }); wide(); window.addEventListener('beforeprint', () => { if (isWide()) c.hold(false, true); }); window.addEventListener('afterprint', wide); }   // 列印時卡片的小雞照常印出來:先畫一格,印完再停住(規格 1.11;第三輪複查 #2)
    pic.addEventListener('click', () => openSheet(pic, { noGoal: kind === 'me' }));
    /* 食物模式:「餵牠」打開面板(規格 3.1);同一顆按鈕一直用,關掉面板時焦點回得來 */
    const open = FOOD ? h('button', { class: 'btn primary pet-open', type: 'button', 'aria-haspopup': 'dialog', 'data-focus': 'open' }, '餵牠') : null;
    if (open) open.addEventListener('click', () => openSheet(open, { noGoal: kind === 'me' }));
    onChange((v, ev) => {
      if (!v.on || !v.status) { box.hidden = true; return; }
      const s = v.status;
      pic.setAttribute('aria-label', label(v));
      moodOf(c, v, ev);
      paint(main, [h('h2', { id: idp + '-h' }, nameOf(v)), todayLine(s), streakLine(s)]);
      paint(act, open ? [open, v.readOnly ? h('p', { class: 'pet-note' }, roText(v)) : null] : [action(v, kind === 'home')], pic);
      paint(more, kind === 'me' ? [v.readOnly ? null : goalControl(v, idp), notes(v, false)] : [], pic);
      const t = sheet ? '' : msg;
      if (live.textContent !== t) live.textContent = t;
    });
    return box;
  }
  function mountHome() {
    const daily = doc.getElementById('daily-home');
    if (!daily) return;
    daily.after(card('home'));
  }
  /* 「我的」頁的內容由 PROFILE.renderAccount 整塊重畫:每次畫完把這一區放回頭像那一列下面(沒有就放最上面) */
  function mountMe() {
    const root = doc.getElementById('me-root');
    if (!root) return;
    const box = card('me');
    const place = () => {
      const headRow = root.querySelector(':scope > .me-head');
      if (headRow) { if (headRow.nextSibling !== box) headRow.after(box); }
      else if (root.firstChild !== box) root.prepend(box);
    };
    place();
    new MutationObserver(place).observe(root, { childList: true });
  }

  mountHome(); mountMe();
  window.PET_UI = { chick, onChange, mood, label, wake, openSheet, view: () => cur, reduced: REDUCE };
})();
