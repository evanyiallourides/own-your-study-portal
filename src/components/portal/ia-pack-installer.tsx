"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, Card } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/states";
import { installAssessmentPack } from "@/lib/actions/ia-packs";
import { INSTALLABLE_RUBRICS, rubricById } from "@/lib/ia/rubrics";

/* ==========================================================================
   Installing descriptors
   --------------------------------------------------------------------------
   A textarea taking JSON, rather than a form with a field per band.

   That is the right shape here even though it is the less friendly one. A set
   of descriptors is thirty or forty pieces of text with a structure of its own,
   it is transcribed once per subject per syllabus revision, and it is done by
   the person who runs the practice rather than by a student. A bespoke editor
   would be a week of work to save one afternoon, and it would be a week of
   work whose failure mode is an editor that quietly cannot express a band
   range like "5-6".

   The shape is documented in the placeholder and validated on the server, and
   the validation refuses anything that does not cover every criterion — so the
   thing this cannot do is install a pack that would mark four fifths of an
   exploration and improvise the rest.
   ========================================================================== */

const EXAMPLE = `{
  "rubricId": "biology_fa2025",
  "version": "Biology guide, first assessment 2025",
  "source": "Official subject guide, pp. 00-00",
  "shared": {
    "research_design": {
      "criterionId": "research_design",
      "bands": [
        { "marks": "0",   "text": "..." },
        { "marks": "1-2", "text": "..." },
        { "marks": "3-4", "text": "..." },
        { "marks": "5-6", "text": "..." }
      ],
      "clarifications": ["..."]
    },
    "data_analysis":  { "criterionId": "data_analysis",  "bands": [] },
    "conclusion":     { "criterionId": "conclusion",     "bands": [] },
    "evaluation":     { "criterionId": "evaluation",     "bands": [] }
  },
  "bestFitGuidance": ["..."]
}`;

export function IaPackInstaller({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>Install or replace a set of descriptors</Button>
    );
  }

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-display text-lg font-semibold text-ink">Install descriptors</h3>
        <p className="mt-1 text-sm text-ink-500">
          Paste the achievement descriptors for one marking model. They are stored in the database,
          readable only by administrators, and never sent to a student&rsquo;s browser. Replacing a
          pack does not change reviews already produced — each one records the version and checksum
          it was marked under.
        </p>
      </div>

      {demo ? (
        <p className="rounded-[8px] border border-warning/25 bg-warning-wash px-3 py-2 text-sm text-warning">
          Demo mode has no database, so nothing can be installed. Every demo review is
          feedback-only, which is what a deployment with no descriptors should do.
        </p>
      ) : null}

      {error ? <ErrorState title="Not installed" description={error} /> : null}

      {problems.length > 0 ? (
        <div className="rounded-[8px] border border-danger/25 bg-danger-wash p-4">
          <p className="text-sm font-semibold text-danger">
            This pack does not cover its model, so it was not installed
          </p>
          <ul className="mt-2 space-y-1 text-sm text-ink-700">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {done ? (
        <p className="rounded-[8px] border border-success/20 bg-success-wash px-4 py-3 text-sm text-ink-700">
          Installed. Checksum {done.slice(0, 16)}… Reviews against this model now carry marks.
        </p>
      ) : null}

      <form
        action={(formData) => {
          setError(null);
          setProblems([]);
          setDone(null);
          startTransition(async () => {
            const result = await installAssessmentPack(formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            if (result.data!.problems.length > 0) {
              setProblems(result.data!.problems);
              return;
            }
            setDone(result.data!.checksum ?? "");
            router.refresh();
          });
        }}
        className="space-y-4"
      >
        <div>
          <label htmlFor="rubricId" className="field-label">
            Marking model
          </label>
          <select id="rubricId" name="rubricId" className="field" required>
            {INSTALLABLE_RUBRICS.map((id) => (
              <option key={id} value={id}>
                {rubricById(id)?.name ?? id}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-ink-300">
            Must match the <code>rubricId</code> inside the JSON, or it is refused.
          </p>
        </div>

        <div>
          <label htmlFor="pack" className="field-label">
            The pack, as JSON
          </label>
          <textarea
            id="pack"
            name="pack"
            required
            rows={16}
            spellCheck={false}
            placeholder={EXAMPLE}
            className="field font-mono text-xs"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="solid" disabled={pending || demo}>
            {pending ? "Checking…" : "Install"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
