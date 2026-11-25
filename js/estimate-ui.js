/* 預估分數的共用畫面:window.ESTIMATE_UI。只畫畫面,資料由呼叫的一方給(View 是 ESTIMATE_STORE 的回傳),不讀寫任何儲存。
   畫面上的字都在 STR(一處),照網站用字:不承諾分數,分數旁一律寫「本站估計，不是正式成績。」。
   樣式在 css/estimate.css(刻度尺沿用 css/style.css 的 .band-scale);結果頁的卡片用 js/ui.js 的 UI.result,確認視窗用 UI.confirm。
   要先載入 js/ui.js(card 的改級確認、result 用到;沒載到時 card 照樣畫,改級直接呼叫,result 回 null)。

   對外的函式:
   · STR:畫面上的字(凍結物件;有數字的是函式)。
   · levelName(level) → '入門' | '門檻' | '進階' | '高分'(認不得回 '')
   · scoreText(v) → '345' | '150 以下' | '450 以上':v 是 View.L 或 View.R(要 show 是 true)。
   · rangeText(v) → '300–390';兩端(150 以下、450 以上)回 ''。
   · needText(sec, need) → '再做 8 題聽力，就會顯示預估分數。':need 是 View.L.need({ n, kind: 'any' | 'big' })。
     kind 'any' 的題數最多寫 12(做完那一科的 12 題檢測就會顯示)。
   · dateText(iso) → '11 月 25 日'(本機日期;壞掉回 '')
   · scale(sec, v, opt) → 節點:一科一條 5–495 的刻度尺,範圍塗色;兩端畫 5–150 或 450–495 那一段。opt.ticks:要不要刻度數字(預設 true)。
   · card(opt) → { el, destroy }:個人頁、能力分析頁共用的「預估多益分數」卡。
       opt = { view(View), testHref('placement.html'), practice({ L: 聽力練習網址, R: 刷題網址 },有使用權才給,「再做 N 題」那一行變成連結),
               suggest([{ sec, level }],ESTIMATE_STORE.suggestions 的回傳), hasCourse(有課程進度:改級前先確認),
               onLevel(sec, level)(按了「改成…」而且確認之後呼叫;可以回 Promise) }
       某一科還不夠時才有一顆實色主按鈕:兩科都不夠「做程度檢測」、只差聽力「做聽力檢測」、只差閱讀「做閱讀檢測」(連到 testHref?sec=L|R)。
       view.ok 是 false 或還沒有任何數字時,卡片只有標題與一顆主按鈕「做程度檢測」。
   · result(opt) → UI.result 的回傳(多一個 extra 節點)| null:檢測結果頁的分數區塊。
       opt = { view, primary, links(同 UI.result),earnId(同 UI.result),compact、inline(同 UI.result) }
       有總分:小標「預估總分」、大字總分、兩科數字;沒有總分:小標「預估分數」、大字寫有數字的那幾科。
       下面一行兩科範圍、每科一條刻度尺、不夠的那一科「再做 12 題閱讀，就會顯示預估分數。」、建議程度、入門的人多一行「從入門開始練習。」;
       小字「根據 24 題 · 本站估計，不是正式成績。」(題數是有數字的那幾科的計分題數,含平常練習)。
   · confirmLevel(hasCourse) → Promise<boolean>:有課程進度時跳「改級別會換學習包。」確認;沒有直接 true。 */
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
    note: '本站估計，不是正式成績。',
    low: '150 以下',
    high: '450 以上',
    startEntry: '從入門開始練習。',
    testBoth: '做程度檢測',
    testL: '做聽力檢測',
    testR: '做閱讀檢測',
    sec: SEC_NAME,
    level: LEVEL_NAME,
    need: (sec, n) => '再做 ' + n + ' 題' + SEC_NAME[sec] + '，就會顯示預估分數。',
    needBig: (sec, n) => '再做 ' + n + ' 題' + (sec === 'L' ? '對話或獨白題' : '閱讀題') + '，就會顯示預估分數。',
    basis: (n, date) => '根據 ' + n + ' 題 · ' + date,
    date: (m, d) => m + ' 月 ' + d + ' 日',
    basisNote: (n) => '根據 ' + n + ' 題 · 本站估計，不是正式成績。',
    suggest: (level) => '依目前預估，建議改成' + (LEVEL_NAME[level] || '') + '程度。',
    suggestBtn: (level) => '改成' + (LEVEL_NAME[level] || ''),
    levels: (parts) => '建議程度：' + parts.join('／'),
    confirmTitle: '改級別會換學習包。',
    confirmOk: '改級別',
    confirmCancel: '取消',
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
  function needText(sec, need) {
    const n = need && Number.isInteger(need.n) && need.n > 0 ? need.n : TEST_MAX;
    return need && need.kind === 'big' ? STR.needBig(sec, n) : STR.need(sec, Math.min(n, TEST_MAX));
  }
  function dateText(iso) {
    const t = Date.parse(iso);
    if (!fin(t)) return '';
    const d = new Date(t);
    return STR.date(d.getMonth() + 1, d.getDate());
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
  function suggestRow(s, opt) {
    const btn = el('button', 'btn-text est-suggest-go', STR.suggestBtn(s.level), { type: 'button' });
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      btn.disabled = true;
      confirmLevel(!!opt.hasCourse)
        .then((ok) => (ok && typeof opt.onLevel === 'function' ? opt.onLevel(s.sec, s.level) : null))
        .then(() => { btn.disabled = false; }, () => { btn.disabled = false; });
    });
    return el('p', 'est-suggest', [STR.suggest(s.level), btn]);
  }

  /* ---------- 卡片 ---------- */
  function needLine(sec, v, opt) {
    const text = needText(sec, v.need);
    const href = isPlain(opt.practice) ? opt.practice[sec] : null;
    return el('p', 'est-need', typeof href === 'string' && href ? el('a', null, text, { href }) : text);
  }
  function secRow(sec, v, opt) {
    if (!v || !v.show) {
      return el('div', 'est-row is-need', [el('span', 'est-sec', SEC_NAME[sec]), needLine(sec, v || {}, opt)]);
    }
    return el('div', 'est-row', [
      el('span', 'est-sec', [SEC_NAME[sec] + ' ', el('b', 'est-num', scoreText(v))]),
      scale(sec, v, { ticks: false }),
      el('span', 'est-range', rangeText(v)),
    ]);
  }
  function testAction(view, href) {
    const L = view.ok && view.L && view.L.show, R = view.ok && view.R && view.R.show;
    if (L && R) return null;
    const base = typeof href === 'string' && href ? href : 'placement.html';
    const join = base.indexOf('?') > -1 ? '&' : '?';
    if (!L && !R) return el('a', 'btn primary est-go', STR.testBoth, { href: base });
    return el('a', 'btn primary est-go', L ? STR.testR : STR.testL, { href: base + join + 'sec=' + (L ? 'R' : 'L') });
  }
  function card(opt) {
    const o = opt || {};
    const view = isPlain(o.view) ? o.view : { ok: false };
    const kids = [el('h2', 'est-title', STR.title)];
    const any = view.ok && ((view.L && view.L.show) || (view.R && view.R.show));
    if (any) {
      if (view.total) kids.push(el('p', 'est-total', [el('b', 'est-num', String(view.total.est)), '　' + STR.range + ' ' + view.total.lo + '–' + view.total.hi]));
      const sug = Array.isArray(o.suggest) ? o.suggest : [];
      ['L', 'R'].forEach((sec) => {
        kids.push(secRow(sec, view[sec], o));
        sug.filter((s) => s && s.sec === sec && LEVEL_NAME[s.level]).forEach((s) => kids.push(suggestRow(s, o)));
      });
      const n = ['L', 'R'].reduce((a, s) => a + (view[s] && view[s].show ? view[s].n || 0 : 0), 0);
      kids.push(el('p', 'est-meta', STR.basis(n, dateText(view.at))));
      kids.push(el('p', 'est-note', STR.note));
    }
    kids.push(testAction(view, o.testHref));
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
    ['L', 'R'].filter((s) => shown.indexOf(s) < 0).forEach((s) => kids.push(el('p', 'est-need', needText(s, view[s] && view[s].need))));
    if (shown.length) kids.push(el('p', 'est-levels', STR.levels(shown.map((s) => SEC_NAME[s] + ' ' + levelName(view[s].band)))));
    if (shown.some((s) => view[s].band === 'entry')) kids.push(el('p', 'est-entry', STR.startEntry));
    return el('div', 'est-result', kids);
  }
  function result(opt) {
    const o = opt || {}, U = root.UI;
    const view = isPlain(o.view) ? o.view : null;
    if (!U || typeof U.result !== 'function' || !view || !view.ok) return null;
    const head = resultHead(view);
    const n = ['L', 'R'].reduce((a, s) => a + (view[s] && view[s].show ? view[s].n || 0 : 0), 0);
    const r = U.result({
      kicker: head.kicker, big: head.big, stats: head.stats, note: STR.basisNote(n),
      primary: o.primary, links: o.links, earnId: o.earnId, compact: o.compact, inline: o.inline,
    });
    const extra = resultExtra(view);
    const anchor = r.reward || null;
    if (anchor && anchor.parentNode === r.el && typeof r.el.insertBefore === 'function') r.el.insertBefore(extra, anchor);
    else r.el.append(extra);
    return Object.assign({}, r, { extra });
  }

  root.ESTIMATE_UI = Object.freeze({ STR, levelName, scoreText, rangeText, needText, dateText, scale, card, result, confirmLevel });
})(typeof window !== 'undefined' ? window : globalThis);
