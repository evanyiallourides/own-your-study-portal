import type { Metadata } from "next";

import { FileList } from "@/components/portal/file-list";
import { loadLessonFiles } from "@/lib/data/cached";

export const metadata: Metadata = { title: "Board & files" };
export const dynamic = "force-dynamic";

export default async function StudentLessonFiles({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const files = await loadLessonFiles(lessonId).catch(() => []);
  return <FileList files={files} />;
}
