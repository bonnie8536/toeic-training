/* 課程進度跨裝置同步:真的 js/cloud.js 的上傳、灌雲端資料、登出前對帳,加上 js/pack-core.js 的開堂與交卷。
   les_t<期>_<堂>、pts、rvq、tests_v1 在 cloud.js 的合併表上,任何一條路都不會整份蓋掉另一台的作答。
   假的 Supabase 與多台裝置在 tools/sync_harness.js;頁面載入真的 js/sync-merge.js、js/sync-merge-lesson.js、js/cloud.js,再載入 js/lesson-rules.js、js/pack-core.js。
   用法:node tools/test_lesson_sync.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const H = require('./sync_harness');
const { J, tick, makeWorld, makeDevice, signIn, newSession, logout, localOf, cloudOf, ledgerOf, storeSet, now, setCloud, PREFIX, USER } = H;

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const PACKS = { entry: JSON.parse(read('data/packs/pack_entry.json')), threshold: JSON.parse(read('data/packs/pack_threshold.json')) };
const SCRIPTS = ['js/lesson-rules.js', 'js/pack-util.js', 'js/pack-core.js'].map((f) => new vm.Script(read(f), { filename: f }));
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

/* 課程的四個合併函式放在 js/sync-merge-lesson.js(從 js/sync-merge.js 分出來):接在 sync-merge.js 後面載入時把它們加進 SYNC_MERGE,
   原有的函式是同一個、還是凍結的;sync-merge.js 沒載到就什麼都不做(不丟錯、不建 SYNC_MERGE);檔案本身不讀寫儲存、不碰畫面 */
