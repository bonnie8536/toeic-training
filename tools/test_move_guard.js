/* 搬家第三輪審查的測試:錯題本同一題留比較新的那份、大鍵不會擋住整次搬家(日誌與備份只存一份、放不下的可以先搬其他的)、
   選了「用舊網址的」卻因為空間不夠沒換時不算搬完、整包的鍵數與帳號數在寄出端就先擋、新網址只有空小雞時直接切到舊網址的學生、
   寫到一半被關之後還原不蓋掉之後新練習的、學生名單裡格式不對的人不收、舊網址不給安裝舊網址的 App。
   共用的假 localStorage 與載入在 tools/fixtures/move_kit.js。用法:node tools/test_move_guard.js */
'use strict';
const vm = require('vm');
const assert = require('assert');
const { read, NOW, DAY, makeStorage, G, R, M, P, A, J, bank, tgt, ctxFor, packOf, moveInto, petWith, histRec } = require('./fixtures/move_kit.js');

const HOUR = 3600e3;
const T = {};
const rec = (ok, t, c) => ({ c: c === undefined ? 0 : c, ok, t });

/* ---------- 錯題本(pool):同一題兩邊都有,留時間比較新的 ---------- */
T['錯題本:同一題兩邊都有,留時間(t)比較新的那份;單字錯題(次數)取大;沒有時間又不一樣的算 dropped'] = () => {
  const out = M.pool({ q1: rec(true, NOW - 10 * DAY), q2: rec(false, NOW - HOUR) }, { q1: rec(false, NOW - HOUR, 2), q2: rec(true, NOW - 5 * DAY), q3: rec(false, NOW) });
  assert.deepEqual(out, { q1: rec(false, NOW - HOUR, 2), q2: rec(false, NOW - HOUR), q3: rec(false, NOW) });
  assert.deepEqual(M.mergeOne('pool', 'vgame_miss', { apple: 1, pear: 4 }, { apple: 3, kiwi: 1 }, { now: NOW }).v, { apple: 3, pear: 4, kiwi: 1 });
  const m = M.mergeOne('pool', 'drill_p5', { q: { c: 1 } }, { q: { c: 2 } }, { now: NOW });
  assert.equal(m.dropped, 1);
  const same = M.mergeOne('pool', 'drill_p5', { q: rec(true, NOW) }, { q: rec(true, NOW) }, { now: NOW });
  assert.equal(same.kind, 'same');
  return 'ok';
};

T['錯題本:新網址答對過、舊網址後來又答錯,搬完是舊網址那份(錯題本看得到),確認畫面不會把它算成「兩邊一樣」'] = async () => {
  const ls = makeStorage(0, { tr_drill_p5: J({ q1: rec(true, NOW - 10 * DAY) }), tr_listen_p1: J({ L1: rec(true, NOW - 10 * DAY) }) });
  const { plan } = await moveInto(ls, { tr_drill_p5: J({ q1: rec(false, NOW - HOUR, 2) }), tr_listen_p1: J({ L1: rec(false, NOW - HOUR, 1) }) });
  assert.deepEqual(JSON.parse(ls.getItem('tr_drill_p5')).q1, rec(false, NOW - HOUR, 2));
  assert.equal(JSON.parse(ls.getItem('tr_listen_p1')).L1.ok, false);
  assert.equal(plan.counts.merged, 2);
  assert.equal(plan.counts.dropped, 0);
  return J(plan.counts);
};

T['再搬一次:搬完之後在舊網址又答了同一題,再搬就換成新的作答'] = async () => {
  const ls = makeStorage(0, {});
  await moveInto(ls, { tr_drill_p5: J({ q1: rec(true, NOW - 5 * DAY), q2: rec(true, NOW - 5 * DAY) }) });
  const { plan } = await moveInto(ls, { tr_drill_p5: J({ q1: rec(false, NOW - 1000, 3), q2: rec(true, NOW - 5 * DAY) }) });
  assert.deepEqual(JSON.parse(ls.getItem('tr_drill_p5')).q1, rec(false, NOW - 1000, 3));
  assert.equal(plan.counts.merged, 1);
  return J(plan.counts);
};

