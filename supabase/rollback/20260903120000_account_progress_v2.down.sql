-- Manual rollback for 20260903120000_account_progress_v2.sql.
-- Back up zhaoyun_adou_profiles first: dropping progress_revision removes concurrency history.

revoke all on function public.zhaoyun_adou_save_progress(uuid, bigint, jsonb) from public, anon, authenticated;
drop function if exists public.zhaoyun_adou_save_progress(uuid, bigint, jsonb);

drop trigger if exists zhaoyun_adou_profiles_set_updated_at on public.zhaoyun_adou_profiles;
drop function if exists public.zhaoyun_adou_set_updated_at();

alter table public.zhaoyun_adou_profiles
  drop constraint if exists zhaoyun_adou_profiles_progress_size,
  drop constraint if exists zhaoyun_adou_profiles_progress_object,
  drop constraint if exists zhaoyun_adou_profiles_progress_version,
  drop constraint if exists zhaoyun_adou_profiles_progress_revision_nonnegative,
  drop column if exists progress_revision;

alter table public.zhaoyun_adou_profiles no force row level security;

drop policy if exists "zhaoyun_adou_insert_own_profile" on public.zhaoyun_adou_profiles;
create policy "zhaoyun_adou_insert_own_profile"
on public.zhaoyun_adou_profiles for insert
to authenticated
with check ((select auth.uid()) = user_id);

grant select, insert, update on table public.zhaoyun_adou_profiles to authenticated;
revoke all on table public.zhaoyun_adou_profiles from anon;
