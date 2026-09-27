import { describe, expect, it } from "vitest";
import { isValidIsoDate, JOB_DEFAULTS, parseSquareFeet, validateJobForm } from "./validation";

function form(fields: Record<string, string | undefined>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) data.set(key, value);
  return data;
}

const valid = {
  clientName: "Sample Client",
  address: "100 Example Street, Sampletown",
  squareFeet: "640",
  flakeColor: "Sample Blend",
  scheduledDate: "2026-10-15",
  notes: "",
  caulkingRequired: "on",
  allowEmployeesToJoin: "on",
};

describe("job defaults", () => {
  it("turns caulking and joining on and baseboard off", () => {
    expect(JOB_DEFAULTS).toEqual({
      caulkingRequired: true,
      baseboardRequired: false,
      allowEmployeesToJoin: true,
    });
  });

  it("reads checked boxes as true and missing boxes as false", () => {
    const result = validateJobForm(form(valid));
    expect(result.ok && result.values).toMatchObject({
      caulkingRequired: true,
      baseboardRequired: false,
      allowEmployeesToJoin: true,
    });
    const allOff = validateJobForm(
      form({ ...valid, caulkingRequired: undefined, allowEmployeesToJoin: undefined, baseboardRequired: "on" }),
    );
    expect(allOff.ok && allOff.values).toMatchObject({
      caulkingRequired: false,
      baseboardRequired: true,
      allowEmployeesToJoin: false,
    });
  });
});

describe("required fields", () => {
  it("accepts a complete form and trims text", () => {
    expect(
      validateJobForm(form({ ...valid, clientName: "  Sample   Client ", notes: "  Gate code 1234\nDog in yard  " })),
    ).toEqual({
      ok: true,
      values: {
        clientName: "Sample Client",
        address: "100 Example Street, Sampletown",
        squareFeet: 640,
        flakeColor: "Sample Blend",
        scheduledDate: "2026-10-15",
        notes: "Gate code 1234\nDog in yard",
        caulkingRequired: true,
        baseboardRequired: false,
        allowEmployeesToJoin: true,
      },
    });
  });

  it("requires client, address, square footage, flake, and date, but not notes", () => {
    const result = validateJobForm(form({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual([
        "address",
        "clientName",
        "flakeColor",
        "scheduledDate",
        "squareFeet",
      ]);
    }
  });

  it("returns what was entered so the owner doesn't retype it", () => {
    const result = validateJobForm(form({ ...valid, squareFeet: "abc" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.values).toMatchObject({ clientName: "Sample Client", squareFeet: "abc" });
  });

  it("limits text lengths", () => {
    for (const [field, length] of [
      ["clientName", 121],
      ["address", 201],
      ["flakeColor", 81],
      ["notes", 2001],
    ] as const) {
      const result = validateJobForm(form({ ...valid, [field]: "x".repeat(length) }));
      expect(result.ok, field).toBe(false);
      if (!result.ok) expect(result.fieldErrors[field], field).toBeDefined();
    }
  });
});

describe("square footage", () => {
  it("accepts whole numbers, with or without commas", () => {
    expect(parseSquareFeet("650")).toBe(650);
    expect(parseSquareFeet("1,250")).toBe(1250);
    expect(parseSquareFeet(" 2 400 ")).toBe(2400);
  });

  it("rejects decimals, words, negatives, and blanks", () => {
    for (const raw of ["650.5", "six hundred", "-40", "", "12a"]) expect(parseSquareFeet(raw), raw).toBeNull();
  });

  it("enforces 1 to 100,000", () => {
    for (const [raw, ok] of [
      ["0", false],
      ["1", true],
      ["100000", true],
      ["100001", false],
    ] as const) {
      expect(validateJobForm(form({ ...valid, squareFeet: raw })).ok, raw).toBe(ok);
    }
  });
});

describe("scheduled date", () => {
  it("accepts real calendar dates only", () => {
    expect(isValidIsoDate("2026-10-15")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "10/15/2026", "2026-1-5", ""]) {
      expect(isValidIsoDate(bad), bad).toBe(false);
    }
  });

  it("keeps dates between 2020 and 2100, including past dates in that range", () => {
    for (const [date, ok] of [
      ["2019-12-31", false],
      ["2020-01-01", true],
      ["2025-06-01", true],
      ["2100-12-31", true],
      ["2101-01-01", false],
    ] as const) {
      expect(validateJobForm(form({ ...valid, scheduledDate: date })).ok, date).toBe(ok);
    }
  });

  it("stores the date exactly as chosen, with no time zone shift", () => {
    const result = validateJobForm(form({ ...valid, scheduledDate: "2026-12-31" }));
    expect(result.ok && result.values.scheduledDate).toBe("2026-12-31");
  });
});
