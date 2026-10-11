/* 站長後台「收費管理」第一段(前端計畫九.8 帳號清單、九.2 查帳號、九.9 改角色、九.10 搬班級)的測試。
   假的 Supabase 回的是 tools/fixtures/owner_contract.json:本機 PGlite 跑真的 supabase_paid_access.sql 錄下來的回傳
   (參數、回傳形狀、錯誤訊息都是真的)。fixture 每次重錄 id 與時間都會變,所以這裡不寫死 id 與日期,一律從 fixture 讀。
   鐵律:
   - 只有 PAID_UI 打開而且 CLOUD.access.is_owner 為真才出現;沒開時 admin.js 跟以前一樣,一個 owner_* 都不呼叫。
   - 只透過 owner_* 函式寫(它們會記異動紀錄),不直接寫任何表。
   - 改角色、移出、搬班、撤銷、退款都要先確認,確認框寫出後果;退款要再按一次。
   - 使用者自己填的字(名字、班名、備註)一律用文字節點。
   用法:node tools/test_owner_accounts.js */
const K = require('./owner_test_kit');
const { FX, SRC, ACC, OWNER_ID, ALL, clone, rowBy, DATE, DAY, isoOf, world, settle, wait, context, area, loadAdmin,
  rowOf, btn, dlg, field, radio, setVal, pick, ok, cancel, lines, warns, onlyOwnerRpcs, run } = K;

