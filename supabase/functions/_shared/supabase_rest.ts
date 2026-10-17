// supabase_rest.ts:Edge Function 跟 Supabase 講話用的兩個小工具(只用 fetch,沒有相依套件,測試時可以換掉 fetch)。
//   rpc:用 service role 呼叫資料庫函式(newebpay_*)。service role 只在伺服器用,不會送到瀏覽器。
//   getAuthUser:用登入者自己的 JWT 問 Supabase Auth「這是誰」,拿到 user id 與 email。
// 不印任何金鑰、JWT 或請求內容。

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type RestError = { status: number; code: string | null; message: string };
export type RpcResult<T> = { data: T | null; error: RestError | null };
export type AuthUser = { id: string; email: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function trimSlash(u: string): string {
  return u.replace(/\/+$/, '');
}

export function makeRpc({ url, key, fetch }: { url: string; key: string; fetch: FetchLike }) {
  const base = trimSlash(url);
  return async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
    if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error('rpc: 函式名稱不合法');
    const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!res.ok) {
      const b = (body && typeof body === 'object' ? body : {}) as { code?: unknown; message?: unknown };
      return {
        data: null,
        error: {
          status: res.status,
          code: typeof b.code === 'string' ? b.code : null,
          message: typeof b.message === 'string' ? b.message.slice(0, 300) : `HTTP ${res.status}`,
        },
      };
    }
    return { data: body as T, error: null };
  };
}

// 登入者的 JWT 長得像 xxx.yyy.zzz;publishable key(沒登入時 supabase-js 會帶它)不是 JWT,直接當沒登入
export function looksLikeJwt(token: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) && token.length < 8192;
}

export async function getAuthUser({ url, apikey, jwt, fetch }: {
  url: string; apikey: string; jwt: string; fetch: FetchLike;
}): Promise<AuthUser | null> {
  if (!looksLikeJwt(jwt)) return null;
  const res = await fetch(`${trimSlash(url)}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey, Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  let u: { id?: unknown; email?: unknown; is_anonymous?: unknown } | null = null;
  try { u = await res.json(); } catch { return null; }
  if (!u || typeof u.id !== 'string' || !UUID_RE.test(u.id)) return null;
  if (u.is_anonymous === true) return null; // 匿名登入不能付款(要有 email 的正式帳號)
  return { id: u.id, email: typeof u.email === 'string' && u.email ? u.email : null };
}
