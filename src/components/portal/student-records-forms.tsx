"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/primitives";
import {
  addClassBoard,
  adjustTutoringHours,
  removeClassBoard,
  saveStudyPlan,
} from "@/lib/actions/student-records";
import type { ActionResult } from "@/lib/actions/result";
import type { StudyPlan, Subject } from "@/lib/types";

/* ==========================================================================
   Editing a student's standing records
   --------------------------------------------------------------------------
   Each form calls its server action, shows the refusal inline, and refreshes
   the page on success so the read-only view beside it updates.
   ========================================================================== */

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function run(action: () => Promise<ActionResult>, onDone?: () => void) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      onDone?.();
      router.refresh();
    });
  }

  return { pending, error, saved, run };
}

/* onSubmit rather than the form `action` prop: React resets a form after an
   action runs, refused or not, and a tutor whose plan was refused should not
   lose the paragraph they just wrote. */
function submitWith(handler: (formData: FormData, form: HTMLFormElement) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handler(new FormData(event.currentTarget), event.currentTarget);
  };
}

/** Administrators only: hours paid outside the checkout, or a correction. */
export function TutoringHoursForm({ studentId }: { studentId: string }) {
  const { pending, error, run } = useAction();

  return (
    <form
      onSubmit={submitWith((formData, form) =>
        run(
          () =>
            adjustTutoringHours({
              studentId,
              hours: Number(formData.get("hours")),
              note: String(formData.get("note") ?? ""),
            }),
          () => form.reset(),
        ),
      )}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="hours" className="field-label">
            Change by (hours)
          </label>
          <input
            id="hours"
            name="hours"
            type="number"
            step={0.5}
            min={-200}
            max={200}
            defaultValue={1}
            required
            className="field w-28 tabular-nums"
          />
        </div>
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="hours-note" className="field-label">
            Why
          </label>
          <input
            id="hours-note"
            name="note"
            type="text"
            required
            minLength={3}
            maxLength={200}
            placeholder="Paid by bank transfer, 10 hours"
            className="field"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Apply"}
        </Button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </form>
  );
}

/** Tutors and administrators: link a shared whiteboard. */
export function ClassBoardForm({ studentId, subjects }: { studentId: string; subjects: Subject[] }) {
  const { pending, error, run } = useAction();

  return (
    <form
      onSubmit={submitWith((formData, form) =>
        run(
          () =>
            addClassBoard({
              studentId,
              subjectId: String(formData.get("subjectId") ?? ""),
              label: String(formData.get("label") ?? ""),
              url: String(formData.get("url") ?? ""),
            }),
          () => form.reset(),
        ),
      )}
      className="space-y-3"
    >
      <p className="eyebrow">Link a board</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="board-label" className="field-label">
            Name
          </label>
          <input
            id="board-label"
            name="label"
            type="text"
            required
            maxLength={80}
            placeholder="Chemistry whiteboard"
            className="field"
          />
        </div>
        <div>
          <label htmlFor="board-subject" className="field-label">
            Subject
          </label>
          <select id="board-subject" name="subjectId" className="field" defaultValue="">
            <option value="">All subjects</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="board-url" className="field-label">
          Link
        </label>
        <div className="flex flex-wrap gap-3">
          <input
            id="board-url"
            name="url"
            type="url"
            required
            maxLength={2000}
            placeholder="https://miro.com/app/board/…"
            className="field min-w-[14rem] flex-1"
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add board"}
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-ink-300">
          Miro, Excalidraw, Bitpaper, OneNote, Google Classroom — any https link.
        </p>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </form>
  );
}

export function RemoveBoardButton({ boardId, studentId }: { boardId: string; studentId: string }) {
  const { pending, error, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      {error ? <span className="text-xs text-danger">{error}</span> : null}
      <Button
        type="button"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => removeClassBoard({ boardId, studentId }))}
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
    </span>
  );
}

/** Tutors and administrators: the overall review and the plan ahead. */
export function StudyPlanForm({ studentId, plan }: { studentId: string; plan: StudyPlan | null }) {
  const { pending, error, saved, run } = useAction();

  return (
    <form
      onSubmit={submitWith((formData) =>
        run(() =>
          saveStudyPlan({
            studentId,
            review: String(formData.get("review") ?? ""),
            goals: String(formData.get("goals") ?? ""),
            focusAreas: String(formData.get("focusAreas") ?? ""),
            nextReviewOn: String(formData.get("nextReviewOn") ?? ""),
          }),
        ),
      )}
      className="space-y-4"
    >
      <div>
        <label htmlFor="plan-review" className="field-label">
          Where things stand
        </label>
        <textarea
          id="plan-review"
          name="review"
          rows={6}
          maxLength={6000}
          defaultValue={plan?.review ?? ""}
          placeholder="A review across recent lessons: what is secure, what is not, and why."
          className="field leading-relaxed"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="plan-goals" className="field-label">
            Goals <span className="font-normal text-ink-300">(one per line)</span>
          </label>
          <textarea
            id="plan-goals"
            name="goals"
            rows={5}
            maxLength={4000}
            defaultValue={plan?.goals.join("\n") ?? ""}
            placeholder={"Chemistry HL: a secure 6 by the mocks\nIA draft submitted by end of term"}
            className="field"
          />
        </div>
        <div>
          <label htmlFor="plan-focus" className="field-label">
            Focus for the coming weeks <span className="font-normal text-ink-300">(one per line)</span>
          </label>
          <textarea
            id="plan-focus"
            name="focusAreas"
            rows={5}
            maxLength={4000}
            defaultValue={plan?.focusAreas.join("\n") ?? ""}
            placeholder={"Paper 2 extended responses\nKinetics and Arrhenius"}
            className="field"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="plan-next" className="field-label">
            Next review
          </label>
          <input
            id="plan-next"
            name="nextReviewOn"
            type="date"
            defaultValue={plan?.nextReviewOn ?? ""}
            className="field"
          />
        </div>
        <Button type="submit" variant="solid" disabled={pending}>
          {pending ? "Saving…" : plan ? "Update plan" : "Save plan"}
        </Button>
        {saved && !pending ? <span className="text-sm text-success">Saved. The student can see it now.</span> : null}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </form>
  );
}
