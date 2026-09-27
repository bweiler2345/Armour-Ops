-- Phase 7: installation milestones, Completion Work, and owner job completion.
--
-- Owner milestones: mark_milestone_installed() records the owner and database
-- time in job_milestones (append-only), moves the job from its waiting status
-- to Base Coat Installed or Top Coat Installed, and writes history. Repeated
-- requests change nothing and add no history.
--
-- Completion Work: after Top Coat Installation, active assigned employees
-- mark each applicable item (Caulking Complete, then Baseboard Complete) with
-- complete_completion_item(). Items for options that are off are Not
-- Applicable and never block completion. Items have no checklist, entries,
-- proof, or confirmation, so they don't use edit leases: one tap completes
-- one item, serialized by a lock on the job row.
--
-- Job completion: mark_job_complete() is owner-only and requires both
-- milestones and every applicable Completion Work item. It records the owner,
-- database time, and the media retention date (five years after completion),
-- and the job is read only from then on. Nothing is deleted.
--
-- Notifications are in-app only (status, badges, and the Owner Dashboard).
-- No email is sent.

-- 1. Types -------------------------------------------------------------------------

alter type public.job_activity_type add value if not exists 'milestone_installed';
alter type public.job_activity_type add value if not exists 'job_completed';

-- 2. Milestone records (append-only) ------------------------------------------------

create table public.job_milestones (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  job_stage_id uuid not null,
  milestone_key text not null
    check (milestone_key in ('base_coat_installation', 'top_coat_installation')),
  installed_by uuid not null references public.profiles (id),
  installed_at timestamptz not null default now(),
  foreign key (job_stage_id, job_id) references public.job_stages (id, job_id),
  unique (job_id, milestone_key)
);

comment on table public.job_milestones is
  'Owner installation milestones, one row per milestone per job. Written only by mark_milestone_installed(). Never changed or deleted.';

create trigger job_milestones_append_only
  before update or delete on public.job_milestones
  for each row execute function public.prevent_history_change();

-- 3. Complete jobs are read only -----------------------------------------------------

create function public.guard_job_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'complete' then
    raise exception 'This job is complete and can''t be changed.' using errcode = 'P0001';
  end if;
  if new.status = 'complete' then
    if new.completed_at is null or new.completed_by is null or new.media_delete_after is null then
      raise exception 'A complete job needs its completion record.' using errcode = 'P0001';
    end if;
  elsif new.completed_at is not null or new.completed_by is not null or new.media_delete_after is not null then
    raise exception 'Only a complete job has a completion record.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger jobs_guard_completion
  before update on public.jobs
  for each row execute function public.guard_job_completion();

-- Work, holds, uploads, and team changes are refused on a complete job.
create function public.reject_if_job_complete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.jobs where id = new.job_id and status = 'complete') then
    raise exception 'This job is complete and can''t be changed.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger step_attempts_job_not_complete
  before insert or update on public.step_attempts
  for each row execute function public.reject_if_job_complete();
create trigger step_edit_holds_job_not_complete
  before insert or update on public.step_edit_holds
  for each row execute function public.reject_if_job_complete();
create trigger step_media_job_not_complete
  before insert on public.step_media
  for each row execute function public.reject_if_job_complete();
create trigger job_assignments_job_not_complete
  before insert or update on public.job_assignments
  for each row execute function public.reject_if_job_complete();

-- 4. Which steps are open (adds Completion Work) ---------------------------------------

