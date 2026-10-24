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
   - 沒資料也沒登入:帶到新網址同一路徑,帶之前刪掉自己 ss- 開頭的快取、註銷 service worker(這台不需要它接轉址)。
   - 有資料還沒搬:頁面頂端一條提示,「現在搬」「先不要」;價格、註冊、付款結果頁改成先問要不要先搬。
   - 登入著、沒有要搬的:提示到新網址重新登入一次;按下去先補傳(CLOUD.flushForMove),剩 0 項才走,有剩就去搬家頁。
   這支只讀 localStorage,除了上面兩個記號以外不寫任何東西,一筆資料都不刪不改。畫面只用 textContent。 */
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
  const RENAMED = '刷刷英文改名為衝衝英文，搬到新網址 ';
  function close() { setLater(); const x = root.document.getElementById('move-bar'); if (x) x.remove(); }
  function show(kind, st) {
    const M = root.MOVE;
    const again = !!(st && st.done);
    if (kind === 'bar') {
      if (later()) return;
      if (again) {
        return bar(RENAMED + M.newName + '。這台在上次搬家之後又有新的進度，要再搬一次，在新網址才看得到。', [
          { label: '再搬一次', primary: true, href: 'move-out.html' },
          { label: '先不要', onClick: close },
        ]);
      }
      return bar(RENAMED + M.newName + '。這台的進度要搬過去，在新網址才看得到。', [
        { label: '現在搬', primary: true, href: 'move-out.html' },
        { label: '先不要', onClick: close },
      ]);
    }
    if (kind === 'offline') {
      if (later()) return;
      return bar('這台的進度已經搬到新網址 ' + M.newName + '，但現在連不上新網址。在這裡練習的進度不會自動過去，新網址連得上之後，這裡會提醒你再搬一次。', [
        { label: '知道了', onClick: close },
      ]);
    }
    if (kind === 'ask') {
      return bar(RENAMED + M.newName + '，舊網址不再註冊與付款。這台有' + (again ? '上次搬家之後的新' : '練習') + '進度，要先搬過去嗎？', [
        { label: '先搬進度', primary: true, href: 'move-out.html' },
        { label: '不用，直接去新網址', onClick: () => go(false) },
      ]);
    }
    if (kind === 'login') {
      return bar(RENAMED + M.newName + '。到新網址重新登入一次，進度會從雲端回來。', [
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
      if (kind === 'go') go(!st.hasData || st.moved);
      else if (kind !== 'stay') {
        const draw = () => show(kind, st);
        if (root.document.body) draw(); else root.document.addEventListener('DOMContentLoaded', draw);
      }
      return kind;
    });
  }

  root.MOVE_OUT = Object.freeze({ decide, pageOf, stateOf, flags, ping, start, cleanup, go, target });
  if (root.MOVE && root.MOVE.onOld && !root.MOVE_OUT_NO_AUTO) start();
})(typeof window !== 'undefined' ? window : globalThis);
