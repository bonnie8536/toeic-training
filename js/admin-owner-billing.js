/* 站長後台「收費管理」的記帳:記一筆收款(前端計畫九.3)、贈送(九.4)、寫作批改扣篇數與更正(九.5)、下載全部備份 v2(九.6)。
   tools/test_owner_billing.js 用 fixture 測。
   - 只走 owner_record_payment、owner_grant_comp、owner_consume_credit、owner_adjust_credits、owner_export、owner_export_gateway(資料庫在裡面檢查站長、寫異動紀錄)。
   - 記一筆收款是手動收款(轉帳、LINE Pay、現金)的路;之後接上藍新,線上付款由金流的 Edge Function 記,不經過這裡。
   - 記一筆收款、贈送、更正都帶送出編號 p_request_key(贈送與更正是 2026-10-12 資料庫加的),做法一樣(sendKey):
     表單打開時用 crypto.randomUUID() 產生,只有資料庫回「記下了」或「已經記過」才換新的。
     連不上(可能送到了、只是回覆沒收到)時,這個帳號的編號留著,在同一個視窗再按、關掉表單再打開都沿用,資料庫只會記一筆。
     同一個編號拿去送別的帳號或別的內容,資料庫照樣回原本那一筆、duplicate = true,什麼都不做;
     所以編號一個帳號一個,送出成功後下一次打開一定是新的,不會拿到別的帳號的結果。
     被擋下來(或登入過期、閘道錯誤)時不換:那不能證明上一次沒送到,留著編號再送也只會記一筆。
     重新整理頁面以後編號就沒了,所以連不上又關掉表單時,先重讀這個帳號,看得到剛才那筆有沒有記下。
   - 表單一律從查帳號頁打開(帳號已經讀到,視窗才寫得出後果),第一行寫帳號。
   - 對外的字一律寫「寫作批改 N 篇」;資料庫的錯誤訊息裡講「點數」的幾句換成篇數的說法,其他原樣顯示。
   做法參考 Stripe 客戶頁的「建立付款」與「新增訂閱」:在單一客戶頁上開表單,送出後回到同一頁、新的一筆出現在清單最上面。 */
