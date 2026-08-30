import type { Metadata } from "next";

import { FileList } from "@/components/portal/file-list";
import { FileUpload } from "@/components/portal/file-upload";
import { requireTeachingAccess } from "@/lib/auth/session";
import { loadLessonFiles } from "@/lib/data/cached";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Board & files" };
export const dynamic = "force-dynamic";

export default async function TutorLessonFiles({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  await requireTeachingAccess();
  const files = await loadLessonFiles(lessonId).catch(() => []);

  return (
    <div className="space-y-8">
      <FileUpload lessonId={lessonId} demo={isDemoMode()} />
      <FileList
        files={files}
        emptyDescription="Upload the lesson board, a worksheet or anything else you shared. It appears on the student's lesson page once you publish."
      />
    </div>
  );
}
