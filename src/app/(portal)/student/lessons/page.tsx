import type { Metadata } from "next";

import { LessonCard } from "@/components/portal/lesson-cards";
import { SearchInput } from "@/components/portal/search-input";
import { SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";

export const metadata: Metadata = { title: "Lessons" };
export const dynamic = "force-dynamic";

export default async function StudentLessons({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = await requireRole("student");
  const repo = await repositoryFor(session);
  const studentId = session.studentId ?? undefined;

  const now = new Date().toISOString();
  const [upcoming, past] = await Promise.all([
    repo.listLessons({ studentId, from: now, status: "scheduled", order: "asc", search: q }),
    repo.listLessons({ studentId, to: now, order: "desc", search: q }),
  ]);

  const searching = Boolean(q?.trim());

  return (
    <div className="space-y-10">
      <SectionHead
        as="h1"
        title="Lessons"
        description="Everything booked and everything written up, newest first."
        action={<SearchInput placeholder="Search lessons" label="Search your lessons" />}
      />

      {upcoming.length > 0 ? (
        <section>
          <h2 className="eyebrow mb-4">Coming up</h2>
          <ul className="space-y-3">
            {upcoming.map((lesson) => (
              <LessonCard key={lesson.id} lesson={lesson} role="student" audience="student" />
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="eyebrow mb-4">{searching ? "Results" : "Past lessons"}</h2>
        {past.length === 0 ? (
          <EmptyState
            title={searching ? "Nothing matched that" : "No lessons yet"}
            description={
              searching
                ? "Try a topic, a subject or a tutor's name."
                : "Once your tutor publishes your first lesson, your notes, transcript and resources will appear here."
            }
          />
        ) : (
          <ul className="space-y-3">
            {past.map((lesson) => (
              <LessonCard key={lesson.id} lesson={lesson} role="student" audience="student" />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
