import { describe, expect, it } from "vitest";
import type { StepMediaItem } from "./types";
import { canAddMore, percent, proofRows, sameVideo, uploadsReducer, type LocalUpload } from "./upload-state";

const ME = "user-me";

const saved = (id: string, overrides: Partial<StepMediaItem> = {}): StepMediaItem => ({
  id,
  requirementId: "r1",
  mediaType: "picture",
  status: "uploaded",
  sizeBytes: 100,
  declaredSizeBytes: 100,
  durationSeconds: null,
  fileName: "a.jpg",
  lastModified: 1,
  uploadedBy: ME,
  authorizationExpiresAt: "2026-09-28T00:00:00Z",
  failureReason: null,
  ...overrides,
});

const local = (key: string, overrides: Partial<LocalUpload> = {}): LocalUpload => ({
  key,
  requirementId: "r1",
  mediaType: "picture",
  contentType: "image/jpeg",
  mediaId: null,
  phase: "uploading",
  progress: 0,
  error: null,
  file: null,
  fileName: "a.jpg",
  lastModified: 1,
  originalSize: 100,
  durationSeconds: null,
  previewUrl: null,
  ...overrides,
});

describe("upload progress state", () => {
  it("moves forward only while uploading", () => {
    let state = uploadsReducer([], { type: "add", upload: local("u1") });
    state = uploadsReducer(state, { type: "progress", key: "u1", progress: 0.4 });
    state = uploadsReducer(state, { type: "progress", key: "u1", progress: 0.2 });
    expect(state[0].progress).toBe(0.4);
    state = uploadsReducer(state, { type: "update", key: "u1", changes: { phase: "failed", error: "Lost connection." } });
    state = uploadsReducer(state, { type: "progress", key: "u1", progress: 0.9 });
    expect(state[0]).toMatchObject({ progress: 0.4, phase: "failed", error: "Lost connection." });
    // Retry, then cancel.
    state = uploadsReducer(state, { type: "update", key: "u1", changes: { phase: "uploading", error: null } });
    state = uploadsReducer(state, { type: "progress", key: "u1", progress: 2 });
    expect(percent(state[0].progress)).toBe(100);
    expect(uploadsReducer(state, { type: "remove", key: "u1" })).toEqual([]);
  });
});

describe("what each proof shows", () => {
  it("merges saved files with uploads running on this screen", () => {
    const rows = proofRows(
      "r1",
      [saved("m1"), saved("m2", { status: "pending" }), saved("m3", { status: "failed" }), saved("x", { requirementId: "r2" })],
      [local("u1", { mediaId: "m2" }), local("u2")],
      ME,
    );
    expect(rows.map((r) => r.kind)).toEqual(["uploaded", "local", "failed", "local"]);
  });

  it("offers to continue an interrupted video only to its uploader", () => {
    const video = saved("v1", { mediaType: "video", status: "pending", sizeBytes: null });
    expect(proofRows("r1", [video], [], ME)).toEqual([{ kind: "interrupted", media: video, resumable: true }]);
    expect(proofRows("r1", [video], [], "someone-else")).toEqual([{ kind: "interrupted", media: video, resumable: false }]);
    const picture = saved("p1", { status: "pending" });
    expect(proofRows("r1", [picture], [], ME)).toEqual([{ kind: "interrupted", media: picture, resumable: false }]);
  });

  it("allows one file for single proofs and up to 20 for multiple-picture proofs", () => {
    expect(canAddMore([], false)).toBe(true);
    expect(canAddMore(proofRows("r1", [saved("m1")], [], ME), false)).toBe(false);
    // A failed file doesn't use up the single slot.
    expect(canAddMore(proofRows("r1", [saved("m1", { status: "failed" })], [], ME), false)).toBe(true);
    const nineteen = Array.from({ length: 19 }, (_, i) => saved(`m${i}`));
    expect(canAddMore(proofRows("r1", nineteen, [], ME), true)).toBe(true);
    expect(canAddMore(proofRows("r1", nineteen, [local("u1")], ME), true)).toBe(false);
  });

  it("recognizes the same video chosen again after a reload", () => {
    const video = saved("v1", { mediaType: "video", declaredSizeBytes: 5000, fileName: "IMG_1.MOV", lastModified: 42 });
    expect(sameVideo(video, { name: "IMG_1.MOV", size: 5000, lastModified: 42 })).toBe(true);
    expect(sameVideo(video, { name: "IMG_2.MOV", size: 5000, lastModified: 42 })).toBe(false);
    expect(sameVideo(video, { name: "IMG_1.MOV", size: 5001, lastModified: 42 })).toBe(false);
  });
});
