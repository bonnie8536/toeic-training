/* 衝衝英文搬家:新網址每一頁的提示(搬家計畫 2.6、2.7、2.12)。js/app-shell.js 只在新網址(MOVE.onNew)載入它,前面要先載 js/move-config.js。
   一次只出現一條,依序:
   1. 上次搬到一半分頁被關,js/common.js 已經照日誌處理過(tr_move_restored):請再搬一次。
   2. 這台有從舊網址搬來、還沒合併的帳號進度(tr_move_pending_<帳號 id>),目前卻沒登入那個帳號:請登入一次(每一頁都出現)。
   3. 從切換日起,還沒搬過(沒有 tr_move_log)也沒按過「沒有」:以前在舊網址練習過?先搬再開始。
      但這一頁是舊網址帶過來的(document.referrer 是舊網址):舊網址那邊已經判斷過(沒資料、搬過了、或按了「不用，直接去新網址」),
      不再問,直接記成按過「沒有」(tr_move_hint_off);「我的」頁的入口照樣留著。
   「我的」頁另外一直留一個「從舊網址搬進度」的入口。
   iPhone 主畫面 App 裡:按鈕改成「貼上搬家碼」(move-in.html)。主畫面 App 的資料跟 Safari 分開存,從這裡連到舊網址會開在 Safari,
   拿不到舊的主畫面 App 的資料;舊的 App 只用文字說明怎麼做。
   也回應收件頁的 BroadcastChannel('rushup-move'):問「還有誰開著」就回答;收件頁寫完叫大家重新整理就重新整理。
   只讀 localStorage,只寫 tr_move_hint_off(按「沒有」,或從舊網址帶過來)與刪 tr_move_restored(看過提示)。畫面只用 textContent。 */
