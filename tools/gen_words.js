/* 產生每週新字表 data/packs/words_entry.json、words_threshold.json。
   用法:node tools/gen_words.js(寫檔;字序一次產生,之後跟著學習包版本走,不要隨意重產)
   字從站上現有資料取,不新寫:
   - 文章單字:data/articles.js 各篇的 vocab,依文章等級取(入門:初級;門檻:初級接中級),同級依篇號,篇內依原順序;
     同一個字(原形加詞性)只取第一次出現;
   - 不規則動詞(只有入門):data/verbs.js 依原順序;文章單字裡跟不規則動詞同形的字不重複收。
   每週字數照課程規劃(入門第 1–11 週每週約 20 字、門檻第 1–6、8–11 週每週約 25 字);
   現有字源去掉重複後不夠時,每週等量減少,不補新字。
   字的 id 是字序(從 1 起的整數,字串寫法),一堂的進度鍵用它。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const REPO = path.join(__dirname, '..');
const PLAN = {
  entry: { weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], perWeek: 20, levels: ['初級'], verbs: true, verbsByWeek: { 1: 10, 3: 13 } },
  threshold: { weeks: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11], perWeek: 25, levels: ['初級', '中級'], verbs: false, verbsByWeek: {} },
};

function loadSource() {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['data/articles.js', 'data/verbs.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }));
  return { articles: ctx.TOEIC.articles, verbs: ctx.TOEIC.verbs };
}

const artNo = (id) => { const m = /^art-(\d+)([a-z])$/.exec(id); return m[1] * 100 + m[2].charCodeAt(0); };

function vocabList(articles, levels, verbBases) {
  const seen = new Set(), out = [];
  levels.forEach((lv) => {
    articles.filter((a) => a.level.indexOf(lv) === 0).sort((x, y) => artNo(x.id) - artNo(y.id)).forEach((a) => {
      a.vocab.forEach((v) => {
        const key = v.base.toLowerCase() + '|' + v.pos;
        if (seen.has(key) || verbBases.has(v.base.toLowerCase())) return;
        seen.add(key);
        out.push({ kind: 'vocab', article: a.id, base: v.base, pos: v.pos });
      });
    });
  });
  return out;
}

/* 每週字數:總數平均分給各週,多的字放前面的週(但不超過規劃的每週字數) */
function weekSizes(total, weeks, perWeek) {
  const base = Math.floor(total / weeks.length), extra = total % weeks.length;
  const sizes = weeks.map((w, i) => Math.min(perWeek, base + (i < extra ? 1 : 0)));
  return sizes;
}

/* 入門每週的動詞數:指定週先放,其餘週平分剩下的 */
function verbQuota(sizes, weeks, fixed, verbTotal) {
  const q = weeks.map((w) => (fixed[w] || 0));
  let left = verbTotal - q.reduce((a, b) => a + b, 0);
  const free = weeks.map((w, i) => i).filter((i) => !fixed[weeks[i]]);
  let k = 0;
  while (left > 0) { const i = free[k++ % free.length]; if (q[i] < sizes[i]) { q[i]++; left--; } else if (free.every((j) => q[j] >= sizes[j])) throw new Error('動詞放不下'); }
  return q;
}

function build(level, src) {
  const plan = PLAN[level];
  const verbs = plan.verbs ? src.verbs.map((v) => ({ kind: 'verb', id: v.id })) : [];
  const vb = new Set(plan.verbs ? src.verbs.map((v) => v.base.toLowerCase()) : []);
  const vocab = vocabList(src.articles, plan.levels, vb);
  const sizes = weekSizes(vocab.length + verbs.length, plan.weeks, plan.perWeek);
  const q = verbQuota(sizes, plan.weeks, plan.verbsByWeek, verbs.length);
  const words = [], weeks = {};
  let vi = 0, wi = 0;
  plan.weeks.forEach((w, i) => {
    const from = words.length + 1;
    const nv = sizes[i] - q[i];
    vocab.slice(vi, vi + nv).forEach((x) => words.push(Object.assign({ n: words.length + 1 }, x)));
    verbs.slice(wi, wi + q[i]).forEach((x) => words.push(Object.assign({ n: words.length + 1 }, x)));
    vi += nv; wi += q[i];
    weeks[w] = { from, to: words.length };
  });
  return { schemaVersion: '1.0', level, packVersion: JSON.parse(fs.readFileSync(path.join(REPO, 'data/packs/pack_' + level + '.json'), 'utf8')).packVersion, planned: plan.perWeek, weeks, words };
}

function render(o) {
  const head = JSON.stringify(Object.assign({}, o, { words: undefined })).slice(0, -1);
  return head + ',"words":[\n' + o.words.map((w) => JSON.stringify(w)).join(',\n') + '\n]}\n';
}

function main() {
  const src = loadSource();
  Object.keys(PLAN).forEach((level) => {
    const o = build(level, src);
    fs.writeFileSync(path.join(REPO, 'data/packs/words_' + level + '.json'), render(o));
    const sz = Object.keys(o.weeks).map((w) => o.weeks[w].to - o.weeks[w].from + 1);
    console.log(level + '：' + o.words.length + ' 字；各週 ' + sz.join('、'));
  });
}
module.exports = { build, loadSource, PLAN };
if (require.main === module) main();
