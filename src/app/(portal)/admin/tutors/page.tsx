import type { Metadata } from "next";

import { InviteForm, ToggleActiveButton } from "@/components/portal/admin-forms";
import { SearchInput } from "@/components/portal/search-input";
import { Avatar, Badge, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { isDemoMode } from "@/lib/env";
import { pluralise } from "@/lib/format";

export const metadata: Metadata = { title: "Tutors" };
export const dynamic = "force-dynamic";

export default async function AdminTutors({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = await requireRole("admin");
  const repo = await repositoryFor(session);

  const [tutors, assignments] = await Promise.all([repo.listTutors(q), repo.listAssignments()]);

  return (
    <div className="space-y-10">
      <SectionHead
        as="h1"
        title="Tutors"
        description="Who teaches, and who they are allowed to see."
        action={<SearchInput placeholder="Search tutors" label="Search tutors" />}
      />

      {tutors.length === 0 ? (
        <EmptyState
          title={q ? "Nothing matched that" : "No tutors yet"}
          description={q ? "Try a name or an email address." : "Invite your first tutor below."}
        />
      ) : (
        <ul className="space-y-3">
          {tutors.map((tutor) => {
            const theirs = assignments.filter((a) => a.tutorId === tutor.id && a.active);
            const studentCount = new Set(theirs.map((a) => a.studentId)).size;
            return (
              <li key={tutor.id} className="card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-3">
                    <Avatar name={tutor.profile.fullName} size={40} />
                    <div className="min-w-0">
                      <p className="font-display text-lg font-semibold text-ink">
                        {tutor.profile.fullName}
                      </p>
                      <p className="truncate text-sm text-ink-500">{tutor.profile.email}</p>
                      {tutor.headline ? (
                        <p className="mt-0.5 text-xs text-ink-300">{tutor.headline}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <Badge tone={tutor.active ? "success" : "danger"}>
                      {tutor.active ? pluralise(studentCount, "student") : "Deactivated"}
                    </Badge>
                    <ToggleActiveButton
                      profileId={tutor.profileId}
                      active={tutor.profile.active}
                      name={tutor.profile.firstName}
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
                        {a.student?.profile.fullName} — {a.subject?.displayName}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-xs text-ink-300">
                    No assignments — this tutor currently sees no student data at all.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <InviteForm role="tutor" demo={isDemoMode()} heading="Invite a tutor" />
    </div>
  );
}
