import Link from "next/link";
import type { Metadata } from "next";

import { PrintButton } from "@/components/portal/print-button";
import { ReviewDocument } from "@/components/portal/review-document";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/states";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";

export const metadata: Metadata = { title: "Review & plan" };
export const dynamic = "force-dynamic";

/** The student's progress review and study plan, ready to print or save as a PDF. */
export default async function StudentPlanPage() {
  const session = await requireRole("student");
  const repo = await repositoryFor(session);
  const student = session.studentId ? await repo.getStudent(session.studentId) : null;

  if (!student) {
    return (
      <EmptyState
        title="Your student record is not set up yet"
        description="Your coordinator can finish this off, and your plan will appear here."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/student"
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 transition-colors hover:text-accent"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Home
        </Link>
        <PrintButton />
      </div>
      <ReviewDocument repo={repo} student={student} lessonHrefBase="/student/lessons" />
    </div>
  );
}
