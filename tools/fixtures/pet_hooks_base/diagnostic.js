/* 程度檢測:28 題鑑別卷。過程不對答案,交卷後產生「會了什麼/還不會什麼」報告。 */
(function () {
  const root = $('#diag-root');
  const D = (window.TOEIC && TOEIC.diagnostic) || null;

  if (!D || !D.p5 || !D.p6 || !D.p7) {
    root.append(h('div', { class: 'page-head' }, h('h1', null, '程度檢測')),
      UI.empty({ text: '檢測題庫準備中', action: { label: '重新整理', onClick: () => location.reload() } }));
    return;
  }

  /* 攤平 28 題:每題 {kind, category, difficulty, skill, options, answer, explanation, text, passage}。
     段落填空(p6)每格沒有題幹,空格編號標在選項上方 */
  const items = [];
  D.p5.forEach(q => items.push({
    kind: 'p5', category: q.category, difficulty: q.difficulty, skill: q.skill,
    text: q.question, options: q.options, answer: q.answer, explanation: q.explanation, translation: q.translation,
  }));
  D.p6.questions.forEach(q => items.push({
    kind: 'p6', category: q.category, difficulty: q.difficulty, skill: q.skill,
    text: '', num: q.num,
    options: q.options, answer: q.answer, explanation: q.explanation,
  }));
  D.p7.questions.forEach(q => items.push({
    kind: 'p7', category: q.category, difficulty: q.difficulty, skill: q.skill,
    text: q.q, options: q.options, answer: q.answer, explanation: q.explanation,
  }));

  const KEY = 'diag';
  const GATE = { 'data-gate': '' };   // 會寫紀錄的按鈕:沒登入時 js/profile.js 先攔下
  let st = store.get(KEY, null);   // {answers:{i:choice}, done, startedAt, finishedAt}
  let cur = 0;
  let focus = null;        // 專心模式(作答中)
  let handler = null;      // 作答列右邊「交卷」現在要做的事(每次畫面重畫時換成那一畫面的 handIn)
  let panel = null;        // 題號面板(UI.sheet,開著時才有)
  let asking = false;      // 「還有題沒作答」的確認視窗開著:這時再按交卷不算
  let resultCard = null;   // 報告的結算卡:換畫面前呼叫 destroy() 停掉小雞

  if (st && st.done) renderReport();
  else if (st) renderTest();
  else renderIntro();

  function dropCard() { if (resultCard) { resultCard.destroy(); resultCard = null; } }
  function leaveFocus() { closePanel(false); if (focus) { focus.leave(); focus = null; } }

  /* ============ 開始前 ============ */
  function renderIntro() {
    leaveFocus();
    dropCard();
    root.replaceChildren();
    const head = h('div', { class: 'page-head' },
      h('canvas', { class: 'hub-art', 'data-doodle': 'diagnostic', 'data-size': '40', 'aria-hidden': 'true' }),
      h('h1', null, '程度檢測'));
    if (window.UI && typeof UI.mount === 'function' && document.readyState !== 'loading') UI.mount(head);   // 標題左邊的圖示(頁面載入那一下 js/ui.js 會畫,之後重畫的自己掛)
    root.append(
      head,
      h('div', { class: 'diag-intro' },
        h('p', { class: 'mock-tags' },
          h('span', { class: 'mock-tag' }, items.length + ' 題'),
          h('span', { class: 'mock-tag' }, '約 20 分鐘')),
        h('button', {
          class: 'btn primary', 'data-gate': '',   // 開始檢測:沒登入時 js/profile.js 先攔下
          onclick: () => {
            if (!uiReady()) return;   // 共用元件沒載到:不清掉原本的作答紀錄
            st = { answers: {}, done: false, startedAt: new Date().toISOString() };
            store.set(KEY, st);
            cur = 0;
            renderTest();
            focus.focusMain();
          },
        }, '開始')));
  }

  /* ============ 題號面板:作答列右邊「3 / 28」點開,可跳題,答過的題有底色 ============ */
  function openPanel() {
    if (panel) return;
    const nav = h('div', { class: 'q-nav' });
    items.forEach((x, i) => {
      const done = st.answers[i] !== undefined;
      nav.append(h('button', {
        class: ((i === cur ? 'cur' : '') + (done ? ' ans' : '')).trim(), type: 'button', 'aria-current': i === cur ? 'true' : null,
        'aria-label': '第 ' + (i + 1) + ' 題' + (done ? ' 已作答' : ''),
        onclick: () => { closePanel(false); go(i); },
      }, String(i + 1)));
    });
    /* 焦點先到目前那一題(aria-current);Esc、點遮罩、關閉鈕由 UI.sheet 處理 */
    panel = UI.sheet({
      title: '題號', note: '已作答 ' + Object.keys(st.answers).length + ' / ' + items.length, class: 'mock-panel',
      nodes: [h('div', { class: 'mock-panel-group' }, nav)],
      onClose: () => { panel = null; },
    });
  }
  /* back:焦點回作答列的「3 / 28」;點了題號換題時不回 */
  function closePanel(back) { if (panel) panel.close(back); }

  /* ============ 作答 ============ */
  /* 換題:焦點到新題的題幹(按鈕整段重畫,不然焦點掉回頁面) */
  function go(i) { cur = i; renderTest(); window.scrollTo(0, 0); if (focus) focus.focusMain(); }
  function renderTest() {
    if (!uiReady()) return;   // 共用元件沒載到:說一聲、給重新整理,不在這裡丟錯
    dropCard();
    root.replaceChildren();
    const total = items.length;
    const it = items[cur];

    /* 專心模式:進度在作答列,交卷在作答列右邊。答案每題都存,中途離開進度不會丟,所以關閉不用再確認。
       交卷跟作答一樣標 data-gate:別的分頁登出後再按,js/profile.js 先攔下 */
    if (!focus || !focus.active) {
      focus = UI.focus.enter({
        total, confirmExit: false, onCount: openPanel,
        action: { label: '交卷', onClick: e => handler && handler(e), attrs: GATE },
        onExit: () => { leaveFocus(); location.href = 'drill.html'; },
      });
    }
    focus.progress(cur + 1);

    /* 篇章(p6/p7) */
    if (it.kind === 'p6') {
      const box = h('div', { class: 'passage-box', style: 'position:static;max-height:none;margin-bottom:14px' },
        h('span', { class: 'p-label' }, '段落填空'));
      const frag = document.createDocumentFragment();
      String(D.p6.passage).split(/(\{\{\d\}\})/).forEach(seg => {
        const m = seg.match(/^\{\{(\d)\}\}$/);
        if (!m) { if (seg) frag.append(document.createTextNode(seg)); return; }
        const n = Number(m[1]);
        frag.append(h('span', { class: 'gap-mark' + (n === it.num ? ' answered' : '') }, '(' + n + ') ______'));
      });
      box.append(h('div', null, frag));
      root.append(box);
    }
    if (it.kind === 'p7') {
      D.p7.passages.forEach(ps => {
        root.append(h('div', { class: 'passage-box', style: 'position:static;max-height:none;margin-bottom:14px' },
          h('span', { class: 'p-label' }, '閱讀理解'),
          h('div', null, ps.content)));
      });
    }

    /* 題目 */
    const chosen = st.answers[cur];
    const opts = h('div', { class: 'opts' });
    it.options.forEach((opt, oi) => {
      opts.append(h('button', {
        class: 'opt' + (chosen === oi ? ' sel' : ''), 'data-gate': '', 'aria-pressed': chosen === oi ? 'true' : 'false',
        onclick: () => {
          st.answers[cur] = oi;
          store.set(KEY, st);
          /* 選完自動到下一題(焦點到新題的題幹);最後一題留在原地,焦點回到剛選的那顆 */
          if (cur < total - 1) go(cur + 1); else focus.keep(renderTest);
          focus.say('已選 ' + LETTERS[oi]);
        },
      }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
    });
    root.append(h('div', { class: 'q-block' },
      it.kind === 'p6' ? h('div', { class: 'mock-gap-no' }, '空格 (' + it.num + ')') : h('div', { class: 'q-text' }, it.text),
      opts));

    /* 導航 */
    const unanswered = total - Object.keys(st.answers).length;
    function handIn(opener, asked) {
      /* 確認視窗開著的時候別再開一個:以前再按一次又問、又排一次,存兩次、報告畫兩次、小雞的 PET_HOOK.done 跑兩次 */
      if (asking) return;
      if (unanswered > 0 && !asked) {
        asking = true;
        closePanel(false);
        UI.confirm({ title: '還有 ' + unanswered + ' 題沒作答', body: '未作答列入答錯', ok: '交卷', cancel: '繼續作答' })
          .then(yes => { asking = false; if (yes) handIn(opener, true); });
        return;
      }
      /* 問的時候別的分頁登出、帳號資料夾變成還沒灌過:不交卷、不畫報告,開「重新整理」卡,答過的留著
         (跟刷題頁的交卷一樣;以前照樣畫出報告,其實沒存) */
      if (typeof holdForAccount === 'function' && holdForAccount(opener)) return;
      st.done = true;
      st.finishedAt = new Date().toISOString();
      store.set(KEY, st);
      leaveFocus();
      window.scrollTo(0, 0);
      const card = renderReport();
    }
    handler = e => handIn(e && e.currentTarget);
    const isLast = cur >= total - 1;
    focus.action(isLast ? null : { label: '交卷', onClick: handler, attrs: GATE });
    focus.foot([
      cur > 0 ? h('button', { class: 'btn-text', type: 'button', onclick: () => go(cur - 1) }, '上一題') : null,
      h('button', {
        class: 'btn primary', type: 'button', 'data-gate': isLast ? '' : null,
        onclick: isLast ? handler : () => go(cur + 1),
      }, isLast ? '交卷' : '下一題'),
    ]);
  }

  /* ============ 報告 ============ */
  function judge(acc) {
    if (acc >= 0.8) return ['good', '穩固'];
    if (acc >= 0.4) return ['mid', '部分掌握'];
    return ['weak', '待加強'];
  }

  function catLink(cat, kind) {
    if (kind === 'p5') return 'practice.html?part=5&cat=' + encodeURIComponent(cat);
    if (kind === 'p6') return 'practice.html?part=6';
    return 'practice.html?part=7';
  }

  /* 回傳結算卡(交卷後掛勾把點心放進 card.reward) */
  function renderReport() {
    leaveFocus();
    dropCard();
    root.replaceChildren();
    const p = window.PROFILE && PROFILE.current();
    const total = items.length;

    /* 統計 */
    const cats = {};       // category → {correct,total,kind,items:[]}
    const diffs = { '基礎': { c: 0, t: 0 }, '中級': { c: 0, t: 0 }, '進階': { c: 0, t: 0 } };
    let score = 0, readC = 0, readT = 0;
    items.forEach((it, i) => {
      const ok = st.answers[i] === it.answer;
      if (ok) score++;
      const c = cats[it.category] = cats[it.category] || { correct: 0, total: 0, kind: it.kind, items: [] };
      c.total++; if (ok) c.correct++;
      c.items.push(i);
      if (diffs[it.difficulty]) { diffs[it.difficulty].t++; if (ok) diffs[it.difficulty].c++; }
      if (it.kind !== 'p5') { readT++; if (ok) readC++; }
    });
    const acc = d => d.t ? d.c / d.t : 0;
    const aB = acc(diffs['基礎']), aM = acc(diffs['中級']), aA = acc(diffs['進階']);
    const pct = a => Math.round(a * 100) + '%';

    const est = bandEstimate(aB, aM, aA, score / total);
    const band = est.band, advice = est.advice;
    const readNote = (readT && (readC / readT) < Math.min(aB, aM) - 0.2)
      ? ['篇章題正確率明顯低於單句題', '先做閱讀訓練'] : [];

    root.append(h('div', { class: 'page-head' }, h('h1', null, '檢測報告')));

    /* 第一屏:結算卡。姓名與日期放在分數上面的小字;三個難度的正確率跟在卡片下面一行 */
    const card = UI.result({
      kicker: (p ? p.name + ' · ' : '') + (st.finishedAt || '').slice(0, 10),
      score, total,
      stats: [['參考級距', band]],
      note: '級距為估算 · 非正式成績',
      primary: { label: '去刷題', href: 'practice.html' },
      links: [{ label: '列印 / 存成 PDF', onClick: () => window.print() }, { label: '再測一次', onClick: retest, attrs: GATE }],   // 再測一次:沒登入時先攔下
      earnId: 'diag',
    });
    resultCard = card;
    root.append(card.el, h('p', { class: 'diag-levels' },
      h('span', null, '基礎題 ' + pct(aB)), h('span', null, '中級題 ' + pct(aM)), h('span', null, '進階題 ' + pct(aA))));

    /* 考點總表 */
    root.append(h('div', { class: 'exercise-head' }, h('h2', null, '各考點掌握度')));
    const sorted = Object.entries(cats).sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total));
    const table = h('table', { class: 'cat-table' },
      h('tr', null, h('th', null, '考點'), h('th', null, '答對'), h('th', null, '判定'), h('th', { class: 'no-print' }, '')));
    sorted.forEach(([cat, c]) => {
      const [cls, label] = judge(c.correct / c.total);
      table.append(h('tr', null,
        h('td', null, catLabel(cat)),
        h('td', { class: 'num' }, c.correct + ' / ' + c.total),
        h('td', null, h('span', { class: 'verdict-pill ' + cls }, label), c.total === 1 ? h('span', { class: 'cat-few' }, '僅 1 題') : null),
        h('td', { class: 'no-print' }, cls !== 'good' ? h('a', { href: catLink(cat, c.kind), style: 'font-size:13px' }, '去刷這類題 →') : '')));
    });
    root.append(table);

    /* 還不會 */
    const weak = sorted.filter(([, c]) => c.correct / c.total < 0.8);

    /* 錯題分析:逐題內容放進預設收合的 UI.detail(20 幾題全部展開時手機上整頁很長) */
    const wrongs = items.map((it, i) => ({ it, i })).filter(x => st.answers[x.i] !== x.it.answer);
    if (!wrongs.length) root.append(h('div', { class: 'exercise-head' }, h('h2', null, '錯題分析')), UI.empty({ pose: 'happy', text: '全部答對' }));
    else root.append(UI.detail('錯題分析 ' + wrongs.length + ' 題', wrongs.map(({ it, i }) => wrongBlock(it, i))));
    function wrongBlock(it, i) {
      const chosen = st.answers[i];
      return h('div', { class: 'wrong-item' },
        h('div', { class: 'w-meta' },
          h('span', { class: 'q-no' }, 'Q' + (i + 1)),
          h('span', { class: 'badge cat' }, catLabel(it.category)),
          h('span', { class: 'badge ' + (it.difficulty === '基礎' ? 'level-basic' : it.difficulty === '進階' ? 'level-adv' : 'level-mid') }, it.difficulty)),
        h('div', { class: 'w-q' }, it.kind === 'p6' ? '空格 (' + it.num + ')' : it.text),
        h('div', { class: 'w-ans' },
          chosen === undefined
            ? h('span', { class: 'you' }, '未作答')
            : h('span', null, '你選 ', h('span', { class: 'you' }, LETTERS[chosen] + '. ' + it.options[chosen])),
          '  ',
          h('span', null, '正解 ', h('span', { class: 'right' }, LETTERS[it.answer] + '. ' + it.options[it.answer]))),
        h('div', { class: 'w-exp' }, it.explanation));
    }

    /* 建議 */
    root.append(h('div', { class: 'exercise-head' }, h('h2', null, '建議的練習順序')));
    const stepList = h('ol', null);
    weak.slice(0, 4).forEach(([cat, c]) => {
      stepList.append(h('li', null,
        h('a', { href: catLink(cat, c.kind) }, catLabel(cat)),
        ' 答對 ' + c.correct + ' / ' + c.total + ' · 先刷 15–20 題 · 錯題隔天到錯題本重做'));
    });
    if (score / total < 0.5) {
      stepList.append(h('li', null, h('a', { href: 'grammar.html' }, '文法基礎'),
        ' 從第 1 章依序學'));
    }
    stepList.append(h('li', null, h('a', { href: 'reading.html' }, '閱讀訓練'), ' 每週 2 篇'));
    root.append(h('div', { class: 'next-steps' }, [].concat(advice, readNote).map(t => h('p', null, t)), stepList));

    /* 重測:清掉這份報告回到開始前 */
    function retest() {
      UI.confirm({ title: '清除這份報告？', body: '刷題與閱讀進度不受影響', ok: '再測一次', cancel: '取消', danger: true }).then(yes => {
        if (!yes) return;
        store.remove(KEY);
        st = null; cur = 0;
        renderIntro();
      });
    }
    return card;
  }
})();
