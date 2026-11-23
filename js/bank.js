/* 題庫取題介面:要題目的程式從這裡拿,不直接讀 window.TOEIC。
   這一版背後接現在的靜態題庫(data/part5.js、part6.js、part7.js、listening.js)與題目索引(data/bank-meta.js,tools/merge_data.py 產生);
   之後換資料來源只改這個檔,呼叫的一方不用動,所以三個函式都回 Promise。
   window.BANK = {
     meta(part)  → 索引陣列(照題庫原順序,Part 1 到 7)。每筆 { id, part, difficulty, category, type, types, size, format, words, canYou },
                   只有該 Part 有的欄位(見 tools/bank_meta.py);part('1'–'7')有給就只回那個 Part。回傳的陣列與每筆都凍結
     get(ids)    → 題目陣列,跟 ids 同順序、同長度:P1、P2、P5 是那一題,P3、P4、P6、P7 是整組;題庫裡沒有的 id(例如已淘汰)那一格是 null。
                   回傳複本,改了不影響題庫。id 是 Part 的格式、可是那個 Part 的題庫檔沒載入時整個失敗(不當成沒有這題)
     pick(spec)  → id 陣列:照條件從索引選一個 Part 的題(或組),見下面 pick 的說明
   }
   作答紀錄的鍵跟練習頁一樣:drill_p5–p7、listen_p1–p4;題組小題 P6 是「組id:空格號」,P3、P4、P7 是「組id:第幾題(0 起算)」。 */
