/* 教師後台:總覽每位學生的檢測結果、各 Part 進度與正確率、錯題與單字進度。
   資料權限由 Supabase RLS 控管——只有 teachers 表裡的帳號查得到全部學生的列。 */
(function () {
  /* 最近一次讀到的原始列,給「下載備份」用。Supabase 免費版沒有任何自動備份,
     所以這是站長唯一的還原來源——動資料庫之前先按一次。 */
  let allRows = [];
  const root = $('#admin-root');

  function note(msg) {
    root.innerHTML = '';
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' }, msg));
  }

  if (!window.CLOUD || !CLOUD.enabled) {
    note('教師後台需要雲端模式。請先依「GITHUB上線指南.md」設定 Supabase，並填好 js/cloud-config.js。');
    return;
  }

  /* 收費畫面(js/plans-config.js 的 PAID_UI)打開才看使用權;沒開時跟以前一模一樣 */
  const PAID = window.PAID_UI === true;
  const AC = window.ADMIN_CLASSES || null;   // js/admin-classes.js:班級區、方案那一列
  /* js/admin-owner-*.js:收費管理,只有收費畫面打開、而且 my_access 說是站長才掛上;
     重新整理學生資料時留著同一個(篩選、頁數不會跑掉) */
  const OW = window.ADMIN_OWNER || null;
  let ownerArea = null;
  /* 站長模式(收費畫面打開、my_access 說是站長):下載備份多存收費資料、學生詳情多一段寫作批改(js/admin-owner-billing.js);
     沒開時這些都不出現,備份檔跟以前一模一樣 */
  const ownerOn = () => PAID && !!OW && !!OW.billing && OW.enabled();
  let backupMsg = null;
  function withOwner() {
    if (!PAID || !OW || !CLOUD.access || CLOUD.access.is_owner !== true) return;
    if (!ownerArea) ownerArea = OW.mount({ ownerId: CLOUD.user.id });
    if (ownerArea) OW.wrapTabs(root, ownerArea);
  }

  (async () => {
    await CLOUD.ready;
    if (!CLOUD.user) return;               // profile.js 會顯示登入視窗
    if (PAID) { try { await CLOUD.accessReady; } catch (e) { /* 讀不到使用權:照沒開時的畫面 */ } }
    if (!CLOUD.isTeacher) {
      const info = PAID && AC ? AC.planInfo(CLOUD.access, { paidUi: true }) : null;
      if (info && info.kind === 'trial_offer') {
        root.innerHTML = '';
        root.append(h('div', { class: 'page-head' }, h('h1', null, '教師後台')), AC.trialBlock(info));
        return;
      }
      note('這個帳號沒有教師權限。請改用教師帳號登入。');
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

  let loadGen = 0;   // 重新整理時讓上一次還沒畫完的題目回報區不要掛上去
  async function load() {
    const gen = ++loadGen;
    note('載入學生資料中…');
    let rows;
    try {
      const res = await CLOUD.client.from('progress').select('user_id,k,v,updated_at');
      if (res.error) throw res.error;
      rows = res.data || [];
      allRows = rows;
    } catch (e) {
      note('讀取失敗：' + e.message);
      withOwner();
      return;
    }

    /* 依學生分組(kt=各鍵最後更新時間,週摘要用) */
    const students = {};
    rows.forEach(r => {
      const s = students[r.user_id] = students[r.user_id] || { keys: {}, kt: {}, last: '' };
      if (r.v !== null) s.keys[r.k] = r.v;
      s.kt[r.k] = r.updated_at;
      /* 學生回報題目(q_reports)不算「最近活動」:只回報、沒練習的學生不會被當成今天有練 */
      if (r.k !== 'q_reports' && r.updated_at > s.last) s.last = r.updated_at;
    });

    render(students);
    /* 題目回報區(js/admin-reports.js):只有站長掛得上,不是站長時什麼節點都不加 */
    if (window.ADMIN_REPORTS) {
      const tn = (students[CLOUD.user.id] || { keys: {} }).keys;
      const nameOf = uid => {
        const s = students[uid];
        const meta = (s && s.keys['_meta']) || {};
        const t = tn['tnote_' + uid] || {};
        return t.nick || meta.name || meta.email || String(uid).slice(0, 8);
      };
      ADMIN_REPORTS.mount(root, { rows, nameOf, alive: () => gen === loadGen }).catch(() => { /* 回報區掛不上不影響後台 */ });
    }
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
    return { answered, correct, wrong, part: p, keys };
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
    /* 存進「這台現在登入的帳號」那一列:別的分頁登出、換了帳號(這一頁沒重載)就不送 */
    const gone = typeof CLOUD.accountCheck === 'function' ? CLOUD.accountCheck() : '';
    if (gone) {
      statusEl.textContent = gone;
      if (window.PROFILE && typeof PROFILE.accountGone === 'function') PROFILE.accountGone();
      return;
    }
    statusEl.textContent = '儲存中…';
    try {
      const res = await CLOUD.client.from('progress').upsert({
        user_id: CLOUD.user.id, k: 'tnote_' + uid, v: obj, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,k' });
      if (res.error) throw res.error;
      statusEl.textContent = '已儲存';
      setTimeout(() => { if (statusEl.textContent === '已儲存') statusEl.textContent = ''; }, 2500);
    } catch (e) {
      statusEl.textContent = '儲存失敗：' + e.message;
    }
  }

  /* 刪上課紀錄前的確認(UI.confirm);共用元件沒載到就不刪 */
  function askDelete(log) {
    if (!window.UI || typeof UI.confirm !== 'function') return Promise.resolve(false);
    return UI.confirm({ title: '刪除這筆紀錄？', body: log.d + ' 的上課紀錄', ok: '刪除', cancel: '取消', danger: true });
  }

  /* 學生端最後同步的時間(本機時區):月/日 時:分 */
  function syncText(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '—';
    const p2 = n => String(n).padStart(2, '0');
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  /* 沒有學生資料:一句加一顆按鈕「複製邀請碼」(複製班級的邀請碼;有幾個班就讓老師選) */
  function emptyStudents() {
    const msg = h('p', { class: 'ac-msg', role: 'status' });
    const picks = h('div', { class: 'ad-picks' });
    const say = (t, kind) => { msg.replaceChildren(); msg.className = 'ac-msg' + (kind ? ' ' + kind : ''); (Array.isArray(t) ? t : [t]).filter(Boolean).forEach(x => msg.append(h('span', { class: 'ad-line' }, x))); };
    async function copy(c) {
      try { await navigator.clipboard.writeText(c.code); say('已複製 ' + (c.name ? c.name + ' ' : '') + c.code, 'ok'); }
      catch (e) { say(['沒辦法自動複製', '請手動抄下 ' + c.code], 'bad'); }
    }
    async function onCopy() {
      picks.replaceChildren(); say('');
      const r = AC && AC.api ? await AC.api.list() : { ok: false, message: '', classes: [] };
      if (!r.ok) { say(r.message || '讀取失敗', 'bad'); return; }
      const on = (r.classes || []).filter(c => c.active !== false && c.code);
      if (!on.length) { say(['還沒有班級', '請先新增班級']); return; }
      if (on.length === 1) { copy(on[0]); return; }
      on.forEach(c => picks.append(h('button', { class: 'btn', type: 'button', onclick: () => copy(c) }, c.name || c.code)));
    }
    const label = '複製邀請碼';
    const text = '還沒有學生資料';
    if (window.UI && typeof UI.empty === 'function') {
      /* 多個班級時的挑選按鈕與結果訊息放在空狀態下面(extra) */
      return UI.empty({ pose: 'read', text, action: { label, onClick: onCopy }, extra: [picks, msg] });
    }
    return h('div', { class: 'q-block' }, text, h('button', { class: 'btn', type: 'button', onclick: onCopy }, label), picks, msg);
  }

  function noteSection(uid, tnote, onNick) {
    const wrap = h('div', { style: 'margin-top:14px;border-top:1px solid var(--line);padding-top:12px' });
    const status = h('span', { class: 'player-note', style: 'margin-left:10px' });
    wrap.append(h('h3', { style: 'font-size:15.5px;margin-bottom:6px' }, '上課紀錄與備註', h('span', { style: 'font-size:12px;color:var(--ink-light);font-weight:400' }, '（只有教師帳號看得到）'), status));

    /* 暱稱+學生需求/長期備註 */
    const nick = h('input', {
      class: 'game-input', type: 'text', maxlength: '12',
      placeholder: '暱稱（顯示在學生列表，方便認人）', style: 'max-width:260px;margin-bottom:8px',
    });
    nick.value = tnote.nick || '';
    const needs = h('textarea', { class: 'write-area', style: 'min-height:52px', placeholder: '學生需求或長期備註（目標分數、弱點、偏好的上課方式…）' });
    needs.value = tnote.needs || '';
    wrap.append(nick, needs,
      h('div', { class: 'pop-btns', style: 'margin:6px 0 14px' },
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => {
            tnote.nick = nick.value.trim();
            tnote.needs = needs.value.trim();
            saveNote(uid, tnote, status);
            if (onNick) onNick(tnote.nick);
          },
        }, '儲存暱稱與備註')));

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
            onclick: async () => {
              if (!(await askDelete(log))) return;
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

  /* 把能讀到的每一列原樣存成 JSON。還原時可以直接 upsert 回 progress。 */
  function downloadBackup(e) {
    if (ownerOn()) { OW.billing.backup({ rows: allRows, by: CLOUD.user && CLOUD.user.email, from: e && e.currentTarget, msg: backupMsg }); return; }
    const payload = {
      app: 'shuashua-progress-backup', version: 1,
      exported: new Date().toISOString(),
      by: CLOUD.user && CLOUD.user.email,
      rows: allRows,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '衝衝英文備份_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function render(students) {
    renderStudents(students);
    withOwner();
  }

  function renderStudents(students) {
    root.innerHTML = '';
    const own = ownerOn();
    backupMsg = own ? h('p', { class: 'ow-msg', role: 'status' }) : null;
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '教師後台'),
      h('div', { class: 'modal-row' },
        h('button', { class: 'btn', type: 'button', onclick: downloadBackup },
          '下載全部備份（' + allRows.length + ' 列）')),
      own ? h('p', { class: 'ow-backup-note' }, '學生進度只有妳看得到的學生（妳班上的人），收費資料讀得到時一起存進去；完整備份請在 SQL Editor 跑 backup 快照。') : null,
      backupMsg));

    const myKeys = (students[CLOUD.user.id] || { keys: {} }).keys;
    const ids = Object.keys(students).filter(uid => uid !== CLOUD.user.id);

    /* 班級區(邀請碼、成員、移除);收費畫面打開時上面多一列方案與名額 */
    const plan = PAID && AC ? AC.planInfo(CLOUD.access, { paidUi: true }) : null;
    if (AC) {
      root.append(AC.section({
        access: PAID ? CLOUD.access : null,
        nameOf: uid => {
          const s = students[uid];
          const meta = (s && s.keys['_meta']) || {};
          const tn = myKeys['tnote_' + uid] || {};
          const name = tn.nick || meta.name || meta.email || '';
          return name ? { name, email: meta.email || '' } : null;
        },
      }));
    }

    /* 本週動態:近 7 天各學生動過哪些區域。
       mock_wrong(模擬考答錯的題):錯題本答對只在模擬考錯題裡的題時只寫這個鍵(js/review.js),這週只做了這種複習的學生也要列出,
       不然學生表的「最近活動」是今天、這裡卻沒有他。模擬考交卷也會寫它,同一週有「模擬考」就不多標「模擬考錯題」 */
    const AREA = [
      [/^drill_p/, '刷題'], [/^listen_p/, '聽力刷題'], [/^grammar_done/, '文法'], [/^phonics_done/, '自然發音'],
      [/^(vocab_|vgame_|phrase_)/, '單字片語'], [/^writing_/, '寫作'],
      [/^ear_/, '聽力訓練'], [/^mock_history/, '模擬考'], [/^mock_wrong/, '模擬考錯題'], [/^diag/, '檢測'],
    ];
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const weekRows = ids.map(uid => {
      const s = students[uid];
      const areas = new Set();
      Object.entries(s.kt).forEach(([k, t]) => {
        if (t > weekAgo) { const hit = AREA.find(([re]) => re.test(k)); if (hit) areas.add(hit[1]); }
      });
      if (areas.has('模擬考')) areas.delete('模擬考錯題');
      return { uid, areas: [...areas], last: s.last };
    }).filter(r => r.areas.length);
    if (ids.length) {
      const box = h('div', { class: 'q-block', style: 'margin-bottom:20px' },
        h('h3', { style: 'font-size:15.5px;margin-bottom:8px' }, '本週動態（近 7 天）'));
      if (!weekRows.length) {
        box.append(h('p', { style: 'font-size:14px;color:var(--ink-light)' }, '這週還沒有學生活動。'));
      } else {
        weekRows.sort((a, b) => (b.last || '').localeCompare(a.last || '')).forEach(r => {
          const meta = students[r.uid].keys['_meta'] || {};
          const tn = myKeys['tnote_' + r.uid] || {};
          const nm = tn.nick || meta.name || meta.email || r.uid.slice(0, 8);
          box.append(h('div', { style: 'font-size:14px;padding:3px 0' },
            h('b', null, nm), '：' + r.areas.join('、') + '（最近 ' + (r.last || '').slice(5, 10) + '）'));
        });
      }
      root.append(box);
    }
    if (!ids.length) {
      /* 老師方案過了寬限時讀不到學生進度,但資料都還在(方案那一列已經寫了),不說「還沒有學生資料」 */
      if (!(plan && plan.kind === 'expired')) root.append(emptyStudents());
      return;
    }
    ids.sort((a, b) => (students[b].last || '').localeCompare(students[a].last || ''));

    const table = h('table', { class: 'cat-table' },
      h('tr', null,
        h('th', null, '學生'), h('th', null, '最近活動'), h('th', null, '檢測結果'), h('th', null, '起始程度'),
        h('th', null, 'Part 5'), h('th', null, 'Part 6'), h('th', null, 'Part 7'), h('th', null, '單字'),
        h('th', { class: 'ad-caret-th' }, h('span', { class: 'ad-sr' }, '展開'))));

    ids.forEach(uid => {
      const s = students[uid];
      const meta = s.keys['_meta'] || {};
      const tnote0 = myKeys['tnote_' + uid] || { needs: '', logs: [] };
      const name = tnote0.nick || meta.name || meta.email || uid.slice(0, 8);
      const diag = diagSummary(s.keys);
      const d5 = drillStats(s.keys, 5), d6 = drillStats(s.keys, 6), d7 = drillStats(s.keys, 7);
      const vo = vocabStats(s.keys);
      const fmt = d => d.answered ? d.answered + ' 題 · ' + Math.round(d.correct / d.answered * 100) + '%' : '—';

      const nameEl = h('b', null, name);
      const caret = h('button', { class: 'ad-caret', type: 'button', 'aria-expanded': 'false', 'aria-label': '展開 ' + name + ' 的資料' },
        h('span', { class: 'ad-caret-ico', 'aria-hidden': 'true' }));
      const row = h('tr', { style: 'cursor:pointer' },
        h('td', null, nameEl, meta.email && meta.email !== name ? h('span', { style: 'color:var(--ink-light);font-size:12.5px' }, ' ' + meta.email) : null,
          h('span', { class: 'ad-sync' }, '最後同步 ' + syncText(s.last))),
        h('td', { class: 'num' }, (s.last || '').slice(0, 10) || '—'),
        h('td', { class: 'num' }, diag ? diag.score + '/' + diag.total + ' · ' + diag.band : '未檢測'),
        h('td', { class: 'num' }, window.ONBOARD_CORE ? ONBOARD_CORE.levelsLabel(s.keys['levels']) : '未設定'),   // 起始程度(start.html 寫的 levels)
        h('td', { class: 'num' }, fmt(d5)), h('td', { class: 'num' }, fmt(d6)), h('td', { class: 'num' }, fmt(d7)),
        h('td', { class: 'num' }, vo.done + '/' + vo.total),
        h('td', { class: 'ad-caret-td' }, caret));

      const wb = ownerOn() ? OW.billing.writingBlock({ uid, keys: s.keys }) : null;
      const detailRow = h('tr', { style: 'display:none' },
        h('td', { colspan: '9', style: 'background:var(--bg-soft)' }, detail(name, diag, d5, d6, d7), wb ? wb.el : null,
          noteSection(uid, tnote0, n => { nameEl.textContent = n || meta.name || meta.email || uid.slice(0, 8); })));
      const toggle = () => {
        detailRow.style.display = detailRow.style.display === 'none' ? '' : 'none';
        const open = detailRow.style.display === '';
        caret.setAttribute('aria-expanded', open ? 'true' : 'false');
        row.classList.toggle('is-open', open);
        if (wb && open) wb.open();
      };
      /* 整列都能點;按鈕自己的點擊不重複觸發 */
      row.addEventListener('click', e => { if (e.target === caret || (caret.contains && caret.contains(e.target))) return; toggle(); });
      caret.addEventListener('click', toggle);
      table.append(row, detailRow);
    });
    root.append(table);
    root.append(h('div', { class: 'drill-nav-btns' },
      h('button', { class: 'btn', onclick: load }, '重新整理')));
  }

  function detail(name, diag, d5, d6, d7) {
    const box = h('div', { style: 'padding:8px 4px' });

    if (diag) {
      box.append(h('h3', { style: 'font-size:15.5px;margin-bottom:6px' }, '檢測(' + diag.finishedAt + ')：答對 ' + diag.score + '/' + diag.total + '，參考級距 ' + diag.band));
      if (diag.weak.length) {
        box.append(h('div', { style: 'font-size:14px;margin-bottom:4px' }, '待加強考點：',
          diag.weak.map(([cat, c]) => h('span', { class: 'verdict-pill ' + (c.c / c.t < 0.4 ? 'weak' : 'mid'), style: 'margin:0 4px 4px 0;display:inline-block' }, cat + ' ' + c.c + '/' + c.t))));
      }
      if (diag.wrong.length) {
        box.append(h('div', { style: 'font-size:13.5px;color:var(--ink-light);margin-bottom:10px' },
          '檢測錯題：' + diag.wrong.map(w => 'Q' + (w.i + 1) + '（' + w.it.category + '）').join('、')));
      }
    } else {
      box.append(h('p', { style: 'font-size:14px;color:var(--ink-light);margin-bottom:8px' }, name + ' 還沒做程度檢測。'));
    }

    /* 錯題清單:有 js/wrongbook.js 就用它算(學生的刷題紀錄加模擬考答錯的題 mock_wrong,2026-11-18),
       模擬考來的在描述後面加「(模擬考)」;已作答、正確率(drillStats)不變 */
    const wrongLine = (label, d, describe) => {
      let ids = d.wrong, mock = new Set();
      if (window.WRONGBOOK && d.part) {
        const list = WRONGBOOK.itemsFrom(String(d.part), d.keys['drill_p' + d.part], d.keys['mock_wrong']);
        ids = list.map(x => x.key);
        mock = new Set(list.filter(x => x.src === 'mock').map(x => x.key));
      }
      if (!ids.length) return null;
      return h('div', { style: 'font-size:13.5px;color:var(--ink-light);margin-bottom:6px' },
        label + ' 錯題(' + ids.length + ')：' + ids.slice(0, 30).map(id => describe(id) + (mock.has(id) ? '（模擬考）' : '')).join('、') + (ids.length > 30 ? '…' : ''));
    };
    /* 沒有錯題的 Part 回 null:瀏覽器的 append(null) 會印出「null」,先濾掉 */
    box.append(...[
      /* 題庫裡找不到(已淘汰的題,data/retired.json):只有沒載到 js/wrongbook.js 時會走到,寫「已淘汰」不寫成 #0、題組0 */
      wrongLine('Part 5', d5, id => {
        const q = p5ById[id];
        return q ? '#' + ((TOEIC.part5 || []).indexOf(q) + 1) + '（' + q.category + '）' : '已淘汰的題';
      }),
      wrongLine('Part 6', d6, id => {
        const si = (TOEIC.part6 || []).findIndex(s => id.startsWith(s.id + ':'));
        return si < 0 ? '已淘汰的題組' : '題組' + (si + 1) + ' 第' + id.split(':')[1] + '格';
      }),
      wrongLine('Part 7', d7, id => {
        const si = (TOEIC.part7 || []).findIndex(s => id.startsWith(s.id + ':'));
        return si < 0 ? '已淘汰的題組' : '題組' + (si + 1) + ' Q' + (Number(id.split(':')[1]) + 1);
      })].filter(Boolean));
    return box;
  }
})();
