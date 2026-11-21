/* 回報題目(window.REPORT):每題詳解方塊底部的「回報題目」按鈕、回報視窗、存進 q_reports。
   題號 key 一律是 模組:題目 id(跟學習記錄的 rec.m、rec.id 同一套),例如 p5:p5-b3-04、p6:p6-b7-1:2、g:ga-02:6。
   存放:每人一個鍵 q_reports(走 store 與雲端 progress 表,不動資料表),形狀 { key: { c 類型, n 補充說明, t 最近送出, f 第一次回報 } }。
   站長讀得到的只有自己班上學生的列(資料庫政策),而且任何老師都讀得到自己班上學生的全部列(含補充說明),所以視窗寫明老師看得到;
   學生看不出自己的班是不是站長的,送出後一律請他寄信給客服(mailto),不寫「已收到」。
   這支要在 common.js(h、store)與 cloud.js 之後載入;各頁呼叫時都包 window.REPORT &&,沒載到也不會壞。 */
(function () {
  'use strict';

  const SUPPORT = 'rushuplanguage@gmail.com';
  const KEY = 'q_reports';
  const MAX_NOTE = 200;
  const MAX_ITEMS = 100;
  const MAX_URL = 1500;
  const TYPES = [
    { c: 'wrong_key', label: '答案有誤' },
    { c: 'multi_key', label: '不只一個答案' },
    { c: 'audio', label: '音檔有問題', audioOnly: true },
    { c: 'typo', label: '題目或選項有錯字' },
    { c: 'unclear', label: '詳解看不懂' },
    { c: 'other', label: '其他' },
  ];
  const CODES = TYPES.map(t => t.c);
  /* 正常寫入的鍵一定是 模組:題目 id;學生可以繞過介面直接寫自己的列,constructor、toString 這類名字要擋在外面 */
  const KEY_RE = /^[a-z0-9]{1,4}:[A-Za-z0-9_.:-]{1,80}$/;
  const labelOf = c => (TYPES.find(t => t.c === c) || {}).label || '';
  const X_ICON = '<svg viewBox="0 0 22 22" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 5l12 12M17 5L5 17"/></svg>';

  const keyOf = (m, id) => String(m) + ':' + String(id);
  const isPlain = o => !!o && typeof o === 'object' && !Array.isArray(o);
  const cleanNote = s => String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);

  /* 讀 q_reports 時容錯:不是物件就當空的,單筆格式不對就丟掉(不改傳進來的東西) */
  function normalize(v) {
    const out = {};
    if (!isPlain(v)) return out;
    Object.keys(v).forEach(k => {
      if (!KEY_RE.test(k)) return;
      const e = v[k];
      if (!isPlain(e) || CODES.indexOf(e.c) < 0 || typeof e.t !== 'number' || !isFinite(e.t)) return;
      out[k] = { c: e.c, n: cleanNote(e.n), t: e.t, f: typeof e.f === 'number' && isFinite(e.f) ? e.f : e.t };
    });
    return out;
  }

  /* 加一筆或更新一筆,回新的物件(不改傳進來的)。同題:保留 f。超過 100 筆:丟掉 t 最舊的 */
  function record(map, key, c, n, now) {
    const cur = normalize(map);
    const old = cur[key];
    const next = Object.assign({}, cur);
    next[key] = { c, n: cleanNote(n), t: now, f: old ? old.f : now };
    const keys = Object.keys(next);
    if (keys.length > MAX_ITEMS) {
      keys.filter(k => k !== key).sort((a, b) => next[a].t - next[b].t).slice(0, keys.length - MAX_ITEMS).forEach(k => { delete next[k]; });
    }
    return next;
  }

  function partOf(ctx) {
    if (ctx.label) return ctx.label;
    const m = String(ctx.m);
    const p = /^[pl](\d)$/.exec(m);
    if (p) return 'Part ' + p[1];
    return { g: '文法', r: '文章', ph: '片語', ear: '英語耳' }[m] || m;
  }

  /* 寄給客服的信:主旨與內文照計畫 2.2。網址超過 1500 字元時把補充說明縮短(中文每字編碼後 9 個字元) */
  function mailto(rec, ctx) {
    const part = partOf(ctx);
    const type = labelOf(rec.c);
    const page = ctx.page || (typeof location !== 'undefined' && location.pathname ? location.pathname.split('/').pop() : '') || '';
    const subject = '題目回報 ' + ctx.id + '（' + part + '）' + type;
    const build = note => 'mailto:' + SUPPORT + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(
      '題號：' + ctx.id + '\n' + (/^Part /.test(part) ? 'Part：' + part.slice(5) : '範圍：' + part) + '\n回報類型：' + type + '\n補充說明：' + note + '\n頁面：' + page);
    let note = cleanNote(rec.n);
    let url = build(note);
    while (url.length > MAX_URL && note.length > 0) {
      note = note.slice(0, Math.max(0, Math.floor(note.length * 0.8) - 1)) + (note.length > 1 ? '…' : '');
      if (note === '…') note = '';
      url = build(note);
    }
    return url;
  }

  const online = () => !(typeof navigator !== 'undefined' && navigator.onLine === false);
  const dateText = t => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); };

  /* 寫進 q_reports。store.set 失敗是靜默的(沒登入、帳號資料夾不能寫、儲存空間滿),所以寫完讀回來確認 */
  function save(key, c, n) {
    const now = Date.now();
    const next = record(store.get('q_reports', {}), key, c, n, now);
    store.set('q_reports', next);
    const back = normalize(store.get('q_reports', {}));
    return back[key] && back[key].t === now && back[key].c === c ? back[key] : null;
  }

  /* ---------- 視窗 ---------- */
  function open(ctx, opener) {
    if (document.querySelector('.modal-mask')) return;
    if (typeof canKeepProgress === 'function' && !canKeepProgress()) {
      try { if (window.PROFILE && typeof PROFILE.askToAct === 'function') PROFILE.askToAct(opener); } catch (e) { /* 卡開不了就不開 */ }
      return;
    }
    const key = keyOf(ctx.m, ctx.id);
    const prev = normalize(store.get('q_reports', {}))[key] || null;
    const types = TYPES.filter(t => !t.audioOnly || ctx.audio);
    let chosen = prev && types.some(t => t.c === prev.c) ? prev.c : '';

    const closeBtn = h('button', { class: 'modal-close', type: 'button', 'aria-label': '關閉', html: X_ICON, onclick: () => close() });
    const title = h('h2', { class: 'auth-h', id: 'rp-h', tabindex: '-1' }, '回報題目');
    const sub = h('p', { class: 'auth-fine rp-sub' }, partOf(ctx) + ' · ' + ctx.id);
    const radios = types.map(t => {
      const input = h('input', { type: 'radio', name: 'rp-type', value: t.c });
      if (t.c === chosen) input.checked = true;
      input.addEventListener('change', () => { chosen = t.c; submit.disabled = false; });
      return h('label', { class: 'buy-opt' }, input, h('span', { class: 'buy-opt-name' }, t.label));
    });
    const legend = h('legend', { class: 'buy-legend' }, '回報類型');
    const set = h('fieldset', { class: 'buy-opts' }, legend, h('div', { class: 'buy-opt-list' }, radios));
    const note = h('textarea', { class: 'auth-input rp-note', id: 'rp-note', name: 'note', rows: '3', maxlength: String(MAX_NOTE), autocomplete: 'off' });
    note.value = prev ? prev.n : '';
    const field = h('div', { class: 'auth-field' }, h('label', { for: 'rp-note' }, '補充說明 ', h('span', { class: 'auth-opt' }, '選填')), note,
      h('p', { class: 'auth-fine' }, '補充說明會存在你的帳號資料裡\n班上的老師看得到'));
    const msg = h('p', { class: 'auth-msg', role: 'alert' });
    const submit = h('button', { class: 'btn primary auth-submit', type: 'submit' }, '送出');
    submit.disabled = !chosen;
    const form = h('form', { class: 'auth-form', novalidate: 'novalidate' }, set, field, msg, submit);
    const prevLine = prev ? h('p', { class: 'auth-fine' }, '你在 ' + dateText(prev.t) + ' 回報過這題\n再送出會更新內容') : null;
    const mask = h('div', { class: 'modal-mask buy-mask' });
    const box = h('div', { class: 'modal modal-auth modal-report', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rp-h' },
      closeBtn, title, sub, prevLine, form);
    mask.append(box);
    document.body.append(mask);

    let busy = false;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (busy || !chosen) return;
      busy = true;
      msg.textContent = ''; msg.className = 'auth-msg';
      submit.disabled = true; closeBtn.disabled = true;
      const rec = save(key, chosen, note.value);
      if (!rec) {
        busy = false; submit.disabled = false; closeBtn.disabled = false;
        msg.textContent = '存不進去\n請重新整理後再試'; msg.className = 'auth-msg bad';
        return;
      }
      busy = false; closeBtn.disabled = false;
      result(rec);
    });

    /* 站長只讀得到自己班上學生的列,而學生看不出自己的班是不是站長的,所以一律請對方寄信,不說「已收到」 */
    function result(rec) {
      title.textContent = '請寄信給客服';
      box.replaceChildren(closeBtn, title);
      const addr = h('span', { class: 'rp-addr' }, SUPPORT);
      const copy = h('button', { class: 'btn', type: 'button' }, '複製地址');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(SUPPORT); copy.textContent = '已複製'; } catch (e) { copy.textContent = '請手動複製'; }
      });
      const done = h('button', { class: 'btn auth-submit', type: 'button', onclick: () => close() }, '關閉');
      box.append(h('p', { class: 'auth-fine' }, (online() ? '回報已存在你的帳號' : '回報已存在這台裝置') + '\n寄出信件後客服才收得到'),
        h('a', { class: 'btn primary auth-submit rp-mail', href: mailto(rec, ctx) }, '寄給客服'),
        h('p', { class: 'auth-fine' }, addr), copy, done);
      try { title.focus(); } catch (e) { /* 沒焦點也不影響 */ }
    }

    function onKey(e) {
      if (e.key === 'Escape') { if (!busy) close(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(box.querySelectorAll('button,input,textarea,a[href]')).filter(x => !x.disabled);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!box.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    /* 點背景關閉要等 click:mousedown 就關的話,瀏覽器之後的預設行為會把焦點搶到 body。按下與放開都在背景才算 */
    let downOnMask = false;
    mask.addEventListener('mousedown', e => { downOnMask = e.target === mask; });
    mask.addEventListener('click', e => { if (downOnMask && e.target === mask && !busy) close(); downOnMask = false; });
    try { title.focus(); } catch (e) { /* 略 */ }

    function close() {
      if (busy) return;
      document.removeEventListener('keydown', onKey);
      mask.remove();
      try { if (opener && opener.isConnected) opener.focus(); } catch (e) { /* 略 */ }
    }
  }

  /* 詳解方塊底部加一顆按鈕。同一個方塊只加一次 */
  function attach(explainEl, ctx) {
    if (!explainEl || !ctx || ctx.m === undefined || ctx.id === undefined || ctx.id === null || ctx.id === '') return null;
    const have = explainEl.querySelectorAll ? explainEl.querySelectorAll('.report-row') : [];
    if (have && have.length) return have[0];
    const btn = h('button', { class: 'btn report-btn', type: 'button', 'data-gate': '', 'aria-label': '回報題目 ' + partOf(ctx) + ' ' + ctx.id }, '回報題目');
    btn.addEventListener('click', () => open(ctx, btn));
    const row = h('div', { class: 'report-row' }, btn);
    explainEl.append(row);
    return row;
  }

  window.REPORT = { attach, open, keyOf, mailto, normalize, record, KEY_RE, TYPES, MAX_NOTE, MAX_ITEMS, SUPPORT, KEY };
})();
