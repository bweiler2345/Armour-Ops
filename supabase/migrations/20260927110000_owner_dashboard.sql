-- Phase 9: Owner Dashboard and job monitoring.
--
-- Two owner-only reads, aggregated in the database so the dashboard makes one
-- round trip for everything it shows:
--
--   owner_dashboard()        one row per job: details, progress, current stage
--                            and step (with a link target), team (lead,
--                            members, Working Owners), last activity and who
--                            did it, the current editor and lease expiry, and
--                            unfinished or failed uploads on work in progress.
--   owner_recent_activity()  the newest job history entries across all jobs,
--                            with names for the people involved.
--
-- Both require an active owner. They return names only (never email
-- addresses, object keys, or links to files) and database timestamps.
-- Nothing is written. Employee visibility and permissions are unchanged.

create index if not exists job_activity_recent_idx
  on public.job_activity (created_at desc, id desc);

create function public.owner_dashboard()
returns table (
  job_id uuid,
  job_number integer,
  client_name text,
  address text,
  square_feet integer,
  flake_color text,
  scheduled_date date,
  status public.job_status,
  last_activity_at timestamptz,
  completed_at timestamptz,
  total_units integer,
  completed_units integer,
  current_stage_name text,
  current_step_title text,
  ready_for_owner_completion boolean,
  reopened_step_title text,
  current_step_id uuid,
  team jsonb,
  working_owners jsonb,
  last_activity_type public.job_activity_type,
  last_activity_actor text,
  last_activity_title text,
  last_activity_time timestamptz,
  editor_name text,
  editor_step_title text,
  editor_expires_at timestamptz,
  unfinished_uploads integer,
  failed_uploads integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_owner();
  return query
  select
    j.id, j.job_number, j.client_name, j.address, j.square_feet, j.flake_color, j.scheduled_date,
    j.status, j.last_activity_at, j.completed_at,
    p.total_units, p.completed_units, p.current_stage_name, p.current_step_title,
    p.ready_for_owner_completion, p.reopened_step_title,
    -- The step the team works next (a reopened step comes first). None while
    -- the job waits for the owner or isn't being worked.
    case when public.is_active_job_status(j.status) then (
      select s.id
      from public.job_steps s
      join public.job_stages st on st.id = s.job_stage_id
      where s.job_id = j.id and public.job_step_state(s.id) in ('available', 'in_progress')
      order by
        exists (select 1 from public.step_attempts a where a.job_step_id = s.id and a.status = 'superseded') desc,
        st.position, s.position
      limit 1
    ) end,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', a.employee_id, 'name', pr.full_name, 'role', a.role, 'active', pr.active)
        order by a.role, pr.full_name
      )
      from public.job_assignments a
      join public.profiles pr on pr.id = a.employee_id
      where a.job_id = j.id and a.ended_at is null
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object('id', w.owner_id, 'name', pr.full_name, 'active', pr.active) order by pr.full_name)
      from public.job_working_owners w
      join public.profiles pr on pr.id = w.owner_id
      where w.job_id = j.id and w.left_at is null
    ), '[]'::jsonb),
    last.activity_type, last.actor_name, last.title, last.created_at,
    editor.full_name, editor.title, editor.expires_at,
    coalesce(uploads.unfinished, 0), coalesce(uploads.failed, 0)
  from public.jobs j
  join public.job_progress p on p.job_id = j.id
  left join lateral (
    select a.activity_type, a.created_at, pr.full_name as actor_name, a.details ->> 'title' as title
    from public.job_activity a
    left join public.profiles pr on pr.id = a.actor_id
    where a.job_id = j.id
    order by a.created_at desc, a.id desc
    limit 1
  ) last on true
  left join lateral (
    select pr.full_name, s.title, h.expires_at
    from public.step_edit_holds h
    join public.job_steps s on s.id = h.job_step_id
    join public.profiles pr on pr.id = h.held_by
    where h.job_id = j.id and h.expires_at > now()
      and public.current_step_hold(h.job_step_id) = h.held_by
    order by h.expires_at desc
    limit 1
  ) editor on true
  left join lateral (
    -- Uploads on work in progress (draft attempts): still going, or stopped
    -- (failed, or never finished before their authorization ran out).
    select
      count(*) filter (where m.status = 'pending' and m.authorization_expires_at > now())::integer as unfinished,
      count(*) filter (where m.status = 'failed' or (m.status = 'pending' and m.authorization_expires_at <= now()))::integer as failed
    from public.step_media m
    join public.step_attempts at on at.id = m.attempt_id and at.status = 'draft'
    where m.job_id = j.id
  ) uploads on true;
end;
$$;

create function public.owner_recent_activity(p_limit integer default 30)
returns table (
  id bigint,
  job_id uuid,
  job_number integer,
  client_name text,
  activity_type public.job_activity_type,
  actor_name text,
  details jsonb,
  names jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_owner();
  return query
  select a.id, a.job_id, j.job_number, j.client_name, a.activity_type, actor.full_name, a.details,
    coalesce((
      select jsonb_object_agg(pr.id, pr.full_name)
      from public.profiles pr
      where pr.id::text in (
        a.details ->> 'employee_id', a.details ->> 'from_employee_id', a.details ->> 'to_employee_id'
      )
    ), '{}'::jsonb),
    a.created_at
  from public.job_activity a
  join public.jobs j on j.id = a.job_id
  left join public.profiles actor on actor.id = a.actor_id
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

revoke execute on function public.owner_dashboard() from public, anon;
revoke execute on function public.owner_recent_activity(integer) from public, anon;
grant execute on function public.owner_dashboard() to authenticated;
grant execute on function public.owner_recent_activity(integer) to authenticated;
