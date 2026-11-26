/* 合併外來資料時不能改到內建物件的原型:js/sync-merge.js、js/sync-merge-lesson.js 的合併函式,以及搬家收件
   (js/move-pack.js 讀搬家碼、js/move-rules.js 驗證、js/move-merge.js 合併)。
   JSON.parse 會把 "__proto__" 當成一般的鍵留著;合併時拿它當字典的鍵讀寫,就會寫進 Object.prototype,整頁的物件都多出屬性。
   "constructor"、"prototype" 是真的英文單字(單字題庫的刪除標記用英文當鍵),要照一般的鍵合併,不能讀到 Object 本身。
   檢查:
   - 帶這三個鍵的資料合併之後,沙盒與 node 本身的 Object.prototype、Object、Function.prototype、Array.prototype 都沒變,({}).x 讀不到東西。
   - 合併結果裡沒有 "__proto__" 這個鍵,結果的物件原型是一般的 Object.prototype。
   - "constructor"、"prototype" 當單字的刪除標記照常合併、照常刪字。
   - 一般的資料合併結果跟修改前的程式算出來的一字不差(下面寫死的預期值是修改前的程式算的)。
   共用的載入在 tools/fixtures/move_kit.js。用法:node tools/test_merge_proto.js */
'use strict';
const vm = require('vm');
const assert = require('assert');

const K = require('./fixtures/move_kit.js');
const { G, R, M, P, SM, J, NOW, UID, makeStorage, tgt, ctxFor, packOf } = K;

const BAD = ['__proto__', 'constructor', 'prototype'];
const ctxObj = vm.runInContext('Object', G);
const ctxFun = vm.runInContext('Function', G);
const ctxArr = vm.runInContext('Array', G);
const ROOTS = [
  ['沙盒 Object.prototype', ctxObj.prototype], ['沙盒 Object', ctxObj], ['沙盒 Function.prototype', ctxFun.prototype], ['沙盒 Array.prototype', ctxArr.prototype],
  ['Object.prototype', Object.prototype], ['Object', Object], ['Function.prototype', Function.prototype], ['Array.prototype', Array.prototype],
];
const snap = () => ROOTS.map(([n, o]) => n + ':' + Object.getOwnPropertyNames(o).sort().join(','));
const BEFORE = snap();
/* 有沒有改到內建物件:有的話列出多出來的屬性,並且把它們刪掉(後面的案例才不受影響) */
function polluted() {
  const now = snap(), bad = [];
  now.forEach((s, i) => {
    if (s === BEFORE[i]) return;
    const [name, o] = ROOTS[i];
    const was = new Set(BEFORE[i].slice(BEFORE[i].indexOf(':') + 1).split(','));
    Object.getOwnPropertyNames(o).filter((k) => !was.has(k)).forEach((k) => { bad.push(name + '.' + k); try { delete o[k]; } catch (e) { /* 刪不掉就留著 */ } });
  });
  ['isTeacher', 'pwn', 'at', 'h0', 'en', 'zh', 'x'].forEach((k) => {
    if (vm.runInContext('({})[' + J(k) + ']', G) !== undefined) bad.push('沙盒 ({}).' + k);
    if (({})[k] !== undefined) bad.push('({}).' + k);
  });
  return bad;
}
/* 結果裡每一個物件:沒有 "__proto__" 這個鍵,原型是一般的 Object.prototype(沙盒或 node 的都算) */
function cleanTree(x, at, out) {
  out = out || [];
  if (!x || typeof x !== 'object') return out;
  if (!Array.isArray(x)) {
    const p = Object.getPrototypeOf(x);
    if (p !== ctxObj.prototype && p !== Object.prototype) out.push((at || '根') + ' 的原型不是 Object.prototype');
    if (Object.prototype.hasOwnProperty.call(x, '__proto__')) out.push((at || '根') + ' 有 __proto__ 鍵');
  }
  Object.keys(x).forEach((k) => cleanTree(x[k], (at ? at + '.' : '') + k, out));
  return out;
}
/* 輸入一律用 JSON 字串在沙盒裡解析("__proto__" 留成一般的鍵,跟從 localStorage、雲端讀進來的一樣) */
const parseIn = (s) => vm.runInContext('JSON.parse(' + J(s) + ')', G);
const entry = (h) => ({ at: NOW - 1000, h0: [h], hs: [] });

