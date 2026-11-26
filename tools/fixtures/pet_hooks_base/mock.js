/* 模擬考:照正式節奏的計時測驗。
   - 從現有題庫隨機抽題(聽力+閱讀),全程倒數,時間到自動交卷。
   - 聽力每題音檔只能播一次(正式考規則);全部交卷後才對答案。
   - 分數是本站估計(樣本小,只供追蹤趨勢;算法見下面 MOCK_SCORE);紀錄存 mock_history(雲端同步)。
   - 交卷時答錯的題收進錯題本(mock_wrong,js/wrongbook.js)。沒作答的不收;原本在錯題本、這次答對的移出。
     不寫 drill_p*、listen_p*、hist(那幾個鍵是整份上傳,模擬考頁寫它們會蓋掉別台在考試期間刷的題)。 */
/* 模擬考的分數:window.MOCK_SCORE.scaled(答對率, 科 'L' 或 'R')。放在頁面程式外面,題庫沒載到也定義得到 */
(function () {
  'use strict';
  /* 分數(答對率→單科 5–495,本站估計,只做趨勢參考):跟預估分數用同一份曲線(data/item-params.js 的 curve)、
     同一個函式(ESTIMATE.scoreOf 分段直線內插),再取到 5 的倍數。聽力曲線就是下面這張表;閱讀是這張表與公開來源的中間值。
     題目參數或估分程式沒載到時,兩科都照這張表往下取(改版前的算法)。
     已經存進 mock_history 的分數照當時存的顯示,不重算。 */
  const CONV = [[0.97, 495], [0.92, 470], [0.86, 440], [0.8, 410], [0.75, 380], [0.7, 350],
    [0.65, 320], [0.6, 290], [0.55, 260], [0.5, 230], [0.45, 200], [0.4, 170],
    [0.35, 140], [0.3, 110], [0.25, 85], [0.15, 55], [0, 5]];
  function scaled(pct, sec) {
    const E = window.ESTIMATE, P = window.ITEM_PARAMS;
    const curve = P && P.curve ? P.curve[sec] : null;
    if (E && typeof E.scoreOf === 'function' && Array.isArray(curve)) return Math.round(E.scoreOf(curve, pct) / 5) * 5;
    return CONV.find(([t]) => pct >= t)[1];
  }
  window.MOCK_SCORE = Object.freeze({ scaled });
})();

