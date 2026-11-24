/* 課程頁的個人段與本堂結果(lesson.html):回顧(review_v1)、弱點補練(weak_v1)、第 2 堂前測檢討(test_review_v1)、
   第 4 堂小檢核(判定與寫入、補判)、本堂結果(wrapup_v1:補記考點、小檢核清單、錯題、小檢核解析、點心)。
   規則一律呼叫 js/lesson-rules.js 與 js/pack-core.js;讀寫經過 LESSON_DATA。
   ctx 由 js/lesson.js 給(同 js/lesson-test.js),另外用到:
     runRound(blocks, opt) → Promise:跑一個回合(題庫、文法單元、英語耳:呼叫引擎、交卷把作答寫進進度、照區塊的對應排考點與回顧)。
       opt = { round(LESSON_CORE.rounds 的那一步), slot(段), cp(小檢核的檢核回合:只寫進度、不排考點與回顧), result(false:交卷後不出區塊結果),
               bridge(false:交卷回合前不出過場) };學生離開時回 'exit',其他(交卷、做完)回什麼都當作往下走。
       錯題重做(區塊 80)的作答一律不是第一次作答、不記考點;回顧做完的項目(reviewDone)由這裡在段交卷時一起排。
     views.tip(card, { next, back }):技巧卡畫面,回節點;has(kind, id):選填,沒給時用題目索引與題庫自己判斷。
   window.LESSON_PERSONAL = {
     review(ctx)、weak(ctx)、testReview(ctx)、checkpoint(ctx) → Promise<'done'|'exit'>:'done' 這一段交卷或略過;'exit' 學生離開。都回總覽
     wrapup(ctx) → Promise<'done'>:畫好本堂結果(不要再換畫面)。第一次進來(本堂結果段還不是 done)才補記考點、記完成、給點心;重看只讀
     judge(ctx) → Promise:小檢核兩個回合都交卷、段還沒交卷、還沒判過就補判(開頁、進弱點補練、進本堂結果前)
   } */
