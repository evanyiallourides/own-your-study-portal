import Link from "next/link";
import type { Metadata } from "next";

import { InviteForm, ToggleActiveButton } from "@/components/portal/admin-forms";
import { SearchInput } from "@/components/portal/search-input";
import { Avatar, Badge, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Students" };
export const dynamic = "force-dynamic";

export default async function AdminStudents({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);

  const [students, assignments] = await Promise.all([
    repo.listStudents(q),
    repo.listAssignments(),
  ]);

  return (
    <div className="space-y-10">
      <SectionHead
        as="h1"
        title="Students"
        description="Everyone learning with the practice."
        action={<SearchInput placeholder="Search students" label="Search students" />}
      />

      {students.length === 0 ? (
        <EmptyState
          title={q ? "Nothing matched that" : "No students yet"}
          description={
            q ? "Try a name, an email address or a school." : "Invite your first student below."
          }
        />
      ) : (
        <ul className="space-y-3">
          {students.map((student) => {
            const theirs = assignments.filter((a) => a.studentId === student.id && a.active);
            return (
              <li key={student.id} className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-3">
                    <Avatar name={student.profile.fullName} size={40} />
                    <div className="min-w-0">
                      <Link
                        href={`/admin/students/${student.id}`}
                        className="font-display text-lg font-semibold text-ink hover:text-accent hover:underline"
                      >
                        {student.profile.fullName}
                      </Link>
                      <p className="truncate text-sm text-ink-500">{student.profile.email}</p>
                      <p className="mt-0.5 text-xs text-ink-300">
                        {[student.programme, student.yearLevel, student.school]
                          .filter(Boolean)
                          .join(" · ") || "No programme recorded"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {student.profile.active ? null : <Badge tone="danger">Deactivated</Badge>}
                    <ToggleActiveButton
                      profileId={student.profileId}
                      active={student.profile.active}
                      name={student.profile.firstName}
                    />
                  </div>
                </div>

                {theirs.length > 0 ? (
                  <ul className="mt-4 flex flex-wrap gap-1.5">
                    {theirs.map((a) => (
                      <li
                        key={a.id}
                        className="rounded-full border border-rule bg-paper-2 px-2.5 py-0.5 text-xs text-ink-500"
                      >
                        {a.subject?.displayName} — {a.tutor?.profile.fullName}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-xs font-medium text-warning">
                    No tutor assigned — this student cannot have lessons yet.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <InviteForm role="student" demo={isDemoMode()} heading="Invite a student" />
    </div>
  );
}
