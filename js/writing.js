/* 寫作練習:三個等級(句子力/Email力/論述力)。
   每級=技巧課(可展開)+練習區。學生寫的內容存進自己的檔案(雲端模式自動同步),
   不做機器批改——句子重組自動對答,其餘由範文對照+自評檢核+老師人工回饋。 */
(function () {
  const root = $('#writing-root');
  const W = (window.TOEIC && TOEIC.writing) || null;

  if (!W || !W.l1) {
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' },
      '寫作教材尚未載入。請確認 data/writing.js 存在(執行 tools/merge_data.py 產生)。'));
    return;
  }

  /* 進度統計 */
  const ST_KEYS = { s: 'writing_s', b: 'writing_b', e: 'writing_e', y: 'writing_y' };
  function stats(lv) {
    if (lv === 'l1') {
      const s = store.get(ST_KEYS.s, {}), b = store.get(ST_KEYS.b, {});
      return { done: Object.keys(s).length + Object.keys(b).length, total: W.l1.scramble.length + W.l1.build.length };
    }
    if (lv === 'l2') {
      const e = store.get(ST_KEYS.e, {});
      return { done: Object.values(e).filter(x => x && x.text).length, total: W.l2.emails.length };
    }
    const y = store.get(ST_KEYS.y, {});
    return { done: Object.values(y).filter(x => x && (x.text || (x.parts || []).some(p => p))).length, total: W.l3.essays.length };
  }

  function wordCount(text) {
    return (String(text || '').trim().match(/[A-Za-z''-]+/g) || []).length;
  }

  const lv = getParam('level');
  if (lv && W[lv]) renderLevel(lv);
  else renderHome();

  /* ================= 首頁 ================= */
  function renderHome() {
    document.title = '寫作練習|多益閱讀訓練室';
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '寫作練習'),
      h('p', null, '從句子到 Email 再到短文,一級一級來。每一級都有技巧課先教你怎麼做,寫的內容會保存,老師可以看、可以改。')));
    const desc = {
      l1: '先能寫出完整正確的句子:重組句自動對答,造句有範例可對照。',
      l2: '學會商用回信的固定格式與套路:讀來信、照任務清單回覆、跟範文比。',
      l3: '把想法組織成有說服力的短文:四格大綱鷹架帶你一步步長出一篇文。',
    };
    const badges = { l1: '基礎', l2: '中級', l3: '進階' };
    root.append(h('div', { class: 'part-cards' },
      ['l1', 'l2', 'l3'].map(k => {
        const s = stats(k);
        const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
        return h('a', { class: 'part-card', href: 'writing.html?level=' + k, style: 'display:block' },
          h('div', { class: 'p-label' }, 'LEVEL ' + k[1] + ' · ' + badges[k]),
          h('h3', null, W[k].title.replace(/^Level \d /, '')),
          h('p', null, desc[k]),
          h('div', { class: 'p-stats' }, W[k].lessons.length + ' 堂技巧課 · 練習 ' + s.done + '/' + s.total),
          h('div', { class: 'bar' }, h('i', { style: 'width:' + pct + '%' })));
      })));
  }

  /* ================= 等級頁 ================= */
  function renderLevel(lv) {
    const L = W[lv];
    document.title = L.title + '|多益閱讀訓練室';
    root.append(h('div', { class: 'page-head' },
      h('div', { class: 'meta', style: 'margin-bottom:4px' }, h('a', { href: 'writing.html' }, '← 回寫作練習')),
      h('h1', null, L.title),
      h('p', null, L.subtitle || '')));

    /* 技巧課 */
    root.append(h('div', { class: 'exercise-head' },
      h('span', { class: 'ex-no' }, '第一步'),
      h('h2', null, '技巧課'),
      h('span', { class: 'en' }, '先看懂怎麼做,再動筆')));
    L.lessons.forEach((les, i) => root.append(lessonCard(les, i)));

    /* 練習 */
    root.append(h('div', { class: 'exercise-head' },
      h('span', { class: 'ex-no' }, '第二步'),
      h('h2', null, '練習'),
      h('span', { class: 'en' }, lv === 'l1' ? '重組+造句' : lv === 'l2' ? '讀來信,寫回覆' : '用大綱長出一篇文')));

    if (lv === 'l1') {
      root.append(h('h3', { class: 'w-subhead' }, '句子重組(點單字排出正確句子)'));
      L.scramble.forEach((s, i) => root.append(scrambleBlock(s, i)));
      root.append(h('h3', { class: 'w-subhead' }, '看提示造句(寫完再看範例)'));
      L.build.forEach((b, i) => root.append(buildBlock(b, i)));
    } else if (lv === 'l2') {
      L.emails.forEach((e, i) => root.append(emailBlock(e, i)));
    } else {
      L.essays.forEach((e, i) => root.append(essayBlock(e, i)));
    }
    root.append(h('div', { style: 'height:40px' }));
  }

  function lessonCard(les, i) {
    const body = h('div', { class: 'lesson-body', style: 'display:none' },
      h('p', { class: 'lesson-intro' }, les.intro),
      les.points.map(pt => h('div', { class: 'lesson-point' },
        h('div', { class: 'lp-tip' }, pt.tip),
        h('div', { class: 'lp-ex' }, pt.example),
        h('div', { class: 'lp-zh' }, pt.exampleZh))));
    const head = h('button', { class: 'lesson-head', type: 'button' },
      h('span', { class: 'q-no' }, '課 ' + (i + 1)), les.title,
      h('span', { class: 'lesson-arrow' }, '▾'));
    head.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      head.querySelector('.lesson-arrow').textContent = open ? '▾' : '▴';
    });
    return h('div', { class: 'lesson-card' }, head, body);
  }

  /* ---------- L1 句子重組 ---------- */
  function scrambleBlock(s, i) {
    const KEY = ST_KEYS.s;
    let st = store.get(KEY, {});
    const block = h('div', { class: 'q-block' });
    draw();
    return block;

    function draw() {
      st = store.get(KEY, {});
      block.innerHTML = '';
      block.append(h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'S' + (i + 1)), '中文意思:', s.zh));
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
        h('div', { class: 'pop-btns', style: 'margin-top:10px' },
          h('button', {
            class: 'btn primary', style: 'padding:5px 18px;font-size:14px', type: 'button',
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
    /* 避免洗完剛好是正解順序 */
    if (a.length > 2 && a.every((t, i2) => t.wi === i2)) [a[0], a[1]] = [a[1], a[0]];
    return a;
  }

  /* ---------- 共用:寫作輸入(自動儲存) ---------- */
  function writeArea(storeKey, id, field, placeholder, minH) {
    const map = store.get(storeKey, {});
    const saved = (map[id] || {})[field] || '';
    const counter = h('span', { class: 'wc' }, saved ? wordCount(saved) + ' 字' : '');
    const savedNote = h('span', { class: 'wc', style: 'color:var(--ok)' });
    const ta = h('textarea', { class: 'write-area', placeholder: placeholder || '', style: minH ? 'min-height:' + minH + 'px' : '' });
    ta.value = saved;
    let timer = null;
    ta.addEventListener('input', () => {
      counter.textContent = wordCount(ta.value) + ' 字';
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
      class: 'btn', style: 'margin-top:10px', type: 'button',
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

  /* ---------- L1 造句 ---------- */
  function buildBlock(b, i) {
    const wa = writeArea(ST_KEYS.b, b.id, 'text', '用指定的兩個字,寫出一句完整的英文句子', 56);
    const [rBtn, rBody] = revealSection('寫好了,看範例與檢核', [
      h('div', { class: 'model-box' },
        h('b', null, '範例寫法'),
        b.models.map(m => h('div', { class: 'model-line' }, m))),
      checklistBox(b.checkpoints),
    ]);
    return h('div', { class: 'q-block' },
      h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'B' + (i + 1)), b.scenario),
      h('div', { class: 'kw-row' }, '必須用到:', b.keywords.map(k => h('span', { class: 'kw-chip' }, k))),
      wa.ta, wa.bar, rBtn, rBody);
  }

  /* ---------- L2 Email ---------- */
  function emailBlock(e, i) {
    const inc = e.incoming;
    const wa = writeArea(ST_KEYS.e, e.id, 'text', 'Dear ...,\n\n(記得:開頭句 → 逐項回應 → 下一步行動 → 結尾句)\n\nBest regards,\n', 170);
    const [rBtn, rBody] = revealSection('寫好了,看範文對照', [
      h('div', { class: 'model-box' }, h('b', null, '範文'), h('div', { class: 'model-line pre' }, e.model)),
      h('div', { class: 'explain', style: 'margin-top:10px' }, h('div', { class: 'verdict ok' }, '範文拆解'), h('div', null, e.modelNotes)),
      checklistBox(e.checklist),
    ]);
    return h('div', { class: 'q-block' },
      h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'E' + (i + 1)), inc.subject),
      h('div', { class: 'passage-box letter', style: 'position:static;max-height:none;margin-bottom:10px' },
        h('span', { class: 'p-label' }, '來信'),
        h('div', null, 'From: ' + inc.from + '\nSubject: ' + inc.subject + '\n\n' + inc.body)),
      h('div', { class: 'task-list' }, h('b', null, '你的回信要做到:'),
        h('ol', null, e.tasksZh.map(t => h('li', null, t)))),
      wa.ta, wa.bar, rBtn, rBody);
  }

  /* ---------- L3 論述 ---------- */
  function essayBlock(e, i) {
    const outlineAreas = e.outline.map((o, oi) =>
      writeArea(ST_KEYS.y, e.id, 'p' + oi, o.hint, 52));
    const mainWa = writeArea(ST_KEYS.y, e.id, 'text', '把四格內容整理成完整短文(也可以直接在這裡寫)', 190);
    const mergeBtn = h('button', {
      class: 'btn', type: 'button', style: 'margin:8px 0',
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
    return h('div', { class: 'q-block' },
      h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'W' + (i + 1)), e.question),
      h('div', { class: 'zh', style: 'color:var(--ink-light);font-size:14px;margin:-6px 0 10px' }, e.questionZh),
      h('div', { class: 'kw-row' }, '可用轉折語:', e.transitions.map(t => h('span', { class: 'kw-chip' }, t))),
      h('div', { class: 'outline-grid' },
        e.outline.map((o, oi) => h('div', { class: 'outline-cell' },
          h('b', null, o.label), outlineAreas[oi].ta, outlineAreas[oi].bar))),
      mergeBtn, mainWa.ta, mainWa.bar, rBtn, rBody);
  }
})();
