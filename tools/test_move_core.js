/* 搬家(搬家計畫第二節)的純計算測試:挑鍵、搬家包、雜湊、收件端驗證、合併規則、題庫、重搬、寫入日誌與空間、搬家碼與搬家檔。
   載入真的 js/move-rules.js、js/move-merge.js、js/move-pack.js、js/move-apply.js、js/common.js(日誌還原),
   小雞與每日練習用真的 js/pet.js、js/pet-food.js、js/daily.js。假的 localStorage 可以設容量。
   共用的假 localStorage 與載入在 tools/fixtures/move_kit.js。用法:node tools/test_move_core.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const K = require('./fixtures/move_kit.js');
const { REPO, read, NOW, DAY, FROM, UID, CPID, makeStorage, G, R, M, P, A, PET, DAILY, SM, J, bank, tgt, ctxFor, DEV_A, DEV_B, packOf, moveInto, petWith, histRec } = K;

const T = {};

/* ---------- 挑鍵 ---------- */
T['挑鍵:tr_unsynced_ 不會被當成學生資料夾;雲端帳號資料夾不搬;本機學生要在名單裡;sb- 與暫時的鍵不搬'] = () => {
  const ids = new Set(['pabc123']);
  const c = (k) => R.classify(k, ids).kind;
  assert.equal(c('tr_unsynced_' + UID), 'skip');
  assert.equal(c('tr_unsynced_x'), 'skip');
  assert.equal(c('tr_u' + CPID + '_hist'), 'cloud');
  assert.equal(c('tr_upabc123_hist'), 'profile');
  assert.equal(c('tr_upzzz999_hist'), 'unknown');
  assert.equal(c('tr_hist'), 'guest');
  assert.equal(c('tr_read_q_art-1a'), 'guest');
  assert.equal(c('tr_drill_p5'), 'guest');
  assert.equal(c('sb-ydz-auth-token'), 'skip');
  ['tr_access_' + UID, 'tr_trial_note_closed', 'tr_signup_intent', 'tr_pending_join', 'tr_move_done', 'tr_move_log', 'tr_localonly_' + UID].forEach((k) => assert.equal(c(k), 'skip', k));
  assert.equal(c('tr_profiles'), 'global');
  assert.equal(c('tr_whatever_new'), 'unknown');
  return '全部對';
};

T['搬家包:沒有 sb-、access_token、refresh_token、tr_access_、tr_unsynced_;認不得的與讀不懂的列在摘要;組包時一個鍵都不改不刪'] = () => {
  const init = {
    'sb-ydz-auth-token': J({ access_token: 'aaa', refresh_token: 'rrr' }), 'sb-ydz-auth-token-code-verifier': 'x',
    ['tr_access_' + UID]: J({ at: 1 }), ['tr_unsynced_' + UID]: J({ hist: NOW - 1000 }), ['tr_u' + CPID + '_hist']: J([histRec(NOW - 1000, 'q1')]),
    tr_hist: J([histRec(NOW - 5000, 'q2', true)]), tr_vgame_banks: J([bank('b1', '我的題庫', ['apple'])]), tr_pet: J(petWith({ '2026-11-04': 12 })),
    tr_mystery: J(1), tr_drill_p5: '{broken', tr_profiles: J([{ id: 'pabc123', name: '小明' }]), tr_upabc123_grammar_done: J({ g1: true }),
    tr_upother1_hist: J([]), other_site_key: 'x',
  };
  const ls = makeStorage(0, init);
  const before = J(ls.dump());
  const { pack, summary } = P.collect(ls, { from: FROM, now: NOW });
  assert.equal(J(ls.dump()), before);
  assert.equal(ls.log.length, 0);
  const s = J(pack);
  ['sb-', 'access_token', 'refresh_token', 'tr_access_', 'tr_unsynced_', 'other_site_key'].forEach((w) => assert.equal(s.indexOf(w), -1, w));
  assert.deepEqual(pack.keys.map((e) => e[0]), ['tr_hist', 'tr_pet', 'tr_profiles', 'tr_upabc123_grammar_done', 'tr_vgame_banks']);
  assert.deepEqual(Object.keys(pack.accounts), [UID]);
  assert.equal(pack.accounts[UID][0][0], 'hist');
  assert.equal(summary.unknown, 2);   // tr_mystery、tr_upother1_hist
  assert.equal(summary.unreadable, 1);
  assert.deepEqual(summary.banks, ['我的題庫']);
  assert.ok(summary.pet && summary.hasData);
  return J(summary);
};

T['摘要:只有頁面自己建的空小雞、提示次數、目前檔案是訪客時,算「沒有要搬的」'] = () => {
  const { summary } = packOf({ tr_pet: J(petWith({})), tr_pet_hint: '2', tr_current_profile: 'null', tr_ph_slow: 'false' });
  assert.equal(summary.hasData, false);
  const { summary: s2 } = packOf({ tr_pet: J(petWith({ '2026-11-01': 3 })) });
  assert.equal(s2.hasData, true);
  return 'ok';
};

/* ---------- 雜湊 ---------- */
T['雜湊:同內容不同 at、不同鍵順序,雜湊一樣;內容改一個字就不一樣'] = async () => {
  const a = packOf({ tr_hist: J([histRec(1, 'a')]), tr_diag: J({ done: true }) }).pack;
  const b = Object.assign({}, a, { at: '2030-01-01T00:00:00.000Z', from: 'x', keys: a.keys.slice().reverse() });
  assert.equal(await P.hashOf(a), await P.hashOf(b));
  const c = Object.assign({}, a, { keys: [['tr_hist', J([histRec(2, 'a')])], a.keys[0]] });
  assert.notEqual(await P.hashOf(a), await P.hashOf(c));
  assert.match(await P.hashOf(a), /^[0-9a-f]{64}$/);
  return 'ok';
};

/* ---------- 收件端驗證 ---------- */
T['惡意搬家檔:sb- 鍵、tr_access_、雲端資料夾、__proto__ 帳號、不是 UUID、超大鍵、整包太大、非字串、讀不懂、重複鍵、認不得的鍵,全部整包拒絕'] = () => {
  const base = () => ({ app: 'rushup-move', v: 1, keys: [['tr_hist', '[]']], accounts: {} });
  const cases = {
    sb: (p) => { p.keys.push(['sb-ydz-auth-token', J({ access_token: 'evil' })]); },
    access: (p) => { p.keys.push(['tr_access_' + UID, '{}']); },
    cloudFolder: (p) => { p.keys.push(['tr_u' + CPID + '_hist', '[]']); },
    unsynced: (p) => { p.keys.push(['tr_unsynced_' + UID, '{}']); },
    proto: (p) => { p.accounts = JSON.parse('{"__proto__":[["hist","[]",1]]}'); },
    notUuid: (p) => { p.accounts = { abc: [['hist', '[]', 1]] }; },
    acctBadKey: (p) => { p.accounts = { [UID]: [['sb-x', '[]', 1]] }; },
    acctTime: (p) => { p.accounts = { [UID]: [['hist', '[]', 1.5]] }; },
    bigKey: (p) => { p.keys.push(['tr_diag', J('x'.repeat(R.LIMITS.key + 1))]); },
    total: (p) => { for (let i = 0; i < 5; i++) p.keys.push(['tr_read_q_a' + i, J('x'.repeat(R.LIMITS.key - 10))]); },
    nonString: (p) => { p.keys.push(['tr_diag', { a: 1 }]); },
    unparse: (p) => { p.keys.push(['tr_diag', '{x']); },
    dup: (p) => { p.keys.push(['tr_hist', '[]']); },
    unknown: (p) => { p.keys.push(['tr_whatever', '1']); },
    profileNotListed: (p) => { p.keys.push(['tr_upabc123_hist', '[]']); },
    wrongApp: (p) => { p.app = 'toeic-reading-room'; },
  };
  const out = [];
  Object.keys(cases).forEach((name) => {
    const p = base(); cases[name](p);
    const r = R.validate(p, NOW);
    assert.equal(r.ok, false, name);
    out.push(name + ':' + r.why);
  });
  assert.ok(R.validate(base(), NOW).ok);
  return out.join(' / ');
};

