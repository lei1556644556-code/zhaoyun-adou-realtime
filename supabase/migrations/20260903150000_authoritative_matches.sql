-- Server-authoritative realtime room checkpoints.
-- Only the service role may read or write these rows; browser clients never access this table.

create table if not exists public.zhaoyun_adou_matches (
  room_id text primary key check (room_id ~ '^[A-Z2-9]{6}$'),
  seats jsonb not null default '[]'::jsonb,
  snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists zhaoyun_adou_matches_expires_at_idx
  on public.zhaoyun_adou_matches (expires_at);

alter table public.zhaoyun_adou_matches enable row level security;

revoke all on table public.zhaoyun_adou_matches from anon, authenticated;

comment on table public.zhaoyun_adou_matches is
  'Private authoritative match checkpoints. Resume tokens are stored only as SHA-256 hashes.';
