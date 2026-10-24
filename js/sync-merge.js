/* 同一個帳號多台裝置的合併規則(同步合併設計 3.7–3.9)。純計算,不讀寫儲存,window.SYNC_MERGE。
   js/cloud.js 的 MERGED 表用它:vgame_banks(自訂題庫)、sync_del(刪除標記)、mock_history(模擬考紀錄)上傳前先讀雲端、合併、再上傳;
   灌雲端資料時本機和雲端都有就存合併結果。每一頁都要在 cloud.js 之前載入(tools/test_sync_union.js 檢查)。
   合併函式的約定跟 PET.cloudMerge 一樣:回 { ok, v, sameAsLocal, sameAsCloud };形狀認不得回 { ok: false }(唯讀:不合併、不上傳、帳本留著)。
   原則:
   - 少了不算刪除。一份有、另一份沒有的題庫和字一律留下;只有刪除標記(sync_del)對得上的那一份才刪。
     舊陣列整份寫回、舊版頁面整份上傳、讀到一半的資料,都只會讓東西「多回來」,不會少。
   - 刪除標記只刪「刪的時候那個樣子」:記刪的那一份的內容雜湊(h0)和它吸收過的舊版本(hs);別台在那之後改過的,雜湊對不上,留著。
   - 合併結果跟參數順序無關、重複合併不變、合併結果再跟任一份合併也不變(兩台各自合併會收斂,不會一直互傳)。
   - 時鐘只拿來決定「同一個欄位兩邊都改了誰當主要」,輸的那個中文放進 alt,不丟。
   題庫多的欄位(舊版頁面看不懂,但改的時候是改物件本身,會原樣留著):
   - _r:新版建立題庫(6 碼)或字(4 碼)時給的隨機碼,算進內容雜湊(刪掉又加回一模一樣的字,雜湊不同,不會被舊標記刪掉)。
   - _t:新版最後一次改它的時間(新加的字沒有,改過才有);_nt:題庫名稱最後一次改的時間。都不算進雜湊。
     名稱:一份是另一份的新版本就用新版本的名稱;兩台同時改名才比 _nt。
   - _p:它吸收過的舊版本,「雜湊.時間(36 進位毫秒)」;時間是吸收的那一刻(新版本的 _t)。這一版那一刻吸收的一定留(最多 16 個),
     其他的留最新的,題庫補到 8 個、字補到 4 個。用來判斷「另一份是不是我的舊版本」。
   - alt(字):兩台同時改了同一個字的中文,沒當主要的那個(不設上限:以前排序後只留 3 個,會把學生剛打的丟掉)。
     編輯頁全部顯示「另一台寫的」,可以換或刪。
   跟 feat/move 共用:canon、quickHash 跟 js/move-merge.js 同一個函式;mock 的「同一筆」判斷一樣(兩個分支都進 main 後只留這一份)。
   題庫規則跟 js/move-merge.js 的 mergeBanks 不一樣(那邊同一個 id 內容不同就複製一份「（舊網址）」,戳記不同也算不同):
   合進 feat/move 時,搬家暫存區合併表上的鍵要改用這裡的函式、sync_del 要有搬家規則,tools/test_sync_move_compat.js 會擋。 */
