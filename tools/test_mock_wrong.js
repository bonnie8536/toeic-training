/* 模擬考錯題收進錯題本(mock_wrong)與錯題本分組(定稿設計 2026-11-18,第 4.1 節 M1–M13;審查 2026-11-19 加 M14 答案不截斷、M15 SINCE 不早於上線、M16 開頁跟雲端對齊)。
   node + vm:載真題庫 data/*.js、js/sync-merge.js、js/move-rules.js、js/move-merge.js、js/wrongbook.js;
   store 用假的(記每個鍵 get、set 幾次);passTypeLabel 從 js/common.js 抄出來跑。
   用法:node tools/test_mock_wrong.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8').replace(/\r\n/g, '\n');
const has = (f) => fs.existsSync(path.join(REPO, f));
const J = (x) => JSON.stringify(x);

/* ---------- 假的 store:記 get、set 幾次 ---------- */
function makeStore(init) {
  const m = new Map(Object.entries(init || {}).map(([k, v]) => [k, J(v)]));
  const n = { get: {}, set: {} };
  return {
    get(k, fb) { n.get[k] = (n.get[k] || 0) + 1; return m.has(k) ? JSON.parse(m.get(k)) : fb; },
    set(k, v) { n.set[k] = (n.set[k] || 0) + 1; m.set(k, J(v)); },
    peek: (k) => (m.has(k) ? JSON.parse(m.get(k)) : undefined),
    raw: (k) => m.get(k),
    n,
    reset() { n.get = {}; n.set = {}; },
  };
}

/* 一個新的沙盒:真題庫 + 合併規則 + 錯題本 */
function sandbox(init) {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['data/part5.js', 'data/part6.js', 'data/part7.js', 'data/listening.js'].forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  const common = read('js/common.js');
  const ptl = /function passTypeLabel\(t\) \{[\s\S]*?\n\}/.exec(common);
  vm.runInContext(ptl[0], ctx);
  ctx.LETTERS = ['A', 'B', 'C', 'D'];
  ctx.store = makeStore(init);
  vm.runInContext(read('js/sync-merge.js'), ctx, { filename: 'js/sync-merge.js' });
  vm.runInContext(read('js/move-rules.js'), ctx, { filename: 'js/move-rules.js' });
  vm.runInContext(read('js/move-merge.js'), ctx, { filename: 'js/move-merge.js' });
  if (has('js/wrongbook.js')) vm.runInContext(read('js/wrongbook.js'), ctx, { filename: 'js/wrongbook.js' });
  return ctx;
}
const BASE = sandbox();
const SM = BASE.SYNC_MERGE;
const TOEIC = BASE.TOEIC, L = TOEIC.listening;
const need = (x, what) => { if (!x) throw new Error('還沒有 ' + what); return x; };
const MW = (a, b) => need(SM && SM.mockWrong, 'SYNC_MERGE.mockWrong')(a, b);
const canon = (x) => SM.canon(x);

/* 固定種子的亂數 */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const T = {};

