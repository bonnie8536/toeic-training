/* 付費牆與「我的」頁的方案資訊(前端計畫五、六)。
   - 只在 window.PAID_UI === true(js/plans-config.js)而且雲端有開時才動畫面;沒開時一個節點都不碰。
   - 只看 js/cloud.js 已經查好的 CLOUD.access,不另外查 my_access,也不碰同步(store、push、灌資料)。
   - 不知道使用權(null、錯誤、逾時、離線)一律不擋;只有 CLOUD.locked() 為真(這個分頁從伺服器拿到 active false)才蓋遮罩。
   - 遮罩只蓋在畫面上:底下的頁面照常載入,本機資料一筆都不動。
   - localStorage 只讀寫自己的新鍵 tr_trial_note_closed(試用提示條關掉了哪一個到期日)。
   做法參考 Quizlet、Duolingo、Notion:鎖住的功能用一個置中的視窗說明原因與日期,主要按鈕是看方案;
   資料不刪、到期也看得到自己的紀錄;試用快結束時頁首一條可以關掉的提示,寫出到期日。
   使用者自己取的名字(班名)一律用文字節點放進畫面。 */
(function () {
  const BANNER_KEY = 'tr_trial_note_closed';
  const TZ_MS = 8 * 3600e3;   // 日期一律用台北時間顯示
  const PAID_PAGES = ['reading', 'practice', 'listening', 'grammar', 'vocab', 'mock', 'review', 'dialogue', 'phonics'];
  const SEATS = [10, 30, 60];

  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  function enabled() { return window.PAID_UI === true; }
  function cloud() { return window.CLOUD && typeof window.CLOUD === 'object' ? window.CLOUD : null; }

  /* ---------- 純邏輯(tools/test_paywall.js 測) ---------- */

  /* 這一頁要不要擋:'paid' 功能頁、'writing' 寫作頁(有批改篇數就放行)、null 不擋。
     不規則動詞表(grammar.html?ref=verbs,沒有指定課程時)是查表頁,跟 verbs.html 一樣不擋。
     網址照 grammar.js 的讀法(getParam 就是 URLSearchParams,鍵與值都解碼);u 要是 TOEIC.grammar 裡真的課程,
     grammar.js 才畫課程(那是付費內容),否則 ref=verbs 畫的是動詞表。教材沒載入時退回「u 有值就算課程」。 */
  function pageKind(pathname, search) {
    const name = String(pathname || '').split('/').pop().toLowerCase().replace(/\.html$/, '');
    if (name === 'writing') return 'writing';
    if (PAID_PAGES.indexOf(name) < 0) return null;
    if (name === 'grammar') {
      let sp;
      try { sp = new URLSearchParams(String(search || '')); } catch (e) { return 'paid'; }
      const u = sp.get('u');
      const units = window.TOEIC && Array.isArray(window.TOEIC.grammar) && window.TOEIC.grammar.length ? window.TOEIC.grammar : null;
      const isUnit = units ? units.some(x => isObj(x) && x.id === u) : !!u;
      if (!isUnit && sp.get('ref') === 'verbs') return null;
    }
    return 'paid';
  }

  function ymd(iso) {
    if (typeof iso !== 'string' || !iso) return null;
    const t = Date.parse(iso);
    if (!isFinite(t)) return null;
    const d = new Date(t + TZ_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  /* 「10 月 11 日」 */
  function fmtDay(iso) { const p = ymd(iso); return p ? p.m + ' 月 ' + p.d + ' 日' : ''; }
  /* 「2026/11/04」 */
  function fmtDate(iso) {
    const p = ymd(iso);
    const two = n => (n < 10 ? '0' : '') + n;
    return p ? p.y + '/' + two(p.m) + '/' + two(p.d) : '';
  }
  /* 跟現在同一年就寫「10 月 11 日」,不同年才帶年份「2025/03/12」 */
  function dayText(iso, nowIso) {
    const p = ymd(iso), n = ymd(nowIso) || ymd(new Date().toISOString());
    if (!p) return '';
    return n && n.y === p.y ? fmtDay(iso) : fmtDate(iso);
  }
  const NB = ' ';   // 數字與單位、「到」與日期之間不換行
  function money(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + NB + '元'; }

  function classesOf(a) { return Array.isArray(a.classes) ? a.classes.filter(isObj) : []; }

  /* 試用結束超過這麼久,遮罩就不再寫「試用已結束」與那個舊日期(多半是既有帳號或贈送到期、被改成學生的老師) */
  const OLD_TRIAL_MS = 14 * 864e5;

  /* 要不要蓋遮罩、寫什麼(前端計畫五.4 的順序)。o = { paidUi, locked, page } */
  function decide(a, o) {
    if (!o || o.paidUi !== true || o.locked !== true || !o.page) return null;
    if (!isObj(a) || a.active !== false || a.is_owner === true) return null;
    const cls = classesOf(a);
    if (cls.some(c => c.covered === true)) return null;   // 有班級涵蓋(包括站長的班)就不擋
    if (o.page === 'writing' && typeof a.credits === 'number' && a.credits > 0) return null;
    if (cls.some(c => c.reason === 'expired')) return { kind: 'class_expired', title: '班級老師的方案已到期', line: '請聯絡老師' };
    if (cls.some(c => c.reason === 'over_seats')) return { kind: 'over_seats', title: '班級名額已滿', line: '請聯絡老師' };
    /* 老師自己的方案(或老師試用)是最後一段:寫老師方案的到期日,不寫學生試用的日期 */
    const paidEnd = Date.parse(a.paid_through), teacherEnd = Date.parse(a.teacher_until);
    if (a.teacher_source && isFinite(teacherEnd) && !(isFinite(paidEnd) && paidEnd >= teacherEnd)) {
      if (a.teacher_source === 'trial') return { kind: 'trial_ended', title: '試用已結束', line: '試用到 ' + dayText(a.teacher_until, a.server_now) };
      return { kind: 'expired', title: '方案已到期', line: '到期日 ' + fmtDate(a.teacher_until) };
    }
    if (!a.paid_through) {
      const end = Date.parse(a.trial_until), now = Date.parse(a.server_now);
      if (isFinite(end) && (isFinite(now) ? now : Date.now()) - end > OLD_TRIAL_MS) return { kind: 'ended', title: '使用期限已到', line: '' };
      const d = dayText(a.trial_until, a.server_now);
      return { kind: 'trial_ended', title: '試用已結束', line: d ? '試用到 ' + d : '' };
    }
    const d = fmtDate(a.paid_through);
    return { kind: 'expired', title: '方案已到期', line: d ? '到期日 ' + d : '' };
  }

  function bannerClosed(uid, until) {
    try {
      const v = JSON.parse(localStorage.getItem(BANNER_KEY));
      return isObj(v) && v.u === uid && v.until === until;
    } catch (e) { return false; }
  }
  function dismissBanner(uid, until) {
    try { localStorage.setItem(BANNER_KEY, JSON.stringify({ u: uid, until })); } catch (e) { /* 存不進去:下次開頁會再出現 */ }
  }

  /* 試用快結束的提示條(前端計畫五.5):只有靠試用、而且 until 在 2 天內;關掉的那個到期日不再出現。
     靠老師試用撐著的人(plan teacher,until 含老師的 3 天寬限)不出現,老師的日期看「我的」頁老師那一列 */
  function banner(a, o) {
    if (!o || o.paidUi !== true || !o.page || !isObj(a) || a.active !== true || a.plan === 'teacher') return null;
    const C = cloud();
    if (!C || typeof C.trialEndsSoon !== 'function' || !C.trialEndsSoon(a)) return null;
    if (bannerClosed(o.uid, a.until)) return null;
    return { text: '試用到 ' + dayText(a.until, a.server_now), until: a.until };
  }

  /* 「我的」頁名字下方的方案狀態(前端計畫六.1)。站長不顯示。
     撐著的是老師方案(plan teacher)時,until 多了 3 天寬限,跟老師那一列的日期對不上:這一列不寫,只留老師那一列 */
  function status(a) {
    const C = cloud();
    const s = C && typeof C.accessStatus === 'function' ? C.accessStatus(a) : null;
    if (!s || s.kind === 'owner') return null;
    if (s.kind !== 'paid' && a.plan === 'teacher' && teacherLine(a)) return null;
    const until = fmtDate(s.until);
    switch (s.kind) {
      case 'paid':
        /* 撐著的只有贈送(沒有自己付費的)就不寫「已付費」 */
        if (Array.isArray(a.rights) && a.rights.indexOf('paid') < 0) return { text: '使用到 ' + until };
        return { text: '已付費，到 ' + until };
      case 'class': return { text: '由班級老師提供' + (until ? '，到 ' + until : '') };
      case 'trial': return { text: '試用到 ' + dayText(s.until || a.trial_until, a.server_now) };
      case 'expired': return { text: '使用期限已到', expired: true };
      default: return { text: until ? '使用到 ' + until : '使用期限 無' };   // legacy、贈送
    }
  }

  /* 老師方案那一列:只有老師(teacher_source 有值)才有;站長不顯示。
     名額 0 = 老師方案已經過了寬限(或被撤銷),不寫人數;名額 null 才是不限 */
  function teacherLine(a) {
    if (!isObj(a) || a.is_owner === true || !a.teacher_source) return null;
    const label = a.teacher_source === 'trial' ? '老師試用' : '老師方案';
    const until = fmtDate(a.teacher_until);
    if (a.seats === 0) return label + (until ? ' ' + until + ' 到期' : ' 已結束');
    const seats = typeof a.seats === 'number' && a.seats > 0 ? a.seats + ' 人' : '名額不限';
    if (!until) return label + ' ' + seats;
    const now = Date.parse(a.server_now);
    const past = Date.parse(a.teacher_until) <= (isFinite(now) ? now : Date.now());
    return label + ' ' + seats + (past ? '，' + until + ' 到期' : '，到 ' + until);
  }

  /* 班級列的狀態(前端計畫六.3) */
  function classStatus(a, classId) {
    if (!isObj(a)) return '';
    const c = classesOf(a).find(x => x.class_id === classId);
    if (!c) return '';
    if (c.covered === true) return '由班級提供';
    if (c.reason === 'expired') return '老師方案已到期';
    if (c.reason === 'over_seats') return '超過名額';
    return '';
  }

  /* 「寫作批改 剩 N 篇」那一列:有篇數、或買過才出現 */
  function showCredits(a, billing) {
    if (!isObj(a)) return false;
    if (typeof a.credits === 'number' && a.credits > 0) return true;
    if (!isObj(billing)) return false;
    const pays = Array.isArray(billing.payments) ? billing.payments : [];
    const log = Array.isArray(billing.credit_log) ? billing.credit_log : [];
    return pays.some(p => isObj(p) && p.item === 'credits' && (p.status === 'paid' || p.status === 'refunded'))
      || log.some(l => isObj(l) && l.reason === 'purchase');
  }
  function creditsLeft(n) { return '剩 ' + Math.max(0, Math.floor(Number(n) || 0)) + ' 篇'; }
  function creditsText(n) { return '寫作批改 ' + creditsLeft(n); }

  const SOURCE = { legacy: '既有帳號', paid: '付費', comp: '贈送', trial: '試用' };
  const PAY_STATE = { pending: '處理中', failed: '未完成' };

  /* 「方案與付款」展開後的內容:使用期間(由舊到新)與付款紀錄(新的在上面,跟一般購買紀錄一樣),一筆一行 */
  function billingLines(b) {
    const out = { grants: [], payments: [] };
    if (!isObj(b)) return out;
    (Array.isArray(b.grants) ? b.grants : []).filter(isObj).forEach(g => {
      const seats = typeof g.seats === 'number' && g.seats > 0 ? ' ' + g.seats + NB + '人' : '';
      const label = g.kind === 'teacher'
        ? (g.source === 'trial' ? '老師試用' : '老師方案 ' + (SOURCE[g.source] || '')) + seats
        : '學生方案 ' + (SOURCE[g.source] || '');
      const from = fmtDate(g.starts_at), to = fmtDate(g.ends_at);
      const span = to ? from + ' 到' + NB + to : from + ' 起 無期限';
      out.grants.push({ text: label.trim() + ' ' + span + (g.revoked_at ? ' 已撤銷' : ''), revoked: !!g.revoked_at });
    });
    (Array.isArray(b.payments) ? b.payments : []).filter(isObj).reverse().forEach(p => {
      let item = '';
      if (p.item === 'student') item = '學生方案 ' + p.months + NB + '個月';
      else if (p.item === 'teacher') item = '老師方案 ' + p.seats + NB + '人 ' + p.months + NB + '個月';
      else if (p.item === 'credits') item = '寫作批改 ' + p.credits + NB + '篇';
      let state = PAY_STATE[p.status] || '';
      if (p.status === 'refunded') state = '已退款' + (p.refund_amount ? ' ' + money(p.refund_amount) : '');
      const parts = [fmtDate(p.paid_at || p.created_at), item, money(p.amount), state].filter(Boolean);
      out.payments.push({ text: parts.join(' ') });
    });
    return out;
  }

  /* start_teacher_trial 的回應。active 為 false = 沿用的班已停用,邀請碼不能用來加入,不當成能用的碼顯示 */
  function trialOutcome(r) {
    if (!isObj(r)) return { code: '', name: '', until: null, closed: false };
    const closed = r.active === false;
    return { code: !closed && typeof r.code === 'string' ? r.code : '', name: typeof r.name === 'string' ? r.name : '',
      until: typeof r.until === 'string' ? r.until : null, closed };
  }
  /* 最新的使用權看得出老師試用已經開始(開通的回應在路上遺失時用) */
  function trialStarted(a) { return isObj(a) && a.is_owner !== true && a.teacher_source === 'trial'; }

  /* 模擬考進行中(mock.js 在 body 掛 data-leave-confirm,交卷時拿掉):等交卷再做 fn,遮罩不蓋在計時中的考試上,
     考試照常交卷、照常記一筆真的成績。沒在考試就馬上做。 */
  function whenNoExam(body, fn) {
    const busy = () => !!(body && body.dataset && body.dataset.leaveConfirm);
    if (!busy() || typeof window.MutationObserver !== 'function') return fn();
    let done = false;
    const mo = new window.MutationObserver(() => {
      if (done || busy()) return;
      done = true;
      mo.disconnect();
      fn();
    });
    mo.observe(body, { attributes: true, attributeFilter: ['data-leave-confirm'] });
  }

  /* ---------- 畫面 ---------- */

  const LOCK_ICON = '<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="7" y="14" width="18" height="13" rx="3"/><path d="M11 14v-3.5a5 5 0 0 1 10 0V14"/><path d="M16 19.5v3"/></svg>';
  const X_ICON = '<svg viewBox="0 0 22 22" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">'
    + '<path d="M5 5 17 17M17 5 5 17"/></svg>';

  /* Tab 只在視窗裡轉 */
  function trapTab(box, e) {
    if (e.key !== 'Tab') return;
    const f = Array.from(box.querySelectorAll('button,input,a[href]')).filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!box.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* 遮罩。關不掉(到期了),但頁面照常在底下;App 外殼裡跟登入視窗一樣露出頂欄和分頁列,還能點去別頁 */
  function showOverlay(d) {
    const C = cloud();
    const shell = document.documentElement.classList.contains('app-shell');
    const logout = h('button', { class: 'pw-logout', type: 'button' }, '登出');
    logout.addEventListener('click', () => { Promise.resolve(C.logout()).catch(e => alert(e.message)); });
    const box = h('div', { class: 'modal modal-paywall', role: 'dialog', 'aria-modal': shell ? null : 'true',
      'aria-labelledby': 'pw-h', 'aria-describedby': d.line ? 'pw-line' : null },
      h('span', { class: 'pw-icon', html: LOCK_ICON }),
      h('h2', { class: 'pw-h', id: 'pw-h' }, d.title),
      d.line ? h('p', { class: 'pw-line', id: 'pw-line' }, d.line) : null,
      h('div', { class: 'pw-actions' },
        h('a', { class: 'btn primary pw-btn', href: 'pricing.html' }, '查看方案'),
        h('a', { class: 'btn pw-btn', href: 'me.html?join=' }, '輸入班級邀請碼'),
        logout));
    const mask = h('div', { class: 'modal-mask pw-mask' }, box);
    document.body.append(mask);
    if (shell) document.documentElement.classList.add('app-gate');
    Array.from(document.body.children).forEach(el => {
      if (el === mask || el.matches('script')) return;
      if (shell && el.matches('.topbar, .app-tabbar')) return;
      el.inert = true;
    });
    if (!shell) document.addEventListener('keydown', e => trapTab(box, e));
    const first = box.querySelector('.pw-btn');
    if (first) first.focus();
  }

  /* 試用快結束:頁首下面一條,跟「登入已失效」同一種樣子 */
  function showBanner(b, uid) {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const note = h('div', { class: 'auth-expired trial-note', role: 'status' });
    const close = () => {
      const had = note.contains(document.activeElement);
      dismissBanner(uid, b.until);
      note.remove();
      if (!had) return;
      const back = [document.querySelector('.profile-btn'), document.querySelector('.app-back')].find(el => el && el.offsetParent);
      if (back) back.focus();
    };
    note.append(
      h('span', null, b.text),
      h('a', { class: 'auth-expired-login', href: 'pricing.html' }, '查看方案'),
      h('button', { class: 'auth-expired-x', type: 'button', 'aria-label': '關閉', html: X_ICON, onclick: close }));
    bar.append(note);
  }

  function initPage() {
    const C = cloud();
    const page = pageKind(location.pathname, location.search);
    if (!page) return;
    Promise.resolve(C.accessReady).then(() => {
      if (!enabled()) return;
      const a = C.access;
      const d = decide(a, { paidUi: true, locked: C.locked(), page });
      if (d) return whenNoExam(document.body, () => showOverlay(d));
      const uid = C.user && C.user.id;
      const b = banner(a, { paidUi: true, page, uid });
      if (b) showBanner(b, uid);
    }).catch(e => console.warn('付費牆沒有顯示：', e));
  }

  /* ---------- 「我的」頁(js/profile.js 的 renderAccount 呼叫) ----------
     opts = { who: 名字那一格, after: 方案清單要放在哪一個元素後面, onTrial: 開始老師試用成功、視窗關掉後要做的事 }
     回傳 { update() }:班級加入或退出之後,用最新的 CLOUD.access 重畫。 */
  function account(opts) {
    const C = cloud();
    const made = [];
    let billing = null;   // my_billing 的 promise,只查一次(失敗就清掉,下次展開再查)

    function getBilling() {
      if (!billing) {
        billing = Promise.resolve(C.myBilling()).catch(e => { billing = null; throw e; });
      }
      return billing;
    }

    function clear() { made.splice(0).forEach(el => el.remove()); }

    function draw() {
      clear();
      const a = C.access;
      if (!enabled() || !isObj(a) || a.is_owner === true || !opts.who || !opts.who.isConnected) return;
      const st = status(a);
      if (st) {
        const line = h('span', { class: 'me-plan' + (st.expired ? ' is-expired' : '') }, st.text);
        if (st.expired) line.append(h('a', { class: 'me-plan-link', href: 'pricing.html' }, '查看方案'));
        opts.who.append(line); made.push(line);
      }
      const tl = teacherLine(a);
      if (tl) { const t = h('span', { class: 'me-plan' }, tl); opts.who.append(t); made.push(t); }

      const ul = h('ul', { class: 'me-list me-plans' });
      /* 只是顯示,不能按:左邊名稱、右邊數量(跟設定頁的「項目 / 值」一樣),看起來不像可以按的列 */
      const credits = h('li', { class: 'me-static' }, h('span', null, '寫作批改'), h('span', { class: 'me-static-val' }, creditsLeft(a.credits)));
      const trialLi = a.teacher_trial_available === true
        ? h('li', null, h('button', { class: 'me-row', type: 'button', onclick: e => openTrial(e.currentTarget) }, '開始老師試用'))
        : null;
      ul.append(billingRow());
      if (showCredits(a, null)) ul.append(credits);
      else getBilling().then(b => { if (showCredits(a, b) && ul.isConnected) ul.insertBefore(credits, trialLi); }, () => {});
      if (trialLi) ul.append(trialLi);
      if (opts.after && opts.after.isConnected) { opts.after.after(ul); made.push(ul); }
    }

    function billingRow() {
      const id = 'me-bill-' + Math.random().toString(36).slice(2, 8);
      const btn = h('button', { class: 'me-row me-expand', type: 'button', 'aria-expanded': 'false', 'aria-controls': id }, '方案與付款');
      const panel = h('div', { class: 'me-bill', id, hidden: 'hidden' });
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        panel.hidden = !open;
        if (open) fillBilling(panel);
      });
      return h('li', null, btn, panel);
    }

    function fillBilling(panel) {
      panel.innerHTML = '';
      panel.append(h('p', { class: 'me-bill-msg' }, '讀取中'));
      getBilling().then(b => {
        panel.innerHTML = '';
        const r = billingLines(b);
        const block = (title, rows) => h('div', { class: 'me-bill-sec' },
          h('p', { class: 'me-bill-h' }, title),
          h('ul', { class: 'me-bill-list' }, rows.map(x => h('li', { class: x.revoked ? 'is-revoked' : null }, x.text))));
        if (r.grants.length) panel.append(block('使用期間', r.grants));
        if (r.payments.length) panel.append(block('付款紀錄', r.payments));
        else panel.append(h('p', { class: 'me-bill-msg' }, '還沒有付款紀錄'));
        panel.append(h('p', { class: 'me-bill-more' }, h('a', { href: 'pricing.html' }, '查看方案')));
      }, e => {
        panel.innerHTML = '';
        panel.append(h('p', { class: 'me-bill-msg bad', role: 'alert' }, e.message || '讀取失敗，請稍後再試。'));
      });
    }

    function openTrial(returnTo) {
      trialDialog(returnTo, () => { if (opts.onTrial) opts.onTrial(); });
    }

    const ready = Promise.resolve(C.accessReady).then(draw, () => {});
    return { ready, update: draw };
  }

  /* 開始老師試用:先確認(這個視窗就是確認),選名額與班名;成功顯示邀請碼與教師後台的連結 */
  function trialDialog(returnTo, onDone) {
    if (document.querySelector('.modal-mask')) return;
    const C = cloud();
    let busy = false, started = false;
    const mask = h('div', { class: 'modal-mask' });
    const box = h('div', { class: 'modal modal-auth modal-trial', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'trial-h' });
    const closeBtn = h('button', { class: 'modal-close', type: 'button', 'aria-label': '關閉', html: X_ICON, onclick: () => close() });
    mask.append(box);

    const seatInputs = SEATS.map((n, i) => {
      const input = h('input', { type: 'radio', name: 'trial-seats', value: String(n) });
      if (i === 0) input.checked = true;
      return h('label', { class: 'trial-seat' }, input, h('span', null, n + ' 人'));
    });
    const nameInput = h('input', { class: 'auth-input', id: 'trial-name', type: 'text', name: 'class-name', maxlength: '30', autocomplete: 'off' });
    const msg = h('p', { class: 'auth-msg', role: 'alert' });
    const submit = h('button', { class: 'btn primary auth-submit', type: 'submit' }, '開始老師試用');
    const cancel = h('button', { class: 'btn auth-full trial-cancel', type: 'button', onclick: () => close() }, '取消');
    const form = h('form', { class: 'auth-form', novalidate: 'novalidate' },
      h('fieldset', { class: 'trial-seats' }, h('legend', null, '名額'), h('div', { class: 'trial-seat-row' }, seatInputs)),
      h('div', { class: 'auth-field' }, h('label', { for: 'trial-name' }, '班級名稱'), nameInput, h('p', { class: 'auth-hint' }, '空白就用「我的班級」')),
      msg, submit, cancel);
    box.append(closeBtn,
      h('h2', { class: 'auth-h', id: 'trial-h' }, '用這個帳號開始老師試用？'),
      h('p', { class: 'trial-who' }, (C.user && C.user.email) || ''),
      form,
      h('p', { class: 'auth-fine' }, h('a', { href: 'pricing.html', target: '_blank', rel: 'noopener' }, '方案說明')));
    document.body.append(mask);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (busy) return;
      const picked = form.querySelector('input[name=trial-seats]:checked');
      const seats = picked ? Number(picked.value) : 10;
      msg.textContent = ''; msg.className = 'auth-msg';
      busy = true; submit.disabled = true; cancel.disabled = true; closeBtn.disabled = true;
      submit.textContent = '開通中';
      try {
        const r = await C.startTeacherTrial(seats, nameInput.value);
        started = true;
        success(r, false);
      } catch (err) {
        /* 伺服器可能已經開好、只是回應沒收到(網路斷在半路):重新查一次使用權,看得出試用已開始就當成功 */
        let fresh = null;
        try { fresh = await C.refreshAccess(); } catch (e2) { fresh = null; }
        if (trialStarted(fresh)) { started = true; success({ until: fresh.teacher_until }, true); return; }
        msg.textContent = err.message; msg.className = 'auth-msg bad';
        submit.textContent = '開始老師試用';
        submit.disabled = false; cancel.disabled = false;
        nameInput.focus();
      } finally {
        busy = false; closeBtn.disabled = false;
      }
    });

    /* lost:開通的回應沒收到,只從使用權知道試用已開始(拿不到邀請碼) */
    function success(r, lost) {
      box.innerHTML = '';
      const o = trialOutcome(r);
      const code = o.code;
      const copied = h('p', { class: 'auth-msg', role: 'status' });
      const copy = h('button', { class: 'btn trial-copy', type: 'button' }, '複製');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code); copied.textContent = '已複製'; copied.className = 'auth-msg ok'; }
        catch (e) { copied.textContent = '沒辦法自動複製，請手動抄下邀請碼'; copied.className = 'auth-msg bad'; }
      });
      const codeEl = h('span', { class: 'join-code trial-code' });
      codeEl.textContent = code;
      const nameEl = h('p', { class: 'trial-class' });
      nameEl.textContent = o.name;
      const go = h('a', { class: 'btn primary auth-submit trial-go', href: 'admin.html' }, '前往教師後台');
      const day = dayText(o.until, C.access && C.access.server_now);
      /* 班名在上、「班級邀請碼」緊貼在碼的上面 */
      let codeBox = null;
      if (code) codeBox = h('div', { class: 'trial-code-box' }, nameEl, h('span', { class: 'trial-code-label' }, '班級邀請碼'), h('div', { class: 'trial-code-row' }, codeEl, copy));
      else if (o.closed) codeBox = h('div', { class: 'trial-code-box' }, nameEl, h('p', { class: 'trial-code-note' }, '這個班已停用，邀請碼不能用來加入，請聯絡站長。'));
      else if (lost) codeBox = h('div', { class: 'trial-code-box' }, h('p', { class: 'trial-code-note' }, '沒有收到班級邀請碼，請聯絡站長。'));
      box.append(closeBtn,
        h('h2', { class: 'auth-h', id: 'trial-h' }, '老師試用已開始'),
        day ? h('p', { class: 'trial-who' }, '試用到 ' + day) : null,
        codeBox,
        copied, go,
        h('button', { class: 'btn auth-full trial-cancel', type: 'button', onclick: () => close() }, '關閉'));
      go.focus();
    }

    function onKey(e) {
      if (e.key === 'Escape') { if (!busy) close(); return; }
      trapTab(box, e);
    }
    document.addEventListener('keydown', onKey);
    mask.addEventListener('mousedown', e => { if (e.target === mask && !busy) close(); });
    const firstSeat = box.querySelector('input[name=trial-seats]');
    if (firstSeat) firstSeat.focus();

    function close() {
      if (busy) return;
      document.removeEventListener('keydown', onKey);
      mask.remove();
      try { if (returnTo && returnTo.isConnected) returnTo.focus(); } catch (e) {}
      if (started) onDone();
    }
  }

  window.PAYWALL = { enabled, pageKind, decide, banner, dismissBanner, fmtDay, fmtDate, status, teacherLine, classStatus,
    showCredits, creditsText, billingLines, trialOutcome, trialStarted, whenNoExam, account };

  const C = cloud();
  if (enabled() && C && C.enabled) document.addEventListener('DOMContentLoaded', initPage);
})();
