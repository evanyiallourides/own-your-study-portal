import Link from "next/link";

import { SparkIcon } from "@/components/ui/icons";
import { NoteList, Rule } from "@/components/ui/primitives";
import { formatDate, formatTime, relativeDayLabel } from "@/lib/format";
import type { PreLessonBriefing as Briefing } from "@/lib/types";

/* ==========================================================================
   Pre-lesson briefing
   --------------------------------------------------------------------------
   Everything on this card came from a lesson write-up the tutor themselves
   reviewed and published. Nothing is inferred at render time and no model is
   called — which is why it can be shown for every upcoming lesson without a
   cost or a latency budget.
   ========================================================================== */

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="eyebrow mb-2">{label}</p>
      {hint ? <p className="-mt-1 mb-2.5 text-xs text-ink-300">{hint}</p> : null}
      {children}
    </div>
  );
}

export function PreLessonBriefing({ briefing }: { briefing: Briefing }) {
  const { lesson, lastLesson } = briefing;

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-rule bg-paper-2/60 px-5 py-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.19em] text-accent">
            <SparkIcon className="h-4 w-4" />
            Pre-lesson briefing
          </p>
          <h3 className="mt-2 font-display text-lg font-semibold text-ink">
            {lesson.student.profile.firstName} — {lesson.subject.displayName}
          </h3>
          <p className="text-sm text-ink-500">
            {relativeDayLabel(lesson.scheduledAt)} · {formatTime(lesson.scheduledAt)}
          </p>
        </div>
        <Link
          href={`/tutor/students/${lesson.studentId}`}
          className="text-sm font-semibold text-accent hover:underline"
        >
          Student page
        </Link>
      </header>

      <div className="space-y-5 p-5">
        {lastLesson ? (
          <Section label="Last lesson">
            <p className="text-ink">{lastLesson.title ?? "Untitled lesson"}</p>
            <p className="text-sm text-ink-300">{formatDate(lastLesson.scheduledAt)}</p>
            {briefing.lastTopics.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {briefing.lastTopics.slice(0, 5).map((topic) => (
                  <li
                    key={topic}
                    className="rounded-full border border-rule bg-paper-2 px-2.5 py-0.5 text-xs text-ink-500"
                  >
                    {topic}
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>
        ) : (
          <p className="text-sm text-ink-500">
            This is the first published lesson with {lesson.student.profile.firstName} in this
            subject, so there is no history to brief from yet.
          </p>
        )}

        {briefing.needsReinforcement.length > 0 ? (
          <>
            <Rule />
            <Section
              label="Needs reinforcement"
              hint="Quoted from previous write-ups, which are addressed to the student."
            >
              <NoteList items={briefing.needsReinforcement} tone="warning" />
            </Section>
          </>
        ) : null}

        {briefing.openHomework.length > 0 ? (
          <>
            <Rule />
            <Section label="Homework outstanding" hint="Not yet ticked off.">
              <NoteList items={briefing.openHomework} />
            </Section>
          </>
        ) : null}

        {briefing.suggestedCheck ? (
          <>
            <Rule />
            <Section label="Suggested check">
              <p className="rounded-[10px] border border-accent/20 bg-accent-wash/60 px-4 py-3 text-ink-700">
                {briefing.suggestedCheck}
              </p>
            </Section>
          </>
        ) : null}

        {briefing.suggestedNextTopics.length > 0 ? (
          <>
            <Rule />
            <Section label="Suggested next topic">
              <NoteList items={briefing.suggestedNextTopics} />
            </Section>
          </>
        ) : null}
      </div>
    </section>
  );
}
