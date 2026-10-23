/* 小雞點心一天 3 份(Bonnie 2026-10-23:「每天拿三個阿 可以為三次」「應該有做任何練習都要拿的到食物」)的測試:js/pet.js、js/pet-food.js。
   用法:node tools/test_pet_food3.js
   - 一天最多拿 3 份、最多餵 3 份;同一個來源 id 一天只算一次(dup);地瓜、麵包蟲照舊,算在 3 份裡,一天最多一份特別的。
   - 舊規則(一天一份,5dbf684,tools/fixtures/pet_food_1aday.js)寫出來的紀錄,新版讀回來、合併、整理都跟舊版逐位元組相同。
   - 隨機測試:兩台同一天各自離線、各拿 3 份吃 3 份,合併後一張券、一筆吃掉都不少(整理的每天上限要容得下)。
   輸入一律深度凍結,改到就丟錯。最後用 TZ=UTC 與 TZ=America/Los_Angeles 各再跑一次。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
function load(srcs) { const ctx = { console }; vm.createContext(ctx); srcs.forEach(s => vm.runInContext(s, ctx)); return ctx.PET; }
const P = load([read('js/pet.js'), read('js/pet-food.js')]);
const OLD = load([read('tools/fixtures/pet_food_1aday.js')]);

function freeze(o) { if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); } return o; }
const clone = x => JSON.parse(JSON.stringify(x));
function tp(s) { return Date.parse(s.replace(' ', 'T') + '+08:00'); }
function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
function range(from, count) { return Array.from({ length: count }, (_, i) => addDays(from, i)); }
const now = d => tp(d + ' 12:00:00');
const J = x => JSON.stringify(x);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
function dayHist(d, n, m = 'p5') { const t0 = tp(d + ' 10:00:00'); return Array.from({ length: n }, (_, i) => ({ m, id: m + '-' + d + '-' + i, c: 0, ok: true, t: t0 + i * 10000 })); }

const FROM = '2026-11-01';
const D = '2026-11-10';
function pet(over) { return Object.assign({ v: 1, born: '2026-11-01', goals: [], days: { [D]: 6 }, met: [], oldMet: 0, oldBefore: '', fed: {}, name: '小黃', nameAt: 1 }, over || {}); }
function earnAt(L, p, id, t, from) { return L.earn(freeze(p), { id, at: t, from: from || FROM }, t); }
function earn(p, id, i) { return earnAt(P, p, id, tp(D + ' 09:00:00') + (i || 0) * 60e3); }
function tickets(food, n, endDay) { const got = {}; range(addDays(endDay || D, -n), n).forEach((d, i) => { got[d] = { ['r:t' + i]: food }; }); return got; }
function streakPet(end, n, over) { const days = {}; range(addDays(end, -(n - 1)), n).forEach(d => { days[d] = 5; }); return pet(Object.assign({ days }, over || {})); }
const IDS = ['d', 'g:ga-01', 'pn:a1', 'iv', 'fall', 'pairs', 'toast', 'mcq', 'ph', 'r:art-03', 'tq:art-03', 'p5', 'p6', 'p7', 'pr', 'l1', 'l2', 'es', 'ed', 'rv', 'dlg:d-001', 'mock', 'diag', 'wr:w1-lesson-1', 'm'];
const T = {};

/* ---------- 一天 3 份 ---------- */
T['一天拿 3 份:同一台前 3 個不同的練習都拿到(今天還能拿 2、1、0 份),第 4 個回 cap(不回 pet);d、m 也算'] = () => {
  let p = pet(); const res = [];
  ['iv', 'd', 'm', 'fall', 'p5'].forEach((id, i) => { const r = earn(p, id, i); res.push([r.result, r.left, 'pet' in r]); if (r.result === 'got') p = r.pet; });
  const want = [['got', 2, true], ['got', 1, true], ['got', 0, true], ['cap', 0, false], ['cap', 0, false]];
  return { ok: J(res) === J(want) && J(p.got[D]) === J({ d: 'corn', iv: 'pea', m: 'greens' }) && P.SNACKS_PER_DAY === 3, detail: J({ res, got: p.got }) };
};
T['同一個來源一天只算一次:再做一次回 dup(還能拿幾份、不回 pet、什麼都不寫);換別的練習照樣拿得到'] = () => {
  const a = earn(pet(), 'p5', 0);
  const b = earn(a.pet, 'p5', 1);
  const c = earn(a.pet, 'r:art-03', 2);
  const d2 = earn(c.pet, 'r:art-03', 3);
  const e = earn(c.pet, 'tq:art-03', 4);
  return { ok: a.result === 'got' && b.result === 'dup' && b.left === 2 && !('pet' in b) && b.food === undefined && c.result === 'got' && d2.result === 'dup' && d2.left === 1 && e.result === 'got' && e.left === 0,
           detail: J([a.result, b, c.result, d2, e.result, e.left]) };
};
T['3 份都拿了以後同一個來源再做一次:回 cap(不是 dup)'] = () => {
  let p = pet();
  ['d', 'iv', 'fall'].forEach((id, i) => { p = earn(p, id, i).pet; });
  const r = earn(p, 'd', 5);
  return { ok: r.result === 'cap' && r.left === 0, detail: J(r) };
};
T['存滿 9 份的不占名額:第一個完成的那種滿了回 full,之後 3 個別種的照樣拿到'] = () => {
  let p = pet({ v: 2, got: tickets('corn', 9) });
  const f = earn(p, 'd', 0);
  const res = ['iv', 'fall', 'p5', 'mock'].map((id, i) => { const r = earn(p, id, i + 1); if (r.pet) p = r.pet; return r.result; });
  return { ok: f.result === 'full' && f.food === 'corn' && !('pet' in f) && J(res) === J(['got', 'got', 'got', 'cap']), detail: J([f, res]) };
};
T['程度檢測一輩子一次照舊(once),不占名額'] = () => {
  const p = pet({ v: 2, once: { diag: '2026-11-02' } });
  const r = earn(p, 'diag', 0);
  return { ok: r.result === 'once' && !('pet' in r), detail: J(r) };
};