/* ================= M1–M5:SYNC_MERGE.mockWrong ================= */
T['M1 SYNC_MERGE.mockWrong 存在;陣列、字串、數字回 ok:false;null、undefined 當空的'] = () => {
  need(SM.mockWrong, 'SYNC_MERGE.mockWrong');
  const bad = [[[], {}], [{}, []], ['x', null], [5, {}], [{}, 'y'], [true, null]].map(([a, b]) => MW(a, b).ok);
  const e1 = MW(null, undefined), e2 = MW(undefined, { k: { c: 0, ok: false, t: 1 } });
  const ok = bad.every((x) => x === false) && e1.ok === true && J(e1.v) === '{}' && e2.ok === true && J(e2.v) === J({ k: { c: 0, ok: false, t: 1 } });
  return { ok, detail: J({ bad, e1, e2 }) };
};
T['M2 一邊有一邊沒有都留;同一題留 t 大的;形狀對的贏形狀不對的;t 一樣時兩個順序結果一樣;輸出 key 照字典序'] = () => {
  const a = { 'p5-b': { c: 0, ok: false, t: 5 }, 'p5-a': { c: 1, ok: false, t: 9 }, 'l2-1': 'junk', 'p6-x:1': { c: 2, ok: false, t: 3 } };
  const b = { 'p5-c': { c: 2, ok: false, t: 6 }, 'p5-a': { c: 3, ok: true, t: 12 }, 'l2-1': { c: 0, ok: false, t: 1 }, 'p6-x:1': { c: 1, ok: false, t: 3 } };
  const m = MW(a, b), n = MW(b, a);
  const v = m.v;
  const ok = m.ok && J(Object.keys(v)) === J(Object.keys(v).slice().sort()) && v['p5-b'].t === 5 && v['p5-c'].t === 6 && v['p5-a'].t === 12
    && v['l2-1'].t === 1 && J(m.v) === J(n.v) && v['p6-x:1'].c === 1 && !m.sameAsLocal && !m.sameAsCloud;
  return { ok, detail: J(v) };
};
T['M3 隨機 300 組三份(1500 筆內):可交換、可結合、merge(x,x)=x、merge(merge(a,b),a)=merge(a,b)'] = () => {
  need(SM.mockWrong, 'SYNC_MERGE.mockWrong');
  const rnd = rng(20261118);
  const keys = Array.from({ length: 24 }, (x, i) => 'p5-k' + i);
  const one = () => {
    const o = {};
    keys.forEach((k) => {
      const r = rnd();
      if (r < 0.45) return;
      if (r < 0.5) { o[k] = rnd() < 0.5 ? 'bad' : { c: 1, ok: false }; return; }
      o[k] = { c: Math.floor(rnd() * 4), ok: rnd() < 0.3, t: 1000 + Math.floor(rnd() * 6) };
    });
    return o;
  };
  const v = (a, b) => MW(a, b).v;
  let bad = '';
  for (let i = 0; i < 300 && !bad; i++) {
    const a = one(), b = one(), c = one();
    if (canon(v(a, b)) !== canon(v(b, a))) bad = '交換 ' + i;
    else if (canon(v(v(a, b), c)) !== canon(v(a, v(b, c)))) bad = '結合 ' + i;
    else if (canon(v(a, a)) !== canon(a)) bad = '自己 ' + i;
    else if (canon(v(v(a, b), a)) !== canon(v(a, b))) bad = '吸收 ' + i;
    else if (J(v(a, b)) !== J(v(b, a))) bad = '字串不一樣 ' + i;
  }
  return { ok: !bad, detail: bad || '300 組都成立' };
};
T['M4 上限 1500:1500 筆不丟;1501 筆丟最舊的 ok:true;全是 ok:false 時丟最舊的;跟參數順序無關'] = () => {
  const mk = (n, okN) => {
    const o = {};
    for (let i = 0; i < n; i++) o['p5-q' + String(i).padStart(5, '0')] = { c: 0, ok: i < okN, t: 10000 + i };
    return o;
  };
  const split = (o) => { const a = {}, b = {}; Object.keys(o).forEach((k, i) => { (i % 2 ? a : b)[k] = o[k]; }); return [a, b]; };
  const full = mk(1500, 300), [f1, f2] = split(full);
  const r1 = MW(f1, f2).v;
  const over = mk(1501, 400), [o1, o2] = split(over);   // ok:true 是 q00000~q00399,最舊的是 q00000
  const r2 = MW(o1, o2).v, r2b = MW(o2, o1).v;
  const allBad = mk(1501, 0), [b1, b2] = split(allBad);
  const r3 = MW(b1, b2).v;
  const ok = Object.keys(r1).length === 1500 && Object.keys(r2).length === 1500 && !r2['p5-q00000'] && !!r2['p5-q00001'] && J(r2) === J(r2b)
    && Object.keys(r3).length === 1500 && !r3['p5-q00000'] && !!r3['p5-q01500'];
  return { ok, detail: J({ n1: Object.keys(r1).length, n2: Object.keys(r2).length, dropped2: !r2['p5-q00000'], n3: Object.keys(r3).length }) };
};
T['M5 合併結果跟本機一樣時回傳進去的那個物件、sameAsLocal 是 true'] = () => {
  const a = { 'p5-b': { c: 0, ok: false, t: 5 }, 'p5-a': { c: 1, ok: false, t: 9 } };
  const m = MW(a, { 'p5-a': { c: 1, ok: false, t: 2 } });
  const e = MW(a, null);
  return { ok: m.v === a && m.sameAsLocal === true && e.v === a && e.sameAsLocal === true, detail: J({ same: m.v === a, sl: m.sameAsLocal }) };
};

