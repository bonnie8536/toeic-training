/* 文法基礎:從零開始的文法課。
   四階單元路徑(句子的零件→把句子變化→加長句子→接軌多益),
   一單元=白話講解+例句對照+小試身手;完成打勾,紀錄存 grammar_done(雲端同步)。 */
(function () {
  const root = $('#grammar-root');
  const UNITS = (window.TOEIC && TOEIC.grammar) || [];

  if (!UNITS.length) {
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' }, '文法教材生成中,稍後再來。'));
    return;
  }

  const STAGES = {
    a: { name: '第一章 名詞、冠詞與代名詞' },
    b: { name: '第二章 be 動詞與現在時態' },
    c: { name: '第三章 過去與完成時態' },
    d: { name: '第四章 未來與助動詞' },
    e: { name: '第五章 疑問、否定與祈使' },
    f: { name: '第六章 形容詞、副詞與比較' },
    g: { name: '第七章 介系詞、連接詞與子句' },
    h: { name: '第八章 進階句型' },
  };
  const stageOf = u => u.id.charAt(1);

  const uid = getParam('u');
  const unit = UNITS.find(x => x.id === uid);
  if (unit) renderUnit(unit);
  else renderHome();

  /* ================= 首頁 ================= */
  function renderHome() {
    document.title = '文法基礎|刷刷英文';
    const done = store.get('grammar_done', {});
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '文法基礎')));

    Object.entries(STAGES).forEach(([sk, sd]) => {
      const list = UNITS.filter(u => stageOf(u) === sk);
      if (!list.length) return;
      const doneN = list.filter(u => done[u.id]).length;
      root.append(h('div', { class: 'exercise-head' },
        h('h2', null, sd.name),
        h('span', { style: 'margin-left:auto;font-size:13.5px;color:var(--ink-light)' }, doneN + '/' + list.length)));
      const grid = h('div', { class: 'part-cards', style: 'grid-template-columns:1fr 1fr' });
      list.forEach((u, i) => {
        grid.append(h('div', {
          class: 'part-card', style: 'cursor:pointer',
          onclick: () => { location.href = 'grammar.html?u=' + u.id; },
        },
          h('h3', { style: 'font-size:16px' }, (i + 1) + '. ' + u.title, done[u.id] ? h('span', { class: 'gx-unit-done' }, ' ✓') : null)));
      });
      root.append(grid);
    });
    root.append(h('div', { style: 'height:40px' }));
  }

  /* ================= 單元 ================= */
  function renderUnit(u) {
    document.title = u.title + '|文法基礎';
    const idx = UNITS.indexOf(u);
    root.append(h('div', { class: 'drill-top' },
      h('h1', null, u.title),
      h('a', { href: 'grammar.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回文法基礎')));
    root.append(h('div', { class: 'gx-goal' }, u.goal));

    /* 講解 */
    const lesson = h('div', { class: 'lesson-view' });
    u.lesson.forEach(b => {
      if (b.t === 'p') lesson.append(h('p', { class: 'gx-p' }, b.text));
      else if (b.t === 'ex') {
        const en = h('div', { class: 'gx-ex-en' });
        if (b.focus && b.en.includes(b.focus)) {
          b.en.split(b.focus).forEach((seg, i) => {
            if (i) en.append(h('span', { class: 'gx-focus' }, b.focus));
            if (seg) en.append(seg);
          });
        } else en.textContent = b.en;
        lesson.append(h('div', { class: 'gx-ex' }, en, h('div', { class: 'gx-ex-zh' }, b.zh)));
      } else if (b.t === 'table') {
        const tbl = h('table', { class: 'gx-table' },
          h('tr', null, ...b.header.map(c => h('th', null, c))));
        b.rows.forEach(r => tbl.append(h('tr', null, ...r.map(c => h('td', null, c)))));
        lesson.append(tbl);
      } else if (b.t === 'tip') {
        lesson.append(h('div', { class: 'gx-tip' }, b.text));
      }
    });
    root.append(lesson);

    /* 小試身手(即答:學習情境要立刻知道對錯) */
    root.append(h('div', { class: 'exercise-head', style: 'margin-top:26px' }, h('h2', null, '小試身手')));
    const results = [];
    const quizWrap = h('div', null);
    u.quiz.forEach((q, qi) => {
      let answered = false;
      const result = h('div', null);
      const opts = h('div', { class: 'opts' });
      q.options.forEach((opt, oi) => {
        opts.append(h('button', {
          class: 'opt',
          onclick: () => {
            if (answered) return;
            answered = true;
            results[qi] = oi === q.answer;
            logAttempt('g', u.id + ':' + qi, oi, results[qi]);
            [...opts.children].forEach((btn, bi) => {
              btn.disabled = true;
              if (bi === q.answer) btn.classList.add('correct');
              else if (bi === oi) btn.classList.add('wrong');
              else btn.classList.add('plain');
            });
            result.append(h('div', { class: 'explain' },
              h('div', { class: 'verdict ' + (results[qi] ? 'ok' : 'bad') },
                results[qi] ? '答對了' : '答錯了,正確答案是 ' + LETTERS[q.answer]),
              h('div', null, q.explanation)));
            if (results.filter(x => x !== undefined).length === u.quiz.length) finish();
          },
        }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
      });
      quizWrap.append(h('div', { class: 'q-block' },
        h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'Q' + (qi + 1)), q.q),
        opts, result));
    });
    root.append(quizWrap);
    const tail = h('div', null);
    root.append(tail);

    function finish() {
      const ok = results.filter(Boolean).length;
      const done = store.get('grammar_done', {});
      done[u.id] = { ok, t: u.quiz.length };
      store.set('grammar_done', done);
      const next = UNITS[idx + 1];
      /* 對應題庫 P5 考點的單元,學完直接去刷題 */
      const DRILL_LINK = {
        'gc-12': '動詞時態與語態', 'gg-01': '介系詞', 'gg-08': '連接詞vs介系詞',
        'ga-09': '代名詞', 'gh-03': '關係詞', 'gf-02': '分詞', 'gf-05': '比較級',
        'gg-11': '不定詞與動名詞', 'gg-12': '不定詞與動名詞', 'gb-05': '主謂一致', 'gf-04': '詞性變化',
      };
      const cat = DRILL_LINK[u.id];
      tail.append(
        h('div', { class: 'report-head', style: 'margin-top:10px' },
          h('h2', null, '答對 ' + ok + ' / ' + u.quiz.length)),
        h('div', { class: 'drill-nav-btns' },
          next ? h('a', { class: 'btn primary', href: 'grammar.html?u=' + next.id }, '下一課:' + next.title) : null,
          cat ? h('a', { class: 'btn', href: 'practice.html?part=5&cat=' + encodeURIComponent(cat) }, '刷這個考點的題目') : null,
          h('a', { class: 'btn', href: 'grammar.html' }, '回文法基礎')));
    }
  }
})();
