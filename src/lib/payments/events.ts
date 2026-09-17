/* ==========================================================================
   What a payment signal means for an order
   --------------------------------------------------------------------------
   Kept apart from the routes, and free of every Next and provider import, for
   the same reason `recall/webhook.ts` is kept apart from its route: the
   decisions are the part worth testing, and they are hard to test through an
   HTTP handler holding a database connection.

   This deliberately does NOT switch on provider event names. Card checkout and
   direct debit describe the same few things in completely different
   vocabularies — Stripe says `checkout.session.async_payment_succeeded`,
   GoCardless says `payments.confirmed` — but an order only ever wants to know
   which of nine things happened. Each provider's route maps its own webhook
   into a `PaymentSignal`; everything below is shared.

   Three rules are easy to get wrong and are therefore stated once, here:

     1. Authorisation is not payment. A card clears in a second, but Klarna
        settles later and a Bacs or BECS debit is authorised now and confirmed
        several working days from now — and can still fail after that. Nothing
        is granted on `authorised`. Getting this wrong hands 2,868 questions to
        anyone who signs a mandate and cancels it.

     2. A failed instalment does not revoke access. Providers retry for weeks;
        revoking on the first failure punishes an expired card. Access goes only
        when the plan is finally abandoned short.

     3. A dispute or chargeback is flagged, never auto-revoked. Most are a
        parent not recognising the statement descriptor.
   ========================================================================== */

