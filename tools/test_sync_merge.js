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
/* 模擬「改回去的內容跟以前那一版一模一樣」(第三輪起新版改內容會換 _r,不會這樣;舊版頁面、這一版之前的資料可能有):
   每個字的 _r 換回 ref 裡同一個英文那個字的(ref 沒有 _r 就拿掉)、拿掉 _m,兩份互相吸收過 */
const unmark = (banks, ref) => banks.map(b => Object.assign({}, b, { words: (b.words || []).map(w => {
  const c = Object.assign({}, w), o = findWord(ref, b.id, w.en);
  delete c._m; delete c._r;
  if (o && typeof o._r === 'string') c._r = o._r;
  return c;
}) }));
const findWord = (banks, id, en) => { const b = (banks || []).find(x => x.id === id); return b && (b.words || []).find(w => key(w.en) === key(en)); };

/* ---------- 隨機產生「兩台各自改過」的題庫 ---------- */
const EN = ['apple', 'banana', 'cherry', 'put on', 'take off', 'schedule', 'Apple ', 'invoice', 'deadline', 'refund'];
const ZH = ['蘋果', '香蕉', '櫻桃', '穿上', '脫下', '行程表', '發票', '截止日', '退款', '蘋果；蘋果樹', '時間表'];
/* 共同祖先:一份舊資料(沒有戳記;同一個英文可能出現兩次,例如 apple 和 'Apple ')或新版資料 */
function baseBanks(now) {
  const n = 1 + Math.floor(rand() * 3);
  const out = [];
  for (let i = 0; i < n; i++) {
    const legacy = chance(0.4);
    const b = legacy ? { id: 'b' + i, name: '題庫' + i, words: [] } : SM.newBank('b' + i, '題庫' + i, now - 5 * DAY);
    const m = Math.floor(rand() * 5);
    for (let j = 0; j < m; j++) {
      const en = pick(EN);
      if (b.words.some(w => (legacy ? w.en === en : key(w.en) === key(en)))) continue;
      b.words.push(legacy ? { en, zh: pick(ZH), on: true } : SM.newWord(en, pick(ZH), now - 5 * DAY));
    }
    out.push(b);
  }
  return out;
}
/* 這個測試自己的「同一個版本」:字看 en、zh、勾選、_r、alt、_m,題庫看名稱、_r、_m 和每個字(不呼叫 SM 的雜湊、標記函式,
   「不會少」的答案才不會跟著實作一起錯) */
const sortedAlt = w => (Array.isArray(w.alt) && w.alt.length ? w.alt.slice().sort() : null);
const wc = w => J([w.en, w.zh === undefined ? null : w.zh, w.on !== false, typeof w._r === 'string' ? w._r : null, sortedAlt(w), typeof w._m === 'string' ? w._m : null]);
const bc = b => J([b.name === undefined ? null : b.name, typeof b._r === 'string' ? b._r : null, typeof b._m === 'string' ? b._m : null, (b.words || []).map(wc).sort()]);
/* 一條裝置的歷史:每個題庫、每個字(題庫|英文)出現過的版本;刪的時候,刪的那一份和它之前出現過的版本都算「可以刪」(放進 del) */
function history(from) {
  const cp = m => new Map(Array.from(m || [], ([k, v]) => [k, new Set(v)]));
  return { w: cp(from && from.w), b: cp(from && from.b) };
}
const addTo = (m, k, v) => (m.get(k) || m.set(k, new Set()).get(k)).add(v);
function record(h, B) {
  B.forEach(b => { addTo(h.b, b.id, bc(b)); b.words.forEach(w => addTo(h.w, b.id + '|' + key(w.en), wc(w))); });
}
const DEL = { w: new Map(), b: new Map() };
/* 一台裝置用新版頁面的寫入函式隨機改幾下;回傳改過的題庫、這台寫的刪除標記和它的歷史 */
function evolve(banks, tombs, now, steps, from) {
  let B = clone(banks), T = clone(tombs);
  const h = history(from);
  record(h, B);
  for (let s = 0; s < steps; s++) {
    if (s) record(h, B);
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
      (h.w.get(id + '|' + key(w.en)) || new Set()).forEach(v => addTo(DEL.w, id + '|' + key(w.en), v));
      const d = SM.deleteWord(B, T, id, key(w.en), now);
      B = d.banks; T = d.tombs;
    } else {
      const id = pick(ids);
      (h.b.get(id) || new Set()).forEach(v => addTo(DEL.b, id, v));
      const d = SM.deleteBank(B, T, id, now);
      B = d.banks; T = d.tombs;
    }
  }
  record(h, B);
  return { banks: B, tombs: T, now, h };
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
  let bad = { comm: 0, idem: 0, absorb: 0, loss: 0, conv: 0, ok: 0, kept: 0 };
  let example = '', dupRuns = 0;
  for (let i = 0; i < N; i++) {
    const now = T0 + i * 1000;
    const base = baseBanks(now);
    if (base.some(b => b.words.length !== new Set(b.words.map(w => key(w.en))).size)) dupRuns++;
    DEL.w.clear(); DEL.b.clear();
    const A = evolve(base, null, now, Math.floor(rand() * 4));
    const B = evolve(base, null, A.now, Math.floor(rand() * 4));
    const fromA = chance(0.5);
    const C = evolve(fromA ? A.banks : base, null, B.now, Math.floor(rand() * 3), fromA ? A.h : null);
    const T = SM.tombs(SM.tombs(A.tombs, B.tombs, now).v, C.tombs, now).v;
    const ab = merge(A.banks, B.banks, T), ba = merge(B.banks, A.banks, T);
    if (!ab.ok || !ba.ok) { bad.ok++; continue; }
    if (SM.stateKey(ab.v) !== SM.stateKey(ba.v)) { bad.comm++; if (!example) example = 'comm ' + J([A.banks, B.banks]); }
    const self = merge(ab.v, ab.v, T);
    if (!self.sameAsLocal || !self.sameAsCloud) { bad.idem++; if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, J({ A: A.banks, B: B.banks, C: C.banks, T })); }
    if (!merge(ab.v, A.banks, T).sameAsLocal || !merge(ab.v, B.banks, T).sameAsLocal) { bad.absorb++; if (!example) example = 'absorb ' + J([A.banks, B.banks, ab.v]); }
    /* 不會少:兩份裡沒被刪掉的字都在。「可以刪」用產生資料時記下的(DEL:刪的那台刪之前出現過的每一個版本),不用實作的標記函式:
       字的這個版本出現在某一台刪它之前;題庫的這一份(或拿掉可以刪的字之後的樣子)出現在某一台刪題庫之前 */
    const want = new Set(), live = [];
    [A.banks, B.banks].forEach(bs => bs.forEach(bk => {
      const gone = w => (DEL.w.get(bk.id + '|' + key(w.en)) || new Set()).has(wc(w));
      const left = bk.words.filter(w => !gone(w));
      const db = DEL.b.get(bk.id) || new Set();
      if (db.has(bc(bk)) || db.has(bc(Object.assign({}, bk, { words: left })))) return;
      left.forEach(w => want.add(bk.id + '|' + key(w.en)));
      live.push([bk.id, new Set(left.map(wc))]);
    }));
    const got = wordSet(ab.v);
    const miss = [...want].filter(k => !got.has(k));
    if (miss.length) { bad.loss++; if (!example) example = 'loss ' + miss.join(',') + ' ' + J([A.banks, B.banks, T]); }
    /* 兩份都一樣、都沒被刪的字(含同一個英文出現兩次的舊資料):結果裡原樣在(同一個 en、zh、勾選),一個都不能合掉 */
    const outW = new Set();
    ab.v.forEach(bk => bk.words.forEach(w => outW.add(bk.id + '|' + wc(w))));
    live.filter(([id]) => live.filter(x => x[0] === id).length === 2).forEach(([id, ws]) => {
      const other = live.find(x => x[0] === id && x[1] !== ws)[1];
      ws.forEach(c => { if (other.has(c) && !outW.has(id + '|' + c)) { bad.kept++; if (!example) example = 'kept ' + id + ' ' + c; } });
    });
    /* 三份不同順序合併,再互相合併一次就收斂(兩台各自用不同順序合併過,碰面一次之後就一樣) */
    const r1 = merge(ab.v, C.banks, T).v, r2 = merge(A.banks, merge(B.banks, C.banks, T).v, T).v;
    const j = merge(r1, r2, T).v;
    if (!merge(j, r1, T).sameAsLocal || !merge(j, r2, T).sameAsLocal) { bad.conv++; if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, J({ A: A.banks, B: B.banks, C: C.banks, T })); }
  }
  check('隨機 ' + N + ' 組:都能合併(ok)', bad.ok === 0, J(bad));
  check('隨機:交換律(兩邊順序內容一樣)', bad.comm === 0, bad.comm + ' 組不同 ' + example.slice(0, 300));
  check('隨機:冪等(自己跟自己合併不變)', bad.idem === 0, bad.idem + ' 組');
  check('隨機:吸收(合併結果再跟任一份合併不變,兩台不會一直互傳)', bad.absorb === 0, bad.absorb + ' 組 ' + (example.indexOf('absorb') === 0 ? example.slice(0, 400) : ''));
  check('隨機:不會少(沒被刪掉的字都在;答案用產生資料時記下的刪除,不用實作的標記函式)', bad.loss === 0, bad.loss + ' 組 ' + (example.indexOf('loss') === 0 ? example.slice(0, 400) : ''));
  check('隨機:兩份都一樣的字原樣留著(含同一個英文出現兩次的舊資料,' + dupRuns + ' 組有)', bad.kept === 0 && dupRuns > 50, bad.kept + ' 組 ' + (example.indexOf('kept') === 0 ? example.slice(0, 300) : ''));
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
  check('模擬考紀錄:合併不照 mock.js 的 30 筆裁(兩份 25 筆不同的都留,最後一筆是最新的)', m3.v.length === 50 && m3.v[49].d.indexOf('2026-11-25') === 0, m3.v.length + ' 筆');
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
  check('新字只多 _r(4 碼):不寫 on(沒寫就是勾選)、不寫 _t(題庫才不會變大)', typeof w._r === 'string' && w._r.length === 4 && !('_t' in w) && !('on' in w) && J(Object.keys(w)) === J(['en', 'zh', '_r']), J(w));
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

