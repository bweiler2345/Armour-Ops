import { describe, expect, it } from "vitest";
import type { UploadGrant } from "./types";
import { sendGrant, UploadError, type Sender } from "./upload";

// A fake connection: records each PUT and fails the ones a test asks for.
function fakeSender(failures: Record<string, ("offline" | "expired" | "rejected")[]> = {}) {
  const sent: { url: string; bytes: number; contentType?: string }[] = [];
  const send: Sender = async (url, body, { contentType, onProgress, signal }) => {
    const next = failures[url]?.shift();
    if (next) throw new UploadError(next);
    if (signal.aborted) throw new UploadError("canceled");
    onProgress(Math.floor(body.size / 2));
    onProgress(body.size);
    sent.push({ url, bytes: body.size, contentType });
  };
  return { send, sent };
}

const file = (bytes: number) => new Blob([new Uint8Array(bytes)]);
const multipart = (parts: number[], uploadedParts: number[] = []): UploadGrant => ({
  method: "multipart",
  mediaId: "m1",
  partSize: 10,
  parts: parts.map((n) => ({ partNumber: n, url: `part-${n}` })),
  uploadedParts,
});

describe("sending a file to storage", () => {
  it("uploads a picture in one request with its approved type and reports progress", async () => {
    const { send, sent } = fakeSender();
    const progress: number[] = [];
    await sendGrant({ method: "single", mediaId: "m1", url: "put", contentType: "image/jpeg" }, file(100), {
      send,
      signal: new AbortController().signal,
      onProgress: (p) => progress.push(p),
    });
    expect(sent).toEqual([{ url: "put", bytes: 100, contentType: "image/jpeg" }]);
    expect(progress).toEqual([0, 0.5, 1, 1]);
  });

  it("uploads a video in parts, each the approved size", async () => {
    const { send, sent } = fakeSender();
    const progress: number[] = [];
    await sendGrant(multipart([1, 2, 3]), file(25), {
      send,
      signal: new AbortController().signal,
      onProgress: (p) => progress.push(p),
    });
    expect(sent.map((s) => [s.url, s.bytes])).toEqual([
      ["part-1", 10],
      ["part-2", 10],
      ["part-3", 5],
    ]);
    expect(progress.at(-1)).toBe(1);
    // Progress never goes backward.
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it("resumes after an interruption by sending only the missing parts", async () => {
    const { send, sent } = fakeSender();
    const progress: number[] = [];
    await sendGrant(multipart([3], [1, 2]), file(25), {
      send,
      signal: new AbortController().signal,
      onProgress: (p) => progress.push(p),
    });
    expect(sent.map((s) => s.url)).toEqual(["part-3"]);
    expect(progress[0]).toBe(0.8);
  });

  it("retries a dropped connection, then gives up with a lost-connection error", async () => {
    const flaky = fakeSender({ "part-2": ["offline", "offline"] });
    await sendGrant(multipart([1, 2]), file(20), {
      send: flaky.send,
      signal: new AbortController().signal,
      onProgress: () => undefined,
      retryDelayMs: 0,
    });
    expect(flaky.sent.map((s) => s.url)).toEqual(["part-1", "part-2"]);

    const down = fakeSender({ "part-1": ["offline", "offline", "offline", "offline"] });
    await expect(
      sendGrant(multipart([1]), file(10), {
        send: down.send,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        retryDelayMs: 0,
      }),
    ).rejects.toMatchObject({ kind: "offline" });
  });

  it("stops at once on an expired link so fresh links can be requested", async () => {
    const { send, sent } = fakeSender({ "part-1": ["expired"] });
    await expect(
      sendGrant(multipart([1, 2]), file(20), { send, signal: new AbortController().signal, onProgress: () => undefined }),
    ).rejects.toMatchObject({ kind: "expired" });
    expect(sent).toEqual([]);
  });

  it("cancels", async () => {
    const controller = new AbortController();
    controller.abort();
    const { send, sent } = fakeSender();
    await expect(
      sendGrant(multipart([1, 2]), file(20), { send, signal: controller.signal, onProgress: () => undefined }),
    ).rejects.toMatchObject({ kind: "canceled" });
    expect(sent).toEqual([]);
  });
});
