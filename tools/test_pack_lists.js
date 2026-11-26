/* 每週新字表(data/packs/words_*.json)、小檢核可用題清單(data/packs/checkpoint_pool.json)與 tools/check_pack_lists.js。
   用法:node tools/test_pack_lists.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const copy = (x) => JSON.parse(JSON.stringify(x));
const L = require('./check_pack_lists.js');
const { build, loadSource } = require('./gen_words.js');
const SRC = L.loadSources();
const PACKS = { entry: JSON.parse(read('data/packs/pack_entry.json')), threshold: JSON.parse(read('data/packs/pack_threshold.json')) };
const WORDS = { entry: JSON.parse(read('data/packs/words_entry.json')), threshold: JSON.parse(read('data/packs/words_threshold.json')) };
const POOL = JSON.parse(read('data/packs/checkpoint_pool.json'));
const errs = (r) => r.errors.join('｜');
const T = {};

T['W1 兩份新字表通過檢查;字序連號、跟學習包版本一致;重跑產生器內容相同'] = () => {
  ['entry', 'threshold'].forEach((lv) => {
    assert.deepEqual(L.checkWords(WORDS[lv], PACKS[lv], SRC).errors, []);
    assert.strictEqual(WORDS[lv].packVersion, PACKS[lv].packVersion);
    assert.deepEqual(copy(build(lv, loadSource())), WORDS[lv]);
  });
};

T['W2 週次:入門第 1–11 週、門檻第 1–6、8–11 週(第 7 週不給新字);每週不超過規劃;入門第 1 週動詞 10 個、第 3 週動詞過半'] = () => {
  assert.deepEqual(Object.keys(WORDS.entry.weeks).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(Object.keys(WORDS.threshold.weeks).map(Number), [1, 2, 3, 4, 5, 6, 8, 9, 10, 11]);
  ['entry', 'threshold'].forEach((lv) => Object.values(WORDS[lv].weeks).forEach((r) => assert.ok(r.to - r.from + 1 <= WORDS[lv].planned)));
  const verbsIn = (w) => WORDS.entry.words.filter((x) => x.n >= WORDS.entry.weeks[w].from && x.n <= WORDS.entry.weeks[w].to && x.kind === 'verb').length;
  assert.strictEqual(verbsIn(1), 10);
  assert.ok(verbsIn(3) > 9);
  assert.strictEqual(WORDS.entry.words.filter((x) => x.kind === 'verb').length, 118);
};

T['W3 門檻的字:初級文章的字在前、中級在後;兩份新字表都沒有同形同詞性的字出現兩次'] = () => {
  const arts = loadSource().articles, lvOf = new Map(arts.map((a) => [a.id, a.level.slice(0, 2)]));
  const lv = WORDS.threshold.words.map((w) => lvOf.get(w.article));
  assert.strictEqual(lv.indexOf('中級'), lv.lastIndexOf('初級') + 1);
  ['entry', 'threshold'].forEach((l) => {
    const keys = WORDS[l].words.filter((w) => w.kind === 'vocab').map((w) => w.base.toLowerCase() + '|' + w.pos);
    assert.strictEqual(new Set(keys).size, keys.length);
  });
};

T['W4 新字表的毛病抓得到:字序跳號、重複的字、站上沒有的字、版本不符、週次接不起來、超過規劃、少於規劃只提醒'] = () => {
  const mut = (f) => { const w = copy(WORDS.entry); f(w); return L.checkWords(w, PACKS.entry, SRC); };
  assert.match(errs(mut((w) => { w.words[5].n = 99; })), /要連號/);
  assert.match(errs(mut((w) => { w.words[1] = Object.assign({}, w.words[0], { n: 2 }); })), /重複/);
  assert.match(errs(mut((w) => { w.words[0].base = 'zzzz'; })), /找不到/);
  assert.match(errs(mut((w) => { w.packVersion = '9.9.9'; })), /packVersion/);
  assert.match(errs(mut((w) => { w.weeks[2].from += 1; })), /接在/);
  assert.match(errs(mut((w) => { w.planned = 10; })), /超過規劃/);
  assert.match(errs(mut((w) => { delete w.weeks[11]; })), /沒有涵蓋/);
  const r = mut((w) => { w.planned = 25; });
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.length === 1 && /少於規劃/.test(r.warnings[0]));
  assert.match(errs(L.checkWords({ weeks: {} }, PACKS.entry, SRC)), /格式/);
};

T['P1 題目清單通過檢查;id 都在題目索引、都不在淘汰名單、七個 Part 都有題;只放 id'] = () => {
  ['entry', 'threshold'].forEach((lv) => assert.deepEqual(L.checkPool(POOL, SRC, PACKS[lv]).errors, []));
  assert.deepEqual(Object.keys(POOL).sort(), ['ids', 'v']);
  assert.ok(POOL.ids.every((x) => typeof x === 'string'));
  assert.ok(POOL.ids.length > 400);
};

T['P2 清單的內容:後來改過唸讀文字的聽力題(P1、P2 的選項會唸出來)與淘汰的題不在清單;題號從更正紀錄與淘汰名單推算'] = () => {
  const rows = JSON.parse(read('tools/corrections/source.json')).rows.concat(JSON.parse(read('data/corrections.json')).rows);
  const changed = [...new Set(rows.filter((r) => /^P[12]$/.test(r.a) && r.k === 'text').map((r) => String(r.id).split(':')[0]))];
  assert.ok(changed.length > 0, '更正紀錄裡要有改過文字的 P1、P2 題');
  changed.concat([...SRC.retired]).forEach((id) => assert.ok(POOL.ids.indexOf(id) < 0, id));
  assert.ok(POOL.ids.some((id) => /^l[12]-/.test(id)), '清單裡要有 P1、P2 的題');
};

T['P3 清單的毛病抓得到:重複、不在索引、在淘汰名單、少一個 Part、格式不對、題量不夠只提醒'] = () => {
  const mut = (f) => { const p = copy(POOL); f(p); return L.checkPool(p, SRC, null); };
  assert.match(errs(mut((p) => p.ids.push(p.ids[0]))), /重複/);
  assert.match(errs(mut((p) => p.ids.push('p5-zzz'))), /不在題目索引/);
  const retiredId = [...SRC.retired][0];
  const fake = { bank: SRC.bank.concat([{ id: retiredId, part: '1' }]), retired: SRC.retired };
  assert.match(errs(L.checkPool({ v: 1, ids: POOL.ids.concat(retiredId) }, fake, null)), /淘汰名單/);
  assert.match(errs(mut((p) => { p.ids = p.ids.filter((id) => !/^p7-/.test(id)); })), /Part 7 沒有/);
  assert.match(errs(L.checkPool({ ids: [] }, SRC, null)), /格式/);
  const keep = POOL.ids.filter((id) => /^l2-/.test(id)).slice(0, 2);
  const small = L.checkPool({ v: 1, ids: POOL.ids.filter((id) => !/^l2-/.test(id)).concat(keep) }, SRC, PACKS.entry);
  assert.ok(small.warnings.some((m) => /Part 2/.test(m)), small.warnings.join('｜'));
};

T['E1 引擎讀得到:真的新字表轉成每週字序,真的清單餵給第 4 堂小檢核選得出題'] = async () => {
  const ctx = { console, Promise, Map, Set, JSON, Object, Array, Math, Number, String, Date, TypeError, Error, isNaN, TextEncoder };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['data/bank-meta.js', 'data/ear.js', 'js/move-rules.js', 'js/move-merge.js', 'js/lesson-rules.js', 'js/bank.js', 'js/pack-util.js', 'js/pack-core.js'].forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  const P = ctx.PACK_CORE, W = WORDS.entry;
  const weekWords = (week, which) => {
    const w = which === 'this_week' ? week : which === 'last_week' ? week - 1 : week - 3, r = W.weeks[w];
    return r ? Array.from({ length: r.to - r.from + 1 }, (_, i) => String(r.from + i)) : [];
  };
  const lv = { listening: 'entry', reading: 'entry' };
  const mk = () => ({ bank: ctx.BANK, records: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} }, seen: [], ear: ctx.TOEIC.ear, earRecords: {}, weekWords, random: () => 0.5, now: 1764000000, checkpointPool: POOL.ids });
  const l2 = P.compose(PACKS, lv, 2);
  const r2 = await P.pickFixed(l2, P.newState(l2, 1764000000), mk());
  assert.deepEqual(r2.need, []);
  const l4 = P.compose(PACKS, lv, 4);
  const r4 = await P.pickFixed(l4, P.newState(l4, 1764000000), mk());
  assert.deepEqual(r4.need, []);
  const inPool = new Set(POOL.ids);
  const cp = l4.segments.filter((s) => s.slot === 'checkpoint')[0];
  const bank = cp.blocks.filter((b) => !b.fill && /^p[1-7]$/.test(b.module));
  assert.ok(bank.length > 0);
  bank.forEach((b) => r4.state.pk[b.idx].ids.forEach((id) => assert.ok(inPool.has(id), id)));
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let detail = '', ok = true;
    try { await T[name](); } catch (e) { ok = false; detail = e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e); }
    if (ok) pass++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  →  ' + detail.slice(0, 400) : ''));
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
