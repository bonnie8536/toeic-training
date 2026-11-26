/* 程度檢測頁(placement.html)的畫面:開始頁、兩科中間、作答中的一題或一組、只播一次的播放鈕、看作答。
   window.PLACEMENT_VIEWS。只畫畫面,不讀寫任何儲存;流程在 js/placement.js。畫面上的字都在 STR。
   題目的長相沿用課程前測與題庫刷題(.q-block、.opts、.letter-row、.passage-box、.set-layout、.player),樣式在 css/style.css 與 css/placement.css。
   unit = { id, part: '1'–'7', item(題庫的那一題或一組), keys(每一小題的 key) };sel = { 小題位置: 選項 }。
   對外的函式:
   · STR
   · intro(o) → 節點:開始頁。o = { sec: 'LR' | 'L' | 'R', onboard, note, onStart(), onReadFirst(), onSkip() }
   · between(done, o) → 節點:一科做完、接著做另一科。done 是做完的科;o = { onGo(), onLater() }
   · unitView(unit, sel, onPick(qi, c), o) → 節點:一題或一組。o = { player(節點), phase: 'listen' | 'answer' }
     聽力題組(P3、P4)在 listen 時只有播放鈕,播完(answer)三題一起出。
   · player(src, hooks) → { el, start(), stop(), state() }:只播一次的播放鈕。播放出錯、還沒播完就停住:出現「重新播放」一次;
     再出錯呼叫 hooks.onDead()。hooks = { onStart(), onEnd(), onDead(), stallMs }
   · countText(sec, from, to, total) → 「聽力 · 3／12」「聽力 · 7–9／12」
   · review(units, answers) → 節點陣列:看作答(每題對錯、正解與解析)。answers = { key: 選項 } */
