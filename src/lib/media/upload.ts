// Sends a prepared file straight from the browser to R2 using the
// short-lived links the server issued. Nothing here knows any storage
// credentials; it only follows the links.

import type { UploadGrant } from "./types";

export type UploadFailure = "canceled" | "offline" | "expired" | "rejected";

export class UploadError extends Error {
  constructor(readonly kind: UploadFailure) {
    super(kind);
  }
}

export const UPLOAD_MESSAGES: Record<Exclude<UploadFailure, "canceled">, string> = {
  offline: "Lost connection. Your checklist work is saved. Tap Retry when you have signal.",
  expired: "The upload permission ran out. Tap Retry to continue.",
  rejected: "File storage didn’t accept the upload. Tap Retry, or remove it and try again.",
};

export type Sender = (
  url: string,
  body: Blob,
  options: { contentType?: string; onProgress: (sentBytes: number) => void; signal: AbortSignal },
) => Promise<void>;

// One PUT with upload progress (fetch can't report upload progress).
export const xhrSender: Sender = (url, body, { contentType, onProgress, signal }) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new UploadError("canceled"));
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    if (contentType) xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new UploadError(xhr.status === 403 ? "expired" : "rejected"));
    };
    xhr.onerror = () => reject(new UploadError("offline"));
    xhr.ontimeout = () => reject(new UploadError("offline"));
    xhr.onabort = () => reject(new UploadError("canceled"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new UploadError("canceled"));
      },
      { once: true },
    );
  });

// Uploads everything the grant asks for. Reports overall progress from 0 to
// 1, counting parts R2 already holds. A dropped connection is retried a few
// times per part; an expired link stops so the caller can get fresh links.
export async function sendGrant(
  grant: UploadGrant,
  file: Blob,
  {
    onProgress,
    signal,
    send = xhrSender,
    retries = 3,
    retryDelayMs = 1500,
  }: {
    onProgress: (fraction: number) => void;
    signal: AbortSignal;
    send?: Sender;
    retries?: number;
    retryDelayMs?: number;
  },
) {
  const total = Math.max(1, file.size);
  const report = (bytes: number) => onProgress(Math.min(1, bytes / total));

  const attempt = async (run: () => Promise<void>) => {
    for (let tries = 0; ; tries++) {
      if (signal.aborted) throw new UploadError("canceled");
      try {
        return await run();
      } catch (error) {
        const kind = error instanceof UploadError ? error.kind : "rejected";
        if (kind !== "offline" || tries >= retries) throw error instanceof UploadError ? error : new UploadError(kind);
        await pause(retryDelayMs * (tries + 1), signal);
      }
    }
  };

  if (grant.method === "single") {
    report(0);
    await attempt(() => send(grant.url, file, { contentType: grant.contentType, onProgress: report, signal }));
    report(total);
    return;
  }

  const partBytes = (n: number) => Math.max(0, Math.min(grant.partSize, file.size - grant.partSize * (n - 1)));
  let done = grant.uploadedParts.reduce((sum, n) => sum + partBytes(n), 0);
  report(done);
  for (const part of [...grant.parts].sort((a, b) => a.partNumber - b.partNumber)) {
    const start = grant.partSize * (part.partNumber - 1);
    const body = file.slice(start, start + partBytes(part.partNumber));
    await attempt(() => send(part.url, body, { onProgress: (sent) => report(done + sent), signal }));
    done += body.size;
    report(done);
  }
}
