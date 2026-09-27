import type { EmployeeFieldErrors } from "@/lib/auth/account-validation";

// Results returned by the Team Server Actions. A temporary password appears
// only in the one response that created it and is never stored.

export type CreateEmployeeResult =
  | {
      status: "created";
      fullName: string;
      email: string;
      temporaryPassword: string;
    }
  | {
      status: "invalid";
      fieldErrors: EmployeeFieldErrors;
      values: { fullName: string; email: string };
    }
  | { status: "error"; message: string; values?: { fullName: string; email: string } };

export type ResetPasswordResult =
  | {
      status: "reset";
      fullName: string;
      email: string;
      temporaryPassword: string;
      warning?: string;
    }
  | { status: "error"; message: string };

export type SetActiveResult =
  | { status: "ok"; warning?: string }
  | { status: "error"; message: string };

export type TeamMember = {
  id: string;
  fullName: string;
  email: string | null;
  role: "owner" | "employee";
  active: boolean;
  mustChangePassword: boolean;
  deactivatedAt: string | null;
  isSelf: boolean;
};
