/* 雲端模式設定(Supabase)。
   兩個值都留空 = 本機模式(進度只存各裝置,現況)。
   填入你 Supabase 專案的 URL 與 anon public key = 雲端模式(學生登入、進度同步、教師後台)。
   anon key 本來就是設計成可公開的金鑰,資料權限由資料庫的 RLS 控管,放上 GitHub 沒有問題。
   設定步驟見:GITHUB上線指南.md */
window.CLOUD_CONFIG = {
  url: 'https://ydzcnnjnfxfmaqbszbgn.supabase.co',
  anonKey: 'sb_publishable_U4v7mmmpxVuBv8c7b39NyA_apBMTPur',   // publishable key,設計上可公開,權限由 RLS 控管
};
