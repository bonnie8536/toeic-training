/* js/cloud.js 載入 supabase-js 的 script:網址鎖定確切版本(不是 @2 這種範圍)、指向 npm 套件裡原有的檔案,帶 integrity(sha384)與 crossOrigin="anonymous"。
   頁面已經有 window.supabase(測試放的假元件)時不建 script,照舊直接用。
   真的從 CDN 載入、雜湊對得上,由 tools/check_sdk_live.js 用無頭 Chrome 檢查(要連網路,不在這裡跑)。
   用法:node tools/test_cloud_sdk.js */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');
const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => Array.from(m.keys())[i] || null, get length() { return m.size; } }; };
function open(withSdk) {
  const added = [];
  const ctx = {
    console: { warn() {}, log() {}, error() {} }, setTimeout, clearTimeout, Promise, URLSearchParams,
    localStorage: store(), sessionStorage: store(), history: { replaceState() {} }, navigator: { onLine: true },
    location: { hash: '', search: '', pathname: '/index.html', origin: 'https://x', href: 'https://x/index.html', reload() {} },
    document: { createElement: (tag) => ({ tagName: String(tag).toUpperCase() }), head: { appendChild: (el) => { added.push(el); } },
      addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, visibilityState: 'visible' },
    addEventListener() {}, removeEventListener() {},
  };
  ctx.window = ctx;
  ctx.CLOUD_CONFIG = { url: 'https://x.supabase.co', anonKey: 'k' };
  const fake = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } } }) };
  if (withSdk) ctx.supabase = fake;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, added, fake };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

const T = {};
T['載入器建的 script:確切版本、npm 套件裡原有的 dist/umd/supabase.js(CDN 臨時產生的 .min.js 內容可能會變)、sha384 的 integrity、crossOrigin=anonymous;載完就建立連線'] = async () => {
  const { ctx, added, fake } = open(false);
  await settle();
  if (added.length !== 1) return { ok: false, detail: '建了 ' + added.length + ' 個 script' };
  const s = added[0];
  const bad = [];
  if (s.tagName !== 'SCRIPT') bad.push('不是 script');
  if (!/^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@\d+\.\d+\.\d+\/dist\/umd\/supabase\.js$/.test(s.src || '')) bad.push('網址不是確切版本的套件原檔 ' + s.src);
  if (!/^sha384-[A-Za-z0-9+/]{64}$/.test(s.integrity || '')) bad.push('integrity ' + s.integrity);
  if (s.crossOrigin !== 'anonymous') bad.push('crossOrigin ' + s.crossOrigin);
  if (typeof s.onload !== 'function' || typeof s.onerror !== 'function') bad.push('沒有 onload、onerror');
  ctx.supabase = fake;
  if (s.onload) s.onload();
  await ctx.CLOUD.ready;
  if (!ctx.CLOUD.client) bad.push('載完沒有建立連線');
  return { ok: !bad.length, detail: bad.join(' / ') || s.src.replace(/.*supabase-js@/, '').replace(/\/.*/, '') + ' ' + s.integrity.slice(0, 15) + '…' };
};
T['頁面已經有 window.supabase(測試用的假元件):不建 script,直接用它'] = async () => {
  const { ctx, added } = open(true);
  await ctx.CLOUD.ready;
  return { ok: added.length === 0 && !!ctx.CLOUD.client, detail: '建了 ' + added.length + ' 個 script' };
};
T['載入失敗:CLOUD.ready 照常結束(不會一直等),沒有連線'] = async () => {
  const { ctx, added } = open(false);
  await settle();
  if (added[0] && added[0].onerror) added[0].onerror(new Error('integrity'));
  let done = false;
  await Promise.race([ctx.CLOUD.ready.then(() => { done = true; }, () => { done = true; }), settle()]);
  return { ok: done && !ctx.CLOUD.client, detail: '結束 ' + done };
};

(async () => {
  let pass = 0;
  const names = Object.keys(T);
  for (const name of names) {
    let r;
    try { r = await T[name](); } catch (e) { r = { ok: false, detail: '丟錯:' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e) }; }
    if (r.ok) pass++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + name + '  →  ' + r.detail);
  }
  console.log(pass + ' / ' + names.length + ' 通過');
  process.exit(pass === names.length ? 0 : 1);
})();
