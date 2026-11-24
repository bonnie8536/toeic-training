/* 第 1 堂前測(js/lesson-test.js)與題目畫面(js/lesson-items.js):vm 沙盒裡的假 store、雲端、計時器(tools/lesson_kit.js),
   小假 DOM(tools/engine_kit.js)與這裡的假共用元件;真的題庫、題目索引、學習包、js/pack-core.js、js/lesson-rules.js。
   組卷配額與順序、建進度與凍結同一次寫、第 1 堂不呼叫 pickFixed、只有進度沒有選題時補組卷、不寫練習紀錄、沒有上一題、
   沒答按下一題要確認、已選念出來、離開不確認、離開與時間到都把畫面上選了的寫進進度、倒數與剩 5 分 1 分、接著做與 24 小時、
   P1 照片與 P2 三顆字母鈕、只播一次、tests_v1 格式、前測結果只有 Part 答對率與那一行字、點心只給一次、逐題解析。
   不開瀏覽器、不連網。用法:node tools/test_lesson_test.js
   這支也匯出 domEnv、pageCtx 等(tools/test_lesson_personal.js 共用);被 require 時不跑測試。 */
'use strict';
const vm = require('vm');
const assert = require('assert');
const K = require('./lesson_kit.js');
const { fakeDom } = require('./engine_kit.js');

const { eq, EE, TT, NOW, DAY } = K;
const ITEM_FILES = ['js/lesson-items.js', 'js/lesson-test.js', 'js/lesson-personal.js'];

