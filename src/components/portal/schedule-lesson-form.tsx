"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { CheckIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/states";
import { createLesson } from "@/lib/actions/lessons";
import { parseMeetingLink } from "@/lib/meetings/links";
import type { Assignment } from "@/lib/types";

/**
 * The student and subject are chosen together, from the tutor's assignments —
 * not from two independent dropdowns. A tutor cannot construct a pairing they
 * are not assigned to, so an impossible combination is never on offer.
 */
export function ScheduleLessonForm({
  assignments,
  tutorId,
  notetakerAvailable,
  google,
}: {
  assignments: Assignment[];
  tutorId: string;
  notetakerAvailable: boolean;
  /** Whether this tutor can have a Meet link made for them, and why not. */
  google: { available: boolean; connected: boolean; email: string | null; blocker: string | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const options = useMemo(
    () => assignments.filter((a) => a.active && a.student && a.subject),
    [assignments],
  );

  const [pairKey, setPairKey] = useState(
    options[0] ? `${options[0].studentId}::${options[0].subjectId}` : "",
  );
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [duration, setDuration] = useState("60");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [notetaker, setNotetaker] = useState(false);
  const [createMeet, setCreateMeet] = useState(false);

  if (options.length === 0) {
    return (
      <div className="card p-5">
        <p className="text-sm text-ink-500">
          You have no active assignments, so there is nobody to book a lesson with yet. A
          coordinator assigns you to a student in a subject.
        </p>
      </div>
    );
  }

  const selected = options.find((a) => `${a.studentId}::${a.subjectId}` === pairKey);
  const link = parseMeetingLink(meetingUrl);
  /* Asking Google for a link and pasting one in are alternatives, not a
     combination — whichever the tutor did last is what they meant. */
  const canCreateMeet = google.available && google.connected && !link;
  const consentBlocked =
    notetaker &&
    selected?.student &&
    (!selected.student.consent.aiNotetakerConsent ||
      !selected.student.consent.transcriptionConsent ||
      (selected.student.consent.guardianConsentRequired &&
        !selected.student.consent.guardianConsentReceived));

  return (
    <form
      className="card space-y-5 p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        const [studentId, subjectId] = pairKey.split("::");
        if (!studentId || !subjectId) {
          setError("Choose a student and subject.");
          return;
        }
        setError(null);
        setDone(null);
        startTransition(async () => {
          const result = await createLesson({
            studentId,
            subjectId,
            tutorId,
            title,
            scheduledAt,
            durationMinutes: duration,
            meetingUrl,
            meetingPlatform: link?.platform ?? "google_meet",
            notetakerEnabled: notetaker && !consentBlocked,
            createMeetLink: canCreateMeet && createMeet,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setDone(
            result.data?.meetWarning
              ? `Lesson scheduled. ${result.data.meetWarning}`
              : "Lesson scheduled.",
          );
          setTitle("");
          setScheduledAt("");
          setMeetingUrl("");
          router.refresh();
        });
      }}
    >
      <h2 className="font-display text-lg font-semibold">Schedule a lesson</h2>

      {error ? <ErrorState title="Could not schedule that" description={error} /> : null}
      {done ? (
        <p
          role="status"
          className="rounded-[10px] border border-success/25 bg-success-wash px-4 py-2.5 text-sm font-medium text-success"
        >
          {done}
        </p>
      ) : null}

      <div>
        <label htmlFor="pair" className="field-label">
          Student and subject
        </label>
        <select
          id="pair"
          value={pairKey}
          onChange={(e) => setPairKey(e.target.value)}
          className="field"
          required
        >
          {options.map((a) => (
            <option key={a.id} value={`${a.studentId}::${a.subjectId}`}>
              {a.student!.profile.fullName} — {a.subject!.displayName}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="lesson-title" className="field-label">
          What you plan to cover <span className="font-normal normal-case">(optional)</span>
        </label>
        <input
          id="lesson-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="field"
          maxLength={200}
          placeholder="e.g. Reaction pathways and synthesis routes"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="when" className="field-label">
            Date and time
          </label>
          <input
            id="when"
            type="datetime-local"
            required
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="field"
          />
        </div>
        <div>
          <label htmlFor="duration" className="field-label">
            Length
          </label>
          <select
            id="duration"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="field"
          >
            {["30", "45", "60", "90", "120"].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Always shown, even when it cannot be used. A checkbox that appears
          only once everything is configured leaves a tutor with no idea the
          capability exists — the same reason the notetaker below explains
          itself when it is switched off rather than vanishing. */}
      <div className="rounded-[10px] border border-rule bg-paper-2/50 p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={canCreateMeet && createMeet}
            onChange={(e) => setCreateMeet(e.target.checked)}
            disabled={!canCreateMeet}
            className="mt-1 h-4 w-4 shrink-0 accent-[#635bff]"
          />
          <span>
            <span className="font-medium text-ink">Create a Google Meet link</span>
            <span className="mt-1 block text-sm text-ink-500">
              {!google.available ? (
                google.blocker
              ) : !google.connected ? (
                <>
                  Connect your Google Calendar in{" "}
                  <a href="/profile" className="font-medium text-accent underline">
                    your profile
                  </a>{" "}
                  and the portal can make the link and invite your student for you.
                </>
              ) : link ? (
                "You have pasted a link in below, so no new one will be created."
              ) : (
                <>
                  A Meet link is created and the lesson is added to your calendar and your
                  student&rsquo;s, using {google.email}.
                </>
              )}
            </span>
          </span>
        </label>
      </div>

      <div>
        <label htmlFor="url" className="field-label">
          {canCreateMeet && createMeet ? "Meeting link (not needed)" : "Meeting link"}
        </label>
        <input
          id="url"
          type="text"
          inputMode="url"
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
          className="field"
          placeholder="https://meet.google.com/abc-defg-hij"
          aria-describedby="url-hint"
        />

        {/* The platform is read off the link rather than chosen separately.
            A dropdown that can disagree with the URL beside it is a field
            whose only job is to be wrong occasionally. */}
        <p id="url-hint" className="mt-2 text-sm text-ink-400" aria-live="polite">
          {link ? (
            <span className="inline-flex flex-wrap items-center gap-x-2 text-ink-500">
              <CheckIcon className="text-accent" />
              <span>
                {link.label}
                {link.code ? (
                  <>
                    {" "}
                    · <code className="font-mono text-ink">{link.code}</code>
                  </>
                ) : null}
              </span>
            </span>
          ) : meetingUrl.trim() ? (
            <span className="text-warning">
              That does not look like a meeting link yet. Paste the full URL, or a Google Meet
              code like abc-defg-hij.
            </span>
          ) : (
            "Paste a Google Meet, Zoom or Teams link. You can add it later, but the notetaker needs one to join."
          )}
        </p>
      </div>

      <div className="rounded-[10px] border border-rule bg-paper-2/50 p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={notetaker}
            onChange={(e) => setNotetaker(e.target.checked)}
            disabled={!notetakerAvailable}
            className="mt-1 h-4 w-4 shrink-0 accent-[#635bff]"
          />
          <span>
            <span className="font-medium text-ink">Send the AI Notetaker to this lesson</span>
            <span className="mt-1 block text-sm text-ink-500">
              {notetakerAvailable
                ? "The bot joins the meeting under its own name, produces a transcript, and drafts a write-up for you to review."
                : "The notetaker is switched off for the organisation. An administrator can enable it in Settings."}
            </span>
          </span>
        </label>

        {consentBlocked ? (
          <p className="mt-3 rounded-[8px] border border-warning/25 bg-warning-wash px-3 py-2 text-sm text-warning">
            Consent for {selected?.student?.profile.firstName} is not complete, so the notetaker
            will not be scheduled. An administrator can record consent on the student&rsquo;s
            record.
          </p>
        ) : null}
      </div>

      <Button type="submit" variant="solid" disabled={pending}>
        {pending ? "Scheduling…" : "Schedule lesson"}
      </Button>
    </form>
  );
}
