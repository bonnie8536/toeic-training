// newebpay.ts:藍新金流 MPG 的加解密與驗章(不含任何金鑰)
// 從 刷刷英文開發/收費/newebpay/newebpay.mjs 移植,邏輯逐行相同,只加型別。
// 只用 WebCrypto(globalThis.crypto.subtle)、TextEncoder、TextDecoder:Supabase Edge Function(Deno)與 Node 24 都能跑。
// 型別只用「可以直接刪掉」的寫法(沒有 enum、namespace),Node 的 type stripping 才能直接 import 這個檔做測試:
//   node tools/test_newebpay.js
//
// 規格(出處見 刷刷英文開發/收費/newebpay/藍新串接.md):
//   TradeInfo = bin2hex(AES-256-CBC(http_build_query(參數))),key = HashKey、iv = HashIV,明文補到 32 byte 的倍數
//   TradeSha  = 大寫 SHA256("HashKey=" + key + "&" + TradeInfo + "&HashIV=" + iv)
//   藍新回傳的密文也是 32 byte 補齊,補齊長度可能是 17 到 32;WebCrypto 只接受 1 到 16,所以這裡自己處理補齊。
//   交易查詢:CheckValue = 大寫 SHA256("IV=" + iv + "&" + 依欄位名排序的參數 + "&Key=" + key)
//             CheckCode  = 大寫 SHA256("HashIV=" + iv + "&" + 依欄位名排序的參數 + "&HashKey=" + key)

export type Env = 'test' | 'production';
export type Keys = { merchantId: string; hashKey: string; hashIV: string };
export type Scalar = string | number | bigint | boolean | null | undefined;
export type Params = Record<string, Scalar> | Map<string, Scalar> | Array<[string, Scalar]>;
export type FormLike = { get(name: string): unknown };
export type NotifyBody = string | FormLike | Record<string, unknown> | null | undefined;
export type ParsedNotify = {
  ok: boolean;
  status: string | null;
  message: string | null;
  result: Record<string, unknown> | null;
  outerStatus?: string | null;
  version?: string | null;
  error: string | null;
};
export type PaidCheck = {
  paid: boolean;
  reason: string | null;
  payTime?: string;
  tradeNo?: string | null;
  paymentType?: string | null;
};

const te = new TextEncoder();

function subtle(): SubtleCrypto {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error('newebpay: 這個執行環境沒有 WebCrypto(globalThis.crypto.subtle)');
  return s;
}

export const MPG_GATEWAY: Readonly<Record<Env, string>> = Object.freeze({
  test: 'https://ccore.newebpay.com/MPG/mpg_gateway',
  production: 'https://core.newebpay.com/MPG/mpg_gateway',
});
export const QUERY_TRADE_URL: Readonly<Record<Env, string>> = Object.freeze({
  test: 'https://ccore.newebpay.com/API/QueryTradeInfo',
  production: 'https://core.newebpay.com/API/QueryTradeInfo',
});
// 藍新官方 WooCommerce 外掛 1.0.12 送 2.3;目前手冊沒讀到,上線前要再確認
export const MPG_VERSION = '2.3';

// ---------- 編碼 ----------

function isUnreserved(b: number): boolean {
  return (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a)
    || b === 0x2d || b === 0x5f || b === 0x2e; // - _ .
}

