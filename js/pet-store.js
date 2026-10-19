/* 小雞的存取(路線圖 1.2c;規格在 repo 外的 小雞規格.md 第 9 節)。計算全在 js/pet.js,這裡只決定什麼時候算、寫到哪裡。
   只寫 pet 這一個鍵;hist 與其他鍵只讀不寫。
   - 什麼時候重算:開頁(等 CLOUD.ready 之後)、回到頁面(離上次同步超過 1 分鐘)、恢復連線、
     答題後(common.js 的 logAttempt 呼叫 afterAnswer:停 4 秒再做,兩次讀雲端至少隔 30 秒)。
     畫面要的數字用 view() 當場算,不用等同步。每次同步完與答題後都送 'pet:change' 事件(detail 是 view())。
   - 寫到哪裡:
     登入、而且 CLOUD.readKey 讀到雲端那一份:跟本機那份、hist 合併(PET.reconcile);結果跟雲端不一樣才 store.set
     (寫本機並照常記帳上傳),跟雲端一樣只是本機舊了就只寫本機。
     登入、但讀不到雲端(離線、逾時、換了帳號、supabase-js 手上的登入不是這個帳號):
     第 3 步(第二階段開關打開)而且 cloud.js 是先合併再上傳的新版(CLOUD.mergedKeys 有 pet,第二階段規格 A.5)時改用 store.set,
     記帳後由 cloud.js 先讀雲端、合併再上傳;開關都關著(第 2 步)時同一台可能還開著第 1 步的分頁,它的 cloud.js 會把帳本上的
     pet 不合併就傳上去,所以照第 1 步只寫本機(第二輪實作審查 X1)。舊版 cloud.js 也只寫本機,不經過 store.set,
     所以不記帳、不上傳,沒合併過的本機那份不會蓋掉雲端;下次讀得到再合併上傳。
     讀得到雲端但對不了時(登入憑證沒有或解不開):一律只寫本機,不記帳,不讓沒對過時的資料經過任何一條路上傳。
     訪客、網站沒開雲端:只寫本機。
   - 本機或雲端那一份救不回(不是物件、或版本不認得,例如 v3):唯讀,什麼都不寫。
     第二階段的 v2 照常讀寫,新欄位(食物、走動開關)原樣保留,合併只取聯集。
   - 第二階段的開關(js/pet-config.js):PET_FOOD 打開而且 PET_FOOD_FROM 是有效日期時才有食物(earn、eat、每次同步補券),
     PET_ROAM_V2 打開時才有走動開關(setRoam)。兩個都關著時新函式一律立刻回 off、不讀不寫,
     其他行為(寫入次數、內容、view() 的鍵)跟第 1 步那版逐位元組相同(test_pet_store.js 比對)。
   - 這台的時鐘跟伺服器差太多(慢或快超過 3 天,chick2 第三輪修正 #1):唯讀,本機、雲端都不寫。伺服器時間取自剛讀雲端時用的登入憑證
     (access_token 的 iat;伺服器剛收下這張憑證,所以 iat 跟伺服器時間最多差憑證的有效期,預設 1 小時)。
     慢的裝置會把它眼中「晚超過 7 天」的天丟掉,寫回去就刪掉了別台的進度(10/16 審查)。憑證沒有或解不開時對不了時,
     當成讀不到雲端:只寫本機、不上傳。
   - 讀雲端的時候登出了(或別的分頁換了帳號):帳號資料夾已經清掉,什麼都不寫,免得把 pet 和帳本寫回去。
   - 讀不到雲端時只寫了本機的改動(餵食、改目標、取名),登入時在 cloud.js 記一個「只在本機」的標記(不在帳本裡);
     登出時 cloud.js 先合併上傳,傳不上去就算進「還沒同步」先問(chick2 第一輪修正 #2)。登出前還在排隊的動作和 earn,
     cloud.js 會先呼叫 flushPending 照讀不到雲端的規則寫下來(#4)。
     已知限制:在下一次讀得到雲端之前開了新的工作階段時,cloud.js 灌資料先合併本機與雲端(第二階段),合併不了(時鐘差太多)
     才用雲端那份蓋掉本機,這些改動會不見;每天的題數從 hist 重算,不會少。
     合併後的那份上傳失敗(斷線、請求被中斷)時它留在帳本上,之後任何一次 cloud.js 的 flushAll(開別的頁、切到背景、
     恢復連線)都會先把這份沒有重新合併過的本機那份傳上去,蓋掉別台在這中間寫進雲端的名字、目標、餵食。
     別台只有在同一個工作階段裡再同步才併得回來;它開了新的工作階段的話,灌資料會先用雲端那份蓋掉它的本機,這些就沒了。
     每天的題數在 hist 涵蓋的範圍內會重算回來。cloud.js 是先合併的新版(mergedKeys)時,帳本補傳會先合併,這條限制就沒了。
   - 食物(第二階段規格 4.3、5.2):掛勾在結束畫面呼叫 earn({ id, n });這次唯讀或出錯時記在分頁記憶體(最多 20 筆),
     之後第一次正常的同步依原本的完成時間補寫。每次同步也從 daily_done、mock_history、diag、hist 與達標日補最近 7 天的券
     (那些鍵只讀)。拿到券就在 window 送 'pet:earn'(detail { result, food, id, date, source })。
     同一輪裡掛勾的那一個先算,再補寫:每日練習做完一項時 daily_done 已經記好了,先補寫的話掛勾那一下會變成「今天拿過了」。
     前一輪同步已經在讀雲端時交卷,補寫還是可能先寫了這次的券:交卷那一刻本機那天沒有券、現在那天的券又是同一個來源給的,
     掛勾就回 got 與那份食物,不說「拿過了」(chick2 第三輪修正 #4,見 mine())。
     網路看起來連著、其實不通時讀雲端要 8 秒才逾時:earn 最多等 2 秒,之後先用這台的資料判斷,照讀不到雲端的規則寫(第 3 步登入時記帳),
     離開頁面或切到背景時也先寫(結束畫面只等 10 秒,分頁記憶體會跟著頁面不見);下一次同步再合併上傳。
     吃點心(eat)也一樣:畫面當場就顯示吃掉了,正式寫入等 2 秒、離開頁面或切到背景時先照同樣的規則寫(同一個吃的 id,
     之後合併只留一筆;chick2 第一輪修正 #3)。
   載入順序:common.js、pet-config.js、pet.js、cloud.js、(pet-food.js)、pet-store.js。測試:node tools/test_pet_store.js */
