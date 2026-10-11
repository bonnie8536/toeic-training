/* 站長後台「收費管理」的共用部分(前端計畫九;tools/test_owner_accounts.js 用 fixture 測)。
   - 只有 window.PAID_UI === true 而且 CLOUD.access.is_owner === true 才掛上(mount 自己再檢查一次);
     沒開時這幾支檔案只定義 window.ADMIN_OWNER,一個節點都不碰、一個函式都不呼叫。
   - 寫入只走 owner_* 函式(資料庫在裡面檢查站長並寫異動紀錄),不直接寫任何表。
   - 改角色、移出、搬班、撤銷、退款都先跳確認框寫出後果;退款要再按一次。
   - 使用者自己填的字(名字、班名、備註)一律用 textContent 或文字節點。
   - 日期一律用台北時間顯示(跟 js/paywall.js、js/admin-classes.js 一樣);資料庫的錯誤訊息原樣顯示。
   做法參考 Stripe 的客戶清單與客戶頁、Supabase 的 Authentication 使用者清單、Google Workspace 管理控制台的使用者:
   上方一排篩選、一個搜尋框、每頁固定筆數加上一頁下一頁;點進去是單一帳號頁,一段一段列出訂閱、付款、異動紀錄,
   退款與撤銷在那一列上,按下去先跳確認視窗寫清楚後果。 */