// 跟 PHP urlencode 一樣:英數與 - _ . 不編碼、空白變 +、其他位元組變 %XX(大寫),~ 與 * 也會編碼
export function phpUrlencode(value: unknown): string {
  const s = String(value);
  const wf = (s as unknown as { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof wf === 'function' && !wf.call(s)) {
    throw new TypeError('newebpay: 字串含有不成對的 UTF-16 代理字元');
  }
  let out = '';
  for (const b of te.encode(s)) {
    if (isUnreserved(b)) out += String.fromCharCode(b);
    else if (b === 0x20) out += '+';
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

function scalarToString(key: string, v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError(`newebpay: ${key} 不是有限數字`);
    return String(v);
  }
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? '1' : '0'; // 跟 http_build_query 一樣
  throw new TypeError(`newebpay: ${key} 只能是字串、數字或布林,不能是 ${Object.prototype.toString.call(v)}`);
}

function entriesOf(params: unknown): Array<[string, unknown]> {
  if (params == null) throw new TypeError('newebpay: 參數不能是空的');
  if (Array.isArray(params)) return params as Array<[string, unknown]>;
  if (params instanceof Map) return [...params.entries()] as Array<[string, unknown]>;
  if (typeof params === 'object') return Object.entries(params as Record<string, unknown>);
  throw new TypeError('newebpay: 參數要是物件、Map 或 [key, value] 陣列');
}

// 跟 PHP http_build_query(預設 RFC1738)一樣:照給的順序、略過 null / undefined、true / false 變 1 / 0
export function buildTradeInfoQuery(params: Params | unknown): string {
  const parts: string[] = [];
  for (const [k, v] of entriesOf(params)) {
    if (v === null || v === undefined) continue;
    parts.push(phpUrlencode(k) + '=' + phpUrlencode(scalarToString(k, v)));
  }
  return parts.join('&');
}

// ---------- 位元組工具 ----------

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function fromHex(hex: unknown): Uint8Array {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('newebpay: 密文不是有效的十六進位字串');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function keyBytes(hashKey: unknown, hashIV: unknown): { k: Uint8Array; iv: Uint8Array } {
  if (typeof hashKey !== 'string' || typeof hashIV !== 'string') throw new TypeError('newebpay: HashKey 與 HashIV 要是字串');
  const k = te.encode(hashKey);
  const iv = te.encode(hashIV);
  if (k.length !== 32) throw new Error('newebpay: HashKey 要剛好 32 個位元組');
  if (iv.length !== 16) throw new Error('newebpay: HashIV 要剛好 16 個位元組');
  return { k, iv };
}

async function importAes(k: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  return subtle().importKey('raw', k, { name: 'AES-CBC' }, false, usages);
}

// ---------- AES ----------

// blockSize 32 = 藍新 MPG 官方範例的補齊(預設);16 = 標準 PKCS#7(定期定額手冊 NDNP 的寫法)
export async function aesEncryptHex(plaintext: string, hashKey: string, hashIV: string,
  { blockSize = 32 }: { blockSize?: number } = {}): Promise<string> {
  if (blockSize !== 16 && blockSize !== 32) throw new Error('newebpay: blockSize 只能是 16 或 32');
  if (typeof plaintext !== 'string') throw new TypeError('newebpay: 明文要是字串');
  const { k, iv } = keyBytes(hashKey, hashIV);
  const data = te.encode(plaintext);
  const n = blockSize - (data.length % blockSize); // 1..blockSize
  const padded = new Uint8Array(data.length + n);
  padded.set(data, 0);
  padded.fill(n, data.length);
  const key = await importAes(k, ['encrypt']);
  // padded 已是 16 的倍數,WebCrypto 會再多補一整塊 16 個 0x10;CBC 前面的密文不受影響,直接切掉最後 16 bytes
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, key, padded));
  return toHex(ct.subarray(0, padded.length));
}

// 接受 1 到 32 的補齊(藍新回傳用 32 byte 補齊)。補齊不對、不是 UTF-8 都丟錯。
// 注意:錯的金鑰也可能剛好解出合法補齊,所以 MPG 一定要先驗 TradeSha 再解密(parseNotify 就是這樣做)。
export async function aesDecryptHex(cipherHex: string, hashKey: string, hashIV: string): Promise<string> {
  const ct = fromHex(cipherHex);
  if (ct.length % 16 !== 0) throw new Error('newebpay: 密文長度不是 16 的倍數');
  const { k, iv } = keyBytes(hashKey, hashIV);
  const key = await importAes(k, ['encrypt', 'decrypt']);
  // WebCrypto 只會解 16 byte 以內的 PKCS#7 補齊。先在後面接一塊「解密後剛好是 16 個 0x10」的密文:
  // E_k(0x10*16 XOR 最後一塊密文) = 以最後一塊密文當 iv、加密空字串得到的第一塊。
  const last = ct.slice(ct.length - 16);
  const extra = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: last }, key, new Uint8Array(0)));
  let padded: Uint8Array;
  try {
    padded = new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, key, concat(ct, extra.subarray(0, 16))));
  } catch {
    throw new Error('newebpay: 解密失敗');
  }
  const n = padded[padded.length - 1];
  if (!(n >= 1 && n <= 32) || n > padded.length) throw new Error('newebpay: 補齊不正確');
  let bad = 0;
  for (let i = padded.length - n; i < padded.length; i++) bad |= padded[i] ^ n;
  if (bad !== 0) throw new Error('newebpay: 補齊不正確');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(padded.subarray(0, padded.length - n));
  } catch {
    throw new Error('newebpay: 解密結果不是 UTF-8');
  }
}

