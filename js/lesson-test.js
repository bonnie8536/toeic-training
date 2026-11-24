/* 第 1 堂的前測(lesson.html?no=1):組卷、閱讀測驗開始頁、作答(不對答、不能回上一題、聽力音檔只播一次)、倒數、
   離開與接著做、時間到與超過 24 小時自動交卷、前測紀錄 tests_v1、前測結果。
   ctx 由 js/lesson.js 給:{ no, lesson, host, state(), setState(s), push(step), notify(lines), data: LESSON_DATA, items: LESSON_ITEMS, now(), nowMs(), today() }。
   notify(lines) 是選填的:回總覽時要放在通知列的字(聽力測驗時間到、超過 24 小時)。
   window.LESSON_TEST = {
     assemble(ctx)  組卷 → Promise<{ 0: 聽力 ids, 1: 閱讀 ids }>;ctx 可以是上課頁的 ctx,或選題的 ctx(LESSON_DATA.fillFixed 補組卷時這樣叫)
     picked(ctx)    組卷後凍結 0、1 兩格的新進度(還沒寫):按「開始」時交給 LESSON_DATA.start,建立進度與凍結同一次寫
     run(ctx)       接著做前測 → Promise<'exit'|'done'>:'exit' 回總覽(離開、聽力時間到);'done' 兩段都交卷,畫面已經是前測結果(不要再換畫面)
     result(ctx, { first })  前測結果;first 沒給時看這一期有沒有前測紀錄(沒有＝第一次看到,補寫紀錄並給點心);first: false 只補寫紀錄、不給點心
     info(ctx)      總覽要的 → Promise<{ test_listening: { n 題數, minutes 限時, left 剩幾分鐘(作答中才有) } | null, test_reading: … }>
     expire(ctx)    開頁時:作答中的段超過 24 小時或時間用完就交卷 → Promise<{ lines(通知列的字), finished(這一次交卷讓這一堂上完了) }>
   }
   前測不寫作答紀錄(drill_p*、listen_p*)、學習記錄、模擬考紀錄、考點狀態、回顧佇列:只寫這一堂的進度,兩段都交卷後寫一次 tests_v1。
   時間:限時照實際題數換算(LESSON_CORE.testLimit);剩餘＝限時 −(最後活動 − 段開始),最後活動是最後一題的作答時間與這個分頁記的最後畫面時間取晚的,
   離開到回來之間不算。超過 24 小時沒有動靜就自動交卷,沒答的算錯。 */
