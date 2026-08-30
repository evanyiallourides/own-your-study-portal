import type { Metadata } from "next";

import { Card, Rule, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { pluralise } from "@/lib/format";

export const metadata: Metadata = { title: "Progress" };
export const dynamic = "force-dynamic";

export default async function ParentProgress() {
  const session = await requireRole("parent");
  const repo = await repositoryFor(session);

  const children = await repo.listStudents();
  if (children.length === 0) {
    return (
      <EmptyState
        title="No children linked to your account yet"
        description="Your coordinator links a parent account to a student."
      />
    );
  }

  const data = await Promise.all(
    children.map(async (child) => {
      const summaries = await repo.getSubjectSummaries(child.id);
      const perSubject = await Promise.all(
        summaries.map(async (summary) => {
          const lessons = await repo.listLessons({
            studentId: child.id,
            subjectId: summary.subject.id,
            status: "published",
            order: "desc",
            limit: 10,
          });
          const notes = await Promise.all(
            lessons.map((l) => repo.getLessonNotes(l.id).catch(() => null)),
          );
          const topics = [...new Set(notes.flatMap((n) => n?.topicsCovered ?? []))];
          return { summary, lessonCount: lessons.length, topics };
        }),
      );
      return { child, perSubject };
    }),
  );

  return (
    <div className="space-y-10">
      <SectionHead
        as="h1"
        title="Progress"
        description="What has been covered so far, drawn from published lesson write-ups."
      />

      {data.map(({ child, perSubject }) => (
        <section key={child.id} className="space-y-5">
          <h2 className="font-display text-xl font-semibold">{child.profile.fullName}</h2>
          {perSubject.length === 0 ? (
            <EmptyState
              title="No subjects yet"
              description="Subjects appear once a tutor has been assigned."
            />
          ) : (
            perSubject.map(({ summary, lessonCount, topics }) => (
              <Card key={summary.subject.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-lg font-semibold">
                    {summary.subject.displayName}
                  </p>
                  <p className="text-sm text-ink-300">{pluralise(lessonCount, "lesson")}</p>
                </div>
                {topics.length > 0 ? (
                  <>
                    <Rule className="my-4" />
                    <p className="eyebrow mb-2.5">Topics covered</p>
                    <ul className="flex flex-wrap gap-2">
                      {topics.slice(0, 14).map((topic) => (
                        <li
                          key={topic}
                          className="rounded-full border border-rule bg-paper-2 px-3 py-1 text-sm text-ink-700"
                        >
                          {topic}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </Card>
            ))
          )}
        </section>
      ))}

      <p className="max-w-[62ch] text-xs leading-relaxed text-ink-300">
        This is a summary of what tutors have written down, not a grade or an assessment.
      </p>
    </div>
  );
}
