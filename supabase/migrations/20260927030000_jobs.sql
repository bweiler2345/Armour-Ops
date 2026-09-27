-- Phase 3: jobs, per-job workflow snapshots, and job history.
--
-- create_job() inserts a job and copies the active workflow version into
-- job-owned snapshot tables in one transaction, recording the version and
-- content fingerprint it came from. Later workflow versions never change an
-- existing job. Jobs are never deleted, snapshot rows never change, and job
-- history is append-only. All writes go through owner-only functions; signed-in
-- users can only read.
--
-- Future phases add the job team, step attempts, proof, and reopening on top
-- of these tables (see docs/IMPLEMENTATION_PLAN.md).

-- 1. Types --------------------------------------------------------------------

create type public.job_status as enum (
  'scheduled',
  'available_to_claim',
  'claimed',
  'initial_prep_in_progress',
  'waiting_for_base_coat_installation',
  'base_coat_installed',
  'top_coat_prep_in_progress',
  'waiting_for_top_coat_installation',
  'top_coat_installed',
  'completion_work_in_progress',
  'complete'
);

-- Later phases add values with ALTER TYPE ... ADD VALUE.
create type public.job_activity_type as enum (
  'job_created',
  'job_details_edited',
  'made_available',
  'returned_to_scheduled'
);

-- 2. Jobs ---------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_number integer generated always as identity (start with 1001) unique,
  client_name text not null
    check (client_name = btrim(client_name) and char_length(client_name) between 1 and 120),
  address text not null
    check (address = btrim(address) and char_length(address) between 1 and 200),
  square_feet integer not null check (square_feet between 1 and 100000),
  flake_color text not null
    check (flake_color = btrim(flake_color) and char_length(flake_color) between 1 and 80),
  scheduled_date date not null
    check (scheduled_date between date '2020-01-01' and date '2100-12-31'),
  general_notes text not null default '' check (char_length(general_notes) <= 2000),
  caulking_required boolean not null default true,
  baseboard_required boolean not null default false,
  allow_employees_to_join boolean not null default true,
  status public.job_status not null default 'scheduled',
  workflow_template_id uuid not null references public.workflow_templates (id),
  workflow_key text not null,
  workflow_version integer not null,
  workflow_content_sha256 text not null check (workflow_content_sha256 ~ '^[0-9a-f]{64}$'),
  made_available_at timestamptz,
  last_activity_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references public.profiles (id),
  media_delete_after timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.jobs is
  'Flooring jobs. Created only by create_job(), which also snapshots the active workflow. Never deleted.';

create index jobs_status_idx on public.jobs (status, scheduled_date);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- 3. Per-job workflow snapshot ------------------------------------------------
--
-- Same shape as the workflow_* template tables, keyed to the job, with a link
-- back to the template row each was copied from. Custom steps (Phase 8) will
-- have no source row.

create table public.job_stages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  source_stage_template_id uuid references public.workflow_stage_templates (id),
  position integer not null check (position >= 1),
  key text not null,
  name text not null,
  kind public.workflow_stage_kind not null,
  description text,
  rules_heading text,
  rules text[] not null default '{}',
  owner_action_label text,
  waiting_status_label text,
  completed_status_label text,
  unique (job_id, position),
  unique (job_id, key),
  unique (id, job_id)
);

create table public.job_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  job_stage_id uuid not null,
  source_step_template_id uuid references public.workflow_step_templates (id),
  is_custom boolean not null default false,
  position integer not null check (position >= 1),
  key text not null,
  title text not null,
  kind public.workflow_step_kind not null,
  note text,
  goal text,
  reference_image_key text,
  proof_type public.proof_type not null,
  proof_text text,
  confirmation_text text,
  applies_when public.job_option,
  foreign key (job_stage_id, job_id) references public.job_stages (id, job_id),
  unique (job_stage_id, position),
  unique (id, job_id),
  check (is_custom or source_step_template_id is not null)
);

create table public.job_step_blocks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  job_step_id uuid not null,
  source_block_id uuid references public.workflow_step_blocks (id),
  position integer not null check (position >= 1),
  heading text not null,
  kind public.workflow_block_kind not null,
  foreign key (job_step_id, job_id) references public.job_steps (id, job_id),
  unique (job_step_id, position),
  unique (id, job_id),
  unique (id, kind)
);

