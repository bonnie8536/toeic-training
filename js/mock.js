/* 模擬考:照正式節奏的計時測驗。
   - 從現有題庫隨機抽題(聽力+閱讀),全程倒數,時間到自動交卷。
   - 聽力每題音檔只能播一次(正式考規則);全部交卷後才對答案。
   - 分數為參考換算(樣本小,僅供追蹤趨勢);紀錄存 mock_history(雲端同步)。
   - 交卷時答錯的題收進錯題本(mock_wrong,js/wrongbook.js;錯題本定稿 2026-11-18)。沒作答的不收;原本在錯題本、這次答對的移出。
     不寫 drill_p*、listen_p*、hist(那幾個鍵是整份上傳,模擬考頁寫它們會蓋掉別台在考試期間刷的題)。 */
(function () {
  const root = $('#mock-root');
  const LDATA = (window.TOEIC && TOEIC.listening) || null;
  if (!window.TOEIC || !TOEIC.part5 || !LDATA) {
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' }, '題庫載入中，稍後再來。'));
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
  };

  /* 參考換算(百分比→單科 5-495;正式換算依全卷等化,這裡只做趨勢參考) */
  const CONV = [[0.97, 495], [0.92, 470], [0.86, 440], [0.8, 410], [0.75, 380], [0.7, 350],
    [0.65, 320], [0.6, 290], [0.55, 260], [0.5, 230], [0.45, 200], [0.4, 170],
    [0.35, 140], [0.3, 110], [0.25, 85], [0.15, 55], [0, 5]];
  const scaled = pct => CONV.find(([t]) => pct >= t)[1];

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

  /* ---------- 交卷時存不進去的成績(第 2 輪審查 2026-10-31) ----------
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
  /* 補存:分數照舊補進 mock_history;那一筆帶著作答(ans,錯題本定稿 2026-11-18)就順便把答錯的題補進錯題本(js/wrongbook.js)。
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
    setLater(all.filter(x => mine.indexOf(x) < 0));
    return true;
  }
  let onHome = false;

  renderHome();
  /* 確認登入之後(這一頁不重載、能作答):之前存不進去的成績補存,首頁的紀錄表跟著重畫 */
  Promise.resolve(window.CLOUD ? CLOUD.ready : null).then(() => { if (saveLater() && onHome) renderHome(); }, () => {});
  /* 開頁先跟雲端對齊模擬考錯題(js/wrongbook.js syncCloud;審查 2026-11-19 #1):部署前就開著的舊版分頁會把帳本上的 mock_wrong 整份上傳,
     本機先有別台考的錯題,交卷後就算被它整份傳上去也還在 */
  if (window.WRONGBOOK && typeof WRONGBOOK.syncCloud === 'function') WRONGBOOK.syncCloud();

  /* ================= 首頁 ================= */
  function renderHome() {
    onHome = true;
    document.title = '模擬考 - 衝衝英文';
    root.innerHTML = '';
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '模擬考'),
      h('p', null, '聽力只播一次，交卷才看答案。')));

    const cards = h('div', { class: 'part-cards', style: 'grid-template-columns:1fr 1fr' });
    Object.entries(SIZES).forEach(([k, s]) => {
      cards.append(h('div', { class: 'part-card' },
        h('h3', null, s.name),
        h('p', null, s.desc),
        h('div', { class: 'p-stats' }, '限時 ' + s.mins + ' 分鐘'),
        h('div', { class: 'cfg-row' },
          h('button', { class: 'btn primary', 'data-gate': '', onclick: () => startExam(k) }, '開始'))));   // 開始考試:沒登入時 js/profile.js 先攔下
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
          (since.getMonth() + 1) + '/' + since.getDate() + ' 以前的模擬考錯題沒有收進錯題本。'));
      }
    }
  }

  /* ================= 考試 ================= */
  function startExam(sizeKey) {
    onHome = false;
    const cfg = SIZES[sizeKey];
    const units = [];
    if (cfg.l.p1) pick(LDATA.p1, cfg.l.p1).forEach(item => units.push({ sec: 'L', p: '1', item }));
    pick(LDATA.p2, cfg.l.p2).forEach(item => units.push({ sec: 'L', p: '2', item }));
    pick(LDATA.p3, cfg.l.p3).forEach(item => units.push({ sec: 'L', p: '3', item }));
    pick(LDATA.p4, cfg.l.p4).forEach(item => units.push({ sec: 'L', p: '4', item }));
    pick(TOEIC.part5, cfg.r.p5).forEach(item => units.push({ sec: 'R', p: '5', item }));
    pick(TOEIC.part6, cfg.r.p6).forEach(item => units.push({ sec: 'R', p: '6', item }));
    pick(TOEIC.part7, cfg.r.p7).forEach(item => units.push({ sec: 'R', p: '7', item }));

    document.title = '模擬考進行中 - 衝衝英文';
    document.body.dataset.leaveConfirm = '模擬考還沒交卷，離開後這次作答不會計分。確定離開？';
    const sess = units.map(() => ({ answers: {}, played: 0 }));
    let cur = 0;
    let over = false;
    let audio = null;
    let deadline = Date.now() + cfg.mins * 60 * 1000;
    const timerEl = h('span', { class: 'mock-timer' });
    const timerId = setInterval(tick, 1000);
    tick();

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

    function draw() {
      stopAudio();
      root.innerHTML = '';
      const u = units[cur];
      root.append(h('div', { class: 'drill-top' },
        h('h1', null, '模擬考 ', h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' },
          cfg.name + ' · ' + (u.sec === 'L' ? '聽力' : '閱讀'))),
        timerEl,
        h('button', { class: 'btn', style: 'margin-left:12px', onclick: () => submit(false) }, '交卷')));
      const nav = h('div', { class: 'q-nav' });
      units.forEach((x, i) => {
        let cls = i === cur ? 'cur' : '';
        if (unitAnswered(i)) cls += ' ans';
        if (x.sec === 'L') cls += ' mock-l';
        nav.append(h('button', { class: cls.trim(), onclick: () => { cur = i; draw(); window.scrollTo(0, 0); } }, String(i + 1)));
      });
      root.append(nav);
      if (u.p === '5') drawP5(u);
      else if (u.sec === 'R') drawRSet(u);
      else drawLUnit(u);
      root.append(navRow());
    }

    function navRow() {
      const isLast = cur === units.length - 1;
      return h('div', { class: 'drill-nav-btns' },
        h('button', {
          class: 'btn primary',
          onclick: () => { if (isLast) submit(false); else { cur++; draw(); window.scrollTo(0, 0); } },
        }, isLast ? '交卷' : '下一題 →'));
    }

    function makeOncePlayer(id, state) {
      const btn = h('button', { class: 'btn primary player-btn', type: 'button' }, state.played ? '已播放' : '▶ 播放（限一次）');
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
            class: 'letter-big' + (state.answers.c === i ? ' picked' : ''),
            onclick: () => { state.answers.c = i; draw(); },
          }, LETTERS[i]));
        }
        block.append(h('div', { class: 'q-text', style: 'margin-top:10px' },
          u.p === '1' ? '選出最符合照片的描述：' : '選出最合適的回應：'), row);
      } else {
        u.item.questions.forEach((q, qi) => {
          const opts = h('div', { class: 'opts', style: 'margin-top:6px' });
          q.options.forEach((opt, oi) => {
            opts.append(h('button', {
              class: 'opt' + (state.answers[qi] === oi ? ' picked' : ''),
              onclick: () => { state.answers[qi] = oi; draw(); },
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
          class: 'opt' + (state.answers.c === oi ? ' picked' : ''),
          onclick: () => { state.answers.c = oi; draw(); },
        }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
      });
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, '閱讀 Part 5')),
        h('div', { class: 'q-text', style: 'font-size:17px' }, q.question),
        opts));
    }

    function drawRSet(u) {
      const set = u.item;
      const state = sess[cur];
      const layout = h('div', { class: 'set-layout' });
      const passCol = h('div', { class: 'passage-sticky-wrap' });
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
            class: 'opt' + (state.answers[key] === oi ? ' picked' : ''),
            onclick: () => { state.answers[key] = oi; draw(); },
          }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
        });
        qCol.append(h('div', { class: 'q-block' },
          h('div', { class: 'q-text' },
            h('span', { class: 'q-no' }, u.p === '6' ? '(' + q.num + ')' : 'Q' + (qi + 1)),
            u.p === '6' ? '選出最適合填入空格的答案' : q.q),
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
        if (missing && !confirm('還有 ' + missing + ' 個題組沒答完，確定交卷？未作答算錯。')) return;
        /* 原生確認視窗開著的時候,別的分頁對 localStorage 的改動(登出、換帳號、記上「還沒灌過」)Chrome 不會送進這一頁,
           按確定之後要再過兩個工作(實測約 2 毫秒)才看得到,在那之前讀到的還是舊值,下面的 canSaveNow 會照樣存:等 50 毫秒再往下(審查 D 第 4 輪 #3) */
        if (missing) { setTimeout(() => submit(false, true), 50); return; }
      }
      over = true;
      delete document.body.dataset.leaveConfirm;
      clearInterval(timerId);
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
      const lScore = scaled(lTotal ? lRaw / lTotal : 0);
      const rScore = scaled(rTotal ? rRaw / rTotal : 0);
      const rec = { d: new Date().toISOString(), size: sizeKey, lRaw, lTotal, rRaw, rTotal, lScore, rScore };
      const ans = answered();
      let unsaved = '', wb = null;
      if (canSaveNow()) {
        const hist = store.get('mock_history', []);
        hist.push(rec);
        store.set('mock_history', hist.slice(-30));
        /* 答錯的題收進錯題本(mock_wrong,錯題本定稿 2026-11-18):t 跟這一筆 mock_history 同一毫秒。出錯不影響成績 */
        if (window.WRONGBOOK) { try { wb = WRONGBOOK.save(WRONGBOOK.fromAnswers(ans, Date.parse(rec.d))); } catch (e) { wb = null; } }
      } else {
        /* 存不進去:先放這個分頁,寫明原因(js/common.js accountBlock);放不進 sessionStorage 就只能請他記下分數。
           作答(只有 [題目 key, 選的])一起放,補存時才用題庫算對錯、收進錯題本 */
        const why = typeof accountBlock === 'function' ? accountBlock() : '';
        unsaved = !setLater(laterList().concat([{ pid: window.__PROFILE_ID, rec, ans }])) ? 'lost' : why === 'gone' ? 'gone' : why === 'loading' ? 'loading' : 'other';
      }

      results(timeUp, lRaw, lTotal, rRaw, rTotal, lScore, rScore, unsaved, wb, lTotal + rTotal - ans.length);
      if (window.PET_HOOK) PET_HOOK.done('mock', { into: root.querySelector('.report-head') });
    }

    /* 這次成績還沒存進紀錄的說明(unsaved:'gone' 別的分頁登出或換帳號、'loading' 帳號資料夾還沒從雲端灌好、'other'、'lost' 連這個分頁都放不進去) */
    const UNSAVED = {
      gone: '這個帳號在別的分頁登出或換了帳號，這次成績和錯題存不進去，先留在這個分頁。在這個分頁用原本的帳號登入、回到模擬考頁就會自動補存；關掉這個分頁就不會留。',
      loading: '這一頁還沒從雲端拿到你的練習紀錄，這次成績和錯題先留在這個分頁。網路恢復後重新整理，就會自動補存；關掉這個分頁就不會留。',
      other: '這次成績和錯題先留在這個分頁，在這個分頁回到交卷時的帳號或學生、再開模擬考頁就會自動補存；關掉這個分頁就不會留。',
      lost: '這個瀏覽器不讓網頁暫存，這次成績和錯題沒辦法留下來，請先記下分數。',
    };
    function unsavedNote(unsaved) {
      if (!unsaved) return null;
      return h('div', { class: 'mock-unsaved', role: 'status' },
        h('b', null, '這次成績和錯題還沒存進紀錄'),
        h('p', null, UNSAVED[unsaved] || UNSAVED.other),
        unsaved === 'lost' ? null : h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, '重新整理'));
    }

    /* 錯題收進錯題本的那一行:只有寫完讀回來確認過(wb.ok)才說「已收進」;存不進去時上面「還沒存」那一塊照舊說明 */
    function wrongNote(wb, skipped) {
      if (!wb || !wb.ok) return null;
      const parts = [];
      if (wb.wrong > 0) parts.push('收進錯題本 ' + wb.wrong + ' 題');
      else if (skipped < units.reduce((n, u) => n + unitQs(u), 0)) parts.push('這次沒有答錯的題');   // 有作答、沒有答錯
      if (wb.cleared > 0) parts.push('移出 ' + wb.cleared + ' 題');
      if (skipped > 0) parts.push('未作答 ' + skipped + ' 題不收');
      if (!parts.length) return null;
      return h('div', { class: 'band-note mock-wb-note' }, parts.join(' · '),
        wb.wrong + wb.cleared > 0 ? h('a', { href: 'practice.html#wrongbook', style: 'margin-left:6px' }, '看錯題本 →') : null);
    }

    function results(timeUp, lRaw, lTotal, rRaw, rTotal, lScore, rScore, unsaved, wb, skipped) {
      document.title = '模擬考結果 - 衝衝英文';
      root.innerHTML = '';
      root.append(h('div', { class: 'drill-top' }, h('h1', null, '模擬考結果'),
        h('a', { href: 'mock.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回模擬考')));
      root.append(h('div', { class: 'report-head', style: 'margin-top:16px' },
        h('h2', null, '參考總分 ' + (lScore + rScore)),
        h('div', { class: 'band-note' },
          (timeUp ? '時間到，自動交卷。' : '') +
          '聽力 ' + lRaw + ' / ' + lTotal + ' 約 ' + lScore + ' 分 · 閱讀 ' + rRaw + ' / ' + rTotal + ' 約 ' + rScore + ' 分 · 參考換算，非正式成績'),
        unsaved ? null : wrongNote(wb, skipped || 0),
        unsavedNote(unsaved)));
      root.append(h('div', { class: 'drill-nav-btns' },
        h('button', { class: 'btn primary', 'data-gate': '', onclick: () => startExam(sizeKey) }, '再做一次'),
        h('a', { class: 'btn', href: 'mock.html' }, '回模擬考')));

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
              chosen === q.answer ? '答對了' : (chosen === undefined ? '未作答 · 正解 ' : '答錯 · 正解 ') + LETTERS[q.answer]),
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
        root.append(block);
      });
      window.scrollTo(0, 0);
    }

    draw();
  }
})();
