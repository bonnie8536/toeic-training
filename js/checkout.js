/* 購買(pricing.html)與付款結果(pay-result.html 用這裡的邏輯,畫面在 js/pay-result.js)。
   - 價格頁的購買按鈕只在 window.PAID_UI === true 時出現;網址帶 ?paytest=1、而且登入的是站長時,另外出現 NT$10 測試項目
     (PAID_UI 沒開也會出現,給收費開始前在正式環境刷一次)。兩個都不成立時這支檔案一個節點都不碰。
   - 已經可以一直使用的帳號(既有帳號、沒有期限的贈送、站長)不放學生方案的按鈕,改寫一句說明;老師方案同理,
     但無期限的贈送有名額上限時,照樣賣名額比它多的方案(視窗裡只列那幾個)。
     伺服器(newebpay_begin_checkout)也會擋,這裡只是不讓人按一個一定會被拒絕的按鈕。寫作批改一律可以買。
   - 付款前一定要勾選同意(開始使用後不適用 7 天猶豫期),記下勾選的時間一起送出;伺服器另外記同意的條款版本。
   - 金額只由伺服器決定(supabase/functions/_shared/products.ts)。這裡的價格只用來顯示,送出的只有商品代號。
   - 伺服器回來的表單只送到藍新的兩個付款網址,欄位只有四個;整頁 POST 過去,不經過其他網址。
   - 付款成功與否只看伺服器(藍新通知寫進資料庫之後的 my_checkout),瀏覽器回來的網址參數不算數。
   - 使用者看得到的字一律用文字節點放進畫面。 */
