-- Cartography schema. Run in the Supabase SQL editor (Database → SQL).
-- Auth: Supabase Auth (email + password). Every table is locked to the signed-in user by RLS.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  zip text,
  radius_miles integer not null default 10,
  preferred_store_ids text[] not null default '{}',
  stores_cache jsonb,            -- {zip, radius, stores:[...], at}
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Grocery run',
  status text not null default 'active',   -- active | done | template
  saved boolean not null default false,    -- true = reusable saved list
  items jsonb not null default '[]',       -- [{id,name,qty,note,scope,done,addedAt}]
  quotes jsonb not null default '{}',      -- {itemKey: {storeId: {match,product,size,price,source,at}}}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists lists_user_updated on public.lists(user_id, updated_at desc);

alter table public.profiles enable row level security;
alter table public.lists enable row level security;

create policy "own profile" on public.profiles for all
  using (auth.uid() = id) with check (auth.uid() = id);
create policy "own lists" on public.lists for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Create a profile row automatically when a user signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Added: optional home address (stores are measured from here when set).
alter table public.profiles add column if not exists address text;
alter table public.profiles add column if not exists home jsonb;
