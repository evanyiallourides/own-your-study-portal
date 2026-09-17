import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IA_SUBJECTS,
  RUBRICS,
  criteriaSum,
  formatSession,
  levelSpecificCriteria,
  parseSession,
  routeToRubric,
  rubricById,
  selectableSessions,
  type IaSubject,
  type Session,
} from "@/lib/ia/rubrics";
import { decideMode, type ExtractionQuality } from "@/lib/ia/mode";
import {
  checksumOf,
  descriptorsFor,
  staticLoader,
  validatePack,
  type AssessmentPack,
} from "@/lib/ia/packs";
import {
  composeReview,
  totalFor,
  type CriterionResult,
  type IaAssessment,
} from "@/lib/ia/schema";
import { worstDisagreement } from "@/lib/ia/mark";
import { countWords, pdfPageCount } from "@/lib/ia/extract";

/* ==========================================================================
   IA review
   --------------------------------------------------------------------------
   The thing being tested is not "does the model give good feedback" — nothing
   here can test that, and the honest answer is that it has never been measured
   against real marked work. What is tested is everything AROUND the model, and
   specifically every path by which a number could reach a student that nobody
   could defend:

     · a session routed to the wrong course;
     · a mark produced with no official descriptors installed;
     · a mark produced from a pack that covers four criteria out of five;
     · a total that is the sum of three criteria out of four;
     · an extraction failure presented as a zero;
     · a partial draft marked down for sections not yet written;
     · a mark above the criterion's maximum.

   Each of those is a way of being confidently wrong about somebody's
   coursework, and each has a test below.
   ========================================================================== */

const MAY = (year: number): Session => ({ month: "May", year });
const NOV = (year: number): Session => ({ month: "November", year });

/** Extraction that succeeded completely. The uninteresting case. */
const CLEAN: ExtractionQuality = { readableUnits: 12, unreadable: [], complete: true };

/* --------------------------------------------------------------------------
   Structure
   -------------------------------------------------------------------------- */

describe("marking models", () => {
  it("states a total that is the sum of its criteria", () => {
    for (const rubric of Object.values(RUBRICS)) {
      assert.equal(
        criteriaSum(rubric),
        rubric.maxTotal,
        `${rubric.id} says ${rubric.maxTotal} but its criteria add to ${criteriaSum(rubric)}`,
      );
    }
  });

  it("gives every criterion a unique id within its model", () => {
    for (const rubric of Object.values(RUBRICS)) {
      const ids = rubric.criteria.map((c) => c.id);
      assert.equal(new Set(ids).size, ids.length, `${rubric.id} has a duplicate criterion id`);
    }
  });

  it("marks the sciences identically at SL and HL", () => {
    // Both science packs list this as a release check, because a model that has
    // read a lot of the internet believes HL should be held to a higher
    // standard, and for this task it should not.
    for (const subject of ["biology", "chemistry"] as const) {
      const rubric = routeToRubric(subject, MAY(2026)).rubric;
      assert.equal(levelSpecificCriteria(rubric).length, 0);
    }
  });

  it("marks Maths AA criterion E differently at SL and HL, and only E", () => {
    const rubric = routeToRubric("maths_aa", MAY(2026)).rubric;
    assert.deepEqual(
      levelSpecificCriteria(rubric).map((c) => c.id),
      ["use_of_mathematics"],
    );
  });

  it("covers every subject it offers", () => {
    for (const subject of IA_SUBJECTS) {
      const routing = routeToRubric(subject, MAY(2026));
      assert.equal(routing.rubric.subject, subject);
      assert.equal(routing.blocked, null, `${subject} cannot be marked for a 2026 session`);
    }
  });
});

/* --------------------------------------------------------------------------
   Routing — the mistake all three source packs warn about first
   -------------------------------------------------------------------------- */

