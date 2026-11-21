/* 聽力刷題引擎(掛在題庫刷題頁使用):
   window.LISTEN = { PARTS, partStats, startQuiz(rootEl, config), startReview(rootEl, p, g) }(g:錯題本的組名)
   - config = [{p:'1'|'2'|'3'|'4', n}] 可混合;作答前每題限播 2 次,答後解鎖+逐字稿。
   - 作答是專心模式:一般練習只記選擇、交卷後看成績卡與逐題解析;錯題複習每題作答後馬上給回饋。
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
  const listUrl = p => 'practice.html?mode=wrong&part=' + p;

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
    st[id] = { c: oi, ok, t: Date.now() };
    store.set(KEY(p), st);
    logAttempt('l' + p, id, oi, ok);
  }

  function makePlayer(id, state) {
    state.plays = state.plays || 0;
    /* 每按一次都換全新的 Audio 從第 0 秒解碼,不靠 seek 回頭:
       手機瀏覽器對 mp3 的 seek 表很脆弱,重播時容易只播一半就停。 */
    let audio = null;
    const src = 'audio/' + id + '.mp3';
    const speedSel = h('select', { class: 'cfg-select speed-sel' },
      [['0.75', '慢速 0.75x'], ['1', '正常 1x'], ['1.25', '快速 1.25x']].map(([v, t]) => {
        const o = h('option', { value: v }, t);
        if (v === '1') o.selected = true;
        return o;
      }));
    speedSel.addEventListener('change', () => { if (audio) audio.playbackRate = Number(speedSel.value); });
    const label = h('span', { class: 'player-note' });
    /* 作答畫面的實色按鈕只有底部的主按鈕,播放鈕用描邊 */
    const btn = h('button', { class: 'btn player-btn', type: 'button' }, '▶ 播放');
    function refresh() {
      const free = state.done;
      const left = 2 - state.plays;
      label.textContent = free ? '可重複播放' : (left > 0 ? '還可播放 ' + left + ' 次' : '播放次數已用完');
      btn.disabled = !free && left <= 0;
      btn.textContent = state.plays > 0 ? '▶ 再播一次' : '▶ 播放';
    }
    btn.addEventListener('click', () => {
      if (!state.done && state.plays >= 2) return;
      state.plays++;
      if (audio) audio.pause();
      audio = new Audio(src);
      audio.preload = 'auto';
      audio.playbackRate = Number(speedSel.value);
      audio.addEventListener('error', () => { label.textContent = '找不到音檔'; btn.disabled = true; });
      audio.play().catch(() => { label.textContent = '音檔載入失敗'; });
      refresh();
    });
    refresh();
    return { el: h('div', { class: 'player' }, btn, speedSel, label), refresh, stop: () => { if (audio) audio.pause(); } };
  }

  /* 專心模式的底部按鈕:文字按鈕(上一題)與實色主按鈕(gate:要登入才能做的那一下標 data-gate) */
  function textBtn(label, onClick) {
    return h('button', { class: 'btn-text', type: 'button', onclick: onClick }, label);
  }
  function mainBtn(label, onClick, gate, disabled) {
    return h('button', { class: 'btn primary', type: 'button', 'data-gate': gate ? '' : null, disabled: disabled ? '' : null, onclick: onClick }, label);
  }
  /* 作答列右邊的「交卷」與結算卡的主按鈕(會寫紀錄):標 data-gate,沒登入時 js/profile.js 先攔下 */
  const GATE = { 'data-gate': '' };
  function setSubmit(f, onClick) {
    f.action(onClick ? { label: '交卷', onClick, attrs: GATE } : null);
  }
  const answerText = (q, i) => LETTERS[i] + '. ' + q.options[i];

  /* ================= 混合聽力練習 ================= */
  /* opts.units:直接給這一輪的單元 [{ p, item }](錯題本複習,js/wrongbook.js 的 round 算好的),不呼叫 pickPool。
     opts.back:「回錯題本」的網址;opts.group:只複習的那一組(組名);opts.rest:這一組還沒輪到幾題(答錯的題數) */
  function startQuiz(root, config, opts) {
    opts = opts || {};
    const units = [];
    if (Array.isArray(opts.units)) opts.units.forEach(u => units.push(u));
    else config.forEach(c => pickPool(c.p, c.n, opts.wrongOnly).forEach(item => units.push({ p: c.p, item })));
    const back = opts.back || 'practice.html';
    /* 一般練習=交卷式(答完全部才對答案);錯題複習=即時對答(答對才移出) */
    const instant = !!opts.wrongOnly;
    if (!units.length) {
      root.replaceChildren(
        h('div', { class: 'page-head' }, h('h1', null, instant ? '聽力錯題本' : '聽力練習')),
        UI.empty({ pose: 'sleep', text: instant ? '沒有錯題' : '沒有題目', action: { label: opts.back ? '回錯題本' : '回題庫刷題', href: back } }));
      return;
    }
    const sess = units.map(() => ({ done: false, answers: {}, plays: 0 }));
    let cur = 0;
    let player = null;
    let handing = false;   // 交卷的確認視窗開著:這時再按交卷不算
    const f = UI.focus.enter({ total: units.length, onExit: () => { location.href = back; }, confirmExit: !instant, body: '還沒交卷的作答不會計分' });
    draw();

    function unitAnswered(i) {
      const u = units[i];
      if (u.p === '1' || u.p === '2') return sess[i].answers.c !== undefined;
      return u.item.questions.every((q, qi) => sess[i].answers[qi] !== undefined);
    }

    function go(i) { cur = i; draw(); window.scrollTo(0, 0); }

    /* 選了答案:重畫但捲動位置留著 */
    function repaint() {
      const y = window.scrollY;
      draw();
      window.scrollTo(0, y);
    }

    function draw() {
      if (player) player.stop();
      root.replaceChildren();
      f.progress(cur + 1);
      const u = units[cur];
      const state = sess[cur];
      player = makePlayer(u.item.id, state);
      if (u.p === '1') drawP1(u.item, state);
      else if (u.p === '2') drawP2(u.item, state);
      else drawSet(u.p, u.item, state);
    }

    /* 作答鈕、交卷鈕都標 data-gate(跟 js/practice.js 的閱讀練習一樣):開始之後別的分頁登出、換帳號,或這台的帳號資料夾還沒灌過,
       js/profile.js 在按下去之前擋下、開「重新整理」卡,不選取、不對答案、不出成績,選好的留在這一頁。「下一題」不寫東西,照常 */
    function drawFoot(canNext) {
      const isLast = cur === units.length - 1;
      if (!instant) {
        f.foot([
          cur > 0 ? textBtn('上一題', () => go(cur - 1)) : null,
          mainBtn(isLast ? '交卷' : '下一題', e => { if (isLast) submit(e.currentTarget); else go(cur + 1); }, isLast),
        ]);
        setSubmit(f, isLast ? null : e => submit(e.currentTarget));
        return;
      }
      f.foot([mainBtn(isLast ? '看成績' : '下一題', next, false, !canNext)]);
    }

    function next() {
      if (cur === units.length - 1) summary(); else go(cur + 1);
    }

    /* 單題的即時回饋(Part 1、2):回饋條寫對錯與正解,解析方塊不重複 */
    function drawFeedback(q, rec) {
      const isLast = cur === units.length - 1;
      f.feedback({ ok: rec.ok, answer: rec.ok ? null : answerText(q, q.answer), next: isLast ? '看成績' : '下一題', onNext: next });
    }

    function letterButtons(count, rec, answer, onPick) {
      const row = h('div', { class: 'letter-row' });
      for (let i = 0; i < count; i++) {
        let cls = 'letter-big';
        if (rec) {
          if (i === answer) cls += ' correct';
          else if (i === rec.c) cls += ' wrong';
        }
        row.append(h('button', { class: cls, disabled: rec ? '' : null, 'data-gate': rec ? null : '', onclick: () => onPick(i) }, LETTERS[i]));
      }
      return row;
    }

    /* 交卷式:只選不對答,可改選 */
    function letterPick(count, chosen, onPick) {
      const row = h('div', { class: 'letter-row' });
      for (let i = 0; i < count; i++) {
        row.append(h('button', {
          class: 'letter-big' + (chosen === i ? ' picked' : ''), 'data-gate': '',
          onclick: () => onPick(i),
        }, LETTERS[i]));
      }
      return row;
    }

    /* 詳解方塊底部加「回報題目」(js/report.js);m 是模組('l1'…'l4'),id 是學習記錄用的題號 */
    function withReport(box, m, id) {
      if (window.REPORT) REPORT.attach(box, { m, id, audio: true });
      return box;
    }

    /* verdict:false 時不寫「答對了」「答錯 · 正解」那一行(作答當下由底部回饋條寫) */
    function reveal(q, rec, transcript, m, verdict) {
      return h('div', null,
        withReport(h('div', { class: 'explain' },
          verdict === false ? null : h('div', { class: 'verdict ' + (rec.ok ? 'ok' : 'bad') },
            rec.ok ? '答對了' : (rec.c === -1 ? '未作答 · 正解 ' : '答錯 · 正解 ') + LETTERS[q.answer]),
          h('div', null, q.explanation)), m, q.id),
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
        h('div', { class: 'q-text', style: 'margin-top:10px' }, '選出最符合照片的描述：'),
        instant
          ? letterButtons(4, rec, q.answer, oi => {
              state.done = true;
              state.answers = { c: oi, ok: oi === q.answer };
              saveRec('1', q.id, oi, state.answers.ok);
              draw();
            })
          : letterPick(4, state.answers.c, oi => { state.answers.c = oi; f.dirty(true); repaint(); }),
        instant && rec ? reveal(q, rec, q.options.map((o, i) => LETTERS[i] + '. ' + o).join('\n'), 'l1', false) : null));
      if (instant && rec) drawFeedback(q, rec); else drawFoot(state.done);
    }

    function drawP2(q, state) {
      const rec = state.done ? state.answers : null;
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, 'Part 2 應答')),
        player.el,
        h('div', { class: 'q-text', style: 'margin-top:10px' }, '選出最合適的回應：'),
        instant
          ? letterButtons(3, rec, q.answer, oi => {
              state.done = true;
              state.answers = { c: oi, ok: oi === q.answer };
              saveRec('2', q.id, oi, state.answers.ok);
              draw();
            })
          : letterPick(3, state.answers.c, oi => { state.answers.c = oi; f.dirty(true); repaint(); }),
        instant && rec ? reveal(q, rec, q.question + '\n' + q.options.map((o, i) => LETTERS[i] + '. ' + o).join('\n'), 'l2', false) : null));
      if (instant && rec) drawFeedback(q, rec); else drawFoot(state.done);
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
            class: cls, disabled: instant && done ? '' : null, 'data-gate': instant && done ? null : '',
            onclick: () => {
              state.answers[qi] = oi;
              if (instant) {
                saveRec(p, qid(set, qi), oi, oi === q.answer);
                const all = set.questions.every((x, xi) => state.answers[xi] !== undefined);
                if (all) state.done = true;
                draw();
              } else {
                f.dirty(true);
                repaint();
              }
            },
          }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
        });
        block.append(h('div', { style: 'margin-top:14px' },
          h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'Q' + (qi + 1)), q.q),
          opts,
          instant && done ? withReport(h('div', { class: 'explain' },
            h('div', { class: 'verdict ' + (chosen === q.answer ? 'ok' : 'bad') },
              chosen === q.answer ? '答對了' : '答錯 · 正解 ' + LETTERS[q.answer]),
            h('div', null, q.explanation)), 'l' + p, qid(set, qi)) : null));
      });
      if (instant && complete) {
        const transcript = p === '3'
          ? set.dialogue.map(t => (t.s === 'M' ? '男：' : '女：') + t.text).join('\n')
          : set.talk;
        block.append(h('div', { class: 'transcript-box' },
          h('b', null, '逐字稿'),
          h('div', { class: 'tr-en' }, transcript),
          h('div', { class: 'tr-zh' }, set.transcriptZh)));
      }
      root.append(block);
      drawFoot(complete);
    }

    /* 單元名稱:Part 1、2 是「題」,題組是「組」,混在一起就叫單元 */
    function unitWord(list) {
      const single = u => u.p === '1' || u.p === '2';
      return list.every(single) ? '題' : list.every(u => !single(u)) ? '組' : '個單元';
    }

    /* 交卷:統一批改(未作答算錯,不寫入錯題紀錄) */
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
      /* 確認視窗開著的時候別的分頁登出、帳號資料夾變成還沒灌過:問完再查一次,擋下就開「重新整理」卡、不批改,選好的留著
         (跟 js/practice.js 隨機練習的交卷一樣) */
      if (typeof holdForAccount === 'function' && holdForAccount(opener)) return;
      units.forEach((u, i) => {
        const state = sess[i];
        state.done = true;
        if (u.p === '1' || u.p === '2') {
          if (state.answers.c !== undefined) {
            state.answers.ok = state.answers.c === u.item.answer;
            saveRec(u.p, u.item.id, state.answers.c, state.answers.ok);
          } else state.answers = { c: -1, ok: false };
        } else {
          u.item.questions.forEach((q, qi) => {
            const c = state.answers[qi];
            if (c !== undefined) saveRec(u.p, qid(u.item, qi), c, c === q.answer);
          });
        }
      });
      review();
    }

    /* 這一輪答對幾題、共幾題;錯在哪幾個 Part */
    function tally() {
      let qTotal = 0, qCorrect = 0;
      const wrongParts = new Set();
      units.forEach((u, i) => {
        if (u.p === '1' || u.p === '2') {
          qTotal++;
          if (sess[i].answers.ok) qCorrect++; else wrongParts.add(u.p);
        } else {
          u.item.questions.forEach((q, qi) => { qTotal++; if (sess[i].answers[qi] === q.answer) qCorrect++; else wrongParts.add(u.p); });
        }
      });
      return { qTotal, qCorrect, wrongParts };
    }

    function showResult(card, detail) {
      root.replaceChildren(card.el);
      if (detail) root.append(detail);
      window.scrollTo(0, 0);
      card.heading.focus({ preventScroll: true });
    }

    function review() {
      if (player) player.stop();
      f.leave();
      const { qTotal, qCorrect, wrongParts } = tally();
      const wrongN = qTotal - qCorrect;
      /* 只有一個 Part 有錯題就直接看那個 Part 的錯題本,多個 Part 去錯題本首頁 */
      const wbHref = wrongParts.size === 1 ? listUrl([...wrongParts][0]) : 'review.html';
      const parts = [...new Set(config.map(c => c.p))];
      const card = UI.result({
        kicker: parts.length === 1 ? '聽力 ' + PARTS[parts[0]].title : '聽力 Part ' + parts.join('、'),
        score: qCorrect, total: qTotal,
        stats: wrongN ? [['收進錯題本', wrongN + ' 題']] : null,
        primary: { label: '再做一次', onClick: () => { card.destroy(); startQuiz(root, config); }, attrs: GATE },   // 跟「開始」一樣
        links: [wrongN ? { label: '看錯題本', href: wbHref } : null, { label: '回題庫刷題', href: 'practice.html' }],
        earnId: 'l' + config[0].p,
      });
      showResult(card, UI.detail('逐題解析 ' + qTotal + ' 題', reviewBlocks(), { wrong: wrongN }));
    }

    /* 逐題檢討(音檔解鎖重聽) */
    function reviewBlocks() {
      return units.map((u, i) => {
        const state = sess[i];
        const rp = makePlayer(u.item.id, state);
        if (u.p === '1') {
          const q = u.item;
          return h('div', { class: 'q-block' },
            h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, 'Part 1 照片描述')),
            h('div', { class: 'listen-photo' }, h('img', {
              src: 'img/listening/' + q.id + '.jpg', alt: '聽力照片',
              onerror: e => e.target.replaceWith(h('div', { class: 'photo-missing' }, '照片準備中')),
            })),
            rp.el,
            letterButtons(4, state.answers, q.answer, () => {}),
            reveal(q, state.answers, q.options.map((o, oi) => LETTERS[oi] + '. ' + o).join('\n'), 'l1'));
        }
        if (u.p === '2') {
          const q = u.item;
          return h('div', { class: 'q-block' },
            h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, 'Part 2 應答')),
            rp.el,
            letterButtons(3, state.answers, q.answer, () => {}),
            reveal(q, state.answers, q.question + '\n' + q.options.map((o, oi) => LETTERS[oi] + '. ' + o).join('\n'), 'l2'));
        }
        const set = u.item;
        const block = h('div', { class: 'q-block' },
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
            withReport(h('div', { class: 'explain' },
              h('div', { class: 'verdict ' + (rec.ok ? 'ok' : 'bad') },
                rec.ok ? '答對了' : (rec.c === -1 ? '未作答 · 正解 ' : '答錯 · 正解 ') + LETTERS[q.answer]),
              h('div', null, q.explanation)), 'l' + u.p, qid(set, qi))));
        });
        const transcript = u.p === '3'
          ? set.dialogue.map(t => (t.s === 'M' ? '男：' : '女：') + t.text).join('\n')
          : set.talk;
        block.append(h('div', { class: 'transcript-box' },
          h('b', null, '逐字稿'),
          h('div', { class: 'tr-en' }, transcript),
          h('div', { class: 'tr-zh' }, set.transcriptZh)));
        return block;
      });
    }

    function summary() {
      if (player) player.stop();
      f.leave();
      const { qTotal, qCorrect } = tally();
      const rest = opts.wrongOnly && opts.units ? opts.rest || 0 : 0;
      const again = 'practice.html?mode=review&part=' + config[0].p + (opts.group ? '&g=' + encodeURIComponent(opts.group) : '');
      const card = UI.result({
        kicker: (window.WRONGBOOK ? WRONGBOOK.TITLE[config[0].p] : '聽力 ' + PARTS[config[0].p].title) + ' 錯題本',
        score: qCorrect, total: qTotal,
        stats: rest > 0 ? [['還沒複習', rest + ' 題']] : null,
        primary: rest > 0 ? { label: '下一回', href: again, attrs: GATE } : { label: '回錯題本', href: back, attrs: GATE },
        links: rest > 0 ? [{ label: '回錯題本', href: back }] : [],
        earnId: opts.wrongOnly ? 'pr' : 'l' + config[0].p,
      });
      showResult(card);
    }
  }

  /* 錯題本複習(practice.html?mode=review&part=1~4&g=組名):單元從 js/wrongbook.js 的 round 來(含模擬考答錯的題,一回有上限,
     題組裡任何一題錯就算,只答一半的題組也在);沒載到就照以前從刷題紀錄挑 */
  function startReview(root, p, g) {
    const W = window.WRONGBOOK;
    if (!W) { startQuiz(root, [{ p, n: 999 }], { wrongOnly: true }); return; }
    document.title = '聽力 ' + PARTS[p].title + ' 錯題本 - 衝衝英文';
    const r = W.round(p, g || null);
    startQuiz(root, [{ p, n: r.units.length }], { wrongOnly: true, units: r.units.map(item => ({ p, item })),
      back: listUrl(p), group: g || '', rest: r.rest });
  }

  window.LISTEN = { PARTS, partStats, startQuiz, startReview };
})();