/* ---------- 寫入:日誌與備份只存一份,大鍵不會擋住整次搬家 ---------- */
T['寫入:合併(只會多)的鍵,日誌只記鍵名與寫入值的指紋,不存原值;備份只存被換掉的單一值,而且只存一份'] = () => {
  const big = J([bank('b0', '大題庫', Array.from({ length: 20000 }, (_, i) => 'w' + i))]);
  const ls = makeStorage(0, { tr_vgame_banks: big, tr_diag: J({ s: 1 }) });
  const merged = J(JSON.parse(big).concat([bank('b1', '小', ['a'])]));
  const p = A.prepare(ls, [['tr_vgame_banks', merged, 'grow'], ['tr_diag', J({ s: 2 }), 'replace'], ['tr_hist', '[]', 'add'], ['tr_move_log', '{}', 'add']], NOW, true);
  assert.ok(p.journal.length < 2000, '日誌 ' + p.journal.length + ' 字');
  const bk = p.writes.filter((e) => /^tr_move_backup_/.test(e[0]))[0];
  assert.ok(bk, '有備份');
  assert.deepEqual(JSON.parse(bk[1]).keys, [['tr_diag', J({ s: 1 })]]);
  assert.ok(p.need < merged.length - big.length + 4000, 'need ' + p.need);
  return 'need ' + p.need + ',日誌 ' + p.journal.length;
};

T['空間:新網址已經有一個 280 萬字的題庫,舊網址搬一個小題庫與 3 筆紀錄進來,寫得進去(以前要兩份原值的空間,整個不寫)'] = async () => {
  const words = Array.from({ length: 60700 }, (_, i) => 'w' + i + 'abcdefgh');
  const bigBank = bank('big', '大題庫', words);
  const ls = makeStorage(5200104, { tr_vgame_banks: J([bigBank]) });
  assert.ok(ls.used() > 2.8e6 && ls.used() < 2.9e6, '新網址已經用了 ' + ls.used());
  const { plan } = await moveInto(ls, { tr_vgame_banks: J([bank('s1', '小題庫', ['a', 'b'])]), tr_hist: J([histRec(NOW - 1, 'a'), histRec(NOW - 2, 'b'), histRec(NOW - 3, 'c')]) });
  assert.deepEqual(JSON.parse(ls.getItem('tr_vgame_banks')).map((b) => b.name), ['大題庫', '小題庫']);
  assert.equal(JSON.parse(ls.getItem('tr_hist')).length, 3);
  assert.equal(ls.getItem(A.JOURNAL), null);
  return J(plan.counts) + ' 用了 ' + ls.used();
};

T['空間:真的放不下時,先搬放得下的,沒搬的列出來;這次不算搬完(同一包可以再搬),沒搬的鍵不記成搬過'] = async () => {
  const ls = makeStorage(1400 * 1024, { tr_hist: J([histRec(NOW - 9, 'n')]) });
  const init = { tr_vgame_banks: J([bank('huge', '很大', Array.from({ length: 90000 }, (_, i) => 'x' + i))]), tr_hist: J([histRec(NOW - 1, 'o')]), tr_diag: J({ s: 7 }) };
  const { pack } = packOf(init);
  const hash = await P.hashOf(pack);
  const v = R.validate(JSON.parse(J(pack)), NOW);
  const p1 = M.plan(v, tgt(ls), ctxFor(ls, hash));
  assert.equal(A.apply(ls, p1.writes, { now: NOW }).why, 'space');
  const fit = A.pickFit(ls, p1.writes);
  assert.deepEqual(fit.skip, ['tr_vgame_banks']);
  const p2 = M.plan(v, tgt(ls), ctxFor(ls, hash, { skip: fit.skip }));
  assert.deepEqual(p2.skipped.map((x) => x.label), ['自訂單字題庫']);
  const r = A.apply(ls, p2.writes, { now: NOW });
  assert.ok(r.ok, r.why);
  assert.equal(ls.getItem('tr_vgame_banks'), null);
  assert.equal(JSON.parse(ls.getItem('tr_diag')).s, 7);
  assert.equal(JSON.parse(ls.getItem('tr_hist')).length, 2);
  const p3 = M.plan(v, tgt(ls), ctxFor(ls, hash));
  assert.equal(p3.already, false);
  assert.ok(new Map(p3.writes).has('tr_vgame_banks'));
  return 'ok';
};

