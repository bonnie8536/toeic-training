/* 課程進度跨裝置同步:真的 js/cloud.js 的上傳、灌雲端資料、登出前對帳,加上 js/pack-core.js 的開堂與交卷。
   les_t<期>_<堂>、pts、rvq、tests_v1 在 cloud.js 的合併表上,任何一條路都不會整份蓋掉另一台的作答。
   假的 Supabase 與多台裝置在 tools/sync_harness.js;頁面載入真的 js/sync-merge.js、js/cloud.js,再載入 js/lesson-rules.js、js/pack-core.js。
   用法:node tools/test_lesson_sync.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const H = require('./sync_harness');
const { J, tick, makeWorld, makeDevice, signIn, newSession, logout, localOf, cloudOf, ledgerOf, storeSet, now } = H;

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const PACKS = { entry: JSON.parse(read('data/packs/pack_entry.json')), threshold: JSON.parse(read('data/packs/pack_threshold.json')) };
const SCRIPTS = ['js/lesson-rules.js', 'js/pack-core.js'].map((f) => new vm.Script(read(f), { filename: f }));
const LV = { listening: 'entry', reading: 'entry' };
const KEY = 'les_t1_03';
const HOUR = 3600e3;

/* 這台頁面上的課程引擎;store 跟網站一樣:寫本機 + CLOUD.push */
function core(dev) {
  const ctx = dev.pg.ctx;
  if (!ctx.PACK_CORE) { ctx.TextEncoder = TextEncoder; SCRIPTS.forEach((s) => s.runInContext(ctx)); }
  const store = { get: (k, fb) => { const v = localOf(dev, k); return v === null ? fb : v; }, set: (k, v) => storeSet(dev, k, v) };
  return { P: ctx.PACK_CORE, R: ctx.LESSON_RULES, deps: { store } };
}
const sec = (dev) => Math.floor(now(dev) / 1000);
/* 做完第 3 堂的一段:那一段第一個區塊凍結 ids、全部作答、交卷(saveLesson:先讀雲端合併) */
async function doSegment(dev, slot, ids) {
  const { P, deps } = core(dev);
  const l = P.compose(PACKS, LV, 3);
  const t = sec(dev), blk = l.segments.filter((s) => s.slot === slot)[0].blocks[0];
  return P.saveLesson(1, 3, (s) => {
    let st = P.freeze(s || P.newState(l, t), blk.idx, ids, t);
    ids.forEach((id, i) => { st = P.answer(st, { b: blk.idx, id, c: 0, ok: true, f: true, t: t + i + 1 }); });
    return P.setSegment(st, l, slot, 'done', t + ids.length + 1);
  }, deps);
}
const answered = (v) => (v && Array.isArray(v.a) ? v.a.map((x) => x[1]).sort() : []);
const LIS = ['l1-03', 'l1-05'], RD = ['p5-c1-1', 'p5-c1-2'];
const BOTH = LIS.concat(RD).sort();
const writesOf = (dev, k) => dev.ops.filter((o) => o.op === 'write' && o.keys.indexOf(k) >= 0);

async function twoDevices(seed) {
  const w = makeWorld(seed || 3);
  const phone = makeDevice(w, '手機'), pc = makeDevice(w, '筆電');
  await signIn(phone);
  await signIn(pc);
  return { w, phone, pc };
}

const T = {};

T['S1 手機離線做聽力段(帳本記著)、筆電一小時後做閱讀段並上傳;手機恢復連線開新分頁:雲端那份比帳本新也合併,不蓋掉手機的作答'] = async () => {
  const { w, phone, pc } = await twoDevices(3);
  phone.offline = true;
  await doSegment(phone, 'listening', LIS);
  await phone.pg.runTimers();
  const held = KEY in ledgerOf(phone);
  w.clock.t += HOUR;
  await doSegment(pc, 'reading', RD);
  await pc.pg.runTimers();
  phone.offline = false;
  await newSession(phone);
  await newSession(pc);
  const ok = held && J(answered(cloudOf(w, KEY))) === J(BOTH) && J(answered(localOf(phone, KEY))) === J(BOTH) && J(answered(localOf(pc, KEY))) === J(BOTH)
    && localOf(phone, KEY).seg.listening.st === 'done' && localOf(phone, KEY).seg.reading.st === 'done' && !(KEY in ledgerOf(phone));
  return { ok, detail: J({ held, cloud: answered(cloudOf(w, KEY)), phone: answered(localOf(phone, KEY)), pc: answered(localOf(pc, KEY)) }) };
};

