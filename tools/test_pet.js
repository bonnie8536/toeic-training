/* 小雞的純計算測試(路線圖 1.2a,規格在 repo 外的 小雞規格.md 第 3、5、9 節)。
   用法:node tools/test_pet.js
   js/pet.js 在沒有 store、document、localStorage 的沙盒裡載入,碰到就會丟錯,證明它不讀寫任何鍵。
   輸入一律先深度凍結,函式改到輸入(例如 hist)也會丟錯。
   最後用 TZ=UTC 與 TZ=America/Los_Angeles 各再跑一次,確認跨日只看台北時間、不看裝置時區。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'pet.js'), 'utf8');
/* 第二階段第 1 步的比對基準:origin/main f18d208 的 js/pet.js 原樣複製(git hash-object 跟 f18d208:js/pet.js 相同) */
const BASE_SRC = fs.readFileSync(path.join(__dirname, 'fixtures', 'pet_v1_baseline.js'), 'utf8');
function load(src) {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(src || SRC, ctx);
  return ctx.PET;
}
const P = load();
const BASE = load(BASE_SRC);
/* 第二階段第 1 步的相容版(線上 27557eb 的 js/pet.js 原樣複製):證明線上那版遇到 v2 只看不寫 */
const STEP1 = load(fs.readFileSync(path.join(__dirname, 'fixtures', 'pet_step1.js'), 'utf8'));

function freeze(o) {
  if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); }
  return o;
}
/* 台北時間 'YYYY-MM-DD HH:MM:SS' 轉成時間戳 */
function tp(s) { return Date.parse(s.replace(' ', 'T') + '+08:00'); }
function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
/* 某天(台北)做了 n 題,每題隔 10 秒,題號不重複 */
function dayHist(d, n, m = 'p5', from = 0) {
  const t0 = tp(d + ' 10:00:00');
  return Array.from({ length: n }, (_, i) => ({ m, id: m + '-' + d + '-' + (from + i), c: 0, ok: true, t: t0 + (from + i) * 10000 }));
}
function practiceDays(dates, n = 20) { return dates.flatMap(d => dayHist(d, n)); }
function range(from, count) { return Array.from({ length: count }, (_, i) => addDays(from, i)); }
const now = d => tp(d + ' 12:00:00');

const T = {};

/* ---------- 台北日期 ---------- */
T['台北跨日:23:59:59 還是當天,00:00 換下一天'] = () => {
  const a = P.dateOf(tp('2026-10-07 23:59:59')), b = P.dateOf(tp('2026-10-08 00:00:00'));
  return { ok: a === '2026-10-07' && b === '2026-10-08', detail: a + ' / ' + b };
};
T['台北早上 7 點前是 UTC 前一天,日期照台北算'] = () => {
  const d = P.dateOf(Date.parse('2026-10-07T17:30:00Z'));
  return { ok: d === '2026-10-08', detail: d };
};
T['睡覺時段:23 點到 7 點(台北)'] = () => {
  const r = ['22:59', '23:00', '03:00', '06:59', '07:00'].map(h => P.isSleeping(tp('2026-10-07 ' + h + ':00')));
  return { ok: JSON.stringify(r) === '[false,true,true,true,false]', detail: JSON.stringify(r) };
};

/* ---------- 有效題數 ---------- */
T['同一題同一天只算 1 顆,隔天再做可以再算'] = () => {
  const h = freeze([
    { m: 'g', id: 'ga-01:0', t: tp('2026-10-07 10:00:00') },
    { m: 'g', id: 'ga-01:0', t: tp('2026-10-07 10:05:00') },
    { m: 'g', id: 'ga-01:1', t: tp('2026-10-07 10:06:00') },
    { m: 'g', id: 'ga-01:0', t: tp('2026-10-08 10:00:00') },
  ]);
  const c = P.countHist(h);
  return { ok: c['2026-10-07'] === 2 && c['2026-10-08'] === 1, detail: JSON.stringify(c) };
};
T['不同模組同一題號分開算'] = () => {
  const c = P.countHist(freeze([{ m: 'p5', id: 'x1', t: tp('2026-10-07 10:00:00') }, { m: 'l2', id: 'x1', t: tp('2026-10-07 10:00:10') }]));
  return { ok: c['2026-10-07'] === 2, detail: JSON.stringify(c) };
};
T['跟上一題相隔不到 2 秒的不算'] = () => {
  const t = tp('2026-10-07 10:00:00');
  const c = P.countHist(freeze([
    { m: 'vq', id: 'a', t }, { m: 'vq', id: 'b', t: t + 900 }, { m: 'vq', id: 'c', t: t + 1800 }, { m: 'vq', id: 'd', t: t + 4000 },
  ]));
  return { ok: c['2026-10-07'] === 2, detail: JSON.stringify(c) + '(a、d 算,b、c 不算)' };
};
T['交卷一次寫很多筆(同一毫秒):整批都算'] = () => {
  /* practice.js 的隨機練習與聽力題組是交卷時用迴圈一次記錄,時間戳相同或只差幾毫秒 */
  const t = tp('2026-10-07 10:00:00');
  const batch = Array.from({ length: 15 }, (_, i) => ({ m: 'p5', id: 'q' + i, t: t + (i > 10 ? 1 : 0) }));
  const c = P.countHist(freeze(batch));
  return { ok: c['2026-10-07'] === 15, detail: JSON.stringify(c) };
};
T['交卷那批跟前一筆相隔不到 2 秒:整批不算(跟一般連按一樣)'] = () => {
  const t = tp('2026-10-07 10:00:00');
  const h = [{ m: 'r', id: 'a:0', t }].concat(Array.from({ length: 5 }, (_, i) => ({ m: 'p5', id: 'q' + i, t: t + 1000 })));
  const c = P.countHist(freeze(h));
  return { ok: c['2026-10-07'] === 1, detail: JSON.stringify(c) };
};
T['單字考題整份 1 筆:用 extra.n 算題數'] = () => {
  const c = P.countHist(freeze([{ m: 'tq', id: 'art-03', c: 7, ok: false, n: 9, t: tp('2026-10-07 10:00:00') }]));
  return { ok: c['2026-10-07'] === 9, detail: JSON.stringify(c) };
};
T['單字考題同一篇同一天重做:只算第一次'] = () => {
  const c = P.countHist(freeze([
    { m: 'tq', id: 'art-03', n: 9, t: tp('2026-10-07 10:00:00') },
    { m: 'tq', id: 'art-03', n: 9, t: tp('2026-10-07 11:00:00') },
  ]));
  return { ok: c['2026-10-07'] === 9, detail: JSON.stringify(c) };
};
T['翻牌配對一局:用配對數;同一副牌同一天只算一次,不同副牌各算'] = () => {
  const c = P.countHist(freeze([
    { m: 'vq', id: 'pairs', c: 20, ok: true, q: '翻牌配對 初級單字：8 對', g: 'pairs', t: tp('2026-10-07 10:00:00') },
    { m: 'vq', id: 'pairs', c: 18, ok: true, q: '翻牌配對 初級單字：8 對', g: 'pairs', t: tp('2026-10-07 10:10:00') },
    { m: 'vq', id: 'pairs', c: 18, ok: true, q: '翻牌配對 我的題庫：6 對', g: 'pairs', t: tp('2026-10-07 10:20:00') },
  ]));
  return { ok: c['2026-10-07'] === 14, detail: JSON.stringify(c) };
};
T['壞掉的 n(負數、超大、字串)不會灌題數'] = () => {
  const t = tp('2026-10-07 10:00:00');
  const c = P.countHist(freeze([
    { m: 'tq', id: 'a', n: -5, t }, { m: 'tq', id: 'b', n: 1e9, t: t + 10000 }, { m: 'tq', id: 'c', n: 'x', t: t + 20000 },
  ]));
  const v = c['2026-10-07'];
  return { ok: v >= 3 && v <= 3 + 50, detail: JSON.stringify(c) + '(每筆至少 1、最多 50)' };
};
T['hist 不是陣列、紀錄缺時間或亂掉:跳過不丟錯'] = () => {
  const a = P.countHist(null), b = P.countHist('x');
  const c = P.countHist(freeze([null, 5, { m: 'p5', id: 'a' }, { m: 'p5', id: 'b', t: 'abc' }, { m: 'p5', id: 'c', t: tp('2026-10-07 10:00:00') }]));
  return { ok: JSON.stringify(a) === '{}' && JSON.stringify(b) === '{}' && c['2026-10-07'] === 1, detail: JSON.stringify([a, b, c]) };
};
T['hist 順序亂掉也照時間算'] = () => {
  const t = tp('2026-10-07 10:00:00');
  const c = P.countHist(freeze([{ m: 'p5', id: 'b', t: t + 10000 }, { m: 'p5', id: 'a', t }, { m: 'p5', id: 'c', t: t + 500 }]));
  return { ok: c['2026-10-07'] === 2, detail: JSON.stringify(c) };
};

/* ---------- 目標 ---------- */
T['預設目標 20;改目標從明天生效,今天已達標不撤銷'] = () => {
  const d = '2026-10-07';
  let r = P.reconcile({ local: null, remote: null, hist: freeze(dayHist(d, 22)), now: now(d) });
  const before = P.status(r.pet, now(d));
  const p2 = P.setGoal(freeze(r.pet), 40, now(d));
  const r2 = P.reconcile({ local: freeze(p2), remote: null, hist: freeze(dayHist(d, 22)), now: now(d) });
  const s = P.status(r2.pet, now(d));
  const tom = P.status(r2.pet, now(addDays(d, 1)));
  return { ok: before.goal === 20 && before.metToday && s.goal === 20 && s.metToday && s.nextGoal === 40 && tom.goal === 40,
           detail: JSON.stringify({ before: before.goal, today: s.goal, metToday: s.metToday, next: s.nextGoal, tomorrow: tom.goal }) };
};
T['目標只接受 10、20、40'] = () => {
  const p = P.reconcile({ local: null, remote: null, hist: [], now: now('2026-10-07') }).pet;
  let threw = 0;
  [15, '20', null, 0].forEach(n => { try { P.setGoal(p, n, now('2026-10-07')); } catch (e) { threw++; } });
  return { ok: threw === 4, detail: '丟錯 ' + threw + ' / 4' };
};
T['同一天改兩次目標:只留最後一次'] = () => {
  const d = '2026-10-07';
  let p = P.reconcile({ local: null, remote: null, hist: [], now: now(d) }).pet;
  p = P.setGoal(p, 40, now(d)); p = P.setGoal(p, 10, now(d) + 1000);
  const fromTom = p.goals.filter(g => g.from === addDays(d, 1));
  return { ok: fromTom.length === 1 && fromTom[0].n === 10 && P.status(p, now(addDays(d, 1))).goal === 10, detail: JSON.stringify(p.goals) };
};
T['兩台各改了明天的目標:合併後取後改的那台'] = () => {
  const d = '2026-10-07';
  const base = P.reconcile({ local: null, remote: null, hist: [], now: now(d) }).pet;
  const a = P.setGoal(base, 40, now(d)), b = P.setGoal(base, 10, now(d) + 60000);
  const m1 = P.merge(a, b, now(d)), m2 = P.merge(b, a, now(d));
  return { ok: P.status(m1, now(addDays(d, 1))).goal === 10 && JSON.stringify(m1) === JSON.stringify(m2), detail: JSON.stringify(m1.goals) };
};

