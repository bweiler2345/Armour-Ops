-- Phase 4: job teams, claiming, and joining.
--
-- A job team is a set of assignments: exactly one active lead whenever anyone
-- is assigned, plus any number of active members. Assignments are never
-- deleted; ending one sets ended_at, ended_by, and end_reason, and a role
-- change ends the old row and starts a new one, so the full team and lead
-- history is kept. Every change goes through a function below that checks
-- the caller, uses the database clock, and writes job history.

-- 1. Types --------------------------------------------------------------------

create type public.assignment_role as enum ('lead', 'member');
create type public.assignment_method as enum ('claimed', 'joined', 'added_by_owner', 'lead_change');
create type public.assignment_end_reason as enum ('removed_by_owner', 'role_changed');

alter type public.job_activity_type add value if not exists 'claimed';
alter type public.job_activity_type add value if not exists 'employee_joined';
alter type public.job_activity_type add value if not exists 'employee_added';
alter type public.job_activity_type add value if not exists 'employee_removed';
alter type public.job_activity_type add value if not exists 'lead_changed';
alter type public.job_activity_type add value if not exists 'join_setting_changed';

-- 2. Assignments --------------------------------------------------------------

create table public.job_assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  employee_id uuid not null references public.profiles (id),
  role public.assignment_role not null,
  method public.assignment_method not null,
  assigned_at timestamptz not null default now(),
  assigned_by uuid not null references public.profiles (id),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id),
  end_reason public.assignment_end_reason,
  check ((ended_at is null) = (ended_by is null)),
  check ((ended_at is null) = (end_reason is null)),
  check (ended_at is null or ended_at >= assigned_at)
);

comment on table public.job_assignments is
  'Job team history. Active rows have ended_at null. Rows are never deleted.';

-- No duplicate active assignment for the same employee and job.
create unique index job_assignments_one_active_per_employee
  on public.job_assignments (job_id, employee_id)
  where ended_at is null;

-- At most one active lead per job.
create unique index job_assignments_one_active_lead
  on public.job_assignments (job_id)
  where role = 'lead' and ended_at is null;

create index job_assignments_employee_idx
  on public.job_assignments (employee_id)
  where ended_at is null;

-- Ending an assignment is the only change allowed, and only once.
create function public.guard_job_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Job assignments are part of job history and cannot be deleted.'
      using errcode = 'P0001';
  end if;

  if old.ended_at is not null
     or new.job_id is distinct from old.job_id
     or new.employee_id is distinct from old.employee_id
     or new.role is distinct from old.role
     or new.method is distinct from old.method
     or new.assigned_at is distinct from old.assigned_at
     or new.assigned_by is distinct from old.assigned_by
  then
    raise exception 'A job assignment can only be ended, once. Start a new assignment instead.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger job_assignments_guard
  before update or delete on public.job_assignments
  for each row execute function public.guard_job_assignment();

-- Whenever anyone is assigned, the team has exactly one lead. Checked at the
-- end of each transaction so a lead can be replaced in several steps.
create function public.check_job_team()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_active integer;
  v_leads integer;
begin
  select count(*), count(*) filter (where role = 'lead')
  into v_active, v_leads
  from public.job_assignments
  where job_id = new.job_id and ended_at is null;

  if v_active > 0 and v_leads <> 1 then
    raise exception 'A job with assigned employees must have exactly one lead.'
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create constraint trigger job_team_has_one_lead
  after insert or update on public.job_assignments
  deferrable initially deferred
  for each row execute function public.check_job_team();

-- 3. Helpers ------------------------------------------------------------------

create function public.require_active_employee()
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
    where id = v_user and active and role = 'employee'
  ) then
    raise exception 'Only an active employee can do this.' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

