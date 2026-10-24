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

  root.MOVE_LINK = Object.freeze({ newNonce, sender, receiver });
})(typeof globalThis !== 'undefined' ? globalThis : this);
