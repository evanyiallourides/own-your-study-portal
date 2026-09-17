import type { Metadata } from "next";
import Link from "next/link";

import { IaSubmitForm } from "@/components/portal/ia-submit-form";
import { Badge, ButtonLink, Card, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { SUBJECT_LABEL, formatSession, selectableSessions } from "@/lib/ia/rubrics";
import { CATALOGUE, baseCurrencyFor, formatMoney } from "@/lib/catalogue";
import type { IaSubmissionWithReviews } from "@/lib/types";

export const metadata: Metadata = { title: "IA Review" };
export const dynamic = "force-dynamic";

/**
 * The student's IA reviews.
 *
 * The balance decides what this page leads with. Somebody with a credit should
 * see the upload form first — they have paid and they are here to use it — and
 * somebody with none should see what it costs and what they get. Putting the
 * form above a "you have none left" notice is how a student fills in four
 * fields before being told they cannot submit.
 */
export default async function StudentIaReview() {
  const session = await requireRole("student");
  const repo = await repositoryFor(session);

  if (!session.studentId) {
    return (
      <EmptyState
        title="No student record"
        description="This account is not linked to a student yet. Your tutor can put that right."
      />
    );
  }

  const [credits, submissions] = await Promise.all([
    repo.getIaCredits(session.studentId),
    repo.listIaSubmissions({ studentId: session.studentId }),
  ]);

  const sessions = selectableSessions().map(formatSession);

  return (
    <div className="space-y-8">
      <SectionHead
        as="h1"
        title="IA Review"
        description="Send an internal assessment in and get it read against the published criteria — what is working, what is holding it back, and what to do about it, pointed at the actual pages of your report."
      />

      {credits.balance > 0 ? (
        <IaSubmitForm sessions={sessions} creditsLeft={credits.balance} />
      ) : (
        <BuyPanel />
      )}

      {credits.balance > 0 ? (
        <p className="text-xs text-ink-300">
          {credits.balance} review{credits.balance === 1 ? "" : "s"} available.
        </p>
      ) : null}

      <div>
        <h2 className="font-display text-xl font-semibold text-ink">Your reviews</h2>
        {submissions.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nothing sent in yet"
              description="Once you send an IA in, the review and everything it points at will live here."
            />
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {submissions.map((entry) => (
              <SubmissionRow key={entry.submission.id} entry={entry} />
            ))}
          </ul>
        )}
      </div>

      <ThreeSubjectsNote />
    </div>
  );
}

function SubmissionRow({ entry }: { entry: IaSubmissionWithReviews }) {
  const { submission } = entry;
  const review = entry.reviews[0];

  return (
    <li>
      <Link
        href={`/student/ia-review/${submission.id}`}
        className="card flex flex-wrap items-center justify-between gap-4 p-4 transition-colors hover:border-ink-300"
      >
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {SUBJECT_LABEL[submission.subject]} {submission.level}
          </p>
          <p className="mt-0.5 text-sm text-ink-300">
            {submission.session} · {submission.fileName} · {formatDate(submission.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {submission.professionalReviewRequestedAt ? (
            <Badge tone="info">Tutor review requested</Badge>
          ) : null}
          {submission.status === "failed" ? (
            <Badge tone="danger">Could not be read</Badge>
          ) : submission.status === "reviewing" ? (
            <Badge tone="neutral">Reading…</Badge>
          ) : review?.mode === "marking" && review.total !== null ? (
            <Badge tone="accent">
              {review.total} / {review.maxTotal} provisional
            </Badge>
          ) : review ? (
            <Badge tone="neutral">Feedback</Badge>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

/**
 * What it costs, for somebody with nothing left to spend.
 *
 * The price comes from the catalogue rather than being typed here, for the
 * same reason every other price on the network does: one number, in one place,
 * in four currencies.
 */
function BuyPanel() {
  const sku = CATALOGUE.find((s) => s.slug === "ia-marking");
  if (!sku) return null;

  const currency = baseCurrencyFor("own-your-ib");

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">
          {formatMoney(sku.amounts[currency], currency)} for one IA review
        </h2>
        <p className="mt-1.5 text-sm text-ink-500">
          Biology, Chemistry, or Mathematics: Analysis and Approaches, at SL or HL. You get it back
          in a couple of minutes.
        </p>
      </div>

      <ul className="space-y-2 text-sm text-ink-700">
        {[
          "Every criterion, with the evidence for what is said pointed at the page it is on.",
          "A ranked action list, each item labelled by whether it means rewriting, re-working your data, or collecting something new.",
          "A log of which of your calculations were actually re-done, and what each check does and does not cover.",
        ].map((line) => (
          <li key={line.slice(0, 20)} className="flex gap-3">
            <span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <ButtonLink href={`/checkout/ia-marking?ccy=${currency}`} variant="solid">
        Buy a review
      </ButtonLink>
    </Card>
  );
}

/** Sitting three sciences means three IAs, and the checkout sells by the unit. */
function ThreeSubjectsNote() {
  return (
    <p className="text-xs text-ink-300">
      Reviews are not tied to a subject — buy three and use them on Biology, Chemistry and Maths,
      or three times on the same report as you revise it.
    </p>
  );
}
