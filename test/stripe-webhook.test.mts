import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HANDLED_EVENTS,
  planFor,
  type OrderState,
  type PaymentEvent,
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

const event = (over: Partial<PaymentEvent> & { type: string }): PaymentEvent => ({
  objectId: "cs_test_1",
  currency: "usd",
  ...over,
});

describe("checkout.session.completed", () => {
  it("grants nothing when the money has not actually moved", () => {
    // Klarna, Zip and Afterpay complete the session and settle afterwards. This
    // is the case that would otherwise hand the question banks to anyone who
    // opened a BNPL checkout and walked away.
    const plan = planFor(
      event({ type: "checkout.session.completed", paymentStatus: "unpaid", amountMinor: 12000 }),
      bankOrder(),
    );
    assert.equal(plan.entitlement, undefined);
    assert.equal(plan.status, undefined);
    assert.equal(plan.addPaidMinor, undefined);
    assert.match(plan.ignored ?? "", /not yet paid/i);
  });

  it("marks an outright purchase paid and grants what it granted", () => {
    const plan = planFor(
      event({
        type: "checkout.session.completed",
        paymentStatus: "paid",
        mode: "payment",
        amountMinor: 12000,
        taxMinor: 0,
      }),
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
      event({
        type: "checkout.session.completed",
        paymentStatus: "paid",
        mode: "payment",
        amountMinor: 132000,
      }),
      instalmentOrder({ plan: "full", instalmentMonths: null }),
    );
    assert.equal(plan.entitlement, undefined);
    assert.equal(plan.status, "paid");
  });

  it("opens an instalment plan rather than calling it paid", () => {
    const plan = planFor(
      event({
        type: "checkout.session.completed",
        paymentStatus: "paid",
        mode: "subscription",
        amountMinor: 33000,
      }),
      instalmentOrder(),
    );
    assert.equal(plan.status, "instalments_active");
    assert.equal(plan.countsInstalment, true);
    assert.equal(plan.addPaidMinor, 33000);
  });
});

describe("deferred payments", () => {
  it("is the settlement that actually grants access", () => {
    const plan = planFor(
      event({
        type: "checkout.session.async_payment_succeeded",
        mode: "payment",
        amountMinor: 12000,
      }),
      bankOrder(),
    );
    assert.equal(plan.status, "paid");
    assert.equal(plan.entitlement, "grant");
  });

  it("cancels the order and tells someone when it fails", () => {
    const plan = planFor(
      event({ type: "checkout.session.async_payment_failed", amountMinor: 12000 }),
      bankOrder(),
    );
    assert.equal(plan.status, "cancelled");
    assert.equal(plan.payment?.kind, "failure");
    assert.equal(plan.notifyAdmins?.kind, "payment_failed");
    assert.equal(plan.entitlement, undefined);
  });
});

describe("checkout.session.expired", () => {
  it("cleans up an abandoned checkout", () => {
    const plan = planFor(event({ type: "checkout.session.expired" }), bankOrder());
    assert.equal(plan.status, "cancelled");
  });

  it("never undoes an order that has already been paid", () => {
    // A late or out-of-order delivery must not cancel a paid order.
    const plan = planFor(
      event({ type: "checkout.session.expired" }),
      bankOrder({ status: "paid", amountPaidMinor: 12000 }),
    );
    assert.equal(plan.status, undefined);
    assert.match(plan.ignored ?? "", /already progressed/i);
  });
});

describe("instalments", () => {
  it("counts each invoice and keeps the plan open until the last", () => {
    const plan = planFor(
      event({ type: "invoice.paid", objectId: "in_2", amountMinor: 33000 }),
      instalmentOrder({ status: "instalments_active", instalmentsPaid: 1, amountPaidMinor: 33000 }),
    );
    assert.equal(plan.status, "instalments_active");
    assert.equal(plan.countsInstalment, true);
    assert.equal(plan.payment?.detail, "Instalment 2 of 4");
  });

  it("completes the order on the final instalment", () => {
    const plan = planFor(
      event({ type: "invoice.paid", objectId: "in_4", amountMinor: 33000 }),
      instalmentOrder({ status: "instalments_active", instalmentsPaid: 3, amountPaidMinor: 99000 }),
    );
    assert.equal(plan.status, "completed");
    assert.equal(plan.payment?.detail, "Instalment 4 of 4");
  });

  it("does not revoke access when an instalment fails", () => {
    // Stripe retries for about three weeks. Revoking on the first failure
    // punishes a card that expired.
    const plan = planFor(
      event({ type: "invoice.payment_failed", objectId: "in_3", amountMinor: 33000 }),
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
      event({ type: "customer.subscription.deleted", subscriptionEndedComplete: true }),
      instalmentOrder({ status: "instalments_active", instalmentsPaid: 4, amountPaidMinor: 132000 }),
    );
    assert.equal(plan.status, "completed");
    assert.equal(plan.entitlement, undefined);
  });

  it("revokes only when the plan ends short", () => {
    const plan = planFor(
      event({ type: "customer.subscription.deleted", subscriptionEndedComplete: false }),
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
      event({ type: "charge.refunded", objectId: "ch_1", amountRefundedMinor: 12000 }),
      bankOrder({ status: "paid", amountPaidMinor: 12000 }),
    );
    assert.equal(plan.status, "refunded");
    assert.equal(plan.entitlement, "revoke");
  });

  it("leaves access alone on a partial refund", () => {
    const plan = planFor(
      event({ type: "charge.refunded", objectId: "ch_1", amountRefundedMinor: 4000 }),
      bankOrder({ status: "paid", amountPaidMinor: 12000 }),
    );
    assert.equal(plan.status, undefined);
    assert.equal(plan.entitlement, undefined);
    assert.equal(plan.payment?.detail, "Partial refund");
  });

  it("flags a dispute without revoking", () => {
    // Most disputes are somebody not recognising the statement descriptor.
    const plan = planFor(
      event({ type: "charge.dispute.created", objectId: "dp_1", amountMinor: 12000 }),
      bankOrder({ status: "paid", amountPaidMinor: 12000 }),
    );
    assert.equal(plan.entitlement, undefined);
    assert.equal(plan.status, undefined);
    assert.equal(plan.payment?.kind, "dispute");
    assert.equal(plan.notifyAdmins?.kind, "payment_failed");
  });
});

describe("anything else", () => {
  it("is acknowledged and dropped rather than throwing", () => {
    // Stripe sends far more than we subscribe to, and `stripe trigger` fixtures
    // carry no order at all. Neither may take the endpoint down.
    const plan = planFor(event({ type: "customer.created" }), bankOrder());
    assert.match(plan.ignored ?? "", /Unhandled event type/);
    assert.equal(plan.status, undefined);
    assert.equal(plan.entitlement, undefined);
  });

  it("handles every event type it asks Stripe to send", () => {
    for (const type of HANDLED_EVENTS) {
      const plan = planFor(event({ type }), instalmentOrder());
      assert.ok(
        !/Unhandled event type/.test(plan.ignored ?? ""),
        `${type} is subscribed to but has no branch`,
      );
    }
  });
});
