import Link from "next/link";
import { notFound } from "next/navigation";

import { JoinLessonButton } from "@/components/portal/join-lesson";
import { AIProcessingStatus } from "@/components/portal/processing-status";
import { Tabs, type TabDef } from "@/components/portal/tabs";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { Rule } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth/session";
import { loadLesson, loadLessonFiles, loadLessonNotes, loadTranscript } from "@/lib/data/cached";
import { formatDate, formatDuration, formatTime } from "@/lib/format";
import { joinButtonProps } from "@/lib/meetings/present";

export const dynamic = "force-dynamic";

export default async function StudentLessonLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lessonId: string }>;
}) {
  await requireRole("student");
  const { lessonId } = await params;

  const lesson = await loadLesson(lessonId);
  if (!lesson) notFound();

  // The tab strip should say what is actually behind each tab, so a student is
  // not sent to an empty transcript to find out there isn't one.
  const [notes, transcript, files] = await Promise.all([
    loadLessonNotes(lessonId).catch(() => null),
    loadTranscript(lessonId).catch(() => null),
    loadLessonFiles(lessonId).catch(() => []),
  ]);

  const base = `/student/lessons/${lessonId}`;
  const homeworkCount = notes?.homework.length ?? 0;

  const tabs: TabDef[] = [
    { href: base, label: "Overview" },
    { href: `${base}/notes`, label: "Notes", disabled: !notes },
    {
      href: `${base}/transcript`,
      label: "Transcript",
      disabled: !transcript || transcript.processingStatus !== "ready",
    },
    {
      href: `${base}/files`,
      label: "Board & files",
      hint: files.length > 0 ? String(files.length) : undefined,
      disabled: files.length === 0,
    },
    {
      href: `${base}/homework`,
      label: "Homework",
      hint: homeworkCount > 0 ? String(homeworkCount) : undefined,
      disabled: homeworkCount === 0,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/student/lessons"
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
            <p className="mt-1.5 text-lg text-ink-500">{lesson.subject.displayName}</p>
            <p className="mt-4 text-sm text-ink-500">
              {formatDate(lesson.scheduledAt)} · {formatTime(lesson.scheduledAt)} ·{" "}
              {formatDuration(lesson.durationMinutes)}
            </p>
            <p className="text-sm text-ink-500">{lesson.tutor.profile.fullName}</p>
          </div>

          <JoinLessonButton {...joinButtonProps(lesson)} />
        </header>

        <AIProcessingStatus status={lesson.status} audience="student" className="mt-5" />
      </div>

      <Rule />
      <Tabs tabs={tabs} ariaLabel="Lesson sections" />
      <div className="pt-2">{children}</div>
    </div>
  );
}
