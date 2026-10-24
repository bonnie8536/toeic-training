/* 同步合併的純計算測試(同步合併設計 3.7–3.9、5.1 第 1 點):js/sync-merge.js 的 banks、tombs、mock 與頁面寫入用的戳記。
   用法:node tools/test_sync_merge.js            (隨機測試的種子固定;SEED=數字 換一組)
   js/sync-merge.js 在沒有 store、document、localStorage 的沙盒裡載入,碰到就會丟錯,證明它不讀寫任何鍵。
   輸入一律先深度凍結,合併改到輸入也會丟錯。
   要釘住的性質:
   - 交換律:banks(a,b) 與 banks(b,a) 的內容一樣(stateKey 不看題庫與字的順序)。
   - 冪等:banks(m,m) 不變;吸收:m = banks(a,b) 之後 banks(m,a)、banks(m,b) 都等於 m(兩台各自合併會收斂,不會一直互傳)。
   - 不會少:兩份裡沒被刪除標記對上的題庫、字,結果裡一定都在。
   - 刪除標記只刪「刪的時候那個樣子」;刪了又加回(新的 _r)留著;別台在刪之後改過的留著。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'sync-merge.js'), 'utf8');
function load() {
  /* _r 用的 Math.random 換成下面固定種子的亂數,同一個種子每次跑結果一樣 */
  const ctx = { console: { log() {}, warn() {}, error() {} }, Math: Object.assign(Object.create(Math), { random: () => rand() }) };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.SYNC_MERGE;
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + detail : ''));
}
function freeze(o) {
  if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); }
  return o;
}
const J = x => JSON.stringify(x);
const clone = x => JSON.parse(JSON.stringify(x));
const T0 = Date.parse('2026-10-24T12:00:00+08:00');
const DAY = 864e5;

