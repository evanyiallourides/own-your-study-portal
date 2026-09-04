import type { Metadata } from "next";

import { QuestionBankEmbed } from "@/components/portal/question-bank-embed";
import { Card, SectionHead } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";
import { questionBankIndex, questionCount } from "@/lib/question-banks";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Question Banks" };
export const dynamic = "force-dynamic";

/**
 * The shelf.
 *
 * The check here decides what the page says; it is not what protects the
 * questions. That is `/api/question-banks/[file]`, which re-checks on every
 * request — so a student who edits this page's HTML in their browser gets a
 * shelf they cannot load a single question from.
 */
export default async function StudentQuestionBanks() {
  const session = await requireRole("student");
  const repo = await repositoryFor(session);
  const access = session.studentId
    ? await repo.getQuestionBankAccess(session.studentId)
    : null;

  const banks = questionBankIndex();
  const total = questionCount();

  if (!access?.granted) {
    const hours = access?.pooledHours ?? 0;
    const threshold = access?.freeAtHours ?? 20;
    const remaining = Math.max(0, threshold - hours);
    const lapsed = access?.hasSubscriptionRow && access?.expiresAt;

    return (
      <div className="space-y-8">
        <SectionHead
          as="h1"
          title="Question Banks"
          description={`${total.toLocaleString("en-GB")} original IB practice questions across ${banks.length} banks, every one with a full worked solution.`}
        />

        <Card className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-ink">
            {lapsed ? "Your access has expired" : "Not included on your account yet"}
          </h2>
          <p className="text-sm text-ink-300">
            {lapsed
              ? `Question bank access ran to ${formatDate(access!.expiresAt!)}. Ask your tutor to renew it and it will reappear here.`
              : "Question bank access is an add-on. It is also included at no extra cost once you have enough pooled tutoring hours."}
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
                ? `${remaining} more booked hour${remaining === 1 ? "" : "s"} and the banks are included.`
                : "You have the hours — ask your tutor to switch it on."}
            </p>
          </div>

          <p className="text-sm text-ink-300">
            A sample question from every bank is free to read on{" "}
            <a
              className="font-medium text-accent underline"
              href="https://ownyourstudy.com/own-your-ib/question-banks"
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
        title="Question Banks"
        description={`${total.toLocaleString("en-GB")} questions across ${banks.length} banks, every one with a full worked solution. Your progress is saved as you work.`}
      />
      <p className="text-xs text-ink-300">
        {access.source === "pooled-hours"
          ? `Included with your ${access.pooledHours} pooled tutoring hours.`
          : access.expiresAt
            ? `Your access runs to ${formatDate(access.expiresAt)}.`
            : "Included on your account."}
      </p>

      <QuestionBankEmbed mode="shelf" viewHref="/student/question-banks/view" />
    </div>
  );
}
