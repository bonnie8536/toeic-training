/* 不規則動詞表:按變化型分組的三態表,可篩選、可遮住自測、可做測驗。
   變化型 AAA=三態同形 / ABB=過去式與過去分詞同形 / ABA=原形與過去分詞同形 / ABC=三態都不同。
   測驗紀錄存 verb_quiz(雲端同步),答錯的字下一輪優先出現。 */
/* 嵌在文法基礎頁裡:grammar.html?ref=verbs 會呼叫 VERBS_VIEW.mount(容器)。 */
(function () {
  window.VERBS_VIEW = { mount };
  const host = $('#verbs-root');
  if (host) mount(host);

  function mount(root) {
    const VERBS = (window.TOEIC && TOEIC.verbs) || [];

    if (!VERBS.length) {
      root.append(h('div', { class: 'q-block', style: 'margin-top:30px' }, '動詞表準備中，稍後再來。'));
      return;
    }

    const TYPES = [
      { k: 'AAA', name: '三態同形', hint: '原形、過去式、過去分詞長得一樣，只能從句子判斷時態。' },
      { k: 'ABB', name: '後兩個同形', hint: '過去式與過去分詞相同，是數量最多的一類。' },
      { k: 'ABA', name: '頭尾同形', hint: '過去分詞變回原形的樣子，只有過去式不同。' },
      { k: 'ABC', name: '三態都不同', hint: '三個形態各不相同，要一組一組記。' },
    ];
    const LEVELS = ['全部', '初級', '中級', '進階'];

    /* 只取斜線前的第一個寫法來比對答案,兩種寫法都算對 */
    const forms = s => String(s).split('/').map(x => x.trim().toLowerCase()).filter(Boolean);
    const hit = (input, answer) => forms(answer).includes(String(input).trim().toLowerCase());

    let level = '全部';
    let type = '全部';
    let keyword = '';
    let masked = false;
    render();

    function pool() {
      const kw = keyword.trim().toLowerCase();
      return VERBS.filter(v =>
        (level === '全部' || v.level === level) &&
        (type === '全部' || v.type === type) &&
        (!kw || v.base.toLowerCase().includes(kw) || v.past.toLowerCase().includes(kw) ||
          v.pp.toLowerCase().includes(kw) || v.zh.includes(kw)));
    }

    function render() {
      document.title = '不規則動詞表|刷刷英文';
      root.innerHTML = '';
      root.append(h('div', { class: 'page-head' }, h('h1', null, '不規則動詞表')));

      const list = pool();
      const st = store.get('verb_quiz', {});
      const learned = VERBS.filter(v => (st[v.id] || {}).ok).length;

      /* 工具列:搜尋、級別、變化型、遮住、測驗 */
      const search = h('input', {
        class: 'modal-input', type: 'search', value: keyword, placeholder: '找動詞（英文或中文）',
        style: 'max-width:200px;flex:none',
      });
      search.addEventListener('input', () => { keyword = search.value; redraw(); });

      const chips = h('div', { class: 'vb-chips' });
      LEVELS.forEach(l => chips.append(h('button', {
        class: 'hist-tab' + (level === l ? ' on' : ''), type: 'button',
        onclick: () => { level = l; render(); },
      }, l)));
      chips.append(h('span', { class: 'vb-sep' }));
      ['全部'].concat(TYPES.map(t => t.k)).forEach(k => chips.append(h('button', {
        class: 'hist-tab' + (type === k ? ' on' : ''), type: 'button',
        onclick: () => { type = k; render(); },
      }, k === '全部' ? '所有變化型' : k)));

      root.append(
        h('div', { class: 'vb-bar' },
          search,
          h('button', {
            class: 'btn' + (masked ? ' on' : ''), type: 'button',
            onclick: () => { masked = !masked; render(); },
          }, masked ? '顯示答案' : '遮住自己想'),
          h('button', { class: 'btn primary', type: 'button', onclick: () => startQuiz(list) }, '測驗這些字'),
          h('span', { class: 'vb-count' }, list.length + ' 個字 · 測驗答對過 ' + learned + '/' + VERBS.length)),
        chips);

      const body = h('div', null);
      root.append(body, h('div', { style: 'height:40px' }));
      drawTables(body, list);

      function redraw() {
        const l = pool();
        body.innerHTML = '';
        drawTables(body, l);
        root.querySelector('.vb-count').textContent = l.length + ' 個字 · 測驗答對過 ' + learned + '/' + VERBS.length;
      }
    }

    function drawTables(box, list) {
      if (!list.length) {
        box.append(h('p', { class: 'result-note' }, '沒有符合的動詞。'));
        return;
      }
      TYPES.forEach(t => {
        const items = list.filter(v => v.type === t.k);
        if (!items.length) return;
        box.append(h('div', { class: 'exercise-head', style: 'margin-top:26px' },
          h('h2', null, t.name, h('span', { class: 'vb-code' }, t.k)),
          h('span', { style: 'margin-left:auto;font-size:13.5px;color:var(--ink-light)' }, items.length + ' 個')));
        box.append(h('p', { class: 'result-note', style: 'margin:0 0 10px' }, t.hint));

        const tbl = h('table', { class: 'gx-table vb-table' },
          h('tr', null, h('th', null, '原形'), h('th', null, '過去式'), h('th', null, '過去分詞'), h('th', null, '意思')));
        items.forEach(v => {
          const cell = (text, cls) => h('td', { class: cls },
            masked ? h('button', {
              class: 'vb-mask', type: 'button',
              onclick: e => { e.currentTarget.replaceWith(document.createTextNode(text)); },
            }, '?') : text);
          const row = h('tr', null,
            h('td', null, h('b', null, v.base)),
            cell(v.past, 'vb-en'),
            cell(v.pp, 'vb-en'),
            h('td', { class: 'vb-zh' }, v.zh));
          tbl.append(row);
          if (v.note || v.example) {
            const extra = h('td', { colspan: '4', class: 'vb-extra' });
            if (v.example) extra.append(h('div', { class: 'vb-ex' }, v.example, h('span', null, v.exampleZh || '')));
            if (v.note) extra.append(h('div', { class: 'vb-note' }, v.note));
            tbl.append(h('tr', { class: 'vb-extra-row' }, extra));
          }
        });
        box.append(h('div', { class: 'vb-wrap' }, tbl));
      });
    }

    /* ================= 測驗:給原形與中文,填過去式與過去分詞 ================= */
    function startQuiz(list) {
      if (list.length < 4) { alert('至少要有 4 個字才能測驗，先放寬篩選條件。'); return; }
      const st = store.get('verb_quiz', {});
      const shuffle = arr => {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      };
      /* 沒測過的與上次答錯的優先 */
      const fresh = list.filter(v => !st[v.id]);
      const wrong = list.filter(v => st[v.id] && !st[v.id].ok);
      const done = list.filter(v => st[v.id] && st[v.id].ok);
      const items = [...shuffle(wrong), ...shuffle(fresh), ...shuffle(done)].slice(0, 10);
      const results = [];
      let cur = 0;
      document.title = '動詞測驗|刷刷英文';
      draw();

      function draw() {
        root.innerHTML = '';
        root.append(h('div', { class: 'drill-top' },
          h('h1', null, '動詞測驗 ', h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' }, '第 ' + (cur + 1) + ' / ' + items.length + ' 題')),
          h('a', {
            href: 'grammar.html?ref=verbs', style: 'font-size:13.5px;margin-left:auto',
            onclick: e => { e.preventDefault(); render(); },
          }, '← 回動詞表')));
        const nav = h('div', { class: 'q-nav' });
        items.forEach((x, i) => {
          let cls = i === cur ? 'cur' : '';
          if (results[i] === true) cls += ' ok';
          if (results[i] === false) cls += ' ng';
          nav.append(h('button', { class: cls.trim(), disabled: '' }, String(i + 1)));
        });
        root.append(nav);

        const v = items[cur];
        const past = h('input', { class: 'modal-input vb-input', type: 'text', placeholder: '過去式', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
        const pp = h('input', { class: 'modal-input vb-input', type: 'text', placeholder: '過去分詞', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
        const after = h('div', null);
        let answered = false;

        const submit = () => {
          if (answered) return;
          answered = true;
          const okPast = hit(past.value, v.past);
          const okPp = hit(pp.value, v.pp);
          const ok = okPast && okPp;
          results[cur] = ok;
          const st2 = store.get('verb_quiz', {});
          st2[v.id] = { ok, t: Date.now() };
          store.set('verb_quiz', st2);
          logAttempt('iv', v.id, ok ? 1 : 0, ok, { q: v.base, x: past.value + ' / ' + pp.value, a: v.past + ' / ' + v.pp });
          [past, pp].forEach((inp, i) => {
            inp.disabled = true;
            inp.classList.add((i === 0 ? okPast : okPp) ? 'vb-ok' : 'vb-no');
          });
          const isLast = cur === items.length - 1;
          after.append(
            h('div', { class: 'explain' },
              h('div', { class: 'verdict ' + (ok ? 'ok' : 'bad') },
                ok ? '答對了' : '正確是 ' + v.past + ' / ' + v.pp),
              h('div', null, v.base + ' ' + v.zh + (v.note ? '。' + v.note : '')),
              v.example ? h('div', { class: 'tr' }, v.example) : null),
            h('div', { class: 'drill-nav-btns' },
              h('button', {
                class: 'btn primary', type: 'button',
                onclick: () => { if (isLast) summary(); else { cur++; draw(); window.scrollTo(0, 0); } },
              }, isLast ? '看本輪成績' : '下一題 →')));
          after.querySelector('.btn').focus();
        };
        [past, pp].forEach(inp => inp.addEventListener('keydown', e => {
          if (e.key !== 'Enter') return;
          if (inp === past && !answered && !pp.value) { pp.focus(); return; }
          submit();
        }));

        root.append(h('div', { class: 'q-block' },
          h('div', { class: 'vb-stem' }, v.base, h('span', null, v.zh)),
          h('div', { class: 'vb-inputs' }, past, pp,
            h('button', { class: 'btn primary', type: 'button', onclick: submit }, '對答案')),
          after));
        past.focus();
      }

      function summary() {
        root.innerHTML = '';
        const ok = results.filter(Boolean).length;
        const wrongList = items.filter((x, i) => !results[i]);
        root.append(h('div', { class: 'report-head', style: 'margin-top:26px' },
          h('h2', null, '答對 ' + ok + ' / ' + items.length),
          wrongList.length ? h('div', { class: 'band-note' }, '答錯的下一輪優先出現。') : null));
        if (wrongList.length) {
          root.append(h('div', { class: 'vq-list' }, wrongList.map(v =>
            h('div', { class: 'vq-item bad' }, h('b', null, v.base), h('span', null, v.past + ' / ' + v.pp), h('i', null, v.zh)))));
        }
        root.append(h('div', { class: 'drill-nav-btns' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => startQuiz(list) }, '再測一輪'),
          h('button', { class: 'btn', type: 'button', onclick: () => render() }, '回動詞表')));
        window.scrollTo(0, 0);
      }
    }
  }
})();
