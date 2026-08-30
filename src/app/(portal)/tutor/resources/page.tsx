import Link from "next/link";
import type { Metadata } from "next";

import { FileList } from "@/components/portal/file-list";
import { SearchInput } from "@/components/portal/search-input";
import { Rule, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireTeachingAccess } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Resources" };
export const dynamic = "force-dynamic";

export default async function TutorResources({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = await requireTeachingAccess();
  const repo = await repositoryFor(session);
  const tutorId = session.tutorId ?? undefined;

  const lessons = await repo.listLessons({ tutorId, order: "desc", limit: 40 });
  const groups = await Promise.all(
    lessons.map(async (lesson) => ({
      lesson,
      files: await repo.listLessonFiles(lesson.id).catch(() => []),
    })),
  );

  const term = q?.trim().toLowerCase() ?? "";
  const withFiles = groups
    .map((group) => ({
      ...group,
      files: term
        ? group.files.filter(
            (f) =>
              f.fileName.toLowerCase().includes(term) ||
              (group.lesson.title ?? "").toLowerCase().includes(term) ||
              group.lesson.student.profile.fullName.toLowerCase().includes(term) ||
              group.lesson.subject.displayName.toLowerCase().includes(term),
          )
        : group.files,
    }))
    .filter((group) => group.files.length > 0);

  return (
    <div className="space-y-10">
      <SectionHead
        as="h1"
        title="Resources"
        description="Everything you have uploaded, newest lesson first."
        action={<SearchInput placeholder="Search resources" label="Search your resources" />}
      />

      {withFiles.length === 0 ? (
        <EmptyState
          title={term ? "Nothing matched that" : "No resources yet"}
          description={
            term
              ? "Try a file name, a student, a lesson or a subject."
              : "Uploads live on each lesson's Board & files tab, and are collected here."
          }
        />
      ) : (
        <div className="space-y-10">
          {withFiles.map(({ lesson, files }, i) => (
            <section key={lesson.id}>
              {i > 0 ? <Rule className="mb-8" /> : null}
              <div className="mb-4">
                <Link
                  href={`/tutor/lessons/${lesson.id}/files`}
                  className="font-display text-lg font-semibold text-ink hover:text-accent hover:underline"
                >
                  {lesson.title ?? "Lesson"}
                </Link>
                <p className="text-sm text-ink-300">
                  {lesson.student.profile.fullName} · {lesson.subject.displayName} ·{" "}
                  {formatDate(lesson.scheduledAt)}
                </p>
              </div>
              <FileList files={files} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
