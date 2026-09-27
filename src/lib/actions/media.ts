"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/dal";
import { isUuid, jobErrorMessage, JOB_ERROR_MESSAGES } from "@/lib/jobs/errors";
import {
  abortMultipartUpload,
  createMultipartUpload,
  deleteObject,
  headObject,
  isR2Configured,
  listParts,
  presignPart,
  presignPut,
  completeMultipartUpload,
} from "@/lib/media/r2";
import {
  checkStoredObject,
  LINK_SECONDS,
  partCount,
  planCompletion,
} from "@/lib/media/r2-core";
import type { MediaResult, UploadGrant } from "@/lib/media/types";
import { classifyLeaseError } from "@/lib/steps/lease";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Photo and video proof. These actions only ever receive small JSON
// descriptions of a file (type, size, duration, name) and return short-lived
// R2 links; file contents go straight from the browser to R2 and never pass
// through a Server Action or the Worker.
//
// Every action checks the signed-in user here, then the database checks the
// team, the step, and the exact edit lease. Recording R2 facts (upload ids,
// verified sizes) uses server-only database functions with the secret key,
// after the server has checked the object in R2 itself.

const NOT_SET_UP =
  "Uploads aren’t set up yet. The owner needs to finish the Cloudflare R2 setup (docs/SUPABASE_SETUP.md, step 13).";

type Rpc = { data: unknown; error: { code?: string; message?: string } | null };

function fail(action: string, error: { code?: string; message?: string } | null): MediaResult<never> {
  console.error(`[media] ${action} failed`, { code: error?.code });
  const lease = classifyLeaseError(error?.message);
  const message = jobErrorMessage(error);
  return {
    ok: false,
    error: message,
    reason: lease ? "lease" : error?.message?.includes("authorization expired") ? "expired" : "error",
    ...(lease ? { lease } : {}),
  };
}

function r2Failure(action: string, error: unknown): MediaResult<never> {
  console.error(`[media] ${action} R2 error`, { message: error instanceof Error ? error.message : "unknown" });
  return { ok: false, error: "Couldn’t reach file storage. Check your connection and try again.", reason: "error" };
}

type StartInput = {
  stepId: string;
  lease: string;
  requirementId: string;
  mediaType: "picture" | "video";
  contentType: string;
  size: number;
  originalSize: number | null;
  durationSeconds: number | null;
  fileName: string;
  lastModified: number | null;
};

type Details = {
  object_key: string;
  r2_upload_id: string | null;
  upload_method: "single" | "multipart";
  content_type: string;
  declared_size_bytes: number;
  part_size: number | null;
  original_file_name: string | null;
  file_last_modified: number | null;
};

// The pending upload, after the database re-checks the user, lease, and upload.
async function details(mediaId: string, userId: string, lease: string) {
  const admin = createAdminClient();
  if (!admin) return { error: { message: NOT_SET_UP } } as const;
  const { data, error } = (await admin.rpc("media_upload_details", {
    p_media: mediaId,
    p_actor: userId,
    p_lease: lease,
  })) as Rpc;
  if (error) return { error } as const;
  const row = (Array.isArray(data) ? data[0] : null) as Details | null;
  if (!row) return { error: { message: JOB_ERROR_MESSAGES.notFound } } as const;
  return { admin, row } as const;
}

async function partLinks(key: string, uploadId: string, size: number, partSize: number, skip: Set<number>) {
  const links: { partNumber: number; url: string }[] = [];
  for (let n = 1; n <= partCount(size, partSize); n++) {
    if (!skip.has(n)) links.push({ partNumber: n, url: await presignPart(key, uploadId, n, LINK_SECONDS.putPart) });
  }
  return links;
}