T['收件端驗證:帳號的時間夾在 0 到收件當下;未來時間不會蓋掉雲端;帳號清單用 Map'] = () => {
  const r = R.validate({ app: 'rushup-move', v: 1, keys: [], accounts: { [UID]: [['vgame_banks', '[]', NOW + 365 * DAY], ['hist', '[]', -5]] } }, NOW);
  assert.ok(r.ok);
  assert.equal(Object.prototype.toString.call(r.accounts), '[object Map]');
  assert.deepEqual(r.accounts.get(UID).map((e) => e[2]), [NOW, 0]);
  return 'ok';
};

T['題庫名稱含 <img onerror>:驗證照收(只是資料),收件頁與寄出頁只用 textContent 顯示'] = () => {
  const p = { app: 'rushup-move', v: 1, keys: [['tr_vgame_banks', J([bank('b1', '<img src=x onerror=alert(1)>', ['a'])])]], accounts: {} };
  assert.ok(R.validate(p, NOW).ok);
  ['js/move-in-page.js', 'js/move-out-page.js', 'js/move-out.js', 'js/move-in-boot.js'].forEach((f) => {
    const src = read(f);
    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), false, f + ' 用了會解析 HTML 的寫法');
  });
  return 'ok';
};

/* ---------- 合併規則 ---------- */
T['hist:取聯集、同一筆去重、照時間排、只留 60 天內、最多 1500 筆'] = () => {
  const a = [histRec(NOW - 3 * DAY, 'a'), histRec(NOW - 1 * DAY, 'b')];
  const b = [histRec(NOW - 1 * DAY, 'b'), histRec(NOW - 2 * DAY, 'c'), histRec(NOW - 70 * DAY, 'old')];
  const v = M.hist(a, b, NOW);
  assert.deepEqual(v.map((r) => r.id), ['a', 'c', 'b']);
  const many = Array.from({ length: 1600 }, (_, i) => histRec(NOW - i * 1000, 'm' + i));
  const w = M.hist([], many, NOW);
  assert.equal(w.length, 1500);
  assert.equal(w[w.length - 1].id, 'm0');
  return 'ok';
};

T['mock_history:取聯集、同一次去重、照完成時間排、留最後 30 筆'] = () => {
  const r = (d, s) => ({ d, size: 'full', lRaw: s, lTotal: 100, rRaw: s, rTotal: 100, lScore: s, rScore: s });
  const a = Array.from({ length: 20 }, (_, i) => r('2026-10-' + String(i + 1).padStart(2, '0') + 'T00:00:00Z', i));
  const b = Array.from({ length: 20 }, (_, i) => r('2026-09-' + String(i + 1).padStart(2, '0') + 'T00:00:00Z', i)).concat([a[0]]);
  const v = M.mock(a, b);
  assert.equal(v.length, 30);
  assert.equal(v[29].d, a[19].d);
  assert.equal(v[0].d, b[10].d);
  return 'ok';
};

T['錯題池與完成紀錄取聯集;最佳成績取大;翻牌步數少的好;通關次數取大、最快取小;學生名單用編號合併'] = () => {
  assert.deepEqual(M.pool({ q1: { c: 1 }, q2: 1 }, { q2: 9, q3: 2 }), { q1: { c: 1 }, q2: 9, q3: 2 });   // 單字錯題的次數取大(同一題留比較新的見 test_move_guard.js)
  assert.deepEqual(M.idmap({ g1: true, g2: false, d: [1, 3] }, { g2: true, g3: true, d: [2, 3] }), { g1: true, g2: true, d: [1, 2, 3], g3: true });
  assert.deepEqual(M.idmap({ q: { ok: false, t: 1 } }, { q: { ok: true, t: 5 } }), { q: { ok: true, t: 5 } });
  assert.deepEqual(M.best({ a: 10, b: 30 }, { a: 20, b: 5, c: 1 }), { a: 20, b: 30, c: 1 });
  assert.deepEqual(M.pairsBest({ k: { moves: 20, secs: 50 } }, { k: { moves: 18, secs: 90 } }), { k: { moves: 18, secs: 90 } });
  assert.deepEqual(M.pairsBest({ k: { moves: 18, secs: 50 } }, { k: { moves: 18, secs: 90 } }), { k: { moves: 18, secs: 50 } });
  assert.deepEqual(M.clear({ k: { n: 2, secs: 80 } }, { k: { n: 5, secs: 95 } }), { k: { n: 5, secs: 80 } });
  assert.deepEqual(M.profiles([{ id: 'pabc01', name: '新' }], [{ id: 'pabc01', name: '舊' }, { id: 'pabc02', name: '乙' }]), [{ id: 'pabc01', name: '新' }, { id: 'pabc02', name: '乙' }]);
  const done = M.idmap({ 'bank:b1': ['a', 'b'] }, { 'bank:b1': Array.from({ length: 400 }, (_, i) => 'w' + i) }, 'vgame_done');
  assert.equal(done['bank:b1'].length, 300);
  return 'ok';
};

T['單一值:兩邊不同留新網址的、列出來問;選「用舊網址的」才換,被換掉的先備份;壞掉的 JSON 列為衝突'] = async () => {
  const ls = makeStorage(0, { tr_diag: J({ done: true, score: 10 }), tr_ph_slow: '{bad' });
  const { pack } = packOf({ tr_diag: J({ done: true, score: 20 }), tr_ph_slow: 'true' });
  const v = R.validate(pack, NOW);
  const p1 = M.plan(v, tgt(ls), ctxFor(ls, 'h1'));
  assert.deepEqual(p1.conflicts.map((c) => [c.key, c.why, c.choosable]), [['tr_diag', 'single', true], ['tr_ph_slow', 'broken', true]]);
  assert.deepEqual(p1.writes.map((e) => e[0]), ['tr_move_log']);
  const p2 = M.plan(v, tgt(ls), ctxFor(ls, 'h1', { choices: { tr_diag: 'old' } }));
  assert.deepEqual(p2.writes.map((e) => e[0]), ['tr_diag', 'tr_move_log']);
  const r = A.apply(ls, p2.writes, { now: NOW });
  assert.ok(r.ok);
  assert.equal(JSON.parse(ls.getItem('tr_diag')).score, 20);
  const bk = JSON.parse(ls.getItem('tr_move_backup_' + NOW));
  assert.deepEqual(bk.keys, [['tr_diag', J({ done: true, score: 10 })]]);
  return 'ok';
};

