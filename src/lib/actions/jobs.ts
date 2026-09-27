"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/dal";
import { isUuid, jobErrorMessage, JOB_ERROR_MESSAGES } from "@/lib/jobs/errors";
import {
  validateJobForm,
  type JobFieldErrors,
  type JobFormValues,
} from "@/lib/jobs/validation";
import { createClient } from "@/lib/supabase/server";

// Owner-only job actions. Each calls requireOwner() and then a database
// function that checks the owner role again and does all its writes in one
// transaction. Employees have no write path to jobs.

export type JobFormState = {
  values?: JobFormValues;
  fieldErrors?: JobFieldErrors;
  error?: string;
};

export type JobStatusState = { error?: string };

function logFailure(action: string, error: { code?: string } | null) {
  console.error(`[jobs] ${action} failed`, { code: error?.code });
}

export async function createJob(
  _previous: JobFormState,
  formData: FormData,
): Promise<JobFormState> {
  await requireOwner();
  const input = validateJobForm(formData);
  if (!input.ok) return { values: input.values, fieldErrors: input.fieldErrors };

  const v = input.values;
  const formValues = { ...v, squareFeet: String(v.squareFeet) };
  const supabase = await createClient();
  if (!supabase) return { values: formValues, error: JOB_ERROR_MESSAGES.generic };

  const { data: jobId, error } = await supabase.rpc("create_job", {
    p_client_name: v.clientName,
    p_address: v.address,
    p_square_feet: v.squareFeet,
    p_flake_color: v.flakeColor,
    p_scheduled_date: v.scheduledDate,
    p_general_notes: v.notes,
    p_caulking_required: v.caulkingRequired,
    p_baseboard_required: v.baseboardRequired,
    p_allow_employees_to_join: v.allowEmployeesToJoin,
  });
  if (error || !jobId) {
    logFailure("create_job", error);
    return { values: formValues, error: jobErrorMessage(error) };
  }

  revalidatePath("/owner/jobs");
  revalidatePath("/jobs");
  redirect(`/owner/jobs/${jobId}`);
}

export async function updateJob(
  jobId: string,
  _previous: JobFormState,
  formData: FormData,
): Promise<JobFormState> {
  await requireOwner();
  if (!isUuid(jobId)) return { error: JOB_ERROR_MESSAGES.notFound };

  const input = validateJobForm(formData);
  if (!input.ok) return { values: input.values, fieldErrors: input.fieldErrors };

  const supabase = await createClient();
  const v = input.values;
  const formValues = { ...v, squareFeet: String(v.squareFeet) };
  if (!supabase) return { values: formValues, error: JOB_ERROR_MESSAGES.generic };

  const { error } = await supabase.rpc("update_job_details", {
    p_job: jobId,
    p_client_name: v.clientName,
    p_address: v.address,
    p_square_feet: v.squareFeet,
    p_flake_color: v.flakeColor,
    p_scheduled_date: v.scheduledDate,
    p_general_notes: v.notes,
    p_caulking_required: v.caulkingRequired,
    p_baseboard_required: v.baseboardRequired,
    p_allow_employees_to_join: v.allowEmployeesToJoin,
  });
  if (error) {
    logFailure("update_job_details", error);
    return { values: formValues, error: jobErrorMessage(error) };
  }

  revalidatePath(`/owner/jobs/${jobId}`);
  revalidatePath("/owner/jobs");
  revalidatePath("/jobs");
  redirect(`/owner/jobs/${jobId}`);
}

export async function changeJobStatus(
  jobId: string,
  change: "make_available" | "return_to_scheduled",
): Promise<JobStatusState> {
  await requireOwner();
  if (!isUuid(jobId)) return { error: JOB_ERROR_MESSAGES.notFound };
  if (change !== "make_available" && change !== "return_to_scheduled") {
    return { error: JOB_ERROR_MESSAGES.generic };
  }

  const supabase = await createClient();
  if (!supabase) return { error: JOB_ERROR_MESSAGES.generic };

  const { error } =
    change === "make_available"
      ? await supabase.rpc("make_job_available", { p_job: jobId })
      : await supabase.rpc("return_job_to_scheduled", { p_job: jobId });
  if (error) {
    logFailure(change, error);
    return { error: jobErrorMessage(error) };
  }

  revalidatePath(`/owner/jobs/${jobId}`);
  revalidatePath("/owner/jobs");
  revalidatePath("/jobs");
  return {};
}