(function () {
  'use strict';
  const PARTS = ['1', '2', '3', '4', '5', '6', '7'];
  const SINGLE = { '1': true, '2': true, '5': true };
  const RECORD_KEY = { '1': 'listen_p1', '2': 'listen_p2', '3': 'listen_p3', '4': 'listen_p4', '5': 'drill_p5', '6': 'drill_p6', '7': 'drill_p7' };
  const KEY = p => RECORD_KEY[p];
  const ID_PART = /^(?:l([1-4])|p([5-7]))-/;   // 聽力 l1-、閱讀 p5- 開頭
  /* where 的欄位:陣列是「任一符合」;P6 的 type 看各小題(有一題的題型符合就算) */
  const WHERE = {
    difficulty: 'list', category: 'list', type: 'list', format: 'list', size: 'list', maxWords: 'number', canYou: 'boolean',
  };
  const ORDERS = ['fresh', 'random', 'listed'];

  function partOfId(id) {
    const m = ID_PART.exec(id);
    return m ? m[1] || m[2] : null;
  }

  /* 題庫檔:這個 Part 的陣列;沒載入回 null */
  function bankOf(part) {
    const T = window.TOEIC || {};
    const L = T.listening || {};
    const list = { '1': L.p1, '2': L.p2, '3': L.p3, '4': L.p4, '5': T.part5, '6': T.part6, '7': T.part7 }[part];
    return Array.isArray(list) ? list : null;
  }

  let metaCache = null;
  function metaRows() {
    if (metaCache) return metaCache;
    const M = window.BANK_META;
    if (!M || !Array.isArray(M.items)) throw new Error('題目索引沒有載入(data/bank-meta.js)');
    metaCache = Object.freeze(M.items.map(r => Object.freeze(Object.assign({}, r, r.types ? { types: Object.freeze(r.types.slice()) } : {}))));
    return metaCache;
  }

  function checkPart(part) {
    if (PARTS.indexOf(part) < 0) throw new TypeError('part 要是 1 到 7：' + JSON.stringify(part));
  }

  function meta(part) {
    return new Promise(resolve => {
      const rows = metaRows();
      if (part === undefined) { resolve(rows); return; }
      checkPart(String(part));
      resolve(Object.freeze(rows.filter(r => r.part === String(part))));
    });
  }

  const indexes = {};
  function byId(part) {
    if (indexes[part]) return indexes[part];
    const list = bankOf(part);
    if (!list) throw new Error('題庫沒有載入：Part ' + part);
    indexes[part] = new Map(list.map(x => [x.id, x]));
    return indexes[part];
  }

  function get(ids) {
    return new Promise(resolve => {
      if (!Array.isArray(ids) || ids.some(x => typeof x !== 'string' || !x)) throw new TypeError('ids 要是題目 id 字串的陣列');
      resolve(ids.map(id => {
        const part = partOfId(id);
        const item = part ? byId(part).get(id) : null;
        return item ? JSON.parse(JSON.stringify(item)) : null;
      }));
    });
  }

  /* ---------- pick ----------
     spec = {
       part:    '1'–'7'(必填)
       n:       要幾個(P1、P2、P5 是題,其他是組),0 以上的整數(必填)
       where:   { difficulty: [], category: [], type: [], format: [], size: [], maxWords: 225, canYou: false }(選填,見 WHERE)
                沒有該欄位的題不符合那個條件(例如 P6、P7 沒有 difficulty)
       within:  只從這些 id 裡選(選填)
       exclude: 不選這些 id(選填)
       order:   'fresh'(預設,跟練習頁一樣:沒做過的先,再來答錯過的,最後答對過的,各組內隨機)、'random'、'listed'(題庫順序)
       records: 作答紀錄(drill_p5 那種物件);沒給就讀這個帳號的 store
       random:  回 0–1 的函式,測試用;沒給用 Math.random
     }
     題組的狀態看各小題的紀錄:有一題沒做過算沒做過;都做過、有一題錯算答錯過;其餘算答對過(跟 js/practice.js 的 pickPool 一樣) */
  function checkSpec(spec) {
    if (!spec || typeof spec !== 'object') throw new TypeError('pick 要給條件物件');
    const part = String(spec.part);
    checkPart(part);
    if (!Number.isInteger(spec.n) || spec.n < 0) throw new TypeError('n 要是 0 以上的整數');
    const where = spec.where || {};
    Object.keys(where).forEach(k => {
      const kind = WHERE[k];
      if (!kind) throw new TypeError('where 沒有這個欄位：' + k);
      const v = where[k];
      const ok = kind === 'list' ? Array.isArray(v) : kind === 'number' ? typeof v === 'number' && v >= 0 : typeof v === 'boolean';
      if (!ok) throw new TypeError('where.' + k + ' 的值不對：' + JSON.stringify(v));
    });
    ['within', 'exclude'].forEach(k => {
      if (spec[k] !== undefined && !Array.isArray(spec[k])) throw new TypeError(k + ' 要是 id 陣列');
    });
    if (spec.order !== undefined && ORDERS.indexOf(spec.order) < 0) throw new TypeError('order 要是 ' + ORDERS.join('、'));
    return part;
  }

  function matches(row, where) {
    return Object.keys(where).every(k => {
      const want = where[k];
      if (k === 'maxWords') return typeof row.words === 'number' && row.words <= want;
      if (k === 'canYou') return typeof row.canYou === 'boolean' && row.canYou === want;
      if (k === 'type' && row.types) return row.types.some(t => want.indexOf(t) > -1);
      return row[k] !== undefined && want.indexOf(row[k]) > -1;
    });
  }

  /* 這一題(組)各小題的紀錄鍵 */
  function recordKeys(row) {
    if (SINGLE[row.part]) return [row.id];
    const keys = [];
    for (let i = 0; i < row.size; i++) keys.push(row.id + ':' + (row.part === '6' ? i + 1 : i));
    return keys;
  }

  function stateOf(row, records) {
    const recs = recordKeys(row).map(k => records[k]);
    if (recs.some(r => !r)) return 'fresh';
    return recs.some(r => !r.ok) ? 'wrong' : 'done';
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function recordsFor(p, spec) {
    if (spec.records !== undefined) {
      if (!spec.records || typeof spec.records !== 'object') throw new TypeError('records 要是物件');
      return spec.records;
    }
    /* store 是 js/common.js 的;鍵都是練習頁原本就在用的(搬家合併表已經有) */
    return typeof store !== 'undefined' ? store.get(KEY(p), {}) || {} : {};
  }

  function pick(spec) {
    return new Promise(resolve => {
      const part = checkSpec(spec);
      const where = spec.where || {};
      const within = spec.within ? new Set(spec.within) : null;
      const exclude = new Set(spec.exclude || []);
      const rand = typeof spec.random === 'function' ? spec.random : Math.random;
      const rows = metaRows().filter(r => r.part === part && (!within || within.has(r.id)) && !exclude.has(r.id) && matches(r, where));
      const order = spec.order || 'fresh';
      let out;
      if (order === 'listed') out = rows;
      else if (order === 'random') out = shuffle(rows, rand);
      else {
        const records = recordsFor(part, spec);
        const groups = { fresh: [], wrong: [], done: [] };
        rows.forEach(r => groups[stateOf(r, records)].push(r));
        out = [].concat(shuffle(groups.fresh, rand), shuffle(groups.wrong, rand), shuffle(groups.done, rand));
      }
      resolve(out.slice(0, spec.n).map(r => r.id));
    });
  }

  window.BANK = Object.freeze({ meta, get, pick, RECORD_KEY: Object.freeze(Object.assign({}, RECORD_KEY)) });
})();