/* ---------- 連續天數與保護卡 ---------- */
function statusAfter(dates, today) {
  const r = P.reconcile({ local: null, remote: null, hist: freeze(practiceDays(dates, 1)), now: now(today) });
  return P.status(r.pet, now(today));
}
T['連續 7 天:連續 7、保護卡從 1 張變 2 張'] = () => {
  const s = statusAfter(range('2026-10-01', 7), '2026-10-07');
  return { ok: s.streak === 7 && s.shields === 2, detail: JSON.stringify({ streak: s.streak, shields: s.shields }) };
};
T['今天還沒練:從昨天往回數,連續天數不斷,也不先用掉保護卡'] = () => {
  const s = statusAfter(range('2026-10-01', 6), '2026-10-07');
  return { ok: s.streak === 6 && s.todayCount === 0 && s.shields === 1, detail: JSON.stringify({ streak: s.streak, today: s.todayCount, shields: s.shields }) };
};
T['漏一天:用掉一張保護卡,連續天數不斷(保護那天不加天數)'] = () => {
  const dates = range('2026-10-01', 3).concat(range('2026-10-05', 3)); // 10/4 漏掉
  const s = statusAfter(dates, '2026-10-07');
  return { ok: s.streak === 6 && s.shields === 0 && s.broken === false, detail: JSON.stringify({ streak: s.streak, shields: s.shields }) };
};
T['漏三天、只有一張:連續斷掉,顯示「一起練了 N 天」用的累積天數還在'] = () => {
  const dates = range('2026-10-01', 3).concat(['2026-10-07']); // 10/4、5、6 漏掉
  const s = statusAfter(dates, '2026-10-07');
  return { ok: s.streak === 1 && s.broken === false && s.practicedDays === 4, detail: JSON.stringify(s) };
};
T['斷掉之後今天還沒練:streak 0、broken,保護卡不會憑空回來'] = () => {
  const s = statusAfter(range('2026-10-01', 2), '2026-10-07');
  return { ok: s.streak === 0 && s.broken === true && s.shields === 0 && s.practicedDays === 2, detail: JSON.stringify(s) };
};
T['保護卡最多 2 張(連 21 天)'] = () => {
  const s = statusAfter(range('2026-09-17', 21), '2026-10-07');
  return { ok: s.streak === 21 && s.shields === 2, detail: JSON.stringify({ streak: s.streak, shields: s.shields }) };
};
T['兩台互蓋後保護卡不會重複發、不會兩台各用一次'] = () => {
  /* A 台:10/1-10/7 每天練;B 台:只有 10/1-10/3 的紀錄。兩份 pet 合併幾次結果都一樣 */
  const A = P.reconcile({ local: null, remote: null, hist: freeze(practiceDays(range('2026-10-01', 7), 1)), now: now('2026-10-07') }).pet;
  const B = P.reconcile({ local: null, remote: null, hist: freeze(practiceDays(range('2026-10-01', 3), 1)), now: now('2026-10-07') }).pet;
  const m = P.merge(P.merge(A, B, now('2026-10-07')), B, now('2026-10-07'));
  const s = P.status(m, now('2026-10-07'));
  return { ok: s.streak === 7 && s.shields === 2, detail: JSON.stringify({ streak: s.streak, shields: s.shields }) };
};

/* ---------- 成長 ---------- */
T['成長階段依累積達標天數:0 蛋、1、3、7、14、21、30'] = () => {
  const want = { 0: 0, 1: 1, 2: 1, 3: 2, 6: 2, 7: 3, 13: 3, 14: 4, 21: 5, 29: 5, 30: 6, 59: 6, 60: 6 };
  const got = {};
  Object.keys(want).forEach(k => { got[k] = P.stageOf(+k); });
  return { ok: JSON.stringify(got) === JSON.stringify(want), detail: JSON.stringify(got) };
};
T['配件:30 天以後每滿 30 天一個'] = () => {
  const r = [29, 30, 59, 60, 89, 90].map(P.accessoriesOf);
  return { ok: JSON.stringify(r) === '[0,0,0,1,1,2]', detail: JSON.stringify(r) };
};
T['達標要答滿當天目標;有練沒達標不算成長'] = () => {
  const h = dayHist('2026-10-06', 19).concat(dayHist('2026-10-07', 20));
  const r = P.reconcile({ local: null, remote: null, hist: freeze(h), now: now('2026-10-07') });
  const s = P.status(r.pet, now('2026-10-07'));
  return { ok: s.totalMet === 1 && s.stage === 1 && s.practicedDays === 2, detail: JSON.stringify(r.pet.met) };
};
T['從不餵食的學生 70 天後:hist 已經清掉,成長不倒退'] = () => {
  /* 每天打開都會重算並寫回(reconcile 回 changed),所以就算從不餵,達標天也存進了 pet */
  let pet = null;
  range('2026-08-01', 10).forEach(d => {
    const r = P.reconcile({ local: pet && freeze(pet), remote: null, hist: freeze(dayHist(d, 20)), now: now(d) });
    if (r.changed) pet = r.pet;
  });
  const late = '2026-10-10';
  const r = P.reconcile({ local: freeze(pet), remote: null, hist: [], now: now(late) }); // 60 天前的 hist 已被 logAttempt 刪掉
  const s = P.status(r.pet, now(late));
  return { ok: s.totalMet === 10 && s.stage === 3, detail: JSON.stringify({ totalMet: s.totalMet, stage: s.stage }) };
};

/* ---------- 合併、兩台裝置 ---------- */
T['兩台互蓋 pet 與 hist:天數不倒退(逐日取大)'] = () => {
  const d = '2026-10-07';
  const A = P.reconcile({ local: null, remote: null, hist: freeze(dayHist(d, 30)), now: now(d) }).pet;
  /* B 台的 hist 蓋掉了 A 的(只剩 5 題),pet 是舊的 */
  const r = P.reconcile({ local: null, remote: freeze(A), hist: freeze(dayHist(d, 5, 'vq')), now: now(d) });
  const s = P.status(r.pet, now(d));
  return { ok: r.pet.days[d] === 30 && s.metToday, detail: JSON.stringify(r.pet.days) };
};
T['合併:交換順序結果一樣、合併兩次結果不變'] = () => {
  const A = P.reconcile({ local: null, remote: null, hist: freeze(practiceDays(range('2026-10-01', 4), 25)), now: now('2026-10-07') }).pet;
  const B0 = P.reconcile({ local: null, remote: null, hist: freeze(practiceDays(range('2026-10-03', 5), 12)), now: now('2026-10-07') }).pet;
  const B = Object.assign({}, B0, { name: '小黃', fed: { '2026-10-07': 3 } });
  const ab = P.merge(A, B, now('2026-10-07')), ba = P.merge(B, A, now('2026-10-07'));
  const abb = P.merge(ab, B, now('2026-10-07'));
  return { ok: P.canon(ab) === P.canon(ba) && P.canon(ab) === P.canon(abb) && ab.days['2026-10-03'] === 25 && ab.name === '小黃' && ab.fed['2026-10-07'] === 3,
           detail: P.canon(ab).slice(0, 200) };
};
T['born 取較早、名字取非空'] = () => {
  const a = { v: 1, born: '2026-10-05', name: '' }, b = { v: 1, born: '2026-10-03', name: '阿啾' };
  const m = P.merge(freeze(a), freeze(b), now('2026-10-07'));
  return { ok: m.born === '2026-10-03' && m.name === '阿啾', detail: JSON.stringify({ born: m.born, name: m.name }) };
};
T['兩台各取了不同名字:合併結果固定(不會兩台輪流換)'] = () => {
  const a = { v: 1, born: '2026-10-05', name: '阿啾' }, b = { v: 1, born: '2026-10-05', name: '小黃' };
  const m1 = P.merge(freeze(a), freeze(b), now('2026-10-07')), m2 = P.merge(freeze(b), freeze(a), now('2026-10-07'));
  return { ok: m1.name === m2.name && m1.name !== '', detail: m1.name + ' / ' + m2.name };
};
T['未來日期一律丟掉(裝置時鐘被調快)'] = () => {
  const bad = { v: 1, born: '2026-12-01', days: { '2026-10-07': 5, '2026-11-20': 99 }, met: ['2026-11-20'], fed: { '2026-11-20': 9 },
                goals: [{ from: '2026-10-01', n: 20 }] };
  const h = dayHist('2026-11-20', 30);
  const r = P.reconcile({ local: freeze(bad), remote: null, hist: freeze(h), now: now('2026-10-07') });
  const ok = !r.pet.days['2026-11-20'] && !r.pet.met.includes('2026-11-20') && !r.pet.fed['2026-11-20'] && r.pet.born <= '2026-10-07' && r.pet.days['2026-10-07'] === 5;
  return { ok, detail: JSON.stringify(r.pet) };
};
T['時鐘慢一天的裝置:不刪別台「明天」的進度,也不算進今天'] = () => {
  const A = P.reconcile({ local: null, remote: null, hist: freeze(dayHist('2026-10-08', 25)), now: now('2026-10-08') }).pet;
  const r = P.reconcile({ local: freeze(A), remote: freeze(A), hist: [], now: now('2026-10-07') });
  const s = P.status(r.pet, now('2026-10-07'));
  return { ok: r.pet.days['2026-10-08'] === 25 && !r.changed && !r.remoteBehind && s.todayCount === 0 && s.totalMet === 0 && s.practicedDays === 0,
           detail: JSON.stringify({ days: r.pet.days, changed: r.changed, behind: r.remoteBehind, s }) };
};
T['hist 裡時間壞掉的紀錄(1970 年、超出日期範圍):不丟錯、不灌成長'] = () => {
  const h = [{ m: 'a', id: 1, t: 1e300 }, { m: 'a', id: 2, t: 8e15, n: 50 }, { m: 'a', id: 3, t: 1000, n: 50 }];
  const r = P.reconcile({ local: null, remote: null, hist: freeze(h), now: now('2026-10-07') });
  const s = P.status(r.pet, now('2026-10-07'));
  return { ok: s.totalMet === 0 && r.pet.oldMet === 0 && Object.keys(r.pet.days).length === 0, detail: JSON.stringify(r.pet) };
};
T['now 壞掉(NaN、undefined):不丟錯'] = () => {
  const p = P.reconcile({ local: null, remote: null, hist: [], now: NaN }).pet;
  P.status(p, undefined); P.feed(p, NaN); P.merge(p, p, undefined);
  return { ok: P.dateOf(Date.now()) === p.born, detail: p.born };
};
T['留 400 天:移出的達標天記進 oldMet,合併舊副本不重複計'] = () => {
  const dates = range('2025-08-01', 450);
  const today = dates[dates.length - 1];
  const oldCopy = P.reconcile({ local: null, remote: null, hist: freeze(practiceDays(dates.slice(0, 200), 20)), now: now(dates[199]) }).pet;
  /* 新的那份:450 天都達標,一路寫回(用 hist 分段灌,模擬每天打開) */
  let pet = null;
  for (let i = 0; i < 450; i += 30) {
    const chunk = dates.slice(i, i + 30);
    const at = chunk[chunk.length - 1];
    const r = P.reconcile({ local: pet && freeze(pet), remote: null, hist: freeze(practiceDays(chunk, 20)), now: now(at) });
    pet = r.pet;
  }
  const s1 = P.status(pet, now(today));
  const merged = P.merge(pet, freeze(oldCopy), now(today));
  const s2 = P.status(merged, now(today));
  const r3 = P.reconcile({ local: freeze(merged), remote: freeze(oldCopy), hist: [], now: now(today) });
  const s3 = P.status(r3.pet, now(today));
  return { ok: s1.totalMet === 450 && s2.totalMet === 450 && s3.totalMet === 450 && Object.keys(merged.days).length <= 400 && merged.oldMet === 50,
           detail: JSON.stringify({ s1: s1.totalMet, s2: s2.totalMet, s3: s3.totalMet, days: Object.keys(merged.days).length, oldMet: merged.oldMet, oldBefore: merged.oldBefore }) };
};
T['fed 只留最近 7 天'] = () => {
  const fed = {}; range('2026-09-25', 13).forEach(d => { fed[d] = 2; });
  const r = P.reconcile({ local: freeze({ v: 1, born: '2026-09-25', fed }), remote: null, hist: [], now: now('2026-10-07') });
  const keys = Object.keys(r.pet.fed).sort();
  return { ok: keys.length === 7 && keys[0] === '2026-10-01', detail: keys.join(',') };
};

