import { z } from "zod";

/* ==========================================================================
   Lesson analysis — the contract with the model
   --------------------------------------------------------------------------
   Defined twice on purpose. The JSON Schema is what the model is constrained
   to emit; the Zod schema is what we refuse to store if it somehow does not.
   Structured output makes malformed JSON very unlikely, not impossible, and a
   dashboard that renders `undefined.map()` because a model had an off day is
   not an acceptable failure mode.
   ========================================================================== */

const list = (max: number) => z.array(z.string().min(1).max(600)).max(max);

export const lessonAnalysisSchema = z.object({
  lesson_title: z.string().min(1).max(200),
  summary: z.string().min(1).max(4000),
  topics_covered: list(15),
  key_concepts: list(15),
  student_strengths: list(10),
  areas_for_improvement: list(10),
  misconceptions_detected: list(10),
  homework_assigned: list(10),
  resources_mentioned: list(10),
  next_lesson_recommendations: list(10),
  tutor_private_observations: list(10),
});

export type LessonAnalysis = z.infer<typeof lessonAnalysisSchema>;

/** The same shape, expressed for the API. Every field is required and
 *  additionalProperties is false — both are conditions of strict mode. */
export const LESSON_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "lesson_title",
    "summary",
    "topics_covered",
    "key_concepts",
    "student_strengths",
    "areas_for_improvement",
    "misconceptions_detected",
    "homework_assigned",
    "resources_mentioned",
    "next_lesson_recommendations",
    "tutor_private_observations",
  ],
  properties: {
    lesson_title: {
      type: "string",
      description:
        "A specific title for this lesson, naming the actual topic. Not 'Chemistry lesson'.",
    },
    summary: {
      type: "string",
      description:
        "One to three short paragraphs addressed to the student, in the second person. Factual and specific to this transcript.",
    },
    topics_covered: { type: "array", items: { type: "string" } },
    key_concepts: { type: "array", items: { type: "string" } },
    student_strengths: {
      type: "array",
      items: { type: "string" },
      description: "Only things the student demonstrably did in this transcript.",
    },
    areas_for_improvement: { type: "array", items: { type: "string" } },
    misconceptions_detected: {
      type: "array",
      items: { type: "string" },
      description: "Only errors actually made and visible in the transcript. Empty if none.",
    },
    homework_assigned: {
      type: "array",
      items: { type: "string" },
      description:
        "Only work the tutor explicitly set. Suggested revision belongs in next_lesson_recommendations. Empty if none was set.",
    },
    resources_mentioned: { type: "array", items: { type: "string" } },
    next_lesson_recommendations: { type: "array", items: { type: "string" } },
    tutor_private_observations: {
      type: "array",
      items: { type: "string" },
      description:
        "Diagnostic notes for the tutor only. Pedagogical observations about approach and understanding — never about personality, wellbeing or ability as a trait.",
    },
  },
} as const;
