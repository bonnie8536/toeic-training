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
   · needText(sec, need, opt) → '還差 8 題':need 是 View.L.need({ n, kind: 'any' | 'big' });kind 'big' 是「還差 3 題對話或獨白」。
     題數照實寫(題數不夠時是 20 − 已做的計分題數)。opt.test 為真時(檢測結果頁,指的是做那一科的 12 題檢測)kind 'any' 最多寫 12。
   · dateText(iso) → '11 月 25 日'(本機日期;壞掉回 '')
   · infoParas(kind, view) → 字串陣列:資訊欄的段落。kind 'est'(預估分數;view 有資料時多一段「目前根據 N 題，更新到 M 月 D 日。」)、
     'mock'(模擬考結果)。view 也可以是 { n, at }(教師後台)。
   · infoButton(opt) → 按鈕 | null:小的圓形 i 圖示(線條,觸控範圍 44px),點了用 UI.sheet 開資訊欄;關了焦點回到按鈕。
       opt = { kind: 'est' | 'mock', view };UI.sheet 沒載到回 null。
   · addInfo(cardEl, kind, view) → 按鈕 | null:把 ⓘ 放進 UI.result 卡片的小標(.result-kicker)那一行(模擬考結果頁也用)。
   · scale(sec, v, opt) → 節點:一科一條 5–495 的刻度尺,範圍塗色;兩端畫 5–150 或 450–495 那一段。opt.ticks:要不要刻度數字(預設 true)。
   · card(opt) → { el, destroy }:個人頁、能力分析頁共用的「預估多益分數」卡(標題旁一個 ⓘ)。
       opt = { view(View), testHref('placement.html'), practice({ L: 聽力練習網址, R: 刷題網址 },有使用權才給,「還差 N 題」旁邊多一個「去練習」),
               suggest([{ sec, level }],ESTIMATE_STORE.suggestions 的回傳), hasCourse(有課程進度:確認視窗多說會換學習包),
               onLevel(sec, level)(按了「改成…」而且確認之後呼叫;可以回 Promise) }
       數字還不夠的那一科:分數的位置寫「還差 N 題」。建議改級是一行「建議程度　高分」加文字按鈕「改成高分」,原因寫在按了之後的確認視窗。
       某一科還不夠時才有一顆檢測按鈕:兩科都不夠「做程度檢測」、只差聽力「做聽力檢測」、只差閱讀「做閱讀檢測」(連到 testHref?sec=L|R)。
       opt.solid(預設 true):檢測按鈕是實色主按鈕;頁面上已經有別的實色主按鈕時(「我的」頁)給 false,改成描邊按鈕。
       view.ok 是 false 或還沒有任何數字時,卡片只有標題、ⓘ 與那一顆檢測按鈕「做程度檢測」。
   · result(opt) → UI.result 的回傳(多一個 extra 節點)| null:檢測結果頁的分數區塊。
       opt = { view, primary, links(同 UI.result),earnId(同 UI.result),compact、inline(同 UI.result) }
       有總分:小標「預估總分」、大字總分、兩科數字;沒有總分:小標「預估分數」、大字寫有數字的那幾科。小標旁一個 ⓘ。
       下面一行兩科範圍、每科一條刻度尺、不夠的那一科「閱讀　還差 12 題」、建議程度。
   · confirmLevel(hasCourse) → Promise<boolean>:有課程進度時跳「改級別會換學習包。」確認;沒有直接 true。
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
    practice: '去練習',
    sec: SEC_NAME,
    level: LEVEL_NAME,
    need: (sec, n) => '還差 ' + n + ' 題',
    needBig: (sec, n) => '還差 ' + n + ' 題' + (sec === 'L' ? '對話或獨白' : ''),
    date: (m, d) => m + ' 月 ' + d + ' 日',
    suggestLabel: '建議程度',
    gap: '　',   // 「建議程度」「高分」「改成高分」之間:讀屏與複製時也分得開
    suggestBtn: (level) => '改成' + (LEVEL_NAME[level] || ''),
    suggestTitle: (sec, level) => SEC_NAME[sec] + '改成' + (LEVEL_NAME[level] || '') + '程度？',
    suggestBody: (sec, level, course) => '依目前的預估分數，你的' + SEC_NAME[sec] + '比較接近' + (LEVEL_NAME[level] || '') + '程度。'
      + (course ? '改了之後，學習包會換成' + (LEVEL_NAME[level] || '') + '程度的。' : ''),
    suggestCancel: '先不要',
    levels: (parts) => '建議程度：' + parts.join('／'),
    confirmTitle: '改級別會換學習包。',
    confirmOk: '改級別',
    confirmCancel: '取消',
    info: Object.freeze({
      est: Object.freeze({
        label: '預估分數說明',
        title: '預估分數',
        paras: Object.freeze([
          '這個分數是本站依你的作答估計的，不是多益的正式成績。',
          '每一題只算第一次作答。重做和錯題本的作答不算。',
          '範圍：你的實際分數大多落在這個範圍內。作答的題數越多，範圍越窄。',
        ]),
        basis: (n, date) => '目前根據 ' + n + ' 題，更新到 ' + date + '。',
      }),
      mock: Object.freeze({
        label: '模擬考分數說明',
        title: '模擬考分數',
        paras: Object.freeze([
          '這個分數是本站依這次答對的題數估計的，不是多益的正式成績。',
          '每次的題目難度不同，分數適合用來看自己的變化。',
        ]),
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
  function infoParas(kind, view) {
    const k = kind === 'mock' ? 'mock' : 'est';
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
    const k = o.kind === 'mock' ? 'mock' : 'est';
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
    const btn = el('button', 'btn-text est-suggest-go', STR.suggestBtn(s.level), { type: 'button' });
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      btn.disabled = true;
      confirmSuggest(s, !!opt.hasCourse)
        .then((ok) => (ok && typeof opt.onLevel === 'function' ? opt.onLevel(s.sec, s.level) : null))
        .then(() => { btn.disabled = false; }, () => { btn.disabled = false; });
    });
    return el('p', 'est-suggest', [el('span', 'est-suggest-k', STR.suggestLabel), STR.gap, el('b', 'est-suggest-v', LEVEL_NAME[s.level]), STR.gap, btn]);
  }

  /* ---------- 卡片 ---------- */
  function secRow(sec, v, opt) {
    if (!v || !v.show) {
      const href = isPlain(opt.practice) ? opt.practice[sec] : null;
      return el('div', 'est-row is-need', [
        el('span', 'est-sec', [SEC_NAME[sec] + ' ', el('span', 'est-left', needText(sec, (v || {}).need))]),
        typeof href === 'string' && href ? el('a', 'est-practice', STR.practice, { href }) : null,
      ]);
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
        kids.push(secRow(sec, view[sec], o));
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
    const ranges = shown.filter((s) => rangeText(view[s])).map((s) => SEC_NAME[s] + ' ' + rangeText(view[s]));
    const kids = [];
    if (ranges.length) kids.push(el('p', 'est-ranges', ranges.join('　')));
    shown.forEach((s) => kids.push(el('div', 'est-scale-row', [el('span', 'est-sec', SEC_NAME[s]), scale(s, view[s])])));
    ['L', 'R'].filter((s) => shown.indexOf(s) < 0).forEach((s) => kids.push(el('p', 'est-need', SEC_NAME[s] + '　' + needText(s, view[s] && view[s].need, { test: true }))));
    if (shown.length) kids.push(el('p', 'est-levels', STR.levels(shown.map((s) => SEC_NAME[s] + ' ' + levelName(view[s].band)))));
    return el('div', 'est-result', kids);
  }
  /* 小標旁的 ⓘ:放進 UI.result 的 .result-kicker 那一行 */
  function addInfo(cardEl, kind, view) {
    const k = cardEl && cardEl.querySelector ? cardEl.querySelector('.result-kicker') : null;
    const btn = k ? infoButton({ kind, view }) : null;
    if (btn) { k.classList.add('est-kicker'); k.append(btn); }
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
