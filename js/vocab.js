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

  /* 中文答案的可接受寫法:「上傳;上載」「(使)滿意」這類拆成多個可接受變體 */
  function zhVariants(zh) {
    const list = String(zh).split(/[;;、,,/()()「」\s]+/).map(x => x.trim()).filter(x => x && /[一-鿿]/.test(x));
    return list.length ? list : [String(zh).trim()];
  }

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
    const dirSel = h('select', { class: 'cfg-select' },
      [['z2e', '中翻英(打英文)'], ['e2z', '英翻中(打中文)']].map(([v, t]) => h('option', { value: v }, t)));

    const modeNames = { word: '單字', phrase: '片語' };
    banks.forEach(b => { modeNames['bank:' + b.id] = b.name; });
    const bestParts = Object.entries(best).filter(([, v]) => v).map(([k, v]) => {
      const e2z = k.endsWith(':e2z');
      const nm = modeNames[e2z ? k.slice(0, -4) : k];
      return nm ? nm + (e2z ? '(英翻中)' : '') + ' ' + v : null;
    }).filter(Boolean);
    const bestLine = bestParts.length ? '最佳 ' + bestParts.join(' · ') : '';
    root.append(h('div', { class: 'part-cards', style: 'grid-template-columns:1fr' },
      h('div', { class: 'part-card' },
        h('h3', null, '掉落消除'),
        h('p', null, '打出翻譯消除掉下來的字;漏接的下一場優先出現' + (missCount ? '(目前 ' + missCount + ' 個)' : '') + '。'),
        bestLine ? h('div', { class: 'p-stats' }, bestLine) : null,
        h('div', { class: 'cfg-row' }, modeSel, dirSel, levelSel, speedSel,
          h('button', {
            class: 'btn primary',
            onclick: () => startGame(modeSel.value, levelSel.value, speedSel.value, dirSel.value),
          }, '開始遊戲')))));

    /* 更多玩法:翻牌配對 / 記憶吐司 / 單字選擇題(共用同一套字池) */
    const modeSel2 = h('select', { class: 'cfg-select' },
      [['word', '單字'], ['phrase', '片語']].concat(banks.map(b => ['bank:' + b.id, '題庫:' + b.name]))
        .map(([v, t]) => h('option', { value: v }, t)));
    const levelSel2 = h('select', { class: 'cfg-select' },
      ['全部', '初級', '中級', '中高級', '高級'].map(l => h('option', { value: l }, l === '全部' ? '全部級別' : l)));
    const dirSel2 = h('select', { class: 'cfg-select' },
      [['e2z', '看英文選中文'], ['z2e', '看中文選英文']].map(([v, t]) => h('option', { value: v }, t)));
    modeSel2.addEventListener('change', () => { levelSel2.style.display = modeSel2.value === 'word' ? '' : 'none'; });
    root.append(h('div', { class: 'part-cards', style: 'grid-template-columns:1fr' },
      h('div', { class: 'part-card' },
        h('h3', null, '更多玩法'),
        h('div', { class: 'cfg-row' }, modeSel2, levelSel2, dirSel2, h('span', { class: 'toolbar-note', style: 'align-self:center' }, '方向只影響選擇題')),
        h('div', { class: 'cfg-row' },
          h('button', { class: 'btn primary', onclick: () => startPairs(modeSel2.value, levelSel2.value) }, '翻牌配對'),
          h('button', { class: 'btn primary', onclick: () => startToast(modeSel2.value, levelSel2.value) }, '記憶吐司'),
          h('button', { class: 'btn primary', onclick: () => startMcq(modeSel2.value, levelSel2.value, dirSel2.value) }, '單字選擇題')))));

    /* 我的題庫 */
    root.append(h('div', { class: 'exercise-head' },
      h('h2', null, '我的題庫'),
      h('button', { class: 'btn', style: 'margin-left:auto', onclick: () => renderBankEdit(null) }, '＋ 新增題庫')));
    if (!banks.length) {
      root.append(h('p', { class: 'result-note' }, '還沒有題庫。'));
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
              onclick: () => startGame('bank:' + b.id, '全部', speedSel.value, dirSel.value),
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
        bank.words.length + ' 個字,練 ' + onCount + ' 個(取消勾選不會刪掉)'));
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
  function startGame(mode, levelName, speedKey, dir) {
    dir = dir === 'e2z' ? 'e2z' : 'z2e';
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
      placeholder: dir === 'e2z' ? '打出中文意思按 Enter' : '打出英文按 Enter',
    });
    const pauseBtn = h('button', { class: 'btn', type: 'button', onclick: togglePause }, '暫停');

    function drawLives() {
      livesEl.textContent = '♥'.repeat(lives) + '♡'.repeat(3 - lives);
    }
    drawLives();

    root.append(
      h('div', { class: 'drill-top' },
        h('h1', null, '掉落消除 ', h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' },
          (bankName ? '題庫:' + bankName : mode === 'word' ? '單字' + (levelName !== '全部' ? ' · ' + levelName : '') : '片語') +
          ' · ' + (dir === 'e2z' ? '英翻中' : '中翻英'))),
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
      /* 中翻英:中文掉下來+字首提示;英翻中:英文掉下來+中文字數提示 */
      const shown = dir === 'e2z' ? item.answer : item.zh;
      const hintText = dir === 'e2z' ? '◯'.repeat(zhVariants(item.zh)[0].length) : hint(item.answer);
      const el = h('div', { class: 'fall-block' },
        h('div', { class: 'fb-zh' }, shown),
        h('div', { class: 'fb-hint' }, hintText));
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
      /* 中文輸入法選字中的 Enter 不算送出 */
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key !== 'Enter') return;
      const raw = input.value.trim();
      const val = norm(raw);
      if (!val) return;
      /* 打中最低(最危險)的那一個 */
      const match = dir === 'e2z'
        ? b => raw === String(b.zh).trim() || zhVariants(b.zh).indexOf(raw) > -1
        : b => norm(b.answer) === val;
      const hits = blocks.filter(match).sort((a, b2) => b2.y - a.y);
      if (hits.length) {
        const b = hits[0];
        blocks = blocks.filter(x => x !== b);
        b.el.classList.add('boom');
        setTimeout(() => b.el.remove(), 260);
        combo++;
        score += (dir === 'e2z' ? raw.length * 2 : b.answer.replace(/\s/g, '').length) + (combo >= 5 ? 2 : 0);
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
      const bestKey = mode + (dir === 'e2z' ? ':e2z' : '');
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
              h('b', null, '漏接的字'),
              missedThisGame.map(m => h('div', { class: 'miss-item' },
                h('span', { class: 'miss-en' }, m.answer), h('span', null, m.zh))))
          : h('p', null, '沒有漏接。'),
        h('div', { class: 'drill-nav-btns', style: 'justify-content:center' },
          h('button', { class: 'btn primary', onclick: () => startGame(mode, levelName, speedKey, dir) }, '再玩一次'),
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
            st2[p.id] = { ok, t: Date.now() };
            store.set('phrase_drill', st2);
            logAttempt('ph', p.id, oi, ok);
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
      const note = ok === list.length ? '' : '答錯的下一輪優先出現。';
      root.append(h('div', { class: 'report-head', style: 'margin-top:26px' },
        h('h2', null, groupName + ':' + ok + ' / ' + list.length),
        note ? h('div', { class: 'band-note' }, note) : null));
      root.append(h('div', { class: 'drill-nav-btns' },
        h('button', { class: 'btn primary', onclick: () => startDrill(groupName, items) }, '再練一輪'),
        h('button', { class: 'btn', onclick: renderHome }, '回單字訓練')));
      window.scrollTo(0, 0);
    }
  }

  /* ================= 更多玩法:共用工具 ================= */
  function poolFor(mode, levelName) {
    if (mode.startsWith('bank:')) {
      const bank = getBanks().find(b => 'bank:' + b.id === mode);
      if (!bank) return { pool: [], name: '' };
      return { pool: bankPool(bank), name: '題庫:' + bank.name };
    }
    if (mode === 'phrase') return { pool: buildPhrasePool(), name: '片語' };
    return { pool: buildWordPool(levelName), name: '單字' + (levelName !== '全部' ? ' · ' + levelName : '') };
  }
  function shuffleArr(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  /* 抽 n 個:漏接池裡的字優先(最多一半),其餘隨機 */
  function pickN(pool, n) {
    const missPool = store.get('vgame_miss', {});
    const missed = shuffleArr(pool.filter(p => missPool[p.answer])).slice(0, Math.floor(n / 2));
    const rest = shuffleArr(pool.filter(p => !missed.includes(p))).slice(0, n - missed.length);
    return shuffleArr([...missed, ...rest]);
  }
  /* 干擾選項:先從 prefer(同一盤的字)挑,不夠再從整個字池補;中英都不能與正解相同 */
  function distractors(pool, item, n, prefer) {
    const diff = p => p.answer !== item.answer && p.zh !== item.zh;
    const first = shuffleArr((prefer || []).filter(diff));
    const more = shuffleArr(pool.filter(p => diff(p) && !first.includes(p)));
    return [...first, ...more].slice(0, n);
  }
  function markMiss(item, ok) {
    const missPool = store.get('vgame_miss', {});
    if (ok) {
      if (!missPool[item.answer]) return;
      delete missPool[item.answer];
    } else missPool[item.answer] = (missPool[item.answer] || 0) + 1;
    store.set('vgame_miss', missPool);
  }
  function gameTop(title, sub) {
    return h('div', { class: 'drill-top' },
      h('h1', null, title + ' ', h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' }, sub)),
      h('a', { href: 'vocab.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回單字訓練'));
  }
  function tooSmall(pool, min) {
    if (pool.length >= min) return false;
    alert('這個字池只有 ' + pool.length + ' 個字,至少要 ' + min + ' 個才能玩。');
    renderHome();
    return true;
  }

  /* ================= 翻牌配對 ================= */
  function startPairs(mode, levelName) {
    const { pool, name } = poolFor(mode, levelName);
    if (tooSmall(pool, 3)) return;
    const items = pickN(pool, Math.min(8, pool.length));
    document.title = '翻牌配對|刷刷英文';
    root.innerHTML = '';
    const cards = shuffleArr(items.flatMap((it, i) => [{ k: i, face: it.answer, en: true }, { k: i, face: it.zh, en: false }]));
    let first = null, lock = false, moves = 0, matched = 0, startT = 0, timer = null;
    const movesEl = h('span', { class: 'hud-score' }, '0');
    const timeEl = h('span', { class: 'hud-score' }, '0');
    const grid = h('div', { class: 'mem-grid' });
    root.append(gameTop('翻牌配對', name + ' · ' + items.length + ' 對'),
      h('div', { class: 'game-hud' }, h('span', null, '步數 ', movesEl), h('span', null, '秒數 ', timeEl)),
      h('p', { class: 'result-note' }, '翻兩張,英文配它的中文。'),
      grid);
    cards.forEach(c => {
      c.el = h('button', { class: 'mem-card' + (c.en ? '' : ' zh'), type: 'button', onclick: () => flip(c) }, '?');
      grid.append(c.el);
    });
    const tick = () => { timeEl.textContent = String(Math.round((Date.now() - startT) / 1000)); };
    function flip(c) {
      if (lock || c.done || c === first) return;
      if (!startT) { startT = Date.now(); timer = setInterval(tick, 500); }
      c.el.classList.add('flipped');
      c.el.textContent = c.face;
      if (!first) { first = c; return; }
      moves++;
      movesEl.textContent = String(moves);
      if (first.k === c.k) {
        first.done = c.done = true;
        first.el.classList.add('matched');
        c.el.classList.add('matched');
        first = null;
        matched++;
        if (matched === items.length) finish();
        return;
      }
      lock = true;
      const a = first;
      first = null;
      setTimeout(() => {
        [a, c].forEach(x => { x.el.classList.remove('flipped'); x.el.textContent = '?'; });
        lock = false;
      }, 850);
    }
    function finish() {
      clearInterval(timer);
      tick();
      const secs = Math.round((Date.now() - startT) / 1000);
      const key = mode + ':' + items.length;
      const best = store.get('vgame_pairs_best', {});
      const prev = best[key];
      const isBest = !prev || moves < prev.moves || (moves === prev.moves && secs < prev.secs);
      if (isBest) { best[key] = { moves, secs }; store.set('vgame_pairs_best', best); }
      logAttempt('vq', 'pairs', moves, true, { q: '翻牌配對 ' + name + ':' + items.length + ' 對', x: moves + ' 步 · ' + secs + ' 秒', g: 'pairs' });
      const note = prev && !isBest ? '最佳紀錄 ' + prev.moves + ' 步 · ' + prev.secs + ' 秒' : '';
      root.append(h('div', { class: 'report-head', style: 'margin-top:20px' },
        h('h2', null, '完成!' + moves + ' 步 · ' + secs + ' 秒' + (isBest ? '(新紀錄)' : '')),
        note ? h('div', { class: 'band-note' }, note) : null),
        h('div', { class: 'drill-nav-btns' },
          h('button', { class: 'btn primary', onclick: () => startPairs(mode, levelName) }, '再玩一次'),
          h('button', { class: 'btn', onclick: renderHome }, '回單字訓練')));
    }
  }

  /* ================= 記憶吐司:限時記 6 個字,烤好後逐題考意思 ================= */
  function startToast(mode, levelName) {
    const { pool, name } = poolFor(mode, levelName);
    if (tooSmall(pool, 4)) return;
    const items = pickN(pool, Math.min(6, pool.length));
    const SHOW_MS = 15000;
    document.title = '記憶吐司|刷刷英文';
    root.innerHTML = '';
    const bar = h('i', { style: 'width:100%' });
    const grid = h('div', { class: 'toast-grid' },
      items.map(it => h('div', { class: 'toast-card' }, h('b', null, it.answer), h('span', null, it.zh))));
    root.append(gameTop('記憶吐司', name),
      h('p', { class: 'result-note' }, '15 秒內記住這 ' + items.length + ' 個字,之後考中文意思。'),
      h('div', { class: 'toast-timer' }, bar), grid,
      h('div', { class: 'drill-nav-btns' }, h('button', { class: 'btn primary', type: 'button', onclick: () => quiz() }, '直接開考')));
    const t0 = Date.now();
    const iv = setInterval(() => {
      const left = Math.max(0, SHOW_MS - (Date.now() - t0));
      bar.style.width = (left / SHOW_MS * 100) + '%';
      if (!left) quiz();
    }, 100);
    let started = false;

    function quiz() {
      if (started) return;
      started = true;
      clearInterval(iv);
      const order = shuffleArr(items);
      const results = [];
      let cur = 0;
      draw();

      function draw() {
        root.innerHTML = '';
        root.append(gameTop('記憶吐司', name + ' · 第 ' + (cur + 1) + ' / ' + order.length + ' 題'));
        const it = order[cur];
        const opts = shuffleArr([it, ...distractors(pool, it, 3, items)]);
        const ai = opts.indexOf(it);
        let done = false;
        const optsEl = h('div', { class: 'opts', style: 'margin-top:10px' });
        const after = h('div', null);
        opts.forEach((o, oi) => {
          optsEl.append(h('button', {
            class: 'opt',
            onclick: () => {
              if (done) return;
              done = true;
              const ok = oi === ai;
              results.push({ it, ok });
              markMiss(it, ok);
              logAttempt('vq', it.answer, oi, ok, { q: it.answer, o: opts.map(x => x.zh), a: ai, g: 'toast' });
              [...optsEl.children].forEach((b, bi) => {
                b.disabled = true;
                b.classList.add(bi === ai ? 'correct' : bi === oi ? 'wrong' : 'plain');
              });
              const isLast = cur === order.length - 1;
              after.append(h('div', { class: 'drill-nav-btns' },
                h('button', { class: 'btn primary', onclick: () => { if (isLast) summary(); else { cur++; draw(); } } },
                  isLast ? '看成績' : '下一題 →')));
            },
          }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, o.zh)));
        });
        root.append(h('div', { class: 'q-block' },
          h('div', { class: 'toast-stem' }, it.answer),
          optsEl, after));
      }

      function summary() {
        root.innerHTML = '';
        const okN = results.filter(r => r.ok).length;
        const best = store.get('vgame_toast_best', {});
        const isBest = okN > (best[mode] || 0);
        if (isBest) { best[mode] = okN; store.set('vgame_toast_best', best); }
        const note = okN === results.length ? '' : '記錯的字在掉落遊戲會優先出現。';
        root.append(h('div', { class: 'report-head', style: 'margin-top:26px' },
          h('h2', null, '記憶吐司:' + okN + ' / ' + results.length + (isBest && okN ? '(新紀錄)' : '')),
          note ? h('div', { class: 'band-note' }, note) : null),
          h('div', { class: 'vq-list' }, results.map(r => h('div', { class: 'vq-item' + (r.ok ? '' : ' bad') },
            h('b', null, r.it.answer), h('span', null, r.it.zh), h('i', null, r.ok ? '✓' : '✗')))),
          h('div', { class: 'drill-nav-btns' },
            h('button', { class: 'btn primary', onclick: () => startToast(mode, levelName) }, '再烤一盤'),
            h('button', { class: 'btn', onclick: renderHome }, '回單字訓練')));
        window.scrollTo(0, 0);
      }
    }
  }

  /* ================= 單字選擇題 ================= */
  function startMcq(mode, levelName, dir) {
    dir = dir === 'z2e' ? 'z2e' : 'e2z';
    const { pool, name } = poolFor(mode, levelName);
    if (tooSmall(pool, 4)) return;
    const list = pickN(pool, Math.min(10, pool.length));
    const results = [];
    let cur = 0;
    document.title = '單字選擇題|刷刷英文';
    const face = o => (dir === 'e2z' ? o.zh : o.answer);
    draw();

    function draw() {
      root.innerHTML = '';
      root.append(gameTop('單字選擇題', name + ' · ' + (dir === 'e2z' ? '看英文選中文' : '看中文選英文')));
      const nav = h('div', { class: 'q-nav' });
      list.forEach((x, i) => {
        let cls = i === cur ? 'cur' : '';
        if (results[i] === true) cls += ' ok';
        if (results[i] === false) cls += ' ng';
        nav.append(h('button', { class: cls.trim(), disabled: '' }, String(i + 1)));
      });
      root.append(nav);
      const it = list[cur];
      const opts = shuffleArr([it, ...distractors(pool, it, 3)]);
      const ai = opts.indexOf(it);
      const stem = dir === 'e2z' ? it.answer : it.zh;
      let done = false;
      const optsEl = h('div', { class: 'opts', style: 'margin-top:10px' });
      const after = h('div', null);
      opts.forEach((o, oi) => {
        optsEl.append(h('button', {
          class: 'opt',
          onclick: () => {
            if (done) return;
            done = true;
            const ok = oi === ai;
            results[cur] = ok;
            markMiss(it, ok);
            logAttempt('vq', it.answer, oi, ok, { q: stem, o: opts.map(face), a: ai, g: 'mcq' });
            [...optsEl.children].forEach((b, bi) => {
              b.disabled = true;
              b.classList.add(bi === ai ? 'correct' : bi === oi ? 'wrong' : 'plain');
            });
            const isLast = cur === list.length - 1;
            after.append(
              h('div', { class: 'explain' },
                h('div', { class: 'verdict ' + (ok ? 'ok' : 'bad') }, ok ? '答對了' : '答錯了,正確是 ' + face(it)),
                h('div', null, h('b', null, it.answer), ' ', h('span', null, it.zh))),
              h('div', { class: 'drill-nav-btns' },
                h('button', {
                  class: 'btn primary',
                  onclick: () => { if (isLast) summary(); else { cur++; draw(); window.scrollTo(0, 0); } },
                }, isLast ? '看本輪成績' : '下一題 →')));
          },
        }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, face(o))));
      });
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'toast-stem' }, stem),
        optsEl, after));
    }

    function summary() {
      root.innerHTML = '';
      const okN = results.filter(Boolean).length;
      const wrong = list.filter((x, i) => !results[i]);
      root.append(h('div', { class: 'report-head', style: 'margin-top:26px' },
        h('h2', null, '單字選擇題:' + okN + ' / ' + list.length),
        wrong.length ? h('div', { class: 'band-note' }, '答錯的字在掉落遊戲會優先出現。') : null),
        wrong.length ? h('div', { class: 'vq-list' }, wrong.map(x => h('div', { class: 'vq-item bad' }, h('b', null, x.answer), h('span', null, x.zh), h('i', null, '✗')))) : null,
        h('div', { class: 'drill-nav-btns' },
          h('button', { class: 'btn primary', onclick: () => startMcq(mode, levelName, dir) }, '再練一輪'),
          h('button', { class: 'btn', onclick: renderHome }, '回單字訓練')));
      window.scrollTo(0, 0);
    }
  }
})();
