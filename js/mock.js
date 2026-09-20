/* 模擬考:照正式節奏的計時測驗。
   - 從現有題庫隨機抽題(聽力+閱讀),全程倒數,時間到自動交卷。
   - 聽力每題音檔只能播一次(正式考規則);全部交卷後才對答案。
   - 分數為參考換算(樣本小,僅供追蹤趨勢);紀錄存 mock_history(雲端同步)。 */
(function () {
  const root = $('#mock-root');
  const LDATA = (window.TOEIC && TOEIC.listening) || null;
  if (!window.TOEIC || !TOEIC.part5 || !LDATA) {
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' }, '題庫載入中,稍後再來。'));
    return;
  }

  const SIZES = {
    quick: {
      name: '快速回合', mins: 22,
      desc: '聽力 12 題,閱讀約 18 題。',
      l: { p2: 6, p3: 1, p4: 1 }, r: { p5: 10, p6: 1, p7: 1 },
    },
    half: {
      name: '標準半回', mins: 47,
      desc: '聽力 36 題,閱讀約 39 題,配速比照正式考。',
      l: { p1: 3, p2: 12, p3: 4, p4: 3 }, r: { p5: 15, p6: 2, p7: 4 },
    },
  };

  /* 參考換算(百分比→單科 5-495;正式換算依全卷等化,這裡只做趨勢參考) */
  const CONV = [[0.97, 495], [0.92, 470], [0.86, 440], [0.8, 410], [0.75, 380], [0.7, 350],
    [0.65, 320], [0.6, 290], [0.55, 260], [0.5, 230], [0.45, 200], [0.4, 170],
    [0.35, 140], [0.3, 110], [0.25, 85], [0.15, 55], [0, 5]];
  const scaled = pct => CONV.find(([t]) => pct >= t)[1];

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const pick = (arr, n) => shuffle(arr || []).slice(0, n);
  const qid = (set, i) => set.id + ':' + i;

  renderHome();

  /* ================= 首頁 ================= */
  function renderHome() {
    document.title = '模擬考|刷刷英文';
    root.innerHTML = '';
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '模擬考'),
      h('p', null, '聽力只播一次,交卷才看答案。')));

    const cards = h('div', { class: 'part-cards', style: 'grid-template-columns:1fr 1fr' });
    Object.entries(SIZES).forEach(([k, s]) => {
      cards.append(h('div', { class: 'part-card' },
        h('h3', null, s.name),
        h('p', null, s.desc),
        h('div', { class: 'p-stats' }, '限時 ' + s.mins + ' 分鐘'),
        h('div', { class: 'cfg-row' },
          h('button', { class: 'btn primary', onclick: () => startExam(k) }, '開始'))));
    });
    root.append(cards);

    const hist = store.get('mock_history', []);
    if (hist.length) {
      root.append(h('div', { class: 'exercise-head' }, h('h2', null, '歷次紀錄')));
      const table = h('table', { class: 'cat-table' },
        h('tr', null, h('th', null, '日期'), h('th', null, '規模'),
          h('th', null, '聽力'), h('th', null, '閱讀'), h('th', null, '參考總分')));
      hist.slice(-8).reverse().forEach(r => {
        table.append(h('tr', null,
          h('td', null, (r.d || '').slice(0, 10)),
          h('td', null, (SIZES[r.size] || {}).name || r.size),
          h('td', { class: 'num' }, r.lRaw + '/' + r.lTotal + ' · ' + r.lScore),
          h('td', { class: 'num' }, r.rRaw + '/' + r.rTotal + ' · ' + r.rScore),
          h('td', { class: 'num' }, h('b', null, r.lScore + r.rScore))));
      });
      root.append(table);
    }
  }

  /* ================= 考試 ================= */
  function startExam(sizeKey) {
    const cfg = SIZES[sizeKey];
    const units = [];
    if (cfg.l.p1) pick(LDATA.p1, cfg.l.p1).forEach(item => units.push({ sec: 'L', p: '1', item }));
    pick(LDATA.p2, cfg.l.p2).forEach(item => units.push({ sec: 'L', p: '2', item }));
    pick(LDATA.p3, cfg.l.p3).forEach(item => units.push({ sec: 'L', p: '3', item }));
    pick(LDATA.p4, cfg.l.p4).forEach(item => units.push({ sec: 'L', p: '4', item }));
    pick(TOEIC.part5, cfg.r.p5).forEach(item => units.push({ sec: 'R', p: '5', item }));
    pick(TOEIC.part6, cfg.r.p6).forEach(item => units.push({ sec: 'R', p: '6', item }));
    pick(TOEIC.part7, cfg.r.p7).forEach(item => units.push({ sec: 'R', p: '7', item }));

    document.title = '模擬考進行中|刷刷英文';
    const sess = units.map(() => ({ answers: {}, played: 0 }));
    let cur = 0;
    let over = false;
    let audio = null;
    let deadline = Date.now() + cfg.mins * 60 * 1000;
    const timerEl = h('span', { class: 'mock-timer' });
    const timerId = setInterval(tick, 1000);
    tick();

    function tick() {
      const left = Math.max(0, deadline - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor(left % 60000 / 1000);
      timerEl.textContent = m + ':' + String(s).padStart(2, '0');
      timerEl.classList.toggle('low', left < 5 * 60 * 1000);
      if (left <= 0 && !over) submit(true);
    }
    function stopAudio() { if (audio) { audio.pause(); audio = null; } }

    function unitQs(u) { return u.p === '5' ? 1 : u.p === '1' || u.p === '2' ? 1 : u.item.questions.length; }
    function unitAnswered(i) {
      const u = units[i];
      if (u.p === '5' || u.p === '1' || u.p === '2') return sess[i].answers.c !== undefined;
      return u.item.questions.every((q, qi) => sess[i].answers[qi] !== undefined);
    }

    function draw() {
      stopAudio();
      root.innerHTML = '';
      const u = units[cur];
      root.append(h('div', { class: 'drill-top' },
        h('h1', null, '模擬考 ', h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' },
          cfg.name + ' · ' + (u.sec === 'L' ? '聽力' : '閱讀'))),
        timerEl,
        h('button', { class: 'btn', style: 'margin-left:12px', onclick: () => submit(false) }, '交卷')));
      const nav = h('div', { class: 'q-nav' });
      units.forEach((x, i) => {
        let cls = i === cur ? 'cur' : '';
        if (unitAnswered(i)) cls += ' ans';
        if (x.sec === 'L') cls += ' mock-l';
        nav.append(h('button', { class: cls.trim(), onclick: () => { cur = i; draw(); window.scrollTo(0, 0); } }, String(i + 1)));
      });
      root.append(nav);
      if (u.p === '5') drawP5(u);
      else if (u.sec === 'R') drawRSet(u);
      else drawLUnit(u);
      root.append(navRow());
    }

    function navRow() {
      const isLast = cur === units.length - 1;
      return h('div', { class: 'drill-nav-btns' },
        h('button', {
          class: 'btn primary',
          onclick: () => { if (isLast) submit(false); else { cur++; draw(); window.scrollTo(0, 0); } },
        }, isLast ? '交卷' : '下一題 →'));
    }

    function makeOncePlayer(id, state) {
      const btn = h('button', { class: 'btn primary player-btn', type: 'button' }, state.played ? '已播放' : '▶ 播放(限一次)');
      btn.disabled = !!state.played;
      btn.addEventListener('click', () => {
        if (state.played) return;
        state.played = 1;
        stopAudio();
        audio = new Audio('audio/' + id + '.mp3');
        audio.play().catch(() => {});
        btn.disabled = true;
        btn.textContent = '已播放';
      });
      return h('div', { class: 'player' }, btn);
    }

    function drawLUnit(u) {
      const state = sess[cur];
      const block = h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' },
          h('span', { class: 'badge cat' }, '聽力 Part ' + u.p)));
      if (u.p === '1') {
        block.append(h('div', { class: 'listen-photo' }, h('img', {
          src: 'img/listening/' + u.item.id + '.jpg', alt: '聽力照片',
          onerror: e => e.target.replaceWith(h('div', { class: 'photo-missing' }, '照片準備中')),
        })));
      }
      block.append(makeOncePlayer(u.item.id, state));
      if (u.p === '1' || u.p === '2') {
        const nOpt = u.p === '1' ? 4 : 3;
        const row = h('div', { class: 'letter-row' });
        for (let i = 0; i < nOpt; i++) {
          row.append(h('button', {
            class: 'letter-big' + (state.answers.c === i ? ' picked' : ''),
            onclick: () => { state.answers.c = i; draw(); },
          }, LETTERS[i]));
        }
        block.append(h('div', { class: 'q-text', style: 'margin-top:10px' },
          u.p === '1' ? '選出最符合照片的描述:' : '選出最合適的回應:'), row);
      } else {
        u.item.questions.forEach((q, qi) => {
          const opts = h('div', { class: 'opts', style: 'margin-top:6px' });
          q.options.forEach((opt, oi) => {
            opts.append(h('button', {
              class: 'opt' + (state.answers[qi] === oi ? ' picked' : ''),
              onclick: () => { state.answers[qi] = oi; draw(); },
            }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
          });
          block.append(h('div', { style: 'margin-top:14px' },
            h('div', { class: 'q-text' }, h('span', { class: 'q-no' }, 'Q' + (qi + 1)), q.q), opts));
        });
      }
      root.append(block);
    }

    function drawP5(u) {
      const q = u.item;
      const state = sess[cur];
      const opts = h('div', { class: 'opts' });
      q.options.forEach((opt, oi) => {
        opts.append(h('button', {
          class: 'opt' + (state.answers.c === oi ? ' picked' : ''),
          onclick: () => { state.answers.c = oi; draw(); },
        }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
      });
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, '閱讀 Part 5')),
        h('div', { class: 'q-text', style: 'font-size:17px' }, q.question),
        opts));
    }

    function drawRSet(u) {
      const set = u.item;
      const state = sess[cur];
      const layout = h('div', { class: 'set-layout' });
      const passCol = h('div', { class: 'passage-sticky-wrap' });
      if (u.p === '6') {
        const box = h('div', { class: 'passage-box' });
        const frag = document.createDocumentFragment();
        String(set.passage).split(/(\{\{\d\}\})/).forEach(seg => {
          const m = seg.match(/^\{\{(\d)\}\}$/);
          if (!m) { if (seg) frag.append(document.createTextNode(seg)); return; }
          const num = Number(m[1]);
          const rec = state.answers[num];
          const q = set.questions.find(x => x.num === num);
          frag.append(rec !== undefined && q
            ? h('span', { class: 'gap-mark filled' }, q.options[rec])
            : h('span', { class: 'gap-mark' }, '(' + num + ') ______'));
        });
        box.append(h('div', null, frag));
        passCol.append(box);
      } else {
        set.passages.forEach(ps => passCol.append(p7Fallback(ps)));
      }
      layout.append(h('div', null, passCol));
      const qCol = h('div', null);
      qCol.append(h('div', { style: 'margin-bottom:8px' }, h('span', { class: 'badge cat' }, '閱讀 Part ' + u.p)));
      set.questions.forEach((q, qi) => {
        const key = u.p === '6' ? q.num : qi;
        const opts = h('div', { class: 'opts' });
        q.options.forEach((opt, oi) => {
          opts.append(h('button', {
            class: 'opt' + (state.answers[key] === oi ? ' picked' : ''),
            onclick: () => { state.answers[key] = oi; draw(); },
          }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
        });
        qCol.append(h('div', { class: 'q-block' },
          h('div', { class: 'q-text' },
            h('span', { class: 'q-no' }, u.p === '6' ? '(' + q.num + ')' : 'Q' + (qi + 1)),
            u.p === '6' ? '選出最適合填入空格的答案' : q.q),
          opts));
      });
      layout.append(qCol);
      root.append(layout);
    }

    function p7Fallback(ps) {
      const box = h('div', { class: 'passage-box' },
        h('span', { class: 'p-label' }, (ps.label ? ps.label + ' · ' : '') + passTypeLabel(ps.type)));
      if (ps.blocks) {
        /* 簡化渲染:模擬考中結構化文件以純文字段落呈現重點 */
        const wrap = h('div', { class: 'ps-blocks' });
        ps.blocks.forEach(b => {
          if (b.t === 'h') wrap.append(h('div', { class: 'ps-h' }, b.text));
          else if (b.t === 'sub' || b.t === 'p' || b.t === 'note') wrap.append(h('div', { class: 'ps-p' }, b.text));
          else if (b.t === 'list') wrap.append(h('ul', { class: 'ps-list' }, ...(b.items || []).map(x => h('li', null, x))));
          else if (b.t === 'kv') wrap.append(h('div', { class: 'ps-kv' }, ...(b.items || []).map(it =>
            h('div', { class: 'ps-kv-row' }, h('span', { class: 'ps-kv-k' }, it[0]), h('span', { class: 'ps-kv-v' }, it[1])))));
          else if (b.t === 'table') {
            const tbl = h('table', { class: 'ps-table' });
            (b.rows || []).forEach((row, ri) => tbl.append(h('tr', null,
              ...row.map(c => h(b.header !== false && ri === 0 ? 'th' : 'td', null, String(c))))));
            wrap.append(h('div', { class: 'ps-table-wrap' }, tbl));
          } else if (b.t === 'chat') {
            const sides = {};
            wrap.append(h('div', { class: 'ps-chat' }, ...(b.msgs || []).map(m => {
              if (!(m.who in sides)) sides[m.who] = Object.keys(sides).length % 2 ? 'right' : '';
              return h('div', { class: 'ps-msg ' + sides[m.who] },
                h('div', { class: 'ps-msg-meta' }, m.who + (m.time ? ' · ' + m.time : '')),
                h('div', { class: 'ps-msg-bubble' }, m.text));
            })));
          } else if (b.t === 'coupon') {
            wrap.append(h('div', { class: 'ps-coupon' },
              ...(b.lines || [b.text]).map((l, i) => h('div', { class: i ? 'ps-coupon-line' : 'ps-coupon-main' }, l))));
          }
        });
        box.append(wrap);
      } else box.append(h('div', null, ps.content));
      return box;
    }

    /* ---------- 交卷與結果 ---------- */
    function submit(timeUp) {
      if (over) return;
      if (!timeUp) {
        const missing = units.filter((u, i) => !unitAnswered(i)).length;
        if (missing && !confirm('還有 ' + missing + ' 個題組沒答完,確定交卷?未作答算錯。')) return;
      }
      over = true;
      clearInterval(timerId);
      stopAudio();

      let lRaw = 0, lTotal = 0, rRaw = 0, rTotal = 0;
      units.forEach((u, i) => {
        const st = sess[i];
        const add = (ok, isL) => { if (isL) { lTotal++; if (ok) lRaw++; } else { rTotal++; if (ok) rRaw++; } };
        if (u.p === '5') add(st.answers.c === u.item.answer, false);
        else if (u.p === '1' || u.p === '2') add(st.answers.c === u.item.answer, true);
        else if (u.p === '6') u.item.questions.forEach(q => add(st.answers[q.num] === q.answer, false));
        else u.item.questions.forEach((q, qi) => add(st.answers[qi] === q.answer, u.sec === 'L'));
      });
      const lScore = scaled(lTotal ? lRaw / lTotal : 0);
      const rScore = scaled(rTotal ? rRaw / rTotal : 0);
      const hist = store.get('mock_history', []);
      hist.push({ d: new Date().toISOString(), size: sizeKey, lRaw, lTotal, rRaw, rTotal, lScore, rScore });
      store.set('mock_history', hist.slice(-30));

      results(timeUp, lRaw, lTotal, rRaw, rTotal, lScore, rScore);
    }

    function results(timeUp, lRaw, lTotal, rRaw, rTotal, lScore, rScore) {
      document.title = '模擬考結果|刷刷英文';
      root.innerHTML = '';
      root.append(h('div', { class: 'drill-top' }, h('h1', null, '模擬考結果'),
        h('a', { href: 'mock.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回模擬考')));
      root.append(h('div', { class: 'report-head', style: 'margin-top:16px' },
        h('h2', null, '參考總分 ' + (lScore + rScore)),
        h('div', { class: 'band-note' },
          (timeUp ? '時間到,自動交卷。' : '') +
          '聽力 ' + lRaw + '/' + lTotal + '(約 ' + lScore + ')· 閱讀 ' + rRaw + '/' + rTotal + '(約 ' + rScore + ')。參考換算,非正式成績。')));
      root.append(h('div', { class: 'drill-nav-btns' },
        h('button', { class: 'btn primary', onclick: () => startExam(sizeKey) }, '再來一回'),
        h('a', { class: 'btn', href: 'mock.html' }, '回模擬考')));

      /* 逐題檢討 */
      units.forEach((u, i) => {
        const st = sess[i];
        const block = h('div', { class: 'q-block', style: 'margin-top:18px' },
          h('div', { class: 'meta', style: 'margin-bottom:8px' },
            h('span', { class: 'badge cat' }, (u.sec === 'L' ? '聽力' : '閱讀') + ' Part ' + u.p)));
        const gradeOpts = (q, chosen) => {
          const opts = h('div', { class: 'opts' });
          q.options.forEach((opt, oi) => {
            let cls = 'opt';
            if (oi === q.answer) cls += ' correct';
            else if (oi === chosen) cls += ' wrong';
            else cls += ' plain';
            opts.append(h('button', { class: cls, disabled: '' },
              h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
          });
          return opts;
        };
        const verdict = (q, chosen) => h('div', { class: 'explain' },
          h('div', { class: 'verdict ' + (chosen === q.answer ? 'ok' : 'bad') },
            chosen === q.answer ? '答對了' : (chosen === undefined ? '未作答,正確答案是 ' : '答錯了,正確答案是 ') + LETTERS[q.answer]),
          h('div', null, q.explanation));

        if (u.p === '5') {
          block.append(h('div', { class: 'q-text' }, u.item.question), gradeOpts(u.item, st.answers.c), verdict(u.item, st.answers.c),
            h('div', { class: 'explain' }, h('div', { class: 'tr' }, u.item.translation)));
        } else if (u.p === '1' || u.p === '2') {
          if (u.p === '1') block.append(h('div', { class: 'listen-photo' }, h('img', {
            src: 'img/listening/' + u.item.id + '.jpg', alt: '聽力照片',
            onerror: e => e.target.replaceWith(h('div', { class: 'photo-missing' }, '照片準備中')),
          })));
          const q = u.item;
          block.append(gradeOpts({ options: q.options.map((o, oi) => LETTERS[oi] + '. ' + o), answer: q.answer, explanation: q.explanation }, st.answers.c),
            verdict(q, st.answers.c),
            h('div', { class: 'transcript-box' }, h('b', null, '逐字稿'),
              h('div', { class: 'tr-en' }, (q.question ? q.question + '\n' : '') + q.options.map((o, oi) => LETTERS[oi] + '. ' + o).join('\n')),
              h('div', { class: 'tr-zh' }, q.transcriptZh)));
        } else if (u.sec === 'L') {
          const set = u.item;
          set.questions.forEach((q, qi) => {
            block.append(h('div', { class: 'q-text', style: 'margin-top:10px' }, h('span', { class: 'q-no' }, 'Q' + (qi + 1)), q.q),
              gradeOpts(q, st.answers[qi]), verdict(q, st.answers[qi]));
          });
          const transcript = u.p === '3'
            ? set.dialogue.map(t => (t.s === 'M' ? '男:' : '女:') + t.text).join('\n')
            : set.talk;
          block.append(h('div', { class: 'transcript-box' }, h('b', null, '逐字稿'),
            h('div', { class: 'tr-en' }, transcript), h('div', { class: 'tr-zh' }, set.transcriptZh)));
        } else {
          const set = u.item;
          if (u.p === '7') set.passages.forEach(ps => block.append(p7Fallback(ps)));
          else block.append(h('div', { class: 'passage-box', style: 'position:static;max-height:none' },
            h('div', null, String(set.passage).replace(/\{\{(\d)\}\}/g, (m, n) => {
              const q = set.questions.find(x => x.num === Number(n));
              return q ? '【' + q.options[q.answer] + '】' : m;
            }))));
          set.questions.forEach((q, qi) => {
            const key = u.p === '6' ? q.num : qi;
            block.append(h('div', { class: 'q-text', style: 'margin-top:10px' },
              h('span', { class: 'q-no' }, u.p === '6' ? '(' + q.num + ')' : 'Q' + (qi + 1)),
              u.p === '6' ? '空格 (' + q.num + ')' : q.q),
              gradeOpts(q, st.answers[key]), verdict(q, st.answers[key]));
          });
        }
        root.append(block);
      });
      window.scrollTo(0, 0);
    }

    draw();
  }
})();
