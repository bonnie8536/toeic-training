/* 預估分數的共用畫面(js/estimate-ui.js):預估分數卡各狀態的字與一顆實色主按鈕、建議改級的文字按鈕與確認、
   結果頁的分數區塊(有總分、只做一科、兩端、入門)、刻度尺、字串用字(不承諾分數、全形標點)。
   在 node 的 vm 裡跑,配很小的假 DOM 與假的 UI(tools/estimate_kit.js)。用法:node tools/test_estimate_ui.js */
'use strict';
const assert = require('assert');
const K = require('./estimate_kit');

const { NOW, DAY, CPID, eq, J } = K;
const ctx = K.load();
const U = ctx.ESTIMATE_UI, S = ctx.ESTIMATE_STORE, E = ctx.ESTIMATE, P = ctx.ITEM_PARAMS;
const AT = new Date(NOW).toISOString();
const txt = (n) => String(n.textContent).replace(/[ \t\n]+/g, ' ').trim();   // 全形空白「　」是字的一部分,不併
const all = (n, sel) => n.querySelectorAll(sel);
const primaries = (n) => all(n, '.btn.primary');
const parts = (n) => n.children.map(txt).filter(Boolean).join('|');
const sec = (est, lo, hi, n, extra) => Object.assign({ show: true, kind: est < 150 ? 'low' : est >= 450 ? 'high' : 'num', est, lo, hi, n, band: E.bandOf('L', est), pb: [0, 1, 0, 0], need: null }, extra);
const need = (n, kind) => ({ show: false, need: { n, kind }, n: 0 });
const view = (L, R, total) => ({ ok: true, L, R, total: total || null, at: AT });
const T = {};