(function (root) {
  'use strict';
  const RANGE = { review: [80, 85], weak: [85, 90], test_review: [90, 98] };
  const CP_OPT = Object.freeze({ cp: true, result: false, bridge: false });   // 小檢核的檢核回合:只寫進度,交卷後不出解析,前面是說明頁不是過場
  const core = () => root.LESSON_CORE;
  const rules = () => root.LESSON_RULES;
  const pack = () => root.PACK_CORE;
  const TX = () => core().TEXT;
  const itemsOf = (ctx) => ctx.items || root.LESSON_ITEMS;
  const given = new Set();   // 這一頁已經給過點心的進度鍵

  function node(tag, cls, kids, attrs) {
    const n = root.document.createElement(tag);
    if (cls) n.className = cls;
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    [].concat(kids || []).forEach((c) => { if (c !== null && c !== undefined) n.append(c.nodeType ? c : String(c)); });
    return n;
  }
  function termOf(D) {
    const p = D && typeof D.plan === 'function' ? D.plan() : null;
    return p && Number.isInteger(p.term) && p.term >= 1 && p.term <= 99 ? p.term : 1;
  }
  const keyOf = (ctx) => core().lessonKey(termOf(ctx.data), ctx.no);
  const segOf = (lesson, slot) => (lesson && lesson.segments || []).filter((s) => s.slot === slot)[0] || null;
  const stOf = (st, slot) => (st && st.seg && st.seg[slot] ? st.seg[slot].st : 'todo');
  const closed = (st, slot) => stOf(st, slot) === 'done' || stOf(st, slot) === 'skip';
  const frozenIn = (st, r) => Object.keys((st && st.pk) || {}).map(Number).some((i) => i >= r[0] && i < r[1]);
  const hold = (btn) => typeof root.holdForAccount === 'function' && root.holdForAccount(btn);
  function set(ctx, s) { ctx.setState(s); return s; }
  function push(ctx, step) { if (typeof ctx.push === 'function') ctx.push(step); }
  function focusHead(h) {
    try { if (typeof root.scrollTo === 'function') root.scrollTo(0, 0); h.focus({ preventScroll: true }); } catch (e) { /* 焦點放不上去不影響作答 */ }
  }
  async function metaMap() { return new Map((await root.BANK.meta()).map((r) => [r.id, r])); }
  /* 找得到的判斷:題庫回小題數(單題 1)、找不到回 false;英語耳、文法單元、技巧卡看資料裡有沒有那個 id */
  function hasOf(meta) {
    const T = root.TOEIC || {}, E = T.ear || {};
    const ear = new Set(Object.keys(E).reduce((a, k) => a.concat(Array.isArray(E[k]) ? E[k].map((q) => q.id) : []), []));
    const gram = new Set((T.grammar || []).map((u) => u.id));
    const tips = new Set(tipCards().map((c) => c.id));
    return (kind, id) => {
      if (kind === 'bank') { const r = meta.get(id); return r ? r.size || 1 : false; }
      if (kind === 'ear') return ear.has(id);
      if (kind === 'grammar') return gram.has(id);
      if (kind === 'tip') return tips.has(id);
      return true;
    };
  }
  const hasFor = (ctx, meta) => (typeof ctx.has === 'function' ? ctx.has : hasOf(meta));
  function tipCards() { const T = root.TIP_CARDS; return T && Array.isArray(T.cards) ? T.cards : []; }
  /* 個人段開段前要的資料:先等前面排隊的考點、回顧寫完 */
  async function inputsOf(ctx) {
    await ctx.data.flush();
    return ctx.data.inputs(ctx.now());
  }
  const selCtx = (ctx) => ctx.data.ctx(ctx.lesson, ctx.now());
  async function mark(ctx, slot, st) { return set(ctx, await ctx.data.segment(ctx.no, ctx.lesson, slot, st, ctx.now())); }
  async function skip(ctx, slot) { await mark(ctx, slot, 'skip'); return 'done'; }

  /* ---------- 選題寫進進度(資料層還沒有這兩支時的暫時備援,之後改由 LESSON_DATA 寫) ---------- */
  /* 個人段整段取先凍結的那一份:另一台已經凍結了這一段就用它的,不拼接 */
  function takeFrozen(s, picked, range) {
    if (!s || s === picked) return picked;
    if (frozenIn(s, range)) return s;
    const pk = Object.assign({}, s.pk);
    Object.keys(picked.pk || {}).map(Number).filter((i) => i >= range[0] && i < range[1]).forEach((i) => { pk[i] = picked.pk[i]; });
    return Object.assign({}, s, { pk });
  }
  async function keep(ctx, picked, range) {
    const D = ctx.data;
    if (typeof D.freeze === 'function') return set(ctx, await D.freeze(ctx.no, ctx.lesson, picked, range));
    const r = await pack().saveLesson(termOf(D), ctx.no, (s) => takeFrozen(s, picked, range), { lesson: ctx.lesson });
    if (r.over) console.warn('第 ' + ctx.no + ' 堂的進度超過 5 KB：', r.trimmed);
    return set(ctx, r.state);
  }
  /* 回顧規劃:同一個 rvq 寫入裡選項目(逾期太久的錯題重做改成考點回顧),回 pickReview 的結果 */
  async function planQueue(ctx, opt, today) {
    const D = ctx.data;
    if (typeof D.planReview === 'function') return D.planReview(opt, today);
    await D.flush();
    let r = null;
    await pack().saveShared('rvq', (q) => { r = rules().pickReview(q, opt); return r.rvq; }, today);
    return r;
  }

  /* ---------- 一段的步驟 ---------- */
  const idsIn = (b, st, has) => core().answerable(b, core().idsOf(b, st), has);
  const roundDone = (st, r, has) => r.blocks.every((b) => core().blockDone(b, idsIn(b, st, has), st, has));
  /* 從第一個沒完成的步驟照順序做到最後;技巧卡、前測結果這一次進來看過就往下 */
  async function steps(ctx, seg, meta, opt) {
    const has = hasFor(ctx, meta);
    if (stOf(ctx.state(), seg.slot) === 'todo') await mark(ctx, seg.slot, 'doing');
    const list = core().rounds(seg, ctx.state());
    const at = core().nextStep(seg, ctx.state(), has);
    for (let i = at ? at.index : list.length; i < list.length; i++) {
      if ((await step(ctx, seg, list[i], has, opt)) === 'exit') return 'exit';
    }
    return 'done';
  }
  async function step(ctx, seg, round, has, opt) {
    if (round.kind === 'tip') return tipStep(ctx, round, has);
    if (round.kind === 'result') return resultStep(ctx);
    if (['bank', 'grammar', 'ear'].indexOf(round.kind) < 0 || roundDone(ctx.state(), round, has)) return 'next';
    const r = await ctx.runRound(round.blocks, Object.assign({ round, slot: seg.slot }, round.cp ? CP_OPT : {}, opt || {}));
    return r === 'exit' ? 'exit' : 'next';
  }
  function tipStep(ctx, round, has) {
    const id = core().idsOf(round.blocks[0], ctx.state())[0];
    const card = has('tip', id) ? tipCards().filter((c) => c.id === id)[0] : null;
    if (!card) { console.warn('找不到這張技巧卡，略過：' + id); return Promise.resolve('next'); }
    return new Promise((resolve) => {
      const V = ctx.views || root.LESSON_VIEWS;
      const n = V.tip(card, { next: () => resolve('next'), back: () => resolve('exit') });
      if (n && n.nodeType) {
        ctx.host.replaceChildren(n);
        const h = n.querySelector('h2');
        if (h) focusHead(h);
      }
      push(ctx, 'tip');
    });
  }
  /* 說明頁、前測結果那一步的「← 回第 n 堂」 */
  const backTo = (ctx, done) => ({ label: TX().lesson.backTo(ctx.no), href: 'lesson.html?no=' + ctx.no, onClick: () => done('exit') });

  /* ---------- 前測的 Part 答對率與題目(前測檢討、弱點補練要用) ---------- */
  async function preOf(ctx, today) {
    const t = await pack().loadShared('tests_v1', today);
    const one = t && t['t' + termOf(ctx.data)];
    return one && one.pre ? one.pre : null;
  }
  /* tests_v1 沒寫到、第 1 堂已經上完:補寫一次 */
  async function backfillTests(ctx, today) {
    const pre = await preOf(ctx, today);
    if (pre) return pre;
    const first = (ctx.data.states() || {})[1];
    const made = first && first.doneAt ? await ctx.data.pretest(first) : null;
    if (made) ctx.data.tests(made, today);
    return made;
  }
  function partsFrom(pre, ctx, meta) {
    if (pre && pre.parts) return pre.parts;
    const first = (ctx.data.states() || {})[1];
    return first ? core().partsOf(first, (id) => (meta.get(id) || {}).size, (k, id) => meta.has(id)) : null;
  }
  const hasParts = (p) => !!p && Object.keys(p).some((k) => p[k] && p[k].n > 0);
  function testIds(ctx, pre) {
    const ids = pre && Array.isArray(pre.items) ? pre.items.map((x) => x && x[0]) : [];
    const first = (ctx.data.states() || {})[1];
    [0, 1].forEach((i) => { const e = first && first.pk ? first.pk[i] : null; (e && Array.isArray(e.ids) ? e.ids : []).forEach((id) => ids.push(id)); });
    return ids.filter((id, i) => typeof id === 'string' && ids.indexOf(id) === i);
  }
  /* 前測檢討第一步:前測結果(不在專心模式) */
  async function resultStep(ctx) {
    const meta = await metaMap(), pre = await preOf(ctx, ctx.today()), parts = partsFrom(pre, ctx, meta);
    if (!hasParts(parts)) return 'next';
    const I = itemsOf(ctx), R = TX().testReview;
    return new Promise((resolve) => {
      const head = node('h2', 'lsn-h2', [R.title], { tabindex: '-1' });
      const go = node('button', 'btn primary lsn-go', [R.next], { type: 'button' });
      go.addEventListener('click', () => resolve('next'));
      const b = backTo(ctx, resolve), back = node('a', 'lsn-back', [b.label], { href: b.href });
      back.addEventListener('click', (e) => { e.preventDefault(); b.onClick(); });
      ctx.host.replaceChildren(node('div', 'lsn-narrow lsn-pre-step', [back, head, I.tagLine(R.tag, R.note), I.parts(parts), go]));
      push(ctx, 'result');
      focusHead(head);
    });
  }

  /* ---------- 回顧 ---------- */
  async function review(ctx) {
    const seg = segOf(ctx.lesson, 'review');
    if (!seg || closed(ctx.state(), 'review')) return 'done';
    const inp = await inputsOf(ctx);
    if (!frozenIn(ctx.state(), RANGE.review)) {
      const r = await planQueue(ctx, ctx.data.reviewOpt(seg, inp), inp.today);
      if (!r || !r.units.length) return skip(ctx, 'review');
      await keep(ctx, (await pack().pickReview(ctx.lesson, ctx.state(), r.units, selCtx(ctx))).state, RANGE.review);
    }
    const out = await steps(ctx, seg, inp.meta);
    if (out !== 'done') return out;
    await mark(ctx, 'review', 'done');
    const done = reviewedItems(ctx.state());
    if (done.length) ctx.data.reviewed(done, inp.today);
    return 'done';
  }
  /* 回顧做完的項目:錯題重做看那一小題的對錯(只有原本答錯、凍結在 80 的小題);考點回顧答對 2/3 以上算通過 */
  function reviewedItems(st) {
    const pk = st.pk || {}, rows = st.a || [], out = [];
    const ok = (x) => (x[4] & 1) === 1;
    const redo = pk[80];
    (redo && Array.isArray(redo.ids) ? redo.ids : []).forEach((id, i) => {
      const sub = (redo.sub || [])[i] || null, m = (redo.m || [])[i];
      const x = rows.filter((r) => r[0] === 80 && r[1] === id && (r[2] || 0) === (sub || 0))[0];
      if (x && m) out.push({ entry: { m, id, sub }, ok: ok(x) });
    });
    [81, 82, 83, 84].forEach((idx) => {
      const k = pk[idx] && /^point_review:(.+)$/.exec(pk[idx].r || '');
      const mine = rows.filter((x) => x[0] === idx);
      if (k && mine.length) out.push({ entry: { k: k[1] }, ok: mine.filter(ok).length * 3 >= mine.length * 2 });
    });
    return out;
  }

  /* ---------- 弱點補練 ---------- */
  async function weak(ctx) {
    const seg = segOf(ctx.lesson, 'weak');
    if (!seg || closed(ctx.state(), 'weak')) return 'done';
    await judge(ctx);
    const inp = await inputsOf(ctx);
    if (!frozenIn(ctx.state(), RANGE.weak)) {
      const plans = rules().planWeak(ctx.data.weakOpt(ctx.no, ctx.lesson, ctx.state(), inp, null));
      const r = await pack().pickWeak(ctx.lesson, ctx.state(), plans, selCtx(ctx));
      if (!r.blocks.some((b) => b.ids.length)) return skip(ctx, 'weak');
      await keep(ctx, r.state, RANGE.weak);
    }
    const out = await steps(ctx, seg, inp.meta);
    if (out !== 'done') return out;
    await mark(ctx, 'weak', 'done');
    return 'done';
  }

  /* ---------- 第 2 堂前測檢討 ---------- */
  async function testReview(ctx) {
    const seg = segOf(ctx.lesson, 'test_review');
    if (!seg || closed(ctx.state(), 'test_review')) return 'done';
    const inp = await inputsOf(ctx);
    const pre = await backfillTests(ctx, inp.today);
    if (!frozenIn(ctx.state(), RANGE.test_review)) {
      const c = Object.assign({}, selCtx(ctx), { testIds: testIds(ctx, pre) });
      const r = await pack().pickTestReview(ctx.lesson, ctx.state(), partsFrom(pre, ctx, inp.meta) || {}, c);
      await keep(ctx, r.state, RANGE.test_review);
    }
    const out = await steps(ctx, seg, inp.meta);
    if (out !== 'done') return out;
    await mark(ctx, 'test_review', 'done');
    return 'done';
  }

  /* ---------- 第 4 堂小檢核 ---------- */
  const cpRounds = (seg, st) => core().rounds(seg, st).filter((r) => r.cp);
  /* 判定用的作答:檢核區塊(補足的不算)全部可作答的小題,沒作答算錯;key 是那一列的考點鍵 */
  function cpAnswers(st, rounds, meta, has) {
    const rows = new Map((st.a || []).map((x) => [x[0] + '|' + x[1] + '|' + (x[2] || 0), x]));
    const out = [];
    rounds.forEach((r) => r.blocks.filter((b) => !b.fill).forEach((b) => idsIn(b, st, has).forEach((id) => {
      const row = meta.get(id), keys = row ? rules().keysOfRow(row) : [];
      core().itemKeys(core().partOfId(id), row, id).forEach((k) => {
        const x = rows.get(b.idx + '|' + id + '|' + k.sub);
        out.push({ key: keys[k.qi] || null, ok: !!x && (x[4] & 1) === 1, first: true, m: b.module, id, sub: k.sub || null });
      });
    })));
    return out;
  }
  async function judge(ctx) {
    const seg = segOf(ctx.lesson, 'checkpoint'), st = ctx.state();
    if (!seg || !st || closed(st, 'checkpoint')) return null;
    const meta = await metaMap(), has = hasFor(ctx, meta), list = cpRounds(seg, st);
    if (!list.length || !list.every((r) => roundDone(st, r, has))) return null;
    const answers = cpAnswers(st, list, meta, has);
    if (!answers.some((a) => a.key)) return null;   // 沒有可判的考點:當作判過
    return ctx.data.checkpoint(ctx.no, answers, ctx.today());
  }
  const countIn = (rounds, st, has) => rounds.reduce((a, r) => a + r.blocks.filter((b) => !b.fill).reduce((n, b) => n + idsIn(b, st, has).reduce((m, id) => m + (Number(has('bank', id)) || 1), 0), 0), 0);
  /* 說明頁:小檢核(題數、約幾分鐘、結果在本堂最後顯示),或換科時的「閱讀」 */
  function cpIntro(ctx, title, tags, rule) {
    return new Promise((resolve) => {
      const C = TX().checkpoint;
      const v = itemsOf(ctx).intro({ back: backTo(ctx, resolve), title, tags, rule, start: C.start, onStart: (btn) => { if (!hold(btn)) resolve('start'); } });
      ctx.host.replaceChildren(v.el);
      push(ctx, 'checkpoint');
      focusHead(v.heading);
    });
  }
  async function checkpoint(ctx) {
    const seg = segOf(ctx.lesson, 'checkpoint');
    if (!seg || closed(ctx.state(), 'checkpoint')) return 'done';
    const meta = await metaMap(), has = hasFor(ctx, meta), C = TX().checkpoint;
    if (stOf(ctx.state(), 'checkpoint') === 'todo') await mark(ctx, 'checkpoint', 'doing');
    const list = cpRounds(seg, ctx.state());
    const sec = ctx.lesson.checkpoint && ctx.lesson.checkpoint.answerSeconds;
    for (let i = 0; i < list.length; i++) {
      if (roundDone(ctx.state(), list[i], has)) continue;
      const go = i === 0
        ? await cpIntro(ctx, C.title, [C.count(countIn(list, ctx.state(), has)), sec ? C.aboutMin(Math.ceil(sec / 60)) : null], C.note)
        : await cpIntro(ctx, C.reading, [C.count(countIn([list[i]], ctx.state(), has))], null);
      if (go !== 'start') return 'exit';
      if ((await ctx.runRound(list[i].blocks, Object.assign({ round: list[i], slot: 'checkpoint' }, CP_OPT))) === 'exit') return 'exit';
    }
    await judge(ctx);
    const out = await steps(ctx, seg, meta);
    if (out !== 'done') return out;
    await mark(ctx, 'checkpoint', 'done');
    return 'done';
  }

  /* ---------- 本堂結果 ---------- */
  const personalSlot = (i) => (i < RANGE.weak[0] ? 'review' : i < RANGE.test_review[0] ? 'weak' : 'test_review');
  function blockSlots(lesson, st) {
    const out = [];
    lesson.segments.forEach((s) => (s.blocks || []).forEach((b) => out.push({ idx: b.idx, slot: s.slot })));
    Object.keys(st.pk || {}).map(Number).filter((i) => i > RANGE.review[0]).forEach((i) => out.push({ idx: i, slot: personalSlot(i) }));
    return out;
  }
  /* 不算進答對數與錯題的區塊:小檢核的檢核區塊、前測 */
  function apartIdx(lesson) {
    const out = new Set(cpBlocks(lesson).map((b) => b.idx));
    lesson.segments.filter((s) => /^test_(listening|reading)$/.test(s.slot)).forEach((s) => (s.blocks || []).forEach((b) => out.add(b.idx)));
    return out;
  }
  /* 補記考點:照原本的來源與批次再記一次(同一批只留題數多的,不會重複算),日期用那一區塊最後一題作答那天。
     小檢核整批用判定時那一組作答(不補判、判過的結果不變) */
  function rerecordAll(ctx, meta) {
    const st = ctx.state(), key = keyOf(ctx), has = hasFor(ctx, meta), D = ctx.data;
    const dayOf = (rows) => pack().dayOf(st.startedAt + rows.reduce((a, x) => Math.max(a, x[5]), 0));
    blockSlots(ctx.lesson, st).forEach((x) => {
      const map = core().rerecord(x.idx, x.slot, key);
      if (!map || x.slot === 'checkpoint') return;
      const rows = (st.a || []).filter((r) => r[0] === x.idx && meta.has(r[1]));
      const answers = rows.map((r) => ({ key: rules().keysOfRow(meta.get(r[1]))[r[2] ? r[2] - 1 : 0] || null, ok: (r[4] & 1) === 1, first: (r[4] & 2) === 2 }));
      if (answers.some((a) => a.key && a.first)) D.hits(answers, { today: dayOf(rows), src: map.src, b: map.b });
    });
    const seg = segOf(ctx.lesson, 'checkpoint');
    if (!seg) return;
    const list = cpRounds(seg, st), cpIdx = new Set(cpBlocks(ctx.lesson).map((b) => b.idx));
    const rows = (st.a || []).filter((r) => cpIdx.has(r[0]));
    if (rows.length) D.hits(cpAnswers(st, list, meta, has), { today: dayOf(rows), src: 'c', b: key + ':cp' });
  }
  const cpBlocks = (lesson) => ((segOf(lesson, 'checkpoint') || {}).blocks || []).filter((b) => !b.fill);
  /* 小檢核清單:每個檢核考點(舊欄位寫法去重)一列,照課表的考點順序 */
  function verdictRows(ctx, pts) {
    const cp = ctx.lesson.checkpoint || {}, R = rules(), C = core();
    const got = new Map(C.verdictsOf(pts, keyOf(ctx) + ':cp').map((v) => [v.key, v.verdict]));
    const keys = (cp.listening || []).concat(cp.reading || []).map((k) => R.legacyKey(k) || k).filter((k, i, a) => a.indexOf(k) === i);
    return keys.filter((k) => got.has(k)).map((k) => ({ name: C.pointName(k), verdict: got.get(k) }));
  }
  async function unitsOf(ids) {
    const list = ids.filter((id, i) => ids.indexOf(id) === i);
    const got = list.length ? await root.BANK.get(list) : [];
    return got.map((item, i) => (item ? { p: core().partOfId(list[i]), item } : null)).filter(Boolean);
  }
  function detail(title, nodes) {
    const d = root.UI.detail(title, nodes, { wrong: 0 });
    d.addEventListener('toggle', () => { if (!d.open && typeof nodes.stop === 'function') nodes.stop(); });
    return d;
  }
  /* 答對數:這一堂題庫、文法、英語耳、單字小考的作答,同一小題只算一次;不含小檢核的題與前測 */
  function tally(st, skipIdx) {
    const seen = new Set(), rows = [];
    (st.a || []).forEach((x) => {
      const k = x[1] + '|' + (x[2] || 0);
      if (skipIdx.has(x[0]) || seen.has(k)) return;
      seen.add(k);
      rows.push(x);
    });
    return rows;
  }
  async function drawWrapup(ctx, meta) {
    const st = ctx.state(), W = TX().wrapup, I = itemsOf(ctx);
    const cpIdx = new Set(cpBlocks(ctx.lesson).map((b) => b.idx));
    const rows = tally(st, apartIdx(ctx.lesson)), score = rows.filter((x) => (x[4] & 1) === 1).length;
    const card = root.UI.result(Object.assign({ kicker: W.kicker(ctx.no), primary: { label: W.next, href: 'lessons.html' } },
      rows.length ? { score, total: rows.length } : { big: TX().lesson.done }));
    const more = node('div', 'lsn-narrow lsn-result-more');
    if (ctx.lesson.checkpoint) {
      const list = verdictRows(ctx, await pack().loadShared('pts', ctx.today()));
      if (list.length) more.append(node('h2', 'me-sec-h', [W.checkpoint]), I.verdicts(list));
    }
    const wrong = rows.filter((x) => (x[4] & 1) !== 1 && meta.has(x[1]));
    if (wrong.length) {
      const units = await unitsOf(wrong.map((x) => x[1]));
      more.append(detail(W.wrong(wrong.length), I.review(units, I.answersOf(units, rows))));
    }
    const cpRows = (st.a || []).filter((x) => cpIdx.has(x[0]));
    const cpIds = [].concat(...cpBlocks(ctx.lesson).map((b) => idsIn(b, st, hasFor(ctx, meta))));
    if (cpIds.length) {
      const units = await unitsOf(cpIds);
      more.append(detail(W.checkpointReview, I.review(units, I.answersOf(units, cpRows))));
    }
    ctx.host.replaceChildren(card.el, more);
    focusHead(card.heading);
    return card;
  }
  async function wrapup(ctx) {
    const first = stOf(ctx.state(), 'wrapup') !== 'done', key = keyOf(ctx);
    const meta = await metaMap();
    if (first) {
      await ctx.data.flush();
      await judge(ctx);
      rerecordAll(ctx, meta);
      await ctx.data.flush();
    }
    const card = await drawWrapup(ctx, meta);
    if (!first) return 'done';
    await mark(ctx, 'wrapup', 'done');
    if (!given.has(key)) {
      given.add(key);
      if (root.PET_HOOK) root.PET_HOOK.done(key, { into: card.reward });
    }
    return 'done';
  }

  root.LESSON_PERSONAL = Object.freeze({ review, weak, testReview, checkpoint, wrapup, judge });
})(typeof globalThis !== 'undefined' ? globalThis : this);