describe("routing a session to a course", () => {
  it("selects the current Maths model through November 2028", () => {
    assert.equal(routeToRubric("maths_aa", NOV(2028)).rubric.id, "maths_aa_fa2021");
    assert.equal(routeToRubric("maths_aa", NOV(2028)).blocked, null);
  });

  it("refuses to mark a Maths session from 2029 onward", () => {
    // The structure of the 2029 course is confirmed; its descriptors are a
    // separate pack we do not hold. The failure to avoid is not "no answer" —
    // it is marking a 2029 exploration against the 2021 five-criterion rubric.
    const routing = routeToRubric("maths_aa", MAY(2029));
    assert.equal(routing.rubric.id, "maths_aa_fa2029");
    assert.ok(routing.blocked, "a 2029 session must be blocked");
    assert.notEqual(routing.rubric.maxTotal, 0);
    assert.deepEqual(
      routing.rubric.criteria.map((c) => c.id),
      ["problem_specification", "abstraction", "computation", "interpretation"],
    );
  });

  it("refuses a science session from before the 2025 model", () => {
    for (const subject of ["biology", "chemistry"] as const) {
      assert.ok(
        routeToRubric(subject, MAY(2024)).blocked,
        `${subject} 2024 was a different, five-criterion model`,
      );
    }
  });

  it("does not consult today's date", () => {
    /* The one rule stated in prose in every source pack: "do not select a
       rubric from the date an IA was uploaded". Called twice with the same
       session, this must give the same answer whenever it runs. */
    const first = routeToRubric("maths_aa", MAY(2029)).rubric.id;
    const second = routeToRubric("maths_aa", MAY(2029)).rubric.id;
    assert.equal(first, second);
    assert.equal(first, "maths_aa_fa2029");
  });
});

describe("sessions", () => {
  it("reads the ones IB actually runs", () => {
    assert.deepEqual(parseSession("May 2026"), { month: "May", year: 2026 });
    assert.deepEqual(parseSession("November 2027"), { month: "November", year: 2027 });
  });

  it("rejects anything else", () => {
    for (const junk of ["June 2026", "may 2026", "2026", "", "May 1999", "May 2099", null]) {
      assert.equal(parseSession(junk), null, `${String(junk)} should not parse`);
    }
  });

  it("round-trips", () => {
    const session = parseSession("November 2028");
    assert.ok(session);
    assert.equal(formatSession(session), "November 2028");
  });

  it("never offers a session that has already been sat", () => {
    const today = new Date(Date.UTC(2026, 8, 17));
    for (const session of selectableSessions(today)) {
      const sat = new Date(Date.UTC(session.year, session.month === "May" ? 5 : 11, 1));
      assert.ok(sat >= today, `${formatSession(session)} is in the past`);
    }
  });
});

/* --------------------------------------------------------------------------
   Packs
   -------------------------------------------------------------------------- */

function bands(): { marks: string; text: string }[] {
  return [
    { marks: "0", text: "The work does not reach a standard described below." },
    { marks: "1-2", text: "Limited." },
    { marks: "3-4", text: "Adequate." },
    { marks: "5-6", text: "Excellent." },
  ];
}

function sciencePack(overrides: Partial<AssessmentPack> = {}): AssessmentPack {
  return {
    rubricId: "biology_fa2025",
    version: "Biology guide, first assessment 2025",
    source: "test",
    shared: {
      research_design: { criterionId: "research_design", bands: bands() },
      data_analysis: { criterionId: "data_analysis", bands: bands() },
      conclusion: { criterionId: "conclusion", bands: bands() },
      evaluation: { criterionId: "evaluation", bands: bands() },
    },
    ...overrides,
  };
}

