/* 衝衝英文搬家:組搬家包、算雜湊、搬家檔與搬家碼(搬家計畫 2.3、2.9)。
   - 搬家包只放在記憶體、視窗之間的 postMessage、使用者自己存的檔案或複製的搬家碼裡,不放進網址、不寄到任何伺服器。
   - keys 存 localStorage 原本的字串,不先解析,避免轉換時改到內容;讀不懂的值不放進包,列在摘要上。
   - 雜湊只算內容({ keys, accounts },鍵排序後用 canon 轉字串),不含 at、from:同一台、內容沒變,兩次組出來的雜湊一定一樣。
   - 登入憑證(sb- 開頭)、使用權快取、搬家自己的紀錄一律不放(js/move-rules.js 的 classify)。
   - 每台裝置(每個瀏覽器的儲存空間)第一次搬家時在舊網址新增一個 tr_move_device(隨機編號),放進包的 device:
     新網址的 tr_move_log 依它分開記,別台搬來的不會被當成「同一台再搬」。寄出頁在舊網址只新增它與 tr_move_done 兩個鍵。
   - 搬家碼與搬家檔讀進來時有上限(MAX_TEXT 字、解開後 MAX_BYTES 位元組),超過就停,不會把手機的記憶體吃光。
   依賴 js/move-rules.js、js/move-merge.js。 */
