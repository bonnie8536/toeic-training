// newebpay-checkout 的處理邏輯(不碰 Deno,測試用 Node 直接跑:node tools/test_newebpay.js)。
// 瀏覽器(已登入)送 {sku, consent: true} → 查伺服器價格表 → 產生新的訂單編號 → 組好藍新表單欄位 →
// 用 service role 在資料庫建一筆待付款(newebpay_begin_checkout)→ 回 {action, fields, order_no},
// 瀏覽器再把 fields 用 <form method=post> 整頁送到 action(藍新付款頁)。
//
// 安全:
//   * 金額只看 _shared/products.ts,瀏覽器送來的任何金額都不用。
//   * HashKey、HashIV、商店代號只從 Supabase Secrets 讀(NEWEBPAY_HASH_KEY、NEWEBPAY_HASH_IV、NEWEBPAY_MERCHANT_ID),
//     不寫在程式裡、不印在 log、不回給瀏覽器。
//   * 只開信用卡一次付清(CREDIT = 1)。
//   * test10(站長 NT$10 測試)由資料庫檢查是不是站長,不是就擋。
//   * 開始收費前(預設 2026-11-01 00:00 台北)除了 test10 什麼都不賣,正式、測試環境都一樣,回 409 {error: 'not_open', message}。
//   * 資料庫自己 raise 的訊息(P0001)回 409 {error: 'not_allowed', message: 原文}。
// 錯誤回應都帶 message(給人看的中文);error 是代碼(not_open、not_allowed)或跟 message 相同的文字。

import { MPG_GATEWAY, makeMpgFields, type Env } from '../_shared/newebpay.ts';
import { CONSENT_VERSION, findProduct, type Product } from '../_shared/products.ts';
import { getAuthUser, makeRpc, type FetchLike, type RestError } from '../_shared/supabase_rest.ts';
import { SITE as LIVE_SITE, SITE_ORIGINS } from '../_shared/site.ts';

// 網址集中在 _shared/site.ts(搬家計畫 5.3):SITE 是付款後帶回的網站,兩個網域在搬家期間都放行
export const SITE = LIVE_SITE;
export const ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  ...SITE_ORIGINS,
  'http://127.0.0.1:8754', // 本機預覽(.claude/launch.json 的 site)
  'http://localhost:8754',
]);
const MAX_BODY = 4096;
const MSG_LOGIN = '請先登入';
const MSG_SKU = '找不到這個方案，請重新整理頁面再試';
const MSG_CONSENT = '請先勾選同意線上服務開始使用後不適用 7 天猶豫期';
const MSG_RETRY = '暫時無法建立付款，請稍後再試';
// 開始收費的時間(11/1 起收費)。這之前只賣站長的 test10,不分正式或測試環境。
// 可以用 Secret NEWEBPAY_SALES_START 改(ISO 時間,要帶時區)。資料庫 newebpay_begin_checkout 也有同一道檢查,
// 日期寫死在 SQL 裡:用了這個 Secret,SQL 的日期也要改成一樣,不然以資料庫比較晚的那一個為準。
export const DEFAULT_SALES_START = '2026-11-01T00:00:00+08:00';