T['小雞:用真的 PET.cloudMerge 合併(兩邊的天數都在);時鐘對不上就不合併、列為衝突、留新網址的'] = () => {
  const ls = makeStorage(0, { tr_pet: J(petWith({ '2026-11-04': 5 })) });
  const v = R.validate(packOf({ tr_pet: J(petWith({ '2026-11-01': 25, '2026-11-02': 30 }, '小黃')) }).pack, NOW);
  const p = M.plan(v, tgt(ls), ctxFor(ls));
  const w = new Map(p.writes);
  const pet = JSON.parse(w.get('tr_pet'));
  assert.deepEqual(Object.keys(pet.days).sort(), ['2026-11-01', '2026-11-02', '2026-11-04']);
  const p2 = M.plan(v, tgt(ls), ctxFor(ls, 'h1', { petClockOk: false }));
  assert.equal(new Map(p2.writes).has('tr_pet'), false);
  assert.deepEqual(p2.conflicts.map((c) => c.why), ['clock']);
  return J(pet.days);
};

T['每日練習:用真的 DAILY.merge 取聯集'] = () => {
  const today = DAILY.dateOf(NOW);
  const ls = makeStorage(0, { tr_daily_done: J({ [today]: { d: { a: 1 } } }) });
  const v = R.validate(packOf({ tr_daily_done: J({ [today]: { v: { b: 0 } } }) }).pack, NOW);
  const w = new Map(M.plan(v, tgt(ls), ctxFor(ls)).writes);
  assert.deepEqual(JSON.parse(w.get('tr_daily_done')), { [today]: { d: { a: 1 }, v: { b: 0 } } });
  return 'ok';
};

T['新網址自動建的空小雞與設定,不會贏過舊網址的真資料(依形狀合併,不是「留新網址的」)'] = async () => {
  const ls = makeStorage(0, { tr_pet: J(petWith({})), tr_hist: '[]', tr_vgame_banks: '[]', tr_pet_hint: '1' });
  await moveInto(ls, { tr_pet: J(petWith({ '2026-11-03': 40 }, '小黃')), tr_hist: J([histRec(NOW - DAY, 'x')]), tr_vgame_banks: J([bank('b1', '單字一', ['a', 'b'])]), tr_pet_hint: '3' });
  assert.equal(JSON.parse(ls.getItem('tr_hist')).length, 1);
  assert.equal(JSON.parse(ls.getItem('tr_vgame_banks'))[0].name, '單字一');
  assert.equal(JSON.parse(ls.getItem('tr_pet')).days['2026-11-03'], 40);
  assert.equal(ls.getItem('tr_pet_hint'), '1');
  return 'ok';
};

/* ---------- 題庫 ---------- */
T['題庫:只有一邊有的都留;同 id 同內容跳過;不同 id 但內容一樣跳過;同 id 不同內容改新 id、加「（舊網址）」,成績與通關跟著複製'] = async () => {
  const ls = makeStorage(0, {
    tr_vgame_banks: J([bank('b1', '共同', ['a']), bank('b2', '新網址自己的', ['n']), bank('b9', '內容一樣', ['same'])]),
    tr_vgame_best: J({ 'bank:b1': 5 }),
  });
  const { plan } = await moveInto(ls, {
    tr_vgame_banks: J([bank('b1', '共同', ['a', 'z']), bank('b3', '舊網址自己的', ['o']), bank('b7', '內容一樣', ['same'])]),
    tr_vgame_best: J({ 'bank:b1': 9, 'bank:b1:e2z': 4, word: 3 }), tr_vgame_clear: J({ 'bank:b1': { n: 2, secs: 40 } }),
    tr_vgame_pairs_best: J({ 'bank:b1:8': { moves: 12, secs: 30 } }), tr_vgame_toast_best: J({ 'bank:b1': 7 }),
    tr_vgame_done: J({ 'bank:b1': ['a'] }), tr_vgame_src: J({ mode: 'bank:b1', level: '全部' }),
  });
  const banks = JSON.parse(ls.getItem('tr_vgame_banks'));
  assert.deepEqual(banks.map((b) => b.name), ['共同', '新網址自己的', '內容一樣', '共同（舊網址）', '舊網址自己的']);
  const nid = banks[3].id;
  assert.notEqual(nid, 'b1');
  assert.equal(plan.banks.skipped, 1);
  const best = JSON.parse(ls.getItem('tr_vgame_best'));
  assert.deepEqual(best, { 'bank:b1': 9, ['bank:' + nid]: 9, ['bank:' + nid + ':e2z']: 4, 'bank:b1:e2z': 4, word: 3 });
  assert.deepEqual(JSON.parse(ls.getItem('tr_vgame_clear'))['bank:' + nid], { n: 2, secs: 40 });
  assert.deepEqual(JSON.parse(ls.getItem('tr_vgame_pairs_best'))['bank:' + nid + ':8'], { moves: 12, secs: 30 });
  assert.equal(JSON.parse(ls.getItem('tr_vgame_toast_best'))['bank:' + nid], 7);
  assert.deepEqual(JSON.parse(ls.getItem('tr_vgame_done'))['bank:' + nid], ['a']);
  assert.equal(JSON.parse(ls.getItem('tr_vgame_src')).mode, 'bank:' + nid);   // 新網址沒有 vgame_src:照抄(已經指到新 id)
  return nid;
};

T['題庫重搬:用同一個新 id,不會每搬一次多一份「（舊網址）」;新網址刪掉的題庫重搬會回來(確認畫面有寫)'] = async () => {
  const ls = makeStorage(0, { tr_vgame_banks: J([bank('b1', '共同', ['a'])]) });
  const old1 = { tr_vgame_banks: J([bank('b1', '共同', ['a', 'z'])]) };
  await moveInto(ls, old1);
  const first = JSON.parse(ls.getItem('tr_vgame_banks'));
  assert.equal(first.length, 2);
  const nid = first[1].id;
  /* 舊網址又改了這個題庫,再搬:新網址那份(搬家寫的、沒動過)換成新版,id 不變 */
  await moveInto(ls, { tr_vgame_banks: J([bank('b1', '共同', ['a', 'z', 'y'])]) });
  const second = JSON.parse(ls.getItem('tr_vgame_banks'));
  assert.deepEqual(second.map((b) => b.id), ['b1', nid]);
  assert.equal(second[1].words.length, 3);
  /* 新網址刪掉那個「（舊網址）」,同一包內容不同的再搬:回來,還是同一個 id */
  ls.setItem('tr_vgame_banks', J([second[0]]));
  await moveInto(ls, { tr_vgame_banks: J([bank('b1', '共同', ['a', 'z', 'y', 'x'])]) });
  const third = JSON.parse(ls.getItem('tr_vgame_banks'));
  assert.deepEqual(third.map((b) => b.id), ['b1', nid]);
  assert.ok(/刪過題庫/.test(read('js/move-in-page.js')));
  return nid;
};

T['題庫:新網址那份是搬家寫的而且沒改過,舊網址後來加了字,再搬就換成舊網址的新版(不另外多一份)'] = async () => {
  const ls = makeStorage(0, {});
  await moveInto(ls, { tr_vgame_banks: J([bank('b1', '甲', ['a'])]) });
  await moveInto(ls, { tr_vgame_banks: J([bank('b1', '甲', ['a', 'b'])]) });
  const banks = JSON.parse(ls.getItem('tr_vgame_banks'));
  assert.deepEqual(banks.map((b) => [b.id, b.words.length]), [['b1', 2]]);
  /* 新網址自己改過,舊網址又改:兩份都留 */
  banks[0].words.push({ en: 'n', zh: '新' });
  ls.setItem('tr_vgame_banks', J(banks));
  await moveInto(ls, { tr_vgame_banks: J([bank('b1', '甲', ['a', 'b', 'c'])]) });
  const after = JSON.parse(ls.getItem('tr_vgame_banks'));
  assert.equal(after.length, 2);
  assert.equal(after[1].name, '甲（舊網址）');
  return 'ok';
};

