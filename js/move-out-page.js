/* 衝衝英文搬家:舊網址的寄出頁 move-out.html(搬家計畫 2.3、2.7、2.9、2.10、3.5)。
   兩下:「準備搬家」(補傳、組包、算雜湊、列摘要;可以慢,不碰新視窗)→「送到新網址」(點擊當下同步開新分頁,網址不帶任何參數)。
   之後只等新網址的 hello,一次送出整包;收到 done 而且雜湊一樣才寫 tr_move_done 與 cookie tr_moved=1。
   開不出新視窗、等不到、在 LINE 或 Facebook 裡面打開的,改用搬家檔或搬家碼(內容就是同一包加雜湊)。
   新網址連不上(先等 3 秒,再等 10 秒):只是不給「送到新網址」(改成「再連一次新網址」),準備搬家、搬家檔、搬家碼照樣能用(都不需要新網址)。
   準備搬家時記下這台資料的指紋(MOVE_RULES.fingerprint),搬好時跟雜湊一起存進 tr_move_done;之後指紋不一樣,舊網址每一頁會提示再搬一次。
   有搬不了的項目(太大,summary.tooBig)就不給送出、不給搬家碼與搬家檔,也就不會寫 tr_move_done,並說出是哪一項。
   主畫面 App(iPhone 的加到主畫面、Android 與電腦安裝的 App)另外提示:iPhone 主畫面 App 不給「送到新網址」(開出去的是 Safari,
   拿不到這個 App 的資料),只給搬家碼;搬好之後請到新網址重新安裝一次 App。
   每一頁的自動搬家(js/move-out.js tryAuto)搬好之後,新網址帶回這一頁 #ack=<雜湊>&back=<原路徑>:takeAck 核對過才寫 tr_move_done,
   再帶到新網址的原路徑;對不上(送出之後又練習了、不是這個分頁送的)什麼都不寫,照常顯示再搬一次。組包跟它共用 MOVE_OUT.buildPack。
   這一頁在舊網址只新增 tr_move_device(裝置編號,js/move-pack.js deviceId)、tr_move_done 兩個鍵與兩個不含資料的 cookie,
   其他一筆都不改不刪;畫面只用 textContent。
   依賴 js/move-config.js、js/move-rules.js、js/move-merge.js、js/move-pack.js、js/move-link.js、js/move-out.js、js/common.js(h)、js/cloud.js(可以沒有)。 */
