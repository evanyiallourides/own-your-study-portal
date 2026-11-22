import Link from "next/link";

import { HoursSummary, StudyPlanView } from "@/components/portal/student-records";
import { NoteList, Rule } from "@/components/ui/primitives";
import type { Repository } from "@/lib/data";
import { formatDate, formatDuration } from "@/lib/format";
import type { Student } from "@/lib/types";

/* ==========================================================================
   The progress review and study plan, as one document
   --------------------------------------------------------------------------
   What a student (or their parent) prints or saves as a PDF: the tutor's
   overall review and plan, then the review of each recent lesson with its next
   steps, then what is outstanding. Assembled from what is already stored —
   nothing here calls a model.
   ========================================================================== */

export async function ReviewDocument({
  repo,
  student,
  lessonHrefBase,
  lessonLimit = 6,
}: {
  repo: Repository;
  student: Student;
  /** Where a lesson title links to, or null for no links (the parent view). */
  lessonHrefBase: string | null;
  lessonLimit?: number;
}) {
  const now = new Date().toISOString();
  const [plan, hours, lessons, homework, subjects] = await Promise.all([
    repo.getStudyPlan(student.id).catch(() => null),
    repo.getTutoringHours(student.id).catch(() => null),
    repo.listLessons({ studentId: student.id, status: "published", to: now, order: "desc", limit: lessonLimit }),
    repo.listHomework({ studentId: student.id, completed: false }),
    repo.getSubjectSummaries(student.id).catch(() => []),
  ]);

  const notes = await Promise.all(lessons.map((l) => repo.getLessonNotes(l.id).catch(() => null)));
  const tutorNames = [...new Set(subjects.flatMap((s) => s.tutors.map((t) => t.profile.fullName)))];

  return (
    <article className="space-y-10">
      <header className="print-avoid-break">
        <p className="eyebrow mb-2">Progress review &amp; study plan</p>
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">{student.profile.fullName}</h1>
        <p className="mt-2 text-ink-500">
          {[student.programme, student.yearLevel, student.school].filter(Boolean).join(" · ") || null}
        </p>
        <p className="mt-1 text-sm text-ink-300">
          Prepared {formatDate(now)}
          {subjects.length > 0 ? ` · ${subjects.map((s) => s.subject.displayName).join(", ")}` : ""}
          {tutorNames.length > 0 ? ` · ${tutorNames.join(", ")}` : ""}
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl sm:text-2xl">Review and plan ahead</h2>
        <div className="card p-5 sm:p-6">
          <StudyPlanView plan={plan} emptyText="No overall review has been written yet." />
        </div>
      </section>

      {hours && hours.purchasedMinutes > 0 ? (
        <section className="space-y-4 print-avoid-break">
          <h2 className="text-xl sm:text-2xl">Tutoring hours</h2>
          <div className="card p-5 sm:p-6">
            <HoursSummary hours={hours} compact />
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-xl sm:text-2xl">Recent lesson reviews</h2>
        {lessons.length === 0 ? (
          <p className="text-ink-500">No published lessons yet.</p>
        ) : (
          <ol className="space-y-4">
            {lessons.map((lesson, i) => {
              const n = notes[i];
              return (
                <li key={lesson.id} className="card p-5 sm:p-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-display text-lg font-semibold">
                      {lessonHrefBase ? (
                        <Link href={`${lessonHrefBase}/${lesson.id}`} className="hover:text-accent hover:underline">
                          {lesson.title ?? "Lesson"}
                        </Link>
                      ) : (
                        (lesson.title ?? "Lesson")
                      )}
                    </h3>
                    <p className="text-sm text-ink-500">
                      {lesson.subject.displayName} · {formatDate(lesson.scheduledAt)} ·{" "}
                      {formatDuration(lesson.durationMinutes)}
                    </p>
                  </div>

                  {n?.summary ? (
                    <div className="mt-3 max-w-[68ch] space-y-2 leading-relaxed text-ink-700">
                      {n.summary.split(/\n{2,}/).map((p, j) => (
                        <p key={j}>{p}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-ink-500">No written summary for this lesson.</p>
                  )}

                  {n && (n.strengths.length > 0 || n.areasForImprovement.length > 0) ? (
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      {n.strengths.length > 0 ? (
                        <div>
                          <p className="eyebrow mb-2">Went well</p>
                          <NoteList items={n.strengths} tone="accent" />
                        </div>
                      ) : null}
                      {n.areasForImprovement.length > 0 ? (
                        <div>
                          <p className="eyebrow mb-2">To work on</p>
                          <NoteList items={n.areasForImprovement} tone="warning" />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {n && n.nextSteps.length > 0 ? (
                    <>
                      <Rule className="my-4" />
                      <p className="eyebrow mb-2">Next steps</p>
                      <NoteList items={n.nextSteps} />
                    </>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="space-y-4 print-avoid-break">
        <h2 className="text-xl sm:text-2xl">Outstanding homework</h2>
        {homework.length === 0 ? (
          <p className="text-ink-500">Nothing outstanding.</p>
        ) : (
          <div className="card p-5 sm:p-6">
            <NoteList
              items={homework.map(
                (h) =>
                  `${h.description}${h.subject ? ` (${h.subject.displayName})` : ""}${
                    h.dueAt ? ` — due ${formatDate(h.dueAt)}` : ""
                  }`,
              )}
            />
          </div>
        )}
      </section>
    </article>
  );
}
