-- Phase 10: Pre-Week Setup and trailer inventory.
--
-- Trailers share one inventory template (inventory_items). Each trailer has
-- one setup per America/Chicago calendar week starting Monday, created on
-- first access with a snapshot of the template's labels, categories, units,
-- and targets. Later template changes never touch an existing week.
--
-- Employees enter each count item's usable quantity (or choose Ready, Need
-- More, or Missing for status-only items such as Rags). The database
-- calculates every status and shortage; the browser can't set them. A setup
-- is submitted once every item is assessed, and becomes read only. The owner
-- can reopen a submitted setup with a reason; every submission is kept as a
-- full, unchangeable record. Nothing here is ever deleted.

-- 1. Types -------------------------------------------------------------------------------

create type public.inventory_tracking as enum ('count', 'status_only');
create type public.inventory_status as enum ('ready', 'missing', 'need_more');
create type public.setup_state as enum ('draft', 'submitted');
create type public.pre_week_activity_type as enum (
  'trailer_added', 'trailer_renamed', 'trailer_archived',
  'item_added', 'item_edited', 'item_archived', 'item_moved',
  'setup_started', 'setup_submitted', 'setup_reopened'
);

-- The Monday that starts the America/Chicago calendar week containing p_at.
create function public.pre_week_start(p_at timestamptz default now())
returns date
language sql
stable
set search_path = ''
as $$ select date_trunc('week', (p_at at time zone 'America/Chicago'))::date $$;

-- 2. Trailers and the shared template ------------------------------------------------------

create table public.trailers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 60),
  position integer not null check (position >= 1),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles (id),
  check ((archived_at is null) = (archived_by is null))
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category = btrim(category) and char_length(category) between 1 and 60),
  category_position integer not null check (category_position >= 1),
  position integer not null check (position >= 1),
  label text not null check (label = btrim(label) and char_length(label) between 1 and 80),
  tracking public.inventory_tracking not null,
  target_quantity integer check (target_quantity is null or target_quantity between 1 and 1000),
  unit_label text check (unit_label is null or (unit_label = btrim(unit_label) and char_length(unit_label) between 1 and 30)),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles (id),
  check ((tracking = 'count') = (target_quantity is not null)),
  check (tracking = 'count' or unit_label is null),
  check ((archived_at is null) = (archived_by is null))
);

comment on table public.inventory_items is
  'The Pre-Week Setup template shared by every trailer. Changes apply to weeks not yet started; each week keeps its own snapshot.';

-- 3. Weekly setups (one per trailer per week) ----------------------------------------------

create table public.weekly_setups (
  id uuid primary key default gen_random_uuid(),
  trailer_id uuid not null references public.trailers (id),
  week_start date not null check (extract(isodow from week_start) = 1),
  state public.setup_state not null default 'draft',
  started_by uuid not null references public.profiles (id),
  started_at timestamptz not null default now(),
  submitted_by uuid references public.profiles (id),
  submitted_at timestamptz,
  restock_notes text not null default '' check (char_length(restock_notes) <= 2000),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz,
  unique (trailer_id, week_start),
  check ((state = 'submitted') = (submitted_at is not null and submitted_by is not null))
);

-- The week's snapshot of each template item, with what was found.
create table public.weekly_setup_items (
  id uuid primary key default gen_random_uuid(),
  setup_id uuid not null references public.weekly_setups (id),
  source_item_id uuid not null references public.inventory_items (id),
  category text not null,
  category_position integer not null,
  position integer not null,
  label text not null,
  tracking public.inventory_tracking not null,
  target_quantity integer,
  unit_label text,
  usable_quantity integer check (usable_quantity is null or usable_quantity between 0 and 100000),
  selected_status public.inventory_status,
  status public.inventory_status,
  shortage integer check (shortage is null or shortage >= 0),
  note text not null default '' check (char_length(note) <= 500),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz,
  unique (setup_id, source_item_id),
  check (tracking = 'count' or usable_quantity is null),
  check (tracking = 'status_only' or selected_status is null)
);

create index weekly_setup_items_setup_idx on public.weekly_setup_items (setup_id);

-- Each submission, kept whole and never changed (a reopened setup can be
-- submitted again; every submission stays).
create table public.weekly_setup_submissions (
  id uuid primary key default gen_random_uuid(),
  setup_id uuid not null references public.weekly_setups (id),
  trailer_id uuid not null references public.trailers (id),
  week_start date not null,
  submitted_by uuid not null references public.profiles (id),
  submitted_at timestamptz not null default now(),
  ready_count integer not null,
  missing_count integer not null,
  need_more_count integer not null,
  restock_notes text not null,
  items jsonb not null
);