/* ---------- 選了「用舊網址的」卻沒換成:不算搬完 ---------- */
T['沒換成「用舊網址的」那幾項(unfinished):這次的雜湊不記成搬過,同一包再來還會問;合併照樣寫'] = async () => {
  const ls = makeStorage(0, { tr_diag: J({ tag: 'NEW' }), tr_hist: J([histRec(NOW - 9, 'n')]) });
  const { pack } = packOf({ tr_diag: J({ tag: 'OLD' }), tr_hist: J([histRec(NOW - 1, 'o')]) });
  const hash = await P.hashOf(pack);
  const v = R.validate(JSON.parse(J(pack)), NOW);
  const p1 = M.plan(v, tgt(ls), ctxFor(ls, hash, { unfinished: true }));
  assert.ok(A.apply(ls, p1.writes, { now: NOW }).ok);
  assert.equal(JSON.parse(ls.getItem('tr_hist')).length, 2);
  const p2 = M.plan(v, tgt(ls), ctxFor(ls, hash, { choices: { tr_diag: 'old' } }));
  assert.equal(p2.already, false);
  assert.deepEqual(p2.conflicts.map((c) => c.key), ['tr_diag']);
  assert.ok(A.apply(ls, p2.writes, { now: NOW }).ok);
  assert.equal(JSON.parse(ls.getItem('tr_diag')).tag, 'OLD');
  assert.equal(M.plan(v, tgt(ls), ctxFor(ls, hash)).already, true);
  return 'ok';
};

