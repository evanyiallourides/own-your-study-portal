import type { Metadata } from "next";

import { HomeworkList } from "@/components/portal/homework-list";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { relativeDayLabel } from "@/lib/format";

export const metadata: Metadata = { title: "Homework" };
export const dynamic = "force-dynamic";

export default async function StudentLessonHomework({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const session = await requireRole("student");
  const repo = await repositoryFor(session);

  const all = await repo.listHomework({ studentId: session.studentId ?? undefined });
  const items = all.filter((h) => h.lessonId === lessonId);
  const dueLabels = Object.fromEntries(
    items.filter((h) => h.dueAt).map((h) => [h.id, `Due ${relativeDayLabel(h.dueAt!)}`]),
  );

  return (
    <HomeworkList
      items={items}
      dueLabels={dueLabels}
      emptyTitle="No homework from this lesson"
      emptyDescription="Your tutor did not set anything from this session."
    />
  );
}
