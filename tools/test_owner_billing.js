/* 站長後台「收費管理」的總覽(前端計畫九.1)、記一筆收款(九.3)、贈送(九.4)、寫作批改扣篇數與更正(九.5)、
   下載全部備份 v2(九.6)的測試。假環境在 tools/owner_test_kit.js,資料庫的回覆是 tools/fixtures/owner_contract.json。
   用法:node tools/test_owner_billing.js */
const nodeCrypto = require('crypto');
const K = require('./owner_test_kit');
const { FX, ACC, OWNER_ID, clone, DATE, DAY, world, settle, area, loadAdmin, btn, dlg, field, radio, setVal, pick, ok, cancel, lines, warns, onlyOwnerRpcs, run } = K;

const tpToday = () => { const d = new Date(Date.now() + 8 * 3600e3); return d.toISOString().slice(0, 10); };
const tpDay = off => { const d = new Date(Date.now() + 8 * 3600e3 + off * 864e5); return d.toISOString().slice(0, 10); };
const sha12 = t => nodeCrypto.createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 12);
/* owner_export_gateway 的回覆形狀(newebpay/paid_gateway_additions.sql):兩張表原樣 */
const GW = { exported_at: '2026-11-02T01:00:00Z', gateway_checkouts: [{ merchant_trade_no: 'S261101093000AB12C3D', sku: 'student_month', consent_version: 'terms-2026-10-16', consent_at: '2026-11-01T01:29:00Z' }], gateway_events: [{ id: 1, outcome: 'duplicate', needs_owner: false }] };
const NET = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } };   // 送到了但回覆沒收到(postgrest-js 連不上時 code 是空字串)
const detailOf = L => L.el.byClass('ow-detail')[0];
const lookMsg = L => L.el.byClass('ow-lookup')[0].byClass('ow-msg')[0].textContent;
const errOf = d => d.byClass('ow-error')[0].textContent;
const wrapOf = (d, name) => d.find(n => n.tagName === 'DIV' && n.className.split(' ').includes('ow-field-' + name))[0];
const fieldErr = (d, name) => wrapOf(d, name).byClass('ow-field-note')[0].textContent;
const info = (d, name) => { const w = wrapOf(d, name); return w && !w.hidden ? w.textContent : ''; };
async function openLookup(L, email) { L.a.lookup(email); await settle(); }
async function openForm(L, label) { await btn(detailOf(L), label).click(); await settle(); return dlg(L); }

/* 學生 Pam 的進度:兩篇有內容的作文(造句、Email),論述只有大綱沒有全文(沒有可以批改的版本) */
const ESSAY_E = 'Dear Ms. Lee,\n\nThank you for your quick reply. I can join the meeting on Friday.\n\nBest regards,\nPam';
const ESSAY_B = 'The report will be ready by noon.';
function pamRows() {
  const t = '2026-10-10T00:00:00Z';
  return [
    { user_id: ACC.pam.id, k: '_meta', v: { name: 'Pam', email: ACC.pam.email }, updated_at: t },
    { user_id: ACC.pam.id, k: 'writing_e', v: { 'w2-e-01': { text: '  ' + ESSAY_E + '\n' } }, updated_at: t },
    { user_id: ACC.pam.id, k: 'writing_b', v: { 'w1-b-03': { text: ESSAY_B }, 'w1-b-04': { text: '   ' } }, updated_at: t },
    { user_id: ACC.pam.id, k: 'writing_y', v: { 'w3-e-01': { p0: 'outline only' } }, updated_at: t },
  ];
}
async function openPam(A) {
  const tr = A.root.find(n => n.tagName === 'TR' && /Pam/.test(n.textContent) && n.on.click)[0];
  await tr.click(); await settle(); await K.wait(40); await settle();   // SHA-256 是真的非同步,多等一下
  return A.root.byClass('ow-writing')[0] || null;
}