/* ---------- 卡片 ---------- */
T['卡片:沒有資料(或算不出來)時只有標題和一顆主按鈕「做程度檢測」'] = () => {
  [view(need(20, 'any'), need(20, 'any')), { ok: false, L: null, R: null }, null].forEach((v, i) => {
    const c = U.card({ view: v }).el;
    eq([all(c, '.est-title').map(txt), primaries(c).map(txt), primaries(c)[0].getAttribute('href')], [['預估多益分數'], ['做程度檢測'], 'placement.html'], 'case ' + i);
    assert.equal(all(c, '.est-row').length, 0);
    assert.equal(all(c, '.est-note').length, 0);
  });
  return 'ok';
};
T['卡片:兩科都有數字:總分與範圍、兩科的數字刻度尺與範圍、根據 N 題與日期、本站估計;沒有主按鈕'] = () => {
  const v = view(sec(345, 300, 390, 100), sec(290, 245, 335, 86), { est: 635, lo: 545, hi: 725 });
  const c = U.card({ view: v }).el;
  eq(txt(all(c, '.est-total')[0]), '635　範圍 545–725');
  eq(all(c, '.est-row').map(parts), ['聽力 345|300–390', '閱讀 290|245–335']);
  eq(all(c, '.est-meta').map(txt), ['根據 186 題 · ' + U.dateText(AT)]);
  eq(all(c, '.est-note').map(txt), ['本站估計，不是正式成績。']);
  assert.equal(primaries(c).length, 0);
  assert.equal(all(c, '.bs-seg').length, 2);
  return U.dateText(AT);
};
T['卡片:只差聽力:聽力寫「再做 12 題聽力」(最多寫 12)、主按鈕「做聽力檢測」連到 sec=L;有使用權時那一行連到練習頁'] = () => {
  const v = view(need(20, 'any'), sec(290, 245, 335, 28));
  const c = U.card({ view: v, practice: { L: 'listening.html', R: 'practice.html' } }).el;
  eq(all(c, '.est-need').map(txt), ['再做 12 題聽力，就會顯示預估分數。']);
  eq(all(c, '.est-need a').map((a) => a.getAttribute('href')), ['listening.html']);
  eq(primaries(c).map((b) => [txt(b), b.getAttribute('href')]), [['做聽力檢測', 'placement.html?sec=L']]);
  assert.equal(all(c, '.est-total').length, 0, '一科沒有數字就沒有總分');
  const r = U.card({ view: view(sec(345, 300, 390, 30), need(8, 'big')), testHref: 'placement.html?from=me' }).el;
  eq(all(r, '.est-need').map(txt), ['再做 8 題閱讀題，就會顯示預估分數。']);
  eq(all(r, '.est-need a').length, 0, '沒給練習頁就不加連結');
  eq(primaries(r).map((b) => [txt(b), b.getAttribute('href')]), [['做閱讀檢測', 'placement.html?from=me&sec=R']]);
  eq(U.needText('L', { n: 5, kind: 'any' }), '再做 5 題聽力，就會顯示預估分數。');
  eq(U.needText('L', { n: 6, kind: 'big' }), '再做 6 題對話或獨白題，就會顯示預估分數。');
  return 'ok';
};
T['卡片:兩端寫「150 以下」「450 以上」、不寫範圍,刻度尺畫 5–150 或 450–495'] = () => {
  const v = view(sec(470, 420, 495, 60), sec(120, 70, 170, 40));
  const c = U.card({ view: v }).el;
  eq(all(c, '.est-row').map(parts), ['聽力 450 以上', '閱讀 150 以下']);
  eq(all(c, '.bs-seg').map((n) => n.getAttribute('style')), ['left:90.8%;width:9.2%', 'left:0.0%;width:29.6%']);
  eq([U.scoreText(v.L), U.rangeText(v.L), U.rangeText(sec(300, 250, 495, 1))], ['450 以上', '', '250–495']);
  return 'ok';
};
T['卡片:建議改級:那一科下面一行「依目前預估，建議改成進階程度。」加文字按鈕;有課程進度先確認,確認了才改;沒有課程進度直接改'] = async () => {
  const v = view(sec(345, 300, 390, 100), sec(290, 245, 335, 86), { est: 635, lo: 545, hi: 725 });
  const calls = [];
  const onLevel = (s, l) => { calls.push(s + ':' + l); };
  const c = U.card({ view: v, suggest: [{ sec: 'L', level: 'advanced' }, { sec: 'R', level: 'nope' }], hasCourse: true, onLevel }).el;
  eq(all(c, '.est-suggest').map(txt), ['依目前預估，建議改成進階程度。改成進階']);
  const kids = c.children.map((n) => n.className);
  assert.equal(kids.indexOf('est-suggest'), kids.indexOf('est-row') + 1, '放在聽力那一列下面');
  const btn = all(c, '.est-suggest-go')[0];
  assert.ok(!/primary/.test(btn.className), '文字按鈕,不是實色');
  ctx.UI.confirmAnswer = false; ctx.UI.confirms.length = 0;
  btn.click(); await new Promise((r) => setTimeout(r, 0));
  eq([calls, ctx.UI.confirms.map((x) => [x.title, x.ok, x.cancel])], [[], [['改級別會換學習包。', '改級別', '取消']]]);
  ctx.UI.confirmAnswer = true;
  btn.click(); await new Promise((r) => setTimeout(r, 0));
  eq(calls, ['L:advanced']);
  const c2 = U.card({ view: v, suggest: [{ sec: 'R', level: 'high' }], hasCourse: false, onLevel }).el;
  ctx.UI.confirms.length = 0;
  all(c2, '.est-suggest-go')[0].click(); await new Promise((r) => setTimeout(r, 0));
  eq([calls, ctx.UI.confirms.length], [['L:advanced', 'R:high'], 0]);
  assert.equal(primaries(c).length + primaries(c2).length, 0);
  return 'ok';
};
T['卡片:用真的資料層算出來的 View 畫(只有刷題 24 題:閱讀有數字、聽力再做 12 題、主按鈕做聽力檢測)'] = () => {
  const fa = { v: 1, i: {} };
  Object.keys(P.b).filter((k) => /^p5-/.test(k)).slice(0, 16).forEach((k, i) => { fa.i[k] = [E.dayNum(NOW) - 1, i % 3 ? 1 : 0, 'p']; });
  Object.keys(P.b).filter((k) => /^p7-/.test(k)).slice(0, 8).forEach((k, i) => { fa.i[k] = [E.dayNum(NOW) - 1, i % 2, 'p']; });
  const v = S.peek({ store: K.fakeStore({ fa_v1: fa }), cloud: null, params: P, now: NOW, profile: CPID, canWrite: () => true });
  const c = U.card({ view: v }).el;
  eq([all(c, '.est-need').map(txt), primaries(c).map(txt), all(c, '.est-meta').map(txt)], [['再做 12 題聽力，就會顯示預估分數。'], ['做聽力檢測'], ['根據 24 題 · ' + U.dateText(AT)]]);
  return parts(all(c, '.est-row')[1]);
};

