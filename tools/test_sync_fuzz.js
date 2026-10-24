/* 多台裝置隨機操作的模糊測試(同步合併設計第五節):證明「任何一台曾經同步上去的自訂題目,除非被使用者刪除,不會從雲端或任何裝置消失」。
   用法:node tools/test_sync_fuzz.js              (N=序列數 SEED=種子 可以換;預設 2000 組依序 + 300 組搶時間 + 300 組混舊版)
   頁面是真的 js/sync-merge.js 與 js/cloud.js(假的 Supabase 在 tools/sync_harness.js)。每一組:2 到 3 台裝置、10 到 16 個隨機操作
   (加字、改中文、勾選、改名、刪字、刪題庫、存入文章題庫、模擬考交卷、上傳、關頁補傳、斷線、恢復連線、App 重開(灌資料)、換頁、
   開單字頁(syncKey)、登出、重新登入、App 被殺),最後全部連上、各自重開一次再開一次單字頁。
   有三成的序列一開始雲端就有一個部署前的舊題庫,裡面同一個英文出現兩次(run/跑、Run/經營,舊資料可能有)。
   - A 依序(新版頁面,一次一個操作做完):每一步之後
       雲端:曾經在雲端出現過、沒被使用者刪掉的字都還在;
       本機:每台登入中的裝置,曾經在它本機出現過、沒被刪掉的字都還在;
       登出:沒問就登出的,那一刻它本機的字雲端都有;
     最後雲端與每台登入中的裝置題庫一樣(stateKey)、模擬考紀錄一樣而且一筆不少。
   - B 搶時間(兩台的上傳同時讀雲端、同時寫,後到的蓋掉先到的;已知限制 1):本機每一步都不少;最後收斂、雲端一個都不少。
   - C 混一台舊版頁面(main 4c823ec 的 cloud.js、編輯頁開著時記住的整份陣列寫回;已知限制 2):新版裝置本機每一步都不少;
     最後每台還登入中的新版裝置出現過的字雲端都有、新版裝置跟雲端一樣。已經登出的新版裝置傳上去的字可能被舊版整份上傳蓋掉
     (登出那一刻雲端有,之後才被蓋掉:已知限制 2、6),舊版自己的資料也不保證(舊版本來就會掉,這次修不到)。
   「被使用者刪掉」:在新版頁面刪字、刪題庫(舊版頁面刪的不算,會回來)。刪除那一刻之前就存在的同一個字(題庫 id + 英文)都算刪掉;
   之後新加的(新的 _r)不算。字比「題庫 id + 英文」在不在;同一個英文兩台同時加的會合成一個(另一個中文放 alt)。
   中文另外比(不用 SYNC_MERGE 的任何函式):每個字的中文和 alt 裡的每一個(題庫|英文|中文)跟字一樣只能多不能少,
   除了被刪掉的、和某一台在自己畫面上換掉的(那台的使用者改中文、批次加字更新中文,本機少了它)。 */
const H = require('./sync_harness');
const { J, makeWorld, makeDevice, signIn, newSession, open, logout, loggedIn, banksOf, localOf, cloudOf, storeSet, setCloud,
  newBank, addWords, setWord, rename, deleteWord, deleteBank, oldEdit, oldOpenEditor, mockSubmit, idents, PID } = H;

const N = Number(process.env.N || 2000), NB = Number(process.env.NB || 300), NC = Number(process.env.NC || 300);
const SEED = Number(process.env.SEED || 20261024);
const EN = ['apple', 'banana', 'cherry', 'put on', 'take off', 'schedule', 'invoice', 'deadline', 'refund', 'Apple', 'venue', 'quota'];
const ZH = ['蘋果', '香蕉', '櫻桃', '穿上', '脫下', '行程表', '發票', '截止日', '退款', '場地', '配額', '時間表'];
const ARTICLES = { art_1: [['refund', '退款'], ['invoice', '發票']], art_2: [['venue', '場地'], ['quota', '配額'], ['apple', '蘋果']] };
const key = s => String(s).toLowerCase().trim().replace(/\s+/g, ' ');
/* 題庫裡的每一個中文(主要的和 alt 的):題庫 id|norm(en)|去空白的中文 */
function zhItems(banks) {
  const out = new Set();
  (Array.isArray(banks) ? banks : []).forEach(b => {
    if (!b || typeof b.id !== 'string' || !Array.isArray(b.words)) return;
    b.words.forEach(w => {
      if (!w || typeof w.en !== 'string') return;
      [w.zh].concat(Array.isArray(w.alt) ? w.alt : []).forEach(z => { if (typeof z === 'string' && z.trim()) out.add(b.id + '|' + key(w.en) + '|' + z.replace(/\s+/g, '')); });
    });
  });
  return out;
}
const USER_EDIT = /^d\d+ (加字|新增題庫|改中文|勾選|改名|刪字|刪題庫|單字存入題庫) /;

