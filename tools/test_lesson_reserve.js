/* 小檢核的預留題,整條路:一個學生照正常進度上第 1–3 堂(前測、固定段、前測檢討、回顧、弱點補練都作答),第 4 堂開堂凍結時,
   小檢核的照片描述一定選滿題數,其他檢核區塊也選滿;只有題庫裡那個考點的題比「小檢核＋同一堂的固定段」還少時(門檻閱讀的詞性變化 22 題,
   小檢核要 15 題、第 3 堂固定段要 8 題),少的題數不超過固定段用掉的預留題。入門、門檻、聽門檻讀入門、聽入門讀門檻四種級別組合,每種三個帳號。
   選題用真的 js/lesson-data.js(選題的 ctx、凍結、記作答、考點與回顧佇列的寫入)與 js/pack-core.js,作答紀錄與學習記錄照練習引擎的寫法寫回;
   每題都選第一個選項(跟頁面測試的小幫手一樣)。也印出第 2、3 堂練習區塊的題數、放寬「14 天內做過」與用預留題補的區塊數。
   不開瀏覽器、不連網。用法:node tools/test_lesson_reserve.js */
'use strict';
const K = require('./lesson_kit.js');
const { eq, NOW, DAY, EE, TT, TE, ET } = K;

/* 固定種子的亂數(選題用;每個帳號一個) */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const BANK_MOD = /^p([1-7])$/;

