/* 自然發音:跟文法區一樣的章節路徑(左邊 1、2、3… 站點,一課一顆小圈),
   一課=一個發音規則:講解+例字(點了聽)+容易混的對比字+小試身手(聽音選字、規則判斷)。
   完成紀錄存 phonics_done(雲端同步),作答記進學習記錄(模組碼 pn)。
   音檔:audio/ph-<單字>.mp3、audio/ph-s-<課id>-<第幾句>.mp3(tools/gen_phonics_audio.py 產生);
   音檔載不到就改用瀏覽器內建的英文語音唸。 */
(function () {
  const root = $('#phonics-root');
  const UNITS = (window.TOEIC && TOEIC.phonics) || [];

  if (!UNITS.length) {
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' }, '自然發音教材準備中，稍後再來。'));
    return;
  }

  /* 章名:跟 data/raw/phonics_ch*.json 的章字母對應 */
  const STAGES = {
    a: { name: '第一章 短母音' },
    b: { name: '第二章 易錯子音與字首連綴' },
    c: { name: '第三章 sh、ch、th 與 ng' },
    d: { name: '第四章 長母音與 c、g 的軟音' },
    e: { name: '第五章 字尾子音與 -s、-ed' },
    f: { name: '第六章 雙母音與其他母音' },
    g: { name: '第七章 母音加 r' },
    h: { name: '第八章 多音節、重音與弱讀' },
  };
  const stageOf = u => u.id.charAt(1);
  const stageKeys = [...new Set(UNITS.map(stageOf))];
  stageKeys.forEach((k, i) => { if (!STAGES[k]) STAGES[k] = { name: '第 ' + (i + 1) + ' 章' }; });
  const shortName = s => s.replace(/^第.章\s*/, '');

  /* ================= 播放 ================= */
  const slug = w => String(w).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const player = new Audio();
  let playingBtn = null;
  let slow = !!store.get('ph_slow', false);

  function stopMark() {
    if (playingBtn) playingBtn.classList.remove('playing');
    playingBtn = null;
  }
  player.addEventListener('ended', stopMark);
  player.addEventListener('pause', stopMark);

  function speak(text) {
    if (!text || !('speechSynthesis' in window)) { stopMark(); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = slow ? 0.7 : 0.95;
      u.onend = stopMark;
      speechSynthesis.speak(u);
    } catch (e) { stopMark(); }
  }

  /* file=音檔名(不含 .mp3),text=音檔壞掉時讓瀏覽器唸的英文 */
  function play(file, text, btn) {
    try { player.pause(); } catch (e) {}
    try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {}
    stopMark();
    if (btn) { playingBtn = btn; btn.classList.add('playing'); }
    player.onerror = () => speak(text);
    player.src = 'audio/' + file + '.mp3';
    player.defaultPlaybackRate = player.playbackRate = slow ? 0.7 : 1;
    const p = player.play();
    if (p && p.catch) p.catch(() => speak(text));
  }
  const playWord = (w, btn) => play('ph-' + slug(w), w, btn);

  /* 把 mark 裡 [ ] 框起來的字母標紅 */
  function marked(mark, word) {
    const box = h('span', { class: 'ph-w' });
    if (!mark || mark.replace(/[[\]]/g, '') !== word) { box.textContent = word; return box; }
    mark.split(/(\[[^\]]+\])/).filter(Boolean).forEach(part => {
      if (part.charAt(0) === '[') box.append(h('b', { class: 'ph-hl' }, part.slice(1, -1)));
      else box.append(part);
    });
    return box;
  }

  const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  function wordBtn(w, zh, mark, cls) {
    const btn = h('button', { class: 'ph-card' + (cls ? ' ' + cls : ''), type: 'button', 'aria-label': '播放 ' + w },
      h('span', { class: 'ph-spk', html: SPEAKER }),
      marked(mark, w),
      zh ? h('span', { class: 'ph-zh' }, zh) : null);
    btn.addEventListener('click', () => playWord(w, btn));
    return btn;
  }

  function slowToggle() {
    const b = h('button', { class: 'ph-slow' + (slow ? ' on' : ''), type: 'button', 'aria-pressed': slow ? 'true' : 'false' }, '慢速');
    b.addEventListener('click', () => {
      slow = !slow;
      store.set('ph_slow', slow);
      $$('.ph-slow').forEach(x => { x.classList.toggle('on', slow); x.setAttribute('aria-pressed', slow ? 'true' : 'false'); });
    });
    return b;
  }

  /* ================= 路由 ================= */
  const uid = getParam('u');
  const unit = UNITS.find(x => x.id === uid);
  if (unit) renderUnit(unit);
  else if (getParam('ref') === 'chart' || getParam('ch') === 'z') renderChart();
  else renderHome();

  function widen() {
    const m = root.closest('main');
    if (m) { m.classList.remove('container-narrow'); m.classList.add('container'); }
  }

  /* ================= 左側路徑(沿用文法區的樣式) ================= */
  function buildRail(activeStage, currentId, onPickStage) {
    const done = store.get('phonics_done', {});
    const stations = h('div', { class: 'gx-stations' });
    const pathWrap = h('div', { class: 'gx-pathwrap' });
    const rail = h('nav', { class: 'gx-rail', 'aria-label': '章節' }, stations, pathWrap);
    const OFFS = [0, 16, 28, 16, 0, -16, -28, -16];
    stageKeys.forEach((sk, si) => {
      const list = UNITS.filter(u => stageOf(u) === sk);
      const doneN = list.filter(u => done[u.id]).length;
      const pct = Math.round(doneN / list.length * 100);
      const active = sk === activeStage;
      stations.append(h(onPickStage ? 'button' : 'a', {
        class: 'gx-station' + (active ? ' on' : '') + (doneN === list.length ? ' full' : ''),
        type: onPickStage ? 'button' : null,
        href: onPickStage ? null : 'phonics.html?ch=' + sk,
        title: STAGES[sk].name + '（' + doneN + '/' + list.length + '）',
        onclick: onPickStage ? () => onPickStage(sk) : null,
      },
        h('span', { class: 'gx-ring', style: 'background:conic-gradient(var(--ok) ' + pct + '%, var(--line) 0)' },
          h('span', null, String(si + 1)))));
      if (!active) return;
      const path = h('div', { class: 'gx-path' });
      const nextId = (list.find(u => !done[u.id]) || {}).id;
      list.forEach((u, i) => {
        path.append(h('a', {
          class: 'gx-node' + (done[u.id] ? ' done' : '') + (u.id === currentId ? ' cur' : '') +
            (!currentId && u.id === nextId ? ' next' : ''),
          href: 'phonics.html?u=' + u.id,
          title: (i + 1) + '. ' + u.title,
          style: 'transform:translateX(' + OFFS[i % OFFS.length] + 'px)',
        }, String(i + 1)));
      });
      pathWrap.append(
        h('div', { class: 'gx-path-title' }, h('b', null, shortName(STAGES[sk].name)), h('i', null, doneN + ' / ' + list.length)),
        path);
    });
    /* 全部章節之後:發音總表 */
    const sumOn = activeStage === 'z';
    stations.append(h('a', {
      class: 'gx-station gx-station-sum' + (sumOn ? ' on' : ''),
      href: 'phonics.html?ref=chart', title: '發音總表',
    }, h('span', { class: 'gx-ring' }, h('span', null, '總'))));
    if (sumOn) {
      pathWrap.append(h('div', { class: 'gx-path-title' }, h('b', null, '發音總表'), h('i', null, '每個音一個代表字')),
        h('div', { class: 'gx-path' }, h('a', { class: 'gx-node gx-node-ref cur', href: 'phonics.html?ref=chart', title: '發音總表' }, '表')));
    }

    setTimeout(() => {
      const st = stations.querySelector('.gx-station.on');
      if (st && stations.scrollWidth > stations.clientWidth) stations.scrollLeft = st.offsetLeft - stations.clientWidth / 2;
      const n = pathWrap.querySelector('.gx-node.cur') || pathWrap.querySelector('.gx-node.next');
      if (!n) return;
      if (pathWrap.scrollHeight > pathWrap.clientHeight) pathWrap.scrollTop = n.offsetTop - pathWrap.clientHeight / 2;
      if (pathWrap.scrollWidth > pathWrap.clientWidth) pathWrap.scrollLeft = n.offsetLeft - pathWrap.clientWidth / 2;
    }, 0);
    return rail;
  }

  /* ================= 首頁 ================= */
  function renderHome() {
    document.title = '自然發音|刷刷英文';
    widen();
    const done = store.get('phonics_done', {});
    const todo = UNITS.find(u => !done[u.id]) || null;
    let stage = getParam('ch');
    if (!STAGES[stage] || !stageKeys.includes(stage)) stage = todo ? stageOf(todo) : stageKeys[0];
    const layout = h('div', { class: 'gx-layout' });
    root.append(layout);
    draw();

    function draw() {
      layout.innerHTML = '';
      const list = UNITS.filter(u => stageOf(u) === stage);
      const doneN = list.filter(u => done[u.id]).length;
      const col = h('div', { class: 'gx-col' },
        h('div', { class: 'page-head' }, h('h1', null, '自然發音')),
        todo ? h('div', { class: 'gx-continue' },
          h('a', { class: 'btn primary', href: 'phonics.html?u=' + todo.id }, '繼續上課'),
          h('span', null, STAGES[stageOf(todo)].name.replace(/\s.*$/, '') + ' 第 ' +
            (UNITS.filter(u => stageOf(u) === stageOf(todo)).indexOf(todo) + 1) + ' 課')) : null,
        h('div', { class: 'exercise-head' },
          h('h2', null, STAGES[stage].name),
          h('span', { style: 'margin-left:auto;font-size:13.5px;color:var(--ink-light)' }, doneN + '/' + list.length)));
      list.forEach((u, i) => {
        col.append(h('a', { class: 'gx-unit-row' + (done[u.id] ? ' done' : '') + (todo && u.id === todo.id ? ' next' : ''), href: 'phonics.html?u=' + u.id },
          h('span', { class: 'n' }, String(i + 1)),
          h('span', { class: 't' }, u.title),
          u.key && u.key.kk ? h('span', { class: 'ph-row-kk' }, '[' + u.key.kk + ']') : null));
      });
      if (stage === stageKeys[stageKeys.length - 1]) {
        col.append(h('a', { class: 'gx-unit-row gx-appendix', href: 'phonics.html?ref=chart' },
          h('span', { class: 'n' }, '表'),
          h('span', { class: 't' }, '發音總表', h('i', null, '每個音一個代表字，點了聽'))));
      }
      col.append(h('div', { style: 'height:40px' }));
      layout.append(buildRail(stage, null, sk => { stage = sk; draw(); window.scrollTo(0, 0); }), col);
    }
  }

  /* ================= 發音總表 ================= */
  function renderChart() {
    document.title = '發音總表|自然發音';
    widen();
    const done = store.get('phonics_done', {});
    const col = h('div', { class: 'gx-col' },
      h('div', { class: 'drill-top' },
        h('h1', null, '發音總表'),
        slowToggle(),
        h('a', { href: 'phonics.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回自然發音')));
    stageKeys.forEach(sk => {
      col.append(h('h2', { class: 'ph-chart-h' }, STAGES[sk].name));
      const grid = h('div', { class: 'ph-chart' });
      UNITS.filter(u => stageOf(u) === sk).forEach(u => {
        const k = u.key || {};
        const play = h('button', { class: 'ph-chart-play', type: 'button', 'aria-label': '播放 ' + k.word },
          h('span', { class: 'ph-spk', html: SPEAKER }), h('span', null, k.word || ''));
        play.addEventListener('click', () => playWord(k.word, play));
        grid.append(h('div', { class: 'ph-chart-row' + (done[u.id] ? ' done' : '') },
          h('span', { class: 'ph-chart-kk' }, k.kk ? '[' + k.kk + ']' : ''),
          play,
          h('a', { href: 'phonics.html?u=' + u.id }, u.title)));
      });
      col.append(grid);
    });
    col.append(h('div', { style: 'height:40px' }));
    root.append(h('div', { class: 'gx-layout' }, buildRail('z', null, null), col));
  }

  /* ================= 單元 ================= */
  function renderUnit(u) {
    document.title = u.title + '|自然發音';
    const idx = UNITS.indexOf(u);
    widen();
    const col = h('div', { class: 'gx-col' });
    root.append(h('div', { class: 'gx-layout' }, buildRail(stageOf(u), u.id, null), col));
    col.append(h('div', { class: 'drill-top' },
      h('h1', null, u.title),
      h('a', { href: 'phonics.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回自然發音')));
    col.append(h('div', { class: 'gx-goal' }, u.goal));

    /* 這課的音:KK+代表字 */
    const k = u.key || {};
    const keyBtn = h('button', { class: 'ph-key-play', type: 'button', 'aria-label': '播放 ' + k.word },
      h('span', { class: 'ph-spk', html: SPEAKER }), h('span', null, k.word || ''));
    keyBtn.addEventListener('click', () => playWord(k.word, keyBtn));
    col.append(h('div', { class: 'ph-key' },
      k.kk ? h('span', { class: 'ph-key-kk' }, '[' + k.kk + ']') : null,
      keyBtn,
      h('span', { class: 'ph-key-hint' }, '每個字都可以點來聽'),
      slowToggle()));

    /* 講解 */
    const lesson = h('div', { class: 'lesson-view' });
    let sentNo = 0;
    u.lesson.forEach(b => {
      if (b.t === 'p') lesson.append(h('p', { class: 'gx-p' }, b.text));
      else if (b.t === 'tip') lesson.append(h('div', { class: 'gx-tip' }, b.text));
      else if (b.t === 'words') {
        if (b.title) lesson.append(h('div', { class: 'ph-sub' }, b.title));
        lesson.append(h('div', { class: 'ph-grid' }, (b.items || []).map(it => wordBtn(it.w, it.zh, it.mark))));
      } else if (b.t === 'pairs') {
        if (b.title) lesson.append(h('div', { class: 'ph-sub' }, b.title));
        const box = h('div', { class: 'ph-pairs' });
        (b.items || []).forEach(it => {
          box.append(h('div', { class: 'ph-pair' },
            wordBtn(it.a, it.az, null),
            h('span', { class: 'ph-vs' }, '／'),
            wordBtn(it.b, it.bz, null),
            it.note ? h('div', { class: 'ph-pair-note' }, it.note) : null));
        });
        lesson.append(box);
      } else if (b.t === 'sent') {
        sentNo++;
        const file = 'ph-s-' + u.id + '-' + sentNo;
        const btn = h('button', { class: 'ph-sent-play', type: 'button', 'aria-label': '播放句子', html: SPEAKER });
        btn.addEventListener('click', () => play(file, b.en, btn));
        lesson.append(h('div', { class: 'ph-sent' }, btn,
          h('div', null, h('div', { class: 'ph-sent-en' }, b.en), h('div', { class: 'ph-sent-zh' }, b.zh))));
      }
    });
    col.append(lesson);

    /* 小試身手 */
    col.append(h('div', { class: 'exercise-head', style: 'margin-top:26px' }, h('h2', null, '小試身手')));
    const results = [];
    const quizWrap = h('div', null);
    u.quiz.forEach((q, qi) => {
      let answered = false;
      const result = h('div', null);
      const opts = h('div', { class: 'opts' });
      const isListen = q.type === 'listen';
      q.options.forEach((opt, oi) => {
        opts.append(h('button', {
          class: 'opt',
          onclick: () => {
            if (answered) return;
            answered = true;
            results[qi] = oi === q.answer;
            logAttempt('pn', u.id + ':' + qi, oi, results[qi]);
            [...opts.children].forEach((btn, bi) => {
              btn.disabled = true;
              if (bi === q.answer) btn.classList.add('correct');
              else if (bi === oi) btn.classList.add('wrong');
              else btn.classList.add('plain');
            });
            /* 答完可以把四個選項都聽一次比較 */
            const words = q.options.filter(o => /^[A-Za-z][A-Za-z'-]*$/.test(o));
            result.append(h('div', { class: 'explain' },
              h('div', { class: 'verdict ' + (results[qi] ? 'ok' : 'bad') },
                results[qi] ? '答對了' : '答錯了，正確答案是 ' + LETTERS[q.answer]),
              h('div', null, q.explanation),
              words.length === q.options.length
                ? h('div', { class: 'ph-compare' }, words.map(w => wordBtn(w, null, null, 'ph-card-sm')))
                : null));
            if (results.filter(x => x !== undefined).length === u.quiz.length) finish();
          },
        }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
      });
      let head;
      if (isListen) {
        const pb = h('button', { class: 'btn primary ph-listen', type: 'button' }, h('span', { class: 'ph-spk', html: SPEAKER }), '播放');
        pb.addEventListener('click', () => playWord(q.word, pb));
        head = h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'Q' + (qi + 1)), '聽聽看，是哪一個字？', h('div', { class: 'ph-listen-row' }, pb));
      } else {
        head = h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'Q' + (qi + 1)), q.q);
      }
      quizWrap.append(h('div', { class: 'q-block' }, head, opts, result));
    });
    col.append(quizWrap);
    const tail = h('div', null);
    col.append(tail);

    function finish() {
      const ok = results.filter(Boolean).length;
      const done = store.get('phonics_done', {});
      done[u.id] = { ok, t: u.quiz.length };
      store.set('phonics_done', done);
      const next = UNITS[idx + 1];
      tail.append(
        h('div', { class: 'report-head', style: 'margin-top:10px' },
          h('h2', null, '答對 ' + ok + ' / ' + u.quiz.length)),
        h('div', { class: 'drill-nav-btns' },
          next ? h('a', { class: 'btn primary', href: 'phonics.html?u=' + next.id }, '下一課：' + next.title) : null,
          h('a', { class: 'btn', href: 'phonics.html' }, '回自然發音')));
    }
  }
})();