(function (root) {
  'use strict';
  const WORD_P_MAX = 4, BANK_P_MAX = 8, MOCK_MAX = 300;
  const TOMB_KEEP_MS = 400 * 864e5, TOMB_MAX = 1000, TOMB_H0_MAX = 4, TOMB_H_MAX = 8;
  const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
  /* 常用的內建函式先放進區域變數:每次查全域在 node 的 vm 沙盒(測試)裡很慢,瀏覽器裡沒差 */
  const imul = Math.imul, isArr = Array.isArray, keysOf = Object.keys, str = JSON.stringify;

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isPlain = x => !!x && typeof x === 'object' && !isArr(x);
  const isNum = x => typeof x === 'number' && isFinite(x);
  function canon(x) {
    if (isArr(x)) return '[' + x.map(canon).join(',') + ']';
    if (x && typeof x === 'object') return '{' + keysOf(x).sort().map(k => str(k) + ':' + canon(x[k])).join(',') + '}';
    return str(x === undefined ? null : x);
  }
  /* 短雜湊(cyrb53):只用來認版本,不拿來防偽 */
  function quickHash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = imul(h1 ^ ch, 2654435761);
      h2 = imul(h2 ^ ch, 1597334677);
    }
    h1 = imul(h1 ^ (h1 >>> 16), 2246822507) ^ imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = imul(h2 ^ (h2 >>> 16), 2246822507) ^ imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  /* 英文的比對鍵:跟 js/vocab.js 的 norm 一樣(小寫、去頭尾空白、空白合一) */
  const norm = s => String(s).toLowerCase().trim().replace(/\s+/g, ' ');
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  function rnd(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += B36.charAt(Math.floor(Math.random() * 36));
    return s;
  }
  const maxT = (a, b) => (isNum(a) || isNum(b) ? Math.max(isNum(a) ? a : 0, isNum(b) ? b : 0) : undefined);
  /* 物件的某個欄位:有值就設、沒有就拿掉(合併兩份一樣的舊資料時不多出任何欄位) */
  function put(o, k, v) {
    if (v === undefined || (Array.isArray(v) && !v.length)) delete o[k];
    else o[k] = v;
    return o;
  }

  /* ---------- 版本(_p) ---------- */
  const pHash = e => String(e).split('.')[0];
  const pTime = e => { const t = parseInt(String(e).split('.')[1], 36); return isFinite(t) ? t : 0; };
  const pEntry = (h, t) => h + '.' + Math.max(0, Math.floor(isNum(t) ? t : 0)).toString(36);
  const pList = p => (Array.isArray(p) ? p.filter(e => typeof e === 'string' && /^[0-9a-z]+(\.[0-9a-z]+)?$/.test(e)) : []);
  const hasP = (p, h) => pList(p).some(e => pHash(e) === h);
  /* 整理 _p:同一個雜湊留時間最大的、去掉自己的雜湊。時間不早於 T(這一版的 _t)的是「這一版那一刻吸收的」,一定留
     (這一次合併直接吸收的兩份就在這裡,之後再跟它們合併才認得出是舊版本;最多 16 個);其他的依時間新到舊、雜湊排序,補到上限。
     這樣整理跟合併的順序無關(兩台各自合併,結果一樣)。 */
  const P_NOW_MAX = 16;
  function normP(list, self, max, T) {
    const best = new Map();
    pList(list).forEach(e => { const h = pHash(e); if (h !== self && (!best.has(h) || pTime(e) > pTime(best.get(h)))) best.set(h, e); });
    const all = Array.from(best.values()).sort((a, b) => pTime(b) - pTime(a) || cmp(pHash(a), pHash(b)));
    const t = isNum(T) ? T : 0;
    const now = all.filter(e => pTime(e) >= t).slice(0, P_NOW_MAX);
    return now.concat(all.filter(e => pTime(e) < t).slice(0, Math.max(0, max - now.length)));
  }

  /* ---------- 字 ---------- */
  const isWord = w => isPlain(w) && typeof w.en === 'string';
  const altList = a => (Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim()) : []);
  function wordContent(w) {
    const alt = altList(w.alt).slice().sort();
    return { en: w.en, zh: w.zh === undefined ? null : w.zh, on: w.on !== false, r: typeof w._r === 'string' ? w._r : null, alt: alt.length ? alt : null,
      m: typeof w._m === 'string' ? w._m : null };
  }
  const wordHash = w => quickHash(canon(isWord(w) ? wordContent(w) : w));
  const wordKey = w => (isWord(w) ? 'w:' + norm(w.en) : 'o:' + canon(w));
  /* 輸的那個中文要不要放進 alt:去空白後不一樣,也不是主要那個「；、,/」拆出來的其中一種寫法 */
  const zhKey = s => String(s === undefined || s === null ? '' : s).replace(/\s+/g, '');
  function zhDiffers(q, p) {
    const k = zhKey(q);
    if (!k || k === zhKey(p)) return false;
    return String(p === undefined || p === null ? '' : p).split(/[;；、,，/／]+/).map(zhKey).indexOf(k) < 0;
  }
  /* 兩份都不是對方的舊版本時,誰當主要:_t 大的;一樣就比內容固定選一個(兩台算出來一樣) */
  function primary(x, y, content) {
    const tx = isNum(x._t) ? x._t : 0, ty = isNum(y._t) ? y._t : 0;
    if (tx !== ty) return tx > ty ? [x, y] : [y, x];
    return canon(content(x)) >= canon(content(y)) ? [x, y] : [y, x];
  }
  /* 兩份都不是對方的舊版本、合併結果卻跟其中一份一模一樣(只差 _r、只差勾選、另一個中文是主要那個的一種寫法):
     加一個合併記號 _m(兩份雜湊算出來的,算進內容雜湊),讓結果跟兩份都不同。不然別台刪掉其中一份時(刪除標記記的是那一份的雜湊),
     連帶把另一份(別台在刪之後才加的、改的)一起刪掉。同步合併設計 3.8.1 的「別台在那之後改過的,留著」 */
  function mark(out, hx, hy, hashOf) {
    const h = hashOf(out);
    if (h === hx || h === hy) out._m = quickHash([hx, hy].sort().join('+'));
  }
  /* 誰是新版本:y 吸收過 x(x 的雜湊在 y 的 _p)→ y。兩邊互相吸收過(內容改回以前的樣子,例如刪掉 alt 後跟某一版一樣):
     兩份的內容都在對方的歷史裡,沒有誰是新的另一份,用 _t 大的當新版本(不放 alt) */
  function newer(x, y, hx, hy, content) {
    const yx = hasP(y._p, hx), xy = hasP(x._p, hy);
    if (yx && xy) return primary(x, y, content)[0];
    if (yx) return y;
    if (xy) return x;
    return null;
  }
  function joinWord(x, y) {
    if (canon(x) === canon(y)) return x;
    const hx = wordHash(x), hy = wordHash(y);
    const t = maxT(x._t, y._t);
    let out, imm;
    if (hx === hy) {
      out = Object.assign({}, canon(x) <= canon(y) ? x : y);
      imm = [];
    } else {
      const win = newer(x, y, hx, hy, wordContent);
      if (win) {
        out = Object.assign({}, win);
        imm = [pEntry(win === x ? hy : hx, t)];
      } else {
        const [p, q] = primary(x, y, wordContent);
        out = Object.assign({}, p);
        const alt = altList(p.alt).concat(altList(q.alt), zhDiffers(q.zh, p.zh) ? [String(q.zh)] : [])
          .filter((s, i, a) => zhDiffers(s, p.zh) && a.indexOf(s) === i).sort();
        put(out, 'alt', alt);
        mark(out, hx, hy, wordHash);
        imm = [pEntry(hx, t), pEntry(hy, t)];
      }
    }
    put(out, '_t', t);
    put(out, '_p', normP(imm.concat(pList(x._p), pList(y._p)), wordHash(out), WORD_P_MAX, t));
    return out;
  }
  /* 字取聯集:用 norm(en) 對應。同一份裡同一個英文出現兩次(舊資料)不合併成一個:兩份的都留,去掉一樣的和被吸收過的舊版本 */
  function joinWords(xs, ys) {
    const gx = new Map(), gy = new Map(), order = [];
    const add = (m, w) => { const k = wordKey(w); if (!gx.has(k) && !gy.has(k)) order.push(k); (m.get(k) || m.set(k, []).get(k)).push(w); };
    xs.forEach(w => add(gx, w));
    ys.forEach(w => add(gy, w));
    const out = [];
    order.forEach(k => {
      const a = gx.get(k) || [], b = gy.get(k) || [];
      if (k.charAt(0) === 'o') { out.push(a.length ? a[0] : b[0]); return; }
      if (a.length <= 1 && b.length <= 1) { out.push(a.length && b.length ? joinWord(a[0], b[0]) : (a[0] || b[0])); return; }
      const byHash = new Map();
      a.concat(b).forEach(w => { const h = wordHash(w); byHash.set(h, byHash.has(h) ? joinWord(byHash.get(h), w) : w); });
      const all = Array.from(byHash.entries());
      all.filter(([h]) => !all.some(([h2, w2]) => h2 !== h && hasP(w2._p, h)))
        .map(e => e[1]).sort((p, q) => cmp(canon(p), canon(q))).forEach(w => out.push(w));
    });
    return out;
  }

  /* ---------- 題庫 ---------- */
  const isBank = b => isPlain(b) && typeof b.id === 'string' && (b.words === undefined || Array.isArray(b.words));
  const wordsOf = b => (Array.isArray(b.words) ? b.words : []);
  function bankContent(b) {
    return { n: b.name === undefined ? null : b.name, r: typeof b._r === 'string' ? b._r : null, m: typeof b._m === 'string' ? b._m : null,
      w: wordsOf(b).map(w => canon(isWord(w) ? wordContent(w) : w)).sort() };
  }
  const bankHash = b => quickHash(canon(bankContent(b)));
  function joinBank(x, y) {
    if (canon(x) === canon(y)) return x;
    const hx = bankHash(x), hy = bankHash(y);
    const t = maxT(x._t, y._t), nt = maxT(x._nt, y._nt);
    const win = hx === hy ? (canon(x) <= canon(y) ? x : y) : newer(x, y, hx, hy, bankContent);
    const bp = win || primary(x, y, bankContent)[0];
    /* 名稱:一份是另一份的新版本(win)就用它的名稱(改名的那台看過舊名稱);兩份都不是對方的舊版本(兩台同時改名)才比 _nt。
       以前一律比 _nt:時鐘慢的裝置後來改的名稱、或時鐘快的裝置建立的題庫被改名時,新名稱被退回舊的,而且永遠回不來 */
    let name = bp.name;
    if (!win && x.name !== y.name) {
      const nx = isNum(x._nt) ? x._nt : 0, ny = isNum(y._nt) ? y._nt : 0;
      if (nx !== ny) name = nx > ny ? x.name : y.name;
    }
    const out = Object.assign({}, bp);
    put(out, 'name', name);
    if (x.words !== undefined || y.words !== undefined) out.words = joinWords(wordsOf(x), wordsOf(y));
    put(out, '_t', t);
    put(out, '_nt', nt);
    if (!win) mark(out, hx, hy, bankHash);
    const h = bankHash(out);
    const imm = [hx, hy].filter(z => z !== h).map(z => pEntry(z, t));
    put(out, '_p', normP(imm.concat(pList(x._p), pList(y._p)), h, BANK_P_MAX, t));
    return out;
  }

  /* ---------- 刪除標記(sync_del) ----------
     { v: 1, vgame_banks: { b: { 題庫 id: 標記 }, w: { 題庫 id: { norm(en): 標記 } } } },標記 = { at, h0: [刪的那份的雜湊], hs: [它吸收過的舊版本] }。
     合併:鍵取聯集、at 取大、h0 與 hs 取聯集(h0 最多 4 個,加起來最多 8 個,超過時留排序後的前幾個,兩台算出來一樣)。
     at 早於 400 天前的清掉;全部超過 1000 筆時從最舊的清。清掉只會讓刪掉的回來,不會讓沒刪的不見。
     這一版不認得的鍵(以後的寫作標記):兩邊一樣就留、只有一邊有就留、兩邊不同就固定選一份(少的只是標記,只會多留) */
  function readEntry(e) {
    if (!isPlain(e) || !isNum(e.at)) return null;
    const hs = a => (Array.isArray(a) ? a.filter(h => typeof h === 'string' && h) : []);
    return { at: e.at, h0: hs(e.h0), hs: hs(e.hs) };
  }
  function joinEntry(a, b) {
    if (!a || !b) return a || b;
    const uniq = arr => arr.filter((h, i) => arr.indexOf(h) === i).sort();
    const h0 = uniq(a.h0.concat(b.h0)).slice(0, TOMB_H0_MAX);
    const hs = uniq(a.hs.concat(b.hs)).filter(h => h0.indexOf(h) < 0).slice(0, TOMB_H_MAX - h0.length);
    return { at: Math.max(a.at, b.at), h0, hs };
  }
  /* 讀一份刪除標記:null 是空的;不是預期的形狀(或更新版的 v)回 null 給呼叫的人當唯讀 */
  function readTombs(x) {
    if (x === null || x === undefined) return { v: 1, other: {}, b: {}, w: {} };
    if (!isPlain(x) || x.v !== 1) return null;
    const out = { v: 1, other: {}, b: {}, w: {} };
    Object.keys(x).forEach(k => { if (k !== 'v' && k !== 'vgame_banks') out.other[k] = x[k]; });
    const vb = x.vgame_banks;
    if (vb !== undefined && !isPlain(vb)) return null;
    if (isPlain(vb) && isPlain(vb.b)) Object.keys(vb.b).forEach(id => { const e = readEntry(vb.b[id]); if (e) out.b[id] = e; });
    if (isPlain(vb) && isPlain(vb.w)) Object.keys(vb.w).forEach(id => {
      if (!isPlain(vb.w[id])) return;
      Object.keys(vb.w[id]).forEach(k => { const e = readEntry(vb.w[id][k]); if (e) (out.w[id] = out.w[id] || {})[k] = e; });
    });
    return out;
  }
  function writeTombs(t, now) {
    const all = [];
    Object.keys(t.b).forEach(id => all.push([t.b[id].at, 'b\u0000' + id, ['b', id]]));
    Object.keys(t.w).forEach(id => Object.keys(t.w[id]).forEach(k => all.push([t.w[id][k].at, 'w\u0000' + id + '\u0000' + k, ['w', id, k]])));
    const cutoff = isNum(now) ? now - TOMB_KEEP_MS : -Infinity;
    const keep = all.filter(e => e[0] >= cutoff).sort((a, b) => b[0] - a[0] || cmp(a[1], b[1])).slice(0, TOMB_MAX);
    const b = {}, w = {};
    keep.sort((a, c) => cmp(a[1], c[1])).forEach(([, , p]) => {
      if (p[0] === 'b') b[p[1]] = t.b[p[1]];
      else (w[p[1]] = w[p[1]] || {})[p[2]] = t.w[p[1]][p[2]];
    });
    const out = { v: 1 };
    Object.keys(t.other).sort().forEach(k => { out[k] = t.other[k]; });
    out.vgame_banks = { b, w };
    return out;
  }
  function tombs(a, b, now) {
    const A = readTombs(a), B = readTombs(b);
    if (!A || !B) return { ok: false };
    if ((a === null || a === undefined) && (b === null || b === undefined)) return { ok: true, v: null, sameAsLocal: true, sameAsCloud: true };
    const t = { v: 1, other: {}, b: {}, w: {} };
    Object.keys(A.other).concat(Object.keys(B.other)).forEach(k => {
      if (!own(A.other, k) || !own(B.other, k)) t.other[k] = own(A.other, k) ? A.other[k] : B.other[k];
      else t.other[k] = canon(A.other[k]) >= canon(B.other[k]) ? A.other[k] : B.other[k];
    });
    Object.keys(A.b).concat(Object.keys(B.b)).forEach(id => { t.b[id] = joinEntry(A.b[id], B.b[id]); });
    Object.keys(A.w).concat(Object.keys(B.w)).forEach(id => {
      const x = A.w[id] || {}, y = B.w[id] || {};
      t.w[id] = {};
      Object.keys(x).concat(Object.keys(y)).forEach(k => { t.w[id][k] = joinEntry(x[k], y[k]); });
    });
    const v = writeTombs(t, now);
    const sameAsLocal = a !== null && a !== undefined && canon(v) === canon(a);
    const sameAsCloud = b !== null && b !== undefined && canon(v) === canon(b);
    return { ok: true, v: sameAsLocal ? a : v, sameAsLocal, sameAsCloud };
  }
  /* 這一份(題庫:key 給 null)有沒有被標記刪掉 */
  function tombHit(T, id, key, hash) {
    const vb = isPlain(T) && isPlain(T.vgame_banks) ? T.vgame_banks : null;
    if (!vb) return false;
    const e = key === null ? (isPlain(vb.b) ? vb.b[id] : null) : (isPlain(vb.w) && isPlain(vb.w[id]) ? vb.w[id][key] : null);
    if (!isPlain(e)) return false;
    return (Array.isArray(e.h0) && e.h0.indexOf(hash) >= 0) || (Array.isArray(e.hs) && e.hs.indexOf(hash) >= 0);
  }
  /* 套用字的標記:拿掉對得上的字,題庫吸收被拿掉之前那一版(之後刪題庫時,別台的那一版也對得上) */
  function stripWords(bank, T) {
    const vb = isPlain(T) && isPlain(T.vgame_banks) && isPlain(T.vgame_banks.w) ? T.vgame_banks.w : null;
    const tw = vb && isPlain(vb[bank.id]) ? vb[bank.id] : null;
    if (!tw || !Array.isArray(bank.words)) return bank;
    let at = -1;
    const words = bank.words.filter(w => {
      if (!isWord(w)) return true;
      const k = norm(w.en);
      if (!tombHit(T, bank.id, k, wordHash(w))) return true;
      at = Math.max(at, readEntry(tw[k]).at);
      return false;
    });
    if (words.length === bank.words.length) return bank;
    const out = Object.assign({}, bank, { words });
    put(out, '_p', normP([pEntry(bankHash(bank), at)].concat(pList(bank._p)), bankHash(out), BANK_P_MAX, bank._t));
    return out;
  }

  /* ---------- 題庫合併 ----------
     以 id 對應;只有一邊有的留下(再套刪除標記);兩邊都有就字取聯集、名稱看誰新。
     同一份裡同一個 id 出現兩次(不該發生)也合成一個。不是物件、或沒有字串 id 的元素:用內容去重後全部留下,不合併。
     順序:本機那份的順序,雲端多出來的接在後面(順序不算進比較,兩台順序不同不會一直互傳)。 */
  function banks(a, b, ctx) {
    if ((a !== null && a !== undefined && !Array.isArray(a)) || (b !== null && b !== undefined && !Array.isArray(b))) return { ok: false };
    const T = ctx && isPlain(ctx.tombs) ? ctx.tombs : null;
    const order = [], copies = new Map(), opaque = new Map();
    [a || [], b || []].forEach(arr => arr.forEach(x => {
      if (isBank(x)) {
        if (!copies.has(x.id)) { copies.set(x.id, []); order.push('b' + x.id); }
        copies.get(x.id).push(x);
      } else {
        const c = canon(x);
        if (!opaque.has(c)) { opaque.set(c, x); order.push('o' + c); }
      }
    }));
    const v = [];
    order.forEach(k => {
      if (k.charAt(0) === 'o') { v.push(opaque.get(k.slice(1))); return; }
      const id = k.slice(1);
      /* 先拿掉被刪的字;拿掉前或拿掉後的樣子對得上題庫的標記,這一份就不要(刪題庫的那台當時看到的就是拿掉字之後的樣子) */
      const live = copies.get(id).map(x => {
        const sx = stripWords(x, T);
        return tombHit(T, id, null, bankHash(x)) || (sx !== x && tombHit(T, id, null, bankHash(sx))) ? null : sx;
      }).filter(Boolean);
      if (live.length) v.push(live.reduce(joinBank));
    });
    const s = stateKey(v);
    const sameAsLocal = Array.isArray(a) && s === stateKey(a);
    const sameAsCloud = Array.isArray(b) && s === stateKey(b);
    return { ok: true, v: sameAsLocal ? a : v, sameAsLocal, sameAsCloud };
  }
  /* 比較用:不看題庫和字的順序,其他(含 _p、_t、alt)都算 */
  function stateKey(arr) {
    if (!Array.isArray(arr)) return canon(arr);
    const wf = [], op = [];
    arr.forEach(x => {
      if (!isBank(x)) { op.push(canon(x)); return; }
      const c = Object.assign({}, x);
      if (Array.isArray(x.words)) c.words = x.words.map(w => wordKey(w) + '\u0000' + canon(w)).sort();
      wf.push(canon(c));
    });
    return canon([wf.sort(), op.filter((c, i, l) => l.indexOf(c) === i).sort()]);
  }

  /* ---------- 模擬考紀錄(mock_history) ----------
     取聯集;同一筆看 [d, size, lRaw, rRaw, lScore, rScore](跟 feat/move 的 mock 一樣);照 d 排序,留最後 300 筆。
     不照 js/mock.js 的 30 筆裁:d 是那台的時鐘,時鐘錯了(RTC 沒電、手動設錯)的裝置剛考完的那一筆日期最舊,會被裁掉,
     而且合併結果跟雲端一樣、寫回本機,那次考試就哪裡都沒有了(main 整份上傳會留著)。要讓兩台合併的結果一樣只能用 d 排,
     所以上限放寬到 300 筆(大約 40 KB),時鐘要錯得比 300 次考試的時間跨度還多才會裁到。mock.js 交卷時本機照舊留 30 筆,
     下一次合併會從雲端補回來;頁面只顯示最後 8 筆。
     沒有刪除,不用標記。 */
  function mock(a, b) {
    if ((a !== null && a !== undefined && !Array.isArray(a)) || (b !== null && b !== undefined && !Array.isArray(b))) return { ok: false };
    const id = r => (isPlain(r) ? canon([r.d, r.size, r.lRaw, r.rRaw, r.lScore, r.rScore]) : canon(r));
    const seen = new Map();
    (a || []).concat(b || []).forEach(r => {
      const k = id(r);
      if (!seen.has(k) || canon(r) < canon(seen.get(k))) seen.set(k, r);
    });
    const d = r => (isPlain(r) && typeof r.d === 'string' ? r.d : '');
    const v = Array.from(seen.entries()).sort((x, y) => cmp(d(x[1]), d(y[1])) || cmp(x[0], y[0])).map(e => e[1]).slice(-MOCK_MAX);
    const sameAsLocal = Array.isArray(a) && canon(v) === canon(a);
    const sameAsCloud = Array.isArray(b) && canon(v) === canon(b);
    return { ok: true, v: sameAsLocal ? a : v, sameAsLocal, sameAsCloud };
  }

  /* ---------- 新版頁面寫入時用的(js/vocab.js、js/reading.js) ----------
     都回新的物件或陣列,不改輸入。改到內容才蓋戳記:改前的雜湊放進 _p、_t 換成現在;沒改到就回原本那一份(不用寫、不上傳) */
  function newBankId(now) { return 'b' + Math.floor(now).toString(36) + rnd(3); }
  function newBank(id, name, now) { return { id, name, words: [], _r: rnd(6), _t: now, _nt: now }; }
  /* 新字只多 _r(不寫 on: true、不寫 _t):批次加字一次幾千個字,每個字多 _t 和 on 會讓題庫變成 main 的 1.7 倍,
     256 KB 的上限從約 4800 字掉到約 2900 字。on 沒寫就是勾選(每個讀的地方都是 on !== false);_t 只在兩台同時改同一個字時
     決定誰當主要,沒有 _t 就比內容(兩台算出來一樣)。改過的字(reviseWord)才有 _t、_p。字的 _r 4 碼(題庫 6 碼):
     只用來分「刪掉又加回一模一樣的字」,36^4 種夠了。now 不用,留著參數給呼叫的人 */
  function newWord(en, zh, now) { return { en, zh, _r: rnd(4) }; }
  function reviseWord(w, patch, now) {
    const next = Object.assign({}, w, patch);
    if (own(patch, 'alt')) put(next, 'alt', altList(patch.alt).slice().sort());
    const h = wordHash(w), hn = wordHash(next);
    if (h === hn) return w;
    next._t = now;
    put(next, '_p', normP([pEntry(h, now)].concat(pList(w._p)), hn, WORD_P_MAX, now));
    return next;
  }
  function reviseBank(old, next, now) {
    if (!old) {
      const out = Object.assign({}, next);
      if (typeof out._r !== 'string') out._r = rnd(6);
      out._t = now;
      if (!isNum(out._nt)) out._nt = now;
      return out;
    }
    const h = bankHash(old), hn = bankHash(next);
    if (h === hn) return old;
    const out = Object.assign({}, next, { _t: now });
    if (next.name !== old.name) out._nt = now;
    put(out, '_p', normP([pEntry(h, now)].concat(pList(old._p), pList(next._p)), hn, BANK_P_MAX, now));
    return out;
  }
  /* 改一個題庫:fn 拿到這個題庫(沒有就是新的空題庫),回改好的題庫。沒改到內容就回原本的陣列 */
  function editBank(list, id, now, fn) {
    const arr = Array.isArray(list) ? list : [];
    const i = arr.findIndex(b => isBank(b) && b.id === id);
    const old = i >= 0 ? arr[i] : null;
    const next = fn(old ? Object.assign({}, old, { words: wordsOf(old).slice() }) : newBank(id, '', now));
    if (!isBank(next)) return arr;
    const out = reviseBank(old, next, now);
    if (out === old) return arr;
    const copy = arr.slice();
    if (i >= 0) copy[i] = out; else copy.push(out);
    return copy;
  }
  /* 批次加字:同一個英文(norm)已經有就更新中文,沒有就加新字 */
  function addWords(bank, list, now) {
    const words = wordsOf(bank).slice();
    list.forEach(p => {
      const k = norm(p.en);
      const i = words.findIndex(w => isWord(w) && norm(w.en) === k);
      if (i >= 0) words[i] = reviseWord(words[i], { zh: p.zh }, now);
      else words.push(newWord(p.en, p.zh, now));
    });
    return Object.assign({}, bank, { words });
  }
  /* 改一個字(第一個英文對得上的):patch 例如 { zh }、{ on }、{ alt } */
  function setWord(bank, key, patch, now) {
    const words = wordsOf(bank).slice();
    const i = words.findIndex(w => isWord(w) && norm(w.en) === key);
    if (i < 0) return bank;
    words[i] = reviseWord(words[i], patch, now);
    return Object.assign({}, bank, { words });
  }
  function addTomb(T, path, entry, now) {
    const t = readTombs(T) || { v: 1, other: {}, b: {}, w: {} };
    if (path[0] === 'b') t.b[path[1]] = joinEntry(t.b[path[1]], entry);
    else { t.w[path[1]] = t.w[path[1]] || {}; t.w[path[1]][path[2]] = joinEntry(t.w[path[1]][path[2]], entry); }
    return writeTombs(t, now);
  }
  const entryOf = (x, now) => ({ at: now, h0: [x.h], hs: pList(x.p).map(pHash) });
  /* 刪字:先算刪除標記(呼叫的人要先存標記、再存題庫)。hash 給了就刪雜湊對得上的那一個(同一個英文出現兩次的舊資料) */
  function deleteWord(list, T, id, key, now, hash) {
    const bank = (Array.isArray(list) ? list : []).find(b => isBank(b) && b.id === id);
    const words = bank ? wordsOf(bank) : [];
    let i = words.findIndex(w => isWord(w) && norm(w.en) === key && (!hash || wordHash(w) === hash));
    if (i < 0) i = words.findIndex(w => isWord(w) && norm(w.en) === key);
    if (i < 0) return { banks: list, tombs: T };
    const w = words[i];
    const tombsOut = addTomb(T, ['w', id, key], { at: now, h0: [wordHash(w)], hs: pList(w._p).map(pHash) }, now);
    const banksOut = editBank(list, id, now, b => Object.assign({}, b, { words: wordsOf(b).filter((x, j) => j !== i) }));
    return { banks: banksOut, tombs: tombsOut };
  }
  function deleteBank(list, T, id, now) {
    const arr = Array.isArray(list) ? list : [];
    const bank = arr.find(b => isBank(b) && b.id === id);
    if (!bank) return { banks: list, tombs: T };
    const tombsOut = addTomb(T, ['b', id], entryOf({ h: bankHash(bank), p: bank._p }, now), now);
    return { banks: arr.filter(b => !(isBank(b) && b.id === id)), tombs: tombsOut };
  }

  root.SYNC_MERGE = Object.freeze({
    canon, quickHash, norm, stateKey, bankHash, wordHash, tombHit, zhDiffers,
    banks, tombs, mock,
    newBankId, newBank, newWord, reviseWord, reviseBank, editBank, addWords, setWord, deleteWord, deleteBank,
  });
})(typeof window !== 'undefined' ? window : globalThis);