/* ---------- 9. 第二輪審查(2026-10-25)找到的會丟資料的情況 ---------- */
(function nameClock() {
  /* A 建題庫,B 拿到一樣的一份;B 改名時 B 的時鐘慢(或 A 建立時 A 的時鐘快):B 的 _nt 比 A 小,但 B 的那一份吸收過 A 的(新版本) */
  const run = (aSkew, bSkew, bLater) => {
    const id = 'b1';
    const A = SM.editBank([], id, T0 + aSkew, b => SM.addWords(Object.assign({}, b, { name: '商用單字' }), [{ en: 'invoice', zh: '發票' }], T0 + aSkew));
    const B = SM.editBank(clone(A), id, T0 + bLater + bSkew, b => Object.assign({}, b, { name: '期中考範圍' }));
    const m1 = merge(B, A), m2 = merge(A, B);
    const again = merge(m1.v, B);
    return [m1.v[0].name, m2.v[0].name, again.v[0].name];
  };
  const cases = [['時鐘都準', 0, 0, 2 * DAY], ['B 的時鐘慢 3 天', 0, -3 * DAY, 2 * DAY], ['A 建立時時鐘快 3 天', 3 * DAY, 0, 2 * DAY], ['B 晚 30 秒改名、時鐘慢 1 分鐘', 0, -60e3, 30e3]];
  const out = cases.map(c => [c[0], run(c[1], c[2], c[3])]);
  check('題庫名稱:另一份是我的舊版本時用我的名稱(不看 _nt),時鐘慢或快的裝置改的名稱不會被退回', out.every(x => x[1].every(n => n === '期中考範圍')), J(out));
  /* 兩份都不是對方的舊版本(兩台同時改名):照舊用 _nt 大的,兩邊順序一樣 */
  const base = SM.editBank([], 'b1', T0, b => Object.assign({}, b, { name: '原名' }));
  const X = SM.editBank(clone(base), 'b1', T0 + 1000, b => Object.assign({}, b, { name: '甲' }));
  const Y = SM.editBank(clone(base), 'b1', T0 + 2000, b => Object.assign({}, b, { name: '乙' }));
  check('兩台同時改名(誰都不是誰的舊版本):_nt 大的那個,兩邊順序一樣', merge(X, Y).v[0].name === '乙' && merge(Y, X).v[0].name === '乙', merge(X, Y).v[0].name);
})();

(function mockClock() {
  const rec = (d, s) => ({ d, size: 'full', lRaw: s, lTotal: 100, rRaw: s, rTotal: 100, lScore: s * 4, rScore: s * 4 });
  const cloud = Array.from({ length: 30 }, (_, i) => rec(new Date(Date.parse('2026-09-01T01:00:00Z') + i * DAY).toISOString(), 40 + i));
  const fresh = rec('2026-01-01T00:00:00.000Z', 77);   // 時鐘錯了的手機剛考完的那一筆
  const local = cloud.slice(1).concat([fresh]);          // mock.js:push 後 slice(-30)
  const m = SM.mock(freeze(clone(local)), freeze(clone(cloud)));
  const has = arr => arr.some(r => r.d === fresh.d && r.lRaw === 77);
  const m2 = SM.mock(freeze(clone(cloud)), freeze(clone(local)));
  const again = SM.mock(freeze(clone(m.v)), freeze(clone(cloud)));
  check('模擬考紀錄:時鐘錯的裝置剛考完的那一筆(日期比雲端 30 筆都舊)合併後還在,也要上傳(跟雲端不同)',
    m.ok && has(m.v) && !m.sameAsCloud && has(m2.v) && J(m.v) === J(m2.v) && again.sameAsLocal, m.v.length + ' 筆 / 有那一筆 ' + has(m.v));
  const big = Array.from({ length: 400 }, (_, i) => rec(new Date(Date.parse('2026-01-01T00:00:00Z') + i * 36e5).toISOString(), i % 100));
  const mb = SM.mock(big.slice(0, 250), big.slice(150));
  check('模擬考紀錄:合併最多留 300 筆(依時間留最新的;單鍵大小不會一直長)', mb.v.length === 300 && mb.v[299].d === big[399].d && mb.v[0].d === big[100].d, mb.v.length + ' 筆');
})();

(function altKeep() {
  /* 審查 r5:同一個字已經有 3 個 alt(之前幾輪兩台同時改中文留下的),再一輪同時改:兩台寫的中文都要留著 */
  const edit = (banks, zh, t) => SM.editBank(banks, 'b1', t, b => SM.setWord(b, 'issue', { zh }, t));
  let cloud = SM.editBank([], 'b1', T0, b => SM.addWords(Object.assign({}, b, { name: 'x' }), [{ en: 'issue', zh: '問題' }], T0));
  const rounds = [['一期', '核發'], ['發行', '課題'], ['核准', '議題']];
  let t = T0;
  rounds.forEach(([pc, ph]) => { t += 10000; const a = edit(clone(cloud), pc, t), b = edit(clone(cloud), ph, t + 1000); cloud = merge(a, b).v; });
  const seen = w => [w.zh].concat(w.alt || []);
  const before = findWord(cloud, 'b1', 'issue');
  const lost = [];
  if (!before.alt || before.alt.length < 3) lost.push('起始狀態不到 3 個 alt:' + J(before));
  for (const [mine, theirs] of [['議程', '爭議點'], ['安排', '爭議點']]) {
    const a = edit(clone(cloud), mine, t + 50000), b = edit(clone(cloud), theirs, t + 60000);
    const m = merge(a, b), m2 = merge(b, a);
    const w = findWord(m.v, 'b1', 'issue');
    const want = (before.alt || []).concat([mine, theirs]);
    want.forEach(z => { if (seen(w).indexOf(z) < 0) lost.push(mine + '那一輪少了 ' + z); });
    if (SM.stateKey(m.v) !== SM.stateKey(m2.v)) lost.push('順序不同');
  }
  check('alt 不設上限:同一個字第 4 個以後的不同中文也留著(不會丟學生打的中文)', !lost.length, '不見的:' + J(lost));
})();

(function altAlternate() {
  /* 審查 repro_alt2:兩台輪流改同一個字的中文,每次照 cloud.js 的流程上傳(本機改 → 跟雲端合併 → 寫回本機 → 上傳),中間沒重開頁面。
     學生打過、而且沒有在自己畫面上被換掉的中文(那台改的時候畫面上的主要中文才算「換掉」),最後雲端和兩台都要看得到 */
  const runSeq = (labels, order) => {
    let cloud = SM.editBank([], 'b1', T0, b => SM.addWords(Object.assign({}, b, { name: 'x' }), [{ en: 'run', zh: '跑' }], T0));
    const local = { A: clone(cloud), B: clone(cloud) };
    const replaced = new Set(['跑']);
    let t = T0;
    labels.forEach((zh, i) => {
      const d = order[i];
      t += 60000;
      replaced.add(findWord(local[d], 'b1', 'run').zh);
      local[d] = SM.editBank(local[d], 'b1', t, b => SM.setWord(b, 'run', { zh }, t));
      const m = SM.banks(local[d], cloud, { now: t, tombs: null });
      local[d] = m.v; cloud = m.v;
    });
    ['A', 'B'].forEach(d => { local[d] = SM.banks(local[d], cloud, { now: t + 1, tombs: null }).v; });
    const lost = [];
    labels.filter(z => !replaced.has(z)).forEach(z => {
      [['雲端', cloud], ['A', local.A], ['B', local.B]].forEach(([where, banks]) => {
        const w = findWord(banks, 'b1', 'run');
        if ([w.zh].concat(w.alt || []).indexOf(z) < 0) lost.push(where + ':' + z);
      });
    });
    return lost;
  };
  const fixed = runSeq(['A1', 'B2', 'A3', 'B4', 'A5', 'B6', 'A7', 'B8'], 'ABABABAB');
  const real = runSeq(['奔跑', '跑步', '經營', '執行', '運轉', '競選'], 'ABABAB');
  let randLost = 0, example = '';
  const pool = ['奔跑', '跑步', '經營', '執行', '運轉', '競選', '管理', '流動', '進行', '參選', '運行', '延續'];
  for (let n = 0; n < 300; n++) {
    const k = 3 + Math.floor(rand() * 6);
    const labels = [], order = [];
    for (let i = 0; i < k; i++) { labels.push(pool[(n + i * 5) % pool.length] + i); order.push(chance(0.5) ? 'A' : 'B'); }
    const l = runSeq(labels, order.join(''));
    if (l.length) { randLost++; if (!example) example = J({ labels, order: order.join(''), l }); }
  }
  check('兩台輪流改同一個字的中文:沒被自己換掉的中文(含另一台最新寫的)雲端和兩台都還在;隨機 300 組',
    !fixed.length && !real.length && !randLost, J({ fixed, real, randLost, example }));
})();

(function markNeeded() {
  /* _m(合併記號):兩台各自建了同一個文章題庫,字是同一份(只差題庫的 _r),合併結果跟其中一份(X,_t 比較新)一模一樣的話,
     X 的那台之後刪掉題庫時(標記記的是 X 的雜湊),連另一台建的也一起刪掉。有 _m 就跟兩份都不同,不會被刪 */
  const words = [{ en: 'refund', zh: '退款', on: true }];
  const X = [{ id: 'art_1', name: '文章：一', words, _r: 'xxxxxx', _t: T0 + 10000, _nt: T0 + 10000 }];
  const Y = [{ id: 'art_1', name: '文章：一', words, _r: 'yyyyyy', _t: T0, _nt: T0 }];
  const M = merge(Y, X).v;
  const del = SM.deleteBank(X, null, 'art_1', T0 + 20000);
  const after = SM.banks(M, del.banks, { now: T0 + 30000, tombs: del.tombs });
  check('合併記號 _m:合併結果跟其中一份一模一樣時,刪掉那一份的標記不會刪到合併結果', SM.bankHash(M[0]) !== SM.bankHash(X[0]) && SM.bankHash(M[0]) !== SM.bankHash(Y[0])
    && bankIds(after.v).has('art_1'), J({ hM: SM.bankHash(M[0]), hX: SM.bankHash(X[0]), hY: SM.bankHash(Y[0]), after: [...bankIds(after.v)] }));
})();

