/* 雲端同步層(Supabase)。
   - CLOUD_CONFIG 未填 → CLOUD.enabled=false,全站維持本機模式。
   - 已填 → 載入 supabase-js(CDN),提供 login/logout/push;登入後把雲端進度灌回
     localStorage(沿用既有命名空間機制),各模組程式完全不用改。
   - 同步策略:每次 store.set 後 0.8 秒內去抖動上傳該鍵;每個分頁工作階段登入時整批下載一次。
   - 合併表(MERGED)上的鍵上傳前先讀雲端那一列、合併、存回本機,再上傳合併結果;灌雲端資料時本機和雲端都有就存合併結果,不直接覆蓋。
     讀不到雲端、合併說唯讀(形狀認不得,例如更新版的格式)、頁面沒有合併函式時不上傳,帳本留著(不會退回整份上傳)。
     其他鍵的上傳、灌資料、帳本、登出跟以前一樣(整份上傳,後傳的蓋掉先傳的)。
     · pet(小雞第二階段規格附錄 A.5):合併函式 PET.cloudMerge(js/pet.js)。合併前跟 pet-store 一樣用登入憑證的 iat 對時,
       這台時鐘差太多也不合併、不上傳,帳本留著(合併整理時用這台的時間,慢的時鐘會丟掉別台最近幾天的紀錄)。
       登出前(chick2 第一輪修正 #2、#4):先叫 pet-store 把還在等讀雲端的券和動作寫下來(PET_STORE.flushPending),
       帳本上沒有、但標記成「只在本機」的 pet(開關都關時讀不到雲端只寫本機的改動)也先合併上傳,傳不上去就算進「還沒同步」先問。
       pet 因為雲端是更新版格式(v3)而留在帳本時,登出會照樣提示把它算進「還沒同步」。pet 的每一次請求跟以前逐位元組相同。
     · vgame_banks(自訂題庫)、sync_del(刪除標記)、mock_history(模擬考紀錄)(同步合併設計,2026-10-24):
       合併函式在 js/sync-merge.js(SYNC_MERGE,每一頁都在 cloud.js 之前載入)。題庫「少了不算刪除」,只有刪除標記對得上的才刪;
       題庫上傳時跟 sync_del 一次查詢讀兩列、一次 upsert 傳兩列。單字頁、閱讀頁開頁時呼叫 syncKey 跟雲端對齊一次;
       登出前多一輪對帳(雲端比本機少就先合併上傳再刪本機)。寫作、hist、錯題本還是整份上傳(下一輪)。
   已知限制:
     1. 兩台在同一時間讀雲端、合併、上傳時,後到的那台可能蓋掉先到的那台剛傳上去的東西;先到那台本機還留著,
        下次上傳、灌資料、開單字頁、登出前對帳時會再合併上傳(pet 是 pet-store 的 remoteBehind),所以不會永久消失。
     2. 舊版頁面(部署前就開著的分頁、拿快取的頁面)整份上傳題庫,可能暫時把雲端蓋掉,新版下一次合併時補回;舊版頁面刪的題庫、字沒有標記,會回來。
     3. 在新版刪掉一個舊資料的字(沒有 _r),之後在舊版頁面加回一模一樣的字(英文、中文、勾選都一樣),會被標記刪掉。
     4. 刪除標記保留 400 天、最多 1000 筆;清掉之後,很久沒開的裝置可能把刪掉的帶回來(只會多)。
     5. 兩台都改了同一個字的中文:新的當主要,另一個放 alt(編輯頁看得到,可以換或刪)。
     6. 別台舊版把雲端蓋掉、而唯一還有那份的新版裝置在登出時又讀不到雲端(帳本是空的,不會問):那份會跟著登出刪掉。
     7. 單鍵 256 KB:合併只會讓題庫變大,碰到上限時上傳會一直失敗、帳本一直留著,登出時會問。 */
