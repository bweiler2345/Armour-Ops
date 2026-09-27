// Keeps an open step screen in step with the database.
//
// The screen holds a local copy of the saved answers so taps feel instant.
// That copy must be replaced by the database's version whenever it could be
// out of date, without throwing away work the editor hasn't saved yet.

import type { StepMediaItem } from "@/lib/media/types";

export type LiveStep = {
  state: "completed" | "in_progress" | "available" | "locked";
  holdHeldBy: string | null;
  holdHeldByName: string | null;
  holdExpiresAt: string | null;
  checked: string[];
  answers: Record<string, string>;
  notes: string;
  // Proof files on the current attempt. Only the owner and assigned
  // employees can read them; everyone else gets an empty list.
  media: StepMediaItem[];
};

export type LocalStep = {
  checked: ReadonlySet<string>;
  answers: Readonly<Record<string, string>>;
  notes: string;
  confirmed: boolean;
};

// Local changes the database hasn't confirmed yet: checks whose save is in
// flight, entries being typed, and notes being typed.
export type Unsaved = {
  checks: ReadonlySet<string>;
  inputs: ReadonlySet<string>;
  notes: boolean;
};

export const NOTHING_UNSAVED: Unsaved = { checks: new Set(), inputs: new Set(), notes: false };

// Merge the database's version into the screen. Saved values always win,
// except for the editor's own unsaved changes. The confirmation is never
// stored, so it is cleared whenever the screen didn't keep its edit hold:
// someone else may have changed the answers it confirmed.
export function mergeLive(
  local: LocalStep,
  live: LiveStep,
  { unsaved, keptHold }: { unsaved: Unsaved; keptHold: boolean },
): LocalStep {
  const checked = new Set(live.checked);
  for (const id of unsaved.checks) {
    if (local.checked.has(id)) checked.add(id);
    else checked.delete(id);
  }

  const answers: Record<string, string> = { ...live.answers };
  for (const id of unsaved.inputs) {
    if (id in local.answers) answers[id] = local.answers[id];
  }

  return {
    checked,
    answers,
    notes: unsaved.notes ? local.notes : live.notes,
    confirmed: keptHold ? local.confirmed : false,
  };
}

export function sameAnswers(a: LocalStep, b: LocalStep) {
  if (a.notes !== b.notes || a.confirmed !== b.confirmed) return false;
  if (a.checked.size !== b.checked.size) return false;
  for (const id of a.checked) if (!b.checked.has(id)) return false;
  const keys = new Set([...Object.keys(a.answers), ...Object.keys(b.answers)]);
  for (const key of keys) if ((a.answers[key] ?? "") !== (b.answers[key] ?? "")) return false;
  return true;
}
