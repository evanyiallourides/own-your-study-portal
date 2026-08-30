import type { Metadata } from "next";

import { LessonCard } from "@/components/portal/lesson-cards";
import { ScheduleLessonForm } from "@/components/portal/schedule-lesson-form";
import { SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireTeachingAccess } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatWeekday, formatShortDate } from "@/lib/format";
import { googleStateFor } from "@/lib/google/status";

export const metadata: Metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

export default async function TutorSchedule() {
  const session = await requireTeachingAccess();
  const repo = await repositoryFor(session);
  const tutorId = session.tutorId;
  if (!tutorId) return null;

  const now = new Date().toISOString();
  const [upcoming, assignments, settings, google] = await Promise.all([
    repo.listLessons({ tutorId, from: now, status: "scheduled", order: "asc" }),
    repo.listAssignments({ tutorId }),
    repo.getSettings(),
    googleStateFor(session.profile.id),
  ]);

  // Group by calendar day so a week reads as a week rather than as a list.
  const days = new Map<string, typeof upcoming>();
  for (const lesson of upcoming) {
    const key = lesson.scheduledAt.slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), lesson]);
  }

  return (
    <div className="space-y-10">
      <SectionHead
        as="h1"
        title="Schedule"
        description="What is booked, and where you add a new lesson."
      />

      <ScheduleLessonForm
        assignments={assignments}
        tutorId={tutorId}
        notetakerAvailable={settings.notetakerEnabledGlobally}
        google={google}
      />

      <section>
        <SectionHead title="Coming up" />
        {upcoming.length === 0 ? (
          <EmptyState
            title="Nothing booked"
            description="Lessons you schedule will be listed here, grouped by day."
          />
        ) : (
          <div className="space-y-8">
            {[...days.entries()].map(([day, lessons]) => (
              <div key={day}>
                <h3 className="eyebrow mb-3">
                  {formatWeekday(lessons[0]!.scheduledAt)} · {formatShortDate(lessons[0]!.scheduledAt)}
                </h3>
                <ul className="space-y-3">
                  {lessons.map((lesson) => (
                    <LessonCard key={lesson.id} lesson={lesson} role="tutor" audience="tutor" />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
