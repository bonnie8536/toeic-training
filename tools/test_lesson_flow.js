/* 上課頁的流程(js/lesson.js、js/lesson-views.js):vm 沙盒、小假 DOM(tools/engine_kit.js)、假的共用元件與練習引擎
   (記下收到的 units、opts,可以模擬作答、交卷、離開,照引擎的做法寫作答紀錄),配真的 pack-core、lesson-rules、學習包、題庫。
   假的 LESSON_TEST、LESSON_PERSONAL、LESSON_ITEMS 也在這個檔裡(只照介面回傳、記下被呼叫)。不開瀏覽器、不連網。
   用法:node tools/test_lesson_flow.js */
'use strict';
const vm = require('vm');
const assert = require('assert');
const K = require('./lesson_kit.js');
const { fakeDom } = require('./engine_kit.js');
const { eq, NOW, DAY, EE, TE } = K;

const settle = async (n) => { for (let i = 0; i < (n || 120); i++) await new Promise((r) => setImmediate(r)); };
const SINGLE = ['1', '2', '5'];

/* ---------- 假的頁面環境 ---------- */
function mk(dom, tag, cls, text) {
  const n = dom.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}
function historyOf(listeners) {
  const stack = [{ state: null, url: 'outside' }];
  let i = 0;
  const log = [];
  const fire = (state) => (listeners.popstate || []).forEach((f) => f({ state }));
  return {
    log, stack, fire,
    get state() { return stack[i].state; },
    get index() { return i; },
    pushState(s, t, u) { stack.splice(i + 1); stack.push({ state: s, url: u }); i = stack.length - 1; log.push('push ' + u); },
    replaceState(s, t, u) { stack[i] = { state: s, url: u }; log.push('replace ' + u); },
    go(n) { const j = Math.max(0, Math.min(stack.length - 1, i + n)); log.push('go ' + n); if (j === i) return; i = j; setImmediate(() => fire(stack[i].state)); },
    back() { this.go(-1); },
  };
}
function fakeUI(dom, log) {
  const act = (a, cls) => {
    const b = mk(dom, a.href ? 'a' : 'button', cls, a.label);
    if (a.href) b.setAttribute('href', a.href);
    if (typeof a.onClick === 'function') b.addEventListener('click', (e) => a.onClick(e));
    return b;
  };
  let active = null;
  const UI = {
    reply: true,
    confirm(o) { log.push(['confirm', o]); return Promise.resolve(UI.reply); },
    empty(o) {
      const box = mk(dom, 'div', 'ui-empty');
      box.append(mk(dom, 'p', 'ui-empty-text', o.text));
      if (o.action) box.append(act(o.action, 'btn ui-empty-go' + (o.action.primary ? ' primary' : '')));
      (o.links || []).forEach((l) => box.append(act(l, 'btn-text ui-empty-link')));
      box.destroy = () => {};
      return box;
    },
    result(o) {
      const card = mk(dom, 'section', 'result-card' + (o.inline ? ' is-inline' : ''));
      const heading = mk(dom, 'h2', 'result-score', o.score + ' / ' + o.total);
      heading.setAttribute('tabindex', '-1');
      const reward = mk(dom, 'div', 'result-reward'), acts = mk(dom, 'div', 'result-actions');
      if (o.primary) acts.append(act(o.primary, 'btn primary result-go'));
      card.append(mk(dom, 'p', 'result-kicker', o.kicker), heading, reward, acts);
      return { el: card, heading, reward, destroy() {} };
    },
    detail(title, nodes, opt) {
      const d = mk(dom, 'details', 'result-detail');
      d.setAttribute('data-wrong', String(opt && opt.wrong));
      d.append(mk(dom, 'summary', null, title), ...[].concat(nodes || []));
      return d;
    },
    focus: { get active() { return active; }, enter: (o) => enterFocus(o) },
  };
  function enterFocus(o) {
    if (active) active.leave();
    const close = mk(dom, 'button', 'quiz-close'), foot = mk(dom, 'div', 'quiz-foot');
    dom.querySelector('.topbar').append(close);
    dom.body.append(foot);
    let dirty = false, gone = false;
    const api = {
      opt: o, total: o.total, cur: 0, footEl: foot, fb: null,
      get active() { return !gone; },
      progress(n) { api.cur = n; }, setTotal(n) { api.total = n; }, dirty(v) { dirty = v !== false; },
      foot(nodes) { foot.replaceChildren(...[].concat(nodes || []).filter(Boolean)); },
      feedback(f) { api.fb = f; const b = mk(dom, 'button', 'btn primary quiz-next', f.next); b.addEventListener('click', (e) => f.onNext(e)); foot.replaceChildren(b); b.focus(); return b; },
      keep(redraw) { redraw(); }, focusMain() { const t = dom.querySelector('main .q-text'); if (t) t.focus(); }, say() {}, slot() {}, action() {},
      leave() { if (gone) return; gone = true; close.remove(); foot.remove(); if (active === api) active = null; },
    };
    const exit = () => { api.leave(); if (typeof o.onExit === 'function') o.onExit(); };
    close.addEventListener('click', () => {
      if (o.confirmExit === false || !dirty) { exit(); return; }
      UI.confirm({ title: '離開這次練習？' }).then((yes) => { if (yes && !gone) exit(); });
    });
    active = api;
    return api;
  }
  return UI;
}
/* 假的練習引擎:參數不對照真的引擎丟 TypeError(空清單、找不到的英語耳、文法 id) */
function enginesOf(ctx, dom) {
  const calls = [];
  const need = (ok, msg) => { if (!ok) throw new TypeError(msg); };
  const body = (el, cls) => { const q = mk(dom, 'div', 'q-block'); q.append(mk(dom, 'div', 'q-text ' + cls, 'question')); el.replaceChildren(q); };
  const unitsOk = (u) => Array.isArray(u) && u.length > 0 && u.every((x) => x.item && typeof x.item.id === 'string');
  ctx.DRILL = { startQuiz(el, units, opts) {
    need(unitsOk(units), 'DRILL.startQuiz：units');
    const f = ctx.UI.focus.enter({ total: units.length, onExit: opts.onExit, confirmExit: opts.feedback !== 'instant' });
    body(el, 'drill');
    calls.push({ name: 'DRILL', el, units, opts, f });
  } };
  ctx.LISTEN = { startQuiz(el, cfg, opts) {
    need(unitsOk(opts.units) && Number.isInteger(opts.plays) && opts.plays >= 1 && opts.plays <= 3, 'LISTEN.startQuiz：units、plays');
    const f = ctx.UI.focus.enter({ total: opts.units.length, onExit: opts.onExit, confirmExit: opts.feedback !== 'instant' });
    body(el, 'listen');
    calls.push({ name: 'LISTEN', el, units: opts.units, opts, f });
  } };
  ctx.GRAMMAR = {
    unit(el, id, opts) {
      need(ctx.TOEIC.grammar.some((u) => u.id === id), 'GRAMMAR.unit：沒有這一課 ' + id);
      const box = mk(dom, 'div', 'gx-engine');
      box.append(mk(dom, 'h2', null, id));
      el.replaceChildren(box);
      calls.push({ name: 'GRAMMAR', el, id, opts });
    },
    done: (id) => ((ctx.store.get('grammar_done', {}) || {})[id] ? { ok: 1, t: 1, at: null } : null),
  };
  ctx.EAR = { round(el, sec, opts) {
    const list = { d: 'dictation', mp: 'pairs', n: 'numbers', s: 'shadow' }[sec];
    need(Array.isArray(opts.items) && opts.items.length && opts.items.every((id) => ctx.TOEIC.ear[list].some((q) => q.id === id)), 'EAR.round：items');
    const f = ctx.UI.focus.enter({ total: opts.items.length, onExit: opts.onExit });
    body(el, 'ear');
    const top = mk(dom, 'div', 'drill-top');
    top.append(mk(dom, 'h1', null, sec));   // 真的引擎在題目上面畫標題 h1(js/ear.js)
    el.prepend(top);
    calls.push({ name: 'EAR', el, sec, opts, f });
  } };
  return calls;
}
/* 假的測驗、個人段、逐題解析(介面照 js/lesson.js 檔頭) */
function fakesOf(ctx, dom, log) {
  const seg = async (c, slot, st) => { c.setState(await c.data.segment(c.no, c.lesson, slot, st, c.now())); };
  const card = () => { const s = mk(dom, 'section', 'result-card fake-result'); s.append(mk(dom, 'h2', 'result-score', 'done')); return s; };
  ctx.LESSON_ITEMS = { review(units, answers) { log.push(['items.review', units.length, answers.size]); return units.map((u) => mk(dom, 'div', 'fake-item', u.item.id)); } };
  ctx.LESSON_TEST = {
    assemble: (c) => ctx.LESSON_DATA.testForm(c),
    async run(c) { log.push(['test.run', c.slot]); await seg(c, c.slot, 'done'); return 'done'; },
    result(c, o) { log.push(['test.result', o]); return card(); },
  };
  const personal = (slot) => async (c) => { log.push(['personal.' + slot, c.slot]); await seg(c, c.slot, 'done'); return 'done'; };
  ctx.LESSON_PERSONAL = {
    review: personal('review'), weak: personal('weak'), testReview: personal('testReview'), checkpoint: personal('checkpoint'),
    async wrapup(c, o) { log.push(['personal.wrapup', o]); if (o && o.first) await seg(c, 'wrapup', 'done'); c.show(card()); return 'done'; },
  };
}
/* 一頁:o.kit 給 lesson_kit.env 的設定;o.from 從另一頁複製本機與分頁的儲存(重新整理、關掉再開);o.search 網址;o.before(ctx, e) 載入前改環境 */
async function page(o) {
  const opt = o || {};
  const from = opt.from;
  const kit = Object.assign({ bank: true, files: ['data/tips.js', 'data/articles.js', 'data/verbs.js'], pilot: ['k1'], membership: { ok: true, classes: [{ id: 'k1' }] } },
    from ? { cloud: from.e.cloud, session: from.e.ss.map } : {}, opt.kit);
  const e = K.env(kit);
  if (from) from.e.store.mem.forEach((v, k) => e.store.mem.set(k, v));
  if (opt.levels !== null && !e.store.mem.has('levels')) e.store.set('levels', opt.levels || EE);
  if (opt.seed) await opt.seed(e);
  const dom = fakeDom();
  dom.readyState = 'complete';
  const log = [], listeners = {};
  const main = mk(dom, 'main', 'container'), head = mk(dom, 'div', 'page-head'), kicker = mk(dom, 'p', 'lsn-kicker'), h1 = mk(dom, 'h1', null, '課程'), root = mk(dom, 'div');
  kicker.hidden = true; h1.setAttribute('id', 'lsn-h'); h1.setAttribute('tabindex', '-1'); root.setAttribute('id', 'lsn-root');
  head.append(kicker, h1);
  main.append(head, root);
  dom.body.append(mk(dom, 'header', 'topbar'), main);
  const ctx = e.ctx;
  Object.assign(ctx, {
    document: dom, location: { search: opt.search !== undefined ? opt.search : '?no=3', pathname: '/lesson.html', reload() { log.push(['reload']); } },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener() {},
    holdForAccount: () => false, uiReady: () => true,
  });
  ctx.history = historyOf(listeners);
  ctx.UI = fakeUI(dom, log);
  const calls = enginesOf(ctx, dom);
  fakesOf(ctx, dom, log);
  if (opt.before) opt.before(ctx, e);
  ['js/lesson-views.js', 'js/lesson.js'].forEach((f) => vm.runInContext(K.read(f), ctx, { filename: f }));
  await settle();
  return helpers({ e, ctx, dom, log, calls, root, h1, kicker, hist: ctx.history });
}
function helpers(p) {
  const $ = (s) => p.root.querySelector(s);
  return Object.assign(p, {
    $, $$: (s) => p.root.querySelectorAll(s),
    text: (s) => { const n = s ? $(s) || p.dom.querySelector(s) : p.root; return n ? n.textContent : null; },
    active: () => p.dom.activeElement,
    les: (no) => p.e.store.peek(p.e.P.lessonKey(1, no || 3)),
    last: (name) => p.calls.filter((c) => !name || c.name === name).slice(-1)[0],
    steps: () => p.$$('li').map((li) => [li.querySelector('.lsn-step-name').textContent, li.className.replace('lsn-step is-', ''), (li.querySelector('.lsn-step-st') || {}).textContent || '']),
    async click(sel) { const n = typeof sel === 'string' ? $(sel) || p.dom.querySelector(sel) : sel; assert.ok(n, '找不到 ' + sel); n.click(); await settle(); },
    async back() { p.hist.back(); await settle(); },
    async finish(call, okOf) { finish(p.ctx, call || p.last(), okOf); await settle(); },
    emptyText: () => p.text('.ui-empty-text'),
  });
}
/* 引擎作答:每小題一筆(js/lesson-entry.js 的結果格式),照引擎的做法寫作答紀錄與學習記錄 */
function subsOf(call) {
  const pre = call.name === 'LISTEN' ? 'l' : 'p';
  return [].concat(...call.units.map((u) => {
    const single = SINGLE.indexOf(u.p) > -1;
    return (single ? [u.item] : u.item.questions).map((q, qi) => ({ part: u.p, m: pre + u.p, id: u.item.id, answer: q.answer,
      sub: single ? null : q.num !== undefined ? q.num : qi + 1, key: single ? u.item.id : u.item.id + ':' + (q.num !== undefined ? q.num : qi) }));
  }));
}
function writeRec(ctx, s, c, ok) {
  const k = (Number(s.part) <= 4 ? 'listen_p' : 'drill_p') + s.part, t = ctx.Date.now();
  ctx.store.set(k, Object.assign({}, ctx.store.get(k, {}), { [s.key]: { c, ok, t } }));
  ctx.store.set('hist', (ctx.store.get('hist', []) || []).concat([{ m: s.m, id: s.key, c, ok, t }]));
}
function finish(ctx, call, okOf) {
  const items = subsOf(call).map((s, i) => {
    const ok = okOf ? okOf(i, s) : true, c = ok ? s.answer : (s.answer + 1) % 3;
    writeRec(ctx, s, c, ok);
    return { m: s.m, id: s.id, sub: s.sub, key: s.key, c, ok };
  });
  call.f.leave();
  call.opts.onDone({ score: items.filter((x) => x.ok).length, total: items.length, items });
}
const partial = (p, call, n) => subsOf(call).slice(0, n).forEach((s) => writeRec(p.ctx, s, s.answer, true));

