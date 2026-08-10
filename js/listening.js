/* 聽力訓練:四大題型。
   - 作答前每題音檔最多播 2 次(模擬考試),答完可無限重聽。
   - P1/P2 選項只有音檔沒有文字(考完才顯示逐字稿);P3/P4 題目與選項照真實考試印在畫面上。
   - 紀錄存 listen_p1~p4(雲端同步);抽題優先抽沒做過的。 */
(function () {
  const root = $('#listening-root');
  const L = (window.TOEIC && TOEIC.listening) || null;

  if (!L || !L.p2 || !L.p2.length) {
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' },
      '聽力題庫尚未載入(請執行 tools/merge_data.py 與 tools/gen_audio.py)。'));
    return;
  }

  const PARTS = {
    '1': { title: 'Part 1 照片描述', unit: '題', items: L.p1, sizes: [4, 8, 12], desc: '看照片,聽四句描述,選最符合的。選項只有聲音沒有文字。' },
    '2': { title: 'Part 2 應答', unit: '題', items: L.p2, sizes: [5, 10, 25], desc: '聽一個問句和三個回應,選最合適的。' },
    '3': { title: 'Part 3 簡短對話', unit: '組', items: L.p3, sizes: [2, 3, 5], desc: '聽兩人對話,回答畫面上的三個問題。' },
    '4': { title: 'Part 4 簡短獨白', unit: '組', items: L.p4, sizes: [2, 3, 5], desc: '聽一段獨白(留言/廣播/宣布),回答三個問題。' },
  };
  const KEY = p => 'listen_p' + p;
  const qid = (set, qi) => set.id + ':' + qi;

  function partStats(p) {
    const st = store.get(KEY(p), {});
    let total = 0, answered = 0, correct = 0;
    if (p === '1' || p === '2') {
      total = PARTS[p].items.length;
      PARTS[p].items.forEach(q => {
        const r = st[q.id];
        if (r) { answered++; if (r.ok) correct++; }
      });
    } else {
      PARTS[p].items.forEach(set => set.questions.forEach((q, qi) => {
        total++;
        const r = st[qid(set, qi)];
        if (r) { answered++; if (r.ok) correct++; }
      }));
    }
    return { total, answered, correct };
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pickPool(p, n) {
    const st = store.get(KEY(p), {});
    const fresh = [], wrong = [], done = [];
    PARTS[p].items.forEach(x => {
      if (p === '1' || p === '2') {
        const r = st[x.id];
        (!r ? fresh : r.ok ? done : wrong).push(x);
      } else {
        const recs = x.questions.map((q, qi) => st[qid(x, qi)]);
        if (recs.some(r => !r)) fresh.push(x);
        else if (recs.some(r => !r.ok)) wrong.push(x);
        else done.push(x);
      }
    });
    return [...shuffle(fresh), ...shuffle(wrong), ...shuffle(done)].slice(0, n);
  }

  function saveRec(p, id, oi, ok) {
    const st = store.get(KEY(p), {});
    st[id] = { c: oi, ok };
    store.set(KEY(p), st);
  }

  /* ---------- 音檔播放器:作答前限 2 次 ---------- */
  function makePlayer(id, state) {
    state.plays = state.plays || 0;
    const audio = new Audio('audio/' + id + '.mp3');
    const label = h('span', { class: 'player-note' });
    const btn = h('button', { class: 'btn primary player-btn', type: 'button' }, '▶ 播放');
    function refresh() {
      const free = state.done;
      const left = 2 - state.plays;
      label.textContent = free ? '已作答,可重複聽' : (left > 0 ? '還可播放 ' + left + ' 次' : '播放次數用完,請作答');
      btn.disabled = !free && left <= 0;
      btn.textContent = state.plays > 0 ? '▶ 再播一次' : '▶ 播放';
    }
    btn.addEventListener('click', () => {
      if (!state.done && state.plays >= 2) return;
      state.plays++;
      audio.currentTime = 0;
      audio.play().catch(() => { label.textContent = '音檔載入失敗(audio/' + id + '.mp3)'; });
      refresh();
    });
    audio.addEventListener('error', () => { label.textContent = '找不到音檔 audio/' + id + '.mp3'; btn.disabled = true; });
    refresh();
    return { el: h('div', { class: 'player' }, btn, label), refresh, stop: () => { audio.pause(); } };
  }

  /* ---------- 路由 ---------- */
  const partParam = getParam('part');
  if (partParam && PARTS[partParam]) startSession(partParam, Number(getParam('n')) || PARTS[partParam].sizes[1]);
  else renderHome();

  /* ================= 首頁 ================= */
  function renderHome() {
    document.title = '聽力訓練|多益閱讀訓練室';
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '聽力訓練'),
      h('p', null, '作答前每題最多播 2 次,答完可以重複聽、看逐字稿。')));
    const cards = h('div', { class: 'part-cards', style: 'grid-template-columns:1fr 1fr' });
    for (const p of ['1', '2', '3', '4']) {
      const d = PARTS[p];
      const s = partStats(p);
      const pct = s.total ? Math.round(s.answered / s.total * 100) : 0;
      const sel = h('select', { class: 'cfg-select' },
        d.sizes.map(n => h('option', { value: n }, n + ' ' + d.unit)));
      cards.append(h('div', { class: 'part-card' },
        h('div', { class: 'p-label' }, 'PART ' + p),
        h('h3', null, d.title.replace(/^Part \d /, '')),
        h('p', null, d.desc),
        h('div', { class: 'p-stats' }, '已作答 ' + s.answered + '/' + s.total +
          (s.answered ? ' · 正確率 ' + Math.round(s.correct / s.answered * 100) + '%' : '')),
        h('div', { class: 'bar' }, h('i', { style: 'width:' + pct + '%' })),
        h('div', { class: 'cfg-row' }, sel,
          h('button', { class: 'btn primary', onclick: () => startSession(p, Number(sel.value)) }, '開始'))));
    }
    root.append(cards);
  }

  /* ================= 練習場 ================= */
  function startSession(p, n) {
    const d = PARTS[p];
    document.title = d.title + '|多益閱讀訓練室';
    const units = pickPool(p, n);
    if (!units.length) {
      root.innerHTML = '';
      root.append(h('div', { class: 'q-block', style: 'margin-top:30px' }, '沒有題目。'),
        h('div', { class: 'drill-nav-btns' }, h('a', { class: 'btn', href: 'listening.html' }, '回聽力')));
      return;
    }
    const sess = units.map(() => ({ done: false, answers: {}, plays: 0 }));
    const okFlags = [];
    let cur = 0;
    let player = null;
    draw();

    function draw() {
      if (player) player.stop();
      root.innerHTML = '';
      root.append(h('div', { class: 'drill-top' },
        h('h1', null, d.title, ' ', h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' }, '隨機 ' + units.length + ' ' + d.unit)),
        h('a', { href: 'listening.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回聽力')));
      const nav = h('div', { class: 'q-nav' });
      units.forEach((x, i) => {
        let cls = i === cur ? 'cur' : '';
        if (okFlags[i] === true) cls += ' ok';
        if (okFlags[i] === false) cls += ' ng';
        nav.append(h('button', { class: cls.trim(), disabled: '' }, String(i + 1)));
      });
      root.append(nav);

      const u = units[cur];
      const state = sess[cur];
      player = makePlayer(u.id, state);

      if (p === '1') drawP1(u, state);
      else if (p === '2') drawP2(u, state);
      else drawSet(u, state);
    }

    function nextRow(canNext) {
      const isLast = cur === units.length - 1;
      return h('div', { class: 'drill-nav-btns' },
        canNext
          ? h('button', {
              class: 'btn primary',
              onclick: () => { if (isLast) summary(); else { cur++; draw(); window.scrollTo(0, 0); } },
            }, isLast ? '看本輪成績' : '下一' + d.unit + ' →')
          : h('span', { class: 'result-note', style: 'align-self:center' }, '聽音檔作答後才能繼續'));
    }

    /* 字母選項鈕(選項內容只有聲音) */
    function letterButtons(count, rec, answer, onPick) {
      const row = h('div', { class: 'letter-row' });
      for (let i = 0; i < count; i++) {
        let cls = 'letter-big';
        if (rec) {
          if (i === answer) cls += ' correct';
          else if (i === rec.c) cls += ' wrong';
        }
        row.append(h('button', {
          class: cls, disabled: rec ? '' : null,
          onclick: () => onPick(i),
        }, LETTERS[i]));
      }
      return row;
    }

    function drawP1(q, state) {
      const rec = state.done ? state.answers : null;
      const img = h('img', {
        src: 'img/listening/' + q.id + '.jpg', alt: '聽力照片',
        onerror: e => e.target.replaceWith(h('div', { class: 'photo-missing' }, '照片準備中')),
      });
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'listen-photo' }, img),
        player.el,
        h('div', { class: 'q-text', style: 'margin-top:10px' }, '選出最符合照片的描述:'),
        letterButtons(4, rec, q.answer, oi => {
          state.done = true;
          state.answers = { c: oi, ok: oi === q.answer };
          okFlags[cur] = state.answers.ok;
          saveRec(p, q.id, oi, state.answers.ok);
          draw();
        }),
        rec ? reveal(q, rec, q.options.map((o, i) => LETTERS[i] + '. ' + o).join('\n')) : null));
      root.append(nextRow(state.done));
    }

    function drawP2(q, state) {
      const rec = state.done ? state.answers : null;
      root.append(h('div', { class: 'q-block' },
        player.el,
        h('div', { class: 'q-text', style: 'margin-top:10px' }, '選出最合適的回應:'),
        letterButtons(3, rec, q.answer, oi => {
          state.done = true;
          state.answers = { c: oi, ok: oi === q.answer };
          okFlags[cur] = state.answers.ok;
          saveRec(p, q.id, oi, state.answers.ok);
          draw();
        }),
        rec ? reveal(q, rec, q.question + '\n' + q.options.map((o, i) => LETTERS[i] + '. ' + o).join('\n')) : null));
      root.append(nextRow(state.done));
    }

    function reveal(q, rec, transcript) {
      return h('div', null,
        h('div', { class: 'explain' },
          h('div', { class: 'verdict ' + (rec.ok ? 'ok' : 'bad') },
            rec.ok ? '答對了' : '答錯了,正確答案是 ' + LETTERS[q.answer]),
          h('div', null, q.explanation)),
        h('div', { class: 'transcript-box' },
          h('b', null, '逐字稿'),
          h('div', { class: 'tr-en' }, transcript),
          h('div', { class: 'tr-zh' }, q.transcriptZh)));
    }

    function drawSet(set, state) {
      const block = h('div', { class: 'q-block' });
      block.append(player.el);
      const complete = set.questions.every((q, qi) => state.answers[qi] !== undefined);
      set.questions.forEach((q, qi) => {
        const chosen = state.answers[qi];
        const done = chosen !== undefined;
        const opts = h('div', { class: 'opts', style: 'margin-top:6px' });
        q.options.forEach((opt, oi) => {
          let cls = 'opt';
          if (done) {
            if (oi === q.answer) cls += ' correct';
            else if (oi === chosen) cls += ' wrong';
            else cls += ' plain';
          }
          opts.append(h('button', {
            class: cls, disabled: done ? '' : null,
            onclick: () => {
              state.answers[qi] = oi;
              saveRec(p, qid(set, qi), oi, oi === q.answer);
              const all = set.questions.every((x, xi) => state.answers[xi] !== undefined);
              if (all) {
                state.done = true;
                okFlags[cur] = set.questions.every((x, xi) => state.answers[xi] === x.answer);
              }
              draw();
            },
          }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
        });
        block.append(h('div', { style: 'margin-top:14px' },
          h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'Q' + (qi + 1)), q.q),
          opts,
          done ? h('div', { class: 'explain' },
            h('div', { class: 'verdict ' + (chosen === q.answer ? 'ok' : 'bad') },
              chosen === q.answer ? '答對了' : '答錯了,正確答案是 ' + LETTERS[q.answer]),
            h('div', null, q.explanation)) : null));
      });
      if (complete) {
        const transcript = p === '3'
          ? set.dialogue.map(t => (t.s === 'M' ? '男:' : '女:') + t.text).join('\n')
          : set.talk;
        block.append(h('div', { class: 'transcript-box' },
          h('b', null, '逐字稿'),
          h('div', { class: 'tr-en' }, transcript),
          h('div', { class: 'tr-zh' }, set.transcriptZh)));
      }
      root.append(block);
      root.append(nextRow(complete));
    }

    function summary() {
      if (player) player.stop();
      root.innerHTML = '';
      let qTotal = 0, qCorrect = 0;
      units.forEach((u, i) => {
        if (p === '1' || p === '2') {
          qTotal++;
          if (sess[i].answers.ok) qCorrect++;
        } else {
          u.questions.forEach((q, qi) => { qTotal++; if (sess[i].answers[qi] === q.answer) qCorrect++; });
        }
      });
      root.append(h('div', { class: 'report-head', style: 'margin-top:26px' },
        h('h2', null, '本輪成績:' + qCorrect + ' / ' + qTotal + ' 題'),
        h('div', { class: 'band-note' }, qTotal - qCorrect
          ? '答錯的題目會被優先抽到,改天再練一輪。'
          : '全對!換個題型再來。')));
      root.append(h('div', { class: 'drill-nav-btns' },
        h('button', { class: 'btn primary', onclick: () => startSession(p, n) }, '再練一輪'),
        h('a', { class: 'btn', href: 'listening.html' }, '回聽力')));
      window.scrollTo(0, 0);
    }
  }
})();
