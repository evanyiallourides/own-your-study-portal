/* ==========================================================================
   The marking contract
   --------------------------------------------------------------------------
   Defined twice, for the same reason `ai/schema.ts` is: the JSON Schema is
   what the model is constrained to emit, and the Zod schema is what we refuse
   to store if it somehow emits something else. Structured output makes
   malformed JSON unlikely rather than impossible, and this one decides what a
   student is told about their coursework.

   What the model is asked for, and what it is NOT asked for, is the design.
   It returns the assessment: per-criterion marks, the evidence behind them,
   and what to do next. It does not return the mode, the calibration status,
   the rubric id, the maximum, or the total. Those are ours.

   That is not tidiness. `mode` is the field that says whether a mark may exist
   at all, and a model that can write its own `mode: "marking"` can mark a
   report whose descriptors we do not hold — which is precisely the failure the
   whole subsystem is arranged to prevent. The server composes the record; the
   model fills in the part it is competent to fill in.

   For the same reason the total is computed here rather than returned. A model
   that adds up its own four marks will occasionally return a total that is not
   their sum, and a review whose parts disagree with its whole is worse than
   one with no total at all.
   ========================================================================== */

import { z } from "zod";

import type { ModeDecision, ReviewMode } from "@/lib/ia/mode";
import type { DraftStage, IaLevel, IaSubject, RubricModel, Session } from "@/lib/ia/rubrics";
import { formatSession } from "@/lib/ia/rubrics";

/* --------------------------------------------------------------------------
   What kind of work a recommendation asks for
   --------------------------------------------------------------------------
   All three packs insist on this separation, and it is the single most useful
   thing in the output for a student three days from a deadline. "Explain your
   dilution chain more clearly" and "run the titration again" are both valid
   advice and only one of them is possible on Thursday night.

   `new_evidence` is named rather than "new experiment" because a Maths
   exploration collects nothing in a laboratory, and a database investigation
   collects nothing at all.
   -------------------------------------------------------------------------- */
export const WORK_TYPES = ["clarify", "reanalyse", "new_evidence"] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  clarify: "Report what you did more clearly",
  reanalyse: "Re-work what you already have",
  new_evidence: "Collect or generate something new",
};

/** How long each kind of work tends to take. Used to order the plan. */
export const WORK_TYPE_WEIGHT: Record<WorkType, number> = {
  clarify: 1,
  reanalyse: 2,
  new_evidence: 3,
};

const text = (max: number) => z.string().min(1).max(max);
const list = (max: number, itemMax = 600) => z.array(z.string().min(1).max(itemMax)).max(max);

/* --------------------------------------------------------------------------
   Evidence
   --------------------------------------------------------------------------
   Every claim in the review has to point at somewhere in the document. This is
   what makes the difference between a review a student can check and a review
   they have to take on faith — and it is also the only practical defence
   against a confident sentence about a section that does not exist, since a
   location can be looked at.
   -------------------------------------------------------------------------- */
const evidenceSchema = z.object({
  /** "p. 4, Table 2", "§3.1", "¶12". Whatever the anchor map actually offers. */
  location: text(120),
  /** A short quotation or a faithful paraphrase — enough to find it again. */
  excerpt: text(400),
  /** What this shows, in the assessor's words. */
  observation: text(600),
});

const actionSchema = z.object({
  action: text(600),
  work_type: z.enum(WORK_TYPES),
  /** How the student knows they have done it. Not "improve the evaluation". */
  completion_check: text(400),
  location: text(120).nullable(),
});

const criterionResultSchema = z.object({
  id: text(60),
  /** Null means not assessable. It never means zero. */
  mark: z.number().int().min(0).max(10).nullable(),
  /** Required when a mark is given; explains the band against the evidence. */
  rationale: text(1200).nullable(),
  /** What holds the work back from the next band. */
  limiting: list(6, 600),
  strengths: list(6, 600),
  evidence: z.array(evidenceSchema).max(8),
  actions: z.array(actionSchema).max(4),
  /** Set instead of a mark when the criterion could not be assessed. */
  not_assessed_reason: text(400).nullable(),
});

const prioritySchema = z.object({
  title: text(160),
  why: text(800),
  criterion_id: text(60),
  work_type: z.enum(WORK_TYPES),
});

/* --------------------------------------------------------------------------
   Verification
   --------------------------------------------------------------------------
   A log of what was actually checked, kept separate from the assessment. The
   packs are blunt about the failure it exists to stop: "avoid claiming that
   all calculations are correct after checking one example". A check with a
   recorded scope cannot be quietly generalised.
   -------------------------------------------------------------------------- */
const verificationSchema = z.object({
  what: text(300),
  inputs: text(600),
  method: text(300),
  result: text(600),
  /** What this check does and does not cover. */
  scope: text(300),
  status: z.enum(["confirmed", "contradicted", "unverified"]),
});