(function (root) {
  'use strict';
  const M = root.MOVE;
  if (!M || !M.onNew) return;
  const OLD_PAGE = M.from[0] + '/move-out.html';
  const PEND = /^tr_move_pending_([0-9a-f-]{36})$/;
  const NAV = root.navigator || {};
  const IOS_APP = (/iPhone|iPad|iPod/.test(NAV.userAgent || '') || (NAV.platform === 'MacIntel' && NAV.maxTouchPoints > 1))
    && (function () { try { return root.matchMedia('(display-mode: standalone)').matches || NAV.standalone === true; } catch (e) { return NAV.standalone === true; } })();

  function get(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function signedInId() {
    try {
      for (let i = 0; i < root.localStorage.length; i++) {
        const k = root.localStorage.key(i);
        if (k && /^sb-[a-z0-9]+-auth-token$/.test(k)) { const u = (JSON.parse(root.localStorage.getItem(k)) || {}).user; return u && typeof u.id === 'string' ? u.id : ''; }
      }
    } catch (e) { /* 讀不到就當沒登入 */ }
    return '';
  }
  function pendingFor() {
    const out = [];
    try { for (let i = 0; i < root.localStorage.length; i++) { const m = PEND.exec(root.localStorage.key(i) || ''); if (m) out.push(m[1]); } } catch (e) { /* 沒有 */ }
    return out;
  }
  /* 純判斷,測試直接呼叫 */
  function which(s) {
    if (s.restored) return 'restored';
    if (s.pending.some((id) => id !== s.uid)) return 'pending';
    if (!s.log && !s.hintOff) return s.fromOld ? 'hint-skip' : 'hint';
    return '';
  }

  function el(tag, attrs, text) {
    const n = root.document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    if (text) n.textContent = text;
    return n;
  }
  function bar(text, buttons) {
    const d = root.document;
    if (d.getElementById('move-bar')) return;
    const box = el('div', { id: 'move-bar', role: 'region', 'aria-label': '搬家提示',
      style: 'background:var(--primary-tint,#e9f4fc);border-bottom:1px solid var(--line,#e3e8ed);padding:10px 16px;font-size:15px;line-height:1.6;position:relative;z-index:50' });
    const inner = el('div', { style: 'max-width:960px;margin:0 auto;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center' });
    inner.appendChild(el('span', { style: 'flex:1 1 260px' }, text));
    buttons.forEach((b) => {
      const btn = el(b.href ? 'a' : 'button', Object.assign({ class: 'btn' + (b.primary ? ' primary' : ''), style: 'white-space:nowrap' }, b.href ? { href: b.href } : { type: 'button' }), b.label);
      if (b.onClick) btn.addEventListener('click', b.onClick);
      inner.appendChild(btn);
    });
    box.appendChild(inner);
    d.body.insertBefore(box, d.body.firstChild);
  }
  const close = () => { const x = root.document.getElementById('move-bar'); if (x) x.remove(); };

  function fromOld() {
    try { const r = root.document.referrer; return !!r && M.from.indexOf(new URL(r).origin) > -1; } catch (e) { return false; }
  }
  function draw() {
    const s = { restored: get('tr_move_restored') !== null, pending: pendingFor(), uid: signedInId(), log: get('tr_move_log') !== null, hintOff: get('tr_move_hint_off') === '1', fromOld: fromOld() };
    const kind = which(s);
    if (kind === 'hint-skip') { try { root.localStorage.setItem('tr_move_hint_off', '1'); } catch (e) { /* 下一頁不是從舊網址來的就會問 */ } }
    if (kind === 'restored') {
      bar(IOS_APP ? '上次搬家搬到一半就關掉了。已經合併好的留著，其他的換回搬之前的樣子。請在舊的 App 重新複製搬家碼，再貼一次，把沒搬完的補上。' : '上次搬家搬到一半就關掉了。已經合併好的留著，其他的換回搬之前的樣子。請回舊網址再搬一次，把沒搬完的補上。', [
        IOS_APP ? { label: '貼上搬家碼', primary: true, href: 'move-in.html' } : { label: '回舊網址搬', primary: true, href: OLD_PAGE },
        { label: '知道了', onClick: () => { try { root.localStorage.removeItem('tr_move_restored'); } catch (e) { /* 下一頁再出現 */ } close(); } },
      ]);
    } else if (kind === 'pending') {
      const P = root.PROFILE;
      bar('這台有一些從舊網址搬來、還沒合併的帳號進度。請登入原本的帳號一次，就會合併進去。',
        P && typeof P.showLogin === 'function' && !s.uid ? [{ label: '登入', primary: true, onClick: () => P.showLogin('login') }] : []);
    } else if (kind === 'hint') {
      bar(IOS_APP ? '以前在 ' + M.oldName + ' 練習過？在舊網址的搬家頁（舊的主畫面 App 或 Safari 裡）按「複製搬家碼」，再回到這個 App 貼上。'
        : '以前在 ' + M.oldName + ' 練習過？先把那台的進度搬過來再開始，比較不會兩邊不一樣。', [
        IOS_APP ? { label: '貼上搬家碼', primary: true, href: 'move-in.html' } : { label: '搬進度', primary: true, href: OLD_PAGE },
        { label: '沒有', onClick: () => { try { root.localStorage.setItem('tr_move_hint_off', '1'); } catch (e) { /* 下一頁再問 */ } close(); } },
      ]);
    }
    const page = (root.location.pathname.split('/').pop() || 'index.html');
    if (page === 'me.html') {
      const main = root.document.querySelector('main');
      if (main && !root.document.getElementById('move-entry')) {
        const box = el('section', { id: 'move-entry', class: 'q-block', style: 'margin-top:24px' });
        box.appendChild(el('h2', { style: 'font-size:18px;margin:0 0 6px' }, '從舊網址搬進度'));
        box.appendChild(el('p', { class: 'result-note', style: 'margin:0 0 10px' }, '以前在 ' + M.oldName + ' 練習過的，在那台裝置打開舊網址的搬家頁，就能把進度搬過來。'));
        const row = el('div', { class: 'modal-row', style: 'flex-wrap:wrap' });
        row.appendChild(el('a', { class: 'btn', href: OLD_PAGE }, '打開舊網址的搬家頁'));
        row.appendChild(el('a', { class: 'btn', href: 'move-in.html' }, '我有搬家碼或搬家檔'));
        box.appendChild(row);
        main.appendChild(box);
      }
    }
  }

  /* 收件頁問「還有誰開著」:回答;收件頁寫完叫大家重新整理 */
  try {
    const ch = new root.BroadcastChannel('rushup-move');
    ch.onmessage = (ev) => {
      const d = ev && ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.t === 'who' && typeof d.id === 'string') ch.postMessage({ t: 'here', id: d.id });
      if (d.t === 'reload') root.location.reload();
    };
  } catch (e) { /* 沒有 BroadcastChannel 的瀏覽器:收件頁會改成請使用者自己確認 */ }

  root.MOVE_IN_BOOT = Object.freeze({ which, iosApp: IOS_APP });
  if (root.document.body) draw(); else root.document.addEventListener('DOMContentLoaded', draw);
})(typeof window !== 'undefined' ? window : globalThis);