/* ---------- 地瓜與麵包蟲算在 3 份裡 ---------- */
T['地瓜:連續第 7 天第一份換成地瓜,券記在自己的 id(y_<來源>);同一天第 2 份照一般的種類;同一個來源再做一次是 dup'] = () => {
  const p = streakPet(D, 7);
  const a = earn(p, 'g:ga-01', 0);
  const b = earn(a.pet, 'd', 1);
  const c = earn(b.pet, 'g:ga-01', 2);
  return { ok: a.result === 'got' && a.food === 'yam' && a.id === 'y_g:ga-01' && J(a.pet.got[D]) === J({ 'y_g:ga-01': 'yam' }) && b.food === 'corn' && c.result === 'dup' && P.pantry(freeze(b.pet), now(D)).stock.yam === 1,
           detail: J([a.id, a.food, b.food, c.result]) };
};
T['舊的地瓜券(id 是 y,一天一份那版寫的)算今天的 1 份,也算今天的特別的:之後的照一般種類,還能拿 2 份'] = () => {
  const p = streakPet(D, 7, { v: 2, got: { [D]: { y: 'yam' } } });
  const a = earn(p, 'p5', 0);
  const b = earn(a.pet, 'd', 1);
  const c = earn(b.pet, 'iv', 2);
  return { ok: a.result === 'got' && a.food === 'tomato' && a.left === 1 && b.left === 0 && c.result === 'cap' && J(b.pet.got[D]) === J({ d: 'corn', p5: 'tomato', y: 'yam' }), detail: J([a, b.left, c.result]) };
};
T['麵包蟲:還沒領的,在之後第一份給;一天最多一份特別的:地瓜那天不再給麵包蟲,隔天第一份才給'] = () => {
  const q = streakPet(D, 7, { met: ['2026-11-04'] });
  const y1 = earn(q, 'd', 0);
  const y2 = earn(y1.pet, 'iv', 1);
  const nx = addDays(D, 1);
  const q2 = P.reconcile({ local: freeze(y2.pet), remote: null, hist: freeze(dayHist(nx, 5)), now: now(nx) }).pet;
  const w1 = earnAt(P, q2, 'fall', now(nx));
  const w2 = earnAt(P, w1.pet, 'p5', now(nx) + 60e3);
  return { ok: y1.food === 'yam' && y2.food === 'pea' && !(y2.pet.once && y2.pet.once['w:s1']) && w1.food === 'worm' && w1.id === 'w:s1_fall' && w1.pet.once['w:s1'] === nx && w2.food === 'tomato',
           detail: J([y1.food, y2.food, w1.id, w1.food, w2.food]) };
};
T['好幾個麵包蟲還沒領:一天一個(第 2、3 份是一般的)'] = () => {
  const met = range('2026-11-02', 7);
  const days = {}; met.forEach(d => { days[d] = 25; });
  let p = pet({ days: Object.assign({}, days, { [D]: 5 }), met });
  const out = [];
  for (let i = 0; i < 2; i++) {
    const d = addDays(D, i);
    p = P.reconcile({ local: freeze(p), remote: null, hist: freeze(dayHist(d, 5)), now: now(d) }).pet;
    ['d', 'iv', 'fall'].forEach((id, k) => { const r = earnAt(P, p, id, now(d) + k * 60e3); out.push(r.food); p = r.pet; });
  }
  return { ok: J(out) === J(['worm', 'pea', 'berry', 'worm', 'pea', 'berry']) && p.once['w:s1'] === D && p.once['w:s2'] === addDays(D, 1), detail: J(out) };
};

