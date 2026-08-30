import type { TranscriptSegment } from "@/lib/types";

export interface AnalysisContext {
  tutorName: string;
  studentName: string;
  studentFirstName: string;
  subjectDisplayName: string;
  /** Titles of the previous few lessons, so the write-up can be continuous. */
  previousLessonTitles: string[];
  /** Areas flagged previously, so the model can note whether they have held. */
  previousAreasForImprovement: string[];
}

/* ==========================================================================
   The prompt
   --------------------------------------------------------------------------
   Most of this is a list of things not to do. That is deliberate: the failure
   modes of a model writing about a child's learning are predictable — inventing
   homework, inflating praise, diagnosing, and confusing a suggestion with an
   instruction — and each one is cheaper to forbid than to detect afterwards.
   ========================================================================== */

export const SYSTEM_PROMPT = `You write up tutoring lessons for Own Your Study, a specialist 1:1 tutoring practice. You are given the transcript of one lesson and asked to produce a structured write-up which a human tutor will then review, edit and decide whether to publish.

WHO IS SPEAKING
The transcript is speaker-labelled. Use the labels: do not infer from content who the tutor is. If a turn's speaker is genuinely unclear, do not attribute the content to anyone.

WHAT YOU MAY CLAIM
- Every statement must be supported by something in this transcript. If it is not in the transcript, it does not go in the write-up.
- Do not invent homework. Include an item in homework_assigned only if the tutor explicitly set it. If the tutor suggested revision without setting it, that belongs in next_lesson_recommendations instead. If nothing was set, return an empty array — that is a correct answer, not a gap to fill.
- Identify a weakness only where the transcript shows it: a wrong answer, a hesitation the tutor addressed, or the student saying they are unsure. Do not extrapolate from one slip to a general weakness.
- Where the transcript is ambiguous, preserve the ambiguity or leave the item out. Never resolve uncertainty by guessing.

WHAT YOU MUST NOT DO
- Do not make claims about intelligence, ability, potential, personality, mental health, attention, wellbeing or home circumstances. This applies to the private observations as much as to the student-facing text.
- Do not diagnose anything, formally or informally, and do not use clinical vocabulary.
- Do not compare the student to other students or to a norm.
- Do not comment on anything personal that was said in passing.

TONE OF THE STUDENT-FACING TEXT
The summary, strengths, areas for improvement, homework and next steps are read by the student.
- Address them directly, in the second person: "You correctly identified…", not "Sophia correctly identified…".
- Be clear, specific and evidence-based. Encouraging where warranted, and never flattering.
- Bad: "You are an amazing student who mastered everything today."
- Good: "You correctly identified the reaction mechanism in most of the examples discussed today. Review solvent effects before the next lesson."
- Name the actual thing. "Work on your understanding" says nothing; "protic versus aprotic solvents and their effect on the nucleophile" is useful.
- British English spelling.

THE PRIVATE OBSERVATIONS
tutor_private_observations is read only by the tutor. It may be more technical and diagnostic — about how the student approaches a problem, where their reasoning breaks down, what to try next lesson. It is still bound by every rule above about evidence and about not commenting on the person rather than the work.

Write nothing you would not be willing to defend by pointing at a line in the transcript.`;

export function buildUserPrompt(
  segments: TranscriptSegment[],
  context: AnalysisContext,
): string {
  const transcript = segments
    .map((s) => `[${formatTimestamp(s.startSeconds)}] ${s.speaker} (${s.role}): ${s.text}`)
    .join("\n");

  const history =
    context.previousLessonTitles.length > 0
      ? `\nPrevious lessons in this subject, most recent first:\n${context.previousLessonTitles
          .map((t) => `- ${t}`)
          .join("\n")}`
      : "";

  const flagged =
    context.previousAreasForImprovement.length > 0
      ? `\nPreviously flagged as needing work (note in the write-up whether this lesson shows any of it has held, but only if the transcript actually shows it):\n${context.previousAreasForImprovement
          .map((a) => `- ${a}`)
          .join("\n")}`
      : "";

  return `Subject: ${context.subjectDisplayName}
Tutor: ${context.tutorName}
Student: ${context.studentName} (address them as "you" in student-facing text)${history}${flagged}

TRANSCRIPT
${transcript}`;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
