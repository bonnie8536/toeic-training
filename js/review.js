/* 每日複習:把全站錯過的東西集中成一份今日功課。
   - 可即練:P5 錯題、聽力 P1/P2 錯題、片語錯題(答對就從錯題池移出,越早錯的越先出)。
   - 題組類(P6/P7/聽力對話)與單字漏接、文法待補,導向各自的複習入口。 */
(function () {
  const root = $('#review-root');
  const T = window.TOEIC || {};
  const LD = T.listening || {};

  function collect() {
    const items = [];
    const d5 = store.get('drill_p5', {});
    (T.part5 || []).forEach(q => { const r = d5[q.id]; if (r && !r.ok) items.push({ kind: 'p5', q, t: r.t || 0 }); });
    const l1 = store.get('listen_p1', {});
    (LD.p1 || []).forEach(q => { const r = l1[q.id]; if (r && !r.ok) items.push({ kind: 'l1', q, t: r.t || 0 }); });
    const l2 = store.get('listen_p2', {});
    (LD.p2 || []).forEach(q => { const r = l2[q.id]; if (r && !r.ok) items.push({ kind: 'l2', q, t: r.t || 0 }); });
    const pd = store.get('phrase_drill', {});
    (T.phrases || []).forEach(p => { const r = pd[p.id]; if (r && !r.ok) items.push({ kind: 'ph', q: p, t: r.t || 0 }); });
    return items.sort((a, b) => a.t - b.t);
  }

  function otherCounts() {
    const c = { sets: 0, lsets: 0, vocab: 0, grammar: 0 };
    ['6', '7'].forEach(p => {
      const st = store.get('drill_p' + p, {});
      (T['part' + p] || []).forEach(set => {
        if (set.questions.some((q, qi) => {
          const k = set.id + ':' + (q.num !== undefined ? q.num : qi);
          return st[k] && !st[k].ok;
        })) c.sets++;
      });
    });
    ['3', '4'].forEach(p => {
      const st = store.get('listen_p' + p, {});
      (LD['p' + p] || []).forEach(set => {
        if (set.questions.some((q, qi) => { const k = set.id + ':' + qi; return st[k] && !st[k].ok; })) c.lsets++;
      });
    });
    c.vocab = Object.keys(store.get('vgame_miss', {})).length;
    const gd = store.get('grammar_done', {});
    (T.grammar || []).forEach(u => { const r = gd[u.id]; if (r && r.ok < r.t) c.grammar++; });
    return c;
  }

  renderHome();

  function renderHome() {
    document.title = '每日複習|刷刷英文';
    root.innerHTML = '';
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '每日複習')));

    const items = collect();
    const c = otherCounts();
    const todo = items.slice(0, 20);

    root.append(h('div', { class: 'part-cards', style: 'grid-template-columns:1fr' },
      h('div', { class: 'part-card' },
        h('p', null, items.length
          ? '待複習 ' + items.length + ' 題(Part 5、聽力 Part 1/2、片語)。'
          : '目前沒有待複習的單題。'),
        h('div', { class: 'cfg-row' },
          items.length ? h('button', { class: 'btn primary', onclick: () => runner(todo) }, '開始複習(' + todo.length + ' 題)') : null))));

    const links = [];
    if (c.sets) links.push(['閱讀題組錯題 ' + c.sets + ' 組', 'practice.html']);
    if (c.lsets) links.push(['聽力對話/獨白錯題 ' + c.lsets + ' 組', 'practice.html']);
    if (c.vocab) links.push(['單字漏接 ' + c.vocab + ' 個(玩一場優先出)', 'vocab.html']);
    if (c.grammar) links.push(['文法課有錯題的單元 ' + c.grammar + ' 課', 'grammar.html']);
    if (links.length) {
      root.append(h('div', { class: 'exercise-head' }, h('h2', null, '其他待複習')));
      const grid = h('div', { class: 'part-cards', style: 'grid-template-columns:1fr 1fr' });
      links.forEach(([txt, href]) => {
        grid.append(h('div', { class: 'part-card' },
          h('p', { style: 'margin-bottom:10px' }, txt),
          h('a', { class: 'btn', href }, '前往')));
      });
      root.append(grid);
    }
  }

  /* ================= 複習輪 ================= */
  function runner(list) {
    let cur = 0, cleared = 0;
    let player = null;
    const results = [];
    draw();

    function draw() {
      if (player) { player.pause(); player = null; }
      root.innerHTML = '';
      root.append(h('div', { class: 'drill-top' },
        h('h1', null, '每日複習'),
        h('a', { href: 'review.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回每日複習')));
      const nav = h('div', { class: 'q-nav' });
      list.forEach((x, i) => {
        let cls = i === cur ? 'cur' : '';
        if (results[i] === true) cls += ' ok';
        if (results[i] === false) cls += ' ng';
        nav.append(h('button', { class: cls.trim(), disabled: '' }, String(i + 1)));
      });
      root.append(nav);
      drawItem(list[cur]);
    }

    function next(isLast) {
      return h('div', { class: 'drill-nav-btns' },
        h('button', {
          class: 'btn primary',
          onclick: () => { if (isLast) summary(); else { cur++; draw(); window.scrollTo(0, 0); } },
        }, isLast ? '完成這一輪' : '下一題 →'));
    }

    function settle(item, ok) {
      results[cur] = ok;
      const keyMap = { p5: 'drill_p5', l1: 'listen_p1', l2: 'listen_p2', ph: 'phrase_drill' };
      const key = keyMap[item.kind];
      const st = store.get(key, {});
      const id = item.q.id;
      if (ok) { delete st[id]; cleared++; }
      else if (st[id]) st[id].t = Date.now();
      store.set(key, st);
    }

    function optButtons(q, onPick, letterOnly) {
      const opts = h('div', { class: letterOnly ? 'letter-row' : 'opts' });
      q.options.forEach((opt, oi) => {
        opts.append(h('button', {
          class: letterOnly ? 'letter-big' : 'opt',
          onclick: () => onPick(oi, opts),
        }, letterOnly ? LETTERS[oi] : h('span', { class: 'letter' }, LETTERS[oi]),
          letterOnly ? null : h('span', null, opt)));
      });
      return opts;
    }

    function grade(q, oi, opts, letterOnly) {
      [...opts.children].forEach((b, bi) => {
        b.disabled = true;
        if (bi === q.answer) b.classList.add('correct');
        else if (bi === oi) b.classList.add('wrong');
        else if (!letterOnly) b.classList.add('plain');
      });
      return oi === q.answer;
    }

    function drawItem(item) {
      let done = false;
      const isLast = cur === list.length - 1;
      const result = h('div', null);
      const q = item.q;
      const block = h('div', { class: 'q-block' });

      if (item.kind === 'p5') {
        block.append(
          h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, 'Part 5 · ' + q.category)),
          h('div', { class: 'q-text', style: 'font-size:17px' }, q.question),
          optButtons(q, (oi, opts) => {
            if (done) return; done = true;
            const ok = grade(q, oi, opts);
            settle(item, ok);
            result.append(h('div', { class: 'explain' },
              h('div', { class: 'verdict ' + (ok ? 'ok' : 'bad') }, ok ? '答對了,移出錯題本' : '再想想,正確是 ' + LETTERS[q.answer]),
              h('div', null, q.explanation), h('div', { class: 'tr' }, '句意:' + q.translation)), next(isLast));
          }), result);
      } else if (item.kind === 'ph') {
        block.append(
          h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, '片語')),
          h('div', { class: 'q-text' }, q.quiz.q),
          optButtons(q.quiz, (oi, opts) => {
            if (done) return; done = true;
            const ok = grade(q.quiz, oi, opts);
            settle(item, ok);
            result.append(h('div', { class: 'explain' },
              h('div', { class: 'verdict ' + (ok ? 'ok' : 'bad') }, ok ? '答對了,移出錯題本' : '再想想,正確是 ' + LETTERS[q.quiz.answer]),
              h('div', null, q.quiz.explanation)),
              h('div', { class: 'phrase-card' },
                h('div', { class: 'pc-head' }, h('b', null, q.phrase), h('span', null, q.zh)),
                h('div', { class: 'pc-ex' }, q.example), h('div', { class: 'pc-exzh' }, q.exampleZh)),
              next(isLast));
          }), result);
      } else {
        /* 聽力 P1/P2:可重複播放(複習情境) */
        player = new Audio('audio/' + q.id + '.mp3');
        const playBtn = h('button', {
          class: 'btn primary player-btn', type: 'button',
          onclick: () => { player.currentTime = 0; player.play().catch(() => {}); },
        }, '▶ 播放');
        block.append(h('div', { class: 'meta', style: 'margin-bottom:8px' },
          h('span', { class: 'badge cat' }, item.kind === 'l1' ? '聽力 Part 1' : '聽力 Part 2')));
        if (item.kind === 'l1') {
          block.append(h('div', { class: 'listen-photo' }, h('img', {
            src: 'img/listening/' + q.id + '.jpg', alt: '聽力照片',
            onerror: e => e.target.replaceWith(h('div', { class: 'photo-missing' }, '照片準備中')),
          })));
        }
        block.append(h('div', { class: 'player' }, playBtn),
          h('div', { class: 'q-text', style: 'margin-top:10px' },
            item.kind === 'l1' ? '選出最符合照片的描述:' : '選出最合適的回應:'),
          optButtons(q, (oi, opts) => {
            if (done) return; done = true;
            const ok = grade(q, oi, opts, true);
            settle(item, ok);
            result.append(h('div', { class: 'explain' },
              h('div', { class: 'verdict ' + (ok ? 'ok' : 'bad') }, ok ? '答對了,移出錯題本' : '再想想,正確是 ' + LETTERS[q.answer]),
              h('div', null, q.explanation)),
              h('div', { class: 'transcript-box' }, h('b', null, '逐字稿'),
                h('div', { class: 'tr-en' }, (q.question ? q.question + '\n' : '') + q.options.map((o, oi2) => LETTERS[oi2] + '. ' + o).join('\n')),
                h('div', { class: 'tr-zh' }, q.transcriptZh)),
              next(isLast));
          }, true), result);
      }
      root.append(block);
    }

    function summary() {
      if (player) player.pause();
      root.innerHTML = '';
      root.append(h('div', { class: 'report-head', style: 'margin-top:26px' },
        h('h2', null, '這一輪清掉 ' + cleared + ' / ' + list.length + ' 題'),
        cleared === list.length ? null : h('div', { class: 'band-note' }, '沒清掉的會再出現。')));
      root.append(h('div', { class: 'drill-nav-btns' },
        h('a', { class: 'btn primary', href: 'review.html' }, '回每日複習'),
        h('a', { class: 'btn', href: 'index.html' }, '回首頁')));
      window.scrollTo(0, 0);
    }
  }
})();
