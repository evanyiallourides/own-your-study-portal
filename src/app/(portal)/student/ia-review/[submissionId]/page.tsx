import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { IaReviewReport } from "@/components/portal/ia-review-report";
import { ProfessionalReviewPanel } from "@/components/portal/ia-escalate";
import { Card, SectionHead } from "@/components/ui/primitives";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { SUBJECT_LABEL } from "@/lib/ia/rubrics";

export const metadata: Metadata = { title: "IA Review" };
export const dynamic = "force-dynamic";

export default async function StudentIaReviewDetail({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  const session = await requireRole("student");
  const repo = await repositoryFor(session);

  const entry = await repo.getIaSubmission(submissionId);
  if (!entry) notFound();

  const { submission } = entry;
  const review = entry.reviews[0];

  return (
    <div className="space-y-8">
      <div>
        <Link href="/student/ia-review" className="text-sm text-ink-300 hover:text-ink">
          ← All reviews
        </Link>
        <div className="mt-3">
          <SectionHead
            as="h1"
            title={review?.body.assessment.report_title ?? submission.fileName}
            description={`${SUBJECT_LABEL[submission.subject]} ${submission.level} · ${submission.session} · sent ${formatDate(submission.createdAt)}`}
          />
        </div>
      </div>

      {submission.status === "failed" ? (
        <ErrorState
          title="This one could not be reviewed"
          description={`${submission.failureNote ?? "Something went wrong reading the file."} No review was used up — your balance is unchanged.`}
        />
      ) : null}

      {submission.status === "reviewing" ? (
        <Card>
          <p className="font-medium text-ink">Still reading it</p>
          <p className="mt-1 text-sm text-ink-500">
            Refresh in a moment. If this has not moved in ten minutes, something has gone wrong and
            your review has not been used.
          </p>
        </Card>
      ) : null}

      {submission.studentNote ? (
        <Card>
          <p className="eyebrow mb-2">You asked us to look at</p>
          <p className="text-sm italic text-ink-500">{submission.studentNote}</p>
        </Card>
      ) : null}

      {review ? (
        <IaReviewReport review={review.body} />
      ) : submission.status === "reviewed" ? (
        <EmptyState
          title="The review is missing"
          description="The submission was marked as reviewed but no review is stored against it. Tell your tutor — this is our fault, not yours."
        />
      ) : null}

      {review ? (
        <ProfessionalReviewPanel
          submissionId={submission.id}
          alreadyRequested={submission.professionalReviewRequestedAt !== null}
          hasUnresolved={review.body.humanReviewReasons.length > 0}
          unresolved={review.body.humanReviewReasons}
        />
      ) : null}
    </div>
  );
}
