/* 衝衝英文搬家:舊網址的寄出頁與新網址的收件頁之間怎麼傳(搬家計畫 2.3)。
   - 寄出頁用 window.open 開收件頁(網址不帶任何參數),收件頁產生隨機 nonce,每 2 秒對 window.opener 送一次 hello,
     對象網域逐一用 MOVE.from 的網址(只有對的那個收得到)。
   - 寄出頁只收:來源網域是 MOVE.to、來源視窗是自己開的那個、格式對。收到 hello 就一次送出整包,對象網域寫 MOVE.to,不用 '*'。
   - 收件頁只收:來源網域在 MOVE.from 裡、來源視窗是 window.opener、nonce 對、格式對。晚到的包照收,除非使用者已經改用備案(stop)。
   - 不切塊、不等回覆:postMessage 用結構化複製,幾 MB 的字串可以一次送。
   這支不碰儲存,視窗與計時器都由呼叫的人給(測試用假的)。 */
(function (root) {
  'use strict';
  const NONCE = /^[0-9a-f]{32}$/;
  const HASH = /^[0-9a-f]{64}$/;
  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

  function newNonce(cryptoObj) {
    const b = new Uint8Array(16);
    cryptoObj.getRandomValues(b);
    return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  /* 寄出頁。o:{ win, to, child()(自己開的那個視窗), pack, hash, onHello(), onDone() } */
  function sender(o) {
    let nonce = null, done = false;
    function onMessage(ev) {
      if (!ev || ev.origin !== o.to) return;
      const child = o.child();
      if (!child || ev.source !== child) return;
      const d = ev.data;
      if (!isPlain(d)) return;
      if (d.type === 'hello' && d.v === 1 && typeof d.nonce === 'string' && NONCE.test(d.nonce)) {
        nonce = d.nonce;
        try { child.postMessage({ type: 'pack', nonce, hash: o.hash, pack: o.pack }, o.to); } catch (e) { return; }
        if (o.onHello) o.onHello();
        return;
      }
      if (d.type === 'done' && !done && nonce && d.nonce === nonce && d.hash === o.hash) {
        done = true;
        if (o.onDone) o.onDone();
      }
    }
    o.win.addEventListener('message', onMessage);
    return { stop() { o.win.removeEventListener('message', onMessage); } };
  }

  /* 收件頁。o:{ win, opener, from: [網域], nonce, every(毫秒), setInterval, clearInterval, onPack(pack, hash, origin) } */
  function receiver(o) {
    let timer = null, accepted = null, stopped = false;
    function hello() {
      if (stopped || accepted) return;
      o.from.forEach((origin) => {
        try { o.opener.postMessage({ type: 'hello', v: 1, nonce: o.nonce }, origin); } catch (e) { /* 視窗已經關了 */ }
      });
    }
    function onMessage(ev) {
      if (stopped || accepted || !ev || o.from.indexOf(ev.origin) < 0 || ev.source !== o.opener) return;
      const d = ev.data;
      if (!isPlain(d) || d.type !== 'pack' || d.nonce !== o.nonce || typeof d.hash !== 'string' || !HASH.test(d.hash) || !isPlain(d.pack)) return;
      accepted = ev.origin;
      if (timer !== null) o.clearInterval(timer);
      o.onPack(d.pack, d.hash, ev.origin);
    }
    o.win.addEventListener('message', onMessage);
    hello();
    timer = o.setInterval(hello, o.every || 2000);
    return {
      /* 寫完回報:寄出頁還在就會記下「這台搬好了」 */
      done(hash) {
        if (!accepted) return;
        try { o.opener.postMessage({ type: 'done', nonce: o.nonce, hash }, accepted); } catch (e) { /* 寄出頁已經關了也沒關係 */ }
      },
      /* 使用者改用備案:不再聽、不再送 hello */
      stop() {
        stopped = true;
        if (timer !== null) o.clearInterval(timer);
        o.win.removeEventListener('message', onMessage);
      },
      get accepted() { return accepted; },
    };
  }

  /* ---------- 自動搬家的網址(js/move-out.js 組、js/move-in-page.js 解;回程 js/move-out-page.js 解) ----------
     去程:新網址/move-in.html#auto=<搬家碼>&back=<原路徑>;回程:舊網址/move-out.html#ack=<雜湊>&back=<原路徑>。
     搬家碼放在 # 後面:# 後面不會送到任何伺服器(Worker、GitHub、Cloudflare 都看不到,也不會出現在 Referer),
     兩頁的開頭第一件事就用 history.replaceState 拿掉,不留在網址列與上一頁的紀錄裡。
     AUTO_MAX:整個網址的上限 48 KB(49152 字)。# 不送伺服器,伺服器與 CDN 的網址上限(Cloudflare 約 16 KB)管不到;
     瀏覽器:Chrome、Edge、Android 2 MB,Firefox 網址列顯示到 65536 字,Safari 實測約 8 萬字會出錯,取最小的再留餘裕。
     搬家碼是 gzip 過的 base64,48 KB 大約裝得下 200 到 400 KB 的練習資料;超過的照舊用按鈕(視窗之間 postMessage,沒有長度問題)。
     base64 只有英數與 + / =,不需要跳脫;back 用 encodeURIComponent。 */
  const AUTO_MAX = 48 * 1024;
  const CODE = /^RU1Z?:[A-Za-z0-9+/=]+$/;
  /* 原路徑:只收本站的「/路徑?查詢字串」,其他(別的網站、// 開頭、反斜線、太長、怪字元)一律回首頁 / */
  function safeBack(b) {
    if (typeof b !== 'string' || b.length > 512) return '/';
    return /^\/(?![/\\])[A-Za-z0-9._~!$'()*,;:@%/-]*(\?[A-Za-z0-9._~!$'()*,;:@%/?=&+-]*)?$/.test(b) ? b : '/';
  }
  function backOf(raw) {
    if (raw === undefined) return '/';
    try { return safeBack(decodeURIComponent(raw)); } catch (e) { return null; }
  }
  function autoUrl(to, code, back) { return to + '/move-in.html#auto=' + code + '&back=' + encodeURIComponent(safeBack(back)); }
  /* '#auto=…&back=…' → { code, back } 或 null */
  function parseAuto(h) {
    const m = /^#auto=([^&]*)(?:&back=([^&]*))?$/.exec(String(h || ''));
    if (!m || !CODE.test(m[1])) return null;
    const back = backOf(m[2]);
    return back === null ? null : { code: m[1], back };
  }
  function ackUrl(from, hash, back) { return from + '/move-out.html#ack=' + hash + '&back=' + encodeURIComponent(safeBack(back)); }
  /* '#ack=…&back=…' → { hash, back } 或 null */
  function parseAck(h) {
    const m = /^#ack=([0-9a-f]{64})(?:&back=([^&]*))?$/.exec(String(h || ''));
    if (!m) return null;
    const back = backOf(m[2]);
    return back === null ? null : { hash: m[1], back };
  }

  root.MOVE_LINK = Object.freeze({ newNonce, sender, receiver, AUTO_MAX, safeBack, autoUrl, parseAuto, ackUrl, parseAck });
})(typeof globalThis !== 'undefined' ? globalThis : this);
