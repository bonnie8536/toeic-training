/* 小雞第二階段的獎勵規則測試(規格 4.3、5.2、附錄 A.2、附錄 C 第 6 到 14 條):js/pet-food.js。
   用法:node tools/test_pet_food.js
   js/pet.js 與 js/pet-food.js 在沒有 store、document、localStorage 的沙盒裡載入;輸入一律深度凍結,改到就丟錯。
   最後用 TZ=UTC 與 TZ=America/Los_Angeles 各再跑一次,確認日期只看台北時間。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const SRC_PET = read('js/pet.js');
const SRC_FOOD = fs.existsSync(path.join(REPO, 'js/pet-food.js')) ? read('js/pet-food.js') : '';
function load() {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(SRC_PET, ctx);
  if (SRC_FOOD) vm.runInContext(SRC_FOOD, ctx);
  return ctx.PET;
}
const P = load();

function freeze(o) { if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); } return o; }
function tp(s) { return Date.parse(s.replace(' ', 'T') + '+08:00'); }
function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
function range(from, count) { return Array.from({ length: count }, (_, i) => addDays(from, i)); }
const now = d => tp(d + ' 12:00:00');
const J = x => JSON.stringify(x);
function dayHist(d, n, m = 'p5') { const t0 = tp(d + ' 10:00:00'); return Array.from({ length: n }, (_, i) => ({ m, id: m + '-' + d + '-' + i, c: 0, ok: true, t: t0 + i * 10000 })); }

const FROM = '2026-11-01';
const D = '2026-11-10';
/* 一份今天(D)有練習的紀錄;over 蓋過去 */
function pet(over) { return Object.assign({ v: 1, born: '2026-11-01', goals: [], days: { [D]: 6 }, met: [], oldMet: 0, oldBefore: '', fed: {}, name: '小黃', nameAt: 1 }, over || {}); }
function earn(p, id, at, from) { return P.earn(freeze(p), { id, at: at === undefined ? now(D) : at, from: from || FROM }, at === undefined ? now(D) : Math.max(at, now(D))); }
/* n 張某種食物的券(不同天,都在 D 之前) */
function tickets(food, n, endDay) { const got = {}; range(addDays(endDay || D, -n), n).forEach((d, i) => { got[d] = { ['r:t' + i]: food }; }); return got; }

const TABLE = [
  ['d', 'corn'], ['g:ga-01', 'pea'], ['pn:short-a', 'pea'], ['iv', 'pea'],
  ['fall', 'berry'], ['pairs', 'berry'], ['toast', 'berry'], ['mcq', 'berry'], ['ph', 'berry'],
  ['r:art-03', 'tomato'], ['tq:art-03', 'tomato'], ['p5', 'tomato'], ['p6', 'tomato'], ['p7', 'tomato'], ['pr', 'tomato'],
  ['l1', 'tomato'], ['l2', 'tomato'], ['l3', 'tomato'], ['l4', 'tomato'], ['es', 'tomato'], ['ed', 'tomato'], ['emp', 'tomato'], ['en', 'tomato'], ['rv', 'tomato'], ['dlg:d-001', 'tomato'],
  ['mock', 'melon'], ['diag', 'melon'], ['wr:w1-lesson-1', 'greens'], ['m', 'greens'],
];

const T = {};

