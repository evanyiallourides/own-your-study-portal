import type { Metadata } from "next";
import Link from "next/link";

import { IaPackInstaller } from "@/components/portal/ia-pack-installer";
import { Badge, Card, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { isDemoMode } from "@/lib/env";
import { packStatuses } from "@/lib/ia/packs";
import { packLoader } from "@/lib/ia/pack-store";
import { INSTALLABLE_RUBRICS, SUBJECT_LABEL } from "@/lib/ia/rubrics";
import { isMarkingConfigured } from "@/lib/ia/mark";
import type { IaSubmissionWithReviews } from "@/lib/types";

export const metadata: Metadata = { title: "IA Reviews" };
export const dynamic = "force-dynamic";

/**
 * The administrator's view of the IA review service.
 *
 * Two things, and the order is deliberate. The pack status comes first because
 * it is the single fact that decides what every student is receiving: with no
 * pack installed, every review on the network is feedback-only, and that is
 * something the person running the practice should see on opening the page
 * rather than discover from a student's email.
 *
 * Then the escalations — students who have asked for a person. That is the
 * only part of this screen that needs somebody to do something.
 */
export default async function AdminIaReviews() {
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);

  const [statuses, escalated, recent] = await Promise.all([
    packStatuses(packLoader(), [...INSTALLABLE_RUBRICS]),
    repo.listIaSubmissions({ escalatedOnly: true }),
    repo.listIaSubmissions(),
  ]);

  const installed = statuses.filter((s) => s.installed).length;

  return (
    <div className="space-y-8">
      <SectionHead
        as="h1"
        title="IA Reviews"
        description="Automated internal assessment feedback, and the escalations that need a tutor."
      />

      {!isMarkingConfigured() ? (
        <div className="rounded-[14px] border border-danger/25 bg-danger-wash px-5 py-4">
          <p className="font-semibold text-danger">No OPENAI_API_KEY is set</p>
          <p className="mt-1 text-sm text-ink-700">
            Nothing can be reviewed on this deployment. The upload form refuses rather than taking
            a credit, so no student is charged for a review that cannot run.
          </p>
        </div>
      ) : null}

      {/* -- Assessment packs ------------------------------------------- */}
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">Official descriptors</h2>
        <p className="mt-1 mb-4 max-w-[68ch] text-sm text-ink-500">
          IB&rsquo;s achievement descriptors are not in this repository and are not ours to
          publish. Until a pack is installed for a marking model, every review against that model
          gives written feedback and withholds marks — which is the designed behaviour, not a
          fault. Install only material this practice is licensed to hold.
        </p>

        {installed === 0 ? (
          <div className="mb-4 rounded-[14px] border border-info/20 bg-info-wash px-5 py-4">
            <p className="font-semibold text-info">
              Every review is currently feedback-only
            </p>
            <p className="mt-1 text-sm text-ink-700">
              No descriptors are installed for any model. Students get the full written review with
              no marks, and each review says so at the top before anything else.
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {statuses.map((status) => (
            <Card key={status.rubricId} className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-ink">{status.rubricName}</p>
                <Badge tone={status.installed ? "success" : "neutral"}>
                  {status.installed ? "Marks" : "Feedback only"}
                </Badge>
              </div>
              {status.installed ? (
                <>
                  <p className="text-sm text-ink-500">{status.version}</p>
                  <p className="font-mono text-xs text-ink-300">
                    {status.checksum?.slice(0, 16)}…
                  </p>
                  {status.installedAt ? (
                    <p className="text-xs text-ink-300">
                      Installed {formatDate(status.installedAt)}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-ink-300">Nothing installed.</p>
              )}
              {status.problems.length > 0 ? (
                <ul className="space-y-1 text-xs text-danger">
                  {status.problems.slice(0, 3).map((p) => (
                    <li key={p.field}>
                      {p.field}: {p.detail}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ))}
        </div>

        <div className="mt-4">
          <IaPackInstaller demo={isDemoMode()} />
        </div>
      </div>

      {/* -- Escalations ------------------------------------------------- */}
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">
          Asked for a tutor
          {escalated.length > 0 ? (
            <span className="ml-2 align-middle">
              <Badge tone="warning">{escalated.length}</Badge>
            </span>
          ) : null}
        </h2>
        <p className="mt-1 mb-4 text-sm text-ink-500">
          Students who have read their automated review and want a person. This is the conversation
          about the IA &amp; EE Strategy Package.
        </p>

        {escalated.length === 0 ? (
          <EmptyState title="Nobody waiting" description="Requests appear here as they come in." />
        ) : (
          <ul className="space-y-3">
            {escalated.map(({ submission, reviews }) => (
              <li key={submission.id}>
                <Card className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {SUBJECT_LABEL[submission.subject]} {submission.level} · {submission.session}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-300">
                      Asked {formatDate(submission.professionalReviewRequestedAt!)} ·{" "}
                      {reviews[0]?.mode === "marking" && reviews[0].total !== null
                        ? `${reviews[0].total}/${reviews[0].maxTotal} provisional`
                        : "Feedback only"}
                      {reviews[0]?.body.humanReviewReasons.length
                        ? ` · ${reviews[0].body.humanReviewReasons.length} unresolved`
                        : ""}
                    </p>
                  </div>
                  <Link
                    href={`/admin/students/${submission.studentId}`}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    Open student
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* -- Everything, for volume ------------------------------------- */}
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">Recent reviews</h2>
        {recent.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No reviews yet" />
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {recent.slice(0, 20).map(({ submission, reviews }) => (
              <li
                key={submission.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-rule bg-paper-3 px-4 py-3 text-sm"
              >
                <span className="text-ink">
                  {SUBJECT_LABEL[submission.subject]} {submission.level} · {submission.session}
                </span>
                <span className="text-ink-300">
                  {formatDate(submission.createdAt)} · {outcomeOf(submission, reviews)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * What became of a submission, in words rather than in enum values.
 *
 * `feedback_only` was previously rendered straight onto the page. It is an
 * identifier in a database column, not a sentence, and the difference matters
 * on the one screen where somebody is deciding whether the service is working.
 */
function outcomeOf(
  submission: IaSubmissionWithReviews["submission"],
  reviews: IaSubmissionWithReviews["reviews"],
): string {
  if (submission.status === "failed") return "could not be read, not charged";
  if (submission.status === "reviewing") return "still running";

  const review = reviews[0];
  if (!review) return "no review stored";
  if (review.mode === "feedback_only") return "written feedback";
  return review.total === null
    ? "marked, no total"
    : `${review.total} / ${review.maxTotal} provisional`;
}
