-- Phase 8: reopening, custom steps, the Custom Step Library, reference
-- pictures, and Owner/Working Member.
--
-- Custom steps: the owner adds a one-time step, or imports the current
-- version of a Custom Step Library item, at a chosen position in an employee
-- stage. The step becomes an ordinary job snapshot (kind 'standard'), so the
-- existing leases, answers, proof, completion, and unlocking rules apply.
-- Library items are versioned: editing adds a new version, and a job keeps
-- the copy it imported. Nothing that was used is ever deleted.
--
-- Reference pictures: owner-supplied guidance pictures in R2 under
-- reference/..., kept apart from employee proof. They are linked to standard
-- workflow steps, library items, or job steps. New jobs and imports copy the
-- links that are current at that moment, so later changes never alter an
-- existing job. They never count toward a proof requirement.
--
-- Owner/Working Member: an owner joins an active job's working team in a
-- separate table, never as the employee lead or a member, and can then work
-- steps exactly like an assigned employee. Without joining, the owner can
-- view employee work but not change it.
--
-- Reopening: the owner reopens a completed step with a required reason. The
-- completed attempt is marked superseded (nothing else about it changes, and
-- its answers and proof stay attached), and the step is redone as a new
-- attempt under the same rules. Job statuses never move backward; while a
-- step is reopened, later unfinished steps, the next installation milestone,
-- Completion Work, and Mark Job Complete wait for it.

-- 1. Types --------------------------------------------------------------------------------

alter type public.job_activity_type add value if not exists 'custom_step_added';
alter type public.job_activity_type add value if not exists 'custom_step_removed';
alter type public.job_activity_type add value if not exists 'step_reopened';
alter type public.job_activity_type add value if not exists 'reference_picture_added';
alter type public.job_activity_type add value if not exists 'reference_picture_archived';
alter type public.job_activity_type add value if not exists 'owner_joined_working_team';
alter type public.job_activity_type add value if not exists 'owner_left_working_team';

create type public.custom_step_origin as enum ('one_time', 'library_import');
create type public.reference_picture_status as enum ('pending', 'uploaded', 'failed');
create type public.reference_target as enum ('workflow_step', 'library_item', 'job_step');

-- 2. Step definitions (validation) ----------------------------------------------------------
--
-- A custom step is described as JSON:
--   { title, goal, instructions: [text], referenceLists: [{heading, items: [text]}],
--     checks: [{text, required}], inputs: [{label, type, required, unit, choices,
--     wholeNumber, minimum}], proof: {type, label, minCount, allowMultiple},
--     confirmationText }
-- The limits match the approved workflow's steps. Returns a plain-language
-- problem, or null when the definition is valid.