/* ---------- 來源 id ---------- */
T['sourceFood:對照表每一列,特別的日子 y、w:s、w:a 也對;不認得的回空字串'] = () => {
  const bad = TABLE.filter(([id, f]) => P.sourceFood(id) !== f).map(x => x[0]);
  const sp = [['y', 'yam'], ['w:s1', 'worm'], ['w:s6', 'worm'], ['w:a1', 'worm'], ['w:a12', 'worm']].filter(([id, f]) => P.sourceFood(id) !== f).map(x => x[0]);
  const none = ['x', 'g:', 'G:GA-01', 'l5', 'p8', 'w:s7', 'w:s0', 'w:a0', 'w:a', 'r:' + 'a'.repeat(30), '', null, 5, 'grain', 'corn', 'dd', 'r:a b'].filter(id => P.sourceFood(id) !== '');
  return { ok: !bad.length && !sp.length && !none.length && P.ROUND_MIN === 5, detail: J({ bad, sp, none }) };
};
T['earn:對照表每一列各拿一次,種類照表(含寫作給青江菜、達標給青江菜)'] = () => {
  const bad = [];
  TABLE.forEach(([id, f]) => {
    const r = earn(pet(), id);
    if (!(r.result === 'got' && r.food === f && r.id === id && r.date === D && r.pet.got[D][id] === f && r.pet.v === 2)) bad.push(id + ' ' + J([r.result, r.food, r.id]));
  });
  return { ok: !bad.length, detail: bad.slice(0, 4).join(' | ') || TABLE.length + ' 列都對' };
};
T['earn:off(版本不認得、上線日不對、早於上線日、時間差超過 7 天)與 bad(不認得的 id、特別日子的 id 不能當來源)'] = () => {
  const offs = [
    P.earn(freeze({ v: 3 }), { id: 'd', at: now(D), from: FROM }, now(D)),
    P.earn(freeze(pet()), { id: 'd', at: now(D), from: '' }, now(D)),
    P.earn(freeze(pet()), { id: 'd', at: now(D), from: '2026-13-01' }, now(D)),
    P.earn(freeze(pet()), { id: 'd', at: now('2026-10-31'), from: FROM }, now('2026-10-31')),
    P.earn(freeze(pet()), { id: 'd', at: now(D) + 8 * 864e5, from: FROM }, now(D)),
    P.earn(freeze(pet()), { id: 'd', at: now(D) - 8 * 864e5, from: FROM }, now(D)),
    P.earn(freeze(pet()), { id: 'd', at: NaN, from: FROM }, now(D)),
  ].map(r => r.result);
  const bads = ['x', 'y', 'w:s3', '', 'grain'].map(id => P.earn(freeze(pet()), { id, at: now(D), from: FROM }, now(D)).result);
  const offBeforeBad = P.earn(freeze({ v: 3 }), { id: 'x', at: now(D), from: FROM }, now(D)).result;
  return { ok: offs.every(x => x === 'off') && bads.every(x => x === 'bad') && offBeforeBad === 'off', detail: J({ offs, bads, offBeforeBad }) };
};
T['earn:拒絕時不回 pet、什麼都不寫;拿到時只多一張券,其他欄位不變'] = () => {
  const p = pet({ v: 2, got: { [D]: { d: 'corn', fall: 'berry', p5: 'tomato' } } });
  const cap = earn(p, 'g:ga-01');
  const p2 = pet();
  const r = earn(p2, 'iv');
  const same = J(Object.assign({}, r.pet, { v: 1, got: undefined })) === J(Object.assign(P.sanitize(freeze(p2), now(D)).pet, { got: undefined }));
  return { ok: cap.result === 'cap' && cap.left === 0 && !('pet' in cap) && r.result === 'got' && r.left === 2 && same && J(r.pet.got) === J({ [D]: { iv: 'pea' } }) && !r.pet.ate && !r.pet.once, detail: J({ cap, got: r.pet && r.pet.got }) };
};

