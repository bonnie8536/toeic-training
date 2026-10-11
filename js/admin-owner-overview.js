/* 站長後台「收費管理」的總覽(前端計畫九.1):呼叫 owner_overview(14),一段一段列出
   老師(名額、到期、寬限)、14 天內結束的使用權、試用快結束的帳號、既有帳號統計、最近 50 筆付款。
   只讀不寫;每個 Email 都可以點進查帳號(記收款、贈送、退款都在那裡做)。
   寬限的天數規則只在資料庫,這裡只寫「寬限中」,不自己算寬限到哪一天。
   做法參考 Stripe 首頁與 Gumroad 的銷售總覽:幾段清單,每一筆點進去是那個客戶。 */
(function () {
  const O = window.ADMIN_OWNER;
  if (!O) return;
  const { text, arr, str, isObj } = O;
  const DAYS = 14;
  const NOW_SOURCE = { paid: '已付費', class: '由班級提供', comp: '贈送', legacy: '既有帳號' };

  /* 老師那一行(_teacher_status 的欄位) */
  function teacherLine(t, nowIso) {
    const s = isObj(t.status) ? t.status : {};
    const used = Number(t.seats_used) || 0;
    if (!s.plan_source) return { text: '還沒有方案', off: true, over: 0 };
    const label = s.plan_source === 'trial' ? '試用' : '方案';
    const seats = typeof s.plan_seats === 'number' && s.plan_seats > 0 ? label + ' ' + s.plan_seats + ' 人' : label + '名額不限';
    const over = typeof s.plan_seats === 'number' && s.plan_seats > 0 && used > s.plan_seats ? used - s.plan_seats : 0;
    if (s.active === true) return { text: seats + '，已用 ' + used + ' 人' + (s.plan_until ? '，到 ' + O.fmtDate(s.plan_until) : ''), off: false, over };
    if (s.in_grace === true) return { text: seats + '，已用 ' + used + ' 人，' + (s.plan_until ? O.dayText(s.plan_until, nowIso) + '到期，' : '') + '寬限中', off: true, over };
    return { text: '方案已過期' + (s.plan_until ? '（到 ' + O.fmtDate(s.plan_until) + '）' : ''), off: true, over: 0 };
  }

  function overview(opts) {
    opts = opts || {};
    let loaded = false, stale = false, seq = 0;
    const msg = h('p', { class: 'ow-msg', role: 'status' });
    const say = (t, kind) => { msg.textContent = t || ''; msg.className = 'ow-msg' + (kind ? ' ' + kind : ''); };
    const again = h('button', { class: 'btn ow-ov-refresh', type: 'button' }, '重新整理');
    again.addEventListener('click', () => { load(); });
    const body = h('div', { class: 'ow-ov-body' });
    const el = h('div', { class: 'ow-overview' }, h('div', { class: 'ow-ov-top' }, again), msg, body);

    async function load() {
      const s = ++seq;
      loaded = true; stale = false;
      say('讀取中');
      body.setAttribute('aria-busy', 'true');
      const r = await O.billing.api.overview();
      if (s !== seq) return;
      body.removeAttribute('aria-busy');
      if (!r.ok) { body.innerHTML = ''; say(r.message, 'bad'); return; }
      say('');
      draw(r.data);
    }

    function mail(email) {
      const b = h('button', { class: 'ow-name ow-ov-mail', type: 'button', 'aria-label': '查帳號 ' + str(email) });
      b.textContent = str(email);
      b.addEventListener('click', () => { if (opts.onLookup) opts.onLookup(str(email)); });
      return b;
    }
    function section(title, list, emptyText) {
      return h('section', { class: 'ow-sec' }, text('h3', 'ow-sec-h', title), list || text('p', 'ow-empty-line', emptyText));
    }
    const items = (rows, fn) => {
      if (!rows.length) return null;
      const ul = h('ul', { class: 'ow-items' });
      rows.forEach(r => ul.append(fn(r)));
      return ul;
    };

    function draw(d) {
      body.innerHTML = '';
      const now = d.server_now || null;

      body.append(section('老師', items(arr(d.teachers), t => {
        const x = teacherLine(t, now);
        const li = h('li', { class: 'ow-item' + (x.off ? ' is-off' : '') }, h('div', { class: 'ow-item-top' }, mail(t.email)));
        const line = h('p', { class: 'ow-ov-line' }, text('span', 'ow-teacher' + (x.off ? ' is-off' : ''), x.text));
        if (x.over) line.append(text('span', 'ow-off', '超過名額 ' + x.over + ' 人'));
        li.append(line);
        const cls = arr(t.classes);
        if (cls.length) {
          const ul = h('ul', { class: 'ow-own', 'aria-label': '開的班' });
          cls.forEach(c => {
            const k = h('li', null, text('span', 'ow-c-name', str(c.name) || '（沒有班名）'), text('span', 'ow-code', str(c.code)));
            if (c.active === false) k.append(text('span', 'ow-off', '已停用'));
            ul.append(k);
          });
          li.append(ul);
        }
        return li;
      }), '還沒有其他老師'));

      /* 已經預付續約的人也在這裡(資料庫的 expiring 不看後面接著的那一段),所以標題寫「結束」不寫「要續約」 */
      body.append(section(DAYS + ' 天內結束的使用權', items(arr(d.expiring), g => h('li', { class: 'ow-item' },
        h('div', { class: 'ow-item-top' }, mail(g.email), text('span', 'ow-item-text', O.grantLabel(g)), text('span', 'ow-when', '到 ' + O.fmtDate(g.ends_at))))),
      DAYS + ' 天內沒有要結束的使用權'));

      body.append(section('試用快結束', items(arr(d.trials_ending), t => {
        const top = h('div', { class: 'ow-item-top' }, mail(t.email), text('span', 'ow-when', '試用到 ' + O.dayText(t.trial_until, now)));
        if (NOW_SOURCE[t.access]) top.append(text('span', 'ow-state', NOW_SOURCE[t.access]));
        return h('li', { class: 'ow-item' }, top);
      }), DAYS + ' 天內沒有試用要結束的帳號'));

      const lg = isObj(d.legacy) ? d.legacy : {};
      const n = k => Number(lg[k]) || 0;
      /* 資料庫數的是 legacy 使用權的段數(含撤銷的):收費上線前的每個帳號(含站長、含老師)一段學生的,當時是老師的再一段老師的 */
      body.append(section('既有帳號', h('div', { class: 'ow-ov-legacy' },
        text('p', null, '收費上線前的帳號 ' + n('student') + ' 個，其中當時是老師的 ' + n('teacher') + ' 位'),
        text('p', 'ow-ov-sub', '設了到期日 ' + n('with_end_date') + ' 段，撤銷 ' + n('revoked') + ' 段'))));

      body.append(section('最近的付款', items(arr(d.payments_recent), p => {
        const x = O.paymentText(p);
        const li = h('li', { class: 'ow-item ow-pay' + (p.status === 'refunded' ? ' is-off' : '') },
          h('div', { class: 'ow-item-top' }, text('span', 'ow-when', x.when), mail(p.email), text('span', 'ow-item-text', x.item),
            text('span', 'ow-amount', x.amount), text('span', 'ow-method', x.method), text('span', 'ow-state', x.state)));
        if (x.note) li.append(text('p', 'ow-item-note', O.noteText(x.note)));
        return li;
      }), '還沒有付款紀錄'));
    }

    return {
      el,
      show: () => { if (!loaded || stale) load(); },
      stale: () => { stale = true; },
    };
  }

  O.overview = overview;
})();
