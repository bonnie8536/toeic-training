/* 錯題本的畫面(錯題本定稿 2026-11-18 第 2 節):一個 Part 一頁(practice.html?mode=wrong&part=N),裡面一組一組,點組名才展開。
   資料都從 js/wrongbook.js(WRONGBOOK)來;能力分析(js/analysis.js)也用這裡的 groupList。window.WRONGBOOK_UI。
   - 慣例:每組是一顆展開鈕(button + aria-expanded + aria-controls,收起用 hidden;APG Disclosure/Accordion 的寫法),
     包在 heading 裡、heading 裡只有它;「複習」連結放在 heading 外面同一列的右邊(所以不用 <details>)。可以同時開好幾組;
     組數 2 以上有「全部展開／全部收起」(GOV.UK accordion)。不加 role=region(組多的時候 APG 建議不要每組都加)。
   - 開了哪幾組記在 sessionStorage tr_wb_open(只在這個分頁,不同步):從複習按上一頁回來,剛剛開的組還開著。讀寫丟錯就全部收起。
   - 每一列:日期(模擬考來的接「 · 模擬考」)、題目、你的答案 · 正解。列不能再點開,要看解析按這一組的「複習」。
   - 不呼叫 PET_HOOK(小雞的掛勾在各個練習的結尾) */
(function () {
  const W = window.WRONGBOOK;
  if (!W) { window.WRONGBOOK_UI = null; return; }
  const OPEN = 'tr_wb_open';

  function readOpen() {
    try { const o = JSON.parse(sessionStorage.getItem(OPEN)); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
  }
  function writeOpen(part, names) {
    try { const o = readOpen(); o[part] = names; sessionStorage.setItem(OPEN, JSON.stringify(o)); } catch (e) { /* 存不了:下次全部收起 */ }
  }
  const reviewUrl = (p, g) => 'practice.html?mode=review&part=' + p + (g ? '&g=' + encodeURIComponent(g) : '');
  const listUrl = (p) => 'practice.html?mode=wrong&part=' + p;
  function day(t) {
    if (!t) return '';
    const d = new Date(t), now = new Date();
    return (d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '/') + (d.getMonth() + 1) + '/' + d.getDate();
  }
  function itemRow(x) {
    const meta = [day(x.t), x.src === 'mock' ? '模擬考' : ''].filter(Boolean).join(' · ');
    const you = W.optText(x.q, x.c), key = W.optText(x.q, x.q.answer);
    return h('div', { class: 'wrong-cat-item wb-item' },
      meta ? h('div', { class: 'wb-meta' }, meta) : null,
      h('div', { class: 'wb-stem' }, W.stem(x)),
      h('div', { class: 'wb-ans' },
        you ? h('span', { class: 'wb-you' }, '你的答案：' + you) : null,
        you ? ' · ' : null,
        h('span', { class: 'wb-key' }, '正解：' + key)));
  }

  /* 組的清單。opts:{ part, level(heading 層級 2 或 3), remember(記開了哪幾組) }。組數 2 以上放「全部展開」。
     聽力 Part 1 不分組(組名是空的):直接一張清單 */
  function groupList(groups, opts) {
    const p = String(opts.part), level = opts.level === 3 ? 'h3' : 'h2';
    const wrap = h('div', { class: 'wb-groups' });
    if (groups.length === 1 && !groups[0].name) {
      wrap.append(h('div', { class: 'wrong-cat-list wb-list wb-flat' }, groups[0].items.map(itemRow)));
      return wrap;
    }
    const was = opts.remember ? readOpen()[p] : null;
    const openSet = new Set(Array.isArray(was) ? was.filter((x) => typeof x === 'string') : []);
    const rows = [];
    let allBtn = null;
    const sync = () => {
      const all = rows.every((r) => r.open);
      if (allBtn) { allBtn.textContent = all ? '全部收起' : '全部展開'; allBtn.setAttribute('aria-expanded', all ? 'true' : 'false'); }
      if (opts.remember) writeOpen(p, rows.filter((r) => r.open).map((r) => r.name));
    };
    const set = (r, open) => {
      r.open = open;
      r.btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      r.list.hidden = !open;
    };
    if (groups.length >= 2) {
      allBtn = h('button', { type: 'button', class: 'btn wb-all', 'aria-expanded': 'false' }, '全部展開');
      allBtn.addEventListener('click', () => { const open = !rows.every((r) => r.open); rows.forEach((r) => set(r, open)); sync(); });
      wrap.append(h('div', { class: 'wb-tools' }, allBtn));
    }
    groups.forEach((g, i) => {
      const n = g.items.length;
      const btn = h('button', { type: 'button', class: 'wrong-cat-row wb-toggle', id: 'wb-b-' + p + '-' + i, 'aria-expanded': 'false', 'aria-controls': 'wb-l-' + p + '-' + i },
        h('span', { class: 'wb-caret', 'aria-hidden': 'true' }, '▾'), h('span', { class: 'wb-name' }, g.name), h('b', null, n + ' 題'));
      const list = h('div', { class: 'wrong-cat-list wb-list', id: 'wb-l-' + p + '-' + i }, g.items.map(itemRow));
      list.hidden = true;
      const r = { name: g.name, btn, list, open: false };
      btn.addEventListener('click', () => { set(r, !r.open); sync(); });
      if (openSet.has(g.name)) set(r, true);
      rows.push(r);
      wrap.append(h('div', { class: 'wb-group' },
        h('div', { class: 'wb-head' },
          h(level, { class: 'wb-h' }, btn),
          h('a', { class: 'btn wb-go', 'data-gate': '', href: reviewUrl(p, g.name), 'aria-label': '複習「' + g.name + '」' + n + ' 題' }, '複習')),
        list));
    });
    sync();
    return wrap;
  }

  /* 一行說明:幾題、在幾個題組(段對話)裡、分成幾類 */
  function summaryLine(p, groups) {
    const all = groups.reduce((a, g) => a.concat(g.items), []);
    const n = all.length, sets = new Set(all.map((x) => (x.set ? x.set.id : x.key))).size;
    if (p === '1') return n + ' 題。答對就移出。';
    if (p === '3') return n + ' 題，在 ' + sets + ' 段對話裡。答對就移出。';
    if (W.isSetPart(p)) return n + ' 題，在 ' + sets + ' 個題組裡，分成 ' + groups.length + ' 類。答對就移出。';
    return n + ' 題，分成 ' + groups.length + ' 類。答對就移出。';
  }

  /* 清單頁 */
  function renderList(root, p) {
    document.title = W.TITLE[p] + ' 錯題本 - 衝衝英文';
    root.innerHTML = '';
    root.append(h('div', { class: 'drill-top' },
      h('h1', null, W.TITLE[p] + ' 錯題本'),
      h('a', { href: 'practice.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回題庫')));
    const groups = W.groups(p);
    if (!groups.length) {
      root.append(h('div', { class: 'q-block' }, '目前沒有錯題。'),
        h('div', { class: 'drill-nav-btns' }, h('a', { class: 'btn', href: 'practice.html' }, '回題庫')));
      return;
    }
    const first = W.round(p);
    root.append(h('p', { class: 'result-note wb-sum' }, summaryLine(p, groups)),
      h('div', { class: 'wb-start' },
        h('a', { class: 'btn primary', 'data-gate': '', href: reviewUrl(p) }, '開始複習（' + first.units.length + ' ' + W.unit(p) + '）')),
      groupList(groups, { part: p, level: 2, remember: true }));
  }

  window.WRONGBOOK_UI = Object.freeze({ renderList, groupList, reviewUrl, listUrl });
})();
