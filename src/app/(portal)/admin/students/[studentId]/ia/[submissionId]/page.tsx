import Link from "next/link";
import { notFound } from "next/navigation";

import { IaReviewReport } from "@/components/portal/ia-review-report";
import { Card, KeyValue, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { SUBJECT_LABEL } from "@/lib/ia/rubrics";

export const dynamic = "force-dynamic";

/**
 * A review, for whoever runs the practice.
 *
 * The same report the student reads, with the submission's own record above it.
 * That record is the part an administrator needs and a student does not: which
 * file, how big, how many words, and whether a person has been asked for — the
 * facts you want in front of you when somebody writes in about a review.
 */
export default async function AdminIaReview({
  params,
}: {
  params: Promise<{ studentId: string; submissionId: string }>;
}) {
  const { studentId, submissionId } = await params;
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);

  const entry = await repo.getIaSubmission(submissionId).catch(() => null);
  if (!entry || entry.submission.studentId !== studentId) notFound();

  const { submission } = entry;
  const review = entry.reviews[0];
  const student = await repo.getStudent(studentId).catch(() => null);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/admin/students/${studentId}`}
          className="text-sm text-ink-300 hover:text-ink"
        >
          ← {student?.profile.fullName ?? "Student"}
        </Link>
        <div className="mt-3">
          <SectionHead
            as="h1"
            title={review?.body.assessment.report_title ?? submission.fileName}
            description={`${SUBJECT_LABEL[submission.subject]} ${submission.level} · ${submission.session}`}
          />
        </div>
      </div>

      <Card>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <KeyValue label="File">{submission.fileName}</KeyValue>
          <KeyValue label="Size">{(submission.fileSize / 1024 / 1024).toFixed(1)} MB</KeyValue>
          <KeyValue label="Words extracted">
            {submission.wordCount?.toLocaleString("en-GB") ?? "—"}
          </KeyValue>
          <KeyValue label="Stage">{submission.stage.replace(/_/g, " ")}</KeyValue>
          <KeyValue label="Sent">{formatDate(submission.createdAt)}</KeyValue>
          <KeyValue label="Asked for a tutor">
            {submission.professionalReviewRequestedAt
              ? formatDate(submission.professionalReviewRequestedAt)
              : "No"}
          </KeyValue>
        </dl>
        {submission.failureNote ? (
          <p className="mt-4 rounded-[8px] border border-danger/25 bg-danger-wash px-4 py-3 text-sm text-ink-700">
            {submission.failureNote}
          </p>
        ) : null}
      </Card>

      {review ? (
        <IaReviewReport review={review.body} />
      ) : (
        <EmptyState
          title="No review stored"
          description="The document was uploaded but no review was produced against it. The student was not charged."
        />
      )}
    </div>
  );
}
