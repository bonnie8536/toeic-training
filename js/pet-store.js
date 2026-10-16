/* 小雞的存取(路線圖 1.2c;規格在 repo 外的 小雞規格.md 第 9 節)。計算全在 js/pet.js,這裡只決定什麼時候算、寫到哪裡。
   只寫 pet 這一個鍵;hist 與其他鍵只讀不寫。
   - 什麼時候重算:開頁(等 CLOUD.ready 之後)、回到頁面(離上次同步超過 1 分鐘)、恢復連線、
     答題後(common.js 的 logAttempt 呼叫 afterAnswer:停 4 秒再做,兩次讀雲端至少隔 30 秒)。
     畫面要的數字用 view() 當場算,不用等同步。每次同步完與答題後都送 'pet:change' 事件(detail 是 view())。
   - 寫到哪裡:
     登入、而且 CLOUD.readKey 讀到雲端那一份:跟本機那份、hist 合併(PET.reconcile);結果跟雲端不一樣才 store.set
     (寫本機並照常記帳上傳),跟雲端一樣只是本機舊了就只寫本機。
     登入、但讀不到雲端(離線、逾時、換了帳號、supabase-js 手上的登入不是這個帳號):只寫本機,不經過 store.set,
     所以不記帳、不上傳,沒合併過的本機那份不會蓋掉雲端;下次讀得到再合併上傳。
     訪客、網站沒開雲端:只寫本機。
   - 本機或雲端那一份救不回(不是物件、或版本比 1 新):唯讀,什麼都不寫。
   - 這台的時鐘跟伺服器差太多(慢超過 6 天或快超過 8 天):唯讀,本機、雲端都不寫。伺服器時間取自剛讀雲端時用的登入憑證
     (access_token 的 iat;伺服器剛收下這張憑證,所以 iat 跟伺服器時間最多差憑證的有效期,預設 1 小時)。
     慢的裝置會把它眼中「晚超過 7 天」的天丟掉,寫回去就刪掉了別台的進度(10/16 審查)。憑證沒有或解不開時對不了時,
     當成讀不到雲端:只寫本機、不上傳。
   - 讀雲端的時候登出了(或別的分頁換了帳號):帳號資料夾已經清掉,什麼都不寫,免得把 pet 和帳本寫回去。
   - 已知限制:讀不到雲端時只寫了本機的改動(餵食、改目標、取名),若在下一次讀得到雲端之前開了新的工作階段
     (cloud.js 灌資料會用雲端那份蓋掉本機),這些改動會不見;每天的題數從 hist 重算,不會少。
     合併後的那份上傳失敗(斷線、請求被中斷)時它留在帳本上,之後任何一次 cloud.js 的 flushAll(開別的頁、切到背景、
     恢復連線)都會先把這份沒有重新合併過的本機那份傳上去,蓋掉別台在這中間寫進雲端的名字、目標、餵食。
     別台只有在同一個工作階段裡再同步才併得回來;它開了新的工作階段的話,灌資料會先用雲端那份蓋掉它的本機,這些就沒了。
     每天的題數在 hist 涵蓋的範圍內會重算回來。要完全避免得讓 cloud.js 把 pet 當成要合併的鍵(上傳前交給這裡合併),動 cloud.js,另案。
   載入順序:common.js、cloud.js、pet-config.js、pet.js、pet-store.js。測試:node tools/test_pet_store.js */
