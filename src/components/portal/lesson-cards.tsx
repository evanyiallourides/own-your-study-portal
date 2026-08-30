import Link from "next/link";

import { CountdownNote } from "@/components/portal/countdown-note";
import { JoinLessonButton, JoinNowChip } from "@/components/portal/join-lesson";
import { FileIcon, TranscriptIcon } from "@/components/ui/icons";
import { Badge, ButtonLink, cx } from "@/components/ui/primitives";
import {
  formatDate,
  formatDayAndTime,
  formatDuration,
  formatFullWhen,
  formatTime,
  relativeDayLabel,
} from "@/lib/format";
import { joinButtonProps } from "@/lib/meetings/present";
import { LESSON_STATUS, PLATFORM_LABEL } from "@/lib/status";
import type { LessonWithContext, UserRole } from "@/lib/types";

/** Where a lesson lives for each role. One function so a route rename is a
 *  one-line change rather than a search. */
export function lessonHref(role: UserRole, lessonId: string): string {
  switch (role) {
    case "tutor":
      return `/tutor/lessons/${lessonId}`;
    case "admin":
      return `/admin/lessons/${lessonId}`;
    case "parent":
      return `/parent/lessons/${lessonId}`;
    default:
      return `/student/lessons/${lessonId}`;
  }
}

/* ==========================================================================
   Next lesson — the single most-looked-at card in the product
   ========================================================================== */

export function NextLessonCard({
  lesson,
  role,
  audience,
}: {
  lesson: LessonWithContext;
  role: UserRole;
  /** Whose name to show beside the subject: a student wants the tutor, a
   *  tutor wants the student. */
  audience: "student" | "tutor";
}) {
  const counterpart =
    audience === "student" ? lesson.tutor.profile.fullName : lesson.student.profile.fullName;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-6 p-5 sm:p-7 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="eyebrow mb-3">Next lesson</p>
          <h2 className="font-display text-2xl leading-tight text-ink">
            {lesson.subject.displayName}
          </h2>
          <p className="mt-1 text-ink-500">{counterpart}</p>

          <p className="mt-4 text-lg font-medium text-ink">
            {relativeDayLabel(lesson.scheduledAt)} · {formatTime(lesson.scheduledAt)}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {formatFullWhen(lesson.scheduledAt)} · {formatDuration(lesson.durationMinutes)} ·{" "}
            {PLATFORM_LABEL[lesson.meetingPlatform]}
          </p>
          {lesson.title ? (
            <p className="mt-3 text-sm text-ink-700">Planned: {lesson.title}</p>
          ) : null}
          <CountdownNote iso={lesson.scheduledAt} durationMinutes={lesson.durationMinutes} />
        </div>

        <div className="flex shrink-0 flex-col gap-2 md:items-end">
          <JoinLessonButton {...joinButtonProps(lesson)} />
          <ButtonLink href={lessonHref(role, lesson.id)} variant="ghost">
            Lesson details
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

/* ==========================================================================
   Lesson row — used in every list of lessons
   ========================================================================== */

export function LessonCard({
  lesson,
  role,
  audience,
  showSubject = true,
}: {
  lesson: LessonWithContext;
  role: UserRole;
  audience: "student" | "tutor";
  showSubject?: boolean;
}) {
  const status = LESSON_STATUS[lesson.status];
  const staffSide = role === "tutor" || role === "admin";
  const counterpart =
    audience === "student" ? lesson.tutor.profile.fullName : lesson.student.profile.fullName;

  return (
    <li>
      <Link
        href={lessonHref(role, lesson.id)}
        className="card card-interactive block p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-ink-300">
              {relativeDayLabel(lesson.scheduledAt)} · {formatTime(lesson.scheduledAt)}
              {showSubject ? <> · {lesson.subject.displayName}</> : null}
            </p>
            <h3 className="mt-1 truncate font-display text-lg font-semibold text-ink">
              {lesson.title ?? "Lesson"}
            </h3>
            <p className="mt-0.5 text-sm text-ink-500">{counterpart}</p>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-300">
          <JoinNowChip
            scheduledAt={lesson.scheduledAt}
            durationMinutes={lesson.durationMinutes}
            status={lesson.status}
            hasLink={Boolean(lesson.meetingUrl)}
          />
          <span>{formatDate(lesson.scheduledAt)}</span>
          {lesson.hasNotes && (lesson.published || staffSide) ? <span>Notes</span> : null}
          {lesson.hasTranscript && (lesson.published || staffSide) ? (
            <span className="inline-flex items-center gap-1">
              <TranscriptIcon className="h-3.5 w-3.5" />
              Transcript
            </span>
          ) : null}
          {lesson.fileCount > 0 && (lesson.published || staffSide) ? (
            <span className="inline-flex items-center gap-1">
              <FileIcon className="h-3.5 w-3.5" />
              {lesson.fileCount} {lesson.fileCount === 1 ? "file" : "files"}
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

/* ==========================================================================
   Today's lesson — the tutor's home page card
   ========================================================================== */

export function TodayLessonCard({ lesson }: { lesson: LessonWithContext }) {
  const status = LESSON_STATUS[lesson.status];
  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-2xl leading-none text-ink">
            {formatTime(lesson.scheduledAt)}
          </p>
          <h3 className="mt-3 font-display text-lg font-semibold text-ink">
            {lesson.student.profile.fullName}
          </h3>
          <p className="text-sm text-ink-500">{lesson.subject.displayName}</p>
          {lesson.title ? <p className="mt-2 text-sm text-ink-700">{lesson.title}</p> : null}
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <ButtonLink href={`/tutor/lessons/${lesson.id}`} variant="outline">
          View lesson
        </ButtonLink>
        <JoinLessonButton {...joinButtonProps(lesson)} size="sm" />
      </div>
    </li>
  );
}

/* ==========================================================================
   Subject card
   ========================================================================== */

export function SubjectCard({
  href,
  subject,
  lessonCount,
  lastLessonTitle,
  nextLessonAt,
  tutorNames,
  openHomeworkCount,
}: {
  href: string;
  subject: { displayName: string };
  lessonCount: number;
  lastLessonTitle: string | null;
  nextLessonAt: string | null;
  tutorNames: string[];
  openHomeworkCount?: number;
}) {
  return (
    <li>
      <Link href={href} className="card card-interactive flex h-full flex-col p-5">
        <h3 className="font-display text-lg font-semibold text-ink">{subject.displayName}</h3>
        {tutorNames.length > 0 ? (
          <p className="mt-0.5 text-sm text-ink-500">{tutorNames.join(", ")}</p>
        ) : null}

        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex gap-2">
            <dt className="text-ink-300">Lessons</dt>
            <dd className="text-ink-700">{lessonCount}</dd>
          </div>
          {lastLessonTitle ? (
            <div className="flex gap-2">
              <dt className="shrink-0 text-ink-300">Last</dt>
              <dd className="truncate text-ink-700">{lastLessonTitle}</dd>
            </div>
          ) : null}
          <div className="flex gap-2">
            <dt className="shrink-0 text-ink-300">Next</dt>
            <dd className={cx("truncate", nextLessonAt ? "text-ink-700" : "text-ink-300")}>
              {nextLessonAt ? formatDayAndTime(nextLessonAt) : "Not booked"}
            </dd>
          </div>
        </dl>

        {openHomeworkCount ? (
          <p className="mt-4 text-xs font-semibold text-warning">
            {openHomeworkCount} {openHomeworkCount === 1 ? "task" : "tasks"} outstanding
          </p>
        ) : null}
      </Link>
    </li>
  );
}
