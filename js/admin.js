/* 教師後台:總覽每位學生的檢測結果、各 Part 進度與正確率、錯題與單字進度。
   資料權限由 Supabase RLS 控管——只有 teachers 表裡的帳號查得到全部學生的列。 */
(function () {
  const root = $('#admin-root');

  function note(msg) {
    root.innerHTML = '';
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' }, msg));
  }

  if (!window.CLOUD || !CLOUD.enabled) {
    note('教師後台需要雲端模式。請先依「GITHUB上線指南.md」設定 Supabase,並填好 js/cloud-config.js。');
    return;
  }

  (async () => {
    await CLOUD.ready;
    if (!CLOUD.user) return;               // profile.js 會顯示登入視窗
    if (!CLOUD.isTeacher) {
      note('這個帳號沒有教師權限。請用教師帳號登入(教師帳號=已加入 teachers 表的帳號,見指南步驟 D)。');
      return;
    }
    load();
  })();

  /* ---------- 題庫總數與查找表 ---------- */
  const p5ById = {};
  (TOEIC.part5 || []).forEach(q => { p5ById[q.id] = q; });
  const setTotals = p => (TOEIC['part' + p] || []).reduce((n, s) => n + s.questions.length, 0);
  const TOTALS = { p5: (TOEIC.part5 || []).length, p6: setTotals(6), p7: setTotals(7) };
  const diagItems = TOEIC.diagnostic
    ? [...TOEIC.diagnostic.p5, ...TOEIC.diagnostic.p6.questions, ...TOEIC.diagnostic.p7.questions]
    : [];

  async function load() {
    note('載入學生資料中…');
    let rows;
    try {
      const res = await CLOUD.client.from('progress').select('user_id,k,v,updated_at');
      if (res.error) throw res.error;
      rows = res.data || [];
    } catch (e) {
      note('讀取失敗:' + e.message);
      return;
    }

    /* 依學生分組 */
    const students = {};
    rows.forEach(r => {
      const s = students[r.user_id] = students[r.user_id] || { keys: {}, last: '' };
      if (r.v !== null) s.keys[r.k] = r.v;
      if (r.updated_at > s.last) s.last = r.updated_at;
    });

    render(students);
  }

  function drillStats(keys, p) {
    const st = keys['drill_p' + p] || {};
    let answered = 0, correct = 0;
    const wrong = [];
    Object.entries(st).forEach(([id, rec]) => {
      if (!rec) return;
      answered++;
      if (rec.ok) correct++;
      else wrong.push(id);
    });
    return { answered, correct, wrong };
  }

  function diagSummary(keys) {
    const d = keys['diag'];
    if (!d || !d.done || !diagItems.length) return null;
    const cats = {};
    const diffs = { '基礎': { c: 0, t: 0 }, '中級': { c: 0, t: 0 }, '進階': { c: 0, t: 0 } };
    let score = 0;
    const wrong = [];
    diagItems.forEach((it, i) => {
      const ok = d.answers && d.answers[i] === it.answer;
      if (ok) score++;
      else wrong.push({ i, it });
      const c = cats[it.category] = cats[it.category] || { c: 0, t: 0 };
      c.t++; if (ok) c.c++;
      if (diffs[it.difficulty]) { diffs[it.difficulty].t++; if (ok) diffs[it.difficulty].c++; }
    });
    const acc = x => x.t ? x.c / x.t : 0;
    const est = bandEstimate(acc(diffs['基礎']), acc(diffs['中級']), acc(diffs['進階']), score / diagItems.length);
    const weak = Object.entries(cats).filter(([, c]) => c.c / c.t < 0.8)
      .sort((a, b) => a[1].c / a[1].t - b[1].c / b[1].t);
    return { score, total: diagItems.length, band: est.band, cats, weak, wrong, finishedAt: (d.finishedAt || '').slice(0, 10) };
  }

  function vocabStats(keys) {
    let done = 0, total = 0;
    (TOEIC.articles || []).forEach(a => {
      a.paragraphs.forEach(p => { total += (p.en.match(/\[\[/g) || []).length; });
      const st = keys['vocab_' + a.id];
      if (st) done += Object.keys(st).length;
    });
    return { done, total };
  }

  /* ---------- 教師紀錄(存在教師自己的資料列,學生看不到) ---------- */
  async function saveNote(uid, obj, statusEl) {
    statusEl.textContent = '儲存中…';
    try {
      const res = await CLOUD.client.from('progress').upsert({
        user_id: CLOUD.user.id, k: 'tnote_' + uid, v: obj, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,k' });
      if (res.error) throw res.error;
      statusEl.textContent = '已儲存';
      setTimeout(() => { if (statusEl.textContent === '已儲存') statusEl.textContent = ''; }, 2500);
    } catch (e) {
      statusEl.textContent = '儲存失敗:' + e.message;
    }
  }

  function noteSection(uid, tnote) {
    const wrap = h('div', { style: 'margin-top:14px;border-top:1px solid var(--line);padding-top:12px' });
    const status = h('span', { class: 'player-note', style: 'margin-left:10px' });
    wrap.append(h('h3', { style: 'font-size:15.5px;margin-bottom:6px' }, '上課紀錄與備註', h('span', { style: 'font-size:12px;color:var(--ink-light);font-weight:400' }, '(只有教師帳號看得到)'), status));

    /* 學生需求/長期備註 */
    const needs = h('textarea', { class: 'write-area', style: 'min-height:52px', placeholder: '學生需求或長期備註(目標分數、弱點、偏好的上課方式…)' });
    needs.value = tnote.needs || '';
    wrap.append(needs,
      h('div', { class: 'pop-btns', style: 'margin:6px 0 14px' },
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => { tnote.needs = needs.value.trim(); saveNote(uid, tnote, status); },
        }, '儲存備註')));

    /* 上課紀錄列表 */
    const logList = h('div', null);
    function drawLogs() {
      logList.innerHTML = '';
      (tnote.logs || []).slice().reverse().forEach(log => {
        logList.append(h('div', { class: 'bank-word' },
          h('div', { class: 'bank-word-main', style: 'cursor:default' },
            h('b', { style: 'flex:0 0 auto' }, log.d),
            h('span', { style: 'white-space:pre-line' }, log.text)),
          h('button', {
            class: 'bank-word-del', type: 'button', title: '刪除這筆紀錄',
            onclick: () => {
              if (!confirm('刪除 ' + log.d + ' 的紀錄?')) return;
              tnote.logs = tnote.logs.filter(x => x !== log);
              saveNote(uid, tnote, status);
              drawLogs();
            },
          }, '✕')));
      });
    }
    drawLogs();
    wrap.append(logList);

    /* 新增一筆 */
    const dateInput = h('input', { class: 'cfg-select', type: 'date', style: 'padding:6px 8px' });
    dateInput.value = new Date().toISOString().slice(0, 10);
    const logInput = h('textarea', { class: 'write-area', style: 'min-height:52px', placeholder: '這次上了什麼、回家作業、下次要做什麼…' });
    wrap.append(h('div', { style: 'margin-top:10px' }, dateInput, logInput,
      h('div', { class: 'pop-btns', style: 'margin-top:6px' },
        h('button', {
          class: 'btn primary', type: 'button',
          onclick: () => {
            const text = logInput.value.trim();
            if (!text) return;
            (tnote.logs = tnote.logs || []).push({ d: dateInput.value, text });
            tnote.logs.sort((a, b) => a.d.localeCompare(b.d));
            logInput.value = '';
            saveNote(uid, tnote, status);
            drawLogs();
          },
        }, '新增上課紀錄'))));
    return wrap;
  }

  function render(students) {
    root.innerHTML = '';
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '教師後台'),
      h('p', null, '點任一列展開該學生的檢測報告摘要、錯題與上課紀錄。資料為學生端最後同步的狀態。')));

    const myKeys = (students[CLOUD.user.id] || { keys: {} }).keys;
    const ids = Object.keys(students).filter(uid => uid !== CLOUD.user.id);
    if (!ids.length) {
      root.append(h('div', { class: 'q-block' }, '還沒有學生資料。學生第一次登入並開始作答後,這裡就會出現他們的進度。'));
      return;
    }
    ids.sort((a, b) => (students[b].last || '').localeCompare(students[a].last || ''));

    const table = h('table', { class: 'cat-table' },
      h('tr', null,
        h('th', null, '學生'), h('th', null, '最近活動'), h('th', null, '檢測結果'),
        h('th', null, 'Part 5'), h('th', null, 'Part 6'), h('th', null, 'Part 7'), h('th', null, '單字')));

    ids.forEach(uid => {
      const s = students[uid];
      const meta = s.keys['_meta'] || {};
      const name = meta.name || meta.email || uid.slice(0, 8);
      const diag = diagSummary(s.keys);
      const d5 = drillStats(s.keys, 5), d6 = drillStats(s.keys, 6), d7 = drillStats(s.keys, 7);
      const vo = vocabStats(s.keys);
      const fmt = d => d.answered ? d.answered + ' 題 · ' + Math.round(d.correct / d.answered * 100) + '%' : '—';

      const row = h('tr', { style: 'cursor:pointer' },
        h('td', null, h('b', null, name), meta.email && meta.email !== name ? h('span', { style: 'color:var(--ink-light);font-size:12.5px' }, ' ' + meta.email) : null),
        h('td', { class: 'num' }, (s.last || '').slice(0, 10) || '—'),
        h('td', { class: 'num' }, diag ? diag.score + '/' + diag.total + ' · ' + diag.band : '未檢測'),
        h('td', { class: 'num' }, fmt(d5)), h('td', { class: 'num' }, fmt(d6)), h('td', { class: 'num' }, fmt(d7)),
        h('td', { class: 'num' }, vo.done + '/' + vo.total));

      const tnote = myKeys['tnote_' + uid] || { needs: '', logs: [] };
      const detailRow = h('tr', { style: 'display:none' },
        h('td', { colspan: '7', style: 'background:var(--bg-soft)' }, detail(name, diag, d5, d6, d7), noteSection(uid, tnote)));
      row.addEventListener('click', () => {
        detailRow.style.display = detailRow.style.display === 'none' ? '' : 'none';
      });
      table.append(row, detailRow);
    });
    root.append(table);
    root.append(h('div', { class: 'drill-nav-btns' },
      h('button', { class: 'btn', onclick: load }, '重新整理')));
  }

  function detail(name, diag, d5, d6, d7) {
    const box = h('div', { style: 'padding:8px 4px' });

    if (diag) {
      box.append(h('h3', { style: 'font-size:15.5px;margin-bottom:6px' }, '檢測(' + diag.finishedAt + '):答對 ' + diag.score + '/' + diag.total + ',參考級距 ' + diag.band));
      if (diag.weak.length) {
        box.append(h('div', { style: 'font-size:14px;margin-bottom:4px' }, '待加強考點:',
          diag.weak.map(([cat, c]) => h('span', { class: 'verdict-pill ' + (c.c / c.t < 0.4 ? 'weak' : 'mid'), style: 'margin:0 4px 4px 0;display:inline-block' }, cat + ' ' + c.c + '/' + c.t))));
      }
      if (diag.wrong.length) {
        box.append(h('div', { style: 'font-size:13.5px;color:var(--ink-light);margin-bottom:10px' },
          '檢測錯題:' + diag.wrong.map(w => 'Q' + (w.i + 1) + '(' + w.it.category + ')').join('、')));
      }
    } else {
      box.append(h('p', { style: 'font-size:14px;color:var(--ink-light);margin-bottom:8px' }, name + ' 還沒做程度檢測。'));
    }

    const wrongLine = (label, d, describe) => {
      if (!d.wrong.length) return null;
      return h('div', { style: 'font-size:13.5px;color:var(--ink-light);margin-bottom:6px' },
        label + ' 錯題(' + d.wrong.length + '):' + d.wrong.slice(0, 30).map(describe).join('、') + (d.wrong.length > 30 ? '…' : ''));
    };
    box.append(
      wrongLine('Part 5', d5, id => {
        const q = p5ById[id];
        return '#' + ((TOEIC.part5 || []).indexOf(q) + 1) + (q ? '(' + q.category + ')' : '');
      }),
      wrongLine('Part 6', d6, id => '題組' + (((TOEIC.part6 || []).findIndex(s => id.startsWith(s.id + ':'))) + 1) + ' 第' + id.split(':')[1] + '格'),
      wrongLine('Part 7', d7, id => {
        const si = (TOEIC.part7 || []).findIndex(s => id.startsWith(s.id + ':'));
        return '題組' + (si + 1) + ' Q' + (Number(id.split(':')[1]) + 1);
      }));
    return box;
  }
})();
