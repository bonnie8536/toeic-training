/* 學習包資料與工具:data/packs/pack_schema.json(v1.2)、tools/schema_lite.js、tools/check_packs.js、tools/md_to_pack.js 與 tools/pack_md.js。
   Markdown 課表不放在 repo,這裡不讀;轉檔的讀法用小段的表格文字測。用法:node tools/test_pack_data.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const { validate } = require('./schema_lite.js');
const CP = require('./check_packs.js');
const M = require('./pack_md.js');
const MD = require('./md_to_pack.js');
const SCHEMA = JSON.parse(read('data/packs/pack_schema.json'));
const PACKS = { entry: JSON.parse(read('data/packs/pack_entry.json')), threshold: JSON.parse(read('data/packs/pack_threshold.json')) };
const copy = (x) => JSON.parse(JSON.stringify(x));
const DATA = CP.loadData();
let COUNT = null;
async function check(pack, data) {
  if (!COUNT) COUNT = await CP.bankCounts([PACKS.entry, PACKS.threshold], DATA.bank);
  const count = await CP.bankCounts([pack], DATA.bank);
  return CP.checkPack(pack, data || DATA, { schema: SCHEMA, words: false, count });
}
/* 第 1–8 堂技巧卡區塊引用的卡,加上測驗檢討會配的卡 */
const tipIdsOf = (lessons) => lessons.flatMap((l) => l.segments.flatMap((s) => (s.blocks || []).filter((b) => b.module === 'tip_cards').flatMap((b) => b.ids.map((x) => x.id))));
const EARLY_TIPS = [...new Set(Object.keys(PACKS).flatMap((k) => tipIdsOf(PACKS[k].lessons.slice(0, 8))).concat(DATA.reviewTips))].sort();
const withoutTips = (...ids) => Object.assign({}, DATA, { tips: new Set([...DATA.tips].filter((id) => ids.indexOf(id) < 0)) });

const T = {};

