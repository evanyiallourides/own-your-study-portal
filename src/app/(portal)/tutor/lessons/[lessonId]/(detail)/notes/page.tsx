import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { LessonSummary } from "@/components/portal/lesson-summary";
import { ShieldIcon } from "@/components/ui/icons";
import { Rule } from "@/components/ui/primitives";
import { requireTeachingAccess } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { loadLesson } from "@/lib/data/cached";

export const metadata: Metadata = { title: "Lesson notes" };
export const dynamic = "force-dynamic";

/** The tutor's read-only view of the write-up: exactly what the student sees,
 *  with the private notes appended below a rule so it is obvious which is
 *  which. */
export default async function TutorLessonNotes({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const session = await requireTeachingAccess();
  const repo = await repositoryFor(session);

  const lesson = await loadLesson(lessonId);
  if (!lesson) notFound();

  const notes = await repo.getLessonNotesForTutor(lessonId).catch(() => null);
  const { tutorPrivateNotes, ...studentFacing } = notes ?? { tutorPrivateNotes: null };

  return (
    <div className="space-y-8">
      <p className="text-sm text-ink-300">
        {lesson.published
          ? `This is what ${lesson.student.profile.firstName} sees.`
          : `A preview of what ${lesson.student.profile.firstName} will see once you publish.`}
      </p>

      <LessonSummary notes={notes ? (studentFacing as typeof notes) : null} />

      {tutorPrivateNotes ? (
        <>
          <Rule />
          <section className="rounded-[14px] border border-rule bg-paper-2/50 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ShieldIcon className="h-4 w-4 text-ink-500" />
              Private notes
            </p>
            <p className="mt-3 leading-relaxed whitespace-pre-line text-ink-700">
              {tutorPrivateNotes}
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
