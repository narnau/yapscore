-- Replace the library-oriented `scores` table with a `files` table that stores
-- a user's working score files including edit history and chat messages.

-- 1. Drop old scores table (and its storage policies will be removed below)
drop table if exists public.scores cascade;

-- 2. Create files table
create table public.files (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references public.profiles(id) on delete cascade not null,
  name        text        not null default 'Untitled',
  current_xml text,
  history     jsonb       not null default '[]'::jsonb,
  messages    jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.files enable row level security;

create policy "Users can view own files"   on public.files for select using (auth.uid() = user_id);
create policy "Users can insert own files" on public.files for insert with check (auth.uid() = user_id);
create policy "Users can update own files" on public.files for update using (auth.uid() = user_id);
create policy "Users can delete own files" on public.files for delete using (auth.uid() = user_id);

-- 3. Auto-update updated_at on every row update
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger files_updated_at
  before update on public.files
  for each row execute function public.set_updated_at();

-- 4. Remove old storage policies (scores bucket no longer needed)
drop policy if exists "Users can upload own scores" on storage.objects;
drop policy if exists "Users can read own scores"   on storage.objects;
drop policy if exists "Users can delete own scores" on storage.objects;