function mathsPack(overrides: Partial<AssessmentPack> = {}): AssessmentPack {
  return {
    rubricId: "maths_aa_fa2021",
    version: "AA guide, first assessment 2021",
    source: "test",
    shared: {
      presentation: { criterionId: "presentation", bands: bands() },
      mathematical_communication: { criterionId: "mathematical_communication", bands: bands() },
      personal_engagement: { criterionId: "personal_engagement", bands: bands() },
      reflection: { criterionId: "reflection", bands: bands() },
    },
    byLevel: {
      SL: { use_of_mathematics: { criterionId: "use_of_mathematics", bands: bands() } },
      HL: { use_of_mathematics: { criterionId: "use_of_mathematics", bands: bands() } },
    },
    ...overrides,
  };
}

describe("assessment packs", () => {
  it("accepts one that covers its model", () => {
    assert.equal(validatePack(sciencePack()).ok, true);
    assert.equal(validatePack(mathsPack()).ok, true);
  });

  it("refuses one missing a criterion", () => {
    const pack = sciencePack();
    delete pack.shared.evaluation;
    const result = validatePack(pack);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.field.includes("evaluation")));
  });

  it("refuses one with empty bands", () => {
    const pack = sciencePack();
    pack.shared.conclusion = { criterionId: "conclusion", bands: [] };
    assert.equal(validatePack(pack).ok, false);
  });

  it("refuses Maths with only one level of criterion E", () => {
    // Half of criterion E is not criterion E. Without this, an HL exploration
    // would be marked on four criteria and have the fifth improvised.
    const pack = mathsPack();
    delete pack.byLevel!.HL;
    const result = validatePack(pack);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.field === "byLevel.HL.use_of_mathematics"));
  });

  it("refuses a pack built for another syllabus", () => {
    const pack = sciencePack();
    pack.shared.personal_engagement = { criterionId: "personal_engagement", bands: bands() };
    const result = validatePack(pack);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.detail.includes("previous syllabus")));
  });

  it("refuses a pack for a model that is blocked anyway", () => {
    const pack = sciencePack({ rubricId: "maths_aa_fa2029" });
    assert.equal(validatePack(pack).ok, false);
  });

  it("gives HL its own criterion E", () => {
    const pack = mathsPack();
    pack.byLevel!.HL!.use_of_mathematics!.bands = [{ marks: "5-6", text: "HL only." }];
    const rubric = rubricById("maths_aa_fa2021")!;

    const hl = descriptorsFor(pack, rubric, "HL");
    const sl = descriptorsFor(pack, rubric, "SL");

    assert.equal(hl.find((d) => d.criterionId === "use_of_mathematics")?.bands[0]?.text, "HL only.");
    assert.notEqual(
      sl.find((d) => d.criterionId === "use_of_mathematics")?.bands[0]?.text,
      "HL only.",
    );
    // Everything else is shared, so both levels see the same four.
    assert.equal(hl.length, rubric.criteria.length);
    assert.equal(sl.length, rubric.criteria.length);
  });

  it("hashes the same pack the same way twice, and a changed one differently", async () => {
    const a = await checksumOf(sciencePack());
    const b = await checksumOf(sciencePack());
    assert.equal(a, b);

    const changed = sciencePack();
    changed.shared.conclusion!.bands[0]!.text = "Something else entirely.";
    assert.notEqual(await checksumOf(changed), a);
  });

  it("hashes by content, not by the version label", async () => {
    // Two packs labelled the same with different text are two packs, and a
    // review produced under one must not look as though it came from the other.
    const relabelled = sciencePack({ version: "A completely different label" });
    assert.equal(await checksumOf(relabelled), await checksumOf(sciencePack()));
  });

  it("loads only the model it was installed for", async () => {
    const loader = staticLoader([sciencePack()]);
    assert.ok(await loader.load("biology_fa2025"));
    assert.equal(await loader.load("chemistry_fa2025"), null);
  });
});

/* --------------------------------------------------------------------------
   The mode decision — the honesty spine
   -------------------------------------------------------------------------- */