(function (root) {
  'use strict';
  const R = root.MOVE_RULES, M = root.MOVE_MERGE;
  const LEDGER = /^tr_unsynced_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
  /* 搬家檔、搬家碼解開後的上限:整包上限的 3 倍(中文一個字 UTF-8 三個位元組,JSON 跳脫還會再多一點);搬家碼是 base64,再乘 4/3 */
  const MAX_BYTES = 3 * R.LIMITS.total;
  const MAX_TEXT = Math.ceil(MAX_BYTES * 4 / 3) + 64;
  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

  function lsKeys(ls) {
    const out = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (typeof k === 'string') out.push(k); }
    return out;
  }
  function parseOk(raw) { try { return { ok: true, v: JSON.parse(raw) }; } catch (e) { return { ok: false }; } }

  const meaningful = R.meaningful;

  /* 這台的裝置編號:有就用,沒有就新增一個(只新增這一個鍵,不改別的);寫不進去也照樣回一個
     (這次用,下次會是新的,等於別台:只會多問,不會蓋掉) */
  function deviceId(ls, cr) {
    let id = null;
    try { id = ls.getItem('tr_move_device'); } catch (e) { id = null; }
    if (typeof id === 'string' && /^[0-9a-f]{32}$/.test(id)) return id;
    const b = new Uint8Array(16);
    cr.getRandomValues(b);
    id = Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
    try { ls.setItem('tr_move_device', id); } catch (e) { /* 空間不夠或不給寫:這次照樣用 */ }
    return id;
  }

  /* 還沒上傳的雲端帳號項目(這台沒登入、或 flushForMove 沒給時):帳本上的鍵,加上「只在本機」標記的 pet
     (登入失效改回訪客後,只有標記、沒有帳本的帳號也算)。值讀不到或讀不懂就不帶 */
  function ledgerAccounts(ls, keys) {
    const out = {};
    const uids = [];
    keys.forEach((k) => { const m = LEDGER.exec(k) || R.LOCAL_ONLY.exec(k); if (m && uids.indexOf(m[1]) < 0) uids.push(m[1]); });
    uids.forEach((uid) => {
      const pid = 'c' + uid.replace(/-/g, '');
      const led = parseOk(ls.getItem('tr_unsynced_' + uid) || 'null').v;
      const marks = parseOk(ls.getItem('tr_localonly_' + uid) || 'null').v;
      const times = Object.assign({}, isPlain(marks) && typeof marks.pet === 'number' ? { pet: marks.pet } : {}, isPlain(led) ? led : {});
      const list = [];
      Object.keys(times).sort().forEach((sub) => {
        if (!R.ruleOf(sub)) return;
        const raw = ls.getItem('tr_u' + pid + '_' + sub);
        if (raw === null || !parseOk(raw).ok) return;
        const t = Math.floor(Number(times[sub]));
        list.push([sub, raw, isFinite(t) && t > 0 ? t : 0]);
      });
      if (list.length) out[uid] = list;
    });
    return out;
  }

  /* 組一包。opt:{ from, now, device(deviceId 給的), uid(目前登入的帳號), accounts(flushForMove 回的目前帳號 { 帳號 id: [[鍵, 原字串, 時間]] }) }
     帳號的部分:先讀這台每個帳號的帳本,再把目前帳號換成 flushForMove 給的(它已經傳上去的不必帶),同一台其他帳號照帶。
     回 { pack, summary }。summary:{ hasData, profiles, banks(名稱), pet, hist, keys, unknown, unreadable, unreadableNames, tooBig(搬不了的項目名稱:太大的鍵、整包太大、鍵數或帳號數超過 MOVE_RULES.LIMITS),
     accountItems, bytes }。tooBig 不是空的:寄出頁不讓送出(js/move-out-page.js),也就不會寫 tr_move_done。 */
  function collect(ls, opt) {
    const keys = lsKeys(ls);
    const profileIds = R.profileIdsOf(ls.getItem('tr_profiles'));
    const out = [];
    const sum = { hasData: false, profiles: profileIds.size, banks: [], pet: false, hist: 0, keys: 0, unknown: 0, unreadable: 0, unreadableNames: [], tooBig: [], accountItems: 0, bytes: 0 };
    const nameOf = (c) => M.labelOf(c.kind === 'global' ? c.sub.replace(/^tr_/, '') : c.sub);
    const note = (list, name) => { if (list.indexOf(name) < 0) list.push(name); };
    keys.forEach((k) => {
      const c = R.classify(k, profileIds);
      if (c.kind === 'unknown') { sum.unknown++; return; }
      if (c.kind !== 'guest' && c.kind !== 'profile' && c.kind !== 'global') return;
      const raw = ls.getItem(k);
      if (raw === null) return;
      if (raw.length > R.LIMITS.key) { note(sum.tooBig, nameOf(c)); sum.hasData = true; return; }
      const p = parseOk(raw);
      if (!p.ok) { sum.unreadable++; note(sum.unreadableNames, nameOf(c)); return; }
      out.push([k, raw]);
      sum.bytes += k.length + raw.length;
      if (c.kind !== 'global' && meaningful(c.sub, p.v)) sum.hasData = true;
      if (c.rule === 'profiles' && Array.isArray(p.v) && p.v.length) sum.hasData = true;
      if (c.sub === 'vgame_banks' && Array.isArray(p.v)) p.v.forEach((b) => { if (isPlain(b)) sum.banks.push(String(b.name || '')); });
      if (c.sub === 'pet' && meaningful('pet', p.v)) sum.pet = true;
      if (c.sub === 'hist' && Array.isArray(p.v)) sum.hist += p.v.length;
    });
    out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const accounts = ledgerAccounts(ls, keys);
    if (opt && isPlain(opt.accounts)) {
      if (typeof opt.uid === 'string') delete accounts[opt.uid];
      Object.keys(opt.accounts).forEach((uid) => { if (Array.isArray(opt.accounts[uid]) && opt.accounts[uid].length) accounts[uid] = opt.accounts[uid]; });
    }
    Object.keys(accounts).forEach((uid) => { sum.accountItems += accounts[uid].length; accounts[uid].forEach((e) => { sum.bytes += e[0].length + e[1].length; }); });
    if (sum.accountItems) sum.hasData = true;
    sum.keys = out.length;
    if (sum.bytes > R.LIMITS.total) note(sum.tooBig, '全部的資料');
    /* 收件端(MOVE_RULES.validate)的鍵數、帳號數上限,這裡先擋:超過就不給送出,不會送到新網址才被拒 */
    if (out.length > R.LIMITS.keys) note(sum.tooBig, '全部的項目（' + out.length + ' 項）');
    const uids = Object.keys(accounts);
    if (uids.length > R.LIMITS.accounts) note(sum.tooBig, '登入過的帳號（' + uids.length + ' 個）');
    if (uids.some((uid) => accounts[uid].length > R.LIMITS.perAccount)) note(sum.tooBig, '帳號還沒上傳的進度');
    const pack = { app: 'rushup-move', v: 1, from: (opt && opt.from) || '', at: new Date((opt && opt.now) || Date.now()).toISOString(), keys: out, accounts };
    if (opt && typeof opt.device === 'string' && R.DEVICE.test(opt.device)) pack.device = opt.device;
    return { pack, summary: sum };
  }

  /* 雜湊要算的字串:keys 依鍵名排序,accounts 依帳號 id、再依鍵名排序;不含 at、from */
  /* 格式不對的包(收件端還沒驗證的)也不會丟錯 */
  const byKey = (a, b) => { const x = Array.isArray(a) ? String(a[0]) : '', y = Array.isArray(b) ? String(b[0]) : ''; return x < y ? -1 : x > y ? 1 : 0; };
  function hashInput(pack) {
    const p = isPlain(pack) ? pack : {};
    const keys = Array.isArray(p.keys) ? p.keys.slice().sort(byKey) : [];
    const acc = isPlain(p.accounts) ? p.accounts : {};
    const accounts = Object.keys(acc).sort().map((uid) => [uid, Array.isArray(acc[uid]) ? acc[uid].slice().sort(byKey) : []]);
    return M.canon({ keys, accounts });
  }
  async function sha256(str) {
    const buf = await root.crypto.subtle.digest('SHA-256', new root.TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function hashOf(pack) { return sha256(hashInput(pack)); }

  /* ---------- 搬家檔與搬家碼 ---------- */
  function toFileText(pack, hash) { return JSON.stringify({ pack, hash }); }
  function fileName(now) {
    const d = new Date((now || Date.now()) + 8 * 3600e3).toISOString().slice(0, 10);
    return '衝衝英文搬家檔_' + d + '.json';
  }
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return root.btoa(s);
  }
  function unb64(str) {
    const s = root.atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function pipe(bytes, Stream, kind) {
    const rs = new root.Blob([bytes]).stream().pipeThrough(new Stream(kind));
    return new Uint8Array(await new root.Response(rs).arrayBuffer());
  }
  /* 解壓縮,一邊數位元組,超過 max 就停(回 null) */
  async function inflate(bytes, max) {
    const reader = new root.Blob([bytes]).stream().pipeThrough(new root.DecompressionStream('gzip')).getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      n += r.value.length;
      if (n > max) { try { await reader.cancel(); } catch (e) { /* 已經停了 */ } return null; }
      parts.push(r.value);
    }
    const out = new Uint8Array(n);
    let at = 0;
    parts.forEach((x) => { out.set(x, at); at += x.length; });
    return out;
  }
  /* 有 CompressionStream 就先壓縮(開頭 RU1Z:),沒有就原文(開頭 RU1:)。noGzip:強制不壓縮(測試與舊瀏覽器用) */
  async function toCode(pack, hash, noGzip) {
    const bytes = new root.TextEncoder().encode(toFileText(pack, hash));
    if (!noGzip && typeof root.CompressionStream === 'function') {
      try { return 'RU1Z:' + b64(await pipe(bytes, root.CompressionStream, 'gzip')); } catch (e) { /* 壓不了就用原文 */ }
    }
    return 'RU1:' + b64(bytes);
  }
  /* 搬家碼或搬家檔的文字 → { ok, pack, hash } 或 { ok: false, why }(why:noGzip、broken、notMove、tooBig) */
  async function fromText(text) {
    const raw = String(text || '');
    if (raw.length > MAX_TEXT) return { ok: false, why: 'tooBig' };
    const t = raw.trim();
    let json;
    try {
      if (/^RU1Z:/.test(t)) {
        if (typeof root.DecompressionStream !== 'function') return { ok: false, why: 'noGzip' };
        const bytes = await inflate(unb64(t.slice(5).replace(/\s+/g, '')), MAX_BYTES);
        if (!bytes) return { ok: false, why: 'tooBig' };
        json = new root.TextDecoder().decode(bytes);
      } else if (/^RU1:/.test(t)) {
        json = new root.TextDecoder().decode(unb64(t.slice(4).replace(/\s+/g, '')));
      } else json = t;
    } catch (e) { return { ok: false, why: 'broken' }; }
    if (json.length > MAX_BYTES) return { ok: false, why: 'tooBig' };
    let o;
    try { o = JSON.parse(json); } catch (e) { return { ok: false, why: 'broken' }; }
    if (!isPlain(o) || !isPlain(o.pack) || typeof o.hash !== 'string') return { ok: false, why: 'notMove' };
    return { ok: true, pack: o.pack, hash: o.hash };
  }

  root.MOVE_PACK = Object.freeze({ collect, meaningful, deviceId, ledgerAccounts, hashInput, sha256, hashOf, toFileText, fileName, toCode, fromText, MAX_BYTES, MAX_TEXT });
})(typeof globalThis !== 'undefined' ? globalThis : this);
