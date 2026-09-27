import { EMAIL_PATTERN } from "@/lib/auth/sign-in";

export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 72; // Supabase Auth (bcrypt) ignores anything longer.
const MAX_NAME_LENGTH = 100;

export type EmployeeFieldErrors = { fullName?: string; email?: string };

export function validateNewEmployee(input: {
  fullName: unknown;
  email: unknown;
}):
  | { ok: true; fullName: string; email: string }
  | { ok: false; fullName: string; email: string; fieldErrors: EmployeeFieldErrors } {
  const fullName =
    typeof input.fullName === "string" ? input.fullName.trim().replace(/\s+/g, " ") : "";
  const email =
    typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const fieldErrors: EmployeeFieldErrors = {};

  if (!fullName) fieldErrors.fullName = "Enter the employee’s full name.";
  else if (fullName.length > MAX_NAME_LENGTH) {
    fieldErrors.fullName = `Keep the name under ${MAX_NAME_LENGTH} characters.`;
  }

  if (!email) fieldErrors.email = "Enter the employee’s email address.";
  else if (!EMAIL_PATTERN.test(email)) {
    fieldErrors.email = "Enter a valid email address, like name@example.com.";
  }

  if (fieldErrors.fullName || fieldErrors.email) {
    return { ok: false, fullName, email, fieldErrors };
  }
  return { ok: true, fullName, email };
}

export type PasswordChangeFieldErrors = {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
};

export function validatePasswordChange(input: {
  currentPassword: unknown;
  newPassword: unknown;
  confirmPassword: unknown;
}):
  | { ok: true; currentPassword: string; newPassword: string }
  | { ok: false; fieldErrors: PasswordChangeFieldErrors } {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const currentPassword = text(input.currentPassword);
  const newPassword = text(input.newPassword);
  const confirmPassword = text(input.confirmPassword);
  const fieldErrors: PasswordChangeFieldErrors = {};

  if (!currentPassword) fieldErrors.currentPassword = "Enter your current password.";

  if (!newPassword) fieldErrors.newPassword = "Enter a new password.";
  else if (newPassword.length < MIN_PASSWORD_LENGTH) {
    fieldErrors.newPassword = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  } else if (newPassword.length > MAX_PASSWORD_LENGTH) {
    fieldErrors.newPassword = `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  } else if (currentPassword && newPassword === currentPassword) {
    fieldErrors.newPassword = "Choose a password different from your current one.";
  }

  if (!confirmPassword) fieldErrors.confirmPassword = "Enter the new password again.";
  else if (newPassword && confirmPassword !== newPassword) {
    fieldErrors.confirmPassword = "The new passwords don’t match.";
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, currentPassword, newPassword };
}
