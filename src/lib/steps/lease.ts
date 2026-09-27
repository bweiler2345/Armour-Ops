// How an open step screen reacts when the database refuses its edit lease.
// Every refusal ends editing on that screen: nothing more is saved until the
// employee taps "Edit this step" and the database issues a new lease.

export type LeaseRefusal = "ended" | "conflict" | "replaced" | "expired";

// Recognizes the database's lease refusals (require_step_lease and
// acquire_step_edit). Anything else is an ordinary error.
export function classifyLeaseError(message: string | undefined): LeaseRefusal | null {
  if (!message) return null;
  if (message.includes("owner ended your editing session")) return "ended";
  if (message.includes("Someone else is editing")) return "conflict";
  if (message.includes("opened for editing on another screen")) return "replaced";
  if (message.includes("editing time on this step ran out")) return "expired";
  return null;
}

export const LEASE_MESSAGES: Record<LeaseRefusal, string> = {
  ended: "The owner ended your editing session.",
  conflict: "Someone else is editing this step right now.",
  replaced: "This step was opened for editing on another screen.",
  expired: "Your editing time on this step ran out.",
};

// The screen state after a refusal: never editing; the employee may ask for a
// new lease with a button.
export function holdAfterRefusal(reason: LeaseRefusal) {
  return {
    editing: false as const,
    message: LEASE_MESSAGES[reason],
    action: reason === "conflict" ? "Try again" : "Edit this step",
  };
}