(function stripKeepsP() {
  /* stripWords 的 _p:X 刪字;Y 還是舊題庫 P,只收到標記,拿掉那個字之後又刪掉整個題庫(標記記的是拿掉字之後的樣子和它的 _p);
     Z 很久沒開,手上還是 P,字的標記過期了(400 天)、題庫的標記還在:P 不能回來 */
  const id = 'bdemo';
  let P = SM.editBank([], id, T0, b => Object.assign({}, b, { name: 'demo' }));
  P = SM.editBank(P, id, T0 + 1000, b => SM.addWords(b, [{ en: 'apple', zh: '蘋果' }, { en: 'banana', zh: '香蕉' }], T0 + 1000));
  const t1 = T0 + DAY;
  const dX = SM.deleteWord(P, null, id, 'apple', t1);
  const tY = SM.tombs(null, dX.tombs, t1 + DAY).v;
  const SY = SM.banks(P, P, { now: t1 + DAY, tombs: tY }).v;
  const dY = SM.deleteBank(SY, tY, id, t1 + 100 * DAY);
  const t4 = t1 + 401 * DAY;
  const tZ = SM.tombs(null, dY.tombs, t4).v;
  const bZ = SM.banks(P, dY.banks, { now: t4, tombs: tZ });
  check('拿掉被刪的字時題庫記下拿掉前那一版(_p):字的標記過期後,別台舊的那一版也對得上題庫的標記,刪掉的題庫不會回來',
    !tZ.vgame_banks.w[id] && !!tZ.vgame_banks.b[id] && !bankIds(bZ.v).has(id), J([...bankIds(bZ.v)]));
})();

(function sizeBudget() {
  /* 雲端單鍵 256 KB(progress_guard 量 octet_length(v::text),jsonb 的輸出:鍵去重、依長度再依位元組排序、冒號和逗號後面加空白)。
     新版的戳記不能讓題庫比 main 的格式大太多:批次加字剛匯入的大小最多是 main 的 1.05 倍,3000 字放得下 */
  const jtext = v => {
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) return '[' + v.map(jtext).join(', ') + ']';
    if (typeof v === 'object') {
      const ks = Object.keys(v).filter(k => v[k] !== undefined).sort((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)));
      return '{' + ks.map(k => JSON.stringify(k) + ': ' + jtext(v[k])).join(', ') + '}';
    }
    return JSON.stringify(v);
  };
  const size = v => Buffer.byteLength(jtext(v), 'utf8');
  const CJK = '營收交易政策規定事先協商發票退款截止日行程表會議預算合約客戶供應商員工訓練部門經理報告';
  const list = n => Array.from({ length: n }, (_, i) => {
    let en = '', zh = '';
    const el = 5 + (i * 7) % 8, zl = 2 + (i * 5) % 4;
    for (let j = 0; j < el; j++) en += String.fromCharCode(97 + ((i * 31 + j * 17 + Math.floor(i / 26)) % 26));
    for (let j = 0; j < zl; j++) zh += CJK.charAt((i * 13 + j * 7) % CJK.length);
    return { en: en + i.toString(36), zh };
  });
  const now = T0;
  const words = list(3000);
  const mainFmt = [{ id: 'b' + now.toString(36), name: '多益單字', words: words.map(p => ({ en: p.en, zh: p.zh, on: true })) }];
  const ours = SM.editBank([], SM.newBankId(now), now, b => SM.addWords(Object.assign({}, b, { name: '多益單字' }), words, now));
  const a = size(mainFmt), b = size(ours);
  check('題庫大小:3000 字批次加字剛匯入,新版格式最多是 main 的 1.05 倍、在 256 KB 以內', b <= a * 1.05 && b <= 256 * 1024,
    'main ' + (a / 1024).toFixed(1) + ' KB / 新版 ' + (b / 1024).toFixed(1) + ' KB / 倍數 ' + (b / a).toFixed(3));
})();

/* ---------- 10. 第二輪審查(2026-10-25 r2)找到的 ---------- */
(function oldPageEdits() {
  /* 舊版頁面(main 的 vocab.js)改名、取消勾選、改中文都是就地改物件,_t、_nt、_p 原樣留著,只有內容雜湊變了。
     這台本機那份是改之前的(上次跟雲端對齊之後沒改過,帳本上沒有:localClean),雲端是舊版頁面改過的:要用雲端改的,不能退回。
     以前兩份分不出先後就比 canon 字串,舊名稱字串比較大時改名一定被退回(名稱沒有 alt,哪裡都找不到) */
  const legacy = [{ id: 'b1', name: 'Unit 1', words: [{ en: 'apple', zh: '蘋果', on: true }] }];
  const stamped = SM.editBank([], 'b1', T0, b => SM.addWords(Object.assign({}, b, { name: '第3課' }), [{ en: 'apple', zh: '蘋果' }], T0));
  const edits = [
    ['改名', (arr, base) => { arr[0].name = base === legacy ? 'Food' : '第3課 動物'; }, (v, base) => v[0].name === (base === legacy ? 'Food' : '第3課 動物')],
    ['取消勾選', arr => { arr[0].words[0].on = false; }, v => v[0].words[0].on === false],
    ['改中文', arr => { arr[0].words[0].zh = '一種水果'; }, v => v[0].words[0].zh === '一種水果'],
  ];
  const bad = [];
  [['舊資料', legacy], ['新版建的', stamped]].forEach(([label, base]) => edits.forEach(([what, fn, ok]) => {
    const edited = clone(base); fn(edited, base);
    const m = SM.banks(freeze(clone(base)), freeze(clone(edited)), { now: T0 + DAY, tombs: null, localClean: true });
    /* 舊版那台之後重新整理成新版、灌資料:本機是它改的那份(沒改過),雲端是上面的合併結果 */
    const back = SM.banks(freeze(clone(edited)), freeze(clone(m.v)), { now: T0 + 2 * DAY, tombs: null, localClean: true });
    const again = merge(m.v, base);
    if (!m.ok || !ok(m.v, base) || !ok(back.v, base) || !ok(again.v, base)) bad.push(label + what + ':' + J(m.v[0]).slice(0, 160));
  }));
  check('舊版頁面改的名稱、取消勾選、中文:本機沒改過(localClean)時用雲端那份,不會被退回,之後也不會被改回來', !bad.length, J(bad));
  /* localClean 只在分不出先後時才用:本機在新版改過名(已經傳上去),雲端是舊版頁面整份上傳的舊快照(只多一個字):改名留著、字都在 */
  const renamed = SM.editBank(clone(stamped), 'b1', T0 + 1000, b => Object.assign({}, b, { name: '新名字' }));
  const staleOld = clone(stamped); staleOld[0].words.push({ en: 'pear', zh: '梨', on: true });
  const m2 = SM.banks(freeze(clone(renamed)), freeze(clone(staleOld)), { now: T0 + DAY, tombs: null, localClean: true });
  check('localClean 不會讓雲端的舊快照蓋掉本機在新版改過的名稱', m2.v[0].name === '新名字' && wordSet(m2.v).has('b1|pear') && wordSet(m2.v).has('b1|apple'), J(m2.v[0]).slice(0, 200));
  /* 雲端被舊版頁面改中文、本機沒改過:新中文當主要,舊的中文也不丟(在 alt) */
  const zhEdited = clone(legacy); zhEdited[0].words[0].zh = '一種水果';
  const m3 = SM.banks(freeze(clone(legacy)), freeze(clone(zhEdited)), { now: T0, tombs: null, localClean: true });
  const w3 = m3.v[0].words[0];
  check('localClean 改中文:雲端的新中文當主要,本機的舊中文留在 alt(不少)', w3.zh === '一種水果' && J(w3.alt) === J(['蘋果']), J(w3));
})();

(function renameClockConcurrent() {
  /* 審查 r2 #2:只有一台改了名、另一台同時改了同一個題庫的字(誰都不是誰的新版本):不能比 _nt。
     建立題庫那台時鐘快(建立時的 _nt 在未來)、或改名那台時鐘慢,以前改名都會被退回 */
  const MIN = 60e3;
  const run = (creatorSkew, renamerSkew, how) => {
    const A = SM.editBank([], 'b1', T0 + creatorSkew, b => SM.addWords(Object.assign({}, b, { name: '第3課' }), [{ en: 'apple', zh: '蘋果' }], T0 + creatorSkew));
    const tr = T0 + 2 * MIN + renamerSkew;
    const R = SM.editBank(clone(A), 'b1', tr, b => Object.assign({}, b, { name: '第3課 動物' }));
    const tc = T0 + 3 * MIN + creatorSkew;
    const A2 = how === 'add' ? SM.editBank(clone(A), 'b1', tc, b => SM.addWords(b, [{ en: 'dog', zh: '狗' }], tc))
      : SM.editBank(clone(A), 'b1', tc, b => SM.setWord(b, 'apple', { zh: '紅蘋果' }, tc));
    const m1 = merge(R, A2), m2 = merge(A2, R);
    return [m1.v[0].name, m2.v[0].name, merge(m1.v, A2).v[0].name, merge(m1.v, R).v[0].name, m1.v[0].words.length];
  };
  const cases = [['時鐘都準、另一台加字', 0, 0, 'add'], ['建立那台快 10 分鐘、之後加字', 10 * MIN, 0, 'add'], ['建立那台快 10 分鐘、之後改中文', 10 * MIN, 0, 'zh'],
    ['改名那台慢 10 分鐘、另一台加字', 0, -10 * MIN, 'add']];
  const out = cases.map(c => [c[0], run(c[1], c[2], c[3])]);
  check('只有一台改名、另一台同時改字:改名留著(不管時鐘快慢),兩邊順序一樣、再合併也不變', out.every(x => x[1].slice(0, 4).every(n => n === '第3課 動物')), J(out));
  /* 兩台真的同時改名(都從同一個名稱改):還是比 _nt;另一台把名稱改回原名也算改名 */
  const base = SM.editBank([], 'b1', T0, b => Object.assign({}, b, { name: '原名' }));
  const X = SM.editBank(clone(base), 'b1', T0 + 1000, b => SM.addWords(Object.assign({}, b, { name: '甲' }), [{ en: 'x', zh: 'ㄨ' }], T0 + 1000));
  const Y = SM.editBank(clone(base), 'b1', T0 + 2000, b => SM.addWords(Object.assign({}, b, { name: '乙' }), [{ en: 'y', zh: 'ㄧ' }], T0 + 2000));
  check('兩台都改了名(同時):_nt 大的,兩邊順序一樣', merge(X, Y).v[0].name === '乙' && merge(Y, X).v[0].name === '乙', merge(X, Y).v[0].name + ' / ' + merge(Y, X).v[0].name);
})();

