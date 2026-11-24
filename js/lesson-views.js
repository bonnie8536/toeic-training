/* 上課頁(lesson.html)的畫面:段落總覽、技巧卡、字卡、單字題、過場、區塊結果、文法單元的結果、通知列、空狀態。
   只畫、不寫任何資料;流程與寫入在 js/lesson.js。字一律從 LESSON_CORE.TEXT 拿,題目與卡片內容一律用文字節點放。
   每個畫面回一個元素;換畫面後要搶焦點的標題標 data-lsn-focus(帶 tabindex=-1),show(host, el, true) 放進去並把焦點移過去。
   有 destroy() 的元素(帶結算卡、空狀態的鵜鶘)在換掉之前呼叫一次。
   js/lesson-personal.js 的前測檢討也用 tip(card, on)。 */
(function (root) {
  'use strict';
  const doc = root.document;
  const TX = () => root.LESSON_CORE.TEXT;
  const FOCUS = 'data-lsn-focus';

  /* ---------- 小工具 ---------- */
  function el(tag, attrs, kids) {
    const n = doc.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    [].concat(kids || []).flat().forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      n.append(c.nodeType ? c : doc.createTextNode(String(c)));
    });
    return n;
  }
  const on = (n, fn) => { if (typeof fn === 'function') n.addEventListener('click', fn); return n; };
  function button(label, fn, cls, gate) {
    return on(el('button', { class: cls || 'btn', type: 'button', 'data-gate': gate ? '' : null }, [label]), fn);
  }
  const primary = (label, fn) => button(label, fn, 'btn primary lsn-go', true);
  const heading = (tag, cls, text) => el(tag, { class: cls, tabindex: '-1', [FOCUS]: '' }, [text]);
  const tags = (list) => el('p', { class: 'mock-tags' }, list.filter(Boolean).map((t) => el('span', { class: 'mock-tag' }, [t])));
  /* 「← 回課程」「← 回第 3 堂」:有 onClick 時不換頁(上課頁裡回段落總覽) */
  function back(label, href, onClick) {
    const a = el('a', { class: 'lsn-back', href: href || 'lessons.html' }, [label]);
    if (typeof onClick === 'function') a.addEventListener('click', (e) => { e.preventDefault(); onClick(e); });
    return a;
  }

  /* 放進 host;focus 為 true 時焦點移到 data-lsn-focus(沒有就不動)。回放進去的元素 */
  function show(host, node, focus) {
    if (!host) return node;
    Array.from(host.children || []).forEach((c) => { if (typeof c.destroy === 'function') { try { c.destroy(); } catch (e) { /* 圖已經收了 */ } } });
    host.replaceChildren(node);
    if (focus) focusIn(node);
    return node;
  }
  function focusIn(node) {
    const t = node && (node.hasAttribute && node.hasAttribute(FOCUS) ? node : node.querySelector && node.querySelector('[' + FOCUS + ']'));
    if (t && typeof t.focus === 'function') { try { t.focus({ preventScroll: false }); } catch (e) { /* 焦點移不過去就算了 */ } }
    return t || null;
  }

  /* ---------- 段落總覽 ----------
     model = { steps: [{ slot, name, st, time }], label, skip(段名,目前那段可以略過才有), rules: [字] }
     on = { go(e), skip(e) }。h1、小字、返回連結、通知在 lesson.js 的頁首 */
  function stepRow(s) {
    const L = TX().lesson;
    const word = s.st === 'done' ? L.done : s.st === 'skip' ? L.skip : '';
    return el('li', { class: 'lsn-step is-' + s.st, 'aria-current': s.st === 'current' ? 'step' : null }, [
      el('span', { class: 'lsn-step-mark', 'aria-hidden': 'true' }),
      el('span', { class: 'lsn-step-name' }, [s.name]),
      el('span', { class: 'lsn-step-min' }, [s.time || '']),
      word ? el('span', { class: 'lsn-step-st' }, [word]) : null,
      s.st === 'current' ? el('span', { class: 'daily-sr' }, [L.current]) : null,
    ]);
  }
  function overview(model, handlers) {
    const h = handlers || {};
    const acts = el('div', { class: 'lsn-acts' }, [
      primary(model.label, h.go),
      model.skip ? button(TX().lesson.skipSeg, h.skip, 'btn-text lsn-skip') : null,
    ]);
    return el('div', { class: 'lsn-overview lsn-narrow' }, [
      el('ol', { class: 'lsn-steps', 'aria-label': TX().lesson.steps }, model.steps.map(stepRow)),
      (model.rules || []).map((r) => el('p', { class: 'lsn-rule' }, [r])),
      acts,
    ]);
  }

  /* ---------- 技巧卡 ----------
     card:window.TIP_CARDS 的一張(或卡片 id);on = { no, back(e), next(e) }。示例的標法照 tools/tips_build.py 檔頭 */
  const OPT_AT = /\s(?=\([B-D]\)\s)/;
  const isOpt = (s) => /^\([A-D]\)\s/.test(s);
  function cardOf(card) {
    if (card && typeof card === 'object') return card;
    const list = root.TIP_CARDS && Array.isArray(root.TIP_CARDS.cards) ? root.TIP_CARDS.cards : [];
    return list.filter((c) => c.id === card)[0] || null;
  }
  /* 一行英文:同一行有好幾個選項就一個選項一格,其他一行一塊((A) 開頭的懸掛縮排) */
  function exLine(s) {
    const opts = isOpt(s) ? s.split(OPT_AT) : [s];
    if (opts.length > 1) return el('div', { class: 'lsn-ex-opts' }, opts.map((o) => el('span', { class: 'lsn-ex-opt' }, [o])));
    return el('p', { class: 'lsn-ex-line' + (isOpt(s) ? ' is-opt' : '') }, [s]);
  }
  /* 英文切成區段 [{ tag, lines }]:P1、P2 全部是播出;P3、P4 從 Question: 那一行起是題本;P5–P7 全部是題本 */
  function exSections(part, lines) {
    const t = TX().tip;
    if (part === 'P1' || part === 'P2') return [{ tag: t.play, lines }];
    if (part === 'P3' || part === 'P4') {
      const q = lines.findIndex((s) => /^Question:/.test(s));
      return q < 0 ? [{ tag: t.play, lines }] : [{ tag: t.play, lines: lines.slice(0, q) }, { tag: t.book, lines: lines.slice(q) }].filter((x) => x.lines.length);
    }
    return [{ tag: t.book, lines }];
  }
  function section(tag, body) {
    return el('div', { class: 'lsn-ex-sec' }, [el('span', { class: 'mock-tag lsn-ex-tag' }, [tag])].concat(body));
  }
  function example(card) {
    const ex = card.example || {};
    const lines = String(ex.en || '').split('\n').filter((s) => s.trim());
    const zh = String(ex.zh || '');
    const out = [el('p', { class: 'lsn-ex-h' }, [TX().tip.example])];
    let rest = zh;
    if (card.part === 'P1') {
      const cut = zh.indexOf('。');
      const photo = cut < 0 ? zh : zh.slice(0, cut + 1);
      rest = cut < 0 ? '' : zh.slice(cut + 1);
      if (photo) out.push(section(TX().tip.photo, [el('p', { class: 'lsn-ex-photo' }, [photo])]));
    }
    exSections(card.part, lines).forEach((s) => out.push(section(s.tag, s.lines.map(exLine))));
    if (rest) out.push(el('p', { class: 'lsn-ex-zh' }, [rest]));
    return el('div', { class: 'lsn-ex' }, out);
  }
  function tip(card, handlers) {
    const c = cardOf(card);
    const h = handlers || {};
    if (!c) return null;
    const head = h.no ? back(TX().lesson.backTo(h.no), 'lesson.html?no=' + h.no, h.back) : null;
    return el('section', { class: 'lsn-tip lsn-screen' }, [
      head,
      heading('h2', 'lsn-tip-h', c.title),
      el('p', { class: 'lsn-tip-body' }, [c.body]),
      c.example ? example(c) : null,
      el('div', { class: 'lsn-acts' }, [primary(TX().tip.next, h.next)]),
    ]);
  }

  /* ---------- 單字 ----------
     words(list, on):字卡,list = [{ en, pos, zh }](不規則動詞的 en 是三態);on.start 有給時放「開始小考」(專心模式時 lesson.js 把按鈕放進底部列)。
     wordQuiz(q, on):q = { word, pos, options, picked, answer };picked 有值時選項上色、停用;on.pick(i, e) */
  function words(list, handlers) {
    const t = TX().words;
    const h = handlers || {};
    return el('section', { class: 'lsn-words-wrap lsn-screen' }, [
      heading('h2', 'lsn-words-h', t.h),
      tags([t.count(list.length)]),
      el('ul', { class: 'lsn-words' }, list.map((w) => el('li', { class: 'lsn-word' }, [
        el('span', { class: 'lsn-w-en' }, [w.en]),
        w.pos ? el('span', { class: 'badge cat lsn-w-pos' }, [w.pos]) : null,
        el('span', { class: 'lsn-w-zh' }, [w.zh]),
      ]))),
      typeof h.start === 'function' ? el('div', { class: 'lsn-acts' }, [primary(t.start, h.start)]) : null,
    ]);
  }
  function optCls(q, i) {
    if (q.picked === null || q.picked === undefined) return 'opt';
    return 'opt ' + (i === q.answer ? 'correct' : i === q.picked ? 'wrong' : 'plain');
  }
  function wordQuiz(q, handlers) {
    const h = handlers || {};
    const done = q.picked !== null && q.picked !== undefined;
    const opts = el('div', { class: 'opts' }, q.options.map((o, i) => {
      const b = el('button', { class: optCls(q, i), type: 'button', 'data-gate': '' }, [el('span', { class: 'letter' }, ['ABCD'.charAt(i)]), el('span', null, [o])]);
      if (done) b.disabled = true;
      else on(b, (e) => { if (typeof h.pick === 'function') h.pick(i, e); });
      return b;
    }));
    return el('div', { class: 'q-block lsn-wq' }, [
      el('p', { class: 'q-text lsn-word-q' }, [q.word]),
      q.pos ? tags([q.pos]) : null,
      opts,
    ]);
  }

  /* ---------- 過場(交卷回合之前) ----------
     round = { parts: ['2', '1'], count };on = { start(e), no(堂號), back(e) }:有 no 時卡片上方放「← 回第 n 堂」(同說明頁、技巧卡) */
  function bridge(round, handlers) {
    const t = TX().bridge;
    const h = handlers || {};
    const card = el('section', { class: 'lsn-card lsn-bridge lsn-narrow' }, [
      heading('h2', 'lsn-card-h', t.parts(round.parts)),
      tags([t.count(round.count)]),
      el('p', { class: 'lsn-line' }, [t.note]),
      el('div', { class: 'lsn-acts' }, [primary(t.start, h.start)]),
    ]);
    if (!h.no) return card;
    return el('div', { class: 'lsn-bridge-wrap lsn-narrow' }, [back(TX().lesson.backTo(h.no), 'lesson.html?no=' + h.no, h.back), card]);
  }

  /* ---------- 區塊結果(交卷回合之後) ----------
     r = { parts, score, total, units, answers, wrong };on.next(e)。逐題解析由 js/lesson-items.js 畫(沒載到就只有結算卡) */
  function reviewNodes(r) {
    const I = root.LESSON_ITEMS;
    if (!I || typeof I.review !== 'function') { console.error('沒有載入 LESSON_ITEMS.review，區塊結果不放逐題解析'); return null; }
    return I.review(r.units, r.answers);
  }
  function blockResult(r, handlers) {
    const h = handlers || {};
    const card = root.UI.result({ inline: true, kicker: TX().block.parts(r.parts), score: r.score, total: r.total, primary: { label: TX().block.next, onClick: h.next } });
    card.heading.setAttribute(FOCUS, '');
    const nodes = reviewNodes(r);
    const box = el('div', { class: 'lsn-block-result lsn-screen' }, [
      card.el,
      nodes ? el('div', { class: 'lsn-narrow lsn-detail' }, [root.UI.detail(TX().block.review(r.total), nodes, { wrong: r.wrong })]) : null,
    ]);
    box.destroy = () => card.destroy();
    return box;
  }
  /* 文法單元小試身手做完:放在單元下方,不換畫面 */
  function grammarDone(r, handlers) {
    const h = handlers || {};
    const card = root.UI.result({ inline: true, kicker: TX().grammar.kicker, score: r.score, total: r.total, primary: { label: TX().grammar.next, onClick: h.next } });
    card.heading.setAttribute(FOCUS, '');
    card.el.destroy = () => card.destroy();
    return card.el;
  }

  /* ---------- 通知、載入中、空狀態 ---------- */
  function note(lines) {
    const list = [].concat(lines || []).filter(Boolean);
    if (!list.length) return null;
    return el('p', { class: 'lsn-note', tabindex: '-1', [FOCUS]: '' }, list.map((s) => el('span', { class: 'lsn-note-line' }, [s])));
  }
  function loading() {
    return el('p', { class: 'result-note lsn-loading', role: 'status' }, [TX().home.loading]);
  }
  /* kind:notFound、off、unknown、noLevels、failed、itemsFailed、badData、notLive、locked、limit。
     extra = { no, m(先完成的堂), retry(e), reload(e) } */
  const DAILY = 'daily.html', LESSONS = 'lessons.html';
  function emptyOpt(kind, x) {
    const E = TX().empty;
    const daily = { label: E.daily, href: DAILY, primary: true };
    const retry = { label: E.retry, onClick: x.retry };
    const toList = [{ label: E.back, href: LESSONS }];
    return {
      notFound: { text: E.notFound, action: { label: E.back, href: LESSONS } },
      off: { text: E.off, action: daily },
      unknown: { text: E.unknown, action: retry, links: [{ label: E.daily, href: DAILY }] },
      noLevels: { text: E.noLevels, action: { label: E.setLevels, href: 'start.html' } },
      failed: { text: E.failed, action: retry, links: [{ label: E.daily, href: DAILY }] },
      itemsFailed: { text: E.itemsFailed, action: { label: E.reload, onClick: x.reload || (() => root.location.reload()) } },
      badData: { text: E.badData, action: { label: E.home, href: 'index.html' } },
      notLive: { text: E.notLive(x.no), action: daily, links: toList },
      locked: { text: E.locked(x.m), action: { label: E.goTo(x.m), href: 'lesson.html?no=' + x.m } },
      limit: { text: E.limit(x.no), action: daily, links: toList },
    }[kind];
  }
  function empty(kind, extra) {
    const o = emptyOpt(kind, extra || {});
    if (!o) throw new TypeError('沒有這種空狀態：' + kind);
    const box = root.UI.empty(Object.assign({ pose: 'sleep' }, o));
    const text = box.querySelector('.ui-empty-text');
    if (text) { text.setAttribute('tabindex', '-1'); text.setAttribute(FOCUS, ''); }
    return box;
  }

  root.LESSON_VIEWS = Object.freeze({
    overview, tip, words, wordQuiz, bridge, blockResult, grammarDone, note, empty, loading, back, button, show, focusIn,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