(function (root) {
  'use strict';
  const LETTERS = ['A', 'B', 'C', 'D'];
  const SEC = Object.freeze({ L: '聽力', R: '閱讀' });
  const STR = Object.freeze({
    title: '程度檢測',
    tag: Object.freeze({ L: '聽力 12 題', R: '閱讀 12 題', time: '約 15–20 分鐘' }),
    rules: Object.freeze({ L: Object.freeze(['戴上耳機。', '每段音檔只播一次。']), all: Object.freeze(['選好答案後按「下一題」。', '不能回上一題。']) }),
    start: '開始',
    readFirst: '沒有耳機，先做閱讀',
    skipEntry: '先跳過，從入門開始',
    next: '下一題',
    finish: '完成',
    play: '播放',
    played: '已播放',
    replay: '重新播放',
    photo: '聽力照片',
    noPhoto: '照片準備中',
    leave: Object.freeze({ title: '離開檢測？', body: '下次從這一題接著做。', ok: '離開', cancel: '繼續作答' }),
    done: Object.freeze({ L: '聽力完成', R: '閱讀完成' }),
    then: Object.freeze({ L: Object.freeze(['接著做閱讀 12 題。']), R: Object.freeze(['接著做聽力 12 題。', '戴上耳機。']) }),
    go: Object.freeze({ L: '開始閱讀', R: '開始聽力' }),
    later: '之後再做',
    sec: SEC,
    review: '看作答',
    nextStep: '下一步',
    practice: '開始練習',
    levels: '改程度',
    applyLevel: '改成這個程度',
    retestLink: '重新檢測',
    offline: '連上網路才能做聽力。',
    saveFail: '沒有存到，重新整理後再試一次。',
    loading: '載入中…',
    none: '還沒有檢測結果',
    ok: '答對',
    bad: '答錯 · 正解 ',
    you: '你選 ',
    count: (sec, a, b, total) => SEC[sec] + ' · ' + (a === b ? a : a + '–' + b) + '／' + total,
  });
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
      if (c !== null && c !== undefined && c !== false && c !== '') n.append(c.nodeType ? c : String(c));
    });
    return n;
  }
  function on(node, fn) { node.addEventListener('click', fn); return node; }
  const textBtn = (label, fn) => on(el('button', { class: 'btn-text', type: 'button' }, [label]), fn);
  const isSingle = (p) => p === '1' || p === '2' || p === '5';
  const questionOf = (u, qi) => (isSingle(u.part) ? u.item : u.item.questions[qi]);
  const typeLabel = (t) => (typeof root.passTypeLabel === 'function' ? root.passTypeLabel(t) : String(t || ''));

  /* ---------- 開始頁、兩科中間 ---------- */
  function intro(o) {
    const sec = o.sec || 'LR';
    const hasL = sec.indexOf('L') > -1, hasR = sec.indexOf('R') > -1;
    const tags = [hasL ? STR.tag.L : null, hasR ? STR.tag.R : null, sec === 'LR' ? STR.tag.time : null].filter(Boolean);
    const rules = (hasL ? STR.rules.L : []).concat(STR.rules.all);   // 一行只講一件事
    const more = [sec === 'LR' ? textBtn(STR.readFirst, () => o.onReadFirst()) : null, o.onboard ? textBtn(STR.skipEntry, () => o.onSkip()) : null].filter(Boolean);
    return el('div', { class: 'diag-intro pl-intro' }, [
      el('p', { class: 'mock-tags' }, tags.map((t) => el('span', { class: 'mock-tag' }, [t]))),
    ].concat(rules.map((r) => el('p', { class: 'pl-rule' }, [r])), [
      on(el('button', { class: 'btn primary pl-go', type: 'button', 'data-gate': '' }, [STR.start]), () => o.onStart()),
      more.length ? el('div', { class: 'pl-more' }, more) : null,
      el('p', { class: 'pl-note', role: 'status' }, [o.note || '']),
    ]));
  }
  function between(done, o) {
    return el('div', { class: 'diag-intro pl-intro pl-between' }, [
      el('h2', { class: 'pl-h2', tabindex: '-1' }, [STR.done[done]]),
    ].concat(STR.then[done].map((t) => el('p', { class: 'pl-rule' }, [t])), [
      on(el('button', { class: 'btn primary pl-go', type: 'button', 'data-gate': '' }, [STR.go[done]]), () => o.onGo()),
      el('div', { class: 'pl-more' }, [textBtn(STR.later, () => o.onLater())]),
      el('p', { class: 'pl-note', role: 'status' }, [o.note || '']),
    ]));
  }

  /* ---------- 題目 ---------- */
  function photo(id) {
    const img = el('img', { src: 'img/listening/' + id + '.jpg', alt: STR.photo });
    img.addEventListener('error', () => img.replaceWith(el('div', { class: 'photo-missing' }, [STR.noPhoto])));
    return el('div', { class: 'listen-photo' }, [img]);
  }
  function pressBtn(cls, chosen, kids, fn) {
    return on(el('button', { class: cls + (chosen ? ' picked' : ''), type: 'button', 'aria-pressed': chosen ? 'true' : 'false', 'data-gate': '' }, kids), fn);
  }
  function letters(count, chosen, pick) {
    return el('div', { class: 'letter-row' }, Array.from({ length: count }, (_, i) => pressBtn('letter-big', chosen === i, [LETTERS[i]], () => pick(i))));
  }
  function opts(options, chosen, pick) {
    return el('div', { class: 'opts' }, options.map((text, i) => pressBtn('opt', chosen === i, [el('span', { class: 'letter' }, [LETTERS[i]]), el('span', null, [text])], () => pick(i))));
  }
  const qText = (no, text) => el('div', { class: 'q-text' }, [el('span', { class: 'q-no' }, [no]), text || '']);
  const badge = (p) => el('div', { class: 'meta pl-meta' }, [el('span', { class: 'badge cat' }, ['Part ' + p])]);
  function p6Passage(set, fill) {
    const body = el('div', null);
    String(set.passage).split(/(\{\{\d\}\})/).forEach((seg) => {
      const m = /^\{\{(\d)\}\}$/.exec(seg);
      if (!m) { if (seg) body.append(seg); return; }
      const text = fill(Number(m[1]));
      body.append(text ? el('span', { class: 'gap-mark filled' }, [text]) : el('span', { class: 'gap-mark' }, ['(' + m[1] + ') ______']));
    });
    return el('div', { class: 'passage-box' }, [el('span', { class: 'p-label' }, [typeLabel(set.passageType)]), body]);
  }
  function chat(msgs) {
    const sides = {};
    return el('div', { class: 'ps-chat' }, msgs.map((m) => {
      if (!(m.who in sides)) sides[m.who] = Object.keys(sides).length % 2 ? 'right' : '';
      return el('div', { class: 'ps-msg ' + sides[m.who] }, [el('div', { class: 'ps-msg-meta' }, [m.who + (m.time ? ' · ' + m.time : '')]), el('div', { class: 'ps-msg-bubble' }, [m.text])]);
    }));
  }
  /* 結構化文件(表格、表單、簡訊、傳單),畫法同題庫刷題頁 */
  function psBlock(b) {
    const text = { h: 'ps-h', sub: 'ps-sub', p: 'ps-p', note: 'ps-note' };
    if (text[b.t]) return el('div', { class: text[b.t] }, [b.text]);
    if (b.t === 'coupon') return el('div', { class: 'ps-coupon' }, (b.lines || [b.text]).map((l, i) => el('div', { class: i ? 'ps-coupon-line' : 'ps-coupon-main' }, [l])));
    if (b.t === 'list') return el('ul', { class: 'ps-list' }, (b.items || []).map((it) => el('li', null, [it])));
    if (b.t === 'kv') return el('div', { class: 'ps-kv' }, (b.items || []).map((it) => el('div', { class: 'ps-kv-row' }, [el('span', { class: 'ps-kv-k' }, [it[0]]), el('span', { class: 'ps-kv-v' }, [it[1]])])));
    if (b.t === 'table') return el('div', { class: 'ps-table-wrap' }, [el('table', { class: 'ps-table' }, (b.rows || []).map((row, ri) => el('tr', null, row.map((c) => el(b.header !== false && ri === 0 ? 'th' : 'td', null, [String(c)])))))]);
    return b.t === 'chat' ? chat(b.msgs || []) : null;
  }
  function p7Passage(ps) {
    const slug = String(ps.type || '').toLowerCase().replace(/[^a-z]+/g, '-');
    const label = (ps.label ? ps.label + ' · ' : '') + typeLabel(ps.type);
    const body = ps.blocks ? el('div', { class: 'ps-blocks' }, ps.blocks.map(psBlock)) : el('div', null, [ps.content]);
    return el('div', { class: 'passage-box' + (ps.blocks ? ' ps-' + slug : '') }, [el('span', { class: 'p-label' }, [label]), body]);
  }
  /* 題組(P6、P7):文章在左、題目在右(手機上下排);作答時文章欄跟著捲 */
  function setLayout(u, passages, questions, graded) {
    const pass = graded ? el('div', { class: 'passage-col' }, passages) : el('div', { class: 'passage-sticky-wrap', role: 'region', 'aria-label': '文章' }, passages);
    return el('div', { class: 'set-layout pl-unit' }, [el('div', null, [pass]), el('div', null, [badge(u.part)].concat(questions))]);
  }
  function unitView(unit, sel, onPick, o) {
    const u = unit, p = u.part, s = sel || {}, opt = o || {};
    const chosen = (qi) => (qi in s ? s[qi] : null);
    const pick = (qi) => (c) => onPick(qi, c);
    if (p === '6') {
      const nums = u.item.questions.map((q) => q.num);
      const qs = u.item.questions.map((q, qi) => el('div', { class: 'q-block' }, [qText('(' + q.num + ')'), opts(q.options, chosen(qi), pick(qi))]));
      return setLayout(u, [p6Passage(u.item, (num) => { const qi = nums.indexOf(num), c = chosen(qi); return qi < 0 || c === null ? '' : u.item.questions[qi].options[c]; })], qs);
    }
    if (p === '7') {
      const qs = u.item.questions.map((q, qi) => el('div', { class: 'q-block' }, [qText('Q' + (qi + 1), q.q), opts(q.options, chosen(qi), pick(qi))]));
      return setLayout(u, (u.item.passages || []).map(p7Passage), qs);
    }
    const block = el('div', { class: 'q-block pl-unit' }, [badge(p)]);
    if (p === '1') block.append(photo(u.item.id));
    if (opt.player) block.append(opt.player);
    if (p === '1' || p === '2') block.append(letters(p === '1' ? 4 : 3, chosen(0), pick(0)));
    else if (p === '5') block.append(el('div', { class: 'q-text' }, [u.item.question]), opts(u.item.options, chosen(0), pick(0)));
    else if (opt.phase === 'answer') u.item.questions.forEach((q, qi) => block.append(el('div', { class: 'pl-q' }, [qText('Q' + (qi + 1), q.q), opts(q.options, chosen(qi), pick(qi))])));
    return block;
  }

  /* ---------- 只播一次的播放鈕 ----------
     按下才播(手機要使用者點擊)。播完停用、旁邊寫「已播放」。出錯(載不到、play 被拒)、還沒播完就停住(暫停、播到一半結束、
     stallMs 毫秒沒有前進):停掉、出現「重新播放」(一次,不算次數);再出錯呼叫 onDead(換題)。每次都換新的 Audio 從頭播 */
  function player(src, hooks) {
    const hk = hooks || {};
    const stallMs = hk.stallMs || 10000;
    const label = el('span', null, [STR.play]);
    const btn = el('button', { class: 'btn player-btn pl-play', type: 'button' }, [el('span', { class: 'pl-play-icon', 'aria-hidden': 'true' }, ['▶']), label]);
    const note = el('span', { class: 'player-note pl-played' });
    let state = 'idle', fails = 0, audio = null, timer = null, last = -1, seen = 0;
    function paint() {
      label.textContent = state === 'retry' ? STR.replay : STR.play;
      btn.disabled = !(state === 'idle' || state === 'retry');
      note.textContent = state === 'done' ? STR.played : '';
      btn.classList.toggle('is-done', state === 'done');
    }
    function clear() { if (timer) { root.clearTimeout(timer); timer = null; } }
    function halt() {
      clear();
      const a = audio;
      audio = null;
      if (a) { try { a.pause(); } catch (e) { /* 已經停了 */ } }
    }
    function fail() {
      if (state !== 'playing') return;
      halt();
      fails++;
      state = fails >= 2 ? 'dead' : 'retry';
      paint();
      if (state === 'dead' && typeof hk.onDead === 'function') hk.onDead();
    }
    function watch() {
      clear();
      timer = root.setTimeout(() => {
        if (state !== 'playing' || !audio) return;
        const t = Number(audio.currentTime) || 0;
        if (t > last) { last = t; seen = Date.now(); watch(); return; }
        if (Date.now() - seen >= stallMs) fail(); else watch();
      }, 1000);
    }
    function ended(a) {
      if (a !== audio || state !== 'playing') return;
      const d = Number(a.duration);
      if (isFinite(d) && d > 0 && (Number(a.currentTime) || 0) < d - 1) { fail(); return; }
      halt();
      state = 'done';
      paint();
      if (typeof hk.onEnd === 'function') hk.onEnd();
    }
    function start() {
      if (!(state === 'idle' || state === 'retry')) return;
      state = 'playing';
      last = -1; seen = Date.now();
      paint();
      if (typeof hk.onStart === 'function') hk.onStart();
      try {
        const a = new root.Audio(src);
        audio = a;
        a.addEventListener('error', () => { if (a === audio) fail(); });
        a.addEventListener('ended', () => ended(a));
        a.addEventListener('pause', () => { if (a === audio && !a.ended) fail(); });
        const r = a.play();
        if (r && typeof r.catch === 'function') r.catch(() => { if (a === audio) fail(); });
        watch();
      } catch (e) { fail(); }
    }
    on(btn, start);
    paint();
    return { el: el('div', { class: 'player pl-player' }, [btn, note]), start, stop: () => { halt(); }, state: () => state };
  }

  function countText(sec, from, to, total) { return STR.count(sec, from, to, total); }

  /* ---------- 看作答 ---------- */
  function markOpts(options, answer, chosen) {
    return el('div', { class: 'opts' }, options.map((text, i) => {
      const cls = i === answer ? ' correct' : i === chosen ? ' wrong' : ' plain';
      return el('button', { class: 'opt' + cls, type: 'button', disabled: true }, [el('span', { class: 'letter' }, [LETTERS[i]]), el('span', null, [text])]);
    }));
  }
  function explain(q, chosen) {
    const ok = chosen === q.answer;
    return el('div', { class: 'explain' }, [
      el('div', { class: 'verdict ' + (ok ? 'ok' : 'bad') }, [ok ? STR.ok : STR.bad + LETTERS[q.answer]]),
      el('div', null, [q.explanation || '']),
    ]);
  }
  function reviewQ(u, qi, answers, head) {
    const q = questionOf(u, qi), c = answers[u.keys[qi]];
    const stem = u.part === '5' ? q.question : u.part === '2' ? q.question : isSingle(u.part) ? '' : q.q;
    return el('div', { class: 'q-block pl-review-q' }, [head ? qText(head, stem) : stem ? el('div', { class: 'q-text' }, [stem]) : null, markOpts(q.options, q.answer, c), explain(q, c)]);
  }
  function review(units, answers) {
    const a = answers || {};
    return units.map((u) => {
      if (u.part === '6') {
        const qs = u.item.questions.map((q, qi) => reviewQ(u, qi, a, '(' + q.num + ')'));
        return setLayout(u, [p6Passage(u.item, () => '')], qs, true);
      }
      if (u.part === '7') return setLayout(u, (u.item.passages || []).map(p7Passage), u.item.questions.map((q, qi) => reviewQ(u, qi, a, 'Q' + (qi + 1))), true);
      const box = el('div', { class: 'pl-review-unit' }, [badge(u.part)]);
      if (u.part === '1') box.append(photo(u.item.id));
      u.keys.forEach((k, qi) => box.append(reviewQ(u, qi, a, isSingle(u.part) ? null : 'Q' + (qi + 1))));
      return box;
    });
  }

  root.PLACEMENT_VIEWS = Object.freeze({ STR, LETTERS, intro, between, unitView, player, countText, review });
})(typeof window !== 'undefined' ? window : globalThis);
