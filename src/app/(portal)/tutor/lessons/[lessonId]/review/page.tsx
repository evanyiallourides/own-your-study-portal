import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { LessonReviewForm } from "@/components/portal/lesson-review-form";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { requireTeachingAccess } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Review lesson notes" };
export const dynamic = "force-dynamic";

export default async function TutorLessonReview({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const session = await requireTeachingAccess();
  const repo = await repositoryFor(session);

  const lesson = await repo.getLesson(lessonId);
  if (!lesson) notFound();
  const notes = await repo.getLessonNotesForTutor(lessonId).catch(() => null);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/tutor/lessons/${lessonId}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors hover:text-accent"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Back to the lesson
        </Link>
        <h1 className="mt-4 font-display text-3xl font-semibold">
          {lesson.published ? "Edit the write-up" : "Review and publish"}
        </h1>
        <p className="mt-2 text-ink-500">
          {lesson.student.profile.fullName} · {lesson.subject.displayName} ·{" "}
          {formatDate(lesson.scheduledAt)}
        </p>
      </div>

      <LessonReviewForm lesson={lesson} notes={notes} />
    </div>
  );
}
