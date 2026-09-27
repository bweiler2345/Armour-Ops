-- Phase 2: versioned workflow templates.
--
-- A template is one version of the approved workflow. Its content is written
-- while it is a draft, validated, then activated. Once activated (or retired)
-- its content can never change; a workflow change is a new version. Jobs
-- (Phase 3) will copy the content of the version they start with, so later
-- versions never alter work already in progress.
--
-- Signed-in users can read the active template (owners can read every
-- version). No signed-in user can write to these tables. The seed migration
-- and future template changes run as the database owner.

-- 1. Types --------------------------------------------------------------------

create type public.workflow_template_status as enum ('draft', 'active', 'retired');
create type public.workflow_stage_kind as enum ('employee_stage', 'owner_milestone', 'completion_work');
create type public.workflow_step_kind as enum ('standard', 'completion_item');
create type public.workflow_block_kind as enum ('ordered_list', 'reference_list', 'checklist');
create type public.proof_type as enum ('none', 'picture', 'video');
create type public.proof_media_type as enum ('picture', 'video');
create type public.structured_input_type as enum ('text', 'number', 'single_select');
create type public.job_option as enum ('caulking_required', 'baseboard_required');

-- 2. Tables -------------------------------------------------------------------

create table public.workflow_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z0-9][a-z0-9_-]*$'),
  name text not null check (btrim(name) <> ''),
  version integer not null check (version >= 1),
  status public.workflow_template_status not null default 'draft',
  source text not null check (btrim(source) <> ''),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz,
  unique (key, version),
  check ((status = 'draft') = (activated_at is null)),
  check ((status = 'retired') = (retired_at is not null))
);

comment on table public.workflow_templates is
  'Versions of the approved job workflow. Only one version per key is active. Non-draft versions are immutable.';

-- At most one active version of each workflow.
create unique index workflow_templates_one_active
  on public.workflow_templates (key)
  where status = 'active';

create table public.workflow_stage_templates (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.workflow_templates (id) on delete cascade,
  position integer not null check (position >= 1),
  key text not null check (key ~ '^[a-z0-9_]+$'),
  name text not null check (btrim(name) <> ''),
  kind public.workflow_stage_kind not null,
  description text,
  rules_heading text,
  rules text[] not null default '{}',
  owner_action_label text,
  waiting_status_label text,
  completed_status_label text,
  unique (template_id, position),
  unique (template_id, key),
  unique (id, kind),
  -- Owner milestones are completed only by an owner action and have both
  -- a waiting status and a completed status.
  check (
    kind <> 'owner_milestone'
    or (owner_action_label is not null and waiting_status_label is not null and completed_status_label is not null)
  ),
  check (kind = 'owner_milestone' or (waiting_status_label is null and completed_status_label is null)),
  check (kind <> 'employee_stage' or owner_action_label is null)
);

create table public.workflow_step_templates (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null,
  stage_kind public.workflow_stage_kind not null,
  position integer not null check (position >= 1),
  key text not null check (key ~ '^[a-z0-9_]+$'),
  title text not null check (btrim(title) <> ''),
  kind public.workflow_step_kind not null,
  note text,
  goal text,
  reference_image_key text,
  proof_type public.proof_type not null,
  proof_text text,
  confirmation_text text,
  applies_when public.job_option,
  foreign key (stage_id, stage_kind)
    references public.workflow_stage_templates (id, kind) on delete cascade,
  unique (stage_id, position),
  unique (stage_id, key),
  unique (id, kind),
  unique (id, proof_type),
  -- Owner milestones never contain employee steps.
  check (stage_kind <> 'owner_milestone'),
  -- Completion items live only in Completion Work, and only there.
  check ((kind = 'completion_item') = (stage_kind = 'completion_work')),
  check (
    kind <> 'standard'
    or (goal is not null and confirmation_text is not null and applies_when is null)
  ),
  -- Completion items are simple checkboxes: no goal, proof, or confirmation.
  check (
    kind <> 'completion_item'
    or (
      applies_when is not null and proof_type = 'none' and proof_text is null
      and goal is null and confirmation_text is null and note is null
    )
  )
);

