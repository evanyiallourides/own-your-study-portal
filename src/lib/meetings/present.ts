/* ==========================================================================
   Presenting a meeting
   --------------------------------------------------------------------------
   The bridge between a lesson row and the join control. It runs on the server,
   which is the point: the meeting URL is read here, reduced to the few facts
   the interface needs — which platform, what code — and the URL itself stays
   behind. What reaches the browser is a label, a code and a state.
   ========================================================================== */

import { parseMeetingLink } from "@/lib/meetings/links";
import { joinWindow } from "@/lib/meetings/window";
import type { JoinState } from "@/lib/meetings/window";
import type { Lesson } from "@/lib/types";

export interface JoinButtonProps {
  lessonId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: Lesson["status"];
  hasLink: boolean;
  meeting: { label: string; code: string | null } | null;
  initialState: JoinState;
  /** So the server-rendered button already says "Opens in 2 days" rather than
   *  a vague placeholder that the clock corrects a moment later. */
  initialMsUntilOpen: number;
}

/** Everything <JoinLessonButton> needs, and nothing it does not. */
export function joinButtonProps(lesson: Lesson): JoinButtonProps {
  const link = parseMeetingLink(lesson.meetingUrl);
  const gate = joinWindow(lesson);

  return {
    lessonId: lesson.id,
    scheduledAt: lesson.scheduledAt,
    durationMinutes: lesson.durationMinutes,
    status: lesson.status,
    hasLink: link !== null,
    meeting: link ? { label: link.label, code: link.code } : null,
    initialState: gate.state,
    initialMsUntilOpen: gate.msUntilOpen,
  };
}

/**
 * The platform to record against a lesson.
 *
 * Detected from the link rather than taken from whatever was selected in a
 * dropdown, because the two disagree the moment somebody pastes a Zoom link
 * into a lesson still marked as Google Meet — and the link is the fact.
 */
export function platformForLink(
  raw: string | null,
  fallback: Lesson["meetingPlatform"] = "google_meet",
): Lesson["meetingPlatform"] {
  return parseMeetingLink(raw)?.platform ?? fallback;
}

/** The canonical form of a pasted link, or null. Written to the database so
 *  every consumer sees the same tidy URL. */
export function canonicalMeetingUrl(raw: string | null): string | null {
  return parseMeetingLink(raw)?.url ?? null;
}
