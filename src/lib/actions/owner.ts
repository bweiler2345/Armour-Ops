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
