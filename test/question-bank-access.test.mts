import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { DemoRepository } from "@/lib/data/demo-repository";
import { AccessDeniedError } from "@/lib/data/repository";
import { demoState, resetDemoState } from "@/lib/data/demo-store";
import type { PortalSession } from "@/lib/types";

/* ==========================================================================
   Question bank access
   --------------------------------------------------------------------------
   Two ways in — an administrator's grant, and enough pooled hours — and the
   answer has to be the same however it is asked. These exercise the demo
   repository, which restates in TypeScript the rules the migration expresses
   in SQL; the SQL itself still needs testing against a real database.

   What is being protected is the paid half of 2,868 questions, so the cases
   that matter most are the negative ones: not entitled, expired, and revoked.
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

const STUDENT = "s-sophia";

describe("question bank access", () => {
  beforeEach(() => resetDemoState());

  it("is refused to a student who has neither a subscription nor the hours", async () => {
    const repo = new DemoRepository(sessionFor("p-sophia"));
    const access = await repo.getQuestionBankAccess(STUDENT);

    assert.equal(access.granted, false);
    assert.equal(access.source, "none");
    assert.equal(access.hasSubscriptionRow, false);
    assert.ok(access.pooledHours < access.freeAtHours, "demo student is below the threshold");
  });

  it("is granted once an administrator says so", async () => {
    const admin = new DemoRepository(sessionFor("p-admin"));
    await admin.setQuestionBankAccess(STUDENT, {
      granted: true,
      expiresAt: null,
      note: "Invoice 204",
    });

    const student = new DemoRepository(sessionFor("p-sophia"));
    const access = await student.getQuestionBankAccess(STUDENT);

    assert.equal(access.granted, true);
    assert.equal(access.source, "subscription");
    assert.equal(access.note, "Invoice 204");
  });

  it("lapses when the expiry has passed, without losing the record of it", async () => {
    const admin = new DemoRepository(sessionFor("p-admin"));
    await admin.setQuestionBankAccess(STUDENT, {
      granted: true,
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      note: null,
    });

    const access = await new DemoRepository(sessionFor("p-sophia")).getQuestionBankAccess(STUDENT);

    assert.equal(access.granted, false, "an expired subscription is not access");
    assert.equal(access.source, "none");
    assert.equal(access.hasSubscriptionRow, true, "the row survives so the page can say it lapsed");
  });

  it("holds while the expiry is still ahead", async () => {
    const admin = new DemoRepository(sessionFor("p-admin"));
    await admin.setQuestionBankAccess(STUDENT, {
      granted: true,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      note: null,
    });

    const access = await new DemoRepository(sessionFor("p-sophia")).getQuestionBankAccess(STUDENT);
    assert.equal(access.granted, true);
  });

  it("is withdrawn when the administrator unticks it", async () => {
    const admin = new DemoRepository(sessionFor("p-admin"));
    await admin.setQuestionBankAccess(STUDENT, { granted: true, expiresAt: null, note: null });
    await admin.setQuestionBankAccess(STUDENT, { granted: false, expiresAt: null, note: null });

    const access = await new DemoRepository(sessionFor("p-sophia")).getQuestionBankAccess(STUDENT);
    assert.equal(access.granted, false);
  });

  it("comes free with enough pooled hours, with nobody granting anything", async () => {
    // One more hour on the books than the threshold asks for.
    const student = demoState.students.find((s) => s.id === STUDENT);
    assert.ok(student);
    demoState.lessons.push({
      ...demoState.lessons[0]!,
      id: "l-extra-hours",
      studentId: STUDENT,
      status: "scheduled",
      durationMinutes: demoState.settings.questionBankFreeHours * 60,
    });

    const access = await new DemoRepository(sessionFor("p-sophia")).getQuestionBankAccess(STUDENT);

    assert.equal(access.granted, true);
    assert.equal(access.source, "pooled-hours");
    assert.equal(access.hasSubscriptionRow, false, "nothing was granted by hand");
  });

  it("does not count cancelled lessons towards the hours", async () => {
    demoState.lessons.push({
      ...demoState.lessons[0]!,
      id: "l-cancelled-hours",
      studentId: STUDENT,
      status: "cancelled",
      durationMinutes: 100 * 60,
    });

    const access = await new DemoRepository(sessionFor("p-sophia")).getQuestionBankAccess(STUDENT);
    assert.equal(access.granted, false, "a cancelled lesson is not a booked hour");
  });

  it("cannot be granted by anyone but an administrator", async () => {
    const tutor = new DemoRepository(sessionFor("p-imogen"));
    await assert.rejects(
      () => tutor.setQuestionBankAccess(STUDENT, { granted: true, expiresAt: null, note: null }),
      AccessDeniedError,
    );

    const student = new DemoRepository(sessionFor("p-sophia"));
    await assert.rejects(
      () => student.setQuestionBankAccess(STUDENT, { granted: true, expiresAt: null, note: null }),
      AccessDeniedError,
    );
  });

  it("tells one student nothing about another's entitlement", async () => {
    const admin = new DemoRepository(sessionFor("p-admin"));
    await admin.setQuestionBankAccess("s-marcus", {
      granted: true,
      expiresAt: null,
      note: "Marcus paid",
    });

    const sophia = new DemoRepository(sessionFor("p-sophia"));
    const other = await sophia.getQuestionBankAccess("s-marcus");

    assert.equal(other.granted, false);
    assert.equal(other.note, null, "another student's note is not readable");
    assert.equal(other.pooledHours, 0);
  });
});

/* ==========================================================================
   Demo mode must not serve the paid material
   --------------------------------------------------------------------------
   A portal deployed without its Supabase secrets falls back to demo mode,
   whose login page hands out any role to anyone who asks. Tutors pass the paid
   gate, so without this the first deploy would have published every question
   and every paper to whoever clicked "Tutor" on a public demo page.
   ========================================================================== */
describe("paid content in demo mode", () => {
  it("is refused unless it has been opened deliberately", async () => {
    const before = process.env.PORTAL_DEMO_PAID_CONTENT;
    const { isDemoMode, paidContentAvailable } = await import("@/lib/env");
    assert.equal(isDemoMode(), true, "the tests run against the demo dataset");

    delete process.env.PORTAL_DEMO_PAID_CONTENT;
    assert.equal(paidContentAvailable(), false,
      "demo mode must not serve the paid material by default");

    process.env.PORTAL_DEMO_PAID_CONTENT = "true";
    assert.equal(paidContentAvailable(), true,
      "but it can be opened on purpose for a local demonstration");

    if (before === undefined) delete process.env.PORTAL_DEMO_PAID_CONTENT;
    else process.env.PORTAL_DEMO_PAID_CONTENT = before;
  });
});
