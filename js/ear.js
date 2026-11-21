/* 聽力訓練(耳朵基本功):全部自動對答。
   ①句子聽寫:聽音檔打出整句,逐字比對標色。
   ②相似音辨析:句中辨認 coffee/copy 這類易混字。
   ③數字與價格:thirteen/thirty、時間、金額的辨聽。
   音檔可重複播放(訓練用);紀錄存 ear_d / ear_mp / ear_n(雲端同步)。
   作答用專心模式(UI.focus):頂端進度列、底部固定列放按鈕與即時回饋;做完用結算卡(UI.result)。 */
(function () {
  const root = $('#ear-root');
  const E = (window.TOEIC && TOEIC.ear) || null;

  if (!E || !E.dictation || !E.dictation.length) {
    root.append(UI.empty({ pose: 'read', text: '聽力訓練教材準備中' }));
    return;
  }

  const SECTIONS = {
    s: { key: 'ear_s', title: '句子跟讀', items: E.shadow || E.dictation, per: 5 },
    d: { key: 'ear_d', title: '句子聽寫', items: E.dictation, per: 5 },
    mp: { key: 'ear_mp', title: '相似音辨析', items: E.pairs, per: 10 },
    n: { key: 'ear_n', title: '數字與價格', items: E.numbers, per: 10 },
  };
  const LEVELS = ['全部', '初級', '中級', '進階'];
  const levelCls = lv => (lv === '初級' ? 'level-basic' : lv === '進階' ? 'level-high' : 'level-mid');

  function stats(sec, level) {
    const st = store.get(SECTIONS[sec].key, {});
    let total = 0, done = 0;
    SECTIONS[sec].items.forEach(q => {
      if (level && level !== '全部' && q.level !== level) return;
      total++;
      if (st[q.id]) done++;
    });
    return { total, done };
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
    const sel = h('select', { class: 'cfg-select speed-sel', 'aria-label': '播放速度' },
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
      class: 'btn player-btn', type: 'button',
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

  /* 輸入框拿到焦點、手機鍵盤跳出來時(可視範圍縮掉一大塊),底部固定列改回內容後面,不蓋住輸入框,也不被鍵盤蓋住。
     回傳關掉監聽的函式 */
  function typingGuard(el) {
    const vv = window.visualViewport;
    const html = document.documentElement;
    if (!vv) return () => {};
    const sync = () => html.classList.toggle('ear-kb', document.activeElement === el && window.innerHeight - vv.height > 120);
    const later = () => setTimeout(sync, 300);
    vv.addEventListener('resize', sync);
    el.addEventListener('focus', later);
    el.addEventListener('blur', later);
    return () => {
      vv.removeEventListener('resize', sync);
      el.removeEventListener('focus', later);
      el.removeEventListener('blur', later);
      html.classList.remove('ear-kb');
    };
  }

  const sec = getParam('sec');
  if (sec && SECTIONS[sec]) startRound(sec);
  else renderHome();

  /* ================= 首頁 ================= */
  function renderHome() {
    document.title = '聽力訓練 - 衝衝英文';
    let level = '全部';
    const grid = h('div', { class: 'tile-grid ear-tiles' });
    /* 級別是一排小圓鈕,選了以後四個入口的數字與連結一起換 */
    const chips = h('div', { class: 'drill-filters ear-levels', 'data-nosnippet': '', role: 'group', 'aria-label': '級別' },
      LEVELS.map(lv => h('button', {
        class: 'chip' + (lv === level ? ' on' : ''), type: 'button', 'aria-pressed': lv === level ? 'true' : 'false',
        onclick: e => {
          level = lv;
          [...chips.children].forEach(c => { const on = c === e.currentTarget; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
          paint();
        },
      }, lv)));
    root.replaceChildren(
      h('div', { class: 'page-head' },
        h('canvas', { class: 'hub-art', 'data-doodle': 'listening', 'data-size': '40', 'aria-hidden': 'true' }),
        h('h1', null, '聽力訓練')),
      chips, grid);
    paint();
    if (window.UI) UI.doodle(root);

    function paint() {
      grid.replaceChildren(...Object.entries(SECTIONS).map(([k, d]) => {
        const s = stats(k, level);
        const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
        const kids = [
          h('h2', null, d.title),
          h('p', null, h('span', { 'data-nosnippet': '' }, s.done + ' / ' + s.total + ' 題')),
          h('span', { class: 'ear-bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + pct + '%' })),
        ];
        /* 這個級別沒有題目:不做成連結 */
        if (!s.total) return h('div', { class: 'module-card tile part-card ear-tile is-off' }, ...kids);
        return h('a', {
          class: 'module-card tile part-card ear-tile', 'data-gate': '',   // 開始一輪:沒登入時 js/profile.js 先攔下(不換頁);直接開 ?sec= 照樣看得到題目
          href: 'listening.html?sec=' + k + (level !== '全部' ? '&lv=' + encodeURIComponent(level) : ''),
        }, ...kids);
      }));
    }
  }

  /* ================= 一輪練習 ================= */
  function startRound(sec) {
    const d = SECTIONS[sec];
    const level = getParam('lv') || '全部';
    document.title = d.title + ' - 聽力訓練 - 衝衝英文';
    const list = pick(sec, d.per, level);
    if (!list.length) { renderHome(); return; }
    const results = [];
    let cur = 0;
    let player = null;
    let guardOff = null;
    const f = UI.focus.enter({
      total: list.length,
      onExit: () => { stopAll(); location.href = 'listening.html'; },
    });
    draw();

    function stopAll() {
      if (player) player.stop();
      player = null;
      if (guardOff) guardOff();
      guardOff = null;
    }
    function isLast() { return cur === list.length - 1; }
    function nextLabel() { return isLast() ? '看成績' : '下一題'; }
    function goNext() {
      if (isLast()) summary();
      else { cur++; draw(); window.scrollTo(0, 0); }
    }
    /* 答完一題:記下對錯,底部變成回饋條,按鈕是「下一題」(最後一題「看成績」) */
    function answered(ok, answer) {
      results[cur] = ok;
      f.dirty(true);
      f.feedback({ ok, answer, next: nextLabel(), onNext: goNext });
    }

    function draw() {
      stopAll();
      f.progress(cur + 1);
      f.foot(null);
      root.replaceChildren(h('div', { class: 'drill-top' },
        h('h1', null, d.title, level !== '全部' ? h('span', { class: 'ear-lv' }, level) : null)));
      if (sec === 's') { drawShadow(list[cur]); return; }
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
      const stage = h('div', { class: 'shadow-stage' }, '聽完跟著唸');
      const result = h('div', null);
      const startBtn = h('button', { class: 'btn primary player-btn', type: 'button', 'data-gate': '', onclick: run }, '▶ 開始');   // 跟讀做完會記完成:要登入
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' },
          h('span', { class: 'badge ' + levelCls(q.level) }, q.level)),
        stage,
        h('div', { class: 'player', style: 'justify-content:center' }, startBtn, speedSelect([en, zh])),
        result));

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
        /* 在使用者點擊的手勢內先解鎖中文音檔(否則稍後 zh.play() 會被瀏覽器自動播放限制擋下,卡在中文確認) */
        if (!zh._unlocked) {
          zh._unlocked = true;
          zh.muted = true;
          const up = zh.play();
          if (up && up.then) up.then(() => { zh.pause(); zh.currentTime = 0; zh.muted = false; }).catch(() => { zh.muted = false; });
          else zh.muted = false;
        }
        const seq = [
          () => { setStage('仔細聽'); playStage(en); },
          () => { setStage('換你唸', true); timer = setTimeout(step, pauseLen()); },
          () => { setStage('再聽一次'); playStage(en); },
          () => { setStage('再唸一次', true); timer = setTimeout(step, pauseLen()); },
          () => { setStage('中文確認'); playStage(zh); },
          finish,
        ];
        let i = 0;
        function step() { const fn = seq[i++]; if (fn) fn(); }
        /* 播完/播不了/逾時都往下走,任何情況不卡關 */
        function playStage(a) {
          let moved = false;
          const go = () => { if (!moved) { moved = true; step(); } };
          a.onended = go;
          a.onerror = go;
          try { a.currentTime = 0; } catch (e) { /* 尚未載入 */ }
          const p = a.play();
          if (p && p.catch) p.catch(() => { setStage('音檔播放失敗'); timer = setTimeout(go, 800); });
          timer = setTimeout(go, 20000);
        }
        step();
      }
      function finish() {
        setStage('完成');
        results[cur] = true;
        save('s', q.id, true);
        f.dirty(true);
        startBtn.disabled = false;
        startBtn.textContent = '▶ 再來一次';
        startBtn.classList.remove('primary');
        running = false;
        if (!result.children.length) {
          result.append(
            h('div', { class: 'transcript-box' },
              h('div', { class: 'tr-en' }, q.text),
              h('div', { class: 'tr-zh' }, q.zh + (q.note && q.note !== '無' ? '\n' + q.note : ''))));
          const next = h('button', { class: 'btn primary', type: 'button', onclick: goNext }, nextLabel());
          f.foot([next]);
          next.focus({ preventScroll: true });
        }
      }
      en.addEventListener('error', () => setStage('音檔載入失敗'));
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
      const input = h('textarea', { class: 'write-area', placeholder: '把聽到的句子打在這裡', autocapitalize: 'off', spellcheck: 'false', 'aria-label': '聽到的句子', 'data-gate': '' });
      const result = h('div', null);
      const checkBtn = h('button', { class: 'btn primary', type: 'button', 'data-gate': '', onclick: check }, '對答案');
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' },
          h('span', { class: 'badge ' + levelCls(q.level) }, q.level)),
        player.el,
        input,
        result));
      f.foot([checkBtn]);
      guardOff = typingGuard(input);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); check(); } });

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
        save('d', q.id, perfect, { text: input.value });
        input.readOnly = true;
        result.append(
          withReport(h('div', { class: 'explain' },
            perfect ? null : h('div', { class: 'ear-hit' }, '對了 ' + hits + ' / ' + ansWords.length + ' 個字'),
            h('div', { class: 'dict-diff' },
              diff.map(x => h('span', { class: 'dict-word ' + (x.hit ? 'hit' : 'miss') }, x.w))),
            q.note && q.note !== '無' ? h('div', { class: 'tr' }, q.note) : null,
            h('div', { class: 'tr' }, q.zh)), q.id));
        input.blur();
        answered(perfect, perfect ? null : q.text);
      }
    }

    /* 詳解方塊底部加「回報題目」(js/report.js);題目 id 就是題號,三種練習共用 */
    function withReport(box, id) {
      if (window.REPORT) REPORT.attach(box, { m: 'ear', id, audio: true });
      return box;
    }

    /* --- 相似音 --- */
    function drawPair(q) {
      let done = false;
      const result = h('div', null);
      const btns = h('div', { class: 'pair-row' });
      q.options.forEach((opt, oi) => {
        btns.append(h('button', {
          class: 'pair-btn', type: 'button', 'data-gate': '',
          onclick: () => {
            if (done) return;
            done = true;
            const ok = oi === q.answer;
            save('mp', q.id, ok);
            [...btns.children].forEach((b, bi) => {
              b.disabled = true;
              if (bi === q.answer) b.classList.add('correct');
              else if (bi === oi) b.classList.add('wrong');
            });
            result.append(
              withReport(h('div', { class: 'explain' },
                h('div', null, q.note),
                h('div', { class: 'tr' }, q.audioText + '\n' + q.zh)), q.id));
            answered(ok, q.options[q.answer]);
          },
        }, opt));
      });
      root.append(h('div', { class: 'q-block' },
        player.el,
        h('div', { class: 'q-text', style: 'margin-top:8px' }, '句子裡出現的是哪個字？'),
        btns, result));
    }

    /* --- 數字 --- */
    function drawNumber(q) {
      let done = false;
      const result = h('div', null);
      const opts = h('div', { class: 'opts', style: 'margin-top:8px' });
      q.options.forEach((opt, oi) => {
        opts.append(h('button', {
          class: 'opt', type: 'button', 'data-gate': '',
          onclick: () => {
            if (done) return;
            done = true;
            const ok = oi === q.answer;
            save('n', q.id, ok);
            [...opts.children].forEach((b, bi) => {
              b.disabled = true;
              if (bi === q.answer) b.classList.add('correct');
              else if (bi === oi) b.classList.add('wrong');
              else b.classList.add('plain');
            });
            result.append(
              withReport(h('div', { class: 'explain' },
                h('div', null, q.note),
                h('div', { class: 'tr' }, q.audioText + '\n' + q.zh)), q.id));
            answered(ok, LETTERS[q.answer] + '. ' + q.options[q.answer]);
          },
        }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
      });
      root.append(h('div', { class: 'q-block' },
        player.el,
        h('div', { class: 'q-text', style: 'margin-top:8px' }, q.question),
        opts, result));
    }

    function summary() {
      stopAll();
      f.leave();
      const ok = results.filter(Boolean).length;
      const card = UI.result({
        score: ok, total: list.length, kicker: d.title,
        primary: { label: '再做一次', onClick: () => { card.destroy(); startRound(sec); } },
        links: [{ label: '回聽力訓練', href: 'listening.html' }],
      });
      root.replaceChildren(card.el);
      window.scrollTo(0, 0);
      card.heading.focus({ preventScroll: true });
      if (window.PET_HOOK) PET_HOOK.done('e' + sec, { n: list.length, into: card.reward });
    }
  }
})();
