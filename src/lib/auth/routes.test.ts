import { describe, expect, it } from "vitest";
import { isPublicPath, safeNextPath } from "./routes";

describe("isPublicPath", () => {
  it("allows only sign-in and auth callback routes", () => {
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/auth/deactivated")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/jobs")).toBe(false);
    expect(isPublicPath("/owner")).toBe(false);
    expect(isPublicPath("/sign-in-other")).toBe(false);
    expect(isPublicPath("/authx")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/jobs")).toBe("/jobs");
    expect(safeNextPath("/owner?tab=jobs")).toBe("/owner?tab=jobs");
  });

  it("rejects anything that could leave the site", () => {
    expect(safeNextPath("https://example.com")).toBe("/");
    expect(safeNextPath("//example.com")).toBe("/");
    expect(safeNextPath("/\\example.com")).toBe("/");
    expect(safeNextPath("/jobs\n")).toBe("/");
    expect(safeNextPath("jobs")).toBe("/");
  });

  it("does not loop back to public routes", () => {
    expect(safeNextPath("/sign-in")).toBe("/");
    expect(safeNextPath("/sign-in?next=/jobs")).toBe("/");
    expect(safeNextPath("/auth/deactivated")).toBe("/");
  });

  it("uses the fallback for missing values", () => {
    expect(safeNextPath(null, "/jobs")).toBe("/jobs");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("", "")).toBe("");
    expect(safeNextPath(["/jobs"])).toBe("/");
  });
});