/* ---------- 餵食 ---------- */
T['餵食:今天有幾顆就吃幾顆,吃完 food 0、不再餓;明天又餓'] = () => {
  const d = '2026-10-07';
  const r = P.reconcile({ local: null, remote: null, hist: freeze(dayHist(d, 8)), now: now(d) });
  const s0 = P.status(r.pet, now(d));
  const fed = P.feed(freeze(r.pet), now(d));
  const s1 = P.status(fed, now(d));
  const r2 = P.reconcile({ local: freeze(fed), remote: null, hist: freeze(dayHist(d, 8).concat(dayHist(d, 3, 'p5', 8))), now: now(d) + 3600e3 });
  const s2 = P.status(r2.pet, now(d) + 3600e3);
  const s3 = P.status(fed, now(addDays(d, 1)));
  return { ok: s0.food === 8 && s0.hungry && s1.food === 0 && !s1.hungry && s2.food === 3 && s3.hungry && s3.food === 0,
           detail: JSON.stringify({ s0: [s0.food, s0.hungry], s1: [s1.food, s1.hungry], s2: s2.food, s3: [s3.food, s3.hungry] }) };
};
T['餵食不改 days、met(只寫 fed)'] = () => {
  const d = '2026-10-07';
  const p = P.reconcile({ local: null, remote: null, hist: freeze(dayHist(d, 25)), now: now(d) }).pet;
  const f = P.feed(freeze(p), now(d));
  return { ok: P.canon(f.days) === P.canon(p.days) && P.canon(f.met) === P.canon(p.met) && f.fed[d] === 25, detail: JSON.stringify(f.fed) };
};

/* ---------- 壞掉與未來版本 ---------- */
T['pet 是字串、陣列、數字、v=3:唯讀,不寫回'] = () => {
  const r = ['亂碼', [1, 2], 42, { v: 3, days: { '2026-10-07': 5 } }, true].map(x =>
    P.reconcile({ local: freeze(x), remote: null, hist: freeze(dayHist('2026-10-07', 20)), now: now('2026-10-07') }));
  return { ok: r.every(x => x.readOnly && !x.changed), detail: JSON.stringify(r.map(x => [x.readOnly, x.changed])) };
};
T['雲端那份是 v=3(別台裝了更新的版本):本機也不寫回,免得蓋掉新格式'] = () => {
  const r = P.reconcile({ local: null, remote: freeze({ v: 3, days: {} }), hist: freeze(dayHist('2026-10-07', 20)), now: now('2026-10-07') });
  return { ok: r.readOnly && !r.changed, detail: JSON.stringify([r.readOnly, r.changed]) };
};
T['唯讀時還是算得出今天的題數給畫面看'] = () => {
  const r = P.reconcile({ local: freeze('亂碼'), remote: null, hist: freeze(dayHist('2026-10-07', 12)), now: now('2026-10-07') });
  const s = P.status(r.pet, now('2026-10-07'));
  return { ok: r.readOnly && s.todayCount === 12, detail: JSON.stringify(s) };
};
T['pet 是 null(第一次打開):建新的,born 今天、目標 20,要寫回'] = () => {
  const r = P.reconcile({ local: null, remote: null, hist: [], now: now('2026-10-07') });
  return { ok: !r.readOnly && r.changed && r.pet.born === '2026-10-07' && r.pet.v === 1 && P.status(r.pet, now('2026-10-07')).goal === 20, detail: JSON.stringify(r.pet) };
};
T['部分欄位壞掉:其他欄位保留'] = () => {
  const raw = { v: 1, born: '2026-10-01', name: '阿啾', days: '壞掉', met: ['2026-10-02', 'xx', '2026-13-40', 5], goals: [{ from: '2026-10-01', n: 40 }, { from: 'x', n: 20 }, { from: '2026-10-03', n: 7 }],
                fed: [1], oldMet: -3, oldBefore: 'abc' };
  const r = P.reconcile({ local: freeze(raw), remote: null, hist: [], now: now('2026-10-07') });
  const p = r.pet;
  const ok = !r.readOnly && p.name === '阿啾' && p.born === '2026-10-01' && JSON.stringify(p.met) === '["2026-10-02"]' && JSON.stringify(p.days) === '{}' &&
             p.goals.length === 1 && p.goals[0].n === 40 && JSON.stringify(p.fed) === '{}' && p.oldMet === 0 && p.oldBefore === '';
  return { ok, detail: JSON.stringify(p) };
};
T['名字超過 10 個字截斷;不是字串就空白'] = () => {
  const a = P.sanitize({ v: 1, name: '一二三四五六七八九十十一' }, now('2026-10-07')).pet.name;
  const b = P.sanitize({ v: 1, name: { x: 1 } }, now('2026-10-07')).pet.name;
  return { ok: Array.from(a).length === 10 && b === '', detail: a + ' / ' + JSON.stringify(b) };
};
T['days 的值壞掉(負數、小數、超大):那一天丟掉或夾住,其他天保留'] = () => {
  const p = P.sanitize({ v: 1, days: { '2026-10-01': -1, '2026-10-02': 2.5, '2026-10-03': 1e9, '2026-10-04': 7 } }, now('2026-10-07')).pet;
  return { ok: !('2026-10-01' in p.days) && p.days['2026-10-04'] === 7 && p.days['2026-10-03'] <= 10000 && Number.isInteger(p.days['2026-10-02'] || 0),
           detail: JSON.stringify(p.days) };
};
T['沒變就不寫回(changed=false)'] = () => {
  const d = '2026-10-07';
  const h = freeze(dayHist(d, 22));
  const r1 = P.reconcile({ local: null, remote: null, hist: h, now: now(d) });
  const r2 = P.reconcile({ local: freeze(JSON.parse(JSON.stringify(r1.pet))), remote: null, hist: h, now: now(d) + 1000 });
  return { ok: r1.changed && !r2.changed, detail: JSON.stringify([r1.changed, r2.changed]) };
};
T['雲端比本機多(別台的進度):changed,寫回合併後的版本'] = () => {
  const d = '2026-10-07';
  const local = P.reconcile({ local: null, remote: null, hist: freeze(dayHist(d, 5)), now: now(d) }).pet;
  const remote = P.reconcile({ local: null, remote: null, hist: freeze(dayHist('2026-10-06', 20)), now: now(d) }).pet;
  const r = P.reconcile({ local: freeze(local), remote: freeze(remote), hist: freeze(dayHist(d, 5)), now: now(d) });
  return { ok: r.changed && r.pet.days['2026-10-06'] === 20 && r.pet.days[d] === 5, detail: JSON.stringify(r.pet.days) };
};

