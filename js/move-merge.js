/* 衝衝英文搬家:新網址已經有資料時怎麼合併(搬家計畫 2.4)。純計算,不讀寫儲存。
   原則:依每個鍵資料的形狀合併,寧可多留,不可少掉。真正只有一個值的設定才問人(conflicts),預設留新網址的。
   - 題庫(vgame_banks):用 id 合併,任何一個題庫都不會少;同 id 內容不同就改一個新 id、名稱加「（舊網址）」,
     並把 vgame_best、vgame_clear、vgame_pairs_best、vgame_toast_best、vgame_done 裡 bank:<舊 id> 那幾項
     與指到它的 vgame_src 一起複製到 bank:<新 id>(js/vocab.js 用 bank:<id> 對應題庫)。
     新版頁面寫的題庫有同步的戳記(js/sync-merge.js:_r、_t、_p…,每改一次就變):只差戳記、看得到的內容一樣(名稱、字、中文、勾選、alt)
     就當成同一份;一份的 _p 記著另一份(另一份是它的舊版本)就用新的那份(舊網址的比較新:換成 SYNC_MERGE 合併的結果,原值先備份)。
     只有兩邊都真的改了才另存「（舊網址）」(同步合併設計 3.12:兩個網域沒有共同的同步紀錄,一次搬完就結束)。
   - 刪除標記(sync_del,只有雲端帳號的資料夾會寫):兩份聯集(SYNC_MERGE.tombs),不整份換掉、不問。
   - 雲端帳號還沒上傳的(暫存區 tr_move_pending_<帳號 id>):同一個帳號又搬來一包時,題庫、刪除標記、模擬考紀錄兩包用 SYNC_MERGE 合併
     (js/cloud.js 的 MERGED 表上的鍵;登入時 cloud.js takePending 也用同一套跟本機、雲端合併),其他鍵照舊留時間比較晚的那包。
   - 寫作(writing_b、writing_e、writing_y)同一題兩邊寫的不一樣:updatedAt 比較新的那份放原位,另一份放進那一題的 alt(陣列),兩份都留;
     文章單字(vocab_)同一格兩邊填的不一樣:留新網址的,舊網址那份放進 alt。js/writing.js、js/reading.js 會把 alt 顯示出來。
   - 錯題本(drill_p、listen_p、phrase_drill、verb_quiz)同一題兩邊都有:留時間(t)比較新的那份(錯題本看最後一次作答);單字錯題 vgame_miss 的次數取大的。
   - 閱讀題作答(read_q_)是選項編號:新網址答過的題目不換,只補沒答的;答案不一樣的算「留這台的」,計數(dropped)並列在確認畫面。
   - 其他完成紀錄合併時兩邊不一樣、又沒辦法合的,也算 dropped。只有 dropped 是 0,確認畫面才說「不會少」。
   - 重搬:同一包(hash 一樣)什麼都不寫;改過 id 的對照記在 tr_move_log,重搬用同一個新 id。
     題庫另外記這台上次送的每個題庫的雜湊與它落在哪(bankSent):舊網址那份之後沒改過、落腳的題庫還在,就跳過,不再另存「（舊網址）」。
     tr_move_log 依「舊網址的網域#寄出那台的裝置編號」分開記(js/move-pack.js deviceId):
     「上次搬家寫的、新網址之後沒動過就直接換新」只對同一台裝置再搬有效,別台搬來的不同值列為衝突。沒有裝置編號的包不走這條捷徑。
   - 新網址算不算已經有資料(要不要問「切換到舊網址的學生檔案」):用 MOVE_RULES.meaningful,頁面自己建的空小雞不算。
   - 小雞用 PET.cloudMerge,每日練習用 DAILY.merge;呼叫的人沒給(或小雞的時鐘對不上)就列為衝突、留新網址的。
   依賴 js/move-rules.js(MOVE_RULES);題庫的戳記、刪除標記、暫存區的合併用 js/sync-merge.js(SYNC_MERGE,頁面要在這個檔之前載入;
   沒載到時題庫照舊另存「（舊網址）」、刪除標記列為衝突留新網址的、暫存區留時間晚的,只會多,不會少)。 */
