"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ShieldIcon, SparkIcon } from "@/components/ui/icons";
import { Button, Rule, cx } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/states";
import {
  publishLessonNotes,
  saveLessonNotesDraft,
  type LessonNotesFormInput,
} from "@/lib/actions/lessons";
import type { LessonNotesForTutor, LessonWithContext } from "@/lib/types";

/* ==========================================================================
   Lesson review
   --------------------------------------------------------------------------
   The gate between an AI draft and a student. Two things it deliberately does
   NOT do: publish on save, and hide the private notes among the rest. The
   private field sits below a rule with its own explanation, because the whole
   arrangement depends on a tutor being certain which box the student reads.
   ========================================================================== */

const asLines = (items: string[]) => items.join("\n");

function ListField({
  id,
  label,
  hint,
  value,
  onChange,
  rows = 4,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {hint ? <p className="-mt-1 mb-2 text-xs text-ink-300">{hint}</p> : null}
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field resize-y leading-relaxed"
        placeholder="One per line"
      />
    </div>
  );
}

export function LessonReviewForm({
  lesson,
  notes,
}: {
  lesson: LessonWithContext;
  notes: LessonNotesForTutor | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: lesson.title ?? "",
    summary: notes?.summary ?? "",
    topicsCovered: asLines(notes?.topicsCovered ?? []),
    keyConcepts: asLines(notes?.keyConcepts ?? []),
    strengths: asLines(notes?.strengths ?? []),
    areasForImprovement: asLines(notes?.areasForImprovement ?? []),
    misconceptions: asLines(notes?.misconceptions ?? []),
    homework: asLines(notes?.homework ?? []),
    resourcesMentioned: asLines(notes?.resourcesMentioned ?? []),
    nextSteps: asLines(notes?.nextSteps ?? []),
    tutorPrivateNotes: notes?.tutorPrivateNotes ?? "",
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const payload = (): LessonNotesFormInput => ({ lessonId: lesson.id, ...form });

  const run = (
    action: (input: LessonNotesFormInput) => Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
    thenGoTo?: string,
  ) => {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await action(payload());
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      setSaved(successMessage);
      router.refresh();
      if (thenGoTo) router.push(thenGoTo);
    });
  };

  const summaryMissing = form.summary.trim() === "";

  return (
    <div className="space-y-8">
      {error ? <ErrorState title="Could not save" description={error} /> : null}
      {saved ? (
        <p
          role="status"
          className="rounded-[10px] border border-success/25 bg-success-wash px-4 py-3 text-sm font-medium text-success"
        >
          {saved}
        </p>
      ) : null}

      {notes?.aiGenerated ? (
        <div className="flex items-start gap-3 rounded-[12px] border border-rule bg-paper-2/60 px-4 py-3.5">
          <SparkIcon className="mt-0.5 shrink-0 text-accent" />
          <p className="text-sm leading-relaxed text-ink-700">
            This draft was written from the lesson transcript
            {notes.aiModel && notes.aiModel !== "demo" ? ` by ${notes.aiModel}` : ""}. Correct
            anything that is wrong or overstated before publishing — it is your write-up once you
            press publish, not the model&rsquo;s.
          </p>
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(saveLessonNotesDraft, "Draft saved. The student cannot see it yet.");
        }}
        className="space-y-8"
      >
        <div>
          <label htmlFor="title" className="field-label">
            Lesson title
          </label>
          <input
            id="title"
            value={form.title}
            onChange={(e) => set("title")(e.target.value)}
            className="field"
            placeholder="e.g. Organic chemistry: SN1 and SN2 mechanisms"
            maxLength={200}
          />
        </div>

        <div>
          <label htmlFor="summary" className="field-label">
            Lesson summary
          </label>
          <p className="-mt-1 mb-2 text-xs text-ink-300">
            What the student reads first. A short paragraph, specific to this lesson.
          </p>
          <textarea
            id="summary"
            rows={7}
            value={form.summary}
            onChange={(e) => set("summary")(e.target.value)}
            className={cx("field resize-y leading-relaxed", summaryMissing && "border-warning")}
            aria-describedby={summaryMissing ? "summary-warning" : undefined}
          />
          {summaryMissing ? (
            <p id="summary-warning" className="mt-1.5 text-xs font-medium text-warning">
              A lesson cannot be published without a summary.
            </p>
          ) : null}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <ListField
            id="topics"
            label="Topics covered"
            value={form.topicsCovered}
            onChange={set("topicsCovered")}
          />
          <ListField
            id="concepts"
            label="Key concepts"
            value={form.keyConcepts}
            onChange={set("keyConcepts")}
          />
          <ListField
            id="strengths"
            label="What the student did well"
            hint="Specific and evidenced. Not general encouragement."
            value={form.strengths}
            onChange={set("strengths")}
          />
          <ListField
            id="areas"
            label="Areas to work on"
            value={form.areasForImprovement}
            onChange={set("areasForImprovement")}
          />
          <ListField
            id="misconceptions"
            label="Misconceptions"
            hint="Things that were wrong during the lesson and got corrected."
            value={form.misconceptions}
            onChange={set("misconceptions")}
          />
          <ListField
            id="homework"
            label="Homework"
            hint="Only what you actually set. Each line becomes a tick-box on the student's homework page."
            value={form.homework}
            onChange={set("homework")}
          />
          <ListField
            id="resources"
            label="Resources mentioned"
            value={form.resourcesMentioned}
            onChange={set("resourcesMentioned")}
          />
          <ListField
            id="next"
            label="Next steps"
            value={form.nextSteps}
            onChange={set("nextSteps")}
          />
        </div>

        <Rule />

        <div className="rounded-[14px] border border-rule bg-paper-2/50 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ShieldIcon className="h-4 w-4 text-ink-500" />
            Private notes
          </p>
          <p className="mt-1.5 text-sm text-ink-500">
            Only you, and an administrator, can read this. It is stored separately from everything
            above and is never shown to the student or their parent.
          </p>
          <textarea
            id="private"
            rows={5}
            value={form.tutorPrivateNotes}
            onChange={(e) => set("tutorPrivateNotes")(e.target.value)}
            className="field mt-3 resize-y leading-relaxed"
            aria-label="Private notes, not visible to the student"
          />
        </div>

        <div className="sticky bottom-0 -mx-4 border-t border-rule bg-paper/90 px-4 py-4 backdrop-blur-md sm:mx-0 sm:rounded-[12px] sm:border sm:px-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? "Saving…" : "Save draft"}
            </Button>
            <Button
              type="button"
              variant="solid"
              disabled={pending || summaryMissing}
              onClick={() =>
                run(
                  publishLessonNotes,
                  "Published. The student can see this lesson now.",
                  `/tutor/lessons/${lesson.id}`,
                )
              }
            >
              {pending ? "Working…" : "Publish to student"}
            </Button>
            <p className="text-sm text-ink-500">
              {lesson.published
                ? "This lesson is already visible to the student. Publishing again updates it."
                : `${lesson.student.profile.firstName} cannot see any of this until you publish.`}
            </p>
          </div>
        </div>
      </form>
    </div>
  );
}