/* ---------- 第二階段第 1 步:相容版(看得懂 v2、一筆都不寫;v1 跟 f18d208 逐位元組相同) ---------- */
const NEW_FIELDS = ['got', 'ate', 'foodOld', 'once', 'roam'];
const S1 = '2026-11-10';
function v2Rec(over) {
  const days = {}, met = [];
  range('2026-11-01', 10).forEach(d => { days[d] = 25; met.push(d); });
  return Object.assign({ v: 2, born: '2026-11-01', goals: [{ from: '2026-11-02', n: 20, at: 1 }], days, met, oldMet: 3, oldBefore: '2026-10-01', fed: { [S1]: 25 }, name: '小黃', nameAt: 5,
    got: { '2026-11-02': { d: 'corn' }, '2026-11-08': { y: 'yam' } }, ate: { '2026-11-02': { mh2lq01xk7: '2026-11-02/d' } },
    foodOld: { before: '2026-07-05', left: { corn: 2, yam: 1 } }, once: { diag: '2026-11-02' }, roam: { on: false, at: 1793000000000 } }, over || {});
}
/* 同一份 v2 只留認得的欄位、v 改 1:「舊版看得懂的那部分」 */
function strip(x) { const o = Object.assign({}, x, { v: 1 }); NEW_FIELDS.forEach(k => { delete o[k]; }); return o; }
const V2S = () => [
  v2Rec(),
  { v: 2 },
  v2Rec({ name: '阿啾', nameAt: 9, days: { '2026-11-09': 3, [S1]: 40 }, met: [S1], goals: [{ from: '2026-11-05', n: 40, at: 7 }], fed: {} }),
  v2Rec({ got: '壞掉', ate: [1], foodOld: 5, once: null, roam: 'x', days: '壞掉', name: 7 }),
];
/* 現在就存在的 v1 樣子:v 是 1、沒有 v、v 不是數字、v 是 0 或負數、多了不認得的欄位、欄位壞掉 */
const V1S = () => {
  const full = strip(v2Rec());
  return [
    null, {}, full,
    Object.assign({}, full, { v: undefined }), (() => { const o = Object.assign({}, full); delete o.v; return o; })(),
    Object.assign({}, full, { v: '2' }), Object.assign({}, full, { v: null }), Object.assign({}, full, { v: NaN }),
    Object.assign({}, full, { v: 0 }), Object.assign({}, full, { v: -1 }), Object.assign({}, full, { foo: 1, got: { x: 1 } }),
    { v: 1, born: '2026-11-01', name: '阿啾', days: '壞掉', met: ['2026-11-02', 'xx', 5], goals: [{ from: '2026-11-01', n: 40 }, { from: 'x', n: 20 }], fed: [1], oldMet: -3, oldBefore: 'abc' },
    { v: 1, born: '2026-12-30', days: { [S1]: 5, '2026-11-14': 9, '2026-12-30': 99 }, met: ['2026-11-14', '2026-12-30'], fed: { '2026-12-30': 9 } },
    strip(v2Rec({ name: '阿啾', nameAt: 9, days: { '2026-11-09': 3, [S1]: 40 }, met: [S1], fed: {} })),
  ];
};
const UNKNOWN = () => [{ v: 3, days: { [S1]: 5 } }, { v: 1.5, days: { [S1]: 5 } }, { v: Infinity }, { v: 1e9, name: 'x' }, [1, 2], '亂碼', '\u0000corrupt', 42, true];
const HISTS = () => [[], dayHist(S1, 8), dayHist('2026-11-09', 30).concat(dayHist(S1, 2, 'g'))];
const NOWS = [now(S1), tp(S1 + ' 23:30:00'), now('2026-11-20'), NaN];
const J = x => JSON.stringify(x);
function same2(fn) {
  /* 新舊兩版各跑一次;丟錯也要丟一樣的錯 */
  let a, b;
  try { a = 'ok:' + J(fn(P)); } catch (e) { a = 'err:' + e.message; }
  try { b = 'ok:' + J(fn(BASE)); } catch (e) { b = 'err:' + e.message; }
  return a === b ? null : a.slice(0, 160) + '  ≠  ' + b.slice(0, 160);
}
T['第 1 步 v1:sanitize、reconcile、status、canon、merge、feed、setGoal、rename 跟 f18d208 逐位元組相同'] = () => {
  const bad = [];
  const v1s = V1S(), unk = UNKNOWN();
  const sides = v1s.concat(unk);
  let n = 0;
  sides.forEach((x, i) => NOWS.forEach(t => {
    n++; const d1 = same2(Q => Q.sanitize(freeze(x), t)); if (d1) bad.push('sanitize#' + i + ' ' + d1);
    n++; const d2 = same2(Q => Q.status(freeze(x), t)); if (d2) bad.push('status#' + i + ' ' + d2);
    n++; const d3 = same2(Q => Q.canon(freeze(x))); if (d3) bad.push('canon#' + i + ' ' + d3);
  }));
  sides.forEach((l, i) => sides.forEach((r, j) => HISTS().forEach((h, k) => [now(S1), now('2026-11-20')].forEach(t => {
    n++; const d = same2(Q => Q.reconcile({ local: freeze(l), remote: freeze(r), hist: freeze(h), now: t }));
    if (d) bad.push('reconcile#' + i + ',' + j + ',' + k + ' ' + d);
  }))));
  v1s.forEach((a, i) => v1s.forEach((b, j) => {
    n++; const d = same2(Q => Q.merge(freeze(a), freeze(b), now(S1))); if (d) bad.push('merge#' + i + ',' + j + ' ' + d);
  }));
  v1s.forEach((x, i) => NOWS.forEach(t => {
    n++; const f = same2(Q => Q.feed(freeze(x), t)); if (f) bad.push('feed#' + i + ' ' + f);
    n++; const g = same2(Q => Q.setGoal(freeze(x), 40, t)); if (g) bad.push('setGoal#' + i + ' ' + g);
    n++; const r = same2(Q => Q.rename(freeze(x), ' 小黃黃 ', t)); if (r) bad.push('rename#' + i + ' ' + r);
  }));
  return { ok: !bad.length && n > 2000, detail: '比了 ' + n + ' 組,不同 ' + bad.length + ':' + bad.slice(0, 3).join(' | ') };
};
T['第 1 步 v1:一路每天打開、餵食、改目標、取名 30 天,每次 changed、remoteBehind 與寫出去的那份都跟 f18d208 相同'] = () => {
  const bad = [];
  const run = Q => {
    let local = null, remote = null; const log = [];
    range('2026-11-01', 30).forEach((d, i) => {
      const r = Q.reconcile({ local: local && freeze(JSON.parse(J(local))), remote: remote && freeze(JSON.parse(J(remote))), hist: freeze(dayHist(d, 5 + (i % 4) * 7)), now: now(d) });
      let p = r.pet;
      if (i % 3 === 0) p = Q.feed(freeze(p), now(d) + 60e3);
      if (i % 7 === 2) p = Q.setGoal(freeze(p), [10, 20, 40][i % 3], now(d) + 120e3);
      if (i % 11 === 5) p = Q.rename(freeze(p), '啾' + i, now(d) + 180e3);
      if (r.changed || p !== r.pet) local = p;
      if (r.remoteBehind || i % 5 === 0) remote = p;
      log.push(J([r.readOnly, r.changed, r.remoteBehind, Q.canon(p)]));
    });
    return log;
  };
  const a = run(P), b = run(BASE);
  a.forEach((x, i) => { if (x !== b[i]) bad.push('第 ' + (i + 1) + ' 天'); });
  return { ok: !bad.length && a.length === 30, detail: bad.join('、') || '30 天相同' };
};
T['第 1 步相容版:本機 v2、沒有雲端:唯讀、不寫;顯示的數字跟只留認得欄位的 v1 一樣,顯示的那份還是 v:2'] = () => {
  const bad = [];
  V2S().forEach((x, i) => HISTS().forEach((h, k) => {
    const r = STEP1.reconcile({ local: freeze(x), remote: null, hist: freeze(h), now: now(S1) });
    const ref = BASE.reconcile({ local: freeze(strip(x)), remote: null, hist: freeze(h), now: now(S1) });
    const sameShown = J(Object.assign({}, r.pet, { v: 1 })) === J(ref.pet) && J(STEP1.status(r.pet, now(S1))) === J(BASE.status(ref.pet, now(S1)));
    const noNew = NEW_FIELDS.every(f => !(f in r.pet));
    if (!(r.readOnly === true && r.changed === false && r.remoteBehind === false && r.pet.v === 2 && sameShown && noNew)) bad.push('#' + i + ',' + k + ' ' + J([r.readOnly, r.changed, r.pet.v, sameShown, noNew]));
  }));
  const s = STEP1.status(STEP1.reconcile({ local: freeze(v2Rec()), remote: null, hist: [], now: now(S1) }).pet, now(S1));
  const shown = { stage: s.stage, name: s.name, streak: s.streak, shields: s.shields, todayCount: s.todayCount, food: s.food, hungry: s.hungry, totalMet: s.totalMet, goal: s.goal };
  const want = { stage: 3, name: '小黃', streak: 10, shields: 2, todayCount: 25, food: 0, hungry: false, totalMet: 13, goal: 20 };
  return { ok: !bad.length && J(shown) === J(want), detail: bad.slice(0, 3).join(' | ') + ' 畫面 ' + J(shown) };
};
T['第 1 步相容版:本機 v1 配雲端 v2、本機 v2 配雲端 v1、兩邊都 v2:唯讀、changed 與 remoteBehind 都 false,顯示兩邊合併'] = () => {
  const bad = [];
  const v2s = V2S(), v1s = V1S().filter(x => x !== null);
  const pairs = [];
  v1s.forEach(a => v2s.forEach(b => { pairs.push([a, b]); pairs.push([b, a]); }));
  v2s.forEach(a => v2s.forEach(b => pairs.push([a, b])));
  v2s.forEach(b => pairs.push([null, b]));
  pairs.forEach(([l, r], i) => HISTS().forEach((h, k) => {
    const x = STEP1.reconcile({ local: freeze(l), remote: freeze(r), hist: freeze(h), now: now(S1) });
    const sl = l && l.v === 2 ? strip(l) : l, sr = r && r.v === 2 ? strip(r) : r;
    const ref = BASE.reconcile({ local: freeze(sl), remote: freeze(sr), hist: freeze(h), now: now(S1) });
    const ok = x.readOnly === true && x.changed === false && x.remoteBehind === false && x.pet.v === 2 && J(Object.assign({}, x.pet, { v: 1 })) === J(ref.pet);
    if (!ok) bad.push('#' + i + ',' + k + ' ' + J([x.readOnly, x.changed, x.remoteBehind, x.pet.v]));
  }));
  /* 雲端 v2 有本機沒有的天與名字:顯示看得到 */
  const loc = { v: 1, born: '2026-11-09', days: { [S1]: 4 }, met: [] };
  const m = STEP1.reconcile({ local: freeze(loc), remote: freeze(v2Rec()), hist: [], now: now(S1) });
  const s = STEP1.status(m.pet, now(S1));
  return { ok: !bad.length && pairs.length > 50 && s.name === '小黃' && s.stage === 3 && m.pet.days[S1] === 25 && m.pet.born === '2026-11-01',
           detail: '比了 ' + pairs.length * 3 + ' 組,不對 ' + bad.length + ':' + bad.slice(0, 3).join(' | ') + ' / 合併後 ' + J({ name: s.name, stage: s.stage }) };
};
T['第 1 步相容版與新版:v2 配不認得的版本(v3、字串):整份唯讀;不認得的那份當成空的,v2 那份照常顯示'] = () => {
  const out = [];
  [STEP1, P].forEach(Q => [{ v: 3, days: { '2026-11-03': 99 } }, '亂碼', [1]].forEach(u => {
    [[v2Rec(), u], [u, v2Rec()]].forEach(([l, r]) => {
      const x = Q.reconcile({ local: freeze(l), remote: freeze(r), hist: [], now: now(S1) });
      out.push(x.readOnly && !x.changed && !x.remoteBehind && x.pet.v === 2 && x.pet.name === '小黃' && x.pet.days['2026-11-03'] === 25);
    });
  }));
  return { ok: out.every(Boolean), detail: J(out) };
};
T['第 1 步相容版:sanitize(v2) 是唯讀、保留 v:2 與認得的欄位,不帶新欄位;status(v2) 跟只留認得欄位的 v1 一樣'] = () => {
  const bad = [];
  V2S().forEach((x, i) => {
    const s = STEP1.sanitize(freeze(x), now(S1));
    const ref = BASE.sanitize(freeze(strip(x)), now(S1));
    if (!(s.readOnly === true && s.pet.v === 2 && J(Object.assign({}, s.pet, { v: 1 })) === J(ref.pet) && NEW_FIELDS.every(f => !(f in s.pet)))) bad.push('sanitize#' + i);
    if (J(STEP1.status(freeze(x), now(S1))) !== J(BASE.status(freeze(strip(x)), now(S1)))) bad.push('status#' + i);
  });
  return { ok: !bad.length, detail: bad.join('、') || 'ok' };
};
T['第 1 步相容版:feed、setGoal、rename、merge 拿到 v2 或不認得的版本:丟錯,不回傳任何 pet'] = () => {
  const bad = [];
  const ok1 = strip(v2Rec());
  V2S().concat(UNKNOWN()).forEach((x, i) => {
    const calls = {
      feed: () => STEP1.feed(freeze(x), now(S1)),
      setGoal: () => STEP1.setGoal(freeze(x), 40, now(S1)),
      rename: () => STEP1.rename(freeze(x), '啾', now(S1)),
      mergeA: () => STEP1.merge(freeze(x), freeze(ok1), now(S1)),
      mergeB: () => STEP1.merge(freeze(ok1), freeze(x), now(S1)),
    };
    Object.keys(calls).forEach(k => {
      let threw = false, got;
      try { got = calls[k](); } catch (e) { threw = true; }
      if (!threw) bad.push(k + '#' + i + ' 回了 ' + J(got).slice(0, 40));
    });
  });
  /* 一般的 v1 與 null 照常可以用 */
  let fine = true;
  try { STEP1.feed(null, now(S1)); STEP1.setGoal(null, 10, now(S1)); STEP1.rename(freeze(ok1), 'x', now(S1)); STEP1.merge(null, freeze(ok1), now(S1)); } catch (e) { fine = false; }
  return { ok: !bad.length && fine, detail: bad.slice(0, 4).join(' | ') + ' / v1 照常 ' + fine };
};
T['新版:feed、setGoal、rename、merge 拿到不認得的版本照舊丟錯;拿到 v2 照常做,回 v2、新欄位原樣帶著'] = () => {
  const bad = [];
  const ok1 = strip(v2Rec());
  UNKNOWN().forEach((x, i) => {
    [() => P.feed(freeze(x), now(S1)), () => P.setGoal(freeze(x), 40, now(S1)), () => P.rename(freeze(x), '啾', now(S1)),
     () => P.merge(freeze(x), freeze(ok1), now(S1)), () => P.merge(freeze(ok1), freeze(x), now(S1))].forEach((f, k) => {
      let threw = false; try { f(); } catch (e) { threw = true; }
      if (!threw) bad.push('unknown#' + i + ',' + k);
    });
  });
  const rec = v2Rec();
  const keepNew = p => J(NEW_FIELDS.map(f => p[f])) === J(NEW_FIELDS.map(f => P.sanitize(freeze(rec), now(S1)).pet[f]));
  const fed = P.feed(freeze(rec), now(S1)), goal = P.setGoal(freeze(rec), 40, now(S1)), nm = P.rename(freeze(rec), '啾', now(S1)), mg = P.merge(freeze(rec), freeze(ok1), now(S1));
  [['feed', fed], ['setGoal', goal], ['rename', nm], ['merge', mg]].forEach(([k, p]) => { if (p.v !== 2 || !keepNew(p)) bad.push(k + ' ' + J(p).slice(0, 80)); });
  if (fed.fed[S1] !== 25 || nm.name !== '啾' || !goal.goals.some(g => g.n === 40)) bad.push('動作沒做');
  return { ok: !bad.length, detail: bad.slice(0, 4).join(' | ') || 'ok' };
};
T['第 1 步相容版:不管拿到什麼,回傳要寫的那份(changed 或 remoteBehind)都不會是 v2、也沒有新欄位'] = () => {
  const bad = [];
  const sides = V1S().concat(V2S(), UNKNOWN());
  sides.forEach((l, i) => sides.forEach((r, j) => {
    const x = STEP1.reconcile({ local: freeze(l), remote: freeze(r), hist: freeze(dayHist(S1, 3)), now: now(S1) });
    const s = J(x.pet);
    const writes = x.changed || x.remoteBehind;
    if (writes && (x.readOnly || x.pet.v !== 1 || NEW_FIELDS.some(f => s.includes('"' + f + '"')))) bad.push(i + ',' + j);
    if ((l && l.v === 2 || r && r.v === 2) && (writes || !x.readOnly)) bad.push('v2 ' + i + ',' + j);
  }));
  return { ok: !bad.length, detail: bad.slice(0, 5).join(' | ') || 'ok' };
};
T['第 1 步:isNext 只認得剛好是 v2 的紀錄;v3、1.5、1e9 這些不認得的版本、v1 與壞掉的都不算(規格 5.3:不認得的版本跟現在一樣)'] = () => {
  const yes = [{ v: 2 }, v2Rec()].map(x => P.isNext(freeze(x)));
  const no = [null, undefined, {}, { v: 1 }, { v: 3 }, { v: 1.5 }, { v: 1e9 }, { v: Infinity }, { v: '2' }, { v: NaN }, [2], '亂碼', 2].map(x => P.isNext(x));
  return { ok: yes.every(x => x === true) && no.every(x => x === false) && !('isNewer' in P), detail: J(yes) + ' / ' + J(no) + ' / isNewer 還在=' + ('isNewer' in P) };
};

