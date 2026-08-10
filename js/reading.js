/* 閱讀模組:文章列表(分級篩選)+閱讀器。
   單字互動(浮動卡片版):點單字 → 原位置變空格(寬度不變,版面不動),
   填空卡浮在字的上方:輸入+提示階梯(英文提示 → 看中文意思 → 答錯兩次後可看答案)。
   填對(或看答案)後單字亮黃;之後點它顯示翻譯卡,再點一次或點旁邊就關閉。 */
(function () {
  const root = $('#reading-root');
  const articles = (window.TOEIC && TOEIC.articles) || [];

  if (!articles.length) {
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' },
      '文章資料尚未載入。請確認 data/articles.js 存在(執行 tools/merge_data.py 產生)。'));
    return;
  }

  const LEVEL_ORDER = ['初級', '中級', '中高級', '高級'];
  function levelName(a) {
    for (const name of ['中高級', '高級', '中級', '初級']) if (a.level.startsWith(name)) return name;
    return '中級';
  }

  const artId = getParam('id');
  const article = articles.find(a => a.id === artId);
  if (article) renderReader(article);
  else renderList();

  /* ============ 文章列表 ============ */
  function renderList() {
    document.title = '閱讀訓練|多益閱讀訓練室';
    let levelFilter = '全部';

    const head = h('div', { class: 'page-head' },
      h('h1', null, '閱讀訓練'),
      h('p', null, '從你的級別開始:點文章裡的虛線單字挑戰填空,讀完做題目練習抓重點。'));
    const chips = h('div', { class: 'drill-filters', style: 'margin:14px 0 4px' });
    const listWrap = h('div', { class: 'article-list' });
    root.append(head, chips, listWrap);

    ['全部', ...LEVEL_ORDER].forEach(name => {
      chips.append(h('button', {
        class: 'chip' + (name === levelFilter ? ' on' : ''),
        onclick: () => { levelFilter = name; drawChips(); drawList(); },
      }, name));
    });
    function drawChips() {
      $$('.chip', chips).forEach(c => c.classList.toggle('on', c.textContent === levelFilter));
    }

    function drawList() {
      listWrap.innerHTML = '';
      const sorted = [...articles].sort((a, b) =>
        LEVEL_ORDER.indexOf(levelName(a)) - LEVEL_ORDER.indexOf(levelName(b)));
      const shown = sorted.filter(a => levelFilter === '全部' || levelName(a) === levelFilter);
      if (!shown.length) {
        listWrap.append(h('div', { class: 'q-block' }, '這個級別還沒有文章。'));
        return;
      }
      shown.forEach(a => {
        const vocabState = store.get('vocab_' + a.id, {});
        const doneCount = Object.keys(vocabState).length;
        const total = countVocabInstances(a);
        const qState = store.get('read_q_' + a.id, {});
        const qDone = Object.keys(qState).length;
        const img = h('img', { src: a.image || ('img/' + a.id + '.svg'), alt: '', onerror: e => e.target.parentNode.remove() });
        listWrap.append(h('a', { class: 'article-card', href: 'reading.html?id=' + a.id },
          h('div', { class: 'thumb' }, img),
          h('div', { class: 'body' },
            h('div', { class: 'meta' },
              h('span', { class: 'badge cat' }, a.category),
              h('span', { class: 'badge ' + levelBadgeClass(a.level) }, a.level),
              h('span', null, '約 ' + a.readTime + ' 分鐘')),
            h('h3', null, a.title),
            h('div', { class: 'zh' }, a.titleZh),
            (doneCount || qDone)
              ? h('div', { class: 'progress-note' }, '單字 ' + doneCount + '/' + total + ' · 題目已作答 ' + qDone + '/' + a.questions.length)
              : null)));
      });
    }
    drawList();
  }

  function countVocabInstances(a) {
    let n = 0;
    a.paragraphs.forEach(p => { n += (p.en.match(/\[\[/g) || []).length; });
    return n;
  }

  /* ============ 閱讀器 ============ */
  function renderReader(a) {
    document.title = a.title + '|多益閱讀訓練室';
    const vocabMap = {};
    (a.vocab || []).forEach(v => { vocabMap[v.word.toLowerCase()] = v; });
    /* state = {idx: {t: 學生填的內容}};不批改對錯,填了就算完成,之後可修改 */
    let state = store.get('vocab_' + a.id, {});
    let migrated = false;
    Object.keys(state).forEach(k => {
      if (typeof state[k] === 'string') { state[k] = { t: null }; migrated = true; }   // 舊格式相容
    });
    if (migrated) store.set('vocab_' + a.id, state);
    let bilingual = false;
    let instSeq = 0;

    const head = h('div', { class: 'reader-head' },
      h('div', { class: 'meta' },
        h('a', { href: 'reading.html' }, '← 回文章列表'),
        h('span', { class: 'badge cat' }, a.category),
        h('span', { class: 'badge ' + levelBadgeClass(a.level) }, a.level),
        h('span', null, '約 ' + a.readTime + ' 分鐘')),
      h('h1', null, a.title),
      h('div', { class: 'zh-title' }, a.titleZh));

    const illustImg = h('img', { src: a.image || ('img/' + a.id + '.svg'), alt: a.title, onerror: e => e.target.parentNode.remove() });
    const illust = h('div', { class: 'reader-illust' }, illustImg);

    const progressEl = h('span', { class: 'vocab-progress' });
    const biBtn = h('button', { class: 'btn', onclick: toggleBilingual }, '對照翻譯');
    const toolbar = h('div', { class: 'reader-toolbar' },
      biBtn,
      h('span', { class: 'toolbar-note' }, '虛線單字可點擊挑戰填空;完成的字再點會顯示中文。'),
      progressEl);

    const bodyEl = h('div', { class: 'article-body' });
    const qWrap = h('div', null);

    root.append(head, illust, toolbar, bodyEl, qWrap);
    renderBody();
    renderQuestions(a, qWrap);
    updateProgress();

    function toggleBilingual() {
      closePop();
      bilingual = !bilingual;
      biBtn.classList.toggle('on', bilingual);
      renderBody();
    }

    function renderBody() {
      bodyEl.innerHTML = '';
      bodyEl.classList.toggle('bilingual', bilingual);
      instSeq = 0;
      a.paragraphs.forEach(p => {
        const en = renderParagraph(p.en);
        if (bilingual) {
          bodyEl.append(h('div', { class: 'para-row' },
            h('div', { class: 'en' }, en),
            h('div', { class: 'zh' }, p.zh)));
        } else {
          const para = h('p', { class: 'para' });
          en.forEach(node => para.append(node));
          bodyEl.append(para);
        }
      });
    }

    function renderParagraph(text) {
      const nodes = [];
      const parts = String(text).split(/(\[\[.+?\]\])/);
      for (const part of parts) {
        const m = part.match(/^\[\[(.+)\]\]$/);
        if (!m) { if (part) nodes.push(document.createTextNode(part)); continue; }
        const surface = m[1];
        const entry = vocabMap[surface.toLowerCase()];
        const idx = instSeq++;
        if (!entry) { nodes.push(document.createTextNode(surface)); continue; }
        nodes.push(makeWordSpan(surface, entry, idx));
      }
      return nodes;
    }

    function makeWordSpan(surface, entry, idx) {
      const st = state[idx];
      const shown = st && st.t ? st.t : surface;          // 已填→顯示學生填的內容
      const span = h('span', { class: 'vw' + (st ? ' done' : '') }, shown);
      span.addEventListener('click', e => {
        e.stopPropagation();
        if (popTarget === span) { closePop(); return; }   // 再點同一個字=收起卡片
        if (state[idx]) showTranslationPop(span, surface, entry, idx, null);
        else openFillPop(span, surface, entry, idx);
      });
      return span;
    }

    function saveFill(idx, text) {
      state[idx] = { t: text };
      store.set('vocab_' + a.id, state);
      updateProgress();
    }

    function updateProgress() {
      const total = countVocabInstances(a);
      const done = Object.keys(state).length;
      progressEl.innerHTML = '';
      progressEl.append(h('b', null, String(done)), '/' + total + ' 個單字已完成');
    }

    /* ============ 浮動卡片 ============ */
    let popEl = null, popTarget = null, popCleanup = null;

    function closePop() {
      if (popCleanup) { const fn = popCleanup; popCleanup = null; fn(); }
      if (popEl) { popEl.remove(); popEl = null; popTarget = null; }
    }

    /* 開卡:優先浮在字的上方,空間不夠才放下方 */
    function openPop(target, contentNodes, cleanup) {
      closePop();
      popEl = h('div', { class: 'vocab-pop' },
        h('button', { class: 'pop-close', onclick: closePop, type: 'button', 'aria-label': '關閉' }, '×'),
        contentNodes);
      popEl.addEventListener('click', e => e.stopPropagation());
      document.body.append(popEl);
      popTarget = target;
      popCleanup = cleanup || null;
      positionPop();
    }

    function positionPop() {
      if (!popEl || !popTarget) return;
      const r = popTarget.getBoundingClientRect();
      const pw = popEl.offsetWidth, ph = popEl.offsetHeight;
      let left = window.scrollX + r.left;
      const maxLeft = window.scrollX + document.documentElement.clientWidth - pw - 12;
      if (left > maxLeft) left = maxLeft;
      let top = window.scrollY + r.top - ph - 10;          // 上方
      if (top < window.scrollY + 6) top = window.scrollY + r.bottom + 10;   // 退而求下方
      popEl.style.left = Math.max(8, left) + 'px';
      popEl.style.top = top + 'px';
    }

    /* 填空卡:輸入+提示階梯。不批改對錯——有填就算完成,填什麼存什麼。 */
    function openFillPop(span, surface, entry, idx) {
      const editing = !!state[idx];                  // 修改模式(已填過)
      if (!editing) span.classList.add('gap');       // 原位置變空格,寬度不變
      const cleanup = editing ? null : () => span.classList.remove('gap');

      const input = h('input', {
        class: 'pop-fill-input', type: 'text',
        autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
        placeholder: '把單字填進來', 'aria-label': '填入單字',
        value: editing && state[idx].t ? state[idx].t : '',
      });
      const submitBtn = h('button', { class: 'btn primary pop-fill-btn', type: 'button', onclick: fill }, editing ? '更新' : '填入');
      const hintBox = h('div', { class: 'pop-hint', style: 'display:none' }, h('b', null, 'HINT'), entry.hint);
      const zhBox = h('div', { class: 'pop-zh-hint', style: 'display:none' }, h('b', null, '中文意思'), entry.zh);
      const ansBox = h('div', { class: 'pop-zh-hint', style: 'display:none' }, h('b', null, '原文'), surface);
      const ansBtn = h('button', {
        class: 'pop-mini danger', type: 'button', style: 'display:none',
        onclick: () => { ansBox.style.display = ''; ansBtn.style.display = 'none'; positionPop(); input.focus(); },
      }, '看原文答案');
      const zhBtn = h('button', {
        class: 'pop-mini', type: 'button', style: 'display:none',
        onclick: () => { zhBox.style.display = ''; zhBtn.style.display = 'none'; ansBtn.style.display = ''; positionPop(); input.focus(); },
      }, '還是不會?看中文意思');
      const hintBtn = h('button', {
        class: 'pop-mini', type: 'button',
        onclick: () => { hintBox.style.display = ''; hintBtn.style.display = 'none'; zhBtn.style.display = ''; positionPop(); input.focus(); },
      }, '看英文提示');

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') fill();
        if (e.key === 'Escape') closePop();
      });

      openPop(span, [
        h('div', null, h('span', { class: 'pop-word' }, '____'), h('span', { class: 'pop-pos' }, entry.pos || '')),
        h('div', { class: 'pop-fill-row' }, input, submitBtn),
        h('div', { class: 'pop-btns' }, hintBtn, zhBtn, ansBtn),
        hintBox, zhBox, ansBox,
      ], cleanup);
      input.focus();

      /* 有填就算完成:存下學生填的內容,字亮黃,卡片換成內容卡 */
      function fill() {
        const val = input.value.trim();
        if (!val) { input.focus(); return; }
        saveFill(idx, val);
        popCleanup = null;
        span.classList.remove('gap');
        span.classList.add('done');
        span.textContent = val;
        showTranslationPop(span, surface, entry, idx, '已填入!');
      }
    }

    /* 內容卡(已完成的字):顯示學生填的內容+原文+翻譯,可修改 */
    function showTranslationPop(span, surface, entry, idx, okMsg) {
      const st = state[idx] || {};
      const typed = st.t;
      const differs = typed && typed.toLowerCase().trim() !== surface.toLowerCase();
      const baseNote = entry.base && entry.base.toLowerCase() !== surface.toLowerCase()
        ? h('span', { class: 'base' }, '(原形 ' + entry.base + ')') : null;
      openPop(span, [
        okMsg ? h('div', { class: 'pop-ok' }, okMsg) : null,
        typed
          ? h('div', null, h('span', { class: 'pop-word' }, typed), h('span', { class: 'pop-pos' }, '你填的'))
          : null,
        differs || !typed
          ? h('div', null, h('span', { class: 'pop-word' }, surface), h('span', { class: 'pop-pos' }, (entry.pos || '') + ' 原文'))
          : h('div', { class: 'pop-pos' }, entry.pos || ''),
        h('div', { class: 'pop-zh' }, entry.zh, ' ', baseNote),
        h('div', { class: 'pop-hint' }, h('b', null, 'DEFINITION'), entry.hint),
        h('div', { class: 'pop-actions' },
          h('button', { type: 'button', onclick: () => openFillPop(span, surface, entry, idx) }, '修改填答'),
          h('button', {
            type: 'button',
            onclick: () => {
              delete state[idx];
              store.set('vocab_' + a.id, state);
              updateProgress();
              closePop();
              span.classList.remove('done');
              span.textContent = surface;
            },
          }, '清除,重新練習')),
      ]);
    }

    document.addEventListener('click', closePop);
    window.addEventListener('resize', closePop);
  }

  /* ============ 抓重點題組 ============ */
  function renderQuestions(a, wrap) {
    const key = 'read_q_' + a.id;
    let answers = store.get(key, {});

    wrap.append(h('div', { class: 'exercise-head' },
      h('span', { class: 'ex-no' }, '練習'),
      h('h2', null, '抓重點'),
      h('span', { class: 'en' }, 'Reading Comprehension')));

    const list = h('div', null);
    wrap.append(list);
    drawAll();

    function drawAll() {
      list.innerHTML = '';
      a.questions.forEach((q, qi) => list.append(drawQuestion(q, qi)));
      const answered = Object.keys(answers).length;
      const correct = a.questions.filter((q, qi) => answers[qi] === q.answer).length;
      const foot = h('div', { class: 'drill-nav-btns' },
        h('button', {
          class: 'btn',
          onclick: () => { answers = {}; store.set(key, answers); drawAll(); },
        }, '重做全部題目'),
        answered === a.questions.length
          ? h('span', { class: 'result-note', style: 'align-self:center' },
              '本篇成績:' + correct + '/' + a.questions.length)
          : null);
      list.append(foot);
    }

    function drawQuestion(q, qi) {
      const chosen = answers[qi];
      const done = chosen !== undefined;
      const block = h('div', { class: 'q-block' },
        h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'Q' + (qi + 1)), q.q));
      const opts = h('div', { class: 'opts' });
      q.options.forEach((opt, oi) => {
        let cls = 'opt';
        if (done) {
          if (oi === q.answer) cls += ' correct';
          else if (oi === chosen) cls += ' wrong';
          else cls += ' plain';
        }
        opts.append(h('button', {
          class: cls,
          disabled: done ? '' : null,
          onclick: () => {
            answers[qi] = oi;
            store.set(key, answers);
            drawAll();
          },
        }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
      });
      block.append(opts);
      if (done) {
        block.append(h('div', { class: 'explain' },
          h('div', { class: 'verdict ' + (chosen === q.answer ? 'ok' : 'bad') },
            chosen === q.answer ? '答對了' : '答錯了,正確答案是 ' + LETTERS[q.answer]),
          h('div', null, q.explanation)));
      }
      return block;
    }
  }
})();
