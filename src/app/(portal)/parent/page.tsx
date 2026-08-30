import Link from "next/link";
import type { Metadata } from "next";

import { HomeworkList } from "@/components/portal/homework-list";
import { LessonCard, NextLessonCard } from "@/components/portal/lesson-cards";
import { Card, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { greeting, pluralise, relativeDayLabel } from "@/lib/format";
import { stillRelevant, upcomingSince } from "@/lib/meetings/window";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

/* ==========================================================================
   Parent dashboard — V1
   --------------------------------------------------------------------------
   Deliberately conservative. A parent sees that lessons happened, what was
   covered, what homework was set, and what is booked next. They do not get the
   transcript or the tutor's notes on their child: those are between the
   student and their tutor, and widening that is a decision to take
   deliberately rather than by default.
   ========================================================================== */

export default async function ParentHome() {
  const session = await requireRole("parent");
  const repo = await repositoryFor(session);

  const children = await repo.listStudents();
  if (children.length === 0) {
    return (
      <EmptyState
        title="No children linked to your account yet"
        description="Your coordinator links a parent account to a student. Once that is done, their lessons and progress will appear here."
      />
    );
  }

  const now = new Date().toISOString();
  const cards = await Promise.all(
    children.map(async (child) => {
      const [upcoming, recent, homework, subjects] = await Promise.all([
        repo.listLessons({ studentId: child.id, status: "scheduled", from: upcomingSince(), order: "asc", limit: 3 }),
        repo.listLessons({ studentId: child.id, status: "published", to: now, order: "desc", limit: 4 }),
        repo.listHomework({ studentId: child.id, completed: false }),
        repo.getSubjectSummaries(child.id),
      ]);
      const latestNotes = recent[0] ? await repo.getLessonNotes(recent[0].id).catch(() => null) : null;
      return { child, upcoming: stillRelevant(upcoming), recent, homework, subjects, latestNotes };
    }),
  );

  return (
    <div className="space-y-12">
      <header>
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">
          {greeting()}, {session.profile.firstName || "there"}
        </h1>
        <p className="mt-2 text-lg text-ink-500">
          {cards.length === 1
            ? `How ${cards[0]!.child.profile.firstName} is getting on.`
            : "How things are going."}
        </p>
      </header>

      {cards.map(({ child, upcoming, recent, homework, subjects, latestNotes }) => (
        <section key={child.id} className="space-y-8">
          {cards.length > 1 ? (
            <h2 className="font-display text-2xl font-semibold">{child.profile.fullName}</h2>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            {subjects.map((summary) => (
              <Card key={summary.subject.id}>
                <p className="font-medium text-ink">{summary.subject.displayName}</p>
                <p className="mt-1 text-sm text-ink-500">
                  {pluralise(summary.lessonCount, "lesson")} ·{" "}
                  {summary.tutors.map((t) => t.profile.fullName).join(", ") || "No tutor assigned"}
                </p>
                <p className="mt-2 text-sm text-ink-300">
                  Next:{" "}
                  {summary.nextLesson
                    ? relativeDayLabel(summary.nextLesson.scheduledAt)
                    : "Not booked"}
                </p>
              </Card>
            ))}
          </div>

          {upcoming[0] ? (
            <NextLessonCard lesson={upcoming[0]} role="parent" audience="student" />
          ) : null}

          {latestNotes?.summary ? (
            <div>
              <SectionHead
                title="Most recent lesson"
                description={recent[0]?.title ?? undefined}
                action={
                  recent[0] ? (
                    <Link
                      href={`/parent/lessons/${recent[0].id}`}
                      className="text-sm font-semibold text-accent hover:underline"
                    >
                      Open
                    </Link>
                  ) : null
                }
              />
              <Card>
                <p className="max-w-[64ch] leading-relaxed text-ink-700">{latestNotes.summary}</p>
              </Card>
            </div>
          ) : null}

          <div>
            <SectionHead title="Homework set" />
            <HomeworkList
              items={homework}
              readOnly
              lessonHrefBase="/parent/lessons"
              emptyTitle="Nothing outstanding"
              emptyDescription="Everything set so far has been marked as done."
            />
          </div>

          <div>
            <SectionHead
              title="Recent lessons"
              action={
                <Link
                  href="/parent/lessons"
                  className="text-sm font-semibold text-accent hover:underline"
                >
                  All lessons
                </Link>
              }
            />
            {recent.length === 0 ? (
              <EmptyState
                title="No lessons yet"
                description="Once a tutor publishes a lesson write-up it will appear here."
              />
            ) : (
              <ul className="space-y-3">
                {recent.map((lesson) => (
                  <LessonCard key={lesson.id} lesson={lesson} role="parent" audience="student" />
                ))}
              </ul>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
