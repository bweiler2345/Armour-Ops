import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkStoredObject,
  completeMultipartXml,
  expectedPartSize,
  LINK_SECONDS,
  objectUrl,
  parseListParts,
  parseUploadId,
  PART_SIZE,
  partCount,
  planCompletion,
} from "./r2-core";

vi.mock("server-only", () => ({}));

// Made-up test values, not real credentials.
const FAKE = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key-value",
  R2_BUCKET: "armour-ops-media-test",
};
const KEY = "jobs/j1/steps/s1/a1/m1-0123456789abcdef0123456789abcdef.jpg";

describe("R2 helpers", () => {
  it("builds path-style object URLs for the account endpoint", () => {
    expect(objectUrl("acct", "bucket", "jobs/a b/x.jpg")).toBe(
      "https://acct.r2.cloudflarestorage.com/bucket/jobs/a%20b/x.jpg",
    );
  });

  it("splits videos into equal 10 MiB parts with a smaller last part", () => {
    const size = PART_SIZE * 2 + 123;
    expect(partCount(size)).toBe(3);
    expect(expectedPartSize(1, size)).toBe(PART_SIZE);
    expect(expectedPartSize(3, size)).toBe(123);
    expect(partCount(PART_SIZE)).toBe(1);
  });

  it("parses R2 responses", () => {
    expect(parseUploadId("<InitiateMultipartUploadResult><UploadId>abc&amp;1</UploadId></InitiateMultipartUploadResult>")).toBe("abc&1");
    const listed = parseListParts(
      `<ListPartsResult><IsTruncated>true</IsTruncated><NextPartNumberMarker>2</NextPartNumberMarker>
       <Part><PartNumber>1</PartNumber><ETag>&quot;e1&quot;</ETag><Size>10</Size></Part>
       <Part><PartNumber>2</PartNumber><ETag>"e2"</ETag><Size>5</Size></Part></ListPartsResult>`,
    );
    expect(listed).toEqual({
      parts: [
        { partNumber: 1, etag: '"e1"', size: 10 },
        { partNumber: 2, etag: '"e2"', size: 5 },
      ],
      truncated: true,
      nextMarker: 2,
    });
  });

  it("completes a multipart upload only when every part R2 holds matches", () => {
    const size = PART_SIZE + 100;
    const good = [
      { partNumber: 2, etag: '"b"', size: 100 },
      { partNumber: 1, etag: '"a"', size: PART_SIZE },
    ];
    const plan = planCompletion(good, size);
    expect(plan.ok && plan.parts.map((p) => p.partNumber)).toEqual([1, 2]);
    expect(completeMultipartXml(plan.ok ? plan.parts : [])).toBe(
      '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&quot;a&quot;</ETag></Part><Part><PartNumber>2</PartNumber><ETag>&quot;b&quot;</ETag></Part></CompleteMultipartUpload>',
    );

    // Interrupted: part 2 missing, so the upload resumes instead.
    expect(planCompletion([good[1]], size)).toMatchObject({ ok: false, missing: [2] });
    // Wrong size part.
    expect(planCompletion([good[1], { ...good[0], size: 99 }], size)).toMatchObject({ ok: false, missing: [2] });
    // Extra parts beyond the approved file.
    expect(planCompletion([...good, { partNumber: 3, etag: '"c"', size: 1 }], size)).toMatchObject({ ok: false });
  });

  it("checks the stored object's size and type", () => {
    const expected = { size: 100, contentType: "image/jpeg" };
    expect(checkStoredObject({ size: 100, contentType: "image/jpeg" }, expected)).toBeNull();
    expect(checkStoredObject(null, expected)).toMatch(/wasn't found/);
    expect(checkStoredObject({ size: 101, contentType: "image/jpeg" }, expected)).toMatch(/size/);
    expect(checkStoredObject({ size: 100, contentType: "image/png" }, expected)).toMatch(/type/);
  });
});

describe("signed links", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(FAKE)) vi.stubEnv(name, value);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("aren't available until every setting is present", async () => {
    const { isR2Configured } = await import("./r2");
    expect(isR2Configured()).toBe(true);
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
    expect(isR2Configured()).toBe(false);
  });

  it("allow one short-lived upload of one object with the approved type", async () => {
    const { presignPut } = await import("./r2");
    const url = new URL(await presignPut(KEY, "image/jpeg", LINK_SECONDS.putPicture));
    expect(url.origin).toBe(`https://${FAKE.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/${FAKE.R2_BUCKET}/${KEY}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^test-access-key-id\/\d{8}\/auto\/s3\/aws4_request$/);
    // The secret itself is never part of a link.
    expect(url.toString()).not.toContain(FAKE.R2_SECRET_ACCESS_KEY);
  });

  it("scope part links to one upload and part number", async () => {
    const { presignPart } = await import("./r2");
    const url = new URL(await presignPart(KEY, "upload-1", 3, LINK_SECONDS.putPart));
    expect(url.searchParams.get("uploadId")).toBe("upload-1");
    expect(url.searchParams.get("partNumber")).toBe("3");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
  });

  it("make viewing links short-lived and private", async () => {
    const { presignGet } = await import("./r2");
    const url = new URL(await presignGet(KEY, LINK_SECONDS.viewPicture, "image/jpeg"));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-content-type")).toBe("image/jpeg");
    expect(url.searchParams.get("response-cache-control")).toMatch(/^private/);
    expect(LINK_SECONDS.viewVideo).toBeLessThanOrEqual(15 * 60);
  });
});
