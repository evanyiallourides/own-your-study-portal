import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { Avatar, SectionHead } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";

export const metadata: Metadata = { title: "Review & plan" };
export const dynamic = "force-dynamic";

/** One child goes straight to their document; several pick first. */
export default async function ParentPlanIndex() {
  const session = await requireRole("parent");
  const repo = await repositoryFor(session);
  const children = await repo.listStudents();

  if (children.length === 1) redirect(`/parent/plan/${children[0]!.id}`);

  if (children.length === 0) {
    return (
      <EmptyState
        title="No children linked to your account yet"
        description="Your coordinator links a parent account to a student. Their review and plan will appear here."
      />
    );
  }

  return (
    <div>
      <SectionHead as="h1" title="Review & plan" description="Choose whose review to open." />
      <ul className="grid gap-4 sm:grid-cols-2">
        {children.map((child) => (
          <li key={child.id}>
            <Link
              href={`/parent/plan/${child.id}`}
              className="card card-interactive flex items-center gap-3 p-5"
            >
              <Avatar name={child.profile.fullName} size={40} />
              <span className="font-display text-lg font-semibold text-ink">{child.profile.fullName}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