function runOne(seed, mode) {
  const w = makeWorld(seed);
  const rnd = w.rand;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const chance = p => rnd() < p;
  const nDev = 2 + (chance(0.4) ? 1 : 0);
  const devs = [];
  for (let i = 0; i < nDev; i++) devs.push(makeDevice(w, 'd' + i, { old: mode === 'C' && i === nDev - 1 }));
  devs.forEach(d => { d.skew = Math.floor((rnd() - 0.5) * 6 * 3600e3); });
  const fresh = devs.filter(d => !d.old);
  if (chance(0.3)) setCloud(w, 'vgame_banks', [{ id: 'bLegacy', name: '舊資料', words: [{ en: 'run', zh: '跑', on: true }, { en: 'Run', zh: '經營', on: true }, { en: 'refund', zh: '退款', on: true }] }]);
  /* 追蹤:每個字(題庫|英文|_r)第一次出現在第幾步;刪除:題庫|英文、題庫 → 第幾步 */
  let step = 0;
  const first = new Map(), delKey = new Map(), delBank = new Map();
  const protCloud = new Set(), protDev = new Map();   // 裝置 → 它本機出現過的字
  const firstZ = new Map(), supZ = new Map(), protZCloud = new Set(), protZDev = new Map();   // 中文:第一次出現、被某台自己換掉的那一步
  const mocks = new Set();
  const log = [];
  const fail = msg => { const e = new Error(msg); e.log = log; throw e; };
  const exempt = id => {
    const [b, k] = id.split('|');
    const f = first.get(id) || 0;
    return (delKey.get(b + '|' + k) || -1) >= f || (delBank.get(b) || -1) >= f;
  };
  const keysOf = banks => new Set([...idents(banks)].map(s => s.split('|').slice(0, 2).join('|')));
  const present = (banks, id) => keysOf(banks).has(id.split('|').slice(0, 2).join('|'));
  const see = banks => {
    idents(banks).forEach(id => { if (!first.has(id)) first.set(id, step); });
    zhItems(banks).forEach(it => { if (!firstZ.has(it)) firstZ.set(it, step); });
  };
  const exemptZ = it => {
    const [b, k] = it.split('|');
    const f = firstZ.get(it) || 0;
    return (delKey.get(b + '|' + k) || -1) >= f || (delBank.get(b) || -1) >= f || (supZ.get(it) || -1) >= f;
  };
  const isNew = d => !d.old;

  function observe() {
    fresh.forEach(d => { if (loggedIn(d)) see(banksOf(d)); });
    see(cloudOf(w, 'vgame_banks'));
    fresh.forEach(d => {
      if (!loggedIn(d)) return;
      const had = protDev.get(d) || new Set();
      idents(banksOf(d)).forEach(id => had.add(id));
      protDev.set(d, had);
      const hz = protZDev.get(d) || new Set();
      zhItems(banksOf(d)).forEach(it => hz.add(it));
      protZDev.set(d, hz);
    });
    if (mode !== 'C') idents(cloudOf(w, 'vgame_banks')).forEach(id => protCloud.add(id));
    if (mode === 'A') zhItems(cloudOf(w, 'vgame_banks')).forEach(it => protZCloud.add(it));
    const cm = cloudOf(w, 'mock_history');
    (Array.isArray(cm) ? cm : []).forEach(r => mocks.add(r.d + '|' + r.lRaw));
  }
  function check(where) {
    fresh.forEach(d => {
      if (!loggedIn(d)) return;
      const b = banksOf(d);
      (protDev.get(d) || new Set()).forEach(id => { if (!exempt(id) && !present(b, id)) fail(where + ':' + d.name + ' 本機少了 ' + id); });
      const z = zhItems(b);
      (protZDev.get(d) || new Set()).forEach(it => { if (!exemptZ(it) && !z.has(it)) fail(where + ':' + d.name + ' 本機中文不見了 ' + it); });
    });
    if (mode === 'A') {
      const c = cloudOf(w, 'vgame_banks');
      protCloud.forEach(id => { if (!exempt(id) && !present(c, id)) fail(where + ':雲端少了 ' + id); });
      const zc = zhItems(c);
      protZCloud.forEach(it => { if (!exemptZ(it) && !zc.has(it)) fail(where + ':雲端中文不見了 ' + it); });
      const cm = (cloudOf(w, 'mock_history') || []).map(r => r.d + '|' + r.lRaw);
      mocks.forEach(m => { if (cm.indexOf(m) < 0) fail(where + ':雲端模擬考少了 ' + m); });
    }
  }
  /* 刪除:記下刪除那一步,這一步之前就有的同一個字都算刪掉 */
  function markDelete(d, bid, en) {
    if (en === null) delBank.set(bid, step); else delKey.set(bid + '|' + key(en), step);
  }

  async function act(d) {
    const pg = d.pg;
    const r = rnd();
    const banks = loggedIn(d) ? banksOf(d) : [];
    const bids = banks.filter(b => b && typeof b.id === 'string').map(b => b.id);
    if (!loggedIn(d)) {
      if (r < 0.5 && !d.offline) { log.push(d.name + ' 登入'); await signIn(d); protDev.set(d, new Set()); protZDev.set(d, new Set()); return; }
      if (r < 0.7) { d.offline = !d.offline; log.push(d.name + (d.offline ? ' 斷線' : ' 連上')); return; }
      return;
    }
    if (d.old) {
      if (r < 0.15) { oldOpenEditor(d); log.push(d.name + ' 舊版開編輯頁'); return; }
      if (r < 0.45 && (d.snapshot || []).length) {
        const i = Math.floor(rnd() * d.snapshot.length), en = pick(EN), zh = pick(ZH);
        oldEdit(d, arr => { const b = arr[i]; if (!b) return; b.words = b.words || []; const ex = b.words.find(x => key(x.en) === key(en)); if (ex) ex.zh = zh; else b.words.push({ en, zh, on: true }); });
        log.push(d.name + ' 舊版加字 ' + en); return;
      }
      if (r < 0.55 && (d.snapshot || []).length) {
        const i = Math.floor(rnd() * d.snapshot.length);
        oldEdit(d, arr => { if (arr[i] && arr[i].words && arr[i].words.length) arr[i].words.pop(); });
        log.push(d.name + ' 舊版刪字(沒有標記)'); return;
      }
      if (r < 0.6) { oldEdit(d, arr => { arr.push({ id: 'b' + Math.floor(rnd() * 1e9).toString(36), name: '舊版新題庫', words: [{ en: pick(EN), zh: pick(ZH), on: true }] }); }); log.push(d.name + ' 舊版新增題庫'); return; }
      if (r < 0.8) { await pg.runTimers(); log.push(d.name + ' 舊版上傳'); return; }
      if (r < 0.88) { d.offline = !d.offline; log.push(d.name + (d.offline ? ' 斷線' : ' 連上')); if (!d.offline) await pg.fire('win:online'); return; }
      await newSession(d); log.push(d.name + ' 舊版重開'); return;
    }
    if (r < 0.22) {
      const id = bids.length && chance(0.8) ? pick(bids) : newBank(d, '題庫' + Math.floor(rnd() * 99));
      const list = [{ en: pick(EN), zh: pick(ZH) }].concat(chance(0.3) ? [{ en: pick(EN), zh: pick(ZH) }] : []);
      addWords(d, id, list); log.push(d.name + ' 加字 ' + id + ' ' + J(list.map(x => x.en)));
      return;
    }
    if (r < 0.27) { const id = newBank(d, '新題庫'); log.push(d.name + ' 新增題庫 ' + id); return; }
    if (r < 0.35 && bids.length) {
      const pid = pick(bids), b = banks.find(x => x.id === pid); const wd = (b.words || [])[Math.floor(rnd() * (b.words || []).length)];
      if (wd) { setWord(d, b.id, wd.en, { zh: pick(ZH) }); log.push(d.name + ' 改中文 ' + b.id + ' ' + wd.en); }
      return;
    }
    if (r < 0.39 && bids.length) {
      const pid = pick(bids), b = banks.find(x => x.id === pid); const wd = (b.words || [])[Math.floor(rnd() * (b.words || []).length)];
      if (wd) { setWord(d, b.id, wd.en, { on: wd.on === false }); log.push(d.name + ' 勾選 ' + b.id + ' ' + wd.en); }
      return;
    }
    if (r < 0.42 && bids.length) { const id = pick(bids); rename(d, id, '改名' + Math.floor(rnd() * 99)); log.push(d.name + ' 改名 ' + id); return; }
    if (r < 0.49 && bids.length) {
      const pid = pick(bids), b = banks.find(x => x.id === pid); const wd = (b.words || [])[Math.floor(rnd() * (b.words || []).length)];
      if (wd) { markDelete(d, b.id, wd.en); deleteWord(d, b.id, wd.en); log.push(d.name + ' 刪字 ' + b.id + ' ' + wd.en); }
      return;
    }
    if (r < 0.52 && bids.length) { const id = pick(bids); markDelete(d, id, null); deleteBank(d, id); log.push(d.name + ' 刪題庫 ' + id); return; }
    if (r < 0.56) {
      const aid = pick(Object.keys(ARTICLES));
      addWords(d, aid, ARTICLES[aid].map(([en, zh]) => ({ en, zh })));
      if (!banksOf(d).find(b => b.id === aid).name) rename(d, aid, '文章：' + aid);
      log.push(d.name + ' 單字存入題庫 ' + aid); return;
    }
    if (r < 0.58 && mocks.size < 20) { mockSubmit(d, Math.floor(rnd() * 10)); log.push(d.name + ' 模擬考交卷'); return; }
    if (r < 0.70) { await pg.runTimers(); log.push(d.name + ' 上傳'); return; }
    if (r < 0.74) { await pg.fire('win:pagehide'); log.push(d.name + ' 關頁補傳'); return; }
    if (r < 0.80) { d.offline = !d.offline; log.push(d.name + (d.offline ? ' 斷線' : ' 連上')); if (!d.offline) await pg.fire('win:online'); return; }
    if (r < 0.85) { await newSession(d); log.push(d.name + ' App 重開(灌資料)'); return; }
    if (r < 0.88) { pg.close(); await open(d); log.push(d.name + ' 換頁'); return; }
    if (r < 0.92) { const x = await pg.ctx.CLOUD.syncKey('vgame_banks'); log.push(d.name + ' 開單字頁 ' + J(x)); return; }
    if (r < 0.94) { pg.close(); await open(d); log.push(d.name + ' App 被殺(沒有關頁事件)'); return; }
    if (r < 0.97 && (mode === 'A' || !d.offline)) {
      d.confirmAnswer = false;
      const mine = new Set(idents(banksOf(d)));
      const done = await logout(d);
      log.push(d.name + ' 登出 ' + (done ? '完成' : '取消(有沒同步的)'));
      if (done) {
        const c = cloudOf(w, 'vgame_banks');
        mine.forEach(id => { if (!exempt(id) && !present(c, id)) fail('登出:' + d.name + ' 沒問就登出,雲端少了 ' + id); });
        protDev.delete(d); protZDev.delete(d);
      }
      return;
    }
    return;
  }

  return (async () => {
    for (const d of devs) { await signIn(d); protDev.set(d, new Set()); }
    observe();
    const steps = 10 + Math.floor(rnd() * 7);
    for (let s = 0; s < steps; s++) {
      step++;
      w.clock.t += Math.floor(rnd() * 600e3);
      if (mode === 'B' && chance(0.3)) {
        const two = fresh.filter(d => loggedIn(d) && d.pg.pending());
        if (two.length >= 2) { log.push('同時上傳 ' + two.map(d => d.name).join('+')); await Promise.all(two.map(d => d.pg.runTimers())); observe(); check('第 ' + s + ' 步'); continue; }
      }
      const d = pick(devs);
      const beforeZ = !d.old && loggedIn(d) ? zhItems(banksOf(d)) : null, nlog = log.length;
      await act(d);
      /* 這台的使用者自己在畫面上改的:本機少了的中文是學生換掉的,不算不見 */
      if (beforeZ && log.length > nlog && USER_EDIT.test(log[log.length - 1])) {
        const afterZ = zhItems(banksOf(d));
        beforeZ.forEach(it => { if (!afterZ.has(it)) supZ.set(it, step); });
      }
      if (process.env.DEBUG) {
        const brief = b => (Array.isArray(b) ? b : []).map(x => x.id + ':' + x._r + '[' + (x.words || []).map(y => y.en + '/' + y._r).join(',') + ']').join(' ');
        log.push('    雲端 ' + brief(cloudOf(w, 'vgame_banks')) + ' 標記 ' + J(cloudOf(w, 'sync_del') && cloudOf(w, 'sync_del').vgame_banks.b));
        devs.forEach(x => log.push('    ' + x.name + (loggedIn(x) ? '' : '(登出)') + ' ' + brief(banksOf(x)) + ' 帳本 ' + J(Object.keys(H.ledgerOf(x)))));
      }
      observe();
      check('第 ' + s + ' 步(' + log[log.length - 1] + ')');
    }
    /* 最後:全部連上;登入中的新版裝置各自重開一次(灌資料),再各開一次單字頁(syncKey)、關頁補傳 */
    step++;
    devs.forEach(d => { d.offline = false; d.readError = false; });
    for (const d of devs) if (d.old && loggedIn(d)) { await d.pg.fire('win:online'); }
    for (let round = 0; round < 2; round++) {
      for (const d of fresh) if (loggedIn(d)) { if (round === 0) await newSession(d); else { await d.pg.ctx.CLOUD.syncKey('vgame_banks'); await d.pg.ctx.CLOUD.syncKey('mock_history'); await d.pg.fire('win:pagehide'); } }
      observe();
      check('最後第 ' + (round + 1) + ' 輪');
    }
    const c = cloudOf(w, 'vgame_banks');
    const live = fresh.filter(loggedIn);
    /* C:舊版頁面整份上傳會把雲端蓋掉;有這個字的新版裝置都已經登出時救不回(舊版本來就會掉)。改看「每台還登入的新版裝置出現過的字雲端都有」+「跟雲端一樣」 */
    if (mode !== 'C') protCloud.forEach(id => { if (!exempt(id) && !present(c, id)) fail('最後:雲端少了 ' + id); });
    else live.forEach(d => (protDev.get(d) || new Set()).forEach(id => { if (!exempt(id) && !present(c, id)) fail('最後:' + d.name + ' 出現過的 ' + id + ' 雲端沒有'); }));
    live.forEach(d => {
      if (w.SM.stateKey(banksOf(d)) !== w.SM.stateKey(c || [])) fail('最後:' + d.name + ' 跟雲端不一樣 ' + J(banksOf(d)).slice(0, 300) + ' ≠ ' + J(c).slice(0, 300));
      if (J(localOf(d, 'mock_history') || []) !== J(cloudOf(w, 'mock_history') || [])) fail('最後:' + d.name + ' 模擬考紀錄跟雲端不一樣');
    });
    const cm = (cloudOf(w, 'mock_history') || []).map(r => r.d + '|' + r.lRaw);
    if (mode !== 'C') mocks.forEach(m => { if (cm.indexOf(m) < 0) fail('最後:雲端模擬考少了 ' + m); });
    return { steps, words: keysOf(c).size, deletes: delKey.size + delBank.size, live: live.length };
  })().catch(e => { e.log = log; throw e; });
}