(function loserAlt() {
  /* 審查 r2 #5:三台。輸的那一份(q)帶著之前衝突留下的 alt,合併時那些 alt 要留著(不能只留主要那份的 alt) */
  const edit = (banks, zh, t) => SM.editBank(clone(banks), 'b1', t, b => SM.setWord(b, 'issue', { zh }, t));
  const base = SM.editBank([], 'b1', T0, b => SM.addWords(Object.assign({}, b, { name: 'x' }), [{ en: 'issue', zh: '問題' }], T0));
  const pc = edit(base, '議題', T0 + 10000), phone = edit(base, '發行', T0 + 20000);
  let cloud = merge(pc, base).v;
  cloud = merge(phone, cloud).v;                       // 雲端:發行(主要)+ alt 議題
  const tablet = edit(base, '核發', T0 + 30000);       // 平板還是 base,之後改(_t 最新,當主要)
  const r1 = merge(tablet, cloud).v, r2 = merge(cloud, tablet).v;
  const pcAgain = merge(cloud, r1).v;
  const seen = v => { const w = findWord(v, 'b1', 'issue'); return [w.zh].concat(w.alt || []); };
  const lost = ['核發', '發行', '議題'].filter(z => [r1, r2, pcAgain].some(v => seen(v).indexOf(z) < 0));
  check('三台輪流改同一個字的中文:輸的那份身上之前留下的 alt 也留著(不只主要那份的 alt)', !lost.length && SM.stateKey(r1) === SM.stateKey(r2), '少了 ' + J(lost) + ' / ' + J(seen(r1)));
})();

(function changeBack() {
  /* test_sync_fuzz 的中文檢查找到的(seed 66 B 7719918;審查 r2 #7 也提過):手機時鐘快 3 小時,12:10 把「退款」改成「退錢」;
     電腦時鐘準,拿到之後 12:30 改回「退款」(跟以前某一版一模一樣)。兩份互相在對方的 _p 裡,以前用 _t 大的(手機的「退錢」)、
     不留 alt,電腦後來打的「退款」哪裡都沒有了。現在 _t 大的當主要,另一個中文放 alt */
  const base = [{ id: 'b1', name: 'x', _r: 'rrrrrr', words: [{ en: 'refund', zh: '退款', _r: 'dc43' }] }];
  const phoneT = T0 + 10 * 60e3 + 3 * 3600e3;
  const phone = SM.editBank(clone(base), 'b1', phoneT, b => SM.setWord(b, 'refund', { zh: '退錢' }, phoneT));
  const pcT = T0 + 30 * 60e3;
  const pcMarked = SM.editBank(clone(phone), 'b1', pcT, b => SM.setWord(b, 'refund', { zh: '退款' }, pcT));
  const pc = unmark(pcMarked, base);   // 第三輪起改內容會換 _r,改回去跟以前一模一樣時才會互相吸收過
  const m1 = merge(pc, phone), m2 = merge(phone, pc);
  const seen = v => { const w = findWord(v.v, 'b1', 'refund'); return [w.zh].concat(w.alt || []).sort().join(); };
  check('改回以前的中文(兩份互相吸收過)、改回去那台時鐘慢:兩個中文都留(一個在 alt),順序無關、再合併不變',
    seen(m1) === '退款,退錢' && SM.stateKey(m1.v) === SM.stateKey(m2.v) && merge(m1.v, pc).sameAsLocal && merge(m1.v, phone).sameAsLocal, seen(m1) + ' / ' + seen(m2));
  check('改回以前的中文、新版(改內容換 _r):電腦改回的「退款」是新版本(不管時鐘),順序無關', seen(merge(pcMarked, phone)) === '退款' && seen(merge(phone, pcMarked)) === '退款', seen(merge(pcMarked, phone)));
})();

(function revertMark() {
  /* 第三輪(test_sync_fuzz 加了「學生又打回以前的中文」的檢查後找到的):改回以前某一版的內容(雜湊一樣),會被當成那個舊版本:
     1. 電腦改回「跑」、手機同時把「跑步」改成「慢跑」:慢跑的 _p 裡有原本「跑」的雜湊,電腦改回的「跑」被當成舊版本拿掉;
     2. 手機刪了 run(標記記的是原本「跑」的雜湊),電腦拿到別台改的版本後又改回「跑」:被那個刪除標記刪掉。
     3. 兩台各自把「跑」改成「跑步」,其中一台再改成「慢跑」:另一台的「跑步」跟慢跑 _p 裡的那一版同一個雜湊,被當成舊版本拿掉。
     現在改內容會換 _r(算進內容雜湊),每一版都是新的版本 */
  const legacy = [{ id: 'b1', name: 'x', _r: 'rrrrrr', words: [{ en: 'run', zh: '跑', on: true }] }];
  const t1 = T0 + 60e3, t2 = T0 + 120e3, t3 = T0 + 180e3;
  const B = SM.editBank(clone(legacy), 'b1', t1, b => SM.setWord(b, 'run', { zh: '跑步' }, t1));
  const back = SM.editBank(clone(B), 'b1', t2, b => SM.setWord(b, 'run', { zh: '跑' }, t2));
  const jog = SM.editBank(clone(B), 'b1', t3, b => SM.setWord(b, 'run', { zh: '慢跑' }, t3));
  const seen = v => { const w = findWord(v, 'b1', 'run'); return w ? [w.zh].concat(w.alt || []).sort().join() : '(沒有 run)'; };
  const r1 = merge(back, jog).v, r2 = merge(jog, back).v;
  check('改回以前的中文、另一台同時改成別的:改回的不會被當成舊版本拿掉,兩個中文都留(一個在 alt),順序無關、再合併不變',
    SM.wordHash(back[0].words[0]) !== SM.wordHash(legacy[0].words[0]) && seen(r1) === '慢跑,跑' && SM.stateKey(r1) === SM.stateKey(r2)
    && merge(r1, back).sameAsLocal && merge(r1, jog).sameAsLocal, seen(r1) + ' / ' + seen(r2));
  check('改回以前的中文、沒有別台同時改:改回的那一份是新版本(用它,不多 alt);沒改到內容照樣原樣回',
    seen(merge(back, B).v) === '跑' && seen(merge(B, back).v) === '跑' && SM.reviseWord(back[0].words[0], { zh: '跑' }, t3) === back[0].words[0], seen(merge(back, B).v));
  const del = SM.deleteWord(clone(legacy), null, 'b1', 'run', t1);
  const again = SM.editBank(clone(B), 'b1', t2, b => SM.setWord(b, 'run', { zh: '跑' }, t2));
  const r3 = merge(again, del.banks, del.tombs).v, r4 = merge(del.banks, again, del.tombs).v;
  check('一台刪了字、另一台拿到別台改的版本後又改回原本的中文:不會被那個刪除標記刪掉(刪的是刪的時候那個樣子)',
    seen(r3) === '跑' && seen(r4) === '跑' && seen(merge(legacy, del.banks, del.tombs).v) === '(沒有 run)', seen(r3) + ' / ' + seen(r4));
  const other = SM.editBank(clone(legacy), 'b1', t2, b => SM.setWord(b, 'run', { zh: '跑步' }, t2));
  const jog2 = SM.editBank(clone(B), 'b1', t3, b => SM.setWord(b, 'run', { zh: '慢跑' }, t3));
  const r5 = merge(other, jog2).v, r6 = merge(jog2, other).v;
  check('兩台各自打了同一個中文、其中一台之後又改掉:另一台打的不會被當成舊版本拿掉,順序無關、再合併不變',
    seen(r5) === '慢跑,跑步' && SM.stateKey(r5) === SM.stateKey(r6) && merge(r5, other).sameAsLocal && merge(r5, jog2).sameAsLocal, seen(r5) + ' / ' + seen(r6));
})();