/* 一個學生 */
function student(lv, uid, seed) {
  const e = K.env({ bank: true, user: uid, pid: 'c' + uid.replace(/-/g, '') });
  const C = e.ctx.LESSON_CORE, R = e.R, D = e.D, P = e.P;
  const meta = new Map(e.ctx.BANK_META.items.map((r) => [r.id, r]));
  const random = rng(seed);
  let st = null, t = 0;
  const today = () => P.dayOf(t);
  const tick = (s) => { t += s || 30; e.clock.set(t); };
  const pick = (lesson) => Object.assign({}, D.ctx(lesson, t), { random });
  /* 每小題 { sub, key, ans(正確選項) } */
  async function subsOf(id) {
    const item = (await e.B.get([id]))[0];
    return C.itemKeys(C.partOfId(id), item, id).map((k) => Object.assign({}, k, { ans: Array.isArray(item.questions) ? item.questions[k.qi].answer : item.answer }));
  }
  /* 引擎的寫法:作答紀錄(listen_p*、drill_p*)每小題一筆、學習記錄一筆 */
  function writeRec(part, key, c, ok) {
    const k = (Number(part) <= 4 ? 'listen_p' : 'drill_p') + part, ms = e.clock.ms();
    e.store.set(k, Object.assign({}, e.store.get(k, {}), { [key]: { c, ok, t: ms } }));
    e.store.set('hist', (e.store.get('hist', []) || []).concat([{ m: (Number(part) <= 4 ? 'l' : 'p') + part, id: key, c, ok, t: ms }]));
  }
  /* 一個區塊的題全部作答:寫作答紀錄、進度,照上課頁記考點與排回顧(錯題重做 80 不記考點、不排回顧;前測只寫進度) */
  async function answer(no, lesson, slot, idx, ids, subsFor) {
    const test = slot === 'test_listening' || slot === 'test_reading';
    const rows = [];
    for (const id of ids) {
      const part = C.partOfId(id);
      if (!part) continue;
      for (const k of subsFor ? subsFor(id, await subsOf(id)) : await subsOf(id)) {
        const c = 0, ok = k.ans === c;   // 跟頁面測試的小幫手一樣,每題都選第一個選項
        const rec = (e.store.get((Number(part) <= 4 ? 'listen_p' : 'drill_p') + part, {}) || {})[k.key];
        if (!test) writeRec(part, k.key, c, ok);
        rows.push({ b: idx, id, sub: k.sub || 0, c, ok, f: !test && idx !== 80 && !rec, t });
      }
    }
    if (!rows.length) return;
    st = D.record(no, lesson, rows);
    if (test) return;
    const map = C.rerecord(idx, slot, P.lessonKey(1, no));
    const answers = st.a.filter((x) => x[0] === idx).map((x) => ({ key: R.keysOfRow(meta.get(x[1]) || {})[x[2] ? x[2] - 1 : 0] || null, ok: (x[4] & 1) === 1, first: (x[4] & 2) === 2 })).filter((a) => a.key);
    if (map && answers.length) D.hits(answers, { today: today(), src: map.src, b: map.b });
    const refs = rows.filter((r) => !r.ok && idx !== 80).map((r) => ({ m: 'p' + C.partOfId(r.id), id: r.id, sub: r.sub || null }));
    if (refs.length) D.wrong(refs, today());
  }
  const segDone = async (no, lesson, slot, s) => { tick(); st = await D.segment(no, lesson, slot, s || 'done', t); };
  /* 記一個練習區塊:想要的題數、選到的、有沒有重用 14 天內做過的(放寬)、用了幾題預留題 */
  function note(out, seg, idx, part, want, ids, seen, hold) {
    out.push({ seg, idx, part, want, got: ids.length, relaxed: ids.some((id) => seen.has(id)), reserved: ids.filter((id) => hold.has(id)).length });
  }
  const holdOf = async (c) => new Set(P.reserved ? await P.reserved(c) : []);

  async function fixed(no, lesson, out) {
    tick();
    const c = pick(lesson);
    const seen = new Set(c.seen), hold = await holdOf(c);
    let s0;
    if (lesson.kind === 'test') {
      const form = await D.testForm(c);
      s0 = [0, 1].reduce((s, i) => P.freeze(s, i, form[i] || [], t), P.newState(lesson, t));
    } else s0 = (await P.pickFixed(lesson, P.newState(lesson, t), c)).state;
    st = await D.start(no, lesson, t, null, s0);
    lesson.segments.forEach((seg) => (seg.blocks || []).forEach((b) => {
      const m = BANK_MOD.exec(b.module);
      if (m && seg.slot !== 'checkpoint' && seg.slot.indexOf('test_') !== 0) note(out, seg.slot, b.idx, m[1], b.count, st.pk[b.idx].ids, seen, hold);
    }));
    return st;
  }
  async function fixedSeg(no, lesson, seg) {
    for (const b of seg.blocks || []) {
      tick(60);
      if (BANK_MOD.test(b.module) || b.module === 'test_forms') await answer(no, lesson, seg.slot, b.idx, st.pk[b.idx].ids);
    }
    await segDone(no, lesson, seg.slot);
  }
  async function inputs() { await D.flush(); return D.inputs(t); }
  async function testReview(no, lesson, out) {
    const inp = await inputs();
    const pre = (inp.tests['t1'] || {}).pre;
    const ids = (pre && pre.items ? pre.items.map((x) => x[0]) : []).concat(D.testIds());
    const c = Object.assign(pick(lesson), { testIds: ids.filter((id, i) => ids.indexOf(id) === i) });
    const seen = new Set(c.seen), hold = await holdOf(c), parts = D.testParts(inp);
    const r = await P.pickTestReview(lesson, st, parts, c);
    st = await D.freeze(no, lesson, r.state, [90, 98]);
    let idx = 90;
    for (const x of R.planTestReview(parts).filter((y) => y.kind !== 'result')) {
      if (x.kind === 'items') { note(out, 'test_review', idx, x.part, x.count, st.pk[idx].ids, seen, hold); tick(60); await answer(no, lesson, 'test_review', idx, st.pk[idx].ids); }
      idx++;
    }
    await segDone(no, lesson, 'test_review');
  }
  async function review(no, lesson, seg, out) {
    const inp = await inputs();
    const plan = await D.planReview(D.reviewOpt(seg, inp), inp.today);
    if (!plan || !plan.units.length) return segDone(no, lesson, 'review', 'skip');
    const c = pick(lesson), seen = new Set(c.seen), hold = await holdOf(c);
    st = await D.freeze(no, lesson, (await P.pickReview(lesson, st, plan.units, c)).state, [80, 85]);
    const redo = st.pk[80] || { ids: [] }, done = [];
    tick(60);
    /* 錯題重做:只做凍結的那幾小題 */
    await answer(no, lesson, 'review', 80, redo.ids.filter((id, i) => redo.ids.indexOf(id) === i), (id, all) => {
      const subs = redo.ids.map((x, i) => (x === id ? (redo.sub || [])[i] || 0 : null)).filter((s) => s !== null);
      return all.filter((k) => subs.indexOf(k.sub) > -1);
    });
    redo.ids.forEach((id, i) => {
      const sub = (redo.sub || [])[i] || 0, x = st.a.filter((r) => r[0] === 80 && r[1] === id && (r[2] || 0) === sub)[0];
      if (x && (redo.m || [])[i]) done.push({ entry: { m: redo.m[i], id, sub: sub || null }, ok: (x[4] & 1) === 1 });
    });
    for (const idx of [81, 82, 83, 84]) {
      const k = st.pk[idx] && /^point_review:(.+)$/.exec(st.pk[idx].r || '');
      if (!k) continue;
      note(out, 'review', idx, R.bankWhere(k[1]).part, R.isGroupKey(k[1]) ? 1 : 3, st.pk[idx].ids, seen, hold);
      tick(60);
      await answer(no, lesson, 'review', idx, st.pk[idx].ids);
      const mine = st.a.filter((x) => x[0] === idx);
      if (mine.length) done.push({ entry: { k: k[1] }, ok: mine.filter((x) => (x[4] & 1) === 1).length * 3 >= mine.length * 2 });
    }
    await segDone(no, lesson, 'review');
    if (done.length) D.reviewed(done, today());
  }
  async function weak(no, lesson, out) {
    const inp = await inputs();
    const plans = R.planWeak(D.weakOpt(no, lesson, st, inp, null));
    const c = pick(lesson), seen = new Set(c.seen), hold = await holdOf(c);
    const r = await P.pickWeak(lesson, st, plans, c);
    if (!r.blocks.some((b) => b.ids.length)) return segDone(no, lesson, 'weak', 'skip');
    st = await D.freeze(no, lesson, r.state, [85, 90]);
    let idx = 85;
    for (const p of plans) {
      if (idx + (p.base ? 1 : 0) >= 90) break;
      if (p.base) idx++;
      const part = (p.key ? R.bankWhere(p.key) : { part: p.part }).part;
      note(out, 'weak', idx, part, R.weakCount(p), st.pk[idx].ids, seen, hold);
      tick(60);
      await answer(no, lesson, 'weak', idx, st.pk[idx].ids);
      idx++;
    }
    await segDone(no, lesson, 'weak');
  }
  /* 第 no 堂從頭上到尾;回練習區塊的紀錄 */
  async function lesson(no) {
    t = NOW + (no - 1) * DAY;
    e.clock.set(t);
    const L = e.lesson(lv, no), out = [];
    await fixed(no, L, out);
    for (const seg of L.segments) {
      if (seg.slot === 'test_review') await testReview(no, L, out);
      else if (seg.slot === 'review') await review(no, L, seg, out);
      else if (seg.slot === 'weak') await weak(no, L, out);
      else if (seg.slot === 'wrapup') await segDone(no, L, 'wrapup');
      else await fixedSeg(no, L, seg);
    }
    if (no === 1) { const pre = await D.pretest(st); D.tests(pre, today()); }
    await D.flush();
    return out;
  }
  /* 第 4 堂開堂凍結:小檢核每個檢核區塊 [模組, 要幾題, 選到幾題] */
  async function checkpoint() {
    t = NOW + 3 * DAY;
    e.clock.set(t);
    const L = e.lesson(lv, 4);
    const r = await P.pickFixed(L, P.newState(L, t), pick(L));
    return L.segments.filter((s) => s.slot === 'checkpoint')[0].blocks.filter((b) => !b.fill).map((b) => [b.module, b.count, r.state.pk[b.idx].ids.length]);
  }
  return { e, lesson, checkpoint };
}

