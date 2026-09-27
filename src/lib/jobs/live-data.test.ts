import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as mockData from "@/lib/mock-data";
import { isUuid, JOB_ERROR_MESSAGES, jobErrorMessage } from "./errors";

const read = (path: string) => readFileSync(path, "utf8");

describe("live job data", () => {
  it("has no mock jobs left", () => {
    expect(Object.keys(mockData).sort()).toEqual(["trailers"]);
  });

  it("builds job screens and cards only from database queries", () => {
    for (const file of [
      "src/app/(app)/jobs/page.tsx",
      "src/app/(app)/jobs/[jobId]/page.tsx",
      "src/app/(app)/owner/jobs/page.tsx",
      "src/app/(app)/owner/jobs/[jobId]/page.tsx",
      "src/components/JobCard.tsx",
      "src/components/JobDetails.tsx",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/mock-data/);
    }
    expect(read("src/app/(app)/jobs/page.tsx")).toMatch(/listJobCards\(\)/);
    expect(read("src/app/(app)/owner/jobs/page.tsx")).toMatch(/listJobCards\(\)/);
  });
});

describe("job error messages", () => {
  it("explain a missing workflow", () => {
    expect(jobErrorMessage({ code: "P0002", message: "No active approved workflow is loaded." })).toBe(
      JOB_ERROR_MESSAGES.noWorkflow,
    );
    expect(jobErrorMessage({ code: "P0002", message: "Job not found." })).toBe(JOB_ERROR_MESSAGES.notFound);
  });

  it("show our own rule messages but hide other database details", () => {
    expect(jobErrorMessage({ code: "P0001", message: "Only Scheduled jobs can be edited." })).toBe(
      "Only Scheduled jobs can be edited.",
    );
    expect(jobErrorMessage({ code: "23514", message: 'new row violates check constraint "x"' })).toBe(
      JOB_ERROR_MESSAGES.invalid,
    );
    expect(jobErrorMessage({ code: "XX000", message: "internal detail" })).toBe(JOB_ERROR_MESSAGES.generic);
    expect(jobErrorMessage({ code: "42501" })).toBe(JOB_ERROR_MESSAGES.notOwner);
  });

  it("recognizes job ids", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("../etc")).toBe(false);
  });
});
