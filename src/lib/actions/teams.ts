"use server";

import { revalidatePath } from "next/cache";
import { requireOwner, requireUser } from "@/lib/dal";
import { isUuid, jobErrorMessage, JOB_ERROR_MESSAGES } from "@/lib/jobs/errors";
import { createClient } from "@/lib/supabase/server";

// Job team actions. Each checks the signed-in user here, then calls a
// database function that checks again, uses the database clock, and records
// the change in job history. Nothing here trusts the page that called it.

export type TeamActionState = { status?: "done"; message?: string; error?: string };

function refresh(jobId: string) {
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/owner/jobs");
  revalidatePath(`/owner/jobs/${jobId}`);
}

async function run(
  jobId: string,
  action: string,
  rpc: (supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>) => PromiseLike<{
    error: { code?: string; message?: string } | null;
  }>,
  success: string,
): Promise<TeamActionState> {
  if (!isUuid(jobId)) return { error: JOB_ERROR_MESSAGES.notFound };
  const supabase = await createClient();
  if (!supabase) return { error: JOB_ERROR_MESSAGES.generic };

  const { error } = await rpc(supabase);
  if (error) {
    console.error(`[teams] ${action} failed`, { code: error.code });
    return { error: jobErrorMessage(error) };
  }
  refresh(jobId);
  return { status: "done", message: success };
}

// Employees ------------------------------------------------------------------

export async function claimJob(jobId: string): Promise<TeamActionState> {
  await requireUser();
  return run(
    jobId,
    "claim_job",
    (s) => s.rpc("claim_job", { p_job: jobId }),
    "You claimed this job. You’re the lead.",
  );
}

export async function joinJob(jobId: string): Promise<TeamActionState> {
  await requireUser();
  return run(jobId, "join_job", (s) => s.rpc("join_job", { p_job: jobId }), "You joined this job.");
}

// Owner ----------------------------------------------------------------------

export async function addTeamMember(
  jobId: string,
  _previous: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  await requireOwner();
  const employeeId = formData.get("employeeId");
  if (!isUuid(employeeId)) return { error: "Choose an employee to add." };
  return run(
    jobId,
    "add_team_member",
    (s) => s.rpc("add_team_member", { p_job: jobId, p_employee: employeeId }),
    "Employee added.",
  );
}

export async function removeTeamMember(
  jobId: string,
  employeeId: string,
  newLeadId: string | null,
): Promise<TeamActionState> {
  await requireOwner();
  if (!isUuid(employeeId)) return { error: JOB_ERROR_MESSAGES.generic };
  if (newLeadId !== null && !isUuid(newLeadId)) return { error: "Choose the new lead." };
  return run(
    jobId,
    "remove_team_member",
    (s) =>
      s.rpc("remove_team_member", {
        p_job: jobId,
        p_employee: employeeId,
        p_new_lead: newLeadId,
      }),
    newLeadId ? "Employee removed and new lead set." : "Employee removed.",
  );
}

export async function changeLead(jobId: string, employeeId: string): Promise<TeamActionState> {
  await requireOwner();
  if (!isUuid(employeeId)) return { error: JOB_ERROR_MESSAGES.generic };
  return run(
    jobId,
    "change_lead",
    (s) => s.rpc("change_lead", { p_job: jobId, p_new_lead: employeeId }),
    "Lead changed.",
  );
}

export async function setJoinSetting(jobId: string, allow: boolean): Promise<TeamActionState> {
  await requireOwner();
  if (typeof allow !== "boolean") return { error: JOB_ERROR_MESSAGES.generic };
  return run(
    jobId,
    "set_job_join_setting",
    (s) => s.rpc("set_job_join_setting", { p_job: jobId, p_allow: allow }),
    allow ? "Employees can now join this job." : "Joining is now off for this job.",
  );
}