(function () {
  const TZ_MS = 8 * 3600e3;
  const PAGE = 50;
  const DEBOUNCE_MS = 300;
  const NET_MSG = '連不上雲端伺服器，請檢查網路後再試。';
  const X_ICON = '<svg viewBox="0 0 22 22" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">'
    + '<path d="M5 5 17 17M17 5 5 17"/></svg>';

  /* 帳號清單的分類(對應 owner_accounts 的 p_filter,前端計畫九.8);sub 是老師旁邊的四個小按鈕 */
  const FILTERS = [
    { key: 'all', label: '全部' }, { key: 'owner', label: '站長' }, { key: 'teacher', label: '老師' },
    { key: 'teacher_active', label: '期內', sub: true }, { key: 'teacher_grace', label: '寬限中', sub: true },
    { key: 'teacher_expired', label: '已過期', sub: true }, { key: 'teacher_none', label: '還沒有方案', sub: true },
    { key: 'legacy', label: '既有帳號' }, { key: 'paid', label: '付費' }, { key: 'comp', label: '贈送' },
    { key: 'class', label: '班級涵蓋' }, { key: 'trial', label: '試用中' }, { key: 'expired', label: '沒有使用權' },
  ];
  const SOURCE = { legacy: '既有帳號', paid: '付費', comp: '贈送', trial: '試用' };
  const METHOD = { bank: '轉帳', linepay: 'LINE Pay', cash: '現金', other: '其他', ecpay: '綠界', newebpay: '藍新' };
  const PAY_STATE = { paid: '已付款', pending: '處理中', failed: '未完成' };
  const CREDIT = { purchase: '購買', correction: '批改', refund: '退款收回', adjust: '更正' };

  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const arr = v => (Array.isArray(v) ? v.filter(isObj) : []);
  const str = v => (v === null || v === undefined ? '' : String(v));

  /* ---------- 日期與數字 ---------- */
  function ymd(iso) {
    if (typeof iso !== 'string' || !iso) return null;
    const t = Date.parse(iso);
    if (!isFinite(t)) return null;
    const d = new Date(t + TZ_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mi: d.getUTCMinutes() };
  }
  const two = n => (n < 10 ? '0' : '') + n;
  function fmtDate(iso) { const p = ymd(iso); return p ? p.y + '/' + two(p.m) + '/' + two(p.d) : ''; }
  function fmtTime(iso) { const p = ymd(iso); return p ? fmtDate(iso) + ' ' + two(p.hh) + ':' + two(p.mi) : ''; }
  /* 跟現在同一年寫「10 月 13 日」,不同年寫「2027/01/03」 */
  function dayText(iso, nowIso) {
    const p = ymd(iso), n = ymd(nowIso) || ymd(new Date().toISOString());
    if (!p) return '';
    return n && n.y === p.y ? p.m + ' 月 ' + p.d + ' 日' : fmtDate(iso);
  }
  /* 「2027/01/03」後面接中文要空一格,「10 月 13 日」不用 */
  const before = d => d + (d.indexOf('/') >= 0 ? ' ' : '');
  const creditsLeft = n => '寫作批改剩 ' + Math.max(0, Number(n) || 0) + ' 篇';
  function money(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' 元'; }
  function nowOf(iso) { const t = Date.parse(iso); return isFinite(t) ? t : Date.now(); }

  /* 日期選擇器的值(YYYY-MM-DD)→ 那一天台北時間結束的時刻;不存在的日期回 null */
  function untilFromDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(v).trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return m[1] + '-' + m[2] + '-' + m[3] + 'T23:59:59+08:00';
  }
  /* ISO → 日期選擇器的值(台北時間) */
  function dateInput(iso) { const p = ymd(iso); return p ? p.y + '-' + two(p.m) + '-' + two(p.d) : ''; }
  /* 預設到期日:台北時間的今天加一個月(1 月 31 日 → 2 月 28 日) */
  function defaultUntilDate(nowMs) {
    const d = new Date((typeof nowMs === 'number' ? nowMs : Date.now()) + TZ_MS);
    let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    m += 1; if (m > 12) { m = 1; y += 1; }
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return y + '-' + two(m) + '-' + two(Math.min(day, last));
  }

  /* ---------- 帳號清單的文字(前端計畫九.8) ---------- */
  function displayName(r) {
    if (!isObj(r)) return '';
    const n = str(r.name).trim();
    if (n) return n;
    const e = str(r.email);
    if (e) return e.split('@')[0] || e;
    return str(r.user_id).slice(0, 8);
  }
  function roleText(r) { const x = isObj(r) ? r.role : ''; return x === 'owner' ? '站長' : x === 'teacher' ? '老師' : '學生'; }
  /* 當過老師:現在是老師、被站長改成學生,或名下有班(資料庫另外看進度裡的學生備註,那個前端看不到,擋下時錯誤原樣顯示) */
  function isExTeacher(r) { return isObj(r) && (r.role === 'teacher' || r.role === 'owner' || r.demoted === true || arr(r.own_classes).length > 0); }
  /* 加入的班沒有涵蓋時的原因(用字照 2026-10-11 的決定) */
  function reasonText(c) {
    if (!isObj(c) || c.covered === true) return '';
    return c.reason === 'expired' ? '老師方案已到期' : c.reason === 'over_seats' ? '超過老師的名額' : '';
  }

  /* 使用狀態(前端計畫六.1 的順序,跟「我的」頁同一套):站長與靠老師方案撐著的列不寫(老師那一行寫) */
  function statusText(a, nowIso) {
    if (!isObj(a) || a.source === 'owner' || a.plan === 'owner') return '';
    const paid = Date.parse(a.paid_through);
    if (isFinite(paid) && paid > nowOf(nowIso)) {
      return (Array.isArray(a.rights) && a.rights.indexOf('paid') < 0 ? '使用到 ' : '已付費，到 ') + fmtDate(a.paid_through);
    }
    if (a.plan === 'teacher') return '';
    if (a.source === 'class') return '由班級提供' + (a.until ? '，到 ' + fmtDate(a.until) : '');
    if (a.source === 'trial') return '試用到 ' + dayText(a.until || a.trial_until, nowIso);
    if (a.active === false) return '使用期限已到';
    return a.until ? '使用到 ' + fmtDate(a.until) : '使用期限 無';
  }

  /* 老師那一行:方案 30 人,已用 12 人,到 2026/11/04;寬限中寫寬限到幾號 */
  function teacherText(t, nowIso) {
    if (!isObj(t)) return '';
    const used = typeof t.seats_used === 'number' ? '已用 ' + t.seats_used + ' 人' : '';
    if (t.state === 'owner') return ['名額不限', used].filter(Boolean).join('，');
    if (t.state === 'none') return '還沒有方案';
    if (t.state === 'expired') return '方案已過期';
    const label = t.source === 'trial' ? '試用' : '方案';
    const seats = typeof t.seats === 'number' && t.seats > 0 ? label + ' ' + t.seats + ' 人' : label + '名額不限';
    const tail = t.state === 'grace' ? (t.grace_until ? '寬限到 ' + dayText(t.grace_until, nowIso) : '寬限中')
      : (t.plan_until ? '到 ' + fmtDate(t.plan_until) : '');
    return [seats, used, tail].filter(Boolean).join('，');
  }
  /* my_access 形狀(查帳號頁)轉成老師那一行要的欄位 */
  function teacherOf(a) {
    if (!isObj(a) || !(a.role === 'teacher' || a.is_owner === true)) return null;
    const state = a.is_owner === true ? 'owner' : a.teacher_active === true ? 'active' : a.teacher_in_grace === true ? 'grace'
      : !a.teacher_source ? 'none' : 'expired';
    return { state, source: a.teacher_source, seats: a.seats, seats_used: a.seats_used, plan_until: a.teacher_until, grace_until: a.teacher_grace_until };
  }

  /* ---------- 改角色(前端計畫九.9) ---------- */
  /* 老師改成學生的確認框:依序寫後果,他自己的使用權照查帳號讀到的每一段使用權寫
     (rights 會把老師方案的來源也算進去,分不出是學生的還是老師的,所以看 grants) */
  function demoteLines(r, look, ownerId, nowIso) {
    const now = nowOf(nowIso);
    const lines = ['他的老師方案會立刻結束，沒有寬限（包括已經預付、還沒開始的）。'];
    const open = arr(r && r.own_classes).filter(c => c.active !== false).length;
    if (open) lines.push('他的 ' + open + ' 個班會停用，不能再加入。');
    lines.push('班上的學生名單會留著，但不再由他的方案提供使用權。');
    lines.push('他自己沒有試用。');
    const live = arr(look && look.grants).filter(g => g.kind === 'student' && !g.revoked_at && (!g.ends_at || Date.parse(g.ends_at) > now));
    const has = s => live.some(g => g.source === s);
    if (has('legacy') && has('comp')) lines.push('他的既有帳號無期限與妳贈送的學生方案會一起撤銷。');
    else if (has('legacy')) lines.push('他的既有帳號無期限會一起撤銷。');
    else if (has('comp')) lines.push('妳贈送的學生方案會一起撤銷。');
    const cls = arr(r && r.classes);
    const inOwner = cls.some(c => c.teacher_id === ownerId);
    const inOther = cls.some(c => c.teacher_id !== ownerId && c.covered === true);
    const paid = paidAfterDemote(look, now);
    if (paid.list.length) {
      lines.push(paid.end ? '他自己付費的學生方案保留到 ' + fmtDate(new Date(paid.end).toISOString()) + '。' : '他自己付費的學生方案保留。');
      if (paid.moved) lines.push('他試用中付的學生方案會提前到今天開始。');
      if (paid.later) {
        const at = '他付費的學生方案 ' + fmtDate(new Date(paid.later).toISOString()) + ' 才開始';
        lines.push(inOwner || inOther ? at + '。' : at + '，這之前沒有使用權。');
      }
    }
    if (inOwner) lines.push('他在妳的班上，妳的班照樣讓他免費使用；要收回請把他移出妳的班。');
    if (inOther) lines.push('他在其他老師的班上，那個班照樣提供使用權。');
    if (!paid.list.length && !inOwner && !inOther) lines.push('改完之後要付費才能使用。');
    return lines;
  }

  /* 改成學生之後他自己付費的學生方案(照 owner_set_role 第 4 步):試用還沒結束時,排在試用結束以後的付費方案
     起訖一起往前移(試用剩下的時間);其他的不動。回 { list, moved: 往前移幾段, end: 最晚的到期, later: 現在沒有時最早幾時開始 } */
  function paidAfterDemote(look, now) {
    const trialEnd = Date.parse(isObj(look) && isObj(look.access) ? look.access.trial_until : '');
    const shift = isFinite(trialEnd) && trialEnd > now ? trialEnd - now : 0;
    let moved = 0;
    const list = arr(look && look.grants)
      .filter(g => g.kind === 'student' && g.source === 'paid' && !g.revoked_at && (!g.ends_at || Date.parse(g.ends_at) > now))
      .map(g => {
        const s = Date.parse(g.starts_at), e = g.ends_at ? Date.parse(g.ends_at) : Infinity;
        const by = shift && s >= trialEnd ? shift : 0;
        if (by) moved++;
        return { start: s - by, end: e - by };
      });
    const end = list.reduce((m, x) => Math.max(m, x.end), 0);
    const nowCovered = list.some(x => x.start <= now);
    const later = list.length && !nowCovered ? list.reduce((m, x) => Math.min(m, x.start), Infinity) : 0;
    return { list, moved, end: isFinite(end) ? end : 0, later };
  }

  function ownGrantsText(list, done) {
    const s = new Set(arr(list).map(g => g.source));
    const tail = done ? '已撤銷（要讓他繼續免費，到查帳號頁按恢復）。' : '會一起撤銷。';
    if (s.has('legacy') && s.has('comp')) return '他自己的既有帳號無期限與妳贈送的學生方案' + tail;
    if (s.has('legacy')) return '他自己的既有帳號無期限' + tail;
    if (s.has('comp')) return '妳贈送的學生方案' + tail;
    return '';
  }

  /* 改完之後他自己靠什麼(有就寫來源);現在沒有,但付過的學生方案之後才開始,寫幾號開始(look 是改之前讀的查帳號資料) */
  function selfAccessText(a, row, ownerId, look) {
    if (!isObj(a)) return '';
    if (a.active !== true) {
      const now = nowOf(a.server_now);
      const later = arr(look && look.grants).filter(g => g.kind === 'student' && g.source === 'paid' && !g.revoked_at && Date.parse(g.starts_at) > now)
        .map(g => g.starts_at).sort()[0];
      return later ? '他自己付費的學生方案 ' + fmtDate(later) + ' 才開始，這之前沒有使用權。' : '他自己現在沒有使用權，要付費才能使用。';
    }
    let label = '';
    if (a.source === 'class') {
      const mine = new Set(arr(row && row.classes).filter(c => c.teacher_id === ownerId).map(c => c.class_id));
      label = arr(a.classes).some(c => c.covered === true && mine.has(c.class_id)) ? '妳的班' : '由班級提供';
    } else label = { paid: '自己付費', comp: '贈送', legacy: '既有帳號', trial: '試用' }[a.source] || '';
    return '他自己仍有使用權' + (label ? '（' + label + '）' : '') + '。';
  }

  function demoteResult(res, row, ownerId, look) {
    if (!isObj(res)) return [];
    const lines = [];
    const n = arr(res.grants_ended).length;
    lines.push(n ? '已結束 ' + n + ' 段老師方案。' : '他沒有還在進行的老師方案。');
    if (res.paid_grants_ended > 0) lines.push('其中 ' + res.paid_grants_ended + ' 段是付費的，付款沒有退，要退款請到查帳號頁。');
    const own = ownGrantsText(res.own_grants_ended, true);
    if (own) lines.push(own);
    if (res.paid_moved_up > 0) lines.push('他試用中付的學生方案提前到今天開始。');
    const k = arr(res.classes_closed).length;
    if (k) lines.push('停用 ' + k + ' 個班。');
    const st = Number(res.students) || 0, still = Number(res.students_still_active) || 0;
    if (st > 0) lines.push(still >= st ? '班上 ' + st + ' 位學生都靠自己的使用權仍可使用。'
      : '班上 ' + st + ' 位學生，其中 ' + still + ' 位靠自己的使用權仍可使用，其他人需要付費。');
    const self = selfAccessText(res.access, row, ownerId, look);
    if (self) lines.push(self);
    return lines;
  }

  /* 學生改成老師:之前被改成學生時停用過的班才有二選一;n = 那些班的人數加總(只是估計) */
  function promoteChoice(r) {
    if (!isObj(r) || r.role !== 'student') return null;
    const off = arr(r.own_classes).filter(c => c.active === false);
    if (!off.length) return null;
    return { closed: off.length, n: off.reduce((s, c) => s + (Number(c.members) || 0), 0) };
  }

  function promoteResult(res) {
    const out = { lines: [], warns: [], codes: [], others: [] };
    if (!isObj(res)) return out;
    const seats = typeof res.seats === 'number' ? res.seats + ' 人' : '名額不限';
    out.lines.push('已改成老師，方案 ' + seats + (res.until ? '，到 ' + fmtDate(res.until) : '') + '。');
    const re = arr(res.classes_reopened).length;
    if (re) out.lines.push('重新啟用 ' + re + ' 個班，邀請碼不變。');
    if (isObj(res.new_class)) out.lines.push('開了新班「' + str(res.new_class.name) + '」。');
    if (Number(res.old_members) > 0) out.lines.push('停用的舊班還有 ' + res.old_members + ' 位學生，仍算名額。');
    if (res.over_seats === true) out.warns.push('他的學生有 ' + res.seats_used + ' 人，超過名額 ' + res.seats + ' 人，超過的人依加入先後沒有班級使用權。');
    out.codes = arr(res.classes).filter(c => c.active !== false).map(c => ({ name: str(c.name), code: str(c.code) }));
    out.others = arr(res.member_of_other_teachers).map(c => ({ class_id: c.class_id, class_name: str(c.class_name), teacher_email: str(c.teacher_email),
      text: '他是 ' + str(c.teacher_email) + ' 的班「' + str(c.class_name) + '」的成員，他之後寫給自己學生的備註那位老師看得到，建議先把他移出。' }));
    return out;
  }

  /* ---------- 搬班級(前端計畫九.10) ---------- */
  function moveResult(res, graceDay) {
    const out = { lines: [], warns: [] };
    if (!isObj(res)) return out;
    if (isObj(res.removed)) out.lines.push('已把他移出「' + str(res.removed.class_name) + '」。');
    const a = res.added;
    if (!isObj(a)) return out;
    out.lines.push(a.already_member ? '本來就在「' + str(a.class_name) + '」這個班。' : '已加入「' + str(a.class_name) + '」（' + str(a.teacher_email) + '）。');
    if (res.over_seats === true) out.warns.push('已超過這位老師的名額（' + res.seats + ' 人，現在 ' + res.seats_used + ' 人），超過名額的學生依加入先後沒有班級使用權。');
    if (res.teacher_live === false) out.warns.push('這位老師的方案已過期，加入後沒有班級使用權。');
    else if (res.teacher_active === false) {
      out.warns.push('這位老師的方案在寬限中，' + (graceDay ? before(graceDay) + '之後' : '寬限結束後') + '這位學生就沒有班級使用權。');
    }
    if (res.covered === true) out.lines.push('已由這個班提供使用權。');
    return out;
  }

  /* 移出前的確認(都是後果) */
  function leaveLines(r, c, ownerId) {
    const lines = ['只會刪掉他在這個班的成員資料，學習記錄不會刪除。'];
    const mine = c.teacher_id === ownerId;
    if (c.covered === true) lines.push(mine ? '他會失去妳的班提供的免費使用。' : '他會失去這個班提供的使用權。');
    const sameTeacher = arr(r && r.classes).some(x => x.class_id !== c.class_id && x.teacher_id === c.teacher_id);
    if (!sameTeacher) lines.push(mine ? '移出後，妳的學生進度表裡不會再有他。' : '移出後，這位老師看不到他的進度。');
    return lines;
  }

  /* 搬到別班的確認:先寫步驟,再寫離開原本的班的後果。新班要等送出邀請碼才知道是誰的,所以寫成「如果」;
     當過老師的人只能搬進她的班,新班一定是她的 */
  function moveLines(r, c, ownerId, ex) {
    const lines = ['會先把他移出「' + str(c.class_name) + '」，再加入新的班；同一位老師的兩個班之間搬，會沿用原本的加入時間。'];
    if (ex) lines.push('他當過老師，只能加進妳的班。');
    const mine = c.teacher_id === ownerId;
    const NEW = '新班老師的方案過期或名額已滿時，他就沒有班級使用權。';
    if (c.covered === true) {
      if (ex) { if (!mine) lines.push('他之後改由妳的班提供免費使用。'); }
      else lines.push(mine ? '如果新班不是妳的班，他會失去妳的班提供的免費使用；' + NEW : '他之後改由新的班提供使用權；' + NEW);
    }
    const sameTeacher = arr(r && r.classes).some(x => x.class_id !== c.class_id && x.teacher_id === c.teacher_id);
    if (!sameTeacher && !(ex && mine)) {
      lines.push(mine ? '如果新班不是妳的班，妳的學生進度表裡不會再有他。' : ex ? '原本的老師會看不到他的進度。' : '如果新班是別位老師的，原本的老師就看不到他的進度。');
    }
    return lines;
  }

  /* 視窗裡寫帳號:名字是本人自己填的(可能撞名、可能故意取得像別人),一定加上完整 Email */
  function fullWho(r) {
    const n = isObj(r) ? str(r.name).trim() : '';
    const e = isObj(r) ? str(r.email) || str(r.user_id) : '';
    return n ? '「' + n + '」（' + e + '）' : '「' + e + '」';
  }

  /* ---------- 查帳號(前端計畫九.2) ---------- */
  function grantLabel(g) {
    if (!isObj(g)) return '';
    if (g.kind === 'teacher') {
      const seats = typeof g.seats === 'number' && g.seats > 0 ? ' ' + g.seats + ' 人' : ' 名額不限';
      return (g.source === 'trial' ? '老師試用' : '老師方案 ' + (SOURCE[g.source] || '')) + seats;
    }
    return '學生方案 ' + (SOURCE[g.source] || '');
  }
  function grantText(g) {
    if (!isObj(g)) return '';
    const from = fmtDate(g.starts_at);
    return grantLabel(g) + ' ' + (g.ends_at ? from + ' 到 ' + fmtDate(g.ends_at) : from + ' 起，無期限');
  }
  function grantState(g, nowIso) {
    if (!isObj(g)) return '';
    const now = nowOf(nowIso);
    if (g.revoked_at) return '已撤銷';
    if (g.ends_at && Date.parse(g.ends_at) <= now) return '已結束';
    if (Date.parse(g.starts_at) > now) return '還沒開始';
    return '使用中';
  }
  function payItem(p) {
    if (p.item === 'student') return '學生方案 ' + p.months + ' 個月';
    if (p.item === 'teacher') return '老師方案 ' + p.seats + ' 人 ' + p.months + ' 個月';
    if (p.item === 'credits') return '寫作批改 ' + p.credits + ' 篇';
    return str(p.item);
  }
  function paymentText(p) {
    if (!isObj(p)) return null;
    return { when: fmtDate(p.paid_at || p.created_at), item: payItem(p), amount: money(p.amount), method: METHOD[p.method] || str(p.method),
      state: p.status === 'refunded' ? '已退款 ' + money(p.refund_amount == null ? p.amount : p.refund_amount) : (PAY_STATE[p.status] || str(p.status)),
      note: str(p.note) };
  }
  function creditText(l) {
    if (!isObj(l)) return null;
    const d = Number(l.delta) || 0;
    return { when: fmtDate(l.created_at), text: (CREDIT[l.reason] || str(l.reason)) + ' ' + (d > 0 ? '加 ' : '扣 ') + Math.abs(d) + ' 篇', note: noteText(l.ref || l.note) };
  }

  /* 資料庫自己寫進去的備註(supabase_paid_access.sql)用的是半形標點與「點數」;換成畫面的寫法或不顯示
     (購買、退款收回前面已經寫了)。好幾段用「 / 」接起來,一段一段換;站長自己打的那一段原樣留著。 */
  const SYS_NOTES = {
    '購買批改點數': '', '退款收回未使用的點數': '',
    '收費上線前的既有帳號，無期限沿用（2026-10-04 站長決定）': '收費上線前的既有帳號',
    '收費上線前的既有老師帳號，名額不限（2026-10-04 站長決定）': '收費上線前的既有老師帳號',
    '站長改成學生，老師方案立刻結束': '站長改成學生，老師方案立刻結束',
    '站長改成學生，沒有付費的使用權一起結束（要付費才能用）': '站長改成學生，沒有付費的使用權一起結束',
    '站長改成學生，試用結束，排在試用後面的方案提前開始': '站長改成學生，試用結束，排在試用後面的方案提前開始',
  };
  const fullPunct = s => s.replace(/,/g, '，').replace(/\(/g, '（').replace(/\)/g, '）');
  function noteText(v) {
    return str(v).split(' / ').map(p => {
      const k = fullPunct(p.trim());
      return Object.prototype.hasOwnProperty.call(SYS_NOTES, k) ? SYS_NOTES[k] : p;
    }).filter(Boolean).join('；');
  }

  function grantChange(o, n) {
    const label = grantLabel(n);
    if (!o.revoked_at && n.revoked_at) return '撤銷 ' + label;
    if (o.revoked_at && !n.revoked_at) return '恢復 ' + label;
    if (str(o.ends_at) !== str(n.ends_at)) return label + (n.ends_at ? ' 到期日改成 ' + fmtDate(n.ends_at) : ' 拿掉到期日');
    if (str(o.starts_at) !== str(n.starts_at)) return label + ' 開始日改成 ' + fmtDate(n.starts_at);
    return '修改 ' + label;
  }
  /* 異動紀錄的一列:誰、做了什麼(看不懂的動作照原樣寫表名與動作) */
  function historyText(x, ownerId, look) {
    if (!isObj(x)) return null;
    const o = isObj(x.old_row) ? x.old_row : {}, n = isObj(x.new_row) ? x.new_row : {};
    const who = !x.actor ? '系統' : x.actor === ownerId ? '站長' : (isObj(look) && x.actor === look.user_id) ? '本人' : '其他帳號';
    const names = {};
    arr(look && look.joined).forEach(c => { names[c.class_id] = c.name; });
    arr(look && look.classes).forEach(c => { names[c.id] = c.name; });
    const cname = id => (names[id] ? '「' + str(names[id]) + '」' : '');
    let text = '';
    switch (x.tbl + ':' + x.action) {
      case 'entitlements:insert': text = '新增 ' + grantText(n); break;
      case 'entitlements:update': text = grantChange(o, n); break;
      case 'payments:insert': text = '記一筆付款 ' + payItem(n) + ' ' + money(n.amount); break;
      case 'payments:update': text = n.status === 'refunded' ? '退款 ' + money(n.refund_amount) : '付款紀錄更新'; break;
      case 'credit_ledger:insert': text = creditText(n).text; break;
      case 'account_roles:insert': case 'account_roles:update': text = '角色紀錄改成' + (n.role === 'teacher' ? '老師' : '學生'); break;
      case 'classes:deactivate': text = '停用班級「' + str(n.name) + '」'; break;
      case 'classes:reactivate': text = '重新啟用班級「' + str(n.name) + '」'; break;
      case 'classes:open': text = '開新班「' + str(n.name) + '」'; break;
      case 'memberships:owner_add': text = '站長把他加入班級' + cname(x.row_id); break;
      case 'memberships:owner_remove': text = '站長把他移出班級' + cname(x.row_id); break;
      case 'owner_set_role:demote': text = '改成學生'; break;
      case 'owner_set_role:promote': text = '改成老師' + (typeof n.seats === 'number' ? '，方案 ' + n.seats + ' 人' : ''); break;
      default: text = str(x.tbl) + ' ' + str(x.action);
    }
    return { when: fmtTime(x.at), who, text, note: x.tbl === 'entitlements' && x.action === 'insert' ? '' : noteText(n.note) };
  }

  /* ---------- 呼叫資料庫(只有 owner_*) ----------
     回 { ok, data } 或 { ok: false, message, net };net 是連不上:要求可能已經送到資料庫,只是沒收到回覆 */
  /* 跟 js/cloud.js 同一組字;資料庫回的錯誤有代碼(P0001、57014…),一律原樣顯示。
     postgrest-js 連不上時 code 是空字串,所以看有沒有值,不看有沒有這個欄位 */
  function isNetwork(err) {
    if (isObj(err) && err.code) return false;
    return /failed to fetch|networkerror|load failed/i.test(str((err && err.message) || err));
  }
  function messageOf(err) {
    if (isNetwork(err)) return NET_MSG;
    const m = str(err && err.message);
    return m ? (/[。！？!?.]$/.test(m) ? m : m + '。') : '發生錯誤，請稍後再試。';
  }
  async function rpc(fn, args) {
    const C = window.CLOUD;
    if (!C || !C.client) return { ok: false, message: NET_MSG };
    try {
      const r = await C.client.rpc(fn, args);
      if (r && r.error) return { ok: false, message: messageOf(r.error), net: isNetwork(r.error) };
      return { ok: true, data: r ? r.data : null };
    } catch (e) { return { ok: false, message: messageOf(e), net: isNetwork(e) }; }
  }
  const api = {
    async accounts(o) {
      const r = await rpc('owner_accounts', { p_filter: o.filter, p_search: o.search || null, p_limit: PAGE, p_offset: o.offset || 0 });
      if (r.ok && !(isObj(r.data) && Array.isArray(r.data.rows))) return { ok: false, message: '讀到的資料不完整，請重新整理再試。' };
      return r;
    },
    async lookup(who) {
      const r = await rpc('owner_lookup', { p_who: who });
      if (r.ok && !isObj(r.data)) return { ok: false, message: '讀到的資料不完整，請重新整理再試。' };
      return r;
    },
    setRole: a => rpc('owner_set_role', a),
    move: a => rpc('owner_move_member', a),
    updateGrant: a => rpc('owner_update_grant', a),
    refund: a => rpc('owner_refund_payment', a),
  };

  /* ---------- 小工具 ---------- */
  function text(tag, cls, t) { const el = h(tag, cls ? { class: cls } : null); el.textContent = t; return el; }
  async function copyText(t) {
    const nav = window.navigator;
    if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== 'function') throw new Error('no clipboard');
    await nav.clipboard.writeText(t);
  }
  let uid = 0;
  const nextId = p => p + '-' + (++uid);

  /* 分頁列(ARIA tabs):左右鍵換分頁,選到的分頁才 tabindex 0 */
  function tablist(o) {
    const list = h('div', { class: o.cls, role: 'tablist', 'aria-label': o.label });
    const btns = o.tabs.map(t => {
      const b = h('button', { class: o.btnCls, type: 'button', role: 'tab', id: t.id, 'aria-controls': t.panel.getAttribute('id') });
      b.textContent = t.label;
      return b;
    });
    function select(i, focus) {
      o.tabs.forEach((t, j) => {
        const on = i === j;
        btns[j].setAttribute('aria-selected', on ? 'true' : 'false');
        btns[j].setAttribute('tabindex', on ? '0' : '-1');
        t.panel.hidden = !on;
      });
      if (focus) btns[i].focus();
      if (o.onSelect) o.onSelect(o.tabs[i].key);
      if (o.tabs[i].onShow) o.tabs[i].onShow();
    }
    btns.forEach((b, i) => {
      b.addEventListener('click', () => select(i, false));
      b.addEventListener('keydown', e => {
        const k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!k) return;
        e.preventDefault();
        select((i + k + btns.length) % btns.length, true);
      });
    });
    list.append(...btns);
    const start = Math.max(0, o.tabs.findIndex(t => t.key === o.start));
    o.tabs.forEach((t, j) => { if (j !== start) t.panel.hidden = true; });
    btns.forEach((b, j) => { b.setAttribute('aria-selected', j === start ? 'true' : 'false'); b.setAttribute('tabindex', j === start ? '0' : '-1'); });
    return { el: list, select: key => select(Math.max(0, o.tabs.findIndex(t => t.key === key)), false) };
  }

  function trapTab(box, e) {
    if (e.key !== 'Tab') return;
    const f = Array.from(box.querySelectorAll('button,input,textarea,a[href]')).filter(x => !x.disabled && !x.closest('[hidden]'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], at = document.activeElement;
    if (!box.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- 對話框 ----------
     o = { title, who(第一行的帳號), lines:[字串], warns:[字串], body:[節點], fields:[...], ok, danger, cancel(預設 true),
           confirmTwice(values) → 字串(第二次按的按鈕字)或 null, submit(values) → { ok, data, message, net }, from,
           unsureOnNet(連不上時不知道有沒有送到:關掉視窗回 UNSURE,不讓她在同一個視窗盲目重送) }
     欄位 { name, label, type: text|number|date|radio|info, value, maxlength, placeholder, quick:[{label,value,aria}],
           options:[{value,label,desc}], inline, show(values), check(value, values) → 錯誤字或 '',
           derive(values) → 自己沒改過以前跟著別的欄位換的值(例如預填金額), text(values) → info 那一行的字(空字串就不顯示) }
     送出失敗:視窗不關,資料庫的訊息原樣顯示在視窗裡。回傳 promise:成功 → submit 的 data(沒有 submit 就是 true);取消 → null */
  const UNSURE = Object.freeze({ unsure: true });
  function dialog(o) {
    return new Promise(resolve => {
      const id = nextId('ow-dlg');
      const mask = h('div', { class: 'modal-mask ow-mask' });
      const box = h('div', { class: 'modal modal-auth ac-dialog ow-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id });
      const close = h('button', { class: 'modal-close', type: 'button', 'aria-label': '關閉', html: X_ICON });
      const title = text('h2', 'auth-h ac-dialog-h', o.title); title.setAttribute('id', id);
      const said = [];
      if (o.who) { const p = text('p', 'ac-dialog-line ow-line ow-dlg-who', o.who); p.setAttribute('id', nextId(id + '-l')); said.push(p); }
      (o.lines || []).forEach(t => { const p = text('p', 'ac-dialog-line ow-line', t); p.setAttribute('id', nextId(id + '-l')); said.push(p); });
      (o.warns || []).forEach(t => { const p = text('p', 'ow-warn', t); p.setAttribute('id', nextId(id + '-w')); said.push(p); });
      if (said.length) box.setAttribute('aria-describedby', said.map(p => p.getAttribute('id')).join(' '));
      const values = {};
      const rows = (o.fields || []).filter(Boolean).map(f => buildField(f, values, id, () => { disarm(); refresh(); }));
      const err = h('p', { class: 'auth-note bad ow-error', role: 'alert' });
      const okBtn = h('button', { class: 'btn primary auth-submit ow-ok' + (o.danger ? ' ac-danger' : ''), type: 'submit' });
      okBtn.textContent = o.ok || '確定';
      const cancelBtn = o.cancel === false ? null : h('button', { class: 'btn auth-full ac-cancel', type: 'button' }, '取消');
      const form = h('form', { class: 'auth-form ow-form', novalidate: 'novalidate' }, ...rows.map(r => r.wrap), err, okBtn, cancelBtn);
      box.append(close, title, ...said, ...(o.body || []), form);
      mask.append(box);
      document.body.append(mask);

      let armed = false, busy = false, done = false;
      function disarm() { if (!armed) return; armed = false; okBtn.textContent = o.ok || '確定'; okBtn.classList.remove('is-armed'); }
      function refresh() { rows.forEach(r => { const t = r.sync(values); r.wrap.hidden = !!(r.f.show && !r.f.show(values)) || t === ''; }); }
      refresh();
      function finish(v) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        mask.remove();
        try { if (o.from && o.from.isConnected) o.from.focus(); } catch (e) { /* 原本的按鈕不在了 */ }
        resolve(v);
      }
      const no = () => { if (!busy) finish(null); };
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (busy) return;
        err.textContent = '';
        let bad = null;
        rows.forEach(r => {
          if (r.wrap.hidden || !r.f.check) return;
          const m = r.f.check(values[r.f.name], values);
          r.setError(m || '');
          if (m && !bad) bad = r;
        });
        if (bad) { bad.focus(); return; }
        if (!o.submit) return finish(true);
        const twice = !armed && o.confirmTwice ? o.confirmTwice(values) : null;
        if (twice) { armed = true; okBtn.textContent = twice; okBtn.classList.add('is-armed'); return; }
        busy = true; okBtn.disabled = true;
        const r = await o.submit(values);
        busy = false; okBtn.disabled = false;
        if (r && r.ok) return finish(r.data === undefined || r.data === null ? true : r.data);
        if (r && r.net && o.unsureOnNet) return finish(UNSURE);
        disarm();
        err.textContent = (r && r.message) || '發生錯誤，請稍後再試。';
      });
      close.addEventListener('click', no);
      if (cancelBtn) cancelBtn.addEventListener('click', no);
      /* 危險的視窗(紅色按鈕):在輸入欄按 Enter 不送出,要按到紅色按鈕本身才算 */
      const typing = t => !!t && t.tagName === 'INPUT' && t.type !== 'radio' && t.type !== 'checkbox';
      function onKey(e) {
        if (e.key === 'Enter' && (e.repeat || (o.danger && typing(e.target)))) { e.preventDefault(); return; }
        if (e.key === 'Escape') { no(); return; }
        trapTab(box, e);
      }
      document.addEventListener('keydown', onKey, true);
      mask.addEventListener('mousedown', e => { if (e.target === mask) no(); });
      /* 有欄位就放在第一欄;只有確認的視窗與危險的視窗焦點先放在取消,按一下 Enter 不會直接做下去 */
      const first = rows.find(r => !r.wrap.hidden);
      if (first && !o.danger) first.focus(); else (cancelBtn || okBtn).focus();
    });
  }

  function buildField(f, values, id, changed) {
    const fid = nextId(id + '-f');
    const note = h('p', { class: 'auth-note ow-field-note', id: fid + '-n' });
    const wrap = h('div', { class: 'auth-field ow-field ow-field-' + f.name });
    let focusEl = null, touched = false;
    if (f.type === 'info') {
      const p = h('p', { class: 'ow-warn' });
      wrap.append(p);
      return { f, wrap, setError() {}, focus() {}, sync: v => { const t = str(f.text ? f.text(v) : ''); p.textContent = t; return t; } };
    }
    if (f.type === 'radio') {
      values[f.name] = f.value || ((f.options || [])[0] || {}).value || '';
      const set = h('fieldset', { class: 'ow-radios' + (f.inline ? ' is-row' : '') });
      set.append(text('legend', 'ow-legend', f.label));
      (f.options || []).forEach((op, i) => {
        const rid = fid + '-' + i;
        const inp = h('input', { type: 'radio', name: f.name, value: op.value, id: rid });
        inp.checked = values[f.name] === op.value;
        inp.addEventListener('change', () => { if (inp.checked) { values[f.name] = op.value; changed(); } });
        const lab = h('label', { class: 'ow-radio', for: rid }, inp, text('span', 'ow-radio-label', op.label));
        if (op.desc) lab.append(text('span', 'ow-radio-desc', op.desc));
        set.append(lab);
        if (i === 0 || inp.checked) focusEl = inp;
      });
      wrap.append(set, note);
    } else {
      const inp = h('input', { class: 'auth-input', id: fid, name: f.name, type: f.type === 'number' ? 'text' : (f.type || 'text'), autocomplete: 'off',
        maxlength: f.maxlength ? String(f.maxlength) : null, placeholder: f.placeholder || null,
        inputmode: f.type === 'number' ? 'numeric' : null, 'aria-describedby': fid + '-n' });
      inp.value = f.value || '';
      values[f.name] = inp.value;
      inp.addEventListener('input', () => { touched = true; values[f.name] = inp.value; setError(''); changed(); });
      wrap.append(h('label', { for: fid }, f.label));
      if (f.quick && f.quick.length) {
        const q = h('div', { class: 'ow-quick' });
        f.quick.forEach(x => {
          const b = h('button', { class: 'ow-chip', type: 'button', 'aria-label': x.aria || null });
          b.textContent = x.label;
          b.addEventListener('click', () => { touched = true; inp.value = x.value; values[f.name] = x.value; setError(''); changed(); });
          q.append(b);
        });
        wrap.append(q);
      }
      wrap.append(inp, note);
      focusEl = inp;
    }
    function setError(m) {
      note.textContent = m;
      note.className = 'auth-note ow-field-note' + (m ? ' bad' : '');
      wrap.classList.toggle('is-bad', !!m);
    }
    /* derive:她自己還沒改過這一欄,就跟著別的欄位換(例如換項目時的預填金額) */
    function sync(v) {
      if (f.derive && !touched && focusEl && f.type !== 'radio') {
        const x = str(f.derive(v));
        if (focusEl.value !== x) { focusEl.value = x; values[f.name] = x; }
      }
      return null;
    }
    return { f, wrap, setError, sync, focus: () => { if (focusEl) focusEl.focus(); } };
  }

  const noteField = () => ({ name: 'note', label: '備註（選填，寫進異動紀錄）', type: 'text', maxlength: 200 });
  const noteOf = v => (str(v.note).trim() || null);

  /* ---------- 掛上收費管理 ---------- */
  function enabled() {
    const C = window.CLOUD;
    return window.PAID_UI === true && !!C && isObj(C.access) && C.access.is_owner === true;
  }

  /* 收費管理:分頁「帳號清單」「查帳號」「總覽」。回 { el, show(), lookup(who) };不是站長或沒開收費畫面回 null */
  function mount(o) {
    if (!enabled() || !O.accounts || !O.lookupPanel) return null;
    o = o || {};
    const ownerId = o.ownerId;
    let dirty = false, sub = 'list';
    const pList = h('div', { class: 'ow-p-list', id: 'ow-p-list', role: 'tabpanel', 'aria-labelledby': 'ow-t-list' });
    const pLook = h('div', { class: 'ow-p-lookup', id: 'ow-p-lookup', role: 'tabpanel', 'aria-labelledby': 'ow-t-lookup' });
    const look = O.lookupPanel({ ownerId, onChanged: () => { dirty = true; if (over) over.stale(); } });
    /* 帳號清單、學生進度的寫作批改做完一件事:清單、查帳號、總覽下一次打開都重讀(查帳號自己做完的,在上面那一行) */
    const changed = () => { dirty = true; look.stale(); if (over) over.stale(); };
    O.notifyChanged = changed;
    const pOver = h('div', { class: 'ow-p-overview', id: 'ow-p-overview', role: 'tabpanel', 'aria-labelledby': 'ow-t-overview' });
    const over = O.overview && O.billing ? O.overview({ onLookup: who => openLookup(who) }) : null;
    if (over) pOver.append(over.el);
    let loaded = false;
    const list = O.accounts({ ownerId, onLookup: who => openLookup(who), onChanged: changed });
    pList.append(list.el);
    pLook.append(look.el);
    const shows = {
      list: () => { if (dirty || !loaded) { dirty = false; showList(); } },
      lookup: () => { look.show(); look.focus(); },
      overview: () => { if (over) over.show(); },
    };
    const tabs = tablist({ cls: 'ow-tabs ow-tabs-sub', btnCls: 'ow-sub-tab', label: '收費管理', start: 'list', onSelect: k => { sub = k; }, tabs: [
      { key: 'list', id: 'ow-t-list', label: '帳號清單', panel: pList, onShow: shows.list },
      { key: 'lookup', id: 'ow-t-lookup', label: '查帳號', panel: pLook, onShow: shows.lookup },
      over ? { key: 'overview', id: 'ow-t-overview', label: '總覽', panel: pOver, onShow: shows.overview } : null,
    ].filter(Boolean) });
    const el = h('section', { class: 'ow-area', 'aria-label': '收費管理' }, tabs.el, pList, pLook, over ? pOver : null);
    function showList() { loaded = true; list.load(); }
    function openLookup(who) { tabs.select('lookup'); look.open(who); }
    /* 從學生進度切回收費管理:現在選的分頁有過期的資料就重讀 */
    return { el, show: () => { if (!loaded) showList(); else if (sub === 'lookup') look.show(); else shows[sub](); }, lookup: openLookup, top: 'students' };
  }

  /* 教師後台頁首下方分成「學生進度」「收費管理」兩個分頁(只有站長):原本的內容整個放進學生進度,一個字都不改。
     分頁上面只留標題;頁首的說明與「下載全部備份」只跟學生進度有關,放進學生進度的最上面。
     讀不到學生資料時(admin.js 的 note())沒有頁首,補一個標題 */
  function wrapTabs(root, area) {
    if (!root || !area) return;
    const kids = Array.from(root.children);
    let head = kids.length && /\bpage-head\b/.test(kids[0].className) ? kids.shift() : null;
    const ps = h('div', { class: 'ow-students', id: 'ow-p-students', role: 'tabpanel', 'aria-labelledby': 'ow-t-students' });
    if (head) {
      const rest = Array.from(head.children).filter(k => k.tagName !== 'H1');
      if (rest.length) ps.append(h('div', { class: 'page-head ow-students-head' }, ...rest));
    } else head = h('div', { class: 'page-head' }, h('h1', null, '教師後台'));
    kids.forEach(k => ps.append(k));
    const po = h('div', { class: 'ow-owner', id: 'ow-p-owner', role: 'tabpanel', 'aria-labelledby': 'ow-t-owner' }, area.el);
    const tabs = tablist({ cls: 'ow-tabs ow-tabs-top', btnCls: 'ow-top-tab', label: '後台', start: area.top || 'students',
      onSelect: k => { area.top = k; },
      tabs: [{ key: 'students', id: 'ow-t-students', label: '學生進度', panel: ps }, { key: 'owner', id: 'ow-t-owner', label: '收費管理', panel: po, onShow: area.show }] });
    if (head) root.append(head);
    root.append(tabs.el, ps, po);
    if (area.top === 'owner') area.show();
  }

  const O = window.ADMIN_OWNER = Object.assign(window.ADMIN_OWNER || {}, {
    FILTERS, PAGE, DEBOUNCE_MS, UNSURE, creditsLeft, fmtDate, fmtTime, dayText, money, untilFromDate, dateInput, defaultUntilDate,
    displayName, roleText, isExTeacher, reasonText, statusText, teacherText, teacherOf,
    demoteLines, demoteResult, promoteChoice, promoteResult, moveResult, leaveLines, moveLines, ownGrantsText, fullWho,
    grantLabel, grantText, grantState, paymentText, creditText, historyText, noteText,
    api, rpc, messageOf, dialog, text, copyText, tablist, noteField, noteOf, enabled, mount, wrapTabs, isObj, arr, str,
  });
})();
