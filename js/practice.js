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
    startQuiz([{ p: partParam, n: partParam === '5' ? 10 : 2, cat: getParam('cat') || 'all' }]);
  } else renderHome();

  /* ================= 首頁 ================= */
  function renderHome() {
    document.title = '題庫刷題|刷刷英文';
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '題庫刷題')));

    /* 隨機練習:三個 Part 各一列(勾選+數量),可同時勾多個混合出題 */
    const cats = [...new Set(DATA['5'].items.map(q => q.category))];
    const initCat = getParam('cat');

    function sizeLabel(p, n) {
      if (p === '5') return n + ' 題';
      return n + ' 組(' + (p === '6' ? n * 4 + ' 題' : '約 ' + n * 4 + '-' + n * 5 + ' 題') + ')';
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

    root.append(h('div', { class: 'practice-panels' },
      h('div', { class: 'practice-panel' },
        h('h2', null, '隨機練習'),
        h('p', null, '勾選要練的題型,可以同時勾好幾個。共 ' + (s5.total + s6.total + s7.total) + ' 題' +
          (totalAnswered ? ' · 已作答 ' + totalAnswered + ' 題 · 正確率 ' + Math.round(totalCorrect / totalAnswered * 100) + '%' : '')),
        h('div', { class: 'cfg-rows' }, rows.map(r => r.row)),
        h('button', {
          class: 'btn primary', style: 'margin-top:14px',
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
          }),
          window.LISTEN ? ['1', '2', '3', '4'].map(p => {
            const s = LISTEN.partStats(p);
            return h('div', { class: 'review-row' },
              h('span', null, '聽力 ' + LISTEN.PARTS[p].title),
              h('b', { style: s.wrong ? 'color:var(--bad)' : 'color:var(--ok)' }, s.wrong + ' 題'),
              s.wrong
                ? h('button', { class: 'btn', onclick: () => { root.innerHTML = ''; LISTEN.startReview(root, p); window.scrollTo(0, 0); } }, '複習')
                : h('span', { style: 'font-size:13px;color:var(--ink-light)' }, '沒有錯題'));
          }) : null))));

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
        h('p', null, '作答前每題最多播 2 次,答完可重聽、看逐字稿。'),
        h('div', { class: 'cfg-rows' }, lrows.map(r => r.row)),
        h('button', {
          class: 'btn primary', style: 'margin-top:14px',
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

  /* ================= 隨機練習(config=[{p,n,cat}],可混合多個 Part) ================= */
  function startQuiz(config) {
    document.title = '隨機練習|刷刷英文';
    const units = [];   // {p, item}:p5 的 item=題目,p6/7 的 item=題組
    config.forEach(c => pickPool(c.p, c.n, c.cat).forEach(item => units.push({ p: c.p, item })));
    if (!units.length) {
      root.innerHTML = '';
      root.append(topBar('隨機練習'), h('div', { class: 'q-block' }, '這個範圍沒有題目。'),
        h('div', { class: 'drill-nav-btns' }, h('a', { class: 'btn', href: 'practice.html' }, '回題庫')));
      return;
    }
    const sub = config.map(c =>
      'Part ' + c.p + ' × ' + c.n + ' ' + DATA[c.p].unit + (c.cat && c.cat !== 'all' ? '(' + c.cat + ')' : '')).join(' · ');
    const session = { answers: {} };   // p5 單元:{c,ok};p6/7 單元:{qKey:{c,ok}}
    const okFlags = [];
    let cur = 0;
    draw();

    function draw() {
      root.innerHTML = '';
      root.append(topBar('隨機練習', sub));
      root.append(sessionDots(units, cur, okFlags));
      if (units[cur].p === '5') drawP5();
      else drawSet();
    }

    function finishBtnRow(canNext, isLast) {
      const nextWord = isLast ? '' : DATA[units[cur + 1].p].unit;
      return h('div', { class: 'drill-nav-btns' },
        canNext
          ? h('button', {
              class: 'btn primary',
              onclick: () => { if (isLast) summary(); else { cur++; draw(); window.scrollTo(0, 0); } },
            }, isLast ? '看本輪成績' : '下一' + nextWord + ' →')
          : h('span', { class: 'result-note', style: 'align-self:center' }, '作答後才能繼續'));
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
        optionButtons(q, rec, oi => {
          const ok = oi === q.answer;
          session.answers[cur] = { c: oi, ok };
          okFlags[cur] = ok;
          saveRec('5', q.id, oi, ok);
          draw();
        }),
        explainBox(q, rec, rec ? '句意:' + q.translation : null)));
      root.append(finishBtnRow(!!rec, cur === units.length - 1));
    }

    function drawSet() {
      const p = units[cur].p;
      const set = units[cur].item;
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
      qCol.append(h('div', { style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, DATA[p].title)));
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
      root.append(finishBtnRow(complete, cur === units.length - 1));
    }

    function summary() {
      root.innerHTML = '';
      root.append(topBar('隨機練習', sub));
      let qTotal = 0, qCorrect = 0;
      units.forEach((u, i) => {
        if (u.p === '5') {
          qTotal++;
          if ((session.answers[i] || {}).ok) qCorrect++;
        } else {
          const sess = session.answers[i] || {};
          u.item.questions.forEach((q, qi) => { qTotal++; if ((sess[qid(u.item, q, qi)] || {}).ok) qCorrect++; });
        }
      });
      const wrongN = qTotal - qCorrect;
      root.append(h('div', { class: 'report-head', style: 'margin-top:20px' },
        h('h2', null, '本輪成績:' + qCorrect + ' / ' + qTotal + ' 題'),
        h('div', { class: 'band-note' }, wrongN
          ? '答錯的 ' + wrongN + ' 題已收進錯題本,建議明天回來複習一次。'
          : '全對!換個題型或提高題數再練一輪吧。')));
      root.append(h('div', { class: 'drill-nav-btns' },
        h('button', { class: 'btn primary', onclick: () => startQuiz(config) }, '再練一輪'),
        wrongN && config.length === 1 ? h('button', { class: 'btn', onclick: () => startReview(config[0].p) }, '複習錯題') : null,
        h('a', { class: 'btn', href: 'practice.html' }, '回題庫')));
      window.scrollTo(0, 0);
    }
  }

  /* ================= 錯題本 ================= */
  function startReview(p) {
    const d = DATA[p];
    document.title = d.title + ' 錯題本|刷刷英文';
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
      else if (b.t === 'list') wrap.append(h('ul', { class: 'ps-list' }, ...(b.items || []).map(it => h('li', null, it))));
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

  function passTypeLabel(t) {
    const map = {
      email: 'E-MAIL', memo: 'MEMO 備忘錄', notice: 'NOTICE 公告', advertisement: 'AD 廣告',
      letter: 'LETTER 信件', article: 'ARTICLE 文章', instructions: '使用說明',
      'text message': '簡訊對話', 'text-message': '簡訊對話', 'text_message': '簡訊對話', 'text message chain': '簡訊對話',
      webpage: '網頁', 'web page': '網頁',
      schedule: '行程表', invoice: '發票/訂單', form: '表單', 'order form': '訂購單',
      coupon: '優惠券', menu: '菜單', itinerary: '行程表', receipt: '收據', flyer: '傳單',
      'sign-up form': '報名表', review: '評論', 'job advertisement': '徵才廣告',
    };
    return map[String(t || '').toLowerCase()] || String(t || '').toUpperCase();
  }
})();
