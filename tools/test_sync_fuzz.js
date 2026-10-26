/* 多台裝置隨機操作的模糊測試(同步合併設計第五節):證明「任何一台曾經同步上去的自訂題目,除非被使用者刪除,不會從雲端或任何裝置消失」。
   用法:node tools/test_sync_fuzz.js              (N=序列數 SEED=種子 可以換;預設 2000 組依序 + 300 組搶時間 + 300 組混舊版)
   頁面是真的 js/sync-merge.js 與 js/cloud.js(假的 Supabase 在 tools/sync_harness.js)。每一組:2 到 3 台裝置、10 到 16 個隨機操作
   (加字、改中文、勾選、改名、刪字、刪題庫、存入文章題庫、模擬考交卷、上傳、關頁補傳、斷線、恢復連線、App 重開(灌資料)、換頁、
   開單字頁(syncKey)、登出、重新登入、App 被殺),最後全部連上、各自重開一次再開一次單字頁。
   有三成的序列一開始雲端就有一個部署前的舊題庫,裡面同一個英文出現兩次(run/跑、Run/經營,舊資料可能有);有它時會把第一個 run 的中文
   在 跑/跑步/慢跑 之間換來換去(含改回原本的)、刪 alt、把 alt 換成主要的。新版改內容會換 _r,這些操作做不出「跟以前某一版一模一樣」的字;
   所以另外有「這個分支早期的頁面改回以前那一版」:把 run 或 refund 的中文、勾選、alt 改回這個字以前的某一版(這台看過、雜湊在它的 _p 裡),
   _r、_m 原樣留著(早期的頁面改內容不換 _r),_p 記改前那一版。那一版的 _r 跟現在一樣時(之後只有合併改過 alt、或也是早期的頁面改的)
   內容就跟那一版一模一樣,跟別台的版本互相吸收過,重複英文那一組的 absorbZh、joinWord 的「互相吸收過」才走得到(第三輪審查 r3 #4;
   每組結果印出改回幾次、其中一模一樣幾次)。以前連 _r 一起抄、也會抄到重複英文那一組另一個 run 的版本,做出早期的頁面也做不出的資料
   (兩個 run 雜湊一樣、改回新版才有的版本),換種子會失敗(第三輪審查第二批 r3b #2)。
   改回的那個中文不重新保護(別台同時從那一版改過時,早期的頁面本來就會被當成舊版本);這個操作守的是別台打的中文、字、最後收斂。
   被刪過的字不改回(改回的可能就是刪掉的那個樣子)。重複英文那一組的細節(繞一圈吸收、兩個輸家的順序、_p 滿了、沒有新的 alt)
   在 tools/test_sync_merge.js 的「重複英文那一組」用手寫的資料守。
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
   除了被刪掉的、和某一台在自己畫面上換掉的(那台的使用者改中文、批次加字更新中文,本機少了它)。
   學生又打回以前被換掉的中文(別的地方都沒有它的時候),從那一步重新保護:之前的「換掉」「刪掉」不再豁免它。
   另外(r3b #7):同一個英文(norm)在一個題庫裡不會有兩個字(重複英文的舊資料除外);重複英文那一組的 run 和 Run(英文完全一樣)
   出現過就一直在;A、B 最後,只有一台的使用者改過的勾選、題庫名稱,每台和雲端都是那台最後改的樣子(兩台都改過的是衝突,看時鐘,不斷言)。 */
const H = require('./sync_harness');
const { J, makeWorld, makeDevice, signIn, newSession, open, logout, loggedIn, banksOf, localOf, cloudOf, storeSet, setCloud,
  newBank, addWords, setWord, rename, deleteWord, deleteBank, oldEdit, oldOpenEditor, mockSubmit, idents, PID } = H;