(function () {
  'use strict';
  const KEY = 'pet';
  const DEBOUNCE_MS = 4000;      // 答題後停這麼久再同步(連續答題只做一次)
  const MIN_GAP_MS = 30000;      // 答題觸發的同步,兩次讀雲端至少隔這麼久
  const VISIBLE_GAP_MS = 60000;  // 回到頁面時,離上次同步超過這麼久才再做
  const SLOW_MAX_MS = 6 * 864e5;  // 這台的時鐘比伺服器慢超過這麼久就不寫(pet.js 晚超過 7 天的日期會丟掉;留憑證有效期的餘裕)
  const FAST_MAX_MS = 8 * 864e5;  // 快超過這麼久也不寫(憑證有效期最長 1 週,不會誤判時鐘準的裝置)
  const P = window.PET;
  const on = !!P && (window.PET_ON === true || previewOn());

  let chain = Promise.resolve();
  let queued = null;      // 已經排隊、還沒開始的那次同步(再叫就共用它)
  let timer = null;       // 答題後排的同步
  let lastSync = 0;       // 上次開始同步的時間
  let remoteBad = false;  // 上次讀到的雲端那份救不回
  let clockBad = false;   // 上次對時,這台的時鐘差太多

  function previewOn() {
    try { return new URLSearchParams(location.search || '').get('pet') === '1'; } catch (e) { return false; }
  }
  function cloudOn() { return !!(window.CLOUD && window.CLOUD.enabled); }
  function cloudUser() { return cloudOn() && window.CLOUD.user && typeof window.CLOUD.user.id === 'string' ? window.CLOUD.user : null; }

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

  function view() {
    if (!on) return { on: false };
    const now = Date.now();
    const r = P.reconcile({ local: readLocal(), remote: null, hist: readHist(), now });
    const reason = r.readOnly || remoteBad ? 'readOnly' : clockBad ? 'clock' : '';
    return { on: true, cloud: cloudOn(), guest: !cloudUser(), readOnly: !!reason, reason, status: P.status(r.pet, now), pet: r.pet };
  }
  function emit() {
    try { window.dispatchEvent(new CustomEvent('pet:change', { detail: view() })); } catch (e) { /* 沒有畫面在聽也沒關係 */ }
  }
  /* 出錯(例如頁面沒載入 common.js)不丟到外面:回 ok:false,什麼都不寫 */
  function enqueue(task) {
    const safe = () => Promise.resolve().then(task).catch(() => ({ ok: false, reason: 'error' }));
    const p = chain.then(safe, safe);
    chain = p.catch(() => null);
    return p;
  }

  /* 一次同步。mutate(pet, now) 回 { ok: true, pet } 或 { ok: false, reason }(餵食、改目標、取名用) */
  async function run(mutate) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (cloudOn()) { try { await window.CLOUD.ready; } catch (e) { /* 照本機算 */ } }
    lastSync = Date.now();
    const user = cloudUser();
    let cloudOk = false, remote = null, remoteRaw = null, skew = null;
    if (user) {
      let r = null;
      try { r = await window.CLOUD.readKey(KEY); } catch (e) { r = null; }
      if (r && r.ok === true) skew = await serverSkew(user.id);
      const cur = cloudUser();
      if (r && r.ok === true && skew !== null && cur && cur.id === user.id) {
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
    if (mutate) {
      const m = mutate(pet, now);
      if (!m || !m.ok) return finish(Object.assign({ ok: false, reason: (m && m.reason) || 'failed', readOnly: false, uploaded: false, status: P.status(pet, now), pet }, info));
      pet = m.pet;
    }
    /* 從這裡到寫入之間沒有 await:檢查與寫入一起完成 */
    if (user && profileGone()) return { ok: false, reason: 'loggedOut', readOnly: false, uploaded: false, status: P.status(pet, now), pet, guest: false, localOnly: true };
    const c = P.canon(pet);
    let uploaded = false;
    if (cloudOk && !(remoteRaw !== null && remoteRaw !== undefined && P.canon(remoteRaw) === c)) {
      store.set(KEY, pet);   // 寫本機,cloud.js 記帳後上傳
      uploaded = true;
    } else if (local === null || P.canon(local) !== c) {
      writeLocal(pet);
    }
    return finish(Object.assign({ ok: true, readOnly: false, uploaded, status: P.status(pet, now), pet }, info));
  }
  function finish(res) { emit(); return res; }

  function sync() {
    if (!on) return Promise.resolve({ ok: false, reason: 'off' });
    if (queued) return queued;
    queued = enqueue(() => { queued = null; return run(null); });
    return queued;
  }
  function act(mutate) {
    if (!on) return Promise.resolve({ ok: false, reason: 'off' });
    return enqueue(() => run(mutate));
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
    /* 別的分頁答了題或改了小雞:畫面跟著更新(不寫) */
    window.addEventListener('storage', e => {
      try { if (e && (e.key === storageKey(KEY) || e.key === storageKey('hist'))) emit(); } catch (err) { /* 沒載入 common.js */ }
    });
    ready = sync();
  }

  window.PET_STORE = { on, ready, sync, view, feed, setGoal, rename, afterAnswer, idle: () => chain };
})();
