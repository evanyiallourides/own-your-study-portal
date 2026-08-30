import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { lessonHref } from "@/components/portal/lesson-cards";
import { OpeningMeeting } from "@/components/portal/opening-meeting";
import { ButtonLink } from "@/components/ui/primitives";
import { VideoIcon, ClockIcon, AlertIcon } from "@/components/ui/icons";
import { requireSession } from "@/lib/auth/session";
import { loadLesson } from "@/lib/data/cached";
import { formatFullWhen, formatDuration } from "@/lib/format";
import { parseMeetingLink } from "@/lib/meetings/links";
import { joinWindow, untilOpenLabel } from "@/lib/meetings/window";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Join lesson" };

/**
 * The door to a meeting.
 *
 * Every "Join lesson" control in the portal points here rather than straight at
 * the meeting, which buys three things. Access is checked at the moment of
 * joining, not at the moment the page was rendered — so a link sitting open in
 * a tab since yesterday cannot be used by someone who has since been removed.
 * The meeting URL itself never has to appear in a notification or an email.
 * And when joining is not possible, the reader gets a sentence explaining why
 * instead of a dead click.
 *
 * When it works, this page is on screen for a few hundred milliseconds and
 * says only which meeting it is opening. The interesting cases are the other
 * four, and each of them gets a sentence rather than a dead click.
 */
export default async function JoinLesson({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const session = await requireSession();

  /* Returns null when the reader is not entitled to the lesson — the same
     answer the database gives, which is why "not yours" and "does not exist"
     are indistinguishable from out here. */
  const lesson = await loadLesson(lessonId);
  if (!lesson) notFound();

  const back = lessonHref(session.profile.role, lessonId);

  /* A parent is not a participant. They can see that a lesson is happening;
     they are not given the door to walk into it. */
  if (session.profile.role === "parent") {
    return (
      <Blocked
        title="Lessons are for the student and their tutor"
        body={`You can see when this lesson is scheduled and read the write-up once it is published. The meeting itself is between ${lesson.student.profile.firstName} and ${lesson.tutor.profile.fullName}.`}
        back={back}
        lesson={lesson}
      />
    );
  }

  const gate = joinWindow(lesson);
  const link = parseMeetingLink(lesson.meetingUrl);

  if (gate.state === "open" && link) {
    return <OpeningMeeting url={link.url} label={link.label} />;
  }

  if (gate.state === "early" && link) {
    return (
      <Blocked
        icon="clock"
        title="Not quite yet"
        body={`This lesson starts ${formatFullWhen(lesson.scheduledAt)}. The ${link.label} link opens ${untilOpenLabel(gate.msUntilOpen)}.`}
        back={back}
        lesson={lesson}
      />
    );
  }

  if (gate.state === "no_link" || !link) {
    return (
      <Blocked
        title="No meeting link yet"
        body={
          session.profile.role === "tutor"
            ? "Add a link on the lesson page and it will appear here for your student."
            : "Your tutor has not added a link to this lesson yet. It will appear here once they do."
        }
        back={back}
        lesson={lesson}
      />
    );
  }

  return (
    <Blocked
      title={gate.state === "unavailable" ? "This lesson was cancelled" : "This lesson has finished"}
      body={
        gate.state === "unavailable"
          ? "Nothing is happening at this time. If you think that is wrong, speak to your coordinator."
          : "The meeting is over. The write-up appears on the lesson page once your tutor has reviewed it."
      }
      back={back}
      lesson={lesson}
    />
  );
}

function Blocked({
  title,
  body,
  back,
  lesson,
  icon = "alert",
}: {
  title: string;
  body: string;
  back: string;
  lesson: { title: string | null; scheduledAt: string; durationMinutes: number; subject: { name: string } };
  icon?: "alert" | "clock";
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-5 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-paper-2 text-ink-400">
        {icon === "clock" ? <ClockIcon /> : <AlertIcon />}
      </span>

      <div className="space-y-2">
        <h1 className="font-display text-2xl font-semibold text-balance">{title}</h1>
        <p className="text-ink-500 text-pretty">{body}</p>
      </div>

      <div className="w-full rounded-xl border border-rule bg-paper-2 px-5 py-4 text-left">
        <p className="font-display font-semibold">{lesson.title ?? lesson.subject.name}</p>
        <p className="mt-1 text-sm text-ink-400">
          {lesson.subject.name} · {formatFullWhen(lesson.scheduledAt)} ·{" "}
          {formatDuration(lesson.durationMinutes)}
        </p>
      </div>

      <ButtonLink href={back} variant="solid">
        <VideoIcon />
        Go to the lesson
      </ButtonLink>
    </div>
  );
}
