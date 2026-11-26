/* 檢查每週新字表(data/packs/words_*.json)與小檢核可用題清單(data/packs/checkpoint_pool.json)。
   用法:node tools/check_pack_lists.js(也會被 tools/check_packs.js 呼叫)。有錯誤 exit 1。
   新字表:字序 1 起連號;每週一段連續的字序、週與週接得起來;字都在站上的文章單字或不規則動詞裡、沒有重複;
           packVersion 跟學習包一致;每週字數不超過規劃,少於規劃只提醒(字源去掉重複後不夠)。
   題目清單:id 不重複、都在題目索引、不在淘汰名單;每個 Part 都有題;小檢核區塊要的題量在清單裡夠不夠(不夠只提醒)。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));

function loadSources() {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['data/articles.js', 'data/verbs.js', 'data/bank-meta.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }));
  const vocab = new Set();
  ctx.TOEIC.articles.forEach((a) => a.vocab.forEach((v) => vocab.add(a.id + '|' + v.base + '|' + v.pos)));
  return { vocab, verbs: new Set(ctx.TOEIC.verbs.map((v) => v.id)), bank: ctx.BANK_META.items, retired: new Set(readJson('data/retired.json').retired.map((x) => x.id)) };
}

function checkWords(list, pack, src) {
  const out = { errors: [], warnings: [] };
  const bad = (m) => out.errors.push(m);
  if (!list || !Array.isArray(list.words) || !list.weeks) { bad('格式不對:要有 weeks 和 words'); return out; }
  if (list.level !== pack.level) bad('level 是 ' + list.level + '，學習包是 ' + pack.level);
  if (list.packVersion !== pack.packVersion) bad('packVersion ' + list.packVersion + ' 跟學習包的 ' + pack.packVersion + ' 不一致');
  const seen = new Set();
  list.words.forEach((w, i) => {
    if (w.n !== i + 1) bad('第 ' + (i + 1) + ' 個字的字序是 ' + w.n + '，要連號');
    const key = w.kind === 'verb' ? 'verb|' + w.id : 'vocab|' + String(w.base).toLowerCase() + '|' + w.pos;
    if (seen.has(key)) bad('字序 ' + w.n + ' 重複：' + key);
    seen.add(key);
    const ok = w.kind === 'verb' ? src.verbs.has(w.id) : w.kind === 'vocab' && src.vocab.has(w.article + '|' + w.base + '|' + w.pos);
    if (!ok) bad('字序 ' + w.n + ' 在站上的單字資料裡找不到');
  });
  let next = 1;
  const short = [];
  Object.keys(list.weeks).map(Number).sort((a, b) => a - b).forEach((wk) => {
    const r = list.weeks[wk], size = r.to - r.from + 1;
    if (wk < 1 || wk > pack.weeks) bad('週次 ' + wk + ' 超出範圍');
    if (r.from !== next) bad('第 ' + wk + ' 週從字序 ' + r.from + ' 開始，應該接在 ' + next);
    if (size < 1) bad('第 ' + wk + ' 週沒有字');
    if (size > list.planned) bad('第 ' + wk + ' 週 ' + size + ' 字，超過規劃的 ' + list.planned);
    else if (size < list.planned) short.push(wk + '(' + size + ')');
    next = r.to + 1;
  });
  if (short.length) out.warnings.push('第 ' + short.join('、') + ' 週的字數少於規劃的 ' + list.planned + '（現有字源去掉重複後不夠，沒有補新字）');
  if (next !== list.words.length + 1) bad('週次沒有涵蓋全部的字：到字序 ' + (next - 1) + '，共 ' + list.words.length + ' 個');
  return out;
}

const BANK_PART = { p1: '1', p2: '2', p3: '3', p4: '4', p5: '5', p6: '6', p7: '7' };

function checkPool(pool, src, pack) {
  const out = { errors: [], warnings: [] };
  const bad = (m) => out.errors.push(m);
  if (!pool || pool.v !== 1 || !Array.isArray(pool.ids)) { bad('格式不對:要有 v:1 和 ids 陣列'); return out; }
  const meta = new Map(src.bank.map((m) => [m.id, m]));
  const seen = new Set();
  pool.ids.forEach((id) => {
    if (seen.has(id)) bad(id + ' 重複');
    seen.add(id);
    if (!meta.has(id)) bad(id + ' 不在題目索引');
    if (src.retired.has(id)) bad(id + ' 在淘汰名單');
  });
  const count = {};
  pool.ids.forEach((id) => { const m = meta.get(id); if (m) count[m.part] = (count[m.part] || 0) + 1; });
  ['1', '2', '3', '4', '5', '6', '7'].forEach((p) => { if (!count[p]) bad('Part ' + p + ' 沒有可用的題'); });
  if (pack) checkpointNeeds(pack, pool, meta).forEach((m) => out.warnings.push(m));
  return out;
}

/* 小檢核的題庫區塊要的題量,跟清單裡同 Part 的題數比(粗略,不套條件) */
function checkpointNeeds(pack, pool, meta) {
  const have = {};
  pool.ids.forEach((id) => { const m = meta.get(id); if (m) have[m.part] = (have[m.part] || 0) + 1; });
  const need = {};
  (pack.lessons || []).filter((l) => l.checkpoint && l.no <= pack.liveThrough).forEach((l) => {
    (l.segments || []).filter((s) => s.slot === 'checkpoint').forEach((s) => (s.blocks || []).forEach((b) => {
      const p = BANK_PART[b.module];
      if (p && !b.fill) need[p] = Math.max(need[p] || 0, b.count);
    }));
  });
  return Object.keys(need).filter((p) => (have[p] || 0) < need[p]).map((p) => 'Part ' + p + ' 小檢核一個區塊要 ' + need[p] + '，清單只有 ' + (have[p] || 0));
}

function main() {
  const src = loadSources();
  let errors = 0;
  const show = (name, r) => {
    r.errors.forEach((m) => console.log('錯誤　' + name + ' ' + m));
    r.warnings.forEach((m) => console.log('提醒　' + name + ' ' + m));
    errors += r.errors.length;
  };
  ['entry', 'threshold'].forEach((level) => {
    const f = 'data/packs/words_' + level + '.json';
    if (!fs.existsSync(path.join(REPO, f))) return;
    show(f, checkWords(readJson(f), readJson('data/packs/pack_' + level + '.json'), src));
  });
  if (fs.existsSync(path.join(REPO, 'data/packs/checkpoint_pool.json'))) {
    const pool = readJson('data/packs/checkpoint_pool.json');
    ['entry', 'threshold'].forEach((level) => show('data/packs/checkpoint_pool.json（' + level + '）', checkPool(pool, src, readJson('data/packs/pack_' + level + '.json'))));
  }
  console.log(errors ? '有 ' + errors + ' 個錯誤' : '通過');
  return errors ? 1 : 0;
}

module.exports = { checkWords, checkPool, loadSources, main };
if (require.main === module) process.exitCode = main();
