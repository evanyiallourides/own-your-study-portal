import Link from "next/link";
import { notFound } from "next/navigation";

import { LessonSummary } from "@/components/portal/lesson-summary";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { Rule } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ParentLessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const session = await requireRole("parent");
  const repo = await repositoryFor(session);

  const lesson = await repo.getLesson(lessonId);
  if (!lesson) notFound();
  const notes = await repo.getLessonNotes(lessonId).catch(() => null);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/parent/lessons"
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors hover:text-accent"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          All lessons
        </Link>
        <h1 className="mt-4 font-display text-3xl font-semibold">{lesson.title ?? "Lesson"}</h1>
        <p className="mt-1.5 text-lg text-ink-500">{lesson.subject.displayName}</p>
        <p className="mt-4 text-sm text-ink-500">
          {formatDate(lesson.scheduledAt)} · {formatTime(lesson.scheduledAt)} ·{" "}
          {lesson.tutor.profile.fullName}
        </p>
      </div>

      <Rule />
      <LessonSummary notes={notes} />

      <Rule />
      <p className="text-xs leading-relaxed text-ink-300">
        Parents see the published write-up of a lesson. The transcript and the tutor&rsquo;s own
        notes are not shown here.
      </p>
    </div>
  );
}
