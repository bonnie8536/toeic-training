/* 課程的每週堂數與幾個小區塊(只有試行班看得到):
   每週上幾堂(第 1 堂上完後第一次開課程頁時出一次)、每週堂數面板(首頁「設定堂數」與「我的」頁那一列共用)、
   本週一列、獨立小檢核那一列、獨立小檢核的結果卡、程度調整那一塊、ⓘ 說明按鈕。
   元件一律用網站現有的:單選卡片(.ob-choice,點了就前進)、面板(UI.sheet,裡面是 .auth-role-card 加「套用」)、清單列(.me-list .me-row)、結算卡(UI.result)。
   載入時不依賴其他檔;LESSON_CORE(字)、LESSON_PLAN(每週堂數的規則)、LESSON_DATA、UI、store 在函式裡才用。
   「我的」頁沒有載 js/lesson-core.js:面板與「我的」頁那一列的字放在這一檔的 TEXT。
   面板套用時直接寫 store 的 plan(「我的」頁沒有 LESSON_DATA);按下前先 holdForAccount(js/common.js)。 */
(function (root) {
  'use strict';
  const TEXT = Object.freeze({ sheet: '每週堂數', next: '下週起生效', two: '每週 2 堂', one: '每週 1 堂', apply: '套用', row: '每週堂數' });
  let seq = 0;

  function el(tag, attrs, kids) {
    const n = root.document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    [].concat(kids || []).forEach((c) => { if (c !== null && c !== undefined) n.append(c); });
    return n;
  }
  const core = () => root.LESSON_CORE;
  const plan = () => root.LESSON_PLAN;
  const hold = (btn) => typeof root.holdForAccount === 'function' && root.holdForAccount(btn || null);
  const pad = (n) => (n < 10 ? '0' : '') + n;
  function today() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  const rowsOf = (p) => (p && Array.isArray(p.perWeek) ? p.perWeek.filter((e) => e && (e.n === 1 || e.n === 2)) : []);
  /* 最新一筆的每週堂數;沒選過是 2 */
  function latest(p) { const r = rowsOf(p); return r.length ? r[r.length - 1].n : 2; }
  function readPlan() { try { return typeof store !== 'undefined' && store ? store.get('plan', null) : null; } catch (e) { return null; } }   // js/common.js 的 store(頂層宣告,不在 window 上)
  function focusOn(n) { try { n.focus({ preventScroll: true }); if (typeof root.scrollTo === 'function') root.scrollTo(0, 0); } catch (e) { /* 焦點放不上去不影響 */ } }

  /* ---------- 每週上幾堂(上課頁、課程總覽) ---------- */
  /* 還沒問過(沒有欄位或 null 都算,上線前的 plan 沒有這個欄位)、第 1 堂已經上完 */
  function needWeekly(p, states) {
    return !!p && typeof p === 'object' && !p.weeklyAskedAt && !!(states && states[1] && states[1].doneAt);
  }
  /* 畫在 host 裡;選了寫每週堂數、「之後再選」只記問過。回 Promise:寫完 resolve('set' | 'later') */
  function weeklyScreen(host) {
    const W = core().TEXT.weekly, D = root.LESSON_DATA, id = 'lsn-weekly-h-' + (++seq);
    return new Promise((resolve) => {
      const choose = (n, btn) => {
        if (hold(btn)) return;
        try { D.setWeekly(n, Math.floor(Date.now() / 1000)); } catch (e) { console.error('每週堂數沒有存到：', e); }
        resolve('set');
      };
      const card = (n, label, sub) => el('button', { class: 'ob-choice lsn-weekly-choice', type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: n === 2 ? '0' : '-1' },
        [el('span', { class: 'lsn-weekly-t', text: label }), el('span', { class: 'lsn-weekly-sub', text: sub })]);
      const items = [card(2, W.two, W.twoSub), card(1, W.one, W.oneSub)];
      items.forEach((b, i) => b.addEventListener('click', () => choose(i ? 1 : 2, b)));
      const group = el('div', { class: 'ob-choices', role: 'radiogroup', 'aria-labelledby': id }, items);
      group.addEventListener('keydown', (e) => {
        const i = items.indexOf(root.document.activeElement), d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (i < 0 || !d) return;
        e.preventDefault();
        const n = items[(i + d + items.length) % items.length];
        items.forEach((x) => x.setAttribute('tabindex', x === n ? '0' : '-1'));
        n.focus();
      });
      const later = el('button', { class: 'btn-text', type: 'button', text: W.later });
      later.addEventListener('click', () => {
        if (hold(later)) return;
        try { D.askWeekly(); } catch (e) { console.error('沒有存到：', e); }
        resolve('later');
      });
      const head = el('h2', { class: 'lsn-h2', id, tabindex: '-1', text: W.h });
      host.replaceChildren(el('section', { class: 'lsn-narrow lsn-weekly' }, [head, group, el('p', { class: 'lsn-weekly-later' }, [later])]));
      focusOn(head);
    });
  }

  /* ---------- 每週堂數面板(首頁、我的頁) ---------- */
  /* opt.onApplied(新的 plan):套用寫完、面板關了之後 */
  function weeklySheet(opt) {
    const o = opt || {}, UI = root.UI, p = readPlan();
    if (!UI || typeof UI.sheet !== 'function' || !p) return null;
    const name = 'lsn-weekly-' + (++seq), pick = { n: latest(p) };
    const opts = [[2, TEXT.two], [1, TEXT.one]].map((x) => {
      const input = el('input', { type: 'radio', name, value: String(x[0]) });
      input.checked = pick.n === x[0];
      input.addEventListener('change', () => { pick.n = x[0]; });
      return el('label', { class: 'auth-role-card' }, [input, el('span', { text: x[1] })]);
    });
    const set = el('fieldset', { class: 'auth-role ob-level-set' }, [el('legend', { class: 'auth-role-legend', text: TEXT.sheet }), el('div', { class: 'auth-role-row' }, opts)]);
    const apply = el('button', { class: 'btn primary ob-apply', type: 'button', text: TEXT.apply });
    let sheet = null;
    apply.addEventListener('click', () => {
      if (hold(apply)) return;
      const cur = readPlan();
      if (!cur) return;
      const next = plan().withWeekly(cur, pick.n, today(), Date.now());
      store.set('plan', next);
      if (sheet) sheet.close();
      if (typeof o.onApplied === 'function') o.onApplied(next);
    });
    sheet = UI.sheet({ title: TEXT.sheet, note: rowsOf(p).length ? TEXT.next : null, class: 'ob-sheet', focus: set.querySelector('input:checked') || undefined,
      nodes: [set, el('div', { class: 'ob-sheet-actions' }, [apply])] });
    return sheet;
  }
  /* 「我的」頁學習設定的一列(有 plan、開關是 pilot 或 on 才出);點了開面板,套用後 onApplied */
  function settingsRow(onApplied) {
    const p = readPlan(), ui = root.PACKS_UI;
    if (!p || typeof p !== 'object' || (ui !== 'pilot' && ui !== 'on') || !plan()) return null;
    const btn = el('button', { class: 'me-row', type: 'button' }, [el('span', { text: TEXT.row }), el('span', { class: 'me-row-val', text: latest(p) === 1 ? TEXT.one : TEXT.two })]);
    btn.addEventListener('click', () => weeklySheet({ onApplied }));
    return el('li', null, [btn]);
  }

  /* ---------- 首頁卡、總覽頂端卡的兩列 ---------- */
  /* 本週一列(不可點);opt.unset(還沒選每週堂數)時後面接「設定堂數」,按了叫 opt.onSet */
  function weekRow(goal, opt) {
    if (!goal) return null;
    const o = opt || {}, T = core().TEXT.home;
    const kids = [el('span', { text: T.week(goal.done, goal.want, goal.days, goal.wantDays) })];
    if (o.unset) {
      const b = el('button', { class: 'btn-text lsn-week-set', type: 'button', text: T.setWeekly });
      b.addEventListener('click', () => { if (typeof o.onSet === 'function') o.onSet(b); });
      kids.push(b);
    }
    return el('p', { class: 'lsn-week' }, kids);
  }
  /* 獨立小檢核那一列(卡片最上面):第 n 堂小檢核　m 分鐘,連到 lesson.html?no=n&cp=1 */
  function soloRow(solo) {
    if (!solo) return null;
    const T = core().TEXT.home;
    return el('ul', { class: 'me-list lsn-solo' }, [el('li', null, [el('a', { class: 'me-row', href: 'lesson.html?no=' + solo.no + '&cp=1' },
      [el('span', { text: T.solo(solo.no) }), el('span', { class: 'me-row-val', text: T.soloMin(solo.minutes) })])])]);
  }

  /* 獨立小檢核的結果:結算卡(大字「小檢核」、主按鈕「繼續」回課程總覽,不給點心)下面直接接判定清單與解析(nodes,
     js/lesson-personal.js 的 cpResult;卡片的大字已經是小檢核,不再加同名的標題)。回 { nodes, heading } */
  function soloResult(no, nodes) {
    const C = core().TEXT;
    const card = root.UI.result({ kicker: C.wrapup.kicker(no), big: C.checkpoint.title, pose: 'happy', primary: { label: C.wrapup.next, href: 'lessons.html' } });
    return { nodes: [card.el, el('div', { class: 'lsn-narrow lsn-result-more lsn-solo-more' }, nodes || [])], heading: card.heading };
  }

  /* ---------- 程度調整與說明按鈕 ---------- */
  /* ⓘ:打開說明面板(UI.sheet,一行一段);但書與限制放這裡 */
  function infoButton(label, title, lines) {
    const b = el('button', { class: 'btn-text lsn-info', type: 'button', 'aria-label': label, text: 'ⓘ' });
    b.addEventListener('click', () => {
      if (root.UI && typeof root.UI.sheet === 'function') root.UI.sheet({ title, class: 'lsn-info-sheet', nodes: lines.map((t) => el('p', { class: 'lsn-info-line', text: t })) });
    });
    return b;
  }
  /* changed:{ listening: [舊, 新] | null, reading };都沒變回 null */
  function calibNotice(changed) {
    const c = changed || {}, T = core().TEXT.calib;
    const rows = ['listening', 'reading'].filter((k) => Array.isArray(c[k])).map((k) => el('li', null, [el('div', { class: 'me-row' },
      [el('span', { text: T[k] }), el('span', { class: 'me-row-val', text: T.move(c[k][0], c[k][1]) })])]));
    if (!rows.length) return null;
    const id = 'lsn-calib-h-' + (++seq);
    return el('section', { class: 'lsn-calib', 'aria-labelledby': id }, [
      el('div', { class: 'lsn-calib-head' }, [el('h2', { class: 'me-sec-h', id, text: T.h }), infoButton(T.info, T.h, T.lines)]),
      el('ul', { class: 'me-list' }, rows)]);
  }

  root.LESSON_WEEK = Object.freeze({ TEXT, needWeekly, weeklyScreen, weeklySheet, settingsRow, weekRow, soloRow, soloResult, infoButton, calibNotice });
})(typeof globalThis !== 'undefined' ? globalThis : this);
