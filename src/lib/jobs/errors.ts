// Turns a database error from the job functions into a message for the owner.
// Messages raised by our own functions (errcode P0001) are written for people
// and shown as is; anything else gets a safe generic message.

export const JOB_ERROR_MESSAGES = {
  noWorkflow:
    "The approved workflow isn’t loaded, so jobs can’t be created yet. Nothing was saved.",
  notOwner: "Only an active owner can do this.",
  invalid: "One of the values isn’t allowed. Check the form and try again. Nothing was saved.",
  notFound: "That job couldn’t be found.",
  generic: "Something went wrong. Nothing was saved. Try again.",
} as const;

export function jobErrorMessage(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return JOB_ERROR_MESSAGES.generic;
  switch (error.code) {
    case "P0002":
      if (error.message?.startsWith("Job not found")) return JOB_ERROR_MESSAGES.notFound;
      // Our own "... not found." messages (a step, a proof file) are shown as is.
      return error.message && /^[A-Z][\w ’']{0,60} (not|wasn['’]t) found\.$/.test(error.message)
        ? error.message
        : JOB_ERROR_MESSAGES.noWorkflow;
    case "42501":
      // Our role and team checks ("Only an active owner…", "Only employees on
      // this job's team…") say who may act; Postgres permission errors
      // ("permission denied…") do not.
      return error.message?.startsWith("Only ") ? error.message : JOB_ERROR_MESSAGES.notOwner;
    case "P0001":
      return error.message || JOB_ERROR_MESSAGES.generic;
    case "23502":
    case "23514":
    case "22007":
    case "22008":
    case "22P02":
      return JOB_ERROR_MESSAGES.invalid;
    default:
      return JOB_ERROR_MESSAGES.generic;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
