/* 練習引擎給課程頁的入口:共用的參數檢查與結果格式。
   入口有四個:js/practice.js 的 DRILL.startQuiz、js/listening.js 的 LISTEN.startQuiz(帶 onDone)、js/grammar.js 的 GRAMMAR.unit、js/ear.js 的 EAR.round。
   課程頁先載入這個檔再載入用到的引擎;刷題、聽力、文法、英語耳這些頁面不載,也不受影響(沒給 onDone 時走原本的程式)。
   共同的 opts:
     onDone(result) 必填:那一輪的紀錄照原頁面的方式存好之後呼叫一次(drill_p*、listen_p*、grammar_done、ear_*、學習記錄);
                    引擎不畫成績卡、不給點心,接下來畫什麼由課程頁決定
     onExit()       選填:專心模式按離開時呼叫;沒給就回上一頁(文法沒有專心模式,用不到)
     feedback       DRILL、LISTEN:'submit'(交卷才對答案)或 'instant'(每小題作答就對答案、看解析、存紀錄)
   result = { score, total, items }:items 一小題一筆、照出題順序 { m, id, sub, key, c, ok }
     m 是學習記錄的模組代號(p5–p7、l1–l4、g);英語耳沒有學習記錄,是作答紀錄的鍵名(ear_d、ear_mp、ear_n、ear_s);id 是題目、題組、單元的 id;
     sub 是題組小題(P6 空格號,其他題組與文法小試身手是第幾題,1 起算),單題是 null;key 是原頁面作答紀錄的鍵;
     c 是選的選項(沒作答 -1;聽寫是打的字,跟讀是 null);ok 是對不對。參數不對丟 TypeError */
(function () {
  'use strict';
  const FEEDBACK = ['instant', 'submit'];

  /* 共同參數:el 要是畫面元素、onDone 一定要有、onExit 有給要是函式;withFeedback 時檢查 feedback。回傳 opts(沒給是空物件) */
  function check(name, el, opts, withFeedback) {
    const o = opts || {};
    const bad = !el || typeof el.append !== 'function' ? '第一個參數要是畫面元素'
      : typeof o.onDone !== 'function' ? '要給 onDone'
      : o.onExit !== undefined && typeof o.onExit !== 'function' ? 'onExit 要是函式'
      : withFeedback && o.feedback !== undefined && FEEDBACK.indexOf(o.feedback) < 0 ? 'feedback 要是 instant 或 submit' : '';
    if (bad) throw new TypeError(name + '：' + bad);
    return o;
  }

  /* units = [{ p, item }]:p 要在 parts 裡;題組(不是 singles 裡的 Part)要有 questions。回傳 p 轉成字串的新陣列 */
  function units(name, list, parts, singles) {
    const out = Array.isArray(list) ? list.map(u => ({ p: String(u && u.p), item: u && u.item })) : [];
    const ok = out.length && out.every(u => parts.indexOf(u.p) > -1 && u.item && typeof u.item.id === 'string'
      && (singles.indexOf(u.p) > -1 || (Array.isArray(u.item.questions) && u.item.questions.length > 0)));
    if (!ok) throw new TypeError(name + '：units 的每一筆要有 p 與 item，p 是 ' + parts.join('、') + '，不能是空的');
    return out;
  }

  /* 題庫題(DRILL、LISTEN)的結果:prefix 是 'p' 或 'l';choiceOf(i, key, qi) 回第 i 個單元那一小題選的選項(沒作答回 undefined 或 -1) */
  function bankResult(prefix, list, singles, choiceOf) {
    const items = [];
    list.forEach((u, i) => {
      const single = singles.indexOf(u.p) > -1;
      (single ? [u.item] : u.item.questions).forEach((q, qi) => {
        const key = single ? u.item.id : u.item.id + ':' + (q.num !== undefined ? q.num : qi);
        const c = choiceOf(i, key, qi);
        const pick = typeof c === 'number' ? c : -1;
        items.push({ m: prefix + u.p, id: u.item.id, sub: single ? null : q.num !== undefined ? q.num : qi + 1, key, c: pick, ok: pick === q.answer });
      });
    });
    return result(items);
  }

  function result(items) {
    return { score: items.filter(x => x.ok).length, total: items.length, items };
  }

  window.LESSON_ENTRY = Object.freeze({ check, units, bankResult, result });
})();