/* ---------- 一天 3 張(附錄 C 第 6、7、12 條;2026-10-23 從一天一張改成 3 張) ---------- */
T['一天 3 張在寫入時判斷:同一台第 4 個完成回 cap;兩台各自離線拿到不同 id,合併後全部都在;拿到同一個 id,合併後只有一張'] = () => {
  const a1 = earn(pet(), 'd', tp(D + ' 09:00:00'));
  const a2 = earn(a1.pet, 'g:ga-01', tp(D + ' 10:00:00'));
  const a3 = earn(a2.pet, 'fall', tp(D + ' 10:30:00'));
  const a4 = earn(a3.pet, 'p5', tp(D + ' 10:40:00'));
  const b = earn(pet(), 'g:ga-01', tp(D + ' 11:00:00'));
  const b2 = earn(b.pet, 'iv', tp(D + ' 11:10:00'));
  const m = P.merge(freeze(a3.pet), freeze(b2.pet), now(D));
  const c = earn(pet(), 'd', tp(D + ' 11:00:00'));
  const m2 = P.merge(freeze(a1.pet), freeze(c.pet), now(D));
  return { ok: a1.result === 'got' && a2.result === 'got' && a3.result === 'got' && a4.result === 'cap' && J(m.got[D]) === J({ d: 'corn', fall: 'berry', 'g:ga-01': 'pea', iv: 'pea' }) && J(m2.got[D]) === J({ d: 'corn' }) && P.pantry(freeze(m), now(D)).stock.corn === 1 && P.pantry(freeze(m), now(D)).stock.pea === 2,
           detail: J({ a4: a4.result, m: m.got, m2: m2.got }) };
};
T['第一個完成的那種存滿 9 份回 full,當天的名額留著,下一個完成的別種照樣拿得到'] = () => {
  const p = pet({ v: 2, got: tickets('corn', 9) });
  const f = earn(p, 'd', tp(D + ' 09:00:00'));
  const g = earn(p, 'g:ga-01', tp(D + ' 10:00:00'));
  const f8 = earn(pet({ v: 2, got: tickets('corn', 8) }), 'd');
  return { ok: f.result === 'full' && f.food === 'corn' && !('pet' in f) && g.result === 'got' && g.food === 'pea' && f8.result === 'got', detail: J([f, g.result, f8.result]) };
};
T['一天 15 個練習 id 加上 d、m:只寫前 3 個,其他都 cap'] = () => {
  const ids = ['iv', 'g:ga-01', 'pn:a', 'fall', 'pairs', 'toast', 'mcq', 'ph', 'r:art-1', 'tq:art-1', 'p5', 'l2', 'es', 'rv', 'dlg:x', 'd', 'm'];
  let p = pet(); const res = [];
  ids.forEach((id, i) => { const r = earn(p, id, tp(D + ' 09:00:00') + i * 60e3); res.push(r.result); if (r.result === 'got') p = r.pet; });
  return { ok: res.slice(0, 3).every(x => x === 'got') && res.slice(3).every(x => x === 'cap') && J(p.got[D]) === J({ 'g:ga-01': 'pea', iv: 'pea', 'pn:a': 'pea' }), detail: J(res) };
};

/* ---------- 吃(附錄 C 第 8、9 條) ---------- */
T['點心第 4 份、今天還沒練習、沒有券:eat 拒絕,pet 不變;只寫了作業、今天有券但 days 是 0:可以餵'] = () => {
  const p = pet({ v: 2, got: tickets('pea', 4) });
  const e1 = P.eat(freeze(p), 'pea', 'a1', now(D));
  const e1c = P.eat(freeze(P.eat(freeze(e1.pet), 'pea', 'a2', now(D)).pet), 'pea', 'a2b', now(D));
  const e2 = P.eat(freeze(e1c.pet), 'pea', 'a2c', now(D));
  const e3 = P.eat(freeze(pet({ v: 2, days: {}, got: tickets('pea', 2) })), 'pea', 'a3', now(D));
  const e4 = P.eat(freeze(p), 'melon', 'a4', now(D));
  const hw = earn(pet({ days: {} }), 'wr:w1-lesson-1');
  const e5 = P.eat(freeze(hw.pet), 'greens', 'a5', now(D));
  return { ok: e1.ok && e2.reason === 'ateToday' && e3.reason === 'notToday' && e4.reason === 'none' && [e2, e3, e4].every(x => x.ok === false && !('pet' in x)) && hw.result === 'got' && e5.ok && e5.left === 0,
           detail: J([e1.ok, e2.reason, e3.reason, e4.reason, hw.result, e5.ok]) };
};
T['餓不餓只看飼料:今天只吃點心,hungry 仍是 true;餵飼料才不餓'] = () => {
  const g = earn(pet(), 'd');
  const e = P.eat(freeze(g.pet), 'corn', 'a1', now(D));
  const s = P.status(freeze(e.pet), now(D));
  const f = P.status(freeze(P.feed(freeze(e.pet), now(D))), now(D));
  return { ok: e.ok && s.hungry === true && f.hungry === false && s.food === 6, detail: J({ hungry: s.hungry, food: s.food, afterFeed: f.hungry }) };
};

