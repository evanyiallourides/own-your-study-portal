"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/states";
import { attachWiseTransfer, linkOrderToStudent, markWiseOrderPaid, unlinkOrder } from "@/lib/actions/orders";

/* ==========================================================================
   Attaching a payment to a student
   --------------------------------------------------------------------------
   The one interactive part of the orders screen. Everything else there is a
   record; this is the queue.

   The select defaults to a student whose email matches the buyer's, when there
   is one, because that is the common case — a parent buying under the address
   the account was invited with. It is only a default: the administrator still
   confirms, since an email match is a guess and attaching a payment to the
   wrong child is a worse mistake than an extra click.
   ========================================================================== */

interface StudentOption {
  id: string;
  name: string;
  email: string;
}

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      router.refresh();
    });
  };

  return { pending, error, run };
}

export function LinkOrderForm({
  orderId,
  buyerEmail,
  students,
}: {
  orderId: string;
  buyerEmail: string;
  students: StudentOption[];
}) {
  const { pending, error, run } = useAction();

  const suggested = students.find(
    (s) => s.email.toLowerCase() === buyerEmail.trim().toLowerCase(),
  );
  const [studentId, setStudentId] = useState(suggested?.id ?? "");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!studentId) return;
        run(() => linkOrderToStudent({ orderId, studentId }));
      }}
    >
      {error ? <ErrorState title="Could not attach it" description={error} /> : null}

      {suggested ? (
        <p className="text-sm text-ink-500">
          <span className="font-medium text-ink">{suggested.name}</span> has this email address.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor={`student-${orderId}`}>
          Student to attach this payment to
        </label>
        <select
          id={`student-${orderId}`}
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="min-w-[16rem] rounded-[8px] border border-rule bg-paper-3 px-3 py-2 text-sm text-ink"
        >
          <option value="">Choose a student…</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.email ? ` · ${s.email}` : ""}
            </option>
          ))}
        </select>

        <Button type="submit" disabled={pending || !studentId}>
          {pending ? "Attaching…" : "Attach this payment"}
        </Button>
      </div>

      <p className="text-xs text-ink-500">
        If nobody here is right, invite the buyer from the Students page — the payment attaches
        itself the first time they sign in.
      </p>
    </form>
  );
}

interface PendingWiseOrderOption {
  id: string;
  reference: string | null;
  skuName: string;
  buyerEmail: string;
}

/**
 * Attaching a Wise transfer nobody's reference matched to the order it paid
 * for. The fallback for the normal failure mode of a bank transfer — a
 * reference mistyped or dropped somewhere along the payer's bank's own rails
 * — so this stays a person's judgement call, the same way LinkOrderForm's
 * suggestion is only ever a default and not an automatic match.
 */
export function AttachWiseTransferForm({
  transferId,
  referenceReceived,
  orders,
}: {
  transferId: string;
  referenceReceived: string | null;
  orders: PendingWiseOrderOption[];
}) {
  const { pending, error, run } = useAction();

  const suggested = referenceReceived
    ? orders.find((o) => o.reference?.toUpperCase() === referenceReceived.trim().toUpperCase())
    : undefined;
  const [orderId, setOrderId] = useState(suggested?.id ?? "");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!orderId) return;
        run(() => attachWiseTransfer({ transferId, orderId }));
      }}
    >
      {error ? <ErrorState title="Could not attach it" description={error} /> : null}

      {suggested ? (
        <p className="text-sm text-ink-500">
          <span className="font-medium text-ink">{suggested.skuName}</span> for{" "}
          {suggested.buyerEmail} carries this exact reference.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor={`order-${transferId}`}>
          Order this transfer paid for
        </label>
        <select
          id={`order-${transferId}`}
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          className="min-w-[20rem] rounded-[8px] border border-rule bg-paper-3 px-3 py-2 text-sm text-ink"
        >
          <option value="">Choose an order…</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.reference ?? "(no reference)"} · {o.skuName} · {o.buyerEmail}
            </option>
          ))}
        </select>

        <Button type="submit" disabled={pending || !orderId}>
          {pending ? "Attaching…" : "Attach this transfer"}
        </Button>
      </div>
    </form>
  );
}

export function UnlinkOrderButton({ orderId }: { orderId: string }) {
  const { pending, error, run } = useAction();
  const [confirming, setConfirming] = useState(false);

  if (error) return <ErrorState title="Could not detach it" description={error} />;

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm text-ink-500 underline underline-offset-4 hover:text-ink"
      >
        Detach
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      {/* Detaching does not revoke anything: access may also have been earned
          through pooled hours, and guessing which applied would be worse than
          leaving it. */}
      <span className="text-ink-500">Detach from this student?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => unlinkOrder({ orderId }))}
        className="font-medium text-danger underline underline-offset-4"
      >
        {pending ? "Detaching…" : "Yes, detach"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-ink-500 underline underline-offset-4"
      >
        Cancel
      </button>
    </span>
  );
}

/**
 * Settling a Wise order by hand — the fallback that works with no API token
 * and no webhook configured at all, and stays useful afterwards for the
 * transfer whose reference never arrived. Confirmed in two steps, the same
 * as detaching an order: this grants whatever the order paid for, and that
 * is not something a stray click should do.
 */
export function MarkWiseOrderPaidButton({ orderId }: { orderId: string }) {
  const { pending, error, run } = useAction();
  const [confirming, setConfirming] = useState(false);

  if (error) return <ErrorState title="Could not mark it paid" description={error} />;

  if (!confirming) {
    return (
      <Button type="button" onClick={() => setConfirming(true)}>
        Mark as paid
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="text-ink-500">Confirmed in Wise — mark this paid?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => markWiseOrderPaid({ orderId }))}
        className="font-medium text-accent underline underline-offset-4"
      >
        {pending ? "Marking…" : "Yes, mark paid"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-ink-500 underline underline-offset-4"
      >
        Cancel
      </button>
    </span>
  );
}
