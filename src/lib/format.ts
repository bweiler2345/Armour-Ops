// Date and time formatting shared by server-rendered screens.

// Armour Floors' local time zone. Server rendering has no browser clock, so
// times are shown in this zone. Change it here if the business moves.
export const APP_TIME_ZONE = "America/Chicago";

// Calendar dates (YYYY-MM-DD) have no time zone; format them as written.
export function formatDate(iso: string, { withYear = false } = {}) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

export function formatDateTime(value: string | Date) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}
