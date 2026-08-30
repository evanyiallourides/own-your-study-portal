"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { JoinLessonButton } from "@/components/portal/join-lesson";
import { CalendarIcon, CheckIcon, CopyIcon, SparkIcon, VideoIcon } from "@/components/ui/icons";
import { Badge, Button, cx } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { generateMeetLink } from "@/lib/actions/lessons";
import type { JoinButtonProps } from "@/lib/meetings/present";

/* ==========================================================================
   Meeting links
   --------------------------------------------------------------------------
   One place on the dashboard that answers the question a tutor actually has
   before a day's teaching: does every lesson I am about to run have a link,
   and if not, can I fix that from here.

   It is a worklist, not a lesson list. The lessons with a link are the boring
   ones, so they collapse to a line; the ones without are the reason to look at
   this at all, and they get the button. Rows the tutor cannot act on — a
   pasted link, someone else's meeting — say so rather than offering a control
   that would refuse.
   ========================================================================== */

export interface MeetingRow {
  lessonId: string;
  studentName: string;
  subject: string;
  when: string;
  /** Null when nothing has been set on the lesson yet. */
  meeting: { label: string; code: string | null } | null;
  /** True when the portal minted this link and can therefore move it. */
  managed: boolean;
  join: JoinButtonProps;
}

interface Props {
  rows: MeetingRow[];
  /** Where this tutor stands with Google, and why not, if not. */
  google: { available: boolean; connected: boolean; email: string | null; blocker: string | null };
  appUrl: string;
}

export function MeetingLinksPanel({ rows, google, appUrl }: Props) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<VideoIcon className="h-7 w-7" />}
        title="No lessons to set up"
        description="Once you have a lesson booked, its meeting link lives here."
      />
    );
  }

  const missing = rows.filter((row) => !row.meeting).length;

  return (
    <div className="space-y-4">
      <ConnectionLine google={google} missing={missing} />

      <ul className="space-y-3">
        {rows.map((row) => (
          <MeetingLinkRow key={row.lessonId} row={row} google={google} appUrl={appUrl} />
        ))}
      </ul>
    </div>
  );
}

/* -- the state of play ---------------------------------------------------- */

function ConnectionLine({
  google,
  missing,
}: {
  google: Props["google"];
  missing: number;
}) {
  if (missing === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-500">
        <CheckIcon className="text-accent" />
        Every lesson here has a link.
      </p>
    );
  }

  if (google.available && google.connected) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
        <CalendarIcon className="text-ink-400" />
        {missing} {missing === 1 ? "lesson needs" : "lessons need"} a link. Creating one also puts
        the lesson in your calendar and your student&rsquo;s, using {google.email}.
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-start gap-2 rounded-[10px] border border-rule bg-paper-2/60 px-4 py-3 text-sm text-ink-500">
      <CalendarIcon className="mt-0.5 shrink-0 text-ink-400" />
      <span>
        {missing} {missing === 1 ? "lesson needs" : "lessons need"} a link.{" "}
        {!google.available ? (
          google.blocker
        ) : (
          <>
            <a href="/profile" className="font-medium text-accent underline">
              Connect your Google Calendar
            </a>{" "}
            and the portal can create them for you. Until then, paste a link on each lesson page.
          </>
        )}
      </span>
    </p>
  );
}

/* -- one lesson ----------------------------------------------------------- */

function MeetingLinkRow({
  row,
  google,
  appUrl,
}: {
  row: MeetingRow;
  google: Props["google"];
  appUrl: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const canCreate = google.available && google.connected;

  return (
    <li
      className={cx(
        "card p-4 sm:p-5",
        !row.meeting && "border-warning/30 bg-warning-wash/40",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold text-ink">{row.studentName}</p>
          <p className="text-sm text-ink-500">
            {row.subject} &middot; {row.when}
          </p>

          {row.meeting ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
              <span className="inline-flex items-center gap-1.5">
                <VideoIcon className="h-4 w-4" />
                {row.meeting.label}
              </span>
              {row.meeting.code ? (
                <code className="font-mono text-xs text-ink">{row.meeting.code}</code>
              ) : null}
              {row.managed ? (
                <Badge tone="accent">
                  <SparkIcon className="h-3.5 w-3.5" />
                  Created for you
                </Badge>
              ) : (
                <span className="text-xs text-ink-300">Added by hand</span>
              )}
            </p>
          ) : (
            <p className="mt-2 text-sm text-warning">No meeting link yet</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {row.meeting ? (
            <>
              <CopyInvite lessonId={row.lessonId} appUrl={appUrl} />
              <JoinLessonButton {...row.join} size="sm" />
            </>
          ) : (
            <Button
              type="button"
              variant="solid"
              disabled={!canCreate || pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await generateMeetLink(row.lessonId);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  router.refresh();
                })
              }
            >
              <VideoIcon />
              {pending ? "Creating…" : "Create Meet link"}
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-warning">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/* The invite link is the portal's own join URL, not the meeting's — it works
   for whoever is entitled to the lesson and stops working when they are not. */
function CopyInvite({ lessonId, appUrl }: { lessonId: string; appUrl: string }) {
  const [state, setState] = useState<"idle" | "copied" | "refused">("idle");
  const value = `${appUrl.replace(/\/+$/, "")}/lessons/${lessonId}/join`;

  if (state === "refused") {
    return (
      <input
        readOnly
        value={value}
        aria-label="Invite link"
        onFocus={(e) => e.currentTarget.select()}
        className="w-full max-w-[15rem] rounded-[6px] border border-rule bg-paper-2 px-2 py-1 font-mono text-xs text-ink-700"
      />
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("copied");
          window.setTimeout(() => setState("idle"), 2000);
        } catch {
          // Refused by permissions or focus. Show the link so it can still be
          // taken by hand rather than leaving the tutor with nothing.
          setState("refused");
        }
      }}
    >
      {state === "copied" ? <CheckIcon /> : <CopyIcon />}
      <span aria-live="polite">{state === "copied" ? "Copied" : "Invite"}</span>
    </Button>
  );
}
