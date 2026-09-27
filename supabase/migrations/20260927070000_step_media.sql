-- Phase 6: picture and video proof.
--
-- Files live in a private Cloudflare R2 bucket; this database holds only
-- their records and decides who may do what. The browser uploads straight to
-- R2 with short-lived links the server signs after these functions approve
-- the upload. A file only counts as proof once the server has checked the
-- stored object in R2 and confirm_media_upload has matched it against this
-- record. complete_step requires verified proof for every requirement.
--
-- Rules:
-- - Only the active employee holding the step's current edit lease can add or
--   remove proof, on the step's draft attempt.
-- - Object keys are generated here: scoped to job, step, and attempt, with a
--   random part so they cannot be guessed.
-- - Proof on a completed attempt can never be changed or removed by anyone;
--   only the future five-year retention cleanup may mark it deleted, and only
--   after the job's media_delete_after date.
-- - Viewing is decided by authorize_media_view: the owner, or an active
--   employee currently assigned to the job.
-- - Functions that record R2 facts (multipart ids, verified sizes, view
--   authorization, cleanup) can only be called with the server's secret key.
--
-- Approved limits (docs/PRODUCT_SPEC.md, "Pictures and videos"): pictures
-- are compressed in the browser to JPEG of at most 5 MB from originals of at
-- most 25 MB; videos are MOV or MP4, at most 3 minutes and 300 MB.

-- 1. Types --------------------------------------------------------------------

create type public.step_media_status as enum ('pending', 'uploaded', 'failed', 'discarded', 'deleted');
create type public.media_upload_method as enum ('single', 'multipart');

alter type public.job_activity_type add value if not exists 'proof_uploaded';
alter type public.job_activity_type add value if not exists 'proof_removed';

-- 2. Proof records ------------------------------------------------------------------

create table public.step_media (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  job_step_id uuid not null,
  attempt_id uuid not null,
  proof_requirement_id uuid not null references public.job_step_proof_requirements (id),
  uploaded_by uuid not null references public.profiles (id),
  media_type public.proof_media_type not null,
  content_type text not null,
  object_key text not null unique,
  upload_method public.media_upload_method not null,
  r2_upload_id text,
  part_size integer,
  declared_size_bytes bigint not null,
  original_size_bytes bigint,
  duration_seconds numeric(8, 2),
  original_file_name text check (original_file_name is null or char_length(original_file_name) <= 255),
  file_last_modified bigint,
  size_bytes bigint,
  status public.step_media_status not null default 'pending',
  created_at timestamptz not null default now(),
  -- A pending upload must finish before this time or it is abandoned.
  authorization_expires_at timestamptz not null,
  uploaded_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  discarded_at timestamptz,
  discarded_by uuid references public.profiles (id),
  deleted_at timestamptz,
  foreign key (attempt_id, job_step_id) references public.step_attempts (id, job_step_id),
  foreign key (job_step_id, job_id) references public.job_steps (id, job_id),
  check (
    media_type <> 'picture'
    or (
      content_type = 'image/jpeg'
      and declared_size_bytes between 1 and 5242880
      and (original_size_bytes is null or original_size_bytes between 1 and 26214400)
      and upload_method = 'single'
      and duration_seconds is null
    )
  ),
  check (
    media_type <> 'video'
    or (
      content_type in ('video/mp4', 'video/quicktime')
      and declared_size_bytes between 1 and 314572800
      and duration_seconds between 0 and 180
      and upload_method = 'multipart'
    )
  ),
  check (upload_method <> 'multipart' or part_size between 5242880 and 104857600),
  check (status <> 'uploaded' or (uploaded_at is not null and size_bytes = declared_size_bytes)),
  check (status <> 'failed' or failed_at is not null),
  check (status <> 'discarded' or (discarded_at is not null and discarded_by is not null)),
  check (status <> 'deleted' or deleted_at is not null)
);

comment on table public.step_media is
  'Picture and video proof stored in private R2. Proof on a completed attempt never changes.';

