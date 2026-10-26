/* 測試用的舊版:844e936(2026-10-27 22:35 切換網域時上線)的 js/move-rules.js 原封不動。新網址 service worker 快取的舊收件頁用的就是它,
   tools/test_move_core.js 拿它驗證新版寄出頁組的搬家包舊收件頁也收得下。不要改。 */
/* 衝衝英文搬家:哪些鍵要搬、怎麼認、收到的搬家包怎麼重新驗證(搬家計畫 2.2、2.5)。
   純計算,不讀寫任何儲存;寄出頁、收件頁、測試(tools/test_move_core.js)共用。
   - 鍵名一律用嚴格的正規式拆,不用 startsWith:tr_unsynced_<id> 也是 tr_u 開頭,不能被當成學生資料夾。
   - 模組鍵的合併規則寫在 RULES;程式裡用到的每個 store 鍵都要在這裡有規則(test_move_core.js 會掃 js/*.js,
     新增的鍵沒有規則測試就失敗,不會默默落到「留新網址的」)。
   - 登入憑證(sb- 開頭)、使用權快取、註冊意向、搬家自己的紀錄,一律不搬。 */
(function (root) {
  'use strict';

  /* 模組鍵 → 合併規則(規則的意思在 js/move-merge.js) */
  const EXACT = Object.freeze({
    hist: 'hist', mock_history: 'mock', pet: 'pet', daily_done: 'daily', vgame_banks: 'banks',
    vgame_best: 'best', vgame_toast_best: 'best', vgame_pairs_best: 'pairsBest', vgame_clear: 'clear',
    vgame_done: 'idmap', vgame_miss: 'pool', phrase_drill: 'pool', verb_quiz: 'pool',
    grammar_done: 'idmap', phonics_done: 'idmap', dlg_heard: 'idmap',
    writing_read: 'idmap', writing_s: 'idmap', writing_b: 'texts', writing_e: 'texts', writing_y: 'texts',
    ear_s: 'idmap', ear_d: 'idmap', ear_mp: 'idmap', ear_n: 'idmap',
    diag: 'single', ph_slow: 'single', vgame_src: 'single',
  });
  const ID = '[A-Za-z0-9_.-]{1,80}';
  const FAMILIES = Object.freeze([
    [new RegExp('^drill_p\\d{1,2}$'), 'pool'],
    [new RegExp('^listen_p\\d{1,2}$'), 'pool'],
    [new RegExp('^read_q_' + ID + '$'), 'answers'],
    [new RegExp('^read_tq_' + ID + '$'), 'single'],
    [new RegExp('^vocab_' + ID + '$'), 'fills'],
  ]);
  /* 不在學生資料夾底下的全站鍵 */
  const GLOBAL = Object.freeze({ tr_profiles: 'profiles', tr_current_profile: 'currentProfile', tr_pet_hint: 'fillMissing' });
  /* 不搬的 tr_ 鍵:暫時的、各網域自己的、跟登入有關的 */
  const EXCLUDE = [/^tr_access_/, /^tr_trial_note_closed$/, /^tr_signup_intent(_used)?$/, /^tr_pending_join$/, /^tr_move_/,
    /^tr_unsynced_/, /^tr_localonly_/, /^tr_cloud_hydrated_/, /^tr_auth_expired$/, /^tr_pw_recovery$/, /^tr_pay_last$/];
  const FOLDER = /^tr_u(p[0-9a-z]{4,20}|c[0-9a-f]{32})_([A-Za-z0-9_.-]{1,100})$/;
  const GUEST = /^tr_([A-Za-z0-9_.-]{1,100})$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const PID = /^p[0-9a-z]{4,20}$/;
  /* 一個鍵不另外設比整包小的上限:瀏覽器的 localStorage 整個網域大約 500 萬字,一個很大的自訂題庫也要搬得過去。
     記憶體由整包的大小擋住;鍵數、帳號數只是防呆,放寬到共用電腦(很多學生檔案、每篇文章 3 個鍵)也搬得了。
     寄出端(js/move-pack.js collect)照同一套上限先檢查,超過就列在 tooBig、不給送出,不會送到新網址才被拒。 */
  const LIMITS = Object.freeze({ key: 8 * 1024 * 1024, total: 8 * 1024 * 1024, keys: 50000, accounts: 200, perAccount: 5000 });
  const NAME_MAX = 100;
  const DEVICE = /^[0-9a-f]{16,64}$/;
  const LOCAL_ONLY = /^tr_localonly_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
  const LOCAL_ONLY_SUBS = Object.freeze(['pet']);   // 跟 js/cloud.js 的 MERGED 一樣:只在本機標記、還沒合併上傳的鍵

  function ruleOf(sub) {
    if (typeof sub !== 'string') return null;
    if (Object.prototype.hasOwnProperty.call(EXACT, sub)) return EXACT[sub];
    for (let i = 0; i < FAMILIES.length; i++) if (FAMILIES[i][0].test(sub)) return FAMILIES[i][1];
    return null;
  }

  /* 一個 localStorage 鍵是什麼。profileIds:tr_profiles 名單裡的本機學生編號(Set)。
     回 { kind, rule, pid, sub }:kind 是 guest(訪客資料)、profile(本機學生)、global(全站鍵)、cloud(雲端帳號的資料夾,預設不搬)、
     skip(不是本站的、或刻意不搬)、unknown(認不得,列在摘要上給人看) */
  function classify(key, profileIds) {
    if (typeof key !== 'string' || key.indexOf('tr_') !== 0) return { kind: 'skip' };
    if (Object.prototype.hasOwnProperty.call(GLOBAL, key)) return { kind: 'global', rule: GLOBAL[key], sub: key };
    for (let i = 0; i < EXCLUDE.length; i++) if (EXCLUDE[i].test(key)) return { kind: 'skip' };
    const f = FOLDER.exec(key);
    if (f) {
      const pid = f[1], sub = f[2], rule = ruleOf(sub);
      if (pid.charAt(0) === 'c') return rule ? { kind: 'cloud', rule, pid, sub } : { kind: 'unknown' };
      if (!rule || !profileIds || !profileIds.has(pid)) return { kind: 'unknown' };
      return { kind: 'profile', rule, pid, sub };
    }
    const g = GUEST.exec(key);
    if (g && g[1].charAt(0) !== 'u') {
      const rule = ruleOf(g[1]);
      if (rule) return { kind: 'guest', rule, sub: g[1] };
    }
    return { kind: 'unknown' };
  }

  /* tr_profiles 的原字串 → 編號的 Set(壞掉的、格式不對的一律不算) */
  function profileIdsOf(raw) {
    const out = new Set();
    let list = null;
    try { list = JSON.parse(raw); } catch (e) { list = null; }
    if (!Array.isArray(list)) return out;
    list.forEach((p) => { if (p && typeof p === 'object' && typeof p.id === 'string' && PID.test(p.id)) out.add(p.id); });
    return out;
  }

  /* 學生名單:收件端只收編號是本機學生格式、不重複的人;名字不是字串(或是空的)改成「未命名」,
     只留 id、name、created 三個欄位(js/profile.js 建的就是這三個)。回整理過的陣列,名單不是陣列回 null */
  function cleanProfiles(raw) {
    let list;
    try { list = JSON.parse(raw); } catch (e) { return null; }
    if (!Array.isArray(list)) return null;
    const seen = new Set(), out = [];
    list.forEach((p) => {
      if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.id !== 'string' || !PID.test(p.id) || seen.has(p.id)) return;
      seen.add(p.id);
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.slice(0, NAME_MAX) : '未命名';
      const o = { id: p.id, name };
      if (typeof p.created === 'string' && p.created.length <= 40) o.created = p.created;
      out.push(o);
    });
    return out;
  }

  function parses(raw) {
    if (typeof raw !== 'string') return false;
    try { JSON.parse(raw); return true; } catch (e) { return false; }
  }

  /* 收件端重新驗證一包(不管從視窗、檔案還是貼上來)。任何一項不對就整包拒絕,不挑著收。
     回 { ok: true, keys: [[鍵, 原字串]], accounts: Map(帳號 id → [[鍵, 原字串, 時間]]), profileIds, device(寄出那台的裝置編號,沒有是 '') }
     或 { ok: false, why } */
  function validate(pack, now) {
    const bad = (why) => ({ ok: false, why });
    if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return bad('格式不對');
    if (pack.app !== 'rushup-move' || pack.v !== 1) return bad('這不是衝衝英文的搬家資料');
    if (!Array.isArray(pack.keys)) return bad('格式不對');
    if (pack.device !== undefined && (typeof pack.device !== 'string' || !DEVICE.test(pack.device))) return bad('格式不對');
    if (pack.keys.length > LIMITS.keys) return bad('鍵太多');
    let total = 0;
    const seen = new Set();
    const prof = pack.keys.filter((e) => Array.isArray(e) && e[0] === 'tr_profiles')[0];
    let cleaned = null;
    if (prof && typeof prof[1] === 'string') {
      cleaned = cleanProfiles(prof[1]);
      if (!cleaned) return bad('學生名單格式不對');
    }
    const profileIds = new Set(cleaned ? cleaned.map((p) => p.id) : []);
    const keys = [];
    for (let i = 0; i < pack.keys.length; i++) {
      const e = pack.keys[i];
      if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string' || typeof e[1] !== 'string') return bad('有一項格式不對');
      const [k, raw] = e;
      if (seen.has(k)) return bad('同一個鍵出現兩次');
      seen.add(k);
      const c = classify(k, profileIds);
      if (c.kind !== 'guest' && c.kind !== 'profile' && c.kind !== 'global') return bad('有不能搬的鍵');
      if (raw.length > LIMITS.key) return bad('有一項太大');
      if (!parses(raw)) return bad('有一項讀不懂');
      total += k.length + raw.length;
      keys.push([k, k === 'tr_profiles' ? JSON.stringify(cleaned) : raw]);
    }
    const accounts = new Map();
    const acc = pack.accounts === undefined ? {} : pack.accounts;
    if (!acc || typeof acc !== 'object' || Array.isArray(acc)) return bad('格式不對');
    const ids = Object.keys(acc);
    if (ids.length > LIMITS.accounts) return bad('帳號太多');
    for (let i = 0; i < ids.length; i++) {
      const uid = ids[i];
      if (!UUID.test(uid)) return bad('帳號編號不對');
      const list = acc[uid];
      if (!Array.isArray(list) || list.length > LIMITS.perAccount) return bad('格式不對');
      const out = [];
      const subs = new Set();
      for (let j = 0; j < list.length; j++) {
        const e = list[j];
        if (!Array.isArray(e) || e.length !== 3 || typeof e[1] !== 'string') return bad('有一項格式不對');
        const [sub, raw, t] = e;
        if (!ruleOf(sub) || subs.has(sub)) return bad('有不能搬的鍵');
        subs.add(sub);
        if (raw.length > LIMITS.key || !parses(raw)) return bad('有一項讀不懂');
        if (typeof t !== 'number' || !isFinite(t) || Math.floor(t) !== t) return bad('時間不對');
        total += sub.length + raw.length;
        out.push([sub, raw, Math.max(0, Math.min(t, now))]);
      }
      if (out.length) accounts.set(uid, out);
    }
    if (total > LIMITS.total) return bad('整包太大');
    return { ok: true, keys, accounts, profileIds, device: typeof pack.device === 'string' ? pack.device : '' };
  }

  /* 這個值算不算「有東西」:頁面自己建的空小雞、空陣列、關著的開關都不算 */
  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  function meaningful(sub, v) {
    if (sub === 'pet') return isPlain(v) && ((isPlain(v.days) && Object.keys(v.days).length > 0) || !!v.name || (Array.isArray(v.met) && v.met.length > 0));
    if (Array.isArray(v)) return v.length > 0;
    if (isPlain(v)) return Object.keys(v).length > 0;
    return v !== null && v !== false && v !== '' && v !== 0;
  }
  /* 雲端帳號只在本機標記的鍵(tr_localonly_<帳號> 裡的 pet):資料夾裡有、讀得懂、有東西,才算還沒上傳的進度。
     登入失效改回訪客時(js/cloud.js leaveStaleAccount)標記與資料夾都留著、沒有帳本,也要搬。 */
  function localOnlySubs(ls, uid) {
    let marks = null;
    try { marks = JSON.parse(ls.getItem('tr_localonly_' + uid)); } catch (e) { marks = null; }
    if (!isPlain(marks)) return [];
    const pid = 'c' + uid.replace(/-/g, '');
    return LOCAL_ONLY_SUBS.filter((sub) => {
      if (typeof marks[sub] !== 'number') return false;
      try { return meaningful(sub, JSON.parse(ls.getItem('tr_u' + pid + '_' + sub))); } catch (e) { return false; }
    });
  }
  /* 這台的舊網址有沒有要搬的(訪客資料、本機學生、還沒上傳的雲端帳號項目)。只讀,給每一頁的 js/move-out.js 用 */
  function hasData(ls) {
    const ids = profileIdsOf(ls.getItem('tr_profiles'));
    if (ids.size) return true;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (typeof k !== 'string') continue;
      if (/^tr_unsynced_/.test(k)) { try { const o = JSON.parse(ls.getItem(k)); if (isPlain(o) && Object.keys(o).length) return true; } catch (e) { /* 壞掉的帳本不算 */ } continue; }
      const lo = LOCAL_ONLY.exec(k);
      if (lo) { if (localOnlySubs(ls, lo[1]).length) return true; continue; }
      const c = classify(k, ids);
      if (c.kind !== 'guest' && c.kind !== 'profile') continue;
      try { if (meaningful(c.sub, JSON.parse(ls.getItem(k)))) return true; } catch (e) { /* 讀不懂的不算 */ }
    }
    return false;
  }

  /* 這台要搬的資料的指紋(搬家計畫 2.11):寄出頁準備搬家時算一次存進 tr_move_done,之後舊網址每一頁再算一次,
     不一樣就是搬完之後又有新的進度(在舊網址練習、新網址連不上時、退回期間),要再搬一次,不能直接帶走。
     算進去的:訪客資料、本機學生的資料、學生名單、帳本(tr_unsynced_,還沒上傳的帳號進度)、只在本機的標記(tr_localonly_)。
     不算的:目前選哪個學生、提示次數、登入資料、搬家自己的紀錄、雲端帳號資料夾(從雲端來的,登入在新網址就回來)。
     依鍵名排好,每一項的鍵與原字串都算(FNV-1a 32 位元,加上項數與總長度),同長度的改動也看得出來。只讀。 */
  function fingerprint(ls) {
    const ids = profileIdsOf(ls.getItem('tr_profiles'));
    const keys = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (typeof k !== 'string') continue;
      if (/^tr_unsynced_/.test(k) || LOCAL_ONLY.test(k) || k === 'tr_profiles') { keys.push(k); continue; }
      const c = classify(k, ids);
      if (c.kind === 'guest' || c.kind === 'profile') keys.push(k);
    }
    keys.sort();
    let h = 0x811c9dc5, len = 0;
    const eat = (s) => {
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
      len += s.length;
    };
    keys.forEach((k) => { const v = ls.getItem(k); eat(k); eat('\u0000'); eat(v === null ? '' : String(v)); eat('\u0001'); });
    return 'f1:' + keys.length + ':' + len + ':' + h.toString(16);
  }

  root.MOVE_RULES = Object.freeze({ EXACT, FAMILIES, GLOBAL, LIMITS, UUID, PID, DEVICE, LOCAL_ONLY, ruleOf, classify, profileIdsOf, cleanProfiles, validate, meaningful, localOnlySubs, hasData, fingerprint });
})(typeof globalThis !== 'undefined' ? globalThis : this);
