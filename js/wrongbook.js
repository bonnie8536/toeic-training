/* 錯題本的資料(錯題本定稿 2026-11-18):哪些題在錯題本、怎麼分組、一回複習出哪些、模擬考答錯的題怎麼收進來。不碰 DOM,window.WRONGBOOK。
   - 錯題本由作答紀錄即時推導:刷題 drill_p5/p6/p7(js/practice.js)、聽力 listen_p1~p4(js/listening.js),
     加上模擬考答錯的題 mock_wrong(這個檔寫;js/mock.js 交卷、js/review.js 每日複習答對時呼叫 save)。
     mock_wrong 是 { 題目 key: { c: 選的, ok: false 答錯 / true 已訂正, t: 毫秒 } },形狀跟刷題紀錄一樣,題目 key 也一樣
     (Part 5、聽力 1/2 是題目 id;Part 6 是題組 id + ':' + 空格號;Part 7、聽力 3/4 是題組 id + ':' + 第幾題)。
   - 一題的「最後一次」是刷題紀錄和 mock_wrong 裡 t 比較大的那一筆(一樣大用刷題的);最後一次答錯就在錯題本(pick,全站只有這一份規則)。
     移出不用刪任何東西:之後在錯題本、隨機練習答對,刷題紀錄那筆比較新,自然移出。沒有 mock_wrong 的人,結果跟以前一模一樣。
     刷題紀錄沒有 t(很舊的資料)時當成最舊,不是當成沒有(以前它在錯題本,現在也在)。
   - 寫入只有 save:先合併再寫(SYNC_MERGE.mockWrong;舊快取的 sync-merge.js 沒有它就用這裡的簡單版),合併結果跟本機一樣就不寫,
     寫完讀回來確認;本機是看不懂的形狀就不寫(不拿 {} 蓋掉)。store 一律寫字面值的鍵(tools/test_move_core.js 的掃描才認得)。
   - 同步:mock_wrong 在 js/cloud.js 的合併表上,搬家規則是 pool(js/move-rules.js)。 */