/* ---------- 一天餵 3 份 ---------- */
T['一天餵 3 份:第 4 份回 ateToday、pet 不變;pantry 的 ateCount、ateMax、canSnack 跟著變'] = () => {
  const p = pet({ v: 2, got: tickets('pea', 5) });
  const e1 = P.eat(freeze(p), 'pea', 'a1', now(D));
  const p1 = P.pantry(freeze(e1.pet), now(D));
  const e2 = P.eat(freeze(e1.pet), 'pea', 'a2', now(D));
  const e3 = P.eat(freeze(e2.pet), 'pea', 'a3', now(D));
  const e4 = P.eat(freeze(e3.pet), 'pea', 'a4', now(D));
  const p3 = P.pantry(freeze(e3.pet), now(D));
  return { ok: e1.ok && e2.ok && e3.ok && e3.left === 2 && e4.ok === false && e4.reason === 'ateToday' && !('pet' in e4)
             && p1.ateCount === 1 && p1.ateToday === true && p1.canSnack === true && p1.ateMax === 3 && p3.ateCount === 3 && p3.canSnack === false && Object.keys(e3.pet.ate[D]).length === 3,
           detail: J({ e: [e1.ok, e2.ok, e3.ok, e4.reason], p1: [p1.ateCount, p1.canSnack], p3: [p3.ateCount, p3.canSnack] }) };
};
T['還沒練習、沒有那種的券:照舊拒絕;隔天又能餵 3 份'] = () => {
  const e0 = P.eat(freeze(pet({ v: 2, days: {}, got: tickets('pea', 2) })), 'pea', 'a1', now(D));
  const e1 = P.eat(freeze(pet({ v: 2, got: tickets('pea', 2) })), 'corn', 'a1', now(D));
  let p = pet({ v: 2, got: tickets('pea', 6) });
  ['a1', 'a2', 'a3'].forEach(id => { p = P.eat(freeze(p), 'pea', id, now(D)).pet; });
  const nx = addDays(D, 1);
  const q = P.reconcile({ local: freeze(p), remote: null, hist: freeze(dayHist(nx, 3)), now: now(nx) }).pet;
  const e2 = P.eat(freeze(q), 'pea', 'b1', now(nx));
  const pn = P.pantry(freeze(e2.pet), now(nx));
  return { ok: e0.reason === 'notToday' && e1.reason === 'none' && e2.ok && pn.ateCount === 1 && pn.canSnack && pn.stock.pea === 2, detail: J([e0.reason, e1.reason, e2.ok, pn]) };
};
T['pantry 的 gotToday 照舊是今天 id 最小的那張,另外 gotAll 列出今天全部的券'] = () => {
  let p = pet();
  ['p5', 'd', 'm'].forEach((id, i) => { p = earn(p, id, i).pet; });
  const pa = P.pantry(freeze(p), now(D));
  return { ok: J(pa.gotToday) === J({ id: 'd', food: 'corn' }) && J(pa.gotAll) === J([{ id: 'd', food: 'corn' }, { id: 'm', food: 'greens' }, { id: 'p5', food: 'tomato' }]), detail: J(pa) };
};

