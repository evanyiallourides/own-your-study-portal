import Link from "next/link";

import { JoinLessonButton } from "@/components/portal/join-lesson";
import { FileIcon, TranscriptIcon, VideoIcon } from "@/components/ui/icons";
import { Badge, cx } from "@/components/ui/primitives";
import { formatDuration, formatTime } from "@/lib/format";
import { joinButtonProps } from "@/lib/meetings/present";
import { parseMeetingLink } from "@/lib/meetings/links";
import { LESSON_STATUS } from "@/lib/status";
import type { LessonWithContext } from "@/lib/types";

/* ==========================================================================
   Today, as a timetable
   --------------------------------------------------------------------------
   A tutor's day is a sequence, and a grid of equal cards throws that away —
   two lessons four hours apart look exactly like two back to back. So this is
   a time-led list: the hour in the left rail, everything else hanging off it,
   in order.

   Denser than the student's lesson cards on purpose. A student reads their
   dashboard; a tutor scans it between lessons and needs the next hour visible
   without scrolling.
   ========================================================================== */

export function TutorTimetable({ lessons }: { lessons: LessonWithContext[] }) {
  return (
    <ol className="overflow-hidden rounded-[14px] border border-rule bg-paper-3">
      {lessons.map((lesson, index) => (
        <TimetableRow key={lesson.id} lesson={lesson} first={index === 0} />
      ))}
    </ol>
  );
}

function TimetableRow({ lesson, first }: { lesson: LessonWithContext; first: boolean }) {
  const status = LESSON_STATUS[lesson.status];
  const link = parseMeetingLink(lesson.meetingUrl);
  const staffCanSee = true;

  return (
    <li className={cx("flex flex-wrap gap-x-5 gap-y-3 p-4 sm:p-5", !first && "border-t border-rule")}>
      {/* The time is the anchor, so it gets the display face and its own
          column rather than being one more line of body copy. */}
      <div className="w-14 shrink-0">
        <p className="font-display text-xl leading-none font-semibold tabular-nums text-ink">
          {formatTime(lesson.scheduledAt)}
        </p>
        <p className="mt-1.5 text-xs text-ink-300">{formatDuration(lesson.durationMinutes)}</p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={`/tutor/lessons/${lesson.id}`}
            className="font-display text-lg leading-tight font-semibold text-ink hover:text-accent"
          >
            {lesson.student.profile.fullName}
          </Link>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>

        <p className="mt-0.5 text-sm text-ink-500">
          {lesson.subject.displayName}
          {lesson.title ? <> &middot; {lesson.title}</> : null}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-300">
          {link ? (
            <span className="inline-flex items-center gap-1.5">
              <VideoIcon className="h-3.5 w-3.5" />
              {link.label}
              {link.code ? <code className="font-mono text-ink-500">{link.code}</code> : null}
            </span>
          ) : (
            <span className="text-warning">No meeting link</span>
          )}
          {lesson.hasTranscript && staffCanSee ? (
            <span className="inline-flex items-center gap-1">
              <TranscriptIcon className="h-3.5 w-3.5" />
              Transcript
            </span>
          ) : null}
          {lesson.fileCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <FileIcon className="h-3.5 w-3.5" />
              {lesson.fileCount}
            </span>
          ) : null}
        </div>
      </div>

      {/* Its own line on a phone. Competing for width with the lesson title
          squeezes the body into a column two words wide, which is how a dense
          layout stops being readable and starts being merely small. */}
      <div className="flex basis-full items-start sm:basis-auto sm:shrink-0">
        <JoinLessonButton {...joinButtonProps(lesson)} size="sm" />
      </div>
    </li>
  );
}
