// newebpay-notify 的處理邏輯(不碰 Deno,測試用 Node 直接跑:node tools/test_newebpay.js)。
// 一支函式兩個路徑,verify_jwt = false(藍新與瀏覽器的 POST 都沒有 Supabase JWT),所以每個路徑都先驗 TradeSha:
//   POST …/newebpay-notify         NotifyURL:藍新主機在背景送付款結果。付款成功與否只看這裡。
//                                   驗章 → 解密 → 比對內外商店代號 → 資料庫 newebpay_settle(比金額、冪等、套用方案)
//   POST …/newebpay-notify/return  ReturnURL:藍新把買方的瀏覽器帶回來。不改任何狀態,303 轉到 pay-result.html?o=訂單編號
// 驗不過:只記錯誤代碼、回 400,不寫資料庫(任何人都能 POST 這個網址,不能讓陌生人灌資料庫)。
// 只收 application/x-www-form-urlencoded(其他格式 415),內容最多讀 64 KB(超過 413);這兩種都不讀完、不碰資料庫。
// 資料庫錯誤或例外:回 500,讓藍新重送;入帳是冪等的(重送回 duplicate,不會重複開通)。

import { checkPaid, parseNotify, type Keys, type ParsedNotify } from '../_shared/newebpay.ts';
import { makeRpc, type FetchLike } from '../_shared/supabase_rest.ts';
import { SITE as LIVE_SITE } from '../_shared/site.ts';

export const SITE = LIVE_SITE;   // 付款後帶回的結果頁跟著 _shared/site.ts(搬家計畫 5.3)
const RESULT_PAGE = `${SITE}/pay-result.html`;
const FUNCTION_NAME = 'newebpay-notify';
const MAX_BODY = 65536;

// 存進 payments.gateway_payload 的欄位。不存卡號前六碼(Card6No)、卡片到期(Exp)、付款人 IP、付款人帳號末五碼:
// 站長的「下載全部備份」會把 gateway_payload 整份匯出。
const KEEP = ['TradeNo', 'MerchantOrderNo', 'Amt', 'PaymentType', 'PaymentMethod', 'PayTime', 'EscrowBank', 'AuthBank',
  'RespondCode', 'Auth', 'Card4No', 'Inst', 'InstFirst', 'InstEach', 'PayBankCode'];

export type Log = { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
export type NotifyDeps = {
  env: (name: string) => string | undefined;
  fetch: FetchLike;
  log?: Log;
};

type Route = 'notify' | 'return';

// 網址最後是 /newebpay-notify(或後面加 /return)。前面是 /functions/v1 或沒有都可以(Supabase 與自己網域轉送的寫法不同)
function routeOf(pathname: string): Route | null {
  const segs = pathname.split('/').filter(Boolean);
  const i = segs.lastIndexOf(FUNCTION_NAME);
  if (i < 0) return null;
  const rest = segs.slice(i + 1);
  if (rest.length === 0) return 'notify';
  if (rest.length === 1 && rest[0] === 'return') return 'return';
  return null;
}

function readKeys(env: (name: string) => string | undefined): (Keys & { url: string; serviceKey: string }) | null {
  const get = (k: string) => (env(k) ?? '').trim();
  const merchantId = get('NEWEBPAY_MERCHANT_ID');
  const hashKey = env('NEWEBPAY_HASH_KEY') ?? '';
  const hashIV = env('NEWEBPAY_HASH_IV') ?? '';
  const url = get('SUPABASE_URL');
  const serviceKey = get('SUPABASE_SERVICE_ROLE_KEY');
  if (!merchantId || !hashKey || !hashIV || !url || !serviceKey) return null;
  const te = new TextEncoder();
  if (te.encode(hashKey).length !== 32 || te.encode(hashIV).length !== 16) return null;
  return { merchantId, hashKey, hashIV, url, serviceKey };
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function redirect(order: string | null): Response {
  const q = order && /^[ST][A-Za-z0-9]{1,19}$/.test(order) ? `?o=${order}` : '';
  return new Response(null, { status: 303, headers: { Location: RESULT_PAGE + q, 'Cache-Control': 'no-store' } });
}

// 藍新的 Amt:數字或純數字字串才算,其他(缺、負數、小數、亂碼)一律 null,資料庫會當成金額不符
function toAmount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^\d{1,9}$/.test(v) && Number(v) > 0) return Number(v);
  return null;
}

function pick(r: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(KEEP.filter((k) => r[k] !== undefined && r[k] !== null).map((k) => [k, r[k]]));
}

type FormRead = { form: URLSearchParams | null; reject: 'too_large' | 'bad_type' | null };

// 藍新的 MPG 通知與 Cloudflare 轉送都用 application/x-www-form-urlencoded(可以帶 charset)。
// multipart 與其他格式一律不收:multipart 的解析器不受我們的上限控制,而且藍新不會這樣送(2026-10-17 審查修正)。
function isUrlencoded(req: Request): boolean {
  const t = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return t === 'application/x-www-form-urlencoded';
}

// 最多讀 MAX_BODY 個位元組。沒有 Content-Length(分段傳送)也一樣:讀到超過就停下、取消剩下的串流,回 tooLarge。
// 這個網址不用登入(verify_jwt = false),不能讓陌生人送一個很大的請求、讓函式整個讀進記憶體(2026-10-16 審查修正)。
async function readCapped(req: Request): Promise<{ bytes: Uint8Array | null; tooLarge: boolean }> {
  const lenHeader = req.headers.get('content-length');
  if (lenHeader !== null && Number(lenHeader) > MAX_BODY) return { bytes: null, tooLarge: true };
  if (!req.body) return { bytes: new Uint8Array(0), tooLarge: false };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      try { await reader.cancel(); } catch { /* 取消失敗也一樣拒絕 */ }
      return { bytes: null, tooLarge: true };
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return { bytes: out, tooLarge: false };
}

