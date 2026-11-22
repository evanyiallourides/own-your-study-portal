import Link from "next/link";
import type { Metadata } from "next";

import { HomeworkList } from "@/components/portal/homework-list";
import { LessonCard, NextLessonCard, SubjectCard } from "@/components/portal/lesson-cards";
import {
  ClassBoardList,
  DocumentLink,
  HoursSummary,
  StudyPlanView,
} from "@/components/portal/student-records";
import { ArrowRightIcon, CalendarIcon } from "@/components/ui/icons";
import { Badge, ButtonLink, Card, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate, greeting, relativeDayLabel } from "@/lib/format";
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
  const [subjects, upcoming, recent, homework, hours, iaCredits, questionBanks, boards, plan] =
    await Promise.all([
      repo.getSubjectSummaries(studentId),
      repo.listLessons({ studentId, status: "scheduled", from: upcomingSince(), order: "asc", limit: 6 }),
      repo.listLessons({ studentId, status: "published", to: now, order: "desc", limit: 4 }),
      repo.listHomework({ studentId, completed: false }),
      /* Each of these is swallowed rather than fatal: a database that has not
         run one migration should still show a student their lessons. */
      repo.getTutoringHours(studentId).catch(() => null),
      repo.getIaCredits(studentId).catch(() => null),
      repo.getQuestionBankAccess(studentId).catch(() => null),
      repo.listClassBoards(studentId).catch(() => []),
      repo.getStudyPlan(studentId).catch(() => null),
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

      {/* What this account holds. Everything here arrives on its own when a
          purchase settles — hours, IA reviews and question bank access — so
          this is also where a student checks that what they bought is there. */}
      <section aria-labelledby="account-heading">
        <h2 id="account-heading" className="sr-only">
          Your account
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          <Card as="li" className="flex flex-col">
            <p className="eyebrow mb-3">Tutoring hours</p>
            {hours ? (
              <HoursSummary hours={hours} compact />
            ) : (
              <p className="text-sm text-ink-500">Not available right now.</p>
            )}
            <div className="mt-auto pt-4">
              <Link href="/checkout/standard-10hr" className="text-sm font-semibold text-accent hover:underline">
                Buy more hours
              </Link>
            </div>
          </Card>

          <Card as="li" className="flex flex-col">
            <p className="eyebrow mb-3">IA reviews</p>
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="font-display text-3xl font-semibold tabular-nums text-ink">
                {iaCredits?.balance ?? 0}
              </p>
              <p className="text-sm text-ink-500">
                review{iaCredits?.balance === 1 ? "" : "s"} available
              </p>
            </div>
            <p className="mt-2 text-sm text-ink-500">
              Upload an internal assessment and get it read against the criteria.
            </p>
            <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-4">
              <Link href="/student/ia-review" className="text-sm font-semibold text-accent hover:underline">
                {iaCredits && iaCredits.balance > 0 ? "Submit an IA" : "Your reviews"}
              </Link>
              <Link href="/checkout/ia-marking" className="text-sm font-semibold text-ink-500 hover:text-accent hover:underline">
                Buy a review
              </Link>
            </div>
          </Card>

          <Card as="li" className="flex flex-col">
            <p className="eyebrow mb-3">Question banks &amp; papers</p>
            {questionBanks?.granted ? (
              <>
                <Badge tone="success">Active</Badge>
                <p className="mt-3 text-sm text-ink-500">
                  {questionBanks.source === "pooled-hours"
                    ? `Included with your ${questionBanks.pooledHours} hours.`
                    : questionBanks.expiresAt
                      ? `Runs until ${formatDate(questionBanks.expiresAt)}.`
                      : "Included with your account."}
                </p>
              </>
            ) : (
              <>
                <Badge>Not active</Badge>
                <p className="mt-3 text-sm text-ink-500">
                  {questionBanks
                    ? `Included free from ${questionBanks.freeAtHours} hours, or available on its own.`
                    : "Available on its own or with larger packages."}
                </p>
              </>
            )}
            <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-4">
              {questionBanks?.granted ? (
                <>
                  <Link href="/student/question-banks" className="text-sm font-semibold text-accent hover:underline">
                    Question banks
                  </Link>
                  <Link href="/student/papers" className="text-sm font-semibold text-accent hover:underline">
                    Mock papers
                  </Link>
                </>
              ) : (
                <Link href="/checkout/question-bank?site=own-your-ib" className="text-sm font-semibold text-accent hover:underline">
                  Get access
                </Link>
              )}
            </div>
          </Card>
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <SectionHead
            title="My study plan"
            action={plan ? <DocumentLink href="/student/plan">Full review &amp; plan</DocumentLink> : null}
          />
          <Card>
            <StudyPlanView
              plan={plan}
              showReview={false}
              emptyText="Your tutor will write an overall review and a plan for the weeks ahead. It will appear here."
            />
          </Card>
        </section>

        <section className="lg:col-span-2">
          <SectionHead title="Class boards" />
          <Card>
            <ClassBoardList
              boards={boards}
              emptyText="When your tutor links the whiteboard you use together, it will be here — one click to open it."
            />
          </Card>
        </section>
      </div>

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
