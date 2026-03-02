create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.profiles(id) on delete cascade,
  name         text not null,
  key_hash     text not null unique,   -- sha256(full_key)
  key_prefix   text not null,          -- first 12 chars for display, e.g. "ys_abc12345"
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

alter table public.api_keys enable row level security;

create policy "Users manage their own keys"
  on public.api_keys for all
  using (auth.uid() = user_id);