create table public.job_step_block_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  job_block_id uuid not null,
  block_kind public.workflow_block_kind not null,
  source_item_id uuid references public.workflow_step_block_items (id),
  position integer not null check (position >= 1),
  text text not null,
  required boolean not null,
  foreign key (job_block_id, job_id) references public.job_step_blocks (id, job_id),
  foreign key (job_block_id, block_kind) references public.job_step_blocks (id, kind),
  unique (job_block_id, position),
  check (block_kind = 'checklist' or not required)
);

create table public.job_step_inputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  job_step_id uuid not null,
  source_input_id uuid references public.workflow_step_inputs (id),
  position integer not null check (position >= 1),
  key text not null,
  label text not null,
  input_type public.structured_input_type not null,
  required boolean not null,
  unit text,
  choices text[],
  whole_number boolean not null default false,
  minimum numeric,
  foreign key (job_step_id, job_id) references public.job_steps (id, job_id),
  unique (job_step_id, position),
  unique (job_step_id, key)
);

create table public.job_step_proof_requirements (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  job_step_id uuid not null,
  source_requirement_id uuid references public.workflow_step_proof_requirements (id),
  position integer not null check (position >= 1),
  label text not null,
  media_type public.proof_media_type not null,
  min_count integer not null check (min_count >= 1),
  allow_multiple boolean not null,
  foreign key (job_step_id, job_id) references public.job_steps (id, job_id),
  unique (job_step_id, position)
);

create index job_stages_job_idx on public.job_stages (job_id);
create index job_steps_job_idx on public.job_steps (job_id);
create index job_step_blocks_job_idx on public.job_step_blocks (job_id);
create index job_step_block_items_job_idx on public.job_step_block_items (job_id);
create index job_step_inputs_job_idx on public.job_step_inputs (job_id);
create index job_step_proof_requirements_job_idx on public.job_step_proof_requirements (job_id);

-- 4. Job history (append-only) --------------------------------------------------

