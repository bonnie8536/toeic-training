-- 刷刷英文:公開註冊之後的防濫用設定
-- 用法:Supabase 後台 → SQL Editor → New query → 整份貼上 → Run
--
-- 為什麼要這份:RLS 只管「誰能讀寫哪一列」,不管「能寫多少」。
-- 開放註冊之後,任何人都能申請帳號,而一個帳號本來可以無限寫 progress,
-- 把免費版 500 MB 的資料庫塞滿,整站就跟著掛。這份加上三道上限。
--
-- 上限是照 2026-09-29 的實際用量訂的,留了很大的餘裕:
--   當時 7 個帳號、95 列;單一鍵最大 7 KB、單一使用者最多 25 個鍵 / 13 KB。
--   下面設 單鍵 256 KB / 每人 600 個鍵 / 每人 3 MB,分別是實測值的 36、24、230 倍。
-- 正常使用不可能碰到;真的碰到就是有人在灌資料。
-- 單鍵設 256 KB 是因為答題記錄(hist)最多 1500 筆約 115 KB,要留餘裕。

create or replace function public.progress_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  key_limit   constant int := 600;
  value_limit constant int := 256 * 1024;
  total_limit constant int := 3 * 1024 * 1024;
  n int;
  b bigint;
begin
  if new.v is not null and octet_length(new.v::text) > value_limit then
    raise exception '單一項目太大(上限 % KB)', value_limit / 1024;
  end if;

  if tg_op = 'INSERT' then
    select count(*) into n from public.progress where user_id = new.user_id;
    if n >= key_limit then
      raise exception '這個帳號的項目數已達上限(%)', key_limit;
    end if;
  end if;

  select coalesce(sum(octet_length(v::text)), 0) into b
  from public.progress
  where user_id = new.user_id and k <> new.k;
  if b + coalesce(octet_length(new.v::text), 0) > total_limit then
    raise exception '這個帳號的資料量已達上限(% MB)', total_limit / 1024 / 1024;
  end if;

  return new;
end;
$$;

drop trigger if exists progress_guard on public.progress;
create trigger progress_guard
  before insert or update on public.progress
  for each row execute function public.progress_guard();

-- 檢查:執行後跑這兩句
--   select tgname from pg_trigger where tgrelid = 'public.progress'::regclass and not tgisinternal;
--     → 應該回一列 progress_guard
--   insert into public.progress (user_id, k, v)
--   values ((select id from auth.users limit 1), '_guard_test', to_jsonb(repeat('x', 200000)));
--     → 應該報「單一項目太大」而不是寫進去
