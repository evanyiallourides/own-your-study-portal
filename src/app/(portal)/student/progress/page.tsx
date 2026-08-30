import type { Metadata } from "next";

import { Card, Rule, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { pluralise } from "@/lib/format";

export const metadata: Metadata = { title: "Progress" };
export const dynamic = "force-dynamic";

/* ==========================================================================
   Progress — V1
   --------------------------------------------------------------------------
   Deliberately modest. What the system can honestly say is: how many lessons
   have happened, which topics came up, what has repeatedly gone well, and what
   has repeatedly been flagged. It cannot say what percentage of a syllabus a
   student has mastered from a conversation, so it does not claim to — the
   mastery figures in the demo data are labelled as placeholders wherever they
   appear.
   ========================================================================== */

function countByFrequency(items: string[]): { text: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
}

export default async function StudentProgressPage() {
  const session = await requireRole("student");
  const repo = await repositoryFor(session);
  const studentId = session.studentId;
  if (!studentId) return null;

  const summaries = await repo.getSubjectSummaries(studentId);

  const perSubject = await Promise.all(
    summaries.map(async (summary) => {
      const lessons = await repo.listLessons({
        studentId,
        subjectId: summary.subject.id,
        status: "published",
        order: "desc",
        limit: 12,
      });
      const notes = await Promise.all(
        lessons.map((l) => repo.getLessonNotes(l.id).catch(() => null)),
      );
      return {
        summary,
        lessonCount: lessons.length,
        topics: countByFrequency(notes.flatMap((n) => n?.topicsCovered ?? [])),
        strengths: countByFrequency(notes.flatMap((n) => n?.strengths ?? [])),
        areas: countByFrequency(notes.flatMap((n) => n?.areasForImprovement ?? [])),
      };
    }),
  );

  if (perSubject.length === 0) {
    return (
      <div>
        <SectionHead as="h1" title="Progress" />
        <EmptyState
          title="Nothing to show yet"
          description="Your progress builds up from your published lessons. After the first few, recurring strengths and areas to work on will appear here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <SectionHead
        as="h1"
        title="Progress"
        description="Built from your published lesson notes — what has come up, what has gone well, and what keeps needing another look."
      />

      {perSubject.map(({ summary, lessonCount, topics, strengths, areas }) => (
        <section key={summary.subject.id}>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-xl font-semibold">{summary.subject.displayName}</h2>
            <p className="text-sm text-ink-300">{pluralise(lessonCount, "lesson")} published</p>
          </div>

          <Card className="space-y-6">
            {topics.length > 0 ? (
              <div>
                <p className="eyebrow mb-2.5">Recent topics</p>
                <ul className="flex flex-wrap gap-2">
                  {topics.slice(0, 10).map(({ text }) => (
                    <li
                      key={text}
                      className="rounded-full border border-rule bg-paper-2 px-3 py-1 text-sm text-ink-700"
                    >
                      {text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {strengths.length > 0 ? (
              <>
                <Rule />
                <div>
                  <p className="eyebrow mb-2.5">Consistent strengths</p>
                  <ul className="space-y-2">
                    {strengths.slice(0, 4).map(({ text, count }) => (
                      <li key={text} className="flex gap-3">
                        <span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                        <span className="text-ink-700">
                          {text}
                          {count > 1 ? (
                            <span className="ml-2 text-xs text-ink-300">
                              seen in {count} lessons
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : null}

            {areas.length > 0 ? (
              <>
                <Rule />
                <div>
                  <p className="eyebrow mb-2.5">Keeps coming up</p>
                  <ul className="space-y-2">
                    {areas.slice(0, 5).map(({ text, count }) => (
                      <li key={text} className="flex gap-3">
                        <span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                        <span className="text-ink-700">
                          {text}
                          {count > 1 ? (
                            <span className="ml-2 text-xs font-semibold text-warning">
                              flagged {count}×
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : null}

            {topics.length === 0 && strengths.length === 0 && areas.length === 0 ? (
              <p className="text-sm text-ink-500">
                Nothing yet for this subject. It fills in as lessons are published.
              </p>
            ) : null}
          </Card>
        </section>
      ))}

      <p className="max-w-[62ch] text-xs leading-relaxed text-ink-300">
        This page summarises what your tutors have written down. It is not a mark, a grade or a
        measure of how much of the syllabus you know — those come from assessments, not from lesson
        conversations.
      </p>
    </div>
  );
}
