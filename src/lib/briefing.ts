/* ==========================================================================
   Pre-lesson briefing
   --------------------------------------------------------------------------
   Assembled from what has already been written down — the previous lesson's
   notes and the student's outstanding homework — not from a fresh model call.
   That keeps it instant, free, and honest: everything on the card is something
   a tutor previously reviewed and published.
   ========================================================================== */

import type { Repository } from "@/lib/data/repository";
import type { LessonWithContext, PreLessonBriefing } from "@/lib/types";

export async function buildBriefing(
  repo: Repository,
  lesson: LessonWithContext,
): Promise<PreLessonBriefing> {
  const [history, homework] = await Promise.all([
    repo.listLessons({
      studentId: lesson.studentId,
      subjectId: lesson.subjectId,
      status: "published",
      to: lesson.scheduledAt,
      order: "desc",
      limit: 3,
    }),
    repo.listHomework({ studentId: lesson.studentId, completed: false }),
  ]);

  const lastLesson = history[0] ?? null;
  if (!lastLesson) {
    return {
      lesson,
      lastLesson: null,
      lastTopics: [],
      needsReinforcement: [],
      openHomework: [],
      suggestedCheck: null,
      suggestedNextTopics: [],
    };
  }

  const lastNotes = await repo.getLessonNotes(lastLesson.id);

  // Anything flagged twice across the recent history is a pattern rather than
  // a bad day, so those come first.
  const recentNotes = await Promise.all(history.map((l) => repo.getLessonNotes(l.id)));
  const flagged = new Map<string, number>();
  for (const notes of recentNotes) {
    for (const area of notes?.areasForImprovement ?? []) {
      flagged.set(area, (flagged.get(area) ?? 0) + 1);
    }
  }
  const needsReinforcement = [...flagged.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([area]) => area)
    .slice(0, 4);

  const openHomework = homework
    .filter((h) => h.subjectId === lesson.subjectId)
    .map((h) => h.description);

  // The suggested check is the first area for improvement turned into a
  // question the tutor can actually ask. No model involved — it is a sentence
  // frame, and the UI presents it as a prompt rather than as advice.
  const firstArea = lastNotes?.areasForImprovement[0] ?? null;
  const suggestedCheck = firstArea
    ? `Ask ${lesson.student.profile.firstName} to explain ${lowerFirst(stripTrailingStop(firstArea))}.`
    : null;

  return {
    lesson,
    lastLesson,
    lastTopics: lastNotes?.topicsCovered ?? [],
    needsReinforcement,
    openHomework,
    suggestedCheck,
    suggestedNextTopics: lastNotes?.nextSteps ?? [],
  };
}

function stripTrailingStop(text: string): string {
  return text.replace(/\.$/, "");
}

function lowerFirst(text: string): string {
  if (!text) return text;
  // Leave acronyms and chemical names alone — "SN2" must not become "sN2".
  if (text.slice(0, 2) === text.slice(0, 2).toUpperCase() && text.length > 1) return text;
  return text[0]!.toLowerCase() + text.slice(1);
}