/* ---------- 第二階段第 2 步:新版 pet.js(v2 照常讀寫;v1 跟 f18d208 逐位元組相同) ---------- */
const OLDF = p => { const o = Object.assign({}, p, { v: 1 }); NEW_FIELDS.forEach(k => { delete o[k]; }); return o; };
const NEWF = p => J(NEW_FIELDS.map(f => (p && p[f] !== undefined ? p[f] : null)));
/* 固定種子的亂數(測試自己用;pet.js 不准用亂數) */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const SN = ['corn', 'greens', 'pea', 'berry', 'tomato', 'melon', 'yam', 'worm'];
const SRC_IDS = ['d', 'g:ga-01', 'pn:a1', 'iv', 'fall', 'pairs', 'r:art-03', 'tq:art-03', 'p5', 'mock', 'wr:w1-lesson-1', 'm', 'y', 'w:s3'];
/* 沒拿到的券(上限內)、吃掉的紀錄;stock 用:沒被任何一筆吃掉的券,逐種數 */
function truthLeft(tickets, eaten) { const n = {}; tickets.forEach(([t, f]) => { if (!eaten.has(t)) n[f] = (n[f] || 0) + 1; }); return n; }
/* tag 不是空的:id 用 r:<tag><n>,每天最多 1 張(跟別台不撞 id);沒有 tag:每天最多 2 張。兩台加共同的底,一天最多 4 張,不會碰到整理的上限 */
function eventsFor(r, dates, nGot, nAte, tickets, tag) {
  const got = {}, ate = {};
  for (let i = 0; i < nGot; i++) {
    const d = pick(r, dates); const id = tag ? 'r:' + tag + i : pick(r, SRC_IDS);
    got[d] = got[d] || {};
    if (Object.keys(got[d]).length < (tag ? 1 : 2)) got[d][id] = pick(r, SN);
  }
  Object.keys(got).forEach(d => Object.keys(got[d]).forEach(id => tickets.push([d + '/' + id, got[d][id]])));
  for (let i = 0; i < nAte && tickets.length; i++) { const d = pick(r, dates); ate[d] = ate[d] || {}; if (Object.keys(ate[d]).length < 2) ate[d]['e' + Math.floor(r() * 1e6).toString(36)] = pick(r, tickets)[0]; }
  return { got, ate };
}
const unionOf = (a, b) => { const o = JSON.parse(J(a)); Object.keys(b).forEach(d => { o[d] = Object.assign({}, o[d] || {}, b[d]); }); return o; };
const stockP = (p, t) => P.pantry(freeze(p), t).stock;

