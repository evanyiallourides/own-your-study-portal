import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { PaperEmbed } from "@/components/portal/paper-embed";
import { requireRole } from "@/lib/auth/session";
import { repositoryFor } from "@/lib/data";

export const metadata: Metadata = { title: "Mock Paper" };
export const dynamic = "force-dynamic";

/**
 * One paper, open, with its clock.
 *
 * The redirect is a courtesy for a student without access; the boundary is
 * `/api/papers/[file]`, which checks for itself on every request.
 */
export default async function SitPaper() {
  const session = await requireRole("student");
  const repo = await repositoryFor(session);
  const access = session.studentId
    ? await repo.getQuestionBankAccess(session.studentId)
    : null;

  if (!access?.granted) redirect("/student/papers");

  return <PaperEmbed mode="paper" backHref="/student/papers" viewHref="/student/papers/sit" />;
}
