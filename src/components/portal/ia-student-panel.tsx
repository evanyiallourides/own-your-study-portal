import Link from "next/link";

import { Badge, Card, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";
import { SUBJECT_LABEL } from "@/lib/ia/rubrics";
import type { IaSubmissionWithReviews } from "@/lib/types";

/* ==========================================================================
   A student's IA reviews, for whoever is teaching them
   --------------------------------------------------------------------------
   Read-only, and shared by the tutor's and the administrator's student pages.

   The reason a tutor needs this at all is the escalation: a student reads an
   automated review, asks for a person, and the tutor who picks that up should
   arrive already knowing what the student has been told. Walking into that
   conversation blind — and contradicting a review the student has read twice —
   is the specific failure this is here to prevent.

   What it deliberately does NOT show is the whole review inline. The tutor
   opens it if they are going to work on it; a long report pasted into a
   student profile page buries the lessons and homework underneath it.
   ========================================================================== */

export function IaStudentPanel({
  entries,
  hrefBase,
  creditBalance,
}: {
  entries: IaSubmissionWithReviews[];
  /** Where a row links to. Different for tutors and administrators. */
  hrefBase: string;
  /** Null hides the line — a tutor has no business with the billing. */
  creditBalance: number | null;
}) {
  if (entries.length === 0 && creditBalance === null) return null;

  return (
    <section>
      <SectionHead
        title="IA reviews"
        description={
          entries.some((e) => e.submission.professionalReviewRequestedAt)
            ? "This student has asked for a person to read one of these."
            : "Internal assessments this student has sent in for automated review."
        }
      />

      {creditBalance !== null ? (
        <p className="mb-4 text-sm text-ink-300">
          {creditBalance} review{creditBalance === 1 ? "" : "s"} left on the account.
        </p>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          title="Nothing sent in"
          description="Reviews appear here as the student uploads work."
        />
      ) : (
        <ul className="space-y-3">
          {entries.map(({ submission, reviews }) => {
            const review = reviews[0];
            return (
              <li key={submission.id}>
                <Card className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {review?.body.assessment.report_title ?? submission.fileName}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-300">
                      {SUBJECT_LABEL[submission.subject]} {submission.level} ·{" "}
                      {submission.session} · {stageLabel(submission.stage)} ·{" "}
                      {formatDate(submission.createdAt)}
                    </p>
                    {submission.studentNote ? (
                      <p className="mt-2 max-w-[60ch] text-sm italic text-ink-500">
                        “{submission.studentNote}”
                      </p>
                    ) : null}
                    {review && review.body.humanReviewReasons.length > 0 ? (
                      <p className="mt-2 text-sm text-warning">
                        {review.body.humanReviewReasons.length} thing
                        {review.body.humanReviewReasons.length === 1 ? "" : "s"} the review
                        could not settle.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {submission.professionalReviewRequestedAt ? (
                      <Badge tone="warning">Asked for a tutor</Badge>
                    ) : null}
                    {review?.mode === "marking" && review.total !== null ? (
                      <Badge tone="accent">
                        {review.total} / {review.maxTotal} provisional
                      </Badge>
                    ) : review ? (
                      <Badge tone="neutral">Written feedback</Badge>
                    ) : (
                      <Badge tone="neutral">{submission.status}</Badge>
                    )}
                    {review ? (
                      <Link
                        href={`${hrefBase}/${submission.id}`}
                        className="text-sm font-medium text-accent hover:underline"
                      >
                        Read it
                      </Link>
                    ) : null}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function stageLabel(stage: IaSubmissionWithReviews["submission"]["stage"]): string {
  return stage === "partial_draft"
    ? "partial draft"
    : stage === "complete_draft"
      ? "complete draft"
      : "final";
}
