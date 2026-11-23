/* 技巧卡:data/raw/tip_cards.json → tools/tips_build.py(由 tools/merge_data.py 呼叫)→ data/tips.js(window.TIP_CARDS)。
   檢查:資料檔跟來源一致、每一層都凍結;產生時的每條檢查都抓得到壞資料(各放一筆);合併遇到壞的技巧卡整個停下、不寫檔;
   內文與示例說明用全形標點、沒有承諾效果或口語客套的字;第 1–8 堂與測驗檢討會配的卡都在。
   要跑 Python 的項目先看環境變數 PYTHON,再試 python3、python、py;都沒有就跳過那幾項(印出原因,結尾列出略過幾項)。
   不連網、不改 repo 的檔案(暫存資料夾在系統 temp,跑完刪掉)。用法:node tools/test_tips.js */
'use strict';
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const copy = (x) => JSON.parse(JSON.stringify(x));
const lf = (s) => s.replace(/\r\n/g, '\n');
const RAW = JSON.parse(read('data/raw/tip_cards.json'));
const CARD_KEYS = ['id', 'part', 'title', 'body', 'example', 'source'];
const KIND_OF = { P1: 'photo', P2: 'script', P3: 'script', P4: 'script', P5: 'sentence', P6: 'sentence', P7: 'sentence' };
const HAN = /[㐀-鿿豈-﫿]/;
const T = {};

function loadTips() {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('data/tips.js'), ctx, { filename: 'data/tips.js' });
  return ctx.TIP_CARDS;
}