create table public.workflow_step_blocks (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null,
  step_kind public.workflow_step_kind not null,
  position integer not null check (position >= 1),
  heading text not null check (btrim(heading) <> ''),
  kind public.workflow_block_kind not null,
  foreign key (step_id, step_kind)
    references public.workflow_step_templates (id, kind) on delete cascade,
  unique (step_id, position),
  unique (id, kind),
  check (step_kind = 'standard')
);

create table public.workflow_step_block_items (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null,
  block_kind public.workflow_block_kind not null,
  position integer not null check (position >= 1),
  text text not null check (btrim(text) <> ''),
  required boolean not null,
  foreign key (block_id, block_kind)
    references public.workflow_step_blocks (id, kind) on delete cascade,
  unique (block_id, position),
  -- Only checklist items can be required. Reference lists and instructions
  -- are never checked item by item.
  check (block_kind = 'checklist' or not required)
);

create table public.workflow_step_inputs (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null,
  step_kind public.workflow_step_kind not null,
  position integer not null check (position >= 1),
  key text not null check (key ~ '^[a-z0-9_]+$'),
  label text not null check (btrim(label) <> ''),
  input_type public.structured_input_type not null,
  required boolean not null,
  unit text,
  choices text[],
  whole_number boolean not null default false,
  minimum numeric,
  foreign key (step_id, step_kind)
    references public.workflow_step_templates (id, kind) on delete cascade,
  unique (step_id, position),
  unique (step_id, key),
  check (step_kind = 'standard'),
  check ((input_type = 'single_select') = (choices is not null)),
  check (choices is null or cardinality(choices) >= 2),
  check (input_type = 'number' or (not whole_number and minimum is null))
);

create table public.workflow_step_proof_requirements (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null,
  step_proof_type public.proof_type not null,
  position integer not null check (position >= 1),
  label text not null check (btrim(label) <> ''),
  media_type public.proof_media_type not null,
  min_count integer not null default 1 check (min_count >= 1),
  allow_multiple boolean not null,
  foreign key (step_id, step_proof_type)
    references public.workflow_step_templates (id, proof_type) on delete cascade,
  unique (step_id, position),
  -- A step's proof requirements all match its proof type, and a step with
  -- proof type "none" has none.
  check (step_proof_type <> 'none'),
  check (step_proof_type::text = media_type::text),
  check (allow_multiple or min_count = 1)
);

create index workflow_step_templates_stage_idx on public.workflow_step_templates (stage_id);
create index workflow_step_blocks_step_idx on public.workflow_step_blocks (step_id);
create index workflow_step_block_items_block_idx on public.workflow_step_block_items (block_id);
create index workflow_step_inputs_step_idx on public.workflow_step_inputs (step_id);
create index workflow_step_proof_requirements_step_idx on public.workflow_step_proof_requirements (step_id);

-- 3. Lookups from any content row to its template -----------------------------