const T = {};

T['刪除標記(sync_del):題庫 id、單字鍵、最外層帶 __proto__、constructor、prototype,合併後內建物件不變,結果沒有 __proto__ 鍵'] = () => {
  const evil = ('{"v":1,"__proto__":{"pwn":1},"constructor":{"pwn":1},"vgame_banks":{"b":{"__proto__":{"at":1,"h0":["x"]},"constructor":{"at":1,"h0":["x"]},"prototype":{"at":1,"h0":["x"]}},'
    + '"w":{"__proto__":{"isTeacher":{"at":1,"h0":["x"]}},"constructor":{"pwn":{"at":1,"h0":["x"]}},"prototype":{"pwn":{"at":1,"h0":["x"]}},'
    + '"bk1":{"__proto__":{"at":1,"h0":["x"]},"constructor":{"at":1,"h0":["y"]},"prototype":{"at":1,"h0":["z"]}}}}}').replace(/"at":1,/g, '"at":' + NOW + ',');   // 刪除標記只留 400 天內的
  const good = J({ v: 1, vgame_banks: { b: {}, w: { bk1: { apple: entry('h1') } } } });
  const bad = [];
  let r1, r2;
  try { r1 = SM.tombs(parseIn(evil), parseIn(good), NOW); } catch (e) { bad.push('tombs(evil, good) 丟錯 ' + e.message); }
  bad.push(...polluted());
  try { r2 = SM.tombs(parseIn(good), parseIn(evil), NOW); } catch (e) { bad.push('tombs(good, evil) 丟錯 ' + e.message); }
  bad.push(...polluted());
  [r1, r2].forEach((r, i) => {
    if (!r || r.ok !== true) { bad.push('第 ' + (i + 1) + ' 次沒有合併'); return; }
    bad.push(...cleanTree(r.v, 'v'));
    const w = r.v.vgame_banks.w;
    if (!w.bk1 || !w.bk1.apple || !w.bk1.constructor || !w.bk1.prototype) bad.push('第 ' + (i + 1) + ' 次 bk1 少了單字的標記 ' + J(w.bk1));
    if (typeof w.bk1.constructor !== 'object' || J(w.bk1.constructor.h0) !== '["y"]') bad.push('constructor 的標記不對 ' + J(w.bk1.constructor));
    if (!Object.prototype.hasOwnProperty.call(w, 'constructor') || !Object.prototype.hasOwnProperty.call(r.v.vgame_banks.b, 'prototype')) bad.push('題庫 id 叫 constructor、prototype 的標記不見了');
    if (r.sameAsLocal && i === 0) bad.push('拿掉 __proto__ 之後跟本機那份不一樣,sameAsLocal 不該是 true');
  });
  assert.deepStrictEqual(bad, []);
  return '兩個方向都沒有改到內建物件';
};

T['刪除標記:單字 constructor、prototype 只在一邊有時照常合併(以前讀到 Object 本身會丟錯)'] = () => {
  const a = parseIn(J({ v: 1, vgame_banks: { b: {}, w: { bk1: { constructor: entry('h1') } } } }));
  const b = parseIn(J({ v: 1, vgame_banks: { b: {}, w: { bk1: { apple: entry('h2') }, bk2: { prototype: entry('h3') } } } }));
  const r = SM.tombs(a, b, NOW);
  assert.ok(r.ok, '合併失敗');
  assert.strictEqual(J(r.v), J({ v: 1, vgame_banks: { b: {}, w: { bk1: { apple: entry('h2'), constructor: entry('h1') }, bk2: { prototype: entry('h3') } } } }));
  assert.deepStrictEqual(polluted(), []);
  return J(Object.keys(r.v.vgame_banks.w.bk1));
};

