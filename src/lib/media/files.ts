// Checks a chosen file against the approved limits (docs/PRODUCT_SPEC.md,
// "Pictures and videos") before anything is uploaded. The database and the
// server check again.

export const PHOTO_LIMITS = {
  originalMaxBytes: 25 * 1024 * 1024,
  compressedMaxBytes: 5 * 1024 * 1024,
  // Proposed: long edge after resizing, then JPEG quality steps.
  longEdges: [2560, 2048, 1600],
  qualities: [0.82, 0.74, 0.66, 0.58, 0.5],
} as const;

export const VIDEO_LIMITS = {
  maxBytes: 300 * 1024 * 1024,
  maxSeconds: 180,
} as const;

const PHOTO_TYPES = new Set(["image/jpeg", "image/jpg", "image/pjpeg", "image/heic", "image/heif", "image/png"]);
const PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "heic", "heif", "png"]);
const VIDEO_TYPES: Record<string, "video/mp4" | "video/quicktime"> = {
  "video/mp4": "video/mp4",
  "video/quicktime": "video/quicktime",
};
const VIDEO_EXTENSIONS: Record<string, "video/mp4" | "video/quicktime"> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
};

const extension = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

export type FileCheck =
  | { ok: true; kind: "picture"; contentType: "image/jpeg" }
  | { ok: true; kind: "video"; contentType: "video/mp4" | "video/quicktime" }
  | { ok: false; error: string };

export function checkFile(
  file: { name: string; type: string; size: number },
  expected: "picture" | "video",
): FileCheck {
  const type = file.type.toLowerCase();
  const ext = extension(file.name);

  if (expected === "picture") {
    const isPhoto = PHOTO_TYPES.has(type) || (type === "" && PHOTO_EXTENSIONS.has(ext));
    if (!isPhoto) {
      return {
        ok: false,
        error: type.startsWith("video/")
          ? "This proof needs a picture, not a video."
          : "That file type isn't supported. Use a JPEG, HEIC, or PNG picture.",
      };
    }
    if (file.size <= 0) return { ok: false, error: "That picture is empty. Take it again." };
    if (file.size > PHOTO_LIMITS.originalMaxBytes) {
      return { ok: false, error: `That picture is ${formatBytes(file.size)}. Pictures can be up to 25 MB.` };
    }
    // Every picture is prepared as a JPEG before uploading.
    return { ok: true, kind: "picture", contentType: "image/jpeg" };
  }

  const contentType = VIDEO_TYPES[type] ?? (type === "" || type === "application/octet-stream" ? VIDEO_EXTENSIONS[ext] : undefined);
  if (!contentType) {
    return {
      ok: false,
      error: type.startsWith("image/")
        ? "This proof needs a video, not a picture."
        : "That video type isn't supported. Use a MOV or MP4 video.",
    };
  }
  if (file.size <= 0) return { ok: false, error: "That video is empty. Record it again." };
  if (file.size > VIDEO_LIMITS.maxBytes) {
    return { ok: false, error: `That video is ${formatBytes(file.size)}. Videos can be up to 300 MB.` };
  }
  return { ok: true, kind: "video", contentType };
}

export function checkVideoLength(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 0) return "Couldn't read how long that video is. Try recording it again.";
  if (seconds > VIDEO_LIMITS.maxSeconds) {
    return `That video is ${formatDuration(seconds)} long. Videos can be up to 3 minutes.`;
  }
  return null;
}

// Fits a picture inside a square of the given size, never enlarging it.
export function fitWithin(width: number, height: number, longEdge: number) {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

export function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
