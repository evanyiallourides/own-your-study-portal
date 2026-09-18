import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { DemoRepository } from "@/lib/data/demo-repository";
import { AccessDeniedError } from "@/lib/data/repository";
import { demoState, resetDemoState } from "@/lib/data/demo-store";
import {
  isInstalmentPlanRunning,
  isUnmatched,
  ORDER_STATUSES,
  type Order,
  type PortalSession,
} from "@/lib/types";

/* ==========================================================================
   Orders
   --------------------------------------------------------------------------
   Two things are being protected here.

   The first is who may look. Billing says what a family bought and what it
   cost, and a tutor has no business in it — the absence of a tutor policy in
   SQL is deliberate, and this is the TypeScript half of that rule.

   The second is the queue. The admin screen surfaces exactly one thing as
   needing a person: money taken with nobody to give it to. Anything that
   wrongly lands there is noise an administrator learns to scroll past, which
   is how the one real case gets missed.
   ========================================================================== */

function sessionFor(profileId: string): PortalSession {
  const profile = demoState.profiles.find((p) => p.id === profileId);
  assert.ok(profile, `demo profile ${profileId} should exist`);
  return {
    profile,
    studentId: demoState.students.find((s) => s.profileId === profileId)?.id ?? null,
    tutorId: demoState.tutors.find((t) => t.profileId === profileId)?.id ?? null,
    parentId: demoState.parents.find((p) => p.profileId === profileId)?.id ?? null,
    isDemo: true,
  };
}

const order = (over: Partial<Order> = {}): Order => ({
  id: "o-test",
  provider: "stripe",
  skuSlug: "question-bank",
  skuName: "Question Bank Access",
  plan: "full",
  quantity: 1,
  instalmentMonths: null,
  instalmentsPaid: 0,
  currency: "gbp",
  amountTotalMinor: 8900,
  amountPaidMinor: 8900,
  taxAmountMinor: 0,
  status: "paid",
  buyerEmail: "someone@example.com",
  buyerName: null,
  buyerCountry: null,
  sourceSite: "own-your-ib",
  studentId: null,
  studentName: null,
  claimedAt: null,
  note: null,
  paymentReference: null,
  createdAt: new Date().toISOString(),
  grantsQuestionBankDays: 365,
  ...over,
});

beforeEach(() => resetDemoState());

describe("the attention queue", () => {
  it("surfaces a paid order with nobody attached", () => {
    assert.equal(isUnmatched(order({ status: "paid" })), true);
  });

  it("leaves a refund alone", () => {
    // The money has gone back. There is no entitlement left to grant, so
    // asking an administrator to attach it to somebody is pure noise — and
    // noise in this queue is how the one real case gets scrolled past.
    assert.equal(isUnmatched(order({ status: "refunded" })), false);
  });

  it("leaves an abandoned or cancelled checkout alone", () => {
    assert.equal(isUnmatched(order({ status: "pending" })), false);
    assert.equal(isUnmatched(order({ status: "cancelled" })), false);
  });

  it("never asks about an order that already has a student", () => {
    for (const status of ORDER_STATUSES) {
      assert.equal(
        isUnmatched(order({ status, studentId: "s-sophia" })),
        false,
        `${status} with a student should not be in the queue`,
      );
    }
  });

  it("counts a failing plan as still running, so it is not filed as finished", () => {
    assert.equal(isInstalmentPlanRunning(order({ status: "past_due" })), true);
    assert.equal(isInstalmentPlanRunning(order({ status: "instalments_active" })), true);
    assert.equal(isInstalmentPlanRunning(order({ status: "completed" })), false);
  });
});