(function dupWords() {
  /* 審查 r2 #6:舊資料同一個題庫裡同一個英文出現兩次(run/跑、Run/經營):一台新版改名、一台舊版頁面就地加字,兩個都要留著 */
  const legacy = [{ id: 'b1', name: '第一課', words: [{ en: 'apple', zh: '蘋果', on: true }] },
    { id: 'b2', name: '舊題庫', words: [{ en: 'run', zh: '跑', on: true }, { en: 'Run', zh: '經營', on: true }] }];
  const A = SM.editBank(clone(legacy), 'b2', T0, b => Object.assign({}, b, { name: '舊題庫改名' }));
  const B = clone(legacy); B[1].words.push({ en: 'walk', zh: '走', on: true });
  const zhs = v => v.find(b => b.id === 'b2').words.map(w => w.zh).sort().join();
  const r1 = merge(A, B).v, r2 = merge(B, A).v, r3 = merge(A, legacy).v;
  check('同一個英文出現兩次的舊資料:兩個字都留(改名+舊版加字、只有改名)', zhs(r1) === '經營,走,跑' && zhs(r2) === zhs(r1) && zhs(r3) === '經營,跑',
    zhs(r1) + ' / ' + zhs(r2) + ' / ' + zhs(r3));
  /* test_sync_fuzz 加了重複英文的舊資料後找到的(seed 8392968 B):一台取消勾選 run、另一台拿到之後又勾回來(內容跟原本一模一樣)。
     兩份 run 互相在對方的 _p 裡,以前重複英文那一組把「被吸收過的」都拿掉,兩份一起不見,run/跑 從雲端和本機消失 */
  const off = SM.editBank(clone(legacy), 'b2', T0 + 1000, b => SM.setWord(b, 'run', { on: false }, T0 + 1000));
  const backOn = SM.editBank(clone(off), 'b2', T0 + 5000, b => SM.setWord(b, 'run', { on: true }, T0 + 5000));
  const runs = v => v.find(b => b.id === 'b2').words.filter(w => w.zh === '跑').map(w => w.on !== false);
  const t1 = merge(off, backOn).v, t2 = merge(backOn, off).v;
  check('同一個英文出現兩次的舊資料:取消勾選又勾回來(內容跟原本一樣、兩份互相吸收過)合併後那個字還在,用 _t 新的那份', J(runs(t1)) === '[true]' && J(runs(t2)) === '[true]'
    && zhs(t1) === '經營,跑' && merge(t1, off).sameAsLocal && merge(t1, backOn).sameAsLocal, J(runs(t1)) + ' / ' + J(runs(t2)) + ' / ' + zhs(t1));
  /* 第二輪摘要發現(第三輪修):重複英文的舊資料裡,手機時鐘快 3 小時把 run 的「跑」改成「跑步」;電腦時鐘準,拿到之後改回「跑」
     (跟舊資料一模一樣,兩份互相吸收過)。以前重複英文那一組只留 _t 大的(手機的「跑步」),電腦改回的「跑」沒放 alt,哪裡都沒有了。
     跟英文只出現一次的 changeBack 一樣:主要那個留著,輸的中文放 alt */
  const phoneT = T0 + 10 * 60e3 + 3 * 3600e3, pcT = T0 + 30 * 60e3;
  const phone = SM.editBank(clone(legacy), 'b2', phoneT, b => SM.setWord(b, 'run', { zh: '跑步' }, phoneT));
  const pcMarked = SM.editBank(clone(phone), 'b2', pcT, b => SM.setWord(b, 'run', { zh: '跑' }, pcT));
  const pc = unmark(pcMarked, legacy);   // 改回去跟以前一模一樣才會互相吸收過(新版會換 _r,見下面)
  const allZh = v => v.find(b => b.id === 'b2').words.map(w => [w.zh].concat(w.alt || [])).reduce((p, q) => p.concat(q), []).sort().join();
  const c1 = merge(pc, phone).v, c2 = merge(phone, pc).v;
  const c3 = merge(merge(pc, legacy).v, phone).v, c4 = merge(pc, merge(phone, legacy).v).v;
  check('同一個英文出現兩次的舊資料:改回以前的中文、改回去那台時鐘慢:兩個中文都留(一個在 alt),經營也在,順序無關、再合併不變',
    allZh(c1) === '經營,跑,跑步' && SM.stateKey(c1) === SM.stateKey(c2) && SM.stateKey(c1) === SM.stateKey(c3) && SM.stateKey(c1) === SM.stateKey(c4)
    && merge(c1, pc).sameAsLocal && merge(c1, phone).sameAsLocal && merge(c1, legacy).sameAsLocal && merge(c1, c2).sameAsLocal
    && c1.find(b => b.id === 'b2').words.length === 2, allZh(c1) + ' / ' + allZh(c2) + ' / ' + J(c1.find(b => b.id === 'b2').words));
  const e1 = merge(pcMarked, phone).v, e2 = merge(phone, pcMarked).v;
  check('同一個英文出現兩次的舊資料:改回以前的中文、新版(改內容換 _r):電腦改回的「跑」是新版本,經營也在,順序無關',
    allZh(e1) === '經營,跑' && SM.stateKey(e1) === SM.stateKey(e2) && e1.find(b => b.id === 'b2').words.length === 2, allZh(e1) + ' / ' + allZh(e2));
  /* 再一台:手機那份拿去改成「慢跑」(時鐘更快),另一台拿到「慢跑」之後改回「跑步」(時鐘慢)。慢跑是那台學生自己換掉的,可以不在;
     電腦改回的「跑」和改回「跑步」的都要在 */
  const p2T = T0 + 3600e3 * 5, p3T = T0 + 3600e3;
  const jog = SM.editBank(clone(phone), 'b2', p2T, b => SM.setWord(b, 'run', { zh: '慢跑' }, p2T));
  const back = SM.editBank(clone(jog), 'b2', p3T, b => SM.setWord(b, 'run', { zh: '跑步' }, p3T));
  const d1 = merge(merge(pcMarked, back).v, jog).v, d2 = merge(jog, merge(back, pcMarked).v).v;   // 再合併不變只看最後一次合併的兩份(三份以上不保證,見檔頭)
  const lostD = ['跑', '跑步', '經營'].filter(z => allZh(d1).split(',').indexOf(z) < 0 || allZh(d2).split(',').indexOf(z) < 0);
  check('同一個英文出現兩次的舊資料:三台輪流改、兩台改回以前的中文:沒被自己換掉的中文都還在,順序無關、再合併不變',
    !lostD.length && SM.stateKey(d1) === SM.stateKey(d2) && merge(d1, merge(pcMarked, back).v).sameAsLocal && merge(d1, jog).sameAsLocal,
    '少了 ' + J(lostD) + ' / ' + allZh(d1) + ' / ' + allZh(d2));
})();

/* ---------- 11. 第三輪審查(2026-10-25 r3)找到的 ---------- */
const renameTo = name => b => Object.assign({}, b, { name });
const addInvoice = t => b => SM.addWords(b, [{ en: 'invoice', zh: '發票' }], t);
/* 上傳/對齊:本機跟雲端合併,兩邊都存合併結果(cloud.js 的 uploadMerged、syncKey) */
function syncTo(state, dev, clean) {
  const m = SM.banks(freeze(clone(state[dev])), freeze(clone(state.cloud)), { now: T0, tombs: null, localClean: clean });
  state[dev] = clone(m.v); state.cloud = clone(m.v);
}
(function nameRevertBack() {
  /* r3 #1:B 把題庫名稱 甲→丙 並上傳,A 對齊拿到「丙」、之後加字;B 再把名稱改回「甲」(字沒動)並上傳,然後 A 上傳。
     以前題庫的 _r 改名時不換,改回的那一版跟第一版雜湊一樣:A 的 _p 有第一版,A 被當成新版本、用 A 的「丙」,
     B 最後改的「甲」每台和雲端都不見了(時鐘準也會) */
  const run = (aSkew, bSkew, addBeforeRevert) => {
    const s = { cloud: [SM.newBank('b', '甲', T0 - DAY)] };
    s.A = clone(s.cloud); s.B = clone(s.cloud);
    s.B = SM.editBank(s.B, 'b', T0 + 60e3 + bSkew, renameTo('丙')); syncTo(s, 'B', false);
    syncTo(s, 'A', true);
    const tA = T0 + 120e3 + aSkew;
    if (addBeforeRevert) s.A = SM.editBank(s.A, 'b', tA, addInvoice(tA));
    s.B = SM.editBank(s.B, 'b', T0 + 180e3 + bSkew, renameTo('甲')); syncTo(s, 'B', false);
    if (!addBeforeRevert) s.A = SM.editBank(s.A, 'b', tA + 120e3, addInvoice(tA + 120e3));   // A 的頁面一直開著,沒重新對齊就加字
    const other = SM.banks(freeze(clone(s.cloud)), freeze(clone(s.A)), { now: T0, tombs: null }).v[0].name;
    syncTo(s, 'A', false);
    syncTo(s, 'B', true);
    return [s.cloud[0].name, s.A[0].name, s.B[0].name, other, s.cloud[0].words.some(w => w.en === 'invoice')];
  };
  const cases = [['時鐘都準、A 加字後還沒上傳', 0, 0, true], ['時鐘都準、B 先改回並上傳、A 之後才加字', 0, 0, false],
    ['A 快 1 小時', 3600e3, 0, true], ['B 慢 1 小時', 0, -3600e3, false]];
  const out = cases.map(c => [c[0], run(c[1], c[2], c[3])]);
  check('新版頁面把題庫名稱改回原本的名稱、別台有沒上傳的加字:改回的名稱留著(每台和雲端),字也在,兩邊順序一樣',
    out.every(x => x[1].slice(0, 4).every(n => n === '甲') && x[1][4]), J(out));
  const b0 = SM.newBank('b', '甲', T0);
  const b1 = SM.editBank([b0], 'b', T0 + 1000, renameTo('丙'));
  const b2 = SM.editBank(b1, 'b', T0 + 2000, renameTo('甲'));
  check('題庫改到內容就換 _r:改回以前的名稱,雜湊跟以前那一版不同', SM.bankHash(b2[0]) !== SM.bankHash(b0) && b2[0]._r !== b0._r, b0._r + ' / ' + b2[0]._r);
})();

