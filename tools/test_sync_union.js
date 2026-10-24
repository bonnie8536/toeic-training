/* 同一個帳號多台裝置:自訂題庫(vgame_banks)、刪除標記(sync_del)、模擬考紀錄(mock_history)先合併再上傳(同步合併設計 3.2–3.6、5.2)。
   用法:node tools/test_sync_union.js
   假的 Supabase 與多台裝置在 tools/sync_harness.js;頁面載入真的 js/sync-merge.js 與 js/cloud.js。
   「舊版頁面」用 tools/fixtures/cloud_sync_base.js(main 4c823ec 的 cloud.js,沒有合併表)。
   隨機的長序列在 tools/test_sync_fuzz.js。 */
const H = require('./sync_harness');
const { J, tick, makeWorld, makeDevice, open, signIn, newSession, logout, banksOf, tombsOf, localOf, cloudOf, ledgerOf, setCloud,
  storeSet, newBank, addWords, setWord, rename, deleteWord, deleteBank, oldEdit, oldOpenEditor, mockSubmit, wordKeys, PREFIX, loadPage } = H;

const has = (banks, id, en) => wordKeys(banks).has(id + '|' + en);
const ids = banks => (Array.isArray(banks) ? banks : []).map(b => b && b.id).filter(Boolean);
const writes = (dev, k) => dev.ops.filter(o => o.op === 'write' && o.keys.indexOf(k) >= 0);
const reads = (dev, k) => dev.ops.filter(o => o.op === 'read' && o.keys.indexOf(k) >= 0);
/* 已登入、題庫甲(apple)已經上雲的兩台:手機(分頁一直開著)與電腦 */
async function twoDevices(seed) {
  const w = makeWorld(seed || 7);
  const phone = makeDevice(w, '手機'), pc = makeDevice(w, '電腦');
  await signIn(phone);
  const A = newBank(phone, '甲');
  addWords(phone, A, [{ en: 'apple', zh: '蘋果' }]);
  await phone.pg.runTimers();
  await signIn(pc);
  return { w, phone, pc, A };
}

