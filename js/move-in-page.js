/* 衝衝英文搬家:新網址的收件頁 move-in.html(搬家計畫 2.3 到 2.6、2.9)。
   - 從舊網址的寄出頁開過來(window.opener 在):產生 nonce,每 2 秒送 hello,等整包。8 秒還沒收到,請使用者切回上一個分頁一下
     (iPhone 會暫停背景分頁);20 秒還沒有,畫面加上備案,但繼續聽,晚到的包照收(使用者開始走備案就不再聽)。
   - 備案:選搬家檔、貼上搬家碼。不管從哪一路來,都重算雜湊、重新驗證(js/move-rules.js 的 validate)、算合併(js/move-merge.js)、
     列給人看,按「確定搬進來」才寫(js/move-apply.js:先寫日誌、量空間、被換掉的先備份)。空間不夠時怎麼辦寫在 commit 前面。
   - 寫之前用 BroadcastChannel('rushup-move') 問「還有誰開著」:有別的新網址分頁就要求先關掉(它們可能寫回舊的小雞、洗掉正在考的模擬考)。
   - 小雞合併要對時:讀同網域不快取的 move-ping.txt 回應的 Date 標頭,差超過 3 天就不合併小雞(列為衝突、留新網址的)。
   - 自動搬家(四站,js/move-link.js 開頭):舊網址每一頁帶到 move-in.html#want&n=<一次性號碼>,這裡產生一次性金鑰(私鑰只放這個分頁的 sessionStorage),
     帶公鑰與同一個號碼回舊網址寄出頁(寄出頁核對號碼,別的網站塞的公鑰不用);寄出頁加密後帶到 move-in.html#auto=<密文>&back=<原路徑>。move-in.html 開頭的 script 先把 # 後面
     收進 window.MOVE_AUTO_IN、用 replaceState 從網址列拿掉;這裡用私鑰解開(解開前就刪私鑰),交給跟「貼上搬家碼」同一個 fromText
     (同樣的驗證、雜湊、合併、備份)。解不開(別的分頁、別台、用過、過期、明文的 #auto=)什麼都不顯示、不寫。
     確認畫面照樣畫出來,下面這些都成立才不等按鈕、直接照預設(留這台的)寫:解得開(整條路是這個分頁從舊網址開始的;
     別的網站做一個 #auto= 連結騙人點,解不開,也不會顯示內容)、沒有要選的衝突、沒有「兩邊不一樣只留一份」的項目、新網址沒有登入著(訪客資料登入時看不到)、
     沒有其他新網址分頁開著、空間一次放得下(不先搬一部分)。寫好(或這台早就搬過同一包)就帶回舊網址 move-out.html#ack=<雜湊>&back=<原路徑>,
     舊網址寫完成記號再帶到新網址的原路徑。沒寫成就什麼都不寫、說清楚,給「回舊網址用按鈕搬」;舊網址這個分頁不會再自動(js/move-out.js 的 tr_move_auto)。
   - 這一頁不載 cloud.js、pet-store.js(免得它在登入著時重新整理頁面,或小雞模組自己寫入)。畫面只用 textContent。
   依賴 js/move-config.js、js/common.js(h、日誌還原)、js/pet.js、js/pet-food.js、js/daily.js、js/move-*.js。 */
