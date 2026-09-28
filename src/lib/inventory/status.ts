// Pre-Week Setup status and shortage, calculated the same way as the
// database (public.guard_weekly_setup_item), for instant feedback while
// counting. The database stays the authority.

export type InventoryStatus = "ready" | "missing" | "need_more";

export const STATUS_LABELS: Record<InventoryStatus, string> = {
  ready: "Ready",
  missing: "Missing",
  need_more: "Need More",
};

export function countStatus(target: number, usable: number | null): { status: InventoryStatus | null; shortage: number | null } {
  if (usable === null) return { status: null, shortage: null };
  if (usable <= 0) return { status: "missing", shortage: target };
  if (usable < target) return { status: "need_more", shortage: target - usable };
  return { status: "ready", shortage: 0 };
}

// "Need 18 more", or the unit when there is one: "Need 18 more brushes".
export function shortageText(shortage: number | null, unit: string | null) {
  if (!shortage) return null;
  return `Need ${shortage} more${unit ? ` ${unit}` : ""}`;
}

// A whole-number count from a text field: blank clears it; anything else
// must be 0 or more.
export function parseCount(value: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: "Enter a whole number, 0 or more." };
  const n = Number(trimmed);
  if (n > 100000) return { ok: false, error: "That count is too large." };
  return { ok: true, value: n };
}

// The Monday (YYYY-MM-DD) that starts the America/Chicago week containing
// `at`. Mirrors public.pre_week_start.
export function weekStart(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  const date = new Date(`${parts}T12:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

// "Sep 28 – Oct 4, 2026" for the week starting on a Monday.
export function weekRange(mondayIso: string) {
  const start = new Date(`${mondayIso}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const fmt = (d: Date, year: boolean) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
  return `${fmt(start, false)} – ${fmt(end, true)}`;
}
