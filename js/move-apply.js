/* 衝衝英文搬家:把算好的結果寫進新網址的 localStorage(搬家計畫 2.6)。
   要寫的每一項是 [鍵, 原字串, 種類](js/move-merge.js 的 plan 給的),種類:
     add      新網址本來沒有這個鍵;
     grow     合併,結果包含新網址原本的東西(題庫、紀錄、錯題、完成紀錄、最佳成績、小雞、每日練習…);
     replace  換掉新網址原本的值(選了「用舊網址的」、搬家寫過又換新、換學生檔案、改過內容的題庫換新版)。
   沒給種類的:新網址有這個鍵就當 replace,沒有就是 add。
   - 被換掉的原值(replace)存一份 tr_move_backup_<時間>,只存一份:它同時是備份,也是寫到一半被關時還原用的。
     搬家自己的鍵(tr_move_log)的原值很小,直接放在日誌裡。合併的鍵(grow)原值不另外存:合併結果已經包含它。
   - 寫之前先存日誌 tr_move_journal = { v: 2, at, backup, keys: [[鍵, 種類, 寫入值的指紋]] },全部寫完才刪。
     寫到一半分頁被關(iOS 很常見),下一次開新網址任何一頁時 js/common.js 的 moveJournalRecover 照日誌處理:
     只有「現在的值還是搬家寫的那個」的鍵才換回原值或拿掉,之後被別的頁面改過的留著(原值還在備份裡);合併的鍵留著合併後的樣子。
   - 寫入中途遇到空間不夠(同一個分頁):用記憶體裡的原值把每個鍵都換回去,連合併的也是,備份與日誌刪掉,等於沒寫。
   - 空間:先試寫一個暫時的鍵,寫完之後至少要留 RESERVE 個字元(store.set 會默默吞掉空間不夠的錯誤,空間見底之後的練習會默默存不進去)。
     放不下時 pickFit 量剩下的空間,挑放得下的項目;放不下的由收件頁列出來,這次不算搬完。
   - 舊網址的資料這裡碰不到(這支只在新網址的收件頁執行)。依賴 js/common.js(moveHash)。 */
