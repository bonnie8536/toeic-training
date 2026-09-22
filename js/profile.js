/* 學生身分層,依 CLOUD.enabled 走兩種模式:
   - 本機模式(未設定 Supabase):學生檔案存這台裝置,建檔/切換/匯出/匯入/刪除。
   - 雲端模式:帳號密碼登入(帳號由老師在 Supabase 後台發放),進度同步雲端;
     右上角顯示登入身分,教師帳號多一個「教師後台」入口。 */
(function () {
  /* ========================================================= */
  /* 共用小工具                                                 */
  /* ========================================================= */
  function currentKeys(pid) {
    const prefix = 'tr_u' + pid + '_';
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    return keys;
  }

  function exportData(pid, name) {
    const data = {};
    currentKeys(pid).forEach(k => { data[k.replace('tr_u' + pid + '_', '')] = localStorage.getItem(k); });
    const payload = { app: 'toeic-reading-room', version: 1, name, exported: new Date().toISOString(), data };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '多益進度_' + name + '_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ========================================================= */
  /* 雲端模式                                                   */
  /* ========================================================= */
  if (window.CLOUD && CLOUD.enabled) {
    window.PROFILE = {
      current() {
        if (!CLOUD.user) return null;
        const email = CLOUD.user.email || '';
        return { id: 'c' + CLOUD.user.id.replace(/-/g, ''), name: CLOUD.nameOf(CLOUD.user) || email.split('@')[0] };
      },
      showGate: showLogin,
      showLogin,
      buildAuthCard,   // signup.html 直接把同一張卡畫在頁面上
    };

    document.addEventListener('DOMContentLoaded', async () => {
      await CLOUD.ready;
      buildCloudWidget();
      if (document.body.hasAttribute('data-require-profile') && !CLOUD.user) showLogin();
      else if (CLOUD.authError && !CLOUD.user && !document.body.hasAttribute('data-auth-page')) showLogin('login');
    });

    function buildCloudWidget() {
      const bar = document.querySelector('.topbar-inner');
      if (!bar || document.body.hasAttribute('data-auth-page')) return;
      const p = PROFILE.current();
      const widget = h('div', { class: 'profile-widget' });
      const btn = h('button', { class: 'profile-btn', type: 'button' },
        h('span', { class: 'profile-dot' }, p ? p.name.slice(0, 1).toUpperCase() : '?'),
        p ? p.name : '登入', ' ▾');
      const menu = h('div', { class: 'profile-menu', style: 'display:none' });
      widget.append(btn, menu);
      bar.append(widget);

      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (menu.style.display === 'none') { drawMenu(); menu.style.display = ''; }
        else menu.style.display = 'none';
      });
      document.addEventListener('click', () => { menu.style.display = 'none'; });
      menu.addEventListener('click', e => e.stopPropagation());

      function drawMenu() {
        menu.innerHTML = '';
        const cur = PROFILE.current();
        if (!cur) {
          menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { menu.style.display = 'none'; showLogin('login'); } }, '登入'));
          menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { menu.style.display = 'none'; showLogin('signup'); } }, '註冊帳號'));
          return;
        }
        menu.append(h('div', { class: 'pm-head' }, CLOUD.user.email));
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { location.href = 'analysis.html'; } }, '能力分析'));
          menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { location.href = 'review.html'; } }, '每日複習'));
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { location.href = 'history.html'; } }, '學習記錄'));
        if (CLOUD.isTeacher) {
          menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { location.href = 'admin.html'; } }, '教師後台'));
        }
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => exportData(cur.id, cur.name) }, '匯出進度備份'));
        menu.append(h('button', {
          class: 'pm-item', type: 'button',
          onclick: async () => {
            const n = prompt('暱稱(老師會看到這個名字)', CLOUD.nameOf(CLOUD.user));
            if (n === null) return;
            try { await CLOUD.updateName(n); location.reload(); }
            catch (e) { alert(e.message); }
          },
        }, '改暱稱'));
        menu.append(h('div', { class: 'pm-sep' }));
        menu.append(h('button', { class: 'pm-item danger', type: 'button', onclick: () => CLOUD.logout() }, '登出'));
        menu.append(h('button', {
          class: 'pm-item danger', type: 'button',
          onclick: () => {
            if (!confirm('確定要刪除帳號?雲端上的所有進度、錯題與寫作內容都會永久刪除,無法復原。')) return;
            if (!confirm('再確認一次:真的要刪除「' + CLOUD.user.email + '」?')) return;
            CLOUD.deleteAccount().catch(e => alert(e.message));
          },
        }, '刪除帳號'));
      }
    }

    /* ---------- 登入/註冊/忘記密碼:共用一張卡 ----------
       做法參考 Engoo、VoiceTube、Busuu、均一教育平台:Google 放最上面、標籤常駐在欄位
       上方、密碼可切換顯示、忘記密碼是小連結不是同級分頁、錯誤訊息貼在出錯的那一欄。
       同一張卡給登入視窗(modal)與 signup.html 共用。 */

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    /* Google 的 G 標誌:官方四色版本,不改顏色、不自己重畫 */
    const G_LOGO = '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">'
      + '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"/>'
      + '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34A8.997 8.997 0 0 0 9 18z"/>'
      + '<path fill="#FBBC05" d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.29-1.71V4.96H.96A8.997 8.997 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.33z"/>'
      + '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A8.997 8.997 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>';

    const EYE = '<svg viewBox="0 0 22 22" width="19" height="19" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M1.6 11S5.2 5.2 11 5.2 20.4 11 20.4 11 16.8 16.8 11 16.8 1.6 11 1.6 11z"/><circle cx="11" cy="11" r="2.9"/></svg>';
    const EYE_OFF = '<svg viewBox="0 0 22 22" width="19" height="19" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M1.6 11S5.2 5.2 11 5.2 20.4 11 20.4 11 16.8 16.8 11 16.8 1.6 11 1.6 11z"/><circle cx="11" cy="11" r="2.9"/><path d="M3.5 18.5 18.5 3.5"/></svg>';

    /* 常見的信箱拼錯,打錯了收不到驗證信,所以當場提醒(不擋送出) */
    const DOMAIN_TYPO = {
      'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmil.com': 'gmail.com', 'gmaill.com': 'gmail.com',
      'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.co': 'gmail.com', 'gamil.com': 'gmail.com',
      'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'hotmai.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
      'icloud.con': 'icloud.com', 'outlook.con': 'outlook.com',
    };
    function typoFix(value) {
      const at = value.lastIndexOf('@');
      if (at < 1) return '';
      const dom = value.slice(at + 1).toLowerCase();
      const fix = DOMAIN_TYPO[dom];
      return fix ? value.slice(0, at + 1) + fix : '';
    }

    let authSeq = 0;

    /* 一欄:常駐標籤 + 輸入框(密碼多一個顯示切換)+ 規則提示 + 這一欄的訊息 */
    function authField(opt) {
      const id = 'af' + (++authSeq);
      const input = h('input', {
        class: 'auth-input', id, type: opt.type, name: opt.name,
        autocomplete: opt.ac, inputmode: opt.inputmode || null, maxlength: opt.max || null,
        spellcheck: 'false',
      });
      const note = h('p', { class: 'auth-note', role: 'alert' });
      const box = h('div', { class: 'auth-field' },
        h('label', { for: id }, opt.label),
        opt.type === 'password' ? pwBox(input) : input,
        opt.hint ? h('p', { class: 'auth-hint' }, opt.hint) : null,
        note);
      const api = {
        el: box, input,
        value() { return input.value.trim(); },
        raw() { return input.value; },
        bad(msg) {
          note.textContent = msg || '';
          note.className = 'auth-note' + (msg ? ' bad' : '');
          box.classList.toggle('is-bad', !!msg);
          input.setAttribute('aria-invalid', msg ? 'true' : 'false');
          return !msg;
        },
        tip(msg) { note.textContent = msg || ''; note.className = 'auth-note' + (msg ? ' tip' : ''); },
        /* 提醒 + 一個可以直接按下去改掉的建議值 */
        tipFix(text, fix) {
          note.innerHTML = '';
          note.className = 'auth-note tip';
          note.append(document.createTextNode(text));
          const b = h('button', { class: 'auth-link tip', type: 'button' }, fix);
          b.addEventListener('click', () => { input.value = fix; api.tip(''); input.focus(); });
          note.append(b, document.createTextNode('?'));
        },
      };
      input.addEventListener('input', () => api.bad(''));
      return api;
    }

    function pwBox(input) {
      const btn = h('button', { class: 'auth-eye', type: 'button', 'aria-label': '顯示密碼', 'aria-pressed': 'false', html: EYE });
      btn.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-pressed', show ? 'true' : 'false');
        btn.setAttribute('aria-label', show ? '隱藏密碼' : '顯示密碼');
        btn.innerHTML = show ? EYE_OFF : EYE;
        input.focus();
      });
      return h('div', { class: 'auth-pw' }, input, btn);
    }

    /* opts:{ mode:'login'|'signup'|'forgot', closable, onCancel, onMode, backTo, autofocus } */
    function buildAuthCard(opts) {
      opts = opts || {};
      const card = h('div', { class: 'auth' });
      let mode = opts.mode === 'signup' || opts.mode === 'forgot' ? opts.mode : 'login';
      let firstDraw = true;
      draw();
      return card;

      function go(next) { mode = next; draw(); }

      function draw() {
        card.innerHTML = '';
        if (opts.onMode) opts.onMode(mode);
        const msg = h('p', { class: 'auth-msg', role: 'alert' });
        if (CLOUD.authError) { msg.textContent = CLOUD.authError; msg.className = 'auth-msg bad'; CLOUD.authError = ''; }

        if (mode === 'forgot') drawForgot(msg);
        else drawMain(msg);

        const focusMe = card.querySelector('input');
        if (focusMe && (!firstDraw || opts.autofocus !== false)) focusMe.focus();
        firstDraw = false;
      }

      function tabs() {
        const row = h('div', { class: 'modal-tabs' });
        [['login', '登入'], ['signup', '註冊']].forEach(([k, t]) => {
          row.append(h('button', {
            class: 'modal-tab' + (mode === k ? ' on' : ''), type: 'button',
            'aria-current': mode === k ? 'true' : null,
            onclick: () => go(k),
          }, t));
        });
        return row;
      }

      function googleBtn(msg) {
        const text = mode === 'signup' ? '使用 Google 帳戶註冊' : '使用 Google 帳戶登入';
        const label = h('span', null, text);
        const btn = h('button', { class: 'btn-google', type: 'button', 'aria-label': text }, h('span', { class: 'g-logo', html: G_LOGO }), label);
        btn.addEventListener('click', async () => {
          msg.textContent = ''; msg.className = 'auth-msg';
          btn.disabled = true;
          const old = label.textContent;
          label.textContent = '前往 Google';
          try { await CLOUD.signInWithGoogle(opts.backTo); }   // 成功就離開本頁
          catch (e) { msg.textContent = e.message; msg.className = 'auth-msg bad'; btn.disabled = false; label.textContent = old; }
        });
        return btn;
      }

      function submitBtn(text) {
        return h('button', { class: 'btn primary auth-submit', type: 'submit' }, text);
      }

      function formOf(btn, msg, run, ...rows) {
        const form = h('form', { class: 'auth-form', novalidate: 'novalidate' }, rows, msg, btn);
        form.addEventListener('submit', async e => {
          e.preventDefault();
          msg.textContent = ''; msg.className = 'auth-msg';
          const old = btn.textContent;
          const lock = t => { btn.disabled = true; btn.textContent = t; };
          const unlock = () => { btn.disabled = false; btn.textContent = old; };
          const fail = m => { msg.textContent = m; msg.className = 'auth-msg bad'; };
          await run({ lock, unlock, fail, ok: m => { msg.textContent = m; msg.className = 'auth-msg ok'; } });
        });
        return form;
      }

      function drawMain(msg) {
        if (mode === 'signup') {
          const name = authField({ label: '暱稱', type: 'text', name: 'nickname', ac: 'nickname', max: 20, hint: '老師會看到這個名字' });
          const email = authField({ label: 'Email', type: 'email', name: 'email', ac: 'email', inputmode: 'email' });
          const pw = authField({ label: '密碼', type: 'password', name: 'password', ac: 'new-password', hint: '至少 8 碼' });
          email.input.addEventListener('blur', () => {
            const v = email.value();
            if (!v) return;
            if (!EMAIL_RE.test(v)) return email.bad('Email 格式不對。');
            const fix = typoFix(v);
            if (fix) email.tipFix('是不是要打 ', fix);
          });
          const btn = submitBtn('註冊');
          const form = formOf(btn, msg, async ({ lock, unlock, fail }) => {
            let ok = true;
            ok = name.bad(name.value() ? '' : '暱稱還沒填。') && ok;
            ok = email.bad(EMAIL_RE.test(email.value()) ? '' : 'Email 格式不對。') && ok;
            ok = pw.bad(pw.raw().length >= 8 ? '' : '密碼至少 8 碼。') && ok;
            if (!ok) { const b = card.querySelector('.is-bad input'); if (b) b.focus(); return; }
            lock('註冊中');
            try {
              const r = await CLOUD.signUp(email.value(), pw.raw(), name.value());
              if (r.needsConfirm) sent(email.value());
            } catch (e) { fail(e.message); unlock(); }
          }, name.el, email.el, pw.el);
          card.append(tabs(), googleBtn(msg), orLine(), form,
            h('p', { class: 'auth-fine' }, '按下註冊即表示同意',
              h('a', { href: 'terms.html', target: '_blank', rel: 'noopener' }, '服務條款與隱私權說明'), '。'));
        } else {
          const email = authField({ label: 'Email', type: 'email', name: 'email', ac: 'username', inputmode: 'email' });
          const pw = authField({ label: '密碼', type: 'password', name: 'password', ac: 'current-password' });
          pw.el.append(h('p', { class: 'auth-aside' },
            h('button', { class: 'auth-link', type: 'button', onclick: () => go('forgot') }, '忘記密碼')));
          const btn = submitBtn('登入');
          const form = formOf(btn, msg, async ({ lock, unlock, fail }) => {
            let ok = true;
            ok = email.bad(EMAIL_RE.test(email.value()) ? '' : 'Email 格式不對。') && ok;
            ok = pw.bad(pw.raw() ? '' : '密碼還沒填。') && ok;
            if (!ok) { const b = card.querySelector('.is-bad input'); if (b) b.focus(); return; }
            lock('登入中');
            try { await CLOUD.login(email.value(), pw.raw()); }   // 成功後 afterAuth 會 reload
            catch (e) { fail(e.message); unlock(); }
          }, email.el, pw.el);
          card.append(tabs(), googleBtn(msg), orLine(), form);
        }
        if (opts.closable) card.append(cancelBtn());
      }

      function drawForgot(msg) {
        const email = authField({ label: 'Email', type: 'email', name: 'email', ac: 'email', inputmode: 'email' });
        const btn = submitBtn('寄重設信');
        const form = formOf(btn, msg, async ({ lock, unlock, fail, ok }) => {
          if (!email.bad(EMAIL_RE.test(email.value()) ? '' : 'Email 格式不對。')) { email.input.focus(); return; }
          lock('寄送中');
          try { await CLOUD.resetPassword(email.value()); ok('重設信已寄出,到信箱點連結設新密碼。'); }
          catch (e) { fail(e.message); unlock(); }
        }, email.el);
        card.append(
          h('div', { class: 'auth-head' }, opts.onMode ? null : h('h2', null, '重設密碼'),
            h('button', { class: 'auth-link', type: 'button', onclick: () => go('login') }, '回登入')),
          form,
          h('p', { class: 'auth-fine' }, '用 Google 登入的帳號沒有密碼,直接按 Google 登入就好。'));
        if (opts.closable) card.append(cancelBtn());
      }

      function orLine() { return h('div', { class: 'auth-or' }, h('span', null, '或')); }

      function cancelBtn() {
        return h('button', { class: 'btn auth-cancel', type: 'button', onclick: () => { if (opts.onCancel) opts.onCancel(); } }, '取消');
      }

      /* 註冊完、等點驗證信 */
      function sent(email) {
        if (opts.onMode) opts.onMode('sent');
        card.innerHTML = '';
        const msg = h('p', { class: 'auth-msg', role: 'alert' });
        const again = h('button', { class: 'btn', type: 'button' }, '重寄驗證信');
        again.addEventListener('click', async () => {
          again.disabled = true;
          try { await CLOUD.resendConfirm(email); msg.textContent = '已重寄。'; msg.className = 'auth-msg ok'; }
          catch (e) { msg.textContent = e.message; msg.className = 'auth-msg bad'; again.disabled = false; }
        });
        card.append(
          opts.onMode ? null : h('div', { class: 'auth-head' }, h('h2', null, '驗證信已寄出')),
          h('p', { class: 'auth-sent' }, '寄到 ', h('b', null, email), ',點信裡的連結就完成註冊並登入。沒收到先看垃圾郵件。'),
          h('div', { class: 'auth-row' }, again, opts.closable ? h('button', { class: 'btn', type: 'button', onclick: () => { if (opts.onCancel) opts.onCancel(); } }, '關閉') : null),
          msg);
      }
    }

    /* 登入視窗:data-require-profile 的頁面不給關 */
    function showLogin(startTab) {
      if (document.querySelector('.modal-mask')) return;
      const required = document.body.hasAttribute('data-require-profile');
      const opener = document.activeElement;
      const mask = h('div', { class: 'modal-mask' });
      const box = h('div', { class: 'modal modal-auth', role: 'dialog', 'aria-modal': 'true', 'aria-label': '登入或註冊' });
      box.append(buildAuthCard({ mode: startTab, closable: !required, onCancel: close }));
      mask.append(box);
      document.body.append(mask);

      box.addEventListener('keydown', e => {
        if (e.key !== 'Tab') return;
        const f = Array.from(box.querySelectorAll('button,input,a[href]')).filter(x => !x.disabled);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      if (!required) {
        mask.addEventListener('mousedown', e => { if (e.target === mask) close(); });
        document.addEventListener('keydown', onKey);
      }

      function onKey(e) { if (e.key === 'Escape') close(); }
      function close() {
        document.removeEventListener('keydown', onKey);
        mask.remove();
        /* 開視窗的那顆按鈕可能在已收起的選單裡(focus 會失效),退回頭像按鈕 */
        try { if (opener && opener.focus) opener.focus(); } catch (e) {}
        if (document.activeElement === document.body) {
          const back = document.querySelector('.profile-btn');
          if (back) back.focus();
        }
      }
    }

    return;   // 雲端模式到此為止,不載入本機檔案邏輯
  }

  /* ========================================================= */
  /* 本機模式(原行為)                                           */
  /* ========================================================= */
  function getProfiles() { return store.get('profiles', []); }
  function saveProfiles(list) { store.set('profiles', list); }
  function currentProfile() {
    const id = window.__PROFILE_ID;
    return getProfiles().find(p => p.id === id) || null;
  }

  function switchTo(id) {
    store.set('current_profile', id);
    location.reload();
  }

  function createProfile(name) {
    name = String(name || '').trim();
    if (!name) return null;
    const list = getProfiles();
    const id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    list.push({ id, name, created: new Date().toISOString().slice(0, 10) });
    saveProfiles(list);
    return id;
  }

  function deleteProfile(id) {
    currentKeys(id).forEach(k => localStorage.removeItem(k));
    saveProfiles(getProfiles().filter(p => p.id !== id));
    if (window.__PROFILE_ID === id) localStorage.removeItem('tr_current_profile');
    location.reload();
  }

  function importProfile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        if (payload.app !== 'toeic-reading-room' || !payload.data) throw new Error('格式不符');
        const name = payload.name ? payload.name + '(匯入)' : '匯入的學生';
        const id = createProfile(name);
        for (const [k, v] of Object.entries(payload.data)) {
          localStorage.setItem('tr_u' + id + '_' + k, v);
        }
        switchTo(id);
      } catch (e) {
        alert('匯入失敗:' + e.message);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  /* ---------- 頂欄小工具 ---------- */
  function buildWidget() {
    const bar = document.querySelector('.topbar-inner');
    if (!bar) return;
    const p = currentProfile();
    const widget = h('div', { class: 'profile-widget' });
    const btn = h('button', { class: 'profile-btn', type: 'button' },
      h('span', { class: 'profile-dot' }, p ? p.name.slice(0, 1) : '?'),
      p ? p.name : '選擇學生', ' ▾');
    const menu = h('div', { class: 'profile-menu', style: 'display:none' });
    widget.append(btn, menu);
    bar.append(widget);

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (menu.style.display === 'none') { drawMenu(); menu.style.display = ''; }
      else menu.style.display = 'none';
    });
    document.addEventListener('click', () => { menu.style.display = 'none'; });
    menu.addEventListener('click', e => e.stopPropagation());

    function drawMenu() {
      menu.innerHTML = '';
      const cur = currentProfile();
      menu.append(h('div', { class: 'pm-head' }, '學生檔案'));
      getProfiles().forEach(pr => {
        menu.append(h('button', {
          class: 'pm-item' + (cur && pr.id === cur.id ? ' cur' : ''),
          type: 'button',
          onclick: () => switchTo(pr.id),
        }, pr.name, cur && pr.id === cur.id ? ' ✓' : ''));
      });
      if (cur) {
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { location.href = 'analysis.html'; } }, '能力分析'));
          menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { location.href = 'review.html'; } }, '每日複習'));
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { location.href = 'history.html'; } }, '學習記錄'));
      }
      menu.append(h('div', { class: 'pm-sep' }));
      menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { menu.style.display = 'none'; showGate(true); } }, '＋ 新增學生'));
      if (cur) {
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => exportData(cur.id, cur.name) }, '匯出進度(給老師或換電腦)'));
      }
      const fileInput = h('input', { type: 'file', accept: '.json', style: 'display:none' });
      fileInput.addEventListener('change', () => { if (fileInput.files[0]) importProfile(fileInput.files[0]); });
      menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => fileInput.click() }, '匯入進度檔'), fileInput);
      if (cur) {
        menu.append(h('div', { class: 'pm-sep' }));
        menu.append(h('button', {
          class: 'pm-item danger', type: 'button',
          onclick: () => {
            if (confirm('確定刪除「' + cur.name + '」的檔案?這位學生的所有進度與錯題紀錄都會消失,無法復原。')) deleteProfile(cur.id);
          },
        }, '刪除這個檔案'));
      }
    }
  }

  /* ---------- 建檔視窗(gate) ---------- */
  function showGate(voluntary) {
    if (document.querySelector('.modal-mask')) return;
    const list = getProfiles();
    const input = h('input', { class: 'modal-input', type: 'text', placeholder: '輸入名字,例如:小安', maxlength: '20' });
    const createBtn = h('button', {
      class: 'btn primary', type: 'button',
      onclick: () => {
        const id = createProfile(input.value);
        if (id) switchTo(id);
        else input.focus();
      },
    }, '建立檔案,開始練習');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') createBtn.click(); });

    const mask = h('div', { class: 'modal-mask' },
      h('div', { class: 'modal' },
        h('h2', null, voluntary ? '新增學生' : '你是哪位?'),
        h('p', { class: 'modal-sub' }, '每位學生有自己的進度、錯題與檢測報告,都只存在這台裝置上。'),
        list.length ? h('div', { class: 'modal-list' },
          h('div', { class: 'pm-head' }, '選擇既有檔案'),
          list.map(pr => h('button', { class: 'pm-item big', type: 'button', onclick: () => switchTo(pr.id) },
            h('span', { class: 'profile-dot' }, pr.name.slice(0, 1)), pr.name))) : null,
        h('div', { class: 'pm-head', style: 'margin-top:14px' }, list.length ? '或建立新檔案' : '建立你的檔案'),
        h('div', { class: 'modal-row' }, input, createBtn),
        voluntary ? h('button', {
          class: 'btn', style: 'margin-top:12px', type: 'button',
          onclick: () => mask.remove(),
        }, '取消') : null));
    document.body.append(mask);
    input.focus();
  }

  window.PROFILE = { current: currentProfile, showGate };

  document.addEventListener('DOMContentLoaded', () => {
    buildWidget();
    if (document.body.hasAttribute('data-require-profile') && !currentProfile()) showGate(false);
  });
})();
