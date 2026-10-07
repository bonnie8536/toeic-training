/* 方案價格(只負責顯示;實際收多少由金流與資料庫記帳決定,伺服器另有自己的價格表)。
   數字要跟 pricing.html 一致,node tools/test_access.js 會比對。
   老師方案是每月價格,年繳收 teacherYearMonths 個月。
   PAID_UI:付費牆上線那天才改成 true。沒開時 js/cloud.js 不呼叫 my_access,畫面維持現在的樣子。
   上線時這支檔案要放在 cloud.js 前面載入,有付費牆、方案狀態或教師後台的頁面才需要。 */
window.PLANS = {
  student: { month: 199, year: 1990 },
  teacher: { 10: 390, 30: 890, 60: 1490 },
  teacherYearMonths: 10,
  correction: { one: 150, five: 650 },
};
window.PAID_UI = false;