(async () => {
  if (process.env.ONE) {   // 只跑一組,印出全部步驟:ONE=種子 MODE=A|B|C
    try { console.log(J(await runOne(Number(process.env.ONE), process.env.MODE || 'A'))); }
    catch (e) { console.log((e.log ? e.message : e.stack) + '\n' + (e.log || []).join('\n')); }
    return;
  }
  let pass = 0, fail = 0;
  const report = (name, ok, detail) => { if (ok) pass++; else fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + detail); };
  for (const [mode, count, label] of [['A', N, 'A 依序(新版頁面)'], ['B', NB, 'B 兩台同時上傳(搶時間)'], ['C', NC, 'C 混一台舊版頁面']]) {
    let ok = 0, words = 0, dels = 0, firstErr = null;
    const t0 = Date.now();
    for (let i = 0; i < count; i++) {
      const seed = (SEED + i * 7919 + mode.charCodeAt(0) * 104729) >>> 0;
      try { const r = await runOne(seed, mode); ok++; words += r.words; dels += r.deletes; }
      catch (e) { if (!firstErr) firstErr = 'seed ' + seed + ':' + (e.log ? e.message : e.stack) + '\n    ' + (e.log || []).slice(-14).join('\n    '); }
    }
    report(label + ':' + count + ' 組隨機操作序列', ok === count,
      ok + ' / ' + count + ' 組通過,平均每組最後 ' + (words / Math.max(1, ok)).toFixed(1) + ' 個字、刪除 ' + (dels / Math.max(1, ok)).toFixed(1) + ' 次,' + Math.round((Date.now() - t0) / 1000) + ' 秒' + (firstErr ? '\n  第一個失敗 ' + firstErr : ''));
  }
  console.log(pass + ' / ' + (pass + fail) + ' 通過');
  process.exit(fail ? 1 : 0);
})();
