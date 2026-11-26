/* 第 8 堂小檢核的預留題,整條路:一個學生照建議日期上第 1–7 堂(前測、固定段、前測檢討、回顧、弱點補練、第 4 堂小檢核都作答),
   第 8 堂開堂凍結時看小檢核每個檢核區塊選到幾題。
   門檻 6 個帳號:每個檢核區塊都選滿。入門升門檻 3 個帳號(第 1–4 堂入門、第 5 堂起門檻,模擬第 4 堂後升級):每個區塊至少 3 題
   (簡短對話至少 1 組;第 1–4 堂避開的是入門那一份,門檻那一份會被前測與前測檢討用掉幾題,選不滿)。
   兩種帳號選到的檢核題都在小檢核清單內、開堂時沒做過、不是前測題;第 5–7 堂固定段每個題庫區塊都選滿。
   選題用真的 js/lesson-data.js 與 js/pack-core.js,作答紀錄與學習記錄照練習引擎的寫法寫回;每小題照固定種子的亂數答對(答錯選正解的下一個選項)。
   先做檢測的兩種(門檻 6 個、入門升門檻 3 個帳號):第 1 堂前先在程度檢測頁(tools/placement_kit.js,真的 js/placement.js)做完
   聽力 12 題、閱讀 12 題,檢測做過的題在課程裡算做過。第 4、8 堂每個檢核區塊選到的題不比同一個帳號沒做檢測時少
   (預留題先扣掉檢測做過的題);門檻的第 8 堂照樣每個區塊選滿。
   答對率 60% 有斷言;40%、85% 只印數字。不開瀏覽器、不連網。用法:node tools/test_lesson_reserve8.js */
'use strict';
const K = require('./lesson_kit.js');
const PK = require('./placement_kit.js');
const { eq, NOW, DAY, EE, TT } = K;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const BANK_MOD = /^p([1-7])$/;
/* 第 1–8 堂的建議日期(距開始日幾天) */
const DAYS = [0, 3, 7, 10, 14, 17, 21, 24];

/* 第 1 堂前兩小時在程度檢測頁做完一次(聽力、閱讀各 12 題),每小題照固定種子的亂數答對 → 那一份 placement_v1 */
async function placementRun(pid, seed, rate) {
  const p = PK.env({ pid, now: (NOW - 7200) * 1000 }), right = rng(seed);
  const mode = (u, qi) => { const a = PK.answerOf(u, qi); return right() < rate ? a : (a + 1) % (Number(u.part) === 2 ? 3 : 4); };
  PK.clickText(p.box, '開始');
  await PK.flush();
  await PK.doSection(p, mode);
  PK.clickText(p.box, '開始閱讀');
  await PK.flush();
  await PK.doSection(p, mode);
  await PK.flush(40);
  const v = p.get('placement_v1');
  if (!v || !v.runs.length || typeof v.runs[0].end !== 'string' || v.runs[0].items.length !== 24) throw new Error('檢測沒有做完');
  return v;
}

