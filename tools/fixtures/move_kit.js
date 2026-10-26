/* 搬家測試共用的東西(tools/test_move_core.js、tools/test_move_guard.js):假的 localStorage(可以設容量)、
   在 vm 裡載入真的 js/common.js、js/pet*.js、js/daily.js、js/sync-merge.js(題庫、刪除標記、模擬考紀錄跟同步共用的合併)、js/move-*.js,組包、驗證、合併、寫入一次做完的 moveInto。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const NOW = Date.parse('2026-11-05T13:00:00+08:00');
const DAY = 864e5;
const FROM = 'https://www.shuashualanguage.com';
const UID = '3f2b8c1e-7d4a-4b9e-9c21-5a6e8f0d1b72';
const CPID = 'c' + UID.replace(/-/g, '');

/* 假的 localStorage:quota 是字元數(鍵加值),超過丟 QuotaExceededError;log 記每一次寫入 */
function makeStorage(quota, init) {
  const m = new Map(Object.entries(init || {}));
  const used = () => { let n = 0; m.forEach((v, k) => { n += k.length + v.length; }); return n; };
  const s = {
    log: [], failAt: -1, writes: 0,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      v = String(v);
      s.writes++;
      if (s.failAt > -1 && s.writes === s.failAt) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      const was = m.has(k) ? k.length + m.get(k).length : 0;
      if (quota && used() - was + k.length + v.length > quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, v); s.log.push(['set', k]);
    },
    removeItem(k) { m.delete(k); s.log.push(['remove', k]); },
    key: (i) => { const a = Array.from(m.keys()); return i < a.length ? a[i] : null; },
    get length() { return m.size; },
    dump: () => Object.fromEntries(m),
    used,
  };
  return s;
}

function load() {
  const ctx = {
    console, crypto: globalThis.crypto, TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream,
    atob, btoa, Date, Math, JSON, URLSearchParams,
    localStorage: makeStorage(), document: { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['js/common.js', 'js/pet-config.js', 'js/pet.js', 'js/pet-food.js', 'js/daily.js', 'js/sync-merge.js', 'js/move-rules.js', 'js/move-merge.js', 'js/move-pack.js', 'js/move-apply.js', 'js/move-link.js']
    .forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  return ctx;
}
const G = load();
const { MOVE_RULES: R, MOVE_MERGE: M, MOVE_PACK: P, MOVE_APPLY: A, PET, DAILY, SYNC_MERGE: SM } = G;
const J = (x) => JSON.stringify(x);
const bank = (id, name, words) => ({ id, name, words: words.map((w) => ({ en: w, zh: '中' + w })) });
const tgt = (ls) => ({ get: (k) => ls.getItem(k), keys: Object.keys(ls.dump()) });
const ctxFor = (ls, hash, extra) => Object.assign({ now: NOW, from: FROM, hash: hash || 'h1', pet: PET, petClockOk: true, daily: DAILY,
  log: JSON.parse(ls.getItem('tr_move_log') || '{}'), choices: {} }, extra || {});
const DEV_A = 'a1a1a1a1a1a1a1a1', DEV_B = 'b2b2b2b2b2b2b2b2';
function packOf(init, opt) {
  const ls = makeStorage(0, init);
  return P.collect(ls, Object.assign({ from: FROM, now: NOW, device: DEV_A }, opt || {}));
}
async function moveInto(newLs, init, extra, packOpt) {
  const { pack } = packOf(init, packOpt);
  const hash = await P.hashOf(pack);
  const v = R.validate(JSON.parse(J(pack)), NOW);
  assert.ok(v.ok, 'validate ' + v.why);
  const plan = M.plan(v, tgt(newLs), ctxFor(newLs, P.logHash(pack, hash), extra));   // 跟 js/move-in-page.js 一樣:記在 tr_move_log 的連 del 一起算
  if (!plan.already) { const r = A.apply(newLs, plan.writes, { now: NOW }); assert.ok(r.ok, 'apply ' + r.why); }
  return { plan, hash, pack };
}
function petWith(days, name) { return { v: 1, born: '2026-10-01', goals: [], days, met: [], fed: {}, oldMet: 0, name: name || '' }; }
function histRec(t, id, ok) { return { m: 'p5', id, c: 1, ok: !!ok, t }; }

module.exports = { REPO, read, NOW, DAY, FROM, UID, CPID, makeStorage, load, G, R, M, P, A, PET, DAILY, SM, J, bank, tgt, ctxFor, DEV_A, DEV_B, packOf, moveInto, petWith, histRec };
