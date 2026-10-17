// Supabase Edge Function:newebpay-notify(verify_jwt = false:藍新與瀏覽器的 POST 都沒有 Supabase JWT,
// 函式裡每個路徑都先驗 TradeSha)。處理邏輯在 handler.ts;這裡只接上 Deno 的環境變數與 fetch。
// 部署:supabase functions deploy newebpay-notify --no-verify-jwt(config.toml 也寫了 verify_jwt = false)
import { createNotifyHandler } from './handler.ts';

const handler = createNotifyHandler({
  env: (name) => Deno.env.get(name),
  fetch: (input, init) => fetch(input, init),
});

Deno.serve(handler);
