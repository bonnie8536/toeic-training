/* 聽力訓練(耳朵基本功):全部自動對答。
   ①句子聽寫:聽音檔打出整句,逐字比對標色。
   ②相似音辨析:句中辨認 coffee/copy 這類易混字。
   ③數字與價格:thirteen/thirty、時間、金額的辨聽。
   音檔可重複播放(訓練用);紀錄存 ear_d / ear_mp / ear_n(雲端同步)。 */
(function () {
  const root = $('#ear-root');
  const E = (window.TOEIC && TOEIC.ear) || null;

  if (!E || !E.dictation || !E.dictation.length) {
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' },
      '聽力訓練教材尚未載入(內容生成中,稍後再來)。'));
    return;
  }

  const SECTIONS = {
    s: { key: 'ear_s', title: '句子跟讀', items: E.shadow || E.dictation, desc: '聽一句 → 換你唸 → 再一次 → 中文確認。開口才算練到。', per: 5 },
    d: { key: 'ear_d', title: '句子聽寫', items: E.dictation, desc: '聽一句,打出整句。逐字比對,拼錯的字會標紅。', per: 5 },
    mp: { key: 'ear_mp', title: '相似音辨析', items: E.pairs, desc: '句子裡出現的是哪個字?靠耳朵分辨。', per: 10 },
    n: { key: 'ear_n', title: '數字與價格', items: E.numbers, desc: 'thirteen 還是 thirty?時間、金額、分機聽清楚。', per: 10 },
  };

  function stats(sec) {
    const st = store.get(SECTIONS[sec].key, {});
    const total = SECTIONS[sec].items.length;
    let done = 0, ok = 0;
    SECTIONS[sec].items.forEach(q => {
      const r = st[q.id];
      if (r) { done++; if (r.ok) ok++; }
    });
    return { total, done, ok };
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pick(sec, n, level) {
    const st = store.get(SECTIONS[sec].key, {});
    const fresh = [], wrong = [], done = [];
    SECTIONS[sec].items.forEach(q => {
      if (level && level !== '全部' && q.level !== level) return;
      const r = st[q.id];
      (!r ? fresh : r.ok ? done : wrong).push(q);
    });
    return [...shuffle(fresh), ...shuffle(wrong), ...shuffle(done)].slice(0, n);
  }

  function save(sec, id, ok, extra) {
    const st = store.get(SECTIONS[sec].key, {});
    st[id] = Object.assign({ ok }, extra || {});
    store.set(SECTIONS[sec].key, st);
  }

  /* 播放器:訓練用,不限次數但顯示次數;可變速 */
  function speedSelect(audios) {
    const sel = h('select', { class: 'cfg-select speed-sel' },
      [['0.75', '慢速 0.75x'], ['1', '正常 1x'], ['1.25', '快速 1.25x']].map(([v, t]) => {
        const o = h('option', { value: v }, t);
        if (v === '1') o.selected = true;
        return o;
      }));
    sel.addEventListener('change', () => audios.forEach(a => { a.playbackRate = Number(sel.value); }));
    return sel;
  }

  function makePlayer(id) {
    const audio = new Audio('audio/' + id + '.mp3');
    let plays = 0;
    const label = h('span', { class: 'player-note' });
    const btn = h('button', {
      class: 'btn primary player-btn', type: 'button',
      onclick: () => {
        plays++;
        audio.currentTime = 0;
        audio.play().catch(() => { label.textContent = '音檔載入失敗'; });
        label.textContent = '已播 ' + plays + ' 次';
        btn.textContent = '▶ 再播一次';
      },
    }, '▶ 播放');
    audio.addEventListener('error', () => { label.textContent = '找不到音檔'; btn.disabled = true; });
    return { el: h('div', { class: 'player' }, btn, speedSelect([audio]), label), stop: () => audio.pause(), plays: () => plays };
  }

  const sec = getParam('sec');
  if (sec && SECTIONS[sec]) startRound(sec);
  else renderHome();

  /* ================= 首頁 ================= */
  function renderHome() {
    document.title = '聽力訓練|刷刷英文';
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '聽力訓練'),
      h('p', null, '把耳朵磨利的基本功。可以重複聽,答錯的會優先再出現。')));
    root.append(h('div', { class: 'part-cards', style: 'grid-template-columns:1fr' },
      Object.entries(SECTIONS).map(([k, d]) => {
        const s = stats(k);
        const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
        const counts = {};
        d.items.forEach(q => { counts[q.level] = (counts[q.level] || 0) + 1; });
        const lvSel = h('select', { class: 'cfg-select' },
          [['全部', '混搭(全部)'], ['初級', '初級'], ['中級', '中級'], ['進階', '進階']]
            .filter(([v]) => v === '全部' || counts[v])
            .map(([v, t]) => h('option', { value: v }, t + (v !== '全部' ? '(' + counts[v] + ')' : ''))));
        return h('div', { class: 'part-card' },
          h('h3', null, d.title),
          h('p', null, d.desc),
          h('div', { class: 'p-stats' }, '完成 ' + s.done + '/' + s.total +
            (s.done ? ' · 一次答對率 ' + Math.round(s.ok / s.done * 100) + '%' : '')),
          h('div', { class: 'bar' }, h('i', { style: 'width:' + pct + '%' })),
          h('div', { class: 'cfg-row' }, lvSel,
            h('a', {
              class: 'btn primary', href: 'listening.html?sec=' + k,
              onclick: e => { e.currentTarget.href = 'listening.html?sec=' + k + '&lv=' + encodeURIComponent(lvSel.value); },
            }, '開始一輪(' + d.per + ' 題)')));
      })));
  }

  /* ================= 一輪練習 ================= */
  function startRound(sec) {
    const d = SECTIONS[sec];
    const level = getParam('lv') || '全部';
    document.title = d.title + '|聽力訓練';
    const list = pick(sec, d.per, level);
    if (!list.length) { renderHome(); return; }
    const results = [];
    let cur = 0;
    let player = null;
    draw();

    function draw() {
      if (player) player.stop();
      root.innerHTML = '';
      root.append(h('div', { class: 'drill-top' },
        h('h1', null, d.title, level !== '全部' ? h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' }, ' · ' + level) : null),
        h('a', { href: 'listening.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回聽力訓練')));
      const nav = h('div', { class: 'q-nav' });
      list.forEach((x, i) => {
        let cls = i === cur ? 'cur' : '';
        if (results[i] === true) cls += ' ok';
        if (results[i] === false) cls += ' ng';
        nav.append(h('button', { class: cls.trim(), disabled: '' }, String(i + 1)));
      });
      root.append(nav);
      if (sec === 's') { player = null; drawShadow(list[cur]); return; }
      player = makePlayer(list[cur].id);
      if (sec === 'd') drawDictation(list[cur]);
      else if (sec === 'mp') drawPair(list[cur]);
      else drawNumber(list[cur]);
    }

    /* --- 句子跟讀:英文 → 換你唸 → 英文 → 換你唸 → 中文 --- */
    function drawShadow(q) {
      const en = new Audio('audio/' + q.id + '.mp3');
      const zh = new Audio('audio/dz-' + (q.id.charAt(0) === 's' ? q.id : q.id.slice(2)) + '.mp3');
      player = { stop: () => { en.pause(); zh.pause(); clearTimeout(timer); } };
      let timer = null;
      let running = false;
      const stage = h('div', { class: 'shadow-stage' }, '按「開始」,聽完換你唸出來');
      const result = h('div', null);
      const startBtn = h('button', { class: 'btn primary player-btn', type: 'button', onclick: run }, '▶ 開始');
      const block = h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' },
          h('span', { class: 'badge cat' }, '跟讀'),
          h('span', { class: 'badge ' + (q.level === '初級' ? 'level-basic' : q.level === '進階' ? 'level-high' : 'level-mid') }, q.level)),
        stage,
        h('div', { class: 'player', style: 'justify-content:center' }, startBtn, speedSelect([en, zh])),
        result);
      root.append(block, nextRow(false));

      function pauseLen() {
        /* 開口複誦需要比原音更長的時間:1.6 倍音長再加緩衝 */
        return Math.max(3500, (en.duration || 3) * 1600 / (en.playbackRate || 1) + 1200);
      }
      function setStage(text, pulse) {
        stage.textContent = text;
        stage.classList.toggle('pulse', !!pulse);
      }
      function run() {
        if (running) return;
        running = true;
        startBtn.disabled = true;
        const seq = [
          () => { setStage('仔細聽…'); en.currentTime = 0; en.play(); en.onended = step; },
          () => { setStage('換你唸!', true); timer = setTimeout(step, pauseLen()); },
          () => { setStage('再聽一次…'); en.currentTime = 0; en.play(); en.onended = step; },
          () => { setStage('再唸一次!', true); timer = setTimeout(step, pauseLen()); },
          () => { setStage('中文確認'); zh.play(); zh.onended = step; },
          finish,
        ];
        let i = 0;
        function step() { const fn = seq[i++]; if (fn) fn(); }
        step();
      }
      function finish() {
        setStage('完成!');
        results[cur] = true;
        save('s', q.id, true);
        startBtn.disabled = false;
        startBtn.textContent = '▶ 再來一次';
        running = false;
        if (!result.children.length) {
          result.append(
            h('div', { class: 'transcript-box' },
              h('b', null, '句子'),
              h('div', { class: 'tr-en' }, q.text),
              h('div', { class: 'tr-zh' }, q.zh + (q.note && q.note !== '無' ? '\n難點:' + q.note : ''))),
            nextRow(true));
        }
      }
      en.addEventListener('error', () => setStage('音檔載入失敗'));
    }

    function nextRow(canNext) {
      const isLast = cur === list.length - 1;
      return h('div', { class: 'drill-nav-btns' },
        canNext
          ? h('button', {
              class: 'btn primary',
              onclick: () => { if (isLast) summary(); else { cur++; draw(); window.scrollTo(0, 0); } },
            }, isLast ? '完成這一輪' : '下一題 →')
          : null);
    }

    /* --- 聽寫 --- */
    function norm(s) {
      return String(s).toLowerCase()
        .replace(/[.,!?;:"()]/g, '')
        .replace(/[’]/g, "'")
        .replace(/\s+/g, ' ').trim();
    }
    function drawDictation(q) {
      let checked = false;
      const input = h('textarea', { class: 'write-area', style: 'min-height:60px', placeholder: '把聽到的句子打在這裡', autocapitalize: 'off', spellcheck: 'false' });
      const result = h('div', null);
      const checkBtn = h('button', { class: 'btn primary', type: 'button', onclick: check }, '對答案');
      const block = h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' },
          h('span', { class: 'badge cat' }, '聽寫'),
          h('span', { class: 'badge ' + (q.level === '初級' ? 'level-basic' : q.level === '進階' ? 'level-high' : 'level-mid') }, q.level)),
        player.el,
        input,
        h('div', { class: 'pop-btns', style: 'margin-top:10px' }, checkBtn),
        result);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
      root.append(block, nextRow(false));

      function check() {
        if (checked) return;
        const ansWords = norm(q.text).split(' ');
        const gotWords = norm(input.value).split(' ').filter(Boolean);
        /* 字袋比對(不看順序;每個答案字在輸入裡出現過就算對,一字一消;數字接受阿拉伯數字寫法) */
        const NUM = { one:'1', two:'2', three:'3', four:'4', five:'5', six:'6', seven:'7', eight:'8', nine:'9', ten:'10' };
        const same = (a, b) => a === b || NUM[a] === b || NUM[b] === a;
        const pool = gotWords.slice();
        const diff = ansWords.map(w => {
          const gi = pool.findIndex(g => same(w, g));
          if (gi > -1) pool.splice(gi, 1);
          return { w, hit: gi > -1 };
        });
        const hits = diff.filter(x => x.hit).length;
        const perfect = hits === ansWords.length && gotWords.length === ansWords.length;
        checked = true;
        results[cur] = perfect;
        save('d', q.id, perfect, { text: input.value });
        checkBtn.disabled = true;
        result.append(
          h('div', { class: 'explain' },
            h('div', { class: 'verdict ' + (perfect ? 'ok' : 'bad') },
              perfect ? '完全正確!' : '對了 ' + hits + '/' + ansWords.length + ' 個字'),
            h('div', { class: 'dict-diff' },
              diff.map(x => h('span', { class: 'dict-word ' + (x.hit ? 'hit' : 'miss') }, x.w))),
            q.note && q.note !== '無' ? h('div', { class: 'tr' }, '聽力難點:' + q.note) : null,
            h('div', { class: 'tr' }, q.zh)),
          nextRow(true));
      }
    }

    /* --- 相似音 --- */
    function drawPair(q) {
      let done = false;
      const result = h('div', null);
      const btns = h('div', { class: 'pair-row' });
      q.options.forEach((opt, oi) => {
        btns.append(h('button', {
          class: 'pair-btn', type: 'button',
          onclick: e => {
            if (done) return;
            done = true;
            const ok = oi === q.answer;
            results[cur] = ok;
            save('mp', q.id, ok);
            [...btns.children].forEach((b, bi) => {
              b.disabled = true;
              if (bi === q.answer) b.classList.add('correct');
              else if (bi === oi) b.classList.add('wrong');
            });
            result.append(
              h('div', { class: 'explain' },
                h('div', { class: 'verdict ' + (ok ? 'ok' : 'bad') }, ok ? '答對了' : '答錯了,是 ' + q.options[q.answer]),
                h('div', null, q.note),
                h('div', { class: 'tr' }, q.audioText + '\n' + q.zh)),
              nextRow(true));
          },
        }, opt));
      });
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, '相似音')),
        player.el,
        h('div', { class: 'q-text', style: 'margin-top:8px' }, '句子裡出現的是哪個字?'),
        btns, result), nextRow(false));
    }

    /* --- 數字 --- */
    function drawNumber(q) {
      let done = false;
      const result = h('div', null);
      const opts = h('div', { class: 'opts', style: 'margin-top:8px' });
      q.options.forEach((opt, oi) => {
        opts.append(h('button', {
          class: 'opt', type: 'button',
          onclick: () => {
            if (done) return;
            done = true;
            const ok = oi === q.answer;
            results[cur] = ok;
            save('n', q.id, ok);
            [...opts.children].forEach((b, bi) => {
              b.disabled = true;
              if (bi === q.answer) b.classList.add('correct');
              else if (bi === oi) b.classList.add('wrong');
              else b.classList.add('plain');
            });
            result.append(
              h('div', { class: 'explain' },
                h('div', { class: 'verdict ' + (ok ? 'ok' : 'bad') }, ok ? '答對了' : '答錯了,正確是 ' + q.options[q.answer]),
                h('div', null, q.note),
                h('div', { class: 'tr' }, q.audioText + '\n' + q.zh)),
              nextRow(true));
          },
        }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
      });
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, '數字與價格')),
        player.el,
        h('div', { class: 'q-text', style: 'margin-top:8px' }, q.question),
        opts, result), nextRow(false));
    }

    function summary() {
      if (player) player.stop();
      root.innerHTML = '';
      const ok = results.filter(Boolean).length;
      root.append(h('div', { class: 'report-head', style: 'margin-top:26px' },
        h('h2', null, d.title + ':' + ok + ' / ' + list.length),
        h('div', { class: 'band-note' }, ok === list.length ? '全對!耳朵越來越利了。' : '答錯的下一輪會優先出現。')));
      root.append(h('div', { class: 'drill-nav-btns' },
        h('button', { class: 'btn primary', onclick: () => startRound(sec) }, '再來一輪'),
        h('a', { class: 'btn', href: 'listening.html' }, '回聽力訓練')));
      window.scrollTo(0, 0);
    }
  }
})();
