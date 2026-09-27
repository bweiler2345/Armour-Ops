"use server";

import { revalidatePath } from "next/cache";
import { requireOwner, requireUser } from "@/lib/dal";
import { isUuid, jobErrorMessage, JOB_ERROR_MESSAGES } from "@/lib/jobs/errors";
import { createClient } from "@/lib/supabase/server";
import { getStepLive } from "@/lib/steps/queries";
import type { LiveStep } from "@/lib/steps/sync";

// Step work. Every action checks the signed-in user here and then calls a
// database function that checks the team, the step's state, and the edit
// hold again, and uses the database clock. The page is never trusted.

export type StepResult =
  | { ok: true; expiresAt?: string }
  | { ok: false; reason: "conflict" | "expired" | "error"; error: string };

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;
type RpcError = { code?: string; message?: string } | null;

function failure(action: string, error: RpcError): StepResult {
  console.error(`[steps] ${action} failed`, { code: error?.code });
  const message = jobErrorMessage(error);
  if (error?.message?.includes("Someone else is editing")) {
    return { ok: false, reason: "conflict", error: message };
  }
  if (error?.message?.includes("editing time on this step ran out")) {
    return { ok: false, reason: "expired", error: message };
  }
  return { ok: false, reason: "error", error: message };
}

async function withClient(
  ids: unknown[],
  action: string,
  run: (supabase: Supabase) => PromiseLike<{ data?: unknown; error: RpcError }>,
): Promise<StepResult> {
  if (!ids.every(isUuid)) {
    return { ok: false, reason: "error", error: JOB_ERROR_MESSAGES.notFound };
  }
  const supabase = await createClient();
  if (!supabase) return { ok: false, reason: "error", error: JOB_ERROR_MESSAGES.generic };
  const { data, error } = await run(supabase);
  if (error) return failure(action, error);
  return { ok: true, expiresAt: typeof data === "string" ? data : undefined };
}

export async function acquireStepEdit(stepId: string): Promise<StepResult> {
  await requireUser();
  return withClient([stepId], "acquire_step_edit", (s) =>
    s.rpc("acquire_step_edit", { p_step: stepId }),
  );
}

export async function releaseStepEdit(stepId: string): Promise<StepResult> {
  await requireUser();
  return withClient([stepId], "release_step_edit", (s) =>
    s.rpc("release_step_edit", { p_step: stepId }),
  );
}

export async function saveStepCheck(
  stepId: string,
  itemId: string,
  checked: boolean,
): Promise<StepResult> {
  await requireUser();
  if (typeof checked !== "boolean") return { ok: false, reason: "error", error: JOB_ERROR_MESSAGES.generic };
  return withClient([stepId, itemId], "save_step_check", (s) =>
    s.rpc("save_step_check", { p_step: stepId, p_item: itemId, p_checked: checked }),
  );
}

export async function saveStepInput(
  stepId: string,
  inputId: string,
  value: string,
): Promise<StepResult> {
  await requireUser();
  if (typeof value !== "string") return { ok: false, reason: "error", error: JOB_ERROR_MESSAGES.generic };
  return withClient([stepId, inputId], "save_step_input", (s) =>
    s.rpc("save_step_input", { p_step: stepId, p_input: inputId, p_value: value }),
  );
}

export async function saveStepNotes(stepId: string, notes: string): Promise<StepResult> {
  await requireUser();
  if (typeof notes !== "string") return { ok: false, reason: "error", error: JOB_ERROR_MESSAGES.generic };
  return withClient([stepId], "save_step_notes", (s) =>
    s.rpc("save_step_notes", { p_step: stepId, p_notes: notes }),
  );
}

export async function completeStep(
  jobId: string,
  stepId: string,
  confirmed: boolean,
): Promise<StepResult> {
  await requireUser();
  const result = await withClient([jobId, stepId], "complete_step", (s) =>
    s.rpc("complete_step", { p_step: stepId, p_confirmed: confirmed === true }),
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