// ---------- 雜湊與比對 ----------

export async function sha256HexUpper(text: unknown): Promise<string> {
  const d = new Uint8Array(await subtle().digest('SHA-256', te.encode(String(text))));
  return toHex(d).toUpperCase();
}

export async function tradeSha(tradeInfoHex: string, hashKey: string, hashIV: string): Promise<string> {
  return sha256HexUpper(`HashKey=${hashKey}&${tradeInfoHex}&HashIV=${hashIV}`);
}

// 長度不同也跑完整個迴圈,不提早結束
export function timingSafeEqual(a: unknown, b: unknown): boolean {
  const x = te.encode(String(a));
  const y = te.encode(String(b));
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ---------- 組 MPG 表單 ----------

const RESERVED_ORDER_KEYS = ['MerchantID', 'RespondType', 'TimeStamp', 'Version'];

function validateOrder(order: Record<string, unknown>): void {
  if (!order || typeof order !== 'object') throw new TypeError('newebpay: order 要是物件');
  for (const k of RESERVED_ORDER_KEYS) {
    if (k in order) throw new Error(`newebpay: order 不能自己帶 ${k}(由 makeMpgFields 填)`);
  }
  if (typeof order.MerchantOrderNo !== 'string' || !/^[A-Za-z0-9_]{1,30}$/.test(order.MerchantOrderNo)) {
    throw new Error('newebpay: MerchantOrderNo 只能是英數與底線,1 到 30 字');
  }
  if (!Number.isSafeInteger(order.Amt) || (order.Amt as number) <= 0) throw new Error('newebpay: Amt 要是正整數(新台幣)');
  const desc = order.ItemDesc;
  if (typeof desc !== 'string' || desc.length === 0 || [...desc].length > 50 || /[\r\n']/.test(desc)) {
    throw new Error('newebpay: ItemDesc 要 1 到 50 字,不能有換行或單引號');
  }
  if (order.Email !== undefined && order.Email !== null) {
    if (typeof order.Email !== 'string' || order.Email.length > 50 || !/^[^\s@]+@[^\s@]+$/.test(order.Email)) {
      throw new Error('newebpay: Email 格式不對或超過 50 字');
    }
  }
  for (const k of ['ReturnURL', 'NotifyURL', 'CustomerURL', 'ClientBackURL']) {
    const u = order[k];
    if (u === undefined || u === null || u === '') continue;
    let url: URL;
    try { url = new URL(String(u)); } catch { throw new Error(`newebpay: ${k} 不是有效網址`); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`newebpay: ${k} 要是 http 或 https`);
    if (url.port !== '') throw new Error(`newebpay: ${k} 只能用 80 或 443 port`);
  }
}

export type MpgFields = { MerchantID: string; TradeInfo: string; TradeSha: string; Version: string };

// 回傳要用瀏覽器 Form POST 送到 MPG_GATEWAY 的四個欄位
export async function makeMpgFields({ merchantId, hashKey, hashIV, order, version = MPG_VERSION, timeStamp }: {
  merchantId: string; hashKey: string; hashIV: string; order: Record<string, Scalar>;
  version?: string; timeStamp?: number | string;
} = {} as never): Promise<MpgFields> {
  if (typeof merchantId !== 'string' || !/^[A-Za-z0-9]{1,15}$/.test(merchantId)) throw new Error('newebpay: MerchantID 格式不對');
  validateOrder(order);
  const ts = timeStamp ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(Number(ts)) || Number(ts) <= 0) throw new Error('newebpay: TimeStamp 要是 Unix 秒數');
  const plain = buildTradeInfoQuery([
    ['MerchantID', merchantId],
    ['RespondType', 'JSON'],
    ['TimeStamp', String(ts)],
    ['Version', version],
    ...Object.entries(order),
  ]);
  const TradeInfo = await aesEncryptHex(plain, hashKey, hashIV, { blockSize: 32 });
  const TradeSha = await tradeSha(TradeInfo, hashKey, hashIV);
  return { MerchantID: merchantId, TradeInfo, TradeSha, Version: version };
}

// ---------- 收通知 ----------

type OuterFields = { Status: string | null; MerchantID: string | null; TradeInfo: string | null; TradeSha: string | null; Version: string | null };

function readFields(body: NotifyBody): OuterFields | null {
  let get: (k: string) => unknown;
  if (typeof body === 'string') {
    const p = new URLSearchParams(body);
    get = (k) => p.get(k);
  } else if (body && typeof (body as FormLike).get === 'function') { // URLSearchParams、FormData
    get = (k) => (body as FormLike).get(k);
  } else if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    get = (k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null);
  } else {
    return null;
  }
  const out = {} as Record<string, string | null>;
  for (const k of ['Status', 'MerchantID', 'TradeInfo', 'TradeSha', 'Version']) {
    const v = get(k);
    out[k] = typeof v === 'string' ? v : null; // FormData 的檔案欄位一律當沒有
  }
  return out as OuterFields;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

// 只收 JSON 明文。我們一律送 RespondType=JSON,藍新回的明文也是 JSON;
// query string(String 格式)跟我們自己的付款請求明文是同一種格式,收了就分不出來,一律丟錯(2026-10-17 審查修正)。
// Result 一定要是物件(或內容是物件的 JSON 字串),不是就丟錯,不再當成空物件繼續。
function parsePlain(text: string): { status: string | null; message: string | null; result: Record<string, unknown> } {
  const t = text.trim();
  if (!t.startsWith('{')) throw new Error('not_json');
  const j: unknown = JSON.parse(t);
  if (!isPlainObject(j)) throw new Error('not_object');
  let result: unknown = j.Result;
  if (typeof result === 'string') result = JSON.parse(result);
  if (!isPlainObject(result)) throw new Error('bad_result');
  const status = typeof j.Status === 'string' ? j.Status : null;
  const message = j.Message === undefined || j.Message === null ? null : String(j.Message);
  return { status, message, result };
}

const fail = (error: string): ParsedNotify => ({ ok: false, status: null, message: null, result: null, error });

// 只會出現在我們送給藍新的「付款請求」明文、不會出現在藍新回傳結果裡的欄位。
// 付款請求(makeMpgFields)跟藍新的通知用同一組金鑰、同一條 TradeSha 公式,任何登入的人都拿得到自己那張單的請求欄位;
// 不擋的話,把請求欄位原封不動 POST 到 NotifyURL 也會驗章通過(2026-10-16 審查修正)。
// 請求明文是 query string,parsePlain 只收 JSON 已經會擋;這張表是第二道。
// RespondType 不在表上:藍新回傳結果的共同欄位本來就有 RespondType,列進來會把真的通知全部擋掉。
const REQUEST_ONLY_KEYS = ['NotifyURL', 'ReturnURL', 'ClientBackURL', 'CustomerURL', 'TimeStamp', 'LoginType', 'TradeLimit'];

// NotifyURL / ReturnURL 收到的 Form POST。body 可以是 FormData、URLSearchParams、
// x-www-form-urlencoded 字串或一般物件。先用固定時間比對驗 TradeSha,再比對外層 MerchantID、解密,再比對內層 MerchantID。
// 明文只收 JSON,Result 要是物件。付款狀態只認明文裡的 Status(外層的 Status 沒有簽章,不採用);
// 明文不是 JSON、沒有 Status、Result 沒有訂單編號、或帶著付款請求才有的欄位,都當成不是藍新的通知。
// ok = true 只代表「確實是藍新用我們的金鑰送來的」,有沒有付款成功請用 checkPaid 判斷。
export async function parseNotify(body: NotifyBody, { merchantId, hashKey, hashIV }: Partial<Keys> = {}): Promise<ParsedNotify> {
  if (!merchantId || !hashKey || !hashIV) throw new Error('newebpay: parseNotify 需要 merchantId、hashKey、hashIV');
  keyBytes(hashKey, hashIV);
  const f = readFields(body);
  if (!f || !f.TradeInfo || !f.TradeSha) return fail('missing_fields');
  if (!/^[0-9a-fA-F]+$/.test(f.TradeInfo) || f.TradeInfo.length % 32 !== 0) return fail('bad_trade_info');
  const expected = await tradeSha(f.TradeInfo, hashKey, hashIV);
  if (!timingSafeEqual(expected, f.TradeSha.toUpperCase())) return fail('bad_trade_sha');
  if (f.MerchantID !== merchantId) return fail('merchant_mismatch');
  let plain: string;
  try {
    plain = await aesDecryptHex(f.TradeInfo, hashKey, hashIV);
  } catch {
    return fail('decrypt_failed');
  }
  let parsed: ReturnType<typeof parsePlain>;
  try {
    parsed = parsePlain(plain);
  } catch {
    return fail('bad_payload');
  }
  if (String(parsed.result.MerchantID ?? '') !== merchantId) return fail('merchant_mismatch');
  if (typeof parsed.status !== 'string' || parsed.status === '') return fail('no_status');
  if (typeof parsed.result.MerchantOrderNo !== 'string' || parsed.result.MerchantOrderNo === '') return fail('no_order');
  if (REQUEST_ONLY_KEYS.some((k) => Object.prototype.hasOwnProperty.call(parsed.result, k))) return fail('request_echo');
  return {
    ok: true,
    status: parsed.status,
    message: parsed.message,
    result: parsed.result,
    outerStatus: f.Status,
    version: f.Version,
    error: null,
  };
}

// 藍新的時間沒有時區,範例看起來是台灣時間(要再確認)。'2014-06-25 16:43:49' → '2014-06-25T16:43:49+08:00'
export function parsePayTime(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T+](\d{2}):(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

// 已付款的條件:Status = SUCCESS、有 PayTime、訂單編號與金額都跟我們的紀錄一樣。
// 取號(ATM 虛擬帳號)成功也可能是 SUCCESS,但沒有 PayTime,不算付款。
export function checkPaid(parsed: ParsedNotify | { ok: false } | null | undefined,
  { merchantOrderNo, amount }: { merchantOrderNo?: string; amount?: number } = {}): PaidCheck {
  if (!parsed || !parsed.ok) return { paid: false, reason: 'not_verified' };
  const p = parsed as ParsedNotify;
  const r = (p.result || {}) as Record<string, unknown>;
  if (p.status !== 'SUCCESS') return { paid: false, reason: 'status_' + (p.status ?? 'missing') };
  const hasPayTime = r.PayTime !== undefined && r.PayTime !== null && String(r.PayTime).trim() !== '';
  const payTime = parsePayTime(r.PayTime);
  // 有 PayTime 但格式看不懂 ≠ 取號:要記成要站長處理,不能當成「還沒付」默默略過(2026-10-07 審查修正)
  if (!payTime) return { paid: false, reason: hasPayTime ? 'bad_pay_time' : 'no_pay_time' };
  if (merchantOrderNo !== undefined && r.MerchantOrderNo !== merchantOrderNo) return { paid: false, reason: 'order_mismatch' };
  if (amount !== undefined && Number(r.Amt) !== amount) return { paid: false, reason: 'amount_mismatch' };
  return {
    paid: true, reason: null, payTime,
    tradeNo: (r.TradeNo ?? null) as string | null,
    paymentType: (r.PaymentType ?? null) as string | null,
  };
}

// ---------- 交易查詢 ----------

function sortedQuery(fields: Record<string, Scalar>): string {
  const keys = Object.keys(fields).sort();
  return buildTradeInfoQuery(keys.map((k) => [k, fields[k]] as [string, Scalar]));
}

// 查詢請求的 CheckValue:欄位 Amt、MerchantID、MerchantOrderNo
export async function queryCheckValue({ Amt, MerchantID, MerchantOrderNo }: Record<string, Scalar>,
  hashKey: string, hashIV: string): Promise<string> {
  return sha256HexUpper(`IV=${hashIV}&${sortedQuery({ Amt, MerchantID, MerchantOrderNo })}&Key=${hashKey}`);
}

// 查詢回應的 CheckCode:欄位 Amt、MerchantID、MerchantOrderNo、TradeNo(IV 在前,跟 TradeSha 相反)
export async function queryCheckCode({ Amt, MerchantID, MerchantOrderNo, TradeNo }: Record<string, Scalar>,
  hashKey: string, hashIV: string): Promise<string> {
  return sha256HexUpper(`HashIV=${hashIV}&${sortedQuery({ Amt, MerchantID, MerchantOrderNo, TradeNo })}&HashKey=${hashKey}`);
}

// 組查詢的 POST 欄位(後端送 application/x-www-form-urlencoded)。Version 一定要明講:
// 2018 官方手冊是 1.1,第三方 SDK 有 1.1 也有 1.3,要照目前手冊填。
export async function makeQueryFields({ merchantId, hashKey, hashIV, merchantOrderNo, amount, version, timeStamp }: {
  merchantId: string; hashKey: string; hashIV: string; merchantOrderNo: string; amount: number;
  version?: string; timeStamp?: number | string;
} = {} as never): Promise<Record<string, string>> {
  if (!version) throw new Error('newebpay: 查詢 API 的 Version 要明講(照目前手冊)');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('newebpay: amount 要是正整數');
  const CheckValue = await queryCheckValue({ Amt: String(amount), MerchantID: merchantId, MerchantOrderNo: merchantOrderNo }, hashKey, hashIV);
  return {
    MerchantID: merchantId,
    Version: version,
    RespondType: 'JSON',
    CheckValue,
    TimeStamp: String(timeStamp ?? Math.floor(Date.now() / 1000)),
    MerchantOrderNo: merchantOrderNo,
    Amt: String(amount),
  };
}

// 驗查詢回應的 CheckCode。json = 查詢 API 回的整個物件 {Status, Message, Result}
// merchantOrderNo、amount 有給就一併比對(CheckCode 只證明是藍新算的,不證明是我們問的那一筆)
export async function verifyQueryResponse(json: { Status?: string; Result?: unknown } | null | undefined,
  { merchantId, hashKey, hashIV, merchantOrderNo, amount }: Keys & { merchantOrderNo?: string; amount?: number } = {} as never,
): Promise<{ ok: boolean; error: string | null; result: Record<string, unknown> | null }> {
  const r = json && json.Result as Record<string, unknown> | undefined;
  if (!json || json.Status !== 'SUCCESS' || !r || typeof r !== 'object') {
    return { ok: false, error: 'status_' + (json && json.Status ? json.Status : 'missing'), result: null };
  }
  if (String(r.MerchantID) !== merchantId) return { ok: false, error: 'merchant_mismatch', result: null };
  if (typeof r.CheckCode !== 'string') return { ok: false, error: 'no_check_code', result: null };
  const expected = await queryCheckCode({
    Amt: String(r.Amt), MerchantID: String(r.MerchantID), MerchantOrderNo: String(r.MerchantOrderNo), TradeNo: String(r.TradeNo),
  }, hashKey, hashIV);
  if (!timingSafeEqual(expected, r.CheckCode.toUpperCase())) return { ok: false, error: 'bad_check_code', result: null };
  if (merchantOrderNo !== undefined && String(r.MerchantOrderNo) !== merchantOrderNo) return { ok: false, error: 'order_mismatch', result: null };
  if (amount !== undefined && Number(r.Amt) !== amount) return { ok: false, error: 'amount_mismatch', result: null };
  return { ok: true, error: null, result: r };
}
