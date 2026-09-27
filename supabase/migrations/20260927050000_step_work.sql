-- Phase 5: step work without media.
--
-- Assigned employees work a job's steps from its immutable workflow snapshot.
-- A step attempt holds the answers (Final check ticks, structured inputs,
-- notes) while it is a draft; completing it freezes them for good. Only one
-- employee can edit a step at a time, through an expiring edit hold. The
-- database decides which steps are open (job_step_state), checks every save
-- and completion, uses its own clock, and writes job history.
--
-- Steps that require pictures or videos cannot be completed until Phase 6
-- adds uploads. Owner installation milestones are completed in Phase 7.
-- Reopening (Phase 8) will mark completed attempts superseded.

-- 1. Types --------------------------------------------------------------------

create type public.step_attempt_status as enum ('draft', 'completed', 'superseded');

alter type public.job_activity_type add value if not exists 'step_started';
alter type public.job_activity_type add value if not exists 'step_completed';
alter type public.job_activity_type add value if not exists 'status_changed';
alter type public.job_activity_type add value if not exists 'step_hold_cleared';

-- 2. Attempts and answers -------------------------------------------------------

create table public.step_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  job_step_id uuid not null,
  attempt_number integer not null check (attempt_number >= 1),
  status public.step_attempt_status not null default 'draft',
  started_by uuid not null references public.profiles (id),
  started_at timestamptz not null default now(),
  employee_notes text not null default '' check (char_length(employee_notes) <= 2000),
  notes_updated_by uuid references public.profiles (id),
  notes_updated_at timestamptz,
  completed_by uuid references public.profiles (id),
  completed_at timestamptz,
  confirmation_text_shown text,
  foreign key (job_step_id, job_id) references public.job_steps (id, job_id),
  unique (job_step_id, attempt_number),
  unique (id, job_step_id),
  check ((status = 'draft') = (completed_at is null)),
  check ((completed_at is null) = (completed_by is null))
);

comment on table public.step_attempts is
  'Work on one job step. Draft answers can change; completed attempts never change.';

-- One current (draft or completed) attempt per step.
create unique index step_attempts_one_current
  on public.step_attempts (job_step_id)
  where status in ('draft', 'completed');

create index step_attempts_job_idx on public.step_attempts (job_id);

create table public.step_check_responses (
  attempt_id uuid not null,
  job_step_id uuid not null,
  job_block_item_id uuid not null references public.job_step_block_items (id),
  item_text_shown text not null,
  checked boolean not null,
  updated_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (attempt_id, job_block_item_id),
  foreign key (attempt_id, job_step_id) references public.step_attempts (id, job_step_id)
);

create table public.step_input_responses (
  attempt_id uuid not null,
  job_step_id uuid not null,
  job_step_input_id uuid not null references public.job_step_inputs (id),
  label_shown text not null,
  value_text text check (value_text is null or char_length(value_text) <= 2000),
  value_number numeric,
  value_choice text,
  updated_by uuid not null references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (attempt_id, job_step_input_id),
  foreign key (attempt_id, job_step_id) references public.step_attempts (id, job_step_id),
  check (num_nonnulls(value_text, value_number, value_choice) <= 1)
);

-- 3. Edit holds -----------------------------------------------------------------
--
-- One row per step while someone holds it. Holds are short-lived working
-- state, not history; an owner clearing a hold is recorded in job history.

create table public.step_edit_holds (
  job_step_id uuid primary key,
  job_id uuid not null,
  held_by uuid not null references public.profiles (id),
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  foreign key (job_step_id, job_id) references public.job_steps (id, job_id),
  check (expires_at > acquired_at)
);

-- Proposed technical default (docs/IMPLEMENTATION_PLAN.md): two minutes,
-- renewed every 30 seconds while the step screen is open.
create function public.step_hold_duration()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '2 minutes' $$;

-- 4. Protect completed work ---------------------------------------------------------

