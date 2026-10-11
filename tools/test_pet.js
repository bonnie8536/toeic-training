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
function load() {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.PET;
}
const P = load();

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
T['pet 是字串、陣列、數字、v=2:唯讀,不寫回'] = () => {
  const r = ['亂碼', [1, 2], 42, { v: 2, days: { '2026-10-07': 5 } }, true].map(x =>
    P.reconcile({ local: freeze(x), remote: null, hist: freeze(dayHist('2026-10-07', 20)), now: now('2026-10-07') }));
  return { ok: r.every(x => x.readOnly && !x.changed), detail: JSON.stringify(r.map(x => [x.readOnly, x.changed])) };
};
T['雲端那份是 v=2(別台裝了新版):本機也不寫回,免得蓋掉新格式'] = () => {
  const r = P.reconcile({ local: null, remote: freeze({ v: 2, days: {} }), hist: freeze(dayHist('2026-10-07', 20)), now: now('2026-10-07') });
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

/* ---------- 純函式 ---------- */
T['不碰 store、document、localStorage,也不改輸入'] = () => {
  /* 沙盒裡沒有這些東西,碰到會丟 ReferenceError;輸入都凍結過,改到會丟 TypeError(pet.js 開 strict mode) */
  const strict = /['"]use strict['"]/.test(SRC);
  const touches = /\b(store|localStorage|sessionStorage|document|window|CLOUD)\s*[.[]/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''));
  return { ok: strict && !touches, detail: 'strict=' + strict + ' 程式碼裡提到外部儲存=' + touches };
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