export type Log = { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
export type CheckoutDeps = {
  env: (name: string) => string | undefined;
  fetch: FetchLike;
  log?: Log;
  now?: () => Date;
};

type Config = {
  env: Env;
  supabaseUrl: string;
  serviceKey: string;
  anonKey: string | null;
  merchantId: string;
  hashKey: string;
  hashIV: string;
  notifyUrl: string;
  returnUrl: string;
  salesStart: number;
};

class ConfigError extends Error {}

// 通知網址:預設是這支專案的 newebpay-notify 函式;NEWEBPAY_NOTIFY_URL 可以換成自己網域的短網址
// (藍新舊手冊寫網址欄位最多 50 字,Supabase 的函式網址約 69 字,見 刷刷英文開發/收費/newebpay/上線步驟.md)。
// ReturnURL 一律是通知網址後面加 /return(兩個網址不能一樣,藍新手冊的規定)。
function notifyBase(supabaseUrl: string, override: string | undefined): string {
  const raw = (override ?? '').trim() || `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/newebpay-notify`;
  let u: URL;
  try { u = new URL(raw); } catch { throw new ConfigError('NEWEBPAY_NOTIFY_URL 不是有效網址'); }
  if (u.protocol !== 'https:' || u.port !== '' || u.search !== '' || u.hash !== '' || u.username || u.password) {
    throw new ConfigError('NEWEBPAY_NOTIFY_URL 要是 https、不帶 port、查詢字串或 #');
  }
  return u.href.replace(/\/+$/, '');
}

function readConfig(env: (name: string) => string | undefined): Config {
  const get = (k: string) => (env(k) ?? '').trim();
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEWEBPAY_ENV', 'NEWEBPAY_MERCHANT_ID',
    'NEWEBPAY_HASH_KEY', 'NEWEBPAY_HASH_IV'].filter((k) => !get(k));
  if (missing.length) throw new ConfigError('缺少設定:' + missing.join('、')); // 只列名稱,不列值
  const e = get('NEWEBPAY_ENV');
  if (e !== 'production' && e !== 'test') throw new ConfigError('NEWEBPAY_ENV 只能是 production 或 test');
  const hashKey = env('NEWEBPAY_HASH_KEY') as string;
  const hashIV = env('NEWEBPAY_HASH_IV') as string;
  if (new TextEncoder().encode(hashKey).length !== 32 || new TextEncoder().encode(hashIV).length !== 16) {
    throw new ConfigError('NEWEBPAY_HASH_KEY 要 32 字、NEWEBPAY_HASH_IV 要 16 字(請檢查有沒有多貼空白)');
  }
  const merchantId = get('NEWEBPAY_MERCHANT_ID');
  if (!/^[A-Za-z0-9]{1,15}$/.test(merchantId)) throw new ConfigError('NEWEBPAY_MERCHANT_ID 格式不對');
  const supabaseUrl = get('SUPABASE_URL');
  const notifyUrl = notifyBase(supabaseUrl, env('NEWEBPAY_NOTIFY_URL'));
  const startRaw = get('NEWEBPAY_SALES_START') || DEFAULT_SALES_START;
  const salesStart = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(startRaw) ? Date.parse(startRaw) : NaN;
  if (!Number.isFinite(salesStart)) throw new ConfigError('NEWEBPAY_SALES_START 要是帶時區的 ISO 時間,例如 2026-11-01T00:00:00+08:00');
  return {
    env: e, supabaseUrl, serviceKey: get('SUPABASE_SERVICE_ROLE_KEY'), anonKey: get('SUPABASE_ANON_KEY') || null,
    merchantId, hashKey, hashIV, notifyUrl, returnUrl: `${notifyUrl}/return`, salesStart,
  };
}

// 訂單編號:S(正式)/ T(測試)+ 台灣時間 yyMMddHHmmss + 7 碼隨機大寫英數 = 20 碼
// (payments.merchant_trade_no 規定英數 20 碼以內;藍新同一商店不能重複,每次按付款都產生新的)
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + '0123456789'; // 分兩段寫:原始碼掃描會把 32 字以上的英數串當成疑似金鑰
export function makeOrderNo(env: Env, now: Date): string {
  const t = new Date(now.getTime() + 8 * 3600 * 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = two(t.getUTCFullYear() % 100) + two(t.getUTCMonth() + 1) + two(t.getUTCDate())
    + two(t.getUTCHours()) + two(t.getUTCMinutes()) + two(t.getUTCSeconds());
  let rnd = '';
  while (rnd.length < 7) {
    const buf = new Uint8Array(16);
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < 252 && rnd.length < 7) rnd += ALNUM[b % 36]; // 252 = 36 × 7,去掉尾巴避免偏差
    }
  }
  return (env === 'production' ? 'S' : 'T') + stamp + rnd;
}

// 「11 月 1 日開放購買。」:日期照台北時間(跟資料庫 newebpay_begin_checkout 的訊息同一句)
function notOpenMessage(start: number): string {
  const t = new Date(start + 8 * 3600 * 1000);
  return `${t.getUTCMonth() + 1} 月 ${t.getUTCDate()} 日開放購買。`;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: 'Origin' };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type, x-region';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