(function (root) {
  'use strict';
  /* 一回最多:Part 5、聽力 1/2 跟每日複習一輪一樣 20 題;Part 6/7 跟隨機練習一樣最多 8 組;聽力 3/4 跟聽力隨機練習一樣最多 5 組 */
  const ROUND = Object.freeze({ '5': 20, '1': 20, '2': 20, '6': 8, '7': 8, '3': 5, '4': 5 });
  const MAX = 1500;   // 跟 SYNC_MERGE.mockWrong 的上限一樣
  /* 這一版上線的時間(UTC ISO)。模擬考首頁:最近 8 筆紀錄有早於它的,就說明那幾次的錯題沒有收進來(說明裡的日期也從這裡來)。
     寧可晚不要早:比上線早的話,上線前用舊版交卷的那幾次不會被說明到;晚一點只是上線後當天交卷的也看到這行說明。
     現在是預定上線那天(11/19)台灣時間 23:59:59。上線拖過這個時間,tools/test_mock_wrong.js M15 會擋下來,要改成上線當天台灣時間 23:59:59 */
  const SINCE = '2026-11-19T15:59:59.000Z';
  const PARTS = Object.freeze(['5', '6', '7', '1', '2', '3', '4']);
  const TITLE = Object.freeze({ '5': 'Part 5 單句填空', '6': 'Part 6 段落填空', '7': 'Part 7 閱讀理解',
    '1': '聽力 Part 1 照片描述', '2': '聽力 Part 2 應答', '3': '聽力 Part 3 簡短對話', '4': '聽力 Part 4 簡短獨白' });
  const MULTI = '多篇閱讀';

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  const isSetPart = (p) => p === '6' || p === '7' || p === '3' || p === '4';
  const isListen = (p) => p === '1' || p === '2' || p === '3' || p === '4';
  const unit = (p) => (isSetPart(p) ? '組' : '題');

  function bankOf(p) {
    const T = root.TOEIC || {}, L = T.listening || {};
    const list = { '5': T.part5, '6': T.part6, '7': T.part7, '1': L.p1, '2': L.p2, '3': L.p3, '4': L.p4 }[p];
    return Array.isArray(list) ? list : [];
  }
  function keyOf(p, set, q, qi) { return p === '6' ? set.id + ':' + q.num : set.id + ':' + qi; }
  const typeLabel = (t) => (typeof passTypeLabel === 'function' ? passTypeLabel(t) : String(t || ''));
  /* 分組的組名(第二層;第一層是 Part)。聽力 1 沒有分類欄位,不分組 */
  function groupOf(p, set, q, si) {
    if (p === '5' || p === '2') return q.category || '其他';
    if (p === '6') return q.type || '其他';
    if (p === '7') {
      const single = set.format ? set.format === 'single' : (set.passages || []).length === 1;
      return single ? (typeLabel((set.passages || [])[0] && set.passages[0].type) || '其他') : MULTI;
    }
    if (p === '3') return set.title || '對話 ' + (si + 1);
    if (p === '4') return set.type || '其他';
    return '';
  }

  /* 題庫索引(第一次用時建;題庫換了就重建):key → { p, q, set, qi, si, order, group } */
  let index = null, indexOf = null;
  function build() {
    const sig = PARTS.map(bankOf);
    if (index && indexOf && sig.every((b, i) => b === indexOf[i])) return index;
    const map = new Map();
    PARTS.forEach((p) => {
      let order = 0;
      bankOf(p).forEach((x, si) => {
        if (!x) return;
        if (!isSetPart(p)) { map.set(x.id, { p, q: x, set: null, qi: 0, si, order: order++, group: groupOf(p, null, x, si) }); return; }
        (x.questions || []).forEach((q, qi) => { map.set(keyOf(p, x, q, qi), { p, q, set: x, qi, si, order: order++, group: groupOf(p, x, q, si) }); });
      });
    });
    index = map; indexOf = sig;
    return map;
  }
  function ref(key) { return typeof key === 'string' ? build().get(key) || null : null; }

  /* 一題的最後一次:d 是刷題紀錄那一筆、m 是 mock_wrong 那一筆。回 { r, src: 'drill' | 'mock' } 或 null */
  function pick(d, m) {
    const dv = isPlain(d) ? d : null;
    const mv = isPlain(m) && isNum(m.t) ? m : null;
    if (!dv && !mv) return null;
    if (!mv) return { r: dv, src: 'drill' };
    if (!dv) return { r: mv, src: 'mock' };
    const dt = isNum(dv.t) ? dv.t : -Infinity;
    return mv.t > dt ? { r: mv, src: 'mock' } : { r: dv, src: 'drill' };
  }

  /* 讀這個 Part 的刷題紀錄、mock_wrong(store 的鍵寫字面值) */
  function drillOf(p) {
    const v = isListen(p) ? store.get('listen_p' + p, {}) : store.get('drill_p' + p, {});
    return isPlain(v) ? v : {};
  }
  function mockOf() {
    const v = store.get('mock_wrong', null);
    return isPlain(v) ? v : {};
  }

  /* 這個 Part 在錯題本的題(純函式,照題庫順序):[{ key, p, q, set, qi, si, order, group, src, c, t }] */
  function itemsFrom(p, drillMap, mockMap) {
    const d = isPlain(drillMap) ? drillMap : {}, m = isPlain(mockMap) ? mockMap : {};
    const out = [];
    build().forEach((x, key) => {
      if (x.p !== p) return;
      const pk = pick(own(d, key) ? d[key] : undefined, own(m, key) ? m[key] : undefined);
      if (!pk || pk.r.ok) return;
      out.push(Object.assign({ key }, x, { src: pk.src, c: pk.r.c, t: isNum(pk.r.t) ? pk.r.t : 0 }));
    });
    return out.sort((a, b) => a.order - b.order);
  }
  const items = (p) => itemsFrom(p, drillOf(p), mockOf());
  const count = (p) => items(p).length;
  function setCount(p) { return new Set(items(p).map((x) => (x.set ? x.set.id : x.key))).size; }

  /* 分組:照題庫裡第一次出現的順序(答對移出時組不跳位置),「多篇閱讀」排最後;沒有錯題的組不出現。
     組內新錯的在上;同一個題組的題排在一起(照題號),題組之間照那組最新一題的時間 */
  function groupOrder(p) {
    const names = [];
    build().forEach((x) => { if (x.p === p && names.indexOf(x.group) < 0) names.push(x.group); });
    const i = names.indexOf(MULTI);
    if (i > -1) names.splice(i, 1), names.push(MULTI);
    return names;
  }
  function newestFirst(list) {
    if (!list.length || !list[0].set) return list.slice().sort((a, b) => b.t - a.t || a.order - b.order);
    const bySet = new Map();
    list.forEach((x) => { const g = bySet.get(x.set.id) || bySet.set(x.set.id, []).get(x.set.id); g.push(x); });
    const sets = Array.from(bySet.values()).map((g) => ({ g: g.sort((a, b) => a.order - b.order), t: Math.max(...g.map((x) => x.t)), si: g[0].si }));
    return sets.sort((a, b) => b.t - a.t || a.si - b.si).reduce((acc, s) => acc.concat(s.g), []);
  }
  function groups(p) {
    const all = items(p);
    return groupOrder(p).map((name) => ({ name, items: newestFirst(all.filter((x) => x.group === name)) })).filter((g) => g.items.length);
  }

  /* 一回複習:最早錯的先出(每日複習的慣例),一回有上限。g 是組名(不給就是整個 Part)。
     回 { units, n: 這一回幾題, rest: 這一組還沒輪到幾題, total };units 的形狀跟各自的複習一樣:
     Part 5、聽力 1/2 是題目;Part 6/7 是 { set, wrongKeys }(只重做這一組的題);聽力 3/4 是題組(整組重答) */
  function round(p, g) {
    const all = items(p).filter((x) => g === undefined || g === null || g === '' || x.group === g);
    const max = ROUND[p] || 20;
    if (!isSetPart(p)) {
      const list = all.slice().sort((a, b) => a.t - b.t || a.order - b.order).slice(0, max);
      return { units: list.map((x) => x.q), n: list.length, rest: all.length - list.length, total: all.length };
    }
    const bySet = new Map();
    all.forEach((x) => { const s = bySet.get(x.set.id) || bySet.set(x.set.id, { set: x.set, si: x.si, list: [] }).get(x.set.id); s.list.push(x); });
    const sets = Array.from(bySet.values()).map((s) => Object.assign(s, { t: Math.min(...s.list.map((x) => x.t)) }))
      .sort((a, b) => a.t - b.t || a.si - b.si).slice(0, max);
    const n = sets.reduce((k, s) => k + s.list.length, 0);
    const units = sets.map((s) => (p === '6' || p === '7' ? { set: s.set, wrongKeys: s.list.sort((a, b) => a.qi - b.qi).map((x) => x.key) } : s.set));
    return { units, n, rest: all.length - n, total: all.length };
  }

  /* 分頁暫存的作答:只留 [字串, 整數],最多 200 對 */
  function cleanAns(ans) {
    if (!Array.isArray(ans)) return [];
    return ans.filter((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && Number.isInteger(e[1])).slice(0, 200);
  }
  /* 模擬考交卷的作答 [[題目 key, 選的], …](只有作答的)→ 要寫進 mock_wrong 的那幾筆。對錯用題庫算(不信任呼叫的人)。
     答錯:{ c, ok: false, t: T }。答對:這題現在在錯題本、而且決定的那一筆比這次交卷舊,才寫已訂正記號 { c, ok: true, t: T }。
     key 不在題庫、c 不是選項範圍內的整數:丟掉。 */
  function fromAnswers(ans, T) {
    const add = {};
    if (!Array.isArray(ans) || !isNum(T)) return add;
    const drills = {}, mock = mockOf();
    ans.forEach((e) => {
      if (!Array.isArray(e)) return;
      const key = e[0], c = e[1];
      const x = ref(key);
      if (!x || !Number.isInteger(c) || c < 0 || c >= (x.q.options || []).length) return;
      if (c !== x.q.answer) { add[key] = { c, ok: false, t: T }; return; }
      const d = drills[x.p] || (drills[x.p] = drillOf(x.p));
      const pk = pick(own(d, key) ? d[key] : undefined, own(mock, key) ? mock[key] : undefined);
      const pt = pk && isNum(pk.r.t) ? pk.r.t : -Infinity;
      if (pk && !pk.r.ok && pt < T) add[key] = { c, ok: true, t: T };
      else delete add[key];
    });
    return add;
  }
  /* 合併(cur 是本機的 mock_wrong,add 是要加的):有 SYNC_MERGE.mockWrong 用它;沒有(舊快取的 sync-merge.js)用最簡單的
     「同一題 t 新的贏、其他都留」 */
  function put(cur, add) {
    const S = root.SYNC_MERGE;
    if (S && typeof S.mockWrong === 'function') return S.mockWrong(cur, add);
    if (cur !== null && cur !== undefined && !isPlain(cur)) return { ok: false };
    const out = Object.assign({}, cur || {});
    let changed = !isPlain(cur);
    Object.keys(add || {}).forEach((k) => {
      const x = out[k], y = add[k];
      if (isPlain(x) && isNum(x.t) && x.t >= y.t) return;
      out[k] = y; changed = true;
    });
    return { ok: true, v: changed ? out : cur, sameAsLocal: !changed };
  }
  /* 寫進 mock_wrong(只寫一次)。回 { ok: 寫完讀回來每一題都在, wrong: 答錯幾筆, cleared: 已訂正幾筆 } */
  function save(add) {
    const keys = isPlain(add) ? Object.keys(add).filter((k) => isPlain(add[k]) && isNum(add[k].t)) : [];
    const wrong = keys.filter((k) => !add[k].ok).length, cleared = keys.length - wrong;
    if (!keys.length) return { ok: true, wrong: 0, cleared: 0 };
    const clean = {};
    keys.forEach((k) => { clean[k] = add[k]; });
    let m = null;
    try { m = put(store.get('mock_wrong', null), clean); } catch (e) { m = null; }
    if (!m || m.ok !== true) return { ok: false, wrong, cleared };
    if (!m.sameAsLocal) store.set('mock_wrong', m.v);
    const back = store.get('mock_wrong', null);
    const ok = isPlain(back) && keys.every((k) => isPlain(back[k]) && isNum(back[k].t) && back[k].t >= clean[k].t);
    return { ok, wrong, cleared };
  }

  /* 清單上的字(用字照學習記錄 js/history.js):題目最多 max 字;選項整句列出,跟學習記錄一樣不截(審查 2026-11-19:截在 30 字時 Part 7、聽力大半的正解看不完整) */
  const cut = (s, n) => { const t = String(s === undefined || s === null ? '' : s); return t.length > n ? t.slice(0, n) + '…' : t; };
  function stem(x, max) {
    const n = max || 90, q = x.q;
    if (x.p === '5') return cut(q.question, n);
    if (x.p === '6') return cut('空格 (' + q.num + ')' + (x.set && x.set.title ? ' · ' + x.set.title : ''), n);
    if (x.p === '2') return cut(q.question || '應答題', n);
    if (x.p === '1') return cut(q.photoAlt ? cut(q.photoAlt, 40) : '照片描述題', n);
    return cut(q.q, n);
  }
  function optText(q, c) {
    const L = typeof LETTERS !== 'undefined' && Array.isArray(LETTERS) ? LETTERS : ['A', 'B', 'C', 'D'];
    if (!q || !Number.isInteger(c) || c < 0 || !q.options || c >= q.options.length) return '';
    return L[c] + '. ' + String(q.options[c]);
  }

  root.WRONGBOOK = Object.freeze({
    ROUND, MAX, SINCE, PARTS, TITLE, MULTI, unit, isSetPart,
    ref, pick, itemsFrom, items, count, setCount, groups, round, cleanAns, fromAnswers, put, save, stem, optText,
  });
})(typeof window !== 'undefined' ? window : globalThis);