T['新版:v1 經過 sanitize、merge、reconcile 後 canon 不變,changed、remoteBehind 都 false,結果還是 v1'] = () => {
  const bad = [];
  let pet = null;
  range('2026-10-01', 40).forEach((d, i) => {
    const r = P.reconcile({ local: pet && freeze(pet), remote: pet && freeze(pet), hist: freeze(dayHist(d, 5 + (i % 5) * 6)), now: now(d) });
    pet = i % 4 === 0 ? P.feed(freeze(r.pet), now(d)) : r.pet;
    const again = P.reconcile({ local: freeze(pet), remote: freeze(pet), hist: freeze(dayHist(d, 5 + (i % 5) * 6)), now: now(d) + 1000 });
    const c = P.canon(pet);
    if (again.changed || again.remoteBehind || P.canon(again.pet) !== c || P.canon(P.merge(freeze(pet), freeze(pet), now(d))) !== c || P.canon(P.sanitize(freeze(pet), now(d)).pet) !== c || pet.v !== 1) bad.push(d);
  });
  return { ok: !bad.length, detail: bad.join('、') || '40 天都穩定' };
};
T['新版:所有既有函式吃 v1 只吐 v1、沒有新欄位(開關以外沒有任何路徑產生 v2)'] = () => {
  const bad = [];
  const v1s = V1S();
  const chk = (tag, p) => { if (!p || p.v !== 1 || NEW_FIELDS.some(f => f in p)) bad.push(tag); };
  v1s.forEach((a, i) => {
    chk('sanitize#' + i, P.sanitize(freeze(a), now(S1)).pet);
    chk('feed#' + i, P.feed(freeze(a), now(S1))); chk('setGoal#' + i, P.setGoal(freeze(a), 10, now(S1))); chk('rename#' + i, P.rename(freeze(a), '啾', now(S1)));
    v1s.forEach((b, j) => {
      chk('merge#' + i + ',' + j, P.merge(freeze(a), freeze(b), now(S1)));
      chk('reconcile#' + i + ',' + j, P.reconcile({ local: freeze(a), remote: freeze(b), hist: freeze(dayHist(S1, 4)), now: now(S1) }).pet);
      const m = P.cloudMerge(freeze(a), freeze(b), now(S1)); chk('cloudMerge#' + i + ',' + j, m.ok && m.v);
    });
  });
  return { ok: !bad.length, detail: bad.slice(0, 5).join(' | ') || 'ok' };
};
T['新版:status 回傳的鍵跟 f18d208 一樣,不加鍵(v1、v2 都是);v2 的數字跟只留認得欄位的一樣'] = () => {
  const bad = [];
  V1S().concat(V2S()).forEach((x, i) => {
    const a = P.status(freeze(x), now(S1)), b = BASE.status(freeze(x && x.v === 2 ? strip(x) : x), now(S1));
    if (J(Object.keys(a)) !== J(Object.keys(b)) || J(a) !== J(b)) bad.push('#' + i);
  });
  return { ok: !bad.length, detail: bad.join('、') || 'ok' };
};
T['新版:v2 不唯讀;sanitize 保留新欄位,再整理一次、跟自己 reconcile 都不變'] = () => {
  const bad = [];
  V2S().forEach((x, i) => {
    const s = P.sanitize(freeze(x), now(S1));
    const again = P.sanitize(freeze(s.pet), now(S1));
    /* 第一次 reconcile 可能補上 born(跟 v1 一樣);之後就穩定 */
    const r0 = P.reconcile({ local: freeze(s.pet), remote: freeze(s.pet), hist: [], now: now(S1) });
    const r = P.reconcile({ local: freeze(r0.pet), remote: freeze(r0.pet), hist: [], now: now(S1) });
    if (s.readOnly || s.pet.v !== 2 || P.canon(again.pet) !== P.canon(s.pet) || r0.readOnly || NEWF(r0.pet) !== NEWF(s.pet) || r0.pet.v !== 2 || (s.pet.born && r0.changed)
        || r.changed || r.remoteBehind || P.canon(r.pet) !== P.canon(r0.pet)) bad.push('#' + i + ' ' + J([s.readOnly, s.pet.v, r0.changed, r.changed]));
  });
  const s0 = P.sanitize(freeze(v2Rec()), now(S1)).pet;
  const want = { got: v2Rec().got, ate: v2Rec().ate, foodOld: v2Rec().foodOld, once: v2Rec().once, roam: v2Rec().roam };
  return { ok: !bad.length && NEWF(s0) === NEWF(want), detail: (bad.join(' | ') || 'ok') + ' / ' + NEWF(s0) };
};
T['新版:v1 跟 v2 合併,舊欄位跟只合併舊欄位時相同,新欄位完整保留(兩個方向)'] = () => {
  const bad = [];
  V1S().filter(Boolean).forEach((a, i) => V2S().forEach((b, j) => {
    const m1 = P.merge(freeze(a), freeze(b), now(S1)), m2 = P.merge(freeze(b), freeze(a), now(S1));
    const ref = BASE.merge(freeze(a), freeze(strip(b)), now(S1));
    const nf = NEWF(P.sanitize(freeze(b), now(S1)).pet);
    if (J(OLDF(m1)) !== J(ref) || NEWF(m1) !== nf || P.canon(m1) !== P.canon(m2) || m1.v !== 2) bad.push(i + ',' + j);
  }));
  return { ok: !bad.length, detail: bad.slice(0, 5).join(' | ') || 'ok' };
};
T['新版:隨機 v2 配對 400 組:交換順序相同、合併兩次不變、只增不減(看得到又沒被任何一台吃掉的券都還在)'] = () => {
  const bad = [];
  const r = rng(20261017);
  const today = '2026-11-20', t = now(today);
  const dates = range('2026-09-01', 81);   // 7/24 以後:不會壓縮
  for (let k = 0; k < 400; k++) {
    const tickets = [];
    const base = eventsFor(r, dates, 4, 2, tickets);
    const ea = eventsFor(r, dates, 3, 2, tickets, 'a'), eb = eventsFor(r, dates, 3, 2, tickets, 'b');
    const once = { a: { diag: pick(r, dates) }, b: r() < 0.5 ? { diag: pick(r, dates), 'w:s2': pick(r, dates) } : {} };
    const roam = [r() < 0.5 ? { on: r() < 0.5, at: Math.floor(r() * 3) } : undefined, r() < 0.5 ? { on: r() < 0.5, at: Math.floor(r() * 3) } : undefined];
    const fo = r() < 0.5 ? { before: '2026-08-01', left: { corn: Math.floor(r() * 3), yam: 1 } } : undefined;
    const mk = (e, o, ro, f2) => { const x = { v: 2, born: '2026-09-01', got: unionOf(base.got, e.got), ate: unionOf(base.ate, e.ate), once: o }; if (ro) x.roam = ro; if (f2) x.foodOld = f2; return x; };
    const a = mk(ea, once.a, roam[0], fo), b = mk(eb, once.b, roam[1], fo && r() < 0.5 ? { before: fo.before, left: { corn: 3 } } : fo);
    const ab = P.merge(freeze(a), freeze(b), t), ba = P.merge(freeze(b), freeze(a), t);
    const abb = P.merge(freeze(ab), freeze(b), t), abab = P.merge(freeze(ab), freeze(ab), t);
    if (P.canon(ab) !== P.canon(ba) || P.canon(abb) !== P.canon(ab) || P.canon(abab) !== P.canon(ab)) { bad.push('順序或兩次 #' + k); continue; }
    const eaten = new Set([].concat(...[a.ate, b.ate].map(x => Object.values(x).flatMap(Object.values))));
    const want = truthLeft(tickets, eaten);
    const st = stockP(ab, t);
    SN.forEach(f => { if ((st[f] || 0) < (want[f] || 0)) bad.push('少了 #' + k + ' ' + f); });
    Object.keys(a.got).concat(Object.keys(b.got)).forEach(d => Object.keys(Object.assign({}, a.got[d], b.got[d])).forEach(id => { if (!(ab.got[d] && ab.got[d][id])) bad.push('券不見 #' + k); }));
    Object.keys(once.a).concat(Object.keys(once.b)).forEach(id => { if (!ab.once[id]) bad.push('once 不見 #' + k); });
  }
  return { ok: !bad.length, detail: bad.slice(0, 5).join(' | ') || '400 組都對' };
};
T['新版:壓縮時兩台各自整理、再合併:只增不減,看得到又沒被吃掉的都還在(隨機 200 組)'] = () => {
  const bad = [];
  const r = rng(7);
  const today = '2026-11-20', t = now(today);
  const old = range('2026-06-01', 53), recent = range('2026-07-24', 120);   // 6/1-7/23 會被壓縮(截止 7/24)
  for (let k = 0; k < 200; k++) {
    const tickets = [];
    const b1 = eventsFor(r, old, 4, 2, tickets), b2 = eventsFor(r, recent, 3, 1, tickets);
    const base = { got: unionOf(b1.got, b2.got), ate: unionOf(b1.ate, b2.ate) };
    const ea = eventsFor(r, recent, 3, 3, tickets, 'a'), eb = eventsFor(r, recent, 3, 3, tickets, 'b');
    const a = { v: 2, got: unionOf(base.got, ea.got), ate: unionOf(base.ate, ea.ate) }, b = { v: 2, got: unionOf(base.got, eb.got), ate: unionOf(base.ate, eb.ate) };
    const sa = P.sanitize(freeze(a), t).pet, sb = P.sanitize(freeze(b), t).pet;
    const m = P.merge(freeze(sa), freeze(sb), t), raw = P.merge(freeze(a), freeze(b), t);
    const eaten = new Set([].concat(...[a.ate, b.ate].map(x => Object.values(x).flatMap(Object.values))));
    const want = truthLeft(tickets, eaten);
    const st = stockP(m, t), st2 = stockP(raw, t);
    SN.forEach(f => { if ((st[f] || 0) < (want[f] || 0) || (st2[f] || 0) < (want[f] || 0)) bad.push('#' + k + ' ' + f + ' ' + (st[f] || 0) + '/' + (st2[f] || 0) + '<' + want[f]); });
    if (!m.foodOld || m.foodOld.before !== '2026-07-24' || Object.keys(m.got).some(d => d < '2026-07-24')) bad.push('沒壓縮 #' + k);
  }
  return { ok: !bad.length, detail: bad.slice(0, 5).join(' | ') || '200 組都對' };
};
T['新版:拿到、A 吃、B 吃(同一張)、再拿到:剩 1;壓縮前後都剩 1'] = () => {
  const d1 = '2026-11-02', d2 = '2026-11-05';
  const g = { v: 2, born: '2026-11-01', days: { [d1]: 5 }, got: { [d1]: { d: 'corn' } } };
  const A = P.eat(freeze(g), 'corn', 'aaa', now(d1)), B = P.eat(freeze(g), 'corn', 'bbb', now(d1));
  const m = P.merge(freeze(A.pet), freeze(B.pet), now(d1));
  const m2 = Object.assign({}, m, { got: Object.assign({}, m.got, { [d2]: { 'g:ga-01': 'corn' } }) });
  const before = stockP(m2, now(d2)).corn;
  const later = '2027-04-01';   // d1、d2 都早於 120 天
  const c = P.sanitize(freeze(m2), now(later)).pet;
  const after = stockP(c, now(later)).corn;
  return { ok: A.ok && B.ok && A.ticket === B.ticket && stockP(m, now(d1)).corn === 0 && before === 1 && after === 1 && !!c.foodOld && !c.got && !c.ate,
           detail: J({ a: A.ticket, b: B.ticket, before, after, foodOld: c.foodOld }) };
};
T['新版:壓縮時吃光的食物在 foodOld.left 留 0,托盤那一格不會消失'] = () => {
  const d = '2026-07-01';
  const g = { v: 2, born: '2026-07-01', got: { [d]: { d: 'pea' }, '2026-07-02': { mock: 'melon' } }, ate: { [d]: { x1: d + '/d' } } };
  const later = '2026-12-01';
  const c = P.sanitize(freeze(g), now(later)).pet;
  const pan = P.pantry(freeze(c), now(later));
  return { ok: c.foodOld && c.foodOld.left.pea === 0 && c.foodOld.left.melon === 1 && !c.got && !c.ate && J(pan.order) === '["pea","melon"]' && pan.stock.pea === 0 && pan.stock.melon === 1,
           detail: J({ foodOld: c.foodOld, order: pan.order, stock: pan.stock }) };
};
/* 第三輪審查 #1:兩邊的 foodOld.before 不同時,不能整份丟掉 before 較早那邊的 left。
   雲端 3/10 壓縮了 10 張玉米(before 11/11);平板停在 11/6,手上 6 張。5/20 合併時雲端在截止日附近沒有券,before 還是 11/11,
   平板自己壓縮到 1/21。修之前取 before 較晚的那組:玉米剩 6,雲端被傳成 6,4 份永遠不見 */