/* ---------- 重搬(冪等) ---------- */
T['冪等:同一包搬兩次,第二次說已經搬過、什麼都不寫'] = async () => {
  const ls = makeStorage(0, {});
  const init = { tr_hist: J([histRec(NOW - DAY, 'a')]), tr_diag: J({ s: 1 }) };
  await moveInto(ls, init);
  const snap = J(ls.dump());
  const { plan } = await moveInto(ls, init);
  assert.equal(plan.already, true);
  assert.equal(J(ls.dump()), snap);
  return 'ok';
};

T['冪等:舊網址之後又練習再搬,新的紀錄進來、不重複;搬家寫的單一值沒動過就直接換新;新網址改過的照規則問'] = async () => {
  const ls = makeStorage(0, {});
  await moveInto(ls, { tr_hist: J([histRec(NOW - DAY, 'a')]), tr_diag: J({ s: 1 }), tr_ph_slow: 'false' });
  ls.setItem('tr_hist', J([histRec(NOW - DAY, 'a'), histRec(NOW - 100, 'newsite')]));
  ls.setItem('tr_ph_slow', 'true');
  const { plan } = await moveInto(ls, { tr_hist: J([histRec(NOW - DAY, 'a'), histRec(NOW - 50, 'b')]), tr_diag: J({ s: 2 }), tr_ph_slow: 'false' });
  assert.deepEqual(JSON.parse(ls.getItem('tr_hist')).map((r) => r.id), ['a', 'newsite', 'b']);
  assert.equal(JSON.parse(ls.getItem('tr_diag')).s, 2);
  assert.equal(plan.counts.updated, 1);
  assert.deepEqual(plan.conflicts.map((c) => c.key), []);   // ph_slow:舊網址那份從上次搬家後沒變,新網址後來改的比較新,不再問
  return J(plan.counts);
};

T['目前的學生檔案:新網址沒有任何資料就照抄;有資料時不改、問要不要切換(帶名字);指到雲端帳號的不抄'] = async () => {
  const init = { tr_profiles: J([{ id: 'pabc123', name: '小明' }]), tr_current_profile: J('pabc123'), tr_upabc123_hist: J([histRec(NOW - DAY, 'a')]) };
  const empty = makeStorage(0, {});
  await moveInto(empty, init);
  assert.equal(empty.getItem('tr_current_profile'), J('pabc123'));
  const busy = makeStorage(0, { tr_hist: J([histRec(NOW - DAY, 'g')]) });
  const { plan } = await moveInto(busy, init);
  assert.equal(busy.getItem('tr_current_profile'), null);
  assert.deepEqual(plan.conflicts.map((c) => [c.key, c.oldName]), [['tr_current_profile', '小明']]);
  const cloudPtr = makeStorage(0, {});
  await moveInto(cloudPtr, { tr_current_profile: J(CPID), tr_hist: J([histRec(NOW - DAY, 'g')]) });
  assert.equal(cloudPtr.getItem('tr_current_profile'), null);
  return 'ok';
};

T['登入過的帳號還沒上傳的:放進 tr_move_pending_<帳號>,不寫進帳號資料夾、不寫進帳本;再搬一次同一鍵留時間比較晚的'] = async () => {
  const ls = makeStorage(0, {});
  const init = { ['tr_unsynced_' + UID]: J({ vgame_banks: NOW - 5000 }), ['tr_u' + CPID + '_vgame_banks']: J([bank('b1', '帳號的', ['a'])]) };
  const { plan } = await moveInto(ls, init);
  assert.equal(plan.pending, 1);
  assert.equal(ls.getItem('tr_u' + CPID + '_vgame_banks'), null);
  assert.equal(ls.getItem('tr_unsynced_' + UID), null);
  const pend = JSON.parse(ls.getItem('tr_move_pending_' + UID));
  assert.deepEqual(pend.items.map((e) => [e[0], e[2]]), [['vgame_banks', NOW - 5000]]);
  await moveInto(ls, { ['tr_unsynced_' + UID]: J({ vgame_banks: NOW - 9000 }), ['tr_u' + CPID + '_vgame_banks']: J([bank('b1', '更舊的', ['a'])]) });
  assert.equal(JSON.parse(JSON.parse(ls.getItem('tr_move_pending_' + UID)).items[0][1])[0].name, '帳號的');
  return 'ok';
};

/* ---------- 跟同步合併(js/sync-merge.js)對齊:題庫戳記、刪除標記、暫存區(同步合併設計 3.12) ---------- */
/* 新版頁面做的題庫(有 _r、_t、_p 戳記):用 SYNC_MERGE 一步一步改,跟 js/vocab.js 一樣 */
const sbank = (id, name, words, t) => SM.editBank([], id, t, (b) => SM.addWords(Object.assign(b, { name }), words.map((w) => ({ en: w, zh: '中' + w })), t))[0];
const edit = (b, t, fn) => SM.editBank([b], b.id, t, fn)[0];
const toggle = (b, en, t) => edit(edit(b, t, (x) => SM.setWord(x, en, { on: false }, t)), t + 1000, (x) => SM.setWord(x, en, { on: true }, t + 1000));
const addW = (b, en, t) => edit(b, t, (x) => SM.addWords(x, [{ en, zh: '中' + en }], t));
const namesOf = (ls, k) => JSON.parse(ls.getItem(k || 'tr_vgame_banks')).map((b) => b.name);
const wordsOf = (b) => b.words.map((w) => w.en).sort();

T['sync_del(刪除標記)有搬家規則 tombs,不是整份換掉的 single;帳號還沒上傳的標記放得進搬家包、收件端驗證收得下'] = () => {
  assert.equal(R.ruleOf('sync_del'), 'tombs');
  const b1 = sbank('b1', '帳號的', ['a'], NOW - 3 * DAY), b2 = sbank('b2', '要刪的', ['x'], NOW - 3 * DAY);
  const d = SM.deleteBank([b1, b2], null, 'b2', NOW - 2 * DAY);
  const init = { ['tr_unsynced_' + UID]: J({ vgame_banks: NOW - 2 * DAY, sync_del: NOW - 2 * DAY }),
    ['tr_u' + CPID + '_vgame_banks']: J(d.banks), ['tr_u' + CPID + '_sync_del']: J(d.tombs) };
  const { pack, summary } = packOf(init);
  assert.deepEqual(pack.accounts[UID].map((e) => e[0]), ['sync_del', 'vgame_banks']);
  assert.equal(summary.unknown, 0);
  const v = R.validate(JSON.parse(J(pack)), NOW);
  assert.ok(v.ok, v.why);
  assert.equal(R.classify('tr_u' + CPID + '_sync_del', new Set()).kind, 'cloud');   // 雲端帳號資料夾裡的:有規則,不算「認不得」
  return 'ok';
};