/* ---------- 結果頁 ---------- */
T['結果頁:有總分:小標預估總分、大字總分、兩科數字、兩科範圍一行、兩條刻度尺、建議程度、根據 N 題 · 本站估計;主按鈕只有呼叫端給的那一顆'] = () => {
  const v = view(sec(345, 275, 415, 12), sec(290, 220, 360, 12, { band: 'advanced' }), { est: 635, lo: 520, hi: 750 });
  const r = U.result({ view: v, primary: { label: '開始練習', href: 'practice.html' }, links: [{ label: '改級別', onClick() {} }, { label: '看作答', onClick() {} }] });
  const c = r.el;
  eq([txt(all(c, '.result-kicker')[0]), txt(all(c, '.result-score')[0]), all(c, '.result-stat').map(txt)], ['預估總分', '635', ['聽力345', '閱讀290']]);
  eq(all(c, '.est-ranges').map(txt), ['聽力 275–415　閱讀 220–360']);
  eq(all(c, '.est-scale-row').length, 2);
  eq(all(c, '.est-levels').map(txt), ['建議程度：聽力 進階／閱讀 進階']);
  eq(all(c, '.result-note').map(txt), ['根據 24 題 · 本站估計，不是正式成績。']);
  eq(primaries(c).map(txt), ['開始練習']);
  eq(all(c, '.est-entry').length, 0);
  return 'ok';
};
T['結果頁:只做一科:那一科有數字、另一科「再做 12 題閱讀」、沒有總分;入門多一行「從入門開始練習。」;兩端不寫範圍'] = () => {
  const v = view(sec(140, 90, 190, 12), need(20, 'any'));
  const c = U.result({ view: v, primary: { label: '下一步', href: 'start.html?step=result' } }).el;
  eq([txt(all(c, '.result-kicker')[0]), txt(all(c, '.result-score')[0]), all(c, '.result-stat').length], ['預估分數', '聽力 150 以下', 0]);
  eq(all(c, '.est-need').map(txt), ['再做 12 題閱讀，就會顯示預估分數。']);
  eq(all(c, '.est-ranges').length, 0);
  eq(all(c, '.est-levels').map(txt), ['建議程度：聽力 入門']);
  eq(all(c, '.est-entry').map(txt), ['從入門開始練習。']);
  eq(all(c, '.result-note').map(txt), ['根據 12 題 · 本站估計，不是正式成績。']);
  assert.equal(U.result({ view: { ok: false } }), null);
  return 'ok';
};

/* ---------- 用字 ---------- */
function strings(x, out) {
  if (typeof x === 'string') out.push(x);
  else if (typeof x === 'function') ['L', 'R'].forEach((s) => [1, 'advanced'].forEach((a) => { try { strings(x(s === 'L' ? a : s, a), out); } catch (e) { /* 參數不合的組合 */ } }));
  else if (x && typeof x === 'object') Object.keys(x).forEach((k) => strings(x[k], out));
  return out;
}
T['用字:不寫承諾分數的字(準確、進步、保證、分數區間、換算、官方、考到、會拿到)、全形標點、分數旁寫本站估計'] = () => {
  const list = strings(U.STR, []).concat([U.STR.need('L', 8), U.STR.needBig('R', 3), U.STR.basis(3, '11 月 25 日'), U.STR.basisNote(24), U.STR.levels(['聽力 進階', '閱讀 門檻'])]);
  const banned = /準確|進步|保證|分數區間|換算|官方|考到|會拿到/;
  eq(list.filter((s) => banned.test(s)), []);
  const half = /[一-鿿][,;:?!]|[,;:?!][一-鿿]/;
  eq(list.filter((s) => half.test(s)), []);
  assert.equal(U.STR.note, '本站估計，不是正式成績。');
  const src = K.read('js/estimate-ui.js').replace(/\/\*[\s\S]*?\*\//g, '');
  eq((src.match(/'[^'\n]*[一-鿿][^'\n]*'/g) || []).filter((s) => !/const STR|STR\./.test(s)).length > 0, true, '中文字串有在檔裡');
  const outside = src.slice(src.indexOf('const doc = ')).match(/'[^'\n]*[一-鿿][^'\n]*'/g) || [];
  eq(outside, [], '畫面上的字都在 STR(一處)');
  return list.length + ' 句';
};
T['樣式:新的樣式在 css/estimate.css,不往 css/style.css 加;共用畫面不讀寫儲存'] = () => {
  const css = K.read('css/estimate.css');
  assert.ok(/\.est-card\b/.test(css) && /\.est-row\b/.test(css));
  assert.ok(!/\.est-card\b/.test(K.read('css/style.css')));
  assert.ok(!/localStorage|store\.(get|set)|sessionStorage/.test(K.read('js/estimate-ui.js')));
  return 'ok';
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let detail = '', ok = true;
    try { detail = await T[name](); } catch (e) { ok = false; detail = (e && e.message ? e.message : String(e)).slice(0, 600); }
    if (ok) pass++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + detail : ''));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