create function public.step_definition_problem(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_text text;
  v_proof jsonb;
  v_type text;
  v_count integer;
  v_labels text[] := '{}';
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return 'The step is missing.';
  end if;

  v_text := btrim(coalesce(p ->> 'title', ''));
  if v_text = '' or char_length(v_text) > 80 then
    return 'Give the step a name of up to 80 characters.';
  end if;
  if char_length(coalesce(p ->> 'goal', '')) > 500 then
    return 'Keep the goal to 500 characters or fewer.';
  end if;
  v_text := btrim(coalesce(p ->> 'confirmationText', ''));
  if v_text = '' or char_length(v_text) > 300 then
    return 'Add a confirmation statement of up to 300 characters.';
  end if;

  foreach v_text in array array['instructions', 'referenceLists', 'checks', 'inputs'] loop
    if p ? v_text and jsonb_typeof(p -> v_text) <> 'array' then
      return 'The step is malformed.';
    end if;
  end loop;

  -- Instructions
  if jsonb_array_length(coalesce(p -> 'instructions', '[]')) > 20 then
    return 'Use 20 instructions or fewer.';
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p -> 'instructions', '[]')) loop
    if jsonb_typeof(v_item) <> 'string' or btrim(v_item #>> '{}') = '' or char_length(v_item #>> '{}') > 300 then
      return 'Each instruction must be 1 to 300 characters.';
    end if;
  end loop;

  -- Reference-only lists
  if jsonb_array_length(coalesce(p -> 'referenceLists', '[]')) > 5 then
    return 'Use 5 reference lists or fewer.';
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p -> 'referenceLists', '[]')) loop
    if jsonb_typeof(v_item) <> 'object'
       or btrim(coalesce(v_item ->> 'heading', '')) = '' or char_length(v_item ->> 'heading') > 80
    then
      return 'Each reference list needs a heading of up to 80 characters.';
    end if;
    if jsonb_typeof(v_item -> 'items') is distinct from 'array'
       or jsonb_array_length(v_item -> 'items') not between 1 and 30
       or exists (
         select 1 from jsonb_array_elements(v_item -> 'items') e
         where jsonb_typeof(e.value) <> 'string' or btrim(e.value #>> '{}') = '' or char_length(e.value #>> '{}') > 200
       )
    then
      return 'Each reference list needs 1 to 30 items of up to 200 characters.';
    end if;
  end loop;

  -- Final check
  if jsonb_array_length(coalesce(p -> 'checks', '[]')) > 30 then
    return 'Use 30 Final check items or fewer.';
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p -> 'checks', '[]')) loop
    if jsonb_typeof(v_item) <> 'object'
       or btrim(coalesce(v_item ->> 'text', '')) = '' or char_length(v_item ->> 'text') > 300
       or jsonb_typeof(v_item -> 'required') is distinct from 'boolean'
    then
      return 'Each Final check item must be 1 to 300 characters.';
    end if;
  end loop;

  if jsonb_array_length(coalesce(p -> 'instructions', '[]')) = 0
     and jsonb_array_length(coalesce(p -> 'checks', '[]')) = 0
  then
    return 'Add at least one instruction or Final check item.';
  end if;

  -- Structured inputs
  if jsonb_array_length(coalesce(p -> 'inputs', '[]')) > 10 then
    return 'Use 10 entries or fewer.';
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p -> 'inputs', '[]')) loop
    v_text := btrim(coalesce(v_item ->> 'label', ''));
    if jsonb_typeof(v_item) <> 'object' or v_text = '' or char_length(v_text) > 80 then
      return 'Each entry needs a label of up to 80 characters.';
    end if;
    if lower(v_text) = any (v_labels) then
      return 'Each entry needs a different label.';
    end if;
    v_labels := v_labels || lower(v_text);
    v_type := v_item ->> 'type';
    if v_type is null or v_type not in ('text', 'number', 'single_select') then
      return 'Choose written text, number, or single-select for each entry.';
    end if;
    if jsonb_typeof(v_item -> 'required') is distinct from 'boolean' then
      return 'The step is malformed.';
    end if;
    if char_length(coalesce(v_item ->> 'unit', '')) > 20 then
      return 'Keep each unit to 20 characters or fewer.';
    end if;
    if v_type = 'single_select' then
      if jsonb_typeof(v_item -> 'choices') is distinct from 'array'
         or jsonb_array_length(v_item -> 'choices') not between 2 and 12
         or exists (
           select 1 from jsonb_array_elements(v_item -> 'choices') e
           where jsonb_typeof(e.value) <> 'string' or btrim(e.value #>> '{}') = '' or char_length(e.value #>> '{}') > 60
         )
         or (select count(distinct lower(btrim(e.value #>> '{}'))) from jsonb_array_elements(v_item -> 'choices') e)
            <> jsonb_array_length(v_item -> 'choices')
      then
        return 'A single-select entry needs 2 to 12 different choices of up to 60 characters.';
      end if;
    elsif v_item ? 'choices' and jsonb_typeof(v_item -> 'choices') not in ('null') then
      if jsonb_array_length(v_item -> 'choices') > 0 then
        return 'Only single-select entries have choices.';
      end if;
    end if;
    if v_type = 'number' then
      if v_item ? 'minimum' and jsonb_typeof(v_item -> 'minimum') not in ('null', 'number') then
        return 'The minimum must be a number.';
      end if;
    elsif jsonb_typeof(v_item -> 'minimum') = 'number' or (v_item ->> 'wholeNumber') = 'true' then
      return 'Only number entries have a minimum or whole-number rule.';
    end if;
  end loop;

  -- Proof
  v_proof := coalesce(p -> 'proof', '{"type": "none"}');
  v_type := v_proof ->> 'type';
  if v_type is null or v_type not in ('none', 'picture', 'video') then
    return 'Choose the required proof: none, picture, or video.';
  end if;
  if v_type <> 'none' then
    v_text := btrim(coalesce(v_proof ->> 'label', ''));
    if v_text = '' or char_length(v_text) > 160 then
      return 'Describe the required proof in up to 160 characters.';
    end if;
    if jsonb_typeof(v_proof -> 'minCount') is distinct from 'number' then
      return 'The step is malformed.';
    end if;
    v_count := (v_proof ->> 'minCount')::numeric;
    if v_type = 'video' and (v_count <> 1 or (v_proof ->> 'allowMultiple') = 'true') then
      return 'A video proof is one video.';
    end if;
    if v_type = 'picture' then
      if v_count not between 1 and 20 then
        return 'Require 1 to 20 pictures.';
      end if;
      if v_count > 1 and (v_proof ->> 'allowMultiple') is distinct from 'true' then
        return 'Allow more than one picture when requiring more than one.';
      end if;
    end if;
  end if;
  return null;
end;
$$;

-- 3. Job step snapshots can gain custom steps -----------------------------------------------

alter table public.job_steps
  add column custom_origin public.custom_step_origin,
  add column source_library_version_id uuid,
  add column added_by uuid references public.profiles (id),
  add column added_at timestamptz;

alter table public.job_steps
  add constraint job_steps_custom_origin_check
  check ((custom_origin is not null) = is_custom and (added_by is null) = (added_at is null));

-- Snapshots stay immutable. The only exceptions happen inside the owner
-- functions below, which switch on a transaction-local setting: shifting
-- positions to make room for a new step (steps nobody has started), and
-- removing an unstarted custom step from a job that hasn't been claimed.
create function public.snapshot_edit_allowed()
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce(current_setting('armour.snapshot_edit', true), '') = 'on' $$;

create function public.guard_job_step_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.snapshot_edit_allowed() then
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'position') = (to_jsonb(old) - 'position') then
      return new;
    end if;
    if tg_op = 'DELETE' and old.is_custom
       and not exists (select 1 from public.step_attempts where job_step_id = old.id)
    then
      return old;
    end if;
  end if;
  raise exception '% rows cannot be % because they are part of job history.',
    tg_table_name, lower(tg_op) || 'd'
    using errcode = 'P0001';
end;
$$;

create function public.guard_job_snapshot_child()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and public.snapshot_edit_allowed() then
    return old;
  end if;
  raise exception '% rows cannot be % because they are part of job history.',
    tg_table_name, lower(tg_op) || 'd'
    using errcode = 'P0001';
end;
$$;

drop trigger job_steps_immutable on public.job_steps;
drop trigger job_step_blocks_immutable on public.job_step_blocks;
drop trigger job_step_block_items_immutable on public.job_step_block_items;
drop trigger job_step_inputs_immutable on public.job_step_inputs;
drop trigger job_step_proof_requirements_immutable on public.job_step_proof_requirements;

create trigger job_steps_immutable
  before update or delete on public.job_steps
  for each row execute function public.guard_job_step_snapshot();
create trigger job_step_blocks_immutable
  before update or delete on public.job_step_blocks
  for each row execute function public.guard_job_snapshot_child();
create trigger job_step_block_items_immutable
  before update or delete on public.job_step_block_items
  for each row execute function public.guard_job_snapshot_child();
create trigger job_step_inputs_immutable
  before update or delete on public.job_step_inputs
  for each row execute function public.guard_job_snapshot_child();
create trigger job_step_proof_requirements_immutable
  before update or delete on public.job_step_proof_requirements
  for each row execute function public.guard_job_snapshot_child();

create trigger job_steps_job_not_complete
  before insert on public.job_steps
  for each row execute function public.reject_if_job_complete();

-- 4. Custom Step Library (owner only) -----------------------------------------------------

create table public.step_library_items (
  id uuid primary key default gen_random_uuid(),
  current_version integer not null default 1 check (current_version >= 1),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles (id),
  check ((archived_at is null) = (archived_by is null))
);

create table public.step_library_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.step_library_items (id),
  version_number integer not null check (version_number >= 1),
  title text not null,
  definition jsonb not null check (public.step_definition_problem(definition) is null),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (item_id, version_number)
);

comment on table public.step_library_versions is
  'Each saved version of a library step. Never changed or deleted; jobs keep the version they imported.';

alter table public.job_steps
  add constraint job_steps_source_library_version_fkey
  foreign key (source_library_version_id) references public.step_library_versions (id);

create trigger step_library_versions_immutable
  before update or delete on public.step_library_versions
  for each row execute function public.prevent_history_change();

-- Items are never deleted. Only the current version moves forward, and an
-- item is archived once.
create function public.guard_step_library_item()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Library steps are never deleted. Archive it instead.' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.current_version < old.current_version
     or (old.archived_at is not null and (
       new.archived_at is distinct from old.archived_at or new.current_version <> old.current_version
     ))
  then
    raise exception 'That change to a library step isn''t allowed.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger step_library_items_guard
  before update or delete on public.step_library_items
  for each row execute function public.guard_step_library_item();

-- 5. Reference pictures -----------------------------------------------------------------------

create table public.reference_pictures (
  id uuid primary key default gen_random_uuid(),
  object_key text not null unique check (object_key ~ '^reference/[0-9a-f-]{36}-[0-9a-f]{32}\.jpg$'),
  content_type text not null default 'image/jpeg' check (content_type = 'image/jpeg'),
  declared_size_bytes bigint not null check (declared_size_bytes between 1 and 5242880),
  size_bytes bigint check (size_bytes is null or size_bytes = declared_size_bytes),
  original_file_name text check (char_length(original_file_name) <= 255),
  status public.reference_picture_status not null default 'pending',
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  authorization_expires_at timestamptz not null default now() + interval '1 hour',
  uploaded_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  check ((status = 'uploaded') = (uploaded_at is not null and size_bytes is not null))
);

comment on table public.reference_pictures is
  'Owner-supplied guidance pictures in R2 (reference/...). Never employee proof.';

create function public.guard_reference_picture()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Reference pictures are kept with job history and cannot be deleted.' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id
     or new.object_key is distinct from old.object_key
     or new.content_type is distinct from old.content_type
     or new.declared_size_bytes is distinct from old.declared_size_bytes
     or new.uploaded_by is distinct from old.uploaded_by
     or new.created_at is distinct from old.created_at
     or old.status <> 'pending'
  then
    raise exception 'That change to a reference picture isn''t allowed.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger reference_pictures_guard
  before update or delete on public.reference_pictures
  for each row execute function public.guard_reference_picture();

-- Where a picture is shown. Links on standard steps and library items are
-- the reusable sets; links on job steps belong to one job (copied when the
-- job was created or the step imported, or added for that job).
create table public.reference_picture_links (
  id uuid primary key default gen_random_uuid(),
  picture_id uuid not null references public.reference_pictures (id),
  target public.reference_target not null,
  workflow_step_id uuid references public.workflow_step_templates (id),
  library_item_id uuid references public.step_library_items (id),
  job_id uuid,
  job_step_id uuid,
  position integer not null check (position >= 1),
  source_link_id uuid references public.reference_picture_links (id),
  added_by uuid not null references public.profiles (id),
  added_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles (id),
  foreign key (job_step_id, job_id) references public.job_steps (id, job_id),
  check ((archived_at is null) = (archived_by is null)),
  check (
    (target = 'workflow_step' and workflow_step_id is not null and library_item_id is null and job_step_id is null and job_id is null)
    or (target = 'library_item' and library_item_id is not null and workflow_step_id is null and job_step_id is null and job_id is null)
    or (target = 'job_step' and job_step_id is not null and job_id is not null and workflow_step_id is null and library_item_id is null)
  )
);

create index reference_picture_links_workflow_idx on public.reference_picture_links (workflow_step_id) where workflow_step_id is not null;
create index reference_picture_links_library_idx on public.reference_picture_links (library_item_id) where library_item_id is not null;
create index reference_picture_links_job_step_idx on public.reference_picture_links (job_step_id) where job_step_id is not null;

-- Links are never deleted (except with an unstarted custom step removed from
-- an unclaimed job). Only the position of a current link, or archiving it
-- once, can change.
create function public.guard_reference_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.snapshot_edit_allowed() then
      return old;
    end if;
    raise exception 'Reference picture links are part of history and cannot be deleted.' using errcode = 'P0001';
  end if;
  if old.archived_at is not null
     or (to_jsonb(new) - 'position' - 'archived_at' - 'archived_by')
        <> (to_jsonb(old) - 'position' - 'archived_at' - 'archived_by')
  then
    raise exception 'That change to a reference picture isn''t allowed.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger reference_picture_links_guard
  before update or delete on public.reference_picture_links
  for each row execute function public.guard_reference_link();

create trigger reference_picture_links_job_not_complete
  before insert or update on public.reference_picture_links
  for each row
  when (new.job_id is not null)
  execute function public.reject_if_job_complete();

-- New jobs copy the current reference pictures of each standard step.
create function public.copy_workflow_reference_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_step_template_id is not null then
    insert into public.reference_picture_links (
      picture_id, target, job_id, job_step_id, position, source_link_id, added_by, added_at
    )
    select l.picture_id, 'job_step', new.job_id, new.id,
           row_number() over (order by l.position, l.added_at), l.id, l.added_by, now()
    from public.reference_picture_links l
    where l.target = 'workflow_step' and l.workflow_step_id = new.source_step_template_id
      and l.archived_at is null;
  end if;
  return new;
end;
$$;

create trigger job_steps_copy_reference_links
  after insert on public.job_steps
  for each row execute function public.copy_workflow_reference_links();

-- 6. Owner/Working Member ----------------------------------------------------------------------

create table public.job_working_owners (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  owner_id uuid not null references public.profiles (id),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  check (left_at is null or left_at >= joined_at)
);

comment on table public.job_working_owners is
  'Owners working on a job alongside its employee team. Separate from the employee lead and members. Rows end once and are never deleted.';

create unique index job_working_owners_one_active
  on public.job_working_owners (job_id, owner_id)
  where left_at is null;

create function public.guard_job_working_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Working-team history cannot be deleted.' using errcode = 'P0001';
  end if;
  if old.left_at is not null or (to_jsonb(new) - 'left_at') <> (to_jsonb(old) - 'left_at') then
    raise exception 'A working-team membership can only be ended, once.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger job_working_owners_guard
  before update or delete on public.job_working_owners
  for each row execute function public.guard_job_working_owner();

create trigger job_working_owners_job_not_complete
  before insert or update on public.job_working_owners
  for each row execute function public.reject_if_job_complete();

-- Whether someone may work this job's steps: an active employee on the team,
-- or an active owner who joined its working team.
create function public.is_job_worker(p_job uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.job_assignments a
    join public.profiles p on p.id = a.employee_id and p.active and p.role = 'employee'
    where a.job_id = p_job and a.employee_id = p_user and a.ended_at is null
  ) or exists (
    select 1 from public.job_working_owners w
    join public.profiles p on p.id = w.owner_id and p.active and p.role = 'owner'
    where w.job_id = p_job and w.owner_id = p_user and w.left_at is null
  );
$$;

-- Step work (leases, answers, uploads, Complete Step, Completion Work) is
-- open to active employees and active owners; each function then requires
-- the caller to be on the job's working team (is_job_worker). Claiming and
-- joining as an employee stay employee-only (below).
create or replace function public.require_active_employee()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not exists (
    select 1 from public.profiles
    where id = v_user and active and role in ('employee', 'owner')
  ) then
    raise exception 'Only an active employee can do this.' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

create function public.require_employee_role(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = p_user and active and role = 'employee') then
    raise exception 'Only an active employee can do this. Owners join a job as a Working Owner instead.'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.claim_job(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid := public.require_active_employee();
  v_status public.job_status;
begin
  perform public.require_employee_role(v_employee);
  select status into v_status from public.jobs where id = p_job for update;
  if v_status is null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'available_to_claim' then
    if public.is_active_job_status(v_status) then
      raise exception 'Someone else claimed this job first.' using errcode = 'P0001';
    end if;
    raise exception 'This job isn''t available to claim.' using errcode = 'P0001';
  end if;

  update public.jobs
  set status = 'claimed', last_activity_at = now()
  where id = p_job;

  perform public.start_job_assignment(p_job, v_employee, 'lead', 'claimed', v_employee);

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (p_job, v_employee, 'claimed', jsonb_build_object('employee_id', v_employee));
end;
$$;

create or replace function public.join_job(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid := public.require_active_employee();
  v_job public.jobs;
begin
  perform public.require_employee_role(v_employee);
  select * into v_job from public.jobs where id = p_job for update;
  if v_job.id is null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if v_job.status = 'available_to_claim' then
    raise exception 'This job hasn''t been claimed yet. Claim it instead.' using errcode = 'P0001';
  end if;
  if not public.is_active_job_status(v_job.status) then
    raise exception 'You can only join a job that is in progress.' using errcode = 'P0001';
  end if;
  if not v_job.allow_employees_to_join then
    raise exception 'The owner has turned off joining for this job. Ask the owner to add you.'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.job_assignments
    where job_id = p_job and role = 'lead' and ended_at is null
  ) then
    raise exception 'This job has no lead right now. Ask the owner to add you.'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.job_assignments
    where job_id = p_job and employee_id = v_employee and ended_at is null
  ) then
    raise exception 'You''re already on this job.' using errcode = 'P0001';
  end if;

  perform public.start_job_assignment(p_job, v_employee, 'member', 'joined', v_employee);
  update public.jobs set last_activity_at = now() where id = p_job;

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (p_job, v_employee, 'employee_joined', jsonb_build_object('employee_id', v_employee));
end;
$$;

-- The holder of a step's edit lease, if it is current and they are still on
-- the job's working team. Otherwise null.
create or replace function public.current_step_hold(p_step uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.held_by
  from public.step_edit_holds h
  where h.job_step_id = p_step and h.expires_at > now()
    and public.is_job_worker(h.job_id, h.held_by);
$$;

create or replace function public.require_step_worker(p_step uuid, p_user uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job uuid;
  v_kind public.workflow_step_kind;
  v_state text;
begin
  select job_id, kind into v_job, v_kind from public.job_steps where id = p_step;
  if v_job is null then
    raise exception 'Step not found.' using errcode = 'P0002';
  end if;
  if not public.is_job_worker(v_job, p_user) then
    if exists (select 1 from public.profiles where id = p_user and role = 'owner') then
      raise exception 'Only people working on this job can change its steps. Join the job as a Working Owner first.'
        using errcode = '42501';
    end if;
    raise exception 'Only employees on this job''s team can work its steps.' using errcode = '42501';
  end if;
  if v_kind = 'completion_item' then
    raise exception 'Completion Work items are marked complete with their own button.' using errcode = 'P0001';
  end if;

  v_state := public.job_step_state(p_step);
  if v_state = 'completed' then
    raise exception 'This step is already complete.' using errcode = 'P0001';
  end if;
  if v_state not in ('available', 'in_progress') then
    raise exception 'This step isn''t open yet. Finish the earlier steps first.' using errcode = 'P0001';
  end if;
  return v_job;
end;
$$;

create or replace function public.require_media_worker(p_step uuid, p_actor uuid, p_lease uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job uuid;
begin
  if not exists (
    select 1 from public.profiles where id = p_actor and active and role in ('employee', 'owner')
  ) then
    raise exception 'Only an active employee can do this.' using errcode = '42501';
  end if;
  v_job := public.require_step_worker(p_step, p_actor);
  perform public.require_step_lease(p_step, p_actor, p_lease);
  return v_job;
end;
$$;

-- An active owner joins an in-progress job's working team. The employee
-- lead and members are unchanged.
create function public.join_job_as_working_owner(p_job uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_job public.jobs;
begin
  select * into v_job from public.jobs where id = p_job for update;
  if v_job.id is null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if not public.is_active_job_status(v_job.status) then
    raise exception 'You can join only a job that is in progress (claimed and not complete).' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.job_working_owners where job_id = p_job and owner_id = v_owner and left_at is null) then
    return 'already_joined';
  end if;

  insert into public.job_working_owners (job_id, owner_id) values (p_job, v_owner);
  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (p_job, v_owner, 'owner_joined_working_team', jsonb_build_object('owner_id', v_owner));
  update public.jobs set last_activity_at = now() where id = p_job;
  return 'joined';
end;
$$;

create function public.leave_working_team(p_job uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_status public.job_status;
begin
  select status into v_status from public.jobs where id = p_job for update;
  if v_status is null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.job_working_owners where job_id = p_job and owner_id = v_owner and left_at is null) then
    return 'not_joined';
  end if;
  if exists (
    select 1 from public.step_edit_holds
    where job_id = p_job and held_by = v_owner and expires_at > now()
  ) then
    raise exception 'You''re editing a step on this job. Leave that step first, then leave the working team.'
      using errcode = 'P0001';
  end if;

  update public.job_working_owners set left_at = now()
  where job_id = p_job and owner_id = v_owner and left_at is null;
  delete from public.step_edit_holds where job_id = p_job and held_by = v_owner;
  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (p_job, v_owner, 'owner_left_working_team', jsonb_build_object('owner_id', v_owner));
  update public.jobs set last_activity_at = now() where id = p_job;
  return 'left';
end;
$$;

-- 7. Which steps are open, and what blocks the owner (reopened steps) ------------------------

create or replace function public.job_step_state(p_step uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_step record;
  v_status public.job_status;
begin
  select s.id, s.job_id, s.job_stage_id, s.kind, s.position, s.applies_when,
         st.position as stage_position, st.kind as stage_kind,
         j.status as job_status, j.caulking_required, j.baseboard_required
  into v_step
  from public.job_steps s
  join public.job_stages st on st.id = s.job_stage_id
  join public.jobs j on j.id = s.job_id
  where s.id = p_step;
  if v_step.id is null then
    return null;
  end if;

  if exists (
    select 1 from public.step_attempts
    where job_step_id = p_step and status = 'completed'
  ) then
    return 'completed';
  end if;

  v_status := v_step.job_status;

  if v_step.kind = 'completion_item' then
    if not public.completion_item_applies(v_step.applies_when, v_step.caulking_required, v_step.baseboard_required) then
      return 'not_applicable';
    end if;
    if v_status not in ('top_coat_installed', 'completion_work_in_progress') then
      return 'locked';
    end if;
    -- A reopened preparation step must be completed again first.
    if exists (
      select 1 from public.job_steps s2
      where s2.job_id = v_step.job_id and s2.kind = 'standard'
        and not exists (
          select 1 from public.step_attempts a
          where a.job_step_id = s2.id and a.status = 'completed'
        )
    ) then
      return 'locked';
    end if;
    if exists (
      select 1
      from public.job_steps s2
      where s2.job_stage_id = v_step.job_stage_id
        and s2.kind = 'completion_item'
        and s2.position < v_step.position
        and public.completion_item_applies(s2.applies_when, v_step.caulking_required, v_step.baseboard_required)
        and not exists (
          select 1 from public.step_attempts a
          where a.job_step_id = s2.id and a.status = 'completed'
        )
    ) then
      return 'locked';
    end if;
    return 'available';
  end if;

  if v_step.kind <> 'standard' or v_step.stage_kind <> 'employee_stage' then
    return 'locked';
  end if;

  if not public.is_active_job_status(v_status) then
    return 'locked';
  end if;

  -- Every earlier stage must be done.
  if exists (
    select 1
    from public.job_stages st
    where st.job_id = v_step.job_id and st.position < v_step.stage_position
      and (
        (st.kind = 'owner_milestone' and not public.milestone_installed(v_status, st.key))
        or (
          st.kind = 'employee_stage' and exists (
            select 1 from public.job_steps s2
            where s2.job_stage_id = st.id and s2.kind = 'standard'
              and not exists (
                select 1 from public.step_attempts a
                where a.job_step_id = s2.id and a.status = 'completed'
              )
          )
        )
      )
  ) then
    return 'locked';
  end if;

  -- Every earlier step in this stage must be completed.
  if exists (
    select 1
    from public.job_steps s2
    join public.job_stages st on st.id = s2.job_stage_id
    where st.job_id = v_step.job_id and st.position = v_step.stage_position
      and s2.position < v_step.position and s2.kind = 'standard'
      and not exists (
        select 1 from public.step_attempts a
        where a.job_step_id = s2.id and a.status = 'completed'
      )
  ) then
    return 'locked';
  end if;

  if exists (
    select 1 from public.step_attempts where job_step_id = p_step and status = 'draft'
  ) then
    return 'in_progress';
  end if;
  return 'available';
end;
$$;

-- Same as Phase 7, plus: every preparation step before the milestone must be
-- complete (a reopened step blocks it).
create or replace function public.mark_milestone_installed(p_job uuid, p_milestone text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_job public.jobs;
  v_stage public.job_stages;
  v_waiting public.job_status;
  v_installed public.job_status;
  v_missing text;
begin
  if p_milestone = 'base_coat_installation' then
    v_waiting := 'waiting_for_base_coat_installation';
    v_installed := 'base_coat_installed';
  elsif p_milestone = 'top_coat_installation' then
    v_waiting := 'waiting_for_top_coat_installation';
    v_installed := 'top_coat_installed';
  else
    raise exception 'Unknown installation milestone.' using errcode = 'P0001';
  end if;

  select * into v_job from public.jobs where id = p_job for update;
  if v_job.id is null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.job_milestones where job_id = p_job and milestone_key = p_milestone) then
    return 'already_installed';
  end if;

  if v_job.status <> v_waiting then
    if p_milestone = 'base_coat_installation' then
      raise exception 'Base Coat Installed can be marked only while the job is Waiting for Base-Coat Installation.'
        using errcode = 'P0001';
    end if;
    raise exception 'Top Coat Installed can be marked only while the job is Waiting for Top-Coat Installation.'
      using errcode = 'P0001';
  end if;

  select * into v_stage
  from public.job_stages
  where job_id = p_job and key = p_milestone and kind = 'owner_milestone';
  if v_stage.id is null then
    raise exception 'This job''s workflow has no such installation milestone.' using errcode = 'P0001';
  end if;

  select s.title into v_missing
  from public.job_steps s
  join public.job_stages st on st.id = s.job_stage_id
  where s.job_id = p_job and s.kind = 'standard' and st.position < v_stage.position
    and not exists (
      select 1 from public.step_attempts a
      where a.job_step_id = s.id and a.status = 'completed'
    )
  order by st.position, s.position
  limit 1;
  if v_missing is not null then
    raise exception 'A reopened step must be completed again first: %', v_missing using errcode = 'P0001';
  end if;

  insert into public.job_milestones (job_id, job_stage_id, milestone_key, installed_by)
  values (p_job, v_stage.id, p_milestone, v_owner);

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (
    p_job, v_owner, 'milestone_installed',
    jsonb_build_object('milestone', p_milestone, 'stage_name', v_stage.name,
                       'label', v_stage.completed_status_label)
  );

  perform public.set_job_status(p_job, v_installed, v_owner);
  return 'installed';
end;
$$;

-- Same as Phase 7, open to joined working owners, and explains a reopened
-- preparation step.
create or replace function public.complete_completion_item(p_step uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_active_employee();
  v_step public.job_steps;
  v_job public.jobs;
  v_state text;
begin
  select * into v_step from public.job_steps where id = p_step;
  if v_step.id is null or v_step.kind <> 'completion_item' then
    raise exception 'Completion Work item not found.' using errcode = 'P0002';
  end if;

  select * into v_job from public.jobs where id = v_step.job_id for update;

  if not public.is_job_worker(v_job.id, v_user) then
    if exists (select 1 from public.profiles where id = v_user and role = 'owner') then
      raise exception 'Only people working on this job can mark Completion Work. Join the job as a Working Owner first.'
        using errcode = '42501';
    end if;
    raise exception 'Only employees on this job''s team can mark Completion Work.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.step_attempts where job_step_id = p_step and status = 'completed'
  ) then
    return 'already_completed';
  end if;

  v_state := public.job_step_state(p_step);
  if v_state = 'not_applicable' then
    raise exception 'This Completion Work item doesn''t apply to this job.' using errcode = 'P0001';
  end if;
  if v_state <> 'available' then
    if v_job.status not in ('top_coat_installed', 'completion_work_in_progress') then
      raise exception 'Completion Work opens after the top coat is installed.' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.job_steps s2
      where s2.job_id = v_job.id and s2.kind = 'standard'
        and not exists (
          select 1 from public.step_attempts a where a.job_step_id = s2.id and a.status = 'completed'
        )
    ) then
      raise exception 'A reopened step must be completed again first.' using errcode = 'P0001';
    end if;
    raise exception 'Finish the earlier Completion Work item first.' using errcode = 'P0001';
  end if;

  insert into public.step_attempts (
    job_id, job_step_id, attempt_number, status, started_by, completed_by, completed_at
  )
  values (
    v_job.id, p_step,
    coalesce((select max(attempt_number) from public.step_attempts where job_step_id = p_step), 0) + 1,
    'completed', v_user, v_user, now()
  );

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (
    v_job.id, v_user, 'step_completed',
    jsonb_build_object('step_id', p_step, 'title', v_step.title, 'completion_item', true)
  );

  if v_job.status = 'top_coat_installed' then
    perform public.set_job_status(v_job.id, 'completion_work_in_progress', v_user);
  else
    update public.jobs set last_activity_at = now() where id = v_job.id;
  end if;
  return 'completed';
end;
$$;

-- 8. Reopening ---------------------------------------------------------------------------------

create table public.step_reopenings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  job_step_id uuid not null,
  previous_attempt_id uuid not null,
  reason text not null check (btrim(reason) <> '' and char_length(reason) <= 500),
  reopened_by uuid not null references public.profiles (id),
  reopened_at timestamptz not null default now(),
  foreign key (job_step_id, job_id) references public.job_steps (id, job_id),
  foreign key (previous_attempt_id, job_step_id) references public.step_attempts (id, job_step_id)
);

create trigger step_reopenings_append_only
  before update or delete on public.step_reopenings
  for each row execute function public.prevent_history_change();

-- Reopens a completed step. The completed attempt becomes superseded with
-- everything else about it (answers, proof, names, times) unchanged; the
-- next edit lease starts a new attempt.
create function public.reopen_step(p_step uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_step public.job_steps;
  v_job public.jobs;
  v_attempt uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  if v_reason = '' then
    raise exception 'Give a reason for reopening this step.' using errcode = 'P0001';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Keep the reason to 500 characters or fewer.' using errcode = 'P0001';
  end if;

  select * into v_step from public.job_steps where id = p_step;
  if v_step.id is null then
    raise exception 'Step not found.' using errcode = 'P0002';
  end if;
  select * into v_job from public.jobs where id = v_step.job_id for update;
  if v_job.status = 'complete' then
    raise exception 'A complete job is read only, so its steps can''t be reopened.' using errcode = 'P0001';
  end if;

  select id into v_attempt
  from public.step_attempts
  where job_step_id = p_step and status = 'completed'
  for update;
  if v_attempt is null then
    raise exception 'Only a completed step can be reopened.' using errcode = 'P0001';
  end if;

  update public.step_attempts set status = 'superseded' where id = v_attempt;

  insert into public.step_reopenings (job_id, job_step_id, previous_attempt_id, reason, reopened_by)
  values (v_job.id, p_step, v_attempt, v_reason, v_owner)
  returning id into v_id;

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (
    v_job.id, v_owner, 'step_reopened',
    jsonb_build_object('step_id', p_step, 'title', v_step.title, 'reason', v_reason,
                       'previous_attempt_id', v_attempt)
  );
  update public.jobs set last_activity_at = now() where id = v_job.id;
  return v_id;
end;
$$;

-- 9. Adding and removing custom steps ----------------------------------------------------------

-- Where a new step may go, for each employee stage of a job. On a job that
-- hasn't been claimed, anywhere. On an active job, only in a preparation
-- stage the job hasn't finished (its installation isn't waiting or done),
-- and only before steps nobody has started. Never on a Complete job, and
-- never in an installation milestone or Completion Work.
create function public.custom_step_positions(p_job uuid)
returns table (stage_id uuid, stage_name text, first_position integer, last_position integer)
language sql
stable
security definer
set search_path = ''
as $$
  select st.id, st.name,
         coalesce((
           select max(s.position) from public.job_steps s
           where s.job_stage_id = st.id
             and exists (select 1 from public.step_attempts a where a.job_step_id = s.id)
         ), 0) + 1,
         coalesce((select max(s.position) from public.job_steps s where s.job_stage_id = st.id), 0) + 1
  from public.job_stages st
  join public.jobs j on j.id = st.job_id
  where st.job_id = p_job and st.kind = 'employee_stage'
    and j.status <> 'complete'
    and not exists (
      select 1 from public.job_stages ms
      where ms.job_id = j.id and ms.kind = 'owner_milestone' and ms.position > st.position
        and (
          public.milestone_installed(j.status, ms.key)
          or (ms.key = 'base_coat_installation' and j.status = 'waiting_for_base_coat_installation')
          or (ms.key = 'top_coat_installation' and j.status = 'waiting_for_top_coat_installation')
        )
    )
  order by st.position;
$$;

-- Inserts a validated definition as a job step snapshot at a checked
-- position, moving later (unstarted) steps down. Internal.
create function public.insert_custom_step(
  p_job uuid,
  p_stage uuid,
  p_position integer,
  p_definition jsonb,
  p_origin public.custom_step_origin,
  p_library_version uuid,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text := public.step_definition_problem(p_definition);
  v_range record;
  v_step uuid;
  v_block uuid;
  v_block_position integer := 0;
  v_item jsonb;
  v_n integer;
  v_proof jsonb := coalesce(p_definition -> 'proof', '{"type": "none"}');
  v_title text := btrim(p_definition ->> 'title');
  v_stage_name text;
begin
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'P0001';
  end if;

  perform 1 from public.jobs where id = p_job for update;
  select * into v_range from public.custom_step_positions(p_job) where stage_id = p_stage;
  if v_range.stage_id is null then
    if exists (select 1 from public.jobs where id = p_job and status = 'complete') then
      raise exception 'A complete job is read only.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.job_stages where id = p_stage and job_id = p_job and kind <> 'employee_stage') then
      raise exception 'Custom steps can''t be added to installation milestones or Completion Work.' using errcode = 'P0001';
    end if;
    raise exception 'This stage is already finished, so steps can''t be added to it.' using errcode = 'P0001';
  end if;
  if p_position is null or p_position < v_range.first_position or p_position > v_range.last_position then
    raise exception 'Choose a position between % and % in this stage. Steps can''t go before work that has started.',
      v_range.first_position, v_range.last_position using errcode = 'P0001';
  end if;
  v_stage_name := v_range.stage_name;

  -- Make room: later steps (all unstarted) move down one.
  perform set_config('armour.snapshot_edit', 'on', true);
  update public.job_steps set position = position + 100000
  where job_stage_id = p_stage and position >= p_position;
  update public.job_steps set position = position - 99999
  where job_stage_id = p_stage and position >= 100000 + p_position;
  perform set_config('armour.snapshot_edit', 'off', true);

  insert into public.job_steps (
    job_id, job_stage_id, source_step_template_id, is_custom, position, key, title, kind, note,
    goal, reference_image_key, proof_type, proof_text, confirmation_text, applies_when,
    custom_origin, source_library_version_id, added_by, added_at
  )
  values (
    p_job, p_stage, null, true, p_position, 'custom_' || replace(gen_random_uuid()::text, '-', ''),
    v_title, 'standard', null, nullif(btrim(coalesce(p_definition ->> 'goal', '')), ''), null,
    (v_proof ->> 'type')::public.proof_type,
    case when v_proof ->> 'type' = 'none' then null else btrim(v_proof ->> 'label') end,
    btrim(p_definition ->> 'confirmationText'), null,
    p_origin, p_library_version, p_actor, now()
  )
  returning id into v_step;

  if jsonb_array_length(coalesce(p_definition -> 'instructions', '[]')) > 0 then
    v_block_position := v_block_position + 1;
    insert into public.job_step_blocks (job_id, job_step_id, position, heading, kind)
    values (p_job, v_step, v_block_position, 'Instructions', 'ordered_list')
    returning id into v_block;
    insert into public.job_step_block_items (job_id, job_block_id, block_kind, position, text, required)
    select p_job, v_block, 'ordered_list', e.ordinality, btrim(e.value #>> '{}'), false
    from jsonb_array_elements(p_definition -> 'instructions') with ordinality e;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_definition -> 'referenceLists', '[]')) loop
    v_block_position := v_block_position + 1;
    insert into public.job_step_blocks (job_id, job_step_id, position, heading, kind)
    values (p_job, v_step, v_block_position, btrim(v_item ->> 'heading'), 'reference_list')
    returning id into v_block;
    insert into public.job_step_block_items (job_id, job_block_id, block_kind, position, text, required)
    select p_job, v_block, 'reference_list', e.ordinality, btrim(e.value #>> '{}'), false
    from jsonb_array_elements(v_item -> 'items') with ordinality e;
  end loop;

  if jsonb_array_length(coalesce(p_definition -> 'checks', '[]')) > 0 then
    v_block_position := v_block_position + 1;
    insert into public.job_step_blocks (job_id, job_step_id, position, heading, kind)
    values (p_job, v_step, v_block_position, 'Final check', 'checklist')
    returning id into v_block;
    insert into public.job_step_block_items (job_id, job_block_id, block_kind, position, text, required)
    select p_job, v_block, 'checklist', e.ordinality, btrim(e.value ->> 'text'), (e.value ->> 'required')::boolean
    from jsonb_array_elements(p_definition -> 'checks') with ordinality e;
  end if;

  v_n := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_definition -> 'inputs', '[]')) loop
    v_n := v_n + 1;
    insert into public.job_step_inputs (
      job_id, job_step_id, position, key, label, input_type, required, unit, choices, whole_number, minimum
    )
    values (
      p_job, v_step, v_n, 'input_' || v_n, btrim(v_item ->> 'label'),
      (v_item ->> 'type')::public.structured_input_type,
      (v_item ->> 'required')::boolean,
      nullif(btrim(coalesce(v_item ->> 'unit', '')), ''),
      case when v_item ->> 'type' = 'single_select'
        then array(select btrim(c.value #>> '{}') from jsonb_array_elements(v_item -> 'choices') with ordinality c order by c.ordinality)
      end,
      v_item ->> 'type' = 'number' and coalesce((v_item ->> 'wholeNumber')::boolean, false),
      case when v_item ->> 'type' = 'number' and jsonb_typeof(v_item -> 'minimum') = 'number'
        then (v_item ->> 'minimum')::numeric end
    );
  end loop;

  if v_proof ->> 'type' <> 'none' then
    insert into public.job_step_proof_requirements (
      job_id, job_step_id, position, label, media_type, min_count, allow_multiple
    )
    values (
      p_job, v_step, 1, btrim(v_proof ->> 'label'),
      (v_proof ->> 'type')::public.proof_media_type,
      (v_proof ->> 'minCount')::integer,
      v_proof ->> 'type' = 'picture' and coalesce((v_proof ->> 'allowMultiple')::boolean, false)
    );
  end if;

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (
    p_job, p_actor, 'custom_step_added',
    jsonb_build_object('step_id', v_step, 'title', v_title, 'stage_name', v_stage_name,
                       'position', p_position, 'origin', p_origin,
                       'library_version_id', p_library_version)
  );
  update public.jobs set last_activity_at = now() where id = p_job;
  return v_step;
end;
$$;

-- A one-time custom step, optionally also saved to the library as a new item.
create function public.add_custom_step(
  p_job uuid,
  p_stage uuid,
  p_position integer,
  p_definition jsonb,
  p_save_to_library boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_version uuid;
  v_item uuid;
begin
  if coalesce(p_save_to_library, false) then
    v_item := public.create_library_item(p_definition);
    select v.id into v_version
    from public.step_library_versions v
    where v.item_id = v_item and v.version_number = 1;
  end if;
  return public.insert_custom_step(p_job, p_stage, p_position, p_definition, 'one_time', v_version, v_owner);
end;
$$;

-- Imports the current version of a library item as a job-specific copy,
-- with the item's current reference pictures.
create function public.import_library_step(p_job uuid, p_stage uuid, p_position integer, p_item uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_item public.step_library_items;
  v_version public.step_library_versions;
  v_step uuid;
begin
  select * into v_item from public.step_library_items where id = p_item;
  if v_item.id is null then
    raise exception 'Library step not found.' using errcode = 'P0002';
  end if;
  if v_item.archived_at is not null then
    raise exception 'This library step is archived and can''t be imported into new work.' using errcode = 'P0001';
  end if;
  select * into v_version from public.step_library_versions
  where item_id = p_item and version_number = v_item.current_version;

  v_step := public.insert_custom_step(p_job, p_stage, p_position, v_version.definition, 'library_import', v_version.id, v_owner);

  insert into public.reference_picture_links (
    picture_id, target, job_id, job_step_id, position, source_link_id, added_by, added_at
  )
  select l.picture_id, 'job_step', p_job, v_step,
         row_number() over (order by l.position, l.added_at), l.id, v_owner, now()
  from public.reference_picture_links l
  where l.target = 'library_item' and l.library_item_id = p_item and l.archived_at is null;
  return v_step;
end;
$$;

-- Removes a custom step that nobody could have started: only on a job that
-- hasn't been claimed. Later steps move up. History records the removal.
create function public.remove_custom_step(p_step uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_step public.job_steps;
  v_status public.job_status;
begin
  select * into v_step from public.job_steps where id = p_step;
  if v_step.id is null then
    raise exception 'Step not found.' using errcode = 'P0002';
  end if;
  select status into v_status from public.jobs where id = v_step.job_id for update;
  if not v_step.is_custom then
    raise exception 'Only custom steps can be removed.' using errcode = 'P0001';
  end if;
  if v_status not in ('scheduled', 'available_to_claim') then
    raise exception 'Custom steps can be removed only before the job is claimed.' using errcode = 'P0001';
  end if;

  perform set_config('armour.snapshot_edit', 'on', true);
  delete from public.reference_picture_links where job_step_id = p_step;
  delete from public.job_step_block_items i using public.job_step_blocks b
  where i.job_block_id = b.id and b.job_step_id = p_step;
  delete from public.job_step_blocks where job_step_id = p_step;
  delete from public.job_step_inputs where job_step_id = p_step;
  delete from public.job_step_proof_requirements where job_step_id = p_step;
  delete from public.job_steps where id = p_step;
  update public.job_steps set position = position + 100000
  where job_stage_id = v_step.job_stage_id and position > v_step.position;
  update public.job_steps set position = position - 100001
  where job_stage_id = v_step.job_stage_id and position > 100000 + v_step.position;
  perform set_config('armour.snapshot_edit', 'off', true);

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (v_step.job_id, v_owner, 'custom_step_removed',
          jsonb_build_object('step_id', p_step, 'title', v_step.title));
  update public.jobs set last_activity_at = now() where id = v_step.job_id;
end;
$$;

-- 10. Library management (owner only) ---------------------------------------------------------

create function public.create_library_item(p_definition jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_problem text := public.step_definition_problem(p_definition);
  v_item uuid;
begin
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'P0001';
  end if;
  insert into public.step_library_items (created_by) values (v_owner) returning id into v_item;
  insert into public.step_library_versions (item_id, version_number, title, definition, created_by)
  values (v_item, 1, btrim(p_definition ->> 'title'), p_definition, v_owner);
  return v_item;
end;
$$;

-- Saves a new version for future imports. Jobs keep the version they
-- imported. Returns the current version number.
create function public.update_library_item(p_item uuid, p_definition jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_problem text := public.step_definition_problem(p_definition);
  v_item public.step_library_items;
  v_current jsonb;
begin
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'P0001';
  end if;
  select * into v_item from public.step_library_items where id = p_item for update;
  if v_item.id is null then
    raise exception 'Library step not found.' using errcode = 'P0002';
  end if;
  if v_item.archived_at is not null then
    raise exception 'Archived library steps can''t be edited.' using errcode = 'P0001';
  end if;
  select definition into v_current from public.step_library_versions
  where item_id = p_item and version_number = v_item.current_version;
  if v_current = p_definition then
    return v_item.current_version;
  end if;

  insert into public.step_library_versions (item_id, version_number, title, definition, created_by)
  values (p_item, v_item.current_version + 1, btrim(p_definition ->> 'title'), p_definition, v_owner);
  update public.step_library_items set current_version = v_item.current_version + 1 where id = p_item;
  return v_item.current_version + 1;
end;
$$;

create function public.archive_library_item(p_item uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_item public.step_library_items;
begin
  select * into v_item from public.step_library_items where id = p_item for update;
  if v_item.id is null then
    raise exception 'Library step not found.' using errcode = 'P0002';
  end if;
  if v_item.archived_at is not null then
    return 'already_archived';
  end if;
  update public.step_library_items set archived_at = now(), archived_by = v_owner where id = p_item;
  return 'archived';
end;
$$;

-- 11. Reference picture uploads and links -----------------------------------------------------

-- Approves one reference picture upload (a JPEG of at most 5 MB, already
-- prepared on the phone). The server then signs an R2 link for exactly this
-- key. Owner only.
create function public.create_reference_upload(p_size bigint, p_file_name text)
returns table (picture_id uuid, object_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_id uuid := gen_random_uuid();
  v_key text;
begin
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'Reference pictures can be up to 5 MB after preparing.' using errcode = 'P0001';
  end if;
  v_key := 'reference/' || v_id || '-' || replace(gen_random_uuid()::text, '-', '') || '.jpg';
  insert into public.reference_pictures (id, object_key, declared_size_bytes, original_file_name, uploaded_by)
  values (v_id, v_key, p_size, left(nullif(btrim(coalesce(p_file_name, '')), ''), 255), v_owner);
  return query select v_id, v_key;
end;
$$;

-- Server only (secret key): records what R2 holds for a pending reference
-- picture. Accepts it only when the key, size, and type match and the actor
-- started it.
create function public.confirm_reference_upload(
  p_picture uuid,
  p_actor uuid,
  p_object_key text,
  p_stored_size bigint,
  p_stored_content_type text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_picture public.reference_pictures;
  v_reason text;
begin
  select * into v_picture from public.reference_pictures where id = p_picture for update;
  if v_picture.id is null then
    raise exception 'That picture wasn''t found.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_actor and active and role = 'owner')
     or v_picture.uploaded_by <> p_actor
  then
    raise exception 'Only the owner who started this upload can finish it.' using errcode = '42501';
  end if;
  if v_picture.status = 'uploaded' then
    return 'uploaded';
  end if;
  if v_picture.status <> 'pending' or v_picture.authorization_expires_at <= now() then
    raise exception 'This upload''s authorization expired. Add the picture again.' using errcode = 'P0001';
  end if;

  if p_object_key is distinct from v_picture.object_key then
    v_reason := 'The uploaded file doesn''t match this picture.';
  elsif p_stored_size is distinct from v_picture.declared_size_bytes then
    v_reason := 'The uploaded file''s size doesn''t match.';
  elsif lower(split_part(coalesce(p_stored_content_type, ''), ';', 1)) <> 'image/jpeg' then
    v_reason := 'The uploaded file isn''t a JPEG picture.';
  end if;
  if v_reason is not null then
    update public.reference_pictures
    set status = 'failed', failed_at = now(), failure_reason = v_reason
    where id = p_picture;
    return v_reason;
  end if;

  update public.reference_pictures
  set status = 'uploaded', size_bytes = p_stored_size, uploaded_at = now()
  where id = p_picture;
  return 'uploaded';
end;
$$;

-- Shows an uploaded picture on a standard step (future jobs), a library item
-- (future imports), or one job step that isn't finished.
create function public.attach_reference_picture(p_picture uuid, p_target public.reference_target, p_target_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_job uuid;
  v_title text;
  v_link uuid;
  v_position integer;
begin
  if not exists (select 1 from public.reference_pictures where id = p_picture and status = 'uploaded') then
    raise exception 'Finish uploading the picture first.' using errcode = 'P0001';
  end if;

  if p_target = 'workflow_step' then
    if not exists (
      select 1 from public.workflow_step_templates s
      join public.workflow_stage_templates st on st.id = s.stage_id
      join public.workflow_templates t on t.id = st.template_id
      where s.id = p_target_id and t.status = 'active'
    ) then
      raise exception 'Reference pictures can be added only to steps of the active workflow.' using errcode = 'P0001';
    end if;
    select coalesce(max(position), 0) + 1 into v_position from public.reference_picture_links
    where workflow_step_id = p_target_id and archived_at is null;
    insert into public.reference_picture_links (picture_id, target, workflow_step_id, position, added_by)
    values (p_picture, 'workflow_step', p_target_id, v_position, v_owner)
    returning id into v_link;
  elsif p_target = 'library_item' then
    if not exists (select 1 from public.step_library_items where id = p_target_id and archived_at is null) then
      raise exception 'Reference pictures can be added only to library steps that aren''t archived.' using errcode = 'P0001';
    end if;
    select coalesce(max(position), 0) + 1 into v_position from public.reference_picture_links
    where library_item_id = p_target_id and archived_at is null;
    insert into public.reference_picture_links (picture_id, target, library_item_id, position, added_by)
    values (p_picture, 'library_item', p_target_id, v_position, v_owner)
    returning id into v_link;
  else
    select s.job_id, s.title into v_job, v_title from public.job_steps s where s.id = p_target_id;
    if v_job is null then
      raise exception 'Step not found.' using errcode = 'P0002';
    end if;
    perform 1 from public.jobs where id = v_job for update;
    if exists (select 1 from public.jobs where id = v_job and status = 'complete') then
      raise exception 'A complete job is read only.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.step_attempts where job_step_id = p_target_id and status = 'completed') then
      raise exception 'This step is complete. Reference pictures can be added only to unfinished steps.' using errcode = 'P0001';
    end if;
    select coalesce(max(position), 0) + 1 into v_position from public.reference_picture_links
    where job_step_id = p_target_id and archived_at is null;
    insert into public.reference_picture_links (picture_id, target, job_id, job_step_id, position, added_by)
    values (p_picture, 'job_step', v_job, p_target_id, v_position, v_owner)
    returning id into v_link;
    insert into public.job_activity (job_id, actor_id, activity_type, details)
    values (v_job, v_owner, 'reference_picture_added',
            jsonb_build_object('step_id', p_target_id, 'title', v_title, 'picture_id', p_picture));
  end if;
  return v_link;
end;
$$;

-- Whether a link can still change: reusable sets always (while their target
-- is current); a job's links only while the step is unfinished and the job
-- isn't complete.
create function public.require_editable_reference_link(p_link uuid)
returns public.reference_picture_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.reference_picture_links;
begin
  select * into v_link from public.reference_picture_links where id = p_link for update;
  if v_link.id is null then
    raise exception 'That picture wasn''t found.' using errcode = 'P0002';
  end if;
  if v_link.archived_at is not null then
    raise exception 'That picture was already removed.' using errcode = 'P0001';
  end if;
  if v_link.target = 'job_step' then
    if exists (select 1 from public.jobs where id = v_link.job_id and status = 'complete') then
      raise exception 'A complete job is read only.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.step_attempts where job_step_id = v_link.job_step_id and status = 'completed') then
      raise exception 'This step is complete, so its reference pictures stay as they were.' using errcode = 'P0001';
    end if;
  end if;
  return v_link;
end;
$$;

create function public.archive_reference_link(p_link uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_link public.reference_picture_links := public.require_editable_reference_link(p_link);
  v_title text;
begin
  update public.reference_picture_links set archived_at = now(), archived_by = v_owner where id = p_link;
  if v_link.target = 'job_step' then
    select title into v_title from public.job_steps where id = v_link.job_step_id;
    insert into public.job_activity (job_id, actor_id, activity_type, details)
    values (v_link.job_id, v_owner, 'reference_picture_archived',
            jsonb_build_object('step_id', v_link.job_step_id, 'title', v_title, 'picture_id', v_link.picture_id));
  end if;
end;
$$;

-- Moves a picture one place earlier (-1) or later (+1) among the current
-- pictures of the same step or library item.
create function public.move_reference_link(p_link uuid, p_direction integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_link public.reference_picture_links := public.require_editable_reference_link(p_link);
  v_other public.reference_picture_links;
begin
  if p_direction not in (-1, 1) then
    raise exception 'Move up or down one place.' using errcode = 'P0001';
  end if;
  select * into v_other from public.reference_picture_links l
  where l.archived_at is null and l.id <> v_link.id
    and l.target = v_link.target
    and l.workflow_step_id is not distinct from v_link.workflow_step_id
    and l.library_item_id is not distinct from v_link.library_item_id
    and l.job_step_id is not distinct from v_link.job_step_id
    and (case when p_direction < 0 then l.position < v_link.position else l.position > v_link.position end)
  order by case when p_direction < 0 then -l.position else l.position end
  limit 1
  for update;
  if v_other.id is null then
    return;
  end if;
  update public.reference_picture_links set position = v_other.position where id = v_link.id;
  update public.reference_picture_links set position = v_link.position where id = v_other.id;
  perform v_owner;
end;
$$;

-- Server only: may this user view this reference picture? Owners always;
-- employees when it is shown on a standard step or on a job step of a job
-- they work on. Library pictures are owner only until imported.
create function public.authorize_reference_view(p_picture uuid, p_actor uuid)
returns table (object_key text, content_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.object_key, r.content_type
  from public.reference_pictures r
  join public.profiles p on p.id = p_actor and p.active
  where r.id = p_picture and r.status = 'uploaded'
    and (
      p.role = 'owner'
      or exists (
        select 1 from public.reference_picture_links l
        where l.picture_id = r.id
          and (
            (l.target = 'workflow_step' and l.archived_at is null)
            or (l.target = 'job_step' and public.is_job_worker(l.job_id, p_actor))
          )
      )
    );
$$;

-- Job-only reference pictures whose jobs passed their five-year retention
-- date, and which no standard step or library item still uses. For the
-- future scheduled cleanup; nothing is deleted in this phase.
create function public.reference_pictures_due_for_retention_cleanup()
returns table (picture_id uuid, object_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.object_key
  from public.reference_pictures r
  where r.status = 'uploaded'
    and exists (select 1 from public.reference_picture_links l where l.picture_id = r.id)
    and not exists (
      select 1 from public.reference_picture_links l
      left join public.jobs j on j.id = l.job_id
      where l.picture_id = r.id
        and (l.target <> 'job_step' or j.media_delete_after is null or j.media_delete_after > now())
    );
$$;

-- 12. Progress (reopened steps come first) -----------------------------------------------------

create or replace view public.job_progress
with (security_invoker = true)
as
select
  j.id as job_id,
  (
    (select count(*) from public.job_steps s where s.job_id = j.id and s.kind = 'standard')
    + (select count(*) from public.job_stages st where st.job_id = j.id and st.kind = 'owner_milestone')
    + (
      select count(*) from public.job_steps s
      where s.job_id = j.id and s.kind = 'completion_item'
        and public.completion_item_applies(s.applies_when, j.caulking_required, j.baseboard_required)
    )
  )::integer as total_units,
  (
    (
      select count(*) from public.job_steps s
      where s.job_id = j.id
        and (
          s.kind = 'standard'
          or public.completion_item_applies(s.applies_when, j.caulking_required, j.baseboard_required)
        )
        and exists (
          select 1 from public.step_attempts a
          where a.job_step_id = s.id and a.status = 'completed'
        )
    )
    + (
      select count(*) from public.job_stages st
      where st.job_id = j.id and st.kind = 'owner_milestone'
        and public.milestone_installed(j.status, st.key)
    )
  )::integer as completed_units,
  case
    when j.status = 'complete' then null
    else coalesce(
      reopened.stage_name,
      waiting.name,
      current_step.stage_name,
      current_item.stage_name,
      case when j.status in ('top_coat_installed', 'completion_work_in_progress') then completion_stage.name end
    )
  end as current_stage_name,
  case
    when j.status = 'complete' then null
    else coalesce(
      reopened.title,
      waiting.waiting_status_label,
      current_step.title,
      current_item.title,
      case when j.status in ('top_coat_installed', 'completion_work_in_progress') then 'Ready for owner review' end
    )
  end as current_step_title,
  (
    j.status in ('top_coat_installed', 'completion_work_in_progress')
    and current_item.title is null
    and current_step.title is null
  ) as ready_for_owner_completion,
  case when j.status = 'complete' then null else reopened.title end as reopened_step_title
from public.jobs j
left join lateral (
  select st.name as stage_name, s.title
  from public.job_steps s
  join public.job_stages st on st.id = s.job_stage_id
  where s.job_id = j.id
    and exists (select 1 from public.step_attempts a where a.job_step_id = s.id and a.status = 'superseded')
    and not exists (select 1 from public.step_attempts a where a.job_step_id = s.id and a.status = 'completed')
  order by st.position, s.position
  limit 1
) reopened on true
left join lateral (
  select st.name, st.waiting_status_label
  from public.job_stages st
  where st.job_id = j.id and st.kind = 'owner_milestone'
    and (
      (st.key = 'base_coat_installation' and j.status = 'waiting_for_base_coat_installation')
      or (st.key = 'top_coat_installation' and j.status = 'waiting_for_top_coat_installation')
    )
  limit 1
) waiting on true
left join lateral (
  select st.name as stage_name, s.title
  from public.job_steps s
  join public.job_stages st on st.id = s.job_stage_id
  where s.job_id = j.id and s.kind = 'standard'
    and not exists (
      select 1 from public.step_attempts a
      where a.job_step_id = s.id and a.status = 'completed'
    )
  order by st.position, s.position
  limit 1
) current_step on true
left join lateral (
  select st.name as stage_name, s.title
  from public.job_steps s
  join public.job_stages st on st.id = s.job_stage_id
  where s.job_id = j.id and s.kind = 'completion_item'
    and j.status in ('top_coat_installed', 'completion_work_in_progress')
    and public.completion_item_applies(s.applies_when, j.caulking_required, j.baseboard_required)
    and not exists (
      select 1 from public.step_attempts a
      where a.job_step_id = s.id and a.status = 'completed'
    )
  order by st.position, s.position
  limit 1
) current_item on true
left join lateral (
  select st.name
  from public.job_stages st
  where st.job_id = j.id and st.kind = 'completion_work'
  order by st.position
  limit 1
) completion_stage on true;

-- 13. Permissions -------------------------------------------------------------------------------

revoke execute on function public.step_definition_problem(jsonb) from public, anon;
revoke execute on function public.snapshot_edit_allowed() from public, anon, authenticated;
revoke execute on function public.guard_job_step_snapshot() from public, anon, authenticated;
revoke execute on function public.guard_job_snapshot_child() from public, anon, authenticated;
revoke execute on function public.guard_step_library_item() from public, anon, authenticated;
revoke execute on function public.guard_reference_picture() from public, anon, authenticated;
revoke execute on function public.guard_reference_link() from public, anon, authenticated;
revoke execute on function public.copy_workflow_reference_links() from public, anon, authenticated;
revoke execute on function public.guard_job_working_owner() from public, anon, authenticated;
revoke execute on function public.is_job_worker(uuid, uuid) from public, anon;
revoke execute on function public.require_employee_role(uuid) from public, anon, authenticated;
revoke execute on function public.insert_custom_step(uuid, uuid, integer, jsonb, public.custom_step_origin, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.require_editable_reference_link(uuid) from public, anon, authenticated;
revoke execute on function public.join_job_as_working_owner(uuid) from public, anon;
revoke execute on function public.leave_working_team(uuid) from public, anon;
revoke execute on function public.reopen_step(uuid, text) from public, anon;
revoke execute on function public.custom_step_positions(uuid) from public, anon;
revoke execute on function public.add_custom_step(uuid, uuid, integer, jsonb, boolean) from public, anon;
revoke execute on function public.import_library_step(uuid, uuid, integer, uuid) from public, anon;
revoke execute on function public.remove_custom_step(uuid) from public, anon;
revoke execute on function public.create_library_item(jsonb) from public, anon;
revoke execute on function public.update_library_item(uuid, jsonb) from public, anon;
revoke execute on function public.archive_library_item(uuid) from public, anon;
revoke execute on function public.create_reference_upload(bigint, text) from public, anon;
revoke execute on function public.confirm_reference_upload(uuid, uuid, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.attach_reference_picture(uuid, public.reference_target, uuid) from public, anon;
revoke execute on function public.archive_reference_link(uuid) from public, anon;
revoke execute on function public.move_reference_link(uuid, integer) from public, anon;
revoke execute on function public.authorize_reference_view(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reference_pictures_due_for_retention_cleanup() from public, anon, authenticated;

grant execute on function public.step_definition_problem(jsonb) to authenticated;
grant execute on function public.is_job_worker(uuid, uuid) to authenticated;
grant execute on function public.join_job_as_working_owner(uuid) to authenticated;
grant execute on function public.leave_working_team(uuid) to authenticated;
grant execute on function public.reopen_step(uuid, text) to authenticated;
grant execute on function public.custom_step_positions(uuid) to authenticated;
grant execute on function public.add_custom_step(uuid, uuid, integer, jsonb, boolean) to authenticated;
grant execute on function public.import_library_step(uuid, uuid, integer, uuid) to authenticated;
grant execute on function public.remove_custom_step(uuid) to authenticated;
grant execute on function public.create_library_item(jsonb) to authenticated;
grant execute on function public.update_library_item(uuid, jsonb) to authenticated;
grant execute on function public.archive_library_item(uuid) to authenticated;
grant execute on function public.create_reference_upload(bigint, text) to authenticated;
grant execute on function public.attach_reference_picture(uuid, public.reference_target, uuid) to authenticated;
grant execute on function public.archive_reference_link(uuid) to authenticated;
grant execute on function public.move_reference_link(uuid, integer) to authenticated;
grant execute on function public.confirm_reference_upload(uuid, uuid, text, bigint, text) to service_role;
grant execute on function public.authorize_reference_view(uuid, uuid) to service_role;
grant execute on function public.reference_pictures_due_for_retention_cleanup() to service_role;

-- 14. Read access -------------------------------------------------------------------------------

alter table public.step_library_items enable row level security;
alter table public.step_library_versions enable row level security;
alter table public.reference_pictures enable row level security;
alter table public.reference_picture_links enable row level security;
alter table public.job_working_owners enable row level security;
alter table public.step_reopenings enable row level security;

-- The library is owner only.
create policy "Owners read library steps" on public.step_library_items
  for select to authenticated using ((select public.is_owner()));
create policy "Owners read library versions" on public.step_library_versions
  for select to authenticated using ((select public.is_owner()));
create policy "Owners read reference pictures" on public.reference_pictures
  for select to authenticated using ((select public.is_owner()));

-- Reference picture links on standard and job steps are visible to active
-- users (the pictures themselves still need the viewing check); library
-- links are owner only.
create policy "Active users read step reference links" on public.reference_picture_links
  for select to authenticated using (
    (select public.is_owner())
    or ((select public.is_active_user()) and target <> 'library_item')
  );
create policy "Active users read working owners" on public.job_working_owners
  for select to authenticated using ((select public.is_active_user()));
create policy "Active users read reopenings" on public.step_reopenings
  for select to authenticated using ((select public.is_active_user()));

revoke all on public.step_library_items from anon, authenticated;
revoke all on public.step_library_versions from anon, authenticated;
revoke all on public.reference_pictures from anon, authenticated;
revoke all on public.reference_picture_links from anon, authenticated;
revoke all on public.job_working_owners from anon, authenticated;
revoke all on public.step_reopenings from anon, authenticated;
grant select on public.step_library_items to authenticated;
grant select on public.step_library_versions to authenticated;
-- Object keys are never readable by signed-in users.
grant select (
  id, content_type, declared_size_bytes, size_bytes, original_file_name, status, uploaded_by,
  created_at, uploaded_at, failed_at, failure_reason
) on public.reference_pictures to authenticated;
grant select on public.reference_picture_links to authenticated;
grant select on public.job_working_owners to authenticated;
grant select on public.step_reopenings to authenticated;

-- Working owners and reopenings with names, for job and step pages (names
-- only, active users only).
create view public.job_working_owner_status
with (security_barrier = true)
as
select w.job_id, w.owner_id, p.full_name, w.joined_at
from public.job_working_owners w
join public.profiles p on p.id = w.owner_id
where w.left_at is null and public.is_active_user();

create view public.step_reopening_status
with (security_barrier = true)
as
select r.id, r.job_id, r.job_step_id, r.previous_attempt_id, r.reason, r.reopened_by,
       p.full_name as reopened_by_name, r.reopened_at
from public.step_reopenings r
left join public.profiles p on p.id = r.reopened_by
where public.is_active_user();

-- Every attempt of a step with names, for the attempt history.
create view public.step_attempt_history
with (security_barrier = true)
as
select a.id, a.job_id, a.job_step_id, a.attempt_number, a.status, a.started_by,
       started.full_name as started_by_name, a.started_at, a.completed_by,
       completed.full_name as completed_by_name, a.completed_at, a.employee_notes,
       a.confirmation_text_shown
from public.step_attempts a
left join public.profiles started on started.id = a.started_by
left join public.profiles completed on completed.id = a.completed_by
where public.is_active_user();

revoke all on public.job_working_owner_status from anon, authenticated;
revoke all on public.step_reopening_status from anon, authenticated;
revoke all on public.step_attempt_history from anon, authenticated;
grant select on public.job_working_owner_status to authenticated;
grant select on public.step_reopening_status to authenticated;
grant select on public.step_attempt_history to authenticated;
