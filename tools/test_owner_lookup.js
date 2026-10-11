/* 站長後台「收費管理」查帳號(前端計畫九.2)的測試:使用權的撤銷、恢復、改到期日、拿掉到期日,付款的退款,
   以及讀取中、做完一件事之後畫面與焦點的處理。假環境在 tools/owner_test_kit.js。
   用法:node tools/test_owner_lookup.js */
const K = require('./owner_test_kit');
const { FX, SRC, ACC, OWNER_ID, ALL, clone, rowBy, DATE, DAY, isoOf, world, settle, wait, context, area, loadAdmin,
  rowOf, btn, dlg, field, radio, setVal, pick, ok, cancel, lines, warns, onlyOwnerRpcs, run } = K;

/* Pam 的學生方案付款退過款(amount 是退的金額),那一段使用權也撤銷了 */
function refundedPam(amount) {
  const d = clone(FX['owner_lookup.after_refund'].data);
  const p = d.payments.find(x => x.item === 'student');
  Object.assign(p, { status: 'refunded', refund_amount: amount, refunded_at: d.access.server_now });
  d.grants.find(g => g.payment_id === p.id).revoked_at = d.access.server_now;
  return d;
}

const cases = {
  /* ---------- 查帳號 ---------- */
  '查帳號:從列按查帳號會切到查帳號分頁並查 { p_who: Email };顯示目前使用權、使用權、付款、點數、異動紀錄': async () => {
    const w = world(); const L = await area(w);
    await btn(rowOf(L, 'pam'), '查帳號').click(); await settle();
    const a = w.calls('owner_lookup').pop();
    const t = L.el.byClass('ow-lookup')[0].textContent;
    const shown = !L.el.byClass('ow-p-lookup')[0].hidden && L.el.byClass('ow-p-list')[0].hidden;
    const heads = L.el.byClass('ow-lookup')[0].find(n => n.tagName === 'H3').map(n => n.textContent);
    const okk = JSON.stringify(a) === JSON.stringify({ p_who: ACC.pam.email }) && shown
      && heads.join() === '目前使用權,使用權,付款,寫作批改紀錄,異動紀錄' && /已付費，到/.test(t) && /寫作批改剩 5 篇/.test(t) && /650 元/.test(t);
    return { ok: okk, detail: JSON.stringify({ a, heads, t: t.slice(0, 200) }) };
  },
  '查帳號:輸入找不到的帳號,錯誤原樣顯示': async () => {
    const w = world(); const L = await area(w);
    await btn(L.el, '查帳號').click(); await settle();
    const inp = L.el.byClass('ow-lookup-form')[0].find(n => n.tagName === 'INPUT')[0];
    await setVal(inp, 'nobody@example.test');
    await L.el.byClass('ow-lookup-form')[0].fire('submit'); await settle();
    const okk = /找不到這個帳號:nobody@example\.test/.test(L.el.byClass('ow-lookup')[0].textContent);
    return { ok: okk, detail: L.el.byClass('ow-lookup')[0].textContent.slice(0, 120) };
  },
  '使用權:撤銷先確認(寫後果),送 (id, null, null, true);legacy 沒有到期日不出現拿掉到期日;改到期日送完整到期日;做完重讀': async () => {
    const w = world(); const L = await area(w);
    L.a.lookup('legacy.amy@example.test'); await settle();
    const g = FX['owner_lookup.legacy'].data.grants[0];
    const box = L.el.byClass('ow-grant')[0];
    const names = box.find(n => n.tagName === 'BUTTON').map(b => b.textContent).join();
    await btn(box, '撤銷').click(); await settle();
    const d = dlg(L); const l = lines(d);
    w.next.owner_update_grant = ['owner_update_grant.revoke'];
    const n0 = w.calls('owner_lookup').length;
    await ok(d);
    const a = w.calls('owner_update_grant')[0];
    const reread = w.calls('owner_lookup').length === n0 + 1;
    await btn(L.el.byClass('ow-grant')[0], '改到期日').click(); await settle();
    const d2 = dlg(L);
    await setVal(field(d2, 'until'), '2026-11-10');
    w.next.owner_update_grant = ['owner_update_grant.set_end'];
    await ok(d2);
    const b = w.calls('owner_update_grant')[1];
    const okk = names === '撤銷,改到期日' && l.some(x => /立刻失效/.test(x))
      && JSON.stringify(a) === JSON.stringify({ p_grant: g.id, p_starts_at: null, p_ends_at: null, p_revoked: true }) && reread
      && JSON.stringify(b) === JSON.stringify({ p_grant: g.id, p_starts_at: null, p_ends_at: '2026-11-10T23:59:59+08:00', p_revoked: null, p_note: null }) && onlyOwnerRpcs(w);
    return { ok: okk, detail: JSON.stringify({ names, l, a, b }) };
  },
  '使用權:已撤銷的出現恢復(送 false);被改成學生的人老師方案不給恢復,寫要用改角色;有到期日的 legacy 可以拿掉到期日(送 p_clear_end)': async () => {
    const w = world(); const L = await area(w);
    L.a.lookup(ACC.ben.email); await settle();
    const gs = L.el.byClass('ow-grant');
    const teacherBtns = gs[0].find(n => n.tagName === 'BUTTON').map(b => b.textContent).join();
    const teacherNote = gs[0].textContent;
    await btn(gs[1], '恢復').click(); await settle();
    w.next.owner_update_grant = ['owner_update_grant.restore'];
    await ok(dlg(L));
    const r = w.calls('owner_update_grant')[0];
    const amy = clone(FX['owner_lookup.legacy'].data); amy.grants[0].ends_at = '2026-11-10T06:27:13.838+00:00';
    w.lookups['legacy.amy@example.test'] = amy;
    L.a.lookup('legacy.amy@example.test'); await settle();
    await btn(L.el.byClass('ow-grant')[0], '拿掉到期日').click(); await settle();
    const d = dlg(L); await setVal(field(d, 'note'), '恢復無期限');
    w.next.owner_update_grant = ['owner_update_grant.clear_end'];
    await ok(d);
    const c = w.calls('owner_update_grant')[1];
    const okk = !/恢復/.test(teacherBtns) && /改角色/.test(teacherNote)
      && JSON.stringify(r) === JSON.stringify({ p_grant: FX['owner_lookup.demoted'].data.grants[1].id, p_starts_at: null, p_ends_at: null, p_revoked: false })
      && JSON.stringify(c) === JSON.stringify({ p_grant: amy.grants[0].id, p_starts_at: null, p_ends_at: null, p_revoked: null, p_note: '恢復無期限', p_clear_end: true });
    return { ok: okk, detail: JSON.stringify({ teacherBtns, r, c }) };
  },
  '退款:確認寫後果;第一次按只變成再按一次,第二次才送;全額送 p_amount null,改金額送數字;已退款的沒有退款鈕': async () => {
    const w = world(); const L = await area(w);
    L.a.lookup(ACC.pam.email); await settle();
    const pays = FX['owner_lookup.paid_with_credits'].data.payments;
    const payRow = t => L.el.byClass('ow-pay').find(li => li.textContent.includes(t));   // 新的在上面,用內容找
    await btn(payRow('學生方案'), '退款').click(); await settle();
    const d = dlg(L); const l = lines(d);
    await setVal(field(d, 'amount'), '100');
    w.next.owner_refund_payment = ['owner_refund_payment.student_partial'];
    await ok(d);
    const armed = w.calls('owner_refund_payment').length === 0 && /再按一次/.test(d.byClass('ow-ok')[0].textContent);
    await ok(d);
    const a = w.calls('owner_refund_payment')[0];
    await btn(payRow('寫作批改'), '退款').click(); await settle();
    const d2 = dlg(L); const l2 = lines(d2);
    w.next.owner_refund_payment = ['owner_refund_payment.credits_full'];
    await ok(d2); await ok(d2);
    const b = w.calls('owner_refund_payment')[1];
    const msg = L.el.byClass('ow-lookup')[0].byClass('ow-msg')[0].textContent;
    w.lookups[ACC.pam.email] = FX['owner_lookup.after_refund'].data;
    L.a.lookup(ACC.pam.email); await settle();
    const refundedBtns = payRow('寫作批改').find(n => n.tagName === 'BUTTON').length;
    const okk = l.some(x => /方案會立刻撤銷/.test(x)) && l.some(x => /錢要另外轉回/.test(x)) && armed
      && JSON.stringify(a) === JSON.stringify({ p_payment: pays[0].id, p_amount: 100, p_note: null })
      && l2.some(x => /還沒用掉的/.test(x)) && JSON.stringify(b) === JSON.stringify({ p_payment: pays[1].id, p_amount: null, p_note: null })
      && /收回 3 篇/.test(msg) && refundedBtns === 0 && onlyOwnerRpcs(w);
    return { ok: okk, detail: JSON.stringify({ l, a, l2, b, msg, refundedBtns }) };
  },

  /* ---------- 審查修正(2026-10-11) ---------- */
  '退過款的付費使用權:全額退款不給恢復(寫用贈送);部分退款的恢復要寫出已退的金額、再按一次才送': async () => {
    const w = world(); const L = await area(w);
    const full = refundedPam(199), part = refundedPam(100);
    w.lookups[ACC.pam.email] = full;
    L.a.lookup(ACC.pam.email); await settle();
    const g1 = L.el.byClass('ow-grant')[0];
    const names1 = g1.find(n => n.tagName === 'BUTTON').map(b => b.textContent).join();
    const note1 = g1.textContent;
    w.lookups[ACC.pam.email] = part;
    L.a.lookup(ACC.pam.email); await settle();
    await btn(L.el.byClass('ow-grant')[0], '恢復').click(); await settle();
    const d = dlg(L); const l = lines(d);
    w.next.owner_update_grant = ['owner_update_grant.restore'];
    await ok(d);
    const armed = w.calls('owner_update_grant').length === 0 && /再按一次/.test(d.byClass('ow-ok')[0].textContent);
    await ok(d);
    const a = w.calls('owner_update_grant');
    const okk = !/恢復/.test(names1) && note1.includes('這筆付款已退款，要再給他使用權請用贈送。')
      && l.includes('這筆付款已退款 100 元，恢復後他照樣可以用到 ' + DATE(part.grants[0].ends_at) + '，帳上仍記已退款。') && armed
      && a.length === 1 && JSON.stringify(a[0]) === JSON.stringify({ p_grant: part.grants[0].id, p_starts_at: null, p_ends_at: null, p_revoked: false });
    return { ok: okk, detail: JSON.stringify({ names1, l, a }) };
  },
  '退老師方案的款:確認框寫出老師方案立刻結束、沒有寬限、讀不到學生進度;他還有另一段在期內的就寫照舊;方案已經撤銷的寫退款不改變使用權': async () => {
    const w = world(); const L = await area(w);
    const tina = clone(FX['owner_lookup.teacher_over_seats'].data);
    w.lookups[ACC.tina.email] = tina;
    L.a.lookup(ACC.tina.email); await settle();
    await btn(L.el.byClass('ow-pay')[0], '退款').click(); await settle();
    const d1 = dlg(L); const l1 = lines(d1); await cancel(d1);
    const two = clone(tina); two.grants.push(Object.assign(clone(tina.grants[0]), { id: 'other-teacher', payment_id: null, source: 'comp' }));
    w.lookups[ACC.tina.email] = two;
    L.a.lookup(ACC.tina.email); await settle();
    await btn(L.el.byClass('ow-pay')[0], '退款').click(); await settle();
    const d2 = dlg(L); const l2 = lines(d2); await cancel(d2);
    const gone = clone(tina); gone.grants[0].revoked_at = tina.access.server_now;
    w.lookups[ACC.tina.email] = gone;
    L.a.lookup(ACC.tina.email); await settle();
    await btn(L.el.byClass('ow-pay')[0], '退款').click(); await settle();
    const d3 = dlg(L); const l3 = lines(d3); await cancel(d3);
    const okk = l1.includes('他的老師方案會立刻結束，沒有寬限；他會讀不到學生進度，班上學生也不再由他的方案提供使用權。')
      && l2.includes('他還有另一段老師方案在期內，學生進度與班上學生的使用權照舊。')
      && l3.includes('這筆付款開通的方案已經撤銷，退款不會再改變他的使用權。') && !l3.some(x => /讀不到學生進度/.test(x))
      && w.calls('owner_refund_payment').length === 0;
    return { ok: okk, detail: JSON.stringify({ l1, l2, l3 }) };
  },
  '查另一個帳號讀取中:舊帳號的按鈕先拿掉;確認框第一行寫帳號;做完寫哪個帳號做了什麼,不會重讀成另一個帳號': async () => {
    const w = world(); const L = await area(w);
    L.a.lookup(ACC.amy.email); await settle();
    const amyGrant = FX['owner_lookup.legacy'].data.grants[0];
    await btn(L.el.byClass('ow-grant')[0], '撤銷').click(); await settle();
    const d = dlg(L); const l = lines(d);
    const release = w.hold('owner_lookup', { data: clone(FX['owner_lookup.paid_with_credits'].data), error: null });
    L.a.lookup(ACC.pam.email); await settle();
    const detail = L.el.byClass('ow-detail')[0];
    const staleButtons = detail.find(n => n.tagName === 'BUTTON').length;
    w.next.owner_update_grant = ['owner_update_grant.revoke'];
    const n0 = w.calls('owner_lookup').length;
    await ok(d);
    release(); await settle();
    const upd = w.calls('owner_update_grant')[0];
    const extra = w.calls('owner_lookup').slice(n0).map(a => a.p_who);
    const shown = L.el.byClass('ow-who-mail')[0].textContent;
    const msg = L.el.byClass('ow-lookup')[0].byClass('ow-msg')[0].textContent;
    /* 第二個帳號讀不到:仍然看得到第一個帳號做完的結果 */
    const w2 = world(); const M = await area(w2);
    M.a.lookup(ACC.amy.email); await settle();
    await btn(M.el.byClass('ow-grant')[0], '撤銷').click(); await settle();
    const e = dlg(M);
    const rel2 = w2.hold('owner_lookup', { data: null, error: clone(FX['error.lookup_not_found'].error) });
    M.a.lookup('nobody@example.test'); await settle();
    w2.next.owner_update_grant = ['owner_update_grant.revoke'];
    await ok(e); rel2(); await settle();
    const msg2 = M.el.byClass('ow-lookup')[0].byClass('ow-msg')[0].textContent;
    const okk = l[0] === ACC.amy.email && staleButtons === 0 && upd.p_grant === amyGrant.id && extra.length === 0
      && shown === ACC.pam.email && msg.includes(ACC.amy.email) && msg.includes('已撤銷')
      && msg2.includes(ACC.amy.email) && msg2.includes('已撤銷') && /找不到這個帳號/.test(msg2);
    return { ok: okk, detail: JSON.stringify({ l0: l[0], staleButtons, extra, shown, msg, msg2 }) };
  },
  '做完撤銷、恢復、退款之後焦點回到同一段使用權或同一筆付款,不會掉到頁面最上面': async () => {
    const w = world(); const L = await area(w);
    const doc = L.dom.document;
    L.a.lookup(ACC.amy.email); await settle();
    await btn(L.el.byClass('ow-grant')[0], '撤銷').click(); await settle();
    w.next.owner_update_grant = ['owner_update_grant.revoke'];
    await ok(dlg(L));
    const a1 = doc.activeElement;
    const inGrant = L.el.byClass('ow-grant')[0].contains(a1) && a1.tagName === 'BUTTON';
    L.a.lookup(ACC.pam.email); await settle();
    await btn(L.el.byClass('ow-pay')[1], '退款').click(); await settle();
    w.next.owner_refund_payment = ['owner_refund_payment.credits_full'];
    w.lookups[ACC.pam.email] = FX['owner_lookup.after_refund'].data;
    await ok(dlg(L)); await ok(dlg(L));
    const a2 = doc.activeElement;
    const payLi = L.el.byClass('ow-pay').find(li => li.contains(a2));
    const okk = inGrant && !!payLi && a2 !== doc.body;
    return { ok: okk, detail: JSON.stringify({ a1: a1.tagName + ' ' + a1.textContent, a2: a2.tagName + ' ' + (a2.textContent || '').slice(0, 40) }) };
  },
  '資料庫自己寫的備註(購買批改點數、既有帳號、改成學生)換成全形、不用點數兩個字;站長自己打的備註原樣顯示': async () => {
    const w = world(); const L = await area(w);
    w.lookups[ACC.pam.email] = FX['owner_lookup.after_refund'].data;   // 退款時站長打了備註「學生要求退款」
    const text = async who => { L.a.lookup(who); await settle(); return L.el.byClass('ow-detail')[0].textContent; };
    const amy = await text(ACC.amy.email), pam = await text(ACC.pam.email), ben = await text(ACC.ben.email);
    const half = /[一-鿿][,()]|[,()][一-鿿]/;
    const okk = !half.test(amy) && !half.test(pam) && !half.test(ben) && !/點數/.test(amy + pam + ben)
      && amy.includes('收費上線前的既有帳號') && ben.includes('站長改成學生，老師方案立刻結束') && pam.includes('學生要求退款')
      && L.O.noteText('站長手打,有逗號') === '站長手打,有逗號';
    return { ok: okk, detail: JSON.stringify({ amy: amy.slice(0, 200), ben: ben.slice(0, 300) }) };
  },
  '查帳號的按鈕對讀螢幕的人寫出是哪一段使用權、哪一筆付款(兩個退款分得出來)': async () => {
    const w = world(); const L = await area(w);
    const pam = clone(FX['owner_lookup.paid_with_credits'].data);
    w.lookups[ACC.pam.email] = pam;
    L.a.lookup(ACC.pam.email); await settle();
    const labels = L.el.byClass('ow-detail')[0].find(n => n.tagName === 'BUTTON').map(b => b.attrs['aria-label'] || '');
    const refunds = labels.filter(x => /^退款/.test(x));
    const okk = labels.every(Boolean) && new Set(labels).size === labels.length && refunds.length === 2
      && refunds.some(x => /學生方案 1 個月/.test(x)) && refunds.some(x => /寫作批改 5 篇/.test(x));
    return { ok: okk, detail: JSON.stringify(labels) };
  },
  '資料庫的錯誤訊息原樣顯示(就算裡面有 timeout 這個字);真的連不上才寫連不上雲端伺服器': async () => {
    const w = world(); const L = await area(w);
    const show = async err => { w.next.owner_lookup = [{ data: null, error: err }]; L.a.lookup('x@example.test'); await settle(); return L.el.byClass('ow-lookup')[0].byClass('ow-msg')[0].textContent; };
    const a = await show({ message: '找不到這個帳號:timeout.fan@example.com', code: 'P0001' });
    const b = await show({ message: 'canceling statement due to statement timeout', code: '57014' });
    const c = await show({ message: 'TypeError: Failed to fetch', code: '' });
    const okk = /timeout\.fan@example\.com/.test(a) && /statement timeout/.test(b) && c === '連不上雲端伺服器，請檢查網路後再試。';
    return { ok: okk, detail: JSON.stringify({ a, b, c }) };
  },
};

run(cases);
