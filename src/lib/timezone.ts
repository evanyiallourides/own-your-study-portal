/* ==========================================================================
   Display time zone
   --------------------------------------------------------------------------
   The portal renders every date and time in ONE zone, for everybody. That is a
   deliberate V1 decision rather than an oversight: a tutor in London and a
   student in Singapore looking at "Thursday 18:00" must be looking at the same
   moment, and the quickest way to get that wrong is to render each person's
   own clock and let them agree to meet at different times.

   `students.timezone` exists in the schema for the day this becomes
   per-person. When it does, the change is confined to this file and to the
   formatters that read from it.
   ========================================================================== */

export const PORTAL_TIME_ZONE = process.env.NEXT_PUBLIC_PORTAL_TIME_ZONE?.trim() || "Europe/London";

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: PORTAL_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock reading in the portal's zone for a given instant. */
export function zonedParts(date: Date): ZonedParts {
  const parts = partsFormatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type)?.value ?? "0";
    return Number(found);
  };
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    // "24" is how en-GB with hour12:false renders midnight.
    hour: value("hour") % 24,
    minute: value("minute"),
    second: value("second"),
  };
}

function offsetMs(date: Date): number {
  const p = zonedParts(date);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - date.getTime();
}

/**
 * The instant whose wall clock in the portal's zone reads the given time.
 * Applied twice because the offset itself depends on the instant — one pass is
 * wrong for the hour either side of a daylight-saving change.
 */
export function instantFromZonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let ts = naive - offsetMs(new Date(naive));
  ts = naive - offsetMs(new Date(ts));
  return new Date(ts);
}

/** Whole days between two instants, counted by calendar date in the portal's
 *  zone — so "tomorrow" does not depend on what time it is now. */
export function calendarDayDelta(target: Date, from: Date): number {
  const a = zonedParts(target);
  const b = zonedParts(from);
  return Math.round(
    (Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86_400_000,
  );
}
