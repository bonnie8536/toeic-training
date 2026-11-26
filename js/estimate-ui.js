/* 預估分數的共用畫面:window.ESTIMATE_UI。只畫畫面,資料由呼叫的一方給(View 是 ESTIMATE_STORE 的回傳),不讀寫任何儲存。
   畫面上的字都在 STR(一處),照網站用字:不承諾分數。分數是怎麼來的、不是正式成績這類補充,不在數字旁掛小字,
   一律放進標題旁的 ⓘ 按鈕(infoButton),點開的資訊欄用完整的句子寫清楚。
   樣式在 css/estimate.css(刻度尺沿用 css/style.css 的 .band-scale);結果頁的卡片用 js/ui.js 的 UI.result,確認視窗用 UI.confirm,資訊欄用 UI.sheet。
   要先載入 js/ui.js(card 的改級確認、result、資訊欄用到;沒載到時 card 照樣畫,改級直接呼叫,result 回 null,ⓘ 不畫)。

   對外的函式:
   · STR:畫面上的字(凍結物件;有數字的是函式)。
   · levelName(level) → '入門' | '門檻' | '進階' | '高分'(認不得回 '')
   · scoreText(v) → '345' | '150 以下' | '450 以上':v 是 View.L 或 View.R(要 show 是 true)。
   · rangeText(v) → '300–390';兩端(150 以下、450 以上)回 ''。
   · needText(sec, need, opt) → '再做 8 題就有分數':need 是 View.L.need({ n, kind: 'any' | 'big' });kind 'big' 是「再做 3 題對話或獨白就有分數」。
     題數照實寫(題數不夠時是 20 − 已做的計分題數)。opt.test 為真時(檢測結果頁,指的是做那一科的 12 題檢測)kind 'any' 最多寫 12。
   · dateText(iso) → '11 月 25 日'(本機日期;壞掉回 '')
   · infoParas(kind, view) → 字串陣列:資訊欄的段落(完整的句子)。
       'est':預估分數;view 有資料時多一段「目前用了 N 題來算，算到 M 月 D 日的作答。」。view 也可以是 { n, at }(教師後台)。
       'mock':模擬考結果。'diag':舊的 28 題檢測報告的級距,view = { n: 題數 }。
       'level':新用戶設定結果頁的起始程度,view = { from: 'est' | 'score' | 'legacy' | 'calibrate', old: 自填成績超過 2 年 };都沒有時回 []。
   · infoButton(opt) → 按鈕 | null:小的圓形 i 圖示(線條,觸控範圍 44px),點了用 UI.sheet 開資訊欄;關了焦點回到按鈕。
       opt = { kind, view };UI.sheet 沒載到、沒有段落時回 null。
   · addInfo(cardEl, kind, view, at) → 按鈕 | null:把 ⓘ 放進 UI.result 卡片的小標(.result-kicker)那一行;
       at 是 'heading'(或卡片沒有小標)時放在大標題(.result-score)旁。
   · scale(sec, v, opt) → 節點:一科一條 5–495 的刻度尺,範圍塗色;兩端畫 5–150 或 450–495 那一段。opt.ticks:要不要刻度數字(預設 true)。
   · card(opt) → { el, destroy }:個人頁、能力分析頁共用的「預估多益分數」卡(標題旁一個 ⓘ)。
       opt = { view(View), testHref('placement.html'),
               suggest([{ sec, level }],ESTIMATE_STORE.suggestions 的回傳), hasCourse(有課程進度:確認視窗多說會換學習包),
               onLevel(sec, level)(按了「改成…」而且確認之後呼叫;可以回 Promise) }
       數字還不夠的那一科:分數的位置寫「再做 N 題就有分數」,要做的事只有下面那一顆檢測按鈕。
       建議改級是一顆文字按鈕「改成高分程度」,原因寫在按了之後的確認視窗。
       某一科還不夠時才有一顆檢測按鈕:兩科都不夠「做程度檢測」、只差聽力「做聽力檢測」、只差閱讀「做閱讀檢測」(連到 testHref?sec=L|R)。
       opt.solid(預設 true):檢測按鈕是實色主按鈕;頁面上已經有別的實色主按鈕時(「我的」頁)給 false,改成描邊按鈕。
       view.ok 是 false 或還沒有任何數字時,卡片只有標題、ⓘ 與那一顆檢測按鈕「做程度檢測」。
   · result(opt) → UI.result 的回傳(多一個 extra 節點)| null:檢測結果頁的分數區塊。
       opt = { view, primary, links(同 UI.result),earnId(同 UI.result),compact、inline(同 UI.result) }
       有總分:小標「預估總分」、大字總分、兩科數字;沒有總分:小標「預估分數」、大字寫有數字的那幾科。小標旁一個 ⓘ。
       下面每科一條刻度尺(右邊寫「範圍 210–380」)、不夠的那一科「閱讀　再做 12 題就有分數」、建議程度。
   · confirmLevel(hasCourse) → Promise<boolean>:有課程進度時跳「改程度會換學習包，要改嗎？」確認;沒有直接 true。
   · confirmSuggest(s, hasCourse) → Promise<boolean>:卡片上「改成…」的確認(一律跳;原因寫在視窗裡)。沒有 UI.confirm 時直接 true。 */