create index step_media_attempt_idx on public.step_media (attempt_id, proof_requirement_id);
create index step_media_job_idx on public.step_media (job_id);
create index step_media_pending_idx on public.step_media (authorization_expires_at) where status = 'pending';

-- 3. Protect proof ------------------------------------------------------------------

create function public.guard_step_media()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_attempt_status public.step_attempt_status;
  v_delete_after timestamptz;
begin
  if tg_op = 'DELETE' then
    raise exception 'Proof records are part of job history and cannot be deleted.'
      using errcode = 'P0001';
  end if;

  if new.id is distinct from old.id
     or new.job_id is distinct from old.job_id
     or new.job_step_id is distinct from old.job_step_id
     or new.attempt_id is distinct from old.attempt_id
     or new.proof_requirement_id is distinct from old.proof_requirement_id
     or new.uploaded_by is distinct from old.uploaded_by
     or new.media_type is distinct from old.media_type
     or new.content_type is distinct from old.content_type
     or new.object_key is distinct from old.object_key
     or new.upload_method is distinct from old.upload_method
     or new.declared_size_bytes is distinct from old.declared_size_bytes
     or new.original_size_bytes is distinct from old.original_size_bytes
     or new.duration_seconds is distinct from old.duration_seconds
     or new.created_at is distinct from old.created_at
     or new.authorization_expires_at is distinct from old.authorization_expires_at
     or (old.r2_upload_id is not null and new.r2_upload_id is distinct from old.r2_upload_id)
  then
    raise exception 'A proof record''s details cannot change.' using errcode = 'P0001';
  end if;

  select a.status into v_attempt_status from public.step_attempts a where a.id = new.attempt_id;

  -- On a completed (or superseded) attempt, the only change ever allowed is
  -- the five-year retention cleanup marking uploaded proof deleted.
  if v_attempt_status <> 'draft' then
    select j.media_delete_after into v_delete_after from public.jobs j where j.id = new.job_id;
    if old.status = 'uploaded' and new.status = 'deleted' and new.deleted_at is not null
       and v_delete_after is not null and v_delete_after <= now()
       and new.size_bytes is not distinct from old.size_bytes
       and new.uploaded_at is not distinct from old.uploaded_at
    then
      return new;
    end if;
    raise exception 'Proof on a completed step cannot be changed or removed.' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'pending' and new.status in ('uploaded', 'failed', 'discarded'))
    or (old.status in ('uploaded', 'failed') and new.status = 'discarded')
  ) then
    raise exception 'A proof file cannot move from % to %.', old.status, new.status
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger step_media_guard
  before update or delete on public.step_media
  for each row execute function public.guard_step_media();

-- 4. Internal helpers -------------------------------------------------------------------

-- Checks an actor named by the server (which has already verified who is
-- signed in): an active employee on the job team, the step is open, and they
-- hold the exact current edit lease.
create function public.require_media_worker(p_step uuid, p_actor uuid, p_lease uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job uuid;
begin
  if not exists (
    select 1 from public.profiles where id = p_actor and active and role = 'employee'
  ) then
    raise exception 'Only an active employee can do this.' using errcode = '42501';
  end if;
  v_job := public.require_step_worker(p_step, p_actor);
  perform public.require_step_lease(p_step, p_actor, p_lease);
  return v_job;
end;
$$;

-- The pending upload a server request is about, after checking the actor may
-- still work on it.
create function public.pending_media_for(p_media uuid, p_actor uuid, p_lease uuid)
returns public.step_media
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.step_media;
begin
  select * into v_media from public.step_media where id = p_media for update;
  if v_media.id is null then
    raise exception 'That upload wasn''t found.' using errcode = 'P0002';
  end if;
  perform public.require_media_worker(v_media.job_step_id, p_actor, p_lease);
  if v_media.uploaded_by <> p_actor then
    raise exception 'Only the person who started this upload can finish it.' using errcode = '42501';
  end if;
  if v_media.status <> 'pending' then
    raise exception 'This upload is no longer in progress.' using errcode = 'P0001';
  end if;
  if v_media.authorization_expires_at <= now() then
    raise exception 'This upload''s authorization expired. Remove it and add the file again.'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.step_attempts where id = v_media.attempt_id and status = 'draft'
  ) then
    raise exception 'This step was already completed.' using errcode = 'P0001';
  end if;
  return v_media;