T['收件頁:備份放不下時不默默丟掉「用舊網址的」;不送「搬好了」給舊網址;給「下載這台現在的資料」再換'] = () => {
  const src = read('js/move-in-page.js');
  assert.ok(/choices: \{\}, unfinished: chosen\.length > 0/.test(src), '改用沒備份的合併時要標 unfinished');
  assert.ok(/if \(!t\.plan\.skipped\.length && !left\.length\) \{ if \(link\) link\.done\(ctx\.sent\)/.test(src), '沒搬完不送 done');
  /* 回報「搬好了」用寄出頁送來的雜湊(寄出頁比對它);記在 tr_move_log 的連刪除標記 del 一起算(MOVE_PACK.logHash) */
  assert.ok(/hash: P\.logHash\(pack, hash\), sent: hash/.test(src), 'ctx.hash 要用 logHash、ctx.sent 是送來的雜湊');
  assert.ok(!/link\.done\(ctx\.hash\)/.test(src), 'link.done 不能用 logHash(寄出頁會等不到 done)');
  assert.ok(/下載這台現在的資料/.test(src));
  assert.ok(!/「用舊網址的」那幾項維持這台的/.test(src), '不能再說維持這台的就算搬完');
  return 'ok';
};

/* ---------- 鍵數、帳號數:寄出端先擋,收件端的上限放寬 ---------- */
T['鍵數:共用電腦 23 個學生檔案(3000 多個鍵)照樣能搬;真的超過上限時寄出端就列在 tooBig,不會送出去才被拒'] = () => {
  const init = {};
  const profiles = [];
  for (let s = 0; s < 23; s++) {
    const pid = 'pk' + String(s).padStart(4, '0');
    profiles.push({ id: pid, name: '學生' + s });
    for (let a = 0; a < 40; a++) ['read_q_art' + a, 'read_tq_art' + a, 'vocab_art' + a].forEach((k) => { init['tr_u' + pid + '_' + k] = J({ 0: 1 }); });
    ['hist', 'grammar_done', 'phonics_done', 'diag', 'drill_p5', 'listen_p1', 'verb_quiz', 'phrase_drill', 'vgame_miss', 'ear_s', 'ear_d', 'dlg_heard'].forEach((k) => { init['tr_u' + pid + '_' + k] = J({ a: 1 }); });
  }
  init.tr_profiles = J(profiles);
  const { pack, summary } = packOf(init);
  assert.ok(pack.keys.length > 3000, pack.keys.length + ' 個鍵');
  assert.deepEqual(summary.tooBig, []);
  const v = R.validate(JSON.parse(J(pack)), NOW);
  assert.ok(v.ok, v.why);
  const many = {};
  for (let i = 0; i <= R.LIMITS.keys; i++) many['tr_read_q_x' + i] = '1';
  assert.ok(packOf(many).summary.tooBig.length > 0, '超過鍵數上限要列出來');
  const accts = {};
  for (let i = 0; i <= R.LIMITS.accounts; i++) {
    const uid = '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
    accts['tr_unsynced_' + uid] = J({ hist: NOW - 1000 });
    accts['tr_uc' + uid.replace(/-/g, '') + '_hist'] = J([histRec(NOW - 1000, 'x')]);
  }
  assert.ok(packOf(accts).summary.tooBig.length > 0, '超過帳號數上限要列出來');
  return pack.keys.length + ' 個鍵,上限 ' + R.LIMITS.keys;
};

/* ---------- 新網址只有頁面自己建的空小雞:不算有資料 ---------- */
T['目前的學生:新網址只有自動建的空小雞與提示次數,直接切到舊網址的學生檔案,不問'] = async () => {
  const init = { tr_profiles: J([{ id: 'pabc1234', name: '小明' }]), tr_current_profile: J('pabc1234'), tr_upabc1234_hist: J([histRec(NOW - DAY, 'a')]) };
  const ls = makeStorage(0, { tr_pet: J(petWith({})), tr_pet_hint: '1', tr_access_x: '{}', tr_vgame_banks: '[]' });
  const { plan } = await moveInto(ls, init);
  assert.equal(ls.getItem('tr_current_profile'), J('pabc1234'));
  assert.deepEqual(plan.conflicts.map((c) => c.key), []);
  const busy = makeStorage(0, { tr_pet: J(petWith({ '2026-11-01': 3 })) });
  const r2 = await moveInto(busy, init);
  assert.deepEqual(r2.plan.conflicts.map((c) => c.key), ['tr_current_profile']);
  return 'ok';
};

/* ---------- 寫到一半被關 ---------- */
function crashAfter(ls, writes, n) {
  const p = A.prepare(ls, writes, NOW, true);
  ls.setItem(A.JOURNAL, p.journal);
  p.writes.slice(0, n).forEach(([k, v]) => ls.setItem(k, v));
  return p;
}
T['寫到一半被關:15 秒內開的頁面在半途的資料上練習,之後還原不會蓋掉那次練習;被換掉的原值留在備份'] = () => {
  const pre = J([histRec(NOW - DAY, 'pre0')]);
  const ls = makeStorage(0, { tr_hist: pre, tr_diag: J({ s: 1 }) });
  const merged = J([histRec(NOW - DAY, 'pre0'), histRec(NOW - HOUR, 'old1')]);
  const p = crashAfter(ls, [['tr_hist', merged, 'grow'], ['tr_diag', J({ s: 2 }), 'replace'], ['tr_move_log', '{}', 'add']], 99);
  ls.removeItem('tr_move_log');   // 記錄還沒寫就被關
  const realNow = Date.now;
  try {
    G.Date.now = () => NOW + 3000;
    assert.equal(G.moveJournalRecover(ls), 'wait');
    ls.setItem('tr_hist', J(JSON.parse(merged).concat([histRec(NOW + 3000, 'practice-after-crash')])));
    ls.setItem('tr_diag', J({ s: 3 }));
    G.Date.now = () => NOW + 15500 + 3000;
    assert.equal(G.moveJournalRecover(ls), 'restored');
  } finally { G.Date.now = realNow; }
  assert.deepEqual(JSON.parse(ls.getItem('tr_hist')).map((r) => r.id), ['pre0', 'old1', 'practice-after-crash']);
  assert.deepEqual(JSON.parse(ls.getItem('tr_diag')), { s: 3 });
  const bk = JSON.parse(ls.getItem(p.backupKey));
  assert.deepEqual(bk.keys, [['tr_diag', J({ s: 1 })]]);
  assert.equal(ls.getItem(A.JOURNAL), null);
  return 'ok';
};

T['寫到一半被關:之後沒動過的鍵照日誌還原(換掉的換回來、新加的拿掉),合併的鍵留著合併後的樣子'] = () => {
  const ls = makeStorage(0, { tr_hist: J([1]), tr_diag: J({ s: 1 }) });
  const p = crashAfter(ls, [['tr_hist', J([1, 2]), 'grow'], ['tr_diag', J({ s: 2 }), 'replace'], ['tr_vgame_banks', J([bank('b1', 'x', ['a'])]), 'add'], ['tr_move_log', '{}', 'add']], 4);
  const realNow = Date.now;
  try { G.Date.now = () => NOW + 60000; assert.equal(G.moveJournalRecover(ls), 'restored'); } finally { G.Date.now = realNow; }
  assert.equal(ls.getItem('tr_hist'), J([1, 2]));
  assert.equal(ls.getItem('tr_diag'), J({ s: 1 }));
  assert.equal(ls.getItem('tr_vgame_banks'), null);
  assert.equal(ls.getItem('tr_move_log'), null);
  assert.equal(ls.getItem(p.backupKey), null);
  assert.equal(ls.getItem(A.JOURNAL), null);
  return 'ok';
};

T['寫入中途空間不夠(同一個分頁):照記憶體裡的原值全部還原,合併的鍵也回到搬之前,不留日誌與備份'] = () => {
  const ls = makeStorage(0, { tr_hist: J([1]), tr_diag: J({ a: 1 }) });
  const snap = J(ls.dump());
  let n = 0;
  const set = ls.setItem.bind(ls);
  ls.setItem = (k, v) => { if (k === 'tr_new' && ++n) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } return set(k, v); };
  const r = A.apply(ls, [['tr_hist', J([1, 2]), 'grow'], ['tr_diag', J({ a: 2 }), 'replace'], ['tr_new', '1', 'add'], ['tr_move_log', '{}', 'add']], { now: NOW });
  assert.equal(r.ok, false);
  assert.equal(J(ls.dump()), snap);
  return J(r);
};