/* 固定種子的亂數(mulberry32),SEED 環境變數可以換 */
let seed = Number(process.env.SEED || 20261024) >>> 0;
function rand() {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = a => a[Math.floor(rand() * a.length)];
const SM = load();
const chance = p => rand() < p;

/* ---------- 工具 ---------- */
const merge = (a, b, tombs) => SM.banks(freeze(clone(a)), freeze(clone(b)), { now: T0, tombs: tombs ? freeze(clone(tombs)) : null });
const key = s => String(s).toLowerCase().trim().replace(/\s+/g, ' ');
/* 結果裡有哪些「題庫 id / 字的 key」 */
function wordSet(banks) {
  const out = new Set();
  (banks || []).forEach(b => { if (b && typeof b.id === 'string') (b.words || []).forEach(w => { if (w && typeof w.en === 'string') out.add(b.id + '|' + key(w.en)); }); });
  return out;
}
const bankIds = banks => new Set((banks || []).filter(b => b && typeof b.id === 'string').map(b => b.id));
const findWord = (banks, id, en) => { const b = (banks || []).find(x => x.id === id); return b && (b.words || []).find(w => key(w.en) === key(en)); };

/* ---------- 隨機產生「兩台各自改過」的題庫 ---------- */
const EN = ['apple', 'banana', 'cherry', 'put on', 'take off', 'schedule', 'Apple ', 'invoice', 'deadline', 'refund'];
const ZH = ['蘋果', '香蕉', '櫻桃', '穿上', '脫下', '行程表', '發票', '截止日', '退款', '蘋果；蘋果樹', '時間表'];
/* 共同祖先:一份舊資料(沒有戳記)或新版資料 */
function baseBanks(now) {
  const n = 1 + Math.floor(rand() * 3);
  const out = [];
  for (let i = 0; i < n; i++) {
    const legacy = chance(0.4);
    const b = legacy ? { id: 'b' + i, name: '題庫' + i, words: [] } : SM.newBank('b' + i, '題庫' + i, now - 5 * DAY);
    const m = Math.floor(rand() * 5);
    for (let j = 0; j < m; j++) {
      const en = pick(EN);
      if (b.words.some(w => key(w.en) === key(en))) continue;
      b.words.push(legacy ? { en, zh: pick(ZH), on: true } : SM.newWord(en, pick(ZH), now - 5 * DAY));
    }
    out.push(b);
  }
  return out;
}
/* 一台裝置用新版頁面的寫入函式隨機改幾下;回傳改過的題庫與這台寫的刪除標記 */
function evolve(banks, tombs, now, steps) {
  let B = clone(banks), T = clone(tombs);
  for (let s = 0; s < steps; s++) {
    now += 1000 + Math.floor(rand() * 60000);
    const r = rand();
    const ids = B.map(b => b.id);
    if (r < 0.15 || !ids.length) {
      const id = SM.newBankId(now);
      B = B.concat([SM.newBank(id, '新' + id.slice(-3), now)]);
    } else if (r < 0.45) {
      const id = pick(ids);
      B = SM.editBank(B, id, now, b => SM.addWords(b, [{ en: pick(EN), zh: pick(ZH) }], now));
    } else if (r < 0.6) {
      const id = pick(ids), b = B.find(x => x.id === id);
      if (!b.words.length) continue;
      const w = pick(b.words);
      B = SM.editBank(B, id, now, bk => SM.setWord(bk, key(w.en), { zh: pick(ZH) }, now));
    } else if (r < 0.7) {
      const id = pick(ids), b = B.find(x => x.id === id);
      if (!b.words.length) continue;
      const w = pick(b.words);
      B = SM.editBank(B, id, now, bk => SM.setWord(bk, key(w.en), { on: w.on === false }, now));
    } else if (r < 0.8) {
      const id = pick(ids);
      B = SM.editBank(B, id, now, bk => Object.assign({}, bk, { name: '改名' + Math.floor(rand() * 100) }));
    } else if (r < 0.92) {
      const id = pick(ids), b = B.find(x => x.id === id);
      if (!b.words.length) continue;
      const w = pick(b.words);
      const d = SM.deleteWord(B, T, id, key(w.en), now);
      B = d.banks; T = d.tombs;
    } else {
      const id = pick(ids);
      const d = SM.deleteBank(B, T, id, now);
      B = d.banks; T = d.tombs;
    }
  }
  return { banks: B, tombs: T, now };
}

/* ---------- 1. 基本 ---------- */
(function basics() {
  check('quickHash 跟 feat/move 的 move-merge.js 同一個函式(固定值)', SM.quickHash('abc') === '1dtlchkfkb1' && SM.quickHash('') === 'wvjl67o803', SM.quickHash('abc') + ' / ' + SM.quickHash(''));
  check('canon:鍵排序、undefined 當 null', SM.canon({ b: 1, a: [1, { d: undefined, c: 2 }] }) === '{"a":[1,{"c":2,"d":null}],"b":1}', SM.canon({ b: 1, a: [1, { d: undefined, c: 2 }] }));
  const legacy = [{ id: 'b1', name: '我的', words: [{ en: 'apple', zh: '蘋果', on: true }, { en: 'pear', zh: '梨', on: false }] }];
  const m = merge(legacy, legacy);
  check('一樣的舊資料(沒有 _r、_p、_t)合併:不多任何欄位,跟兩邊都一樣', m.ok && m.sameAsLocal && m.sameAsCloud && J(m.v) === J(legacy), J(m.v));
  const bad = [SM.banks({}, [], {}), SM.banks([], 'x', {}), SM.banks(5, [], {})];
  check('題庫不是陣列:唯讀(ok:false)', bad.every(r => r && r.ok === false), J(bad));
  const nul = SM.banks(null, legacy, { now: T0 });
  check('本機沒有(null):用雲端那份', nul.ok && J(nul.v) === J(legacy) && nul.sameAsCloud && !nul.sameAsLocal, J(nul));
  const opaque = merge([{ name: 'x', words: ['apple'] }, 7], [{ name: 'x', words: ['apple'] }, { name: 'y', words: [] }]);
  check('沒有字串 id 的元素(假資料):用內容去重後全部留下,不合併', opaque.ok && opaque.v.length === 3 && J(opaque.v).indexOf('"y"') > 0, J(opaque.v));
})();

/* ---------- 2. 兩台交錯新增 ---------- */
(function interleave() {
  const now = T0;
  const base = [SM.newBank('b1', '第一課', now - DAY)];
  const pc = SM.editBank(base, 'b1', now, b => SM.addWords(b, [{ en: 'apple', zh: '蘋果' }], now));
  const phoneNew = SM.newBank(SM.newBankId(now + 5), '手機題庫', now + 5);
  const phone = SM.editBank(base.concat([phoneNew]), 'b1', now + 9, b => SM.addWords(b, [{ en: 'banana', zh: '香蕉' }], now + 9));
  const a = merge(pc, phone), b = merge(phone, pc);
  const ws = wordSet(a.v);
  check('兩台各自加字、一台加題庫:合併後兩邊的都在,而且跟參數順序無關',
    a.ok && b.ok && ws.has('b1|apple') && ws.has('b1|banana') && bankIds(a.v).has(phoneNew.id) && SM.stateKey(a.v) === SM.stateKey(b.v), J(a.v.map(x => [x.id, x.words.map(w => w.en)])));
  const again = merge(a.v, pc), again2 = merge(a.v, phone), self = merge(a.v, a.v);
  check('冪等與吸收:合併結果再跟任一份或自己合併都不變', again.sameAsLocal && again2.sameAsLocal && self.sameAsLocal && self.sameAsCloud, [again.sameAsLocal, again2.sameAsLocal, self.sameAsLocal].join(','));
})();

/* ---------- 3. 同一個字兩邊都改 ---------- */
(function conflicts() {
  const now = T0;
  const base = SM.editBank([SM.newBank('b1', '課', now - DAY)], 'b1', now - DAY, b => SM.addWords(b, [{ en: 'apple', zh: '蘋果' }], now - DAY));
  const A = SM.editBank(base, 'b1', now, b => SM.setWord(b, 'apple', { zh: '蘋果樹' }, now));
  const B = SM.editBank(base, 'b1', now + 1000, b => SM.setWord(b, 'apple', { zh: '大蘋果' }, now + 1000));
  const m1 = merge(A, B), m2 = merge(B, A);
  const w = findWord(m1.v, 'b1', 'apple');
  check('兩台同時改同一個字的中文:新的當主要,另一個放 alt,兩邊順序結果一樣', w && w.zh === '大蘋果' && J(w.alt) === J(['蘋果樹']) && SM.stateKey(m1.v) === SM.stateKey(m2.v), J(w));
  const old = merge(A, base);
  const w2 = findWord(old.v, 'b1', 'apple');
  check('另一份是舊版本(雜湊在 _p 裡):用新的,不留 alt', old.sameAsLocal && w2.zh === '蘋果樹' && !w2.alt, J(w2));
  const sameVariant = SM.editBank(base, 'b1', now + 2000, b => SM.setWord(b, 'apple', { zh: '蘋果；蘋果樹' }, now + 2000));
  const m3 = merge(sameVariant, A);
  const w3 = findWord(m3.v, 'b1', 'apple');
  check('輸的那個中文已經是主要那個的一種寫法:不放 alt', w3.zh === '蘋果；蘋果樹' && !w3.alt, J(w3));
  /* 名稱:電腦改名、手機之後加字,改名不能被蓋回去 */
  const renamed = SM.editBank(base, 'b1', now, b => Object.assign({}, b, { name: '新名字' }));
  const added = SM.editBank(base, 'b1', now + 5000, b => SM.addWords(b, [{ en: 'pear', zh: '梨' }], now + 5000));
  const m4 = merge(renamed, added), m5 = merge(added, renamed);
  check('改名跟別台之後加字同時發生:名字用改過的、字也都在', m4.v[0].name === '新名字' && m5.v[0].name === '新名字' && wordSet(m4.v).has('b1|pear'), m4.v[0].name + ' / ' + m5.v[0].name);
  /* 舊版頁面就地改了中文(沒有戳記) */
  const legacyEdit = clone(base); legacyEdit[0].words[0].zh = '紅蘋果';
  const m6 = merge(A, legacyEdit), m7 = merge(legacyEdit, A);
  const w6 = findWord(m6.v, 'b1', 'apple');
  check('舊版頁面改的中文(沒戳記)跟新版改的衝突:兩個中文都留(一個在 alt),順序無關', [w6.zh].concat(w6.alt || []).sort().join() === '紅蘋果,蘋果樹' && SM.stateKey(m6.v) === SM.stateKey(m7.v), J(w6));
  /* alt 被使用者刪掉:別台還有 alt 的那份是舊版本,不會帶回來 */
  const cleared = SM.editBank(m1.v, 'b1', now + 9000, b => SM.setWord(b, 'apple', { alt: [] }, now + 9000));
  const m8 = merge(cleared, m1.v);
  check('在編輯頁刪掉 alt:別台留著 alt 的舊版本不會把它帶回來', !findWord(m8.v, 'b1', 'apple').alt && m8.sameAsLocal, J(findWord(m8.v, 'b1', 'apple')));
})();

/* ---------- 4. 刪除標記 ---------- */
(function tombstones() {
  const now = T0;
  const base = SM.editBank([SM.newBank('b1', '課', now - DAY), SM.newBank('b2', '另一課', now - DAY)], 'b1', now - DAY,
    b => SM.addWords(b, [{ en: 'apple', zh: '蘋果' }, { en: 'pear', zh: '梨' }], now - DAY));
  /* 電腦刪字 */
  const del = SM.deleteWord(base, null, 'b1', 'apple', now);
  const m1 = merge(del.banks, base, del.tombs), m2 = merge(base, del.banks, del.tombs);
  check('刪字:另一台還是刪之前那份(舊的),合併後不會回來,兩邊順序一樣', !wordSet(m1.v).has('b1|apple') && !wordSet(m2.v).has('b1|apple') && wordSet(m1.v).has('b1|pear') && SM.stateKey(m1.v) === SM.stateKey(m2.v), J([...wordSet(m1.v)]));
  /* 別台在刪之前改過那個字(還沒傳):留著 */
  const edited = SM.editBank(base, 'b1', now + 1000, b => SM.setWord(b, 'apple', { zh: '青蘋果' }, now + 1000));
  const m3 = merge(del.banks, edited, del.tombs);
  check('刪字:別台在那之後改過那個字:留下來(多留)', findWord(m3.v, 'b1', 'apple') && findWord(m3.v, 'b1', 'apple').zh === '青蘋果', J(findWord(m3.v, 'b1', 'apple')));
  /* 刪了又加回 */
  const readd = SM.editBank(del.banks, 'b1', now + 2000, b => SM.addWords(b, [{ en: 'apple', zh: '蘋果' }], now + 2000));
  const m4 = merge(readd, base, del.tombs), m5 = merge(base, readd, del.tombs);
  check('刪了又在新版加回同一個字(同樣的中文):新的 _r,不會被舊標記刪掉', !!findWord(m4.v, 'b1', 'apple') && !!findWord(m5.v, 'b1', 'apple'), J(findWord(m4.v, 'b1', 'apple')));
  /* 刪之前剛改過、還沒傳上去:雲端還是改之前那份,也要刪 */
  const touched = SM.editBank(base, 'b1', now + 100, b => SM.setWord(b, 'apple', { zh: '蘋果2' }, now + 100));
  const del2 = SM.deleteWord(touched, null, 'b1', 'apple', now + 200);
  const m6 = merge(del2.banks, base, del2.tombs);
  check('刪之前剛改過那個字(雲端還是改之前的版本):一樣刪掉', !findWord(m6.v, 'b1', 'apple'), J([...wordSet(m6.v)]));
  /* 刪題庫 */
  const delB = SM.deleteBank(base, null, 'b1', now);
  const m7 = merge(delB.banks, base, delB.tombs), m8 = merge(base, delB.banks, delB.tombs);
  check('刪題庫:別台的舊版本不會把它帶回來,另一個題庫還在', !bankIds(m7.v).has('b1') && !bankIds(m8.v).has('b1') && bankIds(m7.v).has('b2'), J([...bankIds(m7.v)]));
  const later = SM.editBank(base, 'b1', now + 3000, b => SM.addWords(b, [{ en: 'kiwi', zh: '奇異果' }], now + 3000));
  const m9 = merge(delB.banks, later, delB.tombs);
  check('刪題庫:別台在那之後又改過:留下來(多留),別台加的字在', bankIds(m9.v).has('b1') && wordSet(m9.v).has('b1|kiwi'), J([...wordSet(m9.v)]));
  /* 只有雲端有、被刪掉的那一份(舊版頁面整份帶回雲端) */
  const m10 = SM.banks(null, freeze(clone(base)), { now, tombs: freeze(clone(delB.tombs)) });
  check('本機沒有、雲端是被刪掉的那份:套標記後也不在', m10.ok && !bankIds(m10.v).has('b1') && !m10.sameAsCloud, J([...bankIds(m10.v)]));
  /* 標記合併 */
  const t2 = SM.deleteWord(base, del.tombs, 'b1', 'pear', now + 10).tombs;
  const tm = SM.tombs(freeze(clone(del.tombs)), freeze(clone(t2)), now + 20);
  const tm2 = SM.tombs(freeze(clone(t2)), freeze(clone(del.tombs)), now + 20);
  check('刪除標記合併:取聯集、兩邊順序一樣', tm.ok && SM.canon(tm.v) === SM.canon(tm2.v) && !!tm.v.vgame_banks.w.b1.apple && !!tm.v.vgame_banks.w.b1.pear, J(Object.keys(tm.v.vgame_banks.w.b1)));
  const oldT = SM.tombs(freeze(clone(del.tombs)), null, now + 401 * DAY);
  check('刪除標記保留 400 天:過期的清掉', oldT.ok && !(oldT.v.vgame_banks.w.b1 && oldT.v.vgame_banks.w.b1.apple), J(oldT.v));
  const futureV = SM.tombs({ v: 2 }, freeze(clone(del.tombs)), now);
  check('刪除標記是更新版的格式(v:2):唯讀', futureV.ok === false, J(futureV));
  const unknown = SM.tombs(freeze({ v: 1, writing_b: { x: 1 } }), freeze(clone(del.tombs)), now);
  check('刪除標記裡有這一版不認得的鍵(下一輪的寫作):原樣留著', unknown.ok && J(unknown.v.writing_b) === J({ x: 1 }) && !!unknown.v.vgame_banks, J(unknown.v));
})();

/* ---------- 5. 刪除標記的上限與大小 ---------- */
(function limits() {
  const now = T0;
  const longEn = n => ('w' + n + 'abcdefghijklmnopqrstuvwxyz').slice(0, 30);
  /* 最壞情況:兩台各 1200 筆(一半重疊),每筆的字串最長、每筆的雜湊塞滿(刪的那份吸收過 12 個版本,另一台又多 3 個 h0) */
  const one = { v: 1, vgame_banks: { b: {}, w: {} } }, two = { v: 1, vgame_banks: { b: {}, w: {} } };
  for (let i = 0; i < 1200; i++) {
    let w = SM.newWord(longEn(i), '中文', now - 10 * DAY);
    for (let k = 0; k < 12; k++) w = SM.reviseWord(w, { zh: '中文' + k }, now - 10 * DAY + k * 1000);
    const id = 'b' + (i % 40) + 'xxxxxxxxxxxx';
    const e = SM.deleteWord([{ id, name: 'n', words: [w] }], null, id, key(w.en), now - DAY + i).tombs.vgame_banks.w[id][key(w.en)];
    (one.vgame_banks.w[id] = one.vgame_banks.w[id] || {})[key(w.en)] = e;
    if (i % 2) (two.vgame_banks.w[id] = two.vgame_banks.w[id] || {})[key(w.en)] = { at: e.at, h0: ['h' + i + 'a', 'h' + i + 'b', 'h' + i + 'c'], hs: [] };
  }
  const T = SM.tombs(freeze(one), freeze(two), now).v;
  const n = Object.values(T.vgame_banks.w).reduce((s, o) => s + Object.keys(o).length, 0) + Object.keys(T.vgame_banks.b).length;
  const size = Buffer.byteLength(JSON.stringify(T));
  const maxH = Math.max(...[].concat(...Object.values(T.vgame_banks.w).map(o => Object.values(o))).map(e => e.h0.length + e.hs.length));
  check('刪除標記最多 1000 筆、每筆雜湊最多 8 個;最壞情況序列化小於 200 KB(雲端單鍵 256 KB)', n <= 1000 && maxH <= 8 && size < 200 * 1024, n + ' 筆 / 每筆最多 ' + maxH + ' 個雜湊 / ' + Math.round(size / 1024) + ' KB');
  const newest = Object.values(T.vgame_banks.w).some(o => o[key(longEn(1199))]);
  check('超過上限從最舊的清', newest && !Object.values(T.vgame_banks.w).some(o => o[key(longEn(0))]), '最新那筆 ' + (newest ? '在' : '不在'));
  let w = SM.newWord('apple', '蘋果', now);
  for (let k = 0; k < 20; k++) w = SM.reviseWord(w, { zh: '蘋果' + k }, now + k * 1000);
  let b = SM.newBank('b1', 'x', now);
  for (let k = 0; k < 20; k++) b = SM.reviseBank(b, Object.assign({}, b, { name: 'x' + k }), now + k * 1000);
  check('字的 _p 最多 4 個、題庫的 _p 最多 8 個(留最新的)', w._p.length === 4 && b._p.length === 8, w._p.length + ' / ' + b._p.length);
})();

/* ---------- 6. 隨機:交換律、冪等、吸收、不會少 ---------- */
(function fuzz() {
  const N = 3000;
  let bad = { comm: 0, idem: 0, absorb: 0, loss: 0, conv: 0, ok: 0 };
  let example = '';
  for (let i = 0; i < N; i++) {
    const now = T0 + i * 1000;
    const base = baseBanks(now);
    const A = evolve(base, null, now, Math.floor(rand() * 4));
    const B = evolve(base, null, A.now, Math.floor(rand() * 4));
    const C = evolve(chance(0.5) ? base : A.banks, null, B.now, Math.floor(rand() * 3));
    const T = SM.tombs(SM.tombs(A.tombs, B.tombs, now).v, C.tombs, now).v;
    const ab = merge(A.banks, B.banks, T), ba = merge(B.banks, A.banks, T);
    if (!ab.ok || !ba.ok) { bad.ok++; continue; }
    if (SM.stateKey(ab.v) !== SM.stateKey(ba.v)) { bad.comm++; if (!example) example = 'comm ' + J([A.banks, B.banks]); }
    const self = merge(ab.v, ab.v, T);
    if (!self.sameAsLocal || !self.sameAsCloud) { bad.idem++; if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, J({ A: A.banks, B: B.banks, C: C.banks, T })); }
    if (!merge(ab.v, A.banks, T).sameAsLocal || !merge(ab.v, B.banks, T).sameAsLocal) { bad.absorb++; if (!example) example = 'absorb ' + J([A.banks, B.banks, ab.v]); }
    /* 不會少:兩份裡沒被標記刪掉的字都在(題庫:這一份、或拿掉被刪的字之後的樣子對得上題庫的標記,才算刪掉) */
    const want = new Set();
    [A.banks, B.banks].forEach(bs => bs.forEach(bk => {
      const left = bk.words.filter(w => !SM.tombHit(T, bk.id, key(w.en), SM.wordHash(w)));
      if (SM.tombHit(T, bk.id, null, SM.bankHash(bk)) || SM.tombHit(T, bk.id, null, SM.bankHash(Object.assign({}, bk, { words: left })))) return;
      left.forEach(w => want.add(bk.id + '|' + key(w.en)));
    }));
    const got = wordSet(ab.v);
    const miss = [...want].filter(k => !got.has(k));
    if (miss.length) { bad.loss++; if (!example) example = 'loss ' + miss.join(',') + ' ' + J([A.banks, B.banks, T]); }
    /* 三份不同順序合併,再互相合併一次就收斂(兩台各自用不同順序合併過,碰面一次之後就一樣) */
    const r1 = merge(ab.v, C.banks, T).v, r2 = merge(A.banks, merge(B.banks, C.banks, T).v, T).v;
    const j = merge(r1, r2, T).v;
    if (!merge(j, r1, T).sameAsLocal || !merge(j, r2, T).sameAsLocal) { bad.conv++; if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, J({ A: A.banks, B: B.banks, C: C.banks, T })); }
  }
  check('隨機 ' + N + ' 組:都能合併(ok)', bad.ok === 0, J(bad));
  check('隨機:交換律(兩邊順序內容一樣)', bad.comm === 0, bad.comm + ' 組不同 ' + example.slice(0, 300));
  check('隨機:冪等(自己跟自己合併不變)', bad.idem === 0, bad.idem + ' 組');
  check('隨機:吸收(合併結果再跟任一份合併不變,兩台不會一直互傳)', bad.absorb === 0, bad.absorb + ' 組 ' + (example.indexOf('absorb') === 0 ? example.slice(0, 400) : ''));
  check('隨機:不會少(沒被標記刪掉的字都在)', bad.loss === 0, bad.loss + ' 組 ' + (example.indexOf('loss') === 0 ? example.slice(0, 400) : ''));
  check('隨機:三份不同順序合併後再互相合併一次就收斂', bad.conv === 0, bad.conv + ' 組');
})();

