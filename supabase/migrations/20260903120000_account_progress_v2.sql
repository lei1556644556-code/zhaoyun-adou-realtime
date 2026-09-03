-- 赵云与阿斗：云存档 v2 写入协议。
-- 目标：账号行隔离、限制客户端写入面，并通过 revision CAS 阻止多设备静默覆盖。

create extension if not exists pgcrypto with schema extensions;

alter table public.zhaoyun_adou_profiles
  add column if not exists progress_revision bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'zhaoyun_adou_profiles_progress_revision_nonnegative'
      and conrelid = 'public.zhaoyun_adou_profiles'::regclass
  ) then
    alter table public.zhaoyun_adou_profiles
      add constraint zhaoyun_adou_profiles_progress_revision_nonnegative
      check (progress_revision >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zhaoyun_adou_profiles_progress_object'
      and conrelid = 'public.zhaoyun_adou_profiles'::regclass
  ) then
    -- NOT VALID preserves an upgrade path if a legacy row was manually corrupted.
    -- It still validates every insert/update; operators can validate existing rows after audit.
    alter table public.zhaoyun_adou_profiles
      add constraint zhaoyun_adou_profiles_progress_object
      check (jsonb_typeof(progress) = 'object') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zhaoyun_adou_profiles_progress_size'
      and conrelid = 'public.zhaoyun_adou_profiles'::regclass
  ) then
    alter table public.zhaoyun_adou_profiles
      add constraint zhaoyun_adou_profiles_progress_size
      check (pg_column_size(progress) <= 1048576) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'zhaoyun_adou_profiles_progress_version'
      and conrelid = 'public.zhaoyun_adou_profiles'::regclass
  ) then
    alter table public.zhaoyun_adou_profiles
      add constraint zhaoyun_adou_profiles_progress_version
      check (
        jsonb_typeof(progress -> 'version') = 'number'
        and progress ->> 'version' = '1'
      ) not valid;
  end if;
end $$;

create or replace function public.zhaoyun_adou_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists zhaoyun_adou_profiles_set_updated_at on public.zhaoyun_adou_profiles;
create trigger zhaoyun_adou_profiles_set_updated_at
before update on public.zhaoyun_adou_profiles
for each row execute function public.zhaoyun_adou_set_updated_at();

create or replace function public.zhaoyun_adou_save_progress(
  p_account_id uuid,
  p_expected_revision bigint,
  p_progress jsonb
)
returns table (
  saved_progress jsonb,
  saved_revision bigint,
  saved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or p_account_id is distinct from v_user_id then
    raise exception using errcode = '42501', message = 'account does not match authenticated user';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'expected revision must be nonnegative';
  end if;

  if p_progress is null
    or jsonb_typeof(p_progress) <> 'object'
    or coalesce(jsonb_typeof(p_progress -> 'version'), 'missing') <> 'number'
    or coalesce(p_progress ->> 'version', 'missing') <> '1' then
    raise exception using errcode = '22023', message = 'unsupported progress document';
  end if;

  if pg_column_size(p_progress) > 1048576 then
    raise exception using errcode = '22001', message = 'progress document exceeds 1 MiB';
  end if;

  update public.zhaoyun_adou_profiles as profiles
  set progress = p_progress,
      progress_revision = profiles.progress_revision + 1
  where profiles.user_id = p_account_id
    and profiles.progress_revision = p_expected_revision
  returning profiles.progress, profiles.progress_revision, profiles.updated_at
  into saved_progress, saved_revision, saved_at;

  if not found then
    if exists (
      select 1 from public.zhaoyun_adou_profiles as profiles
      where profiles.user_id = p_account_id
    ) then
      raise exception using errcode = '40001', message = 'progress revision conflict';
    end if;
    raise exception using errcode = 'P0002', message = 'player profile not found';
  end if;

  return next;
end;
$$;

alter table public.zhaoyun_adou_profiles force row level security;

-- The normalized username must match the deterministic internal Auth email.
-- This prevents one authenticated account from reserving another username in the profile table.
drop policy if exists "zhaoyun_adou_insert_own_profile" on public.zhaoyun_adou_profiles;
create policy "zhaoyun_adou_insert_own_profile"
on public.zhaoyun_adou_profiles for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and lower(coalesce((select auth.jwt()) ->> 'email', '')) =
    'u_' || substr(
      encode(extensions.digest(convert_to('zhaoyun-adou:' || username_normalized, 'UTF8'), 'sha256'), 'hex'),
      1,
      48
    ) || '@accounts.zhaoyun-adou.game'
);

-- Authenticated clients may create only their own identity row and read their own data.
-- Progress updates go exclusively through the account-bound CAS function above.
revoke all on table public.zhaoyun_adou_profiles from anon;
revoke insert, update, delete on table public.zhaoyun_adou_profiles from authenticated;
grant select on table public.zhaoyun_adou_profiles to authenticated;
grant insert (user_id, display_name, username_normalized)
  on table public.zhaoyun_adou_profiles to authenticated;

revoke all on function public.zhaoyun_adou_set_updated_at() from public, anon, authenticated;
revoke all on function public.zhaoyun_adou_save_progress(uuid, bigint, jsonb) from public, anon;
grant execute on function public.zhaoyun_adou_save_progress(uuid, bigint, jsonb) to authenticated;

comment on function public.zhaoyun_adou_save_progress(uuid, bigint, jsonb) is
  'Account-bound optimistic-concurrency save; callers must reload after SQLSTATE 40001.';
