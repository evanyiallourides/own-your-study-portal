import Link from "next/link";
import type { Metadata } from "next";

import { PaperEmbed } from "@/components/portal/paper-embed";
import { Card, SectionHead } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { paperCount, paperMarks } from "@/lib/papers";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Mock Papers" };
export const dynamic = "force-dynamic";

/**
 * The shelf of mock papers.
 *
 * As with the question banks, this check decides what the page says; the
 * questions themselves are protected by `/api/papers/[file]`, which re-checks
 * on every request.
 */
export default async function StudentPapers() {
  const session = await requireRole("student");
  const repo = await repositoryFor(session);
  const access = session.studentId
    ? await repo.getQuestionBankAccess(session.studentId)
    : null;

  const papers = paperCount();
  const marks = paperMarks();

  if (!access?.granted) {
    const hours = access?.pooledHours ?? 0;
    const threshold = access?.freeAtHours ?? 20;
    const remaining = Math.max(0, threshold - hours);

    return (
      <div className="space-y-8">
        <SectionHead
          as="h1"
          title="Mock Papers"
          description={`${papers} complete papers matched to the November 2025 and May 2026 topic profiles, ${marks.toLocaleString("en-GB")} marks in all.`}
        />
        <Card className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-ink">
            {access?.expiresAt ? "Your access has expired" : "Not included on your account yet"}
          </h2>
          <p className="text-sm text-ink-300">
            {access?.expiresAt
              ? `Access ran to ${formatDate(access.expiresAt)}. Ask your tutor to renew it.`
              : "Mock papers come with question bank access, and are included once you have enough pooled tutoring hours."}
          </p>
          <div className="rounded-[8px] border border-rule bg-paper p-4">
            <p className="text-sm font-medium text-ink">
              {hours} of {threshold} pooled hours
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rule">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min(100, (hours / Math.max(1, threshold)) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-ink-300">
              {remaining > 0
                ? `${remaining} more booked hour${remaining === 1 ? "" : "s"} and they are included.`
                : "You have the hours — ask your tutor to switch it on."}
            </p>
          </div>
          <p className="text-sm text-ink-300">
            One complete paper is free to sit on{" "}
            <a
              className="font-medium text-accent underline"
              href="https://ownyourstudy.com/own-your-ib/papers"
              target="_blank"
              rel="noopener"
            >
              ownyourstudy.com
            </a>
            .
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHead
        as="h1"
        title="Mock Papers"
        description={`${papers} complete papers, ${marks.toLocaleString("en-GB")} marks. Each one carries its own clock and full marking points; your marks are saved as you go.`}
        action={
          <Link href="/student/question-banks" className="text-sm font-medium text-accent hover:underline">
            Question banks →
          </Link>
        }
      />
      <PaperEmbed mode="shelf" viewHref="/student/papers/sit" />
    </div>
  );
}
