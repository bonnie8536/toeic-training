/* 錯題本的畫面:一個 Part 一頁(practice.html?mode=wrong&part=N),裡面一組一組,點組名才展開。
   資料都從 js/wrongbook.js(WRONGBOOK)來;能力分析(js/analysis.js)也用這裡的 groupList。window.WRONGBOOK_UI。
   - 慣例:每組是一顆展開鈕(button + aria-expanded + aria-controls,收起用 hidden;APG Disclosure/Accordion 的寫法),
     包在 heading 裡、heading 裡只有它;「複習」連結放在 heading 外面同一列的右邊(所以不用 <details>)。可以同時開好幾組;
     組數 2 以上有「全部展開／全部收起」(GOV.UK accordion)。不加 role=region(組多的時候 APG 建議不要每組都加)。
   - 開了哪幾組記在 sessionStorage tr_wb_open(只在這個分頁,不同步):從複習按上一頁回來,剛剛開的組還開著。讀寫丟錯就全部收起。
   - 每一列:日期(模擬考來的接「 · 模擬考」)、題目、你的答案 · 正解(手機各佔一行,css/style.css .wb-sep)。列不能再點開,要看解析按這一組的「複習」。
   - 從複習按上一頁回來:網站上線時頁面從 bfcache 原樣拿回來、程式不會重跑,錯題本變了要自己重畫(keepFresh;js/daily-ui.js 同一招)。
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
        you ? h('span', { class: 'wb-sep' }, ' · ') : null,
        h('span', { class: 'wb-key' }, '正解：' + key)));
  }

  /* 組的清單。opts:{ part, level(heading 層級 2、3 或 4:錯題本清單頁 2;能力分析 4,那裡 Part 名稱是 h3), remember(記開了哪幾組), open(要開著的組名;重畫時用,沒給就看 remember) }。
     組數 2 以上放「全部展開」(報讀名稱帶 Part,能力分析一頁有好幾顆)。聽力 Part 1 不分組(組名是空的):直接一張清單 */
  function groupList(groups, opts) {
    const p = String(opts.part), level = opts.level === 3 || opts.level === 4 ? 'h' + opts.level : 'h2';
    const wrap = h('div', { class: 'wb-groups', 'data-part': p });
    if (groups.length === 1 && !groups[0].name) {
      wrap.append(h('div', { class: 'wrong-cat-list wb-list wb-flat' }, groups[0].items.map(itemRow)));
      return wrap;
    }
    const was = Array.isArray(opts.open) ? opts.open : opts.remember ? readOpen()[p] : null;
    const openSet = new Set(Array.isArray(was) ? was.filter((x) => typeof x === 'string') : []);
    const rows = [];
    let allBtn = null;
    const sync = () => {
      const all = rows.every((r) => r.open), text = all ? '全部收起' : '全部展開';
      if (allBtn) { allBtn.textContent = text; allBtn.setAttribute('aria-label', text + ' ' + W.TITLE[p]); allBtn.setAttribute('aria-expanded', all ? 'true' : 'false'); }
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
      wrap.append(h('div', { class: 'wb-group', 'data-g': g.name },
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
    if (p === '1') return n + ' 題';
    if (p === '3') return n + ' 題 · ' + sets + ' 段對話';
    if (W.isSetPart(p)) return n + ' 題 · ' + sets + ' 個題組 · ' + groups.length + ' 類';
    return n + ' 題 · ' + groups.length + ' 類';
  }

  /* 清單頁:畫一次,之後從 bfcache 回來、錯題本變了再重畫 */
  function paintList(root, p, open) {
    document.title = W.TITLE[p] + ' 錯題本 - 衝衝英文';
    root.innerHTML = '';
    root.append(h('div', { class: 'page-head wb-top' },
      h('canvas', { class: 'hub-art', 'data-doodle': 'wrongbook', 'data-size': '40', 'aria-hidden': 'true' }),
      h('h1', null, W.TITLE[p] + ' 錯題本'),
      h('a', { class: 'wb-back', href: 'practice.html' }, '← 回題庫刷題')));
    const groups = W.groups(p);
    if (!groups.length) {
      root.append(window.UI ? UI.empty({ pose: 'sleep', text: '沒有錯題', action: { label: '去刷題', href: 'practice.html' } })
        : h('div', { class: 'q-block' }, '沒有錯題'));
      if (window.UI) UI.doodle(root);
      return;
    }
    const first = W.round(p);
    const total = groups.reduce((a, g) => a + g.items.length, 0);
    /* 摘要行已經寫了同樣的題數(單位是題、這一輪就是全部)時,按鈕旁不再重複 */
    const dupCount = W.unit(p) === '題' && first.units.length === total;
    root.append(h('p', { class: 'result-note wb-sum' }, summaryLine(p, groups)),
      h('div', { class: 'wb-start' },
        h('a', { class: 'btn primary wb-begin', 'data-gate': '', href: reviewUrl(p) }, '開始'),
        dupCount ? null : h('span', { class: 'result-note' }, ' ' + first.units.length + ' ' + W.unit(p))),
      groupList(groups, { part: p, level: 2, remember: true, open: open && open[p] }));
    if (window.UI) UI.doodle(root);
  }
  function renderList(root, p) {
    paintList(root, p, null);
    keepFresh(root, () => sig([p]), (open) => paintList(root, p, open));
  }

  /* ---------- 從複習按上一頁回來(手機返回鍵、iPhone 往右滑) ----------
     網站上線時(GitHub Pages 不是 no-store)頁面會從 bfcache 原樣拿回來,程式不會重跑,畫面停在去複習之前。
     pageshow 的 persisted 是 true 時(或分頁叫回前景時)看錯題本有沒有變(sig),變了才叫 paint(open) 重畫 box:
     open 是重畫前開著的組({ Part: [組名] }),焦點放回同一個 Part、同一組的同一顆(展開鈕、複習、全部展開、開始複習、查看),
     那一組沒了就算了。沒變就不動(焦點、捲動位置都照舊) */
  function sig(parts) {
    return parts.map((p) => W.items(p).map((x) => x.key + ':' + x.src + ':' + x.c + ':' + x.t).join(',')).join('|');
  }
  const KINDS = ['wb-toggle', 'wb-go', 'wb-all', 'wb-begin', 'wb-see', 'wb-book'];
  function openNow(box) {
    const o = {};
    box.querySelectorAll('.wb-groups').forEach((w) => {
      o[w.dataset.part] = [...w.querySelectorAll('.wb-group')].filter((g) => { const b = g.querySelector('.wb-toggle'); return b && b.getAttribute('aria-expanded') === 'true'; })
        .map((g) => g.dataset.g);
    });
    return o;
  }
  function focusSpot(box) {
    const a = document.activeElement;
    if (!a || !a.classList || !box.contains(a)) return null;
    const kind = KINDS.find((c) => a.classList.contains(c));
    if (!kind) return null;
    const pe = a.closest('[data-part]'), ge = a.closest('[data-g]');
    return { kind, p: pe && box.contains(pe) ? pe.dataset.part : null, g: ge && box.contains(ge) ? ge.dataset.g : null };
  }
  function refocus(box, x) {
    let scope = x.p === null ? box : [...box.querySelectorAll('[data-part]')].find((e) => e.dataset.part === x.p);
    if (scope && x.g !== null) scope = [...scope.querySelectorAll('[data-g]')].find((e) => e.dataset.g === x.g);
    const el = scope && scope.querySelector('.' + x.kind);
    if (el) el.focus({ preventScroll: true });
  }
  function keepFresh(box, sigNow, paint) {
    let last = sigNow();
    const check = () => {
      if (!box.isConnected) return;   // 題庫首頁開始練習之後面板已經不在畫面上
      const now = sigNow();
      if (now === last) return;
      last = now;
      const spot = focusSpot(box), open = openNow(box);
      paint(open);
      if (spot) refocus(box, spot);
    };
    window.addEventListener('pageshow', (e) => { if (e.persisted) check(); });
    /* 在別的分頁複習完切回來也一樣(js/daily-ui.js 的 visibilitychange) */
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    /* 開頁跟雲端對齊(WRONGBOOK.syncCloud)把別台考的錯題合併進本機時,js/cloud.js 送 cloud:merged:一樣看有沒有變再重畫 */
    window.addEventListener('cloud:merged', (e) => { if (e && e.detail && e.detail.key === 'mock_wrong') check(); });
  }

  window.WRONGBOOK_UI = Object.freeze({ renderList, groupList, reviewUrl, listUrl, sig, keepFresh });
})();
