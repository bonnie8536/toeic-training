/* 雲端同步層(Supabase)。
   - CLOUD_CONFIG 未填 → CLOUD.enabled=false,全站維持本機模式。
   - 已填 → 載入 supabase-js(CDN),提供 login/logout/push;登入後把雲端進度灌回
     localStorage(沿用既有命名空間機制),各模組程式完全不用改。
   - 同步策略:每次 store.set 後 0.8 秒內去抖動上傳該鍵;每個分頁工作階段登入時整批下載一次。 */
(function () {
  const cfg = window.CLOUD_CONFIG || {};
  const enabled = !!(cfg.url && cfg.anonKey);
  window.CLOUD = { enabled, ready: Promise.resolve(null), user: null, isTeacher: false, client: null, login, logout, push };
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
      const { data: rows, error } = await client.from('progress').select('k,v').eq('user_id', user.id);
      if (error) throw error;
      const prefix = 'tr_u' + pid + '_';
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) localStorage.removeItem(k);
      }
      (rows || []).forEach(r => {
        if (r.k !== '_meta' && r.v !== null) localStorage.setItem(prefix + r.k, JSON.stringify(r.v));
      });
      sessionStorage.setItem(flagKey, '1');
      try {
        await client.from('progress').upsert({
          user_id: user.id, k: '_meta',
          v: { email: user.email, name: (user.email || '').split('@')[0], last_login: new Date().toISOString() },
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
      if (/Invalid login credentials/i.test(error.message)) throw new Error('帳號或密碼不對');
      if (/Email not confirmed/i.test(error.message)) throw new Error('帳號尚未啟用(請老師到 Supabase 後台關閉 Confirm email)');
      if (/fetch|network/i.test(error.message)) throw new Error('連不上雲端伺服器:請檢查網路;若持續發生,請老師確認 Supabase 專案沒有休眠');
      throw new Error(error.message);
    }
    window.CLOUD.user = data.user;
    await afterAuth(data.user, true);
  }

  async function logout() {
    const user = window.CLOUD.user;
    try { await client.auth.signOut(); } catch (e) {}
    if (user) {
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

  function push(key, val) {
    if (!client || !window.CLOUD.user) return;
    clearTimeout(pending[key]);
    pending[key] = setTimeout(async () => {
      try {
        await client.from('progress').upsert({
          user_id: window.CLOUD.user.id, k: key, v: val, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,k' });
      } catch (e) { console.warn('進度同步失敗(之後的變更會再觸發):' + key, e); }
    }, 800);
  }
})();
