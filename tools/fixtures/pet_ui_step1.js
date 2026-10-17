/* 小雞的畫面(路線圖 1.3、1.4;規格在 repo 外的 小雞規格.md 第 5、7 節)。
   - 共用:小雞動畫的控制(只在看得到時動,約每秒 8 張;減少動態時只畫一張靜止的)、底部彈出的餵食面板、心情與文字。
   - 網站模式:首頁每日練習下面一張卡、「我的」頁一區。App 有分頁列時這兩個由 CSS 藏起來,改由 js/pet-roam.js 在分頁列上走。
   - 讀寫一律經過 js/pet-store.js(只寫 pet 這一個鍵);這裡不碰 store、localStorage。名字一律用文字節點放進畫面。
   - 面板照 js/app-shell.js 的 showInstallHelp:遮罩、右上角 ×、Esc、點背景關、關掉焦點回原處;另加從下面滑上來、
     把手與標題那一條往下拉關、背景設 inert、焦點鎖在面板裡。剛打開的 350 毫秒不接受點按(連點小雞時第二下不會按到面板裡的按鈕)。
   - 每日目標只放一個地方:「我的」頁那一區有,從那裡打開的面板就不再放。
   載入順序:common.js、cloud.js、pet-config.js、pet.js、pet-store.js、chick-art.js、pet-ui.js(App 再加 pet-roam.js)。 */
