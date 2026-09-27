"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/dal";
import { isUuid, jobErrorMessage, JOB_ERROR_MESSAGES } from "@/lib/jobs/errors";
import { createClient } from "@/lib/supabase/server";

// Owner-only installation milestones and job completion. Each checks the
// owner here, then calls a database function that checks the owner, the
// job's exact status, and every prerequisite again, locks the job so
// simultaneous requests run one at a time, and uses the database clock.
// Repeating a request that already succeeded changes nothing.

export type OwnerActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export type Milestone = "base_coat_installation" | "top_coat_installation";

const MILESTONE_DONE: Record<Milestone, { installed: string; already: string }> = {
  base_coat_installation: {
    installed: "Base Coat Installed. Top-Coat Prep is now open to the team.",
    already: "Base Coat Installed was already marked. Nothing changed.",
  },
  top_coat_installation: {
    installed: "Top Coat Installed. Completion Work is now open to the team.",
    already: "Top Coat Installed was already marked. Nothing changed.",
  },
};

function refresh(jobId: string) {
  revalidatePath("/owner");
  revalidatePath("/owner/jobs");
  revalidatePath(`/owner/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
}

export async function markMilestoneInstalled(jobId: string, milestone: Milestone): Promise<OwnerActionResult> {
  await requireOwner();
  if (!isUuid(jobId)) return { ok: false, error: JOB_ERROR_MESSAGES.notFound };
  if (milestone !== "base_coat_installation" && milestone !== "top_coat_installation") {
    return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  }
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: JOB_ERROR_MESSAGES.generic };

  const { data, error } = await supabase.rpc("mark_milestone_installed", { p_job: jobId, p_milestone: milestone });
  refresh(jobId);
  if (error) {
    console.error("[owner] mark_milestone_installed failed", { code: error.code });
    return { ok: false, error: jobErrorMessage(error) };
  }
  const done = MILESTONE_DONE[milestone];
  return { ok: true, message: data === "already_installed" ? done.already : done.installed };
}

export async function markJobComplete(jobId: string): Promise<OwnerActionResult> {
  await requireOwner();
  if (!isUuid(jobId)) return { ok: false, error: JOB_ERROR_MESSAGES.notFound };
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: JOB_ERROR_MESSAGES.generic };

  const { data, error } = await supabase.rpc("mark_job_complete", { p_job: jobId });
  refresh(jobId);
  if (error) {
    console.error("[owner] mark_job_complete failed", { code: error.code });
    return { ok: false, error: jobErrorMessage(error) };
  }
  return {
    ok: true,
    message:
      data === "already_complete"
        ? "This job was already marked Complete. Nothing changed."
        : "Job marked Complete. It’s now read only, and its pictures and videos are kept for five years.",
  };
}

// Owner/Working Member: the owner joins or leaves an active job's working
// team. The employee lead and members never change.
export async function setWorkingMembership(jobId: string, join: boolean): Promise<OwnerActionResult> {
  await requireOwner();
  if (!isUuid(jobId)) return { ok: false, error: JOB_ERROR_MESSAGES.notFound };
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  const { data, error } = join
    ? await supabase.rpc("join_job_as_working_owner", { p_job: jobId })
    : await supabase.rpc("leave_working_team", { p_job: jobId });
  refresh(jobId);
  if (error) {
    console.error("[owner] working membership failed", { code: error.code });
    return { ok: false, error: jobErrorMessage(error) };
  }
  const messages: Record<string, string> = {
    joined: "You joined the working team. You can now work steps; the lead is unchanged.",
    already_joined: "You’re already on the working team.",
    left: "You left the working team. Your recorded work stays in the job’s history.",
    not_joined: "You weren’t on the working team.",
  };
  return { ok: true, message: messages[String(data)] ?? "Done." };
}

// Reopens a completed step with a required reason. The earlier attempt and
// its proof stay unchanged; the team redoes the step as a new attempt.
export async function reopenStep(jobId: string, stepId: string, reason: string): Promise<OwnerActionResult> {
  await requireOwner();
  if (!isUuid(jobId) || !isUuid(stepId)) return { ok: false, error: JOB_ERROR_MESSAGES.notFound };
  const trimmed = String(reason ?? "").trim();
  if (!trimmed) return { ok: false, error: "Give a reason for reopening this step." };
  if (trimmed.length > 500) return { ok: false, error: "Keep the reason to 500 characters or fewer." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  const { error } = await supabase.rpc("reopen_step", { p_step: stepId, p_reason: trimmed });
  refresh(jobId);
  revalidatePath(`/jobs/${jobId}/steps/${stepId}`);
  if (error) {
    console.error("[owner] reopen_step failed", { code: error.code });
    return { ok: false, error: jobErrorMessage(error) };
  }
  return { ok: true, message: "Step reopened. The team redoes it as a new attempt; the earlier attempt is kept." };
}
