import Link from "next/link";
import { notFound } from "next/navigation";

import { NoteList, Rule } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { loadLesson, loadLessonFiles, loadLessonNotes, loadTranscript } from "@/lib/data/cached";
import { formatOffset } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Overview: the short answer to "what did I learn?". The complete write-up is
 *  one tab across, so this page stays readable in a minute. */
export default async function StudentLessonOverview({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const lesson = await loadLesson(lessonId);
  if (!lesson) notFound();

  const [notes, transcript, files] = await Promise.all([
    loadLessonNotes(lessonId).catch(() => null),
    loadTranscript(lessonId).catch(() => null),
    loadLessonFiles(lessonId).catch(() => []),
  ]);

  if (!notes) {
    return (
      <EmptyState
        title={
          lesson.status === "scheduled"
            ? "This lesson has not happened yet"
            : "Notes are not ready yet"
        }
        description={
          lesson.status === "scheduled"
            ? "Your notes, the transcript and anything from the board will appear here after the lesson."
            : "Your tutor is writing this lesson up. It will appear here once they have published it."
        }
      />
    );
  }

  const base = `/student/lessons/${lessonId}`;

  return (
    <div className="space-y-8">
      {notes.summary ? (
        <section>
          <h2 className="font-display text-lg font-semibold">Lesson summary</h2>
          <div className="prose-notes mt-3 max-w-[64ch] text-[1.0625rem] leading-relaxed text-ink-700">
            {notes.summary.split(/\n{2,}/).map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </section>
      ) : null}

      {notes.topicsCovered.length > 0 ? (
        <>
          <Rule />
          <section>
            <h2 className="font-display text-lg font-semibold">Topics covered</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {notes.topicsCovered.map((topic) => (
                <li
                  key={topic}
                  className="rounded-full border border-rule bg-paper-2 px-3 py-1 text-sm text-ink-700"
                >
                  {topic}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      {notes.strengths.length > 0 ? (
        <>
          <Rule />
          <section>
            <h2 className="font-display text-lg font-semibold">What you did well</h2>
            <div className="mt-3">
              <NoteList items={notes.strengths.slice(0, 3)} tone="accent" />
            </div>
          </section>
        </>
      ) : null}

      {notes.areasForImprovement.length > 0 ? (
        <>
          <Rule />
          <section>
            <h2 className="font-display text-lg font-semibold">Areas to work on</h2>
            <div className="mt-3">
              <NoteList items={notes.areasForImprovement} tone="warning" />
            </div>
          </section>
        </>
      ) : null}

      <Rule />

      <nav aria-label="More from this lesson" className="grid gap-3 sm:grid-cols-3">
        <Link href={`${base}/notes`} className="card card-interactive p-4">
          <p className="font-semibold text-ink">Full write-up</p>
          <p className="mt-1 text-sm text-ink-500">
            Key concepts, misconceptions, homework and next steps.
          </p>
        </Link>

        {transcript && transcript.processingStatus === "ready" ? (
          <Link href={`${base}/transcript`} className="card card-interactive p-4">
            <p className="font-semibold text-ink">Transcript</p>
            <p className="mt-1 text-sm text-ink-500">
              {transcript.segments.length} turns
              {transcript.durationSeconds
                ? ` · ${formatOffset(transcript.durationSeconds)}`
                : ""}{" "}
              · searchable.
            </p>
          </Link>
        ) : null}

        {files.length > 0 ? (
          <Link href={`${base}/files`} className="card card-interactive p-4">
            <p className="font-semibold text-ink">Board &amp; files</p>
            <p className="mt-1 text-sm text-ink-500">
              {files.length} {files.length === 1 ? "item" : "items"} from this lesson.
            </p>
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