T['S2 同一個情境但手機分頁一直開著、恢復連線(online 事件補傳):上傳前先讀雲端合併,兩段都在'] = async () => {
  const { w, phone, pc } = await twoDevices(4);
  phone.offline = true;
  await doSegment(phone, 'listening', LIS);
  await phone.pg.runTimers();
  w.clock.t += HOUR;
  await doSegment(pc, 'reading', RD);
  await pc.pg.runTimers();
  phone.offline = false;
  await phone.pg.fire('win:online');
  await tick(20);
  const ok = J(answered(cloudOf(w, KEY))) === J(BOTH) && J(answered(localOf(phone, KEY))) === J(BOTH) && !Object.keys(ledgerOf(phone)).length;
  return { ok, detail: J({ cloud: answered(cloudOf(w, KEY)), phone: answered(localOf(phone, KEY)), ledger: ledgerOf(phone) }) };
};

T['S3 開堂讀雲端逾時(讀不到):照本機寫,cloud.js 不整份上傳(帳本留著);讀得到之後補傳時合併,筆電的段沒有被蓋掉'] = async () => {
  const { w, phone, pc } = await twoDevices(5);
  await doSegment(pc, 'reading', RD);
  await pc.pg.runTimers();
  phone.readError = true;
  const r = await doSegment(phone, 'listening', LIS);
  await phone.pg.runTimers();
  const noPlain = writesOf(phone, KEY).length === 0 && J(answered(cloudOf(w, KEY))) === J(RD.slice().sort()) && KEY in ledgerOf(phone);
  phone.readError = false;
  await phone.pg.fire('win:online');
  await tick(20);
  const ok = !r.cloudRead && noPlain && J(answered(cloudOf(w, KEY))) === J(BOTH) && J(answered(localOf(phone, KEY))) === J(BOTH);
  return { ok, detail: J({ cloudRead: r.cloudRead, noPlain, cloud: answered(cloudOf(w, KEY)) }) };
};

/* 兩台幾乎同時交卷:筆電讀了雲端(還沒有手機的)、上傳卡住;手機上傳完;筆電的上傳才到,雲端變成只有筆電的 */
async function race(seed) {
  const { w, phone, pc } = await twoDevices(seed);
  await doSegment(pc, 'reading', RD);
  await doSegment(phone, 'listening', LIS);
  let release;
  pc.writeGate = new Promise((r) => { release = r; });
  const pcUp = pc.pg.runTimers();
  await tick(10);
  await phone.pg.runTimers();
  release(); pc.writeGate = null;
  await pcUp;
  return { w, phone, pc, lostInCloud: J(answered(cloudOf(w, KEY))) === J(RD.slice().sort()) };
}

T['S4 兩台幾乎同時交卷,後到的上傳蓋掉了雲端的手機作答;手機之後開新分頁:合併後補傳,雲端兩段都在'] = async () => {
  const { w, phone, pc, lostInCloud } = await race(6);
  await newSession(phone);
  await newSession(pc);
  const ok = lostInCloud && J(answered(cloudOf(w, KEY))) === J(BOTH) && J(answered(localOf(pc, KEY))) === J(BOTH);
  return { ok, detail: J({ lostInCloud, cloud: answered(cloudOf(w, KEY)), pc: answered(localOf(pc, KEY)) }) };
};

T['S5 同一個情境,手機直接登出(本機會刪):登出前對帳發現雲端少了,先合併上傳再刪,作答不會永久消失'] = async () => {
  const { w, phone, lostInCloud } = await race(7);
  const out = await logout(phone);
  const ok = lostInCloud && out && J(answered(cloudOf(w, KEY))) === J(BOTH) && localOf(phone, KEY) === null;
  return { ok, detail: J({ lostInCloud, out, cloud: answered(cloudOf(w, KEY)) }) };
};