(function () {
  'use strict';
  const root = document.getElementById('move-root');
  if (window.top !== window.self) { document.body.textContent = '這一頁不能放在別的網頁裡面打開。'; return; }
  const M = window.MOVE, P = window.MOVE_PACK, L = window.MOVE_LINK, OUT = window.MOVE_OUT;
  const UA = navigator.userAgent || '';
  const IN_APP = UA.indexOf('Line/') > -1 || /FBAN|FBAV|Instagram/.test(UA);
  const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const STANDALONE = (function () { try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } })();
  const NEW_HOME = M.to + '/';
  const IOS_APP = IS_IOS && STANDALONE;
  const APP_NOTE = '這個 App 是舊網址的。請用瀏覽器打開新網址 ' + M.newName + '，再安裝（加到主畫面）一次，舊的 App 圖示可以移除。';
  const PING_LONG_MS = 10000;
  const OFF_NOTE = '現在連不上新網址 ' + (M ? M.newName : '') + '（可能是網路比較慢，或這個網路擋住了新網址）。你的進度都還在這台裝置上，不會不見。還是可以先按「準備搬家」，用「下載搬家檔」或「複製搬家碼」帶過去。';
  let online = false;

  const say = (text, cls) => h('p', { class: cls || 'result-note' }, text);
  function draw(...nodes) { root.replaceChildren(h('h1', { style: 'font-size:22px;margin:0 0 6px' }, '把這台的進度搬到新網址'), ...nodes.filter(Boolean)); }
  function goNew(clean) {
    return (clean ? OUT.cleanup() : Promise.resolve()).then(() => location.replace(NEW_HOME));
  }
  function directLink(clean) {
    const a = h('a', { href: NEW_HOME }, '直接前往新網址 ' + M.newName);
    a.addEventListener('click', (e) => { if (!clean) return; e.preventDefault(); goNew(true); });
    return h('p', { style: 'margin-top:18px' }, a);
  }
  function lsState() { return OUT.stateOf(localStorage); }
  function fingerprint() { try { return window.MOVE_RULES.fingerprint(localStorage); } catch (e) { return null; } }
  /* 新網址通不通:先 3 秒,不通再等 10 秒(手機網路慢) */
  async function reach() {
    if (await OUT.ping()) return true;
    return OUT.ping(PING_LONG_MS);
  }

  async function start() {
    if (!M || !M.onOld) {
      draw(say('這一頁要在舊網址 ' + M.oldName + ' 打開。'), h('p', null, h('a', { class: 'btn primary', href: M.from[0] + '/move-out.html' }, '打開舊網址的搬家頁')));
      return;
    }
    draw(say('正在檢查這台的資料…'));
    if (window.CLOUD && CLOUD.enabled) { try { await CLOUD.ready; } catch (e) { /* 照目前的狀態 */ } }
    const ackNote = await takeAck();
    if (ackNote === true) return;
    const st = lsState();
    OUT.flags(st);
    draw(say('正在連新網址…'));
    online = await reach();
    const off = online ? null : say(OFF_NOTE, 'move-note');
    if (st.moved) return drawMoved(off);
    if (!st.hasData && !(window.CLOUD && CLOUD.user)) {
      draw(say('這台沒有要搬的進度。以後請直接用新網址 ' + M.newName + '。'), off, STANDALONE ? say(APP_NOTE, 'move-note') : null,
        online ? h('p', null, h('button', { class: 'btn primary', type: 'button', onclick: () => goNew(true) }, '前往新網址')) : null);
      return;
    }
    drawStart(ackNote || (st.stale ? say('這台上次搬家之後又有新的進度，再搬一次就會過去，已經搬過的不會重複。', 'move-note') : null));
  }

  /* 自動搬家(js/move-out.js 的 tryAuto)在新網址搬好,帶回這裡 #ack=<雜湊>&back=<原路徑>(開頭的 script 已經從網址拿掉,放在 MOVE_ACK_IN):
     這個分頁送出的就是那包、而且之後這台沒有新的進度(OUT.ackCheck)才寫 tr_move_done(跟按鈕搬完一樣,含指紋),再帶到新網址的原路徑。
     對不上就什麼都不寫,回一段說明,照常讓人再搬一次。回 true(已經帶走)、說明的段落,或 null(不是從新網址帶回來的) */
  async function takeAck() {
    const ack = window.MOVE_ACK_IN ? L.parseAck(window.MOVE_ACK_IN) : null;
    if (!ack) return null;
    let r = { ok: false };
    try { r = await OUT.ackCheck(localStorage, ack.hash); } catch (e) { r = { ok: false }; }
    if (!r.ok) {
      return say('剛剛自動搬過去的進度已經在新網址了，但這台現在的進度跟搬過去的那份對不上（可能之後又練習了），所以還沒標成搬好了：按「準備搬家」再搬一次就會補上，已經搬過的不會重複。', 'move-note');
    }
    markDone(ack.hash, false, r.fp);
    draw(say('搬好了，正在帶你到新網址 ' + M.newName + '…', 'move-done'), say('舊網址這裡的資料都還留著。'));
    await OUT.cleanup();
    location.replace(M.to + ack.back);
    return true;
  }

  function drawMoved(off) {
    let info = null;
    try { info = JSON.parse(localStorage.getItem('tr_move_done')); } catch (e) { info = null; }
    draw(say('這台已經搬過了' + (info && info.at ? '（' + new Date(info.at).toLocaleDateString('zh-TW') + '）' : '') + '。以後請直接用新網址 ' + M.newName + '。'),
      say('搬完之後如果又在舊網址練習，要再搬一次才會過去。'),
      off || null,
      STANDALONE ? say(APP_NOTE, 'move-note') : null,
      h('div', { class: 'modal-row' },
        off ? null : h('a', { class: 'btn primary', href: NEW_HOME }, '前往新網址'),
        h('button', { class: 'btn' + (off ? ' primary' : ''), type: 'button', onclick: () => drawStart() }, '再搬一次')));
  }

  function drawStart(extra) {
    const notes = [];
    if (extra) notes.push(extra);
    if (!online) notes.push(say(OFF_NOTE, 'move-note'));
    if (IN_APP) notes.push(say('你現在是在 LINE、Facebook 或 Instagram 裡面打開的。這裡的進度只存在這個 App 裡，請就在這裡搬：準備好之後按「複製搬家碼」，再用你以後要用的瀏覽器打開新網址貼上。', 'move-note'));
    if (IOS_APP) notes.push(say('你現在是在主畫面的 App 裡。主畫面 App 的進度跟 Safari 分開存，要用搬家碼：先在 Safari 打開 ' + M.newName + '，加到主畫面，打開新的 App；再回到這個舊的 App 按「複製搬家碼」，回新的 App 貼上。', 'move-note'));
    const btn = h('button', { class: 'btn primary', type: 'button' }, '準備搬家');
    const msg = h('div', { class: 'result-note' });
    btn.addEventListener('click', () => prepare(btn, msg));
    draw(say('拍謝！我們換網址了，因為名字跟別人重疊！新網址是 ' + M.newName + '。瀏覽器的資料是依網址分開存的，我幫你把這台的進度帶過去，在新網址就看得到。'),
      ...notes,
      say('搬家不會刪掉或改掉這裡的任何資料。搬的過程中請不要關掉這一頁。'),
      h('div', { class: 'modal-row' }, btn), msg,
      h('p', { style: 'margin-top:18px' }, h('button', { class: 'btn', type: 'button', onclick: markManual }, '我已經在新網址搬好了')),
      directLink(false));
  }

  function markManual() {
    if (!confirm('確定這台的進度已經在新網址了嗎？按確定之後，舊網址的每一頁都會直接帶你到新網址。')) return;
    markDone(null, true, fingerprint());
  }
  /* fp:準備搬家那一刻的指紋(手動標記是按下去那一刻);之後這台的資料跟它不一樣,舊網址會提示再搬一次 */
  function markDone(hash, manual, fp) {
    try { localStorage.setItem('tr_move_done', JSON.stringify({ to: M.to, hash: hash || null, fp: typeof fp === 'string' ? fp : null, at: Date.now(), manual: !!manual })); } catch (e) { /* 寫不進去:下次打開還會再問 */ }
    OUT.flags({ moved: true, hasData: true });
    draw(say('搬好了。以後請直接用新網址 ' + M.newName + '。', 'move-done'),
      say('舊網址這裡的資料都還留著。搬完之後如果又在舊網址練習，要再搬一次才會過去。'),
      STANDALONE ? say(APP_NOTE, 'move-note') : null,
      h('p', null, h('a', { class: 'btn primary', href: NEW_HOME }, '前往新網址')));
  }

  async function prepare(btn, msg) {
    btn.disabled = true;
    msg.textContent = '正在準備…';
    if (window.CLOUD && CLOUD.user && typeof CLOUD.flushForMove === 'function') msg.textContent = '正在把還沒同步的進度傳到雲端…';
    const acc = await OUT.flushAccounts();   // 登入著:先跟雲端對帳;失敗就用這台的帳本
    /* 跟每一頁的自動搬家同一套(MOVE_OUT.buildPack):裝置編號、指紋(跟組包同一刻,之後才有的進度舊網址會提示再搬一次)、collect、雜湊 */
    const { pack, summary, hash, fp } = await OUT.buildPack(localStorage, { from: location.origin, accounts: acc.accounts, uid: acc.uid });
    if (summary.tooBig.length) { drawTooBig(summary); return; }
    if (!summary.hasData) {
      draw(say('你的進度都已經在雲端。到新網址登入同一個帳號，進度就會回來。'), STANDALONE ? say(APP_NOTE, 'move-note') : null, h('p', null, h('button', { class: 'btn primary', type: 'button', onclick: () => goNew(true) }, '前往新網址')));
      return;
    }
    let code = '';
    P.toCode(pack, hash).then((c) => { code = c; }, () => { code = ''; });
    drawReady(pack, hash, summary, () => code, fp);
  }

  function summaryList(s) {
    const li = [];
    if (s.profiles) li.push('學生檔案 ' + s.profiles + ' 個');
    if (s.banks.length) li.push('自訂單字題庫 ' + s.banks.length + ' 個：' + s.banks.map((n) => '「' + (n || '未命名') + '」').join('、'));
    li.push(s.pet ? '小雞：有' : '小雞：沒有');
    li.push('練習紀錄 ' + s.hist + ' 筆');
    if (s.accountItems) li.push('帳號還沒上傳到雲端的進度 ' + s.accountItems + ' 項（到新網址登入同一個帳號時合併）');
    if (s.unknown) li.push('這台還有 ' + s.unknown + ' 個認不得的資料，不會搬，也不會刪');
    if (s.unreadable) li.push('有 ' + s.unreadable + ' 個讀不懂（已經壞掉）的資料，不會搬，也不會刪：' + s.unreadableNames.map((n) => '「' + n + '」').join('、'));
    return h('ul', { class: 'move-list' }, li.map((t) => h('li', null, t)));
  }

  /* 有一項太大、或項目與帳號太多(超過 MOVE_RULES.LIMITS),這個方法搬不過去:不給送出,免得搬完把這台標成「搬好了」、每一頁都帶走,那一項卻沒過去 */
  function drawTooBig(s) {
    draw(say('這台的' + s.tooBig.map((n) => '「' + n + '」').join('、') + '超過一次搬家的上限，這次沒辦法搬過去，所以先不搬，這台什麼都沒改。'),
      say('你的資料都還在這台裝置上，不會不見。請先不要清除這個瀏覽器的資料，告訴我們這個情形，我們會另外處理。'),
      directLink(false));
  }

  function drawReady(pack, hash, s, codeOf, fp) {
    const status = h('div', { class: 'result-note', 'aria-live': 'polite' });
    let child = null, link = null;
    const send = h('button', { class: 'btn primary', type: 'button' }, '送到新網址');
    /* 新網址連不上:先不給送出,給「再連一次新網址」;連上了換回送出。搬家檔、搬家碼照樣能用 */
    const retry = h('button', { class: 'btn primary', type: 'button' }, '再連一次新網址');
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      status.textContent = '正在連新網址…';
      online = await reach();
      retry.disabled = false;
      if (online) { retry.replaceWith(send); status.textContent = '連上了，可以按「送到新網址」。'; }
      else status.textContent = '還是連不上新網址。可以先用「下載搬家檔」或「複製搬家碼」，到新網址打開搬家頁再讀進去。';
    });
    send.addEventListener('click', () => {
      child = window.open(M.to + '/move-in.html', '_blank');   // 點擊當下同步開,網址不帶任何參數
      if (!child) { status.textContent = '新分頁開不出來（可能被擋了）。請改用下面的「下載搬家檔」或「複製搬家碼」。'; return; }
      if (link) link.stop();
      link = L.sender({ win: window, to: M.to, child: () => child, pack, hash,
        onHello: () => { status.textContent = '新網址收到了，請到新分頁確認。'; },
        onDone: () => { if (link) link.stop(); markDone(hash, false, fp); } });
      status.textContent = '已經打開新網址的分頁，正在等它回應…';
    });
    const file = h('button', { class: 'btn', type: 'button', onclick: () => saveFile(pack, hash, status) }, '下載搬家檔');
    const copy = h('button', { class: 'btn', type: 'button', onclick: () => copyCode(codeOf(), status) }, '複製搬家碼');
    const showCode = h('button', { class: 'btn', type: 'button', onclick: () => {
      const c = codeOf();
      if (!c) { status.textContent = '搬家碼還在準備，請再按一次。'; return; }
      const ta = h('textarea', { class: 'modal-input', rows: '4', readonly: 'readonly', style: 'width:100%;font-size:12px', 'aria-label': '搬家碼' });
      ta.value = c;
      showCode.replaceWith(ta);
      ta.select();
    } }, '顯示搬家碼');
    draw(say('這台要搬的：'), summaryList(s),
      h('div', { class: 'modal-row', style: 'flex-wrap:wrap' }, IN_APP || IOS_APP ? null : (online ? send : retry), copy, file, showCode), status,
      IOS_APP ? say('主畫面 App 要用「複製搬家碼」：到新的 App 打開「我的」，按「我有搬家碼或搬家檔」，貼上。', 'move-note') : null,
      say('搬家檔與搬家碼裡面是你的練習紀錄，不要傳給別人。裡面沒有登入密碼。'),
      directLink(false));
  }

  async function saveFile(pack, hash, status) {
    const text = P.toFileText(pack, hash), name = P.fileName(Date.now());
    try {
      if (IS_IOS && navigator.canShare && typeof File === 'function') {
        const f = new File([text], name, { type: 'application/json' });
        if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); status.textContent = '存好之後，到新網址的搬家頁選這個檔案。'; return; }
      }
    } catch (e) { if (e && e.name === 'AbortError') return; /* 分享不了就改下載 */ }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    status.textContent = '已經下載「' + name + '」。到新網址的搬家頁選這個檔案。';
  }
  function copyCode(code, status) {
    if (!code) { status.textContent = '搬家碼還在準備，請再按一次。'; return; }
    const done = () => { status.textContent = '搬家碼已經複製。到新網址 ' + M.newName + ' 的搬家頁，貼在「貼上搬家碼」那一格。'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => { status.textContent = '複製不了，請按「顯示搬家碼」自己全選複製。'; });
    else status.textContent = '複製不了，請按「顯示搬家碼」自己全選複製。';
  }

  start().catch(() => draw(say('這一頁出了問題。你的進度都還在這台裝置上，不會不見。請重新整理再試一次。'), directLink(false)));
})();