(function (root) {
  'use strict';
  const R = root.MOVE_RULES;
  const sync = () => (root.SYNC_MERGE && typeof root.SYNC_MERGE.banks === 'function' ? root.SYNC_MERGE : null);
  const HIST_MAX = 1500, HIST_DAYS = 60, MOCK_MAX = 30, DONE_MAX = 300;   // 跟 js/common.js、js/mock.js、js/vocab.js 一樣
  const SUFFIX = '（舊網址）';
  const BANK_KEYS = ['vgame_best', 'vgame_clear', 'vgame_pairs_best', 'vgame_toast_best', 'vgame_done'];
  const LABELS = {
    hist: '練習紀錄', mock_history: '模擬考紀錄', pet: '小雞', daily_done: '每日練習', vgame_banks: '自訂單字題庫', sync_del: '自訂題庫的刪除紀錄',
    vgame_best: '單字遊戲最佳分數', vgame_toast_best: '單字快問快答最佳', vgame_pairs_best: '翻牌配對最佳', vgame_clear: '單字遊戲通關',
    vgame_done: '單字遊戲出過的字', vgame_miss: '單字錯題', phrase_drill: '片語錯題', verb_quiz: '不規則動詞紀錄',
    grammar_done: '文法完成紀錄', phonics_done: '自然發音完成紀錄', dlg_heard: '對話聽過的句子',
    writing_read: '寫作讀過的課', writing_s: '寫作句型', writing_b: '寫作造句', writing_e: '寫作回信', writing_y: '寫作論述',
    ear_s: '句子跟讀', ear_d: '句子聽寫', ear_mp: '相似音辨析', ear_n: '數字與價格', diag: '程度檢測', ph_slow: '自然發音慢速',
    vgame_src: '單字遊戲上次的題目來源', profiles: '學生名單', current_profile: '目前的學生檔案', pet_hint: '小雞提示次數',
  };

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  function canon(x) {
    if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
    return JSON.stringify(x === undefined ? null : x);
  }
  /* 同步的短雜湊(cyrb53):只用來認「這個值是不是搬家寫的、之後有沒有被改過」,不拿來防偽 */
  function quickHash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function parse(raw) { try { return { ok: true, v: JSON.parse(raw) }; } catch (e) { return { ok: false }; } }
  function labelOf(sub) {
    if (own(LABELS, sub)) return LABELS[sub];
    if (/^drill_p/.test(sub)) return '刷題錯題本（Part ' + sub.slice(7) + '）';
    if (/^listen_p/.test(sub)) return '聽力錯題本（Part ' + sub.slice(8) + '）';
    if (/^read_q_/.test(sub)) return '閱讀題作答';
    if (/^read_tq_/.test(sub)) return '閱讀單字考題成績';
    if (/^vocab_/.test(sub)) return '文章單字';
    return sub;
  }

  /* ---------- 各種形狀的合併:a 是新網址的、b 是舊網址的,都已經解析過 ---------- */
  function unionArray(a, b) {
    const seen = new Set(a.map(canon));
    const out = a.slice();
    b.forEach((x) => { const c = canon(x); if (!seen.has(c)) { seen.add(c); out.push(x); } });
    if (out.every(isNum)) out.sort((x, y) => x - y);
    return out;
  }
  /* 聯集一個值;沒辦法合、兩邊又不一樣時留新網址的(a),lost 設 true */
  function unionVal(a, b) {
    if (canon(a) === canon(b)) return { v: a, lost: false };
    if (Array.isArray(a) && Array.isArray(b)) return { v: unionArray(a, b), lost: false };
    if (typeof a === 'boolean' && typeof b === 'boolean') return { v: a || b, lost: false };
    if (isNum(a) && isNum(b)) return { v: Math.max(a, b), lost: false };
    if (isPlain(a) && isPlain(b)) {
      /* 文法、自然發音的小考 { ok: 答對數, t: 題數 }:同一份小考取答對多的 */
      if (isNum(a.ok) && isNum(b.ok) && isNum(a.t) && a.t === b.t) return { v: b.ok > a.ok ? b : a, lost: false };
      /* 聽力練習 { ok: 對不對, ... }:一邊完成一邊沒有,取完成的 */
      if (typeof a.ok === 'boolean' && typeof b.ok === 'boolean' && a.ok !== b.ok) return { v: a.ok ? a : b, lost: false };
      if (isNum(a.t) && isNum(b.t)) return { v: b.t > a.t ? b : a, lost: false };
    }
    return { v: a, lost: true };
  }
  function valueUnion(a, b) { return unionVal(a, b).v; }
  /* idmap、answers、texts、fills 回 { v, dropped, kept }:dropped 是舊網址那份沒留下來的項目數,kept 是兩份都留的項目數 */
  function idmapR(a, b, sub) {
    if (!isPlain(a) || !isPlain(b)) return null;
    const out = Object.assign({}, a);
    let dropped = 0;
    Object.keys(b).forEach((id) => {
      if (!own(out, id)) out[id] = b[id];
      else {
        const u = unionVal(out[id], b[id]);
        let v = u.v;
        if (u.lost) dropped++;
        if (sub === 'vgame_done' && Array.isArray(v) && v.length > DONE_MAX) v = v.slice(-DONE_MAX);
        out[id] = v;
      }
    });
    return { v: out, dropped, kept: 0 };
  }
  function idmap(a, b, sub) { const r = idmapR(a, b, sub); return r && r.v; }
  /* 閱讀題作答 { 題號: 選項編號 }:新網址答過的不換,只補沒答的 */
  function answers(a, b) {
    if (!isPlain(a) || !isPlain(b)) return null;
    const out = Object.assign({}, a);
    let dropped = 0;
    Object.keys(b).forEach((qi) => {
      if (!own(out, qi)) out[qi] = b[qi];
      else if (canon(out[qi]) !== canon(b[qi])) dropped++;
    });
    return { v: out, dropped, kept: 0 };
  }
  /* 寫作 { 題號: { text, p0.., updatedAt, alt: [另一份 { text, p0.., updatedAt }] } } */
  const TEXT_META = { updatedAt: 1, alt: 1 };
  const tidy = (x) => String(x == null ? '' : x).trim();
  function textFields(x) { return isPlain(x) ? Object.keys(x).filter((k) => !own(TEXT_META, k) && typeof x[k] === 'string') : []; }
  function timeOf(x) { const t = isPlain(x) && typeof x.updatedAt === 'string' ? Date.parse(x.updatedAt) : NaN; return isFinite(t) ? t : -Infinity; }
  function altsOf(x) { return isPlain(x) && Array.isArray(x.alt) ? x.alt.filter(isPlain) : []; }
  function onlyText(x) { const o = {}; textFields(x).forEach((k) => { if (tidy(x[k])) o[k] = x[k]; }); if (isPlain(x) && typeof x.updatedAt === 'string') o.updatedAt = x.updatedAt; return o; }
  function textItem(a, b) {
    if (!isPlain(a) || !isPlain(b)) { const u = unionVal(a, b); return { v: u.v, dropped: u.lost ? 1 : 0, kept: 0 }; }
    const first = timeOf(b) > timeOf(a) ? b : a, other = first === a ? b : a;
    const out = Object.assign({}, first);
    delete out.alt;
    let differs = false;
    textFields(other).forEach((k) => {
      if (!tidy(other[k])) return;
      if (!tidy(out[k])) out[k] = other[k];   // 原位那份沒寫的欄位:直接補上
      else if (tidy(out[k]) !== tidy(other[k])) differs = true;
    });
    const cand = (differs ? [onlyText(other)] : []).concat(altsOf(first), altsOf(other));
    const alts = [], seen = new Set();
    cand.forEach((x) => {
      const o = onlyText(x);
      const ks = textFields(o).filter((k) => tidy(o[k]) !== tidy(out[k]));
      if (!ks.length) return;   // 跟原位那份一模一樣:不另外留
      const c = canon(textFields(o).map((k) => [k, tidy(o[k])]));
      if (seen.has(c)) return;
      seen.add(c); alts.push(o);
    });
    if (alts.length) out.alt = alts;
    return { v: out, dropped: 0, kept: differs ? 1 : 0 };
  }
  function texts(a, b) {
    if (!isPlain(a) || !isPlain(b)) return null;
    const out = Object.assign({}, a);
    let kept = 0, dropped = 0;
    Object.keys(b).forEach((id) => {
      if (!own(out, id)) { out[id] = b[id]; return; }
      if (canon(out[id]) === canon(b[id])) return;
      const r = textItem(out[id], b[id]);
      out[id] = r.v; kept += r.kept; dropped += r.dropped;
    });
    return { v: out, dropped, kept };
  }
  /* 文章單字 { 格子: { t: 填的字(舊格式是 null), alt: [另一份] } } */
  function fills(a, b) {
    if (!isPlain(a) || !isPlain(b)) return null;
    const out = Object.assign({}, a);
    let kept = 0, dropped = 0;
    const norm = (x) => tidy(x).toLowerCase();
    const strs = (x) => (isPlain(x) ? [x.t].concat(Array.isArray(x.alt) ? x.alt : []) : []).filter((t) => typeof t === 'string' && tidy(t));
    Object.keys(b).forEach((id) => {
      if (!own(out, id)) { out[id] = b[id]; return; }
      const x = out[id], y = b[id];
      if (canon(x) === canon(y)) return;
      if (!isPlain(x) || !isPlain(y)) { const u = unionVal(x, y); out[id] = u.v; if (u.lost) dropped++; return; }
      const main = typeof x.t === 'string' && tidy(x.t) ? x.t : (typeof y.t === 'string' && tidy(y.t) ? y.t : x.t);
      const alt = [];
      strs(x).concat(strs(y)).forEach((t) => { if (norm(t) !== norm(main) && !alt.some((z) => norm(z) === norm(t))) alt.push(t); });
      const v = Object.assign({}, x, { t: main });
      delete v.alt;
      if (alt.length) v.alt = alt;
      const xs = strs(x).map(norm);
      if (xs.length && strs(y).some((t) => xs.indexOf(norm(t)) < 0)) kept++;   // 這台本來就有填、舊網址填的是別的:兩份都留
      out[id] = v;
    });
    return { v: out, dropped, kept };
  }
  /* 錯題本 { 題目 id: { c: 選的, ok: 對不對, t: 時間 } }(刷題、聽力、片語、不規則動詞),錯題本看的是最後一次作答:
     同一題兩邊都有,留 t 比較新的那份;單字錯題 vgame_miss 是 { 字: 漏接次數 },取大的。
     兩邊不一樣又沒辦法比的(沒有時間、時間一樣),留新網址的,算 dropped */
  function poolR(a, b) {
    if (!isPlain(a) || !isPlain(b)) return null;
    const out = Object.assign({}, a);
    let dropped = 0;
    Object.keys(b).forEach((id) => {
      if (!own(out, id)) { out[id] = b[id]; return; }
      const x = out[id], y = b[id];
      if (canon(x) === canon(y)) return;
      if (isNum(x) && isNum(y)) { out[id] = Math.max(x, y); return; }
      if (isPlain(x) && isPlain(y) && isNum(x.t) && isNum(y.t) && x.t !== y.t) { if (y.t > x.t) out[id] = y; return; }
      dropped++;
    });
    return { v: out, dropped, kept: 0 };
  }
  function pool(a, b) { const r = poolR(a, b); return r && r.v; }
  function best(a, b) {
    if (!isPlain(a) || !isPlain(b)) return null;
    const out = Object.assign({}, a);
    Object.keys(b).forEach((k) => {
      if (!own(out, k)) out[k] = b[k];
      else if (isNum(out[k]) && isNum(b[k])) out[k] = Math.max(out[k], b[k]);
    });
    return out;
  }
  /* 翻牌配對:{ moves, secs } 步數少的好,一樣就秒數少的(js/vocab.js 的 isBest) */
  function pairsBest(a, b) {
    if (!isPlain(a) || !isPlain(b)) return null;
    const out = Object.assign({}, a);
    const okRec = (r) => isPlain(r) && isNum(r.moves) && isNum(r.secs);
    Object.keys(b).forEach((k) => {
      if (!own(out, k)) out[k] = b[k];
      else if (okRec(out[k]) && okRec(b[k]) && (b[k].moves < out[k].moves || (b[k].moves === out[k].moves && b[k].secs < out[k].secs))) out[k] = b[k];
    });
    return out;
  }
  /* 通關:{ n: 次數, secs: 最快秒數 } 次數取大、最快取小 */
  function clear(a, b) {
    if (!isPlain(a) || !isPlain(b)) return null;
    const out = Object.assign({}, a);
    const okRec = (r) => isPlain(r) && isNum(r.n) && isNum(r.secs);
    Object.keys(b).forEach((k) => {
      if (!own(out, k)) { out[k] = b[k]; return; }
      const x = out[k], y = b[k];
      if (!okRec(x) || !okRec(y)) return;
      const fast = [x, y].filter((r) => r.n > 0 && r.secs > 0).map((r) => r.secs);
      out[k] = { n: Math.max(x.n, y.n), secs: fast.length ? Math.min.apply(null, fast) : Math.max(x.secs, y.secs) };
    });
    return out;
  }
  function hist(a, b, now) {
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    const id = (r) => (isPlain(r) ? [r.t, r.m, r.id, r.c].map((x) => JSON.stringify(x === undefined ? null : x)).join('|') : canon(r));
    const seen = new Set(a.map(id));
    const all = a.slice();
    b.forEach((r) => { const k = id(r); if (!seen.has(k)) { seen.add(k); all.push(r); } });
    const t = (r) => (isPlain(r) && isNum(r.t) ? r.t : 0);
    const sorted = all.map((r, i) => [r, i]).sort((x, y) => t(x[0]) - t(y[0]) || x[1] - y[1]).map((x) => x[0]);
    const cutoff = now - HIST_DAYS * 864e5;
    const kept = sorted.filter((r) => !(isPlain(r) && isNum(r.t) && r.t) || r.t >= cutoff);
    return kept.length > HIST_MAX ? kept.slice(kept.length - HIST_MAX) : kept;
  }
  function mock(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    const id = (r) => (isPlain(r) ? canon([r.d, r.size, r.lRaw, r.rRaw, r.lScore, r.rScore]) : canon(r));
    const seen = new Set(a.map(id));
    const all = a.slice();
    b.forEach((r) => { const k = id(r); if (!seen.has(k)) { seen.add(k); all.push(r); } });
    const d = (r) => (isPlain(r) && typeof r.d === 'string' ? r.d : '');
    const sorted = all.map((r, i) => [r, i]).sort((x, y) => (d(x[0]) < d(y[0]) ? -1 : d(x[0]) > d(y[0]) ? 1 : x[1] - y[1])).map((x) => x[0]);
    return sorted.slice(-MOCK_MAX);
  }
  /* 學生名單:用編號合併,同編號留新網址那筆。舊網址那邊只收編號是本機學生格式(R.PID)、名字是字串的,重複的只收第一筆 */
  function profiles(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    const ids = new Set(a.filter(isPlain).map((p) => p.id));
    const add = [];
    b.forEach((p) => {
      if (!isPlain(p) || typeof p.id !== 'string' || !R.PID.test(p.id) || typeof p.name !== 'string' || ids.has(p.id)) return;
      ids.add(p.id); add.push(p);
    });
    return a.concat(add);
  }

  /* 一個鍵。nv、ov 是解析過的值。回 { v, kind }:kind 是 merged(合併後跟新網址的不同)、same、conflict(留新網址的、要列出來) */
  function mergeOne(rule, sub, nv, ov, ctx) {
    if (canon(nv) === canon(ov)) return { v: nv, kind: 'same' };
    let v = null;
    switch (rule) {
      case 'hist': v = hist(nv, ov, ctx.now); break;
      case 'mock': v = mock(nv, ov); break;
      case 'idmap': case 'answers': case 'texts': case 'fills': case 'pool': {
        const r = rule === 'idmap' ? idmapR(nv, ov, sub) : rule === 'answers' ? answers(nv, ov) : rule === 'texts' ? texts(nv, ov) : rule === 'pool' ? poolR(nv, ov) : fills(nv, ov);
        if (!r) return { v: nv, kind: 'conflict', why: 'shape' };
        const extra = { dropped: r.dropped, kept: r.kept };
        return Object.assign(canon(r.v) === canon(nv) ? { v: nv, kind: 'same' } : { v: r.v, kind: 'merged' }, extra);
      }
      case 'best': v = best(nv, ov); break;
      case 'pairsBest': v = pairsBest(nv, ov); break;
      case 'clear': v = clear(nv, ov); break;
      case 'profiles': v = profiles(nv, ov); break;
      case 'fillMissing': return { v: nv, kind: 'same' };
      case 'pet': {
        const P = ctx.pet;
        if (!P || typeof P.cloudMerge !== 'function') return { v: nv, kind: 'conflict', why: 'pet' };
        if (!ctx.petClockOk) return { v: nv, kind: 'conflict', why: 'clock' };
        let m = null;
        try { m = P.cloudMerge(nv, ov, ctx.now); } catch (e) { m = null; }
        if (!m || m.ok !== true) return { v: nv, kind: 'conflict', why: 'pet' };
        return m.sameAsLocal ? { v: nv, kind: 'same' } : { v: m.v, kind: 'merged' };
      }
      case 'tombs': {   // 刪除標記:兩份聯集(js/sync-merge.js),認不得就留新網址的(只會讓刪掉的回來,不會少)
        const S = sync();
        let m = null;
        try { m = S ? S.tombs(nv, ov, ctx.now) : null; } catch (e) { m = null; }
        if (!m || m.ok !== true) return { v: nv, kind: 'conflict', why: 'tombs' };
        return m.sameAsLocal ? { v: nv, kind: 'same' } : { v: m.v, kind: 'merged' };
      }
      case 'daily': {
        const D = ctx.daily;
        if (!D || typeof D.merge !== 'function') return { v: nv, kind: 'conflict', why: 'daily' };
        let m;
        try { m = D.merge(nv, ov, D.dateOf(ctx.now)); } catch (e) { return { v: nv, kind: 'conflict', why: 'daily' }; }
        return canon(m) === canon(nv) ? { v: nv, kind: 'same' } : { v: m, kind: 'merged' };
      }
      default: return { v: nv, kind: 'conflict', why: 'single' };
    }
    if (v === null) return { v: nv, kind: 'conflict', why: 'shape' };
    return canon(v) === canon(nv) ? { v: nv, kind: 'same' } : { v, kind: 'merged' };
  }

  /* ---------- 題庫 ---------- */
  function bankId(b) { return isPlain(b) && typeof b.id === 'string' ? b.id : null; }
  function bankBody(b) { return canon(isPlain(b) ? b.words : null); }
  /* 題庫看得到的樣子:名稱、每個字的英文、中文、勾選、alt(另一台寫的),不看同步的戳記(_r、_t、_p、_nl、_m…)與字的順序 */
  function bankLook(b) {
    if (!isPlain(b)) return canon(b);
    const word = (w) => (isPlain(w) && typeof w.en === 'string'
      ? canon({ en: w.en, zh: w.zh === undefined ? null : w.zh, on: w.on !== false, alt: Array.isArray(w.alt) ? w.alt.slice().sort() : [] }) : canon(w));
    return canon({ n: b.name === undefined ? null : b.name, w: Array.isArray(b.words) ? b.words.map(word).sort() : canon(b.words) });
  }
  /* 戳記看得出先後嗎(js/sync-merge.js 的 _p:新版本記著它吸收過的舊版本的內容雜湊):
     'new' 新網址那份是從舊網址這份改過來的、'old' 反過來、'' 看不出來(沒有戳記、或兩邊都改了) */
  const pHas = (b, h) => isPlain(b) && Array.isArray(b._p) && b._p.some((e) => typeof e === 'string' && e.split('.')[0] === h);
  function stampOrder(nb, ob) {
    const S = sync();
    if (!S) return '';
    let hn, ho;
    try { hn = S.bankHash(nb); ho = S.bankHash(ob); } catch (e) { return ''; }
    const n2o = pHas(nb, ho), o2n = pHas(ob, hn);
    return n2o === o2n ? '' : (n2o ? 'new' : 'old');
  }
  /* 舊網址那份比較新:用 SYNC_MERGE 合併(分不出的名稱、勾選偏舊網址那份),結果包含新網址那份的版本紀錄;合併不了回 null。
     both:兩邊都改過(看不出誰新),不偏哪一份,照同步的規則(名稱看得出誰從誰改的就用改過的,不然用時間晚的) */
  function joinNewer(nb, ob, now, both) {
    const S = sync();
    let m = null;
    try { m = S ? S.banks([nb], [ob], both ? { now } : { now, localClean: true }) : null; } catch (e) { m = null; }
    const v = m && m.ok === true && Array.isArray(m.v) ? m.v.filter((b) => bankId(b) === bankId(ob)) : [];
    return v.length === 1 ? v[0] : null;
  }
  /* 舊網址的題庫併進新網址的。回 { banks, remap: { 舊 id: 新 id }, added, renamed, updated, skipped, written, replaced, sent } 或 null(新網址那份不是陣列)。
     replaced:有沒有換掉新網址原本的某個題庫(搬家寫過、之後沒改過的換成舊網址的新版),寫入時要先備份。
     sent:{ '資料夾|舊 id': { h: 這次送來的那份的雜湊, to: 它落在新網址哪個題庫(id) } },plan 記進 tr_move_log(依裝置分開)。
     同一台再搬、舊網址那份的雜湊跟上次送的一樣(之後沒改過)、上次落腳的題庫還在:舊網址這份沒有新東西,跳過。
     新網址之後怎麼改都一樣(不靠 _p:它最多記 8 個舊版本,改 9 次以上就認不出來);落腳的題庫被刪了就照舊再放(寧可多留) */
  function mergeBanks(nb, ob, folder, prev, ctx) {
    if (!Array.isArray(nb) || !Array.isArray(ob)) return null;
    const out = nb.slice();
    const remap = {}, added = [], renamed = [], updated = [], keep = [], sent = {};
    const sentPrev = isPlain(prev.bankSent) ? prev.bankSent : {};
    const note = (id, b, to) => { if (typeof to === 'string') sent[folder + '|' + id] = { h: quickHash(canon(b)), to }; };
    const bodyAt = (body) => { const x = out.find((y) => bankBody(y) === body); return x ? bankId(x) : null; };
    const unchanged = (id, b) => {   // 上次這台送的就是這份、它落腳的題庫還在
      const s = sentPrev[folder + '|' + id];
      return isPlain(s) && typeof s.to === 'string' && s.h === quickHash(canon(b)) && out.some((x) => bankId(x) === s.to);
    };
    let skipped = 0, n = 0, replaced = false;
    const ids = () => new Set(out.map(bankId));
    /* 別的題庫已經有一模一樣的字(連戳記)。沒有字的題庫不算:每個空題庫的字都一樣,以前舊網址新建、還沒加字的題庫(和它的名稱)會因為新網址有別的空題庫就沒搬過去 */
    const hasBody = (body) => body !== '[]' && body !== 'null' && out.some((b) => bankBody(b) === body);
    const freshId = () => {
      const have = ids();
      let id;
      do { id = 'b' + Math.floor(ctx.now).toString(36) + 'm' + (n++).toString(36); } while (have.has(id));
      return id;
    };
    const hashes = prev.bankHashes || {};
    const wroteBy = (b) => hashes[bankId(b)] === quickHash(canon(b));   // 新網址這個題庫是搬家寫的,之後沒改過
    ob.forEach((b) => {
      const id = bankId(b);
      if (id === null) return;
      const body = bankBody(b);
      const at0 = out.findIndex((x) => bankId(x) === id);
      if (at0 < 0) {
        if (hasBody(body)) { skipped++; note(id, b, bodyAt(body)); return; }
        out.push(b); added.push(String(b.name || '')); keep.push(id); note(id, b, id); return;
      }
      const same = out[at0];
      /* 這台上次送的就是這份(舊網址之後沒改過),落腳的題庫還在:新網址之後的修改都比它新,不再另存 */
      if (unchanged(id, b)) { skipped++; sent[folder + '|' + id] = sentPrev[folder + '|' + id]; return; }
      const name = String(b.name || '');
      const copyName = name.slice(-SUFFIX.length) === SUFFIX ? name : name + SUFFIX;
      const was = prev.bankIds && prev.bankIds[folder + '|' + id];   // 上次另存的「（舊網址）」那份
      const at = was ? out.findIndex((x) => bankId(x) === was) : -1;
      /* 舊網址只改了名、字一模一樣(第三輪審查:以前看到「這些字新網址已經有了」就跳過,改的名稱不會過去)。字一樣的只有:
         nameOnly:同一個 id 的這份(或沒有字);copyRenamed:上次另存的「（舊網址）」那份,搬家寫的、之後沒動過。交給下面判斷 */
      const twins = hasBody(body) ? out.reduce((a, x, i) => (bankBody(x) === body ? a.concat(i) : a), []) : [];
      const nameOnly = bankBody(same) === body && same.name !== b.name && twins.every((i) => i === at0);
      const copyRenamed = !nameOnly && at > -1 && twins.length === 1 && twins[0] === at && wroteBy(out[at]) && out[at].name !== copyName;
      /* 只差同步的戳記(看得到的都一樣)、或新網址那份是從舊網址這份改過來的:舊網址這份沒有新東西 */
      if (canon(same) === canon(b) || (hasBody(body) && !nameOnly && !copyRenamed) || bankLook(same) === bankLook(b) || stampOrder(same, b) === 'new') { skipped++; note(id, b, hasBody(body) ? bodyAt(body) : id); return; }
      if (wroteBy(same)) { out[at0] = b; updated.push(String(b.name || '')); keep.push(id); replaced = true; note(id, b, id); return; }   // 舊網址後來改過、新網址沒動:換成舊網址的新版
      if (stampOrder(same, b) === 'old') {   // 舊網址那份是從新網址這份改過來的(戳記看得出來):換成合併後的新版,新網址原本那份寫入前備份
        const j = joinNewer(same, b, ctx.now);
        if (j) { out[at0] = j; updated.push(String(j.name || '')); keep.push(id); replaced = true; note(id, b, id); return; }
      }
      /* 字一樣、兩邊都動過(例如兩邊刪了同一個字、只有舊網址改了名):不為了名稱多複製一整份題庫;
         名稱照同步的規則(只有舊網址改名就用舊網址的,兩邊都改了用時間晚的),換掉時新網址原本那份寫入前備份 */
      if (nameOnly) {
        const j = joinNewer(same, b, ctx.now, true);
        if (j && j.name !== same.name) { out[at0] = j; updated.push(String(j.name || '')); keep.push(id); replaced = true; note(id, b, id); return; }
        skipped++; note(id, b, id); return;
      }
      const copy = Object.assign({}, b, { name: copyName });
      if (at > -1 && wroteBy(out[at])) { out[at] = Object.assign(copy, { id: was }); remap[id] = was; renamed.push(copy.name); keep.push(was); replaced = true; note(id, b, was); return; }
      const nid = was && at < 0 ? was : freshId();
      out.push(Object.assign(copy, { id: nid }));
      remap[id] = nid;
      renamed.push(copy.name);
      keep.push(nid);
      note(id, b, nid);
    });
    const written = {};
    out.forEach((x) => { if (keep.indexOf(bankId(x)) > -1) written[bankId(x)] = quickHash(canon(x)); });
    return { banks: out, remap, added, renamed, updated, skipped, written, replaced, sent };
  }
  /* 改過 id 的題庫:舊網址那幾個成績鍵裡 bank:<舊 id> 的項目複製一份到 bank:<新 id> */
  function remapRelated(sub, ov, remap) {
    const olds = Object.keys(remap);
    if (!olds.length) return ov;
    if (sub === 'vgame_src') {
      if (!isPlain(ov) || typeof ov.mode !== 'string') return ov;
      const m = /^bank:(.+)$/.exec(ov.mode);
      return m && own(remap, m[1]) ? Object.assign({}, ov, { mode: 'bank:' + remap[m[1]] }) : ov;
    }
    if (!isPlain(ov)) return ov;
    const out = Object.assign({}, ov);
    Object.keys(ov).forEach((k) => {
      olds.forEach((o) => {
        const head = 'bank:' + o;
        if (k === head || k.indexOf(head + ':') === 0) {
          const nk = 'bank:' + remap[o] + k.slice(head.length);
          if (!own(out, nk)) out[nk] = ov[k];
        }
      });
    });
    return out;
  }

  /* ---------- 整包 ----------
     valid:MOVE_RULES.validate 的結果。target:{ get(鍵) → 原字串或 null, keys: 新網址現在全部的鍵 }。
     ctx:{ now, from, hash, pet, petClockOk, daily, log(解析過的 tr_move_log,沒有就 {}), choices: { 鍵: 'old' },
       skip(這次先不搬的鍵:空間不夠時 js/move-apply.js pickFit 挑出來的), unfinished(這次不算搬完,例如選了「用舊網址的」卻沒換成) };
     寄出那台的裝置編號在 valid.device。
     回 { already, writes: [[鍵, 原字串, 種類]], items, conflicts, counts, banks, pending, dropped: [{ key, label, n }], kept: [{ key, label, n }], skipped: [{ key, label }] }
     種類給 js/move-apply.js:grow 是合併(結果包含新網址原本的東西),replace 是換掉新網址原本的值;新網址沒有的鍵寫入時自己會當成 add。
     counts.dropped:舊網址那份沒留下來、也沒列成衝突的項目數(確認畫面要明講);counts.keptBoth:兩份都留的寫作題與單字格數。
     有 skip 或 unfinished 時,tr_move_log 這次不記雜湊:同一包再搬一次不會被當成「已經搬過」,沒搬的、沒換的會再出現。 */
  function plan(valid, target, ctx) {
    const log = isPlain(ctx.log) ? ctx.log : {};
    const device = typeof valid.device === 'string' ? valid.device : '';
    const logKey = ctx.from + '#' + device;
    const prev = device && isPlain(log[logKey]) ? log[logKey] : {};   // 沒有裝置編號:不知道是不是同一台,不用上次的紀錄
    const res = { already: false, writes: [], items: [], conflicts: [], counts: { added: 0, merged: 0, same: 0, conflicts: 0, updated: 0, dropped: 0, keptBoth: 0 },
      banks: { added: [], renamed: [], skipped: 0 }, pending: 0, dropped: [], kept: [], skipped: [] };
    if (prev.hash && prev.hash === ctx.hash) { res.already = true; return res; }
    const choices = isPlain(ctx.choices) ? ctx.choices : {};
    const wrote = {}, bankIds = Object.assign({}, prev.bankIds || {}), bankHashes = Object.assign({}, prev.bankHashes || {});
    const bankSent = Object.assign({}, isPlain(prev.bankSent) ? prev.bankSent : {});   // 這台每個題庫上次送的那份落在哪(mergeBanks 的 sent)
    const writes = new Map(), modes = new Map();
    const put = (k, raw, mode) => { if (target.get(k) !== raw) { writes.set(k, raw); modes.set(k, mode || 'replace'); } };
    const skipSet = new Set(Array.isArray(ctx.skip) ? ctx.skip : []);
    const skip = (k, label) => { if (!skipSet.has(k)) return false; res.skipped.push({ key: k, label }); return true; };
    const conflict = (k, sub, why, choosable, extra) => {
      res.conflicts.push(Object.assign({ key: k, sub, label: labelOf(sub), why, choosable, choice: choices[k] === 'old' ? 'old' : 'new' }, extra || {}));
      res.counts.conflicts++;
    };
    /* 新網址算不算已經有資料:頁面自己建的空小雞、空陣列、提示次數、登入相關的鍵都不算(MOVE_RULES.meaningful);讀不懂的算 */
    const tIds = R.profileIdsOf(target.get('tr_profiles'));
    const hasData = tIds.size > 0 || target.keys.some((k) => {
      const c = R.classify(k, tIds);
      if (c.kind !== 'guest' && c.kind !== 'profile' && c.kind !== 'cloud') return false;
      const p = parse(target.get(k));
      return !p.ok || R.meaningful(c.sub, p.v);
    });

    /* 1. 題庫先做,算出改 id 的對照 */
    const remaps = {};
    valid.keys.forEach(([k, raw]) => {
      const c = R.classify(k, valid.profileIds);
      if (c.rule !== 'banks' || skip(k, labelOf(c.sub))) return;
      const folder = k.slice(0, k.length - c.sub.length);
      const ov = JSON.parse(raw);
      const cur = target.get(k);
      if (cur === null) {
        put(k, raw, 'add');
        res.counts.added++;
        res.items.push({ key: k, kind: 'added' });
        if (Array.isArray(ov)) ov.forEach((b) => {
          res.banks.added.push(String((b && b.name) || ''));
          if (bankId(b) === null) return;
          bankHashes[bankId(b)] = quickHash(canon(b));
          bankSent[folder + '|' + bankId(b)] = { h: quickHash(canon(b)), to: bankId(b) };
        });
        return;
      }
      const nv = parse(cur);
      const m = nv.ok ? mergeBanks(nv.v, ov, folder, prev, ctx) : null;
      if (!m) { conflict(k, c.sub, 'shape', false); return; }
      remaps[folder] = m.remap;
      Object.keys(m.remap).forEach((o) => { bankIds[folder + '|' + o] = m.remap[o]; });
      Object.assign(bankHashes, m.written);
      Object.assign(bankSent, m.sent);
      res.banks.added = res.banks.added.concat(m.added, m.updated);
      res.banks.renamed = res.banks.renamed.concat(m.renamed);
      res.banks.skipped += m.skipped;
      if (m.added.length || m.renamed.length || m.updated.length) { put(k, JSON.stringify(m.banks), m.replaced ? 'replace' : 'grow'); res.counts.merged++; res.items.push({ key: k, kind: 'merged' }); }
      else res.counts.same++;
    });

    /* 2. 其他鍵 */
    valid.keys.forEach(([k, raw]) => {
      const c = R.classify(k, valid.profileIds);
      if (c.rule === 'banks' || skip(k, labelOf(c.kind === 'global' ? c.sub.replace(/^tr_/, '') : c.sub))) return;
      const folder = k.slice(0, k.length - c.sub.length);
      let ov = JSON.parse(raw);
      let oraw = raw;
      if (c.kind !== 'global' && remaps[folder] && (BANK_KEYS.indexOf(c.sub) > -1 || c.sub === 'vgame_src')) {
        const moved = remapRelated(c.sub, ov, remaps[folder]);
        if (moved !== ov) { ov = moved; oraw = JSON.stringify(ov); }
      }
      const cur = target.get(k);
      if (c.rule === 'currentProfile') {
        const pid = typeof ov === 'string' ? ov : null;
        if (!pid || !valid.profileIds.has(pid)) return;   // 訪客、指到雲端帳號、不在名單裡:不抄
        if (!hasData) { put(k, oraw, 'replace'); res.counts.added++; return; }
        if (cur === oraw) { res.counts.same++; return; }
        if (choices[k] === 'old') put(k, oraw, 'replace');
        conflict(k, 'current_profile', 'profile', true, { oldName: nameOf(valid, pid) });
        return;
      }
      if (cur === null) {
        put(k, oraw, 'add');
        res.counts.added++;
        res.items.push({ key: k, kind: 'added' });
        if (c.rule === 'single') wrote[k] = quickHash(oraw);
        return;
      }
      const nv = parse(cur);
      if (!nv.ok) {   // 新網址那份壞掉了:不合併,問人
        if (choices[k] === 'old') put(k, oraw, 'replace');
        conflict(k, c.sub, 'broken', true);
        return;
      }
      if (c.rule === 'single' && prev.wrote && prev.wrote[k] === quickHash(oraw)) { res.counts.same++; return; }   // 舊網址這個值從上次搬家後沒變過:新網址後來改的比較新,不再問
      if (c.rule === 'single' && prev.wrote && prev.wrote[k] === quickHash(cur) && cur !== oraw) {
        put(k, oraw, 'replace'); wrote[k] = quickHash(oraw); res.counts.updated++; return;   // 上次搬家寫的、新網址之後沒動過:直接換成舊網址的新值
      }
      const m = mergeOne(c.rule, c.sub, nv.v, ov, ctx);
      if (m.dropped) { res.counts.dropped += m.dropped; res.dropped.push({ key: k, label: labelOf(c.sub), n: m.dropped }); }
      if (m.kept) { res.counts.keptBoth += m.kept; res.kept.push({ key: k, label: labelOf(c.sub), n: m.kept }); }
      if (m.kind === 'same') { res.counts.same++; return; }
      if (m.kind === 'merged') { put(k, JSON.stringify(m.v), 'grow'); res.counts.merged++; res.items.push({ key: k, kind: 'merged' }); return; }
      const choosable = m.why === 'single' || m.why === 'shape';
      if (choosable && choices[k] === 'old') { put(k, oraw, 'replace'); if (c.rule === 'single') wrote[k] = quickHash(oraw); }
      conflict(k, c.sub, m.why, choosable, { newText: preview(nv.v), oldText: preview(ov), newValue: nv.v, oldValue: ov });
    });

    /* 3. 雲端帳號還沒上傳的:放暫存區,登入那個帳號時才合併(搬家計畫 2.7) */
    valid.accounts.forEach((items, uid) => {
      const pk = 'tr_move_pending_' + uid;
      if (skip(pk, '帳號還沒上傳的進度')) return;
      const was = target.get(pk);
      const curP = was === null ? { ok: false } : parse(was);
      const have = curP.ok && isPlain(curP.v) && Array.isArray(curP.v.items) ? curP.v.items.filter((e) => Array.isArray(e) && e.length === 3 && typeof e[0] === 'string') : [];
      const bySub = new Map(have.map((e) => [e[0], e]));
      const joined = joinPending(bySub, items, ctx.now);   // 題庫、刪除標記、模擬考紀錄:兩包合併
      items.forEach((e) => {
        if (joined.has(e[0])) { bySub.set(e[0], joined.get(e[0])); return; }
        const h = bySub.get(e[0]);
        if (!h || !(h[2] > e[2])) bySub.set(e[0], e);   // 其他鍵:留時間比較晚的那包
      });
      const list = Array.from(bySub.values()).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
      if (canon(list) === canon(have)) return;
      put(pk, JSON.stringify({ from: ctx.from, at: ctx.now, items: list }), 'grow');
      res.pending++;
    });

    res.writes = Array.from(writes.entries()).map(([k, v]) => [k, v, modes.get(k)]);
    const done = !ctx.unfinished && !res.skipped.length;
    const entry = { hash: done ? ctx.hash : '', at: ctx.now, wrote: Object.assign({}, prev.wrote || {}, wrote), bankIds, bankHashes, bankSent };
    res.log = Object.assign({}, log, { [logKey]: entry });
    res.writes.push(['tr_move_log', JSON.stringify(res.log), 'replace']);
    return res;
  }
  /* 同一個帳號的暫存區已經有一包、又搬來一包(例如別台用搬家碼帶來的):js/cloud.js 的 MERGED 表上的鍵(題庫、刪除標記、模擬考紀錄)
     兩包用 SYNC_MERGE 合併,不是時間晚的整份換掉(另一包可能有這包沒有的題庫、標記、考試)。標記先合併,題庫用合併後的標記;
     分不出先後的名稱、勾選用時間晚的那包。讀不懂、合併不了的鍵不放進來(照原本的規則)。回 Map(鍵 → [鍵, 原字串, 兩包裡比較晚的時間]) */
  const SYNC_SUBS = ['sync_del', 'vgame_banks', 'mock_history'];
  function joinPending(have, items, now) {
    const out = new Map();
    const S = sync();
    if (!S) return out;
    const fresh = new Map(items.map((e) => [e[0], e]));
    const val = (e) => { if (!e) return null; const p = parse(e[1]); return p.ok ? p.v : undefined; };
    let T = null;
    try { const t = S.tombs(val(have.get('sync_del')), val(fresh.get('sync_del')), now); T = t && t.ok === true ? t.v : null; } catch (e) { T = null; }
    SYNC_SUBS.forEach((sub) => {
      const a = have.get(sub), b = fresh.get(sub);
      if (!a || !b) return;
      const va = val(a), vb = val(b);
      if (va === undefined || vb === undefined) return;
      const [older, newer] = a[2] > b[2] ? [vb, va] : [va, vb];
      let m = null;
      try {
        m = sub === 'sync_del' ? S.tombs(va, vb, now) : sub === 'vgame_banks' ? S.banks(older, newer, { now, tombs: T, localClean: true }) : S.mock(va, vb);
      } catch (e) { m = null; }
      if (!m || m.ok !== true || m.v === null) return;
      out.set(sub, [sub, JSON.stringify(m.v), Math.max(a[2], b[2])]);
    });
    return out;
  }
  function nameOf(valid, pid) {
    const e = valid.keys.filter((x) => x[0] === 'tr_profiles')[0];
    const list = e ? parse(e[1]).v : null;
    const p = Array.isArray(list) ? list.filter((x) => isPlain(x) && x.id === pid)[0] : null;
    return p && typeof p.name === 'string' ? p.name : '';
  }
  function preview(v) {
    let s;
    try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { s = ''; }
    s = String(s === undefined ? '' : s);
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  }

  root.MOVE_MERGE = Object.freeze({ canon, quickHash, labelOf, mergeOne, mergeBanks, remapRelated, plan, hist, mock, idmap, answers, texts, fills, pool, best, pairsBest, clear, profiles, valueUnion, SUFFIX });
})(typeof globalThis !== 'undefined' ? globalThis : this);