// Approves one file and returns links to upload it straight to R2.
export async function startMediaUpload(input: StartInput): Promise<MediaResult<UploadGrant>> {
  const user = await requireUser();
  if (!isR2Configured() || !createAdminClient()) return { ok: false, error: NOT_SET_UP, reason: "setup" };
  if (![input.stepId, input.lease, input.requirementId].every(isUuid)) {
    return { ok: false, error: JOB_ERROR_MESSAGES.notFound };
  }
  if (input.mediaType !== "picture" && input.mediaType !== "video") {
    return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  }

  const supabase = await createClient();
  if (!supabase) return { ok: false, error: JOB_ERROR_MESSAGES.generic };
  const { data, error } = (await supabase.rpc("create_media_upload", {
    p_step: input.stepId,
    p_lease: input.lease,
    p_requirement: input.requirementId,
    p_media_type: input.mediaType,
    p_content_type: input.contentType,
    p_size: Math.round(input.size),
    p_original_size: input.originalSize === null ? null : Math.round(input.originalSize),
    p_duration: input.durationSeconds,
    p_file_name: String(input.fileName ?? "").slice(0, 255),
    p_last_modified: input.lastModified,
  })) as Rpc;
  if (error) return fail("create_media_upload", error);
  const approved = (Array.isArray(data) ? data[0] : null) as {
    media_id: string;
    object_key: string;
    upload_method: "single" | "multipart";
    part_size: number | null;
  } | null;
  if (!approved) return { ok: false, error: JOB_ERROR_MESSAGES.generic };

  const admin = createAdminClient()!;
  try {
    if (approved.upload_method === "single") {
      const url = await presignPut(approved.object_key, input.contentType, LINK_SECONDS.putPicture);
      return {
        ok: true,
        value: { method: "single", mediaId: approved.media_id, url, contentType: input.contentType },
      };
    }

    const uploadId = await createMultipartUpload(approved.object_key, input.contentType);
    const recorded = (await admin.rpc("set_media_multipart", {
      p_media: approved.media_id,
      p_actor: user.id,
      p_lease: input.lease,
      p_upload_id: uploadId,
    })) as Rpc;
    if (recorded.error) {
      await abortMultipartUpload(approved.object_key, uploadId).catch(() => undefined);
      return fail("set_media_multipart", recorded.error);
    }
    const partSize = approved.part_size ?? 0;
    return {
      ok: true,
      value: {
        method: "multipart",
        mediaId: approved.media_id,
        partSize,
        parts: await partLinks(approved.object_key, uploadId, input.size, partSize, new Set()),
        uploadedParts: [],
      },
    };
  } catch (err) {
    await admin
      .rpc("fail_media_upload", {
        p_media: approved.media_id,
        p_actor: user.id,
        p_lease: input.lease,
        p_reason: "File storage couldn’t start the upload.",
      })
      .then(() => undefined, () => undefined);
    return r2Failure("start", err);
  }
}

// After an interruption, a reload, or an expired link: returns fresh links for
// whatever R2 doesn't have yet. For videos the employee chooses the same file
// again; it must match the approved size (and name, when known).
export async function resumeMediaUpload(input: {
  mediaId: string;
  lease: string;
  size: number;
  fileName: string;
  lastModified: number | null;
}): Promise<MediaResult<UploadGrant>> {
  const user = await requireUser();
  if (!isR2Configured()) return { ok: false, error: NOT_SET_UP, reason: "setup" };
  if (!isUuid(input.mediaId) || !isUuid(input.lease)) return { ok: false, error: JOB_ERROR_MESSAGES.notFound };

  const found = await details(input.mediaId, user.id, input.lease);
  if ("error" in found) return fail("media_upload_details", found.error ?? null);
  const { row } = found;

  const sameFile =
    Number(row.declared_size_bytes) === input.size &&
    (!row.original_file_name || row.original_file_name === input.fileName) &&
    (row.file_last_modified === null || input.lastModified === null || Number(row.file_last_modified) === input.lastModified);
  if (row.upload_method === "multipart" && !sameFile) {
    return {
      ok: false,
      error: "That’s a different file. Choose the same video to continue, or remove this upload and start again.",
      reason: "mismatch",
    };
  }

  try {
    if (row.upload_method === "single") {
      const url = await presignPut(row.object_key, row.content_type, LINK_SECONDS.putPicture);
      return { ok: true, value: { method: "single", mediaId: input.mediaId, url, contentType: row.content_type } };
    }
    if (!row.r2_upload_id) return { ok: false, error: "This upload never started. Remove it and add the video again." };
    const stored = (await listParts(row.object_key, row.r2_upload_id)) ?? [];
    const partSize = Number(row.part_size);
    const size = Number(row.declared_size_bytes);
    const done = new Set(
      stored.filter((p) => p.size === Math.min(partSize, size - partSize * (p.partNumber - 1))).map((p) => p.partNumber),
    );
    return {
      ok: true,
      value: {
        method: "multipart",
        mediaId: input.mediaId,
        partSize,
        parts: await partLinks(row.object_key, row.r2_upload_id, size, partSize, done),
        uploadedParts: [...done].sort((a, b) => a - b),
      },
    };
  } catch (err) {
    return r2Failure("resume", err);
  }
}

