/* 分組頁(learn.html、warmup.html、drill.html)的進度數字。
   只讀不寫:從目前這個學生資料夾(js/common.js 的 store)讀完成紀錄,把磚上的總數換成進度。
   - 文法基礎:上過幾課。主打磚改成「上到第 N 課」,按鈕改成「繼續上課」。
   - 自然發音:「上過 N / 總數 課」。
   - 錯題本:待複習的題數,畫成磚右上角的數字徽章;0 題就不畫徽章,第二行維持空白。
   總課數讀磚上原本寫的數字(不載入課程資料),讀不到的就維持靜態文字。
   待複習題數只數單題(Part 5、聽力 Part 1 與 2、片語),規則跟 js/wrongbook.js 的 pick 一樣:
   刷題紀錄與模擬考答錯紀錄取比較新的那一筆,最後一次答錯才算;題庫已淘汰的題(data/retired.json)不算。
   不依賴 cloud.js、profile.js;沒有 store 或讀不到時什麼都不改。 */
(function () {
  'use strict';
  const doc = document;
  const BADGE_MAX = 99;

  const own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  const isPlain = function (x) { return !!x && typeof x === 'object' && !Array.isArray(x); };
  const isNum = function (x) { return typeof x === 'number' && isFinite(x); };

  function read(key) {
    try { return typeof store !== 'undefined' && store && typeof store.get === 'function' ? store.get(key, null) : null; }
    catch (e) { return null; }
  }
  function plainOf(key) { const v = read(key); return isPlain(v) ? v : {}; }

  /* 完成紀錄 { 課 id: { ok, t } } 裡有幾課(值是真值就算,舊資料可能只寫 1) */
  function doneCount(key, total) {
    const d = plainOf(key);
    const n = Object.keys(d).filter(function (k) { return !!d[k]; }).length;
    return total > 0 ? Math.min(n, total) : n;
  }

  /* 一題最後一次的結果:d 是刷題紀錄那筆、m 是模擬考答錯紀錄那筆(跟 js/wrongbook.js 的 pick 一樣) */
  function lastOf(d, m) {
    const dv = isPlain(d) ? d : null;
    const mv = isPlain(m) && isNum(m.t) ? m : null;
    if (!dv && !mv) return null;
    if (!mv) return dv;
    if (!dv) return mv;
    return mv.t > (isNum(dv.t) ? dv.t : -Infinity) ? mv : dv;
  }
  /* 待複習的單題 id(不含已淘汰的):Part 5、聽力 Part 1 與 2、片語 */
  function pendingIds() {
    const mock = plainOf('mock_wrong');
    const ids = [];
    [['drill_p5', 'p5-'], ['listen_p1', 'l1-'], ['listen_p2', 'l2-']].forEach(function (src) {
      const d = plainOf(src[0]);
      const keys = {};
      Object.keys(d).forEach(function (k) { keys[k] = 1; });
      Object.keys(mock).forEach(function (k) { if (k.indexOf(src[1]) === 0 && k.indexOf(':') < 0) keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        const r = lastOf(own(d, k) ? d[k] : undefined, own(mock, k) ? mock[k] : undefined);
        if (r && !r.ok) ids.push(k);
      });
    });
    const ph = plainOf('phrase_drill');
    Object.keys(ph).forEach(function (k) { if (isPlain(ph[k]) && !ph[k].ok) ids.push(k); });
    return ids;
  }
  function pendingCount(retired) {
    const gone = retired || {};
    return pendingIds().filter(function (id) { return !own(gone, id); }).length;
  }

  function tile(href) { return doc.querySelector('a.tile[href="' + href + '"]'); }
  /* 總課數:第一次讀磚上寫的數字並記在 data-total,之後重畫(從上一頁回來)不會讀到已經換成進度的字 */
  function totalOf(a, p) {
    if (a.dataset && a.dataset.total) return Number(a.dataset.total) || 0;
    const m = /(\d+)\s*課/.exec(p ? p.textContent : '');
    const n = m ? Number(m[1]) : 0;
    if (n && a.dataset) a.dataset.total = String(n);
    return n;
  }

  function paintLessons() {
    const g = tile('grammar.html');
    if (g) {
      const p = g.querySelector('p'), total = totalOf(g, p), n = doneCount('grammar_done', total);
      if (p && n > 0) {
        p.textContent = g.classList.contains('tile-featured') ? '上到第 ' + n + ' 課' : '上過 ' + n + ' / ' + total + ' 課';
        const go = g.querySelector('.tile-go');
        if (go && g.classList.contains('tile-featured')) go.textContent = '繼續上課';
      }
    }
    const ph = tile('phonics.html');
    if (ph) {
      const p = ph.querySelector('p'), total = totalOf(ph, p), n = doneCount('phonics_done', total);
      if (p && n > 0) p.textContent = '上過 ' + n + ' / ' + total + ' 課';
    }
  }

  function paintBadge(n) {
    const a = tile('review.html');
    if (!a) return;
    const old = a.querySelector('.tile-badge');
    if (old) old.remove();
    if (!(n > 0)) return;
    const b = doc.createElement('span');
    b.className = 'tile-badge';
    b.setAttribute('aria-label', '待複習 ' + n + ' 題');
    b.textContent = n > BADGE_MAX ? BADGE_MAX + '+' : String(n);
    a.append(b);
  }
  function loadRetired() {
    if (typeof fetch !== 'function') return Promise.resolve({});
    return fetch('data/retired.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        const out = {};
        ((j && j.retired) || []).forEach(function (x) { if (x && typeof x.id === 'string') out[x.id] = 1; });
        return out;
      })
      .catch(function () { return {}; });
  }
  function paintReview() {
    if (!tile('review.html')) return Promise.resolve();
    /* 已淘汰的題要等 data/retired.json 回來才知道,所以先不畫,免得數字先出現再變小;抓不到就照原始數字畫 */
    if (!pendingCount({})) { paintBadge(0); return Promise.resolve(); }
    return loadRetired().then(function (gone) { paintBadge(pendingCount(gone)); });
  }

  function paint() {
    try { paintLessons(); } catch (e) { /* 讀不到就維持靜態總數 */ }
    try { return paintReview(); } catch (e) { return Promise.resolve(); }
  }

  window.HUB = { paint: paint, pendingCount: pendingCount, doneCount: doneCount };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', paint);
  else paint();
  window.addEventListener('pageshow', function (e) { if (e && e.persisted) paint(); });
})();
