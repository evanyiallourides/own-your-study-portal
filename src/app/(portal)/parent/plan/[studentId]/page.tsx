import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PrintButton } from "@/components/portal/print-button";
import { ReviewDocument } from "@/components/portal/review-document";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";

export const metadata: Metadata = { title: "Review & plan" };
export const dynamic = "force-dynamic";

/** A child's progress review and plan. A child who is not theirs does not resolve. */
export default async function ParentPlanPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const session = await requireRole("parent");
  const repo = await repositoryFor(session);
  const student = await repo.getStudent(studentId).catch(() => null);
  if (!student) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/parent"
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors hover:text-accent"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Home
        </Link>
        <PrintButton />
      </div>
      <ReviewDocument repo={repo} student={student} lessonHrefBase="/parent/lessons" />
    </div>
  );
}
