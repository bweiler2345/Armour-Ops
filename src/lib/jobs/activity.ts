import { JOB_STATUS_LABELS, type JobStatus } from "./status";

// Plain-language job history entries, shared by the owner job page's History
// and the Owner Dashboard's recent activity.

const FIELD_LABELS: Record<string, string> = {
  client_name: "Client name",
  address: "Address",
  square_feet: "Square footage",
  flake_color: "Flake color",
  scheduled_date: "Scheduled date",
  general_notes: "Notes",
  caulking_required: "Caulking",
  baseboard_required: "Baseboard",
  allow_employees_to_join: "Allow Employees to Join",
};

function describeValue(value: unknown) {
  if (value === true) return "on";
  if (value === false) return "off";
  if (value === "" || value === null || value === undefined) return "(blank)";
  return String(value);
}

export type ActivityInput = {
  type: string;
  actorName: string | null;
  details: unknown;
  // Names of people mentioned in the details, by profile id.
  names: Record<string, string>;
};

export function describeActivity(entry: ActivityInput): { title: string; changes: string[] } {
  const who = entry.actorName || "Someone";
  const details = (entry.details ?? {}) as Record<string, unknown>;
  const step = String(details.title ?? "a step");
  const person = (key: string) => {
    const id = details[key];
    return (typeof id === "string" && entry.names[id]) || "an employee";
  };
  let changes: string[] = [];
  let title: string;

  switch (entry.type) {
    case "job_created":
      title = `${who} created the job (workflow version ${String(details.workflow_version ?? "?")})`;
      break;
    case "job_details_edited": {
      title = `${who} edited the job details`;
      const edits = (details.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
      changes = Object.entries(edits).map(
        ([field, change]) => `${FIELD_LABELS[field] ?? field}: ${describeValue(change.from)} → ${describeValue(change.to)}`,
      );
      break;
    }
    case "made_available":
      title = `${who} made the job available to claim`;
      break;
    case "claimed":
      title = `${who} claimed the job and became the lead`;
      break;
    case "employee_joined":
      title = `${who} joined the job`;
      break;
    case "employee_added":
      title = `${who} added ${person("employee_id")}${details.role === "lead" ? " as lead" : ""}`;
      break;
    case "employee_removed":
      title = `${who} removed ${person("employee_id")}${details.role === "lead" ? " (lead)" : ""}`;
      break;
    case "lead_changed":
      title = details.from_employee_id
        ? `${who} changed the lead from ${person("from_employee_id")} to ${person("to_employee_id")}`
        : `${who} made ${person("to_employee_id")} the lead`;
      break;
    case "step_started":
      title = `${who} started “${step}”`;
      break;
    case "step_completed":
      title = `${who} completed “${step}”`;
      break;
    case "custom_step_added":
      title = `${who} added the custom step “${step}”${details.origin === "library_import" ? " from the library" : ""}`;
      break;
    case "custom_step_removed":
      title = `${who} removed the custom step “${step}”`;
      break;
    case "step_reopened":
      title = `${who} reopened “${step}”`;
      if (details.reason) changes = [`Reason: ${String(details.reason)}`];
      break;
    case "reference_picture_added":
      title = `${who} added a reference picture to “${step}”`;
      break;
    case "reference_picture_archived":
      title = `${who} removed a reference picture from “${step}”`;
      break;
    case "owner_joined_working_team":
      title = `${who} joined the working team as Owner · Working Member`;
      break;
    case "owner_left_working_team":
      title = `${who} left the working team`;
      break;
    case "milestone_installed":
      title = `${who} marked ${String(details.label ?? "an installation milestone")}`;
      break;
    case "job_completed":
      title = `${who} marked the job Complete`;
      break;
    case "proof_uploaded":
      title = `${who} uploaded proof: ${String(details.proof ?? "a file")}`;
      break;
    case "proof_removed":
      title = `${who} removed proof: ${String(details.proof ?? "a file")}`;
      break;
    case "status_changed":
      title = `Status changed to ${JOB_STATUS_LABELS[details.to as JobStatus] ?? String(details.to)}`;
      break;
    case "step_hold_cleared":
      title = `${who} cleared ${person("employee_id")}’s edit hold on “${step}”`;
      break;
    case "join_setting_changed":
      title = `${who} turned Allow Employees to Join ${details.to ? "on" : "off"}`;
      break;
    case "returned_to_scheduled":
      title = `${who} returned the job to Scheduled`;
      break;
    default:
      title = `${who} updated the job`;
  }
  return { title, changes };
}
