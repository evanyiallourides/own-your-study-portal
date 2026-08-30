import Link from "next/link";
import type { Metadata } from "next";

import { HomeworkList } from "@/components/portal/homework-list";
import { LessonCard, NextLessonCard, SubjectCard } from "@/components/portal/lesson-cards";
import { ArrowRightIcon, CalendarIcon } from "@/components/ui/icons";
import { ButtonLink, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { greeting, relativeDayLabel } from "@/lib/format";
import { stillRelevant, upcomingSince } from "@/lib/meetings/window";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default async function StudentHome() {
  const session = await requireRole("student");
  const repo = await repositoryFor(session);
  const studentId = session.studentId;

  if (!studentId) {
    return (
      <EmptyState
        title="Your student record is not set up yet"
        description="Your account exists but has not been linked to a student profile. Your coordinator can finish this off."
      />
    );
  }

  const now = new Date().toISOString();
  const [subjects, upcoming, recent, homework] = await Promise.all([
    repo.getSubjectSummaries(studentId),
    repo.listLessons({ studentId, status: "scheduled", from: upcomingSince(), order: "asc", limit: 6 }),
    repo.listLessons({ studentId, status: "published", to: now, order: "desc", limit: 4 }),
    repo.listHomework({ studentId, completed: false }),
  ]);

  /* Anything that has actually finished is dropped here rather than in the
     query, so a lesson in progress survives the cut and stays at the top where
     the join button is. */
  const live = stillRelevant(upcoming).slice(0, 4);
  const nextLesson = live[0];
  /* Written as a sentence rather than assembled from fragments, so it reads
     like something a person would say. Falls back to the neutral line when
     there is nothing particular to report — an empty week is not a failure
     and should not be described as one. */
  const outstanding = homework.length;
  const standing = (() => {
    const tasks =
      outstanding === 0
        ? null
        : `${outstanding} ${outstanding === 1 ? "task" : "tasks"} outstanding`;
    const next = nextLesson
      ? `${nextLesson.subject.displayName} ${relativeDayLabel(nextLesson.scheduledAt).toLowerCase()}`
      : null;

    if (tasks && next) return `${capitalise(tasks)}, and ${next}.`;
    if (tasks) return `${capitalise(tasks)}.`;
    if (next) return `Nothing outstanding — ${next}.`;
    return "Here\u2019s where you\u2019re up to.";
  })();

  const dueLabels = Object.fromEntries(
    homework.filter((h) => h.dueAt).map((h) => [h.id, `Due ${relativeDayLabel(h.dueAt!)}`]),
  );

  return (
    <div className="space-y-12">
      {/* Deliberately not the tutor's strip of numbers. A tutor is at work and
          needs counts to act on; a student is checking in, and a sentence
          about their own week reads better than a dashboard of metrics about
          themselves. Same information, and the difference is the point. */}
      <header>
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">
          {greeting()}, {session.profile.firstName || "there"}
        </h1>
        <p className="mt-2 text-lg text-ink-500">{standing}</p>
      </header>

      {nextLesson ? (
        <NextLessonCard lesson={nextLesson} role="student" audience="student" />
      ) : (
        <EmptyState
          icon={<CalendarIcon className="h-7 w-7" />}
          title="No lesson booked yet"
          description="When your next lesson is scheduled it will show up here with a link to join it."
        />
      )}

      <section>
        <SectionHead
          title="My subjects"
          action={
            subjects.length > 0 ? (
              <Link
                href="/student/subjects"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
              >
                All subjects
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            ) : null
          }
        />
        {subjects.length === 0 ? (
          <EmptyState
            title="No subjects yet"
            description="Once your coordinator has set up your subjects and tutors, they will be listed here."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((summary) => (
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
      </section>

      <section>
        <SectionHead
          title="Recent lessons"
          action={
            recent.length > 0 ? (
              <Link
                href="/student/lessons"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
              >
                All lessons
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            ) : null
          }
        />
        {recent.length === 0 ? (
          <EmptyState
            title="No lessons yet"
            description="Once your tutor publishes your first lesson, your notes, transcript and resources will appear here."
          />
        ) : (
          <ul className="space-y-3">
            {recent.map((lesson) => (
              <LessonCard key={lesson.id} lesson={lesson} role="student" audience="student" />
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHead
          title="Homework"
          description={
            homework.length > 0
              ? "Set by your tutors in your published lessons."
              : undefined
          }
          action={
            homework.length > 0 ? (
              <ButtonLink href="/student/homework" variant="ghost">
                All homework
              </ButtonLink>
            ) : null
          }
        />
        <HomeworkList items={homework.slice(0, 5)} dueLabels={dueLabels} />
      </section>
    </div>
  );
}
