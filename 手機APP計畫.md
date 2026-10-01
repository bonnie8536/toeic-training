# 刷刷英文:手機 App 計畫

寫於 2026-10-01。

## 結論

**不重寫,用現有網站分三階段變成 App:先 PWA,再 Android,最後 iOS。在那之前先修好同步會掉資料的問題(第零階段,已完成)。**

- 現有的 20 個模組、752 題文法、300 題 P5、40 篇文章、881 個音檔全部沿用,不另外維護一套。
- 每一階段做完都能單獨使用,不是做到最後才看得到東西。
- **三個階段都不需要改資料庫裡的任何資料。**

## 第零階段:先修同步會掉資料(2026-10-01 已完成)

規劃 App 時檢查同步程式,發現**現有網站就有的漏洞**,而且 App 會讓它更常發生:

- 寫入要等 0.8 秒才上傳。這 0.8 秒內關頁(手機 App 隨時被系統殺掉),改動根本沒送出。
- 上傳失敗時錯誤被靜默吞掉(supabase-js 網路錯誤是回 `{error}`,不會丟例外,原本的 try/catch 永遠接不到),沒有任何地方記得「這筆還沒傳」。
- 下次新工作階段登入時,程式**先刪光本機再用雲端覆蓋** → 沒上傳的改動永久消失。

**修法**:加一本「還沒上雲」帳本(`tr_unsynced_<uid>`),寫入當下先記帳,上傳成功才劃掉。開站灌資料前,帳本上比雲端新的改動保留本機並補傳;雲端完全沒有的本機鍵(從沒傳上去的新資料)也保留。關頁、切到背景、恢復連線時都會補傳。登出時如果還有傳不上去的,先問,不默默刪。

**驗證**:`tools/test_sync.js` 用假的 Supabase 跑 8 個情境。修改前 3/8 通過(自訂題庫加字後馬上關 App → 字不見;斷網 → 不見;從沒同步的題庫 → 整個消失;登出 → 不問就刪);修改後 8/8 通過,包含「另一台裝置比較新時要用雲端的」這一項,證明新保護不會反過來讓舊資料蓋掉新資料。**改同步程式前後都要跑這支,8 項全過才能上線。**

**上線前的備份**:資料庫內快照 `backup.progress_20261001`(96 列,與線上完全相同;放在 API 存取不到的 schema,並開 RLS、撤銷 anon/authenticated 權限)。

## 為什麼不重寫成 Flutter / React Native

- 重寫等於把 20 個模組、所有題型的介面從零再做一次,以月計;而且之後每加一批題目都要改兩套。
- 這個站的價值在內容,不在介面框架。換框架不會讓學生學得更好。
- 用 Capacitor 把現有網頁包進原生外殼,程式碼 100% 共用,原生功能(通知、震動、深連結)用外掛補。

## 第一階段:PWA(可安裝的網頁 App)

**做什麼**
- service worker:離線也能開做過的練習;沒網路時顯示離線頁,不是瀏覽器的錯誤畫面。
- manifest 補齊:`id`、`scope`、長按 icon 的捷徑(每日複習/題庫刷題/文法基礎)。
- 會員選單加「安裝到手機」:Android 直接跳安裝;iPhone 顯示「Safari 分享 → 加入主畫面」。
- 安裝後的手機版介面:底部分頁列(首頁/學習/刷題/複習/我的),照一般學習 App 的慣例。只在「已安裝」模式出現,網頁版不變。

**費用** 0。**要她做的** 用手機試裝。**時間** 工程約 1–2 天。

**資料安全** PWA 跟網站是同一個網址,用的是同一份瀏覽器儲存,學生的進度與自訂題庫**原地沿用,零搬移**。service worker 依設計碰不到 localStorage,也不攔 Supabase 的請求。

**風險與退路** service worker 寫壞的典型後果是「一直卡在舊版」。所以:
- HTML、JS、題庫資料一律**網路優先**(有網路就拿最新的,沒網路才用快取),不會卡舊版。
- 音檔不經過 service worker(手機播放用的是分段請求,快取處理不好會讓 iPhone 播放壞掉;離線音檔留給原生 App)。
- 緊急退路:把 `sw.js` 換成「自我註銷」版推上去,所有人下次開網頁就恢復成沒有 service worker 的狀態。