describe("deciding whether marks are allowed", () => {
  const base = {
    subject: "biology" as IaSubject,
    level: "HL" as const,
    session: MAY(2026),
    stage: "final" as const,
    extraction: CLEAN,
  };

  it("marks when there is a valid pack and a readable document", () => {
    const decision = decideMode({ ...base, pack: sciencePack() });
    assert.equal(decision.mode, "marking");
    assert.deepEqual(decision.reasons, []);
    assert.equal(decision.mayShowTotal, true);
  });

  it("withholds marks when no pack is installed", () => {
    // The common case today, and the whole reason this subsystem is shaped the
    // way it is. It must be the DEFAULT, not a configuration.
    const decision = decideMode({ ...base, pack: null });
    assert.equal(decision.mode, "feedback_only");
    assert.equal(decision.mayShowTotal, false);
    assert.ok(decision.reasons[0]?.includes("descriptors"));
  });

  it("withholds marks when the installed pack does not validate", () => {
    const broken = sciencePack();
    delete broken.shared.evaluation;
    const decision = decideMode({ ...base, pack: broken });
    assert.equal(decision.mode, "feedback_only");
    assert.ok(decision.humanReview.some((r) => r.includes("failed validation")));
  });

  it("withholds marks for a session it cannot route", () => {
    const decision = decideMode({
      ...base,
      subject: "maths_aa",
      session: MAY(2029),
      pack: mathsPack(),
    });
    assert.equal(decision.mode, "feedback_only");
  });

  it("withholds a total from a partial draft, without calling anything missing", () => {
    const decision = decideMode({ ...base, stage: "partial_draft", pack: sciencePack() });
    assert.equal(decision.mode, "feedback_only");
    assert.ok(
      decision.reasons.some((r) => r.includes("not a section you have scored nothing for")),
      "the reason must say a partial draft is not scored zero",
    );
  });

  it("withholds a total when something could not be read", () => {
    /* Not zero. "Do not award zero for an extraction failure" appears in all
       three packs, and the difference between null and zero here is six marks
       of somebody's coursework. */
    const decision = decideMode({
      ...base,
      pack: sciencePack(),
      extraction: { readableUnits: 12, unreadable: ["Table 2 could not be read"], complete: true },
    });
    assert.equal(decision.mayShowTotal, false);
    assert.ok(decision.humanReview.some((r) => r.includes("Table 2")));
  });

  it("refuses to assess a document that barely extracted", () => {
    const decision = decideMode({
      ...base,
      pack: sciencePack(),
      extraction: { readableUnits: 1, unreadable: [], complete: false },
    });
    assert.equal(decision.mode, "feedback_only");
    assert.ok(decision.reasons.some((r) => r.includes("Too little")));
  });

  it("is always uncalibrated", () => {
    // Until a benchmark has been run against real reference marks, this string
    // is the truth, and it is stored on every review.
    assert.equal(decideMode({ ...base, pack: sciencePack() }).calibrationStatus, "uncalibrated");
  });
});

/* --------------------------------------------------------------------------
   Composing the stored review
   -------------------------------------------------------------------------- */

function criterion(id: string, mark: number | null): CriterionResult {
  return {
    id,
    mark,
    rationale: mark === null ? null : "Because of the evidence cited.",
    limiting: [],
    strengths: [],
    evidence: [],
    actions: [],
    not_assessed_reason: mark === null ? "Could not be read." : null,
  };
}

function assessment(criteria: CriterionResult[]): IaAssessment {
  return {
    report_title: "The effect of light intensity on something",
    overview: "You have a clear question and a thin evaluation.",
    criteria,
    priorities: [],
    verification_checks: [],
    input_warnings: [],
    human_review_reasons: [],
    questions_for_student: [],
  };
}

const ALL_FOUR = ["research_design", "data_analysis", "conclusion", "evaluation"];

