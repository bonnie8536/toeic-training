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
      root.append(UI.empty({ pose: 'sleep', text: '動詞表準備中', action: { label: '重新整理', onClick: () => location.reload() } }));
      return;
    }

    const TYPES = [
      { k: 'AAA', name: '三態同形' },
      { k: 'ABB', name: '後兩個同形' },
      { k: 'ABA', name: '頭尾同形' },
      { k: 'ABC', name: '三態都不同' },
    ];
    const LEVELS = ['全部', '初級', '中級', '進階'];

    /* 只取斜線前的第一個寫法來比對答案,兩種寫法都算對 */
    const forms = s => String(s).split('/').map(x => x.trim().toLowerCase()).filter(Boolean);
    const hit = (input, answer) => forms(answer).includes(String(input).trim().toLowerCase());

    const QUIZ_MIN = 4;   // 測驗至少要有幾個字
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
      document.title = '不規則動詞表 - 衝衝英文';
      document.documentElement.classList.remove('vb-quizzing');   // 回到動詞表:章節導覽回來
      root.innerHTML = '';
      root.append(h('div', { class: 'page-head' },
        h('canvas', { class: 'hub-art', 'data-doodle': 'verbs', 'data-size': '40', 'aria-hidden': 'true' }), h('h1', null, '不規則動詞表')));

      const list = pool();
      const st = store.get('verb_quiz', {});
      const learned = VERBS.filter(v => (st[v.id] || {}).ok).length;

      /* 工具列:搜尋、級別、變化型、遮住、測驗 */
      const search = h('input', {
        class: 'modal-input', type: 'search', value: keyword, placeholder: '找動詞',
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
          h('button', { class: 'btn primary vb-quiz-go', type: 'button', 'data-gate': '', disabled: list.length < QUIZ_MIN ? '' : null, onclick: () => startQuiz(pool()) }, '測驗這些字'),   // 開始測驗:沒登入時 js/profile.js 先攔下;不到 4 個字不能按
          h('span', { class: 'vb-count' }, list.length + ' 個字 · 已答對 ' + learned + ' / ' + VERBS.length)),
        chips);

      const body = h('div', null);
      root.append(body, h('div', { style: 'height:40px' }));
      drawTables(body, list);
      UI.doodle(root);

      function redraw() {
        const l = pool();
        body.innerHTML = '';
        drawTables(body, l);
        root.querySelector('.vb-count').textContent = l.length + ' 個字 · 已答對 ' + learned + ' / ' + VERBS.length;
        root.querySelector('.vb-quiz-go').disabled = l.length < QUIZ_MIN;
      }
    }

    function drawTables(box, list) {
      if (!list.length) {
        box.append(UI.empty({
          pose: 'sleep', text: '沒有符合的動詞',
          action: { label: '清除篩選', onClick: () => { level = '全部'; type = '全部'; keyword = ''; render(); } },
        }));
        return;
      }
      TYPES.forEach(t => {
        const items = list.filter(v => v.type === t.k);
        if (!items.length) return;
        box.append(h('div', { class: 'exercise-head', style: 'margin-top:26px' },
          h('h2', null, t.name, h('span', { class: 'vb-code' }, t.k)),
          h('span', { style: 'margin-left:auto;font-size:13.5px;color:var(--ink-light)' }, items.length + ' 個')));

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
    /* 測驗進行中與結算畫面在 <html> 加 vb-quizzing:文法頁左邊的章節導覽收起來(style.css),結算卡才會置中;回動詞表(render)時拿掉 */
    const quizClass = on => document.documentElement.classList.toggle('vb-quizzing', on);
    function startQuiz(list) {
      if (list.length < QUIZ_MIN) return;
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
      document.title = '動詞測驗 - 衝衝英文';
      /* 專心模式加即時回饋條:答完底部變成「答對」或「答錯 · 正解 …」加「下一題」。第一次作答後關閉才要確認 */
      const f = UI.focus.enter({ total: items.length, onExit: () => { quizClass(false); render(); }, confirmExit: true });
      f.dirty(false);
      quizClass(true);
      draw();

      function draw() {
        root.innerHTML = '';
        f.progress(cur + 1);
        const v = items[cur];
        /* 作答框、「對答案」標 data-gate(跟聽寫的作答框一樣):開始之後別的分頁登出、換帳號,或這台的帳號資料夾還沒灌過,
           js/profile.js 讓作答框打不進字、按鍵(包括 Enter)就開「重新整理」卡,不對答案,打好的字留著。
           以前沒標,common.js 靜靜不寫,畫面照樣對答案、跳下一題,什麼都沒存(審查 D 第 2 輪 #2) */
        const past = h('input', { class: 'modal-input vb-input', type: 'text', placeholder: '過去式', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'data-gate': '' });
        const pp = h('input', { class: 'modal-input vb-input', type: 'text', placeholder: '過去分詞', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'data-gate': '' });
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
          f.dirty(true);
          [past, pp].forEach((inp, i) => {
            inp.disabled = true;
            inp.classList.add((i === 0 ? okPast : okPp) ? 'vb-ok' : 'vb-no');
          });
          const isLast = cur === items.length - 1;
          after.append(
            h('div', { class: 'explain' },
              h('div', null, v.base + ' ' + v.zh),
              v.note ? h('div', { class: 'vb-note' }, v.note) : null,
              v.example ? h('div', { class: 'tr' }, v.example) : null));
          f.feedback({
            ok, answer: v.past + ' / ' + v.pp, next: isLast ? '看成績' : '下一題',
            onNext: () => { if (isLast) summary(); else { cur++; draw(); window.scrollTo(0, 0); } },
          });
        };
        [past, pp].forEach(inp => inp.addEventListener('keydown', e => {
          if (e.key !== 'Enter') return;
          if (inp === past && !answered && !pp.value) { pp.focus(); return; }
          submit();
        }));

        root.append(h('div', { class: 'q-block' },
          h('div', { class: 'vg-tag' }, '不規則動詞'),
          h('div', { class: 'vb-stem' }, v.base, h('span', null, v.zh)),
          h('div', { class: 'vb-inputs' }, past, pp),
          after));
        f.foot([h('button', { class: 'btn primary', type: 'button', 'data-gate': '', onclick: submit }, '對答案')]);
        past.focus();
      }

      function summary() {
        f.leave();
        root.innerHTML = '';
        const ok = results.filter(Boolean).length;
        const wrongList = items.filter((x, i) => !results[i]);
        const card = UI.result({
          score: ok, total: items.length, kicker: '不規則動詞',
          primary: { label: '再做一次', onClick: () => startQuiz(list), attrs: { 'data-gate': '' } },   // 跟「測驗這些字」一樣
          links: [{ label: '回動詞表', onClick: () => render() }],
          earnId: 'iv',
        });
        root.append(card.el);
        if (wrongList.length) {
          root.append(UI.detail('答錯的動詞 ' + wrongList.length + ' 個', [h('div', { class: 'vq-list' }, wrongList.map(v =>
            h('div', { class: 'vq-item bad' }, h('b', null, v.base), h('span', null, v.past + ' / ' + v.pp), h('i', null, v.zh))))], { wrong: 0 }));
        }
        try { card.heading.focus({ preventScroll: true }); } catch (e) { /* 沒有焦點也照常顯示 */ }
        window.scrollTo(0, 0);
      }
    }
  }
})();