(function nameTwoRenames() {
  /* r3 #2:題庫在時鐘快的 A 建立(_nt 在未來);B 在 10 分鐘後連改兩次名(打錯字馬上改正);A 還停在原本的名稱、加了字。
     以前 _on 只記上一個名稱,認不出「只有 B 改名」,退回比 _nt,B 的改名被退回、找不回來 */
  const run = (aSkew, bSkew, names, uploadEach) => {
    const s = { cloud: SM.editBank([], 'b1', T0 + aSkew, renameTo('多益')) };
    s.A = clone(s.cloud); s.B = clone(s.cloud);
    names.forEach((n, i) => {
      s.B = SM.editBank(s.B, 'b1', T0 + 600e3 + i * 10e3 + bSkew, renameTo(n));
      if (uploadEach || i === names.length - 1) syncTo(s, 'B', false);
    });
    const tA = T0 + 900e3 + aSkew;
    s.A = SM.editBank(s.A, 'b1', tA, addInvoice(tA));
    const other = SM.banks(freeze(clone(s.cloud)), freeze(clone(s.A)), { now: T0, tombs: null }).v[0].name;
    syncTo(s, 'A', false);
    syncTo(s, 'B', true);
    return [s.cloud[0].name, s.B[0].name, other, s.cloud[0].words.some(w => w.en === 'invoice')];
  };
  const H1 = 3600e3, two = ['多益單子', '多益單字'];
  const cases = [['A 快 1 小時、B 改兩次每次都上傳', H1, 0, two, true], ['A 快 1 小時、B 改兩次中間沒上傳', H1, 0, two, false],
    ['B 慢 1 小時、改兩次', 0, -H1, two, true], ['A 快 1 小時、B 改三次', H1, 0, ['多益單子', '多益單', '多益單字'], true],
    ['A 快 1 小時、B 只改一次', H1, 0, ['多益單字'], true], ['時鐘都準、改兩次', 0, 0, two, true]];
  const out = cases.map(c => [c[0], run(c[1], c[2], c[3], c[4])]);
  check('同一台在兩次同步之間連改幾次名、另一台(時鐘快)同時加字:最後改的名稱留著,字也在,兩邊順序一樣',
    out.every(x => x[1].slice(0, 3).every(n => n === '多益單字') && x[1][3]), J(out));
})();

(function nameCausalRandom() {
  /* 名稱的因果隨機測試(r3 審查者的 name_causal_fuzz):2 台新版(可加 1 台舊版頁面就地改名)隨機改名、加字、跟雲端對齊。
     改名是一個事件,記下那台當時知道的改名;最後全部對齊後,「沒有被別的改名知道的」改名只有一個、而且是新版頁面改的,
     最後的名稱一定是它(名稱沒有 alt,退回就找不回來;只有一個最新的改名時不能看時鐘)。最後每台新版跟雲端一樣 */
  const NAMES = ['甲', '乙', '丙'];
  const one = opts => {
    let clock = T0, evId = 0;
    const ren = new Map();
    const init = [SM.newBank('b', '甲', clock - DAY)];
    const cloud = { st: clone(init), K: new Set() };
    const mk = old => ({ old, st: clone(init), K: new Set(), dirty: false, skew: Math.floor((rand() - 0.5) * 2 * opts.skew) });
    const devs = [mk(false), mk(false)].concat(opts.three ? [mk(false)] : [], opts.old ? [mk(true)] : []);
    const log = [];
    const now = d => clock + d.skew;
    const sync = d => {
      const m = SM.banks(freeze(clone(d.st)), freeze(clone(cloud.st)), { now: now(d), tombs: null, localClean: !d.dirty });
      d.st = clone(m.v); cloud.st = clone(m.v);
      const U = new Set([...d.K, ...cloud.K]); d.K = U; cloud.K = new Set(U); d.dirty = false;
    };
    const nameOf = () => (opts.fresh ? '名' + (++evId * 7) : pick(NAMES));
    for (let step = 0; step < 12; step++) {
      clock += Math.floor(rand() * 600e3);
      const d = pick(devs), b = d.st[0], r = rand();
      if (d.old) {
        if (r < 0.3) { d.st = clone(cloud.st); d.K = new Set(cloud.K); log.push('舊版灌資料'); continue; }
        if (r < 0.6) { cloud.st = clone(d.st); cloud.K = new Set(d.K); log.push('舊版整份上傳'); continue; }
        const n = nameOf();
        if (n !== b.name) { b.name = n; const id = ++evId; ren.set(id, { name: n, past: new Set(d.K), newPage: false }); d.K.add(id); log.push('舊版就地改名 ' + n); }
        continue;
      }
      const di = devs.indexOf(d);
      if (r < 0.35) { sync(d); log.push(di + ' 對齊'); continue; }
      if (r < 0.65) {
        const n = nameOf();
        const nb = SM.editBank(d.st, 'b', now(d), renameTo(n));
        if (nb !== d.st) { d.st = clone(nb); d.dirty = true; const id = ++evId; ren.set(id, { name: n, past: new Set(d.K), newPage: true }); d.K.add(id); log.push(di + ' 改名 ' + n); }
        continue;
      }
      const en = pick(EN), z = pick(ZH);
      const nb = SM.editBank(d.st, 'b', now(d), b2 => SM.addWords(b2, [{ en, zh: z }], now(d)));
      if (nb !== d.st) { d.st = clone(nb); d.dirty = true; log.push(di + ' 加字 ' + en); }
    }
    for (let i = 0; i < 3; i++) devs.filter(d => !d.old).forEach(sync);
    const U = [...cloud.K].filter(id => ren.has(id));
    const maximal = U.filter(id => !U.some(o => o !== id && ren.get(o).past.has(id)));
    const fin = cloud.st[0].name;
    if (maximal.length === 1 && ren.get(maximal[0]).newPage && fin !== ren.get(maximal[0]).name) return '要「' + ren.get(maximal[0]).name + '」得到「' + fin + '」:' + log.join(';');
    const off = devs.filter(d => !d.old).find(d => SM.stateKey(d.st) !== SM.stateKey(cloud.st));
    if (off) return '沒收斂:' + log.join(';');
    return null;
  };
  const H3 = 3 * 3600e3;
  [['名稱會重複、時鐘都準', { skew: 0 }], ['名稱會重複、時鐘差 3 小時內', { skew: H3 }], ['每次都用新名稱、時鐘差 3 小時內', { skew: H3, fresh: true }],
    ['名稱會重複、混一台舊版頁面', { skew: H3, old: true }], ['三台新版加一台舊版、時鐘差 3 小時內', { skew: H3, three: true, old: true }],
    ['三台新版、每次都用新名稱、時鐘差 3 小時內', { skew: H3, three: true, fresh: true }]].forEach(([label, opts]) => {
    let bad = null, n = 0;
    for (let i = 0; i < 1500 && !bad; i++, n++) bad = one(opts);
    check('名稱隨機(' + label + '):只有一個最新的改名時最後就是它,最後每台跟雲端一樣', !bad, bad ? '第 ' + n + ' 組 ' + bad : n + ' 組');
  });
})();

(function dupAbsorb() {
  /* r3 #4:重複英文那一組(同一個英文出現兩次的舊資料)裡互相吸收過的字。新版頁面改內容會換 _r,做不出這種資料,
     只有這個分支早期的資料、舊版頁面改回一模一樣的內容會有;雜湊用真的 wordHash 算、_p 照格式手寫 */
  const pE = (h, t) => h + '.' + t.toString(36);
  const word = (zh, extra) => Object.assign({ en: 'run', zh, on: true, _r: 'r' + zh.length }, extra || {});
  const RUN2 = { en: 'Run', zh: '經營', on: true };
  const runZh = v => v.find(b => b.id === 'b1').words.filter(w => w.en === 'run').map(w => [w.zh].concat(w.alt || [])).reduce((p, q) => p.concat(q), []).sort().join();
  const cycle = () => {
    const w1 = word('跑', { _t: 1000 }), w2 = word('跑步', { _t: 2000 }), w3 = word('慢跑', { _t: 3000 });
    const h1 = SM.wordHash(w1), h2 = SM.wordHash(w2), h3 = SM.wordHash(w3);
    w1._p = [pE(h3, 1000)]; w2._p = [pE(h1, 2000)]; w3._p = [pE(h2, 3000)];
    return [w1, w2, w3];
  };
  {
    /* 繞一圈單向吸收(w2 吸收 w1、w3 吸收 w2、w1 吸收 w3):每一個都被別的吸收過,留 primary 最大的那個,其他的中文放它的 alt */
    const [w1, w2, w3] = cycle();
    const x = [{ id: 'b1', name: 'x', words: [w1, w2] }], y = [{ id: 'b1', name: 'x', words: [w3] }];
    const r1 = merge(x, y).v, r2 = merge(y, x).v;
    check('重複英文那一組全部被吸收過(繞一圈):三個中文都留,順序無關、再合併不變', runZh(r1) === '慢跑,跑,跑步' && SM.stateKey(r1) === SM.stateKey(r2)
      && merge(r1, x).sameAsLocal && merge(r1, y).sameAsLocal, runZh(r1) + ' / ' + runZh(r2));
    /* 同一組裡還有一個沒被吸收的(Run/經營):以前 kept 不是空的就不留 primary,繞一圈的 run 三個中文全部不見 */
    const x2 = [{ id: 'b1', name: 'x', words: [w1, w2, RUN2] }];
    const r3 = merge(x2, y).v, r4 = merge(y, x2).v;
    const all = v => v[0].words.map(w => [w.zh].concat(w.alt || [])).reduce((p, q) => p.concat(q), []).sort().join();
    check('重複英文那一組繞一圈吸收、同一組還有別的字:繞一圈的中文都留,經營也在,順序無關、再合併不變', all(r3) === '慢跑,經營,跑,跑步' && SM.stateKey(r3) === SM.stateKey(r4)
      && merge(r3, x2).sameAsLocal && merge(r3, y).sameAsLocal, all(r3) + ' / ' + all(r4));
  }
  {
    /* 兩個輸家(跑步、慢跑)都跟 primary(跑)互相吸收過、分在兩份:alt 要排序,兩種參數順序結果一樣 */
    const w1 = word('跑', { _t: 3000 }), w2 = word('跑步', { _t: 1000 }), w3 = word('慢跑', { _t: 2000 });
    const h1 = SM.wordHash(w1), h2 = SM.wordHash(w2), h3 = SM.wordHash(w3);
    w1._p = [pE(h2, 3000), pE(h3, 3000)]; w2._p = [pE(h1, 1000)]; w3._p = [pE(h1, 2000)];
    const x = [{ id: 'b1', name: 'x', words: [w1, w3, RUN2] }], y = [{ id: 'b1', name: 'x', words: [w2] }];
    const a = merge(x, y).v, b = merge(y, x).v;
    check('重複英文兩個輸家:中文都放 alt,兩種參數順序 stateKey 一樣', runZh(a) === '慢跑,跑,跑步' && SM.stateKey(a) === SM.stateKey(b), runZh(a) + ' / ' + runZh(b));
  }
  {
    /* primary 的 _p 已經有 4 個比較新的舊版本:吸收時要把自己和輸家記成「這一刻吸收的」,不然被截掉,再跟原本那份合併時又冒出來(不收斂) */
    const w1 = word('跑', { _t: 20000 }), w2 = word('跑步', { _t: 5000 });
    const h1 = SM.wordHash(w1), h2 = SM.wordHash(w2);
    w1._p = [pE(h2, 2000), pE('e1', 10000), pE('e2', 11000), pE('e3', 12000)];
    w2._p = [pE(h1, 1000)];
    const x = [{ id: 'b1', name: 'x', words: [w1, RUN2] }], y = [{ id: 'b1', name: 'x', words: [w2] }];
    const r = merge(x, y).v;
    check('重複英文吸收後再跟原本那兩份合併不變(_p 滿了也一樣)', runZh(r) === '跑,跑步' && merge(r, x).sameAsLocal && merge(r, y).sameAsLocal,
      runZh(r) + ' → ' + runZh(merge(r, x).v));
  }
  {
    /* 只因為互相吸收過而輸的(跑,輸給跑步),贏它的那個又是別人的舊版本(慢跑從跑步改過來,沒看過跑):跑 的中文交給慢跑(alt)。
       以前只交給直接贏它的跑步,跑步被拿掉,跑 就不見了(test_sync_fuzz 的早期頁面改回找到的) */
    const wA = word('跑步', { _t: 3000 }), wB = word('跑', { _t: 1000 }), wC = word('慢跑', { _t: 4000 });
    const hA = SM.wordHash(wA), hB = SM.wordHash(wB);
    wA._p = [pE(hB, 3000)]; wB._p = [pE(hA, 1000)]; wC._p = [pE(hA, 4000)];
    const x = [{ id: 'b1', name: 'x', words: [wA, RUN2] }], y = [{ id: 'b1', name: 'x', words: [wB, wC] }];
    const r1 = merge(x, y).v, r2 = merge(y, x).v;
    check('重複英文:互相吸收過而輸的、贏它的又被別人取代:中文交給最後留下的(alt),順序無關、再合併不變', runZh(r1) === '慢跑,跑' && SM.stateKey(r1) === SM.stateKey(r2)
      && merge(r1, x).sameAsLocal && merge(r1, y).sameAsLocal, runZh(r1) + ' / ' + runZh(r2));
  }
  {
    /* 主要那個已經有輸家的中文(alt):沒有新的就原樣回,題庫是新版本時合併結果跟本機一樣(不用寫、不上傳) */
    const w1 = word('跑', { alt: ['跑步'], _t: 20000 }), w2 = word('跑步', { _t: 5000 });
    const h1 = SM.wordHash(w1), h2 = SM.wordHash(w2);
    w1._p = [pE(h2, 5000)]; w2._p = [pE(h1, 1000)];
    const yb = { id: 'b1', name: 'x', _r: 'rrrrrr', words: [w2] };
    const xb = { id: 'b1', name: 'x', _r: 'rrrrrr', words: [w1, RUN2], _t: 20000, _p: [pE(SM.bankHash(yb), 20000)] };
    const m = merge([xb], [yb]);
    check('重複英文那一組沒有新的 alt:原樣回(sameAsLocal)', m.sameAsLocal, J(m.v[0].words.find(w => w.en === 'run')));
  }
})();