T['刪除標記(訪客的 tr_sync_del):兩邊的標記聯集,不問、不整份換掉'] = async () => {
  const x = sbank('bx', '新網址刪的', ['x'], NOW - 3 * DAY), y = sbank('by', '舊網址刪的', ['y'], NOW - 3 * DAY);
  const tn = SM.deleteBank([x], null, 'bx', NOW - 2 * DAY).tombs, to = SM.deleteBank([y], null, 'by', NOW - 2 * DAY).tombs;
  const ls = makeStorage(0, { tr_sync_del: J(tn) });
  const { plan } = await moveInto(ls, { tr_sync_del: J(to) });
  const t = JSON.parse(ls.getItem('tr_sync_del'));
  assert.deepEqual(Object.keys(t.vgame_banks.b).sort(), ['bx', 'by']);
  assert.deepEqual(plan.conflicts.map((c) => c.key), []);
  return 'ok';
};

T['題庫(訪客):同一個題庫兩邊只差戳記(勾選取消又勾回),不另存「（舊網址）」'] = async () => {
  const b0 = sbank('b1', '甲', ['a', 'b'], NOW - 5 * DAY);
  const ls = makeStorage(0, { tr_vgame_banks: J([toggle(b0, 'a', NOW - 4 * DAY)]) });
  const { plan } = await moveInto(ls, { tr_vgame_banks: J([toggle(b0, 'b', NOW - 3 * DAY)]) });
  assert.deepEqual(namesOf(ls), ['甲']);
  assert.equal(plan.banks.renamed.length, 0);
  return 'ok';
};

T['題庫(訪客):一份是另一份改過來的(戳記看得出先後):用新的那份,不另存「（舊網址）」;新網址的比較新就不動'] = async () => {
  const b0 = sbank('b1', '甲', ['a'], NOW - 5 * DAY);
  const newer = addW(b0, 'z', NOW - 4 * DAY);
  const ls = makeStorage(0, { tr_vgame_banks: J([b0]) });
  await moveInto(ls, { tr_vgame_banks: J([newer]) });
  const after = JSON.parse(ls.getItem('tr_vgame_banks'));
  assert.deepEqual(after.map((b) => [b.id, b.name, wordsOf(b)]), [['b1', '甲', ['a', 'z']]]);
  const ls2 = makeStorage(0, { tr_vgame_banks: J([newer]) });
  const { plan } = await moveInto(ls2, { tr_vgame_banks: J([b0]) });
  assert.equal(ls2.getItem('tr_vgame_banks'), J([newer]));
  assert.equal(plan.banks.renamed.length, 0);
  return 'ok';
};

T['題庫(訪客):兩邊都真的改了(各加了不同的字):照舊另存一份「（舊網址）」,兩份都在'] = async () => {
  const b0 = sbank('b1', '甲', ['a'], NOW - 5 * DAY);
  const ls = makeStorage(0, { tr_vgame_banks: J([addW(b0, 'n', NOW - 4 * DAY)]) });
  await moveInto(ls, { tr_vgame_banks: J([addW(b0, 'o', NOW - 3 * DAY)]) });
  assert.deepEqual(namesOf(ls), ['甲', '甲（舊網址）']);
  return 'ok';
};

T['暫存區(帳號還沒上傳的)再搬一次:題庫、刪除標記、模擬考紀錄跟上一包合併,不整份換掉;標記刪掉的題庫不會回來'] = async () => {
  const ls = makeStorage(0, {});
  const k = (s) => 'tr_u' + CPID + '_' + s;
  const b1 = sbank('b1', '帳號的', ['a'], NOW - 9 * DAY), b3 = sbank('b3', '之後刪掉', ['q'], NOW - 9 * DAY);
  const mk = (d) => ({ d, size: 'mini', lRaw: 1, rRaw: 1, lScore: 5, rScore: 5 });
  await moveInto(ls, { ['tr_unsynced_' + UID]: J({ vgame_banks: NOW - 9000, mock_history: NOW - 9000 }),
    [k('vgame_banks')]: J([b1, b3]), [k('mock_history')]: J([mk('2026-10-01')]) });
  /* 別台(搬家碼帶來的)的同一個帳號:加了 b2、刪了 b3、考了另一次 */
  const del = SM.deleteBank([b1, b3], null, 'b3', NOW - 6000);
  const b2 = sbank('b2', '別台加的', ['z'], NOW - 6000);
  await moveInto(ls, { ['tr_unsynced_' + UID]: J({ vgame_banks: NOW - 5000, sync_del: NOW - 5000, mock_history: NOW - 5000 }),
    [k('vgame_banks')]: J(del.banks.concat([b2])), [k('sync_del')]: J(del.tombs), [k('mock_history')]: J([mk('2026-10-02')]) }, {}, { device: DEV_B });
  const items = JSON.parse(ls.getItem('tr_move_pending_' + UID)).items;
  const get = (s) => JSON.parse(items.find((e) => e[0] === s)[1]);
  assert.deepEqual(get('vgame_banks').map((b) => b.id).sort(), ['b1', 'b2']);
  assert.deepEqual(Object.keys(get('sync_del').vgame_banks.b), ['b3']);
  assert.deepEqual(get('mock_history').map((r) => r.d), ['2026-10-01', '2026-10-02']);
  assert.equal(items.find((e) => e[0] === 'vgame_banks')[2], NOW - 5000);
  return 'ok';
};

/* ---------- 寫入 ---------- */
T['寫入:先寫日誌,中途空間不夠就照日誌全部還原(新網址回到搬之前),不留日誌'] = () => {
  const ls = makeStorage(0, { tr_hist: J([1]), tr_diag: J({ a: 1 }) });
  const snap = J(ls.dump());
  ls.failAt = ls.writes + 4;   // 試寫兩塊空間、日誌之後,第二個鍵寫不進去
  const r = A.apply(ls, [['tr_hist', J([1, 2])], ['tr_diag', J({ a: 2 })], ['tr_new', '1'], ['tr_move_log', '{}']], { now: NOW });
  assert.equal(r.ok, false);
  assert.equal(J(ls.dump()), snap);
  return J(r);
};

T['寫到一半分頁被關:下次開任何一頁(common.js)照日誌還原、留記號;15 秒內的日誌先不動(可能是別的分頁正在寫)'] = () => {
  const ls = makeStorage(0, { tr_hist: J([1]) });
  const writes = [['tr_hist', J([1, 2])], ['tr_vgame_banks', J([bank('b1', 'x', ['a'])])], ['tr_move_log', '{}']];
  const p = A.prepare(ls, writes, NOW, true);
  ls.setItem(A.JOURNAL, p.journal);
  ls.setItem(p.writes[0][0], p.writes[0][1]);
  ls.setItem(p.writes[1][0], p.writes[1][1]);   // 寫了兩個就被關掉
  const realNow = Date.now;
  try {
    G.Date.now = () => NOW + 5000;
    assert.equal(G.moveJournalRecover(ls), 'wait');
    G.Date.now = () => NOW + 60000;
    assert.equal(G.moveJournalRecover(ls), 'restored');
  } finally { G.Date.now = realNow; }
  assert.equal(ls.getItem('tr_hist'), J([1]));
  assert.equal(ls.getItem('tr_vgame_banks'), null);
  assert.equal(ls.getItem(A.JOURNAL), null);
  assert.equal(ls.getItem('tr_move_backup_' + NOW), null);
  assert.equal(ls.getItem('tr_move_restored'), String(NOW));
  assert.equal(G.moveJournalRecover(ls), '');
  return 'ok';
};