T['刪字:英文是 constructor、prototype 的字照常刪,刪除標記照常記'] = () => {
  const banks = parseIn(J([{ id: 'bk1', name: '自訂', words: [{ en: 'constructor', zh: '建造者', _r: 'aaaa' }, { en: 'prototype', zh: '原型', _r: 'bbbb' }, { en: 'apple', zh: '蘋果', _r: 'cccc' }] }]));
  const d1 = SM.deleteWord(banks, null, 'bk1', 'constructor', NOW);
  const d2 = SM.deleteWord(d1.banks, d1.tombs, 'bk1', 'prototype', NOW + 1);
  const left = d2.banks[0].words.map((w) => w.en);
  assert.strictEqual(J(left), J(['apple']));
  assert.strictEqual(J(Object.keys(d2.tombs.vgame_banks.w.bk1).sort()), J(['constructor', 'prototype']));
  const again = SM.banks(banks, d2.banks, { now: NOW + 2, tombs: d2.tombs });
  assert.ok(again.ok);
  assert.strictEqual(J(again.v[0].words.map((w) => w.en)), J(['apple']));
  assert.deepStrictEqual(polluted(), []);
  return '剩下 ' + J(left);
};

T['模擬考錯題(mock_wrong):題目 key 是 __proto__、constructor、prototype,內建物件不變,結果沒有 __proto__ 鍵'] = () => {
  const evil = parseIn('{"__proto__":{"c":1,"ok":false,"t":5},"constructor":{"c":2,"ok":false,"t":6},"prototype":{"c":3,"ok":true,"t":7},"p5|q1":{"c":0,"ok":false,"t":1}}');
  const good = parseIn(J({ 'p5|q2': { c: 1, ok: false, t: 2 } }));
  const r = SM.mockWrong(evil, good, NOW), r2 = SM.mockWrong(good, evil, NOW);
  const bad = polluted();
  [r, r2].forEach((x) => { if (!x.ok) bad.push('沒有合併'); else bad.push(...cleanTree(x.v, 'v')); });
  if (r.ok && J(Object.keys(r.v)) !== J(['constructor', 'p5|q1', 'p5|q2', 'prototype'])) bad.push('鍵 ' + J(Object.keys(r.v)));
  assert.deepStrictEqual(bad, []);
  return J(Object.keys(r.v));
};

T['題庫(vgame_banks):題庫與字的物件帶 __proto__,合併後內建物件不變,結果沒有 __proto__ 鍵、原型是一般的'] = () => {
  const evil = parseIn('[{"id":"bk1","name":"A","__proto__":{"isTeacher":true},"words":[{"en":"apple","zh":"蘋果","__proto__":{"on":false}}]}]');
  const good = parseIn(J([{ id: 'bk1', name: 'A', words: [{ en: 'pear', zh: '梨' }] }]));
  const r = SM.banks(evil, good, { now: NOW }), r2 = SM.banks(good, evil, { now: NOW });
  const bad = polluted();
  [r, r2].forEach((x) => {
    if (!x.ok) { bad.push('沒有合併'); return; }
    bad.push(...cleanTree(x.v, 'v'));
    if (x.v[0].isTeacher !== undefined) bad.push('題庫多出 isTeacher');
    const apple = x.v[0].words.find((w) => w.en === 'apple');
    if (!apple || apple.on === false) bad.push('apple 被當成取消勾選 ' + J(apple));
  });
  assert.deepStrictEqual(bad, []);
  return '題庫 ' + J(r.v.map((b) => b.words.map((w) => w.en)));
};

T['levels、onboard、self_score、mock_history:帶 __proto__ 的那份,結果沒有 __proto__ 鍵、原型是一般的'] = () => {
  const bad = [];
  const lv = parseIn('{"v":1,"setAt":"2026-11-01T00:00:00Z","__proto__":{"isTeacher":true},"history":[{"at":"2026-11-01T00:00:00Z","__proto__":{"pwn":1}}]}');
  const lv2 = parseIn(J({ v: 1, setAt: '2026-10-01T00:00:00Z', history: [{ at: '2026-10-01T00:00:00Z' }] }));
  [SM.levels(lv, lv2, NOW), SM.levels(lv2, lv, NOW), SM.onboard(parseIn('{"updatedAt":"2026-11-01T00:00:00Z","__proto__":{"pwn":1}}'), null, NOW),
    SM.selfScore(null, parseIn('{"enteredAt":"2026-11-01T00:00:00Z","__proto__":{"pwn":1}}'), NOW),
    SM.mock(parseIn('[{"d":"2026-11-01","size":"quick","__proto__":{"pwn":1}}]'), parseIn('[]'))].forEach((r, i) => {
    if (!r.ok) bad.push(i + ' 沒有合併'); else bad.push(...cleanTree(r.v, i + ''));
    if (r.ok && r.v && (r.v.isTeacher !== undefined || r.v.pwn !== undefined)) bad.push(i + ' 多出屬性');
  });
  bad.push(...polluted());
  assert.deepStrictEqual(bad, []);
  return '5 種';
};

