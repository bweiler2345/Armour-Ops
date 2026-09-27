"use server";

import { revalidatePath } from "next/cache";
import { requireOwner, requireUser } from "@/lib/dal";
import { isUuid, jobErrorMessage, JOB_ERROR_MESSAGES } from "@/lib/jobs/errors";
import { createClient } from "@/lib/supabase/server";
import { classifyLeaseError, type LeaseRefusal } from "@/lib/steps/lease";
import { getStepLive } from "@/lib/steps/queries";
import type { LiveStep } from "@/lib/steps/sync";

// Step work. Every action checks the signed-in user here and then calls a
// database function that checks the team, the step's state, and the exact
// edit lease the screen was issued, and uses the database clock. The page is
// never trusted.

export type StepResult =
  | { ok: true; expiresAt?: string; lease?: string }
  | { ok: false; reason: LeaseRefusal | "error"; error: string };

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;
type RpcError = { code?: string; message?: string } | null;

function failure(action: string, error: RpcError): StepResult {
  console.error(`[steps] ${action} failed`, { code: error?.code });
  return {
    ok: false,
    reason: classifyLeaseError(error?.message) ?? "error",
    error: jobErrorMessage(error),
  };
}

const bad = (): StepResult => ({ ok: false, reason: "error", error: JOB_ERROR_MESSAGES.generic });

async function withClient(
  ids: unknown[],
  action: string,
  run: (supabase: Supabase) => PromiseLike<{ data?: unknown; error: RpcError }>,
): Promise<StepResult> {
  if (!ids.every(isUuid)) {
    return { ok: false, reason: "error", error: JOB_ERROR_MESSAGES.notFound };
  }
  const supabase = await createClient();
  if (!supabase) return bad();
  const { data, error } = await run(supabase);
  if (error) return failure(action, error);
  return { ok: true, expiresAt: typeof data === "string" ? data : undefined };
}

// Explicitly asks the database for a new edit lease on the step.
export async function acquireStepEdit(stepId: string): Promise<StepResult> {
  await requireUser();
  if (!isUuid(stepId)) return { ok: false, reason: "error", error: JOB_ERROR_MESSAGES.notFound };
  const supabase = await createClient();
  if (!supabase) return bad();
  const { data, error } = await supabase.rpc("acquire_step_edit", { p_step: stepId });
  if (error) return failure("acquire_step_edit", error);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.lease_id) return bad();
  return { ok: true, lease: row.lease_id, expiresAt: row.expires_at };
}

// Heartbeat: extends the screen's current lease. Never creates a lease.
export async function renewStepEdit(stepId: string, lease: string): Promise<StepResult> {
  await requireUser();
  return withClient([stepId, lease], "renew_step_edit", (s) =>
    s.rpc("renew_step_edit", { p_step: stepId, p_lease: lease }),
  );
}

export async function releaseStepEdit(stepId: string, lease: string): Promise<StepResult> {
  await requireUser();
  return withClient([stepId, lease], "release_step_edit", (s) =>
    s.rpc("release_step_edit", { p_step: stepId, p_lease: lease }),
  );
}

export async function saveStepCheck(
  stepId: string,
  lease: string,
  itemId: string,
  checked: boolean,
): Promise<StepResult> {
  await requireUser();
  if (typeof checked !== "boolean") return bad();
  return withClient([stepId, lease, itemId], "save_step_check", (s) =>
    s.rpc("save_step_check", { p_step: stepId, p_lease: lease, p_item: itemId, p_checked: checked }),
  );
}

export async function saveStepInput(
  stepId: string,
  lease: string,
  inputId: string,
  value: string,
): Promise<StepResult> {
  await requireUser();
  if (typeof value !== "string") return bad();
  return withClient([stepId, lease, inputId], "save_step_input", (s) =>
    s.rpc("save_step_input", { p_step: stepId, p_lease: lease, p_input: inputId, p_value: value }),
  );
}

export async function saveStepNotes(stepId: string, lease: string, notes: string): Promise<StepResult> {
  await requireUser();
  if (typeof notes !== "string") return bad();
  return withClient([stepId, lease], "save_step_notes", (s) =>
    s.rpc("save_step_notes", { p_step: stepId, p_lease: lease, p_notes: notes }),
  );
}

export async function completeStep(
  jobId: string,
  stepId: string,
  lease: string,
  confirmed: boolean,
): Promise<StepResult> {
  await requireUser();
  const result = await withClient([jobId, stepId, lease], "complete_step", (s) =>
    s.rpc("complete_step", { p_step: stepId, p_lease: lease, p_confirmed: confirmed === true }),
  );
  if (result.ok) refresh(jobId, stepId);
  return result;
}

export async function clearStepEdit(jobId: string, stepId: string): Promise<StepResult> {
  await requireOwner();
  const result = await withClient([jobId, stepId], "clear_step_edit", (s) =>
    s.rpc("clear_step_edit", { p_step: stepId }),
  );
  if (result.ok) refresh(jobId, stepId);
  return result;
}

function refresh(jobId: string, stepId: string) {
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/steps/${stepId}`);
  revalidatePath("/owner/jobs");
  revalidatePath(`/owner/jobs/${jobId}`);
}

// The latest saved answers, hold, and state for an open step screen.
export async function loadStepLive(stepId: string): Promise<LiveStep | null> {
  await requireUser();
  return getStepLive(stepId);
}
