/* 聽力刷題引擎(掛在題庫刷題頁使用):
   window.LISTEN = { PARTS, partStats, startQuiz(rootEl, config), startReview(rootEl, p) }
   - config = [{p:'1'|'2'|'3'|'4', n}] 可混合;作答前每題限播 2 次,答後解鎖+逐字稿。
   - 紀錄存 listen_p1~p4(雲端同步)。 */
(function () {
  const L = (window.TOEIC && TOEIC.listening) || null;
  if (!L || !L.p2 || !L.p2.length) { window.LISTEN = null; return; }

  const PARTS = {
    '1': { title: 'Part 1 照片描述', unit: '題', items: L.p1, sizes: [4, 8, 12] },
    '2': { title: 'Part 2 應答', unit: '題', items: L.p2, sizes: [5, 10, 25] },
    '3': { title: 'Part 3 簡短對話', unit: '組', items: L.p3, sizes: [1, 2, 3, 5] },
    '4': { title: 'Part 4 簡短獨白', unit: '組', items: L.p4, sizes: [1, 2, 3, 5] },
  };
  const KEY = p => 'listen_p' + p;
  const qid = (set, qi) => set.id + ':' + qi;

  function partStats(p) {
    const st = store.get(KEY(p), {});
    let total = 0, answered = 0, correct = 0, wrong = 0;
    if (p === '1' || p === '2') {
      total = PARTS[p].items.length;
      PARTS[p].items.forEach(q => {
        const r = st[q.id];
        if (r) { answered++; r.ok ? correct++ : wrong++; }
      });
    } else {
      PARTS[p].items.forEach(set => set.questions.forEach((q, qi) => {
        total++;
        const r = st[qid(set, qi)];
        if (r) { answered++; r.ok ? correct++ : wrong++; }
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

  function pickPool(p, n, wrongOnly) {
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
    if (wrongOnly) return shuffle(wrong);
    return [...shuffle(fresh), ...shuffle(wrong), ...shuffle(done)].slice(0, n);
  }

  function saveRec(p, id, oi, ok) {
    const st = store.get(KEY(p), {});
    st[id] = { c: oi, ok };
    store.set(KEY(p), st);
  }

  function makePlayer(id, state) {
    state.plays = state.plays || 0;
    const audio = new Audio('audio/' + id + '.mp3');
    const speedSel = h('select', { class: 'cfg-select speed-sel' },
      [['0.75', '慢速 0.75x'], ['1', '正常 1x'], ['1.25', '快速 1.25x']].map(([v, t]) => {
        const o = h('option', { value: v }, t);
        if (v === '1') o.selected = true;
        return o;
      }));
    speedSel.addEventListener('change', () => { audio.playbackRate = Number(speedSel.value); });
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
      audio.play().catch(() => { label.textContent = '音檔載入失敗'; });
      refresh();
    });
    audio.addEventListener('error', () => { label.textContent = '找不到音檔'; btn.disabled = true; });
    refresh();
    return { el: h('div', { class: 'player' }, btn, speedSel, label), refresh, stop: () => audio.pause() };
  }

  /* ================= 混合聽力練習 ================= */
  function startQuiz(root, config, opts) {
    opts = opts || {};
    const units = [];
    config.forEach(c => pickPool(c.p, c.n, opts.wrongOnly).forEach(item => units.push({ p: c.p, item })));
    if (opts.wrongOnly) config.forEach(() => {});
    if (!units.length) {
      root.innerHTML = '';
      root.append(h('div', { class: 'q-block', style: 'margin-top:20px' }, opts.wrongOnly ? '目前沒有聽力錯題。' : '沒有題目。'),
        h('div', { class: 'drill-nav-btns' }, h('a', { class: 'btn', href: 'practice.html' }, '回題庫')));
      return;
    }
    const sub = opts.wrongOnly
      ? '錯題複習 · ' + units.length + ' 單元'
      : config.map(c => 'Part ' + c.p + ' × ' + c.n + ' ' + PARTS[c.p].unit).join(' · ');
    /* 一般練習=交卷式(答完全部才對答案);錯題複習=即時對答(答對才移出) */
    const instant = !!opts.wrongOnly;
    const sess = units.map(() => ({ done: false, answers: {}, plays: 0 }));
    const okFlags = [];
    let cur = 0;
    let player = null;
    draw();

    function unitAnswered(i) {
      const u = units[i];
      if (u.p === '1' || u.p === '2') return sess[i].answers.c !== undefined;
      return u.item.questions.every((q, qi) => sess[i].answers[qi] !== undefined);
    }

    function draw() {
      if (player) player.stop();
      root.innerHTML = '';
      root.append(h('div', { class: 'drill-top' },
        h('h1', null, '聽力練習 ', h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' }, sub)),
        h('a', { href: 'practice.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回題庫')));
      const nav = h('div', { class: 'q-nav' });
      units.forEach((x, i) => {
        let cls = i === cur ? 'cur' : '';
        if (okFlags[i] === true) cls += ' ok';
        if (okFlags[i] === false) cls += ' ng';
        if (!instant && unitAnswered(i) && okFlags[i] === undefined) cls += ' ans';
        nav.append(h('button', {
          class: cls.trim(),
          disabled: instant ? '' : null,
          onclick: instant ? null : () => { cur = i; draw(); window.scrollTo(0, 0); },
        }, String(i + 1)));
      });
      root.append(nav);
      const u = units[cur];
      const state = sess[cur];
      player = makePlayer(u.item.id, state);
      if (u.p === '1') drawP1(u.item, state);
      else if (u.p === '2') drawP2(u.item, state);
      else drawSet(u.p, u.item, state);
    }

    function nextRow(canNext) {
      const isLast = cur === units.length - 1;
      if (!instant) {
        return h('div', { class: 'drill-nav-btns' },
          h('button', {
            class: 'btn primary',
            onclick: () => { if (isLast) submit(); else { cur++; draw(); window.scrollTo(0, 0); } },
          }, isLast ? '交卷對答案' : '下一' + PARTS[units[cur + 1].p].unit + ' →'),
          isLast ? null : h('button', { class: 'btn', onclick: submit }, '直接交卷'));
      }
      return h('div', { class: 'drill-nav-btns' },
        canNext
          ? h('button', {
              class: 'btn primary',
              onclick: () => { if (isLast) summary(); else { cur++; draw(); window.scrollTo(0, 0); } },
            }, isLast ? '看本輪成績' : '下一' + PARTS[units[cur + 1] ? units[cur + 1].p : units[cur].p].unit + ' →')
          : h('span', { class: 'result-note', style: 'align-self:center' }, '聽音檔作答後才能繼續'));
    }

    function letterButtons(count, rec, answer, onPick) {
      const row = h('div', { class: 'letter-row' });
      for (let i = 0; i < count; i++) {
        let cls = 'letter-big';
        if (rec) {
          if (i === answer) cls += ' correct';
          else if (i === rec.c) cls += ' wrong';
        }
        row.append(h('button', { class: cls, disabled: rec ? '' : null, onclick: () => onPick(i) }, LETTERS[i]));
      }
      return row;
    }

    /* 交卷式:只選不對答,可改選 */
    function letterPick(count, chosen, onPick) {
      const row = h('div', { class: 'letter-row' });
      for (let i = 0; i < count; i++) {
        row.append(h('button', {
          class: 'letter-big' + (chosen === i ? ' picked' : ''),
          onclick: () => onPick(i),
        }, LETTERS[i]));
      }
      return row;
    }

    function reveal(q, rec, transcript) {
      return h('div', null,
        h('div', { class: 'explain' },
          h('div', { class: 'verdict ' + (rec.ok ? 'ok' : 'bad') },
            rec.ok ? '答對了' : (rec.c === -1 ? '未作答,正確答案是 ' : '答錯了,正確答案是 ') + LETTERS[q.answer]),
          h('div', null, q.explanation)),
        h('div', { class: 'transcript-box' },
          h('b', null, '逐字稿'),
          h('div', { class: 'tr-en' }, transcript),
          h('div', { class: 'tr-zh' }, q.transcriptZh)));
    }

    function drawP1(q, state) {
      const rec = state.done ? state.answers : null;
      const img = h('img', {
        src: 'img/listening/' + q.id + '.jpg', alt: '聽力照片',
        onerror: e => e.target.replaceWith(h('div', { class: 'photo-missing' }, '照片準備中')),
      });
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, 'Part 1 照片描述')),
        h('div', { class: 'listen-photo' }, img),
        player.el,
        h('div', { class: 'q-text', style: 'margin-top:10px' }, '選出最符合照片的描述:'),
        instant
          ? letterButtons(4, rec, q.answer, oi => {
              state.done = true;
              state.answers = { c: oi, ok: oi === q.answer };
              okFlags[cur] = state.answers.ok;
              saveRec('1', q.id, oi, state.answers.ok);
              draw();
            })
          : letterPick(4, state.answers.c, oi => { state.answers.c = oi; draw(); }),
        instant && rec ? reveal(q, rec, q.options.map((o, i) => LETTERS[i] + '. ' + o).join('\n')) : null));
      root.append(nextRow(state.done));
    }

    function drawP2(q, state) {
      const rec = state.done ? state.answers : null;
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, 'Part 2 應答')),
        player.el,
        h('div', { class: 'q-text', style: 'margin-top:10px' }, '選出最合適的回應:'),
        instant
          ? letterButtons(3, rec, q.answer, oi => {
              state.done = true;
              state.answers = { c: oi, ok: oi === q.answer };
              okFlags[cur] = state.answers.ok;
              saveRec('2', q.id, oi, state.answers.ok);
              draw();
            })
          : letterPick(3, state.answers.c, oi => { state.answers.c = oi; draw(); }),
        instant && rec ? reveal(q, rec, q.question + '\n' + q.options.map((o, i) => LETTERS[i] + '. ' + o).join('\n')) : null));
      root.append(nextRow(state.done));
    }

    function drawSet(p, set, state) {
      const block = h('div', { class: 'q-block' });
      block.append(h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, PARTS[p].title)));
      block.append(player.el);
      const complete = set.questions.every((q, qi) => state.answers[qi] !== undefined);
      set.questions.forEach((q, qi) => {
        const chosen = state.answers[qi];
        const done = chosen !== undefined;
        const opts = h('div', { class: 'opts', style: 'margin-top:6px' });
        q.options.forEach((opt, oi) => {
          let cls = 'opt';
          if (instant && done) {
            if (oi === q.answer) cls += ' correct';
            else if (oi === chosen) cls += ' wrong';
            else cls += ' plain';
          } else if (!instant && chosen === oi) cls += ' picked';
          opts.append(h('button', {
            class: cls, disabled: instant && done ? '' : null,
            onclick: () => {
              state.answers[qi] = oi;
              if (instant) {
                saveRec(p, qid(set, qi), oi, oi === q.answer);
                const all = set.questions.every((x, xi) => state.answers[xi] !== undefined);
                if (all) {
                  state.done = true;
                  okFlags[cur] = set.questions.every((x, xi) => state.answers[xi] === x.answer);
                }
              }
              draw();
            },
          }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
        });
        block.append(h('div', { style: 'margin-top:14px' },
          h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'Q' + (qi + 1)), q.q),
          opts,
          instant && done ? h('div', { class: 'explain' },
            h('div', { class: 'verdict ' + (chosen === q.answer ? 'ok' : 'bad') },
              chosen === q.answer ? '答對了' : '答錯了,正確答案是 ' + LETTERS[q.answer]),
            h('div', null, q.explanation)) : null));
      });
      if (instant && complete) {
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

    /* 交卷:統一批改(未作答算錯,不寫入錯題紀錄) */
    function submit() {
      const missing = units.filter((u, i) => !unitAnswered(i)).length;
      if (missing && !confirm('還有 ' + missing + ' 個單元沒答完,確定要交卷嗎?未作答的算錯。')) return;
      units.forEach((u, i) => {
        const state = sess[i];
        state.done = true;
        if (u.p === '1' || u.p === '2') {
          if (state.answers.c !== undefined) {
            state.answers.ok = state.answers.c === u.item.answer;
            saveRec(u.p, u.item.id, state.answers.c, state.answers.ok);
          } else state.answers = { c: -1, ok: false };
          okFlags[i] = state.answers.ok;
        } else {
          let allOk = true;
          u.item.questions.forEach((q, qi) => {
            const c = state.answers[qi];
            if (c !== undefined) saveRec(u.p, qid(u.item, qi), c, c === q.answer);
            if (c !== q.answer) allOk = false;
          });
          okFlags[i] = allOk;
        }
      });
      review();
    }

    function review() {
      if (player) player.stop();
      root.innerHTML = '';
      let qTotal = 0, qCorrect = 0;
      units.forEach((u, i) => {
        if (u.p === '1' || u.p === '2') {
          qTotal++;
          if (sess[i].answers.ok) qCorrect++;
        } else {
          u.item.questions.forEach((q, qi) => { qTotal++; if (sess[i].answers[qi] === q.answer) qCorrect++; });
        }
      });
      const btns = () => h('div', { class: 'drill-nav-btns' },
        h('button', { class: 'btn primary', onclick: () => startQuiz(root, config) }, '再練一輪'),
        h('a', { class: 'btn', href: 'practice.html' }, '回題庫'));
      root.append(h('div', { class: 'report-head', style: 'margin-top:26px' },
        h('h2', null, '聽力本輪成績:' + qCorrect + ' / ' + qTotal + ' 題'),
        h('div', { class: 'band-note' }, qTotal - qCorrect ? '答錯的題目已收進聽力錯題。往下逐題看解析,音檔可以重聽。' : '全對!')));
      root.append(btns());

      /* 逐題檢討(音檔解鎖重聽) */
      units.forEach((u, i) => {
        const state = sess[i];
        const rp = makePlayer(u.item.id, state);
        if (u.p === '1') {
          const q = u.item;
          root.append(h('div', { class: 'q-block', style: 'margin-top:18px' },
            h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, 'Part 1 照片描述')),
            h('div', { class: 'listen-photo' }, h('img', {
              src: 'img/listening/' + q.id + '.jpg', alt: '聽力照片',
              onerror: e => e.target.replaceWith(h('div', { class: 'photo-missing' }, '照片準備中')),
            })),
            rp.el,
            letterButtons(4, state.answers, q.answer, () => {}),
            reveal(q, state.answers, q.options.map((o, oi) => LETTERS[oi] + '. ' + o).join('\n'))));
        } else if (u.p === '2') {
          const q = u.item;
          root.append(h('div', { class: 'q-block', style: 'margin-top:18px' },
            h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, 'Part 2 應答')),
            rp.el,
            letterButtons(3, state.answers, q.answer, () => {}),
            reveal(q, state.answers, q.question + '\n' + q.options.map((o, oi) => LETTERS[oi] + '. ' + o).join('\n'))));
        } else {
          const set = u.item;
          const block = h('div', { class: 'q-block', style: 'margin-top:18px' },
            h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, PARTS[u.p].title)),
            rp.el);
          set.questions.forEach((q, qi) => {
            const chosen = state.answers[qi];
            const rec = { c: chosen === undefined ? -1 : chosen, ok: chosen === q.answer };
            const opts = h('div', { class: 'opts', style: 'margin-top:6px' });
            q.options.forEach((opt, oi) => {
              let cls = 'opt';
              if (oi === q.answer) cls += ' correct';
              else if (oi === rec.c) cls += ' wrong';
              else cls += ' plain';
              opts.append(h('button', { class: cls, disabled: '' },
                h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
            });
            block.append(h('div', { style: 'margin-top:14px' },
              h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'Q' + (qi + 1)), q.q),
              opts,
              h('div', { class: 'explain' },
                h('div', { class: 'verdict ' + (rec.ok ? 'ok' : 'bad') },
                  rec.ok ? '答對了' : (rec.c === -1 ? '未作答,正確答案是 ' : '答錯了,正確答案是 ') + LETTERS[q.answer]),
                h('div', null, q.explanation))));
          });
          const transcript = u.p === '3'
            ? set.dialogue.map(t => (t.s === 'M' ? '男:' : '女:') + t.text).join('\n')
            : set.talk;
          block.append(h('div', { class: 'transcript-box' },
            h('b', null, '逐字稿'),
            h('div', { class: 'tr-en' }, transcript),
            h('div', { class: 'tr-zh' }, set.transcriptZh)));
          root.append(block);
        }
      });
      root.append(btns());
      window.scrollTo(0, 0);
    }

    function summary() {
      if (player) player.stop();
      root.innerHTML = '';
      let qTotal = 0, qCorrect = 0;
      units.forEach((u, i) => {
        if (u.p === '1' || u.p === '2') {
          qTotal++;
          if (sess[i].answers.ok) qCorrect++;
        } else {
          u.item.questions.forEach((q, qi) => { qTotal++; if (sess[i].answers[qi] === q.answer) qCorrect++; });
        }
      });
      root.append(h('div', { class: 'report-head', style: 'margin-top:26px' },
        h('h2', null, '聽力本輪成績:' + qCorrect + ' / ' + qTotal + ' 題'),
        h('div', { class: 'band-note' }, qTotal - qCorrect ? '答錯的題目已收進聽力錯題。' : '全對!')));
      root.append(h('div', { class: 'drill-nav-btns' },
        opts.wrongOnly ? null : h('button', { class: 'btn primary', onclick: () => startQuiz(root, config) }, '再練一輪'),
        h('a', { class: 'btn', href: 'practice.html' }, '回題庫')));
      window.scrollTo(0, 0);
    }
  }

  function startReview(root, p) {
    startQuiz(root, [{ p, n: 999 }], { wrongOnly: true });
  }

  window.LISTEN = { PARTS, partStats, startQuiz, startReview };
})();
