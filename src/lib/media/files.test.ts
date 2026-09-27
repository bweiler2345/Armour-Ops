import { describe, expect, it } from "vitest";
import { checkFile, checkVideoLength, fitWithin, formatBytes, formatDuration, PHOTO_LIMITS, VIDEO_LIMITS } from "./files";

const MB = 1024 * 1024;

describe("choosing a picture", () => {
  it("accepts JPEG, HEIC, and PNG, always uploading a JPEG", () => {
    for (const [name, type] of [
      ["a.jpg", "image/jpeg"],
      ["a.HEIC", "image/heic"],
      ["a.heic", ""],
      ["a.png", "image/png"],
    ]) {
      expect(checkFile({ name, type, size: 3 * MB }, "picture"), name).toEqual({
        ok: true,
        kind: "picture",
        contentType: "image/jpeg",
      });
    }
  });

  it("rejects unsupported types in plain language", () => {
    expect(checkFile({ name: "a.gif", type: "image/gif", size: 10 }, "picture")).toEqual({
      ok: false,
      error: "That file type isn't supported. Use a JPEG, HEIC, or PNG picture.",
    });
    expect(checkFile({ name: "a.mov", type: "video/quicktime", size: 10 }, "picture")).toMatchObject({
      error: "This proof needs a picture, not a video.",
    });
  });

  it("limits the original to 25 MB", () => {
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: PHOTO_LIMITS.originalMaxBytes }, "picture").ok).toBe(true);
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: PHOTO_LIMITS.originalMaxBytes + 1 }, "picture")).toEqual({
      ok: false,
      error: "That picture is 25.0 MB. Pictures can be up to 25 MB.",
    });
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: 0 }, "picture").ok).toBe(false);
  });

  it("compresses to at most 5 MB, shrinking large pictures and never enlarging small ones", () => {
    expect(PHOTO_LIMITS.compressedMaxBytes).toBe(5 * MB);
    expect(fitWithin(4032, 3024, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(800, 600, 2560)).toEqual({ width: 800, height: 600 });
    // Each pass is smaller or lower quality than the last.
    expect([...PHOTO_LIMITS.longEdges].sort((a, b) => b - a)).toEqual([...PHOTO_LIMITS.longEdges]);
    expect([...PHOTO_LIMITS.qualities].sort((a, b) => b - a)).toEqual([...PHOTO_LIMITS.qualities]);
  });
});

describe("choosing a video", () => {
  it("accepts MOV and MP4 only", () => {
    expect(checkFile({ name: "a.mov", type: "video/quicktime", size: MB }, "video")).toMatchObject({ contentType: "video/quicktime" });
    expect(checkFile({ name: "a.mp4", type: "video/mp4", size: MB }, "video")).toMatchObject({ contentType: "video/mp4" });
    expect(checkFile({ name: "a.MOV", type: "", size: MB }, "video")).toMatchObject({ contentType: "video/quicktime" });
    expect(checkFile({ name: "a.webm", type: "video/webm", size: MB }, "video")).toEqual({
      ok: false,
      error: "That video type isn't supported. Use a MOV or MP4 video.",
    });
    expect(checkFile({ name: "a.jpg", type: "image/jpeg", size: MB }, "video")).toMatchObject({
      error: "This proof needs a video, not a picture.",
    });
  });

  it("limits size to 300 MB and length to 3 minutes", () => {
    expect(checkFile({ name: "a.mp4", type: "video/mp4", size: VIDEO_LIMITS.maxBytes }, "video").ok).toBe(true);
    expect(checkFile({ name: "a.mp4", type: "video/mp4", size: VIDEO_LIMITS.maxBytes + 1 }, "video")).toEqual({
      ok: false,
      error: "That video is 300 MB. Videos can be up to 300 MB.",
    });
    expect(checkVideoLength(180)).toBeNull();
    expect(checkVideoLength(181)).toBe("That video is 3:01 long. Videos can be up to 3 minutes.");
    expect(checkVideoLength(Number.NaN)).toMatch(/Couldn't read/);
  });

  it("formats sizes and lengths", () => {
    expect(formatBytes(2.5 * MB)).toBe("2.5 MB");
    expect(formatBytes(250 * MB)).toBe("250 MB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatDuration(65.4)).toBe("1:05");
  });
});
