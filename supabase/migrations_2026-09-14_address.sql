-- Run once in the Supabase SQL editor if you created the tables before Sep 14, 2026.
alter table public.profiles add column if not exists address text;
alter table public.profiles add column if not exists home jsonb;
