/* 程度檢測:28 題鑑別卷。過程不對答案,交卷後產生「會了什麼/還不會什麼」報告。 */
(function () {
  const root = $('#diag-root');
  const D = (window.TOEIC && TOEIC.diagnostic) || null;

  if (!D || !D.p5 || !D.p6 || !D.p7) {
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' },
      '檢測題庫尚未載入。請確認 data/diagnostic.js 存在(執行 tools/merge_data.py 產生)。'));
    return;
  }

  /* 攤平 28 題:每題 {kind, category, difficulty, skill, options, answer, explanation, text, passage} */
  const items = [];
  D.p5.forEach(q => items.push({
    kind: 'p5', category: q.category, difficulty: q.difficulty, skill: q.skill,
    text: q.question, options: q.options, answer: q.answer, explanation: q.explanation, translation: q.translation,
  }));
  D.p6.questions.forEach(q => items.push({
    kind: 'p6', category: q.category, difficulty: q.difficulty, skill: q.skill,
    text: '選出最適合填入空格 (' + q.num + ') 的答案', num: q.num,
    options: q.options, answer: q.answer, explanation: q.explanation,
  }));
  D.p7.questions.forEach(q => items.push({
    kind: 'p7', category: q.category, difficulty: q.difficulty, skill: q.skill,
    text: q.q, options: q.options, answer: q.answer, explanation: q.explanation,
  }));

  const KEY = 'diag';
  let st = store.get(KEY, null);   // {answers:{i:choice}, done, startedAt, finishedAt}
  let cur = 0;

  if (st && st.done) renderReport();
  else if (st) renderTest();
  else renderIntro();

  /* ============ 說明頁 ============ */
  function renderIntro() {
    root.innerHTML = '';
    const p = window.PROFILE && PROFILE.current();
    root.append(
      h('div', { class: 'page-head' },
        h('h1', null, '程度檢測')),
      h('div', { class: 'diag-intro' },
        h('ul', { style: 'margin-top:0' },
          h('li', null, '28 題,約 20 分鐘。作答中不顯示對錯,交卷後有報告。'),
          h('li', null, '可以往回改答案;中途離開,進度會保留。')),
        h('button', {
          class: 'btn primary', style: 'font-size:16px;padding:10px 26px',
          onclick: () => {
            st = { answers: {}, done: false, startedAt: new Date().toISOString() };
            store.set(KEY, st);
            cur = 0;
            renderTest();
          },
        }, '開始檢測')));
  }

  /* ============ 作答 ============ */
  function renderTest() {
    root.innerHTML = '';
    const total = items.length;
    const answered = Object.keys(st.answers).length;
    const it = items[cur];

    root.append(h('div', { class: 'page-head' }, h('h1', null, '程度檢測')));
    root.append(h('div', { class: 'diag-count' }, '第 ', h('b', null, String(cur + 1)), ' / ' + total + ' 題 · 已作答 ' + answered + ' 題'));
    root.append(h('div', { class: 'diag-bar' }, h('i', { style: 'width:' + Math.round(answered / total * 100) + '%' })));

    /* 題號導覽 */
    const nav = h('div', { class: 'q-nav' });
    items.forEach((x, i) => {
      let cls = i === cur ? 'cur' : '';
      if (st.answers[i] !== undefined) cls += ' ok';
      nav.append(h('button', { class: cls.trim(), onclick: () => { cur = i; renderTest(); } }, String(i + 1)));
    });
    root.append(nav);

    /* 篇章(p6/p7) */
    if (it.kind === 'p6') {
      const box = h('div', { class: 'passage-box', style: 'position:static;max-height:none;margin-bottom:14px' },
        h('span', { class: 'p-label' }, '段落填空|依前後文選出最適合的答案'));
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
        class: 'opt' + (chosen === oi ? ' sel' : ''),
        onclick: () => {
          st.answers[cur] = oi;
          store.set(KEY, st);
          if (cur < total - 1) cur++;
          renderTest();
        },
      }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
    });
    root.append(h('div', { class: 'q-block' },
      h('div', { class: 'q-text', style: 'font-size:17px' }, it.text),
      opts));

    /* 導航 */
    const unanswered = total - Object.keys(st.answers).length;
    root.append(h('div', { class: 'drill-nav-btns' },
      h('button', { class: 'btn', disabled: cur === 0 ? '' : null, onclick: () => { cur--; renderTest(); } }, '← 上一題'),
      h('button', { class: 'btn', disabled: cur >= total - 1 ? '' : null, onclick: () => { cur++; renderTest(); } }, '下一題 →'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          if (unanswered > 0 && !confirm('還有 ' + unanswered + ' 題沒作答,未作答會列入「答錯」計算。確定交卷?')) return;
          st.done = true;
          st.finishedAt = new Date().toISOString();
          store.set(KEY, st);
          window.scrollTo(0, 0);
          renderReport();
        },
      }, '交卷,看報告')));
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

  function renderReport() {
    root.innerHTML = '';
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

    const est = bandEstimate(aB, aM, aA, score / total);
    const band = est.band, advice = est.advice;
    const readNote = (readT && (readC / readT) < Math.min(aB, aM) - 0.2)
      ? '另外:你的篇章題(段落填空/閱讀理解)正確率明顯低於單句題,代表單點文法會、但放進文章脈絡就抓不到——閱讀訓練模組會特別有幫助。' : '';

    root.append(h('div', { class: 'page-head' }, h('h1', null, '檢測報告')));

    root.append(h('div', { class: 'report-head' },
      h('div', { class: 'who' }, (p ? p.name + ' · ' : '') + (st.finishedAt || '').slice(0, 10)),
      h('h2', null, '答對 ' + score + ' / ' + total + ' 題'),
      h('div', { class: 'band-line' },
        h('div', { class: 'item' }, h('b', null, band), h('span', null, '閱讀參考級距(估計)')),
        h('div', { class: 'item' }, h('b', null, Math.round(aB * 100) + '%'), h('span', null, '基礎題正確率')),
        h('div', { class: 'item' }, h('b', null, Math.round(aM * 100) + '%'), h('span', null, '中級題正確率')),
        h('div', { class: 'item' }, h('b', null, Math.round(aA * 100) + '%'), h('span', null, '進階題正確率'))),
      h('div', { class: 'band-note' }, '28 題屬小樣本,級距為粗略定位、刻意放寬,僅供安排練習順序;與正式多益成績可能有明顯落差。')));

    /* 考點總表 */
    root.append(h('div', { class: 'exercise-head' }, h('span', { class: 'ex-no' }, '報告 1'), h('h2', null, '各考點掌握度')));
    const sorted = Object.entries(cats).sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total));
    const table = h('table', { class: 'cat-table' },
      h('tr', null, h('th', null, '考點'), h('th', null, '答對'), h('th', null, '判定'), h('th', { class: 'no-print' }, '')));
    sorted.forEach(([cat, c]) => {
      const [cls, label] = judge(c.correct / c.total);
      table.append(h('tr', null,
        h('td', null, cat),
        h('td', { class: 'num' }, c.correct + ' / ' + c.total),
        h('td', null, h('span', { class: 'verdict-pill ' + cls }, label), c.total === 1 ? h('span', { style: 'font-size:12px;color:var(--ink-light)' }, '(僅1題)') : null),
        h('td', { class: 'no-print' }, cls !== 'good' ? h('a', { href: catLink(cat, c.kind), style: 'font-size:13px' }, '去刷這類題 →') : '')));
    });
    root.append(table);

    /* 會了/還不會 */
    const good = sorted.filter(([, c]) => c.correct / c.total >= 0.8);
    const weak = sorted.filter(([, c]) => c.correct / c.total < 0.8);
    root.append(h('div', { class: 'exercise-head' }, h('span', { class: 'ex-no' }, '報告 2'), h('h2', null, '你可能已經會的')));
    root.append(good.length
      ? h('ul', { class: 'skill-list good' }, good.map(([cat, c]) =>
          h('li', null, cat,
            h('span', { class: 'why' }, c.items.filter(i => st.answers[i] === items[i].answer).map(i => items[i].skill).filter(Boolean).slice(0, 2).join(';') || '此類題目全數答對'))))
      : h('p', { class: 'result-note' }, '這次檢測中還沒有達到「穩固」的考點——別擔心,這正是檢測的目的,下面告訴你從哪裡開始。'));

    root.append(h('div', { class: 'exercise-head' }, h('span', { class: 'ex-no' }, '報告 3'), h('h2', null, '還不穩的地方(逐題分析)')));
    const wrongs = items.map((it, i) => ({ it, i })).filter(x => st.answers[x.i] !== x.it.answer);
    if (!wrongs.length) {
      root.append(h('p', { class: 'result-note' }, '全部答對,沒有錯題可以分析。直接進入題庫維持手感吧。'));
    }
    wrongs.forEach(({ it, i }) => {
      const chosen = st.answers[i];
      root.append(h('div', { class: 'wrong-item' },
        h('div', { class: 'w-meta' },
          h('span', { class: 'q-no' }, 'Q' + (i + 1)),
          h('span', { class: 'badge cat' }, it.category),
          h('span', { class: 'badge ' + (it.difficulty === '基礎' ? 'level-basic' : it.difficulty === '進階' ? 'level-adv' : 'level-mid') }, it.difficulty)),
        h('div', { class: 'w-q' }, it.text),
        h('div', { class: 'w-ans' },
          chosen === undefined
            ? h('span', { class: 'you' }, '未作答')
            : h('span', null, '你選 ', h('span', { class: 'you' }, LETTERS[chosen] + '. ' + it.options[chosen])),
          '  ',
          h('span', null, '正解 ', h('span', { class: 'right' }, LETTERS[it.answer] + '. ' + it.options[it.answer]))),
        it.skill ? h('div', { class: 'w-skill' }, '這題在測:' + it.skill) : null,
        h('div', { class: 'w-exp' }, it.explanation)));
    });

    /* 建議 */
    root.append(h('div', { class: 'exercise-head' }, h('span', { class: 'ex-no' }, '報告 4'), h('h2', null, '建議的練習順序')));
    const stepList = h('ol', null);
    weak.slice(0, 4).forEach(([cat, c]) => {
      stepList.append(h('li', null,
        h('a', { href: catLink(cat, c.kind) }, cat),
        '(答對 ' + c.correct + '/' + c.total + ')——先刷 15–20 題,錯的隔天用「答錯」篩選重刷一次。'));
    });
    stepList.append(h('li', null, h('a', { href: 'reading.html' }, '閱讀訓練'), '每週 2 篇:先不看翻譯讀完、做完抓重點題,再開對照翻譯逐段核對,順手把不會的單字點成填空練習。'));
    root.append(h('div', { class: 'next-steps' }, h('p', null, advice + (readNote ? ' ' + readNote : '')), stepList));

    /* 動作 */
    root.append(h('div', { class: 'drill-nav-btns no-print' },
      h('button', { class: 'btn primary', onclick: () => window.print() }, '列印/存成 PDF'),
      h('button', {
        class: 'btn',
        onclick: () => {
          if (!confirm('重新檢測會清除這份報告(刷題與閱讀進度不受影響)。確定?')) return;
          store.remove(KEY);
          st = null; cur = 0;
          renderIntro();
        },
      }, '重新檢測')));
  }
})();
