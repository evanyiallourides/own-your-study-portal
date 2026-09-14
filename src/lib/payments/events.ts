/* ==========================================================================
   What a Stripe event means for an order
   --------------------------------------------------------------------------
   Kept apart from the route, and free of every Next and Stripe import, for the
   same reason `recall/webhook.ts` is kept apart from its route: the decisions
   are the part worth testing, and they are hard to test through an HTTP handler
   holding a database connection.

   The route normalises a Stripe event into `PaymentEvent` and executes the
   `EventPlan` this returns. Nothing here reads or writes anything.

   Three rules are easy to get wrong and are therefore stated once, here:

     1. An unpaid `checkout.session.completed` grants nothing. Buy-now-pay-later
        settles asynchronously, so the session completes before the money moves.
        The grant belongs to `async_payment_succeeded`, and forgetting that is
        the single most likely bug in this integration — it would hand the
        question banks to anyone who started a Klarna checkout and abandoned it.

     2. A failed instalment does not revoke access. Stripe retries for about
        three weeks; revoking on the first failure punishes an expired card.
        Access goes only when the subscription is finally cancelled short.

     3. A dispute is flagged, never auto-revoked. Most are a parent not
        recognising the statement descriptor.
   ========================================================================== */

export const ORDER_STATUSES = [
  "pending",
  "paid",
  "instalments_active",
  "past_due",
  "completed",
  "refunded",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type PaymentKind = "payment" | "refund" | "failure" | "dispute";

/** A Stripe event reduced to the fields any decision here depends on. */
export interface PaymentEvent {
  type: string;
  /** The session / invoice / charge the event is about. */
  objectId: string;
  /** Checkout sessions only. */
  paymentStatus?: "paid" | "unpaid" | "no_payment_required";
  mode?: "payment" | "subscription";
  amountMinor?: number;
  currency?: string;
  taxMinor?: number;
  /** How much of a charge has been refunded, for `charge.refunded`. */
  amountRefundedMinor?: number;
  /** Whether the subscription ended having billed everything it owed. */
  subscriptionEndedComplete?: boolean;
  detail?: string;
}

/** The order as it stands before this event is applied. */
export interface OrderState {
  id: string;
  plan: "full" | "instalments";
  status: OrderStatus;
  instalmentMonths: number | null;
  instalmentsPaid: number;
  amountTotalMinor: number;
  amountPaidMinor: number;
  grantsQuestionBankDays: number | null;
}

export interface PaymentRow {
  stripeObjectId: string;
  kind: PaymentKind;
  amountMinor: number;
  currency: string;
  detail?: string;
}

export interface EventPlan {
  /** New order status, or undefined to leave it alone. */
  status?: OrderStatus;
  /** Added to amount_paid_minor. */
  addPaidMinor?: number;
  /** Whether this event counts as one instalment being taken. */
  countsInstalment?: boolean;
  /** Tax actually charged, when the event reports it. */
  taxMinor?: number;
  payment?: PaymentRow;
  /** Apply what the order granted, or take it back. */
  entitlement?: "grant" | "revoke";
  notifyAdmins?: { kind: "payment_failed" | "order_unmatched"; detail: string };
  /** Set when nothing is to be done, and why. */
  ignored?: string;
}

const nothing = (reason: string): EventPlan => ({ ignored: reason });

/**
 * Whether a session that has just completed means money has actually arrived.
 * `no_payment_required` is a zero-value session, which the catalogue has none
 * of today but which would be a free grant if it ever did.
 */
function sessionIsPaid(event: PaymentEvent): boolean {
  return event.paymentStatus === "paid" || event.paymentStatus === "no_payment_required";
}

function settle(event: PaymentEvent, order: OrderState): EventPlan {
  const amount = event.amountMinor ?? 0;
  const subscription = event.mode === "subscription" || order.plan === "instalments";

  return {
    status: subscription ? "instalments_active" : "paid",
    addPaidMinor: amount,
    countsInstalment: subscription,
    taxMinor: event.taxMinor,
    payment: {
      stripeObjectId: event.objectId,
      kind: "payment",
      amountMinor: amount,
      currency: event.currency ?? "usd",
      detail: subscription ? "First instalment" : "Paid in full",
    },
    // Instalment plans grant on the first payment. That is a deliberate credit
    // decision for the tutoring packages, whose delivery is scheduled lessons
    // that can be stopped — and precisely why the question bank, which is
    // handed over the moment access is granted, has no instalment option.
    entitlement: order.grantsQuestionBankDays !== null ? "grant" : undefined,
  };
}

export function planFor(event: PaymentEvent, order: OrderState): EventPlan {
  switch (event.type) {
    case "checkout.session.completed":
      if (!sessionIsPaid(event)) {
        // Buy-now-pay-later, or a delayed bank debit. Nothing has moved yet.
        return nothing("Session completed but not yet paid; awaiting settlement.");
      }
      return settle(event, order);

    case "checkout.session.async_payment_succeeded":
      return settle(event, order);

    case "checkout.session.async_payment_failed":
      return {
        status: "cancelled",
        payment: {
          stripeObjectId: event.objectId,
          kind: "failure",
          amountMinor: event.amountMinor ?? order.amountTotalMinor,
          currency: event.currency ?? "usd",
          detail: event.detail ?? "Deferred payment failed.",
        },
        notifyAdmins: { kind: "payment_failed", detail: "A buy-now-pay-later payment failed." },
      };

    case "checkout.session.expired":
      // Only ever an abandoned checkout. Anything further on has already been
      // paid, and a late expiry event must not undo it.
      return order.status === "pending"
        ? { status: "cancelled", ignored: undefined }
        : nothing("Session expired but the order had already progressed.");

    case "invoice.paid": {
      const amount = event.amountMinor ?? 0;
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
        taxMinor: event.taxMinor,
        payment: {
          stripeObjectId: event.objectId,
          kind: "payment",
          amountMinor: amount,
          currency: event.currency ?? "usd",
          detail:
            order.instalmentMonths !== null
              ? `Instalment ${Math.min(taken, order.instalmentMonths)} of ${order.instalmentMonths}`
              : "Payment",
        },
      };
    }

    case "invoice.payment_failed":
      return {
        status: "past_due",
        payment: {
          stripeObjectId: event.objectId,
          kind: "failure",
          amountMinor: event.amountMinor ?? 0,
          currency: event.currency ?? "usd",
          detail: event.detail ?? "Instalment payment failed.",
        },
        notifyAdmins: {
          kind: "payment_failed",
          detail:
            `Instalment ${order.instalmentsPaid + 1} of ` +
            `${order.instalmentMonths ?? "?"} failed. Stripe will retry.`,
        },
        // No entitlement change. Stripe retries for weeks.
      };

    case "customer.subscription.deleted": {
      const paidInFull =
        event.subscriptionEndedComplete ?? order.amountPaidMinor >= order.amountTotalMinor;
      if (paidInFull) return { status: "completed" };
      return {
        status: "cancelled",
        entitlement: order.grantsQuestionBankDays !== null ? "revoke" : undefined,
        notifyAdmins: {
          kind: "payment_failed",
          detail: "An instalment plan ended before it was paid off.",
        },
      };
    }

    case "charge.refunded": {
      const refunded = event.amountRefundedMinor ?? event.amountMinor ?? 0;
      const full = refunded >= order.amountPaidMinor && refunded > 0;
      return {
        status: full ? "refunded" : undefined,
        payment: {
          stripeObjectId: event.objectId,
          kind: "refund",
          amountMinor: refunded,
          currency: event.currency ?? "usd",
          detail: full ? "Refunded in full" : "Partial refund",
        },
        entitlement: full && order.grantsQuestionBankDays !== null ? "revoke" : undefined,
      };
    }

    case "charge.dispute.created":
      return {
        payment: {
          stripeObjectId: event.objectId,
          kind: "dispute",
          amountMinor: event.amountMinor ?? 0,
          currency: event.currency ?? "usd",
          detail: event.detail ?? "Payment disputed.",
        },
        notifyAdmins: {
          kind: "payment_failed",
          detail: "A payment was disputed. Respond in the Stripe dashboard.",
        },
        // Not revoked: most disputes are a parent not recognising the descriptor.
      };

    default:
      return nothing(`Unhandled event type: ${event.type}`);
  }
}

/** The event types worth subscribing to. Anything else is acknowledged and dropped. */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.deleted",
  "charge.refunded",
  "charge.dispute.created",
] as const;
