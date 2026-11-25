/* 平常練習記第一次作答(預估分數用):題庫刷題(js/practice.js)與聽力練習(js/listening.js)作答、交卷時呼叫。window.PRACTICE_FA。
   寫入一律經過 js/estimate-store.js(ESTIMATE_STORE.recordMany、refresh)。那個檔沒載到、或任何一步出錯時什麼都不做:
   練習照常,作答紀錄(drill_p*、listen_p*)與學習記錄(hist)不受影響。這裡不寫那兩種紀錄,也不刪、不蓋 fa_v1 已有的題。
   記法(呼叫端決定 ok 與來源):
   · 刷題、聽力練習交卷:有作答的題記對錯(刷題 p;聽力作答前最多播一次而且都是 1 倍速是 l,播兩次以上或改過速度是 r);沒作答的記成看過(ok 是 null)。
   · 錯題本複習、課程回合(引擎被課程頁以 onDone 呼叫):記成看過(課程回合的來源是 c)。看過的題之後再做也不算第一次。
   · fa_v1 已經有的題不動,所以同一題第二次以後不算。
   · 寫之前:這幾題裡有舊作答紀錄、fa_v1 卻還沒有的(上線前做過的題),先補回一次舊紀錄(refresh 照學習記錄補),
     這一次就不會被當成第一次。所以呼叫要在這一次的作答紀錄寫進去之前。
   window.PRACTICE_FA = {
     record(rows)       rows = [{ rec, key, ok, src }]:rec 是作答紀錄的鍵(drill_p5、listen_p2…,看有沒有舊紀錄用);回新記了幾題。
     listenSrc(state)   → 'l' | 'r':state.plays 是作答前播了幾次;state.rate 為真表示播的時候不是 1 倍速。
     later()            交卷後在背景重算一次預估(不擋畫面,出錯不管)。
   } */
(function (root) {
  'use strict';
  const es = () => root.ESTIMATE_STORE || null;
  const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

  /* 有沒有「舊作答紀錄有、fa_v1 沒有」的題 */
  function hasOld(rows, S) {
    const cache = {};
    return rows.some((r) => {
      if (!(r.rec in cache)) cache[r.rec] = store.get(r.rec, null);   // global store:js/common.js
      return has(cache[r.rec], r.key) && !S.seen(r.key);
    });
  }

  function record(rows) {
    const S = es();
    if (!S || !Array.isArray(rows) || !rows.length) return 0;
    try {
      const list = rows.filter((r) => r && typeof r.key === 'string' && r.key);
      if (hasOld(list, S)) S.refresh();
      return S.recordMany(list.map((r) => ({ key: r.key, ok: r.ok, src: r.src })));
    } catch (e) {
      return 0;   // 預估分數出錯不影響練習
    }
  }

  function listenSrc(state) {
    const plays = state && Number(state.plays) || 0;
    return plays <= 1 && !(state && state.rate) ? 'l' : 'r';
  }

  function later() {
    if (!es()) return;
    root.setTimeout(() => {
      try { const S = es(); if (S) S.refresh(); } catch (e) { /* 背景重算失敗:下次開個人頁再算 */ }
    }, 0);
  }

  root.PRACTICE_FA = Object.freeze({ record, listenSrc, later });
})(window);
