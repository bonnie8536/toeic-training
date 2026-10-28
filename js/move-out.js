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
   - 有資料還沒搬:先試自動搬家(站長 10/28:「為甚麼你不能自動把進度全部搬過去」)。四站,搬家碼只以加密過的樣子進網址(js/move-link.js 開頭):
     tryAuto 顯示「…正在把你的進度帶過去…」與「等一下再搬」,2.5 秒後帶到新網址 move-in.html#want(網址裡沒有資料)拿一次性公鑰;
     新網址帶回寄出頁 move-out.html#key=<公鑰>,autoSend 組好跟「複製搬家碼」同一包(buildPack,登入著先 flushForMove 跟雲端對帳)、
     加密,不超過 MOVE_LINK.AUTO_MAX 就帶到 move-in.html#auto=<密文>;新網址合併好帶回 move-out.html#ack=<雜湊>,js/move-out-page.js 用 ackCheck
     核對「送出的那包」與「這台現在的包」一樣才寫 tr_move_done,再帶到新網址的原路徑。
     不自動(照舊顯示下面的按鈕):付款結果頁、主畫面或安裝的 App、按過「等一下再搬」、這個分頁已經試過(sessionStorage 的 tr_move_auto;
     寫不進去就不試,免得每一頁重來)、等的時候使用者在頁面上點了、按了鍵、按下滑鼠或手指碰到螢幕、模擬考進行中。寄出頁那一站太大、組包失敗、
     對帳與組包超過 SEND_MAX_MS(15 秒),就回原頁面顯示按鈕。倒數的提示黏在頁面頂端、蓋在「你是哪位？」建檔視窗上面,「等一下再搬」一定按得到。
     LINE/Facebook/Instagram 內建瀏覽器(資料存在那個 App 裡,跟手機的 Safari、Chrome 分開)一樣自動,搬進同一個 App 裡的新網址。
   - 有資料還沒搬、不自動:頁面頂端一條提示,「帶我過去（進度一起搬）」「等一下再搬」;價格、註冊、付款結果頁改成先問要不要先搬。
     一般瀏覽器的主按鈕去寄出頁(開新視窗送);LINE 等內建瀏覽器開新視窗不可靠,主按鈕一鍵走自動搬家同一條路(startHere),
     這個分頁記下太大(網址裝不下)才去寄出頁用搬家碼。
   - 登入著、沒有要搬的:提示到新網址重新登入一次;按下去先補傳(CLOUD.flushForMove),剩 0 項才走,有剩或 FLUSH_MAX_MS 還沒好就去搬家頁。
   這支只讀 localStorage,除了上面兩個記號、寄出頁組包時的裝置編號(tr_move_device,按鈕搬家本來就會寫)以外不寫任何東西,
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
  /* z-index 300:蓋在「你是哪位？」建檔視窗(.modal-mask 200;有資料、還沒選學生的訪客一打開要選學生的頁面就是它)與頂端列上面,
     提示的按鈕一定按得到。sticky:自動搬家倒數時黏在頁面頂端,捲動過也看得到「等一下再搬」 */
  function bar(text, buttons, sticky) {
    const d = root.document;
    if (d.getElementById('move-bar')) return null;
    const box = el('div', { id: 'move-bar', role: 'region', 'aria-label': '搬家提示',
      style: 'background:var(--tint-orange,#fff0e1);border-bottom:1px solid var(--line,#e3e8ed);padding:10px 16px;font-size:15px;line-height:1.6;'
        + (sticky ? 'position:sticky;top:0' : 'position:relative') + ';z-index:300' });
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
          carry('再搬一次'),
          { label: '等一下再搬', onClick: close },
        ]);
      }
      /* LINE、Facebook、Instagram 內建瀏覽器走到這裡是自動搬家沒有走(這個分頁試過:作答中、出錯、太大)。寄出頁的「送到新網址」要開新視窗,
         在這些 App 裡不可靠;主按鈕改成一鍵在同一個分頁搬(跟自動搬家同一條路)。太大(網址裝不下)才只能用搬家碼,不說「我幫你帶過去」 */
      if (inAppBig()) {
        return bar(RENAMED + M.newName + '。這台的練習進度比較多，要用搬家碼帶過去：按下面的按鈕，照著搬家頁的說明做。', [
          { label: '帶我過去（進度一起搬）', primary: true, href: 'move-out.html' },
          { label: '等一下再搬', onClick: close },
        ]);
      }
      return bar(RENAMED + M.newName + '。這台的練習進度，按下面的按鈕，我幫你一起帶過去。', [
        carry('帶我過去（進度一起搬）'),
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
        carry('帶我過去（進度一起搬）'),
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
  /* LINE、Facebook、Instagram 內建瀏覽器,而且這個分頁的自動搬家記下「太大」(網址裝不下,只能用搬家碼) */
  function inAppBig() {
    if (!envNow().inApp) return false;
    const m = memo().get();
    return !!(m && m.step === 'big');
  }
  /* 提示的主按鈕:一般瀏覽器去寄出頁(準備搬家 → 送到新網址,開新視窗送);LINE 等內建瀏覽器開新視窗不可靠,
     網址裝得下就一鍵在同一個分頁搬(startHere,跟自動搬家同一條路),記不住這個分頁開始了就改去寄出頁 */
  function carry(label) {
    if (!envNow().inApp || inAppBig()) return { label, primary: true, href: 'move-out.html' };
    return { label, primary: true, onClick: () => { const l = root.location; if (!startHere(l.pathname + l.search)) l.assign('move-out.html'); } };
  }
  /* 登入著:先補傳,剩 0 項才走;有剩(沒網路、雲端比較新)或 FLUSH_MAX_MS 還沒好就去搬家頁(不會一直停在「正在確認進度…」;
     晚到的結果不再帶走,搬家頁會重新對帳) */
  function leaveLoggedIn(btn) {
    const C = root.CLOUD;
    if (btn) { btn.disabled = true; btn.textContent = '正在確認進度…'; }
    const run = C && typeof C.flushForMove === 'function' ? Promise.resolve().then(() => C.flushForMove()) : Promise.resolve({ left: 0 });
    const late = {};
    return withTimeout(run, FLUSH_MAX_MS, late)
      .then((r) => (r === late || (r && r.left > 0) ? root.location.assign('move-out.html') : go(true)), () => root.location.assign('move-out.html'));
  }
  /* p 在 ms 之內沒好就回 late(p 之後才好也不管);p 失敗照樣丟錯 */
  function withTimeout(p, ms, late) {
    let tm = null;
    const t = new Promise((res) => { tm = root.setTimeout(() => res(late), ms); });
    return Promise.race([p, t]).finally(() => root.clearTimeout(tm));
  }

  /* ---------- 自動搬家(有資料、還沒搬;不用按按鈕)。四站怎麼走、為什麼搬家碼不以明文進網址,寫在 js/move-link.js ---------- */
  const CLOUD_WAIT_MS = 8000;
  const FLUSH_MAX_MS = 12000;   // 跟雲端對帳(CLOUD.flushForMove)最多等這麼久:寄出頁的「準備搬家」改用這台的帳本(跟對帳失敗一樣)、登入提示改去搬家頁,不會一直掛著
  const AUTO_DELAY_MS = 2500;   // 第一站:提示出現後等這麼久才帶走,讓人有時間按「等一下再搬」
  const SEND_MAX_MS = 15000;    // 寄出頁:對帳、組包、加密的總逾時;逾時就回原頁面顯示按鈕,晚到的結果也不帶走
  const KEY_MAX_MS = 10 * 60000;   // 第一站之後這麼久還沒拿到公鑰回來,就當這個分頁沒有在搬
  const AUTO_TEXT = '拍謝！我們換網址了，因為名字跟別人重疊！正在把你的進度帶過去…';
  let autoRun = Promise.resolve('none');

  function whenBody(fn) {
    const d = root.document;
    if (!d) return;
    if (d.body) fn(); else d.addEventListener('DOMContentLoaded', fn);
  }
  /* 特殊環境:LINE、Facebook、Instagram 內建瀏覽器(資料存在那個 App 裡;自動搬家在同一個分頁換頁,照樣能搬,搬到同一個 App 的新網址,
     以後從 LINE 點新網址也是開在這裡);主畫面或安裝的 App(iPhone 主畫面 App 的資料跟 Safari 分開存,換到新網址會變成 App 裡的外部網頁,
     寄出頁另外說明要重新安裝)照舊用按鈕。 */
  function envOf(nav, mm) {
    const n = nav || {}, ua = String(n.userAgent || '');
    let sa = n.standalone === true;
    try { sa = sa || !!(mm && mm('(display-mode: standalone)').matches); } catch (e) { /* 當成不是 */ }
    return { inApp: ua.indexOf('Line/') > -1 || /FBAN|FBAV|Instagram/.test(ua), standalone: sa };
  }
  function envNow() { return envOf(root.navigator, typeof root.matchMedia === 'function' ? (q) => root.matchMedia(q) : null); }
  /* 純判斷,測試直接呼叫。回 '' 表示可以自動,其他是不自動的原因。
     付款結果頁不自動:那一頁要讓人看到付款的結果(舊網址已經不收款,只會是很久以前的連結)。
     登入著也可以:對帳(CLOUD.flushForMove)在寄出頁做,寄出頁一定載 cloud.js。 */
  function autoBlock(o) {
    if (o.kind !== 'bar' && o.kind !== 'ask') return 'kind';
    if (o.page === 'pay-result.html') return 'page';
    if (o.standalone) return 'app';
    if (o.tried) return 'tried';
    if (o.later) return 'later';
    return '';
  }
  /* 這個分頁試過自動搬家的紀錄(sessionStorage 的 tr_move_auto,只有這個分頁、這個網域看得到,關掉分頁就沒了):
     { step: 'key'(第一站送出,等公鑰)| 'build' | 'sent' | 'big' | 'skip' | 'busy' | 'later' | 'timeout' | 'error', hash(送出的包),
       local(這台當時的包,不含 flushForMove 給的帳號), fp(指紋), at }。
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
  /* 「等一下再搬」:這個分頁不再提示、不再自動 */
  function skipAuto() { setLater(); memo().set({ step: 'later', at: Date.now() }); }
  /* 登入著:先跟雲端對帳(CLOUD.flushForMove),回 { accounts(這個帳號還沒上傳的), uid };沒登入、沒有 cloud.js、對帳失敗、
     超過 maxMs(預設 FLUSH_MAX_MS)還沒好,回 {}(組包時改用這台的帳本:帳本上還沒上傳的照樣放進包) */
  async function flushAccounts(maxMs) {
    const C = root.CLOUD;
    if (!C) return {};
    if (C.enabled && C.ready) await withTimeout(Promise.resolve(C.ready).catch(() => {}), CLOUD_WAIT_MS);
    if (!C.user || typeof C.flushForMove !== 'function') return {};
    const uid = typeof C.user.id === 'string' ? C.user.id : undefined;
    try {
      const r = await withTimeout(Promise.resolve().then(() => C.flushForMove()), typeof maxMs === 'number' ? maxMs : FLUSH_MAX_MS, null);
      return r ? { accounts: r.accounts, uid } : {};
    } catch (e) { return {}; }
  }
  /* 組一包:寄出頁的「準備搬家」(搬家碼、搬家檔、視窗)與自動搬家共用這一個。o:{ from, accounts, uid }
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
  /* 第一站的網址(格式跟 MOVE_LINK.wantUrl 一樣;一般頁面沒有載 move-link.js,新網址用 parseWant 解、safeBack 過濾) */
  const wantUrl = (back) => root.MOVE.to + '/move-in.html#want&back=' + encodeURIComponent(back);
  /* 馬上走第一站(LINE 等內建瀏覽器提示的主按鈕、寄出頁的「搬到新網址」):記下這個分頁開始了(寄出頁那一站才認),帶到新網址拿金鑰。
     記不住(sessionStorage 不給寫)回 false,不帶走 */
  function startHere(back) {
    if (!memo().set({ step: 'key', at: Date.now() })) return false;
    root.location.replace(wantUrl(back));
    return true;
  }
  /* 第一站(舊網址每一頁):提示「正在把你的進度帶過去…」與「等一下再搬」,AUTO_DELAY_MS 之後帶到新網址 move-in.html#want(網址裡沒有任何資料)。
     等的時候使用者在頁面上點了、按了鍵、按下滑鼠或手指碰到(作答、按「開始」、捲動),或模擬考進行中(body 的 data-leave-confirm,js/mock.js 設的),就不帶走,改畫按鈕。
     回 'auto'(已經帶走)或不自動的原因;不是 'auto' 時由 start 畫回按鈕 */
  function tryAuto(kind, st) {
    const l = root.location, d = root.document;
    const env = envNow();
    const mem = memo();
    const why = autoBlock({ kind, page: pageOf(l.pathname), inApp: env.inApp, standalone: env.standalone, tried: mem.get() !== null, later: later() });
    if (why) return Promise.resolve(why);
    if (!mem.set({ step: 'key', at: Date.now() })) return Promise.resolve('session');
    return new Promise((resolve) => {
      let done = false, box = null, timer = null;
      /* 使用者有動作:點、按鍵、按下滑鼠或手指碰到(手機上開始捲動、作答) */
      const EVENTS = ['click', 'keydown', 'pointerdown', 'touchstart'];
      const inBar = (t) => { for (let n = t; n; n = n.parentNode) if (n === box) return true; return false; };
      const unlisten = () => { try { EVENTS.forEach((t) => root.removeEventListener(t, onUser, true)); } catch (e) { /* 沒有就算了 */ } };
      const finish = (r, step) => {
        if (done) return;
        done = true;
        root.clearTimeout(timer);
        unlisten();
        if (box) box.remove();
        if (step) mem.set({ step, at: Date.now() });
        resolve(r);
      };
      function onUser(e) { if (!inBar(e && e.target)) finish('busy', 'busy'); }
      try { EVENTS.forEach((t) => root.addEventListener(t, onUser, { capture: true, passive: true })); } catch (e) { /* 聽不到就只靠「等一下再搬」與模擬考的記號 */ }
      whenBody(() => { if (!done) box = bar(AUTO_TEXT, [{ label: '等一下再搬', onClick: () => { setLater(); finish('later', 'later'); } }], true); });
      timer = root.setTimeout(() => {
        if (done) return;
        const exam = !!(d && d.body && d.body.dataset && d.body.dataset.leaveConfirm);
        if (exam) { finish('busy', 'busy'); return; }
        done = true;
        unlisten();
        l.replace(wantUrl(l.pathname + l.search));
        resolve('auto');
      }, AUTO_DELAY_MS);
    });
  }
  /* 第三站(舊網址寄出頁 move-out.html#key=<公鑰>,js/move-out-page.js 呼叫):這個分頁真的開始過(tr_move_auto 是 key、沒過太久)才做。
     對帳(登入著)、組包、加密、檢查長度,整段最多 SEND_MAX_MS;成了才記下送出的包(ack 回來時核對)、帶到新網址 #auto=。
     o:{ pub, back, cancelled()(按了「等一下再搬」) }。回 'auto'(已經帶走)、'memo'(不是這個分頁開始的,什麼都沒做),
     或沒搬成的原因(這個分頁已經記下,回原頁面會顯示按鈕) */
  async function autoSend(o) {
    const M = root.MOVE, L = root.MOVE_LINK, P = root.MOVE_PACK, l = root.location;
    const mem = memo(), m = mem.get();
    const age = m ? Date.now() - m.at : NaN;
    if (!m || m.step !== 'key' || !(age >= 0 && age < KEY_MAX_MS)) return 'memo';
    if (!mem.set({ step: 'build', at: Date.now() })) return 'session';
    const work = (async () => {
      const acc = await flushAccounts(SEND_MAX_MS);   // 自動搬家不改用帳本:對帳卡住就整段逾時、回原頁面給按鈕
      const b = await buildPack(root.localStorage, { from: l.origin, accounts: acc.accounts, uid: acc.uid });
      if (b.summary.tooBig.length || !b.summary.hasData) return { why: 'skip' };
      const url = L.autoUrl(M.to, await L.seal(o.pub, await P.toCode(b.pack, b.hash)), o.back);
      return url.length > L.AUTO_MAX ? { why: 'big' } : { url, b };
    })().catch(() => ({ why: 'error' }));
    let tm = null;
    const r = await Promise.race([work, new Promise((res) => { tm = root.setTimeout(() => res({ why: 'timeout' }), SEND_MAX_MS); })]);
    root.clearTimeout(tm);
    if (o.cancelled && o.cancelled()) return 'later';
    if (r.why) { mem.set({ step: r.why, at: Date.now() }); return r.why; }
    if (!mem.set({ step: 'sent', hash: r.b.hash, local: r.b.local, fp: r.b.fp, at: Date.now() })) { mem.set({ step: 'error', at: Date.now() }); return 'error'; }
    l.replace(r.url);
    return 'auto';
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
    envOf, autoBlock, buildPack, flushAccounts, ackCheck, tryAuto, startHere, autoSend, skipAuto, AUTO_TEXT, autoRun: () => autoRun });
  if (root.MOVE && root.MOVE.onOld && !root.MOVE_OUT_NO_AUTO) start();
})(typeof window !== 'undefined' ? window : globalThis);
