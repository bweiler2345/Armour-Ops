// Pure helpers for talking to Cloudflare R2's S3-compatible API. No secrets
// here; src/lib/media/r2.ts signs requests with the server-only keys.

// R2 requires every part except the last to be the same size (at least 5 MiB).
export const PART_SIZE = 10 * 1024 * 1024;

// Proposed technical defaults (docs/IMPLEMENTATION_PLAN.md).
export const LINK_SECONDS = {
  putPicture: 10 * 60,
  putPart: 60 * 60,
  viewPicture: 5 * 60,
  // Long enough to watch a 3-minute video, still short-lived.
  viewVideo: 15 * 60,
} as const;

export function objectUrl(accountId: string, bucket: string, key: string) {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `https://${accountId}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}/${path}`;
}

export function partCount(size: number, partSize = PART_SIZE) {
  return Math.max(1, Math.ceil(size / partSize));
}

export function expectedPartSize(partNumber: number, size: number, partSize = PART_SIZE) {
  const count = partCount(size, partSize);
  return partNumber < count ? partSize : size - partSize * (count - 1);
}

const tag = (xml: string, name: string) =>
  xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? null;

function unescapeXml(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function parseUploadId(xml: string) {
  const id = tag(xml, "UploadId");
  return id ? unescapeXml(id.trim()) : null;
}

export type StoredPart = { partNumber: number; etag: string; size: number };

export function parseListParts(xml: string): {
  parts: StoredPart[];
  truncated: boolean;
  nextMarker: number | null;
} {
  const parts = [...xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map((m) => ({
    partNumber: Number(tag(m[1], "PartNumber")),
    etag: unescapeXml(tag(m[1], "ETag") ?? ""),
    size: Number(tag(m[1], "Size")),
  }));
  const next = tag(xml, "NextPartNumberMarker");
  return {
    parts: parts.filter((p) => Number.isInteger(p.partNumber) && p.partNumber > 0 && p.etag),
    truncated: tag(xml, "IsTruncated")?.trim() === "true",
    nextMarker: next ? Number(next) : null,
  };
}

// Decides whether the parts R2 holds make up exactly the approved file:
// numbers 1..n with no gaps, every part the expected size, adding up to the
// declared size. The browser's own report is never trusted.
export function planCompletion(
  parts: readonly StoredPart[],
  declaredSize: number,
  partSize = PART_SIZE,
): { ok: true; parts: StoredPart[] } | { ok: false; reason: string; missing: number[] } {
  const count = partCount(declaredSize, partSize);
  const byNumber = new Map(parts.map((p) => [p.partNumber, p]));
  const missing: number[] = [];
  for (let n = 1; n <= count; n++) {
    const part = byNumber.get(n);
    if (!part || part.size !== expectedPartSize(n, declaredSize, partSize)) missing.push(n);
  }
  if (missing.length > 0) {
    return { ok: false, reason: "Some of the video hasn't finished uploading.", missing };
  }
  if ([...byNumber.keys()].some((n) => n > count)) {
    return { ok: false, reason: "The upload has more parts than the approved video.", missing: [] };
  }
  const ordered = Array.from({ length: count }, (_, i) => byNumber.get(i + 1)!);
  return { ok: true, parts: ordered };
}

export function completeMultipartXml(parts: readonly StoredPart[]) {
  const body = parts
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(p.etag)}</ETag></Part>`)
    .join("");
  return `<CompleteMultipartUpload>${body}</CompleteMultipartUpload>`;
}

// First check of the stored object before asking the database to accept it
// (the database checks again against its own record).
export function checkStoredObject(
  stored: { size: number | null; contentType: string | null } | null,
  expected: { size: number; contentType: string },
): string | null {
  if (!stored || stored.size === null) return "The uploaded file wasn't found.";
  if (stored.size !== expected.size) return "The uploaded file's size doesn't match.";
  const type = (stored.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type !== expected.contentType) return "The uploaded file's type doesn't match.";
  return null;
}