/* ---------- 7. 模擬考紀錄 ---------- */
(function mock() {
  const r = (d, s) => ({ d: '2026-10-' + d + 'T01:00:00.000Z', size: 'full', lRaw: s, lTotal: 100, rRaw: s, rTotal: 100, lScore: s * 4, rScore: s * 4 });
  const a = [r('01', 50), r('03', 60)], b = [r('01', 50), r('02', 55)];
  const m1 = SM.mock(freeze(clone(a)), freeze(clone(b))), m2 = SM.mock(freeze(clone(b)), freeze(clone(a)));
  check('模擬考紀錄:取聯集、同一筆不重複、照時間排,兩邊順序一樣', m1.ok && m1.v.length === 3 && J(m1.v) === J(m2.v) && m1.v[1].d.slice(8, 10) === '02', J(m1.v.map(x => x.d.slice(8, 10))));
  const many = Array.from({ length: 25 }, (_, i) => r(String(10 + i).padStart(2, '0'), i)), many2 = Array.from({ length: 25 }, (_, i) => Object.assign(r(String(10 + i).padStart(2, '0'), i), { d: '2026-11-' + String(1 + i).padStart(2, '0') + 'T01:00:00.000Z' }));
  const m3 = SM.mock(many, many2);
  check('模擬考紀錄:留最後 30 筆(mock.js 原本的規則)', m3.v.length === 30 && m3.v[29].d.indexOf('2026-11-25') === 0, m3.v.length + ' 筆');
  const same = SM.mock(freeze(clone(a)), freeze(clone(a)));
  check('模擬考紀錄:一樣就不變', same.sameAsLocal && same.sameAsCloud && J(same.v) === J(a), J(same));
  check('模擬考紀錄:不是陣列就唯讀', SM.mock({}, []).ok === false && SM.mock([], 'x').ok === false, '');
})();

