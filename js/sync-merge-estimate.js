/* 預估分數三個帳號鍵的多台裝置合併:fa_v1(第一次作答)、placement_v1(程度檢測紀錄)、est_v1(預估快照)。純計算,不讀寫儲存。
   規則本身在 js/estimate-data.js(ESTIMATE.mergeFirstAttempts、mergePlacementRuns、mergeEst),這裡只包成同步合併的約定,
   載入時把 firstAttempts、placementRuns、estSnap 加進 window.SYNC_MERGE(換成一份新的凍結物件,原有的函式還是同一個)。
   每一頁的載入順序:js/sync-merge.js → js/sync-merge-lesson.js → js/estimate-core.js → js/estimate-data.js → 這個檔 → js/cloud.js
   (tools/test_estimate_store.js 檢查)。js/sync-merge.js 或 ESTIMATE 沒載到就什麼都不做:js/cloud.js 拿不到這三個合併函式,
   照它的規則不上傳、帳本留著,灌資料時留本機,不會整份蓋掉別台的作答。搬家寄出頁 move-out.html 不載(同 js/sync-merge-lesson.js 的理由),
   這三個鍵在那一頁不上傳、放進搬家包,到新網址登入時再合併(搬家暫存區要用時也會補載這個檔)。
   約定跟 js/sync-merge.js 一樣:(本機, 雲端) → { ok, v, sameAsLocal, sameAsCloud };形狀認不得回 { ok: false }(唯讀,不合併、不上傳)。
   · firstAttempts(fa_v1 { v: 1, i }):兩份聯集;同一題留日數小的,同日照來源先後,再同留對錯小的(看過最小)。v 不是 1 回 ok:false。
   · placementRuns(placement_v1 { v: 1, runs }):用開始時間 at 聯集;同一次的作答照 key 聯集,結束時間取有的那份;只留最新 5 次。v 不是 1 回 ok:false。
   · estSnap(est_v1 { ip, cv, at, L, R }):at 新的整份贏,不合併欄位。
   一份是 null 或沒有就用另一份;兩份都形狀不對回 ok:false;一份形狀不對時當成沒有(壞的那份不會蓋掉好的)。
   兩份先拿掉 "__proto__" 鍵(SYNC_MERGE.guarded)。 */
(function (root) {
  'use strict';
  const base = root.SYNC_MERGE, E = root.ESTIMATE;
  if (!base || typeof base.canon !== 'function') return;
  if (!E || typeof E.mergeFirstAttempts !== 'function' || typeof E.mergePlacementRuns !== 'function' || typeof E.mergeEst !== 'function') return;
  const canon = base.canon;
  const isPlain = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const none = x => x === null || x === undefined;

  /* versioned:有 v 而且不是 1 的(更新版的格式)整個唯讀 */
  function wrap(merge, shape, versioned) {
    return function (a, b) {
      if (versioned && [a, b].some(x => isPlain(x) && Object.prototype.hasOwnProperty.call(x, 'v') && x.v !== 1)) return { ok: false };
      if (none(a) && none(b)) return { ok: true, v: null, sameAsLocal: a === null, sameAsCloud: b === null };
      const ga = !none(a) && shape(a), gb = !none(b) && shape(b);
      if (!ga && !gb) return { ok: false };
      const v = ga && gb ? merge(a, b) : ga ? a : b;
      const sameAsLocal = ga && canon(v) === canon(a), sameAsCloud = gb && canon(v) === canon(b);
      return { ok: true, v: sameAsLocal ? a : sameAsCloud ? b : v, sameAsLocal, sameAsCloud };
    };
  }
  const faShape = x => isPlain(x) && isPlain(x.i);
  const runsShape = x => isPlain(x) && Array.isArray(x.runs);
  const estShape = x => isPlain(x) && typeof x.at === 'string' && x.at !== '';

  const g = typeof base.guarded === 'function' ? base.guarded : (f) => f;
  const firstAttempts = g(wrap(E.mergeFirstAttempts, faShape, true));
  const placementRuns = g(wrap(E.mergePlacementRuns, runsShape, true));
  const estSnap = g(wrap(E.mergeEst, estShape, false));

  root.SYNC_MERGE = Object.freeze(Object.assign({}, root.SYNC_MERGE, { firstAttempts, placementRuns, estSnap }));
})(typeof window !== 'undefined' ? window : globalThis);