const cases = {
  /* ---------- 總覽(九.1) ---------- */
  '總覽:收費管理多一個總覽分頁,按了才呼叫 owner_overview({ p_days: 14 });五段照資料庫的回傳寫': async () => {
    const w = world(); const L = await area(w);
    const tabs = L.el.byClass('ow-sub-tab').map(b => b.textContent);
    const before = w.calls('owner_overview').length;
    await btn(L.el, '總覽').click(); await settle();
    const ov = L.el.byClass('ow-overview')[0];
    const heads = ov.find(n => n.tagName === 'H3').map(n => n.textContent);
    const t = ov.textContent;
    const d = FX['owner_overview.d14'].data;
    const tina = d.teachers.find(x => x.email === ACC.tina.email);
    const okk = tabs.join() === '帳號清單,查帳號,總覽' && before === 0 && JSON.stringify(w.calls('owner_overview')) === JSON.stringify([{ p_days: 14 }])
      && heads.join() === '老師,14 天內結束的使用權,試用快結束,既有帳號,最近的付款'
      && t.includes('方案 2 人，已用 3 人，到 ' + DATE(tina.status.plan_until)) && /超過名額 1 人/.test(t)
      && t.includes('寬限中') && t.includes('方案已過期') && t.includes('還沒有方案')
      && t.includes('Tina 早班') && t.includes('TESTTNAA')
      && t.includes('學生方案 贈送') && t.includes('到 ' + DATE(d.expiring[0].ends_at))
      && t.includes('試用到 ' + DAY(d.trials_ending[1].trial_until, d.server_now))
      && t.includes('收費上線前的帳號 4 個，其中當時是老師的 1 位') && t.includes('撤銷 2 段')
      && ov.byClass('ow-pay').length === 3 && t.includes('寫作批改 5 篇') && t.includes('650 元') && onlyOwnerRpcs(w);
    return { ok: okk, detail: JSON.stringify({ tabs, heads, t: t.slice(0, 400) }) };
  },
  '總覽:點 Email 進查帳號;讀不到時原樣顯示資料庫的訊息,重新整理再讀一次': async () => {
    const w = world(); const L = await area(w);
    w.next.owner_overview = ['error.not_owner'];
    await btn(L.el, '總覽').click(); await settle();
    const bad = L.el.byClass('ow-overview')[0].textContent;
    await btn(L.el.byClass('ow-overview')[0], '重新整理').click(); await settle();
    const mail = L.el.byClass('ow-overview')[0].find(n => n.tagName === 'BUTTON' && n.textContent === ACC.gwen.email)[0];
    await mail.click(); await settle();
    const okk = /只有站長可以執行這個動作/.test(bad) && w.calls('owner_overview').length === 2
      && w.calls('owner_lookup').pop().p_who === ACC.gwen.email && !L.el.byClass('ow-p-lookup')[0].hidden;
    return { ok: okk, detail: JSON.stringify({ bad: bad.slice(0, 80), look: w.calls('owner_lookup') }) };
  },

  /* ---------- 記一筆收款(九.3) ---------- */
  '記一筆收款:查帳號頁有按鈕;預設學生方案 1 個月 199 元、轉帳、今天;送出參數照資料庫;結果寫開始日與到期日;做完重讀': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.tom.email);
    const d = await openForm(L, '記一筆收款');
    const first = lines(d)[0];
    const amount0 = field(d, 'amount').value, paid0 = field(d, 'paidAt').value;
    await setVal(field(d, 'note'), '轉帳末五碼 12345');
    /* 錄下來的回覆把開始日寫死在 2026-10-22,過了那天這題就壞(10/23 發現)。這題要測「排在後面」,
       所以開始日改成從現在算 3 天後、30 天期,其他欄位照錄下來的 */
    const fut = clone(FX['owner_record_payment.student_in_trial'].data);
    const st0 = Date.now() + 3 * 864e5;
    fut.applied.starts_at = new Date(st0).toISOString();
    fut.applied.ends_at = new Date(st0 + 30 * 864e5).toISOString();
    w.next.owner_record_payment = [{ data: fut, error: null }];
    const n0 = w.calls('owner_lookup').length;
    await ok(d);
    const a = w.calls('owner_record_payment')[0];
    const res = dlg(L); const rl = lines(res);
    const ap = fut.applied;
    await ok(res);
    const reread = w.calls('owner_lookup').length === n0 + 1 && w.calls('owner_lookup').pop().p_who === ACC.tom.id;   // 重讀用帳號 id(E1 的做法)
    const okk = first === ACC.tom.email && amount0 === '199' && paid0 === tpToday()
      && JSON.stringify(a) === JSON.stringify({ p_request_key: 'key-1', p_who: ACC.tom.email, p_item: 'student', p_months: 1, p_seats: null, p_credits: null,
        p_amount: 199, p_method: 'bank', p_paid_at: null, p_starts_at: null, p_note: '轉帳末五碼 12345' })
      && rl.includes('使用期間 ' + DATE(ap.starts_at) + ' 到 ' + DATE(ap.ends_at) + '，排在他現在的使用權後面。') && rl.filter(x => x.includes(DATE(ap.starts_at))).length === 1
      && reread && /已記下收款/.test(lookMsg(L)) && onlyOwnerRpcs(w);
    return { ok: okk, detail: JSON.stringify({ first, amount0, paid0, a, rl }) };
  },
  '記一筆收款:送出編號在表單打開時產生;送出失敗重送用同一個;成功後下一次打開才換新的;取消再打開也是新的;重複送出寫已經記過': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.tom.email);
    const d = await openForm(L, '記一筆收款');
    w.next.owner_record_payment = [{ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }, 'owner_record_payment.duplicate'];
    await ok(d);
    const stillOpen = dlg(L) === d && /連不上雲端伺服器/.test(errOf(d));
    await ok(d);
    const keys1 = w.calls('owner_record_payment').map(a => a.p_request_key);
    const res = dlg(L); const rl = lines(res); const title = res.find(n => n.tagName === 'H2')[0].textContent;
    await ok(res); await settle();
    const d2 = await openForm(L, '記一筆收款'); await cancel(d2);
    const d3 = await openForm(L, '記一筆收款');
    w.next.owner_record_payment = ['owner_record_payment.credits'];
    await ok(d3);
    const keys = w.calls('owner_record_payment').map(a => a.p_request_key);
    const okk = stillOpen && keys1.join() === 'key-1,key-1' && title === '這筆已經記過了' && rl.some(x => /沒有再記一筆/.test(x))
      && keys.join() === 'key-1,key-1,key-3';
    return { ok: okk, detail: JSON.stringify({ keys, title, rl }) };
  },
  '記一筆收款:金額照 js/plans-config.js 預填(換項目、月數、名額、篇數會跟著換),自己改過就不再蓋掉': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.tina.email);
    const d = await openForm(L, '記一筆收款');
    const amt = () => field(d, 'amount').value;
    const seen = [];
    seen.push(d.find(n => n.tagName === 'INPUT' && n.attrs.name === 'item' && n.checked)[0].attrs.value);
    await btn(wrapOf(d, 'seats'), '30').click(); await settle(); seen.push(amt());
    await pick(radio(d, 'months', '12')); seen.push(amt());
    await pick(radio(d, 'item', 'student')); seen.push(amt());
    await pick(radio(d, 'months', '1')); seen.push(amt());
    await pick(radio(d, 'item', 'credits')); seen.push(amt());
    await setVal(field(d, 'credits'), '1'); seen.push(amt());
    await setVal(field(d, 'credits'), '3'); seen.push(amt());
    await setVal(field(d, 'amount'), '600');
    await setVal(field(d, 'credits'), '5'); seen.push(amt());
    const okk = seen.join() === 'teacher,890,8900,1990,199,650,150,,600';
    return { ok: okk, detail: seen.join() };
  },
  '記一筆收款:老師方案要填名額;篇數 1 到 100;金額要是整數;付款日不能在今天以後;都不送': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.tom.email);
    const d = await openForm(L, '記一筆收款');
    const errs = [];
    await pick(radio(d, 'item', 'teacher')); await setVal(field(d, 'seats'), '');
    await ok(d); errs.push(fieldErr(d, 'seats'));
    await setVal(field(d, 'seats'), '10');
    await setVal(field(d, 'amount'), '3 9 0'); await ok(d); errs.push(fieldErr(d, 'amount'));
    await setVal(field(d, 'amount'), '390');
    await setVal(field(d, 'paidAt'), tpDay(2)); await ok(d); errs.push(fieldErr(d, 'paidAt'));
    await setVal(field(d, 'paidAt'), tpToday());
    await pick(radio(d, 'item', 'credits')); await setVal(field(d, 'credits'), '101'); await ok(d); errs.push(fieldErr(d, 'credits'));
    const okk = w.calls('owner_record_payment').length === 0 && /名額/.test(errs[0]) && /金額/.test(errs[1]) && /付款日/.test(errs[2]) && /1 到 100/.test(errs[3]);
    return { ok: okk, detail: JSON.stringify(errs) };
  },
  '記一筆收款:付款日選以前的日子送那天中午(台北時間);老師方案送名額;結果寫班與邀請碼': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.gwen.email);
    const d = await openForm(L, '記一筆收款');
    await btn(wrapOf(d, 'seats'), '10').click(); await settle();
    await pick(radio(d, 'method', 'linepay'));
    const y = tpDay(-1);
    await setVal(field(d, 'paidAt'), y);
    w.next.owner_record_payment = ['owner_record_payment.teacher_renew_from_grace'];
    await ok(d);
    const a = w.calls('owner_record_payment')[0];
    const rl = lines(dlg(L));
    const okk = a.p_item === 'teacher' && a.p_seats === 10 && a.p_months === 1 && a.p_credits === null && a.p_amount === 390 && a.p_method === 'linepay'
      && a.p_paid_at === y + 'T12:00:00+08:00' && rl.some(x => x.includes('「Gwen 讀書會」') && x.includes('TESTGWEN'));
    return { ok: okk, detail: JSON.stringify({ a, rl }) };
  },
  '記一筆收款:選老師方案時寫出後果(學生會變成老師;被改成學生的人變回老師但停用的班不會恢復);寫作批改只送篇數': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.tom.email);
    const d = await openForm(L, '記一筆收款');
    const none = info(d, 'teacherNote');
    await pick(radio(d, 'item', 'teacher'));
    const tom = info(d, 'teacherNote');
    await cancel(d);
    await openLookup(L, ACC.ben.email);
    const e = await openForm(L, '記一筆收款');
    await pick(radio(e, 'item', 'teacher'));
    const ben = info(e, 'teacherNote');
    await pick(radio(e, 'item', 'credits'));
    w.next.owner_record_payment = ['owner_record_payment.credits'];
    await ok(e);
    const a = w.calls('owner_record_payment')[0];
    const rl = lines(dlg(L));
    const okk = none === '' && /變成老師/.test(tom) && /停用的班不會恢復/.test(ben) && /改角色/.test(ben)
      && a.p_item === 'credits' && a.p_credits === 5 && a.p_months === null && a.p_seats === null && a.p_amount === 650
      && rl.some(x => /加了 5 篇寫作批改/.test(x));
    return { ok: okk, detail: JSON.stringify({ tom, ben, a, rl }) };
  },
  '站長自己的帳號、讀取失敗的帳號,查帳號頁沒有記一筆收款、贈送、更正': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.owner.email);
    const names = detailOf(L).find(n => n.tagName === 'BUTTON').map(b => b.textContent);
    const okk = !names.includes('記一筆收款') && !names.includes('贈送') && !names.includes('更正寫作批改篇數');
    return { ok: okk, detail: names.join() };
  },

  /* ---------- 贈送(九.4) ---------- */
  '贈送學生方案:到期日空白是沒有期限(送 null),選日子送那天結束;原因寫進備註;做完重讀': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, 'EXPIRED.Eve@example.test'.toLowerCase());
    const d = await openForm(L, '贈送');
    const until0 = field(d, 'until').value;
    await setVal(field(d, 'note'), '補償');
    await setVal(field(d, 'until'), '2026-11-10');
    w.next.owner_grant_comp = ['owner_grant_comp.student_with_end'];
    await ok(d);
    const a = w.calls('owner_grant_comp')[0];
    const rl = lines(dlg(L)); await ok(dlg(L));
    const d2 = await openForm(L, '贈送');
    w.next.owner_grant_comp = ['owner_grant_comp.student_no_end'];
    await ok(d2);
    const b = w.calls('owner_grant_comp')[1];
    const okk = until0 === '' && JSON.stringify(a) === JSON.stringify({ p_request_key: 'key-1', p_who: ACC.eve.email, p_kind: 'student', p_seats: null, p_ends_at: '2026-11-10T23:59:59+08:00', p_starts_at: null, p_note: '補償' })
      && rl.some(x => /2026\/11\/10/.test(x)) && b.p_ends_at === null && b.p_note === null && b.p_request_key === 'key-2' && /已贈送/.test(lookMsg(L)) && onlyOwnerRpcs(w);
    return { ok: okk, detail: JSON.stringify({ until0, a, b, rl }) };
  },
  '贈送老師方案:名額空白是不限(送 null);學生(包括被改成學生的前老師)不能用贈送變成老師,寫要用改角色,不送': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.gwen.email);
    const d = await openForm(L, '贈送');
    const kind0 = d.find(n => n.tagName === 'INPUT' && n.attrs.name === 'kind' && n.checked)[0].attrs.value;
    w.next.owner_grant_comp = ['owner_grant_comp.teacher_unlimited'];
    await ok(d);
    const a = w.calls('owner_grant_comp')[0];
    const rl = lines(dlg(L)); await ok(dlg(L));
    await openLookup(L, ACC.ben.email);
    const e = await openForm(L, '贈送');
    await pick(radio(e, 'kind', 'teacher'));
    await ok(e);
    const bad = fieldErr(e, 'kind');
    const okk = kind0 === 'teacher' && a.p_kind === 'teacher' && a.p_seats === null && a.p_ends_at === null
      && rl.some(x => x.includes('TESTGNAA')) && /改角色/.test(bad) && w.calls('owner_grant_comp').length === 1;
    return { ok: okk, detail: JSON.stringify({ kind0, a, rl, bad }) };
  },
  '贈送:他在站長的班上時寫出已經免費;資料庫擋下時視窗不關、訊息原樣顯示': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.ben.email);
    const d = await openForm(L, '贈送');
    const inOwner = info(d, 'ownerClass');
    w.next.owner_grant_comp = ['error.grant_comp_end_before_start'];
    await ok(d);
    const okk = /妳的班/.test(inOwner) && dlg(L) === d && /到期日要晚於開始日/.test(errOf(d));
    return { ok: okk, detail: JSON.stringify({ inOwner, err: errOf(d) }) };
  },

  /* ---------- 更正寫作批改篇數(九.5) ---------- */
  '更正:一定要寫原因;減到負的不送;第一次按寫出更正後剩幾篇,第二次才送;結果寫剩幾篇': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.pam.email);
    const d = await openForm(L, '更正寫作批改篇數');
    await pick(radio(d, 'dir', 'minus'));
    await setVal(field(d, 'count'), '1');
    await ok(d);
    const noReason = fieldErr(d, 'note');
    await setVal(field(d, 'note'), '多記一篇');
    await setVal(field(d, 'count'), '9');
    await ok(d);
    const tooMany = fieldErr(d, 'count');
    await setVal(field(d, 'count'), '1');
    w.next.owner_adjust_credits = ['owner_adjust_credits.minus'];
    await ok(d);
    const armed = w.calls('owner_adjust_credits').length === 0 ? d.byClass('ow-ok')[0].textContent : '';
    await ok(d);
    const a = w.calls('owner_adjust_credits');
    const okk = /原因/.test(noReason) && /剩 5 篇/.test(tooMany) && armed === '更正後剩 4 篇，再按一次確定'
      && a.length === 1 && JSON.stringify(a[0]) === JSON.stringify({ p_request_key: 'key-1', p_who: ACC.pam.email, p_delta: -1, p_note: '多記一篇' })
      && /已更正，剩 5 篇/.test(lookMsg(L));
    return { ok: okk, detail: JSON.stringify({ noReason, tooMany, armed, a, msg: lookMsg(L) }) };
  },
  '更正:結果讀資料庫回的 balance(以前只回一個數字,也讀得懂),寫已更正剩 N 篇;兩個都沒有只寫已更正': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.pam.email);
    const go = async reply => {
      const d = await openForm(L, '更正寫作批改篇數');
      await setVal(field(d, 'note'), '補發');
      w.next.owner_adjust_credits = [reply];
      await ok(d); await ok(d); await settle();
      return lookMsg(L);
    };
    const m1 = await go('owner_adjust_credits.plus');
    const m2 = await go({ data: 7, error: null });
    const m3 = await go({ data: { ledger_id: 9, duplicate: false }, error: null });
    const okk = m1.includes('已更正，剩 ' + FX['owner_adjust_credits.plus'].data.balance + ' 篇。') && m2.includes('已更正，剩 7 篇。')
      && m3.includes('已更正。') && !/剩/.test(m3) && w.calls('owner_adjust_credits').length === 3;
    return { ok: okk, detail: JSON.stringify([m1, m2, m3]) };
  },
  '資料庫寫「點數」的錯誤訊息換成「篇」;其他訊息原樣': async () => {
    const w = world(); const L = await area(w);
    const m = L.O.billing.messageOf;
    const a = m(FX['error.consume_duplicate'].error.message), b = m(FX['error.consume_insufficient'].error.message);
    const c = m(FX['error.adjust_negative_result'].error.message), e = m(FX['error.adjust_no_note'].error.message);
    const f = m(FX['error.record_credits_range'].error.message), g = m(FX['error.record_unknown_user'].error.message);
    const okk = ![a, b, c, e, f].some(x => /點數/.test(x)) && /已經扣過/.test(a) && /剩 0 篇/.test(b) && /剩 5 篇/.test(c) && /原因/.test(e) && /1 到 100/.test(f)
      && g === FX['error.record_unknown_user'].error.message;
    return { ok: okk, detail: JSON.stringify([a, b, c, e, f, g]) };
  },

  /* ---------- 學生詳情的寫作批改 ---------- */
  '學生詳情:站長模式每篇有內容的作文一個「批改完成，扣 1 篇」;打開時讀他剩幾篇;ref 是 writing_<級>:<題目>:<內容 SHA-256 前 12 碼>;扣過的那一顆不能再按;這台不知道扣過時資料庫擋下,錯誤寫在視窗裡,關掉後標成扣過': async () => {
    const w = world();
    const A = loadAdmin(w, { paid: true, rows: pamRows() }); await settle();
    const before = w.calls('owner_lookup').length;
    const box = await openPam(A);
    const items = box ? box.byClass('ow-wr-item') : [];
    const t = box ? box.textContent : '';
    const look = w.calls('owner_lookup').slice(before);
    const b = items.find(x => /回信任務 1/.test(x.textContent));
    await btn(b, '批改完成，扣 1 篇').click(); await settle(); await K.wait(40); await settle();
    const d = A.ctx.document.body.byClass('ow-dialog').pop();
    const l = lines(d);
    w.next.owner_consume_credit = ['owner_consume_credit.ok', 'error.consume_duplicate'];
    await ok(d);
    const a = w.calls('owner_consume_credit')[0];
    const after = box.textContent;
    const eb = btn(b, '批改完成，扣 1 篇');
    const disabledAfter = eb.disabled;
    await eb.click(); await settle(); await K.wait(40); await settle();
    const noDialog = A.ctx.document.body.byClass('ow-dialog').length === 0;
    const bItem = items.find(x => /造句挑戰 3/.test(x.textContent));
    await btn(bItem, '批改完成，扣 1 篇').click(); await settle(); await K.wait(40); await settle();
    const d2 = A.ctx.document.body.byClass('ow-dialog').pop();
    await ok(d2);
    const dup = errOf(d2);
    await cancel(d2);
    const bMarked = /這個版本已經扣過/.test(bItem.textContent) && btn(bItem, '批改完成，扣 1 篇').disabled;
    const okk = items.length === 2 && before === 0 && look.length === 1 && look[0].p_who === ACC.pam.id && /寫作批改剩 5 篇/.test(t)
      && l[0] === ACC.pam.email && l.some(x => /同一個版本只能扣一次/.test(x))
      && JSON.stringify(a) === JSON.stringify({ p_who: ACC.pam.id, p_ref: 'writing_e:w2-e-01:' + sha12(ESSAY_E), p_note: null })
      && /已扣 1 篇，剩 4 篇/.test(after) && disabledAfter && noDialog && w.calls('owner_consume_credit').length === 2
      && /已經扣過/.test(dup) && !/點數/.test(dup) && bMarked && onlyOwnerRpcs(w);
    return { ok: okk, detail: JSON.stringify({ n: items.length, look, a, after: after.slice(0, 200), dup }) };
  },
  '學生詳情:已經扣過的版本標出來(看查帳號的批改紀錄);PAID_UI 沒開或不是站長沒有寫作批改': async () => {
    const w = world();
    const pam = clone(FX['owner_lookup.paid_with_credits'].data);
    pam.credit_log.push({ id: 99, user_id: ACC.pam.id, delta: -1, reason: 'correction', ref: 'writing_b:w1-b-03:' + sha12(ESSAY_B), created_at: pam.access.server_now });
    w.lookups[ACC.pam.id] = pam;
    const A = loadAdmin(w, { paid: true, rows: pamRows() }); await settle();
    const box = await openPam(A);
    const done = box.byClass('ow-wr-item').find(x => /造句挑戰 3/.test(x.textContent)).textContent;
    const fresh = box.byClass('ow-wr-item').find(x => /回信任務 1/.test(x.textContent)).textContent;
    const w2 = world();
    const B = loadAdmin(w2, { paid: false, rows: pamRows() }); await settle();
    const nb = await openPam(B);
    const w3 = world();
    const C = loadAdmin(w3, { paid: true, rows: pamRows(), access: clone(FX['owner_lookup.teacher_over_seats'].data.access) }); await settle();
    const nc = await openPam(C);
    const okk = /這個版本已經扣過/.test(done) && !/已經扣過/.test(fresh) && nb === null && w2.rpcs.length === 0 && !/批改完成/.test(B.root.textContent)
      && nc === null && !w3.rpcs.some(r => r[0] === 'owner_lookup' || r[0] === 'owner_consume_credit');
    return { ok: okk, detail: JSON.stringify({ done, fresh }) };
  },

  /* ---------- 下載全部備份(九.6) ---------- */
  'PAID_UI 沒開:下載全部備份跟以前一樣(version 1,欄位與順序不變),不呼叫 owner_export,沒有多的說明': async () => {
    const w = world();
    const A = loadAdmin(w, { paid: false }); await settle();
    const b = A.root.find(n => n.tagName === 'BUTTON' && /^下載全部備份/.test(n.textContent))[0];
    await b.click(); await settle();
    const p = JSON.parse(A.ctx.blobs[0]);
    const okk = A.ctx.blobs.length === 1 && Object.keys(p).join() === 'app,version,exported,by,rows' && p.app === 'shuashua-progress-backup' && p.version === 1
      && p.by === ACC.owner.email && JSON.stringify(p.rows) === JSON.stringify(w.progressRows) && w.rpcs.length === 0
      && !/SQL Editor/.test(A.root.textContent);
    return { ok: okk, detail: JSON.stringify({ keys: Object.keys(p), rpcs: w.rpcs }) };
  },
  '站長模式:下載全部備份也呼叫 owner_export 與 owner_export_gateway,存成 version 2(rows 加 paid、gateway);按鈕旁寫只含她看得到的學生、完整備份用 SQL Editor': async () => {
    const w = world();
    w.next.owner_export_gateway = [{ data: clone(GW), error: null }];
    const A = loadAdmin(w, { paid: true }); await settle();
    const ps = A.root.byClass('ow-students')[0];
    const note = ps.children[0].textContent;
    const b = A.root.find(n => n.tagName === 'BUTTON' && /^下載全部備份/.test(n.textContent))[0];
    await b.click(); await settle();
    const p = JSON.parse(A.ctx.blobs[0]);
    const msg = A.root.byClass('ow-students')[0].byClass('ow-msg')[0];
    const okk = A.ctx.blobs.length === 1 && Object.keys(p).join() === 'app,version,exported,by,rows,paid,gateway' && p.version === 2
      && JSON.stringify(p.rows) === JSON.stringify(w.progressRows) && JSON.stringify(p.paid) === JSON.stringify(FX['owner_export.after_writes'].data)
      && JSON.stringify(p.gateway) === JSON.stringify(GW)
      && JSON.stringify(w.calls('owner_export')) === JSON.stringify([{}]) && JSON.stringify(w.calls('owner_export_gateway')) === JSON.stringify([{}])
      && /妳班上的人/.test(note) && /SQL Editor/.test(note) && onlyOwnerRpcs(w)
      && /金流紀錄/.test(msg.textContent) && !/沒有存到/.test(msg.textContent) && /ok/.test(msg.className);
    return { ok: okk, detail: JSON.stringify({ keys: Object.keys(p), note, msg: msg.textContent }) };
  },
  '站長模式:owner_export_gateway 讀不到(還沒裝或出錯)時,照樣存學生進度與收費資料(version 2),並寫出金流紀錄沒有存到與原因': async () => {
    const w = world();
    w.next.owner_export_gateway = ['error.not_owner'];
    const A = loadAdmin(w, { paid: true }); await settle();
    const b = A.root.find(n => n.tagName === 'BUTTON' && /^下載全部備份/.test(n.textContent))[0];
    await b.click(); await settle();
    const p = JSON.parse(A.ctx.blobs[0]);
    const msg = A.root.byClass('ow-students')[0].byClass('ow-msg')[0];
    const okk = A.ctx.blobs.length === 1 && p.version === 2 && Object.keys(p).join() === 'app,version,exported,by,rows,paid'
      && /金流紀錄沒有存到/.test(msg.textContent) && /只有站長可以執行這個動作/.test(msg.textContent) && /bad/.test(msg.className);
    return { ok: okk, detail: JSON.stringify({ keys: Object.keys(p), msg: msg.textContent }) };
  },
  '站長模式:owner_export_gateway 一直沒回時,時間到照樣存學生進度與收費資料,寫金流紀錄沒有存到;晚到的回覆不再存': async () => {
    const w = world();
    const release = w.hold('owner_export_gateway', { data: clone(GW), error: null });
    const A = loadAdmin(w, { paid: true }); await settle();
    A.ctx.ADMIN_OWNER.billing.waitMs = 30;
    const b = A.root.find(n => n.tagName === 'BUTTON' && /^下載全部備份/.test(n.textContent))[0];
    b.click(); await settle();
    await K.wait(60); await settle();
    const p = JSON.parse(A.ctx.blobs[0] || '{}');
    const msg = A.root.byClass('ow-students')[0].byClass('ow-msg')[0].textContent;
    release(); await settle();
    const okk = A.ctx.blobs.length === 1 && p.version === 2 && !('gateway' in p) && /金流紀錄沒有存到/.test(msg) && /太久/.test(msg)
      && b.disabled === false && w.calls('owner_export_gateway').length === 1;
    return { ok: okk, detail: JSON.stringify({ keys: Object.keys(p), msg, n: A.ctx.blobs.length }) };
  },
  '站長模式:owner_export 讀不到時照樣存學生進度(version 1),並寫出收費資料沒有存到與原因': async () => {
    const w = world();
    w.next.owner_export = ['error.not_owner'];
    const A = loadAdmin(w, { paid: true }); await settle();
    const b = A.root.find(n => n.tagName === 'BUTTON' && /^下載全部備份/.test(n.textContent))[0];
    await b.click(); await settle();
    const p = JSON.parse(A.ctx.blobs[0]);
    const t = A.root.byClass('ow-students')[0].textContent;
    const okk = p.version === 1 && Object.keys(p).join() === 'app,version,exported,by,rows' && /收費資料沒有存到/.test(t) && /只有站長可以執行這個動作/.test(t);
    return { ok: okk, detail: JSON.stringify({ keys: Object.keys(p), t: t.slice(0, 200) }) };
  },

  /* ---------- 審查修正(E2) ---------- */
  '記一筆收款:網路斷掉沒收到結果,取消再打開沿用同一個送出編號並寫出來;取消後重讀這個帳號;編號一個帳號一個;收到結果(成功或已經記過)才換新的': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.tom.email);
    const d = await openForm(L, '記一筆收款');
    const fresh = lines(d).length;
    w.next.owner_record_payment = [NET];
    await ok(d);
    const err1 = errOf(d);
    const n0 = w.calls('owner_lookup').length;
    await cancel(d); await settle();
    const reread = w.calls('owner_lookup').length === n0 + 1 && w.calls('owner_lookup').pop().p_who === ACC.tom.id;
    const msg1 = lookMsg(L);
    await openLookup(L, ACC.gwen.email);
    const g = await openForm(L, '記一筆收款'); const gl = lines(g); await cancel(g);
    await openLookup(L, ACC.tom.email);
    const d2 = await openForm(L, '記一筆收款');
    const l2 = lines(d2);
    w.next.owner_record_payment = ['owner_record_payment.duplicate'];
    await ok(d2);
    const res = dlg(L); const title = res.find(n => n.tagName === 'H2')[0].textContent; await ok(res); await settle();
    const d3 = await openForm(L, '記一筆收款');
    const l3 = lines(d3);
    w.next.owner_record_payment = ['owner_record_payment.student_in_trial'];
    await ok(d3); await ok(dlg(L));
    const d4 = await openForm(L, '記一筆收款'); await cancel(d4);
    const keys = w.calls('owner_record_payment').map(a => a.p_request_key);
    const okk = fresh === 1 && /不確定這筆有沒有記下/.test(err1) && /不會記兩筆/.test(err1) && reread && /付款/.test(msg1)
      && gl.length === 1 && l2.some(x => /上一次送出沒有收到結果/.test(x)) && title === '這筆已經記過了' && l3.length === 1
      && keys.join() === 'key-1,key-1,key-3' && L.ctx.uuidN === 4;
    return { ok: okk, detail: JSON.stringify({ err1, msg1, l2, l3, keys, n: L.ctx.uuidN }) };
  },
  '記一筆收款:資料庫擋下(不是網路)的錯誤沒有記下任何東西,取消再打開是新的編號,不寫上一次沒收到結果,不重讀': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.tom.email);
    const d = await openForm(L, '記一筆收款');
    w.next.owner_record_payment = ['error.record_bad_amount'];
    await ok(d);
    const err = errOf(d);
    const n0 = w.calls('owner_lookup').length;
    await cancel(d);
    const d2 = await openForm(L, '記一筆收款');
    const l2 = lines(d2);
    w.next.owner_record_payment = ['owner_record_payment.student_in_trial'];
    await ok(d2);
    const keys = w.calls('owner_record_payment').map(a => a.p_request_key);
    const okk = err === '金額不對。' && w.calls('owner_lookup').length >= n0 && l2.length === 1 && keys.join() === 'key-1,key-2';
    return { ok: okk, detail: JSON.stringify({ err, l2, keys }) };
  },
  '記一筆收款的老師方案:前老師寫出停用的班還有幾位學生(讀得到進度、算名額),填的名額被佔滿時提醒;在別位老師班上的寫出備註會被看到;結果畫面再寫一次': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.tom.email);
    const t = await openForm(L, '記一筆收款');
    await pick(radio(t, 'item', 'teacher'));
    const tom = [info(t, 'oldMembers'), info(t, 'otherTeachers')];
    await cancel(t);
    await openLookup(L, ACC.ben.email);
    const e = await openForm(L, '記一筆收款');
    await pick(radio(e, 'item', 'teacher'));
    await btn(wrapOf(e, 'seats'), '10').click(); await settle();
    const old10 = info(e, 'oldMembers'), other = info(e, 'otherTeachers');
    await setVal(field(e, 'seats'), '1');
    const old1 = info(e, 'oldMembers');
    await setVal(field(e, 'seats'), '10');
    const reply = clone(FX['owner_record_payment.teacher_renew_from_grace'].data);
    reply.applied.class = { code: 'TESTBENN', name: '週三英文班', active: false, class_id: 'x' };
    w.next.owner_record_payment = [{ data: reply, error: null }];
    await ok(e);
    const r = dlg(L); const rw = warns(r);
    const okk = tom.join('') === '' && /停用的班還有 1 位學生/.test(old10) && /讀得到他們的進度/.test(old10) && /算在名額/.test(old10) && !/佔滿/.test(old10)
      && /佔滿/.test(old1) && /新的學生加不進來/.test(old1)
      && /「Gwen 讀書會」/.test(other) && /備註/.test(other) && /移出/.test(other) && !/刷刷英文/.test(other)
      && rw.some(x => /停用的班還有 1 位學生/.test(x)) && rw.some(x => /仍是停用的/.test(x));
    return { ok: okk, detail: JSON.stringify({ tom, old10, old1, other, rw }) };
  },
  /* ---------- 贈送、更正的送出編號(2026-10-12 資料庫加了 p_request_key,做法跟記一筆收款一樣) ---------- */
  '贈送:送出編號在表單打開時產生;連不上時視窗不關,在同一個視窗再按用同一個編號;成功後下一次打開換新的': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.pam.email);
    const d = await openForm(L, '贈送');
    w.next.owner_grant_comp = [NET, 'owner_grant_comp.student_no_end'];
    await ok(d);
    const stillOpen = dlg(L) === d, err1 = errOf(d);
    await ok(d);
    const res = dlg(L); const title = res.find(n => n.tagName === 'H2')[0].textContent;
    await ok(res); await settle();
    const d2 = await openForm(L, '贈送'); const l2 = lines(d2);
    w.next.owner_grant_comp = ['owner_grant_comp.student_no_end'];
    await ok(d2); await ok(dlg(L)); await settle();
    const keys = w.calls('owner_grant_comp').map(a => a.p_request_key);
    const okk = stillOpen && /不確定/.test(err1) && /不會送兩次/.test(err1) && title === '已贈送' && l2.length === 1
      && keys.join() === 'key-1,key-1,key-2' && L.ctx.uuidN === 2;
    return { ok: okk, detail: JSON.stringify({ err1, title, l2, keys, n: L.ctx.uuidN }) };
  },
  '贈送:連不上又取消時重讀這個帳號、寫先核對;同一個帳號再打開沿用編號並寫出來,別的帳號是新的;資料庫回已經送過時寫出來,之後換新的': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.pam.email);
    const d = await openForm(L, '贈送');
    w.next.owner_grant_comp = [NET];
    await ok(d);
    const n0 = w.calls('owner_lookup').length;
    await cancel(d); await settle();
    const reread = w.calls('owner_lookup').length === n0 + 1 && w.calls('owner_lookup').pop().p_who === ACC.pam.id;
    const msg1 = lookMsg(L);
    await openLookup(L, ACC.gwen.email);
    const g = await openForm(L, '贈送'); const gl = lines(g); await cancel(g);
    await openLookup(L, ACC.pam.email);
    const d2 = await openForm(L, '贈送'); const l2 = lines(d2);
    w.next.owner_grant_comp = ['owner_grant_comp.duplicate'];
    await ok(d2);
    const res = dlg(L); const title = res.find(n => n.tagName === 'H2')[0].textContent; const rl = lines(res);
    await ok(res); await settle();
    const msg2 = lookMsg(L);
    const d3 = await openForm(L, '贈送'); const l3 = lines(d3); await cancel(d3);
    const keys = w.calls('owner_grant_comp').map(a => a.p_request_key);
    const okk = reread && /不確定/.test(msg1) && /使用權/.test(msg1) && gl.length === 1 && l2[0] === ACC.pam.email
      && l2.some(x => /上一次送出沒有收到結果/.test(x)) && title === '已經贈送過了' && rl.some(x => /沒有再贈送/.test(x)) && /之前已經送出過/.test(msg2)
      && l3.length === 1 && keys.join() === 'key-1,key-1' && L.ctx.uuidN === 3;
    return { ok: okk, detail: JSON.stringify({ msg1, gl, l2, title, rl, msg2, l3, keys, n: L.ctx.uuidN }) };
  },
  '贈送:沿用的編號送出後被擋下(不是網路),不能證明上一次沒送到(登入過期、閘道錯誤也長這樣);再打開照樣沿用編號、寫上一次沒收到結果': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.pam.email);
    const d = await openForm(L, '贈送');
    w.next.owner_grant_comp = [NET];
    await ok(d); await cancel(d); await settle();
    const d2 = await openForm(L, '贈送');
    w.next.owner_grant_comp = ['error.grant_comp_end_before_start'];
    await ok(d2);
    const err = errOf(d2);
    const n0 = w.calls('owner_lookup').length;
    await cancel(d2); await settle();
    const n1 = w.calls('owner_lookup').length;
    const d3 = await openForm(L, '贈送'); const l3 = lines(d3);
    w.next.owner_grant_comp = ['owner_grant_comp.student_no_end'];
    await ok(d3);
    const keys = w.calls('owner_grant_comp').map(a => a.p_request_key);
    const okk = /到期日要晚於開始日/.test(err) && n1 === n0 && l3.some(x => /上一次送出沒有收到結果/.test(x)) && keys.join() === 'key-1,key-1,key-1';
    return { ok: okk, detail: JSON.stringify({ err, n0, n1, l3, keys }) };
  },
  '更正:送出編號跟記一筆收款一樣;連不上時視窗不關、再確定一次用同一個編號;取消後重讀,再打開沿用並寫出來、用新的篇數;資料庫回已經記過時寫出來;成功後換新的': async () => {
    const w = world(); const L = await area(w);
    await openLookup(L, ACC.pam.email);
    const d = await openForm(L, '更正寫作批改篇數');
    await setVal(field(d, 'note'), '記錯了');
    w.next.owner_adjust_credits = [NET, NET];
    await ok(d); const armed = d.byClass('ow-ok')[0].textContent; await ok(d);
    const open1 = dlg(L) === d, err1 = errOf(d);
    await ok(d); await ok(d);
    const open2 = dlg(L) === d;
    const pam6 = clone(FX['owner_lookup.paid_with_credits'].data); pam6.access.credits = 6;
    w.lookups[ACC.pam.id] = pam6;
    const n0 = w.calls('owner_lookup').length;
    await cancel(d); await settle();
    const reread = w.calls('owner_lookup').length === n0 + 1;
    const msg1 = lookMsg(L);
    const d2 = await openForm(L, '更正寫作批改篇數'); const l2 = lines(d2);
    await setVal(field(d2, 'note'), '記錯了');
    w.next.owner_adjust_credits = ['owner_adjust_credits.duplicate'];
    await ok(d2); await ok(d2); await settle();
    const msg2 = lookMsg(L);
    const d3 = await openForm(L, '更正寫作批改篇數'); const l3 = lines(d3);
    await setVal(field(d3, 'note'), '補發');
    w.next.owner_adjust_credits = ['owner_adjust_credits.plus'];
    await ok(d3); await ok(d3); await settle();
    const keys = w.calls('owner_adjust_credits').map(a => a.p_request_key);
    const okk = armed === '更正後剩 6 篇，再按一次確定' && open1 && /不確定/.test(err1) && /不會記兩次/.test(err1) && open2
      && reread && /不確定/.test(msg1) && /寫作批改紀錄/.test(msg1)
      && l2[0] === ACC.pam.email && l2.includes('寫作批改現在剩 6 篇。') && l2.some(x => /上一次送出沒有收到結果/.test(x))
      && /之前已經記過/.test(msg2) && !l3.some(x => /上一次/.test(x)) && /已更正，剩 6 篇/.test(lookMsg(L))
      && keys.join() === 'key-1,key-1,key-1,key-2' && L.ctx.uuidN === 2;
    return { ok: okk, detail: JSON.stringify({ armed, err1, msg1, l2, msg2, l3, keys, n: L.ctx.uuidN }) };
  },
  '總覽:14 天內結束的使用權照資料庫的 expiring 列(接上續約的不列由資料庫決定,前端不另外篩),標題不變': async () => {
    const w = world(); const L = await area(w);
    w.next.owner_overview = ['owner_overview.renewed_not_expiring'];
    await btn(L.el, '總覽').click(); await settle();
    const ov = L.el.byClass('ow-overview')[0];
    const sec = ov.find(n => n.tagName === 'SECTION' && n.children[0].textContent === '14 天內結束的使用權')[0];
    const e = FX['owner_overview.renewed_not_expiring'].data.expiring;
    const gone = FX['owner_overview.d14'].data.expiring.map(g => g.email).filter(m => !e.some(x => x.email === m));
    const okk = !!sec && sec.byClass('ow-item').length === e.length && e.every(g => sec.textContent.includes(g.email))
      && gone.length > 0 && gone.every(m => !sec.textContent.includes(m));
    return { ok: okk, detail: JSON.stringify({ e: e.map(g => g.email), gone }) };
  },
  '學生詳情的寫作批改:題目寫學生看到的名稱;長的作文可以看全文;帳號用查帳號讀到的 Email(不用進度裡的 _meta);讀到以前與扣過的版本不能按;剩 0 篇不能按': async () => {
    const w = world();
    const long = Array.from({ length: 90 }, (_, i) => 'word' + i).join(' ') + ' THE-END';
    const rows = pamRows();
    rows[0] = { user_id: ACC.pam.id, k: '_meta', v: { name: 'Pam', email: 'someone.else@example.test' }, updated_at: rows[0].updated_at };
    rows.push({ user_id: ACC.pam.id, k: 'writing_y', v: { 'w3-e-02': { text: long } }, updated_at: rows[0].updated_at });
    const pam = clone(FX['owner_lookup.paid_with_credits'].data);
    pam.credit_log.push({ id: 98, user_id: ACC.pam.id, delta: -1, reason: 'correction', ref: 'writing_b:w1-b-03:' + sha12(ESSAY_B), created_at: pam.access.server_now });
    const release = w.hold('owner_lookup', { data: pam, error: null });
    const A = loadAdmin(w, { paid: true, rows: rows.filter(r => r.k !== 'writing_y' || r.v['w3-e-02']) }); await settle();
    const box = await openPam(A);
    const bs = () => box.byClass('ow-wr-item').map(li => li.find(n => n.tagName === 'BUTTON' && /扣 1 篇/.test(n.textContent))[0].disabled);
    const loading = bs();
    release(); await settle(); await K.wait(40); await settle();
    const labels = box.byClass('ow-wr-item').map(li => li.byClass('ow-item-text')[0].textContent);
    const after = bs();
    const lit = box.byClass('ow-wr-item').find(x => /論述寫作 2/.test(x.textContent));
    const det = lit.find(n => n.tagName === 'DETAILS')[0];
    const shortHas = box.byClass('ow-wr-item').find(x => /回信任務 1/.test(x.textContent)).find(n => n.tagName === 'DETAILS').length;
    const eItem = box.byClass('ow-wr-item').find(x => /回信任務 1/.test(x.textContent));
    await btn(eItem, '批改完成，扣 1 篇').click(); await settle(); await K.wait(40); await settle();
    const dl = lines(A.ctx.document.body.byClass('ow-dialog').pop());
    await cancel(A.ctx.document.body.byClass('ow-dialog').pop());
    const w0 = world();
    const zero = clone(FX['owner_lookup.paid_with_credits'].data); zero.access.credits = 0;
    w0.lookups[ACC.pam.id] = zero;
    const Z = loadAdmin(w0, { paid: true, rows: pamRows() }); await settle();
    const zb = await openPam(Z);
    const zDis = zb.byClass('ow-wr-item').map(li => li.find(n => n.tagName === 'BUTTON' && /扣 1 篇/.test(n.textContent))[0].disabled);
    const okk = loading.every(Boolean) && labels.join() === '造句挑戰 3,回信任務 1,論述寫作 2' && JSON.stringify(after) === '[true,false,false]'
      && det && /THE-END/.test(det.textContent) && /看全文/.test(det.textContent) && shortHas === 0
      && dl[0] === ACC.pam.email && !dl.some(x => /someone\.else/.test(x))
      && zDis.every(Boolean) && /寫作批改剩 0 篇/.test(zb.textContent);
    return { ok: okk, detail: JSON.stringify({ loading, labels, after, dl, zDis }) };
  },
  '學生詳情的寫作批改:讀不到剩幾篇時有重新讀取;扣完以後那一顆不能再按,查帳號換到同一個人時重讀': async () => {
    const w = world();
    const A = loadAdmin(w, { paid: true, rows: pamRows() }); await settle();
    const tab = t => A.root.find(n => n.tagName === 'BUTTON' && n.attrs.role === 'tab' && n.textContent === t)[0];
    await tab('收費管理').click(); await settle();
    await tab('查帳號').click(); await settle();
    const lk = A.root.byClass('ow-lookup')[0];
    await setVal(field(lk, 'who'), ACC.pam.email);
    await lk.byClass('ow-lookup-form')[0].fire('submit'); await settle();
    await tab('學生進度').click(); await settle();
    w.next.owner_lookup = [NET];
    const box = await openPam(A);
    const bad = box.byClass('ow-wr-bal')[0].textContent;
    const again = btn(box, '重新讀取');
    await again.click(); await settle(); await K.wait(40); await settle();
    const n1 = w.calls('owner_lookup').length;
    const bal2 = box.byClass('ow-wr-bal')[0].textContent;
    const eItem = box.byClass('ow-wr-item').find(x => /回信任務 1/.test(x.textContent));
    const b = btn(eItem, '批改完成，扣 1 篇');
    await b.click(); await settle(); await K.wait(40); await settle();
    w.next.owner_consume_credit = ['owner_consume_credit.ok'];
    await ok(A.ctx.document.body.byClass('ow-dialog').pop());
    const done = b.disabled;
    const n2 = w.calls('owner_lookup').length;
    await tab('收費管理').click(); await settle();
    const re = w.calls('owner_lookup').slice(n2);
    const okk = /讀不到他剩幾篇/.test(bad) && !!again && n1 === 3 && /寫作批改剩 5 篇/.test(bal2)
      && done && re.length === 1 && re[0].p_who === ACC.pam.id;
    return { ok: okk, detail: JSON.stringify({ bad, n1, done, re }) };
  },
  '帳號清單做完一件事(移出)以後,總覽與查帳號下一次打開會重讀': async () => {
    const w = world(); const L = await area(w);
    await btn(L.el, '總覽').click(); await settle();
    L.a.lookup(ACC.pam.email); await settle();
    const nl = w.calls('owner_lookup').length;
    await btn(L.el, '帳號清單').click(); await settle();
    await btn(K.rowOf(L, 'cole'), '移出').click(); await settle();
    w.next.owner_move_member = [{ data: Object.assign(clone(FX['owner_move_member.leave'].data), { email: ACC.cole.email }), error: null }];
    await ok(dlg(L));
    await btn(L.el, '總覽').click(); await settle();
    await btn(L.el, '查帳號').click(); await settle();
    const okk = w.calls('owner_overview').length === 2 && w.calls('owner_lookup').length === nl + 1 && w.calls('owner_lookup').pop().p_who === ACC.pam.id;
    return { ok: okk, detail: JSON.stringify({ ov: w.calls('owner_overview').length, look: w.calls('owner_lookup').slice(nl) }) };
  },
  '站長模式的備份:owner_export 一直沒回時,按鈕不能按、寫正在準備;時間到就照樣存學生進度(version 1)並寫收費資料沒有存到;晚到的回覆不再存': async () => {
    const w = world();
    const release = w.hold('owner_export', { data: clone(FX['owner_export.after_writes'].data), error: null });
    const A = loadAdmin(w, { paid: true }); await settle();
    A.ctx.ADMIN_OWNER.billing.waitMs = 30;
    const b = A.root.find(n => n.tagName === 'BUTTON' && /^下載全部備份/.test(n.textContent))[0];
    b.click(); await settle();
    const busy = b.disabled === true, waitMsg = A.root.byClass('ow-students')[0].byClass('ow-msg')[0].textContent, saved0 = A.ctx.blobs.length;
    await b.click(); await settle();
    await K.wait(60); await settle();
    const p = JSON.parse(A.ctx.blobs[0] || '{}');
    const failMsg = A.root.byClass('ow-students')[0].byClass('ow-msg')[0].textContent;
    release(); await settle();
    const okk = busy && /準備/.test(waitMsg) && saved0 === 0 && A.ctx.blobs.length === 1 && p.version === 1 && Object.keys(p).join() === 'app,version,exported,by,rows'
      && /收費資料沒有存到/.test(failMsg) && b.disabled === false && w.calls('owner_export').length === 1;
    return { ok: okk, detail: JSON.stringify({ busy, waitMsg, failMsg, n: A.ctx.blobs.length }) };
  },
  '題目名稱跟寫作頁一樣:data/writing.js 的造句、回信、論述照順序是 w1-b-NN、w2-e-NN、w3-e-NN': () => {
    const vm = require('vm'); const fs = require('fs'); const path = require('path');
    const ctx = { window: {} }; ctx.TOEIC = ctx.window.TOEIC = {}; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(K.REPO, 'data/writing.js'), 'utf8').replace(/^window\.TOEIC = window\.TOEIC \|\| \{\};/, ''), ctx);
    const W = ctx.TOEIC.writing;
    const pad = i => (i < 9 ? '0' : '') + (i + 1);
    const okk = W.l1.build.every((b, i) => b.id === 'w1-b-' + pad(i)) && W.l2.emails.every((e, i) => e.id === 'w2-e-' + pad(i)) && W.l3.essays.every((e, i) => e.id === 'w3-e-' + pad(i));
    return { ok: okk, detail: [W.l1.build.length, W.l2.emails.length, W.l3.essays.length].join() };
  },

  /* ---------- 文案與檔案 ---------- */
  '文案:新檔與 admin.js 的字串沒有點數、儲值;沒有破折號、emoji;中文旁的標點是全形': () => {
    const fs = require('fs'); const path = require('path');
    const files = ['js/admin-owner-billing.js', 'js/admin-owner-overview.js', 'js/admin.js'];
    const bad = [];
    files.forEach(f => {
      let s = ''; try { s = fs.readFileSync(path.join(K.REPO, f), 'utf8'); } catch (e) { bad.push(f + ' 不存在'); return; }
      const strs = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').match(/'(?:[^'\\\n]|\\.)*'/g) || [];
      strs.forEach(x => {
        if (/點數|儲值/.test(x)) bad.push(f + ':' + x);
        if (f === 'js/admin.js') return;   // admin.js 原本的字串(✕、—)不在這次範圍,只查點數與儲值
        if (/[—–]|[\u{1F300}-\u{1FAFF}☀-➿]/u.test(x)) bad.push(f + ':' + x);
        if (/[一-鿿][,;:!?()]|[,;:!?()][一-鿿]/.test(x)) bad.push(f + ':' + x);
      });
    });
    return { ok: bad.length === 0, detail: bad.slice(0, 8).join(' | ') || 'clean' };
  },
};

run(cases);