(function () {
  const NB = ' ';   // 數字與單位之間不換行
  const CONSENT_TEXT = '我同意線上服務開始使用後，不適用 7 天猶豫期。';
  /* 「開始使用」的判定(跟 refund.html「怎樣算開始使用」同一件事),放在勾選框正下方。
     老師方案的功能(班級、學生進度)不是練習功能,所以老師方案另外寫一句(2026-10-17 第二輪複審)。
     學生方案與寫作批改各寫自己那一句,跟退款政策一字不差(第三輪複審:以前兩種共用一句,批改的視窗沒寫 5 篇的規則) */
  const CONSENT_DEF = '方案開始計算後，登入並使用過任何一項需要方案的練習功能，就算開始使用。';
  const CONSENT_DEF_CREDITS = '寫作真人批改以一篇為單位，批改完成的那一篇就算使用。5' + NB + '篇批改服務批改過其中一篇，就算開始使用。';
  const CONSENT_DEF_TEACHER = '老師方案開始計算後，用過任何一項需要方案的練習功能、有學生用邀請碼加入你的班級，或在教師後台查看過班上學生的練習進度，就算開始使用。';
  const GATEWAYS = Object.freeze({ S: 'https://core.newebpay.com/MPG/mpg_gateway', T: 'https://ccore.newebpay.com/MPG/mpg_gateway' });
  const FIELD_KEYS = ['MerchantID', 'TradeInfo', 'TradeSha', 'Version'];
  const LAST_KEY = 'tr_pay_last';            // 這個分頁最後建立的訂單 { o, at }(sessionStorage;藍新的「返回商店」不帶訂單編號)
  const LAST_MS = 2 * 3600e3;
  const POLL_MS = 3000, POLL_LIMIT_MS = 60000;
  /* 查到這些狀態就不再查。slow 只有在 my_checkout 讀不到、改看 my_billing 而那一筆已付款時才會在這裡出現(看不出有沒有開通) */
  const FINAL = ['paid', 'unapplied', 'test', 'failed', 'refunded', 'missing', 'slow'];
  const MAIL = 'rushuplanguage@gmail.com';
  const TZ_MS = 8 * 3600e3;

  const SAY = Object.freeze({
    freeStudent: '你的帳號可以免費使用練習功能，不需要購買學生方案。',
    byClass: '你的練習功能目前由班級提供。',
    /* 老師方案在期內:學生方案接在老師方案之後才開始(資料庫 _plan_start 同一個規則) */
    byTeacher: '你的老師方案已經包含練習功能，學生方案會接在老師方案之後開始。',
    freeTeacher: '你的帳號可以使用老師方案的功能，不需要購買老師方案。',
    /* 無期限但有名額上限(例如站長送的 10 位):只賣名額比它多的方案 */
    moreSeats: n => '你的老師方案沒有期限，' + (typeof n === 'number' ? '名額 ' + n + NB + '位以內。' : '') + '需要更多名額再購買。',
    today: '這次買的方案從今天開始。',
    askTeacher: '老師方案請寫信到 ' + MAIL + ' 聯絡站長。',
    upgrade: '改買人數較多的方案從今天開始，原本的方案剩下的天數不退差額。',
    sending: '正在前往付款頁…',
    submit: '前往付款',
  });

  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  function cloud() { return window.CLOUD && typeof window.CLOUD === 'object' ? window.CLOUD : null; }
  function plans() { return isObj(window.PLANS) ? window.PLANS : null; }

  /* ---------- 純邏輯(tools/test_checkout.js 測) ---------- */

  /* 商品清單(只給畫面用)。sku 跟伺服器價格表同一組,金額取 js/plans-config.js */
  function catalog() {
    const P = plans();
    if (!P) return [];
    const ym = P.teacherYearMonths;
    const out = [
      { sku: 'student_month', group: 'student', label: '一個月', amount: P.student.month },
      { sku: 'student_year', group: 'student', label: '一年', amount: P.student.year },
    ];
    [10, 30, 60].forEach(s => {
      out.push({ sku: 'teacher' + s + '_month', group: 'teacher', seats: s, label: s + NB + '位以內 一個月', amount: P.teacher[s] });
      out.push({ sku: 'teacher' + s + '_year', group: 'teacher', seats: s, label: s + NB + '位以內 一年', amount: P.teacher[s] * ym });
    });
    out.push({ sku: 'correction_one', group: 'credits', label: '一篇', amount: P.correction.one });
    out.push({ sku: 'correction_five', group: 'credits', label: '5' + NB + '篇批改服務', amount: P.correction.five });
    out.push({ sku: 'test10', group: 'test', label: '站長測試項目', amount: 10 });
    return out;
  }
  function findItem(sku) { return catalog().find(x => x.sku === sku) || null; }

  const GROUPS = {
    student: { title: '購買學生方案', anchor: 'pricing-student' },
    teacher: { title: '購買老師方案', anchor: 'pricing-teacher' },
    credits: { title: '購買寫作批改', anchor: 'pricing-correction' },
    test: { title: '購買測試項目', anchor: null },
  };

  /* 練習功能已經沒有期限(既有帳號、沒有期限的贈送、站長):買學生方案不會多任何一天 */
  function unlimitedStudent(a) {
    if (!isObj(a)) return false;
    return a.is_owner === true || (a.active === true && a.until === null && ['owner', 'legacy', 'comp'].indexOf(a.source) > -1);
  }
  /* 老師方案沒有期限(既有老師、沒有期限的贈送)時,名額上限是多少:不限 = Infinity,不是無期限 = 0 */
  function noEndSeats(a) {
    if (!isObj(a) || ['legacy', 'comp'].indexOf(a.teacher_source) < 0 || a.teacher_until !== null) return 0;
    return typeof a.seats === 'number' ? a.seats : Infinity;
  }
  /* 這個帳號買得到的老師方案(商品代號)。伺服器的 my_access.plan_starts 有那一級而且是 null = 已經涵蓋,不賣
     (跟 newebpay_begin_checkout 同一個判斷);舊資料庫沒有 plan_starts 時,無期限的只賣名額比現在多的 */
  function teacherSkus(a) {
    const ps = isObj(a) && isObj(a.plan_starts) ? a.plan_starts : null;
    const cap = noEndSeats(a);
    return catalog().filter(x => x.group === 'teacher')
      .filter(x => (ps && ('teacher' + x.seats) in ps) ? ps['teacher' + x.seats] !== null : x.seats > cap)
      .map(x => x.sku);
  }
  function teacherCount() { return catalog().filter(x => x.group === 'teacher').length; }
  function unlimitedTeacher(a) { return teacherCount() > 0 && teacherSkus(a).length === 0; }
  /* 「名額 N 位以內」的 N:沒有期限的那一段的名額(my_access.teacher_no_end_seats)。seats 是目前所有期內方案裡最多的,
     另外買的有期限升級也算在內,不能拿來寫(2026-10-17 第二輪複審)。舊資料庫沒有這個欄位時,只在 seats 以內的方案都不賣時才用 seats */
  function noEndCap(a) {
    if (!isObj(a)) return null;
    if ('teacher_no_end_seats' in a) return typeof a.teacher_no_end_seats === 'number' ? a.teacher_no_end_seats : null;
    if (typeof a.seats !== 'number') return null;
    const sold = teacherSkus(a);
    return catalog().some(x => x.group === 'teacher' && x.seats <= a.seats && sold.indexOf(x.sku) > -1) ? null : a.seats;
  }

  /* 價格頁某一組的購買區要放什麼。o = { signedIn, access };回 { button, note } 或 null(什麼都不放)。
     沒登入時照樣放按鈕(按下去開登入)。老師方案:讀不到使用權、站長不放;被站長改成學生的人寫聯絡站長。 */
  function slotFor(group, o) {
    const signedIn = !!(o && o.signedIn === true);
    const a = o && isObj(o.access) ? o.access : null;
    const btn = note => ({ button: true, note: note || null });
    if (group === 'student') {
      if (!signedIn) return btn();
      if (unlimitedStudent(a)) return { button: false, note: SAY.freeStudent };
      if (a && a.teacher_active === true && a.is_owner !== true) return btn(SAY.byTeacher);
      if (a && a.active === true && a.source === 'class') return btn(SAY.byClass);
      return btn();
    }
    if (group === 'teacher') {
      if (!signedIn) return btn();
      if (!a || a.is_owner === true) return null;
      if (a.teacher_purchase_allowed === false) return { button: false, note: SAY.askTeacher };
      if (unlimitedTeacher(a)) return { button: false, note: SAY.freeTeacher };
      if (a.teacher_purchase_allowed !== true) return null;
      return teacherSkus(a).length < teacherCount() ? btn(SAY.moreSeats(noEndCap(a))) : btn();
    }
    if (group === 'credits' || group === 'test') return btn();
    return null;
  }

  /* 價格頁要放哪幾組購買區。o = { paidUi, signedIn, access, owner, paytest } */
  function groupsFor(o) {
    const out = [];
    if (!o) return out;
    if (o.paidUi === true) ['student', 'teacher', 'credits'].forEach(g => { if (slotFor(g, o)) out.push(g); });
    if (o.signedIn === true && o.owner === true && o.paytest === true) out.push('test');
    return out;
  }

  function paytestFlag(search) {
    try { return new URLSearchParams(String(search || '')).get('paytest') === '1'; } catch (e) { return false; }
  }
  /* 藍新付款頁的「返回商店」(ClientBackURL)帶 ?back=1:多半是沒有付款就回來 */
  function backFlag(search) {
    try { return new URLSearchParams(String(search || '')).get('back') === '1'; } catch (e) { return false; }
  }

  /* 「2026/11/30」(台北時間) */
  function fmtDate(v) {
    const t = typeof v === 'number' ? v : Date.parse(v);
    if (!isFinite(t)) return '';
    const d = new Date(t + TZ_MS);
    const two = n => (n < 10 ? '0' : '') + n;
    return d.getUTCFullYear() + '/' + two(d.getUTCMonth() + 1) + '/' + two(d.getUTCDate());
  }

  /* 購買視窗選項下面的起算說明。沒有要說的回 null。
     有 my_access.plan_starts(資料庫 _plan_start 算的,跟入帳同一個算法)就照它:比現在晚就寫接在那天之後;
     今天開始的老師方案,如果是升級(名額比現在期內的多)再補一句原本的不退差額。
     舊資料庫沒有 plan_starts 時照下面的近似算法:
     學生:接在已付或贈送的期間、新帳號試用之後。
     老師:方案還在期內時,買的人數比現在多就從今天開始(原本的不退差額);一樣或比較少就接在現在的方案之後。 */
  function startNote(sku, a) {
    const it = findItem(sku);
    if (!it || !isObj(a)) return null;
    const now = isFinite(Date.parse(a.server_now)) ? Date.parse(a.server_now) : Date.now();
    const after = t => '這次買的方案接在 ' + fmtDate(t) + ' 之後開始。';
    const key = it.group === 'teacher' ? 'teacher' + it.seats : it.group;
    const ps = isObj(a.plan_starts) && typeof a.plan_starts[key] === 'string' ? Date.parse(a.plan_starts[key]) : NaN;
    if (isFinite(ps) && (it.group === 'student' || it.group === 'teacher')) {
      if (ps > now + 1000) return after(ps);
      if (it.group === 'student') return null;
      const upgrade = a.teacher_active === true && typeof a.seats === 'number' && it.seats > a.seats;
      if (!upgrade) return null;
      return a.teacher_source === 'trial' || a.teacher_until === null ? SAY.today : SAY.upgrade;
    }
    if (it.group === 'student') {
      const end = Math.max(...[a.paid_through, a.trial_until].map(x => Date.parse(x)).filter(isFinite), -Infinity);
      return end > now ? after(end) : null;
    }
    if (it.group === 'teacher') {
      const end = Date.parse(a.teacher_until);
      if (a.teacher_active === false || !isFinite(end) || end <= now) return null;
      if (typeof a.seats === 'number' && it.seats > a.seats) return a.teacher_source === 'trial' ? SAY.today : SAY.upgrade;
      return after(end);
    }
    return null;
  }

  /* 訂單編號:S(正式)/ T(測試)+ 台灣時間 12 碼 + 7 碼大寫英數(newebpay-checkout 的 makeOrderNo) */
  function orderNoOk(s) { return typeof s === 'string' && /^[ST]\d{12}[A-Z0-9]{7}$/.test(s); }

  /* 伺服器回來的付款表單:付款網址只能是藍新那兩個,而且要跟訂單編號的環境一致;欄位剛好四個、都是字串 */
  function validResponse(r) {
    if (!isObj(r) || !orderNoOk(r.order_no) || !isObj(r.fields)) return null;
    if (r.action !== GATEWAYS[r.order_no.charAt(0)]) return null;
    const f = r.fields;
    const keys = Object.keys(f);
    if (keys.length !== FIELD_KEYS.length || !FIELD_KEYS.every(k => typeof f[k] === 'string')) return null;
    if (!/^[A-Za-z0-9]{1,15}$/.test(f.MerchantID) || !/^[0-9a-f]+$/i.test(f.TradeInfo) || f.TradeInfo.length % 2 !== 0
      || !/^[0-9A-F]{64}$/.test(f.TradeSha) || !/^\d+(\.\d+)?$/.test(f.Version)) return null;
    return { action: r.action, order_no: r.order_no, fields: { MerchantID: f.MerchantID, TradeInfo: f.TradeInfo, TradeSha: f.TradeSha, Version: f.Version } };
  }

  function rememberOrder(o, now) {
    if (!orderNoOk(o)) return;
    try { sessionStorage.setItem(LAST_KEY, JSON.stringify({ o, at: typeof now === 'number' ? now : Date.now() })); } catch (e) { /* 存不進去:結果頁改請她到「我的」頁看 */ }
  }
  function lastOrder(now) {
    try {
      const v = JSON.parse(sessionStorage.getItem(LAST_KEY));
      const t = typeof now === 'number' ? now : Date.now();
      if (isObj(v) && orderNoOk(v.o) && typeof v.at === 'number' && t - v.at >= 0 && t - v.at <= LAST_MS) return v.o;
    } catch (e) { /* 讀不到就當沒有 */ }
    return null;
  }
  /* 付款結果頁要查哪一筆:網址的 ?o=(驗過藍新簽章才會帶)優先,沒有或格式不對就用這個分頁剛建的那筆 */
  function orderFromPage(search, now) {
    let o = null;
    try { o = new URLSearchParams(String(search || '')).get('o'); } catch (e) { o = null; }
    return orderNoOk(o) ? o : lastOrder(now);
  }

  /* my_checkout 或 my_billing 的一筆 → 狀態。
     - 站長的 test10 不開通任何東西,一律是 test。
     - my_checkout 的 applied 是 false:錢收到了但沒有開通(要站長處理)。
     - my_billing 退回來的(via billing)看不出有沒有開通,已付款也只當 slow,不寫「付款成功」。 */
  function resultOf(row) {
    if (!isObj(row)) return { state: 'missing' };
    const s = row.status;
    if (s === 'paid') {
      if (row.via === 'billing') return { state: 'slow', row };
      if (row.sku === 'test10') return { state: 'test', row };
      return { state: row.applied === false ? 'unapplied' : 'paid', row };
    }
    if (s === 'failed' || s === 'refunded' || s === 'pending') return { state: s, row };
    return { state: 'pending', row };
  }

  function money(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + NB + '元'; }
  /* 期間的寫法跟價格頁一樣:一個月、一年 */
  function period(m) { return m === 1 ? '一個月' : m === 12 ? '一年' : m + NB + '個月'; }
  /* 「學生方案 一個月」「老師方案 30 位以內 一年」(名額的寫法跟價格頁一樣)「寫作批改 5 篇」;站長測試項目照名稱 */
  function itemText(row) {
    if (!isObj(row)) return '';
    if (row.sku === 'test10') return '站長測試項目';
    if (row.item === 'student' && typeof row.months === 'number') return '學生方案 ' + period(row.months);
    if (row.item === 'teacher' && typeof row.months === 'number') return '老師方案 ' + row.seats + NB + '位以內 ' + period(row.months);
    if (row.item === 'credits' && typeof row.credits === 'number') return '寫作批改 ' + row.credits + NB + '篇';
    return '';
  }
  function itemLine(row) {
    const t = itemText(row);
    if (!t) return null;
    return typeof row.amount === 'number' ? t + '，' + money(row.amount) + '。' : t + '。';
  }
  /* 付款成功時寫的那一句。my_checkout 的 plan(這次買的那一段)優先:排在後面才開始的寫哪天開始、用到哪天;
     舊資料庫沒有 plan 時看 access(學生看 paid_through,沒有再看 until;老師看 teacher_until) */
  function paidLine(row) {
    if (isObj(row) && row.item === 'credits' && typeof row.credits === 'number') return '已經加入 ' + row.credits + NB + '篇批改。';
    const p = isObj(row) && isObj(row.plan) ? row.plan : null;
    const end = p ? fmtDate(p.ends_at) : '';
    if (end) {
      const s = Date.parse(p.starts_at), now = Date.parse(row.server_now);
      const later = isFinite(s) && isFinite(now) && s > now + 1000;
      return '已經開通，' + (later ? fmtDate(s) + ' 開始，' : '') + '使用到 ' + end + '。';
    }
    const a = isObj(row) && isObj(row.access) ? row.access : null;
    let until = '';
    if (a && row.item === 'student') until = fmtDate(a.paid_through) || fmtDate(a.until);
    if (a && row.item === 'teacher') until = fmtDate(a.teacher_until);
    return until ? '已經開通，使用到 ' + until + '。' : '已經開通。';
  }

  /* 付款結果頁每一種狀態的標題、說明、按鈕(pay-result.js 照這個畫) */
  const HOME = { text: '開始練習', href: 'index.html' };
  const ME = { text: '查看方案與付款', href: 'me.html' };
  const PRICING = { text: '回方案與價格', href: 'pricing.html' };
  /* 付款成功後的主要按鈕照買的項目:老師方案要到教師後台開班拿邀請碼,寫作批改到寫作練習送作文(第三輪複審) */
  const NEXT = { teacher: { text: '前往教師後台', href: 'admin.html' }, credits: { text: '前往寫作練習', href: 'writing.html' } };
  function nextAction(row) { return Object.assign({ primary: true }, (isObj(row) && NEXT[row.item]) || HOME); }
  const ASK_LINE = '有問題請寫信到 ' + MAIL + '，附上訂單編號。';
  function stateView(st) {
    const s = isObj(st) ? st.state : '';
    const row = isObj(st) && isObj(st.row) ? st.row : null;
    const line = row ? itemLine(row) : null;
    const v = (title, lines, actions, tone) => ({ title, lines: lines.filter(Boolean), actions, tone: tone || '' });
    switch (s) {
      case 'checking': return v('查詢付款結果', ['查詢中'], []);
      case 'pending': return v('處理中', [line, '還沒收到藍新金流傳回的付款結果，這一頁會自動更新。'], [], 'wait');
      case 'slow': return v('處理中', [line, (st.waited ? '等了 1 分鐘還沒收到付款結果。' : '還沒查到開通的結果。')
        + '刷卡成功的話，開通後會出現在「我的」頁的方案與付款。', ASK_LINE],
        [{ text: '再查一次', retry: true, primary: true }, ME], 'wait');
      case 'paid': return v('付款成功', [line, paidLine(row)], [nextAction(row), ME], 'ok');
      case 'unapplied': return v('已收到付款', [line, '開通需要站長處理，站長會寫信給你。', ASK_LINE],
        [Object.assign({ primary: true }, ME)], 'wait');
      case 'test': return v('測試付款成功', [line, '沒有開通任何東西。請到藍新後台退款，再到站長後台記下退款。'],
        [{ text: '前往站長後台', href: 'admin.html', primary: true }], 'ok');
      case 'failed': return v('付款沒有完成', [line, '這筆付款沒有成功，不會開通。'], [Object.assign({ primary: true }, PRICING), ME], 'bad');
      case 'cancelled': return v('付款沒有完成', [line, '如果已經刷卡成功，幾分鐘後會出現在「我的」頁的方案與付款。'],
        [Object.assign({ primary: true }, PRICING), ME], 'bad');
      case 'refunded': return v('已退款', [line, '這筆付款已經退款。'], [ME]);
      case 'missing': return v('找不到這筆訂單', ['目前登入的帳號查不到這筆訂單，請確認是付款時用的帳號。'], [PRICING]);
      case 'noorder': return v('沒有付款資料', ['這一頁沒有收到訂單編號。付款紀錄可以在「我的」頁的方案與付款查看。'], [Object.assign({ primary: true }, ME)]);
      case 'login': return v('請先登入', ['登入付款時用的帳號，才能查看付款結果。'], [{ text: '登入', login: true, primary: true }]);
      default: return v('沒辦法查詢', ['這個網站沒有開雲端帳號。'], [PRICING]);
    }
  }
  /* 這個狀態之後不會再變(pay-result.js 把焦點移到標題用) */
  function isFinal(state) { return state !== 'checking' && state !== 'pending'; }

  /* 查一筆單:my_checkout;資料庫還沒有這支函式(或呼叫失敗)就退回 my_billing 的付款紀錄找同一個訂單編號,
     找到的那一筆標上 via: 'billing'(看不出有沒有開通)。兩個都失敗才丟錯誤(poll 會再試) */
  async function lookup(o) {
    const C = cloud();
    if (!C) throw new Error('no cloud');
    try {
      const r = await C.myCheckout(o);
      return isObj(r) ? r : null;
    } catch (e) {
      const b = await C.myBilling();
      const pays = isObj(b) && Array.isArray(b.payments) ? b.payments : [];
      const p = pays.find(x => isObj(x) && x.merchant_trade_no === o);
      return p ? Object.assign({}, p, { via: 'billing' }) : null;
    }
  }

  async function refreshAfterPaid(st) {
    if (st.state !== 'paid') return;
    const C = cloud();
    try { if (C && typeof C.refreshAccess === 'function') await C.refreshAccess(); } catch (e) { /* 使用權晚一點更新而已 */ }
  }

  /* 每 3 秒查一次,最多 60 秒。有結果(成功、沒有開通、測試、失敗、已退款、查不到)就停;
     入帳成功時重新查一次使用權(PAID_UI 沒開時 refreshAccess 什麼都不做)。opts.now / opts.wait 給測試換掉時間 */
  async function poll(o, opts) {
    opts = opts || {};
    const now = opts.now || (() => Date.now());
    const wait = opts.wait || (ms => new Promise(r => setTimeout(r, ms)));
    const onState = typeof opts.onState === 'function' ? opts.onState : () => {};
    const start = now();
    for (;;) {
      let st;
      try { st = resultOf(await lookup(o)); } catch (e) { st = { state: 'pending' }; }
      if (FINAL.indexOf(st.state) > -1) {
        await refreshAfterPaid(st);
        onState(st);
        return st;
      }
      if (now() - start + POLL_MS > POLL_LIMIT_MS) {
        const slow = { state: 'slow', row: st.row, waited: true };
        onState(slow);
        return slow;
      }
      onState(st);
      await wait(POLL_MS);
    }
  }

  /* 從藍新付款頁按「返回商店」回來:只查一次,不輪詢。還在處理中(或查不到結果)就當付款沒有完成 */
  async function checkOnce(o) {
    let st;
    try { st = resultOf(await lookup(o)); } catch (e) { st = { state: 'pending' }; }
    if (st.state === 'pending') return { state: 'cancelled', row: st.row };
    await refreshAfterPaid(st);
    return st;
  }

  /* ---------- 送到藍新 ---------- */
  let paying = false;
  function busy() { return paying; }

  function submitForm(action, fields) {
    const form = document.createElement('form');
    form.setAttribute('method', 'post');
    form.setAttribute('action', action);
    form.setAttribute('accept-charset', 'UTF-8');
    FIELD_KEYS.forEach(k => {
      const input = document.createElement('input');
      input.setAttribute('type', 'hidden');
      input.setAttribute('name', k);
      input.setAttribute('value', fields[k]);
      form.append(input);
    });
    document.body.append(form);
    form.submit();
  }

  function isoOk(s) { return typeof s === 'string' && /^\d{4}-\d\d-\d\dT/.test(s) && isFinite(Date.parse(s)); }

  /* 建單並整頁送到藍新。正在送就回 null(連按兩次只建一張單);成功後維持「送出中」直到離開這一頁 */
  async function pay(sku, consentAt) {
    if (paying) return null;
    if (!isoOk(consentAt)) throw new Error('請先勾選同意。');
    if (!findItem(sku)) throw new Error('找不到這個方案，請重新整理頁面再試。');
    const C = cloud();
    if (!C || typeof C.startCheckout !== 'function') throw new Error('這個網站沒有開雲端帳號。');
    paying = true;
    try {
      const r = validResponse(await C.startCheckout(sku, consentAt));
      if (!r) throw new Error('付款資料不完整，請稍後再試。');
      rememberOrder(r.order_no);
      submitForm(r.action, r.fields);
      return r.order_no;
    } catch (e) {
      paying = false;
      throw e;
    }
  }
  function reset() { paying = false; }

  /* ---------- 價格頁畫面 ---------- */
  const X_ICON = '<svg viewBox="0 0 22 22" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">'
    + '<path d="M5 5 17 17M17 5 5 17"/></svg>';

  function trapTab(box, e) {
    if (e.key !== 'Tab') return;
    const f = Array.from(box.querySelectorAll('button,input,a[href]')).filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    const a = document.activeElement;
    const atFirst = a === first || (first.type === 'radio' && a && a.type === 'radio' && a.name === first.name);
    const atLast = a === last || (last.type === 'radio' && a && a.type === 'radio' && a.name === last.name);
    if (!box.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && atFirst) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && atLast) { e.preventDefault(); first.focus(); }
  }

  /* 購買視窗:選項目、勾選同意、前往付款。勾選才能按;按下去整個視窗鎖住(標成忙碌),直到離開這一頁或出錯 */
  function buyDialog(group, returnTo) {
    if (document.querySelector('.modal-mask')) return;
    const C = cloud();
    const access = C && isObj(C.access) ? C.access : null;
    const allowed = group === 'teacher' ? teacherSkus(access) : null;
    const items = catalog().filter(x => x.group === group && (!allowed || allowed.indexOf(x.sku) > -1));
    if (!items.length) return;
    let consentAt = null, sending = false;
    /* buy-mask:老師方案的視窗比筆電、手機的畫面高,外框要能捲動(style.css) */
    const mask = h('div', { class: 'modal-mask buy-mask' });
    const box = h('div', { class: 'modal modal-auth modal-trial modal-buy', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'buy-h' });
    const closeBtn = h('button', { class: 'modal-close', type: 'button', 'aria-label': '關閉', html: X_ICON, onclick: () => close() });
    const radios = items.map((it, i) => {
      const input = h('input', { type: 'radio', name: 'buy-sku', value: it.sku });
      if (i === 0) input.checked = true;
      return input;
    });
    const opts = items.map((it, i) => h('label', { class: 'buy-opt' }, radios[i], h('span', { class: 'buy-opt-name' }, it.label), h('span', { class: 'buy-opt-amt' }, money(it.amount))));
    const note = h('p', { class: 'buy-note' });
    const agree = h('input', { type: 'checkbox', id: 'buy-consent', name: 'buy-consent', 'aria-describedby': 'buy-def' });
    const msg = h('p', { class: 'auth-msg', role: 'alert' });
    const submit = h('button', { class: 'btn primary auth-submit buy-submit', type: 'submit', disabled: 'disabled' }, SAY.submit);
    const cancel = h('button', { class: 'btn auth-full trial-cancel', type: 'button', onclick: () => close() }, '取消');
    const form = h('form', { class: 'auth-form', novalidate: 'novalidate' },
      items.length > 1
        ? h('fieldset', { class: 'buy-opts' }, h('legend', { class: 'buy-legend' }, '選擇項目'), h('div', { class: 'buy-opt-list' }, opts))
        : h('div', { class: 'buy-opts' }, h('div', { class: 'buy-opt-list' }, opts)),
      note,
      h('label', { class: 'buy-consent', for: 'buy-consent' }, agree, h('span', null, CONSENT_TEXT)),
      h('p', { class: 'buy-def', id: 'buy-def' }, group === 'teacher' ? CONSENT_DEF_TEACHER : group === 'credits' ? CONSENT_DEF_CREDITS : CONSENT_DEF),
      msg, submit, cancel);
    /* 標題可以拿焦點:送出時按鈕停用,焦點先移到這裡,不會掉到視窗後面的頁面 */
    const head = h('h2', { class: 'auth-h', id: 'buy-h', tabindex: '-1' }, GROUPS[group].title);
    box.append(closeBtn,
      head,
      h('p', { class: 'trial-who' }, (C && C.user && C.user.email) || ''),
      form,
      h('p', { class: 'auth-fine' }, '只接受信用卡，按「前往付款」後到藍新金流的付款頁刷卡。勾選的說明在',
        h('a', { href: 'terms.html', target: '_blank', rel: 'noopener' }, '服務條款'), '的消費者權益，退款的條件在',
        h('a', { href: 'refund.html', target: '_blank', rel: 'noopener' }, '退款政策'), '。'));
    if (items.length === 1) radios[0].hidden = true;
    mask.append(box);
    document.body.append(mask);

    const picked = () => radios.find(r => r.checked) || null;
    const skuOf = r => r.getAttribute('value');
    /* 起算說明跟著選的項目換;班級提供練習功能的學生另外寫一句 */
    function showNote() {
      const p = picked();
      const lines = [group === 'student' && access && access.active === true && access.source === 'class' ? SAY.byClass : null,
        p ? startNote(skuOf(p), access) : null].filter(Boolean);
      note.textContent = lines.join('');
      note.hidden = !lines.length;
    }
    showNote();
    radios.forEach(r => r.addEventListener('change', showNote));

    agree.addEventListener('change', () => {
      consentAt = agree.checked ? new Date().toISOString() : null;
      submit.disabled = !agree.checked || sending;
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (sending || !agree.checked || !consentAt) return;
      const p = picked();
      if (!p) return;
      /* 按鈕停用前把焦點移到標題;正在前往付款頁寫在提示區(role=alert),讀螢幕軟體才聽得到。
         按鈕上也寫同一句,提示區就只給讀螢幕軟體(buy-sending 看不到),畫面上不會出現兩次(第三輪複審) */
      head.focus();
      msg.textContent = SAY.sending; msg.className = 'auth-msg buy-sending';
      sending = true;
      lock(true);
      try {
        const o = await pay(skuOf(p), consentAt);
        if (o === null) { sending = false; lock(false); msg.textContent = ''; msg.className = 'auth-msg'; submit.focus(); }
      } catch (err) {
        sending = false;
        lock(false);
        msg.textContent = err.message || '暫時無法建立付款，請稍後再試。';
        msg.className = 'auth-msg bad';
        /* 送出時按鈕停用,瀏覽器把焦點丟到 body;放回視窗裡,鍵盤與讀螢幕軟體才不會停在後面的頁面 */
        (submit.disabled ? agree : submit).focus();
      }
    });
    function lock(on) {
      radios.concat([agree, submit, cancel, closeBtn]).forEach(x => { x.disabled = on; });
      submit.textContent = on ? SAY.sending : SAY.submit;
      if (on) box.setAttribute('aria-busy', 'true'); else box.removeAttribute('aria-busy');
      if (!on) submit.disabled = !agree.checked;
    }
    function onKey(e) {
      if (e.key === 'Escape') { if (!sending) close(); return; }
      trapTab(box, e);
    }
    document.addEventListener('keydown', onKey);
    mask.addEventListener('mousedown', e => { if (e.target === mask && !sending) close(); });
    /* 從藍新按上一頁回來(頁面從快取還原):視窗關掉,按鈕恢復 */
    window.addEventListener('pageshow', e => { if (e.persisted) { sending = false; close(); } });
    (radios.find(r => !r.hidden) || agree).focus();

    function close() {
      if (sending) return;
      document.removeEventListener('keydown', onKey);
      mask.remove();
      try { if (returnTo && returnTo.isConnected) returnTo.focus(); } catch (e) {}
    }
  }

  function openLogin() {
    if (window.PROFILE && typeof window.PROFILE.showLogin === 'function') window.PROFILE.showLogin('login');
    else location.href = 'signup.html?mode=login';
  }

  /* 一組的購買區:說明(有的話)與按鈕(slot.button 是 true 才放) */
  function buySlot(group, signedIn, slot) {
    const s = slot || { button: true, note: null };
    const box = h('div', { class: 'pricing-buy' });
    if (s.note) box.append(h('p', { class: 'pricing-buy-note' }, s.note));
    if (s.button) {
      const btn = h('button', { class: 'btn primary pricing-buy-btn', type: 'button' }, signedIn ? GROUPS[group].title : '登入後購買');
      btn.addEventListener('click', () => { if (signedIn) buyDialog(group, btn); else openLogin(); });
      box.append(btn);
    }
    return box;
  }

  function place(main, group, signedIn, slot) {
    if (group === 'test') {
      const sec = h('section', { class: 'pricing-plan pricing-test', 'aria-labelledby': 'pricing-test' },
        h('h2', { id: 'pricing-test' }, '站長測試'),
        h('p', null, '只有站長看得到。在正式環境刷 10' + NB + '元，確認付款與開通通知正常，刷完到藍新後台退款。'),
        buySlot(group, signedIn, slot));
      const after = document.getElementById('pricing-correction');
      const anchor = after && after.closest('section');
      if (anchor) anchor.after(sec); else main.append(sec);
      return;
    }
    const head = document.getElementById(GROUPS[group].anchor);
    const sec = head && head.closest('section');
    if (!sec) return;
    const price = sec.querySelector('.pricing-opts, .pricing-table-wrap');
    const el = buySlot(group, signedIn, slot);
    if (price) price.after(el); else sec.append(el);
  }

  async function initPricing() {
    const main = document.querySelector('main.pricing');
    const C = cloud();
    if (!main || !C) return;
    try { await C.ready; } catch (e) { /* 照沒登入處理 */ }
    try { await C.accessReady; } catch (e) { /* 使用權不知道:老師方案不顯示 */ }
    const signedIn = !!C.user;
    const paytest = paytestFlag(location.search);
    const owner = signedIn && paytest ? await C.isOwner() : false;
    const o = { paidUi: window.PAID_UI === true, signedIn, access: C.access, owner, paytest };
    groupsFor(o).forEach(g => place(main, g, signedIn, slotFor(g, o)));
  }

  window.CHECKOUT = { CONSENT_TEXT, CONSENT_DEF, CONSENT_DEF_TEACHER, CONSENT_DEF_CREDITS, catalog, slotFor, groupsFor, teacherSkus, startNote, paytestFlag, backFlag, orderNoOk, validResponse, rememberOrder, lastOrder, orderFromPage,
    resultOf, itemText, stateView, isFinal, lookup, poll, checkOnce, pay, busy, reset, buySlot, buyDialog };

  /* 從藍新的付款頁按上一頁回來,頁面可能從瀏覽器快取還原:按鈕要能再按 */
  window.addEventListener('pageshow', e => { if (e && e.persisted) reset(); });

  const C = cloud();
  if (C && C.enabled && (window.PAID_UI === true || paytestFlag(location.search))) {
    document.addEventListener('DOMContentLoaded', initPricing);
  }
})();