(function () {
  const O = window.ADMIN_OWNER;
  if (!O) return;
  const { text, dialog, arr, str, isObj } = O;
  const SEATS = [10, 30, 60];
  const METHODS = [{ value: 'bank', label: '轉帳' }, { value: 'linepay', label: 'LINE Pay' }, { value: 'cash', label: '現金' }, { value: 'other', label: '其他' }];
  const LEVEL = { b: '造句', e: 'Email 回信', y: '論述寫作' };
  const PREVIEW = 160;
  const trim = v => str(v).trim();
  const intIn = (v, lo, hi) => /^\d+$/.test(trim(v)) && +trim(v) >= lo && +trim(v) <= hi;
  const fullPunct = s => s.replace(/,/g, '，').replace(/\(/g, '（').replace(/\)/g, '）');

  /* ---------- 資料庫的錯誤訊息 ---------- */
  const CREDIT_MSG = [
    [/^這篇已經扣過點數了。?$/, () => '這篇作文的這個版本已經扣過 1 篇了。'],
    [/^批改點數不足\(目前 (-?\d+) 點\)。?$/, m => '寫作批改剩 ' + m[1] + ' 篇，不夠扣。'],
    [/^更正後點數會變成負的\(目前 (-?\d+) 點\)。?$/, m => '更正後篇數會變成負的（目前剩 ' + m[1] + ' 篇）。'],
    [/^點數要是 1 到 100。?$/, () => '寫作批改的篇數要是 1 到 100。'],
    [/^更正點數一定要寫原因。?$/, () => '更正一定要寫原因。'],
  ];
  function messageOf(m) {
    const s = str(m);
    for (const [re, fn] of CREDIT_MSG) { const x = re.exec(s); if (x) return fn(x); }
    return s;
  }
  async function call(fn, args) {
    const r = await O.rpc(fn, args);
    return r.ok ? r : { ok: false, message: messageOf(r.message), net: r.net === true };
  }
  const api = {
    async overview() {
      const r = await O.rpc('owner_overview', { p_days: 14 });
      if (r.ok && !isObj(r.data)) return { ok: false, message: '讀到的資料不完整，請重新整理再試。' };
      return r;
    },
    record: a => call('owner_record_payment', a),
    comp: a => call('owner_grant_comp', a),
    consume: a => call('owner_consume_credit', a),
    adjust: a => call('owner_adjust_credits', a),
    exportAll: () => O.rpc('owner_export', {}),
    /* 藍新的建單紀錄(同意的條款版本與時間、sku)與通知紀錄(newebpay/paid_gateway_additions.sql) */
    exportGateway: () => O.rpc('owner_export_gateway', {}),
  };

  /* ---------- 日期、金額 ---------- */
  const todayInput = () => O.dateInput(new Date().toISOString());
  /* 付款日:今天送 null(資料庫用現在),以前的日子送那天中午(台北時間) */
  function paidAtOf(v) { const d = trim(v); return d === todayInput() || !O.untilFromDate(d) ? null : d + 'T12:00:00+08:00'; }
  function checkPaidAt(v) {
    const d = trim(v);
    if (!O.untilFromDate(d)) return '請選付款日。';
    return d > todayInput() ? '付款日不能晚於今天。' : '';
  }
  /* 預填金額(js/plans-config.js);名額或篇數不是定價表上的就空著讓她填 */
  function priceOf(v) {
    const P = window.PLANS;
    if (!isObj(P)) return '';
    const year = v.months === '12';
    if (v.item === 'student') return isObj(P.student) ? str(year ? P.student.year : P.student.month) : '';
    if (v.item === 'teacher') {
      const m = isObj(P.teacher) ? P.teacher[trim(v.seats)] : null;
      return typeof m === 'number' ? str(m * (year ? (Number(P.teacherYearMonths) || 12) : 1)) : '';
    }
    if (v.item === 'credits') {
      const C = isObj(P.correction) ? P.correction : {};
      const n = trim(v.credits);
      return n === '1' && C.one != null ? str(C.one) : n === '5' && C.five != null ? str(C.five) : '';
    }
    return '';
  }
  function newKey() {
    const c = window.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    return Array.from(b, x => (x < 16 ? '0' : '') + x.toString(16)).join('');
  }

  /* ---------- 查帳號讀到的這個人 ---------- */
  function who(d, ownerId) {
    const a = isObj(d.access) ? d.access : {};
    const teacher = a.role === 'teacher' || a.is_owner === true;
    return {
      id: str(d.email) || str(d.user_id),
      uid: str(d.user_id) || str(d.email),
      teacher,
      /* 被站長改成學生的人:my_access 的 teacher_purchase_allowed 是 false(2026-10-06) */
      demoted: !teacher && a.teacher_purchase_allowed === false,
      inOwnerClass: arr(d.joined).some(c => c.teacher_id === ownerId),
      credits: Math.max(0, Number(a.credits) || 0),
      seats: typeof a.seats === 'number' && a.seats > 0 ? a.seats : null,
      /* 停用的班的人數加總(同一人在兩個班會算兩次,只是估計);成員名單還在,變回老師就又讀得到、也算名額(需要她決定的事 20) */
      oldMembers: arr(d.classes).filter(c => c.active === false).reduce((s, c) => s + (Number(c.members) || 0), 0),
      /* 他加入的別位老師的班:他變成老師以後寫給自己學生的備註,那位老師讀得到(需要她決定的事 21) */
      others: arr(d.joined).filter(c => c.teacher_id !== ownerId).map(c => str(c.name) || '沒有班名的班'),
    };
  }
  function classLines(cls, lines, warns) {
    if (!isObj(cls)) return;
    lines.push('他的班「' + str(cls.name) + '」，邀請碼 ' + str(cls.code) + '。');
    if (cls.active === false) warns.push('他的班「' + str(cls.name) + '」仍是停用的，邀請碼不能用；要連班一起恢復，請在帳號清單用改角色。');
  }
  const seatsQuick = () => SEATS.map(s => ({ label: String(s), value: String(s), aria: s + ' 人' }));

  /* ---------- 送出編號(記一筆收款、贈送、更正共用) ---------- */
  /* 還沒收到回覆的送出編號:表單種類 → (帳號 id → 編號),收到資料庫的回覆才拿掉 */
  const pending = { record: new Map(), comp: new Map(), adjust: new Map() };
  /* kind 是表單種類,netMsg 是連不上時寫在視窗裡的字。回傳 { key, left(沿用上一次沒收到回覆的編號), unsure(), send(fn) },
     send(fn) 用這個編號呼叫 fn(key) */
  function sendKey(kind, uid, netMsg) {
    const m = pending[kind];
    const left = m.has(uid);
    const key = left ? m.get(uid) : newKey();
    let unsure = false;
    async function send(fn) {
      const r = await fn(key);
      if (r.ok) { m.delete(uid); unsure = false; return r; }
      if (!r.net) return r;            // 擋下來不代表上一次沒送到(登入過期、閘道錯誤也長這樣),等著的編號與「不確定」都留著
      m.set(uid, key); unsure = true;
      return { ok: false, message: netMsg };
    }
    return { key, left, unsure: () => unsure, send };
  }

  /* ---------- 記一筆收款 ---------- */
  const NET_RECORD = '連不上雲端伺服器，不確定這筆有沒有記下。網路恢復後在這個視窗再按一次，不會記兩筆。';
  const NET_COMP = '連不上雲端伺服器，不確定這次贈送有沒有送出。網路恢復後在這個視窗再按一次，不會送兩次。';
  const NET_ADJUST = '連不上雲端伺服器，不確定這次更正有沒有記下。網路恢復後在這個視窗再送一次，不會記兩次。';

  function teacherNote(p) {
    if (p.teacher) return '';
    if (p.demoted) return '他被改成學生過。記了老師方案他會變回老師，但停用的班不會恢復，邀請碼不能用；要連班一起恢復，請改用帳號清單的改角色。';
    return '他現在是學生，記了老師方案以後他會變成老師，並開一個新班「我的班級」。';
  }
  function oldMembersNote(p, seats) {
    if (p.teacher || !p.oldMembers) return '';
    const n = p.oldMembers;
    let t = '他停用的班還有 ' + n + ' 位學生，他變回老師以後又讀得到他們的進度，這些人也算在名額裡。';
    if (intIn(seats, 1, 1000) && n >= +trim(seats)) {
      t += '妳填的名額 ' + trim(seats) + ' 人已經被這些學生佔滿' + (n > +trim(seats) ? '，超過的人依加入先後沒有班級使用權' : '') + '，新的學生加不進來。';
    }
    return t;
  }
  function othersNote(p) {
    if (p.teacher) return '';
    return p.others.map(n => '他是「' + n + '」的成員，那個班的老師之後看得到他寫給自己學生的備註，建議先在帳號清單把他移出。').join('');
  }
  async function record(d, from, ownerId) {
    const p = who(d, ownerId);
    const k = sendKey('record', p.uid, NET_RECORD);
    let sent = null;
    const isTeacher = v => v.item === 'teacher';
    const fields = [
      { name: 'item', type: 'radio', inline: true, label: '項目', value: p.teacher ? 'teacher' : 'student',
        options: [{ value: 'student', label: '學生方案' }, { value: 'teacher', label: '老師方案' }, { value: 'credits', label: '寫作批改' }] },
      { name: 'months', type: 'radio', inline: true, label: '月數', value: '1', options: [{ value: '1', label: '1 個月' }, { value: '12', label: '12 個月' }],
        show: v => v.item !== 'credits' },
      { name: 'seats', label: '名額', type: 'number', maxlength: 4, value: p.seats ? String(p.seats) : '', quick: seatsQuick(), show: isTeacher,
        check: v => (intIn(v, 1, 1000) ? '' : '名額要是 1 到 1000 的整數。') },
      { name: 'credits', label: '篇數', type: 'number', maxlength: 3, value: '5', quick: [{ label: '1 篇', value: '1' }, { label: '5 篇', value: '5' }],
        show: v => v.item === 'credits', check: v => (intIn(v, 1, 100) ? '' : '篇數要是 1 到 100 的整數。') },
      { name: 'teacherNote', type: 'info', show: isTeacher, text: () => teacherNote(p) },
      { name: 'oldMembers', type: 'info', show: isTeacher, text: v => oldMembersNote(p, v.seats) },
      { name: 'otherTeachers', type: 'info', show: isTeacher, text: () => othersNote(p) },
      { name: 'amount', label: '實收金額（元）', type: 'number', maxlength: 7, derive: priceOf,
        check: v => (intIn(v, 0, 9999999) ? '' : '金額要是 0 以上的整數。') },
      { name: 'method', type: 'radio', inline: true, label: '付款方式', value: 'bank', options: METHODS },
      { name: 'paidAt', label: '付款日', type: 'date', value: todayInput(), check: checkPaidAt },
      O.noteField(),
    ];
    const lines = k.left ? ['上一次送出沒有收到結果，這次送出如果已經記過，不會再記一筆。'] : [];
    const res = await dialog({ title: '記一筆收款', who: p.id, lines, fields, ok: '記下這筆收款', from,
      submit: v => {
        const item = v.item;
        sent = { item, months: item === 'credits' ? null : Number(v.months), seats: item === 'teacher' ? Number(trim(v.seats)) : null,
          credits: item === 'credits' ? Number(trim(v.credits)) : null, amount: Number(trim(v.amount)), method: v.method };
        return k.send(key => api.record({ p_request_key: key, p_who: p.id, p_item: item, p_months: sent.months, p_seats: sent.seats, p_credits: sent.credits,
          p_amount: sent.amount, p_method: v.method, p_paid_at: paidAtOf(v.paidAt), p_starts_at: null, p_note: O.noteOf(v) }));
      } });
    if (res === null) return k.unsure() ? { text: '剛才那筆不確定有沒有記下，已重新讀取，請看付款裡有沒有這一筆再決定要不要重記。', bad: true } : null;
    const r = recordResult(isObj(res) ? res : {}, sent, p);
    await dialog({ title: r.title, who: p.id, lines: r.lines, warns: r.warns, ok: '完成', cancel: false, from });
    return r.done;
  }
  function recordResult(res, s, p) {
    if (res.duplicate === true) {
      return { title: '這筆已經記過了', lines: ['這張表單剛才已經送出過，這次沒有再記一筆。請在付款紀錄核對。'], warns: [], done: '這筆收款之前已經記過了。' };
    }
    const x = O.paymentText({ item: s.item, months: s.months, seats: s.seats, credits: s.credits, amount: s.amount, method: s.method, status: 'paid' });
    const lines = [x.item + '，' + x.amount + '，' + x.method + '。'], warns = [];
    const ap = res.applied;
    if (isObj(ap) && ap.applied === false) warns.push('付款已記下，但沒有開通：' + fullPunct(str(ap.reason)) + '。');
    else if (s.item === 'credits') lines.push('加了 ' + s.credits + ' 篇寫作批改。');
    else if (isObj(ap)) {
      const later = Date.parse(ap.starts_at) > Date.now() + 60e3;
      lines.push('使用期間 ' + O.fmtDate(ap.starts_at) + ' 到 ' + O.fmtDate(ap.ends_at) + (later ? '，排在他現在的使用權後面。' : '。'));
      classLines(ap.class, lines, warns);
      if (s.item === 'teacher') [oldMembersNote(p, String(s.seats)), othersNote(p)].forEach(t => { if (t) warns.push(t); });
    }
    return { title: '已記下這筆收款', lines, warns, done: '已記下收款。' };
  }

  /* ---------- 贈送 ---------- */
  async function comp(d, from, ownerId) {
    const p = who(d, ownerId);
    const fields = [
      { name: 'kind', type: 'radio', inline: true, label: '種類', value: p.teacher ? 'teacher' : 'student',
        options: [{ value: 'student', label: '學生方案' }, { value: 'teacher', label: '老師方案' }],
        check: v => (v === 'teacher' && !p.teacher ? '他現在是學生；要把學生改成老師，請在帳號清單用改角色。' : '') },
      { name: 'ownerClass', type: 'info', show: v => v.kind === 'student', text: () => (p.inOwnerClass ? '他在妳的班上，已經由妳的班免費使用。' : '') },
      { name: 'seats', label: '名額（空白代表不限）', type: 'number', maxlength: 4, quick: seatsQuick(), show: v => v.kind === 'teacher',
        check: v => (!trim(v) || intIn(v, 1, 1000) ? '' : '名額要是 1 到 1000 的整數，或空白。') },
      { name: 'until', label: '到期日（空白代表沒有期限）', type: 'date', value: '',
        quick: [{ label: '一個月後', value: O.defaultUntilDate(Date.now()) }, { label: '不設到期日', value: '' }],
        check: v => { if (!trim(v)) return ''; const u = O.untilFromDate(v); if (!u) return '請選正確的日期。'; return Date.parse(u) > Date.now() ? '' : '到期日要晚於今天。'; } },
      { name: 'note', label: '原因（選填，寫進異動紀錄）', type: 'text', maxlength: 200 },
    ];
    const k = sendKey('comp', p.uid, NET_COMP);
    let sent = null;
    const notice = k.left ? ['上一次送出沒有收到結果，這次送出如果已經贈送過，不會再送一次。'] : [];
    const res = await dialog({ title: '贈送', who: p.id, lines: notice, fields, ok: '贈送', from,
      submit: v => {
        sent = { kind: v.kind, seats: v.kind === 'teacher' && trim(v.seats) ? Number(trim(v.seats)) : null, ends: trim(v.until) ? O.untilFromDate(v.until) : null };
        return k.send(key => api.comp({ p_request_key: key, p_who: p.id, p_kind: sent.kind, p_seats: sent.seats, p_ends_at: sent.ends, p_starts_at: null, p_note: O.noteOf(v) }));
      } });
    if (res === null) return k.unsure() ? { text: '剛才的贈送不確定有沒有送出，已重新讀取，請先看使用權裡有沒有這一段，再決定要不要重做。', bad: true } : null;
    if (isObj(res) && res.duplicate === true) {
      await dialog({ title: '已經贈送過了', who: p.id, lines: ['這張表單剛才已經送出過，這次沒有再贈送。請在使用權核對。'], ok: '完成', cancel: false, from });
      return '這次贈送之前已經送出過了。';
    }
    const what = sent.kind === 'teacher' ? '老師方案 ' + (sent.seats ? sent.seats + ' 人' : '名額不限') : '學生方案';
    const lines = ['贈送' + what + '，' + (sent.ends ? '到 ' + O.fmtDate(sent.ends) : '沒有期限') + '。'], warns = [];
    if (isObj(res)) classLines(res.class, lines, warns);
    await dialog({ title: '已贈送', who: p.id, lines, warns, ok: '完成', cancel: false, from });
    return '已贈送。';
  }

  /* ---------- 更正寫作批改篇數(一定要寫原因;第一次按寫出更正後剩幾篇,第二次才送) ---------- */
  async function adjust(d, from, ownerId) {
    const p = who(d, ownerId);
    const delta = v => (v.dir === 'minus' ? -1 : 1) * Number(trim(v.count));
    const fields = [
      { name: 'dir', type: 'radio', inline: true, label: '加或減', value: 'plus', options: [{ value: 'plus', label: '加' }, { value: 'minus', label: '減' }] },
      { name: 'count', label: '篇數', type: 'number', maxlength: 4, value: '1',
        check: (v, all) => {
          if (!intIn(v, 1, 1000)) return '篇數要是 1 到 1000 的整數。';
          return all.dir === 'minus' && +trim(v) > p.credits ? '目前剩 ' + p.credits + ' 篇，不能減 ' + trim(v) + ' 篇。' : '';
        } },
      { name: 'note', label: '原因（必填，寫進異動紀錄）', type: 'text', maxlength: 200, check: v => (trim(v) ? '' : '請寫更正的原因。') },
    ];
    const k = sendKey('adjust', p.uid, NET_ADJUST);
    const lines = ['寫作批改現在剩 ' + p.credits + ' 篇。'].concat(k.left ? ['上一次送出沒有收到結果，這次送出如果已經記過，不會再記一次。'] : []);
    const res = await dialog({ title: '更正寫作批改篇數', who: p.id, lines, fields, ok: '更正', from,
      confirmTwice: v => '更正後剩 ' + (p.credits + delta(v)) + ' 篇，再按一次確定',
      submit: v => k.send(key => api.adjust({ p_request_key: key, p_who: p.id, p_delta: delta(v), p_note: trim(v.note) })) });
    if (res === null) return k.unsure() ? { text: '剛才的更正不確定有沒有記下，已重新讀取，請先看寫作批改紀錄，再決定要不要重做。', bad: true } : null;
    if (isObj(res) && res.duplicate === true) return '這次更正之前已經記過了，沒有再記一次。請在寫作批改紀錄核對。';
    /* 資料庫回 { balance, ledger_id, duplicate };2026-10-12 以前只回餘額這個數字,兩種都讀 */
    const bal = isObj(res) ? res.balance : res;
    return typeof bal === 'number' ? '已更正，剩 ' + bal + ' 篇。' : '已更正。';
  }

  /* ---------- 學生詳情的寫作批改(教師後台學生進度,只有站長模式) ----------
     ref = writing_<b|e|y>:<題目 id>:<作文內容 SHA-256 前 12 碼>(前端計畫九.5);內容先去掉頭尾空白再算,
     只多一個空白不算新的版本。學生改寫以後內容不同就是新的 ref,可以再扣一次。 */
  async function sha12(t) {
    const c = window.crypto;
    if (!c || !c.subtle || typeof TextEncoder === 'undefined') throw new Error('no subtle');
    const buf = await c.subtle.digest('SHA-256', new TextEncoder().encode(t));
    return Array.from(new Uint8Array(buf), x => (x < 16 ? '0' : '') + x.toString(16)).join('').slice(0, 12);
  }
  async function writingRef(e) { return 'writing_' + e.lv + ':' + e.id + ':' + await sha12(e.text); }
  function essaysOf(keys) {
    const out = [];
    ['b', 'e', 'y'].forEach(lv => {
      const m = isObj(keys) ? keys['writing_' + lv] : null;
      if (!isObj(m)) return;
      Object.keys(m).sort().forEach(id => {
        const t = isObj(m[id]) ? trim(m[id].text) : '';
        if (t) out.push({ lv, id, text: t, words: (t.match(/[A-Za-z''-]+/g) || []).length });
      });
    });
    return out;
  }
  /* 題目名稱跟寫作頁(js/writing.js)一樣:data/writing.js 照順序是 w1-b-NN、w2-e-NN、w3-e-NN */
  const TITLE = { b: ['1b', '造句挑戰 '], e: ['2e', '回信任務 '], y: ['3e', '論述寫作 '] };
  function essayTitle(lv, id) {
    const m = /^w([123])-([be])-(\d{1,3})$/.exec(str(id));
    const t = TITLE[lv];
    return m && t && m[1] + m[2] === t[0] ? t[1] + Number(m[3]) : (LEVEL[lv] || '') + ' ' + str(id);
  }
  /* 作文內容:長的先顯示開頭,「看全文」展開整篇(要扣的是整篇的版本) */
  function essayText(t) {
    if (t.length <= PREVIEW) return [text('p', 'ow-wr-text', t)];
    const pre = text('p', 'ow-wr-text', t.slice(0, PREVIEW) + '…');
    const det = h('details', { class: 'ow-wr-full' }, text('summary', 'ow-wr-sum', '看全文'), text('p', 'ow-wr-text', t));
    det.addEventListener('toggle', () => { pre.hidden = !!det.open; });
    return [pre, det];
  }

  /* o = { uid, keys }。帳號的 Email 用查帳號讀到的(進度裡的 _meta 是學生自己寫的,可以亂填)。
     讀到剩幾篇以前、讀不到、剩 0 篇、這個版本扣過,按鈕都不能按;資料庫照樣會擋,那是最後一道。 */
  function writingBlock(o) {
    const essays = essaysOf(o.keys);
    if (!essays.length) return null;
    let credits = 0, email = str(o.uid), state = 'idle';
    const bal = h('p', { class: 'ow-wr-bal', role: 'status' });
    const retry = h('button', { class: 'ac-btn ow-wr-retry', type: 'button', hidden: 'hidden' }, '重新讀取');
    retry.addEventListener('click', () => { load(); });
    const list = h('ul', { class: 'ow-wr-list' });
    const box = h('div', { class: 'ow-writing' }, text('h3', 'ow-wr-h', '寫作批改'), h('div', { class: 'ow-wr-top' }, bal, retry), list);
    const rows = essays.map(e => {
      const label = essayTitle(e.lv, e.id);
      const mark = h('span', { class: 'ow-wr-done' });
      const say = h('p', { class: 'ow-wr-msg', role: 'status' });
      const b = h('button', { class: 'ac-btn', type: 'button', 'aria-label': '批改完成，扣 1 篇（' + label + '）' });
      b.textContent = '批改完成，扣 1 篇';
      b.disabled = true;
      const li = h('li', { class: 'ow-wr-item' },
        h('div', { class: 'ow-item-top' }, text('span', 'ow-item-text', label), text('span', 'ow-when', e.words + ' 字'), mark),
        ...essayText(e.text), h('div', { class: 'ow-item-acts' }, b), say);
      const row = { e, label, mark, say, li, b, done: false };
      b.addEventListener('click', () => { consume(row); });
      list.append(li);
      return row;
    });
    function paint() {
      rows.forEach(r => { r.b.disabled = state !== 'ready' || r.done || credits <= 0; r.mark.textContent = r.done ? '這個版本已經扣過' : ''; });
      if (state === 'loading') bal.textContent = '讀取中';
      if (state === 'ready') bal.textContent = O.creditsLeft(credits) + (credits <= 0 ? '，不能扣。' : '');
      retry.hidden = state !== 'failed';
    }

    async function consume(row) {
      if (state !== 'ready' || row.done || credits <= 0) return;
      row.say.textContent = '';
      let ref;
      try { ref = await writingRef(row.e); } catch (e) { row.say.textContent = '這個瀏覽器算不出作文的版本，請換一個瀏覽器再試。'; return; }
      const lines = [row.label + ' 這個版本（' + row.e.words + ' 字）', '會從他的寫作批改扣 1 篇。同一個版本只能扣一次，他改寫以後算新的版本。', '扣完剩 ' + (credits - 1) + ' 篇。'];
      let dup = false;
      const res = await dialog({ title: '批改完成，扣 1 篇？', who: email, lines, ok: '扣 1 篇', from: row.b,
        submit: async () => {
          const r = await api.consume({ p_who: o.uid, p_ref: ref, p_note: null });
          if (!r.ok && /已經扣過/.test(r.message)) dup = true;
          return r;
        } });
      if (res === null) { if (dup) { row.done = true; paint(); } return; }
      credits = typeof res === 'number' ? Math.max(0, res) : Math.max(0, credits - 1);
      row.done = true;
      paint();
      row.say.textContent = '已扣 1 篇，剩 ' + credits + ' 篇。';
      if (O.notifyChanged) O.notifyChanged();
    }

    /* 第一次展開才讀他剩幾篇、哪些版本扣過(owner_lookup 的批改紀錄);讀不到時可以按重新讀取 */
    async function load() {
      state = 'loading'; paint();
      const r = await O.api.lookup(o.uid);
      if (!r.ok) { state = 'failed'; bal.textContent = '讀不到他剩幾篇。' + r.message; paint(); return; }
      const a = isObj(r.data.access) ? r.data.access : {};
      credits = Math.max(0, Number(a.credits) || 0);
      email = str(r.data.email) || str(o.uid);
      const done = new Set(arr(r.data.credit_log).filter(l => l.reason === 'correction').map(l => str(l.ref)));
      for (const row of rows) {
        try { row.done = done.has(await writingRef(row.e)); } catch (e) { row.done = false; }
      }
      state = 'ready'; paint();
    }
    return { el: box, open: () => { if (state === 'idle') load(); } };
  }

  /* ---------- 下載全部備份(站長模式):同一個 JSON 加上 owner_export(paid)與 owner_export_gateway(gateway),version 2 ----------
     讀不到收費資料(或等太久)時照樣存學生進度(跟以前一樣的 version 1),並在按鈕旁寫出沒有存到的原因。
     收費資料有讀到、金流紀錄沒讀到(還沒裝 paid_gateway_additions.sql、出錯或等太久)時存 version 2 但沒有 gateway,一樣寫出原因。
     supabase-js 沒有逾時,所以自己等 waitMs;時間到以後才回來的收費資料不再存。 */
  function saveJson(payload) {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '衝衝英文備份_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function within(p, ms, what) {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve({ ok: false, message: (what || '收費資料') + '讀太久沒有回應，請稍後再按一次。' }), ms);
      p.then(r => { clearTimeout(t); resolve(r); }, () => { clearTimeout(t); resolve({ ok: false, message: '發生錯誤，請稍後再試。' }); });
    });
  }
  async function backup(o) {
    const b = o.from || null;
    const note = o.msg || null;
    const show = (t, kind) => { if (note) { note.className = 'ow-msg' + (kind ? ' ' + kind : ''); note.textContent = t; } };
    if (b) { if (b.disabled || b.getAttribute('aria-busy') === 'true') return; b.disabled = true; b.setAttribute('aria-busy', 'true'); }
    show('正在準備備份，讀到收費資料就會存檔。', '');
    const [r, g] = await Promise.all([within(api.exportAll(), O.billing.waitMs), within(api.exportGateway(), O.billing.waitMs, '金流紀錄')]);
    if (b) { b.disabled = false; b.removeAttribute('aria-busy'); }
    const base = { app: 'shuashua-progress-backup', version: 1, exported: new Date().toISOString(), by: o.by, rows: o.rows };
    const good = r.ok && isObj(r.data);
    const gwGood = g.ok && isObj(g.data);
    const full = Object.assign({ app: base.app, version: 2, exported: base.exported, by: base.by, rows: base.rows, paid: r.data }, gwGood ? { gateway: g.data } : {});
    saveJson(good ? full : base);
    if (!good) show('這次只存了學生進度，收費資料沒有存到。' + (r.ok ? '讀到的收費資料不完整。' : r.message), 'bad');
    else if (gwGood) show('已存檔，學生進度、收費資料與金流紀錄都在裡面。', 'ok');
    else show('已存檔，學生進度與收費資料在裡面，金流紀錄沒有存到。' + (g.ok ? '讀到的金流紀錄不完整。' : g.message), 'bad');
  }

  O.billing = { api, messageOf, priceOf, record, comp, adjust, writingBlock, writingRef, essaysOf, essayTitle, backup, waitMs: 20000 };
})();
