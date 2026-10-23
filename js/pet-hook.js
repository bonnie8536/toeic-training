/* 小雞第二階段:練習結束時領點心的掛勾。
   各模組在結束畫面出現時呼叫 PET_HOOK.done(id, { n, into }):
   - 只有 PET_STORE.food 是 true 才動作(PET_FOOD 開關,js/pet-config.js);不是的話回 null,什麼都不碰。
   - into 是元素時,當下在它裡面最後加一個空的 p.pet-earn[role=status](已經有就重用);after 是畫面上的元素時改放在它正後面
     (對話放在最後聽的那一句下面、題庫放在成績下面:學生拿到的當下看得到,第三輪審查 #4、#5)。
     PET_STORE.earn 的結果在 10 秒內回來、那一行還在畫面上,才寫「小黃拿到 1 份小番茄。」之類的一句。
   - 等結果的時候那一行加 is-wait,css 先留一行的高度,字寫上去時下面的按鈕不會往下跳;手機上一行放不下最長的一句時,
     照那一行的寬另外留夠行數(style.minHeight,rowsFor;審查第 3 輪 #1),之後一直留著。沒有字可寫(once、later、off、逾時、出錯)
     時改成 is-held,這個結束畫面裡一直留著那一行的高度:收起來的話按鈕會往上跳,學生正要點時容易點錯(chick2 第一輪修正 #6)。
     看得出一定沒有字的(題數少於一回合、不認得的練習)一開始就不留(第三輪審查 #9)。
     放進去以後至少隔 150 毫秒才寫字(結果早就回來也一樣):live 區域先空著進到讀螢幕的樹裡,寫字時才會被念出來。
   - 永遠不丟錯:小雞出錯只 console.warn,練習頁照常。PET_HOOK 本身凍結、改不掉,呼叫點的
     `if (window.PET_HOOK) PET_HOOK.done(...)` 不會因為別的程式蓋掉它而丟錯。
   不讀寫任何學生資料(只呼叫 PET_STORE.earn、view),不讀網址。測試:node tools/test_pet_hooks.js */