// Checks the stored object in R2 and, if it matches exactly, has the
// database accept it as proof.
export async function finishMediaUpload(input: {
  jobId: string;
  stepId: string;
  mediaId: string;
  lease: string;
}): Promise<MediaResult> {
  const user = await requireUser();
  if (!isR2Configured()) return { ok: false, error: NOT_SET_UP, reason: "setup" };
  if (![input.jobId, input.stepId, input.mediaId, input.lease].every(isUuid)) {
    return { ok: false, error: JOB_ERROR_MESSAGES.notFound };
  }

  const found = await details(input.mediaId, user.id, input.lease);
  if ("error" in found) return fail("media_upload_details", found.error ?? null);
  const { admin, row } = found;
  const size = Number(row.declared_size_bytes);

  try {
    if (row.upload_method === "multipart") {
      if (!row.r2_upload_id) return { ok: false, error: "This upload never started. Remove it and add the video again." };
      const stored = await listParts(row.object_key, row.r2_upload_id);
      if (stored === null) {
        // Already completed on an earlier try; fall through to the check below.
      } else {
        const plan = planCompletion(stored, size, Number(row.part_size));
        if (!plan.ok) return { ok: false, error: `${plan.reason} Tap Retry to continue.`, reason: "error" };
        await completeMultipartUpload(row.object_key, row.r2_upload_id, plan.parts);
      }
    }

    const object = await headObject(row.object_key);
    const problem = checkStoredObject(object, { size, contentType: row.content_type });
    const confirmed = (await admin.rpc("confirm_media_upload", {
      p_media: input.mediaId,
      p_actor: user.id,
      p_lease: input.lease,
      p_object_key: row.object_key,
      p_stored_size: object?.size ?? -1,
      p_stored_content_type: object?.contentType ?? "",
    })) as Rpc;
    if (confirmed.error) return fail("confirm_media_upload", confirmed.error);

    if (confirmed.data !== "uploaded") {
      // The database marked it failed; remove the wrong object from storage.
      await deleteObject(row.object_key).catch(() => undefined);
      return {
        ok: false,
        error: `${problem ?? String(confirmed.data)} Remove it and try again.`,
        reason: "mismatch",
      };
    }
  } catch (err) {
    return r2Failure("finish", err);
  }

  revalidatePath(`/jobs/${input.jobId}/steps/${input.stepId}`);
  return { ok: true };
}

// Removes a proof file from the draft attempt (also used to cancel an upload
// in progress), then deletes the object or aborts the upload in R2.
export async function removeMedia(input: {
  jobId: string;
  stepId: string;
  mediaId: string;
  lease: string;
}): Promise<MediaResult> {
  await requireUser();
  if (![input.jobId, input.stepId, input.mediaId, input.lease].every(isUuid)) {
    return { ok: false, error: JOB_ERROR_MESSAGES.notFound };
  }
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: JOB_ERROR_MESSAGES.generic };

  const { error } = (await supabase.rpc("discard_media", {
    p_media: input.mediaId,
    p_lease: input.lease,
  })) as Rpc;
  if (error) return fail("discard_media", error);

  // Storage cleanup is best effort: the record is already discarded, and the
  // R2 lifecycle rule removes unfinished multipart uploads.
  const admin = createAdminClient();
  if (admin && isR2Configured()) {
    const { data } = (await admin
      .from("step_media")
      .select("object_key, r2_upload_id")
      .eq("id", input.mediaId)
      .maybeSingle()) as { data: { object_key: string; r2_upload_id: string | null } | null };
    if (data) {
      if (data.r2_upload_id) await abortMultipartUpload(data.object_key, data.r2_upload_id).catch(() => undefined);
      await deleteObject(data.object_key).catch(() => undefined);
    }
  }

  revalidatePath(`/jobs/${input.jobId}/steps/${input.stepId}`);
  return { ok: true };
}