-- Statuses where someone is working the job (Claimed through Completion Work).
create function public.is_active_job_status(p_status public.job_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status not in ('scheduled', 'available_to_claim', 'complete');
$$;

-- Starts an assignment and records it in job history.
create function public.start_job_assignment(
  p_job uuid,
  p_employee uuid,
  p_role public.assignment_role,
  p_method public.assignment_method,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.job_assignments
    where job_id = p_job and employee_id = p_employee and ended_at is null
  ) then
    raise exception 'That employee is already on this job.' using errcode = 'P0001';
  end if;

  insert into public.job_assignments (job_id, employee_id, role, method, assigned_by)
  values (p_job, p_employee, p_role, p_method, p_actor);
end;
$$;

create function public.end_job_assignment(
  p_job uuid,
  p_employee uuid,
  p_reason public.assignment_end_reason,
  p_actor uuid
)
returns public.assignment_role
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.assignment_role;
begin
  update public.job_assignments
  set ended_at = now(), ended_by = p_actor, end_reason = p_reason
  where job_id = p_job and employee_id = p_employee and ended_at is null
  returning role into v_role;

  if v_role is null then
    raise exception 'That employee is not on this job.' using errcode = 'P0001';
  end if;
  return v_role;
end;
$$;

create function public.require_active_employee_profile(p_employee uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = p_employee and active and role = 'employee'
  ) then
    raise exception 'Choose an active employee.' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.require_active_employee() from public, anon;
revoke execute on function public.is_active_job_status(public.job_status) from public, anon;
revoke execute on function public.start_job_assignment(uuid, uuid, public.assignment_role, public.assignment_method, uuid) from public, anon, authenticated;
revoke execute on function public.end_job_assignment(uuid, uuid, public.assignment_end_reason, uuid) from public, anon, authenticated;
revoke execute on function public.require_active_employee_profile(uuid) from public, anon, authenticated;
grant execute on function public.require_active_employee() to authenticated;
grant execute on function public.is_active_job_status(public.job_status) to authenticated;

-- 4. Employee actions -----------------------------------------------------------

-- The first active employee to claim an Available job becomes its lead. The
-- row lock on the job means a second, simultaneous claim waits, then sees the
-- job is no longer Available and is refused with nothing saved. The
-- one-active-lead index is a second safeguard.
create function public.claim_job(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid := public.require_active_employee();
  v_status public.job_status;
begin
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

-- An active employee joins an in-progress job when the owner allows joining.
create function public.join_job(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid := public.require_active_employee();
  v_job public.jobs;
begin
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

-- 5. Owner actions --------------------------------------------------------------

-- Adds an active employee, whatever the join setting. On an Available job,
-- or an in-progress job whose team is empty, the added employee becomes the
-- lead (an Available job then moves to Claimed). Otherwise they join as a
-- member.
create function public.add_team_member(p_job uuid, p_employee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_status public.job_status;
  v_has_lead boolean;
  v_role public.assignment_role;
begin
  select status into v_status from public.jobs where id = p_job for update;
  if v_status is null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if v_status = 'scheduled' then
    raise exception 'Make the job available before adding employees.' using errcode = 'P0001';
  end if;
  if v_status = 'complete' then
    raise exception 'Employees can''t be added to a complete job.' using errcode = 'P0001';
  end if;
  perform public.require_active_employee_profile(p_employee);

  v_has_lead := exists (
    select 1 from public.job_assignments
    where job_id = p_job and role = 'lead' and ended_at is null
  );
  v_role := case when v_has_lead then 'member' else 'lead' end;

  perform public.start_job_assignment(p_job, p_employee, v_role, 'added_by_owner', v_owner);

  if v_status = 'available_to_claim' then
    update public.jobs set status = 'claimed', last_activity_at = now() where id = p_job;
  else
    update public.jobs set last_activity_at = now() where id = p_job;
  end if;

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (
    p_job, v_owner, 'employee_added',
    jsonb_build_object('employee_id', p_employee, 'role', v_role)
  );
end;
$$;

-- Makes another employee the lead. The previous lead stays on the team as a
-- member. The new lead can be a current member or another active employee.
create function public.change_lead(p_job uuid, p_new_lead uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_status public.job_status;
  v_old_lead uuid;
  v_new_is_member boolean;
begin
  select status into v_status from public.jobs where id = p_job for update;
  if v_status is null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if not public.is_active_job_status(v_status) then
    raise exception 'The lead can only be changed on a job that is in progress.'
      using errcode = 'P0001';
  end if;
  perform public.require_active_employee_profile(p_new_lead);

  select employee_id into v_old_lead
  from public.job_assignments
  where job_id = p_job and role = 'lead' and ended_at is null;

  if v_old_lead = p_new_lead then
    raise exception 'That employee is already the lead.' using errcode = 'P0001';
  end if;

  v_new_is_member := exists (
    select 1 from public.job_assignments
    where job_id = p_job and employee_id = p_new_lead and ended_at is null
  );

  if v_old_lead is not null then
    perform public.end_job_assignment(p_job, v_old_lead, 'role_changed', v_owner);
    perform public.start_job_assignment(p_job, v_old_lead, 'member', 'lead_change', v_owner);
  end if;
  if v_new_is_member then
    perform public.end_job_assignment(p_job, p_new_lead, 'role_changed', v_owner);
  end if;
  perform public.start_job_assignment(p_job, p_new_lead, 'lead', 'lead_change', v_owner);

  update public.jobs set last_activity_at = now() where id = p_job;

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (
    p_job, v_owner, 'lead_changed',
    jsonb_build_object('from_employee_id', v_old_lead, 'to_employee_id', p_new_lead)
  );
end;
$$;

-- Removes an employee from the job. Their assignment is ended, not deleted,
-- so their history stays. Removing the lead while others are on the team
-- requires naming the new lead in the same call; no one is promoted
-- automatically. Removing a lead who is alone leaves the job with no team.
create function public.remove_team_member(p_job uuid, p_employee uuid, p_new_lead uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_status public.job_status;
  v_role public.assignment_role;
  v_others integer;
begin
  select status into v_status from public.jobs where id = p_job for update;
  if v_status is null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if v_status = 'complete' then
    raise exception 'The team of a complete job can''t be changed.' using errcode = 'P0001';
  end if;

  select role into v_role
  from public.job_assignments
  where job_id = p_job and employee_id = p_employee and ended_at is null;
  if v_role is null then
    raise exception 'That employee is not on this job.' using errcode = 'P0001';
  end if;

  select count(*) into v_others
  from public.job_assignments
  where job_id = p_job and employee_id <> p_employee and ended_at is null;

  if v_role = 'member' and p_new_lead is not null then
    raise exception 'A new lead is only chosen when removing the current lead.'
      using errcode = 'P0001';
  end if;
  if v_role = 'lead' and v_others > 0 and p_new_lead is null then
    raise exception 'Choose a new lead before removing the current lead.' using errcode = 'P0001';
  end if;
  if p_new_lead = p_employee then
    raise exception 'Choose a different employee as the new lead.' using errcode = 'P0001';
  end if;

  perform public.end_job_assignment(p_job, p_employee, 'removed_by_owner', v_owner);

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (
    p_job, v_owner, 'employee_removed',
    jsonb_build_object('employee_id', p_employee, 'role', v_role)
  );

  if v_role = 'lead' and p_new_lead is not null then
    perform public.require_active_employee_profile(p_new_lead);
    if exists (
      select 1 from public.job_assignments
      where job_id = p_job and employee_id = p_new_lead and ended_at is null
    ) then
      perform public.end_job_assignment(p_job, p_new_lead, 'role_changed', v_owner);
    end if;
    perform public.start_job_assignment(p_job, p_new_lead, 'lead', 'lead_change', v_owner);

    insert into public.job_activity (job_id, actor_id, activity_type, details)
    values (
      p_job, v_owner, 'lead_changed',
      jsonb_build_object('from_employee_id', p_employee, 'to_employee_id', p_new_lead)
    );
  end if;

  update public.jobs set last_activity_at = now() where id = p_job;
end;
$$;

create function public.set_job_join_setting(p_job uuid, p_allow boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := public.require_owner();
  v_job public.jobs;
begin
  if p_allow is null then
    raise exception 'Choose on or off.' using errcode = 'P0001';
  end if;
  select * into v_job from public.jobs where id = p_job for update;
  if v_job.id is null then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if v_job.status = 'complete' then
    raise exception 'The join setting of a complete job can''t be changed.' using errcode = 'P0001';
  end if;
  if v_job.allow_employees_to_join = p_allow then
    return;
  end if;

  update public.jobs
  set allow_employees_to_join = p_allow, last_activity_at = now()
  where id = p_job;

  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (
    p_job, v_owner, 'join_setting_changed',
    jsonb_build_object('from', v_job.allow_employees_to_join, 'to', p_allow)
  );
end;
$$;

-- Returning a job to Scheduled now also requires that nobody is assigned.
create or replace function public.return_job_to_scheduled(p_job uuid)
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
  if exists (select 1 from public.job_assignments where job_id = p_job and ended_at is null) then
    raise exception 'Remove the team before returning this job to Scheduled.' using errcode = 'P0001';
  end if;

  update public.jobs
  set status = 'scheduled', made_available_at = null, last_activity_at = now()
  where id = p_job;

  insert into public.job_activity (job_id, actor_id, activity_type)
  values (p_job, v_owner, 'returned_to_scheduled');
end;
$$;

revoke execute on function public.claim_job(uuid) from public, anon;
revoke execute on function public.join_job(uuid) from public, anon;
revoke execute on function public.add_team_member(uuid, uuid) from public, anon;
revoke execute on function public.change_lead(uuid, uuid) from public, anon;
revoke execute on function public.remove_team_member(uuid, uuid, uuid) from public, anon;
revoke execute on function public.set_job_join_setting(uuid, boolean) from public, anon;
-- Callable by signed-in users; each function checks the caller's role itself.
grant execute on function public.claim_job(uuid) to authenticated;
grant execute on function public.join_job(uuid) to authenticated;
grant execute on function public.add_team_member(uuid, uuid) to authenticated;
grant execute on function public.change_lead(uuid, uuid) to authenticated;
grant execute on function public.remove_team_member(uuid, uuid, uuid) to authenticated;
grant execute on function public.set_job_join_setting(uuid, boolean) to authenticated;

-- 6. Read access ------------------------------------------------------------------

-- Active users can read team history (ids only), like the rest of a job.
alter table public.job_assignments enable row level security;

create policy "Active users read job assignments" on public.job_assignments
  for select to authenticated using ((select public.is_active_user()));

revoke all on public.job_assignments from anon, authenticated;
grant select on public.job_assignments to authenticated;

-- Current team with names, for job cards and job pages. Employees can only
-- read their own profile row, so this view (run with its owner's rights)
-- exposes just the name and active flag of people on job teams, and only to
-- active signed-in users.
create view public.job_team
with (security_barrier = true)
as
select
  a.job_id,
  a.employee_id,
  a.role,
  a.method,
  a.assigned_at,
  p.full_name,
  p.active as employee_active
from public.job_assignments a
join public.profiles p on p.id = a.employee_id
where a.ended_at is null
  and public.is_active_user();

revoke all on public.job_team from anon, authenticated;
grant select on public.job_team to authenticated;
