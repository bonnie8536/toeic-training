/* 共用工具 */
window.TOEIC = window.TOEIC || {};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) el.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const LETTERS = ['A', 'B', 'C', 'D'];

/* 搬家寫到一半分頁被關了(js/move-apply.js 寫入前存的日誌還在):照日誌處理動到的鍵,再留一個記號,
   收件頁與新網址的提示(js/move-in-boot.js)會請使用者再搬一次。要在各模組讀資料之前做,所以放在這裡。
   日誌第 2 版 { v: 2, at, backup, keys: [[鍵, 種類, 寫入值的指紋, (搬家自己的鍵的原值)]] }:
   - 只動「現在的值還是搬家寫的那個」(指紋一樣)的鍵:新加的(add)拿掉,換掉的(replace)從備份換回原值;
     之後被別的頁面改過的一律留著(那是比較新的練習),原值留在備份 tr_move_backup_<時間> 裡,不會少。
   - 合併的鍵(grow)留著合併後的樣子:它包含新網址原本的東西,再搬一次也不會重複。
   - 每個換掉的鍵都換回去了才刪備份。
   日誌是 15 秒內寫的就先不動:可能是另一個分頁正在寫(寫入是同步的,幾毫秒就寫完)。force:不等 15 秒。
   第 1 版的日誌({ before: [[鍵, 原值]] })照舊全部換回原值。沒有日誌時什麼都不做;舊網址從來不會有日誌。 */
function moveHash(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return str.length.toString(36) + '.' + h.toString(36);
}
function moveRecoverV2(ls, j) {
  const rm = (k) => { try { ls.removeItem(k); } catch (e) { /* 刪不掉就留著 */ } };
  let bk = null;
  try { bk = typeof j.backup === 'string' && /^tr_move_backup_/.test(j.backup) ? JSON.parse(ls.getItem(j.backup)) : null; } catch (e) { bk = null; }
  const saved = new Map(bk && Array.isArray(bk.keys) ? bk.keys.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string') : []);
  const list = j.keys.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && /^tr_/.test(e[0]) && typeof e[2] === 'string');
  const untouched = (k, h) => { const cur = ls.getItem(k); return cur !== null && moveHash(cur) === h; };
  let kept = 0;
  list.forEach(([k, mode, h]) => { if (mode === 'add' && untouched(k, h)) rm(k); });   // 先拿掉新加的,騰出空間
  list.forEach(([k, mode, h, inline]) => {
    if (mode !== 'replace') return;
    const before = typeof inline === 'string' ? inline : saved.get(k);
    if (typeof before !== 'string') return;   // 寫的時候空間不夠備份:留現在的
    if (untouched(k, h)) { try { ls.setItem(k, before); } catch (e) { kept++; } }
    else if (saved.has(k)) kept++;
  });
  if (bk && !kept) rm(j.backup);
}
function moveJournalRecover(ls, force, quiet) {
  let j = null;
  try {
    const raw = ls.getItem('tr_move_journal');
    if (raw === null) return '';
    j = JSON.parse(raw);
  } catch (e) { return ''; }
  const v2 = !!j && j.v === 2 && Array.isArray(j.keys);
  if (!v2 && !(j && Array.isArray(j.before))) return '';
  if (!force && typeof j.at === 'number' && Date.now() - j.at < 15000 && Date.now() >= j.at) return 'wait';
  if (v2) moveRecoverV2(ls, j);
  else {
    const before = j.before.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && /^tr_/.test(e[0]));
    before.forEach(([k, v]) => { if (v === null) { try { ls.removeItem(k); } catch (e) { /* 刪不掉就留著 */ } } });   // 先刪新加的,騰出空間
    before.forEach(([k, v]) => { if (typeof v === 'string') { try { ls.setItem(k, v); } catch (e) { /* 原本放得下,這裡不會發生 */ } } });
  }
  try { ls.removeItem('tr_move_journal'); } catch (e) { /* 下一頁再試 */ }
  if (!quiet) { try { ls.setItem('tr_move_restored', String(j.at || Date.now())); } catch (e) { /* 只是看不到提示 */ } }
  return 'restored';
}
try { moveJournalRecover(localStorage); } catch (e) { /* 讀不到 localStorage 就沒有東西可還原 */ }

