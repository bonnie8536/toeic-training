// Supabase Edge Function:newebpay-checkout(verify_jwt = true,只收登入的人)
// 處理邏輯在 handler.ts;這裡只接上 Deno 的環境變數與 fetch。
// 需要的 Secrets(值由站長自己在 Supabase 後台貼,不寫在任何檔案):
//   NEWEBPAY_ENV(production 或 test)、NEWEBPAY_MERCHANT_ID、NEWEBPAY_HASH_KEY、NEWEBPAY_HASH_IV
//   NEWEBPAY_NOTIFY_URL(選填:通知網址要換成自己網域的短網址時才設)
// SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、SUPABASE_ANON_KEY 是平台自動提供的。
import { createCheckoutHandler } from './handler.ts';

const handler = createCheckoutHandler({
  env: (name) => Deno.env.get(name),
  fetch: (input, init) => fetch(input, init),
});

Deno.serve(handler);
