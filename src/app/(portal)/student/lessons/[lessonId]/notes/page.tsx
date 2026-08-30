import type { Metadata } from "next";

import { LessonSummary } from "@/components/portal/lesson-summary";
import { loadLessonNotes } from "@/lib/data/cached";

export const metadata: Metadata = { title: "Lesson notes" };
export const dynamic = "force-dynamic";

export default async function StudentLessonNotes({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const notes = await loadLessonNotes(lessonId).catch(() => null);
  return <LessonSummary notes={notes} />;
}