(function (root) {
  'use strict';
  const LEVEL_NAME = Object.freeze({ entry: '入門', threshold: '門檻', advanced: '進階', high: '高分' });
  const SEC_NAME = Object.freeze({ L: '聽力', R: '閱讀' });
  const TEST_MAX = 12;
  const STR = Object.freeze({
    title: '預估多益分數',
    kickerTotal: '預估總分',
    kicker: '預估分數',
    range: '範圍',
    low: '150 以下',
    high: '450 以上',
    testBoth: '做程度檢測',
    testL: '做聽力檢測',
    testR: '做閱讀檢測',
    sec: SEC_NAME,
    level: LEVEL_NAME,
    need: (sec, n) => '再做 ' + n + ' 題就有分數',
    needBig: (sec, n) => '再做 ' + n + ' 題' + (sec === 'L' ? '對話或獨白' : '') + '就有分數',
    date: (m, d) => m + ' 月 ' + d + ' 日',
    suggestBtn: (level) => '改成' + (LEVEL_NAME[level] || '') + '程度',
    suggestTitle: (sec, level) => SEC_NAME[sec] + '改成' + (LEVEL_NAME[level] || '') + '程度？',
    suggestBody: (sec, level, course) => '依目前的預估分數，你的' + SEC_NAME[sec] + '比較接近' + (LEVEL_NAME[level] || '') + '程度。'
      + (course ? '改了之後，學習包會換成' + (LEVEL_NAME[level] || '') + '程度的。' : ''),
    suggestCancel: '先不要',
    levels: (parts) => '建議程度：' + parts.join('／'),
    confirmTitle: '改程度會換學習包，要改嗎？',
    confirmOk: '改程度',
    confirmCancel: '取消',
    info: Object.freeze({
      est: Object.freeze({
        label: '預估分數說明',
        title: '預估分數',
        paras: Object.freeze([
          '這個分數是本站依你的作答估計的，不是多益的正式成績。',
          '每一題只算第一次作答。重做和錯題本的作答不算。',
          '範圍：如果現在去考多益，分數很可能在這個範圍內。做的題目越多，範圍會越窄。',
          '每一科要有 20 題第一次作答，才會顯示分數；做該科的程度檢測（12 題）也可以。',
        ]),
        basis: (n, date) => '目前用了 ' + n + ' 題來算，算到 ' + date + '的作答。',
      }),
      mock: Object.freeze({
        label: '模擬考分數說明',
        title: '模擬考分數',
        paras: Object.freeze([
          '這個分數是本站依這次答對的題數估計的，不是多益的正式成績。',
          '每一次的題目不一樣，難度也會差一點，所以分數上下差 30 分左右是正常的。',
          '想知道分數有沒有提高，請比較好幾次的分數，不要只看一次。',   // 網站用字不寫「進步」
        ]),
      }),
      /* 舊的 28 題檢測報告(diagnostic.html):view 是 { n: 題數 } */
      diag: Object.freeze({
        label: '預估級距說明',
        title: '預估級距',
        paras: (n) => [
          '這個級距是本站依這次 ' + n + ' 題的答對題數估計的，不是多益的正式成績。',
          '題目只有 ' + n + ' 題，所以級距放得比較寬，只用來找起始程度。',
        ],
      }),
      /* 新用戶設定的結果頁「你的起始程度」:view 是 { from: 'est' | 'score' | 'legacy' | 'calibrate', old: 自填的成績超過 2 年 };
         calibrate:第 4 堂後依第 2 到 4 堂的答對率調整過 */
      level: Object.freeze({
        label: '起始程度說明',
        title: '起始程度',
        from: Object.freeze({
          est: '這個程度是依你的程度檢測和之後的練習結果定的。',
          score: '這個程度是依你填的多益成績定的。',
          legacy: '閱讀的程度是依你上次的閱讀檢測定的。聽力沒有檢測，先設成比閱讀高一個程度。',
          calibrate: '這個程度依第 2 到 4 堂第一次作答的答對率調整過。',
        }),
        old: '你填的成績已經超過 2 年，現在的程度可能不一樣，可以做一次程度檢測。',
      }),
    }),
    close: '關閉',
  });

  const doc = () => root.document;
  function el(tag, cls, kids, attrs) {
    const n = doc().createElement(tag);
    if (cls) n.className = cls;
    Object.keys(attrs || {}).forEach((k) => { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, String(attrs[k])); });
    [].concat(kids === undefined || kids === null ? [] : kids).forEach((c) => {
      if (c === null || c === undefined || c === '') return;
      n.append(typeof c === 'object' ? c : doc().createTextNode(String(c)));
    });
    return n;
  }
  const fin = (x) => typeof x === 'number' && isFinite(x);
  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

  /* ---------- 文字 ---------- */
  function levelName(level) { return LEVEL_NAME[level] || ''; }
  function scoreText(v) {
    if (!v || !v.show) return '';
    return v.kind === 'low' ? STR.low : v.kind === 'high' ? STR.high : String(v.est);
  }
  function rangeText(v) { return v && v.show && v.kind === 'num' && fin(v.lo) && fin(v.hi) ? v.lo + '–' + v.hi : ''; }
  function needText(sec, need, opt) {
    const test = !!(opt && opt.test);
    const n = need && Number.isInteger(need.n) && need.n > 0 ? need.n : TEST_MAX;
    if (need && need.kind === 'big') return STR.needBig(sec, n);
    return STR.need(sec, test ? Math.min(n, TEST_MAX) : n);
  }
  function dateText(iso) {
    const t = Date.parse(iso);
    if (!fin(t)) return '';
    const d = new Date(t);
    return STR.date(d.getMonth() + 1, d.getDate());
  }
  /* 計分題數:有數字的那幾科加起來(View 的 L.n、R.n);{ n } 直接用 */
  function basisN(view) {
    if (!isPlain(view)) return 0;
    if (Number.isInteger(view.n) && !isPlain(view.L) && !isPlain(view.R)) return view.n;
    return ['L', 'R'].reduce((a, s) => a + (view[s] && view[s].show && Number.isInteger(view[s].n) ? view[s].n : 0), 0);
  }

  /* ---------- ⓘ 資訊欄 ---------- */
  const KINDS = Object.freeze(['est', 'mock', 'diag', 'level']);
  const kindOf = (kind) => (KINDS.indexOf(kind) > -1 ? kind : 'est');
  function levelParas(view) {
    const I = STR.info.level, v = isPlain(view) ? view : {};
    const paras = I.from[v.from] ? [I.from[v.from]] : [];
    if (v.old === true) paras.push(I.old);
    return paras;
  }
  function infoParas(kind, view) {
    const k = kindOf(kind);
    if (k === 'diag') return STR.info.diag.paras(isPlain(view) && Number.isInteger(view.n) && view.n > 0 ? view.n : 28);
    if (k === 'level') return levelParas(view);
    const paras = STR.info[k].paras.slice();
    if (k === 'est') {
      const n = basisN(view), date = isPlain(view) ? dateText(view.at) : '';
      if (n > 0 && date) paras.push(STR.info.est.basis(n, date));
    }
    return paras;
  }
  const SVG = 'http://www.w3.org/2000/svg';
  function infoIcon() {
    if (typeof doc().createElementNS !== 'function') return null;
    const s = doc().createElementNS(SVG, 'svg');
    [['viewBox', '0 0 24 24'], ['width', '22'], ['height', '22'], ['aria-hidden', 'true'], ['focusable', 'false'], ['fill', 'none'],
      ['stroke', 'currentColor'], ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]
      .forEach((a) => s.setAttribute(a[0], a[1]));
    const c = doc().createElementNS(SVG, 'circle');
    c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '9.2');
    const p = doc().createElementNS(SVG, 'path');
    p.setAttribute('d', 'M12 10.8v5.6');
    const dot = doc().createElementNS(SVG, 'path');
    dot.setAttribute('d', 'M12 7.6v.1');
    dot.setAttribute('stroke-width', '2.4');
    s.append(c, p, dot);
    return s;
  }
  function infoButton(opt) {
    const o = opt || {}, U = root.UI;
    if (!U || typeof U.sheet !== 'function') return null;
    const k = kindOf(o.kind);
    if (!infoParas(k, o.view).length) return null;
    const btn = el('button', 'est-info', [infoIcon()], { type: 'button', 'aria-label': STR.info[k].label, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    btn.addEventListener('click', () => {
      try { btn.focus(); } catch (e) { /* Safari 點按鈕不給焦點:先給,關了才回得來 */ }
      U.sheet({
        title: STR.info[k].title, class: 'est-info-sheet', closeLabel: STR.close,
        nodes: infoParas(k, o.view).map((t) => el('p', 'est-info-p', t)),
      });
    });
    return btn;
  }

  /* ---------- 刻度尺 ---------- */
  const MIN = 5, MAX = 495, TICKS = [5, 100, 200, 300, 400, 495];
  const pct = (x) => ((x - MIN) / (MAX - MIN) * 100).toFixed(1) + '%';
  function segOf(v) {
    if (v.kind === 'low') return [MIN, 150];
    if (v.kind === 'high') return [450, MAX];
    return [v.lo, v.hi];
  }
  function scale(sec, v, opt) {
    const ticks = !(opt && opt.ticks === false);
    const box = el('div', 'band-scale est-scale' + (ticks ? '' : ' is-bare'), null, { role: 'img', 'aria-label': SEC_NAME[sec] + ' ' + (rangeText(v) || scoreText(v)) });
    box.append(el('div', 'bs-track'));
    if (v && v.show) {
      const [lo, hi] = segOf(v);
      box.append(el('div', 'bs-seg', null, { style: 'left:' + pct(lo) + ';width:' + ((hi - lo) / (MAX - MIN) * 100).toFixed(1) + '%' }));
    }
    if (ticks) TICKS.forEach((t) => box.append(el('span', 'bs-tick', String(t), { style: 'left:' + pct(t) })));
    return box;
  }

  /* ---------- 改級 ---------- */
  function confirmLevel(hasCourse) {
    const U = root.UI;
    if (!hasCourse || !U || typeof U.confirm !== 'function') return Promise.resolve(true);
    return Promise.resolve(U.confirm({ title: STR.confirmTitle, ok: STR.confirmOk, cancel: STR.confirmCancel })).then((ok) => ok === true);
  }
  function confirmSuggest(s, hasCourse) {
    const U = root.UI;
    if (!U || typeof U.confirm !== 'function') return Promise.resolve(true);
    return Promise.resolve(U.confirm({
      title: STR.suggestTitle(s.sec, s.level), body: STR.suggestBody(s.sec, s.level, !!hasCourse),
      ok: STR.suggestBtn(s.level), cancel: STR.suggestCancel,
    })).then((ok) => ok === true);
  }
  function suggestRow(s, opt) {
    const btn = el('button', 'btn-text est-suggest-go', STR.suggestBtn(s.level), { type: 'button' });   // 原因寫在按了之後的確認視窗
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      btn.disabled = true;
      confirmSuggest(s, !!opt.hasCourse)
        .then((ok) => (ok && typeof opt.onLevel === 'function' ? opt.onLevel(s.sec, s.level) : null))
        .then(() => { btn.disabled = false; }, () => { btn.disabled = false; });
    });
    return el('p', 'est-suggest', [btn]);
  }

  /* ---------- 卡片 ---------- */
  function secRow(sec, v) {
    if (!v || !v.show) {   // 要做的事只有一個:下面那顆檢測按鈕
      return el('div', 'est-row is-need', [el('span', 'est-sec', [SEC_NAME[sec] + ' ', el('span', 'est-left', needText(sec, (v || {}).need))])]);
    }
    return el('div', 'est-row', [
      el('span', 'est-sec', [SEC_NAME[sec] + ' ', el('b', 'est-num', scoreText(v))]),
      scale(sec, v, { ticks: false }),
      el('span', 'est-range', rangeText(v)),
    ]);
  }
  function testAction(view, href, solid) {
    const L = view.ok && view.L && view.L.show, R = view.ok && view.R && view.R.show;
    if (L && R) return null;
    const base = typeof href === 'string' && href ? href : 'placement.html';
    const join = base.indexOf('?') > -1 ? '&' : '?';
    const cls = solid === false ? 'btn est-go' : 'btn primary est-go';
    if (!L && !R) return el('a', cls, STR.testBoth, { href: base });
    return el('a', cls, L ? STR.testR : STR.testL, { href: base + join + 'sec=' + (L ? 'R' : 'L') });
  }
  function card(opt) {
    const o = opt || {};
    const view = isPlain(o.view) ? o.view : { ok: false };
    const kids = [el('div', 'est-head', [el('h2', 'est-title', STR.title), infoButton({ kind: 'est', view })])];
    const any = view.ok && ((view.L && view.L.show) || (view.R && view.R.show));
    if (any) {
      if (view.total) kids.push(el('p', 'est-total', [el('b', 'est-num', String(view.total.est)), '　' + STR.range + ' ' + view.total.lo + '–' + view.total.hi]));
      const sug = Array.isArray(o.suggest) ? o.suggest : [];
      ['L', 'R'].forEach((sec) => {
        kids.push(secRow(sec, view[sec]));
        sug.filter((s) => s && s.sec === sec && LEVEL_NAME[s.level]).forEach((s) => kids.push(suggestRow(s, o)));
      });
    }
    kids.push(testAction(view, o.testHref, o.solid));
    const box = el('section', 'est-card', kids);
    return { el: box, destroy() { box.remove(); } };
  }

  /* ---------- 結果頁 ---------- */
  function resultHead(view) {
    const shown = ['L', 'R'].filter((s) => view[s] && view[s].show);
    if (view.total) {
      return { kicker: STR.kickerTotal, big: view.total.est, stats: shown.map((s) => [SEC_NAME[s], scoreText(view[s])]) };
    }
    return { kicker: STR.kicker, big: shown.map((s) => SEC_NAME[s] + ' ' + scoreText(view[s])).join('　') };
  }
  function resultExtra(view) {
    const shown = ['L', 'R'].filter((s) => view[s] && view[s].show);
    const kids = [];
    /* 範圍只寫一次:刻度尺右邊「範圍 210–380」(兩端的 150 以下、450 以上只有塗色) */
    shown.forEach((s) => kids.push(el('div', 'est-scale-row', [el('span', 'est-sec', SEC_NAME[s]), scale(s, view[s]),
      el('span', 'est-range', rangeText(view[s]) ? STR.range + ' ' + rangeText(view[s]) : '')])));
    ['L', 'R'].filter((s) => shown.indexOf(s) < 0).forEach((s) => kids.push(el('p', 'est-need', SEC_NAME[s] + '　' + needText(s, view[s] && view[s].need, { test: true }))));
    if (shown.length) kids.push(el('p', 'est-levels', STR.levels(shown.map((s) => SEC_NAME[s] + ' ' + levelName(view[s].band)))));
    return el('div', 'est-result', kids);
  }
  /* 小標旁的 ⓘ:放進 UI.result 的 .result-kicker 那一行;at 是 'heading'(或卡片沒有小標)時放在大標題(.result-score)旁 */
  function addInfo(cardEl, kind, view, at) {
    const q = (sel) => (cardEl && cardEl.querySelector ? cardEl.querySelector(sel) : null);
    const kick = at === 'heading' ? null : q('.result-kicker');
    const k = kick || q('.result-score');
    const btn = k ? infoButton({ kind, view }) : null;
    if (btn) { k.classList.add(kick ? 'est-kicker' : 'est-heading'); k.append(btn); }
    return btn;
  }
  function result(opt) {
    const o = opt || {}, U = root.UI;
    const view = isPlain(o.view) ? o.view : null;
    if (!U || typeof U.result !== 'function' || !view || !view.ok) return null;
    const head = resultHead(view);
    const r = U.result({
      kicker: head.kicker, big: head.big, stats: head.stats,
      primary: o.primary, links: o.links, earnId: o.earnId, compact: o.compact, inline: o.inline,
    });
    addInfo(r.el, 'est', view);
    const extra = resultExtra(view);
    const anchor = r.reward || null;
    if (anchor && anchor.parentNode === r.el && typeof r.el.insertBefore === 'function') r.el.insertBefore(extra, anchor);
    else r.el.append(extra);
    return Object.assign({}, r, { extra });
  }

  root.ESTIMATE_UI = Object.freeze({ STR, levelName, scoreText, rangeText, needText, dateText, infoParas, infoButton, addInfo, scale, card, result, confirmLevel, confirmSuggest });
})(typeof window !== 'undefined' ? window : globalThis);