-- Whether a Completion Work item applies to a job, from the job's options.
create function public.completion_item_applies(
  p_applies_when public.job_option,
  p_caulking_required boolean,
  p_baseboard_required boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_applies_when
    when 'caulking_required' then p_caulking_required
    when 'baseboard_required' then p_baseboard_required
    else true
  end;
$$;

-- completed | in_progress | available | locked | not_applicable.
-- Preparation steps are unchanged from Phase 5. Completion Work items open
-- once the top coat is installed, in order: an applicable item waits for
-- every earlier applicable item. Items whose job option is off are
-- not_applicable.
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

-- Preparation-step work (edit leases, answers, uploads, Complete Step) never
-- applies to Completion Work items; they use complete_completion_item().
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
  if not exists (
    select 1 from public.job_assignments
    where job_id = v_job and employee_id = p_user and ended_at is null
  ) then
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

-- 5. Owner installation milestones ------------------------------------------------------

-- Marks Base-Coat Installation or Top-Coat Installation installed. Returns
-- 'installed', or 'already_installed' (with no change and no history) when it
-- was already marked, so a repeated or simultaneous request is harmless.
create function public.mark_milestone_installed(p_job uuid, p_milestone text)
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

  -- One request at a time per job.
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

-- 6. Completion Work ------------------------------------------------------------------------

-- Marks one applicable Completion Work item complete for the calling
-- employee. Returns 'completed', or 'already_completed' (no change, no
-- history) if a teammate got there first.
create function public.complete_completion_item(p_step uuid)
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

  -- One request at a time per job.
  select * into v_job from public.jobs where id = v_step.job_id for update;

  if not exists (
    select 1 from public.job_assignments
    where job_id = v_job.id and employee_id = v_user and ended_at is null
  ) then
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

-- Whether every prerequisite for Mark Job Complete is met: both milestones
-- installed, every preparation step complete, and every applicable
-- Completion Work item complete.
create function public.job_ready_for_completion(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select j.status in ('top_coat_installed', 'completion_work_in_progress')
    and (select count(*) from public.job_milestones m where m.job_id = j.id)
      = (select count(*) from public.job_stages st where st.job_id = j.id and st.kind = 'owner_milestone')
    and not exists (
      select 1 from public.job_steps s
      where s.job_id = j.id
        and (
          s.kind = 'standard'
          or public.completion_item_applies(s.applies_when, j.caulking_required, j.baseboard_required)
        )
        and not exists (
          select 1 from public.step_attempts a
          where a.job_step_id = s.id and a.status = 'completed'
        )
    )
  from public.jobs j
  where j.id = p_job;
$$;

-- 7. Owner job completion -----------------------------------------------------------------

-- Returns 'completed', or 'already_complete' (no change, no history).
create function public.mark_job_complete(p_job uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_job public.jobs;
  v_missing text;
  v_now timestamptz := now();
begin
  select * into v_job from public.jobs where id = p_job for update;
  if v_job.id is null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if v_job.status = 'complete' then
    return 'already_complete';
  end if;
  if v_job.status not in ('top_coat_installed', 'completion_work_in_progress') then
    raise exception 'A job can be marked Complete only after the top coat is installed and all Completion Work is done.'
      using errcode = 'P0001';
  end if;

  select s.title into v_missing
  from public.job_steps s
  join public.job_stages st on st.id = s.job_stage_id
  where s.job_id = p_job
    and public.completion_item_applies(s.applies_when, v_job.caulking_required, v_job.baseboard_required)
    and not exists (
      select 1 from public.step_attempts a
      where a.job_step_id = s.id and a.status = 'completed'
    )
  order by st.position, s.position
  limit 1;
  if v_missing is not null then
    raise exception 'Finish every step first. Not done yet: %', v_missing using errcode = 'P0001';
  end if;
  if not public.job_ready_for_completion(p_job) then
    raise exception 'Both installation milestones must be marked installed first.' using errcode = 'P0001';
  end if;

  -- Nobody is editing a finished job.
  delete from public.step_edit_holds where job_id = p_job;

  update public.jobs
  set status = 'complete',
      completed_at = v_now,
      completed_by = v_owner,
      media_delete_after = v_now + interval '5 years',
      last_activity_at = v_now
  where id = p_job;

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values
    (p_job, v_owner, 'status_changed', jsonb_build_object('from', v_job.status, 'to', 'complete')),
    (p_job, v_owner, 'job_completed', jsonb_build_object('media_delete_after', v_now + interval '5 years'));
  return 'completed';
end;
$$;

revoke execute on function public.mark_milestone_installed(uuid, text) from public, anon;
revoke execute on function public.complete_completion_item(uuid) from public, anon;
revoke execute on function public.mark_job_complete(uuid) from public, anon;
revoke execute on function public.job_ready_for_completion(uuid) from public, anon;
revoke execute on function public.completion_item_applies(public.job_option, boolean, boolean) from public, anon;
revoke execute on function public.guard_job_completion() from public, anon, authenticated;
revoke execute on function public.reject_if_job_complete() from public, anon, authenticated;
grant execute on function public.mark_milestone_installed(uuid, text) to authenticated;
grant execute on function public.complete_completion_item(uuid) to authenticated;
grant execute on function public.mark_job_complete(uuid) to authenticated;
grant execute on function public.job_ready_for_completion(uuid) to authenticated;
grant execute on function public.completion_item_applies(public.job_option, boolean, boolean) to authenticated;

-- 8. Progress (adds Completion Work and owner review) ---------------------------------------

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
      waiting.name,
      current_step.stage_name,
      current_item.stage_name,
      case when j.status in ('top_coat_installed', 'completion_work_in_progress') then completion_stage.name end
    )
  end as current_stage_name,
  case
    when j.status = 'complete' then null
    else coalesce(
      waiting.waiting_status_label,
      current_step.title,
      current_item.title,
      case when j.status in ('top_coat_installed', 'completion_work_in_progress') then 'Ready for owner review' end
    )
  end as current_step_title,
  (
    j.status in ('top_coat_installed', 'completion_work_in_progress')
    and current_item.title is null
  ) as ready_for_owner_completion
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

-- 9. Read access ----------------------------------------------------------------------------

alter table public.job_milestones enable row level security;

create policy "Active users read installation milestones" on public.job_milestones
  for select to authenticated using ((select public.is_active_user()));

revoke all on public.job_milestones from anon, authenticated;
grant select on public.job_milestones to authenticated;

-- Milestones with the owner's name, for job pages. Like job_step_status, it
-- runs with its owner's rights so employees see who marked a milestone
-- (names only), and only active signed-in users can read it.
create view public.job_milestone_status
with (security_barrier = true)
as
select
  m.job_id,
  m.job_stage_id,
  m.milestone_key,
  m.installed_by,
  p.full_name as installed_by_name,
  m.installed_at
from public.job_milestones m
left join public.profiles p on p.id = m.installed_by
where public.is_active_user();

revoke all on public.job_milestone_status from anon, authenticated;
grant select on public.job_milestone_status to authenticated;
