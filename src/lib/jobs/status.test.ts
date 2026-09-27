import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canTransition,
  isActiveStatus,
  JOB_STATUS_LABELS,
  JOB_STATUS_TRANSITIONS,
  JOB_STATUSES,
} from "./status";

const SPEC = readFileSync("docs/PRODUCT_SPEC.md", "utf8").replaceAll("\r\n", "\n");
const MIGRATION = readFileSync("supabase/migrations/20260927030000_jobs.sql", "utf8");

describe("job statuses", () => {
  it("use exactly the labels and order from the spec", () => {
    const section = SPEC.split("## Job statuses\n")[1].trimStart().split("\n\n")[0];
    const specLabels = section.split("\n").map((line) => line.replace(/^- /, ""));
    expect(JOB_STATUSES.map((s) => JOB_STATUS_LABELS[s])).toEqual(specLabels);
  });

  it("match the database enum in the same order", () => {
    const enumBody = MIGRATION.match(/create type public\.job_status as enum \(([^)]*)\)/)![1];
    const values = [...enumBody.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual([...JOB_STATUSES]);
  });

  it("do not include the deferred Blocked status", () => {
    expect(JOB_STATUSES).not.toContain("blocked");
  });
});

describe("status transitions", () => {
  it("match the transitions the database enforces", () => {
    const guard = MIGRATION.split("(old.status, new.status) in (")[1].split(")\n  )")[0];
    const pairs = [...guard.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => [m[1], m[2]]);
    expect(pairs).toEqual(JOB_STATUS_TRANSITIONS.map(([a, b]) => [a, b]));
  });

  it("allow the Phase 3 owner actions both ways", () => {
    expect(canTransition("scheduled", "available_to_claim")).toBe(true);
    expect(canTransition("available_to_claim", "scheduled")).toBe(true);
  });

  it("never skip ahead or go backwards after work starts", () => {
    expect(canTransition("scheduled", "claimed")).toBe(false);
    expect(canTransition("scheduled", "complete")).toBe(false);
    expect(canTransition("claimed", "available_to_claim")).toBe(false);
    expect(canTransition("complete", "scheduled")).toBe(false);
  });

  it("let only the owner milestones reach the Installed statuses", () => {
    const into = (status: string) =>
      JOB_STATUS_TRANSITIONS.filter(([, to]) => to === status).map(([from]) => from);
    expect(into("base_coat_installed")).toEqual(["waiting_for_base_coat_installation"]);
    expect(into("top_coat_installed")).toEqual(["waiting_for_top_coat_installation"]);
  });

  it("treat Claimed through Completion Work as active", () => {
    expect(JOB_STATUSES.filter(isActiveStatus)).toEqual(JOB_STATUSES.slice(2, -1));
  });
});