/* 課程進度的形狀見 js/sync-merge-lesson.js 檔頭 */
const lessonOf = (o) => Object.assign({ v: 1, levels: { l: 'B', r: 'B' }, lessonId: 't1_03', packVersion: 1, startedAt: NOW - 50000, doneAt: null,
  seg: { warm: { st: 'done', t0: 1, t1: 2 } }, pk: { 1: { ids: ['q1'], at: 10 } }, a: [[1, 'q1', 0, 1, 1, 100]] }, o || {});

T['課程進度(les_t、pts、tests_v1、rvq):鍵是 __proto__、constructor、prototype,內建物件不變,結果沒有 __proto__ 鍵'] = () => {
  const bad = [];
  const les = J(lessonOf()).replace('"seg":{', '"seg":{"__proto__":{"st":"done"},"constructor":{"st":"done","t0":1,"t1":3},').replace('"pk":{', '"pk":{"__proto__":{"ids":["x"],"at":1},"constructor":{"ids":["y"],"at":2},');
  const les2 = J(lessonOf({ startedAt: NOW - 40000, seg: { warm: { st: 'doing', t0: 1, t1: null }, prototype: { st: 'skip', t0: 1, t1: 2 } } }));
  const r = [SM.lesson(parseIn(les), parseIn(les2)), SM.lesson(parseIn(les2), parseIn(les))];
  const pts = '{"__proto__":{"s":1,"hits":[{"b":"1","d":"2026-11-01","n":1,"ok":1}]},"constructor":{"s":2,"hits":[]},"g1":{"s":0,"hits":[{"b":"1","d":"2026-11-01","n":1,"ok":1,"__proto__":{"pwn":1}}]}}';
  const pts2 = J({ prototype: { s: 3, hits: [] }, g1: { s: 0, hits: [{ b: '2', d: '2026-11-02', n: 2, ok: 1 }] } });
  r.push(SM.pts(parseIn(pts), parseIn(pts2)), SM.pts(parseIn(pts2), parseIn(pts)));
  const tests = '{"__proto__":{"pre":{"at":1}},"constructor":{"pre":{"at":2}},"1":{"__proto__":{"at":3},"constructor":{"at":4},"pre":{"at":5}}}';
  const tests2 = J({ 1: { prototype: { at: 6 }, pre: { at: 7 } }, prototype: { post: { at: 8 } } });
  r.push(SM.tests(parseIn(tests), parseIn(tests2)), SM.tests(parseIn(tests2), parseIn(tests)));
  r.push(SM.rvq(parseIn('[{"k":"a","d0":"2026-11-01","__proto__":{"x":"2026-11-02"}}]'), parseIn('[{"k":"b","d0":"2026-11-01"}]')));
  r.forEach((x, i) => { if (!x.ok) bad.push(i + ' 沒有合併'); else bad.push(...cleanTree(x.v, i + '')); });
  bad.push(...polluted());
  if (r[4].ok && J(Object.keys(r[4].v['1']).sort()) !== J(['constructor', 'pre', 'prototype'])) bad.push('tests 1 的鍵 ' + J(Object.keys(r[4].v['1'])));
  if (r[4].ok && (typeof r[4].v.constructor !== 'object' || J(r[4].v.constructor) !== J({ pre: { at: 2 } }))) bad.push('tests constructor ' + J(r[4].v.constructor));
  if (r[0].ok && J(Object.keys(r[0].v.seg).sort()) !== J(['constructor', 'prototype', 'warm'])) bad.push('seg 的鍵 ' + J(Object.keys(r[0].v.seg)));
  assert.deepStrictEqual(bad, []);
  return r.length + ' 次合併';
};