/* ---------- 預先放好的進度 ---------- */
async function stateOf(e, lv, no, t) {
  await e.D.packs();
  const lesson = e.lesson(lv, no), c = e.D.ctx(lesson, t);
  if (lesson.kind === 'test') {
    const form = await e.D.testForm(c);
    return { lesson, s: [0, 1].reduce((s, i) => e.P.freeze(s, i, form[i], t), e.P.newState(lesson, t)) };
  }
  return { lesson, s: (await e.P.pickFixed(lesson, e.P.newState(lesson, t), c)).state };
}
const mark = (e, lesson, s, slots, st, t) => slots.reduce((a, slot) => e.P.setSegment(a, lesson, slot, st, t), s);
const allSlots = (lesson) => lesson.segments.map((x) => x.slot);
/* 第 1..n 堂上完(三天前);lv 是級別 */
async function doneThrough(e, lv, n, t0) {
  const t = t0 || NOW - 3 * DAY;
  for (let no = 1; no <= n; no++) {
    const x = await stateOf(e, lv, no, t);
    e.store.set(e.P.lessonKey(1, no), mark(e, x.lesson, x.s, allSlots(x.lesson), 'done', t + 600));
  }
}
/* 第 no 堂開始了、slots 這幾段已交卷;edit(s, lesson) 可以改凍結的題 */
async function started(e, lv, no, slots, edit) {
  const t = NOW - 3600;
  const x = await stateOf(e, lv, no, t);
  let s = mark(e, x.lesson, x.s, slots || [], 'done', t + 60);
  if (edit) s = edit(s, x.lesson);
  e.store.set(e.P.lessonKey(1, no), s);
  return x.lesson;
}
const lesson3 = (slots, edit, lv) => async (e) => { await doneThrough(e, lv || EE, 2); if (slots) await started(e, lv || EE, 3, slots, edit); };
const withPk = (idx, ids) => (s) => Object.assign({}, s, { pk: Object.assign({}, s.pk, { [idx]: Object.assign({}, s.pk[idx], { ids }) }) });

