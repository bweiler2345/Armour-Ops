// What the step screen shows for each proof requirement: files the database
// knows about, merged with uploads running on this screen. Pure, so it can be
// tested without a browser.

import type { StepMediaItem } from "./types";

export type UploadPhase = "waiting" | "preparing" | "uploading" | "finishing" | "failed";

// An upload running (or stopped) on this screen.
export type LocalUpload = {
  key: string;
  requirementId: string;
  mediaType: "picture" | "video";
  // What is uploaded: always JPEG for pictures; MP4 or MOV for videos.
  contentType: string;
  // Set once the database approves the upload.
  mediaId: string | null;
  phase: UploadPhase;
  progress: number;
  error: string | null;
  // The prepared file, kept so Retry doesn't need it chosen again.
  file: Blob | null;
  fileName: string;
  lastModified: number | null;
  originalSize: number | null;
  durationSeconds: number | null;
  previewUrl: string | null;
};

export type UploadAction =
  | { type: "add"; upload: LocalUpload }
  | { type: "update"; key: string; changes: Partial<Omit<LocalUpload, "key">> }
  | { type: "progress"; key: string; progress: number }
  | { type: "remove"; key: string };

export function uploadsReducer(state: LocalUpload[], action: UploadAction): LocalUpload[] {
  switch (action.type) {
    case "add":
      return [...state, action.upload];
    case "update":
      return state.map((u) => (u.key === action.key ? { ...u, ...action.changes } : u));
    case "progress":
      return state.map((u) =>
        // Progress only moves forward, and only while uploading.
        u.key === action.key && u.phase === "uploading"
          ? { ...u, progress: Math.max(u.progress, Math.min(1, Math.max(0, action.progress))) }
          : u,
      );
    case "remove":
      return state.filter((u) => u.key !== action.key);
  }
}

export const isActive = (u: LocalUpload) => u.phase !== "failed";

export type ProofRow =
  | { kind: "local"; upload: LocalUpload; saved: StepMediaItem | null }
  | { kind: "uploaded"; media: StepMediaItem }
  // Started but not finished, with nothing running on this screen: after a
  // reload, a lost connection, or on a teammate's screen.
  | { kind: "interrupted"; media: StepMediaItem; resumable: boolean }
  | { kind: "failed"; media: StepMediaItem };

export function proofRows(
  requirementId: string,
  saved: readonly StepMediaItem[],
  uploads: readonly LocalUpload[],
  userId: string,
): ProofRow[] {
  const mine = uploads.filter((u) => u.requirementId === requirementId);
  const rows: ProofRow[] = [];
  for (const media of saved) {
    if (media.requirementId !== requirementId) continue;
    const local = mine.find((u) => u.mediaId === media.id);
    if (local && media.status !== "uploaded") rows.push({ kind: "local", upload: local, saved: media });
    else if (media.status === "uploaded") rows.push({ kind: "uploaded", media });
    else if (media.status === "failed") rows.push({ kind: "failed", media });
    else {
      rows.push({
        kind: "interrupted",
        media,
        // Only the uploader can continue, and only videos resume by choosing
        // the same file again (pictures are re-prepared, so they start over).
        resumable: media.mediaType === "video" && media.uploadedBy === userId,
      });
    }
  }
  for (const upload of mine) {
    if (!upload.mediaId || !saved.some((m) => m.id === upload.mediaId)) {
      rows.push({ kind: "local", upload, saved: null });
    }
  }
  return rows;
}

// Files that count toward, or block, a requirement's limit.
export function filesInUse(rows: readonly ProofRow[]) {
  return rows.filter((r) => r.kind === "uploaded" || r.kind === "interrupted" || (r.kind === "local" && isActive(r.upload)))
    .length;
}

export function canAddMore(rows: readonly ProofRow[], allowMultiple: boolean, max = 20) {
  const used = filesInUse(rows);
  return allowMultiple ? used < max : used === 0;
}

// Whether the chosen video is the same one an interrupted upload started with.
export function sameVideo(media: StepMediaItem, file: { name: string; size: number; lastModified: number }) {
  return (
    media.declaredSizeBytes === file.size &&
    (!media.fileName || media.fileName === file.name) &&
    (media.lastModified === null || media.lastModified === file.lastModified)
  );
}

export function percent(progress: number) {
  return Math.floor(Math.min(1, Math.max(0, progress)) * 100);
}