## 第二階段:Android App(Google Play)

**做什麼**
- Capacitor 建 Android 專案,網頁資產打包進 App。
- **Google 登入改走系統瀏覽器 + 深連結 + PKCE**。Google 不准在 App 內嵌的網頁視窗登入(會回 `disallowed_useragent`),一定要另開 Chrome Custom Tab,登完用 `com.shuashualanguage.app://` 跳回 App。
- 每日複習的本機推播提醒(不需要推播伺服器)。
- 用 GitHub Actions 在雲端打包,這台電腦不用裝 Android Studio。

**費用** Google Play 開發者帳號 US$25(一次)。

**要她做的**
1. 申請 Google Play 開發者帳號(實名、身分驗證、付款,只能本人做)。
2. **找 12 位測試者連續參與 14 天**。這是 Google 對 2023/11 之後申請的個人帳號的規定,湊不滿或中途有人退出就要重算 14 天。她的學生 + 朋友 + 家人。
3. App 簽署金鑰放進 GitHub Secrets(金鑰我不經手)。

**時間** 工程約 1 週;加上 14 天封閉測試;再加 Google 審核。

**資料安全** App 跟網站是不同的來源,瀏覽器儲存不共用。所以 App **一律要登入**,登入後從雲端拉回進度(跟現在換裝置登入是同一條路)。網站上的資料不會被搬動或改寫。沒註冊的訪客照常用網站。

## 第三階段:iOS App(App Store)

**做什麼**
- Capacitor iOS 專案,用 GitHub Actions 的 macOS 機器打包(公開 repo 免費,不用買 Mac)。
- 第二階段的通知、離線、深連結登入都沿用。
- 原生感的導覽(底部分頁、返回手勢)。Apple 4.2 會退「只是把網站包起來」的 App,要有原生功能才過。

**費用** Apple Developer Program US$99/年。

**要她做的** 申請 Apple 開發者帳號(實名,App Store 上會顯示她的名字);憑證放 GitHub Secrets。

**時間** 工程約 1 週,加上審核(可能被退件來回)。

**上架前要再查證的** Apple 4.8:App 提供 Google 登入時,通常還要提供一個「可隱藏信箱」的登入選項(Sign in with Apple 符合)。規定在 2024 年改過,到第三階段前查最新條文再決定要不要接。

## 收費跟 App 的關係(重要)

- Apple 3.1.1 / Google Play 付費政策:**在 App 裡賣數位功能要走 App 內購,抽 15–30%**。
- 老師帳號、寫作批改都是數位服務。做法:**只在網站賣**,App 裡只登入使用買好的東西,**App 裡不放價格、不放付款連結**(Apple 3.1.3(b) 允許跨平台使用在別處購買的服務,但不能在 App 內引導去外面付款)。
- 這樣她拿到的是綠界約 3% 的手續費,不是 Apple 的 15–30%。上架前再核對最新條文。

## 不做的事

- 不重寫成 Flutter / React Native。
- 不在 App 裡做付款。
- 不改資料庫結構或資料(三個階段都不需要)。真的需要時照 `記憶:動資料庫前必做`:先備份、量基準、身分模擬驗證。

## 參考來源

- [Google Play:新個人開發者帳號的測試規定](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [Google Play 12 位測試者 14 天規定說明(2026)](https://www.testerscommunity.com/blog/google-play-12-testers-policy)
- [Capacitor 內 Google 登入 disallowed_useragent 討論](https://forum.ionicframework.com/t/disallowed-useragent-using-google-oauth/232772)
- [Supabase PKCE OAuth 在 Capacitor iOS 的坑](https://medium.com/@vpodugu/supabase-pkce-oauth-in-capacitor-ios-why-your-code-verifier-disappears-and-how-to-fix-it-29a4747dce9e)
- [App Store 審核 4.2:WebView 包殼會不會被退](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper/)
- [沒有 Mac 用 GitHub Actions 上架 iOS](https://dev.to/maclessdev/i-ship-ios-apps-to-the-app-store-without-owning-a-mac-using-github-actions-free-macos-runners-b3j)
- [GitHub:開源專案可用免費 M1 macOS runner](https://github.blog/changelog/2024-01-30-github-actions-introducing-the-new-m1-macos-runner-available-to-open-source/)
