import type { Metadata } from "next";

import { LessonCard } from "@/components/portal/lesson-cards";
import { SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";

export const metadata: Metadata = { title: "Lessons" };
export const dynamic = "force-dynamic";

export default async function ParentLessons() {
  const session = await requireRole("parent");
  const repo = await repositoryFor(session);

  const now = new Date().toISOString();
  const [upcoming, past] = await Promise.all([
    repo.listLessons({ status: "scheduled", from: now, order: "asc" }),
    repo.listLessons({ status: "published", to: now, order: "desc" }),
  ]);

  return (
    <div className="space-y-10">
      <SectionHead
        as="h1"
        title="Lessons"
        description="Lessons attended, and what is booked next."
      />

      {upcoming.length > 0 ? (
        <section>
          <h2 className="eyebrow mb-4">Coming up</h2>
          <ul className="space-y-3">
            {upcoming.map((lesson) => (
              <LessonCard key={lesson.id} lesson={lesson} role="parent" audience="student" />
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="eyebrow mb-4">Attended</h2>
        {past.length === 0 ? (
          <EmptyState
            title="No lessons yet"
            description="Once a tutor publishes a lesson write-up it will appear here."
          />
        ) : (
          <ul className="space-y-3">
            {past.map((lesson) => (
              <LessonCard key={lesson.id} lesson={lesson} role="parent" audience="student" />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