function findPython() {
  for (const c of [process.env.PYTHON, 'python3', 'python', 'py'].filter(Boolean)) {
    const r = spawnSync(c, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && String(r.stdout).trim() === '3') return c;
  }
  return null;
}
const PY = findPython();
const SKIPPED = [];
const runPy = (args, env) => {
  const r = spawnSync(PY, args, { cwd: REPO, encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }, env || {}) });
  return { code: r.status, out: String(r.stdout) + String(r.stderr) };
};
/* 在暫存資料夾跑 f(dir),跑完刪掉 */
function inTmp(f) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tips-test-'));
  try { return f(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const needPy = (name) => { if (PY) return false; SKIPPED.push(name); return true; };

/* 中文旁邊的半形標點:, ; : ? ! . 前一個非空白字是漢字;括號裡有漢字卻用半形括號 */
function halfWidthNearHan(s) {
  const bad = [];
  for (let i = 0; i < s.length; i++) {
    if (',;:?!.'.indexOf(s[i]) > -1 && HAN.test(s.slice(0, i).trimEnd().slice(-1))) bad.push(s.slice(Math.max(0, i - 4), i + 1));
  }
  (s.match(/\([^()]*\)/g) || []).filter((m) => HAN.test(m)).forEach((m) => bad.push(m));
  return bad;
}
const BANNED = ['保證', '一定答對', '提分', '馬上', '輕鬆', '秘訣', '祕訣', '掌握', '關鍵在於', '讓我們', '你知道嗎', '！', '!', '？', '——'];
const PROMISE = /(?<!不)一定(會|能|可以)|不是.{0,30}而是/;   // 「不一定會」是在說不確定,不算承諾

T['T1 data/tips.js 跟來源一致:window.TIP_CARDS = { v: 1, cards },每一層都凍結;每張卡只有規定的欄位'] = () => {
  const tips = loadTips();
  assert.ok(Object.isFrozen(tips) && Object.isFrozen(tips.cards));
  tips.cards.forEach((c) => assert.ok(Object.isFrozen(c) && Object.isFrozen(c.example), c.id));
  assert.deepStrictEqual(copy(tips), RAW);
  tips.cards.forEach((c) => {
    assert.deepStrictEqual(Object.keys(c), CARD_KEYS, c.id);
    assert.ok(Object.keys(c.example).every((k) => ['en', 'zh', 'kind'].indexOf(k) > -1), c.id);
  });
  return tips.cards.length + ' 張';
};

T['T2 tools/tips_build.py 重產的 tips.js 跟 data/tips.js 內容相同(換行不算);來源檢查通過'] = () => {
  if (needPy('T2')) return 'SKIP';
  return inTmp((dir) => {
    const r = runPy([path.join('tools', 'tips_build.py'), '--out', dir]);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /技巧卡 \d+ 張，檢查通過/);
    assert.strictEqual(lf(fs.readFileSync(path.join(dir, 'tips.js'), 'utf8')), lf(read('data/tips.js')));
    return 'ok';
  });
};

/* 每種壞資料:[名稱, 改法, 要印出的錯誤] */
const BAD = [
  ['id 的 Part 不在 1–7', (d) => { d.cards[0].id = 'tip-P8-photo'; }, /第 1 張 tip-P8-photo：id .*格式/],
  ['id 有大寫', (d) => { d.cards[1].id = 'tip-P2-WH'; }, /第 2 張 tip-P2-WH：id .*格式/],
  ['part 跟 id 不一致', (d) => { d.cards[0].part = 'P2'; }, /第 1 張 tip-P1-photo：part 要是 P1/],
  ['id 重複', (d) => { d.cards[2].id = d.cards[1].id; d.cards[2].part = d.cards[1].part; }, /第 3 張 tip-P2-wh：id tip-P2-wh 重複/],
  ['body 超過 150 字', (d) => { d.cards[3].body = '字'.repeat(151); }, /第 4 張 tip-P3-gist：body 151 字，上限 150 字/],
  ['title 超過 16 字', (d) => { d.cards[4].title = '標'.repeat(17); }, /第 5 張 [^：]+：title 17 字，上限 16 字/],
  ['example.en 是空的', (d) => { d.cards[5].example.en = '  '; }, /第 6 張 [^：]+：example\.en 不能空/],
  ['example.zh 超過 40 字', (d) => { d.cards[6].example.zh = '說'.repeat(41); }, /第 7 張 [^：]+：example\.zh 41 字，上限 40 字/],
  ['照片卡沒寫照片情境', (d) => { delete d.cards[0].example.zh; }, /第 1 張 tip-P1-photo：example\.zh（照片卡要寫照片情境）/],
  ['example.kind 不認得', (d) => { d.cards[7].example.kind = 'audio'; }, /第 8 張 [^：]+：example\.kind/],
  ['source 不是 original', (d) => { d.cards[8].source = 'book'; }, /第 9 張 [^：]+：source 要是 original/],
  ['多了欄位', (d) => { d.cards[9].note = 'x'; }, /第 10 張 [^：]+：多了欄位 note/],
  ['少了欄位', (d) => { delete d.cards[10].body; }, /第 11 張 [^：]+：少了欄位 body/],
  ['頂層格式不對', (d) => { d.v = 2; }, /格式要是/],
];

T['T3 產生時的檢查:每種壞資料各一筆都擋下(exit 1),印出哪一張、哪一欄,只有那一個錯'] = () => {
  if (needPy('T3')) return 'SKIP';
  assert.ok(RAW.cards.length >= 11, '壞資料的例子要用到第 11 張');
  return inTmp((dir) => {
    const f = path.join(dir, 'tip_cards.json');
    BAD.forEach(([name, edit, re]) => {
      const d = copy(RAW);
      edit(d);
      fs.writeFileSync(f, JSON.stringify(d, null, 2));
      const r = runPy([path.join('tools', 'tips_build.py'), f]);
      assert.strictEqual(r.code, 1, name + '：' + r.out);
      assert.match(r.out, re, name);
      assert.strictEqual((r.out.match(/\[E\]/g) || []).length, 1, name + '：' + r.out);
    });
    fs.writeFileSync(f, '{ 壞掉的 JSON');
    const broken = runPy([path.join('tools', 'tips_build.py'), f]);
    assert.ok(broken.code === 1 && /讀不懂/.test(broken.out), broken.out);
    return (BAD.length + 1) + ' 種';
  });
};

T['T4 tools/merge_data.py 遇到壞的技巧卡:exit 1、印出哪一張哪一欄、一個檔都不寫'] = () => {
  if (needPy('T4')) return 'SKIP';
  return inTmp((dir) => {
    const out = path.join(dir, 'out');
    fs.mkdirSync(out);
    const bad = copy(RAW);
    bad.cards[3].body = '字'.repeat(151);
    fs.writeFileSync(path.join(dir, 'tip_cards.json'), JSON.stringify(bad));
    const r = runPy([path.join('tools', 'merge_data.py')], { MERGE_OUT_DIR: out, MERGE_TIPS: path.join(dir, 'tip_cards.json') });
    assert.strictEqual(r.code, 1, r.out.slice(-500));
    assert.match(r.out, /技巧卡 tip_cards\.json 第 4 張 tip-P3-gist：body 151 字/);
    assert.deepStrictEqual(fs.readdirSync(out), []);
    return 'ok';
  });
};

T['T5 文字:中文用全形標點、逗號少;沒有承諾效果或口語客套的字、驚嘆號、問號、破折號、表情符號;示例英文沒有中文;示例種類跟 Part 對得上;都標原創'] = () => {
  RAW.cards.forEach((c) => {
    const zh = [c.title, c.body, c.example.zh || ''];
    zh.forEach((s) => {
      assert.deepStrictEqual(halfWidthNearHan(s), [], c.id + ' 有半形標點：' + s);
      BANNED.forEach((w) => assert.ok(s.indexOf(w) < 0, c.id + ' 有「' + w + '」'));
      assert.ok(!PROMISE.test(s) && !/\p{Extended_Pictographic}/u.test(s), c.id + '：' + s);
    });
    assert.ok((c.body.match(/，/g) || []).length <= 6, c.id + ' 內文逗號太多');
    assert.ok(!HAN.test(c.example.en), c.id + ' 示例英文有中文');
    assert.strictEqual(c.example.kind, KIND_OF[c.part], c.id + ' 示例種類');
    if (/^P[56]$/.test(c.part)) assert.ok(c.example.en.indexOf('-------') > -1, c.id + ' 填空示例要有 ------- 空格');
    assert.strictEqual(c.source, 'original', c.id);
  });
  return RAW.cards.length + ' 張';
};

T['T6 第 1–8 堂技巧卡區塊引用的卡、測驗檢討會配的卡(js/lesson-rules.js)都在 data/tips.js'] = () => {
  const have = new Set(loadTips().cards.map((c) => c.id));
  const data = require('./check_packs.js').loadData();
  const used = new Set(data.reviewTips);
  ['entry', 'threshold'].forEach((lv) => JSON.parse(read('data/packs/pack_' + lv + '.json')).lessons.slice(0, 8).forEach((l) => l.segments
    .forEach((s) => (s.blocks || []).filter((b) => b.module === 'tip_cards').forEach((b) => b.ids.forEach((x) => used.add(x.id))))));
  const missing = [...used].filter((id) => !have.has(id));
  assert.deepStrictEqual(missing, []);
  assert.strictEqual(data.reviewTips.length, 7);
  return used.size + ' 張';
};

(async () => {
  let pass = 0, run = 0;
  for (const name of Object.keys(T)) {
    let detail = '', ok = true;
    try { detail = await T[name](); } catch (e) { ok = false; detail = e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e); }
    if (detail === 'SKIP') { console.log('SKIP ' + name + '  →  找不到 Python 3(設 PYTHON=python 執行檔路徑可以跑)'); continue; }
    run++;
    if (ok) pass++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + String(detail).slice(0, 400) : ''));
  }
  console.log(pass + ' / ' + run + ' 通過' + (SKIPPED.length ? '(略過 ' + SKIPPED.join('、') + ')' : ''));
  process.exit(pass === run ? 0 : 1);
})();
