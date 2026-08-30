import Link from "next/link";
import { notFound } from "next/navigation";

import { LessonCard } from "@/components/portal/lesson-cards";
import { ToggleAssignmentButton } from "@/components/portal/admin-forms";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { Avatar, Badge, Card, KeyValue, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminStudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);

  const student = await repo.getStudent(studentId);
  if (!student) notFound();

  const [assignments, subjects, lessons] = await Promise.all([
    repo.listAssignments({ studentId }),
    repo.listStudentSubjects(studentId),
    repo.listLessons({ studentId, order: "desc", limit: 20 }),
  ]);

  const consent = student.consent;
  const consentComplete =
    consent.aiNotetakerConsent &&
    consent.transcriptionConsent &&
    (!consent.guardianConsentRequired || consent.guardianConsentReceived);

  return (
    <div className="space-y-10">
      <div>
        <Link
          href="/admin/students"
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors hover:text-accent"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Students
        </Link>
        <header className="mt-4 flex flex-wrap items-center gap-4">
          <Avatar name={student.profile.fullName} size={56} />
          <div>
            <h1 className="font-display text-3xl font-semibold">{student.profile.fullName}</h1>
            <p className="mt-1 text-ink-500">{student.profile.email}</p>
          </div>
        </header>
      </div>

      <Card>
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <KeyValue label="Programme">{student.programme ?? "—"}</KeyValue>
          <KeyValue label="Year">{student.yearLevel ?? "—"}</KeyValue>
          <KeyValue label="School">{student.school ?? "—"}</KeyValue>
          <KeyValue label="Timezone">{student.timezone}</KeyValue>
        </dl>
      </Card>

      <section>
        <SectionHead
          title="Consent"
          description="Recording a lesson needs each of these. The notetaker will not be scheduled until they are all satisfied."
        />
        <Card>
          <ul className="space-y-3">
            {[
              { label: "AI Notetaker", value: consent.aiNotetakerConsent },
              { label: "Transcription", value: consent.transcriptionConsent },
              {
                label: "Guardian consent",
                value: consent.guardianConsentRequired ? consent.guardianConsentReceived : true,
                note: consent.guardianConsentRequired ? undefined : "Not required for this student",
              },
              {
                label: "Transcript visible to student",
                value: student.transcriptAccessEnabled,
              },
            ].map((row) => (
              <li key={row.label} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ink-700">
                  {row.label}
                  {row.note ? <span className="ml-2 text-xs text-ink-300">{row.note}</span> : null}
                </span>
                <Badge tone={row.value ? "success" : "warning"}>
                  {row.value ? "Recorded" : "Not recorded"}
                </Badge>
              </li>
            ))}
          </ul>

          <p className="mt-5 text-sm text-ink-500">
            {consent.consentTimestamp
              ? `Last recorded ${formatDate(consent.consentTimestamp)}.`
              : "No consent has been recorded yet."}{" "}
            {consentComplete
              ? "The notetaker may be scheduled for this student."
              : "The notetaker will not be scheduled until the outstanding items are recorded."}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-ink-300">
            Accepting general terms is not consent to record a lesson. These flags should be set
            only when explicit, informed permission has been given by the student and, where
            required, by their guardian — and you should keep your own record of how it was
            obtained.
          </p>
        </Card>
      </section>

      <section>
        <SectionHead title="Subjects and tutors" />
        {assignments.length === 0 ? (
          <EmptyState
            title="No tutor assigned"
            description="Create an assignment so a tutor can teach this student. Until then no lessons can be scheduled."
          />
        ) : (
          <ul className="space-y-2.5">
            {assignments.map((a) => (
              <li
                key={a.id}
                className="card flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <p className="font-medium text-ink">{a.subject?.displayName}</p>
                  <p className="text-sm text-ink-500">{a.tutor?.profile.fullName}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={a.active ? "success" : "neutral"}>
                    {a.active ? "Active" : "Revoked"}
                  </Badge>
                  <ToggleAssignmentButton assignmentId={a.id} active={a.active} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {subjects.length > assignments.filter((a) => a.active).length ? (
          <p className="mt-3 text-sm text-ink-300">
            Subjects on record: {subjects.map((s) => s.displayName).join(", ")}
          </p>
        ) : null}
      </section>

      <section>
        <SectionHead title="Lessons" />
        {lessons.length === 0 ? (
          <EmptyState title="No lessons yet" description="Scheduled lessons will appear here." />
        ) : (
          <ul className="space-y-3">
            {lessons.map((lesson) => (
              <LessonCard key={lesson.id} lesson={lesson} role="admin" audience="tutor" />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
