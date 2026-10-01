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

  window.CLOUD = { enabled, ready: Promise.resolve(null), user: null, isTeacher: false, client: null, authError: authError ? friendly({ message: authError }) : '', login, logout, push, signUp, signInWithGoogle, resetPassword, updatePassword, resendConfirm, deleteAccount, updateName, nameOf };
  if (!enabled) return;

  let client = null;
  const pending = {};

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
      await loadSdk();
      client = window.supabase.createClient(cfg.url, cfg.anonKey);
      window.CLOUD.client = client;
      const { data: { session } } = await client.auth.getSession();
      if (!session) return null;
      window.CLOUD.user = session.user;
      await afterAuth(session.user, false);
      flushAll();
      return session.user;
    } catch (e) {
      console.warn('雲端初始化失敗,以未登入狀態顯示:', e);
      return null;
    }
  }

  function pidOf(user) { return 'c' + user.id.replace(/-/g, ''); }

  async function afterAuth(user, fresh) {
    try {
      const { data } = await client.from('teachers').select('user_id').eq('user_id', user.id);
      window.CLOUD.isTeacher = !!(data && data.length);
    } catch (e) { /* 非教師 */ }

    const pid = pidOf(user);
    localStorage.setItem('tr_current_profile', JSON.stringify(pid));

    const flagKey = 'tr_cloud_hydrated_' + user.id;
    if (fresh || !sessionStorage.getItem(flagKey)) {
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
    if (user && !(opts && opts.discard)) {
      const left = await flushAll();
      if (left > 0 && !confirm('還有 ' + left + ' 項進度還沒同步到雲端(可能是網路不穩)。現在登出,這台裝置上的這些進度會刪除。確定要登出?')) return;
    }
    try { await client.auth.signOut(); } catch (e) {}
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
    if (!client || !user) return 0;
    Object.keys(pending).forEach(k => { clearTimeout(pending[k]); delete pending[k]; });
    const led = readLedger(user.id);
    await Promise.all(Object.keys(led).map(k => upload(user, k, led[k])));
    return Object.keys(readLedger(user.id)).length;
  }

  function push(key, val) {
    if (!client || !window.CLOUD.user) return;
    const user = window.CLOUD.user;
    const t = Date.now();
    const led = readLedger(user.id);
    led[key] = t;
    writeLedger(user.id, led);   // 先記帳:就算 0.8 秒內關頁,下次開站也會補傳
    clearTimeout(pending[key]);
    pending[key] = setTimeout(() => { delete pending[key]; upload(user, key, t); }, 800);
  }

  /* 關頁、切到背景、恢復連線時補傳 */
  window.addEventListener('pagehide', () => { flushAll(); });
  window.addEventListener('online', () => { flushAll(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
})();