const cases = {
  /* ---------- 純邏輯 ---------- */
  '分類按鈕:13 個 p_filter 跟資料庫的清單一樣(從 fixture 的錯誤訊息讀),文字照九.8,老師四個小按鈕標 sub': () => {
    const { O } = context(world(), { paid: true });
    const sql = FX['error.accounts_bad_filter'].error.message.replace(/^分類只能是 /, '').split(/、| 或 /);
    const keys = O.FILTERS.map(f => f.key);
    const labels = O.FILTERS.map(f => f.label).join(',');
    const ok = JSON.stringify(keys) === JSON.stringify(sql) && O.PAGE === 50 && O.DEBOUNCE_MS === 300
      && labels === '全部,站長,老師,期內,寬限中,已過期,還沒有方案,既有帳號,付費,贈送,班級涵蓋,試用中,沒有使用權'
      && O.FILTERS.filter(f => f.sub).map(f => f.key).join() === 'teacher_active,teacher_grace,teacher_expired,teacher_none';
    return { ok, detail: JSON.stringify({ keys, sql, labels }) };
  },
  '使用狀態照六.1:試用寫到幾號、班級寫由班級提供、已付費、贈送寫使用到、legacy 寫無、沒有使用權寫到期;站長與靠老師方案的列不寫': () => {
    const { O } = context(world(), { paid: true });
    const now = ALL.server_now;
    const a = k => rowBy(k).access;
    const exp = {
      tom: '試用到 ' + DAY(a('tom').until, now), nate: '試用到 ' + DAY(a('nate').until, now), fay: '由班級提供', ben: '由班級提供',
      otto: '使用期限已到', eve: '使用期限已到', ed: '使用期限已到', cole: '由班級提供，到 ' + DATE(a('cole').until), cleo: '由班級提供，到 ' + DATE(a('cleo').until),
      tina: '', gwen: '', owner: '', cody: '使用到 ' + DATE(a('cody').paid_through), pam: '已付費，到 ' + DATE(a('pam').paid_through), cara: '使用期限 無', amy: '使用期限 無',
    };
    const bad = Object.keys(exp).filter(k => O.statusText(a(k), now) !== exp[k]).map(k => k + '=' + O.statusText(a(k), now));
    return { ok: bad.length === 0, detail: bad.join(' | ') || 'all ok' };
  },
  '老師那一行:期內寫名額已用到期日、寬限中寫寬限到、過期、還沒有方案、站長名額不限': () => {
    const { O } = context(world(), { paid: true });
    const now = ALL.server_now, t = k => rowBy(k).teacher;
    const exp = {
      tina: '方案 2 人，已用 3 人，到 ' + DATE(t('tina').plan_until), gwen: '方案 10 人，已用 1 人，寬限到 ' + DAY(t('gwen').grace_until, now),
      ed: '方案已過期', nate: '還沒有方案', owner: '名額不限，已用 3 人',
    };
    const bad = Object.keys(exp).filter(k => O.teacherText(t(k), now) !== exp[k]).map(k => k + '=' + O.teacherText(t(k), now));
    return { ok: bad.length === 0 && O.teacherText(null, now) === '', detail: bad.join(' | ') || 'all ok' };
  },
  '身分與班級狀態:站長改過、超過老師的名額、老師方案已到期(用字照 10/11 的決定)': () => {
    const { O } = context(world(), { paid: true });
    const ben = rowBy('ben'), otto = rowBy('otto'), cara = rowBy('cara');
    const ok = O.roleText(ben) === '學生' && O.roleText(rowBy('tina')) === '老師' && O.roleText(rowBy('owner')) === '站長'
      && O.reasonText(otto.classes[0]) === '超過老師的名額' && O.reasonText(cara.classes[0]) === '老師方案已到期' && O.reasonText(rowBy('fay').classes[0]) === ''
      && O.displayName(rowBy('nate')) === 'teacher.nate' && O.displayName(rowBy('tina')) === 'Tina Teacher'
      && O.isExTeacher(ben) && O.isExTeacher(rowBy('tina')) && !O.isExTeacher(rowBy('tom'));
    return { ok, detail: JSON.stringify([O.roleText(ben), O.reasonText(otto.classes[0]), O.displayName(rowBy('nate'))]) };
  },
  '日期:到期日用台北時間當天 23:59:59;不存在的日期不送;預設一個月後(月底往前收)': () => {
    const { O } = context(world(), { paid: true });
    const r = [O.untilFromDate('2026-11-11'), O.untilFromDate('2026-02-30'), O.untilFromDate(''), O.untilFromDate('11/11'),
      O.defaultUntilDate(Date.parse('2026-01-31T20:00:00Z')), O.defaultUntilDate(Date.parse('2026-01-30T00:00:00Z')), O.defaultUntilDate(Date.parse('2026-12-15T00:00:00Z'))];
    const ok = r[0] === '2026-11-11T23:59:59+08:00' && r[1] === null && r[2] === null && r[3] === null && r[4] === '2026-03-01' && r[5] === '2026-02-28' && r[6] === '2027-01-15';
    return { ok, detail: JSON.stringify(r) };
  },
  '改成學生的確認(付費老師 Tina):方案立刻結束、2 個班停用、名單留著、沒有試用、改完要付費;不寫撤銷': () => {
    const { O } = context(world(), { paid: true });
    const l = O.demoteLines(rowBy('tina'), FX['owner_lookup.teacher_over_seats'].data, OWNER_ID, ALL.server_now);
    const exp = ['他的老師方案會立刻結束，沒有寬限（包括已經預付、還沒開始的）。', '他的 2 個班會停用，不能再加入。',
      '班上的學生名單會留著，但不再由他的方案提供使用權。', '他自己沒有試用。', '改完之後要付費才能使用。'];
    return { ok: JSON.stringify(l) === JSON.stringify(exp), detail: JSON.stringify(l) };
  },
  '改成學生的確認(既有老師在她的班上):寫 legacy 會撤銷、她的班照樣免費;自己付費的寫保留到幾號;不寫要付費': () => {
    const { O } = context(world(), { paid: true });
    const row = Object.assign(rowBy('ben'), { role: 'teacher', demoted: false });
    row.own_classes = row.own_classes.map(c => Object.assign(c, { active: true }));
    const look = clone(FX['owner_lookup.demoted'].data);
    look.grants.forEach(g => { g.revoked_at = null; });
    const a = O.demoteLines(row, look, OWNER_ID, ALL.server_now);
    const paid = clone(FX['owner_lookup.paid_with_credits'].data.grants[0]);
    const look2 = clone(look); look2.grants.push(paid);
    const row2 = Object.assign(clone(row), { classes: [] });
    const b = O.demoteLines(row2, look2, OWNER_ID, ALL.server_now);
    const ok = a.includes('他的既有帳號無期限會一起撤銷。') && a.includes('他在妳的班上，妳的班照樣讓他免費使用；要收回請把他移出妳的班。')
      && !a.includes('改完之後要付費才能使用。') && a.includes('他的 1 個班會停用，不能再加入。')
      && b.includes('他自己付費的學生方案保留到 ' + DATE(paid.ends_at) + '。') && !b.includes('改完之後要付費才能使用。');
    return { ok, detail: JSON.stringify({ a, b }) };
  },
  '改成學生的結果:結束幾段、其中付費沒退、停用幾個班、班上幾位仍可使用、本人狀態': () => {
    const { O } = context(world(), { paid: true });
    const t = O.demoteResult(FX['owner_set_role.demote_paid_teacher'].data, rowBy('tina'), OWNER_ID);
    const b = O.demoteResult(FX['owner_set_role.demote_legacy_teacher'].data, rowBy('ben'), OWNER_ID);
    const ok = t.includes('已結束 1 段老師方案。') && t.includes('其中 1 段是付費的，付款沒有退，要退款請到查帳號頁。') && t.includes('停用 2 個班。')
      && t.includes('班上 3 位學生，其中 0 位靠自己的使用權仍可使用，其他人需要付費。') && t.includes('他自己現在沒有使用權，要付費才能使用。')
      && b.includes('他自己的既有帳號無期限已撤銷（要讓他繼續免費，到查帳號頁按恢復）。') && b.includes('他自己仍有使用權（妳的班）。')
      && b.includes('班上 1 位學生都靠自己的使用權仍可使用。') && !b.some(x => /付費的，付款沒有退/.test(x));
    return { ok, detail: JSON.stringify({ t, b }) };
  },
  '改成老師:停用過的班才有二選一,N 是停用班的人數加總;結果列出在用的班與邀請碼、超過名額、在別位老師班上的提醒': () => {
    const { O } = context(world(), { paid: true });
    const ch = O.promoteChoice(rowBy('ben'));
    const re = O.promoteResult(FX['owner_set_role.promote_reactivate'].data);
    const nc = O.promoteResult(FX['owner_set_role.promote_new_class'].data);
    const over = O.promoteResult(Object.assign(clone(FX['owner_set_role.promote_reactivate'].data), { over_seats: true, seats_used: 12, seats: 10 }));
    const g = FX['owner_set_role.promote_reactivate'].data.member_of_other_teachers[0];
    const ok = ch && ch.n === 1 && ch.closed === 1 && O.promoteChoice(rowBy('eve')) === null && O.promoteChoice(rowBy('tina')) === null
      && re.codes.map(c => c.code).join() === 'TESTBENN' && nc.codes.map(c => c.code).join() === 'TESTGNAC'
      && re.others.length === 1 && re.others[0].text === '他是 ' + g.teacher_email + ' 的班「' + g.class_name + '」的成員，他之後寫給自己學生的備註那位老師看得到，建議先把他移出。'
      && over.warns.includes('他的學生有 12 人，超過名額 10 人，超過的人依加入先後沒有班級使用權。') && re.warns.length === 0;
    return { ok, detail: JSON.stringify({ ch, re, nc: nc.codes, over: over.warns }) };
  },
  '搬班級的結果:超過名額、老師過期、寬限中寫到幾號、本來就在、由這個班提供、移出': () => {
    const { O } = context(world(), { paid: true });
    const r = k => O.moveResult(FX['owner_move_member.' + k].data, '10 月 13 日');
    const over = r('join_over_seats'), ex = r('join_expired_teacher'), gr = r('join_grace_teacher'), al = r('already_member'), lv = r('leave'), mv = r('move_same_teacher');
    const ok = over.warns.includes('已超過這位老師的名額（2 人，現在 4 人），超過名額的學生依加入先後沒有班級使用權。')
      && ex.warns.includes('這位老師的方案已過期，加入後沒有班級使用權。') && !ex.lines.includes('已由這個班提供使用權。')
      && gr.warns.includes('這位老師的方案在寬限中，10 月 13 日之後這位學生就沒有班級使用權。') && gr.lines.includes('已由這個班提供使用權。')
      && al.lines.includes('本來就在「刷刷英文」這個班。') && al.warns.length === 0
      && lv.lines.join() === '已把他移出「Tina 早班」。' && lv.warns.length === 0
      && mv.lines[0] === '已把他移出「Tina 早班」。' && /已加入「Tina 晚班」/.test(mv.lines[1])
      && O.moveResult(FX['owner_move_member.join_grace_teacher'].data, '').warns.includes('這位老師的方案在寬限中，寬限結束後這位學生就沒有班級使用權。');
    return { ok, detail: JSON.stringify({ over, ex, gr, al, lv, mv }) };
  },
  '查帳號的文字:使用權一段一行、付款寫項目金額狀態、點數紀錄、異動紀錄看得懂': () => {
    const { O } = context(world(), { paid: true });
    const now = ALL.server_now;
    const amy = FX['owner_lookup.legacy'].data.grants[0];
    const pam = FX['owner_lookup.after_refund'].data;
    const ben = FX['owner_lookup.demoted'].data;
    const pays = pam.payments.map(p => O.paymentText(p));
    const credits = pam.credit_log.map(l => O.creditText(l));
    const hist = ben.history.map(x => O.historyText(x, OWNER_ID, ben));
    const ok = O.grantText(amy) === '學生方案 既有帳號 ' + DATE(amy.starts_at) + ' 起，無期限' && O.grantState(amy, now) === '使用中'
      && O.grantState(ben.grants[0], now) === '已撤銷'
      && pays[0].item === '學生方案 1 個月' && pays[0].amount === '199 元' && pays[0].state === '已付款' && pays[0].method === '轉帳'
      && pays[1].item === '寫作批改 5 篇' && pays[1].state === '已退款 650 元' && pays[1].method === 'LINE Pay'
      && credits.map(c => c.text).join('|') === '購買 加 5 篇|批改 扣 1 篇|更正 加 2 篇|更正 扣 1 篇|退款收回 扣 3 篇'
      && hist.some(x => x.text === '改成學生') && hist.some(x => x.text === '停用班級「週三英文班」') && hist.some(x => x.who === '站長') && hist.some(x => x.who === '系統');
    return { ok, detail: JSON.stringify({ pays, credits: credits.map(c => c.text), hist: hist.map(x => x.who + ' ' + x.text) }) };
  },

  /* ---------- 接上 admin.js ---------- */
  'admin.js:PAID_UI 沒開,站長登入:畫面跟以前一樣(沒有分頁、沒有收費管理),一個 owner_* 都不呼叫': async () => {
    const w = world();
    const A = loadAdmin(w, { paid: false });
    await settle();
    const ok = !/收費管理/.test(A.root.textContent) && A.root.byClass('ow-tabs').length === 0 && w.rpcs.length === 0
      && A.root.children[0].className === 'page-head' && A.root.byClass('ac-box').length === 1 && A.root.find(n => n.tagName === 'TABLE').length === 1;
    return { ok, detail: JSON.stringify({ rpcs: w.rpcs.map(r => r[0]), first: A.root.children.map(c => c.className) }) };
  },
  'admin.js:PAID_UI 打開但不是站長(一般老師):沒有收費管理,不呼叫 owner_*': async () => {
    const w = world();
    const A = loadAdmin(w, { paid: true, access: clone(FX['owner_lookup.teacher_over_seats'].data.access) });
    await settle();
    const ok = !/收費管理/.test(A.root.textContent) && A.root.byClass('ow-tabs').length === 0 && w.rpcs.length === 0;
    return { ok, detail: A.root.children.map(c => c.className).join(',') };
  },
  'admin.js:PAID_UI 打開、站長:頁首下方兩個分頁(學生進度、收費管理),預設學生進度;按收費管理才讀帳號清單(參數照九.8)': async () => {
    const w = world();
    const A = loadAdmin(w, { paid: true });
    await settle();
    const tabs = A.root.byClass('ow-top-tab').map(b => b.textContent);
    const before = w.calls('owner_accounts').length;
    const studentsShown = !A.root.byClass('ow-students')[0].hidden && A.root.byClass('ow-owner')[0].hidden;
    await btn(A.root, '收費管理').click(); await settle();
    const args = w.calls('owner_accounts');
    const ok = tabs.join() === '學生進度,收費管理' && before === 0 && studentsShown && A.root.byClass('ow-owner')[0].hidden === false
      && args.length === 1 && JSON.stringify(args[0]) === JSON.stringify({ p_filter: 'all', p_search: null, p_limit: 50, p_offset: 0 })
      && A.root.byClass('ow-row').length === 16 && /共 16 人/.test(A.root.byClass('ow-total')[0].textContent)
      && A.root.byClass('ow-students')[0].byClass('ac-box').length === 1 && onlyOwnerRpcs(w);
    return { ok, detail: JSON.stringify({ tabs, before, args, rows: A.root.byClass('ow-row').length }) };
  },

  /* ---------- 帳號清單 ---------- */
  '分類:按寬限中只查 teacher_grace(從第一頁),按鈕標成按下;結果只有 Gwen': async () => {
    const w = world(); const L = await area(w);
    await btn(L.el, '寬限中').click(); await settle();
    const last = w.calls('owner_accounts').pop();
    const pressed = L.el.find(n => n.attrs['aria-pressed'] === 'true').map(n => n.textContent);
    const ok = last.p_filter === 'teacher_grace' && last.p_offset === 0 && last.p_search === null && pressed.join() === '寬限中'
      && L.el.byClass('ow-row').length === 1 && !!rowOf(L, 'gwen');
    return { ok, detail: JSON.stringify({ last, pressed, n: L.el.byClass('ow-row').length }) };
  },
  '搜尋:打字停 300 毫秒才查一次(中間不查),查的是最後的字;清空就回到不搜尋': async () => {
    const w = world(); const L = await area(w);
    const box = L.el.find(n => n.tagName === 'INPUT' && n.attrs.type === 'search')[0];
    const n0 = w.calls('owner_accounts').length;
    for (const v of ['T', 'TI', 'TIN', 'TINA']) { box.value = v; await box.fire('input'); await wait(60); }
    const early = w.calls('owner_accounts').length - n0;
    await wait(330); await settle();
    const after = w.calls('owner_accounts').slice(n0);
    const rowsAfter = L.el.byClass('ow-row').length;
    box.value = '  '; await box.fire('input'); await wait(350); await settle();
    const cleared = w.calls('owner_accounts').pop();
    const ok = early === 0 && after.length === 1 && after[0].p_search === 'TINA' && after[0].p_offset === 0 && rowsAfter === 1
      && cleared.p_search === null;
    return { ok, detail: JSON.stringify({ early, after, cleared }) };
  },
  '分頁:共 128 人,上一頁在第一頁不能按;下一頁 offset 加 50;最後一頁下一頁不能按;上一頁回去': async () => {
    const w = world();
    w.accounts = args => { const d = clone(ALL); d.total = 128; d.offset = args.p_offset; d.limit = 50; return { data: d, error: null }; };
    const L = await area(w);
    const prev = () => btn(L.el, '上一頁'), next = () => btn(L.el, '下一頁');
    const s0 = [prev().disabled, next().disabled, L.el.byClass('ow-total')[0].textContent];
    await next().click(); await settle();
    const o1 = w.calls('owner_accounts').pop().p_offset;
    await next().click(); await settle();
    const o2 = w.calls('owner_accounts').pop().p_offset;
    const s2 = [prev().disabled, next().disabled];
    await prev().click(); await settle();
    const o3 = w.calls('owner_accounts').pop().p_offset;
    const ok = s0[0] === true && s0[1] === false && /共 128 人/.test(s0[2]) && o1 === 50 && o2 === 100 && s2[0] === false && s2[1] === true && o3 === 50;
    return { ok, detail: JSON.stringify({ s0, o1, o2, s2, o3 }) };
  },
  '每列的內容:名字(沒有就用 @ 前段)、Email、註冊日、最近登入(沒有寫沒有紀錄)、身分、狀態、老師那一行、開的班、加入的班與原因': async () => {
    const w = world(); const L = await area(w);
    const t = rowOf(L, 'tina').textContent, e = rowOf(L, 'eve').textContent, n = rowOf(L, 'nate'), o = rowOf(L, 'otto').textContent, b = rowOf(L, 'ben').textContent;
    const tina = rowBy('tina');
    const ok = /Tina Teacher/.test(t) && t.includes('註冊 ' + DATE(tina.created_at)) && t.includes('最近登入 ' + DATE(tina.last_sign_in_at))
      && t.includes('方案 2 人，已用 3 人，到 ' + DATE(tina.teacher.plan_until)) && /Tina 早班/.test(t) && /TESTTNAA/.test(t) && /3 人/.test(t)
      && /最近登入 沒有紀錄/.test(e) && /使用期限已到/.test(e)
      && n.byClass('ow-name')[0].textContent === 'teacher.nate' && /還沒有方案/.test(n.textContent)
      && o.includes('Tina 早班') && o.includes(ACC.tina.email) && o.includes('超過老師的名額')
      && /站長改過/.test(b) && /已停用/.test(b) && /TESTBENN/.test(b);
    return { ok, detail: JSON.stringify({ t, e, o, b }) };
  },
  '每列的按鈕:站長只有查帳號;老師有查帳號、改角色;學生多加入班級;每個加入的班有移出,學生列多搬到別班': async () => {
    const w = world(); const L = await area(w);
    const names = key => rowOf(L, key).byClass('ow-actions')[0].find(n => n.tagName === 'BUTTON').map(b => b.textContent).join();
    const cls = key => rowOf(L, key).byClass('ow-joined')[0].find(n => n.tagName === 'BUTTON').map(b => b.textContent).join();
    const r = { owner: names('owner'), tina: names('tina'), tom: names('tom'), ben: names('ben'), otto: cls('otto'), amy: cls('amy') };
    const ok = r.owner === '查帳號' && r.tina === '查帳號,改角色' && r.tom === '查帳號,改角色,加入班級' && r.ben === '查帳號,改角色,加入班級'
      && r.otto === '移出,搬到別班' && r.amy === '移出,搬到別班';
    return { ok, detail: JSON.stringify(r) };
  },
  '使用者自己填的名字、班名用文字節點,畫面不會被當成 HTML;讀不到清單時原樣顯示資料庫的訊息': async () => {
    const w = world();
    const evil = '<img src=x onerror=alert(1)>';
    w.accounts = () => { const d = clone(ALL); d.rows[0].name = evil; d.rows[2].classes[0].class_name = evil; return { data: d, error: null }; };
    const L = await area(w);
    const htmlNodes = L.el.find(n => n._html && !/^<svg/.test(n._html));
    const shown = L.el.byClass('ow-name')[0].textContent === evil && L.el.textContent.includes(evil) && L.el.find(n => n.tagName === 'IMG').length === 0;
    const w2 = world(); w2.accounts = () => ({ data: null, error: clone(FX['error.not_owner'].error) });
    const L2 = await area(w2);
    const ok = shown && htmlNodes.length === 0 && /只有站長可以執行這個動作/.test(L2.el.textContent);
    return { ok, detail: JSON.stringify({ html: htmlNodes.length, msg: L2.el.byClass('ow-msg').map(n => n.textContent) }) };
  },

  /* ---------- 改角色 ---------- */
  '老師改成學生:先讀他的使用權寫後果;取消什麼都不送;確定才送 { p_who, p_role: student, p_note },結果畫面寫結束幾段、停用幾個班,關掉後重讀清單': async () => {
    const w = world(); const L = await area(w);
    await btn(rowOf(L, 'tina'), '改角色').click(); await settle();
    const d1 = dlg(L); const l1 = lines(d1);
    await cancel(d1);
    const sent0 = w.calls('owner_set_role').length;
    await btn(rowOf(L, 'tina'), '改角色').click(); await settle();
    const d2 = dlg(L);
    await setVal(field(d2, 'note'), ' 停止合作 ');
    w.next.owner_set_role = ['owner_set_role.demote_paid_teacher'];
    const n0 = w.calls('owner_accounts').length;
    await ok(d2);
    const res = dlg(L); const rl = lines(res);
    await ok(res);
    const args = w.calls('owner_set_role');
    const lk = w.calls('owner_lookup');
    const good = sent0 === 0 && l1[0] === '他的老師方案會立刻結束，沒有寬限（包括已經預付、還沒開始的）。' && /確定改成學生/.test(d2.textContent)
      && lk[0].p_who === ACC.tina.id
      && args.length === 1 && JSON.stringify(args[0]) === JSON.stringify({ p_who: ACC.tina.email, p_role: 'student', p_note: '停止合作' })
      && rl.includes('已結束 1 段老師方案。') && rl.includes('停用 2 個班。') && dlg(L) === null
      && w.calls('owner_accounts').length === n0 + 1 && onlyOwnerRpcs(w);
    return { ok: good, detail: JSON.stringify({ l1, args, rl }) };
  },
  '改角色被資料庫擋下:視窗不關,錯誤原樣顯示,不跳結果': async () => {
    const w = world(); const L = await area(w);
    await btn(rowOf(L, 'tina'), '改角色').click(); await settle();
    const d = dlg(L);
    w.next.owner_set_role = ['error.set_role_already_student'];
    await ok(d);
    const ok2 = dlg(L) === d && d.isConnected && /這個帳號已經是學生/.test(d.byClass('ow-error')[0].textContent) && L.dom.body.byClass('ow-dialog').length === 1;
    return { ok: ok2, detail: d.byClass('ow-error')[0].textContent };
  },
  '學生改成老師(沒有停用的班):名額快選、到期日預設一個月後、班名;送出參數照九.9;結果有邀請碼與複製、在別位老師班上的提醒': async () => {
    const w = world(); const L = await area(w);
    await btn(rowOf(L, 'eve'), '改角色').click(); await settle();
    const d = dlg(L);
    const until0 = field(d, 'until').value;
    const hasMode = !!radio(d, 'mode', 'new');
    await btn(d, '30').click(); await settle();
    const seats = field(d, 'seats').value;
    await setVal(field(d, 'className'), 'Eve 的班');
    w.next.owner_set_role = ['owner_set_role.promote_student'];
    await ok(d);
    const args = w.calls('owner_set_role')[0];
    const res = dlg(L);
    const copyBtn = res.find(n => n.tagName === 'BUTTON' && /複製/.test(n.textContent))[0];
    if (copyBtn) await copyBtn.click();
    const okk = !hasMode && until0 === L.O.defaultUntilDate(Date.now()) && seats === '30'
      && JSON.stringify(args) === JSON.stringify({ p_who: ACC.eve.email, p_role: 'teacher', p_seats: 30, p_until: until0 + 'T23:59:59+08:00', p_note: null, p_reactivate: true, p_class_name: 'Eve 的班' })
      && /TESTGNAB/.test(res.textContent) && L.ctx.copied === 'TESTGNAB' && res.byClass('ow-other').length === 1 && /teacher\.tina@example\.test/.test(res.textContent);
    return { ok: okk, detail: JSON.stringify({ until0, seats, args, text: res.textContent.slice(0, 300) }) };
  },
  '學生改成老師(前老師,有停用的班):二選一預設恢復;選開新班而且舊班有人要再按一次才送,參數 p_reactivate false 與班名': async () => {
    const w = world(); const L = await area(w);
    await btn(rowOf(L, 'ben'), '改角色').click(); await settle();
    const d = dlg(L);
    const desc = d.textContent;
    const nameHidden = d.byClass('ow-field-className')[0].hidden;
    await btn(d, '10').click();
    await pick(radio(d, 'mode', 'new'));
    const nameShown = !d.byClass('ow-field-className')[0].hidden;
    await setVal(field(d, 'className'), 'Ben 新班');
    w.next.owner_set_role = ['owner_set_role.promote_new_class'];
    await ok(d);
    const armed = w.calls('owner_set_role').length === 0 && /再按一次/.test(d.byClass('ow-ok')[0].textContent);
    await ok(d);
    const a = w.calls('owner_set_role')[0];
    const okk = /恢復原本的班/.test(desc) && desc.includes('邀請碼不變，舊班的 1 位學生接著算名額，他又看得到他們的進度。') && radio(d, 'mode', 'reactivate').checked === true
      && desc.includes('舊班維持停用（不能再用邀請碼加入），但舊班的 1 位學生名單還在') && nameHidden && nameShown && armed
      && a && a.p_reactivate === false && a.p_class_name === 'Ben 新班' && a.p_seats === 10 && a.p_role === 'teacher';
    return { ok: okk, detail: JSON.stringify({ nameHidden, nameShown, armed, a }) };
  },
  '學生改成老師:名額不是 1 到 1000 的整數、沒有到期日、到期日在今天以前,都不送': async () => {
    const w = world(); const L = await area(w);
    await btn(rowOf(L, 'eve'), '改角色').click(); await settle();
    const d = dlg(L);
    const tries = [];
    for (const [s, u] of [['', '2030-01-01'], ['0', '2030-01-01'], ['1001', '2030-01-01'], ['2.5', '2030-01-01'], ['10', ''], ['10', '2020-01-01']]) {
      await setVal(field(d, 'seats'), s); await setVal(field(d, 'until'), u); await ok(d);
      tries.push(d.byClass('ow-error').map(n => n.textContent).join('') + d.find(n => /is-bad/.test(n.className)).length);
    }
    const okk = w.calls('owner_set_role').length === 0 && tries.every(t => t && t !== '0');
    return { ok: okk, detail: JSON.stringify(tries) };
  },
  '結果畫面的移出(他在別位老師班上):按一次變成再按一次確定,第二次才送 { p_student, p_from_class, p_note: null }': async () => {
    const w = world(); const L = await area(w);
    await btn(rowOf(L, 'ben'), '改角色').click(); await settle();
    const d = dlg(L); await btn(d, '10').click(); await settle();
    w.next.owner_set_role = ['owner_set_role.promote_reactivate'];
    await ok(d);
    const res = dlg(L);
    const b = btn(res, '移出');
    await b.click(); await settle();
    const first = w.calls('owner_move_member').length;
    const armedText = res.byClass('ow-other')[0].find(n => n.tagName === 'BUTTON')[0].textContent;
    w.next.owner_move_member = [{ data: Object.assign(clone(FX['owner_move_member.leave'].data), { removed: { class_id: FX['owner_set_role.promote_reactivate'].data.member_of_other_teachers[0].class_id, class_name: 'Gwen 讀書會' } }), error: null }];
    await res.byClass('ow-other')[0].find(n => n.tagName === 'BUTTON')[0].click(); await settle();
    const a = w.calls('owner_move_member');
    const g = FX['owner_set_role.promote_reactivate'].data.member_of_other_teachers[0];
    const okk = first === 0 && /再按一次/.test(armedText) && a.length === 1 && JSON.stringify(a[0]) === JSON.stringify({ p_student: ACC.ben.email, p_from_class: g.class_id, p_note: null })
      && /已把他移出「Gwen 讀書會」/.test(res.textContent);
    return { ok: okk, detail: JSON.stringify({ armedText, a, t: res.textContent.slice(-120) }) };
  },

  /* ---------- 搬班級 ---------- */
  '加入班級:邀請碼不分大小寫(送出前去空白、轉大寫);寬限中的老師另外讀他的寬限日寫進提醒': async () => {
    const w = world(); const L = await area(w);
    await btn(rowOf(L, 'tom'), '加入班級').click(); await settle();
    const d = dlg(L);
    await setVal(field(d, 'code'), ' testgwen ');
    await setVal(field(d, 'note'), '試聽');
    w.next.owner_move_member = ['owner_move_member.join_grace_teacher'];
    w.lookups[ACC.gwen.id] = FX['owner_lookup.teacher_grace'].data;
    await ok(d);
    const a = w.calls('owner_move_member')[0];
    const res = dlg(L);
    const day = DAY(FX['owner_lookup.teacher_grace'].data.access.teacher_grace_until, FX['owner_lookup.teacher_grace'].data.access.server_now);
    const okk = JSON.stringify(a) === JSON.stringify({ p_student: ACC.tom.email, p_to_code: 'TESTGWEN', p_note: '試聽' })
      && warns(res).includes('這位老師的方案在寬限中，' + day + '之後這位學生就沒有班級使用權。') && lines(res).includes('已由這個班提供使用權。') && onlyOwnerRpcs(w);
    return { ok: okk, detail: JSON.stringify({ a, warns: warns(res), lines: lines(res) }) };
  },
  '加入班級(當過老師的帳號):只能選她的班,不給輸入邀請碼,寫出這條規則': async () => {
    const w = world(); const L = await area(w);
    await btn(rowOf(L, 'ben'), '加入班級').click(); await settle();
    const d = dlg(L);
    const free = radio(d, 'code', 'TESTFREE');
    const typed = field(d, 'code');
    if (free) await pick(free);
    w.next.owner_move_member = ['owner_move_member.already_member'];
    await ok(d);
    const a = w.calls('owner_move_member')[0];
    const okk = !!free && !typed && lines(d).includes('他當過老師，只能加進妳的班。') && a && a.p_to_code === 'TESTFREE' && a.p_student === ACC.ben.email;
    return { ok: okk, detail: JSON.stringify({ a, lines: lines(d) }) };
  },
  '移出:先確認(寫學習記錄不會刪、會失去這個班的使用權),取消不送;確定送 { p_student, p_from_class, p_note },訊息寫移出哪個班,清單重讀': async () => {
    const w = world(); const L = await area(w);
    const row = rowOf(L, 'cole'), cls = rowBy('cole').classes[0];
    await btn(row, '移出').click(); await settle();
    const d = dlg(L); const l = lines(d);
    await cancel(d);
    const none = w.calls('owner_move_member').length;
    await btn(rowOf(L, 'cole'), '移出').click(); await settle();
    const d2 = dlg(L);
    await setVal(field(d2, 'note'), '空出名額');
    w.next.owner_move_member = [{ data: Object.assign(clone(FX['owner_move_member.leave'].data), { email: ACC.cole.email }), error: null }];
    const n0 = w.calls('owner_accounts').length;
    await ok(d2);
    const a = w.calls('owner_move_member');
    const msg = L.el.byClass('ow-msg')[0].textContent;
    const okk = none === 0 && l.includes('只會刪掉他在這個班的成員資料，學習記錄不會刪除。') && l.includes('他會失去這個班提供的使用權。')
      && a.length === 1 && JSON.stringify(a[0]) === JSON.stringify({ p_student: ACC.cole.email, p_from_class: cls.class_id, p_note: '空出名額' })
      && /移出「Tina 早班」/.test(msg) && w.calls('owner_accounts').length === n0 + 1 && dlg(L) === null;
    return { ok: okk, detail: JSON.stringify({ l, a, msg }) };
  },
  '搬到別班:寫出先移出再加入;送 { p_student, p_to_code, p_from_class, p_note };結果寫移出與加入;同一個班被擋時錯誤原樣顯示': async () => {
    const w = world(); const L = await area(w);
    const cls = rowBy('cleo').classes[0];
    await btn(rowOf(L, 'cleo'), '搬到別班').click(); await settle();
    const d = dlg(L); const l = lines(d);
    await setVal(field(d, 'code'), 'testtnaa');
    w.next.owner_move_member = ['error.move_same_class', 'owner_move_member.move_same_teacher'];
    await ok(d);
    const err = d.byClass('ow-error')[0].textContent;
    await setVal(field(d, 'code'), 'testtnbb');
    await ok(d);
    const a = w.calls('owner_move_member');
    const res = dlg(L);
    const okk = l.some(x => /先把他移出「Tina 早班」/.test(x)) && /移出與加入是同一個班/.test(err)
      && JSON.stringify(a[1]) === JSON.stringify({ p_student: ACC.cleo.email, p_to_code: 'TESTTNBB', p_from_class: cls.class_id, p_note: null })
      && lines(res)[0] === '已把他移出「Tina 早班」。' && warns(res).some(x => /已超過這位老師的名額/.test(x));
    return { ok: okk, detail: JSON.stringify({ l, err, a, res: lines(res) }) };
  },

  /* ---------- 審查修正(2026-10-11) ---------- */
  '改成學生的確認照資料庫的規則寫他自己付費的學生方案:預付續約不寫提前;試用中付的才提前,保留到寫提前後的日期;贈送後面接付費寫幾號才開始': () => {
    const { O } = context(world(), { paid: true });
    const now = Date.parse(ALL.server_now), D = 864e5;
    const base = clone(FX['owner_lookup.teacher_over_seats'].data);
    const sg = (source, a, b) => ({ id: 'g-' + source + a, kind: 'student', source, starts_at: isoOf(now + a * D), ends_at: isoOf(now + b * D), revoked_at: null, payment_id: source === 'paid' ? 'p-' + a : null });
    const row = Object.assign(rowBy('tina'), { classes: [] });
    const renew = clone(base); renew.grants.push(sg('paid', -1, 30), sg('paid', 30, 60));
    const a = O.demoteLines(row, renew, OWNER_ID, ALL.server_now);
    const trial = clone(base); trial.access.trial_until = isoOf(now + 5 * D); trial.grants.push(sg('paid', 5, 35));
    const b = O.demoteLines(row, trial, OWNER_ID, ALL.server_now);
    const comp = clone(base); comp.grants.push(sg('comp', -1, 10), sg('paid', 10, 41));
    const c = O.demoteLines(row, comp, OWNER_ID, ALL.server_now);
    const inOwner = Object.assign(clone(row), { classes: rowBy('amy').classes });
    const c2 = O.demoteLines(inOwner, comp, OWNER_ID, ALL.server_now);
    const MOVE = '他試用中付的學生方案會提前到今天開始。';
    const res = clone(FX['owner_set_role.demote_paid_teacher'].data);
    const after = O.demoteResult(res, row, OWNER_ID, comp);
    const okk = a.includes('他自己付費的學生方案保留到 ' + DATE(isoOf(now + 60 * D)) + '。') && !a.includes(MOVE) && !a.some(x => /才開始/.test(x))
      && b.includes(MOVE) && b.includes('他自己付費的學生方案保留到 ' + DATE(isoOf(now + 30 * D)) + '。')
      && c.includes('妳贈送的學生方案會一起撤銷。') && !c.includes(MOVE) && c.includes('他付費的學生方案 ' + DATE(isoOf(now + 10 * D)) + ' 才開始，這之前沒有使用權。')
      && !c.includes('改完之後要付費才能使用。') && c2.includes('他付費的學生方案 ' + DATE(isoOf(now + 10 * D)) + ' 才開始。')
      && after.includes('他自己付費的學生方案 ' + DATE(isoOf(now + 10 * D)) + ' 才開始，這之前沒有使用權。') && !after.some(x => /要付費才能使用/.test(x));
    return { ok: okk, detail: JSON.stringify({ a, b, c, c2, after }) };
  },
  '搬到別班的確認寫出離開原本的班的後果(使用權改由新班、原本的老師看不到進度);她的班寫如果新班不是妳的班;當過老師的人只寫得到的': async () => {
    const w = world(); const L = await area(w);
    const open = async (key, nth) => { await rowOf(L, key).byText('搬到別班')[nth || 0].click(); await settle(); const d = dlg(L); const l = lines(d); await cancel(d); return l; };
    const cleo = await open('cleo'), fay = await open('fay'), otto = await open('otto'), benGwen = await open('ben', 1), benMine = await open('ben', 0);
    const NEW = '他之後改由新的班提供使用權；新班老師的方案過期或名額已滿時，他就沒有班級使用權。';
    const okk = cleo.includes(NEW) && cleo.includes('如果新班是別位老師的，原本的老師就看不到他的進度。')
      && fay.includes('如果新班不是妳的班，他會失去妳的班提供的免費使用；新班老師的方案過期或名額已滿時，他就沒有班級使用權。')
      && fay.includes('如果新班不是妳的班，妳的學生進度表裡不會再有他。')
      && !otto.some(x => /提供使用權|免費使用/.test(x)) && otto.includes('如果新班是別位老師的，原本的老師就看不到他的進度。')
      && benGwen.includes('他之後改由妳的班提供免費使用。') && benGwen.includes('原本的老師會看不到他的進度。')
      && benMine.length === 2 && w.calls('owner_move_member').length === 0;
    return { ok: okk, detail: JSON.stringify({ cleo, fay, otto, benGwen, benMine }) };
  },
  '改角色、加入、搬班、移出的視窗與結果都寫出完整 Email(名字是使用者自己填的,可能撞名)': async () => {
    const w = world(); const L = await area(w);
    const titleOf = async (key, label, nth) => { await rowOf(L, key).byText(label)[nth || 0].click(); await settle(); const d = dlg(L); const t = d.find(n => n.tagName === 'H2')[0].textContent; await cancel(d); return t; };
    const t = { demote: await titleOf('tina', '改角色'), promote: await titleOf('eve', '改角色'), join: await titleOf('tom', '加入班級'), move: await titleOf('cleo', '搬到別班'), leave: await titleOf('cole', '移出') };
    w.next.owner_set_role = ['owner_set_role.demote_paid_teacher'];
    await btn(rowOf(L, 'tina'), '改角色').click(); await settle();
    await ok(dlg(L));
    const result = dlg(L).find(n => n.tagName === 'H2')[0].textContent;
    const okk = t.demote === '把「Tina Teacher」（' + ACC.tina.email + '）改成學生？' && t.promote.includes(ACC.eve.email) && t.join.includes(ACC.tom.email)
      && t.move.includes(ACC.cleo.email) && t.leave.includes(ACC.cole.email) && result.includes(ACC.tina.email)
      && L.O.fullWho({ email: 'kevin@gmail.com' }) === '「kevin@gmail.com」';
    return { ok: okk, detail: JSON.stringify({ t, result }) };
  },
  '危險的視窗(改成學生、移出)焦點先放在取消;在備註欄按 Enter 不會直接送出;一般視窗照常放在第一欄': async () => {
    const w = world(); const L = await area(w);
    const doc = L.dom.document;
    await btn(rowOf(L, 'tina'), '改角色').click(); await settle();
    const d1 = dlg(L);
    const f1 = doc.activeElement.textContent;
    field(d1, 'note').focus();
    const blocked1 = doc.key({ key: 'Enter' });
    await cancel(d1);
    await btn(rowOf(L, 'otto'), '移出').click(); await settle();
    const d2 = dlg(L);
    const f2 = doc.activeElement.textContent;
    field(d2, 'note').focus();
    const blocked2 = doc.key({ key: 'Enter' });
    await cancel(d2);
    await btn(rowOf(L, 'eve'), '改角色').click(); await settle();
    const d3 = dlg(L);
    const f3 = doc.activeElement === field(d3, 'seats');
    const blocked3 = doc.key({ key: 'Enter' });
    await cancel(d3);
    const okk = f1 === '取消' && f2 === '取消' && blocked1 && blocked2 && f3 && !blocked3
      && w.calls('owner_set_role').length === 0 && w.calls('owner_move_member').length === 0;
    return { ok: okk, detail: JSON.stringify({ f1, f2, f3, blocked1, blocked2, blocked3 }) };
  },
  '改成老師結果裡的移出:第一次按先寫出移出的後果與備註欄,第二次才送,備註一起送': async () => {
    const w = world(); const L = await area(w);
    await btn(rowOf(L, 'ben'), '改角色').click(); await settle();
    const d = dlg(L); await btn(d, '10').click(); await settle();
    w.next.owner_set_role = ['owner_set_role.promote_reactivate'];
    await ok(d);
    const box = dlg(L).byClass('ow-other')[0];
    const before = box.byClass('ow-line').length;
    await box.find(n => n.tagName === 'BUTTON')[0].click(); await settle();
    const l = box.byClass('ow-line').map(n => n.textContent);
    const note = box.find(n => n.tagName === 'INPUT')[0];
    const sent0 = w.calls('owner_move_member').length;
    if (note) await setVal(note, '避免看到備註');
    const g = FX['owner_set_role.promote_reactivate'].data.member_of_other_teachers[0];
    w.next.owner_move_member = [{ data: Object.assign(clone(FX['owner_move_member.leave'].data), { removed: { class_id: g.class_id, class_name: g.class_name } }), error: null }];
    await box.find(n => n.tagName === 'BUTTON')[0].click(); await settle();
    const a = w.calls('owner_move_member');
    const okk = before === 0 && sent0 === 0 && l.includes('只會刪掉他在這個班的成員資料，學習記錄不會刪除。') && l.includes('他會失去這個班提供的使用權。')
      && l.includes('移出後，這位老師看不到他的進度。') && !!note
      && a.length === 1 && JSON.stringify(a[0]) === JSON.stringify({ p_student: ACC.ben.email, p_from_class: g.class_id, p_note: '避免看到備註' });
    return { ok: okk, detail: JSON.stringify({ l, a }) };
  },
  '列上的動作失敗:錯誤寫在那一列裡,按鈕不停用、焦點留在按鈕上': async () => {
    const w = world(); const L = await area(w);
    w.next.owner_lookup = [{ data: null, error: clone(FX['error.not_owner'].error) }];
    const b = btn(rowOf(L, 'ed'), '改角色');
    b.focus();
    const p = b.click();
    const disabledWhile = b.disabled;
    await p; await settle();
    const rowMsg = rowOf(L, 'ed').byClass('ow-row-msg')[0];
    const okk = !disabledWhile && !!rowMsg && /只有站長可以執行這個動作/.test(rowMsg.textContent) && rowMsg.attrs.role === 'alert'
      && L.dom.document.activeElement === b && b.attrs['aria-disabled'] === undefined && dlg(L) === null;
    return { ok: okk, detail: JSON.stringify({ disabledWhile, rowMsg: rowMsg && rowMsg.textContent, active: L.dom.document.activeElement.textContent }) };
  },
  '做完一件事的訊息:換分類、搜尋、換頁就清掉;做完之後重讀那一次留著': async () => {
    const w = world(); const L = await area(w);
    w.next.owner_move_member = ['owner_move_member.leave'];
    await btn(rowOf(L, 'otto'), '移出').click(); await settle();
    await ok(dlg(L));
    const msg = () => L.el.byClass('ow-msg')[0].textContent;
    const kept = msg();
    await btn(L.el, '老師').click(); await settle();
    const okk = /移出「Tina 早班」/.test(kept) && msg() === '';
    return { ok: okk, detail: JSON.stringify({ kept, after: msg() }) };
  },
  '最後一頁唯一的一列做完事之後不在分類裡:自動回到還有資料的那一頁,不會寫沒有符合的帳號又寫共 N 人': async () => {
    const w = world();
    w.accounts = args => { const d = clone(ALL); d.limit = 50; d.offset = args.p_offset; if (args.p_offset >= 50) { d.rows = []; d.total = 50; } else d.total = 51; return { data: d, error: null }; };
    const L = await area(w);
    await btn(L.el, '下一頁').click(); await settle();
    const offs = w.calls('owner_accounts').map(a => a.p_offset);
    const okk = offs.join() === '0,50,0' && L.el.byClass('ow-row').length === 16 && !/沒有符合的帳號/.test(L.el.textContent);
    return { ok: okk, detail: JSON.stringify({ offs, rows: L.el.byClass('ow-row').length }) };
  },
  '寬螢幕是一列一個帳號的表格:有欄位標題,點名字就查帳號': async () => {
    const w = world(); const L = await area(w);
    const head = L.el.byClass('ow-thead')[0];
    const nameBtn = rowOf(L, 'pam').find(n => n.tagName === 'BUTTON' && /\bow-name\b/.test(n.className))[0];
    if (nameBtn) await nameBtn.click();
    await settle();
    const a = w.calls('owner_lookup').pop();
    const okk = !!head && head.attrs['aria-hidden'] === 'true' && head.find(n => n.nodeType === 1 && !n.children.length).map(n => n.textContent).filter(Boolean).join() === '帳號,身分,使用狀態,註冊,最近登入'
      && !!nameBtn && !!a && a.p_who === ACC.pam.email && !L.el.byClass('ow-p-lookup')[0].hidden;
    return { ok: okk, detail: JSON.stringify({ head: head && head.textContent, a }) };
  },
  '讀螢幕的人分得出每顆按鈕:加入的班的按鈕寫班名,同一列不會有兩顆一樣的名字': async () => {
    const w = world(); const L = await area(w);
    const labels = rowOf(L, 'ben').find(n => n.tagName === 'BUTTON').map(b => b.attrs['aria-label'] || b.textContent);
    const okk = new Set(labels).size === labels.length && labels.includes('移出 刷刷英文（' + ACC.ben.email + '）') && labels.includes('搬到別班 Gwen 讀書會（' + ACC.ben.email + '）');
    return { ok: okk, detail: JSON.stringify(labels) };
  },
  'admin.js 站長模式:分頁上面只留標題,說明與下載備份放進學生進度;讀不到學生資料時分頁上面也有標題': async () => {
    const w = world();
    const A = loadAdmin(w, { paid: true });
    await settle();
    const head = A.root.children[0];
    const ps = A.root.byClass('ow-students')[0];
    const w2 = world(); w2.progressError = 'boom';
    const B = loadAdmin(w2, { paid: true });
    await settle();
    const w3 = world();
    const C = loadAdmin(w3, { paid: false });
    await settle();
    const okk = head.className === 'page-head' && head.children.length === 1 && head.children[0].tagName === 'H1' && A.root.children[1].className.includes('ow-tabs')
      && /點任一列展開/.test(ps.children[0].textContent) && /下載全部備份/.test(ps.children[0].textContent)
      && B.root.children[0].find(n => n.tagName === 'H1').length === 1 && /讀取失敗/.test(B.root.byClass('ow-students')[0].textContent)
      && C.root.children[0].children.length === 3;
    return { ok: okk, detail: JSON.stringify({ first: A.root.children.map(c => c.className), b: B.root.children.map(c => c.className) }) };
  },

  /* ---------- 文案 ---------- */
  '文案:字串裡沒有破折號、沒有 emoji、中文旁邊的標點是全形、沒有不是…而是': () => {
    const bad = [];
    SRC.forEach((s, i) => {
      const strs = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').match(/'(?:[^'\\\n]|\\.)*'/g) || [];
      strs.forEach(x => {
        if (/[—–]|[\u{1F300}-\u{1FAFF}☀-➿]/u.test(x)) bad.push(i + ':' + x);
        if (/[一-鿿][,;:!?()]|[,;:!?()][一-鿿]/.test(x)) bad.push(i + ':' + x);
        if (/不是.*而是/.test(x)) bad.push(i + ':' + x);
      });
    });
    return { ok: SRC.every(Boolean) && bad.length === 0, detail: bad.slice(0, 8).join(' | ') || 'clean' };
  },
  '檔案大小:每支新檔不超過 800 行': () => {
    const n = SRC.map(s => s.split('\n').length);
    return { ok: SRC.every(Boolean) && n.every(x => x <= 800), detail: n.join(',') };
  },
};

run(cases);
