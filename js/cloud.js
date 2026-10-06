/* 雲端同步層(Supabase)。
   - CLOUD_CONFIG 未填 → CLOUD.enabled=false,全站維持本機模式。
   - 已填 → 載入 supabase-js(CDN),提供 login/logout/push;登入後把雲端進度灌回
     localStorage(沿用既有命名空間機制),各模組程式完全不用改。
   - 同步策略:每次 store.set 後 0.8 秒內去抖動上傳該鍵;每個分頁工作階段登入時整批下載一次。 */
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

  window.CLOUD = { enabled, ready: Promise.resolve(null), user: null, isTeacher: false, sessionExpired: false, client: null, authError: authError ? friendly({ message: authError }) : '', login, logout, push, signUp, signInWithGoogle, resetPassword, updatePassword, resendConfirm, deleteAccount, updateName, nameOf };
  if (!enabled) return;

  /* 登入失效改回訪客(leaveStaleAccount)時記一個旗標,重載後的那一頁讀到就清掉:
     頂欄只在這個分頁顯示一次「登入已失效」,換頁或下一個人開新分頁都不會再出現 */
  const EXPIRED_KEY = 'tr_auth_expired';
  try {
    window.CLOUD.sessionExpired = sessionStorage.getItem(EXPIRED_KEY) === '1';
    sessionStorage.removeItem(EXPIRED_KEY);
  } catch (e) { window.CLOUD.sessionExpired = false; }

  let client = null;
  const pending = {};
  /* supabase-js 把登入資料存在 localStorage 的這個位置(預設名稱:sb-<專案代號>-auth-token) */
  const SB_KEY = 'sb-' + ((/^https?:\/\/([^./]+)\./.exec(cfg.url) || [])[1] || '') + '-auth-token';
  /* 開站確認登入狀態(有網路約 1 秒;離線又遇到登入憑證過期,supabase-js 會重試約 25 秒)之前的寫入先放 early,
     確認完再決定:這一頁剛灌完雲端資料要重載 → 作廢(那些寫入根據的是舊資料,以雲端為準);其他情況 → 記進帳本。 */
  let settled = false;
  let hydrating = false;   // 這一頁決定要灌雲端資料了(之後要重載)
  let reloading = false;
  const early = {};

  window.CLOUD.ready = init();

  function loadSdk() {
    return new Promise((res, rej) => {
      if (window.supabase && window.supabase.createClient) return res();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = res;
      s.onerror = () => rej(new Error('無法載入雲端元件,請檢查網路後重新整理'));
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
      if (!session) { adoptStored(); leaveStaleAccount(); return window.CLOUD.user; }
      window.CLOUD.user = session.user;
      await afterAuth(session.user, false);
      return session.user;
    } catch (e) {
      console.warn('雲端初始化失敗:', e);
      adoptStored();
      leaveStaleAccount();
      return window.CLOUD.user;
    } finally {
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
    try {
      const { data } = await client.from('teachers').select('user_id').eq('user_id', user.id);
      window.CLOUD.isTeacher = !!(data && data.length);
    } catch (e) { /* 非教師 */ }

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
      writeLedger(user.id, led);

      for (let i = localStorage.length - 1; i >= 0; i--) {
        const lk = localStorage.key(i);
        if (lk && lk.startsWith(prefix) && !(lk.slice(prefix.length) in keepLocal)) localStorage.removeItem(lk);
      }
      (rows || []).forEach(r => {
        if (r.k !== '_meta' && r.v !== null && !(r.k in keepLocal)) localStorage.setItem(prefix + r.k, JSON.stringify(r.v));
      });
      /* 留下來的本機改動補傳上去;失敗也沒關係,帳本還在,下次再傳 */
      await Promise.all(Object.keys(keepLocal).map(k => upload(user, k, keepLocal[k])));
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
    if (!client) throw new Error('雲端元件尚未載入,請重新整理再試');
    const { data, error } = await client.auth.signInWithPassword({ email: String(email).trim(), password });
    if (error) {
      if (/Invalid login credentials/i.test(error.message)) throw new Error('帳號或密碼不對。當初用 Google 註冊的話,要按上面的 Google 登入。');
      if (/Email not confirmed/i.test(error.message)) throw new Error('信箱還沒驗證:請到信箱點驗證連結(找不到信可以到「註冊」分頁重寄)');
      if (/rate limit|too many/i.test(error.message)) throw new Error('請求太頻繁,請幾分鐘後再試');
      if (/fetch|network/i.test(error.message)) throw new Error('連不上雲端伺服器:請檢查網路;若持續發生,請老師確認 Supabase 專案沒有休眠');
      throw new Error(error.message);
    }
    window.CLOUD.user = data.user;
    await afterAuth(data.user, true);
  }

  async function logout(opts) {
    const user = window.CLOUD.user;
    const everywhere = !!(opts && opts.everywhere);
    /* 這台已經沒有登入資料時 supabase-js 不會呼叫伺服器、直接回成功,別台其實沒被登出:先擋下來,什麼都不刪 */
    if (everywhere && !localStorage.getItem(SB_KEY)) throw new Error('這台的登入已失效,沒辦法登出其他裝置。請重新登入後再試一次。');
    if (user && !(opts && opts.discard)) {
      const left = await flushAll();
      if (left > 0 && !confirm('還有 ' + left + ' 項進度還沒同步到雲端(可能是網路不穩)。現在登出,這台裝置上的這些進度會刪除。確定要登出?')) return;
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
        throw new Error('連不上雲端伺服器,沒辦法確認其他裝置已登出。這台維持登入,請確認網路後再試一次。');
      }
    } else {
      try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* 雲端元件沒載到 */ }
    }
    try { [SB_KEY, SB_KEY + '-user', SB_KEY + '-code-verifier'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
    if (user) {
      writeLedger(user.id, {});
      sessionStorage.removeItem('tr_cloud_hydrated_' + user.id);
      const prefix = 'tr_u' + pidOf(user) + '_';
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) localStorage.removeItem(k);   // 共用電腦不留個資
      }
    }
    localStorage.removeItem('tr_current_profile');
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
    if (!client) throw new Error('雲端元件尚未載入,請重新整理再試');
  }

  function friendly(error) {
    const m = error.message || '';
    if (/already registered|already exists|already been registered/i.test(m)) return '這個 Email 已經註冊過,請直接登入;當初用 Google 註冊的話按 Google 登入,忘記密碼可以重設。';
    if (/unsupported provider|provider is not enabled|provider.*disabled/i.test(m)) return 'Google 登入目前不能用,請改用 Email 註冊。';
    if (/redirect|not allowed.*url/i.test(m)) return 'Google 登入的網址設定不對,請改用 Email 註冊。';
    if (/password/i.test(m) && /short|least|characters/i.test(m)) return '密碼至少 8 碼。';
    if (/rate limit|too many|security purposes/i.test(m)) return '請求太頻繁,請幾分鐘後再試。';
    if (/signups? not allowed|signup is disabled|not allowed/i.test(m)) return '目前未開放註冊,請聯絡老師。';
    if (/invalid.*email|email.*invalid/i.test(m)) return 'Email 格式不對。';
    if (/fetch|network/i.test(m)) return '連不上雲端伺服器,請檢查網路後再試。';
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
      throw new Error('這個 Email 已經註冊過,請直接登入;當初用 Google 註冊的話按 Google 登入,忘記密碼可以重設。');
    }
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
    if (error) throw new Error('刪除失敗:' + error.message + '。請寫信給站長要求刪除。');
    await logout({ discard: true });
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

  /* 上傳一個鍵的「目前本機值」。成功且期間沒有更新的改動,才從帳本劃掉。 */
  async function upload(user, key, t) {
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
      console.warn('進度暫時沒同步,已記下,下次連線會補傳:' + key, e);
      return false;
    }
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
