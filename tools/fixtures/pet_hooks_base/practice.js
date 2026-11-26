/* 刷題模組(隨機練習版):
   - 隨機練習:選題型+題數(P5 選考點亦可),隨機抽題(優先抽沒做過的,其次答錯的)。
     作答是專心模式:題目一題一頁,只記選擇不對答案,交卷後一次看成績卡與逐題解析。
   - 錯題本:歷來答錯的題目集中在這裡複習,重新答對就移出;複習時每題作答後馬上給回饋。
   - 作答紀錄仍存 drill_p5/p6/p7(雲端模式會同步),錯題本由紀錄即時推導。
   - 課程頁的入口 window.DRILL.startQuiz(el, units, opts)(沒有 #practice-root 的頁面只開這個入口):units = [{ p: '5'–'7', item }]
     (BANK.get 拿到的)照順序出、不抽題;opts 與結果見 js/lesson-entry.js(課程頁要先載入它)。 */
(function () {
  const root = $('#practice-root');
  const DATA = {
    '5': { items: (window.TOEIC && TOEIC.part5) || [], title: 'Part 5 單句填空', unit: '題', sizes: [5, 10, 15, 20, 30, 50] },
    '6': { items: (window.TOEIC && TOEIC.part6) || [], title: 'Part 6 段落填空', unit: '組', sizes: [1, 2, 3, 4, 5, 8] },
    '7': { items: (window.TOEIC && TOEIC.part7) || [], title: 'Part 7 閱讀理解', unit: '組', sizes: [1, 2, 3, 4, 5, 8] },
  };
  const KEY = p => 'drill_p' + p;
  const HOME = 'practice.html';
  const GATE = { 'data-gate': '' };   // 會寫紀錄的按鈕:沒登入時 js/profile.js 先攔下
  const listUrl = p => 'practice.html?mode=wrong&part=' + p;

  /* 空狀態:頁首(圖示+標題)加一張 UI.empty。action 沒給 href 時是按鈕 */
  function emptyView(title, text, action, doodle) {
    root.replaceChildren(
      h('div', { class: 'page-head' },
        doodle ? h('canvas', { class: 'hub-art', 'data-doodle': doodle, 'data-size': '40', 'aria-hidden': 'true' }) : null,
        h('h1', null, title)),
      UI.empty({ pose: 'sleep', text, action }));
    if (doodle) UI.doodle(root);
  }

  if (!DATA['5'].items.length) {
    if (root) root.append(UI.empty({ pose: 'sleep', text: '題庫沒有載入完成', action: { label: '重新整理', onClick: () => location.reload() } }));
    return;
  }

  function qid(set, q, qi) { return set.id + ':' + (q.num !== undefined ? q.num : qi); }

  function partStats(p) {
    const st = store.get(KEY(p), {});
    let total = 0, answered = 0, correct = 0, wrong = 0;
    if (p === '5') {
      total = DATA['5'].items.length;
      DATA['5'].items.forEach(q => {
        const rec = st[q.id];
        if (rec) { answered++; rec.ok ? correct++ : wrong++; }
      });
    } else {
      DATA[p].items.forEach(set => set.questions.forEach((q, qi) => {
        total++;
        const rec = st[qid(set, q, qi)];
        if (rec) { answered++; rec.ok ? correct++ : wrong++; }
      }));
    }
    return { total, answered, correct, wrong };
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* 抽題:沒做過的 → 答錯過的 → 其餘 */
  function pickPool(p, n, cat) {
    const st = store.get(KEY(p), {});
    let pool = DATA[p].items;
    if (p === '5' && cat && cat !== 'all') pool = pool.filter(q => q.category === cat);
    const fresh = [], wrong = [], done = [];
    pool.forEach(x => {
      if (p === '5') {
        const rec = st[x.id];
        (!rec ? fresh : rec.ok ? done : wrong).push(x);
      } else {
        const recs = x.questions.map((q, qi) => st[qid(x, q, qi)]);
        if (recs.some(r => !r)) fresh.push(x);
        else if (recs.some(r => !r.ok)) wrong.push(x);
        else done.push(x);
      }
    });
    return [...shuffle(fresh), ...shuffle(wrong), ...shuffle(done)].slice(0, n);
  }

  /* ---------- 路由 ----------
     ?mode=wrong&part=N 是那個 Part 的錯題本清單(js/wrongbook-ui.js);
     ?mode=review&part=N(&g=組名)複習整個 Part 或只複習一組,一回有上限。聽力的 part(1–4)只有 window.LISTEN 在才走 */
  const mode = getParam('mode');
  const partParam = getParam('part');
  const listenPart = p => !!window.LISTEN && ['1', '2', '3', '4'].indexOf(p) > -1;
  const WB = window.WRONGBOOK || null;
  window.DRILL = Object.freeze({ startQuiz: lessonQuiz });
  if (!root) { /* 課程頁:不畫刷題頁,只開上面的入口 */ }
  else if (mode === 'wrong' && (DATA[partParam] || listenPart(partParam))) renderWrong(partParam);
  else if (mode === 'review' && DATA[partParam]) startReview(partParam, getParam('g'));
  else if (mode === 'review' && listenPart(partParam)) { LISTEN.startReview(root, partParam, getParam('g')); }
  else if (partParam && DATA[partParam]) {
    // 相容程度檢測報告的深連結:直接開一輪隨機練習
    startQuiz([{ p: partParam, n: partParam === '5' ? 10 : 2, cat: getParam('cat') || 'all' }]);
  } else renderHome();
  /* 開頁先跟雲端對齊模擬考錯題(js/wrongbook.js syncCloud):別台考的錯題合併進本機,
     錯題本面板、錯題本清單由 js/wrongbook-ui.js keepFresh 收到 cloud:merged 重畫 */
  if (root && WB && typeof WB.syncCloud === 'function') WB.syncCloud();

  /* ================= 首頁 ================= */
  function renderHome() {
    document.title = '題庫刷題 - 衝衝英文';
    root.append(h('div', { class: 'page-head' },
      h('canvas', { class: 'hub-art', 'data-doodle': 'practice', 'data-size': '40', 'aria-hidden': 'true' }),
      h('h1', null, '題庫刷題')));

    /* 隨機練習:三個 Part 各一列(勾選+數量),可同時勾多個混合出題 */
    const cats = [...new Set(DATA['5'].items.map(q => q.category))];
    const initCat = getParam('cat');

    function sizeLabel(p, n) {
      if (p === '5') return n + ' 題';
      return n + ' 組 · ' + (p === '6' ? n * 4 + ' 題' : '約 ' + n * 4 + '–' + n * 5 + ' 題');
    }

    const rows = ['5', '6', '7'].map(p => {
      const cb = h('input', { type: 'checkbox' });
      if (p === '5') cb.checked = true;
      const sizeSel = h('select', { class: 'cfg-select', 'aria-label': DATA[p].title + ' 題數' });
      DATA[p].sizes.forEach(n => sizeSel.append(h('option', { value: n }, sizeLabel(p, n))));
      sizeSel.append(h('option', { value: 'custom' }, '自訂…'));
      if (p === '5') sizeSel.value = '10';
      const customInput = h('input', { class: 'cfg-select', type: 'number', min: '1', style: 'width:84px;display:none', placeholder: '數量', 'aria-label': DATA[p].title + ' 自訂數量' });
      sizeSel.addEventListener('change', () => {
        cb.checked = true;
        customInput.style.display = sizeSel.value === 'custom' ? '' : 'none';
        if (sizeSel.value === 'custom') customInput.focus();
      });
      customInput.addEventListener('input', () => { cb.checked = true; });
      let catSel = null;
      if (p === '5') {
        catSel = h('select', { class: 'cfg-select', 'aria-label': '考點' },
          h('option', { value: 'all' }, '全部考點'),
          cats.map(c => h('option', { value: c }, catLabel(c))));
        if (initCat && cats.includes(initCat)) catSel.value = initCat;
        catSel.addEventListener('change', () => { cb.checked = true; });
      }
      const row = h('div', { class: 'cfg-part-row' },
        h('label', { class: 'cfg-part-check' }, cb, h('span', null, DATA[p].title)),
        sizeSel, customInput, catSel);
      return { p, cb, sizeSel, customInput, catSel, row };
    });

    function rowSize(r) {
      const max = DATA[r.p].items.length;
      if (r.sizeSel.value !== 'custom') return Number(r.sizeSel.value);
      const n = Math.floor(Number(r.customInput.value));
      if (!n || n < 1) return null;
      return Math.min(n, max);
    }

    /* 開始鈕:這一頁唯一的實色按鈕 */
    const startBtn = h('button', {
      class: 'btn primary practice-start', 'data-gate': '',
      onclick: () => {
        const config = [];
        for (const r of rows) {
          if (!r.cb.checked) continue;
          const n = rowSize(r);
          if (n === null) { r.customInput.focus(); return; }
          config.push({ p: r.p, n, cat: r.p === '5' && r.catSel ? r.catSel.value : 'all' });
        }
        if (!config.length) return;
        startQuiz(config);
      },
    }, '開始');

    /* 錯題本面板的各列(data-part、wb-see:從 bfcache 回來重畫時,焦點放回同一列的「查看」)。「查看」的報讀名稱帶 Part,7 顆才分得出來。
       0 題的 Part 不列;全部都是 0 題時整個面板不顯示(人已經在刷題頁,空狀態的出口只會回到同一頁) */
    function wbRows() {
      const list = [];
      ['5', '6', '7'].forEach(p => {
        const n = WB ? WB.count(p) : partStats(p).wrong;
        if (!n) return;
        list.push(h('div', { class: 'review-row', 'data-part': p },
          h('span', null, DATA[p].title),
          h('b', { style: 'color:var(--bad)' }, n + ' 題'),
          WB ? h('a', { class: 'btn wb-see', href: listUrl(p), 'aria-label': '查看 ' + WB.TITLE[p] + ' 錯題本' }, '查看')
            : h('button', { class: 'btn', 'data-gate': '', onclick: () => startReview(p) }, '開始')));
      });
      if (window.LISTEN) ['1', '2', '3', '4'].forEach(p => {
        const n = WB ? WB.count(p) : LISTEN.partStats(p).wrong;
        if (!n) return;
        list.push(h('div', { class: 'review-row', 'data-part': p },
          h('span', null, '聽力 ' + LISTEN.PARTS[p].title),
          h('b', { style: 'color:var(--bad)' }, n + ' 題'),
          WB ? h('a', { class: 'btn wb-see', href: listUrl(p), 'aria-label': '查看 ' + WB.TITLE[p] + ' 錯題本' }, '查看')
            : h('button', { class: 'btn', 'data-gate': '', onclick: () => { root.innerHTML = ''; LISTEN.startReview(root, p); window.scrollTo(0, 0); } }, '開始')));
      });
      return list;
    }
    const wbRowsBox = h('div', { class: 'review-rows' }, wbRows());

    /* 三塊面板在同一個格線裡,間距都一樣:桌機左欄是隨機練習、聽力隨機練習,右欄是錯題本(佔兩列,css);手機一欄。
       錯題本沒有錯題時不顯示,聽力面板遞補到右欄 */
    const panels = h('div', { class: 'practice-panels' },
      h('div', { class: 'practice-panel' },
        h('h2', null, '隨機練習'),
        h('div', { class: 'cfg-rows' }, rows.map(r => r.row)),
        startBtn),
      /* 錯題本面板:每個 Part 一列「N 題 + 查看」,查看連到那個 Part 的錯題本清單(一組一組,點開才看到題目)。
         題數含模擬考答錯的題(js/wrongbook.js);沒載到就照以前只算刷題紀錄,按鈕照舊直接複習 */
      h('div', { class: 'practice-panel', id: 'wrongbook', hidden: wbRowsBox.childElementCount ? null : '' },
        h('h2', null, '錯題本'),
        wbRowsBox));
    root.append(panels);
    /* 從錯題本複習按上一頁回來(bfcache 原樣拿回來):題數變了就重畫這幾列(js/wrongbook-ui.js keepFresh) */
    if (WB && window.WRONGBOOK_UI) WRONGBOOK_UI.keepFresh(wbRowsBox, () => WRONGBOOK_UI.sig(WB.PARTS), () => {
      wbRowsBox.replaceChildren(...wbRows());
      const panel = document.getElementById('wrongbook');
      if (panel) panel.hidden = !wbRowsBox.childElementCount;
    });
    /* practice.html#wrongbook(從錯題本、模擬考結果連過來):面板是 JS 畫的,瀏覽器自己不會捲過去。
       頂欄是固定的(sticky),要扣掉它的高度(.me-sec 的 scroll-margin-top 同一個意思);桌機一列、手機兩列、更窄還會更高,照實際高度算 */
    if (location.hash === '#wrongbook') {
      const panel = document.getElementById('wrongbook');
      if (panel && !panel.hidden) setTimeout(() => {
        const bar = document.querySelector('.topbar');
        panel.style.scrollMarginTop = (bar ? Math.ceil(bar.getBoundingClientRect().height) : 0) + 14 + 'px';
        panel.scrollIntoView({ block: 'start' });
      }, 0);
    }

    /* 聽力隨機練習面板 */
    if (window.LISTEN) {
      const lrows = ['1', '2', '3', '4'].map(p => {
        const d = LISTEN.PARTS[p];
        const cb = h('input', { type: 'checkbox' });
        if (p === '2') cb.checked = true;
        const sel = h('select', { class: 'cfg-select', 'aria-label': '聽力 ' + d.title + ' 題數' },
          d.sizes.map(n => h('option', { value: n }, n + ' ' + d.unit)));
        if (p === '2') sel.value = '10';
        sel.addEventListener('change', () => { cb.checked = true; });
        const s = LISTEN.partStats(p);
        const row = h('div', { class: 'cfg-part-row' },
          h('label', { class: 'cfg-part-check' }, cb, h('span', null, d.title)),
          sel,
          h('span', { class: 'cfg-done' }, '已作答 ' + s.answered + ' / ' + s.total));
        return { p, cb, sel, row };
      });
      panels.append(h('div', { class: 'practice-panel listen-panel' },
        h('h2', null, '聽力隨機練習'),
        h('div', { class: 'cfg-rows' }, lrows.map(r => r.row)),
        h('button', {
          class: 'btn listen-start', 'data-gate': '', 'aria-label': '開始聽力練習',
          onclick: () => {
            const config = lrows.filter(r => r.cb.checked).map(r => ({ p: r.p, n: Number(r.sel.value) }));
            if (!config.length) return;
            root.innerHTML = '';
            LISTEN.startQuiz(root, config);
            window.scrollTo(0, 0);
          },
        }, '開始')));
    }
    if (window.UI) UI.doodle(root);
  }

  /* ================= 共用:選項與解析 ================= */
  function optionButtons(q, rec, onPick) {
    const opts = h('div', { class: 'opts' });
    q.options.forEach((opt, oi) => {
      let cls = 'opt';
      if (rec) {
        if (oi === q.answer) cls += ' correct';
        else if (oi === rec.c) cls += ' wrong';
        else cls += ' plain';
      }
      opts.append(h('button', {
        class: cls, 'data-gate': '',   // 錯題本作答(一點就存):沒登入時 js/profile.js 先攔下
        disabled: rec ? '' : null,
        onclick: () => onPick(oi),
      }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
    });
    return opts;
  }

  /* P5 考點 → 文法基礎對應單元(考點解析下放複習連結) */
  const GRAMMAR_LINK = {
    '動詞時態與語態': ['gc-12', '時態怎麼選'],
    '介系詞': ['gg-01', '介系詞'],
    '連接詞vs介系詞': ['gg-08', '連接詞'],
    '代名詞': ['ga-09', '代名詞'],
    '關係詞': ['gh-03', '關係代名詞'],
    '分詞': ['gf-02', '-ed 與 -ing 形容詞'],
    '比較級': ['gf-05', '比較級'],
    '不定詞與動名詞': ['gg-11', '不定詞與動名詞'],
    '主謂一致': ['gb-05', '第三人稱單數'],
    '詞性變化': ['gf-04', '形容詞還是副詞'],
  };

  /* ctx = { m, id }:有給就在詳解方塊底部加「回報題目」(js/report.js);id 跟 saveRec 記的題號同一套 */
  function explainBox(q, rec, extraTr, ctx) {
    if (!rec) return null;
    const box = h('div', { class: 'explain' },
      h('div', { class: 'verdict ' + (rec.ok ? 'ok' : 'bad') },
        rec.ok ? '答對' : (rec.c === -1 ? '未作答 · 正解 ' : '答錯 · 正解 ') + LETTERS[q.answer]),
      h('div', null, q.explanation));
    if (extraTr) box.append(h('div', { class: 'tr' }, extraTr));
    const gl = q.category && GRAMMAR_LINK[q.category];
    if (gl && !rec.ok) {
      box.append(h('div', { class: 'tr' },
        h('a', { href: 'grammar.html?u=' + gl[0] }, '文法基礎「' + gl[1] + '」→')));
    }
    if (ctx && window.REPORT) REPORT.attach(box, ctx);
    return box;
  }
  /* 作答當下底部的回饋條已經寫了對錯與正解:解析方塊拿掉那一行 */
  function withoutVerdict(box) {
    const v = box && box.querySelector('.verdict');
    if (v) v.remove();
    return box;
  }

  /* 作答期間的選項(交卷式:只選不對答,可改選)。選到的那顆 aria-pressed=true,讀屏聽得出選了哪個 */
  function pickButtons(q, rec, onPick) {
    const opts = h('div', { class: 'opts' });
    q.options.forEach((opt, oi) => {
      opts.append(h('button', {
        class: 'opt' + (rec && rec.c === oi ? ' picked' : ''), 'data-gate': '',   // 選答案:?part= 深連結一打開就是題目,選的時候才請他登入
        'aria-pressed': rec && rec.c === oi ? 'true' : 'false',
        onclick: () => onPick(oi),
      }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
    });
    return opts;
  }

  function saveRec(p, id, oi, ok) {
    const st = store.get(KEY(p), {});
    st[id] = { c: oi, ok, t: Date.now() };
    store.set(KEY(p), st);
    logAttempt('p' + p, id, oi, ok);
  }

  /* 專心模式的底部按鈕:文字按鈕(上一題)與實色主按鈕(gate:要登入才能做的那一下標 data-gate) */
  function textBtn(label, onClick) {
    return h('button', { class: 'btn-text', type: 'button', onclick: onClick }, label);
  }
  function mainBtn(label, onClick, gate, disabled) {
    return h('button', { class: 'btn primary', type: 'button', 'data-gate': gate ? '' : null, disabled: disabled ? '' : null, onclick: onClick }, label);
  }
  /* 作答列右邊的「交卷」(標 data-gate:沒登入時 js/profile.js 先攔下) */
  function setSubmit(f, onClick) {
    f.action(onClick ? { label: '交卷', onClick, attrs: GATE } : null);
  }

  /* ================= 錯題本清單(?mode=wrong&part=N) ================= */
  function renderWrong(p) {
    if (window.WRONGBOOK_UI) { WRONGBOOK_UI.renderList(root, p); return; }
    document.title = '錯題本 - 衝衝英文';
    emptyView('錯題本', '錯題本沒有載入完成', { label: '重新整理', onClick: () => location.reload() }, 'wrongbook');
  }

  /* 結算卡:再做一次、下一回這類會寫紀錄的主按鈕在 UI.result 的 primary 帶 attrs: GATE */
  function showResult(card, detail) {
    root.replaceChildren(card.el);
    if (detail) root.append(detail);
    window.scrollTo(0, 0);
    card.heading.focus({ preventScroll: true });
  }

  /* ================= 隨機練習(config=[{p,n,cat}],可混合多個 Part) ================= */
  function startQuiz(config) {
    if (!uiReady()) return;   // 共用元件沒載到:說一聲、給重新整理,不在這裡丟錯
    document.title = '隨機練習 - 衝衝英文';
    const units = [];   // {p, item}:p5 的 item=題目,p6/7 的 item=題組
    config.forEach(c => pickPool(c.p, c.n, c.cat).forEach(item => units.push({ p: c.p, item })));
    if (!units.length) {
      emptyView('隨機練習', '沒有題目', { label: '回題庫刷題', href: HOME });
      return;
    }
    runQuiz(root, units, config, null);
  }

  function lessonQuiz(el, units, opts) {   // 課程頁的入口 DRILL.startQuiz(說明在檔頭)
    const o = LESSON_ENTRY.check('DRILL.startQuiz', el, opts, true), list = LESSON_ENTRY.units('DRILL.startQuiz', units, ['5', '6', '7'], ['5']);
    if (uiReady()) runQuiz(el, list, list.map(u => ({ p: u.p })), o);
  }

  /* 作答一輪:root 是畫在哪裡;lesson 是課程頁給的 opts(刷題頁是 null)。即時回饋時小題對過答案就有 ok(交卷式作答中不會有) */
  function runQuiz(root, units, config, lesson) {
    const instant = !!lesson && lesson.feedback === 'instant', graded = rec => !!rec && rec.ok !== undefined;
    const qsOf = u => (u.p === '5' ? [u.item] : u.item.questions), keyOf = (u, q, qi) => (u.p === '5' ? q.id : qid(u.item, q, qi));
    const recOf = (i, key) => (units[i].p === '5' ? session.answers[i] : (session.answers[i] || {})[key]);
    /* 交卷式:作答期間只記選擇不對答,交卷後一次看成績卡與逐題檢討 */
    const session = { answers: {} };   // p5 單元:{c};p6/7 單元:{qKey:{c}};交卷後補 ok
    let cur = 0;
    let handing = false;   // 交卷的確認視窗開著:這時再按交卷不算
    const f = UI.focus.enter(instant ? { total: units.length, onExit: lesson.onExit, confirmExit: false }
      : { total: units.length, onExit: lesson ? lesson.onExit : () => { location.href = HOME; }, body: '還沒交卷的作答不會計分' });
    draw();
    f.focusMain();

    function unitAnswered(i) {
      const u = units[i];
      if (u.p === '5') return !!session.answers[i];
      const sess = session.answers[i] || {};
      return u.item.questions.every((q, qi) => sess[qid(u.item, q, qi)]);
    }

    /* 換題:焦點到新題的題幹(按鈕整段重畫,不然焦點掉回頁面) */
    function go(i) { cur = i; draw(); window.scrollTo(0, 0); f.focusMain(); }

    /* 選了答案:重畫但捲動位置留著,焦點回到剛選的那顆,讀屏念「已選 B」 */
    function picked(oi) {
      if (instant) { gradeNow(); return; }
      f.dirty(true);
      const y = window.scrollY;
      f.keep(draw);
      window.scrollTo(0, y);
      f.say('已選 ' + LETTERS[oi]);
    }

    function draw() {
      root.replaceChildren();
      f.progress(cur + 1);
      const isLast = cur === units.length - 1;
      f.foot([
        cur > 0 ? textBtn('上一題', () => go(cur - 1)) : null,
        mainBtn(isLast ? '交卷' : '下一題', e => { if (isLast) submit(e.currentTarget); else go(cur + 1); }, isLast),
      ]);
      setSubmit(f, isLast ? null : e => submit(e.currentTarget));
      if (units[cur].p === '5') drawP5();
      else drawSet();
      if (instant) footNow(isLast);
    }

    /* 即時回饋:剛選的小題對答案、存紀錄,重畫成解析的樣子;底部單題答了是回饋條,題組全部答了才能按下一題,最後一題是「完成」 */
    function gradeNow() {
      const u = units[cur];
      qsOf(u).forEach((q, qi) => { const key = keyOf(u, q, qi), rec = recOf(cur, key); if (rec && !graded(rec)) { rec.ok = rec.c === q.answer; saveRec(u.p, key, rec.c, rec.ok); } });
      draw();
    }
    function footNow(isLast) {
      const u = units[cur], rec = session.answers[cur], next = () => { if (isLast) finish(); else go(cur + 1); };
      setSubmit(f, null);
      if (u.p === '5' && graded(rec)) f.feedback({ ok: rec.ok, answer: rec.ok ? null : LETTERS[u.item.answer] + '. ' + u.item.options[u.item.answer], next: isLast ? '完成' : '下一題', onNext: next });
      else f.foot([mainBtn(isLast ? '完成' : '下一題', next, false, !qsOf(u).every((q, qi) => graded(recOf(cur, keyOf(u, q, qi)))))]);
    }

    function drawP5() {
      const q = units[cur].item;
      const rec = session.answers[cur];
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'display:flex;gap:8px;margin-bottom:10px' },
          h('span', { class: 'badge cat' }, 'Part 5'),
          h('span', { class: 'badge cat' }, catLabel(q.category)),
          h('span', { class: 'badge ' + (q.difficulty === '基礎' ? 'level-basic' : q.difficulty === '進階' ? 'level-adv' : 'level-mid') }, q.difficulty)),
        h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, (cur + 1) + '.'), q.question),
        graded(rec) ? optionButtons(q, rec, () => {}) : pickButtons(q, rec, oi => { session.answers[cur] = { c: oi }; picked(oi); }),
        graded(rec) ? withoutVerdict(explainBox(q, rec, q.translation, { m: 'p5', id: q.id })) : null));
    }

    function drawSet() {
      const p = units[cur].p;
      const set = units[cur].item;
      const sess = session.answers[cur] = session.answers[cur] || {};
      const layout = h('div', { class: 'set-layout' });

      const passCol = h('div', { class: 'passage-sticky-wrap', role: 'region', 'aria-label': '文章' });   // 可以捲動的文章區會成為 Tab 停點:給它名字
      if (p === '6') passCol.append(part6Passage(set, sess, false));
      else set.passages.forEach(ps => passCol.append(part7Passage(ps)));
      layout.append(h('div', null, passCol));

      const qCol = h('div', null);
      qCol.append(h('div', { style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, DATA[p].title)));
      set.questions.forEach((q, qi) => {
        const id = qid(set, q, qi);
        const label = p === '6' ? '(' + q.num + ')' : 'Q' + (qi + 1);
        const text = p === '6' ? '' : q.q;   // 段落填空:空格編號標在選項上方,不另寫題幹
        qCol.append(h('div', { class: 'q-block' },
          h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, label), text),
          graded(sess[id]) ? optionButtons(q, sess[id], () => {}) : pickButtons(q, sess[id], oi => { sess[id] = { c: oi }; picked(oi); }),
          graded(sess[id]) ? explainBox(q, sess[id], null, { m: 'p' + p, id }) : null));
      });
      layout.append(qCol);
      root.append(layout);
    }

    /* 單元名稱:只有 Part 5 是「題」,題組是「組」,混在一起就叫單元 */
    function unitWord(list) {
      return list.every(u => u.p === '5') ? '題' : list.every(u => u.p !== '5') ? '組' : '個單元';
    }

    function submit(opener, asked) {
      /* 確認視窗開著的時候交卷鈕還按得到:不再問第二次,批改、小雞的 PET_HOOK.done 也只跑一次 */
      if (handing) return;
      const missingUnits = units.filter((u, i) => !unitAnswered(i));
      if (missingUnits.length && !asked) {
        handing = true;
        UI.confirm({ title: '還有 ' + missingUnits.length + ' ' + unitWord(missingUnits) + '沒答完', body: '未作答的算錯', ok: '交卷', cancel: '繼續作答' })
          .then(yes => { handing = false; if (yes) submit(opener, true); });
        return;
      }
      /* data-gate 只在按下去那一刻查。確認視窗開著的時候別的分頁登出、或這台的帳號資料夾變成還沒灌過:問完再查一次,
         擋下就開「重新整理」卡,不批改、不出成績,作答留在這一頁(登回原帳號再按一次就能交) */
      if (typeof holdForAccount === 'function' && holdForAccount(opener)) return;
      /* 統一批改+寫入紀錄(只記有作答的) */
      units.forEach((u, i) => {
        if (u.p === '5') {
          const rec = session.answers[i];
          if (rec) {
            rec.ok = rec.c === u.item.answer;
            saveRec('5', u.item.id, rec.c, rec.ok);
          } else session.answers[i] = { c: -1, ok: false };
        } else {
          const sess = session.answers[i] = session.answers[i] || {};
          u.item.questions.forEach((q, qi) => {
            const id = qid(u.item, q, qi);
            const rec = sess[id];
            if (rec) {
              rec.ok = rec.c === q.answer;
              saveRec(u.p, id, rec.c, rec.ok);
            } else sess[id] = { c: -1, ok: false };
          });
        }
      });
      if (lesson) { finish(); return; }
      review();
    }

    /* 課程頁:紀錄都存好了,離開專心模式、把這一輪的結果交給 onDone(不畫成績卡、不給點心) */
    function finish() {
      f.leave();
      lesson.onDone(LESSON_ENTRY.bankResult('p', units, ['5'], (i, key) => (recOf(i, key) || {}).c));
    }

    function review() {
      f.leave();
      let qTotal = 0, qCorrect = 0;
      const wrongParts = new Set();
      units.forEach((u, i) => {
        if (u.p === '5') {
          qTotal++;
          if (session.answers[i].ok) qCorrect++; else wrongParts.add(u.p);
        } else {
          u.item.questions.forEach((q, qi) => { qTotal++; if (session.answers[i][qid(u.item, q, qi)].ok) qCorrect++; else wrongParts.add(u.p); });
        }
      });
      const wrongN = qTotal - qCorrect;
      /* 只有一個 Part 有錯題就直接看那個 Part 的錯題本,多個 Part 去錯題本首頁 */
      const wbHref = wrongParts.size === 1 ? listUrl([...wrongParts][0]) : 'review.html';
      const parts = [...new Set(config.map(c => c.p))];
      const card = UI.result({
        kicker: parts.length === 1 ? DATA[parts[0]].title : 'Part ' + parts.join('、'),
        score: qCorrect, total: qTotal,
        stats: wrongN ? [['收進錯題本', wrongN + ' 題']] : null,
        primary: { label: '再做一次', onClick: () => { card.destroy(); startQuiz(config); }, attrs: GATE },
        links: [wrongN ? { label: '看錯題本', href: wbHref } : null, { label: '回題庫刷題', href: HOME }],
        earnId: 'p' + config[0].p,
      });
      showResult(card, UI.detail('逐題解析 ' + qTotal + ' 題', reviewBlocks(), { wrong: wrongN }));
    }

    /* 逐題檢討 */
    function reviewBlocks() {
      return units.map((u, i) => {
        if (u.p === '5') {
          const q = u.item;
          const rec = session.answers[i];
          return h('div', { class: 'q-block' },
            h('div', { class: 'meta', style: 'display:flex;gap:8px;margin-bottom:10px' },
              h('span', { class: 'badge cat' }, 'Part 5'),
              h('span', { class: 'badge cat' }, catLabel(q.category))),
            h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, (i + 1) + '.'), q.question),
            optionButtons(q, rec, () => {}),
            explainBox(q, rec, q.translation, { m: 'p5', id: q.id }));
        }
        const set = u.item;
        const sess = session.answers[i];
        const layout = h('div', { class: 'set-layout' });
        const passCol = h('div', { class: 'passage-col' });
        if (u.p === '6') passCol.append(part6Passage(set, sess, true));
        else set.passages.forEach(ps => passCol.append(part7Passage(ps)));
        const trWrap = h('div', { class: 'set-translation', style: 'display:none' },
          u.p === '6' ? set.translation : (set.translation || []).map((t, ti) =>
            h('div', null, set.passages[ti] && set.passages[ti].label ? h('b', null, '【' + set.passages[ti].label + '】\n') : null, t, ti < set.translation.length - 1 ? '\n\n' : '')));
        const trBtn = h('button', {
          class: 'btn', style: 'margin-top:12px',
          onclick: () => { trWrap.style.display = trWrap.style.display === 'none' ? '' : 'none'; },
        }, '顯示全文翻譯');
        passCol.append(trBtn, trWrap);
        layout.append(h('div', null, passCol));
        const qCol = h('div', null);
        qCol.append(h('div', { style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, DATA[u.p].title)));
        set.questions.forEach((q, qi) => {
          const id = qid(set, q, qi);
          const label = u.p === '6' ? '(' + q.num + ')' : 'Q' + (qi + 1);
          const text = u.p === '6' ? '' : q.q;
          qCol.append(h('div', { class: 'q-block' },
            h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, label), text),
            optionButtons(q, sess[id], () => {}),
            explainBox(q, sess[id], null, { m: 'p' + u.p, id })));
        });
        layout.append(qCol);
        return layout;
      });
    }
  }

  /* ================= 錯題本複習 =================
     g:只複習這一組(組名,js/wrongbook.js 的分組);不給就是整個 Part。一回有上限(WRONGBOOK.ROUND),最早錯的先出。
     題目含模擬考答錯的題(mock_wrong);作答照舊寫 drill_p*(saveRec),答對那筆比模擬考那筆新,自然移出。
     每題作答當下就存、就給回饋(底部回饋條),所以離開不用確認 */
  function startReview(p, g) {
    if (!uiReady()) return;   // 共用元件沒載到:說一聲、給重新整理,不在這裡丟錯
    const d = DATA[p];
    document.title = d.title + ' 錯題本 - 衝衝英文';
    const st = store.get(KEY(p), {});
    let units;                    // p5: 題;p6/7: {set, wrongKeys}
    let rest = 0;                 // 這一組還沒輪到幾題
    if (!WB && g) {               // 分組要 js/wrongbook.js;沒載到不要默默複習整個 Part
      emptyView(d.title + ' 錯題本', '錯題本沒有載入完成', { label: '重新整理', onClick: () => location.reload() }, 'wrongbook');
      return;
    }
    if (WB) {
      const r = WB.round(p, g || null);
      units = r.units; rest = r.rest;
    } else if (p === '5') {
      units = DATA['5'].items.filter(q => st[q.id] && !st[q.id].ok);
    } else {
      units = [];
      DATA[p].items.forEach(set => {
        const wrongKeys = set.questions.map((q, qi) => qid(set, q, qi)).filter(k => st[k] && !st[k].ok);
        if (wrongKeys.length) units.push({ set, wrongKeys });
      });
    }
    if (!units.length) {
      emptyView(d.title + ' 錯題本', '沒有錯題', { label: '回錯題本', href: listUrl(p) }, 'wrongbook');
      return;
    }
    const asked = p === '5' ? units.length : units.reduce((s, u) => s + u.wrongKeys.length, 0);
    const session = {};           // 單元 idx → {qKey:{c,ok}} (p5 用 {c,ok})
    let cur = 0, cleared = 0;
    const f = UI.focus.enter({ total: units.length, onExit: () => { location.href = listUrl(p); }, confirmExit: false });
    draw();

    function draw() {
      root.replaceChildren();
      f.progress(cur + 1);
      if (p === '5') drawP5(); else drawSet();
    }

    function next() {
      if (cur === units.length - 1) summary(); else { cur++; draw(); window.scrollTo(0, 0); }
    }

    function drawP5() {
      const q = units[cur];
      const rec = session[cur];
      const isLast = cur === units.length - 1;
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'display:flex;gap:8px;margin-bottom:10px' },
          h('span', { class: 'badge cat' }, catLabel(q.category)),
          h('span', { class: 'badge level-mid' }, q.difficulty)),
        h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, (cur + 1) + '.'), q.question),
        optionButtons(q, rec, oi => {
          const ok = oi === q.answer;
          session[cur] = { c: oi, ok };
          if (ok) cleared++;
          saveRec(p, q.id, oi, ok);
          draw();
        }),
        withoutVerdict(explainBox(q, rec, rec ? q.translation : null, { m: 'p' + p, id: q.id }))));
      /* 單題:答對時「已移出錯題本」寫在回饋條的小字(題組題一次好幾題,仍寫在各題下面) */
      if (rec) f.feedback({ ok: rec.ok, answer: rec.ok ? null : LETTERS[q.answer] + '. ' + q.options[q.answer], note: rec.ok ? '已移出錯題本' : null, next: isLast ? '看成績' : '下一題', onNext: next });
      else f.foot([mainBtn(isLast ? '看成績' : '下一題', null, false, true)]);
    }

    function drawSet() {
      const { set, wrongKeys } = units[cur];
      const sess = session[cur] = session[cur] || {};
      const layout = h('div', { class: 'set-layout' });
      const passCol = h('div', { class: 'passage-sticky-wrap', role: 'region', 'aria-label': '文章' });   // 可以捲動的文章區會成為 Tab 停點:給它名字
      if (p === '6') passCol.append(part6Passage(set, wholeRecord(set)));
      else set.passages.forEach(ps => passCol.append(part7Passage(ps)));
      layout.append(h('div', null, passCol));

      const qCol = h('div', null);
      set.questions.forEach((q, qi) => {
        const id = qid(set, q, qi);
        if (!wrongKeys.includes(id)) return;      // 只重考錯的
        const rec = sess[id];
        const label = p === '6' ? '(' + q.num + ')' : 'Q' + (qi + 1);
        const text = p === '6' ? '' : q.q;
        qCol.append(h('div', { class: 'q-block' },
          h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, label), text),
          optionButtons(q, rec, oi => {
            const ok = oi === q.answer;
            sess[id] = { c: oi, ok };
            if (ok) cleared++;
            saveRec(p, id, oi, ok);
            draw();
          }),
          explainBox(q, rec, null, { m: 'p' + p, id }),
          rec && rec.ok ? h('div', { class: 'result-note', style: 'margin-top:8px;color:var(--ok)' }, '已移出錯題本') : null));
      });
      layout.append(qCol);
      root.append(layout);
      const all = wrongKeys.every(k => sess[k]);
      f.foot([mainBtn(cur === units.length - 1 ? '看成績' : '下一題', next, false, !all)]);
    }

    /* 錯題複習時,文章空格顯示所有已作答紀錄(含之前答對的) */
    function wholeRecord(set) {
      const rec = {};
      const stNow = store.get(KEY(p), {});
      set.questions.forEach((q, qi) => { const k = qid(set, q, qi); if (stNow[k]) rec[k] = stNow[k]; });
      return rec;
    }

    function summary() {
      f.leave();
      const again = 'practice.html?mode=review&part=' + p + (g ? '&g=' + encodeURIComponent(g) : '');
      const card = UI.result({
        kicker: d.title + ' 錯題本 · 移出',
        big: String(cleared), unit: '題', ratio: asked ? cleared / asked : 1,
        stats: rest > 0 ? [['還沒複習', rest + ' 題']] : null,
        primary: rest > 0 ? { label: '下一回', href: again, attrs: GATE } : { label: '回錯題本', href: listUrl(p), attrs: GATE },
        links: rest > 0 ? [{ label: '回錯題本', href: listUrl(p) }] : [],
        earnId: 'pr',
      });
      showResult(card);
    }
  }

  /* ================= 文章渲染 ================= */
  function part6Passage(set, sess, graded) {
    if (graded === undefined) graded = true;
    const box = h('div', { class: 'passage-box' },
      h('span', { class: 'p-label' }, passTypeLabel(set.passageType)));
    const frag = document.createDocumentFragment();
    String(set.passage).split(/(\{\{\d\}\})/).forEach(seg => {
      const m = seg.match(/^\{\{(\d)\}\}$/);
      if (!m) { if (seg) frag.append(document.createTextNode(seg)); return; }
      const num = Number(m[1]);
      const q = set.questions.find(x => x.num === num);
      const rec = q ? sess[qid(set, q, 0)] : null;
      if (rec && graded) {
        frag.append(h('span', { class: 'gap-mark answered', title: rec.ok ? '' : '答錯 · 顯示正解' }, q.options[q.answer]));
      } else if (rec && rec.c !== undefined && rec.c > -1) {
        /* 作答中:顯示自己選的,不透露對錯 */
        frag.append(h('span', { class: 'gap-mark filled' }, q.options[rec.c]));
      } else {
        frag.append(h('span', { class: 'gap-mark' }, '(' + num + ') ______'));
      }
    });
    box.append(h('div', null, frag));
    return box;
  }

  function part7Passage(ps) {
    const typeSlug = String(ps.type || '').toLowerCase().replace(/[^a-z]+/g, '-');
    const box = h('div', { class: 'passage-box' + (ps.blocks ? ' ps-' + typeSlug : '') },
      ps.label ? h('span', { class: 'p-label' }, ps.label + ' · ' + passTypeLabel(ps.type)) : h('span', { class: 'p-label' }, passTypeLabel(ps.type)));
    box.append(ps.blocks ? renderBlocks(ps.blocks) : h('div', null, ps.content));
    return box;
  }

  /* 結構化文件區塊(表格/表單/簡訊/傳單) */
  function renderBlocks(blocks) {
    const wrap = h('div', { class: 'ps-blocks' });
    blocks.forEach(b => {
      if (b.t === 'h') wrap.append(h('div', { class: 'ps-h' }, b.text));
      else if (b.t === 'sub') wrap.append(h('div', { class: 'ps-sub' }, b.text));
      else if (b.t === 'p') wrap.append(h('div', { class: 'ps-p' }, b.text));
      else if (b.t === 'note') wrap.append(h('div', { class: 'ps-note' }, b.text));
      else if (b.t === 'coupon') wrap.append(h('div', { class: 'ps-coupon' }, ...(b.lines || [b.text]).map((l, i) => h('div', i ? { class: 'ps-coupon-line' } : { class: 'ps-coupon-main' }, l))));
      else if (b.t === 'list') {
        const numbered = (b.items || []).every(it => /^\d+[.)]\s/.test(it));
        wrap.append(h('ul', { class: 'ps-list' + (numbered ? ' numbered' : '') }, ...(b.items || []).map(it => h('li', null, it))));
      }
      else if (b.t === 'kv') {
        wrap.append(h('div', { class: 'ps-kv' }, ...(b.items || []).map(it =>
          h('div', { class: 'ps-kv-row' }, h('span', { class: 'ps-kv-k' }, it[0]), h('span', { class: 'ps-kv-v' }, it[1])))));
      } else if (b.t === 'table') {
        const tbl = h('table', { class: 'ps-table' });
        (b.rows || []).forEach((row, ri) => {
          tbl.append(h('tr', null, ...row.map(c => h(b.header !== false && ri === 0 ? 'th' : 'td', null, String(c)))));
        });
        wrap.append(h('div', { class: 'ps-table-wrap' }, tbl));
      } else if (b.t === 'chat') {
        const sides = {};
        wrap.append(h('div', { class: 'ps-chat' }, ...(b.msgs || []).map(m => {
          if (!(m.who in sides)) sides[m.who] = Object.keys(sides).length % 2 ? 'right' : '';
          return h('div', { class: 'ps-msg ' + sides[m.who] },
            h('div', { class: 'ps-msg-meta' }, m.who + (m.time ? ' · ' + m.time : '')),
            h('div', { class: 'ps-msg-bubble' }, m.text));
        })));
      }
    });
    return wrap;
  }
})();
