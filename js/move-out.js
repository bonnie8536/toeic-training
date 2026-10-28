/* 衝衝英文搬家:舊網址每一頁的提示與帶走(搬家計畫 2.11、3.4、3.5、7.0)。js/app-shell.js 只在舊網址(MOVE.onOld)載入它,
   前面要先載 js/move-config.js、js/move-rules.js。不依賴 js/common.js(terms.html 沒載入它)。
   - 記號:這台有要搬的資料、還沒搬,就寫不含資料的 cookie tr_hd=1 與 Cache Storage 的空快取 ss-move-flag
     (Worker 與 service worker 看得到,localStorage 它們讀不到);搬好了寫 tr_moved=1、刪掉 ss-move-flag;沒有資料就把兩個記號都拿掉。
     這一段跟新網址通不通無關,預備版(搬家計畫 7.0)上線就開始寫。
   - 帶走之前一定先確認新網址通(抓 MOVE.to/move-ping.txt,3 秒內沒成功就什麼都不做,網站照常用):
     切換前與退回期間不會把人帶到打不開的地方。
   - 網址帶登入回來的東西(查詢字串的 code、access_token、error,或 # 後面的 access_token、error、type=)什麼都不做,讓登入跑完。
   - 搬過了(tr_move_done):每一頁都帶到新網址同一路徑,只留 move-out.html 可以再搬,免得兩邊都寫、資料分岔。
     但搬完之後這台又有新的進度(指紋 MOVE_RULES.fingerprint 跟 tr_move_done.fp 不一樣,而且還有要搬的):當成還沒搬,提示「再搬一次」、
     記號改回 tr_hd,不帶走(新網址連不上時練習的、退回期間練習的、舊的 App 離線用的,都不會被默默留在這裡)。
   - 搬過了、新網址連不上:頁面頂端說這裡練習的進度不會自動過去,連得上之後會提醒再搬一次。
   - 離開這一頁(pagehide、切到背景)時重算一次記號:在這一頁練習的,下一次 Worker 就知道這台又有要搬的。
   - 沒資料也沒登入:頁面頂端先說「拍謝！我們換網址了…正在幫你導過去」,約 1.8 秒後帶到新網址同一路徑,帶之前刪掉自己 ss- 開頭的快取、註銷 service worker(這台不需要它接轉址)。
   - 有資料還沒搬:先試自動搬家(tryAuto;站長 10/28:「為甚麼你不能自動把進度全部搬過去」):組好跟「複製搬家碼」同一包(buildPack,
     登入著先 flushForMove 跟雲端對帳),整個網址不超過 MOVE_LINK.AUTO_MAX 就顯示「…正在把你的進度帶過去…」,
     帶到新網址 move-in.html#auto=<搬家碼>&back=<原路徑>。新網址合併好帶回 move-out.html#ack=<雜湊>,js/move-out-page.js 用 ackCheck
     核對「送出的那包」與「這台現在的包」一樣才寫 tr_move_done,再帶到新網址的原路徑。
     不自動(照舊顯示下面的按鈕):搬家碼太大、組包失敗、付款結果頁、LINE/Facebook/Instagram 內建瀏覽器、主畫面或安裝的 App、
     登入著卻沒有 cloud.js 可以對帳、按過「等一下再搬」、這個分頁已經試過(sessionStorage 的 tr_move_auto;寫不進去就不試,免得每一頁重來)。
   - 有資料還沒搬、不自動:頁面頂端一條提示,「帶我過去（進度一起搬）」「等一下再搬」;價格、註冊、付款結果頁改成先問要不要先搬。
   - 登入著、沒有要搬的:提示到新網址重新登入一次;按下去先補傳(CLOUD.flushForMove),剩 0 項才走,有剩就去搬家頁。
   這支只讀 localStorage,除了上面兩個記號、自動搬家組包時的裝置編號(tr_move_device,寄出頁本來就會寫)以外不寫任何東西,
   一筆資料都不刪不改。畫面只用 textContent。 */
