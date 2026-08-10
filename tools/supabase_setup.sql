-- 多益閱讀訓練室:Supabase 初始化
-- 用法:Supabase 後台 → SQL Editor → New query → 整份貼上 → Run
-- 建立兩張表與權限規則:
--   progress:每位學生的進度(鍵值形式,學生只能讀寫自己的列)
--   teachers:教師名單(在名單裡的帳號可以讀取所有學生的 progress)

create table if not exists public.progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  k text not null,
  v jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, k)
);

create table if not exists public.teachers (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.progress enable row level security;
alter table public.teachers enable row level security;

-- 學生:只能操作自己的列
drop policy if exists "own rows" on public.progress;
create policy "own rows" on public.progress
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 教師:可讀取所有學生的列
drop policy if exists "teacher read all" on public.progress;
create policy "teacher read all" on public.progress
  for select
  using (exists (select 1 from public.teachers t where t.user_id = auth.uid()));

-- 每個帳號可以查自己是否在教師名單(前端用來決定要不要顯示「教師後台」)
drop policy if exists "see own teacher row" on public.teachers;
create policy "see own teacher row" on public.teachers
  for select
  using (auth.uid() = user_id);