/* ---------- 假的共用元件:只做課程頁呼叫到的;確認視窗照 UI.answers 依序回答(沒排就是確定,'wait' 先不回) ---------- */
function fakeUI(dom, log) {
  const el = (tag, cls, text) => { const n = dom.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null && text !== '') n.append(String(text)); return n; };
  const action = (a, cls) => {
    const b = el(a.href ? 'a' : 'button', cls, a.label);
    if (a.href) b.setAttribute('href', a.href);
    if (typeof a.onClick === 'function') b.addEventListener('click', (ev) => a.onClick(ev));
    return b;
  };
  const UI = {
    focusApi: null, answers: [], pending: null, results: [],
    focus: {
      enter(opt) {
        const api = {
          opt, cur: 0, total: opt.total, footNodes: [], slotNode: null, said: [], gone: false,
          progress(n) { api.cur = n; }, setTotal(n) { api.total = n; }, dirty() {}, action() {}, focusMain() {}, feedback() { return null; },
          foot(nodes) { api.footNodes = [].concat(nodes || []).filter(Boolean); },
          slot(n) { api.slotNode = n; }, say(t) { api.said.push(t); log.push(['say', t]); }, keep(fn) { fn(); },
          leave() { api.gone = true; },
          /* 作答列的關閉鈕:跟真的一樣先收掉專心模式再叫 onExit */
          close() { api.leave(); if (typeof opt.onExit === 'function') opt.onExit(); },
          get active() { return !api.gone; },
        };
        UI.focusApi = api;
        log.push(['focus', opt]);
        return api;
      },
    },
    confirm(o) {
      log.push(['confirm', o]);
      let done = null;
      const p = new Promise((r) => { done = r; });
      p.cancel = () => done(false);
      const a = UI.answers.length ? UI.answers.shift() : true;
      if (a === 'wait') UI.pending = done; else done(a);
      return p;
    },
    result(o) {
      log.push(['result', o]);
      const card = el('section', 'result-card');
      if (o.kicker) card.append(el('p', 'result-kicker', o.kicker));
      const heading = el('h2', 'result-score', typeof o.score === 'number' && o.total > 0 ? o.score + ' / ' + o.total : String(o.big));
      if (o.flag) heading.append(' ', el('span', 'result-flag', o.flag));
      const reward = el('div', 'result-reward'), acts = el('div', 'result-actions');
      if (o.primary) acts.append(action(o.primary, 'btn primary result-go'));
      card.append(heading, reward, acts);
      if (o.note) card.append(el('p', 'result-note', o.note));
      const api = { el: card, reward, heading, opt: o, destroy() {} };
      UI.results.push(api);
      return api;
    },
    detail(title, nodes, opt) {
      log.push(['detail', title, opt]);
      const d = el('details', 'result-detail');
      d.append(el('summary', 'result-detail-sum', title));
      const body = el('div', 'result-detail-body');
      [].concat(nodes || []).filter(Boolean).forEach((n) => body.append(n));
      d.append(body);
      return d;
    },
    empty(o) { const b = el('div', 'ui-empty'); b.append(el('p', 'ui-empty-text', o.text)); return b; },
  };
  return UI;
}
class FakeAudio {
  constructor(src) { this.src = src; this.paused = true; this.listeners = {}; this.error = null; FakeAudio.made.push(this); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  fire(t) { (this.listeners[t] || []).forEach((f) => f({ type: t })); }
}
FakeAudio.made = [];

/* lesson_kit 的沙盒加上小假 DOM、假共用元件、假的播放、回報題目、點心掛勾,再載入題目畫面、前測、個人段三支檔 */
function domEnv(opt) {
  const o = Object.assign({ pilot: ['class-a'], bank: true, timers: 'fake' }, opt || {});
  const e = K.env(o);
  const dom = fakeDom(), log = [], win = {};
  const c = e.ctx;
  Object.assign(c, {
    document: dom, Audio: FakeAudio, scrollY: 0, scrollTo() {},
    holdForAccount: () => false, uiReady: () => true,
    addEventListener: (t, f) => { (win[t] = win[t] || []).push(f); }, removeEventListener: (t, f) => { win[t] = (win[t] || []).filter((x) => x !== f); },
    REPORT: { attach: (box, r) => log.push(['report', r]) },
    PET_HOOK: { done: (id, x) => { log.push(['pet', id, x && x.into]); return Promise.resolve(null); } },
  });
  c.UI = fakeUI(dom, log);
  if (o.tips !== false) vm.runInContext(K.read('data/tips.js'), c, { filename: 'data/tips.js' });
  if (o.pack) c.PACK_CORE = o.pack(c.PACK_CORE);
  ITEM_FILES.forEach((f) => vm.runInContext(K.read(f), c, { filename: f }));
  const main = dom.createElement('main'), host = dom.createElement('div');
  dom.body.append(main);
  main.append(host);
  return Object.assign(e, { dom, log, win, host, UI: c.UI, I: c.LESSON_ITEMS, LT: c.LESSON_TEST, LP: c.LESSON_PERSONAL });
}
/* 上課頁給的 ctx(lesson.js 的那一份);runRound、views 由呼叫的一方另外放 */
function pageCtx(e, no, lv, extra) {
  const lesson = e.lesson(lv || EE, no);
  let state = e.store.peek(e.P.lessonKey(1, no)) || null;
  const notes = [];
  return Object.assign({
    no, lesson, host: e.host, notes,
    state: () => state, setState: (s) => { state = s; },
    push: (s) => e.log.push(['push', s]), note: (lines) => notes.push(lines),
    data: e.D, items: e.I,
    now: () => e.clock.sec(), nowMs: () => e.clock.ms(), today: () => e.P.dayOf(e.clock.sec()),
  }, extra || {});
}
const settle = async (n) => { for (let i = 0; i < (n || 30); i++) await K.flush(); };
const text = (n) => (n ? n.textContent : '');
const allText = (e) => text(e.host);
/* 開始第 1 堂:組卷、建立進度(聽力測驗作答中) */
async function startTest(e, lv) {
  const pc = pageCtx(e, 1, lv);
  const picked = await e.LT.picked(pc);
  pc.setState(await e.D.start(1, pc.lesson, e.clock.sec(), 'class-a', picked));
  return pc;
}
/* 目前這一畫面每一小題都選(choose(第幾小題, 選項數) 回選項),回選了幾小題 */
function answerScreen(e, choose) {
  const pickOne = (list, i) => list[Math.min(list.length - 1, choose(i, list.length))].click();
  const letters = e.host.querySelectorAll('.letter-big');
  if (letters.length) { pickOne(letters, 0); return 1; }
  const groups = e.host.querySelectorAll('.opts');
  groups.forEach((g, i) => pickOne(g.querySelectorAll('.opt'), i));
  return groups.length;
}
const nextBtn = (e) => e.UI.focusApi.footNodes[0];
/* 一直作答到這一段交卷(專心模式收掉);limit 是最多幾個畫面 */
async function answerAll(e, choose, limit) {
  let n = 0;
  while (e.UI.focusApi && !e.UI.focusApi.gone && n < (limit || 999)) {
    answerScreen(e, choose || (() => 0));
    nextBtn(e).click();
    await settle();
    n++;
  }
  return n;
}
const rowsOf = (pc, b) => (pc.state().a || []).filter((x) => x[0] === b);
const start = (e) => e.host.querySelector('.lsn-go');

module.exports = { fakeUI, FakeAudio, domEnv, pageCtx, settle, text, allText, startTest, answerScreen, answerAll, nextBtn, rowsOf, ITEM_FILES };
if (require.main !== module) return;

const T = {};
/* ---------- 組卷 ---------- */
T['組卷:聽力 P1 3、P2 12、P3 4 組、P4 3 組,閱讀 P5 15、P6 2 組、P7 4 組,照 Part 1→7 排;上課頁 ctx 與選題 ctx 都能叫'] = async () => {
  const e = domEnv();
  const pc = pageCtx(e, 1, TT);
  const form = await e.LT.assemble(pc);
  const parts = (ids) => ids.map((id) => e.C.partOfId(id));
  const count = (ids) => parts(ids).reduce((a, p) => Object.assign(a, { [p]: (a[p] || 0) + 1 }), {});
  eq([count(form[0]), count(form[1])], [{ 1: 3, 2: 12, 3: 4, 4: 3 }, { 5: 15, 6: 2, 7: 4 }]);
  eq(parts(form[0]), parts(form[0]).slice().sort());
  eq(parts(form[1]), parts(form[1]).slice().sort());
  const viaSel = await e.LT.assemble(e.D.ctx(pc.lesson, NOW));
  eq([viaSel[0].length, viaSel[1].length], [22, 21]);
};

T['建進度與凍結 0、1 同一次寫,聽力測驗作答中;第 1 堂從頭到交卷都不呼叫 pickFixed'] = async () => {
  let calls = 0;
  const e = domEnv({ pack: (P) => Object.assign({}, P, { pickFixed: (...a) => { calls++; return P.pickFixed(...a); } }) });
  const pc = await startTest(e);
  const s = pc.state();
  eq([e.store.sets.filter((k) => k === 'les_t1_01').length, Object.keys(s.pk).sort(), s.seg.test_listening.st, s.seg.test_reading.st], [1, ['0', '1'], 'doing', 'todo']);
  await e.D.fillFixed(1, pc.lesson, s, Object.assign(e.D.ctx(pc.lesson, NOW), { assemble: e.LT.assemble }));
  const run = e.LT.run(pc);
  await settle();
  await answerAll(e);
  start(e).click();
  await settle();
  await answerAll(e);
  eq([await run, calls], ['done', 0]);
};

T['建進度後、組卷前關頁再開頁(只有進度沒有選題):開頁補組卷,前測有題'] = async () => {
  const e = domEnv();
  const l1 = e.lesson(EE, 1);
  const half = e.P.setSegment(e.P.newState(l1, NOW), l1, 'test_listening', 'doing', NOW);
  e.store.set('les_t1_01', half);
  const pc = pageCtx(e, 1);
  pc.setState(await e.D.fillFixed(1, l1, pc.state(), Object.assign(e.D.ctx(l1, NOW), { assemble: e.LT.assemble })));
  eq([pc.state().pk[0].ids.length, pc.state().pk[1].ids.length, pc.state().startedAt], [22, 21, NOW]);
  const run = e.LT.run(pc);
  await settle();
  assert.ok(e.host.querySelector('.q-block'), '有題目');
  assert.ok(/Part 1/.test(allText(e)));
  e.UI.focusApi.close();
  assert.equal(await run, 'exit');
};

/* ---------- 作答 ---------- */
T['前測不寫作答紀錄、學習記錄、模擬考紀錄、考點、回顧:只寫這一堂的進度、plan、tests_v1;作答時不對答案'] = async () => {
  const e = domEnv();
  const pc = await startTest(e);
  const before = e.store.sets.length;
  const run = e.LT.run(pc);
  await settle();
  answerScreen(e, () => 1);
  assert.equal(e.host.querySelectorAll('.correct').length + e.host.querySelectorAll('.wrong').length, 0, '作答中不上色');
  await answerAll(e, () => 1);
  start(e).click();
  await settle();
  await answerAll(e, () => 2);
  assert.equal(await run, 'done');
  await e.D.flush();
  const keys = Array.from(new Set(e.store.sets.slice(before)));
  eq(keys.sort(), ['les_t1_01', 'tests_v1']);
  ['drill_p5', 'listen_p1', 'hist', 'mock_history', 'mock_wrong', 'pts', 'rvq'].forEach((k) => assert.equal(e.store.peek(k), undefined, k));
};

T['沒有上一題:底部只有一顆實色鈕「下一題」,最後一畫面是「交卷」;進度是小題數'] = async () => {
  const e = domEnv();
  const pc = await startTest(e);
  const run = e.LT.run(pc);
  await settle();
  const f = e.UI.focusApi;
  eq([f.footNodes.length, text(f.footNodes[0]), f.footNodes[0].className, f.total, f.cur, /上一題/.test(allText(e))], [1, '下一題', 'btn primary', 36, 1, false]);
  await answerAll(e, () => 0, 21);
  eq([text(nextBtn(e)), f.cur], ['交卷', 36]);
  f.close();
  assert.equal(await run, 'exit');
};

T['沒選答案按下一題要先確認(一題、一組、最後交卷三種字);按「繼續作答」留在同一題、什麼都沒寫'] = async () => {
  const e = domEnv();
  const pc = await startTest(e);
  const run = e.LT.run(pc);
  await settle();
  e.UI.answers.push(false);
  nextBtn(e).click();
  await settle();
  const ask = e.log.filter((x) => x[0] === 'confirm').map((x) => x[1]);
  eq(ask[0], { title: '這一題還沒答', body: '未作答的算錯', ok: '下一題', cancel: '繼續作答' });
  eq([rowsOf(pc, 0).length, e.UI.focusApi.cur], [0, 1]);
  nextBtn(e).click();
  await settle();
  const r = rowsOf(pc, 0)[0];
  eq([r[2], r[3], r[4] & 1], [0, -1, 0], '沒選的寫 c -1、算錯');
  await answerAll(e, () => 0, 14);
  e.host.querySelectorAll('.opts')[0].querySelectorAll('.opt')[1].click();
  nextBtn(e).click();
  await settle();
  eq(e.log.filter((x) => x[0] === 'confirm').map((x) => x[1].title).pop(), '這一組還有 2 題沒答');
  await answerAll(e, () => 0, 5);
  e.host.querySelectorAll('.opts')[0].querySelectorAll('.opt')[0].click();
  nextBtn(e).click();
  await settle();
  const last = e.log.filter((x) => x[0] === 'confirm').map((x) => x[1]).pop();
  eq([last.title, last.ok], [/還有 \d 題沒答完/.test(last.title) ? last.title : '?', '交卷']);
  await settle();
  e.UI.focusApi && !e.UI.focusApi.gone ? e.UI.focusApi.close() : null;
  start(e) ? e.host.querySelector('.lsn-back').click() : null;
  assert.equal(await run, 'exit');
};

T['選答案:選到的 aria-pressed、讀屏念「已選 B」、可以改;P1 有照片、四顆字母鈕;P2 三顆字母鈕;播放鈕只播一次'] = async () => {
  const e = domEnv();
  const pc = await startTest(e);
  const run = e.LT.run(pc);
  await settle();
  const id = pc.state().pk[0].ids[0];
  const img = e.host.querySelector('img');
  eq([img.getAttribute('src'), img.getAttribute('alt'), e.host.querySelectorAll('.letter-big').length], ['img/listening/' + id + '.jpg', '聽力照片', 4]);
  const play = e.host.querySelector('.player-btn');
  eq([text(play), e.host.querySelector('.lsn-play-icon').getAttribute('aria-hidden')], ['▶播放 · 限一次', 'true']);
  play.click();
  eq([FakeAudio.made.pop().src, text(play), play.disabled], ['audio/' + id + '.mp3', '▶已播放', true]);
  e.host.querySelectorAll('.letter-big')[1].click();
  let pressed = e.host.querySelectorAll('.letter-big').map((b) => b.getAttribute('aria-pressed'));
  eq([pressed, e.UI.focusApi.said.pop()], [['false', 'true', 'false', 'false'], '已選 B']);
  e.host.querySelectorAll('.letter-big')[3].click();
  pressed = e.host.querySelectorAll('.letter-big').map((b) => b.getAttribute('aria-pressed'));
  eq([pressed, e.UI.focusApi.said.pop(), e.host.querySelector('.player-btn').disabled], [['false', 'false', 'false', 'true'], '已選 D', true]);
  await answerAll(e, () => 0, 3);
  eq([e.host.querySelectorAll('.letter-big').length, !!e.host.querySelector('img'), /Part 2/.test(allText(e))], [3, false, true]);
  const p2 = e.host.querySelector('.player-btn');
  FakeAudio.made.length = 0;
  p2.click();
  FakeAudio.made[0].fire('error');
  eq([text(p2), p2.disabled], ['▶找不到音檔', true]);
  e.host.querySelectorAll('.letter-big')[2].click();
  nextBtn(e).click();
  await settle();
  eq(rowsOf(pc, 0).length, 4, '音檔載不到照樣可以作答');
  e.UI.focusApi.close();
  await run;
};

T['離開不確認;離開與時間到都先把畫面上選了、還沒按下一題的小題寫進進度'] = async () => {
  const e = domEnv();
  const pc = await startTest(e);
  let run = e.LT.run(pc);
  await settle();
  eq(e.UI.focusApi.opt.confirmExit, false);
  e.host.querySelectorAll('.letter-big')[2].click();
  e.UI.focusApi.close();
  assert.equal(await run, 'exit');
  eq([rowsOf(pc, 0).length, rowsOf(pc, 0)[0][3], e.log.filter((x) => x[0] === 'confirm').length], [1, 2, 0]);
  run = e.LT.run(pc);
  await settle();
  e.host.querySelectorAll('.letter-big')[0].click();
  e.tick(1014 * 1000);
  await settle();
  eq([await run, pc.notes.pop(), rowsOf(pc, 0).length, pc.state().seg.test_listening.st, e.UI.focusApi.said.pop()], ['exit', ['聽力測驗時間到'], 2, 'done', '時間到']);
};

T['倒數:36 題 16:54 起,剩不到 5 分鐘變紅、剩 5 分與 1 分各念一次,時間到自動交卷'] = async () => {
  const e = domEnv();
  const pc = await startTest(e);
  const run = e.LT.run(pc);
  await settle();
  const t = e.UI.focusApi.slotNode;
  eq([text(t), t.getAttribute('role'), t.getAttribute('aria-label'), t.classList.contains('low')], ['16:54', 'timer', '剩餘時間', false]);
  e.tick((1014 - 301) * 1000);
  eq([text(t), t.classList.contains('low')], ['5:01', false]);
  e.tick(2000);
  eq([text(t), t.classList.contains('low')], ['4:59', true]);
  e.tick(240 * 1000);
  const said = () => e.UI.focusApi.said.filter((x) => /^剩/.test(x));
  eq(said(), ['剩 5 分鐘', '剩 1 分鐘']);
  e.tick(60 * 1000);
  await settle();
  eq([said(), await run, pc.state().seg.test_listening.st], [['剩 5 分鐘', '剩 1 分鐘'], 'exit', 'done']);
};

T['接著做:從第一個沒答的題、倒數從剩餘時間開始,離開到回來之間不算;這個分頁記的最後畫面時間比最後作答晚時用它'] = async () => {
  const e = domEnv();
  const pc = await startTest(e);
  let run = e.LT.run(pc);
  await settle();
  await answerAll(e, () => 0, 9);
  e.tick(10 * 1000);
  await answerAll(e, () => 0, 1);
  e.tick(20 * 1000);
  e.UI.focusApi.close();
  await run;
  e.clock.add(3600);
  const left = await e.LT.info(pc);
  eq([left.test_listening.n, left.test_listening.minutes, left.test_listening.left, left.test_reading.n > 30], [36, 17, Math.ceil((1014 - 30) / 60), true]);
  const seen = e.ss.map.get('lsn_clock');
  e.ss.map.delete('lsn_clock');
  run = e.LT.run(pageCtx(e, 1));
  await settle();
  eq([e.UI.focusApi.cur, text(e.UI.focusApi.slotNode)], [11, '16:44'], '沒有最後畫面時間:退回用最後作答時間');
  e.UI.focusApi.close();
  await run;
  e.ss.map.set('lsn_clock', seen);
  run = e.LT.run(pageCtx(e, 1));
  await settle();
  eq([e.UI.focusApi.cur, text(e.UI.focusApi.slotNode)], [11, '16:24']);
  e.UI.focusApi.close();
  await run;
};

T['超過 24 小時:開頁時自動交卷、通知兩行;時間用完(不到 24 小時)也交卷;回總覽的段剩幾分鐘'] = async () => {
  const e = domEnv();
  const pc = await startTest(e);
  e.clock.add(DAY + 5);
  const x = await e.LT.expire(pc);
  eq([x.lines, x.finished, pc.state().seg.test_listening.st], [['聽力測驗超過 24 小時', '已自動交卷'], false, 'done']);
  const e2 = domEnv();
  const p2 = await startTest(e2);
  e2.clock.add(1020);
  e2.D.clock('les_t1_01', 'test_listening').touch();
  e2.clock.add(7200);
  eq([(await e2.LT.expire(p2)).lines, p2.state().seg.test_listening.st], [['聽力測驗時間到'], 'done']);
  const e3 = domEnv();
  const p3 = await startTest(e3);
  e3.clock.add(500);
  e3.D.clock('les_t1_01', 'test_listening').touch();
  e3.clock.add(7200);
  eq([(await e3.LT.expire(p3)).lines, p3.state().seg.test_listening.st, (await e3.LT.info(p3)).test_listening.left], [[], 'doing', 9], '沒有動靜的時間不算');
};

/* ---------- 交卷、紀錄、結果 ---------- */
/* 做完聽力測驗(停在閱讀測驗開始頁);回 { run }(不能直接回 run:async 函式回 Promise 會等它) */
async function finishTest(e, pc, choose) {
  const run = e.LT.run(pc);
  await settle();
  await answerAll(e, choose);
  return { run };
}
T['閱讀測驗開始頁:標題、題數與分鐘標籤、一行說明、開始;「← 回第 1 堂」回總覽'] = async () => {
  const e = domEnv();
  const pc = await startTest(e);
  const { run } = await finishTest(e, pc, () => 0);
  const h = e.host.querySelector('h2');
  const tags = e.host.querySelectorAll('.mock-tag').map(text);
  eq([text(h), h.getAttribute('tabindex'), tags.length, /題$/.test(tags[0]), /分鐘$/.test(tags[1]), text(e.host.querySelector('.lsn-rule')), text(start(e))],
    ['閱讀測驗', '-1', 2, true, true, '開始後不能回上一題', '開始']);
  eq([text(e.host.querySelector('.lsn-back')), e.dom.activeElement === h, pc.state().seg.test_reading.st], ['← 回第 1 堂', true, 'todo']);
  e.host.querySelector('.lsn-back').fire('click');
  assert.equal(await run, 'exit');
};

T['tests_v1:兩段都交卷才寫、只寫一次;{ form, at, parts, items[[id, 小題, 選項, 對錯]] },沒作答的 c -1;第一次作答照作答前的紀錄'] = async () => {
  const e = domEnv();
  const pc = await startTest(e);
  const first = pc.state().pk[0].ids[0];
  e.store.set('listen_p1', { [first]: { c: 0, ok: true, t: NOW * 1000 - 5 * K.DAY_MS } });
  let { run } = await finishTest(e, pc, () => 0);
  await e.D.flush();
  assert.equal(e.store.peek('tests_v1'), undefined, '聽力交卷還不寫');
  start(e).click();
  await settle();
  await answerAll(e, (i) => (i === 0 ? 1 : 0), 3);
  nextBtn(e).click();
  e.UI.answers.push(true);
  await settle();
  await answerAll(e, () => 0);
  assert.equal(await run, 'done');
  await e.D.flush();
  const pre = e.store.peek('tests_v1').t1.pre;
  const s = pc.state();
  eq([pre.form, pre.at, Object.keys(pre.parts).sort(), pre.parts.P1.n, pre.parts.P3.n >= 12], ['interim_half', s.doneAt, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'], 3, true]);
  const n = Object.keys(pre.parts).reduce((a, k) => a + pre.parts[k].n, 0);
  eq([pre.items.length, pre.items.every((x) => x.length === 4)], [n, true]);
  assert.ok(pre.items.some((x) => x[2] === -1 && x[3] === false), '沒作答的 c -1');
  eq([(s.a.filter((x) => x[1] === first)[0][4] & 2), (s.a.filter((x) => x[1] === pc.state().pk[0].ids[1])[0][4] & 2)], [0, 2], '做過的不是第一次');
  const sets = e.store.sets.filter((k) => k === 'tests_v1').length;
  await e.LT.result(pc, { first: false });
  await e.D.flush();
  eq(e.store.sets.filter((k) => k === 'tests_v1').length, sets, '重看不再寫');
};

T['前測結果:鵜鶘 happy、第 1 堂、前測完成、主按鈕「繼續」回課程總覽、「暫用試卷」那一行、各 Part 答對率;沒有分數、預估、題數、正解'] = async () => {
  const e = domEnv();
  const pc = await startTest(e);
  const { run } = await finishTest(e, pc, () => 0);
  start(e).click();
  await settle();
  await answerAll(e, () => 0);
  assert.equal(await run, 'done');
  const r = e.UI.results.pop();
  eq([r.opt.kicker, r.opt.big, r.opt.pose, r.opt.flag, r.opt.primary.label, r.opt.primary.href, r.opt.score, r.opt.stats], ['第 1 堂', '前測完成', 'happy', null, '繼續', 'lessons.html', undefined, undefined]);
  eq([text(e.host.querySelector('.mock-tag')), text(e.host.querySelector('.lsn-tag-note'))], ['暫用試卷', '不能跟之後的測驗直接比較']);
  const rows = e.host.querySelectorAll('.lsn-row').map(text);
  eq(rows.map((x) => x.replace(/[\d—]+%?$/, '')), ['Part 1 照片描述', 'Part 2 應答', 'Part 3 簡短對話', 'Part 4 簡短獨白', 'Part 5 單句填空', 'Part 6 段落填空', 'Part 7 閱讀理解']);
  assert.ok(rows.every((x) => /(\d{1,3}%|—)$/.test(x)), rows.join(','));
  eq(e.host.querySelectorAll('.me-sec-h').map(text), ['聽力', '閱讀']);
  const all = allText(e);
  assert.equal(/分(?!鐘)|預估|題|正解|\//.test(all), false, all);
  eq([e.dom.activeElement === r.heading, e.log.filter((x) => x[0] === 'pet').map((x) => [x[1], x[2] === r.reward])], [true, [['les_t1_01', true]]]);
  await e.LT.result(pc, {});
  await e.LT.result(pc, { first: false });
  eq(e.log.filter((x) => x[0] === 'pet').length, 1, '點心只給一次');
};

T['閱讀時間到交卷:結果標題旁「時間到」;開頁時 24 小時自動交卷讓這一堂上完時 finished 是 true'] = async () => {
  const e = domEnv();
  const pc = await startTest(e);
  const { run } = await finishTest(e, pc, () => 0);
  start(e).click();
  await settle();
  e.tick(2000 * 1000);
  await settle();
  eq([await run, e.UI.results.pop().opt.flag], ['done', '時間到']);
  const e2 = domEnv();
  const p2 = await startTest(e2);
  const { run: r2 } = await finishTest(e2, p2, () => 0);
  start(e2).click();
  await settle();
  e2.UI.focusApi.close();
  await r2;
  e2.clock.add(DAY + 60);
  const x = await e2.LT.expire(p2);
  eq([x.lines, x.finished, !!p2.state().doneAt], [[], true, true], '閱讀的通知不放總覽,放在前測結果上');
  await e2.LT.result(p2, { first: x.finished });
  const note = e2.host.querySelector('.lsn-note');
  eq([e2.UI.results.pop().opt.flag, note && note.querySelectorAll('.lsn-note-line').map(text), note && note.getAttribute('tabindex'), e2.dom.activeElement === note, e2.host.firstChild === note],
    [null, ['閱讀測驗超過 24 小時', '已自動交卷'], '-1', true, true], '超過 24 小時不是時間到:標題旁不放「時間到」,結算卡上方通知、焦點在通知');
};

T['閱讀測驗超過 24 小時:總覽留著沒按、隔天才按「繼續」時也是自動交卷,前測結果上方通知、沒有「時間到」'] = async () => {
  const e = domEnv();
  const pc = await startTest(e);
  const { run } = await finishTest(e, pc, () => 0);
  start(e).click();
  await settle();
  e.UI.focusApi.close();
  assert.equal(await run, 'exit');
  e.clock.add(DAY + 60);
  assert.equal(await e.LT.run(pc), 'done');
  const note = e.host.querySelector('.lsn-note');
  eq([e.UI.results.pop().opt.flag, note && text(note), e.dom.activeElement === note, pc.notes], [null, '閱讀測驗超過 24 小時已自動交卷', true, []]);
};

/* ---------- 逐題解析 ---------- */
T['逐題解析:P1–P7 選項上色、未作答寫「未作答 · 正解」、每題回報題目(作答紀錄的鍵)、聽力有播放鈕與逐字稿、題組全文翻譯可展開'] = async () => {
  const e = domEnv();
  const ids = ['l1-01', 'l2-01', 'l3-11', 'l4-11', 'p5-b1-01', 'p6-b1-1', 'p7-b1-1'];
  const got = await e.B.get(ids);
  const units = got.map((item, i) => ({ p: e.C.partOfId(ids[i]), item }));
  const ans = new Map([['l1-01', { c: 2, ok: true }], ['l2-01', { c: 1, ok: false }], ['l3-11:0', { c: 0, ok: false }], ['p6-b1-1:1', { c: 2, ok: true }]]);
  const nodes = e.I.review(units, ans);
  eq(nodes.length, 7);
  e.host.replaceChildren(...nodes);
  const reports = e.log.filter((x) => x[0] === 'report').map((x) => x[1].m + ':' + x[1].id);
  eq(reports.slice(0, 3), ['l1:l1-01', 'l2:l2-01', 'l3:l3-11:0']);
  assert.ok(reports.indexOf('p6:p6-b1-1:1') > -1 && reports.indexOf('p7:p7-b1-1:0') > -1 && reports.indexOf('p5:p5-b1-01') > -1, reports.join(' '));
  const verdicts = e.host.querySelectorAll('.verdict').map(text);
  eq(verdicts.slice(0, 3), ['答對', '答錯 · 正解 ' + 'ABCD'[got[1].answer], '答錯 · 正解 ' + 'ABCD'[got[2].questions[0].answer]]);
  assert.ok(verdicts.some((v) => /^未作答 · 正解 [A-D]$/.test(v)));
  eq([nodes[0].querySelectorAll('.letter-big.correct').length, nodes[1].querySelectorAll('.letter-big.wrong').length, nodes[4].querySelectorAll('.opt.correct').length], [1, 1, 1]);
  eq([nodes.slice(0, 4).every((n) => n.querySelector('.player-btn') && n.querySelector('.transcript-box')), nodes[4].querySelector('.player-btn')], [true, null]);
  const tr = nodes[6].querySelector('.lsn-tr-btn'), box = nodes[6].querySelector('.set-translation');
  eq([tr.getAttribute('aria-expanded'), box.hidden], ['false', true]);
  tr.click();
  eq([tr.getAttribute('aria-expanded'), box.hidden], ['true', false]);
  const p1 = nodes[0].querySelector('.player-btn');
  p1.click();
  p1.click();
  eq([text(p1), FakeAudio.made.slice(-2).map((a) => a.src)], ['▶再播一次', ['audio/l1-01.mp3', 'audio/l1-01.mp3']]);
  nodes.stop();
  assert.ok(FakeAudio.made.slice(-1)[0].paused);
  const rows = [[0, 'l1-01', 0, 1, 3, 5], [0, 'l3-11', 2, 3, 2, 9]];
  eq(Array.from(e.I.answersOf(units, rows).entries()), [['l1-01', { c: 1, ok: true }], ['l3-11:1', { c: 3, ok: false }]]);
};

T['小檢核清單與圖示:一個考點一列、達標勾、持平橫線、弱點圓點,字照舊,沒有數字;Part 清單 n 是 0 寫「—」'] = () => {
  const e = domEnv();
  const ul = e.I.verdicts([{ name: '照片描述', verdict: 'met' }, { name: 'WH 問句', verdict: 'hold' }, { name: '詞性', verdict: 'weak' }]);
  eq(ul.querySelectorAll('.lsn-row').map(text), ['照片描述達標', 'WH 問句持平', '詞性弱點']);
  eq(ul.querySelectorAll('.lsn-v-tag').map((t) => t.className), ['lsn-v-tag is-met', 'lsn-v-tag is-hold', 'lsn-v-tag is-weak']);
  const icons = ul.querySelectorAll('svg');
  eq([icons.length, icons.every((s) => s.getAttribute('aria-hidden') === 'true' && s.getAttribute('stroke-width') === '2.2'), icons[0].querySelector('path').getAttribute('d'), !!icons[2].querySelector('circle')],
    [3, true, 'm5 12.5 4.5 4.5L19 7.5', true]);
  assert.equal(/\d/.test(text(ul)), false);
  const p = e.I.parts({ P1: { n: 3, ok: 2 }, P2: { n: 0, ok: 0 } });
  eq(p.querySelectorAll('.me-row-val').map(text), ['67%', '—', '—', '—', '—', '—', '—']);
};

/* 有一支在等永遠不會回來的 Promise 時,node 會在印出通過數之前就結束:算失敗 */
process.on('beforeExit', () => { console.log('FAIL 有一支測試一直沒有結束'); process.exit(1); });
K.run(T);