const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
function brief(list) {
  return '要 ' + sum(list, (x) => x.want) + ' 選到 ' + sum(list, (x) => x.got) + '、放寬 ' + list.filter((x) => x.relaxed).length + ' 塊、用預留題 ' + list.filter((x) => x.reserved).length + ' 塊';
}
const COMBOS = [['入門', EE], ['門檻', TT], ['聽門檻讀入門', TE], ['聽入門讀門檻', ET]];
const ACCOUNTS = ['5a0c1e2d-3b4a-4c5d-8e6f-7a8b9c0d1e2f', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', '0f1e2d3c-4b5a-4969-8877-665544332211'];

const T = {};
COMBOS.forEach(([name, lv], ci) => {
  T[name + ':第 1–3 堂全部作答後,第 4 堂小檢核的照片描述選滿,其他區塊少的題數不超過固定段用掉的預留題;印出第 2、3 堂練習區塊的題數與放寬'] = async () => {
    const bad = [];
    for (let ai = 0; ai < ACCOUNTS.length; ai++) {
      const s = student(lv, ACCOUNTS[ai], 1000 + ci * 10 + ai);
      await s.e.D.packs();
      await s.lesson(1);
      const l2 = await s.lesson(2), l3 = await s.lesson(3);
      const cp = await s.checkpoint();
      const used = sum(l2.concat(l3), (x) => x.reserved), short = sum(cp, (x) => x[1] - x[2]);
      console.log('  ' + name + ' 帳號' + (ai + 1) + ' 小檢核 ' + cp.map((x) => x[0] + ' ' + x[2] + '/' + x[1]).join('、') + ';第 2 堂 ' + brief(l2) + ';第 3 堂 ' + brief(l3));
      /* 照片描述一定選滿;其他區塊少的題數不超過固定段用掉的預留題(題庫裡那個考點的題比「小檢核＋同一堂的練習」還少,只能這樣) */
      if (!cp.some((x) => x[0] === 'p1') || cp.some((x) => x[0] === 'p1' && x[2] !== x[1]) || short > (lv.reading === 'entry' ? 0 : used)) bad.push('帳號' + (ai + 1) + ' 少 ' + short + ' 題、練習用掉預留題 ' + used + ' 題');
    }
    eq(bad, [], name);
    return ACCOUNTS.length + ' 個帳號';
  };
});

process.on('beforeExit', () => { console.log('FAIL 有一支測試一直沒有結束'); process.exit(1); });
K.run(T);
