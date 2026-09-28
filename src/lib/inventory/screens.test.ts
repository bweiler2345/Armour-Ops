import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { combineShortages } from "./shortages";

const read = (path: string) => readFileSync(path, "utf8");

const setups = [
  { id: "s1", trailerId: "t1", trailerName: "Trailer 1" },
  { id: "s2", trailerId: "t2", trailerName: "Trailer 2" },
];

describe("shortage review", () => {
  it("keeps each trailer's shortage and adds a combined total for counted items", () => {
    const lines = combineShortages(
      [
        { setupId: "s1", label: "3-inch brushes", unitLabel: "brushes", tracking: "count", status: "need_more", shortage: 18, note: "" },
        { setupId: "s2", label: "3-inch brushes", unitLabel: "brushes", tracking: "count", status: "missing", shortage: 30, note: "Left at shop" },
        { setupId: "s2", label: "Rags stocked", unitLabel: null, tracking: "status_only", status: "need_more", shortage: null, note: "" },
        { setupId: "s1", label: "Drill", unitLabel: null, tracking: "count", status: "missing", shortage: 1, note: "" },
      ],
      setups,
    );
    expect(lines.map((l) => [l.label, l.total, l.perTrailer.map((t) => [t.trailerName, t.status, t.shortage])])).toEqual([
      ["3-inch brushes", 48, [["Trailer 1", "need_more", 18], ["Trailer 2", "missing", 30]]],
      ["Rags stocked", null, [["Trailer 2", "need_more", null]]],
      ["Drill", 1, [["Trailer 1", "missing", 1]]],
    ]);
    expect(combineShortages([], setups)).toEqual([]);
  });
});

describe("Pre-Week Setup screens", () => {
  it("use the Pre-Week Setup name and route everywhere", () => {
    expect(read("src/components/BottomNav.tsx")).toContain('{ href: "/pre-week-setup", label: "Pre-Week Setup", Icon: TrailerIcon }');
    for (const f of ["src/app/(app)/pre-week-setup/page.tsx", "src/app/(app)/owner/pre-week-setup/page.tsx"]) {
      expect(read(f)).not.toMatch(/Weekly Setup|Monday Check/);
    }
  });

  it("show this week's trailers and combined shortages on the Owner Dashboard", () => {
    const page = read("src/app/(app)/owner/page.tsx");
    expect(page).toContain("listTrailerCards()");
    expect(page).toContain("currentShortages()");
    expect(page).toContain("not submitted");
    expect(page).toContain("<AutoRefresh");
  });

  it("check the user before touching data, with owner-only management", () => {
    const actions = read("src/lib/actions/pre-week-setup.ts");
    expect(actions.startsWith('"use server";')).toBe(true);
    for (const fn of ["saveSetupItem", "saveRestockNotes", "submitSetup"]) {
      expect(actions).toMatch(new RegExp(`export async function ${fn}[\\s\\S]*?await requireUser\\(\\)`));
    }
    expect(actions).toMatch(/async function ownerCall[\s\S]*?await requireOwner\(\)/);
    for (const page of [
      "src/app/(app)/owner/pre-week-setup/page.tsx",
      "src/app/(app)/owner/pre-week-setup/trailers/page.tsx",
      "src/app/(app)/owner/pre-week-setup/items/page.tsx",
      "src/app/(app)/owner/pre-week-setup/history/page.tsx",
      "src/app/(app)/owner/pre-week-setup/setups/[setupId]/page.tsx",
    ]) {
      expect(read(page), page).toContain("await requireOwner()");
    }
    expect(read("src/app/(app)/pre-week-setup/[trailerId]/page.tsx")).toContain("await requireUser()");
    expect(read("src/lib/inventory/queries.ts").startsWith('import "server-only";')).toBe(true);
  });

  it("never send a status or shortage from the browser, only counts, choices, and notes", () => {
    const checklist = read("src/app/(app)/pre-week-setup/[trailerId]/SetupChecklist.tsx");
    const call = checklist.match(/saveSetupItem\(\{([\s\S]*?)\}\)/)?.[1] ?? "";
    expect(call).toMatch(/quantity:/);
    expect(call).not.toMatch(/shortage/);
    // Status is sent only for status-only items (Rags).
    expect(call).toMatch(/status: item\.tracking === "status_only" \? next\.status : null/);
  });
});
