import { describe, expect, it } from "vitest";
import { mergeLive, NOTHING_UNSAVED, sameAnswers, type LiveStep, type LocalStep } from "./sync";

// Two employees, A and B, with the same step open. These tests follow the
// reported case: A saved two checks, B took over and saved a third, and A's
// open screen must show all three.

const A = "employee-a";
const B = "employee-b";

function live(overrides: Partial<LiveStep> = {}): LiveStep {
  return {
    state: "in_progress",
    holdHeldBy: B,
    holdHeldByName: "Employee B",
    holdExpiresAt: "2026-09-27T17:00:00Z",
    checked: ["c1", "c2", "c3"],
    answers: {},
    notes: "",
    ...overrides,
  };
}

const screenA = (overrides: Partial<LocalStep> = {}): LocalStep => ({
  checked: new Set(["c1", "c2"]),
  answers: {},
  notes: "",
  confirmed: false,
  ...overrides,
});

describe("a waiting screen catches up with a teammate's saves", () => {
  it("shows the third check B saved on A's open screen", () => {
    const merged = mergeLive(screenA(), live(), { unsaved: NOTHING_UNSAVED, keptHold: false });
    expect([...merged.checked].sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("also picks up entries, notes, and unchecked items", () => {
    const merged = mergeLive(
      screenA({ answers: { boxes: "2" }, notes: "old" }),
      live({ checked: ["c1"], answers: { boxes: "3", extra: "½ box" }, notes: "B's note" }),
      { unsaved: NOTHING_UNSAVED, keptHold: false },
    );
    expect([...merged.checked]).toEqual(["c1"]);
    expect(merged.answers).toEqual({ boxes: "3", extra: "½ box" });
    expect(merged.notes).toBe("B's note");
  });
});

describe("reacquiring the hold loads the current saved answers", () => {
  it("starts A from B's saved work, with the confirmation cleared", () => {
    const stale = screenA({ confirmed: true });
    const merged = mergeLive(stale, live({ holdHeldBy: A, holdHeldByName: "Employee A" }), {
      unsaved: NOTHING_UNSAVED,
      keptHold: false,
    });
    expect([...merged.checked].sort()).toEqual(["c1", "c2", "c3"]);
    expect(merged.confirmed).toBe(false);
  });

  it("keeps the confirmation when the same editor simply renewed an unbroken hold", () => {
    const merged = mergeLive(screenA({ confirmed: true }), live({ checked: ["c1", "c2"] }), {
      unsaved: NOTHING_UNSAVED,
      keptHold: true,
    });
    expect(merged.confirmed).toBe(true);
  });
});

describe("refreshes never overwrite the editor's unsaved work", () => {
  it("keeps a check whose save is still in flight", () => {
    const merged = mergeLive(
      screenA({ checked: new Set(["c1", "c2", "c4"]) }),
      live({ checked: ["c1", "c2"] }),
      { unsaved: { checks: new Set(["c4"]), inputs: new Set(), notes: false }, keptHold: true },
    );
    expect([...merged.checked].sort()).toEqual(["c1", "c2", "c4"]);
  });

  it("keeps an uncheck whose save is still in flight", () => {
    const merged = mergeLive(screenA({ checked: new Set(["c1"]) }), live({ checked: ["c1", "c2"] }), {
      unsaved: { checks: new Set(["c2"]), inputs: new Set(), notes: false },
      keptHold: true,
    });
    expect([...merged.checked]).toEqual(["c1"]);
  });

  it("keeps notes and entries being typed", () => {
    const merged = mergeLive(
      screenA({ notes: "typing…", answers: { boxes: "4" } }),
      live({ notes: "saved", answers: { boxes: "3", extra: "None" } }),
      { unsaved: { checks: new Set(), inputs: new Set(["boxes"]), notes: true }, keptHold: true },
    );
    expect(merged.notes).toBe("typing…");
    expect(merged.answers).toEqual({ boxes: "4", extra: "None" });
  });
});

describe("sameAnswers", () => {
  it("lets the screen skip re-rendering when nothing changed", () => {
    const a = screenA({ answers: { boxes: "2" } });
    expect(sameAnswers(a, { ...a, checked: new Set(["c2", "c1"]) })).toBe(true);
    expect(sameAnswers(a, { ...a, checked: new Set(["c1"]) })).toBe(false);
    expect(sameAnswers(a, { ...a, answers: { boxes: "3" } })).toBe(false);
    expect(sameAnswers(a, { ...a, confirmed: true })).toBe(false);
  });
});
