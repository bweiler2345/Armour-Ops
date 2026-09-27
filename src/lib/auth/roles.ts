export type AppRole = "owner" | "employee";

export function isAppRole(value: unknown): value is AppRole {
  return value === "owner" || value === "employee";
}

export function roleLabel(role: AppRole) {
  return role === "owner" ? "Owner" : "Employee";
}

export function homePathFor(role: AppRole) {
  return role === "owner" ? "/owner" : "/jobs";
}
