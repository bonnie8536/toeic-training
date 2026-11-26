/* 技巧卡:data/raw/tip_cards.json → tools/tips_build.py(由 tools/merge_data.py 呼叫)→ data/tips.js(window.TIP_CARDS)。
   檢查:資料檔跟來源一致、每一層都凍結;產生時的每條檢查都抓得到壞資料(各放一筆,含示例的排法);合併遇到壞的技巧卡整個停下、不寫檔;
   合併找不到來源時,指定的來源不在或留著舊的 tips.js 算錯誤;內文與示例說明用全形標點、沒有承諾效果或口語客套的字;
   第 1–8 堂與測驗檢討會配的卡都在;check_packs 收集測驗檢討的卡少了或多了會丟錯。
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
/* 圈出、畫線、做記號:正式考試不准在題本上畫記,技巧卡不教這種作答習慣 */
const BANNED = ['保證', '一定答對', '提分', '馬上', '輕鬆', '秘訣', '祕訣', '掌握', '關鍵在於', '讓我們', '你知道嗎', '！', '!', '？', '——',
  '圈出', '圈起', '畫線', '劃線', '畫底線', '做記號'];
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
  ['版本號是 true', (d) => { d.v = true; }, /格式要是/],
  ['示例種類跟 Part 對不上', (d) => { d.cards[4].example.kind = 'sentence'; }, /第 5 張 tip-P3-speaker_place：example\.kind 在 P3 要是 script/],
  ['P3 示例沒有 Question: 那一行', (d) => { d.cards[3].example.en = d.cards[3].example.en.replace('Question: ', ''); }, /第 4 張 tip-P3-gist：example\.en 要先寫聽到的內容/],
  ['P4 示例的 Question: 在第一行', (d) => { d.cards[5].example.en = 'Question: Why is the speaker calling?\n(A) To change a time\n(B) To ask for directions'; }, /第 6 張 tip-P4-gist：example\.en 要先寫聽到的內容/],
  ['P2 示例第一行是選項', (d) => { d.cards[1].example.en = '(A) In the main hall.\n(B) Ms. Chen.\n(C) Yes.'; }, /第 2 張 tip-P2-wh：example\.en 第一行是問句/],
  ['照片卡的描述不是 (A) 開頭', (d) => { d.cards[0].example.en = 'A man is typing.'; }, /第 1 張 tip-P1-photo：example\.en 照片卡每一行/],
  ['照片卡的說明沒先寫照片情境', (d) => { d.cards[0].example.zh = '選 A，B 的動作不對。'; }, /第 1 張 tip-P1-photo：example\.zh 第一句要寫照片情境/],
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

T['T5 tools/merge_data.py 找不到技巧卡來源:MERGE_TIPS 指定的檔不在、或輸出資料夾還留著舊的 tips.js 算錯誤(不寫檔);兩者都不是只提醒'] = () => {
  if (needPy('T5')) return 'SKIP';
  return inTmp((dir) => {
    const out = path.join(dir, 'out'), raw = path.join(dir, 'raw');
    fs.mkdirSync(out);
    const named = runPy([path.join('tools', 'merge_data.py')], { MERGE_OUT_DIR: out, MERGE_TIPS: path.join(dir, 'nothing.json') });
    assert.ok(named.code === 1 && /技巧卡 MERGE_TIPS 指定的來源不存在/.test(named.out), named.out.slice(-500));
    assert.deepStrictEqual(fs.readdirSync(out), []);
    fs.mkdirSync(raw);
    fs.readdirSync(path.join(REPO, 'data', 'raw')).filter((f) => f !== 'tip_cards.json')
      .forEach((f) => fs.copyFileSync(path.join(REPO, 'data', 'raw', f), path.join(raw, f)));
    fs.writeFileSync(path.join(out, 'tips.js'), '/* 舊檔 */\n');
    const stale = runPy([path.join('tools', 'merge_data.py')], { MERGE_RAW_DIR: raw, MERGE_OUT_DIR: out });
    assert.ok(stale.code === 1 && /tip_cards\.json 不見了，輸出資料夾還留著舊的 tips\.js/.test(stale.out), stale.out.slice(-500));
    assert.deepStrictEqual(fs.readdirSync(out), ['tips.js']);
    assert.strictEqual(fs.readFileSync(path.join(out, 'tips.js'), 'utf8'), '/* 舊檔 */\n');
    fs.unlinkSync(path.join(out, 'tips.js'));
    const fresh = runPy([path.join('tools', 'merge_data.py')], { MERGE_RAW_DIR: raw, MERGE_OUT_DIR: out });
    assert.ok(fresh.code === 0 && /\[W\] tip_cards\.json 還沒有，不輸出 tips\.js/.test(fresh.out), fresh.out.slice(-500));
    assert.ok(fs.readdirSync(out).length > 0 && !fs.existsSync(path.join(out, 'tips.js')));
    return 'ok';
  });
};

