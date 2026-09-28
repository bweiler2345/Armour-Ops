import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPROVED_INVENTORY } from "./approved-list";
import { countStatus, parseCount, shortageText, weekRange, weekStart } from "./status";

// The spec's "Required inventory for each trailer" list, as bullets.
function specItems() {
  const spec = readFileSync("docs/PRODUCT_SPEC.md", "utf8");
  const start = spec.indexOf("## Required inventory for each trailer");
  const section = spec.slice(start, spec.indexOf("\n# ", start));
  const result: { category: string; text: string }[] = [];
  let category = "";
  for (const line of section.split("\n")) {
    const heading = line.match(/^### (.+)$/);
    if (heading) category = heading[1];
    const top = line.match(/^- (.+)$/);
    const sub = line.match(/^ {2}- (.+)$/);
    if (sub) result.push({ category, text: sub[1] });
    else if (top && !top[1].endsWith(":")) result.push({ category, text: top[1] });
  }
  return result;
}

describe("the approved inventory list", () => {
  it("matches the spec word for word, in order, including the two plywood requirements", () => {
    const categoryNames: Record<string, string> = {
      "Core equipment": "Core equipment",
      "Prep tools": "Prep tools",
      "Mixing and application": "Mixing and application",
      "Materials and consumables": "Materials and consumables",
    };
    expect(APPROVED_INVENTORY.map((i) => [i.category, i.spec])).toEqual(specItems().map((i) => [categoryNames[i.category], i.text]));
    expect(APPROVED_INVENTORY).toHaveLength(48);
  });

  it("uses the number in each item's name as its target, 1 otherwise, and none for Rags", () => {
    const words: Record<string, number> = { Two: 2, Three: 3, Four: 4, Eight: 8, Ten: 10, Thirty: 30 };
    for (const item of APPROVED_INVENTORY) {
      if (item.spec === "Rags stocked") {
        expect(item.target).toBeNull();
        continue;
      }
      const first = item.spec.split(" ")[0];
      const expected = words[first] ?? (first === "1" ? 1 : 1);
      expect(item.target, item.spec).toBe(expected);
      if (expected > 1) expect(item.unit, item.spec).toBeTruthy();
    }
  });

  it("is in the seed migration exactly as listed", () => {
    const migration = readFileSync("supabase/migrations/20260927120000_pre_week_setup.sql", "utf8");
    for (const item of APPROVED_INVENTORY) {
      const tracking = item.target === null ? "'status_only', null" : `'count', ${item.target}`;
      const unit = item.unit === null ? "null" : `'${item.unit}'`;
      expect(migration, item.label).toContain(`'${item.label}', ${tracking}, ${unit})`);
    }
  });
});

describe("status and shortage", () => {
  it("follows the approved rules", () => {
    expect(countStatus(30, 0)).toEqual({ status: "missing", shortage: 30 });
    expect(countStatus(30, 12)).toEqual({ status: "need_more", shortage: 18 });
    expect(shortageText(18, null)).toBe("Need 18 more");
    expect(shortageText(18, "brushes")).toBe("Need 18 more brushes");
    expect(countStatus(30, 30)).toEqual({ status: "ready", shortage: 0 });
    expect(countStatus(30, 31)).toEqual({ status: "ready", shortage: 0 });
    expect(shortageText(0, "brushes")).toBeNull();
    expect(countStatus(1, null)).toEqual({ status: null, shortage: null });
  });

  it("accepts only whole numbers, 0 or more", () => {
    expect(parseCount("12")).toEqual({ ok: true, value: 12 });
    expect(parseCount("0")).toEqual({ ok: true, value: 0 });
    expect(parseCount(" ")).toEqual({ ok: true, value: null });
    expect(parseCount("-1")).toMatchObject({ ok: false });
    expect(parseCount("1.5")).toMatchObject({ ok: false });
  });
});

describe("weeks", () => {
  it("start on Monday in America/Chicago", () => {
    expect(weekStart(new Date("2026-09-28T04:59:00Z"))).toBe("2026-09-21");
    expect(weekStart(new Date("2026-09-28T05:00:00Z"))).toBe("2026-09-28");
    expect(weekStart(new Date("2026-11-02T05:59:00Z"))).toBe("2026-10-26");
    expect(weekStart(new Date("2026-11-02T06:00:00Z"))).toBe("2026-11-02");
    expect(weekRange("2026-09-28")).toBe("Sep 28 – Oct 4, 2026");
  });
});

describe("mock data is gone", () => {
  it("has no sample trailers or mock-data module left", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    const all = files("src");
    expect(all.some((f) => f.replaceAll("\\", "/").endsWith("lib/mock-data.ts"))).toBe(false);
    for (const f of all.filter((f) => !/\.test\.ts$/.test(f))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/mock-data|Unit 101|Crew A/);
    }
  });
});