/* ---------- 8. 頁面寫入用的函式 ---------- */
(function pageOps() {
  const now = T0;
  const id1 = SM.newBankId(now), id2 = SM.newBankId(now);
  check('新題庫 id:時間 + 隨機 3 碼,同一毫秒兩個不會撞', /^b[0-9a-z]+$/.test(id1) && id1 !== id2 && id1.length === ('b' + now.toString(36)).length + 3, id1 + ' / ' + id2);
  const w = SM.newWord('apple', '蘋果', now);
  check('新字有 _r(6 碼)和 _t', typeof w._r === 'string' && w._r.length === 6 && w._t === now && w.on === true, J(w));
  const w2 = SM.reviseWord(w, { zh: '蘋果樹' }, now + 1000);
  check('改中文:改前的雜湊放進 _p、_t 換新;沒改就原樣', w2._p.length === 1 && w2._p[0].split('.')[0] === SM.wordHash(w) && w2._t === now + 1000 && SM.reviseWord(w2, { zh: '蘋果樹' }, now + 5) === w2, J(w2));
  const banks = freeze([{ id: 'b1', name: 'x', words: [{ en: 'apple', zh: '蘋果', on: true }] }]);
  const next = SM.editBank(banks, 'b1', now, b => SM.addWords(b, [{ en: 'Apple', zh: '紅蘋果' }, { en: 'pear', zh: '梨' }], now));
  const nb = next[0];
  check('批次加字:同一個字(大小寫不同)更新中文並蓋戳記,新字加 _r;題庫 _p 記改前雜湊', nb.words.length === 2 && nb.words[0].zh === '紅蘋果' && nb.words[0]._p.length === 1 && !!nb.words[1]._r && nb._p[0].split('.')[0] === SM.bankHash(banks[0]), J(nb));
  const d = SM.deleteWord(next, null, 'b1', 'pear', now + 5);
  check('刪字:寫刪除標記(h0 = 刪的那份的雜湊)、題庫拿掉那個字', d.banks[0].words.length === 1 && d.tombs.vgame_banks.w.b1.pear.h0[0] === SM.wordHash(nb.words[1]), J(d.tombs));
  const db = SM.deleteBank(next, d.tombs, 'b1', now + 6);
  check('刪題庫:標記記題庫雜湊與它的 _p,之前的字標記留著', db.banks.length === 0 && db.tombs.vgame_banks.b.b1.h0[0] === SM.bankHash(next[0]) && db.tombs.vgame_banks.b.b1.hs.indexOf(SM.bankHash(banks[0])) >= 0 && !!db.tombs.vgame_banks.w.b1.pear, J(db.tombs.vgame_banks.b));
  const unchanged = SM.editBank(next, 'b1', now + 9, b => b);
  check('editBank 沒改到內容:回原本的陣列(不寫、不上傳)', unchanged === next, '');
})();

console.log(pass + ' / ' + (pass + fail) + ' 通過');
process.exit(fail ? 1 : 0);
