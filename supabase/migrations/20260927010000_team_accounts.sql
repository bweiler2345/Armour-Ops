-- Phase 1B: owner-managed accounts with temporary passwords.
--
-- Temporary passwords are never stored in this database. Supabase Auth keeps
-- only its own password hash in auth.users; this schema records only that a
-- temporary password was issued, by whom, and when.
--
-- Safe to run on a project that already has Phase 1 users: existing profiles
-- are kept and their email is copied from auth.users.

-- 1. Account status columns on profiles -------------------------------------

alter table public.profiles
  add column email text,
  add column must_change_password boolean not null default false,
  add column temp_password_issued_at timestamptz,
  add column temp_password_issued_by uuid references public.profiles (id) on delete set null,
  add column password_changed_at timestamptz,
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references public.profiles (id) on delete set null;

update public.profiles as p
set email = u.email
from auth.users as u
where u.id = p.id;

-- New users get their email copied too.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email
  );
  return new;
end;
$$;

-- Keep the copy in sync if an email changes in Supabase Auth.
create function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

revoke execute on function public.sync_profile_email() from public, anon, authenticated;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

-- 2. Never leave the app without an active owner ------------------------------

create function public.prevent_losing_last_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner' and old.active
     and (new.role <> 'owner' or not new.active)
     and not exists (
       select 1 from public.profiles
       where id <> old.id and role = 'owner' and active
     )
  then
    raise exception 'The last active owner cannot be deactivated or demoted.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger profiles_keep_an_owner
  before update of role, active on public.profiles
  for each row
  execute function public.prevent_losing_last_owner();

-- 3. Account history (never contains passwords) -------------------------------

create type public.account_event_type as enum (
  'account_created',
  'temporary_password_issued',
  'deactivated',
  'reactivated',
  'password_changed'
);

create table public.account_events (
  id bigint generated always as identity primary key,
  target_id uuid references public.profiles (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  event_type public.account_event_type not null,
  created_at timestamptz not null default now()
);

comment on table public.account_events is
  'Who created, reset, deactivated, or reactivated an account, and when. Never stores passwords.';

create index account_events_target_idx on public.account_events (target_id, created_at desc);

alter table public.account_events enable row level security;

create policy "Owners can read account history"
  on public.account_events
  for select
  to authenticated
  using ((select public.is_owner()));

revoke all on public.account_events from anon, authenticated;
grant select on public.account_events to authenticated;

-- 4. Functions that change account status -------------------------------------
--
-- The owner-only functions are callable only with the server-side secret key
-- (the service_role database role). The app calls them from Server Actions
-- after verifying the signed-in user is an active owner. Timestamps come from
-- the database clock.

create function public.admin_record_account_created(
  p_target uuid,
  p_actor uuid,
  p_full_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set full_name = p_full_name,
      role = 'employee',
      active = true,
      must_change_password = true,
      temp_password_issued_at = now(),
      temp_password_issued_by = p_actor
  where id = p_target;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  insert into public.account_events (target_id, actor_id, event_type)
  values (p_target, p_actor, 'account_created');
end;
$$;

create function public.admin_record_temporary_password(
  p_target uuid,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set must_change_password = true,
      temp_password_issued_at = now(),
      temp_password_issued_by = p_actor
  where id = p_target;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  insert into public.account_events (target_id, actor_id, event_type)
  values (p_target, p_actor, 'temporary_password_issued');
end;
$$;

create function public.admin_set_account_active(
  p_target uuid,
  p_actor uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_target = p_actor and not p_active then
    raise exception 'Owners cannot deactivate their own account.'
      using errcode = 'P0001';
  end if;

  update public.profiles
  set active = p_active,
      deactivated_at = case when p_active then null else now() end,
      deactivated_by = case when p_active then null else p_actor end
  where id = p_target;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  insert into public.account_events (target_id, actor_id, event_type)
  values (
    p_target,
    p_actor,
    case when p_active then 'reactivated' else 'deactivated' end::public.account_event_type
  );
end;
$$;

revoke execute on function public.admin_record_account_created(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_record_temporary_password(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.admin_set_account_active(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_record_account_created(uuid, uuid, text) to service_role;
grant execute on function public.admin_record_temporary_password(uuid, uuid) to service_role;
grant execute on function public.admin_set_account_active(uuid, uuid, boolean) to service_role;

-- Called by a signed-in user right after changing their own password. It can
-- only affect the caller's own profile.
create function public.record_own_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  update public.profiles
  set must_change_password = false,
      password_changed_at = now()
  where id = v_user and active;

  if found then
    insert into public.account_events (target_id, actor_id, event_type)
    values (v_user, v_user, 'password_changed');
  end if;
end;
$$;

revoke execute on function public.record_own_password_change() from public, anon;
grant execute on function public.record_own_password_change() to authenticated;
