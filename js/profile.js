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
        return { id: 'c' + CLOUD.user.id.replace(/-/g, ''), name: email.split('@')[0] };
      },
      showGate: showLogin,
    };

    document.addEventListener('DOMContentLoaded', async () => {
      await CLOUD.ready;
      buildCloudWidget();
      if (document.body.hasAttribute('data-require-profile') && !CLOUD.user) showLogin();
    });

    function buildCloudWidget() {
      const bar = document.querySelector('.topbar-inner');
      if (!bar) return;
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
          menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { menu.style.display = 'none'; showLogin(); } }, '登入'));
          return;
        }
        menu.append(h('div', { class: 'pm-head' }, CLOUD.user.email));
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { location.href = 'analysis.html'; } }, '能力分析'));
        if (CLOUD.isTeacher) {
          menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => { location.href = 'admin.html'; } }, '教師後台'));
        }
        menu.append(h('button', { class: 'pm-item', type: 'button', onclick: () => exportData(cur.id, cur.name) }, '匯出進度備份'));
        menu.append(h('div', { class: 'pm-sep' }));
        menu.append(h('button', { class: 'pm-item danger', type: 'button', onclick: () => CLOUD.logout() }, '登出'));
      }
    }

    function showLogin() {
      if (document.querySelector('.modal-mask')) return;
      const email = h('input', { class: 'modal-input', type: 'text', placeholder: '帳號(老師給你的)', autocomplete: 'username' });
      const pw = h('input', { class: 'modal-input', type: 'password', placeholder: '密碼', autocomplete: 'current-password' });
      const err = h('div', { style: 'color:var(--bad);font-size:13.5px;margin-top:8px;min-height:20px' });
      const loginBtn = h('button', {
        class: 'btn primary', type: 'button',
        onclick: async () => {
          err.textContent = '';
          loginBtn.disabled = true; loginBtn.textContent = '登入中…';
          try {
            await CLOUD.login(email.value, pw.value);   // 成功後 afterAuth 會 reload
          } catch (e) {
            err.textContent = e.message;
            loginBtn.disabled = false; loginBtn.textContent = '登入';
          }
        },
      }, '登入');
      [email, pw].forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') loginBtn.click(); }));

      document.body.append(h('div', { class: 'modal-mask' },
        h('div', { class: 'modal' },
          h('h2', null, '登入'),
          h('p', { class: 'modal-sub' }, '帳號密碼由老師發放。登入後,你的進度、錯題與檢測報告會自動同步,換電腦也能接續。'),
          h('div', { style: 'display:grid;gap:8px' }, email, pw),
          err,
          h('div', { class: 'modal-row', style: 'margin-top:4px' }, loginBtn))));
      email.focus();
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
