-- 1. Profiles table (extends auth.users)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  name text,
  avatar_url text,
  stripe_customer_id text unique,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  interactions_used integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- 2. Scores table
create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  description text default '',
  file_path text not null,
  created_at timestamptz not null default now()
);

alter table public.scores enable row level security;

create policy "Users can view own scores" on public.scores
  for select using (auth.uid() = user_id);
create policy "Users can insert own scores" on public.scores
  for insert with check (auth.uid() = user_id);
create policy "Users can delete own scores" on public.scores
  for delete using (auth.uid() = user_id);

-- 3. Atomic increment function for interaction counting
create or replace function public.increment_interactions(user_id uuid)
returns void as $$
begin
  update public.profiles
  set interactions_used = interactions_used + 1
  where id = user_id;
end;
$$ language plpgsql security definer;

-- 4. Storage bucket + RLS policies
insert into storage.buckets (id, name, public)
values ('scores', 'scores', false);

create policy "Users can upload own scores" on storage.objects
  for insert with check (
    bucket_id = 'scores' AND auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "Users can read own scores" on storage.objects
  for select using (
    bucket_id = 'scores' AND auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "Users can delete own scores" on storage.objects
  for delete using (
    bucket_id = 'scores' AND auth.uid()::text = (storage.foldername(name))[1]
  );