create function public.workflow_template_of_stage(p_stage uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select template_id from public.workflow_stage_templates where id = p_stage;
$$;

create function public.workflow_template_of_step(p_step uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select st.template_id
  from public.workflow_step_templates s
  join public.workflow_stage_templates st on st.id = s.stage_id
  where s.id = p_step;
$$;

create function public.workflow_template_of_block(p_block uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select public.workflow_template_of_step(step_id)
  from public.workflow_step_blocks where id = p_block;
$$;

-- 4. Published versions are immutable ----------------------------------------

create function public.guard_workflow_template_content()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row record;
  v_template uuid;
  v_status public.workflow_template_status;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;

  -- Separate branches: each row type has different columns.
  if tg_table_name = 'workflow_stage_templates' then
    v_template := v_row.template_id;
  elsif tg_table_name = 'workflow_step_templates' then
    v_template := public.workflow_template_of_stage(v_row.stage_id);
  elsif tg_table_name = 'workflow_step_block_items' then
    v_template := public.workflow_template_of_block(v_row.block_id);
  else
    v_template := public.workflow_template_of_step(v_row.step_id);
  end if;

  select status into v_status from public.workflow_templates where id = v_template;

  -- Rows removed by deleting a whole draft template have no parent left.
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Workflow template content cannot change after it is published. Create a new version instead.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger workflow_stage_templates_immutable
  before insert or update or delete on public.workflow_stage_templates
  for each row execute function public.guard_workflow_template_content();
create trigger workflow_step_templates_immutable
  before insert or update or delete on public.workflow_step_templates
  for each row execute function public.guard_workflow_template_content();
create trigger workflow_step_blocks_immutable
  before insert or update or delete on public.workflow_step_blocks
  for each row execute function public.guard_workflow_template_content();
create trigger workflow_step_block_items_immutable
  before insert or update or delete on public.workflow_step_block_items
  for each row execute function public.guard_workflow_template_content();
create trigger workflow_step_inputs_immutable
  before insert or update or delete on public.workflow_step_inputs
  for each row execute function public.guard_workflow_template_content();
create trigger workflow_step_proof_requirements_immutable
  before insert or update or delete on public.workflow_step_proof_requirements
  for each row execute function public.guard_workflow_template_content();

create function public.guard_workflow_template_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Published workflow templates cannot be deleted.' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.status <> 'draft' and (
    new.key is distinct from old.key
    or new.name is distinct from old.name
    or new.version is distinct from old.version
    or new.source is distinct from old.source
    or new.content_sha256 is distinct from old.content_sha256
    or new.created_at is distinct from old.created_at
    or new.activated_at is distinct from old.activated_at
  ) then
    raise exception 'Workflow template content cannot change after it is published. Create a new version instead.'
      using errcode = 'P0001';
  end if;

  -- Allowed status changes: draft -> active, active -> retired.
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status = 'active')
    or (old.status = 'active' and new.status = 'retired')
  ) then
    raise exception 'Invalid workflow template status change from % to %.', old.status, new.status
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger workflow_templates_guard
  before update or delete on public.workflow_templates
  for each row execute function public.guard_workflow_template_row();

-- 5. Validation and activation ------------------------------------------------

