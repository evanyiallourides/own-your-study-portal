import type { Metadata } from "next";

import { SubjectCard } from "@/components/portal/lesson-cards";
import { SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";

export const metadata: Metadata = { title: "My subjects" };
export const dynamic = "force-dynamic";

export default async function StudentSubjects() {
  const session = await requireRole("student");
  const repo = await repositoryFor(session);
  if (!session.studentId) return null;

  const summaries = await repo.getSubjectSummaries(session.studentId);

  return (
    <div>
      <SectionHead
        as="h1"
        title="My subjects"
        description="Each subject collects its own lessons, notes and resources."
      />
      {summaries.length === 0 ? (
        <EmptyState
          title="No subjects yet"
          description="Once your coordinator has set up your subjects and tutors, they will be listed here."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map((summary) => (
            <SubjectCard
              key={summary.subject.id}
              href={`/student/subjects/${summary.subject.id}`}
              subject={summary.subject}
              lessonCount={summary.lessonCount}
              lastLessonTitle={summary.lastLesson?.title ?? null}
              nextLessonAt={summary.nextLesson?.scheduledAt ?? null}
              tutorNames={summary.tutors.map((t) => t.profile.fullName)}
              openHomeworkCount={summary.openHomeworkCount}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
