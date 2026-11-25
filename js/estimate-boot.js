/* 開頁時補一次預估分數用的第一次作答(fa_v1):給沒有預估卡、但會刪舊紀錄的頁面用(舊 28 題頁 diagnostic.html 的「再測一次」會清掉 diag)。
   舊 28 題的作答要在被刪之前先抄進 fa_v1,之後刪了也不會遺失。
   載入順序:data/diagnostic.js、js/common.js、估分的檔(estimate-core、estimate-data)、js/cloud.js、data/item-params.js、js/estimate-store.js、這個檔。
   · 雲端帳號:等登入狀態確定(CLOUD.ready)再讀雲端合併後寫(ESTIMATE_STORE.load);讀不到雲端照本機的補。
   · 本機學生檔案:直接補本機。訪客、頁面不能存時 ESTIMATE_STORE 自己不寫。
   · 只補還沒有的題,不刪、不蓋任何作答紀錄與舊檢測結果;出錯不影響頁面。 */
(function (root) {
  'use strict';
  function run() {
    const S = root.ESTIMATE_STORE;
    if (!S || typeof S.load !== 'function') return;
    Promise.resolve(S.load()).catch(() => { /* 補不到:下次開「我的」頁再補 */ });
  }
  function start() {
    const C = root.CLOUD;
    if (!C || !C.enabled) { run(); return; }
    Promise.resolve(C.ready).then(run, run);
  }
  if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