// 先看格式(不對就一個位元組都不讀),再用 readCapped 讀進有上限的緩衝區,只解析那一段。
async function readForm(req: Request): Promise<FormRead> {
  // 格式不對:直接回應,不碰 req.body(沒讀的內容由執行環境丟掉)
  if (!isUrlencoded(req)) return { form: null, reject: 'bad_type' };
  const r = await readCapped(req);
  if (!r.bytes) return { form: null, reject: r.tooLarge ? 'too_large' : null };
  return { form: new URLSearchParams(new TextDecoder().decode(r.bytes)), reject: null };
}

export function createNotifyHandler(deps: NotifyDeps): (req: Request) => Promise<Response> {
  const log: Log = deps.log ?? console;

  return async function handle(req: Request): Promise<Response> {
    const route = routeOf(new URL(req.url).pathname);
    if (!route) return text(404, 'not found');
    if (route === 'return' && req.method === 'GET') return redirect(null); // 有人重新整理或手動打開:直接帶去結果頁
    if (req.method !== 'POST') return text(405, 'method not allowed');

    const keys = readKeys(deps.env);
    if (!keys) {
      log.error('newebpay-notify: 設定不完整(NEWEBPAY_MERCHANT_ID、NEWEBPAY_HASH_KEY、NEWEBPAY_HASH_IV)');
      return route === 'return' ? redirect(null) : text(500, 'config');
    }

    let fr: FormRead;
    try { fr = await readForm(req); } catch { fr = { form: null, reject: null }; }
    const form = fr.form;
    if (form === null && route === 'notify') {
      log.warn('newebpay-notify: rejected', fr.reject ?? 'bad_form');
      if (fr.reject === 'bad_type') return text(415, 'unsupported media type');
      return fr.reject === 'too_large' ? text(413, 'too large') : text(400, 'bad');
    }
    let n: ParsedNotify;
    try {
      n = form ? await parseNotify(form, keys) : { ok: false, status: null, message: null, result: null, error: 'bad_form' };
    } catch {
      n = { ok: false, status: null, message: null, result: null, error: 'parse_error' };
    }
    const order = n.ok && n.result ? String(n.result.MerchantOrderNo ?? '') : '';

    if (route === 'return') return redirect(n.ok ? order : null);

    if (!n.ok) {
      log.warn('newebpay-notify: rejected', n.error); // 只記錯誤代碼,不記請求內容
      return text(400, 'bad');
    }

    const rpc = makeRpc({ url: keys.url, key: keys.serviceKey, fetch: deps.fetch });
    const r = n.result as Record<string, unknown>;
    try {
      const paid = checkPaid(n, { merchantOrderNo: order });
      const success = n.status === 'SUCCESS' || n.status === 'CUSTOM';
      let outcome: string;
      if (paid.paid && /^[A-Za-z0-9]{1,30}$/.test(String(paid.tradeNo ?? ''))) {
        const { data, error } = await rpc<{ outcome?: string }>('newebpay_settle', {
          p_order_no: order, p_amount: toAmount(r.Amt), p_trade_no: String(paid.tradeNo),
          p_payment_type: paid.paymentType, p_paid_at: paid.payTime, p_payload: pick(r), p_source: 'notify',
        });
        if (error) throw new Error(`settle ${error.status} ${error.code ?? ''}`);
        outcome = String(data?.outcome ?? 'unknown');
      } else if (success) {
        // 驗章通過、明文說成功,但我們看不懂(沒有或看不懂 PayTime、TradeNo 怪):記成要站長處理,不默默略過。
        // 這筆不一定是真的付款,不能直接補開通。站長要先在藍新後台找到同一個訂單編號、同一個金額的成功交易,
        // 有找到才照上線步驟.md 第 8 節處理;後台沒有這筆交易就只把事件標成已處理。
        // 只開信用卡,不會有 ATM 取號這種「成功但還沒付」的通知。
        const reason = paid.paid ? 'bad_trade_no' : paid.reason;
        const { error } = await rpc('newebpay_log', {
          p_source: 'notify', p_order_no: order, p_outcome: 'paid_unparsed', p_needs_owner: true,
          p_detail: { reason, type: r.PaymentType ?? null, trade_no: r.TradeNo ?? null, amt: r.Amt ?? null },
        });
        if (error) throw new Error(`log ${error.status} ${error.code ?? ''}`);
        outcome = 'paid_unparsed';
      } else {
        // 付款失敗(錯誤代碼):只會把 pending 改成 failed,已付的不動
        const { error } = await rpc('newebpay_mark_failed', {
          p_order_no: order, p_code: String(n.status ?? 'unknown').slice(0, 40),
          p_detail: { message: n.message === null || n.message === undefined ? null : String(n.message).slice(0, 200) },
          p_source: 'notify',
        });
        if (error) throw new Error(`mark_failed ${error.status} ${error.code ?? ''}`);
        outcome = 'failed';
      }
      log.info(`newebpay-notify: ${order} ${outcome}`);
      return text(200, 'OK');
    } catch (e) {
      log.error(`newebpay-notify: ${order} 處理失敗,回 500 讓藍新重送`, e instanceof Error ? e.message.slice(0, 200) : 'unknown');
      return text(500, 'retry');
    }
  };
}
