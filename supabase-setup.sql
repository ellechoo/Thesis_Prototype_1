-- supabase-setup.sql — run once in your Supabase project (Dashboard → SQL Editor → New query → paste → Run).
-- Creates the shared archive: a "takes" table with one row per recording, holding the
-- person's name and all measurements. The audio itself is never uploaded.
-- Visitors can add to the archive and read it, but can't change or delete anything.
-- To remove an entry, delete its row (Table Editor → takes).

create table if not exists public.takes (
  id           uuid primary key,
  created_at   timestamptz not null default now(),
  name         text not null check (char_length(name) between 1 and 40),
  source       text,
  seconds      real,
  sample_rate  integer,
  noise_floor  real,
  gate         real,
  settings     jsonb,
  passage      text,
  summary      jsonb,
  rhythm       jsonb,
  accent       jsonb,
  accent_note  text,
  frames       jsonb,          -- every measurement, about 40 per second
  preview      jsonb,          -- a short pitch line for the archive cards
  constraint frames_not_huge check (pg_column_size(frames) < 3000000)
);
create index if not exists takes_created_at on public.takes (created_at desc);

alter table public.takes enable row level security;

drop policy if exists "Anyone can read the archive" on public.takes;
create policy "Anyone can read the archive" on public.takes
  for select to anon, authenticated using (true);

drop policy if exists "Anyone can add to the archive" on public.takes;
create policy "Anyone can add to the archive" on public.takes
  for insert to anon, authenticated with check (true);
-- (no update or delete policies: visitors can't change or remove entries)
