import Link from "next/link";
import { notFound } from "next/navigation";

import { IaReviewReport } from "@/components/portal/ia-review-report";
import { Card, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireTeachingAccess } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { SUBJECT_LABEL } from "@/lib/ia/rubrics";

export const dynamic = "force-dynamic";

/**
 * A review, as the tutor picking up the escalation reads it.
 *
 * The same report component the student sees, deliberately. A tutor preparing
 * for that conversation needs to know exactly what the student was told —
 * including the banner explaining why there are no marks, which is the thing
 * they are most likely to be asked about.
 *
 * The unresolved items are lifted to the top, because those are the tutor's
 * actual job: the parts the automated review could not settle either way.
 */
export default async function TutorIaReview({
  params,
}: {
  params: Promise<{ studentId: string; submissionId: string }>;
}) {
  const { studentId, submissionId } = await params;
  const session = await requireTeachingAccess();
  const repo = await repositoryFor(session);

  const entry = await repo.getIaSubmission(submissionId).catch(() => null);
  if (!entry || entry.submission.studentId !== studentId) notFound();

  const review = entry.reviews[0];
  const student = await repo.getStudent(studentId).catch(() => null);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/tutor/students/${studentId}`}
          className="text-sm text-ink-300 hover:text-ink"
        >
          ← {student?.profile.firstName ?? "Student"}
        </Link>
        <div className="mt-3">
          <SectionHead
            as="h1"
            title={review?.body.assessment.report_title ?? entry.submission.fileName}
            description={`${SUBJECT_LABEL[entry.submission.subject]} ${entry.submission.level} · ${entry.submission.session} · sent ${formatDate(entry.submission.createdAt)}`}
          />
        </div>
      </div>

      {review && review.body.humanReviewReasons.length > 0 ? (
        <Card className="border-warning/25 bg-warning-wash">
          <p className="font-semibold text-warning">What the review could not settle</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-700">
            {review.body.humanReviewReasons.map((reason, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                  aria-hidden
                />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {entry.submission.studentNote ? (
        <Card>
          <p className="eyebrow mb-2">What the student asked to have looked at</p>
          <p className="text-sm italic text-ink-500">{entry.submission.studentNote}</p>
        </Card>
      ) : null}

      {review ? (
        <IaReviewReport review={review.body} />
      ) : (
        <EmptyState
          title="No review stored"
          description="The document was uploaded but no review was produced against it."
        />
      )}
    </div>
  );
}
