/* 預估分數的共用畫面(js/estimate-ui.js):預估分數卡各狀態的字與一顆實色主按鈕、建議改級的文字按鈕與確認、
   結果頁的分數區塊(有總分、只做一科、兩端、入門)、刻度尺、標題旁的 ⓘ 與資訊欄、字串用字(不承諾分數、全形標點)。
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
/* 畫面上不再有數字旁的聲明小字(本站估計、不是正式成績、根據 N 題):這些都在 ⓘ 的資訊欄裡 */
const NOTE = /本站估計|不是正式成績|根據 \d+ 題/;
const infoBtns = (n) => all(n, '.est-info');
const openInfo = (btn) => { ctx.UI.sheets.length = 0; btn.click(); return ctx.UI.sheets[0]; };
const EST_PARAS = ['這個分數是本站依你的作答估計的，不是多益的正式成績。', '每一題只算第一次作答。重做和錯題本的作答不算。',
  '範圍：如果現在去考多益，分數很可能在這個範圍內。做的題目越多，範圍會越窄。',
  '每一科要有 20 題第一次作答，才會顯示分數；做該科的程度檢測（12 題）也可以。'];
const basis = (n) => '目前用了 ' + n + ' 題來算，算到 ' + U.dateText(AT) + '的作答。';
const T = {};

