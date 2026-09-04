import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { QuestionBankEmbed } from "@/components/portal/question-bank-embed";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";

export const metadata: Metadata = { title: "Question Bank" };
export const dynamic = "force-dynamic";

/**
 * One bank, open.
 *
 * A student without access is sent back to the shelf, which explains why. That
 * redirect is a courtesy rather than the boundary: the questions arrive from
 * `/api/question-banks/[file]`, which checks access itself on every request.
 */
export default async function StudentQuestionBankViewer() {
  const session = await requireRole("student");
  const repo = await repositoryFor(session);
  const access = session.studentId
    ? await repo.getQuestionBankAccess(session.studentId)
    : null;

  if (!access?.granted) redirect("/student/question-banks");

  return (
    <QuestionBankEmbed
      mode="viewer"
      backHref="/student/question-banks"
      viewHref="/student/question-banks/view"
    />
  );
}