create function public.validate_workflow_template(p_template uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_problem text;
begin
  select problem into v_problem from (
    select 'Template has no stages.' as problem
    where not exists (select 1 from public.workflow_stage_templates where template_id = p_template)
    union all
    select format('Stage positions are not 1..n.')
    where exists (
      select 1 from (
        select position, row_number() over (order by position) as n
        from public.workflow_stage_templates where template_id = p_template
      ) s where s.position <> s.n
    )
    union all
    select format('Stage "%s" has no steps.', st.name)
    from public.workflow_stage_templates st
    where st.template_id = p_template
      and st.kind <> 'owner_milestone'
      and not exists (select 1 from public.workflow_step_templates s where s.stage_id = st.id)
    union all
    select format('Step "%s" needs at least one proof requirement.', s.title)
    from public.workflow_step_templates s
    join public.workflow_stage_templates st on st.id = s.stage_id
    where st.template_id = p_template
      and s.proof_type <> 'none'
      and not exists (select 1 from public.workflow_step_proof_requirements p where p.step_id = s.id)
    union all
    select format('Step "%s" needs a Final check with at least one item.', s.title)
    from public.workflow_step_templates s
    join public.workflow_stage_templates st on st.id = s.stage_id
    where st.template_id = p_template
      and s.kind = 'standard'
      and not exists (
        select 1
        from public.workflow_step_blocks b
        join public.workflow_step_block_items i on i.block_id = b.id
        where b.step_id = s.id and b.kind = 'checklist'
      )
    union all
    select format('Block "%s" has no items.', b.heading)
    from public.workflow_step_blocks b
    join public.workflow_step_templates s on s.id = b.step_id
    join public.workflow_stage_templates st on st.id = s.stage_id
    where st.template_id = p_template
      and not exists (select 1 from public.workflow_step_block_items i where i.block_id = b.id)
  ) problems
  limit 1;

  if v_problem is not null then
    raise exception 'Workflow template is not valid: %', v_problem using errcode = 'P0001';
  end if;
end;
$$;

-- Validates a draft, retires the currently active version of the same
-- workflow (if any), and activates the draft, all in one transaction.
create function public.activate_workflow_template(p_template uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_status public.workflow_template_status;
begin
  select key, status into v_key, v_status
  from public.workflow_templates where id = p_template
  for update;

  if v_key is null then
    raise exception 'Workflow template not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only draft workflow templates can be activated.' using errcode = 'P0001';
  end if;

  perform public.validate_workflow_template(p_template);

  update public.workflow_templates
  set status = 'retired', retired_at = now()
  where key = v_key and status = 'active';

  update public.workflow_templates
  set status = 'active', activated_at = now()
  where id = p_template;
end;
$$;

revoke execute on function public.workflow_template_of_stage(uuid) from public, anon;
revoke execute on function public.workflow_template_of_step(uuid) from public, anon;
revoke execute on function public.workflow_template_of_block(uuid) from public, anon;
grant execute on function public.workflow_template_of_stage(uuid) to authenticated;
grant execute on function public.workflow_template_of_step(uuid) to authenticated;
grant execute on function public.workflow_template_of_block(uuid) to authenticated;
revoke execute on function public.validate_workflow_template(uuid) from public, anon, authenticated;
revoke execute on function public.activate_workflow_template(uuid) from public, anon, authenticated;
grant execute on function public.validate_workflow_template(uuid) to service_role;
grant execute on function public.activate_workflow_template(uuid) to service_role;

-- 6. Row Level Security: read-only for signed-in users --------------------------

create function public.can_read_workflow_template(p_template uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_owner()
    or (
      public.is_active_user()
      and exists (
        select 1 from public.workflow_templates
        where id = p_template and status = 'active'
      )
    );
$$;

revoke execute on function public.can_read_workflow_template(uuid) from public, anon;
grant execute on function public.can_read_workflow_template(uuid) to authenticated;

alter table public.workflow_templates enable row level security;
alter table public.workflow_stage_templates enable row level security;
alter table public.workflow_step_templates enable row level security;
alter table public.workflow_step_blocks enable row level security;
alter table public.workflow_step_block_items enable row level security;
alter table public.workflow_step_inputs enable row level security;
alter table public.workflow_step_proof_requirements enable row level security;

create policy "Read the active workflow (owners read every version)"
  on public.workflow_templates for select to authenticated
  using ((select public.can_read_workflow_template(id)));

create policy "Read stages of readable workflows"
  on public.workflow_stage_templates for select to authenticated
  using ((select public.can_read_workflow_template(template_id)));

create policy "Read steps of readable workflows"
  on public.workflow_step_templates for select to authenticated
  using ((select public.can_read_workflow_template(public.workflow_template_of_stage(stage_id))));

create policy "Read blocks of readable workflows"
  on public.workflow_step_blocks for select to authenticated
  using ((select public.can_read_workflow_template(public.workflow_template_of_step(step_id))));

create policy "Read block items of readable workflows"
  on public.workflow_step_block_items for select to authenticated
  using ((select public.can_read_workflow_template(public.workflow_template_of_block(block_id))));

create policy "Read inputs of readable workflows"
  on public.workflow_step_inputs for select to authenticated
  using ((select public.can_read_workflow_template(public.workflow_template_of_step(step_id))));

create policy "Read proof requirements of readable workflows"
  on public.workflow_step_proof_requirements for select to authenticated
  using ((select public.can_read_workflow_template(public.workflow_template_of_step(step_id))));

-- No insert, update, or delete for signed-in users or visitors.
revoke all on public.workflow_templates from anon, authenticated;
revoke all on public.workflow_stage_templates from anon, authenticated;
revoke all on public.workflow_step_templates from anon, authenticated;
revoke all on public.workflow_step_blocks from anon, authenticated;
revoke all on public.workflow_step_block_items from anon, authenticated;
revoke all on public.workflow_step_inputs from anon, authenticated;
revoke all on public.workflow_step_proof_requirements from anon, authenticated;

grant select on public.workflow_templates to authenticated;
grant select on public.workflow_stage_templates to authenticated;
grant select on public.workflow_step_templates to authenticated;
grant select on public.workflow_step_blocks to authenticated;
grant select on public.workflow_step_block_items to authenticated;
grant select on public.workflow_step_inputs to authenticated;
grant select on public.workflow_step_proof_requirements to authenticated;
