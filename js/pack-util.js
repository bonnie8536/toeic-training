/* 課程引擎(js/pack-core.js)用的純計算:洗牌、難度配比的題數分配、字串雜湊與固定種子的亂數。
   載入時不依賴其他檔、不讀寫儲存;js/pack-core.js 要在這支後面載入。對外是 window.PACK_UTIL。 */
(function (root) {
  'use strict';
  const LV = [1, 2, 3, 4].map((n) => 'D' + n);   // 難度代碼,由低到高

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  /* 難度配比 → 各級題數(最大餘數法):先取整數部分,剩下的題照小數部分大的先給,一樣時比例大的先、再來級低的先。
     allow 有給時只在這幾級分配(比例照它們之間的相對大小);這幾級的比例都是 0 就全部是 0(呼叫的一方再照借題順序補) */
  function allocate(n, mix, allow) {
    const lv = allow || LV;
    const w = {}, exact = {}, out = {};
    LV.forEach((l) => { out[l] = 0; });
    lv.forEach((l) => { w[l] = Math.max(0, Number(mix && mix[l]) || 0); });
    const sum = lv.reduce((a, l) => a + w[l], 0);
    if (!(sum > 0) || !(n > 0)) return out;
    lv.forEach((l) => { exact[l] = n * w[l] / sum; out[l] = Math.floor(exact[l] + 1e-9); });
    let left = n - lv.reduce((a, l) => a + out[l], 0);
    lv.filter((l) => w[l] > 0).sort((x, y) => (exact[y] - out[y]) - (exact[x] - out[x]) || w[y] - w[x] || LV.indexOf(x) - LV.indexOf(y))
      .forEach((l) => { if (left > 0) { out[l]++; left--; } });
    return out;
  }
  /* 字串的 32 位元雜湊(FNV-1a)與 mulberry32 亂數:同一個種子在每個瀏覽器排出一樣的順序 */
  function hash32(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  root.PACK_UTIL = Object.freeze({ LV, shuffle, allocate, hash32, mulberry32 });
})(typeof globalThis !== 'undefined' ? globalThis : this);
