import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planFor,
  type OrderState,
  type PaymentSignal,
  type SignalKind,
} from "@/lib/payments/events";

/* ==========================================================================
   Stripe events → what happens to an order
   --------------------------------------------------------------------------
   These are the rules that decide whether somebody has paid, and therefore
   whether 2,868 questions are handed over. The negative cases matter most: the
   ways this goes wrong are granting access to somebody who has not paid, and
   taking it away from somebody who has.

   Three in particular are here because they are the ones a reasonable person
   writes backwards:

     · a completed-but-unpaid session (Klarna, Zip, bank debit) grants nothing;
     · a failed instalment does not revoke;
     · a dispute does not revoke.
   ========================================================================== */

const instalmentOrder = (over: Partial<OrderState> = {}): OrderState => ({
  id: "ord_1",
  plan: "instalments",
  status: "pending",
  instalmentMonths: 4,
  instalmentsPaid: 0,
  amountTotalMinor: 132000,
  amountPaidMinor: 0,
  grantsQuestionBankDays: null,
  ...over,
});

const bankOrder = (over: Partial<OrderState> = {}): OrderState => ({
  id: "ord_qb",
  plan: "full",
  status: "pending",
  instalmentMonths: null,
  instalmentsPaid: 0,
  amountTotalMinor: 12000,
  amountPaidMinor: 0,
  grantsQuestionBankDays: 365,
  ...over,
});

const signal = (over: Partial<PaymentSignal> & { kind: SignalKind }): PaymentSignal => ({
  objectId: "cs_test_1",
  currency: "usd",
  ...over,
});

/** Every signal a provider can send. Used to prove none is left unhandled. */
const ALL_SIGNALS: SignalKind[] = [
  "authorised",
  "settled",
  "settlement_failed",
  "instalment_settled",
  "instalment_failed",
  "plan_ended",
  "refunded",
  "disputed",
  "abandoned",
];

describe("authorisation and settlement", () => {
  it("grants nothing when the money has not actually moved", () => {
    // Klarna and Zip complete a session and settle afterwards; a Bacs or BECS
    // debit is authorised now and confirmed days from now, and can still fail.
    // This is the case that would otherwise hand over the question banks to
    // anyone who started a checkout, or signed a mandate and cancelled it.
    const plan = planFor(signal({ kind: "authorised", amountMinor: 12000 }), bankOrder());
    assert.equal(plan.status, "authorised", "the commitment is worth recording");
    assert.equal(plan.entitlement, undefined, "but it entitles them to nothing");
    assert.equal(plan.addPaidMinor, undefined, "and no money has been received");
    assert.equal(plan.payment, undefined);
  });

  it("marks an outright purchase paid and grants what it granted", () => {
    const plan = planFor(
      signal({ kind: "settled", amountMinor: 12000, taxMinor: 0 }),
      bankOrder(),
    );
    assert.equal(plan.status, "paid");
    assert.equal(plan.addPaidMinor, 12000);
    assert.equal(plan.entitlement, "grant");
    assert.equal(plan.payment?.kind, "payment");
  });

  it("grants nothing on a SKU that grants nothing", () => {
    // Tutoring hours reach the question banks through the pooled-hours rule in
    // SQL, not through an entitlement written here.
    const plan = planFor(
      signal({ kind: "settled", amountMinor: 132000 }),
      instalmentOrder({ plan: "full", instalmentMonths: null }),
    );
    assert.equal(plan.entitlement, undefined);
    assert.equal(plan.status, "paid");
  });

  it("opens an instalment plan rather than calling it paid", () => {
    const plan = planFor(
      signal({ kind: "settled", amountMinor: 33000 }),
      instalmentOrder(),
    );
    assert.equal(plan.status, "instalments_active");
    assert.equal(plan.countsInstalment, true);
    assert.equal(plan.addPaidMinor, 33000);
  });
});

describe("deferred settlement", () => {
  it("is the settlement that actually grants access", () => {
    const plan = planFor(
      signal({ kind: "settled", amountMinor: 12000 }),
      bankOrder(),
    );
    assert.equal(plan.status, "paid");
    assert.equal(plan.entitlement, "grant");
  });

  it("cancels the order and tells someone when it fails", () => {
    const plan = planFor(
      signal({ kind: "settlement_failed", amountMinor: 12000 }),
      bankOrder(),
    );
    assert.equal(plan.status, "cancelled");
    assert.equal(plan.payment?.kind, "failure");
    assert.equal(plan.notifyAdmins?.kind, "payment_failed");
    assert.equal(plan.entitlement, undefined);
  });
});

describe("abandoned checkout", () => {
  it("cleans up an abandoned checkout", () => {
    const plan = planFor(signal({ kind: "abandoned" }), bankOrder());
    assert.equal(plan.status, "cancelled");
  });

  it("never undoes an order that has already been paid", () => {
    // A late or out-of-order delivery must not cancel a paid order.
    const plan = planFor(
      signal({ kind: "abandoned" }),
      bankOrder({ status: "paid", amountPaidMinor: 12000 }),
    );
    assert.equal(plan.status, undefined);
    assert.match(plan.ignored ?? "", /already progressed/i);
  });
});

