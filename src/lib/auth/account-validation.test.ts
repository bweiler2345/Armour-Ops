import { describe, expect, it } from "vitest";
import { validateNewEmployee, validatePasswordChange } from "./account-validation";

describe("validateNewEmployee", () => {
  it("trims the name, collapses spaces, and lowercases the email", () => {
    expect(
      validateNewEmployee({ fullName: "  Sample   Person ", email: " Crew@Example.COM " }),
    ).toEqual({ ok: true, fullName: "Sample Person", email: "crew@example.com" });
  });

  it("requires a name and a valid email", () => {
    const result = validateNewEmployee({ fullName: " ", email: "not-an-email" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.fullName).toBeDefined();
      expect(result.fieldErrors.email).toBeDefined();
    }
  });

  it("rejects overly long names", () => {
    const result = validateNewEmployee({ fullName: "x".repeat(101), email: "crew@example.com" });
    expect(result.ok).toBe(false);
  });
});

describe("validatePasswordChange", () => {
  const valid = {
    currentPassword: "old-password-1",
    newPassword: "new-password-22",
    confirmPassword: "new-password-22",
  };

  it("accepts a valid change", () => {
    expect(validatePasswordChange(valid)).toEqual({
      ok: true,
      currentPassword: "old-password-1",
      newPassword: "new-password-22",
    });
  });

  it("requires every field", () => {
    const result = validatePasswordChange({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual([
        "confirmPassword",
        "currentPassword",
        "newPassword",
      ]);
    }
  });

  it("enforces the minimum length", () => {
    const result = validatePasswordChange({
      ...valid,
      newPassword: "short",
      confirmPassword: "short",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.newPassword).toMatch(/at least 10/);
  });

  it("rejects reusing the current password", () => {
    const result = validatePasswordChange({
      currentPassword: "same-password-1",
      newPassword: "same-password-1",
      confirmPassword: "same-password-1",
    });
    expect(result.ok).toBe(false);
  });

  it("requires the confirmation to match", () => {
    const result = validatePasswordChange({ ...valid, confirmPassword: "different-pass" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.confirmPassword).toBeDefined();
  });

  it("rejects passwords longer than Supabase accepts", () => {
    const long = "a".repeat(73);
    const result = validatePasswordChange({ ...valid, newPassword: long, confirmPassword: long });
    expect(result.ok).toBe(false);
  });
});