/* ---------- 地瓜與麵包蟲(附錄 C 第 10、11 條) ---------- */
function streakPet(end, n, over) { const days = {}; range(addDays(end, -(n - 1)), n).forEach(d => { days[d] = 5; }); return pet(Object.assign({ days }, over || {})); }
T['連續天數到 7 的倍數那天給地瓜;今天還沒答題(只寫作業)不算今天,照一般的種類'] = () => {
  const r7 = earn(streakPet(D, 7), 'g:ga-01');
  const r14 = earn(streakPet(D, 14, { born: '2026-10-20' }), 'd', now(D), '2026-10-01');
  const r6 = earn(streakPet(D, 6), 'd');
  const p = streakPet(addDays(D, -1), 7);
  const r0 = earn(p, 'wr:w1-lesson-1');
  return { ok: r7.result === 'got' && r7.food === 'yam' && r7.id === 'y_g:ga-01' && r14.food === 'yam' && r6.food === 'corn' && r0.food === 'greens', detail: J([r7.id, r7.food, r14.food, r6.food, r0.food]) };
};
T['麵包蟲:之前長大還沒領的,在之後第一個拿到點心的日子給;好幾個一天一個;同一天地瓜也符合時先給地瓜'] = () => {
  /* 11/2 到 11/8 每天達標:11/2 第 1 階、11/4 第 2 階、11/8 第 3 階 */
  const met = range('2026-11-02', 7);
  const days = {}; met.forEach(d => { days[d] = 25; });
  let p = pet({ days: Object.assign({}, days, { [D]: 5 }), met });
  const res = [];
  for (let i = 0; i < 4; i++) {
    const d = addDays(D, i);
    p = P.reconcile({ local: freeze(p), remote: null, hist: freeze(dayHist(d, 5)), now: now(d) }).pet;
    const r = P.earn(freeze(p), { id: 'd', at: now(d), from: FROM }, now(d));
    res.push(r.id + '>' + r.food); p = r.pet;
  }
  /* 地瓜同一天:連 7 天、而且有一個還沒領的階段 */
  const q = streakPet(D, 7, { met: ['2026-11-04'] });
  const y1 = earn(q, 'd');
  const nx = addDays(D, 1);
  const q2 = P.reconcile({ local: freeze(y1.pet), remote: null, hist: freeze(dayHist(nx, 5)), now: now(nx) }).pet;
  const y2 = P.earn(freeze(q2), { id: 'd', at: now(nx), from: FROM }, now(nx));
  return { ok: J(res) === J(['w:s1_d>worm', 'w:s2_d>worm', 'w:s3_d>worm', 'd>corn']) && p.once['w:s1'] === D && p.once['w:s2'] === addDays(D, 1) && p.once['w:s3'] === addDays(D, 2) && y1.food === 'yam' && y2.id === 'w:s1_d' && y2.food === 'worm' && y2.pet.once['w:s1'] === nx,
           detail: J(res) + ' / 同一天 ' + y1.id + '、隔天 ' + y2.id };
};
T['麵包蟲:累積達標 60、90 天(配件的節奏)也給;30 天那次是第 6 階;同一個只給一次,壓縮之後也不再給'] = () => {
  const met = range('2026-08-01', 92);   // 第 30 天 8/30、第 60 天 9/29、第 90 天 10/29
  const days = {}; met.forEach(d => { days[d] = 25; });
  const p0 = pet({ born: '2026-08-01', days: Object.assign({}, days, { [D]: 5 }), met });
  let p = p0; const got = [];
  for (let i = 0; i < 4; i++) {
    const d = addDays(D, i);
    p = P.reconcile({ local: freeze(p), remote: null, hist: freeze(dayHist(d, 5)), now: now(d) }).pet;
    const r = P.earn(freeze(p), { id: 'd', at: now(d), from: '2026-08-15' }, now(d)); got.push(Object.keys(r.pet.once).find(k => k !== 'fav' && r.pet.once[k] === d) || r.food); p = r.pet;
  }
  /* 半年後(券都壓縮掉了)once 還在,不會再給 */
  const late = '2027-06-01';
  const pl = P.reconcile({ local: freeze(p), remote: null, hist: freeze(dayHist(late, 5)), now: now(late) }).pet;
  const rl = P.earn(freeze(pl), { id: 'd', at: now(late), from: '2026-08-15' }, now(late));
  /* 8/14 以前達到的第 1 到 4 階早於上線日(8/15),不給 */
  return { ok: J(got) === J(['w:s5', 'w:s6', 'w:a1', 'w:a2']) && !pl.got && pl.once['w:a1'] === addDays(D, 2) && rl.id === 'd' && rl.food === 'corn', detail: J(got) + ' / 之後 ' + rl.id };
};
T['麵包蟲存滿:改給一般的,麵包蟲留著;地瓜存滿:照一般的種類'] = () => {
  const w = earn(pet({ v: 2, met: ['2026-11-03'], got: tickets('worm', 9) }), 'g:ga-01');
  const y = earn(streakPet(D, 7, { v: 2, got: tickets('yam', 9) }), 'd');
  const pend = P.earn(freeze(P.eat(freeze(w.pet), 'worm', 'x1', now(addDays(D, 1))).pet || w.pet), { id: 'd', at: now(addDays(D, 1)), from: FROM }, now(addDays(D, 1)));
  return { ok: w.food === 'pea' && !(w.pet.once && w.pet.once['w:s1']) && y.food === 'corn' && y.id === 'd', detail: J([w.food, y.food, pend.result, pend.id]) };
};
T['之後合併進一個更早而且接得上的練習日:已經寫下的種類和份數都不變'] = () => {
  const r = earn(streakPet(D, 7), 'd');
  const other = pet({ days: { [addDays(D, -7)]: 9, [addDays(D, -8)]: 9 } });
  const m = P.merge(freeze(r.pet), freeze(other), now(D));
  const s = P.status(freeze(m), now(D));
  return { ok: r.food === 'yam' && J(m.got) === J(r.pet.got) && s.streak === 9 && P.pantry(freeze(m), now(D)).stock.yam === 1, detail: J({ got: m.got, streak: s.streak }) };
};
T['days 超過 400 天的資料逐日推進 30 天:地瓜照樣每 7 天一次,已經給的不會少'] = () => {
  const S = '2026-12-01';
  const days = {}, met = [];
  range(addDays(S, -400), 400).forEach(d => { days[d] = 25; met.push(d); });
  let p = { v: 1, born: '2025-01-01', goals: [], days, met, oldMet: 50, oldBefore: addDays(S, -400), fed: {}, name: '', nameAt: 0 };
  const yams = [];
  for (let i = 0; i < 30; i++) {
    const d = addDays(S, i);
    p = P.reconcile({ local: freeze(p), remote: null, hist: freeze(dayHist(d, 25)), now: now(d) }).pet;
    const r = P.earn(freeze(p), { id: 'd', at: now(d), from: S }, now(d));
    if (r.result === 'got') { p = r.pet; if (r.food === 'yam') yams.push(d); }
    const e = P.eat(freeze(p), r.food === 'yam' ? 'corn' : 'corn', 'e' + i, now(d));
    if (e.ok) p = e.pet;
  }
  const kept = yams.every(d => p.got[d] && Object.values(p.got[d]).includes('yam'));
  const gaps = yams.slice(1).map((d, i) => (Date.parse(d) - Date.parse(yams[i])) / 864e5);
  return { ok: yams.length >= 4 && yams.length <= 5 && gaps.every(g => g === 7) && kept && Object.keys(p.days).length <= 400, detail: J({ yams, gaps, kept }) };
};
T['上線日以前的完成、達標、連續天數、成長階段都不給食物'] = () => {
  const a = earn(pet(), 'd', now('2026-10-31'), FROM);
  const met = range('2026-10-20', 7);
  const w = earn(pet({ met }), 'g:ga-01');
  const y = earn(streakPet('2026-10-31', 7), 'd', now('2026-10-31'), FROM);
  const b = P.backfill(freeze(pet({ days: { '2026-10-30': 5, [D]: 5 }, met: ['2026-10-30'] })), freeze({ daily: { '2026-10-30': { d: { a: 1, b: 1, c: 1, e: 1, f: 1 } } }, mock: [], diag: null, hist: [], from: '2026-10-31' }), now('2026-11-02'));
  return { ok: a.result === 'off' && w.food === 'pea' && y.result === 'off' && b.added.length === 0, detail: J([a.result, w.id, y.result, b.added]) };
};