describe("instalments", () => {
  it("counts each invoice and keeps the plan open until the last", () => {
    const plan = planFor(
      signal({ kind: "instalment_settled", objectId: "in_2", amountMinor: 33000 }),
      instalmentOrder({ status: "instalments_active", instalmentsPaid: 1, amountPaidMinor: 33000 }),
    );
    assert.equal(plan.status, "instalments_active");
    assert.equal(plan.countsInstalment, true);
    assert.equal(plan.payment?.detail, "Instalment 2 of 4");
  });

  it("completes the order on the final instalment", () => {
    const plan = planFor(
      signal({ kind: "instalment_settled", objectId: "in_4", amountMinor: 33000 }),
      instalmentOrder({ status: "instalments_active", instalmentsPaid: 3, amountPaidMinor: 99000 }),
    );
    assert.equal(plan.status, "completed");
    assert.equal(plan.payment?.detail, "Instalment 4 of 4");
  });

  it("does not revoke access when an instalment fails", () => {
    // Stripe retries for about three weeks. Revoking on the first failure
    // punishes a card that expired.
    const plan = planFor(
      signal({ kind: "instalment_failed", objectId: "in_3", amountMinor: 33000 }),
      instalmentOrder({
        status: "instalments_active",
        instalmentsPaid: 2,
        amountPaidMinor: 66000,
        grantsQuestionBankDays: 365,
      }),
    );
    assert.equal(plan.status, "past_due");
    assert.equal(plan.entitlement, undefined);
    assert.equal(plan.notifyAdmins?.kind, "payment_failed");
    assert.match(plan.notifyAdmins?.detail ?? "", /Instalment 3 of 4/);
  });

  it("completes a plan whose subscription ends having billed everything", () => {
    const plan = planFor(
      signal({ kind: "plan_ended", planCompleted: true }),
      instalmentOrder({ status: "instalments_active", instalmentsPaid: 4, amountPaidMinor: 132000 }),
    );
    assert.equal(plan.status, "completed");
    assert.equal(plan.entitlement, undefined);
  });

  it("revokes only when the plan ends short", () => {
    const plan = planFor(
      signal({ kind: "plan_ended", planCompleted: false }),
      instalmentOrder({
        status: "past_due",
        instalmentsPaid: 2,
        amountPaidMinor: 66000,
        grantsQuestionBankDays: 365,
      }),
    );
    assert.equal(plan.status, "cancelled");
    assert.equal(plan.entitlement, "revoke");
  });
});

describe("refunds and disputes", () => {
  it("revokes on a full refund", () => {
    const plan = planFor(
      signal({ kind: "refunded", objectId: "ch_1", amountRefundedMinor: 12000 }),
      bankOrder({ status: "paid", amountPaidMinor: 12000 }),
    );
    assert.equal(plan.status, "refunded");
    assert.equal(plan.entitlement, "revoke");
  });

  it("leaves access alone on a partial refund", () => {
    const plan = planFor(
      signal({ kind: "refunded", objectId: "ch_1", amountRefundedMinor: 4000 }),
      bankOrder({ status: "paid", amountPaidMinor: 12000 }),
    );
    assert.equal(plan.status, undefined);
    assert.equal(plan.entitlement, undefined);
    assert.equal(plan.payment?.detail, "Partial refund");
  });

  it("flags a dispute without revoking", () => {
    // Most disputes are somebody not recognising the statement descriptor.
    const plan = planFor(
      signal({ kind: "disputed", objectId: "dp_1", amountMinor: 12000 }),
      bankOrder({ status: "paid", amountPaidMinor: 12000 }),
    );
    assert.equal(plan.entitlement, undefined);
    assert.equal(plan.status, undefined);
    assert.equal(plan.payment?.kind, "dispute");
    assert.equal(plan.notifyAdmins?.kind, "payment_failed");
  });
});

describe("the signal vocabulary", () => {
  it("has a branch for every signal a provider can send", () => {
    // The nine signals are the contract between a provider's route and this
    // module. A kind with no branch is a payment that silently does nothing,
    // and GoCardless will be mapping onto these same nine. Event types we do
    // not subscribe to never get this far: signalFor returns null for them in
    // the route, so an unknown kind cannot be constructed here at all.
    for (const kind of ALL_SIGNALS) {
      const plan = planFor(signal({ kind }), instalmentOrder());
      assert.ok(
        !/Unhandled signal/.test(plan.ignored ?? ""),
        `${kind} has no branch in planFor`,
      );
    }
  });

  it("does nothing at all on a signal that arrives out of order", () => {
    // Providers redeliver and reorder. An authorisation arriving after the
    // money has settled must not walk the order backwards.
    const settled = bankOrder({ status: "paid", amountPaidMinor: 12000 });
    const plan = planFor(signal({ kind: "authorised", amountMinor: 12000 }), settled);
    assert.equal(plan.status, undefined);
    assert.equal(plan.entitlement, undefined);
  });
});
