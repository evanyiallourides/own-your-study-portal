import type { Metadata } from "next";

import { AssignmentForm, ToggleAssignmentButton } from "@/components/portal/admin-forms";
import { Badge, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Assignments" };
export const dynamic = "force-dynamic";

export default async function AdminAssignments() {
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);

  const [assignments, tutors, students, subjects] = await Promise.all([
    repo.listAssignments(),
    repo.listTutors(),
    repo.listStudents(),
    repo.listSubjects(),
  ]);

  const active = assignments.filter((a) => a.active);
  const revoked = assignments.filter((a) => !a.active);

  return (
    <div className="space-y-10">
      <SectionHead
        as="h1"
        title="Assignments"
        description="The access model in one table: who teaches whom, in what."
      />

      <AssignmentForm tutors={tutors} students={students} subjects={subjects} />

      <section>
        <SectionHead title="Active" />
        {active.length === 0 ? (
          <EmptyState
            title="No assignments yet"
            description="Until a tutor is assigned to a student in a subject, they cannot see anything about that student."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-rule">
                  <th scope="col" className="py-2.5 pr-4 font-semibold text-ink-500">Student</th>
                  <th scope="col" className="py-2.5 pr-4 font-semibold text-ink-500">Tutor</th>
                  <th scope="col" className="py-2.5 pr-4 font-semibold text-ink-500">Subject</th>
                  <th scope="col" className="py-2.5 pr-4 font-semibold text-ink-500">Since</th>
                  <th scope="col" className="py-2.5 font-semibold text-ink-500">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {active.map((a) => (
                  <tr key={a.id} className="border-b border-rule-soft">
                    <td className="py-3 pr-4 font-medium text-ink">
                      {a.student?.profile.fullName}
                    </td>
                    <td className="py-3 pr-4 text-ink-700">{a.tutor?.profile.fullName}</td>
                    <td className="py-3 pr-4 text-ink-700">{a.subject?.displayName}</td>
                    <td className="py-3 pr-4 text-ink-300">{formatDate(a.createdAt)}</td>
                    <td className="py-3 text-right">
                      <ToggleAssignmentButton assignmentId={a.id} active />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {revoked.length > 0 ? (
        <section>
          <SectionHead
            title="Revoked"
            description="Kept for the record. A revoked assignment grants no access at all."
          />
          <ul className="space-y-2.5">
            {revoked.map((a) => (
              <li key={a.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-ink-700">
                    {a.student?.profile.fullName} — {a.subject?.displayName}
                  </p>
                  <p className="text-sm text-ink-300">{a.tutor?.profile.fullName}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge>Revoked</Badge>
                  <ToggleAssignmentButton assignmentId={a.id} active={false} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
