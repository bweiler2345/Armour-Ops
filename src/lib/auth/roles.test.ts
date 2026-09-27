import { describe, expect, it } from "vitest";
import { homePathFor, isAppRole, roleLabel } from "./roles";

describe("roles", () => {
  it("recognizes only the two app roles", () => {
    expect(isAppRole("owner")).toBe(true);
    expect(isAppRole("employee")).toBe(true);
    expect(isAppRole("admin")).toBe(false);
    expect(isAppRole(null)).toBe(false);
  });

  it("labels roles and picks each role's home screen", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("employee")).toBe("Employee");
    expect(homePathFor("owner")).toBe("/owner");
    expect(homePathFor("employee")).toBe("/jobs");
  });
});
