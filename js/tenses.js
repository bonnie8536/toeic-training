/* 12 時態總整理:
   主表排成 4(面向:簡單/進行/完成/完成進行)×3(時間:現在/過去/未來) 的矩陣,
   讓學生看出「時態 = 哪個時間 × 哪種面向」,每格有時間軸小圖、公式與一句例句;
   點格子展開完整內容(時間感、什麼時候用、三句例句、常搭配的連接詞、常見錯誤)。
   第二區是「時態的夥伴字」:before/after/since 這些詞怎麼決定前後兩句的時態。 */
(function () {
  const root = $('#tenses-root');
  const T = (window.TOEIC && TOEIC.tenses) || null;
  const TENSES = (T && T.tenses) || [];
  const PAIRS = (T && T.pairs) || [];

  if (!TENSES.length) {
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' }, '時態總整理準備中,稍後再來。'));
    return;
  }

  const TIMES = [
    { k: 'past', name: '過去' },
    { k: 'now', name: '現在' },
    { k: 'fut', name: '未來' },
  ];
  const ASPECTS = [
    { k: 'simple', name: '簡單式', hint: '就是這件事,不強調過程或先後' },
    { k: 'prog', name: '進行式', hint: '那個時間點正在進行' },
    { k: 'perf', name: '完成式', hint: '到那個時間點為止,已經完成或累積' },
    { k: 'perfprog', name: '完成進行式', hint: '到那個時間點為止,一直持續在做' },
  ];
  const idOf = (time, aspect) => 't-' + time + '-' + aspect;
  const byId = id => TENSES.find(x => x.id === id);

  /* ---------- 時間軸小圖:一條線標過去/現在/未來,再依時態畫標記 ---------- */
  function axisSvg(time, aspect) {
    const X = { past: 26, now: 60, fut: 94 }[time];
    const C = { line: '#c9d2da', ink: '#2b2a28', mark: '#ffd84d', blue: '#0b72c4' };
    const parts = [];
    /* 底線與三個刻度 */
    parts.push('<line x1="8" y1="34" x2="112" y2="34" stroke="' + C.line + '" stroke-width="2"/>');
    [26, 60, 94].forEach(x => parts.push('<line x1="' + x + '" y1="30" x2="' + x + '" y2="38" stroke="' + C.line + '" stroke-width="2"/>'));
    parts.push('<circle cx="60" cy="34" r="3" fill="' + C.line + '"/>');

    if (aspect === 'simple') {
      /* 一個實心點:事情就發生在這個時間 */
      parts.push('<circle cx="' + X + '" cy="20" r="7" fill="' + C.blue + '"/>');
    } else if (aspect === 'prog') {
      /* 一小段波浪:那個時間點正在進行 */
      parts.push('<path d="M' + (X - 13) + ' 20 q 4 -7 7 0 q 4 7 7 0 q 4 -7 7 0" fill="none" stroke="' + C.blue + '" stroke-width="3" stroke-linecap="round"/>');
      parts.push('<circle cx="' + X + '" cy="20" r="3.2" fill="' + C.blue + '"/>');
    } else if (aspect === 'perf') {
      /* 從更早的一點拉箭頭到這個時間:到此為止已完成 */
      parts.push('<circle cx="' + (X - 26) + '" cy="20" r="5" fill="' + C.line + '"/>');
      parts.push('<path d="M' + (X - 19) + ' 20 H' + (X - 8) + '" stroke="' + C.ink + '" stroke-width="2" stroke-dasharray="3 3"/>');
      parts.push('<path d="M' + (X - 9) + ' 16 l5 4 l-5 4 z" fill="' + C.ink + '"/>');
      parts.push('<circle cx="' + X + '" cy="20" r="7" fill="' + C.blue + '"/>');
    } else {
      /* 一路持續的波浪到這個時間 */
      parts.push('<path d="M' + (X - 30) + ' 20 q 4 -7 7 0 q 4 7 7 0 q 4 -7 7 0 q 4 7 7 0 q 4 -7 7 0" fill="none" stroke="' + C.blue + '" stroke-width="3" stroke-linecap="round"/>');
      parts.push('<circle cx="' + X + '" cy="20" r="5.5" fill="' + C.blue + '"/>');
    }
    /* 這一格對應的時間刻度用螢光筆標起來 */
    parts.push('<ellipse cx="' + X + '" cy="34" rx="11" ry="6" fill="' + C.mark + '" opacity=".55"/>');
    return '<svg viewBox="0 0 120 46" aria-hidden="true">' + parts.join('') + '</svg>';
  }

  let open = null;   /* 展開中的時態 id */
  render();

  function render() {
    document.title = '12 時態總整理|刷刷英文';
    root.innerHTML = '';
    root.append(h('div', { class: 'page-head' }, h('h1', null, '12 時態總整理')));
    root.append(h('p', { class: 'result-note' },
      '直的是三個時間,橫的是四種面向。任何一個時態都是「哪個時間 × 哪種面向」的組合,點一格看完整用法。'));

    /* ---- 主矩陣 ---- */
    const grid = h('div', { class: 'tn-grid' });
    grid.append(h('div', { class: 'tn-corner' }));
    TIMES.forEach(t => grid.append(h('div', { class: 'tn-head' }, t.name)));
    ASPECTS.forEach(a => {
      grid.append(h('div', { class: 'tn-side' }, h('b', null, a.name), h('span', null, a.hint)));
      TIMES.forEach(t => {
        const v = byId(idOf(t.k, a.k));
        if (!v) { grid.append(h('div', { class: 'tn-cell empty' })); return; }
        grid.append(h('button', {
          class: 'tn-cell' + (open === v.id ? ' on' : ''), type: 'button',
          onclick: () => { open = open === v.id ? null : v.id; render(); scrollTo(v.id); },
        },
          h('div', { class: 'tn-axis', html: axisSvg(t.k, a.k) }),
          h('div', { class: 'tn-form' }, v.form),
          h('div', { class: 'tn-ex' }, (v.examples[0] || {}).en || '')));
      });
    });
    root.append(h('div', { class: 'tn-wrap' }, grid));

    /* ---- 展開的細節 ---- */
    if (open) {
      const v = byId(open);
      if (v) root.append(detail(v));
    }

    /* ---- 夥伴字 ---- */
    if (PAIRS.length) {
      root.append(h('div', { class: 'exercise-head', style: 'margin-top:34px' }, h('h2', null, '時態的夥伴字')));
      root.append(h('p', { class: 'result-note', style: 'margin:0 0 14px' },
        '一個句子裡有兩件事的時候,是這些詞在決定兩邊各用什麼時態。'));
      const groups = {};
      PAIRS.forEach(p => (groups[p.group || '其他'] = groups[p.group || '其他'] || []).push(p));
      Object.entries(groups).forEach(([g, items]) => {
        root.append(h('h3', { class: 'tn-group' }, g));
        const wrap = h('div', { class: 'tn-pairs' });
        items.forEach(p => {
          const ex = h('div', { class: 'tn-pair-ex' });
          (p.examples || []).forEach(e => ex.append(h('div', null,
            h('div', { class: 'tn-pair-en' }, e.en),
            h('div', { class: 'tn-pair-zh' }, e.zh),
            e.note ? h('div', { class: 'tn-pair-note' }, e.note) : null)));
          wrap.append(h('div', { class: 'tn-pair' },
            h('div', { class: 'tn-pair-head' },
              h('b', null, p.word),
              h('span', null, p.zh)),
            h('div', { class: 'tn-pattern' }, p.pattern),
            h('p', { class: 'tn-explain' }, p.explain),
            ex,
            p.mistake ? h('div', { class: 'tn-mistake' }, p.mistake) : null));
        });
        root.append(wrap);
      });
    }

    root.append(h('div', { class: 'drill-nav-btns', style: 'margin-top:30px' },
      h('a', { class: 'btn', href: 'grammar.html?ch=h' }, '回文法基礎'),
      h('a', { class: 'btn', href: 'verbs.html' }, '不規則動詞表'),
      h('a', { class: 'btn primary', href: 'practice.html?part=5&cat=' + encodeURIComponent('動詞時態與語態') }, '刷時態的題目')));
    root.append(h('div', { style: 'height:40px' }));
  }

  function detail(v) {
    const box = h('div', { class: 'tn-detail', id: 'tn-' + v.id });
    box.append(h('div', { class: 'tn-detail-head' },
      h('h2', null, v.name),
      h('code', null, v.form),
      h('button', { class: 'pop-mini', type: 'button', onclick: () => { open = null; render(); } }, '收起')));
    box.append(h('p', { class: 'tn-feel' }, v.feel));
    if (v.formNote) box.append(h('p', { class: 'tn-formnote' }, v.formNote));

    const cols = h('div', { class: 'tn-cols' });
    const left = h('div', null);
    left.append(h('div', { class: 'tn-sub' }, '什麼時候用'));
    const ul = h('ul', { class: 'tn-when' });
    (v.when || []).forEach(w => ul.append(h('li', null, w)));
    left.append(ul);
    if ((v.signals || []).length) {
      left.append(h('div', { class: 'tn-sub' }, '常出現的時間詞'));
      const sg = h('div', { class: 'tn-signals' });
      v.signals.forEach(s => sg.append(h('span', null, s)));
      left.append(sg);
    }
    if (v.contrast) left.append(h('div', { class: 'tn-contrast' }, v.contrast));
    if (v.mistake) left.append(h('div', { class: 'tn-mistake' }, v.mistake));

    const right = h('div', null);
    right.append(h('div', { class: 'tn-sub' }, '例句'));
    (v.examples || []).forEach(e => right.append(h('div', { class: 'tn-exbox' },
      h('div', { class: 'tn-pair-en' }, e.en),
      h('div', { class: 'tn-pair-zh' }, e.zh))));
    if ((v.partners || []).length) {
      right.append(h('div', { class: 'tn-sub' }, '常跟這些字一起出現'));
      v.partners.forEach(p => right.append(h('div', { class: 'tn-partner' },
        h('div', { class: 'tn-pair-head' }, h('b', null, p.word)),
        h('div', { class: 'tn-pattern' }, p.rule),
        h('div', { class: 'tn-pair-en' }, p.en),
        h('div', { class: 'tn-pair-zh' }, p.zh))));
    }
    cols.append(left, right);
    box.append(cols);
    return box;
  }

  function scrollTo(id) {
    setTimeout(() => {
      const el = document.getElementById('tn-' + id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  }
})();