/* 一個學生:lvOf(no) 是第 no 堂上課的級別;rate 是每小題答對的機率;placement 是第 1 堂前做的檢測(placement_v1,沒有就是沒做) */
function student(uid, seed, lvOf, rate, placement) {
  const e = K.env({ bank: true, user: uid, pid: 'c' + uid.replace(/-/g, '') });
  if (placement) e.store.set('placement_v1', placement);
  const C = e.ctx.LESSON_CORE, R = e.R, D = e.D, P = e.P;
  const meta = new Map(e.ctx.BANK_META.items.map((r) => [r.id, r]));
  const random = rng(seed), right = rng(seed * 7 + 3);
  let st = null, t = 0;
  const today = () => P.dayOf(t);
  const tick = (s) => { t += s || 30; e.clock.set(t); };
  const pick = (lesson) => Object.assign({}, D.ctx(lesson, t), { random });
  async function subsOf(id) {
    const item = (await e.B.get([id]))[0];
    const part = C.partOfId(id);
    return C.itemKeys(part, item, id).map((k) => {
      const q = Array.isArray(item.questions) ? item.questions[k.qi] : item;
      const n = Array.isArray(q.options) ? q.options.length : part === '2' ? 3 : 4;
      return Object.assign({}, k, { ans: q.answer, n });
    });
  }
  function writeRec(part, key, c, ok) {
    const k = (Number(part) <= 4 ? 'listen_p' : 'drill_p') + part, ms = e.clock.ms();
    e.store.set(k, Object.assign({}, e.store.get(k, {}), { [key]: { c, ok, t: ms } }));
    e.store.set('hist', (e.store.get('hist', []) || []).concat([{ m: (Number(part) <= 4 ? 'l' : 'p') + part, id: key, c, ok, t: ms }]));
  }
  async function rowsOf(idx, ids, subsFor, test) {
    const rows = [];
    for (const id of ids) {
      const part = C.partOfId(id);
      if (!part) continue;
      for (const k of subsFor ? subsFor(id, await subsOf(id)) : await subsOf(id)) {
        const ok = right() < rate, c = ok ? k.ans : (k.ans + 1) % k.n;
        const rec = (e.store.get((Number(part) <= 4 ? 'listen_p' : 'drill_p') + part, {}) || {})[k.key];
        if (!test) writeRec(part, k.key, c, ok);
        rows.push({ b: idx, id, sub: k.sub || 0, c, ok, f: !test && idx !== 80 && !rec, t });
      }
    }
    return rows;
  }
  /* 一個區塊作答:寫作答紀錄、進度,照上課頁記考點與排回顧(錯題重做 80 不記考點、不排回顧;前測只寫進度) */
  async function answer(no, lesson, slot, idx, ids, subsFor) {
    const test = slot === 'test_listening' || slot === 'test_reading';
    const rows = await rowsOf(idx, ids, subsFor, test);
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
  function note(out, seg, idx, want, ids, seen, hold) {
    out.push({ seg, idx, want, got: ids.length, relaxed: ids.some((id) => seen.has(id)), reserved: ids.filter((id) => hold.has(id)).length });
  }
  const holdOf = async (c) => new Set(await P.reserved(c));

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
      if (BANK_MOD.test(b.module) && seg.slot !== 'checkpoint' && seg.slot.indexOf('test_') !== 0) note(out, seg.slot, b.idx, b.count, st.pk[b.idx].ids, seen, hold);
    }));
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
    st = await D.freeze(no, lesson, (await P.pickTestReview(lesson, st, parts, c)).state, [90, 98]);
    let idx = 90;
    for (const x of R.planTestReview(parts).filter((y) => y.kind !== 'result')) {
      if (x.kind === 'items') { note(out, 'test_review', idx, x.count, st.pk[idx].ids, seen, hold); tick(60); await answer(no, lesson, 'test_review', idx, st.pk[idx].ids); }
      idx++;
    }
    await segDone(no, lesson, 'test_review');
  }
  async function redo(no, lesson, done) {
    const r = st.pk[80] || { ids: [] };
    tick(60);
    await answer(no, lesson, 'review', 80, r.ids.filter((id, i) => r.ids.indexOf(id) === i), (id, all) => {
      const subs = r.ids.map((x, i) => (x === id ? (r.sub || [])[i] || 0 : null)).filter((s) => s !== null);
      return all.filter((k) => subs.indexOf(k.sub) > -1);
    });
    r.ids.forEach((id, i) => {
      const sub = (r.sub || [])[i] || 0, x = st.a.filter((y) => y[0] === 80 && y[1] === id && (y[2] || 0) === sub)[0];
      if (x && (r.m || [])[i]) done.push({ entry: { m: r.m[i], id, sub: sub || null }, ok: (x[4] & 1) === 1 });
    });
  }
  async function review(no, lesson, seg, out) {
    const inp = await inputs();
    const plan = await D.planReview(D.reviewOpt(seg, inp), inp.today);
    if (!plan || !plan.units.length) return segDone(no, lesson, 'review', 'skip');
    const c = pick(lesson), seen = new Set(c.seen), hold = await holdOf(c), done = [];
    st = await D.freeze(no, lesson, (await P.pickReview(lesson, st, plan.units, c)).state, [80, 85]);
    await redo(no, lesson, done);
    for (const idx of [81, 82, 83, 84]) {
      const k = st.pk[idx] && /^point_review:(.+)$/.exec(st.pk[idx].r || '');
      if (!k) continue;
      note(out, 'review', idx, R.isGroupKey(k[1]) ? 1 : 3, st.pk[idx].ids, seen, hold);
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
    if (!r.blocks.some((b) => b.ids.length)) { plans.forEach((p) => out.push({ seg: 'weak', want: R.weakCount(p), got: 0 })); return segDone(no, lesson, 'weak', 'skip'); }
    st = await D.freeze(no, lesson, r.state, [85, 90]);
    let idx = 85;
    for (const p of plans) {
      if (idx + (p.base ? 1 : 0) >= 90) break;
      if (p.base) idx++;
      note(out, 'weak', idx, R.weakCount(p), st.pk[idx].ids, seen, hold);
      tick(60);
      await answer(no, lesson, 'weak', idx, st.pk[idx].ids);
      idx++;
    }
    await segDone(no, lesson, 'weak');
  }
  const at = (no) => { t = NOW + DAYS[no - 1] * DAY + 3600; e.clock.set(t); };
  /* 第 no 堂從頭上到尾;回練習區塊的紀錄 */
  async function lesson(no) {
    at(no);
    const L = e.lesson(lvOf(no), no), out = [];
    await fixed(no, L, out);
    const cp = L.segments.filter((s) => s.slot === 'checkpoint')[0];
    if (cp) out.cp = cp.blocks.filter((b) => !b.fill).map((b) => ({ module: b.module, want: b.count, ids: st.pk[b.idx].ids }));
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
  /* 第 no 堂開堂凍結:小檢核每個檢核區塊 { module, want, ids },加上開堂時做過的題與前測題 */
  async function checkpoint(no) {
    at(no);
    const L = e.lesson(lvOf(no), no), c = pick(L);
    const r = await P.pickFixed(L, P.newState(L, t), c);
    const done = new Set([].concat(...Object.keys(c.records).map((p) => Object.keys(c.records[p] || {}).map((k) => k.split(':')[0]))));
    const blocks = L.segments.filter((s) => s.slot === 'checkpoint')[0].blocks.filter((b) => !b.fill).map((b) => ({ module: b.module, want: b.count, ids: r.state.pk[b.idx].ids }));
    return { blocks, done, test: new Set(D.testIds()), pool: new Set(K.POOL.ids) };
  }
  return { e, lesson, checkpoint };
}

const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
const ACCOUNTS = ['5a0c1e2d-3b4a-4c5d-8e6f-7a8b9c0d1e2f', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', '0f1e2d3c-4b5a-4969-8877-665544332211',
  '11111111-2222-4333-8444-555555555555', '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d', '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f'];
const KINDS = { 門檻: { n: 6, lvOf: () => TT, full: true }, 入門升門檻: { n: 3, lvOf: (no) => (no <= 4 ? EE : TT) },
  '門檻(先做檢測)': { n: 6, lvOf: () => TT, full: true, base: '門檻' }, '入門升門檻(先做檢測)': { n: 3, lvOf: (no) => (no <= 4 ? EE : TT), base: '入門升門檻' } };

/* 一個帳號跑第 1–7 堂與第 8 堂開堂 → 第 4、8 堂各區塊題數、第 5–7 堂固定段、弱點補練與違規的檢核題 */
async function runOne(kind, ai, rate) {
  const pid = 'c' + ACCOUNTS[ai].replace(/-/g, '');
  const pl = KINDS[kind].base ? await placementRun(pid, 5000 + ai, rate) : null;
  const s = student(ACCOUNTS[ai], 2000 + ai, KINDS[kind].lvOf, rate, pl);
  await s.e.D.packs();
  const per = {};
  for (let no = 1; no <= 7; no++) per[no] = await s.lesson(no);
  const cp8 = await s.checkpoint(8);
  const bad = [];
  cp8.blocks.forEach((b) => b.ids.forEach((id) => { if (!cp8.pool.has(id) || cp8.done.has(id) || cp8.test.has(id)) bad.push(id); }));
  const fixed = [5, 6, 7].map((no) => per[no].filter((x) => x.seg === 'listening' || x.seg === 'reading'));
  const weakOf = [2, 3, 4, 5, 6, 7].reduce((a, no) => a.concat(per[no].filter((x) => x.seg === 'weak')), []);
  const relaxed = [5, 6, 7].reduce((a, no) => a + per[no].filter((x) => x.relaxed).length, 0);
  const reserved = [1, 2, 3, 4, 5, 6, 7].reduce((a, no) => a + sum(per[no], (x) => x.reserved || 0), 0);
  return { cp4: per[4].cp, cp8: cp8.blocks, bad, fixed, weak: [sum(weakOf, (x) => x.got), sum(weakOf, (x) => x.want)], relaxed, reserved };
}
/* 先做檢測的 r 跟沒做檢測的 base 比:第 4、8 堂哪幾個區塊選到的題比較少 */
function fewer(base, r) {
  const out = [];
  [['cp4', 4], ['cp8', 8]].forEach(([k, no]) => (r[k] || []).forEach((b, i) => {
    const was = (base[k] || [])[i];
    if (was && b.ids.length < was.ids.length) out.push('第 ' + no + ' 堂 ' + b.module + ' ' + b.ids.length + '/' + was.ids.length);
  }));
  return out;
}
const fmt = (blocks) => blocks.map((b) => b.module + ' ' + b.ids.length + '/' + b.want).join('、');
function line(kind, ai, rate, r) {
  return '  ' + kind + ' 帳號' + (ai + 1) + ' ' + Math.round(rate * 100) + '%:第 4 堂 ' + fmt(r.cp4) + ';第 8 堂 ' + fmt(r.cp8)
    + ';第 5–7 堂固定段 ' + r.fixed.map((list) => sum(list, (x) => x.got) + '/' + sum(list, (x) => x.want)).join('、')
    + ';放寬 ' + r.relaxed + ' 塊、用預留題 ' + r.reserved + ' 題;弱點補練 ' + r.weak[0] + '/' + r.weak[1];
}

const T = {};
Object.keys(KINDS).forEach((kind) => {
  T[kind + ':答對率 60%,第 8 堂小檢核' + (KINDS[kind].full ? '每個檢核區塊選滿' : '每個檢核區塊至少 3 題(簡短對話至少 1 組)') + ';檢核題都合規則;第 5–7 堂固定段選滿' + (KINDS[kind].base ? ';第 4、8 堂各區塊不比沒做檢測時少' : '')] = async () => {
    const bad = [];
    for (let ai = 0; ai < KINDS[kind].n; ai++) {
      const r = await runOne(kind, ai, 0.6);
      console.log(line(kind, ai, 0.6, r));
      const short = r.cp8.filter((b) => (KINDS[kind].full ? b.ids.length < b.want : b.ids.length < Math.min(b.want, b.module === 'p3' ? 1 : 3)));
      if (short.length) bad.push('帳號' + (ai + 1) + ' 選不滿 ' + fmt(short));
      if (r.bad.length) bad.push('帳號' + (ai + 1) + ' 檢核題不合規則 ' + r.bad.join(','));
      if (KINDS[kind].base) fewer(await runOne(KINDS[kind].base, ai, 0.6), r).forEach((x) => bad.push('帳號' + (ai + 1) + ' 比沒做檢測少 ' + x));
      r.fixed.forEach((list, i) => list.filter((x) => x.got !== x.want).forEach((x) => bad.push('帳號' + (ai + 1) + ' 第 ' + (5 + i) + ' 堂區塊 ' + x.idx + ' ' + x.got + '/' + x.want)));
    }
    eq(bad, [], kind);
    return KINDS[kind].n + ' 個帳號';
  };
});
T['答對率 40%、85%(只印數字)'] = async () => {
  for (const rate of [0.4, 0.85]) {
    for (const kind of Object.keys(KINDS)) {
      for (let ai = 0; ai < KINDS[kind].n; ai++) {
        const r = await runOne(kind, ai, rate);
        console.log(line(kind, ai, rate, r) + (r.bad.length ? ';不合規則 ' + r.bad.join(',') : ''));
      }
    }
  }
  return '印出';
};

process.on('beforeExit', () => { console.log('FAIL 有一支測試一直沒有結束'); process.exit(1); });
K.run(T);