(function (root) {
  'use strict';
  const AUTH_QS = /[?&](code|error|error_code|error_description|access_token|refresh_token|token_hash)=/;
  const AUTH_HASH = /(^#|&)(access_token|refresh_token|error|error_code|error_description|type)=/;
  const ASK_PAGES = ['signup.html', 'pricing.html', 'pay-result.html'];
  const FLAG = 'ss-move-flag';
  const COOKIE_AGE = 34560000;
  const PING_MS = 3000;

  function pageOf(pathname) {
    let p = String(pathname || '').split('/').pop() || 'index.html';
    if (p.indexOf('.') < 0) p += '.html';
    return p;
  }
  function loggedIn(ls) {
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && /^sb-[a-z0-9]+-auth-token$/.test(k)) return true; }
    return false;
  }
  /* 純判斷,測試直接呼叫。回 'stay'(什麼都不做)、'go'(帶到新網址)、'bar'(提示搬家)、'ask'(先問要不要先搬)、'login'(提示重新登入)、
     'offline'(搬過了但新網址連不上)。o.done:有 tr_move_done;o.moved:有 tr_move_done 而且之後沒有新的進度 */
  function decide(o) {
    if (AUTH_QS.test(o.search || '') || AUTH_HASH.test(o.hash || '')) return 'stay';
    if (o.page === 'move-out.html' || o.page === 'move-in.html') return 'stay';
    if (!o.pingOk) return o.done ? 'offline' : 'stay';
    if (o.moved) return 'go';
    if (!o.hasData && !o.loggedIn) return 'go';
    if (o.hasData) return ASK_PAGES.indexOf(o.page) > -1 ? 'ask' : 'bar';
    return 'login';
  }
  /* done:搬過(有 tr_move_done);stale:搬過之後又有新的進度(有要搬的,而且指紋跟搬的時候不一樣;沒存指紋的舊紀錄不算);moved = done 而且不是 stale */
  function stateOf(ls) {
    let done = null, has = false, li = false, stale = false;
    try {
      const raw = ls.getItem('tr_move_done');
      if (raw !== null) { try { done = JSON.parse(raw); } catch (e) { done = {}; } if (!done || typeof done !== 'object') done = {}; }
      has = root.MOVE_RULES.hasData(ls); li = loggedIn(ls);
      if (done && has && typeof done.fp === 'string') stale = root.MOVE_RULES.fingerprint(ls) !== done.fp;
    } catch (e) { /* 讀不到就當沒有 */ }
    return { done: !!done, moved: !!done && !stale, stale, hasData: has, loggedIn: li };
  }

  /* ---------- 記號 ---------- */
  function cookie(name, on) {
    const secure = root.location.protocol === 'https:' ? '; Secure' : '';
    try { root.document.cookie = name + '=' + (on ? '1; Max-Age=' + COOKIE_AGE : '; Max-Age=0') + '; Path=/' + secure + '; SameSite=Lax'; } catch (e) { /* 擋 cookie 的瀏覽器:Worker 看不到記號,靠 service worker 與新網址的提示 */ }
  }
  function flags(st) {
    const C = root.caches;
    if (st.moved) { cookie('tr_moved', true); cookie('tr_hd', false); if (C) C.delete(FLAG).catch(() => {}); return; }
    cookie('tr_moved', false);   // 這台沒有搬好的紀錄(tr_move_done):舊的 tr_moved 不能讓 Worker 把有資料的人直接 301 走
    if (st.hasData) { cookie('tr_hd', true); if (C) C.open(FLAG).catch(() => {}); return; }
    cookie('tr_hd', false);
    if (C) C.delete(FLAG).catch(() => {});
  }

  /* ---------- 新網址通不通 ---------- */
  function ping(ms) {
    const M = root.MOVE;
    const ctl = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    const timer = root.setTimeout(() => { if (ctl) ctl.abort(); }, ms || PING_MS);
    return root.fetch(M.to + '/move-ping.txt?t=' + Date.now(), { mode: 'cors', cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => /rushup-move-ping/.test(t), () => false)
      .then((ok) => { root.clearTimeout(timer); return ok; });
  }

  /* ---------- 帶走 ---------- */
  function target() {
    const l = root.location;
    return root.MOVE.to + l.pathname + l.search + l.hash;
  }
  /* 這台不需要舊網址的 service worker 了(沒資料或搬過了):刪掉自己的快取、註銷,再走 */
  function cleanup() {
    const jobs = [];
    try {
      if (root.caches) jobs.push(root.caches.keys().then((ns) => Promise.all(ns.filter((n) => /^ss-/.test(n)).map((n) => root.caches.delete(n)))));
      const sw = root.navigator && root.navigator.serviceWorker;
      if (sw && sw.getRegistrations) jobs.push(sw.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))));
    } catch (e) { /* 清不掉也照樣走 */ }
    return Promise.race([Promise.all(jobs).catch(() => {}), new Promise((r) => root.setTimeout(r, 1500))]);
  }
  function go(clean) {
    const to = target();
    return (clean ? cleanup() : Promise.resolve()).then(() => root.location.replace(to));
  }

  /* ---------- 畫面 ---------- */
  function el(tag, attrs, text) {
    const n = root.document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    if (text) n.textContent = text;
    return n;
  }
  function bar(text, buttons) {
    const d = root.document;
    if (d.getElementById('move-bar')) return null;
    const box = el('div', { id: 'move-bar', role: 'region', 'aria-label': '搬家提示',
      style: 'background:var(--tint-orange,#fff0e1);border-bottom:1px solid var(--line,#e3e8ed);padding:10px 16px;font-size:15px;line-height:1.6;position:relative;z-index:50' });
    const inner = el('div', { style: 'max-width:960px;margin:0 auto;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center' });
    inner.appendChild(el('span', { style: 'flex:1 1 260px' }, text));
    buttons.forEach((b) => {
      const btn = el(b.href ? 'a' : 'button', Object.assign({ class: 'btn' + (b.primary ? ' primary' : ''), style: 'white-space:nowrap' }, b.href ? { href: b.href } : { type: 'button' }), b.label);
      if (b.onClick) btn.addEventListener('click', b.onClick);
      inner.appendChild(btn);
    });
    box.appendChild(inner);
    d.body.insertBefore(box, d.body.firstChild);
    return box;
  }
  function later() { try { return root.sessionStorage.getItem('tr_move_later') === '1'; } catch (e) { return false; } }
  function setLater() { try { root.sessionStorage.setItem('tr_move_later', '1'); } catch (e) { /* 只是下一頁還會出現 */ } }
  const RENAMED = '拍謝！我們換網址了，因為名字跟別人重疊！新網址是 ';
  const GO_DELAY_MS = 1800;   // 沒有要搬的:先讓人看到上面那句,再帶過去
  function close() { setLater(); const x = root.document.getElementById('move-bar'); if (x) x.remove(); }
  function show(kind, st) {
    const M = root.MOVE;
    const again = !!(st && st.done);
    if (kind === 'bar') {
      if (later()) return;
      if (again) {
        return bar(RENAMED + M.newName + '。這台在上次搬家之後又有新的練習進度，要再搬一次，按下面的按鈕我幫你帶過去。', [
          { label: '再搬一次', primary: true, href: 'move-out.html' },
          { label: '等一下再搬', onClick: close },
        ]);
      }
      return bar(RENAMED + M.newName + '。這台的練習進度，按下面的按鈕，我幫你一起帶過去。', [
        { label: '帶我過去（進度一起搬）', primary: true, href: 'move-out.html' },
        { label: '等一下再搬', onClick: close },
      ]);
    }
    if (kind === 'go') {
      return bar(RENAMED + M.newName + '。正在幫你導過去…', [
        { label: '馬上過去', primary: true, onClick: () => go(!(st && st.hasData) || !!(st && st.moved)) },
      ]);
    }
    if (kind === 'offline') {
      if (later()) return;
      return bar('這台的進度已經搬到新網址 ' + M.newName + '，但現在連不上新網址。在這裡練習的進度不會自動過去，新網址連得上之後，這裡會提醒你再搬一次。', [
        { label: '知道了', onClick: close },
      ]);
    }
    if (kind === 'ask') {
      return bar(RENAMED + M.newName + '，舊網址不再註冊與付款。這台有' + (again ? '上次搬家之後的新' : '練習') + '進度，我幫你一起帶過去。', [
        { label: '帶我過去（進度一起搬）', primary: true, href: 'move-out.html' },
        { label: '不用，直接去新網址', onClick: () => go(false) },
      ]);
    }
    if (kind === 'login') {
      return bar(RENAMED + M.newName + '。我幫你導過去，到新網址登入同一個帳號，進度會從雲端回來。', [
        { label: '前往新網址', primary: true, onClick: (e) => leaveLoggedIn(e.currentTarget) },
      ]);
    }
    return null;
  }
  /* 登入著:先補傳,剩 0 項才走;有剩(沒網路、雲端比較新)就去搬家頁 */
  function leaveLoggedIn(btn) {
    const C = root.CLOUD;
    if (btn) { btn.disabled = true; btn.textContent = '正在確認進度…'; }
    const run = C && typeof C.flushForMove === 'function' ? C.flushForMove() : Promise.resolve({ left: 0 });
    return run.then((r) => (r && r.left > 0 ? root.location.assign('move-out.html') : go(true)), () => root.location.assign('move-out.html'));
  }

  /* ---------- 自動搬家(有資料、還沒搬;不用按按鈕) ---------- */
  const AUTO_SCRIPTS = [['MOVE_MERGE', 'js/move-merge.js'], ['MOVE_PACK', 'js/move-pack.js'], ['MOVE_LINK', 'js/move-link.js']];
  const CLOUD_WAIT_MS = 8000;
  const AUTO_TEXT = '拍謝！我們換網址了，因為名字跟別人重疊！正在把你的進度帶過去…';
  let autoRun = Promise.resolve('none');

  function whenBody(fn) {
    const d = root.document;
    if (!d) return;
    if (d.body) fn(); else d.addEventListener('DOMContentLoaded', fn);
  }
  /* 特殊環境:LINE、Facebook、Instagram 內建瀏覽器(資料存在那個 App 裡,寄出頁會教用搬家碼帶到以後要用的瀏覽器);
     主畫面或安裝的 App(iPhone 主畫面 App 的資料跟 Safari 分開存,帶出去會開在別的地方;Android、電腦的 App 帶出去會變成 App 裡的外部網頁,
     寄出頁另外說明要重新安裝)。這兩種都照舊用按鈕。 */
  function envOf(nav, mm) {
    const n = nav || {}, ua = String(n.userAgent || '');
    let sa = n.standalone === true;
    try { sa = sa || !!(mm && mm('(display-mode: standalone)').matches); } catch (e) { /* 當成不是 */ }
    return { inApp: ua.indexOf('Line/') > -1 || /FBAN|FBAV|Instagram/.test(ua), standalone: sa };
  }
  /* 純判斷,測試直接呼叫。回 '' 表示可以自動,其他是不自動的原因。
     付款結果頁不自動:那一頁要讓人看到付款的結果(舊網址已經不收款,只會是很久以前的連結)。
     登入著卻不能對帳(這一頁沒有 cloud.js):帳號的進度可能只有一部分在這台,交給寄出頁(會先 flushForMove)。 */
  function autoBlock(o) {
    if (o.kind !== 'bar' && o.kind !== 'ask') return 'kind';
    if (o.page === 'pay-result.html') return 'page';
    if (o.inApp) return 'inApp';
    if (o.standalone) return 'app';
    if (o.tried) return 'tried';
    if (o.later) return 'later';
    if (o.loggedIn && !o.canFlush) return 'noFlush';
    return '';
  }
  /* 這個分頁試過自動搬家的紀錄(sessionStorage 的 tr_move_auto,只有這個分頁、這個網域看得到,關掉分頁就沒了):
     { step: 'build' | 'sent' | 'big' | 'skip' | 'error', hash(送出的包), local(這台當時的包,不含 flushForMove 給的帳號), fp(指紋), at }。
     有紀錄就不再自動(失敗不會一直重來;換一個分頁會再試一次)。讀不懂也算有。 */
  function memo() {
    let s = null;
    try { s = root.sessionStorage; } catch (e) { s = null; }
    return {
      get() {
        if (!s) return null;
        try { const r = s.getItem('tr_move_auto'); if (r === null) return null; const v = JSON.parse(r); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
      },
      set(o) {
        if (!s) return false;
        try { const v = JSON.stringify(o); s.setItem('tr_move_auto', v); return s.getItem('tr_move_auto') === v; } catch (e) { return false; }
      },
    };
  }
  /* 組包要的程式(一般頁面沒有載):照順序補載 */
  function need() {
    return AUTO_SCRIPTS.reduce((p, [g, src]) => p.then(() => (root[g] ? null : new Promise((res, rej) => {
      const d = root.document, s = d.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('載不到 ' + src));
      (d.head || d.body).appendChild(s);
    }))), Promise.resolve());
  }
  /* 登入著:先跟雲端對帳(CLOUD.flushForMove),回 { accounts(這個帳號還沒上傳的), uid };沒登入、沒有 cloud.js、對帳失敗回 {}(組包時改用這台的帳本) */
  async function flushAccounts() {
    const C = root.CLOUD;
    if (!C) return {};
    if (C.enabled && C.ready) await Promise.race([Promise.resolve(C.ready).catch(() => {}), new Promise((r) => root.setTimeout(r, CLOUD_WAIT_MS))]);
    if (!C.user || typeof C.flushForMove !== 'function') return {};
    const uid = typeof C.user.id === 'string' ? C.user.id : undefined;
    try { return { accounts: (await C.flushForMove()).accounts, uid }; } catch (e) { return {}; }
  }
  /* 組一包:寄出頁的「準備搬家」(搬家碼、搬家檔、視窗)與每一頁的自動搬家共用這一個。o:{ from, accounts, uid }
     回 { pack, summary, hash, fp(組包那一刻的指紋), local(不含 accounts 的那包的雜湊,ack 回來時跟這台現在的比) } */
  async function buildPack(ls, o) {
    const P = root.MOVE_PACK;
    const opt = o || {};
    const from = opt.from || root.location.origin;
    const device = P.deviceId(ls, root.crypto);
    let fp = null;
    try { fp = root.MOVE_RULES.fingerprint(ls); } catch (e) { fp = null; }
    const { pack, summary } = P.collect(ls, { from, accounts: opt.accounts, uid: opt.uid, device });
    const hash = await P.hashOf(pack);
    const local = opt.accounts ? await P.hashOf(P.collect(ls, { from, device }).pack) : hash;
    return { pack, summary, hash, fp, local };
  }
  /* 新網址搬好、帶回舊網址(move-out.html#ack=<雜湊>):這個分頁送出的就是這包,而且送出之後這台沒有新的進度(指紋、不含帳號的包都一樣)才算數。
     回 { ok, fp(送出那一刻的指紋,寫進 tr_move_done) } 或 { ok: false, why } */
  async function ackCheck(ls, hash) {
    const m = memo().get();
    if (!m || m.step !== 'sent' || typeof hash !== 'string' || m.hash !== hash || typeof m.local !== 'string') return { ok: false, why: 'memo' };
    let fp = null;
    try { fp = root.MOVE_RULES.fingerprint(ls); } catch (e) { fp = null; }
    if (fp === null || fp !== m.fp) return { ok: false, why: 'changed' };
    const P = root.MOVE_PACK;
    let device = null;
    try { device = ls.getItem('tr_move_device'); } catch (e) { device = null; }
    const { pack } = P.collect(ls, { from: root.location.origin, device: typeof device === 'string' ? device : undefined });
    if ((await P.hashOf(pack)) !== m.local) return { ok: false, why: 'changed' };
    return { ok: true, fp: m.fp };
  }
  /* 回 'auto'(已經帶走)或不自動的原因;不是 'auto' 時頂端的「正在帶過去」會拿掉,由 start 畫回按鈕 */
  async function tryAuto(kind, st) {
    const M = root.MOVE, l = root.location, C = root.CLOUD;
    const env = envOf(root.navigator, typeof root.matchMedia === 'function' ? (q) => root.matchMedia(q) : null);
    const mem = memo();
    const why = autoBlock({ kind, page: pageOf(l.pathname), inApp: env.inApp, standalone: env.standalone, tried: mem.get() !== null, later: later(),
      loggedIn: st.loggedIn, canFlush: !!(C && typeof C.flushForMove === 'function') });
    if (why) return why;
    if (!mem.set({ step: 'build', at: Date.now() })) return 'session';
    let live = true, box = null, shown = 0;
    whenBody(() => { if (live) { box = bar(AUTO_TEXT, []); shown = Date.now(); } });
    const stop = (step) => { live = false; if (box) box.remove(); mem.set({ step, at: Date.now() }); return step; };
    try {
      await need();
      const acc = st.loggedIn ? await flushAccounts() : {};
      const b = await buildPack(root.localStorage, { from: l.origin, accounts: acc.accounts, uid: acc.uid });
      if (b.summary.tooBig.length || !b.summary.hasData) return stop('skip');
      const url = root.MOVE_LINK.autoUrl(M.to, await root.MOVE_PACK.toCode(b.pack, b.hash), l.pathname + l.search);
      if (url.length > root.MOVE_LINK.AUTO_MAX) return stop('big');
      if (!mem.set({ step: 'sent', hash: b.hash, local: b.local, fp: b.fp, at: Date.now() })) return stop('error');
      await new Promise((r) => root.setTimeout(r, Math.max(0, GO_DELAY_MS - (shown ? Date.now() - shown : 0))));
      l.replace(url);
      return 'auto';
    } catch (e) {
      return stop('error');
    }
  }

  function start() {
    const M = root.MOVE;
    if (!M || !M.onOld || !root.MOVE_RULES) return Promise.resolve('stay');
    let ls;
    try { ls = root.localStorage; } catch (e) { return Promise.resolve('stay'); }
    const st = stateOf(ls);
    flags(st);
    /* 離開這一頁時重算記號:在這一頁練習的,下一次 Worker(轉址期)就知道這台又有要搬的,不會直接 301 走 */
    const refresh = () => { try { flags(stateOf(ls)); } catch (e) { /* 下一頁再寫 */ } };
    try {
      if (typeof root.addEventListener === 'function') root.addEventListener('pagehide', refresh);
      if (root.document && typeof root.document.addEventListener === 'function') root.document.addEventListener('visibilitychange', () => { if (root.document.visibilityState === 'hidden') refresh(); });
    } catch (e) { /* 沒有就算了 */ }
    const l = root.location;
    const base = { search: l.search, hash: l.hash, page: pageOf(l.pathname), done: st.done, moved: st.moved, hasData: st.hasData, loggedIn: st.loggedIn };
    if (decide(Object.assign({ pingOk: true }, base)) === 'stay') return Promise.resolve('stay');
    return ping().then((ok) => {
      const kind = decide(Object.assign({ pingOk: ok }, base));
      if (kind === 'go') {
        /* 先讓人看到換網址的那句話,再帶過去;畫不出來(沒有 body)就直接帶 */
        const leave = () => go(!st.hasData || st.moved);
        root.setTimeout(leave, GO_DELAY_MS);   // 計時器一定開,提示畫不出來也照樣帶走
        try {
          const draw = () => { try { show('go', st); } catch (e) { /* 只是少了那句話 */ } };
          if (root.document && root.document.body) draw(); else if (root.document) root.document.addEventListener('DOMContentLoaded', draw);
        } catch (e) { /* 照樣會帶走 */ }
      } else if (kind === 'bar' || kind === 'ask') {
        /* 先試自動搬家;不自動(或沒成功)就照舊畫按鈕 */
        autoRun = tryAuto(kind, st).catch(() => 'error').then((r) => { if (r !== 'auto') whenBody(() => show(kind, st)); return r; });
      } else if (kind !== 'stay') {
        whenBody(() => show(kind, st));
      }
      return kind;
    });
  }

  root.MOVE_OUT = Object.freeze({ decide, pageOf, stateOf, flags, ping, start, cleanup, go, target,
    envOf, autoBlock, buildPack, flushAccounts, ackCheck, tryAuto, autoRun: () => autoRun });
  if (root.MOVE && root.MOVE.onOld && !root.MOVE_OUT_NO_AUTO) start();
})(typeof window !== 'undefined' ? window : globalThis);
