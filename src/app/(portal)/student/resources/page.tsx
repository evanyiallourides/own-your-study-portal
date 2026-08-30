import Link from "next/link";
import type { Metadata } from "next";

import { FileList } from "@/components/portal/file-list";
import { SearchInput } from "@/components/portal/search-input";
import { Rule, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Resources" };
export const dynamic = "force-dynamic";

/** Everything uploaded across every published lesson, newest lesson first —
 *  so a worksheet from six weeks ago is findable without remembering which
 *  lesson it came from. */
export default async function StudentResources({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = await requireRole("student");
  const repo = await repositoryFor(session);
  const studentId = session.studentId ?? undefined;

  const lessons = await repo.listLessons({ studentId, status: "published", order: "desc" });
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
        description="Boards, worksheets and anything else your tutors have shared."
        action={<SearchInput placeholder="Search resources" label="Search your resources" />}
      />

      {withFiles.length === 0 ? (
        <EmptyState
          title={term ? "Nothing matched that" : "No resources yet"}
          description={
            term
              ? "Try a file name, a lesson title or a subject."
              : "When your tutor uploads the lesson board or a worksheet, it will be collected here."
          }
        />
      ) : (
        <div className="space-y-10">
          {withFiles.map(({ lesson, files }, i) => (
            <section key={lesson.id}>
              {i > 0 ? <Rule className="mb-8" /> : null}
              <div className="mb-4">
                <Link
                  href={`/student/lessons/${lesson.id}`}
                  className="font-display text-lg font-semibold text-ink hover:text-accent hover:underline"
                >
                  {lesson.title ?? "Lesson"}
                </Link>
                <p className="text-sm text-ink-300">
                  {lesson.subject.displayName} · {formatDate(lesson.scheduledAt)}
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