/* localStorage 包裝(全站前綴 tr_)。
   除了 RAW_KEYS(學生檔案登錄表)外,所有鍵都以目前學生檔案 id 做命名空間:
   tr_u<pid>_<key>,達成「每位學生各自存進度與錯題」。 */
const RAW_KEYS = new Set(['profiles', 'current_profile']);
window.__PROFILE_ID = (function () {
  try { return JSON.parse(localStorage.getItem('tr_current_profile')) || null; }
  catch (e) { return null; }
})();

function storageKey(key) {
  if (RAW_KEYS.has(key)) return 'tr_' + key;
  return 'tr_' + (window.__PROFILE_ID ? 'u' + window.__PROFILE_ID + '_' : '') + key;
}

/* 先看再登入的內容頁(js/profile.js):沒登入、沒選學生的人可以看,作答那一下就被攔下、跳出登入卡。
   這裡是最後一道:頁面載完之後還是有寫入跑到這裡(某個作答鈕漏了 data-gate),一律不寫,留一行警告方便找出漏的那一個。
   頁面自己要分「存起來」或「只記在這一頁」(對話頁聽過哪幾句、發音頁的慢速)時呼叫 canKeepProgress()。
   開頁時本來就會寫的東西(頁面載完之前)、學生檔案登錄表(RAW_KEYS,本機建檔要用)照舊。 */
function canKeepProgress() {
  const P = window.PROFILE;
  try { return !(P && typeof P.blocksWrite === 'function' && P.blocksWrite()); } catch (e) { return true; }
}
/* 剛灌完雲端資料、頁面正要重載(js/cloud.js 的 CLOUD.reloading)的那一下也不寫(根據的是舊畫面),但那是登入著的人,不是漏攔:
   不留「還沒登入」的警告。已登入的人開新分頁的內容頁就會遇到(這個分頁還沒灌過,灌完重載前小雞照常同步一次) */
function keepOrWarn(what) {
  if (canKeepProgress()) return true;
  try { if (!(window.CLOUD && window.CLOUD.reloading)) console.warn('還沒登入，這一筆沒有存：' + what); } catch (e) { /* 沒有 console 也一樣不存 */ }
  return false;
}

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(storageKey(key));
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, val) {
    if (!RAW_KEYS.has(key) && !keepOrWarn(key)) return;
    try { localStorage.setItem(storageKey(key), JSON.stringify(val)); } catch (e) {}
    if (!RAW_KEYS.has(key) && window.CLOUD && CLOUD.enabled) CLOUD.push(key, val);
  },
  remove(key) {
    if (!RAW_KEYS.has(key) && !keepOrWarn(key)) return;
    try { localStorage.removeItem(storageKey(key)); } catch (e) {}
    if (!RAW_KEYS.has(key) && window.CLOUD && CLOUD.enabled) CLOUD.push(key, null);
  },
};

/* 程度檢測的級距推估(檢測頁與教師後台共用)。
   以總分為主、難度輪廓為輔;28 題小樣本,級距刻意放寬且僅供定位。 */
function bandEstimate(aB, aM, aA, overall) {
  if (overall === undefined) overall = (aB + aM + aA) / 3;
  if (aB < 0.6) return { band: '300–500', advice: '先把基礎文法（詞性、時態、主謂一致）打穩，搭配初級閱讀文章建立單字量，再進入刷題。' };
  if (overall >= 0.9) return { band: '850+', advice: '文法與閱讀都很穩。維持手感即可，把重心放在限時練習與錯題複盤。' };
  if (overall >= 0.8) return { band: '750–880', advice: '各層考點大致掌握，失分多在細節。針對答錯的考點各刷一輪，並練 Part 7 雙篇的速度。' };
  if (overall >= 0.65) return { band: '650–780', advice: '中級考點穩定，進階題型是下一個目標。優先刷答錯的類別，再加強長篇閱讀。' };
  if (overall >= 0.5) return { band: '550–680', advice: '基礎在，但中級考點（介系詞、連接詞、關係詞）還會失分。優先刷列出的弱點類別。' };
  return { band: '400–580', advice: '先集中火力在答錯最多的兩三個基礎考點，搭配初級與中級文章練閱讀。' };
}

function levelBadgeClass(level) {
  if (/初級|基礎/.test(level)) return 'level-basic';
  if (/中高級/.test(level)) return 'level-adv';
  if (/^高級|進階|800\+/.test(level)) return 'level-high';
  return 'level-mid';
}

function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

