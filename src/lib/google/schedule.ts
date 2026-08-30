import "server-only";

import { env } from "@/lib/env";
import {
  cancelLessonEvent,
  createLessonEvent,
  updateLessonEvent,
} from "@/lib/google/calendar";
import { getAccessToken, markUsed } from "@/lib/google/connection";
import { GoogleApiError } from "@/lib/google/oauth";
import type { Repository } from "@/lib/data/repository";
import type { LessonWithContext } from "@/lib/types";

/* ==========================================================================
   Putting a lesson in Google
   --------------------------------------------------------------------------
   One place where a lesson, a tutor's connected calendar and the Meet API meet.

   The ordering matters. The lesson is created in the portal first and Google is
   asked second, so a Google outage costs you a meeting link and not the
   lesson. Every function here therefore returns a result rather than throwing:
   the caller has already committed something to the database and needs to
   report a partial success honestly, not unwind.
   ========================================================================== */

export type MeetResult =
  | { ok: true; meetUrl: string; eventId: string; htmlLink: string | null }
  | { ok: false; reason: string; needsReconnect: boolean };

function describe(error: unknown): { reason: string; needsReconnect: boolean } {
  if (error instanceof GoogleApiError) {
    return {
      reason: error.needsReconnect
        ? "Your Google connection has expired. Reconnect it in your profile and the link can be created."
        : "Google could not create the meeting just now.",
      needsReconnect: error.needsReconnect,
    };
  }
  return { reason: "Google could not create the meeting just now.", needsReconnect: false };
}

/** What the invitation says. The student sees this in their own calendar, so
 *  it is written for them rather than as an internal record. */
function eventText(lesson: LessonWithContext): { summary: string; description: string } {
  const summary = lesson.title
    ? `${lesson.subject.displayName} — ${lesson.title}`
    : `${lesson.subject.displayName} with ${lesson.tutor.profile.firstName}`;

  const lines = [
    `${lesson.subject.displayName} lesson with ${lesson.tutor.profile.fullName}.`,
    "",
    `Your notes, homework and the recording of what was covered appear in the portal afterwards:`,
    `${env.appUrl.replace(/\/+$/, "")}/lessons/${lesson.id}`,
  ];

  if (lesson.notetakerEnabled) {
    lines.push(
      "",
      "An AI notetaker will join this lesson under its own name to produce a transcript. Your tutor reviews everything it writes before you see it.",
    );
  }

  return { summary, description: lines.join("\n") };
}

/**
 * Create the calendar event, take the Meet link it mints, and record both
 * against the lesson.
 *
 * The lesson id is the conference request id. Google treats that as an
 * idempotency key, so a retry after a timeout attaches the same conference
 * instead of quietly creating a second one and leaving the first orphaned.
 */
export async function attachGoogleMeet(
  repo: Repository,
  lesson: LessonWithContext,
  organiserProfileId: string,
): Promise<MeetResult> {
  try {
    const { token, calendarId } = await getAccessToken(organiserProfileId);
    const { summary, description } = eventText(lesson);

    const event = await createLessonEvent(token, {
      calendarId,
      summary,
      description,
      startIso: lesson.scheduledAt,
      durationMinutes: lesson.durationMinutes,
      attendees: [
        { email: lesson.tutor.profile.email, displayName: lesson.tutor.profile.fullName },
        { email: lesson.student.profile.email, displayName: lesson.student.profile.fullName },
      ],
      idempotencyKey: `oys-lesson-${lesson.id}`,
    });

    if (!event.meetUrl) {
      /* The event exists but has no conference. Google does this when the
         account's organisation has Meet turned off. Leaving the event behind
         would be litter, so it is removed and the tutor is told what to do. */
      await cancelLessonEvent(token, calendarId, event.eventId).catch(() => undefined);
      return {
        ok: false,
        needsReconnect: false,
        reason:
          "Google made the calendar event but would not attach a Meet link — the account may not have Meet enabled. Paste a link in instead.",
      };
    }

    await repo.setLessonMeeting(lesson.id, {
      meetingUrl: event.meetUrl,
      meetingPlatform: "google_meet",
      googleEventId: event.eventId,
      googleCalendarId: event.calendarId,
      googleOwnerId: organiserProfileId,
      managed: true,
    });

    await markUsed(organiserProfileId);
    return { ok: true, meetUrl: event.meetUrl, eventId: event.eventId, htmlLink: event.htmlLink };
  } catch (error) {
    return { ok: false, ...describe(error) };
  }
}

/**
 * Keep an existing event in step after a lesson is moved or retitled.
 *
 * Only ever called for a lesson the portal created. A pasted link belongs to
 * whoever made it, and reaching into somebody else's calendar because a time
 * changed here is not ours to do.
 */
export async function syncGoogleMeet(
  lesson: LessonWithContext,
): Promise<{ ok: boolean; reason?: string }> {
  if (!lesson.meetLinkManaged || !lesson.googleEventId || !lesson.googleCalendarId) {
    return { ok: true };
  }

  const organiser = lesson.tutor.profileId;

  try {
    const { token } = await getAccessToken(organiser);
    const { summary, description } = eventText(lesson);
    await updateLessonEvent(token, lesson.googleCalendarId, lesson.googleEventId, {
      summary,
      description,
      startIso: lesson.scheduledAt,
      durationMinutes: lesson.durationMinutes,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: describe(error).reason };
  }
}

/** Cancel the calendar event when a lesson is cancelled, so the student's
 *  calendar does not keep claiming a lesson that is not happening. */
export async function cancelGoogleMeet(
  repo: Repository,
  lesson: LessonWithContext,
): Promise<{ ok: boolean; reason?: string }> {
  if (!lesson.meetLinkManaged || !lesson.googleEventId || !lesson.googleCalendarId) {
    return { ok: true };
  }

  try {
    const { token } = await getAccessToken(lesson.tutor.profileId);
    await cancelLessonEvent(token, lesson.googleCalendarId, lesson.googleEventId);

    await repo.setLessonMeeting(lesson.id, {
      meetingUrl: null,
      meetingPlatform: lesson.meetingPlatform,
      googleEventId: null,
      googleCalendarId: null,
      googleOwnerId: null,
      managed: false,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: describe(error).reason };
  }
}