const staleTablet = () => {
  const base = { v: 2, born: '2026-11-01', goals: [], days: {}, met: [], oldMet: 0, oldBefore: '', fed: {}, name: '', nameAt: 0 };
  const got = n => { const g = {}; for (let i = 0; i < n; i++) g[addDays('2026-11-01', i)] = { d: 'corn' }; return g; };
  const full = Object.assign({}, base, { got: got(10) });
  return { cloud: P.merge(freeze(full), freeze(full), now('2027-03-10')), tablet: Object.assign({}, base, { got: got(6) }), T: now('2027-05-20') };
};
T['新版:foodOld 的 before 不同(停用很久的平板):兩邊先壓縮到同一個截止日再逐種取大,兩個方向都不少'] = () => {
  const { cloud, tablet, T: t } = staleTablet();
  const want = Math.max(stockP(cloud, t).corn || 0, stockP(tablet, t).corn || 0);
  const runs = {
    'reconcile 本機=平板': P.reconcile({ local: freeze(tablet), remote: freeze(cloud), hist: [], now: t }).pet,
    'reconcile 本機=雲端': P.reconcile({ local: freeze(cloud), remote: freeze(tablet), hist: [], now: t }).pet,
    'merge 平板,雲端': P.merge(freeze(tablet), freeze(cloud), t),
    'merge 雲端,平板': P.merge(freeze(cloud), freeze(tablet), t),
    'cloudMerge 本機=平板': P.cloudMerge(freeze(tablet), freeze(cloud), t).v,
    'cloudMerge 本機=雲端': P.cloudMerge(freeze(cloud), freeze(tablet), t).v,
  };
  const bad = Object.keys(runs).filter(k => (stockP(runs[k], t).corn || 0) < want).map(k => k + ' 玉米 ' + stockP(runs[k], t).corn);
  const rTab = P.reconcile({ local: freeze(tablet), remote: freeze(cloud), hist: [], now: t });
  const sameBoth = P.canon(runs['merge 平板,雲端']) === P.canon(runs['merge 雲端,平板']);
  const again = P.merge(freeze(runs['merge 平板,雲端']), freeze(cloud), t);
  return { ok: cloud.foodOld.before === '2026-11-11' && want === 10 && !bad.length && sameBoth && P.canon(again) === P.canon(runs['merge 平板,雲端'])
             && !rTab.readOnly,
           detail: J({ want, bad, sameBoth, foodOld: runs['merge 平板,雲端'].foodOld, cloud: cloud.foodOld }) };
};
T['新版:foodOld 的 before 不同、兩邊都吃過舊券:重新壓縮時算進兩邊的吃掉紀錄,剩的不少於真正沒吃的'] = () => {
  const { cloud, tablet, T: t } = staleTablet();
  /* 雲端 2/1 吃了一張舊券;平板 11/2 吃了 11/2 那張(雲端不知道,只能退回來,寧可多給) */
  const c2 = Object.assign({}, cloud, { ate: { '2027-02-01': { e1: 'old:2026-11-11:corn:0' } } });
  const t2 = Object.assign({}, tablet, { days: { '2026-11-02': 3 }, ate: { '2026-11-02': { e2: '2026-11-02/d' } } });
  const truth = 10 - 1;   // 10 張,雲端吃掉 1 張(平板那一口在雲端壓縮時已經算成沒吃)
  const a = P.merge(freeze(t2), freeze(c2), t), b = P.merge(freeze(c2), freeze(t2), t);
  const sa = stockP(a, t).corn, sb = stockP(b, t).corn;
  return { ok: sa >= truth && sb >= truth && sa <= 10 && P.canon(a) === P.canon(b), detail: J({ sa, sb, foodOld: a.foodOld, ate: a.ate }) };
};
T['新版:foodOld 的 before 不同(隨機 300 組,沒有吃):合併後每種都不少於任何一邊自己算的,交換順序結果相同'] = () => {
  const r = rng(20261017), bad = [];
  const start = '2026-06-01';
  for (let k = 0; k < 300; k++) {
    const side = () => {
      const got = {};
      const days = Math.floor(r() * 260);
      for (let i = 0; i < days; i++) if (r() < 0.6) got[addDays(start, i)] = { [pick(r, ['d', 'p5', 'mock', 'm', 'iv'])]: pick(r, SN) };
      const seen = addDays(start, 120 + Math.floor(r() * 260));   // 這一邊最後一次打開(在那天壓縮)
      const rec = { v: 2, born: start, got };
      return r() < 0.8 ? P.sanitize(freeze(rec), now(seen)).pet : rec;
    };
    const A = side(), B = side();
    const t = now(addDays(start, 400 + Math.floor(r() * 60)));
    const sa = stockP(A, t), sb = stockP(B, t);
    const m1 = P.merge(freeze(A), freeze(B), t), m2 = P.merge(freeze(B), freeze(A), t);
    const st = stockP(m1, t);
    SN.forEach(f => { const w = Math.max(sa[f] || 0, sb[f] || 0); if ((st[f] || 0) < w) bad.push('#' + k + ' ' + f + ' ' + (st[f] || 0) + '<' + w); });
    if (P.canon(m1) !== P.canon(m2)) bad.push('#' + k + ' 順序不同結果不同');
  }
  return { ok: !bad.length, detail: bad.slice(0, 5).join(' | ') || '300 組都對' };
};
T['新版:不認得的食物代號保留但不顯示、不算;不認得的來源 id 配認得的食物照算(以後的版本加了新練習也看得懂)'] = () => {
  const d = S1;
  const g = { v: 2, born: '2026-11-01', days: { [d]: 3 }, got: { [d]: { d: 'pizza', 'zz:new-thing': 'corn' } } };
  const s = P.sanitize(freeze(g), now(d)).pet;
  const pan = P.pantry(freeze(s), now(d));
  return { ok: s.got[d].d === 'pizza' && s.got[d]['zz:new-thing'] === 'corn' && J(pan.order) === '["corn"]' && pan.stock.corn === 1 && !('pizza' in pan.stock),
           detail: J({ got: s.got, order: pan.order, stock: pan.stock }) };
};
T['新版:壞資料(got 是字串、ate 某天是陣列、foodOld.before 不是日期、once 壞掉、roam 壞掉)各自只丟掉壞的那一欄'] = () => {
  const base = v2Rec();
  const a = P.sanitize(freeze(Object.assign({}, base, { got: '壞掉' })), now(S1)).pet;
  const b = P.sanitize(freeze(Object.assign({}, base, { ate: { '2026-11-02': [1], '2026-11-03': { okid: '2026-11-02/d' } } })), now(S1)).pet;
  const c = P.sanitize(freeze(Object.assign({}, base, { foodOld: { before: 'x', left: { corn: 2 } } })), now(S1)).pet;
  const e = P.sanitize(freeze(Object.assign({}, base, { once: 'x', roam: { on: 'yes', at: 1 } })), now(S1)).pet;
  const f = P.sanitize(freeze(Object.assign({}, base, { got: { '2026-11-02': { d: 'corn', 'BAD ID': 'corn', x: 7, y: 'Corn' }, 'not-a-date': { d: 'corn' }, '2099-01-01': { d: 'corn' } } })), now(S1)).pet;
  const ok = !a.got && J(a.ate) === J(base.ate) && J(a.foodOld) === J(base.foodOld)
    && J(b.ate) === J({ '2026-11-03': { okid: '2026-11-02/d' } }) && J(b.got) === J(base.got)
    && !c.foodOld && J(c.got) === J(base.got) && J(c.ate) === J(base.ate)
    && !e.once && !e.roam && J(e.got) === J(base.got)
    && J(f.got) === J({ '2026-11-02': { d: 'corn' } }) && a.name === '小黃' && a.days['2026-11-01'] === 25;
  return { ok, detail: J({ a: NEWF(a), b: b.ate, c: c.foodOld, e: [e.once, e.roam], f: f.got }) };
};
T['新版:大小:每天塞 50 張券、50 筆吃掉,整理後每天只剩 4 張、4 筆;400 天的舊欄位加 120 天的食物小於 100 KB'] = () => {
  const today = '2026-11-20';
  const days = {}, met = [];
  range(addDays(today, -399), 400).forEach(d => { days[d] = 9999; met.push(d); });
  const got = {}, ate = {};
  range(addDays(today, -119), 120).forEach(d => {
    got[d] = {}; ate[d] = {};
    for (let i = 0; i < 50; i++) { got[d]['tq:article-' + String(i).padStart(9, '0')] = 'tomato'; ate[d]['eat' + String(i).padStart(21, '0')] = d + '/tq:article-' + String(i).padStart(9, '0'); }
  });
  const raw = { v: 2, born: '2025-01-01', days, met, oldMet: 99, oldBefore: addDays(today, -399), fed: { [today]: 5 }, name: '一二三四五六七八九十', nameAt: 1,
    got, ate, foodOld: { before: addDays(today, -119), left: { corn: 9, greens: 9, pea: 9, berry: 9, tomato: 9, melon: 9, yam: 9, worm: 9 } },
    once: { diag: today, fav: today, 'w:s1': today, 'w:s2': today, 'w:s3': today, 'w:s4': today, 'w:s5': today, 'w:s6': today, 'w:a1': today, 'w:a2': today }, roam: { on: false, at: 1793000000000 } };
  const p = P.sanitize(freeze(raw), now(today)).pet;
  const size = J(p).length;
  const perDay = Object.values(p.got).every(x => Object.keys(x).length === 4) && Object.values(p.ate).every(x => Object.keys(x).length === 4);
  return { ok: perDay && size < 100000 && Object.keys(p.got).length === 120, detail: '整理後 ' + size + ' bytes,每天 4 張 4 筆 ' + perDay };
};
T['新版:roam 後改的贏;同時改的 on:false 贏(休息優先);合併順序無關'] = () => {
  const a = { v: 2, roam: { on: true, at: 5 } }, b = { v: 2, roam: { on: false, at: 3 } }, c = { v: 2, roam: { on: true, at: 3 } };
  const r1 = P.merge(freeze(a), freeze(b), now(S1)).roam, r2 = P.merge(freeze(b), freeze(a), now(S1)).roam;
  const r3 = P.merge(freeze(b), freeze(c), now(S1)).roam, r4 = P.merge(freeze(c), freeze(b), now(S1)).roam;
  return { ok: J(r1) === '{"on":true,"at":5}' && J(r2) === J(r1) && J(r3) === '{"on":false,"at":3}' && J(r4) === J(r3), detail: J([r1, r2, r3, r4]) };
};
T['新版:setRoam 寫 roam、變 v2;roamOn 沒有欄位或不是 false 都是 true;不認得的版本丟錯'] = () => {
  const v1 = P.reconcile({ local: null, remote: null, hist: [], now: now(S1) }).pet;
  const off = P.setRoam(freeze(v1), false, now(S1)), on = P.setRoam(freeze(off), 1, now(S1) + 5);
  let threw = false; try { P.setRoam(freeze({ v: 3 }), false, now(S1)); } catch (e) { threw = true; }
  const ok = off.v === 2 && J(off.roam) === J({ on: false, at: now(S1) }) && J(OLDF(off)) === J(v1) && P.roamOn(off) === false && on.roam.on === true && P.roamOn(on)
    && P.roamOn(v1) && P.roamOn(null) && P.roamOn({ v: 2, roam: { on: 'no' } }) && P.roamOn({ v: 1, roam: { on: false } }) && threw;
  return { ok, detail: J([off.roam, on.roam, threw]) };
};
T['新版:最愛由 born 決定,一定是玉米、青江菜、地瓜其中一種,每台算出來一樣;born 空的是玉米'] = () => {
  const seen = new Set();
  const all = range('2025-01-01', 400).every(d => { const f = P.favOf(d); seen.add(f); return P.FAVS.includes(f) && P.favOf(d) === f; });
  return { ok: all && seen.size === 3 && P.favOf('') === 'corn' && J(P.FAVS) === '["corn","greens","yam"]', detail: J([...seen]) };
};
T['新版:食物清單、托盤順序、名字、上限'] = () => {
  const ids = P.FOODS.map(f => f.id).join(',');
  return { ok: ids === 'grain,corn,greens,pea,berry,tomato,melon,yam,worm' && J(P.SNACKS) === J(SN) && P.MAX_STOCK === 9 && P.KEEP_FOOD === 120
             && P.foodName('corn') === '玉米' && P.foodName('worm') === '麵包蟲' && P.foodName('grain') === '飼料' && P.foodName('pizza') === '' && P.FOODS[0].unit === '顆' && P.FOODS[1].unit === '份',
           detail: ids };
};
T['新版:pantry 只看拿到過的、份數扣掉吃掉的、今天的狀態'] = () => {
  const d = S1, y = addDays(S1, -1);
  const p = { v: 2, born: '2026-11-01', days: { [d]: 0, [y]: 5 }, got: { '2026-11-02': { d: 'corn' }, '2026-11-03': { 'g:ga-01': 'pea' }, [y]: { mock: 'melon' }, [d]: { 'w:s1': 'worm' }, '2026-11-12': { d: 'yam' } },
    ate: { [y]: { e1: '2026-11-02/d' } }, foodOld: { before: '2026-10-01', left: { berry: 2 } }, once: {} };
  const pan = P.pantry(freeze(p), now(d));
  const want = { stock: { corn: 0, pea: 1, berry: 2, melon: 1, worm: 1 }, order: ['corn', 'pea', 'berry', 'melon', 'worm'], practiced: true, ateToday: false, ateFood: null,
    gotToday: { id: 'w:s1', food: 'worm' }, canSnack: true, fav: P.favOf('2026-11-01'), favKnown: false };
  const p2 = Object.assign({}, p, { got: { '2026-11-02': { d: 'corn' } }, ate: { [d]: { e9: 'old:2026-10-01:berry:0' } }, once: { fav: '2026-11-05' } });
  const pan2 = P.pantry(freeze(p2), now(d));
  const pan3 = P.pantry(freeze({ v: 1, born: '2026-11-01' }), now(d));
  return { ok: J(pan) === J(want) && pan2.ateToday && pan2.ateFood === 'berry' && pan2.stock.berry === 1 && pan2.canSnack === false && pan2.practiced === false && pan2.favKnown === true
             && J(pan3.order) === '[]' && pan3.practiced === false && pan3.gotToday === null,
           detail: J(pan) + ' / ' + J(pan2) };
};
T['新版:eat 五種拒絕各一次(pet 不變、不回 pet);吃最舊的券(先舊券,再依日期、id);吃到最愛記 once.fav'] = () => {
  const d = S1;
  const fav = P.favOf('2026-11-01');
  const p = { v: 2, born: '2026-11-01', days: { [d]: 4, [addDays(d, 1)]: 4, [addDays(d, 2)]: 4, [addDays(d, 3)]: 4 }, got: { '2026-11-03': { 'g:z': fav, 'g:a': fav }, '2026-11-02': { d: fav }, [d]: { mock: 'melon' } }, foodOld: { before: '2026-10-01', left: { [fav]: 1 } } };
  const rej = [
    ['readOnly', P.eat(freeze({ v: 3 }), fav, 'a1', now(d))],
    ['badFood', P.eat(freeze(p), 'grain', 'a1', now(d))],
    ['badFood', P.eat(freeze(p), 'pizza', 'a1', now(d))],
    ['notToday', P.eat(freeze(Object.assign({}, p, { days: {}, got: { '2026-11-02': { d: fav } } })), fav, 'a1', now(d))],
    ['none', P.eat(freeze(p), 'berry', 'a1', now(d))],
  ];
  const e1 = P.eat(freeze(p), fav, 'a1', now(d));
  rej.push(['ateToday', P.eat(freeze(e1.pet), fav, 'a2', now(d))]);
  const bad = rej.filter(([want, r]) => !(r.ok === false && r.reason === want && !('pet' in r))).map(x => x[0]);
  const seq = [e1.ticket];
  let q = e1.pet;
  for (let i = 1; i < 4; i++) { const r = P.eat(freeze(q), fav, 'b' + i, now(addDays(d, i))); seq.push(r.ticket); q = r.pet; }
  const want = ['old:2026-10-01:' + fav + ':0', '2026-11-02/d', '2026-11-03/g:a', '2026-11-03/g:z'];
  const onlyDate = P.eat(freeze({ v: 2, born: '2026-11-01', got: { [d]: { 'wr:w1-lesson-1': 'greens' } } }), 'greens', 'c1', now(d));
  return { ok: !bad.length && J(seq) === J(want) && e1.left === 3 && e1.pet.once.fav === d && e1.pet.ate[d].a1 === want[0] && e1.pet.v === 2 && onlyDate.ok,
           detail: '拒絕不對 ' + J(bad) + ' / 順序 ' + J(seq) + ' / left ' + e1.left + ' / fav ' + J(e1.pet.once) + ' / 只有作業 ' + onlyDate.ok };
};
T['新版:cloudMerge:v1 加 v1 等於 merge;v2 聯集;v3 回 ok:false;sameAsLocal、sameAsCloud'] = () => {
  const a = strip(v2Rec()), b = strip(v2Rec({ name: '阿啾', nameAt: 9, days: { '2026-11-09': 3 } }));
  const m = P.cloudMerge(freeze(a), freeze(b), now(S1));
  const v2a = v2Rec(), v2b = v2Rec({ got: { [S1]: { 'r:art-03': 'tomato' } }, ate: {} });
  const m2 = P.cloudMerge(freeze(v2a), freeze(v2b), now(S1));
  const bad3 = [P.cloudMerge(freeze({ v: 3 }), freeze(a), now(S1)), P.cloudMerge(freeze(a), freeze({ v: 3 }), now(S1)), P.cloudMerge(freeze(a), '亂碼', now(S1))];
  const s = P.sanitize(freeze(v2a), now(S1)).pet;
  const same = P.cloudMerge(freeze(s), freeze(s), now(S1));
  const onlyCloud = P.cloudMerge(freeze(strip(s)), freeze(s), now(S1));
  const nul = P.cloudMerge(null, freeze(s), now(S1));
  const ok = m.ok && P.canon(m.v) === P.canon(P.merge(freeze(a), freeze(b), now(S1))) && m.v.v === 1
    && m2.ok && m2.v.got[S1]['r:art-03'] === 'tomato' && m2.v.got['2026-11-02'].d === 'corn' && m2.v.ate['2026-11-02'].mh2lq01xk7
    && bad3.every(x => x.ok === false && !('v' in x)) && same.sameAsLocal && same.sameAsCloud && !onlyCloud.sameAsLocal && onlyCloud.sameAsCloud && nul.ok && nul.sameAsCloud && !nul.sameAsLocal;
  return { ok, detail: J([m.ok, m2.ok, bad3.map(x => x.ok), same.sameAsLocal, same.sameAsCloud, onlyCloud.sameAsLocal, onlyCloud.sameAsCloud]) };
};
T['新版:v2 樣本檔(tools/fixtures/pet_v2_samples.json)每一份都整理得乾淨、穩定、不唯讀'] = () => {
  const samples = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pet_v2_samples.json'), 'utf8'));
  const t = Date.parse(samples.now);
  const bad = [];
  samples.records.forEach(x => {
    const s = P.sanitize(freeze(x.pet), t);
    if (s.readOnly || P.canon(s.pet) !== P.canon(x.pet) || P.canon(P.sanitize(freeze(s.pet), t).pet) !== P.canon(s.pet)) bad.push(x.name);
    if (x.pantry && J(P.pantry(freeze(x.pet), t)) !== J(x.pantry)) bad.push(x.name + ' pantry');
  });
  return { ok: !bad.length && samples.records.length >= 5, detail: bad.join('、') || samples.records.length + ' 份' };
};

/* ---------- 純函式 ---------- */
T['不碰 store、document、localStorage,也不改輸入'] = () => {
  /* 沙盒裡沒有這些東西,碰到會丟 ReferenceError;輸入都凍結過,改到會丟 TypeError(pet.js 開 strict mode) */
  const strict = /['"]use strict['"]/.test(SRC);
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const touches = /\b(store|localStorage|sessionStorage|document|window|CLOUD)\s*[.[]/.test(code);
  const random = /Math\s*\.\s*random/.test(code);
  return { ok: strict && !touches && !random, detail: 'strict=' + strict + ' 程式碼裡提到外部儲存=' + touches + ' 用亂數=' + random };
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
