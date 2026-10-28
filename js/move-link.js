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

  /* ---------- 自動搬家:同一個分頁換頁,不開新視窗(LINE 等內建瀏覽器也能用),搬家碼不以明文進任何網址 ----------
     網址的 # 後面不會送到伺服器,但瀏覽器的全域歷史紀錄(Chrome 的 History 檔、開了同步會上傳)在換頁那一刻就記下含 # 的完整網址,
     之後的 history.replaceState 只改得了分頁的上一頁紀錄,改不了那一筆;新網址連不上時錯誤頁的網址列也會留著。所以分四站:
     1. 舊網址每一頁(js/move-out.js tryAuto)→ 新網址/move-in.html#want&n=<一次性號碼>&back=<原路徑>:網址裡沒有任何資料。
        號碼是隨機的 16 位元組,同時記在舊網址這個分頁的 sessionStorage(tr_move_auto 的 n)。
     2. 新網址(js/move-in-page.js)產生一次性的 ECDH P-256 金鑰,私鑰只放新網址這個分頁的 sessionStorage(tr_move_key),
        → 舊網址/move-out.html#key=<公鑰>&n=<同一個號碼>&back=<原路徑>:公鑰公開也沒關係。
     3. 舊網址寄出頁(js/move-out.js autoSend)先核對號碼跟這個分頁記的一樣(用過就作廢),公鑰才算是這一趟新網址給的:
        別的網站用 window.open 開舊網址一頁、再把那個視窗導到 #key=<它自己的公鑰>,拿不到號碼,寄出頁什麼都不組、不加密。
        對了才組包(跟「複製搬家碼」同一包),用公鑰加密(seal:臨時 ECDH 金鑰 + AES-GCM)
        → 新網址/move-in.html#auto=RU1E:<臨時公鑰>.<iv>.<密文>&back=<原路徑>。
     4. 新網址用私鑰解開(open),解開就刪私鑰;合併好 → 舊網址/move-out.html#ack=<雜湊>&back=<原路徑>,舊網址核對後寫完成記號。
     歷史紀錄、錯誤頁、被複製出去的網址裡只有公鑰與密文;私鑰在新網址那個分頁用過就刪,別的分頁、別台、別人都解不開。
     每一站的頁面開頭都先用 history.replaceState 把 # 後面拿掉(只是讓網址列乾淨,不是保密的手段)。
     AUTO_MAX:整個網址的上限 48 KB(49152 字)。# 不送伺服器,伺服器與 CDN 的網址上限(Cloudflare 約 16 KB)管不到;
     瀏覽器:Chrome、Edge、Android 2 MB,Firefox 網址列顯示到 65536 字,Safari 實測約 8 萬字會出錯,取最小的再留餘裕。
     密文是 gzip 過的位元組直接加密再轉 base64url,48 KB 大約裝得下 200 到 400 KB 的練習資料;超過的照舊用按鈕(視窗之間 postMessage,沒有長度問題)。
     base64url 只有英數與 - _,不需要跳脫;back 用 encodeURIComponent。 */
  const AUTO_MAX = 48 * 1024;
  const PUB = /^[A-Za-z0-9_-]{87}$/;   // P-256 未壓縮公鑰 65 位元組
  const SEALED = /^RU1E:([A-Za-z0-9_-]{87})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{24,})$/;
  const PLAIN = /^RU1(Z?):([A-Za-z0-9+/=]+)$/;
  const EC = { name: 'ECDH', namedCurve: 'P-256' };
  /* 原路徑:只收本站的「/路徑?查詢字串」,其他(別的網站、// 開頭、反斜線、太長、怪字元)一律回首頁 / */
  function safeBack(b) {
    if (typeof b !== 'string' || b.length > 512) return '/';
    return /^\/(?![/\\])[A-Za-z0-9._~!$'()*,;:@%/-]*(\?[A-Za-z0-9._~!$'()*,;:@%/?=&+-]*)?$/.test(b) ? b : '/';
  }
  function backOf(raw) {
    if (raw === undefined) return '/';
    try { return safeBack(decodeURIComponent(raw)); } catch (e) { return null; }
  }
  const backPart = (back) => '&back=' + encodeURIComponent(safeBack(back));

  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return root.btoa(s);
  }
  function b64ToBytes(str) {
    const s = root.atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const b64u = (bytes) => bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  function unb64u(str) {
    const t = str.replace(/-/g, '+').replace(/_/g, '/');
    return b64ToBytes(t + '==='.slice((t.length + 3) % 4));
  }
  function subtle() {
    const s = root.crypto && root.crypto.subtle;
    if (!s) throw new Error('這個瀏覽器沒有 Web Crypto');
    return s;
  }
  const aes = (priv, pub, use) => subtle().deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, [use]);
  /* 新網址:一次性金鑰。回 { pub(base64url,放進網址), jwk(私鑰,只放新網址這個分頁的 sessionStorage) } */
  async function newKey() {
    const kp = await subtle().generateKey(EC, true, ['deriveKey']);
    return { pub: b64u(new Uint8Array(await subtle().exportKey('raw', kp.publicKey))), jwk: await subtle().exportKey('jwk', kp.privateKey) };
  }
  /* 舊網址:搬家碼(RU1Z: 或 RU1:)用新網址的公鑰加密 → 'RU1E:<臨時公鑰>.<iv>.<密文>'。第一個位元組記是不是 gzip,其餘是搬家碼解開 base64 的位元組 */
  async function seal(pubText, code) {
    if (typeof pubText !== 'string' || !PUB.test(pubText)) throw new Error('公鑰格式不對');
    const m = PLAIN.exec(String(code || ''));
    if (!m) throw new Error('不是搬家碼');
    const body = b64ToBytes(m[2]);
    const plain = new Uint8Array(body.length + 1);
    plain[0] = m[1] ? 1 : 0;
    plain.set(body, 1);
    const pub = await subtle().importKey('raw', unb64u(pubText), EC, false, []);
    const eph = await subtle().generateKey(EC, true, ['deriveKey']);
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await aes(eph.privateKey, pub, 'encrypt'), plain));
    return 'RU1E:' + b64u(new Uint8Array(await subtle().exportKey('raw', eph.publicKey))) + '.' + b64u(iv) + '.' + b64u(ct);
  }
  /* 新網址:用私鑰解開 → 原本的搬家碼(交給 MOVE_PACK.fromText,跟貼上搬家碼同一條路)。金鑰不對、被改過就丟錯 */
  async function open(jwk, sealed) {
    const m = SEALED.exec(String(sealed || ''));
    if (!m || !isPlain(jwk)) throw new Error('解不開');
    const priv = await subtle().importKey('jwk', jwk, EC, false, ['deriveKey']);
    const eph = await subtle().importKey('raw', unb64u(m[1]), EC, false, []);
    const plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64u(m[2]) }, await aes(priv, eph, 'decrypt'), unb64u(m[3])));
    if (!plain.length || plain[0] > 1) throw new Error('解不開');
    return (plain[0] === 1 ? 'RU1Z:' : 'RU1:') + bytesToB64(plain.subarray(1));
  }

  /* 一次性號碼(第一站記在舊網址這個分頁,經新網址照原樣帶回第三站核對):沒有或格式不對就不放進網址 */
  const nPart = (n) => (typeof n === 'string' && NONCE.test(n) ? '&n=' + n : '');
  /* 第一站:'#want&n=<號碼>&back=…' → { back, n(沒有是 null) } 或 null */
  function wantUrl(to, back, n) { return to + '/move-in.html#want' + nPart(n) + backPart(back); }
  function parseWant(h) {
    const m = /^#want(?:&n=([^&]*))?(?:&back=([^&]*))?$/.exec(String(h || ''));
    if (!m || (m[1] !== undefined && !NONCE.test(m[1]))) return null;
    const back = backOf(m[2]);
    return back === null ? null : { back, n: m[1] === undefined ? null : m[1] };
  }
  /* 第二站:'#key=<公鑰>&n=<號碼>&back=…' → { pub, n(沒有是 null,寄出頁一定對不上), back } 或 null */
  function keyUrl(from, pub, back, n) { return from + '/move-out.html#key=' + pub + nPart(n) + backPart(back); }
  function parseKey(h) {
    const m = /^#key=([^&]*)(?:&n=([^&]*))?(?:&back=([^&]*))?$/.exec(String(h || ''));
    if (!m || !PUB.test(m[1]) || (m[2] !== undefined && !NONCE.test(m[2]))) return null;
    const back = backOf(m[3]);
    return back === null ? null : { pub: m[1], n: m[2] === undefined ? null : m[2], back };
  }
  /* 第三站:只收加密過的(RU1E:);明文的搬家碼不放進網址,也不收 */
  function autoUrl(to, sealed, back) {
    if (!SEALED.test(String(sealed || ''))) throw new Error('只放加密過的搬家碼,明文不進網址');
    return to + '/move-in.html#auto=' + sealed + backPart(back);
  }
  /* 搬家碼(明文)加密之後放進 autoUrl 會有多長,不用真的加密:寄出頁先判斷能不能一鍵搬(LINE 等內建瀏覽器)。
     密文 = 第一個位元組(是不是 gzip)+ 搬家碼解開 base64 的位元組 + AES-GCM 的 16 位元組標籤;臨時公鑰 87 字、iv 16 字。不是搬家碼回 Infinity */
  function autoLen(to, code, back) {
    const m = PLAIN.exec(String(code || ''));
    if (!m) return Infinity;
    const pad = (/=+$/.exec(m[2]) || [''])[0].length;
    const bytes = Math.floor(m[2].length * 3 / 4) - pad;
    return (to + '/move-in.html#auto=RU1E:').length + 87 + 1 + 16 + 1 + Math.ceil((bytes + 1 + 16) * 4 / 3) + backPart(back).length;
  }
  /* '#auto=…&back=…' → { code(密文), back } 或 null */
  function parseAuto(h) {
    const m = /^#auto=([^&]*)(?:&back=([^&]*))?$/.exec(String(h || ''));
    if (!m || !SEALED.test(m[1])) return null;
    const back = backOf(m[2]);
    return back === null ? null : { code: m[1], back };
  }
  /* 第四站(回程) */
  function ackUrl(from, hash, back) { return from + '/move-out.html#ack=' + hash + backPart(back); }
  /* '#ack=…&back=…' → { hash, back } 或 null */
  function parseAck(h) {
    const m = /^#ack=([0-9a-f]{64})(?:&back=([^&]*))?$/.exec(String(h || ''));
    if (!m) return null;
    const back = backOf(m[2]);
    return back === null ? null : { hash: m[1], back };
  }

  root.MOVE_LINK = Object.freeze({ newNonce, sender, receiver, AUTO_MAX, safeBack, newKey, seal, open, wantUrl, parseWant, keyUrl, parseKey,
    autoUrl, autoLen, parseAuto, ackUrl, parseAck });
})(typeof globalThis !== 'undefined' ? globalThis : this);
