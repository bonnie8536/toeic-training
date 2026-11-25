/* data/item-params.js(題目難度參數)的檢查:
   每個題庫小題都有難度、難度在 −3 到 +3、舊 28 題都在、沒有多出的 id、key 全部由 keyOf 產生且跟練習頁、聽力頁、課程的寫法一致、
   淘汰的題不在、兩條換算曲線單調且兩端是 5 與 495、參考卷每個 Part 20 個數;難度的算法、參考卷分位數、檔案只放 id 與數字、輸出固定。
   用法:node tools/test_item_params.js [--ratings <難度評分結果.json>]
     給了評分結果時,另外用工具重產兩次(一次沿用參考卷、一次重算),確認跟 repo 裡的檔逐位元組相同。 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { execFileSync } = require('child_process');
const B = require('./build-item-params.js');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'data/item-params.js');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ctx = B.loadContext();
const E = ctx.ESTIMATE;
const bank = B.bankUnits(ctx);
const legacy = B.legacyUnits(ctx);
const P = B.loadParamsFile(FILE);
const clone = (x) => JSON.parse(JSON.stringify(x));
const T = {};

T['工具的檢查全過(每題有難度、範圍、舊 28 題、沒有多的 key、淘汰題、曲線、參考卷)'] = () => {
  assert.deepStrictEqual(B.check(P, ctx, bank, legacy), []);
  const n = bank.reduce((a, u) => a + u.keys.length, 0);
  assert.strictEqual(Object.keys(P.b).length, n + 28);
  return n + ' 題庫小題 + 舊 28 題';
};

T['檢查抓得到:缺題、多題、超出範圍、淘汰題、參考卷不是 20 個、曲線不單調或兩端不對'] = () => {
  const bad = (f, re) => {
    const Q = clone(P); f(Q);
    const got = B.check(Q, ctx, bank, legacy);
    assert.ok(got.some((m) => re.test(m)), '應該不過:' + re + ',得到 ' + JSON.stringify(got));
  };
  bad((Q) => { delete Q.b['p5-b1-01']; }, /沒有難度/);
  bad((Q) => { delete Q.b['d5-01']; }, /舊 28 題/);
  bad((Q) => { Q.b['p5-zz-99'] = 0; }, /多出/);
  bad((Q) => { Q.b['p5-b1-01'] = 3.2; }, /−3 到 \+3/);
  const dead = JSON.parse(read('data/retired.json')).retired[0].id;
  bad((Q) => { Q.b[dead] = 0; }, /淘汰/);
  bad((Q) => { Q.ref['7m'] = Q.ref['7m'].slice(1); }, /20 個數/);
  bad((Q) => { delete Q.ref['7s']; }, /Part/);
  bad((Q) => { Q.curve.L[5][1] = Q.curve.L[4][1]; }, /一直變大/);
  bad((Q) => { Q.curve.R[Q.curve.R.length - 1][1] = 490; }, /495/);
  bad((Q) => { Q.curve.L[0][1] = 10; }, /\[0, 5\]/);
};

/* 練習頁、聽力頁、課程頁的寫法照原檔抄;另外確認原檔還是這樣寫 */
T['key 對上練習頁、聽力頁與課程:題組 num 或 0 起算位置;P1、P2、P5 是題目 id、不帶 :0;課程 1 起算的小題號換得回來'] = () => {
  const practice = read('js/practice.js'), listening = read('js/listening.js');
  assert.ok(practice.includes("function qid(set, q, qi) { return set.id + ':' + (q.num !== undefined ? q.num : qi); }"), '刷題頁的 key 寫法變了');
  assert.ok(practice.includes("keyOf = (u, q, qi) => (u.p === '5' ? q.id : qid(u.item, q, qi))"), '刷題頁 P5 的 key 寫法變了');
  assert.ok(listening.includes("const qid = (set, qi) => set.id + ':' + qi;"), '聽力頁題組的 key 寫法變了');
  ["saveRec('1', q.id,", "saveRec('2', q.id,", 'saveRec(u.p, u.item.id,'].forEach((s) => assert.ok(listening.includes(s), '聽力頁單題的 key 寫法變了:' + s));
  vm.runInContext(read('js/lesson-core.js'), ctx, { filename: 'js/lesson-core.js' });
  const LC = ctx.LESSON_CORE, sets = { 1: ctx.TOEIC.listening.p1, 2: ctx.TOEIC.listening.p2, 3: ctx.TOEIC.listening.p3, 4: ctx.TOEIC.listening.p4, 5: ctx.TOEIC.part5, 6: ctx.TOEIC.part6, 7: ctx.TOEIC.part7 };
  let n = 0;
  Object.keys(sets).forEach((p) => sets[p].forEach((x) => {
    if (!E.isGroupPart(p)) { assert.strictEqual(E.keyOf(p, x.id, x, 0), x.id); assert.ok(x.id in P.b, x.id); n++; return; }
    x.questions.forEach((q, qi) => {
      const k = E.keyOf(p, x.id, q, qi);
      const page = p === '3' || p === '4' ? x.id + ':' + qi : x.id + ':' + (q.num !== undefined ? q.num : qi);
      const sub = q.num !== undefined ? q.num : qi + 1;
      assert.strictEqual(k, page, '頁面寫法 ' + k);
      assert.strictEqual(E.keyFromSub(p, x.id, sub), k, '課程小題號 ' + k);
      assert.strictEqual(LC.itemKeys(p, x, x.id)[qi].key, k, '課程 key ' + k);
      assert.strictEqual(E.partOfKey(k), p, 'Part ' + k);
      assert.ok(k in P.b, k); n++;
    });
  }));
  return n + ' 小題';
};

