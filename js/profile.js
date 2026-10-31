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

  /* 頭像選單的「安裝到手機」:window.APP 由 js/app-shell.js 提供,沒載入或不能裝就不顯示 */
  function installItem(menu) {
    if (!window.APP || !window.APP.canOfferInstall()) return null;
    return h('button', { class: 'pm-item', type: 'button', onclick: () => { menu.style.display = 'none'; window.APP.install(); } }, '安裝到手機');
  }

  const X_ICON = '<svg viewBox="0 0 22 22" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">'
    + '<path d="M5 5 17 17M17 5 5 17"/></svg>';

  /* ========================================================= */
  /* 先看再登入(站長 2026-10-31)                                */
  /* ========================================================= */
  /* 照 Quizlet、Duolingo 網頁版的慣例:內容公開,要留下紀錄的動作才請登入。
     - 內容頁(文法、發音、閱讀、對話、單字、聽力、寫作、刷題、檢測、模擬考)的 body 是 data-require-profile="on-action":
       沒登入(雲端)、沒選學生(本機)也照常畫出內容。頁面程式在「作答、開始、送出、作答框」這類元素上標 data-gate,
       第一次按下去時,這裡在動作生效之前攔下(不寫資料、畫面不變),跳出同一張登入卡或「你是哪位？」,可以關,關了再按又跳。
     - 個人頁(學習記錄、能力分析、每日複習、教師後台)是不帶值的 data-require-profile:照舊一打開就要登入、關不掉。
     舊版 profile.js 只看有沒有這個屬性,碰到帶值的也當成要登入:新舊檔案混在一起時只會退回以前的強制登入,不會比以前鬆。 */
  function gateMode() {
    const b = document.body;
    const v = b && typeof b.getAttribute === 'function' ? b.getAttribute('data-require-profile') : null;
    if (v === null || v === undefined) return '';
    return v === 'on-action' ? 'action' : 'hard';
  }

  /* 攔截:document 的 capture 階段(比元素自己的 onclick、閱讀頁字卡的 pointerdown、文章單字的 stopPropagation 都早),
     preventDefault + stopPropagation。不用 stopImmediatePropagation、不掛在 window:舊網址自動搬家(js/move-out.js)
     在 window 的 capture 看使用者有沒有動作,一定要先看到這一下才會取消自動搬家;小雞(pet-roam2.js)也掛在 document 的 capture,照常收得到。
     - click、Enter/空白鍵:開視窗。pointerdown、mousedown、輸入(beforeinput、paste、drop):靜默擋下(字卡拖不動、作答框打不進字),等 click 再開。
     - 作答框:focus 進來(滑鼠、鍵盤 Tab、頁面自動 focus)就設 readonly,中文輸入法、手機鍵盤也進不來;按一個字才開視窗。登入、建檔後頁面會重載。 */
  const NAV_KEYS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'ContextMenu']);
  function isTextField(el) { return el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(el.type || '')); }
  function installActionGate(canAct, ask) {
    const locked = new Set();   // 這裡設成 readonly 的作答框
    function onGate(e) {
      const t = e.target;
      const el = t && typeof t.closest === 'function' ? t.closest('[data-gate]') : null;
      if (!el) return;
      if (canAct()) {
        /* 雲端確認完其實是登入著的(這一頁沒有重載):之前鎖住的作答框打開 */
        if (locked.has(el)) { el.readOnly = false; locked.delete(el); }
        return;
      }
      const text = isTextField(el);
      if (text && !el.readOnly) { el.readOnly = true; locked.add(el); }
      if (e.type === 'focusin') return;
      if (e.type === 'keydown') {
        if (NAV_KEYS.has(e.key) || /^F\d+$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
        if (!text && e.key !== 'Enter' && !(e.key === ' ' && el.tagName !== 'A')) return;   // 空白鍵在連結上是捲動頁面,不算按下去
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'click' || e.type === 'keydown') ask(el);
    }
    ['pointerdown', 'mousedown', 'click', 'keydown', 'beforeinput', 'paste', 'drop', 'focusin'].forEach(type => document.addEventListener(type, onGate, true));
  }

  /* 頭像選單開著時按到作答鈕:選單本來靠 document 的 click 收起來,這一下被攔了,這裡自己收 */
  function hideMenus() {
    Array.from(document.querySelectorAll('.profile-menu')).forEach(m => { m.style.display = 'none'; });
  }

  /* 視窗裡 Tab 只在視窗裡轉(本機的「你是哪位？」可關版本用;雲端登入卡有自己的一套,處理身分選項) */
  function trapTab(box) {
    box.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const f = Array.from(box.querySelectorAll('button,input,a[href]')).filter(x => !x.disabled);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* 關掉視窗後焦點回到開視窗的那顆按鈕;它已經不在畫面上(收起的選單、重畫掉的題目)就退回頭像按鈕 */
  function focusBack(opener) {
    try { if (opener && opener.isConnected !== false && opener.focus) opener.focus(); } catch (e) {}
    if (document.activeElement === document.body || !document.activeElement) {
      const back = document.querySelector('.profile-btn');
      if (back) back.focus();
    }
  }

  /* ========================================================= */
  /* 雲端模式                                                   */
  /* ========================================================= */
  if (window.CLOUD && CLOUD.enabled) {
    /* 能不能作答(先看再登入用,同步回答)。雲端確認登入(CLOUD.ready)之前 CLOUD.user 一律是 null,
       已登入的人開頁頭一秒(離線又遇到登入憑證過期最多約 25 秒)看起來也像訪客:這段時間看這一頁的資料夾,
       c 開頭就是登入著的帳號(寫入本來就寫進那個資料夾),跟以前一樣照常作答。確認完以 CLOUD.user 為準。 */
    let settled = false;
    Promise.resolve(CLOUD.ready).then(() => { settled = true; }, () => { settled = true; });
    const canAct = () => {
      if (CLOUD.user) return true;
      if (settled) return false;
      const pid = window.__PROFILE_ID;
      return typeof pid === 'string' && pid.charAt(0) === 'c';
    };
    /* 作答被攔下:開可以關的登入卡,多一句為什麼要登入 */
    const askToAct = opener => {
      if (canAct()) return;
      hideMenus();
      const close = showLogin('login', { why: true, opener });
      /* 還沒確認登入就按了,確認完其實是登入著的(而且這一頁不重載):卡片自己收掉,再按一次就照常作答 */
      if (close && !settled) Promise.resolve(CLOUD.ready).then(() => { if (CLOUD.user && !CLOUD.reloading) close(); }, () => {});
    };

    window.PROFILE = {
      current() {
        if (!CLOUD.user) return null;
        const email = CLOUD.user.email || '';
        return { id: 'c' + CLOUD.user.id.replace(/-/g, ''), name: CLOUD.nameOf(CLOUD.user) || email.split('@')[0] };
      },
      showGate: showLogin,
      showLogin,
      buildAuthCard,   // signup.html 直接把同一張卡畫在頁面上
      renderAccount,   // me.html 的帳號區
      canAct,
      askToAct,
      /* store 與作答紀錄的最後一道(js/common.js canKeepProgress):內容頁、頁面載完之後、不能作答 → 不寫 */
      blocksWrite: () => gateMode() === 'action' && document.readyState !== 'loading' && !canAct(),
    };

    if (gateMode() === 'action') installActionGate(canAct, askToAct);

    document.addEventListener('DOMContentLoaded', async () => {
      await CLOUD.ready;
      buildCloudWidget();
      if (gateMode() === 'hard' && !CLOUD.user) showLogin();
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
      /* 一打開就要登入的頁面(個人頁)會開登入視窗,這句話改寫在登入卡裡(buildAuthCard),不放頂欄;先看再登入的內容頁跟一般頁一樣放頂欄 */
      if (CLOUD.sessionExpired && !p && gateMode() !== 'hard') expiredNotice(bar.parentNode);

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
          const inst = installItem(menu);
          if (inst) menu.append(h('div', { class: 'pm-sep' }), inst);
          return;
        }
        menu.append(h('div', { class: 'pm-head' }, CLOUD.user.email));
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { location.href = 'analysis.html'; } }, '能力分析'));
          menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { location.href = 'review.html'; } }, '每日複習'));
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { location.href = 'history.html'; } }, '學習記錄'));
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { menu.style.display = 'none'; location.href = 'me.html?join='; } }, '加入班級'));   // 「我的」頁打開加入視窗
        if (CLOUD.isTeacher) {
          menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { location.href = 'admin.html'; } }, '教師後台'));
        }
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => exportData(cur.id, cur.name) }, '匯出進度備份'));
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: renameUser }, '改暱稱'));
        const inst = installItem(menu);
        if (inst) menu.append(inst);
        menu.append(h('div', { class: 'pm-sep' }));
        menu.append(h('button', { class: 'pm-item danger', type: 'button', onclick: () => CLOUD.logout() }, '登出'));
        menu.append(h('button', { class: 'pm-item danger', type: 'button', onclick: deleteUser }, '刪除帳號'));
      }
    }

    /* 登入失效(別台按「登出所有裝置」、帳號刪除)改回訪客後,頂欄下面一行提示,只在那個分頁出現一次。
       照 GitHub、Slack 網頁版的作法:頁首下方一條可關閉的提示加登入連結,不自動彈出登入視窗
       (共用電腦上的下一個人也會看到,不該擋住他)。 */
    function expiredNotice(topbar) {
      if (!topbar) return;
      CLOUD.sessionExpired = false;   // 從這裡開的登入卡不用再講一次
      const note = h('div', { class: 'auth-expired', role: 'status' });
      /* 關掉後焦點退回頭像按鈕(App 外殼裡頭像藏起來時退回返回鍵),不要掉到頁面最上面 */
      const close = () => {
        const had = note.contains(document.activeElement);
        note.remove();
        if (!had) return;
        const back = [document.querySelector('.profile-btn'), document.querySelector('.app-back')].find(el => el && el.offsetParent);
        if (back) back.focus();
      };
      note.append(
        h('span', null, '登入已失效，請重新登入'),
        h('button', { class: 'auth-expired-login', type: 'button', onclick: () => { close(); showLogin('login'); } }, '登入'),
        h('button', { class: 'auth-expired-x', type: 'button', 'aria-label': '關閉', html: X_ICON, onclick: close }));
      topbar.append(note);
    }

    /* 改暱稱、刪除帳號:頭像選單與「我的」頁(me.html)共用 */
    async function renameUser() {
      const n = prompt('暱稱（老師會看到這個名字）', CLOUD.nameOf(CLOUD.user));
      if (n === null) return;
      try { await CLOUD.updateName(n); location.reload(); }
      catch (e) { alert(e.message); }
    }

    /* 照 Netflix、Spotify 帳號頁的作法:一般的登出只登出這台,「登出所有裝置」另外一列、先確認 */
    function logoutEverywhere() {
      if (!confirm('要登出所有裝置嗎？這台會馬上登出，其他已登入的手機、電腦最晚約一小時內也會登出，下次要重新登入。')) return;
      CLOUD.logout({ everywhere: true }).catch(e => alert(e.message));
    }

    function deleteUser() {
      if (!confirm('確定要刪除帳號？雲端上的所有進度、錯題與寫作內容都會永久刪除，無法復原。付款紀錄依法保留。')) return;
      if (!confirm('再確認一次：真的要刪除「' + CLOUD.user.email + '」？')) return;
      CLOUD.deleteAccount().catch(e => alert(e.message));
    }

    /* 「我的」頁(me.html)的帳號區:由 js/me.js 在 CLOUD.ready 之後呼叫 */
    function renderAccount(root) {
      root.innerHTML = '';
      const cur = PROFILE.current();
      if (!cur) {
        root.append(h('div', { class: 'me-head' },
          h('span', { class: 'profile-dot me-dot', 'aria-hidden': 'true' }, '?'),
          h('div', { class: 'me-actions' },
            h('button', { class: 'btn primary', type: 'button', onclick: () => showLogin('login') }, '登入'),
            h('button', { class: 'btn', type: 'button', onclick: () => showLogin('signup') }, '註冊帳號'))));
        return;
      }
      const row = (label, opt) => h('li', null, opt.href
        ? h('a', { class: 'me-row', href: opt.href }, label)
        : h('button', { class: 'me-row' + (opt.danger ? ' danger' : ''), type: 'button', onclick: opt.run }, label));
      const list = (...rows) => h('ul', { class: 'me-list' }, rows.filter(Boolean));
      /* 方案狀態、方案與付款、開始老師試用(js/paywall.js):只有 PAID_UI 打開才有,沒開時這一頁跟以前一模一樣 */
      const paid = !!(window.PAYWALL && PAYWALL.enabled());
      const who = h('div', { class: 'me-who' }, h('b', { class: 'me-name' }, cur.name), h('span', { class: 'me-mail' }, CLOUD.user.email || ''));
      const links = list(row('能力分析', { href: 'analysis.html' }), row('學習記錄', { href: 'history.html' }),
        CLOUD.isTeacher ? row('教師後台', { href: 'admin.html' }) : null);
      let plans = null;
      const classOpts = paid ? {
        ready: fresh => (fresh ? CLOUD.refreshAccess() : CLOUD.accessReady),
        statusOf: id => PAYWALL.classStatus(CLOUD.access, id),
        onChange: () => { if (plans) plans.update(); },
      } : undefined;
      root.append(
        h('div', { class: 'me-head' },
          h('span', { class: 'profile-dot me-dot', 'aria-hidden': 'true' }, cur.name.slice(0, 1).toUpperCase()),
          who),
        links,
        window.CLASSES ? CLASSES.section(classOpts) : null,   // 班級(js/classes.js,只有 me.html 載入)
        list(row('匯出進度備份', { run: () => exportData(cur.id, cur.name) }), row('改暱稱', { run: renameUser })),
        list(row('登出', { run: () => CLOUD.logout(), danger: true }), row('登出所有裝置', { run: logoutEverywhere, danger: true })),
        h('p', { class: 'me-delete' }, h('button', { type: 'button', onclick: deleteUser }, '刪除帳號')));
      /* 老師試用開通後:重新查使用權(教師後台那一列、老師方案那一列才會出現)再整頁重畫 */
      if (paid) plans = PAYWALL.account({ who, after: links, onTrial: () => { Promise.resolve(CLOUD.refreshAccess()).then(() => renderAccount(root), () => renderAccount(root)); } });
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
          note.append(b, document.createTextNode('？'));
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

    /* ---------- 註冊時選身分(前端計畫四;只有 window.PAID_UI === true 才出現) ----------
       做法參考 Quizlet(註冊表單裡就問是不是老師,預設不是)、Kahoot(先選帳號類型,選了才出現那一類要填的欄位)、
       Google Classroom(兩張「我是學生」「我是老師」大選項卡):兩張選項卡放在 Google 鈕上面(兩種註冊都適用),預設學生。
       選老師只多三樣:名額(數字與價錢)、選填的班級名稱、方案說明連結;試用規則只寫在 pricing.html。
       意向只是提示(js/cloud.js saveSignupIntent),權限一律看資料庫。 */
    function paidUi() { return window.PAID_UI === true; }
    /* 不看 PAID_UI:沒載入 plans-config 的頁面也要清掉別頁留下的老師意向。
       PAID_UI 沒開時從來不會存意向,清一個不存在的鍵什麼都不會變 */
    function forgetIntent() {
      if (typeof CLOUD.clearSignupIntent === 'function') CLOUD.clearSignupIntent();
    }

    const SEAT_OPTIONS = [10, 30, 60];
    const NB = ' ';   // 數字與單位之間不換行
    /* 名額選項的字:「10 位以內」「每月 390 元」(名額的寫法跟價格頁一樣),價錢照 window.PLANS(js/plans-config.js);沒有價錢就只寫人數 */
    function seatChoices(plans) {
      const t = (plans && plans.teacher) || {};
      return SEAT_OPTIONS.map(n => ({
        seats: n,
        count: n + NB + '位以內',
        price: typeof t[n] === 'number' ? '每月 ' + String(t[n]).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + NB + '元' : '',
      }));
    }

    let roleSeq = 0;
    /* onRole(身分):換身分時通知註冊卡(選老師時藏起暱稱下面「老師會看到這個名字」) */
    function rolePicker(onRole) {
      const seq = ++roleSeq;
      let role = 'student', seats = SEAT_OPTIONS[0];
      const radio = (name, value, on) => {
        const input = h('input', { type: 'radio', name, value: String(value) });
        input.checked = !!on;
        return input;
      };
      const panel = h('div', { class: 'auth-teacher' });
      panel.hidden = true;
      const cardOf = (value, text) => {
        const input = radio('auth-role-' + seq, value, value === role);
        input.addEventListener('change', () => {
          if (!input.checked) return;
          role = value;
          panel.hidden = role !== 'teacher';
          if (role === 'student') forgetIntent();   // 選學生:這台留著的老師意向作廢
          if (onRole) onRole(role);
        });
        return h('label', { class: 'auth-role-card' }, input, h('span', null, text));
      };
      const seatRows = seatChoices(window.PLANS).map((c, i) => {
        const input = radio('auth-seats-' + seq, c.seats, i === 0);
        input.addEventListener('change', () => { if (input.checked) seats = c.seats; });
        return h('label', { class: 'auth-seat' }, input,
          h('span', { class: 'auth-seat-n' }, c.count), c.price ? ' ' : null, c.price ? h('span', { class: 'auth-seat-p' }, c.price) : null);
      });
      const className = authField({ label: '班級名稱', type: 'text', name: 'class-name', ac: 'off', max: 30, hint: '空白就用「我的班級」' });
      panel.append(
        h('fieldset', { class: 'auth-seats' }, h('legend', null, '名額'), h('div', { class: 'auth-seat-list' }, seatRows)),
        className.el,
        h('p', { class: 'auth-plan' }, h('a', { href: 'pricing.html', target: '_blank', rel: 'noopener' }, '方案說明')));
      const el = h('fieldset', { class: 'auth-role' },
        h('legend', { class: 'auth-role-legend' }, '身分'),
        h('div', { class: 'auth-role-row' }, cardOf('student', '我是學生'), cardOf('teacher', '我是老師')),
        panel);
      return {
        el,
        /* 按註冊或 Google 之前呼叫:選老師就存 { 名額, 班名, Email(Email 註冊才有) }(只存在這台,不送給 signUp),
           選學生就清掉 */
        save(email) {
          if (role !== 'teacher') { forgetIntent(); return; }
          const o = { seats, name: className.value() };
          if (email) o.email = email;
          CLOUD.saveSignupIntent(o);
        },
      };
    }

    /* opts:{ mode:'login'|'signup'|'forgot', onMode, backTo, autofocus } */
    function buildAuthCard(opts) {
      opts = opts || {};
      const card = h('div', { class: 'auth' });
      let mode = opts.mode === 'signup' || opts.mode === 'forgot' ? opts.mode : 'login';
      let firstDraw = true;
      draw();
      return card;

      function go(next) {
        if (next === 'login') forgetIntent();   // 切到登入分頁:註冊時選老師的意向作廢
        mode = next; draw();
      }

      function draw() {
        card.innerHTML = '';
        if (opts.onMode) opts.onMode(mode);
        const msg = h('p', { class: 'auth-msg', role: 'alert' });
        if (CLOUD.authError) { msg.textContent = CLOUD.authError; msg.className = 'auth-msg bad'; CLOUD.authError = ''; }
        else if (CLOUD.sessionExpired && !CLOUD.user && mode === 'login') { msg.textContent = '登入已失效，請重新登入'; CLOUD.sessionExpired = false; }

        if (mode === 'forgot') drawForgot(msg);
        else drawMain(msg);

        const focusMe = card.querySelector('input');
        if (focusMe && (!firstDraw || opts.autofocus !== false)) focusMe.focus();
        firstDraw = false;
      }

      /* 標題:signup.html 用頁面的 h1(onMode 會去改它),登入視窗才自己畫 h2 */
      function heading(text) {
        return opts.onMode ? null : h('h2', { class: 'auth-h' }, text);
      }

      /* 作答被攔下時開的卡(opts.why):標題下面一句為什麼要登入。其他時候一個節點都不多 */
      function why(text) {
        return opts.why && !opts.onMode ? h('p', { class: 'auth-why' }, text) : null;
      }

      /* 底部一行切換。Engoo、Busuu、VoiceTube、均一都是這種做法:
         一個標題配一行「還沒有帳號?註冊」,不是兩個同級分頁。 */
      function switchLine(text, linkText, next) {
        return h('p', { class: 'auth-switch' }, text,
          h('button', { class: 'auth-link strong', type: 'button', onclick: () => go(next) }, linkText));
      }

      /* role:註冊分頁的身分選擇(PAID_UI 打開才有)。轉跳 Google 之前存好意向(Google 回來時頁面狀態都不見了);
         登入分頁按 Google 是登入,意向作廢 */
      function googleBtn(msg, role) {
        const text = mode === 'signup' ? '使用 Google 帳戶註冊' : '使用 Google 帳戶登入';
        const label = h('span', null, text);
        const btn = h('button', { class: 'btn-google', type: 'button', 'aria-label': text }, h('span', { class: 'g-logo', html: G_LOGO }), label);
        btn.addEventListener('click', async () => {
          msg.textContent = ''; msg.className = 'auth-msg';
          btn.disabled = true;
          const old = label.textContent;
          label.textContent = '前往 Google';
          if (role) role.save('');
          else forgetIntent();
          try { await CLOUD.signInWithGoogle(opts.backTo); }   // 成功就離開本頁
          catch (e) { forgetIntent(); msg.textContent = e.message; msg.className = 'auth-msg bad'; btn.disabled = false; label.textContent = old; }
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
          /* 身分選擇:PAID_UI 沒開時一個節點都不多。選老師時藏起暱稱的「老師會看到這個名字」(老師帳號的暱稱學生看不到) */
          const nameHint = name.el.querySelector('.auth-hint');
          const role = paidUi() ? rolePicker(r => { if (nameHint) nameHint.hidden = r === 'teacher'; }) : null;
          const btn = submitBtn('註冊');
          const form = formOf(btn, msg, async ({ lock, unlock, fail }) => {
            let ok = true;
            ok = name.bad(name.value() ? '' : '暱稱還沒填。') && ok;
            ok = email.bad(EMAIL_RE.test(email.value()) ? '' : 'Email 格式不對。') && ok;
            ok = pw.bad(pw.raw().length >= 8 ? '' : '密碼至少 8 碼。') && ok;
            if (!ok) { const b = card.querySelector('.is-bad input'); if (b) b.focus(); return; }
            /* 呼叫 signUp 之前存好(選學生、沒有身分選擇的頁面就清掉別頁留下的) */
            if (role) role.save(email.value());
            else forgetIntent();
            lock('註冊中');
            try {
              const r = await CLOUD.signUp(email.value(), pw.raw(), name.value());
              if (r.needsConfirm) sent(email.value());
            } catch (e) { forgetIntent(); fail(e.message); unlock(); }
          }, name.el, email.el, pw.el);
          put(heading('註冊'), why('註冊之後就能作答，練習紀錄會存在你的帳號。'), role ? role.el : null, googleBtn(msg, role), orLine(), form, consentLine(),
            switchLine('已經有帳號？', '登入', 'login'));
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
            forgetIntent();   // 登入既有帳號:註冊時選老師的意向作廢
            try { await CLOUD.login(email.value(), pw.raw()); }   // 成功後 afterAuth 會 reload
            catch (e) { fail(e.message); unlock(); }
          }, email.el, pw.el);
          put(heading('登入'), why('登入之後才能作答，練習紀錄會存在你的帳號。'), googleBtn(msg), orLine(), form, consentLine(),
            switchLine('還沒有帳號？', '註冊', 'signup'));
        }
      }

      function drawForgot(msg) {
        const email = authField({ label: 'Email', type: 'email', name: 'email', ac: 'email', inputmode: 'email' });
        const btn = submitBtn('寄重設信');
        const form = formOf(btn, msg, async ({ lock, unlock, fail, ok }) => {
          if (!email.bad(EMAIL_RE.test(email.value()) ? '' : 'Email 格式不對。')) { email.input.focus(); return; }
          lock('寄送中');
          try { await CLOUD.resetPassword(email.value()); ok('重設信已寄出，到信箱點連結設新密碼。'); }
          catch (e) { fail(e.message); unlock(); }
        }, email.el);
        put(heading('重設密碼'), form,
          h('p', { class: 'auth-fine' }, '用 Google 登入的帳號沒有密碼，直接按 Google 登入就好。'),
          switchLine(null, '回登入', 'login'));
      }

      function orLine() { return h('div', { class: 'auth-or' }, h('span', null, '或')); }

      /* 登入分頁也要有:第一次用 Google 登入等於建立帳號 */
      function consentLine() {
        return h('p', { class: 'auth-fine' }, '註冊或使用 Google 帳戶登入，即表示同意',
          h('a', { href: 'terms.html', target: '_blank', rel: 'noopener' }, '服務條款'), '與',
          h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, '隱私權政策'), '。');
      }

      /* 原生 append(null) 會印出 'null' 這個字,標題在頁面模式是 null,所以要先濾掉 */
      function put(...nodes) { card.append(...nodes.filter(Boolean)); }

      /* 註冊完、等點驗證信 */
      function sent(email) {
        if (opts.onMode) opts.onMode('sent');
        card.innerHTML = '';
        const msg = h('p', { class: 'auth-msg', role: 'alert' });
        const again = h('button', { class: 'btn auth-full', type: 'button' }, '重寄驗證信');
        again.addEventListener('click', async () => {
          again.disabled = true;
          try { await CLOUD.resendConfirm(email); msg.textContent = '已重寄。'; msg.className = 'auth-msg ok'; }
          catch (e) { msg.textContent = e.message; msg.className = 'auth-msg bad'; again.disabled = false; }
        });
        put(
          opts.onMode ? null : h('h2', { class: 'auth-h' }, '驗證信已寄出'),
          h('p', { class: 'auth-sent' }, '寄到 ', h('b', null, email), '，點信裡的連結就完成註冊並登入。沒收到先看垃圾郵件。'),
          again,
          msg);
      }
    }

    /* 登入視窗:一打開就要登入的頁面(不帶值的 data-require-profile)不給關;先看再登入的內容頁、一般頁可以關。
       opts:{ why:作答被攔下時開的(卡上多一句為什麼要登入), opener:關掉後焦點回到哪裡(預設開視窗時的焦點) }。
       回傳關掉視窗的函式(已經有別的視窗開著、這次沒開就回 null) */
    function showLogin(startTab, opts) {
      opts = opts || {};
      if (document.querySelector('.modal-mask')) return null;
      const required = gateMode() === 'hard';
      /* App 外殼裡,強制登入的遮罩刻意露出頂欄和分頁列(沒登入也能點分頁離開),就不算整頁鎖住:
         不標 aria-modal、不鎖 Tab,改把被遮住的內容設成 inert,鍵盤和 VoiceOver 才走得到返回鍵和分頁 */
      const shellGate = required && document.documentElement.classList.contains('app-shell');
      const opener = opts.opener || document.activeElement;
      const mask = h('div', { class: 'modal-mask' });
      const box = h('div', { class: 'modal modal-auth', role: 'dialog', 'aria-modal': shellGate ? null : 'true', 'aria-label': '登入或註冊' });
      if (!required) box.append(h('button', { class: 'modal-close', type: 'button', 'aria-label': '關閉', html: X_ICON, onclick: () => close() }));
      box.append(buildAuthCard({ mode: startTab, why: !!opts.why }));
      mask.append(box);
      document.body.append(mask);
      if (shellGate) {
        document.documentElement.classList.add('app-gate');
        Array.from(document.body.children).forEach(el => {
          if (el !== mask && !el.matches('.topbar, .app-tabbar, script')) el.inert = true;
        });
      }

      box.addEventListener('keydown', e => {
        if (shellGate || e.key !== 'Tab') return;
        const f = Array.from(box.querySelectorAll('button,input,a[href]')).filter(x => !x.disabled);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        /* 第一個是身分選項時,整組 radio 算同一站(選了老師,停在組裡的是「我是老師」);PAID_UI 沒開時第一個不會是 radio */
        const a = document.activeElement;
        const atFirst = a === first || (first.type === 'radio' && a && a.type === 'radio' && a.name === first.name);
        if (e.shiftKey && atFirst) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      if (!required) {
        mask.addEventListener('mousedown', e => { if (e.target === mask) close(); });
        document.addEventListener('keydown', onKey);
      }

      function onKey(e) { if (e.key === 'Escape') close(); }
      function close() {
        if (!mask.parentNode) return;
        document.removeEventListener('keydown', onKey);
        mask.remove();
        /* 開視窗的那顆按鈕可能在已收起的選單裡(focus 會失效),退回頭像按鈕 */
        focusBack(opener);
      }
      return close;
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
        const name = payload.name ? payload.name + '（匯入）' : '匯入的學生';
        const id = createProfile(name);
        for (const [k, v] of Object.entries(payload.data)) {
          localStorage.setItem('tr_u' + id + '_' + k, v);
        }
        switchTo(id);
      } catch (e) {
        alert('匯入失敗：' + e.message);
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
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => exportData(cur.id, cur.name) }, '匯出進度（給老師或換電腦）'));
      }
      const fileInput = h('input', { type: 'file', accept: '.json', style: 'display:none' });
      fileInput.addEventListener('change', () => { if (fileInput.files[0]) importProfile(fileInput.files[0]); });
      menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => fileInput.click() }, '匯入進度檔'), fileInput);
      const inst = installItem(menu);
      if (inst) menu.append(inst);
      if (cur) {
        menu.append(h('div', { class: 'pm-sep' }));
        menu.append(h('button', {
          class: 'pm-item danger', type: 'button',
          onclick: () => {
            if (confirm('確定刪除「' + cur.name + '」的檔案？這位學生的所有進度與錯題紀錄都會消失，無法復原。')) deleteProfile(cur.id);
          },
        }, '刪除這個檔案'));
      }
    }
  }

  /* ---------- 建檔視窗(gate) ----------
     voluntary:true =「＋ 新增學生」(有取消);false = 一打開就要選學生的個人頁(關不掉);
     'act' = 內容頁作答被攔下(標題照舊「你是哪位？」,多一句為什麼,X、Esc、點遮罩都能關,關掉焦點回到 opener)。
     回傳關掉視窗的函式('act' 才有;已經有別的視窗開著、這次沒開就回 null) */
  function showGate(voluntary, opener) {
    if (document.querySelector('.modal-mask')) return null;
    const act = voluntary === 'act';
    const list = getProfiles();
    const input = h('input', { class: 'modal-input', type: 'text', placeholder: '輸入名字，例如：小安', maxlength: '20' });
    const createBtn = h('button', {
      class: 'btn primary', type: 'button',
      onclick: () => {
        const id = createProfile(input.value);
        if (id) switchTo(id);
        else input.focus();
      },
    }, '建立檔案，開始練習');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') createBtn.click(); });

    const box = h('div', act ? { class: 'modal modal-gate', role: 'dialog', 'aria-modal': 'true', 'aria-label': '你是哪位？' } : { class: 'modal' },
      act ? h('button', { class: 'modal-close', type: 'button', 'aria-label': '關閉', html: X_ICON, onclick: () => close() }) : null,
      h('h2', null, voluntary === true ? '新增學生' : '你是哪位？'),
      act ? h('p', { class: 'modal-why' }, '選好你的檔案才能作答，練習紀錄會存在這個檔案裡。') : null,
      h('p', { class: 'modal-sub' }, '每位學生有自己的進度、錯題與檢測報告，都只存在這台裝置上。'),
      list.length ? h('div', { class: 'modal-list' },
        h('div', { class: 'pm-head' }, '選擇既有檔案'),
        list.map(pr => h('button', { class: 'pm-item big', type: 'button', onclick: () => switchTo(pr.id) },
          h('span', { class: 'profile-dot' }, pr.name.slice(0, 1)), pr.name))) : null,
      h('div', { class: 'pm-head', style: 'margin-top:14px' }, list.length ? '或建立新檔案' : '建立你的檔案'),
      h('div', { class: 'modal-row' }, input, createBtn),
      voluntary === true ? h('button', {
        class: 'btn', style: 'margin-top:12px', type: 'button',
        onclick: () => mask.remove(),
      }, '取消') : null);
    const mask = h('div', { class: 'modal-mask' }, box);
    document.body.append(mask);
    input.focus();
    if (!act) return null;

    trapTab(box);
    mask.addEventListener('mousedown', e => { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);
    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() {
      if (!mask.parentNode) return;
      document.removeEventListener('keydown', onKey);
      mask.remove();
      focusBack(opener);
    }
    return close;
  }

  /* 先看再登入:本機模式「能作答」= 選好了學生(檔案還在) */
  const canAct = () => !!currentProfile();
  const askToAct = opener => {
    if (canAct()) return;
    hideMenus();
    showGate('act', opener || document.activeElement);
  };

  window.PROFILE = {
    current: currentProfile, showGate, canAct, askToAct,
    /* store 與作答紀錄的最後一道(js/common.js canKeepProgress):內容頁、頁面載完之後、不能作答 → 不寫 */
    blocksWrite: () => gateMode() === 'action' && document.readyState !== 'loading' && !canAct(),
  };

  if (gateMode() === 'action') installActionGate(canAct, askToAct);

  document.addEventListener('DOMContentLoaded', () => {
    buildWidget();
    if (gateMode() === 'hard' && !currentProfile()) showGate(false);
  });
})();