const T = {};

/* ---------- 開頁判斷(13 列與 compose 丟錯) ---------- */
T['開頁 1:網址的堂號不對 → 找不到這一堂＋回課程,h1 是課程'] = async () => {
  for (const s of ['?no=0', '?no=25', '?no=abc', '?no=3.5', '']) {
    const p = await page({ search: s });
    eq([p.emptyText(), p.text('.ui-empty-go'), p.$('.ui-empty-go').getAttribute('href'), p.h1.textContent, p.dom.title], ['找不到這一堂', '回課程', 'lessons.html', '課程', '課程 - 衝衝英文']);
  }
};
T['開頁 2:沒登入 → 這一頁不畫(登入卡由共用的登入程式畫),不查班級'] = async () => {
  const p = await page({ kit: { user: null } });
  eq([p.root.children.length, p.e.classCalls.length, p.h1.textContent], [0, 0, '第 3 堂']);
};
T['開頁 3:班級還在查 → 一行「載入中…」(role=status),不搶焦點'] = async () => {
  const p = await page({ kit: { membership: 'hang' } });
  eq([p.text('.lsn-loading'), p.$('.lsn-loading').getAttribute('role'), p.active()], ['載入中…', 'status', null]);
};
T['開頁 4:開關關著、不在試行班、老師 → 課程尚未開放＋實色每日練習'] = async () => {
  for (const kit of [{ ui: 'off' }, { pilot: [] }, { teacher: true }, { membership: { ok: true, classes: [{ id: 'other' }] } }]) {
    const p = await page({ kit });
    const go = p.$('.ui-empty-go');
    eq([p.emptyText(), go.textContent, go.getAttribute('href'), go.className.indexOf('primary') > -1, p.h1.textContent], ['課程尚未開放', '每日練習', 'daily.html', true, '第 3 堂']);
  }
};
T['開頁 5:查不到班級 → 讀不到班級資料＋重試＋每日練習;按重試再查一次,焦點到空狀態的字'] = async () => {
  const p = await page({ kit: { membership: { ok: false } } });
  eq([p.emptyText(), p.text('.ui-empty-go'), p.text('.ui-empty-link'), p.$('.ui-empty-link').getAttribute('href'), p.e.classCalls.length], ['讀不到班級資料', '重試', '每日練習', 'daily.html', 1]);
  await p.click('.ui-empty-go');
  eq([p.emptyText(), p.e.classCalls.length, p.active() === p.$('.ui-empty-text'), p.$('.ui-empty-text').getAttribute('tabindex')], ['讀不到班級資料', 2, true, '-1']);
};
T['開頁 6:沒有起始程度 → 還沒設定起始程度＋設定程度(start.html)'] = async () => {
  const p = await page({ levels: null });
  eq([p.emptyText(), p.text('.ui-empty-go'), p.$('.ui-empty-go').getAttribute('href')], ['還沒設定起始程度', '設定程度', 'start.html']);
};
T['開頁 7:學習包讀不到 → 載入失敗＋重試＋每日練習'] = async () => {
  const p = await page({ kit: { fetchFail: new Set(['data/packs/pack_threshold.json']) } });
  eq([p.emptyText(), p.text('.ui-empty-go'), p.text('.ui-empty-link')], ['載入失敗', '重試', '每日練習']);
};
T['開頁 8:題庫或引擎沒載到 → 題目載入失敗＋重新整理'] = async () => {
  for (const name of ['DRILL', 'LISTEN', 'GRAMMAR', 'EAR', 'DAILY']) {
    const p = await page({ seed: lesson3(), before: (ctx) => { ctx[name] = undefined; } });
    eq([name, p.emptyText(), p.text('.ui-empty-go')], [name, '題目載入失敗', '重新整理']);
    await p.click('.ui-empty-go');
    eq(p.log.filter((x) => x[0] === 'reload').length, 1);
  }
};
T['開頁 9:已完成的堂 → 本堂結果只讀(first: false);第 1 堂是前測結果'] = async () => {
  const p = await page({ seed: (e) => doneThrough(e, EE, 3) });
  eq(p.log.filter((x) => /^personal|^test/.test(x[0])), [['personal.wrapup', { first: false }]]);
  assert.ok(p.$('.fake-result'), '結果畫面');
  const p1 = await page({ search: '?no=1', seed: (e) => doneThrough(e, EE, 1) });
  eq(p1.log.filter((x) => /^personal|^test/.test(x[0])), [['test.result', { first: false }]]);
  assert.ok(p1.$('.fake-result') && p1.h1.classList.contains('daily-sr'), '前測結果、h1 藏起來');
};
T['開頁 10:第 5 堂尚未開放 → 實色每日練習＋連結回課程,h1 寫第 5 堂'] = async () => {
  const p = await page({ search: '?no=5', seed: (e) => doneThrough(e, EE, 4) });
  eq([p.emptyText(), p.text('.ui-empty-go'), p.$('.ui-empty-go').className.indexOf('primary') > -1, p.text('.ui-empty-link'), p.$('.ui-empty-link').getAttribute('href'), p.h1.textContent],
    ['第 5 堂尚未開放', '每日練習', true, '回課程', 'lessons.html', '第 5 堂']);
};
T['開頁 11:上鎖 → 先完成第 m 堂＋描邊前往第 m 堂(m 是第一個沒上完的)'] = async () => {
  const p = await page({ seed: (e) => doneThrough(e, EE, 1) });
  const go = p.$('.ui-empty-go');
  eq([p.emptyText(), go.textContent, go.getAttribute('href'), go.className.indexOf('primary')], ['先完成第 2 堂', '前往第 2 堂', 'lesson.html?no=2', -1]);
};
T['開頁 12:今天已開 2 堂 → 第 n 堂明天開放＋實色每日練習＋回課程;h1 是堂名'] = async () => {
  const p = await page({ seed: async (e) => {
    await doneThrough(e, EE, 1, NOW - 600);
    const x = await stateOf(e, EE, 2, NOW - 300);
    e.store.set('les_t1_02', mark(e, x.lesson, x.s, x.lesson.segments.filter((s) => s.fixed).map((s) => s.slot), 'done', NOW - 200));
  } });
  eq([p.emptyText(), p.text('.ui-empty-go'), p.text('.ui-empty-link'), p.h1.textContent], ['第 3 堂明天開放', '每日練習', '回課程', '照片描述與名詞形容詞位置']);
};
T['開頁 13:可上 → 段落總覽(kicker、堂名、← 回課程、目前、開始;開頁焦點不動;頁名)'] = async () => {
  const p = await page({ seed: lesson3() });
  eq(p.steps().map((x) => x[0]), ['單字', '聽力', '閱讀', '回顧', '弱點補練', '本堂結果']);
  eq([p.steps()[0][1], p.$('li').getAttribute('aria-current'), p.$('li .daily-sr').textContent, p.text('.lsn-step-min')], ['current', 'step', '目前', '5 分鐘']);
  eq([p.h1.textContent, p.h1.classList.contains('daily-sr'), p.kicker.hidden, p.kicker.textContent], ['照片描述與名詞形容詞位置', false, false, '第 3 堂']);
  const back = p.dom.querySelector('.lsn-top .lsn-back');
  eq([back.textContent, back.getAttribute('href'), p.text('.lsn-go'), p.$('.lsn-skip'), p.active(), p.dom.title], ['← 回課程', 'lessons.html', '開始', null, null, '第 3 堂 - 衝衝英文']);
  eq([p.$('ol').getAttribute('aria-label'), p.$$('.btn.primary').length, p.les(3)], ['段落', 1, undefined]);
};
T['開頁:compose 丟錯(進度的級別不對) → 課程資料有誤＋回首頁,印出原因'] = async () => {
  const p = await page({ seed: async (e) => { await doneThrough(e, EE, 2); e.store.set('les_t1_03', { v: 1, startedAt: NOW - 60, levels: { listening: 'advanced', reading: 'entry' }, seg: {}, pk: {}, a: [] }); } });
  eq([p.emptyText(), p.text('.ui-empty-go'), p.$('.ui-empty-go').getAttribute('href'), p.e.logs.error.length > 0], ['課程資料有誤', '回首頁', 'index.html', true]);
};

