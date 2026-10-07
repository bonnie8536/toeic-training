/* 班級:用老師給的邀請碼加入、列出、退出。
   - CLASSES.api:純邏輯(tools/test_classes.js 用假的 Supabase 測)。加入走資料庫函式 join_class,
     列表與退出走 memberships 的既有政策(學生只讀得到、刪得掉自己的列)。資料庫的錯誤訊息是中文,原樣顯示(句尾沒有句號就補上)。
   - CLASSES.section():「我的」頁的班級區(js/profile.js 的 renderAccount 呼叫)。
   - CLASSES.pending:沒登入的人打開邀請連結時,把碼先存在這台(tr_pending_join),登入後到「我的」頁讀一次就清掉。
   做法照 Google Classroom:按「加入班級」開一個只有邀請碼一欄的視窗,按「加入」才送出;
   邀請連結 me.html?join=邀請碼 只幫忙填好,一樣要本人按「加入」。退出前先確認。
   班名是老師自己取的,一律用文字節點放進畫面。 */
(function () {
  /* 邀請碼的字母表跟資料庫的 gen_class_code 一樣:沒有 0、1、I、O */
  const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
  const NET_MSG = '連不上雲端伺服器，請檢查網路後再試。';
  const PENDING_KEY = 'tr_pending_join';
  const PENDING_TTL_MS = 24 * 3600e3;

  function normalize(code) {
    let s = String(code == null ? '' : code);
    try { s = s.normalize('NFKC'); } catch (e) { /* 舊瀏覽器沒有 normalize */ }
    return s.replace(/[\s\-‐-―－]/g, '').toUpperCase();
  }

  function formatError(code) {
    if (!code) return '請輸入邀請碼。';
    if (/[^A-Z0-9]/.test(code)) return '邀請碼只有英文字母和數字。';
    if (code.length !== 8) return '邀請碼是 8 碼，現在是 ' + code.length + ' 碼。';
    if (!CODE_RE.test(code)) return '邀請碼裡沒有 0、1、I、O，請再對一次。';
    return '';
  }

  function isNetwork(err) {
    return /failed to fetch|networkerror|network|load failed|timeout/i.test(String((err && err.message) || err || ''));
  }
  /* 資料庫的訊息不帶句號(線上的舊函式也是),顯示時統一補上 */
  function sentence(m) { return /[。！？!?.]$/.test(m) ? m : m + '。'; }
  function messageOf(err) {
    if (isNetwork(err)) return NET_MSG;
    const m = String((err && err.message) || '');
    return m ? sentence(m) : '發生錯誤，請稍後再試。';
  }

  /* 可以呼叫雲端:回 { client, user };不行就回 { message } */
  async function session() {
    const C = window.CLOUD;
    if (!C || !C.enabled) return { message: '這個網站沒有開雲端帳號。' };
    try { await C.ready; } catch (e) { /* ready 不會失敗,保險 */ }
    if (!C.user) return { message: '請先登入。' };
    if (!C.client) return { message: NET_MSG };
    return { client: C.client, user: C.user };
  }

  async function join(raw) {
    const code = normalize(raw);
    const bad = formatError(code);
    if (bad) return { ok: false, message: bad, field: true };
    const s = await session();
    if (s.message) return { ok: false, message: s.message };
    try {
      const { data, error } = await s.client.rpc('join_class', { p_code: code });
      if (error) return { ok: false, message: messageOf(error) };
      return { ok: true, name: String(data == null ? '' : data) };
    } catch (e) {
      return { ok: false, message: messageOf(e) };
    }
  }

  async function list() {
    const s = await session();
    if (s.message) return { ok: false, message: s.message, classes: [] };
    try {
      const { data, error } = await s.client.from('memberships')
        .select('class_id, joined_at, classes(name)')
        .eq('student_id', s.user.id)
        .order('joined_at', { ascending: true });
      if (error) return { ok: false, message: messageOf(error), classes: [] };
      const rows = Array.isArray(data) ? data : [];
      return { ok: true, classes: rows.map(r => ({ id: r.class_id, joinedAt: r.joined_at, name: String((r.classes && r.classes.name) || '') })) };
    } catch (e) {
      return { ok: false, message: messageOf(e), classes: [] };
    }
  }

  async function leave(classId) {
    if (!classId) return { ok: false, message: '找不到這個班級。' };
    const s = await session();
    if (s.message) return { ok: false, message: s.message };
    try {
      const { error } = await s.client.from('memberships').delete()
        .eq('student_id', s.user.id)
        .eq('class_id', classId);
      if (error) return { ok: false, message: messageOf(error) };
      return { ok: true };
    } catch (e) {
      return { ok: false, message: messageOf(e) };
    }
  }

  const api = { normalize, join, list, leave };

  /* 沒登入時打開的邀請碼:存一天,讀一次就清掉。存不進去、壞掉都當作沒有 */
  const pending = {
    save(code) {
      const c = normalize(code).slice(0, 20);
      try {
        if (c) localStorage.setItem(PENDING_KEY, JSON.stringify({ code: c, at: Date.now() }));
        else localStorage.removeItem(PENDING_KEY);
      } catch (e) { /* 存不進去:登入後就要再點一次邀請連結 */ }
    },
    take() {
      let v = null;
      try {
        v = JSON.parse(localStorage.getItem(PENDING_KEY));
        localStorage.removeItem(PENDING_KEY);
      } catch (e) {
        try { localStorage.removeItem(PENDING_KEY); } catch (e2) {}
        return null;
      }
      if (!v || typeof v.code !== 'string' || typeof v.at !== 'number') return null;
      const age = Date.now() - v.at;
      return age >= 0 && age <= PENDING_TTL_MS && v.code ? normalize(v.code).slice(0, 20) : null;
    },
  };

  /* ========================================================= */
  /* 畫面:「我的」頁的班級區                                     */
  /* ========================================================= */
  const X_ICON = '<svg viewBox="0 0 22 22" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">'
    + '<path d="M5 5 17 17M17 5 5 17"/></svg>';

  function readJoinParam() {
    try {
      const u = new URL(location.href);
      return u.searchParams.has('join') ? (u.searchParams.get('join') || '').slice(0, 40) : null;
    } catch (e) { return null; }
  }

  /* 網址上的 ?join=邀請碼:讀一次就從網址拿掉,重新整理不會再跳出來 */
  function takeJoinParam() {
    const code = readJoinParam();
    if (code === null) return null;
    try {
      const u = new URL(location.href);
      u.searchParams.delete('join');
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    } catch (e) { /* 拿不掉只是重新整理時會再填一次 */ }
    return code;
  }

  function section() {
    const status = h('p', { class: 'me-class-msg', role: 'status' });
    const ul = h('ul', { class: 'me-list me-classes', 'aria-busy': 'true' });
    /* 還在讀列表時先放一列「讀取中」;讀完才放「加入班級」,要按的那一列不會在手指下面移動 */
    const loadingLi = h('li', { class: 'me-class is-loading' }, h('span', { class: 'me-class-name' }, '讀取中'));
    ul.append(loadingLi);
    const joinBtn = h('button', { class: 'me-row', type: 'button' }, '加入班級');
    const joinLi = h('li', null, joinBtn);
    const box = h('section', { class: 'me-sec', id: 'classes', 'aria-labelledby': 'me-classes-h' },
      h('h2', { class: 'me-sec-h', id: 'me-classes-h' }, '班級'), status, ul);

    const say = (text, kind) => { status.textContent = text || ''; status.className = 'me-class-msg' + (kind ? ' ' + kind : ''); };

    async function refresh() {
      const r = await list();
      const rows = r.ok ? r.classes.map(classRow) : [];
      /* 「加入班級」那一列不拿下來重放:焦點可能正在它上面(加入視窗關掉後焦點回到這裡) */
      Array.from(ul.children).forEach(li => { if (li !== joinLi) li.remove(); });
      const anchor = joinLi.parentNode === ul ? joinLi : null;
      rows.forEach(li => ul.insertBefore(li, anchor));
      if (!anchor) ul.append(joinLi);
      ul.removeAttribute('aria-busy');
      if (!r.ok) say(r.message, 'bad');
    }

    function classRow(c) {
      const label = c.name || '這個班';
      const name = h('span', { class: 'me-class-name' });
      name.textContent = c.name || '（沒有班名）';
      const btn = h('button', { class: 'me-class-leave', type: 'button' }, '退出');
      btn.setAttribute('aria-label', '退出' + label);
      btn.addEventListener('click', async () => {
        if (!confirm('要退出「' + label + '」嗎？要回來得再輸入一次邀請碼。')) return;
        btn.disabled = true;
        const r = await leave(c.id);
        if (!r.ok) { btn.disabled = false; say(r.message, 'bad'); return; }
        say('已退出「' + label + '」。', 'ok');
        await refresh();
        joinBtn.focus();
      });
      return h('li', { class: 'me-class' }, name, btn);
    }

    joinBtn.addEventListener('click', () => openJoin(''));

    function openJoin(prefill) {
      showJoinDialog(prefill, joinBtn, async (name) => {
        say('已加入「' + name + '」。', 'ok');
        await refresh();
      });
    }

    const loaded = refresh();
    /* 邀請連結(?join=,頭像選單的「加入班級」是空的 ?join=)優先;沒有就看沒登入時存下的碼 */
    const fromUrl = takeJoinParam();
    const stored = pending.take();
    const pre = fromUrl !== null ? fromUrl : stored;
    if (pre !== null) loaded.then(() => openJoin(pre));
    else if (location.hash === '#classes') loaded.then(() => { try { box.scrollIntoView({ block: 'start' }); } catch (e) {} });
    return box;
  }

  /* 加入班級的視窗:一欄邀請碼 + 加入。成功就關掉,把班名交給 onJoined */
  function showJoinDialog(prefill, returnTo, onJoined) {
    if (document.querySelector('.modal-mask')) return;
    const id = 'join-code';
    const input = h('input', { class: 'auth-input join-code', id, type: 'text', name: 'class-code', autocomplete: 'off',
      autocapitalize: 'characters', spellcheck: 'false', maxlength: '20', enterkeyhint: 'go' });
    input.value = normalize(prefill);
    const note = h('p', { class: 'auth-note', role: 'alert' });
    const field = h('div', { class: 'auth-field' },
      h('label', { for: id }, '邀請碼'), input, h('p', { class: 'auth-hint' }, '向老師拿 8 碼的邀請碼'), note);
    /* 碼的格式不對:標在欄位上。伺服器或網路的錯誤:放在表單的訊息行,欄位不標紅(跟登入視窗一樣) */
    const msg = h('p', { class: 'auth-msg', role: 'alert' });
    const bad = m => {
      note.textContent = m || '';
      note.className = 'auth-note' + (m ? ' bad' : '');
      field.classList.toggle('is-bad', !!m);
      input.setAttribute('aria-invalid', m ? 'true' : 'false');
    };
    const fail = m => { msg.textContent = m || ''; msg.className = 'auth-msg' + (m ? ' bad' : ''); };
    input.addEventListener('input', () => { bad(''); fail(''); });
    const submit = h('button', { class: 'btn primary auth-submit', type: 'submit' }, '加入');
    const form = h('form', { class: 'auth-form', novalidate: 'novalidate' }, field, msg, submit);
    const closeBtn = h('button', { class: 'modal-close', type: 'button', 'aria-label': '關閉', html: X_ICON, onclick: () => close() });
    const mask = h('div', { class: 'modal-mask' });
    const box = h('div', { class: 'modal modal-auth modal-join', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'join-h' },
      closeBtn,
      h('h2', { class: 'auth-h', id: 'join-h' }, '加入班級'),
      form,
      h('p', { class: 'auth-fine' }, '加入後，這個班的老師看得到你的暱稱、Email 和學習記錄。'));
    mask.append(box);
    document.body.append(mask);

    /* 送出中不讓視窗關掉:結果(成功或失敗)一定顯示得出來 */
    let busy = false;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (busy) return;
      bad(''); fail('');
      busy = true;
      input.focus();   // 焦點留在視窗裡(按鈕 disabled 後焦點會掉到 body)
      submit.disabled = true;
      closeBtn.disabled = true;
      submit.textContent = '加入中';
      const r = await join(input.value);
      busy = false;
      submit.disabled = false;
      closeBtn.disabled = false;
      submit.textContent = '加入';
      if (!r.ok) {
        if (r.field) bad(r.message); else fail(r.message);
        input.focus();
        return;
      }
      close();
      onJoined(r.name);
    });

    function onKey(e) {
      if (e.key === 'Escape') { if (!busy) close(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(box.querySelectorAll('button,input,a[href]')).filter(x => !x.disabled);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!box.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    mask.addEventListener('mousedown', e => { if (e.target === mask && !busy) close(); });
    input.focus();

    function close() {
      if (busy) return;
      document.removeEventListener('keydown', onKey);
      mask.remove();
      /* 焦點回到「加入班級」(從邀請連結打開時沒有按過按鈕,Safari 點按鈕也不會給它焦點) */
      try { if (returnTo && returnTo.isConnected) returnTo.focus(); } catch (e) {}
    }
  }

  /* 沒登入的人打開邀請連結:畫面不變(只有登入與註冊),碼先存在這台;登入後到「我的」頁會自動填好 */
  try {
    const C = window.CLOUD;
    const code = C && C.enabled ? readJoinParam() : null;
    if (code) Promise.resolve(C.ready).then(u => { if (!u && !C.user) pending.save(code); }, () => {});
  } catch (e) { /* 沒有雲端就不用記 */ }

  window.CLASSES = { api, section, pending };
})();
