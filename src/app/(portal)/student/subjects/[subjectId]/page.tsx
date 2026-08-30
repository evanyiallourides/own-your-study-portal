import Link from "next/link";
import { notFound } from "next/navigation";

import { HomeworkList } from "@/components/portal/homework-list";
import { LessonCard, NextLessonCard } from "@/components/portal/lesson-cards";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { Card, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { pluralise, relativeDayLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function StudentSubjectPage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const { subjectId } = await params;
  const session = await requireRole("student");
  const repo = await repositoryFor(session);
  const studentId = session.studentId ?? undefined;

  const summaries = await repo.getSubjectSummaries(session.studentId!);
  const summary = summaries.find((s) => s.subject.id === subjectId);
  if (!summary) notFound();

  const now = new Date().toISOString();
  const [lessons, homework, progress] = await Promise.all([
    repo.listLessons({ studentId, subjectId, to: now, order: "desc" }),
    repo.listHomework({ studentId, completed: false }),
    repo.listProgress(session.studentId!, subjectId),
  ]);

  const subjectHomework = homework.filter((h) => h.subjectId === subjectId);
  const dueLabels = Object.fromEntries(
    subjectHomework.filter((h) => h.dueAt).map((h) => [h.id, `Due ${relativeDayLabel(h.dueAt!)}`]),
  );
  const recentTopics = [...new Set(progress.map((p) => p.topic))].slice(0, 8);

  return (
    <div className="space-y-10">
      <div>
        <Link
          href="/student/subjects"
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors hover:text-accent"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          My subjects
        </Link>
        <h1 className="mt-4 font-display text-3xl font-semibold sm:text-4xl">
          {summary.subject.displayName}
        </h1>
        <p className="mt-2 text-ink-500">
          {summary.tutors.map((t) => t.profile.fullName).join(", ") || "No tutor assigned yet"} ·{" "}
          {pluralise(summary.lessonCount, "published lesson")}
        </p>
      </div>

      {summary.nextLesson ? (
        <NextLessonCard lesson={summary.nextLesson} role="student" audience="student" />
      ) : null}

      {recentTopics.length > 0 ? (
        <Card>
          <p className="eyebrow mb-3">Topics covered so far</p>
          <ul className="flex flex-wrap gap-2">
            {recentTopics.map((topic) => (
              <li
                key={topic}
                className="rounded-full border border-rule bg-paper-2 px-3 py-1 text-sm text-ink-700"
              >
                {topic}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {subjectHomework.length > 0 ? (
        <section>
          <SectionHead title="Homework outstanding" />
          <HomeworkList items={subjectHomework} dueLabels={dueLabels} />
        </section>
      ) : null}

      <section>
        <SectionHead title="Lessons" />
        {lessons.length === 0 ? (
          <EmptyState
            title="No lessons yet"
            description="Once your tutor publishes your first lesson in this subject, it will appear here."
          />
        ) : (
          <ul className="space-y-3">
            {lessons.map((lesson) => (
              <LessonCard
                key={lesson.id}
                lesson={lesson}
                role="student"
                audience="student"
                showSubject={false}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
