import Link from "next/link";
import { notFound } from "next/navigation";

import { HomeworkList } from "@/components/portal/homework-list";
import { IaStudentPanel } from "@/components/portal/ia-student-panel";
import { LessonCard, NextLessonCard } from "@/components/portal/lesson-cards";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { Avatar, Badge, Card, NoteList, Rule, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireTeachingAccess } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate, pluralise, relativeDayLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

function frequency(items: string[]): { text: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
}

export default async function TutorStudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const session = await requireTeachingAccess();
  const repo = await repositoryFor(session);
  const tutorId = session.tutorId ?? undefined;

  // Access is decided by the repository (and, in production, by RLS). An
  // unassigned student simply does not resolve.
  const student = await repo.getStudent(studentId).catch(() => null);
  if (!student) notFound();

  const now = new Date().toISOString();
  const [subjects, past, upcoming, homework, progress, iaSubmissions] = await Promise.all([
    repo.listStudentSubjects(studentId),
    repo.listLessons({ tutorId, studentId, to: now, order: "desc" }),
    repo.listLessons({ tutorId, studentId, status: "scheduled", from: now, order: "asc" }),
    repo.listHomework({ studentId, completed: false }),
    repo.listProgress(studentId).catch(() => []),
    /* Swallowed rather than fatal: a portal whose IA migration has not been
       applied yet should still show a tutor their student's lessons. */
    repo.listIaSubmissions({ studentId }).catch(() => []),
  ]);

  const publishedRecent = past.filter((l) => l.published).slice(0, 8);
  const recentNotes = await Promise.all(
    publishedRecent.map((l) => repo.getLessonNotes(l.id).catch(() => null)),
  );

  const strengths = frequency(recentNotes.flatMap((n) => n?.strengths ?? []));
  const areas = frequency(recentNotes.flatMap((n) => n?.areasForImprovement ?? []));
  const latestNotes = recentNotes[0];
  const dueLabels = Object.fromEntries(
    homework.filter((h) => h.dueAt).map((h) => [h.id, `Due ${relativeDayLabel(h.dueAt!)}`]),
  );

  return (
    <div className="space-y-10">
      <div>
        <Link
          href="/tutor/students"
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors hover:text-accent"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          My students
        </Link>

        <header className="mt-4 flex flex-wrap items-center gap-4">
          <Avatar name={student.profile.fullName} size={56} />
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-semibold">{student.profile.fullName}</h1>
            <p className="mt-1 text-ink-500">
              {[student.programme, student.yearLevel, student.school].filter(Boolean).join(" · ") ||
                "No programme recorded"}
            </p>
          </div>
        </header>

        <ul className="mt-4 flex flex-wrap gap-2">
          {subjects.map((subject) => (
            <li key={subject.id}>
              <Badge tone="accent">{subject.displayName}</Badge>
            </li>
          ))}
          <li>
            <Badge>{pluralise(past.filter((l) => l.published).length, "published lesson")}</Badge>
          </li>
        </ul>
      </div>

      {upcoming[0] ? <NextLessonCard lesson={upcoming[0]} role="tutor" audience="tutor" /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <p className="eyebrow mb-3">Strengths seen repeatedly</p>
          {strengths.length === 0 ? (
            <p className="text-sm text-ink-500">
              Nothing recorded yet. This builds up from published lesson notes.
            </p>
          ) : (
            <NoteList items={strengths.slice(0, 5).map((s) => s.text)} tone="accent" />
          )}
        </Card>

        <Card>
          <p className="eyebrow mb-3">Recurring areas for improvement</p>
          {areas.length === 0 ? (
            <p className="text-sm text-ink-500">
              Nothing recorded yet. This builds up from published lesson notes.
            </p>
          ) : (
            <ul className="space-y-2.5">
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
          )}
        </Card>
      </div>

      {latestNotes ? (
        <section>
          <SectionHead
            title="Most recent lesson notes"
            description={
              publishedRecent[0]
                ? `${publishedRecent[0].title ?? "Untitled"} · ${formatDate(publishedRecent[0].scheduledAt)}`
                : undefined
            }
            action={
              publishedRecent[0] ? (
                <Link
                  href={`/tutor/lessons/${publishedRecent[0].id}`}
                  className="text-sm font-semibold text-accent hover:underline"
                >
                  Open lesson
                </Link>
              ) : null
            }
          />
          <Card>
            {latestNotes.summary ? (
              <p className="max-w-[64ch] leading-relaxed text-ink-700">{latestNotes.summary}</p>
            ) : null}
            {latestNotes.nextSteps.length > 0 ? (
              <>
                <Rule className="my-5" />
                <p className="eyebrow mb-2.5">Next steps</p>
                <NoteList items={latestNotes.nextSteps} />
              </>
            ) : null}
          </Card>
        </section>
      ) : null}

      {iaSubmissions.length > 0 ? (
        <IaStudentPanel
          entries={iaSubmissions}
          hrefBase={`/tutor/students/${studentId}/ia`}
          /* Null: what the student has left to spend is billing, and billing
             is not a tutor's business. */
          creditBalance={null}
        />
      ) : null}

      <section>
        <SectionHead title="Homework outstanding" />
        <HomeworkList
          items={homework}
          readOnly
          dueLabels={dueLabels}
          lessonHrefBase="/tutor/lessons"
          emptyTitle="Nothing outstanding"
          emptyDescription="Everything set so far has been ticked off."
        />
      </section>

      <section>
        <SectionHead title="Lesson history" />
        {past.length === 0 ? (
          <EmptyState
            title="No lessons yet"
            description="Lessons you teach this student will be listed here once they have happened."
          />
        ) : (
          <ul className="space-y-3">
            {past.map((lesson) => (
              <LessonCard key={lesson.id} lesson={lesson} role="tutor" audience="tutor" />
            ))}
          </ul>
        )}
      </section>

      {progress.length > 0 ? (
        <section>
          <SectionHead
            title="Topic progress"
            description="A placeholder in this version — the scores below are illustrative and are not derived from any assessment."
          />
          <Card>
            <ul className="space-y-3">
              {progress.map((row) => (
                <li key={row.id} className="flex items-center gap-4">
                  <span className="w-56 shrink-0 truncate text-sm text-ink-700">{row.topic}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-2">
                    <span
                      className="block h-full rounded-full bg-ink-300"
                      style={{ width: `${Math.round((row.masteryScore ?? 0) * 100)}%` }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right text-xs text-ink-300">
                    {pluralise(row.evidenceCount, "mention")}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