/* ---------- 學生名單 ---------- */
T['惡意搬家檔:學生名單裡編號不對(雲端資料夾編號、空字串)、重複、名字不是字串的人不收;名單不是陣列整包拒絕'] = () => {
  const bad = [{ id: 'pabcd1', name: 42 }, { id: 'c0123456789abcdef0123456789abcdef', name: '小明' }, { id: '', name: { x: 1 } }, { id: 'pabcd1', name: '重複' }, { id: 'pgood1', name: '好', created: '2026-10-01', x: { y: 1 } }];
  const pack = { app: 'rushup-move', v: 1, keys: [['tr_profiles', J(bad)], ['tr_current_profile', J('pabcd1')]], accounts: {} };
  const v = R.validate(pack, NOW);
  assert.ok(v.ok, v.why);
  const list = JSON.parse(v.keys.filter((e) => e[0] === 'tr_profiles')[0][1]);
  assert.deepEqual(list.map((p) => p.id), ['pabcd1', 'pgood1']);
  list.forEach((p) => assert.equal(typeof p.name, 'string'));
  assert.deepEqual(list[1], { id: 'pgood1', name: '好', created: '2026-10-01' });
  const ls = makeStorage(0, { tr_profiles: J([{ id: 'pzzzz1', name: '原本' }]) });
  const plan = M.plan(v, tgt(ls), ctxFor(ls));
  const wrote = JSON.parse(new Map(plan.writes).get('tr_profiles'));
  assert.deepEqual(wrote.map((p) => p.id), ['pzzzz1', 'pabcd1', 'pgood1']);
  assert.deepEqual(M.profiles([{ id: 'pzzzz1', name: '原本' }], [{ id: 'c0123456789abcdef0123456789abcdef', name: 'x' }, { id: 'pq1234', name: 5 }, { id: 'pq5678', name: '甲' }, { id: 'pq5678', name: '乙' }]).map((p) => p.id), ['pzzzz1', 'pq5678']);
  const notArr = R.validate({ app: 'rushup-move', v: 1, keys: [['tr_profiles', J({ id: 'pabcd1' })]], accounts: {} }, NOW);
  assert.equal(notArr.ok, false);
  return J(list);
};

/* ---------- 舊網址不給安裝舊網址的 App ---------- */
function shellAt(origin) {
  const el = () => ({ classList: { contains: () => false, add() {}, remove() {} }, setAttribute() {}, appendChild() {}, append() {}, addEventListener() {}, style: {} });
  const win = {
    document: { documentElement: el(), body: el(), createElement: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile', platform: 'Linux', maxTouchPoints: 5 },
    location: { pathname: '/grammar.html', search: '', origin, href: origin + '/grammar.html' },
    matchMedia: (q) => ({ matches: q === '(pointer: coarse)' }),
    addEventListener() {}, console: { warn() {}, log() {}, error() {} }, Promise, setTimeout, clearTimeout,
    __bip: { prompt() { return Promise.resolve(); } },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(read('js/app-shell.js'), win);
  return win;
}
T['安裝:重疊期的舊網址(Android 有安裝事件)不給「安裝到手機」;新網址照常給'] = () => {
  assert.equal(shellAt('https://www.shuashualanguage.com').APP.canOfferInstall(), false);
  assert.equal(shellAt('http://127.0.0.1:8931').APP.canOfferInstall(), false);
  assert.equal(shellAt('https://www.rushuplanguage.com').APP.canOfferInstall(), true);
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
