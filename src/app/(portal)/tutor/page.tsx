import Link from "next/link";
import type { Metadata } from "next";

import { LessonCard } from "@/components/portal/lesson-cards";
import { MeetingLinksPanel, type MeetingRow } from "@/components/portal/meeting-links-panel";
import { TutorDayBar, type DayStat } from "@/components/portal/tutor-day-bar";
import { TutorTimetable } from "@/components/portal/tutor-timetable";
import { PreLessonBriefing } from "@/components/portal/pre-lesson-briefing";
import { TutorStudentCard } from "@/components/portal/tutor-student-card";
import { ArrowRightIcon, CalendarIcon } from "@/components/ui/icons";
import { Badge, ButtonLink, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireTeachingAccess } from "@/lib/auth/session";
import { buildBriefing } from "@/lib/briefing";
import { repositoryFor } from "@/lib/data";
import { env } from "@/lib/env";
import { formatTime, greeting, relativeDayLabel } from "@/lib/format";
import { googleStateFor } from "@/lib/google/status";
import { parseMeetingLink } from "@/lib/meetings/links";
import { joinButtonProps } from "@/lib/meetings/present";
import { stillRelevant, upcomingSince } from "@/lib/meetings/window";
import { NEEDS_REVIEW } from "@/lib/status";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function TutorHome() {
  const session = await requireTeachingAccess();
  const repo = await repositoryFor(session);
  const tutorId = session.tutorId;

  if (!tutorId) {
    return (
      <EmptyState
        title="Your tutor record is not set up yet"
        description="Your account exists but has not been linked to a tutor profile. Your coordinator can finish this off."
      />
    );
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const now = new Date().toISOString();

  const [today, needsReview, upcoming, assignments, google] = await Promise.all([
    repo.listLessons({
      tutorId,
      from: startOfToday.toISOString(),
      to: startOfTomorrow.toISOString(),
      order: "asc",
    }),
    repo.listLessons({ tutorId, status: NEEDS_REVIEW, order: "desc" }),
    repo.listLessons({ tutorId, status: "scheduled", from: upcomingSince(), order: "asc", limit: 10 }),
    repo.listAssignments({ tutorId }),
    googleStateFor(session.profile.id),
  ]);

  // A briefing for the very next lesson only. Three cards of prompts before a
  // day's teaching is noise; one, for the lesson about to happen, is useful.
  /* Finished lessons are dropped here rather than in the query, so one in
     progress survives the cut and keeps its join button at the top. */
  const scheduled = stillRelevant(upcoming);
  /* A cancelled lesson is not something anybody is teaching, so it is not on
     the timetable. It is still visible on the lessons page. */
  const todayLessons = today.filter((l) => l.status !== "cancelled");
  const ahead = scheduled.slice(0, 3);
  const nextLesson = ahead[0];
  const briefing = nextLesson ? await buildBriefing(repo, nextLesson) : null;

  /* Today's lessons and the ones after it, de-duplicated: a lesson later today
     belongs in both lists, and offering to make it a link twice is confusing.
     Cancelled lessons are dropped — nobody is joining those. */
  /* Today is the timetable above; this covers what comes after it, so the two
     sections never list the same lesson twice. A wider window than "Coming up"
     further down, because a lesson without a link is almost never the next one
     — it is the one booked a fortnight ago that nobody has got to yet. */
  const linkRows: MeetingRow[] = scheduled
    .filter((l) => !todayLessons.some((t) => t.id === l.id))
    .slice(0, 6)
    .map((lesson) => {
      const link = parseMeetingLink(lesson.meetingUrl);
      return {
        lessonId: lesson.id,
        studentName: lesson.student.profile.fullName,
        subject: lesson.subject.displayName,
        when: `${relativeDayLabel(lesson.scheduledAt)} · ${formatTime(lesson.scheduledAt)}`,
        meeting: link ? { label: link.label, code: link.code } : null,
        managed: lesson.meetLinkManaged,
        join: joinButtonProps(lesson),
      };
    });

  /* Counted across the whole visible window, not just the section below it —
     the number in the bar has to agree with the day, and today's lessons live
     in the timetable rather than in linkRows. */
  const linkless = [...todayLessons, ...scheduled].filter(
    (lesson, index, all) =>
      !lesson.meetingUrl && all.findIndex((l) => l.id === lesson.id) === index,
  );

  /* The genuinely next one, which is usually today. Taking linkRows[0] here
     would name tomorrow's lesson while today's was still in progress. */
  const nextUp = todayLessons[0] ?? scheduled[0];

  const dayStats: DayStat[] = [
    {
      label: "Next lesson",
      value: nextUp ? formatTime(nextUp.scheduledAt) : "—",
      detail: nextUp ? nextUp.student.profile.fullName : "Nothing booked",
      href: nextUp ? `/tutor/lessons/${nextUp.id}` : "/tutor/schedule",
      tone: nextUp && joinButtonProps(nextUp).initialState === "open" ? "accent" : "default",
    },
    {
      label: "Today",
      value: String(todayLessons.length),
      detail: todayLessons.length === 1 ? "lesson" : "lessons",
      href: "/tutor/schedule",
    },
    {
      label: "Waiting on you",
      value: String(needsReview.length),
      detail: needsReview.length === 0 ? "nothing to review" : "write-ups to publish",
      href: needsReview.length > 0 ? "/tutor/lessons?status=review_required" : undefined,
      tone: needsReview.length > 0 ? "warning" : "default",
    },
    {
      label: "Missing links",
      value: String(linkless.length),
      detail: linkless.length === 0 ? "all set up" : "lessons need one",
      href: linkless.length > 0 ? "/tutor/schedule" : undefined,
      tone: linkless.length > 0 ? "warning" : "default",
    },
  ];

  const activeStudents = assignments.filter((a) => a.active && a.student);
  const uniqueStudents = activeStudents.filter(
    (a, i, arr) => arr.findIndex((x) => x.studentId === a.studentId) === i,
  );

  return (
    <div className="space-y-12">
      {/* Smaller than the student's, on purpose. A tutor is here to work, so
          the greeting is a courtesy and the strip below it is the page. */}
      <header className="space-y-5">
        <h1 className="font-display text-2xl font-semibold sm:text-3xl">
          {greeting()}, {session.profile.firstName || "there"}
        </h1>
        <TutorDayBar stats={dayStats} />
      </header>

      {needsReview.length > 0 ? (
        <section>
          <SectionHead
            eyebrow="Waiting on you"
            title="Lesson notes to review"
            description="Drafted from the transcript. Nothing reaches the student until you publish it."
          />
          <ul className="space-y-3">
            {needsReview.map((lesson) => (
              <li key={lesson.id}>
                <Link
                  href={`/tutor/lessons/${lesson.id}/review`}
                  className="card card-interactive flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5"
                >
                  <div className="min-w-0">
                    <p className="font-display text-lg font-semibold text-ink">
                      {lesson.student.profile.fullName}
                    </p>
                    <p className="text-sm text-ink-500">
                      {lesson.subject.displayName} · {lesson.title ?? "Untitled lesson"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone="warning">Review required</Badge>
                    <ArrowRightIcon className="text-ink-300" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionHead
          title="Today"
          action={
            <ButtonLink href="/tutor/schedule" variant="ghost">
              Schedule
            </ButtonLink>
          }
        />
        {todayLessons.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon className="h-7 w-7" />}
            title="Nothing today"
            description="Your next booked lesson will show up here on the day."
          />
        ) : (
          <TutorTimetable lessons={todayLessons} />
        )}
      </section>

      <section>
        <SectionHead
          title="Coming up — meeting links"
          description="After today. Where each lesson is happening, and anything still without a link."
          action={
            <ButtonLink href="/profile" variant="ghost">
              Calendar settings
            </ButtonLink>
          }
        />
        <MeetingLinksPanel rows={linkRows} google={google} appUrl={env.appUrl} />
      </section>

      {briefing ? (
        <section>
          <SectionHead
            title="Before your next lesson"
            description="Assembled from the last published write-up — nothing here is new information."
          />
          <PreLessonBriefing briefing={briefing} />
        </section>
      ) : null}

      <section>
        <SectionHead
          title="My students"
          action={
            uniqueStudents.length > 0 ? (
              <Link
                href="/tutor/students"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
              >
                All students
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            ) : null
          }
        />
        {uniqueStudents.length === 0 ? (
          <EmptyState
            title="No students assigned yet"
            description="A coordinator assigns you to a student in a specific subject. Once they do, the student appears here."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {uniqueStudents.slice(0, 6).map((assignment) => (
              <TutorStudentCard
                key={assignment.studentId}
                student={assignment.student!}
                subjects={activeStudents
                  .filter((a) => a.studentId === assignment.studentId && a.subject)
                  .map((a) => a.subject!.displayName)}
              />
            ))}
          </ul>
        )}
      </section>

      {ahead.length > 1 ? (
        <section>
          <SectionHead title="Coming up" />
          <ul className="space-y-3">
            {ahead.slice(1).map((lesson) => (
              <LessonCard key={lesson.id} lesson={lesson} role="tutor" audience="tutor" />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
