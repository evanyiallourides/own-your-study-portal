import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  looksLikeEmail,
  readGuardianAnswer,
  resolveParent,
  resolveStudent,
  splitName,
} from "@/lib/payments/enrolment";

/* ==========================================================================
   Who a payment is for
   --------------------------------------------------------------------------
   The person who pays is often not the person who learns. A parent buys twenty
   hours for their child and the card, the email and the name on the receipt are
   all the parent's. Getting this wrong puts a child's lessons on their
   mother's account and hands her the question bank licence.
   ========================================================================== */

describe("resolving the student", () => {
  it("uses the buyer when they are buying for themselves", () => {
    const student = resolveStudent({
      buyerEmail: "marcus@example.com",
      buyerName: "Marcus Adeyemi",
      studentEmail: null,
      studentName: null,
    });
    assert.equal(student?.email, "marcus@example.com");
    assert.equal(student?.firstName, "Marcus");
    assert.equal(student?.lastName, "Adeyemi");
    assert.equal(student?.boughtForSomeoneElse, false);
  });

  it("uses the student when a parent names one", () => {
    const student = resolveStudent({
      buyerEmail: "helen@example.com",
      buyerName: "Helen Thompson",
      studentEmail: "sophia@example.com",
      studentName: "Sophia Thompson",
    });
    assert.equal(student?.email, "sophia@example.com");
    assert.equal(student?.firstName, "Sophia");
    assert.equal(student?.boughtForSomeoneElse, true);
  });

  it("keeps the buyer's name when only an email is given", () => {
    // Somebody typing an address and not a name still gets an account that is
    // not called "undefined".
    const student = resolveStudent({
      buyerEmail: "helen@example.com",
      buyerName: "Helen Thompson",
      studentEmail: "sophia@example.com",
      studentName: null,
    });
    assert.equal(student?.email, "sophia@example.com");
    assert.equal(student?.firstName, "Helen");
  });

  it("ignores a student email that does not parse", () => {
    // An invitation sent to a typo goes to a stranger and never comes back, so
    // an unusable address falls back to the payer rather than being trusted.
    for (const junk of ["sophia@", "not an email", "@example.com", "sophia example.com", ""]) {
      const student = resolveStudent({
        buyerEmail: "helen@example.com",
        buyerName: "Helen Thompson",
        studentEmail: junk,
        studentName: "Sophia",
      });
      assert.equal(student?.email, "helen@example.com", `"${junk}" should not have been used`);
      assert.equal(student?.boughtForSomeoneElse, false);
    }
  });

  it("does not count the same address typed twice as somebody else", () => {
    // A parent who fills the field in with their own address, or types it in a
    // different case, has not bought for a third party.
    const student = resolveStudent({
      buyerEmail: "Helen@Example.com",
      buyerName: "Helen Thompson",
      studentEmail: "helen@example.com",
      studentName: null,
    });
    assert.equal(student?.boughtForSomeoneElse, false);
    assert.equal(student?.email, "helen@example.com", "and the address is normalised");
  });

  it("gives up rather than guessing when there is no usable address at all", () => {
    assert.equal(
      resolveStudent({ buyerEmail: "", buyerName: null, studentEmail: null, studentName: null }),
      null,
    );
  });
});

describe("names", () => {
  it("splits a full name", () => {
    assert.deepEqual(splitName("Sophia Thompson"), { firstName: "Sophia", lastName: "Thompson" });
  });

  it("treats a single word as a first name", () => {
    assert.deepEqual(splitName("Sophia"), { firstName: "Sophia", lastName: "" });
  });

  it("keeps a double-barrelled surname together", () => {
    assert.deepEqual(splitName("Ada Okafor Mensah"), {
      firstName: "Ada",
      lastName: "Okafor Mensah",
    });
  });

  it("copes with nothing", () => {
    assert.deepEqual(splitName(null), { firstName: "", lastName: "" });
    assert.deepEqual(splitName("   "), { firstName: "", lastName: "" });
  });
});