T['空間:寫完之後要留 500 KB,不夠就一個鍵都不寫;備份放不下而且會換掉原值時不寫(要呼叫的人改給不會變少的合併)'] = () => {
  const ls = makeStorage(800 * 1024, { tr_hist: J(['x'.repeat(100 * 1024)]) });
  const snap = J(ls.dump());
  const r = A.apply(ls, [['tr_vgame_banks', J('y'.repeat(300 * 1024))]], { now: NOW });
  assert.deepEqual(r, { ok: false, why: 'space' });
  assert.equal(J(ls.dump()), snap);
  const ls2 = makeStorage(1100 * 1024, { tr_hist: J(['x'.repeat(300 * 1024)]) });   // 備份 300K 加多出來的 150K 加留的 500K 放不下;不備份放得下
  const r2 = A.apply(ls2, [['tr_hist', J(['x'.repeat(300 * 1024), 'z'.repeat(150 * 1024)])]], { now: NOW });
  assert.equal(r2.why, 'noBackup');
  const r3 = A.apply(ls2, [['tr_hist', J(['x'.repeat(300 * 1024), 'z'.repeat(150 * 1024)])]], { now: NOW, allowNoBackup: true });
  assert.equal(r3.ok, true);
  assert.equal(ls2.getItem('tr_move_probe0'), null);
  return 'ok';
};

T['4 MB 的大包:組包、驗證、合併、寫入都在 3 秒內'] = async () => {
  const t0 = Date.now();
  const init = { tr_hist: J(Array.from({ length: 1500 }, (_, i) => histRec(NOW - i * 1000, 'q' + i))) };
  for (let i = 0; i < 40; i++) init['tr_read_q_art-' + i] = J({ blob: 'w'.repeat(100 * 1024) });
  const ls = makeStorage(5 * 1024 * 1024, { tr_hist: J([histRec(NOW - 9, 'n')]) });
  await moveInto(ls, init);
  assert.equal(JSON.parse(ls.getItem('tr_hist')).length, 1500);
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, ms + ' ms');
  return ms + ' ms';
};

/* ---------- 搬家碼與搬家檔 ---------- */
T['搬家碼:壓縮(RU1Z:)與不壓縮(RU1:)都還原得回同一包;搬家檔也是;不支援解壓縮時說清楚;亂貼的拒絕'] = async () => {
  const { pack } = packOf({ tr_hist: J([histRec(NOW - DAY, '中文')]), tr_vgame_banks: J([bank('b1', '我的', ['a'])]) });
  const hash = await P.hashOf(pack);
  const z = await P.toCode(pack, hash);
  const plain = await P.toCode(pack, hash, true);
  assert.match(z, /^RU1Z:/); assert.match(plain, /^RU1:/);
  for (const text of [z, plain, ' \n' + plain.slice(0, 20) + '\n' + plain.slice(20) + '\n', P.toFileText(pack, hash)]) {
    const r = await P.fromText(text);
    assert.ok(r.ok);
    assert.equal(r.hash, hash);
    assert.equal(await P.hashOf(r.pack), hash);
  }
  const saved = G.DecompressionStream;
  G.DecompressionStream = undefined;
  try { assert.equal((await P.fromText(z)).why, 'noGzip'); } finally { G.DecompressionStream = saved; }
  assert.equal((await P.fromText('hello')).ok, false);
  assert.equal((await P.fromText('RU1:@@@')).ok, false);
  assert.match(P.fileName(NOW), /^衝衝英文搬家檔_2026-11-05\.json$/);
  return z.length + ' / ' + plain.length;
};

