"use client";

import { useState } from "react";

import { useClock } from "@/components/portal/clock";
import { cx } from "@/components/ui/primitives";
import { CheckIcon, ClockIcon, CopyIcon, VideoIcon } from "@/components/ui/icons";
import { joinWindow, untilOpenLabel, type JoinState } from "@/lib/meetings/window";
import type { LessonStatus } from "@/lib/types";

/* ==========================================================================
   Join lesson
   --------------------------------------------------------------------------
   The one control that takes somebody into a meeting, and the only place a
   meeting link is offered.

   It never carries the meeting URL. It points at /lessons/<id>/join, which
   checks entitlement and the clock at the moment of the click and only then
   redirects. That is what makes the button safe to render early and safe to
   leave sitting in an open tab: the decision is not baked into the HTML.

   The state shown here is computed twice — once on the server so the button is
   correct in the first paint, and again on each clock tick so a page left open
   through the start of a lesson turns the button live on its own rather than
   waiting for a refresh.
   ========================================================================== */

export interface MeetingSummary {
  /** "Google Meet", "Zoom", or a hostname. */
  label: string;
  /** "abc-defg-hij" — for reading out, never for linking. */
  code: string | null;
}

interface Props {
  lessonId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: LessonStatus;
  hasLink: boolean;
  meeting: MeetingSummary | null;
  /** Computed on the server, used until the clock takes over. */
  initialState: JoinState;
  initialMsUntilOpen: number;
  size?: "sm" | "md";
  className?: string;
}

export function JoinLessonButton({
  lessonId,
  scheduledAt,
  durationMinutes,
  status,
  hasLink,
  meeting,
  initialState,
  initialMsUntilOpen,
  size = "md",
  className,
}: Props) {
  const now = useClock();

  const gate =
    now === null
      ? null
      : joinWindow(
          {
            scheduledAt,
            durationMinutes,
            /* The URL itself is not sent to the browser; the window only needs
               to know whether one exists. */
            meetingUrl: hasLink ? "set" : null,
            status,
          },
          new Date(now),
        );

  const state: JoinState = gate?.state ?? initialState;
  const msUntilOpen = gate?.msUntilOpen ?? initialMsUntilOpen;

  const pad = size === "sm" ? "px-4 py-2 text-sm" : "px-5 py-2.5 text-sm";

  if (state === "open") {
    return (
      <a
        href={`/lessons/${lessonId}/join`}
        className={cx(
          "inline-flex items-center justify-center gap-2 rounded-full border-2 border-accent bg-accent font-semibold text-white transition-colors hover:border-accent-soft hover:bg-accent-soft",
          pad,
          className,
        )}
      >
        <VideoIcon />
        {gate?.inProgress ? "Join now" : "Join lesson"}
        {meeting ? <span className="sr-only"> on {meeting.label}</span> : null}
      </a>
    );
  }

  if (state === "early") {
    return (
      <span
        className={cx(
          "inline-flex items-center justify-center gap-2 rounded-full border border-rule bg-paper-2 font-semibold text-ink-400",
          pad,
          className,
        )}
        title={`The link opens ${untilOpenLabel(msUntilOpen)}.`}
      >
        <ClockIcon />
        Opens {untilOpenLabel(msUntilOpen)}
      </span>
    );
  }

  if (state === "no_link") {
    return <p className={cx("text-sm text-ink-300", className)}>No meeting link yet</p>;
  }

  /* "ended" and "unavailable" get nothing. A finished lesson's row is about
     the write-up, and a dead button beside it is only clutter. */
  return null;
}

/**
 * The meeting, spelled out: which platform, the code to read aloud, and a link
 * to share. The link shared is the portal's own join URL rather than the
 * meeting URL — it survives the meeting being moved, it stops working when
 * access does, and it lands the reader somewhere that can explain itself.
 */
export function MeetingDetails({
  lessonId,
  meeting,
  appUrl,
}: {
  lessonId: string;
  meeting: MeetingSummary;
  appUrl: string;
}) {
  const shareUrl = `${appUrl.replace(/\/+$/, "")}/lessons/${lessonId}/join`;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <span className="inline-flex items-center gap-2 text-ink-500">
        <VideoIcon />
        {meeting.label}
      </span>

      {meeting.code ? (
        <span className="text-ink-500">
          Code <code className="font-mono text-ink">{meeting.code}</code>
        </span>
      ) : null}

      <CopyButton value={shareUrl} />
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "refused">("idle");

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="inline-flex items-center gap-2 text-ink-400 transition-colors hover:text-ink"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState("copied");
            window.setTimeout(() => setState("idle"), 2000);
          } catch {
            /* The clipboard can be refused — by permissions, by the page not
               being focused, or by an insecure origin. Failing silently would
               leave the tutor with no link and no explanation, so the link is
               revealed instead and they can copy it by hand. */
            setState("refused");
          }
        }}
      >
        {state === "copied" ? <CheckIcon /> : <CopyIcon />}
        <span aria-live="polite">{state === "copied" ? "Copied" : "Copy invite link"}</span>
      </button>

      {state === "refused" ? (
        <input
          readOnly
          value={value}
          aria-label="Invite link"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full max-w-xs rounded-[6px] border border-rule bg-paper-2 px-2 py-1 font-mono text-xs text-ink-700 sm:w-auto"
        />
      ) : null}
    </span>
  );
}

/**
 * A marker for a lesson row whose link is live right now.
 *
 * A row in a list is already one big link to the lesson page, and an anchor
 * inside an anchor is not a thing HTML will do. So this says that the door is
 * open and lets the existing link carry the reader to where the door is.
 */
export function JoinNowChip({
  scheduledAt,
  durationMinutes,
  status,
  hasLink,
}: {
  scheduledAt: string;
  durationMinutes: number;
  status: LessonStatus;
  hasLink: boolean;
}) {
  const now = useClock();
  if (now === null || !hasLink) return null;

  const gate = joinWindow(
    { scheduledAt, durationMinutes, meetingUrl: "set", status },
    new Date(now),
  );
  if (gate.state !== "open") return null;

  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-accent">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      {gate.inProgress ? "Live now" : "Ready to join"}
    </span>
  );
}
