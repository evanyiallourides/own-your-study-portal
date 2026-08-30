import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { TranscriptViewer } from "@/components/portal/transcript-viewer";
import { EmptyState } from "@/components/ui/states";
import { loadLesson, loadTranscript } from "@/lib/data/cached";

export const metadata: Metadata = { title: "Transcript" };
export const dynamic = "force-dynamic";

export default async function StudentLessonTranscript({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const lesson = await loadLesson(lessonId);
  if (!lesson) notFound();

  const transcript = await loadTranscript(lessonId).catch(() => null);

  if (!transcript || transcript.processingStatus !== "ready" || transcript.segments.length === 0) {
    return (
      <EmptyState
        title="No transcript for this lesson"
        description="A transcript is only created when the AI Notetaker joined the lesson and consent was in place. Your tutor can tell you whether one is expected."
      />
    );
  }

  return (
    <TranscriptViewer
      segments={transcript.segments}
      tutorName={lesson.tutor.profile.fullName}
      studentName={lesson.student.profile.fullName}
    />
  );
}