/* ---------- 12. 第三輪審查第二批(2026-10-25 r3b)找到的 ---------- */
(function oldRenameCleanLocal() {
  /* r3b #1:A(新版)建題庫、上傳;C(部署前開著的舊版頁面)編輯頁開著;A 在同一個題庫改另一個字的中文(或只加一個字)並上傳;
     C 就地改名、整份上傳。A 本機沒改過(帳本空)就對齊或灌資料:以前主要那份用整個題庫的 _t 選(A 改字時蓋了新的 _t),
     _nt 又一樣,名稱跟著 A 退回;C 重開也拿到舊名稱,C 的改名哪裡都沒有了(main 最後上傳的那份會留著) */
  const run = (how, aSkew) => {
    const t0 = T0 + aSkew;
    const s = { cloud: SM.editBank([], 'b', t0, b => SM.addWords(renameTo('多益單字')(b), [{ en: 'apple', zh: '蘋果' }, { en: 'invoice', zh: '發票' }], t0)) };
    s.A = clone(s.cloud);
    const snap = clone(s.cloud);                                    // C 的舊版編輯頁記住的整份陣列
    const t1 = T0 + 60e3 + aSkew;
    if (how === '改字') s.A = SM.editBank(s.A, 'b', t1, b => SM.setWord(b, 'invoice', { zh: '發票單' }, t1));
    if (how === '加字') s.A = SM.editBank(s.A, 'b', t1, b => SM.addWords(b, [{ en: 'refund', zh: '退款' }], t1));
    syncTo(s, 'A', false);                                          // A 上傳成功,帳本空
    snap[0].name = '我的多益'; s.cloud = clone(snap);               // C 就地改名、整份上傳
    const other = SM.banks(freeze(clone(s.A)), freeze(clone(s.cloud)), { now: T0, tombs: null, localClean: true }).v[0].name;
    syncTo(s, 'A', true);                                           // A 開單字頁(或隔天重開灌資料),本機沒改過
    s.C = clone(snap); syncTo(s, 'C', true);                        // C 之後重開(新版)灌資料
    const b = s.cloud[0], wd = en => b.words.find(w => w.en === en) || {};
    const kept = how === '改字' ? wd('invoice').zh === '發票單' : how === '加字' ? !!wd('refund').en : true;
    const stable = SM.banks(freeze(clone(s.cloud)), freeze(clone(s.A)), { now: T0, tombs: null }).sameAsLocal
      && SM.banks(freeze(clone(s.cloud)), freeze(clone(snap)), { now: T0, tombs: null }).sameAsLocal;
    return [b.name, s.A[0].name, s.C[0].name, other, kept, stable];
  };
  const cases = [['A 改另一個字的中文', '改字', 0], ['A 只加一個字', '加字', 0], ['A 沒動', '沒動', 0], ['A 改字、時鐘慢 1 小時', '改字', -3600e3], ['A 加字、時鐘快 1 小時', '加字', 3600e3]];
  const out = cases.map(c => [c[0], run(c[1], c[2])]);
  check('舊版頁面就地改名、新版那台之前在同一個題庫改過別的字並上傳(本機沒改過):舊版的改名留著(每台和雲端),新版改的字也在,再合併不變',
    out.every(x => x[1].slice(0, 4).every(n => n === '我的多益') && x[1][4] && x[1][5]), J(out));
})();

(function oldRenameGuards() {
  /* r3b #5:第三輪(7578bdf)加的兩條舊版頁面改名保護,以前改壞了也沒有測試抓得到 */
  {
    /* (a) renamedFrom 的「y 自己的代號在 y 的 _nl 裡不算」:雲端叫甲,新版 N 改成乙並上傳;舊版 O 灌資料後就地改成丙、整份上傳,
       N 對齊(本機沒改過)拿到丙;O 再灌資料、就地把名稱改回乙(_nr、_nl 是抄來的),整份上傳,N 再對齊。
       沒有這一條:N 那份(丙)的 _nl 裡有乙那一版的代號,被當成「從乙改過來的」,舊版最後改的乙被退回丙 */
    const s = { cloud: [SM.newBank('b', '甲', T0 - DAY)] };
    s.N = clone(s.cloud);
    s.N = SM.editBank(s.N, 'b', T0 + 60e3, renameTo('乙')); syncTo(s, 'N', false);
    let O = clone(s.cloud); O[0].name = '丙'; s.cloud = clone(O);
    syncTo(s, 'N', true);
    const first = s.cloud[0].name;
    O = clone(s.cloud); O[0].name = '乙'; s.cloud = clone(O);
    syncTo(s, 'N', true);
    check('舊版頁面就地改名、再就地改回以前那一版(乙→丙→乙),新版那台本機沒改過:每次都留舊版最後改的名稱',
      first === '丙' && s.cloud[0].name === '乙' && s.N[0].name === '乙', J([first, s.cloud[0].name, s.N[0].name]));
  }
  {
    /* (b) 合併時 _nl 記下沒用上的名稱:裝置 0 加字還沒上傳;舊版頁面就地改成乙並上傳;裝置 1(本機沒改過)對齊,用了乙;
       裝置 0 再對齊。裝置 1 合併時沒記下甲的代號:裝置 0 分不出乙是從甲改過來的,比 _nt 也一樣,用主要那份(裝置 0)的甲,改名被退回 */
    const run = old => {
      const s = { cloud: [SM.newBank('b', '甲', T0 - DAY)] };
      s.d0 = clone(s.cloud); s.d1 = clone(s.cloud);
      s.d0 = SM.editBank(s.d0, 'b', T0 + 60e3, addInvoice(T0 + 60e3));
      const O = clone(s.cloud); O[0].name = '乙'; s.cloud = clone(O);
      syncTo(s, 'd1', true);
      syncTo(s, 'd0', false);
      syncTo(s, 'd1', true);
      return [s.cloud[0].name, s.d0[0].name, s.d1[0].name, s.cloud[0].words.some(w => w.en === 'invoice')];
    };
    const r = run();
    check('舊版頁面就地改名、一台新版(本機沒改過)先對齊接受了,另一台有沒上傳的加字再對齊:改名留著,字也在',
      r.slice(0, 3).every(n => n === '乙') && r[3], J(r));
  }
})();