(function () {
  'use strict';
  if (window.PET_HOOK) return;

  const WAIT_MS = 10000;
  const SAY_MS = 150;

  function warn(e) {
    try { console.warn('小雞獎勵失敗：', e); } catch (x) { /* 連 console 都沒有就算了 */ }
  }
  function chickName(S) {
    try {
      const v = S.view();
      const n = v && v.status && v.status.name;
      return typeof n === 'string' && n ? n : '小雞';
    } catch (e) {
      return '小雞';
    }
  }
  function foodName(code) {
    try {
      const P = window.PET;
      const n = P && typeof P.foodName === 'function' ? P.foodName(code) : '';
      return typeof n === 'string' ? n : '';
    } catch (e) {
      return '';
    }
  }
  /* 結束畫面那一行;其他結果(off、once、short、bad、later)不寫字。
     一天最多拿 3 份(2026-10-23):left 是今天還能拿幾份,有的時候拿到後面多一句;同一個練習今天拿過了是 dup */
  function perDay() {
    try { const n = window.PET && window.PET.SNACKS_PER_DAY; return typeof n === 'number' && n > 0 ? n : 3; } catch (e) { return 3; }
  }
  const isLeft = n => typeof n === 'number' && n >= 0 && n === Math.floor(n);
  function lineFor(r, S) {
    if (!r || typeof r !== 'object') return '';
    if (r.result === 'cap') return '今天的 ' + perDay() + ' 份點心都拿到了，明天再來。';
    if (r.result === 'dup') return '這個練習今天拿過點心了' + (isLeft(r.left) && r.left > 0 ? '，換別的練習還能拿 ' + r.left + ' 份。' : '。');
    const f = foodName(r.food);
    if (!f) return '';
    if (r.result === 'got') {
      const more = !isLeft(r.left) ? '' : r.left > 0 ? '今天還能拿 ' + r.left + ' 份。' : '今天的 ' + perDay() + ' 份點心都拿到了。';
      return chickName(S) + '拿到 1 份' + f + '。' + more;
    }
    if (r.result === 'full') return f + '已經存滿 9 份，先餵掉一些再來拿。';
    return '';
  }
  /* 這次可能寫的最長一句要幾行:手機上那一行只有 305 px 左右,拿過了、拿到第 3 份、名字長的那幾句會折成兩行(審查第 3 輪 #1)。
     每個字算 1 個字寬(中文字剛好,數字、空白只會算多),跟那一行現在的寬比;量不到寬時回 1(照 css 留一行) */
  const px = v => parseFloat(v) || 0;
  /* 那一行能用的寬:空的那一行在置中的直排裡(掉落通關的 .game-over)縮成 0 寬,改量外層扣掉左右 padding 的寬(審查第 2 輪 寬度 #1) */
  function widthFor(p) {
    const w = p && p.clientWidth;
    if (w > 0) return w;
    const box = p && p.parentNode;
    if (!box || box.nodeType !== 1 || !(box.clientWidth > 0)) return 0;
    const bs = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(box) : null;
    return box.clientWidth - (bs ? px(bs.paddingLeft) + px(bs.paddingRight) : 0);
  }
  function rowsFor(p, S) {
    try {
      const w = widthFor(p);
      if (!(w > 0)) return 1;
      const cs = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(p) : null;
      const fs = (cs && parseFloat(cs.fontSize)) || 15;
      const n = perDay(), snacks = window.PET && Array.isArray(window.PET.SNACKS) ? window.PET.SNACKS : [];
      const all = [{ result: 'dup', left: n - 1 }, { result: 'cap' }];
      snacks.forEach(food => all.push({ result: 'got', food, left: 0 }, { result: 'got', food, left: n - 1 }, { result: 'full', food }));
      const longest = Math.max(0, ...all.map(r => lineFor(r, S).length));
      return Math.min(4, Math.max(1, Math.ceil(longest * fs / w)));
    } catch (e) {
      return 1;
    }
  }
  const isEl = x => !!x && typeof x === 'object' && x.nodeType === 1;
  function line() {
    const p = document.createElement('p');
    p.className = 'pet-earn';
    p.setAttribute('role', 'status');
    return p;
  }
  /* 空的 live 那一行:after 是畫面上的元素就放在它正後面,不然放在 into 裡面最後;都不是元素就不放。已經有就重用 */
  function slot(into, after) {
    if (isEl(after) && after.isConnected === true && typeof after.after === 'function') {
      const nx = after.nextElementSibling;
      if (nx && nx.classList && nx.classList.contains('pet-earn')) return nx;
      const p = line();
      after.after(p);
      return p;
    }
    if (!isEl(into) || typeof into.append !== 'function') return null;
    const old = typeof into.querySelector === 'function' ? into.querySelector('.pet-earn') : null;
    if (old) return old;
    const p = line();
    into.append(p);
    return p;
  }
  /* 看得出這次一定沒有字可寫:題數少於一回合(short)、不認得的練習(bad);跟 PET_STORE.earn 同一套判斷 */
  function silent(id, o) {
    try {
      const P = window.PET;
      if (!P) return false;
      if (o.n !== undefined && o.n !== null && typeof P.ROUND_MIN === 'number' && !(Number(o.n) >= P.ROUND_MIN)) return true;
      return typeof P.sourceFood === 'function' && !P.sourceFood(id);
    } catch (e) {
      return false;
    }
  }
  /* 結果回來(或逾時、出錯)以後拿掉 is-wait。留過高度、這次又沒寫字的,改成 is-held 繼續留著那一行的高度 */
  function unwait(p, wrote) {
    try {
      if (!p || !p.classList) return;
      if (wrote) p.classList.remove('is-held');
      else if (p.classList.contains('is-wait')) p.classList.add('is-held');
      p.classList.remove('is-wait');
    } catch (e) { warn(e); }
  }
  /* earn 的結果,最多等 WAIT_MS;逾時或出錯都回 null */
  function waitEarn(S, req) {
    return new Promise(resolve => {
      let over = false;
      const timer = setTimeout(() => { over = true; resolve(null); }, WAIT_MS);
      const end = v => { if (over) return; over = true; clearTimeout(timer); resolve(v); };
      let pr;
      try { pr = S.earn(req); } catch (e) { warn(e); end(null); return; }
      Promise.resolve(pr).then(
        v => end(v && typeof v === 'object' ? v : null),
        e => { warn(e); end(null); });
    });
  }

  /* 空的那一行放進去以後至少等這麼久才寫字:live 區域出現時就已經有字,讀螢幕常常不念(role=status) */
  function settled(p) {
    return p ? new Promise(resolve => { try { setTimeout(resolve, SAY_MS); } catch (e) { resolve(); } }) : Promise.resolve();
  }

  function done(id, opt) {
    try {
      const S = window.PET_STORE;
      if (!S || S.food !== true) return Promise.resolve(null);
      const o = opt && typeof opt === 'object' ? opt : {};
      const p = slot(o.into, o.after);
      if (p && p.classList && p.classList.toggle('is-wait', !silent(id, o))) {
        /* 手機上一行放不下最長的一句:先留夠行數,寫上字、沒字可寫(is-held)都一直留著,按鈕不往下跳也不往上跳 */
        const rows = rowsFor(p, S);
        if (rows > 1 && p.style && !(parseFloat(p.style.minHeight) >= rows * 1.6)) p.style.minHeight = rows * 1.6 + 'em';
      }
      const ready = settled(p);
      const req = typeof o.n === 'number' ? { id, n: o.n } : { id };
      return waitEarn(S, req).then(r => ready.then(() => r)).then(r => {
        let wrote = false;
        try {
          const text = r ? lineFor(r, S) : '';
          if (text && p && p.isConnected === true) { p.textContent = text; wrote = true; }
        } catch (e) {
          warn(e);
        }
        unwait(p, wrote);
        return r;
      }, e => { warn(e); unwait(p, false); return null; });
    } catch (e) {
      warn(e);
      return Promise.resolve(null);
    }
  }

  Object.defineProperty(window, 'PET_HOOK', {
    value: Object.freeze({ done }),
    writable: false,
    configurable: false,
    enumerable: true,
  });
})();
