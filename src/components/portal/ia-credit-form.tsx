"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/primitives";
import { grantIaCredits } from "@/lib/actions/ia";
import { formatDate } from "@/lib/format";
import type { IaCreditLedger } from "@/lib/types";

/* ==========================================================================
   Adding or correcting IA review credits
   --------------------------------------------------------------------------
   Administrators only. Two reasons this exists rather than leaving credits
   entirely to the checkout:

     · a review that failed in a way the automatic refund did not catch, and
       somebody has to make it right without asking the student to pay twice;
     · a package sold with reviews included, where the money arrived through a
       tutoring SKU rather than through `ia-marking`.

   Negative numbers are allowed, and they are how a mistake gets corrected —
   not by deleting a ledger row. The ledger is the record of what happened,
   including what happened by accident, and an entry that can be removed is not
   a record.

   A note is required. "Why does this student have three credits?" is a
   question somebody will ask, and the answer should be on the row.
   ========================================================================== */

export function IaCreditForm({
  studentId,
  ledger,
}: {
  studentId: string;
  ledger: IaCreditLedger;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="font-display text-2xl font-semibold text-ink">{ledger.balance}</p>
        <p className="text-sm text-ink-500">
          review{ledger.balance === 1 ? "" : "s"} available
        </p>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <form
        ref={formRef}
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            const result = await grantIaCredits({
              studentId,
              count: Number(formData.get("count")),
              note: String(formData.get("note") ?? ""),
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            formRef.current?.reset();
            router.refresh();
          });
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <div>
          <label htmlFor="count" className="field-label">
            Change by
          </label>
          <input
            id="count"
            name="count"
            type="number"
            defaultValue={1}
            min={-20}
            max={20}
            required
            className="field w-24 tabular-nums"
          />
        </div>
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="note" className="field-label">
            Why
          </label>
          <input
            id="note"
            name="note"
            type="text"
            required
            maxLength={200}
            placeholder="Included with the Committed Pack"
            className="field"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Apply"}
        </Button>
      </form>

      {ledger.entries.length > 0 ? (
        <div>
          <p className="eyebrow mb-2">Ledger</p>
          <ul className="space-y-1.5 text-sm">
            {ledger.entries.slice(0, 8).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-2">
                <span
                  className={`w-8 shrink-0 text-right font-semibold tabular-nums ${
                    entry.delta > 0 ? "text-success" : "text-ink-500"
                  }`}
                >
                  {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                </span>
                <span className="text-ink-700">{entry.note ?? REASON_LABEL[entry.reason]}</span>
                <span className="text-xs text-ink-300">{formatDate(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const REASON_LABEL: Record<IaCreditLedger["entries"][number]["reason"], string> = {
  purchase: "Bought",
  admin_grant: "Granted",
  review: "Spent on a review",
  refund: "Returned on a refund",
  correction: "Corrected",
};
