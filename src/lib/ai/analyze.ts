import "server-only";

import OpenAI from "openai";

import { LESSON_ANALYSIS_JSON_SCHEMA, lessonAnalysisSchema, type LessonAnalysis } from "@/lib/ai/schema";
import { SYSTEM_PROMPT, buildUserPrompt, type AnalysisContext } from "@/lib/ai/prompt";
import { env } from "@/lib/env";
import type { TranscriptSegment } from "@/lib/types";

/* ==========================================================================
   Lesson analysis service
   --------------------------------------------------------------------------
   Server-only. The key never reaches a bundle, and this module is never
   imported by a component — the webhook and the manual "analyse" action are
   its only callers.
   ========================================================================== */

export class AnalysisUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisUnavailableError";
  }
}

export function isAnalysisConfigured(): boolean {
  return Boolean(env.openaiApiKey);
}

/** Roughly four characters per token. Long lessons are truncated from the
 *  middle rather than the end, because the last ten minutes — where homework
 *  is set — matter more than the middle twenty. */
const MAX_TRANSCRIPT_CHARS = 240_000;

function fitToBudget(segments: TranscriptSegment[]): TranscriptSegment[] {
  const total = segments.reduce((sum, s) => sum + s.text.length + 40, 0);
  if (total <= MAX_TRANSCRIPT_CHARS) return segments;

  const keepEachEnd = Math.floor(segments.length * 0.35);
  const head = segments.slice(0, keepEachEnd);
  const tail = segments.slice(segments.length - keepEachEnd);
  const marker: TranscriptSegment = {
    index: -1,
    speaker: "System",
    role: "other",
    startSeconds: head[head.length - 1]?.endSeconds ?? 0,
    endSeconds: tail[0]?.startSeconds ?? 0,
    text: "[A section of the middle of this lesson has been omitted because the transcript exceeded the length that can be analysed in one pass.]",
  };
  return [...head, marker, ...tail];
}

export async function analyseLesson(
  segments: TranscriptSegment[],
  context: AnalysisContext,
): Promise<LessonAnalysis> {
  const apiKey = env.openaiApiKey;
  if (!apiKey) {
    throw new AnalysisUnavailableError(
      "OPENAI_API_KEY is not set, so lesson analysis cannot run. The lesson can still be written up by hand.",
    );
  }
  if (segments.length === 0) {
    throw new AnalysisUnavailableError("This transcript is empty, so there is nothing to analyse.");
  }

  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model: env.openaiModel,
    // Low but not zero: the write-up should read as prose, not as a form.
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(fitToBudget(segments), context) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "lesson_analysis",
        strict: true,
        schema: LESSON_ANALYSIS_JSON_SCHEMA,
      },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new AnalysisUnavailableError("The analysis came back empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AnalysisUnavailableError("The analysis was not valid JSON.");
  }

  const result = lessonAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    // The transcript is not logged — only the shape of the failure.
    console.error(
      "[ai] analysis failed validation:",
      result.error.issues.map((i) => i.path.join(".")).join(", "),
    );
    throw new AnalysisUnavailableError(
      "The analysis did not match the expected structure and was discarded.",
    );
  }

  return result.data;
}

/** Maps the model's snake_case contract onto the columns the portal stores. */
export function analysisToNotesPatch(analysis: LessonAnalysis) {
  return {
    summary: analysis.summary,
    topicsCovered: analysis.topics_covered,
    keyConcepts: analysis.key_concepts,
    strengths: analysis.student_strengths,
    areasForImprovement: analysis.areas_for_improvement,
    misconceptions: analysis.misconceptions_detected,
    homework: analysis.homework_assigned,
    resourcesMentioned: analysis.resources_mentioned,
    nextSteps: analysis.next_lesson_recommendations,
    tutorPrivateNotes: analysis.tutor_private_observations.join("\n"),
  };
}
