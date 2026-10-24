/* 衝衝英文的課程與網址結構(搬家計畫 1.1 到 1.3)。一個網域、一套帳號、一個 App,所有語言與國家共用。
   規則(這次定下來,以後不能改):
   - 網址:/<介面語言>/<要學的語言>/。現在這門課(繁體中文介面、學英文、多益)留在根目錄,網址只搬這一次,不建 /zh-tw/english/。
   - 根目錄不能再出現 reservedRoots 裡的資料夾名稱,留給課程用(tools/test_domain.js 檢查)。
   - 進度鍵:根目錄這門課的鍵名不改(hist、vgame_banks、pet…);新課程的鍵加 keyPrefix,例如 ja.english.hist。
     localStorage 的實際鍵是 tr_u<帳號>_ja.english.hist,雲端 progress 表的 k 是 ja.english.hist,兩門課不會互相蓋掉。
   - 帳號、小雞、付款是全網域共用的。同一個網域的 localStorage 大約 5 MB,所有課程共用。
   - hreflang:只在「同一門內容的不同介面語言」之間加(例如根目錄的英文課與 /ja/english/),x-default 指根目錄;
     不同的要學的語言(/zh-tw/japanese/)不互相標。現在只有一個介面語言開著,所以一個都不產生。
   - 頁面判斷(js/app-shell.js 與每一頁 <head> 的開機程式)現在只看網址最後一段;新課程上線時要改成扣掉 base 再判斷。
   這支現在沒有頁面載入,只是設定與規則;tools/test_domain.js 會讀它。 */
(function (root) {
  'use strict';
  const COURSES = Object.freeze([
    Object.freeze({ id: 'zh-tw/english', base: '/', ui: 'zh-Hant-TW', target: 'en', keyPrefix: '', open: true }),
    Object.freeze({ id: 'zh-tw/japanese', base: '/zh-tw/japanese/', ui: 'zh-Hant-TW', target: 'ja', keyPrefix: 'zh-tw.japanese.', open: false }),
    Object.freeze({ id: 'ja/english', base: '/ja/english/', ui: 'ja', target: 'en', keyPrefix: 'ja.english.', open: false }),
  ]);
  const COURSE_RULES = Object.freeze({ reservedRoots: Object.freeze(['zh-tw', 'zh-cn', 'ja', 'ko', 'en', 'vi', 'th', 'id']) });

  /* 網址路徑屬於哪一門課:base 最長的那個先比 */
  function courseFor(pathname, list) {
    const all = (list || COURSES).slice().sort((a, b) => b.base.length - a.base.length);
    const p = String(pathname || '/');
    return all.filter((c) => p === c.base.replace(/\/$/, '') || p.indexOf(c.base) === 0)[0] || all[all.length - 1];
  }
  /* 這一頁的 hreflang 連結:同一個 target、開著、介面語言不同的課程才算;只有一個介面語言時回空陣列 */
  function hreflangFor(pathname, origin, list) {
    const all = (list || COURSES).filter((c) => c.open);
    const cur = courseFor(pathname, all);
    const same = all.filter((c) => c.target === cur.target);
    if (new Set(same.map((c) => c.ui)).size < 2) return [];
    const rest = String(pathname).slice(cur.base.length - 1).replace(/^\//, '');
    const links = same.map((c) => ({ lang: c.ui, href: origin + c.base + rest }));
    const home = same.filter((c) => c.base === '/')[0];
    if (home) links.push({ lang: 'x-default', href: origin + '/' + rest });
    return links;
  }

  root.COURSES = COURSES;
  root.COURSE_RULES = COURSE_RULES;
  root.courseFor = courseFor;
  root.hreflangFor = hreflangFor;
})(typeof window !== 'undefined' ? window : globalThis);