describe("composing a review", () => {
  const shared = {
    subject: "biology" as IaSubject,
    level: "HL" as const,
    session: MAY(2026),
    stage: "final" as const,
    packVersion: "Biology 2025",
    packChecksum: "abc123",
    modelId: "gpt-4.1",
    documentHash: "deadbeef",
  };

  it("keeps marks in marking mode and totals them", () => {
    const decision = decideMode({
      subject: "biology",
      level: "HL",
      session: MAY(2026),
      stage: "final",
      pack: sciencePack(),
      extraction: CLEAN,
    });

    const review = composeReview({
      ...shared,
      decision,
      assessment: assessment(ALL_FOUR.map((id) => criterion(id, 4))),
    });

    assert.equal(review.mode, "marking");
    assert.equal(review.total, 16);
    assert.equal(review.maxTotal, 24);
  });

  it("drops marks the model returned anyway in feedback mode", () => {
    /* A model handed a report with no descriptors will sometimes mark it
       regardless — it has seen thousands of rubrics. Asking it more firmly is
       not a control; dropping the numbers here is. */
    const decision = decideMode({
      subject: "biology",
      level: "HL",
      session: MAY(2026),
      stage: "final",
      pack: null,
      extraction: CLEAN,
    });

    const review = composeReview({
      ...shared,
      packVersion: null,
      packChecksum: null,
      decision,
      assessment: assessment(ALL_FOUR.map((id) => criterion(id, 6))),
    });

    assert.equal(review.mode, "feedback_only");
    assert.equal(review.total, null);
    for (const c of review.assessment.criteria) {
      assert.equal(c.mark, null, `${c.id} kept a mark in feedback mode`);
      assert.equal(c.rationale, null);
      assert.ok(c.not_assessed_reason);
    }
  });

  it("gives no total when one criterion is unassessed", () => {
    // Three criteria summed and presented out of 24 is wrong by six marks and
    // looks exactly like a mark out of 24.
    const decision = decideMode({
      subject: "biology",
      level: "HL",
      session: MAY(2026),
      stage: "final",
      pack: sciencePack(),
      extraction: CLEAN,
    });

    const review = composeReview({
      ...shared,
      decision,
      assessment: assessment([
        criterion("research_design", 5),
        criterion("data_analysis", 4),
        criterion("conclusion", 4),
        criterion("evaluation", null),
      ]),
    });

    assert.equal(review.total, null);
  });

  it("gives no total when a criterion is missing entirely", () => {
    const decision = decideMode({
      subject: "biology",
      level: "HL",
      session: MAY(2026),
      stage: "final",
      pack: sciencePack(),
      extraction: CLEAN,
    });

    assert.equal(
      totalFor([criterion("research_design", 5), criterion("data_analysis", 5)], decision),
      null,
    );
  });

  it("caps a mark above the criterion maximum and says it did", () => {
    /* Structured output constrains the JSON shape, not the arithmetic, so a 7
       out of 6 is reachable. Keeping the feedback and flagging the mark is
       better than discarding a review the student paid for. */
    const decision = decideMode({
      subject: "biology",
      level: "HL",
      session: MAY(2026),
      stage: "final",
      pack: sciencePack(),
      extraction: CLEAN,
    });

    const review = composeReview({
      ...shared,
      decision,
      assessment: assessment([
        criterion("research_design", 9),
        criterion("data_analysis", 4),
        criterion("conclusion", 4),
        criterion("evaluation", 4),
      ]),
    });

    const capped = review.assessment.criteria.find((c) => c.id === "research_design");
    assert.equal(capped?.mark, 6);
    assert.ok(capped?.rationale?.includes("unreliable"));
    assert.equal(review.total, 18);
  });

  it("records what produced it", () => {
    const decision = decideMode({
      subject: "biology",
      level: "HL",
      session: MAY(2026),
      stage: "final",
      pack: sciencePack(),
      extraction: CLEAN,
    });
    const review = composeReview({
      ...shared,
      decision,
      assessment: assessment(ALL_FOUR.map((id) => criterion(id, 4))),
    });

    // A mark that cannot be explained a year later should not have been shown.
    assert.equal(review.assessmentPackVersion, "Biology 2025");
    assert.equal(review.assessmentPackChecksum, "abc123");
    assert.equal(review.documentHash, "deadbeef");
    assert.equal(review.rubricId, "biology_fa2025");
    assert.equal(review.session, "May 2026");
    assert.ok(review.promptVersion);
    assert.equal(review.calibrationStatus, "uncalibrated");
  });
});

