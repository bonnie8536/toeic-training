/* 模擬考的分數(js/mock.js 的 MOCK_SCORE.scaled):跟預估分數同一份曲線(data/item-params.js)、同一個函式(ESTIMATE.scoreOf)。
   聽力照站上的表(表上的點分數不變,點與點之間直線內插),閱讀照中間值;取到 5 的倍數;沒載題目參數時照舊表往下取。
   node + vm,不開瀏覽器。用法:node tools/test_mock_score.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8').replace(/\r\n/g, '\n');

/* 頁面程式在沒有題庫時就停(只畫「題庫準備中」),分數的那一段照樣定義 */
function load(files) {
  const ctx = { console };
  ctx.window = ctx;
  ctx.$ = () => ({ append() {} });
  ctx.h = () => ({});
  ctx.UI = { empty: () => ({}) };
  vm.createContext(ctx);
  files.concat(['js/mock.js']).forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  return ctx;
}
const FULL = load(['js/estimate-core.js', 'js/estimate-data.js', 'data/item-params.js']);
const S = FULL.MOCK_SCORE.scaled, E = FULL.ESTIMATE, CURVE = FULL.ITEM_PARAMS.curve;
const OLD = JSON.parse(/const CONV = (\[[\s\S]*?\]\]);/.exec(read('js/mock.js'))[1]);
const oldStep = (pct) => OLD.find(([t]) => pct >= t)[1];

const T = {};

T['聽力:表上每一點的分數跟改版前一樣;點與點之間直線內插再取 5 的倍數'] = () => {
  OLD.forEach(([t, s]) => assert.strictEqual(S(t, 'L'), s, '答對率 ' + t));
  assert.deepStrictEqual([0.62, 0.2, 0.525, 0.9, 0.99].map((p) => S(p, 'L')), [300, 70, 245, 460, 495]);
  assert.deepStrictEqual([0.62, 0.2, 0.525].map(oldStep), [290, 55, 230], '改版前是往下取');
};

T['閱讀:用中間值(同一答對率比聽力低);幾個答對率的分數'] = () => {
  const got = [0, 0.3, 0.5, 0.62, 0.65, 0.8, 0.9, 1].map((p) => S(p, 'R'));
  assert.deepStrictEqual(got, [5, 105, 220, 285, 300, 395, 450, 495]);
  [0.5, 0.65, 0.8].forEach((p) => assert.ok(S(p, 'R') < S(p, 'L'), '答對率 ' + p));
};

T['跟預估分數同一個函式:每 1% 的答對率都等於 ESTIMATE.scoreOf(同一條曲線) 取到 5 的倍數;都在 5–495、是 5 的倍數、單調'] = () => {
  ['L', 'R'].forEach((sec) => {
    let prev = 0;
    for (let i = 0; i <= 100; i++) {
      const p = i / 100, v = S(p, sec);
      assert.strictEqual(v, Math.round(E.scoreOf(CURVE[sec], p) / 5) * 5, sec + ' ' + p);
      assert.ok(v >= 5 && v <= 495 && v % 5 === 0 && v >= prev, sec + ' ' + p + ' → ' + v);
      prev = v;
    }
  });
  assert.ok(/MOCK_SCORE\.scaled\([^)]*'L'\)/.test(read('js/mock.js')) && /MOCK_SCORE\.scaled\([^)]*'R'\)/.test(read('js/mock.js')), '交卷時兩科各用自己的曲線');
};

T['沒載題目參數或估分程式:兩科都照改版前的表往下取,不丟錯'] = () => {
  const bare = load([]).MOCK_SCORE.scaled, noParams = load(['js/estimate-core.js', 'js/estimate-data.js']).MOCK_SCORE.scaled;
  [0, 0.14, 0.62, 0.65, 0.8, 0.97, 1].forEach((p) => {
    ['L', 'R'].forEach((sec) => {
      assert.strictEqual(bare(p, sec), oldStep(p), 'bare ' + sec + ' ' + p);
      assert.strictEqual(noParams(p, sec), oldStep(p), 'noParams ' + sec + ' ' + p);
    });
  });
};

T['模擬考頁:題目參數在估分程式之後、js/mock.js 之前載入;結果寫明是本站估計;歷次紀錄照當時存的分數顯示'] = () => {
  const html = read('mock.html'), at = (s) => html.indexOf('<script src="' + s + '"></script>');
  assert.ok(at('js/estimate-core.js') > -1 && at('js/estimate-data.js') < at('data/item-params.js') && at('data/item-params.js') < at('js/mock.js'));
  const src = read('js/mock.js');
  assert.ok(src.includes("note: '本站估計，不是正式成績。'"));
  assert.ok(src.includes("r.lRaw + ' / ' + r.lTotal + ' · ' + r.lScore") && src.includes('r.lScore + r.rScore'), '歷次紀錄用存的 lScore、rScore');
  assert.ok(!/官方|準確|保證|進步/.test(src));
};

let pass = 0, fail = 0;
Object.keys(T).forEach((name) => {
  try { T[name](); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n  ' + (e && e.message)); }
});
console.log('\n' + pass + ' 通過,' + fail + ' 失敗');
process.exit(fail ? 1 : 0);