/* ---------- 卡片 ---------- */
T['卡片:沒有資料(或算不出來)時只有標題和一顆主按鈕「做程度檢測」'] = () => {
  [view(need(20, 'any'), need(20, 'any')), { ok: false, L: null, R: null }, null].forEach((v, i) => {
    const c = U.card({ view: v }).el;
    eq([all(c, '.est-title').map(txt), primaries(c).map(txt), primaries(c)[0].getAttribute('href')], [['預估多益分數'], ['做程度檢測'], 'placement.html'], 'case ' + i);
    assert.equal(all(c, '.est-row').length, 0);
    assert.ok(!NOTE.test(txt(c)), txt(c));
    eq(infoBtns(c).length, 1, '標題旁一個 ⓘ');
  });
  return 'ok';
};
T['卡片:兩科都有數字:總分與範圍、兩科的數字刻度尺與範圍;根據 N 題與日期、本站估計移進標題旁 ⓘ 的資訊欄;沒有主按鈕'] = () => {
  const v = view(sec(345, 300, 390, 100), sec(290, 245, 335, 86), { est: 635, lo: 545, hi: 725 });
  const c = U.card({ view: v }).el;
  eq(txt(all(c, '.est-total')[0]), '635　範圍 545–725');
  eq(all(c, '.est-row').map(parts), ['聽力 345|300–390', '閱讀 290|245–335']);
  assert.ok(!NOTE.test(txt(c)), '畫面上沒有聲明小字:' + txt(c));
  const head = all(c, '.est-head')[0];
  eq([all(head, '.est-title').map(txt), infoBtns(head).map((b) => b.getAttribute('aria-label'))], [['預估多益分數'], ['預估分數說明']], 'ⓘ 在標題旁');
  const sh = openInfo(infoBtns(c)[0]);
  eq([sh.title, sh.paras], ['預估分數', EST_PARAS.concat([basis(186)])]);
  assert.equal(primaries(c).length, 0);
  assert.equal(all(c, '.bs-seg').length, 2);
  return U.dateText(AT);
};
T['卡片:只差聽力:聽力分數的位置寫「再做 20 題就有分數」(照實寫 20 − n,目的與題數一起寫)、要做的事只有一顆「做聽力檢測」連到 sec=L,旁邊不另外放「去練習」'] = () => {
  const v = view(need(20, 'any'), sec(290, 245, 335, 28));
  const c = U.card({ view: v }).el;
  eq(all(c, '.est-row.is-need .est-sec').map(txt), ['聽力 再做 20 題就有分數']);
  eq(all(c, '.est-row.is-need a').length, 0, '那一列沒有另一個連結,要做的事只有下面的檢測按鈕');
  eq(all(c, 'a').map((a) => [txt(a), a.getAttribute('href')]), [['做聽力檢測', 'placement.html?sec=L']], '整張卡只有一個去處');
  eq(all(U.card({ view: view(need(17, 'any'), sec(290, 245, 335, 28)) }).el, '.est-left').map(txt), ['再做 17 題就有分數'], '做了 3 題');
  const quiet = U.card({ view: v, solid: false }).el;
  eq([primaries(quiet).length, all(quiet, '.est-go').map((b) => [txt(b), b.className])], [0, [['做聽力檢測', 'btn est-go']]], '頁面上已經有實色主按鈕時:描邊按鈕');
  eq(primaries(c).map((b) => [txt(b), b.getAttribute('href')]), [['做聽力檢測', 'placement.html?sec=L']]);
  assert.equal(all(c, '.est-total').length, 0, '一科沒有數字就沒有總分');
  const r = U.card({ view: view(sec(345, 300, 390, 30), need(8, 'big')), testHref: 'placement.html?from=me' }).el;
  eq(all(r, '.est-row.is-need').map(txt), ['閱讀 再做 8 題就有分數']);
  eq(all(r, '.est-row.is-need a').length, 0, '那一列沒有連結');
  eq(primaries(r).map((b) => [txt(b), b.getAttribute('href')]), [['做閱讀檢測', 'placement.html?from=me&sec=R']]);
  eq(U.needText('L', { n: 5, kind: 'any' }), '再做 5 題就有分數');
  eq([U.needText('L', { n: 20, kind: 'any' }), U.needText('L', { n: 20, kind: 'any' }, { test: true })], ['再做 20 題就有分數', '再做 12 題就有分數'], '檢測結果頁指的是 12 題檢測');
  eq(U.needText('L', { n: 6, kind: 'big' }), '再做 6 題對話或獨白就有分數');
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
T['卡片:建議改級:那一科下面一顆文字按鈕「改成進階程度」(程度名稱不重複寫兩次);按了先確認(原因寫在確認視窗,有課程進度多說會換學習包),確認了才改'] = async () => {
  const v = view(sec(345, 300, 390, 100), sec(290, 245, 335, 86), { est: 635, lo: 545, hi: 725 });
  const calls = [];
  const onLevel = (s, l) => { calls.push(s + ':' + l); };
  const c = U.card({ view: v, suggest: [{ sec: 'L', level: 'advanced' }, { sec: 'R', level: 'nope' }], hasCourse: true, onLevel }).el;
  eq(all(c, '.est-suggest').map((n) => n.children.map(txt)), [['改成進階程度']]);
  const kids = c.children.map((n) => n.className);
  assert.equal(kids.indexOf('est-suggest'), kids.indexOf('est-row') + 1, '放在聽力那一列下面');
  const btn = all(c, '.est-suggest-go')[0];
  assert.ok(!/primary/.test(btn.className), '文字按鈕,不是實色');
  ctx.UI.confirmAnswer = false; ctx.UI.confirms.length = 0;
  btn.click(); await new Promise((r) => setTimeout(r, 0));
  eq([calls, ctx.UI.confirms.map((x) => [x.title, x.body, x.ok, x.cancel])], [[], [['聽力改成進階程度？',
    '依目前的預估分數，你的聽力比較接近進階程度。改了之後，學習包會換成進階程度的。', '改成進階程度', '先不要']]]);
  ctx.UI.confirmAnswer = true;
  btn.click(); await new Promise((r) => setTimeout(r, 0));
  eq(calls, ['L:advanced']);
  const c2 = U.card({ view: v, suggest: [{ sec: 'R', level: 'high' }], hasCourse: false, onLevel }).el;
  ctx.UI.confirms.length = 0;
  all(c2, '.est-suggest-go')[0].click(); await new Promise((r) => setTimeout(r, 0));
  eq([calls, ctx.UI.confirms.map((x) => [x.title, x.body])], [['L:advanced', 'R:high'], [['閱讀改成高分程度？', '依目前的預估分數，你的閱讀比較接近高分程度。']]],
    '沒有課程進度:一樣先確認(原因在視窗裡),不提學習包');
  assert.equal(primaries(c).length + primaries(c2).length, 0);
  return 'ok';
};
T['卡片:用真的資料層算出來的 View 畫(只有刷題 24 題:閱讀有數字、聽力再做 20 題、主按鈕做聽力檢測)'] = () => {
  const fa = { v: 1, i: {} };
  Object.keys(P.b).filter((k) => /^p5-/.test(k)).slice(0, 16).forEach((k, i) => { fa.i[k] = [E.dayNum(NOW) - 1, i % 3 ? 1 : 0, 'p']; });
  Object.keys(P.b).filter((k) => /^p7-/.test(k)).slice(0, 8).forEach((k, i) => { fa.i[k] = [E.dayNum(NOW) - 1, i % 2, 'p']; });
  const v = S.peek({ store: K.fakeStore({ fa_v1: fa }), cloud: null, params: P, now: NOW, profile: CPID, canWrite: () => true });
  const c = U.card({ view: v }).el;
  eq([all(c, '.est-left').map(txt), primaries(c).map(txt), openInfo(infoBtns(c)[0]).paras.slice(-1)], [['再做 20 題就有分數'], ['做聽力檢測'], [basis(24)]]);
  return parts(all(c, '.est-row')[1]);
};

/* ---------- 結果頁 ---------- */
T['結果頁:有總分:小標預估總分(旁邊 ⓘ)、大字總分、兩科數字、兩條刻度尺(範圍寫在尺的右邊,只寫一次)、建議程度;根據 N 題與本站估計在資訊欄;主按鈕只有呼叫端給的那一顆'] = () => {
  const v = view(sec(345, 275, 415, 12), sec(290, 220, 360, 12, { band: 'advanced' }), { est: 635, lo: 520, hi: 750 });
  const r = U.result({ view: v, primary: { label: '開始練習', href: 'practice.html' }, links: [{ label: '改級別', onClick() {} }, { label: '看作答', onClick() {} }] });
  const c = r.el;
  eq([txt(all(c, '.result-kicker')[0]), txt(all(c, '.result-score')[0]), all(c, '.result-stat').map(txt)], ['預估總分', '635', ['聽力345', '閱讀290']]);
  eq(all(c, '.result-kicker .est-info').length, 1, 'ⓘ 在小標旁');
  eq(all(c, '.est-ranges').length, 0, '不另外一行重複寫範圍');
  eq(all(c, '.est-scale-row').map((n) => [txt(all(n, '.est-sec')[0]), txt(all(n, '.est-range')[0])]), [['聽力', '範圍 275–415'], ['閱讀', '範圍 220–360']]);
  eq(all(c, '.est-levels').map(txt), ['建議程度：聽力 進階／閱讀 進階']);
  eq(all(c, '.result-note').length, 0);
  assert.ok(!NOTE.test(txt(c)), txt(c));
  eq(openInfo(all(c, '.est-info')[0]).paras.slice(-1), [basis(24)]);
  eq(primaries(c).map(txt), ['開始練習']);
  eq(all(c, '.est-entry').length, 0);
  return 'ok';
};
T['結果頁:只做一科:那一科有數字、另一科「閱讀　再做 12 題就有分數」、沒有總分;入門寫在建議程度(不另外加一行);兩端不寫範圍'] = () => {
  const v = view(sec(140, 90, 190, 12), need(20, 'any'));
  const c = U.result({ view: v, primary: { label: '下一步', href: 'start.html?step=result' } }).el;
  eq([txt(all(c, '.result-kicker')[0]), txt(all(c, '.result-score')[0]), all(c, '.result-stat').length], ['預估分數', '聽力 150 以下', 0]);
  eq(all(c, '.est-need').map(txt), ['閱讀　再做 12 題就有分數']);
  eq([all(c, '.est-ranges').length, all(c, '.est-range').map(txt)], [0, ['']], '兩端不寫範圍');
  eq(all(c, '.est-levels').map(txt), ['建議程度：聽力 入門']);
  eq(all(c, '.est-entry').length, 0);
  eq(all(c, '.result-note').length, 0);
  eq(openInfo(all(c, '.result-kicker .est-info')[0]).paras.slice(-1), [basis(12)]);
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
T['用字:不寫承諾分數的字(準確、進步、保證、分數區間、換算、官方、考到、會拿到)、全形標點;不是正式成績寫在資訊欄'] = () => {
  const list = strings(U.STR, []).concat([U.STR.need('L', 8), U.STR.needBig('R', 3), U.STR.info.est.basis(3, '11 月 25 日'), U.STR.levels(['聽力 進階', '閱讀 門檻']),
    U.STR.suggestBody('L', 'high', true)], U.STR.info.diag.paras(28));
  const banned = /準確|進步|保證|分數區間|換算|官方|考到|會拿到/;
  eq(list.filter((s) => banned.test(s)), []);
  const half = /[一-鿿][,;:?!]|[,;:?!][一-鿿]/;
  eq(list.filter((s) => half.test(s)), []);
  assert.ok(/不是多益的正式成績。$/.test(U.STR.info.est.paras[0]) && /不是多益的正式成績。$/.test(U.STR.info.mock.paras[0]), '資訊欄第一段寫明不是正式成績');
  const src = K.read('js/estimate-ui.js').replace(/\/\*[\s\S]*?\*\//g, '');
  eq((src.match(/'[^'\n]*[一-鿿][^'\n]*'/g) || []).filter((s) => !/const STR|STR\./.test(s)).length > 0, true, '中文字串有在檔裡');
  const outside = src.slice(src.indexOf('const doc = ')).match(/'[^'\n]*[一-鿿][^'\n]*'/g) || [];
  eq(outside, [], '畫面上的字都在 STR(一處)');
  return list.length + ' 句';
};
T['資訊欄:預估分數五段(有資料才有第五段:用了幾題、算到哪一天)、模擬考三段(能做什麼、不能做什麼分開寫);句子完整(句號結尾)、不寫準確進步保證官方換算分數區間'] = () => {
  eq(U.infoParas('est'), EST_PARAS, '沒有資料:四段');
  eq(U.infoParas('est', { ok: false }), EST_PARAS);
  eq(U.infoParas('est', { n: 0, at: AT }), EST_PARAS, '0 題:不寫第五段');
  eq(U.infoParas('est', { n: 31, at: AT }), EST_PARAS.concat([basis(31)]), '教師後台給 { n, at }');
  eq(U.infoParas('est', view(sec(345, 300, 390, 100), need(4, 'big'))).slice(-1), [basis(100)], '只算有數字的那一科');
  eq(U.infoParas('mock'), ['這個分數是本站依這次答對的題數估計的，不是多益的正式成績。', '每一次的題目不一樣，難度也會差一點，所以分數上下差 30 分左右是正常的。',
    '想知道分數有沒有提高，請比較好幾次的分數，不要只看一次。']);
  assert.ok(EST_PARAS[3].indexOf('20 題') > -1 && EST_PARAS[3].indexOf('12 題') > -1, '「再做 N 題就有分數」的規則寫在資訊欄');
  const paras = U.infoParas('est', { n: 31, at: AT }).concat(U.infoParas('mock'), U.infoParas('diag', { n: 28 }), U.infoParas('level', { from: 'score', old: true }));
  eq(paras.filter((p) => !/。$/.test(p)), [], '每段是完整的句子');
  eq(paras.filter((p) => /準確|進步|保證|官方|換算|分數區間/.test(p)), []);
  eq([U.STR.info.est.title, U.STR.info.mock.title], ['預估分數', '模擬考分數']);
  return paras.length + ' 段';
};
T['ⓘ 按鈕:button、aria-label、aria-haspopup;點了開資訊欄;模擬考用另一份;UI.sheet 沒載到不畫按鈕'] = () => {
  const b = U.infoButton({ kind: 'est', view: { n: 5, at: AT } });
  eq([b.tagName.toLowerCase(), b.getAttribute('type'), b.getAttribute('aria-label'), b.getAttribute('aria-haspopup'), b.className, txt(b)],
    ['button', 'button', '預估分數說明', 'dialog', 'est-info', ''], '只有圖示,沒有字(不用表情符號字元)');
  const sh = openInfo(b);
  eq([sh.title, sh.paras.length, ctx.document.activeElement === b], ['預估分數', 5, true], '點了先把焦點給按鈕(關了焦點回得來)');
  const m = U.infoButton({ kind: 'mock' });
  eq([m.getAttribute('aria-label'), openInfo(m).title], ['模擬考分數說明', '模擬考分數']);
  const card = ctx.UI.result({ kicker: '參考總分', big: '700' });
  U.addInfo(card.el, 'mock');
  eq(all(card.el, '.result-kicker .est-info').length, 1, '模擬考結果:小標旁');
  const sheet = ctx.UI.sheet;
  ctx.UI.sheet = undefined;
  try {
    eq([U.infoButton({ kind: 'est' }), infoBtns(U.card({ view: view(need(20, 'any'), need(20, 'any')) }).el).length], [null, 0]);
  } finally { ctx.UI.sheet = sheet; }
  return 'ok';
};
T['資訊欄:舊 28 題報告的預估級距(怎麼估的、為什麼放得寬)、新用戶設定的起始程度(依來源寫一句;沒有來源不畫 ⓘ);沒有小標時 ⓘ 放大標題旁'] = () => {
  eq(U.infoParas('diag', { n: 28 }), ['這個級距是本站依這次 28 題的答對題數估計的，不是多益的正式成績。', '題目只有 28 題，所以級距放得比較寬，只用來找起始程度。']);
  eq(U.infoParas('diag', { n: 30 })[1], '題目只有 30 題，所以級距放得比較寬，只用來找起始程度。', '題數照實寫');
  eq([U.infoParas('level', { from: 'est' }), U.infoParas('level', { from: 'score', old: true }).length, U.infoParas('level', { from: null, old: false })],
    [['這個程度是依你的程度檢測和之後的練習結果定的。'], 2, []]);
  assert.ok(/閱讀檢測/.test(U.infoParas('level', { from: 'legacy' })[0]) && /超過 2 年/.test(U.infoParas('level', { from: null, old: true })[0]));
  eq(U.infoParas('level', { from: 'calibrate' }), ['這個程度依第 2 到 4 堂第一次作答的答對率調整過。'], '第 4 堂後調整過');
  eq(U.infoButton({ kind: 'level', view: { from: null } }), null, '沒有段落就不畫按鈕');
  const d = ctx.UI.result({ kicker: '小安 · 2026-10-27', score: 20, total: 28, stats: [['預估級距', '600–750']] });
  const db = U.addInfo(d.el, 'diag', { n: 28 });
  eq([all(d.el, '.result-kicker .est-info').length, db.getAttribute('aria-label'), openInfo(db).title], [1, '預估級距說明', '預估級距']);
  const s = ctx.UI.result({ big: '你的起始程度', stats: [['聽力', '進階'], ['閱讀', '門檻']] });
  const sb = U.addInfo(s.el, 'level', { from: 'est' }, 'heading');
  eq([all(s.el, '.result-score .est-info').length, sb.getAttribute('aria-label'), openInfo(sb).paras], [1, '起始程度說明', ['這個程度是依你的程度檢測和之後的練習結果定的。']]);
  const n = ctx.UI.result({ big: '700' });
  const nb = U.addInfo(n.el, 'mock');
  eq([!!nb, all(n.el, '.result-score .est-info').length], [true, 1], '沒有小標:放在大標題旁');
  return 'ok';
};
T['樣式:新的樣式在 css/estimate.css,不往 css/style.css 加;共用畫面不讀寫儲存'] = () => {
  const css = K.read('css/estimate.css');
  assert.ok(/\.est-card\b/.test(css) && /\.est-row\b/.test(css));
  /* ⓘ:看得到的圖示約 22px,觸控範圍 44px */
  const info = (/\.est-info \{([^}]*)\}/.exec(css) || [])[1] || '';
  assert.ok(/width: 44px/.test(info) && /height: 44px/.test(info), info);
  assert.ok(/'width', '22'/.test(K.read('js/estimate-ui.js')));
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