/* --------------------------------------------------------------------------
   Two blind passes
   -------------------------------------------------------------------------- */

describe("comparing two passes", () => {
  it("finds the widest gap, not the first", () => {
    const worst = worstDisagreement(
      [criterion("research_design", 5), criterion("data_analysis", 2)],
      [criterion("research_design", 4), criterion("data_analysis", 5)],
    );
    assert.equal(worst?.criterionId, "data_analysis");
    assert.equal(worst?.distance, 3);
  });

  it("treats assessable-versus-not as worse than any numeric gap", () => {
    // Two passes disagreeing about whether the evidence exists at all is a
    // bigger problem than disagreeing by a mark, so it sorts above every
    // distance rather than being compared as a number.
    const worst = worstDisagreement(
      [criterion("research_design", null), criterion("data_analysis", 1)],
      [criterion("research_design", 5), criterion("data_analysis", 6)],
    );
    assert.equal(worst?.criterionId, "research_design");
    assert.equal(worst?.distance, null);
  });

  it("reports nothing when both passes agree", () => {
    const worst = worstDisagreement(
      [criterion("research_design", 5)],
      [criterion("research_design", 5)],
    );
    assert.equal(worst?.distance, 0);
  });

  it("ignores a criterion only one pass returned", () => {
    const worst = worstDisagreement(
      [criterion("research_design", 5), criterion("evaluation", 3)],
      [criterion("research_design", 5)],
    );
    assert.equal(worst?.criterionId, "research_design");
  });
});

/* --------------------------------------------------------------------------
   Extraction
   -------------------------------------------------------------------------- */

describe("word counting", () => {
  it("counts words, not characters", () => {
    assert.equal(countWords("the effect of light intensity"), 5);
  });

  it("calls nothing zero", () => {
    assert.equal(countWords(""), 0);
    assert.equal(countWords("   \n\t  "), 0);
  });
});

describe("counting PDF pages", () => {
  /* The page count is what decides how many anchors exist, and therefore
     whether a document is thought readable at all. It has to be independent of
     whether our text parser could make sense of the pages: a scanned IA is
     read perfectly well by the model, which is sent the pages, and telling that
     student "too little of this document could be read" would be false and
     would be said to somebody who has paid. */
  const pdf = (body: string) => new TextEncoder().encode(`%PDF-1.7\n${body}`).buffer;

  it("counts page objects", () => {
    assert.equal(
      pdfPageCount(pdf("<< /Type /Page >> << /Type /Page >> << /Type /Page >>")),
      3,
    );
  });

  it("does not count the page tree as a page", () => {
    // /Pages is the tree node. A naive search for "/Type /Page" matches it and
    // reports one page more than the document has, at every level of the tree.
    assert.equal(pdfPageCount(pdf("<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type /Page >>")), 2);
  });

  it("tolerates the spacings different producers emit", () => {
    assert.equal(pdfPageCount(pdf("/Type/Page\n/Type /Page\n/Type  /Page")), 3);
  });

  it("falls back to the count on the page tree", () => {
    assert.equal(pdfPageCount(pdf("<< /Type /Pages /Kids [1 0 R] /Count 14 >>")), 14);
  });

  it("answers zero rather than guessing when it cannot tell", () => {
    // Zero means "unknown" to callers, which fall back to what the text parser
    // found. It must not mean "this document has no pages".
    assert.equal(pdfPageCount(pdf("nothing structural in here at all")), 0);
  });
});
