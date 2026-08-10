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

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(storageKey(key));
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(storageKey(key), JSON.stringify(val)); } catch (e) {}
    if (!RAW_KEYS.has(key) && window.CLOUD && CLOUD.enabled) CLOUD.push(key, val);
  },
  remove(key) {
    try { localStorage.removeItem(storageKey(key)); } catch (e) {}
    if (!RAW_KEYS.has(key) && window.CLOUD && CLOUD.enabled) CLOUD.push(key, null);
  },
};

/* 程度檢測的級距推估(檢測頁與教師後台共用)。
   以總分為主、難度輪廓為輔;28 題小樣本,級距刻意放寬且僅供定位。 */
function bandEstimate(aB, aM, aA, overall) {
  if (overall === undefined) overall = (aB + aM + aA) / 3;
  if (aB < 0.6) return { band: '300–500', advice: '先把基礎文法(詞性、時態、主謂一致)打穩,搭配初級閱讀文章建立單字量,再進入刷題。' };
  if (overall >= 0.9) return { band: '850+', advice: '文法與閱讀都很穩。維持手感即可,把重心放在限時練習與錯題複盤。' };
  if (overall >= 0.8) return { band: '750–880', advice: '各層考點大致掌握,失分多在細節。針對答錯的考點各刷一輪,並練 Part 7 雙篇的速度。' };
  if (overall >= 0.65) return { band: '650–780', advice: '中級考點穩定,進階題型是下一個目標。優先刷答錯的類別,再加強長篇閱讀。' };
  if (overall >= 0.5) return { band: '550–680', advice: '基礎在,但中級考點(介系詞、連接詞、關係詞)還會失分。優先刷列出的弱點類別。' };
  return { band: '400–580', advice: '先集中火力在答錯最多的兩三個基礎考點,搭配初級與中級文章練閱讀。' };
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
