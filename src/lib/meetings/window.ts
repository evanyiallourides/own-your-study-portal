/* ==========================================================================
   The join window
   --------------------------------------------------------------------------
   A lesson link is not useful for the whole week either side of the lesson.
   Left permanently live it invites people into an empty room on the wrong day;
   locked to the exact minute it punishes anyone who is early. So the link is
   given a window: it opens shortly before, stays open through the lesson, and
   closes a while after the end.

   This is a courtesy, not a security boundary. It stops confusion, not people
   — anyone who saved the underlying URL can still use it, which is why the
   consequential checks live in the database. What this does guarantee is that
   the portal never presents a stale link as if it were live.
   ========================================================================== */

import type { Lesson } from "@/lib/types";

/** Long enough to be settled before the hour, short enough that the link is
 *  not live during the tutor's previous lesson. */
export const JOIN_OPENS_MINUTES_BEFORE = 10;

/** Lessons overrun. Closing the door at the scheduled end would cut people off
 *  mid-sentence. */
export const JOIN_CLOSES_MINUTES_AFTER_END = 30;

export type JoinState =
  /** The lesson has a link, but it is not time yet. */
  | "early"
  /** Open — the tutor or student may join now. */
  | "open"
  /** The window has passed. */
  | "ended"
  /** No link was ever set. */
  | "no_link"
  /** Cancelled, or otherwise not a lesson anybody should be joining. */
  | "unavailable";

export interface JoinWindow {
  state: JoinState;
  /** When the link starts working. */
  opensAt: Date;
  /** When it stops being offered. */
  closesAt: Date;
  /** Scheduled end, which is what the interface should show as "until". */
  endsAt: Date;
  /** Milliseconds until the window opens; 0 once it has. */
  msUntilOpen: number;
  /** True between the scheduled start and end, so the UI can say "in progress"
   *  rather than merely "open". */
  inProgress: boolean;
  /** One sentence explaining the state, for when joining is not possible. */
  reason: string | null;
}

interface WindowInput {
  scheduledAt: string;
  durationMinutes: number;
  meetingUrl: string | null;
  status: Lesson["status"];
}

/**
 * Work out whether a lesson can be joined right now.
 *
 * `now` is a parameter rather than a call to `Date.now()` so that this is
 * pure: the same lesson and the same instant always give the same answer,
 * which is what makes it testable and what stops the server and the client
 * disagreeing about a countdown.
 */
export function joinWindow(lesson: WindowInput, now: Date = new Date()): JoinWindow {
  const start = new Date(lesson.scheduledAt);
  const endsAt = new Date(start.getTime() + lesson.durationMinutes * 60_000);
  const opensAt = new Date(start.getTime() - JOIN_OPENS_MINUTES_BEFORE * 60_000);
  const closesAt = new Date(endsAt.getTime() + JOIN_CLOSES_MINUTES_AFTER_END * 60_000);

  const base = { opensAt, closesAt, endsAt, msUntilOpen: 0, inProgress: false };

  if (lesson.status === "cancelled") {
    return { ...base, state: "unavailable", reason: "This lesson was cancelled." };
  }

  /* Once a lesson has been written up, the meeting is over regardless of the
     clock — a published lesson with a live link is a link to an empty room. */
  if (lesson.status === "published" || lesson.status === "review_required") {
    return { ...base, state: "ended", reason: "This lesson has finished." };
  }

  if (!lesson.meetingUrl) {
    return {
      ...base,
      state: "no_link",
      reason: "No meeting link has been added to this lesson yet.",
    };
  }

  if (now < opensAt) {
    return {
      ...base,
      state: "early",
      msUntilOpen: opensAt.getTime() - now.getTime(),
      reason: `The link opens ${JOIN_OPENS_MINUTES_BEFORE} minutes before the lesson starts.`,
    };
  }

  if (now > closesAt) {
    return { ...base, state: "ended", reason: "This lesson has finished." };
  }

  return { ...base, state: "open", inProgress: now >= start && now <= endsAt, reason: null };
}

/** "in 4 minutes", "in 2 hours", "on Thursday" — deliberately coarse, because
 *  a second-by-second countdown to a link opening is noise. */
export function untilOpenLabel(msUntilOpen: number): string {
  const minutes = Math.ceil(msUntilOpen / 60_000);
  if (minutes <= 1) return "in under a minute";
  if (minutes < 60) return `in ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in about ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/* A lesson that started twenty minutes ago and runs for an hour is still the
   next lesson as far as the person in it is concerned. Queries that cut at
   "now" drop it, so they reach back this far and let the window decide. */
export const IN_PROGRESS_LOOKBACK_MINUTES = 240;

/** The instant an "upcoming lessons" query should start from, so a lesson
 *  currently in progress is not filtered out before it can be shown. */
export function upcomingSince(now: Date = new Date()): string {
  return new Date(now.getTime() - IN_PROGRESS_LOOKBACK_MINUTES * 60_000).toISOString();
}

/** Drop the ones that are genuinely over, keeping any still in progress. */
export function stillRelevant<T extends { scheduledAt: string; durationMinutes: number; meetingUrl: string | null; status: Lesson["status"] }>(
  lessons: T[],
  now: Date = new Date(),
): T[] {
  return lessons.filter((lesson) => {
    const end = new Date(lesson.scheduledAt).getTime() + lesson.durationMinutes * 60_000;
    return end >= now.getTime();
  });
}