T['難度的算法:P1–P5 與舊 28 題是標籤加 Part 值;P6、P7 是 Part 值加評分級數換算(級數 1–8)'] = () => {
  const slope = 0.712 / 1.137, m = 3.96;
  const levels = {};
  bank.concat(legacy).forEach((u) => u.keys.forEach(({ key }) => {
    const b = P.b[key];
    if (u.label !== undefined) { assert.strictEqual(b, Math.round((B.LABEL[u.label] + B.PART[u.pk]) * 1000) / 1000, key); return; }
    const lv = (b - B.PART[u.pk]) / slope + m;
    assert.ok(Math.abs(lv - Math.round(lv)) < 0.003 && lv > 0.99 && lv < 8.01, key + ' 換回級數 ' + lv);
    levels[Math.round(lv)] = (levels[Math.round(lv)] || 0) + 1;
  }));
  return 'P6、P7 級數分布 ' + JSON.stringify(levels);
};

T['參考卷:ip1 是該 Part 題庫小題難度的 20 個分位數,由小到大'] = () => {
  assert.strictEqual(P.ip, 'ip1');
  const by = {};
  bank.forEach((u) => u.keys.forEach(({ key }) => { (by[u.pk] = by[u.pk] || []).push(P.b[key]); }));
  B.PART_KEYS.forEach((pk) => assert.deepStrictEqual(P.ref[pk], B.quantiles(by[pk], 20), pk));
  assert.deepStrictEqual(B.quantiles([1, 2, 3, 4], 4), [1, 2, 3, 4]);
  assert.deepStrictEqual(B.quantiles([0, 10], 4), [0, 2.5, 7.5, 10]);
  assert.deepStrictEqual(B.quantiles([0, 10], 2), [0, 10]);
  assert.deepStrictEqual(B.quantiles([0, 1, 2], 2), [0.25, 1.75]);
};

/* 公開來源的閱讀換算點(答對率對分數),跟站上表在兩邊節點的聯集上取平均、四捨五入 */
const PUBLIC_R = [[0, 5], [0.2, 5], [0.3, 100], [0.5, 210], [0.65, 280], [0.8, 375], [0.9, 435], [0.97, 485], [1, 495]];
T['換算曲線:聽力是模擬考的表;閱讀是站上表與公開來源的中間值;兩條單調、兩端 5 與 495、直線內插'] = () => {
  const m = /const CONV = (\[[\s\S]*?\]\]);/.exec(read('js/mock.js'));
  assert.ok(m, '找不到模擬考的換算表');
  const conv = JSON.parse(m[1]).slice().reverse();
  assert.deepStrictEqual(P.curve.L, conv, '聽力曲線對上模擬考的表');
  const site = conv.concat([[1, 495]]);
  const xs = [...new Set(site.map((p) => p[0]).concat(PUBLIC_R.map((p) => p[0])))].sort((a, b) => a - b);
  assert.deepStrictEqual(P.curve.R, xs.map((x) => [x, Math.round((E.scoreOf(site, x) + E.scoreOf(PUBLIC_R, x)) / 2)]), '閱讀曲線是中間值');
  ['L', 'R'].forEach((s) => {
    const c = P.curve[s];
    assert.deepStrictEqual(c[0], [0, 5]);
    assert.strictEqual(E.scoreOf(c, 1), 495);
    for (let i = 1; i < c.length; i++) assert.ok(c[i][0] > c[i - 1][0] && c[i][1] > c[i - 1][1], s + ' 第 ' + i + ' 點');
  });
  assert.strictEqual(E.scoreOf(P.curve.R, 0.625), 286.5);
  assert.strictEqual(E.scoreOf(P.curve.L, 0.2), 70);
};

