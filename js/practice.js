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
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' }, '題庫尚未載入(請執行 tools/merge_data.py)。'));
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

  /* ---------- 路由 ---------- */
  const mode = getParam('mode');
  const partParam = getParam('part');
  if (mode === 'review' && DATA[partParam]) startReview(partParam);
  else if (partParam && DATA[partParam]) {
    // 相容程度檢測報告的深連結:直接開一輪隨機練習
    startQuiz(partParam, partParam === '5' ? 10 : 2, getParam('cat') || 'all');
  } else renderHome();

  /* ================= 首頁 ================= */
  function renderHome() {
    document.title = '題庫刷題|多益閱讀訓練室';
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '題庫刷題')));

    /* 隨機練習 */
    const partSel = h('select', { class: 'cfg-select' },
      ['5', '6', '7'].map(p => h('option', { value: p }, DATA[p].title)));
    const sizeSel = h('select', { class: 'cfg-select' });
    const cats = [...new Set(DATA['5'].items.map(q => q.category))];
    const catSel = h('select', { class: 'cfg-select' },
      h('option', { value: 'all' }, '全部考點'),
      cats.map(c => h('option', { value: c }, c)));
    const initCat = getParam('cat');
    if (initCat && cats.includes(initCat)) catSel.value = initCat;

    const customInput = h('input', {
      class: 'cfg-select', type: 'number', min: '1', style: 'width:92px;display:none',
      placeholder: '數量',
    });
    function sizeLabel(p, n) {
      if (p === '5') return n + ' 題';
      return n + ' 組(' + (p === '6' ? n * 4 + ' 題' : '約 ' + n * 4 + '-' + n * 5 + ' 題') + ')';
    }
    function refreshSizes() {
      const p = partSel.value;
      sizeSel.innerHTML = '';
      DATA[p].sizes.forEach(n => sizeSel.append(h('option', { value: n }, sizeLabel(p, n))));
      sizeSel.append(h('option', { value: 'custom' }, '自訂數量…'));
      catSel.style.display = p === '5' ? '' : 'none';
      customInput.style.display = 'none';
      customInput.max = String(p === '5' ? DATA['5'].items.length : DATA[p].items.length);
    }
    partSel.addEventListener('change', refreshSizes);
    sizeSel.addEventListener('change', () => {
      customInput.style.display = sizeSel.value === 'custom' ? '' : 'none';
      if (sizeSel.value === 'custom') customInput.focus();
    });
    refreshSizes();

    function chosenSize() {
      const p = partSel.value;
      const max = p === '5' ? DATA['5'].items.length : DATA[p].items.length;
      if (sizeSel.value !== 'custom') return Number(sizeSel.value);
      const n = Math.floor(Number(customInput.value));
      if (!n || n < 1) return null;
      return Math.min(n, max);
    }

    const s5 = partStats('5'), s6 = partStats('6'), s7 = partStats('7');
    const totalAnswered = s5.answered + s6.answered + s7.answered;
    const totalCorrect = s5.correct + s6.correct + s7.correct;

    root.append(h('div', { class: 'practice-panels' },
      h('div', { class: 'practice-panel' },
        h('h2', null, '隨機練習'),
        h('p', null, '共 ' + (s5.total + s6.total + s7.total) + ' 題' +
          (totalAnswered ? ' · 已作答 ' + totalAnswered + ' 題 · 正確率 ' + Math.round(totalCorrect / totalAnswered * 100) + '%' : '')),
        h('div', { class: 'cfg-row' }, partSel, sizeSel, customInput, catSel),
        h('button', {
          class: 'btn primary', style: 'margin-top:14px',
          onclick: () => {
            const n = chosenSize();
            if (!n) { customInput.focus(); return; }
            startQuiz(partSel.value, n, partSel.value === '5' ? catSel.value : 'all');
          },
        }, '開始練習')),
      h('div', { class: 'practice-panel' },
        h('h2', null, '錯題本'),
        h('p', null, '重新答對就移出。'),
        h('div', { class: 'review-rows' },
          ['5', '6', '7'].map(p => {
            const s = partStats(p);
            return h('div', { class: 'review-row' },
              h('span', null, DATA[p].title),
              h('b', { style: s.wrong ? 'color:var(--bad)' : 'color:var(--ok)' }, s.wrong + ' 題'),
              s.wrong
                ? h('button', { class: 'btn', onclick: () => startReview(p) }, '複習')
                : h('span', { style: 'font-size:13px;color:var(--ink-light)' }, '沒有錯題'));
          })))));
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
        class: cls,
        disabled: rec ? '' : null,
        onclick: () => onPick(oi),
      }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
    });
    return opts;
  }

  function explainBox(q, rec, extraTr) {
    if (!rec) return null;
    const box = h('div', { class: 'explain' },
      h('div', { class: 'verdict ' + (rec.ok ? 'ok' : 'bad') },
        rec.ok ? '答對了' : '答錯了,正確答案是 ' + LETTERS[q.answer]),
      h('div', null, q.explanation));
    if (extraTr) box.append(h('div', { class: 'tr' }, extraTr));
    return box;
  }

  function saveRec(p, id, oi, ok) {
    const st = store.get(KEY(p), {});
    st[id] = { c: oi, ok };
    store.set(KEY(p), st);
  }

  function topBar(title, sub) {
    return h('div', { class: 'drill-top' },
      h('h1', null, title, ' ', h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' }, sub || '')),
      h('a', { href: 'practice.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回題庫'));
  }

  function sessionDots(list, cur, results) {
    const nav = h('div', { class: 'q-nav' });
    list.forEach((x, i) => {
      let cls = i === cur ? 'cur' : '';
      if (results[i] === true) cls += ' ok';
      if (results[i] === false) cls += ' ng';
      nav.append(h('button', { class: cls.trim(), disabled: '' }, String(i + 1)));
    });
    return nav;
  }

  /* ================= 隨機練習 ================= */
  function startQuiz(p, n, cat) {
    const d = DATA[p];
    document.title = d.title + ' 隨機練習|多益閱讀訓練室';
    const list = pickPool(p, n, cat);
    if (!list.length) {
      root.innerHTML = '';
      root.append(topBar(d.title), h('div', { class: 'q-block' }, '這個範圍沒有題目。'));
      return;
    }
    const session = { answers: {} };   // p5: {qIdx:{c,ok}}; p6/7: {setIdx:{qKey:{c,ok}}}
    const okFlags = [];                // 每單元結果(全對=true)
    let cur = 0;
    draw();

    function draw() {
      root.innerHTML = '';
      const sub = cat && cat !== 'all' ? '考點:' + cat : '隨機 ' + list.length + ' ' + d.unit;
      root.append(topBar(d.title + ' 隨機練習', sub));
      root.append(sessionDots(list, cur, okFlags));

      if (p === '5') drawP5();
      else drawSet();
    }

    function finishBtnRow(canNext, isLast) {
      return h('div', { class: 'drill-nav-btns' },
        canNext
          ? h('button', {
              class: 'btn primary',
              onclick: () => { if (isLast) summary(); else { cur++; draw(); window.scrollTo(0, 0); } },
            }, isLast ? '看本輪成績' : '下一' + d.unit + ' →')
          : h('span', { class: 'result-note', style: 'align-self:center' }, '作答後才能前往下一' + d.unit));
    }

    function drawP5() {
      const q = list[cur];
      const rec = session.answers[cur];
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'display:flex;gap:8px;margin-bottom:10px' },
          h('span', { class: 'badge cat' }, q.category),
          h('span', { class: 'badge ' + (q.difficulty === '基礎' ? 'level-basic' : q.difficulty === '進階' ? 'level-adv' : 'level-mid') }, q.difficulty)),
        h('div', { class: 'q-text', style: 'font-size:17px' }, h('span', { class: 'q-no' }, (cur + 1) + '.'), q.question),
        optionButtons(q, rec, oi => {
          const ok = oi === q.answer;
          session.answers[cur] = { c: oi, ok };
          okFlags[cur] = ok;
          saveRec(p, q.id, oi, ok);
          draw();
        }),
        explainBox(q, rec, rec ? '句意:' + q.translation : null)));
      root.append(finishBtnRow(!!rec, cur === list.length - 1));
    }

    function drawSet() {
      const set = list[cur];
      const sess = session.answers[cur] = session.answers[cur] || {};
      const layout = h('div', { class: 'set-layout' });

      const passCol = h('div', { class: 'passage-sticky-wrap' });
      if (p === '6') passCol.append(part6Passage(set, sess));
      else set.passages.forEach(ps => passCol.append(part7Passage(ps)));

      const complete = set.questions.every((q, qi) => sess[qid(set, q, qi)]);
      const trBtn = h('button', {
        class: 'btn', style: 'margin-top:12px',
        disabled: complete ? null : '',
        onclick: () => {
          trWrap.style.display = trWrap.style.display === 'none' ? '' : 'none';
          trBtn.classList.toggle('on');
        },
      }, complete ? '顯示全文翻譯' : '作答完可看全文翻譯');
      const trWrap = h('div', { class: 'set-translation', style: 'display:none' },
        p === '6' ? set.translation : (set.translation || []).map((t, i) =>
          h('div', null, set.passages[i] && set.passages[i].label ? h('b', null, '【' + set.passages[i].label + '】\n') : null, t, i < set.translation.length - 1 ? '\n\n' : '')));
      passCol.append(trBtn, trWrap);
      layout.append(h('div', null, passCol));

      const qCol = h('div', null);
      set.questions.forEach((q, qi) => {
        const id = qid(set, q, qi);
        const rec = sess[id];
        const label = p === '6' ? '(' + q.num + ')' : 'Q' + (qi + 1);
        const text = p === '6' ? '選出最適合填入空格 (' + q.num + ') 的答案' : q.q;
        qCol.append(h('div', { class: 'q-block' },
          p === '6' && q.type ? h('div', { style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, q.type)) : null,
          h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, label), text),
          optionButtons(q, rec, oi => {
            const ok = oi === q.answer;
            sess[id] = { c: oi, ok };
            saveRec(p, id, oi, ok);
            const done = set.questions.every((x, xi) => sess[qid(set, x, xi)]);
            if (done) okFlags[cur] = set.questions.every((x, xi) => sess[qid(set, x, xi)].ok);
            draw();
          }),
          explainBox(q, rec)));
      });
      layout.append(qCol);
      root.append(layout);
      root.append(finishBtnRow(complete, cur === list.length - 1));
    }

    function summary() {
      root.innerHTML = '';
      root.append(topBar(d.title + ' 隨機練習'));
      let qTotal = 0, qCorrect = 0;
      if (p === '5') {
        qTotal = list.length;
        qCorrect = Object.values(session.answers).filter(r => r.ok).length;
      } else {
        list.forEach((set, si) => {
          const sess = session.answers[si] || {};
          set.questions.forEach((q, qi) => { qTotal++; if ((sess[qid(set, q, qi)] || {}).ok) qCorrect++; });
        });
      }
      const wrongN = qTotal - qCorrect;
      root.append(h('div', { class: 'report-head', style: 'margin-top:20px' },
        h('h2', null, '本輪成績:' + qCorrect + ' / ' + qTotal + ' 題'),
        h('div', { class: 'band-note' }, wrongN
          ? '答錯的 ' + wrongN + ' 題已收進錯題本,建議明天回來複習一次。'
          : '全對!換個題型或提高題數再練一輪吧。')));
      root.append(h('div', { class: 'drill-nav-btns' },
        h('button', { class: 'btn primary', onclick: () => startQuiz(p, n, cat) }, '再練一輪'),
        wrongN ? h('button', { class: 'btn', onclick: () => startReview(p) }, '複習錯題') : null,
        h('a', { class: 'btn', href: 'practice.html' }, '回題庫')));
      window.scrollTo(0, 0);
    }
  }

  /* ================= 錯題本 ================= */
  function startReview(p) {
    const d = DATA[p];
    document.title = d.title + ' 錯題本|多益閱讀訓練室';
    const st = store.get(KEY(p), {});
    let units;                    // p5: 題;p6/7: {set, wrongKeys}
    if (p === '5') {
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
      root.append(topBar(d.title + ' 錯題本'), h('div', { class: 'q-block' }, '目前沒有錯題,太好了。'),
        h('div', { class: 'drill-nav-btns' }, h('a', { class: 'btn', href: 'practice.html' }, '回題庫')));
      return;
    }
    const session = {};           // 單元 idx → {qKey:{c,ok}} (p5 用 {c,ok})
    const okFlags = [];
    let cur = 0, cleared = 0;
    draw();

    function draw() {
      root.innerHTML = '';
      root.append(topBar(d.title + ' 錯題本', '共 ' + units.length + ' ' + d.unit + ',答對就移出'));
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
          h('span', { class: 'badge level-mid' }, q.difficulty),
          h('span', { class: 'badge cat' }, '上次答錯')),
        h('div', { class: 'q-text', style: 'font-size:17px' }, h('span', { class: 'q-no' }, (cur + 1) + '.'), q.question),
        optionButtons(q, rec, oi => {
          const ok = oi === q.answer;
          session[cur] = { c: oi, ok };
          okFlags[cur] = ok;
          if (ok) cleared++;
          saveRec(p, q.id, oi, ok);
          draw();
        }),
        explainBox(q, rec, rec ? '句意:' + q.translation : null),
        rec && rec.ok ? h('div', { class: 'result-note', style: 'margin-top:8px;color:var(--ok)' }, '已答對,移出錯題本。') : null));
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
          h('div', { style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, '上次答錯')),
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
          rec && rec.ok ? h('div', { class: 'result-note', style: 'margin-top:8px;color:var(--ok)' }, '已答對,移出錯題本。') : null));
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
      root.append(topBar(d.title + ' 錯題本'));
      root.append(h('div', { class: 'report-head', style: 'margin-top:20px' },
        h('h2', null, '複習完成:移出 ' + cleared + ' 題'),
        h('div', { class: 'band-note' }, '還沒答對的題目會留在錯題本,隔天再回來試一次。')));
      root.append(h('div', { class: 'drill-nav-btns' },
        h('a', { class: 'btn primary', href: 'practice.html' }, '回題庫')));
      window.scrollTo(0, 0);
    }
  }

  /* ================= 文章渲染 ================= */
  function part6Passage(set, sess) {
    const box = h('div', { class: 'passage-box' },
      h('span', { class: 'p-label' }, passTypeLabel(set.passageType)));
    const frag = document.createDocumentFragment();
    String(set.passage).split(/(\{\{\d\}\})/).forEach(seg => {
      const m = seg.match(/^\{\{(\d)\}\}$/);
      if (!m) { if (seg) frag.append(document.createTextNode(seg)); return; }
      const num = Number(m[1]);
      const q = set.questions.find(x => x.num === num);
      const rec = q ? sess[qid(set, q, 0)] : null;
      if (rec) {
        frag.append(h('span', { class: 'gap-mark answered', title: rec.ok ? '' : '(答錯,顯示正解)' }, q.options[q.answer]));
      } else {
        frag.append(h('span', { class: 'gap-mark' }, '(' + num + ') ______'));
      }
    });
    box.append(h('div', null, frag));
    return box;
  }

  function part7Passage(ps) {
    return h('div', { class: 'passage-box' },
      ps.label ? h('span', { class: 'p-label' }, ps.label + ' · ' + passTypeLabel(ps.type)) : h('span', { class: 'p-label' }, passTypeLabel(ps.type)),
      h('div', null, ps.content));
  }

  function passTypeLabel(t) {
    const map = {
      email: 'E-MAIL', memo: 'MEMO 備忘錄', notice: 'NOTICE 公告', advertisement: 'AD 廣告',
      letter: 'LETTER 信件', article: 'ARTICLE 文章', instructions: '使用說明',
      'text message': '簡訊對話', 'text-message': '簡訊對話', webpage: '網頁', 'web page': '網頁',
      schedule: '行程表', invoice: '發票/訂單', form: '表單',
    };
    return map[String(t || '').toLowerCase()] || String(t || '').toUpperCase();
  }
})();