// 一般錯誤:error 與 message 同一句;前端讀 message,舊版前端讀 error 也看得到同一句
function fail(status: number, message: string, origin: string | null, code?: string): Response {
  return json(status, { error: code ?? message, message }, origin);
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function emailForNewebpay(email: string | null): string | undefined {
  if (!email || email.length > 50 || !/^[^\s@]+@[^\s@]+$/.test(email)) return undefined; // 不帶就讓買方在付款頁自己填
  return email;
}

// 最多讀 MAX_BODY 個位元組,不管 Content-Length 寫多少(分段傳送根本沒有這個標頭):
// 讀到超過就停下、取消剩下的串流,回 null。跟 newebpay-notify 的 readCapped 同一種做法(2026-10-17 審查修正)。
async function readCapped(req: Request): Promise<Uint8Array | null> {
  const lenHeader = req.headers.get('content-length');
  if (lenHeader !== null && Number(lenHeader) > MAX_BODY) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      try { await reader.cancel(); } catch { /* 取消失敗也一樣拒絕 */ }
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

async function readBody(req: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number }> {
  const bytes = await readCapped(req);
  if (!bytes) return { ok: false, status: 413 };
  try {
    const b = JSON.parse(new TextDecoder().decode(bytes));
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, status: 400 };
    return { ok: true, body: b as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400 };
  }
}

export function createCheckoutHandler(deps: CheckoutDeps): (req: Request) => Promise<Response> {
  const log: Log = deps.log ?? console;
  const now = deps.now ?? (() => new Date());
  let warnedLength = false;

  async function beginOnce(cfg: Config, userId: string, email: string | null, p: Product) {
    const orderNo = makeOrderNo(cfg.env, now());
    // 先組欄位、後建單:欄位有問題(例如設定錯)就不會在資料庫留下一筆永遠不會付的單
    const fields = await makeMpgFields({
      merchantId: cfg.merchantId, hashKey: cfg.hashKey, hashIV: cfg.hashIV,
      timeStamp: Math.floor(now().getTime() / 1000),
      order: {
        MerchantOrderNo: orderNo,
        Amt: p.amount,
        ItemDesc: p.desc,
        Email: emailForNewebpay(email),
        LoginType: 0,
        NotifyURL: cfg.notifyUrl,
        ReturnURL: cfg.returnUrl,
        ClientBackURL: `${SITE}/pay-result.html?back=1`, // 在付款頁按「返回商店」= 沒付款就回來
        CREDIT: 1, // 只開信用卡一次付清(她 2026-10-16 決定)
        TradeLimit: 900, // 付款頁 15 分鐘逾時
      },
    });
    const rpc = makeRpc({ url: cfg.supabaseUrl, key: cfg.serviceKey, fetch: deps.fetch });
    const { error } = await rpc('newebpay_begin_checkout', {
      p_user: userId, p_sku: p.sku, p_item: p.item, p_months: p.months, p_seats: p.seats, p_credits: p.credits,
      p_amount: p.amount, p_order_no: orderNo, p_env: cfg.env, p_consent: CONSENT_VERSION,
    });
    return { orderNo, fields, error };
  }

  return async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get('origin');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (req.method !== 'POST') return fail(405, 'method not allowed', origin);

    let cfg: Config;
    try {
      cfg = readConfig(deps.env);
    } catch (e) {
      log.error('newebpay-checkout: 設定有問題', e instanceof ConfigError ? e.message : 'unknown');
      return fail(500, MSG_RETRY, origin);
    }
    if (!warnedLength && (cfg.notifyUrl.length > 50 || cfg.returnUrl.length > 50)) {
      warnedLength = true;
      log.warn(`newebpay-checkout: NotifyURL/ReturnURL longer than 50 chars (${cfg.notifyUrl.length}/${cfg.returnUrl.length})`);
    }

    try {
      const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
      const apikey = cfg.anonKey || (req.headers.get('apikey') ?? '').trim() || cfg.serviceKey;
      const user = jwt ? await getAuthUser({ url: cfg.supabaseUrl, apikey, jwt, fetch: deps.fetch }) : null;
      if (!user) return fail(401, MSG_LOGIN, origin);

      const b = await readBody(req);
      if (!b.ok) return fail(b.status, b.status === 413 ? MSG_RETRY : MSG_SKU, origin);
      const p = findProduct(b.body.sku);
      if (!p) return fail(400, MSG_SKU, origin);
      if (b.body.consent !== true) return fail(400, MSG_CONSENT, origin);
      // 開始收費前只有 test10 可以建單(是不是站長由資料庫判斷)。2026-10-16 審查修正:
      // 函式部署後到 11/1 之間,不能有人從瀏覽器主控台直接呼叫、買到真的方案。
      if (p.sku !== 'test10' && now().getTime() < cfg.salesStart) {
        return fail(409, notOpenMessage(cfg.salesStart), origin, 'not_open');
      }

      let r = await beginOnce(cfg, user.id, user.email, p);
      if (r.error && r.error.code === '23505') r = await beginOnce(cfg, user.id, user.email, p); // 撞號:換編號重試一次
      if (r.error) return dbError(r.error, origin);
      log.info(`newebpay-checkout: ${r.orderNo} ${p.sku} created`);
      return json(200, { action: MPG_GATEWAY[cfg.env], fields: r.fields, order_no: r.orderNo }, origin);
    } catch (e) {
      log.error('newebpay-checkout: 例外', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
      return fail(500, MSG_RETRY, origin);
    }
  };

  // 只把資料庫自己 raise 的中文訊息給使用者(例如「你的帳號已經可以使用，不需要購買這個方案。」、
  // 「一小時內有太多筆還沒完成的付款」);其他錯誤不外洩細節
  function dbError(err: RestError, origin: string | null): Response {
    if (err.code === 'P0001' && typeof err.message === 'string' && err.message.trim()) {
      return fail(409, err.message.trim().slice(0, 200), origin, 'not_allowed');
    }
    log.error('newebpay-checkout: 資料庫錯誤', err.status, err.code);
    return fail(500, MSG_RETRY, origin);
  }
}