/* ---------- 程度檢測(附錄 C 第 14 條) ---------- */
T['程度檢測重測:西瓜只給一次(記在 once.diag),之後回 once;壓縮之後也不再給'] = () => {
  const r1 = earn(pet(), 'diag');
  const nx = addDays(D, 3);
  const r2 = P.earn(freeze(r1.pet), { id: 'diag', at: now(nx), from: FROM }, now(nx));
  const late = '2027-06-01';
  const r3 = P.earn(freeze(P.sanitize(freeze(r1.pet), now(late)).pet), { id: 'diag', at: now(late), from: FROM }, now(late));
  const b = P.backfill(freeze(P.sanitize(freeze(r1.pet), now(nx)).pet), freeze({ daily: {}, mock: [], diag: { done: true, finishedAt: new Date(now(nx)).toISOString() }, hist: [], from: FROM }), now(nx));
  return { ok: r1.result === 'got' && r1.food === 'melon' && r1.pet.once.diag === D && r2.result === 'once' && r3.result === 'once' && b.added.length === 0, detail: J([r1.result, r2.result, r3.result, b.added]) };
};

/* ---------- 補寫(附錄 C 第 12a、13 條) ---------- */
const DAY1 = '2026-11-05', DAY2 = '2026-11-06', DAY3 = '2026-11-07', DAY4 = '2026-11-08', DAY5 = '2026-11-09';
function sources() {
  return {
    daily: { [DAY2]: { d: { a: 1, b: 0, c: 1, e: 1, f: 0 } }, [DAY3]: { v: { a: 1, b: 1 } }, '2026-10-20': { g: { a: 1, b: 1, c: 1, e: 1, f: 1 } } },
    mock: [{ d: new Date(tp(DAY1 + ' 09:00:00')).toISOString(), size: 'mini' }],
    diag: null,
    hist: [
      { m: 'vq', id: 'pairs', c: 20, ok: true, g: 'pairs', q: '翻牌配對 x：8 對', t: tp(DAY1 + ' 10:00:00') },
      { m: 'vq', id: 'fall', c: 9, ok: false, g: 'fall', t: tp(DAY5 + ' 08:00:00') },
      { m: 'tq', id: 'art-03', c: 7, ok: false, n: 9, t: tp(DAY5 + ' 15:00:00') },
      { m: 'vq', id: 'fall', c: 9, ok: true, g: 'fall', t: tp(D + ' 08:00:00') },
    ],
    from: FROM,
  };
}
T['補寫最近 7 天:有時間的取最早的;看不出時間的排在後面、d 在 m 前面;那天已經有券就不補;不改傳進來的任何東西'] = () => {
  /* oldMet 10:第 1 到 3 階早就領過(日期不明,不給),這兩天達標還到不了第 4 階,這一題不會冒出麵包蟲 */
  const p = pet({ v: 2, days: { [DAY1]: 5, [DAY2]: 5, [DAY3]: 25, [DAY5]: 5, [D]: 3 }, met: [DAY2, DAY3], oldMet: 10, oldBefore: '2026-10-01', got: { [DAY4]: { iv: 'pea' } } });
  const src = freeze(sources());
  const before = J(src);
  const r = P.backfill(freeze(p), src, now(D));
  const want = [[DAY1, 'mock', 'melon'], [DAY2, 'd', 'corn'], [DAY3, 'm', 'greens'], [DAY5, 'tq:art-03', 'tomato'], [D, 'fall', 'berry']];
  const got = r.added.map(a => [a.date, a.id, a.food]);
  const inPet = want.every(([d, id, f]) => r.pet.got[d] && r.pet.got[d][id] === f) && J(r.pet.got[DAY4]) === J({ iv: 'pea' });
  return { ok: J(got) === J(want) && inPet && J(src) === before && r.pet.v === 2, detail: J(got) };
};
T['補寫:只看最近 7 天、不早於上線日、不晚於今天;第一個完成的存滿時換下一個完成的'] = () => {
  const src = sources();
  const far = P.backfill(freeze(pet()), freeze(src), now('2026-11-20'));
  const fromLate = P.backfill(freeze(pet()), freeze(Object.assign({}, src, { from: DAY3 })), now(D));
  const full = P.backfill(freeze(pet({ v: 2, got: tickets('melon', 9, DAY1) })), freeze(src), now(D));
  const d1 = full.added.find(a => a.date === DAY1);
  const none = P.backfill(freeze({ v: 3 }), freeze(src), now(D));
  return { ok: far.added.length === 0 && fromLate.added.every(a => a.date >= DAY3) && fromLate.added.length === 2 && d1 && d1.id === 'pairs' && d1.food === 'berry' && none.added.length === 0,
           detail: J({ far: far.added.length, late: fromLate.added.map(a => a.date), d1, none: none.added.length }) };
};
T['補寫:模擬考台北時間 07:59 交卷,算在台北的那天(不是 UTC 的前一天)'] = () => {
  const iso = new Date(tp(D + ' 07:59:00')).toISOString();
  const r = P.backfill(freeze(pet()), freeze({ daily: {}, mock: [{ d: iso }], diag: { done: true, finishedAt: new Date(tp('2026-11-09 07:30:00')).toISOString() }, hist: [], from: FROM }), now(D));
  return { ok: iso.slice(0, 10) === '2026-11-09' && J(r.added.map(a => [a.date, a.id])) === J([['2026-11-09', 'diag'], [D, 'mock']]), detail: iso + ' ' + J(r.added) };
};
T['補寫:地瓜與麵包蟲照「那一天」的規則(用那天當拿到的日子、只用那天以前的資料)'] = () => {
  const days = {}; range('2026-11-03', 8).forEach(d => { days[d] = 5; });   // 11/9 第 7 天
  const p = pet({ days, met: ['2026-11-07'] });
  const src = { daily: { '2026-11-08': { d: { a: 1, b: 1, c: 1, e: 1, f: 1 } }, '2026-11-09': { d: { a: 1, b: 1, c: 1, e: 1, f: 1 } } }, mock: [], diag: null, hist: [], from: FROM };
  const r = P.backfill(freeze(p), freeze(src), now(D));
  /* 11/7 達標那天:第 1 階是那天才達到的,不算「之前」,給青江菜;11/8 才給麵包蟲;11/9 連續第 7 天給地瓜 */
  const want = [['2026-11-07', 'm', 'greens'], ['2026-11-08', 'w:s1_d', 'worm'], ['2026-11-09', 'y_d', 'yam']];
  return { ok: J(r.added.map(a => [a.date, a.id, a.food])) === J(want) && r.pet.once['w:s1'] === '2026-11-08', detail: J(r.added) };
};
T['補寫:沒有可補的就原樣回傳,不產生 v2'] = () => {
  const p = freeze(pet());
  const r = P.backfill(p, freeze({ daily: null, mock: null, diag: null, hist: null, from: FROM }), now(D));
  const r2 = P.backfill(p, freeze({ daily: '壞', mock: 5, diag: [], hist: {}, from: FROM }), now(D));
  return { ok: r.pet === p && r.added.length === 0 && r2.pet === p && r2.added.length === 0, detail: J([r.added, r2.added]) };
};