T['檔案:只放 id 與數字、不出現內部用語與 repo 外路徑、≤800 行、照工具的格式輸出(重新輸出逐位元組相同)'] = () => {
  /* Windows 取出時換行可能被換成 CRLF，比對前換回 LF */
  const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
  assert.ok(src.split('\n').length <= 800);
  assert.strictEqual(B.serialize(P), src, '照工具的格式');
  const body = src.replace(/^\/\*[\s\S]*?\*\/\n/, '');
  assert.ok(!/\/\*|\/\//.test(body), '註解只在檔頭');
  (body.match(/"[^"]*"/g) || []).forEach((s) => assert.ok(/^"(ip1|c1|curve|ref|part|b|[LR]|7[sm]|[1-6]|[a-z0-9:-]+)"$/.test(s), '只放 id 與數字:' + s));
  const INTERNAL = /\u7ad9\u9577|\u7db2\u7ad9\u4e3b\u4eba|\u898f\u683c|\u6846\u67b6|\u5be9\u67e5|\u6311\u932f|\u65b9\u6848|\u6a21\u64ec\u5831\u544a|\u5de5\u4f5c\u5305|\u4ee3\u7406|\u8a55\u5206\u8005|AI ?\u8a55|\x47PT|\b[A-Z]:[\\/]|Users[\\/]|\u00a7|@[a-z0-9-]+\.[a-z]/g;
  ['data/item-params.js', 'tools/build-item-params.js', 'tools/test_item_params.js'].forEach((f) => {
    assert.deepStrictEqual(read(f).match(INTERNAL) || [], [], f);
    assert.ok(read(f).split('\n').length <= 800, f);
  });
  assert.ok(Buffer.byteLength(src) < 40000, '檔案大小 ' + Buffer.byteLength(src));
  return Buffer.byteLength(src) + ' bytes';
};

T['工具只檢查時:現有檔全過、exit 0;壞的檔 exit 1'] = () => {
  const node = process.execPath, tool = path.join(__dirname, 'build-item-params.js');
  assert.ok(/檢查全過/.test(execFileSync(node, [tool], { encoding: 'utf8' })));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-test-'));
  try {
    const f = path.join(dir, 'bad.js');
    fs.writeFileSync(f, fs.readFileSync(FILE, 'utf8').replace('"l1-01": -1.3', '"l1-01": -9'));
    let code = 0;
    try { execFileSync(node, [tool, '--file', f], { encoding: 'utf8' }); } catch (e) { code = e.status; }
    assert.strictEqual(code, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

const ri = process.argv.indexOf('--ratings');
const RATINGS = ri > -1 ? process.argv[ri + 1] : null;
T['給評分結果時:重產兩次都跟 repo 裡的檔逐位元組相同(沿用參考卷、重算參考卷)'] = () => {
  if (!RATINGS) return '沒給 --ratings,略過';
  const node = process.execPath, tool = path.join(__dirname, 'build-item-params.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-build-'));
  try {
    const out = path.join(dir, 'item-params.js');
    const first = execFileSync(node, [tool, '--ratings', RATINGS, '--out', out], { encoding: 'utf8' });
    assert.ok(/重算/.test(first));
    const a = fs.readFileSync(out);
    const second = execFileSync(node, [tool, '--ratings', RATINGS, '--out', out], { encoding: 'utf8' });
    assert.ok(/沿用/.test(second));
    assert.ok(a.equals(fs.readFileSync(out)), '兩次輸出相同');
    assert.strictEqual(a.toString('utf8'), fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n'), '跟 repo 裡的檔相同(換行換回 LF 比)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return '兩次相同';
};

let pass = 0, fail = 0;
Object.keys(T).forEach((name) => {
  try { const d = T[name](); pass++; process.stdout.write('PASS ' + name + (d ? '  (' + d + ')' : '') + '\n'); }
  catch (e) { fail++; process.stdout.write('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e) + '\n'); }
});
process.stdout.write('\n' + pass + ' 通過,' + fail + ' 失敗\n');
process.exit(fail ? 1 : 0);
