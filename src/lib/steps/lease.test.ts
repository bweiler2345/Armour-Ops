import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyLeaseError, holdAfterRefusal, LEASE_MESSAGES } from "./lease";

const MIGRATION = readFileSync("supabase/migrations/20260927060000_step_edit_leases.sql", "utf8");

// Every refusal message require_step_lease and acquire_step_edit can raise.
const raised = [...MIGRATION.matchAll(/raise exception '([^']*(?:''[^']*)*)'/g)]
  .map((m) => m[1].replaceAll("''", "'"))
  .filter((message) => /editing|owner ended/i.test(message))
  // The owner's own "clear hold" error, not a refusal of an editor's lease.
  .filter((message) => message !== "Nobody is editing this step.");

describe("lease refusals from the database", () => {
  it("recognizes every lease refusal the database raises", () => {
    expect(raised.length).toBeGreaterThanOrEqual(4);
    for (const message of raised) {
      expect(classifyLeaseError(message), message).not.toBeNull();
    }
  });

  it("tells the former editor the owner ended their session", () => {
    expect(
      classifyLeaseError("The owner ended your editing session. Tap “Edit this step” to start again."),
    ).toBe("ended");
  });

  it("tells apart someone else editing, another screen, and running out of time", () => {
    expect(classifyLeaseError("Someone else is editing this step right now.")).toBe("conflict");
    expect(
      classifyLeaseError("This step was opened for editing on another screen. Tap “Edit this step” to continue here."),
    ).toBe("replaced");
    expect(classifyLeaseError("Your editing time on this step ran out. Tap “Edit this step” to continue.")).toBe(
      "expired",
    );
    expect(classifyLeaseError("Check every Final check item first.")).toBeNull();
    expect(classifyLeaseError(undefined)).toBeNull();
  });
});

describe("an open screen after its lease is refused", () => {
  it("stops editing and offers to ask for a new lease", () => {
    expect(holdAfterRefusal("ended")).toEqual({
      editing: false,
      message: "The owner ended your editing session.",
      action: "Edit this step",
    });
    for (const reason of ["ended", "replaced", "expired", "conflict"] as const) {
      const state = holdAfterRefusal(reason);
      expect(state.editing).toBe(false);
      expect(state.message).toBe(LEASE_MESSAGES[reason]);
    }
    expect(holdAfterRefusal("conflict").action).toBe("Try again");
  });
});

describe("the step screen never asks for a lease on its own", () => {
  const source = readFileSync("src/app/(app)/jobs/[jobId]/steps/[stepId]/StepWorkspace.tsx", "utf8");

  it("only renews its own lease in the heartbeat", () => {
    const heartbeat = source.slice(source.indexOf("const heartbeat"), source.indexOf("useEffect("));
    expect(heartbeat).toContain("renewStepEdit(");
    expect(heartbeat).not.toContain("acquireStepEdit(");
    expect(heartbeat).not.toContain("acquire(");
  });

  it("asks for a lease only when the screen opens or the employee taps the button", () => {
    const calls = source.match(/\bacquire\(\)/g) ?? [];
    // Once on open (in the effect) and once from the banner button.
    expect(calls).toHaveLength(2);
    expect(source).toContain("onRetry={() => void acquire()}");
  });
});
