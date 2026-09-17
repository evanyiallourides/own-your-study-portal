/* ==========================================================================
   What kind of review this submission can get
   --------------------------------------------------------------------------
   One pure function, deliberately isolated from the model call, the database
   and Next. It is the single place that answers "may this report be given
   numbers?", and it is the thing most worth testing in the whole subsystem —
   because every way of getting it wrong produces a plausible-looking mark out
   of twenty-four that nobody can defend.

   It answers "no" for four separate reasons, and they are not the same reason:

     1. The session routes to a model we cannot mark at all — a 2029 Maths
        sitting, a pre-2025 science one.
     2. No assessment pack is installed for the model, or the installed one
        does not validate. This is the common case today.
     3. The document could not be read well enough. A criterion whose evidence
        is an unreadable table is unassessable, which is NOT the same as zero:
        "do not award zero for an extraction failure" appears in all three
        source packs, and the difference between those two outcomes is a
        student's grade.
     4. It is a partial draft. Sections that were never submitted cannot be
        marked as missing achievement, so a partial draft gets feedback and no
        total — the rubric has nothing to say about work it has not seen.

   The distinction the fourth case protects is subtle and worth keeping in
   view: a COMPLETE report with no evaluation section has demonstrably not
   evaluated anything, and the rubric speaks to that. A PARTIAL draft with no
   evaluation section has simply not got there yet.
   ========================================================================== */

import type { AssessmentPack } from "@/lib/ia/packs";
import { validatePack } from "@/lib/ia/packs";
import {
  routeToRubric,
  type DraftStage,
  type IaLevel,
  type IaSubject,
  type RubricModel,
  type Session,
} from "@/lib/ia/rubrics";

export type ReviewMode = "marking" | "feedback_only";

/** How well the document came out of extraction, as far as we can tell. */
export interface ExtractionQuality {
  /** Pages, sections or paragraphs we could read at all. */
  readableUnits: number;
  /** Locations we know we could not read — a figure, a table, a formula. */
  unreadable: string[];
  /** True when the extractor believes it has the whole document. */
  complete: boolean;
}

export interface ModeInput {
  subject: IaSubject;
  level: IaLevel;
  session: Session;
  stage: DraftStage;
  pack: AssessmentPack | null;
  extraction: ExtractionQuality;
}

export interface ModeDecision {
  mode: ReviewMode;
  rubric: RubricModel;
  /**
   * Why marks are withheld, in the order they should be shown. Empty exactly
   * when mode is "marking". Written for a student to read, not for a log.
   */
  reasons: string[];
  /** Whether a mark out of the model's total may be displayed. */
  mayShowTotal: boolean;
  /** Reasons a human should look at this before the student acts on it. */
  humanReview: string[];
  calibrationStatus: "uncalibrated";
}

/**
 * Below this, the document is too thin to have been a report. Not a judgement
 * about quality — an extraction that produced two readable paragraphs from a
 * twelve-page PDF has failed, and marking what it did produce would mark the
 * failure rather than the work.
 */
const MIN_READABLE_UNITS = 3;

export function decideMode(input: ModeInput): ModeDecision {
  const { rubric, blocked } = routeToRubric(input.subject, input.session);

  const reasons: string[] = [];
  const humanReview: string[] = [];

  if (blocked) reasons.push(blocked);

  /* -- the pack ---------------------------------------------------------- */
  if (!input.pack) {
    reasons.push(
      `We do not yet hold the official ${rubric.name} achievement descriptors, so this review ` +
        `is written feedback against the published criteria rather than a mark. Reconstructing ` +
        `IB's bands from memory or from a revision website would produce a number that looks ` +
        `authoritative and is not.`,
    );
  } else {
    const validation = validatePack(input.pack);
    if (!validation.ok) {
      reasons.push(
        "The installed assessment pack does not cover every criterion of this model, so marking " +
          "is switched off until it does.",
      );
      humanReview.push(
        `Assessment pack "${input.pack.version}" failed validation: ` +
          validation.problems.map((p) => `${p.field} — ${p.detail}`).join("; "),
      );
    }
  }

  /* -- the document ------------------------------------------------------ */
  if (input.extraction.readableUnits < MIN_READABLE_UNITS) {
    reasons.push(
      "Too little of this document could be read to assess it. That is a problem with the file " +
        "rather than with the work — try exporting it again as a text-based PDF rather than a scan.",
    );
    humanReview.push("Extraction produced almost nothing; the upload is probably a scan or an image.");
  } else if (!input.extraction.complete) {
    reasons.push(
      "We could not read this file as text — it is most likely a scan or an export of images. " +
        "The pages were still read and the feedback below is the full review, but we cannot " +
        "check any of it back against your written words, so no marks are given. Exporting " +
        "straight to PDF from your word processor, rather than scanning a printout, fixes this.",
    );
  }

  if (input.extraction.unreadable.length > 0) {
    /* Not on its own a reason to withhold everything — the criteria whose
       evidence is readable are still assessable, and per-criterion nulls carry
       that. But it does stop a TOTAL, because a total silently asserts that
       all four criteria were assessed. */
    humanReview.push(
      `Unreadable in the upload: ${input.extraction.unreadable.slice(0, 6).join("; ")}` +
        (input.extraction.unreadable.length > 6
          ? ` and ${input.extraction.unreadable.length - 6} more`
          : ""),
    );
  }

  /* -- the stage --------------------------------------------------------- */
  if (input.stage === "partial_draft") {
    reasons.push(
      "This is a partial draft, so there is no total. A section you have not written yet is not " +
        "a section you have scored nothing for — the feedback below covers what you have sent.",
    );
  }

  const mode: ReviewMode = reasons.length === 0 ? "marking" : "feedback_only";

  return {
    mode,
    rubric,
    reasons,
    /* A total asserts that every criterion was assessed. Anything that makes
       one criterion unassessable makes the total a lie about the other three. */
    mayShowTotal: mode === "marking" && input.extraction.unreadable.length === 0,
    humanReview,
    // Nothing here has been benchmarked against reference marks. Until it has,
    // this string is the truth and it is stored on every review.
    calibrationStatus: "uncalibrated",
  };
}

/**
 * A one-line version for a list row.
 *
 * Kept next to the decision rather than in a component so the wording cannot
 * drift away from the rule it is describing.
 */
export function modeLabel(decision: Pick<ModeDecision, "mode">): string {
  return decision.mode === "marking" ? "Provisional marks" : "Written feedback";
}