(function () {
  'use strict';
  const S = window.PET_STORE, P = window.PET, A = window.ChickArt;
  if (!S || !S.on || !P || !A || typeof h !== 'function') return;
  const doc = document;
  const WAKE_MS = 10 * 60e3;         // 晚上點醒以後醒著多久
  const GOALS = [10, 20, 40];
  const WEEK = '日一二三四五六';
  const SETTLE_MS = 350;             // 面板打開後這麼久才接受點按
  const REDUCE = mq('(prefers-reduced-motion: reduce)');
  const X_ICON = "<svg viewBox='0 0 22 22' width='18' height='18' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'><path d='M5 5 17 17M17 5 5 17'/></svg>";
  const PEN = "<svg viewBox='0 0 24 24' width='18' height='18' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M12 20h9'/><path d='M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'/></svg>";

  let cur = S.view();
  let wokeAt = 0;
  let feeding = false;
  let msg = '';                      // 面板與卡片下面的一行狀態(餵食結果、出錯)
  const subs = [];

  function mq(q) { try { return window.matchMedia(q).matches; } catch (e) { return false; } }
  function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }

  /* ---------- 心情與文字 ---------- */
  function awake() { return Date.now() - wokeAt < WAKE_MS; }
  function wake() { if (cur.status && cur.status.sleeping && !awake()) { wokeAt = Date.now(); notify({ woke: true }); } }
  /* 睡覺(晚上 11 點到早上 7 點,點一下醒來)、肚子餓(今天還沒餵、也還沒達標)、其他時候待機 */
  function mood(v) {
    const s = (v || cur).status;
    if (!s) return 'idle';
    if (s.sleeping && !awake()) return 'sleep';
    if (s.hungry && !s.metToday) return 'hungry';
    return 'idle';
  }
  function nameOf(v) { return ((v || cur).status && (v || cur).status.name) || '小雞'; }
  /* 斷掉時不寫「連續 0 天」,改寫一起練了幾天;從沒練過什麼都不寫 */
  function streakText(s) {
    if (s.streak > 0) return '連續 ' + s.streak + ' 天';
    if (s.practicedDays > 0) return '一起練了 ' + s.practicedDays + ' 天';
    return '';
  }
  function label(v) {
    const t = streakText((v || cur).status);
    return nameOf(v) + (t ? '，' + t : '');
  }

  /* ---------- 小雞動畫:看得到(畫面上、分頁在前景)才動 ---------- */
  function chick(canvas, size, onTick) {
    const M = A.metrics;
    canvas.style.width = size + 'px';
    canvas.style.height = Math.round(size * M.height / M.width) + 'px';
    canvas.setAttribute('aria-hidden', 'true');
    let anim = null, base = 'idle', queue = [], seen = false, held = false, running = false;
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
      if (!go) { if (anim && running) anim.stop(); running = false; return; }
      if (running) return;
      running = true;
      if (!anim) { anim = A.animate(canvas, { size, fps: 8, maxDpr: 2, pose: want(), onTick: tick }); return; }
      if (anim.pose !== want()) anim.setPose(want()); else anim.setFps(8);
    }
    let io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((es) => { seen = es[es.length - 1].isIntersecting; sync(); });
      io.observe(canvas);
    } else { seen = true; }
    doc.addEventListener('visibilitychange', sync);
    sync();
    return {
      setBase(p) { base = p; if (running && !queue.length && anim.pose !== p) anim.setPose(p); },
      /* 播一次(例如吃東西再開心),播完回到 base;減少動態或看不到時不播 */
      play(list) {
        if (REDUCE || !running) return;
        queue = list.map((p) => ({ pose: p, left: len(p) }));
        anim.setPose(queue[0].pose);
      },
      hold(on) { held = !!on; sync(); },
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
  /* 過了午夜、到了睡覺時間:每分鐘看一次,有變才重畫 */
  setInterval(() => {
    if (doc.visibilityState === 'hidden') return;
    const v = S.view();
    if (!v.status || !cur.status || v.status.today !== cur.status.today || mood(v) !== mood(cur)) notify();
  }, 60e3);

  async function feed() {
    if (feeding) return;
    const n = cur.status ? cur.status.food : 0;
    feeding = true; msg = ''; wake(); notify();
    let r;
    try { r = await S.feed(); } catch (e) { r = { ok: false, reason: 'error' }; }
    feeding = false;
    if (r && r.ok) { msg = '餵了 ' + n + ' 顆。'; notify({ fed: n }); return; }
    /* 唯讀(資料讀不到、時鐘不對)與沒有飼料:action() 已經寫了原因,這裡不重複 */
    msg = r && (r.reason === 'readOnly' || r.reason === 'clock' || r.reason === 'noFood') ? '' : '沒有存到，再試一次。';
    notify();
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
    msg = saveMsg(r, '目標');
    notify();
  }

  /* ---------- 共用的內容 ---------- */
  /* 餵完沒有飼料時換成這個連結;data-focus 跟餵食按鈕一樣,鍵盤焦點會從按鈕移到它 */
  function goLink() {
    let done = false;
    try { done = !!(window.DAILY && DAILY.progress(store.get(DAILY.KEY, null), DAILY.dateOf(Date.now())).complete); } catch (e) { done = false; }
    return done ? h('a', { class: 'btn primary pet-go', href: 'drill.html', 'data-focus': 'feed' }, '去答題')
      : h('a', { class: 'btn primary pet-go', href: 'daily.html', 'data-focus': 'feed' }, '去做每日練習');
  }
  /* noGo:首頁那張卡就在每日練習下面,沒有飼料時不再放一個去每日練習的按鈕 */
  function action(v, noGo) {
    const s = v.status;
    if (v.readOnly) return h('p', { class: 'pet-note' }, v.newer ? '小雞的資料是新版網頁存的，這台先不能餵。' : v.reason === 'clock' ? '這台裝置的日期不對，調好以後再餵。' : '小雞的資料讀不到，這台先不能餵。');
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
  function notes(v, full) {
    const out = [];
    if (full && v.status.streak > 0 && v.status.shields > 0) out.push(h('p', { class: 'pet-note' }, '漏掉一天會自動用掉一張保護卡。'));
    /* 訪客的小雞不會搬到帳號裡(cloud.js 不搬訪客資料);網站沒開雲端時沒有登入,不提 */
    if (v.guest && v.cloud) out.push(h('p', { class: 'pet-note' }, '登入後換成帳號裡的小雞。'));
    return out;
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
  function moodOf(c, v, ev) {
    c.setBase(mood(v));
    if (ev.fed) c.play(['eat', 'happy']);
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
    const cv = h('canvas', { class: 'pet-big' });
    const body = h('div', { class: 'pet-sheet-body' });
    const live = h('p', { class: 'pet-msg', role: 'status' });
    const rest = h('div', { class: 'pet-sheet-body' });
    box.append(top, x, head, cv, body, live, rest);
    mask.append(box);
    doc.body.append(mask);
    const c = chick(cv, 160);
    cv.addEventListener('click', () => { wake(); });
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
      moodOf(c, v, ev);
      paint(body, [todayLine(s), streakLine(s), week(v), h('div', { class: 'pet-act' }, action(v))], x);
      paint(rest, [s.totalMet > 0 ? h('p', { class: 'pet-grow' }, '累積達標 ' + s.totalMet + ' 天') : null,
        v.readOnly || noGoal ? null : goalControl(v, 'pet-sheet'), noGoal ? null : notes(v, true)], x);
      if (live.textContent !== msg) live.textContent = msg;
    }

    const shut = [];
    Array.from(doc.body.children).forEach((n) => { if (n !== mask && !n.inert) { n.inert = true; shut.push(n); } });
    function focusables() {
      return Array.from(box.querySelectorAll('button, a[href], input')).filter((n) => !n.disabled && n.offsetParent !== null);
    }
    function onKey(e) {
      if (e.key === 'Escape') { close(); return; }
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
    const c = chick(cv, 96);
    pic.addEventListener('click', () => openSheet(pic, { noGoal: kind === 'me' }));
    onChange((v, ev) => {
      if (!v.on || !v.status) { box.hidden = true; return; }
      const s = v.status;
      pic.setAttribute('aria-label', label(v));
      moodOf(c, v, ev);
      paint(main, [h('h2', { id: idp + '-h' }, nameOf(v)), todayLine(s), streakLine(s)]);
      paint(act, [action(v, kind === 'home')], pic);
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

  mountHome();
  mountMe();
  window.PET_UI = { chick, onChange, mood, label, wake, openSheet, view: () => cur, reduced: REDUCE };
})();
