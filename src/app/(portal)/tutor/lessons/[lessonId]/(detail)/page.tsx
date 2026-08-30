import Link from "next/link";
import { notFound } from "next/navigation";

import { ShieldIcon } from "@/components/ui/icons";
import { Card, NoteList, Rule } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireTeachingAccess } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { loadLesson } from "@/lib/data/cached";
import { formatOffset } from "@/lib/format";
import { loadTranscript } from "@/lib/data/cached";

export const dynamic = "force-dynamic";

export default async function TutorLessonOverview({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const session = await requireTeachingAccess();
  const repo = await repositoryFor(session);

  const lesson = await loadLesson(lessonId);
  if (!lesson) notFound();

  const [notes, transcript] = await Promise.all([
    repo.getLessonNotesForTutor(lessonId).catch(() => null),
    loadTranscript(lessonId).catch(() => null),
  ]);

  if (!notes) {
    return (
      <EmptyState
        title={
          lesson.status === "scheduled"
            ? "This lesson has not happened yet"
            : "Nothing written up yet"
        }
        description={
          lesson.status === "scheduled"
            ? "After the lesson, the transcript and a draft write-up will appear here for you to review."
            : "You can write this lesson up by hand from the review page."
        }
        action={
          <Link
            href={`/tutor/lessons/${lessonId}/review`}
            className="text-sm font-semibold text-accent hover:underline"
          >
            Open the write-up
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-8">
      {notes.summary ? (
        <section>
          <h2 className="font-display text-lg font-semibold">Summary</h2>
          <div className="prose-notes mt-3 max-w-[64ch] leading-relaxed text-ink-700">
            {notes.summary.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {notes.strengths.length > 0 ? (
          <Card>
            <p className="eyebrow mb-3">Went well</p>
            <NoteList items={notes.strengths} tone="accent" />
          </Card>
        ) : null}
        {notes.areasForImprovement.length > 0 ? (
          <Card>
            <p className="eyebrow mb-3">Needs work</p>
            <NoteList items={notes.areasForImprovement} tone="warning" />
          </Card>
        ) : null}
        {notes.misconceptions.length > 0 ? (
          <Card>
            <p className="eyebrow mb-3">Misconceptions</p>
            <NoteList items={notes.misconceptions} tone="warning" />
          </Card>
        ) : null}
        {notes.homework.length > 0 ? (
          <Card>
            <p className="eyebrow mb-3">Homework set</p>
            <NoteList items={notes.homework} />
          </Card>
        ) : null}
      </div>

      {notes.tutorPrivateNotes ? (
        <>
          <Rule />
          <section className="rounded-[14px] border border-rule bg-paper-2/50 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ShieldIcon className="h-4 w-4 text-ink-500" />
              Private notes
            </p>
            <p className="mt-1 text-xs text-ink-300">
              Not visible to {lesson.student.profile.firstName} or their parent.
            </p>
            <p className="mt-3 leading-relaxed whitespace-pre-line text-ink-700">
              {notes.tutorPrivateNotes}
            </p>
          </section>
        </>
      ) : null}

      {transcript && transcript.processingStatus === "ready" ? (
        <>
          <Rule />
          <Link
            href={`/tutor/lessons/${lessonId}/transcript`}
            className="card card-interactive block p-4"
          >
            <p className="font-semibold text-ink">Transcript</p>
            <p className="mt-1 text-sm text-ink-500">
              {transcript.segments.length} turns
              {transcript.durationSeconds ? ` · ${formatOffset(transcript.durationSeconds)}` : ""} ·
              searchable.
            </p>
          </Link>
        </>
      ) : null}
    </div>
  );
}