T['S6 pts、rvq、tests_v1:手機離線記考點作答、做完一題回顧(移出),筆電記別的考點、佇列還是舊的;合併後兩邊的批次都在,做完的回顧不會回來'] = async () => {
  const { w, phone, pc } = await twoDevices(8);
  const D0 = '2026-10-01', ref = { m: 'p5', id: 'p5-c1-1', sub: null };
  const seed = core(pc);
  await seed.P.saveShared('rvq', (q) => seed.R.scheduleWrong(q, ref, D0), D0, seed.deps);
  await pc.pg.runTimers();
  await newSession(phone);
  phone.offline = true;
  const a = core(phone);
  await a.P.saveShared('pts', (p) => a.R.addHits(p, [{ key: 'P2.wh', ok: true, first: true }], { today: '2026-10-24', src: 'p', b: 'phone1' }), '2026-10-24', a.deps);
  let q = localOf(phone, 'rvq');
  ['2026-10-02', '2026-10-08', '2026-10-22'].forEach((d) => { q = a.R.reviewDone(q, ref, true, d); });
  await a.P.saveShared('rvq', () => q, '2026-10-24', a.deps);
  await a.P.saveShared('tests_v1', (t) => Object.assign({}, t, { t1: { pre: { form: 'half', at: 500 } } }), '2026-10-24', a.deps);
  await phone.pg.runTimers();
  w.clock.t += HOUR;
  const b = core(pc);
  await b.P.saveShared('pts', (p) => b.R.addHits(p, [{ key: 'P5.cat:代名詞', ok: false, first: true }], { today: '2026-10-24', src: 'p', b: 'pc1' }), '2026-10-24', b.deps);
  await b.P.saveShared('rvq', (x) => b.R.scheduleWrong(x, { m: 'p5', id: 'p5-c1-2' }, '2026-10-24'), '2026-10-24', b.deps);
  await b.P.saveShared('tests_v1', (t) => Object.assign({}, t, { t1: { mid: { form: 'half', at: 900 } } }), '2026-10-24', b.deps);
  await pc.pg.runTimers();
  phone.offline = false;
  await newSession(phone);
  await newSession(pc);
  const pts = cloudOf(w, 'pts') || {}, rvq = cloudOf(w, 'rvq') || [], tests = cloudOf(w, 'tests_v1') || {};
  const liveIds = rvq.filter((e) => !e.x).map((e) => e.id);
  const ok = !!pts['P2.wh'] && !!pts['P5.cat:代名詞'] && J(liveIds) === J(['p5-c1-2']) && !!(tests.t1 && tests.t1.pre && tests.t1.mid)
    && J(localOf(pc, 'rvq')) === J(rvq) && J(localOf(phone, 'pts')) === J(pts);
  return { ok, detail: J({ pts: Object.keys(pts), rvq, tests }) };
};

T['S7 合併函式會收斂:SYNC_MERGE.lesson、pts、rvq、tests 跟參數順序無關、重複合併不變、合併結果再跟任一份合併也不變'] = async () => {
  const w = makeWorld(9), SM = w.SM, rnd = w.rand, pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const canon = (x) => SM.canon(x);
  const gen = {
    lesson: () => {
      const start = 1000 + Math.floor(rnd() * 3);
      const seg = {};
      ['vocab', 'listening', 'weak'].forEach((s) => { const st = pick(['todo', 'doing', 'done', 'skip']); seg[s] = { st, t0: st === 'todo' ? null : start + 5, t1: st === 'done' || st === 'skip' ? start + Math.floor(rnd() * 50) : null }; });
      const pk = {};
      [3, 85, 86].forEach((k) => { if (rnd() < 0.7) pk[k] = { at: Math.floor(rnd() * 20), ids: [pick(['a', 'b', 'c'])] }; });
      const a = Array.from({ length: Math.floor(rnd() * 4) }, () => [pick([3, 85]), pick(['a', 'b', 'c']), 0, 1, pick([1, 3]), Math.floor(rnd() * 30)]);
      return { v: 1, lessonId: { listening: 'x' }, packVersion: { listening: '1' }, levels: { listening: pick(['entry', 'entry', 'threshold']) }, startedAt: start, doneAt: null, seg, pk, a };
    },
    pts: () => ({ 'P2.wh': { s: pick(['met', 'learning']), hits: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({ d: pick(['2026-10-01', '2026-10-02']), n: pick([1, 5]), ok: 1, src: 'p', b: pick(['x', 'y', 'z']) })), pauseUntil: pick([null, '2026-10-09']) } }),
    rvq: () => [pick([{ m: 'p5', id: 'q', sub: null, due: '2026-10-02', step: 1, d0: '2026-10-01' }, { m: 'p5', id: 'q', sub: null, due: '2026-10-08', step: 7, d0: '2026-10-01' },
      { m: 'p5', id: 'q', sub: null, step: 21, d0: '2026-10-01', x: '2026-10-22' }, { m: 'p5', id: 'q', sub: null, due: '2026-10-26', step: 1, d0: '2026-10-25' }])],
    tests: () => ({ t1: { pre: { at: pick([5, 9]), f: pick(['a', 'b']) } } }),
  };
  const bad = [];
  Object.keys(gen).forEach((fn) => {
    for (let i = 0; i < 300; i++) {
      const a = gen[fn](), b = gen[fn](), m = (x, y) => SM[fn](x, y).v;
      const ab = m(a, b), ba = m(b, a);
      if (canon(ab) !== canon(ba)) { bad.push(fn + ' 順序'); break; }
      if (canon(m(ab, ab)) !== canon(ab) || canon(m(ab, a)) !== canon(ab) || canon(m(b, ab)) !== canon(ab)) { bad.push(fn + ' 收斂'); break; }
    }
  });
  return { ok: !bad.length, detail: J(bad) };
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let r;
    try { r = await T[name](); } catch (e) { r = { ok: false, detail: e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + (r.ok ? '' : '  →  ' + String(r.detail).slice(0, 600)));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
