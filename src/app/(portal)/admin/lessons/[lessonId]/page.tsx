import Link from "next/link";
import { notFound } from "next/navigation";

import { AIProcessingStatus } from "@/components/portal/processing-status";
import { FileList } from "@/components/portal/file-list";
import { LessonSummary } from "@/components/portal/lesson-summary";
import { TranscriptViewer } from "@/components/portal/transcript-viewer";
import { ChevronLeftIcon, ShieldIcon } from "@/components/ui/icons";
import { Badge, Card, KeyValue, Rule, SectionHead } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate, formatDuration, formatTime } from "@/lib/format";
import { parseMeetingLink } from "@/lib/meetings/links";

export const dynamic = "force-dynamic";

export default async function AdminLessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);

  const lesson = await repo.getLesson(lessonId);
  if (!lesson) notFound();

  const link = parseMeetingLink(lesson.meetingUrl);

  const [notes, transcript, files] = await Promise.all([
    repo.getLessonNotesForTutor(lessonId).catch(() => null),
    repo.getTranscript(lessonId).catch(() => null),
    repo.listLessonFiles(lessonId).catch(() => []),
  ]);

  const { tutorPrivateNotes, ...studentFacing } = notes ?? { tutorPrivateNotes: null };

  return (
    <div className="space-y-10">
      <div>
        <Link
          href="/admin/lessons"
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors hover:text-accent"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          All lessons
        </Link>
        <h1 className="mt-4 font-display text-3xl font-semibold">{lesson.title ?? "Lesson"}</h1>
        <p className="mt-2 text-ink-500">
          <Link
            href={`/admin/students/${lesson.studentId}`}
            className="hover:text-accent hover:underline"
          >
            {lesson.student.profile.fullName}
          </Link>{" "}
          · {lesson.tutor.profile.fullName} · {lesson.subject.displayName}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <AIProcessingStatus
            status={lesson.status}
            audience="staff"
            error={lesson.processingError}
          />
          <Badge tone={lesson.published ? "success" : "neutral"}>
            {lesson.published ? "Published to student" : "Not published"}
          </Badge>
        </div>
      </div>

      <Card>
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <KeyValue label="When">
            {formatDate(lesson.scheduledAt)} · {formatTime(lesson.scheduledAt)}
          </KeyValue>
          <KeyValue label="Length">{formatDuration(lesson.durationMinutes)}</KeyValue>
          <KeyValue label="Meeting">
            {link ? (
              <>
                {link.label}
                {link.code ? (
                  <>
                    {" · "}
                    <code className="font-mono text-sm">{link.code}</code>
                  </>
                ) : null}
              </>
            ) : (
              <span className="text-ink-300">No link set</span>
            )}
          </KeyValue>
          <KeyValue label="Notetaker">
            {lesson.notetakerEnabled ? "Requested" : "Not requested"}
          </KeyValue>
        </dl>
        {lesson.recallBotId ? (
          <p className="mt-5 text-xs text-ink-300">Bot reference: {lesson.recallBotId}</p>
        ) : null}
      </Card>

      <section>
        <SectionHead title="Write-up" />
        <LessonSummary notes={notes ? (studentFacing as typeof notes) : null} />
        {tutorPrivateNotes ? (
          <>
            <Rule className="my-8" />
            <div className="rounded-[14px] border border-rule bg-paper-2/50 p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <ShieldIcon className="h-4 w-4 text-ink-500" />
                Tutor&rsquo;s private notes
              </p>
              <p className="mt-1 text-xs text-ink-300">
                Visible to the tutor and to administrators. Never to the student or their parent.
              </p>
              <p className="mt-3 leading-relaxed whitespace-pre-line text-ink-700">
                {tutorPrivateNotes}
              </p>
            </div>
          </>
        ) : null}
      </section>

      {files.length > 0 ? (
        <section>
          <SectionHead title="Board & files" />
          <FileList files={files} />
        </section>
      ) : null}

      {transcript && transcript.processingStatus === "ready" && transcript.segments.length > 0 ? (
        <section>
          <SectionHead
            title="Transcript"
            description="Held for the retention period set in Settings. No playable recording is kept."
          />
          <TranscriptViewer
            segments={transcript.segments}
            tutorName={lesson.tutor.profile.fullName}
            studentName={lesson.student.profile.fullName}
          />
        </section>
      ) : null}
    </div>
  );
}