/* ---------- 補寫照舊只補沒有券的日子 ---------- */
T['補寫照舊:今天已經有一張(掛勾給的)就不補,不會因為一天 3 份把前幾天補成 3 份'] = () => {
  const p = pet({ v: 2, days: { '2026-11-08': 5, '2026-11-09': 5, [D]: 5 }, got: { '2026-11-09': { y: 'yam' }, [D]: { iv: 'pea' } } });
  const src = { daily: { '2026-11-09': { d: { a: 1, b: 1, c: 1, e: 1, f: 1 } }, [D]: { d: { a: 1, b: 1, c: 1, e: 1, f: 1 } } }, mock: [{ d: new Date(tp(D + ' 08:00:00')).toISOString() }], diag: null,
    hist: [{ m: 'vq', id: 'pairs', c: 20, ok: true, g: 'pairs', q: '翻牌配對 x：8 對', t: tp('2026-11-08 10:00:00') }, { m: 'vq', id: 'fall', c: 9, ok: true, g: 'fall', t: tp('2026-11-08 11:00:00') }], from: FROM };
  const r = P.backfill(freeze(p), freeze(src), now(D));
  return { ok: J(r.added.map(a => [a.date, a.id])) === J([['2026-11-08', 'pairs']]) && J(r.pet.got[D]) === J({ iv: 'pea' }) && J(r.pet.got['2026-11-09']) === J({ y: 'yam' }), detail: J(r.added) };
};

/* ---------- 舊規則寫的紀錄,新版讀回來不變 ---------- */
/* 用舊版(一天一份)的程式跑 n 天:兩台輪流答題、拿券、吃、補寫、互相合併;回傳每天的快照 */
function oldHistory(seed, n) {
  const r = rng(seed);
  const start = '2026-10-20';
  let a = null, b = null; const snaps = [];
  range(start, n).forEach((d, i) => {
    const t = now(d) + Math.floor(r() * 3) * 3600e3;
    const hist = dayHist(d, 3 + Math.floor(r() * 25));
    const dev = r() < 0.5 ? 'a' : 'b';
    let x = OLD.reconcile({ local: dev === 'a' ? a : b, remote: r() < 0.6 ? (dev === 'a' ? b : a) : null, hist, now: t }).pet;
    for (let k = 0; k < 1 + Math.floor(r() * 3); k++) { const e = OLD.earn(x, { id: pick(r, IDS), at: t + k * 1000, from: start }, t + k * 1000); if (e.pet) x = e.pet; }
    if (r() < 0.7) { const pa = OLD.pantry(x, t); const f = pa.order.find(k => pa.stock[k] > 0); if (f) { const e = OLD.eat(x, f, 'e' + seed + 'x' + i, t + 5000); if (e.ok) x = e.pet; } }
    if (r() < 0.3) x = OLD.backfill(x, { daily: { [d]: { d: { a: 1, b: 1, c: 1, e: 1, f: 1 } } }, mock: [], diag: null, hist, from: start }, t).pet;
    if (dev === 'a') a = x; else b = x;
    snaps.push({ pet: clone(x), t });
  });
  if (a && b) snaps.push({ pet: clone(OLD.merge(a, b, snaps[snaps.length - 1].t)), t: snaps[snaps.length - 1].t });
  return snaps;
}
const PANTRY_OLD_KEYS = ['stock', 'order', 'practiced', 'ateToday', 'ateFood', 'gotToday', 'fav', 'favKnown'];
T['舊規則(一天一份)寫的紀錄 200 份:新版 sanitize、merge、reconcile、status 跟舊版逐位元組相同,pantry 舊有的鍵相同,讀回來 changed 是 false'] = () => {
  const bad = [];
  let n = 0;
  for (let s = 1; s <= 8; s++) {
    const snaps = oldHistory(1000 + s, 25);
    snaps.forEach((x, i) => {
      n++;
      const p = freeze(x.pet), t = x.t, q = freeze(snaps[(i * 7 + 3) % snaps.length].pet);
      const tag = s + '#' + i;
      if (P.canon(P.sanitize(p, t).pet) !== P.canon(OLD.sanitize(p, t).pet)) bad.push(tag + ' sanitize');
      if (P.canon(P.merge(p, q, t)) !== P.canon(OLD.merge(p, q, t))) bad.push(tag + ' merge');
      const rn = P.reconcile({ local: p, remote: p, hist: [], now: t }), ro = OLD.reconcile({ local: p, remote: p, hist: [], now: t });
      if (P.canon(rn.pet) !== P.canon(ro.pet) || rn.changed !== ro.changed || rn.remoteBehind !== ro.remoteBehind) bad.push(tag + ' reconcile');
      if (J(P.status(p, t)) !== J(OLD.status(p, t))) bad.push(tag + ' status');
      const pn = P.pantry(p, t), po = OLD.pantry(p, t);
      if (PANTRY_OLD_KEYS.some(k => J(pn[k]) !== J(po[k]))) bad.push(tag + ' pantry');
      if (P.canon(P.cloudMerge(p, q, t).v) !== P.canon(OLD.cloudMerge(p, q, t).v)) bad.push(tag + ' cloudMerge');
    });
  }
  return { ok: !bad.length && n >= 200, detail: (bad.slice(0, 6).join(' | ') || 'ok') + ' / ' + n + ' 份' };
};

