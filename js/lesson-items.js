/* 課程頁的題目畫面(js/lesson-test.js、js/lesson-personal.js、js/lesson.js 用;不讀寫任何紀錄):
   前測作答用的 P1–P7 題目(作答中不對答)、只播一次的播放鈕、逐題解析(P1–P7,每題附回報題目)、
   前測的 Part 答對率清單、「暫用試卷」那一行、說明頁(小檢核、閱讀測驗開始頁)、小檢核判定的清單與圖示。
   unit = { p: '1'–'7', item }:item 是 BANK.get 拿到的那一題(組)。
   小題:sub 是進度裡的寫法(單題 0、題組 1 起算、P6 是空格號);key 是作答紀錄的鍵(P6「組:空格號」、P3、P4、P7「組:第幾題」0 起算),
   兩個都由 LESSON_CORE.itemKeys 算。逐題解析的 answers 用 key 查 { c, ok }(c 是 -1 表示沒作答)。
   載入時不依賴其他檔;LESSON_CORE、UI、REPORT 與 js/common.js 的 passTypeLabel、catLabel 在函式裡才用。 */
(function (root) {
  'use strict';
  const LETTERS = ['A', 'B', 'C', 'D'];
  const NS = 'http://www.w3.org/2000/svg';
  /* 逐題解析的字跟題庫刷題、聽力練習交卷後的解析一樣(引擎原本的字,不放進課程的字串表) */
  const WORD = {
    ok: '答對', bad: '答錯 · 正解 ', blank: '未作答 · 正解 ', script: '逐字稿', tr: '顯示全文翻譯', play: '播放', again: '再播一次',
    noAudio: '找不到音檔', photo: '聽力照片', noPhoto: '照片準備中', man: '男：', woman: '女：', passage: '文章',
  };
  const core = () => root.LESSON_CORE;
  const TX = () => core().TEXT;
  const doc = () => root.document;

  function el(tag, attrs, kids) {
    const n = doc().createElement(tag);
    Object.keys(attrs || {}).forEach((k) => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    [].concat(kids === undefined ? [] : kids).forEach((c) => {
      if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : String(c));
    });
    return n;
  }
  function svgEl(tag, attrs) {
    const d = doc();
    const n = typeof d.createElementNS === 'function' ? d.createElementNS(NS, tag) : d.createElement(tag);
    Object.keys(attrs).forEach((k) => n.setAttribute(k, String(attrs[k])));
    return n;
  }
  const isSingle = (p) => p === '1' || p === '2' || p === '5';
  const subsOf = (u) => core().itemKeys(u.p, u.item, u.item.id);
  const questionOf = (u, qi) => (isSingle(u.p) ? u.item : u.item.questions[qi]);
  const typeLabel = (t) => (typeof root.passTypeLabel === 'function' ? root.passTypeLabel(t) : String(t || ''));
  const catText = (c) => (typeof root.catLabel === 'function' ? root.catLabel(c) : String(c || ''));
  const partBadge = (p, name) => el('div', { class: 'meta lsn-t-meta' }, [el('span', { class: 'badge cat' }, [name || 'Part ' + p])]);

  /* ---------- 作答(不對答) ---------- */
  function photo(id) {
    const img = el('img', { src: 'img/listening/' + id + '.jpg', alt: WORD.photo });
    img.addEventListener('error', () => img.replaceWith(el('div', { class: 'photo-missing' }, [WORD.noPhoto])));
    return el('div', { class: 'listen-photo' }, [img]);
  }
  /* 選了的那顆 aria-pressed=true;已經寫進進度的小題停用 */
  function letters(count, chosen, locked, onPick) {
    return el('div', { class: 'letter-row' }, Array.from({ length: count }, (_, i) => {
      const b = el('button', { class: 'letter-big' + (chosen === i ? ' picked' : ''), type: 'button', 'aria-pressed': chosen === i ? 'true' : 'false', disabled: locked }, [LETTERS[i]]);
      b.addEventListener('click', () => onPick(i));
      return b;
    }));
  }
  function opts(options, chosen, locked, onPick) {
    return el('div', { class: 'opts' }, options.map((text, i) => {
      const b = el('button', { class: 'opt' + (chosen === i ? ' picked' : ''), type: 'button', 'aria-pressed': chosen === i ? 'true' : 'false', disabled: locked },
        [el('span', { class: 'letter' }, [LETTERS[i]]), el('span', null, [text])]);
      b.addEventListener('click', () => onPick(i));
      return b;
    }));
  }
  const qText = (no, text) => el('div', { class: 'q-text' }, [el('span', { class: 'q-no' }, [no]), text || '']);
  /* P6 文章:空格放學生選的(作答中)或正解(解析);沒選的寫「(1) ______」 */
  function p6Passage(set, fill) {
    const box = el('div', { class: 'passage-box' }, [el('span', { class: 'p-label' }, [typeLabel(set.passageType)])]);
    const body = el('div', null);
    String(set.passage).split(/(\{\{\d\}\})/).forEach((seg) => {
      const m = /^\{\{(\d)\}\}$/.exec(seg);
      if (!m) { if (seg) body.append(seg); return; }
      const num = Number(m[1]), text = fill(num);
      body.append(text ? el('span', { class: 'gap-mark filled' }, [text]) : el('span', { class: 'gap-mark' }, ['(' + num + ') ______']));
    });
    box.append(body);
    return box;
  }
  function p7Passage(ps) {
    const slug = String(ps.type || '').toLowerCase().replace(/[^a-z]+/g, '-');
    const label = (ps.label ? ps.label + ' · ' : '') + typeLabel(ps.type);
    return el('div', { class: 'passage-box' + (ps.blocks ? ' ps-' + slug : '') }, [el('span', { class: 'p-label' }, [label]), ps.blocks ? psBlocks(ps.blocks) : el('div', null, [ps.content])]);
  }
  /* 結構化文件(表格、表單、簡訊、傳單),畫法同題庫刷題頁 */
  function psBlocks(blocks) {
    const wrap = el('div', { class: 'ps-blocks' });
    const text = { h: 'ps-h', sub: 'ps-sub', p: 'ps-p', note: 'ps-note' };
    blocks.forEach((b) => {
      if (text[b.t]) wrap.append(el('div', { class: text[b.t] }, [b.text]));
      else if (b.t === 'coupon') wrap.append(el('div', { class: 'ps-coupon' }, (b.lines || [b.text]).map((l, i) => el('div', { class: i ? 'ps-coupon-line' : 'ps-coupon-main' }, [l]))));
      else if (b.t === 'list') wrap.append(el('ul', { class: 'ps-list' }, (b.items || []).map((it) => el('li', null, [it]))));
      else if (b.t === 'kv') wrap.append(el('div', { class: 'ps-kv' }, (b.items || []).map((it) => el('div', { class: 'ps-kv-row' }, [el('span', { class: 'ps-kv-k' }, [it[0]]), el('span', { class: 'ps-kv-v' }, [it[1]])]))));
      else if (b.t === 'table') wrap.append(el('div', { class: 'ps-table-wrap' }, [el('table', { class: 'ps-table' }, (b.rows || []).map((row, ri) => el('tr', null, row.map((c) => el(b.header !== false && ri === 0 ? 'th' : 'td', null, [String(c)])))))]));
      else if (b.t === 'chat') wrap.append(chat(b.msgs || []));
    });
    return wrap;
  }
  function chat(msgs) {
    const sides = {};
    return el('div', { class: 'ps-chat' }, msgs.map((m) => {
      if (!(m.who in sides)) sides[m.who] = Object.keys(sides).length % 2 ? 'right' : '';
      return el('div', { class: 'ps-msg ' + sides[m.who] }, [el('div', { class: 'ps-msg-meta' }, [m.who + (m.time ? ' · ' + m.time : '')]), el('div', { class: 'ps-msg-bubble' }, [m.text])]);
    }));
  }
  /* 題組(P6、P7):文章在左、題目在右(手機上下排),排法同題庫刷題頁 */
  function setLayout(u, passages, questions, graded) {
    /* 作答時文章欄跟著捲(可以捲動的文章區是 Tab 停點,給它名字);解析時整篇放開 */
    const pass = graded ? el('div', { class: 'passage-col' }, passages) : el('div', { class: 'passage-sticky-wrap', role: 'region', 'aria-label': WORD.passage }, passages);
    return el('div', { class: 'set-layout ' + (graded ? 'lsn-review' : 'lsn-t-unit') }, [el('div', null, [pass]), el('div', null, [partBadge(u.p)].concat(questions))]);
  }
  /* 前測的一個畫面(一題或一組)。sel:{ 小題: 選項 }(還沒定案的);opt.locked:{ 小題: 選項 }(已經寫進進度、停用);
     opt.player:播放鈕(聽力);onPick(小題, 選項) */
  function testView(unit, sel, onPick, opt) {
    const o = opt || {}, u = unit, p = String(u.p), locked = o.locked || {}, s = sel || {};
    const chosen = (sub) => (sub in locked ? locked[sub] : sub in s ? s[sub] : null);
    const pick = (sub) => (c) => onPick(sub, c);
    if (p === '6') {
      const qs = subsOf(u).map((k) => el('div', { class: 'q-block' }, [qText('(' + k.sub + ')'), opts(questionOf(u, k.qi).options, chosen(k.sub), k.sub in locked, pick(k.sub))]));
      return setLayout(u, [p6Passage(u.item, (num) => { const k = subsOf(u).filter((x) => x.sub === num)[0], c = k ? chosen(k.sub) : null; return c === null ? '' : questionOf(u, k.qi).options[c]; })], qs);
    }
    if (p === '7') {
      const qs = subsOf(u).map((k) => el('div', { class: 'q-block' }, [qText('Q' + (k.qi + 1), questionOf(u, k.qi).q), opts(questionOf(u, k.qi).options, chosen(k.sub), k.sub in locked, pick(k.sub))]));
      return setLayout(u, (u.item.passages || []).map(p7Passage), qs);
    }
    const block = el('div', { class: 'q-block lsn-t-unit' }, [partBadge(p)]);
    if (p === '1') block.append(photo(u.item.id));
    if (o.player) block.append(o.player);
    if (p === '1' || p === '2') block.append(letters(p === '1' ? 4 : 3, chosen(0), 0 in locked, pick(0)));
    else if (p === '5') block.append(el('div', { class: 'q-text' }, [u.item.question]), opts(u.item.options, chosen(0), 0 in locked, pick(0)));
    else subsOf(u).forEach((k) => block.append(el('div', { class: 'lsn-t-q' }, [qText('Q' + (k.qi + 1), questionOf(u, k.qi).q), opts(questionOf(u, k.qi).options, chosen(k.sub), k.sub in locked, pick(k.sub))])));
    return block;
  }

  /* 只播一次的播放鈕(同模擬考):按下才播(iPhone 要使用者手勢),播過寫「已播放」並停用;音檔載不到寫「找不到音檔」,照樣可以作答。
     ▶ 放在 aria-hidden 裡,讀屏念「播放 · 限一次」。state.played 由呼叫的一方留著(同一題重畫時不會又能播) */
  function oncePlayer(id, state) {
    const s = state || {}, X = TX().test;
    const icon = el('span', { class: 'lsn-play-icon', 'aria-hidden': 'true' }, ['▶']);
    const label = el('span', null);
    const btn = el('button', { class: 'btn player-btn lsn-once', type: 'button' }, [icon, label]);
    let audio = null;
    function paint() {
      const off = !!(s.played || s.failed);
      label.textContent = s.failed ? X.noAudio : s.played ? X.played : X.play;
      btn.disabled = off;
      icon.hidden = off;
    }
    function fail() { s.failed = true; paint(); }
    btn.addEventListener('click', () => {
      if (s.played) return;
      s.played = 1;
      paint();
      try {
        audio = new root.Audio('audio/' + id + '.mp3');
        audio.addEventListener('error', fail);
        const r = audio.play();
        if (r && typeof r.catch === 'function') r.catch(() => { if (audio && audio.error) fail(); });
      } catch (e) { fail(); }
    });
    paint();
    return { el: el('div', { class: 'player' }, [btn]), stop() { if (audio) audio.pause(); } };
  }

  /* ---------- 逐題解析 ---------- */
  /* 解析裡的播放鈕:不限次數,每按一次換新的 Audio 從頭播(同聽力練習的解析) */
  function replayPlayer(id, stops) {
    const label = el('span', null, [WORD.play]);
    const btn = el('button', { class: 'btn player-btn', type: 'button' }, [el('span', { class: 'lsn-play-icon', 'aria-hidden': 'true' }, ['▶']), label]);
    let audio = null;
    btn.addEventListener('click', () => {
      if (audio) audio.pause();
      try {
        audio = new root.Audio('audio/' + id + '.mp3');
        audio.addEventListener('error', () => { label.textContent = WORD.noAudio; btn.disabled = true; });
        const r = audio.play();
        if (r && typeof r.catch === 'function') r.catch(() => {});
        label.textContent = WORD.again;
      } catch (e) { label.textContent = WORD.noAudio; btn.disabled = true; }
    });
    stops.push(() => { if (audio) audio.pause(); });
    return el('div', { class: 'player' }, [btn]);
  }
  const recOf = (answers, key) => {
    const r = answers && typeof answers.get === 'function' ? answers.get(key) : answers ? answers[key] : null;
    return r && Number.isInteger(r.c) ? r : { c: -1, ok: false };
  };
  function verdict(answer, rec) {
    return el('div', { class: 'verdict ' + (rec.ok ? 'ok' : 'bad') }, [rec.ok ? WORD.ok : (rec.c >= 0 ? WORD.bad : WORD.blank) + LETTERS[answer]]);
  }
  /* 解析方塊:對錯、解析、翻譯;底部「回報題目」(report = { m, id, audio }) */
  function explain(q, rec, tr, report) {
    const box = el('div', { class: 'explain' }, [verdict(q.answer, rec), el('div', null, [q.explanation || ''])]);
    if (tr) box.append(el('div', { class: 'tr' }, [tr]));
    if (root.REPORT && typeof root.REPORT.attach === 'function') root.REPORT.attach(box, report);
    return box;
  }
  function graded(options, answer, c) {
    return el('div', { class: 'opts' }, options.map((text, i) => el('button', { class: 'opt ' + (i === answer ? 'correct' : i === c ? 'wrong' : 'plain'), type: 'button', disabled: true },
      [el('span', { class: 'letter' }, [LETTERS[i]]), el('span', null, [text])])));
  }
  function gradedLetters(count, answer, c) {
    return el('div', { class: 'letter-row' }, Array.from({ length: count }, (_, i) => el('button', { class: 'letter-big' + (i === answer ? ' correct' : i === c ? ' wrong' : ''), type: 'button', disabled: true }, [LETTERS[i]])));
  }
  function transcript(en, zh) {
    return el('div', { class: 'transcript-box' }, [el('b', null, [WORD.script]), el('div', { class: 'tr-en' }, [en]), el('div', { class: 'tr-zh' }, [zh || ''])]);
  }
  const optLines = (q) => q.options.map((o, i) => LETTERS[i] + '. ' + o).join('\n');
  function reviewListen(u, answers, stops) {
    const q = u.item, p = u.p, name = core().PART_NAME[p];
    const block = el('div', { class: 'q-block lsn-review' }, [partBadge(p, name)]);
    if (p === '1') block.append(photo(q.id));
    block.append(replayPlayer(q.id, stops));
    if (p === '1' || p === '2') {
      const rec = recOf(answers, q.id);
      block.append(gradedLetters(p === '1' ? 4 : 3, q.answer, rec.c), explain(q, rec, null, { m: 'l' + p, id: q.id, audio: true }),
        transcript((p === '2' ? q.question + '\n' : '') + optLines(q), q.transcriptZh));
      return block;
    }
    subsOf(u).forEach((k) => {
      const one = questionOf(u, k.qi), rec = recOf(answers, k.key);
      block.append(el('div', { class: 'lsn-t-q' }, [qText('Q' + (k.qi + 1), one.q), graded(one.options, one.answer, rec.c), explain(one, rec, null, { m: 'l' + p, id: k.key, audio: true })]));
    });
    const en = p === '3' ? (q.dialogue || []).map((t) => (t.s === 'M' ? WORD.man : WORD.woman) + t.text).join('\n') : q.talk;
    block.append(transcript(en, q.transcriptZh));
    return block;
  }
  /* 全文翻譯:預設收起,按鈕切換(aria-expanded) */
  function translation(u) {
    const set = u.item, list = Array.isArray(set.translation) ? set.translation : [];
    const box = el('div', { class: 'set-translation', hidden: true }, u.p === '6' ? [set.translation || ''] : list.map((t, i) => {
      const lb = set.passages && set.passages[i] && set.passages[i].label;
      return el('div', null, [lb ? el('b', null, ['【' + lb + '】\n']) : null, t, i < list.length - 1 ? '\n\n' : '']);
    }));
    const btn = el('button', { class: 'btn lsn-tr-btn', type: 'button', 'aria-expanded': 'false' }, [WORD.tr]);
    btn.addEventListener('click', () => { box.hidden = !box.hidden; btn.setAttribute('aria-expanded', box.hidden ? 'false' : 'true'); });
    return [btn, box];
  }
  function reviewRead(u, answers) {
    const q = u.item;
    if (u.p === '5') {
      const rec = recOf(answers, q.id);
      return el('div', { class: 'q-block lsn-review' }, [el('div', { class: 'meta lsn-t-meta' }, [el('span', { class: 'badge cat' }, ['Part 5']), q.category ? el('span', { class: 'badge cat' }, [catText(q.category)]) : null]),
        el('div', { class: 'q-text' }, [q.question]), graded(q.options, q.answer, rec.c), explain(q, rec, q.translation, { m: 'p5', id: q.id })]);
    }
    const passages = u.p === '6' ? [p6Passage(q, (num) => { const one = (q.questions || []).filter((x) => x.num === num)[0]; return one ? one.options[one.answer] : ''; })] : (q.passages || []).map(p7Passage);
    const qs = subsOf(u).map((k) => {
      const one = questionOf(u, k.qi), rec = recOf(answers, k.key);
      return el('div', { class: 'q-block' }, [qText(u.p === '6' ? '(' + k.sub + ')' : 'Q' + (k.qi + 1), u.p === '6' ? '' : one.q), graded(one.options, one.answer, rec.c), explain(one, rec, null, { m: 'p' + u.p, id: k.key })]);
    });
    return setLayout(u, passages.concat(translation(u)), qs, true);
  }
  /* 逐題解析:units 照出題順序;回傳節點陣列,陣列的 stop() 停掉裡面正在播的音檔(收合解析、離開畫面時呼叫) */
  function review(units, answers) {
    const stops = [];
    const nodes = (units || []).filter((u) => u && u.item).map((u) => (Number(u.p) <= 4 ? reviewListen(u, answers, stops) : reviewRead(u, answers)));
    nodes.stop = () => stops.forEach((f) => f());
    return nodes;
  }
  /* 進度的作答列 [區塊, id, 小題, 選項, r, dt] → 逐題解析用的 { key: { c, ok } } */
  function answersOf(units, rows) {
    const by = new Map((rows || []).map((x) => [x[1] + '|' + (x[2] || 0), x]));
    const out = new Map();
    (units || []).forEach((u) => subsOf(u).forEach((k) => {
      const x = by.get(u.item.id + '|' + k.sub);
      if (x) out.set(k.key, { c: Number.isInteger(x[3]) ? x[3] : -1, ok: (x[4] & 1) === 1 });
    }));
    return out;
  }

  /* ---------- 結果頁的清單 ---------- */
  /* 前測各 Part 答對率:聽力、閱讀兩個清單(li 純文字,不連結);n 是 0 的 Part 寫「—」 */
  function parts(p) {
    const P = TX().pretest, data = p || {};
    const pct = (x) => (x && x.n > 0 ? P.pct(Math.round(x.ok / x.n * 100)) : P.none);
    const sec = (title, list) => el('section', { class: 'lsn-parts-sec' }, [el('h2', { class: 'me-sec-h' }, [title]),
      el('ul', { class: 'me-list lsn-parts' }, list.map((n) => el('li', { class: 'me-row lsn-row' }, [el('span', null, [P.part[n]]), el('span', { class: 'me-row-val' }, [pct(data['P' + n])])])))]);
    return el('div', { class: 'lsn-parts-wrap' }, [sec(P.listening, [1, 2, 3, 4]), sec(P.reading, [5, 6, 7])]);
  }
  /* 「暫用試卷」標籤加一行說明 */
  function tagLine(tag, note) {
    return el('p', { class: 'mock-tags lsn-tag-line' }, [el('span', { class: 'mock-tag' }, [tag]), el('span', { class: 'lsn-tag-note' }, [note])]);
  }
  /* 判定的圖示:線條 SVG(同 js/ui.js 的 icon),勾、橫線、實心小圓點 */
  function verdictIcon(v) {
    const kind = (core().VERDICT[v] || {}).icon || 'dot';
    const svg = svgEl('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'lsn-v-icon' });
    if (kind === 'dot') svg.append(svgEl('circle', { cx: 12, cy: 12, r: 4.5, fill: 'currentColor', stroke: 'none' }));
    else svg.append(svgEl('path', { d: kind === 'check' ? 'm5 12.5 4.5 4.5L19 7.5' : 'M6 12h12' }));
    return svg;
  }
  /* 小檢核清單:list = [{ name, verdict: 'met'|'hold'|'weak' }],一個考點一列,右邊一個標籤(圖示加字);不放任何數字 */
  function verdicts(list) {
    return el('ul', { class: 'me-list lsn-verdicts' }, (list || []).map((x) => {
      const v = core().VERDICT[x.verdict];
      return el('li', { class: 'me-row lsn-row' }, [el('span', { class: 'lsn-v-name' }, [x.name]), el('span', { class: 'lsn-v-tag is-' + x.verdict }, [verdictIcon(x.verdict), v ? v.text : ''])]);
    }));
  }

  /* ---------- 說明頁(小檢核、閱讀測驗開始頁) ----------
   opt = { back: { label, href, onClick }, title, tags: [字], rule(一行說明), start(按鈕字), onStart(按鈕) };回 { el, heading } */
  function intro(opt) {
    const o = opt || {};
    const heading = el('h2', { class: 'lsn-h2', tabindex: '-1' }, [o.title]);
    const go = el('button', { class: 'btn primary lsn-go', type: 'button' }, [o.start]);
    go.addEventListener('click', () => { if (typeof o.onStart === 'function') o.onStart(go); });
    let back = null;
    if (o.back) {
      back = el('a', { class: 'lsn-back', href: o.back.href }, [o.back.label]);
      back.addEventListener('click', (e) => { if (typeof o.back.onClick === 'function') { e.preventDefault(); o.back.onClick(); } });
    }
    const tags = (o.tags || []).filter(Boolean);
    const box = el('div', { class: 'lsn-narrow lsn-intro' }, [back, heading, tags.length ? el('p', { class: 'mock-tags' }, tags.map((t) => el('span', { class: 'mock-tag' }, [t]))) : null,
      o.rule ? el('p', { class: 'lsn-rule' }, [o.rule]) : null, go]);
    return { el: box, heading, go };
  }

  root.LESSON_ITEMS = Object.freeze({ LETTERS, testView, oncePlayer, review, answersOf, parts, tagLine, verdictIcon, verdicts, intro, subsOf });
})(typeof globalThis !== 'undefined' ? globalThis : this);
