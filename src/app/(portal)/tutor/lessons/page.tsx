import Link from "next/link";
import type { Metadata } from "next";

import { LessonCard } from "@/components/portal/lesson-cards";
import { SearchInput } from "@/components/portal/search-input";
import { SectionHead, cx } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireTeachingAccess } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { LESSON_STATUSES, type LessonStatus } from "@/lib/types";
import { LESSON_STATUS } from "@/lib/status";

export const metadata: Metadata = { title: "Lessons" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "review_required", label: "To review" },
  { key: "published", label: "Published" },
  { key: "scheduled", label: "Upcoming" },
] as const;

export default async function TutorLessons({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const session = await requireTeachingAccess();
  const repo = await repositoryFor(session);
  const tutorId = session.tutorId ?? undefined;

  const active = FILTERS.some((f) => f.key === status) ? status! : "all";
  const statusFilter =
    active !== "all" && LESSON_STATUSES.includes(active as LessonStatus)
      ? (active as LessonStatus)
      : undefined;

  const lessons = await repo.listLessons({
    tutorId,
    status: statusFilter,
    search: q,
    order: active === "scheduled" ? "asc" : "desc",
  });

  const buildHref = (key: string) => {
    const params = new URLSearchParams();
    if (key !== "all") params.set("status", key);
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/tutor/lessons?${qs}` : "/tutor/lessons";
  };

  return (
    <div className="space-y-8">
      <SectionHead
        as="h1"
        title="Lessons"
        description="Every lesson you teach, in every subject you are assigned to."
        action={<SearchInput placeholder="Search lessons" label="Search your lessons" />}
      />

      <nav aria-label="Filter lessons">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <li key={filter.key}>
              <Link
                href={buildHref(filter.key)}
                aria-current={active === filter.key ? "true" : undefined}
                className={cx(
                  "inline-flex rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  active === filter.key
                    ? "border-accent bg-accent-wash text-accent"
                    : "border-rule bg-paper-3 text-ink-500 hover:border-ink-300 hover:text-ink",
                )}
              >
                {filter.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {lessons.length === 0 ? (
        <EmptyState
          title={q ? "Nothing matched that" : "No lessons here"}
          description={
            q
              ? "Try a student's name, a subject or a topic."
              : active === "review_required"
                ? "Nothing is waiting on you. Write-ups appear here after a lesson has been transcribed and analysed."
                : "Lessons appear here once they are scheduled."
          }
        />
      ) : (
        <ul className="space-y-3">
          {lessons.map((lesson) => (
            <LessonCard key={lesson.id} lesson={lesson} role="tutor" audience="tutor" />
          ))}
        </ul>
      )}

      {active === "all" && lessons.length > 0 ? (
        <p className="text-xs text-ink-300">
          Statuses: {Object.values(LESSON_STATUS).map((s) => s.label).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
