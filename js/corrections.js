/* 題目更正紀錄頁(corrections.html):讀 data/corrections.json,分三組列出,可依區域篩選、搜尋題號。
   這頁不碰學生資料、不連 Supabase,所以不載 common.js、cloud.js。
   ?q=<題號> 開頁:標出那一列並展開所屬的組別(整組淘汰的題組編號也對得到,例如 q=p7-b4-2:1 對到 p7-b4-2)。 */
(function () {
  'use strict';
  var AREAS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', '文法', '文章', '片語', '英語耳'];
  var GROUPS = [
    { k: 'answer', title: '答案更正' },
    { k: 'retired', title: '淘汰換新' },
    { k: 'text', title: '題目文字修正' },
  ];
  var HEADS = ['日期', '題號', 'Part', '問題', '處理', '影響'];
  var LOAD_FAIL = '更正紀錄載入失敗\n請稍後再試';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* 這一列是不是 q 指的題:同一題,或 q 是整組淘汰那一組裡的小題(題組編號加冒號) */
  function isTarget(row, q) {
    if (!q) return false;
    return row.id === q || q.indexOf(row.id + ':') === 0 || row.id.indexOf(q + ':') === 0;
  }

  function processText(row) {
    return row.r;
  }

  function cell(tag, label, text) {
    var c = el(tag, '', text);
    if (label) c.setAttribute('data-label', label);
    return c;
  }

  function table(rows, q) {
    var t = el('table', 'corr-table');
    var hr = el('tr');
    HEADS.forEach(function (h) { hr.append(cell('th', '', h)); });
    var thead = el('thead');
    thead.append(hr);
    var tbody = el('tbody');
    var first = null;
    rows.forEach(function (row) {
      var tr = el('tr', isTarget(row, q) ? 'is-target' : '');
      if (isTarget(row, q)) { tr.setAttribute('aria-current', 'true'); if (!first) first = tr; }
      tr.append(cell('td', HEADS[0], row.d.replace(/-/g, '/')), cell('td', HEADS[1], row.id),
        cell('td', HEADS[2], row.a), cell('td', HEADS[3], row.p), cell('td', HEADS[4], processText(row)), cell('td', HEADS[5], row.i || ''));
      tbody.append(tr);
    });
    t.append(thead, tbody);
    return { el: t, target: first };
  }

  function render(root, data, q) {
    var rows = (data && data.rows) || [];
    var state = { area: '', text: '' };
    root.replaceChildren();

    var bar = el('div', 'corr-filters');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', '依區域篩選');
    var chips = {};
    [''].concat(AREAS).forEach(function (a) {
      var b = el('button', 'chip', a || '全部');
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { state.area = a; draw(false); });
      chips[a] = b;
      bar.append(b);
    });
    var search = el('input', 'corr-search');
    search.type = 'search';
    search.setAttribute('aria-label', '搜尋題號');
    search.setAttribute('placeholder', '搜尋題號');
    search.setAttribute('autocomplete', 'off');
    search.addEventListener('input', function () { state.text = String(search.value || '').trim().toLowerCase(); draw(false); });
    var body = el('div', 'corr-body');
    root.append(bar, search, body);

    function pass(r) {
      if (state.area && r.a !== state.area) return false;
      if (state.text && r.id.toLowerCase().indexOf(state.text) < 0) return false;
      return true;
    }

    function draw(initial) {
      Object.keys(chips).forEach(function (a) { chips[a].setAttribute('aria-pressed', a === state.area ? 'true' : 'false'); chips[a].className = a === state.area ? 'chip on' : 'chip'; });
      body.replaceChildren();
      var filtered = !!(state.area || state.text);
      var shown = 0;
      var target = null;
      GROUPS.forEach(function (g) {
        var list = rows.filter(function (r) { return r.k === g.k && pass(r); });
        if (!list.length) return;
        shown += list.length;
        var t = table(list, initial ? q : '');
        if (t.target && !target) target = t.target;
        var d = el('details', 'corr-group');
        /* 題目文字修正有近三百列,預設收合;有篩選、搜尋或 ?q= 指到時才展開 */
        if (g.k !== 'text' || filtered || t.target) d.setAttribute('open', '');
        var s = el('summary', '', g.title + '(' + list.length + ')');
        d.append(s, t.el);
        body.append(d);
      });
      if (!shown) body.append(el('p', 'corr-msg', '沒有符合的紀錄'));
      if (target) { target.scrollIntoView({ block: 'center' }); }
    }
    draw(true);
    return { state: state, search: search, chips: chips, body: body };
  }

  function load(root, fetchFn, q) {
    var f = fetchFn || (typeof fetch === 'function' ? fetch : null);
    var fail = function () { root.replaceChildren(el('p', 'corr-msg', LOAD_FAIL)); };
    if (!f) { fail(); return Promise.resolve(null); }
    return Promise.resolve().then(function () { return f('data/corrections.json'); })
      .then(function (r) { if (!r || !r.ok) throw new Error('http'); return r.json(); })
      .then(function (data) { if (!data || !Array.isArray(data.rows)) throw new Error('shape'); return render(root, data, q); })
      .catch(function () { fail(); return null; });
  }

  window.CORRECTIONS = { render: render, load: load, isTarget: isTarget, processText: processText };

  function start() {
    var root = document.getElementById('corr-app');
    if (!root) return;
    var m = /[?&]q=([^&]*)/.exec(location.search || '');
    var q = '';
    try { q = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() : ''; } catch (e) { q = ''; }
    load(root, null, q);
  }
  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})();