describe("email sanity", () => {
  it("accepts ordinary addresses", () => {
    for (const ok of ["a@b.co", "first.last+tag@sub.example.com", "STUDENT@EXAMPLE.ORG"]) {
      assert.equal(looksLikeEmail(ok), true, ok);
    }
  });

  it("rejects what a person mistypes", () => {
    for (const bad of ["", null, undefined, "a@b", "a b@c.com", "@b.com", "a@.com", "a@b."]) {
      assert.equal(looksLikeEmail(bad as string), false, String(bad));
    }
  });
});

/* ==========================================================================
   Who gets a parent account
   --------------------------------------------------------------------------
   A yes here creates an account that can read a student's lessons, homework
   and progress for as long as nobody removes it. So the question is not "did
   somebody else pay" — it is "did the payer say they were the parent" — and
   every case that is not an unambiguous yes has to come back null.
   ========================================================================== */

const sophia = resolveStudent({
  buyerEmail: "helen@example.com",
  buyerName: "Helen Thompson",
  studentEmail: "sophia@example.com",
  studentName: "Sophia Thompson",
});

describe("resolving the parent", () => {
  it("gives the buyer an account when they say they are the parent", () => {
    const parent = resolveParent({
      buyerEmail: "helen@example.com",
      buyerName: "Helen Thompson",
      isGuardian: true,
      student: sophia,
    });
    assert.equal(parent?.email, "helen@example.com");
    assert.equal(parent?.firstName, "Helen");
    assert.equal(parent?.lastName, "Thompson");
    assert.equal(parent?.studentEmail, "sophia@example.com");
  });

  it("gives nobody an account when the buyer says they are not", () => {
    // Paying for an adult friend's tuition buys lessons, not a view of them.
    assert.equal(
      resolveParent({
        buyerEmail: "helen@example.com",
        buyerName: "Helen Thompson",
        isGuardian: false,
        student: sophia,
      }),
      null,
    );
  });

  it("gives nobody an account when the buyer is the student", () => {
    const self = resolveStudent({
      buyerEmail: "marcus@example.com",
      buyerName: "Marcus Adeyemi",
      studentEmail: null,
      studentName: null,
    });
    // Ticking the box while buying for yourself must not make you your own
    // parent — the link would be a self-reference with a real access grant.
    assert.equal(
      resolveParent({
        buyerEmail: "marcus@example.com",
        buyerName: "Marcus Adeyemi",
        isGuardian: true,
        student: self,
      }),
      null,
    );
  });

  it("gives nobody an account when the two addresses are the same", () => {
    const same = resolveStudent({
      buyerEmail: "helen@example.com",
      buyerName: "Helen Thompson",
      studentEmail: "HELEN@example.com",
      studentName: "Helen Thompson",
    });
    assert.equal(
      resolveParent({
        buyerEmail: "helen@example.com",
        buyerName: "Helen Thompson",
        isGuardian: true,
        student: same,
      }),
      null,
    );
  });

  it("gives nobody an account when there is no student to be a parent of", () => {
    assert.equal(
      resolveParent({
        buyerEmail: "helen@example.com",
        buyerName: "Helen Thompson",
        isGuardian: true,
        student: null,
      }),
      null,
    );
  });

  it("lower-cases the addresses it records", () => {
    const parent = resolveParent({
      buyerEmail: "  Helen@Example.com ",
      buyerName: "Helen Thompson",
      isGuardian: true,
      student: sophia,
    });
    assert.equal(parent?.email, "helen@example.com");
  });
});

describe("reading the guardian answer", () => {
  it("accepts an explicit yes, however it is cased", () => {
    for (const value of ["yes", "Yes", " YES "]) {
      assert.equal(readGuardianAnswer(value), true, `${value} should read as yes`);
    }
  });

  it("treats everything else as a no", () => {
    // An unanswered optional field arrives as undefined. Defaulting that to
    // yes would hand out a child's records to anyone who skipped the question.
    for (const value of ["no", "", "   ", null, undefined, "true", "1"]) {
      assert.equal(readGuardianAnswer(value), false, `${String(value)} should read as no`);
    }
  });
});
