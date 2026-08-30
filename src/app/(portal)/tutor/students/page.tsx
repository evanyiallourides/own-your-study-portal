import type { Metadata } from "next";

import { SearchInput } from "@/components/portal/search-input";
import { TutorStudentCard } from "@/components/portal/tutor-student-card";
import { SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireTeachingAccess } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";

export const metadata: Metadata = { title: "My students" };
export const dynamic = "force-dynamic";

export default async function TutorStudents({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = await requireTeachingAccess();
  const repo = await repositoryFor(session);
  const tutorId = session.tutorId ?? undefined;

  const assignments = await repo.listAssignments({ tutorId });
  const active = assignments.filter((a) => a.active && a.student);

  const term = q?.trim().toLowerCase() ?? "";
  const studentIds = [...new Set(active.map((a) => a.studentId))].filter((id) => {
    if (!term) return true;
    const assignment = active.find((a) => a.studentId === id)!;
    return (
      assignment.student!.profile.fullName.toLowerCase().includes(term) ||
      (assignment.student!.school ?? "").toLowerCase().includes(term) ||
      active.some(
        (a) => a.studentId === id && (a.subject?.displayName ?? "").toLowerCase().includes(term),
      )
    );
  });

  const now = new Date().toISOString();
  const cards = await Promise.all(
    studentIds.map(async (studentId) => {
      const assignment = active.find((a) => a.studentId === studentId)!;
      const [past, next, homework] = await Promise.all([
        repo.listLessons({ tutorId, studentId, to: now, order: "desc", limit: 1 }),
        repo.listLessons({ tutorId, studentId, status: "scheduled", from: now, order: "asc", limit: 1 }),
        repo.listHomework({ studentId, completed: false }),
      ]);
      return {
        student: assignment.student!,
        subjects: active
          .filter((a) => a.studentId === studentId && a.subject)
          .map((a) => a.subject!.displayName),
        lastLessonAt: past[0]?.scheduledAt ?? null,
        nextLessonAt: next[0]?.scheduledAt ?? null,
        openHomework: homework.length,
      };
    }),
  );

  return (
    <div>
      <SectionHead
        as="h1"
        title="My students"
        description="Only the students you are assigned to, in the subjects you teach them."
        action={<SearchInput placeholder="Search students" label="Search your students" />}
      />

      {cards.length === 0 ? (
        <EmptyState
          title={term ? "Nothing matched that" : "No students assigned yet"}
          description={
            term
              ? "Try a name, a school or a subject."
              : "A coordinator assigns you to a student in a specific subject. Once they do, the student appears here."
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <TutorStudentCard
              key={card.student.id}
              student={card.student}
              subjects={card.subjects}
              lastLessonAt={card.lastLessonAt}
              nextLessonAt={card.nextLessonAt}
              openHomework={card.openHomework}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
