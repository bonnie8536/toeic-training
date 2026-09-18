-- 刷刷英文:開放公開註冊所需的資料庫設定
-- 用法:Supabase 後台 → SQL Editor → New query → 整份貼上 → Run
-- (原本的 supabase_setup.sql 仍然有效,這份只是補上)

-- 1. 自助刪除帳號:登入者呼叫 delete_own_account() 會刪掉自己的所有進度與帳號本身。
--    以 security definer 執行才有權限刪 auth.users;只允許已登入者呼叫。
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.progress where user_id = auth.uid();
  delete from public.teachers where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
grant execute on function public.delete_own_account() to authenticated;

-- 2. 名冊列(_meta)只能由本人寫入,教師只能讀:既有的 "own rows" 政策已涵蓋,這裡不用改。

-- 3. 檢查:執行後在 SQL Editor 跑
--    select proname, prosecdef from pg_proc where proname = 'delete_own_account';
--    應回一列且 prosecdef = true。