/* ---------- 第一輪審查修正 ---------- */
const wr = (fields, at) => Object.assign({}, fields, { updatedAt: at });
T['寫作:同一題兩邊寫的不一樣,比較新的(updatedAt)放原位,另一份留在 alt,不會不見;一邊空的直接補上'] = async () => {
  const ls = makeStorage(0, {
    tr_writing_y: J({ y1: wr({ text: 'NEW short' }, '2026-10-01T10:00:00Z'), y2: wr({ text: 'new y2 newer', p0: 'np0' }, '2026-10-20T10:00:00Z') }),
    tr_writing_b: J({ b1: wr({ text: '' }, '2026-10-01T10:00:00Z') }),
    tr_writing_e: J({ e1: wr({ text: 'same' }, '2026-10-01T10:00:00Z') }),
  });
  const { plan } = await moveInto(ls, {
    tr_writing_y: J({ y1: wr({ text: 'OLD essay written on the old site, much longer' }, '2026-10-23T10:00:00Z'), y2: wr({ text: 'old y2', p0: 'np0', p1: 'op1' }, '2026-10-02T10:00:00Z') }),
    tr_writing_b: J({ b1: wr({ text: 'old sentence' }, '2026-09-01T10:00:00Z') }),
    tr_writing_e: J({ e1: wr({ text: 'same' }, '2026-10-01T10:00:00Z') }),
  });
  const y = JSON.parse(ls.getItem('tr_writing_y'));
  assert.equal(y.y1.text, 'OLD essay written on the old site, much longer');
  assert.equal(y.y1.updatedAt, '2026-10-23T10:00:00Z');
  assert.deepEqual(y.y1.alt.map((a) => a.text), ['NEW short']);
  assert.equal(y.y2.text, 'new y2 newer');
  assert.equal(y.y2.p1, 'op1');   // 新網址沒寫的欄位直接補上
  assert.deepEqual(y.y2.alt.map((a) => a.text), ['old y2']);
  assert.equal(JSON.parse(ls.getItem('tr_writing_b')).b1.text, 'old sentence');
  assert.equal(JSON.parse(ls.getItem('tr_writing_b')).b1.alt, undefined);
  assert.equal(plan.counts.keptBoth, 2);
  assert.equal(plan.counts.dropped, 0);
  assert.deepEqual(plan.conflicts, []);
  /* 同一份再合一次:不會多一份 alt */
  const again = M.mergeOne('texts', 'writing_y', y, JSON.parse(J({ y1: wr({ text: 'OLD essay written on the old site, much longer' }, '2026-10-23T10:00:00Z') })), { now: NOW });
  assert.equal(again.kind, 'same');
  /* 新網址那份放原位、舊的也已經在 alt,再收到更舊的第三份:三份都在 */
  const third = M.mergeOne('texts', 'writing_y', y, { y1: wr({ text: 'third device' }, '2026-09-01T00:00:00Z') }, { now: NOW });
  assert.deepEqual(third.v.y1.alt.map((a) => a.text).sort(), ['NEW short', 'third device']);
  return J(plan.counts);
};
T['文章單字:同一格兩邊填的不一樣,留新網址的、另一份放 alt;一邊是舊格式(t:null)的直接用有字的那份'] = async () => {
  const ls = makeStorage(0, { tr_vocab_art1: J({ 3: { t: '新網址填的' }, 5: { t: null }, 6: { t: 'same' } }) });
  const { plan } = await moveInto(ls, { tr_vocab_art1: J({ 3: { t: '舊網址填的' }, 4: { t: 'x' }, 5: { t: 'filled' }, 6: { t: 'SAME ' } }) });
  const v = JSON.parse(ls.getItem('tr_vocab_art1'));
  assert.deepEqual(v[3], { t: '新網址填的', alt: ['舊網址填的'] });
  assert.deepEqual(v[4], { t: 'x' });
  assert.deepEqual(v[5], { t: 'filled' });
  assert.deepEqual(v[6], { t: 'same' });   // 只差大小寫與空白:算一樣
  assert.equal(plan.counts.keptBoth, 1);
  const again = M.mergeOne('fills', 'vocab_art1', v, { 3: { t: '舊網址填的' } }, { now: NOW });
  assert.equal(again.kind, 'same');
  return J(v);
};
T['閱讀題作答:新網址已經答過的題目不會被換掉,只補沒答的;兩邊答案不一樣的算「留這台的」並列出來'] = async () => {
  const ls = makeStorage(0, { tr_read_q_art1: J({ 0: 0 }) });
  const { plan } = await moveInto(ls, { tr_read_q_art1: J({ 0: 2, 1: 1 }) });
  assert.deepEqual(JSON.parse(ls.getItem('tr_read_q_art1')), { 0: 0, 1: 1 });
  assert.equal(plan.counts.dropped, 1);
  assert.deepEqual(plan.dropped.map((d) => [d.key, d.label, d.n]), [['tr_read_q_art1', '閱讀題作答', 1]]);
  assert.equal(R.ruleOf('read_q_art1'), 'answers');
  /* 登入帳號暫存區合併(cloud.js takePending 走 mergeOne)也一樣 */
  const m = M.mergeOne('answers', 'read_q_art1', { 0: 0 }, { 0: 2, 1: 1 }, { now: NOW });
  assert.deepEqual(m.v, { 0: 0, 1: 1 });
  return J(plan.counts);
};
T['完成紀錄:{ ok } 一真一假取完成的;文法同一份小考({ ok: 答對數, t: 題數 })取答對多的;真的沒辦法合的計數,不再說「不會少」'] = () => {
  const ls = makeStorage(0, { tr_ear_s: J({ s1: { ok: false }, s3: { ok: false, n: 'a' } }), tr_grammar_done: J({ g1: { ok: 3, t: 5 }, g2: { ok: 4, t: 5 } }) });
  const v = R.validate(packOf({ tr_ear_s: J({ s1: { ok: true }, s2: { ok: true }, s3: { ok: false, n: 'b' } }), tr_grammar_done: J({ g1: { ok: 5, t: 5 }, g2: { ok: 1, t: 5 } }) }).pack, NOW);
  const p = M.plan(v, tgt(ls), ctxFor(ls));
  const w = new Map(p.writes);
  assert.deepEqual(JSON.parse(w.get('tr_ear_s')), { s1: { ok: true }, s3: { ok: false, n: 'a' }, s2: { ok: true } });
  assert.deepEqual(JSON.parse(w.get('tr_grammar_done')), { g1: { ok: 5, t: 5 }, g2: { ok: 4, t: 5 } });
  assert.equal(p.counts.dropped, 1);   // 只有 s3:兩邊都沒完成、內容又不一樣
  assert.deepEqual(p.dropped.map((d) => d.key), ['tr_ear_s']);
  return 'ok';
};
T['兩台裝置分別搬進同一台:第二台的單一值不會默默蓋掉第一台的,列為衝突;同一台再搬才直接換新'] = async () => {
  const ls = makeStorage(0, {});
  await moveInto(ls, { tr_diag: J({ lv: 'A裝置' }), tr_read_tq_art9: J({ score: 8, total: 10, t: NOW - DAY }), tr_vgame_banks: J([bank('b1', '甲', ['a'])]) }, null, { device: DEV_A });
  const { plan } = await moveInto(ls, { tr_diag: J({ lv: 'B裝置' }), tr_read_tq_art9: J({ score: 3, total: 10, t: NOW - 2 * DAY }), tr_vgame_banks: J([bank('b1', '甲', ['a', 'b'])]) }, null, { device: DEV_B });
  assert.equal(JSON.parse(ls.getItem('tr_diag')).lv, 'A裝置');
  assert.equal(JSON.parse(ls.getItem('tr_read_tq_art9')).score, 8);
  assert.deepEqual(plan.conflicts.map((c) => c.key).sort(), ['tr_diag', 'tr_read_tq_art9']);
  const banks = JSON.parse(ls.getItem('tr_vgame_banks'));
  assert.deepEqual(banks.map((b) => [b.name, b.words.length]), [['甲', 1], ['甲（舊網址）', 2]]);   // 第一台的題庫不會被第二台的換掉
  /* 同一台(A)之後又改了再搬:搬家寫的沒動過,直接換新 */
  const { plan: p3 } = await moveInto(ls, { tr_diag: J({ lv: 'A裝置2' }), tr_read_tq_art9: J({ score: 8, total: 10, t: NOW - DAY }), tr_vgame_banks: J([bank('b1', '甲', ['a'])]) }, null, { device: DEV_A });
  assert.equal(JSON.parse(ls.getItem('tr_diag')).lv, 'A裝置2');
  assert.equal(p3.counts.updated, 1);
  /* 沒有裝置編號的包(舊版、或被改過):不走「上次搬家寫的」捷徑 */
  const ls2 = makeStorage(0, {});
  await moveInto(ls2, { tr_diag: J({ lv: 'X' }) }, null, { device: '' });
  const { plan: p4 } = await moveInto(ls2, { tr_diag: J({ lv: 'Y' }) }, null, { device: '' });
  assert.deepEqual(p4.conflicts.map((c) => c.key), ['tr_diag']);
  assert.equal(JSON.parse(ls2.getItem('tr_diag')).lv, 'X');
  return 'ok';
};
T['裝置編號:舊網址第一次寫一個 tr_move_device(只新增、不改別的鍵),之後都用同一個;寫不進去也照樣給一個;收件端只收格式對的'] = () => {
  const ls = makeStorage(0, { tr_hist: '[]' });
  const id = P.deviceId(ls, globalThis.crypto);
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(ls.getItem('tr_move_device'), id);
  assert.equal(P.deviceId(ls, globalThis.crypto), id);
  assert.deepEqual(ls.log.map((e) => e[1]), ['tr_move_device']);
  const full = makeStorage(1, {});
  assert.match(P.deviceId(full, globalThis.crypto), /^[0-9a-f]{32}$/);
  assert.equal(R.classify('tr_move_device', new Set()).kind, 'skip');
  const base = { app: 'rushup-move', v: 1, keys: [], accounts: {} };
  assert.equal(R.validate(Object.assign({}, base, { device: id }), NOW).device, id);
  assert.equal(R.validate(base, NOW).device, '');
  assert.equal(R.validate(Object.assign({}, base, { device: '<x>' }), NOW).ok, false);
  return id;
};
T['很大的自訂題庫(超過 2 MB)照樣放進包、驗證照收;真的超過上限就列名字、標成搬不了'] = () => {
  const big = J([bank('b1', '大題庫', Array.from({ length: 60000 }, (_, i) => 'word' + i + 'x'.repeat(20)))]);
  assert.ok(big.length > 2 * 1024 * 1024, String(big.length));
  const { pack, summary } = packOf({ tr_vgame_banks: big, tr_hist: J([histRec(NOW - DAY, 'a')]) });
  assert.deepEqual(pack.keys.map((e) => e[0]), ['tr_hist', 'tr_vgame_banks']);
  assert.equal(summary.unreadable, 0);
  assert.deepEqual(summary.tooBig, []);
  assert.deepEqual(summary.banks, ['大題庫']);
  assert.ok(R.validate(JSON.parse(J(pack)), NOW).ok);
  const huge = J('x'.repeat(R.LIMITS.key + 10));
  const r2 = packOf({ tr_vgame_banks: huge.replace(/^"/, '[{"id":"b1","name":"超大","words":"').replace(/"$/, '"}]') });
  assert.deepEqual(r2.summary.tooBig, ['自訂單字題庫']);
  assert.equal(r2.pack.keys.length, 0);
  const r3 = packOf({ tr_drill_p5: '{broken' });
  assert.deepEqual(r3.summary.unreadableNames, ['刷題錯題本（Part 5）']);
  return big.length + ' 字';
};
T['只在本機的小雞(登入失效改回訪客後留下的 tr_localonly_<帳號>,沒有帳本):算有資料,也放進搬家包'] = () => {
  const init = { ['tr_localonly_' + UID]: J({ pet: NOW - 5000 }), ['tr_u' + CPID + '_pet']: J(petWith({ '2026-11-01': 4 }, '只在本機')) };
  const ls = makeStorage(0, init);
  assert.equal(R.hasData(ls), true);
  const { pack, summary } = packOf(init);
  assert.deepEqual(Object.keys(pack.accounts), [UID]);
  assert.deepEqual(pack.accounts[UID].map((e) => [e[0], e[2]]), [['pet', NOW - 5000]]);
  assert.equal(summary.hasData, true);
  /* 標記在、資料夾裡沒有小雞:不算 */
  assert.equal(R.hasData(makeStorage(0, { ['tr_localonly_' + UID]: J({ pet: NOW }) })), false);
  return 'ok';
};
T['登入著搬家:目前帳號用 flushForMove 給的,同一台其他帳號帳本上沒上傳的照樣帶上'] = () => {
  const UID2 = '9a9a9a9a-0000-4000-8000-000000000000', CPID2 = 'c' + UID2.replace(/-/g, '');
  const init = {
    ['tr_unsynced_' + UID2]: J({ vgame_banks: NOW - 1000 }), ['tr_u' + CPID2 + '_vgame_banks']: J([bank('b1', '別的帳號', ['a'])]),
    ['tr_unsynced_' + UID]: J({ hist: NOW - 1000 }), ['tr_u' + CPID + '_hist']: J([histRec(NOW - 1000, 'q')]),
  };
  const none = packOf(init, { accounts: {}, uid: UID }).pack;
  assert.deepEqual(Object.keys(none.accounts), [UID2]);
  const held = packOf(init, { accounts: { [UID]: [['hist', J([]), NOW - 1]] }, uid: UID }).pack;
  assert.deepEqual(Object.keys(held.accounts).sort(), [UID, UID2].sort());
  assert.equal(held.accounts[UID][0][1], '[]');
  return 'ok';
};
T['搬家碼解壓縮有上限:解出來太大(壓縮炸彈)或貼上的字太長,馬上停、回 tooBig,不會把記憶體吃光'] = async () => {
  const zlib = require('zlib');
  const bomb = 'RU1Z:' + zlib.gzipSync(Buffer.alloc(P.MAX_BYTES + 1024 * 1024, 32)).toString('base64');
  const t0 = Date.now();
  assert.equal((await P.fromText(bomb)).why, 'tooBig');
  assert.equal((await P.fromText('RU1:' + 'A'.repeat(P.MAX_TEXT + 4))).why, 'tooBig');
  assert.equal((await P.fromText(' '.repeat(P.MAX_TEXT + 4) + '{}')).why, 'tooBig');
  const { pack } = packOf({ tr_hist: J([histRec(NOW - DAY, 'a')]) });
  assert.ok((await P.fromText(await P.toCode(pack, await P.hashOf(pack)))).ok);
  return (Date.now() - t0) + ' ms';
};
T['格式不對的包:算雜湊不會丟錯(收件頁先驗證、再算雜湊)'] = async () => {
  for (const p of [{ keys: 'abc' }, { keys: [['tr_hist', '[]']], accounts: { x: 5 } }, { keys: [5, null] }, null, 'str']) {
    const h = await P.hashOf(p);
    assert.match(h, /^[0-9a-f]{64}$/);
  }
  assert.ok(/R\.validate\(pack, now\)[\s\S]*P\.hashOf\(pack\)/.test(read('js/move-in-page.js')), '收件頁要先驗證再算雜湊');
  return 'ok';
};

/* ---------- 程式裡用到的每個 store 鍵都有合併規則 ---------- */
T['程式裡用到的每個 store 鍵都在合併表裡有規則(新增的鍵沒有規則就失敗)'] = () => {
  const files = fs.readdirSync(path.join(REPO, 'js')).filter((f) => /\.js$/.test(f) && !/^move-/.test(f) && f !== 'cloud.js');
  const found = new Set(), unresolved = [];
  const known = { 'D.KEY': 'daily_done', 'DAILY.KEY': 'daily_done', KEY: null, 'KEY(p)': null, key: null, storeKey: null, 'SECTIONS[sec].key': null };
  files.forEach((f) => {
    const src = read('js/' + f);
    const consts = {};
    (src.match(/const KEY = '([a-z_]+)'/g) || []).forEach((m) => { consts.KEY = /'([a-z_]+)'/.exec(m)[1]; });
    (src.match(/const KEY = \w+ => '([a-z_]+)' \+/g) || []).forEach((m) => { consts['KEY(p)'] = /'([a-z_]+)'/.exec(m)[1] + '5'; });
    (src.match(/const (key|storeKey) = '([a-z_]+)' \+/g) || []).forEach((m) => { const x = /const (\w+) = '([a-z_]+)'/.exec(m); consts[x[1]] = x[2] + 'art-1a'; });
    (src.match(/key: '(ear_[a-z]+)'/g) || []).forEach((m) => found.add(/'([a-z_]+)'/.exec(m)[1]));
    (src.match(/KEYS = \{[^}]+\}/g) || []).forEach((m) => (m.match(/'([a-z_]+)'/g) || []).forEach((x) => found.add(x.slice(1, -1))));
    const re = /store\.(get|set|remove)\(\s*(\w+\([^)]*\)|[^,)]+)/g;
    let m;
    while ((m = re.exec(src))) {
      const arg = m[2].trim();
      const lit = /^'([a-z0-9_]+)'(\s*\+.*)?$/.exec(arg);
      if (lit) { found.add(lit[1] + (lit[2] ? (/_p$/.test(lit[1]) ? '5' : 'x1') : '')); continue; }
      if (/^KEYS\.\w+$/.test(arg)) continue;
      if (own(known, arg) && known[arg]) { found.add(known[arg]); continue; }
      if (own(consts, arg)) { found.add(consts[arg]); continue; }
      if (own(known, arg)) continue;   // 檔案裡用的變數已經另外收進來(ear 的 SECTIONS、writing 的 KEYS)
      unresolved.push(f + ':' + arg);
    }
  });
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  const missing = [...found].filter((k) => k !== 'profiles' && k !== 'current_profile' && !R.ruleOf(k));
  assert.deepEqual(unresolved, [], '認不得的 store 鍵寫法:' + unresolved.join('、'));
  assert.deepEqual(missing, [], '沒有合併規則:' + missing.join('、'));
  assert.ok(found.size >= 30, '只找到 ' + found.size + ' 個鍵,掃描可能壞了');
  return found.size + ' 個鍵';
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
