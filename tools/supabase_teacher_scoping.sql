-- 刷刷英文:老師權限收斂成「只看自己的學生」+ 班級邀請碼 + 老師申請流程
-- 用法:Supabase 後台 → SQL Editor → New query → 整份貼上 → Run
--
-- 為什麼要這份:原本的政策是「只要在 teachers 表就能讀全站所有學生的 progress」。
-- 一個老師沒問題,第二個老師出現就會讀到別人的學生、以及別的老師寫的 tnote_* 備註。
-- 要開放申請老師帳號之前一定要先改掉,否則老師帳號等於全站個資讀取權。
--
-- 這份做四件事:
--   1. 班級(classes)與學生↔班級(memberships),老師只讀自己班上的學生
--   2. 邀請碼:學生自己輸入碼加入,不需要老師手動綁
--   3. 老師申請(teacher_applications),核准一律人工,不可自助升級
--   4. 把現有 6 位學生補進她的預設班級,教師後台的可見範圍不變

-- ---------- 1. 班級 ----------

-- 邀請碼用去掉易混字元的字母數字(沒有 0/O/1/I),8 碼 = 32^8 種
create or replace function public.gen_class_code()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 32) + 1)::int, 1), '')
  from generate_series(1, 8);
$$;

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  code text not null unique default public.gen_class_code(),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  student_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (student_id, class_id)
);

create index if not exists memberships_class_idx on public.memberships (class_id);

-- ---------- 2. 老師申請 ----------

create table if not exists public.teacher_applications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- 站長旗標:只有站長能審申請。她自己那一列設 true(下面的回填會設)
alter table public.teachers add column if not exists is_owner boolean not null default false;

-- ---------- 3. 判斷用的函式(一定要有,否則政策會互相遞迴) ----------
-- 政策之間不可以互相查對方的表:classes 的政策查 memberships、memberships 的政策查
-- classes,Postgres 會回 42P17 infinite recursion,而且連 progress 都讀不出來
-- (2026-10-01 真的踩到,全站登入後讀進度直接失敗)。
-- 解法是把判斷包成 security definer 函式,函式內部不再套 RLS,遞迴就斷了。
-- 這三個函式都只拿 auth.uid() 跟自己比對,問不出別人的資訊。

create or replace function public.is_class_owner(p_class uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.classes c where c.id = p_class and c.teacher_id = auth.uid());
$$;

create or replace function public.is_class_member(p_class uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.memberships m where m.class_id = p_class and m.student_id = auth.uid());
$$;

create or replace function public.teaches_student(p_student uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.memberships m join public.classes c on c.id = m.class_id
                 where m.student_id = p_student and c.teacher_id = auth.uid());
$$;

grant execute on function public.is_class_owner(uuid) to authenticated;
grant execute on function public.is_class_member(uuid) to authenticated;
grant execute on function public.teaches_student(uuid) to authenticated;

-- ---------- 4. 權限 ----------

alter table public.classes enable row level security;
alter table public.memberships enable row level security;
alter table public.teacher_applications enable row level security;

-- 班級:老師管自己的班
drop policy if exists "teacher owns classes" on public.classes;
create policy "teacher owns classes" on public.classes
  for all
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid() and exists (select 1 from public.teachers t where t.user_id = auth.uid()));

-- 班級:學生看得到自己加入的班(顯示班名用);沒有「用邀請碼查班級」的讀取權,
-- 所以學生無法靠列舉邀請碼找別人的班,加入一律走 join_class()
drop policy if exists "student sees joined classes" on public.classes;
create policy "student sees joined classes" on public.classes
  for select
  using (public.is_class_member(id));

-- 學生↔班級:學生看自己的、可自己退出;老師看管自己班上的
-- 沒有給學生 insert,加入只能透過 join_class()
drop policy if exists "student reads own memberships" on public.memberships;
create policy "student reads own memberships" on public.memberships
  for select using (student_id = auth.uid());

drop policy if exists "student leaves class" on public.memberships;
create policy "student leaves class" on public.memberships
  for delete using (student_id = auth.uid());

drop policy if exists "teacher manages own class members" on public.memberships;
create policy "teacher manages own class members" on public.memberships
  for all
  using (public.is_class_owner(class_id))
  with check (public.is_class_owner(class_id));

-- 老師申請:自己送、自己查狀態;站長可讀可審
drop policy if exists "applicant writes own application" on public.teacher_applications;
create policy "applicant writes own application" on public.teacher_applications
  for insert with check (user_id = auth.uid() and status = 'pending');

drop policy if exists "applicant reads own application" on public.teacher_applications;
create policy "applicant reads own application" on public.teacher_applications
  for select using (user_id = auth.uid());

drop policy if exists "owner reviews applications" on public.teacher_applications;
create policy "owner reviews applications" on public.teacher_applications
  for all
  using (exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.is_owner))
  with check (exists (select 1 from public.teachers t where t.user_id = auth.uid() and t.is_owner));

-- progress:把「讀全站」換成「只讀自己班上的學生」
drop policy if exists "teacher read all" on public.progress;
drop policy if exists "teacher reads own students" on public.progress;
create policy "teacher reads own students" on public.progress
  for select
  using (public.teaches_student(user_id));

-- ---------- 5. 加入班級的函式 ----------
-- 學生不能直接寫 memberships,只能拿邀請碼呼叫這個函式。
-- security definer 才能在沒有 classes 讀取權的情況下比對邀請碼。
create or replace function public.join_class(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if auth.uid() is null then
    raise exception '請先登入';
  end if;
  select id, name, teacher_id into c
  from public.classes
  where upper(code) = upper(btrim(p_code)) and active;
  if not found then
    raise exception '邀請碼不存在或已停用';
  end if;
  if c.teacher_id = auth.uid() then
    raise exception '這是你自己開的班級';
  end if;
  insert into public.memberships (student_id, class_id)
  values (auth.uid(), c.id)
  on conflict do nothing;
  return c.name;
end;
$$;

revoke all on function public.join_class(text) from public;
revoke all on function public.join_class(text) from anon;
grant execute on function public.join_class(text) to authenticated;

-- 邀請碼比對用得到,順手補索引
create index if not exists classes_code_idx on public.classes (upper(code));

-- ---------- 6. 回填:現有 6 位學生 → 她的預設班級 ----------
-- 不回填的話,政策一換教師後台就看不到任何人。
insert into public.teachers (user_id, is_owner)
select id, true from auth.users where email = 'bonnie8536@gmail.com'
on conflict (user_id) do update set is_owner = true;

insert into public.classes (teacher_id, name)
select t.user_id, '刷刷英文'
from public.teachers t
where t.is_owner
  and not exists (select 1 from public.classes c where c.teacher_id = t.user_id);

insert into public.memberships (student_id, class_id)
select u.id, c.id
from auth.users u
cross join (
  select c.id, c.teacher_id from public.classes c
  join public.teachers t on t.user_id = c.teacher_id and t.is_owner
  order by c.created_at limit 1
) c
where u.id <> c.teacher_id
on conflict do nothing;
-- ---------- 檢查 ----------
-- select name, code from public.classes;                 → 一列「刷刷英文」+ 8 碼邀請碼
-- select count(*) from public.memberships;               → 6
-- 一定要跑這條,確認沒有遞迴(回 95 / 7 才算過):
--   set role authenticated;
--   set "request.jwt.claims" = '{"sub":"<老師的 uid>","role":"authenticated"}';
--   select count(*), count(distinct user_id) from public.progress;
-- select polname from pg_policy
--   where polrelid = 'public.progress'::regclass;        → own rows + teacher reads own students