/* ---------- 純函式 ---------- */
/* chick2 第二輪修正 #5(已知限制,規格 5.2 與附錄 C 第 10 條):麵包蟲領過沒有只看判斷那台的 once。手機停在筆電領之前,
   隔天用自己舊的那份判斷,同一個階段的麵包蟲又給一次。這一張占掉手機那天的名額(拿到麵包蟲而不是那天的點心),總份數不變;
   合併兩張都留著、兩個方向結果一樣、once 記較早那天、合併後的資料不會再給第三次 */
T['已知限制:同一個階段的麵包蟲在兩台、兩天各給一次:兩張都留著(各記在自己的 id:w:s1_<給它的練習>)、每天只有一張、合併順序無關、once 記較早那天、之後不再給'] = () => {
  const D0 = '2026-11-10', D1 = addDays(D0, 1), D2 = addDays(D0, 2);
  const base = pet({ days: { [addDays(D0, -1)]: 25 }, met: [addDays(D0, -1)] });
  const lap = P.earn(freeze(base), { id: 'pr', at: now(D0), from: FROM }, now(D0));
  const phone = P.earn(freeze(base), { id: 'iv', at: now(D1), from: FROM }, now(D1));
  const m1 = P.merge(freeze(lap.pet), freeze(phone.pet), now(D1)), m2 = P.merge(freeze(phone.pet), freeze(lap.pet), now(D1));
  const third = P.earn(freeze(m1), { id: 'iv', at: now(D2), from: FROM }, now(D2));
  const worms = P.pantry(freeze(m1), now(D1)).stock.worm;
  const perDay = Object.keys(m1.got).every(d => Object.keys(m1.got[d]).length === 1);
  return { ok: lap.id === 'w:s1_pr' && lap.food === 'worm' && phone.id === 'w:s1_iv' && phone.food === 'worm' && worms === 2 && perDay && P.canon(m1) === P.canon(m2) && m1.once['w:s1'] === D0 && third.food === 'pea',
           detail: J({ lap: [lap.id, lap.date], phone: [phone.id, phone.date], got: m1.got, once: m1.once, worms, third: [third.result, third.id] }) };
};
T['pet-food.js 不碰 store、document、localStorage、window、CLOUD,也不用亂數或 Date.now'] = () => {
  const code = SRC_FOOD.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const strict = /['"]use strict['"]/.test(SRC_FOOD);
  const touches = /\b(store|localStorage|sessionStorage|document|window|CLOUD)\s*[.[]/.test(code);
  const impure = /Math\s*\.\s*random|Date\s*\.\s*now/.test(code);
  return { ok: !!SRC_FOOD && strict && !touches && !impure, detail: J({ exists: !!SRC_FOOD, strict, touches, impure }) };
};

/* ---------- 執行 ---------- */
let pass = 0; const names = Object.keys(T);
for (const name of names) {
  let r;
  try { r = T[name](); } catch (e) { r = { ok: false, detail: '丟錯:' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e) }; }
  if (r.ok) pass++;
  console.log((r.ok ? 'PASS ' : 'FAIL ') + name + (r.ok ? '' : '  →  ' + r.detail));
}
console.log(pass + ' / ' + names.length + ' 通過' + (process.env.TZ ? '(TZ=' + process.env.TZ + ',時差 ' + new Date().getTimezoneOffset() + ' 分)' : ''));
let allOk = pass === names.length;
if (!process.env.PET_CHILD) {
  for (const tz of ['UTC', 'America/Los_Angeles']) {
    const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: tz, PET_CHILD: '1' }), encoding: 'utf8' });
    const last = (r.stdout || '').trim().split('\n').pop();
    console.log('裝置時區 ' + tz + ':' + last);
    if (r.status !== 0) allOk = false;
  }
}
process.exit(allOk ? 0 : 1);
