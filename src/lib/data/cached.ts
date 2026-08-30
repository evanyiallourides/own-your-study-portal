import "server-only";

import { cache } from "react";

import { getRepository } from "@/lib/data";
import type { LessonFile, LessonNotes, LessonWithContext, Transcript } from "@/lib/types";

/* ==========================================================================
   Per-request memoisation
   --------------------------------------------------------------------------
   A lesson page renders its header in a layout and its body in a page, and
   both need the same lesson. React's cache() keyed on the id means one query
   serves both rather than two identical round trips per navigation.
   ========================================================================== */

export const loadLesson = cache(async (lessonId: string): Promise<LessonWithContext | null> => {
  const repo = await getRepository();
  return repo.getLesson(lessonId);
});

export const loadLessonNotes = cache(async (lessonId: string): Promise<LessonNotes | null> => {
  const repo = await getRepository();
  return repo.getLessonNotes(lessonId);
});

export const loadTranscript = cache(async (lessonId: string): Promise<Transcript | null> => {
  const repo = await getRepository();
  return repo.getTranscript(lessonId);
});

export const loadLessonFiles = cache(async (lessonId: string): Promise<LessonFile[]> => {
  const repo = await getRepository();
  return repo.listLessonFiles(lessonId);
});
