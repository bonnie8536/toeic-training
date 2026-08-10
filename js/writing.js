/* 寫作練習:三個等級,每級拆成一步一步的「單元路徑」——
   一個單元只做一件事(一堂技巧課或一題練習),有上一步/下一步與完成標記,
   寫作是長期訓練,讓學生每天推進幾格。
   學生寫的內容存進自己的檔案(雲端模式自動同步);句子重組自動對答,
   其餘由範文對照+自評檢核+老師人工回饋。 */
(function () {
  const root = $('#writing-root');
  const W = (window.TOEIC && TOEIC.writing) || null;

  if (!W || !W.l1) {
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' },
      '寫作教材尚未載入。請確認 data/writing.js 存在(執行 tools/merge_data.py 產生)。'));
    return;
  }

  const KEYS = { read: 'writing_read', s: 'writing_s', b: 'writing_b', e: 'writing_e', y: 'writing_y' };
  const OUTLINE_TARGETS = [{ min: 30, max: 50 }, { min: 60, max: 90 }, { min: 70, max: 100 }, { min: 30, max: 50 }];

  /* ---------- 單元路徑(課與練習交錯,循序漸進) ---------- */
  function unitsOf(lv) {
    const L = W[lv];
    const u = [];
    const lesson = i => u.push({ t: 'lesson', ref: L.lessons[i], title: L.lessons[i].title });
    if (lv === 'l1') {
      lesson(0);
      L.scramble.slice(0, 7).forEach((s, i) => u.push({ t: 's', ref: s, title: '句子重組 ' + (i + 1), sub: s.zh }));
      lesson(1);
      L.scramble.slice(7, 14).forEach((s, i) => u.push({ t: 's', ref: s, title: '句子重組 ' + (i + 8), sub: s.zh }));
      lesson(2);
      L.scramble.slice(14).forEach((s, i) => u.push({ t: 's', ref: s, title: '句子重組 ' + (i + 15), sub: s.zh }));
      L.build.forEach((b, i) => u.push({ t: 'b', ref: b, title: '造句挑戰 ' + (i + 1), sub: b.scenario }));
    } else if (lv === 'l2') {
      lesson(0); lesson(1);
      L.emails.slice(0, 3).forEach((e, i) => u.push({ t: 'e', ref: e, title: '回信任務 ' + (i + 1), sub: e.incoming.subject }));
      lesson(2);
      L.emails.slice(3).forEach((e, i) => u.push({ t: 'e', ref: e, title: '回信任務 ' + (i + 4), sub: e.incoming.subject }));
    } else {
      lesson(0); lesson(1); lesson(2);
      L.essays.forEach((e, i) => u.push({ t: 'y', ref: e, title: '論述寫作 ' + (i + 1), sub: e.questionZh }));
    }
    return u;
  }

  function unitDone(unit) {
    const id = unit.ref.id;
    if (unit.t === 'lesson') return !!store.get(KEYS.read, {})[id];
    if (unit.t === 's') return !!(store.get(KEYS.s, {})[id] || {}).ok;
    if (unit.t === 'b') return !!((store.get(KEYS.b, {})[id] || {}).text || '').trim();
    if (unit.t === 'e') return !!((store.get(KEYS.e, {})[id] || {}).text || '').trim();
    const y = store.get(KEYS.y, {})[id] || {};
    return !!((y.text || '').trim() || ['p0', 'p1', 'p2', 'p3'].some(p => String(y[p] || '').trim()));
  }

  const TYPE_BADGE = { lesson: ['技巧課', 'level-mid'], s: ['重組', 'level-basic'], b: ['造句', 'level-basic'], e: ['Email', 'level-adv'], y: ['論述', 'level-high'] };

  function wordCount(text) {
    return (String(text || '').trim().match(/[A-Za-z''-]+/g) || []).length;
  }

  /* ---------- 路由 ---------- */
  const lv = getParam('level');
  const uParam = getParam('u');
  if (lv && W[lv] && uParam !== null) renderUnit(lv, Number(uParam));
  else if (lv && W[lv]) renderMap(lv);
  else renderHome();

  /* ================= 首頁 ================= */
  function renderHome() {
    document.title = '寫作練習|多益閱讀訓練室';
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '寫作練習'),
      h('p', null, '一個單元一小步,寫的內容會保存,老師看得到。')));
    const desc = {
      l1: '把句子寫對:重組與造句。',
      l2: '寫得體的商用回信。',
      l3: '把想法寫成短文。',
    };
    const badges = { l1: '基礎', l2: '中級', l3: '進階' };
    root.append(h('div', { class: 'part-cards' },
      ['l1', 'l2', 'l3'].map(k => {
        const units = unitsOf(k);
        const done = units.filter(unitDone).length;
        const pct = Math.round(done / units.length * 100);
        return h('a', { class: 'part-card', href: 'writing.html?level=' + k, style: 'display:block' },
          h('div', { class: 'p-label' }, 'LEVEL ' + k[1] + ' · ' + badges[k]),
          h('h3', null, W[k].title.replace(/^Level \d /, '')),
          h('p', null, desc[k]),
          h('div', { class: 'p-stats' }, units.length + ' 個單元 · 已完成 ' + done),
          h('div', { class: 'bar' }, h('i', { style: 'width:' + pct + '%' })));
      })));
  }

  /* ================= 單元地圖 ================= */
  function renderMap(lv) {
    const L = W[lv];
    const units = unitsOf(lv);
    document.title = L.title + '|多益閱讀訓練室';
    const done = units.filter(unitDone).length;
    const firstTodo = units.findIndex(u => !unitDone(u));

    root.append(h('div', { class: 'page-head' },
      h('div', { class: 'meta', style: 'margin-bottom:4px' }, h('a', { href: 'writing.html' }, '← 回寫作練習')),
      h('h1', null, L.title),
      h('p', null, '共 ' + units.length + ' 個單元 · 已完成 ' + done)));

    root.append(h('div', { class: 'diag-bar', style: 'margin-top:4px' },
      h('i', { style: 'width:' + Math.round(done / units.length * 100) + '%' })));

    if (firstTodo >= 0) {
      root.append(h('div', { style: 'margin:14px 0 6px' },
        h('a', { class: 'btn primary', href: 'writing.html?level=' + lv + '&u=' + firstTodo },
          done ? '繼續:單元 ' + (firstTodo + 1) : '從單元 1 開始')));
    }

    const list = h('div', { class: 'unit-list' });
    units.forEach((u, i) => {
      const isDone = unitDone(u);
      const [label, cls] = TYPE_BADGE[u.t];
      list.append(h('a', { class: 'unit-row' + (isDone ? ' done' : ''), href: 'writing.html?level=' + lv + '&u=' + i },
        h('span', { class: 'unit-num' + (isDone ? ' ok' : '') }, isDone ? '✓' : String(i + 1)),
        h('span', { class: 'badge ' + cls }, label),
        h('span', { class: 'unit-title' }, u.title,
          u.sub ? h('span', { class: 'unit-sub' }, u.sub) : null)));
    });
    root.append(list, h('div', { style: 'height:40px' }));
  }

  /* ================= 單元頁 ================= */
  function renderUnit(lv, idx) {
    const L = W[lv];
    const units = unitsOf(lv);
    if (!(idx >= 0 && idx < units.length)) { location.href = 'writing.html?level=' + lv; return; }
    const unit = units[idx];
    document.title = unit.title + '|' + L.title;

    root.append(h('div', { class: 'unit-head' },
      h('a', { href: 'writing.html?level=' + lv, class: 'unit-back' }, '← ' + L.title + ' 單元列表'),
      h('div', { class: 'diag-count', style: 'margin-top:8px' },
        '單元 ', h('b', null, String(idx + 1)), ' / ' + units.length,
        h('span', { class: 'badge ' + TYPE_BADGE[unit.t][1], style: 'margin-left:10px' }, TYPE_BADGE[unit.t][0])),
      h('div', { class: 'diag-bar' }, h('i', { style: 'width:' + Math.round((idx + 1) / units.length * 100) + '%' }))));

    const content = h('div', null);
    root.append(content);
    if (unit.t === 'lesson') content.append(lessonView(unit.ref, lv, idx, units));
    if (unit.t === 's') content.append(scrambleBlock(unit.ref, unit.title));
    if (unit.t === 'b') content.append(buildBlock(unit.ref, unit.title));
    if (unit.t === 'e') content.append(emailBlock(unit.ref, unit.title));
    if (unit.t === 'y') content.append(essayBlock(unit.ref, unit.title));

    /* 上一步/下一步 */
    root.append(h('div', { class: 'drill-nav-btns', style: 'margin-top:24px' },
      idx > 0 ? h('a', { class: 'btn', href: 'writing.html?level=' + lv + '&u=' + (idx - 1) }, '← 上一步') : null,
      idx < units.length - 1
        ? h('a', { class: 'btn primary', href: 'writing.html?level=' + lv + '&u=' + (idx + 1) }, '下一步 →')
        : h('a', { class: 'btn primary', href: 'writing.html?level=' + lv }, '最後一個單元了,回列表')));
  }

  /* ---------- 技巧課(整頁,寬鬆排版) ---------- */
  function lessonView(les, lv, idx, units) {
    const readMap = store.get(KEYS.read, {});
    const wrap = h('div', { class: 'lesson-view' },
      h('h2', { class: 'lesson-title' }, les.title),
      h('p', { class: 'lesson-intro' }, les.intro));
    les.points.forEach((pt, i) => {
      wrap.append(h('div', { class: 'lesson-point' },
        h('div', { class: 'lp-num' }, '要點 ' + (i + 1)),
        h('div', { class: 'lp-tip' }, pt.tip),
        h('div', { class: 'lp-ex-box' },
          h('div', { class: 'lp-ex' }, pt.example),
          h('div', { class: 'lp-zh' }, pt.exampleZh))));
    });
    if (!readMap[les.id]) {
      const btn = h('button', {
        class: 'btn primary', style: 'margin-top:6px',
        onclick: () => {
          readMap[les.id] = true;
          store.set(KEYS.read, readMap);
          btn.replaceWith(h('span', { class: 'result-note', style: 'color:var(--ok)' }, '已標記讀完,按「下一步」開始練習。'));
        },
      }, '我讀完了,標記完成');
      wrap.append(btn);
    } else {
      wrap.append(h('div', { class: 'result-note', style: 'color:var(--ok)' }, '這堂課已讀完。隨時可以回來複習。'));
    }
    return wrap;
  }

  /* ---------- 句子重組 ---------- */
  function scrambleBlock(s, title) {
    const KEY = KEYS.s;
    let st = store.get(KEY, {});
    const block = h('div', { class: 'q-block unit-block' });
    draw();
    return block;

    function draw() {
      st = store.get(KEY, {});
      block.innerHTML = '';
      block.append(
        h('h2', { class: 'unit-title-lg' }, title),
        h('div', { class: 'q-text' }, '中文意思:', s.zh));
      if (st[s.id] && st[s.id].ok) {
        block.append(
          h('div', { class: 'assembly done-line' }, s.answer),
          h('div', { class: 'explain' }, h('div', { class: 'verdict ok' }, '完成'), h('div', null, s.note)),
          h('div', { class: 'pop-btns', style: 'margin-top:8px' },
            h('button', { class: 'pop-mini', type: 'button', onclick: () => { delete st[s.id]; store.set(KEY, st); draw(); } }, '重做一次')));
        return;
      }
      let attempts = 0;
      let pool = shuffle(s.words.map((w, wi) => ({ w, wi })));
      let picked = [];
      const assembly = h('div', { class: 'assembly' });
      const tiles = h('div', { class: 'tiles' });
      const msg = h('div', { class: 'pop-msg' });
      const ansBtn = h('button', { class: 'pop-mini danger', type: 'button', style: 'display:none', onclick: () => { msg.textContent = '正確排列:' + s.answer; msg.style.color = 'var(--ink-light)'; } }, '看答案');
      redraw();

      function redraw() {
        assembly.innerHTML = '';
        if (!picked.length) assembly.append(h('span', { class: 'assembly-hint' }, '點下面的單字,排出句子'));
        picked.forEach((t, pi) => assembly.append(h('button', {
          class: 'tile picked', type: 'button',
          onclick: () => { pool.push(t); picked.splice(pi, 1); redraw(); },
        }, t.w)));
        tiles.innerHTML = '';
        pool.forEach((t, ti) => tiles.append(h('button', {
          class: 'tile', type: 'button',
          onclick: () => { picked.push(t); pool.splice(ti, 1); redraw(); },
        }, t.w)));
      }

      block.append(assembly, tiles, msg,
        h('div', { class: 'pop-btns', style: 'margin-top:12px' },
          h('button', {
            class: 'btn primary', style: 'padding:6px 22px', type: 'button',
            onclick: () => {
              if (pool.length) { msg.textContent = '還有單字沒用完。'; msg.style.color = 'var(--bad)'; return; }
              if (picked.map(t => t.w).join(' ') === s.answer) {
                st[s.id] = { ok: true };
                store.set(KEY, st);
                draw();
              } else {
                attempts++;
                msg.textContent = '順序還不對,再試試。想想:主詞在前,動詞跟著誰?';
                msg.style.color = 'var(--bad)';
                if (attempts >= 2) ansBtn.style.display = '';
              }
            },
          }, '檢查'),
          h('button', { class: 'pop-mini', type: 'button', onclick: () => { pool = shuffle(s.words.map((w, wi) => ({ w, wi }))); picked = []; msg.textContent = ''; redraw(); } }, '清空重排'),
          ansBtn));
    }
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (a.length > 2 && a.every((t, i2) => t.wi === i2)) [a[0], a[1]] = [a[1], a[0]];
    return a;
  }

  /* ---------- 共用:寫作輸入(自動儲存;target={min,max} 顯示建議字數) ---------- */
  function writeArea(storeKey, id, field, placeholder, minH, target) {
    const map = store.get(storeKey, {});
    const saved = (map[id] || {})[field] || '';
    const counter = h('span', { class: 'wc' });
    const savedNote = h('span', { class: 'wc', style: 'color:var(--ok)' });
    const ta = h('textarea', { class: 'write-area', placeholder: placeholder || '', style: minH ? 'min-height:' + minH + 'px' : '' });
    ta.value = saved;
    function updateCount() {
      const n = wordCount(ta.value);
      if (target) {
        counter.textContent = n + ' / 建議 ' + target.min + '–' + target.max + ' 字';
        counter.style.color = (n >= target.min && n <= target.max) ? 'var(--ok)' : '';
        counter.style.fontWeight = (n >= target.min && n <= target.max) ? '700' : '';
      } else {
        counter.textContent = n ? n + ' 字' : '';
      }
    }
    updateCount();
    let timer = null;
    ta.addEventListener('input', () => {
      updateCount();
      savedNote.textContent = '';
      clearTimeout(timer);
      timer = setTimeout(saveNow, 900);
    });
    ta.addEventListener('blur', saveNow);
    function saveNow() {
      const m = store.get(storeKey, {});
      m[id] = m[id] || {};
      if (m[id][field] === ta.value) return;
      m[id][field] = ta.value;
      m[id].updatedAt = new Date().toISOString();
      store.set(storeKey, m);
      savedNote.textContent = '已儲存';
    }
    return { ta, bar: h('div', { class: 'wc-bar' }, counter, savedNote), value: () => ta.value };
  }

  function revealSection(label, nodes) {
    const body = h('div', { style: 'display:none' }, nodes);
    const btn = h('button', {
      class: 'btn', style: 'margin-top:12px', type: 'button',
      onclick: () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : '';
        btn.classList.toggle('on', !open);
      },
    }, label);
    return [btn, body];
  }

  function checklistBox(items) {
    return h('div', { class: 'check-box' },
      h('b', null, '自評檢核(寫完自己勾)'),
      items.map(c => {
        const cb = h('input', { type: 'checkbox' });
        return h('label', { class: 'check-item' }, cb, ' ', c);
      }));
  }

  /* ---------- 造句 ---------- */
  function buildBlock(b, title) {
    const wa = writeArea(KEYS.b, b.id, 'text', '用指定的兩個字,寫出一句完整的英文句子', 64);
    const [rBtn, rBody] = revealSection('寫好了,看範例與檢核', [
      h('div', { class: 'model-box' },
        h('b', null, '範例寫法'),
        b.models.map(m => h('div', { class: 'model-line' }, m))),
      checklistBox(b.checkpoints),
    ]);
    return h('div', { class: 'q-block unit-block' },
      h('h2', { class: 'unit-title-lg' }, title),
      h('div', { class: 'q-text' }, b.scenario),
      h('div', { class: 'kw-row' }, '必須用到:', b.keywords.map(k => h('span', { class: 'kw-chip' }, k))),
      wa.ta, wa.bar, rBtn, rBody);
  }

  /* ---------- Email ---------- */
  function emailBlock(e, title) {
    const inc = e.incoming;
    const wa = writeArea(KEYS.e, e.id, 'text', 'Dear ...,\n\n(記得:開頭句 → 逐項回應 → 下一步行動 → 結尾句)\n\nBest regards,\n', 190);
    const [rBtn, rBody] = revealSection('寫好了,看範文對照', [
      h('div', { class: 'model-box' }, h('b', null, '範文'), h('div', { class: 'model-line pre' }, e.model)),
      h('div', { class: 'explain', style: 'margin-top:10px' }, h('div', { class: 'verdict ok' }, '範文拆解'), h('div', null, e.modelNotes)),
      checklistBox(e.checklist),
    ]);
    return h('div', { class: 'q-block unit-block' },
      h('h2', { class: 'unit-title-lg' }, title),
      h('div', { class: 'passage-box letter', style: 'position:static;max-height:none;margin-bottom:14px' },
        h('span', { class: 'p-label' }, '來信'),
        h('div', null, 'From: ' + inc.from + '\nSubject: ' + inc.subject + '\n\n' + inc.body)),
      h('div', { class: 'task-list' }, h('b', null, '你的回信要做到:'),
        h('ol', null, e.tasksZh.map(t => h('li', null, t)))),
      wa.ta, wa.bar, rBtn, rBody);
  }

  /* ---------- 論述 ---------- */
  function essayBlock(e, title) {
    const outlineAreas = e.outline.map((o, oi) =>
      writeArea(KEYS.y, e.id, 'p' + oi, '寫在這裡', 74, OUTLINE_TARGETS[oi]));
    const mainWa = writeArea(KEYS.y, e.id, 'text', '把四格內容整理成完整短文(也可以直接在這裡寫)', 210, { min: 200, max: 300 });
    const mergeBtn = h('button', {
      class: 'btn', type: 'button', style: 'margin:10px 0',
      onclick: () => {
        const parts = outlineAreas.map(a => a.value().trim()).filter(Boolean);
        if (!parts.length) return;
        mainWa.ta.value = parts.join('\n\n');
        mainWa.ta.dispatchEvent(new Event('input'));
        mainWa.ta.focus();
      },
    }, '把四格合成草稿 ↓');
    const [rBtn, rBody] = revealSection('寫好了,看範文拆解', [
      h('div', { class: 'model-box' }, h('b', null, '範文'), h('div', { class: 'model-line pre' }, e.model)),
      h('div', { class: 'explain', style: 'margin-top:10px' }, h('div', { class: 'verdict ok' }, '逐段拆解'), h('div', null, e.modelNotes)),
    ]);
    return h('div', { class: 'q-block unit-block' },
      h('h2', { class: 'unit-title-lg' }, title),
      h('div', { class: 'q-text' }, e.question),
      h('div', { class: 'zh', style: 'color:var(--ink-light);font-size:14px;margin:-6px 0 12px' }, e.questionZh),
      h('div', { class: 'kw-row' }, '可用轉折語:', e.transitions.map(t => h('span', { class: 'kw-chip' }, t))),
      h('div', { class: 'outline-grid' },
        e.outline.map((o, oi) => h('div', { class: 'outline-cell' },
          h('b', null, o.label,
            h('span', { class: 'outline-target' }, '建議 ' + OUTLINE_TARGETS[oi].min + '–' + OUTLINE_TARGETS[oi].max + ' 字')),
          h('p', { class: 'outline-hint' }, o.hint),
          outlineAreas[oi].ta, outlineAreas[oi].bar))),
      mergeBtn, mainWa.ta, mainWa.bar, rBtn, rBody);
  }
})();
