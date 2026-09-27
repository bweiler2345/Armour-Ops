// Server-side validation for the owner's job form. The database enforces the
// same limits with check constraints (supabase/migrations/..._jobs.sql).

export const JOB_DEFAULTS = {
  caulkingRequired: true,
  baseboardRequired: false,
  allowEmployeesToJoin: true,
} as const;

export const JOB_LIMITS = {
  clientName: 120,
  address: 200,
  flakeColor: 80,
  notes: 2000,
  minSquareFeet: 1,
  maxSquareFeet: 100_000,
  earliestDate: "2020-01-01",
  latestDate: "2100-12-31",
} as const;

export type JobValues = {
  clientName: string;
  address: string;
  squareFeet: number;
  flakeColor: string;
  scheduledDate: string; // YYYY-MM-DD
  notes: string;
  caulkingRequired: boolean;
  baseboardRequired: boolean;
  allowEmployeesToJoin: boolean;
};

// What the form sends back after a failed attempt, so nothing is retyped.
export type JobFormValues = Omit<JobValues, "squareFeet"> & { squareFeet: string };

export type JobFieldErrors = Partial<
  Record<"clientName" | "address" | "squareFeet" | "flakeColor" | "scheduledDate" | "notes", string>
>;

type FormLike = { get(name: string): FormDataEntryValue | null };

const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

// Checkboxes send "on" when checked and nothing when unchecked.
const checked = (value: FormDataEntryValue | null) => value === "on";

export function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseSquareFeet(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function validateJobForm(form: FormLike):
  | { ok: true; values: JobValues }
  | { ok: false; values: JobFormValues; fieldErrors: JobFieldErrors } {
  const notesRaw = form.get("notes");
  const values: JobFormValues = {
    clientName: text(form.get("clientName")),
    address: text(form.get("address")),
    squareFeet: text(form.get("squareFeet")),
    flakeColor: text(form.get("flakeColor")),
    scheduledDate: text(form.get("scheduledDate")),
    // Keep line breaks in notes; only trim the ends.
    notes: typeof notesRaw === "string" ? notesRaw.replace(/\r\n/g, "\n").trim() : "",
    caulkingRequired: checked(form.get("caulkingRequired")),
    baseboardRequired: checked(form.get("baseboardRequired")),
    allowEmployeesToJoin: checked(form.get("allowEmployeesToJoin")),
  };
  const errors: JobFieldErrors = {};

  if (!values.clientName) errors.clientName = "Enter the client’s name.";
  else if (values.clientName.length > JOB_LIMITS.clientName) {
    errors.clientName = `Keep the client name under ${JOB_LIMITS.clientName} characters.`;
  }

  if (!values.address) errors.address = "Enter the job address.";
  else if (values.address.length > JOB_LIMITS.address) {
    errors.address = `Keep the address under ${JOB_LIMITS.address} characters.`;
  }

  const squareFeet = parseSquareFeet(values.squareFeet);
  if (!values.squareFeet) errors.squareFeet = "Enter the square footage.";
  else if (squareFeet === null) errors.squareFeet = "Enter a whole number, like 650.";
  else if (squareFeet < JOB_LIMITS.minSquareFeet || squareFeet > JOB_LIMITS.maxSquareFeet) {
    errors.squareFeet = `Enter a number from ${JOB_LIMITS.minSquareFeet} to ${JOB_LIMITS.maxSquareFeet.toLocaleString("en-US")}.`;
  }

  if (!values.flakeColor) errors.flakeColor = "Enter the flake color.";
  else if (values.flakeColor.length > JOB_LIMITS.flakeColor) {
    errors.flakeColor = `Keep the flake color under ${JOB_LIMITS.flakeColor} characters.`;
  }

  if (!values.scheduledDate) errors.scheduledDate = "Choose the scheduled date.";
  else if (!isValidIsoDate(values.scheduledDate)) {
    errors.scheduledDate = "Choose a valid date.";
  } else if (
    values.scheduledDate < JOB_LIMITS.earliestDate ||
    values.scheduledDate > JOB_LIMITS.latestDate
  ) {
    errors.scheduledDate = "Choose a date between 2020 and 2100.";
  }

  if (values.notes.length > JOB_LIMITS.notes) {
    errors.notes = `Keep notes under ${JOB_LIMITS.notes.toLocaleString("en-US")} characters.`;
  }

  if (Object.keys(errors).length > 0 || squareFeet === null) {
    return { ok: false, values, fieldErrors: errors };
  }
  return { ok: true, values: { ...values, squareFeet } };
}