/* ---------- 入門第 3 堂從頭到尾 ---------- */
T['第 3 堂單字段:開始才建進度;字卡(專心模式、0 / 10)→ 小考每題寫進度 → 回總覽'] = async () => {
  const p = await page({ seed: lesson3() });
  await p.click('.lsn-go');
  const s = p.les(3);
  eq([!!s.startedAt, s.seg.vocab.st, p.hist.log.slice(-1)[0], p.e.store.peek('plan')], [true, 'doing', 'push lesson.html?no=3&s=1', undefined]);
  const f = p.ctx.UI.focus.active;
  eq([p.text('.lsn-words-h'), p.active() === p.$('.lsn-words-h'), p.text('.mock-tag'), p.$$('.lsn-word').length, f.total, f.cur, f.opt.confirmExit], ['本週新字', true, '20 個字', 20, 10, 0, false]);
  await p.click(f.footEl.querySelector('.lsn-go'));
  for (let i = 0; i < 10; i++) {
    eq([f.cur, p.$$('.opt').length, !!p.$('.lsn-word-q').textContent], [i + 1, 4, true]);
    const right = answerOf(p, i);
    assert.ok(right > -1, '正解在選項裡');
    await p.click(p.$$('.opt')[i % 3 === 0 ? (right + 1) % 4 : right]);
    eq(p.les(3).a.length, i + 1);
    eq(f.fb.next, i === 9 ? '完成' : '下一題');
    await p.click(f.footEl.querySelector('.quiz-next'));
  }
  const rows = p.les(3).a;
  eq([rows.every((x) => (x[4] & 2) === 2), rows.filter((x) => (x[4] & 1) === 0).length, p.les(3).seg.vocab.st, p.ctx.UI.focus.active], [true, 4, 'done', null]);
  eq([p.steps()[0], p.steps()[1][1], p.active() === p.h1, p.text('.lsn-go'), p.hist.log.slice(-1)[0]], [['單字', 'done', '完成'], 'current', true, '繼續', 'go -2']);
  eq(['pts', 'rvq', 'hist'].map((k) => p.e.store.peek(k)), [undefined, undefined, undefined]);
};
/* 第 i 題單字題的正解在第幾個:題目照凍結的字序,中文照字表(文章的字或動詞表) */
function answerOf(p, i) {
  const pk = p.les(3).pk, id = pk[1].ids.concat(pk[2].ids)[i], X = p.ctx.TOEIC;
  const w = K.WORDS.entry.words.filter((x) => String(x.n) === id)[0];
  const zh = w.kind === 'verb' ? X.verbs.filter((v) => v.id === w.id)[0].zh : X.articles.filter((a) => a.id === w.article)[0].vocab.filter((v) => v.base === w.base)[0].zh;
  return p.$$('.opt').map((b) => b.querySelectorAll('span')[1].textContent).indexOf(zh);
}
T['第 3 堂聽力段:技巧卡 → 即時回合(P1、P2 併一回合)→ 過場 → 交卷回合 → 區塊結果 kicker 是 Part'] = async () => {
  const p = await page({ seed: lesson3(['vocab']) });
  await p.click('.lsn-go');
  eq([p.text('.lsn-tip-h'), p.active() === p.$('.lsn-tip-h'), p.$$('.lsn-ex-tag').map((x) => x.textContent), !!p.$('.lsn-ex-zh'), p.text('.lsn-back')], ['先看照片再核對每一句', true, ['照片', '播出'], true, '← 回第 3 堂']);
  eq([p.h1.classList.contains('daily-sr'), p.kicker.hidden, p.dom.querySelector('.lsn-top').hidden], [true, true, true]);
  await p.click('.lsn-go');
  const a = p.last('LISTEN'), pk = p.les(3).pk;
  eq([a.opts.feedback, a.opts.plays, a.units.map((u) => u.item.id), a.units.map((u) => u.p)], ['instant', 2, pk[4].ids.concat(pk[5].ids), ['1', '1', '2', '2', '2', '2']]);
  await p.finish(a, (i) => i !== 0);
  eq([p.text('.lsn-card-h'), p.text('.mock-tag'), p.text('.lsn-line'), p.active() === p.$('.lsn-card-h'), p.calls.length], ['Part 2、Part 1', '16 題', '交卷後才對答案', true, 1]);
  await p.click('.lsn-go');
  const b = p.last('LISTEN');
  eq([b.opts.feedback, b.opts.plays, b.units.map((u) => u.item.id)], ['submit', 1, pk[6].ids.concat(pk[7].ids)]);
  await p.finish(b, (i) => i % 4 !== 1);
  eq([p.text('.result-kicker'), p.text('.result-score'), p.active() === p.$('.result-score'), p.text('summary'), p.$('details').getAttribute('data-wrong')], ['Part 2、Part 1', '12 / 16', true, '逐題解析 16 題', '4']);
  eq(p.log.filter((x) => x[0] === 'items.review'), [['items.review', 16, 16]]);
  await p.click('.result-go');
  const s = p.les(3), pts = p.e.store.peek('pts'), rvq = p.e.store.peek('rvq');
  eq([s.seg.listening.st, s.a.filter((x) => x[0] >= 4 && x[0] <= 7).length, s.a.filter((x) => x[0] === 4 && (x[4] & 2) === 2).length], ['done', 22, 2]);
  eq([pts['P1.photo'].hits.map((h) => h.b).sort(), rvq.length], [['les_t1_03:4', 'les_t1_03:7'], 5]);
  eq(['listen_p1', 'listen_p2', 'hist'].map((k) => p.e.cloud.reads.filter((x) => x === k).length), [2, 2, 2]);
};
T['第 3 堂閱讀段:文法單元 onDone 後不換畫面、按「下一步」才走;DRILL 即時與交卷'] = async () => {
  const p = await page({ seed: lesson3(['vocab', 'listening']) });
  await p.click('.lsn-go');
  eq([p.text('.lsn-tip-h'), p.$$('.lsn-ex-tag').map((x) => x.textContent), p.$$('.lsn-ex-opt').map((x) => x.textContent)],
    ['看空格前後判斷詞性', ['題本'], ['(A) beauty', '(B) beautiful', '(C) beautifully', '(D) beautify']]);
  await p.click('.lsn-go');
  const g = p.last('GRAMMAR');
  eq([g.id, p.active() === g.el.querySelector('h2'), p.text('.lsn-back')], ['gf-01', true, '← 回第 3 堂']);
  const unit = p.ctx.TOEIC.grammar.filter((u) => u.id === 'gf-01')[0];
  const items = unit.quiz.map((q, qi) => ({ m: 'g', id: 'gf-01', sub: qi + 1, key: 'gf-01:' + qi, c: q.answer, ok: qi > 0 }));
  g.opts.onDone({ score: items.length - 1, total: items.length, items });
  await settle();
  eq([!!g.el.querySelector('.gx-engine'), p.text('.result-kicker'), p.text('.result-score'), p.active() === p.$('.result-score'), p.calls.length], [true, '小試身手', (items.length - 1) + ' / ' + items.length, true, 1]);
  eq(p.les(3).a.filter((x) => x[0] === 9).map((x) => [x[2], x[4]]), items.map((x, i) => [i + 1, (i > 0 ? 1 : 0) + 2]));
  await p.click('.result-go');
  const d = p.last('DRILL');
  eq([d.opts.feedback, d.opts.plays, d.units.length], ['instant', undefined, 2]);
  await p.finish(d);
  eq([p.text('.lsn-card-h'), p.text('.mock-tag')], ['Part 5', '8 題']);
  await p.click('.lsn-go');
  await p.finish(p.last('DRILL'), (i) => i > 1);
  eq([p.last('DRILL').opts.feedback, p.text('.result-kicker'), p.text('.result-score')], ['submit', 'Part 5', '6 / 8']);
  await p.click('.result-go');
  eq([p.les(3).seg.reading.st, p.steps()[2][1], p.active() === p.h1], ['done', 'done', true]);
};
T['第 3 堂個人段與本堂結果:交給 LESSON_PERSONAL;試排 0 的回顧畫略過、主按鈕跳過它並記略過'] = async () => {
  const p = await page({ seed: lesson3(['vocab', 'listening', 'reading']) });
  const st = p.steps();
  eq([st[3], st[4][1], p.$('.lsn-skip') ? p.text('.lsn-skip') : null], [['回顧', 'skip', '略過'], 'current', '略過這一段']);
  await p.click('.lsn-go');
  eq([p.les(3).seg.review.st, p.log.filter((x) => /^personal/.test(x[0]))], ['skip', [['personal.weak', 'weak']]]);
  eq(p.steps()[5][1], 'current');
  await p.click('.lsn-go');
  eq([p.log.filter((x) => x[0] === 'personal.wrapup'), !!p.les(3).doneAt, !!p.$('.fake-result'), p.les(3).seg.wrapup.st], [[['personal.wrapup', { first: true }]], true, true, 'done']);
};