describe("who may read an order", () => {
  it("shows an administrator everything", async () => {
    const repo = new DemoRepository(sessionFor("p-admin"));
    assert.equal((await repo.listOrders()).length, demoState.orders.length);
  });

  it("shows a tutor nothing at all", async () => {
    // Not a filtered view — none. A tutor teaching a student still has no
    // business knowing what that family paid.
    const repo = new DemoRepository(sessionFor("p-imogen"));
    assert.deepEqual(await repo.listOrders(), []);
  });

  it("shows a student only their own", async () => {
    const repo = new DemoRepository(sessionFor("p-sophia"));
    const rows = await repo.listOrders();
    assert.ok(rows.length > 0, "the demo student should have bought something");
    for (const o of rows) assert.equal(o.studentId, "s-sophia");
  });

  it("shows a parent their child's", async () => {
    const repo = new DemoRepository(sessionFor("p-helen"));
    const rows = await repo.listOrders();
    for (const o of rows) assert.equal(o.studentId, "s-sophia");
  });

  /* The parent billing screen reads per-student rather than through
     listOrders, and then reads each order's ledger. Both are separate methods
     with their own access check, so both are exercised here rather than
     assumed from the list above. */
  it("shows a parent their own child's, read by student id", async () => {
    const repo = new DemoRepository(sessionFor("p-helen"));
    const rows = await repo.listOrdersForStudent("s-sophia");
    assert.ok(rows.length > 0, "Helen's child should have bought something");
    for (const o of rows) assert.equal(o.studentId, "s-sophia");
  });

  it("shows a parent nothing for a child who is not theirs", async () => {
    const repo = new DemoRepository(sessionFor("p-helen"));
    assert.deepEqual(await repo.listOrdersForStudent("s-marcus"), []);
  });

  it("lets a parent read the ledger behind their own child's order", async () => {
    const repo = new DemoRepository(sessionFor("p-helen"));
    const payments = await repo.getOrderPayments("o-committed-sophia");
    assert.ok(payments.length > 0, "a paid order should have something in its ledger");
  });

  it("does not let a parent read the ledger behind another family's order", async () => {
    // An empty ledger rather than a throw: a withheld read is filtered, not
    // announced. The order itself is Marcus's, and Helen is not his parent.
    const repo = new DemoRepository(sessionFor("p-helen"));
    assert.deepEqual(await repo.getOrderPayments("o-elite-marcus"), []);
  });

  it("hides unattached payments from everyone but an administrator", async () => {
    // An unmatched order carries a stranger's email address. In SQL this falls
    // out of `student_id is null` never matching a student policy; here it has
    // to be stated.
    for (const who of ["p-sophia", "p-helen", "p-imogen"]) {
      const rows = await new DemoRepository(sessionFor(who)).listOrders();
      assert.equal(rows.filter((o) => o.studentId === null).length, 0, `${who} saw an unmatched order`);
    }
  });
});

describe("attaching a payment", () => {
  it("cannot be done by anyone but an administrator", async () => {
    const repo = new DemoRepository(sessionFor("p-imogen"));
    await assert.rejects(
      () => repo.linkOrderToStudent("o-qbank-unmatched", "s-sophia"),
      AccessDeniedError,
    );
  });

  it("grants what the order paid for", async () => {
    const repo = new DemoRepository(sessionFor("p-admin"));
    await repo.linkOrderToStudent("o-qbank-unmatched", "s-sophia");

    const access = await new DemoRepository(sessionFor("p-admin")).getQuestionBankAccess("s-sophia");
    assert.equal(access.granted, true);
    assert.equal(access.source, "subscription");
  });

  it("extends an existing entitlement rather than replacing it", async () => {
    // The same rule claim_orders_for_profile() applies in SQL. Restating it
    // wrongly here would show an administrator a date the database disagrees
    // with.
    const inSixMonths = new Date();
    inSixMonths.setDate(inSixMonths.getDate() + 180);
    demoState.questionBankAccess["s-sophia"] = {
      granted: true,
      expiresAt: inSixMonths.toISOString(),
      note: "Existing",
      grantedAt: new Date().toISOString(),
    };

    const repo = new DemoRepository(sessionFor("p-admin"));
    await repo.linkOrderToStudent("o-qbank-unmatched", "s-sophia");

    const expires = demoState.questionBankAccess["s-sophia"].expiresAt;
    assert.ok(expires);
    const days = Math.round((Date.parse(expires) - Date.now()) / 86_400_000);
    assert.ok(days > 540 && days < 550, `expected roughly 545 days, got ${days}`);
  });

  it("does not revoke anything when a payment is detached", async () => {
    // Access may also have been earned through pooled hours. Guessing which of
    // the two applied would take away something that was never paid for here.
    const repo = new DemoRepository(sessionFor("p-admin"));
    await repo.linkOrderToStudent("o-qbank-unmatched", "s-sophia");
    await repo.unlinkOrder("o-qbank-unmatched");

    const access = await repo.getQuestionBankAccess("s-sophia");
    assert.equal(access.granted, true, "detaching should not revoke");
  });
});
