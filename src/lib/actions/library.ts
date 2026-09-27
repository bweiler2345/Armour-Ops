"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/dal";
import { isUuid, jobErrorMessage, JOB_ERROR_MESSAGES } from "@/lib/jobs/errors";
import { definitionFromForm } from "@/lib/steps/definition";
import { createClient } from "@/lib/supabase/server";

// The owner-only Custom Step Library. Each action checks the owner here and
// the database checks again, validates the step, and keeps every version.

export type LibraryFormState = { error?: string };

function fail(action: string, error: { code?: string; message?: string } | null): LibraryFormState {
  console.error(`[library] ${action} failed`, { code: error?.code });
  return { error: jobErrorMessage(error) };
}

export async function createLibraryItem(_previous: LibraryFormState, form: FormData): Promise<LibraryFormState> {
  await requireOwner();
  const parsed = definitionFromForm(form);
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  if (!supabase) return { error: JOB_ERROR_MESSAGES.generic };
  const { data, error } = await supabase.rpc("create_library_item", { p_definition: parsed.definition });
  if (error || !data) return fail("create_library_item", error);
  revalidatePath("/owner/library");
  redirect(`/owner/library/${data}`);
}

export async function updateLibraryItem(itemId: string, _previous: LibraryFormState, form: FormData): Promise<LibraryFormState> {
  await requireOwner();
  if (!isUuid(itemId)) return { error: "That library step couldn’t be found." };
  const parsed = definitionFromForm(form);
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  if (!supabase) return { error: JOB_ERROR_MESSAGES.generic };
  const { error } = await supabase.rpc("update_library_item", { p_item: itemId, p_definition: parsed.definition });
  if (error) return fail("update_library_item", error);
  revalidatePath("/owner/library");
  revalidatePath(`/owner/library/${itemId}`);
  redirect(`/owner/library/${itemId}`);
}

export async function archiveLibraryItem(itemId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOwner();
  if (!isUuid(itemId)) return { ok: false, error: "That library step couldn’t be found." };
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  const { error } = await supabase.rpc("archive_library_item", { p_item: itemId });
  if (error) return { ok: false, error: fail("archive_library_item", error).error! };
  revalidatePath("/owner/library");
  revalidatePath(`/owner/library/${itemId}`);
  return { ok: true };
}
