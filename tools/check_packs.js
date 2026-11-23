/* 學習包檢查:data/packs/pack_*.json。
   用法:node tools/check_packs.js [檔案…](沒給就檢查 data/packs 底下全部的 pack_*.json,不含 pack_schema.json)
   檢查:
   - 格式照 data/packs/pack_schema.json(v1.2);
   - 24 堂、堂號 1–24 依序、lessonId 與週次、段的順序、blockId 不重複、每堂分鐘合計 60、fixedShare 跟固定段分鐘一致、
     主考點格 18 格不重複、小檢核區塊跟考點一一對應;liveThrough:status 是 live 時至少 1、不是 live 時要 0;
     開放的堂就是第 1 堂到第 liveThrough 堂(只寫一個數字,所以一定連號);
   - 內容:單字、聽力(引導區塊加重播秒數)、閱讀段的練習秒數占段時間 85–100%;小檢核含說明 60 秒在 918–1,080 秒;
     文法單元、英語耳程度在題庫裡有;題庫題用題目索引(data/bank-meta.js)算可用量;
   - 兩包能互相拼課表(聽力一級、閱讀另一級時每堂仍是 60 分)。
   開放的堂(≤ liveThrough)內容有問題算錯誤;之後的堂只列成提醒。題量不足、技巧卡與每週新字表還沒做,一律列成提醒。
   題庫篩不了的條件(legacyWhere 裡 bank.js 不認得的欄位,例如 stemKeyword;P3、P4 指定題型):選題時不篩、可用量會算多。
   區塊標成 needs_tags 的整包列一條提醒;沒標的在開放的堂算錯誤(開放前要在題目索引補欄位,或標成 needs_tags)。
   有錯誤 exit 1。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { validate } = require('./schema_lite.js');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const REPLAY = { p1: 11, p2: 11, p3: 36, p4: 33 };
const PRACTICE_SLOTS = ['vocab', 'listening', 'reading'];
const BANK_PART = { p1: '1', p2: '2', p3: '3', p4: '4', p5: '5', p6: '6', p7: '7' };
const LEGACY_OK = ['difficulty', 'category', 'type', 'format', 'maxWordCount', 'canYou'];   // 跟 js/pack-core.js bankWhereOf 一樣
const pad = (n) => (n < 10 ? '0' : '') + n;
const secondsOf = (blocks) => (blocks || []).reduce((a, b) => a + b.count * b.secondsPerUnit, 0);

/* 題庫資料:題目索引、文法單元、英語耳(用 vm 載入網站的資料檔) */
function loadData() {
  const ctx = { console, Promise, Map, Set, JSON, Object, Array, Math, Number, String, TypeError, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['data/bank-meta.js', 'data/grammar.js', 'data/ear.js', 'js/bank.js'].forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  return { bank: ctx.BANK, grammar: new Set(ctx.TOEIC.grammar.map((u) => u.id)), ear: ctx.TOEIC.ear };
}

function legacyToBank(sel) {
  const lw = sel.legacyWhere || {}, w = {};
  ['difficulty', 'category', 'type', 'format'].forEach((k) => { if (lw[k]) w[k] = lw[k].slice(); });
  if (lw.maxWordCount) w.maxWords = lw.maxWordCount;
  if (typeof lw.canYou === 'boolean') w.canYou = lw.canYou;
  if (sel.where && sel.where.setSize) w.size = sel.where.setSize.slice();
  return w;
}

/* 結構:每一堂都檢查,錯了一律是錯誤 */
function checkStructure(pack, out) {
  const err = (m) => out.errors.push(m);
  if (pack.status === 'live' && !(pack.liveThrough >= 1)) err('status 是 live，liveThrough 要至少 1');
  if (pack.status !== 'live' && pack.liveThrough !== 0) err('status 不是 live，liveThrough 要是 0');
  const cells = new Set((pack.pointCells || []).map((c) => c.week + c.track));
  if (cells.size !== 18) err('主考點格要 18 格不重複（週＋聽讀），實際 ' + cells.size);
  const ids = new Set();
  (pack.lessons || []).forEach((l, i) => {
    const at = '第 ' + l.no + ' 堂：';
    if (l.no !== i + 1) err(at + '堂號要從 1 依序到 24，這是第 ' + (i + 1) + ' 個');
    if (l.lessonId !== pack.level + '-L' + pad(l.no)) err(at + 'lessonId 要是 ' + pack.level + '-L' + pad(l.no));
    if (l.week !== Math.ceil(l.no / 2)) err(at + '週要是 ' + Math.ceil(l.no / 2));
    const segs = l.segments || [];
    segs.forEach((s, j) => { if (s.order !== j + 1) err(at + '段的 order 要依序 1、2、3…（' + s.slot + '）'); });
    if (new Set(segs.map((s) => s.slot)).size !== segs.length) err(at + '同一段出現兩次');
    const min = segs.reduce((a, s) => a + s.minutes, 0);
    if (min !== 60 || l.minutes !== 60) err(at + '分鐘合計要 60，實際 ' + min);
    const fixed = segs.filter((s) => s.fixed).reduce((a, s) => a + s.minutes, 0);
    const share = l.kind === 'test' ? 1 : Math.round(fixed / 60 * 100) / 100;
    if (Math.abs(l.fixedShare - share) > 1e-9) err(at + 'fixedShare 要是 ' + share + '（固定段 ' + fixed + ' 分），實際 ' + l.fixedShare);
    const blocks = [].concat(...segs.map((s) => (s.blocks || []).map((b) => [s.slot, b])), ((l.checkpoint || {}).fill || []).map((b) => ['checkpoint', b]));
    blocks.forEach(([slot, b]) => {
      if (ids.has(b.blockId)) err(at + 'blockId 重複：' + b.blockId);
      ids.add(b.blockId);
      if (b.blockId.indexOf(l.lessonId + '-' + slot + '-') !== 0) err(at + 'blockId 要是 ' + l.lessonId + '-' + slot + '-n：' + b.blockId);
    });
    const cpSeg = segs.filter((s) => s.slot === 'checkpoint')[0];
    if (cpSeg && l.checkpoint) {
      const c = l.checkpoint, n = c.listening.length + c.reading.length;
      if (cpSeg.blocks.length !== n) err(at + '小檢核區塊數要等於考點數 ' + n + '，實際 ' + cpSeg.blocks.length);
      cpSeg.blocks.forEach((b, k) => {
        const lis = /^p[1-4]$/.test(b.module);
        if ((k < c.listening.length) !== lis) err(at + '小檢核第 ' + (k + 1) + ' 個區塊要先聽力、再閱讀：' + b.blockId);
      });
      if (c.answerSeconds !== undefined && c.answerSeconds !== secondsOf(cpSeg.blocks)) err(at + 'answerSeconds 要是 ' + secondsOf(cpSeg.blocks));
    }
  });
}

function addReplay(slot, blocks) {
  return slot === 'listening' ? blocks.filter((b) => b.timing === 'guided' && REPLAY[b.module]).reduce((a, b) => a + b.count * REPLAY[b.module], 0) : 0;
}

/* 一個區塊的內容:回提醒或錯誤的文字陣列 [{ hard, msg }] */
function checkBlock(b, data, opt) {
  const out = [];
  const part = BANK_PART[b.module];
  if (part) {
    const want = /^[347]$/.test(part) || part === '6' ? 'set' : 'item';
    if (b.unit !== want) out.push({ hard: true, msg: b.blockId + ' 的單位要是 ' + want });
    if (b.select) {
      const lw = b.select.legacyWhere || {}, where = b.select.where || {};
      const cant = Object.keys(lw).filter((k) => LEGACY_OK.indexOf(k) < 0).concat(/^[34]$/.test(part) && where.qType ? ['qType'] : []);
      if (cant.length) out.push(b.bankStatus === 'needs_tags' ? { group: 'filter', id: b.blockId } : { hard: true, msg: b.blockId + ' 的條件 ' + cant.join('、') + ' 題庫篩不了（選題時不篩，可用量算多了）；在題目索引補欄位，或標成 needs_tags' });
      const have = opt.count(part, legacyToBank(b.select));
      if (have === 0) out.push({ hard: true, msg: b.blockId + ' 題庫裡沒有符合條件的題' });
      else if (have < b.count) out.push({ hard: false, msg: b.blockId + ' 題量不足：要 ' + b.count + '，題庫符合條件的有 ' + have });
    }
  }
  if (b.module === 'grammar' && b.select) b.select.where.unitIds.forEach((u) => { if (!data.grammar.has(u)) out.push({ hard: true, msg: b.blockId + ' 沒有文法單元 ' + u }); });
  if (/^ear_/.test(b.module) && b.select) {
    const sec = { ear_dictation: 'dictation', ear_pairs: 'pairs', ear_numbers: 'numbers', ear_shadow: 'shadow' }[b.module];
    const list = data.ear[sec] || (sec === 'shadow' ? data.ear.dictation : []);
    const n = list.filter((q) => (b.select.where.earLevel || []).indexOf(q.level) > -1).length;
    if (n < b.count) out.push({ hard: true, msg: b.blockId + ' 英語耳題量不足：要 ' + b.count + '，有 ' + n });
  }
  if (b.module === 'tip_cards' && !opt.tips) b.ids.forEach((x) => out.push({ group: 'tips', id: x.id }));
  if (b.module === 'article_vocab' && !opt.words) out.push({ group: 'words', id: b.blockId });
  if (b.bankStatus === 'needs_items') out.push({ hard: true, msg: b.blockId + ' 標成需要補題' });
  return out;
}

/* 內容:開放的堂是錯誤,之後的堂是提醒 */
function checkContent(pack, data, out, opt) {
  const missing = { tips: new Set(), words: new Set(), filter: new Set() };
  (pack.lessons || []).forEach((l) => {
    const live = l.no <= pack.liveThrough;
    const at = '第 ' + l.no + ' 堂：';
    const put = (x) => (x.group ? missing[x.group].add(x.id) : (live && x.hard ? out.errors : out.warnings).push(at + x.msg));
    (l.segments || []).forEach((s) => {
      if (PRACTICE_SLOTS.indexOf(s.slot) > -1) {
        const sec = secondsOf(s.blocks) + addReplay(s.slot, s.blocks), all = s.minutes * 60;
        if (sec < all * 0.85 || sec > all) put({ hard: true, msg: s.slot + ' 練習 ' + sec + ' 秒，占段時間 ' + Math.round(sec / all * 100) + '%（要 85–100%）' });
      }
      (s.blocks || []).forEach((b) => checkBlock(b, data, opt).forEach(put));
    });
    if (l.checkpoint) {
      const sec = l.checkpoint.answerSeconds + 60 + secondsOf(l.checkpoint.fill);
      if (sec < 918 || sec > 1080) put({ hard: true, msg: '小檢核 ' + sec + ' 秒（含說明 60 秒要 918–1,080）' });
      (l.checkpoint.fill || []).forEach((b) => checkBlock(b, data, opt).forEach(put));
      if (live && !opt.pool) out.warnings.push(at + '小檢核只從可用題清單選題，清單還沒有時上課會停在這一段');
    }
  });
  /* 還沒做的內容(技巧卡、每週新字表)整包列一次 */
  if (missing.tips.size) out.warnings.push('技巧卡還沒有 ' + missing.tips.size + ' 張：' + [...missing.tips].sort().join('、'));
  if (missing.words.size) out.warnings.push('每週新字表還沒有（' + missing.words.size + ' 個單字區塊用到）');
  if (missing.filter.size) out.warnings.push('有 ' + missing.filter.size + ' 個區塊的條件題庫篩不了、標成 needs_tags（選題時不篩，可用量算多了）：' + [...missing.filter].sort().join('、'));
}

/* 兩包互相拼:聽力段跟一包、單字與閱讀段跟另一包,每堂仍是 60 分 */
function checkMix(packs, out) {
  global.window = global;
  require('../js/lesson-rules.js');
  require('../js/pack-core.js');
  const PC = global.PACK_CORE;
  const by = {};
  packs.forEach((p) => { by[p.level] = Object.assign({}, p, { status: 'live', liveThrough: 24 }); });
  const levels = Object.keys(by);
  levels.forEach((a) => levels.forEach((b) => {
    if (a === b) return;
    for (let no = 1; no <= 24; no++) {
      try { PC.compose(by, { listening: a, reading: b }, no); } catch (e) { out.errors.push('聽力 ' + a + '、閱讀 ' + b + ' 第 ' + no + ' 堂拼不起來：' + e.message); }
    }
  }));
}

function checkPack(pack, data, opt) {
  const out = { errors: [], warnings: [] };
  validate(opt.schema, pack).forEach((e) => out.errors.push('格式 ' + e.path + '：' + e.msg));
  if (!Array.isArray(pack.lessons)) return out;
  checkStructure(pack, out);
  checkContent(pack, data, out, opt);
  return out;
}

/* 先把所有題庫區塊的條件在題目索引裡算好可用量(BANK.pick 是非同步的),回同步查表的函式 */
async function bankCounts(packs, bank) {
  const map = new Map();
  for (const p of packs) {
    for (const l of p.lessons || []) {
      const blocks = [].concat(...(l.segments || []).map((s) => s.blocks || []), (l.checkpoint || {}).fill || []);
      for (const b of blocks) {
        const part = BANK_PART[b.module];
        if (!part || !b.select) continue;
        const w = legacyToBank(b.select), k = part + JSON.stringify(w);
        if (!map.has(k)) map.set(k, (await bank.pick({ part, n: 100000, where: w, records: {}, order: 'listed' })).length);
      }
    }
  }
  return (part, w) => map.get(part + JSON.stringify(w));
}

function readPacks(list) {
  const out = [];
  list.forEach((f) => {
    try { out.push({ f, pack: JSON.parse(fs.readFileSync(path.resolve(REPO, f), 'utf8')) }); } catch (e) { out.push({ f, bad: e.message }); }
  });
  return out;
}

async function main(files) {
  const list = files.length ? files : fs.readdirSync(path.join(REPO, 'data/packs')).filter((f) => /^pack_(?!schema).+\.json$/.test(f)).map((f) => path.join('data/packs', f));
  const schema = JSON.parse(read('data/packs/pack_schema.json'));
  const data = loadData();
  const items = readPacks(list);
  const ok = items.filter((x) => x.pack);
  const opt = { schema, tips: fs.existsSync(path.join(REPO, 'data/tips.js')), count: await bankCounts(ok.map((x) => x.pack), data.bank) };
  let errors = 0;
  items.filter((x) => x.bad).forEach((x) => { console.log('錯誤　' + x.f + ' 讀不懂：' + x.bad); errors++; });
  const packs = [];
  ok.forEach(({ f, pack }) => {
    opt.words = fs.existsSync(path.join(REPO, 'data/packs/words_' + pack.level + '.json'));
    opt.pool = fs.existsSync(path.join(REPO, 'data/packs/checkpoint_pool.json'));
    const r = checkPack(pack, data, opt);
    packs.push(pack);
    r.errors.forEach((m) => console.log('錯誤　' + f + ' ' + m));
    r.warnings.forEach((m) => console.log('提醒　' + f + ' ' + m));
    console.log(f + '：開放到第 ' + pack.liveThrough + ' 堂；錯誤 ' + r.errors.length + '、提醒 ' + r.warnings.length);
    errors += r.errors.length;
  });
  if (packs.length > 1) {
    const out = { errors: [] };
    checkMix(packs, out);
    out.errors.forEach((m) => console.log('錯誤　' + m));
    errors += out.errors.length;
  }
  if (!files.length) errors += require('./check_pack_lists.js').main() ? 1 : 0;
  console.log(errors ? '有 ' + errors + ' 個錯誤' : '通過');
  return errors ? 1 : 0;
}

module.exports = { checkPack, checkStructure, checkContent, checkMix, loadData, legacyToBank, bankCounts };
if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(e); process.exitCode = 2; });
