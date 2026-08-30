import "server-only";

import { randomUUID } from "node:crypto";

import { GoogleApiError, type TokenSet } from "@/lib/google/oauth";
import { parseMeetingLink } from "@/lib/meetings/links";
import { PORTAL_TIME_ZONE } from "@/lib/timezone";

/* ==========================================================================
   Google Calendar
   --------------------------------------------------------------------------
   Creating the calendar event is how a real Google Meet link comes into
   existence. There is no separate "create a Meet" API: you ask Calendar for an
   event with a conference attached, and it mints one.

   Two details are easy to get wrong and silently produce an event with no Meet
   link at all. The request must carry conferenceDataVersion=1, or the
   conferenceData block is accepted and ignored. And the createRequest needs a
   requestId that is stable for a given attempt — Google treats it as an
   idempotency key, so a retry with the same id returns the same conference
   rather than minting a second one.
   ========================================================================== */

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

export interface CalendarEventInput {
  calendarId: string;
  summary: string;
  description: string;
  startIso: string;
  durationMinutes: number;
  /** Everyone who should get the invitation. */
  attendees: { email: string; displayName?: string }[];
  /** Stable per lesson, so a retried create does not produce two conferences. */
  idempotencyKey: string;
}

export interface CalendarEvent {
  eventId: string;
  calendarId: string;
  /** The Meet link, or null if Google declined to attach a conference. */
  meetUrl: string | null;
  htmlLink: string | null;
}

interface GoogleEventResponse {
  id: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
    createRequest?: { status?: { statusCode?: string } };
  };
}

async function call(
  token: string,
  path: string,
  init: RequestInit & { query?: Record<string, string> } = {},
): Promise<unknown> {
  const url = new URL(`${CALENDAR_BASE}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);

  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (response.status === 204) return null;

  const text = await response.text();
  if (!response.ok) {
    throw new GoogleApiError(
      `Google Calendar returned ${response.status}: ${text.slice(0, 300)}`,
      response.status,
      response.status === 401,
    );
  }

  return text ? JSON.parse(text) : null;
}

function readMeetUrl(event: GoogleEventResponse): string | null {
  /* hangoutLink is the convenient field, but it is not always populated on the
     create response even when the conference exists — the entry points are.
     Both are checked, and the result is run through the portal's own parser so
     what gets stored is in the same canonical shape as a pasted link. */
  const fromEntryPoint = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video" && entry.uri,
  )?.uri;

  return parseMeetingLink(event.hangoutLink ?? fromEntryPoint ?? null)?.url ?? null;
}

/**
 * Create the lesson's calendar event and, with it, a Google Meet link.
 *
 * Attendees are invited by email, which is what puts the lesson in the
 * student's own calendar with the link already in it — the thing that actually
 * stops "what was the link again?" ten minutes before a lesson.
 */
export async function createLessonEvent(
  token: string,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  const start = new Date(input.startIso);
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);

  const body = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: start.toISOString(), timeZone: PORTAL_TIME_ZONE },
    end: { dateTime: end.toISOString(), timeZone: PORTAL_TIME_ZONE },
    attendees: input.attendees.map((a) => ({ email: a.email, displayName: a.displayName })),
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    /* A lesson is not a party. Nobody outside it should be able to see who
       else is on the invitation. */
    guestsCanSeeOtherGuests: false,
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 10 },
        { method: "email", minutes: 60 },
      ],
    },
    conferenceData: {
      createRequest: {
        requestId: input.idempotencyKey,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  const event = (await call(token, `/calendars/${encodeURIComponent(input.calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(body),
    query: {
      // Without this the conferenceData above is silently dropped.
      conferenceDataVersion: "1",
      sendUpdates: "all",
    },
  })) as GoogleEventResponse;

  return {
    eventId: event.id,
    calendarId: input.calendarId,
    meetUrl: readMeetUrl(event),
    htmlLink: event.htmlLink ?? null,
  };
}

/** Move or retitle an existing event. The Meet link survives; that is the
 *  point of updating rather than recreating. */
export async function updateLessonEvent(
  token: string,
  calendarId: string,
  eventId: string,
  patch: {
    summary?: string;
    description?: string;
    startIso?: string;
    durationMinutes?: number;
  },
): Promise<CalendarEvent> {
  const body: Record<string, unknown> = {};
  if (patch.summary !== undefined) body.summary = patch.summary;
  if (patch.description !== undefined) body.description = patch.description;

  if (patch.startIso && patch.durationMinutes) {
    const start = new Date(patch.startIso);
    const end = new Date(start.getTime() + patch.durationMinutes * 60_000);
    body.start = { dateTime: start.toISOString(), timeZone: PORTAL_TIME_ZONE };
    body.end = { dateTime: end.toISOString(), timeZone: PORTAL_TIME_ZONE };
  }

  const event = (await call(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
      query: { conferenceDataVersion: "1", sendUpdates: "all" },
    },
  )) as GoogleEventResponse;

  return {
    eventId: event.id,
    calendarId,
    meetUrl: readMeetUrl(event),
    htmlLink: event.htmlLink ?? null,
  };
}

/** Cancel the event and tell the attendees. A 404 or 410 means it is already
 *  gone, which is the outcome we wanted. */
export async function cancelLessonEvent(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    await call(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE", query: { sendUpdates: "all" } },
    );
  } catch (error) {
    if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return;
    throw error;
  }
}

/** A fresh request id for a create attempt. Kept here so the one caller that
 *  needs to persist it across a retry has an obvious place to get it. */
export function newConferenceRequestId(): string {
  return randomUUID();
}

export type { TokenSet };