(function () {
  const root = $('#mock-root');
  const LDATA = (window.TOEIC && TOEIC.listening) || null;
  if (!window.TOEIC || !TOEIC.part5 || !LDATA) {
    root.append(h('div', { class: 'page-head' }, h('h1', null, '模擬考')),
      UI.empty({ text: '題庫準備中', action: { label: '重新整理', onClick: () => location.reload() } }));
    return;
  }

  const SIZES = {
    quick: {
      name: '快速回合', mins: 22,
      desc: '聽力 12 題 · 閱讀約 18 題',
      l: { p2: 6, p3: 1, p4: 1 }, r: { p5: 10, p6: 1, p7: 1 },
    },
    half: {
      name: '標準半回', mins: 47,
      desc: '聽力 36 題 · 閱讀約 39 題',
      l: { p1: 3, p2: 12, p3: 4, p4: 3 }, r: { p5: 15, p6: 2, p7: 4 },
    },
    /* 完整一回(2026-11-23):題數照正式多益,聽力 100 題、閱讀 100 題,限時 120 分(聽力 45 + 閱讀 75)。
       聽力 Part 1 6 題、Part 2 25 題、Part 3 13 組 39 題、Part 4 10 組 30 題;閱讀 Part 5 30 題、Part 6 4 組 16 題。
       Part 7 正式是單篇 29 題、雙篇 2 組 10 題、三篇 3 組 15 題(共 54 題)。題庫 Part 7 只有單篇 40 組(每組 4 題)、
       雙篇 13 組、三篇 2 組(每組 5 題),三篇少一組,所以三篇用 2 組、不夠的 5 題用雙篇補:單篇 6 組 24 題、雙篇 4 組 20 題、
       三篇 2 組 10 題,合計 54 題,閱讀剛好 100 題。r.p7 是數字(只抽幾組)或 { single, double, triple }(各抽幾組)。 */
    full: {
      name: '完整一回', mins: 120,
      desc: '聽力 100 題 · 閱讀 100 題',
      l: { p1: 6, p2: 25, p3: 13, p4: 10 }, r: { p5: 30, p6: 4, p7: { single: 6, double: 4, triple: 2 } },
    },
  };
  const LEAVE_BODY = '模擬考還沒交卷。離開後這次作答不會計分。';


  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const pick = (arr, n) => shuffle(arr || []).slice(0, n);
  const qid = (set, i) => set.id + ':' + i;
  /* Part 7:數字就隨機抽幾組;物件就依單篇、雙篇、三篇各抽幾組(照正式考卷的順序:單篇在前),題庫那一種不夠就有幾組給幾組 */
  function pickP7(spec) {
    const all = TOEIC.part7 || [];
    if (typeof spec === 'number') return pick(all, spec);
    return [['single', 1], ['double', 2], ['triple', 3]].reduce((out, [k, n]) =>
      out.concat(pick(all.filter(x => x.passages && x.passages.length === n), spec[k] || 0)), []);
  }

  /* ---------- 交卷時存不進去的成績(2026-10-31) ----------
     「交卷」和時間到自動交卷沒有 data-gate(開始的時候是能作答的)。考到一半別的分頁登出、換帳號,
     或登回來時這台的帳號資料夾還沒從雲端灌好,交卷那一下 js/common.js 的最後一道會擋下:以前結果照常出現、成績哪裡都沒存。
     現在結果照樣給他看,但寫明還沒存;這一筆先放這個分頁的 sessionStorage,綁交卷時的資料夾(帳號),
     之後這個分頁回到同一個資料夾、能作答了(登回來、灌好雲端進度)就補存。模擬考紀錄是先合併再上傳的鍵(js/sync-merge.js mock),
     晚一點補存不會蓋掉別台的;換成別人的帳號時不補進別人的資料夾。關掉分頁就沒了(結果上有寫) */
  const LATER = 'tr_mock_unsaved';
  function laterList() {
    try { const a = JSON.parse(sessionStorage.getItem(LATER)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function setLater(a) {
    try { if (a.length) sessionStorage.setItem(LATER, JSON.stringify(a)); else sessionStorage.removeItem(LATER); return true; } catch (e) { return false; }
  }
  /* 現在寫得進去嗎:跟 store.set 的最後一道同一套(common.js canKeepProgress),再加內容頁的「能作答」 */
  function canSaveNow() {
    try {
      if (typeof canKeepProgress === 'function' && !canKeepProgress()) return false;
      return !(window.PROFILE && typeof PROFILE.canAct === 'function' && !PROFILE.canAct());
    } catch (e) { return true; }
  }
  function addRecords(recs) {
    const hist = store.get('mock_history', []);
    const S = window.SYNC_MERGE;
    const m = S && typeof S.mock === 'function' ? S.mock(Array.isArray(hist) ? hist : [], recs) : null;   // 同一筆不會變兩筆,照日期排
    store.set('mock_history', (m && m.ok ? m.v : (Array.isArray(hist) ? hist : []).concat(recs)).slice(-30));
  }
  /* 作答過的小題記進 mock_seen({ 題目 key: 交卷時間 T(毫秒) },js/sync-merge-lesson.js 的 SYNC_MERGE.mockSeen 合併、雲端合併表上),
     課程頁把這些題當成做過。只記有作答的(ans 是 answered() 的 [key, 選的]);合併函式不在(舊快取)或合併不了就不寫。出錯不影響成績與錯題本 */
  function saveSeen(ans, T) {
    try {
      const S = window.SYNC_MERGE;
      if (!Array.isArray(ans) || !Number.isFinite(T) || !S || typeof S.mockSeen !== 'function') return;
      const add = {};
      ans.forEach(x => { if (Array.isArray(x) && typeof x[0] === 'string' && x[0]) add[x[0]] = T; });
      const m = S.mockSeen(store.get('mock_seen', null), add);
      if (m && m.ok && m.v) store.set('mock_seen', m.v);
    } catch (e) { /* 不影響成績 */ }
  }
  /* 補存:分數照舊補進 mock_history;那一筆帶著作答(ans)就順便把答錯的題補進錯題本(js/wrongbook.js)。
     對錯在這裡用題庫重算,不信任暫存裡的東西;mock_wrong 同一題已經有比較新的,合併時留新的,重跑結果一樣。
     分數和錯題都確認寫進去了才從暫存拿掉。舊版 mock.js 讀到帶 ans 的暫存只看 rec(分數照補、ans 丟掉) */
  function saveLater() {
    const all = laterList();
    const mine = all.filter(x => x && x.pid === window.__PROFILE_ID && x.rec && typeof x.rec.d === 'string');
    if (!mine.length || !canSaveNow()) return false;
    addRecords(mine.map(x => x.rec));
    const after = store.get('mock_history', []);
    const kept = new Set((Array.isArray(after) ? after : []).map(r => r && r.d));
    if (!mine.every(x => kept.has(x.rec.d))) return false;   // 沒寫進去:留著下次再補
    const wrongOk = mine.every(x => {
      if (!Array.isArray(x.ans) || !window.WRONGBOOK) return true;
      try { return WRONGBOOK.save(WRONGBOOK.fromAnswers(WRONGBOOK.cleanAns(x.ans), Date.parse(x.rec.d))).ok; } catch (e) { return false; }
    });
    if (!wrongOk) return false;   // 錯題沒寫進去:留著下次再補(分數已經在,同一筆合併時不會變兩筆)
    mine.forEach(x => saveSeen(x.ans, Date.parse(x.rec.d)));
    setLater(all.filter(x => mine.indexOf(x) < 0));
    return true;
  }
  let onHome = false;
  let resultCard = null;   // 結果畫面的結算卡:換畫面前呼叫 destroy() 停掉小雞
  function dropCard() { if (resultCard) { resultCard.destroy(); resultCard = null; } }

  renderHome();
  /* 確認登入之後(這一頁不重載、能作答):之前存不進去的成績補存,首頁的紀錄表跟著重畫 */
  Promise.resolve(window.CLOUD ? CLOUD.ready : null).then(() => { if (saveLater() && onHome) renderHome(); }, () => {});
  /* 開頁先跟雲端對齊模擬考錯題(js/wrongbook.js syncCloud):部署前就開著的舊版分頁會把帳本上的 mock_wrong 整份上傳,
     本機先有別台考的錯題,交卷後就算被它整份傳上去也還在 */
  if (window.WRONGBOOK && typeof WRONGBOOK.syncCloud === 'function') WRONGBOOK.syncCloud();

  /* ================= 首頁 ================= */
  function renderHome() {
    onHome = true;
    dropCard();
    document.title = '模擬考 - 衝衝英文';
    root.replaceChildren();
    const head = h('div', { class: 'page-head' }, h('canvas', { class: 'hub-art', 'data-doodle': 'mock', 'data-size': '40', 'aria-hidden': 'true' }), h('h1', null, '模擬考'));
    root.append(head);
    if (window.UI && typeof UI.mount === 'function' && document.readyState !== 'loading') UI.mount(head);   // 標題左邊的圖示(頁面載入那一下 js/ui.js 會畫,之後重畫的自己掛)

    /* 一個畫面只有一顆實色主按鈕:第一張(快速回合)是主按鈕,其他兩張是描邊按鈕 */
    const cards = h('div', { class: 'part-cards mock-sizes' });
    Object.entries(SIZES).forEach(([k, s], i) => {
      cards.append(h('div', { class: 'part-card' },
        h('h3', null, s.name),
        h('p', { class: 'mock-tags' }, h('span', { class: 'mock-tag' }, s.desc), h('span', { class: 'mock-tag' }, '限時 ' + s.mins + ' 分鐘')),
        h('div', { class: 'cfg-row' },
          h('button', { class: i === 0 ? 'btn primary' : 'btn', 'data-gate': '', onclick: () => startExam(k) }, '開始'))));   // 開始考試:沒登入時 js/profile.js 先攔下
    });
    root.append(cards);

    const hist = store.get('mock_history', []);
    if (hist.length) {
      root.append(h('div', { class: 'exercise-head' }, h('h2', null, '歷次紀錄')));
      const table = h('table', { class: 'cat-table' },
        h('tr', null, h('th', null, '日期'), h('th', null, '規模'),
          h('th', null, '聽力'), h('th', null, '閱讀'), h('th', null, '參考總分')));
      hist.slice(-8).reverse().forEach(r => {
        table.append(h('tr', null,
          h('td', null, (r.d || '').slice(0, 10)),
          h('td', null, (SIZES[r.size] || {}).name || r.size),
          h('td', { class: 'num' }, r.lRaw + ' / ' + r.lTotal + ' · ' + r.lScore),
          h('td', { class: 'num' }, r.rRaw + ' / ' + r.rTotal + ' · ' + r.rScore),
          h('td', { class: 'num' }, h('b', null, r.lScore + r.rScore))));
      });
      root.append(table);
      /* 這一版以前交卷的只存了分數(沒有每題選什麼),答錯的題補不回錯題本:最近 8 筆裡有那種的就照實講。捲出最近 8 筆之後這行就不見 */
      const W = window.WRONGBOOK;
      if (W && typeof W.SINCE === 'string' && hist.slice(-8).some(r => r && typeof r.d === 'string' && r.d < W.SINCE)) {
        const since = new Date(W.SINCE);
        root.append(h('p', { class: 'result-note mock-old-note' },
          (since.getMonth() + 1) + '/' + since.getDate() + ' 前的模擬考錯題未收進錯題本'));   // 狀態說明做成一行短標籤
      }
    }
  }

  /* ================= 考試 ================= */
  function startExam(sizeKey) {
    if (!uiReady()) return;   // 共用元件沒載到:說一聲、給重新整理,不在這裡丟錯
    onHome = false;
    const cfg = SIZES[sizeKey];
    const units = [];
    if (cfg.l.p1) pick(LDATA.p1, cfg.l.p1).forEach(item => units.push({ sec: 'L', p: '1', item }));
    pick(LDATA.p2, cfg.l.p2).forEach(item => units.push({ sec: 'L', p: '2', item }));
    pick(LDATA.p3, cfg.l.p3).forEach(item => units.push({ sec: 'L', p: '3', item }));
    pick(LDATA.p4, cfg.l.p4).forEach(item => units.push({ sec: 'L', p: '4', item }));
    pick(TOEIC.part5, cfg.r.p5).forEach(item => units.push({ sec: 'R', p: '5', item }));
    pick(TOEIC.part6, cfg.r.p6).forEach(item => units.push({ sec: 'R', p: '6', item }));
    pickP7(cfg.r.p7).forEach(item => units.push({ sec: 'R', p: '7', item }));

    document.title = '模擬考進行中 - 衝衝英文';
    dropCard();
    const sess = units.map(() => ({ answers: {}, played: 0 }));
    let cur = 0;
    let over = false;
    let audio = null;
    let panel = null;       // 題號面板(UI.sheet,開著時才有)
    let asking = false;     // 「還有題組沒答完」的確認視窗開著
    let actionOn = true;    // 作答列右邊的「交卷」在不在(最後一題換成底部的主按鈕)
    const deadline = Date.now() + cfg.mins * 60 * 1000;
    const timerEl = h('span', { class: 'mock-timer', role: 'timer', 'aria-label': '剩餘時間' });
    /* 專心模式:離開提醒(body.dataset.leaveConfirm,付費牆與搬家頁會讀)一開考就算作答中,所以一進來就 dirty。
       倒數放在作答列的計數左邊(f.slot),一直看得到。
       交卷沒有 data-gate:開始那一下已經擋過登入;考到一半登出的情況由上面「交卷時存不進去的成績」處理 */
    const f = UI.focus.enter({
      total: units.length,
      body: LEAVE_BODY,
      dirty: true,
      onCount: openPanel,
      action: { label: '交卷', onClick: () => submit(false) },
      onExit: () => { over = true; clearInterval(timerId); unwake(); stopAudio(); closePanel(false); renderHome(); },
    });
    f.slot(timerEl);
    const timerId = setInterval(tick, 1000);
    tick();
    /* 120 分鐘的考試:切到背景、螢幕鎖住時計時器會被瀏覽器放慢甚至暫停,但倒數是看截止時間算的(deadline),
       回到畫面那一下馬上對一次,時間到了就交卷,不用等下一個一秒 */
    const wake = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);
    function unwake() { document.removeEventListener('visibilitychange', wake); window.removeEventListener('pageshow', wake); }

    function tick() {
      const left = Math.max(0, deadline - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor(left % 60000 / 1000);
      timerEl.textContent = m + ':' + String(s).padStart(2, '0');
      timerEl.classList.toggle('low', left < 5 * 60 * 1000);
      if (left <= 0 && !over) submit(true);
    }
    function stopAudio() { if (audio) { audio.pause(); audio = null; } }

    function unitQs(u) { return u.p === '5' ? 1 : u.p === '1' || u.p === '2' ? 1 : u.item.questions.length; }
    function unitAnswered(i) {
      const u = units[i];
      if (u.p === '5' || u.p === '1' || u.p === '2') return sess[i].answers.c !== undefined;
      return u.item.questions.every((q, qi) => sess[i].answers[qi] !== undefined);
    }

    /* 換題:焦點到新題的題幹(按鈕整段重畫,不然焦點掉回頁面) */
    function go(i) { cur = i; draw(); window.scrollTo(0, 0); f.focusMain(); }
    /* 選了答案:重畫但不停正在播的音檔(聽力題組邊聽邊答),焦點回到剛選的那顆,讀屏念「已選 B」 */
    function chose(n) { const y = window.scrollY; f.keep(() => draw(true)); window.scrollTo(0, y); f.say('已選 ' + LETTERS[n]); }

    function draw(keepAudio) {
      if (!keepAudio) stopAudio();
      root.replaceChildren();
      const u = units[cur];
      f.progress(cur + 1);
      if (u.p === '5') drawP5(u);
      else if (u.sec === 'R') drawRSet(u);
      else drawLUnit(u);
      drawFoot();
    }

    /* 底部:上一題(文字按鈕)加下一題(主按鈕);最後一題主按鈕變交卷,作答列右邊的交卷拿掉 */
    function drawFoot() {
      const isLast = cur === units.length - 1;
      if (actionOn === isLast) { f.action(isLast ? null : { label: '交卷', onClick: () => submit(false) }); actionOn = !isLast; }
      f.foot([
        cur > 0 ? h('button', { class: 'btn-text', type: 'button', onclick: () => go(cur - 1) }, '上一題') : null,
        h('button', { class: 'btn primary', type: 'button', onclick: () => { if (isLast) submit(false); else go(cur + 1); } }, isLast ? '交卷' : '下一題'),
      ]);
    }

    /* ---------- 題號面板:作答列右邊「3 / 43」點開,可跳題,答過的題有底色 ---------- */
    function openPanel() {
      if (panel || over) return;
      const done = units.filter((x, i) => unitAnswered(i)).length;
      /* 一個 Part 一組:題號多的時候(完整一回約 100 個)比較找得到;標籤寫這個 Part 有幾題或幾組 */
      const group = (sec, p) => {
        const idx = [];
        units.forEach((x, i) => { if (x.sec === sec && x.p === p) idx.push(i); });
        if (!idx.length) return null;
        const nav = h('div', { class: 'q-nav' });
        idx.forEach(i => {
          let cls = i === cur ? 'cur' : '';
          if (unitAnswered(i)) cls += ' ans';
          nav.append(h('button', {
            class: cls.trim(), type: 'button', 'aria-current': i === cur ? 'true' : null,
            'aria-label': '第 ' + (i + 1) + ' 題' + (unitAnswered(i) ? ' 已作答' : ''),
            onclick: () => { closePanel(false); go(i); },
          }, String(i + 1)));
        });
        const sets = p === '3' || p === '4' || p === '6' || p === '7';
        const label = (sec === 'L' ? '聽力' : '閱讀') + ' Part ' + p + ' · ' + idx.length + (sets ? ' 組' : ' 題');
        return h('div', { class: 'mock-panel-group' }, h('p', { class: 'mock-panel-label' }, label), nav);
      };
      /* 焦點先到目前那一題(aria-current);Esc、點遮罩、關閉鈕由 UI.sheet 處理 */
      panel = UI.sheet({
        title: '題號', note: '已作答 ' + done + ' / ' + units.length, class: 'mock-panel',
        nodes: ['1', '2', '3', '4'].map(p => group('L', p)).concat(['5', '6', '7'].map(p => group('R', p))),
        onClose: () => { panel = null; },
      });
    }
    /* back:焦點回作答列的「3 / 43」;點了題號換題時不回 */
    function closePanel(back) { if (panel) panel.close(back); }

    function makeOncePlayer(id, state) {
      const btn = h('button', { class: 'btn player-btn', type: 'button' }, state.played ? '已播放' : '▶ 播放 · 限一次');
      btn.disabled = !!state.played;
      btn.addEventListener('click', () => {
        if (state.played) return;
        state.played = 1;
        stopAudio();
        audio = new Audio('audio/' + id + '.mp3');
        audio.play().catch(() => {});
        btn.disabled = true;
        btn.textContent = '已播放';
      });
      return h('div', { class: 'player' }, btn);
    }

    function drawLUnit(u) {
      const state = sess[cur];
      const block = h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' },
          h('span', { class: 'badge cat' }, '聽力 Part ' + u.p)));
      if (u.p === '1') {
        block.append(h('div', { class: 'listen-photo' }, h('img', {
          src: 'img/listening/' + u.item.id + '.jpg', alt: '聽力照片',
          onerror: e => e.target.replaceWith(h('div', { class: 'photo-missing' }, '照片準備中')),
        })));
      }
      block.append(makeOncePlayer(u.item.id, state));
      if (u.p === '1' || u.p === '2') {
        const nOpt = u.p === '1' ? 4 : 3;
        const row = h('div', { class: 'letter-row' });
        for (let i = 0; i < nOpt; i++) {
          row.append(h('button', {
            class: 'letter-big' + (state.answers.c === i ? ' picked' : ''), 'aria-pressed': state.answers.c === i ? 'true' : 'false',
            onclick: () => { state.answers.c = i; chose(i); },
          }, LETTERS[i]));
        }
        block.append(h('div', { class: 'q-text', style: 'margin-top:10px' },
          u.p === '1' ? '選出最符合照片的描述' : '選出最合適的回應'), row);
      } else {
        u.item.questions.forEach((q, qi) => {
          const opts = h('div', { class: 'opts', style: 'margin-top:6px' });
          q.options.forEach((opt, oi) => {
            opts.append(h('button', {
              class: 'opt' + (state.answers[qi] === oi ? ' picked' : ''), 'aria-pressed': state.answers[qi] === oi ? 'true' : 'false',
              onclick: () => { state.answers[qi] = oi; chose(oi); },
            }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
          });
          block.append(h('div', { style: 'margin-top:14px' },
            h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'Q' + (qi + 1)), q.q), opts));
        });
      }
      root.append(block);
    }

    function drawP5(u) {
      const q = u.item;
      const state = sess[cur];
      const opts = h('div', { class: 'opts' });
      q.options.forEach((opt, oi) => {
        opts.append(h('button', {
          class: 'opt' + (state.answers.c === oi ? ' picked' : ''), 'aria-pressed': state.answers.c === oi ? 'true' : 'false',
          onclick: () => { state.answers.c = oi; chose(oi); },
        }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
      });
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, '閱讀 Part 5')),
        h('div', { class: 'q-text' }, q.question),
        opts));
    }

    function drawRSet(u) {
      const set = u.item;
      const state = sess[cur];
      const layout = h('div', { class: 'set-layout' });
      const passCol = h('div', { class: 'passage-sticky-wrap', role: 'region', 'aria-label': '文章' });   // 可以捲動的文章區會成為 Tab 停點:給它名字
      if (u.p === '6') {
        const box = h('div', { class: 'passage-box' });
        const frag = document.createDocumentFragment();
        String(set.passage).split(/(\{\{\d\}\})/).forEach(seg => {
          const m = seg.match(/^\{\{(\d)\}\}$/);
          if (!m) { if (seg) frag.append(document.createTextNode(seg)); return; }
          const num = Number(m[1]);
          const rec = state.answers[num];
          const q = set.questions.find(x => x.num === num);
          frag.append(rec !== undefined && q
            ? h('span', { class: 'gap-mark filled' }, q.options[rec])
            : h('span', { class: 'gap-mark' }, '(' + num + ') ______'));
        });
        box.append(h('div', null, frag));
        passCol.append(box);
      } else {
        set.passages.forEach(ps => passCol.append(p7Fallback(ps)));
      }
      layout.append(h('div', null, passCol));
      const qCol = h('div', null);
      qCol.append(h('div', { style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, '閱讀 Part ' + u.p)));
      set.questions.forEach((q, qi) => {
        const key = u.p === '6' ? q.num : qi;
        const opts = h('div', { class: 'opts' });
        q.options.forEach((opt, oi) => {
          opts.append(h('button', {
            class: 'opt' + (state.answers[key] === oi ? ' picked' : ''), 'aria-pressed': state.answers[key] === oi ? 'true' : 'false',
            onclick: () => { state.answers[key] = oi; chose(oi); },
          }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
        });
        qCol.append(h('div', { class: 'q-block' },
          u.p === '6'
            ? h('div', { class: 'mock-gap-no' }, '空格 (' + q.num + ')')
            : h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'Q' + (qi + 1)), q.q),
          opts));
      });
      layout.append(qCol);
      root.append(layout);
    }

    function p7Fallback(ps) {
      const box = h('div', { class: 'passage-box' },
        h('span', { class: 'p-label' }, (ps.label ? ps.label + ' · ' : '') + passTypeLabel(ps.type)));
      if (ps.blocks) {
        /* 簡化渲染:模擬考中結構化文件以純文字段落呈現重點 */
        const wrap = h('div', { class: 'ps-blocks' });
        ps.blocks.forEach(b => {
          if (b.t === 'h') wrap.append(h('div', { class: 'ps-h' }, b.text));
          else if (b.t === 'sub' || b.t === 'p' || b.t === 'note') wrap.append(h('div', { class: 'ps-p' }, b.text));
          else if (b.t === 'list') wrap.append(h('ul', { class: 'ps-list' }, ...(b.items || []).map(x => h('li', null, x))));
          else if (b.t === 'kv') wrap.append(h('div', { class: 'ps-kv' }, ...(b.items || []).map(it =>
            h('div', { class: 'ps-kv-row' }, h('span', { class: 'ps-kv-k' }, it[0]), h('span', { class: 'ps-kv-v' }, it[1])))));
          else if (b.t === 'table') {
            const tbl = h('table', { class: 'ps-table' });
            (b.rows || []).forEach((row, ri) => tbl.append(h('tr', null,
              ...row.map(c => h(b.header !== false && ri === 0 ? 'th' : 'td', null, String(c))))));
            wrap.append(h('div', { class: 'ps-table-wrap' }, tbl));
          } else if (b.t === 'chat') {
            const sides = {};
            wrap.append(h('div', { class: 'ps-chat' }, ...(b.msgs || []).map(m => {
              if (!(m.who in sides)) sides[m.who] = Object.keys(sides).length % 2 ? 'right' : '';
              return h('div', { class: 'ps-msg ' + sides[m.who] },
                h('div', { class: 'ps-msg-meta' }, m.who + (m.time ? ' · ' + m.time : '')),
                h('div', { class: 'ps-msg-bubble' }, m.text));
            })));
          } else if (b.t === 'coupon') {
            wrap.append(h('div', { class: 'ps-coupon' },
              ...(b.lines || [b.text]).map((l, i) => h('div', { class: i ? 'ps-coupon-line' : 'ps-coupon-main' }, l))));
          }
        });
        box.append(wrap);
      } else box.append(h('div', null, ps.content));
      return box;
    }

    /* ---------- 交卷與結果 ---------- */
    /* 這次作答了哪幾題:[[題目 key, 選的]](只收有作答的;key 跟刷題、聽力的紀錄一樣,js/wrongbook.js 用) */
    function answered() {
      const out = [];
      units.forEach((u, i) => {
        const a = sess[i].answers;
        if (u.p === '5' || u.p === '1' || u.p === '2') { if (Number.isInteger(a.c)) out.push([u.item.id, a.c]); return; }
        u.item.questions.forEach((q, qi) => {
          const k = u.p === '6' ? q.num : qi;
          if (Number.isInteger(a[k])) out.push([u.p === '6' ? u.item.id + ':' + q.num : qid(u.item, qi), a[k]]);
        });
      });
      return out;
    }
    function submit(timeUp, asked) {
      if (over) return;
      if (!timeUp && !asked) {
        const missing = units.filter((u, i) => !unitAnswered(i)).length;
        if (missing) {
          if (asking) return;
          asking = true;
          closePanel(false);
          UI.confirm({ title: '還有 ' + missing + ' 個題組沒答完', body: '未作答算錯', ok: '交卷', cancel: '繼續作答' })
            .then(yes => { asking = false; if (yes) submit(false, true); });
          return;
        }
      }
      over = true;
      /* 時間到時確認視窗還開著:按一下 Esc 的效果收掉它(視窗自己收乾淨),成績照交 */
      if (asking) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      closePanel(false);
      f.leave();
      clearInterval(timerId);
      unwake();
      stopAudio();

      let lRaw = 0, lTotal = 0, rRaw = 0, rTotal = 0;
      units.forEach((u, i) => {
        const st = sess[i];
        const add = (ok, isL) => { if (isL) { lTotal++; if (ok) lRaw++; } else { rTotal++; if (ok) rRaw++; } };
        if (u.p === '5') add(st.answers.c === u.item.answer, false);
        else if (u.p === '1' || u.p === '2') add(st.answers.c === u.item.answer, true);
        else if (u.p === '6') u.item.questions.forEach(q => add(st.answers[q.num] === q.answer, false));
        else u.item.questions.forEach((q, qi) => add(st.answers[qi] === q.answer, u.sec === 'L'));
      });
      const lScore = MOCK_SCORE.scaled(lTotal ? lRaw / lTotal : 0, 'L');
      const rScore = MOCK_SCORE.scaled(rTotal ? rRaw / rTotal : 0, 'R');
      const rec = { d: new Date().toISOString(), size: sizeKey, lRaw, lTotal, rRaw, rTotal, lScore, rScore };
      const ans = answered();
      let unsaved = '', wb = null;
      if (canSaveNow()) {
        const hist = store.get('mock_history', []);
        hist.push(rec);
        store.set('mock_history', hist.slice(-30));
        /* 答錯的題收進錯題本(mock_wrong):t 跟這一筆 mock_history 同一毫秒。出錯不影響成績 */
        if (window.WRONGBOOK) { try { wb = WRONGBOOK.save(WRONGBOOK.fromAnswers(ans, Date.parse(rec.d))); } catch (e) { wb = null; } }
        saveSeen(ans, Date.parse(rec.d));
      } else {
        /* 存不進去:先放這個分頁,寫明原因(js/common.js accountBlock);放不進 sessionStorage 就只能請他記下分數。
           作答(只有 [題目 key, 選的])一起放,補存時才用題庫算對錯、收進錯題本 */
        const why = typeof accountBlock === 'function' ? accountBlock() : '';
        unsaved = !setLater(laterList().concat([{ pid: window.__PROFILE_ID, rec, ans }])) ? 'lost' : why === 'gone' ? 'gone' : why === 'loading' ? 'loading' : 'other';
      }

      const card = results(timeUp, lRaw, lTotal, rRaw, rTotal, lScore, rScore, unsaved, wb, lTotal + rTotal - ans.length);
    }

    /* 這次成績還沒存進紀錄的說明(unsaved:'gone' 別的分頁登出或換帳號、'loading' 帳號資料夾還沒從雲端灌好、'other'、'lost' 連這個分頁都放不進去)。
       第一行寫發生什麼,第二行只寫怎麼辦;成績先留在分頁的,另起一行小字提醒關掉分頁就不會留 */
    const UNSAVED = {
      gone: '登入後回到這一頁會補存',
      loading: '網路恢復後重新整理會補存',
      other: '回到交卷時的帳號再開這一頁會補存',
      lost: '請先記下分數',
    };
    function unsavedNote(unsaved) {
      if (!unsaved) return null;
      return h('div', { class: 'mock-unsaved', role: 'status' },
        h('b', null, '這次成績和錯題還沒存進紀錄'),
        h('p', null, UNSAVED[unsaved] || UNSAVED.other),
        unsaved === 'lost' ? null : h('p', { class: 'mock-unsaved-fine' }, '關掉分頁就不會留'),
        unsaved === 'lost' ? null : h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, '重新整理'));
    }

    /* 錯題本怎麼變:完整的句子,一行一件事。只有寫完讀回來確認過(wb.ok)才說「已加進」;存不進去時下面「還沒存」那一塊照舊說明 */
    function wrongNote(wb, skipped) {
      if (!wb || !wb.ok) return null;
      const lines = [];
      if (wb.wrong > 0) lines.push('答錯的 ' + wb.wrong + ' 題已加進錯題本。');
      else if (skipped < units.reduce((n, u) => n + unitQs(u), 0)) lines.push('這次沒有答錯的題。');   // 有作答、沒有答錯
      if (wb.cleared > 0) lines.push('錯題本裡有 ' + wb.cleared + ' 題這次答對了，已移出錯題本。');
      if (skipped > 0) lines.push('沒作答的 ' + skipped + ' 題不會加進錯題本。');
      if (!lines.length) return null;
      return h('div', { class: 'mock-wb-note' }, ...lines.map((t) => h('p', null, t)));
    }

    /* 結果:結算卡(分數、聽力與閱讀各自的約略分數、再做一次)放在最上面,逐題檢討收在卡片下面。回傳卡片(掛勾把點心放進 card.reward) */
    function results(timeUp, lRaw, lTotal, rRaw, rTotal, lScore, rScore, unsaved, wb, skipped) {
      document.title = '模擬考結果 - 衝衝英文';
      root.replaceChildren();
      const card = UI.result({
        kicker: '參考總分', big: String(lScore + rScore), unit: '分', ratio: (lRaw + rRaw) / Math.max(1, lTotal + rTotal),
        flag: timeUp ? '時間到' : null,
        stats: [['聽力', String(lScore)], ['閱讀', String(rScore)]],
        primary: { label: '再做一次', onClick: () => startExam(sizeKey), attrs: { 'data-gate': '' } },   // 沒登入時 js/profile.js 先攔下
        links: [{ label: '看錯題本', href: 'review.html' }, { label: '回模擬考', href: 'mock.html' }],
        earnId: 'mock',
      });
      /* 「參考總分」旁的 ⓘ:分數怎麼來的、不是正式成績,寫在點開的資訊欄(js/estimate-ui.js;沒載到就不畫) */
      if (window.ESTIMATE_UI) ESTIMATE_UI.addInfo(card.el, 'mock');
      resultCard = card;
      root.append(card.el);
      const after = [unsaved ? null : wrongNote(wb, skipped || 0), unsavedNote(unsaved)].filter(Boolean);
      if (after.length) root.append(h('div', { class: 'mock-after' }, ...after));
      const blocks = [];

      /* 逐題檢討 */
      units.forEach((u, i) => {
        const st = sess[i];
        const block = h('div', { class: 'q-block', style: 'margin-top:18px' },
          h('div', { class: 'meta', style: 'margin-bottom:8px' },
            h('span', { class: 'badge cat' }, (u.sec === 'L' ? '聽力' : '閱讀') + ' Part ' + u.p)));
        const gradeOpts = (q, chosen) => {
          const opts = h('div', { class: 'opts' });
          q.options.forEach((opt, oi) => {
            let cls = 'opt';
            if (oi === q.answer) cls += ' correct';
            else if (oi === chosen) cls += ' wrong';
            else cls += ' plain';
            opts.append(h('button', { class: cls, disabled: '' },
              h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
          });
          return opts;
        };
        /* ctx = { m, id }:詳解方塊底部加「回報題目」(js/report.js),id 跟刷題、聽力的學習記錄同一套 */
        const verdict = (q, chosen, ctx) => {
          const box = h('div', { class: 'explain' },
            h('div', { class: 'verdict ' + (chosen === q.answer ? 'ok' : 'bad') },
              chosen === q.answer ? '答對' : (chosen === undefined ? '未作答 · 正解 ' : '答錯 · 正解 ') + LETTERS[q.answer]),
            h('div', null, q.explanation));
          if (ctx && window.REPORT) REPORT.attach(box, ctx);
          return box;
        };

        if (u.p === '5') {
          block.append(h('div', { class: 'q-text' }, u.item.question), gradeOpts(u.item, st.answers.c), verdict(u.item, st.answers.c, { m: 'p5', id: u.item.id }),
            h('div', { class: 'explain' }, h('div', { class: 'tr' }, u.item.translation)));
        } else if (u.p === '1' || u.p === '2') {
          if (u.p === '1') block.append(h('div', { class: 'listen-photo' }, h('img', {
            src: 'img/listening/' + u.item.id + '.jpg', alt: '聽力照片',
            onerror: e => e.target.replaceWith(h('div', { class: 'photo-missing' }, '照片準備中')),
          })));
          const q = u.item;
          block.append(gradeOpts({ options: q.options.map((o, oi) => LETTERS[oi] + '. ' + o), answer: q.answer, explanation: q.explanation }, st.answers.c),
            verdict(q, st.answers.c, { m: 'l' + u.p, id: q.id, audio: true }),
            h('div', { class: 'transcript-box' }, h('b', null, '逐字稿'),
              h('div', { class: 'tr-en' }, (q.question ? q.question + '\n' : '') + q.options.map((o, oi) => LETTERS[oi] + '. ' + o).join('\n')),
              h('div', { class: 'tr-zh' }, q.transcriptZh)));
        } else if (u.sec === 'L') {
          const set = u.item;
          set.questions.forEach((q, qi) => {
            block.append(h('div', { class: 'q-text', style: 'margin-top:10px' }, h('span', { class: 'q-no' }, 'Q' + (qi + 1)), q.q),
              gradeOpts(q, st.answers[qi]), verdict(q, st.answers[qi], { m: 'l' + u.p, id: set.id + ':' + qi, audio: true }));
          });
          const transcript = u.p === '3'
            ? set.dialogue.map(t => (t.s === 'M' ? '男：' : '女：') + t.text).join('\n')
            : set.talk;
          block.append(h('div', { class: 'transcript-box' }, h('b', null, '逐字稿'),
            h('div', { class: 'tr-en' }, transcript), h('div', { class: 'tr-zh' }, set.transcriptZh)));
        } else {
          const set = u.item;
          if (u.p === '7') set.passages.forEach(ps => block.append(p7Fallback(ps)));
          else block.append(h('div', { class: 'passage-box', style: 'position:static;max-height:none' },
            h('div', null, String(set.passage).replace(/\{\{(\d)\}\}/g, (m, n) => {
              const q = set.questions.find(x => x.num === Number(n));
              return q ? '【' + q.options[q.answer] + '】' : m;
            }))));
          set.questions.forEach((q, qi) => {
            const key = u.p === '6' ? q.num : qi;
            block.append(h('div', { class: 'q-text', style: 'margin-top:10px' },
              h('span', { class: 'q-no' }, u.p === '6' ? '(' + q.num + ')' : 'Q' + (qi + 1)),
              u.p === '6' ? '空格 (' + q.num + ')' : q.q),
              gradeOpts(q, st.answers[key]), verdict(q, st.answers[key], { m: 'p' + u.p, id: set.id + ':' + key }));
          });
        }
        blocks.push(block);
      });
      root.append(UI.detail('逐題解析 ' + (lTotal + rTotal) + ' 題', blocks, { wrong: lTotal + rTotal - lRaw - rRaw }));
      window.scrollTo(0, 0);
      card.heading.focus({ preventScroll: true });
      return card;
    }

    draw();
    f.focusMain();
  }
})();