const N = Number(process.env.N || 2000), NB = Number(process.env.NB || 300), NC = Number(process.env.NC || 300);
const SEED = Number(process.env.SEED || 20261024);
const EN = ['apple', 'banana', 'cherry', 'put on', 'take off', 'schedule', 'invoice', 'deadline', 'refund', 'Apple', 'venue', 'quota'];
const ZH = ['蘋果', '香蕉', '櫻桃', '穿上', '脫下', '行程表', '發票', '截止日', '退款', '場地', '配額', '時間表'];
const LEGACY_ZH = ['跑', '跑步', '慢跑'];
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
const RESTORE_EN = ['run', 'refund'];
/* 字的「內容」(不含 _t、_p);早期的頁面改的是畫面上看得到的中文、勾選、alt,_r 和 _m 原樣留著(bf1f594 之前改內容不換 _r) */
const CONTENT = ['zh', 'on', 'alt', '_r', '_m'], EDITABLE = ['zh', 'on', 'alt'];
const contentOf = x => J(CONTENT.map(k => (x[k] === undefined ? null : x[k])));
const editableOf = x => J(EDITABLE.map(k => (x[k] === undefined ? null : x[k])));

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
  /* 中文:firstZ 是這個中文「這一次」出現的那一步(學生又打了一次以前被換掉的中文,從那一步重新算);supZ 是被某台自己換掉的那一步。
     protZCloud、protZDev 記每個中文從哪一步起要保護(拿到它那一刻的 firstZ);不見了、而且是被刪掉或換掉的,就不再保護,之後又出現再從那時的 firstZ 算 */
  const firstZ = new Map(), supZ = new Map(), protZCloud = new Map(), protZDev = new Map();
  const mocks = new Set();
  const seenVer = new Map();   // 裝置 → bLegacy 的 run、refund 在它本機出現過的每一版(內容)
  let restoredAny = false, restores = 0, restoredSame = 0;
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
  const exemptZ = (it, f) => {
    const [b, k] = it.split('|');
    return (delKey.get(b + '|' + k) || -1) >= f || (delBank.get(b) || -1) >= f || (supZ.get(it) || -1) >= f;
  };
  const isNew = d => !d.old;
  function guardZ(m, z) {
    m.forEach((f, it) => { if (!z.has(it) && exemptZ(it, f)) m.delete(it); });
    z.forEach(it => { if (!m.has(it)) m.set(it, firstZ.get(it) || 0); });
    return m;
  }
  /* 重複英文那一組的 run 和 Run(英文完全一樣才算):present() 用 norm(en) 比,兩個是同一個鍵,少了一個抓不到。出現過就要一直在(被刪過就不算) */
  const LEG_EN = ['run', 'Run'];
  const legacyEns = banks => { const b = (Array.isArray(banks) ? banks : []).find(x => x && x.id === 'bLegacy');
    return new Set(b && Array.isArray(b.words) ? b.words.filter(x => x && LEG_EN.indexOf(x.en) >= 0).map(x => x.en) : []); };
  const legGone = () => delKey.has('bLegacy|run') || delBank.has('bLegacy');
  const exactCloud = new Set(), exactDev = new Map();
  /* 同一個英文(norm)在一個題庫裡只會有一個字(重複英文的舊資料 bLegacy|run 除外):多出來的就是合併時多複製了一份 */
  const dupOf = banks => {
    for (const b of (Array.isArray(banks) ? banks : [])) {
      if (!b || !Array.isArray(b.words)) continue;
      const seen = new Set();
      for (const x of b.words) {
        if (!x || typeof x.en !== 'string') continue;
        const k = b.id + '|' + key(x.en);
        if (k === 'bLegacy|run') continue;
        if (seen.has(k)) return k;
        seen.add(k);
      }
    }
    return null;
  };
  /* 勾選和題庫名稱:只看「只有一台的使用者改過」的(兩台都改過就是衝突,誰當主要看時鐘,不能斷言);那台最後一次改的就是最後每台和雲端的樣子。
     新增題庫時取的名稱不算改名(別台要先拿到這個題庫才改得了名);文章題庫是各台各自建立的,存入時取名算改名 */
  const wordEd = new Map(), bankEd = new Map();
  const editWord = (d, bid, en, kind, v) => { const k = bid + '|' + key(en); const e = wordEd.get(k) || wordEd.set(k, { devs: new Set() }).get(k); e.devs.add(d); e.kind = kind; e.v = v; };
  const editName = (d, bid, name, created) => { const e = bankEd.get(bid) || bankEd.set(bid, { devs: new Set() }).get(bid); if (created) e.created = name; else { e.devs.add(d); e.name = name; } };

  function observe() {
    fresh.forEach(d => { if (loggedIn(d)) see(banksOf(d)); });
    see(cloudOf(w, 'vgame_banks'));
    fresh.forEach(d => {
      if (!loggedIn(d)) return;
      const lb = banksOf(d).find(b => b && b.id === 'bLegacy');
      (lb && lb.words || []).forEach(x => {
        if (!x || RESTORE_EN.indexOf(x.en) < 0) return;
        const m = seenVer.get(d) || seenVer.set(d, new Map()).get(d), list = m.get(x.en) || m.set(x.en, []).get(x.en);
        if (!list.some(v => contentOf(v) === contentOf(x))) list.push(JSON.parse(J(x)));
      });
      const had = protDev.get(d) || new Set();
      idents(banksOf(d)).forEach(id => had.add(id));
      protDev.set(d, had);
      const ex = exactDev.get(d) || new Set();
      legacyEns(banksOf(d)).forEach(en => ex.add(en));
      exactDev.set(d, ex);
      protZDev.set(d, guardZ(protZDev.get(d) || new Map(), zhItems(banksOf(d))));
    });
    if (mode !== 'C') idents(cloudOf(w, 'vgame_banks')).forEach(id => protCloud.add(id));
    if (mode !== 'C') legacyEns(cloudOf(w, 'vgame_banks')).forEach(en => exactCloud.add(en));
    if (mode === 'A') guardZ(protZCloud, zhItems(cloudOf(w, 'vgame_banks')));
    const cm = cloudOf(w, 'mock_history');
    (Array.isArray(cm) ? cm : []).forEach(r => mocks.add(r.d + '|' + r.lRaw));
  }
  function check(where) {
    fresh.forEach(d => {
      if (!loggedIn(d)) return;
      const b = banksOf(d);
      (protDev.get(d) || new Set()).forEach(id => { if (!exempt(id) && !present(b, id)) fail(where + ':' + d.name + ' 本機少了 ' + id); });
      const z = zhItems(b);
      (protZDev.get(d) || new Map()).forEach((f, it) => { if (!exemptZ(it, f) && !z.has(it)) fail(where + ':' + d.name + ' 本機中文不見了 ' + it); });
      const dup = dupOf(b);
      if (dup) fail(where + ':' + d.name + ' 本機同一個字有兩份 ' + dup);
      const le = legacyEns(b);
      if (!legGone()) (exactDev.get(d) || new Set()).forEach(en => { if (!le.has(en)) fail(where + ':' + d.name + ' 本機重複英文那一組少了 bLegacy|' + en); });
    });
    const dupC = dupOf(cloudOf(w, 'vgame_banks'));
    if (dupC) fail(where + ':雲端同一個字有兩份 ' + dupC);
    if (mode === 'A') {
      const c = cloudOf(w, 'vgame_banks');
      protCloud.forEach(id => { if (!exempt(id) && !present(c, id)) fail(where + ':雲端少了 ' + id); });
      const lc = legacyEns(c);
      if (!legGone()) exactCloud.forEach(en => { if (!lc.has(en)) fail(where + ':雲端重複英文那一組少了 bLegacy|' + en); });
      const zc = zhItems(c);
      protZCloud.forEach((f, it) => { if (!exemptZ(it, f) && !zc.has(it)) fail(where + ':雲端中文不見了 ' + it); });
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
      if (r < 0.5 && !d.offline) { log.push(d.name + ' 登入'); await signIn(d); protDev.set(d, new Set()); protZDev.set(d, new Map()); exactDev.set(d, new Set()); return; }
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
    /* 這個分支早期的頁面(改內容不換 _r):把 run 或 refund 的中文、勾選、alt 改回這個字以前的某一版(這台看過、雜湊在它的 _p 裡),
       _r、_m 原樣留著,_p 記改前那一版。那一版的 _r 跟現在一樣(之後只有合併改過 alt,或也是早期的頁面改的)時,內容就跟那一版一模一樣。
       以前連 _r 一起抄、也會抄到重複英文那一組另一個 run 的版本:兩個 run 雜湊一樣、或改回新版才有的版本,早期的頁面做不出這種資料
       (第三輪審查第二批 r3b #2 找到的 6 組種子都是這樣) */
    const restorable = en => { const cur = (banks.find(b => b.id === 'bLegacy') || {}).words || []; const c = cur.find(x => x && x.en === en);
      const past = c && Array.isArray(c._p) ? c._p.map(e => String(e).split('.')[0]) : [];
      return c ? ((seenVer.get(d) || new Map()).get(en) || []).filter(v => editableOf(v) !== editableOf(c) && past.indexOf(w.SM.wordHash(v)) >= 0) : []; };
    /* 這個字被刪過就不改回:改回的那一版可能就是刪掉的那個樣子(刪除標記記的是它的雜湊),早期的頁面本來就會被刪掉(第三輪起新版換 _r 修好) */
    const canRestore = bids.indexOf('bLegacy') >= 0 && !delBank.has('bLegacy') ? RESTORE_EN.filter(en => !delKey.has('bLegacy|' + en) && restorable(en).length) : [];
    if (canRestore.length && chance(0.3)) {
      const lw = banks.find(b => b.id === 'bLegacy').words || [];
      const en = pick(canRestore), i = lw.findIndex(x => x && x.en === en), vers = restorable(en);
      const v = pick(vers), t = H.now(d) + 1000, SM = w.SM;
      H.edit(d, 'bLegacy', b => {
        const ws = (b.words || []).slice(), c = ws[i];
        if (!c || c.en !== en) return b;
        const nx = Object.assign({}, c);
        EDITABLE.forEach(k => { if (v[k] === undefined) delete nx[k]; else nx[k] = v[k]; });
        if (SM.wordHash(nx) === SM.wordHash(v)) restoredSame++;
        nx._t = t;
        const p = [SM.wordHash(c) + '.' + t.toString(36)].concat(Array.isArray(c._p) ? c._p : []);
        nx._p = p.filter((e, j) => p.findIndex(o => o.split('.')[0] === e.split('.')[0]) === j && e.split('.')[0] !== SM.wordHash(nx)).slice(0, 4);
        ws[i] = nx;
        return Object.assign({}, b, { words: ws });
      });
      restoredAny = true; restores++; editWord(d, 'bLegacy', en, 'zh');
      log.push(d.name + ' 改中文 bLegacy ' + en + ' 改回以前那一版(早期的頁面) ' + v.zh + (v.on === false ? ' 取消勾選' : '') + ' alt ' + J(v.alt || []));
      return;
    }
    if (bids.indexOf('bLegacy') >= 0 && chance(0.15)) {
      /* 重複英文的舊資料(run/跑、Run/經營):把第一個 run 的中文在幾個寫法之間換來換去(含改回原本的「跑」)、在編輯頁刪掉 alt、
         把 alt 換成主要的。裝置時鐘有快有慢,學生改回以前的中文要在主要或 alt,不能不見。新版改內容會換 _r,改回的那一份跟以前那一版
         雜湊不同,不會被當成舊版本(第三輪);「互相吸收過」要靠上面早期頁面的「改回以前那一版」才做得出來 */
      const lw = banks.find(b => b.id === 'bLegacy').words || [];
      const run = lw.find(x => x && key(x.en) === 'run');
      if (run && Array.isArray(run.alt) && run.alt.length && chance(0.5)) {
        editWord(d, 'bLegacy', 'run', 'zh');
        if (chance(0.5)) { setWord(d, 'bLegacy', 'run', { alt: [] }); log.push(d.name + ' 改中文 bLegacy run 刪 alt'); return; }
        const [top, ...rest] = run.alt;
        setWord(d, 'bLegacy', 'run', { zh: top, alt: rest.concat([run.zh]) }); log.push(d.name + ' 改中文 bLegacy run 換成 alt ' + top); return;
      }
      const zh = pick(LEGACY_ZH);
      editWord(d, 'bLegacy', 'run', 'zh');
      setWord(d, 'bLegacy', 'run', { zh }); log.push(d.name + ' 改中文 bLegacy run ' + zh);
      return;
    }
    if (r < 0.22) {
      let id = bids.length && chance(0.8) ? pick(bids) : null;
      if (id === null) { const nm = '題庫' + Math.floor(rnd() * 99); id = newBank(d, nm); editName(d, id, nm, true); }
      const list = [{ en: pick(EN), zh: pick(ZH) }].concat(chance(0.3) ? [{ en: pick(EN), zh: pick(ZH) }] : []);
      list.forEach(x => editWord(d, id, x.en, 'add'));
      addWords(d, id, list); log.push(d.name + ' 加字 ' + id + ' ' + J(list.map(x => x.en)));
      return;
    }
    if (r < 0.27) { const id = newBank(d, '新題庫'); editName(d, id, '新題庫', true); log.push(d.name + ' 新增題庫 ' + id); return; }
    if (r < 0.35 && bids.length) {
      const pid = pick(bids), b = banks.find(x => x.id === pid); const wd = (b.words || [])[Math.floor(rnd() * (b.words || []).length)];
      if (wd) { editWord(d, b.id, wd.en, 'zh'); setWord(d, b.id, wd.en, { zh: pick(ZH) }); log.push(d.name + ' 改中文 ' + b.id + ' ' + wd.en); }
      return;
    }
    if (r < 0.39 && bids.length) {
      const pid = pick(bids), b = banks.find(x => x.id === pid); const wd = (b.words || [])[Math.floor(rnd() * (b.words || []).length)];
      if (wd) { editWord(d, b.id, wd.en, 'on', wd.on === false); setWord(d, b.id, wd.en, { on: wd.on === false }); log.push(d.name + ' 勾選 ' + b.id + ' ' + wd.en); }
      return;
    }
    if (r < 0.42 && bids.length) { const id = pick(bids), nm = '改名' + Math.floor(rnd() * 99); editName(d, id, nm); rename(d, id, nm); log.push(d.name + ' 改名 ' + id); return; }
    if (r < 0.49 && bids.length) {
      const pid = pick(bids), b = banks.find(x => x.id === pid); const wd = (b.words || [])[Math.floor(rnd() * (b.words || []).length)];
      if (wd) { markDelete(d, b.id, wd.en); deleteWord(d, b.id, wd.en); log.push(d.name + ' 刪字 ' + b.id + ' ' + wd.en); }
      return;
    }
    if (r < 0.52 && bids.length) { const id = pick(bids); markDelete(d, id, null); deleteBank(d, id); log.push(d.name + ' 刪題庫 ' + id); return; }
    if (r < 0.56) {
      const aid = pick(Object.keys(ARTICLES));
      ARTICLES[aid].forEach(([en]) => editWord(d, aid, en, 'add'));
      addWords(d, aid, ARTICLES[aid].map(([en, zh]) => ({ en, zh })));
      if (!banksOf(d).find(b => b.id === aid).name) { editName(d, aid, '文章：' + aid); rename(d, aid, '文章：' + aid); }
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
        protDev.delete(d); protZDev.delete(d); exactDev.delete(d);
      }
      return;
    }
    return;
  }

  return (async () => {
    for (const d of devs) { await signIn(d); protDev.set(d, new Set()); exactDev.set(d, new Set()); }
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
        /* 學生這一步打的中文(以前出現過、被換掉,現在又改回來的):從這一步起算,之前的「換掉」「刪掉」不再豁免它。
           只在別的地方(其他裝置本機、舊版頁面記住的那份、雲端)都沒有它的時候重新算:別的地方還有的是舊的那一份,之後被換掉、刪掉是對的,
           分不出來就照舊豁免(少抓,不誤報)。
           「早期的頁面改回以前那一版」改回的中文不重新算:內容跟那一版一模一樣,別台同時從那一版改過的,會把它當成那個舊版本
           (早期的頁面本來就會這樣,第三輪起新版改內容換 _r 才修好);這個操作守的是別台打的中文、字、最後收斂 */
        const restored = /改回以前那一版/.test(log[log.length - 1]);
        const elsewhere = it => devs.some(x => x !== d && (zhItems(banksOf(x)).has(it) || zhItems(x.snapshot).has(it))) || zhItems(cloudOf(w, 'vgame_banks')).has(it);
        afterZ.forEach(it => { if (!restored && !beforeZ.has(it) && !elsewhere(it)) firstZ.set(it, step); });
      }
      if (process.env.DEBUG) {
        const brief = b => (Array.isArray(b) ? b : []).map(x => x.id + ':' + x._r + '[' + (x.words || []).map(y => y.en + '/' + y._r).join(',') + ']').join(' ');
        log.push('    雲端 ' + brief(cloudOf(w, 'vgame_banks')) + ' 標記 ' + J(cloudOf(w, 'sync_del') && cloudOf(w, 'sync_del').vgame_banks.b));
        devs.forEach(x => log.push('    ' + x.name + (loggedIn(x) ? '' : '(登出)') + ' ' + brief(banksOf(x)) + ' 帳本 ' + J(Object.keys(H.ledgerOf(x)))));
      }
      observe();
      check('第 ' + s + ' 步(' + log[log.length - 1] + ')');
    }
    /* 最後:全部連上;登入中的新版裝置各自重開一次(灌資料),再各開一次單字頁(syncKey)、關頁補傳。
       有「早期的頁面改回以前那一版」時多開一輪單字頁:改回的那一版跟以前那一版雜湊一樣,前一台合併時把它當成舊版本拿掉,
       它吸收過的版本要等下一輪才再被吸收(只會多留,收斂慢一輪;新版頁面做不出這種資料) */
    step++;
    devs.forEach(d => { d.offline = false; d.readError = false; });
    for (const d of devs) if (d.old && loggedIn(d)) { await d.pg.fire('win:online'); }
    for (let round = 0; round < (restoredAny ? 3 : 2); round++) {
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
    /* 勾選、名稱、重複英文的 run/Run(C 不看:舊版頁面整份上傳會把雲端蓋成舊的,改的那台登出了就救不回,已知限制 2、6) */
    if (mode !== 'C') {
      const lc = legacyEns(c);
      if (!legGone()) exactCloud.forEach(en => { if (!lc.has(en)) fail('最後:雲端重複英文那一組少了 bLegacy|' + en); });
      const targets = [['雲端', c]].concat(live.map(d => [d.name, banksOf(d)]));
      wordEd.forEach((e, k) => {
        const bid = k.split('|')[0], en = k.slice(bid.length + 1);
        if (e.devs.size !== 1 || e.kind !== 'on' || k === 'bLegacy|run' || delKey.has(k) || delBank.has(bid)) return;
        targets.forEach(([who, banks]) => {
          const b = (Array.isArray(banks) ? banks : []).find(x => x && x.id === bid), x = b && (b.words || []).find(y => y && key(y.en) === en);
          if (x && (x.on !== false) !== e.v) fail('最後:' + who + ' ' + k + (e.v ? ' 沒勾選' : ' 還是勾選') + ',只有 ' + [...e.devs][0].name + ' 改過勾選');
        });
      });
      bankEd.forEach((e, bid) => {
        if (delBank.has(bid) || e.devs.size > 1) return;
        const want = e.devs.size ? e.name : e.created;
        if (want === undefined) return;
        targets.forEach(([who, banks]) => {
          const b = (Array.isArray(banks) ? banks : []).find(x => x && x.id === bid);
          if (b && b.name !== want) fail('最後:' + who + ' 題庫 ' + bid + ' 叫「' + b.name + '」,只有一台改過名,要「' + want + '」');
        });
      });
    }
    return { steps, words: keysOf(c).size, deletes: delKey.size + delBank.size, live: live.length, restores, restoredSame };
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
    let ok = 0, words = 0, dels = 0, rs = 0, rsame = 0, firstErr = null;
    const t0 = Date.now();
    for (let i = 0; i < count; i++) {
      const seed = (SEED + i * 7919 + mode.charCodeAt(0) * 104729) >>> 0;
      try { const r = await runOne(seed, mode); ok++; words += r.words; dels += r.deletes; rs += r.restores; rsame += r.restoredSame; }
      catch (e) { if (!firstErr) firstErr = 'seed ' + seed + ':' + (e.log ? e.message : e.stack) + '\n    ' + (e.log || []).slice(-14).join('\n    '); }
    }
    report(label + ':' + count + ' 組隨機操作序列', ok === count,
      ok + ' / ' + count + ' 組通過,平均每組最後 ' + (words / Math.max(1, ok)).toFixed(1) + ' 個字、刪除 ' + (dels / Math.max(1, ok)).toFixed(1) + ' 次,早期頁面改回 ' + rs + ' 次(跟以前那一版一模一樣 ' + rsame + ' 次),' + Math.round((Date.now() - t0) / 1000) + ' 秒' + (firstErr ? '\n  第一個失敗 ' + firstErr : ''));
  }
  console.log(pass + ' / ' + (pass + fail) + ' 通過');
  process.exit(fail ? 1 : 0);
})();
