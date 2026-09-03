-- 赵云与阿斗：玩家账号档案与云存档。
-- Supabase Auth 负责密码散列和会话；此表只保存公开账号名及游戏进度。

create table if not exists public.zhaoyun_adou_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 16),
  username_normalized text not null unique check (char_length(username_normalized) between 2 and 32),
  progress jsonb not null default '{"version":1,"savedAt":0,"activeMode":null}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.zhaoyun_adou_profiles enable row level security;

drop policy if exists "zhaoyun_adou_read_own_profile" on public.zhaoyun_adou_profiles;
create policy "zhaoyun_adou_read_own_profile"
on public.zhaoyun_adou_profiles for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "zhaoyun_adou_insert_own_profile" on public.zhaoyun_adou_profiles;
create policy "zhaoyun_adou_insert_own_profile"
on public.zhaoyun_adou_profiles for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "zhaoyun_adou_update_own_profile" on public.zhaoyun_adou_profiles;
create policy "zhaoyun_adou_update_own_profile"
on public.zhaoyun_adou_profiles for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on table public.zhaoyun_adou_profiles from anon;
grant select, insert, update on table public.zhaoyun_adou_profiles to authenticated;
