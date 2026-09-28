-- Phase 8 fix: show Working Owners on every job-team display.
--
-- job_working_owner_status gains the owner's active flag so a deactivated
-- owner is shown the same way as a deactivated employee ("Deactivated"),
-- following the existing account rules. Names only; never email addresses.
-- Permissions and the employee lead are unchanged.

create or replace view public.job_working_owner_status
with (security_barrier = true)
as
select w.job_id, w.owner_id, p.full_name, w.joined_at, p.active as owner_active
from public.job_working_owners w
join public.profiles p on p.id = w.owner_id
where w.left_at is null and public.is_active_user();

revoke all on public.job_working_owner_status from anon, authenticated;
grant select on public.job_working_owner_status to authenticated;