(function () {
  'use strict';
  const KEY = 'pet';
  const DEBOUNCE_MS = 4000;      // 答題後停這麼久再同步(連續答題只做一次)
  const MIN_GAP_MS = 30000;      // 答題觸發的同步,兩次讀雲端至少隔這麼久
  const VISIBLE_GAP_MS = 60000;  // 回到頁面時,離上次同步超過這麼久才再做
  /* 這台的時鐘比伺服器慢或快超過這麼久就不寫。兩台一快一慢時相差兩邊相加:pet.js 只留這台的今天加 7 天以內的日期、
     今天往前 6 天的 fed,所以兩邊相加不能超過 6 天。以前各 6 天,一台快 4 天、一台慢 4 天時,慢的那台合併會丟掉快的那台的
     練習日、達標日、券和吃掉紀錄再上傳(chick2 第三輪修正 #1;js/cloud.js 同一組數字,test_pet.js 從兩個檔讀出來驗)。
     憑證剛換過、跟伺服器只差幾分鐘到 1 小時;發了超過 3 天還沒換的憑證才會誤擋,那一次只是不寫,不丟資料 */
  const SLOW_MAX_MS = 3 * 864e5;
  const FAST_MAX_MS = 3 * 864e5;
  const LATER_MAX = 20;           // 這次寫不進去的完成,分頁記憶體最多記幾筆
  const P = window.PET;
  const on = !!P && (window.PET_ON === true || previewOn());
  /* 第二階段的開關:載入時決定一次。程式只認 === true,網址、分頁暫存都打不開 */
  const FROM = typeof window.PET_FOOD_FROM === 'string' ? window.PET_FOOD_FROM : '';
  const food = on && window.PET_FOOD === true && typeof P.isDate === 'function' && P.isDate(FROM) && typeof P.earn === 'function';
  const roamV2 = on && window.PET_ROAM_V2 === true && typeof P.setRoam === 'function';
  /* 第 3 步:第二階段的開關打開了,第 1 步那版的分頁已經汰換掉(規格 5.3 等一週的條件) */
  const step3 = food || roamV2;
  const EARN_WAIT_MS = 2000;      // earn 等合併後的結果最多這麼久,之後先照讀不到雲端的規則寫(結束畫面只等 10 秒)

  let chain = Promise.resolve();
  let queued = null;      // 已經排隊、還沒開始的那次同步(再叫就共用它)
  let timer = null;       // 答題後排的同步
  let lastSync = 0;       // 上次開始同步的時間
  let remoteBad = false;  // 上次讀到的雲端那份救不回
  let clockBad = false;   // 上次對時,這台的時鐘差太多
  let later = [];         // 這次寫不進去的完成 { id, at },之後第一次正常的同步補寫
  let eating = '';        // 正在寫入的那一口是哪天吃的(連點時當場就回 ateToday)
  let asks = [];          // 還在等結果的 earn 與動作 { flush, leave }:離開頁面時先寫 leave 的(earn、吃點心),登出前全部先寫(flushPending)
  let filled = [];        // 這個分頁補寫過的券 { date, src, id }(最多 LATER_MAX 筆):掛勾認得出是不是自己這次的完成
  let claimed = [];       // 這個分頁掛勾已經回過 got 的券 'date/id':同一張不會回兩次 got

  function previewOn() {
    try { return new URLSearchParams(location.search || '').get('pet') === '1'; } catch (e) { return false; }
  }
  function cloudOn() { return !!(window.CLOUD && window.CLOUD.enabled); }
  function cloudUser() { return cloudOn() && window.CLOUD.user && typeof window.CLOUD.user.id === 'string' ? window.CLOUD.user : null; }
  /* cloud.js 是先合併再上傳的新版(規格 A.5) */
  function cloudMerges() {
    try { const k = window.CLOUD.mergedKeys; return Array.isArray(k) && k.indexOf(KEY) >= 0; } catch (e) { return false; }
  }

  /* 本機那份:沒有是 null;讀不到或不是 JSON 回一個字串(PET 會當成救不回、唯讀,不會被蓋掉) */
  function readLocal() {
    let raw;
    try { raw = localStorage.getItem(storageKey(KEY)); } catch (e) { return '\u0000unreadable'; }
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch (e) { return '\u0000corrupt'; }
  }
  function readHist() { return store.get('hist', []); }
  /* 伺服器時間減這台的時間(毫秒);拿不到登入憑證或解不開回 null */
  async function serverSkew(userId) {
    try {
      const res = await window.CLOUD.client.auth.getSession();
      const s = res && res.data && res.data.session;
      if (!s || !s.user || s.user.id !== userId || typeof s.access_token !== 'string') return null;
      const part = s.access_token.split('.')[1];
      if (!part) return null;
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(window.atob(b64 + '==='.slice((b64.length + 3) % 4)));
      return typeof claims.iat === 'number' && isFinite(claims.iat) ? claims.iat * 1000 - Date.now() : null;
    } catch (e) { return null; }
  }
  /* 登入的頁面在同步途中登出、或別的分頁換了帳號:common.js 開頁時從 tr_current_profile 決定 __PROFILE_ID */
  function profileGone() {
    try { return localStorage.getItem('tr_current_profile') !== JSON.stringify(window.__PROFILE_ID); } catch (e) { return true; }
  }
  /* 只寫本機,不記帳、不上傳 */
  function writeLocal(p) {
    try { localStorage.setItem(storageKey(KEY), JSON.stringify(p)); return true; } catch (e) { return false; }
  }
  /* 登入時只寫在本機的改動,記在 cloud.js 的「只在本機」標記(不在帳本裡,第 1 步的 cloud.js 看不到):登出時這一版先合併上傳,
     傳不上去就算進「還沒同步」先問(chick2 第一輪修正 #2)。讀到雲端、寫過合併後的那份,就劃掉。舊版 cloud.js 沒有這兩個函式,什麼都不做 */
  function markLocal(on) {
    try {
      const C = window.CLOUD, f = C && (on ? C.markLocalOnly : C.clearLocalOnly);
      if (typeof f === 'function') f(KEY);
    } catch (e) { /* 標記不到只是登出時不會先問 */ }
  }

  /* newer:這一版看得懂 v2,不會再因為版本說「新版網頁存的」;不認得的版本照舊說資料讀不到(規格 5.3)。鍵留著給畫面 */
  function view() {
    if (!on) return { on: false };
    const now = Date.now();
    const user = cloudUser();
    const r = P.reconcile({ local: readLocal(), remote: null, hist: readHist(), now });
    const reason = r.readOnly || remoteBad ? 'readOnly' : clockBad ? 'clock' : '';
    const out = { on: true, cloud: cloudOn(), guest: !user, readOnly: !!reason, reason, newer: false, status: P.status(r.pet, now), pet: r.pet };
    if (food) { out.food = true; out.pantry = P.pantry(r.pet, now); }
    if (roamV2) { out.roamV2 = true; out.roam = P.roamOn(r.pet); }
    return out;
  }
  function emit() {
    try { window.dispatchEvent(new CustomEvent('pet:change', { detail: view() })); } catch (e) { /* 沒有畫面在聽也沒關係 */ }
  }
  function emitEarn(list) {
    list.forEach(d => { try { window.dispatchEvent(new CustomEvent('pet:earn', { detail: d })); } catch (e) { /* 沒有畫面在聽 */ } });
  }
  /* 出錯(例如頁面沒載入 common.js)不丟到外面:回 ok:false,什麼都不寫 */
  function enqueue(task) {
    const safe = () => Promise.resolve().then(task).catch(() => ({ ok: false, reason: 'error' }));
    const p = chain.then(safe, safe);
    chain = p.catch(() => null);
    return p;
  }

  /* 食物:先補這次之前寫不進去的,再算掛勾這一個,最後從既有的鍵補最近 7 天(那些鍵只讀) */
  function grow(pet, now, ask) {
    const got = [], used = later.slice();
    let res = null;
    const take = (r, source) => {
      if (r.result !== 'got') return;
      pet = r.pet;
      got.push({ result: 'got', food: r.food, id: r.id, date: r.date, source });
    };
    used.forEach(x => take(P.earn(pet, { id: x.id, at: x.at, from: FROM }, now), 'later'));
    if (ask) { const r = P.earn(pet, { id: ask.id, at: ask.at, from: FROM }, now); take(r, 'hook'); res = mine(ask, pet, r); }
    const b = P.backfill(pet, { daily: store.get('daily_done', null), mock: store.get('mock_history', null), diag: store.get('diag', null), hist: readHist(), from: FROM }, now);
    if (b.added.length) {
      pet = b.pet;
      filled = filled.concat(b.added.map(a => ({ date: a.date, src: a.src, id: a.id }))).slice(-LATER_MAX);
      /* 補到前幾天的不送事件(開頁時一次補好幾天,小雞不用跳好幾下);今天的才送 */
      const today = P.dateOf(now);
      b.added.forEach(a => { if (a.date === today) got.push({ result: 'got', food: a.food, id: a.id, date: a.date, source: 'backfill' }); });
    }
    return { pet, got, used, res };
  }

  /* 掛勾的結果(chick2 第三輪修正 #4):前一次同步正在讀雲端時交卷,那一輪讀完雲端才讀 hist,補寫先把這次的完成補成那天的券,
     掛勾排在後面就拿到 cap,結束畫面說「今天的點心拿過了」,其實這就是那天第一份。
     交卷那一刻本機那天還沒有券(ask.had 是 false),現在那天的券又是這個來源給的(id 相同,或這個分頁補寫時記下的來源相同),
     就回 got 與那份食物(規格 5.2:同一天同一個來源是同一張券)。同一張只回一次 got(claimed),不另外送 pet:earn(補寫那時送過了) */
  function mine(ask, pet, r) {
    if (r && r.result === 'got') { claimed = claimed.concat([r.date + '/' + r.id]).slice(-LATER_MAX); return r; }
    if (!r || r.result !== 'cap' || ask.had !== false) return r;
    const d = P.dateOf(ask.at);
    const day = pet && pet.got && Object.prototype.hasOwnProperty.call(pet.got, d) ? pet.got[d] : null;
    if (!day || typeof day !== 'object') return r;
    const ids = [ask.id].concat(filled.filter(x => x.date === d && x.src === ask.id).map(x => x.id));
    const id = ids.find(i => Object.prototype.hasOwnProperty.call(day, i) && claimed.indexOf(d + '/' + i) < 0);
    if (!id) return r;
    claimed = claimed.concat([d + '/' + id]).slice(-LATER_MAX);
    return { result: 'got', food: day[id], id, date: d };
  }
  /* 交卷那一刻本機那天有沒有券(讀不到、壞掉當成有:照舊回 cap) */
  function hadTicket(t) {
    const l = readLocal();
    if (l === null) return false;
    if (!l || typeof l !== 'object') return true;
    const g = l.got, d = P.dateOf(t);
    return !!(g && typeof g === 'object' && Object.prototype.hasOwnProperty.call(g, d) && g[d] && typeof g[d] === 'object' && Object.keys(g[d]).length);
  }

  /* 一次同步。mutate(pet, now) 回 { ok: true, pet } 或 { ok: false, reason }(餵食、改目標、取名、吃、走動開關用);
     ask 是掛勾的那一個完成 { id, at }(只有食物打開時) */
  async function run(mutate, ask) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (cloudOn()) { try { await window.CLOUD.ready; } catch (e) { /* 照本機算 */ } }
    lastSync = Date.now();
    const user = cloudUser();
    let cloudOk = false, cloudRead = false, remote = null, remoteRaw = null, skew = null;
    if (user) {
      let r = null;
      try { r = await window.CLOUD.readKey(KEY); } catch (e) { r = null; }
      if (r && r.ok === true) skew = await serverSkew(user.id);
      const cur = cloudUser();
      cloudRead = !!(r && r.ok === true && cur && cur.id === user.id);
      if (cloudRead && skew !== null) {
        clockBad = skew > SLOW_MAX_MS || -skew > FAST_MAX_MS;
        cloudOk = true;
        remoteRaw = r.found ? r.v : null;
        /* 雲端沒有這一列、或別台刪掉了(v 是 null):當成空的雲端版本,合併結果會上傳 */
        remote = remoteRaw === null || remoteRaw === undefined ? {} : remoteRaw;
      }
    }
    /* 讀雲端的時候可能又答了題:本機與 hist 讀完雲端再讀 */
    const now = Date.now();
    const local = readLocal();
    const base = P.reconcile({ local, remote, hist: readHist(), now });
    if (cloudOk) remoteBad = P.sanitize(remote, now).readOnly;
    const info = { guest: !user, localOnly: !!user && !cloudOk };
    if (clockBad) return finish(Object.assign({ ok: false, reason: 'clock', readOnly: true, uploaded: false, status: P.status(base.pet, now), pet: base.pet }, info));
    if (base.readOnly) return finish(Object.assign({ ok: false, reason: 'readOnly', readOnly: true, uploaded: false, status: P.status(base.pet, now), pet: base.pet }, info));
    let pet = base.pet;
    const g = food ? grow(pet, now, ask) : { pet, got: [], used: [], res: null };
    pet = g.pet;
    if (mutate) {
      const m = mutate(pet, now);
      if (!m || !m.ok) {
        /* 動作沒做(例如沒有飼料):這一輪補到的券照一般同步的規則寫出去,不因為動作失敗丟掉 */
        const w = g.got.length || g.used.length ? write(pet, local, remoteRaw, user, cloudOk, cloudRead, now) : '';
        if (w === 'loggedOut') return { ok: false, reason: 'loggedOut', readOnly: false, uploaded: false, status: P.status(pet, now), pet, guest: false, localOnly: true };
        done(g);
        return finish(Object.assign({ ok: false, reason: (m && m.reason) || 'failed', readOnly: false, uploaded: false, status: P.status(pet, now), pet }, info));
      }
      pet = m.pet;
    }
    const w = write(pet, local, remoteRaw, user, cloudOk, cloudRead, now);
    if (w === 'loggedOut') return { ok: false, reason: 'loggedOut', readOnly: false, uploaded: false, status: P.status(pet, now), pet, guest: false, localOnly: true };
    done(g);
    return finish(Object.assign({ ok: true, readOnly: false, uploaded: w === 'uploaded', status: P.status(pet, now), pet }, info, ask ? { earn: g.res } : {}));
  }
  /* 寫出去。從這裡到寫入之間沒有 await:檢查與寫入一起完成 */
  function write(pet, local, remoteRaw, user, cloudOk, cloudRead, now) {
    if (user && profileGone()) return 'loggedOut';
    const c = P.canon(pet);
    if (cloudOk && !(remoteRaw !== null && remoteRaw !== undefined && P.canon(remoteRaw) === c)) {
      store.set(KEY, pet);   // 寫本機,cloud.js 記帳後上傳
      if (user) markLocal(false);   // 本機的改動都在這一份裡,交給帳本
      return 'uploaded';
    }
    if (local === null || P.canon(local) !== c) {
      /* 讀不到雲端:第 3 步(第二階段開關打開)而且 cloud.js 是先合併的新版時,記帳交給它;
         第 2 步(開關都關)同一台可能還開著第 1 步的分頁,它的 cloud.js 會把帳本上的 pet 不合併就傳上去,所以跟第 1 步一樣只寫本機
         (記一個「只在本機」的標記,登出時先合併上傳);讀得到但對不了時、舊版 cloud.js 也只寫本機 */
      if (user && !cloudRead && cloudMerges() && step3) store.set(KEY, pet);
      else if (writeLocal(pet) && user && !cloudOk) markLocal(true);
    }
    if (user && cloudOk) markLocal(false);   // 跟雲端那份一樣:沒有只在本機的改動
    return 'local';
  }
  /* 寫成功之後:補寫過的完成從記憶體拿掉,送 pet:earn(掛勾、之後補寫的、補到今天的) */
  function done(g) {
    if (g.used.length) later = later.filter(x => g.used.indexOf(x) < 0);
    emitEarn(g.got);
  }
  function finish(res) { emit(); return res; }

  function sync() {
    if (!on) return Promise.resolve({ ok: false, reason: 'off' });
    if (queued) return queued;
    queued = enqueue(() => { queued = null; return run(null); });
    return queued;
  }
  /* 動作排進佇列。還沒做完就登出時(cloud.js 呼叫 flushPending),先照讀不到雲端的規則寫在本機,cloud.js 再合併上傳或先問;
     leave(吃點心)時等 2 秒、離開頁面或切到背景也先寫(畫面當場就顯示吃掉了,chick2 第一輪修正 #3)。
     先寫過的,正式那一輪的動作若因為「已經做過」被拒絕(今天吃過、沒有飼料),照樣算成功、寫合併後的那份 */
  function act(mutate, leave) {
    if (!on) return Promise.resolve({ ok: false, reason: 'off' });
    const p = { leave: !!leave, flushed: false, over: false, timer: 0 };
    p.flush = () => { if (!p.over && !p.flushed && quickAct(mutate)) p.flushed = true; };
    asks.push(p);
    if (p.leave) p.timer = setTimeout(p.flush, EARN_WAIT_MS);
    const once = (pet, now) => {
      const m = mutate(pet, now);
      return (!m || !m.ok) && p.flushed ? { ok: true, pet } : m;
    };
    return enqueue(() => run(once)).then(r => {
      p.over = true;
      clearTimeout(p.timer);
      asks = asks.filter(x => x !== p);
      return r;
    });
  }
  /* 還在等的全部先寫(cloud.js 登出前呼叫;第 2 步只寫本機加標記,第 3 步記帳) */
  function flushPending() {
    asks.slice().forEach(p => { try { p.flush(); } catch (e) { /* 寫不了就算了,登出照常先問帳本上的 */ } });
  }

  function feed() {
    return act((pet, now) => (P.status(pet, now).food > 0 ? { ok: true, pet: P.feed(pet, now) } : { ok: false, reason: 'noFood' }));
  }
  function goalOk(n) { try { P.setGoal(null, n, Date.now()); return true; } catch (e) { return false; } }
  function setGoal(n) {
    if (on && !goalOk(n)) return Promise.resolve({ ok: false, reason: 'badGoal' });
    return act((pet, now) => ({ ok: true, pet: P.setGoal(pet, n, now) }));
  }
  function rename(name) {
    return act((pet, now) => ({ ok: true, pet: P.rename(pet, name, now) }));
  }

  /* ---------- 食物 ---------- */
  /* 一個練習完成(js/pet-hook.js 呼叫)。回 { result, food, id };拿到或存滿時 food 是食物代號,其他是 null */
  function earn(o) {
    const id = o && o.id, n = o && o.n;
    const out = (result, f, i) => ({ result, food: f || null, id: i || null });
    if (!food) return Promise.resolve(out('off'));
    if (n !== undefined && n !== null && !(Number(n) >= P.ROUND_MIN)) return Promise.resolve(out('short'));
    if (!P.sourceFood(id)) return Promise.resolve(out('bad'));
    const at = Date.now();
    let had = true;
    try { had = hadTicket(at); } catch (e) { had = true; }
    const ask = { id, at, had };
    return new Promise(resolve => {
      let over = false, quickDone = false, timer = 0;
      const p = { leave: true };
      const end = v => { if (over) return; over = true; clearTimeout(timer); asks = asks.filter(x => x !== p); resolve(v); };
      /* 網路看起來連著、其實不通時讀雲端要等 8 秒(前面排著同步就 16 秒):等不到就先照讀不到雲端的規則寫,離開頁面時也是 */
      p.flush = () => {
        if (over || quickDone) return;
        const q = quick(ask);
        if (!q) return;
        quickDone = true;
        end(out(q.result, q.result === 'got' ? q.food : null, q.result === 'got' ? q.id : null));
      };
      asks.push(p);
      timer = setTimeout(p.flush, EARN_WAIT_MS);
      enqueue(() => run(null, ask)).then(r => {
        if (quickDone) return;   // 已經先寫在本機:券在本機那份裡,這一輪只負責合併與上傳
        const e = r && r.earn;
        if (r && r.ok && e) { end(out(e.result, e.result === 'got' || e.result === 'full' ? e.food : null, e.result === 'got' ? e.id : null)); return; }
        /* 這次唯讀、時鐘不對或出錯:記下來,之後第一次正常的同步依原本的完成時間補寫(換了帳號就不記) */
        if (!r || r.reason !== 'loggedOut') { later.push(ask); if (later.length > LATER_MAX) later = later.slice(-LATER_MAX); }
        end(out('later'));
      });
    });
  }
  /* 讀不到雲端時的寫法,跟 write() 讀不到雲端那一條相同:登入、第 3 步而且 cloud.js 是先合併的新版時用 store.set 記帳
     (cloud.js 先合併再上傳,登出前沒傳出去會先問);其他只寫本機。回寫進本機了沒 */
  function saveUnread(p) {
    if (!(cloudUser() && cloudMerges() && step3)) {
      const ok = writeLocal(p);
      if (ok && cloudUser()) markLocal(true);
      return ok;
    }
    store.set(KEY, p);
    try { return P.canon(readLocal()) === P.canon(p); } catch (e) { return false; }
  }
  /* 排隊中的動作先寫(act 的 flush):跟 quick() 一樣只用這台的資料、照讀不到雲端的規則寫;唯讀、時鐘不對、雲端那份救不回、
     登出了、動作被拒絕時什麼都不做。讀寫之間沒有 await。回寫進去了沒(本來就一樣也算) */
  function quickAct(mutate) {
    try {
      if (clockBad || remoteBad) return false;
      if (cloudUser() && profileGone()) return false;
      const now = Date.now();
      const local = readLocal();
      const base = P.reconcile({ local, remote: null, hist: readHist(), now });
      if (base.readOnly) return false;
      const m = mutate(base.pet, now);
      if (!m || !m.ok) return false;
      if (local !== null && P.canon(local) === P.canon(m.pet)) return true;
      if (!saveUnread(m.pet)) return false;
      emit();
      return true;
    } catch (e) { return false; }
  }
  /* 先寫本機:用這台現在的資料(本機那份、hist)判斷,拿到就照讀不到雲端的規則寫(saveUnread;第 3 步登入時記帳,第三輪審查 #2),
     下一次同步合併上傳。
     只在 got(寫了券)和 cap(今天已經有券,合併只會多不會少,答案不會變)時回結果,其他回 null 繼續等。
     唯讀、時鐘不對、雲端那份救不回、登出了:什麼都不做。讀寫之間沒有 await,跟同步的寫入不會交錯 */
  function quick(ask) {
    try {
      if (clockBad || remoteBad) return null;
      if (cloudUser() && profileGone()) return null;
      const now = Date.now();
      const base = P.reconcile({ local: readLocal(), remote: null, hist: readHist(), now });
      if (base.readOnly) return null;
      const r = P.earn(base.pet, { id: ask.id, at: ask.at, from: FROM }, now);
      if (r.result === 'cap') return mine(ask, base.pet, r);
      if (r.result !== 'got' || !saveUnread(r.pet)) return null;
      mine(ask, base.pet, r);
      emitEarn([{ result: 'got', food: r.food, id: r.id, date: r.date, source: 'hook' }]);
      emit();
      return r;
    } catch (e) { return null; }
  }
  /* 吃一份點心:當場用畫面上的資料決定能不能吃(畫面靠它在點下去的當下更新),正式寫入排在後面;saved 是寫入的結果 */
  function eat(f) {
    const no = reason => ({ ok: false, reason, saved: Promise.resolve({ ok: false, reason }) });
    if (!food) return no('off');
    let v;
    try { v = view(); } catch (e) { return no('error'); }
    if (v.readOnly) return no(v.reason || 'readOnly');
    const now = Date.now();
    if (eating === P.dateOf(now) && P.SNACKS.indexOf(f) >= 0) return no('ateToday');
    const eatId = now.toString(36) + randChar() + randChar();
    let r;
    try { r = P.eat(v.pet, f, eatId, now); } catch (e) { return no('error'); }
    if (!r.ok) return no(r.reason);
    const day = P.dateOf(now);
    eating = day;
    const saved = act((pet, t) => {
      const x = P.eat(pet, f, eatId, t);
      return x.ok ? { ok: true, pet: x.pet } : { ok: false, reason: x.reason };
    }, true).then(res => {
      if (eating === day) eating = '';
      return { ok: !!(res && res.ok), reason: res && res.ok ? null : (res && res.reason) || 'error' };
    });
    return { ok: true, reason: null, left: r.left, saved };
  }
  function randChar() { return '0123456789abcdefghijklmnopqrstuvwxyz'.charAt(Math.floor(Math.random() * 36)); }
  /* 「小雞在頁面上走動」開關 */
  function setRoam(v) {
    if (!roamV2) return Promise.resolve({ ok: false, reason: 'off' });
    return act((pet, now) => ({ ok: true, pet: P.setRoam(pet, v, now) }));
  }

  /* 答題後(logAttempt 呼叫):畫面馬上更新,同步排在後面 */
  function afterAnswer() {
    if (!on) return;
    emit();
    if (timer) return;
    const wait = Math.max(DEBOUNCE_MS, MIN_GAP_MS - (Date.now() - lastSync));
    timer = setTimeout(() => { timer = null; sync(); }, wait);
  }

  let ready = Promise.resolve(null);
  if (on) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSync >= VISIBLE_GAP_MS) sync();
    });
    window.addEventListener('online', () => { sync(); });
    /* 離開頁面、切到背景:還在等雲端的 earn 和吃點心先寫(分頁記憶體裡的會跟著頁面不見) */
    if (food) {
      const flushAsks = () => { asks.slice().forEach(p => { if (p.leave) p.flush(); }); };
      window.addEventListener('pagehide', flushAsks);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAsks(); });
    }
    /* 別的分頁答了題或改了小雞:畫面跟著更新(不寫) */
    window.addEventListener('storage', e => {
      try { if (e && (e.key === storageKey(KEY) || e.key === storageKey('hist'))) emit(); } catch (err) { /* 沒載入 common.js */ }
    });
    ready = sync();
  }

  window.PET_STORE = { on, food, roamV2, ready, sync, view, feed, setGoal, rename, earn, eat, setRoam, afterAnswer, flushPending, idle: () => chain };
})();