create function public.guard_step_attempt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Step attempts are part of job history and cannot be deleted.'
      using errcode = 'P0001';
  end if;

  if new.id is distinct from old.id
     or new.job_id is distinct from old.job_id
     or new.job_step_id is distinct from old.job_step_id
     or new.attempt_number is distinct from old.attempt_number
     or new.started_by is distinct from old.started_by
     or new.started_at is distinct from old.started_at
  then
    raise exception 'A step attempt''s record cannot change.' using errcode = 'P0001';
  end if;

  if old.status = 'draft' then
    return new; -- Drafts can gain notes and be completed.
  end if;

  -- Completed attempts only ever change by being superseded (Phase 8), and
  -- then nothing else about them changes.
  if old.status = 'completed' and new.status = 'superseded'
     and new.employee_notes is not distinct from old.employee_notes
     and new.notes_updated_by is not distinct from old.notes_updated_by
     and new.notes_updated_at is not distinct from old.notes_updated_at
     and new.completed_by is not distinct from old.completed_by
     and new.completed_at is not distinct from old.completed_at
     and new.confirmation_text_shown is not distinct from old.confirmation_text_shown
  then
    return new;
  end if;

  raise exception 'Completed step work cannot be changed.' using errcode = 'P0001';
end;
$$;

create trigger step_attempts_guard
  before update or delete on public.step_attempts
  for each row execute function public.guard_step_attempt();

create function public.guard_step_response()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.step_attempt_status;
begin
  if tg_op = 'DELETE' then
    raise exception 'Step answers are part of job history and cannot be deleted.'
      using errcode = 'P0001';
  end if;

  select status into v_status from public.step_attempts where id = new.attempt_id;
  if v_status is distinct from 'draft' then
    raise exception 'Answers on a completed step cannot be changed.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (
    new.attempt_id is distinct from old.attempt_id
    or new.job_step_id is distinct from old.job_step_id
  ) then
    raise exception 'An answer cannot move to another step.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger step_check_responses_guard
  before insert or update or delete on public.step_check_responses
  for each row execute function public.guard_step_response();
create trigger step_input_responses_guard
  before insert or update or delete on public.step_input_responses
  for each row execute function public.guard_step_response();

-- 5. Which steps are open ---------------------------------------------------------