create table public.job_activity (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs (id),
  actor_id uuid references public.profiles (id),
  activity_type public.job_activity_type not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index job_activity_job_idx on public.job_activity (job_id, created_at desc, id desc);

-- 5. Protect history ------------------------------------------------------------

create function public.prevent_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows cannot be % because they are part of job history.',
    tg_table_name, lower(tg_op) || 'd'
    using errcode = 'P0001';
end;
$$;

create trigger jobs_never_deleted
  before delete on public.jobs
  for each row execute function public.prevent_history_change();

create trigger job_activity_append_only
  before update or delete on public.job_activity
  for each row execute function public.prevent_history_change();

-- Snapshots never change in Phase 3. Owner step editing (Phase 8) will add
-- controlled functions for this.
create trigger job_stages_immutable
  before update or delete on public.job_stages
  for each row execute function public.prevent_history_change();
create trigger job_steps_immutable
  before update or delete on public.job_steps
  for each row execute function public.prevent_history_change();
create trigger job_step_blocks_immutable
  before update or delete on public.job_step_blocks
  for each row execute function public.prevent_history_change();
create trigger job_step_block_items_immutable
  before update or delete on public.job_step_block_items
  for each row execute function public.prevent_history_change();
create trigger job_step_inputs_immutable
  before update or delete on public.job_step_inputs
  for each row execute function public.prevent_history_change();
create trigger job_step_proof_requirements_immutable
  before update or delete on public.job_step_proof_requirements
  for each row execute function public.prevent_history_change();

-- The workflow a job was created from never changes.
create function public.guard_job_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workflow_template_id is distinct from old.workflow_template_id
     or new.workflow_key is distinct from old.workflow_key
     or new.workflow_version is distinct from old.workflow_version
     or new.workflow_content_sha256 is distinct from old.workflow_content_sha256
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.job_number is distinct from old.job_number
  then
    raise exception 'A job''s workflow version and creation record cannot change.'
      using errcode = 'P0001';
  end if;

  -- Approved status changes only (docs/IMPLEMENTATION_PLAN.md,
  -- "How jobs move between statuses").
  if new.status is distinct from old.status and not (
    (old.status, new.status) in (
      ('scheduled', 'available_to_claim'),
      ('available_to_claim', 'scheduled'),
      ('available_to_claim', 'claimed'),
      ('claimed', 'initial_prep_in_progress'),
      ('initial_prep_in_progress', 'waiting_for_base_coat_installation'),
      ('waiting_for_base_coat_installation', 'base_coat_installed'),
      ('base_coat_installed', 'top_coat_prep_in_progress'),
      ('top_coat_prep_in_progress', 'waiting_for_top_coat_installation'),
      ('waiting_for_top_coat_installation', 'top_coat_installed'),
      ('top_coat_installed', 'completion_work_in_progress'),
      ('top_coat_installed', 'complete'),
      ('completion_work_in_progress', 'complete')
    )
  ) then
    raise exception 'A job cannot move from % to %.', old.status, new.status
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger jobs_guard
  before update on public.jobs
  for each row execute function public.guard_job_row();

-- New jobs always start Scheduled.
create function public.guard_job_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'scheduled' then
    raise exception 'New jobs must start as Scheduled.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger jobs_start_scheduled
  before insert on public.jobs
  for each row execute function public.guard_job_insert();

-- 6. Owner-only job functions -----------------------------------------------------

create function public.require_owner()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Only an active owner can do this.' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;

-- Creates a Scheduled job and snapshots the active workflow, atomically.
create function public.create_job(
  p_client_name text,
  p_address text,
  p_square_feet integer,
  p_flake_color text,
  p_scheduled_date date,
  p_general_notes text default '',
  p_caulking_required boolean default true,
  p_baseboard_required boolean default false,
  p_allow_employees_to_join boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_template public.workflow_templates;
  v_job uuid;
  v_stage record;
  v_step record;
  v_block record;
  v_job_stage uuid;
  v_job_step uuid;
  v_job_block uuid;
begin
  select * into v_template
  from public.workflow_templates
  where key = 'armour-floors-standard' and status = 'active';

  if v_template.id is null then
    raise exception 'No active approved workflow is loaded. Load the workflow before creating jobs.'
      using errcode = 'P0002';
  end if;
  perform public.validate_workflow_template(v_template.id);

  insert into public.jobs (
    client_name, address, square_feet, flake_color, scheduled_date, general_notes,
    caulking_required, baseboard_required, allow_employees_to_join,
    workflow_template_id, workflow_key, workflow_version, workflow_content_sha256,
    created_by
  )
  values (
    btrim(p_client_name), btrim(p_address), p_square_feet, btrim(p_flake_color), p_scheduled_date,
    coalesce(btrim(p_general_notes), ''),
    coalesce(p_caulking_required, true), coalesce(p_baseboard_required, false),
    coalesce(p_allow_employees_to_join, true),
    v_template.id, v_template.key, v_template.version, v_template.content_sha256,
    v_owner
  )
  returning id into v_job;

  for v_stage in
    select * from public.workflow_stage_templates
    where template_id = v_template.id order by position
  loop
    insert into public.job_stages (
      job_id, source_stage_template_id, position, key, name, kind, description,
      rules_heading, rules, owner_action_label, waiting_status_label, completed_status_label
    )
    values (
      v_job, v_stage.id, v_stage.position, v_stage.key, v_stage.name, v_stage.kind,
      v_stage.description, v_stage.rules_heading, v_stage.rules, v_stage.owner_action_label,
      v_stage.waiting_status_label, v_stage.completed_status_label
    )
    returning id into v_job_stage;

    for v_step in
      select * from public.workflow_step_templates
      where stage_id = v_stage.id order by position
    loop
      insert into public.job_steps (
        job_id, job_stage_id, source_step_template_id, position, key, title, kind, note,
        goal, reference_image_key, proof_type, proof_text, confirmation_text, applies_when
      )
      values (
        v_job, v_job_stage, v_step.id, v_step.position, v_step.key, v_step.title, v_step.kind,
        v_step.note, v_step.goal, v_step.reference_image_key, v_step.proof_type,
        v_step.proof_text, v_step.confirmation_text, v_step.applies_when
      )
      returning id into v_job_step;

      for v_block in
        select * from public.workflow_step_blocks where step_id = v_step.id order by position
      loop
        insert into public.job_step_blocks (job_id, job_step_id, source_block_id, position, heading, kind)
        values (v_job, v_job_step, v_block.id, v_block.position, v_block.heading, v_block.kind)
        returning id into v_job_block;

        insert into public.job_step_block_items (
          job_id, job_block_id, block_kind, source_item_id, position, text, required
        )
        select v_job, v_job_block, i.block_kind, i.id, i.position, i.text, i.required
        from public.workflow_step_block_items i
        where i.block_id = v_block.id
        order by i.position;
      end loop;

      insert into public.job_step_inputs (
        job_id, job_step_id, source_input_id, position, key, label, input_type, required,
        unit, choices, whole_number, minimum
      )
      select v_job, v_job_step, i.id, i.position, i.key, i.label, i.input_type, i.required,
             i.unit, i.choices, i.whole_number, i.minimum
      from public.workflow_step_inputs i
      where i.step_id = v_step.id
      order by i.position;

      insert into public.job_step_proof_requirements (
        job_id, job_step_id, source_requirement_id, position, label, media_type, min_count,
        allow_multiple
      )
      select v_job, v_job_step, p.id, p.position, p.label, p.media_type, p.min_count,
             p.allow_multiple
      from public.workflow_step_proof_requirements p
      where p.step_id = v_step.id
      order by p.position;
    end loop;
  end loop;

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (
    v_job, v_owner, 'job_created',
    jsonb_build_object(
      'workflow_key', v_template.key,
      'workflow_version', v_template.version,
      'workflow_content_sha256', v_template.content_sha256
    )
  );

  return v_job;
end;
$$;

-- Edits the details of a Scheduled job. Records every changed field (old and
-- new values) in job history.
create function public.update_job_details(
  p_job uuid,
  p_client_name text,
  p_address text,
  p_square_feet integer,
  p_flake_color text,
  p_scheduled_date date,
  p_general_notes text,
  p_caulking_required boolean,
  p_baseboard_required boolean,
  p_allow_employees_to_join boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_old public.jobs;
  v_new public.jobs;
  v_changes jsonb := '{}'::jsonb;
  v_field text;
begin
  select * into v_old from public.jobs where id = p_job for update;
  if v_old.id is null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if v_old.status <> 'scheduled' then
    raise exception 'Only Scheduled jobs can be edited. Return the job to Scheduled first.'
      using errcode = 'P0001';
  end if;

  update public.jobs
  set client_name = btrim(p_client_name),
      address = btrim(p_address),
      square_feet = p_square_feet,
      flake_color = btrim(p_flake_color),
      scheduled_date = p_scheduled_date,
      general_notes = coalesce(btrim(p_general_notes), ''),
      caulking_required = p_caulking_required,
      baseboard_required = p_baseboard_required,
      allow_employees_to_join = p_allow_employees_to_join
  where id = p_job
  returning * into v_new;

  foreach v_field in array array[
    'client_name', 'address', 'square_feet', 'flake_color', 'scheduled_date',
    'general_notes', 'caulking_required', 'baseboard_required', 'allow_employees_to_join'
  ]
  loop
    if to_jsonb(v_old) -> v_field is distinct from to_jsonb(v_new) -> v_field then
      v_changes := v_changes || jsonb_build_object(
        v_field,
        jsonb_build_object('from', to_jsonb(v_old) -> v_field, 'to', to_jsonb(v_new) -> v_field)
      );
    end if;
  end loop;

  if v_changes <> '{}'::jsonb then
    update public.jobs set last_activity_at = now() where id = p_job;
    insert into public.job_activity (job_id, actor_id, activity_type, details)
    values (p_job, v_owner, 'job_details_edited', jsonb_build_object('changes', v_changes));
  end if;
end;
$$;

create function public.make_job_available(p_job uuid)
returns void
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
  if v_status <> 'scheduled' then
    raise exception 'Only Scheduled jobs can be made available.' using errcode = 'P0001';
  end if;

  update public.jobs
  set status = 'available_to_claim', made_available_at = now(), last_activity_at = now()
  where id = p_job;

  insert into public.job_activity (job_id, actor_id, activity_type)
  values (p_job, v_owner, 'made_available');
end;
$$;

-- Phase 4 will also require that the job has no team and no started work.
create function public.return_job_to_scheduled(p_job uuid)
returns void
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
  if v_status <> 'available_to_claim' then
    raise exception 'Only jobs that are Available to Claim can be returned to Scheduled.'
      using errcode = 'P0001';
  end if;

  update public.jobs
  set status = 'scheduled', made_available_at = null, last_activity_at = now()
  where id = p_job;

  insert into public.job_activity (job_id, actor_id, activity_type)
  values (p_job, v_owner, 'returned_to_scheduled');
end;
$$;

revoke execute on function public.require_owner() from public, anon;
grant execute on function public.require_owner() to authenticated;
revoke execute on function public.create_job(text, text, integer, text, date, text, boolean, boolean, boolean) from public, anon;
revoke execute on function public.update_job_details(uuid, text, text, integer, text, date, text, boolean, boolean, boolean) from public, anon;
revoke execute on function public.make_job_available(uuid) from public, anon;
revoke execute on function public.return_job_to_scheduled(uuid) from public, anon;
-- Callable by signed-in users; each function refuses anyone but an active owner.
grant execute on function public.create_job(text, text, integer, text, date, text, boolean, boolean, boolean) to authenticated;
grant execute on function public.update_job_details(uuid, text, text, integer, text, date, text, boolean, boolean, boolean) to authenticated;
grant execute on function public.make_job_available(uuid) to authenticated;
grant execute on function public.return_job_to_scheduled(uuid) to authenticated;

-- 7. Progress summary for job cards ---------------------------------------------
--
-- Units: every preparation step, each owner milestone, and each Completion
-- Work item that applies to the job. Completed units are always 0 until step
-- completion arrives in Phase 5. The current step is the first preparation
-- step until then.

create view public.job_progress
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
        and (
          (s.applies_when = 'caulking_required' and j.caulking_required)
          or (s.applies_when = 'baseboard_required' and j.baseboard_required)
        )
    )
  )::integer as total_units,
  0 as completed_units,
  current_step.stage_name as current_stage_name,
  current_step.title as current_step_title
from public.jobs j
left join lateral (
  select st.name as stage_name, s.title
  from public.job_steps s
  join public.job_stages st on st.id = s.job_stage_id
  where s.job_id = j.id and s.kind = 'standard'
  order by st.position, s.position
  limit 1
) current_step on true;

-- 8. Row Level Security: read-only for active signed-in users --------------------

alter table public.jobs enable row level security;
alter table public.job_stages enable row level security;
alter table public.job_steps enable row level security;
alter table public.job_step_blocks enable row level security;
alter table public.job_step_block_items enable row level security;
alter table public.job_step_inputs enable row level security;
alter table public.job_step_proof_requirements enable row level security;
alter table public.job_activity enable row level security;

-- Employees can view every job, including Scheduled jobs (read only).
create policy "Active users read jobs" on public.jobs
  for select to authenticated using ((select public.is_active_user()));
create policy "Active users read job stages" on public.job_stages
  for select to authenticated using ((select public.is_active_user()));
create policy "Active users read job steps" on public.job_steps
  for select to authenticated using ((select public.is_active_user()));
create policy "Active users read job step blocks" on public.job_step_blocks
  for select to authenticated using ((select public.is_active_user()));
create policy "Active users read job step block items" on public.job_step_block_items
  for select to authenticated using ((select public.is_active_user()));
create policy "Active users read job step inputs" on public.job_step_inputs
  for select to authenticated using ((select public.is_active_user()));
create policy "Active users read job proof requirements" on public.job_step_proof_requirements
  for select to authenticated using ((select public.is_active_user()));
create policy "Active users read job history" on public.job_activity
  for select to authenticated using ((select public.is_active_user()));

revoke all on public.jobs from anon, authenticated;
revoke all on public.job_stages from anon, authenticated;
revoke all on public.job_steps from anon, authenticated;
revoke all on public.job_step_blocks from anon, authenticated;
revoke all on public.job_step_block_items from anon, authenticated;
revoke all on public.job_step_inputs from anon, authenticated;
revoke all on public.job_step_proof_requirements from anon, authenticated;
revoke all on public.job_activity from anon, authenticated;
revoke all on public.job_progress from anon, authenticated;

grant select on public.jobs to authenticated;
grant select on public.job_stages to authenticated;
grant select on public.job_steps to authenticated;
grant select on public.job_step_blocks to authenticated;
grant select on public.job_step_block_items to authenticated;
grant select on public.job_step_inputs to authenticated;
grant select on public.job_step_proof_requirements to authenticated;
grant select on public.job_activity to authenticated;
grant select on public.job_progress to authenticated;