/* ---------- 中途離開與回來 ---------- */
T['即時回合中途離開:從作答紀錄補回已答的題(第一次作答),回來只出沒答的題;關分頁沒經過離開也補回'] = async () => {
  const p = await page({ seed: lesson3(['vocab']) });
  await p.click('.lsn-go');
  await p.click('.lsn-go');
  const a = p.last('LISTEN');
  partial(p, a, 3);
  await p.click(p.dom.querySelector('.quiz-close'));
  const rows = p.les(3).a.filter((x) => x[0] === 4 || x[0] === 5);
  eq([rows.length, rows.every((x) => x[4] === 3), p.steps()[1][1], p.text('.lsn-go'), p.calls.length], [3, true, 'current', '繼續', 1]);
  await p.click('.lsn-go');
  const b = p.last('LISTEN');
  eq([p.calls.length, b.units.map((u) => u.item.id)], [2, a.units.slice(3).map((u) => u.item.id)]);
  partial(p, b, 1);
  const p2 = await page({ from: p });
  await p2.click('.lsn-go');
  eq([p2.last('LISTEN').units.map((u) => u.item.id), p2.les(3).a.filter((x) => x[0] === 4 || x[0] === 5).length], [a.units.slice(4).map((u) => u.item.id), 4]);
};
T['交卷回合中途離開:不寫任何作答,回來整個回合重做(過場、同樣的題)'] = async () => {
  const p = await page({ seed: lesson3(['vocab']) });
  await p.click('.lsn-go');
  await p.click('.lsn-go');
  await p.finish();
  await p.click('.lsn-go');
  const a = p.last('LISTEN');
  a.f.dirty(true);
  const n = p.les(3).a.length;
  await p.click(p.dom.querySelector('.quiz-close'));
  eq([p.log.filter((x) => x[0] === 'confirm').length, p.les(3).a.length, p.steps()[1][1]], [1, n, 'current']);
  await p.click('.lsn-go');
  eq([p.text('.lsn-card-h'), p.text('.mock-tag')], ['Part 2、Part 1', '16 題']);
  await p.click('.lsn-go');
  eq([p.last('LISTEN').units.map((u) => u.item.id), p.last('LISTEN').opts.feedback], [a.units.map((u) => u.item.id), 'submit']);
};
T['淘汰的題:一題找不到就略過那一題(印出 id);整個回合都找不到不呼叫引擎、段照樣完成'] = async () => {
  const edit = (s) => [withPk(4, ['l1-zz0', s.pk[4].ids[1]]), withPk(6, ['l2-zz1']), withPk(7, ['l1-zz8', 'l1-zz9'])].reduce((a, f) => f(a), s);
  const p = await page({ seed: lesson3(['vocab'], edit) });
  await p.click('.lsn-go');
  await p.click('.lsn-go');
  const a = p.last('LISTEN');
  eq([a.units.length, p.e.logs.warn.some((w) => String(w[0]).indexOf('l1-zz0') > -1)], [5, true]);
  await p.finish(a);
  eq([p.calls.length, p.les(3).seg.listening.st, p.steps()[1][1]], [1, 'done', 'done']);
};
T['英語耳、文法的 id 找不到:不呼叫引擎,接著下一步'] = async () => {
  const p = await page({ seed: lesson3(['vocab', 'listening'], withPk(9, ['gx-99'])) });
  await p.click('.lsn-go');
  await p.click('.lsn-go');
  eq([p.calls.map((c) => c.name), p.e.logs.warn.some((w) => String(w[0]).indexOf('gx-99') > -1)], [['DRILL'], true]);
  const q = await page({ search: '?no=2', seed: async (e) => { await doneThrough(e, EE, 1); await started(e, EE, 2, ['test_review', 'vocab'], withPk(2, ['d-999'])); } });
  await q.click('.lsn-go');
  eq([q.calls.map((c) => c.name), q.last().opts.feedback], [['LISTEN'], 'instant']);
};
T['英語耳:照凍結的題出(sec 對到模組)、作答寫進度不寫 pts;引擎丟 TypeError → 課程資料有誤、離開專心模式'] = async () => {
  const q = await page({ search: '?no=2', seed: async (e) => { await doneThrough(e, EE, 1); await started(e, EE, 2, ['test_review', 'vocab']); } });
  await q.click('.lsn-go');
  const ear = q.last('EAR'), ids = q.les(2).pk[2].ids;
  eq([ear.sec, ear.opts.items], ['d', ids]);
  ear.f.leave();
  ear.opts.onDone({ score: ids.length, total: ids.length, items: ids.map((id) => ({ m: 'ear_d', id, sub: null, key: id, c: 'typed', ok: true })) });
  await settle();
  eq([q.les(2).a.filter((x) => x[0] === 2).map((x) => [x[1], x[3], x[4]]), q.last().name, q.e.store.peek('pts')], [ids.map((id) => [id, -1, 3]), 'LISTEN', undefined]);
  const p = await page({ seed: lesson3(['vocab']), before: (ctx) => { ctx.LISTEN.startQuiz = () => { throw new TypeError('LISTEN.startQuiz：units'); }; } });
  await p.click('.lsn-go');
  await p.click('.lsn-go');
  eq([p.emptyText(), p.text('.ui-empty-go'), p.ctx.UI.focus.active, p.e.logs.error.length > 0], ['課程資料有誤', '回首頁', null, true]);
};
T['英語耳:換到這一步時焦點在引擎畫的標題(從段落總覽進來、接在上一個回合後面都一樣)'] = async () => {
  const headOf = (p) => { const c = p.last('EAR'); return c ? c.el.querySelector('h1') : null; };
  const q = await page({ search: '?no=2', seed: async (e) => { await doneThrough(e, EE, 1); await started(e, EE, 2, ['test_review', 'vocab']); } });
  await q.click('.lsn-go');
  const h = headOf(q);
  eq([q.last().name, !!h, q.active() === h, h && h.getAttribute('tabindex')], ['EAR', true, true, '-1'], '從段落總覽進來');
  const p = await page({ search: '?no=2', levels: TE, seed: async (e) => { await doneThrough(e, TE, 1); await started(e, TE, 2, ['test_review', 'vocab']); } });
  await p.click('.lsn-go');
  for (let i = 0; i < 6 && p.last().name !== 'EAR'; i++) {
    if (p.ctx.UI.focus.active) await p.finish();
    else await p.click(p.$('.result-go') ? '.result-go' : '.lsn-go');   // 區塊結果的「下一步」、過場的「開始」
  }
  const h2 = headOf(p);
  eq([p.calls.map((c) => c.name), !!h2, p.active() === h2], [['LISTEN', 'LISTEN', 'EAR'], true, true], '接在上一個回合後面');
};
T['略過個人段:先問(取消停在取消上),確定才記略過;固定段沒有略過'] = async () => {
  const p = await page({ seed: async (e) => {
    await lesson3(['vocab', 'listening', 'reading'])(e);
    const today = e.P.dayOf(NOW), id = (await e.B.meta('5'))[0].id;
    e.store.set('rvq', e.R.scheduleWrong([], { m: 'p5', id, sub: null }, e.R.addDays(today, -1)));
  } });
  eq([p.steps()[3][1], p.text('.lsn-skip')], ['current', '略過這一段']);
  p.ctx.UI.reply = false;
  await p.click('.lsn-skip');
  const ask = p.log.filter((x) => x[0] === 'confirm')[0][1];
  eq([ask.title, ask.body, ask.ok, ask.cancel, ask.focusCancel, p.les(3).seg.review.st], ['略過回顧？', '略過後不能再做', '略過', '取消', true, 'todo']);
  p.ctx.UI.reply = true;
  await p.click('.lsn-skip');
  eq([p.les(3).seg.review.st, p.steps()[3], p.steps()[4][1], p.active() === p.h1], ['skip', ['回顧', 'skip', '略過'], 'current', true]);
  const q = await page({ seed: lesson3(['vocab']) });
  eq([q.steps()[1][1], q.$('.lsn-skip')], ['current', null]);
};

