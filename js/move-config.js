/* 衝衝英文搬家:兩個網域寫死在這裡(搬家計畫 2.3)。sw.js 與 tools/move-worker/worker.js 各有一份同樣的清單,
   tools/test_move_core.js 會檢查三份一樣。網域永遠帶 www:瀏覽器的資料依「網域加 www 與否」分開存。
   本機測試(tools/test_move_e2e.js)用 127.0.0.1 當舊網址、localhost 當新網址,兩者是不同網域,也都算安全環境。
   這支只放設定,不讀寫任何儲存。 */
(function () {
  'use strict';
  const PROD = { from: ['https://www.shuashualanguage.com'], to: 'https://www.rushuplanguage.com' };
  const LOCAL = { from: ['http://127.0.0.1:8931'], to: 'http://localhost:8932' };
  const local = (location.hostname === '127.0.0.1' || location.hostname === 'localhost') && /^89(31|32)$/.test(location.port);
  const c = local ? LOCAL : PROD;
  window.MOVE = Object.freeze({
    from: Object.freeze(c.from.slice()),
    to: c.to,
    oldName: 'shuashualanguage.com',
    newName: 'www.rushuplanguage.com',
    onOld: c.from.indexOf(location.origin) > -1,
    onNew: location.origin === c.to,
  });
})();
