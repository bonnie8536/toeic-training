/* 站長後台「收費管理」的帳號清單(前端計畫九.8)、改角色(九.9)、搬班級(九.10)。
   共用的文字、對話框、資料庫呼叫在 js/admin-owner-core.js;這裡只組畫面與流程。
   - 讀:owner_accounts(清單)、owner_lookup(改成學生前讀他的每一段使用權、她自己的班、寬限中老師的寬限日)。
   - 寫:owner_set_role、owner_move_member,都要先在確認框看到後果才送;資料庫擋下的訊息原樣顯示在視窗裡。
   - 名字、班名、Email 一律用 textContent;視窗裡一定寫完整 Email(名字是本人自己填的,可能撞名)。
   - 清單照 Stripe、Supabase 使用者清單的做法:寬螢幕一個帳號一列,有欄位標題,點名字進查帳號;手機改成一個帳號一塊。 */
(function () {
  const O = window.ADMIN_OWNER;
  if (!O) return;
  const { text, api, dialog, arr, str, isObj } = O;
  const SEATS = [10, 30, 60];
  const COLS = ['帳號', '身分', '使用狀態', '註冊', '最近登入', ''];

  function accounts(opts) {
    opts = opts || {};
    const ownerId = opts.ownerId;
    const st = { filter: 'all', search: '', offset: 0, total: 0, limit: O.PAGE, rows: [], now: null, seq: 0, error: false };
    let timer = null, mine = null, focusKey = '';
    let focusable = new Map(), rowMsgs = new Map();

    const msg = h('p', { class: 'ow-msg', role: 'status' });
    const say = (t, kind) => { msg.textContent = t || ''; msg.className = 'ow-msg' + (kind ? ' ' + kind : ''); };
    /* 列上的動作出錯:寫在那一列裡(清單很長時,上面的訊息看不到) */
    const rowSay = (r, t) => { const p = rowMsgs.get(r.user_id); if (p) p.textContent = t || ''; else say(t, 'bad'); };

    /* 分類:老師後面接四個小按鈕(同一組) */
    const filters = h('div', { class: 'ow-filters', role: 'group', 'aria-label': '分類' });
    const fbtns = new Map();
    let group = null;
    O.FILTERS.forEach(f => {
      const b = h('button', { class: 'ow-chip' + (f.sub ? ' ow-chip-sub' : ''), type: 'button', 'aria-pressed': f.key === st.filter ? 'true' : 'false' });
      b.textContent = f.label;
      if (f.sub) b.setAttribute('aria-label', '老師 ' + f.label);
      b.addEventListener('click', () => setFilter(f.key));
      fbtns.set(f.key, b);
      if (f.key === 'teacher') { group = h('span', { class: 'ow-chip-group' }, b); filters.append(group); }
      else if (f.sub && group) group.append(b);
      else filters.append(b);
    });
    function setFilter(key) {
      st.filter = key;
      fbtns.forEach((b, k) => b.setAttribute('aria-pressed', k === key ? 'true' : 'false'));
      if (timer) { clearTimeout(timer); timer = null; st.search = str(search.value).trim(); }
      st.offset = 0;
      load();
    }

    /* 搜尋:打字停 300 毫秒再查 */
    const search = h('input', { class: 'auth-input ow-search-input', type: 'search', placeholder: 'Email 或名字', 'aria-label': '搜尋 Email 或名字', autocomplete: 'off', enterkeyhint: 'search' });
    search.addEventListener('input', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const q = str(search.value).trim();
        if (q === st.search) return;
        st.search = q; st.offset = 0;
        load();
      }, O.DEBOUNCE_MS);
    });

    const thead = h('div', { class: 'ow-thead', 'aria-hidden': 'true' }, ...COLS.map(c => text('span', null, c)));
    const ul = h('ul', { class: 'ow-list', 'aria-busy': 'true' }, h('li', { class: 'ow-empty' }, '讀取中'));
    const total = h('span', { class: 'ow-total' });
    const prev = h('button', { class: 'btn ow-page-btn', type: 'button' }, '上一頁');
    const next = h('button', { class: 'btn ow-page-btn', type: 'button' }, '下一頁');
    prev.addEventListener('click', () => { st.offset = Math.max(0, st.offset - st.limit); focusKey = 'prev'; load(); });
    next.addEventListener('click', () => { st.offset += st.limit; focusKey = 'next'; load(); });
    const pager = h('div', { class: 'ow-pager' }, total, h('span', { class: 'ow-pager-btns' }, prev, next));
    const el = h('div', { class: 'ow-accounts' }, filters, h('div', { class: 'ow-search' }, search), msg, h('div', { class: 'ow-table' }, thead, ul), pager);

    /* keep:做完一件事之後的重讀,留著結果訊息;換分類、搜尋、換頁都清掉 */
    async function load(keep) {
      const seq = ++st.seq;
      if (!keep) say('');
      ul.setAttribute('aria-busy', 'true');
      prev.disabled = true; next.disabled = true;
      const r = await api.accounts({ filter: st.filter, search: st.search, offset: st.offset });
      if (seq !== st.seq) return;
      ul.removeAttribute('aria-busy');
      if (!r.ok) { st.error = true; st.rows = []; say(r.message, 'bad'); draw(); return; }
      st.error = false;
      if (/\bbad\b/.test(msg.className)) say('');
      const d = r.data;
      st.rows = arr(d.rows); st.total = Number(d.total) || 0; st.limit = Number(d.limit) || O.PAGE;
      st.offset = Number(d.offset) || 0; st.now = d.server_now || null;
      /* 這一頁已經沒有人了(最後一頁唯一的一列改完就不在這個分類):回到最後一頁 */
      if (!st.rows.length && st.total > 0 && st.offset >= st.total) {
        st.offset = Math.max(0, st.total - 1 - (st.total - 1) % st.limit);
        return load(true);
      }
      draw();
    }

    function draw() {
      ul.innerHTML = '';
      focusable = new Map(); rowMsgs = new Map();
      if (!st.rows.length) ul.append(h('li', { class: 'ow-empty' }, st.error ? '讀不到帳號清單' : '沒有符合的帳號'));
      st.rows.forEach(r => ul.append(row(r)));
      total.textContent = st.error ? '' : '共 ' + st.total + ' 人';
      prev.disabled = st.error || st.offset <= 0;
      next.disabled = st.error || st.offset + st.limit >= st.total;
      const f = focusKey === 'prev' ? prev : focusKey === 'next' ? next : focusable.get(focusKey);
      focusKey = '';
      if (f && f.isConnected && !f.disabled) f.focus();
    }

    const who = r => str(r.email) || str(r.user_id);
    function button(r, label, key, fn, cls, ctx) {
      const b = h('button', { class: 'ac-btn' + (cls ? ' ' + cls : ''), type: 'button', 'aria-label': label + (ctx ? ' ' + ctx : '') + '（' + (who(r) || O.displayName(r)) + '）' });
      b.textContent = label;
      b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true') fn(b); });   // 不回傳 promise:流程跑完以前,按鈕事件就結束
      focusable.set(r.user_id + ':' + key, b);
      return b;
    }
    /* 讀資料的時候按鈕不停用(停用會讓焦點掉到頁面最上面),只標成忙碌、再按不理 */
    function busy(b, on) {
      if (on) { b.setAttribute('aria-disabled', 'true'); b.setAttribute('aria-busy', 'true'); }
      else { b.removeAttribute('aria-disabled'); b.removeAttribute('aria-busy'); }
    }
    const lookup = r => { if (opts.onLookup) opts.onLookup(who(r)); };

    function row(r) {
      const nameBtn = h('button', { class: 'ow-name', type: 'button' });
      nameBtn.textContent = O.displayName(r);
      nameBtn.addEventListener('click', () => lookup(r));
      const top = h('div', { class: 'ow-head' }, nameBtn);
      if (r.demoted === true) top.append(text('span', 'ow-tag', '站長改過'));
      const cWho = h('div', { class: 'ow-c-who' }, top, text('div', 'ow-mail', str(r.email)));
      const cRole = h('div', { class: 'ow-c-role' }, text('span', 'ow-role', O.roleText(r)));
      const cState = h('div', { class: 'ow-c-state' });
      const status = O.statusText(r.access, st.now);
      if (status) cState.append(text('div', 'ow-status' + (isObj(r.access) && r.access.active === false ? ' is-off' : ''), status));
      const t = O.teacherText(r.teacher, st.now);
      if (t) cState.append(text('div', 'ow-teacher' + (isObj(r.teacher) && /expired|none/.test(r.teacher.state) ? ' is-off' : ''), t));
      const date = (cls, k, v) => h('div', { class: 'ow-c-date ' + cls }, text('span', 'ow-k', k + ' '), text('span', null, v));
      const cells = [cWho, cRole, cState, date('ow-c-reg', '註冊', O.fmtDate(r.created_at) || '不明'), date('ow-c-login', '最近登入', O.fmtDate(r.last_sign_in_at) || '沒有紀錄')];
      const more = classesBlock(r);
      if (more) cells.push(more);
      const actions = h('div', { class: 'ow-actions' }, button(r, '查帳號', 'look', () => lookup(r)));
      if (r.role !== 'owner') actions.append(button(r, '改角色', 'role', b => (r.role === 'teacher' ? demote(r, b) : promote(r, b))));
      if (r.role === 'student') actions.append(button(r, '加入班級', 'join', b => join(r, b)));
      const note = h('p', { class: 'ow-row-msg', role: 'alert' });
      rowMsgs.set(r.user_id, note);
      return h('li', { class: 'ow-row' }, ...cells, actions, note);
    }

    /* 開的班、加入的班(寬螢幕是每列的第二行) */
    function classesBlock(r) {
      const own = arr(r.own_classes), cls = arr(r.classes);
      if (!own.length && !cls.length) return null;
      const box = h('div', { class: 'ow-c-more' });
      if (own.length) {
        const list = h('ul', { class: 'ow-own', 'aria-label': '開的班' });
        own.forEach(c => {
          const li = h('li', null, text('span', 'ow-c-name', str(c.name) || '（沒有班名）'), text('span', 'ow-code', str(c.code)), text('span', 'ow-c-n', (Number(c.members) || 0) + ' 人'));
          if (c.active === false) li.append(text('span', 'ow-off', '已停用'));
          list.append(li);
        });
        box.append(h('div', { class: 'ow-more-part' }, text('div', 'ow-sub-h', '開的班'), list));
      }
      if (cls.length) {
        const list = h('ul', { class: 'ow-joined', 'aria-label': '加入的班' });
        cls.forEach(c => {
          const cname = str(c.class_name) || '（沒有班名）';
          const info = h('span', { class: 'ow-jc-info' }, text('span', 'ow-c-name', cname), text('span', 'ow-c-mail', str(c.teacher_email)));
          const why = O.reasonText(c);
          if (why) info.append(text('span', 'ow-off', why));
          const acts = h('span', { class: 'ow-jc-acts' }, button(r, '移出', 'leave:' + c.class_id, b => leave(r, c, b), 'ac-remove', cname));
          if (r.role === 'student') acts.append(button(r, '搬到別班', 'move:' + c.class_id, b => move(r, c, b), null, cname));
          list.append(h('li', { class: 'ow-jc' }, info, acts));
        });
        box.append(h('div', { class: 'ow-more-part' }, text('div', 'ow-sub-h', '加入的班'), list));
      }
      return box;
    }

    /* 做完一件事:重讀這一頁(留著結果訊息),焦點回到同一列同一顆按鈕;查帳號與總覽下一次打開重讀(opts.onChanged) */
    async function reload(r, key) { if (opts.onChanged) opts.onChanged(); focusKey = r ? r.user_id + ':' + key : ''; await load(true); }

    /* ---------- 改角色 ---------- */
    async function demote(r, b) {
      busy(b, true); rowSay(r, '');
      const look = await api.lookup(str(r.user_id) || who(r));
      busy(b, false);
      if (!look.ok) { rowSay(r, look.message); b.focus(); return; }
      const res = await dialog({ title: '把' + O.fullWho(r) + '改成學生？', lines: O.demoteLines(r, look.data, ownerId, st.now), fields: [O.noteField()],
        ok: '確定改成學生', danger: true, from: b,
        submit: v => api.setRole({ p_who: who(r), p_role: 'student', p_note: O.noteOf(v) }) });
      if (!res) return;
      await dialog({ title: '已把' + O.fullWho(r) + '改成學生', lines: O.demoteResult(res, r, ownerId, look.data), ok: '完成', cancel: false, from: b });
      await reload(r, 'role');
    }

    async function promote(r, b) {
      const choice = O.promoteChoice(r);
      const n = choice ? choice.n : 0;
      const fields = [
        { name: 'seats', label: '名額', type: 'number', maxlength: 4, quick: SEATS.map(s => ({ label: String(s), value: String(s), aria: s + ' 人' })),
          check: v => (/^\d+$/.test(str(v).trim()) && +v >= 1 && +v <= 1000 ? '' : '名額要是 1 到 1000 的整數。') },
        { name: 'until', label: '到期日', type: 'date', value: O.defaultUntilDate(Date.now()),
          check: v => { const u = O.untilFromDate(v); if (!u) return '請選到期日。'; return Date.parse(u) > Date.now() ? '' : '到期日要晚於現在。'; } },
        choice ? { name: 'mode', type: 'radio', label: '他以前的班', value: 'reactivate', options: [
          { value: 'reactivate', label: '恢復原本的班', desc: '邀請碼不變，舊班的 ' + n + ' 位學生接著算名額，他又看得到他們的進度。' },
          { value: 'new', label: '開一個新班', desc: '舊班維持停用（不能再用邀請碼加入），但舊班的 ' + n + ' 位學生名單還在，仍算名額、仍由他的方案提供使用權，他也仍看得到他們的進度；要切斷請先在帳號清單把他們移出。' },
        ] } : null,
        { name: 'className', label: '新班的班名（選填）', type: 'text', maxlength: 30, placeholder: '我的班級', show: v => !choice || v.mode === 'new' },
        O.noteField(),
      ];
      const res = await dialog({ title: '把' + O.fullWho(r) + '改成老師', lines: ['他之後不能自己開老師試用。'], fields, ok: '改成老師', from: b,
        confirmTwice: v => (choice && v.mode === 'new' && n > 0 ? '舊班 ' + n + ' 位學生仍算名額，再按一次確定' : null),
        submit: v => {
          const fresh = !choice || v.mode === 'new';
          return api.setRole({ p_who: who(r), p_role: 'teacher', p_seats: Number(str(v.seats).trim()), p_until: O.untilFromDate(v.until),
            p_note: O.noteOf(v), p_reactivate: choice ? v.mode !== 'new' : true, p_class_name: (fresh && str(v.className).trim()) || null });
        } });
      if (!res) return;
      const pr = O.promoteResult(res);
      await dialog({ title: '已把' + O.fullWho(r) + '改成老師', lines: pr.lines, warns: pr.warns, body: promoteBody(r, pr), ok: '完成', cancel: false, from: b });
      await reload(r, 'role');
    }

    /* 改成老師的結果:每個在用的班一列邀請碼與複製;他在別位老師班上時,每個班一個移出(按兩次) */
    function promoteBody(r, pr) {
      const body = [];
      if (pr.codes.length) {
        const list = h('ul', { class: 'ow-codes' });
        const done = h('p', { class: 'ow-copied', role: 'status' });
        pr.codes.forEach(c => {
          const cp = h('button', { class: 'ac-btn', type: 'button', 'aria-label': '複製「' + c.name + '」的邀請碼' }, '複製');
          cp.addEventListener('click', async () => {
            try { await O.copyText(c.code); done.textContent = '已複製邀請碼 ' + c.code + '。'; }
            catch (e) { done.textContent = '沒辦法自動複製，請手動抄下：' + c.code; }
          });
          list.append(h('li', null, text('span', 'ow-c-name', c.name), text('span', 'ac-code ow-code', c.code), cp));
        });
        body.push(list, done);
      }
      pr.others.forEach(x => body.push(otherBlock(r, x)));
      return body;
    }
    /* 第一次按:寫出移出的後果(跟清單上的移出同一套)與備註欄;第二次按才送 */
    function otherBlock(r, x) {
      const box = h('div', { class: 'ow-other' }, text('p', 'ow-warn', x.text));
      const bt = h('button', { class: 'btn ow-other-btn', type: 'button' }, '移出');
      const err = h('p', { class: 'auth-note bad', role: 'alert' });
      const c = arr(r.classes).find(k => k.class_id === x.class_id) || { class_id: x.class_id, teacher_id: x.teacher_id, covered: false };
      let armed = false, note = null;
      bt.addEventListener('click', async () => {
        if (!armed) {
          armed = true;
          O.leaveLines(r, c, ownerId).forEach(t => box.insertBefore(text('p', 'ac-dialog-line ow-line', t), bt));
          const id = 'ow-other-note-' + str(x.class_id);
          note = h('input', { class: 'auth-input', id, name: 'note', type: 'text', maxlength: '200', autocomplete: 'off' });
          box.insertBefore(h('div', { class: 'auth-field ow-field' }, h('label', { for: id }, '備註（選填，寫進異動紀錄）'), note), bt);
          bt.textContent = '再按一次確定移出「' + x.class_name + '」';
          return;
        }
        bt.disabled = true;
        const res = await api.move({ p_student: who(r), p_from_class: x.class_id, p_note: O.noteOf({ note: note ? note.value : '' }) });
        if (!res.ok) { bt.disabled = false; err.textContent = res.message; return; }
        box.innerHTML = '';
        box.append(text('p', 'ow-line ow-done', O.moveResult(res.data, '').lines[0] || '已移出。'));
      });
      box.append(bt, err);
      return box;
    }

    /* ---------- 搬班級 ---------- */
    async function ownerClasses() {
      if (mine) return mine;
      const r = await api.lookup(ownerId);
      if (!r.ok) return { ok: false, message: r.message, list: [] };
      mine = { ok: true, list: arr(r.data.classes).filter(c => c.active !== false).map(c => ({ name: str(c.name), code: str(c.code) })) };
      return mine;
    }
    function codeFields(r, m) {
      if (O.isExTeacher(r)) {
        return [{ name: 'code', type: 'radio', label: '加入哪個班', options: m.list.map(c => ({ value: c.code, label: c.name + ' ' + c.code })) }, O.noteField()];
      }
      return [{ name: 'code', type: 'text', label: '邀請碼', maxlength: 20, placeholder: '例如 ABCD2345',
        quick: m.list.map(c => ({ label: '妳的班 ' + c.code, value: c.code, aria: '填入妳的班「' + c.name + '」的邀請碼' })),
        check: v => (str(v).trim() ? '' : '請輸入邀請碼。') }, O.noteField()];
    }
    /* 準備加入或搬班:當過老師的帳號只能選她的班(資料庫也會擋) */
    async function prepare(r, b) {
      busy(b, true); rowSay(r, '');
      const m = await ownerClasses();
      busy(b, false);
      const ex = O.isExTeacher(r);
      if (ex && !m.list.length) { rowSay(r, m.ok ? '他當過老師，只能加進妳的班，但妳現在沒有啟用中的班。' : m.message); b.focus(); return null; }
      return { ex, fields: codeFields(r, m) };
    }
    async function graceOf(teacherId) {
      const r = await api.lookup(teacherId);
      const a = r.ok && isObj(r.data) ? r.data.access : null;
      return isObj(a) ? O.dayText(a.teacher_grace_until, a.server_now) : '';
    }
    async function showMove(title, res, b) {
      let grace = '';
      if (isObj(res) && isObj(res.added) && res.teacher_live === true && res.teacher_active === false) grace = await graceOf(res.added.teacher_id);
      const m = O.moveResult(res, grace);
      await dialog({ title, lines: m.lines, warns: m.warns, ok: '完成', cancel: false, from: b });
    }
    const codeOf = v => str(v.code).trim().toUpperCase();

    async function join(r, b) {
      const p = await prepare(r, b);
      if (!p) return;
      const res = await dialog({ title: '把' + O.fullWho(r) + '加入班級', lines: p.ex ? ['他當過老師，只能加進妳的班。'] : [], fields: p.fields, ok: '加入', from: b,
        submit: v => api.move({ p_student: who(r), p_to_code: codeOf(v), p_note: O.noteOf(v) }) });
      if (!res) return;
      await showMove('加入班級：' + O.fullWho(r), res, b);
      await reload(r, 'join');
    }

    async function move(r, c, b) {
      const p = await prepare(r, b);
      if (!p) return;
      const res = await dialog({ title: '把' + O.fullWho(r) + '搬到別班', lines: O.moveLines(r, c, ownerId, p.ex), fields: p.fields, ok: '搬過去', from: b,
        submit: v => api.move({ p_student: who(r), p_to_code: codeOf(v), p_from_class: c.class_id, p_note: O.noteOf(v) }) });
      if (!res) return;
      await showMove('搬到別班：' + O.fullWho(r), res, b);
      await reload(r, 'look');
    }

    async function leave(r, c, b) {
      const cname = str(c.class_name) || '這個班';
      const res = await dialog({ title: '把' + O.fullWho(r) + '移出「' + cname + '」？', lines: O.leaveLines(r, c, ownerId), fields: [O.noteField()],
        ok: '移出', danger: true, from: b,
        submit: v => api.move({ p_student: who(r), p_from_class: c.class_id, p_note: O.noteOf(v) }) });
      if (!res) return;
      await reload(r, 'look');
      say('已把' + O.fullWho(r) + '移出「' + cname + '」。', 'ok');
    }

    return { el, load };
  }

  O.accounts = accounts;
})();