(function nameRevertSlowClock() {
  /* r3b #6:先看名稱來源、再看誰是新版本的排序(r3 #1、#2)以前只靠名稱隨機測試的某一組守著,換種子就抓不到。
     兩台新版,裝置 0 快約 4.5 分鐘、裝置 1 慢約 2.1 小時;裝置 1 把甲改成丙、後來又改回甲,裝置 0 同時在加字。
     把「誰是新版本」放在名稱來源前面時,三處都變成丙(裝置 1 最後改的甲被退回);時鐘都準時不會發生 */
  const s = { cloud: [SM.newBank('b', '甲', T0 - DAY)] };
  s.d0 = clone(s.cloud); s.d1 = clone(s.cloud);
  const dirty = { d0: false, d1: false };
  const sync = (d, t) => { const m = SM.banks(freeze(clone(s[d])), freeze(clone(s.cloud)), { now: T0 + t, tombs: null, localClean: !dirty[d] }); s[d] = clone(m.v); s.cloud = clone(m.v); dirty[d] = false; };
  const edit = (d, t, fn) => { const nb = SM.editBank(s[d], 'b', T0 + t, fn); if (nb !== s[d]) { s[d] = clone(nb); dirty[d] = true; } };
  const add = (d, en, zh, t) => edit(d, t, b => SM.addWords(b, [{ en, zh }], T0 + t));
  sync('d1', -7010611); sync('d0', 928547); add('d0', 'deadline', '發票', 1292511); edit('d1', -6330212, renameTo('丙')); add('d0', 'take off', '蘋果', 1515657);
  sync('d1', -6155834); sync('d0', 1843341); edit('d1', -5932448, renameTo('甲')); sync('d1', -5352533); add('d1', 'deadline', '蘋果', -5197527);
  add('d1', 'deadline', '櫻桃', -4756438); add('d0', 'put on', '櫻桃', 3579009);
  for (let k = 0; k < 3; k++) { sync('d0', 3579009); sync('d1', -4241696); }
  const names = [s.cloud[0].name, s.d0[0].name, s.d1[0].name];
  const words = s.cloud[0].words.map(w => w.en).sort().join('|');
  check('兩台新版、改名那台時鐘慢 2 小時:甲→丙→甲,另一台同時加字:最後每台和雲端都是甲,字都在,兩台跟雲端一樣',
    names.every(n => n === '甲') && words === 'deadline|put on|take off' && SM.stateKey(s.d0) === SM.stateKey(s.cloud) && SM.stateKey(s.d1) === SM.stateKey(s.cloud),
    J(names) + ' ' + words);
})();

(function dupTwoCycles() {
  /* r3b #8:重複英文那一組有兩個互不相通的圈(run:跑/跑步/慢跑、Run:經營/管理/營運,各自繞一圈單向吸收),分在兩份。
     走不到第一個 top 的要再留一個 top;只留第一個時 run 的三個中文整組不見 */
  const pE = (h, t) => h + '.' + t.toString(36);
  const cyc = (en, zs, t0) => {
    const ws = zs.map((z, i) => ({ en, zh: z, on: true, _r: 'r' + i + en.charAt(0), _t: t0 + i * 1000 }));
    const hs = ws.map(w => SM.wordHash(w));
    ws.forEach((w, i) => { w._p = [pE(hs[(i + ws.length - 1) % ws.length], w._t)]; });
    return ws;
  };
  const [a1, a2, a3] = cyc('run', ['跑', '跑步', '慢跑'], 1000), [b1, b2, b3] = cyc('Run', ['經營', '管理', '營運'], 10000);
  const x = [{ id: 'b1', name: 'x', words: [a1, a2, b1, b2] }], y = [{ id: 'b1', name: 'x', words: [a3, b3] }];
  const r1 = merge(x, y).v, r2 = merge(y, x).v;
  const zhOf = (v, en) => v[0].words.filter(w => w.en === en).map(w => [w.zh].concat(w.alt || [])).reduce((p, q) => p.concat(q), []).sort().join();
  check('重複英文那一組兩個互不相通的圈(run、Run 各繞一圈):兩組中文都在,順序無關、再合併不變',
    zhOf(r1, 'run') === ['跑', '跑步', '慢跑'].sort().join() && zhOf(r1, 'Run') === ['經營', '管理', '營運'].sort().join() && SM.stateKey(r1) === SM.stateKey(r2) && merge(r1, x).sameAsLocal && merge(r1, y).sameAsLocal,
    zhOf(r1, 'run') + ' / ' + zhOf(r1, 'Run') + ' / ' + zhOf(r2, 'run') + ' / ' + zhOf(r2, 'Run'));
})();

(function tombOldReadd() {
  /* r3b #3:刪除標記的 hs(被刪那一份吸收過的舊版本)以前不分有沒有 _r。舊版頁面存的東西沒有 _r,文章題庫的內容又是固定的
     (id art_<文章>、名稱、每個字的中文都照文章產生),學生在舊版頁面重新存入,雜湊一定對得上被刪那一份吸收過的舊版本,又被刪掉。
     現在 hs 只刪有 _r 的(新版做的版本,_r 每一版都不一樣,對得上就一定是那個舊版本);沒有 _r 的只有 h0(刪的就是那個樣子)刪得掉 */
  const T1 = T0 + DAY;
  const oldImport = (banks, a) => {                                   // main 的 importVocabToBank:讀本機、就地改、整份寫回
    const out = clone(banks || []);
    const bid = 'art_' + a.id;
    let b = out.find(x => x.id === bid);
    if (!b) { b = { id: bid, name: '', words: [] }; out.push(b); }
    b.name = '文章：' + a.titleZh;
    a.vocab.forEach(([en, zh]) => { const ex = b.words.find(x => key(x.en) === key(en)); if (ex) ex.zh = zh; else b.words.push({ en, zh, on: true }); });
    return out;
  };
  const art = { id: 'x1', titleZh: '機場', vocab: [['gate', '登機門'], ['board', '登機']] };
  const both = (a, b, tombs) => { const r1 = SM.banks(freeze(clone(a)), freeze(clone(b)), { now: T1, tombs: freeze(clone(tombs)) }).v, r2 = SM.banks(freeze(clone(b)), freeze(clone(a)), { now: T1, tombs: freeze(clone(tombs)) }).v; return SM.stateKey(r1) === SM.stateKey(r2) ? r1 : null; };
  const brief = v => (v ? J(v.map(b => b.id + '[' + (b.words || []).map(w => w.en + ':' + w.zh).join(',') + ']')) : '兩種順序不一樣');
  /* 新版 A 存過(有 _r)、舊版 O 也存過(沒有 _r),合併後在 A 刪掉;O 的舊分頁之後重新存入(跟 O 當初那份一模一樣):留著 */
  const A = SM.editBank([], 'art_x1', T0, b => SM.addWords(Object.assign({}, b, { name: '文章：機場' }), art.vocab.map(([en, zh]) => ({ en, zh })), T0));
  const O = oldImport([], art);
  const d2 = SM.deleteBank(merge(A, O).v, null, 'art_x1', T0 + 1000);
  const r2 = both(oldImport(d2.banks, art), d2.banks, d2.tombs);
  check('新版和舊版都存過同一篇文章、合併後在新版刪掉,之後在舊版頁面重新存入:題庫留著(兩種順序一樣)',
    !!r2 && r2.some(b => b.id === 'art_x1' && b.words.length === 2), brief(r2));
  /* 舊資料的字 gate 登機門,在新版改成大門(有 _r 了)再刪掉;舊版頁面重新存入文章,加回 gate 登機門(跟改之前那一版一模一樣):留著 */
  let L = SM.editBank(oldImport([], art), 'art_x1', T0, b => SM.setWord(b, 'gate', { zh: '大門' }, T0));
  const d3 = SM.deleteWord(L, null, 'art_x1', 'gate', T0 + 1000, null);
  const r3 = both(oldImport(d3.banks, art), d3.banks, d3.tombs);
  check('舊資料的字在新版改過再刪掉,之後在舊版頁面加回改之前那個樣子:字留著(兩種順序一樣)',
    !!r3 && !!findWord(r3, 'art_x1', 'gate') && findWord(r3, 'art_x1', 'gate').zh === '登機門', brief(r3));
  /* 對照:新版做的舊版本(有 _r)被帶回來照樣刪;刪的就是那個樣子(h0)的舊資料照樣刪 */
  const N1 = SM.editBank([], 'bN', T0, b => SM.addWords(renameTo('甲')(b), [{ en: 'apple', zh: '蘋果' }], T0));
  const N2 = SM.editBank(N1, 'bN', T0 + 1000, b => SM.addWords(b, [{ en: 'pear', zh: '梨' }], T0 + 1000));
  const dN = SM.deleteBank(N2, null, 'bN', T0 + 2000);
  const rN = both(N1, dN.banks, dN.tombs);
  const W1 = SM.editBank(N1, 'bN', T0 + 1000, b => SM.setWord(b, 'apple', { zh: '蘋果樹' }, T0 + 1000));
  const W2 = SM.editBank(W1, 'bN', T0 + 1500, b => SM.setWord(b, 'apple', { zh: '大蘋果' }, T0 + 1500));
  const dW = SM.deleteWord(W2, null, 'bN', 'apple', T0 + 2000, null);
  const rW = both(W1, dW.banks, dW.tombs);
  const leg = [{ id: 'bL', name: 'Unit 1', words: [{ en: 'gate', zh: '登機門', on: true }, { en: 'board', zh: '登機', on: true }] }];
  const dL = SM.deleteWord(leg, null, 'bL', 'gate', T0 + 1000, null), dLB = SM.deleteBank(leg, null, 'bL', T0 + 1000);
  const rL = both(leg, dL.banks, dL.tombs), rLB = both(leg, dLB.banks, dLB.tombs);
  check('對照:新版做的舊版本(題庫、改過的字)被帶回來照樣刪掉;刪的就是那個樣子的舊資料字、舊資料題庫照樣刪掉',
    !!rN && !rN.length && !!rW && !findWord(rW, 'bN', 'apple') && !!rL && !findWord(rL, 'bL', 'gate') && !!findWord(rL, 'bL', 'board') && !!rLB && !rLB.length,
    brief(rN) + ' / ' + brief(rW) + ' / ' + brief(rL) + ' / ' + brief(rLB));
})();

console.log(pass + ' / ' + (pass + fail) + ' 通過');
process.exit(fail ? 1 : 0);