(function () {
  'use strict';
  const root = document.getElementById('move-root');
  if (window.top !== window.self) { document.body.textContent = '這一頁不能放在別的網頁裡面打開。'; return; }
  const M = window.MOVE, R = window.MOVE_RULES, MM = window.MOVE_MERGE, P = window.MOVE_PACK, A = window.MOVE_APPLY, L = window.MOVE_LINK;
  const CLOCK_MAX = 3 * 864e5;
  const HINT_MS = 8000, FALLBACK_MS = 20000;
  const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const say = (text, cls) => h('p', { class: cls || 'result-note' }, text);
  const head = () => h('h1', { style: 'font-size:22px;margin:0 0 6px' }, '把舊網址的進度搬進來');
  let link = null, busy = false;
  let auto = null;   // 舊網址自動搬家帶來的:{ code, back(原路徑), trusted(從舊網址帶過來的), from(回去的舊網址) }
  const fallbackBox = h('div', { id: 'move-fallback' });
  const live = h('div', { class: 'result-note', 'aria-live': 'polite' });

  function draw(...nodes) { root.replaceChildren(head(), ...nodes.filter(Boolean)); }

  /* ---------- 自動搬家 ---------- */
  function backLink() {
    if (!auto) return null;
    return h('p', { style: 'margin-top:12px' }, h('a', { class: 'btn', href: (auto.from || M.from[0]) + '/move-out.html' }, '回舊網址用按鈕搬'));
  }
  const AUTO_FAIL = '自動搬家沒有成功，這次沒有寫入任何東西，舊網址的資料都還在。可以按「回舊網址用按鈕搬」，或用下面的搬家檔、搬家碼。';
  /* 不能不問就寫的原因;'' 表示可以直接寫 */
  function autoStop(plan, valid) {
    if (!auto.trusted) return '這一頁不是從舊網址自動帶過來的，請看過上面的內容，確定是你的進度再按「確定搬進來」。';
    if (plan.conflicts.length) return '有些項目兩邊不一樣，要你決定留哪一份。看過之後按「確定搬進來」。';
    if (plan.dropped.length) return '有些項目兩邊不一樣、只能留一份（上面有列），看過之後按「確定搬進來」。';
    if (signedIn() && valid.keys.some((e) => !/^tr_u/.test(e[0]))) return '你現在在新網址是登入的，請看過上面的說明，再按「確定搬進來」。';
    return '';
  }
  /* 寫好了:自動搬家帶回舊網址寫完成記號;不是自動搬家的照舊顯示搬好了 */
  function finish(plan, ctx) {
    if (!auto) { drawDone(plan); return; }
    const url = L.ackUrl(ctx.from, ctx.sent, auto.back);
    draw(say('搬好了。舊網址那台的進度已經在這裡。', 'move-done'), say('正在回舊網址記下「搬好了」，再帶你回原本的頁面…'),
      h('p', null, h('a', { class: 'btn primary', href: url }, '沒有自動跳過去的話，按這裡')));
    location.replace(url);
  }

  /* ---------- 其他分頁 ---------- */
  function others() {
    return new Promise((resolve) => {
      let ch;
      try { ch = new BroadcastChannel('rushup-move'); } catch (e) { resolve(-1); return; }
      const id = L.newNonce(crypto);
      let n = 0;
      ch.onmessage = (ev) => { if (ev.data && ev.data.t === 'here' && ev.data.id === id) n++; };
      ch.postMessage({ t: 'who', id });
      setTimeout(() => { ch.close(); resolve(n); }, 700);
    });
  }
  function tellOthers() { try { const ch = new BroadcastChannel('rushup-move'); ch.postMessage({ t: 'reload' }); ch.close(); } catch (e) { /* 沒有就算了 */ } }

  /* ---------- 對時(小雞) ---------- */
  async function clockOk() {
    try {
      const r = await fetch('move-ping.txt?t=' + Date.now(), { cache: 'no-store' });
      const d = Date.parse(r.headers.get('date') || '');
      return isFinite(d) && Math.abs(d - Date.now()) <= CLOCK_MAX;
    } catch (e) { return false; }
  }

  /* ---------- 進來的那一包 ---------- */
  function fromOf(pack, origin) {
    if (origin && M.from.indexOf(origin) > -1) return origin;
    return typeof pack.from === 'string' && M.from.indexOf(pack.from) > -1 ? pack.from : M.from[0];
  }
  /* 先驗證格式、再算雜湊(格式不對的包算雜湊可能出錯);任何錯誤都說清楚、給備案,不會停在「正在接收」 */
  async function receive(pack, hash, origin) {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      const valid = R.validate(pack, now);
      if (!valid.ok) { unusable('（' + valid.why + '）'); return; }
      if ((await P.hashOf(pack)) !== hash) {
        draw(say(auto ? AUTO_FAIL : '收到的資料不完整，這次沒有寫入任何東西。請回上一個分頁，重新按一次「送到新網址」，或用下面的搬家檔、搬家碼。'), backLink(), live, fallbackBox);
        showFallback();
        return;
      }
      /* hash:記在 tr_move_log 的(連刪除標記 del 一起算);sent:寄出頁送來的那個,回報「搬好了」要用它(寄出頁比對的是它) */
      const ctx = { now, from: fromOf(pack, origin), hash: P.logHash(pack, hash), sent: hash, pet: window.PET, petClockOk: await clockOk(), daily: window.DAILY, choices: {} };
      if (auto) auto.from = ctx.from;
      review(valid, ctx);
    } catch (e) {
      unusable('');
    } finally { busy = false; }
  }
  function unusable(why) {
    if (link) link.stop();
    draw(say('這份搬家資料不能用' + why + '，這次沒有寫入任何東西。可以回舊網址的搬家頁重新準備一次，或用下面的搬家檔、搬家碼。'), backLink(), live, fallbackBox);
    showFallback();
  }
  function target() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) keys.push(k); }
    return { get: (k) => localStorage.getItem(k), keys };
  }
  function readLog() { try { return JSON.parse(localStorage.getItem('tr_move_log')) || {}; } catch (e) { return {}; } }
  function signedIn() {
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && /^sb-[a-z0-9]+-auth-token$/.test(k)) return true; }
    return false;
  }

  /* ---------- 確認畫面 ---------- */
  function review(valid, ctx) {
    if (link) link.stop();
    const plan = MM.plan(valid, target(), Object.assign({}, ctx, { log: readLog() }));
    if (plan.already) {
      if (link) link.done(ctx.sent);
      if (auto) { finish(plan, ctx); return; }   // 自動搬家重來一次(上次 ack 沒回到舊網址):同一包不重寫,直接回舊網址記下搬好了
      draw(say('這台已經搬過同一份進度了，這次沒有新東西。'), h('p', null, h('a', { class: 'btn primary', href: 'index.html' }, '開始練習')));
      return;
    }
    const c = plan.counts, b = plan.banks;
    const li = [];
    li.push('新加進來 ' + c.added + ' 項，合併 ' + (c.merged + c.updated) + ' 項，兩邊一樣的 ' + c.same + ' 項');
    if (b.added.length) li.push('自訂單字題庫加進來：' + b.added.map((n) => '「' + (n || '未命名') + '」').join('、'));
    if (b.renamed.length) li.push('名稱一樣、內容不同的題庫，另外存一份：' + b.renamed.map((n) => '「' + n + '」').join('、'));
    if (b.skipped) li.push('已經有一模一樣的題庫 ' + b.skipped + ' 個，不重複加');
    if (plan.pending) li.push('帳號還沒上傳的進度 ' + valid.accounts.size + ' 個帳號，登入那個帳號時合併');
    if (c.keptBoth) li.push(plan.kept.map((x) => x.label).filter((x, i, a) => a.indexOf(x) === i).join('、') + '有 ' + c.keptBoth + ' 題兩邊寫的不一樣，兩份都留著：比較新的那份在原來的位置，另一份放在那一題下面，打開那一題就看得到');
    plan.dropped.forEach((x) => li.push(x.label + '有 ' + x.n + ' 題兩邊不一樣，留這台（新網址）的' + (/^tr_read_q_/.test(x.key) ? '作答' : '')));
    const rows = plan.conflicts.map((x) => conflictRow(x, ctx.choices));
    const btn = h('button', { class: 'btn primary', type: 'button' }, '確定搬進來');
    const msg = h('div', { class: 'result-note', 'aria-live': 'polite' });
    btn.addEventListener('click', () => commit(valid, ctx, btn, msg));
    draw(say('這是舊網址那台的進度，跟這台合併之後的樣子：'), h('ul', { class: 'move-list' }, li.map((t) => h('li', null, t))),
      rows.length ? h('div', null, say('下面這些只能留一份，先幫你留這台（新網址）的，可以改：'), ...rows) : null,
      say((c.dropped ? '其他兩邊都有的練習紀錄、錯題、完成紀錄、最佳成績會合在一起。' : '兩邊都有的練習紀錄、錯題、完成紀錄、最佳成績都會合在一起，不會少。') + '同一題兩邊都答過的，錯題本留最後一次的作答。'
        + '如果你在新網址刪過題庫，再搬一次它會回來。'),
      signedIn() && valid.keys.some((e) => !/^tr_u/.test(e[0])) ? say('你現在在新網址是登入的。搬進來的是舊網址的訪客資料，登出之後才看得到。', 'move-note') : null,
      h('div', { class: 'modal-row' }, btn), msg, backLink());
    if (!auto) return;
    const stop = autoStop(plan, valid);
    if (stop) { msg.textContent = stop; return; }
    msg.textContent = '正在自動搬進來…';
    commit(valid, ctx, btn, msg, true).catch(() => { msg.textContent = AUTO_FAIL; btn.disabled = false; });
  }
  function conflictRow(x, choices) {
    const name = 'c' + Math.random().toString(36).slice(2);
    const opt = (v, label) => {
      const r = h('input', { type: 'radio', name, value: v });
      if ((choices[x.key] || 'new') === v) r.checked = true;
      r.addEventListener('change', () => { choices[x.key] = v; });
      return h('label', { style: 'display:block;margin:2px 0' }, r, ' ' + label);
    };
    const why = { clock: '這台的時鐘跟伺服器差太多，小雞先不合併，留這台的。', pet: '小雞的資料版本對不上，留這台的。', broken: '這台的這一項讀不懂。', shape: '兩邊的格式不一樣，沒辦法合併。', daily: '每日練習沒辦法合併，留這台的。', tombs: '刪除紀錄的格式認不得，留這台的（舊網址刪掉的題庫可能會回來，不會少）。' };
    const box = h('div', { class: 'q-block', style: 'padding:10px 14px;margin:8px 0' }, h('b', null, x.label));
    if (x.sub === 'current_profile') box.append(say('要不要切換到舊網址的學生檔案「' + (x.oldName || '未命名') + '」？'));
    else if (why[x.why]) box.append(say(why[x.why]));
    else if (x.why === 'single') {
      const a = describe(x.sub, x.newValue), b = describe(x.sub, x.oldValue);
      box.append(say(a && b ? '這台：' + a + '；舊網址：' + b + '。' : '兩邊不一樣，只能留一份。'));
    }
    if (x.choosable) box.append(opt('new', x.sub === 'current_profile' ? '不用，維持這台現在的' : '留這台（新網址）的'), opt('old', x.sub === 'current_profile' ? '切換過去' : '用舊網址的'));
    return box;
  }

  /* 單一值衝突時兩邊各是什麼,用學生看得懂的話說;認不得的形狀回空字串(只說兩邊不一樣) */
  function describe(sub, v) {
    const day = (iso) => { const t = Date.parse(iso || ''); return isFinite(t) ? new Date(t).toLocaleDateString('zh-TW') : ''; };
    if (/^read_tq_/.test(sub || '') && v && isFinite(v.score) && isFinite(v.total)) return '答對 ' + v.score + '／' + v.total + ' 題';
    if (sub === 'ph_slow' && typeof v === 'boolean') return v ? '慢速開著' : '慢速關著';
    if (sub === 'diag' && v && typeof v === 'object') {
      if (v.done) return '做完了' + (day(v.finishedAt) ? '（' + day(v.finishedAt) + '）' : '');
      const n = v.answers && typeof v.answers === 'object' ? Object.keys(v.answers).length : 0;
      return '做到一半，答了 ' + n + ' 題';
    }
    return '';
  }

  /* 按「確定搬進來」。寫得不完整時不送「搬好了」給舊網址(舊網址會繼續提示、可以再搬),這次也不記成搬過(js/move-merge.js 的 unfinished、skip):
     - 被換掉的值備份放不下:先做不會變少的合併,選了「用舊網址的」那幾項這次不換,給「下載這台現在的資料」再「換成舊網址的」(搬家計畫 2.4)。
     - 整包放不下:先搬放得下的(js/move-apply.js 的 pickFit),放不下的列出來,清出空間之後再搬一次補上。 */
  /* isAuto:自動搬家(沒有人按):其他分頁的檢查做不到不跳確認框、改等人按;寫不下就停,不先搬一部分、不改用不備份的合併 */
  async function commit(valid, ctx, btn, msg, isAuto) {
    btn.disabled = true;
    msg.textContent = '正在檢查其他分頁…';
    const n = await others();
    if (n > 0) {
      msg.textContent = '還有 ' + n + ' 個衝衝英文的分頁開著。請先把它們關掉（它們可能把舊的資料寫回去），再按一次「確定搬進來」。';
      btn.disabled = false;
      return;
    }
    if (n < 0 && isAuto) {
      msg.textContent = '這個瀏覽器沒辦法自動檢查其他分頁。請先確認沒有其他衝衝英文的分頁開著，再按「確定搬進來」。';
      btn.disabled = false;
      return;
    }
    if (n < 0 && !confirm('這個瀏覽器沒辦法自動檢查其他分頁。請先確認沒有其他衝衝英文的分頁開著，再按確定。')) { btn.disabled = false; msg.textContent = ''; return; }
    const base = Object.assign({}, ctx, { now: Date.now(), log: readLog() });
    const chosen = Object.keys(ctx.choices).filter((k) => ctx.choices[k] === 'old');
    let o = { choices: ctx.choices };
    let t = attempt(valid, base, o);
    if (isAuto && !t.r.ok) {
      msg.textContent = t.r.why === 'busy' ? '上一次搬家還沒處理完，自動搬家沒有寫入任何東西。請重新整理這一頁再試一次，或按「回舊網址用按鈕搬」。'
        : '這台瀏覽器的空間不夠，自動搬家沒有寫入任何東西，舊網址的資料都還在。可以按「確定搬進來」先搬放得下的，或刪掉這台用不到的自訂題庫再搬，或按「回舊網址用按鈕搬」。';
      btn.disabled = false;
      return;
    }
    const noBackup = () => {
      if (t.r.ok || t.r.why !== 'noBackup') return;
      o = Object.assign({}, o, { choices: {}, unfinished: chosen.length > 0, allowNoBackup: true });
      t = attempt(valid, base, o);
    };
    noBackup();
    if (!t.r.ok && t.r.why === 'space') {
      const fit = A.pickFit(localStorage, t.plan.writes);
      if (fit.keep.some((k) => k !== 'tr_move_log')) { o = Object.assign({}, o, { skip: fit.skip }); t = attempt(valid, base, o); noBackup(); }
    }
    if (!t.r.ok) {
      msg.textContent = t.r.why === 'busy' ? '上一次搬家還沒處理完。請重新整理這一頁再試一次。'
        : '這台瀏覽器的空間不夠，這次沒有寫入任何東西。舊網址的資料都還在。可以先刪掉這台用不到的自訂題庫再搬，或改用另一個瀏覽器、電腦搬。';
      btn.disabled = false;
      return;
    }
    tellOthers();
    const left = o.unfinished ? chosen : [];
    if (!t.plan.skipped.length && !left.length) { if (link) link.done(ctx.sent); finish(t.plan, ctx); return; }
    drawPartial(valid, ctx, t.plan, left, o.skip || []);
  }
  function attempt(valid, base, o) {
    const plan = MM.plan(valid, target(), Object.assign({}, base, { choices: o.choices, unfinished: !!o.unfinished, skip: o.skip }));
    return { plan, r: A.apply(localStorage, plan.writes, { now: base.now, allowNoBackup: !!o.allowNoBackup, noBackup: !!o.noBackupOnly }) };
  }
  function drawDone(plan) {
    draw(say('搬好了。舊網址那台的進度已經在這裡。', 'move-done'),
      plan.pending ? say('帳號的進度要登入同一個帳號一次才會合併進去。') : null,
      say('舊網址的資料都還留著。以後請直接用這個網址 ' + M.newName + '。'),
      h('p', null, h('a', { class: 'btn primary', href: 'index.html' }, '開始練習')));
  }
  /* 只搬了一部分:說清楚哪些還沒過來、為什麼、怎麼補。舊網址沒有被標成搬好了 */
  function drawPartial(valid, ctx, plan, left, skip) {
    const nameOf = (k) => { const x = plan.conflicts.filter((c) => c.key === k)[0]; return x ? x.label : MM.labelOf(k.replace(/^tr_(u[pc][0-9a-z]+_)?/, '')); };
    const nodes = [say('大部分搬好了，下面這些還沒過來。舊網址的資料都還在，舊網址會繼續提示你搬家。', 'move-done')];
    if (plan.skipped.length) {
      nodes.push(say('這台的空間放不下：' + plan.skipped.map((x) => '「' + x.label + '」').join('、') + '。'),
        say('先清出這台的空間（例如刪掉這台用不到的自訂題庫），再回舊網址按一次「送到新網址」，就會補上。也可以先在舊網址下載搬家檔留著。'));
    }
    if (left.length) {
      const status = h('div', { class: 'result-note', 'aria-live': 'polite' });
      let saved = false;
      const dl = h('button', { class: 'btn', type: 'button' }, '下載這台現在的資料');
      dl.addEventListener('click', () => { saveBackup(left, status).then((ok) => { if (ok) saved = true; }, () => { status.textContent = '存不下來，請再按一次。'; }); });
      const go = h('button', { class: 'btn primary', type: 'button' }, '換成舊網址的');
      go.addEventListener('click', () => {
        if (!saved && !confirm('還沒下載這台現在的資料。換了之後，這台原本的那份就沒有了。確定要換嗎？')) return;
        go.disabled = true;
        const choices = {};
        left.forEach((k) => { choices[k] = 'old'; });
        const t = attempt(valid, Object.assign({}, ctx, { now: Date.now(), log: readLog() }), { choices, skip, allowNoBackup: true, noBackupOnly: true });
        if (!t.r.ok) { status.textContent = '這台的空間還是不夠，這次沒有換。舊網址的資料都還在。'; go.disabled = false; return; }
        tellOthers();
        if (!t.plan.skipped.length) { if (link) link.done(ctx.sent); finish(t.plan, ctx); return; }
        drawPartial(valid, ctx, t.plan, [], skip);
      });
      nodes.push(say('你選了「用舊網址的」的' + left.map((k) => '「' + nameOf(k) + '」').join('、') + '還沒換：這台的空間不夠先備份這台原本的那份。'),
        say('可以先按「下載這台現在的資料」存一份，再按「換成舊網址的」。存下來的檔案以後在這一頁的「選擇搬家檔」選它，就能拿回來。'),
        h('div', { class: 'modal-row' }, dl, go), status);
    }
    nodes.push(h('p', null, h('a', { class: 'btn primary', href: 'index.html' }, '開始練習')));
    draw(...nodes);
  }
  /* 這台現在的值存成一個搬家檔(格式跟舊網址的搬家檔一樣,以後在收件頁選這個檔案就能拿回來);讀不懂的值原樣放在 extra */
  async function saveBackup(keys, status) {
    const list = [], extra = [];
    keys.forEach((k) => {
      const v = localStorage.getItem(k);
      if (v === null) return;
      try { JSON.parse(v); list.push([k, v]); } catch (e) { extra.push([k, v]); }
    });
    const prof = localStorage.getItem('tr_profiles');
    if (prof !== null && keys.indexOf('tr_profiles') < 0 && list.some((e) => /^tr_u|^tr_current_profile$/.test(e[0]))) list.push(['tr_profiles', prof]);
    list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const pack = { app: 'rushup-move', v: 1, from: M.to, at: new Date().toISOString(), keys: list, accounts: {}, extra };
    const text = P.toFileText(pack, await P.hashOf(pack));
    const name = '衝衝英文這台的備份_' + new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) + '.json';
    try {
      if (IS_IOS && navigator.canShare && typeof File === 'function') {
        const file = new File([text], name, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); status.textContent = '存好了。'; return true; }
      }
    } catch (e) { if (e && e.name === 'AbortError') return false; /* 分享不了就改下載 */ }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    status.textContent = '已經下載「' + name + '」。';
    return true;
  }

  /* ---------- 備案:搬家檔、搬家碼 ---------- */
  function showFallback() {
    if (fallbackBox.childNodes.length) return;
    const file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': '選擇搬家檔' });
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (f.size > P.MAX_BYTES) { live.textContent = '這個檔案太大了，不是衝衝英文的搬家檔。請選舊網址搬家頁下載的那個檔案。'; return; }
      const rd = new FileReader();
      rd.onload = () => { auto = null; fromText(String(rd.result || '')).catch(() => { live.textContent = '讀不懂這份搬家資料，這次沒有寫入任何東西。'; }); };
      rd.onerror = () => { live.textContent = '讀不到這個檔案。'; };
      rd.readAsText(f, 'utf-8');
    });
    const ta = h('textarea', { class: 'modal-input', rows: '4', style: 'width:100%;font-size:12px', placeholder: '把搬家碼貼在這裡', 'aria-label': '搬家碼' });
    const go = h('button', { class: 'btn', type: 'button', onclick: () => { auto = null; fromText(ta.value); } }, '讀取搬家碼');
    fallbackBox.append(h('h2', { style: 'font-size:17px;margin:18px 0 6px' }, '另一個方法：搬家檔或搬家碼'),
      say('在舊網址的搬家頁按「下載搬家檔」或「複製搬家碼」，再回到這裡。'),
      h('p', null, h('b', null, '選擇搬家檔　'), file), ta, h('div', { class: 'modal-row' }, go));
  }
  async function fromText(text) {
    if (link) link.stop();   // 開始走備案:不再等視窗那一路
    let r;
    try { r = await P.fromText(text); } catch (e) { r = { ok: false, why: 'broken' }; }
    if (!r.ok) {
      live.textContent = r.why === 'noGzip' ? '這個瀏覽器讀不了壓縮過的搬家碼，請改用電腦或新一點的瀏覽器，或在舊網址改用「下載搬家檔」。'
        : r.why === 'tooBig' ? '這份資料太大了，不是衝衝英文的搬家碼或搬家檔。請確認是從舊網址的搬家頁複製或下載的。'
          : '讀不懂這份搬家資料，請確認是從舊網址的搬家頁複製或下載的。';
      if (auto) { draw(say(AUTO_FAIL), backLink(), live, fallbackBox); showFallback(); }
      return;
    }
    await receive(r.pack, r.hash, '');
  }
  /* ---------- 自動搬家的一次性金鑰(四站怎麼走寫在 js/move-link.js 開頭) ----------
     私鑰只放新網址這個分頁的 sessionStorage(tr_move_key:{ jwk, at }),第四站讀出來就刪:歷史紀錄、錯誤頁、被複製出去的 #auto= 網址
     在別的分頁、別台、過了 KEY_MS 之後都解不開。 */
  const KEY = 'tr_move_key', KEY_MS = 10 * 60000;
  function oldOrigin() { try { const o = new URL(document.referrer).origin; return M.from.indexOf(o) > -1 ? o : M.from[0]; } catch (e) { return M.from[0]; } }
  function takeKey() {
    let v = null;
    try { v = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { v = null; }
    try { sessionStorage.removeItem(KEY); } catch (e) { /* 拿不掉:過了 KEY_MS 一樣不收 */ }
    const age = v && typeof v.at === 'number' ? Date.now() - v.at : NaN;
    return v && v.jwk && typeof v.jwk === 'object' && age >= 0 && age < KEY_MS ? v.jwk : null;
  }
  /* 第二站(#want&n=):產生金鑰、私鑰放這個分頁,帶公鑰與第一站的號碼(照原樣)回舊網址的寄出頁,寄出頁核對號碼才用這把公鑰。
     做不到(沒有號碼、沒有 Web Crypto、sessionStorage 不給寫)就回舊網址原頁面,那一頁照舊顯示按鈕(舊網址這個分頁不會再自動) */
  async function startWant(w) {
    const from = oldOrigin();
    draw(say('拍謝！我們換網址了，因為名字跟別人重疊！正在把舊網址的進度帶過來…'), live);
    let pub = '';
    if (w.n) {
      try {
        const k = await L.newKey();
        const v = JSON.stringify({ jwk: k.jwk, at: Date.now() });
        sessionStorage.setItem(KEY, v);
        if (sessionStorage.getItem(KEY) === v) pub = k.pub;
      } catch (e) { pub = ''; }
    }
    location.replace(pub ? L.keyUrl(from, pub, w.back, w.n) : from + w.back);
  }
  const AUTO_GONE = '這個自動搬家的網址已經用過、過期了，或不是在這個分頁開始的（為了保護你的資料，搬家的內容只有原本那個分頁解得開，而且只能用一次），這次沒有寫入任何東西。舊網址的資料都還在：可以按「回舊網址用按鈕搬」，或用下面的搬家檔、搬家碼。';
  /* 舊網址自動搬家帶來的(move-in.html 開頭已經從網址拿掉):#want 是第二站;#auto= 是第四站,用這個分頁的私鑰解開(解開前就刪私鑰),
     再走跟「貼上搬家碼」同一個 fromText。解得開表示整條路是這個分頁、舊網址那一頁開始的,才算可信(可以不問就照預設寫) */
  async function startAuto(raw) {
    window.MOVE_AUTO_IN = null;   // 搬家碼只留在這一頁的記憶體
    const w = L.parseWant(raw);
    if (w) { await startWant(w); return; }
    const a = L.parseAuto(raw);
    const jwk = takeKey();
    auto = { code: '', back: a ? a.back : '/', trusted: false, from: '' };
    let code = '';
    if (a && jwk) { try { code = await L.open(jwk, a.code); } catch (e) { code = ''; } }
    if (!code) { draw(say(AUTO_GONE), backLink(), live, fallbackBox); showFallback(); return; }
    auto.code = code;
    auto.trusted = true;
    draw(say('拍謝！我們換網址了，因為名字跟別人重疊！正在把舊網址的進度搬進來…'), live, fallbackBox);
    fromText(code).catch(() => unusable(''));
  }

  /* ---------- 開始 ---------- */
  function start() {
    if (!M || !M.onNew) {
      draw(say('這一頁要在新網址 ' + M.newName + ' 打開。'), h('p', null, h('a', { class: 'btn primary', href: M.to + '/move-in.html' }, '打開新網址的搬家頁')));
      return;
    }
    if (localStorage.getItem('tr_move_restored') !== null) {
      try { localStorage.removeItem('tr_move_restored'); } catch (e) { /* 只是提示 */ }
      live.textContent = '上次搬到一半就關掉了。已經合併好的留著，其他的換回搬之前的樣子。請再搬一次，把沒搬完的補上。';
    }
    if (typeof window.MOVE_AUTO_IN === 'string') { startAuto(window.MOVE_AUTO_IN).catch(() => { draw(say(AUTO_FAIL), backLink(), live, fallbackBox); showFallback(); }); return; }
    const opener = window.opener;
    if (!opener) {
      draw(say('沒有從舊網址的搬家頁打開。請在舊網址 ' + M.oldName + ' 打開搬家頁，或用下面的搬家檔、搬家碼。'), live, fallbackBox);
      showFallback();
      return;
    }
    draw(say('正在從舊網址接收進度…'), live, fallbackBox);
    link = L.receiver({ win: window, opener, from: M.from, nonce: L.newNonce(crypto), every: 2000,
      setInterval: (f, ms) => setInterval(f, ms), clearInterval: (t) => clearInterval(t),
      onPack: (pack, hash, origin) => { clearTimeout(t1); clearTimeout(t2); receive(pack, hash, origin); } });
    const t1 = setTimeout(() => { if (!link.accepted) live.textContent = '還在等舊網址的分頁。請切回上一個分頁一下，再回來這裡。'; }, HINT_MS);
    const t2 = setTimeout(() => { if (!link.accepted) { live.textContent = '等不到舊網址的分頁。可以再切回去一次，或用下面的方法。'; showFallback(); } }, FALLBACK_MS);
  }

  start();
})();
