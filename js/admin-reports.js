/* 教師後台的「題目回報」區(window.ADMIN_REPORTS):只有站長掛上。
   資料:admin.js 已經讀回的 progress 列裡 k === 'q_reports' 的那些(學生用 js/report.js 回報,每人一鍵);
   資料庫政策只讓站長讀到自己班上學生的列,所以這裡看到的是「班上學生」的回報,不在班的人走客服信箱。
   同一個政策也讓任何老師讀得到自己班上學生的 q_reports(含補充說明),回報視窗已寫明。
   一題一列,依回報人數、最近日期排序;展開看每位回報者的類型、補充說明、日期,可看題目、複製題號、標已處理、下載 CSV。
   已處理標記存在站長自己的 progress 列 rreview(跟 tnote_ 一樣只有站長用,不進搬家規則),不碰學生的列。
   補充說明是學生打的任意字:一律 textContent,CSV 的儲存格防公式。 */
(function () {
  'use strict';

  const TYPE = { wrong_key: '答案有誤', multi_key: '不只一個答案', audio: '音檔有問題', typo: '題目或選項有錯字', unclear: '詳解看不懂', other: '其他' };
  const MODULE = { p5: 'Part 5', p6: 'Part 6', p7: 'Part 7', l1: '聽力 Part 1', l2: '聽力 Part 2', l3: '聽力 Part 3', l4: '聽力 Part 4', g: '文法', r: '文章題', ph: '片語', ear: '英語耳' };
  const DATA_FILE = { l1: 'data/listening.js', l2: 'data/listening.js', l3: 'data/listening.js', l4: 'data/listening.js', g: 'data/grammar.js', ph: 'data/phrases.js', ear: 'data/ear.js' };
  const LETTERS = ['A', 'B', 'C', 'D'];
  const isPlain = o => !!o && typeof o === 'object' && !Array.isArray(o);
  const splitKey = key => { const i = key.indexOf(':'); return i < 0 ? { m: '', id: key } : { m: key.slice(0, i), id: key.slice(i + 1) }; };
  const pad = n => (n < 10 ? '0' : '') + n;
  const day = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const dayTime = t => { const d = new Date(t); return day(t) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };

  /* 一個回報者的一筆(格式不對丟掉;沒載 js/report.js 時自己驗最基本的) */
  function entriesOf(v) {
    if (window.REPORT && typeof REPORT.normalize === 'function') return REPORT.normalize(v);
    const out = {};
    if (!isPlain(v)) return out;
    Object.keys(v).forEach(k => { if (!/^[a-z0-9]{1,4}:[A-Za-z0-9_.:-]{1,80}$/.test(k)) return; const e = v[k]; if (isPlain(e) && TYPE[e.c] && typeof e.t === 'number') out[k] = { c: e.c, n: String(e.n || '').slice(0, 200), t: e.t, f: e.f }; });
    return out;
  }

  /* 把所有學生的 q_reports 合成「一題一列」:[{ key, m, id, list: [{ uid, name, c, n, t }], count, lastT }],人數多的在前、同人數近的在前 */
  function aggregate(rows, nameOf) {
    const by = Object.create(null);
    (rows || []).forEach(r => {
      if (!r || r.k !== 'q_reports' || r.v === null || r.v === undefined) return;
      const ent = entriesOf(r.v);
      Object.keys(ent).forEach(key => {
        const g = by[key] = by[key] || Object.assign({ key, list: [] }, splitKey(key));
        g.list.push({ uid: r.user_id, name: nameOf ? nameOf(r.user_id) : String(r.user_id).slice(0, 8), c: ent[key].c, n: ent[key].n, t: ent[key].t });
      });
    });
    return Object.keys(by).map(key => {
      const g = by[key];
      g.list.sort((a, b) => b.t - a.t);
      g.count = g.list.length;
      g.lastT = g.list[0].t;
      return g;
    }).sort((a, b) => b.count - a.count || b.lastT - a.lastT || (a.key < b.key ? -1 : 1));
  }

  /* 已處理:{ 題號: { s: 'done', t } };處理之後又有新回報(lastT 比標記時間新)就當作還沒處理 */
  const isClosed = (g, review) => { const x = review && review[g.key]; return !!x && (x.s === 'done' || x.s === 'ignored') && typeof x.t === 'number' && g.lastT <= x.t; };

  /* CSV:字串以 = + - @ 開頭(或 Tab、CR)的儲存格前面補單引號,試算表才不會當公式;有逗號、引號、換行的包雙引號 */
  function csvCell(v) {
    let s = String(v === undefined || v === null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(groups) {
    const lines = [['題號', '模組', '類型', '補充說明', '回報者暱稱', '回報時間'].map(csvCell).join(',')];
    groups.forEach(g => g.list.forEach(x => {
      lines.push([g.id, MODULE[g.m] || g.m, TYPE[x.c] || x.c, x.n, x.name, dayTime(x.t)].map(csvCell).join(','));
    }));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /* ---------- 看題目 ---------- */
  const byId = (list, id) => (list || []).find(x => x && x.id === id);
  function describe(m, id) {
    const T = window.TOEIC || {};
    const LD = T.listening || {};
    const fromQ = (q, tag, stem) => q && { tag, stem: stem !== undefined ? stem : q.q, options: q.options, answer: q.answer, explanation: q.explanation };
    const [sid, rest] = (() => { const i = id.indexOf(':'); return i < 0 ? [id, ''] : [id.slice(0, i), id.slice(i + 1)]; })();
    if (m === 'p5') { const q = byId(T.part5, id); return q && fromQ(q, q.category, q.question); }
    if (m === 'p6') { const s = byId(T.part6, sid); const q = s && s.questions.find(x => String(x.num) === rest); return q && fromQ(q, s.title, '空格 (' + q.num + ')'); }
    if (m === 'p7') { const s = byId(T.part7, sid); const q = s && s.questions[Number(rest)]; return q && fromQ(q, s.title); }
    if (m === 'l1' || m === 'l2') { const q = byId(LD[m === 'l1' ? 'p1' : 'p2'], id); return q && fromQ(q, '', q.question || (m === 'l1' ? '照片描述題' : '應答題')); }
    if (m === 'l3' || m === 'l4') { const s = byId(LD[m === 'l3' ? 'p3' : 'p4'], sid); const q = s && s.questions[Number(rest)]; return q && fromQ(q, '', q.q); }
    if (m === 'g') { const u = byId(T.grammar, sid); const q = u && u.quiz[Number(rest)]; return q && fromQ(q, u.title); }
    if (m === 'r') { const a = byId(T.articles, sid); const q = a && a.questions[Number(rest)]; return q && fromQ(q, a.title); }
    if (m === 'ph') { const p = byId(T.phrases, id); return p && fromQ(p.quiz, p.phrase + ' ' + p.zh); }
    if (m === 'ear') {
      const E = T.ear || {};
      const q = byId(E.dictation, id) || byId(E.pairs, id) || byId(E.numbers, id);
      if (!q) return null;
      return { tag: '', stem: q.question || q.text || q.audioText, options: q.options || null, answer: q.answer, explanation: q.note && q.note !== '無' ? q.note : q.zh };
    }
    return null;
  }

  function loadScript(src) {
    return new Promise((ok, bad) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => ok();
      s.onerror = () => bad(new Error(src));
      document.head.append(s);
    });
  }

  /* ---------- 畫面 ---------- */
  async function mount(root, opts) {
    const o = opts || {};
    const C = window.CLOUD;
    if (!C || typeof C.isOwner !== 'function') return null;
    let owner = false;
    try { owner = await C.isOwner(); } catch (e) { owner = false; }
    if (!owner || (o.alive && !o.alive())) return null;

    const rows = o.rows || [];
    const nameOf = o.nameOf || (uid => String(uid).slice(0, 8));
    let groups;
    try { groups = aggregate(rows, nameOf); } catch (e) {
      const bad = h('section', { class: 'q-block rpa', style: 'margin-top:20px' }, h('p', { class: 'rpa-note', role: 'alert' }, '題目回報載入失敗'));
      root.append(bad);
      return { el: bad, groups: [], redraw() {} };
    }
    const mine = rows.find(r => r && r.user_id === (C.user && C.user.id) && r.k === 'rreview');
    let review = mine && isPlain(mine.v) ? Object.assign({}, mine.v) : {};
    let showClosed = false;
    const load = o.loadScript || loadScript;

    const box = h('section', { class: 'q-block rpa', style: 'margin-top:20px', 'aria-labelledby': 'rpa-h' });
    root.append(box);

    async function saveReview(key, status, statusEl) {
      const gone = typeof C.accountCheck === 'function' ? C.accountCheck() : '';
      if (gone) { statusEl.textContent = gone; return false; }
      const next = Object.assign({}, review);
      if (status) next[key] = { s: status, t: Date.now() }; else delete next[key];
      statusEl.textContent = '儲存中…';
      try {
        const res = await C.client.from('progress').upsert({ user_id: C.user.id, k: 'rreview', v: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id,k' });
        if (res && res.error) throw res.error;
        review = next;
        statusEl.textContent = '';
        return true;
      } catch (e) {
        statusEl.textContent = '儲存失敗：' + (e && e.message ? e.message : '請稍後再試');
        return false;
      }
    }

    function download() {
      const blob = new Blob([toCsv(groups)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url });
      a.download = '題目回報_' + day(Date.now()) + '.csv';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function showQuestion(g, holder, btn) {
      holder.replaceChildren();
      btn.disabled = true;
      let info = null, failed = false;
      try {
        info = describe(g.m, g.id);
        if (!info && DATA_FILE[g.m]) { await load(DATA_FILE[g.m]); info = describe(g.m, g.id); }
      } catch (e) { failed = true; }
      btn.disabled = false;
      if (failed) { holder.append(h('p', { class: 'rpa-note' }, '題目資料載入失敗，請稍後再試。')); return; }
      if (!info) {
        holder.append(h('p', { class: 'rpa-note' }, '這題已淘汰。', ' ', h('a', { href: 'corrections.html?q=' + encodeURIComponent(g.id) }, '看題目更正紀錄')));
        return;
      }
      holder.append(info.tag ? h('div', { class: 'hist-tag' }, info.tag) : null, h('div', { class: 'q-text', style: 'white-space:pre-line' }, info.stem));
      if (info.options) {
        holder.append(h('ol', { class: 'rpa-opts' }, info.options.map((t, i) => h('li', { class: i === info.answer ? 'is-answer' : '' }, LETTERS[i] + '. ' + t + (i === info.answer ? '（正解）' : '')))));
      }
      if (info.explanation) holder.append(h('div', { class: 'explain' }, h('div', null, info.explanation)));
    }

    function item(g) {
      const closed = isClosed(g, review);
      const statusEl = h('span', { class: 'rpa-status', role: 'status' });
      const holder = h('div', { class: 'rpa-q' });
      const types = Array.from(new Set(g.list.map(x => x.c))).map(c => TYPE[c] || c).join('、');
      const head = h('button', { class: 'rpa-head', type: 'button', 'aria-expanded': 'false' },
        h('span', { class: 'rpa-id' }, g.id), h('span', { class: 'badge cat' }, MODULE[g.m] || g.m),
        h('span', { class: 'rpa-count' }, g.count + ' 人'), h('span', { class: 'rpa-types' }, types), h('span', { class: 'rpa-date' }, day(g.lastT)),
        closed ? h('span', { class: 'badge' }, '已處理') : null);
      const who = h('ul', { class: 'rpa-who' }, g.list.map(x => h('li', null,
        h('b', null, x.name), ' · ' + (TYPE[x.c] || x.c) + ' · ' + day(x.t), x.n ? h('div', { class: 'rpa-note-text' }, x.n) : null)));
      const viewBtn = h('button', { class: 'btn', type: 'button' }, '看題目');
      viewBtn.addEventListener('click', () => showQuestion(g, holder, viewBtn));
      const copyBtn = h('button', { class: 'btn', type: 'button' }, '複製題號');
      copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(g.id); copyBtn.textContent = '已複製'; } catch (e) { copyBtn.textContent = '請手動複製'; }
      });
      const markBtn = h('button', { class: 'btn', type: 'button' }, closed ? '改回未處理' : '標為已處理');
      markBtn.addEventListener('click', async () => { if (await saveReview(g.key, closed ? null : 'done', statusEl)) draw(); });
      const body = h('div', { class: 'rpa-body', style: 'display:none' }, who, h('div', { class: 'pop-btns' }, viewBtn, copyBtn, markBtn, statusEl), holder);
      head.addEventListener('click', () => {
        const open = body.style.display === 'none';
        body.style.display = open ? '' : 'none';
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      return h('div', { class: 'rpa-item' + (closed ? ' is-closed' : '') }, head, body);
    }

    function draw() {
      box.replaceChildren();
      const closedN = groups.filter(g => isClosed(g, review)).length;
      const shown = groups.filter(g => showClosed || !isClosed(g, review));
      const tools = h('div', { class: 'pop-btns', style: 'margin:6px 0 10px' });
      if (groups.length) tools.append(h('button', { class: 'btn', type: 'button', onclick: download }, '下載回報（CSV）'));
      if (closedN) tools.append(h('button', { class: 'btn', type: 'button', 'aria-pressed': showClosed ? 'true' : 'false', onclick: () => { showClosed = !showClosed; draw(); } },
        showClosed ? '隱藏已處理（' + closedN + '）' : '顯示已處理（' + closedN + '）'));
      box.append(h('h3', { id: 'rpa-h', style: 'font-size:15.5px;margin-bottom:6px' }, '題目回報（' + groups.filter(g => !isClosed(g, review)).length + ' 題待看）'), tools);
      if (!groups.length) box.append(h('p', { class: 'rpa-note' }, '還沒有學生回報。'));
      else if (!shown.length) box.append(h('p', { class: 'rpa-note' }, '回報都處理完了。'));
      else shown.forEach(g => box.append(item(g)));
    }
    draw();
    return { el: box, groups, redraw: draw };
  }

  window.ADMIN_REPORTS = { mount, aggregate, toCsv, csvCell, describe, isClosed };
})();
