import Link from "next/link";
import { notFound } from "next/navigation";

import { JoinLessonButton, MeetingDetails } from "@/components/portal/join-lesson";
import { AIProcessingStatus } from "@/components/portal/processing-status";
import { Tabs, type TabDef } from "@/components/portal/tabs";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { Badge, ButtonLink, Rule } from "@/components/ui/primitives";
import { requireTeachingAccess } from "@/lib/auth/session";
import { loadLesson, loadLessonFiles, loadTranscript } from "@/lib/data/cached";
import { env } from "@/lib/env";
import { formatDate, formatDuration, formatTime } from "@/lib/format";
import { parseMeetingLink } from "@/lib/meetings/links";
import { joinButtonProps } from "@/lib/meetings/present";
import { PLATFORM_LABEL } from "@/lib/status";

export const dynamic = "force-dynamic";

/* Scoped to the (detail) group so it wraps Overview, Notes, Transcript and
   Board & files — but not the review page, which is a full-screen editing task
   with a header of its own and no business carrying a tab strip. */
export default async function TutorLessonLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lessonId: string }>;
}) {
  await requireTeachingAccess();
  const { lessonId } = await params;

  const lesson = await loadLesson(lessonId);
  if (!lesson) notFound();

  const link = parseMeetingLink(lesson.meetingUrl);
  const meeting = link ? { label: link.label, code: link.code } : null;

  const [transcript, files] = await Promise.all([
    loadTranscript(lessonId).catch(() => null),
    loadLessonFiles(lessonId).catch(() => []),
  ]);

  const base = `/tutor/lessons/${lessonId}`;
  const tabs: TabDef[] = [
    { href: base, label: "Overview" },
    { href: `${base}/notes`, label: "Notes" },
    {
      href: `${base}/transcript`,
      label: "Transcript",
      disabled: !transcript || transcript.processingStatus !== "ready",
    },
    {
      href: `${base}/files`,
      label: "Board & files",
      hint: files.length > 0 ? String(files.length) : undefined,
    },
  ];

  const needsReview = lesson.status === "review_required";

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/tutor/lessons"
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors hover:text-accent"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          All lessons
        </Link>

        <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-semibold sm:text-4xl">
              {lesson.title ?? "Lesson"}
            </h1>
            <p className="mt-1.5 text-lg text-ink-500">
              <Link
                href={`/tutor/students/${lesson.studentId}`}
                className="hover:text-accent hover:underline"
              >
                {lesson.student.profile.fullName}
              </Link>{" "}
              · {lesson.subject.displayName}
            </p>
            <p className="mt-4 text-sm text-ink-500">
              {formatDate(lesson.scheduledAt)} · {formatTime(lesson.scheduledAt)} ·{" "}
              {formatDuration(lesson.durationMinutes)} · {PLATFORM_LABEL[lesson.meetingPlatform]}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <JoinLessonButton {...joinButtonProps(lesson)} size="sm" />
            <ButtonLink href={`${base}/review`} variant={needsReview ? "solid" : "outline"}>
              {needsReview ? "Review & publish" : "Edit write-up"}
            </ButtonLink>
          </div>
        </header>

        {/* The tutor is the one who hands the link out, so this is where the
            code to read aloud and the invite link to paste into a message
            live. The invite link is the portal's, not the meeting's. */}
        {meeting ? (
          <div className="mt-5">
            <MeetingDetails lessonId={lesson.id} meeting={meeting} appUrl={env.appUrl} />
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <AIProcessingStatus
            status={lesson.status}
            audience="staff"
            error={lesson.processingError}
          />
          {/* Only the negative case gets a badge. When a lesson is published the
              status line beside it already says so, and two labels making the
              same claim is how a reader stops trusting either. */}
          {lesson.published ? null : <Badge>Not visible to the student</Badge>}
        </div>
      </div>

      <Rule />
      <Tabs tabs={tabs} ariaLabel="Lesson sections" />
      <div className="pt-2">{children}</div>
    </div>
  );
}