export const iaAssessmentSchema = z.object({
  /** A title for the work, taken from it — not invented. */
  report_title: text(200),
  /** Two or three sentences to the student, in the second person. */
  overview: text(2500),
  criteria: z.array(criterionResultSchema).min(1).max(6),
  priorities: z.array(prioritySchema).max(5),
  verification_checks: z.array(verificationSchema).max(12),
  /** Problems with the FILE, kept apart from problems with the work. */
  input_warnings: list(10),
  /** Anything a person should look at before the student acts on it. */
  human_review_reasons: list(8),
  /** Questions whose answers would materially change the review. */
  questions_for_student: list(6),
});

export type IaAssessment = z.infer<typeof iaAssessmentSchema>;
export type CriterionResult = z.infer<typeof criterionResultSchema>;
export type IaEvidence = z.infer<typeof evidenceSchema>;
export type IaAction = z.infer<typeof actionSchema>;
export type IaPriority = z.infer<typeof prioritySchema>;
export type IaVerification = z.infer<typeof verificationSchema>;

/* ==========================================================================
   The stored review
   --------------------------------------------------------------------------
   The model's assessment plus everything the server knows: which rubric, which
   pack, which mode, and the total — computed, never taken on trust.
   ========================================================================== */

export interface IaReview {
  subject: IaSubject;
  level: IaLevel;
  session: string;
  stage: DraftStage;
  rubricId: string;
  rubricName: string;
  mode: ReviewMode;
  calibrationStatus: "uncalibrated";
  /** Why marks were withheld. Empty exactly when mode is "marking". */
  modeReasons: string[];
  assessmentPackVersion: string | null;
  assessmentPackChecksum: string | null;
  modelId: string;
  promptVersion: string;
  documentHash: string;
  assessment: IaAssessment;
  /** Null whenever any criterion is unassessed, or the mode is not marking. */
  total: number | null;
  maxTotal: number;
  humanReviewReasons: string[];
  createdAt: string;
}

/** The prompt this review was produced under. Bumped when the prompt changes. */
export const PROMPT_VERSION = "ia-2026-09-17";

/* --------------------------------------------------------------------------
   Composing the record
   --------------------------------------------------------------------------
   Where the model's answer and the server's authority meet. Everything that
   could overstate the review is decided here.
   -------------------------------------------------------------------------- */

export interface ComposeInput {
  assessment: IaAssessment;
  decision: ModeDecision;
  subject: IaSubject;
  level: IaLevel;
  session: Session;
  stage: DraftStage;
  packVersion: string | null;
  packChecksum: string | null;
  modelId: string;
  documentHash: string;
}

export function composeReview(input: ComposeInput): IaReview {
  const { decision } = input;
  const rubric = decision.rubric;

  /* Marks survive only in marking mode. A model handed a report with no
     descriptors will sometimes return marks anyway — it has seen thousands of
     rubrics — and the only reliable answer to that is to drop them here rather
     than to ask it more firmly. */
  const criteria = decision.mode === "marking"
    ? input.assessment.criteria.map((c) => clampToRubric(c, rubric))
    : input.assessment.criteria.map((c) => ({
        ...c,
        mark: null,
        rationale: null,
        not_assessed_reason:
          c.not_assessed_reason ?? "Marks are withheld for this review — see the note above.",
      }));

  return {
    subject: input.subject,
    level: input.level,
    session: formatSession(input.session),
    stage: input.stage,
    rubricId: rubric.id,
    rubricName: rubric.name,
    mode: decision.mode,
    calibrationStatus: decision.calibrationStatus,
    modeReasons: decision.reasons,
    assessmentPackVersion: input.packVersion,
    assessmentPackChecksum: input.packChecksum,
    modelId: input.modelId,
    promptVersion: PROMPT_VERSION,
    documentHash: input.documentHash,
    assessment: { ...input.assessment, criteria },
    total: totalFor(criteria, decision),
    maxTotal: rubric.maxTotal,
    humanReviewReasons: [...decision.humanReview, ...input.assessment.human_review_reasons],
    createdAt: new Date().toISOString(),
  };
}

/**
 * A mark the rubric cannot award is a bug, not a band.
 *
 * Structured output constrains the JSON shape and not the arithmetic, so a 7
 * out of 6 is reachable. Clamping rather than rejecting the whole review keeps
 * the feedback — which is most of the value — and the clamp is recorded in the
 * criterion's own rationale so it is visible rather than silent.
 */
function clampToRubric(criterion: CriterionResult, rubric: RubricModel): CriterionResult {
  const definition = rubric.criteria.find((c) => c.id === criterion.id);
  if (!definition || criterion.mark === null) return criterion;

  if (criterion.mark > definition.max) {
    return {
      ...criterion,
      mark: definition.max,
      rationale:
        `${criterion.rationale ?? ""} (Reported above the maximum for this criterion and ` +
        `capped at ${definition.max}; treat this mark as unreliable.)`.trim(),
    };
  }
  return criterion;
}

