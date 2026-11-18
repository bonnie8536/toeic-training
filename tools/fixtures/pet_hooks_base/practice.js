/* 刷題模組(隨機練習版):
   - 隨機練習:選題型+題數(P5 選考點亦可),隨機抽題(優先抽沒做過的,其次答錯的),
     逐題即時解析,做完看本輪成績。不顯示全題庫的已刷/未刷清單。
   - 錯題本:歷來答錯的題目集中在這裡複習,重新答對就移出。
   - 作答紀錄仍存 drill_p5/p6/p7(雲端模式會同步),錯題本由紀錄即時推導。 */
(function () {
  const root = $('#practice-root');
  const DATA = {
    '5': { items: (window.TOEIC && TOEIC.part5) || [], title: 'Part 5 單句填空', unit: '題', sizes: [5, 10, 15, 20, 30, 50] },
    '6': { items: (window.TOEIC && TOEIC.part6) || [], title: 'Part 6 段落填空', unit: '組', sizes: [1, 2, 3, 4, 5, 8] },
    '7': { items: (window.TOEIC && TOEIC.part7) || [], title: 'Part 7 閱讀理解', unit: '組', sizes: [1, 2, 3, 4, 5, 8] },
  };
  const KEY = p => 'drill_p' + p;

  if (!DATA['5'].items.length) {
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' }, '題庫尚未載入（請執行 tools/merge_data.py）。'));
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
     錯題本(錯題本定稿 2026-11-18):?mode=wrong&part=N 是那個 Part 的錯題本清單(js/wrongbook-ui.js);
     ?mode=review&part=N(&g=組名)複習整個 Part 或只複習一組,一回有上限。聽力的 part(1–4)只有 window.LISTEN 在才走 */
  const mode = getParam('mode');
  const partParam = getParam('part');
  const listenPart = p => !!window.LISTEN && ['1', '2', '3', '4'].indexOf(p) > -1;
  const WB = window.WRONGBOOK || null;
  if (mode === 'wrong' && (DATA[partParam] || listenPart(partParam))) renderWrong(partParam);
  else if (mode === 'review' && DATA[partParam]) startReview(partParam, getParam('g'));
  else if (mode === 'review' && listenPart(partParam)) { LISTEN.startReview(root, partParam, getParam('g')); }
  else if (partParam && DATA[partParam]) {
    // 相容程度檢測報告的深連結:直接開一輪隨機練習
    startQuiz([{ p: partParam, n: partParam === '5' ? 10 : 2, cat: getParam('cat') || 'all' }]);
  } else renderHome();
  /* 開頁先跟雲端對齊模擬考錯題(js/wrongbook.js syncCloud;審查 2026-11-19 #1):別台考的錯題合併進本機,
     錯題本面板、錯題本清單由 js/wrongbook-ui.js keepFresh 收到 cloud:merged 重畫 */
  if (WB && typeof WB.syncCloud === 'function') WB.syncCloud();

  /* ================= 首頁 ================= */
  function renderHome() {
    document.title = '題庫刷題 - 衝衝英文';
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '題庫刷題')));

    /* 隨機練習:三個 Part 各一列(勾選+數量),可同時勾多個混合出題 */
    const cats = [...new Set(DATA['5'].items.map(q => q.category))];
    const initCat = getParam('cat');

    function sizeLabel(p, n) {
      if (p === '5') return n + ' 題';
      return n + ' 組（' + (p === '6' ? n * 4 + ' 題' : '約 ' + n * 4 + '-' + n * 5 + ' 題') + '）';
    }

    const rows = ['5', '6', '7'].map(p => {
      const cb = h('input', { type: 'checkbox' });
      if (p === '5') cb.checked = true;
      const sizeSel = h('select', { class: 'cfg-select' });
      DATA[p].sizes.forEach(n => sizeSel.append(h('option', { value: n }, sizeLabel(p, n))));
      sizeSel.append(h('option', { value: 'custom' }, '自訂…'));
      if (p === '5') sizeSel.value = '10';
      const customInput = h('input', { class: 'cfg-select', type: 'number', min: '1', style: 'width:84px;display:none', placeholder: '數量' });
      sizeSel.addEventListener('change', () => {
        cb.checked = true;
        customInput.style.display = sizeSel.value === 'custom' ? '' : 'none';
        if (sizeSel.value === 'custom') customInput.focus();
      });
      customInput.addEventListener('input', () => { cb.checked = true; });
      let catSel = null;
      if (p === '5') {
        catSel = h('select', { class: 'cfg-select' },
          h('option', { value: 'all' }, '全部考點'),
          cats.map(c => h('option', { value: c }, c)));
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

    const s5 = partStats('5'), s6 = partStats('6'), s7 = partStats('7');
    const totalAnswered = s5.answered + s6.answered + s7.answered;
    const totalCorrect = s5.correct + s6.correct + s7.correct;

    /* 錯題本面板的各列(data-part、wb-see:從 bfcache 回來重畫時,焦點放回同一列的「查看」)。「查看」的報讀名稱帶 Part,7 顆才分得出來 */
    function wbRows() {
      return ['5', '6', '7'].map(p => {
        const n = WB ? WB.count(p) : partStats(p).wrong;
        return h('div', { class: 'review-row', 'data-part': p },
          h('span', null, DATA[p].title),
          h('b', { style: n ? 'color:var(--bad)' : 'color:var(--ok)' }, n + ' 題'),
          !n ? h('span', { style: 'font-size:13px;color:var(--ink-light)' }, '沒有錯題')
            : WB ? h('a', { class: 'btn wb-see', href: 'practice.html?mode=wrong&part=' + p, 'aria-label': '查看 ' + WB.TITLE[p] + ' 錯題本' }, '查看')
              : h('button', { class: 'btn', 'data-gate': '', onclick: () => startReview(p) }, '複習'));
      }).concat(window.LISTEN ? ['1', '2', '3', '4'].map(p => {
        const n = WB ? WB.count(p) : LISTEN.partStats(p).wrong;
        return h('div', { class: 'review-row', 'data-part': p },
          h('span', null, '聽力 ' + LISTEN.PARTS[p].title),
          h('b', { style: n ? 'color:var(--bad)' : 'color:var(--ok)' }, n + ' 題'),
          !n ? h('span', { style: 'font-size:13px;color:var(--ink-light)' }, '沒有錯題')
            : WB ? h('a', { class: 'btn wb-see', href: 'practice.html?mode=wrong&part=' + p, 'aria-label': '查看 ' + WB.TITLE[p] + ' 錯題本' }, '查看')
              : h('button', { class: 'btn', 'data-gate': '', onclick: () => { root.innerHTML = ''; LISTEN.startReview(root, p); window.scrollTo(0, 0); } }, '複習'));
      }) : []);
    }
    const wbRowsBox = h('div', { class: 'review-rows' }, wbRows());

    root.append(h('div', { class: 'practice-panels' },
      h('div', { class: 'practice-panel' },
        h('h2', null, '隨機練習'),
        h('p', null, '共 ' + (s5.total + s6.total + s7.total) + ' 題' +
          (totalAnswered ? ' · 已作答 ' + totalAnswered + ' 題 · 正確率 ' + Math.round(totalCorrect / totalAnswered * 100) + '%' : '')),
        h('div', { class: 'cfg-rows' }, rows.map(r => r.row)),
        h('button', {
          class: 'btn primary', style: 'margin-top:14px', 'data-gate': '',
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
        }, '開始練習')),
      /* 錯題本面板:每個 Part 一列「N 題 + 查看」,查看連到那個 Part 的錯題本清單(一組一組,點開才看到題目)。
         題數含模擬考答錯的題(js/wrongbook.js);沒載到就照以前只算刷題紀錄,按鈕照舊直接複習 */
      h('div', { class: 'practice-panel', id: 'wrongbook' },
        h('h2', null, '錯題本'),
        wbRowsBox)));
    /* 從錯題本複習按上一頁回來(bfcache 原樣拿回來):題數變了就重畫這幾列(js/wrongbook-ui.js keepFresh) */
    if (WB && window.WRONGBOOK_UI) WRONGBOOK_UI.keepFresh(wbRowsBox, () => WRONGBOOK_UI.sig(WB.PARTS), () => wbRowsBox.replaceChildren(...wbRows()));
    /* practice.html#wrongbook(模擬考結果、每日複習連過來):面板是 JS 畫的,瀏覽器自己不會捲過去。
       頂欄是固定的(sticky),要扣掉它的高度(.me-sec 的 scroll-margin-top 同一個意思);桌機一列、手機兩列、更窄還會更高,照實際高度算 */
    if (location.hash === '#wrongbook') {
      const panel = document.getElementById('wrongbook');
      if (panel) setTimeout(() => {
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
        const sel = h('select', { class: 'cfg-select' },
          d.sizes.map(n => h('option', { value: n }, n + ' ' + d.unit)));
        if (p === '2') sel.value = '10';
        sel.addEventListener('change', () => { cb.checked = true; });
        const s = LISTEN.partStats(p);
        const row = h('div', { class: 'cfg-part-row' },
          h('label', { class: 'cfg-part-check' }, cb, h('span', null, d.title)),
          sel,
          h('span', { style: 'font-size:12.5px;color:var(--ink-light)' },
            '已作答 ' + s.answered + '/' + s.total + (s.answered ? ' · ' + Math.round(s.correct / s.answered * 100) + '%' : '')));
        return { p, cb, sel, row };
      });
      root.append(h('div', { class: 'practice-panel', style: 'margin-bottom:50px' },
        h('h2', null, '聽力隨機練習'),
        h('p', null, '每題最多播 2 次。'),
        h('div', { class: 'cfg-rows' }, lrows.map(r => r.row)),
        h('button', {
          class: 'btn primary', style: 'margin-top:14px', 'data-gate': '',
          onclick: () => {
            const config = lrows.filter(r => r.cb.checked).map(r => ({ p: r.p, n: Number(r.sel.value) }));
            if (!config.length) return;
            root.innerHTML = '';
            LISTEN.startQuiz(root, config);
            window.scrollTo(0, 0);
          },
        }, '開始聽力練習')));
    }
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

  function explainBox(q, rec, extraTr) {
    if (!rec) return null;
    const box = h('div', { class: 'explain' },
      h('div', { class: 'verdict ' + (rec.ok ? 'ok' : 'bad') },
        rec.ok ? '答對了' : (rec.c === -1 ? '未作答，正確答案是 ' : '答錯了，正確答案是 ') + LETTERS[q.answer]),
      h('div', null, q.explanation));
    if (extraTr) box.append(h('div', { class: 'tr' }, extraTr));
    const gl = q.category && GRAMMAR_LINK[q.category];
    if (gl && !rec.ok) {
      box.append(h('div', { class: 'tr' },
        h('a', { href: 'grammar.html?u=' + gl[0] }, '文法基礎「' + gl[1] + '」→')));
    }
    return box;
  }

  /* 作答期間的選項(交卷式:只選不對答,可改選) */
  function pickButtons(q, rec, onPick) {
    const opts = h('div', { class: 'opts' });
    q.options.forEach((opt, oi) => {
      opts.append(h('button', {
        class: 'opt' + (rec && rec.c === oi ? ' picked' : ''), 'data-gate': '',   // 選答案:?part= 深連結一打開就是題目,選的時候才請他登入
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

  /* back:錯題本複習時給 Part,右邊的連結變成「← 回錯題本」(那個 Part 的錯題本清單) */
  function topBar(title, sub, back) {
    return h('div', { class: 'drill-top' },
      h('h1', null, title, ' ', h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' }, sub || '')),
      back ? h('a', { href: 'practice.html?mode=wrong&part=' + back, style: 'font-size:13.5px;margin-left:auto' }, '← 回錯題本')
        : h('a', { href: 'practice.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回題庫'));
  }

  /* ================= 錯題本清單(?mode=wrong&part=N) ================= */
  function renderWrong(p) {
    if (window.WRONGBOOK_UI) { WRONGBOOK_UI.renderList(root, p); return; }
    document.title = '錯題本 - 衝衝英文';
    root.append(topBar('錯題本'), h('div', { class: 'q-block' }, '錯題本沒有載入完成，請重新整理。'));
  }

  function sessionDots(list, cur, results, onJump, answered) {
    const nav = h('div', { class: 'q-nav' });
    list.forEach((x, i) => {
      let cls = i === cur ? 'cur' : '';
      if (results[i] === true) cls += ' ok';
      if (results[i] === false) cls += ' ng';
      if (answered && answered(i) && results[i] === undefined) cls += ' ans';
      nav.append(h('button', {
        class: cls.trim(),
        disabled: onJump ? null : '',
        onclick: onJump ? () => onJump(i) : null,
      }, String(i + 1)));
    });
    return nav;
  }

  /* ================= 隨機練習(config=[{p,n,cat}],可混合多個 Part) ================= */
  function startQuiz(config) {
    document.title = '隨機練習 - 衝衝英文';
    const units = [];   // {p, item}:p5 的 item=題目,p6/7 的 item=題組
    config.forEach(c => pickPool(c.p, c.n, c.cat).forEach(item => units.push({ p: c.p, item })));
    if (!units.length) {
      root.innerHTML = '';
      root.append(topBar('隨機練習'), h('div', { class: 'q-block' }, '這個範圍沒有題目。'),
        h('div', { class: 'drill-nav-btns' }, h('a', { class: 'btn', href: 'practice.html' }, '回題庫')));
      return;
    }
    const sub = config.map(c =>
      'Part ' + c.p + ' × ' + c.n + ' ' + DATA[c.p].unit + (c.cat && c.cat !== 'all' ? '（' + c.cat + '）' : '')).join(' · ');
    /* 交卷式:作答期間只記選擇不對答,交卷後一次看成績+逐題檢討(她指定的流程) */
    const session = { answers: {} };   // p5 單元:{c};p6/7 單元:{qKey:{c}};交卷後補 ok
    const okFlags = [];
    let cur = 0;
    let handing = false;   // 交卷的確認視窗按了確定、正在等那 50 毫秒(見 submit):這時再按交卷不算
    draw();

    function unitAnswered(i) {
      const u = units[i];
      if (u.p === '5') return !!session.answers[i];
      const sess = session.answers[i] || {};
      return u.item.questions.every((q, qi) => sess[qid(u.item, q, qi)]);
    }

    function draw() {
      root.innerHTML = '';
      root.append(topBar('隨機練習', sub));
      root.append(sessionDots(units, cur, okFlags, i => { cur = i; draw(); window.scrollTo(0, 0); }, unitAnswered));
      if (units[cur].p === '5') drawP5();
      else drawSet();
    }

    function navRow() {
      const isLast = cur === units.length - 1;
      return h('div', { class: 'drill-nav-btns' },
        h('button', {
          class: 'btn primary', 'data-gate': isLast ? '' : null,   // 「下一題」照常;最後一題的交卷要登入
          onclick: e => { if (isLast) submit(e.currentTarget); else { cur++; draw(); window.scrollTo(0, 0); } },
        }, isLast ? '交卷對答案' : '下一' + DATA[units[cur + 1].p].unit + ' →'),
        isLast ? null : h('button', { class: 'btn', 'data-gate': '', onclick: e => submit(e.currentTarget) }, '直接交卷'));
    }

    function drawP5() {
      const q = units[cur].item;
      const rec = session.answers[cur];
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'display:flex;gap:8px;margin-bottom:10px' },
          h('span', { class: 'badge cat' }, 'Part 5'),
          h('span', { class: 'badge cat' }, q.category),
          h('span', { class: 'badge ' + (q.difficulty === '基礎' ? 'level-basic' : q.difficulty === '進階' ? 'level-adv' : 'level-mid') }, q.difficulty)),
        h('div', { class: 'q-text', style: 'font-size:17px' }, h('span', { class: 'q-no' }, (cur + 1) + '.'), q.question),
        pickButtons(q, rec, oi => { session.answers[cur] = { c: oi }; draw(); })));
      root.append(navRow());
    }

    function drawSet() {
      const p = units[cur].p;
      const set = units[cur].item;
      const sess = session.answers[cur] = session.answers[cur] || {};
      const layout = h('div', { class: 'set-layout' });

      const passCol = h('div', { class: 'passage-sticky-wrap' });
      if (p === '6') passCol.append(part6Passage(set, sess, false));
      else set.passages.forEach(ps => passCol.append(part7Passage(ps)));
      passCol.append(h('button', { class: 'btn', style: 'margin-top:12px', disabled: '' }, '交卷後可看全文翻譯'));
      layout.append(h('div', null, passCol));

      const qCol = h('div', null);
      qCol.append(h('div', { style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, DATA[p].title)));
      set.questions.forEach((q, qi) => {
        const id = qid(set, q, qi);
        const label = p === '6' ? '(' + q.num + ')' : 'Q' + (qi + 1);
        const text = p === '6' ? '選出最適合填入空格 (' + q.num + ') 的答案' : q.q;
        qCol.append(h('div', { class: 'q-block' },
          h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, label), text),
          pickButtons(q, sess[id], oi => { sess[id] = { c: oi }; draw(); })));
      });
      layout.append(qCol);
      root.append(layout);
      root.append(navRow());
    }

    function submit(opener, asked) {
      /* 等那 50 毫秒的時候交卷鈕還按得到:以前再按一次又問、又排一次,批改、小雞的 PET_HOOK.done 都跑兩次,第二次還把沒答的(c: -1)寫進紀錄與錯題本 */
      if (handing && !asked) return;
      const missing = units.filter((u, i) => !unitAnswered(i)).length;
      if (missing && !asked) {
        if (!confirm('還有 ' + missing + ' 個單元沒答完，確定要交卷嗎？未作答的算錯。')) return;
        /* 原生確認視窗開著的時候,別的分頁對 localStorage 的改動(登出、換帳號、記上「還沒灌過」)Chrome 不會送進這一頁,
           按確定之後要再過兩個工作(實測約 2 毫秒)才看得到,在那之前讀到的還是舊值,下面的查核都會放行:等 50 毫秒再往下(審查 D 第 4 輪 #3) */
        handing = true;
        setTimeout(() => { handing = false; submit(opener, true); }, 50);   // 往下才放開:holdForAccount 擋下跳卡時,之後還能再按交卷
        return;
      }
      /* data-gate 只在按下去那一刻查。確認視窗開著的時候別的分頁登出、或這台的帳號資料夾變成還沒灌過:問完再查一次,
         擋下就開「重新整理」卡,不批改、不出成績,作答留在這一頁(登回原帳號再按一次就能交)。
         以前照樣批改,store.set 靜靜不寫,畫面卻寫「答錯的 N 題已收進錯題本。」(審查 D 第 3 輪 #3) */
      if (typeof holdForAccount === 'function' && holdForAccount(opener)) return;
      /* 統一批改+寫入紀錄(只記有作答的) */
      units.forEach((u, i) => {
        if (u.p === '5') {
          const rec = session.answers[i];
          if (rec) {
            rec.ok = rec.c === u.item.answer;
            saveRec('5', u.item.id, rec.c, rec.ok);
          } else session.answers[i] = { c: -1, ok: false };
          okFlags[i] = session.answers[i].ok;
        } else {
          const sess = session.answers[i] = session.answers[i] || {};
          let allOk = true;
          u.item.questions.forEach((q, qi) => {
            const id = qid(u.item, q, qi);
            const rec = sess[id];
            if (rec) {
              rec.ok = rec.c === q.answer;
              saveRec(u.p, id, rec.c, rec.ok);
            } else sess[id] = { c: -1, ok: false };
            if (!sess[id].ok) allOk = false;
          });
          okFlags[i] = allOk;
        }
      });
      review();
    }

    function review() {
      root.innerHTML = '';
      root.append(topBar('隨機練習', sub));
      let qTotal = 0, qCorrect = 0;
      units.forEach((u, i) => {
        if (u.p === '5') {
          qTotal++;
          if (session.answers[i].ok) qCorrect++;
        } else {
          u.item.questions.forEach((q, qi) => { qTotal++; if (session.answers[i][qid(u.item, q, qi)].ok) qCorrect++; });
        }
      });
      const wrongN = qTotal - qCorrect;
      const btns = () => h('div', { class: 'drill-nav-btns' },
        h('button', { class: 'btn primary', 'data-gate': '', onclick: () => startQuiz(config) }, '再練一輪'),
        wrongN && config.length === 1 ? h('button', { class: 'btn', 'data-gate': '', onclick: () => startReview(config[0].p) }, '複習錯題') : null,
        h('a', { class: 'btn', href: 'practice.html' }, '回題庫'));
      root.append(h('div', { class: 'report-head', style: 'margin-top:20px' },
        h('h2', null, '答對 ' + qCorrect + ' / ' + qTotal + ' 題'),
        wrongN ? h('div', { class: 'band-note' }, '答錯的 ' + wrongN + ' 題已收進錯題本。') : null));
      root.append(btns());

      /* 逐題檢討 */
      units.forEach((u, i) => {
        if (u.p === '5') {
          const q = u.item;
          const rec = session.answers[i];
          root.append(h('div', { class: 'q-block', style: 'margin-top:18px' },
            h('div', { class: 'meta', style: 'display:flex;gap:8px;margin-bottom:10px' },
              h('span', { class: 'badge cat' }, 'Part 5'),
              h('span', { class: 'badge cat' }, q.category)),
            h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, (i + 1) + '.'), q.question),
            optionButtons(q, rec, () => {}),
            explainBox(q, rec, q.translation)));
        } else {
          const set = u.item;
          const sess = session.answers[i];
          const layout = h('div', { class: 'set-layout', style: 'margin-top:18px' });
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
            const text = u.p === '6' ? '空格 (' + q.num + ')' : q.q;
            qCol.append(h('div', { class: 'q-block' },
              h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, label), text),
              optionButtons(q, sess[id], () => {}),
              explainBox(q, sess[id])));
          });
          layout.append(qCol);
          root.append(layout);
        }
      });
      root.append(btns());
      window.scrollTo(0, 0);
    }
  }

  /* ================= 錯題本 =================
     g:只複習這一組(組名,js/wrongbook.js 的分組);不給就是整個 Part。一回有上限(WRONGBOOK.ROUND),最早錯的先出。
     題目含模擬考答錯的題(mock_wrong);作答照舊寫 drill_p*(saveRec),答對那筆比模擬考那筆新,自然移出 */
  function startReview(p, g) {
    const d = DATA[p];
    document.title = d.title + ' 錯題本 - 衝衝英文';
    const st = store.get(KEY(p), {});
    let units;                    // p5: 題;p6/7: {set, wrongKeys}
    let rest = 0, n = 0;          // 這一組還沒輪到幾題、這一回幾題
    if (!WB && g) {               // 分組要 js/wrongbook.js;沒載到不要默默複習整個 Part
      root.append(topBar(d.title + ' 錯題本', g, p), h('div', { class: 'q-block' }, '錯題本沒有載入完成，請重新整理。'));
      return;
    }
    if (WB) {
      const r = WB.round(p, g || null);
      units = r.units; rest = r.rest; n = r.n;
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
      root.innerHTML = '';
      root.append(topBar(d.title + ' 錯題本', g || '', p), h('div', { class: 'q-block' }, g ? '這一組已經沒有錯題。' : '目前沒有錯題。'),
        h('div', { class: 'drill-nav-btns' }, h('a', { class: 'btn', href: 'practice.html?mode=wrong&part=' + p }, '回錯題本')));
      return;
    }
    const sub = WB
      ? (g ? g + ' · ' : '') + '這一回 ' + (p === '5' ? n + ' 題' : units.length + ' 組（' + n + ' 題）') + '，答對就移出'
      : '共 ' + units.length + ' ' + d.unit + '，答對就移出';
    const session = {};           // 單元 idx → {qKey:{c,ok}} (p5 用 {c,ok})
    const okFlags = [];
    let cur = 0, cleared = 0;
    draw();

    function draw() {
      root.innerHTML = '';
      root.append(topBar(d.title + ' 錯題本', sub, p));
      root.append(sessionDots(units, cur, okFlags));
      if (p === '5') drawP5(); else drawSet();
    }

    function nextRow(canNext, isLast) {
      return h('div', { class: 'drill-nav-btns' },
        canNext
          ? h('button', {
              class: 'btn primary',
              onclick: () => { if (isLast) summary(); else { cur++; draw(); window.scrollTo(0, 0); } },
            }, isLast ? '完成複習' : '下一' + d.unit + ' →')
          : h('span', { class: 'result-note', style: 'align-self:center' }, '重新作答後才能繼續'));
    }

    function drawP5() {
      const q = units[cur];
      const rec = session[cur];
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'display:flex;gap:8px;margin-bottom:10px' },
          h('span', { class: 'badge cat' }, q.category),
          h('span', { class: 'badge level-mid' }, q.difficulty)),
        h('div', { class: 'q-text', style: 'font-size:17px' }, h('span', { class: 'q-no' }, (cur + 1) + '.'), q.question),
        optionButtons(q, rec, oi => {
          const ok = oi === q.answer;
          session[cur] = { c: oi, ok };
          okFlags[cur] = ok;
          if (ok) cleared++;
          saveRec(p, q.id, oi, ok);
          draw();
        }),
        explainBox(q, rec, rec ? q.translation : null),
        rec && rec.ok ? h('div', { class: 'result-note', style: 'margin-top:8px;color:var(--ok)' }, '已答對，移出錯題本。') : null));
      root.append(nextRow(!!rec, cur === units.length - 1));
    }

    function drawSet() {
      const { set, wrongKeys } = units[cur];
      const sess = session[cur] = session[cur] || {};
      const layout = h('div', { class: 'set-layout' });
      const passCol = h('div', { class: 'passage-sticky-wrap' });
      if (p === '6') passCol.append(part6Passage(set, wholeRecord(set)));
      else set.passages.forEach(ps => passCol.append(part7Passage(ps)));
      layout.append(h('div', null, passCol));

      const qCol = h('div', null);
      set.questions.forEach((q, qi) => {
        const id = qid(set, q, qi);
        if (!wrongKeys.includes(id)) return;      // 只重考錯的
        const rec = sess[id];
        const label = p === '6' ? '(' + q.num + ')' : 'Q' + (qi + 1);
        const text = p === '6' ? '選出最適合填入空格 (' + q.num + ') 的答案' : q.q;
        qCol.append(h('div', { class: 'q-block' },
          h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, label), text),
          optionButtons(q, rec, oi => {
            const ok = oi === q.answer;
            sess[id] = { c: oi, ok };
            if (ok) cleared++;
            saveRec(p, id, oi, ok);
            const done = wrongKeys.every(k => sess[k]);
            if (done) okFlags[cur] = wrongKeys.every(k => sess[k].ok);
            draw();
          }),
          explainBox(q, rec),
          rec && rec.ok ? h('div', { class: 'result-note', style: 'margin-top:8px;color:var(--ok)' }, '已答對，移出錯題本。') : null));
      });
      layout.append(qCol);
      root.append(layout);
      root.append(nextRow(wrongKeys.every(k => sess[k]), cur === units.length - 1));
    }

    /* 錯題複習時,文章空格顯示所有已作答紀錄(含之前答對的) */
    function wholeRecord(set) {
      const rec = {};
      const stNow = store.get(KEY(p), {});
      set.questions.forEach((q, qi) => { const k = qid(set, q, qi); if (stNow[k]) rec[k] = stNow[k]; });
      return rec;
    }

    function summary() {
      root.innerHTML = '';
      root.append(topBar(d.title + ' 錯題本', '', p));
      const again = 'practice.html?mode=review&part=' + p + (g ? '&g=' + encodeURIComponent(g) : '');
      root.append(h('div', { class: 'report-head', style: 'margin-top:20px' },
        h('h2', null, '移出 ' + cleared + ' 題'),
        h('div', { class: 'band-note' }, '沒答對的留在錯題本，隔天再試。'),
        rest > 0 ? h('div', { class: 'band-note' }, (g ? '這一組' : '這個 Part') + '還有 ' + rest + ' 題還沒複習。') : null));
      root.append(h('div', { class: 'drill-nav-btns' },
        rest > 0 ? h('a', { class: 'btn primary', 'data-gate': '', href: again }, '下一回') : null,
        h('a', { class: rest > 0 ? 'btn' : 'btn primary', href: 'practice.html?mode=wrong&part=' + p }, '回錯題本')));
      window.scrollTo(0, 0);
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
        frag.append(h('span', { class: 'gap-mark answered', title: rec.ok ? '' : '（答錯，顯示正解）' }, q.options[q.answer]));
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