/* ================= M6–M11、M13:js/wrongbook.js ================= */
const WB = (ctx) => need((ctx || BASE).WRONGBOOK, 'js/wrongbook.js(WRONGBOOK)');
T['M6 pick:刷題紀錄和 mock_wrong 誰算數(定稿 1.2 表格六種情況;形狀壞掉當成沒有)'] = () => {
  const P = WB().pick;
  const d = (ok, t) => ({ c: 0, ok, t }), m = (ok, t) => ({ c: 1, ok, t });
  const show = (x) => (x ? (x.r.ok ? 'ok' : 'wrong') + ':' + x.src : 'none');
  const got = [
    show(P(d(false, 5), undefined)),        // 在,刷題
    show(P(d(true, 5), undefined)),         // 不在
    show(P(undefined, m(false, 5))),        // 在,模擬考
    show(P(d(true, 3), m(false, 5))),       // 在,模擬考
    show(P(d(true, 9), m(false, 5))),       // 看 d:不在
    show(P(d(false, 9), m(true, 5))),       // 看 d:在,刷題
    show(P(d(false, 3), m(true, 5))),       // 已訂正:不在
    show(P(d(false, 5), m(true, 5))),       // 一樣大用 d
    show(P('junk', m(false, 5))),           // d 壞掉當沒有
    show(P(d(false, 5), { c: 1, ok: false })),   // m 沒有 t 當沒有
    show(P(d(false, 5), [1, 2])),
    show(P({ c: 0, ok: false }, m(true, 5))),    // 舊紀錄沒有 t:當成最舊
    show(P({ c: 0, ok: false }, undefined)),     // 舊紀錄沒有 t、沒有 mock_wrong:跟現在一樣在
  ];
  const want = ['wrong:drill', 'ok:drill', 'wrong:mock', 'wrong:mock', 'ok:drill', 'wrong:drill', 'ok:mock', 'wrong:drill', 'wrong:mock', 'wrong:drill', 'wrong:drill', 'ok:mock', 'wrong:drill'];
  return { ok: J(got) === J(want), detail: J(got) };
};

/* 各 Part 的題目 key(跟 js/practice.js、js/listening.js 的 qid 同一種算法) */
const K5 = (i) => TOEIC.part5[i].id;
const K6 = (si, qi) => TOEIC.part6[si].id + ':' + TOEIC.part6[si].questions[qi].num;
const K7 = (si, qi) => TOEIC.part7[si].id + ':' + qi;
const KL = (p, i) => L['p' + p][i].id;
const KS = (p, si, qi) => L['p' + p][si].id + ':' + qi;
const wrongC = (q) => (q.answer + 1) % q.options.length;

T['M7 fromAnswers(真題庫):key 跟刷題、聽力一樣;c 壞掉、超出範圍、key 不在題庫的丟掉;對錯用題庫算;答對只在「現在在錯題本、那筆比較舊」才寫已訂正;t 都是交卷時間'] = () => {
  const TT = 1763450000000;
  const ctx = sandbox({
    drill_p5: { [K5(1)]: { c: wrongC(TOEIC.part5[1]), ok: false, t: TT - 1000 }, [K5(2)]: { c: wrongC(TOEIC.part5[2]), ok: false, t: TT + 5000 } },
    listen_p2: { [KL(2, 1)]: { c: 0, ok: true, t: TT - 10 } },
  });
  const W = WB(ctx);
  const q5 = TOEIC.part5, q6 = TOEIC.part6[0].questions, q7 = TOEIC.part7[0].questions;
  const ans = [
    [K5(0), wrongC(q5[0])],          // 錯
    [K5(1), q5[1].answer],           // 對,原本在錯題本、比較舊 → 已訂正
    [K5(2), q5[2].answer],           // 對,原本在錯題本、但那筆比交卷新 → 不寫
    [K5(3), q5[3].answer],           // 對,不在錯題本 → 不寫
    [K6(0, 1), wrongC(q6[1])],
    [K7(0, 0), wrongC(q7[0])],
    [KL(1, 0), wrongC(L.p1[0])],
    [KL(2, 0), wrongC(L.p2[0])],
    [KL(2, 1), L.p2[1].answer],      // 對,原本答對 → 不寫
    [KS(3, 0, 1), wrongC(L.p3[0].questions[1])],
    [KS(4, 0, 2), wrongC(L.p4[0].questions[2])],
    [K5(4), 1.5], [K5(5), 9], [K5(6), -1], ['p5-nope', 0], [K5(7), '1'], [42, 0],
  ];
  const add = W.fromAnswers(ans, TT);
  const keys = Object.keys(add).sort();
  const want = [K5(0), K5(1), K6(0, 1), K7(0, 0), KL(1, 0), KL(2, 0), KS(3, 0, 1), KS(4, 0, 2)].sort();
  const allT = Object.values(add).every((r) => r.t === TT);
  const oks = keys.filter((k) => add[k].ok);
  const ok = J(keys) === J(want) && allT && J(oks) === J([K5(1)]) && add[K5(0)].c === wrongC(q5[0]) && add[K5(1)].c === q5[1].answer;
  return { ok, detail: J({ keys, oks, allT }) };
};

