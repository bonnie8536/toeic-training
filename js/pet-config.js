/* 小雞的總開關(路線圖 1.2c)。false:js/pet-store.js 什麼都不讀、不寫,畫面也不顯示小雞。
   網址加 ?pet=1 可以在開關關著時只在那一頁打開預覽。
   2026-10-16 打開:test_pet、test_pet_store(含時鐘不準、讀雲端時登出)、test_sync 與其他 tools/test_*.js 全過,
   審查發現的面板與分頁列問題修完後在無頭 Chrome 用真的觸控、滑鼠、鍵盤驗過。
   要放在 js/pet.js、js/pet-store.js 前面載入。
   2026-10-17 小雞第二階段(規格 小雞第二階段規格.md 第 5.3 節第 2 步):每個載入 js/cloud.js 的頁面都在它前面載入這個檔和 js/pet.js,
   cloud.js 對 pet 先合併再上傳(不在開關後面)。下面三個是第二階段的新開關,第 2 步一律關著,關著時線上行為跟第 1 步相同、不會寫出 v2:
   - PET_FOOD:食物、托盤、練習結束畫面那一行、練習頁載入 pet-store、從既有鍵補券。PET_FOOD_FROM 是食物上線日(台北日期 YYYY-MM-DD),
     空字串時食物整個不開。
   - PET_ROAM_V2:js/pet-roam2.js(App 與網站模式都走動)、面板裡「小雞在頁面上走動」開關、App 模式「我的」那一區顯示出來。
   第 3 步(打開)要等第 2 步上線一週以後,而且網站模式要先量完(規格附錄 A.6)。程式一律寫 === true 才算開,不准用網址參數打開。 */
window.PET_ON = true;          // 第一階段的總開關,不動
window.PET_FOOD = false;       // 食物、托盤、結束畫面那一行、練習頁載入 pet-store、從既有鍵補券
window.PET_ROAM_V2 = false;    // pet-roam2.js(App 與網站模式)、「小雞在頁面上走動」開關、App「我的」那一區顯示
window.PET_FOOD_FROM = '';     // 食物上線日,台北日期 'YYYY-MM-DD';空字串時食物整個不開
