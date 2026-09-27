export type SignInFieldErrors = {
  email?: string;
  password?: string;
};

export type SignInState = {
  email?: string;
  error?: string;
  fieldErrors?: SignInFieldErrors;
};

export const MESSAGES = {
  emailRequired: "Enter your email address.",
  emailInvalid: "Enter a valid email address, like name@example.com.",
  passwordRequired: "Enter your password.",
  invalidCredentials: "That email and password don’t match. Check both and try again.",
  rateLimited: "Too many sign-in attempts. Wait a minute, then try again.",
  network: "Couldn’t reach the sign-in service. Check your connection and try again.",
  notConfigured: "Sign-in isn’t connected yet. Ask the owner to finish setup.",
  inactive: "This account isn’t active. Contact the owner for access.",
  unknown: "Something went wrong signing in. Try again in a moment.",
} as const;

export const EMAIL_PATTERN =/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SignInValidation =
  | { ok: true; email: string; password: string }
  | { ok: false; email: string; fieldErrors: SignInFieldErrors };

export function validateSignIn(input: {
  email: unknown;
  password: unknown;
}): SignInValidation {
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const fieldErrors: SignInFieldErrors = {};

  if (!email) fieldErrors.email = MESSAGES.emailRequired;
  else if (!EMAIL_PATTERN.test(email)) fieldErrors.email = MESSAGES.emailInvalid;
  if (!password) fieldErrors.password = MESSAGES.passwordRequired;

  if (fieldErrors.email || fieldErrors.password) {
    return { ok: false, email, fieldErrors };
  }
  return { ok: true, email, password };
}

// Maps a Supabase Auth error to a message an employee can act on. Wrong email
// and wrong password share one message so the form does not reveal which
// email addresses have accounts.
export function signInErrorMessage(error: {
  code?: string;
  status?: number;
  name?: string;
}) {
  switch (error.code) {
    case "invalid_credentials":
    case "user_not_found":
      return MESSAGES.invalidCredentials;
    case "email_not_confirmed":
    case "user_banned":
      return MESSAGES.inactive;
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return MESSAGES.rateLimited;
  }
  if (error.status === 429) return MESSAGES.rateLimited;
  if (error.status === 400) return MESSAGES.invalidCredentials;
  if (error.name === "AuthRetryableFetchError" || error.status === 0) {
    return MESSAGES.network;
  }
  return MESSAGES.unknown;
}
