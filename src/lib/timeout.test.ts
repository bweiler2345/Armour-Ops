import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeoutError, withTimeout } from "./timeout";

afterEach(() => vi.useRealTimers());

describe("request time limits", () => {
  it("passes through answers and errors that arrive in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
    await expect(withTimeout(Promise.reject(new Error("network")), 1000)).rejects.toThrow("network");
  });

  it("gives up on a request that never returns", async () => {
    vi.useFakeTimers();
    const waiting = withTimeout(new Promise(() => undefined), 15_000);
    const check = expect(waiting).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
  });
});
