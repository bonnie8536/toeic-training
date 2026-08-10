/* 能力分析:整合檢測+刷題+閱讀+寫作的所有紀錄,產出
   ①預測分數帶 ②考點強弱項 ③錯題分類 ④學習量。全部由本人紀錄即時計算。 */
(function () {
  const root = $('#analysis-root');

  function qid(set, q, qi) { return set.id + ':' + (q.num !== undefined ? q.num : qi); }
  const diagItems = (window.TOEIC && TOEIC.diagnostic)
    ? [...TOEIC.diagnostic.p5, ...TOEIC.diagnostic.p6.questions, ...TOEIC.diagnostic.p7.questions]
    : [];

  /* ---------- 蒐集所有作答紀錄 ---------- */
  function collect() {
    const rec = { total: 0, correct: 0, diff: { '基礎': { c: 0, t: 0 }, '中級': { c: 0, t: 0 }, '進階': { c: 0, t: 0 } },
                  cats: {}, parts: {}, sources: [] };
    function addCat(cat, ok, go) {
      if (!cat) return;
      const c = rec.cats[cat] = rec.cats[cat] || { c: 0, t: 0, go };
      c.t++; if (ok) c.c++;
    }
    function addDiff(d, ok) {
      if (rec.diff[d]) { rec.diff[d].t++; if (ok) rec.diff[d].c++; }
    }

    /* 檢測 */
    const diag = store.get('diag', null);
    if (diag && diag.done && diagItems.length) {
      let n = 0, ok = 0;
      diagItems.forEach((it, i) => {
        const good = diag.answers && diag.answers[i] === it.answer;
        n++; if (good) ok++;
        addDiff(it.difficulty, good);
        const go = it.kind === undefined
          ? (['主旨題', '細節題', '推論題', '同義詞題'].includes(it.category) ? { part: '7' }
            : ['上下文文法', '字彙', '句子插入'].includes(it.category) ? { part: '6' }
            : { part: '5', cat: it.category })
          : null;
        addCat(it.category, good, go);
      });
      rec.total += n; rec.correct += ok;
      rec.sources.push('程度檢測 ' + n + ' 題');
    }

    /* 刷題 P5 */
    const p5ById = {};
    (TOEIC.part5 || []).forEach(q => { p5ById[q.id] = q; });
    const st5 = store.get('drill_p5', {});
    let n5 = 0, ok5 = 0;
    Object.entries(st5).forEach(([id, r]) => {
      const q = p5ById[id];
      if (!q || !r) return;
      n5++; if (r.ok) ok5++;
      addDiff(q.difficulty, r.ok);
      addCat(q.category, r.ok, { part: '5', cat: q.category });
    });
    rec.total += n5; rec.correct += ok5;
    rec.parts['5'] = { n: n5, ok: ok5 };
    if (n5) rec.sources.push('Part 5 刷題 ' + n5 + ' 題');

    /* 刷題 P6(依題型)與 P7 */
    for (const p of ['6', '7']) {
      const st = store.get('drill_p' + p, {});
      let n = 0, ok = 0;
      (TOEIC['part' + p] || []).forEach(set => set.questions.forEach((q, qi) => {
        const r = st[qid(set, q, qi)];
        if (!r) return;
        n++; if (r.ok) ok++;
        if (p === '6' && q.type) addCat(q.type, r.ok, { part: '6' });
      }));
      rec.total += n; rec.correct += ok;
      rec.parts[p] = { n, ok };
      if (n) rec.sources.push('Part ' + p + ' 刷題 ' + n + ' 題');
    }
    return rec;
  }

  /* ---------- 錯題分類 ---------- */
  function wrongGroups() {
    const out = [];
    const p5ById = {};
    (TOEIC.part5 || []).forEach(q => { p5ById[q.id] = q; });
    const st5 = store.get('drill_p5', {});
    const byCat = {};
    Object.entries(st5).forEach(([id, r]) => {
      const q = p5ById[id];
      if (q && r && !r.ok) (byCat[q.category] = byCat[q.category] || []).push(q);
    });
    if (Object.keys(byCat).length) out.push({ part: '5', title: 'Part 5 單句填空', groups: byCat });

    for (const p of ['6', '7']) {
      const st = store.get('drill_p' + p, {});
      const byG = {};
      (TOEIC['part' + p] || []).forEach((set, si) => set.questions.forEach((q, qi) => {
        const r = st[qid(set, q, qi)];
        if (r && !r.ok) {
          const g = p === '6' ? (q.type || '其他') : '題組 ' + (si + 1);
          (byG[g] = byG[g] || []).push(p === '6' ? { question: '題組 ' + (si + 1) + ' 第 ' + q.num + ' 格' } : { question: q.q });
        }
      }));
      if (Object.keys(byG).length) out.push({ part: p, title: 'Part ' + p + (p === '6' ? ' 段落填空' : ' 閱讀理解'), groups: byG });
    }
    return out;
  }

  /* ---------- 學習量 ---------- */
  function volume() {
    let vocab = 0, vocabTotal = 0, readQ = 0;
    (TOEIC.articles || []).forEach(a => {
      a.paragraphs.forEach(p => { vocabTotal += (p.en.match(/\[\[/g) || []).length; });
      vocab += Object.keys(store.get('vocab_' + a.id, {})).length;
      readQ += Object.keys(store.get('read_q_' + a.id, {})).length;
    });
    let wDone = 0, wTotal = 0;
    if (window.TOEIC && TOEIC.writing && TOEIC.writing.l1) {
      const W = TOEIC.writing;
      const read = store.get('writing_read', {});
      const s = store.get('writing_s', {}), b = store.get('writing_b', {});
      const e = store.get('writing_e', {}), y = store.get('writing_y', {});
      wTotal = 9 + W.l1.scramble.length + W.l1.build.length + W.l2.emails.length + W.l3.essays.length;
      wDone = Object.keys(read).length
        + Object.values(s).filter(x => x && x.ok).length
        + Object.values(b).filter(x => x && (x.text || '').trim()).length
        + Object.values(e).filter(x => x && (x.text || '').trim()).length
        + Object.values(y).filter(x => x && ((x.text || '').trim() || ['p0','p1','p2','p3'].some(k => String(x[k] || '').trim()))).length;
    }
    return { vocab, vocabTotal, readQ, wDone, wTotal };
  }

  /* ---------- 畫面 ---------- */
  const rec = collect();
  const p = window.PROFILE && PROFILE.current();
  root.append(h('div', { class: 'page-head' },
    h('h1', null, '能力分析'),
    p ? h('p', null, p.name + ' 的累計紀錄') : null));

  if (rec.total < 10) {
    root.append(h('div', { class: 'q-block' },
      '目前累計作答 ' + rec.total + ' 題,還不夠做可靠的分析。先做',
      h('a', { href: 'diagnostic.html' }, '程度檢測'), ',或到',
      h('a', { href: 'practice.html' }, '題庫'), '刷一些題再回來。'));
    return;
  }

  /* 1. 預測分數帶 */
  const acc = x => x.t ? x.c / x.t : null;
  const aB0 = rec.diff['基礎'].t >= 4 ? acc(rec.diff['基礎']) : null;
  const aM0 = rec.diff['中級'].t >= 4 ? acc(rec.diff['中級']) : null;
  const aA0 = rec.diff['進階'].t >= 4 ? acc(rec.diff['進階']) : null;
  const overall = rec.correct / rec.total;
  const est = bandEstimate(aB0 === null ? 1 : aB0, aM0 === null ? overall : aM0, aA0 === null ? overall : aA0, overall);
  root.append(h('div', { class: 'report-head' },
    h('div', { class: 'who' }, '依據:' + rec.sources.join('、')),
    h('h2', null, '預測級距 ' + est.band),
    h('div', { class: 'band-line' },
      h('div', { class: 'item' }, h('b', null, Math.round(overall * 100) + '%'), h('span', null, '整體正確率(' + rec.total + ' 題)')),
      aB0 !== null ? h('div', { class: 'item' }, h('b', null, Math.round(aB0 * 100) + '%'), h('span', null, '基礎題')) : null,
      aM0 !== null ? h('div', { class: 'item' }, h('b', null, Math.round(aM0 * 100) + '%'), h('span', null, '中級題')) : null,
      aA0 !== null ? h('div', { class: 'item' }, h('b', null, Math.round(aA0 * 100) + '%'), h('span', null, '進階題')) : null,
      ['5', '6', '7'].map(pp => rec.parts[pp] && rec.parts[pp].n
        ? h('div', { class: 'item' }, h('b', null, Math.round(rec.parts[pp].ok / rec.parts[pp].n * 100) + '%'), h('span', null, 'Part ' + pp + '(' + rec.parts[pp].n + ' 題)'))
        : null)),
    h('div', { class: 'band-note' }, est.advice + ' 級距由練習紀錄推估、刻意放寬,與正式成績可能有明顯落差;累計越多題越準。')));

  /* 2. 強弱項 */
  const catRows = Object.entries(rec.cats).filter(([, c]) => c.t >= 3)
    .sort((a, b) => a[1].c / a[1].t - b[1].c / b[1].t);
  root.append(h('div', { class: 'exercise-head' }, h('h2', null, '考點強弱項')));
  if (!catRows.length) {
    root.append(h('p', { class: 'result-note' }, '單一考點的紀錄還太少(每類至少 3 題才列入)。'));
  } else {
    const table = h('table', { class: 'cat-table' },
      h('tr', null, h('th', null, '考點'), h('th', null, '答對'), h('th', null, '判定'), h('th', { class: 'no-print' }, '')));
    catRows.forEach(([cat, c]) => {
      const a = c.c / c.t;
      const cls = a >= 0.8 ? 'good' : a >= 0.4 ? 'mid' : 'weak';
      const label = a >= 0.8 ? '穩固' : a >= 0.4 ? '部分掌握' : '待加強';
      const link = c.go ? 'practice.html?part=' + c.go.part + (c.go.cat ? '&cat=' + encodeURIComponent(c.go.cat) : '') : null;
      table.append(h('tr', null,
        h('td', null, cat),
        h('td', { class: 'num' }, c.c + ' / ' + c.t),
        h('td', null, h('span', { class: 'verdict-pill ' + cls }, label)),
        h('td', { class: 'no-print' }, cls !== 'good' && link ? h('a', { href: link, style: 'font-size:13px' }, '去練 →') : '')));
    });
    root.append(table);
  }

  /* 3. 錯題分類 */
  const wg = wrongGroups();
  root.append(h('div', { class: 'exercise-head' }, h('h2', null, '錯題')));
  if (!wg.length) {
    root.append(h('p', { class: 'result-note' }, '目前沒有錯題。'));
  } else {
    wg.forEach(w => {
      const total = Object.values(w.groups).reduce((n, arr) => n + arr.length, 0);
      const box = h('div', { class: 'q-block' },
        h('div', { class: 'q-text', style: 'display:flex;align-items:center;gap:10px' },
          h('b', null, w.title), h('span', { style: 'color:var(--bad);font-weight:700' }, total + ' 題'),
          h('a', { class: 'btn', style: 'margin-left:auto;padding:4px 14px;font-size:13.5px', href: 'practice.html?mode=review&part=' + w.part }, '去複習')));
      Object.entries(w.groups).forEach(([g, arr]) => {
        const list = h('div', { class: 'wrong-cat-list', style: 'display:none' },
          arr.map(q => h('div', { class: 'wrong-cat-item' }, String(q.question).slice(0, 80))));
        const rowBtn = h('button', {
          class: 'wrong-cat-row', type: 'button',
          onclick: () => { list.style.display = list.style.display === 'none' ? '' : 'none'; },
        }, h('span', null, g), h('b', null, arr.length + ' 題'));
        box.append(rowBtn, list);
      });
      root.append(box);
    });
  }

  /* 4. 學習量 */
  const v = volume();
  root.append(h('div', { class: 'exercise-head' }, h('h2', null, '學習量')));
  const diagN = ((store.get('diag', null) || {}).done && diagItems.length) ? diagItems.length : 0;
  root.append(h('div', { class: 'band-line', style: 'margin:6px 0 40px' },
    h('div', { class: 'item' }, h('b', null, String(rec.total - diagN)), h('span', null, '刷題已作答')),
    h('div', { class: 'item' }, h('b', null, v.vocab + '/' + v.vocabTotal), h('span', null, '互動單字')),
    h('div', { class: 'item' }, h('b', null, String(v.readQ)), h('span', null, '文章題已作答')),
    h('div', { class: 'item' }, h('b', null, v.wDone + '/' + v.wTotal), h('span', null, '寫作單元'))));
})();