(function () {
  const cfg = window.CLOUD_CONFIG || {};
  const enabled = !!(cfg.url && cfg.anonKey);

  /* Google 登入失敗時 Supabase 不是回傳錯誤,而是把錯誤掛在網址的 # 後面導回來。
     這裡先接住再把網址清乾淨(登入卡會把它顯示出來);密碼重設的 # 帶的是 token,不動它。 */
  const authError = (function () {
    const hash = location.hash || '';
    if (!/[#&]error/.test(hash) || /access_token=/.test(hash)) return '';
    const m = /[#&]error_description=([^&]*)/.exec(hash) || /[#&]error(?:_code)?=([^&]*)/.exec(hash);
    const raw = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '登入沒有完成。';
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    return raw;
  })();

  /* 使用權(收費)的狀態。宣告在這裡,雲端沒開時 locked() 等函式也能安全呼叫 */
  let serverAccess = null;    // 這個分頁從伺服器拿到的 my_access;null = 還不知道
  let accessPromise = null;   // 這一頁正在查的 my_access(沒查就是 null)
  let accessSeq = 0, appliedSeq = 0;   // 每次查詢編號;只採用比已採用的那次更新的回答(舊的晚回來就丟掉)
  const ACCESS_TIMEOUT_MS = 8000;
  const INTENT_WINDOW_MS = 30 * 60e3, INTENT_SKEW_MS = 2 * 60e3;
  const INTENT_KEY = 'tr_signup_intent', OLD_INTENT_USED_KEY = 'tr_signup_intent_used';   // 後者是舊版寫的,開頁就清掉
  let googleBack = false;   // 這一頁是這個分頁自己從 Google 回來的,而且有 Google 那條意向:getSession 之後綁帳號 id(bindGoogleIntent)
  let idBeforeBack = '';    // 那一頁開頁時(supabase-js 處理網址之前)這台原本登入的帳號 id;getSession 拿到的還是它,就不是這次 Google 回來的
  let otherTabSignedIn = false;   // 那一頁開頁到 getSession 之間,別的分頁改過登入資料(watchOtherTabs)
  /* supabase-js 把登入資料存在 localStorage 的這個位置(預設名稱:sb-<專案代號>-auth-token) */
  const SB_KEY = 'sb-' + ((/^https?:\/\/([^./]+)\./.exec(cfg.url) || [])[1] || '') + '-auth-token';

  window.CLOUD = { enabled, ready: Promise.resolve(null), user: null, isTeacher: false, sessionExpired: false, client: null, authError: authError ? friendly({ message: authError }) : '', login, logout, push, readKey, signUp, signInWithGoogle, resetPassword, updatePassword, resendConfirm, deleteAccount, updateName, nameOf,
    access: null, accessReady: Promise.resolve(null), refreshAccess, locked, cachedAccess, joinClass, startTeacherTrial, myBilling, trialIntentOk, accessStatus, trialEndsSoon,
    startCheckout, myCheckout, isOwner,
    saveSignupIntent, takeSignupIntent, clearSignupIntent, markLocalOnly, clearLocalOnly, syncKey };
  /* 先合併再上傳的鍵(同步合併設計 3.2)。merge() 用到時才找合併函式:頁面沒載到(pet.js、sync-merge.js)就是 null,
     這時不上傳、帳本留著,不會退回整份上傳。
     clock:合併前要對時(只有 pet:PET.cloudMerge 依日期裁切,慢的時鐘會丟掉別台的新日期)。
     tombs:合併要用刪除標記;上傳時跟 sync_del 一次查詢讀兩列、一次 upsert 傳兩列(雲端不會有「題庫少了、標記還沒到」的空窗)。
     reconcile:登出前、頁面呼叫 syncKey 時也比一次雲端(pet 不加,它的請求維持不變)。queue:跟哪個鍵排同一個佇列。
     順序有用:灌資料時 sync_del 要先合併,合併後的標記給 vgame_banks 用。 */
  const TOMBS = 'sync_del';
  const SMF = name => () => { const S = window.SYNC_MERGE; return S && typeof S[name] === 'function' ? S[name] : null; };
  const MERGED = {
    pet: { merge: () => (window.PET && typeof window.PET.cloudMerge === 'function' ? window.PET.cloudMerge : null), clock: true },
    sync_del: { merge: SMF('tombs'), reconcile: true, queue: 'vgame_banks' },
    vgame_banks: { merge: SMF('banks'), tombs: true, reconcile: true },
    mock_history: { merge: SMF('mock'), reconcile: true },
  };
  const spec = k => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(MERGED, k) ? MERGED[k] : null);
  window.CLOUD.mergedKeys = Object.freeze(Object.keys(MERGED));   // pet-store 用它判斷這一版 cloud.js 會先合併 pet 再上傳
  if (!enabled) return;
  tidySignupIntent(authError);   // 註冊時選老師的意向:開頁就清過期的、記下「這個分頁從 Google 回來了」(要趁 supabase-js 清掉網址之前;getSession 之後綁帳號 id)

  /* 登入失效改回訪客(leaveStaleAccount)時記一個旗標,重載後的那一頁讀到就清掉:
     頂欄只在這個分頁顯示一次「登入已失效」,換頁或下一個人開新分頁都不會再出現 */
  const EXPIRED_KEY = 'tr_auth_expired';
  try {
    window.CLOUD.sessionExpired = sessionStorage.getItem(EXPIRED_KEY) === '1';
    sessionStorage.removeItem(EXPIRED_KEY);
  } catch (e) { window.CLOUD.sessionExpired = false; }

  let client = null;
  const pending = {};
  const queues = {};              // 要合併的鍵的上傳一個一個做,不跟自己搶(sync_del 跟 vgame_banks 排同一個)
  /* 開站確認登入狀態(有網路約 1 秒;離線又遇到登入憑證過期,supabase-js 會重試約 25 秒)之前的寫入先放 early,
     確認完再決定:這一頁剛灌完雲端資料要重載 → 作廢(那些寫入根據的是舊資料,以雲端為準);其他情況 → 記進帳本。 */
  let settled = false;
  let hydrating = false;   // 這一頁決定要灌雲端資料了(之後要重載)
  let reloading = false;
  const early = {};

  window.CLOUD.ready = init();
  /* 確認登入之後,等這一頁的 my_access 查完(沒查、失敗、逾時都是 null) */
  window.CLOUD.accessReady = window.CLOUD.ready.then(() => accessPromise || null, () => null);
  /* 使用權快取只留目前登入的帳號那一份;登出、刪帳號、換帳號後重載的那一頁就清掉 */
  window.CLOUD.ready.then(() => purgeAccessCache(window.CLOUD.user), () => purgeAccessCache(null));

  function loadSdk() {
    return new Promise((res, rej) => {
      if (window.supabase && window.supabase.createClient) return res();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = res;
      s.onerror = () => rej(new Error('無法載入雲端元件，請檢查網路後重新整理'));
      document.head.appendChild(s);
    });
  }

  async function init() {
    try {
      if (window.navigator && navigator.onLine === false && adoptStored()) return window.CLOUD.user;
      await loadSdk();
      client = window.supabase.createClient(cfg.url, cfg.anonKey);
      window.CLOUD.client = client;
      const { data: { session } } = await client.auth.getSession();
      bindGoogleIntent(session);   // 只動註冊意向那一個鍵,不碰登入與同步
      if (!session) { adoptStored(); leaveStaleAccount(); return window.CLOUD.user; }
      window.CLOUD.user = session.user;
      await afterAuth(session.user, false);
      return session.user;
    } catch (e) {
      console.warn('雲端初始化失敗：', e);
      adoptStored();
      leaveStaleAccount();
      return window.CLOUD.user;
    } finally {
      bindGoogleIntent(null);   // 從 Google 回來卻沒走到 getSession(離線、雲端元件載不到):Google 那條意向丟掉;已經綁過就什麼都不做
      settled = true;
      if (!reloading) keepEarly();
      flushAll();
    }
  }

  /* 離線開 App,或連不到雲端(登入憑證換不到新的、雲端元件載不到):這台還留著登入資料、而且就是目前資料夾的帳號,
     就維持登入狀態。這時不灌資料、上傳多半會失敗,寫入照樣記帳,下次連上再補傳。
     supabase-js 只有在網路類的失敗才會留著登入資料;憑證被撤銷之類會自己清掉,這裡就讀不到。 */
  function adoptStored() {
    if (window.CLOUD.user) return true;
    try {
      const saved = JSON.parse(localStorage.getItem(SB_KEY));
      const u = saved && saved.user;
      if (u && typeof u.id === 'string' && pidOf(u) === window.__PROFILE_ID) { window.CLOUD.user = u; return true; }
    } catch (e) {}
    return false;
  }

  /* 資料夾還停在雲端帳號,這台卻沒有這個帳號的登入資料(別台按「登出所有裝置」、帳號刪除):改回訪客再重載。
     之後沒登入的人練習的東西寫在訪客的資料夾,原帳號下次登入時才不會把它當成「從沒上傳過的資料」傳上去。
     原帳號的資料與帳本一筆都不刪(只有登出才刪),下次登入照常比對新舊。
     目前不處理(分不出是本人還是別人寫的,丟資料或混入別人的練習要二選一):開站確認登入那一兩秒內的寫入、
     頁面開著時才被撤銷的寫入,照舊留在原帳號。 */
  function leaveStaleAccount() {
    const pid = window.__PROFILE_ID;
    if (reloading || window.CLOUD.user || typeof pid !== 'string' || pid.charAt(0) !== 'c') return;
    /* 別的分頁可能已經換成別的帳號登入:那就不動目前帳號,重載後跟著它 */
    try {
      if (localStorage.getItem('tr_current_profile') === JSON.stringify(pid)) {
        localStorage.removeItem('tr_current_profile');
        try { sessionStorage.setItem(EXPIRED_KEY, '1'); } catch (e) { /* 提示不顯示而已 */ }
      }
    } catch (e) { return; }
    window.__PROFILE_ID = null;
    reloading = true;
    location.reload();
  }

  function pidOf(user) { return 'c' + user.id.replace(/-/g, ''); }
  /* 這台 supabase-js 還留著登入資料、而且就是目前資料夾的帳號 → 回它的 id;否則回空字串。
     登入被撤銷(別台按「登出所有裝置」、帳號刪除)時 supabase-js 會清掉登入資料,這時的寫入不記帳:
     那可能是別人在用這台,或是根據很久沒更新的本機資料,下次登入要以雲端為準。 */
  function storedUid() {
    try {
      const u = (JSON.parse(localStorage.getItem(SB_KEY)) || {}).user;
      if (u && typeof u.id === 'string' && pidOf(u) === window.__PROFILE_ID) return u.id;
    } catch (e) {}
    return '';
  }

  async function afterAuth(user, fresh) {
    if (paidUi()) accessPromise = fetchAccess(user);   // 使用權跟教師身分同時查;不等它,登入與灌資料照舊
    try {
      const { data } = await client.from('teachers').select('user_id').eq('user_id', user.id);
      window.CLOUD.isTeacher = !!(data && data.length);
    } catch (e) { /* 非教師 */ }
    if (serverAccess && typeof serverAccess.is_teacher === 'boolean') window.CLOUD.isTeacher = serverAccess.is_teacher;   // my_access 先回來了:以它為準

    const pid = pidOf(user);
    localStorage.setItem('tr_current_profile', JSON.stringify(pid));

    const flagKey = 'tr_cloud_hydrated_' + user.id;
    if (fresh || !sessionStorage.getItem(flagKey)) {
      hydrating = true;
      const { data: rows, error } = await client.from('progress').select('k,v,updated_at').eq('user_id', user.id);
      if (error) throw error;   // 連不上就整段不做:本機一個都不刪
      const prefix = 'tr_u' + pid + '_';
      const cloud = {};
      (rows || []).forEach(r => { cloud[r.k] = r; });
      /* 要對時的鍵(pet)本機和雲端都有時,先對時;時鐘差太多就不合併(planMerged 照原本的規則,留本機也不補傳) */
      const clockOk = mergeNeeded(prefix, cloud) ? await sessionClockOk(user) : true;

      /* 哪些鍵要留本機的版本(其餘照舊用雲端覆蓋):
         - 帳本上有、而且本機改動時間比雲端新(或雲端沒有這一列)
         - 帳本上沒有,但雲端完全沒有這一列:代表從來沒傳上去過(例如新建自訂題庫後馬上關頁)。
           被別台裝置刪掉的鍵在雲端是 v=null 的一列,不會落在這裡。 */
      const led = readLedger(user.id);
      Object.keys(early).forEach(k => { if (led[k] === early[k]) delete led[k]; });   // 這一頁確認登入前的寫入根據的是舊資料,以雲端為準
      const keepLocal = {};
      Object.keys(led).forEach(k => {
        const c = cloud[k];
        if (!c || !(Date.parse(c.updated_at) >= led[k])) keepLocal[k] = led[k];
        else delete led[k];   // 雲端比較新:用雲端的,帳本劃掉
      });
      for (let i = 0; i < localStorage.length; i++) {
        const lk = localStorage.key(i);
        if (!lk || !lk.startsWith(prefix)) continue;
        const k = lk.slice(prefix.length);
        if (!(k in cloud) && !(k in keepLocal)) { keepLocal[k] = Date.now(); led[k] = keepLocal[k]; }
      }
      const plan = planMerged(prefix, cloud, keepLocal, led, clockOk, readLocalOnly(user.id));   // pet:本機和雲端都有就存合併結果(下面雲端蓋本機那一圈之後才寫)
      writeLedger(user.id, led);
      /* 灌過資料:只在本機的改動不是合併過(跟雲端一樣,或記在帳本上)、就是留本機記在帳本上,標記都不用了;
         對不了時留在本機的(hold)標記留著,登出時還是先合併上傳、傳不上去先問 */
      Object.keys(MERGED).forEach(k => { if (!plan.hold[k]) unmark(user.id, k, Infinity); });

      for (let i = localStorage.length - 1; i >= 0; i--) {
        const lk = localStorage.key(i);
        if (lk && lk.startsWith(prefix) && !(lk.slice(prefix.length) in keepLocal)) localStorage.removeItem(lk);
      }
      (rows || []).forEach(r => {
        if (r.k !== '_meta' && r.v !== null && !(r.k in keepLocal)) localStorage.setItem(prefix + r.k, JSON.stringify(r.v));
      });
      Object.keys(plan.save).forEach(k => localStorage.setItem(prefix + k, JSON.stringify(plan.save[k])));
      /* 留下來的本機改動補傳上去;失敗也沒關係,帳本還在,下次再傳。合併說唯讀的不補傳 */
      await Promise.all(Object.keys(keepLocal).filter(k => !plan.hold[k]).map(k => upload(user, k, keepLocal[k])));
      sessionStorage.setItem(flagKey, '1');
      try {
        await client.from('progress').upsert({
          user_id: user.id, k: '_meta',
          v: { email: user.email, name: nameOf(user), last_login: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,k' });
      } catch (e) { /* 名冊寫入失敗不擋使用 */ }
      reloading = true;
      location.reload();   // 重載讓各模組讀到剛灌回的雲端進度
    }
  }

  async function login(email, password) {
    await window.CLOUD.ready;
    if (!client) throw new Error('雲端元件尚未載入，請重新整理再試');
    const { data, error } = await client.auth.signInWithPassword({ email: String(email).trim(), password });
    if (error) {
      if (/Invalid login credentials/i.test(error.message)) throw new Error('帳號或密碼不對。當初用 Google 註冊的話，要按上面的 Google 登入。');
      if (/Email not confirmed/i.test(error.message)) throw new Error('信箱還沒驗證：請到信箱點驗證連結（找不到信可以到「註冊」分頁重寄）');
      if (/rate limit|too many/i.test(error.message)) throw new Error('請求太頻繁，請幾分鐘後再試');
      if (/fetch|network/i.test(error.message)) throw new Error('連不上雲端伺服器：請檢查網路；若持續發生，請老師確認 Supabase 專案沒有休眠');
      throw new Error(error.message);
    }
    window.CLOUD.user = data.user;
    await afterAuth(data.user, true);
  }

  async function logout(opts) {
    const user = window.CLOUD.user;
    const everywhere = !!(opts && opts.everywhere);
    /* 這台已經沒有登入資料時 supabase-js 不會呼叫伺服器、直接回成功,別台其實沒被登出:先擋下來,什麼都不刪 */
    if (everywhere && !localStorage.getItem(SB_KEY)) throw new Error('這台的登入已失效，沒辦法登出其他裝置。請重新登入後再試一次。');
    if (user && !(opts && opts.discard)) {
      flushPetStore();   // 小雞還在等讀雲端的券和動作先寫下來(chick2 第一輪修正 #4)
      const left = await unsynced(user);
      if (left > 0 && !confirm('還有 ' + left + ' 項進度還沒同步到雲端（可能是網路不穩）。現在登出，這台裝置上的這些進度會刪除。確定要登出？')) return;
    }
    /* 一般的登出只登出這台(共用電腦登出不會把學生自己手機上的登入一起踢掉)。
       everywhere:「我的」頁的「登出所有裝置」。連不上伺服器時 supabase-js 會先清掉這台的登入資料再回錯誤,
       這時把登入資料放回去,這台維持登入、不刪資料,丟錯誤讓畫面講清楚。
       只登出這台時沒網路 signOut 會失敗、而且可能不清本機的登入資料:下面照樣清掉,免得下次開站又自動登回去 */
    if (everywhere) {
      const saved = localStorage.getItem(SB_KEY);
      let error = null;
      try { ({ error } = await client.auth.signOut({ scope: 'global' })); }
      catch (e) { error = e; }
      if (error) {
        try { if (saved && !localStorage.getItem(SB_KEY)) localStorage.setItem(SB_KEY, saved); } catch (e) {}
        throw new Error('連不上雲端伺服器，沒辦法確認其他裝置已登出。這台維持登入，請確認網路後再試一次。');
      }
    } else {
      try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* 雲端元件沒載到 */ }
    }
    try { [SB_KEY, SB_KEY + '-user', SB_KEY + '-code-verifier'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
    if (user) {
      writeLedger(user.id, {});
      writeLocalOnly(user.id, {});
      sessionStorage.removeItem('tr_cloud_hydrated_' + user.id);
      const prefix = 'tr_u' + pidOf(user) + '_';
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) localStorage.removeItem(k);   // 共用電腦不留個資
      }
    }
    localStorage.removeItem('tr_current_profile');
    clearSignupIntent();   // 註冊時選老師的意向(前端計畫三.6):登出就作廢,下一個人用這台不會沿用
    location.reload();
  }

  /* 顯示名稱:Email 註冊時填的暱稱(user_metadata.name);Google 登入沒填過暱稱,
     就用 Google 帳戶的名字(full_name);兩者都沒有才用 email 的 @ 前段 */
  function nameOf(user) {
    const m = (user && user.user_metadata) || {};
    return String(m.name || m.full_name || ((user && user.email) || '').split('@')[0] || '').trim();
  }

  function siteUrl(page) {
    return location.origin + location.pathname.replace(/[^/]*$/, '') + page;
  }

  function needClient() {
    if (!client) throw new Error('雲端元件尚未載入，請重新整理再試');
  }

  function friendly(error) {
    const m = error.message || '';
    if (/already registered|already exists|already been registered/i.test(m)) return '這個 Email 已經註冊過，請直接登入；當初用 Google 註冊的話按 Google 登入，忘記密碼可以重設。';
    if (/unsupported provider|provider is not enabled|provider.*disabled/i.test(m)) return 'Google 登入目前不能用，請改用 Email 註冊。';
    if (/redirect|not allowed.*url/i.test(m)) return 'Google 登入的網址設定不對，請改用 Email 註冊。';
    if (/password/i.test(m) && /short|least|characters/i.test(m)) return '密碼至少 8 碼。';
    if (/rate limit|too many|security purposes/i.test(m)) return '請求太頻繁，請幾分鐘後再試。';
    if (/signups? not allowed|signup is disabled|not allowed/i.test(m)) return '目前未開放註冊，請聯絡老師。';
    if (/invalid.*email|email.*invalid/i.test(m)) return 'Email 格式不對。';
    if (/fetch|network/i.test(m)) return '連不上雲端伺服器，請檢查網路後再試。';
    return m;
  }

  /* 註冊:Confirm email 開啟時要先到信箱點連結(回 needsConfirm:true);關閉時直接登入 */
  async function signUp(email, password, name) {
    await window.CLOUD.ready;
    needClient();
    const { data, error } = await client.auth.signUp({
      email: String(email).trim(), password,
      options: { data: { name: String(name || '').trim().slice(0, 20) }, emailRedirectTo: siteUrl('index.html') },
    });
    if (error) throw new Error(friendly(error));
    /* Confirm email 開啟時,已註冊過的 email 會回一個沒有 identities 的假 user(不洩漏帳號存在),這裡當作已註冊處理 */
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('這個 Email 已經註冊過，請直接登入；當初用 Google 註冊的話按 Google 登入，忘記密碼可以重設。');
    }
    bindEmailIntent(email, data.user);   // 註冊時選了老師:意向綁上這個新帳號的 id(前端計畫三.6;沒有意向什麼都不做)
    if (data.session) {
      window.CLOUD.user = data.user;
      await afterAuth(data.user, true);
      return { needsConfirm: false };
    }
    return { needsConfirm: true };
  }

  /* Google 登入:導到 Google 同意頁,回來時 supabase-js 會從網址取回 session,
     init() 接著跑 afterAuth 灌回進度。backTo 給空值就回到按下按鈕的那一頁。
     Google 帳戶的 Email 本來就驗證過了,不會再寄驗證信。 */
  async function signInWithGoogle(backTo) {
    await window.CLOUD.ready;
    needClient();
    const redirectTo = backTo ? siteUrl(backTo) : location.href.split('#')[0];
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, queryParams: { prompt: 'select_account' } },
    });
    if (error) throw new Error(friendly(error));
  }

  /* 改暱稱(Google 進來的人沒填過,教師後台看到的是 Google 帳戶名字) */
  async function updateName(name) {
    await window.CLOUD.ready;
    needClient();
    const n = String(name || '').trim().slice(0, 20);
    if (!n) throw new Error('暱稱還沒填。');
    const { data, error } = await client.auth.updateUser({ data: { name: n } });
    if (error) throw new Error(friendly(error));
    if (data && data.user) window.CLOUD.user = data.user;
    const u = window.CLOUD.user;
    try {
      await client.from('progress').upsert({
        user_id: u.id, k: '_meta',
        v: { email: u.email, name: n, last_login: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,k' });
    } catch (e) { /* 名冊寫入失敗不擋使用 */ }
    return n;
  }

  async function resetPassword(email) {
    await window.CLOUD.ready;
    needClient();
    if (!/^\S+@\S+\.\S+$/.test(String(email).trim())) throw new Error('Email 格式不對。');
    const { error } = await client.auth.resetPasswordForEmail(String(email).trim(), { redirectTo: siteUrl('reset.html') });
    if (error) throw new Error(friendly(error));
  }

  async function updatePassword(password) {
    await window.CLOUD.ready;
    needClient();
    const { error } = await client.auth.updateUser({ password });
    if (error) throw new Error(friendly(error));
  }

  async function resendConfirm(email) {
    await window.CLOUD.ready;
    needClient();
    const { error } = await client.auth.resend({ type: 'signup', email: String(email).trim(), options: { emailRedirectTo: siteUrl('index.html') } });
    if (error) throw new Error(friendly(error));
  }

  /* 自助刪除帳號:呼叫資料庫函式 delete_own_account(見 tools/supabase_public_signup.sql),成功後清本機並登出 */
  async function deleteAccount() {
    await window.CLOUD.ready;
    needClient();
    const { error } = await client.rpc('delete_own_account');
    if (error) throw new Error('刪除失敗：' + error.message + '。請寫信給站長要求刪除。');
    await logout({ discard: true });
  }

  /* ---------- 使用權(收費) ----------
     原則(前端計畫一.1、三):讀不到 my_access 一律放行,只有這個分頁從伺服器拿到 active === false 才算鎖住。
     window.PAID_UI(js/plans-config.js)不是 true 時完全不呼叫 my_access(資料庫還沒有這個函式)。
     快取 tr_access_<帳號 id> 只給離線時顯示日期,不拿來擋人。同步(push、flushAll、灌資料)完全不看使用權。 */
  function paidUi() { return window.PAID_UI === true; }
  function accessKey(uid) { return 'tr_access_' + uid; }
  const NOTE_KEY = 'tr_trial_note_closed';

  /* 快取只存離線時顯示日期要用的欄位;班名、點數、角色、教師欄位不存(共用電腦不留個資) */
  const CACHE_FIELDS = ['active', 'source', 'is_owner', 'until', 'trial_until', 'paid_through', 'teacher_until', 'server_now'];
  function slimAccess(a) {
    const out = {};
    CACHE_FIELDS.forEach(k => { if (a[k] !== undefined) out[k] = a[k]; });
    return out;
  }
  function purgeAccessCache(user) {
    try {
      const keep = user && typeof user.id === 'string' ? accessKey(user.id) : null;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.indexOf('tr_access_') === 0 && k !== keep) localStorage.removeItem(k);
      }
      /* js/paywall.js 的「試用提示條關掉了」({ u: 帳號 id, until }):只留給目前登入的那個帳號 */
      const note = localStorage.getItem(NOTE_KEY);
      if (note !== null) {
        let u = null;
        try { const v = JSON.parse(note); u = v && typeof v === 'object' ? v.u : null; } catch (e) { u = null; }
        if (!keep || u !== user.id) localStorage.removeItem(NOTE_KEY);
      }
    } catch (e) { /* 讀不到 localStorage 就沒有東西可清 */ }
  }

  /* 查一次 my_access。失敗、沒資料、逾時、帳號已經換了都回 null,不動目前的結果;逾時之後才回來的也不採用。
     同時有兩次在查時(開頁的還沒回、又按了開始老師試用),先送的比較晚回來就丟掉,回目前採用的那份 */
  function fetchAccess(user) {
    const seq = ++accessSeq;
    return new Promise(resolve => {
      let done = false;
      const finish = a => { if (done) return; done = true; clearTimeout(timer); resolve(a); };
      const timer = setTimeout(() => finish(null), ACCESS_TIMEOUT_MS);
      let call;
      try { call = Promise.resolve(client.rpc('my_access')); } catch (e) { call = Promise.reject(e); }
      call.then(r => {
        const a = r && !r.error && r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : null;
        const cur = window.CLOUD.user;
        if (done || !a || !cur || cur.id !== user.id) return finish(null);
        if (seq < appliedSeq) return finish(serverAccess);
        appliedSeq = seq;
        serverAccess = a;
        window.CLOUD.access = a;
        if (typeof a.is_teacher === 'boolean') window.CLOUD.isTeacher = a.is_teacher;
        try { localStorage.setItem(accessKey(user.id), JSON.stringify({ at: Date.now(), access: slimAccess(a) })); } catch (e) { /* 存不進去只是離線時看不到日期 */ }
        finish(a);
      }, () => finish(null));
    });
  }

  function refreshAccess() {
    if (!enabled || !paidUi()) return Promise.resolve(null);
    const user = window.CLOUD.user;
    if (!user || !client) return Promise.resolve(null);
    return fetchAccess(user);
  }

  function locked() {
    return paidUi() && !!serverAccess && serverAccess.active === false;
  }

  /* 上一次存下來的使用權(只用來顯示日期) */
  function cachedAccess() {
    const u = window.CLOUD && window.CLOUD.user;
    if (!u || typeof u.id !== 'string') return null;
    try {
      const c = JSON.parse(localStorage.getItem(accessKey(u.id)));
      return c && c.access && typeof c.access === 'object' ? c.access : null;
    } catch (e) { return null; }
  }

  /* 資料庫的訊息不帶句號(線上的舊函式也是),顯示時統一補上 */
  function sentence(m) { return /[。！？!?.]$/.test(m) ? m : m + '。'; }

  /* 呼叫資料庫函式;資料庫的錯誤訊息(中文)原樣丟出,連不上才換成網路的說明 */
  async function callRpc(fn, args) {
    if (!enabled) throw new Error('這個網站沒有開雲端帳號。');
    await window.CLOUD.ready;
    if (!window.CLOUD.user) throw new Error('請先登入。');
    needClient();
    let res;
    try { res = await client.rpc(fn, args); } catch (e) { res = { error: e }; }
    if (res && res.error) {
      const m = String(res.error.message || '');
      throw new Error(/failed to fetch|networkerror|load failed/i.test(m) ? '連不上雲端伺服器，請檢查網路後再試。' : (m ? sentence(m) : '發生錯誤，請稍後再試。'));
    }
    return res ? res.data : null;
  }
  function joinClass(code) { return callRpc('join_class', { p_code: String(code == null ? '' : code) }); }
  async function startTeacherTrial(seats, name) {
    const data = await callRpc('start_teacher_trial', { p_seats: Number(seats), p_class_name: String(name || '').trim() || null });
    refreshAccess();
    return data;
  }
  function myBilling() { return callRpc('my_billing', {}); }
  /* 付款結果頁查自己的一筆單(newebpay/paid_gateway_additions.sql 的 my_checkout;不是自己的單回 null)。只讀 */
  function myCheckout(orderNo) { return callRpc('my_checkout', { p_order_no: String(orderNo == null ? '' : orderNo) }); }

  /* 建立藍新付款單(Edge Function newebpay-checkout,js/checkout.js 呼叫)。
     只送商品代號與「勾選同意」:金額由伺服器的價格表決定,這裡一個數字都不送。
     consent_at 是勾選的時間(裝置的鐘),伺服器另外用自己的時間記下同意的條款版本。
     回伺服器原本的回應 { action, fields, order_no },檢查交給 checkout.js(validResponse)。 */
  const CHECKOUT_TIMEOUT_MS = 20000;
  async function startCheckout(sku, consentAt) {
    if (!enabled) throw new Error('這個網站沒有開雲端帳號。');
    await window.CLOUD.ready;
    const user = window.CLOUD.user;
    if (!user) throw new Error('請先登入。');
    needClient();
    let token = '';
    try {
      const { data } = await client.auth.getSession();
      const s = data && data.session;
      if (s && s.user && s.user.id === user.id && typeof s.access_token === 'string') token = s.access_token;
    } catch (e) { token = ''; }
    if (!token) throw new Error('登入已失效，請重新登入後再試。');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, CHECKOUT_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(cfg.url.replace(/\/+$/, '') + '/functions/v1/newebpay-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: cfg.anonKey },
        body: JSON.stringify({ sku: String(sku), consent: true, consent_at: String(consentAt) }),
        cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined,
      });
    } catch (e) {
      throw new Error('連不上付款伺服器，請檢查網路後再試。');
    } finally {
      clearTimeout(timer);
    }
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (res.status === 401) throw new Error('登入已失效，請重新登入後再試。');
    if (!res.ok) {
      /* 回應是 { error: 代碼, message: 給人看的話 }(11 月 1 日前、已經可以使用的帳號),或舊的 { error: 給人看的話 }。
         英文代碼(not_open、method not allowed)不給人看 */
      const say = v => (typeof v === 'string' && /[^\x00-\x7f]/.test(v) ? v.trim() : '');
      const m = (body && (say(body.message) || say(body.error))) || '暫時無法建立付款，請稍後再試';
      throw new Error(sentence(m.slice(0, 120)));
    }
    return body;
  }

  /* 是不是站長:只用來決定價格頁要不要顯示 NT$10 測試項目(?paytest=1)。能不能買由資料庫擋(newebpay_begin_checkout)。
     有 my_access 就用它;PAID_UI 沒開時沒有,改讀自己那一列 teachers.is_owner(teachers 的政策只給讀自己的列)。 */
  async function isOwner() {
    if (!enabled) return false;
    try { await window.CLOUD.ready; } catch (e) { return false; }
    const user = window.CLOUD.user;
    if (!user || !client) return false;
    if (serverAccess && typeof serverAccess.is_owner === 'boolean') return serverAccess.is_owner;
    try {
      const { data, error } = await client.from('teachers').select('is_owner').eq('user_id', user.id);
      if (error || !Array.isArray(data)) return false;
      return data.some(r => r && r.is_owner === true);
    } catch (e) { return false; }
  }

  /* 讀雲端單一鍵(唯讀;路線圖 1.2b,小雞寫回前先抓雲端那一份合併,因為每個分頁只灌一次雲端資料)。
     回 { ok: true, found, v, updated_at }(雲端沒有這一列 found 是 false;別台刪掉的那一列 found 是 true、v 是 null)。
     沒登入、離線、連不上、逾時、讀到一半換了帳號、這一頁剛灌完資料要重載:回 { ok: false },
     呼叫的人這時不能把「沒讀到」當成「雲端沒有」去上傳。不寫本機、不動帳本、不上傳。 */
  const READ_TIMEOUT_MS = 8000;
  async function readKey(key) {
    const fail = { ok: false };
    if (!enabled || typeof key !== 'string' || !key || key.length > 100) return fail;
    try { await window.CLOUD.ready; } catch (e) { return fail; }
    const user = window.CLOUD.user;
    if (!client || !user || typeof user.id !== 'string' || reloading || pidOf(user) !== window.__PROFILE_ID) return fail;
    let timer = null;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS); });
    /* 先確認 supabase-js 手上的登入就是這個帳號:沒有登入時查詢會用公開金鑰,RLS 回空陣列,會被誤當成「雲端沒有」 */
    const query = (async () => {
      const { data } = await client.auth.getSession();
      const s = data && data.session;
      if (!s || !s.user || s.user.id !== user.id) return null;
      return client.from('progress').select('k,v,updated_at').eq('user_id', user.id).eq('k', key);
    })();
    let res;
    try { res = await Promise.race([query, timeout]); } catch (e) { res = null; }
    clearTimeout(timer);
    const cur = window.CLOUD.user;
    if (!res || res.error || !Array.isArray(res.data) || !cur || cur.id !== user.id || reloading) return fail;
    const row = res.data.filter(r => r && r.k === key)[0];
    if (!row) return { ok: true, found: false, v: null, updated_at: null };
    return { ok: true, found: true, v: row.v === undefined ? null : row.v, updated_at: typeof row.updated_at === 'string' ? row.updated_at : null };
  }

  /* 註冊時選了老師的意向('tr_signup_intent' = { seats, name, at, email?, uid? }),綁在要註冊的那個帳號上(前端計畫三.6;
     站長選的保守做法:只存在這台,不寫進帳號資料 user_metadata,別台點驗證信不會自動開,改用「我的」頁與教師後台的開始老師試用):
     - Email 註冊:存 localStorage(收驗證信可能換分頁),帶小寫的 Email。signUp 成功就綁上回來的帳號 id(uid),
       之後只認這個 id(同一個 Email 刪掉重建的帳號是新的 id,不算);沒拿到 id 就不自動開(不退回比 Email)。對不上的當場清掉、不用。
     - Google 註冊(按按鈕時還不知道 Email):存 sessionStorage,只有同一個分頁從 Google 回來讀得到。
       開頁時網址帶 access_token(或 ?code=)才算這個分頁自己從 Google 回來;那一頁 getSession 拿到帳號就綁上帳號 id,
       拿不到(沒有 session、雲端初始化失敗)、拿到的是開頁前這台就登入著的帳號(假的 ?code= 網址),
       或開頁到 getSession 之間別的分頁改過登入資料,就丟掉。之後只認綁的 id 跟登入的帳號一樣的;沒綁 id 的一律不算。
       別的分頁登入、在 Google 頁按上一頁、取消回來的都不算(取消回來的當場清掉)。
     選學生註冊、按登入時呼叫 clearSignupIntent;讀過一次(takeSignupIntent)不論成不成立都清掉。 */
  const sessionIntents = new WeakSet();   // takeSignupIntent 從這個分頁 sessionStorage 讀出來、綁的帳號 id 跟登入的一樣(Google 那條)
  function saveSignupIntent(o, at) {
    const email = o && typeof o.email === 'string' ? o.email.trim().toLowerCase() : '';
    const intent = { seats: Number(o && o.seats), name: String((o && o.name) || '').trim(), at: typeof at === 'number' ? at : Date.now() };
    if (email) intent.email = email;
    clearSignupIntent();
    try {
      if (email) localStorage.setItem(INTENT_KEY, JSON.stringify(intent));
      else sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
    } catch (e) { /* 存不進去就不會自動開試用,登入後到「我的」頁自己開 */ }
    return Object.assign({}, intent);
  }
  function clearSignupIntent() {
    try { localStorage.removeItem(INTENT_KEY); } catch (e) {}
    try { sessionStorage.removeItem(INTENT_KEY); } catch (e) {}
  }
  function readIntent(store) {
    try {
      const v = JSON.parse(store.getItem(INTENT_KEY));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch (e) { return null; }
  }
  /* 每一頁一載入(有沒有登入都一樣):過期(超過 30 分鐘)或時間在未來的意向清掉,Email 不在這台久留;
     Google 那條:網址是 Google 導回來的就記下(等 getSession 之後綁帳號 id),是登入失敗導回來的就清掉。
     舊版寫過的 tr_signup_intent_used 一併清掉(已經不用) */
  function tidySignupIntent(authErr) {
    try { localStorage.removeItem(OLD_INTENT_USED_KEY); } catch (e) {}
    const now = Date.now();
    const hash = String(location.hash || ''), search = String(location.search || '');
    const back = (/[#&]access_token=/.test(hash) && !/[#&]type=/.test(hash)) || /[?&]code=/.test(search);
    const tidy = (store, isSession) => {
      const raw = store.getItem(INTENT_KEY);
      if (raw === null) return;
      let v = null;
      try { v = JSON.parse(raw); } catch (e) { v = null; }
      const at = v && typeof v === 'object' ? v.at : NaN;
      if (typeof at !== 'number' || !isFinite(at) || now - at > INTENT_WINDOW_MS || at > now + INTENT_SKEW_MS) { store.removeItem(INTENT_KEY); return; }
      if (!isSession) return;
      if (authErr) store.removeItem(INTENT_KEY);
      else if (back) { googleBack = true; idBeforeBack = storedSessionId(); watchOtherTabs(true); }
    };
    try { tidy(localStorage, false); } catch (e) {}
    try { tidy(sessionStorage, true); } catch (e) {}
  }
  /* localStorage 裡 supabase-js 現在存的登入帳號 id(沒有就空字串) */
  function storedSessionId() {
    try {
      const u = (JSON.parse(localStorage.getItem(SB_KEY)) || {}).user;
      return u && typeof u.id === 'string' ? u.id : '';
    } catch (e) { return ''; }
  }
  /* 從 Google 回來的那一頁,開頁到 getSession 這段時間別的分頁有沒有改登入資料(storage 事件只有別的分頁寫的才會送,
     這一頁 supabase-js 自己存的不會)。改過就不知道 getSession 拿到的是不是這次 Google 回來的帳號(記在 otherTabSignedIn) */
  function onOtherTab(e) { if (e && (e.key === SB_KEY || e.key === null)) otherTabSignedIn = true; }
  function watchOtherTabs(on) {
    try { window[on ? 'addEventListener' : 'removeEventListener']('storage', onOtherTab); } catch (e) {}
  }
  /* 從 Google 回來的那一頁,getSession 之後呼叫一次(之後再呼叫什麼都不做):
     拿到帳號就把這個分頁的 Google 意向綁上帳號 id;沒有帳號(session 是 null、雲端初始化失敗)就丟掉。
     拿到的帳號就是開頁前這台原本登入的那一個(網址的 ?code= 是假的、沒換成新帳號),
     或這段時間別的分頁改過登入資料:也丟掉(改用「我的」頁與教師後台的開始老師試用) */
  function bindGoogleIntent(session) {
    if (!googleBack) return;
    googleBack = false;
    watchOtherTabs(false);
    const id = session && session.user && typeof session.user.id === 'string' ? session.user.id : '';
    try {
      const v = readIntent(sessionStorage);
      if (!v) return;
      if (!id || id === idBeforeBack || otherTabSignedIn) { sessionStorage.removeItem(INTENT_KEY); return; }
      const out = Object.assign({}, v, { uid: id });
      delete out.returned;
      sessionStorage.setItem(INTENT_KEY, JSON.stringify(out));
    } catch (e) { try { sessionStorage.removeItem(INTENT_KEY); } catch (e2) {} }
  }
  /* Email 註冊成功:把這台 localStorage 裡、Email 跟這次註冊一樣的意向綁上回來的帳號 id */
  function bindEmailIntent(email, user) {
    const id = user && typeof user.id === 'string' ? user.id : '';
    if (!id) return;
    try {
      const v = readIntent(localStorage);
      if (!v || typeof v.email !== 'string' || v.email !== String(email || '').trim().toLowerCase()) return;
      localStorage.setItem(INTENT_KEY, JSON.stringify(Object.assign({}, v, { uid: id })));
    } catch (e) { /* 綁不上:不自動開,登入後到「我的」頁自己開 */ }
  }
  /* Email 那條綁的是不是這個帳號:只比綁上的 uid。沒綁到 uid 的一律不算(不退回比 Email:
     同一個 Email 刪掉重建的帳號會被當成同一個),這時改用「我的」頁與教師後台的開始老師試用 */
  function emailIntentFor(v, user) {
    if (typeof v.email !== 'string' || !v.email) return false;
    return typeof v.uid === 'string' && !!v.uid && !!(user && user.id === v.uid);
  }
  /* 讀出這台的意向(讀了就清)。登入了就只回綁在這個帳號上的:Google 那條要綁的 id 一樣,
     Email 那條要綁的 id 一樣;對不上的回 null(一樣清掉)。帳號資料 user_metadata 一律不讀。 */
  function takeSignupIntent() {
    const u = window.CLOUD.user;
    const uid = u && typeof u.id === 'string' ? u.id : '';
    let intent = null;
    const s = readIntent(sessionStorage), l = readIntent(localStorage);
    if (s && uid && typeof s.uid === 'string' && s.uid === uid) {
      intent = { seats: s.seats, name: s.name, at: s.at, uid: s.uid };
      sessionIntents.add(intent);
    } else if (l && typeof l.email === 'string' && l.email && (!u || emailIntentFor(l, u))) {
      intent = { seats: l.seats, name: l.name, at: l.at, email: l.email };
      if (typeof l.uid === 'string' && l.uid) intent.uid = l.uid;
    }
    clearSignupIntent();
    return intent;
  }

  /* 登入後要不要自動開老師試用。全部成立才開(前端計畫三.6):意向是 30 分鐘內存的、
     綁的是這個帳號(Email 那條:綁的帳號 id 一樣,沒綁 id 的不算;Google 那條:這個分頁讀出來、綁的帳號 id 一樣)、
     帳號是這次才建立的、資料庫說可以試用。
     帳號建立時間是伺服器的鐘,意向的 at 是裝置的鐘:用 my_access 的 server_now 算出兩個鐘差多少再比。 */
  function trialIntentOk(intent, user, access, now) {
    const t = typeof now === 'number' ? now : Date.now();
    if (!intent || typeof intent !== 'object' || [10, 30, 60].indexOf(intent.seats) < 0) return false;
    if (sessionIntents.has(intent)) {
      if (!user || typeof intent.uid !== 'string' || !intent.uid || user.id !== intent.uid) return false;
    } else if (!emailIntentFor(intent, user)) return false;
    const created = Date.parse(user && user.created_at);
    if (!isFinite(created)) return false;
    const serverNow = Date.parse(access && access.server_now);
    const offset = isFinite(serverNow) ? serverNow - t : 0;   // 伺服器的鐘減裝置的鐘
    const at = intent.at;
    if (typeof at !== 'number' || !isFinite(at) || at > t + INTENT_SKEW_MS || t - at > INTENT_WINDOW_MS) return false;
    if (created < at + offset - INTENT_SKEW_MS) return false;
    return !!(access && access.teacher_trial_available === true);
  }

  /* 「我的」頁方案狀態用哪一種(前端計畫六.1 的順序);日期一律用伺服器回的 */
  function accessStatus(a) {
    if (!a || typeof a !== 'object') return null;
    if (a.is_owner) return { kind: 'owner' };
    const now = Date.parse(a.server_now);
    const paid = Date.parse(a.paid_through);
    if (isFinite(paid) && paid > (isFinite(now) ? now : Date.now())) return { kind: 'paid', until: a.paid_through };
    if (a.source === 'legacy' || a.source === 'class' || a.source === 'trial') return { kind: a.source, until: a.until || null };
    if (a.active === false) return { kind: 'expired' };
    return { kind: 'active', until: a.until || null };
  }

  /* 試用快結束的提示條:只有目前靠試用、而且 until 在 2 天以內(試用中已付款的人 until 是付費到期日,不會出現) */
  function trialEndsSoon(a) {
    if (!a || a.source !== 'trial' || !a.until) return false;
    const left = Date.parse(a.until) - Date.parse(a.server_now);
    return isFinite(left) && left > 0 && left <= 2 * 864e5;
  }

  /* ---------- 「還沒上雲」帳本 ----------
     鍵 → 本機改動的時間(ms)。寫入當下就記,上傳成功才劃掉。
     存在 localStorage 但不在學生資料的前綴底下,灌資料與登出的批次刪除不會誤刪它。 */
  function ledgerKey(uid) { return 'tr_unsynced_' + uid; }
  function readLedger(uid) {
    try { return JSON.parse(localStorage.getItem(ledgerKey(uid))) || {}; } catch (e) { return {}; }
  }
  function writeLedger(uid, led) {
    try {
      if (Object.keys(led).length) localStorage.setItem(ledgerKey(uid), JSON.stringify(led));
      else localStorage.removeItem(ledgerKey(uid));
    } catch (e) {}
  }

  /* ---------- 「只在本機」標記(要合併的鍵,chick2 第一輪修正 #2) ----------
     開關都關著(第 2 步)時,pet-store 讀不到雲端只寫本機、不記帳:同一台還開著的第 1 步分頁會把帳本上的 pet 不合併就傳上去。
     以前登出只看帳本,這些改動(取名、改目標、餵飼料)會不問就跟著帳號資料夾刪掉。現在 pet-store 寫本機時在這裡記「鍵 → 時間」,
     不在帳本裡,第 1 步的 cloud.js 看不到;登出時這一版先合併再上傳,傳不上去就算進「還沒同步」先問。
     合併上傳成功、灌資料合併過、pet-store 讀到雲端再寫過,就劃掉。存在帳號資料夾外面(灌資料不會當成進度上傳),登出時清掉 */
  let writeSeq = 0;   // 記帳(push)與標記的次數:登出補傳的時候又寫進來就再補傳一次
  function localOnlyKey(uid) { return 'tr_localonly_' + uid; }
  function readLocalOnly(uid) {
    try { const o = JSON.parse(localStorage.getItem(localOnlyKey(uid))); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
  }
  function writeLocalOnly(uid, o) {
    try {
      if (Object.keys(o).length) localStorage.setItem(localOnlyKey(uid), JSON.stringify(o));
      else localStorage.removeItem(localOnlyKey(uid));
    } catch (e) {}
  }
  function markedUser() {
    const u = enabled ? window.CLOUD.user : null;
    return u && typeof u.id === 'string' && pidOf(u) === window.__PROFILE_ID ? u : null;
  }
  function markLocalOnly(key) {
    const u = markedUser();
    if (!u || !spec(key)) return;
    writeSeq++;
    writeLocalOnly(u.id, Object.assign({}, readLocalOnly(u.id), { [key]: Date.now() }));
  }
  function clearLocalOnly(key) {
    const u = markedUser();
    if (u) unmark(u.id, key, Infinity);
  }
  /* 標記的時間不晚於 t(上傳的那份讀本機之前就寫了)才劃掉 */
  function unmark(uid, key, t) {
    const o = readLocalOnly(uid);
    if (!(key in o) || o[key] > t) return;
    const rest = Object.assign({}, o);
    delete rest[key];
    writeLocalOnly(uid, rest);
  }
  /* 登出前呼叫 pet-store:還在等讀雲端的券和動作先照讀不到雲端的規則寫下來(第 3 步記帳,第 2 步寫本機加標記) */
  function flushPetStore() {
    try { const S = window.PET_STORE; if (S && typeof S.flushPending === 'function') S.flushPending(); } catch (e) { /* 小雞出錯不擋登出 */ }
  }
  /* 登出前:帳本全部補傳,只在本機的要合併的鍵(帳本上沒有的)也先合併上傳。回傳還剩幾項沒上雲:
     帳本上的加上還標記著的,同一個鍵只算一次。等的這段時間又有寫入(例如小雞那一輪讀到雲端、寫了合併後的那份,
     讓這次合併上傳因為本機變了而放棄)就再補傳一次,最多三次;什麼都沒變就不再試(網路不通時不多等) */
  async function unsynced(user) {
    let left = 0;
    for (let pass = 0; pass < 3; pass++) {
      const before = pendingState(user), seq = writeSeq;
      left = await uploadPass(user);
      if (!left || (writeSeq === seq && pendingState(user) === before)) break;
    }
    if (await reconcile(user)) left = leftCount(user);   // 對帳時發現雲端少了:合併上傳;傳不上去的記在帳本,算進「還沒同步」
    return left;
  }
  async function uploadPass(user) {
    const marks = readLocalOnly(user.id), led = readLedger(user.id);
    const extra = Object.keys(marks).filter(k => spec(k) && !(k in led));
    const at = k => (typeof marks[k] === 'number' && isFinite(marks[k]) && marks[k] > 0 ? marks[k] : Date.now());
    await Promise.all([flushAll()].concat(canUpload(user) ? extra.map(k => upload(user, k, at(k))) : []));
    return leftCount(user);
  }
  /* 還剩幾項沒上雲:帳本上的加上還標記著「只在本機」的,同一個鍵只算一次 */
  function leftCount(user) {
    const left = new Set(Object.keys(readLedger(user.id)));
    Object.keys(readLocalOnly(user.id)).forEach(k => { if (spec(k)) left.add(k); });
    return left.size;
  }
  /* 登出前對帳(同步合併設計 3.5):表上 reconcile 的鍵、本機有值的,一次查詢讀它們在雲端的列(題庫連 sync_del 一起讀),
     合併結果跟雲端不同就記帳、走 upload 的佇列上傳。別台的舊版頁面可能剛把雲端蓋掉,這台本機是唯一還有那份的地方,
     登出要刪本機,刪之前確認雲端不比本機少。讀不到雲端(離線)、合併說唯讀:什麼都不做,不另外算進「還沒同步」
     (不然每次離線登出都要問;已知限制 6)。回傳有沒有發現雲端少了 */
  async function reconcile(user) {
    if (!canUpload(user)) return false;
    const prefix = 'tr_u' + pidOf(user) + '_';
    const has = k => { const v = readLocal(prefix + k); return v !== null && v !== undefined; };
    const keys = Object.keys(MERGED).filter(k => MERGED[k].reconcile && has(k));
    if (!keys.length) return false;
    const want = keys.some(k => MERGED[k].tombs) && keys.indexOf(TOMBS) < 0 ? [TOMBS].concat(keys) : keys;
    const rows = await readRows(user, want);
    if (!rows.ok) return false;
    let tombsV = null;
    const behind = [];
    Object.keys(MERGED).filter(k => want.indexOf(k) >= 0).forEach(k => {
      const local = readLocal(prefix + k);
      const cv = rows.found[k] ? rows.v[k] : null;
      if (local === null || local === undefined) { if (k === TOMBS) tombsV = cv; return; }
      const m = runMerge(k, local, cv, tombsV);
      if (k === TOMBS) tombsV = m && m.ok ? m.v : null;
      if (m && m.ok === true && !m.sameAsCloud) behind.push(k);
    });
    if (!behind.length) return false;
    const led = readLedger(user.id), t = Date.now();
    behind.forEach(k => { if (!(k in led)) led[k] = t; });
    writeSeq++;
    writeLedger(user.id, led);
    await Promise.all(behind.map(k => upload(user, k, led[k])));
    return true;
  }
  /* 帳本、標記和要合併的鍵的本機值:補傳前後比對,看等的時候有沒有又寫進來 */
  function pendingState(user) {
    const prefix = 'tr_u' + pidOf(user) + '_';
    let vals = [];
    try { vals = Object.keys(MERGED).map(k => localStorage.getItem(prefix + k)); } catch (e) { /* 讀不到就只比帳本 */ }
    return JSON.stringify([readLedger(user.id), readLocalOnly(user.id), vals]);
  }

  /* 上傳一個鍵。合併表上的鍵排隊走 uploadMerged(題庫走 uploadWithTombs),其他鍵照舊 */
  function upload(user, key, t) {
    const s = spec(key);
    if (!s) return uploadPlain(user, key, t);
    return enqueue(key, () => (s.tombs ? uploadWithTombs(user, key, t) : uploadMerged(user, key, t)));
  }
  function enqueue(key, run) {
    const q = spec(key).queue || key;
    const p = (queues[q] || Promise.resolve()).then(run, run);
    queues[q] = p.catch(() => false);
    return p;
  }

  /* 上傳一個鍵的「目前本機值」。成功且期間沒有更新的改動,才從帳本劃掉。 */
  async function uploadPlain(user, key, t) {
    let v = null;
    try {
      const raw = localStorage.getItem('tr_u' + pidOf(user) + '_' + key);
      v = raw === null ? null : JSON.parse(raw);
    } catch (e) { return false; }
    try {
      const { error } = await client.from('progress').upsert({
        user_id: user.id, k: key, v, updated_at: new Date(t).toISOString(),
      }, { onConflict: 'user_id,k' });
      if (error) throw error;
      const led = readLedger(user.id);
      if (led[key] !== undefined && led[key] <= t) { delete led[key]; writeLedger(user.id, led); }
      return true;
    } catch (e) {
      console.warn('進度暫時沒同步，已記下，下次連線會補傳：' + key, e);
      return false;
    }
  }

  /* ---------- 先合併再上傳的鍵(pet、自訂題庫、刪除標記、模擬考紀錄) ---------- */
  function mergeFn(key) { const s = spec(key); return s ? s.merge() : null; }
  /* 呼叫合併函式:題庫多給合併後的刪除標記;其他照 PET.cloudMerge 的約定(本機, 雲端, 現在)。丟錯當成合併不了 */
  function runMerge(key, local, cloudV, tombsV) {
    const fn = mergeFn(key);
    if (!fn) return null;
    try { return spec(key).tombs ? fn(local, cloudV, { now: Date.now(), tombs: tombsV }) : fn(local, cloudV, Date.now()); } catch (e) { return null; }
  }
  /* 讀本機一個鍵:沒有是 null,壞掉(不是 JSON)是 undefined */
  function readLocal(lk) {
    try { const raw = localStorage.getItem(lk); return raw === null ? null : JSON.parse(raw); } catch (e) { return undefined; }
  }
  /* 合併後寫回本機的通知(單字頁在首頁時重畫);pet 不送 */
  function notify(key) {
    if (key === 'pet') return;
    try { if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('cloud:merged', { detail: { key } })); } catch (e) { /* 只是不會自動重畫 */ }
  }
  /* 合併前對時(Integrate 加,跟 js/pet-store.js 同一套):PET.cloudMerge 整理時用這台的時間,晚超過 7 天的日期會丟掉、
     太舊的會壓縮。這台時鐘比伺服器慢超過 3 天或快超過 3 天、或拿不到登入憑證的 iat,就不合併、不上傳,帳本留著。
     兩台一快一慢時相差兩邊相加,pet.js 只留這台的今天加 7 天以內的日期、今天往前 6 天的 fed,所以兩邊相加不能超過 6 天:
     以前各 6 天,一台快 4 天、一台慢 4 天時,慢的那台合併會丟掉快的那台的練習日、達標日、券和吃掉紀錄再上傳
     (chick2 第三輪修正 #1;js/pet-store.js 同一組數字,test_pet.js 從兩個檔讀出來驗)。
     伺服器時間取自 supabase-js 手上登入憑證的 iat(剛換過的憑證,跟伺服器最多差憑證的有效期) */
  const SLOW_MAX_MS = 3 * 864e5, FAST_MAX_MS = 3 * 864e5;
  function clockOkFrom(s) {
    try {
      const part = s && typeof s.access_token === 'string' ? s.access_token.split('.')[1] : '';
      if (!part) return false;
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(window.atob(b64 + '==='.slice((b64.length + 3) % 4)));
      if (typeof claims.iat !== 'number' || !isFinite(claims.iat)) return false;
      const skew = claims.iat * 1000 - Date.now();
      return skew <= SLOW_MAX_MS && -skew <= FAST_MAX_MS;
    } catch (e) { return false; }
  }
  async function sessionClockOk(user) {
    let timer = null;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS); });
    let res;
    try { res = await Promise.race([client.auth.getSession(), timeout]); } catch (e) { res = null; }
    clearTimeout(timer);
    const s = res && res.data && res.data.session;
    return !!(s && s.user && s.user.id === user.id) && clockOkFrom(s);
  }
  /* 灌資料時有沒有要對時的鍵(pet)要合併(本機和雲端都有,雲端那一列 v 不是 null) */
  function mergeNeeded(prefix, cloud) {
    return Object.keys(MERGED).filter(k => MERGED[k].clock).some(k => {
      const c = cloud[k];
      if (!c || c.v === null || c.v === undefined) return false;
      try { const raw = localStorage.getItem(prefix + k); return raw !== null && raw !== 'null'; } catch (e) { return true; }
    });
  }
  function strike(user, key, t) {
    const led = readLedger(user.id);
    if (led[key] !== undefined && led[key] <= t) { delete led[key]; writeLedger(user.id, led); }
  }
  /* 先讀雲端那一列、合併、存回本機,再上傳合併結果。本機是 null:不上傳 null(不刪雲端那份),帳本劃掉。
     拿不到合併函式、讀不到雲端、合併說唯讀、讀雲端這段時間本機又改了:回 false,帳本留著,下一次再來。
     寫回本機不經過 store.set(不再記帳、不再觸發上傳) */
  async function uploadMerged(user, key, t, pull) {
    const lk = 'tr_u' + pidOf(user) + '_' + key;
    const readAt = Date.now();   // 這之前標記的「只在本機」改動都在要上傳的這一份裡
    let raw, v;
    try { raw = localStorage.getItem(lk); v = raw === null ? null : JSON.parse(raw); } catch (e) { return false; }
    if (v === null && !pull) { strike(user, key, t); unmark(user.id, key, readAt); return true; }
    const merge = mergeFn(key);
    if (!merge) return false;
    const row = await fetchRow(user, key);
    if (!row.ok) return false;
    if (v === null && !(row.found && row.v !== null)) return true;   // syncKey:兩邊都沒有
    let out = v, sent = raw;   // sent:上傳的那份在本機的樣子(上傳完本機還是它,標記才劃掉)
    if (row.found && row.v !== null) {
      if (spec(key).clock && !row.clock) return false;   // 時鐘差太多:不合併、不上傳,帳本留著
      let m = null;
      try { m = merge(v, row.v, Date.now()); } catch (e) { m = null; }
      if (!m || m.ok !== true) return false;
      try {
        if (localStorage.getItem(lk) !== raw) return false;
        if (!m.sameAsLocal) { localStorage.setItem(lk, JSON.stringify(m.v)); notify(key); }
      } catch (e) { return false; }
      if (m.sameAsCloud) { strike(user, key, t); unmark(user.id, key, readAt); return true; }
      if (!m.sameAsLocal) { out = m.v; sent = JSON.stringify(m.v); }
    }
    try {
      const { error } = await client.from('progress').upsert({
        user_id: user.id, k: key, v: out, updated_at: new Date(t).toISOString(),
      }, { onConflict: 'user_id,k' });
      if (error) throw error;
      strike(user, key, t);
      try { if (localStorage.getItem(lk) === sent) unmark(user.id, key, readAt); } catch (e) { /* 讀不到就留著標記,登出時多問一次 */ }
      return true;
    } catch (e) {
      console.warn('進度暫時沒同步，已記下，下次連線會補傳：' + key, e);
      return false;
    }
  }
  /* 上傳前讀雲端單一列。跟 readKey 一樣先確認 supabase-js 手上的登入就是這個帳號、8 秒逾時、讀到一半換帳號或要重載就算失敗;
     不等 CLOUD.ready(灌資料就在 init 裡面,等它會卡死)。回 { ok, found, v } */
  async function fetchRow(user, key) {
    const r = await readRows(user, [key]);
    if (!r.ok) return r;
    return r.found[key] ? { ok: true, found: true, v: r.v[key], clock: r.clock } : { ok: true, found: false, v: null, clock: r.clock };
  }
  /* 讀幾列(一列用 eq,跟以前的請求一模一樣;多列用 in,一次查詢)。回 { ok, found: { 鍵: true }, v: { 鍵: 值 }, clock } */
  async function readRows(user, keys) {
    const fail = { ok: false };
    if (!client || reloading) return fail;
    let timer = null, clock = false;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), READ_TIMEOUT_MS); });
    const query = (async () => {
      const { data } = await client.auth.getSession();
      const s = data && data.session;
      if (!s || !s.user || s.user.id !== user.id) return null;
      clock = clockOkFrom(s);
      const q = client.from('progress').select('k,v,updated_at').eq('user_id', user.id);
      return keys.length === 1 ? q.eq('k', keys[0]) : q.in('k', keys);
    })();
    let res;
    try { res = await Promise.race([query, timeout]); } catch (e) { res = null; }
    clearTimeout(timer);
    const cur = window.CLOUD.user;
    if (!res || res.error || !Array.isArray(res.data) || !cur || cur.id !== user.id || reloading) return fail;
    const out = { ok: true, found: {}, v: {}, clock };
    res.data.forEach(r => { if (r && keys.indexOf(r.k) >= 0 && !out.found[r.k]) { out.found[r.k] = true; out.v[r.k] = r.v === undefined ? null : r.v; } });
    return out;
  }

  /* 題庫(合併要用刪除標記的鍵)先合併再上傳(同步合併設計 3.3):
     1. 讀本機的題庫和 sync_del;2. 一次查詢讀雲端這兩列;3. 標記先合併,4. 題庫用合併後的標記合併;
     5. 讀雲端這段時間本機兩個鍵有變 → 放棄(下一次再來);6. 寫回本機(不經 store.set,不記帳);
     7. 跟雲端不同的列放在同一個 upsert 送出(兩列一起成功或一起失敗);8. 成功(或兩列都跟雲端一樣)就劃帳本:
        題庫用帳本時間 t,標記用讀本機的時間(那之前寫的標記都在這一份裡)。
     拿不到合併函式、讀不到雲端、任一個合併說唯讀:回 false,帳本留著,本機不改。
     pull(syncKey):本機沒有題庫也照樣把雲端那份(套過標記)放進本機 */
  async function uploadWithTombs(user, key, t, pull) {
    const prefix = 'tr_u' + pidOf(user) + '_';
    const lk = prefix + key, dk = prefix + TOMBS;
    const readAt = Date.now();
    let raw, rawD, v, d;
    try {
      raw = localStorage.getItem(lk); rawD = localStorage.getItem(dk);
      v = raw === null ? null : JSON.parse(raw); d = rawD === null ? null : JSON.parse(rawD);
    } catch (e) { return false; }
    if (v === null && !pull) { strike(user, key, t); return true; }
    if (!mergeFn(key) || !mergeFn(TOMBS)) return false;
    const rows = await readRows(user, [key, TOMBS]);
    if (!rows.ok) return false;
    const cv = rows.found[key] ? rows.v[key] : null, cd = rows.found[TOMBS] ? rows.v[TOMBS] : null;
    if (v === null && cv === null) return true;   // syncKey:兩邊都沒有
    const md = runMerge(TOMBS, d, cd);
    if (!md || md.ok !== true) return false;
    const mb = runMerge(key, v, cv, md.v);
    if (!mb || mb.ok !== true) return false;
    const tombsOut = md.v !== null && !md.sameAsLocal, banksOut = !mb.sameAsLocal;
    try {
      if (localStorage.getItem(lk) !== raw || localStorage.getItem(dk) !== rawD) return false;
      if (tombsOut) localStorage.setItem(dk, JSON.stringify(md.v));
      if (banksOut) localStorage.setItem(lk, JSON.stringify(mb.v));
    } catch (e) { return false; }
    if (banksOut) notify(key);
    const at = new Date(t).toISOString();
    const send = [];
    if (md.v !== null && !md.sameAsCloud) send.push({ user_id: user.id, k: TOMBS, v: md.v, updated_at: at });
    if (!mb.sameAsCloud) send.push({ user_id: user.id, k: key, v: mb.v, updated_at: at });
    if (send.length) {
      try {
        const { error } = await client.from('progress').upsert(send, { onConflict: 'user_id,k' });
        if (error) throw error;
      } catch (e) {
        console.warn('進度暫時沒同步，已記下，下次連線會補傳：' + key, e);
        return false;
      }
    }
    strike(user, key, t);
    strike(user, TOMBS, readAt);
    return true;
  }

  /* 頁面打開時跟雲端對齊一次(同步合併設計 3.6;單字頁、閱讀頁開頁時呼叫 syncKey('vgame_banks')):
     讀雲端、合併,本機有變就寫回本機(送 cloud:merged),雲端比較舊就上傳;走同一個佇列。等於題庫版的 remoteBehind:
     開了好幾天的 App 一進單字頁就先對齊雲端,之後的編輯不會是根據舊資料。
     回 { ok, changed }。沒登入、這一頁還沒灌過資料、不是合併表上要對帳的鍵、讀不到雲端:ok 是 false,什麼都不改 */
  async function syncKey(key) {
    const fail = { ok: false, changed: false };
    const s = spec(key);
    if (!enabled || !s || !s.reconcile) return fail;
    try { await window.CLOUD.ready; } catch (e) { return fail; }
    const user = window.CLOUD.user;
    if (!user || typeof user.id !== 'string' || reloading || !canUpload(user) || pidOf(user) !== window.__PROFILE_ID) return fail;
    const lk = 'tr_u' + pidOf(user) + '_' + key;
    let before = null;
    try { before = localStorage.getItem(lk); } catch (e) { return fail; }
    const ok = await enqueue(key, () => (s.tombs ? uploadWithTombs(user, key, Date.now(), true) : uploadMerged(user, key, Date.now(), true)));
    let after = before;
    try { after = localStorage.getItem(lk); } catch (e) { after = before; }
    return { ok: ok === true, changed: after !== before };
  }
  /* 灌雲端資料時:本機和雲端都有(雲端那一列 v 不是 null)就存合併結果(save,在雲端蓋本機那一圈之後才寫);
     結果跟雲端不同就記帳、補傳,一樣就從帳本和補傳清單拿掉。本機沒有、或是 null:用雲端那份。
     拿不到合併函式、合併說唯讀、或時鐘差太多(clockOk 是 false):照原本的規則留本機或用雲端,但留本機也不補傳(hold),帳本留著。
     時鐘差太多、本機那份有「只在本機」的標記(marks,帳本上沒有)時也留本機、不補傳(hold):以前用雲端那份蓋掉,
     讀不到雲端時改的名字、目標、餵食就不見了。允許的範圍改成 3 天以後差 3 到 6 天的裝置也會走到這裡(chick2 第三輪修正 #1 的配套)。
     留下來的那份下次對得了時由 pet-store 跟雲端合併上傳 */
  function planMerged(prefix, cloud, keepLocal, led, clockOk, marks) {
    const plan = { save: {}, hold: {} };
    let tombsV = null;   // 合併後的刪除標記(表上 sync_del 排在 vgame_banks 前面),給題庫用
    Object.keys(MERGED).forEach(k => {
      const s = MERGED[k];
      const c = cloud[k];
      const local = readLocal(prefix + k);
      if (!c || c.v === null || c.v === undefined) { if (k === TOMBS && local) tombsV = local; return; }   // 雲端沒有:照舊留本機、補傳
      /* 本機沒有:用雲端那份(下面雲端蓋本機那一圈寫進來)。題庫先套一次刪除標記(舊版頁面整份上傳時可能把刪掉的帶回雲端),
         套完跟雲端不同就存套過的那份、記帳補傳;標記認不得或頁面沒有合併函式就照舊用雲端那份 */
      if (local === null) {
        delete keepLocal[k]; delete led[k];
        if (k === TOMBS) { const t = runMerge(k, null, c.v); tombsV = t && t.ok === true ? t.v : null; }
        const m = s.tombs ? runMerge(k, null, c.v, tombsV) : null;
        if (m && m.ok === true && !m.sameAsCloud) { plan.save[k] = m.v; keepLocal[k] = led[k] = Date.now(); }
        return;
      }
      const fn = local === undefined || (s.clock && !clockOk) ? null : mergeFn(k);
      const m = fn ? runMerge(k, local, c.v, tombsV) : null;
      if (k === TOMBS) tombsV = m && m.ok === true ? m.v : null;   // 標記認不得:題庫照聯集合併(只會多)
      if (!m || m.ok !== true) {
        if (s.clock && !(k in keepLocal) && !clockOk && local !== undefined && marks && Object.prototype.hasOwnProperty.call(marks, k)) keepLocal[k] = Date.now();
        if (k in keepLocal) plan.hold[k] = true;
        return;
      }
      plan.save[k] = m.v;
      if (m.sameAsCloud) { delete keepLocal[k]; delete led[k]; return; }
      keepLocal[k] = led[k] || Date.now();
      led[k] = keepLocal[k];
    });
    return plan;
  }

  /* 把帳本上全部補傳。回傳還剩幾筆沒傳成功。 */
  async function flushAll() {
    const user = window.CLOUD.user;
    if (!user) return 0;
    if (canUpload(user)) {   // 傳不了就只回報帳本上還有幾筆(登出時要先問)
      Object.keys(pending).forEach(k => { clearTimeout(pending[k]); delete pending[k]; });
      const led = readLedger(user.id);
      await Promise.all(Object.keys(led).map(k => upload(user, k, led[k])));
    }
    return Object.keys(readLedger(user.id)).length;
  }

  /* 可以直接上傳:雲端元件在、有登入,而且這個分頁已經灌過雲端資料(新舊比對過)、現在沒有在灌 */
  function canUpload(user) {
    return !!(client && user && !hydrating && sessionStorage.getItem('tr_cloud_hydrated_' + user.id));
  }

  function push(key, val) {
    const t = Date.now();
    if (!settled) { early[key] = t; return; }
    if (reloading) return;   // 剛灌完雲端資料、頁面要重載:這時的寫入根據的是舊畫面,不記帳
    const user = window.CLOUD.user;
    if (!user) return;
    const led = readLedger(user.id);
    led[key] = t;
    writeSeq++;
    writeLedger(user.id, led);   // 先記帳:就算 0.8 秒內關頁,下次開站也會補傳
    if (!canUpload(user)) return;   // 離線維持登入的頁面:記了帳就好,下次灌資料時比新舊再補傳
    clearTimeout(pending[key]);
    pending[key] = setTimeout(() => { delete pending[key]; upload(user, key, t); }, 800);
  }

  /* 確認登入之前的寫入記進目前帳號的帳本 */
  function keepEarly() {
    const u = window.CLOUD.user;
    const uid = u && pidOf(u) === window.__PROFILE_ID ? u.id : storedUid();
    const keys = Object.keys(early);
    if (!uid || !keys.length) return;
    const led = readLedger(uid);
    keys.forEach(k => { if (!(led[k] >= early[k])) led[k] = early[k]; });
    writeLedger(uid, led);
  }

  /* 關頁、切到背景、恢復連線時補傳。還沒確認完登入就要離開:只有確定沒網路(這一頁不會灌資料)才先記帳;
     有網路時照舊以雲端為準(之後若同一頁真的灌了資料,灌資料前會把這些作廢) */
  function onLeave() {
    if (!settled && !hydrating && window.navigator && navigator.onLine === false) keepEarly();
    flushAll();
  }
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('online', () => { flushAll(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onLeave();
  });
})();
