import type { Metadata } from "next";

import { HomeworkList } from "@/components/portal/homework-list";
import { Rule, SectionHead } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { relativeDayLabel } from "@/lib/format";

export const metadata: Metadata = { title: "Homework" };
export const dynamic = "force-dynamic";

export default async function StudentHomeworkPage() {
  const session = await requireRole("student");
  const repo = await repositoryFor(session);
  const studentId = session.studentId ?? undefined;

  const all = await repo.listHomework({ studentId });
  const open = all.filter((h) => !h.completed);
  const done = all.filter((h) => h.completed);

  const dueLabels = Object.fromEntries(
    all.filter((h) => h.dueAt).map((h) => [h.id, `Due ${relativeDayLabel(h.dueAt!)}`]),
  );

  return (
    <div className="space-y-10">
      <SectionHead
        as="h1"
        title="Homework"
        description="Everything your tutors set, collected from your published lessons. Tick things off as you go."
      />

      <section>
        <h2 className="eyebrow mb-4">Outstanding</h2>
        <HomeworkList items={open} dueLabels={dueLabels} />
      </section>

      {done.length > 0 ? (
        <>
          <Rule />
          <section>
            <h2 className="eyebrow mb-4">Done</h2>
            <HomeworkList items={done} dueLabels={dueLabels} />
          </section>
        </>
      ) : null}
    </div>
  );
}
