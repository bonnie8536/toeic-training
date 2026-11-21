/* 錯題本:把題庫刷題、片語、單字、文法與自然發音錯過的東西集中起來複習。
   - 可即練:P5 錯題、聽力 P1/P2 錯題、片語錯題(答對就從錯題池移出,越早錯的越先出),用專心模式一題一題做。
   - 題組類(P6/P7/聽力對話)與單字漏接、文法待補、自然發音待補,導向各自的複習入口。 */
(function () {
  const root = $('#review-root');
  const T = window.TOEIC || {};
  const LD = T.listening || {};

  /* Part 5、聽力 1/2 的錯題跟題組錯題數用 js/wrongbook.js 算(含模擬考答錯的題,錯題本定稿 2026-11-18);沒載到就照以前只看刷題紀錄 */
  const WB = window.WRONGBOOK || null;
  function collect() {
    if (WB) {
      const items = [];
      [['5', 'p5'], ['1', 'l1'], ['2', 'l2']].forEach(([p, kind]) => WB.items(p).forEach(x => items.push({ kind, q: x.q, t: x.t || 0 })));
      const pd = store.get('phrase_drill', {});
      (T.phrases || []).forEach(p => { const r = pd[p.id]; if (r && !r.ok) items.push({ kind: 'ph', q: p, t: r.t || 0 }); });
      return items.sort((a, b) => a.t - b.t);
    }
    const items = [];
    const d5 = store.get('drill_p5', {});
    (T.part5 || []).forEach(q => { const r = d5[q.id]; if (r && !r.ok) items.push({ kind: 'p5', q, t: r.t || 0 }); });
    const l1 = store.get('listen_p1', {});
    (LD.p1 || []).forEach(q => { const r = l1[q.id]; if (r && !r.ok) items.push({ kind: 'l1', q, t: r.t || 0 }); });
    const l2 = store.get('listen_p2', {});
    (LD.p2 || []).forEach(q => { const r = l2[q.id]; if (r && !r.ok) items.push({ kind: 'l2', q, t: r.t || 0 }); });
    const pd = store.get('phrase_drill', {});
    (T.phrases || []).forEach(p => { const r = pd[p.id]; if (r && !r.ok) items.push({ kind: 'ph', q: p, t: r.t || 0 }); });
    return items.sort((a, b) => a.t - b.t);
  }

  function otherCounts() {
    const c = { sets: 0, lsets: 0, vocab: 0, grammar: 0, phonics: 0 };
    if (WB) {
      c.sets = WB.setCount('6') + WB.setCount('7');
      c.lsets = WB.setCount('3') + WB.setCount('4');
    } else ['6', '7'].forEach(p => {
      const st = store.get('drill_p' + p, {});
      (T['part' + p] || []).forEach(set => {
        if (set.questions.some((q, qi) => {
          const k = set.id + ':' + (q.num !== undefined ? q.num : qi);
          return st[k] && !st[k].ok;
        })) c.sets++;
      });
    });
    if (!WB) ['3', '4'].forEach(p => {
      const st = store.get('listen_p' + p, {});
      (LD['p' + p] || []).forEach(set => {
        if (set.questions.some((q, qi) => { const k = set.id + ':' + qi; return st[k] && !st[k].ok; })) c.lsets++;
      });
    });
    c.vocab = Object.keys(store.get('vgame_miss', {})).length;
    const gd = store.get('grammar_done', {});
    (T.grammar || []).forEach(u => { const r = gd[u.id]; if (r && r.ok < r.t) c.grammar++; });
    const pd = store.get('phonics_done', {});
    (T.phonics || []).forEach(u => { const r = pd[u.id]; if (r && r.ok < r.t) c.phonics++; });
    return c;
  }

  let onHome = false;
  renderHome();
  /* 開頁先跟雲端對齊模擬考錯題(js/wrongbook.js syncCloud;審查 2026-11-19 #1):別台考的錯題合併進來時,還在首頁就重畫題數 */
  if (WB && typeof WB.syncCloud === 'function') WB.syncCloud().then(r => { if (r.changed && onHome) renderHome(); });

  /* 動態放進頁面的圖示:頁面還在載入時由 js/ui.js 在載入完成那一下統一畫,之後重畫的自己叫 */
  function art(box) {
    if (window.UI && document.readyState !== 'loading') UI.doodle(box);
  }

  function renderHome() {
    onHome = true;
    document.title = '錯題本 - 衝衝英文';
    root.replaceChildren(h('div', { class: 'page-head' },
      h('canvas', { class: 'hub-art', 'data-doodle': 'wrongbook', 'data-size': '40', 'aria-hidden': 'true' }),
      h('h1', null, '錯題本')));

    const items = collect();
    const c = otherCounts();
    const todo = items.slice(0, 20);

    const links = [];
    if (c.sets) links.push(['閱讀題組', c.sets + ' 組', 'practice.html#wrongbook']);
    if (c.lsets) links.push(['聽力題組', c.lsets + ' 組', 'practice.html#wrongbook']);
    if (c.vocab) links.push(['單字漏接', c.vocab + ' 個', 'vocab.html']);
    if (c.grammar) links.push(['文法', c.grammar + ' 課', 'grammar.html']);
    if (c.phonics) links.push(['自然發音', c.phonics + ' 課', 'phonics.html']);

    /* 什麼都沒有:整頁一個空狀態 */
    if (!items.length && !links.length) {
      root.append(UI.empty({ pose: 'sleep', text: '沒有錯題', action: { label: '去刷題', href: 'practice.html' } }));
      art(root);
      return;
    }
    if (items.length) {
      root.append(h('section', { class: 'part-card review-todo' },
        h('p', { class: 'review-todo-t' }, '待複習 ', h('b', null, String(items.length)), ' 題'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => runner(todo) }, '開始')));
    }
    if (links.length) {
      root.append(h('h2', { class: 'rv-group-h' }, '其他待複習'),
        h('ul', { class: 'rv-list' }, links.map(([name, num, href]) => h('li', null,
          h('a', { class: 'rv-row', href }, h('span', { class: 'rv-name' }, name), h('span', { class: 'rv-num' }, num))))));
    }
    art(root);
  }

  /* ================= 複習輪 ================= */
  function runner(list) {
    onHome = false;
    let cur = 0, cleared = 0;
    let player = null;
    /* 每題一答完就記下來,中途離開不會丟東西,所以關閉不再問確認;離開回錯題本首頁 */
    const f = UI.focus.enter({ total: list.length, confirmExit: false, onExit: () => { stopAudio(); renderHome(); window.scrollTo(0, 0); } });
    draw();

    function stopAudio() { if (player) { player.pause(); player = null; } }
    function draw() {
      stopAudio();
      root.replaceChildren(h('h1', { class: 'rv-sr' }, '錯題本'));
      f.progress(cur + 1);
      f.foot(null);
      drawItem(list[cur]);
      const first = root.querySelector('.opt, .letter-big');
      if (first && cur > 0) first.focus({ preventScroll: true });
    }

    /* 答完一題:底部換成回饋條,右邊是下一題(最後一題是看成績);解析放在選項下面。
       答對時回饋條多一行小字「已移出錯題本」:這題已經不在錯題本裡 */
    function after(ok, q, result) {
      const last = cur === list.length - 1;
      f.feedback({
        ok, answer: LETTERS[q.answer] + '. ' + q.options[q.answer], note: ok ? '已移出錯題本' : null, next: last ? '看成績' : '下一題',
        onNext: () => { if (last) summary(); else { cur++; draw(); window.scrollTo(0, 0); } },
      });
      if (typeof result.scrollIntoView === 'function') result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    /* c:這一下選的選項。題目可能是模擬考答錯才在錯題本(mock_wrong;錯題本定稿 1.6):
       答對:刷題紀錄那筆是答錯的就照舊刪掉(答對過的紀錄不刪,已作答數不能少);mock_wrong 那筆是答錯的,寫一筆比較新的已訂正記號
       (不然刪掉刷題紀錄後模擬考那筆會冒回來)。
       答錯:刷題紀錄那筆是答錯的就照舊把時間改成現在;刷題紀錄沒有這題、或那筆是答對的(之後模擬考答錯才進錯題本),
       刷題紀錄寫成這次 { c, ok: false, t: 現在 }(跟錯題本複習答錯時 saveRec 一樣;只改時間的話那筆答對紀錄變成最新的,題目會從錯題本消失)。
       刷題紀錄那一份真的有改才寫(只動 mock_wrong 時不整份上傳) */
    function settle(item, ok, c) {
      const keyMap = { p5: 'drill_p5', l1: 'listen_p1', l2: 'listen_p2', ph: 'phrase_drill' };
      const key = keyMap[item.kind];
      const st = store.get(key, {});
      const id = item.q.id;
      const mw = WB && item.kind !== 'ph' ? store.get('mock_wrong', null) : null;
      const m = mw && typeof mw === 'object' && !Array.isArray(mw) && mw[id] && typeof mw[id] === 'object' && !mw[id].ok ? mw[id] : null;
      const r = st[id];
      let changed = false;
      if (ok) {
        cleared++;
        if (r && !r.ok) { delete st[id]; changed = true; }
        if (m) WB.save({ [id]: { c, ok: true, t: Date.now() } });
      } else if (r && !r.ok) { r.t = Date.now(); changed = true; }
      else if (m && Number.isInteger(c)) { st[id] = { c, ok: false, t: Date.now() }; changed = true; }
      else if (r) { r.t = Date.now(); changed = true; }
      if (changed) store.set(key, st);
    }

    function optButtons(q, onPick, letterOnly) {
      const opts = h('div', { class: letterOnly ? 'letter-row' : 'opts' });
      q.options.forEach((opt, oi) => {
        opts.append(h('button', {
          class: letterOnly ? 'letter-big' : 'opt',
          /* 因為帳號那一邊存不進去時(別的分頁登出、換帳號,或帳號資料夾還沒從雲端灌好)這一下不生效,開「重新整理」卡(js/common.js holdForAccount) */
          onclick: e => { if (typeof holdForAccount === 'function' && holdForAccount(e.currentTarget)) return; onPick(oi, opts); },
        }, letterOnly ? LETTERS[oi] : h('span', { class: 'letter' }, LETTERS[oi]),
          letterOnly ? null : h('span', null, opt)));
      });
      return opts;
    }

    function grade(q, oi, opts, letterOnly) {
      [...opts.children].forEach((b, bi) => {
        b.disabled = true;
        if (bi === q.answer) b.classList.add('correct');
        else if (bi === oi) b.classList.add('wrong');
        else if (!letterOnly) b.classList.add('plain');
      });
      return oi === q.answer;
    }

    /* 詳解方塊底部加「回報題目」(js/report.js);id 跟 settle 記的題號同一套 */
    function withReport(box, m, id, audio) {
      if (window.REPORT) REPORT.attach(box, { m, id, audio: !!audio });
      return box;
    }

    function drawItem(item) {
      let done = false;
      const result = h('div', null);
      const q = item.q;
      const block = h('div', { class: 'q-block' });

      if (item.kind === 'p5') {
        block.append(
          h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, 'Part 5 · ' + q.category)),
          h('div', { class: 'q-text' }, q.question),
          optButtons(q, (oi, opts) => {
            if (done) return; done = true;
            const ok = grade(q, oi, opts);
            settle(item, ok, oi);
            result.append(withReport(h('div', { class: 'explain' },
              h('div', null, q.explanation), h('div', { class: 'tr' }, '句意：' + q.translation)), 'p5', q.id));
            after(ok, q, result);
          }), result);
      } else if (item.kind === 'ph') {
        block.append(
          h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, '片語')),
          h('div', { class: 'q-text' }, q.quiz.q),
          optButtons(q.quiz, (oi, opts) => {
            if (done) return; done = true;
            const ok = grade(q.quiz, oi, opts);
            settle(item, ok, oi);
            result.append(withReport(h('div', { class: 'explain' },
              h('div', null, q.quiz.explanation)), 'ph', q.id),
              h('div', { class: 'phrase-card' },
                h('div', { class: 'pc-head' }, h('b', null, q.phrase), h('span', null, q.zh)),
                h('div', { class: 'pc-ex' }, q.example), h('div', { class: 'pc-exzh' }, q.exampleZh)));
            after(ok, q.quiz, result);
          }), result);
      } else {
        /* 聽力 P1/P2:可重複播放(複習情境) */
        player = new Audio('audio/' + q.id + '.mp3');
        const playBtn = h('button', {
          class: 'btn player-btn', type: 'button',
          onclick: () => { player.currentTime = 0; player.play().catch(() => {}); },
        }, '▶ 播放');
        block.append(h('div', { class: 'meta', style: 'margin-bottom:8px' },
          h('span', { class: 'badge cat' }, item.kind === 'l1' ? '聽力 Part 1' : '聽力 Part 2')));
        if (item.kind === 'l1') {
          block.append(h('div', { class: 'listen-photo' }, h('img', {
            src: 'img/listening/' + q.id + '.jpg', alt: '聽力照片',
            onerror: e => e.target.replaceWith(h('div', { class: 'photo-missing' }, '照片準備中')),
          })));
        }
        block.append(h('div', { class: 'player' }, playBtn),
          h('div', { class: 'q-text', style: 'margin-top:10px' },
            item.kind === 'l1' ? '選出最符合照片的描述：' : '選出最合適的回應：'),
          optButtons(q, (oi, opts) => {
            if (done) return; done = true;
            const ok = grade(q, oi, opts, true);
            settle(item, ok, oi);
            result.append(withReport(h('div', { class: 'explain' },
              h('div', null, q.explanation)), item.kind, q.id, true),
              h('div', { class: 'transcript-box' }, h('b', null, '逐字稿'),
                h('div', { class: 'tr-en' }, (q.question ? q.question + '\n' : '') + q.options.map((o, oi2) => LETTERS[oi2] + '. ' + o).join('\n')),
                h('div', { class: 'tr-zh' }, q.transcriptZh)));
            after(ok, q, result);
          }, true), result);
      }
      root.append(block);
    }

    function summary() {
      stopAudio();
      f.leave();
      const card = UI.result({
        big: cleared, unit: '/ ' + list.length + ' 題', ratio: list.length ? cleared / list.length : 0, kicker: '清掉',
        primary: { label: '回錯題本', href: 'review.html' },
        links: [{ label: '回首頁', href: 'index.html' }],
        earnId: 'rv',
      });
      root.replaceChildren(h('h1', { class: 'rv-sr' }, '錯題本'), card.el);
      window.scrollTo(0, 0);
      card.heading.focus();
      if (window.PET_HOOK) PET_HOOK.done('rv', { n: list.length, into: card.reward });
    }
  }
})();