/* ---------- 隨機:兩台同一天各自離線,各拿 3 份、吃 3 份 ---------- */
const SN = ['corn', 'greens', 'pea', 'berry', 'tomato', 'melon', 'yam', 'worm'];
/* 一台離線的一天:隨機的完成與餵食,用新版的規則寫;回傳這台最後的那份 */
function offlineDay(r, base, d, tag) {
  let p = base;
  const t0 = now(d);
  for (let k = 0; k < 12; k++) {
    const t = t0 + k * 61e3;
    if (r() < 0.6) { const e = earnAt(P, p, pick(r, IDS), t, '2026-10-20'); if (e.result === 'got') p = e.pet; }
    else { const pa = P.pantry(freeze(p), t); const f = pa.order.filter(x => pa.stock[x] > 0); if (f.length) { const e = P.eat(freeze(p), pick(r, f), tag + k, t); if (e.ok) p = e.pet; } }
  }
  return p;
}
function idsOn(p, k, d) { return p && p[k] && p[k][d] ? Object.keys(p[k][d]).sort() : []; }
T['隨機 300 組:兩台同一天各自離線、各拿最多 3 份吃最多 3 份;合併後兩台的券和吃掉紀錄一筆都不少,兩個方向相同,再合併、再整理都不變'] = () => {
  const bad = [];
  let maxGot = 0, maxAte = 0, six = 0;
  for (let s = 0; s < 300; s++) {
    const r = rng(77000 + s);
    const snaps = oldHistory(5000 + (s % 20), 10);
    const base = freeze(snaps[snaps.length - 1].pet);
    const d = addDays('2026-10-20', 10);
    const hist = dayHist(d, 6);
    const start = P.reconcile({ local: base, remote: null, hist, now: now(d) }).pet;
    const A = freeze(offlineDay(r, start, d, 'qa')), B = freeze(offlineDay(r, start, d, 'qb'));
    const t = now(d) + 3600e3;
    const m1 = P.merge(A, B, t), m2 = P.merge(B, A, t);
    const gA = idsOn(A, 'got', d), gB = idsOn(B, 'got', d), aA = idsOn(A, 'ate', d), aB = idsOn(B, 'ate', d);
    maxGot = Math.max(maxGot, gA.length, gB.length); maxAte = Math.max(maxAte, aA.length, aB.length);
    const gU = [...new Set(gA.concat(gB))].sort(), aU = [...new Set(aA.concat(aB))].sort();
    if (gU.length >= 6 || aU.length >= 6) six++;
    const tag = '#' + s;
    if (gA.length > 3 || gB.length > 3 || aA.length > 3 || aB.length > 3) bad.push(tag + ' 一台一天超過 3');
    if (J(idsOn(m1, 'got', d)) !== J(gU)) bad.push(tag + ' 券少了 ' + J([gU, idsOn(m1, 'got', d)]));
    if (J(idsOn(m1, 'ate', d)) !== J(aU)) bad.push(tag + ' 吃掉少了');
    if (P.canon(m1) !== P.canon(m2)) bad.push(tag + ' 方向不同');
    if (P.canon(P.merge(freeze(m1), A, t)) !== P.canon(m1) || P.canon(P.merge(freeze(m1), B, t)) !== P.canon(m1)) bad.push(tag + ' 再合併變了');
    if (P.canon(P.sanitize(freeze(m1), t).pet) !== P.canon(m1)) bad.push(tag + ' 再整理變了');
    /* 合併後還能不能再拿、再吃:已經有 3 張以上就 cap,吃了 3 筆以上就 ateToday */
    const e = earnAt(P, m1, 'rv', t, '2026-10-20');
    if (gU.length >= 3 && e.result === 'got') bad.push(tag + ' 合併後還拿得到');
    const pa = P.pantry(freeze(m1), t);
    if (aU.length >= 3 && pa.canSnack) bad.push(tag + ' 合併後還能餵');
  }
  return { ok: !bad.length && maxGot === 3 && maxAte === 3 && six > 0, detail: (bad.slice(0, 5).join(' | ') || 'ok') + ' / 一台一天最多拿 ' + maxGot + '、吃 ' + maxAte + ',合併後 6 筆的 ' + six + ' 組' };
};
T['極端:兩台各 3 張不同的券、各 3 筆吃掉,吃的 id 都比較大(整理時留 id 小的):合併後 6 張 6 筆都在'] = () => {
  const d = D;
  const a = { v: 2, born: '2026-11-01', goals: [], days: { [d]: 5 }, met: [], oldMet: 0, oldBefore: '', fed: {}, name: '', nameAt: 0,
    got: { [d]: { 'r:a1': 'tomato', 'r:a2': 'tomato', 'r:a3': 'tomato' } }, ate: { [d]: { zza1: d + '/r:a1', zza2: d + '/r:a2', zza3: d + '/r:a3' } } };
  const b = Object.assign({}, a, { got: { [d]: { 'r:b1': 'pea', 'r:b2': 'pea', 'r:b3': 'pea' } }, ate: { [d]: { zzb1: d + '/r:b1', zzb2: d + '/r:b2', zzb3: d + '/r:b3' } } });
  const m = P.merge(freeze(a), freeze(b), now(d));
  return { ok: Object.keys(m.got[d]).length === 6 && Object.keys(m.ate[d]).length === 6 && P.pantry(freeze(m), now(d)).stock.tomato === 0 && P.pantry(freeze(m), now(d)).stock.pea === 0,
           detail: J({ got: m.got[d], ate: m.ate[d] }) };
};