T['S8 js/sync-merge-lesson.js:接在 sync-merge.js 後面載入,SYNC_MERGE 多 lesson、pts、rvq、tests、mockSeen、plan,原有的函式不變、還是凍結的;單獨載入不做事'] = async () => {
  const COURSE = ['lesson', 'pts', 'rvq', 'tests', 'mockSeen', 'plan'];
  const c = { console };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(read('js/sync-merge.js'), c, { filename: 'js/sync-merge.js' });
  const before = c.SYNC_MERGE;
  vm.runInContext(read('js/sync-merge-lesson.js'), c, { filename: 'js/sync-merge-lesson.js' });
  const after = c.SYNC_MERGE;
  const alone = { console };
  alone.window = alone;
  vm.createContext(alone);
  let threw = false;
  try { vm.runInContext(read('js/sync-merge-lesson.js'), alone, { filename: 'js/sync-merge-lesson.js' }); } catch (e) { threw = true; }
  const code = read('js/sync-merge-lesson.js').replace(/\/\*[\s\S]*?\*\//g, '');
  const got = {
    added: Object.keys(after).filter((k) => !(k in before)).sort(),
    kept: Object.keys(before).every((k) => after[k] === before[k]),
    frozen: Object.isFrozen(after),
    works: after.pts(null, { 'P2.wh': { s: 'learning', hits: [], pauseUntil: null } }).ok === true && after.rvq([], null).ok === true,
    alone: !threw && alone.SYNC_MERGE === undefined,
    pure: !/localStorage|sessionStorage|document|store\./.test(code),
  };
  const ok = J(got.added) === J(COURSE.slice().sort()) && COURSE.every((k) => typeof after[k] === 'function') && got.kept && got.frozen && got.works && got.alone && got.pure;
  return { ok, detail: J(got) };
};

/* 一堂的進度(直接寫本機用,不經課程引擎) */
const lessonOf = (ids) => ({ v: 1, lessonId: { listening: 'entry-L03' }, packVersion: { listening: '1.2.0' }, levels: { listening: 'entry' }, startedAt: 1000, doneAt: null,
  seg: {}, pk: {}, a: ids.map((id, i) => [4, id, 0, 1, 3, i + 1]) });
const marksOf = (dev) => JSON.parse(dev.local.getItem('tr_localonly_' + USER.id) || '{}');

/* 登出前對帳(js/cloud.js checkCloud):合併表上 reconcile 的鍵。pts、rvq、tests_v1 本機比雲端多、帳本是空的
   (別台少的那份剛蓋掉雲端,這台上次對齊之後沒改過):對帳那一次查詢要讀這三個鍵,合併後補回雲端,登出刪本機也不會少 */
T['S9 pts、rvq、tests_v1 登出前對帳:本機比雲端多一筆、帳本空的,對帳讀這三個鍵,合併上傳後雲端是聯集'] = async () => {
  const { w, phone } = await twoDevices(10);
  const hit = (b) => ({ s: 'learning', hits: [{ d: '2026-10-24', n: 1, ok: 1, src: 'p', b }], pauseUntil: null });
  const q = (id) => ({ m: 'p5', id, sub: null, due: '2026-10-25', step: 1, d0: '2026-10-24' });
  setCloud(w, 'pts', { 'P2.wh': hit('a') });
  setCloud(w, 'rvq', [q('p5-a')]);
  setCloud(w, 'tests_v1', { t1: { pre: { form: 'half', at: 500 } } });
  phone.local.setItem(PREFIX + 'pts', J({ 'P2.wh': hit('a'), 'P5.cat:x': hit('b') }));
  phone.local.setItem(PREFIX + 'rvq', J([q('p5-a'), q('p5-b')]));
  phone.local.setItem(PREFIX + 'tests_v1', J({ t1: { pre: { form: 'half', at: 500 }, mid: { form: 'half', at: 900 } } }));
  phone.ops = [];
  const out = await logout(phone);
  const recon = phone.ops.filter((o) => o.op === 'read' && o.viaIn).map((o) => o.keys)[0] || [];
  const pts = cloudOf(w, 'pts') || {}, rvq = cloudOf(w, 'rvq') || [], tests = cloudOf(w, 'tests_v1') || {};
  const ok = out && ['pts', 'rvq', 'tests_v1'].every((k) => recon.indexOf(k) > -1)
    && J(Object.keys(pts).sort()) === J(['P2.wh', 'P5.cat:x']) && J(rvq.map((e) => e.id).sort()) === J(['p5-a', 'p5-b'])
    && J(Object.keys(tests.t1 || {}).sort()) === J(['mid', 'pre']) && localOf(phone, 'pts') === null;
  return { ok, detail: J({ out, recon, pts: Object.keys(pts), rvq: rvq.map((e) => e.id), tests }) };
};

/* 「只在本機」的標記(js/cloud.js markLocalOnly,合併表上的鍵都可以記,一堂一鍵的課程進度也是):灌雲端資料時合併過就劃掉,
   不然登出前一直算成「還沒同步」 */
T['S10 一堂的進度記著「只在本機」標記、跟雲端一樣:開新分頁灌資料合併過,標記劃掉'] = async () => {
  const { w, phone } = await twoDevices(11);
  setCloud(w, KEY, lessonOf(['l1-03']));
  phone.local.setItem(PREFIX + KEY, J(lessonOf(['l1-03'])));
  phone.pg.ctx.CLOUD.markLocalOnly(KEY);
  const marked = KEY in marksOf(phone);
  await newSession(phone);
  await phone.pg.runTimers();
  const ok = marked && !(KEY in marksOf(phone)) && J(answered(localOf(phone, KEY))) === J(['l1-03']);
  return { ok, detail: J({ marked, marks: marksOf(phone), local: answered(localOf(phone, KEY)) }) };
};

/* 登出補傳(js/cloud.js unsynced):補傳那一輪讀雲端時,另一個分頁把這一堂的進度寫成合併過的新版本(不經帳本),合併上傳因為本機變了而放棄。
   補傳前後比對的狀態要看得到一堂一鍵的課程進度變了,才會再補傳一次;不然只剩登出前對帳,對帳上傳時再碰上一次寫入就要問「還沒同步」 */
T['S11 登出補傳時另一個分頁連續寫了三次這一堂的進度:補傳再試、對帳補上,不問就登出,雲端有每一次寫的作答'] = async () => {
  const { w, phone } = await twoDevices(12);
  setCloud(w, KEY, lessonOf(['l1-01']));   // 筆電之前傳過這一堂
  phone.offline = true;
  storeSet(phone, KEY, lessonOf(['l1-03']));
  await phone.pg.runTimers();
  const held = KEY in ledgerOf(phone);
  phone.offline = false;
  const ids = ['l1-03'];
  let n = 0;
  const arm = () => { phone.onRead = () => { n++; ids.push('l1-0' + (4 + n)); phone.local.setItem(PREFIX + KEY, J(lessonOf(ids))); if (n < 3) arm(); }; };
  arm();
  const out = await logout(phone);
  phone.onRead = null;
  const ok = held && n === 3 && out && phone.confirms.length === 0 && J(answered(cloudOf(w, KEY))) === J(['l1-01'].concat(ids).sort());
  return { ok, detail: J({ held, n, out, confirms: phone.confirms.length, cloud: answered(cloudOf(w, KEY)) }) };
};

/* ---------- mock_seen(模擬考作答過的題)與 plan(課表設定) ---------- */
const PLAN0 = { v: 1, source: 'self', classId: 'k1', packs: { listening: 'pack-entry-v1', reading: 'pack-entry-v1' }, packVersions: { listening: '1.0.0', reading: '1.0.0' },
  startDate: '2026-11-02', lessonsPerWeek: null, mainDay: 1, extDay: null, term: 1, postponedWeeks: 0, previous: null, updatedAt: 1000 };
const planOf = (extra) => Object.assign({}, PLAN0, extra || {});
T['S12 SYNC_MERGE.mockSeen:聯集、同一題取大的、不是數字的輸、超過 3,000 筆留新的、key 照字典序;形狀不對 ok:false;跟參數順序無關'] = async () => {
  const SM = makeWorld(13).SM, f = SM.mockSeen;
  const r1 = f({ b: 5, a: 9 }, { a: 3, c: 'x', b: 7 });
  const r2 = f({ c: 1 }, { c: 'x' });
  const big = {};
  for (let i = 0; i < 3005; i++) big['k' + String(i).padStart(4, '0')] = i;
  const r3 = f(big, null);
  const same = f({ a: 1, b: 2 }, { b: 2, a: 1 });
  const got = {
    r1: J(r1.v), keys: Object.keys(r1.v).join(','), r2: r2.v.c, n3: Object.keys(r3.v).length, low: 'k0000' in r3.v || 'k0004' in r3.v, hi: 'k3004' in r3.v,
    bad: [f([], {}).ok, f({}, 'x').ok, f(null, 3).ok], none: J(f(null, undefined)), same: [same.sameAsLocal, same.sameAsCloud], loc: f({ a: 1 }, null).sameAsLocal,
    order: J(f({ a: 2, b: 'z' }, { a: 3, b: 'y' }).v) === J(f({ a: 3, b: 'y' }, { a: 2, b: 'z' }).v),
  };
  const ok = got.r1 === J({ a: 9, b: 7, c: 'x' }) && got.keys === 'a,b,c' && got.r2 === 1 && got.n3 === 3000 && !got.low && got.hi
    && J(got.bad) === J([false, false, false]) && got.none === J({ ok: true, v: null, sameAsLocal: true, sameAsCloud: false }) && J(got.same) === J([true, true]) && got.loc && got.order;
  return { ok, detail: J(got) };
};
T['S13 SYNC_MERGE.plan:updatedAt 新的為主;開始日取早的、每週堂數照週聯集(同一週取主要那份)、問過的時間取早的;未來一天以後的時間不算;v 不是 1 不合併;舊 plan 不加新欄位'] = async () => {
  const SM = makeWorld(14).SM, f = (a, b, now) => SM.plan(a, b, now === undefined ? 5000 : now);
  const a = planOf({ startDate: '2026-11-09', perWeek: [{ w: 1, n: 2 }, { w: 3, n: 1 }], weeklyAskedAt: '2026-11-10T01:00:00.000Z', lessonsPerWeek: 1, updatedAt: 3000, mainDay: 3 });
  const b = planOf({ startDate: '2026-11-02', perWeek: [{ w: 3, n: 2 }, { w: 2, n: 1 }], weeklyAskedAt: '2026-11-09T01:00:00.000Z', lessonsPerWeek: 2, updatedAt: 2000, mainDay: 5 });
  const m = f(a, b).v, m2 = f(b, a).v;
  const future = f(planOf({ updatedAt: 5000 + 2 * 864e5, mainDay: 6 }), planOf({ updatedAt: 1500, mainDay: 2 })).v;
  const old = f(planOf({ updatedAt: 1200 }), planOf({ updatedAt: 1100, startDate: '2026-11-01' }));
  const got = {
    main: m.mainDay, start: m.startDate, per: J(m.perWeek), asked: m.weeklyAskedAt, lpw: m.lessonsPerWeek, sym: J(m) === J(m2),
    future: future.mainDay, bad: [f(planOf({ v: 2 }), a).ok, f('x', a).ok, f({ updatedAt: 1 }, a).ok], one: f(a, null).v === a,
    oldKeys: ['perWeek', 'weeklyAskedAt'].filter((k) => k in old.v), oldStart: old.v.startDate, same: f(a, a).sameAsLocal && f(a, a).sameAsCloud,
  };
  const ok = got.main === 3 && got.start === '2026-11-02' && got.per === J([{ w: 1, n: 2 }, { w: 2, n: 1 }, { w: 3, n: 1 }]) && got.asked === '2026-11-09T01:00:00.000Z'
    && got.lpw === 1 && got.sym && got.future === 2 && J(got.bad) === J([false, false, false]) && got.one && J(got.oldKeys) === '[]' && got.oldStart === '2026-11-01' && got.same;
  return { ok, detail: J(got) };
};
T['S14 A 台選每週 1 堂、B 台還沒拿到就按「之後再選」(B 比較新):合併後每週堂數留 A 的、問過的時間是 A 的'] = async () => {
  const SM = makeWorld(15).SM;
  const A = planOf({ perWeek: [{ w: 1, n: 1 }], weeklyAskedAt: '2026-11-03T02:00:00.000Z', lessonsPerWeek: 1, updatedAt: 3000 });
  const B = planOf({ perWeek: [], weeklyAskedAt: '2026-11-03T05:00:00.000Z', updatedAt: 4000 });
  const old = planOf({ updatedAt: 2500 });
  const m = SM.plan(A, B, 5000).v, m2 = SM.plan(old, A, 5000).v;
  const got = { per: J(m.perWeek), asked: m.weeklyAskedAt, lpw: m.lessonsPerWeek, withOld: J(m2.perWeek), oldAsked: m2.weeklyAskedAt };
  const ok = got.per === J([{ w: 1, n: 1 }]) && got.asked === '2026-11-03T02:00:00.000Z' && got.lpw === 1 && got.withOld === J([{ w: 1, n: 1 }]) && got.oldAsked === '2026-11-03T02:00:00.000Z';
  return { ok, detail: J(got) };
};
T['S15 兩台用真的 cloud.js:手機改每週堂數、筆電做模擬考;兩邊上傳後雲端與兩台都有兩邊的改動;灌雲端資料時本機與雲端都有就存合併結果'] = async () => {
  const { w, phone, pc } = await twoDevices(16);
  const base = planOf({ perWeek: [], weeklyAskedAt: null, updatedAt: now(phone) });
  storeSet(phone, 'plan', base);
  storeSet(phone, 'mock_seen', { 'l1-01': now(phone) });
  await phone.pg.runTimers();
  await newSession(pc);
  phone.offline = true;
  storeSet(phone, 'plan', Object.assign({}, base, { perWeek: [{ w: 1, n: 1 }], weeklyAskedAt: new Date(now(phone)).toISOString(), lessonsPerWeek: 1, updatedAt: now(phone) }));
  await phone.pg.runTimers();
  w.clock.t += HOUR;
  storeSet(pc, 'mock_seen', Object.assign({}, localOf(pc, 'mock_seen'), { 'p5-a': now(pc), 'l2-01': now(pc) }));
  storeSet(pc, 'plan', Object.assign({}, localOf(pc, 'plan'), { weeklyAskedAt: new Date(now(pc)).toISOString(), updatedAt: now(pc) }));
  await pc.pg.runTimers();
  phone.offline = false;
  await newSession(phone);
  await phone.pg.runTimers();
  await newSession(pc);
  const c = { plan: cloudOf(w, 'plan'), seen: cloudOf(w, 'mock_seen') };
  const keys = (v) => Object.keys(v || {}).sort().join(',');
  const got = { per: J((c.plan || {}).perWeek), asked: (c.plan || {}).weeklyAskedAt, seen: keys(c.seen), phone: J(localOf(phone, 'plan')) === J(c.plan) && keys(localOf(phone, 'mock_seen')) === keys(c.seen),
    pc: J(localOf(pc, 'plan')) === J(c.plan) && keys(localOf(pc, 'mock_seen')) === keys(c.seen) };
  const ok = got.per === J([{ w: 1, n: 1 }]) && got.seen === 'l1-01,l2-01,p5-a' && got.phone && got.pc && !!got.asked && Date.parse(got.asked) < now(pc) - HOUR / 2;
  return { ok, detail: J(got) };
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