/* 從搬家碼到寫入清單,跟 js/move-in-page.js 的順序一樣:fromText → validate → plan */
T['搬家碼:刪除標記帶 __proto__ 的搬家碼,讀取、驗證、合併之後內建物件不變;寫進暫存區的標記沒有 __proto__'] = async () => {
  const del = J({ v: 1, vgame_banks: { b: {}, w: { __x__: { isTeacher: { at: 1, h0: ['x'] } } } } }).replace('"__x__"', '"__proto__"');
  const pack = Object.assign(packOf({}).pack, { del: { [UID]: [del, 1] } });
  const hash = await P.hashOf(pack);
  const bad = [];
  const got = await P.fromText(J({ pack, hash }));
  let plan = null;
  if (got.ok) {
    const v = R.validate(got.pack, NOW);
    if (v.ok) {
      const ls = makeStorage(0, {});
      try { plan = M.plan(v, tgt(ls), ctxFor(ls, P.logHash(got.pack, hash))); } catch (e) { bad.push('plan 丟錯 ' + e.message); }
    }
  }
  bad.push(...polluted());
  const writes = plan && Array.isArray(plan.writes) ? plan.writes : [];
  writes.forEach((w) => { if (typeof w[1] === 'string' && /"__proto__"/.test(w[1])) bad.push('寫入 ' + w[0] + ' 帶 __proto__'); });
  assert.deepStrictEqual(bad, []);
  assert.ok(got.ok, '搬家碼被拒絕(' + got.why + ')');
  assert.ok(plan, '沒有走到合併');
  return '寫入 ' + writes.length + ' 筆';
};

T['搬家合併(move-merge):本機與搬來的值都帶 __proto__ 的物件,合併後內建物件不變,寫入的值沒有 __proto__'] = async () => {
  const ls = makeStorage(0, { tr_vgame_done: '{"__proto__":{"pwn":1},"a":[1]}' });
  const pack = packOf({ tr_vgame_done: '{"__proto__":{"isTeacher":1},"b":[2]}' }).pack;
  if (!pack.keys.some((e) => e[0] === 'tr_vgame_done')) return '組包沒有帶這個鍵';
  const hash = await P.hashOf(pack);
  const bad = [];
  const v = R.validate(JSON.parse(J(pack)), NOW);
  let plan = null;
  if (v.ok) { try { plan = M.plan(v, tgt(ls), ctxFor(ls, P.logHash(pack, hash))); } catch (e) { bad.push('plan 丟錯 ' + e.message); } }
  bad.push(...polluted());
  ((plan && plan.writes) || []).forEach((w) => { if (typeof w[1] === 'string' && /"__proto__"|"pwn"|"isTeacher"/.test(w[1])) bad.push('寫入 ' + w[0] + ' ' + w[1]); });
  assert.deepStrictEqual(bad, []);
  assert.ok(v.ok && plan, '驗證不過(' + v.why + ')');
  return '寫入 ' + plan.writes.length + ' 筆';
};

/* ---------- 一般的資料:修改前的程式算出來的結果(一字不差) ---------- */
const NORMAL = require('./fixtures/merge_normal.json');
T['一般的資料:合併結果跟修改前一字不差(' + NORMAL.cases.length + ' 組)'] = () => {
  const diff = [];
  NORMAL.cases.forEach((c) => {
    const args = c.args.map((s) => (s === null ? null : parseIn(s)));
    if (c.fn === 'banks') args[2] = { now: NOW, tombs: args[2], localClean: !!c.clean };
    else args[2] = NOW;
    const r = SM[c.fn].apply(null, args);
    const got = J(r);
    if (got !== c.out) diff.push(c.name + ' 實際 ' + got.slice(0, 200));
  });
  assert.deepStrictEqual(diff, []);
  return NORMAL.cases.length + ' 組一樣';
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let detail = '', ok = true;
    try { detail = await T[name](); } catch (e) {
      ok = false;
      detail = e && e.actual !== undefined ? '實際 ' + JSON.stringify(e.actual) : (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
    }
    polluted();
    if (ok) pass++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + String(detail).slice(0, 600) : ''));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
