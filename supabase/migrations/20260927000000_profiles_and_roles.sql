-- Phase 1: user profiles, roles, and Row Level Security.
--
-- Every auth user gets a profile with role 'employee' by default. Roles and
-- the active flag are changed only by the owner (through the future Team
-- screen, which uses a server-only path) or in the Supabase SQL editor.
-- There are deliberately no insert, update, or delete policies for signed-in
-- users.

create type public.app_role as enum ('owner', 'employee');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role public.app_role not null default 'employee',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user. Role and active flag drive all app authorization.';

alter table public.profiles enable row level security;

-- Helper functions used by RLS policies. security definer lets them read
-- profiles without recursing through RLS; an empty search_path prevents
-- search-path hijacking.
create function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
  );
$$;

create function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active
      and role = 'owner'
  );
$$;

revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_owner() to authenticated;

create policy "Users can read their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy "Owners can read all profiles"
  on public.profiles
  for select
  to authenticated
  using ((select public.is_owner()));

revoke all on public.profiles from anon;
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;

-- Keep updated_at current.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Create a profile for every new auth user.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Backfill profiles for any users created before this migration ran.
insert into public.profiles (id, full_name)
select id, coalesce(raw_user_meta_data ->> 'full_name', '')
from auth.users
on conflict (id) do nothing;
