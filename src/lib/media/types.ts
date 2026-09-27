// A proof file as the step screen sees it. Object keys and R2 upload ids are
// never included.
export type StepMediaItem = {
  id: string;
  requirementId: string;
  mediaType: "picture" | "video";
  status: "pending" | "uploaded" | "failed";
  sizeBytes: number | null;
  declaredSizeBytes: number;
  durationSeconds: number | null;
  fileName: string | null;
  lastModified: number | null;
  uploadedBy: string;
  authorizationExpiresAt: string;
  failureReason: string | null;
};

// What the browser needs to upload one file straight to R2.
export type UploadGrant =
  | { method: "single"; mediaId: string; url: string; contentType: string }
  | {
      method: "multipart";
      mediaId: string;
      partSize: number;
      // Parts still to send, each with its own short-lived link.
      parts: { partNumber: number; url: string }[];
      // Parts R2 already holds (after an interruption).
      uploadedParts: number[];
    };

import type { LeaseRefusal } from "@/lib/steps/lease";

export type MediaResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { value: T }))
  | {
      ok: false;
      error: string;
      reason?: "lease" | "expired" | "mismatch" | "setup" | "error";
      // Set when the database refused the edit lease; the screen stops editing.
      lease?: LeaseRefusal;
    };
