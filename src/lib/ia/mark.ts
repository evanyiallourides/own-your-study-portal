import "server-only";

import OpenAI from "openai";

import { extractDocument, type ExtractedDocument } from "@/lib/ia/extract";
import { decideMode, type ExtractionQuality, type ModeDecision } from "@/lib/ia/mode";
import { descriptorsFor, type AssessmentPack, type PackLoader } from "@/lib/ia/packs";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/ia/prompt";
import { routeToRubric, type DraftStage, type IaLevel, type IaSubject, type Session } from "@/lib/ia/rubrics";
import {
  IA_ASSESSMENT_JSON_SCHEMA,
  composeReview,
  iaAssessmentSchema,
  type CriterionResult,
  type IaAssessment,
  type IaReview,
} from "@/lib/ia/schema";
import { env } from "@/lib/env";

/* ==========================================================================
   Running a review
   --------------------------------------------------------------------------
   Server-only. The key never reaches a bundle, and no component imports this.

   The order of operations is the point, and it is the order all three source
   packs describe:

     1. Read the document, and record what could not be read.
     2. Route the session to a marking model — never the upload date.
     3. Load the assessment pack for that model, if one is installed.
     4. DECIDE THE MODE, before any model is called. Whether marks are
        permitted is settled by `mode.ts` from facts we hold, not by asking a
        model how confident it feels.
     5. Assess.
     6. In marking mode only, assess again blind and compare.
     7. Validate, clamp, total, compose.

   Step 4 before step 5 matters. A system that marks first and decides
   afterwards whether it was allowed to has already produced the number, and
   numbers that exist have a way of reaching people.
   ========================================================================== */

export class MarkingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkingUnavailableError";
  }
}

export function isMarkingConfigured(): boolean {
  return Boolean(env.openaiApiKey);
}

export interface MarkRequest {
  fileName: string;
  bytes: ArrayBuffer;
  subject: IaSubject;
  level: IaLevel;
  session: Session;
  stage: DraftStage;
  /** What the student asked us to look at. Evidence, never instruction. */
  studentNote: string | null;
  packs: PackLoader;
}

export interface MarkOutcome {
  review: IaReview;
  document: ExtractedDocument;
  decision: ModeDecision;
  /** Set when a second pass ran and disagreed enough to need a person. */
  disagreement: Disagreement | null;
}

export interface Disagreement {
  criterionId: string;
  first: number | null;
  second: number | null;
  /** Marks apart. Null when one pass could not assess the criterion. */
  distance: number | null;
}

/**
 * How far two blind passes may differ before a person is asked to look.
 *
 * One mark, proposed rather than derived — it is a product policy, not an IB
 * rule, and it is written down here so that when real reference marks exist it
 * is one number to revisit rather than a scattering of thresholds.
 */
const ESCALATION_DISTANCE = 1;

export async function markSubmission(request: MarkRequest): Promise<MarkOutcome> {
  const apiKey = env.openaiApiKey;
  if (!apiKey) {
    throw new MarkingUnavailableError(
      "OPENAI_API_KEY is not set, so IA reviews cannot run on this deployment.",
    );
  }

  const document = await extractDocument(request.fileName, request.bytes);
  const { rubric } = routeToRubric(request.subject, request.session);
  const pack = await request.packs.load(rubric.id);

  const decision = decideMode({
    subject: request.subject,
    level: request.level,
    session: request.session,
    stage: request.stage,
    pack,
    extraction: qualityOf(document, request.stage),
  });

  const client = new OpenAI({ apiKey });
  const system = buildSystemPrompt(request.subject);
  const user = buildUserPrompt({
    subject: request.subject,
    level: request.level,
    session: request.session,
    stage: request.stage,
    rubric: decision.rubric,
    descriptors:
      pack && decision.mode === "marking"
        ? descriptorsFor(pack, decision.rubric, request.level)
        : null,
    packVersion: pack?.version ?? null,
    generalGuidance: pack?.generalGuidance ?? [],
    bestFitGuidance: pack?.bestFitGuidance ?? [],
    document,
    studentNote: request.studentNote,
  });

  const first = await assess(client, system, user, document, request);

  /* A second pass is only meaningful where there are marks to disagree about.
     In feedback mode it would cost the same and compare nothing, so it does
     not run — and the review says a single pass produced it. */
  let disagreement: Disagreement | null = null;
  let chosen = first;

  if (decision.mode === "marking") {
    const second = await assess(client, system, user, document, request);
    disagreement = worstDisagreement(first.criteria, second.criteria);

    if (disagreement && (disagreement.distance === null || disagreement.distance > ESCALATION_DISTANCE)) {
      /* Adjudicate against the evidence rather than by averaging. Averaging two
         marks nobody can defend produces a third that nobody can defend, and
         hides the disagreement instead of surfacing it. Withholding the
         criterion is the honest answer, and the human-review reason says why. */
      chosen = withhold(first, disagreement);
    }
  }

  const review = composeReview({
    assessment: chosen,
    decision,
    subject: request.subject,
    level: request.level,
    session: request.session,
    stage: request.stage,
    packVersion: pack?.version ?? null,
    packChecksum: pack?.checksum ?? null,
    modelId: env.openaiModel,
    documentHash: document.hash,
  });

  return { review, document, decision, disagreement };
}

/* --------------------------------------------------------------------------
   One pass
   -------------------------------------------------------------------------- */