/* ---------- 特別的券跟同一個來源的一般券(審查第 1 輪 #1) ---------- */
/* 一台看得到特別的日子(地瓜:連續第 7 天;麵包蟲:之前長到第 1 階段),另一台看不到;兩台同一天各自完成同一個來源 */
function specialBase(kind) {
  if (kind === 'yam') return streakPet(D, 7);
  if (kind === 'worm') return pet({ days: { '2026-11-01': 25, [D]: 6 }, met: ['2026-11-01'] });
  return pet();
}
const stockAll = (p, t) => { const s = P.pantry(freeze(p), t).stock; return SN.filter(f => s[f]).map(f => f + ':' + s[f]).join(','); };
T['特別的券跟另一台同一個來源的一般券:合併後兩張都在(種類不變)、麵包蟲的 once 有它的券、兩個方向相同;合併後同一個來源再做是 dup'] = () => {
  const out = [];
  for (const kind of ['yam', 'worm']) {
    const t = tp(D + ' 09:00:00');
    const a = earnAt(P, specialBase(kind), 'p5', t), b = earnAt(P, specialBase(''), 'p5', t);
    const m1 = P.merge(freeze(a.pet), freeze(b.pet), t), m2 = P.merge(freeze(b.pet), freeze(a.pet), t);
    const vals = Object.values(m1.got[D]).sort();
    const again = earnAt(P, m1, 'p5', t + 60e3);
    out.push({ kind, a: [a.food, a.id], b: [b.food, b.id], got: m1.got[D], stock: stockAll(m1, t), same: P.canon(m1) === P.canon(m2), again: again.result,
      ok: a.food === kind && b.food === 'tomato' && J(vals) === J([kind, 'tomato'].sort()) && stockAll(m1, t) === (kind === 'yam' ? 'tomato:1,yam:1' : 'tomato:1,worm:1')
        && P.canon(m1) === P.canon(m2) && again.result === 'dup' && (kind !== 'worm' || (m1.once && m1.once['w:s1'] === D)) });
  }
  return { ok: out.every(x => x.ok), detail: J(out) };
};
T['特別的券吃掉以後跟另一台同一個來源的一般券合併:吃掉的還是地瓜、另一台的小番茄還在'] = () => {
  const t = tp(D + ' 09:00:00');
  const a = earnAt(P, specialBase('yam'), 'p5', t), b = earnAt(P, specialBase(''), 'p5', t);
  const ea = P.eat(freeze(a.pet), 'yam', 'ea1', t + 60e3);
  const m = P.merge(freeze(ea.pet), freeze(b.pet), t + 120e3);
  const pa = P.pantry(freeze(m), t + 120e3);
  return { ok: ea.ok && pa.ateFood === 'yam' && pa.stock.tomato === 1 && pa.stock.yam === 0 && pa.ateCount === 1, detail: J({ got: m.got, ate: m.ate, pa: [pa.ateFood, pa.stock] }) };
};
T['特別的券記在自己的 id(y_<來源>、w:s<階段>_<來源>),同一個來源再做是 dup;來源 id 很長時截到 24 個字,一樣認得出來'] = () => {
  const y = earn(streakPet(D, 7), 'p5', 0), y2 = earn(y.pet, 'p5', 1);
  const w = earn(specialBase('worm'), 'g:ga-01', 0), w2 = earn(w.pet, 'g:ga-01', 1);
  const long = 'r:' + 'a'.repeat(22);
  const l = earn(specialBase('worm'), long, 0), l2 = earn(l.pet, long, 1), l3 = earn(l.pet, 'r:art-03', 2);
  const lid = Object.keys(l.pet.got[D])[0];
  return { ok: y.id === 'y_p5' && J(y.pet.got[D]) === J({ y_p5: 'yam' }) && y2.result === 'dup' && w.id === 'w:s1_g:ga-01' && w2.result === 'dup'
      && lid.length === 24 && l.food === 'worm' && l2.result === 'dup' && l3.result === 'got' && l3.food === 'tomato' && typeof P.usedSource === 'function' && P.usedSource(l.pet.got[D], long),
    detail: J([y.id, y2.result, w.id, w2.result, lid, l2.result, l3.result]) };
};
/* 兩台起點不同(一台看得到特別的日子、另一台看不到),同一天各自離線、來源有重疊:合併後每一張券的種類跟寫它的那台一樣,每種剩幾份照兩台的券和吃掉紀錄算 */
function expectStock(list, d) {
  const got = {}, ate = new Set();
  list.forEach(p => { Object.keys((p.got && p.got[d]) || {}).forEach(id => { got[id] = p.got[d][id]; }); Object.values((p.ate && p.ate[d]) || {}).forEach(tk => ate.add(tk)); });
  const n = {};
  Object.keys(got).forEach(id => { n[got[id]] = (n[got[id]] || 0) + (ate.has(d + '/' + id) ? 0 : 1); });
  return SN.filter(f => n[f]).map(f => f + ':' + n[f]).join(',');
}
const SHARED = ['p5', 'p6', 'd', 'iv', 'fall', 'm', 'mock', 'l1'];
function offlineFrom(r, base, d, tag) {
  let p = base;
  for (let k = 0; k < 10; k++) {
    const t = now(d) + k * 61e3;
    if (r() < 0.65) { const e = earnAt(P, p, pick(r, SHARED), t, '2026-11-01'); if (e.result === 'got') p = e.pet; }
    else { const pa = P.pantry(freeze(p), t); const f = pa.order.filter(x => pa.stock[x] > 0); if (f.length) { const e = P.eat(freeze(p), pick(r, f), tag + k, t); if (e.ok) p = e.pet; } }
  }
  return p;
}
function valuesKept(list, m, d) {
  const bad = [];
  list.forEach((p, i) => {
    Object.keys((p.got && p.got[d]) || {}).forEach(id => { if (!m.got || !m.got[d] || m.got[d][id] !== p.got[d][id]) bad.push(i + ' 券 ' + id + ' ' + p.got[d][id] + '→' + (m.got && m.got[d] && m.got[d][id])); });
    Object.keys((p.ate && p.ate[d]) || {}).forEach(id => { if (!m.ate || !m.ate[d] || m.ate[d][id] !== p.ate[d][id]) bad.push(i + ' 吃掉 ' + id); });
  });
  return bad;
}
T['隨機 300 組:兩台起點不同(一台有地瓜或麵包蟲、另一台沒有)、同一天各自離線、來源重疊;合併後每張券的種類、每筆吃掉、每種剩幾份都跟兩台加起來一樣'] = () => {
  const bad = [];
  let specials = 0, clash = 0;
  for (let s = 0; s < 300; s++) {
    const r = rng(91000 + s);
    const ka = pick(r, ['yam', 'worm', '']), kb = pick(r, ['yam', 'worm', '']);
    const A = freeze(offlineFrom(r, specialBase(ka), D, 'xa')), B = freeze(offlineFrom(r, specialBase(kb), D, 'xb'));
    const t = now(D) + 3600e3;
    const m1 = P.merge(A, B, t), m2 = P.merge(B, A, t);
    const vs = Object.values(A.got && A.got[D] || {}).concat(Object.values(B.got && B.got[D] || {}));
    if (vs.some(v => v === 'yam' || v === 'worm')) specials++;
    const srcA = Object.keys(A.got && A.got[D] || {}).map(id => id.replace(/^(y|w:[a-z0-9]+)_/, '')), srcB = Object.keys(B.got && B.got[D] || {}).map(id => id.replace(/^(y|w:[a-z0-9]+)_/, ''));
    if (srcA.some(x => srcB.includes(x))) clash++;
    const tag = '#' + s + ' ' + ka + '/' + kb;
    valuesKept([A, B], m1, D).slice(0, 2).forEach(x => bad.push(tag + ' ' + x));
    if (stockAll(m1, t) !== expectStock([A, B], D)) bad.push(tag + ' 剩的份數 ' + stockAll(m1, t) + ' 應該 ' + expectStock([A, B], D));
    if (P.canon(m1) !== P.canon(m2)) bad.push(tag + ' 方向不同');
  }
  return { ok: !bad.length && specials > 50 && clash > 50, detail: (bad.slice(0, 5).join(' | ') || 'ok') + ' / 有特別的 ' + specials + ' 組、來源撞到 ' + clash + ' 組' };
};
/* ---------- 三台同一天各自離線(審查第 1 輪 #2) ---------- */
T['三台同一天各自離線、各拿 3 份吃 3 份(不同的來源):任何合併順序,9 張券、9 筆吃掉都在,每種剩幾份照三台加起來算'] = () => {
  const d = D, srcs = [['p5', 'p6', 'p7'], ['l1', 'l2', 'es'], ['fall', 'pairs', 'iv']];
  const devs = srcs.map((ids, i) => {
    let p = pet();
    ids.forEach((id, k) => { p = earn(p, id, k).pet; });
    const pa = P.pantry(freeze(p), now(d));
    pa.order.filter(f => pa.stock[f] > 0).slice(0, 3).forEach((f, k) => { const e = P.eat(freeze(p), f, 'zz' + i + k, now(d) + k); if (e.ok) p = e.pet; });
    return freeze(p);
  });
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const bad = [];
  const res = orders.map(o => P.merge(freeze(P.merge(devs[o[0]], devs[o[1]], now(d))), devs[o[2]], now(d)));
  res.forEach((m, i) => {
    if (Object.keys(m.got[d]).length !== 9 || Object.keys(m.ate[d] || {}).length !== devs.reduce((n, p) => n + Object.keys(p.ate[d] || {}).length, 0)) bad.push(orders[i].join('') + ' 張數 ' + Object.keys(m.got[d]).length);
    valuesKept(devs, m, d).slice(0, 2).forEach(x => bad.push(orders[i].join('') + ' ' + x));
    if (P.canon(m) !== P.canon(res[0])) bad.push(orders[i].join('') + ' 順序不同');
    if (P.canon(P.sanitize(freeze(m), now(d)).pet) !== P.canon(m)) bad.push(orders[i].join('') + ' 再整理變了');
  });
  return { ok: !bad.length && stockAll(res[0], now(d)) === expectStock(devs, d), detail: (bad.slice(0, 4).join(' | ') || 'ok') + ' / ' + stockAll(res[0], now(d)) + ' 應該 ' + expectStock(devs, d) };
};
T['隨機 200 組:三台起點不同、同一天各自離線;任何合併順序,每張券的種類、每筆吃掉、每種剩幾份都跟三台加起來一樣'] = () => {
  const bad = [];
  let nine = 0;
  for (let s = 0; s < 200; s++) {
    const r = rng(93000 + s);
    const devs = ['xa', 'xb', 'xc'].map(tag => freeze(offlineFrom(r, specialBase(pick(r, ['yam', 'worm', '', ''])), D, tag)));
    const t = now(D) + 3600e3;
    const o = pick(r, [[0, 1, 2], [2, 1, 0], [1, 2, 0]]);
    const m = P.merge(freeze(P.merge(devs[o[0]], devs[o[1]], t)), devs[o[2]], t);
    if (Object.keys(m.got && m.got[D] || {}).length > 6) nine++;
    const tag = '#' + s;
    valuesKept(devs, m, D).slice(0, 2).forEach(x => bad.push(tag + ' ' + x));
    if (stockAll(m, t) !== expectStock(devs, D)) bad.push(tag + ' 剩的份數');
  }
  return { ok: !bad.length && nine > 20, detail: (bad.slice(0, 5).join(' | ') || 'ok') + ' / 合併後超過 6 張的 ' + nine + ' 組' };
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
