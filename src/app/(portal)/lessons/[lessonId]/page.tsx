import { redirect } from "next/navigation";

import { lessonHref } from "@/components/portal/lesson-cards";
import { requireSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * A role-agnostic link to a lesson. Notifications and anything else that does
 * not know who will click it point here, and this sends the reader to the view
 * that belongs to them.
 */
export default async function LessonRedirect({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const session = await requireSession();
  redirect(lessonHref(session.profile.role, lessonId));
}