export const ORDER_STATUSES = [
  "pending",
  "authorised",
  "paid",
  "instalments_active",
  "past_due",
  "completed",
  "refunded",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type PaymentKind = "payment" | "refund" | "failure" | "dispute";

/**
 * The nine things that can happen to an order, in provider-neutral terms.
 *
 * Stripe and GoCardless map onto these as follows; the mapping itself lives in
 * each provider's route, next to the payload it has to read.
 *
 *   authorised          session completed unpaid  ·  billing request fulfilled
 *   settled             session paid / async ok   ·  payment confirmed
 *   settlement_failed   async payment failed      ·  payment failed
 *   instalment_settled  invoice.paid              ·  payment confirmed (on a plan)
 *   instalment_failed   invoice.payment_failed    ·  payment failed (on a plan)
 *   plan_ended          subscription.deleted      ·  subscription finished
 *   refunded            charge.refunded           ·  refund created
 *   disputed            charge.dispute.created    ·  payment charged back
 *   abandoned           checkout.session.expired  ·  billing request expired
 */
export type SignalKind =
  | "authorised"
  | "settled"
  | "settlement_failed"
  | "instalment_settled"
  | "instalment_failed"
  | "plan_ended"
  | "refunded"
  | "disputed"
  | "abandoned";

export interface PaymentSignal {
  kind: SignalKind;
  /** The provider object this is about — payment, invoice, charge, refund. */
  objectId: string;
  amountMinor?: number;
  currency?: string;
  taxMinor?: number;
  /** For `refunded`: how much of the original has been returned. */
  amountRefundedMinor?: number;
  /** For `plan_ended`: whether it finished rather than lapsed, when known. */
  planCompleted?: boolean;
  detail?: string;
}

/** The order as it stands before this signal is applied. */
export interface OrderState {
  id: string;
  plan: "full" | "instalments";
  status: OrderStatus;
  instalmentMonths: number | null;
  instalmentsPaid: number;
  amountTotalMinor: number;
  amountPaidMinor: number;
  grantsQuestionBankDays: number | null;
  /** IA review credits, per unit of quantity. */
  grantsIaMarkings: number | null;
}

/**
 * Whether this order gave the buyer anything that can be taken back.
 *
 * Asked as one question rather than by naming a column, because naming a
 * column is how the second entitlement gets forgotten: `grants_ia_markings`
 * was added to the orders table and every revoke path still tested only the
 * question bank, so a refunded IA review would have left its credits behind.
 * A third grant should change this function and nothing else.
 */
function grantsSomething(order: OrderState): boolean {
  return order.grantsQuestionBankDays !== null || order.grantsIaMarkings !== null;
}

export interface PaymentRow {
  providerObjectId: string;
  kind: PaymentKind;
  amountMinor: number;
  currency: string;
  detail?: string;
}

export interface EventPlan {
  status?: OrderStatus;
  addPaidMinor?: number;
  countsInstalment?: boolean;
  taxMinor?: number;
  payment?: PaymentRow;
  /** Apply what the order granted, or take it back. */
  entitlement?: "grant" | "revoke";
  notifyAdmins?: { kind: "payment_failed" | "order_unmatched"; detail: string };
  /** Set when nothing is to be done, and why. */
  ignored?: string;
}

const nothing = (reason: string): EventPlan => ({ ignored: reason });

const currencyOf = (signal: PaymentSignal) => signal.currency ?? "usd";

function settle(signal: PaymentSignal, order: OrderState): EventPlan {
  const amount = signal.amountMinor ?? 0;
  const onPlan = order.plan === "instalments";

  return {
    status: onPlan ? "instalments_active" : "paid",
    addPaidMinor: amount,
    countsInstalment: onPlan,
    taxMinor: signal.taxMinor,
    payment: {
      providerObjectId: signal.objectId,
      kind: "payment",
      amountMinor: amount,
      currency: currencyOf(signal),
      detail: onPlan ? "First instalment" : "Paid in full",
    },
    // An instalment plan grants on the first settled payment. That is a
    // deliberate credit decision for tutoring, whose delivery is scheduled
    // lessons that can be stopped — and precisely why the question bank, handed
    // over the moment access is granted, has no instalment option.
    entitlement: grantsSomething(order) ? "grant" : undefined,
  };
}

export function planFor(signal: PaymentSignal, order: OrderState): EventPlan {
  switch (signal.kind) {
    case "authorised":
      // The customer has committed and nothing has arrived. For a card this
      // state lasts a moment; for a direct debit, most of a week.
      return order.status === "pending"
        ? { status: "authorised" }
        : nothing("Already past authorisation.");

    case "settled":
      return settle(signal, order);

    case "settlement_failed":
      return {
        status: "cancelled",
        payment: {
          providerObjectId: signal.objectId,
          kind: "failure",
          amountMinor: signal.amountMinor ?? order.amountTotalMinor,
          currency: currencyOf(signal),
          detail: signal.detail ?? "The payment failed after it was authorised.",
        },
        notifyAdmins: {
          kind: "payment_failed",
          detail: "An authorised payment failed to settle.",
        },
      };

    case "abandoned":
      // Only ever an unfinished checkout. Anything further on has been
      // authorised or paid, and a late expiry must not undo it.
      return order.status === "pending"
        ? { status: "cancelled" }
        : nothing("Checkout expired but the order had already progressed.");

    case "instalment_settled": {
      const amount = signal.amountMinor ?? 0;
      const paid = order.amountPaidMinor + amount;
      const taken = order.instalmentsPaid + 1;
      const finished =
        order.instalmentMonths !== null
          ? taken >= order.instalmentMonths
          : paid >= order.amountTotalMinor;

      return {
        status: finished ? "completed" : "instalments_active",
        addPaidMinor: amount,
        countsInstalment: true,
        taxMinor: signal.taxMinor,
        payment: {
          providerObjectId: signal.objectId,
          kind: "payment",
          amountMinor: amount,
          currency: currencyOf(signal),
          detail:
            order.instalmentMonths !== null
              ? `Instalment ${Math.min(taken, order.instalmentMonths)} of ${order.instalmentMonths}`
              : "Payment",
        },
      };
    }

    case "instalment_failed":
      return {
        status: "past_due",
        payment: {
          providerObjectId: signal.objectId,
          kind: "failure",
          amountMinor: signal.amountMinor ?? 0,
          currency: currencyOf(signal),
          detail: signal.detail ?? "Instalment payment failed.",
        },
        notifyAdmins: {
          kind: "payment_failed",
          detail:
            `Instalment ${order.instalmentsPaid + 1} of ` +
            `${order.instalmentMonths ?? "?"} failed. The provider will retry.`,
        },
        // No entitlement change. Retries run for weeks.
      };

    case "plan_ended": {
      const paidInFull =
        signal.planCompleted ?? order.amountPaidMinor >= order.amountTotalMinor;
      if (paidInFull) return { status: "completed" };
      return {
        status: "cancelled",
        entitlement: grantsSomething(order) ? "revoke" : undefined,
        notifyAdmins: {
          kind: "payment_failed",
          detail: "An instalment plan ended before it was paid off.",
        },
      };
    }

    case "refunded": {
      const refunded = signal.amountRefundedMinor ?? signal.amountMinor ?? 0;
      const full = refunded >= order.amountPaidMinor && refunded > 0;
      return {
        status: full ? "refunded" : undefined,
        payment: {
          providerObjectId: signal.objectId,
          kind: "refund",
          amountMinor: refunded,
          currency: currencyOf(signal),
          detail: full ? "Refunded in full" : "Partial refund",
        },
        entitlement: full && grantsSomething(order) ? "revoke" : undefined,
      };
    }

    case "disputed":
      return {
        payment: {
          providerObjectId: signal.objectId,
          kind: "dispute",
          amountMinor: signal.amountMinor ?? 0,
          currency: currencyOf(signal),
          detail: signal.detail ?? "Payment disputed.",
        },
        notifyAdmins: {
          kind: "payment_failed",
          detail: "A payment was disputed or charged back. Respond with the provider.",
        },
        // Not revoked: most disputes are somebody not recognising the descriptor.
      };

    default: {
      const unreachable: never = signal.kind;
      return nothing(`Unhandled signal: ${String(unreachable)}`);
    }
  }
}
