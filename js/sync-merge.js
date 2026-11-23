/* 同一個帳號多台裝置的合併規則。純計算,不讀寫儲存,window.SYNC_MERGE。
   js/cloud.js 的 MERGED 表用它:vgame_banks(自訂題庫)、sync_del(刪除標記)、mock_history(模擬考紀錄)、mock_wrong(模擬考錯題)、
   課程的 les_t<期>_<堂>、pts、rvq、tests_v1 上傳前先讀雲端、合併、再上傳;
   灌雲端資料時本機和雲端都有就存合併結果。每一頁都要在 cloud.js 之前載入(tools/test_sync_union.js 檢查)。
   合併函式的約定跟 PET.cloudMerge 一樣:回 { ok, v, sameAsLocal, sameAsCloud };形狀認不得回 { ok: false }(唯讀:不合併、不上傳、帳本留著)。
   原則:
   - 少了不算刪除。一份有、另一份沒有的題庫和字一律留下;只有刪除標記(sync_del)對得上的那一份才刪。
     舊陣列整份寫回、舊版頁面整份上傳、讀到一半的資料,都只會讓東西「多回來」,不會少。
   - 刪除標記只刪「刪的時候那個樣子」:記刪的那一份的內容雜湊(h0)和它吸收過的舊版本(hs);別台在那之後改過的,雜湊對不上,留著。
     hs 只刪有 _r 的(新版做的版本);沒有 _r 的(舊版頁面、部署前的資料)只有 h0 刪得掉,舊版頁面重新加回的不會被當成舊版本刪掉。
   - 合併結果跟參數順序無關、重複合併不變、合併結果再跟任一份合併也不變(兩台各自合併會收斂,不會一直互傳)。
   - 時鐘只拿來決定「同一個欄位兩邊都改了誰當主要」,輸的那個中文放進 alt,不丟。
   題庫多的欄位(舊版頁面看不懂,但改的時候是改物件本身,會原樣留著):
   - _r:新版建立題庫(6 碼)或字(4 碼)時給的隨機碼,算進內容雜湊(刪掉又加回一模一樣的字,雜湊不同,不會被舊標記刪掉)。
     字和題庫的 _r 每次改內容都換一個(reviseWord、reviseBank):改回以前的樣子、兩台打了同一個中文,也不會跟哪一個舊版本同一個雜湊。
   - _t:新版最後一次改它的時間(新加的字沒有,改過才有);_nt:題庫名稱最後一次改的時間;_nr:新版每次改名給的隨機碼(4 碼);
     _nl:這個名稱之前那些名稱版本的代號(名稱 + _nr 的雜湊,最多 8 個)。都不算進雜湊。(這個分支早期的 _on 當成 _nl 的一個來讀,不再寫)
     名稱:只有一份是從另一份現在的名稱改過來的(另一份的代號在它的 _nl 裡)就用它(不看時鐘、改幾次都認得、改回以前的名稱也認得);
     不然一份是另一份的新版本就用新版本的名稱;兩台都改了名才比 _nt;_nt 也一樣(舊版頁面就地改名):本機沒改過時用雲端那份,
     不然用主要那份。
   - banks 的 ctx.localClean:本機那份(第一個參數)上次跟雲端對齊之後沒改過(cloud.js 看帳本)。舊版頁面就地改名、取消勾選、改中文
     不動戳記,兩份分不出先後(_t 一樣)時用雲端那份當主要,不比字串。中文衝突時本機的照樣放 alt。
   - _p:它吸收過的舊版本,「雜湊.時間(36 進位毫秒)」;時間是吸收的那一刻(新版本的 _t)。這一版那一刻吸收的一定留(最多 16 個),
     其他的留最新的,題庫補到 8 個、字補到 4 個。用來判斷「另一份是不是我的舊版本」(看雜湊,所以字每一版的雜湊都要不一樣:改內容換 _r)。
   - alt(字):兩台同時改了同一個字的中文,沒當主要的那個(不設上限:以前排序後只留 3 個,會把學生剛打的丟掉)。
     編輯頁全部顯示「另一台寫的」,可以換或刪。
   跟 feat/move 共用:canon、quickHash 跟 js/move-merge.js 同一個函式;mock 的「同一筆」判斷一樣(兩個分支都進 main 後只留這一份)。
   題庫規則跟 js/move-merge.js 的 mergeBanks 不一樣(那邊是訪客、本機學生的搬家:同一個 id 兩邊都真的改了就複製一份「（舊網址）」;
   只差戳記、或戳記看得出誰是新版本時不複製,用這裡的 bankHash、banks 判斷)。雲端帳號的搬家暫存區(js/cloud.js takePending、
   js/move-merge.js 的暫存區合併)上合併表的鍵用這裡的函式;sync_del 的搬家規則是 tombs(js/move-rules.js)。tools/test_sync_move_compat.js 會擋。 */
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
  /* 兩份都不是對方的舊版本時,誰當主要:_t 大的;一樣時 pref(本機沒改過時的雲端那份,見 banks 的 localClean)優先,
     沒有 pref 就比內容固定選一個(兩台算出來一樣) */
  function primary(x, y, content, pref) {
    const tx = isNum(x._t) ? x._t : 0, ty = isNum(y._t) ? y._t : 0;
    if (tx !== ty) return tx > ty ? [x, y] : [y, x];
    if (pref === x || pref === y) return pref === x ? [x, y] : [y, x];
    return canon(content(x)) >= canon(content(y)) ? [x, y] : [y, x];
  }
  /* 兩份都不是對方的舊版本、合併結果卻跟其中一份一模一樣(只差 _r、只差勾選、另一個中文是主要那個的一種寫法):
     加一個合併記號 _m(兩份雜湊算出來的,算進內容雜湊),讓結果跟兩份都不同。不然別台刪掉其中一份時(刪除標記記的是那一份的雜湊),
     連帶把另一份(別台在刪之後才加的、改的)一起刪掉。別台在那之後改過的,留著 */
  function mark(out, hx, hy, hashOf) {
    const h = hashOf(out);
    if (h === hx || h === hy) out._m = quickHash([hx, hy].sort().join('+'));
  }
  /* 誰是新版本:y 吸收過 x(x 的雜湊在 y 的 _p)→ y。兩邊互相吸收過(內容改回以前的樣子,例如刪掉 alt 後跟某一版一樣):
     兩份的內容都在對方的歷史裡,沒有誰是新的另一份,用 _t 大的當新版本(題庫用;字在 joinWord 另外處理,輸的中文放 alt) */
  function newer(x, y, hx, hy, content, pref) {
    const yx = hasP(y._p, hx), xy = hasP(x._p, hy);
    if (yx && xy) return primary(x, y, content, pref)[0];
    if (yx) return y;
    if (xy) return x;
    return null;
  }
  function joinWord(x, y, pref) {
    if (canon(x) === canon(y)) return x;
    const hx = wordHash(x), hy = wordHash(y);
    const t = maxT(x._t, y._t);
    let out, imm;
    if (hx === hy) {
      out = Object.assign({}, canon(x) <= canon(y) ? x : y);
      imm = [];
    } else {
      const yx = hasP(y._p, hx), xy = hasP(x._p, hy);
      if (yx && xy) {
        /* 互相吸收過(改回以前某一版的樣子,例如改回原本的中文、刪掉 alt 後跟某一版一樣):分不出哪個是後來改的,_t 大的當主要;
           另一個的中文跟主要的不一樣就放 alt(以前不放:改回去那台時鐘慢時,學生後來打的中文哪裡都沒有了)。
           另一個的 alt 不帶進來(刪掉 alt 之後跟某一版一樣,刪掉的不會回來) */
        const [p, q] = primary(x, y, wordContent, pref);
        out = Object.assign({}, p);
        const alt = altList(p.alt).concat(zhDiffers(q.zh, p.zh) ? [String(q.zh)] : []).filter((z, i, l) => l.indexOf(z) === i).sort();
        put(out, 'alt', alt);
        imm = [pEntry(hx, t), pEntry(hy, t)];
      } else if (yx || xy) {
        const win = yx ? y : x;
        out = Object.assign({}, win);
        imm = [pEntry(win === x ? hy : hx, t)];
      } else {
        const [p, q] = primary(x, y, wordContent, pref);
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
  /* 重複英文那一組裡留下的字 [雜湊, 字] 收下輸給它的那些(losers)的中文:跟它不一樣的放 alt(輸的 alt 不帶進來,跟 joinWord 一樣)。
     有新的 alt 才換成新版本:_p 記下它和輸的那些(之後再跟它們合併,認得出是舊版本,結果不變);沒有新的就原樣回它 */
  function absorbZh([h, w], losers) {
    const have = altList(w.alt);
    const add = losers.map(([, l]) => l.zh).filter(z => zhDiffers(z, w.zh)).map(String).filter(z => have.indexOf(z) < 0);
    if (!add.length) return w;
    const out = Object.assign({}, w);
    put(out, 'alt', have.concat(add).filter((z, i, l) => l.indexOf(z) === i).sort());
    const t = losers.reduce((m, [, l]) => maxT(m, l._t), w._t);
    put(out, '_t', t);
    const imm = [pEntry(h, t)].concat(losers.map(([hl]) => pEntry(hl, t)));
    put(out, '_p', normP(losers.reduce((p, [, l]) => p.concat(pList(l._p)), imm.concat(pList(w._p))), wordHash(out), WORD_P_MAX, t));
    return out;
  }
  /* 字取聯集:用 norm(en) 對應。同一份裡同一個英文出現兩次(舊資料)不合併成一個:兩份的都留,去掉一樣的和被吸收過的舊版本。
     side:'x' 或 'y' 是分不出先後時優先的那一份(只用在一對一的字) */
  function joinWords(xs, ys, side) {
    const gx = new Map(), gy = new Map(), order = [];
    const add = (m, w) => { const k = wordKey(w); if (!gx.has(k) && !gy.has(k)) order.push(k); (m.get(k) || m.set(k, []).get(k)).push(w); };
    xs.forEach(w => add(gx, w));
    ys.forEach(w => add(gy, w));
    const out = [];
    order.forEach(k => {
      const a = gx.get(k) || [], b = gy.get(k) || [];
      if (k.charAt(0) === 'o') { out.push(a.length ? a[0] : b[0]); return; }
      if (a.length <= 1 && b.length <= 1) { out.push(a.length && b.length ? joinWord(a[0], b[0], side === 'x' ? a[0] : side === 'y' ? b[0] : null) : (a[0] || b[0])); return; }
      const byHash = new Map();
      a.concat(b).forEach(w => { const h = wordHash(w); byHash.set(h, byHash.has(h) ? joinWord(byHash.get(h), w) : w); });
      const all = Array.from(byHash.entries());
      /* 被另一個吸收過的(舊版本)拿掉。兩個互相吸收過(取消勾選又勾回來,內容跟以前某一版一樣):跟 newer() 一樣留 primary 那個,
         不能兩個都拿掉(以前兩個都拿掉,那個字就不見了)。繞一圈吸收、沒有出口的見下面的 tops */
      const beats = ([h, w], [h2, w2]) => h2 !== h && hasP(w2._p, h) && !(hasP(w._p, h2) && primary(w, w2, wordContent)[0] === w);   // e 輸給 o(e 被拿掉)
      const drop = e => all.some(o => beats(e, o));
      /* 輸的中文(跟英文只出現一次時 joinWord 的「互相吸收過」一樣):留下的那個跟被拿掉的互相吸收過(改回以前的中文、
         改回去那台時鐘慢),被拿掉的中文放進留下那個的 alt。以前只留 primary,改回的中文哪裡都沒有了。
         被拿掉的要有人接:沿著「輸給誰」走得到某個留下的。走不到的(繞一圈吸收、沒有出口)留其中 primary 最大的那一個(top),
         走得到它的那些的中文都放進它的 alt;還有走不到的就再留一個(寧可多留)。以前只在「全部都被拿掉」時才留 top:
         同一組還有別的字(例如 Run/經營)時,繞一圈的那幾個字整組不見 */
      const kept = all.filter(e => !drop(e));
      const reaches = (e, targets) => {
        const seen = new Set([e]), queue = [e];
        while (queue.length) {
          const c = queue.shift();
          if (targets.indexOf(c) >= 0) return true;
          all.forEach(o => { if (!seen.has(o) && beats(c, o)) { seen.add(o); queue.push(o); } });
        }
        return false;
      };
      const tops = [];
      let left = all.filter(e => kept.indexOf(e) < 0 && !reaches(e, kept));
      while (left.length) {
        const top = left.reduce((p, q) => (primary(p[1], q[1], wordContent)[0] === p[1] ? p : q));
        tops.push(top);
        left = left.filter(e => e !== top && !reaches(e, [top]));
      }
      const win = (e, o) => hasP(e[1]._p, o[0]) && hasP(o[1]._p, e[0]) && primary(e[1], o[1], wordContent)[0] === e[1];
      /* 只因為「互相吸收過」輸掉的(沒有誰是從它改過來的):它輸給的那個又是別人的舊版本時,中文交給最後接住的那個。
         以前只交給直接贏它的那個,贏它的那個被拿掉,中文就跟著不見,而且結果跟合併順序有關(test_sync_fuzz 早期頁面改回找到的) */
      const ambiguous = o => !all.some(z => z !== o && hasP(z[1]._p, o[0]) && !hasP(o[1]._p, z[0]));
      const groups = kept.map(e => [e, all.filter(o => o !== e && (win(e, o) || (kept.indexOf(o) < 0 && ambiguous(o) && reaches(o, [e]))))])
        .concat(tops.map(t => [t, all.filter(o => o !== t && kept.indexOf(o) < 0 && tops.indexOf(o) < 0 && reaches(o, [t]))]));
      groups.map(([e, losers]) => absorbZh(e, losers)).sort((p, q) => cmp(canon(p), canon(q))).forEach(w => out.push(w));
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
  /* 名稱的版本:新版每次改名給一個新的 _nr(4 碼),名稱這一版的代號 = 名稱 + _nr 的雜湊
     (沒有 _nr 的舊資料就是名稱的雜湊,跟以前的 _on 一樣)。_nl 記這個名稱之前的那些版本的代號(「代號.時間」,跟 _p 同一種格式,最多 8 個):
     改名時記改之前那一版;合併時兩份的都收,沒用上的那個名稱也記(合併時看過、決定過了)。
     以前 _on 只記上一個名稱的雜湊:連改兩次名認不出「只有一台改名」(退回比 _nt,時鐘快的裝置建立時的 _nt 會贏);
     名稱改回以前用過的,也跟以前那一版分不出來。改名換 _nr,每一次改名都是新的代號 */
  const NAME_L_MAX = 8;
  const nameId = b => quickHash('n\u0000' + String(b.name) + (typeof b._nr === 'string' ? '\u0000' + b._nr : ''));
  /* 這個分支早期的資料只有 _on(上一個名稱的雜湊):當成 _nl 裡的一個(時間 0) */
  const lineage = b => pList(b._nl).concat(typeof b._on === 'string' && /^[0-9a-z]+$/.test(b._on) ? [b._on + '.0'] : []);
  /* x 的名稱是從 y 現在的名稱改過來的(y 的代號在 x 的 _nl 裡)、y 沒看過 x 的名稱。
     y 自己的代號在 y 的 _nl 裡時不算:那是舊版頁面就地把名稱改回以前那一版(_nr、_nl 是抄來的,分不出誰新) */
  const renamedFrom = (x, y, lx, ly) => hasP(lx, nameId(y)) && !hasP(ly, nameId(x)) && !hasP(ly, nameId(y));
  function joinBank(x, y, pref) {
    if (canon(x) === canon(y)) return x;
    const hx = bankHash(x), hy = bankHash(y);
    const t = maxT(x._t, y._t), nt = maxT(x._nt, y._nt);
    const win = hx === hy ? (canon(x) <= canon(y) ? x : y) : newer(x, y, hx, hy, bankContent, pref);
    const bp = win || primary(x, y, bankContent, pref)[0];
    /* 名稱(用哪一份的 name 和 _nr):
       1. 只有一份是從另一份現在的名稱改過來的(另一份的代號在它的 _nl 裡)→ 用改過的那份,不看時鐘、也不看誰是新版本
          (以前比 _nt:時鐘快的裝置建立題庫時的 _nt、或時鐘慢的裝置改名,都會讓真的改名被退回,名稱沒有 alt,永遠回不來);
       2. 一份是另一份的新版本(win)就用它的(舊版頁面就地改名:代號不在誰的 _nl 裡);
       3. 兩台都改了名(或都沒有 _nl 可以判斷):_nt 大的;
       4. _nt 也一樣(舊版頁面就地改名,戳記沒動):本機沒改過(pref)就用雲端那份的名稱,不跟著主要那份(
          主要那份看整個題庫的 _t,新版那台之前改過別的字、已經上傳,_t 比舊版頁面那份大,舊版的改名就被退回,而且每台都是舊名稱;
          本機沒改過時名稱不一樣一定是別台改的);沒有 pref 才用主要那份(bp) */
    let src = bp;
    const ix = nameId(x), iy = nameId(y), lx = lineage(x), ly = lineage(y);
    if (ix !== iy) {
      const fx = renamedFrom(x, y, lx, ly), fy = renamedFrom(y, x, ly, lx);
      const nx = isNum(x._nt) ? x._nt : 0, ny = isNum(y._nt) ? y._nt : 0;
      if (fx !== fy) src = fx ? x : y;
      else if (!win && x.name !== y.name && nx !== ny) src = nx > ny ? x : y;
      else if (!win && x.name !== y.name && (pref === x || pref === y)) src = pref;
    }
    const out = Object.assign({}, bp);
    put(out, 'name', src.name);
    put(out, '_nr', src._nr);
    delete out._on;
    put(out, '_nl', normP([pEntry(ix, nt), pEntry(iy, nt)].concat(lx, ly), nameId(out), NAME_L_MAX, nt));
    if (x.words !== undefined || y.words !== undefined) out.words = joinWords(wordsOf(x), wordsOf(y), pref === x ? 'x' : pref === y ? 'y' : null);
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
     套用:h0 對得上就刪;hs 只刪有 _r 的那一份(見 tombHit)。
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
  /* 這一份(題庫:key 給 null)有沒有被標記刪掉。h0(刪的那份)對得上就刪;hs(它吸收過的舊版本)只刪有 _r 的(withR 給 false 就不看 hs)。
     沒有 _r 的是舊版頁面或部署前的資料:舊版頁面重新加回的(文章題庫的內容是固定的,照著存一定一模一樣)跟被刪那一份吸收過的舊版本
     分不出來,寧可留著。代價:在新版改過再刪的舊資料,舊版頁面或很久沒同步的裝置還留著改之前那份時
     會帶回改之前那份(只會多,再刪一次就是 h0)。有 _r 的是新版做的版本,_r 每一版都不一樣,對得上就一定是那個舊版本 */
  function tombHit(T, id, key, hash, withR) {
    const vb = isPlain(T) && isPlain(T.vgame_banks) ? T.vgame_banks : null;
    if (!vb) return false;
    const e = key === null ? (isPlain(vb.b) ? vb.b[id] : null) : (isPlain(vb.w) && isPlain(vb.w[id]) ? vb.w[id][key] : null);
    if (!isPlain(e)) return false;
    return (Array.isArray(e.h0) && e.h0.indexOf(hash) >= 0) || (withR !== false && Array.isArray(e.hs) && e.hs.indexOf(hash) >= 0);
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
      if (!tombHit(T, bank.id, k, wordHash(w), typeof w._r === 'string')) return true;
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
    const clean = !!(ctx && ctx.localClean === true);
    const order = [], copies = new Map(), opaque = new Map();
    [a || [], b || []].forEach((arr, src) => arr.forEach(x => {
      if (isBank(x)) {
        if (!copies.has(x.id)) { copies.set(x.id, []); order.push('b' + x.id); }
        copies.get(x.id).push({ v: x, src });
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
      const live = copies.get(id).map(({ v: x, src }) => {
        const sx = stripWords(x, T);
        return tombHit(T, id, null, bankHash(x), typeof x._r === 'string') || (sx !== x && tombHit(T, id, null, bankHash(sx), typeof sx._r === 'string')) ? null : { v: sx, src };
      }).filter(Boolean);
      /* localClean:本機那份(a)上次跟雲端對齊之後沒改過(帳本上沒有),雲端(b)跟它不一樣就是別台改的。
         舊版頁面就地改名、取消勾選、改中文不動戳記,兩份分不出先後:這時用雲端那份當主要(中文衝突時本機的照樣放 alt)。
         同一份裡同一個 id 出現兩次合出來的(src 2)不偏哪一邊 */
      if (live.length) v.push(live.reduce((p, q) => {
        const pref = !clean || p.src === q.src || p.src === 2 || q.src === 2 ? null : p.src === 1 ? p.v : q.v;
        return { v: joinBank(p.v, q.v, pref), src: p.src === q.src ? p.src : 2 };
      }).v);
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

  /* ---------- 模擬考錯題(mock_wrong,2026-11-18) ----------
     { 題目 key: { c: 選的, ok: false 答錯 / true 已訂正, t: 毫秒 } },每題一筆,跟 drill_p*、listen_p* 一樣的形狀(js/wrongbook.js 讀)。
     取聯集:一份有、另一份沒有的一律留;同一題形狀對(一般物件、t 是有限數字)的贏形狀不對的,都對時 t 大的贏,
     t 一樣或都不對時取 canon 字串小的(兩台合出來一樣)。沒有刪除,不用標記。
     超過 MOCK_WRONG_MAX 筆(題庫超過 1500 題才會碰到):照「ok:false 在前、t 新的在前、key 字典序」留前面的;先丟的是最舊的已訂正記號
     (丟了只會讓一題冒回錯題本)。輸出的 key 照字典序排。第三個參數(cloud.js 給的 now)不用 */
  const MOCK_WRONG_MAX = 1500;
  function mockWrong(a, b) {
    const okShape = x => x === null || x === undefined || isPlain(x);
    if (!okShape(a) || !okShape(b)) return { ok: false };
    const A = a || {}, B = b || {};
    const good = r => isPlain(r) && isNum(r.t);
    const win = (x, y) => {
      const gx = good(x), gy = good(y);
      if (gx !== gy) return gx ? x : y;
      if (gx && x.t !== y.t) return x.t > y.t ? x : y;
      return canon(x) <= canon(y) ? x : y;
    };
    const out = new Map();
    keysOf(A).forEach(k => out.set(k, A[k]));
    keysOf(B).forEach(k => out.set(k, out.has(k) ? win(out.get(k), B[k]) : B[k]));
    let ks = Array.from(out.keys());
    if (ks.length > MOCK_WRONG_MAX) {
      const bucket = r => (good(r) ? (r.ok === false ? 0 : 1) : 2);
      ks = ks.sort((x, y) => {
        const rx = out.get(x), ry = out.get(y);
        return bucket(rx) - bucket(ry) || (good(rx) && good(ry) ? ry.t - rx.t : 0) || cmp(x, y);
      }).slice(0, MOCK_WRONG_MAX);
    }
    const v = {};
    ks.sort(cmp).forEach(k => { v[k] = out.get(k); });
    const s = canon(v);
    const sameAsLocal = isPlain(a) && s === canon(a);
    const sameAsCloud = isPlain(b) && s === canon(b);
    return { ok: true, v: sameAsLocal ? a : v, sameAsLocal, sameAsCloud };
  }

  /* ---------- 課程(js/pack-core.js、js/lesson-rules.js 寫):les_t<期>_<堂>、pts、rvq、tests_v1 ----------
     形狀見那兩個檔的檔頭。都是一份是 null 就用另一份;形狀不對的那份當成沒有,兩份都不對回 ok:false;lesson 的 v 不是 1 回 ok:false。
     · lesson(一堂的進度):開始時間早的那份為主。兩份的 levels、lessonId、packVersion 一樣時:段以交卷或略過優先(都交卷取早的);
       凍結選題取凍結得早的,個人段(回顧 80–84、弱點補練 85–89、測驗檢討 90–97,跟 js/pack-core.js 的 RESERVED 一樣)整段取同一份,
       不把兩台照不同計畫選的區塊拼在一起;作答以(區塊、題、小題)聯集,同一題取作答時間早的;所有段都交卷或略過而 doneAt 是空的,
       補成各段交卷時間最晚的那個。不一樣(兩台用不同的級開同一堂):只留主要那份,另一份只併入題目對得上主要那份凍結選題的作答,
       其他的丟掉(dropped 是丟掉幾筆)。
     · pts(考點狀態):hits 以批次編號 b 聯集(同一批取題數多的),pauseUntil 取晚的(批數上限跟 js/lesson-rules.js 的 HITS_MAX 一樣);s 是寫入時算的快取:合併後跟其中一份一樣就用那份的,
       不然用最近作答日期晚的那份的(課程頁讀的時候一律重算,js/lesson-rules.js mergePts)。每個考點最多 PTS_HITS_MAX 批(留新的)。
     · rvq(回顧佇列):同一項取新的:d0(答錯或過關那天)晚的、一樣時 step 大的;帶 x 的是做完移出的刪除紀錄,一樣新時刪除紀錄贏。
       佇列裡的項目最多 300 筆(留 d0 新的),刪除紀錄最多 600 筆;刪除紀錄保留幾天由 js/lesson-rules.js 整理(這裡不看日期)。
     · tests(tests_v1):同一期同一次測驗取 at 早的(第一次交卷)。 */
  const COURSE_GROUPS = [[80, 85], [85, 90], [90, 98]], PTS_HITS_MAX = 400, RVQ_LIVE_MAX = 300, RVQ_GONE_MAX = 600, LES_DT = 5;
  const setCanon = arr => canon(arr.map(canon).sort());
  function course(fn, shape, eq, versioned) {
    const same = eq || ((x, y) => canon(x) === canon(y));
    return function (a, b) {
      const none = x => x === null || x === undefined;
      if (versioned && [a, b].some(x => isPlain(x) && own(x, 'v') && x.v !== 1)) return { ok: false };
      if (none(a) && none(b)) return { ok: true, v: null, sameAsLocal: a === null, sameAsCloud: b === null };
      const ga = !none(a) && shape(a), gb = !none(b) && shape(b);
      if (!ga && !gb) return { ok: false };
      const r = ga && gb ? fn(a, b) : { v: ga ? a : b };
      const sameAsLocal = ga && same(r.v, a), sameAsCloud = gb && same(r.v, b);
      const out = { ok: true, v: sameAsLocal ? a : sameAsCloud ? b : r.v, sameAsLocal, sameAsCloud };
      if (r.dropped) out.dropped = r.dropped;
      return out;
    };
  }
  const intOr = (x, d) => (Number.isInteger(x) ? x : d);
  const SEG_RANK = { todo: 0, doing: 1, skip: 2, done: 3 };
  function joinSeg(x, y) {
    if (!isPlain(x) || !isPlain(y)) return isPlain(x) ? x : y;
    const t0 = [x.t0, y.t0].filter(Number.isInteger).sort((p, q) => p - q)[0];
    const rx = SEG_RANK[x.st] || 0, ry = SEG_RANK[y.st] || 0;
    const win = ry > rx || (ry === rx && Number.isInteger(y.t1) && (!Number.isInteger(x.t1) || y.t1 < x.t1)) ? y : x;
    return { st: win.st, t0: t0 === undefined ? null : t0, t1: intOr(win.t1, null) };
  }
  const lessonShape = s => isPlain(s) && Number.isInteger(s.startedAt) && isPlain(s.seg) && isArr(s.a);
  const rowKey = x => x[0] + '|' + x[1] + '|' + x[2];
  /* 凍結選題:一般區塊各自取凍結早的;個人段一整段取最早凍結的那一份 */
  function joinPk(list) {
    const pk = {}, at = {}, pkOf = s => (isPlain(s.pk) ? s.pk : {});
    const group = k => COURSE_GROUPS.findIndex(g => k >= g[0] && k < g[1]);
    const absOf = (s, e) => s.startedAt + (isNum(e.at) ? e.at : 0);
    const sig = (s, e) => canon(Object.assign({}, e, { at: absOf(s, e) }));   // 比較用:時間換成絕對時間,合併前後一樣
    /* 每一份的每個個人段:最早凍結的時間與整段的內容,先凍結的那份贏(一樣早比內容) */
    const best = {};
    list.forEach((s, i) => {
      const by = {};
      keysOf(pkOf(s)).sort().forEach(k => {
        const e = pkOf(s)[k], g = group(Number(k));
        if (!isPlain(e) || g < 0) return;
        const o = by[g] || (by[g] = { abs: Infinity, sig: '' });
        o.abs = Math.min(o.abs, absOf(s, e));
        o.sig += k + '=' + sig(s, e) + ';';
      });
      keysOf(by).forEach(g => { const o = by[g]; if (!best[g] || o.abs < best[g].abs || (o.abs === best[g].abs && o.sig < best[g].sig)) best[g] = Object.assign({ i }, o); });
    });
    list.forEach((s, i) => keysOf(pkOf(s)).forEach(k => {
      const e = pkOf(s)[k], g = group(Number(k));
      if (!isPlain(e) || (g >= 0 && best[g].i !== i)) return;
      const abs = absOf(s, e);
      if (!pk[k] || abs < at[k] || (abs === at[k] && sig(s, e) < canon(Object.assign({}, pk[k], { at: at[k] })))) { pk[k] = e; at[k] = abs; }
    }));
    return { pk, at };
  }
  function lesson2(a, b) {
    const id = s => canon([s.levels, s.lessonId, s.packVersion]);
    const rest = s => { const o = Object.assign({}, s); ['seg', 'pk', 'a', 'doneAt'].forEach(k => delete o[k]); return canon(o); };
    const aFirst = a.startedAt !== b.startedAt ? a.startedAt < b.startedAt : id(a) !== id(b) ? id(a) < id(b) : rest(a) <= rest(b);
    const [p, q] = aFirst ? [a, b] : [b, a];
    const start = p.startedAt;
    const same = id(p) === id(q);
    const j = joinPk(same ? [p, q] : [p]), pk = {};
    keysOf(j.pk).forEach(k => { pk[k] = Object.assign({}, j.pk[k], { at: j.at[k] - start }); });
    const fits = x => same || (isPlain(pk[x[0]]) && isArr(pk[x[0]].ids) && pk[x[0]].ids.indexOf(x[1]) > -1);
    const rows = new Map();
    let dropped = 0;
    [p, q].forEach(s => s.a.forEach(x => {
      if (!isArr(x) || !Number.isInteger(x[0]) || typeof x[1] !== 'string' || !Number.isInteger(x[LES_DT])) return;
      if (s === q && !fits(x)) { dropped++; return; }
      const abs = s.startedAt + x[LES_DT], o = rows.get(rowKey(x));
      if (!o || abs < o.abs || (abs === o.abs && canon(x.slice(0, LES_DT)) < canon(o.x.slice(0, LES_DT)))) rows.set(rowKey(x), { abs, x });
    }));
    const list = Array.from(rows.values()).sort((m, n) => m.abs - n.abs || cmp(rowKey(m.x), rowKey(n.x)));
    const seg = {};
    if (same) new Set(keysOf(p.seg).concat(keysOf(q.seg))).forEach(k => { seg[k] = joinSeg(p.seg[k], q.seg[k]); });
    else keysOf(p.seg).forEach(k => { seg[k] = p.seg[k]; });
    const segs = keysOf(seg).map(k => seg[k]);
    const dones = (same ? [p.doneAt, q.doneAt] : [p.doneAt]).filter(Number.isInteger).sort((m, n) => m - n);
    const all = segs.length > 0 && segs.every(x => isPlain(x) && (x.st === 'done' || x.st === 'skip'));
    const doneAt = dones.length ? dones[0] : all ? Math.max.apply(null, segs.map(x => intOr(x.t1, start))) : null;
    const v = Object.assign({}, p, { v: 1, startedAt: start, doneAt, seg, pk, a: list.map(r => r.x.slice(0, LES_DT).concat([r.abs - start])) });
    return { v, dropped };
  }
  const hitOk = h => isPlain(h) && typeof h.b === 'string' && typeof h.d === 'string' && isNum(h.n) && isNum(h.ok);
  const hitsOf = e => (isArr(e.hits) ? e.hits.filter(hitOk) : []);
  const lastDay = e => hitsOf(e).reduce((m, h) => (h.d > m ? h.d : m), '');
  function pts2(A, B) {
    const out = {};
    new Set(keysOf(A).concat(keysOf(B))).forEach(k => {
      const x = isPlain(A[k]) ? A[k] : null, y = isPlain(B[k]) ? B[k] : null;
      if (!x || !y) { if (x || y) out[k] = x || y; return; }
      const by = new Map();
      hitsOf(x).concat(hitsOf(y)).forEach(h => {
        const o = by.get(h.b);
        if (!o || h.n > o.n || (h.n === o.n && canon(h) < canon(o))) by.set(h.b, h);
      });
      const hits = Array.from(by.values()).sort((m, n) => cmp(m.d, n.d) || cmp(m.b, n.b)).slice(-PTS_HITS_MAX);
      const pu = [x.pauseUntil, y.pauseUntil].filter(s => typeof s === 'string').sort().pop() || null;
      const like = [x, y].filter(e => setCanon(hitsOf(e)) === setCanon(hits) && (e.pauseUntil || null) === pu).sort((m, n) => cmp(canon(m), canon(n)))[0];
      const sOf = (lastDay(x) !== lastDay(y) ? (lastDay(x) > lastDay(y) ? x : y) : canon(x.s) <= canon(y.s) ? x : y).s;
      out[k] = like || { s: sOf, hits, pauseUntil: pu };
    });
    return { v: out };
  }
  const rvqOk = e => isPlain(e) && typeof e.d0 === 'string' && (typeof e.k === 'string' || (typeof e.m === 'string' && typeof e.id === 'string'));
  const rvqId = e => (typeof e.k === 'string' ? 'k|' + e.k : 'i|' + e.m + '|' + e.id + '|' + (e.sub === undefined || e.sub === null ? '' : e.sub));
  function rvqNewer(x, y) {
    const sx = isNum(x.step) ? x.step : 0, sy = isNum(y.step) ? y.step : 0;
    if (x.d0 !== y.d0) return x.d0 > y.d0 ? x : y;
    if (sx !== sy) return sx > sy ? x : y;
    if (!!x.x !== !!y.x) return x.x ? x : y;
    return canon(x) <= canon(y) ? x : y;
  }
  function rvq2(A, B) {
    const by = new Map();
    A.concat(B).forEach(e => { if (rvqOk(e)) by.set(rvqId(e), by.has(rvqId(e)) ? rvqNewer(by.get(rvqId(e)), e) : e); });
    const all = Array.from(by.values()), order = (f) => (m, n) => cmp(f(n), f(m)) || cmp(rvqId(m), rvqId(n));
    const live = all.filter(e => !e.x).sort(order(e => e.d0)).slice(0, RVQ_LIVE_MAX);
    const gone = all.filter(e => e.x).sort(order(e => String(e.x))).slice(0, RVQ_GONE_MAX);
    return { v: live.concat(gone) };
  }
  function tests2(A, B) {
    const out = {}, atOf = r => (isNum(r.at) ? r.at : Infinity);
    new Set(keysOf(A).concat(keysOf(B))).forEach(t => {
      const x = isPlain(A[t]) ? A[t] : {}, y = isPlain(B[t]) ? B[t] : {}, o = {};
      new Set(keysOf(x).concat(keysOf(y))).forEach(k => {
        const p = x[k], q = y[k];
        const w = !isPlain(q) ? p : !isPlain(p) ? q : atOf(q) < atOf(p) || (atOf(q) === atOf(p) && canon(q) < canon(p)) ? q : p;
        if (w !== undefined) o[k] = w;
      });
      out[t] = o;
    });
    return { v: out };
  }
  const lesson = course(lesson2, lessonShape, null, true);
  const pts = course(pts2, isPlain);
  const rvq = course(rvq2, isArr, (x, y) => setCanon(x) === setCanon(y));
  const tests = course(tests2, isPlain);

  /* ---------- 新版頁面寫入時用的(js/vocab.js、js/reading.js) ----------
     都回新的物件或陣列,不改輸入。改到內容才蓋戳記:改前的雜湊放進 _p、_t 換成現在;沒改到就回原本那一份(不用寫、不上傳) */
  function newBankId(now) { return 'b' + Math.floor(now).toString(36) + rnd(3); }
  function newBank(id, name, now) { return { id, name, words: [], _r: rnd(6), _t: now, _nt: now }; }
  /* 新字只多 _r(不寫 on: true、不寫 _t):批次加字一次幾千個字,每個字多 _t 和 on 會讓題庫變成 main 的 1.7 倍,
     256 KB 的上限從約 4800 字掉到約 2900 字。on 沒寫就是勾選(每個讀的地方都是 on !== false);_t 只在兩台同時改同一個字時
     決定誰當主要,沒有 _t 就比內容(兩台算出來一樣)。改過的字(reviseWord)才有 _t、_p。字的 _r 4 碼(題庫 6 碼):
     只用來分「刪掉又加回一模一樣的字」和「改回以前一模一樣的內容」(reviseWord 換新的),36^4 種夠了。now 不用,留著參數給呼叫的人 */
  function newWord(en, zh, now) { return { en, zh, _r: rnd(4) }; }
  function reviseWord(w, patch, now) {
    const next = Object.assign({}, w, patch);
    if (own(patch, 'alt')) put(next, 'alt', altList(patch.alt).slice().sort());
    const h = wordHash(w);
    if (h === wordHash(next)) return w;
    /* 改到內容就換一個 _r:每一版都是獨一無二的版本。不然改回以前的中文、取消勾選又勾回來、兩台各自打了同一個中文,
       雜湊會跟某一個舊版本一樣:別台的版本 _p 裡有那個雜湊,學生剛打的被當成舊版本拿掉;刪那個舊版本的標記也會把它刪掉。
       合併記號 _m 不用留了(_r 換了,跟合併的兩份一定不同) */
    next._r = rnd(4);
    delete next._m;
    const hn = wordHash(next);
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
    const h = bankHash(old);
    if (h === bankHash(next)) return old;
    /* 改到內容就換題庫的 _r(跟 reviseWord 一樣):改回以前的名稱、字又沒動時,雜湊不會跟以前某一版一樣
       (別台的 _p 裡有那一版,改回的那一份會被當成舊版本,名稱被退回) */
    const out = Object.assign({}, next, { _t: now, _r: rnd(6) });
    delete out._m;
    if (next.name !== old.name) {
      out._nt = now;
      out._nr = rnd(4);
      delete out._on;
      put(out, '_nl', normP([pEntry(nameId(old), now)].concat(lineage(old), lineage(next)), nameId(out), NAME_L_MAX, now));
    }
    put(out, '_p', normP([pEntry(h, now)].concat(pList(old._p), pList(next._p)), bankHash(out), BANK_P_MAX, now));
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
    banks, tombs, mock, mockWrong, lesson, pts, rvq, tests,
    newBankId, newBank, newWord, reviseWord, reviseBank, editBank, addWords, setWord, deleteWord, deleteBank,
  });
})(typeof window !== 'undefined' ? window : globalThis);
