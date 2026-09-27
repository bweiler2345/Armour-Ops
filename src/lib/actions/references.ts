"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/dal";
import { isUuid, jobErrorMessage, JOB_ERROR_MESSAGES } from "@/lib/jobs/errors";
import { deleteObject, headObject, isR2Configured, presignPut } from "@/lib/media/r2";
import { checkStoredObject, LINK_SECONDS } from "@/lib/media/r2-core";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Owner-only reference pictures (guidance, never proof). Like proof uploads,
// these actions receive only small JSON descriptions and return a
// short-lived R2 link; the picture goes straight from the phone to R2. The
// server checks the stored object before the database accepts it.

export type ReferenceTarget = "workflow_step" | "library_item" | "job_step";
type Result<T = undefined> = ({ ok: true } & (T extends undefined ? object : { value: T })) | { ok: false; error: string };

const NOT_SET_UP =
  "Uploads aren’t set up yet. The owner needs to finish the Cloudflare R2 setup (docs/SUPABASE_SETUP.md, step 13).";
const TARGETS: readonly ReferenceTarget[] = ["workflow_step", "library_item", "job_step"];

// Only paths of our own pages are refreshed.
function refresh(path: string) {
  if (/^\/(owner|jobs)\/[\w/-]*$/.test(path)) revalidatePath(path);
}

function fail(action: string, error: { code?: string; message?: string } | null): { ok: false; error: string } {
  console.error(`[references] ${action} failed`, { code: error?.code });
  return { ok: false, error: jobErrorMessage(error) };
}

export async function startReferenceUpload(input: { size: number; fileName: string }): Promise<Result<{ pictureId: string; url: string }>> {
  await requireOwner();
  if (!isR2Configured() || !createAdminClient()) return { ok: false, error: NOT_SET_UP };
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  const { data, error } = await supabase.rpc("create_reference_upload", {
    p_size: Math.round(input.size),
    p_file_name: String(input.fileName ?? "").slice(0, 255),
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return fail("create_reference_upload", error);
  try {
    const url = await presignPut(row.object_key, "image/jpeg", LINK_SECONDS.putPicture);
    return { ok: true, value: { pictureId: row.picture_id, url } };
  } catch {
    return { ok: false, error: "Couldn’t reach file storage. Check your connection and try again." };
  }
}

// Checks the stored picture in R2, has the database accept it, then shows it
// on the chosen step or library item.
export async function finishReferenceUpload(input: {
  pictureId: string;
  target: ReferenceTarget;
  targetId: string;
  path: string;
}): Promise<Result> {
  const user = await requireOwner();
  if (!isUuid(input.pictureId) || !isUuid(input.targetId) || !TARGETS.includes(input.target)) {
    return { ok: false, error: JOB_ERROR_MESSAGES.notFound };
  }
  const admin = createAdminClient();
  if (!admin || !isR2Configured()) return { ok: false, error: NOT_SET_UP };

  const { data: picture } = (await admin
    .from("reference_pictures")
    .select("object_key, declared_size_bytes")
    .eq("id", input.pictureId)
    .maybeSingle()) as { data: { object_key: string; declared_size_bytes: number } | null };
  if (!picture) return { ok: false, error: "That picture wasn’t found." };

  try {
    const object = await headObject(picture.object_key);
    const problem = checkStoredObject(object, { size: Number(picture.declared_size_bytes), contentType: "image/jpeg" });
    const { data: confirmed, error } = await admin.rpc("confirm_reference_upload", {
      p_picture: input.pictureId,
      p_actor: user.id,
      p_object_key: picture.object_key,
      p_stored_size: object?.size ?? -1,
      p_stored_content_type: object?.contentType ?? "",
    });
    if (error) return fail("confirm_reference_upload", error);
    if (confirmed !== "uploaded") {
      await deleteObject(picture.object_key).catch(() => undefined);
      return { ok: false, error: `${problem ?? String(confirmed)} Try adding the picture again.` };
    }
  } catch {
    return { ok: false, error: "Couldn’t reach file storage. Check your connection and try again." };
  }

  const supabase = await createClient();
  if (!supabase) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  const { error } = await supabase.rpc("attach_reference_picture", {
    p_picture: input.pictureId,
    p_target: input.target,
    p_target_id: input.targetId,
  });
  if (error) return fail("attach_reference_picture", error);
  refresh(input.path);
  return { ok: true };
}

export async function archiveReferencePicture(linkId: string, path: string): Promise<Result> {
  await requireOwner();
  if (!isUuid(linkId)) return { ok: false, error: JOB_ERROR_MESSAGES.notFound };
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  const { error } = await supabase.rpc("archive_reference_link", { p_link: linkId });
  if (error) return fail("archive_reference_link", error);
  refresh(path);
  return { ok: true };
}

export async function moveReferencePicture(linkId: string, direction: -1 | 1, path: string): Promise<Result> {
  await requireOwner();
  if (!isUuid(linkId) || (direction !== -1 && direction !== 1)) return { ok: false, error: JOB_ERROR_MESSAGES.notFound };
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  const { error } = await supabase.rpc("move_reference_link", { p_link: linkId, p_direction: direction });
  if (error) return fail("move_reference_link", error);
  refresh(path);
  return { ok: true };
}