T['給個人段的 ctx.runRound:錯題重做 f 一律 false、不記 pts 不排錯題,onItems 拿到寫進進度的作答;考點回顧照給的 src 記一批'] = async () => {
  const got = [];
  const edit = (s) => {
    const p5 = s.pk[10].ids.concat(s.pk[11].ids);
    return Object.assign({}, s, { pk: Object.assign({}, s.pk, { 80: { at: 10, ids: p5.slice(0, 2), r: 'review', sub: [null, null], m: ['p5', 'p5'] }, 81: { at: 10, ids: p5.slice(2, 5), r: 'point_review:P5.cat:詞性變化' } }) });
  };
  const p = await page({ seed: lesson3(['vocab', 'listening', 'reading'], edit), before: (ctx) => {
    ctx.LESSON_PERSONAL.review = async (c) => {
      const rs = ctx.LESSON_CORE.rounds(c.segment, c.state());
      got.push(rs.map((r) => [r.kind, r.engine, r.feedback, r.blocks.map((b) => b.idx)]));
      got.push(await c.runRound(rs[0], { src: null, wrong: false, onItems: (rows) => { got.push(rows.map((x) => [x.b, x.f])); } }));
      got.push(await c.runRound(rs[1], { src: 'r' }));
      c.setState(await c.data.segment(c.no, c.lesson, 'review', 'done', c.now()));
      return 'done';
    };
  } });
  eq(p.steps()[3][1], 'current');
  await p.click('.lsn-go');
  await p.finish(p.last('DRILL'), (i) => i > 0);
  await p.finish(p.last('DRILL'), (i) => i !== 1);
  eq(got.slice(0, 4), [[['bank', 'DRILL', 'instant', [80]], ['bank', 'DRILL', 'instant', [81]]], [[80, false], [80, false]], 'done', 'done']);
  const pts = p.e.store.peek('pts') || {}, hits = [].concat(...Object.keys(pts).map((k) => pts[k].hits));
  eq([hits.map((h) => [h.src, h.b, h.n]), p.e.store.peek('rvq').map((x) => x.m), p.steps()[3][1]], [[['r', 'les_t1_03:81', 3]], ['p5'], 'done']);
};

