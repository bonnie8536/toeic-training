/* 12 時態總整理:
   主表排成 4(面向:簡單/進行/完成/完成進行)×3(時間:現在/過去/未來) 的矩陣,
   讓學生看出「時態 = 哪個時間 × 哪種面向」,每格有時間軸小圖、公式與一句例句;
   點格子展開完整內容(時間感、什麼時候用、三句例句、常搭配的連接詞、常見錯誤)。
   第二區是「時態的夥伴字」:before/after/since 這些詞怎麼決定前後兩句的時態。 */
/* 嵌在文法基礎頁裡:grammar.html?ref=tenses 會呼叫 TENSES_VIEW.mount(容器)。 */
(function () {
  window.TENSES_VIEW = { mount };
  const host = $('#tenses-root');
  if (host) mount(host);

  function mount(root) {
    const T = (window.TOEIC && TOEIC.tenses) || null;
    const TENSES = (T && T.tenses) || [];
    const PAIRS = (T && T.pairs) || [];

    if (!TENSES.length) {
      root.append(h('div', { class: 'q-block', style: 'margin-top:30px' }, '時態總整理準備中，稍後再來。'));
      return;
    }

    const TIMES = [
      { k: 'past', name: '過去' },
      { k: 'now', name: '現在' },
      { k: 'fut', name: '未來' },
    ];
    const ASPECTS = [
      { k: 'simple', name: '簡單式', hint: '就是這件事，不強調過程或先後' },
      { k: 'prog', name: '進行式', hint: '那個時間點正在進行' },
      { k: 'perf', name: '完成式', hint: '到那個時間點為止，已經完成或累積' },
      { k: 'perfprog', name: '完成進行式', hint: '到那個時間點為止，一直持續在做' },
    ];
    const idOf = (time, aspect) => 't-' + time + '-' + aspect;
    const byId = id => TENSES.find(x => x.id === id);

    /* ---------- 時間軸小圖:一條線標過去/現在/未來,再依時態畫標記 ---------- */
    /* ---------- 時間軸小圖:站著的人=做了這件事,跑步的人=正在進行;
       灰色的人+虛線箭頭=從更早一路到那時(完成式);現在簡單式=一整排站著的人(一直都有在做) ---------- */
    const C = { line: '#c9d2da', ink: '#222b36', past: '#c3ccd5', arrow: '#d2443c', mark: '#ffd84d', label: '#8a949f' };
    const TICK = { past: 40, now: 74, fut: 108 };
    const BASE = 40;

    function person(x, color, scale, running) {
      const g = '<g transform="translate(' + x + ' ' + BASE + ') scale(' + scale + ')" fill="none" stroke="' + color +
        '" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round">';
      const body = running
        ? '<circle cx="3.5" cy="-23.5" r="3.4" fill="' + color + '" stroke="none"/>' +
          '<path d="M2 -18.5 L-1 -9.5"/>' +
          '<path d="M1.5 -17 L5.5 -13.5 L8.5 -16.5"/>' +
          '<path d="M1.5 -17 L-3.5 -15 L-5.5 -11"/>' +
          '<path d="M-1 -9.5 L4 -6.5 L2.5 0"/>' +
          '<path d="M-1 -9.5 L-4.5 -5 L-9 -5.5"/>'
        : '<circle cx="0" cy="-23.5" r="3.4" fill="' + color + '" stroke="none"/>' +
          '<path d="M0 -18 L0 -9"/>' +
          '<path d="M0 -18 L-6 -25 M0 -18 L6 -25"/>' +
          '<path d="M0 -9 L-4 0 M0 -9 L4 0"/>';
      return g + body + '</g>';
    }

    function arrow(x1, x2) {
      const y = BASE - 14;
      return '<path d="M' + x1 + ' ' + y + ' H' + (x2 - 4) + '" stroke="' + C.arrow + '" stroke-width="1.8" stroke-dasharray="3 2.5" fill="none"/>' +
        '<path d="M' + (x2 - 5) + ' ' + (y - 3.5) + ' L' + x2 + ' ' + y + ' L' + (x2 - 5) + ' ' + (y + 3.5) + ' z" fill="' + C.arrow + '"/>';
    }

    function axisSvg(time, aspect) {
      const X = TICK[time];
      const parts = [];
      /* 時間軸、三個刻度與標籤;這一格的時間用螢光筆標起來 */
      parts.push('<ellipse cx="' + X + '" cy="' + (BASE + 4) + '" rx="12" ry="5" fill="' + C.mark + '" opacity=".6"/>');
      parts.push('<line x1="4" y1="' + (BASE + 4) + '" x2="142" y2="' + (BASE + 4) + '" stroke="' + C.line + '" stroke-width="2"/>');
      Object.entries(TICK).forEach(([k, x]) => {
        parts.push('<line x1="' + x + '" y1="' + (BASE + 1) + '" x2="' + x + '" y2="' + (BASE + 7) + '" stroke="' + C.line + '" stroke-width="2"/>');
        parts.push('<text x="' + x + '" y="' + (BASE + 18) + '" text-anchor="middle" font-size="9.5" fill="' + C.label + '">' +
          ({ past: '過去', now: '現在', fut: '未來' })[k] + '</text>');
      });

      if (aspect === 'simple' && time === 'now') {
        /* 一直都有在做:從過去到未來都站著一個人 */
        [12, 43, 74, 105, 136].forEach(x => parts.push(person(x, C.ink, 0.8, false)));
      } else if (aspect === 'simple') {
        parts.push(person(X, C.ink, 1, false));
      } else if (aspect === 'prog') {
        parts.push(person(X, C.ink, 1, true));
      } else if (aspect === 'perf') {
        parts.push(person(X - 32, C.past, 1, false));
        parts.push(arrow(X - 24, X - 9));
        parts.push(person(X, C.ink, 1, false));
      } else {
        parts.push(arrow(X - 27, X - 10));
        parts.push(person(X - 36, C.past, 0.8, true));
        parts.push(person(X - 19, C.past, 0.8, true));
        parts.push(person(X, C.ink, 1, true));
      }
      return '<svg viewBox="0 0 148 64" aria-hidden="true">' + parts.join('') + '</svg>';
    }

    /* V-ing、V-ed 這類有連字號的字不要在連字號斷行(手機上格子窄) */
    const formNodes = s => String(s).split(/([A-Za-z]+-[A-Za-z]+)/).filter(Boolean)
      .map(t => /^[A-Za-z]+-[A-Za-z]+$/.test(t) ? h('span', { class: 'nobr' }, t) : t);

    let open = null;   /* 展開中的時態 id */
    render();

    function render() {
      document.title = '12 時態總整理|刷刷英文';
      root.innerHTML = '';
      root.append(h('div', { class: 'page-head' }, h('h1', null, '12 時態總整理')));
      root.append(h('p', { class: 'result-note' },
        '直的是三個時間，橫的是四種面向。任何一個時態都是「哪個時間 × 哪種面向」的組合，點一格看完整用法。'));

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
            h('div', { class: 'tn-form' }, formNodes(v.form)),
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
          '一個句子裡有兩件事的時候，是這些詞在決定兩邊各用什麼時態。'));
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
        h('a', { class: 'btn', href: 'grammar.html?ref=verbs' }, '不規則動詞表'),
        h('a', { class: 'btn primary', href: 'practice.html?part=5&cat=' + encodeURIComponent('動詞時態與語態') }, '刷時態的題目')));
      root.append(h('div', { style: 'height:40px' }));
    }

    function detail(v) {
      const box = h('div', { class: 'tn-detail', id: 'tn-' + v.id });
      box.append(h('div', { class: 'tn-detail-head' },
        h('h2', null, v.name),
        h('code', null, v.form),
        h('button', { class: 'pop-mini', type: 'button', onclick: () => { open = null; render(); } }, '收起')));
      const [, tk, ak] = v.id.split('-');
      box.append(h('div', { class: 'tn-axis tn-axis-big', html: axisSvg(tk, ak) }));
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
  }
})();