end;
$$;

revoke execute on function public.require_media_worker(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.pending_media_for(uuid, uuid, uuid) from public, anon, authenticated;

-- 5. Starting an upload (the signed-in employee) -----------------------------------------

-- Approves one proof file for the current editor and returns where it goes.
-- The server then signs the R2 upload link for exactly this object key.
create function public.create_media_upload(
  p_step uuid,
  p_lease uuid,
  p_requirement uuid,
  p_media_type public.proof_media_type,
  p_content_type text,
  p_size bigint,
  p_original_size bigint,
  p_duration numeric,
  p_file_name text,
  p_last_modified bigint
)
returns table (
  media_id uuid,
  object_key text,
  upload_method public.media_upload_method,
  part_size integer,
  authorization_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_active_employee();
  v_job uuid := public.require_step_worker(p_step, v_user);
  v_requirement public.job_step_proof_requirements;
  v_attempt uuid;
  v_active integer;
  v_id uuid := gen_random_uuid();
  v_ext text;
  v_key text;
begin
  perform public.require_step_lease(p_step, v_user, p_lease);

  select * into v_requirement
  from public.job_step_proof_requirements
  where id = p_requirement and job_step_id = p_step;
  if v_requirement.id is null then
    raise exception 'That proof isn''t part of this step.' using errcode = 'P0001';
  end if;
  if v_requirement.media_type <> p_media_type then
    raise exception 'This proof needs %.',
      case v_requirement.media_type when 'video' then 'a video' else 'a picture' end
      using errcode = 'P0001';
  end if;

  if p_media_type = 'picture' then
    if p_content_type <> 'image/jpeg' then
      raise exception 'Pictures must be prepared as JPEG before uploading.' using errcode = 'P0001';
    end if;
    if p_original_size is not null and p_original_size > 26214400 then
      raise exception 'That picture is larger than 25 MB. Choose a smaller picture.' using errcode = 'P0001';
    end if;
    if p_size is null or p_size < 1 or p_size > 5242880 then
      raise exception 'That picture is still larger than 5 MB after preparing it. Choose a smaller picture.'
        using errcode = 'P0001';
    end if;
    v_ext := 'jpg';
  else
    if p_content_type not in ('video/mp4', 'video/quicktime') then
      raise exception 'Videos must be MOV or MP4.' using errcode = 'P0001';
    end if;
    if p_size is null or p_size < 1 or p_size > 314572800 then
      raise exception 'That video is larger than 300 MB. Record a shorter video.' using errcode = 'P0001';
    end if;
    if p_duration is null or p_duration < 0 or p_duration > 180 then
      raise exception 'That video is longer than 3 minutes. Record a shorter video.' using errcode = 'P0001';
    end if;
    v_ext := case p_content_type when 'video/mp4' then 'mp4' else 'mov' end;
  end if;

  v_attempt := public.ensure_step_draft(p_step, v_user);

  select count(*) into v_active
  from public.step_media m
  where m.attempt_id = v_attempt and m.proof_requirement_id = p_requirement
    and (m.status = 'uploaded' or (m.status = 'pending' and m.authorization_expires_at > now()));
  if not v_requirement.allow_multiple and v_active >= 1 then
    raise exception 'This proof already has a file. Remove it before adding another.' using errcode = 'P0001';
  end if;
  if v_active >= 20 then
    raise exception 'This proof already has the most files allowed (20).' using errcode = 'P0001';
  end if;

  -- Scoped to job, step, and attempt, with 128 random bits so it can't be guessed.
  v_key := format(
    'jobs/%s/steps/%s/%s/%s-%s.%s',
    v_job, p_step, v_attempt, v_id, replace(gen_random_uuid()::text, '-', ''), v_ext
  );

  return query
  insert into public.step_media as m (
    id, job_id, job_step_id, attempt_id, proof_requirement_id, uploaded_by, media_type,
    content_type, object_key, upload_method, part_size, declared_size_bytes,
    original_size_bytes, duration_seconds, original_file_name, file_last_modified,
    authorization_expires_at
  )
  values (
    v_id, v_job, p_step, v_attempt, p_requirement, v_user, p_media_type,
    p_content_type, v_key,
    case p_media_type when 'video' then 'multipart' else 'single' end::public.media_upload_method,
    case p_media_type when 'video' then 10485760 else null end,
    p_size,
    case p_media_type when 'picture' then p_original_size else null end,
    case p_media_type when 'video' then round(p_duration, 2) else null end,
    left(nullif(btrim(coalesce(p_file_name, '')), ''), 255),
    p_last_modified,
    now() + interval '24 hours'
  )
  returning m.id, m.object_key, m.upload_method, m.part_size, m.authorization_expires_at;

  update public.jobs set last_activity_at = now() where id = v_job;
end;
$$;

-- Removes an unfinished or uploaded proof file from the draft attempt. The
-- server then deletes the R2 object or aborts the multipart upload.
create function public.discard_media(p_media uuid, p_lease uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.require_active_employee();
  v_media public.step_media;
  v_label text;
begin
  select * into v_media from public.step_media where id = p_media for update;
  if v_media.id is null then
    raise exception 'That proof file wasn''t found.' using errcode = 'P0002';
  end if;
  perform public.require_step_worker(v_media.job_step_id, v_user);
  perform public.require_step_lease(v_media.job_step_id, v_user, p_lease);
  if v_media.status = 'discarded' then
    return;
  end if;

  update public.step_media
  set status = 'discarded', discarded_at = now(), discarded_by = v_user
  where id = p_media;

  if v_media.status = 'uploaded' then
    select label into v_label from public.job_step_proof_requirements where id = v_media.proof_requirement_id;
    insert into public.job_activity (job_id, actor_id, activity_type, details)
    values (
      v_media.job_id, v_user, 'proof_removed',
      jsonb_build_object('step_id', v_media.job_step_id, 'media_id', p_media, 'proof', v_label,
                         'media_type', v_media.media_type)
    );
  end if;
  update public.jobs set last_activity_at = now() where id = v_media.job_id;
end;
$$;

revoke execute on function public.create_media_upload(uuid, uuid, uuid, public.proof_media_type, text, bigint, bigint, numeric, text, bigint) from public, anon;
revoke execute on function public.discard_media(uuid, uuid) from public, anon;
grant execute on function public.create_media_upload(uuid, uuid, uuid, public.proof_media_type, text, bigint, bigint, numeric, text, bigint) to authenticated;
grant execute on function public.discard_media(uuid, uuid) to authenticated;

-- 6. Server-only functions (secret key) ----------------------------------------------------

-- Records the R2 multipart upload the server started for a pending video.
create function public.set_media_multipart(p_media uuid, p_actor uuid, p_lease uuid, p_upload_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.step_media := public.pending_media_for(p_media, p_actor, p_lease);
begin
  if v_media.upload_method <> 'multipart' then
    raise exception 'This upload isn''t a multipart upload.' using errcode = 'P0001';
  end if;
  if v_media.r2_upload_id is not null then
    raise exception 'This upload already started.' using errcode = 'P0001';
  end if;
  if p_upload_id is null or btrim(p_upload_id) = '' then
    raise exception 'Missing upload id.' using errcode = 'P0001';
  end if;
  update public.step_media set r2_upload_id = p_upload_id where id = p_media;
end;
$$;

-- What the server needs to sign links for, resume, or finish a pending
-- upload, after checking the actor, lease, and upload are still valid.
create function public.media_upload_details(p_media uuid, p_actor uuid, p_lease uuid)
returns table (
  object_key text,
  r2_upload_id text,
  upload_method public.media_upload_method,
  content_type text,
  declared_size_bytes bigint,
  part_size integer,
  original_file_name text,
  file_last_modified bigint,
  authorization_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.step_media := public.pending_media_for(p_media, p_actor, p_lease);
begin
  return query select v_media.object_key, v_media.r2_upload_id, v_media.upload_method,
    v_media.content_type, v_media.declared_size_bytes, v_media.part_size,
    v_media.original_file_name, v_media.file_last_modified, v_media.authorization_expires_at;
end;
$$;

-- Accepts a pending upload as proof, given what the server found when it
-- checked the stored object in R2. Anything that doesn't match the record is
-- marked failed instead. Returns 'uploaded' or the reason it failed.
create function public.confirm_media_upload(
  p_media uuid,
  p_actor uuid,
  p_lease uuid,
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
  v_media public.step_media := public.pending_media_for(p_media, p_actor, p_lease);
  v_reason text;
  v_label text;
begin
  if p_object_key is distinct from v_media.object_key then
    v_reason := 'The stored file is not the one that was approved.';
  elsif p_stored_size is distinct from v_media.declared_size_bytes then
    v_reason := 'The stored file size doesn''t match the file that was approved.';
  elsif lower(split_part(coalesce(p_stored_content_type, ''), ';', 1)) is distinct from v_media.content_type then
    v_reason := 'The stored file type doesn''t match the file that was approved.';
  end if;

  if v_reason is not null then
    update public.step_media
    set status = 'failed', failed_at = now(), failure_reason = v_reason
    where id = p_media;
    return v_reason;
  end if;

  update public.step_media
  set status = 'uploaded', size_bytes = p_stored_size, uploaded_at = now()
  where id = p_media;

  select label into v_label from public.job_step_proof_requirements where id = v_media.proof_requirement_id;
  insert into public.job_activity (job_id, actor_id, activity_type, details)
  values (
    v_media.job_id, p_actor, 'proof_uploaded',
    jsonb_build_object('step_id', v_media.job_step_id, 'media_id', p_media, 'proof', v_label,
                       'media_type', v_media.media_type)
  );
  update public.jobs set last_activity_at = now() where id = v_media.job_id;
  return 'uploaded';
end;
$$;

-- Marks a pending upload failed (for example, R2 refused it or it was
-- cancelled before finishing).
create function public.fail_media_upload(p_media uuid, p_actor uuid, p_lease uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.step_media := public.pending_media_for(p_media, p_actor, p_lease);
begin
  update public.step_media
  set status = 'failed', failed_at = now(), failure_reason = left(coalesce(p_reason, 'Upload failed.'), 500)
  where id = v_media.id;
end;
$$;

-- Decides whether a signed-in user may view a proof file: the active owner,
-- or an active employee currently assigned to the job. Returns the object to
-- sign a short-lived link for, or nothing.
create function public.authorize_media_view(p_media uuid, p_actor uuid)
returns table (object_key text, content_type text, media_type public.proof_media_type)
language sql
stable
security definer
set search_path = ''
as $$
  select m.object_key, m.content_type, m.media_type
  from public.step_media m
  join public.profiles p on p.id = p_actor and p.active
  where m.id = p_media
    and m.status = 'uploaded'
    and (
      p.role = 'owner'
      or exists (
        select 1 from public.job_assignments a
        where a.job_id = m.job_id and a.employee_id = p_actor and a.ended_at is null
      )
    );
$$;

-- Pending uploads whose authorization window passed are abandoned: marks
-- them failed and returns what the server must clean up in R2. For the
-- scheduled cleanup (Phase 11); safe to run any time.
create function public.expire_abandoned_media()
returns table (media_id uuid, object_key text, r2_upload_id text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.step_media m
  set status = 'failed', failed_at = now(), failure_reason = 'Abandoned: the upload was not finished in time.'
  from public.step_attempts a
  where a.id = m.attempt_id and a.status = 'draft'
    and m.status = 'pending' and m.authorization_expires_at <= now()
  returning m.id, m.object_key, m.r2_upload_id;
end;
$$;

-- Proof files whose job's five-year retention has ended, for the scheduled
-- cleanup (Phase 11). Nothing is due until a job is complete and five years
-- have passed.
create function public.media_due_for_retention_cleanup()
returns table (media_id uuid, object_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.object_key
  from public.step_media m
  join public.jobs j on j.id = m.job_id
  where m.status = 'uploaded' and j.media_delete_after is not null and j.media_delete_after <= now();
$$;

create function public.mark_media_deleted(p_media uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.step_media
  set status = 'deleted', deleted_at = now()
  where id = p_media and status = 'uploaded';
  if not found then
    raise exception 'That proof file isn''t due for deletion.' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.set_media_multipart(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.media_upload_details(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.confirm_media_upload(uuid, uuid, uuid, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.fail_media_upload(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.authorize_media_view(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.expire_abandoned_media() from public, anon, authenticated;
revoke execute on function public.media_due_for_retention_cleanup() from public, anon, authenticated;
revoke execute on function public.mark_media_deleted(uuid) from public, anon, authenticated;
grant execute on function public.set_media_multipart(uuid, uuid, uuid, text) to service_role;
grant execute on function public.media_upload_details(uuid, uuid, uuid) to service_role;
grant execute on function public.confirm_media_upload(uuid, uuid, uuid, text, bigint, text) to service_role;
grant execute on function public.fail_media_upload(uuid, uuid, uuid, text) to service_role;
grant execute on function public.authorize_media_view(uuid, uuid) to service_role;
grant execute on function public.expire_abandoned_media() to service_role;
grant execute on function public.media_due_for_retention_cleanup() to service_role;
grant execute on function public.mark_media_deleted(uuid) to service_role;

-- 7. Completing a step now requires verified proof ---------------------------------------

create or replace function public.complete_step(p_step uuid, p_lease uuid, p_confirmed boolean)
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

  -- No upload may still be in progress.
  if exists (
    select 1 from public.step_media m
    where m.attempt_id = v_attempt and m.status = 'pending' and m.authorization_expires_at > now()
  ) then
    raise exception 'Wait for every upload to finish before completing this step.' using errcode = 'P0001';
  end if;

  -- Every proof requirement needs its minimum number of verified files.
  select r.label into v_missing
  from public.job_step_proof_requirements r
  where r.job_step_id = p_step
    and (
      select count(*) from public.step_media m
      where m.attempt_id = v_attempt and m.proof_requirement_id = r.id and m.status = 'uploaded'
    ) < r.min_count
  order by r.position
  limit 1;
  if v_missing is not null then
    raise exception 'Add the required proof first. Missing: %', v_missing using errcode = 'P0001';
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

-- 8. Read access ------------------------------------------------------------------------
--
-- Proof records are visible to the owner and to active employees currently
-- assigned to the job, never to unassigned employees. Object keys and R2
-- upload ids are not readable by signed-in users at all.

alter table public.step_media enable row level security;

create function public.can_view_job_media(p_job uuid)
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
        select 1 from public.job_assignments a
        where a.job_id = p_job and a.employee_id = (select auth.uid()) and a.ended_at is null
      )
    );
$$;

revoke execute on function public.can_view_job_media(uuid) from public, anon;
grant execute on function public.can_view_job_media(uuid) to authenticated;

create policy "Owner and assigned employees read proof records" on public.step_media
  for select to authenticated using ((select public.can_view_job_media(job_id)));

revoke all on public.step_media from anon, authenticated;
grant select (
  id, job_id, job_step_id, attempt_id, proof_requirement_id, uploaded_by, media_type,
  content_type, upload_method, part_size, declared_size_bytes, original_size_bytes,
  duration_seconds, original_file_name, file_last_modified, size_bytes, status, created_at,
  authorization_expires_at, uploaded_at, failed_at, failure_reason, discarded_at, discarded_by
) on public.step_media to authenticated;
