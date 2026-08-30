import { FileIcon, ImageIcon } from "@/components/ui/icons";
import { Badge, cx } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { formatFileSize, formatShortDate } from "@/lib/format";
import type { FileCategory, LessonFile } from "@/lib/types";

const CATEGORY_LABEL: Record<FileCategory, string> = {
  board: "Lesson board",
  worksheet: "Worksheet",
  homework: "Homework",
  resource: "Resource",
  other: "File",
};

function isImage(fileType: string) {
  return fileType.startsWith("image/");
}

/* ==========================================================================
   Board and files
   --------------------------------------------------------------------------
   No collaborative canvas in V1. What a tutor draws during the lesson is
   captured as an image or a PDF and shown here; the layout is a grid of
   previews so a board is recognisable at a glance rather than being a filename
   in a list. A live canvas (tldraw or similar) would slot in as an additional
   category rendered by this same component.
   ========================================================================== */

export function FileList({
  files,
  emptyDescription,
  action,
}: {
  files: LessonFile[];
  emptyDescription?: string;
  action?: React.ReactNode;
}) {
  if (files.length === 0) {
    return (
      <EmptyState
        title="No boards or resources yet"
        description={
          emptyDescription ??
          "Anything your tutor writes on the board or shares during the lesson will appear here."
        }
        action={action}
      />
    );
  }

  return (
    <div className="space-y-4">
      {action ? <div className="flex justify-end">{action}</div> : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {files.map((file) => {
          const Icon = isImage(file.fileType) ? ImageIcon : FileIcon;
          const previewable = file.url !== null;

          return (
            <li key={file.id} className="card overflow-hidden">
              {isImage(file.fileType) && file.url ? (
                /* A plain <img>: the src is a short-lived signed URL on
                   whichever Supabase host the deployment uses, so it cannot be
                   named in next/image's remotePatterns allow-list ahead of
                   time. Board scans are already modest in size. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={file.url}
                  alt={file.fileName}
                  className="max-h-64 w-full border-b border-rule bg-paper-2 object-contain"
                />
              ) : (
                <div className="flex h-28 items-center justify-center border-b border-rule bg-paper-2 text-ink-300">
                  <Icon className="h-8 w-8" />
                </div>
              )}

              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink" title={file.fileName}>
                      {file.fileName}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-300">
                      {formatShortDate(file.createdAt)}
                      {file.fileSize ? ` · ${formatFileSize(file.fileSize)}` : ""}
                    </p>
                  </div>
                  <Badge>{CATEGORY_LABEL[file.category]}</Badge>
                </div>

                <div className="mt-3">
                  {previewable ? (
                    <a
                      href={file.url!}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={cx(
                        "inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline",
                      )}
                    >
                      {file.fileType === "application/pdf" ? "Open PDF" : "Open"}
                    </a>
                  ) : (
                    <p className="text-xs text-ink-300">
                      Not available in demo mode — file storage needs a Supabase project.
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
