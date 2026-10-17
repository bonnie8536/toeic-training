/* 站長後台「收費管理」的查帳號(前端計畫九.2):輸入 Email 或帳號 id,呼叫 owner_lookup。
   顯示目前使用權、每一段使用權(撤銷、恢復、改到期日、拿掉到期日)、付款(退款要再按一次)、寫作批改紀錄、異動紀錄。
   調整使用權只走 owner_update_grant,參數空白一律代表不改(資料庫的規則):
     撤銷 (id, null, null, true);恢復 (id, null, null, false);改到期日 (id, null, 新的完整到期日, null);
     拿掉到期日只限 legacy 與贈送 (id, null, null, null, 備註, true)。
   退款只走 owner_refund_payment。名字、備註、班名一律用 textContent。
   帳號下面一排「記一筆收款」「贈送」「更正寫作批改篇數」(js/admin-owner-billing.js,站長自己的帳號沒有)。
   查另一個帳號時舊的內容先拿掉;每個確認框第一行寫帳號(只寫 Email,不加「帳號：」);做完一件事重讀的是做的那個帳號(不是畫面上剛好換成的帳號)。 */
(function () {
  const O = window.ADMIN_OWNER;
  if (!O) return;
  const { text, api, dialog, arr, str, isObj } = O;

  function lookupPanel(opts) {
    opts = opts || {};
    const ownerId = opts.ownerId;
    let seq = 0, current = null, loading = false, after = '', focusItem = '', stale = false;
    let items = new Map();

    const input = h('input', { class: 'auth-input', id: 'ow-who', name: 'who', type: 'text', autocomplete: 'off', placeholder: 'Email 或帳號 id', enterkeyhint: 'search' });
    const form = h('form', { class: 'ow-lookup-form', novalidate: 'novalidate', role: 'search' },
      h('label', { for: 'ow-who', class: 'ow-lookup-label' }, '帳號'), h('div', { class: 'ow-lookup-row' }, input, h('button', { class: 'btn primary', type: 'submit' }, '查詢')));
    const msg = h('p', { class: 'ow-msg', role: 'status', tabindex: '-1' });
    const say = (t, kind) => { msg.textContent = t || ''; msg.className = 'ow-msg' + (kind ? ' ' + kind : ''); };
    const detail = h('div', { class: 'ow-detail' });
    const el = h('div', { class: 'ow-lookup' }, form, msg, detail);

    form.addEventListener('submit', e => { e.preventDefault(); const w = str(input.value).trim(); if (!w) { say('請輸入 Email 或帳號 id。', 'bad'); input.focus(); return; } run(w); });

    /* keep:做完一件事重讀同一個帳號,舊的內容留著(只是不能按),畫面不跳;查別的帳號就先拿掉舊的 */
    async function run(who, keep) {
      const s = ++seq;
      loading = true; stale = false;
      if (keep) { detail.setAttribute('inert', ''); detail.setAttribute('aria-busy', 'true'); }
      else { detail.innerHTML = ''; items = new Map(); current = null; say('讀取中'); }
      const r = await api.lookup(who);
      if (s !== seq) return false;
      loading = false;
      detail.removeAttribute('inert'); detail.removeAttribute('aria-busy');
      const pending = after; after = '';
      if (!r.ok) { current = null; detail.innerHTML = ''; items = new Map(); say((pending ? pending + ' ' : '') + r.message, 'bad'); return false; }
      current = r.data;
      draw(r.data);
      say(pending, pending ? 'ok' : '');
      return true;
    }
    /* 做完一件事:d 是按下去那時候畫面上的帳號。畫面還是他就重讀他;已經換成別人(或正在讀別人),只寫他做完了什麼。
       done 是字串(做完了),或 { text, bad: true }(不確定有沒有做到,要她先核對) */
    async function reread(done, d, key) {
      if (opts.onChanged) opts.onChanged();
      const t = typeof done === 'string' ? done : str(done && done.text);
      const kind = isObj(done) && done.bad ? 'bad' : 'ok';
      const id = str(d.user_id) || str(d.email);
      const label = '「' + (str(d.email) || id) + '」' + t;
      if (loading || !current || str(current.user_id) !== str(d.user_id)) {
        if (loading) after = label; else say(label, kind);
        return;
      }
      focusItem = key || '';
      const okk = await run(id, true);
      if (okk) say(t, kind);
      refocus();
    }
    /* 重畫以後焦點回到同一段使用權或同一筆付款的第一顆按鈕;那一列沒有按鈕就放在那一列,都沒有就放在訊息 */
    function refocus() {
      const key = focusItem; focusItem = '';
      if (!key) return;
      const li = items.get(key);
      const target = (li && li.tagName === 'BUTTON') ? li : (li && firstButton(li)) || li || msg;
      if (target === li && li.tagName !== 'BUTTON') li.setAttribute('tabindex', '-1');
      try { target.focus(); } catch (e) { /* 不在畫面上 */ }
    }
    const buttons = new WeakMap();
    const firstButton = li => (buttons.get(li) || [])[0] || null;

    function section(title, ...kids) {
      return h('section', { class: 'ow-sec' }, text('h3', 'ow-sec-h', title), ...kids);
    }
    function empty(t) { return text('p', 'ow-empty-line', t); }

    function draw(d) {
      detail.innerHTML = '';
      items = new Map();
      const a = isObj(d.access) ? d.access : {};
      const now = a.server_now || null;
      const head = h('div', { class: 'ow-who' }, text('div', 'ow-name ow-who-mail', str(d.email)), text('div', 'ow-who-id', str(d.user_id)),
        h('div', { class: 'ow-meta' }, text('span', null, '註冊 ' + (O.fmtDate(d.created_at) || '不明')), text('span', null, '最近登入 ' + (O.fmtDate(d.last_sign_in_at) || '沒有紀錄'))));
      detail.append(head);
      if (O.billing && a.is_owner !== true) detail.append(billingActs(d));

      /* 目前使用權 */
      const cur = [];
      cur.push(text('p', 'ow-cur-role', a.is_owner === true ? '站長' : a.role === 'teacher' ? '老師' : '學生'));
      const s = O.statusText(a, now);
      if (s) cur.push(text('p', 'ow-status' + (a.active === false ? ' is-off' : ''), s));
      const t = O.teacherText(O.teacherOf(a), now);
      if (t) cur.push(text('p', 'ow-teacher', t));
      const log = arr(d.credit_log);
      if ((Number(a.credits) || 0) > 0 || log.length) cur.push(text('p', 'ow-credits', O.creditsLeft(a.credits)));
      detail.append(section('目前使用權', ...cur));

      /* 使用權 */
      const grants = arr(d.grants);
      const gl = h('ul', { class: 'ow-items' });
      grants.forEach(g => gl.append(grantRow(g, d, now)));
      detail.append(section('使用權', grants.length ? gl : empty('沒有任何一段使用權')));

      /* 付款(新的在上面) */
      const pays = arr(d.payments).slice().reverse();
      const pl = h('ul', { class: 'ow-items' });
      pays.forEach(p => pl.append(payRow(p, d, now)));
      detail.append(section('付款', pays.length ? pl : empty('沒有付款紀錄')));

      /* 寫作批改紀錄(新的在上面) */
      if (log.length) {
        const cl = h('ul', { class: 'ow-items ow-plain' });
        log.slice().reverse().forEach(l => {
          const c = O.creditText(l);
          const li = h('li', { class: 'ow-item' }, h('div', { class: 'ow-item-top' }, text('span', 'ow-when', c.when), text('span', 'ow-item-text', c.text)));
          if (c.note) li.append(text('p', 'ow-item-note', c.note));
          cl.append(li);
        });
        detail.append(section('寫作批改紀錄', cl));
      }

      /* 異動紀錄(新的在上面) */
      const hist = arr(d.history).slice().reverse();
      const hl = h('ul', { class: 'ow-items ow-plain' });
      hist.forEach(x => {
        const r = O.historyText(x, ownerId, d);
        const li = h('li', { class: 'ow-item' }, h('div', { class: 'ow-item-top' }, text('span', 'ow-when', r.when), text('span', 'ow-who-tag', r.who), text('span', 'ow-item-text', r.text)));
        if (r.note) li.append(text('p', 'ow-item-note', r.note));
        hl.append(li);
      });
      detail.append(section('異動紀錄', hist.length ? hl : empty('沒有異動紀錄')));
    }

    /* 記一筆收款、贈送、更正:表單在 js/admin-owner-billing.js,做完重讀這個帳號,焦點回到同一顆按鈕 */
    function billingActs(d) {
      const row = h('div', { class: 'ow-acts-row' });
      [['記一筆收款', 'record'], ['贈送', 'comp'], ['更正寫作批改篇數', 'adjust']].forEach(([label, fn]) => {
        const b = h('button', { class: 'btn ow-act', type: 'button', 'aria-label': label + '（' + (str(d.email) || str(d.user_id)) + '）' });
        b.textContent = label;
        const go = async () => { const done = await O.billing[fn](d, b, ownerId); if (done) await reread(done, d, 'act:' + fn); };
        b.addEventListener('click', () => { go(); });   // 不回傳 promise:視窗開著的時候按鈕事件已經結束
        items.set('act:' + fn, b);
        row.append(b);
      });
      return row;
    }

    /* 一顆動作按鈕;aria-label 寫是哪一段或哪一筆(同一頁有好幾顆「退款」) */
    function act(li, label, what, fn, cls) {
      const b = h('button', { class: 'ac-btn' + (cls ? ' ' + cls : ''), type: 'button', 'aria-label': label + ' ' + what });
      b.textContent = label;
      b.addEventListener('click', () => { fn(b); });
      const list = buttons.get(li) || [];
      list.push(b); buttons.set(li, list);
      return b;
    }

    /* 這段使用權的付款;退過款回 { amount, full } */
    function refundOf(g, d) {
      const p = g.payment_id ? arr(d.payments).find(x => x.id === g.payment_id) : null;
      if (!p || p.status !== 'refunded') return null;
      const amount = p.refund_amount == null ? Number(p.amount) || 0 : Number(p.refund_amount) || 0;
      return { amount, full: amount >= (Number(p.amount) || 0) };
    }

    function grantRow(g, d, now) {
      const a = isObj(d.access) ? d.access : {};
      const state = O.grantState(g, now);
      const what = O.grantText(g);
      const li = h('li', { class: 'ow-item ow-grant' + (g.revoked_at || state === '已結束' ? ' is-off' : '') },
        h('div', { class: 'ow-item-top' }, text('span', 'ow-item-text', what), text('span', 'ow-state', state)));
      items.set('g:' + g.id, li);
      if (g.note) { const n = O.noteText(g.note); if (n) li.append(text('p', 'ow-item-note', n)); }
      const acts = h('div', { class: 'ow-item-acts' });
      const refunded = g.revoked_at ? refundOf(g, d) : null;
      if (!g.revoked_at) {
        acts.append(act(li, '撤銷', what, b => revoke(g, d, b), 'ac-remove'), act(li, '改到期日', what, b => setEnd(g, d, b)));
        if ((g.source === 'legacy' || g.source === 'comp') && g.ends_at) acts.append(act(li, '拿掉到期日', what, b => clearEnd(g, d, b)));
      } else if (g.kind === 'teacher' && a.role === 'student') {
        li.append(text('p', 'ow-item-note', '要讓他再當老師，請在帳號清單用改角色。'));
      } else if (refunded && refunded.full) {
        li.append(text('p', 'ow-item-note', '這筆付款已退款，要再給他使用權請用贈送。'));
      } else {
        acts.append(act(li, '恢復', what, b => restore(g, d, refunded, b)));
      }
      if (acts.children.length) li.append(acts);
      return li;
    }

    const base = g => ({ p_grant: g.id, p_starts_at: null, p_ends_at: null });
    const whoOf = d => str(d.email) || str(d.user_id);
    const isNow = (g, now) => !g.revoked_at && Date.parse(g.starts_at) <= now && (!g.ends_at || Date.parse(g.ends_at) > now);
    /* 拿掉一段老師方案(撤銷或退款)對他的學生的影響;他還有別段在期內的就照舊 */
    function teacherLine(d, g, now) {
      const others = arr(d.grants).filter(x => x.kind === 'teacher' && (!g || x.id !== g.id) && isNow(x, now));
      if (others.length) return '他還有另一段老師方案在期內，學生進度與班上學生的使用權照舊。';
      if (g && isNow(g, now)) return '他的老師方案會立刻結束，沒有寬限；他會讀不到學生進度，班上學生也不再由他的方案提供使用權。';
      return '如果這是他唯一的老師方案，他會讀不到學生進度，班上學生也不再由他的方案提供使用權。';
    }
    const nowOf = d => { const t = Date.parse(isObj(d.access) ? d.access.server_now : ''); return isFinite(t) ? t : Date.now(); };
    /* 退掉 g 之後會往前接的付費方案(資料庫 _refund_payment → _requeue_paid):同一種、還沒開始、排在 g 結束以後;
       退老師方案時,接在老師方案後面的學生方案也算(2026-10-17 第二輪複審) */
    function queuedAfter(d, g, now) {
      if (!g || !g.ends_at) return [];
      const end = Date.parse(g.ends_at);
      return arr(d.grants).filter(x => x.id !== g.id && !x.revoked_at && x.source === 'paid'
        && (x.kind === g.kind || (g.kind === 'teacher' && x.kind === 'student'))
        && Date.parse(x.starts_at) > now && Date.parse(x.starts_at) >= end);
    }

    async function revoke(g, d, b) {
      const lines = [O.grantText(g), '這段使用權會立刻失效，資料不會刪除，之後可以按恢復。'];
      if (g.kind === 'teacher') lines.push(teacherLine(d, g, nowOf(d)));
      const r = await dialog({ title: '撤銷這段使用權？', who: whoOf(d), lines, ok: '撤銷', danger: true, from: b,
        submit: () => api.updateGrant(Object.assign(base(g), { p_revoked: true })) });
      if (r) await reread('已撤銷。', d, 'g:' + g.id);
    }
    async function restore(g, d, refunded, b) {
      const lines = [O.grantText(g), '恢復後照原本的起訖日期計算。'];
      if (refunded) lines.push('這筆付款已退款 ' + O.money(refunded.amount) + '，恢復後他照樣可以用到 ' + (g.ends_at ? O.fmtDate(g.ends_at) : '沒有期限') + '，帳上仍記已退款。');
      const r = await dialog({ title: '恢復這段使用權？', who: whoOf(d), lines, ok: '恢復', from: b,
        confirmTwice: () => (refunded ? '已退款，再按一次確定恢復' : null),
        submit: () => api.updateGrant(Object.assign(base(g), { p_revoked: false })) });
      if (r) await reread('已恢復。', d, 'g:' + g.id);
    }
    async function setEnd(g, d, b) {
      const start = Date.parse(g.starts_at);
      const r = await dialog({ title: '改到期日', who: whoOf(d), lines: [O.grantText(g), '這段使用權會用到選的那一天（台北時間當天結束），選今天以前的日期會立刻結束。'],
        fields: [{ name: 'until', label: '新的到期日', type: 'date', value: g.ends_at ? O.dateInput(g.ends_at) : O.defaultUntilDate(Date.now()),
          check: v => { const u = O.untilFromDate(v); if (!u) return '請選到期日。'; return !isFinite(start) || Date.parse(u) > start ? '' : '到期日要晚於開始日。'; } }, O.noteField()],
        ok: '改到期日', from: b,
        submit: v => api.updateGrant(Object.assign(base(g), { p_ends_at: O.untilFromDate(v.until), p_revoked: null, p_note: O.noteOf(v) })) });
      if (r) await reread('已改到期日。', d, 'g:' + g.id);
    }
    async function clearEnd(g, d, b) {
      const r = await dialog({ title: '拿掉到期日？', who: whoOf(d), lines: [O.grantText(g), '拿掉以後，這段使用權沒有期限。'], fields: [O.noteField()], ok: '拿掉到期日', from: b,
        submit: v => api.updateGrant(Object.assign(base(g), { p_revoked: null, p_note: O.noteOf(v), p_clear_end: true })) });
      if (r) await reread('已拿掉到期日。', d, 'g:' + g.id);
    }

    function payRow(p, d) {
      const x = O.paymentText(p);
      const li = h('li', { class: 'ow-item ow-pay' + (p.status === 'refunded' ? ' is-off' : '') },
        h('div', { class: 'ow-item-top' }, text('span', 'ow-when', x.when), text('span', 'ow-item-text', x.item), text('span', 'ow-amount', x.amount),
          text('span', 'ow-method', x.method), text('span', 'ow-state', x.state)));
      items.set('p:' + p.id, li);
      if (x.note) li.append(text('p', 'ow-item-note', x.note));
      if (p.status === 'paid') li.append(h('div', { class: 'ow-item-acts' }, act(li, '退款', x.when + ' ' + x.item + ' ' + x.amount, b => refund(p, d, b), 'ac-remove')));
      return li;
    }

    /* 退款:確認框寫後果;第一次按「退款」只變成「再按一次」,第二次才送 */
    async function refund(p, d, b) {
      const x = O.paymentText(p);
      const full = Number(p.amount) || 0;
      const g = arr(d.grants).find(k => k.payment_id === p.id);
      const lines = [x.when + ' ' + x.item + ' ' + x.amount + ' ' + x.method];
      if (p.item === 'credits') lines.push('會收回這一包還沒用掉的批改篇數，已經用掉的不收回。');
      else if (g && g.revoked_at) lines.push('這筆付款開通的方案已經撤銷，退款不會再改變他的使用權。');
      else {
        const later = queuedAfter(d, g, nowOf(d));
        lines.push('這筆付款開通的方案會立刻撤銷。');
        if (later.length) lines.push('排在它後面、還沒開始的付費方案會往前移，接上他現在的使用期間，長度不變。');
        if (p.item === 'teacher' && !later.some(x => x.kind === 'teacher')) lines.push(teacherLine(d, g, nowOf(d)));
      }
      lines.push('這裡只記帳，錢要另外轉回給他。');
      const amountOf = v => Number(str(v.amount).trim());
      const r = await dialog({ title: '退這筆款？', who: whoOf(d), lines, ok: '退款', danger: true, from: b,
        fields: [{ name: 'amount', label: '退款金額（元）', type: 'number', maxlength: 7, value: String(full),
          check: v => (/^\d+$/.test(str(v).trim()) && +v <= full ? '' : '退款金額要在 0 到 ' + full + ' 元之間。') }, O.noteField()],
        confirmTwice: v => '再按一次，確定退款 ' + O.money(amountOf(v)),
        submit: v => api.refund({ p_payment: p.id, p_amount: amountOf(v) === full ? null : amountOf(v), p_note: O.noteOf(v) }) });
      if (!r) return;
      const back = isObj(r) ? Number(r.credits_taken_back) || 0 : 0;
      await reread('已記下退款' + (back > 0 ? '，收回 ' + back + ' 篇寫作批改' : '') + '。', d, 'p:' + p.id);
    }

    return {
      el,
      open: who => { input.value = str(who); return run(str(who)); },
      focus: () => { if (!current) input.focus(); },
      /* 別的地方改了資料(帳號清單、學生進度的寫作批改):下一次打開查帳號時重讀畫面上的帳號 */
      stale: () => { stale = true; },
      show: () => { if (stale && current && !loading) run(str(current.user_id) || str(current.email), true); },
    };
  }

  O.lookupPanel = lookupPanel;
})();
