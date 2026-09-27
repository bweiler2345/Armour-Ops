import { describe, expect, it } from "vitest";
import { MESSAGES, signInErrorMessage, validateSignIn } from "./sign-in";

describe("validateSignIn", () => {
  it("accepts a valid email and password and trims the email", () => {
    expect(
      validateSignIn({ email: "  crew@example.com ", password: "secret" }),
    ).toEqual({ ok: true, email: "crew@example.com", password: "secret" });
  });

  it("requires both fields", () => {
    expect(validateSignIn({ email: "", password: "" })).toEqual({
      ok: false,
      email: "",
      fieldErrors: {
        email: MESSAGES.emailRequired,
        password: MESSAGES.passwordRequired,
      },
    });
  });

  it("rejects a malformed email", () => {
    const result = validateSignIn({ email: "crew@", password: "secret" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.email).toBe(MESSAGES.emailInvalid);
  });

  it("treats non-string form values as empty", () => {
    const result = validateSignIn({ email: null, password: 42 });
    expect(result.ok).toBe(false);
  });

  it("does not trim passwords", () => {
    const result = validateSignIn({ email: "crew@example.com", password: " pass " });
    expect(result).toMatchObject({ ok: true, password: " pass " });
  });
});

describe("signInErrorMessage", () => {
  it("uses one message for wrong email or password", () => {
    expect(signInErrorMessage({ code: "invalid_credentials" })).toBe(
      MESSAGES.invalidCredentials,
    );
    expect(signInErrorMessage({ code: "user_not_found" })).toBe(
      MESSAGES.invalidCredentials,
    );
    expect(signInErrorMessage({ status: 400 })).toBe(
      MESSAGES.invalidCredentials,
    );
  });

  it("explains inactive and unconfirmed accounts", () => {
    expect(signInErrorMessage({ code: "user_banned" })).toBe(MESSAGES.inactive);
    expect(signInErrorMessage({ code: "email_not_confirmed" })).toBe(
      MESSAGES.inactive,
    );
  });

  it("explains rate limits and network failures", () => {
    expect(signInErrorMessage({ code: "over_request_rate_limit" })).toBe(
      MESSAGES.rateLimited,
    );
    expect(signInErrorMessage({ status: 429 })).toBe(MESSAGES.rateLimited);
    expect(signInErrorMessage({ name: "AuthRetryableFetchError" })).toBe(
      MESSAGES.network,
    );
  });

  it("falls back to a generic message", () => {
    expect(signInErrorMessage({ status: 500 })).toBe(MESSAGES.unknown);
  });
});