/* 一個學生的紀錄:每個 Part 都有錯題,有刷題的也有模擬考的 */
const NOW = Date.parse('2026-11-18T10:00:00+08:00');
function student() {
  const d5 = {}, d6 = {}, d7 = {}, l1 = {}, l2 = {}, l3 = {}, l4 = {}, mw = {};
  const P5 = TOEIC.part5;
  /* Part 5:前 40 題錯(刷題,時間依序),第 40 題答對;第 41 題只在模擬考錯 */
  for (let i = 0; i < 40; i++) d5[P5[i].id] = { c: wrongC(P5[i]), ok: false, t: NOW - 100000 + i * 100 };
  d5[P5[40].id] = { c: P5[40].answer, ok: true, t: NOW - 50 };
  mw[P5[41].id] = { c: wrongC(P5[41]), ok: false, t: NOW };
  /* Part 6:第 0 組一格文法錯、一格字彙錯(找得到的話);第 1 組一格錯 */
  const s0 = TOEIC.part6.find((s) => s.questions.some((q) => q.type === '文法') && s.questions.some((q) => q.type === '字彙'));
  const g = s0.questions.find((q) => q.type === '文法'), v = s0.questions.find((q) => q.type === '字彙');
  d6[s0.id + ':' + g.num] = { c: wrongC(g), ok: false, t: NOW - 3000 };
  d6[s0.id + ':' + v.num] = { c: wrongC(v), ok: false, t: NOW - 2000 };
  /* Part 7:text message、text_message、text message chain、webpage、web page、雙篇、三篇各錯一題 */
  const by = (fn) => TOEIC.part7.find(fn);
  const p7 = [by((s) => s.format === 'single' && s.passages[0].type === 'text message'), by((s) => s.format === 'single' && s.passages[0].type === 'text_message'),
    by((s) => s.format === 'single' && s.passages[0].type === 'text message chain'), by((s) => s.format === 'single' && s.passages[0].type === 'webpage'),
    by((s) => s.format === 'single' && s.passages[0].type === 'web page'), by((s) => s.format === 'double'), by((s) => s.format === 'triple')];
  p7.forEach((s, i) => { d7[s.id + ':0'] = { c: wrongC(s.questions[0]), ok: false, t: NOW - 9000 + i * 10 }; });
  mw[p7[0].id + ':1'] = { c: wrongC(p7[0].questions[1]), ok: false, t: NOW };
  l1[L.p1[0].id] = { c: wrongC(L.p1[0]), ok: false, t: NOW - 500 };
  mw[L.p1[1].id] = { c: wrongC(L.p1[1]), ok: false, t: NOW };
  L.p2.slice(0, 30).forEach((q, i) => { l2[q.id] = { c: wrongC(q), ok: false, t: NOW - 9000 + i }; });
  /* 聽力 3:第 0 組只有第 1 題的紀錄(錯),其他沒做(模擬考時間到只答一半);第 1 組兩題錯 */
  l3[KS(3, 0, 1)] = { c: wrongC(L.p3[0].questions[1]), ok: false, t: NOW - 700 };
  l3[KS(3, 1, 0)] = { c: wrongC(L.p3[1].questions[0]), ok: false, t: NOW - 800 };
  l3[KS(3, 1, 2)] = { c: wrongC(L.p3[1].questions[2]), ok: false, t: NOW - 600 };
  /* 聽力 4:兩組機場廣播各錯一題 */
  const air = L.p4.filter((s) => s.type === '機場廣播');
  air.forEach((s, i) => { l4[s.id + ':0'] = { c: wrongC(s.questions[0]), ok: false, t: NOW - 400 + i }; });
  return { drill_p5: d5, drill_p6: d6, drill_p7: d7, listen_p1: l1, listen_p2: l2, listen_p3: l3, listen_p4: l4, mock_wrong: mw, _p7: p7, _air: air, _s0: s0 };
}

