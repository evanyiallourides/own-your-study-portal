import Link from "next/link";
import type { Metadata } from "next";

import { LessonCard } from "@/components/portal/lesson-cards";
import { SearchInput } from "@/components/portal/search-input";
import { SectionHead, cx } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { LESSON_STATUS } from "@/lib/status";
import { LESSON_STATUSES, type LessonStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Lessons" };
export const dynamic = "force-dynamic";

export default async function AdminLessons({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; tutor?: string; subject?: string }>;
}) {
  const { q, status, tutor, subject } = await searchParams;
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);

  const statusFilter = LESSON_STATUSES.includes(status as LessonStatus)
    ? (status as LessonStatus)
    : undefined;

  const [lessons, tutors, subjects] = await Promise.all([
    repo.listLessons({
      status: statusFilter,
      tutorId: tutor || undefined,
      subjectId: subject || undefined,
      search: q,
      order: "desc",
      limit: 100,
    }),
    repo.listTutors(),
    repo.listSubjects(),
  ]);

  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { q, status, tutor, subject, ...patch };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `/admin/lessons?${qs}` : "/admin/lessons";
  };

  return (
    <div className="space-y-8">
      <SectionHead
        as="h1"
        title="Lessons"
        description="Every lesson in the practice, with where it has got to in processing."
        action={<SearchInput placeholder="Search lessons" label="Search all lessons" />}
      />

      <div className="space-y-4">
        <nav aria-label="Filter by status">
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link
                href={href({ status: undefined })}
                aria-current={!statusFilter ? "true" : undefined}
                className={cx(
                  "inline-flex rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  !statusFilter
                    ? "border-accent bg-accent-wash text-accent"
                    : "border-rule bg-paper-3 text-ink-500 hover:border-ink-300 hover:text-ink",
                )}
              >
                All statuses
              </Link>
            </li>
            {LESSON_STATUSES.map((key) => (
              <li key={key}>
                <Link
                  href={href({ status: key })}
                  aria-current={statusFilter === key ? "true" : undefined}
                  className={cx(
                    "inline-flex rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                    statusFilter === key
                      ? "border-accent bg-accent-wash text-accent"
                      : "border-rule bg-paper-3 text-ink-500 hover:border-ink-300 hover:text-ink",
                  )}
                >
                  {LESSON_STATUS[key].label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex flex-wrap gap-2 text-sm">
          <span className="text-ink-300">Filter:</span>
          {tutors.map((t) => (
            <Link
              key={t.id}
              href={href({ tutor: tutor === t.id ? undefined : t.id })}
              className={cx(
                "rounded-full border px-2.5 py-0.5 transition-colors",
                tutor === t.id
                  ? "border-ink bg-ink text-paper"
                  : "border-rule text-ink-500 hover:border-ink-300",
              )}
            >
              {t.profile.fullName}
            </Link>
          ))}
          {subjects.map((s) => (
            <Link
              key={s.id}
              href={href({ subject: subject === s.id ? undefined : s.id })}
              className={cx(
                "rounded-full border px-2.5 py-0.5 transition-colors",
                subject === s.id
                  ? "border-ink bg-ink text-paper"
                  : "border-rule text-ink-500 hover:border-ink-300",
              )}
            >
              {s.displayName}
            </Link>
          ))}
        </div>
      </div>

      {lessons.length === 0 ? (
        <EmptyState
          title="Nothing matches those filters"
          description="Clear a filter, or try a student, tutor or topic in the search box."
        />
      ) : (
        <ul className="space-y-3">
          {lessons.map((lesson) => (
            <LessonCard key={lesson.id} lesson={lesson} role="admin" audience="tutor" />
          ))}
        </ul>
      )}
    </div>
  );
}