/* 搜尋引擎用:這一頁的正式網址(canonical)、og:url,和說明文字。
   文法、自然發音、閱讀、對話的每一課都有自己的網址(grammar.html?u=ga-01 這類),canonical 要寫自己,Google 才會分開收錄;
   所以這四頁的 HTML 不寫死 canonical,由頁面程式依畫面呼叫這裡。query 只放決定內容的參數('u=ga-01'),列表頁給 ''。
   網域取 HTML 裡的 og:url(tools/apply_domain.js 會換),舊網址代理時也指向新網址;沒有 og:url 就什麼都不寫。 */
function setPageMeta(query, desc) {
  const og = document.querySelector('meta[property="og:url"]');
  if (!og || !og.getAttribute('content')) return;
  if (!og.dataset.base) og.dataset.base = og.getAttribute('content').replace(/[?#].*$/, '');
  const url = og.dataset.base + (query ? '?' + query : '');
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.append(link); }
  link.href = url;
  og.setAttribute('content', url);
  if (!desc) return;
  ['meta[name="description"]', 'meta[property="og:description"]'].forEach((s) => {
    const m = document.querySelector(s);
    if (m) m.setAttribute('content', desc);
  });
}

/* Part 6/7 文章類型的中文標籤(刷題、模擬考共用)。查不到就原樣回傳,不轉大寫。 */
function passTypeLabel(t) {
  const map = {
    email: '電子郵件', memo: '備忘錄', notice: '公告', advertisement: '廣告',
    letter: '信件', article: '文章', instructions: '使用說明',
    'text message': '簡訊對話', 'text-message': '簡訊對話', 'text_message': '簡訊對話', 'text message chain': '簡訊對話',
    webpage: '網頁', 'web page': '網頁',
    schedule: '行程表', invoice: '發票/訂單', form: '表單', 'order form': '訂購單',
    coupon: '優惠券', menu: '菜單', itinerary: '行程表', receipt: '收據', flyer: '傳單',
    'sign-up form': '報名表', review: '評論', 'job advertisement': '徵才廣告',
  };
  return map[String(t || '').toLowerCase()] || String(t || '');
}

/* 答題記錄(學習記錄頁用):每次作答一筆 {m:模組, id, c:選項, ok, t},最多留 600 筆。
   模組代號:p5/p6/p7 刷題、l1~l4 聽力、g 文法、r 文章題、ph 片語、tq 單字考題、vq 單字遊戲 */
/* 一筆約 77 bytes(2026-09-29 實測 54 筆 = 4,133 bytes)。
   1500 筆約 115 KB,在資料庫的單鍵上限內;60 天足夠涵蓋這一頁顯示的所有統計。
   錯題本不在這裡,它是各模組自己的鍵(drill_p5 等),答對才移出,不會因為時間被清掉。 */
const HIST_MAX = 1500;
const HIST_DAYS = 60;
function logAttempt(m, id, c, ok, extra) {
  if (!keepOrWarn('hist')) return;   // 小雞也不跟著重算
  const rec = { m, id, c, ok: !!ok, t: Date.now() };
  if (extra) Object.assign(rec, extra);
  const cutoff = rec.t - HIST_DAYS * 864e5;
  const hist = store.get('hist', []).filter(r => !r.t || r.t >= cutoff);
  hist.push(rec);
  if (hist.length > HIST_MAX) hist.splice(0, hist.length - HIST_MAX);
  store.set('hist', hist);
  /* 小雞(js/pet-store.js)跟著重算;頁面沒載入或開關關著就什麼都不做 */
  if (window.PET_STORE && typeof window.PET_STORE.afterAnswer === 'function') {
    try { window.PET_STORE.afterAnswer(); } catch (e) { /* 小雞出錯不影響作答紀錄 */ }
  }
}

/* 頂欄群組選單:桌機 hover/focus 由 CSS 處理,這裡補「點一下切換」給觸控裝置 */
document.addEventListener('DOMContentLoaded', () => {
  const groups = $$('.nav-group');
  if (!groups.length) return;
  groups.forEach(g => {
    const btn = g.querySelector('.nav-btn');
    if (!btn) return;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = g.classList.contains('open');
      groups.forEach(x => x.classList.remove('open'));
      if (!open) g.classList.add('open');
    });
  });
  document.addEventListener('click', () => groups.forEach(x => x.classList.remove('open')));
});
