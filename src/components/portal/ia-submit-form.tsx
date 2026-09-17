"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/states";
import { submitIaForReview } from "@/lib/actions/ia";
import {
  DRAFT_STAGES,
  IA_LEVELS,
  IA_SUBJECTS,
  SUBJECT_LABEL,
  type DraftStage,
} from "@/lib/ia/rubrics";

/* ==========================================================================
   Sending an IA in
   --------------------------------------------------------------------------
   Four questions and a file, and every one of the four is load-bearing rather
   than form-filling:

     subject  chooses the marking model and the diagnostic questions
     level    chooses SL or HL descriptors where they differ
     session  chooses the COURSE — a May 2029 Maths exploration is not marked
              against the rubric running when it was uploaded
     stage    decides what an absence means: a section missing from a partial
              draft has not been written, and is not a section scored nothing

   The stage note under the radio buttons says that last part out loud, because
   a student who picks "final" for a draft to seem organised will be marked on
   sections they have not written yet.
   ========================================================================== */

const STAGE_LABEL: Record<DraftStage, string> = {
  partial_draft: "Partial draft",
  complete_draft: "Complete draft",
  final: "Final report",
};

const STAGE_HELP: Record<DraftStage, string> = {
  partial_draft:
    "Some sections are not written yet. Nothing missing will be counted against you, and there is no total.",
  complete_draft: "Everything is there and you intend to revise it.",
  final: "You consider this finished.",
};

export function IaSubmitForm({
  sessions,
  creditsLeft,
}: {
  sessions: string[];
  creditsLeft: number;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<DraftStage>("complete_draft");
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <div className="card p-5 sm:p-6">
      <h2 className="font-display text-lg font-semibold text-ink">Send an IA in</h2>
      <p className="mt-1 text-sm text-ink-500">
        PDF or Word, up to 25 MB. A PDF is read better than a Word file — equations and tables
        survive the export, and in an IA those are most of the evidence.
      </p>

      {error ? (
        <div className="mt-4">
          <ErrorState title="That did not go through" description={error} />
        </div>
      ) : null}

      <form
        ref={formRef}
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            const result = await submitIaForReview(formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            formRef.current?.reset();
            setFileName(null);
            router.push(`/student/ia-review/${result.data!.submissionId}`);
          });
        }}
        className="mt-5 space-y-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="subject" className="field-label">
              Subject
            </label>
            <select id="subject" name="subject" defaultValue="biology" className="field" required>
              {IA_SUBJECTS.map((subject) => (
                <option key={subject} value={subject}>
                  {SUBJECT_LABEL[subject]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="level" className="field-label">
              Level
            </label>
            <select id="level" name="level" defaultValue="HL" className="field" required>
              {IA_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="session" className="field-label">
            Examination session
          </label>
          <select id="session" name="session" className="field" required defaultValue={sessions[0]}>
            {sessions.map((session) => (
              <option key={session} value={session}>
                {session}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-ink-300">
            When you sit the exam, not when you are uploading. It is what decides which version of
            the course you are marked against.
          </p>
        </div>

        <fieldset>
          <legend className="field-label">How finished is it?</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-3">
            {DRAFT_STAGES.map((value) => (
              <label
                key={value}
                className={`cursor-pointer rounded-[8px] border px-3 py-2 text-sm font-medium transition-colors ${
                  stage === value
                    ? "border-accent bg-accent-wash text-accent"
                    : "border-rule bg-paper-3 text-ink-500 hover:border-ink-300"
                }`}
              >
                <input
                  type="radio"
                  name="stage"
                  value={value}
                  checked={stage === value}
                  onChange={() => setStage(value)}
                  className="sr-only"
                />
                {STAGE_LABEL[value]}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-300">{STAGE_HELP[stage]}</p>
        </fieldset>

        <div>
          <label htmlFor="note" className="field-label">
            Anything you want looked at first <span className="font-normal text-ink-300">(optional)</span>
          </label>
          <textarea
            id="note"
            name="note"
            rows={3}
            maxLength={1500}
            placeholder="e.g. I'm not sure my uncertainty calculation is right, and my evaluation feels thin."
            className="field"
          />
        </div>

        <div>
          <label htmlFor="file" className="field-label">
            Your IA
          </label>
          <input
            id="file"
            name="file"
            type="file"
            required
            accept=".pdf,.docx,.txt,.md"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            className="field file:mr-3 file:rounded-full file:border-0 file:bg-paper-2 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink-700 hover:file:bg-rule-soft"
          />
          {fileName ? <p className="mt-1.5 text-xs text-ink-300">Selected: {fileName}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="solid" disabled={pending || creditsLeft < 1}>
            {pending ? "Reading it…" : "Send for review"}
          </Button>
          <span className="text-xs text-ink-300">
            {pending
              ? "This takes a minute or two. Leave the page open."
              : `Uses one of your ${creditsLeft} review${creditsLeft === 1 ? "" : "s"}.`}
          </span>
        </div>

        {/* Said before they click rather than after, because it is the thing
            people worry about when they press the button on something they
            have paid for. */}
        <p className="text-xs text-ink-300">
          If anything goes wrong — an unreadable file, a review that does not complete — your
          review is not used up.
        </p>
      </form>
    </div>
  );
}
