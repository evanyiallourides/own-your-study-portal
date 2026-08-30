import { EmptyState } from "@/components/ui/states";
import { NoteList, Rule } from "@/components/ui/primitives";
import type { LessonNotes } from "@/lib/types";

/* ==========================================================================
   Lesson summary
   --------------------------------------------------------------------------
   The student-facing rendering of a lesson's notes. It is typed against
   `LessonNotes`, which has no tutor_private_notes field at all, so the private
   column cannot be rendered here even by accident.
   ========================================================================== */

function Block({
  title,
  children,
  hint,
}: {
  title: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section>
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      {hint ? <p className="mt-0.5 mb-3 text-sm text-ink-300">{hint}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

export function LessonSummary({ notes }: { notes: LessonNotes | null }) {
  if (!notes || (!notes.summary && notes.topicsCovered.length === 0)) {
    return (
      <EmptyState
        title="No notes for this lesson yet"
        description="Once your tutor has reviewed and published the write-up, the summary, key concepts and homework will appear here."
      />
    );
  }

  return (
    <div className="space-y-8">
      {notes.summary ? (
        <Block title="Lesson summary">
          <div className="prose-notes max-w-[64ch] text-[1.0625rem] leading-relaxed text-ink-700">
            {notes.summary.split(/\n{2,}/).map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </Block>
      ) : null}

      {notes.topicsCovered.length > 0 ? (
        <>
          <Rule />
          <Block title="Topics covered">
            <ul className="flex flex-wrap gap-2">
              {notes.topicsCovered.map((topic) => (
                <li
                  key={topic}
                  className="rounded-full border border-rule bg-paper-2 px-3 py-1 text-sm text-ink-700"
                >
                  {topic}
                </li>
              ))}
            </ul>
          </Block>
        </>
      ) : null}

      {notes.keyConcepts.length > 0 ? (
        <>
          <Rule />
          <Block title="Key concepts">
            <NoteList items={notes.keyConcepts} />
          </Block>
        </>
      ) : null}

      {notes.strengths.length > 0 ? (
        <>
          <Rule />
          <Block
            title="What you did well"
            hint="Specific things from this lesson, not general praise."
          >
            <NoteList items={notes.strengths} tone="accent" />
          </Block>
        </>
      ) : null}

      {notes.areasForImprovement.length > 0 ? (
        <>
          <Rule />
          <Block title="Areas to work on">
            <NoteList items={notes.areasForImprovement} tone="warning" />
          </Block>
        </>
      ) : null}

      {notes.misconceptions.length > 0 ? (
        <>
          <Rule />
          <Block
            title="Worth double-checking"
            hint="Points that were corrected during the lesson and are easy to slip back into."
          >
            <NoteList items={notes.misconceptions} tone="warning" />
          </Block>
        </>
      ) : null}

      {notes.homework.length > 0 ? (
        <>
          <Rule />
          <Block title="Homework">
            <NoteList items={notes.homework} />
          </Block>
        </>
      ) : null}

      {notes.nextSteps.length > 0 ? (
        <>
          <Rule />
          <Block title="Next steps">
            <NoteList items={notes.nextSteps} />
          </Block>
        </>
      ) : null}

      {notes.aiGenerated ? (
        <>
          <Rule />
          <p className="text-xs leading-relaxed text-ink-300">
            These notes were drafted automatically from the lesson transcript and reviewed by your
            tutor before publishing. If something does not match your memory of the lesson, tell
            your tutor — they can correct and republish it.
          </p>
        </>
      ) : null}
    </div>
  );
}