create table public.weekly_setup_reopenings (
  id uuid primary key default gen_random_uuid(),
  setup_id uuid not null references public.weekly_setups (id),
  submission_id uuid not null references public.weekly_setup_submissions (id),
  reason text not null check (btrim(reason) <> '' and char_length(reason) <= 500),
  reopened_by uuid not null references public.profiles (id),
  reopened_at timestamptz not null default now()
);

create table public.pre_week_activity (
  id bigint generated always as identity primary key,
  activity_type public.pre_week_activity_type not null,
  actor_id uuid references public.profiles (id),
  trailer_id uuid references public.trailers (id),
  item_id uuid references public.inventory_items (id),
  setup_id uuid references public.weekly_setups (id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 4. Protect history -------------------------------------------------------------------------

create trigger trailers_never_deleted before delete on public.trailers
  for each row execute function public.prevent_history_change();
create trigger inventory_items_never_deleted before delete on public.inventory_items
  for each row execute function public.prevent_history_change();
create trigger weekly_setups_never_deleted before delete on public.weekly_setups
  for each row execute function public.prevent_history_change();
create trigger weekly_setup_items_never_deleted before delete on public.weekly_setup_items
  for each row execute function public.prevent_history_change();
create trigger weekly_setup_submissions_append_only before update or delete on public.weekly_setup_submissions
  for each row execute function public.prevent_history_change();
create trigger weekly_setup_reopenings_append_only before update or delete on public.weekly_setup_reopenings
  for each row execute function public.prevent_history_change();
create trigger pre_week_activity_append_only before update or delete on public.pre_week_activity
  for each row execute function public.prevent_history_change();

-- Snapshot fields never change; results change only while the setup is a
-- draft; status and shortage are always calculated here.
create function public.guard_weekly_setup_item()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.setup_id is distinct from old.setup_id
       or new.source_item_id is distinct from old.source_item_id
       or new.category is distinct from old.category
       or new.category_position is distinct from old.category_position
       or new.position is distinct from old.position
       or new.label is distinct from old.label
       or new.tracking is distinct from old.tracking
       or new.target_quantity is distinct from old.target_quantity
       or new.unit_label is distinct from old.unit_label
    then
      raise exception 'A week''s snapshot of the inventory list can''t change.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.weekly_setups where id = new.setup_id and state = 'submitted') then
      raise exception 'This setup was submitted and is read only.' using errcode = 'P0001';
    end if;
  end if;

  if new.tracking = 'count' then
    new.selected_status := null;
    if new.usable_quantity is null then
      new.status := null;
      new.shortage := null;
    elsif new.usable_quantity = 0 then
      new.status := 'missing';
      new.shortage := new.target_quantity;
    elsif new.usable_quantity < new.target_quantity then
      new.status := 'need_more';
      new.shortage := new.target_quantity - new.usable_quantity;
    else
      new.status := 'ready';
      new.shortage := 0;
    end if;
  else
    new.usable_quantity := null;
    new.status := new.selected_status;
    new.shortage := null;
  end if;
  return new;
end;
$$;

create trigger weekly_setup_items_guard
  before insert or update on public.weekly_setup_items
  for each row execute function public.guard_weekly_setup_item();

create function public.guard_weekly_setup()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.trailer_id is distinct from old.trailer_id
     or new.week_start is distinct from old.week_start
     or new.started_by is distinct from old.started_by
     or new.started_at is distinct from old.started_at
  then
    raise exception 'A weekly setup''s record can''t change.' using errcode = 'P0001';
  end if;
  if old.state = 'submitted' and new.state = 'submitted' then
    raise exception 'This setup was submitted and is read only.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger weekly_setups_guard
  before update on public.weekly_setups
  for each row execute function public.guard_weekly_setup();

-- 5. Helpers --------------------------------------------------------------------------------

-- Pre-Week Setup entries are made by active employees.
create function public.require_setup_worker()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not exists (select 1 from public.profiles where id = v_user and active and role = 'employee') then
    raise exception 'Only an active employee can fill in Pre-Week Setup.' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

-- A setup that can take entries: a draft, for this week or reopened by the
-- owner, on a trailer that isn't archived. Locks it.
create function public.require_editable_setup(p_setup uuid)
returns public.weekly_setups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_setup public.weekly_setups;
begin
  select * into v_setup from public.weekly_setups where id = p_setup for update;
  if v_setup.id is null then
    raise exception 'Setup not found.' using errcode = 'P0002';
  end if;
  if v_setup.state = 'submitted' then
    raise exception 'This setup was submitted and is read only. The owner can reopen it.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.trailers where id = v_setup.trailer_id and archived_at is not null) then
    raise exception 'This trailer is archived.' using errcode = 'P0001';
  end if;
  if v_setup.week_start <> public.pre_week_start()
     and not exists (select 1 from public.weekly_setup_reopenings r where r.setup_id = p_setup)
  then
    raise exception 'This week has ended, so its setup can''t be changed.' using errcode = 'P0001';
  end if;
  return v_setup;
end;
$$;

-- 6. Starting a week --------------------------------------------------------------------------

-- This week's setup for a trailer, created (with its snapshot) on first
-- access by any active user. Simultaneous first visits create one setup.
create function public.ensure_weekly_setup(p_trailer uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_week date := public.pre_week_start();
  v_setup uuid;
begin
  if not public.is_active_user() then
    raise exception 'Only active users can open Pre-Week Setup.' using errcode = '42501';
  end if;
  -- Archived trailers take no new work; their history is read elsewhere.
  if not exists (select 1 from public.trailers where id = p_trailer and archived_at is null) then
    raise exception 'Trailer not found.' using errcode = 'P0002';
  end if;
  select id into v_setup from public.weekly_setups where trailer_id = p_trailer and week_start = v_week;
  if v_setup is not null then
    return v_setup;
  end if;

  insert into public.weekly_setups (trailer_id, week_start, started_by)
  values (p_trailer, v_week, v_user)
  on conflict (trailer_id, week_start) do nothing
  returning id into v_setup;
  if v_setup is null then
    -- Another visit created it first.
    select id into v_setup from public.weekly_setups where trailer_id = p_trailer and week_start = v_week;
    return v_setup;
  end if;

  insert into public.weekly_setup_items (
    setup_id, source_item_id, category, category_position, position, label, tracking, target_quantity, unit_label
  )
  select v_setup, i.id, i.category, i.category_position, i.position, i.label, i.tracking, i.target_quantity, i.unit_label
  from public.inventory_items i
  where i.archived_at is null;

  insert into public.pre_week_activity (activity_type, actor_id, trailer_id, setup_id, details)
  values ('setup_started', v_user, p_trailer, v_setup, jsonb_build_object('week_start', v_week));
  return v_setup;
end;
$$;

-- 7. Entries ------------------------------------------------------------------------------------

-- Saves one item: the usable quantity for a count item (blank clears it), or
-- Ready, Need More, or Missing for a status-only item, plus the note. The
-- status and shortage are calculated by the database.
create function public.save_setup_item(
  p_item uuid,
  p_quantity integer,
  p_status public.inventory_status,
  p_note text
)
returns table (status public.inventory_status, shortage integer, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_setup_worker();
  v_item public.weekly_setup_items;
begin
  select * into v_item from public.weekly_setup_items where id = p_item;
  if v_item.id is null then
    raise exception 'Item not found.' using errcode = 'P0002';
  end if;
  perform public.require_editable_setup(v_item.setup_id);
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'Keep each note to 500 characters or fewer.' using errcode = 'P0001';
  end if;
  if v_item.tracking = 'count' then
    if p_status is not null then
      raise exception 'Enter a count for this item; its status is calculated.' using errcode = 'P0001';
    end if;
    if p_quantity is not null and p_quantity < 0 then
      raise exception 'A count can''t be negative.' using errcode = 'P0001';
    end if;
    if p_quantity is not null and p_quantity > 100000 then
      raise exception 'That count is too large.' using errcode = 'P0001';
    end if;
  elsif p_quantity is not null then
    raise exception 'Choose Ready, Need More, or Missing for this item.' using errcode = 'P0001';
  end if;

  update public.weekly_setup_items i
  set usable_quantity = p_quantity,
      selected_status = p_status,
      note = btrim(coalesce(p_note, '')),
      updated_by = v_user,
      updated_at = now()
  where i.id = p_item;
  update public.weekly_setups set updated_by = v_user, updated_at = now() where id = v_item.setup_id;

  return query select i.status, i.shortage, i.updated_at from public.weekly_setup_items i where i.id = p_item;
end;
$$;

create function public.save_setup_restock_notes(p_setup uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_setup_worker();
begin
  perform public.require_editable_setup(p_setup);
  if char_length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Keep restock notes to 2,000 characters or fewer.' using errcode = 'P0001';
  end if;
  update public.weekly_setups
  set restock_notes = btrim(coalesce(p_notes, '')), updated_by = v_user, updated_at = now()
  where id = p_setup;
end;
$$;

-- 8. Submitting and reopening ------------------------------------------------------------------

-- Submits a setup once every item is assessed. Returns 'submitted', or
-- 'already_submitted' (nothing changes) when a simultaneous tap got there
-- first.
create function public.submit_weekly_setup(p_setup uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_setup_worker();
  v_setup public.weekly_setups;
  v_missing text;
begin
  select * into v_setup from public.weekly_setups where id = p_setup for update;
  if v_setup.id is null then
    raise exception 'Setup not found.' using errcode = 'P0002';
  end if;
  if v_setup.state = 'submitted' then
    return 'already_submitted';
  end if;
  perform public.require_editable_setup(p_setup);

  select label into v_missing
  from public.weekly_setup_items
  where setup_id = p_setup and status is null
  order by category_position, position
  limit 1;
  if v_missing is not null then
    raise exception 'Check every item first. Not done yet: %', v_missing using errcode = 'P0001';
  end if;

  update public.weekly_setups
  set state = 'submitted', submitted_by = v_user, submitted_at = now(), updated_by = v_user, updated_at = now()
  where id = p_setup;

  insert into public.weekly_setup_submissions (
    setup_id, trailer_id, week_start, submitted_by, ready_count, missing_count, need_more_count, restock_notes, items
  )
  select p_setup, v_setup.trailer_id, v_setup.week_start, v_user,
    count(*) filter (where i.status = 'ready'),
    count(*) filter (where i.status = 'missing'),
    count(*) filter (where i.status = 'need_more'),
    v_setup.restock_notes,
    jsonb_agg(jsonb_build_object(
      'item_id', i.source_item_id, 'category', i.category, 'label', i.label, 'tracking', i.tracking,
      'target_quantity', i.target_quantity, 'unit_label', i.unit_label, 'usable_quantity', i.usable_quantity,
      'status', i.status, 'shortage', i.shortage, 'note', i.note, 'updated_by', i.updated_by, 'updated_at', i.updated_at
    ) order by i.category_position, i.position)
  from public.weekly_setup_items i
  where i.setup_id = p_setup;

  insert into public.pre_week_activity (activity_type, actor_id, trailer_id, setup_id, details)
  values ('setup_submitted', v_user, v_setup.trailer_id, p_setup, jsonb_build_object('week_start', v_setup.week_start));
  return 'submitted';
end;
$$;

create function public.reopen_weekly_setup(p_setup uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_setup public.weekly_setups;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_submission uuid;
begin
  if v_reason = '' then
    raise exception 'Give a reason for reopening this setup.' using errcode = 'P0001';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Keep the reason to 500 characters or fewer.' using errcode = 'P0001';
  end if;
  select * into v_setup from public.weekly_setups where id = p_setup for update;
  if v_setup.id is null then
    raise exception 'Setup not found.' using errcode = 'P0002';
  end if;
  if v_setup.state <> 'submitted' then
    raise exception 'Only a submitted setup can be reopened.' using errcode = 'P0001';
  end if;
  select id into v_submission from public.weekly_setup_submissions
  where setup_id = p_setup order by submitted_at desc limit 1;

  update public.weekly_setups
  set state = 'draft', submitted_by = null, submitted_at = null, updated_by = v_owner, updated_at = now()
  where id = p_setup;
  insert into public.weekly_setup_reopenings (setup_id, submission_id, reason, reopened_by)
  values (p_setup, v_submission, v_reason, v_owner);
  insert into public.pre_week_activity (activity_type, actor_id, trailer_id, setup_id, details)
  values ('setup_reopened', v_owner, v_setup.trailer_id, p_setup, jsonb_build_object('reason', v_reason));
end;
$$;

-- 9. Owner management ------------------------------------------------------------------------

create function public.add_trailer(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_id uuid;
begin
  insert into public.trailers (name, position, created_by)
  values (btrim(coalesce(p_name, '')), coalesce((select max(position) from public.trailers), 0) + 1, v_owner)
  returning id into v_id;
  insert into public.pre_week_activity (activity_type, actor_id, trailer_id, details)
  values ('trailer_added', v_owner, v_id, jsonb_build_object('name', btrim(p_name)));
  return v_id;
end;
$$;

create function public.rename_trailer(p_trailer uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_old text;
begin
  select name into v_old from public.trailers where id = p_trailer for update;
  if v_old is null then
    raise exception 'Trailer not found.' using errcode = 'P0002';
  end if;
  if v_old = btrim(coalesce(p_name, '')) then
    return;
  end if;
  update public.trailers set name = btrim(coalesce(p_name, '')) where id = p_trailer;
  insert into public.pre_week_activity (activity_type, actor_id, trailer_id, details)
  values ('trailer_renamed', v_owner, p_trailer, jsonb_build_object('from', v_old, 'to', btrim(p_name)));
end;
$$;

-- Archiving hides a trailer from new weeks; its history stays.
create function public.archive_trailer(p_trailer uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_trailer public.trailers;
begin
  select * into v_trailer from public.trailers where id = p_trailer for update;
  if v_trailer.id is null then
    raise exception 'Trailer not found.' using errcode = 'P0002';
  end if;
  if v_trailer.archived_at is not null then
    return 'already_archived';
  end if;
  update public.trailers set archived_at = now(), archived_by = v_owner where id = p_trailer;
  insert into public.pre_week_activity (activity_type, actor_id, trailer_id, details)
  values ('trailer_archived', v_owner, p_trailer, jsonb_build_object('name', v_trailer.name));
  return 'archived';
end;
$$;

-- Validates and normalizes an item's editable fields.
create function public.check_inventory_fields(
  p_category text,
  p_label text,
  p_tracking public.inventory_tracking,
  p_target integer,
  p_unit text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if btrim(coalesce(p_category, '')) = '' or char_length(btrim(p_category)) > 60 then
    raise exception 'Choose a category of up to 60 characters.' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_label, '')) = '' or char_length(btrim(p_label)) > 80 then
    raise exception 'Give the item a name of up to 80 characters.' using errcode = 'P0001';
  end if;
  if p_tracking = 'count' and (p_target is null or p_target not between 1 and 1000) then
    raise exception 'Set a target from 1 to 1,000.' using errcode = 'P0001';
  end if;
  if p_tracking = 'status_only' and (p_target is not null or nullif(btrim(coalesce(p_unit, '')), '') is not null) then
    raise exception 'Status-only items have no target or unit.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_unit, ''))) > 30 then
    raise exception 'Keep the unit to 30 characters or fewer.' using errcode = 'P0001';
  end if;
end;
$$;

create function public.category_position_for(p_category text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select min(category_position) from public.inventory_items where category = btrim(p_category)),
    (select coalesce(max(category_position), 0) + 1 from public.inventory_items)
  );
$$;

create function public.add_inventory_item(
  p_category text,
  p_label text,
  p_tracking public.inventory_tracking,
  p_target integer,
  p_unit text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_category text := btrim(coalesce(p_category, ''));
  v_id uuid;
begin
  perform public.check_inventory_fields(p_category, p_label, p_tracking, p_target, p_unit);
  insert into public.inventory_items (
    category, category_position, position, label, tracking, target_quantity, unit_label, created_by, updated_by
  )
  values (
    v_category, public.category_position_for(v_category),
    coalesce((select max(position) from public.inventory_items where category = v_category), 0) + 1,
    btrim(p_label), p_tracking, case when p_tracking = 'count' then p_target end,
    case when p_tracking = 'count' then nullif(btrim(coalesce(p_unit, '')), '') end, v_owner, v_owner
  )
  returning id into v_id;
  insert into public.pre_week_activity (activity_type, actor_id, item_id, details)
  values ('item_added', v_owner, v_id, jsonb_build_object('label', btrim(p_label), 'category', v_category, 'target', p_target));
  return v_id;
end;
$$;

-- Edits an item for weeks not yet started. Existing weeks keep their snapshot.
create function public.update_inventory_item(
  p_item uuid,
  p_category text,
  p_label text,
  p_target integer,
  p_unit text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_item public.inventory_items;
  v_category text := btrim(coalesce(p_category, ''));
begin
  select * into v_item from public.inventory_items where id = p_item for update;
  if v_item.id is null then
    raise exception 'Item not found.' using errcode = 'P0002';
  end if;
  if v_item.archived_at is not null then
    raise exception 'Archived items can''t be edited.' using errcode = 'P0001';
  end if;
  perform public.check_inventory_fields(p_category, p_label, v_item.tracking, p_target, p_unit);

  update public.inventory_items
  set category = v_category,
      category_position = case when v_category = v_item.category then v_item.category_position else public.category_position_for(v_category) end,
      position = case when v_category = v_item.category then v_item.position
                      else coalesce((select max(position) from public.inventory_items where category = v_category), 0) + 1 end,
      label = btrim(p_label),
      target_quantity = case when v_item.tracking = 'count' then p_target end,
      unit_label = case when v_item.tracking = 'count' then nullif(btrim(coalesce(p_unit, '')), '') end,
      updated_by = v_owner,
      updated_at = now()
  where id = p_item;

  insert into public.pre_week_activity (activity_type, actor_id, item_id, details)
  values ('item_edited', v_owner, p_item, jsonb_build_object(
    'from', jsonb_build_object('label', v_item.label, 'category', v_item.category, 'target', v_item.target_quantity, 'unit', v_item.unit_label),
    'to', jsonb_build_object('label', btrim(p_label), 'category', v_category, 'target', p_target, 'unit', nullif(btrim(coalesce(p_unit, '')), ''))
  ));
end;
$$;

create function public.archive_inventory_item(p_item uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_item public.inventory_items;
begin
  select * into v_item from public.inventory_items where id = p_item for update;
  if v_item.id is null then
    raise exception 'Item not found.' using errcode = 'P0002';
  end if;
  if v_item.archived_at is not null then
    return 'already_archived';
  end if;
  update public.inventory_items set archived_at = now(), archived_by = v_owner, updated_by = v_owner, updated_at = now()
  where id = p_item;
  insert into public.pre_week_activity (activity_type, actor_id, item_id, details)
  values ('item_archived', v_owner, p_item, jsonb_build_object('label', v_item.label));
  return 'archived';
end;
$$;

-- Moves an item one place earlier (-1) or later (+1) within its category.
create function public.move_inventory_item(p_item uuid, p_direction integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_item public.inventory_items;
  v_other public.inventory_items;
begin
  if p_direction not in (-1, 1) then
    raise exception 'Move up or down one place.' using errcode = 'P0001';
  end if;
  select * into v_item from public.inventory_items where id = p_item and archived_at is null for update;
  if v_item.id is null then
    raise exception 'Item not found.' using errcode = 'P0002';
  end if;
  select * into v_other from public.inventory_items o
  where o.category = v_item.category and o.archived_at is null and o.id <> v_item.id
    and (case when p_direction < 0 then o.position < v_item.position else o.position > v_item.position end)
  order by case when p_direction < 0 then -o.position else o.position end
  limit 1
  for update;
  if v_other.id is null then
    return;
  end if;
  update public.inventory_items set position = v_other.position, updated_by = v_owner, updated_at = now() where id = v_item.id;
  update public.inventory_items set position = v_item.position, updated_by = v_owner, updated_at = now() where id = v_other.id;
  insert into public.pre_week_activity (activity_type, actor_id, item_id, details)
  values ('item_moved', v_owner, p_item, jsonb_build_object('direction', p_direction));
end;
$$;

-- 10. Seed: Trailer 1, Trailer 2, and the approved list (docs/PRODUCT_SPEC.md) --------

insert into public.trailers (name, position) values ('Trailer 1', 1), ('Trailer 2', 2);

insert into public.inventory_items (category, category_position, position, label, tracking, target_quantity, unit_label)
values
  ('Core equipment', 1, 1, 'Grinder', 'count', 1, null),
  ('Core equipment', 1, 2, 'Vacuum', 'count', 1, null),
  ('Core equipment', 1, 3, 'Flat vacuum attachment', 'count', 1, null),
  ('Core equipment', 1, 4, 'Round vacuum attachment', 'count', 1, null),
  ('Core equipment', 1, 5, 'Generator', 'count', 1, null),
  ('Core equipment', 1, 6, 'Full fuel cans', 'count', 2, 'cans'),
  ('Core equipment', 1, 7, 'Batteries', 'count', 2, 'batteries'),
  ('Core equipment', 1, 8, 'Battery charger', 'count', 1, null),
  ('Core equipment', 1, 9, 'Extension cords', 'count', 2, 'cords'),
  ('Prep tools', 2, 1, 'Angle grinder', 'count', 1, null),
  ('Prep tools', 2, 2, 'Hand grinder', 'count', 1, null),
  ('Prep tools', 2, 3, 'Palm sander', 'count', 1, null),
  ('Prep tools', 2, 4, 'Leaf blower', 'count', 1, null),
  ('Prep tools', 2, 5, 'Broom', 'count', 1, null),
  ('Prep tools', 2, 6, 'Dustpan', 'count', 1, null),
  ('Prep tools', 2, 7, 'Scrapers', 'count', 2, 'scrapers'),
  ('Prep tools', 2, 8, '5-in-1 tools', 'count', 3, 'tools'),
  ('Prep tools', 2, 9, 'Trowels', 'count', 2, 'trowels'),
  ('Prep tools', 2, 10, 'Screwdriver', 'count', 1, null),
  ('Prep tools', 2, 11, 'Hammer', 'count', 1, null),
  ('Prep tools', 2, 12, 'Utility knives', 'count', 2, 'knives'),
  ('Prep tools', 2, 13, 'Extra-soft bit set', 'count', 1, 'set'),
  ('Prep tools', 2, 14, 'Medium bit set', 'count', 1, 'set'),
  ('Prep tools', 2, 15, 'Full plywood sheet', 'count', 1, 'sheet'),
  ('Prep tools', 2, 16, 'Quarter-board piece', 'count', 1, 'piece'),
  ('Mixing and application', 3, 1, 'Drill', 'count', 1, null),
  ('Mixing and application', 3, 2, 'Base-coat mixer', 'count', 1, null),
  ('Mixing and application', 3, 3, 'Top-coat mixer', 'count', 1, null),
  ('Mixing and application', 3, 4, 'Patch mixer', 'count', 1, null),
  ('Mixing and application', 3, 5, 'Small mixer', 'count', 1, null),
  ('Mixing and application', 3, 6, 'Clear 5-gallon measuring pails', 'count', 2, 'pails'),
  ('Mixing and application', 3, 7, 'Flake buckets', 'count', 10, 'buckets'),
  ('Mixing and application', 3, 8, 'Notched squeegee', 'count', 1, null),
  ('Mixing and application', 3, 9, 'Top-coat squeegee', 'count', 1, null),
  ('Mixing and application', 3, 10, '18-inch rollers', 'count', 2, 'rollers'),
  ('Mixing and application', 3, 11, 'Weenie roller sticks', 'count', 2, 'sticks'),
  ('Mixing and application', 3, 12, 'Pairs of spikes', 'count', 3, 'pairs'),
  ('Materials and consumables', 4, 1, 'TEC 305 patch', 'count', 4, 'bags'),
  ('Materials and consumables', 4, 2, 'Spray bottle', 'count', 1, null),
  ('Materials and consumables', 4, 3, '3-inch brushes', 'count', 30, 'brushes'),
  ('Materials and consumables', 4, 4, 'Weenie roller naps', 'count', 10, 'naps'),
  ('Materials and consumables', 4, 5, '18-inch, 3/8-inch-nap roller covers', 'count', 8, 'covers'),
  ('Materials and consumables', 4, 6, 'Rubber gloves', 'count', 2, 'boxes'),
  ('Materials and consumables', 4, 7, 'Acetone', 'count', 2, 'cans'),
  ('Materials and consumables', 4, 8, 'Rags stocked', 'status_only', null, null),
  ('Materials and consumables', 4, 9, 'Masking tape', 'count', 2, 'rolls'),
  ('Materials and consumables', 4, 10, 'Duct tape', 'count', 2, 'rolls'),
  ('Materials and consumables', 4, 11, 'Pencils', 'count', 10, 'pencils');

-- 11. Permissions -----------------------------------------------------------------------------

revoke execute on function public.pre_week_start(timestamptz) from public, anon;
revoke execute on function public.guard_weekly_setup_item() from public, anon, authenticated;
revoke execute on function public.guard_weekly_setup() from public, anon, authenticated;
revoke execute on function public.require_setup_worker() from public, anon, authenticated;
revoke execute on function public.require_editable_setup(uuid) from public, anon, authenticated;
revoke execute on function public.check_inventory_fields(text, text, public.inventory_tracking, integer, text) from public, anon, authenticated;
revoke execute on function public.category_position_for(text) from public, anon, authenticated;
revoke execute on function public.ensure_weekly_setup(uuid) from public, anon;
revoke execute on function public.save_setup_item(uuid, integer, public.inventory_status, text) from public, anon;
revoke execute on function public.save_setup_restock_notes(uuid, text) from public, anon;
revoke execute on function public.submit_weekly_setup(uuid) from public, anon;
revoke execute on function public.reopen_weekly_setup(uuid, text) from public, anon;
revoke execute on function public.add_trailer(text) from public, anon;
revoke execute on function public.rename_trailer(uuid, text) from public, anon;
revoke execute on function public.archive_trailer(uuid) from public, anon;
revoke execute on function public.add_inventory_item(text, text, public.inventory_tracking, integer, text) from public, anon;
revoke execute on function public.update_inventory_item(uuid, text, text, integer, text) from public, anon;
revoke execute on function public.archive_inventory_item(uuid) from public, anon;
revoke execute on function public.move_inventory_item(uuid, integer) from public, anon;

grant execute on function public.pre_week_start(timestamptz) to authenticated;
grant execute on function public.ensure_weekly_setup(uuid) to authenticated;
grant execute on function public.save_setup_item(uuid, integer, public.inventory_status, text) to authenticated;
grant execute on function public.save_setup_restock_notes(uuid, text) to authenticated;
grant execute on function public.submit_weekly_setup(uuid) to authenticated;
grant execute on function public.reopen_weekly_setup(uuid, text) to authenticated;
grant execute on function public.add_trailer(text) to authenticated;
grant execute on function public.rename_trailer(uuid, text) to authenticated;
grant execute on function public.archive_trailer(uuid) to authenticated;
grant execute on function public.add_inventory_item(text, text, public.inventory_tracking, integer, text) to authenticated;
grant execute on function public.update_inventory_item(uuid, text, text, integer, text) to authenticated;
grant execute on function public.archive_inventory_item(uuid) to authenticated;
grant execute on function public.move_inventory_item(uuid, integer) to authenticated;

-- 12. Read access --------------------------------------------------------------------------------

alter table public.trailers enable row level security;
alter table public.inventory_items enable row level security;
alter table public.weekly_setups enable row level security;
alter table public.weekly_setup_items enable row level security;
alter table public.weekly_setup_submissions enable row level security;
alter table public.weekly_setup_reopenings enable row level security;
alter table public.pre_week_activity enable row level security;

-- Employees see active trailers and their setups; owners see everything.
create policy "Read trailers" on public.trailers for select to authenticated
  using ((select public.is_owner()) or ((select public.is_active_user()) and archived_at is null));
create policy "Read inventory template" on public.inventory_items for select to authenticated
  using ((select public.is_owner()) or ((select public.is_active_user()) and archived_at is null));
create policy "Read weekly setups" on public.weekly_setups for select to authenticated
  using (
    (select public.is_owner())
    or ((select public.is_active_user()) and exists (
      select 1 from public.trailers t where t.id = trailer_id and t.archived_at is null
    ))
  );
create policy "Read weekly setup items" on public.weekly_setup_items for select to authenticated
  using (exists (select 1 from public.weekly_setups s where s.id = setup_id));
create policy "Read weekly submissions" on public.weekly_setup_submissions for select to authenticated
  using ((select public.is_owner()));
create policy "Read setup reopenings" on public.weekly_setup_reopenings for select to authenticated
  using ((select public.is_active_user()));
create policy "Owners read Pre-Week Setup history" on public.pre_week_activity for select to authenticated
  using ((select public.is_owner()));

revoke all on public.trailers from anon, authenticated;
revoke all on public.inventory_items from anon, authenticated;
revoke all on public.weekly_setups from anon, authenticated;
revoke all on public.weekly_setup_items from anon, authenticated;
revoke all on public.weekly_setup_submissions from anon, authenticated;
revoke all on public.weekly_setup_reopenings from anon, authenticated;
revoke all on public.pre_week_activity from anon, authenticated;
grant select on public.trailers to authenticated;
grant select on public.inventory_items to authenticated;
grant select on public.weekly_setups to authenticated;
grant select on public.weekly_setup_items to authenticated;
grant select on public.weekly_setup_submissions to authenticated;
grant select on public.weekly_setup_reopenings to authenticated;
grant select on public.pre_week_activity to authenticated;

-- Setups and item entries with names (names only, active users only).
create view public.weekly_setup_overview
with (security_barrier = true)
as
select s.id, s.trailer_id, t.name as trailer_name, t.archived_at as trailer_archived_at, s.week_start, s.state,
       s.started_at, s.submitted_at, submitter.full_name as submitted_by_name, s.restock_notes,
       s.updated_at, updater.full_name as updated_by_name,
       count(i.*)::integer as item_count,
       count(i.*) filter (where i.status is not null)::integer as assessed_count,
       count(i.*) filter (where i.status = 'ready')::integer as ready_count,
       count(i.*) filter (where i.status = 'missing')::integer as missing_count,
       count(i.*) filter (where i.status = 'need_more')::integer as need_more_count
from public.weekly_setups s
join public.trailers t on t.id = s.trailer_id
left join public.profiles submitter on submitter.id = s.submitted_by
left join public.profiles updater on updater.id = s.updated_by
left join public.weekly_setup_items i on i.setup_id = s.id
where public.is_owner() or (public.is_active_user() and t.archived_at is null)
group by s.id, t.name, t.archived_at, submitter.full_name, updater.full_name;

create view public.weekly_setup_item_detail
with (security_barrier = true)
as
select i.id, i.setup_id, i.source_item_id, i.category, i.category_position, i.position, i.label, i.tracking,
       i.target_quantity, i.unit_label, i.usable_quantity, i.status, i.shortage, i.note,
       i.updated_at, p.full_name as updated_by_name
from public.weekly_setup_items i
join public.weekly_setups s on s.id = i.setup_id
join public.trailers t on t.id = s.trailer_id
left join public.profiles p on p.id = i.updated_by
where public.is_owner() or (public.is_active_user() and t.archived_at is null);

create view public.weekly_setup_submission_history
with (security_barrier = true)
as
select sub.id, sub.setup_id, sub.trailer_id, sub.week_start, sub.submitted_at, p.full_name as submitted_by_name,
       sub.ready_count, sub.missing_count, sub.need_more_count, sub.restock_notes, sub.items
from public.weekly_setup_submissions sub
left join public.profiles p on p.id = sub.submitted_by
where public.is_owner();

create view public.weekly_setup_reopening_history
with (security_barrier = true)
as
select r.id, r.setup_id, r.submission_id, r.reason, r.reopened_at, p.full_name as reopened_by_name
from public.weekly_setup_reopenings r
left join public.profiles p on p.id = r.reopened_by
where public.is_active_user();

revoke all on public.weekly_setup_overview from anon, authenticated;
revoke all on public.weekly_setup_item_detail from anon, authenticated;
revoke all on public.weekly_setup_submission_history from anon, authenticated;
revoke all on public.weekly_setup_reopening_history from anon, authenticated;
grant select on public.weekly_setup_overview to authenticated;
grant select on public.weekly_setup_item_detail to authenticated;
grant select on public.weekly_setup_submission_history to authenticated;
grant select on public.weekly_setup_reopening_history to authenticated;
