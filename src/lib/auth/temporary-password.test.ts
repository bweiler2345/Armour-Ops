import { describe, expect, it } from "vitest";
import {
  generateTemporaryPassword,
  TEMPORARY_PASSWORD_ALPHABET,
} from "./temporary-password";

describe("generateTemporaryPassword", () => {
  it("makes four hyphen-separated groups of four allowed characters", () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
      for (const char of password.replaceAll("-", "")) {
        expect(TEMPORARY_PASSWORD_ALPHABET).toContain(char);
      }
    }
  });

  it("never uses look-alike characters", () => {
    for (const char of "0o1li") {
      expect(TEMPORARY_PASSWORD_ALPHABET).not.toContain(char);
    }
  });

  it("is at least as long as the minimum password length", () => {
    expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(10);
  });

  it("does not repeat across many generations", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateTemporaryPassword()));
    expect(seen.size).toBe(1000);
  });

  it("skips biased bytes instead of wrapping them", () => {
    // 248..255 would wrap to the start of the alphabet with a plain modulo.
    let call = 0;
    const random = (bytes: Uint8Array) => {
      bytes.fill(call++ === 0 ? 255 : 0);
      return bytes;
    };
    expect(generateTemporaryPassword(random)).toBe("aaaa-aaaa-aaaa-aaaa");
    expect(call).toBe(2);
  });
});
