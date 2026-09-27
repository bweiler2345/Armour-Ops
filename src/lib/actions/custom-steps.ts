"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/dal";
import { isUuid, jobErrorMessage, JOB_ERROR_MESSAGES } from "@/lib/jobs/errors";
import { definitionFromForm } from "@/lib/steps/definition";
import { createClient } from "@/lib/supabase/server";

// Owner-only custom steps on a job: a one-time step (optionally also saved to
// the library) or an import of a library step. The database checks the
// stage and position are safe, copies the step into the job, and records it
// in the job's history.

export type CustomStepFormState = { error?: string };

function refresh(jobId: string) {
  revalidatePath("/owner/jobs");
  revalidatePath(`/owner/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
}

export async function addCustomStep(jobId: string, _previous: CustomStepFormState, form: FormData): Promise<CustomStepFormState> {
  await requireOwner();
  const stageId = String(form.get("stageId") ?? "");
  const position = Number(form.get("position"));
  if (!isUuid(jobId) || !isUuid(stageId)) return { error: JOB_ERROR_MESSAGES.notFound };
  if (!Number.isInteger(position) || position < 1) return { error: "Choose where the step goes." };
  const supabase = await createClient();
  if (!supabase) return { error: JOB_ERROR_MESSAGES.generic };

  let error: { code?: string; message?: string } | null;
  if (form.get("source") === "library") {
    const itemId = String(form.get("libraryItemId") ?? "");
    if (!isUuid(itemId)) return { error: "Choose a library step to import." };
    ({ error } = await supabase.rpc("import_library_step", {
      p_job: jobId,
      p_stage: stageId,
      p_position: position,
      p_item: itemId,
    }));
  } else {
    const parsed = definitionFromForm(form);
    if (!parsed.ok) return { error: parsed.error };
    ({ error } = await supabase.rpc("add_custom_step", {
      p_job: jobId,
      p_stage: stageId,
      p_position: position,
      p_definition: parsed.definition,
      p_save_to_library: form.get("saveToLibrary") === "on",
    }));
  }
  if (error) {
    console.error("[custom-steps] add failed", { code: error.code });
    return { error: jobErrorMessage(error) };
  }
  refresh(jobId);
  revalidatePath("/owner/library");
  redirect(`/owner/jobs/${jobId}`);
}

export async function removeCustomStep(jobId: string, stepId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOwner();
  if (!isUuid(jobId) || !isUuid(stepId)) return { ok: false, error: JOB_ERROR_MESSAGES.notFound };
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  const { error } = await supabase.rpc("remove_custom_step", { p_step: stepId });
  if (error) {
    console.error("[custom-steps] remove failed", { code: error.code });
    return { ok: false, error: jobErrorMessage(error) };
  }
  refresh(jobId);
  return { ok: true };
}