(function (root) {
  'use strict';
  const SLOTS = ['test_listening', 'test_reading'];
  const TOUCH_MS = 15000, LOW_MS = 300000, ONE_MS = 60000;
  const core = () => root.LESSON_CORE;
  const TX = () => core().TEXT;
  const itemsOf = (ctx) => ctx.items || root.LESSON_ITEMS;
  const given = new Set();      // 這一頁已經給過點心的進度鍵:同一頁重畫結果時不再叫一次
  const timedOut = new Set();   // 這一頁裡閱讀測驗時間到交卷的進度鍵:結果標題旁放「時間到」

  function node(tag, cls, text, attrs) {
    const n = root.document.createElement(tag);
    if (cls) n.className = cls;
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    if (text) n.append(String(text));
    return n;
  }
  function termOf(D) {
    const p = D && typeof D.plan === 'function' ? D.plan() : null;
    return p && Number.isInteger(p.term) && p.term >= 1 && p.term <= 99 ? p.term : 1;
  }
  const keyOf = (ctx) => core().lessonKey(termOf(ctx.data), ctx.no);
  const finished = (st, slot) => !!(st && st.seg && st.seg[slot] && (st.seg[slot].st === 'done' || st.seg[slot].st === 'skip'));
  const hold = (btn) => typeof root.holdForAccount === 'function' && root.holdForAccount(btn);
  function notify(ctx, lines) { if (lines.length && typeof ctx.notify === 'function') ctx.notify(lines); }
  function focusHead(h) {
    try { if (typeof root.scrollTo === 'function') root.scrollTo(0, 0); h.focus({ preventScroll: true }); } catch (e) { /* 焦點放不上去不影響作答 */ }
  }

  /* ---------- 組卷與題目 ---------- */
  function assemble(arg) {
    const page = !!(arg && arg.data && arg.lesson);
    const D = page ? arg.data : root.LESSON_DATA;
    return D.testForm(page ? D.ctx(arg.lesson, arg.now()) : arg);
  }
  async function picked(ctx) {
    const P = root.PACK_CORE, now = ctx.now();
    const form = await assemble(ctx);
    return [0, 1].reduce((s, i) => P.freeze(s, i, form[i] || [], now), P.newState(ctx.lesson, now));
  }
  /* 一段的卷:凍結的題裡找得到的(被淘汰的略過、不算題數),題數展開成小題,限時照題數換算 */
  async function paper(ctx, slot) {
    const Q = core().TEST_QUOTA[slot], st = ctx.state();
    const ids = st && st.pk && st.pk[Q.idx] && Array.isArray(st.pk[Q.idx].ids) ? st.pk[Q.idx].ids : [];
    const got = ids.length ? await root.BANK.get(ids) : [];
    const units = [];
    got.forEach((item, i) => {
      if (item) units.push({ p: core().partOfId(ids[i]), item });
      else console.warn('找不到這一題，略過：' + ids[i]);
    });
    const n = units.reduce((a, u) => a + itemsOf(ctx).subsOf(u).length, 0);
    return { slot, idx: Q.idx, units, n, limit: core().testLimit(slot, n) };
  }
  function resumeOf(ctx, pp) {
    const st = ctx.state(), seg = (st.seg && st.seg[pp.slot]) || {};
    const t0 = seg.t0 || st.startedAt;
    const last = (st.a || []).filter((x) => x[0] === pp.idx).reduce((a, x) => Math.max(a, st.startedAt + x[5]), t0);
    const seen = ctx.data.clock(keyOf(ctx), pp.slot).last();
    return core().testResume({ limit: pp.limit, t0, lastAt: Math.max(last, seen || 0), now: ctx.now() });
  }
  async function setSeg(ctx, slot, st) {
    const s = await ctx.data.segment(ctx.no, ctx.lesson, slot, st, ctx.now());
    ctx.setState(s);
    return s;
  }
  function autoLines(slot, r) {
    const X = TX().lesson, listening = slot === 'test_listening';
    if (r.expired) return [listening ? X.overListening : X.overReading, X.autoSubmitted];
    return listening ? [X.timeUpListening] : [];
  }

  async function info(ctx) {
    const out = {};
    for (const slot of SLOTS) {
      const st = ctx.state();
      if (!st || !st.pk || !st.pk[core().TEST_QUOTA[slot].idx]) { out[slot] = null; continue; }
      const pp = await paper(ctx, slot), seg = st.seg && st.seg[slot];
      out[slot] = { n: pp.n, minutes: Math.round(pp.limit / 60), left: seg && seg.st === 'doing' ? Math.ceil(resumeOf(ctx, pp).remaining / 60) : null };
    }
    return out;
  }
  async function expire(ctx) {
    const lines = [], was = ctx.state();
    if (!was || !ctx.lesson || ctx.lesson.kind !== 'test') return { lines, finished: false };
    for (const slot of SLOTS) {
      const st = ctx.state(), seg = st.seg && st.seg[slot];
      if (!seg || seg.st !== 'doing' || !st.pk || !st.pk[core().TEST_QUOTA[slot].idx]) continue;
      const r = resumeOf(ctx, await paper(ctx, slot));
      if (!r.expired && r.remaining > 0) continue;
      await setSeg(ctx, slot, 'done');
      if (slot === 'test_reading') timedOut.add(keyOf(ctx));
      autoLines(slot, r).forEach((l) => lines.push(l));
    }
    return { lines, finished: !was.doneAt && !!ctx.state().doneAt };
  }

  /* ---------- 接著做 ---------- */
  async function run(ctx) {
    if (typeof root.uiReady === 'function' && !root.uiReady()) return 'exit';
    for (const slot of SLOTS) {
      if (finished(ctx.state(), slot)) continue;
      const pp = await paper(ctx, slot);
      if (!ctx.state().seg[slot] || ctx.state().seg[slot].st === 'todo') {
        if (slot === 'test_reading' && (await readingStart(ctx, pp)) !== 'start') return 'exit';
        await setSeg(ctx, slot, 'doing');
      }
      const r = resumeOf(ctx, pp);
      const how = r.expired || r.remaining <= 0 ? 'auto' : await sit(ctx, pp, r.remaining);
      if (how === 'exit') return 'exit';
      await setSeg(ctx, slot, 'done');
      if (how === 'done') continue;
      if (slot === 'test_reading') { timedOut.add(keyOf(ctx)); continue; }
      notify(ctx, how === 'auto' ? autoLines(slot, r) : [TX().lesson.timeUpListening]);
      return 'exit';
    }
    await result(ctx, { first: true });
    return 'done';
  }
  /* 閱讀測驗開始頁(換科的過場,不計時) */
  function readingStart(ctx, pp) {
    return new Promise((resolve) => {
      const X = TX().test;
      const v = itemsOf(ctx).intro({
        back: { label: TX().lesson.backTo(ctx.no), href: 'lesson.html?no=' + ctx.no, onClick: () => resolve('exit') },
        title: X.reading, tags: [X.count(pp.n), X.min(Math.round(pp.limit / 60))], rule: X.noBack, start: X.start,
        onStart: (btn) => { if (!hold(btn)) resolve('start'); },
      });
      ctx.host.replaceChildren(v.el);
      if (typeof ctx.push === 'function') ctx.push('test_reading');
      focusHead(v.heading);
    });
  }

  /* ---------- 作答 ---------- */
  function sit(ctx, pp, remaining) {
    return new Promise((resolve) => session(ctx, pp, remaining, resolve));
  }
  /* 已經寫進進度的小題:[單元] → { 小題: 選項 } */
  function lockedOf(st, pp, I) {
    const rows = new Map((st.a || []).filter((x) => x[0] === pp.idx).map((x) => [x[1] + '|' + (x[2] || 0), x[3]]));
    return pp.units.map((u) => I.subsOf(u).reduce((o, k) => {
      const k2 = u.item.id + '|' + k.sub;
      if (rows.has(k2)) o[k.sub] = rows.get(k2);
      return o;
    }, {}));
  }
  /* 第一次作答:作答前作答紀錄裡沒有這一小題(前測不寫作答紀錄,開考時與交卷時一樣) */
  function firstMap(D, units, I) {
    const out = new Map();
    units.forEach((u) => {
      const keys = I.subsOf(u).map((k) => k.key), had = D.snapshot(u.p, keys);
      keys.forEach((k) => out.set(k, !had.has(k)));
    });
    return out;
  }
  const answerOf = (u, qi) => (u.p === '1' || u.p === '2' || u.p === '5' ? u.item.answer : u.item.questions[qi].answer);

  /* 一段作答的狀態:S.cur 目前的畫面、S.sel 這一畫面還沒定案的選擇、S.locked 已經寫進進度的小題 */
  function session(ctx, pp, remaining, resolve) {
    const I = itemsOf(ctx), units = pp.units, locked = lockedOf(ctx.state(), pp, I);
    const cur = units.findIndex((u, i) => I.subsOf(u).some((k) => !(k.sub in locked[i])));
    if (cur < 0) { resolve('done'); return; }
    const S = {
      ctx, pp, I, X: TX().test, units, locked, cur, resolve, first: firstMap(ctx.data, units, I),
      sel: {}, over: false, asking: null, timer: 0, touched: 0, prev: remaining * 1000,
      players: units.map(() => ({})), playerOf: [], clock: ctx.data.clock(keyOf(ctx), pp.slot), deadline: Date.now() + remaining * 1000,
    };
    S.timerEl = node('span', 'mock-timer', '', { role: 'timer', 'aria-label': S.X.timer });
    S.f = root.UI.focus.enter({ total: pp.n, confirmExit: false, onExit: () => { save(S, false); end(S, 'exit'); } });
    S.f.slot(S.timerEl);
    S.onVis = () => { if (root.document.visibilityState === 'hidden') touch(S); else check(S); };
    S.onHide = () => touch(S);
    S.onShow = () => check(S);
    listen(S, true);
    draw(S);
    loop(S);
    S.f.focusMain();
  }
  function playerFor(S, i) {
    if (Number(S.units[i].p) > 4) return null;
    if (!S.playerOf[i]) S.playerOf[i] = S.I.oncePlayer(S.units[i].item.id, S.players[i]);
    return S.playerOf[i].el;
  }
  function draw(S) {
    const pick = (sub, c) => pickOne(S, sub, c);
    S.ctx.host.replaceChildren(S.I.testView(S.units[S.cur], S.sel, pick, { player: playerFor(S, S.cur), locked: S.locked[S.cur] }));
    S.f.progress(S.units.slice(0, S.cur + 1).reduce((a, u) => a + S.I.subsOf(u).length, 0));
    const last = S.cur === S.units.length - 1;
    const b = node('button', 'btn primary', last ? S.X.submit : S.X.next, { type: 'button' });
    b.addEventListener('click', () => next(S, b));
    S.f.foot([b]);
  }
  /* 選答案:可以改,按下一題才定案;焦點回到同一顆,讀屏念「已選 B」 */
  function pickOne(S, sub, c) {
    if (S.over) return;
    S.sel[sub] = c;
    const y = root.scrollY;
    S.f.keep(() => draw(S));
    if (typeof root.scrollTo === 'function' && typeof y === 'number') root.scrollTo(0, y);
    S.f.say(S.X.picked(S.I.LETTERS[c]));
  }
  /* 這一畫面還有沒選的小題時先問;最後一畫面是「交卷」 */
  function next(S, btn) {
    if (S.over || S.asking || hold(btn)) return;
    const X = S.X, last = S.cur === S.units.length - 1;
    const n = S.I.subsOf(S.units[S.cur]).filter((k) => !(k.sub in S.locked[S.cur]) && !(k.sub in S.sel)).length;
    if (!n) { advance(S); return; }
    const set = S.I.subsOf(S.units[S.cur]).length > 1;
    S.asking = root.UI.confirm({ title: last ? X.blankAll(n) : set ? X.blankSet(n) : X.blankOne, body: X.blankBody, ok: last ? X.submit : X.next, cancel: X.keepGoing });
    S.asking.then((yes) => { S.asking = null; if (yes && !S.over) advance(S); });
  }
  function advance(S) {
    save(S, true);
    if (S.playerOf[S.cur]) S.playerOf[S.cur].stop();
    if (S.cur === S.units.length - 1) { end(S, 'done'); return; }
    S.cur += 1;
    S.sel = {};
    draw(S);
    if (typeof root.scrollTo === 'function') root.scrollTo(0, 0);
    S.f.focusMain();
  }
  /* 這一畫面的小題寫進進度(只寫本機);withBlanks:沒選的也寫(c -1、算錯) */
  function save(S, withBlanks) {
    const u = S.units[S.cur], lock = S.locked[S.cur], t = S.ctx.now(), rows = [];
    S.I.subsOf(u).forEach((k) => {
      if (k.sub in lock) return;
      const c = k.sub in S.sel ? S.sel[k.sub] : withBlanks ? -1 : null;
      if (c === null) return;
      rows.push({ b: S.pp.idx, id: u.item.id, sub: k.sub, c, ok: c === answerOf(u, k.qi), f: S.first.get(k.key) !== false, t });
      lock[k.sub] = c;
    });
    if (rows.length) S.ctx.setState(S.ctx.data.record(S.ctx.no, S.ctx.lesson, rows));
  }
  function touch(S) { S.touched = Date.now(); S.clock.touch(); }
  /* 倒數看截止時間算:切回畫面時馬上對一次;剩不到 5 分鐘變紅,剩 5 分、1 分各念一次;時間到把選了的寫進進度、自動交卷 */
  function check(S) {
    if (S.over) return;
    const left = Math.max(0, S.deadline - Date.now()), m = Math.floor(left / 60000), s = Math.floor(left % 60000 / 1000);
    S.timerEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    S.timerEl.classList.toggle('low', left < LOW_MS);
    if (left > 0 && S.prev > LOW_MS && left <= LOW_MS) S.f.say(S.X.five);
    if (left > 0 && S.prev > ONE_MS && left <= ONE_MS) S.f.say(S.X.one);
    S.prev = left;
    if (Date.now() - S.touched >= TOUCH_MS) touch(S);
    if (left <= 0) { save(S, false); S.f.say(S.X.timeUp); end(S, 'timeup'); }
  }
  function loop(S) { check(S); if (!S.over) S.timer = root.setTimeout(() => loop(S), 1000); }
  function listen(S, on) {
    const m = on ? 'addEventListener' : 'removeEventListener';
    if (typeof root.document[m] === 'function') root.document[m]('visibilitychange', S.onVis);
    if (typeof root[m] === 'function') { root[m]('pagehide', S.onHide); root[m]('pageshow', S.onShow); }
  }
  function end(S, how) {
    if (S.over) return;
    S.over = true;
    root.clearTimeout(S.timer);
    if (S.asking && typeof S.asking.cancel === 'function') S.asking.cancel();
    S.playerOf.forEach((p) => p && p.stop());
    listen(S, false);
    S.clock.touch();
    S.f.leave();
    S.resolve(how);
  }

  /* ---------- 前測結果 ---------- */
  async function preOf(ctx, today) {
    const t = await root.PACK_CORE.loadShared('tests_v1', today);
    const one = t && t['t' + termOf(ctx.data)];
    return one && one.pre ? one.pre : null;
  }
  /* 鵜鶘、「前測完成」(閱讀時間到交卷時旁邊放「時間到」)、點心列、主按鈕「繼續」回課程總覽、「暫用試卷」那一行、
     聽力與閱讀各 Part 的答對率。不放分數、題數、正解、逐題解析 */
  async function result(ctx, opt) {
    const o = opt || {}, D = ctx.data, I = itemsOf(ctx), P = TX().pretest, key = keyOf(ctx), today = ctx.today();
    let pre = await preOf(ctx, today);
    const missing = !pre;
    if (missing && ctx.state() && ctx.state().doneAt) {
      pre = await D.pretest(ctx.state());
      if (pre) D.tests(pre, today);
    }
    const first = o.first === true || (o.first === undefined && missing);
    const card = root.UI.result({ kicker: P.kicker, big: P.title, flag: timedOut.has(key) ? P.timeUp : null, pose: 'happy', primary: { label: P.next, href: 'lessons.html' } });
    card.el.append(I.tagLine(P.tag, P.note));
    const more = node('div', 'lsn-narrow lsn-result-more');
    if (pre && pre.parts) more.append(I.parts(pre.parts));
    ctx.host.replaceChildren(card.el, more);
    focusHead(card.heading);
    if (first && !given.has(key)) {
      given.add(key);
      if (root.PET_HOOK) root.PET_HOOK.done(key, { into: card.reward });
    }
    return card;
  }

  root.LESSON_TEST = Object.freeze({ assemble, picked, run, result, info, expire });
})(typeof globalThis !== 'undefined' ? globalThis : this);
