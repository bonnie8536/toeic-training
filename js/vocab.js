/* 單字訓練:
   ①掉落遊戲——中文往下掉,打出英文消除;字首+字數提示;三條命;
     單字庫=閱讀文章的標記單字(帶級別),片語庫=片語特訓的 120 條;
     漏接的字會記下來,下一場優先出現。
   ②片語特訓——分家族學習(put/take/look...)+填介系詞練習,錯的優先重出。 */
(function () {
  const root = $('#vocab-root');
  const PHRASES = (window.TOEIC && TOEIC.phrases) || [];

  /* ---------- 單字池(取自文章標記單字) ---------- */
  function buildWordPool(levelName) {
    const seen = {};
    const pool = [];
    ((window.TOEIC && TOEIC.articles) || []).forEach(a => {
      if (levelName !== '全部' && !a.level.startsWith(levelName)) return;
      (a.vocab || []).forEach(v => {
        const ans = String(v.base || v.word).toLowerCase().trim();
        if (!ans || ans.length > 16 || seen[ans]) return;
        seen[ans] = true;
        pool.push({ answer: ans, zh: v.zh });
      });
    });
    return pool;
  }

  function buildPhrasePool() {
    return PHRASES.map(p => ({ answer: String(p.phrase).toLowerCase().trim(), zh: p.zh }));
  }

  function hintOf(answer) {
    return answer.split(' ').map(w => w[0] + ' '.repeat(Math.max(0, w.length - 1)).split('').join('') + '_'.repeat(0)).map((seg, i) => {
      const w = answer.split(' ')[i];
      return w[0] + ' _'.repeat(w.length - 1).replace(/ /g, '');
    }).join('  ');
  }
  /* 上面寫法繞,直接重寫:每個字=首字母+底線 */
  function hint(answer) {
    return answer.split(' ').map(w => w[0] + '_'.repeat(Math.max(0, w.length - 1))).join(' ');
  }

  const norm = s => String(s).toLowerCase().trim().replace(/\s+/g, ' ');

  /* ---------- 自訂題庫 ---------- */
  function getBanks() { return store.get('vgame_banks', []); }
  function saveBanks(banks) { store.set('vgame_banks', banks); }
  function bankPool(bank) {
    return (bank.words || []).filter(w => w.on !== false)
      .map(w => ({ answer: norm(w.en), zh: w.zh }))
      .filter(w => w.answer && w.answer.length <= 30);
  }
  /* 一行一個:「英文 中文」,也吃逗號/冒號/Tab 分隔 */
  function parseWordLine(line) {
    const s = line.trim();
    if (!s) return null;
    const m = s.match(/^(.+?)[\t,，:：]\s*(.+)$/);
    if (m && !/[一-鿿]/.test(m[1])) return { en: m[1].trim(), zh: m[2].trim() };
    const ci = s.search(/[一-鿿]/);
    if (ci > 0) return { en: s.slice(0, ci).replace(/[\t,，:：\s]+$/, ''), zh: s.slice(ci).trim() };
    return null;
  }

  /* ---------- 路由(頁內狀態) ---------- */
  renderHome();

  function renderHome() {
    document.title = '單字訓練|刷刷英文';
    root.innerHTML = '';
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '單字訓練')));

    const best = store.get('vgame_best', {});
    const missCount = Object.keys(store.get('vgame_miss', {})).length;

    /* 掉落遊戲卡 */
    const levelSel = h('select', { class: 'cfg-select' },
      ['全部', '初級', '中級', '中高級', '高級'].map(l => h('option', { value: l }, l === '全部' ? '全部級別' : l)));
    const speedSel = h('select', { class: 'cfg-select' },
      [['slow', '輕鬆'], ['normal', '標準'], ['fast', '快速']].map(([v, t]) => {
        const o = h('option', { value: v }, t);
        if (v === 'normal') o.selected = true;
        return o;
      }));
    const banks = getBanks();
    const modeSel = h('select', { class: 'cfg-select' },
      [['word', '單字'], ['phrase', '片語']].concat(banks.map(b => ['bank:' + b.id, '題庫:' + b.name]))
        .map(([v, t]) => h('option', { value: v }, t)));
    modeSel.addEventListener('change', () => { levelSel.style.display = modeSel.value === 'word' ? '' : 'none'; });

    const bestLine = ['最佳分數:單字 ' + (best['word'] || 0) + ' · 片語 ' + (best['phrase'] || 0)]
      .concat(banks.filter(b => best['bank:' + b.id]).map(b => b.name + ' ' + best['bank:' + b.id]))
      .join(' · ');
    root.append(h('div', { class: 'part-cards', style: 'grid-template-columns:1fr' },
      h('div', { class: 'part-card' },
        h('h3', null, '掉落消除'),
        h('p', null, '中文往下掉,打出英文消除它。看不出來就看字首和字數提示。漏接的字下一場會優先出現' + (missCount ? '(目前累積 ' + missCount + ' 個)' : '') + '。'),
        h('div', { class: 'p-stats' }, bestLine),
        h('div', { class: 'cfg-row' }, modeSel, levelSel, speedSel,
          h('button', {
            class: 'btn primary',
            onclick: () => startGame(modeSel.value, levelSel.value, speedSel.value),
          }, '開始遊戲')))));

    /* 我的題庫 */
    root.append(h('div', { class: 'exercise-head' },
      h('h2', null, '我的題庫'),
      h('button', { class: 'btn', style: 'margin-left:auto', onclick: () => renderBankEdit(null) }, '＋ 新增題庫')));
    if (!banks.length) {
      root.append(h('p', { class: 'result-note' }, '自己建題庫,把課本或錯過的單字丟進來,再用掉落遊戲練。一行一個「英文 中文」。'));
    } else {
      const bwrap = h('div', { class: 'part-cards', style: 'grid-template-columns:1fr 1fr' });
      banks.forEach(b => {
        const onCount = (b.words || []).filter(w => w.on !== false).length;
        const playable = onCount >= 3;
        bwrap.append(h('div', { class: 'part-card' },
          h('h3', null, b.name),
          h('div', { class: 'p-stats' }, (b.words || []).length + ' 個字 · 已勾選 ' + onCount + (playable ? '' : '(至少勾 3 個才能玩)')),
          h('div', { class: 'cfg-row' },
            h('button', {
              class: 'btn primary', disabled: playable ? null : '',
              onclick: () => startGame('bank:' + b.id, '全部', speedSel.value),
            }, '開始練習'),
            h('button', { class: 'btn', onclick: () => renderBankEdit(b.id) }, '編輯'),
            h('button', {
              class: 'btn', onclick: () => {
                if (!confirm('刪除題庫「' + b.name + '」?單字會一起刪掉。')) return;
                saveBanks(getBanks().filter(x => x.id !== b.id));
                renderHome();
              },
            }, '刪除'))));
      });
      root.append(bwrap);
    }

    /* 片語特訓 */
    root.append(h('div', { class: 'exercise-head' }, h('h2', null, '片語特訓')));
    if (!PHRASES.length) {
      root.append(h('p', { class: 'result-note' }, '片語庫生成中,稍後再來。'));
      return;
    }
    /* 動詞片語按家族分組;形容詞+介系詞/動詞+介系詞/慣用語各成一大組 */
    const groups = {};
    PHRASES.forEach(p => {
      const g = (p.type && p.type !== '動詞片語') ? p.type : (p.group || '其他');
      (groups[g] = groups[g] || []).push(p);
    });
    const drillSt = store.get('phrase_drill', {});
    const wrap = h('div', { class: 'part-cards', style: 'grid-template-columns:1fr 1fr' });
    Object.entries(groups).forEach(([g, items]) => {
      const done = items.filter(p => (drillSt[p.id] || {}).ok).length;
      const pct = Math.round(done / items.length * 100);
      const table = h('div', { class: 'phrase-table', style: 'display:none' },
        items.map(p => h('div', { class: 'phrase-row' },
          h('b', null, p.phrase),
          h('span', { class: 'ph-zh' }, p.zh),
          h('span', { class: 'ph-ex' }, p.example))));
      const toggleBtn = h('button', {
        class: 'pop-mini', type: 'button',
        onclick: () => {
          const open = table.style.display !== 'none';
          table.style.display = open ? 'none' : '';
          toggleBtn.textContent = open ? '看片語表' : '收起';
        },
      }, '看片語表');
      wrap.append(h('div', { class: 'part-card' },
        h('h3', null, g),
        h('div', { class: 'p-stats' }, items.length + ' 條 · 已答對 ' + done),
        h('div', { class: 'bar' }, h('i', { style: 'width:' + pct + '%' })),
        h('div', { class: 'cfg-row' },
          h('button', { class: 'btn primary', onclick: () => startDrill(g, items) }, '開始練習'),
          toggleBtn),
        table));
    });
    root.append(wrap, h('div', { style: 'height:40px' }));
  }

  /* ================= 題庫編輯 ================= */
  function renderBankEdit(bankId) {
    const banks = getBanks();
    let bank = banks.find(b => b.id === bankId);
    if (!bank) {
      bank = { id: 'b' + Date.now().toString(36), name: '', words: [] };
      banks.push(bank);
    }
    document.title = '編輯題庫|刷刷英文';
    root.innerHTML = '';
    const nameInput = h('input', {
      class: 'game-input', type: 'text', value: bank.name,
      placeholder: '題庫名稱(例如:第 3 課、動物單字)', maxlength: '20', style: 'max-width:320px',
    });
    const bulkInput = h('textarea', {
      class: 'write-area', style: 'min-height:110px',
      placeholder: '一行一個「英文 中文」,例如:\napple 蘋果\nput on 穿上\nschedule,行程表',
    });
    const status = h('div', { class: 'result-note' });
    const listWrap = h('div', null);

    function persist() {
      bank.name = nameInput.value.trim() || '未命名題庫';
      saveBanks(banks);
    }
    function drawList() {
      listWrap.innerHTML = '';
      if (!bank.words.length) return;
      const onCount = bank.words.filter(w => w.on !== false).length;
      listWrap.append(h('div', { class: 'p-stats', style: 'margin:14px 0 6px' },
        bank.words.length + ' 個字 · 勾選 ' + onCount + ' 個要練(取消勾選=暫時不練,不會刪掉)'));
      bank.words.forEach(w => {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = w.on !== false;
        cb.addEventListener('change', () => { w.on = cb.checked; persist(); drawList(); });
        listWrap.append(h('div', { class: 'bank-word' },
          h('label', { class: 'bank-word-main' }, cb,
            h('b', null, w.en), h('span', { class: 'bank-word-zh' }, w.zh)),
          h('button', {
            class: 'bank-word-del', type: 'button', title: '刪除這個字',
            onclick: () => { bank.words = bank.words.filter(x => x !== w); persist(); drawList(); },
          }, '✕')));
      });
    }
    function addBulk() {
      const lines = bulkInput.value.split('\n');
      let added = 0, updated = 0, skipped = 0;
      lines.forEach(line => {
        const p = parseWordLine(line);
        if (!p || !p.en || !p.zh || p.en.length > 30) { if (line.trim()) skipped++; return; }
        const key = norm(p.en);
        const exist = bank.words.find(w => norm(w.en) === key);
        if (exist) { exist.zh = p.zh; updated++; }
        else { bank.words.push({ en: p.en, zh: p.zh, on: true }); added++; }
      });
      persist();
      bulkInput.value = '';
      status.textContent = '加入 ' + added + ' 個' + (updated ? ',更新 ' + updated + ' 個' : '') +
        (skipped ? ',有 ' + skipped + ' 行看不懂(要有英文和中文)' : '');
      drawList();
    }

    nameInput.addEventListener('change', persist);
    root.append(
      h('div', { class: 'drill-top' },
        h('h1', null, bankId ? '編輯題庫' : '新增題庫'),
        h('a', { href: 'vocab.html', style: 'font-size:13.5px;margin-left:auto', onclick: e => { e.preventDefault(); persist(); renderHome(); } }, '← 完成,回單字訓練')),
      h('div', { class: 'q-block' },
        nameInput,
        bulkInput,
        h('div', { class: 'pop-btns', style: 'margin-top:10px' },
          h('button', { class: 'btn primary', type: 'button', onclick: addBulk }, '加入單字')),
        status,
        listWrap));
    drawList();
    if (!bankId) nameInput.focus();
  }

  /* ================= 掉落遊戲 ================= */
  function startGame(mode, levelName, speedKey) {
    let pool, bankName = '';
    if (mode.startsWith('bank:')) {
      const bank = getBanks().find(b => 'bank:' + b.id === mode);
      if (!bank) { renderHome(); return; }
      bankName = bank.name;
      pool = bankPool(bank);
      if (pool.length < 3) { renderHome(); return; }
    } else {
      pool = mode === 'word' ? buildWordPool(levelName) : buildPhrasePool();
      if (pool.length < 8) { renderHome(); return; }
    }
    document.title = '掉落消除|刷刷英文';
    root.innerHTML = '';

    const BASE_SPEED = { slow: 15, normal: 23, fast: 34 }[speedKey];
    const missPool = store.get('vgame_miss', {});
    let score = 0, lives = 3, combo = 0;
    let blocks = [];
    let lastSpawn = 0, lastTime = 0;
    let running = true, over = false;
    let rafId = null;
    const recent = [];
    const missedThisGame = [];

    const scoreEl = h('span', { class: 'hud-score' }, '0');
    const livesEl = h('span', { class: 'hud-lives' });
    const field = h('div', { class: 'game-field' });
    const input = h('input', {
      class: 'game-input', type: 'text',
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: '打出英文按 Enter',
    });
    const pauseBtn = h('button', { class: 'btn', type: 'button', onclick: togglePause }, '暫停');

    function drawLives() {
      livesEl.textContent = '♥'.repeat(lives) + '♡'.repeat(3 - lives);
    }
    drawLives();

    root.append(
      h('div', { class: 'drill-top' },
        h('h1', null, '掉落消除 ', h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' },
          bankName ? '題庫:' + bankName : mode === 'word' ? '單字' + (levelName !== '全部' ? ' · ' + levelName : '') : '片語')),
        h('a', { href: 'vocab.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回單字訓練')),
      h('div', { class: 'game-hud' },
        h('span', null, '分數 ', scoreEl), livesEl, pauseBtn),
      field,
      h('div', { class: 'game-input-row' }, input));
    input.focus();

    function pickItem() {
      const live = new Set(blocks.map(b => b.answer));
      /* 30% 機率抽漏接過的字 */
      const missKeys = Object.keys(missPool).filter(k => !live.has(k) && pool.some(p => p.answer === k));
      if (missKeys.length && Math.random() < 0.3) {
        const k = missKeys[Math.floor(Math.random() * missKeys.length)];
        return pool.find(p => p.answer === k);
      }
      const candidates = pool.filter(p => !live.has(p.answer) && !recent.includes(p.answer));
      const list = candidates.length ? candidates : pool.filter(p => !live.has(p.answer));
      return list[Math.floor(Math.random() * list.length)];
    }

    function spawn() {
      const item = pickItem();
      if (!item) return;
      recent.push(item.answer);
      if (recent.length > 10) recent.shift();
      const el = h('div', { class: 'fall-block' },
        h('div', { class: 'fb-zh' }, item.zh),
        h('div', { class: 'fb-hint' }, hint(item.answer)));
      field.append(el);
      const maxX = Math.max(0, field.clientWidth - el.offsetWidth - 8);
      const x = 4 + Math.random() * maxX;
      el.style.left = x + 'px';
      blocks.push({ el, answer: item.answer, zh: item.zh, y: -el.offsetHeight, speed: BASE_SPEED * (1 + Math.min(0.4, score / 500)) });
    }

    function loop(t) {
      if (!running) return;
      if (!lastTime) lastTime = t;
      const dt = Math.min(0.05, (t - lastTime) / 1000);
      lastTime = t;
      const interval = Math.max(1600, 3200 - score * 8);
      if (t - lastSpawn > interval && blocks.length < 4) {
        lastSpawn = t;
        spawn();
      }
      const H = field.clientHeight;
      blocks = blocks.filter(b => {
        b.y += b.speed * dt;
        b.el.style.transform = 'translateY(' + b.y + 'px)';
        if (b.y + b.el.offsetHeight >= H) {
          miss(b);
          return false;
        }
        return true;
      });
      rafId = requestAnimationFrame(loop);
    }

    function miss(b) {
      b.el.classList.add('missed');
      setTimeout(() => b.el.remove(), 400);
      lives--;
      drawLives();
      combo = 0;
      missedThisGame.push({ answer: b.answer, zh: b.zh });
      missPool[b.answer] = (missPool[b.answer] || 0) + 1;
      store.set('vgame_miss', missPool);
      if (lives <= 0) gameOver();
    }

    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const val = norm(input.value);
      if (!val) return;
      /* 打中最低(最危險)的那一個 */
      const hits = blocks.filter(b => norm(b.answer) === val).sort((a, b2) => b2.y - a.y);
      if (hits.length) {
        const b = hits[0];
        blocks = blocks.filter(x => x !== b);
        b.el.classList.add('boom');
        setTimeout(() => b.el.remove(), 260);
        combo++;
        score += b.answer.replace(/\s/g, '').length + (combo >= 5 ? 2 : 0);
        scoreEl.textContent = String(score);
        /* 打對過的字從漏接池移除 */
        if (missPool[b.answer]) {
          delete missPool[b.answer];
          store.set('vgame_miss', missPool);
        }
        input.value = '';
      } else {
        combo = 0;
        input.classList.remove('wrong');
        void input.offsetWidth;
        input.classList.add('wrong');
      }
    });

    function togglePause() {
      if (over) return;
      running = !running;
      pauseBtn.textContent = running ? '暫停' : '繼續';
      if (running) {
        lastTime = 0;
        rafId = requestAnimationFrame(loop);
        input.focus();
      } else if (rafId) {
        cancelAnimationFrame(rafId);
      }
    }

    function gameOver() {
      over = true;
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      blocks.forEach(b => b.el.remove());
      blocks = [];
      input.disabled = true;
      const bestKey = mode;
      const best = store.get('vgame_best', {});
      const isBest = score > (best[bestKey] || 0);
      if (isBest) {
        best[bestKey] = score;
        store.set('vgame_best', best);
      }
      const overlay = h('div', { class: 'game-over' },
        h('h2', null, '結束!分數 ' + score + (isBest ? '(新紀錄)' : '')),
        missedThisGame.length
          ? h('div', { class: 'miss-list' },
              h('b', null, '漏接的字(下一場會優先出現):'),
              missedThisGame.map(m => h('div', { class: 'miss-item' },
                h('span', { class: 'miss-en' }, m.answer), h('span', null, m.zh))))
          : h('p', null, '一個都沒漏,太強了。'),
        h('div', { class: 'drill-nav-btns', style: 'justify-content:center' },
          h('button', { class: 'btn primary', onclick: () => startGame(mode, levelName, speedKey) }, '再玩一次'),
          h('button', { class: 'btn', onclick: renderHome }, '回單字訓練')));
      field.append(overlay);
    }

    rafId = requestAnimationFrame(loop);
  }

  /* ================= 片語特訓 ================= */
  function startDrill(groupName, items) {
    document.title = '片語特訓|刷刷英文';
    const st = store.get('phrase_drill', {});
    /* 錯的與沒做過的優先 */
    const shuffle = arr => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const fresh = items.filter(p => !st[p.id]);
    const wrong = items.filter(p => st[p.id] && !st[p.id].ok);
    const done = items.filter(p => st[p.id] && st[p.id].ok);
    const list = [...shuffle(fresh), ...shuffle(wrong), ...shuffle(done)].slice(0, 10);
    const results = [];
    let cur = 0;
    draw();

    function draw() {
      root.innerHTML = '';
      root.append(h('div', { class: 'drill-top' },
        h('h1', null, '片語特訓 ', h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' }, groupName)),
        h('a', { href: 'vocab.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回單字訓練')));
      const nav = h('div', { class: 'q-nav' });
      list.forEach((x, i) => {
        let cls = i === cur ? 'cur' : '';
        if (results[i] === true) cls += ' ok';
        if (results[i] === false) cls += ' ng';
        nav.append(h('button', { class: cls.trim(), disabled: '' }, String(i + 1)));
      });
      root.append(nav);
      drawQuestion(list[cur]);
    }

    function drawQuestion(p) {
      let doneQ = false;
      const result = h('div', null);
      const opts = h('div', { class: 'opts', style: 'margin-top:10px' });
      p.quiz.options.forEach((opt, oi) => {
        opts.append(h('button', {
          class: 'opt',
          onclick: () => {
            if (doneQ) return;
            doneQ = true;
            const ok = oi === p.quiz.answer;
            results[cur] = ok;
            const st2 = store.get('phrase_drill', {});
            st2[p.id] = { ok };
            store.set('phrase_drill', st2);
            [...opts.children].forEach((b, bi) => {
              b.disabled = true;
              if (bi === p.quiz.answer) b.classList.add('correct');
              else if (bi === oi) b.classList.add('wrong');
              else b.classList.add('plain');
            });
            const isLast = cur === list.length - 1;
            result.append(
              h('div', { class: 'explain' },
                h('div', { class: 'verdict ' + (ok ? 'ok' : 'bad') },
                  ok ? '答對了' : '答錯了,正確是 ' + p.quiz.options[p.quiz.answer]),
                h('div', null, p.quiz.explanation)),
              h('div', { class: 'phrase-card' },
                h('div', { class: 'pc-head' }, h('b', null, p.phrase), h('span', null, p.zh)),
                p.tip ? h('div', { class: 'pc-tip' }, p.tip) : null,
                h('div', { class: 'pc-ex' }, p.example),
                h('div', { class: 'pc-exzh' }, p.exampleZh)),
              h('div', { class: 'drill-nav-btns' },
                h('button', {
                  class: 'btn primary',
                  onclick: () => {
                    if (isLast) summary();
                    else { cur++; draw(); window.scrollTo(0, 0); }
                  },
                }, isLast ? '看本輪成績' : '下一題 →')));
          },
        }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
      });
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'q-text', style: 'font-size:17px' }, p.quiz.q),
        opts, result));
    }

    function summary() {
      root.innerHTML = '';
      const ok = results.filter(Boolean).length;
      root.append(h('div', { class: 'report-head', style: 'margin-top:26px' },
        h('h2', null, groupName + ':' + ok + ' / ' + list.length),
        h('div', { class: 'band-note' }, ok === list.length ? '全對!' : '答錯的下一輪會優先出現。')));
      root.append(h('div', { class: 'drill-nav-btns' },
        h('button', { class: 'btn primary', onclick: () => startDrill(groupName, items) }, '再練一輪'),
        h('button', { class: 'btn', onclick: renderHome }, '回單字訓練')));
      window.scrollTo(0, 0);
    }
  }
})();
