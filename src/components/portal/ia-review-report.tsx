import { Badge, Card, KeyValue, NoteList, Rule } from "@/components/ui/primitives";
import { criterionIn, rubricById, SUBJECT_LABEL } from "@/lib/ia/rubrics";
import { WORK_TYPE_LABEL, type CriterionResult, type IaReview } from "@/lib/ia/schema";

/* ==========================================================================
   The review, as a student reads it
   --------------------------------------------------------------------------
   Server-rendered: there is nothing interactive here, and the content is
   already fetched.

   The ordering is an argument about what this thing is for. The mode banner
   comes first — before the marks, before the overview — because whether these
   are provisional marks or written feedback changes how every number below it
   should be read, and a caveat underneath a figure is a caveat nobody reads.

   Then the actions, then the criteria, then the verification log. A student
   opening this the week before a deadline wants to know what to do, and the
   criterion-by-criterion detail is what they come back to afterwards.
   ========================================================================== */

export function IaReviewReport({ review }: { review: IaReview }) {
  const rubric = rubricById(review.rubricId);

  return (
    <div className="space-y-6">
      <ModeBanner review={review} />

      {review.mode === "marking" ? <MarkTable review={review} /> : null}

      <Card>
        <p className="eyebrow mb-2">In short</p>
        <p className="text-ink-700 leading-relaxed">{review.assessment.overview}</p>
      </Card>

      {review.assessment.priorities.length > 0 ? (
        <Card>
          <h2 className="font-display text-lg font-semibold text-ink">
            What to do next, in order
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            Ordered by what it costs you to leave alone, not by where it appears in your report.
          </p>
          <ol className="mt-4 space-y-4">
            {review.assessment.priorities.map((priority, i) => (
              <li key={`${i}-${priority.title.slice(0, 20)}`} className="flex gap-4">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-wash text-xs font-semibold text-accent">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-ink">{priority.title}</p>
                  <p className="mt-1 text-sm text-ink-500">{priority.why}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge tone={workTone(priority.work_type)}>
                      {WORK_TYPE_LABEL[priority.work_type]}
                    </Badge>
                    <span className="text-xs text-ink-300">
                      {criterionName(review, priority.criterion_id)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <div className="space-y-4">
        <h2 className="font-display text-xl font-semibold text-ink">Criterion by criterion</h2>
        {review.assessment.criteria.map((criterion) => (
          <CriterionCard
            key={criterion.id}
            criterion={criterion}
            name={criterionName(review, criterion.id)}
            max={rubric ? (criterionIn(rubric, criterion.id)?.max ?? null) : null}
          />
        ))}
      </div>

      {review.assessment.verification_checks.length > 0 ? (
        <Card>
          <h2 className="font-display text-lg font-semibold text-ink">What was checked</h2>
          <p className="mt-1 text-sm text-ink-500">
            Every calculation that was actually re-done, with what the check does and does not
            cover. Anything not listed here was read, not verified.
          </p>
          <div className="mt-4 space-y-4">
            {review.assessment.verification_checks.map((check, i) => (
              <div key={`${i}-${check.what.slice(0, 20)}`} className="rounded-[8px] border border-rule bg-paper p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-ink">{check.what}</p>
                  <Badge
                    tone={
                      check.status === "confirmed"
                        ? "success"
                        : check.status === "contradicted"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {check.status === "confirmed"
                      ? "Agrees"
                      : check.status === "contradicted"
                        ? "Disagrees"
                        : "Not verified"}
                  </Badge>
                </div>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <KeyValue label="Values used">{check.inputs}</KeyValue>
                  <KeyValue label="Method">{check.method}</KeyValue>
                  <KeyValue label="Result">{check.result}</KeyValue>
                  <KeyValue label="Scope">{check.scope}</KeyValue>
                </dl>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {review.assessment.questions_for_student.length > 0 ? (
        <Card>
          <h2 className="font-display text-lg font-semibold text-ink">
            Questions we could not answer from the document
          </h2>
          <p className="mt-1 mb-4 text-sm text-ink-500">
            The answers to these would change the review. Worth settling before you revise.
          </p>
          <NoteList items={review.assessment.questions_for_student} />
        </Card>
      ) : null}

      <Provenance review={review} />
    </div>
  );
}

/* --------------------------------------------------------------------------
   The banner
   --------------------------------------------------------------------------
   In feedback mode this is the single most important element on the page, so
   it is not a footnote in grey. A student who believes they have been marked
   when they have not will plan around a number that does not exist.
   -------------------------------------------------------------------------- */

function ModeBanner({ review }: { review: IaReview }) {
  if (review.mode === "marking") {
    return (
      <div className="rounded-[14px] border border-warning/25 bg-warning-wash px-5 py-4">
        <p className="font-semibold text-warning">These marks are provisional</p>
        <p className="mt-1.5 text-sm text-ink-700">
          They are produced against the official {review.rubricName} descriptors, and they are not
          an IB result. Nobody here is an examiner, this has not been calibrated against real
          marked work, and your teacher marks your IA. Read the marks as an indication of where
          the work stands and the feedback below as the useful part.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-info/20 bg-info-wash px-5 py-4">
      <p className="font-semibold text-info">Written feedback, without marks</p>
      <div className="mt-2 space-y-2 text-sm text-ink-700">
        {review.modeReasons.map((reason, i) => (
          <p key={i}>{reason}</p>
        ))}
      </div>
      <p className="mt-3 text-sm text-ink-700">
        Everything below — the evidence, the priorities and the actions — is the full review.
      </p>
    </div>
  );
}

function MarkTable({ review }: { review: IaReview }) {
  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Provisional</p>
          <p className="font-display text-3xl font-semibold text-ink">
            {review.total === null ? "—" : review.total}
            <span className="text-xl text-ink-300"> / {review.maxTotal}</span>
          </p>
        </div>
        <p className="max-w-[34ch] text-xs text-ink-300">
          {review.total === null
            ? "No total: at least one criterion could not be assessed, so a number out of " +
              `${review.maxTotal} would be a total of only part of your report.`
            : `${SUBJECT_LABEL[review.subject]} ${review.level}, ${review.session}.`}
        </p>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------------------
   One criterion
   -------------------------------------------------------------------------- */

function CriterionCard({
  criterion,
  name,
  max,
}: {
  criterion: CriterionResult;
  name: string;
  max: number | null;
}) {
  return (
    <Card as="article">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="font-display text-lg font-semibold text-ink">{name}</h3>
        {criterion.mark !== null && max !== null ? (
          <Badge tone="accent">
            {criterion.mark} / {max}
          </Badge>
        ) : (
          <Badge tone="neutral">Not marked</Badge>
        )}
      </div>

      {criterion.mark === null && criterion.not_assessed_reason ? (
        <p className="mt-2 text-sm text-ink-500">{criterion.not_assessed_reason}</p>
      ) : null}

      {criterion.rationale ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-700">{criterion.rationale}</p>
      ) : null}

      {criterion.strengths.length > 0 ? (
        <div className="mt-5">
          <p className="eyebrow mb-2">Working well</p>
          <NoteList items={criterion.strengths} tone="accent" />
        </div>
      ) : null}

      {criterion.limiting.length > 0 ? (
        <div className="mt-5">
          <p className="eyebrow mb-2">Holding it back</p>
          <NoteList items={criterion.limiting} tone="warning" />
        </div>
      ) : null}

      {criterion.evidence.length > 0 ? (
        <div className="mt-5">
          <p className="eyebrow mb-2">Where in your report</p>
          <ul className="space-y-3">
            {criterion.evidence.map((item, i) => (
              <li key={`${i}-${item.location}`} className="rounded-[8px] border border-rule bg-paper p-3">
                <p className="text-xs font-semibold text-ink-300">{item.location}</p>
                <p className="mt-1.5 border-l-2 border-rule pl-3 text-sm italic text-ink-500">
                  {item.excerpt}
                </p>
                <p className="mt-2 text-sm text-ink-700">{item.observation}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {criterion.actions.length > 0 ? (
        <>
          <Rule className="my-5" />
          <p className="eyebrow mb-3">What to do</p>
          <ul className="space-y-4">
            {criterion.actions.map((action, i) => (
              <li key={`${i}-${action.action.slice(0, 20)}`}>
                <p className="text-sm text-ink-700">{action.action}</p>
                <p className="mt-1.5 text-sm text-ink-500">
                  <span className="font-medium text-ink">Done when:</span> {action.completion_check}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={workTone(action.work_type)}>
                    {WORK_TYPE_LABEL[action.work_type]}
                  </Badge>
                  {action.location ? (
                    <span className="text-xs text-ink-300">{action.location}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

/* --------------------------------------------------------------------------
   Provenance
   --------------------------------------------------------------------------
   Which rubric, which descriptors, which model, which prompt, which file.
   Small and at the bottom, and present on every review — a mark that cannot be
   explained a year later should not have been shown, and this is what makes
   the explanation possible.
   -------------------------------------------------------------------------- */

function Provenance({ review }: { review: IaReview }) {
  return (
    <details className="rounded-[14px] border border-rule bg-paper-3/60 px-5 py-4">
      <summary className="cursor-pointer text-sm font-medium text-ink-500">
        How this review was produced
      </summary>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <KeyValue label="Marking model">{review.rubricName}</KeyValue>
        <KeyValue label="Session">{review.session}</KeyValue>
        <KeyValue label="Official descriptors">
          {review.assessmentPackVersion ?? "Not held — this review carries no marks"}
        </KeyValue>
        <KeyValue label="Calibration">
          Uncalibrated. Never measured against real marked work.
        </KeyValue>
        <KeyValue label="Model">{review.modelId}</KeyValue>
        <KeyValue label="Instructions">{review.promptVersion}</KeyValue>
        <KeyValue label="Your file">
          <span className="font-mono text-xs">{review.documentHash.slice(0, 16)}…</span>
        </KeyValue>
        <KeyValue label="Produced">
          {new Date(review.createdAt).toLocaleString("en-GB")}
        </KeyValue>
      </dl>
    </details>
  );
}

/* --------------------------------------------------------------------------
   Odds and ends
   -------------------------------------------------------------------------- */

function workTone(work: CriterionResult["actions"][number]["work_type"]) {
  // Tone tracks cost, not severity: collecting new evidence is the thing a
  // student may not have time left to do, and it should look different from
  // rewriting a paragraph.
  return work === "clarify" ? "info" : work === "reanalyse" ? "accent" : "warning";
}

function criterionName(review: IaReview, criterionId: string): string {
  const rubric = rubricById(review.rubricId);
  const criterion = rubric ? criterionIn(rubric, criterionId) : null;
  if (!criterion) return criterionId;
  return criterion.letter ? `${criterion.letter}. ${criterion.name}` : criterion.name;
}
