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
    if (n5) rec.sources.push('Part 5 ' + n5 + ' 題');

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
      if (n) rec.sources.push('Part ' + p + ' ' + n + ' 題');
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

  /* ---------- 圖表小工具 ---------- */
  function bar(label, ratio, valText, colorClass, extra) {
    return h('div', { class: 'bar-line' },
      h('span', { class: 'lb' }, label),
      h('div', { class: 'track' }, h('i', { class: colorClass || '', style: 'width:' + Math.round(ratio * 100) + '%' })),
      h('span', { class: 'val' }, valText),
      extra || null);
  }

  /* 級距刻度尺(300–990) */
  function bandScale(band) {
    const MIN = 300, MAX = 990;
    let lo, hi;
    if (band.endsWith('+')) { lo = Number(band.slice(0, -1)); hi = MAX; }
    else { const m = band.split('–'); lo = Number(m[0]); hi = Number(m[1]); }
    const pct = v => ((v - MIN) / (MAX - MIN) * 100).toFixed(1) + '%';
    const scale = h('div', { class: 'band-scale' },
      h('div', { class: 'bs-track' }),
      h('div', { class: 'bs-seg', style: 'left:' + pct(lo) + ';width:' + ((hi - lo) / (MAX - MIN) * 100).toFixed(1) + '%' }),
      h('div', { class: 'bs-label', style: 'left:' + pct((lo + hi) / 2) }, band));
    [300, 500, 700, 900, 990].forEach(v =>
      scale.append(h('span', { class: 'bs-tick', style: 'left:' + pct(v) }, String(v))));
    return scale;
  }

  /* ---------- 畫面 ---------- */
  /* 空狀態用共用元件(UI.empty);沒載到時退回一行字加出口 */
  function emptyState(opt) {
    if (window.UI && typeof UI.empty === 'function') return UI.empty(opt);
    const box = h('div', { class: 'q-block' }, opt.text);
    if (opt.action) box.append(h('a', { class: 'btn', href: opt.action.href }, opt.action.label));
    (opt.links || []).forEach(l => box.append(h('a', { class: 'btn-text', href: l.href }, l.label)));
    return box;
  }

  const rec = collect();
  root.append(h('div', { class: 'page-head' },
    h('canvas', { class: 'hub-art', 'data-doodle': 'analysis', 'data-size': '40', 'aria-hidden': 'true' }),
    h('h1', null, '能力分析')));
  if (window.UI && typeof UI.doodle === 'function') UI.doodle(root);

  if (rec.total < 10) {
    /* 還不夠分析:累計題數、一顆主按鈕、一個文字連結 */
    root.append(emptyState({
      pose: 'read', text: '累計作答 ' + rec.total + ' / 10 題',
      action: { label: '去刷題', href: 'practice.html', primary: true },
      links: [{ label: '程度檢測', href: 'diagnostic.html' }],
    }));
    return;
  }

  /* 1. 預測分數帶 */
  const acc = x => x.t ? x.c / x.t : null;
  const aB0 = rec.diff['基礎'].t >= 4 ? acc(rec.diff['基礎']) : null;
  const aM0 = rec.diff['中級'].t >= 4 ? acc(rec.diff['中級']) : null;
  const aA0 = rec.diff['進階'].t >= 4 ? acc(rec.diff['進階']) : null;
  const overall = rec.correct / rec.total;
  const est = bandEstimate(aB0 === null ? 1 : aB0, aM0 === null ? overall : aM0, aA0 === null ? overall : aA0, overall);
  const accCls = r => r < 0.4 ? 'weak' : r < 0.6 ? 'mid' : '';
  root.append(h('div', { class: 'report-head' },
    h('div', { class: 'who' }, '資料來源 ' + rec.sources.join('、')),
    h('h2', null, '閱讀預測級距'),
    bandScale(est.band),
    h('div', { style: 'margin-top:18px' },
      bar('整體正確率', overall, Math.round(overall * 100) + '% · ' + rec.total + ' 題', accCls(overall)),
      aB0 !== null ? bar('基礎題', aB0, Math.round(aB0 * 100) + '%', accCls(aB0)) : null,
      aM0 !== null ? bar('中級題', aM0, Math.round(aM0 * 100) + '%', accCls(aM0)) : null,
      aA0 !== null ? bar('進階題', aA0, Math.round(aA0 * 100) + '%', accCls(aA0)) : null,
      ['5', '6', '7'].map(pp => rec.parts[pp] && rec.parts[pp].n
        ? bar('Part ' + pp, rec.parts[pp].ok / rec.parts[pp].n,
            Math.round(rec.parts[pp].ok / rec.parts[pp].n * 100) + '% · ' + rec.parts[pp].n + ' 題',
            accCls(rec.parts[pp].ok / rec.parts[pp].n))
        : null)),
    h('div', { class: 'band-note' }, '參考換算 · 非正式成績')));

  /* 2. 強弱項(長條圖,弱→強) */
  const catRows = Object.entries(rec.cats).filter(([, c]) => c.t >= 3)
    .sort((a, b) => a[1].c / a[1].t - b[1].c / b[1].t);
  root.append(h('div', { class: 'exercise-head' }, h('h2', null, '考點強弱項')));
  if (!catRows.length) {
    root.append(h('p', { class: 'an-tags' }, h('span', { class: 'an-tag' }, '每類滿 3 題才列入')));
  } else {
    const wrap = h('div', { class: 'cat-bars' });
    catRows.forEach(([cat, c]) => {
      const a = c.c / c.t;
      const cls = a >= 0.8 ? 'ok' : a >= 0.4 ? 'mid' : 'weak';
      const link = c.go ? 'practice.html?part=' + c.go.part + (c.go.cat ? '&cat=' + encodeURIComponent(c.go.cat) : '') : null;
      wrap.append(bar(cat, a, c.c + ' / ' + c.t, cls,
        cls !== 'ok' && link ? h('a', { class: 'bar-go', href: link }, '去練') : h('span', { class: 'bar-go', style: 'visibility:hidden' }, '去練')));
    });
    /* 圖例:無字的色塊加文字說明;色塊用 aria-label 說出顏色,色盲或讀屏的人也讀得到 */
    const swatch = (cls, color) => h('span', { class: 'verdict-pill an-swatch ' + cls, role: 'img', 'aria-label': color, title: color });
    root.append(wrap,
      h('p', { class: 'an-legend' },
        h('span', { class: 'an-legend-item' }, swatch('weak', '紅色'), '低於 40%'),
        h('span', { class: 'an-legend-item' }, swatch('mid', '橘色'), '40–79%'),
        h('span', { class: 'an-legend-item' }, swatch('good', '綠色'), '80% 以上')));
  }

  /* 3. 錯題分類:跟錯題本同一套分組(js/wrongbook.js、js/wrongbook-ui.js;含模擬考答錯的題,Part 7 依文章類型),
     每組可以展開、有「複習」;每個 Part 的「看錯題本」連到那個 Part 的錯題本清單(報讀名稱帶 Part)。
     從「複習」按上一頁回來(bfcache 原樣拿回來):錯題變了只重畫這一區,開著的組照舊開著(WRONGBOOK_UI.keepFresh)。
     這頁其他區(級距、正確率、考點強弱)照以前不重畫。沒載到就照以前 */
  const WB = window.WRONGBOOK, WBUI = window.WRONGBOOK_UI;
  const wg = WB && WBUI ? [] : wrongGroups();
  root.append(h('div', { class: 'exercise-head' }, h('h2', null, '錯題')));
  if (WB && WBUI) {
    const wbBox = h('div');
    const paintWrong = (open) => {
      const parts = ['5', '6', '7'].map(p => ({ p, groups: WB.groups(p) })).filter(x => x.groups.length);
      wbBox.replaceChildren();
      if (!parts.length) wbBox.append(emptyState({ pose: 'sleep', text: '沒有錯題' }));
      parts.forEach(({ p, groups }) => {
        const total = groups.reduce((n, g) => n + g.items.length, 0);
        /* Part 名稱是 h3、底下的組是 h4(報讀用標題跳讀時聽得到換了 Part),樣子跟以前的粗體字一樣。
           題數、看錯題本不縮、不斷行,320 寬也各一行(css .wb-part-head) */
        wbBox.append(h('div', { class: 'q-block', 'data-part': p },
          h('div', { class: 'q-text wb-part-head' },
            h('h3', { class: 'wb-part-title' }, WB.TITLE[p]), h('span', { class: 'wb-part-n' }, total + ' 題'),
            h('a', { class: 'btn wb-book', href: 'practice.html?mode=wrong&part=' + p, 'aria-label': '看錯題本 ' + WB.TITLE[p] }, '看錯題本')),
          WBUI.groupList(groups, { part: p, level: 4, remember: false, open: open && open[p] })));
      });
    };
    paintWrong(null);
    root.append(wbBox);
    WBUI.keepFresh(wbBox, () => WBUI.sig(['5', '6', '7']), paintWrong);
    /* 開頁先跟雲端對齊模擬考錯題(js/wrongbook.js syncCloud):別台考的錯題合併進來時 keepFresh 重畫這一區 */
    if (typeof WB.syncCloud === 'function') WB.syncCloud();
  } else if (!wg.length) {
    root.append(emptyState({ pose: 'sleep', text: '沒有錯題' }));
  } else {
    wg.forEach(w => {
      const total = Object.values(w.groups).reduce((n, arr) => n + arr.length, 0);
      const box = h('div', { class: 'q-block' },
        h('div', { class: 'q-text', style: 'display:flex;align-items:center;gap:10px' },
          h('b', null, w.title), h('span', { style: 'color:var(--bad);font-weight:700' }, total + ' 題'),
          h('a', { class: 'btn', style: 'margin-left:auto;padding:4px 14px;font-size:13.5px', href: 'practice.html?mode=review&part=' + w.part }, '開始')));
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

  /* 4. 學習量(進度條) */
  const v = volume();
  root.append(h('div', { class: 'exercise-head' }, h('h2', null, '學習量')));
  const diagN = ((store.get('diag', null) || {}).done && diagItems.length) ? diagItems.length : 0;
  const drillN = rec.total - diagN;
  const drillTotal = (TOEIC.part5 || []).length
    + (TOEIC.part6 || []).reduce((n, s) => n + s.questions.length, 0)
    + (TOEIC.part7 || []).reduce((n, s) => n + s.questions.length, 0);
  const readQTotal = (TOEIC.articles || []).reduce((n, a) => n + a.questions.length, 0);
  root.append(h('div', { style: 'margin:6px 0 40px' },
    bar('刷題', drillTotal ? drillN / drillTotal : 0, drillN + ' / ' + drillTotal),
    bar('互動單字', v.vocabTotal ? v.vocab / v.vocabTotal : 0, v.vocab + ' / ' + v.vocabTotal),
    bar('文章題', readQTotal ? v.readQ / readQTotal : 0, v.readQ + ' / ' + readQTotal),
    bar('寫作單元', v.wTotal ? v.wDone / v.wTotal : 0, v.wDone + ' / ' + v.wTotal)));
})();
