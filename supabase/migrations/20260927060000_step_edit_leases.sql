-- Phase 5 fix: step edit holds become leases.
--
-- Live testing found that after the owner cleared an employee's edit hold,
-- the employee's open screen kept saving. Its 30-second renewal called
-- acquire_step_edit, which quietly created a new hold, and saves only checked
-- that the employee (not a particular session) held the step.
--
-- Now every hold is a lease with an unguessable id issued by the database.
-- Every renewal, save, completion, and release must present that exact lease.
-- Renewal can only extend a current lease; it never creates one. Only an
-- explicit acquire issues a lease, and each acquire issues a new one, so a
-- screen holding an old lease id stays locked out even if the same employee
-- later opens the step again. The one-editor rule, database times, and the
-- history entry for an owner clearing a hold are unchanged.

-- 1. Lease ids --------------------------------------------------------------------

alter table public.step_edit_holds
  add column lease_id uuid not null default gen_random_uuid();

create unique index step_edit_holds_lease_idx on public.step_edit_holds (lease_id);

-- Lease ids are secrets for the screen that holds them: signed-in users can
-- read who holds a step, but not the lease id.
revoke select on public.step_edit_holds from authenticated;
grant select (job_step_id, job_id, held_by, acquired_at, expires_at)
  on public.step_edit_holds to authenticated;

-- 2. Replace the functions that took no lease ----------------------------------------

drop function public.acquire_step_edit(uuid);
drop function public.release_step_edit(uuid);
drop function public.save_step_check(uuid, uuid, boolean);
drop function public.save_step_input(uuid, uuid, text);
drop function public.save_step_notes(uuid, text);
drop function public.complete_step(uuid, boolean);
drop function public.require_step_hold(uuid, uuid);

-- Requires the caller's exact, current lease on the step, and extends it.
-- Explains precisely why an old lease no longer works.
create function public.require_step_lease(p_step uuid, p_user uuid, p_lease uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold public.step_edit_holds;
  v_holder uuid := public.current_step_hold(p_step);
  v_expires timestamptz;
begin
  select * into v_hold from public.step_edit_holds where job_step_id = p_step for update;

  if p_lease is not null
     and v_hold.lease_id = p_lease
     and v_hold.held_by = p_user
     and v_holder = p_user
  then
    update public.step_edit_holds
    set expires_at = now() + public.step_hold_duration()
    where job_step_id = p_step
    returning expires_at into v_expires;
    return v_expires;
  end if;

  if p_lease is not null and exists (
    select 1 from public.job_activity
    where activity_type = 'step_hold_cleared'
      and details ->> 'lease_id' = p_lease::text
  ) then
    raise exception 'The owner ended your editing session. Tap “Edit this step” to start again.'
      using errcode = 'P0001';
  end if;
  if v_holder is not null and v_holder <> p_user then
    raise exception 'Someone else is editing this step right now.' using errcode = 'P0001';
  end if;
  if v_holder = p_user then
    raise exception 'This step was opened for editing on another screen. Tap “Edit this step” to continue here.'
      using errcode = 'P0001';
  end if;
  raise exception 'Your editing time on this step ran out. Tap “Edit this step” to continue.'
    using errcode = 'P0001';
end;
$$;

revoke execute on function public.require_step_lease(uuid, uuid, uuid) from public, anon, authenticated;

-- Issues a new lease to the caller. Succeeds when nobody holds the step, the
-- hold expired, the holder left the team or was deactivated, or the caller
-- already holds it (which replaces their old lease). One atomic statement, so
-- simultaneous requests cannot both win.
create function public.acquire_step_edit(p_step uuid)
returns table (lease_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_active_employee();
  v_job uuid := public.require_step_worker(p_step, v_user);
begin
  return query
  insert into public.step_edit_holds as h (job_step_id, job_id, held_by, expires_at, lease_id)
  values (p_step, v_job, v_user, now() + public.step_hold_duration(), gen_random_uuid())
  on conflict (job_step_id) do update
    set held_by = excluded.held_by,
        acquired_at = now(),
        expires_at = excluded.expires_at,
        lease_id = excluded.lease_id
    where h.held_by = excluded.held_by
       or h.expires_at <= now()
       or public.current_step_hold(h.job_step_id) is null
  returning h.lease_id, h.expires_at;

  if not found then
    raise exception 'Someone else is editing this step right now.' using errcode = 'P0001';
  end if;
end;
$$;

-- The screen's heartbeat: extends the caller's current lease. Never creates
-- or re-creates a lease.
create function public.renew_step_edit(p_step uuid, p_lease uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_active_employee();
begin
  perform public.require_step_worker(p_step, v_user);
  return public.require_step_lease(p_step, v_user, p_lease);
end;
$$;

create function public.release_step_edit(p_step uuid, p_lease uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.step_edit_holds
  where job_step_id = p_step and lease_id = p_lease and held_by = (select auth.uid());
end;
$$;

-- Owner clearing ends that exact lease and records it, so the former editor
-- learns why their session ended.
create or replace function public.clear_step_edit(p_step uuid)
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
    jsonb_build_object(
      'step_id', p_step,
      'title', v_title,
      'employee_id', v_hold.held_by,
      'lease_id', v_hold.lease_id
    )
  );
end;
$$;

create index job_activity_cleared_lease_idx
  on public.job_activity ((details ->> 'lease_id'))
  where activity_type = 'step_hold_cleared';

-- 3. Saves and completion now require the lease ---------------------------------------

create function public.save_step_check(p_step uuid, p_lease uuid, p_item uuid, p_checked boolean)
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
  perform public.require_step_lease(p_step, v_user, p_lease);
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

create function public.save_step_input(p_step uuid, p_lease uuid, p_input uuid, p_value text)
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
  perform public.require_step_lease(p_step, v_user, p_lease);
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

create function public.save_step_notes(p_step uuid, p_lease uuid, p_notes text)
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
  perform public.require_step_lease(p_step, v_user, p_lease);
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

create function public.complete_step(p_step uuid, p_lease uuid, p_confirmed boolean)
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
  perform public.require_step_lease(p_step, v_user, p_lease);
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
revoke execute on function public.renew_step_edit(uuid, uuid) from public, anon;
revoke execute on function public.release_step_edit(uuid, uuid) from public, anon;
revoke execute on function public.save_step_check(uuid, uuid, uuid, boolean) from public, anon;
revoke execute on function public.save_step_input(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.save_step_notes(uuid, uuid, text) from public, anon;
revoke execute on function public.complete_step(uuid, uuid, boolean) from public, anon;
grant execute on function public.acquire_step_edit(uuid) to authenticated;
grant execute on function public.renew_step_edit(uuid, uuid) to authenticated;
grant execute on function public.release_step_edit(uuid, uuid) to authenticated;
grant execute on function public.save_step_check(uuid, uuid, uuid, boolean) to authenticated;
grant execute on function public.save_step_input(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.save_step_notes(uuid, uuid, text) to authenticated;
grant execute on function public.complete_step(uuid, uuid, boolean) to authenticated;
