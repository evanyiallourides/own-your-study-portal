"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, ButtonLink, Card, NoteList } from "@/components/ui/primitives";
import { requestProfessionalReview } from "@/lib/actions/ia";
import { CATALOGUE, baseCurrencyFor, formatMoney } from "@/lib/catalogue";

/* ==========================================================================
   Taking it to a person
   --------------------------------------------------------------------------
   The escalation from the automated review to a tutor, through the IA & EE
   Strategy Package.

   Two decisions worth defending, because the obvious build is different:

     1. It sits at the BOTTOM of the review, not the top. A student who has
        just paid forty-five dollars should read what they bought before being
        sold something else. An upsell above the feedback would make the
        feedback look like a sales device, which would also be the most
        expensive possible thing to do to a service whose whole value is that
        its assessment is honest.

     2. It is a conversation, not a second checkout. The button records the
        request and tells the practice; nobody is charged four hundred and
        sixty-eight dollars by clicking a button at the end of a report that
        has just told them their evaluation is thin. Six hours of a tutor's
        time is worth a conversation first, and a student who does not need six
        hours should be told so.

   When the review itself flagged something for a human — a calculation it
   could not verify, a disagreement between passes — that is shown here as the
   actual reason rather than as generic encouragement to buy. It is the honest
   version of the same offer and it is a better one.
   ========================================================================== */

export function ProfessionalReviewPanel({
  submissionId,
  alreadyRequested,
  hasUnresolved,
  unresolved,
}: {
  submissionId: string;
  alreadyRequested: boolean;
  hasUnresolved: boolean;
  unresolved: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(alreadyRequested);

  const sku = CATALOGUE.find((s) => s.slug === "ia-strategy");
  const currency = baseCurrencyFor("own-your-ib");

  return (
    <Card className="space-y-4">
      <div>
        <p className="eyebrow mb-2">Where this stops</p>
        <h2 className="font-display text-lg font-semibold text-ink">
          A tutor who teaches the subject can take it further
        </h2>
        <p className="mt-2 text-sm text-ink-500">
          This review reads what you wrote and checks what it can check. What it cannot do is sit
          with you while you decide whether your research question is the right one, work through a
          method with you before you run it, or tell you what an examiner tends to do with an
          investigation shaped like yours.
        </p>
      </div>

      {hasUnresolved ? (
        <div className="rounded-[8px] border border-warning/25 bg-warning-wash p-4">
          <p className="text-sm font-medium text-warning">
            This review left {unresolved.length === 1 ? "something" : "some things"} unresolved
          </p>
          <div className="mt-3">
            <NoteList items={unresolved.slice(0, 4)} tone="warning" />
          </div>
          <p className="mt-3 text-xs text-ink-500">
            These are the parts a person should look at. Nothing here means your work is wrong — it
            means the automated review could not settle it either way.
          </p>
        </div>
      ) : null}

      {sku ? (
        <div className="rounded-[8px] border border-rule bg-paper p-4">
          <p className="font-medium text-ink">
            {sku.name} — {formatMoney(sku.amounts[currency], currency)}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            Six hours with a tutor across your IA and your extended essay. Booked around your
            deadlines, not ours.
          </p>
        </div>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {done ? (
        <p className="rounded-[8px] border border-success/20 bg-success-wash px-4 py-3 text-sm text-ink-700">
          Asked for. Someone will be in touch about which subject and how much time it actually
          needs — which may be less than six hours.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="solid"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await requestProfessionalReview({ submissionId });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setDone(true);
                router.refresh();
              });
            }}
          >
            {pending ? "Asking…" : "Ask a tutor to look at this"}
          </Button>
          {sku ? (
            <ButtonLink href={`/checkout/${sku.slug}?ccy=${currency}`} variant="ghost">
              Or read what the package covers
            </ButtonLink>
          ) : null}
        </div>
      )}

      <p className="text-xs text-ink-300">
        Asking costs nothing and commits you to nothing.
      </p>
    </Card>
  );
}
