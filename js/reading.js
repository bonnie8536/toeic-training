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
    document.title = '閱讀訓練|刷刷英文';
    let levelFilter = '全部';

    const head = h('div', { class: 'page-head' },
      h('h1', null, '閱讀訓練'));
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
        const tqRes = store.get('read_tq_' + a.id, null);
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
            (doneCount || qDone || tqRes)
              ? h('div', { class: 'progress-note' }, '單字 ' + doneCount + '/' + total + ' · 題目已作答 ' + qDone + '/' + a.questions.length
                  + (tqRes ? ' · 單字考題 ' + tqRes.score + '/' + tqRes.total : ''))
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
    document.title = a.title + '|刷刷英文';
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
    const hasBank = store.get('vgame_banks', []).some(b => b.id === 'art_' + a.id);
    const bankBtn = h('button', {
      class: 'btn' + (hasBank ? ' on' : ''),
      onclick: () => importVocabToBank(a, bankBtn),
    }, hasBank ? '更新題庫單字' : '單字存入題庫');
    const toolbar = h('div', { class: 'reader-toolbar' },
      biBtn, bankBtn,
      h('span', { class: 'toolbar-note' }, '虛線單字可以點'),
      progressEl);

    const bodyEl = h('div', { class: 'article-body' });
    const qWrap = h('div', null);
    const tWrap = h('div', null);

    root.append(head, illust, toolbar, bodyEl, qWrap, tWrap);
    renderBody();
    renderQuestions(a, qWrap);
    renderTransfer(a, tWrap);
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
      // 本文永遠顯示原文英文;學生填的內容只出現在點開的內容卡裡
      const span = h('span', { class: 'vw' + (st ? ' done' : '') }, surface);
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
      const hintBox = h('div', { class: 'pop-hint', style: 'display:none' }, h('b', null, '提示'), entry.hint);
      const zhBox = h('div', { class: 'pop-zh-hint', style: 'display:none' }, h('b', null, '中文意思'), entry.zh);
      const ansBox = h('div', { class: 'pop-zh-hint', style: 'display:none' }, h('b', null, '原文'), surface);
      const ansBtn = h('button', {
        class: 'pop-mini danger', type: 'button', style: 'display:none',
        onclick: () => { ansBox.style.display = ''; ansBtn.style.display = 'none'; positionPop(); input.focus(); },
      }, '看原文答案');
      const zhBtn = h('button', {
        class: 'pop-mini', type: 'button', style: 'display:none',
        onclick: () => { zhBox.style.display = ''; zhBtn.style.display = 'none'; ansBtn.style.display = ''; positionPop(); input.focus(); },
      }, '看中文意思');
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
        span.textContent = surface;   // 本文恢復原文英文,填的內容存在卡片裡
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
        h('div', { class: 'pop-hint' }, h('b', null, '英文釋義'), entry.hint),
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
      h('h2', null, '抓重點')));

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
            logAttempt('r', a.id + ':' + qi, oi, oi === q.answer);
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

  /* ============ 單字存入題庫(單字訓練的自訂題庫) ============ */
  function importVocabToBank(a, btn) {
    const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
    const banks = store.get('vgame_banks', []);
    const bid = 'art_' + a.id;
    let bank = banks.find(b => b.id === bid);
    if (!bank) { bank = { id: bid, name: '', words: [] }; banks.push(bank); }
    bank.name = ('文章:' + a.titleZh).slice(0, 20);
    (a.vocab || []).forEach(v => {
      const en = v.base || v.word;
      if (!en || en.length > 30) return;
      const exist = (bank.words = bank.words || []).find(x => norm(x.en) === norm(en));
      if (exist) exist.zh = v.zh;
      else bank.words.push({ en, zh: v.zh, on: true });
    });
    store.set('vgame_banks', banks);
    btn.textContent = '已存入題庫(' + bank.words.length + ' 字)';
    btn.classList.add('on');
    if (!btn.nextElementSibling || !btn.nextElementSibling.classList.contains('bank-golink')) {
      btn.after(h('a', { class: 'bank-golink', href: 'vocab.html' }, '去單字訓練'));
    }
  }

  /* ============ 單字考題:同一批單字、全新文章的挖空 ============ */
  function renderTransfer(a, wrap) {
    const tr = a.transfer;
    if (!tr || !Array.isArray(tr.words) || !tr.words.length) return;
    const storeKey = 'read_tq_' + a.id;

    /* 解析:段落 ×(文字|空格),answers 依出現順序 */
    const answers = [];
    const paras = String(tr.passage).split(/\n{2,}/).map(para =>
      para.split(/(\[\[.+?\]\])/).map(seg => {
        const m = seg.match(/^\[\[(.+)\]\]$/);
        if (!m) return { text: seg };
        answers.push(m[1]);
        return { blank: answers.length - 1 };
      }).filter(seg => seg.text !== ''));

    wrap.append(h('div', { class: 'exercise-head' }, h('h2', null, '單字考題')));
    const last = store.get(storeKey, null);
    const area = h('div', { class: 'tq-area' });
    wrap.append(
      h('p', { class: 'result-note' },
        '同一批單字換一篇文章。字卡拖進空格,或先點字卡再點空格。'
        + (last ? '上次成績 ' + last.score + '/' + last.total + '。' : '')),
      area);

    let placed = {}, selected = null, armed = null, submitted = false;
    let dragged = false;
    let bankOrder = shuffle(tr.words.map(x => x.word));

    function shuffle(list) {
      const arr = [...list];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    function place(bi, word) {
      Object.keys(placed).forEach(k => { if (placed[k] === word) delete placed[k]; });
      placed[bi] = word;
    }

    /* 把字卡(或已填的空格)拖到空格上;拖回字卡區=取消填入。移動 6px 內視為點擊,交給 onclick。 */
    function enableDrag(el, word, fromBlank) {
      el.addEventListener('pointerdown', e => {
        if (submitted || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const sx = e.clientX, sy = e.clientY;
        let ghost = null, moving = false;
        const under = ev => {
          if (ghost) ghost.style.display = 'none';
          const t = document.elementFromPoint(ev.clientX, ev.clientY);
          if (ghost) ghost.style.display = '';
          return t;
        };
        const move = ev => {
          if (!moving) {
            if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
            moving = true;
            ghost = h('div', { class: 'tq-ghost' }, word);
            document.body.append(ghost);
            el.classList.add('dragging');
          }
          ghost.style.left = ev.clientX + 'px';
          ghost.style.top = ev.clientY + 'px';
          const t = under(ev);
          const b = t && t.closest('.tq-blank');
          area.querySelectorAll('.tq-blank.over').forEach(x => { if (x !== b) x.classList.remove('over'); });
          if (b) b.classList.add('over');
          ev.preventDefault();
        };
        const up = ev => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          document.removeEventListener('pointercancel', up);
          if (!moving) return;
          const t = ev.type === 'pointercancel' ? null : under(ev);
          if (ghost) ghost.remove();
          el.classList.remove('dragging');
          const b = t && t.closest('.tq-blank');
          if (b) place(Number(b.getAttribute('data-bi')), word);
          else if (fromBlank !== undefined && t && t.closest('.tq-bank')) delete placed[fromBlank];
          selected = null;
          armed = null;
          dragged = true;
          setTimeout(() => { dragged = false; }, 300);
          draw();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
      });
    }

    function submit() {
      submitted = true;
      const score = answers.filter((w, bi) => placed[bi] === w).length;
      store.set(storeKey, { score, total: answers.length, t: Date.now() });
      logAttempt('tq', a.id, score, score === answers.length, { n: answers.length });
      draw();
    }

    function reset() {
      placed = {}; selected = null; armed = null; submitted = false;
      bankOrder = shuffle(tr.words.map(x => x.word));
      draw();
    }

    function draw() {
      area.innerHTML = '';
      const used = new Set(Object.values(placed));

      const bank = h('div', { class: 'tq-bank' });
      bankOrder.forEach(word => {
        const isUsed = used.has(word);
        const chip = h('button', {
          class: 'tq-chip' + (selected === word ? ' on' : '') + (isUsed ? ' used' : ''),
          type: 'button',
          disabled: (submitted || isUsed) ? '' : null,
          onclick: () => {
            if (dragged) return;
            if (armed !== null) { place(armed, word); armed = null; selected = null; }
            else selected = (selected === word ? null : word);
            draw();
          },
        }, word);
        if (!submitted && !isUsed) enableDrag(chip, word);
        bank.append(chip);
      });

      const body = h('div', { class: 'tq-passage' });
      paras.forEach(segs => {
        const p = h('p', null);
        segs.forEach(seg => {
          if (seg.text !== undefined) { p.append(document.createTextNode(seg.text)); return; }
          const bi = seg.blank;
          const word = placed[bi];
          let cls = 'tq-blank' + (word ? ' filled' : '') + (armed === bi ? ' on' : '');
          const nodes = [h('span', { class: 'no' }, String(bi + 1))];
          if (submitted) {
            const okB = word === answers[bi];
            cls += okB ? ' ok' : ' bad';
            if (okB) nodes.push(word);
            else { nodes.push(h('s', null, word || '(空)'), ' ' + answers[bi]); }
          } else nodes.push(word || '');
          const blankBtn = h('button', {
            class: cls, type: 'button', 'data-bi': String(bi),
            onclick: () => {
              if (submitted || dragged) return;
              if (selected) { place(bi, selected); selected = null; armed = null; }
              else if (placed[bi]) { delete placed[bi]; armed = null; }
              else armed = (armed === bi ? null : bi);
              draw();
            },
          }, nodes);
          if (word && !submitted) enableDrag(blankBtn, word, bi);
          p.append(blankBtn);
        });
        body.append(p);
      });

      area.append(bank, body);

      const filledN = Object.keys(placed).length;
      if (!submitted) {
        area.append(h('div', { class: 'drill-nav-btns' },
          h('button', {
            class: 'btn primary', type: 'button',
            disabled: filledN < answers.length ? '' : null,
            onclick: submit,
          }, filledN < answers.length ? '交卷對答案(還有 ' + (answers.length - filledN) + ' 格)' : '交卷對答案')));
      } else {
        const score = answers.filter((w, bi) => placed[bi] === w).length;
        area.append(h('div', { class: 'tq-result' }, '成績:' + score + '/' + answers.length));
        const zhWrap = h('div', { class: 'tq-zh' });
        String(tr.passageZh).split(/\n{2,}/).forEach(z => zhWrap.append(h('p', null, z)));
        const words = h('div', { class: 'tq-review' });
        tr.words.forEach(x => words.append(h('div', null, h('b', null, x.word), x.zh)));
        area.append(zhWrap, words,
          h('div', { class: 'drill-nav-btns' },
            h('button', { class: 'btn', type: 'button', onclick: reset }, '重新挑戰')));
      }
    }

    draw();
  }
})();
