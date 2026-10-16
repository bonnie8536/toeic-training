/* 小雞的總開關(路線圖 1.2c)。false:js/pet-store.js 什麼都不讀、不寫,畫面也不顯示小雞。
   網址加 ?pet=1 可以在開關關著時只在那一頁打開預覽。
   2026-10-16 打開:test_pet、test_pet_store(含時鐘不準、讀雲端時登出)、test_sync 與其他 tools/test_*.js 全過,
   審查發現的面板與分頁列問題修完後在無頭 Chrome 用真的觸控、滑鼠、鍵盤驗過。
   要放在 js/pet.js、js/pet-store.js 前面載入。 */
window.PET_ON = true;