const scenarios = {
  '1. (2.2 A)手機分頁開著好幾天替題庫甲加字、電腦這幾天新增題庫乙:雲端與兩台最後都有全部': async () => {
    const { w, phone, pc, A } = await twoDevices();
    const B = newBank(pc, '乙'); addWords(pc, B, [{ en: 'pear', zh: '梨' }]);
    await pc.pg.runTimers();
    addWords(phone, A, [{ en: 'banana', zh: '香蕉' }]);        // 手機那個分頁沒重灌過
    await phone.pg.runTimers();
    const evt = phone.events.some(e => e.type === 'cloud:merged' && e.detail && e.detail.key === 'vgame_banks');
    await newSession(pc);
    const all = b => has(b, A, 'apple') && has(b, A, 'banana') && has(b, B, 'pear');
    return { ok: all(cloudOf(w, 'vgame_banks')) && all(banksOf(phone)) && all(banksOf(pc)) && evt && !Object.keys(ledgerOf(phone)).length,
             detail: '雲端 ' + J([...wordKeys(cloudOf(w, 'vgame_banks'))]) + ' / 手機 ' + wordKeys(banksOf(phone)).size + ' / 電腦 ' + wordKeys(banksOf(pc)).size + ' / 手機收到合併事件 ' + evt };
  },
  '2. (2.2 B)手機離線加字、電腦新增題庫,兩種先後:兩邊的都在': async () => {
    const out = [];
    for (const phoneFirst of [true, false]) {
      const { w, phone, pc, A } = await twoDevices(11);
      let B;
      if (!phoneFirst) { B = newBank(pc, '乙'); addWords(pc, B, [{ en: 'pear', zh: '梨' }]); await pc.pg.runTimers(); }
      phone.offline = true;
      addWords(phone, A, [{ en: 'kiwi', zh: '奇異果' }]); await phone.pg.runTimers();
      if (phoneFirst) { w.clock.t += 3600e3; B = newBank(pc, '乙'); addWords(pc, B, [{ en: 'pear', zh: '梨' }]); await pc.pg.runTimers(); }
      phone.offline = false;
      await newSession(phone);
      await newSession(pc);
      const all = b => has(b, A, 'kiwi') && has(b, B, 'pear') && has(b, A, 'apple');
      out.push({ ok: all(cloudOf(w, 'vgame_banks')) && all(banksOf(phone)) && all(banksOf(pc)), d: (phoneFirst ? '手機先' : '電腦先') + ':雲端 ' + J([...wordKeys(cloudOf(w, 'vgame_banks'))]) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  '3. (2.2 C)同一台兩個分頁:一個存入文章題庫、另一個(舊的整份陣列)改名後寫回:合併上傳把文章題庫補回本機和雲端': async () => {
    const { w, phone, A } = await twoDevices(13);
    const stale = banksOf(phone);                                 // 分頁一的編輯頁開著時讀進來的陣列
    addWords(phone, 'art_1', [{ en: 'refund', zh: '退款' }]);     // 分頁二:單字存入題庫
    await phone.pg.runTimers();
    const arr = JSON.parse(J(stale)); arr[0].name = '甲改名';       // 分頁一:就地改名、整份寫回(沒有文章題庫)
    storeSet(phone, 'vgame_banks', arr);
    await phone.pg.runTimers();
    const ok = has(banksOf(phone), 'art_1', 'refund') && has(cloudOf(w, 'vgame_banks'), 'art_1', 'refund') && banksOf(phone).find(b => b.id === A).name === '甲改名';
    return { ok, detail: '本機 ' + J(ids(banksOf(phone))) + ' / 雲端 ' + J(ids(cloudOf(w, 'vgame_banks'))) + ' / 名稱 ' + banksOf(phone).find(b => b.id === A).name };
  },
  '4. 電腦刪題庫,手機開著的分頁(新版)之後上傳別的改動:刪掉的不會回來;手機在刪之前離線改過那個題庫:留下來': async () => {
    const out = [];
    {
      const { w, phone, pc, A } = await twoDevices(17);
      const B = newBank(phone, '乙'); await phone.pg.runTimers();
      deleteBank(pc, A); await pc.pg.runTimers();
      addWords(phone, B, [{ en: 'pear', zh: '梨' }]); await phone.pg.runTimers();
      await newSession(pc);
      out.push({ ok: !ids(cloudOf(w, 'vgame_banks')).includes(A) && !ids(banksOf(phone)).includes(A) && !ids(banksOf(pc)).includes(A) && has(cloudOf(w, 'vgame_banks'), B, 'pear'),
        d: '刪掉:雲端 ' + J(ids(cloudOf(w, 'vgame_banks'))) + ' 手機 ' + J(ids(banksOf(phone))) });
    }
    {
      const { w, phone, pc, A } = await twoDevices(19);
      phone.offline = true;
      addWords(phone, A, [{ en: 'kiwi', zh: '奇異果' }]); await phone.pg.runTimers();
      deleteBank(pc, A); await pc.pg.runTimers();
      phone.offline = false; await phone.pg.fire('win:online');
      out.push({ ok: has(cloudOf(w, 'vgame_banks'), A, 'kiwi') && has(banksOf(phone), A, 'kiwi'), d: '刪之前改過:雲端 ' + J([...wordKeys(cloudOf(w, 'vgame_banks'))]) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  '5. 刪字:另一台的舊版本不會把它帶回來;刪了之後在新版加回同一個字:留著': async () => {
    const { w, phone, pc, A } = await twoDevices(23);
    deleteWord(pc, A, 'apple'); await pc.pg.runTimers();
    addWords(phone, A, [{ en: 'kiwi', zh: '奇異果' }]); await phone.pg.runTimers();
    const gone = !has(cloudOf(w, 'vgame_banks'), A, 'apple') && !has(banksOf(phone), A, 'apple');
    addWords(pc, A, [{ en: 'apple', zh: '蘋果' }]); await pc.pg.runTimers();
    await newSession(phone);
    const back = has(cloudOf(w, 'vgame_banks'), A, 'apple') && has(banksOf(phone), A, 'apple') && has(banksOf(phone), A, 'kiwi');
    return { ok: gone && back, detail: '刪掉後 ' + gone + ' / 加回後 ' + back + ' / 標記 ' + J(Object.keys((tombsOf(phone) || { vgame_banks: { w: {} } }).vgame_banks.w)) };
  },
  '6. 舊版頁面(main 那一版 cloud.js)整份上傳把雲端蓋掉:新版開單字頁(syncKey)、灌資料、登出前對帳各自補回': async () => {
    const out = [];
    for (const how of ['syncKey', 'hydrate', 'logout']) {
      const w = makeWorld(29);
      const nu = makeDevice(w, '新版'), old = makeDevice(w, '舊版', { old: true });
      await signIn(nu);
      const A = newBank(nu, '甲'); addWords(nu, A, [{ en: 'apple', zh: '蘋果' }]); await nu.pg.runTimers();
      await signIn(old); oldOpenEditor(old);                     // 舊版頁面的編輯頁開著
      const B = newBank(nu, '乙'); addWords(nu, B, [{ en: 'pear', zh: '梨' }]); await nu.pg.runTimers();
      oldEdit(old, arr => { arr[0].words.push({ en: 'old-word', zh: '舊版加的', on: true }); });
      await old.pg.runTimers();
      const wiped = !ids(cloudOf(w, 'vgame_banks')).includes(B);
      let r = null;
      if (how === 'syncKey') r = await nu.pg.ctx.CLOUD.syncKey('vgame_banks');
      if (how === 'hydrate') await newSession(nu);
      if (how === 'logout') { nu.confirmAnswer = true; await logout(nu); }
      const c = cloudOf(w, 'vgame_banks');
      const ok = wiped && has(c, B, 'pear') && has(c, A, 'old-word') && has(c, A, 'apple') && (how !== 'logout' ? has(banksOf(nu), A, 'old-word') : banksOf(nu).length === 0)
        && (how !== 'syncKey' || (r && r.ok === true && r.changed === true));
      out.push({ ok, d: how + ':雲端被蓋掉 ' + wiped + ' → ' + J([...wordKeys(c)]) + (r ? ' ' + J(r) : '') });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  '7. 登出前對帳:帳本是空的、但雲端被別台舊版蓋掉:先把本機那份合併傳上去再刪本機;讀不到雲端時不多問(帳本空)': async () => {
    const out = [];
    for (const offline of [false, true]) {
      const { w, phone, A } = await twoDevices(31);
      setCloud(w, 'vgame_banks', [{ id: 'zz', name: '舊版的', words: [{ en: 'x', zh: 'ㄨ', on: true }] }]);
      phone.offline = offline;
      phone.confirmAnswer = true;
      const left = await logout(phone);
      const c = cloudOf(w, 'vgame_banks');
      if (!offline) out.push({ ok: left && has(c, A, 'apple') && has(c, 'zz', 'x') && phone.confirms.length === 0 && banksOf(phone).length === 0, d: '有網路:雲端 ' + J(ids(c)) + ' 問了 ' + phone.confirms.length });
      else out.push({ ok: phone.confirms.length === 0 && left, d: '離線:問了 ' + phone.confirms.length + '(已知限制 6)' });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  '8. 題庫和刪除標記一起傳:傳失敗兩個都留在帳本、雲端兩列都沒動;每一次寫題庫都帶著標記(不會只傳題庫)': async () => {
    const { w, phone, A } = await twoDevices(37);
    const B = newBank(phone, '乙'); await phone.pg.runTimers();
    const before = J(w.db);
    phone.writeError = true;
    deleteBank(phone, A); await phone.pg.runTimers();
    const led = ledgerOf(phone);
    const failOk = J(w.db) === before && 'vgame_banks' in led && 'sync_del' in led;
    phone.writeError = false; phone.ops = [];
    await phone.pg.fire('win:pagehide');
    const bankWrites = writes(phone, 'vgame_banks');
    /* 寫題庫的那一次,不是同一個 upsert 帶著標記,就是雲端的標記已經跟這台一樣(先傳上去了) */
    const paired = bankWrites.length > 0 && bankWrites.every(o => o.keys.indexOf('sync_del') >= 0 || J(o.tombsInCloud) === J(tombsOf(phone)));
    const c = cloudOf(w, 'vgame_banks');
    return { ok: failOk && paired && !ids(c).includes(A) && ids(c).includes(B) && !!cloudOf(w, 'sync_del') && !Object.keys(ledgerOf(phone)).length,
             detail: '失敗時帳本 ' + J(Object.keys(led)) + ' 雲端沒動 ' + failOk + ' / 寫題庫 ' + bankWrites.length + ' 次都帶著標記或雲端已有 ' + paired };
  },
  '9. 頁面沒載到 sync-merge.js:題庫不上傳、帳本留著、不會整份蓋掉雲端;灌資料時留本機也不補傳': async () => {
    const { w, phone, A } = await twoDevices(41);
    const w2 = phone.world;
    const bare = makeDevice(w2, '沒有合併函式', { noSm: true });
    await signIn(bare);
    const before = J(cloudOf(w, 'vgame_banks'));
    const arr = banksOf(bare); arr.push({ id: 'bX', name: '新', words: [{ en: 'q', zh: 'ㄑ', on: true }] });
    storeSet(bare, 'vgame_banks', arr);
    await bare.pg.runTimers(); await bare.pg.fire('win:pagehide');
    const a = J(cloudOf(w, 'vgame_banks')) === before && 'vgame_banks' in ledgerOf(bare) && writes(bare, 'vgame_banks').length === 0;
    bare.ops = [];
    await newSession(bare);
    const b = ids(banksOf(bare)).includes('bX') && writes(bare, 'vgame_banks').length === 0 && J(cloudOf(w, 'vgame_banks')) === before;
    return { ok: a && b, detail: '上傳時 ' + a + ' / 灌資料 ' + b + ' / 帳本 ' + J(Object.keys(ledgerOf(bare))) + ' / ' + A };
  },
  '10. 雲端那份是認不得的形狀(題庫不是陣列、刪除標記是 v:2):唯讀,不上傳、帳本留著、本機不改': async () => {
    const out = [];
    for (const which of ['banks', 'tombs']) {
      const { w, phone, A } = await twoDevices(43);
      if (which === 'banks') setCloud(w, 'vgame_banks', { future: true });
      else setCloud(w, 'sync_del', { v: 2, x: 1 });
      const cloudBefore = J(w.db);
      addWords(phone, A, [{ en: 'kiwi', zh: '奇異果' }]);
      const localBefore = J(banksOf(phone));
      await phone.pg.runTimers(); await phone.pg.fire('win:pagehide');
      out.push({ ok: J(w.db) === cloudBefore && J(banksOf(phone)) === localBefore && 'vgame_banks' in ledgerOf(phone), d: which + ':雲端沒動 ' + (J(w.db) === cloudBefore) + ' 帳本 ' + J(Object.keys(ledgerOf(phone))) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  '11. 模擬考紀錄:兩台各考一次(其中一台是開著很久的分頁):兩筆都在雲端與兩台': async () => {
    const { w, phone, pc } = await twoDevices(47);
    mockSubmit(pc, 7); await pc.pg.runTimers();
    w.clock.t += 60e3;
    mockSubmit(phone, 9); await phone.pg.runTimers();
    await newSession(pc);
    const n = x => (Array.isArray(x) ? x.length : 0);
    return { ok: n(cloudOf(w, 'mock_history')) === 2 && n(localOf(phone, 'mock_history')) === 2 && n(localOf(pc, 'mock_history')) === 2,
             detail: '雲端 ' + n(cloudOf(w, 'mock_history')) + ' 筆 / 手機 ' + n(localOf(phone, 'mock_history')) + ' / 電腦 ' + n(localOf(pc, 'mock_history')) };
  },
  '12. 讀不到雲端(伺服器回錯誤、離線):不上傳、本機不丟、帳本留著;恢復後合併上傳': async () => {
    const { w, phone, pc, A } = await twoDevices(53);
    const B = newBank(pc, '乙'); await pc.pg.runTimers();
    phone.readError = true; phone.ops = [];
    addWords(phone, A, [{ en: 'kiwi', zh: '奇異果' }]);
    const local = J(banksOf(phone));
    await phone.pg.runTimers();
    const a = J(banksOf(phone)) === local && 'vgame_banks' in ledgerOf(phone) && writes(phone, 'vgame_banks').length === 0 && ids(cloudOf(w, 'vgame_banks')).includes(B);
    phone.readError = false;
    await phone.pg.fire('win:online');
    const c = cloudOf(w, 'vgame_banks');
    return { ok: a && has(c, A, 'kiwi') && ids(c).includes(B) && !('vgame_banks' in ledgerOf(phone)), detail: '讀不到時 ' + a + ' / 恢復後雲端 ' + J([...wordKeys(c)]) };
  },
  '13. 還沒同步就登出:先問,按取消就不刪本機與帳本': async () => {
    const { phone, A } = await twoDevices(59);
    phone.offline = true;
    addWords(phone, A, [{ en: 'kiwi', zh: '奇異果' }]); await phone.pg.runTimers();
    phone.confirmAnswer = false;
    const done = await logout(phone);
    return { ok: !done && phone.confirms.length === 1 && has(banksOf(phone), A, 'kiwi') && 'vgame_banks' in ledgerOf(phone),
             detail: '登出 ' + done + ' / 問了 ' + phone.confirms.length + ' / 本機 ' + J([...wordKeys(banksOf(phone))]) };
  },
  '14. syncKey:開了好幾天的 App 打開單字頁:讀一次雲端、把別台的題庫合併進本機、回 changed;雲端已經都有就不寫': async () => {
    const { w, phone, pc } = await twoDevices(61);
    const B = newBank(pc, '乙'); addWords(pc, B, [{ en: 'pear', zh: '梨' }]); await pc.pg.runTimers();
    phone.ops = []; phone.events = [];
    const r = await phone.pg.ctx.CLOUD.syncKey('vgame_banks');
    const r2 = await phone.pg.ctx.CLOUD.syncKey('vgame_banks');
    const evt = phone.events.filter(e => e.type === 'cloud:merged').length;
    return { ok: r && r.ok && r.changed && r2 && r2.ok && !r2.changed && has(banksOf(phone), B, 'pear') && writes(phone, 'vgame_banks').length === 0 && reads(phone, 'vgame_banks').length === 2 && evt === 1,
             detail: J(r) + ' / 第二次 ' + J(r2) + ' / 讀 ' + reads(phone, 'vgame_banks').length + ' 寫 ' + writes(phone, 'vgame_banks').length + ' / 事件 ' + evt + ' / ' + J(ids(banksOf(w.devices[0]))) };
  },
  '15. syncKey:沒登入、離線、不是合併表上的鍵:回 ok:false,不發任何請求、本機不變': async () => {
    const w = makeWorld(67);
    const guest = makeDevice(w, '訪客');
    const pg = await open(guest);
    const a = await pg.ctx.CLOUD.syncKey('vgame_banks');
    const { phone } = await twoDevices(71);
    phone.ops = [];
    const b = await phone.pg.ctx.CLOUD.syncKey('hist');
    phone.offline = true;
    const before = J(banksOf(phone));
    const c = await phone.pg.ctx.CLOUD.syncKey('vgame_banks');
    return { ok: a.ok === false && b.ok === false && c.ok === false && guest.ops.filter(o => o.op !== 'teachers').length === 0 && phone.ops.filter(o => o.keys && o.keys.indexOf('hist') >= 0).length === 0 && J(banksOf(phone)) === before,
             detail: '訪客 ' + J(a) + ' / hist ' + J(b) + ' / 離線 ' + J(c) };
  },
  '16. 灌資料:別台刪的題庫在本機還有、雲端已經沒有:本機也拿掉(照標記);本機和雲端一樣就不上傳': async () => {
    const { w, phone, pc, A } = await twoDevices(73);
    deleteBank(phone, A); await phone.pg.runTimers();
    pc.ops = [];
    await newSession(pc);
    return { ok: !ids(banksOf(pc)).includes(A) && writes(pc, 'vgame_banks').length === 0 && !Object.keys(ledgerOf(pc)).length,
             detail: '電腦本機 ' + J(ids(banksOf(pc))) + ' / 寫 ' + writes(pc, 'vgame_banks').length };
  },
  '17. 灌資料:這台第一次登入、雲端那份被舊版頁面帶回已刪的題庫:套標記後才放進本機,並把雲端修好': async () => {
    const { w, phone, A } = await twoDevices(79);
    const keep = JSON.parse(J(banksOf(phone)));
    deleteBank(phone, A); await phone.pg.runTimers();
    setCloud(w, 'vgame_banks', keep);                              // 舊版頁面整份帶回
    const fresh = makeDevice(w, '新手機');
    await signIn(fresh);
    return { ok: !ids(banksOf(fresh)).includes(A) && !ids(cloudOf(w, 'vgame_banks')).includes(A), detail: '新手機 ' + J(ids(banksOf(fresh))) + ' / 雲端 ' + J(ids(cloudOf(w, 'vgame_banks'))) };
  },
  '18. 同一個字兩台同時改中文:兩個中文都留(一個在 alt),兩台最後一樣': async () => {
    const { w, phone, pc, A } = await twoDevices(83);
    phone.offline = true;
    setWord(phone, A, 'apple', { zh: '蘋果樹' }); await phone.pg.runTimers();
    setWord(pc, A, 'apple', { zh: '大蘋果' }); await pc.pg.runTimers();
    phone.offline = false; await phone.pg.fire('win:online');
    await newSession(pc);
    const wd = b => (b.find(x => x.id === A) || { words: [] }).words.find(x => x.en === 'apple') || {};
    const both = x => [x.zh].concat(x.alt || []).sort().join() === '大蘋果,蘋果樹';
    return { ok: both(wd(banksOf(phone))) && both(wd(banksOf(pc))) && both(wd(cloudOf(w, 'vgame_banks'))) && w.SM.stateKey(banksOf(phone)) === w.SM.stateKey(banksOf(pc)),
             detail: J(wd(cloudOf(w, 'vgame_banks'))) };
  },
  '19. 改名跟別台加字同時發生:名字用改過的,字都在': async () => {
    const { w, phone, pc, A } = await twoDevices(89);
    phone.offline = true;
    rename(phone, A, '改過的名字'); await phone.pg.runTimers();
    addWords(pc, A, [{ en: 'pear', zh: '梨' }]); await pc.pg.runTimers();
    phone.offline = false; await phone.pg.fire('win:online');
    const b = cloudOf(w, 'vgame_banks').find(x => x.id === A);
    return { ok: b.name === '改過的名字' && has([b], A, 'pear'), detail: b.name + ' / ' + J(b.words.map(x => x.en)) };
  },
  '20. 確認登入前就寫入的題庫(灌資料前):不作廢,跟雲端合併': async () => {
    const { w, phone, pc, A } = await twoDevices(97);
    const B = newBank(pc, '乙'); await pc.pg.runTimers();
    phone.pg.close(); phone.session = H.makeStorage();
    const pg = loadPage(phone);                                    // 新的工作階段,還在確認登入
    addWords(phone, A, [{ en: 'early', zh: '早' }]);
    await pg.ready;
    const p2 = await open(phone);
    return { ok: has(banksOf(phone), A, 'early') && ids(banksOf(phone)).includes(B) && has(cloudOf(w, 'vgame_banks'), A, 'early') && !!p2,
             detail: '本機 ' + J([...wordKeys(banksOf(phone))]) + ' / 雲端 ' + J([...wordKeys(cloudOf(w, 'vgame_banks'))]) };
  },
  '21. 每個載入 js/cloud.js 的頁面都在它前面載入 js/sync-merge.js(沒載到的頁面題庫就傳不上去),sw.js 沒有要另外列的快取清單': async () => {
    const fs = require('fs'), path = require('path');
    const dir = path.join(__dirname, '..');
    const pages = fs.readdirSync(dir).filter(f => /\.html$/.test(f));
    const bad = [];
    let n = 0;
    pages.forEach(f => {
      const srcs = [];
      fs.readFileSync(path.join(dir, f), 'utf8').replace(/<script[^>]*\ssrc="([^"]+)"/g, (m, src) => { srcs.push(src); return m; });
      const ci = srcs.indexOf('js/cloud.js');
      if (ci < 0) return;
      n++;
      const si = srcs.indexOf('js/sync-merge.js');
      if (si < 0 || si > ci || srcs.lastIndexOf('js/sync-merge.js') !== si) bad.push(f);
    });
    const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
    const listed = /js\/(cloud|pet|common)\.js/.test(sw);   // sw.js 是執行時才快取,沒有寫死的檔案清單;有的話新檔要加進去
    return { ok: n >= 20 && !bad.length && !listed, detail: n + ' 頁' + (bad.length ? ',沒載或順序不對:' + bad.join('、') : ',都在 cloud.js 前面') + ' / sw.js 寫死清單 ' + listed };
  },
  '22. 頁面沒載到 sync-merge.js、雲端又比帳本新(別台後來上傳過):灌資料時不拿雲端蓋掉本機沒上傳的題庫,留本機、帳本留著,回正常頁面再合併上傳': async () => {
    const w = makeWorld(101);
    const pc = makeDevice(w, '電腦'), phone = makeDevice(w, '手機');
    await signIn(pc); await signIn(phone);
    const A = newBank(phone, '手機的'); await phone.pg.runTimers();
    await newSession(pc);
    pc.offline = true;
    const X = newBank(pc, '電腦離線新增的');
    addWords(pc, X, [{ en: 'offline', zh: '離線' }]);
    await pc.pg.runTimers();
    w.clock.t += 60000;
    addWords(phone, A, [{ en: 'later', zh: '之後' }]); await phone.pg.runTimers();   // 雲端比電腦的帳本新
    pc.offline = false;
    pc.noSm = true;
    const cloudBefore = J(cloudOf(w, 'vgame_banks'));
    await newSession(pc);
    const a = ids(banksOf(pc)).includes(X) && 'vgame_banks' in ledgerOf(pc) && J(cloudOf(w, 'vgame_banks')) === cloudBefore;
    pc.noSm = false;
    await newSession(pc); await pc.pg.runTimers(); await pc.pg.fire('win:pagehide');
    const c = cloudOf(w, 'vgame_banks');
    const b = has(c, X, 'offline') && has(c, A, 'later') && has(banksOf(pc), X, 'offline') && has(banksOf(pc), A, 'later') && !('vgame_banks' in ledgerOf(pc));
    return { ok: a && b, detail: '沒合併檔的頁面灌資料後 本機有X ' + ids(banksOf(pc)).includes(X) + ' 帳本 ' + J(Object.keys(ledgerOf(pc))) + ' / 回正常頁面後 ' + b + ' 雲端 ' + J([...wordKeys(c || [])]) };
  },
  '23. 模擬考紀錄:時鐘錯了的手機考完一次(日期比雲端 30 筆都舊):那一筆留在手機、傳上雲端、電腦也拿得到': async () => {
    const w = makeWorld(103);
    const pc = makeDevice(w, '電腦'), phone = makeDevice(w, '手機');
    await signIn(pc);
    for (let i = 0; i < 30; i++) { mockSubmit(pc, i % 10); await pc.pg.runTimers(); }
    await signIn(phone);
    phone.skew = Date.parse('2026-01-01T00:00:00Z') - w.clock.t;
    mockSubmit(phone, 7.7);
    await phone.pg.runTimers();
    const mine = arr => (Array.isArray(arr) ? arr : []).some(r => r.lRaw === 7.7);
    const a = mine(localOf(phone, 'mock_history')), b = mine(cloudOf(w, 'mock_history'));
    await newSession(pc);
    const c = mine(localOf(pc, 'mock_history'));
    return { ok: a && b && c && !Object.keys(ledgerOf(phone)).length, detail: '手機 ' + a + ' / 雲端 ' + b + ' / 電腦 ' + c + ' / 手機帳本 ' + J(Object.keys(ledgerOf(phone))) };
  },
  '24. 上傳題庫讀雲端的這段時間,同一台另一個分頁把新的刪除標記寫進本機:這次放棄(帳本留著),本機的新標記不被舊的蓋掉': async () => {
    const { w, phone, pc, A } = await twoDevices(107);
    addWords(phone, A, [{ en: 'kiwi', zh: '奇異果' }]); await phone.pg.runTimers();
    await newSession(pc);
    const d = w.SM.deleteWord(banksOf(pc), tombsOf(pc), A, 'kiwi', H.now(pc) + 500);   // 另一個分頁算出來、合併進本機的標記(只寫標記,沒動題庫)
    addWords(pc, A, [{ en: 'cherry', zh: '櫻桃' }]);
    pc.onRead = () => { pc.local.setItem(PREFIX + 'sync_del', J(d.tombs)); };
    await pc.pg.runTimers();
    const t = tombsOf(pc);
    const kept = !!(t && t.vgame_banks && t.vgame_banks.w[A] && t.vgame_banks.w[A].kiwi);
    return { ok: kept && 'vgame_banks' in ledgerOf(pc) && has(banksOf(pc), A, 'cherry'), detail: '本機 kiwi 標記還在 ' + kept + ' / 帳本 ' + J(Object.keys(ledgerOf(pc))) };
  },
  '25. (r2 #1、#4)舊版頁面就地改名、取消勾選、改中文,新版那台沒動過那個題庫:開單字頁、灌資料、登出前對帳都不退回;舊版那台之後更新成新版也一樣': async () => {
    const out = [];
    for (const legacy of [true, false]) for (const how of ['syncKey', 'hydrate', 'logout']) {
      const w = makeWorld(109);
      const pc = makeDevice(w, '電腦'), phone = makeDevice(w, '手機舊版', { old: true });
      let A = 'bOld';
      const words = [{ en: 'apple', zh: '蘋果', on: true }, { en: 'pear', zh: '梨', on: true }];
      if (legacy) { setCloud(w, 'vgame_banks', [{ id: A, name: 'Unit 1', words }]); await signIn(pc); }   // 部署前就有的題庫(沒有任何戳記)
      else { await signIn(pc); A = newBank(pc, 'Unit 1'); addWords(pc, A, words.map(x => ({ en: x.en, zh: x.zh }))); await pc.pg.runTimers(); }
      await signIn(phone); oldOpenEditor(phone);
      w.clock.t += 60e3;
      oldEdit(phone, arr => { const b = arr.find(x => x.id === A); b.name = 'Food'; b.words.find(x => x.en === 'apple').on = false; b.words.find(x => x.en === 'pear').zh = '一種水果'; });
      await phone.pg.runTimers();                                   // 舊版整份上傳成功:雲端是改過的
      w.clock.t += 3600e3;
      if (how === 'syncKey') await pc.pg.ctx.CLOUD.syncKey('vgame_banks');
      if (how === 'hydrate') await newSession(pc);
      if (how === 'logout') { pc.confirmAnswer = true; await logout(pc); }
      if (how !== 'logout') await pc.pg.runTimers();
      phone.old = false; await newSession(phone);                   // 舊版那台重新整理成新版、灌資料
      const good = banks => {
        const b = (Array.isArray(banks) ? banks : []).find(x => x.id === A) || { words: [] };
        const wd = en => b.words.find(x => x.en === en) || {};
        return b.name === 'Food' && wd('apple').on === false && wd('pear').zh === '一種水果';
      };
      const brief = banks => { const b = (banks || []).find(x => x.id === A); return b ? b.name + ' ' + J(b.words.map(x => x.en + (x.on === false ? '(不勾)' : '') + '=' + x.zh)) : '沒有'; };
      out.push({ ok: good(cloudOf(w, 'vgame_banks')) && good(banksOf(phone)) && (how === 'logout' || good(banksOf(pc))),
        d: (legacy ? '舊資料' : '新版建的') + how + ':雲端 ' + brief(cloudOf(w, 'vgame_banks')) + ' 電腦 ' + brief(banksOf(pc)) + ' 手機 ' + brief(banksOf(phone)) });
    }
    return { ok: out.every(x => x.ok), detail: out.filter(x => !x.ok).map(x => x.d).join(' / ') || out.length + ' 種都留著' };
  },
  '26. (r2 #3)開單字頁(syncKey)發現雲端少了、合併後上傳失敗:記進帳本;恢復連線自己補傳、離線登出會先問': async () => {
    const out = [];
    for (const then of ['online', 'offlineLogout']) {
      const w = makeWorld(113);
      const pc = makeDevice(w, '電腦'), phone = makeDevice(w, '手機舊版', { old: true });
      await signIn(phone); oldOpenEditor(phone);                    // 舊版編輯頁開著(記住的是空陣列)
      await signIn(pc);
      const X = newBank(pc, '第5課'); addWords(pc, X, [{ en: 'refund', zh: '退款' }]); await pc.pg.runTimers();
      w.clock.t += 60e3;
      oldEdit(phone, arr => { arr.push({ id: 'bOld', name: '舊版的', words: [{ en: 'pear', zh: '梨', on: true }] }); });
      await phone.pg.runTimers();                                   // 舊版整份上傳:雲端少了第5課
      const wiped = !has(cloudOf(w, 'vgame_banks'), X, 'refund');
      pc.writeError = true;
      const r = await pc.pg.ctx.CLOUD.syncKey('vgame_banks');
      pc.writeError = false;
      const led = Object.keys(ledgerOf(pc));
      if (then === 'online') {
        await pc.pg.fire('win:online');
        out.push({ ok: wiped && led.indexOf('vgame_banks') >= 0 && has(cloudOf(w, 'vgame_banks'), X, 'refund') && !Object.keys(ledgerOf(pc)).length,
          d: '失敗後帳本 ' + J(led) + ' / 恢復連線後雲端有第5課 ' + has(cloudOf(w, 'vgame_banks'), X, 'refund') + ' ' + J(r) });
      } else {
        pc.offline = true; pc.confirmAnswer = false;
        const done = await logout(pc);
        out.push({ ok: wiped && led.indexOf('vgame_banks') >= 0 && !done && pc.confirms.length === 1 && has(banksOf(pc), X, 'refund'),
          d: '失敗後帳本 ' + J(led) + ' / 離線登出問了 ' + pc.confirms.length + ' 登出 ' + done + ' 本機有第5課 ' + has(banksOf(pc), X, 'refund') });
      }
    }
    {
      /* 模擬考紀錄(uploadMerged 的 pull):舊版頁面交卷整份上傳蓋掉電腦那一筆,電腦 syncKey 合併後上傳失敗 → 帳本記著,恢復連線補傳 */
      const w = makeWorld(131);
      const pc = makeDevice(w, '電腦'), phone = makeDevice(w, '手機舊版', { old: true });
      await signIn(phone); await signIn(pc);
      mockSubmit(pc, 8); await pc.pg.runTimers();
      w.clock.t += 60e3;
      mockSubmit(phone, 3); await phone.pg.runTimers();            // 舊版本機沒有電腦那一筆,整份上傳
      const mine = arr => (Array.isArray(arr) ? arr : []).some(r => r.lRaw === 8);
      const wiped = !mine(cloudOf(w, 'mock_history'));
      pc.writeError = true;
      await pc.pg.ctx.CLOUD.syncKey('mock_history');
      pc.writeError = false;
      const led = Object.keys(ledgerOf(pc));
      await pc.pg.fire('win:online');
      out.push({ ok: wiped && led.indexOf('mock_history') >= 0 && mine(cloudOf(w, 'mock_history')) && !Object.keys(ledgerOf(pc)).length,
        d: '模擬考:失敗後帳本 ' + J(led) + ' / 恢復連線後雲端有電腦那一筆 ' + mine(cloudOf(w, 'mock_history')) });
    }
    return { ok: out.every(x => x.ok), detail: out.map(x => x.d).join(' / ') };
  },
  '27. (r2 #8)只有帶刪除標記的寫入失敗:雲端的題庫那一列不會先變少(題庫和標記同一個 upsert,一起失敗);恢復後刪掉、標記也上雲、帳本清空': async () => {
    const { w, phone, A } = await twoDevices(127);
    const B = newBank(phone, '乙'); await phone.pg.runTimers();
    phone.writeFail = keys => keys.indexOf('sync_del') >= 0;
    deleteBank(phone, A); await phone.pg.runTimers();
    await phone.pg.fire('win:pagehide'); await phone.pg.fire('win:online');
    const c1 = cloudOf(w, 'vgame_banks'), led = Object.keys(ledgerOf(phone));
    const held = ids(c1).includes(A) && led.indexOf('vgame_banks') >= 0 && led.indexOf('sync_del') >= 0;
    phone.writeFail = null;
    await phone.pg.fire('win:pagehide');
    const c2 = cloudOf(w, 'vgame_banks'), t2 = cloudOf(w, 'sync_del');
    const done = !ids(c2).includes(A) && ids(c2).includes(B) && !!(t2 && t2.vgame_banks.b[A]) && !Object.keys(ledgerOf(phone)).length;
    return { ok: held && done, detail: '失敗時雲端 ' + J(ids(c1)) + ' 帳本 ' + J(led) + ' / 恢復後雲端 ' + J(ids(c2)) + ' 標記有A ' + !!(t2 && t2.vgame_banks.b[A]) + ' 帳本 ' + J(Object.keys(ledgerOf(phone))) };
  },
  '28. (r3 #3)小雞開關關著時只寫本機的 pet(只有「只在本機」標記),登出時讀得到雲端、上傳失敗:跟 main 一樣只送一次讀和一次寫,帳本不記 pet,之後 online/關頁也不補傳 pet': async () => {
    const P = items => ({ v: 1, items });
    const fakePet = () => ({ cloudMerge(a, b) {
      const ok = x => !!x && typeof x === 'object' && !Array.isArray(x);
      if (!ok(a) || !ok(b)) return { ok: false };
      const v = { v: 1, items: [...new Set([].concat(a.items || [], b.items || []))].sort() };
      return { ok: true, v, sameAsLocal: J(v) === J(a), sameAsCloud: J(v) === J(b) };
    } });
    const w = makeWorld(128);
    setCloud(w, 'pet', P(['a']), H.T0 - 864e5);
    const dev = makeDevice(w, '手機');
    await signIn(dev);
    dev.pg.ctx.PET = fakePet();
    w.clock.t += 1000;
    dev.local.setItem(PREFIX + 'pet', J(P(['a', 'b'])));
    dev.pg.ctx.CLOUD.markLocalOnly('pet');
    const markAt = new Date(w.clock.t).toISOString();
    w.clock.t += 5000;
    dev.writeFail = keys => keys.indexOf('pet') >= 0;
    dev.confirmAnswer = false;
    dev.ops = [];
    await dev.pg.ctx.CLOUD.logout(); await tick(10);
    const petOps = () => dev.ops.filter(o => o.keys.indexOf('pet') >= 0).map(o => o.op + (o.op === 'write' ? '@' + o.rows.find(r => r.k === 'pet').updated_at : ''));
    const atLogout = petOps(), led = Object.keys(ledgerOf(dev));
    dev.ops = [];
    w.clock.t += 60e3;
    await dev.pg.fire('win:online');
    await dev.pg.fire('win:pagehide');
    const after = petOps();
    const ok = J(atLogout) === J(['read', 'write@' + markAt]) && led.indexOf('pet') < 0 && !after.length && dev.confirms.length === 1;
    return { ok, detail: '登出時 pet 的請求 ' + J(atLogout) + ' / 帳本 ' + J(led) + ' / 之後 ' + J(after) + ' / 問了 ' + dev.confirms.length + ' 次' };
  },
};

(async () => {
  let pass = 0;
  for (const [name, fn] of Object.entries(scenarios)) {
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, detail: '例外 ' + (e && e.stack || e) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + r.detail);
  }
  const total = Object.keys(scenarios).length;
  console.log(pass + ' / ' + total + ' 通過');
  process.exit(pass === total ? 0 : 1);
})();