T['P1 schema v1.2:版本 1.2;包層必填 liveThrough(0–24 整數);個人段規則多 test_review_v1;舊欄位條件有 canYou;單字週次只有 three_weeks_ago'] = () => {
  assert.deepEqual(SCHEMA.properties.schemaVersion, { const: '1.2' });
  assert.ok(SCHEMA.required.indexOf('liveThrough') > -1);
  const lt = SCHEMA.properties.liveThrough;
  assert.deepEqual([lt.type, lt.minimum, lt.maximum], ['integer', 0, 24]);
  assert.ok(SCHEMA.$defs.segment.properties.rule.enum.indexOf('test_review_v1') > -1);
  assert.deepEqual(SCHEMA.$defs.legacyWhere.properties.canYou.type, 'boolean');
  assert.deepEqual(SCHEMA.$defs.where.properties.weekWords.items.enum, ['this_week', 'last_week', 'three_weeks_ago']);
  assert.ok(!/week_minus_3"/.test(read('data/packs/pack_entry.json') + read('data/packs/pack_threshold.json')));
  return 'ok';
};

T['P2 兩個學習包照 schema 檢查都通過;入門開放到第 4 堂、門檻開放到第 8 堂,其餘不開放'] = () => {
  const live = { entry: 4, threshold: 8 };
  Object.keys(PACKS).forEach((k) => {
    assert.deepEqual(validate(SCHEMA, PACKS[k]), [], k);
    assert.deepEqual([PACKS[k].status, PACKS[k].liveThrough, PACKS[k].lessons.length], ['live', live[k], 24]);
  });
  return 'ok';
};

/* 門檻開放到第 8 堂時,學習包只改開放到第幾堂與轉檔說明兩欄:24 堂的內容、其他欄位、入門那一包都跟開放到第 4 堂時逐位元組相同
   (JSON 字串的 sha256 前 16 碼;版號不升,換版號會讓兩台同一堂各寫各的) */
T['P2b 門檻開放到第 8 堂:24 堂內容、版號與其他欄位跟以前一樣,只改開放堂數與轉檔說明;入門那一包不變'] = () => {
  const h = (x) => require('crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
  const t = PACKS.threshold, rest = Object.assign({}, t), au = Object.assign({}, t.authoring);
  ['liveThrough', 'authoring', 'lessons'].forEach((k) => delete rest[k]);
  ['changeNote', 'updatedAt'].forEach((k) => delete au[k]);
  assert.deepEqual([h(t.lessons), h(rest), h(au), h(PACKS.entry), t.packVersion], ['7aba2844f9198a8c', '38221df33d201437', '7e39b8f76219bb5d', 'ef95b1a83872a393', '1.0.0']);
  assert.equal(t.authoring.changeNote, '由 tools/md_to_pack.js 轉出；開放到第 8 堂');
  return 'ok';
};

T['P3 小型 schema 驗證:認得 $ref、oneOf、if/then、additionalProperties、pattern、字數;遇到不認得的關鍵字丟錯'] = () => {
  const s = {
    $defs: { n: { type: 'integer', minimum: 1 } }, type: 'object', additionalProperties: false, required: ['a'],
    properties: { a: { $ref: '#/$defs/n' }, b: { type: 'string', pattern: '^x', maxLength: 3 }, c: { oneOf: [{ const: 1 }, { type: 'string' }] } },
    allOf: [{ if: { properties: { a: { const: 2 } } }, then: { required: ['b'] } }],
  };
  assert.deepEqual(validate(s, { a: 1 }), []);
  const msg = (v) => validate(s, v).map((e) => e.msg).join(' / ');
  assert.match(msg({}), /少了欄位 a/);
  assert.match(msg({ a: 0 }), /不能小於 1/);
  assert.match(msg({ a: 1, z: 1 }), /多了不認得的欄位 z/);
  assert.match(msg({ a: 2 }), /少了欄位 b/);
  assert.match(msg({ a: 1, b: 'xyzw' }), /最多 3 個字/);
  assert.match(msg({ a: 1, b: 'yy' }), /不符合格式/);
  assert.match(msg({ a: 1, c: true }), /oneOf/);
  assert.equal(validate({ maxLength: 2 }, '中文字').length, 1, '字數用字元算');
  assert.throws(() => validate({ contains: {} }, []), /不認得的關鍵字/);
  return 'ok';
};

T['P4 check_packs 指令:兩包通過、exit 0;第 1–8 堂與測驗檢討用到的技巧卡都有,缺卡提醒只列之後的堂;新字表與小檢核清單有了就不再提醒缺少'] = () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check_packs.js')], { encoding: 'utf8', cwd: REPO });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /通過/);
  const tipLines = r.stdout.split('\n').filter((s) => /技巧卡還沒有/.test(s));
  assert.ok(tipLines.length > 0 && tipLines.every((s) => /之後的堂用到的技巧卡還沒有/.test(s)), tipLines.join(' / '));
  const listed = new Set(tipLines.flatMap((s) => s.trim().split('：').pop().split('、')));
  EARLY_TIPS.forEach((id) => assert.ok(!listed.has(id), id + ' 不該在缺卡提醒裡'));
  assert.ok(!/每週新字表還沒有/.test(r.stdout) && !/可用題清單選題/.test(r.stdout));
  assert.ok(!/^錯誤/m.test(r.stdout));
  return r.stdout.trim().split('\n').length + ' 行';
};

T['P14 check_packs 技巧卡逐張查:開放的堂缺卡算錯誤、之後的堂整包列一條提醒;開放的堂有測驗檢討段時,測驗檢討會配的卡都要有'] = async () => {
  assert.deepEqual(DATA.reviewTips, ['tip-P1-photo', 'tip-P2-wh', 'tip-P3-gist', 'tip-P4-gist', 'tip-P5-word_form', 'tip-P6-grammar', 'tip-P7-detail']);
  EARLY_TIPS.forEach((id) => assert.ok(DATA.tips.has(id), id));
  const all = await check(copy(PACKS.entry));
  assert.ok(!all.errors.length && !all.warnings.some((w) => /技巧卡還沒有.*tip-P5-tense/.test(w)), all.errors.join(' / '));
  const photo = await check(copy(PACKS.entry), withoutTips('tip-P1-photo'));
  assert.ok(photo.errors.some((e) => /^第 3 堂：entry-L03-listening-1 的技巧卡 tip-P1-photo 還沒有/.test(e)), photo.errors.join(' / '));
  assert.ok(photo.errors.some((e) => /^第 2 堂：測驗檢討會配的技巧卡 tip-P1-photo 還沒有/.test(e)), photo.errors.join(' / '));
  const later = await check(copy(PACKS.entry), withoutTips('tip-P5-tense'));
  assert.ok(!later.errors.length && later.warnings.some((w) => /之後的堂用到的技巧卡還沒有 \d+ 張：.*tip-P5-tense/.test(w)), later.errors.join(' / '));
  /* 測驗檢討這一條路單獨查:技巧卡區塊裡的 tip-P7-detail(第 19 堂)先換成別張,缺這張只會從測驗檢討來 */
  const closed = copy(PACKS.entry);
  closed.lessons.forEach((l) => l.segments.forEach((s) => (s.blocks || []).filter((b) => b.module === 'tip_cards')
    .forEach((b) => b.ids.forEach((x) => { if (x.id === 'tip-P7-detail') x.id = 'tip-P1-photo'; }))));
  assert.ok(tipIdsOf(PACKS.entry.lessons).indexOf('tip-P7-detail') > -1 && tipIdsOf(closed.lessons).indexOf('tip-P7-detail') < 0);
  closed.liveThrough = 1;
  const r1 = await check(closed, withoutTips('tip-P7-detail'));
  assert.ok(!r1.errors.length && r1.warnings.some((w) => /技巧卡還沒有.*tip-P7-detail/.test(w)), '第 2 堂還沒開放時測驗檢討缺卡只提醒：' + r1.errors.join(' / '));
  closed.liveThrough = 2;
  const r2 = await check(closed, withoutTips('tip-P7-detail'));
  assert.ok(r2.errors.some((e) => /^第 2 堂：測驗檢討會配的技巧卡 tip-P7-detail 還沒有/.test(e)), '第 2 堂開放後同一份算錯誤：' + r2.errors.join(' / '));
  const noReview = copy(closed);
  noReview.lessons.forEach((l) => { l.segments = l.segments.filter((s) => s.slot !== 'test_review'); });
  const r3 = await check(noReview, withoutTips('tip-P7-detail'));
  assert.ok(!r3.warnings.some((w) => /技巧卡還沒有.*tip-P7-detail/.test(w)), '拿掉測驗檢討段後不該再提醒 tip-P7-detail');
  const th = await check(copy(PACKS.threshold), withoutTips('tip-P7-detail'));
  assert.ok(th.errors.some((e) => /^第 2 堂：測驗檢討會配的技巧卡 tip-P7-detail 還沒有/.test(e)), th.errors.join(' / '));
  const none = await check(copy(PACKS.threshold), Object.assign({}, DATA, { tips: new Set() }));
  assert.ok(none.errors.some((e) => /threshold-L03-reading-1 的技巧卡 tip-P5-word_form 還沒有/.test(e)));
  return EARLY_TIPS.length + ' 張';
};

T['P5 check_packs 抓得到結構錯誤:liveThrough 超出、live 卻是 0、不是 live 卻開放、分鐘不是 60、fixedShare 不符、blockId 重複、堂號不連續'] = async () => {
  const bad = [
    ['liveThrough 25', (p) => { p.liveThrough = 25; }, /liveThrough/],
    ['live 但 0', (p) => { p.liveThrough = 0; }, /liveThrough 要至少 1/],
    ['draft 但開放', (p) => { p.status = 'draft'; }, /liveThrough 要是 0/],
    ['分鐘', (p) => { p.lessons[2].segments[1].minutes = 18; }, /分鐘合計要 60/],
    ['fixedShare', (p) => { p.lessons[2].fixedShare = 0.65; }, /fixedShare 要是 0.68/],
    ['blockId', (p) => { p.lessons[2].segments[1].blocks[1].blockId = p.lessons[2].segments[1].blocks[0].blockId; }, /blockId 重複/],
    ['堂號', (p) => { const a = p.lessons[5]; p.lessons[5] = p.lessons[6]; p.lessons[6] = a; }, /堂號要從 1 依序/],
    ['小檢核對應', (p) => { p.lessons[3].checkpoint.listening.pop(); }, /小檢核區塊數要等於考點數/],
    ['段的順序', (p) => { p.lessons[2].segments[0].order = 3; }, /order 要依序/],
  ];
  for (const [name, f, re] of bad) {
    const p = copy(PACKS.entry);
    f(p);
    const r = await check(p);
    assert.ok(r.errors.some((e) => re.test(e)), name + '：' + r.errors.join(' / '));
  }
  return bad.length + ' 種';
};

T['P6 check_packs 內容:開放的堂是錯誤、之後的堂只提醒(練習秒數占比、文法單元不存在、題庫沒有符合條件的題)'] = async () => {
  const shrink = (p, i) => { p.lessons[i].segments.filter((s) => s.slot === 'reading')[0].blocks.forEach((b) => { b.count = 1; }); };
  const live = copy(PACKS.entry); shrink(live, 2);
  assert.ok((await check(live)).errors.some((e) => /第 3 堂：reading 練習/.test(e)));
  const later = copy(PACKS.entry); shrink(later, 6);
  const r = await check(later);
  assert.ok(!r.errors.length && r.warnings.some((e) => /第 7 堂：reading 練習/.test(e)), r.errors.join(' / '));
  const g = copy(PACKS.threshold);
  g.lessons[3].segments.filter((s) => s.slot === 'reading')[0].blocks[0].select.where.unitIds = ['gz-99'];
  assert.ok((await check(g)).errors.some((e) => /沒有文法單元 gz-99/.test(e)));
  const none = copy(PACKS.entry);
  none.lessons[2].segments.filter((s) => s.slot === 'listening')[0].blocks.filter((b) => b.module === 'p2')[0].select.legacyWhere = { category: ['沒有這類'] };
  assert.ok((await check(none)).errors.some((e) => /題庫裡沒有符合條件的題/.test(e)));
  const cp = copy(PACKS.entry);
  cp.lessons[3].checkpoint.fill = [];
  assert.ok((await check(cp)).errors.some((e) => /小檢核 440 秒/.test(e)));
  return 'ok';
};

T['P13 check_packs:題庫篩不了的條件(stemKeyword、P3／P4 題型)標成 needs_tags 的整包列一條提醒;沒標的在開放的堂算錯誤'] = async () => {
  const r = await check(copy(PACKS.threshold));
  assert.ok(!r.errors.length && r.warnings.some((w) => /條件題庫篩不了、標成 needs_tags.*threshold-L19-reading-2/.test(w)), r.errors.join(' / '));
  const bad = copy(PACKS.threshold);
  const b = bad.lessons[2].segments.filter((s) => s.slot === 'reading')[0].blocks.filter((x) => x.module === 'p5')[0];
  b.select.legacyWhere = Object.assign({}, b.select.legacyWhere, { stemKeyword: ['NOT'] });
  b.bankStatus = 'available_legacy';
  assert.ok((await check(bad)).errors.some((e) => /第 3 堂：.*stemKeyword 題庫篩不了/.test(e)));
  return 'ok';
};

T['P7 兩包互相拼課表都是 60 分;拼不起來的會報錯'] = () => {
  const ok = { errors: [] };
  CP.checkMix([PACKS.entry, PACKS.threshold], ok);
  assert.deepEqual(ok.errors, []);
  const broken = copy(PACKS.threshold);
  broken.lessons[4].segments.filter((s) => s.slot === 'reading')[0].slot = 'listening_x';
  const out = { errors: [] };
  CP.checkMix([PACKS.entry, broken], out);
  assert.ok(out.errors.some((e) => /第 5 堂拼不起來/.test(e)), out.errors.join(' / '));
  return 'ok';
};

T['P8 逐堂表的讀法:入門寫法(反引號 key:值)與門檻寫法(key 值、模組在括號)都讀得出區塊'] = () => {
  const e = M.cells('|  |  | 固定 | WH 問句引導；`part:P2` `qType:wh` `level:D1`｜舊：`category:WH問句` `difficulty:基礎`；難度 D1 100% | 4 | 35 | 140 | 引導 |');
  const b = M.rowEntryFormat(e, 'entry').block;
  assert.deepEqual([b.module, b.unit, b.count, b.secondsPerUnit, b.timing, b.playsAllowed], ['p2', 'item', 4, 35, 'guided', 2]);
  assert.deepEqual(b.select.where, { part: ['P2'], qType: ['wh'], level: ['D1'] });
  assert.deepEqual(b.select.legacyWhere, { difficulty: ['基礎'], category: ['WH問句'] });
  assert.deepEqual(b.select.levelMix, { D1: 1, D2: 0, D3: 0, D4: 0 });
  const yn = M.rowEntryFormat(M.cells('|  |  | 固定 | 是非問句限時；`part:P2` `qType:yn`｜舊：`category:Yes/No問句`，排除 Can you／Could you 開頭；難度 照 pack 60／35／5／0 | 7 | 35 | 245 | 限時 |'), 'entry').block;
  assert.deepEqual([yn.select.legacyWhere.canYou, yn.select.levelMix, yn.playsAllowed], [false, 'pack', 1]);
  const t = M.cells('|  |  | 3 | P7 單篇 4 題組（p7） | part P7、format single、setSize 4；qType detail、gist；maxWordCount 225｜舊：format single；maxWordCount 225 | D1 50%、D2 50% | 1 組 | 360 | 引導 | 360 |');
  const p7 = M.rowThresholdFormat(t, 'threshold').block;
  assert.deepEqual(p7.select.where, { part: ['P7'], qType: ['detail', 'gist'], setSize: [4], maxWordCount: 225, passages: [1] });
  assert.deepEqual(p7.select.legacyWhere, { format: ['single'], maxWordCount: 225 });
  assert.equal(p7.bankStatus, 'needs_tags');
  const req = M.rowThresholdFormat(M.cells('|  |  | 6 | P2 建議請求提供（p2） | qType request｜舊：無對應分類 | pack | 2 題 | 35 | 限時 | 70 |'), 'threshold').block;
  assert.deepEqual(req.select.legacyWhere, { category: ['Yes/No問句'], canYou: true });
  const g = M.rowThresholdFormat(M.cells('| reading | 8 | 1 | 文法單元（grammar） | unitIds gf-01 形容詞的位置 | 不適用 | 1 單元 | 480 | 不計時 | 480 |'), 'threshold').block;
  assert.deepEqual([g.module, g.select.where.unitIds[0], g.timing], ['grammar', 'gf-01', 'untimed']);
  const ear = M.rowEntryFormat(M.cells('|  |  | 固定 | 最小對立（相似音）；`earLevel:初級`；難度 無 | 10 | 10 | 100 | 限時 |'), 'entry').block;
  assert.deepEqual([ear.module, ear.unit, ear.select.where.earLevel], ['ear_pairs', 'item', ['初級']]);
  assert.match(M.rowEntryFormat(M.cells('|  |  | 固定 | 某種新東西；`foo:bar`；難度 無 | 1 | 60 | 60 | 限時 |'), 'entry').issue, /認不得的條件：foo/);
  assert.match(M.rowThresholdFormat(M.cells('|  |  | 1 | 沒寫模組 | x | 不適用 | 1 題 | 40 | 限時 | 40 |'), 'threshold').issue, /沒寫模組/);
  return 'ok';
};

T['P9 單字段由規則產生:主課字卡＋10、延伸 14、小檢核堂 11、新字第一次出現的延伸堂字卡＋11;沒有新字的週併到其他週'] = () => {
  const plan = (no, lv) => { const p = M.vocabPlan(no, lv); return (p.card ? 'card+' : '') + p.groups.map((g) => g.which.split('_')[0].charAt(0) + g.n).join(','); };
  assert.equal(plan(2, 'entry'), 'card+t11');
  assert.equal(plan(3, 'entry'), 'card+t8,l2');
  assert.equal(plan(4, 'entry'), 't9,l2');
  assert.equal(plan(6, 'entry'), 't11,l3');
  assert.equal(plan(7, 'entry'), 'card+t6,l2,t2');
  assert.equal(plan(14, 'entry'), 'card+t6,l3,t2');
  assert.equal(plan(14, 'threshold'), 'l12,t2');
  assert.equal(plan(15, 'threshold'), 'card+t8,t2');
  assert.equal(plan(24, 'entry'), 'l9,t2');
  [1, 13, 23].forEach((no) => assert.ok(M.skeleton(no).every(([s]) => s !== 'vocab')));
  for (let no = 1; no <= 24; no++) {
    const seg = PACKS.entry.lessons[no - 1].segments.filter((s) => s.slot === 'vocab')[0];
    if (!seg) continue;
    const sec = seg.blocks.reduce((a, b) => a + b.count * b.secondsPerUnit, 0);
    assert.ok(sec >= seg.minutes * 60 * 0.85 && sec <= seg.minutes * 60, no + ' ' + sec);
  }
  return 'ok';
};

T['P10 小檢核表的讀法:各 n、組數與題型、單篇 ≤225 字、補位與未過關;補足區塊的秒數'] = () => {
  const a = M.cpPoints('`P2.wh`、`P2.yn`、`P2.choice` 各 5');
  assert.deepEqual(a.points.map((p) => p.key + p.n), ['P2.wh5', 'P2.yn5', 'P2.choice5']);
  const b = M.cpPoints('`P3.set` 2 組（`gist`、`speaker_place`）、`P4.set` 2 組');
  assert.deepEqual(b.points.map((p) => [p.key, p.n, p.group, p.qType]), [['P3.set', 2, true, ['gist', 'speaker_place']], ['P4.set', 2, true, []]]);
  const c = M.cpPoints('`P5.relative_pron` 5、P7 單篇 1 組（≤225 字）');
  assert.deepEqual(c.points.map((p) => [p.key, p.words]), [['P5.relative_pron', null], ['P7.set', 225]]);
  const d = M.cpPoints('`P5.tense`、`P5.pron_case` 各 5；補位：第 1 次未過關的 `noun_slot` 或 `adj_slot` 5（有才出）');
  assert.deepEqual([d.unpassed, d.points.length], [true, 2]);
  assert.deepEqual(M.cpPoints('`P5.vocab_*` 5、`P7.not` 單篇 1 組').points.map((p) => p.key), ['P5.cat:字彙辨析', 'P7.not']);
  assert.deepEqual(M.cpPoints('亂寫的').bad, ['亂寫的']);
  const blk = M.cpBlock(c.points[1]);
  assert.deepEqual([blk.module, blk.unit, blk.secondsPerUnit, blk.select.legacyWhere.maxWordCount], ['p7', 'set', 240, 225]);
  const f = M.fillBlocks('未過關主考點依權重加到 ≤1,020 秒；仍不足時已學單字與片語小考補到 ≥918 秒（例）', 'threshold', 420);
  assert.deepEqual(f.blocks.map((x) => x.count * x.secondsPerUnit), [440]);
  assert.deepEqual(M.fillBlocks('聽寫 5 句（300）', 'entry', 0).blocks[0].select.where.earLevel, ['初級']);
  return 'ok';
};

T['P11 轉檔的其他小工具:主考點格的鍵(Part 沿用前一個)、難度配比、對齊說明列的重播堂號、重播加 1 分、參數檢查'] = () => {
  assert.deepEqual(MD.cellKeys('P1 `photo`、P2 `wh`'), ['P1.photo', 'P2.wh']);
  assert.deepEqual(MD.cellKeys('`P2.yn`、`choice`、`request`'), ['P2.yn', 'P2.choice', 'P2.request']);
  assert.deepEqual(MD.cellKeys('P6 `grammar`、`vocab`'), ['P6.type:文法', 'P6.type:字彙']);
  assert.deepEqual(MD.cellKeys('`P3.detail`、`P3.inference`、三人對話'), ['P3.detail', 'P3.inference']);
  assert.deepEqual(MD.difficultyMix('練習難度 | D1 60%、D2 35%、D3 5%、D4 0% |'), { D1: 0.6, D2: 0.35, D3: 0.05, D4: 0 });
  assert.equal(MD.difficultyMix('D1 60%、D2 35%、D3 5%、D4 5%'), null, '合計不是 100% 不收');
  const md = '## 0.1 對齊\n| 重播 | x | 第 5、9 堂聽力段 17 → 18 分；第 11 堂聽力段 17 → 18 分 |\n## 1. 下一節\n';
  assert.deepEqual([...MD.replayListed(md)], [5, 9, 11]);
  const segs = [{ slot: 'listening', minutes: 8, blocks: [{ module: 'p1', count: 3, secondsPerUnit: 40, timing: 'guided' }, { module: 'p2', count: 10, secondsPerUnit: 35, timing: 'timed' }] }, { slot: 'review', minutes: 8, maxUnits: 12 }];
  const issues = [];
  assert.equal(MD.applyReplay(2, segs, issues), true);
  assert.deepEqual([segs[0].minutes, segs[1].minutes, segs[1].maxUnits], [9, 7, 11]);
  const over = [{ slot: 'listening', minutes: 8, blocks: [{ module: 'p2', count: 12, secondsPerUnit: 35, timing: 'guided' }] }, { slot: 'review', minutes: 8, maxUnits: 12 }];
  assert.equal(MD.applyReplay(3, over, issues), false);
  assert.match(issues[0].why, /只接受 60 秒內/);
  assert.throws(() => MD.args(['--level', 'entry']), /--md/);
  assert.throws(() => MD.args(['--level', 'entry', '--md', 'x', '--live-through', '25']), /0 到 24/);
  assert.equal(MD.args(['--level', 'entry', '--md', 'x', '--live-through', '4']).liveThrough, 4);
  return 'ok';
};

T['P12 學習包內容:前 4 堂的堂型與段落;測驗堂用過渡期半回卷、測驗檢討段照 test_review_v1 不放固定區塊;第 4 堂小檢核涵蓋第 1–2 週'] = () => {
  Object.keys(PACKS).forEach((k) => {
    const L = PACKS[k].lessons;
    assert.deepEqual(L.slice(0, 4).map((l) => l.kind), ['test', 'test_review', 'regular', 'checkpoint']);
    assert.deepEqual(L[0].test, { kind: 'pretest', form: 'interim_half', blueprint: 'half_v1' });
    assert.deepEqual(L[0].segments.map((s) => s.slot + s.minutes), ['test_listening23', 'test_reading37']);
    const tr = L[1].segments[0];
    assert.deepEqual([tr.slot, tr.minutes, tr.rule, tr.blocks], ['test_review', 15, 'test_review_v1', undefined]);
    assert.deepEqual(L[3].checkpoint.coversWeeks, [1, 2]);
    assert.ok(L.every((l) => l.segments.every((s) => (s.blocks || []).every((b) => !b.select || !b.select.where.weekWords || b.select.where.weekWords.every((w) => ['this_week', 'last_week', 'three_weeks_ago'].indexOf(w) > -1)))));
  });
  return 'ok';
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let detail = '', ok = true;
    try { detail = await T[name](); } catch (e) {
      ok = false;
      detail = e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e);
      if (e && e.actual !== undefined) detail = '實際 ' + JSON.stringify(e.actual) + ' 預期 ' + JSON.stringify(e.expected) + ' ' + detail;
    }
    if (ok) pass++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + String(detail).slice(0, 400) : ''));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
