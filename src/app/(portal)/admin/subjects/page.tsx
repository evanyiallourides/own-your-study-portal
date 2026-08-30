import type { Metadata } from "next";

import { ArchiveSubjectButton, SubjectForm } from "@/components/portal/admin-forms";
import { Badge, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";

export const metadata: Metadata = { title: "Subjects" };
export const dynamic = "force-dynamic";

export default async function AdminSubjects() {
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);
  const subjects = await repo.listSubjects(true);

  const live = subjects.filter((s) => !s.archived);
  const archived = subjects.filter((s) => s.archived);

  return (
    <div className="space-y-10">
      <SectionHead
        as="h1"
        title="Subjects"
        description="The catalogue lessons and assignments are built from."
      />

      {live.length === 0 ? (
        <EmptyState
          title="No subjects yet"
          description="Add the first subject below — for example IB Chemistry HL."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {live.map((subject) => (
            <li
              key={subject.id}
              className="card flex items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{subject.displayName}</p>
                <p className="text-xs text-ink-300">
                  {subject.curriculum}
                  {subject.level ? ` · ${subject.level}` : ""}
                </p>
              </div>
              <ArchiveSubjectButton subject={subject} />
            </li>
          ))}
        </ul>
      )}

      <SubjectForm />

      {archived.length > 0 ? (
        <section>
          <SectionHead
            title="Archived"
            description="Kept so historic lessons still make sense, but not offered for new assignments."
          />
          <ul className="grid gap-3 sm:grid-cols-2">
            {archived.map((subject) => (
              <li
                key={subject.id}
                className="card flex items-center justify-between gap-3 p-4 opacity-70"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{subject.displayName}</p>
                  <Badge>Archived</Badge>
                </div>
                <ArchiveSubjectButton subject={subject} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