T['T6 文字:中文用全形標點、逗號少;沒有承諾效果或口語客套的字、驚嘆號、問號、破折號、表情符號;示例英文沒有中文;示例種類跟 Part 對得上;都標原創'] = () => {
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

T['T7 第 1–8 堂技巧卡區塊引用的卡、測驗檢討會配的卡(js/lesson-rules.js)都在 data/tips.js'] = () => {
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

/* 現在有的卡,照來源的順序:第 1–8 堂與測驗檢討的 13 張,再加第 9–16 堂先用到的 6 張 */
const CARD_IDS = ['tip-P1-photo', 'tip-P2-wh', 'tip-P2-yn', 'tip-P3-gist', 'tip-P3-speaker_place', 'tip-P4-gist', 'tip-P5-word_form', 'tip-P5-tense',
  'tip-P5-verb_form', 'tip-P5-pron_case', 'tip-P5-prep_vs_conj', 'tip-P6-grammar', 'tip-P7-detail',
  'tip-P6-vocab', 'tip-P3-detail', 'tip-P5-prep_meaning', 'tip-P2-statement', 'tip-P5-vocab', 'tip-P5-vocab_verb'];
T['T9 卡的清單:19 張、id 照來源順序;兩包第 1–16 堂技巧卡區塊引用的卡都在'] = () => {
  const cards = loadTips().cards;
  assert.deepStrictEqual(copy(cards.map((c) => c.id)), CARD_IDS);   // 陣列來自 vm 的另一個環境,先複製再比
  const have = new Set(cards.map((c) => c.id)), missing = [];
  ['entry', 'threshold'].forEach((lv) => JSON.parse(read('data/packs/pack_' + lv + '.json')).lessons.slice(0, 16).forEach((l) => l.segments
    .forEach((s) => (s.blocks || []).filter((b) => b.module === 'tip_cards').forEach((b) => b.ids
      .filter((x) => !have.has(x.id)).forEach((x) => missing.push(lv + ' 第 ' + l.no + ' 堂 ' + x.id))))));
  assert.deepStrictEqual(missing, []);
  return cards.length + ' 張';
};

/* 卡教的跟用到它的那一堂對得上:門檻第 7 堂聽力只配一張 Part 3 卡,本堂目標是先讀三題、聽前兩句抓主旨 */
T['T10 門檻第 7 堂的 Part 3 卡教先讀題與抓主旨'] = () => {
  const cards = new Map(loadTips().cards.map((c) => [c.id, c]));
  const l7 = JSON.parse(read('data/packs/pack_threshold.json')).lessons.filter((l) => l.no === 7)[0];
  const ids = l7.segments.flatMap((s) => (s.blocks || []).filter((b) => b.module === 'tip_cards')).flatMap((b) => b.ids.map((x) => x.id)).filter((id) => /^tip-P3-/.test(id));
  assert.ok(ids.length > 0, '第 7 堂有 Part 3 卡');
  ids.forEach((id) => { const c = cards.get(id); assert.ok(/先讀/.test(c.title + c.body) && /主旨/.test(c.title + c.body), id + ' 沒教先讀題與抓主旨'); });
  return ids.join('、');
};
/* 考點的學生頁名稱(js/lesson-core.js POINT_NAME)跟卡上的叫法一致:P2.yn 是「是非問句」;Can 開頭的請求句課表歸在請求與提議,卡上不列 */
T['T11 是非問句的卡:標題與內文叫「是非問句」、開頭字不列 Can'] = () => {
  const c = loadTips().cards.filter((x) => x.id === 'tip-P2-yn')[0];
  assert.ok(/是非問句/.test(c.title), c.title);
  assert.ok(!/Yes\/No 問句/.test(c.title + c.body), '還有 Yes/No 問句的叫法');
  assert.ok(!/Can/.test(c.body.split('。')[0]), '開頭字列了 Can');
  return c.title;
};

T['T8 check_packs 收集測驗檢討會配的卡:要剛好 Part 1–7 各一張,配法改了(少一個 Part、一個 Part 兩張)會丟錯'] = () => {
  const { reviewTips } = require('./check_packs.js');
  const fake = (idOf) => ({ planTestReview: (parts) => Object.keys(parts).map((p) => ({ kind: 'tip', id: idOf(p.slice(1)) })).filter((x) => x.id) });
  assert.deepStrictEqual(reviewTips(fake((n) => 'tip-P' + n + '-x')), ['1', '2', '3', '4', '5', '6', '7'].map((n) => 'tip-P' + n + '-x'));
  assert.throws(() => reviewTips(fake((n) => (n === '7' ? null : 'tip-P' + n + '-x'))), /Part 1–7 各一張，從 js\/lesson-rules\.js 收集到 6 張/);
  const two = { planTestReview: (parts) => Object.keys(parts).flatMap((p) => [{ kind: 'tip', id: 'tip-' + p + '-a' }, { kind: 'tip', id: 'tip-' + p + '-b' }]) };
  assert.throws(() => reviewTips(two), /收集到 14 張/);
  return 'ok';
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
