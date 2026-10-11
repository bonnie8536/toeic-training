/* 教師後台的班級區(admin.html,js/admin.js 呼叫)。
   - ADMIN_CLASSES.api:純邏輯(tools/test_admin_classes.js 用假的 Supabase 測)。全部走既有的政策:
     classes 的「teacher owns classes」(老師新增、修改自己的班),memberships 的老師政策(讀、移除自己班上的人)。
     現在的資料庫(supabase_teacher_scoping.sql)與收費版(supabase_paid_access.sql)都能用:收費版只把 memberships
     的老師政策拆成讀與移除、加上邀請碼不分大小寫唯一,classes 的政策不變。
   - 學生資料一筆都不改:移除學生只刪「那一班、那一位」的一列 memberships(先確認);停用只改 active;
     換邀請碼只改 code;不刪班級、不碰 progress。
   - 方案與名額那一列(planInfo)只有 PAID_UI 打開、而且知道使用權(CLOUD.access)時才出現。
   做法參考 Google Classroom:班級設定裡的邀請碼可以複製、複製邀請連結、重設(舊碼失效)、關閉;
   成員頁每位學生一個移除,移除前先確認。班名與學生名字是使用者自己填的,一律用文字節點放進畫面。 */
(function () {
  /* 跟資料庫 gen_class_code 同一組字母:沒有 0、1、I、O */
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const CODE_TRIES = 5, INSERT_TRIES = 3;
  const NAME_MAX = 30;
  const NET_MSG = '連不上雲端伺服器，請檢查網路後再試。';
  const TZ_MS = 8 * 3600e3;   // 日期一律用台北時間顯示(跟 js/paywall.js 一樣)
  const CLASS_COLS = 'id,name,code,active,created_at', CLASS_COLS_OLD = 'id,name,code,created_at';

  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

  /* ---------- 純邏輯 ---------- */

  function genCode(rand) {
    let out = '';
    const c = window.crypto;
    if (!rand && c && typeof c.getRandomValues === 'function') {
      const buf = c.getRandomValues(new Uint32Array(8));
      for (let i = 0; i < 8; i++) out += ALPHABET.charAt(buf[i] % ALPHABET.length);
      return out;
    }
    const r = rand || Math.random;
    for (let i = 0; i < 8; i++) out += ALPHABET.charAt(Math.floor(r() * ALPHABET.length) % ALPHABET.length);
    return out;
  }

  function isNetwork(err) {
    return /failed to fetch|networkerror|load failed|timeout/i.test(String((err && err.message) || err || ''));
  }
  /* 資料庫的訊息原樣顯示,句尾沒有句號就補上 */
  function sentence(m) { return /[。！？!?.]$/.test(m) ? m : m + '。'; }
  function messageOf(err) {
    if (isNetwork(err)) return NET_MSG;
    const m = String((err && err.message) || '');
    return m ? sentence(m) : '發生錯誤，請稍後再試。';
  }
  function isUnique(err) { return !!err && (err.code === '23505' || /duplicate key|unique constraint/i.test(String(err.message || ''))); }
  function isNoActive(err) { return !!err && (err.code === '42703' || /column .*active.* does not exist/i.test(String(err.message || ''))); }

  async function session() {
    const C = window.CLOUD;
    if (!C || !C.enabled) return { message: '這個網站沒有開雲端帳號。' };
    try { await C.ready; } catch (e) { /* ready 不會失敗,保險 */ }
    if (!C.user) return { message: '請先登入。' };
    if (!C.client) return { message: NET_MSG };
    return { client: C.client, uid: C.user.id };
  }
  /* 查詢包一層:丟例外也當成錯誤回來 */
  async function run(q) {
    try { const r = await q; return r || { data: null, error: null }; } catch (e) { return { data: null, error: e }; }
  }

  const toClass = (r, hasActive) => ({ id: r.id, name: String(r.name == null ? '' : r.name), code: String(r.code || ''),
    active: hasActive ? r.active !== false : null, createdAt: r.created_at || '' });

  /* 自己的班(含停用的)與班上的成員。沒有 active 欄位的資料庫改用舊的查法 */
  async function list() {
    const s = await session();
    if (s.message) return { ok: false, message: s.message, classes: [], members: [], hasActive: false };
    const query = cols => s.client.from('classes').select(cols).eq('teacher_id', s.uid).order('created_at', { ascending: true });
    let hasActive = true;
    let r = await run(query(CLASS_COLS));
    if (r.error && isNoActive(r.error)) { hasActive = false; r = await run(query(CLASS_COLS_OLD)); }
    if (r.error) return { ok: false, message: messageOf(r.error), classes: [], members: [], hasActive };
    const classes = (Array.isArray(r.data) ? r.data : []).filter(isObj).map(x => toClass(x, hasActive));
    if (!classes.length) return { ok: true, classes, members: [], hasActive };
    const m = await run(s.client.from('memberships').select('student_id,class_id,joined_at')
      .in('class_id', classes.map(c => c.id)).order('joined_at', { ascending: true }));
    if (m.error) return { ok: true, classes, members: [], hasActive, membersMessage: messageOf(m.error) };
    const members = (Array.isArray(m.data) ? m.data : []).filter(isObj)
      .map(x => ({ studentId: x.student_id, classId: x.class_id, joinedAt: x.joined_at || '' }));
    return { ok: true, classes, members, hasActive };
  }

  function countOf(members, classId) { return (members || []).filter(m => m.classId === classId).length; }
  /* 名額 = 所有班(含停用的)不重複的學生,跟資料庫 _access_of 的 seats_used 同一個算法 */
  function seatsUsed(members) { return new Set((members || []).map(m => m.studentId)).size; }

  function cleanName(name) { return String(name == null ? '' : name).replace(/\s+/g, ' ').trim(); }

  /* 新增班級:只送 teacher_id 與班名,邀請碼由資料庫產生(default gen_class_code())。剛好撞號就再送一次 */
  async function create(name) {
    const n = cleanName(name);
    if (!n) return { ok: false, field: true, message: '請輸入班級名稱。' };
    if (n.length > NAME_MAX) return { ok: false, field: true, message: '班級名稱最多 ' + NAME_MAX + ' 個字。' };
    const s = await session();
    if (s.message) return { ok: false, message: s.message };
    for (let i = 0; i < INSERT_TRIES; i++) {
      const r = await run(s.client.from('classes').insert({ teacher_id: s.uid, name: n }).select('id,name,code'));
      if (r.error && isUnique(r.error)) continue;
      if (r.error) return { ok: false, message: messageOf(r.error) };
      const row = Array.isArray(r.data) ? r.data[0] : r.data;
      if (!isObj(row)) return { ok: false, message: '班級可能已經建立，請重新整理看看。' };
      return { ok: true, class: { id: row.id, name: String(row.name == null ? n : row.name), code: String(row.code || '') } };
    }
    return { ok: false, message: '邀請碼剛好跟別班重複，請再按一次新增。' };
  }

  /* 只改這一班的一個欄位;更新到 0 列(別人的班、已經不在)照實說 */
  async function updateOne(s, classId, patch) {
    return run(s.client.from('classes').update(patch).eq('id', classId).eq('teacher_id', s.uid).select('id'));
  }

  async function regenerate(classId, gen) {
    if (!classId) return { ok: false, message: '找不到這個班級，請重新整理再試。' };
    const s = await session();
    if (s.message) return { ok: false, message: s.message };
    for (let i = 0; i < CODE_TRIES; i++) {
      const code = gen ? String(gen()) : genCode();
      const r = await updateOne(s, classId, { code });
      if (r.error && isUnique(r.error)) continue;
      if (r.error) return { ok: false, message: messageOf(r.error) };
      if (!Array.isArray(r.data) || !r.data.length) return { ok: false, message: '找不到這個班級，請重新整理再試。' };
      return { ok: true, code };
    }
    return { ok: false, message: '新的邀請碼一直跟別班重複，請再試一次。' };
  }

  async function setActive(classId, active) {
    if (!classId) return { ok: false, message: '找不到這個班級，請重新整理再試。' };
    const s = await session();
    if (s.message) return { ok: false, message: s.message };
    const r = await updateOne(s, classId, { active: !!active });
    if (r.error) return { ok: false, message: messageOf(r.error) };
    if (!Array.isArray(r.data) || !r.data.length) return { ok: false, message: '找不到這個班級，請重新整理再試。' };
    return { ok: true };
  }

  /* 移除學生:只刪「這一班、這一位」的一列(memberships 的主鍵就是這兩欄),兩個條件少一個就不送 */
  async function remove(classId, studentId) {
    if (!classId || !studentId) return { ok: false, message: '找不到這位學生，請重新整理再試。' };
    const s = await session();
    if (s.message) return { ok: false, message: s.message };
    const r = await run(s.client.from('memberships').delete().eq('class_id', classId).eq('student_id', studentId).select('student_id,class_id'));
    if (r.error) return { ok: false, message: messageOf(r.error) };
    if (!Array.isArray(r.data) || !r.data.length) return { ok: false, message: '這位學生已經不在這個班，請重新整理。' };
    return { ok: true };
  }

  function joinLink(code, loc) {
    const l = loc || window.location;
    return l.origin + String(l.pathname || '/').replace(/[^/]*$/, '') + 'me.html?join=' + encodeURIComponent(code);
  }

  function ymd(iso) {
    const t = Date.parse(iso);
    if (typeof iso !== 'string' || !isFinite(t)) return null;
    const d = new Date(t + TZ_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  const two = n => (n < 10 ? '0' : '') + n;
  function fmtDate(iso) { const p = ymd(iso); return p ? p.y + '/' + two(p.m) + '/' + two(p.d) : ''; }
  function dayText(iso, nowIso) {
    const p = ymd(iso), n = ymd(nowIso) || ymd(new Date().toISOString());
    if (!p) return '';
    return n && n.y === p.y ? p.m + ' 月 ' + p.d + ' 日' : fmtDate(iso);
  }

  /* 方案與名額那一列(前端計畫八.1)。o = { paidUi, used:班級區算出來的已用人數(有就用它,移除後馬上更新) }
     回 null(不顯示)或 { kind, chips, lines, full, trial } */
  function planInfo(a, o) {
    if (!o || o.paidUi !== true || !isObj(a) || a.is_owner === true) return null;
    const trial = a.teacher_trial_available === true;
    if (a.is_teacher !== true) return trial ? { kind: 'trial_offer', chips: [], lines: [], full: false, trial } : null;
    if (!a.teacher_source) return { kind: 'no_plan', chips: [], lines: ['這個帳號還沒有開通老師方案'], full: false, trial };
    if (a.teacher_live === false) {
      return { kind: 'expired', chips: [], lines: ['方案已到期，續約後恢復查看學生進度。學生資料都還在。'], full: false, trial: false };
    }
    const used = typeof o.used === 'number' ? o.used : (typeof a.seats_used === 'number' ? a.seats_used : null);
    const seats = typeof a.seats === 'number' && a.seats > 0 ? a.seats : null;
    const chips = [seats ? (a.teacher_source === 'trial' ? '試用 ' : '方案 ') + seats + ' 人' : '名額不限'];
    if (used !== null) chips.push('已用 ' + used + ' 人');
    const until = fmtDate(a.teacher_until);
    if (until) chips.push('到期日 ' + until);
    const lines = [];
    if (a.teacher_in_grace === true) {
      const d = dayText(a.teacher_grace_until, a.server_now);
      /* 跨年時 d 是 2027/01/03 這種數字日期,後面跟中文要空一格(同一年是「10 月 14 日」,不用空) */
      lines.push('方案已到期，' + (d ? d + (d.indexOf('/') >= 0 ? ' ' : '') + '以前' : '') + '續約可以繼續查看學生進度');
    }
    const full = !!seats && used !== null && used >= seats;
    if (full) lines.push('名額已滿，新的學生會加入失敗');
    return { kind: a.teacher_in_grace === true ? 'grace' : 'plan', chips, lines, full, trial: false };
  }

  /* ---------- 畫面 ---------- */

  const X_ICON = '<svg viewBox="0 0 22 22" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">'
    + '<path d="M5 5 17 17M17 5 5 17"/></svg>';

  function trapTab(box, e) {
    if (e.key !== 'Tab') return;
    const f = Array.from(box.querySelectorAll('button,input,a[href]')).filter(x => !x.disabled);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!box.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* 共用的小視窗:標題、說明行、(要的話)一欄輸入、確定與取消。回 promise:確定 → true 或輸入的文字;取消 → false 或 null */
  function dialog(o, returnTo) {
    return new Promise(resolve => {
      if (document.querySelector('.modal-mask')) return resolve(o.input ? null : false);
      const mask = h('div', { class: 'modal-mask' });
      const id = 'ac-dlg-' + Math.random().toString(36).slice(2, 8);
      const box = h('div', { class: 'modal modal-auth ac-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id });
      const title = h('h2', { class: 'auth-h ac-dialog-h', id });
      title.textContent = o.title;
      const close = h('button', { class: 'modal-close', type: 'button', 'aria-label': '關閉', html: X_ICON });
      const lines = (o.lines || []).map((t, i) => { const p = h('p', { class: 'ac-dialog-line', id: id + '-l' + i }); p.textContent = t; return p; });
      /* 說明行要念得到:焦點落在按鈕上時,螢幕閱讀器只念標題和按鈕(跟 js/paywall.js 的視窗一樣接 aria-describedby) */
      if (lines.length) box.setAttribute('aria-describedby', lines.map(p => p.getAttribute('id')).join(' '));
      let input = null, field = null;
      const note = h('p', { class: 'auth-note', role: 'alert' });
      if (o.input) {
        input = h('input', { class: 'auth-input', id: id + '-in', type: 'text', maxlength: String(NAME_MAX), autocomplete: 'off', enterkeyhint: 'done' });
        field = h('div', { class: 'auth-field' }, h('label', { for: id + '-in' }, o.input), input, note);
      }
      const ok = h('button', { class: 'btn primary auth-submit' + (o.danger ? ' ac-danger' : ''), type: 'submit' }, o.ok);
      const cancel = h('button', { class: 'btn auth-full ac-cancel', type: 'button' }, '取消');
      const form = h('form', { class: 'auth-form', novalidate: 'novalidate' }, field, ok, cancel);
      box.append(close, title, ...lines, form);
      mask.append(box);
      document.body.append(mask);

      let done = false;
      const finish = v => {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        mask.remove();
        try { if (returnTo && returnTo.isConnected) returnTo.focus(); } catch (e) {}
        resolve(v);
      };
      const no = () => finish(o.input ? null : false);
      form.addEventListener('submit', e => {
        e.preventDefault();
        if (!input) return finish(true);
        const err = o.check ? o.check(input.value) : '';
        if (err) { note.textContent = err; note.className = 'auth-note bad'; field.classList.add('is-bad'); input.focus(); return; }
        finish(input.value);
      });
      if (input) input.addEventListener('input', () => { note.textContent = ''; note.className = 'auth-note'; field.classList.remove('is-bad'); });
      close.addEventListener('click', no);
      cancel.addEventListener('click', no);
      /* 按住 Enter 會連續送出按鍵:視窗開著時擋掉重複的那幾下,免得還沒看清楚就按下確定 */
      function onKey(e) {
        if (e.key === 'Enter' && e.repeat) { e.preventDefault(); return; }
        if (e.key === 'Escape') { no(); return; }
        trapTab(box, e);
      }
      document.addEventListener('keydown', onKey, true);
      mask.addEventListener('mousedown', e => { if (e.target === mask) no(); });
      /* 沒有輸入欄的確認(移除、換邀請碼)焦點先放在取消:按一下 Enter 不會直接做下去 */
      (input || cancel).focus();
    });
  }

  async function copyText(text) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
  }

  function text(tag, cls, t) { const el = h(tag, { class: cls }); el.textContent = t; return el; }

  /* 方案那一列(PAID_UI 打開才會有東西) */
  function planBox(info) {
    if (!info || !(info.chips.length || info.lines.length)) return null;
    const box = h('div', { class: 'ac-plan' + (info.kind === 'expired' || info.kind === 'grace' ? ' is-off' : '') });
    if (info.chips.length) box.append(h('div', { class: 'ac-chips' }, info.chips.map(c => text('span', 'ac-chip', c))));
    info.lines.forEach(l => box.append(text('p', 'ac-plan-line' + (info.full || info.kind !== 'plan' ? ' is-bad' : ''), l)));
    /* 有老師列、從沒有方案:可以自己開試用 */
    if (info.kind === 'no_plan' && info.trial) box.append(h('div', { class: 'ac-trial-row' }, trialButton(), h('a', { class: 'ac-trial-link', href: 'pricing.html' }, '方案說明')));
    return box;
  }

  function trialButton(onDone) {
    const btn = h('button', { class: 'btn primary ac-trial-btn', type: 'button' }, '開始老師試用');
    btn.addEventListener('click', () => {
      const P = window.PAYWALL;
      if (P && typeof P.trialDialog === 'function') P.trialDialog(btn, onDone || (() => location.reload()));
    });
    return btn;
  }

  /* opts = { nameOf(uid) → { name, email } | null, access, ask(q), askName(), copy(text) }(後三個給測試換掉) */
  function section(opts) {
    opts = opts || {};
    const ask = opts.ask || (q => dialog({ title: q.title, lines: q.lines, ok: q.ok, danger: q.danger }, q.from));
    const askName = opts.askName || (from => dialog({ title: '新增班級', input: '班級名稱', ok: '建立',
      check: v => (!cleanName(v) ? '請輸入班級名稱。' : '') }, from));
    const copy = opts.copy || copyText;
    const paidUi = window.PAID_UI === true;
    /* 收費畫面打開、卻讀不到使用權(my_access 失敗或超時):不知道這個帳號還是不是老師
       (被站長改成學生的人 teachers 列還在),班級只給看、給複製,不給新增、換碼、停用、移除 */
    const readOnly = paidUi && !isObj(opts.access);

    const msg = h('p', { class: 'ac-msg', role: 'status' });
    const say = (t, kind) => { msg.textContent = t || ''; msg.className = 'ac-msg' + (kind ? ' ' + kind : ''); };
    const addBtn = h('button', { class: 'btn ac-add', type: 'button' }, '新增班級');
    const head = h('div', { class: 'ac-head' }, h('h2', { class: 'ac-h', id: 'ac-h' }, '班級'), readOnly ? null : addBtn);
    const planSlot = h('div', { class: 'ac-plan-slot' });
    const ul = h('ul', { class: 'ac-list', 'aria-busy': 'true' }, h('li', { class: 'ac-empty' }, '讀取中'));
    const box = h('section', { class: 'q-block ac-box', 'aria-labelledby': 'ac-h' }, planSlot, head, msg, ul);

    let state = { classes: [], members: [], hasActive: false };
    const open = new Set();   // 展開著的班
    /* 每次 draw() 會重畫整個列表,原本有焦點的按鈕跟著消失:記下每顆按鈕,做完事把焦點放回新的那一顆 */
    let focusable = new Map();
    const mark = (key, el) => { focusable.set(key, el); return el; };
    const refocus = key => { const el = focusable.get(key); if (el && el.isConnected) el.focus(); };

    const plan = () => planInfo(opts.access || null, { paidUi, used: state.loaded ? seatsUsed(state.members) : undefined });

    function drawPlan() {
      planSlot.innerHTML = '';
      if (readOnly) { planSlot.append(h('div', { class: 'ac-plan is-off' }, text('p', 'ac-plan-line is-bad', '讀不到方案資料，重新整理以後才能新增班級、換邀請碼或移除學生。'))); return; }
      const p = planBox(plan());
      if (p) planSlot.append(p);
    }

    async function refresh() {
      const r = await list();
      ul.removeAttribute('aria-busy');
      if (!r.ok) { ul.innerHTML = ''; say(r.message, 'bad'); return; }
      state = { classes: r.classes, members: r.members, hasActive: r.hasActive, loaded: !r.membersMessage };
      if (r.membersMessage) say(r.membersMessage, 'bad');
      draw();
    }

    function draw() {
      ul.innerHTML = '';
      focusable = new Map();
      if (!state.classes.length) ul.append(h('li', { class: 'ac-empty' }, '還沒有班級'));
      state.classes.forEach(c => ul.append(classRow(c)));
      drawPlan();
    }

    function classRow(c) {
      const li = h('li', { class: 'ac-class' + (c.active === false ? ' is-off' : '') });
      const n = countOf(state.members, c.id);
      const top = h('div', { class: 'ac-top' }, text('span', 'ac-name', c.name || '（沒有班名）'), text('span', 'ac-count', n + ' 人'));
      if (c.active === false) top.append(text('span', 'ac-off', '已停用'));
      const codeEl = text('span', 'ac-code', c.code);
      const codeLine = h('div', { class: 'ac-code-line' }, text('span', 'ac-code-label', '邀請碼'), codeEl);
      const label = c.name || '這個班';
      if (c.active !== false) {
        const copyBtn = h('button', { class: 'ac-btn', type: 'button' }, '複製');
        copyBtn.setAttribute('aria-label', '複製' + label + '的邀請碼');
        copyBtn.addEventListener('click', () => doCopy(c.code, '已複製邀請碼 ' + c.code + '。'));
        codeLine.append(copyBtn);
      }
      /* 兩個班的按鈕字一樣:無障礙名稱加上班名(看得到的字照樣包含在裡面) */
      const actions = h('div', { class: 'ac-actions' });
      if (c.active !== false) {
        const link = h('button', { class: 'ac-btn', type: 'button', 'aria-label': '複製邀請連結（' + label + '）' }, '複製邀請連結');
        link.addEventListener('click', () => doCopy(joinLink(c.code), '已複製邀請連結。'));
        actions.append(link);
      }
      if (!readOnly) {
        const regen = mark('regen:' + c.id, h('button', { class: 'ac-btn', type: 'button', 'aria-label': '換一組邀請碼（' + label + '）' }, '換一組邀請碼'));
        regen.addEventListener('click', () => doRegen(c, regen));
        actions.append(regen);
      }
      if (state.hasActive && !readOnly) {
        const verb = c.active === false ? '啟用' : '停用';
        const tog = mark('tog:' + c.id, h('button', { class: 'ac-btn', type: 'button', 'aria-label': verb + label }, verb));
        tog.addEventListener('click', () => doToggle(c, tog));
        actions.append(tog);
      }
      const pid = 'ac-m-' + String(c.id).replace(/[^a-zA-Z0-9_-]/g, '');
      const exp = mark('exp:' + c.id, h('button', { class: 'ac-expand', type: 'button', 'aria-expanded': open.has(c.id) ? 'true' : 'false', 'aria-controls': pid, 'aria-label': label + '的成員' }, '成員'));
      const panel = h('ul', { class: 'ac-members', id: pid });
      panel.hidden = !open.has(c.id);
      if (open.has(c.id)) fillMembers(c, panel);
      exp.addEventListener('click', () => {
        const on = exp.getAttribute('aria-expanded') !== 'true';
        exp.setAttribute('aria-expanded', on ? 'true' : 'false');
        panel.hidden = !on;
        if (on) { open.add(c.id); fillMembers(c, panel); } else open.delete(c.id);
      });
      li.append(top, codeLine, actions, exp, panel);
      return li;
    }

    function who(uid) {
      let r = null;
      try { r = opts.nameOf ? opts.nameOf(uid) : null; } catch (e) { r = null; }
      const name = r && r.name ? String(r.name) : (r && r.email ? String(r.email) : String(uid).slice(0, 8));
      const email = r && r.email && String(r.email) !== name ? String(r.email) : '';
      return { name, email };
    }

    function fillMembers(c, panel) {
      panel.innerHTML = '';
      const rows = state.members.filter(m => m.classId === c.id);
      if (!rows.length) { panel.append(h('li', { class: 'ac-empty' }, state.loaded ? '還沒有學生加入' : '讀不到成員')); return; }
      /* 方案過了寬限(收費版):讀不到學生進度,多數人只剩帳號前 8 碼,移除了也加不回來,成員照列、不給移除 */
      const info0 = paidUi ? plan() : null;
      const canRemove = !readOnly && !(info0 && info0.kind === 'expired');
      rows.forEach(m => {
        const p = who(m.studentId);
        const info = h('div', { class: 'ac-m-info' }, text('span', 'ac-m-name', p.name));
        if (p.email) info.append(text('span', 'ac-m-mail', p.email));
        const d = fmtDate(m.joinedAt);
        if (d) info.append(text('span', 'ac-m-date', d + ' 加入'));
        const li = h('li', { class: 'ac-member' }, info);
        if (canRemove) {
          const rm = mark('rm:' + c.id + ':' + m.studentId, h('button', { class: 'ac-btn ac-remove', type: 'button' }, '移除'));
          rm.setAttribute('aria-label', '從' + (c.name || '這個班') + '移除' + p.name);
          rm.addEventListener('click', () => doRemove(c, m, p, rm));
          li.append(rm);
        }
        panel.append(li);
      });
    }

    async function doCopy(t, done) {
      try { await copy(t); say(done, 'ok'); }
      catch (e) { say('沒辦法自動複製，請手動抄下：' + t, 'bad'); }
    }

    async function doRegen(c, btn) {
      const yes = await ask({ title: '換一組邀請碼？', lines: ['舊的邀請碼 ' + c.code + ' 和邀請連結會失效，已經加入的學生不受影響。'], ok: '換一組', from: btn });
      if (!yes) return;
      btn.disabled = true;
      const r = await regenerate(c.id);
      btn.disabled = false;
      if (!r.ok) { say(r.message, 'bad'); return; }
      state.classes = state.classes.map(x => (x.id === c.id ? Object.assign({}, x, { code: r.code }) : x));
      draw();
      refocus('regen:' + c.id);
      /* 停用的班:新碼要等啟用才能用(join_class 只認 active 的班) */
      say('「' + (c.name || '這個班') + '」的新邀請碼是 ' + r.code + (c.active === false ? '，啟用以後才能用。' : '。'), 'ok');
    }

    async function doToggle(c, btn) {
      btn.disabled = true;
      const on = c.active === false;
      const r = await setActive(c.id, on);
      btn.disabled = false;
      if (!r.ok) { say(r.message, 'bad'); return; }
      state.classes = state.classes.map(x => (x.id === c.id ? Object.assign({}, x, { active: on }) : x));
      draw();
      refocus('tog:' + c.id);
      say(on ? '已啟用「' + (c.name || '這個班') + '」，邀請碼可以用來加入。' : '已停用「' + (c.name || '這個班') + '」，邀請碼不能再用來加入。', 'ok');
    }

    /* 移除前的說明,照現況選句子(都是後果,不重述 pricing.html 的規則):
       - 不在這位老師別的班:老師讀進度靠 memberships(teaches_student),移除後看不到他、下載全部備份也不再有他。
       - 能不能用邀請碼回來:停用的班不行(join_class 只認 active);收費版還要方案在期內、不超過名額,
         但他還在這位老師別的班時 join_class 不檢查方案與名額。剛好用滿時移除會空出一位,回得來。
       - 收費版還在別班、已經超過名額:名額順序照最早加入的時間排(_class_cover),移除最早那一班會讓他排到後面。 */
    function removeLines(c, m) {
      const inOther = state.members.some(x => x.studentId === m.studentId && x.classId !== c.id);
      const a = isObj(opts.access) ? opts.access : {};
      const seats = typeof a.seats === 'number' && a.seats > 0 ? a.seats : null;
      const over = paidUi && seats !== null && state.loaded && seatsUsed(state.members) > seats;
      const kind = paidUi ? ((plan() || {}).kind || '') : '';
      const lines = ['他的學習記錄不會刪除。'];
      if (!inOther) lines.push('移除後，你看不到他的進度，下載全部備份也不會再包含他的記錄。要留一份，先按下載全部備份。');
      if (paidUi && !inOther) lines.push('他會失去這個班提供的使用權。');
      if (c.active === false) lines.push('這個班停用中，重新啟用以前他不能用邀請碼加入。');
      else if (!inOther && (kind === 'grace' || kind === 'expired')) lines.push('你的方案到期了，續約以前他不能用邀請碼加入。');
      else if (!inOther && kind === 'no_plan') lines.push('你還沒有開通老師方案，開通以前他不能用邀請碼加入。');
      else if (!inOther && over) lines.push('現在超過名額，他不能再用邀請碼加入。');
      else lines.push('要回來得再輸入一次邀請碼。');
      if (inOther && over) lines.push('他還在你的其他班，名額順序會改照他加入其他班的時間算，可能因此排到名額外。');
      return { lines, inOther };
    }

    async function doRemove(c, m, p, btn) {
      const info = removeLines(c, m);
      const yes = await ask({ title: '把「' + p.name + '」移出「' + (c.name || '這個班') + '」？', lines: info.lines, ok: '移除', danger: true, from: btn });
      if (!yes) return;
      btn.disabled = true;
      const r = await remove(c.id, m.studentId);
      if (!r.ok) { btn.disabled = false; say(r.message, 'bad'); return; }
      /* 焦點移到同一班的下一位(沒有下一位就上一位,都沒有就回到成員) */
      const rows = state.members.filter(x => x.classId === c.id);
      const i = rows.findIndex(x => x.studentId === m.studentId);
      const next = rows[i + 1] || rows[i - 1] || null;
      state.members = state.members.filter(x => !(x.classId === c.id && x.studentId === m.studentId));
      draw();
      refocus(next ? 'rm:' + c.id + ':' + next.studentId : 'exp:' + c.id);
      /* 學生進度表是載入時讀的,重新整理以前還在(備份也還包含他) */
      say('已把「' + p.name + '」移出「' + (c.name || '這個班') + '」。' + (info.inOther ? '' : '重新整理以後，學生進度表裡就不會有他。'), 'ok');
    }

    addBtn.addEventListener('click', async () => {
      const name = await askName(addBtn);
      if (name === null || name === undefined || name === false) return;
      addBtn.disabled = true;
      const r = await create(name);
      addBtn.disabled = false;
      if (!r.ok) { say(r.message, 'bad'); return; }
      await refresh();
      say('已新增「' + r.class.name + '」，邀請碼 ' + r.class.code + '。', 'ok');
    });

    drawPlan();
    refresh();
    return box;
  }

  /* 不是老師、可以開老師試用(PAID_UI 打開才會用到):一個區塊加一顆按鈕,按下去用 js/paywall.js 的試用視窗 */
  function trialBlock(info, onDone) {
    const btn = trialButton(onDone);
    const box = h('section', { class: 'q-block ac-box ac-trial', 'aria-labelledby': 'ac-trial-h' },
      h('h2', { class: 'ac-h', id: 'ac-trial-h' }, '老師試用'));
    (info && info.lines || []).forEach(l => box.append(text('p', 'ac-plan-line', l)));
    box.append(h('div', { class: 'ac-trial-row' }, btn, h('a', { class: 'ac-trial-link', href: 'pricing.html' }, '方案說明')));
    return box;
  }

  window.ADMIN_CLASSES = {
    ALPHABET, genCode, joinLink, countOf, seatsUsed, planInfo, section, trialBlock,
    api: { list, create, regenerate, setActive, remove },
  };
})();