-- Whether an owner milestone is done, from the job's status. Phase 7's owner
-- actions move the job past the waiting status.
create function public.milestone_installed(p_status public.job_status, p_stage_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_stage_key
    when 'base_coat_installation' then p_status in (
      'base_coat_installed', 'top_coat_prep_in_progress', 'waiting_for_top_coat_installation',
      'top_coat_installed', 'completion_work_in_progress', 'complete'
    )
    when 'top_coat_installation' then p_status in (
      'top_coat_installed', 'completion_work_in_progress', 'complete'
    )
    else false
  end;
$$;

-- completed | in_progress | available | locked. A step is open (available,
-- or in_progress once a draft exists) when the job is being worked, every
-- earlier stage is done (employee stages: all preparation steps completed;
-- milestones: installed), and every earlier step in its own stage is
-- completed. Completion Work items open in Phase 7.
create function public.job_step_state(p_step uuid)
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
  select s.id, s.job_id, s.kind, s.position, st.position as stage_position, st.kind as stage_kind
  into v_step
  from public.job_steps s
  join public.job_stages st on st.id = s.job_stage_id
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

  if v_step.kind <> 'standard' or v_step.stage_kind <> 'employee_stage' then
    return 'locked';
  end if;

  select status into v_status from public.jobs where id = v_step.job_id;
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

-- The employee holding a step's edit, if the hold is current and they are
-- still an active member of the job team. Otherwise null.
create function public.current_step_hold(p_step uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.held_by
  from public.step_edit_holds h
  join public.profiles p on p.id = h.held_by and p.active
  join public.job_assignments a
    on a.job_id = h.job_id and a.employee_id = h.held_by and a.ended_at is null
  where h.job_step_id = p_step and h.expires_at > now();
$$;

-- 6. Internal helpers (not callable by app users) ---------------------------------

create function public.set_job_status(p_job uuid, p_to public.job_status, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.job_status;
begin
  select status into v_from from public.jobs where id = p_job;
  if v_from = p_to then
    return;
  end if;
  update public.jobs set status = p_to, last_activity_at = now() where id = p_job;
  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (p_job, p_actor, 'status_changed', jsonb_build_object('from', v_from, 'to', p_to));
end;
$$;

-- Checks the caller may work this step right now: an active employee on the
-- job team, and the step is open. Returns the job id.
create function public.require_step_worker(p_step uuid, p_user uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job uuid;
  v_state text;
begin
  select job_id into v_job from public.job_steps where id = p_step;
  if v_job is null then
    raise exception 'Step not found.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.job_assignments
    where job_id = v_job and employee_id = p_user and ended_at is null
  ) then
    raise exception 'Only employees on this job''s team can work its steps.' using errcode = '42501';
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

-- Requires the caller to hold the step's edit, and extends the hold.
create function public.require_step_hold(p_step uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_holder uuid := public.current_step_hold(p_step);
begin
  if v_holder is null then
    raise exception 'Your editing time on this step ran out. Tap “Edit this step” to continue.'
      using errcode = 'P0001';
  end if;
  if v_holder <> p_user then
    raise exception 'Someone else is editing this step right now.' using errcode = 'P0001';
  end if;
  update public.step_edit_holds
  set expires_at = now() + public.step_hold_duration()
  where job_step_id = p_step;
end;
$$;

-- Returns the step's draft attempt, starting one if needed. Starting the first
-- attempt in a stage moves the job to that stage's "in progress" status.
create function public.ensure_step_draft(p_step uuid, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt uuid;
  v_job uuid;
  v_stage_key text;
  v_status public.job_status;
  v_title text;
begin
  select id into v_attempt
  from public.step_attempts
  where job_step_id = p_step and status = 'draft';
  if v_attempt is not null then
    return v_attempt;
  end if;

  select s.job_id, st.key, s.title into v_job, v_stage_key, v_title
  from public.job_steps s join public.job_stages st on st.id = s.job_stage_id
  where s.id = p_step;

  insert into public.step_attempts (job_id, job_step_id, attempt_number, started_by)
  values (
    v_job, p_step,
    coalesce((select max(attempt_number) from public.step_attempts where job_step_id = p_step), 0) + 1,
    p_user
  )
  returning id into v_attempt;

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (v_job, p_user, 'step_started', jsonb_build_object('step_id', p_step, 'title', v_title));

  select status into v_status from public.jobs where id = v_job for update;
  if v_stage_key = 'initial_prep' and v_status = 'claimed' then
    perform public.set_job_status(v_job, 'initial_prep_in_progress', p_user);
  elsif v_stage_key = 'top_coat_prep' and v_status = 'base_coat_installed' then
    perform public.set_job_status(v_job, 'top_coat_prep_in_progress', p_user);
  end if;

  update public.jobs set last_activity_at = now() where id = v_job;
  return v_attempt;
end;
$$;

-- Parses and validates one structured-input answer. Blank clears it.
create function public.parse_step_input(p_input public.job_step_inputs, p_value text)
returns table (value_text text, value_number numeric, value_choice text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raw text := btrim(coalesce(p_value, ''));
  v_number numeric;
begin
  if v_raw = '' then
    return query select null::text, null::numeric, null::text;
    return;
  end if;

  if p_input.input_type = 'text' then
    if char_length(v_raw) > 2000 then
      raise exception '% must be 2,000 characters or fewer.', p_input.label using errcode = 'P0001';
    end if;
    return query select v_raw, null::numeric, null::text;
  elsif p_input.input_type = 'number' then
    if v_raw !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'Enter a number for %.', p_input.label using errcode = 'P0001';
    end if;
    v_number := v_raw::numeric;
    if p_input.whole_number and v_number <> trunc(v_number) then
      raise exception 'Enter a whole number for %.', p_input.label using errcode = 'P0001';
    end if;
    if v_number < coalesce(p_input.minimum, 0) then
      raise exception '% must be % or more.', p_input.label, coalesce(p_input.minimum, 0)
        using errcode = 'P0001';
    end if;
    return query select null::text, v_number, null::text;
  else
    if not (v_raw = any (p_input.choices)) then
      raise exception 'Choose one of the listed options for %.', p_input.label using errcode = 'P0001';
    end if;
    return query select null::text, null::numeric, v_raw;
  end if;
end;
$$;

revoke execute on function public.set_job_status(uuid, public.job_status, uuid) from public, anon, authenticated;
revoke execute on function public.require_step_worker(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.require_step_hold(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ensure_step_draft(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.parse_step_input(public.job_step_inputs, text) from public, anon, authenticated;
revoke execute on function public.current_step_hold(uuid) from public, anon;
revoke execute on function public.job_step_state(uuid) from public, anon;
revoke execute on function public.milestone_installed(public.job_status, text) from public, anon;
grant execute on function public.current_step_hold(uuid) to authenticated;
grant execute on function public.job_step_state(uuid) to authenticated;
grant execute on function public.milestone_installed(public.job_status, text) to authenticated;

-- 7. Edit holds -------------------------------------------------------------------

-- Takes (or refreshes) the step's edit for the caller. Succeeds when nobody
-- holds it, the hold expired, the holder left the team or was deactivated, or
-- the caller already holds it. The insert-or-update is one atomic statement,
-- so two simultaneous requests cannot both win.
create function public.acquire_step_edit(p_step uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_active_employee();
  v_job uuid := public.require_step_worker(p_step, v_user);
  v_expires timestamptz;
begin
  insert into public.step_edit_holds as h (job_step_id, job_id, held_by, expires_at)
  values (p_step, v_job, v_user, now() + public.step_hold_duration())
  on conflict (job_step_id) do update
    set held_by = excluded.held_by,
        acquired_at = case when h.held_by = excluded.held_by then h.acquired_at else now() end,
        expires_at = excluded.expires_at
    where h.held_by = excluded.held_by
       or h.expires_at <= now()
       or public.current_step_hold(h.job_step_id) is null
  returning h.expires_at into v_expires;

  if v_expires is null then
    raise exception 'Someone else is editing this step right now.' using errcode = 'P0001';
  end if;
  return v_expires;
end;
$$;

create function public.release_step_edit(p_step uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  delete from public.step_edit_holds where job_step_id = p_step and held_by = v_user;
end;
$$;

create function public.clear_step_edit(p_step uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_hold public.step_edit_holds;
  v_title text;
begin
  delete from public.step_edit_holds where job_step_id = p_step returning * into v_hold;
  if v_hold.job_step_id is null then
    raise exception 'Nobody is editing this step.' using errcode = 'P0001';
  end if;
  select title into v_title from public.job_steps where id = p_step;
  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (
    v_hold.job_id, v_owner, 'step_hold_cleared',
    jsonb_build_object('step_id', p_step, 'title', v_title, 'employee_id', v_hold.held_by)
  );
end;
$$;

-- 8. Saving answers ---------------------------------------------------------------

create function public.save_step_check(p_step uuid, p_item uuid, p_checked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_active_employee();
  v_job uuid := public.require_step_worker(p_step, v_user);
  v_text text;
  v_attempt uuid;
begin
  perform public.require_step_hold(p_step, v_user);
  if p_checked is null then
    raise exception 'Choose checked or unchecked.' using errcode = 'P0001';
  end if;

  -- Only Final check items are checkboxes; reference lists are not.
  select i.text into v_text
  from public.job_step_block_items i
  join public.job_step_blocks b on b.id = i.job_block_id
  where i.id = p_item and b.job_step_id = p_step and b.kind = 'checklist';
  if v_text is null then
    raise exception 'That item isn''t a check on this step.' using errcode = 'P0001';
  end if;

  v_attempt := public.ensure_step_draft(p_step, v_user);
  insert into public.step_check_responses as r
    (attempt_id, job_step_id, job_block_item_id, item_text_shown, checked, updated_by)
  values (v_attempt, p_step, p_item, v_text, p_checked, v_user)
  on conflict (attempt_id, job_block_item_id) do update
    set checked = excluded.checked, updated_by = excluded.updated_by, updated_at = now();

  update public.jobs set last_activity_at = now() where id = v_job;
end;
$$;

create function public.save_step_input(p_step uuid, p_input uuid, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_active_employee();
  v_job uuid := public.require_step_worker(p_step, v_user);
  v_input public.job_step_inputs;
  v_parsed record;
  v_attempt uuid;
begin
  perform public.require_step_hold(p_step, v_user);
  select * into v_input from public.job_step_inputs where id = p_input and job_step_id = p_step;
  if v_input.id is null then
    raise exception 'That entry isn''t part of this step.' using errcode = 'P0001';
  end if;

  select * into v_parsed from public.parse_step_input(v_input, p_value);
  v_attempt := public.ensure_step_draft(p_step, v_user);

  insert into public.step_input_responses as r
    (attempt_id, job_step_id, job_step_input_id, label_shown, value_text, value_number, value_choice, updated_by)
  values (
    v_attempt, p_step, p_input, v_input.label,
    v_parsed.value_text, v_parsed.value_number, v_parsed.value_choice, v_user
  )
  on conflict (attempt_id, job_step_input_id) do update
    set value_text = excluded.value_text,
        value_number = excluded.value_number,
        value_choice = excluded.value_choice,
        updated_by = excluded.updated_by,
        updated_at = now();

  update public.jobs set last_activity_at = now() where id = v_job;
end;
$$;

create function public.save_step_notes(p_step uuid, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_active_employee();
  v_job uuid := public.require_step_worker(p_step, v_user);
  v_attempt uuid;
  v_notes text := btrim(coalesce(p_notes, ''));
begin
  perform public.require_step_hold(p_step, v_user);
  if char_length(v_notes) > 2000 then
    raise exception 'Notes must be 2,000 characters or fewer.' using errcode = 'P0001';
  end if;
  v_attempt := public.ensure_step_draft(p_step, v_user);
  update public.step_attempts
  set employee_notes = v_notes, notes_updated_by = v_user, notes_updated_at = now()
  where id = v_attempt;
  update public.jobs set last_activity_at = now() where id = v_job;
end;
$$;

-- 9. Completing a step --------------------------------------------------------------

-- Re-checks everything, freezes the attempt with the employee and database
-- time, releases the hold, and moves the job to the waiting status when its
-- stage is finished. All in one transaction.
create function public.complete_step(p_step uuid, p_confirmed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_active_employee();
  v_job uuid := public.require_step_worker(p_step, v_user);
  v_step public.job_steps;
  v_stage public.job_stages;
  v_attempt uuid;
  v_missing text;
  v_status public.job_status;
begin
  perform public.require_step_hold(p_step, v_user);
  select * into v_step from public.job_steps where id = p_step;
  select * into v_stage from public.job_stages where id = v_step.job_stage_id;

  if p_confirmed is not true then
    raise exception 'Confirm the statement before completing this step.' using errcode = 'P0001';
  end if;

  v_attempt := public.ensure_step_draft(p_step, v_user);

  -- Every required Final check item must be checked.
  select i.text into v_missing
  from public.job_step_block_items i
  join public.job_step_blocks b on b.id = i.job_block_id
  where b.job_step_id = p_step and b.kind = 'checklist' and i.required
    and not exists (
      select 1 from public.step_check_responses r
      where r.attempt_id = v_attempt and r.job_block_item_id = i.id and r.checked
    )
  order by b.position, i.position
  limit 1;
  if v_missing is not null then
    raise exception 'Check every Final check item first. Missing: %', v_missing using errcode = 'P0001';
  end if;

  -- Every required structured input must have a valid answer.
  select inp.label into v_missing
  from public.job_step_inputs inp
  where inp.job_step_id = p_step and inp.required
    and not exists (
      select 1 from public.step_input_responses r
      where r.attempt_id = v_attempt and r.job_step_input_id = inp.id
        and num_nonnulls(r.value_text, r.value_number, r.value_choice) = 1
    )
  order by inp.position
  limit 1;
  if v_missing is not null then
    raise exception 'Fill in every required entry first. Missing: %', v_missing using errcode = 'P0001';
  end if;

  -- Picture and video proof arrives in Phase 6. Until then these steps
  -- cannot be completed.
  if v_step.proof_type <> 'none' then
    raise exception 'This step needs % proof. Uploading arrives in the next update, so it can''t be completed yet.',
      case v_step.proof_type when 'video' then 'video' else 'picture' end
      using errcode = 'P0001';
  end if;

  update public.step_attempts
  set status = 'completed',
      completed_by = v_user,
      completed_at = now(),
      confirmation_text_shown = v_step.confirmation_text
  where id = v_attempt;

  delete from public.step_edit_holds where job_step_id = p_step;

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (v_job, v_user, 'step_completed', jsonb_build_object('step_id', p_step, 'title', v_step.title));

  update public.jobs set last_activity_at = now() where id = v_job;

  -- Finishing the last preparation step of a stage stops at the owner's
  -- installation milestone.
  if not exists (
    select 1 from public.job_steps s2
    where s2.job_stage_id = v_stage.id and s2.kind = 'standard'
      and not exists (
        select 1 from public.step_attempts a
        where a.job_step_id = s2.id and a.status = 'completed'
      )
  ) then
    select status into v_status from public.jobs where id = v_job for update;
    if v_stage.key = 'initial_prep' and v_status = 'initial_prep_in_progress' then
      perform public.set_job_status(v_job, 'waiting_for_base_coat_installation', v_user);
    elsif v_stage.key = 'top_coat_prep' and v_status = 'top_coat_prep_in_progress' then
      perform public.set_job_status(v_job, 'waiting_for_top_coat_installation', v_user);
    end if;
  end if;
end;
$$;

revoke execute on function public.acquire_step_edit(uuid) from public, anon;
revoke execute on function public.release_step_edit(uuid) from public, anon;
revoke execute on function public.clear_step_edit(uuid) from public, anon;
revoke execute on function public.save_step_check(uuid, uuid, boolean) from public, anon;
revoke execute on function public.save_step_input(uuid, uuid, text) from public, anon;
revoke execute on function public.save_step_notes(uuid, text) from public, anon;
revoke execute on function public.complete_step(uuid, boolean) from public, anon;
grant execute on function public.acquire_step_edit(uuid) to authenticated;
grant execute on function public.release_step_edit(uuid) to authenticated;
grant execute on function public.clear_step_edit(uuid) to authenticated;
grant execute on function public.save_step_check(uuid, uuid, boolean) to authenticated;
grant execute on function public.save_step_input(uuid, uuid, text) to authenticated;
grant execute on function public.save_step_notes(uuid, text) to authenticated;
grant execute on function public.complete_step(uuid, boolean) to authenticated;

-- 10. Progress (replaces the Phase 3 placeholder) -----------------------------------
--
-- Completed units: completed preparation steps plus installed milestones.
-- Completion Work items are counted as done in Phase 7. The current step is
-- the first open preparation step; while the job waits for the owner, the
-- waiting status is shown instead.

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
        and (
          (s.applies_when = 'caulking_required' and j.caulking_required)
          or (s.applies_when = 'baseboard_required' and j.baseboard_required)
        )
    )
  )::integer as total_units,
  (
    (
      select count(*) from public.job_steps s
      where s.job_id = j.id and s.kind = 'standard'
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
  coalesce(waiting.name, current_step.stage_name) as current_stage_name,
  coalesce(waiting.waiting_status_label, current_step.title) as current_step_title
from public.jobs j
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
) current_step on true;

-- 11. Read access -------------------------------------------------------------------

alter table public.step_attempts enable row level security;
alter table public.step_check_responses enable row level security;
alter table public.step_input_responses enable row level security;
alter table public.step_edit_holds enable row level security;

create policy "Active users read step attempts" on public.step_attempts
  for select to authenticated using ((select public.is_active_user()));
create policy "Active users read check answers" on public.step_check_responses
  for select to authenticated using ((select public.is_active_user()));
create policy "Active users read input answers" on public.step_input_responses
  for select to authenticated using ((select public.is_active_user()));
create policy "Active users read edit holds" on public.step_edit_holds
  for select to authenticated using ((select public.is_active_user()));

revoke all on public.step_attempts from anon, authenticated;
revoke all on public.step_check_responses from anon, authenticated;
revoke all on public.step_input_responses from anon, authenticated;
revoke all on public.step_edit_holds from anon, authenticated;
grant select on public.step_attempts to authenticated;
grant select on public.step_check_responses to authenticated;
grant select on public.step_input_responses to authenticated;
grant select on public.step_edit_holds to authenticated;

-- Each step's state, current attempt, and edit hold, with names, for the
-- job and step screens. Like job_team, it runs with its owner's rights so
-- employees see who completed or holds a step (names only), and only active
-- signed-in users can read it.
create view public.job_step_status
with (security_barrier = true)
as
select
  s.job_id,
  s.id as job_step_id,
  public.job_step_state(s.id) as state,
  a.id as attempt_id,
  a.status as attempt_status,
  a.started_by,
  a.started_at,
  a.completed_by,
  completed_by_profile.full_name as completed_by_name,
  a.completed_at,
  hold.held_by as hold_held_by,
  hold_profile.full_name as hold_held_by_name,
  hold.expires_at as hold_expires_at
from public.job_steps s
left join public.step_attempts a
  on a.job_step_id = s.id and a.status in ('draft', 'completed')
left join public.profiles completed_by_profile on completed_by_profile.id = a.completed_by
left join public.step_edit_holds hold
  on hold.job_step_id = s.id and public.current_step_hold(s.id) = hold.held_by
left join public.profiles hold_profile on hold_profile.id = hold.held_by
where public.is_active_user();

revoke all on public.job_step_status from anon, authenticated;
grant select on public.job_step_status to authenticated;