/* ---------- 瀏覽歷史、焦點 ---------- */
T['瀏覽歷史:進段 pushState(?no=3&s=段序號)、返回鍵回總覽、重新整理帶 s 一律回總覽'] = async () => {
  const p = await page({ search: '?no=3&s=2', seed: lesson3(['vocab']) });
  eq([p.hist.log[0], !!p.$('.lsn-steps')], ['replace lesson.html?no=3', true]);
  await p.click('.lsn-go');
  eq([p.hist.log.slice(-1)[0], !!p.$('.lsn-tip')], ['push lesson.html?no=3&s=2', true]);
  await p.back();
  eq([!!p.$('.lsn-steps'), p.active() === p.h1, p.hist.index, p.steps()[1][1]], [true, true, 0, 'current']);
  await p.click('.lsn-go');
  await p.click('.lsn-go');
  await p.finish();
  eq([p.hist.index, !!p.$('.lsn-bridge'), p.hist.log.slice(-2)], [3, true, ['push lesson.html?no=3&s=2', 'push lesson.html?no=3&s=2']]);
  await p.back();
  eq([!!p.$('.lsn-steps'), p.hist.index, p.hist.log.slice(-1)[0]], [true, 0, 'go -2']);
};
T['專心模式中按返回等於按關閉:即時回合直接回總覽;交卷回合問了選繼續作答就留在原處'] = async () => {
  const p = await page({ seed: lesson3(['vocab']) });
  await p.click('.lsn-go');
  await p.click('.lsn-go');
  await p.back();
  eq([!!p.$('.lsn-steps'), p.ctx.UI.focus.active, p.hist.index, p.hist.log.slice(-2)], [true, null, 0, ['push lesson.html?no=3&s=2', 'go -2']]);
  await p.click('.lsn-go');
  await p.click('.lsn-go');
  await p.finish();
  await p.click('.lsn-go');
  const b = p.last('LISTEN');
  b.f.dirty(true);
  p.ctx.UI.reply = false;
  const at = p.hist.index;
  await p.back();
  eq([p.log.filter((x) => x[0] === 'confirm').length, b.f.active, !!p.$('.lsn-steps'), p.hist.index], [1, true, false, at]);
  p.ctx.UI.reply = true;
  await p.back();
  eq([b.f.active, !!p.$('.lsn-steps'), p.hist.index], [false, true, 0]);
};
T['焦點:按開始時已經到上限 → 空狀態的字;換畫面到 h2;回總覽到 h1'] = async () => {
  const p = await page({ seed: lesson3() });
  ['les_t1_01', 'les_t1_02'].forEach((k) => p.e.store.set(k, Object.assign({}, p.e.store.peek(k), { startedAt: NOW - 60 })));
  await p.click('.lsn-go');
  eq([p.emptyText(), p.active() === p.$('.ui-empty-text'), p.les(3)], ['第 3 堂明天開放', true, undefined]);
};
T['第 1 堂:總覽兩行規則與題數 → 按開始組卷、建進度與 plan、聽力測驗交給 LESSON_TEST.run'] = async () => {
  const p = await page({ search: '?no=1' });
  const C = p.ctx.LESSON_CORE;
  eq([p.h1.textContent, p.steps().map((x) => [x[0], x[1]]), p.$$('.lsn-step-min').map((x) => x.textContent), p.$$('.lsn-rule').map((x) => x.textContent)],
    ['前測', [['聽力測驗', 'current'], ['閱讀測驗', 'todo']], ['36 題 · 17 分鐘', '約 30 分鐘'], ['每題音檔只播一次', '開始後不能回上一題']]);
  await p.click('.lsn-go');
  const s = p.les(1), n = s.pk[1].ids.reduce((a, id) => a + (/^p5-/.test(id) ? 1 : p.ctx.BANK_META.items.filter((r) => r.id === id)[0].size), 0);
  eq([!!s.pk[0], !!s.pk[1], s.seg.test_listening.st, p.e.store.peek('plan').classId, p.log.filter((x) => x[0] === 'test.run')], [true, true, 'done', 'k1', [['test.run', 'test_listening']]]);
  eq([p.steps()[1][1], p.$$('.lsn-step-min')[1].textContent, p.$$('.lsn-rule').length], ['current', C.TEXT.lesson.itemsMin(n, Math.round(C.testLimit('test_reading', n) / 60)), 0]);
};
T['第 1 堂開頁:聽力測驗超過 24 小時自動交卷、時間用完交卷,通知在總覽上方且焦點在通知;還在時間內寫剩幾分鐘(最後作答與這個分頁記的時間取晚的)'] = async () => {
  const seed = (ago, at) => async (e) => {
    const x = await stateOf(e, EE, 1, NOW - ago);
    let s = e.P.setSegment(x.s, x.lesson, 'test_listening', 'doing', NOW - ago);
    if (at) s = e.P.answer(s, { b: 0, id: s.pk[0].ids[0], sub: 0, c: 1, ok: true, f: true, t: NOW - ago + at });
    e.store.set('les_t1_01', s);
  };
  const real = (ctx) => ['js/lesson-items.js', 'js/lesson-test.js'].forEach((f) => vm.runInContext(K.read(f), ctx, { filename: f }));   // 時間到與 24 小時由 LESSON_TEST.expire 判
  const a = await page({ search: '?no=1', seed: seed(2 * DAY), before: real });
  eq([a.dom.querySelector('.lsn-note').textContent, a.active() === a.dom.querySelector('.lsn-note'), a.les(1).seg.test_listening.st], ['聽力測驗超過 24 小時已自動交卷', true, 'done']);
  const b = await page({ search: '?no=1', seed: seed(1200, 1100), before: real });
  eq([b.dom.querySelector('.lsn-note').textContent, b.les(1).seg.test_listening.st, b.steps()[1][1]], ['聽力測驗時間到', 'done', 'current']);
  const clock = new Map([['lsn_clock', JSON.stringify({ p: K.CPID, k: 'les_t1_01', s: 'test_listening', at: NOW - 600 + 400 })]]);
  const c = await page({ search: '?no=1', seed: seed(600, 300), kit: { session: clock }, before: real });
  const n = c.les(1).pk[0].ids.reduce((s, id) => s + (/^l[12]-/.test(id) ? 1 : c.ctx.BANK_META.items.filter((r) => r.id === id)[0].size), 0);
  eq([c.dom.querySelector('.lsn-note'), c.$$('.lsn-step-min')[0].textContent, c.text('.lsn-go'), c.$$('.lsn-rule').length, c.les(1).seg.test_listening.st],
    [null, '剩 ' + Math.ceil((c.ctx.LESSON_CORE.testLimit('test_listening', n) - 400) / 60) + ' 分鐘', '繼續', 0, 'doing']);
};
T['第 1 堂開頁:閱讀測驗超過 24 小時自動交卷 → 前測結果上方通知、焦點在通知,總覽的通知列沒有這一則'] = async () => {
  const seed = async (e) => {
    const x = await stateOf(e, EE, 1, NOW - 2 * DAY);
    let s = mark(e, x.lesson, x.s, ['test_listening'], 'done', NOW - 2 * DAY + 1000);
    s = e.P.setSegment(s, x.lesson, 'test_reading', 'doing', NOW - 2 * DAY + 1100);
    s = e.P.answer(s, { b: 1, id: s.pk[1].ids[0], sub: 0, c: 1, ok: true, f: true, t: NOW - 2 * DAY + 1200 });
    e.store.set('les_t1_01', s);
  };
  const real = (ctx) => ['js/lesson-items.js', 'js/lesson-test.js'].forEach((f) => vm.runInContext(K.read(f), ctx, { filename: f }));
  const p = await page({ search: '?no=1', seed, before: real });
  const note = p.root.firstChild;
  eq([note && note.className, note && note.textContent, p.active() === note, !!p.$('.result-card'), !!p.les(1).doneAt, p.dom.querySelector('.lsn-top .lsn-note')],
    ['lsn-note lsn-result-note', '閱讀測驗超過 24 小時已自動交卷', true, true, true, null]);
};
T['聽門檻讀入門第 3 堂:聽力區塊是門檻包、閱讀與單字是入門包,引擎拿到的是各自凍結的題'] = async () => {
  const p = await page({ levels: TE, seed: lesson3(['vocab'], null, TE) });
  const l = p.e.lesson(TE, 3), seg = (slot) => l.segments.filter((s) => s.slot === slot)[0].blocks.map((b) => b.blockId);
  assert.ok(seg('listening').every((id) => /^threshold-L03-listening-/.test(id)), seg('listening').join());
  assert.ok(seg('reading').concat(seg('vocab')).every((id) => /^entry-L03-/.test(id)), seg('reading').join());
  await p.click('.lsn-go');
  await p.click('.lsn-go');
  const pk = p.les(3).pk;
  eq([p.les(3).levels, p.last('LISTEN').units.map((u) => u.item.id)], [TE, pk[4].ids.concat(pk[5].ids)]);
};
T['每堂進度鍵:入門、門檻、混級第 1–4 堂的固定段填滿作答(前測用最大的題組)≤ 5,120 位元組'] = async () => {
  const e = K.env({ bank: true });
  await e.D.packs();
  const rows = await e.B.meta(), size = (id) => (rows.filter((r) => r.id === id)[0] || {}).size || 1;
  const big = (part, n) => rows.filter((r) => r.part === part).slice().sort((a, b) => (b.size || 1) - (a.size || 1)).slice(0, n).map((r) => r.id);
  const out = [];
  for (const lv of [EE, K.TT, TE, K.ET]) {
    for (let no = 1; no <= 4; no++) {
      const lesson = e.lesson(lv, no);
      let s = no === 1 ? e.P.freeze(e.P.freeze(e.P.newState(lesson, NOW), 0, big('1', 3).concat(big('2', 12), big('3', 4), big('4', 3)), NOW), 1, big('5', 15).concat(big('6', 2), big('7', 4)), NOW)
        : (await e.P.pickFixed(lesson, e.P.newState(lesson, NOW), e.D.ctx(lesson, NOW))).state;
      Object.keys(s.pk).forEach((k) => s.pk[k].ids.forEach((id) => {
        const subs = /^(l[12]|p5)-/.test(id) ? [0] : /^(l[34]|p[67])-/.test(id) ? Array.from({ length: size(id) }, (_, i) => i + 1) : [0];
        subs.forEach((sub) => { s = e.P.answer(s, { b: Number(k), id, sub, c: 1, ok: true, f: true, t: NOW + 3000 }); });
      }));
      s = mark(e, lesson, s, allSlots(lesson), 'done', NOW + 3600);
      out.push(e.P.sizeOf(s));
    }
  }
  assert.ok(Math.max(...out) <= 5120, '最大 ' + Math.max(...out));
  return '最大 ' + Math.max(...out) + ' 位元組';
};
T['檔案:課程頁兩支 js 與測試都在 800 行內;js/lesson.js、js/lesson-views.js 不寫 store、不讀寫 sessionStorage'] = () => {
  ['js/lesson.js', 'js/lesson-views.js', 'css/lesson.css', 'tools/test_lesson_flow.js'].forEach((f) => assert.ok(K.read(f).split('\n').length <= 800, f + ' 超過 800 行'));
  ['js/lesson.js', 'js/lesson-views.js'].forEach((f) => eq([f, /\bstore\.(set|remove)\(|sessionStorage|localStorage|console\.log/.test(K.read(f))], [f, false]));
};

K.run(T);