T['M8 groups:Part 5 照題庫順序只算錯的;Part 6 同題組兩種題型分兩組;Part 7 簡訊、網頁併類、多篇閱讀在最後;聽力 1 不分組;2 依問句;3 一段一組;4 同類併組;組內新的在上'] = () => {
  const st = student();
  const ctx = sandbox(st);
  const W = WB(ctx);
  const bad = [];
  const g5 = W.groups('5');
  const order5 = [...new Set(TOEIC.part5.map((q) => q.category))];
  const names5 = g5.map((g) => g.name);
  if (J(names5) !== J(order5.filter((c) => names5.includes(c)))) bad.push('Part 5 組順序 ' + J(names5));
  const n5 = g5.reduce((n, g) => n + g.items.length, 0);
  if (n5 !== 41) bad.push('Part 5 題數 ' + n5);
  const mockItem = g5.flatMap((g) => g.items).find((x) => x.key === TOEIC.part5[41].id);
  if (!mockItem || mockItem.src !== 'mock') bad.push('模擬考那題的來源');
  if (g5.flatMap((g) => g.items).some((x) => x.key === TOEIC.part5[40].id)) bad.push('答對的那題跑進來');
  g5.forEach((g) => { for (let i = 1; i < g.items.length; i++) if (g.items[i - 1].t < g.items[i].t) bad.push('Part 5 ' + g.name + ' 不是新的在上'); });
  const g6 = W.groups('6');
  const in6 = (name) => (g6.find((g) => g.name === name) || { items: [] }).items.map((x) => x.set.id);
  if (!in6('文法').includes(st._s0.id) || !in6('字彙').includes(st._s0.id)) bad.push('Part 6 同題組沒分到兩組 ' + J(g6.map((g) => g.name)));
  const g7 = W.groups('7');
  const names7 = g7.map((g) => g.name);
  const msg = g7.find((g) => g.name === '簡訊對話'), web = g7.find((g) => g.name === '網頁');
  if (!msg || msg.items.length !== 4) bad.push('簡訊對話 ' + J(msg && msg.items.length));
  if (!web || web.items.length !== 2) bad.push('網頁 ' + J(web && web.items.length));
  if (names7[names7.length - 1] !== '多篇閱讀' || g7[g7.length - 1].items.length !== 2) bad.push('多篇閱讀 ' + J(names7));
  /* 最新的題組(模擬考剛錯了它的第 2 題)排第一,同一個題組的兩題排在一起、照題號 */
  if (msg && !(msg.items[0].key === st._p7[0].id + ':0' && msg.items[1].key === st._p7[0].id + ':1')) bad.push('同題組沒排在一起或新的沒在上 ' + J(msg.items.map((x) => x.key)));
  const g1 = W.groups('1');
  if (g1.length !== 1 || g1[0].items.length !== 2 || g1[0].items[0].src !== 'mock') bad.push('聽力 1 ' + J(g1.map((g) => [g.name, g.items.length])));
  const g2 = W.groups('2');
  const cats2 = [...new Set(L.p2.slice(0, 30).map((q) => q.category))];
  if (J(g2.map((g) => g.name).sort()) !== J(cats2.slice().sort())) bad.push('聽力 2 ' + J(g2.map((g) => g.name)));
  const g3 = W.groups('3');
  if (g3.length !== 2 || g3[0].name !== L.p3[0].title || g3[1].name !== L.p3[1].title) bad.push('聽力 3 ' + J(g3.map((g) => g.name)));
  const g4 = W.groups('4');
  if (g4.length !== 1 || g4[0].name !== '機場廣播' || g4[0].items.length !== st._air.length || st._air.length < 2) bad.push('聽力 4 ' + J(g4.map((g) => [g.name, g.items.length])));
  if ([g5, g6, g7, g1, g2, g3, g4].some((gs) => gs.some((g) => !g.items.length))) bad.push('有空組');
  return { ok: !bad.length, detail: bad.join(' | ') || J({ g5: names5, g7: names7 }) };
};
T['M9 round:一回 20 題/8 組/5 組;最早錯的先出;g 只出那一組;Part 6 只重做那一組的題型;聽力 3 只有部分紀錄的題組也在;rest 算對'] = () => {
  const st = student();
  const ctx = sandbox(st);
  const W = WB(ctx);
  const bad = [];
  const r5 = W.round('5');
  if (r5.units.length !== 20 || r5.rest !== 21) bad.push('Part 5 ' + r5.units.length + '/' + r5.rest);
  if (r5.units[0].id !== TOEIC.part5[0].id) bad.push('Part 5 不是最早錯的先出');
  for (let i = 1; i < r5.units.length; i++) if (TOEIC.part5.indexOf(r5.units[i]) < TOEIC.part5.indexOf(r5.units[i - 1])) { bad.push('Part 5 順序'); break; }
  const g = TOEIC.part5[0].category;
  const rg = W.round('5', g);
  if (!rg.units.length || rg.units.some((q) => q.category !== g)) bad.push('g 沒有只出那一組');
  const want = W.groups('5').find((x) => x.name === g).items.length;
  if (rg.units.length + rg.rest !== want) bad.push('g 的 rest ' + rg.units.length + '+' + rg.rest + '≠' + want);
  const r6 = W.round('6', '文法');
  const u6 = r6.units.find((u) => u.set.id === st._s0.id);
  if (!u6 || u6.wrongKeys.some((k) => u6.set.questions.find((q) => u6.set.id + ':' + q.num === k).type !== '文法')) bad.push('Part 6 wrongKeys ' + J(u6 && u6.wrongKeys));
  const r7 = W.round('7');
  if (r7.units.length !== 7 || r7.rest !== 0) bad.push('Part 7 ' + r7.units.length + '/' + r7.rest);
  const r3 = W.round('3');
  if (!r3.units.some((s) => s.id === L.p3[0].id)) bad.push('聽力 3 只答一半的題組不在');
  const r2 = W.round('2');
  if (r2.units.length !== 20 || r2.rest !== 10) bad.push('聽力 2 ' + r2.units.length + '/' + r2.rest);
  /* 上限:Part 7 九組錯、聽力 4 六組錯 */
  const d7 = {}, l4 = {};
  TOEIC.part7.slice(0, 9).forEach((s, i) => { d7[s.id + ':0'] = { c: wrongC(s.questions[0]), ok: false, t: NOW + i }; });
  L.p4.slice(0, 6).forEach((s, i) => { l4[s.id + ':0'] = { c: wrongC(s.questions[0]), ok: false, t: NOW + i }; });
  const W2 = WB(sandbox({ drill_p7: d7, listen_p4: l4 }));
  const a = W2.round('7'), b = W2.round('4');
  if (a.units.length !== 8 || a.rest !== 1 || a.units[0].set.id !== TOEIC.part7[0].id) bad.push('Part 7 上限 ' + a.units.length + '/' + a.rest);
  if (b.units.length !== 5 || b.rest !== 1) bad.push('聽力 4 上限 ' + b.units.length + '/' + b.rest);
  return { ok: !bad.length, detail: bad.join(' | ') || 'ok' };
};
T['M10 save:沒有題時一個鍵都不碰;有題時只寫一次;本機是看不懂的形狀不寫、回 ok:false;寫完讀回確認;同一份再跑一次不寫'] = () => {
  const bad = [];
  const ctx = sandbox({});
  const W = WB(ctx), S = ctx.store;
  S.reset();
  const e = W.save({});
  if (!e.ok || S.n.get.mock_wrong || S.n.set.mock_wrong) bad.push('空的 ' + J({ e, n: S.n }));
  const add = { [K5(0)]: { c: wrongC(TOEIC.part5[0]), ok: false, t: NOW }, [K5(1)]: { c: TOEIC.part5[1].answer, ok: true, t: NOW } };
  S.reset();
  const r = W.save(add);
  if (!r.ok || r.wrong !== 1 || r.cleared !== 1 || S.n.set.mock_wrong !== 1) bad.push('寫入 ' + J({ r, n: S.n }));
  if (J(S.peek('mock_wrong')) !== J(SM.mockWrong(null, add).v)) bad.push('內容 ' + S.raw('mock_wrong'));
  S.reset();
  const again = W.save(add);
  if (!again.ok || S.n.set.mock_wrong) bad.push('再跑一次 ' + J({ again, n: S.n }));
  const ctx2 = sandbox({ mock_wrong: ['看不懂'] });
  ctx2.store.reset();
  const r2 = WB(ctx2).save(add);
  if (r2.ok || ctx2.store.n.set.mock_wrong || J(ctx2.store.peek('mock_wrong')) !== J(['看不懂'])) bad.push('看不懂的形狀 ' + J(r2));
  /* 寫不進去(common.js 的最後一道擋下):讀回對不上,回 ok:false */
  const ctx3 = sandbox({});
  ctx3.store.set = () => {};
  const r3 = WB(ctx3).save(add);
  if (r3.ok) bad.push('寫不進去還說 ok');
  return { ok: !bad.length, detail: bad.join(' | ') || 'ok' };
};
/* 題數照題庫算(題庫檢查淘汰、新增題後不用改這裡);每一題的 key 都不一樣(n 等於題數) */
T['M11 大小:題庫全錯 < 50 KB;1500 筆長 key < 100 KB'] = () => {
  const all = {};
  let total = 0;
  const put = (k, q) => { total++; all[k] = { c: wrongC(q), ok: false, t: NOW + Object.keys(all).length }; };
  TOEIC.part5.forEach((q) => put(q.id, q));
  TOEIC.part6.forEach((s) => s.questions.forEach((q) => put(s.id + ':' + q.num, q)));
  TOEIC.part7.forEach((s) => s.questions.forEach((q, qi) => put(s.id + ':' + qi, q)));
  L.p1.concat(L.p2).forEach((q) => put(q.id, q));
  L.p3.concat(L.p4).forEach((s) => s.questions.forEach((q, qi) => put(s.id + ':' + qi, q)));
  const n = Object.keys(all).length, size = Buffer.byteLength(J(MW(null, all).v));
  /* 題庫裡最長的 key 再多 4 碼,1500 筆 */
  const longest = Object.keys(all).reduce((n, k) => Math.max(n, k.length), 0);
  const big = {};
  for (let i = 0; i < 1500; i++) big[('p7-b' + String(i).padStart(4, '0') + '-' + 'x'.repeat(longest)).slice(0, longest + 4) + ':' + (i % 5)] = { c: 3, ok: false, t: 1763450000000 + i };
  const size2 = Buffer.byteLength(J(MW(null, big).v));
  return { ok: n === total && n > 0 && size < 50 * 1024 && size2 < 100 * 1024, detail: n + ' 題 ' + size + ' B;1500 筆 ' + size2 + ' B' };
};
T['M13 分頁暫存相容:新版留的 { pid, rec, ans } 舊版 saveLater 的篩選照樣認得;清理 ans 只留 [字串, 整數]、最多 200 對'] = () => {
  const r = spawnSync('git', ['-C', REPO, 'show', '23b8ca9:js/mock.js'], { encoding: 'utf8' });
  const line = r.status === 0 ? /const mine = all\.filter\((x => [^\n]*?)\);/.exec(r.stdout) : null;
  if (!line) return { ok: false, detail: '讀不到 23b8ca9 的 mock.js saveLater 篩選' };
  const oldFilter = vm.runInNewContext('(' + line[1] + ')', { window: { __PROFILE_ID: 'cX' } });
  const entry = { pid: 'cX', rec: { d: '2026-11-18T02:00:00.000Z', size: 'quick' }, ans: [['p5-b1-01', 1]] };
  const W = WB();
  const raw = [['p5-a', 1], ['p5-b', '2'], [3, 1], ['p5-c', 1.5], 'x', null, ['p5-d', 0, 9], ['p5-e', -1]]
    .concat(Array.from({ length: 300 }, (x, i) => ['p5-z' + i, i % 4]));
  const clean = W.cleanAns(raw);
  const ok = oldFilter(entry) === true && clean.length === 200 && J(clean[0]) === J(['p5-a', 1]) && clean.every((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && Number.isInteger(x[1]))
    && J(W.cleanAns('不是陣列')) === '[]';
  return { ok, detail: J({ old: oldFilter(entry), n: clean.length, first: clean.slice(0, 3) }) };
};

/* 審查(2026-11-19)#1:錯題本每列的「你的答案」「正解」整句列出,跟學習記錄(js/history.js)一樣不截斷。
   以前截在 30 字,Part 7、聽力大半的正解看不完整(題庫裡最長的選項 109 字) */
T['M14 optText:選項整句列出不截斷(真題庫每一個選項);選的不在範圍內、題目壞掉回空字串'] = () => {
  const W = WB();
  const qs = TOEIC.part5.concat(...TOEIC.part6.map((s) => s.questions), ...TOEIC.part7.map((s) => s.questions), L.p1, L.p2,
    ...L.p3.map((s) => s.questions), ...L.p4.map((s) => s.questions));
  const bad = [];
  let n = 0, long = 0;
  qs.forEach((q) => (q.options || []).forEach((o, i) => {
    n++;
    if (String(o).length > 30) long++;
    const want = 'ABCD'[i] + '. ' + o;
    if (W.optText(q, i) !== want) bad.push(want.slice(0, 50));
  }));
  const q0 = TOEIC.part5[0];
  const edge = [W.optText(q0, -1), W.optText(q0, q0.options.length), W.optText(q0, 1.5), W.optText(q0, '1'), W.optText(null, 0), W.optText({}, 0)];
  const ok = n > 3000 && long > 1000 && bad.length === 0 && edge.every((x) => x === '');
  return { ok, detail: J({ n, long, bad: bad.length, sample: bad.slice(0, 3), edge }) };
};

/* 審查(2026-11-19)#2:SINCE(js/wrongbook.js)是這一版上線的時間,模擬考首頁靠它說「X/X 改版以前的模擬考補不回來」,寧可晚不要早。
   還沒上線(origin/main 還沒有 js/wrongbook.js)時:SINCE 要是台灣時間某天 23:59:59、在現在之後、兩天以內。
   上線拖過那一天,這一項就擋下來,要把 SINCE 改成上線當天台灣時間 23:59:59。上線之後 SINCE 是過去的時間,不再檢查 */
T['M15 SINCE:還沒上線時是台灣時間某天 23:59:59、在現在之後兩天以內;已上線不檢查'] = () => {
  const W = WB();
  const git = (a) => spawnSync('git', ['-C', REPO].concat(a), { encoding: 'utf8' });
  const ref = git(['rev-parse', '--verify', '-q', 'origin/main^{commit}']);
  if (ref.error || ref.status !== 0) return { ok: true, detail: '沒有 origin/main,判斷不了上線了沒,不檢查' };
  if (git(['cat-file', '-e', 'origin/main:js/wrongbook.js']).status === 0) return { ok: true, detail: 'origin/main 已經有 js/wrongbook.js(上線了),不檢查' };
  const since = Date.parse(W.SINCE), now = Date.now();
  const tw = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const ok = typeof W.SINCE === 'string' && /T15:59:59\.000Z$/.test(W.SINCE) && isFinite(since) && since > now && since - now <= 2 * 864e5;
  return { ok, detail: J({ SINCE: W.SINCE, 台灣: isFinite(since) ? tw(since) : null, 現在台灣: tw(now), 還有幾小時: isFinite(since) ? Math.round((since - now) / 36e5 * 10) / 10 : null }) };
};

/* 審查 2026-11-19 #1:開頁跟雲端對齊(syncCloud)只叫 CLOUD.syncKey('mock_wrong') 一次、照它回的;沒有雲端、syncKey 丟錯或回失敗的 Promise 都回
   { ok:false, changed:false },不丟錯、不碰 store。四個頁面開頁都有呼叫(模擬考、每日複習、題庫、能力分析),老師後台沒有(讀的是學生的資料) */
T['M16 syncCloud:只叫一次 CLOUD.syncKey(\'mock_wrong\')、照它回;沒有雲端、丟錯、失敗都回 ok:false 不丟錯、不碰 store;四個頁面開頁有呼叫、老師後台沒有'] = async () => {
  const run = async (cloud) => {
    const ctx = sandbox();
    if (cloud !== undefined) ctx.CLOUD = cloud;
    ctx.store.reset();
    const r = await ctx.WRONGBOOK.syncCloud();
    return { r, touched: Object.keys(ctx.store.n.get).length + Object.keys(ctx.store.n.set).length };
  };
  const calls = [];
  const got = {
    none: await run(undefined),
    noFn: await run({ enabled: true }),
    ok: await run({ syncKey: (k) => { calls.push(k); return Promise.resolve({ ok: true, changed: true }); } }),
    thrown: await run({ syncKey: () => { throw new Error('x'); } }),
    rejected: await run({ syncKey: () => Promise.reject(new Error('x')) }),
    empty: await run({ syncKey: () => Promise.resolve(null) }),
  };
  const NO = J({ ok: false, changed: false });
  const pages = ['js/mock.js', 'js/review.js', 'js/practice.js', 'js/analysis.js'].filter((f) => !/\.syncCloud\(\)/.test(read(f)));
  const ok = J(got.ok.r) === J({ ok: true, changed: true }) && J(calls) === J(['mock_wrong'])
    && ['none', 'noFn', 'thrown', 'rejected', 'empty'].every((k) => J(got[k].r) === NO)
    && Object.keys(got).every((k) => got[k].touched === 0) && !pages.length && !/syncCloud|syncKey/.test(read('js/admin.js'));
  return { ok, detail: J({ got, calls, 沒呼叫的頁面: pages }) };
};

/* ================= M12:搬家規則、雲端合併表(讀原始碼) ================= */
T['M12 搬家規則 pool、標籤「模擬考錯題」;cloud.js 合併表有 mock_wrong、takeSynced 不再寫死三個鍵;move-merge.js 暫存區合併有 mock_wrong'] = () => {
  const R = BASE.MOVE_RULES, MM = BASE.MOVE_MERGE;
  const cloud = read('js/cloud.js'), mm = read('js/move-merge.js');
  const pooled = MM.pool({ 'p5-a': { c: 0, ok: false, t: 5 } }, { 'p5-a': { c: 1, ok: true, t: 9 }, 'p5-b': { c: 2, ok: false, t: 1 } });
  const merged = /const MERGED = \{[\s\S]*?\n  \};/.exec(cloud);
  const take = /function takeSynced\([\s\S]*?\n  \}\n/.exec(cloud);
  const got = {
    rule: R.ruleOf('mock_wrong'), label: MM.labelOf('mock_wrong'), pool: pooled && pooled['p5-a'].t === 9 && !!pooled['p5-b'],
    merged: !!merged && /\n    mock_wrong: \{ merge: SMF\('mockWrong'\), reconcile: true \},/.test(merged[0]),
    take: !!take && !/\['sync_del', 'vgame_banks', 'mock_history'\]/.test(take[0]) && /Object\.keys\(MERGED\)\.filter\(\(k\) => !MERGED\[k\]\.clock\)/.test(take[0])
      && /const SYNC_FN = \{[^}]*mock_wrong: 'mockWrong'[^}]*\};\n  function takeSynced\(/.test(cloud),
    subs: /const SYNC_SUBS = \[[^\]]*'mock_wrong'[^\]]*\]/.test(mm),
  };
  const ok = got.rule === 'pool' && got.label === '模擬考錯題' && got.pool && got.merged && got.take && got.subs;
  return { ok, detail: J(got) };
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let r;
    try { r = await T[name](); } catch (e) { r = { ok: false, detail: '丟錯:' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + String(r.detail).slice(0, 600));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
