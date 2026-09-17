/* ==========================================================================
   Formatting
   --------------------------------------------------------------------------
   All dates are formatted with an explicit locale and time zone. Left to the
   defaults, the server and the browser can disagree and React reports a
   hydration mismatch on what is only a difference of opinion about noon.
   ========================================================================== */

import { PORTAL_TIME_ZONE, calendarDayDelta, zonedParts } from "@/lib/timezone";

const LOCALE = "en-GB";
const ZONE = PORTAL_TIME_ZONE;

const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: ZONE,
});

const shortDateFmt = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  timeZone: ZONE,
});

const weekdayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "long", timeZone: ZONE });

const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: ZONE,
});

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function formatShortDate(iso: string): string {
  return shortDateFmt.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function formatWeekday(iso: string): string {
  return weekdayFmt.format(new Date(iso));
}

/** "Thursday · 18:00" — the shape used on lesson cards. */
export function formatDayAndTime(iso: string): string {
  return `${formatWeekday(iso)} · ${formatTime(iso)}`;
}

/** "Thursday 4 September · 18:00" for anything more than a week out. */
export function formatFullWhen(iso: string): string {
  return `${formatWeekday(iso)} ${formatShortDate(iso)} · ${formatTime(iso)}`;
}

/** "Today", "Tomorrow", "Thursday", or a date. Used wherever a person would
 *  say it that way rather than reading out the full date. */
export function relativeDayLabel(iso: string, now = new Date()): string {
  const delta = calendarDayDelta(new Date(iso), now);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  if (delta > 1 && delta < 7) return formatWeekday(iso);
  if (delta < -1 && delta > -7) return `${Math.abs(delta)} days ago`;
  return formatShortDate(iso);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** "04:21" — transcript timestamps, which are offsets rather than clock times. */
export function formatOffset(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function greeting(now = new Date()): string {
  const { hour } = zonedParts(now);
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Datetime-local input values are naive local times, not ISO instants. */
export function toDateTimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Money held in minor units, as it is stored on an order.
 *
 * Cents appear only when there are cents. Package prices are whole by
 * construction, so a trailing ".00" everywhere would be noise; a tax line or a
 * part-refund is not whole, and rounding it on a screen somebody checks against
 * their bank statement would be a lie rather than a tidy-up.
 *
 * `catalogue.formatMoney` is the marketing-side sibling: major units, a closed
 * set of currencies, never any cents.
 */
export function formatMoneyMinor(minor: number, currency: string): string {
  const digits = minor % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 100);
}
