/* 緊急退路:要停用 service worker 時,把這個檔案的內容整份覆蓋到根目錄的 sw.js(檔名不能改),
   同時把 js/app-shell.js 的 SW_ON 改成 false,一起 push。
   沒有 fetch 處理,只刪 ss- 開頭的快取,然後自我註銷。不碰學生的進度資料;不要用 Clear-Site-Data(它會清掉學生的進度)。
   推上去之後至少留幾個月:很久沒回來的使用者,要等下次開站才會拿到。 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('ss-')).map((n) => caches.delete(n)));
    await self.registration.unregister();
  })());
});