/**
 * The total, or null.
 *
 * Null whenever any criterion is unassessed — a sum of three criteria
 * presented as a mark out of twenty-four is wrong by six marks and looks
 * exactly like a mark out of twenty-four.
 */
export function totalFor(criteria: CriterionResult[], decision: ModeDecision): number | null {
  if (!decision.mayShowTotal) return null;
  if (criteria.length !== decision.rubric.criteria.length) return null;
  if (criteria.some((c) => c.mark === null)) return null;
  return criteria.reduce((sum, c) => sum + (c.mark ?? 0), 0);
}

/* ==========================================================================
   The JSON Schema
   --------------------------------------------------------------------------
   Strict mode requires every property to be listed in `required` and
   `additionalProperties: false` on every object. Optionality is expressed as a
   nullable type, which is why `mark`, `rationale` and `not_assessed_reason`
   are nullable rather than absent.
   ========================================================================== */

const STRING = { type: "string" } as const;

export const IA_ASSESSMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "report_title",
    "overview",
    "criteria",
    "priorities",
    "verification_checks",
    "input_warnings",
    "human_review_reasons",
    "questions_for_student",
  ],
  properties: {
    report_title: {
      ...STRING,
      description: "The title of the work, taken from the document. Do not invent one.",
    },
    overview: {
      ...STRING,
      description:
        "Two or three sentences addressed to the student in the second person. What this piece of work does well and what most needs attention. No marks in this text.",
    },
    criteria: {
      type: "array",
      description: "Exactly one entry per criterion of the supplied rubric, in the rubric's order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "mark",
          "rationale",
          "limiting",
          "strengths",
          "evidence",
          "actions",
          "not_assessed_reason",
        ],
        properties: {
          id: { ...STRING, description: "The criterion id exactly as supplied in the rubric." },
          mark: {
            type: ["integer", "null"],
            description:
              "The mark, only when the official descriptors were supplied AND the evidence for this criterion was readable. Null otherwise. Null NEVER means zero — a zero is a rubric judgement about work that is present, not a way to record work you could not read.",
          },
          rationale: {
            type: ["string", "null"],
            description:
              "Why this band fits and what prevents the next one, argued from the evidence cited below. Null when no mark was given.",
          },
          limiting: {
            type: "array",
            items: STRING,
            description: "Specific evidence that holds the work back from the next band.",
          },
          strengths: {
            type: "array",
            items: STRING,
            description: "Specific things the work does well. Only what is actually in the document.",
          },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["location", "excerpt", "observation"],
              properties: {
                location: {
                  ...STRING,
                  description:
                    "An anchor from the supplied document map — never a page number you inferred.",
                },
                excerpt: { ...STRING, description: "A short quotation or faithful paraphrase." },
                observation: { ...STRING, description: "What this shows." },
              },
            },
          },
          actions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["action", "work_type", "completion_check"],
              properties: {
                action: { ...STRING, description: "What to do. Specific enough to act on tonight." },
                work_type: {
                  type: "string",
                  enum: [...WORK_TYPES],
                  description:
                    "clarify = report work already done more clearly; reanalyse = re-work existing data or mathematics; new_evidence = collect or generate something that does not exist yet.",
                },
                completion_check: {
                  ...STRING,
                  description: "How the student can tell they have actually done it.",
                },
                location: {
                  type: ["string", "null"],
                  description: "Where in the document this applies, if anywhere specific.",
                },
              },
            },
          },
          not_assessed_reason: {
            type: ["string", "null"],
            description: "Why no mark was given. Null when a mark was given.",
          },
        },
      },
    },
    priorities: {
      type: "array",
      description:
        "At most five, ordered by consequence rather than by page order. Return fewer when there are fewer — do not pad to five.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "why", "criterion_id", "work_type"],
        properties: {
          title: STRING,
          why: { ...STRING, description: "The consequence of leaving it as it is." },
          criterion_id: STRING,
          work_type: { type: "string", enum: [...WORK_TYPES] },
        },
      },
    },
    verification_checks: {
      type: "array",
      description:
        "Every calculation or claim you actually checked. Do not list a check you did not perform, and do not describe a single spot check as though it covered the whole analysis.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["what", "inputs", "method", "result", "scope", "status"],
        properties: {
          what: STRING,
          inputs: { ...STRING, description: "The values used, with units." },
          method: STRING,
          result: STRING,
          scope: {
            ...STRING,
            description: "What this check covers and what it does not. Be explicit about the limit.",
          },
          status: { type: "string", enum: ["confirmed", "contradicted", "unverified"] },
        },
      },
    },
    input_warnings: {
      type: "array",
      items: STRING,
      description:
        "Problems with the FILE — unreadable tables, missing pages, ambiguous notation. Never problems with the work.",
    },
    human_review_reasons: {
      type: "array",
      items: STRING,
      description: "Anything a qualified person should look at before the student acts on this.",
    },
    questions_for_student: {
      type: "array",
      items: STRING,
      description: "Questions whose answers would materially change this review.",
    },
  },
} as const;