async function assess(
  client: OpenAI,
  system: string,
  user: string,
  document: ExtractedDocument,
  request: MarkRequest,
): Promise<IaAssessment> {
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: user },
  ];

  /* The original PDF goes with the prompt so the model sees the pages rather
     than our approximation of them. Subscripts, superscripts, matrices, and
     the column alignment that makes a results table mean anything all survive
     this and none of them survive text extraction. */
  if (document.needsVisualReader) {
    content.push({
      type: "file",
      file: {
        filename: safeFileName(request.fileName),
        file_data: `data:application/pdf;base64,${base64(request.bytes)}`,
      },
    });
  }

  const completion = await client.chat.completions.create({
    model: env.openaiModel,
    /* Higher than the lesson write-up's 0.3 would make two blind passes agree
       for the wrong reason; lower makes the prose mechanical. Assessment wants
       consistency more than it wants voice. */
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "ia_assessment", strict: true, schema: IA_ASSESSMENT_JSON_SCHEMA },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new MarkingUnavailableError("The review came back empty.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MarkingUnavailableError("The review was not valid JSON.");
  }

  const result = iaAssessmentSchema.safeParse(parsed);
  if (!result.success) {
    // The student's document is never logged — only the shape of the failure.
    console.error(
      "[ia] review failed validation:",
      result.error.issues.map((i) => i.path.join(".")).join(", "),
    );
    throw new MarkingUnavailableError(
      "The review did not match the expected structure and was discarded. Nothing was charged.",
    );
  }

  return result.data;
}

/* --------------------------------------------------------------------------
   Comparing two passes
   --------------------------------------------------------------------------
   Agreement is a consistency signal and nothing more. Two passes of the same
   model agreeing tells us the model is stable, not that it is right — the
   packs say so explicitly, and so does this comment, because the temptation to
   present agreement as accuracy is strong and the claim would be false.
   -------------------------------------------------------------------------- */

export function worstDisagreement(
  first: CriterionResult[],
  second: CriterionResult[],
): Disagreement | null {
  const secondById = new Map(second.map((c) => [c.id, c]));
  let worst: Disagreement | null = null;

  for (const a of first) {
    const b = secondById.get(a.id);
    if (!b) continue;

    // One pass could assess it and the other could not. That is a disagreement
    // about whether the evidence exists, which is worth more attention than a
    // one-mark gap, so it sorts above every numeric distance.
    if (a.mark === null || b.mark === null) {
      if (a.mark !== b.mark) {
        return { criterionId: a.id, first: a.mark, second: b.mark, distance: null };
      }
      continue;
    }

    const distance = Math.abs(a.mark - b.mark);
    if (!worst || worst.distance === null || distance > worst.distance) {
      worst = { criterionId: a.id, first: a.mark, second: b.mark, distance };
    }
  }

  return worst;
}

/** Drop the disputed criterion's mark and say why, keeping all the feedback. */
function withhold(assessment: IaAssessment, disagreement: Disagreement): IaAssessment {
  const explanation =
    disagreement.distance === null
      ? "Two independent passes disagreed about whether this criterion could be assessed at all, so no mark is shown."
      : `Two independent passes marked this ${disagreement.distance} marks apart, which is more than this review will present as settled.`;

  return {
    ...assessment,
    criteria: assessment.criteria.map((c) =>
      c.id === disagreement.criterionId
        ? { ...c, mark: null, rationale: null, not_assessed_reason: explanation }
        : c,
    ),
    human_review_reasons: [
      ...assessment.human_review_reasons,
      `${disagreement.criterionId}: passes returned ${describe(disagreement.first)} and ${describe(
        disagreement.second,
      )}. A tutor should mark this criterion.`,
    ],
  };
}

const describe = (mark: number | null) => (mark === null ? "no mark" : String(mark));

/* --------------------------------------------------------------------------
   Extraction quality, in the terms the mode decision wants
   -------------------------------------------------------------------------- */

function qualityOf(document: ExtractedDocument, stage: DraftStage): ExtractionQuality {
  return {
    /* Pages for a PDF, paragraphs otherwise — the anchors the model is allowed
       to cite. For a scan this is the real page count even though our own text
       extraction found nothing, because the model is sent the pages and does
       read them. Using the text parser's output here would tell a student with
       a perfectly legible scan that their document could not be read. */
    readableUnits: document.anchors.length,

    /* Only warnings naming something we KNOW we could not read. Those are what
       make a criterion unassessable and stop a total. "This is short for a full
       report" is an observation about the work rather than a failure to read
       it, and treating the two alike would withhold a total from every
       genuinely brief investigation. */
    unreadable: document.warnings.filter(isReadFailure),

    /* "Complete" here means: can we check the review against the document
       ourselves? A partial draft is not complete by definition. A file with no
       text layer is not either — the model reads the pages, but we hold no text
       to check a single one of its quotations against, so every evidence
       location it gives us is unverifiable. Marking on that basis would be
       putting numbers on work nobody could audit. */
    complete: stage !== "partial_draft" && document.wordCount > 0,
  };
}

function isReadFailure(warning: string): boolean {
  return (
    warning.includes("no selectable text") ||
    warning.includes("could not read") ||
    warning.includes("were not read") ||
    warning.includes("do not extract")
  );
}

/* --------------------------------------------------------------------------
   Odds and ends
   -------------------------------------------------------------------------- */

function base64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The student named this file; it travels to a third party, so it is stripped
 *  to something that cannot be read as a path or an instruction. */
function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "submission.pdf";
  return base.replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "submission.pdf";
}