(function (root) {
  'use strict';
  const JOURNAL = 'tr_move_journal', PROBE = 'tr_move_probe';
  const RESERVE = 500 * 1024;
  const MODES = { add: 1, grow: 1, replace: 1 };
  const own = (k) => /^tr_move_/.test(k);

  function size(entries) { return entries.reduce((n, [k, v]) => n + k.length + (v === null ? 0 : v.length), 0); }
  function modeOf(e, before) {
    if (before === null) return 'add';
    return MODES[e[2]] && e[2] !== 'add' ? e[2] : 'replace';
  }
  function growth(x) { return Math.max(0, x.v.length - (x.before === null ? -x.k.length : x.before.length)); }
  function items(ls, writes) { return writes.map((e) => { const before = ls.getItem(e[0]); return { k: e[0], v: e[1], before, mode: modeOf(e, before) }; }); }

  /* 要寫的東西 → { writes(含備份), items, journal, need, replaced, backupKey }。backup:要不要另存被換掉的原值 */
  function prepare(ls, writes, now, backup) {
    const list = items(ls, writes);
    const user = list.filter((x) => x.mode === 'replace' && !own(x.k));
    let bk = null, bkRaw = null;
    if (backup && user.length) {
      bk = 'tr_move_backup_' + now;
      for (let i = 2; ls.getItem(bk) !== null; i++) bk = 'tr_move_backup_' + now + '_' + i;
      bkRaw = JSON.stringify({ at: now, keys: user.map((x) => [x.k, x.before]) });
    }
    const hash = root.moveHash;
    const keys = list.map((x) => (x.mode === 'replace' && own(x.k) ? [x.k, x.mode, hash(x.v), x.before] : [x.k, x.mode, hash(x.v)]));
    const journal = JSON.stringify({ v: 2, at: now, backup: bk, keys });
    const out = (bk ? [[bk, bkRaw]] : []).concat(list.map((x) => [x.k, x.v]));
    const need = journal.length + JOURNAL.length + (bk ? bk.length + bkRaw.length : 0) + list.reduce((n, x) => n + growth(x), 0);
    return { writes: out, items: list, journal, need, replaced: user.length, backupKey: bk };
  }

  /* 試寫 n 個字元看放不放得下。放得下回 true(試寫的鍵馬上刪掉) */
  function fits(ls, n) {
    const chunk = 'x'.repeat(Math.min(n, 1024 * 1024));
    const parts = [];
    try {
      for (let left = n, i = 0; left > 0; left -= chunk.length, i++) {
        const s = left >= chunk.length ? chunk : chunk.slice(0, left);
        ls.setItem(PROBE + i, s);
        parts.push(PROBE + i);
      }
      return true;
    } catch (e) {
      return false;
    } finally {
      parts.forEach((k) => { try { ls.removeItem(k); } catch (e) { /* 刪不掉下次再試寫時會蓋過 */ } });
    }
  }
  /* 量還剩多少空間(字元數,大約):一塊一塊試寫到寫不進去,再全部刪掉 */
  function room(ls) {
    const parts = [];
    let total = 0, n = 1024 * 1024, chunk = 'x'.repeat(n);
    try {
      while (n >= 512) {
        const k = PROBE + parts.length;
        try { ls.setItem(k, chunk); parts.push(k); total += k.length + n; }
        catch (e) { n = Math.floor(n / 2); chunk = chunk.slice(0, n); }
      }
    } finally {
      parts.forEach((k) => { try { ls.removeItem(k); } catch (e) { /* 下次會蓋過 */ } });
    }
    return total;
  }
  /* 整包放不下時挑放得下的:搬家紀錄 tr_move_log 一定留;其他(含帳號的暫存區)照「要多用的空間」從小排到大,放到放不下為止。
     回 { keep: [鍵], skip: [鍵](照原本的順序) } */
  function pickFit(ls, writes) {
    const list = items(ls, writes);
    const cost = (x) => growth(x) + (x.mode === 'replace' ? x.before.length + x.k.length : 0) + x.k.length + 24;
    let budget = room(ls) - RESERVE - JOURNAL.length - 200;
    const keep = new Set();
    const must = (x) => x.k === 'tr_move_log';
    list.filter(must).forEach((x) => { keep.add(x.k); budget -= cost(x); });
    list.filter((x) => !must(x)).sort((a, b) => cost(a) - cost(b)).forEach((x) => {
      if (cost(x) <= budget) { keep.add(x.k); budget -= cost(x); }
    });
    return { keep: list.filter((x) => keep.has(x.k)).map((x) => x.k), skip: list.filter((x) => !keep.has(x.k)).map((x) => x.k) };
  }

  /* 同一個分頁寫到一半失敗:用記憶體裡的原值全部換回去(先拿掉新加的騰出空間),刪掉備份與日誌 */
  function undo(ls, p) {
    const rm = (k) => { try { ls.removeItem(k); } catch (e) { /* 刪不掉就留著 */ } };
    p.items.forEach((x) => { if (x.before === null) rm(x.k); });
    if (p.backupKey) rm(p.backupKey);
    p.items.forEach((x) => { if (x.before !== null) { try { ls.setItem(x.k, x.before); } catch (e) { /* 原本放得下,這裡不會發生 */ } } });
    rm(JOURNAL);
  }

  /* 寫入。回 { ok: true, replaced } 或 { ok: false, why: 'space' | 'busy' | 'noBackup' } */
  function apply(ls, writes, opt) {
    const o = opt || {};
    const now = o.now || Date.now();
    if (ls.getItem(JOURNAL) !== null) return { ok: false, why: 'busy' };
    let p = prepare(ls, writes, now, !o.noBackup);
    if (!fits(ls, p.need + RESERVE)) {
      if (o.noBackup || !p.backupKey) return { ok: false, why: 'space' };
      p = prepare(ls, writes, now, false);   // 備份放不下:不備份再試一次,呼叫的人只能給不會變少的合併(搬家計畫 2.4)
      if (!fits(ls, p.need + RESERVE)) return { ok: false, why: 'space' };
      if (p.replaced && !o.allowNoBackup) return { ok: false, why: 'noBackup' };
    }
    try { ls.setItem(JOURNAL, p.journal); } catch (e) { return { ok: false, why: 'space' }; }
    for (let i = 0; i < p.writes.length; i++) {
      try { ls.setItem(p.writes[i][0], p.writes[i][1]); }
      catch (e) { undo(ls, p); return { ok: false, why: 'space' }; }
    }
    try { ls.removeItem(JOURNAL); } catch (e) { /* 刪不掉:下一頁照日誌處理(新加的拿掉、換掉的換回、合併的留著),再請使用者搬一次 */ }
    return { ok: true, replaced: p.replaced };
  }

  root.MOVE_APPLY = Object.freeze({ JOURNAL, RESERVE, prepare, fits, room, pickFit, apply, size });
})(typeof globalThis !== 'undefined' ? globalThis : this);
